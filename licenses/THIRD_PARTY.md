# Third-party provenance

- @litertjs/core 2.5.3 and @litertjs/wasm-utils 2.5.3: Google, Apache-2.0. https://github.com/google-ai-edge/LiteRT/tree/main/litert/js
- @huggingface/transformers 3.7.2 tokenizer: Hugging Face, Apache-2.0. Bundled third-party notices are copied into the published licenses directory. The dependency lockfile identifies the exact versions. ONNX Runtime (MIT) is bundled transitively but not used for inference; no ONNX models are loaded.
- Original multilingual MiniLM weights/tokenizer: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2, Apache-2.0. https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
- Converted MiniLM TFLite: Bombek1/paraphrase-multilingual-MiniLM-L12-v2-litert, model card declares Apache-2.0. Pinned revision b1552e06378f402cc061a6e0c1162f651a727778. https://huggingface.co/Bombek1/paraphrase-multilingual-MiniLM-L12-v2-litert
- EfficientDet-Lite0: Google MediaPipe pretrained object detector, Apache-2.0; float32/1 model from https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite . Background: https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector
- Detection decoder follows model metadata and MediaPipe decoding conventions; see docs/detection-model.md for exact sources.
- Tokenizer revision e8f8c211226b894fcb81acc59f3b34ba3efd5f42. Downloaded JSON content unchanged. Model input boundary adapted as documented, exactly four dtype bytes; original weights preserved.
- Four demo PNGs were generated for this PoC using OpenAI image generation, not downloaded stock images. They are synthetic examples, not ground truth. Prompts and creation provenance: public/samples/provenance.json.
- New application code in this package: MIT. See LICENSE.

An Apache 2.0 license copy is included as Apache-2.0.txt. The bundled @huggingface/jinja MIT text is included in HuggingFace-Jinja-MIT.txt and ONNX Runtime MIT text in ONNX-Runtime-MIT.txt; esbuild legal comments are retained. Consult npm package distributions for development-only dependency licenses.

## EfficientDet model-license provenance

A MediaPipe maintainer clarified that the project's source and models, unless specifically noted otherwise, are Apache-2.0: https://github.com/google-ai-edge/mediapipe/issues/6355 . Google's current web sample uses this exact EfficientDet float32/1 asset: https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/object-detector.ts . No separate artifact-specific model-card license field is embedded in this TFLite file; its author field is MediaPipe. We preserve the exact SHA-256 in the download script and model metadata extraction. No exception was identified for this asset.
