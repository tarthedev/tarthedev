#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Return to the commit recorded by the last update.
#
#   bash scripts/rollback.sh
#
# Note: this reverts application code, not the database. A migration that
# dropped a column is only recoverable from a backup — restore.sh does that.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .last-deploy ] || { echo "No .last-deploy file — nothing to roll back to." >&2; exit 1; }
TARGET="$(cat .last-deploy)"

echo "Rolling back to ${TARGET}"
read -r -p "Continue? [y/N] " CONFIRM
[ "$CONFIRM" = "y" ] || { echo "Aborted."; exit 1; }

git checkout "$TARGET"
docker compose build
docker compose up -d

echo "==> Rolled back. If the failed deploy included a migration, restore the"
echo "    pre-update database dump as well:  bash scripts/restore.sh backups/<dump>"
