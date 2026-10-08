# Скрипты защиты

Инструменты демо-стенда и свидетельств. Backend, frontend, simulation и `compose.yaml` здесь не меняются: стенд поднимается из того же Compose с отдельными project, ROS domain, partition и портами.

| Файл | Назначение |
| --- | --- |
| `defense.env` | Параметры стенда: ROS domain 91, partition `did-defense`, панель на 8090, noVNC на 6090 |
| `stand.sh up / status / still / down` | Поднять стенд вместе с Gazebo GUI; проверить health; пассивно проверить неподвижность по ROS; остановить только `did-defense` |
| `pick_targets.py` | Выбирает демо-точки на публичной карте тем же A* и запасом, что backend. Результат: `artifacts/defense/targets.json` и `targets-map.svg` |
| `capture.py` | Сохраняет health, state, сводку карты, журнал и manifest (commit, dirty, образы) в `artifacts/defense/<метка>/` |
| `ros_still.py` | ROS-наблюдатель для `stand.sh still`. Только подписки на `/odom`, `/agent/cmd_vel`, `/cmd_vel`, ничего не публикует |

## Порядок

```sh
scripts/defense/stand.sh up                      # сборка и запуск, затем health
scripts/defense/stand.sh status                  # нужны ready, ros_connected и navigation в supported_task_types
backend/.venv/bin/python scripts/defense/pick_targets.py   # только если map_id изменился
# показ по presentation/demo-runbook.md
python3 scripts/defense/capture.py 2026-10-08-live-1 --note "живой прогон T2"
scripts/defense/stand.sh still 5 > artifacts/defense/2026-10-08-live-1/ros-still.json
scripts/defense/stand.sh down
```

Ключ LLM берётся из корневого `.env`, если он есть. Скрипты его не печатают и не сохраняют; `capture.py` не читает переменные окружения контейнеров.

## Ограничения

- `compose.yaml` задаёт фиксированное имя образа `did-sim:dev`. Сборка стенда перезаписывает этот тег для всех проектов на машине. Контейнеры других проектов продолжают работать на старом образе, пока их не пересоздадут.
- Стенд собирается из рабочего дерева. Пока агенты 1 и 2 правят `backend/` и `frontend/`, сборка может поймать их промежуточное состояние. Финальный стенд собирать только после их готовности и фиксации версии.
- `pick_targets.py` считает путь офлайн. Достижимость на актуальной карте и позе всё равно проверяет backend при старте.
