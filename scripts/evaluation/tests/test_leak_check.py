import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from evaluation.leak_check import compose_violations, image_violations  # noqa: E402


def backend_with(volumes, environment=None):
    return {"services": {"backend": {"volumes": volumes, "environment": environment or {}},
                         "frontend": {}}}


def test_public_map_mount_is_allowed():
    config = backend_with([{"source": "/repo/simulation/judge/data", "target": "/w/data"}])
    assert compose_violations(config) == []


def test_judge_config_mount_is_a_leak():
    config = backend_with([{"source": "/repo/simulation/judge/config", "target": "/c"}])
    assert len(compose_violations(config)) == 1


def test_whole_simulation_mount_is_a_leak():
    assert compose_violations(backend_with([{"source": "/repo/simulation", "target": "/s"}]))


def test_suspicious_environment_variable_is_reported():
    assert compose_violations(backend_with([], {"JUDGE_CONFIG": "x"}))


def test_image_listing_with_judge_files_is_reported():
    listing = "/app/main.py\n/workspace/judge/config/local_hard.json\n/app/engine.py\n"
    assert len(image_violations(listing)) == 2


def test_clean_image_passes():
    assert image_violations("/app/main.py\n/usr/lib/x.so\n") == []


def test_similar_file_name_is_not_a_false_positive():
    assert image_violations("/usr/lib/python3/urllib3/contrib/appengine.py\n") == []
