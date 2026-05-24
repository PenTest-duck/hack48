from __future__ import annotations

import shutil
import sys
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp


POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)

HAND_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)


def default_pose_model_path() -> Path:
    return Path(__file__).resolve().parents[1] / "models" / "pose_landmarker_lite.task"


def default_hand_model_path() -> Path:
    return Path(__file__).resolve().parents[1] / "models" / "hand_landmarker.task"


def ensure_model(model_path: Path, *, url: str) -> Path:
    model_path = model_path.expanduser().resolve()
    if model_path.exists():
        return model_path

    model_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = model_path.with_suffix(model_path.suffix + ".tmp")
    print(f"Downloading MediaPipe model to {model_path}")
    tmp_path.unlink(missing_ok=True)
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            with tmp_path.open("wb") as output:
                shutil.copyfileobj(response, output)
        tmp_path.replace(model_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    return model_path


def open_camera(camera_index: int, width: int, height: int) -> cv2.VideoCapture:
    default_backend = getattr(cv2, "CAP_ANY", 0)
    api_preference = (
        getattr(cv2, "CAP_AVFOUNDATION", default_backend)
        if sys.platform == "darwin"
        else default_backend
    )
    capture = cv2.VideoCapture(camera_index, api_preference)
    if not capture.isOpened():
        raise RuntimeError(
            f"Could not open camera index {camera_index}. "
            "On macOS, make sure the terminal app has camera permission."
        )

    capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    for _ in range(5):
        capture.read()
    return capture


def frame_to_mp_image(frame) -> mp.Image:
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
