# Контракт F02 между средой (A) и агентом (B)

**Статус:** контракт F02 2.0 частично реализован; HTTP state schema 1.3 проверена 2026-10-08. Она добавляет top-level `robot_id`, независимые route/plan/map/model revisions и per-source freshness odom/scan/battery/clock. ROS bridge заполняет возраст и `fresh`, а отсутствующий источник остаётся `null`; контроллер держит нулевую команду во время startup grace и fails closed, если полный набор не появляется. Код — `backend/src/application/ports.py`, `backend/src/domain/{observations,mission,events,grid}.py`, `backend/src/adapters/http/serialization.py`; HTTP/ROS и frontend fixtures выровнены.

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
| `freshness` | Возраст и `fresh` отдельно для odom, scan, battery и clock. `null/null` — источник ещё не поступил; возраст выше порога отображается как `fresh=false`. |
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

### HTTP state schema 1.3

Каждый snapshot несёт `robot_id` (idle defaults to `robot_1`), общую `revision` и отдельные `route_revision`, `plan_revision`, `map_revision`, `model_revision`. Revisions монотонны внутри run и растут при соответствующем изменении; для команды top-level route/plan/model revisions суммируют участников, map revision берётся максимальный. `freshness` включает source objects `{age_s, fresh}`; у team snapshot такое же поле лежит у каждого робота. API producer выпускает 1.3. Frontend consumer мигрирует 1.0–1.2: для старых snapshots robot defaults to `robot_1`, revisions становятся 0, freshness — unknown (`null/null`); schema 2.x отвергается. Fixtures для state и team обновлены до 1.3.

## Путь совместимости MVP

Супервизор MVP принимает только seed и поднимает easy. Точка запуска оборачивает его в `adapters/legacy_reset.py`: easy + статичная карта + `robot_1` подтверждаются, иное — явный отказ, не тихий easy. `RosBridge` без изменений возвращает наблюдения с `generation=None` и `JudgeReply` без `outcome`; ядро продолжает работать.

## Фактическое состояние интеграции (2026-10-07)

- Reset-адаптер передаёт supervisor сценарий, seed, `map_mode`, число роботов и generation; ответ сверяется до выдачи `ResetAck`. Backend восстанавливает счётчик generation из готового supervisor после своего рестарта.
- Judge публикует публичные события с `sequence` и `robot_id`; bridge преобразует разрешённые события, удаляет повторы и читает публичный `/did/score`. Таймаут/недоступность collect/finish возвращается как `unknown`.
- Judge публикует generation для event/score, а события сохраняют исторические pose/time. Bridge отбрасывает события/score другого поколения; observations получают локальную sequence и sample age. HTTP API schema 1.3 публикует robot_id, generation/sequence, per-source freshness и domain revisions. Live isolated API показал schema 1.3 и свежие odom/scan/battery/clock; controlled Stop сохранил значения freshness в terminal snapshot. T02 закрыта; полный runtime по-прежнему открывает только easy/static/1.

## Оставшиеся проверки контракта 2.0

1. Инъецировать старые odom/scan/battery после reset и доказать отсутствие движения до свежего набора датчиков.
2. Приостановить Gazebo clock, измерить остановку команды, возобновить часы без продолжения старой команды.
3. Задержать живой collect/finish ROS service ответ через reset/Stop и подтвердить UNKNOWN без двойного исполнения и ложного completed.
4. Для SLAM — localization quality и `OccupancyGrid.revision`; для двух роботов — отдельные порты на каждый `robot_id`.

## Дополнение B4: SLAM (2026-10-07)

- `POST /runs` принимает `map_mode` (`static` по умолчанию, `slam`); `/health.supported_map_modes`. Точка запуска берёт режимы из `SUPPORTED_MAP_MODES` при `SIMULATION_CONTRACT=2.0`; путь совместимости — только `static`.
- `MapSource.load()` в SLAM может вернуть `None` в начале: робот стоит до `map_wait_s` (20 с), затем `failed: map_unavailable`. Готовая карта не подставляется.
- Каждая новая версия карты — новый `OccupancyGrid` с бо́льшим `revision`; размер и `origin` могут меняться. Ядро хранит измерения в координатах `world`, поэтому смена размера их не сдвигает. Ожидаемый идентификатор версии для панели: `map_id#r<revision>`.
- `localization`/`localization_error_m` наблюдения увеличивают запас возврата (`degraded` — минимум +20 %, ошибка в метрах — до +50 %).
- Скачок позы больше `pose_jump_m` (0.25 м) за тик считается коррекцией локализации: текущее измерение расхода отбрасывается, измерения сигнала с прошлой коррекции сдвигаются на ту же величину. Если A сможет публиковать явное событие коррекции с преобразованием, ядро заменит эвристику на него.
