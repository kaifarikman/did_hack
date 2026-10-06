#!/bin/sh
# Пишет /config.json: режим данных задаётся при запуске контейнера (DATA_SOURCE=live|fixture).
set -eu
case "${DATA_SOURCE:-live}" in
  live|fixture) ;;
  *) echo "DATA_SOURCE должен быть live или fixture, получено: ${DATA_SOURCE}" >&2; exit 1 ;;
esac
printf '{"data_source":"%s"}\n' "${DATA_SOURCE:-live}" > /usr/share/nginx/html/config.json
