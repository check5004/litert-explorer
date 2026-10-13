#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["tflite==2.18.0", "flatbuffers==25.2.10", "numpy==2.2.6"]
# ///
"""Inspect TFLite FlatBuffers offline. Counts are static estimates, never timings.

Run from the project root:
  python scripts/analyze_tflite.py                 # public/models/*.tflite
  python scripts/analyze_tflite.py path/model.tflite --output-dir public/models

No TensorFlow runtime, model execution, network, or weight decoding is needed.
See docs/compute-method.md for the counting convention and its limitations.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys
from typing import Any


DEPENDENCIES = {"tflite": "2.18.0", "flatbuffers": "25.2.10", "numpy": "2.2.6"}
SOURCE_URLS = [
    "https://pypi.org/project/tflite/2.18.0/",
    "https://github.com/tensorflow/tensorflow/blob/v2.18.0/tensorflow/compiler/mlir/lite/schema/schema.fbs",
    "https://github.com/tensorflow/tensorflow/blob/v2.18.0/tensorflow/lite/kernels/internal/reference/conv.h",
    "https://github.com/tensorflow/tensorflow/blob/v2.18.0/tensorflow/lite/kernels/batch_matmul.cc",
]

# These operators rearrange/copy/select elements, rather than perform numeric
# arithmetic on them. Zero here does NOT mean zero work or zero latency.
DATA_MOVEMENT_OPS = {
    "RESHAPE", "SQUEEZE", "EXPAND_DIMS", "TRANSPOSE", "CONCATENATION",
    "SPLIT", "SPLIT_V", "SLICE", "STRIDED_SLICE", "PACK", "UNPACK",
    "PAD", "PADV2", "MIRROR_PAD", "TILE", "GATHER", "GATHER_ND",
    "DEPTH_TO_SPACE", "SPACE_TO_DEPTH", "BATCH_TO_SPACE_ND",
    "SPACE_TO_BATCH_ND", "REVERSE_V2", "BROADCAST_TO", "FILL",
    "ZEROS_LIKE", "SELECT", "SELECT_V2", "RESIZE_NEAREST_NEIGHBOR",
}
ELEMENTWISE_COST = {"ADD": 1, "SUB": 1, "MUL": 1, "DIV": 1, "SQUARED_DIFFERENCE": 2}
FLOAT_TYPES = {"FLOAT16", "FLOAT32", "FLOAT64", "BFLOAT16"}
NUMERIC_TYPES = FLOAT_TYPES | {"INT4", "INT8", "INT16", "INT32", "INT64", "UINT8", "UINT16", "UINT32", "UINT64"}


class AnalysisError(ValueError):
    """A file is not a readable, internally consistent TFLite graph."""


def _text(value: bytes | None) -> str:
    return value.decode("utf-8", errors="replace") if value else ""


def _enum_names(enum: Any) -> dict[int, str]:
    return {value: key for key, value in vars(enum).items() if not key.startswith("_") and isinstance(value, int)}


def _unknown(reason: str) -> dict[str, Any]:
    return {"macs": None, "flops": None, "estimateStatus": "unknown", "formula": None,
            "arithmeticKind": None, "notes": [reason]}


def _known(macs: int, flops: int, formula: str, tensors: list[dict[str, Any]], notes: list[str] | None = None) -> dict[str, Any]:
    floating = all(t["dtype"] in FLOAT_TYPES for t in tensors)
    result_notes = list(notes or [])
    if not floating and flops:
        result_notes.append("Integer/quantized or mixed arithmetic: FLOPs are arithmetic-equivalent counts, not floating-point instructions.")
    return {"macs": macs, "flops": flops, "estimateStatus": "estimated", "formula": formula,
            "arithmeticKind": "floating_point" if floating else "integer_or_mixed_equivalent", "notes": result_notes}


def _shape(tensor: dict[str, Any] | None, rank: int | None = None) -> list[int] | None:
    if tensor is None or not tensor.get("rankKnown", True):
        return None
    shape = tensor.get("shape")
    signature = tensor.get("shapeSignature") or []
    if shape is None or any(d < 0 for d in shape) or any(d < 0 for d in signature):
        return None
    if rank is not None and len(shape) != rank:
        return None
    return shape


def _broadcast(lhs: list[int], rhs: list[int]) -> list[int] | None:
    """NumPy/TFLite broadcasting, including zero-sized dimensions."""
    out = []
    for i in range(1, max(len(lhs), len(rhs)) + 1):
        a = lhs[-i] if i <= len(lhs) else 1
        b = rhs[-i] if i <= len(rhs) else 1
        if a == b:
            out.append(a)
        elif a == 1:
            out.append(b)
        elif b == 1:
            out.append(a)
        else:
            return None
    return out[::-1]


def estimate_operator(name: str, inputs: list[dict[str, Any] | None], outputs: list[dict[str, Any] | None], options: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return a conservative core-arithmetic estimate using serialized shapes.

    This public pure function is also used by unit tests. Optional absent input
    tensors are None. A dynamic shape signature invalidates an estimate even if
    the model stores a concrete placeholder/default allocation shape.
    """
    options = options or {}
    if options.get("parseError"):
        return _unknown(options["parseError"])
    if not outputs or any(t is None for t in outputs):
        return _unknown("Missing output tensor.")
    if name in DATA_MOVEMENT_OPS:
        return {"macs": 0, "flops": 0, "estimateStatus": "zero_arithmetic",
                "formula": "0 numeric arithmetic operations (data movement only)",
                "arithmeticKind": "data_movement", "notes": [
                    "Copies, indexing, address calculations, allocation, fused activations and memory traffic are excluded; runtime cost is not zero."]}
    supported = {"CONV_2D", "DEPTHWISE_CONV_2D", "FULLY_CONNECTED", "BATCH_MATMUL"} | set(ELEMENTWISE_COST)
    if name not in supported:
        return _unknown("No implemented arithmetic formula for this operator; excluded from subtotals.")
    if len(inputs) < 2 or inputs[0] is None or inputs[1] is None or len(outputs) != 1:
        return _unknown("The arithmetic formula requires two input tensors and one output.")
    a, b, out = inputs[0], inputs[1], outputs[0]
    tensors = [a, b, out]
    if any(t["dtype"] not in NUMERIC_TYPES for t in tensors):
        return _unknown("Unsupported numeric tensor type (e.g. complex, string or resource).")
    ash, bsh, osh = (_shape(t) for t in tensors)
    if any(s is None for s in (ash, bsh, osh)):
        return _unknown("Unresolved/dynamic dimensions or unknown rank; no placeholder-shape estimate is made.")
    notes = ["Core arithmetic only; bias additions, fused activations, quantization/requantization and memory movement are excluded."]
    if any(t.get("isSparse") for t in tensors):
        notes.append("Dense-equivalent estimate; sparse encoding and skipped zero weights do not reduce the count.")

    if name in {"CONV_2D", "DEPTHWISE_CONV_2D"}:
        if any(len(s) != 4 for s in (ash, bsh, osh)):
            return _unknown("Convolution requires rank-4 NHWC input/output and rank-4 filter tensors.")
        if ash[0] != osh[0] or min(ash[3], bsh[1], bsh[2], osh[3]) <= 0:
            return _unknown("Inconsistent batch/channel or empty convolution filter dimensions.")
        if name == "CONV_2D":
            # TFLite's OHWI filter uses input channels PER GROUP. Using the
            # activation's full input depth would overcount grouped convolution.
            if bsh[0] != osh[3] or bsh[3] <= 0 or ash[3] % bsh[3]:
                return _unknown("Convolution input/filter/output channel dimensions are inconsistent.")
            groups = ash[3] // bsh[3]
            if osh[3] % groups:
                return _unknown("Output channels are not divisible by convolution groups.")
            macs = math.prod(osh) * bsh[1] * bsh[2] * bsh[3]
            formula = "B × Hout × Wout × Cout × Kh × Kw × Cin_per_group"
            if groups > 1:
                notes.append(f"Grouped convolution with {groups} groups; filter input depth is per group.")
        else:
            # TFLite depthwise filter is [1, Kh, Kw, Cout], Cout=Cin*multiplier.
            if bsh[0] != 1 or bsh[3] != osh[3] or osh[3] % ash[3]:
                return _unknown("Depthwise filter/output channels do not match input depth and multiplier.")
            multiplier = osh[3] // ash[3]
            if "depthMultiplier" in options and options["depthMultiplier"] != multiplier:
                return _unknown("Serialized depth multiplier disagrees with tensor shapes.")
            macs = math.prod(osh) * bsh[1] * bsh[2]
            formula = "B × Hout × Wout × Cout × Kh × Kw; Cout = Cin × depth_multiplier"
        notes.append("Dense padded-kernel convention: counts the full filter at boundary outputs, including zero-padding positions. Stride/dilation affect output shape, not taps per output.")
        return _known(macs, 2 * macs, formula + "; FLOPs = 2 × MACs", tensors, notes)

    if name == "FULLY_CONNECTED":
        if len(bsh) != 2 or not osh or not ash or bsh[1] <= 0 or bsh[0] <= 0:
            return _unknown("Fully connected requires a [units, input_depth] filter and known nonempty-rank activations.")
        if options.get("weightsFormat", 0) != 0:
            return _unknown("Packed/shuffled fully connected weight format is not supported by this formula.")
        if osh[-1] != bsh[0] or math.prod(ash) % bsh[1]:
            return _unknown("Fully connected input/filter/output dimensions are inconsistent.")
        if math.prod(ash) // bsh[1] != math.prod(osh[:-1]):
            return _unknown("Fully connected flattened input batch does not match output batch dimensions.")
        if options.get("keepNumDims") and (ash[-1] != bsh[1] or ash[:-1] != osh[:-1]):
            return _unknown("Fully connected keep_num_dims dimensions do not agree.")
        macs = math.prod(osh) * bsh[1]
        return _known(macs, 2 * macs, "output_elements × input_depth; FLOPs = 2 × MACs", tensors, notes)

    if name == "BATCH_MATMUL":
        if min(len(ash), len(bsh), len(osh)) < 2:
            return _unknown("Batch matmul requires rank >= 2 input/output tensors.")
        m, k = (ash[-1], ash[-2]) if options.get("adjX", False) else ash[-2:]
        k2, n = (bsh[-1], bsh[-2]) if options.get("adjY", False) else bsh[-2:]
        batch = _broadcast(ash[:-2], bsh[:-2])
        if k != k2 or batch is None or osh != batch + [m, n]:
            return _unknown("Matmul contraction or broadcast batch/output dimensions are inconsistent.")
        macs = math.prod(batch) * m * n * k
        return _known(macs, 2 * macs, "broadcast_batch_elements × M × N × K; FLOPs = 2 × MACs", tensors, notes)

    if _broadcast(ash, bsh) != osh:
        return _unknown("Elementwise broadcast dimensions do not match output shape.")
    flops = math.prod(osh) * ELEMENTWISE_COST[name]
    return _known(0, flops, f"output_elements × {ELEMENTWISE_COST[name]} arithmetic operation(s); MACs = 0", tensors, notes)


def _operator_options(operator: Any, schema: Any) -> dict[str, Any]:
    """Parse only options affecting supported formulas or their explanation."""
    classes = {
        "Conv2DOptions": ["Padding", "StrideH", "StrideW", "DilationHFactor", "DilationWFactor", "FusedActivationFunction"],
        "DepthwiseConv2DOptions": ["Padding", "StrideH", "StrideW", "DilationHFactor", "DilationWFactor", "DepthMultiplier", "FusedActivationFunction"],
        "FullyConnectedOptions": ["KeepNumDims", "WeightsFormat", "AsymmetricQuantizeInputs", "FusedActivationFunction"],
        "BatchMatMulOptions": ["AdjX", "AdjY", "AsymmetricQuantizeInputs"],
        "AddOptions": ["FusedActivationFunction"], "SubOptions": ["FusedActivationFunction"],
        "MulOptions": ["FusedActivationFunction"], "DivOptions": ["FusedActivationFunction"],
        "ConcatenationOptions": ["FusedActivationFunction", "Axis"],
    }
    option_type = int(operator.BuiltinOptionsType())
    option_name = _enum_names(schema.BuiltinOptions).get(option_type, f"UNKNOWN_{option_type}")
    if option_name not in classes:
        return {"type": option_name}
    table = operator.BuiltinOptions()
    if table is None:
        return {"type": option_name, "parseError": "Builtin option type is set but its option table is missing."}
    obj = getattr(schema, option_name)()
    obj.Init(table.Bytes, table.Pos)
    result = {"type": option_name}
    for method in classes[option_name]:
        value = getattr(obj, method)()
        key = method[0].lower() + method[1:]
        result[key] = value if isinstance(value, bool) else int(value)
    if "padding" in result:
        result["paddingName"] = _enum_names(schema.Padding).get(result["padding"], "UNKNOWN")
    if "fusedActivationFunction" in result:
        result["fusedActivationName"] = _enum_names(schema.ActivationFunctionType).get(result["fusedActivationFunction"], "UNKNOWN")
    return result


def _summarize(operators: list[dict[str, Any]]) -> dict[str, Any]:
    known = [op for op in operators if op["macs"] is not None and op["flops"] is not None]
    unknown = [op for op in operators if op["macs"] is None or op["flops"] is None]
    return {
        "operatorCount": len(operators), "estimatedOperatorCount": len(known),
        "unknownOperatorCount": len(unknown),
        "zeroArithmeticOperatorCount": sum(op["estimateStatus"] == "zero_arithmetic" for op in operators),
        "operatorCoveragePercent": round(100 * len(known) / len(operators), 2) if operators else None,
        "knownMacs": sum(op["macs"] for op in known), "knownFlops": sum(op["flops"] for op in known),
        "isPartial": bool(unknown),
        "coverageMeaning": "Fraction of operator nodes with a core-arithmetic formula, including data-movement nodes with zero arithmetic. Not the fraction of model compute or runtime covered.",
        "unknownOperators": dict(sorted(Counter(op["name"] for op in unknown).items())),
        "operatorTypes": dict(sorted(Counter(op["name"] for op in operators).items())),
    }


def analyze_bytes(data: bytes, filename: str = "model.tflite") -> dict[str, Any]:
    """Read a regular (not size-prefixed) TFL3 FlatBuffer into JSON-safe objects."""
    if len(data) < 8 or data[4:8] != b"TFL3":
        raise AnalysisError("Missing TFL3 FlatBuffer identifier; expected an uncompressed .tflite model.")
    try:
        import tflite as schema
    except ImportError as error:
        raise AnalysisError("Install pinned analyzer dependencies: python -m pip install tflite==2.18.0 flatbuffers==25.2.10 numpy==2.2.6") from error
    try:
        return _analyze_flatbuffer(data, filename, schema)
    except AnalysisError:
        raise
    except (IndexError, TypeError, ValueError, OverflowError, AttributeError, RuntimeError) as error:
        raise AnalysisError(f"Unreadable or malformed TFLite FlatBuffer: {error}") from error
    except Exception as error:
        # flatbuffers uses struct.error for out-of-range binary offsets.
        import struct
        if isinstance(error, struct.error):
            raise AnalysisError(f"Truncated or malformed TFLite FlatBuffer: {error}") from error
        raise


def _analyze_flatbuffer(data: bytes, filename: str, schema: Any) -> dict[str, Any]:
    model = schema.Model.GetRootAsModel(data, 0)
    if int(model.Version()) != 3:
        raise AnalysisError(f"Unsupported model schema version {model.Version()}; expected version 3.")
    if model.SubgraphsLength() < 1:
        raise AnalysisError("The model has no subgraphs.")
    enum_types = _enum_names(schema.TensorType)
    enum_ops = _enum_names(schema.BuiltinOperator)
    subgraphs, operators = [], []
    for graph_index in range(model.SubgraphsLength()):
        graph = model.Subgraphs(graph_index)
        tensors = []
        for index in range(graph.TensorsLength()):
            tensor = graph.Tensors(index)
            buffer_index = int(tensor.Buffer())
            if not 0 <= buffer_index < model.BuffersLength():
                raise AnalysisError(f"Subgraph {graph_index}, tensor {index}: invalid buffer index {buffer_index}.")
            buffer = model.Buffers(buffer_index)
            shape = [int(tensor.Shape(i)) for i in range(tensor.ShapeLength())]
            signature = [int(tensor.ShapeSignature(i)) for i in range(tensor.ShapeSignatureLength())]
            tensors.append({
                "index": index, "name": _text(tensor.Name()), "shape": shape,
                "shapeSignature": signature, "rankKnown": bool(shape or tensor.HasRank() or not tensor.ShapeIsNone()),
                "dtype": enum_types.get(int(tensor.Type()), f"UNKNOWN_{tensor.Type()}"),
                "bufferIndex": buffer_index, "isConstant": bool(buffer.DataLength() or buffer.Size()),
                "isVariable": bool(tensor.IsVariable()), "isSparse": tensor.Sparsity() is not None,
            })

        def refs(obj: Any, method: str, optional: bool = False) -> list[dict[str, Any] | None]:
            result = []
            for i in range(getattr(obj, method + "Length")()):
                tensor_index = int(getattr(obj, method)(i))
                if tensor_index == -1 and optional:
                    result.append(None)
                elif 0 <= tensor_index < len(tensors):
                    result.append(tensors[tensor_index])
                else:
                    raise AnalysisError(f"Subgraph {graph_index}: invalid {method.lower()} tensor index {tensor_index}.")
            return result

        graph_ops = []
        for index in range(graph.OperatorsLength()):
            op = graph.Operators(index)
            opcode_index = int(op.OpcodeIndex())
            if not 0 <= opcode_index < model.OperatorCodesLength():
                raise AnalysisError(f"Subgraph {graph_index}, operator {index}: invalid opcode index {opcode_index}.")
            opcode = model.OperatorCodes(opcode_index)
            # Older models stored codes only in the deprecated int8 field.
            builtin_code = max(int(opcode.BuiltinCode()), int(opcode.DeprecatedBuiltinCode()))
            builtin_name = enum_ops.get(builtin_code, f"UNKNOWN_BUILTIN_{builtin_code}")
            custom_code = _text(opcode.CustomCode()) if builtin_name == "CUSTOM" else None
            inputs, outputs = refs(op, "Inputs", optional=True), refs(op, "Outputs")
            options = _operator_options(op, schema)
            record = {
                "index": index, "globalIndex": len(operators), "subgraphIndex": graph_index,
                "name": f"CUSTOM:{custom_code or 'unnamed'}" if builtin_name == "CUSTOM" else builtin_name,
                "builtinCode": builtin_code, "version": int(opcode.Version()), "customCode": custom_code,
                "inputs": inputs, "outputs": outputs, "options": options,
                **estimate_operator(builtin_name, inputs, outputs, options),
            }
            graph_ops.append(record)
            operators.append(record)
        subgraphs.append({"index": graph_index, "name": _text(graph.Name()), "inputs": refs(graph, "Inputs"),
                          "outputs": refs(graph, "Outputs"), "tensorCount": len(tensors),
                          "operatorIndices": [op["globalIndex"] for op in graph_ops], "summary": _summarize(graph_ops)})
    summary = _summarize(operators)
    summary["scope"] = "Each serialized operator node counted once across all subgraphs; not an execution trace."
    return {
        "schemaVersion": 1,
        "model": {"filename": Path(filename).name, "byteLength": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                  "tfliteSchemaVersion": int(model.Version()), "description": _text(model.Description()),
                  "subgraphCount": len(subgraphs)},
        "analysis": {"kind": "static_graph_estimate", "runtimeProfiling": False, "dependencies": DEPENDENCIES,
                     "convention": "One MAC = two arithmetic operations. FLOPs on quantized/mixed ops are floating-point-equivalent counts. Core arithmetic only.",
                     "shapePolicy": "Serialized concrete dimensions only; symbolic shape signatures make arithmetic estimates unknown.",
                     "limitations": [
                         "These numbers are not per-operator timings and do not predict CPU/GPU latency.",
                         "Unknown operators have null counts and are excluded from subtotals, never silently counted as zero.",
                         "Bias, fused activation, quantization, comparisons, indexing, memory movement, delegates and kernel implementation details are excluded.",
                         "Counts use dense padded kernels and do not discount sparse weights or boundary padding.",
                         "All subgraphs are counted once. Branch selection, loops, calls and runtime shape changes are not modeled.",
                     ], "sources": SOURCE_URLS},
        "summary": summary, "subgraphs": subgraphs, "operators": operators,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("models", nargs="*", type=Path, help="Models to analyze; defaults to public/models/*.tflite")
    parser.add_argument("--output-dir", type=Path, help="Write <model>.graph.json here instead of beside each model")
    args = parser.parse_args(argv)
    paths = args.models or sorted(Path("public/models").glob("*.tflite"))
    if not paths:
        parser.error("No .tflite models found. Supply model paths or place models in public/models.")
    destinations = [((args.output_dir or p.parent) / f"{p.stem}.graph.json") for p in paths]
    if len({p.resolve() for p in destinations}) != len(destinations):
        parser.error("Multiple model paths would overwrite the same output filename.")
    failed = False
    for path, target in zip(paths, destinations):
        try:
            result = analyze_bytes(path.read_bytes(), path.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            # Atomic replacement prevents the UI from reading partially written JSON.
            temporary = target.with_suffix(target.suffix + ".tmp")
            temporary.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
            temporary.replace(target)
            summary = result["summary"]
            print(f"{path} -> {target}: {summary['operatorCount']} operators, {summary['operatorCoveragePercent']}% node coverage, {summary['knownMacs']:,} known MACs (static subtotal)")
        except (OSError, AnalysisError) as error:
            print(f"{path}: {error}", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
