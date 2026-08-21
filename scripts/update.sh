#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pull, rebuild, migrate, restart — with a backup taken first.
#
#   bash scripts/update.sh
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Backing up before changing anything"
bash scripts/backup.sh

echo "==> Recording the current commit for rollback"
PREVIOUS="$(git rev-parse HEAD)"
echo "$PREVIOUS" > .last-deploy
echo "    ${PREVIOUS}"

echo "==> Fetching"
git pull --ff-only

echo "==> Rebuilding"
docker compose build

echo "==> Migrating"
docker compose run --rm migrate

echo "==> Restarting"
docker compose up -d

echo "==> Waiting for health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT:-3020}/api/health" >/dev/null 2>&1; then
    echo "    healthy after ${i}s"
    echo "==> Update complete."
    exit 0
  fi
  sleep 1
done

echo "!! App did not become healthy. Logs:" >&2
docker compose logs --tail=50 app >&2
echo "!! Roll back with: bash scripts/rollback.sh" >&2
exit 1
