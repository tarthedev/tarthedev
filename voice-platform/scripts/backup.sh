#!/bin/sh
# Nightly database backup. Add to the VPS crontab:
#   15 3 * * * /opt/rollinson/voice-platform/scripts/backup.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
docker compose exec -T app node -e "require('better-sqlite3')('/data/rollinson.db').backup('/data/backup.db').then(()=>console.log('ok'))"
mv data/backup.db "backups/rollinson-$(date +%F).db"
find backups -name 'rollinson-*.db' -mtime +30 -delete
