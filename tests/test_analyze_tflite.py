"""Arithmetic, malformed-input and actual FlatBuffer round-trip tests.

Run: python -m unittest discover -s tests -p 'test_analyze_tflite.py' -v
"""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "analyze_tflite.py"
spec = importlib.util.spec_from_file_location("analyze_tflite", SCRIPT)
analyzer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyzer)


def tensor(shape, dtype="FLOAT32", **kwargs):
    return {"shape": shape, "dtype": dtype, "shapeSignature": [], "rankKnown": True, **kwargs}


def estimate(name, lhs, rhs, out, options=None):
    return analyzer.estimate_operator(name, [tensor(lhs), tensor(rhs)], [tensor(out)], options)


def build_model(optional_bias=True, invalid_input=False, custom=False):
    """Build a genuine tiny TFL3 graph, without TensorFlow or model conversion."""
    import flatbuffers
    import tflite as t
    b = flatbuffers.Builder(1024)

    def int_vector(start, values):
        start(b, len(values))
        for value in reversed(values):
            b.PrependInt32(value)
        return b.EndVector()

    def offset_vector(start, values):
        start(b, len(values))
        for value in reversed(values):
            b.PrependUOffsetTRelative(value)
        return b.EndVector()

    tensors = []
    for i, shape in enumerate(([1, 4], [3, 4], [1, 3])):
        name = b.CreateString(f"tensor_{i}")
        shape_offset = int_vector(t.TensorStartShapeVector, shape)
        t.TensorStart(b)
        t.TensorAddName(b, name)
        t.TensorAddShape(b, shape_offset)
        t.TensorAddType(b, t.TensorType.FLOAT32)
        t.TensorAddBuffer(b, 0)
        t.TensorAddHasRank(b, True)
        tensors.append(t.TensorEnd(b))
    tensor_vector = offset_vector(t.SubGraphStartTensorsVector, tensors)
    ins = [999 if invalid_input else 0, 1] + ([-1] if optional_bias else [])
    input_vector = int_vector(t.OperatorStartInputsVector, ins)
    output_vector = int_vector(t.OperatorStartOutputsVector, [2])
    t.OperatorStart(b)
    t.OperatorAddInputs(b, input_vector)
    t.OperatorAddOutputs(b, output_vector)
    t.OperatorAddOpcodeIndex(b, 0)
    operator = t.OperatorEnd(b)
    operator_vector = offset_vector(t.SubGraphStartOperatorsVector, [operator])
    graph_inputs = int_vector(t.SubGraphStartInputsVector, [0])
    graph_outputs = int_vector(t.SubGraphStartOutputsVector, [2])
    t.SubGraphStart(b)
    t.SubGraphAddTensors(b, tensor_vector)
    t.SubGraphAddOperators(b, operator_vector)
    t.SubGraphAddInputs(b, graph_inputs)
    t.SubGraphAddOutputs(b, graph_outputs)
    graph = t.SubGraphEnd(b)
    custom_name = b.CreateString("TestUnknown") if custom else None
    code = t.BuiltinOperator.CUSTOM if custom else t.BuiltinOperator.FULLY_CONNECTED
    t.OperatorCodeStart(b)
    t.OperatorCodeAddBuiltinCode(b, code)
    t.OperatorCodeAddDeprecatedBuiltinCode(b, code)
    if custom_name:
        t.OperatorCodeAddCustomCode(b, custom_name)
    opcode = t.OperatorCodeEnd(b)
    t.BufferStart(b)
    buffer = t.BufferEnd(b)
    graphs = offset_vector(t.ModelStartSubgraphsVector, [graph])
    opcodes = offset_vector(t.ModelStartOperatorCodesVector, [opcode])
    buffers = offset_vector(t.ModelStartBuffersVector, [buffer])
    t.ModelStart(b)
    t.ModelAddVersion(b, 3)
    t.ModelAddSubgraphs(b, graphs)
    t.ModelAddOperatorCodes(b, opcodes)
    t.ModelAddBuffers(b, buffers)
    model = t.ModelEnd(b)
    b.Finish(model, file_identifier=b"TFL3")
    return bytes(b.Output())


class ArithmeticTests(unittest.TestCase):
    def test_convolution(self):
        result = estimate("CONV_2D", [2, 7, 7, 3], [8, 3, 3, 3], [2, 5, 5, 8])
        self.assertEqual(result["macs"], 2 * 5 * 5 * 8 * 3 * 3 * 3)
        self.assertEqual(result["flops"], 2 * result["macs"])

    def test_grouped_convolution_uses_filter_input_depth(self):
        result = estimate("CONV_2D", [1, 6, 6, 8], [12, 3, 3, 4], [1, 4, 4, 12])
        self.assertEqual(result["macs"], 1 * 4 * 4 * 12 * 3 * 3 * 4)
        self.assertTrue(any("2 groups" in n for n in result["notes"]))

    def test_bad_grouped_convolution_is_unknown(self):
        self.assertIsNone(estimate("CONV_2D", [1, 6, 6, 8], [11, 3, 3, 4], [1, 4, 4, 11])["macs"])

    def test_depthwise_does_not_multiply_by_input_depth(self):
        result = estimate("DEPTHWISE_CONV_2D", [2, 8, 8, 3], [1, 3, 3, 6], [2, 8, 8, 6], {"depthMultiplier": 2})
        self.assertEqual(result["macs"], 2 * 8 * 8 * 6 * 3 * 3)

    def test_depth_multiplier_mismatch(self):
        result = estimate("DEPTHWISE_CONV_2D", [1, 8, 8, 3], [1, 3, 3, 6], [1, 8, 8, 6], {"depthMultiplier": 1})
        self.assertIsNone(result["macs"])

    def test_bad_conv_rank(self):
        self.assertIsNone(estimate("CONV_2D", [5, 3], [3, 3], [5, 3])["macs"])

    def test_fully_connected(self):
        self.assertEqual(estimate("FULLY_CONNECTED", [2, 4], [3, 4], [2, 3])["macs"], 24)

    def test_fully_connected_flattens(self):
        self.assertEqual(estimate("FULLY_CONNECTED", [2, 2, 2, 4], [3, 4], [8, 3])["macs"], 96)

    def test_fully_connected_keep_num_dims(self):
        result = estimate("FULLY_CONNECTED", [2, 3, 4], [5, 4], [2, 3, 5], {"keepNumDims": True})
        self.assertEqual(result["macs"], 120)

    def test_fully_connected_bad_batches(self):
        self.assertIsNone(estimate("FULLY_CONNECTED", [2, 4], [3, 4], [3, 3])["macs"])

    def test_fully_connected_packed_unknown(self):
        self.assertIsNone(estimate("FULLY_CONNECTED", [2, 4], [3, 4], [2, 3], {"weightsFormat": 1})["macs"])

    def test_matmul(self):
        self.assertEqual(estimate("BATCH_MATMUL", [3, 4], [4, 5], [3, 5])["macs"], 60)

    def test_batched_matmul_broadcast(self):
        self.assertEqual(estimate("BATCH_MATMUL", [2, 1, 3, 4], [1, 7, 4, 5], [2, 7, 3, 5])["macs"], 840)

    def test_matmul_adjoint(self):
        result = estimate("BATCH_MATMUL", [2, 4, 3], [2, 5, 4], [2, 3, 5], {"adjX": True, "adjY": True})
        self.assertEqual(result["macs"], 120)

    def test_bad_matmul_contraction(self):
        self.assertIsNone(estimate("BATCH_MATMUL", [3, 4], [3, 5], [3, 5])["macs"])

    def test_bad_matmul_broadcast(self):
        self.assertIsNone(estimate("BATCH_MATMUL", [2, 3, 4], [7, 4, 5], [7, 3, 5])["macs"])

    def test_broadcast_zero_dimension(self):
        self.assertEqual(estimate("MUL", [0, 3], [1, 3], [0, 3])["flops"], 0)

    def test_elementwise(self):
        self.assertEqual(estimate("ADD", [2, 3], [3], [2, 3])["flops"], 6)
        self.assertEqual(estimate("SQUARED_DIFFERENCE", [2, 3], [3], [2, 3])["flops"], 12)

    def test_scalar_elementwise(self):
        self.assertEqual(estimate("MUL", [], [], [])["flops"], 1)

    def test_bad_elementwise_broadcast(self):
        self.assertIsNone(estimate("ADD", [2, 3], [4], [2, 3])["flops"])

    def test_quantized_is_labeled_equivalent(self):
        result = analyzer.estimate_operator("FULLY_CONNECTED", [tensor([2, 4], "INT8"), tensor([3, 4], "INT8")], [tensor([2, 3], "INT8")])
        self.assertEqual(result["macs"], 24)
        self.assertEqual(result["arithmeticKind"], "integer_or_mixed_equivalent")

    def test_complex_is_unknown(self):
        result = analyzer.estimate_operator("MUL", [tensor([2], "COMPLEX64"), tensor([2], "COMPLEX64")], [tensor([2], "COMPLEX64")])
        self.assertIsNone(result["flops"])

    def test_dynamic_signature_overrides_default_shape(self):
        result = analyzer.estimate_operator("FULLY_CONNECTED", [tensor([1, 4], shapeSignature=[-1, 4]), tensor([3, 4])], [tensor([1, 3])])
        self.assertIsNone(result["macs"])

    def test_unknown_rank(self):
        result = analyzer.estimate_operator("ADD", [tensor([], rankKnown=False), tensor([])], [tensor([])])
        self.assertIsNone(result["flops"])

    def test_sparse_is_dense_equivalent(self):
        result = analyzer.estimate_operator("FULLY_CONNECTED", [tensor([1, 4]), tensor([3, 4], isSparse=True)], [tensor([1, 3])])
        self.assertEqual(result["macs"], 12)
        self.assertTrue(any("Dense-equivalent" in n for n in result["notes"]))

    def test_data_movement_zero_is_explained(self):
        result = analyzer.estimate_operator("RESHAPE", [tensor([2, 3])], [tensor([6])])
        self.assertEqual(result["flops"], 0)
        self.assertEqual(result["estimateStatus"], "zero_arithmetic")
        self.assertTrue(any("runtime cost is not zero" in n for n in result["notes"]))

    def test_unsupported_is_null_not_zero(self):
        result = analyzer.estimate_operator("SOFTMAX", [tensor([3])], [tensor([3])])
        self.assertIsNone(result["macs"])
        self.assertIsNone(result["flops"])

    def test_summary_coverage_is_operator_count(self):
        known = {"name": "CONV_2D", **estimate("CONV_2D", [1, 4, 4, 1], [1, 1, 1, 1], [1, 4, 4, 1])}
        unknown = {"name": "SOFTMAX", **analyzer._unknown("unimplemented")}
        summary = analyzer._summarize([known, unknown])
        self.assertEqual(summary["knownMacs"], 16)
        self.assertEqual(summary["operatorCoveragePercent"], 50)
        self.assertEqual(summary["unknownOperators"], {"SOFTMAX": 1})
        self.assertTrue(summary["isPartial"])


class FlatbufferTests(unittest.TestCase):
    def test_parses_model_and_optional_input(self):
        result = analyzer.analyze_bytes(build_model(), "tiny.tflite")
        self.assertEqual(result["model"]["filename"], "tiny.tflite")
        self.assertEqual(result["summary"]["knownMacs"], 12)
        self.assertEqual(result["summary"]["knownFlops"], 24)
        self.assertFalse(result["analysis"]["runtimeProfiling"])
        self.assertIsNone(result["operators"][0]["inputs"][2])
        self.assertEqual(result["operators"][0]["outputs"][0]["dtype"], "FLOAT32")
        json.dumps(result, allow_nan=False)

    def test_custom_operator_is_unknown(self):
        result = analyzer.analyze_bytes(build_model(custom=True))
        self.assertEqual(result["operators"][0]["name"], "CUSTOM:TestUnknown")
        self.assertEqual(result["summary"]["unknownOperatorCount"], 1)
        self.assertIsNone(result["operators"][0]["macs"])

    def test_invalid_tensor_ref_rejected(self):
        with self.assertRaises(analyzer.AnalysisError):
            analyzer.analyze_bytes(build_model(invalid_input=True))

    def test_identifier_rejected(self):
        with self.assertRaises(analyzer.AnalysisError):
            analyzer.analyze_bytes(b"not a model")

    def test_truncated_model_rejected(self):
        with self.assertRaises(analyzer.AnalysisError):
            analyzer.analyze_bytes(build_model()[:24])

    def test_cli_json_file(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "tiny.tflite"
            source.write_bytes(build_model())
            self.assertEqual(analyzer.main([str(source)]), 0)
            result = json.loads(source.with_suffix(".graph.json").read_text())
            self.assertEqual(result["summary"]["knownMacs"], 12)

    def test_cli_missing_file_returns_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(analyzer.main([str(Path(directory) / "missing.tflite")]), 1)


if __name__ == "__main__":
    unittest.main()
