# DID Hack: автономный ИИ-исследователь (MVP)

Запуск одной командой (проверено на macOS ARM64, Docker Desktop, нативный linux/arm64):

```bash
cp -n .env.example .env     # опционально; существующий .env сохраняется
docker compose up -d --build
```

- Панель: http://localhost:8080 (запуск easy, карта, батарея, подцели, журнал).
- Настоящий Gazebo: `docker compose --profile gui up -d gui` → http://localhost:6080/vnc.html.
- Прогон без браузера: `python3 scripts/run_mission.py SEED` (итог и журнал — в `artifacts/`).
- Журналы JSONL — том `journal` (`/data/journal` в backend), переживают перезапуск контейнера.
- Тесты backend: `cd backend && python -m pytest tests -q`; судья: см. `simulation/judge/README.md`.

Компоненты: `simulation` (Gazebo headless + локальный судья `/did/*` + guard скорости + супервизор reset),
`backend` (ядро, ROS-мост, LLM, HTTP `/api/v1`), `frontend`. Судья — `local`, формулы — допущения проекта.
Остановка робота: исполнитель обнуляет команды при Stop и устаревших наблюдениях, а `cmd_vel_guard`
останавливает робота при пропаже процесса backend.

Текущая реализация — MVP с одним роботом и сценарием easy. Medium/hard, полная адаптация,
SLAM и два робота входят в [план полного решения](context/full-solution/README.md).
Объяснение архитектуры простыми словами: [context/full-solution/explanation.md](context/full-solution/explanation.md).
