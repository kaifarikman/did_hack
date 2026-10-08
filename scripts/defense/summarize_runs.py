#!/usr/bin/env python3
"""Сводка демо-прогонов: исход по API, журнал, независимая ROS-запись и длительность по часам UI.

  python3 scripts/defense/summarize_runs.py artifacts/defense/<прогон>... [--panel http://localhost:8090]

Для каждой папки ui_drive.mjs: сохраняет journal.jsonl (GET журнала, только чтение) и ros-summary.json,
печатает строку JSON. Цель берётся из final-state.json, а не из заданных координат клика.
"""
import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ANALYZER = Path(__file__).with_name("analyze_record.py")


def read_journal(panel: str, run_id: str) -> list[dict]:
    entries, after = [], 0
    while True:
        url = f"{panel}/api/v1/runs/{run_id}/journal?after_sequence={after}&limit=100"
        with urllib.request.urlopen(url, timeout=10) as response:
            page = json.load(response)
        entries.extend(page["entries"])
        if not page["has_more"]:
            return entries
        after = page["next_sequence"]


def wall_clock_seconds(timeline: list[dict]) -> float | None:
    def moment(event: dict) -> datetime:
        return datetime.fromisoformat(event["time"].replace("Z", "+00:00"))
    starts = [event for event in timeline if event["event"] == "start_clicked"]
    ends = [event for event in timeline if event["event"] == "state"
            and event.get("status") in ("completed", "failed", "stopped")]
    return round((moment(ends[0]) - moment(starts[0])).total_seconds(), 1) if starts and ends else None


def summarize(run_dir: Path, panel: str) -> dict:
    state = json.loads((run_dir / "final-state.json").read_text())
    journal_path = run_dir / "journal.jsonl"
    try:
        journal = read_journal(panel, state["run_id"])
        with journal_path.open("w") as journal_file:
            for entry in journal:
                journal_file.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except urllib.error.HTTPError:
        # После перезапуска backend API не отдаёт старые прогоны; берём ранее сохранённый файл.
        journal = [json.loads(line) for line in journal_path.open()] if journal_path.exists() else []
    target = state["navigation"]["target"]
    summary = {"run": run_dir.name, "run_id": state["run_id"], "status": state["status"],
               "error": (state["last_error"] or {}).get("code"),
               "target": [target["position_x_m"], target["position_y_m"]],
               "target_reached_at_s": state["navigation"]["target_reached_at_s"],
               "simulation_time_s": state["simulation_time_s"], "battery": round(state["battery_remaining"], 2),
               "journal_entries": len(journal),
               "wall_clock_start_to_terminal_s": wall_clock_seconds(
                   [json.loads(line) for line in (run_dir / "timeline.jsonl").open()])}
    record = run_dir / "ros-record.jsonl"
    if record.exists() and record.stat().st_size:
        ros = subprocess.run([sys.executable, str(ANALYZER), str(record), str(target["position_x_m"]),
                              str(target["position_y_m"])], capture_output=True, text=True, check=True).stdout
        (run_dir / "ros-summary.json").write_text(ros)
        ros_summary = json.loads(ros)
        score = ros_summary["last_score"] or {}
        summary["ros"] = {"broken_lines": ros_summary["broken_lines"],
                          "closest_to_target_m": ros_summary["closest_to_target"]["distance_m"],
                          "end_to_base_m": ros_summary["last"]["distance_to_base_m"],
                          "judge_state": score.get("state"), "finish_success": score.get("finish_success"),
                          "collisions": score.get("collisions")}
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run_dirs", nargs="+")
    parser.add_argument("--panel", default="http://localhost:8090")
    arguments = parser.parse_args()
    for run_dir in arguments.run_dirs:
        print(json.dumps(summarize(Path(run_dir), arguments.panel), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
