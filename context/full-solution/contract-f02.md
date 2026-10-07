# Контракт F02 между средой (A) и агентом (B)

**Статус:** версия `2.0` предложена B 2026-10-07, ожидает проверки реализуемости A. До подтверждения A ROS-адаптер работает через путь совместимости (ниже). Код — `backend/src/application/ports.py`, `backend/src/domain/{observations,events,grid}.py`; общие fixtures — `backend/tests/fixtures/contract/*.json`, загрузчики и проверки инвариантов — `backend/tests/contract_fixtures.py`.

Изменение сигнатур выпускается новой `CONTRACT_VERSION` вместе с fixtures. Fixture с другой версией не загружается.

## Наблюдение `Observation`

| Поле | Смысл |
| --- | --- |
| `robot_id` | Адресат; один робот — `robot_1`. Наблюдение чужого робота контроллер игнорирует. |
| `generation` | Поколение прогона из `ResetAck`. Другое поколение — позднее сообщение прошлого прогона, отбрасывается. `None` — адаптер без поколений (MVP). |
| `sequence` | Номер измерения адаптера внутри поколения. |
| `simulation_time_s` | Время симуляции. Физические эксперименты и события — по нему. |
| `received_monotonic_s` | Монотонное время процесса для **самого старого** критического источника (odom/scan/батарея/часы). Свежесть проверяет ядро. |
| `pose`, `battery_remaining` | Мир (`world`), метры/радианы; без них движение запрещено. NaN/inf → `None`. |
| `sample_signal`, `sample_signal_age_s` | 0..1 или `None`, если датчик молчит дольше допуска. Отсутствие сигнала **не** критично для движения, но запрещает сбор. |
| `localization`, `localization_error_m` | `ok`/`degraded`/`lost`. `lost` останавливает движение; без восстановления за `localization_recovery_s` (5 с) прогон `failed: localization_lost`. Статичная карта всегда `ok`. |
| `penalty_recent` | Устаревший флаг MVP; новые адаптеры публикуют события. |

## События `EventSource.events_after(sequence)`

Только `collision`, `false_collect`, `hazard_hit`, `sample_collected`. Поля: `sequence` (уникален в поколении), `kind`, `simulation_time_s`, `robot_id`, `generation`, `position` (поза робота по наблюдениям адаптера в момент события, не граница зоны), `battery_after`. Повторная доставка того же `sequence` учитывается один раз (`application/event_feed.py`). Расписание, тип скрытого изменения и параметры зон не передаются.

## Сброс `SimulationControl.reset(ResetRequest) -> ResetAck`

`ResetRequest(scenario, seed, generation, map_mode=static|slam, robot_ids)`. Адаптер блокирует до готовности и возвращает `ResetAck` с фактически применёнными значениями. Если `ack.matches(request)` ложно, прогон завершается `reset_mismatch`, движения нет. Исключение — `reset_failed`.

## Судья `collect`/`finish` → `JudgeReply(success, message, outcome)`

`outcome`: `succeeded`, `rejected`, `unknown` (таймаут/обрыв). Старый адаптер, не передающий `outcome`, получает его из `success`. При `unknown` ядро читает `ScoreSource.score() -> PublicScore(collected, finished, finish_success, ...)`: сбор засчитывается только при росте публичного счёта; `finish` — только при `finished` и `finish_success`. Повтор вслепую не делается, двойного начисления нет.

## Карта `MapSource.load() -> OccupancyGrid | None`

Добавлены `revision` (растёт при каждом изменении SLAM-карты; статичная — 0) и `frame_id` (только `world`). `None` — карты ещё нет: в SLAM это нормальное начало. Неизвестные клетки (`-1`) непроходимы для исполнителя.

## Среда и HTTP

`EnvironmentStatus.supported_scenarios()` — профили, которые среда реально применяет. `/api/v1/health` публикует `supported_scenarios`; запрос неподдерживаемого профиля — `409 scenario_unavailable`, неизвестного — `422`.

## Путь совместимости MVP

Супервизор MVP принимает только seed и поднимает easy. Точка запуска оборачивает его в `adapters/legacy_reset.py`: easy + статичная карта + `robot_1` подтверждаются, иное — явный отказ, не тихий easy. `RosBridge` без изменений возвращает наблюдения с `generation=None` и `JudgeReply` без `outcome`; ядро продолжает работать.

## Что нужно от A для перехода на 2.0

1. Супервизор принимает `scenario`, `map_mode`, `robot_ids`, `generation` и возвращает подтверждение; адаптер реализует `reset(ResetRequest)`. После этого точка запуска убирает обёртку и включает профили через `supported_scenarios`.
2. `RosBridge`: `generation` и `sequence` в наблюдениях, `sample_signal_age_s`, `events_after` с номерами событий, `score()` из `/did/score`, `JudgeReply(..., OperationOutcome.UNKNOWN)` при таймауте сервиса.
3. Для SLAM — `localization` и `OccupancyGrid.revision`; для двух роботов — отдельные экземпляры портов на каждый `robot_id`.
4. Тесты адаптеров A сравнивают свои преобразования с `contract_fixtures.load_*` и вызывают `assert_observation_valid`.
