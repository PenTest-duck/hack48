from __future__ import annotations

import argparse
import math
import re
from pathlib import Path

from teleop.pose_mapper import MappingConfig
from teleop.tracker import default_hand_model_path, default_pose_model_path
from teleop.types import RobotTargets


WINDOW_NAME = "Egocentric SO101 Teleop"

CAMERA_DEFAULTS_BY_INDEX = {
    0: (640, 480, 30),
}
FALLBACK_CAMERA_DEFAULTS = (1280, 720, 30)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Egocentric SO101 6-DOF teleoperation from MediaPipe Pose + Hand."
    )
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--width", type=int, default=None)
    parser.add_argument("--height", type=int, default=None)
    parser.add_argument("--fps", type=int, default=None)
    parser.add_argument("--no-mirror", action="store_true")
    parser.add_argument("--check", action="store_true")

    parser.add_argument("--arm", choices=("left", "right"), default="right")
    parser.add_argument("--mirror-hand", choices=("auto", "on", "off"), default="auto")
    parser.add_argument("--max-hands", type=int, default=2)
    parser.add_argument("--detection-confidence", type=float, default=0.5)
    parser.add_argument("--presence-confidence", type=float, default=0.5)
    parser.add_argument("--tracking-confidence", type=float, default=0.5)
    parser.add_argument("--min-hand-confidence", type=float, default=0.45)
    parser.add_argument("--min-pose-visibility", type=float, default=0.6)

    parser.add_argument("--pose-model-path", type=Path, default=default_pose_model_path())
    parser.add_argument("--hand-model-path", type=Path, default=default_hand_model_path())

    parser.add_argument("--enable-robot", action="store_true")
    parser.add_argument("--robot-port", type=str)
    parser.add_argument("--robot-id", type=str)
    parser.add_argument(
        "--calibration-dir",
        type=Path,
        default=Path("../so101/calibration/robots/so_follower"),
    )
    parser.add_argument("--max-relative-target", type=float, default=5.0)
    parser.add_argument("--deadman-key", type=str, default="")
    parser.add_argument("--deadman-grace-ms", type=int, default=175)

    parser.add_argument("--shoulder-pan-gain", type=float, default=20.0)
    parser.add_argument("--shoulder-lift-gain", type=float, default=20.0)
    parser.add_argument("--elbow-flex-gain", type=float, default=20.0)
    parser.add_argument("--wrist-flex-gain", type=float, default=30.0)
    parser.add_argument("--wrist-roll-gain", type=float, default=60.0)
    parser.add_argument("--gripper-open", type=float, default=80.0)
    parser.add_argument("--gripper-closed", type=float, default=20.0)
    parser.add_argument("--pinch-closed-ratio", type=float, default=0.35)
    parser.add_argument("--pinch-open-ratio", type=float, default=1.40)

    parser.add_argument("--shoulder-pan-limit", type=float, default=20.0)
    parser.add_argument("--shoulder-lift-limit", type=float, default=20.0)
    parser.add_argument("--elbow-flex-limit", type=float, default=25.0)
    parser.add_argument("--wrist-flex-limit", type=float, default=15.0)
    parser.add_argument("--wrist-roll-limit", type=float, default=25.0)
    parser.add_argument("--gripper-min", type=float, default=15.0)
    parser.add_argument("--gripper-max", type=float, default=85.0)
    parser.add_argument("--max-delta", type=float, default=2.0)
    parser.add_argument("--smoothing", type=float, default=0.35)
    parser.add_argument("--stale-timeout-ms", type=int, default=200)

    return parser.parse_args(argv)


def apply_camera_defaults(args: argparse.Namespace) -> None:
    width, height, fps = CAMERA_DEFAULTS_BY_INDEX.get(args.camera_index, FALLBACK_CAMERA_DEFAULTS)
    if args.width is None:
        args.width = width
    if args.height is None:
        args.height = height
    if args.fps is None:
        args.fps = fps


def validate_args(args: argparse.Namespace) -> None:
    if args.fps <= 0:
        raise SystemExit("--fps must be positive")
    if args.width <= 0 or args.height <= 0:
        raise SystemExit("--width and --height must be positive")
    if args.max_hands <= 0:
        raise SystemExit("--max-hands must be positive")
    if args.deadman_key and len(args.deadman_key) != 1:
        raise SystemExit("--deadman-key must be a single character")
    if args.deadman_grace_ms < 0:
        raise SystemExit("--deadman-grace-ms must be non-negative")

    for name in (
        "detection_confidence",
        "presence_confidence",
        "tracking_confidence",
        "min_hand_confidence",
        "min_pose_visibility",
    ):
        value = getattr(args, name)
        if not math.isfinite(value) or not 0.0 <= value <= 1.0:
            raise SystemExit(f"--{name.replace('_', '-')} must be in [0, 1]")

    if args.gripper_min >= args.gripper_max:
        raise SystemExit("--gripper-min must be less than --gripper-max")

    try:
        MappingConfig(
            shoulder_pan_gain=args.shoulder_pan_gain,
            shoulder_lift_gain=args.shoulder_lift_gain,
            elbow_flex_gain=args.elbow_flex_gain,
            wrist_flex_gain=args.wrist_flex_gain,
            wrist_roll_gain=args.wrist_roll_gain,
            gripper_open=args.gripper_open,
            gripper_closed=args.gripper_closed,
            pinch_closed_ratio=args.pinch_closed_ratio,
            pinch_open_ratio=args.pinch_open_ratio,
            mirror_hand=_resolve_mirror_hand(args),
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    if args.enable_robot:
        if not args.robot_port:
            raise SystemExit("--robot-port is required with --enable-robot")
        if not args.robot_id:
            raise SystemExit("--robot-id is required with --enable-robot")
        validate_robot_port_matches_id(args.robot_port, args.robot_id)
        calibration_file = args.calibration_dir.expanduser().resolve() / f"{args.robot_id}.json"
        if not calibration_file.exists():
            raise SystemExit(f"Calibration file not found: {calibration_file}")
        if not math.isfinite(args.max_relative_target) or args.max_relative_target <= 0:
            raise SystemExit("--max-relative-target must be finite and positive")


def _resolve_mirror_hand(args: argparse.Namespace) -> bool:
    if args.mirror_hand == "on":
        return True
    if args.mirror_hand == "off":
        return False
    return args.arm == "left"


def validate_robot_port_matches_id(robot_port: str, robot_id: str) -> None:
    port_serial = robot_port_serial_hint(robot_port)
    robot_serial = robot_id_serial_hint(robot_id)
    if port_serial is None or robot_serial is None or port_serial == robot_serial:
        return
    raise SystemExit(
        f"--robot-port appears to be for serial {port_serial!r}, but --robot-id is {robot_id!r}."
    )


def robot_port_serial_hint(robot_port: str) -> str | None:
    match = re.search(r"(?:^|[.])(?:usbmodem|usbserial)([-_A-Za-z0-9]+)$", Path(robot_port).name)
    if match is None:
        return None
    return match.group(1).lstrip("-_") or None


def robot_id_serial_hint(robot_id: str) -> str | None:
    prefix = "so101_"
    if not robot_id.startswith(prefix):
        return None
    serial = robot_id.removeprefix(prefix)
    return serial or None
