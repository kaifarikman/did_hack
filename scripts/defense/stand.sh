#!/usr/bin/env bash
# Демо-стенд защиты в изолированном Compose-проекте. Чужие проекты не трогает.
#
#   scripts/defense/stand.sh up       собрать и поднять simulation, backend, frontend и noVNC
#   scripts/defense/stand.sh status   состояние контейнеров и /api/v1/health через панель
#   scripts/defense/stand.sh still [с] пассивно проверить по ROS неподвижность и нулевые команды
#   scripts/defense/stand.sh record с файл  пассивно записать позу, команды и /did/score
#   scripts/defense/stand.sh rebuild-backend  пересобрать backend и пересоздать gui
#   scripts/defense/stand.sh down     остановить только проект did-defense
#
# Панель: http://localhost:8090  ·  Gazebo (noVNC): http://localhost:6090/vnc.html
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="${DEFENSE_PROJECT:-did-defense}"
ENV_FILE="$REPOSITORY_ROOT/scripts/defense/defense.env"
PANEL_URL="http://localhost:$(grep '^FRONTEND_PORT=' "$ENV_FILE" | cut -d= -f2)"

compose() {
  # Корневой .env (ключ LLM) подхватывается Compose как источник подстановки, если он есть.
  local env_args=(--env-file "$ENV_FILE")
  if [[ -f "$REPOSITORY_ROOT/.env" ]]; then
    env_args=(--env-file "$REPOSITORY_ROOT/.env" "${env_args[@]}")
  fi
  docker compose -p "$PROJECT" -f "$REPOSITORY_ROOT/compose.yaml" "${env_args[@]}" "$@"
}

wait_for_health() {
  for _ in $(seq 1 60); do
    if curl -fsS "$PANEL_URL/api/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Панель не ответила за 120 с: $PANEL_URL/api/v1/health" >&2
  return 1
}

case "${1:-}" in
  up)
    compose --profile gui up -d --build --wait simulation backend frontend
    compose --profile gui up -d gui
    wait_for_health
    curl -fsS "$PANEL_URL/api/v1/health"; echo
    echo "Панель: $PANEL_URL  ·  Gazebo: http://localhost:$(grep '^GUI_PORT=' "$ENV_FILE" | cut -d= -f2)/vnc.html"
    ;;
  status)
    compose ps
    curl -fsS "$PANEL_URL/api/v1/health" && echo || echo "health недоступен"
    ;;
  still)
    # Пассивная проверка неподвижности после Stop; JSON сохраните в artifacts/defense/<метка>/.
    container="$(compose ps -q simulation)"
    docker cp "$REPOSITORY_ROOT/scripts/defense/ros_still.py" "$container:/tmp/ros_still.py"
    compose exec -T simulation bash -c \
      "source /opt/ros/jazzy/setup.bash && python3 /tmp/ros_still.py ${2:-5}"
    ;;
  record)
    # Пассивная запись позы/команд/счёта: stand.sh record <секунды> <файл на хосте>
    # Свой путь в контейнере на каждую запись: параллельные записи не смешиваются.
    container="$(compose ps -q simulation)"
    remote_record="/tmp/ros_record_$$_$(date +%s).jsonl"
    docker cp "$REPOSITORY_ROOT/scripts/defense/ros_record.py" "$container:/tmp/ros_record.py"
    compose exec -T simulation bash -c \
      "source /opt/ros/jazzy/setup.bash && python3 /tmp/ros_record.py ${2:?секунды} $remote_record"
    docker cp "$container:$remote_record" "${3:?файл}"
    ;;
  rebuild-backend)
    # Пересобрать backend после исправления. Compose может пересоздать simulation, а gui живёт
    # в её сетевом пространстве, поэтому gui пересоздаём всегда: иначе noVNC теряет Gazebo.
    compose --profile gui up -d --build --wait backend
    compose --profile gui up -d --force-recreate --no-deps gui
    wait_for_health
    curl -fsS "$PANEL_URL/api/v1/health"; echo
    ;;
  down)
    compose --profile gui down
    ;;
  *)
    sed -n '2,11p' "$0"
    exit 2
    ;;
esac
