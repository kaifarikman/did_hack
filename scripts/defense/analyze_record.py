#!/usr/bin/env python3
"""Сводка пассивной ROS-записи демо-прогона: ближайшая к цели поза, конечная поза, команды и счёт судьи.

  python3 scripts/defense/analyze_record.py <ros-record.jsonl> <x> <y> [--base -2.0 -0.5]
"""
import argparse
import json
import math


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("record")
    parser.add_argument("x", type=float)
    parser.add_argument("y", type=float)
    parser.add_argument("--base", type=float, nargs=2, default=(-2.0, -0.5))
    arguments = parser.parse_args()
    rows, broken_lines = [], 0
    for line in open(arguments.record):
        try:
            rows.append(json.loads(line))
        except ValueError:
            broken_lines += 1  # обрыв или смешение записи; учитываем в сводке

    posed = [row for row in rows if row["world"] is not None]
    target = (arguments.x, arguments.y)
    closest = min(posed, key=lambda row: math.dist(row["world"], target))
    last = posed[-1]
    moving = [row for row in rows if any(abs(value) > 1e-6 for value in row["commands"].get("/agent/cmd_vel", [0, 0]))]
    summary = {
        "samples": len(rows),
        "broken_lines": broken_lines,
        "closest_to_target": {"world": closest["world"], "distance_m": round(math.dist(closest["world"], target), 3),
                              "host_time": closest["host_time"]},
        "last": {"world": last["world"], "distance_to_base_m": round(math.dist(last["world"], arguments.base), 3),
                 "commands": last["commands"]},
        "samples_with_nonzero_agent_command": len(moving),
        "last_score": last["score"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
