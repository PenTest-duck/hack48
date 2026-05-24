# Egocentric SO101 5-DOF Hand-Only Teleoperation Design

Date: 2026-05-24

## Goal

Build a new playground prototype at `playground/teleop2/` that explores real-time SO101 follower teleoperation from a single RGB webcam using **MediaPipe Hand Landmarker only** — no Pose Landmarker, no body context required.

Where the existing `playground/teleop/` uses a chest-mounted egocentric camera and MediaPipe Pose + Hand to drive all six joints via joint-mimic mapping, this prototype targets a more flexible **slanted top-down view onto the user's hand** (similar to what a desk-mounted webcam naturally captures when the user reaches forward). The trade-off is one fewer controlled joint: `elbow_flex` stays at its baseline value because there is no reliable elbow signal from a hand-only view. The remaining five joints are controlled:

- `shoulder_pan.pos` — driven by hand wrist landmark's image-plane x position
- `shoulder_lift.pos` — driven by hand wrist landmark's image-plane y position
- `wrist_flex.pos` — driven by hand flex relative to neutral (same math as exocentric)
- `wrist_roll.pos` — driven by hand roll relative to neutral (same math as exocentric)
- `gripper.pos` — driven by thumb-index pinch openness (same math as exocentric)

The prototype defaults to a dry run and only commands physical robot motion when launched with an explicit `--enable-robot` flag.

## Non-Goals

This prototype will not implement Pose Landmarker integration, inverse kinematics, dataset recording, learned policies, bimanual control, depth sensors, IMU fusion, or hot-reloadable mapping configs. It will not modify the existing `playground/teleop/` or `playground/mediapipe_so101/` playgrounds; both remain available as alternative approaches (full 6-DOF joint-mimic and exocentric wrist-only respectively).

`elbow_flex` is held at the operator's starting position for the entire session. If the robot needs a different elbow extension, the operator manually moves the robot to that pose before launching teleoperation, and the new pose becomes the held baseline.

## Runtime Behavior

The script starts in a paused state. It opens the camera, runs MediaPipe Hand Landmarker, and displays the detected hand overlay. No robot commands are emitted until a neutral pose has been captured.

The user holds their hand in a comfortable resting position roughly in the centre of the frame, fingers relaxed open, and presses `n` to capture neutral. Neutral stores the hand wrist landmark's image-plane position (the "zero" for shoulder pan and lift) along with the wrist roll, wrist flex, and pinch baselines. The gripper command is not neutral-relative; it remains an absolute mapping from current pinch openness to the configured open/closed targets.

The user presses `space` to toggle sync. In dry-run mode, sync updates target values shown on the overlay. In robot mode, sync sends filtered targets to the SO101 follower at the configured control rate. An optional `--deadman-key` mode requires recent key activity before commands flow, in addition to the sync toggle.

The `q` or `Esc` key exits cleanly. Exit, keyboard interrupt, camera failure, or robot connection failure must leave the robot disconnected through LeRobot's normal cleanup path. A backend send failure locks sync off until restart, the same as the prior playgrounds.

## Architecture

The prototype mirrors the four-stage `tracker → mapper → safety → backend` pipeline of `playground/teleop/`. It is organized as plain Python modules under `playground/teleop2/`:

- `README.md`: setup, dry-run command, robot command, key controls, safety notes, camera placement guidance.
- `pyproject.toml`: dependencies for MediaPipe, OpenCV, LeRobot-compatible runtime, pytest. Same dependency surface as `playground/teleop/` — Pose Landmarker is part of the `mediapipe` package, we simply don't import it.
- `main.py`: command-line parsing and the camera/control loop.
- `teleop2/types.py`: `Landmark`, `HandSample`, `TeleopSample` (hand only, no arm field), `RobotTargets` (all 6 joints, since the backend still commands them all), `FilterResult`, `FreezeReason`.
- `teleop2/tracker.py`: MediaPipe Hand model download, single landmarker creation, thread-safe latest-result buffer, camera helpers, overlay drawing.
- `teleop2/pose_mapper.py`: `WristMapper` (wrist_flex / wrist_roll / gripper math lifted from `playground/teleop/`), `HandPositionMapper` (new — shoulder_pan / shoulder_lift from hand position deltas), and `TeleopMapper` (combines both with a shared neutral-capture interface; holds `elbow_flex` at baseline).
- `teleop2/safety.py`: 6-joint `TargetFilter`. Simpler than `playground/teleop/` because there are no Pose visibility fields and no pose-visibility freeze rule.
- `teleop2/robot_backend.py`: `DryRunBackend` and `SO101Backend` for the full 6-joint action surface (identical to `playground/teleop/`).

`pose_mapper.py` and `safety.py` must remain usable without a camera or hardware.

**Code reuse strategy.** Fork the entire `playground/teleop/` directory as the starting point. Delete the Pose Landmarker plumbing (`create_pose_landmarker`, `LatestPoseResult`, world landmarks, model URL), the arm side of the mapper (`ArmSample`, `PoseLandmark`, `ArmMapper`, `ArmFeatures`, `extract_arm_features`, `_validate_pose_landmark`), the fusion logic (`fuse_samples`), and the pose-skeleton overlay drawing. Add the new `HandPositionMapper` and rewire `TeleopMapper`. The 6-DOF safety filter and backend code carry over unchanged, since they already handle all six joints.

## Perception

A single MediaPipe Tasks LIVE_STREAM Hand Landmarker runs against each frame, producing 21 hand landmarks in normalized image coordinates per detected hand (up to `--max-hands`). The result callback updates a thread-safe `LatestHandResult` buffer. The control loop reads the latest, picks the highest-confidence hand, and packages it into a `TeleopSample`.

There is no Pose Landmarker. There is no fusion step. Handedness labels remain unreliable in egocentric POV (back of right hand looks like front of left hand to the model), so handedness is informational only — it is shown in the overlay but does not influence which hand is selected.

## Mapping

### Wrist and gripper (unchanged from prior playgrounds)

Lifted directly from `playground/teleop/teleop/pose_mapper.py`, which itself was lifted from `playground/mediapipe_so101/`:

- `wrist_roll` from `atan2(index_mcp.y - pinky_mcp.y, pinky_mcp.x - index_mcp.x)`, delta from neutral, scaled by `--wrist-roll-gain`.
- `wrist_flex` from `(middle_mcp.y - wrist.y) / hand_width`, delta from neutral, scaled by `--wrist-flex-gain`.
- `gripper` from the thumb-tip to index-tip pinch distance normalized by hand width, mapped continuously from `--pinch-closed-ratio` / `--pinch-open-ratio` to `--gripper-closed` / `--gripper-open`. Absolute, not neutral-relative.

The `--mirror-hand {auto,on,off}` flag from `playground/teleop/` carries over to handle the egocentric back-of-hand view.

### Shoulder pan and lift (new)

The hand wrist landmark (index 0, the most stable point on the hand — invariant to finger pose, pinch, and wrist orientation) drives the two shoulder joints from its image-plane position.

```
pan_x  = hand.landmarks[0].x     # in [0, 1], normalized image coords
lift_y = hand.landmarks[0].y     # in [0, 1], +y is DOWN in image coords

pan_delta  = pan_x  - neutral.pan_x
lift_delta = lift_y - neutral.lift_y
if config.invert_shoulder_lift:
    lift_delta = -lift_delta

shoulder_pan_target  = neutral_targets.shoulder_pan  + pan_delta  * shoulder_pan_gain
shoulder_lift_target = neutral_targets.shoulder_lift + lift_delta * shoulder_lift_gain
```

A new `--invert-shoulder-lift` CLI flag (default off, meaning hand-up-in-frame produces a positive image-coord delta and a *negative* shoulder_lift delta) lets the operator flip the convention to match their physical intuition and the SO101's calibration. The first physical run is expected to test both settings.

There is no depth normalization; the raw image-plane coordinate is used directly. Forward/back motion of the hand causes a small drift in shoulder targets, which the operator adapts to within a session. Hand-size-based normalization was considered and rejected as a YAGNI (it adds coupling between gripper motion and shoulder motion via `hand_width` jitter).

### Gain defaults

Gains are scaled for image-coord inputs in [0, 1], which is a fundamentally different magnitude than the radian-scale inputs used in `playground/teleop/`. Defaults:

- `--shoulder-pan-gain 60.0`, `--shoulder-lift-gain 60.0` — a hand wave across half the frame (~0.3 image-coord delta) maps to ~18° of shoulder motion, which sits inside the conservative `--shoulder-pan-limit 20` / `--shoulder-lift-limit 20` defaults.
- `--wrist-flex-gain 30.0`, `--wrist-roll-gain 60.0`, `--gripper-open 80.0`, `--gripper-closed 20.0`, `--pinch-closed-ratio 0.35`, `--pinch-open-ratio 1.40` — unchanged from prior playgrounds.

### Holding elbow_flex

`TeleopMapper.map` returns `RobotTargets` where `elbow_flex` is copied unchanged from `neutral_targets.elbow_flex`. The safety filter still applies the per-joint limit, max_delta, and smoothing to `elbow_flex` — defense in depth. There is no special "held" config; the mapper simply emits baseline for that one joint, frame after frame.

### Combined mapping

```python
class TeleopMapper:
    def map(self, sample: TeleopSample) -> RobotTargets:
        if sample.hand is None:
            raise ValueError("TeleopMapper map requires a hand sample")
        wrist_targets = self.wrist.map(sample.hand)
        position_targets = self.position.map(sample.hand)
        return RobotTargets(
            shoulder_pan=position_targets.shoulder_pan,
            shoulder_lift=position_targets.shoulder_lift,
            elbow_flex=self._neutral_targets.elbow_flex,
            wrist_flex=wrist_targets.wrist_flex,
            wrist_roll=wrist_targets.wrist_roll,
            gripper=wrist_targets.gripper,
        )
```

## Robot Backend

Identical to `playground/teleop/`. `DryRunBackend` and `SO101Backend` both handle the 6-joint action surface; the only joint that never changes from the backend's perspective is `elbow_flex`, but the mapper output dict still includes it.

## Safety

Reuses `playground/teleop/`'s `TargetFilter` machinery (per-joint limits, max_delta, smoothing, stale_timeout, full freeze ladder). Two simplifications compared with `playground/teleop/`:

- `SafetyConfig` drops the `min_pose_visibility` field entirely. There is no pose data to gate.
- The visibility-based freeze rule disappears. Tracking-lost now means simply `hand is None` or `hand.confidence < min_hand_confidence`.

The existing freeze reasons (`PAUSED`, `NEUTRAL_MISSING`, `TRACKING_LOST`, `STALE_RESULT`) and backend-send-failure latching carry over unchanged. The fix from `playground/teleop/`'s final review carries over too: `TeleopSample.timestamp_ms` is derived from the underlying `HandSample.timestamp_ms`, not the loop clock, so the stale-result check actually works.

### Conservative defaults

Same as `playground/teleop/`:

- `--max-delta 2.0` (per-tick rate limit, all six joints).
- `--shoulder-pan-limit 20`, `--shoulder-lift-limit 20`, `--elbow-flex-limit 25`, `--wrist-flex-limit 15`, `--wrist-roll-limit 25`.
- `--gripper-min 15`, `--gripper-max 85`.
- `--smoothing 0.35`, `--stale-timeout-ms 200`.
- `--min-hand-confidence 0.45`.

## Data Flow

Each frame follows this path:

1. The camera frame is captured with OpenCV and optionally horizontally mirrored.
2. The frame is dispatched to the Hand Landmarker via `detect_async`.
3. The result callback updates `LatestHandResult`.
4. The control loop reads the latest, picks the highest-confidence hand, packages a `TeleopSample` whose `timestamp_ms` is the hand's callback timestamp (not the loop clock).
5. `TeleopSample` is checked for usability: hand non-None, hand confidence above threshold, timestamp within `--stale-timeout-ms`.
6. If neutral has not been captured, status is updated but no target is emitted.
7. After neutral capture, `TeleopMapper.map` produces a 6-DOF `RobotTargets`. The safety filter applies smoothing, clamps, per-tick limits, and freeze rules.
8. The dry-run backend displays the result on the overlay, or the robot backend sends the filtered action to `SO101Follower.send_action`.

## User Interface

Identical key bindings to `playground/teleop/`:

- `n` capture neutral. Now succeeds whenever the hand is tracked with high confidence — no pose half required.
- `space` toggle sync on or off.
- `q` or `Esc` exit cleanly.
- `--deadman-key x` and `--deadman-grace-ms 175` for the optional dead-man activation pattern.

### Overlay

Hand 21-landmark skeleton (same as `playground/teleop/`). Status lines extended to show:

```
DRY | 17.2 FPS | sync=off | neutral=yes | reason=active | clamp=none
hand=Right 0.92
pan=12.3 lift=-5.1 elb=0.0 wf=2.1 wr=-4.4 grip=45.0
```

After neutral capture, a small crosshair is drawn at the neutral hand wrist position — a visual reference that shows the operator where "zero" is in their frame. Implemented with two `cv2.line` calls and a small filled circle.

No pose skeleton, no per-landmark visibility annotations (there are no pose landmarks to annotate).

## Testing

Follows the same pattern as `playground/teleop/`: pure-function unit tests with synthetic inputs, no live camera or robot.

`test_pose_mapper.py` covers:

- `WristMapper` tests lifted verbatim from `playground/teleop/tests/test_pose_mapper.py` (the wrist half; the arm half is dropped).
- `HandPositionMapper`: hand at neutral position yields baseline shoulder_pan/lift; hand displaced by a known amount yields the expected delta × gain; `invert_shoulder_lift` flips the lift sign; `map` requires neutral capture first.
- `TeleopMapper` combine tests: `capture_neutral` requires a hand sample; combined `RobotTargets` carries elbow_flex from baseline, arm joints from `HandPositionMapper`, wrist/gripper from `WristMapper`.

`test_safety.py` covers the 6-joint filter with the visibility-related tests removed. The `min_pose_visibility` field on `SafetyConfig` is gone.

`test_tracker.py` covers `default_hand_model_path`, `ensure_model`, `LatestHandResult` thread safety, `best_hand_sample` highest-confidence selection. There is no Pose Landmarker code to test.

`test_robot_backend.py` is identical to `playground/teleop/`.

`test_types.py` covers the slimmer dataclasses (no `ArmSample`, no `PoseLandmark`, `TeleopSample` carries only `hand` + `timestamp_ms`).

`test_main_args.py` and `test_main_loop.py` mirror `playground/teleop/`'s with the pose-related cases dropped and `--invert-shoulder-lift` validation added.

Real MediaPipe inference, real robot motion, and live FPS/latency measurement remain manual verification, documented in the README.

## Manual Verification Plan

1. `uv run python main.py --check` validates the Hand model and configuration without opening the camera.
2. Dry-run with overlay: `uv run python main.py` captures neutral and verifies that each joint target moves sensibly when the hand is moved through canonical motions:
   - Hand stationary, fingers move → only gripper changes.
   - Hand stationary, wrist twists → only wrist_roll changes.
   - Hand stationary, wrist folds → only wrist_flex changes.
   - Hand translates left/right → only shoulder_pan changes.
   - Hand translates up/down → only shoulder_lift changes.
   - `elbow_flex` value never changes from baseline.
3. Robot mode with conservative defaults and `--deadman-key x` enabled. Verify `--invert-shoulder-lift` direction matches the operator's intuition; flip if needed. Progressively widen limits after observing safe behavior.
