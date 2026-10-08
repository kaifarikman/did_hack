import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRESENTATION = ROOT / "presentation"
SOURCE = PRESENTATION / "loam-source.html"
OUTPUT = PRESENTATION / "loam.html"
MAP_PGM = ROOT / "simulation" / "judge" / "data" / "map.pgm"
MAP_SCRIPT = PRESENTATION / "assets" / "map-grid.js"

CROP_COLUMNS = (136, 259)
CROP_ROWS = (128, 241)
RESOLUTION = 0.05
ORIGIN = (-10.0, -10.0)
MIME_TYPES = {".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml"}


def read_pgm(path: Path) -> tuple[int, int, bytes]:
    raw = path.read_bytes()
    header_lines = [line for line in raw.split(b"\n")[:6] if not line.startswith(b"#")]
    width, height = map(int, header_lines[1].split())
    return width, height, raw[len(raw) - width * height :]


def cell_symbol(value: int) -> str:
    if value < 100:
        return "#"
    if value > 250:
        return "."
    return " "


def build_map_script() -> str:
    width, height, pixels = read_pgm(MAP_PGM)
    rows = [
        "".join(cell_symbol(pixels[row * width + column]) for column in range(*CROP_COLUMNS))
        for row in range(*CROP_ROWS)
    ]
    grid = {
        "column0": CROP_COLUMNS[0],
        "row0": CROP_ROWS[0],
        "fullHeight": height,
        "resolution": RESOLUTION,
        "origin": ORIGIN,
        "rows": rows,
    }
    return "window.LOAM_MAP = " + json.dumps(grid, ensure_ascii=False) + ";\n"


def data_uri(relative_path: str) -> str:
    asset = PRESENTATION / relative_path
    mime = MIME_TYPES[asset.suffix.lower()]
    return f"data:{mime};base64,{base64.b64encode(asset.read_bytes()).decode('ascii')}"


def inline_assets(html: str) -> str:
    html = re.sub(r'url\("?(fonts/[^")]+)"?\)', lambda match: f'url("{data_uri(match.group(1))}")', html)
    html = re.sub(r'src="(assets/[^"]+\.(?:jpg|png|svg))"', lambda match: f'src="{data_uri(match.group(1))}"', html)
    map_tag = '<script src="assets/map-grid.js"></script>'
    return html.replace(map_tag, "<script>" + MAP_SCRIPT.read_text(encoding="utf-8") + "</script>")


def main() -> int:
    MAP_SCRIPT.write_text(build_map_script(), encoding="utf-8")
    OUTPUT.write_text(inline_assets(SOURCE.read_text(encoding="utf-8")), encoding="utf-8")
    print(f"{OUTPUT.relative_to(ROOT)}: {OUTPUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
