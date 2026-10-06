import json

import pytest

from did_judge.config import JudgeConfig


def test_config_loads_overrides(tmp_path):
    path = tmp_path / "judge.json"
    path.write_text(json.dumps({"battery_initial": 30, "base_world_m": [1, 2]}))
    config = JudgeConfig.from_json_file(str(path))
    assert config.battery_initial == 30 and config.base_world_m == (1, 2)


def test_unknown_parameter_is_rejected(tmp_path):
    path = tmp_path / "judge.json"
    path.write_text(json.dumps({"mystery": 1}))
    with pytest.raises(ValueError):
        JudgeConfig.from_json_file(str(path))
