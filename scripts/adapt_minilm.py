#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["tflite==2.18.0", "flatbuffers==25.2.10", "numpy==2.2.6"]
# ///
"""Adapt this exact MiniLM model's boundary to LiteRT.js int32 inputs.

Changes four tensor dtype bytes, no weights or operators. The original model
must match the pinned hash. Valid token IDs and binary attention masks fit in
int32, so the already-existing CASTs yield the same numeric values.

python scripts/adapt_minilm.py
python scripts/analyze_tflite.py public/models/minilm-int32.tflite

Optional native equivalence verification:
  python -m pip install ai-edge-litert==2.1.0
  python scripts/adapt_minilm.py --verify-runtime
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys


EXPECTED_SOURCE_SHA256 = "4735aa32b76f79d31b91a5326c7cde363ee87c13f650794729d0f3c3298b7673"


def verify_runtime(original: Path, adapted: Path) -> dict:
    """Compare deterministic cases in native LiteRT; not a browser benchmark."""
    from importlib.metadata import version
    import gc
    import numpy as np
    from ai_edge_litert.interpreter import Interpreter

    if version("ai-edge-litert") != "2.1.0":
        raise ValueError("Reproducible native verification requires ai-edge-litert==2.1.0.")
    rng = np.random.default_rng(20261009)
    short = np.zeros((1, 128), dtype=np.int64)
    short[0, :6] = [101, 2023, 2003, 1037, 3231, 102]
    short_mask = np.zeros((1, 128), dtype=np.int64)
    short_mask[0, :6] = 1
    cases = [
        ("short_padded", short, short_mask),
        ("full_sequence", rng.integers(1, 10000, (1, 128), dtype=np.int64), np.ones((1, 128), dtype=np.int64)),
        ("all_padding", np.zeros((1, 128), dtype=np.int64), np.zeros((1, 128), dtype=np.int64)),
        ("gapped_mask", rng.integers(1, 10000, (1, 128), dtype=np.int64), rng.integers(0, 2, (1, 128), dtype=np.int64)),
    ]
    outputs_by_model = []
    for path in (original, adapted):
        interpreter = Interpreter(model_path=str(path), num_threads=1)
        interpreter.allocate_tensors()
        inputs, outputs = interpreter.get_input_details(), interpreter.get_output_details()
        values = []
        for _, token_ids, attention_mask in cases:
            for detail, value in zip(inputs, (token_ids, attention_mask)):
                interpreter.set_tensor(detail["index"], value.astype(detail["dtype"]))
            interpreter.invoke()
            value = interpreter.get_tensor(outputs[0]["index"]).copy()
            if value.shape != (1, 384) or not np.isfinite(value).all():
                raise ValueError(f"Unexpected or nonfinite embedding from {path}.")
            values.append(value)
        outputs_by_model.append(values)
        del interpreter
        gc.collect()
    report = {"runtime": "ai-edge-litert==2.1.0", "numpyVersion": np.__version__, "numThreads": 1, "cases": []}
    for (name, _, _), before, after in zip(cases, *outputs_by_model):
        np.testing.assert_allclose(before, after, rtol=1e-6, atol=1e-6)
        report["cases"].append({"name": name, "outputShape": list(before.shape),
                                "maxAbsoluteDifference": float(np.max(np.abs(before - after))),
                                "bitwiseEqual": bool(np.array_equal(before, after)), "finite": True})
    return report


def adapt(data: bytes) -> tuple[bytes, dict]:
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED_SOURCE_SHA256:
        raise ValueError(f"Refusing an unrecognized model: SHA-256 {digest}. Expected {EXPECTED_SOURCE_SHA256}.")
    import tflite as t
    model = t.Model.GetRootAsModel(data, 0)
    if data[4:8] != b"TFL3" or model.Version() != 3 or model.SubgraphsLength() != 1:
        raise ValueError("Expected one-subgraph TFLite schema-v3 model.")
    graph = model.Subgraphs(0)
    if [int(graph.Inputs(i)) for i in range(graph.InputsLength())] != [0, 1]:
        raise ValueError("Unexpected model inputs.")

    expected_edges = {
        0: [(0, "CAST", [220])],
        1: [(22, "RESHAPE", [242]), (676, "RESHAPE", [896])],
        242: [(23, "CAST", [243])],
        896: [(677, "CAST", [897])],
    }
    patches = []
    for index, expected in expected_edges.items():
        tensor = graph.Tensors(index)
        if tensor.Type() != t.TensorType.INT64 or tensor.IsVariable() or tensor.Sparsity() is not None:
            raise ValueError(f"Tensor {index} is not an ordinary INT64 boundary activation.")
        buffer = model.Buffers(tensor.Buffer())
        if buffer.DataLength() or buffer.Size():
            raise ValueError(f"Refusing to modify constant tensor {index}.")
        consumers = []
        for op_index in range(graph.OperatorsLength()):
            op = graph.Operators(op_index)
            if index in [int(op.Inputs(i)) for i in range(op.InputsLength())]:
                code = model.OperatorCodes(op.OpcodeIndex()).BuiltinCode()
                name = t.opcode2name(code)
                outputs = [int(op.Outputs(i)) for i in range(op.OutputsLength())]
                consumers.append((op_index, name, outputs))
                if op.Inputs(0) != index:
                    raise ValueError(f"Tensor {index} is not a data input at operator {op_index}.")
                if name == "CAST" and op.BuiltinOptionsType() != t.BuiltinOptions.NONE:
                    raise ValueError("Unexpected explicit CAST options; boundary-only patch needs review.")
        if consumers != expected:
            raise ValueError(f"Unexpected consumers of tensor {index}: {consumers}.")
        # Tensor.type is field 1, so FlatBuffers vtable offset is 4 + 2*1.
        # INT64 is non-default; this model stores the one-byte enum explicitly.
        field_offset = tensor._tab.Offset(6)
        if not field_offset:
            raise ValueError(f"Tensor {index} has no explicit dtype byte.")
        byte_offset = tensor._tab.Pos + field_offset
        if data[byte_offset] != t.TensorType.INT64:
            raise ValueError(f"Unexpected dtype encoding at byte {byte_offset}.")
        patches.append({"tensorIndex": index, "tensorName": tensor.Name().decode("utf-8"),
                        "byteOffset": byte_offset, "from": "INT64", "to": "INT32",
                        "fromByte": t.TensorType.INT64, "toByte": t.TensorType.INT32})
    for index, expected in {220: t.TensorType.INT32, 243: t.TensorType.FLOAT32, 897: t.TensorType.FLOAT32}.items():
        if graph.Tensors(index).Type() != expected:
            raise ValueError(f"Unexpected CAST destination type for tensor {index}.")

    patched = bytearray(data)
    for patch in patches:
        patched[patch["byteOffset"]] = patch["toByte"]
    # Compare contiguous regions to prove all other bytes are preserved without
    # a slow per-byte Python scan over this 470 MB model.
    offsets = sorted(p["byteOffset"] for p in patches)
    if len(set(offsets)) != 4:
        raise ValueError("Expected exactly four independent dtype fields.")
    start = 0
    source_view, output_view = memoryview(data), memoryview(patched)
    for end in offsets + [len(data)]:
        if source_view[start:end] != output_view[start:end]:
            raise ValueError("Unexpected non-dtype byte change.")
        start = end + 1
    result = bytes(patched)
    metadata = {
        "kind": "int32_input_boundary_adaptation", "sourceSha256": digest,
        "adaptedSha256": hashlib.sha256(result).hexdigest(), "byteLength": len(result),
        "changedByteCount": len(patches), "patches": patches,
        "allOtherBytesPreserved": True, "weightsPreserved": True, "operatorsPreserved": True,
        "inputContract": "Int32 token IDs within the tokenizer vocabulary and binary (0/1) attention masks, shape [1,128].",
        "equivalenceScope": "Existing CAST to INT32 for token IDs and existing CASTs to FLOAT32 after mask RESHAPEs. Equivalent numeric inputs for valid int32-range values; not a general int64 conversion.",
        "runtimeValidation": "This manifest proves the byte-preserving adaptation only. Test inference in the target runtime separately.",
        "reference": "https://github.com/tensorflow/tensorflow/blob/v2.18.0/tensorflow/lite/kernels/cast.cc",
    }
    return result, metadata


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, default=Path(".asset-cache/minilm.tflite"))
    parser.add_argument("--output", type=Path, default=Path("public/models/minilm-int32.tflite"))
    parser.add_argument("--verify-runtime", action="store_true", help="Compare four input cases with native ai-edge-litert==2.1.0")
    args = parser.parse_args(argv)
    if args.source.resolve() == args.output.resolve():
        parser.error("Keep the original model; source and output must differ.")
    try:
        data, metadata = adapt(args.source.read_bytes())
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(args.output)
        metadata["sourceFilename"] = args.source.name
        metadata["adaptedFilename"] = args.output.name
        if args.verify_runtime:
            # Release the full in-memory file before allocating native tensors.
            del data
            metadata["nativeRuntimeValidation"] = verify_runtime(args.source, args.output)
        manifest = args.output.with_suffix(".adaptation.json")
        manifest.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        print(f"{args.output}: exactly four INT64 → INT32 tensor dtype bytes changed; all weights/operators preserved.")
        print(f"SHA-256: {metadata['adaptedSha256']}")
        return 0
    except (OSError, ValueError, ImportError, AssertionError) as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
