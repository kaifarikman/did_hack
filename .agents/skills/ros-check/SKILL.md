---
name: ros-check
description: Проверка ROS 2/Gazebo-стека проекта в Docker — готовность симуляции, топики, судья, движение, остановка. Использовать после изменения simulation/, судьи, ROS-адаптера или Compose и перед сообщением «работает».
---

# ros-check

Быстрая проверка стека без LLM и панели. Идёт от дешёвого к дорогому; остановись на первом провале и исправь его, прежде чем идти дальше.

## 1. Статические проверки (секунды)

```bash
cd simulation/judge && python3 -m pytest -q          # судья, 70+ тестов
cd backend && python3 -m pytest -q                   # адаптеры, ядро
python3 -m pytest -q scripts/evaluation              # стенд и проверка утечек
docker compose config -q                             # Compose валиден
python3 scripts/evaluation/leak_check.py --compose-only
```

## 2. Живая симуляция (1–2 мин)

Изолированный проект, чтобы не задеть чужой стек: `docker compose -p did-a up -d simulation`.
Если порты/домен заняты — `--env-file infra/stack-b.env.example` (домен 17, партиция did-b).

1. Готовность: `GET http://localhost:7000/status` из контейнера → `state: ready`. Reset: `POST /reset {"seed":N,"scenario":"easy|medium|hard"}` блокируется до готовности.
2. Топики: `ros2 topic list` должен содержать `/agent/cmd_vel /cmd_vel /odom /scan /clock /did/battery /did/events /did/sample_sensor /did/score`; сервисы `/did/collect /did/finish`. Лишнего быть не должно (мировых поз, зон, расписания — нет). Эталон: `simulation/artifacts/a1-ros-topics.txt`.
3. Судья взял нужный профиль: в `ps` у процесса `config_path:=…/local_<сценарий>.json`; в логе нет «Физическая поза Gazebo недоступна».
4. Движение и расход: команда 0.1 м/с × 5 с в `/agent/cmd_vel` → odom ≈ +0.5 м, `/did/battery` уменьшается ≈ на пройденный путь (1 ед./м вне грунта).
5. Остановка: после тишины в `/agent/cmd_vel` страж публикует ноль в течение 0.5 с; дрейф ≈ 0.

Скрипты `rclpy` запускать внутри контейнера после `source /opt/ros/jazzy/setup.bash` (без этого нет ни `rclpy`, ни `gz.transport13`).

## 3. Что считать провалом

- `ready` не наступает за 120 с или `failed` → смотреть `docker logs`.
- Судья пишет «использует odom» → нет привязок gz или другой `GZ_PARTITION`; результаты нельзя считать независимыми от одометрии.
- Расход не растёт при движении → судья не получает позу; проверить `/world/default/pose/info`.
- Робот движется после остановки → watchdog/страж; это критичный дефект, не «флак».

## Ловушки (из опыта)

- Контейнер после `down` пересоздаётся без `/tmp`: скрипты проб копировать заново.
- Reset = рестарт процессов: одометрия снова с нуля, мир = база + odom.
- `docker exec … bash -c "source …"` может блокироваться политикой песочницы агента — положить команды в `.sh`, скопировать `docker cp` и запускать файлом.
- Не запускать две проверки подряд на одном стеке и не менять общий Gazebo, пока идёт чужая приёмка.
- После проверки — `docker compose -p did-a down`.

## Что записать в отчёт

Команду, seed/сценарий, числа (odom, расход, отношение скоростей), путь к логу в `simulation/artifacts/`, и что НЕ проверялось.
