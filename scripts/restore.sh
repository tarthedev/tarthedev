#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Restore from a backup produced by scripts/backup.sh.
#
#   bash scripts/restore.sh backups/kpi-db-20260821-030000.dump
#   bash scripts/restore.sh backups/kpi-db-...dump backups/kpi-storage-...tar.gz
#
# DESTRUCTIVE: replaces the current database. Requires typing RESTORE to confirm.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP="${1:-}"
ARCHIVE="${2:-}"
DB_SERVICE="${DB_SERVICE:-db}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Usage: bash scripts/restore.sh <db.dump> [storage.tar.gz]" >&2
  exit 1
fi

[ -f .env ] && set -a && . ./.env && set +a
POSTGRES_USER="${POSTGRES_USER:-kpi}"
POSTGRES_DB="${POSTGRES_DB:-kpi}"

echo "This REPLACES the contents of database '${POSTGRES_DB}' with ${DUMP}."
echo "Everything currently stored will be lost."
read -r -p "Type RESTORE to continue: " CONFIRM
[ "$CONFIRM" = "RESTORE" ] || { echo "Aborted."; exit 1; }

echo "==> Stopping the app so nothing writes during the restore"
docker compose stop app 2>/dev/null || true

echo "==> Restoring database"
if docker compose ps --status running --services 2>/dev/null | grep -qx "$DB_SERVICE"; then
  docker compose exec -T "$DB_SERVICE" \
    pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl < "$DUMP"
else
  : "${DATABASE_URL:?DATABASE_URL is required when the compose database is not running}"
  pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --no-acl < "$DUMP"
fi

if [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ]; then
  echo "==> Restoring screenshots"
  docker run --rm \
    -v "$(basename "$PWD")_app-storage":/data \
    -v "$(cd "$(dirname "$ARCHIVE")" && pwd)":/backup:ro \
    alpine sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$ARCHIVE") -C /data"
fi

echo "==> Applying any migrations newer than the backup"
docker compose run --rm migrate

echo "==> Starting the app"
docker compose up -d app

echo "==> Restore complete. Check https://<your-domain>/api/health"
