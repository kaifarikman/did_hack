# Источники

## Основной документ

[Задача на DID Hack «Автономный ИИ-исследователь на роботе-платформе»](../task/2-Описание%20задачи.pdf), 5 страниц. Полностью прочитан и визуально проверен 2026-10-06.

| Страницы | Содержание |
| --- | --- |
| 1 | Постановка задачи, платформа, карта, координаты, начало интерфейса ROS |
| 2 | Интерфейс `/did/*`, сценарии, уровни 0–2 |
| 3 | Уровни 3–4, тайминг, бонусы, начало критериев оценки |
| 4 | Остальные критерии, мастер-классы, инфраструктура |
| 5 | Ресурсы, состав команды, технические ссылки |

## Ссылки из ТЗ

Ссылки перенесены из PDF с восстановлением переносов строк. Их содержимое и соответствие текущим версиям пока не проверены; это указатель для следующих технических задач.

### Робот, мир и карта

- [TurtleBot3 e-Manual: Simulation](https://emanual.robotis.com/docs/en/platform/turtlebot3/simulation/).
- [turtlebot3_simulations](https://github.com/ROBOTIS-GIT/turtlebot3_simulations), в ТЗ указана ветка `jazzy`.
- [turtlebot3](https://github.com/ROBOTIS-GIT/turtlebot3), в ТЗ указана ветка `jazzy`.
- [Документация turtlebot3_gazebo для Jazzy](https://docs.ros.org/en/jazzy/p/turtlebot3_gazebo).
- [turtlebot3_gazebo в ROS Index](https://index.ros.org/p/turtlebot3_gazebo/).
- [Анонс примеров TurtleBot3 для Jazzy и Harmonic](https://discourse.openrobotics.org/t/tb3-new-turtlebot3-examples-are-here/43239).

### Файлы для проверки интеграции

- [map.yaml](https://raw.githubusercontent.com/ROBOTIS-GIT/turtlebot3/jazzy/turtlebot3_navigation2/map/map.yaml).
- [map.pgm](https://raw.githubusercontent.com/ROBOTIS-GIT/turtlebot3/jazzy/turtlebot3_navigation2/map/map.pgm).
- [turtlebot3_world.world](https://raw.githubusercontent.com/ROBOTIS-GIT/turtlebot3_simulations/jazzy/turtlebot3_gazebo/worlds/turtlebot3_world.world).
- [turtlebot3_world.launch.py](https://raw.githubusercontent.com/ROBOTIS-GIT/turtlebot3_simulations/jazzy/turtlebot3_gazebo/launch/turtlebot3_world.launch.py).
- [turtlebot3_burger_bridge.yaml](https://raw.githubusercontent.com/ROBOTIS-GIT/turtlebot3_simulations/jazzy/turtlebot3_gazebo/params/turtlebot3_burger_bridge.yaml).

### ROS, Gazebo и навигация

- [Документация Gazebo](https://gazebosim.org/docs).
- [ros_gz](https://github.com/gazebosim/ros_gz).
- [Установка ROS 2 Jazzy](https://docs.ros.org/en/jazzy/Installation.html).
- [Nav2 Getting Started](https://docs.nav2.org/getting_started/).
- [SLAM Toolbox](https://github.com/SteveMacenski/slam_toolbox).
