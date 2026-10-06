#!/usr/bin/env python3
"""Запускает прогон через HTTP API, ждёт терминального состояния, сохраняет итог и журнал в artifacts/.

Использование: python3 scripts/run_mission.py SEED [BASE_URL]
"""
import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

TERMINAL = {"completed", "stopped", "failed"}


def call(base_url, path, body=None):
    request = urllib.request.Request(
        base_url + path, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    seed = int(sys.argv[1])
    base_url = (sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8080") + "/api/v1"
    state = call(base_url, "/runs", {"request_id": uuid.uuid4().hex, "scenario": "easy", "seed": seed})
    run_id = state["run_id"]
    while state["status"] not in TERMINAL:
        time.sleep(5)
        state = call(base_url, "/state")
    entries, cursor = [], 0
    while True:
        page = call(base_url, f"/runs/{run_id}/journal?after_sequence={cursor}&limit=200")
        entries += page["entries"]
        cursor = page["next_sequence"]
        if not page["has_more"]:
            break
    out = Path(__file__).resolve().parent.parent / "artifacts" / f"mission-seed{seed}-{run_id[:8]}.json"
    out.write_text(json.dumps({"final_state": state, "journal": entries}, ensure_ascii=False, indent=1))
    print(state["status"], "samples", state["samples_collected"], "battery", state["battery_remaining"],
          "planner", state["planner_mode"], "->", out)


if __name__ == "__main__":
    main()
