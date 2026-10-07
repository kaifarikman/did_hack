"""Подбор лимитов поиска по профилям на подменной среде.

Запуск: backend/.venv/bin/python scripts/analysis/search_limits.py [число seed]
Результат: artifacts/analysis/search-limits.json — все прогоны, без отбора удачных.
Это проверка алгоритма на модели, а не физическое подтверждение в Gazebo.
"""
from __future__ import annotations

import json
import statistics
import sys
from dataclasses import asdict, replace
from pathlib import Path

from fake_scenarios import make_world

from domain.mission import MissionStatus
from domain.profiles import SEARCH_LIMITS, SearchLimits, settings_for_profile
from harness import SETTINGS, make_controller, make_mission, run_ticks

OUTPUT = Path(__file__).resolve().parents[2] / "artifacts" / "analysis" / "search-limits.json"
CANDIDATES = {
    "tight": lambda count: SearchLimits(max_false_collects=count, stall_decisions=20, max_decisions=40 + 15 * count),
    "table": None,  # значения из domain/profiles.py
    "loose": lambda count: SearchLimits(max_false_collects=2 * count, stall_decisions=45, max_decisions=60 + 30 * count),
}
SAMPLE_COUNT = {"easy": 3, "medium": 5, "hard": 7}


POLICIES = {  # переопределения MissionSettings при табличных лимитах
    "current": {},
    "safety_1.15": {"return_safety_factor": 1.15},
    "price_0.08": {"energy_price": 0.08},
    "reserve_2": {"return_reserve": 2.0},
    "collect_0.85": {"collect_signal_threshold": 0.85},
    "collect_0.75": {"collect_signal_threshold": 0.75},
}


def run_once(profile: str, seed: int, limits: SearchLimits, overrides: dict | None = None) -> dict:
    world = make_world(profile, seed)
    settings = replace(settings_for_profile(profile, SETTINGS, limits), **(overrides or {}))
    controller, mission, journal = make_controller(world, world.clock, settings=settings, mission=make_mission(f"{profile}-{seed}"))
    ticks = run_ticks(controller, world, mission, max_ticks=40000)
    snapshot = mission.snapshot()
    return {
        "profile": profile, "seed": seed, "status": snapshot.status.value,
        "error": snapshot.last_error.code if snapshot.last_error else None,
        "collected": world.collected, "false_collects": sum(1 for e in world.events if e.kind.value == "false_collect"),
        "battery_left": round(world.battery, 2), "simulated_s": round(ticks * 0.1, 1),
    }


def summarize(runs: list[dict]) -> dict:
    return {
        "runs": len(runs),
        "completed": sum(run["status"] == "completed" for run in runs),
        "mean_collected": round(statistics.mean(run["collected"] for run in runs), 2),
        "median_collected": statistics.median(run["collected"] for run in runs),
        "mean_false_collects": round(statistics.mean(run["false_collects"] for run in runs), 2),
        "mean_battery_left": round(statistics.mean(run["battery_left"] for run in runs), 2),
    }


def main() -> None:
    seeds = range(1, int(sys.argv[1]) + 1 if len(sys.argv) > 1 else 9)
    report = {"note": "подменная среда backend/tests/fakes.py; не Gazebo", "profiles": {}}
    for profile, count in SAMPLE_COUNT.items():
        report["profiles"][profile] = {}
        for name, make in CANDIDATES.items():
            limits = SEARCH_LIMITS[profile] if make is None else make(count)
            runs = [run_once(profile, seed, limits) for seed in seeds]
            report["profiles"][profile][name] = {"limits": asdict(limits), "summary": summarize(runs), "all_runs": runs}
            print(profile, name, summarize(runs), flush=True)
    report["policies"] = {}
    for profile in SAMPLE_COUNT:
        report["policies"][profile] = {}
        for name, overrides in POLICIES.items():
            runs = [run_once(profile, seed, SEARCH_LIMITS[profile], overrides) for seed in seeds]
            report["policies"][profile][name] = {"overrides": overrides, "summary": summarize(runs), "all_runs": runs}
            print(profile, "policy", name, summarize(runs), flush=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
