from pathlib import Path
from unittest.mock import patch

import pytest

from teleop.tracker import (
    default_hand_model_path,
    default_pose_model_path,
    ensure_model,
)


def test_default_pose_model_path_lives_under_models_dir() -> None:
    path = default_pose_model_path()
    assert path.name == "pose_landmarker_lite.task"
    assert path.parent.name == "models"


def test_default_hand_model_path_lives_under_models_dir() -> None:
    path = default_hand_model_path()
    assert path.name == "hand_landmarker.task"
    assert path.parent.name == "models"


def test_ensure_model_returns_existing_path_when_file_present(tmp_path: Path) -> None:
    file_path = tmp_path / "existing.task"
    file_path.write_bytes(b"\x00")
    assert ensure_model(file_path, url="https://example.invalid/model.task") == file_path.resolve()


def test_ensure_model_downloads_when_missing(tmp_path: Path) -> None:
    target = tmp_path / "missing.task"

    class FakeResponse:
        def __init__(self, payload: bytes) -> None:
            self._payload = payload
            self._sent = False

        def __enter__(self) -> "FakeResponse":
            return self

        def __exit__(self, *args, **kwargs) -> None:
            return None

        def read(self, _size: int = -1) -> bytes:
            if self._sent:
                return b""
            self._sent = True
            return self._payload

    def fake_urlopen(url: str, timeout: int) -> FakeResponse:
        assert url == "https://example.invalid/model.task"
        return FakeResponse(b"abc")

    with patch("teleop.tracker.urllib.request.urlopen", side_effect=fake_urlopen):
        result = ensure_model(target, url="https://example.invalid/model.task")
    assert result == target.resolve()
    assert target.read_bytes() == b"abc"


def test_ensure_model_cleans_up_temp_on_failure(tmp_path: Path) -> None:
    target = tmp_path / "fail.task"

    def boom(*_args, **_kwargs):
        raise RuntimeError("network down")

    with patch("teleop.tracker.urllib.request.urlopen", side_effect=boom):
        with pytest.raises(RuntimeError, match="network down"):
            ensure_model(target, url="https://example.invalid/model.task")
    assert not target.exists()
    assert not target.with_suffix(target.suffix + ".tmp").exists()
