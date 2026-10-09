#!/usr/bin/env bash
# Restarts containers Docker has marked unhealthy. Docker's restart policy only
# acts when a container exits; a hung API that stops answering /health would
# otherwise stay down. Only containers labelled dwrg.restart-when-unhealthy=true
# (api, worker, caddy in docker-compose.prod.yml). Skips while a deploy runs,
# because deploy.sh handles unhealthy containers itself.
#
# Run every minute by infra/systemd/dwrg-restart-unhealthy.timer. Each restart
# is logged to the journal: journalctl -t dwrg-restart-unhealthy
set -euo pipefail
DWRG_HOME=${DWRG_HOME:-/opt/dwrg}

exec 9>"$DWRG_HOME/deploy.lock"
flock -n 9 || exit 0

for id in $(docker ps --quiet --filter health=unhealthy --filter label=dwrg.restart-when-unhealthy=true); do
  name=$(docker inspect --format '{{.Name}}' "$id")
  name=${name#/}
  message="restarting unhealthy container $name"
  echo "$message"
  logger -t dwrg-restart-unhealthy "$message" || true
  docker restart --time 30 "$id" >/dev/null
done
