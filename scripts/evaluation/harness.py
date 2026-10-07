"""Стенд испытаний: один прогон через HTTP API с ограничением времени, журналом и проверкой остановки.

Не зависит от сети напрямую: клиент передаётся снаружи, поэтому логика проверяется без стека.
"""
import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

TERMINAL_STATUSES = {"completed", "stopped", "failed"}
STILLNESS_TOLERANCE_M = 0.02


class ApiClient:
    """Минимальный интерфейс backend; реализации: HttpApiClient и тестовые подмены."""

    def start_run(self, request_id: str, scenario: str, seed: int) -> dict:
        raise NotImplementedError

    def stop_run(self, request_id: str, run_id: str) -> dict:
        raise NotImplementedError

    def state(self) -> dict:
        raise NotImplementedError

    def journal_page(self, run_id: str, after_sequence: int) -> dict:
        raise NotImplementedError


@dataclass
class RunReport:
    scenario: str
    seed: int
    run_id: Optional[str]
    outcome: str  # completed | stopped | failed | timeout | start_rejected
    final_state: Optional[dict]
    journal: List[dict] = field(default_factory=list)
    wall_time_s: float = 0.0
    robot_stationary: Optional[bool] = None
    error: Optional[str] = None
    metadata: Dict[str, object] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        """Успех — completed, подтверждённый физической неподвижностью, а не только статус HTTP."""
        return self.outcome == "completed" and self.robot_stationary is True

    def to_json(self) -> dict:
        return {**self.__dict__, "success": self.success}


def run_experiment(client: ApiClient, scenario: str, seed: int, timeout_s: float,
                   metadata: Optional[dict] = None, poll_interval_s: float = 5.0,
                   clock: Callable[[], float] = time.monotonic,
                   sleep: Callable[[float], None] = time.sleep) -> RunReport:
    started_at = clock()
    metadata = metadata or {}
    try:
        state = client.start_run(uuid.uuid4().hex, scenario, seed)
    except Exception as error:  # отказ старта сохраняется как результат, а не теряется
        return RunReport(scenario, seed, None, "start_rejected", None,
                         wall_time_s=clock() - started_at, error=repr(error), metadata=metadata)
    run_id = state["run_id"]
    outcome = None
    while state["status"] not in TERMINAL_STATUSES:
        if clock() - started_at > timeout_s:
            outcome = "timeout"
            state = _stop_and_wait(client, run_id, state, clock, sleep, poll_interval_s)
            break
        sleep(poll_interval_s)
        state = client.state()
    outcome = outcome or state["status"]
    stationary = _confirm_stationary(client, state, sleep, poll_interval_s)
    return RunReport(scenario, seed, run_id, outcome, state, _read_journal(client, run_id),
                     clock() - started_at, stationary, metadata=metadata)


def _stop_and_wait(client, run_id, state, clock, sleep, poll_interval_s, patience_s: float = 60.0):
    client.stop_run(uuid.uuid4().hex, run_id)
    deadline = clock() + patience_s
    while state["status"] not in TERMINAL_STATUSES and clock() < deadline:
        sleep(poll_interval_s)
        state = client.state()
    return state


def _confirm_stationary(client, state, sleep, poll_interval_s) -> Optional[bool]:
    """Два снимка после завершения: поза не меняется. None — позы нет, подтвердить нечем."""
    first = state.get("robot_pose")
    if first is None:
        return None
    sleep(poll_interval_s)
    second = client.state().get("robot_pose")
    if second is None:
        return None
    moved = max(abs(first["position_x_m"] - second["position_x_m"]),
                abs(first["position_y_m"] - second["position_y_m"]))
    return moved <= STILLNESS_TOLERANCE_M


def _read_journal(client, run_id) -> List[dict]:
    entries, cursor = [], 0
    while True:
        page = client.journal_page(run_id, cursor)
        entries += page["entries"]
        cursor = page["next_sequence"]
        if not page["has_more"]:
            return entries


def save_report(report: RunReport, output_dir: Path) -> Path:
    """Неудачные прогоны сохраняются так же полно, как успешные."""
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{report.scenario}-seed{report.seed}-{report.outcome}.json"
    path.write_text(json.dumps(report.to_json(), ensure_ascii=False, indent=1))
    return path
