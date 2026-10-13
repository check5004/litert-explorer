# Static graph compute estimates

The app reads generated graph metadata from actual `.tflite` FlatBuffer files. This is **offline static analysis**, not operator profiling. No per-operator timing is measured or inferred. Browser inference latency is a separate end-to-end measurement and must not be apportioned to nodes using these counts.

## Reproduce

Python 3.10 or newer:

```sh
python -m venv .venv-analyzer
. .venv-analyzer/bin/activate
python -m pip install tflite==2.18.0 flatbuffers==25.2.10 numpy==2.2.6
python scripts/analyze_tflite.py
python -m unittest discover -s tests -p 'test_analyze_tflite.py' -v
```

The script also includes the same pinned dependencies in PEP 723 inline metadata, so `uv run scripts/analyze_tflite.py` can create its isolated environment. Dependencies are only needed when generating metadata; the browser does not import Python, this parser, or TensorFlow.

By default, the script analyzes `public/models/*.tflite` and atomically writes a sibling `<name>.graph.json`. Explicit model paths and `--output-dir` are supported. A missing/malformed model fails with a nonzero exit code. The parser requires the `TFL3` identifier, model schema version 3, and valid graph/opcode/tensor/buffer references. This is not a complete FlatBuffer verifier or a guarantee that a runtime supports the model. It never executes the graph or reads tensor weight values.

## Counting convention

One multiply-accumulate (MAC) is counted as two arithmetic operations: one multiplication and one addition. This is the conventional `2 × MACs` estimate, rather than the literal `2K − 1` operations needed for an unfused length-K dot product. The `flops` field is a FLOP-equivalent arithmetic count. For integer, quantized, or mixed arithmetic it does **not** mean that floating-point instructions execute; the operator's `arithmeticKind` and notes explicitly identify that case.

Counts describe only core arithmetic. They omit bias additions, fused activations, quantization and requantization, comparisons, indexing, copies, allocation, delegate partitioning, kernel layout transforms, memory traffic, and runtime overhead. Consequently a “known” estimate is still not a complete operator instruction count.

### Implemented formulas

- **CONV_2D:** `B × Hout × Wout × Cout × Kh × Kw × Cin_per_group` MACs. Activations are NHWC and filters are `[Cout, Kh, Kw, Cin_per_group]`. Group count is validated from input depth divided by filter input depth. Output channels must be divisible by group count.
- **DEPTHWISE_CONV_2D:** `B × Hout × Wout × Cout × Kh × Kw` MACs. Filter layout is `[1, Kh, Kw, Cout]`; `Cout = Cin × depth_multiplier`. The input-channel factor must not be multiplied a second time.
- **FULLY_CONNECTED:** `output_elements × input_depth` MACs, with weights `[units, input_depth]`. Flattened batch size and output unit dimensions are validated; `keep_num_dims` is honored. Packed/shuffled weight formats return unknown.
- **BATCH_MATMUL:** `broadcast_batch_elements × M × N × K` MACs. Both adjoint flags, the contraction dimension, and right-aligned batch broadcasting are checked against the output shape.
- Each of those four operators reports `flops = 2 × macs`.
- **ADD, SUB, MUL, DIV:** one arithmetic operation per broadcast output element; no MACs. **SQUARED_DIFFERENCE:** two per output element. Broadcast dimensions must match.
- **Data rearrangement/copy operators:** zero numeric arithmetic, with status `zero_arithmetic`. These include reshape, squeeze/expand, transpose, concat/split, slice, pack/unpack, pad, tile, gather, space/depth transforms, broadcast/fill, select, and nearest-neighbor resize. Index and coordinate arithmetic is excluded. Zero arithmetic emphatically does not mean zero memory work or zero latency.

Convolution uses the **dense padded-kernel convention**: every output is assigned a full filter's worth of MACs, including boundary locations whose samples are padding zeros. A reference kernel can skip such work, and an optimized kernel can perform a different schedule. Stride and dilation are reflected in the stored output dimensions, not by adding or removing filter taps. Sparse tensors receive a clearly labeled dense-equivalent estimate; sparsity does not reduce counts.

Other operators, custom ops, unsupported dtypes, invalid formula shapes, and unresolved dimensions return `macs: null` and `flops: null`, with a reason. These nodes are excluded from subtotals. There is no fallback that silently treats unknown operations as zero. In particular, pooling, softmax/logistic, general reductions, detection postprocessing, and control flow currently have no formula.

## Shapes, graph scope, and coverage

The analyzer preserves every operator's serialized input and output tensor index, name, shape, shape signature, dtype, and constant/variable/sparse metadata. An optional input index `-1` becomes JSON `null`. A dynamic shape signature containing `-1` invalidates an arithmetic estimate even if the model also stores a concrete default shape. A data-movement-only node can still have zero *numeric* arithmetic without resolved dimensions.

All serialized subgraphs are reported. Each node is counted once; `index` is local to its subgraph and `globalIndex` uniquely addresses the flattened operator list. Subgraphs expose their own summaries. The top-level subtotal is a graph inventory, not an execution-path sum: branches may be mutually exclusive, loops may repeat, and functions may be called several times. Such behavior is not modeled.

The summary reports:

- `knownMacs`, `knownFlops`: sums of implemented core-arithmetic estimates only
- `estimatedOperatorCount`, `unknownOperatorCount`, `zeroArithmeticOperatorCount`
- `operatorCoveragePercent`: known operator nodes divided by all nodes, including zero-arithmetic nodes
- `unknownOperators`: names/counts omitted from the arithmetic subtotal
- `isPartial`: whether any node lacks an estimate

Node coverage is **not** the percentage of total model FLOPs or latency covered. Even 100% node coverage would not include the excluded costs above. Model byte length and SHA-256 identify the exact analyzed file. JSON deliberately contains no operator runtime-duration field.

## Sources

The lightweight [tflite 2.18.0 parser](https://pypi.org/project/tflite/2.18.0/) packages generated Python accessors from the TensorFlow schema. It is an independently maintained package, not a TensorFlow inference runtime.

Shape conventions and operator options are checked against the [TensorFlow v2.18.0 schema](https://github.com/tensorflow/tensorflow/blob/v2.18.0/tensorflow/compiler/mlir/lite/schema/schema.fbs), the [reference convolution implementation](https://github.com/tensorflow/tensorflow/blob/v2.18.0/tensorflow/lite/kernels/internal/reference/conv.h), and the [batch-matmul implementation](https://github.com/tensorflow/tensorflow/blob/v2.18.0/tensorflow/lite/kernels/batch_matmul.cc). The formulas above are this analyzer's explicit counting convention derived from tensor dimensions, rather than a reported performance claim from those sources.

For genuine node timing, use a runtime profiler such as TensorFlow Lite's [native benchmark tooling](https://github.com/tensorflow/tensorflow/tree/v2.18.0/tensorflow/lite/tools/benchmark) and inspect delegate/fusion behavior. Its results are device- and runtime-specific and should not be substituted for the browser's measured latency.

## MiniLM int32 boundary adaptation

The downloaded MiniLM graph exposes two INT64 inputs. `scripts/adapt_minilm.py` adapts this exact model to the browser API's int32 input boundary without retraining, changing weights, or adding/removing operators. It requires original SHA-256 `4735aa32b76f79d31b91a5326c7cde363ee87c13f650794729d0f3c3298b7673` and refuses other files.

Only four one-byte tensor dtype fields change:

- Input tensor 0: INT64 → INT32. Its existing CAST already outputs INT32 tensor 220.
- Input tensor 1: INT64 → INT32. Its two consumers are RESHAPEs.
- Those RESHAPE outputs, tensors 242 and 896: INT64 → INT32. Their existing CASTs still output FLOAT32 tensors 243 and 897.

All affected CASTs have no explicit `CastOptions` table; their input/output types come from tensor metadata. The adapter validates the exact consumers and rejects any unexpected topology or explicit CAST options. All other bytes, including every trained weight and every operator, are verified unchanged. The int32 model SHA-256 is `49ed146ee8deeb7dfd0da0bc65c66b6642804420263a62b63db104d4fcc79adc`.

This preserves values for valid int32-range token IDs and binary attention masks, shape `[1,128]`. It is not a general transformation for arbitrary INT64 values. The [CAST implementation](https://github.com/tensorflow/tensorflow/blob/v2.18.0/tensorflow/lite/kernels/cast.cc) dispatches on tensor dtypes.

Reproduce the patch and native equivalence check:

```sh
python -m pip install ai-edge-litert==2.1.0 numpy==2.2.6
python scripts/adapt_minilm.py --verify-runtime
python scripts/analyze_tflite.py public/models/minilm-int32.tflite
python -m unittest discover -s tests -p 'test_*.py' -v
```

The native validation uses one CPU thread and four deterministic cases: a padded short input, a full sequence, all padding, and a gapped attention mask. Original and adapted `[1,384]` outputs were finite and bit-for-bit identical in all four cases (maximum absolute difference 0). This verifies the boundary adaptation in native LiteRT, not browser performance or model accuracy. The `.adaptation.json` records patch offsets, hashes, and validation results. The browser uses the adapted model's own `.graph.json`, so its file hash and input dtype metadata agree.
