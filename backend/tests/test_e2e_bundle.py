from backend.tools.e2e_upload_bundle import build_submit_payload, patch_metadata


def test_patch_metadata_sets_recording_and_task_ids():
    source = {
        "recordingId": "old",
        "bountyId": "old-task",
        "streams": ["video.mp4"],
    }

    patched = patch_metadata(source, recording_id="new-rec", task_id="new-task")

    assert patched["recordingId"] == "new-rec"
    assert patched["bountyId"] == "new-task"
    assert patched["streams"] == ["video.mp4"]


def test_build_submit_payload_matches_ios_shape():
    metadata = {
        "device": {"model": "iPhone16,1"},
        "durationMs": 1234,
        "gps": {"lat": -33.1, "lon": 151.2, "accuracyM": 3.4},
        "streams": ["video.mp4", "imu.jsonl"],
    }

    payload = build_submit_payload(
        metadata,
        recording_id="rec",
        task_id="task",
        size_bytes=99,
    )

    assert payload == {
        "recording_id": "rec",
        "task_id": "task",
        "device_model": "iPhone16,1",
        "duration_ms": 1234,
        "size_bytes": 99,
        "gps_lat": -33.1,
        "gps_lon": 151.2,
        "gps_accuracy_m": 3.4,
        "storage_path": "rec/",
        "streams": ["video.mp4", "imu.jsonl"],
    }
