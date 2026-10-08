#!/usr/bin/env python3
"""Резервная запись показа из кадров ui_drive.mjs: панель и Gazebo рядом, подпись «запись», титры.

  python3 scripts/defense/build_video.py [--out artifacts/defense/backup-demo.mp4] [--speed 2]

Сегменты и подписи заданы в SEGMENTS. Подписи и титры рендерятся headless Chrome (HTML → PNG),
склейка — ffmpeg (hstack/vstack/concat). Видео честно помечено как запись с датой и ускорением.
"""
import argparse
import html
import subprocess
import tempfile
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DEFENSE = REPOSITORY_ROOT / "artifacts" / "defense"
HEIGHT = 720
PANEL_WIDTH = 1048   # 1456×1000 → высота 720
GAZEBO_CROP = "585:470:0:330"  # 3D-вид арены без боковой панели Gazebo: ширина:высота:x:y
GAZEBO_WIDTH = 896  # 585×470 → высота 720
WIDTH = PANEL_WIDTH + GAZEBO_WIDTH
BANNER_HEIGHT = 64
CARD_SECONDS = 3

SEGMENTS = [
    ("2026-10-08-rehearsal/1-main", "Цель пользователя (−1.73; 0.73)",
     "Клик по карте → путь A* → движение → цель достигнута → возврат → finish → completed"),
    ("2026-10-08-rehearsal/2-stop", "Stop во время движения",
     "Цель (0.48; −0.50), Stop на ходу → stopped; по ROS робот стоит, команда нулевая"),
    ("2026-10-08-rehearsal/3-wall", "Недостижимая цель",
     "Клик по столбу (0; 0) → backend отказывает, прогон не начинается, робот не двигается"),
    ("2026-10-08-live-7-disconnect", "Потеря связи с backend",
     "Контейнер backend остановлен → «Данные устарели», кнопки заблокированы → связь восстановилась"),
]

PAGE_STYLE = """
<style>
  html, body { margin: 0; background: #111614; color: #F3F5F2; font-family: Arial, sans-serif; }
  .banner { height: %dpx; display: flex; align-items: center; gap: 24px; padding: 0 28px; box-sizing: border-box; }
  .tag { background: #F28B82; color: #111614; font-weight: 700; padding: 6px 14px; border-radius: 999px; font-size: 22px; }
  .title { font-size: 26px; font-weight: 700; }
  .hint { font-size: 22px; color: #B5C2BB; }
  .card { height: %dpx; display: flex; flex-direction: column; justify-content: center; padding: 0 120px; gap: 28px; box-sizing: border-box; }
  .card h1 { font-size: 64px; margin: 0; }
  .card p { font-size: 32px; color: #B5C2BB; margin: 0; line-height: 1.4; }
  .accent { color: #2FBF71; }
</style>
""" % (BANNER_HEIGHT, HEIGHT + BANNER_HEIGHT)


def render_png(markup: str, size: tuple[int, int], target: Path, work_dir: Path) -> None:
    page = work_dir / (target.stem + ".html")
    page.write_text(f"<!doctype html><meta charset='utf-8'>{PAGE_STYLE}{markup}")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    f"--window-size={size[0]},{size[1]}", f"--screenshot={target}", page.as_uri()],
                   check=True, capture_output=True)


def banner_markup(title: str, hint: str, speed: float) -> str:
    return (f"<div class='banner'><span class='tag'>ЗАПИСЬ 08.10, ×{speed:g}</span>"
            f"<span class='title'>{html.escape(title)}</span><span class='hint'>{html.escape(hint)}</span></div>")


def card_markup(title: str, hint: str) -> str:
    return (f"<div class='card'><h1>{html.escape(title)}</h1><p>{html.escape(hint)}</p>"
            "<p>Запись репетиции на стенде <span class='accent'>did-defense</span>, 2026-10-08. "
            "Слева панель, справа Gazebo. Это не живой показ.</p></div>")


def ffmpeg(*arguments: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *arguments], check=True)


def build_segment(index: int, run: str, title: str, hint: str, speed: float, work_dir: Path) -> list[Path]:
    frames = DEFENSE / run / "frames"
    banner = work_dir / f"banner-{index}.png"
    card = work_dir / f"card-{index}.png"
    render_png(banner_markup(title, hint, speed), (WIDTH, BANNER_HEIGHT), banner, work_dir)
    render_png(card_markup(title, hint), (WIDTH, HEIGHT + BANNER_HEIGHT), card, work_dir)
    card_clip = work_dir / f"segment-{index}-a-card.mp4"
    ffmpeg("-loop", "1", "-t", str(CARD_SECONDS), "-i", str(card), "-r", "25",
           "-vf", f"scale={WIDTH}:{HEIGHT + BANNER_HEIGHT},format=yuv420p", "-c:v", "libx264", str(card_clip))
    body_clip = work_dir / f"segment-{index}-b-body.mp4"
    ffmpeg("-framerate", str(speed), "-i", str(frames / "panel-%04d.jpg"),
           "-framerate", str(speed), "-i", str(frames / "gazebo-%04d.jpg"),
           "-loop", "1", "-i", str(banner),
           "-filter_complex",
           f"[0:v]scale={PANEL_WIDTH}:{HEIGHT}[p];[1:v]crop={GAZEBO_CROP},scale={GAZEBO_WIDTH}:{HEIGHT}[g];[p][g]hstack[s];"
           f"[2:v]scale={WIDTH}:{BANNER_HEIGHT}[b];[b][s]vstack=shortest=1,fps=25,format=yuv420p[v]",
           "-map", "[v]", "-c:v", "libx264", "-shortest", str(body_clip))
    return [card_clip, body_clip]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(DEFENSE / "backup-demo-2026-10-08.mp4"))
    parser.add_argument("--speed", type=float, default=2.0, help="кадров в секунду; кадры сняты раз в ~1 с")
    arguments = parser.parse_args()
    with tempfile.TemporaryDirectory() as temporary:
        work_dir = Path(temporary)
        clips = []
        for index, (run, title, hint) in enumerate(SEGMENTS):
            clips.extend(build_segment(index, run, title, hint, arguments.speed, work_dir))
        concat_list = work_dir / "clips.txt"
        concat_list.write_text("".join(f"file '{clip}'\n" for clip in clips))
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", arguments.out)
    print(arguments.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
