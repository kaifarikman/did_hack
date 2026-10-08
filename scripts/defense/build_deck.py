#!/usr/bin/env python3
"""Собирает presentation/defense.html из исходника слайдов и утверждённого стиля goatwhistle.html.

  python3 scripts/defense/build_deck.py

Из goatwhistle.html берутся вшитые шрифты, токены, хореография и управление (стрелки, R, N, F).
Слайды и их стили лежат в presentation/defense-source.html; маркер <!--MAP_SVG--> заменяется
картой artifacts/defense/targets-map.svg (см. pick_targets.py), чтобы на слайде была реальная карта.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
STYLE_SOURCE = REPOSITORY_ROOT / "presentation" / "goatwhistle.html"
SLIDES_SOURCE = REPOSITORY_ROOT / "presentation" / "defense-source.html"
MAP_SVG = REPOSITORY_ROOT / "artifacts" / "defense" / "targets-map.svg"
OUTPUT = REPOSITORY_ROOT / "presentation" / "defense.html"

BASE_STYLE_END = "  /* ---------- 1. Титульник ---------- */"
CONTROLS_STYLE_START = "  /* ---------- Управление ---------- */"
TAIL_START = '<aside class="notes"'


def between(text: str, start: str, end: str) -> str:
    start_index = text.index(start)
    return text[start_index:text.index(end, start_index)]


def main() -> int:
    style_html = STYLE_SOURCE.read_text()
    slides_html = SLIDES_SOURCE.read_text()

    style_open = style_html.index("<style>") + len("<style>")
    base_style = style_html[style_open:style_html.index(BASE_STYLE_END)]
    controls_style = between(style_html, CONTROLS_STYLE_START, "</style>")
    defs = between(style_html, '<svg width="0" height="0"', "<main")
    tail = style_html[style_html.index(TAIL_START):]

    slide_style = between(slides_html, "<style>", "</style>")[len("<style>"):]
    slide_body = between(slides_html, "<!--SLIDES-->", "<!--/SLIDES-->")[len("<!--SLIDES-->"):]
    title = re.search(r"<title>(.*?)</title>", slides_html).group(1)

    map_svg = MAP_SVG.read_text()
    map_svg = re.sub(r' width="\d+" height="\d+"', "", map_svg, count=1)
    map_svg = map_svg.replace("<svg ", '<svg class="real-map" role="img" '
                              'aria-label="Публичная карта арены: база, цели T1–T4 и пути A*" ', 1)
    slide_body = slide_body.replace("<!--MAP_SVG-->", map_svg)

    slide_count = slide_body.count('<section class="slide')
    tail = tail.replace('id="counter">1 / 4<', f'id="counter">1 / {slide_count}<')

    document = (
        '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{title}</title>\n<style>{base_style}{slide_style}\n{controls_style}</style>\n"
        '</head>\n<body>\n<div class="progress" aria-hidden="true"></div>\n\n'
        f'{defs}<main class="viewport">\n<div class="stage">\n{slide_body}\n</div>\n</main>\n\n{tail}'
    )
    OUTPUT.write_text(document)
    print(f"{OUTPUT.relative_to(REPOSITORY_ROOT)}: {slide_count} слайдов, {len(document) // 1024} КБ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
