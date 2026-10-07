"""Канал «судья → страж скорости» для замедления на грунте.

Файл лежит во временном каталоге контейнера simulation и недоступен backend: истинные зоны
не попадают в ROS-топики и в общие тома. Страж только читает коэффициент для текущей позы.
"""
import json
import math
import os
from typing import Iterable, Tuple

Point = Tuple[float, float]
DEFAULT_STATE_PATH = "/tmp/did_soil_state.json"


def write_soil_state(path: str, base: Point, zones: Iterable, speed_factor: float) -> None:
    """Атомарная запись: страж никогда не читает полусохранённый файл."""
    content = {"base": list(base), "speed_factor": speed_factor,
               "zones": [[zone.center[0], zone.center[1], zone.radius_m] for zone in zones]}
    temporary_path = f"{path}.tmp"
    with open(temporary_path, "w", encoding="utf-8") as stream:
        json.dump(content, stream)
    os.replace(temporary_path, path)


def speed_factor_at(path: str, odom_x_m: float, odom_y_m: float) -> float:
    """Коэффициент линейной скорости в точке одометрии; 1.0, если состояния нет или оно повреждено."""
    try:
        with open(path, encoding="utf-8") as stream:
            state = json.load(stream)
        world_x = state["base"][0] + odom_x_m
        world_y = state["base"][1] + odom_y_m
        in_soil = any(math.hypot(world_x - x, world_y - y) <= radius for x, y, radius in state["zones"])
        return float(state["speed_factor"]) if in_soil else 1.0
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return 1.0
