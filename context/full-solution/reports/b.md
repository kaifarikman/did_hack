# Отчёт потока B (промежуточный, 2026-10-07)

Ветка `agent-b`, worktree `../did_hack-b`. Журнал процесса — [b-process.md](b-process.md).

| Задача | Статус | Свидетельства |
| --- | --- | --- |
| B0 контракт F02, подменная среда, профили в HTTP/UI | Сделано; ждёт проверки A | `contract-f02.md`, `backend/tests/fixtures/contract` |
| B1 модель расхода, поиск, цена энергии | Сделано на модели | `artifacts/analysis/search-limits.md` |
| B2 научный цикл, изменения, опасности, датчик | Сделано на модели; удешевление 6/10 при цели 9/10 | `artifacts/analysis/adaptation.md` |
| B3 план LLM, контракт 1.1, панель | Сделано; рубеж 1 с A не пройден | `artifacts/analysis/offline-stand/` |
| B4 SLAM | Сделано на подменном SLAM; рубеж 2 с A не пройден | `artifacts/analysis/slam-runs.json` |
| B5 два робота | Сделано на модели; рубежи 3–4 с A не пройдены, польза координации не доказана | `artifacts/analysis/team-runs.md` |
| B6 метрики, скилл, питч | Метрики и скилл готовы; питч — черновик; видео с A не записано | `scripts/analysis/metrics.py`, `.agents/skills/research-run`, `presentation/` |

Тесты на последнем коммите: backend 159 passed, frontend 87 passed, tsc без ошибок. Все цифры, кроме приёмки MVP, получены на подменной среде, не в Gazebo.

**Открыто:** совместные рубежи с A (medium/hard в supervisor, SLAM Toolbox, мосты двух роботов), калибровка порогов по записям A, полная серия по `verification.md`, `presentation/evidence.md` со ссылками на каждую цифру, резервное видео. Итоговые пересчёты `search_limits.py`/`adaptation.py` сохранены и сверены с текстами отчётов при объединении: базовая политика 12/12 успехов в каждом профиле на модели; удешевление грунта обнаружено в 6/10 случаях, цель 9/10 остаётся открытой.
