# Отчёт агента A

Ведётся по ходу работы. Статусы задач — в [agent-a.md](../agent-a.md).

## A0. База и интерфейс

**Исходное состояние.** Рабочая ветка `worktree-agent-a` от `585c4d1`. Перенесены и сохранены результаты параллельного исполнителя приёмки MVP: ROS-shutdown (`bridge.py`, `test_ros_lifecycle.py`), протокол `context/mvp/acceptance-2026-10-07.md`, артефакты `artifacts/mvp-acceptance/`, планы A/B.

**Версии** (`simulation/artifacts/versions.txt`, Docker linux/arm64): ros-jazzy-gz-sim-vendor 0.0.13, ros-jazzy-ros-gz-sim 1.0.24, ros-jazzy-turtlebot3-gazebo 2.3.7, ros-jazzy-turtlebot3-navigation2 2.3.6.

**Манифест.** `artifacts/mvp-acceptance/manifest-final.json` содержит хеши на момент приёмки. После него изменён `compose.yaml` (параметризация изоляции), поэтому хеш Compose в манифесте больше не актуален; хеши `bridge.py`, `test_ros_lifecycle.py`, `settings.py` не менялись.

**Доказательства уровня 0** (teleop, топики, движение): `simulation/artifacts/be01-motion-probe.log`, `be01-gz-pose.log`, `upstream-launch.txt`, `be01-gazebo-gui.png`. Новых не требовалось.

**Изоляция стеков.** `compose.yaml` читает `ROS_DOMAIN_ID`, `GZ_PARTITION`, `GUI_PORT`, `FRONTEND_PORT`; значения по умолчанию прежние (7, did, 6080, 8080). Для второго стека: `docker compose -p did-b --env-file infra/stack-b.env.example up -d` (домен 17, партиция did-b, порты 6081/8081). Проверено `docker compose config`; живой запуск двух стеков не выполнялся.

**Не выполнено в A0.** Свежий Stop кнопкой панели и итоговые чек-листы MVP остались у исполнителя приёмки. Проверка контракта F02 с B и ROS-адаптеров против зафиксированной версии ждёт его расширений `ports.py`.
