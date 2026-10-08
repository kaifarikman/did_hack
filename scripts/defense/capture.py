#!/usr/bin/env python3
"""Сохраняет свидетельства демо-прогона защиты в artifacts/defense/<метка>/.

  python3 scripts/defense/capture.py <метка> [--panel http://localhost:8090] [--run-id ID] [--note "..."]

Читает только публичный HTTP через прокси панели: health, state, сводку карты и полный журнал прогона.
Пишет manifest.json с commit, признаком незакоммиченных изменений, датой, Compose-проектом и образами.
Скриншоты, запись экрана и ROS-проверку неподвижности добавляют отдельно (см. scripts/defense/README.md).
Секреты не читаются: переменные окружения контейнеров не сохраняются.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
JOURNAL_PAGE_LIMIT = 100


def fetch_json(url: str) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def git_output(*arguments: str) -> str:
    return subprocess.run(["git", "-C", str(REPOSITORY_ROOT), *arguments],
                          capture_output=True, text=True, check=False).stdout.strip()


def working_tree_fingerprint() -> dict:
    """Опознаёт незакоммиченную версию: diff отслеживаемых файлов и содержимое новых файлов кода."""
    tracked_diff = subprocess.run(["git", "-C", str(REPOSITORY_ROOT), "diff", "HEAD", "--binary"],
                                  capture_output=True, check=False).stdout
    untracked = git_output("ls-files", "--others", "--exclude-standard", "--", "backend", "frontend",
                           "simulation", "infra", "compose.yaml").splitlines()
    digest = hashlib.sha256(tracked_diff)
    for path in sorted(untracked):
        digest.update(path.encode())
        digest.update((REPOSITORY_ROOT / path).read_bytes())
    return {"stash_commit": git_output("stash", "create") or None,
            "diff_and_untracked_sha256": digest.hexdigest(),
            "untracked_code_files": len(untracked)}


def compose_images(project: str) -> list[dict]:
    completed = subprocess.run(["docker", "compose", "-p", project, "images", "--format", "json"],
                               capture_output=True, text=True, check=False)
    if completed.returncode != 0 or not completed.stdout.strip():
        return []
    images = json.loads(completed.stdout)
    return [{"service": image.get("ContainerName"), "repository": image.get("Repository"),
             "tag": image.get("Tag"), "id": image.get("ID")} for image in images]


def read_journal(panel_url: str, run_id: str) -> list[dict]:
    entries: list[dict] = []
    after_sequence = 0
    while True:
        status, page = fetch_json(f"{panel_url}/api/v1/runs/{run_id}/journal"
                                  f"?after_sequence={after_sequence}&limit={JOURNAL_PAGE_LIMIT}")
        if status != 200:
            raise RuntimeError(f"журнал {run_id}: HTTP {status} {page}")
        entries.extend(page["entries"])
        if not page["has_more"]:
            return entries
        after_sequence = page["next_sequence"]


def map_summary(map_body: dict) -> dict:
    return {key: value for key, value in map_body.items() if key != "cells"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("label", help="имя папки, например 2026-10-08-live-1")
    parser.add_argument("--panel", default="http://localhost:8090")
    parser.add_argument("--project", default="did-defense")
    parser.add_argument("--run-id", help="по умолчанию — run_id текущего state")
    parser.add_argument("--note", default="", help="что проверялось и как (живой показ или запись)")
    arguments = parser.parse_args()

    out_dir = REPOSITORY_ROOT / "artifacts" / "defense" / arguments.label
    out_dir.mkdir(parents=True, exist_ok=True)

    health_status, health = fetch_json(f"{arguments.panel}/api/v1/health")
    state_status, state = fetch_json(f"{arguments.panel}/api/v1/state")
    map_status, map_body = fetch_json(f"{arguments.panel}/api/v1/map")
    run_id = arguments.run_id or state.get("run_id")
    journal = read_journal(arguments.panel, run_id) if run_id else []

    (out_dir / "health.json").write_text(json.dumps(health, ensure_ascii=False, indent=2) + "\n")
    (out_dir / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    (out_dir / "map-summary.json").write_text(
        json.dumps(map_summary(map_body), ensure_ascii=False, indent=2) + "\n")
    with (out_dir / "journal.jsonl").open("w") as journal_file:
        for entry in journal:
            journal_file.write(json.dumps(entry, ensure_ascii=False) + "\n")

    manifest = {
        "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "commit": git_output("rev-parse", "HEAD"),
        "working_tree_dirty": bool(git_output("status", "--porcelain")),
        "working_tree": working_tree_fingerprint(),
        "compose_project": arguments.project,
        "env_file": "scripts/defense/defense.env",
        "images": compose_images(arguments.project),
        "panel_url": arguments.panel,
        "http_status": {"health": health_status, "state": state_status, "map": map_status},
        "run_id": run_id,
        "status": state.get("status"),
        "schema_version": state.get("schema_version"),
        "task_type": state.get("task_type"),
        "journal_entries": len(journal),
        "note": arguments.note,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
