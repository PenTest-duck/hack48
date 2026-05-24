from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AnalysisKind = Literal[
    "gemini_eval",
    "mediapipe_hands",
    "yolo_objects",
    "sam_segments",
    "temporal_actions",
]

AnalysisStatus = Literal["pending", "running", "succeeded", "failed"]

ANALYSIS_KINDS: tuple[AnalysisKind, ...] = (
    "gemini_eval",
    "mediapipe_hands",
    "yolo_objects",
    "sam_segments",
    "temporal_actions",
)


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recording_id: str
    task_id: str
    submission_id: str | None = None
    storage_path: str


class TaskRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str
    description: str | None = None
    objects: list[str] = Field(default_factory=list)


class RecordingRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    storage_path: str
    streams: list[str] | None = None


class GeminiEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1)
    success: bool
    success_reasoning: str = Field(min_length=1)
    score: int = Field(ge=0, le=10)
    score_reasoning: str = Field(min_length=1)
