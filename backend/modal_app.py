from __future__ import annotations

import hashlib
import json
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Literal

import modal

from backend.artifacts import detected_object_summary, normalize_sam_prompts
from backend.contracts import ANALYSIS_KINDS, AnalysisKind, AnalysisRequest
from backend.modal_inference.hand_landmarks import ensure_hand_model, infer_hands
from backend.modal_inference.media import (
    bounded_max_frames,
    is_video_suffix,
    output_json as write_output_json,
    write_media_bytes,
)
from backend.modal_inference.ultralytics_results import result_to_record
from backend.orchestrator import (
    fetch_context,
    mark_job,
    run_gemini,
    run_remote_analyzer,
    update_final_status,
    utc_now,
)
from backend.supabase_api import SupabaseApi, SupabaseConfig

try:
    from fastapi import Request
except ImportError:
    Request = Any


APP_NAME = "hack48-backend-analysis"
MODEL_VOLUME_NAME = "hack48-modal-inference-models"
MODEL_ROOT = "/models"
SECRET_NAME = "hack48-backend-secrets"

THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parent
BACKEND_PACKAGE_DIR = THIS_DIR / "backend"
TAS_SOURCE_DIR = (
    REPO_ROOT
    / "playground"
    / "temporal_action_segmentation"
    / "temporal_action_segmentation"
)

app = modal.App(APP_NAME)
model_volume = modal.Volume.from_name(MODEL_VOLUME_NAME, create_if_missing=True)
backend_secret = modal.Secret.from_name(SECRET_NAME)

base_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libegl1", "libgles2", "libglib2.0-0", "libgl1")
    .pip_install(
        "httpx>=0.28.0",
        "numpy>=2.2.0",
        "opencv-python-headless>=4.13.0.92",
        "pydantic>=2.7.0",
    )
)

yolo_image = base_image.pip_install("ultralytics>=8.4.53").add_local_dir(
    BACKEND_PACKAGE_DIR,
    remote_path="/root/backend",
    ignore=["**/__pycache__/**", "**/.pytest_cache/**"],
)

sam_image = base_image.pip_install(
    "ultralytics>=8.4.53",
    "git+https://github.com/ultralytics/CLIP.git",
    "timm>=1.0.0",
).add_local_dir(
    BACKEND_PACKAGE_DIR,
    remote_path="/root/backend",
    ignore=["**/__pycache__/**", "**/.pytest_cache/**"],
)

mediapipe_runtime_image = base_image.pip_install("mediapipe>=0.10.35")

mediapipe_image = mediapipe_runtime_image.add_local_dir(
    BACKEND_PACKAGE_DIR,
    remote_path="/root/backend",
    ignore=["**/__pycache__/**", "**/.pytest_cache/**"],
)

tas_runtime_image = mediapipe_runtime_image.pip_install("google-genai>=1.0.0")

tas_image = (
    tas_runtime_image.add_local_dir(
        BACKEND_PACKAGE_DIR,
        remote_path="/root/backend",
        ignore=["**/__pycache__/**", "**/.pytest_cache/**"],
    )
    .add_local_dir(
        TAS_SOURCE_DIR,
        remote_path="/root/temporal_action_segmentation",
        ignore=["**/__pycache__/**", "**/.pytest_cache/**"],
    )
)

orchestrator_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "httpx>=0.28.0",
        "google-genai>=1.0.0",
        "fastapi[standard]>=0.115.0",
        "pydantic>=2.7.0",
        "python-dotenv>=1.0.1",
    )
    .add_local_dir(
        BACKEND_PACKAGE_DIR,
        remote_path="/root/backend",
        ignore=["**/__pycache__/**", "**/.pytest_cache/**"],
    )
)

REMOTE_ANALYSIS_KINDS: tuple[AnalysisKind, ...] = (
    "yolo_objects",
    "mediapipe_hands",
    "sam_segments",
    "temporal_actions",
)


def _cuda_device() -> int | str:
    import torch

    return 0 if torch.cuda.is_available() else "cpu"


def _upload_output(payload: object, output_path: str) -> None:
    if output_path:
        write_output_json(Path(output_path).expanduser().resolve(), payload)
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=True))


class _GeminiTemporalLabel:
    def __init__(
        self,
        *,
        meaningful_manipulation: bool,
        caption: str,
        object_name: str | None,
        confidence: float,
        reason: str,
    ) -> None:
        self.meaningful_manipulation = meaningful_manipulation
        self.caption = caption
        self.object_name = object_name
        self.confidence = confidence
        self.reason = reason

    def as_record(self) -> dict[str, object]:
        return {
            "meaningful_manipulation": self.meaningful_manipulation,
            "caption": self.caption,
            "object": self.object_name,
            "confidence": self.confidence,
            "reason": self.reason,
        }


class GeminiTemporalLabeler:
    def __init__(self, *, model: str, cache_dir: Path) -> None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is required for temporal action labelling.")

        from google import genai

        self.model = model
        self.client = genai.Client(api_key=api_key)
        self.cache_dir = cache_dir.expanduser().resolve()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def label(self, segment: object, contact_sheet_path: Path) -> _GeminiTemporalLabel:
        cache_path = self._cache_path(segment, contact_sheet_path)
        if cache_path.exists():
            cached = json.loads(cache_path.read_text())
            return self._normalize(cached["label"])

        from google.genai import types

        image_bytes = contact_sheet_path.read_bytes()
        response = self.client.models.generate_content(
            model=self.model,
            contents=[
                self._prompt(segment),
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
            ],
            config=types.GenerateContentConfig(
                temperature=0,
                response_mime_type="application/json",
            ),
        )
        text = getattr(response, "text", None)
        if not text:
            raise RuntimeError("Gemini returned an empty temporal action label.")

        payload = _extract_json_object(text)
        label = self._normalize(payload)
        cache_path.write_text(
            json.dumps(
                {
                    "model": self.model,
                    "prompt_version": "tas-gemini-v1",
                    "label": label.as_record(),
                    "raw_response": text,
                },
                ensure_ascii=True,
                indent=2,
            )
        )
        return label

    def _cache_path(self, segment: object, contact_sheet_path: Path) -> Path:
        digest = hashlib.sha256()
        digest.update(b"tas-gemini-v1")
        digest.update(self.model.encode("utf-8"))
        digest.update(str(getattr(segment, "hand", "")).encode("utf-8"))
        digest.update(str(getattr(segment, "start_frame", "")).encode("ascii"))
        digest.update(str(getattr(segment, "end_frame", "")).encode("ascii"))
        digest.update(contact_sheet_path.read_bytes())
        return self.cache_dir / f"{digest.hexdigest()}.json"

    def _prompt(self, segment: object) -> str:
        hand = getattr(segment, "hand", "tracked")
        start_sec = float(getattr(segment, "start_sec", 0.0))
        end_sec = float(getattr(segment, "end_sec", 0.0))
        return f"""You are annotating egocentric hand-manipulation video clips.
The contact sheet shows sampled frames from one short clip, with a colored trajectory marking the {hand} hand.
Describe only the action performed by that hand.
Use an imperative robot-instruction style, for example "Pick up the mug", "Open the drawer", "Wipe the counter".

Return strict JSON only:
{{
  "meaningful_manipulation": true,
  "caption": "short imperative caption or N/A",
  "object": "object name or null",
  "confidence": 0.0,
  "reason": "short reason"
}}

Rules:
- If the hand is idle, gesturing, occluded, or not manipulating an object, return meaningful_manipulation false and caption "N/A".
- Prefer short atomic actions.
- Do not describe camera motion.
- Do not invent objects that are not visible.
- The clip spans {start_sec:.2f}s to {end_sec:.2f}s in the source video."""

    def _normalize(self, payload: dict[str, object]) -> _GeminiTemporalLabel:
        meaningful = bool(payload.get("meaningful_manipulation", False))
        caption = str(payload.get("caption") or "N/A").strip()
        if not meaningful:
            caption = "N/A"

        raw_confidence = payload.get("confidence", 0.0) or 0.0
        confidence = min(1.0, max(0.0, float(raw_confidence)))
        raw_object = payload.get("object")
        object_name = None if raw_object in ("", "null", None) else str(raw_object)

        return _GeminiTemporalLabel(
            meaningful_manipulation=meaningful,
            caption=caption,
            object_name=object_name,
            confidence=confidence,
            reason=str(payload.get("reason") or ""),
        )


def _extract_json_object(text: str) -> dict[str, object]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"Could not find JSON object in Gemini response: {text[:200]}")
    return json.loads(stripped[start : end + 1])


@app.cls(
    image=yolo_image,
    gpu=["L4", "T4", "A10"],
    volumes={MODEL_ROOT: model_volume},
    timeout=15 * 60,
    scaledown_window=60,
    max_containers=2,
)
class Yolo26:
    @modal.enter()
    def setup(self) -> None:
        self._models = {}

    def _model(self, task: str):
        from ultralytics import YOLO

        filenames = {
            "detect": "yolo26n.pt",
            "instance": "yolo26n-seg.pt",
        }
        if task not in filenames:
            raise ValueError("YOLO26 task must be 'detect' or 'instance'.")

        filename = filenames[task]
        if filename in self._models:
            return self._models[filename], filename

        model_dir = Path(MODEL_ROOT) / "yolo"
        model_dir.mkdir(parents=True, exist_ok=True)
        model_path = model_dir / filename
        if model_path.exists():
            model = YOLO(str(model_path))
        else:
            old_cwd = Path.cwd()
            os.chdir(model_dir)
            try:
                model = YOLO(filename)
                if model_path.exists():
                    model_volume.commit()
                    model = YOLO(str(model_path))
            finally:
                os.chdir(old_cwd)
        self._models[filename] = model
        return model, filename

    @modal.method()
    def predict(
        self,
        media: bytes,
        *,
        suffix: str = ".mp4",
        task: Literal["detect", "instance"] = "detect",
        conf: float = 0.25,
        imgsz: int = 640,
        vid_stride: int = 1,
        max_frames: int | None = 300,
    ) -> dict[str, object]:
        with tempfile.TemporaryDirectory() as tmp:
            input_path = write_media_bytes(media, Path(tmp), suffix)
            model, filename = self._model(task)
            results = model.predict(
                source=str(input_path),
                stream=True,
                conf=conf,
                imgsz=imgsz,
                vid_stride=max(1, vid_stride),
                device=_cuda_device(),
                verbose=False,
            )

            frames = []
            limit = bounded_max_frames(max_frames)
            for frame_index, result in enumerate(results):
                if limit is not None and frame_index >= limit:
                    break
                frames.append(
                    result_to_record(
                        result,
                        frame_index,
                        include_masks=task == "instance",
                    )
                )

        return {
            "engine": "ultralytics-yolo26",
            "task": task,
            "model": filename,
            "frame_count": len(frames),
            "frames": frames,
            "settings": {"conf": conf, "imgsz": imgsz, "vid_stride": max(1, vid_stride)},
        }


@app.cls(
    image=sam_image,
    gpu=["L4", "A10", "L40S"],
    volumes={MODEL_ROOT: model_volume},
    timeout=20 * 60,
    scaledown_window=60,
    max_containers=1,
)
class SAM31Segmenter:
    @modal.enter()
    def setup(self) -> None:
        self._predictors = {}

    def _checkpoint_path(self, model_path: str | None) -> Path:
        path = Path(model_path or os.environ.get("SAM31_MODEL_PATH", f"{MODEL_ROOT}/sam/sam3.pt"))
        if not path.exists():
            raise FileNotFoundError(
                "SAM 3.1 checkpoint not found. Upload it to the Modal Volume, for example: "
                f"modal volume put {MODEL_VOLUME_NAME} /path/to/sam3.pt /sam/sam3.pt"
            )
        return path

    def _predictor(self, *, video: bool, checkpoint: Path, conf: float, imgsz: int):
        key = (video, str(checkpoint), conf, imgsz)
        if key in self._predictors:
            return self._predictors[key]

        overrides = {
            "conf": conf,
            "task": "segment",
            "mode": "predict",
            "model": str(checkpoint),
            "imgsz": imgsz,
            "half": True,
            "verbose": False,
        }
        if video:
            from ultralytics.models.sam import SAM3VideoSemanticPredictor

            predictor = SAM3VideoSemanticPredictor(overrides=overrides)
            self._predictors[key] = predictor
            return predictor

        from ultralytics.models.sam import SAM3SemanticPredictor

        predictor = SAM3SemanticPredictor(overrides=overrides)
        self._predictors[key] = predictor
        return predictor

    @modal.method()
    def segment(
        self,
        media: bytes,
        *,
        suffix: str = ".mp4",
        text_prompts: list[str] | None = None,
        conf: float = 0.25,
        imgsz: int = 640,
        max_frames: int | None = 300,
        model_path: str | None = None,
    ) -> dict[str, object]:
        prompts = [prompt.strip() for prompt in (text_prompts or []) if prompt.strip()]
        if not prompts:
            raise ValueError("SAM 3.1 concept segmentation requires at least one text prompt.")

        checkpoint = self._checkpoint_path(model_path)
        with tempfile.TemporaryDirectory() as tmp:
            input_path = write_media_bytes(media, Path(tmp), suffix)
            video = is_video_suffix(suffix)
            predictor = self._predictor(video=video, checkpoint=checkpoint, conf=conf, imgsz=imgsz)
            results = predictor(source=str(input_path), text=prompts, stream=True)

            frames = []
            limit = bounded_max_frames(max_frames)
            for frame_index, result in enumerate(results):
                if limit is not None and frame_index >= limit:
                    break
                frames.append(
                    result_to_record(
                        result,
                        frame_index,
                        include_masks=True,
                    )
                )

        return {
            "engine": "sam-3.1-ultralytics",
            "task": "instance",
            "model": str(checkpoint),
            "text_prompts": prompts,
            "frame_count": len(frames),
            "frames": frames,
            "settings": {"conf": conf, "imgsz": imgsz},
        }


@app.cls(
    image=mediapipe_image,
    volumes={MODEL_ROOT: model_volume},
    cpu=2.0,
    memory=4096,
    timeout=15 * 60,
    scaledown_window=30,
    max_containers=2,
)
class MediaPipeHands:
    @modal.enter()
    def setup(self) -> None:
        model_path = Path(MODEL_ROOT) / "mediapipe" / "hand_landmarker.task"
        already_cached = model_path.exists()
        self.model_path = ensure_hand_model(model_path)
        if not already_cached:
            model_volume.commit()

    @modal.method()
    def landmarks(
        self,
        media: bytes,
        *,
        suffix: str = ".mp4",
        target_fps: float = 10.0,
        max_frames: int | None = 300,
        max_hands: int = 2,
        detection_confidence: float = 0.5,
        presence_confidence: float = 0.5,
        tracking_confidence: float = 0.5,
    ) -> dict[str, object]:
        with tempfile.TemporaryDirectory() as tmp:
            input_path = write_media_bytes(media, Path(tmp), suffix)
            payload = infer_hands(
                input_path,
                self.model_path,
                is_video=is_video_suffix(suffix),
                target_fps=target_fps,
                max_frames=bounded_max_frames(max_frames),
                max_hands=max_hands,
                detection_confidence=detection_confidence,
                presence_confidence=presence_confidence,
                tracking_confidence=tracking_confidence,
            )

        return {
            "engine": "mediapipe-hand-landmarker",
            "model": str(self.model_path),
            "settings": {
                "target_fps": target_fps,
                "max_hands": max_hands,
                "detection_confidence": detection_confidence,
                "presence_confidence": presence_confidence,
                "tracking_confidence": tracking_confidence,
            },
            **payload,
        }


@app.cls(
    image=tas_image,
    secrets=[backend_secret],
    volumes={MODEL_ROOT: model_volume},
    cpu=2.0,
    memory=6144,
    timeout=30 * 60,
    scaledown_window=30,
    max_containers=1,
)
class TemporalActionSegmenter:
    @modal.enter()
    def setup(self) -> None:
        from temporal_action_segmentation.hand_tracking import ensure_model

        model_path = Path(MODEL_ROOT) / "mediapipe" / "hand_landmarker.task"
        already_cached = model_path.exists()
        self.model_path = ensure_model(model_path)
        if not already_cached:
            model_volume.commit()

    @modal.method()
    def segment(
        self,
        video: bytes,
        *,
        suffix: str = ".mp4",
        target_fps: float = 10.0,
        min_seg_s: float = 0.6,
        max_seg_s: float = 6.0,
        min_visible_ratio: float = 0.6,
        min_motion: float = 0.01,
        max_segments: int | None = 200,
    ) -> dict[str, object]:
        if not is_video_suffix(suffix):
            raise ValueError("Temporal action segmentation expects a video input.")

        from temporal_action_segmentation.pipeline import PipelineConfig, process_video

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            input_path = write_media_bytes(video, tmp_path, suffix)
            output_dir = tmp_path / "outputs"
            config = PipelineConfig(
                output_dir=output_dir,
                model_path=self.model_path,
                target_fps=target_fps,
                min_seg_s=min_seg_s,
                max_seg_s=max_seg_s,
                min_visible_ratio=min_visible_ratio,
                min_motion=min_motion,
                render_contact_sheets=True,
                write_review=False,
                labeler="gemini",
                openai_model=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"),
                max_segments=max_segments,
            )
            labeler = GeminiTemporalLabeler(
                model=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"),
                cache_dir=output_dir / "cache",
            )
            records = process_video(input_path, config, labeler)
            records.sort(key=lambda item: (item["video_id"], item["hand"], item["start_sec"]))

        return {
            "engine": "hack48-temporal-action-segmentation",
            "model": str(self.model_path),
            "labeler": {
                "engine": "gemini",
                "model": os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"),
            },
            "segment_count": len(records),
            "segments": records,
            "settings": {
                "target_fps": target_fps,
                "min_seg_s": min_seg_s,
                "max_seg_s": max_seg_s,
                "min_visible_ratio": min_visible_ratio,
                "min_motion": min_motion,
                "max_segments": max_segments,
            },
        }


@app.function(
    image=orchestrator_image,
    secrets=[backend_secret],
    timeout=45 * 60,
    scaledown_window=60,
    max_containers=4,
)
def process_recording(payload: dict) -> dict[str, object]:
    request = AnalysisRequest.model_validate(payload)
    api = SupabaseApi(SupabaseConfig.from_service_role_env())
    failed = False

    try:
        try:
            task, _recording, video_bytes = fetch_context(api, request)
        except Exception as exc:
            message = _error_message(exc)
            for kind in ANALYSIS_KINDS:
                mark_job(
                    api,
                    request.recording_id,
                    kind,
                    "failed",
                    error=message,
                    finished_at=utc_now(),
                )
            api.patch_rows(
                "recordings",
                f"id=eq.{request.recording_id}",
                {"status": "analysis_failed", "is_scoring": False},
            )
            raise

        api.patch_rows("recordings", f"id=eq.{request.recording_id}", {"status": "analyzing"})
        prompts = normalize_sam_prompts(task.objects)

        futures = {}
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures[executor.submit(run_gemini, api, request, task, video_bytes)] = "gemini_eval"

            for kind in REMOTE_ANALYSIS_KINDS:
                mark_job(
                    api,
                    request.recording_id,
                    kind,
                    "running",
                    error=None,
                    started_at=utc_now(),
                    finished_at=None,
                )

            futures[
                executor.submit(
                    lambda: Yolo26().predict.remote(
                        video_bytes,
                        suffix=".mp4",
                        task="detect",
                        max_frames=None,
                    )
                )
            ] = "yolo_objects"
            futures[
                executor.submit(
                    lambda: MediaPipeHands().landmarks.remote(
                        video_bytes,
                        suffix=".mp4",
                        target_fps=10.0,
                        max_frames=None,
                    )
                )
            ] = "mediapipe_hands"
            futures[
                executor.submit(
                    lambda: SAM31Segmenter().segment.remote(
                        video_bytes,
                        suffix=".mp4",
                        text_prompts=prompts,
                        max_frames=None,
                    )
                )
            ] = "sam_segments"
            futures[
                executor.submit(
                    lambda: TemporalActionSegmenter().segment.remote(
                        video_bytes,
                        suffix=".mp4",
                        max_segments=200,
                    )
                )
            ] = "temporal_actions"

            for future in as_completed(futures):
                kind = futures[future]
                try:
                    artifact_payload = future.result()
                except Exception as exc:
                    failed = True
                    mark_job(
                        api,
                        request.recording_id,
                        kind,
                        "failed",
                        error=_error_message(exc),
                        finished_at=utc_now(),
                    )
                    if kind == "gemini_eval":
                        api.patch_rows(
                            "recordings",
                            f"id=eq.{request.recording_id}",
                            {"is_scoring": False},
                        )
                    continue

                if kind == "gemini_eval":
                    continue

                try:
                    summary = detected_object_summary(artifact_payload) if kind == "yolo_objects" else None
                    run_remote_analyzer(api, request, kind, artifact_payload, summary)
                    if kind == "yolo_objects":
                        api.patch_rows(
                            "recordings",
                            f"id=eq.{request.recording_id}",
                            {"detected_objects": summary},
                        )
                except Exception as exc:
                    failed = True
                    mark_job(
                        api,
                        request.recording_id,
                        kind,
                        "failed",
                        error=_error_message(exc),
                        finished_at=utc_now(),
                    )
                    continue

        final_status = update_final_status(api, request.recording_id)
        return {
            "ok": not failed,
            "recording_id": request.recording_id,
            "status": final_status,
        }
    finally:
        api.close()


@app.function(
    image=orchestrator_image,
    secrets=[backend_secret],
    timeout=60,
    scaledown_window=30,
)
@modal.fastapi_endpoint(method="POST")
def submit_analysis(payload: dict[str, Any], request: Request):
    from fastapi import HTTPException

    expected = os.environ.get("MODAL_ANALYSIS_SECRET")
    received = request.headers.get("X-Hack48-Modal-Secret")
    if not expected or received != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

    parsed = AnalysisRequest.model_validate(payload)
    call = process_recording.spawn(parsed.model_dump())
    return {"ok": True, "call_id": call.object_id}


@app.local_entrypoint()
def main(
    kind: Literal["yolo", "sam", "hands", "temporal"],
    media_path: str,
    task: Literal["detect", "instance"] = "detect",
    prompts: str = "",
    output_json: str = "",
    max_frames: int = 240,
    target_fps: float = 10.0,
    conf: float = 0.25,
    imgsz: int = 640,
    vid_stride: int = 1,
) -> None:
    path = Path(media_path).expanduser().resolve()
    media = path.read_bytes()
    suffix = path.suffix or ".mp4"

    if kind == "yolo":
        result = Yolo26().predict.remote(
            media,
            suffix=suffix,
            task=task,
            conf=conf,
            imgsz=imgsz,
            vid_stride=vid_stride,
            max_frames=max_frames,
        )
    elif kind == "sam":
        text_prompts = [prompt.strip() for prompt in prompts.split(",") if prompt.strip()]
        result = SAM31Segmenter().segment.remote(
            media,
            suffix=suffix,
            text_prompts=text_prompts,
            conf=conf,
            imgsz=imgsz,
            max_frames=max_frames,
        )
    elif kind == "hands":
        result = MediaPipeHands().landmarks.remote(
            media,
            suffix=suffix,
            target_fps=target_fps,
            max_frames=max_frames,
        )
    elif kind == "temporal":
        result = TemporalActionSegmenter().segment.remote(
            media,
            suffix=suffix,
            target_fps=target_fps,
            max_segments=max_frames,
        )
    else:
        raise ValueError(f"Unsupported kind: {kind}")

    _upload_output(result, output_json)


def _error_message(error: BaseException) -> str:
    message = str(error).strip()
    return message if message else error.__class__.__name__
