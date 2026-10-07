# HTTP-контракт MVP v1

Рабочий контракт двух агентов. Это собственный интерфейс панели, а не контракт организаторов `/did/*`. Оба исполнителя реализуют его независимо; изменения согласуются через координатора.

## Общие правила

- Префикс `/api/v1`, JSON UTF-8, имена полей `snake_case`. Отсутствующее измерение передаётся как `null`, а не выдуманный ноль.
- Координаты в метрах в мировой системе Gazebo; угол в радианах. Поля координат — `position_x_m`, `position_y_m`. Backend выполняет преобразование из ROS.
- `simulation_time_s` относится к времени симуляции. Таймаут связи в UI измеряется монотонным временем браузера: пауза симуляции не означает потерю HTTP.
- Один активный прогон. `run_id` — непрозрачная строка. `revision` монотонно растёт внутри прогона; старые ответы не заменяют более новые. При новом `run_id` UI очищает путь и журнал предыдущего прогона.
- Частота опроса UI — 2 Гц; максимум один незавершённый запрос состояния. Ошибка связи сохраняет последние данные с пометкой устаревания. Через 3 секунды без успешного ответа состояние помечается stale.
- Журнал содержит наблюдения и объяснения, но не скрытые координаты образцов. Поле `collected_samples` содержит только уже подтверждённые сборы.
- Все поля описанных объектов обязательны, если явно не сказано обратное. Неизвестные дополнительные поля клиент может игнорировать. Числа конечные; NaN/Infinity запрещены.

## Методы

| Метод и путь | Результат | Ошибки |
| --- | --- | --- |
| `GET /health` | 200: `{ "status": "ready" или "starting", "ros_connected": boolean, "judge_mode": "local" или "official", "llm_available": boolean, "supported_scenarios": ["easy" \| "medium" \| "hard"] }`. Поле `supported_scenarios` добавлено совместимо (F02); клиент без него считает доступным только easy | 503, если процесс не может обслуживать запросы |
| `GET /state` | 200: снимок ниже; до первого прогона `run_id: null`, `status: idle` | 503 при недоступности состояния |
| `GET /map` | 200: карта ниже, доступна независимо от активного прогона | 503, пока карта не загружена |
| `POST /runs` | Тело `{ "request_id": string, "scenario": "easy" \| "medium" \| "hard", "seed": integer }`; 202: снимок нового прогона | 409 `run_conflict`, если другой прогон активен; 409 `scenario_unavailable`, если профиль не входит в `supported_scenarios`; 422 неверный запрос или неизвестный профиль; 503 среда не готова |
| `POST /runs/{run_id}/stop` | Тело `{ "request_id": string }`; 202: текущий снимок, подтверждение остановки приходит в `/state` | 404 неизвестный прогон; 409 это не текущий прогон |
| `GET /runs/{run_id}/journal?after_sequence=0&limit=100` | 200: страница журнала ниже | 404 неизвестный прогон; 422 неверные параметры |

Ошибки имеют вид `{ "error": { "code": string, "message": string, "retryable": boolean } }`. Технические traceback и секреты в ответ не включаются. `limit` от 1 до 200, значение по умолчанию 100; `after_sequence` — целое >= 0, по умолчанию 0.

`request_id` задаётся клиентом для одной логической команды и сохраняется при повторе после таймаута. Backend дедуплицирует в пределах жизни процесса: тот же ID и тело не запускают действие повторно; тот же ID с другим телом даёт 409. После перезапуска backend клиент заново получает `/state`, а не автоматически повторяет старую команду. Stop терминального текущего прогона возвращает его состояние без побочного эффекта.

HTTP-команда старт/стоп подтверждает принятие намерения, а не физическое выполнение. UI ожидает новое состояние; двойной клик не создаёт вторую команду. Прогон сохраняется для чтения журнала хотя бы до завершения процесса backend; файлы журнала остаются после завершения.

## Снимок состояния

| Поле | Тип и значение |
| --- | --- |
| `schema_version` | Строка `1.0` |
| `run_id` | Строка или null до первого прогона |
| `revision` | Целое >= 0 |
| `status` | `idle`, `starting`, `running`, `returning`, `stopping`, `completed`, `stopped`, `failed` |
| `scenario` | `easy`, `medium`, `hard` или null в idle |
| `seed` | Целое или null в idle |
| `judge_mode` | `local` или `official` |
| `planner_mode` | `llm` или `fallback` |
| `simulation_time_s` | Число >= 0 или null до получения часов |
| `map_id` | Строка версии карты или null до загрузки |
| `robot_pose` | `{ position_x_m: number, position_y_m: number, heading_rad: number }` или null |
| `base_position` | Точка `{ position_x_m: number, position_y_m: number }` или null до настройки |
| `battery_remaining` | Число >= 0 или null; единицы условные, не проценты |
| `battery_initial` | Число > 0; для ТЗ 60 |
| `sample_signal` | Число от 0 до 1 или null |
| `samples_collected` | Целое >= 0, только подтверждённые сборы |
| `return_energy_estimate` | Число >= 0 или null, если оценки пока нет |
| `current_goal` | null или `{ kind: "explore" / "approach" / "collect" / "return", target: точка или null, reason: string }` |
| `trajectory` | Массив точек, не более 500 последних; обновляется целиком |
| `planned_path` | Массив точек текущего плана, пустой если плана нет |
| `collected_samples` | Массив `{ sample_id: string, position: точка }`; локальный ID и наблюдаемая позиция робота в момент подтверждения сбора; это отметка места сбора, не точная скрытая координата образца |
| `terrain_estimates` | Массив `{ region_id: string, center: точка, radius_m: number > 0, energy_per_m: number >= 0, confidence: number от 0 до 1 }`; только оценки агента, круг — область применимости оценки |
| `last_error` | null или объект `{ code: string, message: string, retryable: boolean }` |

В idle массивы пустые, подцель и ошибка null, число сборов 0. В терминальном состоянии сохраняется последний снимок. Отсутствие оценки возврата не равно бесплатному возврату; backend принимает консервативное решение.

Переходы: idle/терминальное → starting → running; running → returning → completed. Любое активное состояние допускает stopping → stopped или failed. Возврат может закончиться failed. `completed` требует подтверждения сбора минимум одного образца и успешного `/did/finish` с положительной батареей. Иные завершения не помечаются успехом.

## Карта

```text
{ map_id: string,
  resolution_m: number > 0,
  width: integer > 0, height: integer > 0,
  origin: { position_x_m: number, position_y_m: number, heading_rad: number },
  cells: integer[] }
```

`cells` имеет длину `width * height`, row-major, индекс `row * width + column`. 0 — свободно, 100 — препятствие, -1 — неизвестно. Это нормализованная геометрия; запретный запас вокруг препятствий принадлежит навигации и не подменяет оригинальную карту.

Центр клетки до поворота: `((column + 0.5) * resolution_m, (row + 0.5) * resolution_m)`. Для получения мировой точки повернуть на `origin.heading_rad`, затем прибавить origin. Строки идут по возрастанию локальной Y, инверсию экранной оси Y делает UI. Backend нормализует исходную карту; frontend не читает PGM/YAML.

## Журнал

Страница: `{ run_id: string, entries: JournalEntry[], next_sequence: integer, has_more: boolean }`. Выборка строго по `sequence > after_sequence`, сортировка по возрастанию. `next_sequence` — номер последней записи страницы, либо входной курсор для пустой страницы. Нумерация начинается с 1, уникальна внутри прогона; UI удаляет дубликаты по `(run_id, sequence)`.

```text
JournalEntry = {
  sequence: integer >= 1,
  simulation_time_s: number >= 0 или null,
  kind: "observation" / "hypothesis" / "experiment" / "decision" / "outcome" / "error",
  title: string,
  detail: string,
  hypothesis_id: string или null,
  expected: string или null,
  observed: string или null,
  conclusion: string или null
}
```

Одна гипотеза связывает несколько записей. Непроверенная гипотеза не получает фиктивный вывод. Выгрузка UI фиксирует выбранный `run_id` и собирает страницы с начала до первого `has_more: false`, а не только отображённый фрагмент. Экспорт включает последний `next_sequence` как границу выгрузки. Для активного прогона это последовательная выгрузка, не атомарный снимок на момент нажатия; для терминального прогона — полный неизменяемый журнал. При разрыве связи неполный файл не выдаётся как полный.

## Независимая работа и интеграция

Общие примеры в `examples/` — синтетические контрактные данные, не результаты симуляции. Агент B расширяет сценарии fixture-адаптера в `frontend/`, сохраняя этот формат. Агент A использует общие примеры в контрактных тестах HTTP-сериализации.

Frontend обращается к относительному `/api/v1`. Для разработки и контейнера его прокси использует `BACKEND_URL` (по умолчанию `http://backend:8000` в Compose). Frontend Dockerfile слушает порт 8080 на `0.0.0.0`; локальный адрес панели публикует Compose агента A. Контейнер backend доступен как `backend:8000`. Ключ LLM в frontend не передаётся.

Режим fixture включается только явно и имеет постоянную видимую метку «Демо-данные». Потеря реального backend никогда автоматически не переключает панель на фикстуры.

## Совместимое расширение 1.1 (поток B, 2026-10-07)

`schema_version` = `"1.1"`. Поля 1.0 не менялись; клиент 1.0 игнорирует новые поля, клиент 1.1 принимает их отсутствие у старого backend.

- `POST /runs`: необязательный `mission_text` (строка до 500 символов; пусто — текст по умолчанию). Повтор с тем же `request_id` и другим текстом — `409`.
- Снимок: `mission_text`, `target_samples` (число образцов профиля по ТЗ), `plan` и `research` (null в idle).
- `plan`: `plan_id`, `source` (`llm`/`fallback`), `rationale`, `premises[]`, `fallback_reason`, `revision_reason`, `steps[]` с `kind`, `target`, `reason`, `status` (`pending`/`active`/`done`/`rejected`/`dropped`), `evidence[]`, `revise_if`.
- `research`: `sensor` (`state` ok/suspected/degraded/recovering, `fault` noise/stuck/dropout/null, `quality` 0..1), `hazards[]` (`detection_id`, `center`, `radius_m`, `hits` — наблюдаемая область, не истинная граница), `hypotheses[]` (`hypothesis_id`, `kind`, `status`, `center`, `prediction`, `measurement`, `detection_id`, `experiment_id`), `last_replan_reason`, `last_replan_detection_id`, `planner_requests`.
- `terrain_estimates[]`: `std_energy_per_m` (неопределённость), `regime` (номер режима после обнаруженного изменения), `last_measured_s`.
- Запись журнала: `experiment_id`, `detection_id`, `plan_id`, `evidence[]` (`segment-N`, `event-N`, `#N`).
- После терминального статуса `current_goal` = null и `planned_path` = [].

Все поля — оценки и решения агента; истина сценария в снимок не попадает.
