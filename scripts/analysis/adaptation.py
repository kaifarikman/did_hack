"""Калибровка и проверка адаптации на подменной среде: обнаружение, задержка, ложные тревоги.

Запуск: backend/.venv/bin/python scripts/analysis/adaptation.py
Результат: artifacts/analysis/adaptation.json (все прогоны) и сводка в консоли.

Оценщик читает закрытый журнал подменной среды (`applied_changes`, `zone_travel`) только после
прогона; агент его не видит. Изменение засчитывается как наблюдаемое, если после него робот
проехал внутри зоны не меньше 0.6 м. Это проверка на модели, не Gazebo: пороги провизорные до
калибровки на публичных записях A.
"""
from __future__ import annotations

import json
import random
import statistics
import sys
from dataclasses import replace
from pathlib import Path

from fake_scenarios import make_world

from domain.change_detection import TerrainChangeDetector
from domain.geometry import Point, distance_m
from domain.profiles import settings_for_profile
from domain.subgoals import GoalKind, Subgoal
from fakes import FakeClock, ScriptedPlanner, SimWorld, WorldChange, Zone
from harness import SETTINGS, make_controller, make_mission, run_ticks

OUTPUT = Path(__file__).resolve().parents[2] / "artifacts" / "analysis" / "adaptation.json"
DETECTORS = {  # выбранная конфигурация — первая; остальные для сравнения
    "k0.75_h5_p2": dict(drift=0.75, threshold=5.0, min_passes=2),
    "k0.5_h4_p1": dict(drift=0.5, threshold=4.0, min_passes=1),
    "k0.5_h4_p2": dict(drift=0.5, threshold=4.0, min_passes=2),
}


def _with_detector(controller, options):
    controller._research._detector = TerrainChangeDetector(**options)


def _entries(journal, run_id):
    return [entry.draft for entry in journal.tail(run_id, 100000)]


def unchanged_runs(options, seeds):
    """Ложные тревоги: сценарии без скрытых изменений."""
    rows = []
    for profile in ("easy", "medium", "hard"):
        for seed in seeds:
            world = make_world(profile, seed)
            controller, mission, journal = make_controller(
                world, world.clock, settings=settings_for_profile(profile, SETTINGS), mission=make_mission(f"{profile}-{seed}"))
            _with_detector(controller, options)
            run_ticks(controller, world, mission, max_ticks=40000)
            drafts = _entries(journal, mission.run_id)
            terrain = [d for d in drafts if d.title.startswith("Обнаружено изменение грунта")]
            refuted = [d for d in drafts if d.detection_id and d.detection_id.startswith("terrain")
                       and d.conclusion and d.conclusion.startswith("Опровергнуто")]
            sensor = [d for d in drafts if d.title == "Подозрение на неисправность датчика"]
            rows.append({"profile": profile, "seed": seed, "status": mission.status.value,
                         "collected": world.collected, "terrain_alarms": len(terrain),
                         "terrain_alarms_refuted": len(refuted), "sensor_alarms": len(sensor)})
    return rows


def shuttle_world(seed, before, after, change_at_s=60.0):
    rng = random.Random(seed)
    zone = Zone(Point(-0.4 + rng.uniform(-0.2, 0.2), -1.5 + rng.uniform(-0.15, 0.15)), 0.6, before)
    world = SimWorld(FakeClock(), [Point(3.0, 2.5)], zones=[zone], battery=300.0, seed=seed,
                     rotation_energy_per_rad=0.1, signal_noise=0.03,
                     schedule=[(change_at_s, WorldChange("terrain", zone_index=0, zone_energy_per_m=after))])
    goals = [Subgoal(GoalKind.EXPLORE, Point(0.6, -1.5) if index % 2 == 0 else Point(-1.4, -1.5), "челнок", source="llm")
             for index in range(16)]
    return world, ScriptedPlanner(goals)


def terrain_change_runs(options, seeds):
    rows = []
    for direction, (before, after) in {"up": (1.0, 3.0), "down": (3.0, 1.0)}.items():
        for seed in seeds:
            world, planner = shuttle_world(seed, before, after)
            settings = replace(SETTINGS, battery_initial=300.0, max_decisions=400)
            controller, mission, journal = make_controller(world, world.clock, settings=settings, planner=planner,
                                                           mission=make_mission(f"shuttle-{direction}-{seed}"))
            _with_detector(controller, options)
            run_ticks(controller, world, mission, max_ticks=4000)
            changed_at = world.applied_changes[0][0] if world.applied_changes else None
            contact = sum(step for time, _, step in world.zone_travel if changed_at is not None and time >= changed_at)
            drafts = _entries(journal, mission.run_id)
            hits = [d for d in drafts if d.title.startswith("Обнаружено изменение грунта")
                    and changed_at is not None and d.simulation_time_s >= changed_at]
            early = [d for d in drafts if d.title.startswith("Обнаружено изменение грунта")
                     and (changed_at is None or d.simulation_time_s < changed_at)]
            first = hits[0] if hits else None
            travelled_before_detection = None
            if first is not None:
                travelled_before_detection = sum(step for time, _, step in world.zone_travel
                                                 if changed_at <= time <= first.simulation_time_s)
            correct_direction = first is not None and (("подорожал" in first.title) == (direction == "up"))
            rows.append({"direction": direction, "seed": seed, "observable": contact >= 0.6,
                         "contact_m": round(contact, 2), "detected": first is not None,
                         "correct_direction": correct_direction,
                         "delay_s": None if first is None else round(first.simulation_time_s - changed_at, 1),
                         "zone_travel_before_detection_m": None if first is None else round(travelled_before_detection, 2),
                         "false_before_change": len(early)})
    return rows


def sensor_runs(seeds):
    rows = []
    for mode, noise in (("noisy", 0.25), ("stuck", None), ("dropout", None)):
        for seed in seeds:
            world = make_world("medium", seed)
            world._schedule = [(40.0, WorldChange(f"sensor_{mode}", sensor_mode=mode, sensor_noise=noise)),
                               (52.0, WorldChange("sensor_ok", sensor_mode="ok"))]
            world._apply_reset()
            controller, mission, journal = make_controller(
                world, world.clock, settings=settings_for_profile("medium", SETTINGS), mission=make_mission(f"sensor-{mode}-{seed}"))
            run_ticks(controller, world, mission, max_ticks=40000)
            times = dict((label, time) for time, label in world.applied_changes)
            drafts = _entries(journal, mission.run_id)
            start, end = times.get(f"sensor_{mode}"), times.get("sensor_ok")
            suspected = [d for d in drafts if d.title == "Подозрение на неисправность датчика"
                         and start is not None and d.simulation_time_s >= start]
            recovered = [d for d in drafts if d.title == "Датчик в норме" and end is not None and d.simulation_time_s >= end]
            false_collects = sum(1 for event in world.events if event.kind.value == "false_collect"
                                 and start is not None and end is not None and start <= event.simulation_time_s <= end)
            rows.append({"mode": mode, "seed": seed, "fault_applied": start is not None,
                         "detected": bool(suspected), "delay_s": round(suspected[0].simulation_time_s - start, 1) if suspected else None,
                         "recovery_confirmed": bool(recovered),
                         "recovery_delay_s": round(recovered[0].simulation_time_s - end, 1) if recovered else None,
                         "false_collects_during_fault": false_collects, "status": mission.status.value,
                         "collected": world.collected})
    return rows


def summarize_terrain(rows):
    observable = [row for row in rows if row["observable"]]
    detected = [row for row in observable if row["detected"]]
    delays = [row["delay_s"] for row in detected]
    return {"observable": len(observable), "detected": len(detected),
            "correct_direction": sum(row["correct_direction"] for row in detected),
            "median_delay_s": statistics.median(delays) if delays else None,
            "median_zone_travel_before_detection_m": statistics.median(
                [row["zone_travel_before_detection_m"] for row in detected]) if detected else None,
            "false_before_change": sum(row["false_before_change"] for row in rows)}


def main() -> None:
    seeds = range(1, int(sys.argv[1]) + 1 if len(sys.argv) > 1 else 11)
    report = {"note": "подменная среда backend/tests/fakes.py; пороги провизорные до записей A", "detectors": {}}
    for name, options in DETECTORS.items():
        unchanged = unchanged_runs(options, seeds)
        changed = terrain_change_runs(options, seeds)
        summary = {
            "unchanged_runs": len(unchanged),
            "terrain_false_alarms": sum(row["terrain_alarms"] for row in unchanged),
            "terrain_false_alarms_refuted_by_check": sum(row["terrain_alarms_refuted"] for row in unchanged),
            "sensor_false_alarms": sum(row["sensor_alarms"] for row in unchanged),
            "mean_collected_unchanged": round(statistics.mean(row["collected"] for row in unchanged), 2),
            "terrain_up": summarize_terrain([row for row in changed if row["direction"] == "up"]),
            "terrain_down": summarize_terrain([row for row in changed if row["direction"] == "down"]),
        }
        report["detectors"][name] = {"options": options, "summary": summary, "unchanged": unchanged, "changed": changed}
        print(name, json.dumps(summary, ensure_ascii=False), flush=True)
    sensor = sensor_runs(seeds)
    report["sensor"] = {"all_runs": sensor, "summary": {
        mode: {"runs": len(rows), "detected": sum(r["detected"] for r in rows),
               "median_delay_s": statistics.median([r["delay_s"] for r in rows if r["detected"]]) if any(r["detected"] for r in rows) else None,
               "recovery_confirmed": sum(r["recovery_confirmed"] for r in rows),
               "false_collects_during_fault": sum(r["false_collects_during_fault"] for r in rows)}
        for mode in ("noisy", "stuck", "dropout")
        for rows in [[r for r in sensor if r["mode"] == mode]]
    }}
    print("sensor", json.dumps(report["sensor"]["summary"], ensure_ascii=False))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
