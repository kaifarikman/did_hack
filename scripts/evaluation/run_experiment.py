#!/usr/bin/env python3
"""Серия прогонов: python3 scripts/evaluation/run_experiment.py --scenario hard --split control

Результаты: artifacts/evaluation/<метка>/ — по файлу на прогон и summary.json с версиями конфигурации.
Выбор сценария зависит от поддержки backend; отказ старта фиксируется как start_rejected.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from evaluation.harness import ApiClient, run_experiment, save_report  # noqa: E402

REPOSITORY = Path(__file__).resolve().parents[2]
CONFIG_FILES = ["compose.yaml", "simulation/judge/config/local_easy.json",
                "simulation/judge/config/local_medium.json", "simulation/judge/config/local_hard.json"]


class HttpApiClient(ApiClient):
    def __init__(self, base_url: str):
        self._base = base_url.rstrip("/") + "/api/v1"

    def _call(self, path, body=None):
        request = urllib.request.Request(
            self._base + path, data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"HTTP {error.code}: {error.read().decode()[:300]}") from error

    def start_run(self, request_id, scenario, seed):
        return self._call("/runs", {"request_id": request_id, "scenario": scenario, "seed": seed})

    def stop_run(self, request_id, run_id):
        return self._call(f"/runs/{run_id}/stop", {"request_id": request_id})

    def state(self):
        return self._call("/state")

    def journal_page(self, run_id, after_sequence):
        return self._call(f"/runs/{run_id}/journal?after_sequence={after_sequence}&limit=200")


def configuration_manifest() -> dict:
    def version_control(*arguments):
        return subprocess.run(["git", *arguments], cwd=REPOSITORY, capture_output=True, text=True).stdout.strip()

    hashes = {name: hashlib.sha256((REPOSITORY / name).read_bytes()).hexdigest()
              for name in CONFIG_FILES if (REPOSITORY / name).exists()}
    return {"commit": version_control("rev-parse", "HEAD"),
            "dirty": bool(version_control("status", "--porcelain")),
            "config_sha256": hashes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", default="easy", choices=["easy", "medium", "hard"])
    parser.add_argument("--split", default="tuning", choices=["tuning", "control"])
    parser.add_argument("--seeds", type=int, nargs="*", help="Переопределяет набор из seeds.json")
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--timeout-s", type=float, default=1800.0)
    parser.add_argument("--label", default=datetime.now().strftime("%Y%m%d-%H%M%S"))
    arguments = parser.parse_args()

    seeds = arguments.seeds or json.loads((Path(__file__).parent / "seeds.json").read_text())[arguments.split]
    output_dir = REPOSITORY / "artifacts" / "evaluation" / arguments.label
    manifest = configuration_manifest()
    client = HttpApiClient(arguments.base_url)
    rows = []
    for seed in seeds:
        report = run_experiment(client, arguments.scenario, seed, arguments.timeout_s,
                                metadata={"split": arguments.split, **manifest})
        path = save_report(report, output_dir)
        final = report.final_state or {}
        rows.append({"seed": seed, "outcome": report.outcome, "success": report.success,
                     "samples": final.get("samples_collected"), "battery": final.get("battery_remaining"),
                     "wall_time_s": round(report.wall_time_s, 1), "file": path.name})
        print(rows[-1], flush=True)
    summary = {"scenario": arguments.scenario, "split": arguments.split, "manifest": manifest, "runs": rows}
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print("summary ->", output_dir / "summary.json")
    sys.exit(0 if all(row["success"] for row in rows) else 1)


if __name__ == "__main__":
    main()
