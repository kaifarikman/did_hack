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

## Два робота (A4, проверено 2026-10-07)

`POST /reset {"seed","scenario","map_mode","robots":2}` запускает `launch/multi_robot_world.launch.py`: два Burger с моделями `robot_1`, `robot_2` (SDF генерируется из пакетного с префиксом `robot_N/` у топиков и кадров, `scripts/robot_model.py`). Старты: `robot_1` (-2.0, -0.5), `robot_2` (-2.0, 0.5); каждый возвращается на свою площадку.

Топики у каждого робота: `/robot_N/{cmd_vel,agent/cmd_vel,scan,odom,imu,joint_states}`, судья: `/robot_N/did/{battery,sample_sensor,events,score}`, сервисы `/robot_N/did/{collect,finish}`; командный итог — `/did/team_score` (результаты каждого робота + `team_collected`, `all_finished_successfully`, `failed_robots`). TF общий (`/tf`), кадры `robot_N/odom`, `robot_N/base_footprint`, `robot_N/base_scan`. Страж скорости запускается отдельно на каждого робота (watchdog 0.5 с) и использует его базу для замедления на грунте.

Правила командного судьи (локальные допущения, `did_judge/team.py`): образцы общие и засчитываются один раз тому, чей сбор обработан первым (второй получает `no_sample_in_range` и штраф ложного сбора); батарея, коллизии, finish и отказ учитываются на каждого робота отдельно; командный итог не скрывает отказ участника. Поза каждого робота — из Gazebo, одометрия судьёй не используется.

Проба `scripts/probe_team.py` (`artifacts/a4-team-probe.log`): адресность команд, независимые батареи, остановка робота при потере команд при том, что второй едет дальше, регистрация столкновения, раздельный штраф ложного сбора — все проверки пройдены. Ограничение: полная миссия двух роботов и сбор реального образца в Gazebo не прогонялись; SLAM для двух роботов пока не объединён (`map_mode=slam` запускает один SLAM на `/scan` без namespace и в режиме `robots=2` не поддерживается).

## SLAM-профиль (A3, проверено 2026-10-07)

`POST /reset {"seed","scenario","map_mode":"slam"}` дополнительно запускает SLAM Toolbox (`config/slam_params.yaml`, online async, режим mapping); `map_mode` по умолчанию `static`. Готовность в этом режиме требует сообщения в `/map`. Карта строится только из `/scan` и `/odom`: готовая карта мира в SLAM-процесс не передаётся.

**Система координат.** Кадр `map` стартует в точке старта робота, то есть начало `map` — на базе. Мировая позиция = `base_world_m + map`-поза (для Burger `(-2.0, -0.5)`). Одометрия даёт `world = base + odom`; двойного смещения нет, пока потребитель использует либо odom, либо map, но не складывает их. Судья по-прежнему берёт физическую позу Gazebo независимо от SLAM.

**Контрольный проезд** `scripts/probe_slam.py` (2 круга квадрата 0.5 м): ошибка позы SLAM против физической позы — среднее 0.011 м, максимум 0.027 м, 6945 замеров; карта 89×103 клетки по 0.05 м, 4412 известных, 386 занятых (`artifacts/a3-slam-probe.log`). Это короткий проезд без замыкания большой петли: поведение при loop closure и на длинных маршрутах не измерено.

## Замедление на грунте (A1, проверено 2026-10-07)

Модель: судья каждые 0.2 с пишет текущие зоны в `/tmp/did_soil_state.json` внутри контейнера simulation (не ROS-топик, не общий том — backend не видит). `cmd_vel_guard` масштабирует `linear.x` на `soil_speed_factor` (0.5 по умолчанию, `JudgeConfig`), если одометрия + база попадает в зону; угловая скорость не меняется. Расход на грунте остаётся отдельной надбавкой судьи. Зоны hard смещаются по расписанию, страж видит новое положение с задержкой до 0.2 с.

Контрольный проезд `scripts/probe_soil_slowdown.py` (одинаковая команда 0.1 м/с, 5 с): в зоне 0.275 м, вне зоны 0.548 м, отношение 0.501 при ожидаемом 0.5 (`artifacts/a1-soil-slowdown-probe.log`). Ограничения: замедление — программное (скорость команды), а не физическое трение Gazebo; если процесс судьи упал, файл остаётся последним записанным.
