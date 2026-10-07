"""Миссии на строящейся карте (подменный SLAM) против готовой карты на тех же сценариях.

Запуск: PYTHONPATH=backend/src:backend/tests backend/.venv/bin/python scripts/analysis/slam_runs.py [seed]
Результат: artifacts/analysis/slam-runs.json. Подменный SLAM открывает эталонную карту в радиусе
обзора 1.5 м без шума и коррекций — проверяет логику разведки и возврата, а не SLAM Toolbox.
"""
from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

from fake_scenarios import make_world

from application.ports import MapMode
from domain.profiles import settings_for_profile
from fakes import GrowingMap, build_arena
from harness import SETTINGS, make_controller, make_mission

OUTPUT = Path(__file__).resolve().parents[2] / "artifacts" / "analysis" / "slam-runs.json"


def run(profile: str, seed: int, slam: bool) -> dict:
    world = make_world(profile, seed)
    maps = GrowingMap(build_arena(), lambda: world.pose) if slam else None
    controller, mission, journal = make_controller(
        world, world.clock, settings=settings_for_profile(profile, SETTINGS), mission=make_mission(f"{profile}-{seed}"),
        maps=maps, map_mode=MapMode.SLAM if slam else MapMode.STATIC)
    for _ in range(40000):
        world.advance()
        if maps is not None:
            maps.observe()
        controller.tick()
        if mission.status.is_terminal:
            break
    snapshot = mission.snapshot()
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 100000)]
    known = None
    if maps is not None and maps.load() is not None:
        known = round(sum(1 for cell in maps.load().cells if cell != -1) / len(maps.load().cells), 3)
    return {"profile": profile, "seed": seed, "map": "slam" if slam else "static", "status": snapshot.status.value,
            "error": snapshot.last_error.code if snapshot.last_error else None, "collected": world.collected,
            "battery_left": round(world.battery, 2), "map_revisions": maps.revision if maps else 0,
            "known_fraction": known, "replans_on_map_change": titles.count("Перепланирование")}


def main() -> None:
    seeds = range(1, int(sys.argv[1]) + 1 if len(sys.argv) > 1 else 9)
    rows = [run(profile, seed, slam) for profile in ("easy", "medium", "hard") for seed in seeds for slam in (False, True)]
    summary = {}
    for profile in ("easy", "medium", "hard"):
        for mode in ("static", "slam"):
            subset = [row for row in rows if row["profile"] == profile and row["map"] == mode]
            summary[f"{profile}/{mode}"] = {
                "runs": len(subset), "completed": sum(row["status"] == "completed" for row in subset),
                "mean_collected": round(statistics.mean(row["collected"] for row in subset), 2),
                "mean_battery_left": round(statistics.mean(row["battery_left"] for row in subset), 2),
            }
            print(f"{profile}/{mode}", summary[f"{profile}/{mode}"], flush=True)
    OUTPUT.write_text(json.dumps({"note": "подменный SLAM, не SLAM Toolbox", "summary": summary, "runs": rows},
                                 ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
