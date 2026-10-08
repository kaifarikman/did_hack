# Проверка объединения A/B — 2026-10-07

## Что объединено

- `worktree-agent-a`, исходная вершина `716983b`: профили среды, скрытые события, судья, SLAM, два робота, карты и испытательный стенд. Merge `c86dc9f`.
- `agent-b`, вершина `ac15f0f`: исследования, адаптация, многошаговые планы, координация, панель, офлайн-стенд и метрики. Merge `9a79597`.
- Локальные правки основной папки сохранены в `700b6cd`: приёмка, завершение ROS, контекст, архитектура HTML и материалы.
- Конфликты документации разрешены с сохранением актуальных отчётов и протокола приёмки. Вложенный worktree исключён из индекса; локальный `.env` не добавлен. Проверка новых staged-файлов на значения настроенных секретов не выявила совпадений.

## Выполненные проверки

| Проверка | Результат | Граница |
| --- | --- | --- |
| `backend/.venv/bin/python -m pytest tests -q` из backend | 165 passed, 1 skipped | На объединённом A/B; модуль настоящего ROS пропущен на хосте |
| `pytest simulation/judge/tests simulation/mapping/tests scripts/evaluation/tests -q` | 114 passed | После A; B эти компоненты не менял |
| `npm run build` из frontend | Успешно | TypeScript и Vite |
| `npm test` из frontend | 87 passed | На объединённом A/B |

Предупреждение Starlette об устаревающем использовании httpx не мешает тестам. Свежая совместная миссия Gazebo в этой проверке не запускалась. Исторические реальные прогоны и отдельные проверки A не являются доказательством работы нового автономного агента во всех режимах.

После изменений 2026-10-07 повторно прошёл полный backend-набор: 169 passed, 1 skipped (rclpy отсутствует на хосте). Точечная повторная проверка reset и F02: 22 passed. `git diff --check` чистый. Живые Compose-контейнеры не соответствуют текущему worktree: их ROS domain/partition отличаются от `compose.yaml`, `/status` возвращает старую схему, а попытка supervisor reset завершилась таймаутом. Поэтому контейнеры не перезапускались и живой сквозной результат не заявляется.

## Повторная проверка на изолированном стеке

Текущий worktree собран в отдельном Compose-проекте `didhack-validation` с ROS domain `81` и Gazebo partition `did-validation`; ранее работавшие контейнеры не затрагивались.

- Статические проверки: backend — 169 passed, 1 skipped; судья в ROS-контейнере — 94 passed; evaluation harness — 14 passed; `docker compose config -q` и compose-only leak check успешны.
- `GET /api/v1/health` показал ready, ROS connected, только easy/static/1. Supervisor reset seed 7 вернул `state=ready` и точное совпадение сценария, карты и количества роботов; ROS публиковал `/did/score`, `/did/events`, необходимые датчики, команду и одометрию.
- Сквозная миссия easy, seed 7, завершилась `completed`: собран 1 образец, батарея 50.97/60, судья подтвердил возврат. Ложных сборов и ошибок не было. В журнале 13 запросов плана; 12 получили fallback-причину из-за недоступности/таймаута сети, один план пришёл от LLM. Это одиночный интеграционный прогон, не статистика качества или доказательство стабильной доступности LLM. Сырой state и журнал сохранены в [easy-seed7.json](../../../artifacts/evaluation/integration-2026-10-07/easy-seed7.json), метрики — рядом.
- После завершённой миссии отдельная команда движения прошла 0.493 м, а батарея осталась неизменной: это ожидаемо, потому что судья замораживает расход после finish. Повтор после reset в активной миссии прошёл 0.493 м за 5 с при 0.1 м/с, израсходовал 0.486 единиц батареи, дрейф после stop — 0.0001 м. Проверка записана в [ros-check.json](../../../artifacts/evaluation/integration-2026-10-07/ros-check.json).
- Отдельный UI Stop проверен на первом прогоне: API перевёл миссию в `stopped`, ROS-команда после остановки имела нулевые линейную и угловую скорости.

### Дополнение T02: generation в supervisor и judge

В изолированном Compose-проекте `didhack-t02` (ROS domain 82, Gazebo partition `did-t02`) после изменений supervisor reset seed 7 вернул `state=ready` и `generation=42`; свежий `/did/score` от local judge содержал `generation: 42` и `simulation_time_s: 16.35`. Изолированная easy-миссия через backend API стартовала и дошла до running с новыми ROS pose/battery/scan; Stop достиг терминального `stopped` при simulation time 46.605. Проверки кода: backend 176 passed / 1 skipped (ROS lifecycle на хосте), judge 94 passed в ROS-контейнере, `py_compile` supervisor/judge и `git diff --check` чисты.

На этом этапе это подтверждало только передачу generation до judge и его score. Более поздние live-проверки ниже закрыли проверку generation/sequence/freshness API, живого event и старой телеметрии; остаются задержанный service response и pause-clock во время движения. Кэш bridge очищается до и после подтверждённого reset, чтобы сообщения старого judge между остановкой/запуском не пережили смену поколения. Event payload содержит generation и pose/time snapshot из judge engine.

Повторная изолированная серия после реализации generation в supervisor/judge: два backend запуска без перезапуска контейнеров, поколения 1 и 2. Первый получил свежие pose/battery при sim time 13.883 и завершил Stop на 35.488; второй после reset получил pose/battery при sim time 16.9. Снимок подтверждает рестарт sim-time к низкому значению, но не проверяет остановленные часы, ручную инъекцию старых сообщений или judge events. Машиночитаемый результат: [live-check.json](../../../artifacts/evaluation/t02-generation-2026-10-07/live-check.json), SHA-256 `6806e204f65ef444d7e44f87f7edaa83de663d87a3bd94604ad37119d4d35ceb`. После всех изменений полный backend — 177 passed / 1 skipped, ROS judge — 94 passed.

Дополнительные результаты T02 после расширения контрактов: backend после пересоздания восстановил поколение supervisor и выдал следующее (generation 1 → backend restart → 2; затем API generation 6 совпал с supervisor). Реальный `/did/events` collision probe изолированного ROS-домена содержал sequence, generation, robot_id, pose snapshot, event simulation time и battery; API schema 1.2 показывает generation, observation sequence и возраст sample signal. Артефакты: [restart-check.json](../../../artifacts/evaluation/t02-generation-2026-10-07/restart-check.json), [event-check.json](../../../artifacts/evaluation/t02-generation-2026-10-07/event-check.json), [schema-check.json](../../../artifacts/evaluation/t02-generation-2026-10-07/schema-check.json). Текущая проверка на тот момент: backend 182 passed / 2 skipped, frontend 87 passed и build успешен, judge ROS 95 passed, bridge callbacks в Jazzy 6 passed. Следующее дополнение фиксирует расширенную проверку.

Следующий live цикл T02: backend 183 passed / 2 skipped, judge 95 passed, ROS callbacks 9 passed. В isolated generation 7 опубликованы три сообщения предыдущего поколения: telemetry с battery 0/signal 0.99, odom x=100 и scan с timestamp 120; API snapshot сохранил реальную батарею 59.984, сигнал 0.379 и pose около базы, sequence продолжила расти. Артефакт [stale-injection-check.json](../../../artifacts/evaluation/t02-generation-2026-10-07/stale-injection-check.json). Для generation 8 пауза `/world/default/control` привела к `failed: observations_stale`, опубликованный cmd_vel был нулевым; после unpause clock возобновился, run остался failed и команда осталась нулевой. Робот стоял до паузы; более сильная проверка при движении приведена ниже. Артефакт [pause-clock-check.json](../../../artifacts/evaluation/t02-generation-2026-10-07/pause-clock-check.json).

Повтор T02 generation 11 проверил pause-clock во время движения: после вызова /world/default/control с pause:true часы остановились на 15.571, миссия завершилась failed: observations_stale, pose застыла; после unpause ROS /agent/cmd_vel выдал нулевой TwistStamped, run не возобновился. Артефакт [pause-moving-clock-check.json](../../../artifacts/evaluation/t02-generation-2026-10-07/pause-moving-clock-check.json), SHA-256 db84250f8ace355bb3bb3978fc718dfb24e74a17df6d6a5665bc02c545a6cf43.
Задержанный finish T02 проверен на живом ROS: RosBridge.begin_finish вызвал настоящий judge через временный proxy, который удержал success=True; supervisor reset easy/static/1 применил generation 0→1; после bridge.set_generation(1) операция вернула unknown как до, так и после release позднего ответа. Артефакт [delayed-finish-reset-check.json](../../../artifacts/evaluation/t02-generation-2026-10-07/delayed-finish-reset-check.json), SHA-256 e958e040eaa7f05e2be546af3526299afbc5b325ad92a7b50b1d974caf954f1f. Probe вызывал адаптер напрямую, не естественный MissionController return; контроллер отдельно проверен на pending finish + Stop и stale observations. Backend async update: 185 passed / 2 skipped; ROS bridge callbacks 11 passed; judge 95 passed. T02 закрыта.

Проверка подтверждает базовый один-роботный easy/static цикл, supervisor reset и generation для ROS-сообщений, происхождение событий, отбрасывание старой телеметрии, fail-safe при paused clock и delayed judge response через reset. Следующие незакрытые стыки: повторяемый lifecycle, интеграция SLAM-карты и два отдельных bridge, совместный SLAM, автономные серии medium/hard, неизвестные seeds и научная адаптация на физическом ROS.

## Что действительно осталось

1. **Контракт сброса и ROS.** Адаптер `SupervisorSimulationControl` приведён к `reset(ResetRequest) -> ResetAck`: отправляет профиль, seed, режим карты и число роботов; подтверждает только ответ `state=ready` с совпавшими параметрами; отклоняет неверные ID роботов. Точка сборки использует этот порт, но публикует только easy/static/1, поскольку ROS-телеметрия пока не несёт generation и bridge остаётся однороботным. `SUPPORTED_*` больше не открывают отсутствующие возможности. Типизированный разбор и хранение событий/счёта подключены, но сообщения judge ещё не содержат generation и позицию события. Базовый живой easy-прогон подтверждён в разделе повторной проверки выше; поколения телеметрии остаются открытыми.
2. **События и счёт.** Судья публикует sequence и robot_id событий; bridge разбирает только публичные типы, подавляет повторные sequence и читает `/did/score`. Недоступность сервиса и таймаут представлены как `unknown`, чтобы ядро сверяло счёт вместо слепого повтора. ROS-сообщения пока не содержат generation и позицию робота в момент события; базовые порты проверены в живом easy-прогоне, но полный набор отказов и поколений остаётся открытым.
3. **SLAM.** `RosSlamMapSource` реализован, но HTTP entrypoint продолжает использовать статическую `_LazyMap`. Нужны выбор источника карты, сброс, актуальность и потеря локализации в реальном запуске.
4. **Два робота.** Координация и симуляция существуют отдельно. Точка сборки пока передаёт один ROS bridge всем контроллерам. Нужны мосты/команды/судья по robot_id, общий сброс и прогоны, включая совместный SLAM.
5. **Качество научного поведения.** Офлайн-адаптация к удешевлению грунта: 6/10 против проектного порога 9/10. Итоговые пересчёты и исходные результаты явно разделены в отчёте B и `artifacts/analysis/`. Эти цифры относятся к fake-world.
6. **Сквозные доказательства.** Автономные easy/medium/hard, SLAM и team-серии с реальным ROS и LLM, расширенные проверки Stop при отказах, неизвестные seeds, сравнение стратегий, видео и финальный показ. Четыре рубежа плана A/B не закрыты автоматически фактом merge.
7. **Физика и правила (срез 2026-10-07).** На момент этого отчёта замедление грунта реализовано ограничением команд, столкновения оценивались через lidar; физическое трение не моделировалось. После этого среза lidar штраф заменён на Gazebo Contacts; live подтверждение — `artifacts/evaluation/t07-judge-2026-10-08/contact-check.json`. Правила локального судьи всё ещё требуют согласования с организаторами.

## Следующий шаг

Сначала завершить контракт 2.0 на одном роботе со статической картой и подтвердить start → reset → исследование → collect → return → finish → повтор, затем подключать SLAM и отдельные ROS-мосты команды. После этого выполнять серии по матрице приёмки. Полный объём проекта сохраняется; незакрытые пункты не объявлены выполненными.

## Уточнение актуальности тестов

По переданному пользователем отчёту полный результат 169 passed / 1 skipped получен до последней небольшой правки JSON-парсера. Повторный полный backend-прогон после неё был прерван; завершённый актуальный результат не предоставлен. Эта граница не отменяет сохранённые артефакты живого прогона, но не позволяет утверждать, что последняя версия прошла весь backend-набор.
