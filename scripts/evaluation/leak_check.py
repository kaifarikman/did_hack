#!/usr/bin/env python3
"""Проверка утечек закрытых данных судьи в сервисы агента (backend, frontend).

Закрытое: конфиги и код судьи, генератор сценариев, динамика hard. Допустима только карта `judge/data`.
Проверяется (1) конфигурация Compose: тома и переменные, (2) файловая система образов сервисов.

  python3 scripts/evaluation/leak_check.py            # Compose + образы
  python3 scripts/evaluation/leak_check.py --compose-only
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, List

REPOSITORY = Path(__file__).resolve().parents[2]
AGENT_SERVICES = ("backend", "frontend")
ALLOWED_SIMULATION_PATHS = ("simulation/judge/data",)
FORBIDDEN_FILE_PATTERNS = ("local_easy.json", "local_medium.json", "local_hard.json",
                           "dynamics.py", "soil_slowdown.py", "did_soil_state.json", "engine.py")
FORBIDDEN_ENV_MARKERS = ("SEED_TRUTH", "SCENARIO_FILE", "JUDGE_CONFIG", "SOIL")


def compose_violations(compose_config: dict) -> List[str]:
    """Тома агентских сервисов не должны давать доступ к simulation, кроме публичной карты."""
    violations = []
    for name in AGENT_SERVICES:
        service = compose_config.get("services", {}).get(name, {})
        for volume in service.get("volumes", []):
            source = str(volume.get("source", ""))
            if "simulation" in source and not _is_allowed(source):
                violations.append(f"{name}: том {source} открывает данные simulation")
        for variable in service.get("environment", {}):
            if any(marker in variable.upper() for marker in FORBIDDEN_ENV_MARKERS):
                violations.append(f"{name}: переменная окружения {variable} похожа на закрытую")
    return violations


def _is_allowed(source: str) -> bool:
    return any(source.rstrip("/").endswith(allowed) for allowed in ALLOWED_SIMULATION_PATHS)


def image_violations(file_listing: str) -> List[str]:
    return [f"образ содержит {line}" for line in file_listing.splitlines()
            if line.rsplit("/", 1)[-1] in FORBIDDEN_FILE_PATTERNS]


def _run(command: List[str]) -> str:
    return subprocess.run(command, cwd=REPOSITORY, capture_output=True, text=True, check=True).stdout


def image_exists(image: str) -> bool:
    return subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode == 0


def image_listing(image: str) -> str:
    return _run(["docker", "run", "--rm", "--entrypoint", "find", image, "/", "-xdev", "-type", "f"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-only", action="store_true")
    parser.add_argument("--image-prefix", help="Префикс образов, если проект Compose назван иначе (например did_hack)")
    arguments = parser.parse_args()
    compose_config = json.loads(_run(["docker", "compose", "config", "--format", "json"]))
    unverified = False
    problems: Dict[str, List[str]] = {"compose": compose_violations(compose_config)}
    if not arguments.compose_only:
        for name in AGENT_SERVICES:
            image = compose_config["services"][name].get("image") or \
                f"{arguments.image_prefix or compose_config['name']}-{name}"
            if not image_exists(image):
                print(f"image:{name}: НЕ ПРОВЕРЕН, образ {image} не собран")
                unverified = True
                continue
            problems[f"image:{name}"] = image_violations(image_listing(image))
    for scope, found in problems.items():
        print(f"{scope}: {'OK' if not found else 'УТЕЧКА'}")
        for item in found:
            print("  -", item)
    if any(problems.values()):
        return 1
    return 2 if unverified else 0


if __name__ == "__main__":
    sys.exit(main())
