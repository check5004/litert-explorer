# Detection preprocessing and postprocessing

The exact model is Google's efficientdet_lite0/float32/1 asset with SHA256 40338edf5ec70d43e318b0a716a84d4564cd1802759a7a07170c7e43796dbf58.

The model's embedded M001 metadata declares RGB normalization mean=127.5, std=127.5. We resize/stretch the whole image to 320×320 using browser Canvas, discard alpha, and calculate (channel−127.5)/127.5. This is a deliberately simple educational resize policy. The normalized output boxes map directly back to the original stretched image; no hidden crop or letterbox offset is assumed.

Outputs are output_1 [1,19206,90] class probabilities and output_0 [1,19206,4] deltas. Scores already passed LOGISTIC in the graph. We DO NOT sigmoid again.

The M001 metadata embeds a V001 ObjectDetectorOptions FlatBuffer containing all19,206 fixed anchors. We extract every float exactly; we do not guess anchor_scale/grid rounding/order from another EfficientDet release. Anchors are [xCenter,yCenter,width,height]. Metadata declares x/y/w/h scales all1, exponential box size true, sigmoid_score false. Raw boxes are [dy,dx,dh,dw]. Decode:

- cy = dy × anchorHeight + anchorY
- cx = dx × anchorWidth + anchorX
- height = exp(dh) × anchorHeight
- width = exp(dw) × anchorWidth
- convert centers/sizes to [ymin,xmin,ymax,xmax], then clip for image display

The app selects the highest-scoring class per anchor, filters by the UI threshold, ignores COCO gap labels (???), and applies same-class greedy NMS at IoU0.5, capped at20 boxes. This is an explicitly inspectable educational postprocessing policy, not a claim of exact parity with every MediaPipe task option. Clip-before-NMS is the app's chosen policy. Labels come from the90-line labels.txt ZIP attachment inside the model, with zero-based index. Multiple boxes of the same class are allowed if IoU is below threshold.

Reproduce metadata/labels with `python scripts/extract_detector_metadata.py` (Python stdlib only, hash-pinned model and bounds controlled by expected source). The committed efficientdet-anchors.json and labels.txt are included in source-only distribution so no Python setup is needed to run.

Independent audit parsed every anchor and normalization parameter separately and matched all floats. Four generated scenes produced actual model detections for laptop/book/cup, person/bicycle, dog/couch, and banana/apple/orange/bowl. These are useful smoke checks, not a labeled validation dataset or accuracy claim. Browser resizing/runtime behavior has not been executed in this restricted environment; Node SDK integration used sharp/Pillow resize and is reported separately.

Sources:
- https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/tasks/metadata/object_detector_metadata_schema.fbs
- https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/tasks/metadata/metadata_schema.fbs
- https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/calculators/tensor/tensors_to_detections_calculator.cc
- https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector
