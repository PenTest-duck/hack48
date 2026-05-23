from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from .types import ACTION_KEYS, HELD_KEYS, RobotTargets


class RobotLike(Protocol):
    action_features: dict[str, type]

    def connect(self) -> None: ...
    def disconnect(self) -> None: ...
    def get_observation(self) -> dict[str, float]: ...
    def send_action(self, action: dict[str, float]) -> dict[str, float]: ...


class Backend(Protocol):
    @property
    def baseline_targets(self) -> RobotTargets: ...
    def connect(self) -> None: ...
    def send(self, targets: RobotTargets) -> dict[str, float]: ...
    def disconnect(self) -> None: ...


class DryRunBackend:
    def __init__(self, default_gripper: float) -> None:
        self._baseline = RobotTargets(0.0, 0.0, default_gripper)
        self.last_action: dict[str, float] | None = None

    @property
    def baseline_targets(self) -> RobotTargets:
        return self._baseline

    def connect(self) -> None:
        return None

    def send(self, targets: RobotTargets) -> dict[str, float]:
        self.last_action = targets.as_action()
        return self.last_action

    def disconnect(self) -> None:
        return None


@dataclass(frozen=True)
class SO101BackendConfig:
    port: str
    robot_id: str
    calibration_dir: Path
    max_relative_target: float


class SO101Backend:
    def __init__(
        self,
        config: SO101BackendConfig,
        robot_factory: Callable[[object], RobotLike] | None = None,
    ) -> None:
        self.config = config
        self._robot_factory = robot_factory or _make_so101_robot
        self._robot: RobotLike | None = None
        self._startup_action: dict[str, float] | None = None
        self._baseline = RobotTargets(0.0, 0.0, 50.0)

    @property
    def baseline_targets(self) -> RobotTargets:
        return self._baseline

    def connect(self) -> None:
        calibration_file = self.config.calibration_dir / f"{self.config.robot_id}.json"
        if not calibration_file.exists():
            raise FileNotFoundError(f"SO101 calibration file not found: {calibration_file}")

        robot_config = _make_so101_config(self.config)
        robot = self._robot_factory(robot_config)
        robot.connect()
        observation = robot.get_observation()
        self._startup_action = _extract_action(observation)
        self._baseline = RobotTargets(
            wrist_flex=self._startup_action["wrist_flex.pos"],
            wrist_roll=self._startup_action["wrist_roll.pos"],
            gripper=self._startup_action["gripper.pos"],
        )
        self._robot = robot

    def send(self, targets: RobotTargets) -> dict[str, float]:
        if self._robot is None or self._startup_action is None:
            raise RuntimeError("SO101Backend is not connected")

        action = dict(self._startup_action)
        action.update(targets.as_action())
        return self._robot.send_action(action)

    def disconnect(self) -> None:
        if self._robot is not None:
            self._robot.disconnect()
            self._robot = None


def _extract_action(observation: dict[str, float]) -> dict[str, float]:
    missing = set(ACTION_KEYS) - set(observation)
    if missing:
        raise KeyError(f"Robot observation missing action keys: {sorted(missing)}")
    action = {key: float(observation[key]) for key in ACTION_KEYS}
    missing_held = set(HELD_KEYS) - set(action)
    if missing_held:
        raise KeyError(f"Robot observation missing held joints: {sorted(missing_held)}")
    return action


def _make_so101_config(config: SO101BackendConfig) -> object:
    from lerobot.robots.so_follower.config_so_follower import SOFollowerRobotConfig

    return SOFollowerRobotConfig(
        port=config.port,
        id=config.robot_id,
        calibration_dir=config.calibration_dir,
        max_relative_target=config.max_relative_target,
        use_degrees=True,
    )


def _make_so101_robot(config: object) -> RobotLike:
    from lerobot.robots.so_follower.so_follower import SO101Follower

    return SO101Follower(config)
