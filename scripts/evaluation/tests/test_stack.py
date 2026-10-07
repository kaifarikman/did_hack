import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from stack import compose_command, reset_body  # noqa: E402


def test_reset_body_covers_every_mode():
    body = json.loads(reset_body(2, "slam", "hard", 7))
    assert body == {"seed": 7, "scenario": "hard", "map_mode": "slam", "robots": 2}


def test_compose_command_uses_project_and_optional_env_file():
    assert compose_command("did-a", None, "down") == ["docker", "compose", "-p", "did-a", "down"]
    assert compose_command("did-b", "x.env", "up")[:6] == ["docker", "compose", "-p", "did-b", "--env-file", "x.env"]
