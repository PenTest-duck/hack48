# MediaPipe SO101 Wrist Teleop

Real-time MediaPipe hand-pose control for the SO101 follower wrist and gripper.

The script defaults to dry-run mode. It only opens the robot serial port when `--enable-robot` is passed.

## Setup

```bash
uv sync
```

## Check

```bash
uv run python main.py --check
```

## Dry Run

```bash
uv run python main.py --camera-index 0 --width 640 --height 480 --fps 15
```

Controls:

- `n`: capture neutral hand pose.
- `space`: toggle real-time sync.
- `q` or `Esc`: exit.

Before neutral capture, no targets are emitted. Neutral capture requires fresh, high-confidence hand tracking. In dry-run mode, targets are displayed in the camera overlay and no robot port is opened.

## Robot Mode

Example:

```bash
uv run python main.py \
  --enable-robot \
  --robot-port /dev/cu.usbmodemYOUR_PORT \
  --robot-id so101_5AE60843881 \
  --calibration-dir ../so101/calibration/robots/so_follower \
  --fps 10 \
  --max-delta 2.0 \
  --wrist-flex-limit 15 \
  --wrist-roll-limit 25
```

Use `--deadman-key x` to require pressing or holding `x` for command output:

```bash
uv run python main.py \
  --enable-robot \
  --robot-port /dev/cu.usbmodemYOUR_PORT \
  --robot-id so101_5AE60843881 \
  --calibration-dir ../so101/calibration/robots/so_follower \
  --deadman-key x
```

## Mapping

- Palm left-right tilt maps to `wrist_roll.pos`.
- Hand flex relative to neutral maps to `wrist_flex.pos`.
- Thumb-index pinch distance maps continuously to `gripper.pos`.
- Full pinch means closed gripper.
- Open fingers mean open gripper.

## Model Cache

The MediaPipe hand landmarker model is downloaded on first use and cached in `models/`. The cached `.task` and temporary download files are ignored by git.

## Safety Notes

This is safer than full-arm teleoperation because it only commands wrist flex, wrist roll, and gripper. It is still physical robot motion. Keep the wrist clear of the table and cables, keep fingers out of the gripper, start with low FPS and small limits, and press `space` or `q` if motion is unexpected.

The script freezes command output when tracking is missing, stale, below confidence, paused, the deadman key is inactive, or neutral has not been captured. A backend send failure disables sync and locks command output off until restart.
