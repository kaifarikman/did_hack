# Журнал процесса B

Реальные шаги исполнителя B: что сделано, чем проверено, что осталось. Записи добавляются по ходу работы, задним числом не восстанавливаются.

## 2026-10-07

- Старт в отдельном worktree `../did_hack-b`, ветка `agent-b` от `585c4d1`. Незакоммиченный `bridge.py` основной копии не трогаю: он у A/исполнителя MVP.
- Базовая проверка до изменений: `backend` — 83 passed (без `test_ros_lifecycle.py`, он не закоммичен в `main`).
- **B0 / контракт F02.** Добавлены `robot_id`, `generation`, `sequence`, свежесть датчика и качество локализации в `Observation`; типизированные события и `EventFeed` с дедупликацией; `ResetRequest/ResetAck` с поколением; `OperationOutcome.unknown` и сверка по `PublicScore`; `revision/frame_id` карты; `supported_scenarios`. Старый супервизор подключён через `LegacySimulationControl`, который отклоняет всё, кроме easy. Fixtures — `backend/tests/fixtures/contract`. Проверка: 99 passed.
- **B0 / подменная среда.** `SimWorld` получил расписание скрытых изменений (`WorldChange`: стоимость зоны, опасность, режим датчика ok/noisy/stuck/dropout), расход на поворот и `hazard_hit`; добавлены `GrowingMap` (подменный SLAM с ростом `revision`) и `TeamWorld` (атомарный общий судья). Старые проверки миссии не менялись. Проверка: 104 passed.
- **B0 / точка запуска, HTTP, UI.** `SIMULATION_CONTRACT=2.0` включает адаптер A без обёртки и профили из `SUPPORTED_SCENARIOS`; по умолчанию — путь совместимости easy. События/счёт подключаются, если мост их реализует. `/health.supported_scenarios`, `409 scenario_unavailable`; панель выбирает профиль, недоступные отключены. Проверка: backend 104 passed локально; в образе `did_hack-backend` импорт `entrypoint` с rclpy успешен (5 тестов там падают только из-за несмонтированных `context/` и `simulation/`); frontend 78 passed, `tsc` без ошибок.
