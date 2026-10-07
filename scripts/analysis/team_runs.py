"""Польза координации: два робота с координацией против двух независимых при равном бюджете.

Запуск: PYTHONPATH=backend/src:backend/tests backend/.venv/bin/python scripts/analysis/team_runs.py [seed]
Результат: artifacts/analysis/team-runs.json. Обе конфигурации — одинаковые сценарии, старты и
батареи (по 60 у каждого), независимые роботы так же уступают дорогу (безопасность), но не
бронируют цели и не делятся наблюдениями. Подменная среда без физики столкновений и без грунтов.
"""
from __future__ import annotations

import json
import random
import statistics
import sys
from pathlib import Path

from domain.geometry import Point, Pose, distance_m
from domain.profiles import PUBLIC_PROFILES, settings_for_profile
from fakes import FakeClock, TeamWorld, build_arena
from harness import SETTINGS, make_team_service

OUTPUT = Path(__file__).resolve().parents[2] / "artifacts" / "analysis" / "team-runs.json"
STARTS = {"robot_1": Pose(-2.0, -0.5, 0.0), "robot_2": Pose(-2.0, 0.4, 0.0)}


def samples_for(profile: str, seed: int) -> list[Point]:
    rng = random.Random(f"team-{profile}-{seed}")
    grid, chosen = build_arena(), []
    blocked = grid.inflated_blocked(0.21)
    while len(chosen) < PUBLIC_PROFILES[profile].sample_count:
        point = Point(rng.uniform(-3.5, 3.5), rng.uniform(-2.5, 2.5))
        cell = grid.world_to_cell(point)
        if cell is None or grid.index(*cell) in blocked:
            continue
        if any(distance_m(point, start.point) < 0.8 for start in STARTS.values()):
            continue
        if any(distance_m(point, other) < 0.8 for other in chosen):
            continue
        chosen.append(point)
    return chosen


def overlap(first: tuple, second: tuple, radius: float = 0.4) -> float:
    """Доля пути второго робота в пределах radius от пути первого: повторное покрытие."""
    if not second:
        return 0.0
    near = sum(1 for p in second[::5] if any(distance_m(p, q) < radius for q in first[::5]))
    return near / len(second[::5])


def run(profile: str, seed: int, coordinated: bool) -> dict:
    clock = FakeClock()
    team = TeamWorld(clock, samples_for(profile, seed), STARTS, seed=seed)
    service, journal, _ = make_team_service(team, clock, settings=settings_for_profile(profile, SETTINGS))
    run_id = service.start_run("r", profile, seed, robot_count=2, coordinated=coordinated).run_id
    for _ in range(60000):
        team.advance()
        service.tick()
        if service.state().status.is_terminal:
            break
    state = service.state()
    robots = {robot.robot_id: robot for robot in state.team.robots}
    titles = [entry.draft.title for entry in journal.tail(run_id, 100000)]
    return {
        "profile": profile, "seed": seed, "coordinated": coordinated, "outcome": state.team.outcome,
        "collected": team.total_collected, "collected_by": dict(team.collected_by),
        "both_returned": all(r.status.value == "completed" for r in robots.values()),
        "false_collects": sum(1 for e in team.events if e.kind.value == "false_collect"),
        "overlap_robot2_on_robot1": round(overlap(robots["robot_1"].trajectory, robots["robot_2"].trajectory), 3),
        "yield_events": titles.count("Уступаем дорогу"), "deadlocks": titles.count("Взаимная блокировка"),
        "battery_left": {rid: round(team.robots[rid].battery, 2) for rid in team.robots},
    }


def main() -> None:
    seeds = range(1, int(sys.argv[1]) + 1 if len(sys.argv) > 1 else 9)
    rows = [run(profile, seed, coordinated) for profile in ("easy", "medium", "hard") for seed in seeds
            for coordinated in (True, False)]
    summary = {}
    for profile in ("easy", "medium", "hard"):
        for coordinated in (True, False):
            subset = [r for r in rows if r["profile"] == profile and r["coordinated"] == coordinated]
            key = f"{profile}/{'coordinated' if coordinated else 'independent'}"
            summary[key] = {
                "runs": len(subset), "success": sum(r["outcome"] == "success" for r in subset),
                "both_returned": sum(r["both_returned"] for r in subset),
                "mean_collected": round(statistics.mean(r["collected"] for r in subset), 2),
                "mean_false_collects": round(statistics.mean(r["false_collects"] for r in subset), 2),
                "mean_overlap": round(statistics.mean(r["overlap_robot2_on_robot1"] for r in subset), 3),
                "deadlocks": sum(r["deadlocks"] for r in subset),
            }
            print(key, summary[key], flush=True)
        paired = [
            next(r for r in rows if r["profile"] == profile and r["seed"] == s and r["coordinated"])["collected"]
            - next(r for r in rows if r["profile"] == profile and r["seed"] == s and not r["coordinated"])["collected"]
            for s in seeds
        ]
        summary[f"{profile}/paired_difference"] = {"mean": round(statistics.mean(paired), 2), "values": paired}
        print(profile, "paired", summary[f"{profile}/paired_difference"], flush=True)
    OUTPUT.write_text(json.dumps({"note": "подменная среда TeamWorld; равные батареи; не Gazebo",
                                  "summary": summary, "runs": rows}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
