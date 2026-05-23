from mediapipe_so101.safety import SafetyConfig, TargetFilter
from mediapipe_so101.types import FreezeReason, RobotTargets


def make_filter() -> TargetFilter:
    return TargetFilter(
        SafetyConfig(
            limits={
                "wrist_flex.pos": (-20.0, 20.0),
                "wrist_roll.pos": (-30.0, 30.0),
                "gripper.pos": (20.0, 80.0),
            },
            max_delta={
                "wrist_flex.pos": 5.0,
                "wrist_roll.pos": 10.0,
                "gripper.pos": 15.0,
            },
            smoothing=1.0,
            stale_timeout_ms=150,
        ),
        initial_targets=RobotTargets(0.0, 0.0, 50.0),
    )


def test_limits_are_clamped() -> None:
    filt = make_filter()

    result = filt.update(
        RobotTargets(wrist_flex=100.0, wrist_roll=-100.0, gripper=100.0),
        now_ms=1000,
        sample_timestamp_ms=1000,
        sync_enabled=True,
        neutral_ready=True,
        deadman_active=True,
        tracking_ok=True,
    )

    assert result.targets == RobotTargets(5.0, -10.0, 65.0)
    assert result.clamped_keys == ("gripper.pos", "wrist_flex.pos", "wrist_roll.pos")
    assert result.frozen is False
    assert result.reason is FreezeReason.ACTIVE


def test_freezes_when_paused() -> None:
    filt = make_filter()

    result = filt.update(
        RobotTargets(wrist_flex=10.0, wrist_roll=10.0, gripper=80.0),
        now_ms=1000,
        sample_timestamp_ms=1000,
        sync_enabled=False,
        neutral_ready=True,
        deadman_active=True,
        tracking_ok=True,
    )

    assert result.targets == RobotTargets(0.0, 0.0, 50.0)
    assert result.frozen is True
    assert result.reason is FreezeReason.PAUSED


def test_freezes_when_neutral_missing() -> None:
    filt = make_filter()

    result = filt.update(
        RobotTargets(wrist_flex=10.0, wrist_roll=10.0, gripper=80.0),
        now_ms=1000,
        sample_timestamp_ms=1000,
        sync_enabled=True,
        neutral_ready=False,
        deadman_active=True,
        tracking_ok=True,
    )

    assert result.targets == RobotTargets(0.0, 0.0, 50.0)
    assert result.reason is FreezeReason.NEUTRAL_MISSING


def test_freezes_stale_tracking() -> None:
    filt = make_filter()

    result = filt.update(
        RobotTargets(wrist_flex=10.0, wrist_roll=10.0, gripper=80.0),
        now_ms=1200,
        sample_timestamp_ms=1000,
        sync_enabled=True,
        neutral_ready=True,
        deadman_active=True,
        tracking_ok=True,
    )

    assert result.targets == RobotTargets(0.0, 0.0, 50.0)
    assert result.reason is FreezeReason.STALE_RESULT


def test_smoothing_blends_from_previous_target() -> None:
    filt = TargetFilter(
        SafetyConfig(
            limits={
                "wrist_flex.pos": (-100.0, 100.0),
                "wrist_roll.pos": (-100.0, 100.0),
                "gripper.pos": (0.0, 100.0),
            },
            max_delta={
                "wrist_flex.pos": 100.0,
                "wrist_roll.pos": 100.0,
                "gripper.pos": 100.0,
            },
            smoothing=0.25,
            stale_timeout_ms=150,
        ),
        initial_targets=RobotTargets(0.0, 0.0, 0.0),
    )

    result = filt.update(
        RobotTargets(wrist_flex=40.0, wrist_roll=80.0, gripper=100.0),
        now_ms=1000,
        sample_timestamp_ms=1000,
        sync_enabled=True,
        neutral_ready=True,
        deadman_active=True,
        tracking_ok=True,
    )

    assert result.targets == RobotTargets(10.0, 20.0, 25.0)
