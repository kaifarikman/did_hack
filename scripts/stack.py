#!/usr/bin/env python3
"""Запуск и остановка стека симуляции одной командой для любого из четырёх режимов.

  python3 scripts/stack.py up --robots 1|2 --map static|slam [--scenario easy|medium|hard] [--seed N]
  python3 scripts/stack.py down

Поднимает сервис simulation в изолированном проекте Compose, делает reset в нужный режим и ждёт готовности.
Порты и ROS-домен — через --env-file (см. infra/stack-b.env.example). Backend и панель этим скриптом не стартуют:
`docker compose -p <проект> up -d backend frontend`.
"""
import argparse
import json
import subprocess
import sys

RESET_SNIPPET = (
    "import json,sys,urllib.request as u;"
    "r=u.Request('http://localhost:7000/reset',data=sys.argv[1].encode(),headers={'Content-Type':'application/json'});"
    "print(u.urlopen(r,timeout=300).read().decode())")


def compose_command(project: str, env_file: str | None, *arguments: str) -> list:
    base = ["docker", "compose", "-p", project]
    return base + (["--env-file", env_file] if env_file else []) + list(arguments)


def reset_body(robots: int, map_mode: str, scenario: str, seed: int) -> str:
    return json.dumps({"seed": seed, "scenario": scenario, "map_mode": map_mode, "robots": robots})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["up", "down"])
    parser.add_argument("--robots", type=int, choices=[1, 2], default=1)
    parser.add_argument("--map", dest="map_mode", choices=["static", "slam"], default="static")
    parser.add_argument("--scenario", choices=["easy", "medium", "hard"], default="easy")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--project", default="did-a")
    parser.add_argument("--env-file")
    arguments = parser.parse_args()

    if arguments.action == "down":
        return subprocess.call(compose_command(arguments.project, arguments.env_file, "down"))
    up = subprocess.call(compose_command(arguments.project, arguments.env_file, "up", "-d", "--wait", "simulation"))
    if up != 0:
        return up
    body = reset_body(arguments.robots, arguments.map_mode, arguments.scenario, arguments.seed)
    return subprocess.call(compose_command(arguments.project, arguments.env_file, "exec", "-T", "simulation",
                                           "python3", "-c", RESET_SNIPPET, body))


if __name__ == "__main__":
    sys.exit(main())
