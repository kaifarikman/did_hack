#!/bin/sh
set -eu
case "${DATA_SOURCE:-live}" in
  live|fixture) ;;
  *) echo "DATA_SOURCE must be live or fixture, got: ${DATA_SOURCE}" >&2; exit 1 ;;
esac
printf '{"data_source":"%s"}\n' "${DATA_SOURCE:-live}" > /usr/share/nginx/html/config.json
