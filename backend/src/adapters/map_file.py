"""Загрузка карты nav2 (YAML + PGM) в нормализованную сетку контракта."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

from domain.geometry import Pose
from domain.grid import OccupancyGrid

FREE, OCCUPIED, UNKNOWN = 0, 100, -1


def _read_pgm(path: Path) -> tuple[int, int, int, bytes]:
    raw = path.read_bytes()
    tokens: list[bytes] = []
    position = 0
    while len(tokens) < 4:
        while raw[position:position + 1].isspace():
            position += 1
        if raw[position:position + 1] == b"#":
            position = raw.index(b"\n", position)
            continue
        start = position
        while not raw[position:position + 1].isspace():
            position += 1
        tokens.append(raw[start:position])
    if tokens[0] != b"P5":
        raise ValueError("поддерживается только бинарный PGM (P5)")
    width, height, max_value = int(tokens[1]), int(tokens[2]), int(tokens[3])
    pixels = raw[position + 1:]
    if max_value > 255 or len(pixels) < width * height:
        raise ValueError("повреждённый PGM")
    return width, height, max_value, pixels[: width * height]


def _yaml_value(text: str, key: str) -> str:
    match = re.search(rf"^{key}:\s*(.+)$", text, re.MULTILINE)
    if match is None:
        raise ValueError(f"в карте нет поля {key}")
    return match.group(1).strip()


def load_nav2_map(yaml_path: Path) -> OccupancyGrid:
    text = yaml_path.read_text()
    image_path = yaml_path.parent / _yaml_value(text, "image")
    resolution_m = float(_yaml_value(text, "resolution"))
    origin_x, origin_y, origin_yaw = (float(part) for part in _yaml_value(text, "origin").strip("[]").split(","))
    occupied_threshold = float(_yaml_value(text, "occupied_thresh"))
    free_threshold = float(_yaml_value(text, "free_thresh"))
    negate = _yaml_value(text, "negate") in {"1", "true"}
    width, height, max_value, pixels = _read_pgm(image_path)

    cells: list[int] = []
    for row in range(height):  # PGM хранит верхнюю строку первой; контракт — по возрастанию Y
        source_row = height - 1 - row
        for column in range(width):
            value = pixels[source_row * width + column] / max_value
            occupancy = value if negate else 1.0 - value
            cells.append(OCCUPIED if occupancy > occupied_threshold else FREE if occupancy < free_threshold else UNKNOWN)
    digest = hashlib.sha1(pixels).hexdigest()[:8]
    return OccupancyGrid(f"{image_path.stem}-{digest}", resolution_m, width, height,
                         Pose(origin_x, origin_y, origin_yaw), cells)
