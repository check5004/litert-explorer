"""Small safety tests for the deliberately model-specific boundary adapter.

The full reproducible native comparison is scripts/adapt_minilm.py --verify-runtime.
"""

import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "adapt_minilm.py"
spec = importlib.util.spec_from_file_location("adapt_minilm", SCRIPT)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterSafetyTests(unittest.TestCase):
    def test_refuses_unknown_model_before_parsing(self):
        with self.assertRaisesRegex(ValueError, "Refusing an unrecognized model"):
            adapter.adapt(b"not the pinned original model")

    def test_cli_keeps_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "original.tflite"
            path.write_bytes(b"original bytes")
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                adapter.main([str(path), "--output", str(path)])
            self.assertEqual(error.exception.code, 2)
            self.assertEqual(path.read_bytes(), b"original bytes")

    def test_unknown_model_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "source.tflite", Path(directory) / "output.tflite"
            source.write_bytes(b"original bytes")
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(adapter.main([str(source), "--output", str(output)]), 1)
            self.assertFalse(output.exists())
            self.assertEqual(source.read_bytes(), b"original bytes")


if __name__ == "__main__":
    unittest.main()
