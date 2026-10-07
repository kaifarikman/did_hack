"""Состояние sample-датчика по разрешённым наблюдениям: шум, залипание, пропадание и восстановление.

Нормальные причины изменения сигнала не считаются неисправностью: после подтверждённого сбора
окна сбрасываются; скачок уровня (смена ближайшего образца) не проверяется вовсе — смотрим только
на разброс соседних показаний, неизменность и отсутствие сообщений. Значения на границах 0 и 1
повторяется естественно (насыщение у образца), значение 0 — когда образцов не осталось; они не
считаются залипанием.

Переходы: ok → suspected → degraded → recovering → ok, с удержанием, чтобы не переключаться на шуме.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass
from enum import Enum


class SensorState(str, Enum):
    OK = "ok"
    SUSPECTED = "suspected"
    DEGRADED = "degraded"
    RECOVERING = "recovering"


class SensorFault(str, Enum):
    NOISE = "noise"
    STUCK = "stuck"
    DROPOUT = "dropout"


@dataclass(frozen=True)
class SensorTransition:
    detection_id: str | None  # новый идентификатор при обнаружении, прежний при восстановлении
    state: SensorState
    fault: SensorFault | None
    detail: str
    time_s: float


class SensorHealthMonitor:
    def __init__(
        self, prior_noise: float = 0.03, noise_ratio: float = 3.0, noise_floor: float = 0.06,
        noise_window: int = 16, stuck_after_s: float = 4.0, dropout_suspect_s: float = 2.0,
        dropout_confirm_s: float = 5.0, recovery_s: float = 4.0,
    ) -> None:
        self._baseline_diff = prior_noise * 1.4142 * 0.6745  # медиана |N(0, σ√2)|
        self._noise_ratio = noise_ratio
        self._noise_floor = noise_floor
        self._window = noise_window
        self._stuck_after = stuck_after_s
        self._dropout_suspect = dropout_suspect_s
        self._dropout_confirm = dropout_confirm_s
        self._recovery = recovery_s
        self.state = SensorState.OK
        self.fault: SensorFault | None = None
        self._detections = 0
        self._detection_id: str | None = None
        self._last_value: float | None = None
        self._unchanged_since: float | None = None
        self._missing_since: float | None = None
        self._diffs: list[float] = []
        self._healthy_since: float | None = None
        self._suspect_since: float | None = None
        self.unusable_since_s: float | None = None  # с какого момента сигналом пользоваться нельзя

    @property
    def detection_id(self) -> str | None:
        return self._detection_id

    @property
    def quality(self) -> float:
        """Доверие к сигналу: 1 — норма, 0 — пользоваться нельзя."""
        if self.state is SensorState.OK:
            return 1.0
        if self.fault in (SensorFault.STUCK, SensorFault.DROPOUT) and self.state is SensorState.DEGRADED:
            return 0.0
        return {SensorState.SUSPECTED: 0.6, SensorState.DEGRADED: 0.3, SensorState.RECOVERING: 0.7}[self.state]

    @property
    def usable_for_collect(self) -> bool:
        return not (self.state is SensorState.DEGRADED and self.fault in (SensorFault.STUCK, SensorFault.DROPOUT))

    def note_collect(self) -> None:
        """Подтверждённый сбор: падение сигнала — нормальная причина, окна начинаются заново."""
        self._diffs.clear()
        self._last_value = None
        self._unchanged_since = None

    def _symptom(self, value: float | None, time_s: float) -> tuple[SensorFault | None, str]:
        if value is None:
            if self._missing_since is None:
                self._missing_since = time_s
            missing = time_s - self._missing_since
            if missing >= self._dropout_suspect:
                return SensorFault.DROPOUT, f"нет сообщений датчика {missing:.1f} с"
            return None, ""
        self._missing_since = None
        if self._last_value is not None and value == self._last_value and 0.0 < value < 1.0:  # 0 и 1 — насыщение
            if self._unchanged_since is None:
                self._unchanged_since = time_s
            if time_s - self._unchanged_since >= self._stuck_after:
                return SensorFault.STUCK, f"значение {value:.3f} не меняется {time_s - self._unchanged_since:.1f} с"
        elif self._last_value is not None and value != self._last_value:
            self._unchanged_since = None
            self._diffs = (self._diffs + [abs(value - self._last_value)])[-self._window:]
        self._last_value = value
        if len(self._diffs) >= self._window:
            median = statistics.median(self._diffs)
            if median > max(self._noise_ratio * self._baseline_diff, self._noise_floor):
                return SensorFault.NOISE, f"медиана разности соседних показаний {median:.3f} при норме {self._baseline_diff:.3f}"
        return None, ""

    def update(self, value: float | None, time_s: float) -> list[SensorTransition]:
        fault, detail = self._symptom(value, time_s)
        changes: list[SensorTransition] = []

        def move(state: SensorState, new_fault: SensorFault | None, text: str) -> None:
            self.state, self.fault = state, new_fault
            if self.quality > 0:
                self.unusable_since_s = None
            elif self.unusable_since_s is None:
                self.unusable_since_s = time_s
            changes.append(SensorTransition(self._detection_id, state, new_fault, text, time_s))

        if fault is not None:
            self._healthy_since = None
            if self.state in (SensorState.OK, SensorState.RECOVERING):
                if self.state is SensorState.OK:
                    self._detections += 1
                    self._detection_id = f"sensor-{self._detections}"
                self._suspect_since = time_s
                move(SensorState.SUSPECTED, fault, detail)
            elif self.state is SensorState.SUSPECTED:
                confirm_after = self._dropout_confirm - self._dropout_suspect if fault is SensorFault.DROPOUT else 2.0
                if time_s - (self._suspect_since or time_s) >= confirm_after:
                    move(SensorState.DEGRADED, fault, detail)
            return changes
        if self.state is SensorState.OK:
            return changes
        if self._healthy_since is None:
            self._healthy_since = time_s
        healthy_for = time_s - self._healthy_since
        if self.state is SensorState.SUSPECTED and healthy_for >= self._recovery / 2:
            move(SensorState.OK, None, "симптом не подтвердился")
        elif self.state is SensorState.DEGRADED and healthy_for >= self._recovery / 2:
            move(SensorState.RECOVERING, self.fault, "показания снова похожи на норму")
        elif self.state is SensorState.RECOVERING and healthy_for >= self._recovery:
            move(SensorState.OK, None, f"восстановление подтверждено за {healthy_for:.1f} с без симптомов")
        return changes
