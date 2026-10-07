"""Серия прогонов на подменной среде с полной выгрузкой каждого прогона, включая провалы.

Раскладка как в verification.md: artifacts/analysis/offline-series/<run_id>/{journal.jsonl,state.json,manifest.json}.
Скрытое расписание подменной среды пишется отдельно в truth.json — его читает только оценщик.
Запуск: PYTHONPATH=backend/src:backend/tests:scripts/analysis backend/.venv/bin/python scripts/analysis/offline_series.py [seed]
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

from fake_scenarios import make_world

from adapters.http.serialization import snapshot_json
from adapters.journal.jsonl import JsonlJournal
from domain.geometry import Point
from domain.profiles import settings_for_profile
from fakes import WorldChange, Zone
from harness import SETTINGS, make_controller, make_mission

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "artifacts" / "analysis" / "offline-series"


def hard_changes(world) -> list:
    """Скрытые изменения hard: грунт, опасность, датчик (времена после сброса)."""
    zone = world.zones[0]
    return [
        (60.0, WorldChange("hazard", hazard=Zone(Point(zone.center.x_m + 0.9, zone.center.y_m), 0.3, 0.0))),
        (90.0, WorldChange("terrain_up", zone_index=0, zone_energy_per_m=5.0)),
        (150.0, WorldChange("sensor_noise", sensor_mode="noisy", sensor_noise=0.25)),
        (175.0, WorldChange("sensor_ok", sensor_mode="ok")),
    ]


def run(profile: str, seed: int, commit: str) -> str:
    world = make_world(profile, seed)
    if profile == "hard":
        world._schedule = sorted(hard_changes(world), key=lambda item: item[0])
        world._apply_reset()
    run_id = f"{profile}-{seed}"
    folder = OUTPUT / run_id
    folder.mkdir(parents=True, exist_ok=True)
    journal = JsonlJournal(folder)
    controller, mission, _ = make_controller(
        world, world.clock, journal=journal, settings=settings_for_profile(profile, SETTINGS),
        mission=make_mission(run_id), events=world, score=world)
    mission.scenario = profile
    for _ in range(40000):
        world.advance()
        controller.tick()
        if mission.status.is_terminal:
            break
    (folder / f"{run_id}.jsonl").rename(folder / "journal.jsonl")
    (folder / "state.json").write_text(json.dumps(snapshot_json(mission.snapshot()), ensure_ascii=False))
    (folder / "manifest.json").write_text(json.dumps({
        "run_id": run_id, "profile": profile, "seed": seed, "map_mode": "static", "robot_count": 1,
        "planner": "fallback", "environment": "backend/tests/fakes.py (подменная среда, не Gazebo)", "commit": commit,
    }, ensure_ascii=False))
    applied = dict((label, t) for t, label in world.applied_changes)
    terrain_at = applied.get("terrain_up")
    def zone_travel(after: bool) -> float:
        return sum(step for t, index, step in world.zone_travel
                   if index == 0 and terrain_at is not None and (t >= terrain_at) == after)

    # изменение грунта наблюдаемо, только если агент знал прежний уровень: контакт до и после
    observable = {
        "terrain_up": terrain_at is not None and zone_travel(False) >= 0.6 and zone_travel(True) >= 0.6,
        "hazard": any(e.kind.value == "hazard_hit" for e in world.events),
        "sensor_noise": "sensor_noise" in applied,
    }
    (folder / "truth.json").write_text(json.dumps({
        "samples": [[p.x_m, p.y_m] for p in world._initial_samples],
        "applied_changes": [[t, label] for t, label in world.applied_changes],
        "observable": {label: value for label, value in observable.items() if label in applied},
        "judge": {"collected": world.collected, "finish_success": world.finish_success,
                  "false_collects": sum(1 for e in world.events if e.kind.value == "false_collect")},
    }, ensure_ascii=False))
    return run_id


def main() -> None:
    seeds = range(1, int(sys.argv[1]) + 1 if len(sys.argv) > 1 else 6)
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip()
    shutil.rmtree(OUTPUT, ignore_errors=True)
    for profile in ("easy", "medium", "hard"):
        for seed in seeds:
            print(run(profile, seed, commit), flush=True)


if __name__ == "__main__":
    main()
