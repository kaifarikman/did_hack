# Симуляция и локальный судья

Образ: `infra/Dockerfile.simulation` (ARM64 нативно, база `ros:jazzy-ros-base`). Версии — `artifacts/versions.txt`.

## Запуск

```bash
docker compose up -d --build simulation     # Gazebo headless + судья, seed 0
docker compose ps                           # simulation должен стать healthy
docker compose --profile gui up -d --build gui   # показ настоящего Gazebo
# открыть http://localhost:6080/vnc.html (программный рендеринг в Xvfb + noVNC)
```

Reset между прогонами (внутренний, из сети Compose): `POST http://simulation:7000/reset {"seed": N}`
блокируется до готовности (≈6 с), `GET /status` → `{"state": "ready|starting|failed", "seed": N}`.
Reset = рестарт Gazebo и судьи, поэтому одометрия снова с нуля, а `world = (-2.0, -0.5) + odom` верно.
Узлы ROS в других контейнерах должны использовать `ROS_DOMAIN_ID=7`.

Диагностика движения: `docker compose exec simulation bash -c 'source /opt/ros/jazzy/setup.bash && python3 /workspace/simulation/scripts/probe_motion.py'`.
Тесты судьи: `docker compose exec simulation bash -c 'cd /workspace/simulation/judge && python3 -m pytest -q -p no:cacheprovider'`.

## Факты BE-01 (проверено 2026-10-06, Mac ARM64, Docker 29.0.1)

- Нативный ARM64 работает, эмуляция amd64 не потребовалась. Пакеты: turtlebot3_gazebo 2.3.7, ros_gz_sim 1.0.24, Gazebo Sim 8 (Harmonic).
- Официальный `turtlebot3_world.launch.py` всегда запускает gzclient и падает без дисплея; поэтому свой `launch/headless_world.launch.py` (сервер + робот + мост).
- `/cmd_vel` — `geometry_msgs/msg/TwistStamped` (как в ТЗ), `/scan` ≈5 Гц, `/clock` идёт, `/odom` 30 Гц.
- Расхождение с ТЗ: ТЗ требует `x_pose=y_pose=0`, но в этой версии пакета робот спавнится по умолчанию в мировых (-2.0, -0.5) и `/odom` стартует с (0, 0). Преобразование `world = (-2, -0.5) + odom` подтверждено: после 0,98 м пути odom → мир (-1.017, -0.5), gz-поза (≈ -1.52 при другом моменте), расхождение одометрии и gz-позы ≈1,4 см.
- Карта `turtlebot3_navigation2/map/map.yaml`: 0,05 м, origin (-10, -10); девять столбов — сетка 3×3 в точках {-1.1, 0, 1.1}² (проверено тестом по клеткам карты). Копия карты — `judge/data/`.
- Движение 0,1 м/с 5 с → +0,49 м; нулевая команда → дрейф 0,0 м. Лог: `artifacts/be01-motion-probe.log`, `artifacts/be03-judge-in-gazebo.log`.
- Gazebo GUI: `artifacts/be01-gazebo-gui.png`; GUI-контейнер делит сетевой стек с `simulation` и `GZ_PARTITION=did` (иначе gz-transport не видит сервер).

## Не проверено

- Остановка при убийстве backend-процесса, watchdog контроллера (BE-04) — не в этой части.
- Успешный `/did/collect` и `/did/finish` на базе в живом Gazebo (покрыты юнит-тестами; в живом прогоне проверены только отказные ответы).
