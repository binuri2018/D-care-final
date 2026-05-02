Dementia action — local model weights (not committed for .pt when using repo defaults)

Expected files (names overridable via env — see backend/dementia_action_subsystem/config.py):
  • yolov8n-pose.pt          — YOLOv8-pose checkpoint (or set DEMENTIA_ACTION_YOLO_POSE)
  • action_lstm_model.keras  — sequence classifier (or set DEMENTIA_ACTION_LSTM_MODEL)

Override directory only:
  DEMENTIA_ACTION_MODEL_DIR=/path/to/dir

Place weights here for out-of-the-box runs, or point DEMENTIA_ACTION_MODEL_DIR elsewhere.
