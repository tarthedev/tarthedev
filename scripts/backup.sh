#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Database + screenshot backup.
#
#   bash scripts/backup.sh                 # into ./backups
#   BACKUP_DIR=/mnt/backups bash scripts/backup.sh
#
# Cron it nightly:
#   0 3 * * * cd /opt/kpi-command-center && bash scripts/backup.sh >> /var/log/kpi-backup.log 2>&1
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_SERVICE="${DB_SERVICE:-db}"

[ -f .env ] && set -a && . ./.env && set +a

POSTGRES_USER="${POSTGRES_USER:-kpi}"
POSTGRES_DB="${POSTGRES_DB:-kpi}"

mkdir -p "$BACKUP_DIR"
DUMP="${BACKUP_DIR}/kpi-db-${STAMP}.dump"

echo "==> Dumping database ${POSTGRES_DB}"
if docker compose ps --status running --services 2>/dev/null | grep -qx "$DB_SERVICE"; then
  # -Fc is the custom format: compressed, and restorable selectively.
  docker compose exec -T "$DB_SERVICE" \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl > "$DUMP"
else
  echo "    compose db not running — falling back to DATABASE_URL"
  : "${DATABASE_URL:?DATABASE_URL is required when the compose database is not running}"
  pg_dump "$DATABASE_URL" -Fc --no-owner --no-acl > "$DUMP"
fi

# A zero-length dump is worse than no dump, because it looks like a backup.
if [ ! -s "$DUMP" ]; then
  echo "!! Dump is empty. Backup FAILED." >&2
  rm -f "$DUMP"
  exit 1
fi
echo "    $(du -h "$DUMP" | cut -f1)  ${DUMP}"

echo "==> Archiving screenshots"
IMAGES="${BACKUP_DIR}/kpi-storage-${STAMP}.tar.gz"
if docker volume inspect "$(basename "$PWD")_app-storage" >/dev/null 2>&1; then
  docker run --rm \
    -v "$(basename "$PWD")_app-storage":/data:ro \
    -v "$(cd "$BACKUP_DIR" && pwd)":/backup \
    alpine tar czf "/backup/$(basename "$IMAGES")" -C /data .
elif [ -d "${STORAGE_PATH:-./storage}" ]; then
  tar czf "$IMAGES" -C "${STORAGE_PATH:-./storage}" .
else
  echo "    no screenshot storage found — skipping"
  IMAGES=""
fi
[ -n "$IMAGES" ] && [ -f "$IMAGES" ] && echo "    $(du -h "$IMAGES" | cut -f1)  ${IMAGES}"

echo "==> Pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'kpi-db-*.dump' -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null || true
find "$BACKUP_DIR" -name 'kpi-storage-*.tar.gz' -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null || true

echo "==> Done. Copy these off the server — a backup on the same disk is not a backup."
