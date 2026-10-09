#!/usr/bin/env bash
# Nightly off-site database backup (docs/runbooks/backup-restore.md).
#
#   infra/scripts/backup-db.sh [production|staging]      (default: production)
#
# 1. pg_dump of the environment's database (DATABASE_URL in
#    $DWRG_HOME/<env>/app.env), custom format, from the official postgres image
#    so the droplet needs no Postgres client
# 2. checks that pg_restore can read the dump
# 3. encrypts it with age to the public key in backup.env; the private key is
#    kept off the droplet, so neither the droplet nor the bucket can read it
# 4. uploads it with rclone to $BACKUP_DEST/<env>/daily/<year>/<month>/ (and,
#    on the first of the month, also to <env>/monthly/<year>/, which the bucket
#    keeps longer) and checks the size that arrived
# 5. pings BACKUP_HEARTBEAT_URL, so a missed or failed night raises an alert
#
# Settings: $DWRG_HOME/backup.env (infra/backup.env.example). Needs docker,
# age and rclone on the droplet. Run nightly by infra/systemd/dwrg-backup.timer.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib.sh"

ENV_NAME=${1:-production}
require_env_name "$ENV_NAME"
CONFIG="$DWRG_HOME/backup.env"
HEARTBEAT=""
WORK=""

cleanup() {
  local code=$?
  if [[ -n $WORK ]]; then rm -rf "$WORK"; fi
  if [[ $code -ne 0 ]]; then
    log "backup FAILED"
    if [[ -n $HEARTBEAT ]]; then curl -fsS -m 10 --retry 3 -o /dev/null "$HEARTBEAT/fail" || true; fi
  fi
  exit "$code"
}
trap cleanup EXIT

main() {
  [[ -f $CONFIG ]] || die "$CONFIG is missing (copy infra/backup.env.example)"
  local mode
  mode=$(stat -c '%a' "$CONFIG")
  [[ ${mode: -1} == 0 ]] || die "$CONFIG is readable by other users: chmod 600 $CONFIG"
  local app_env="$DWRG_HOME/$ENV_NAME/app.env"
  [[ -f $app_env ]] || die "$app_env is missing"
  local recipient dest image db_url
  recipient=$(env_get "$CONFIG" BACKUP_AGE_RECIPIENT || true)
  dest=$(env_get "$CONFIG" BACKUP_DEST || true)
  HEARTBEAT=$(env_get "$CONFIG" BACKUP_HEARTBEAT_URL || true)
  image=$(env_get "$CONFIG" BACKUP_PG_IMAGE || true)
  image=${image:-postgres:17}
  db_url=$(env_get "$app_env" DATABASE_URL || true)
  local recipient_args=() key
  for key in ${recipient//,/ }; do
    [[ $key == age1* ]] || die "BACKUP_AGE_RECIPIENT must hold age public keys (age1...), got '$key'"
    recipient_args+=(--recipient "$key")
  done
  [[ ${#recipient_args[@]} -gt 0 ]] || die "BACKUP_AGE_RECIPIENT is not set in $CONFIG"
  [[ -n $dest ]] || die "BACKUP_DEST is not set in $CONFIG"
  [[ -n $db_url ]] || die "DATABASE_URL is not set in $app_env"
  command -v age >/dev/null || die "age is not installed (sudo apt install age)"
  command -v rclone >/dev/null || die "rclone is not installed (sudo apt install rclone)"
  export_rclone_settings "$CONFIG"

  mkdir -p "$DWRG_HOME/backups"
  WORK=$(mktemp -d "$DWRG_HOME/backups/run.XXXXXX")
  local stamp name
  stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
  name="dwrg-$ENV_NAME-$stamp.dump"

  # 1. Dump. The URL goes in through the environment, never the command line
  # (visible in `ps`). PGSSLROOTCERT lets sslmode=verify-full check the server.
  log "dumping $(db_identity "$db_url")"
  local ca_args=()
  if [[ -f $DWRG_HOME/db-ca.crt ]]; then
    ca_args=(-v "$DWRG_HOME/db-ca.crt:/run/db-ca.crt:ro" -e PGSSLROOTCERT=/run/db-ca.crt)
  fi
  PGURL=$db_url docker run --rm -e PGURL "${ca_args[@]}" "$image" \
    sh -c 'exec pg_dump --format=custom --dbname="$PGURL"' >"$WORK/$name"

  # 2. Readable?
  local tables
  tables=$(docker run --rm -v "$WORK:/work:ro" "$image" pg_restore --list "/work/$name" |
    grep -c ' TABLE DATA ' || true)
  [[ $tables -gt 0 ]] || die "the dump has no table data"
  log "dump ok: $(du -h "$WORK/$name" | cut -f1), $tables tables"

  # 3. Encrypt, and drop the plain copy at once.
  age --encrypt "${recipient_args[@]}" --output "$WORK/$name.age" "$WORK/$name"
  rm -f "$WORK/$name"

  # 4. Upload and check what arrived.
  upload "$WORK/$name.age" "$dest/$ENV_NAME/daily/$(date -u +%Y/%m)/$name.age"
  if [[ $(TZ=America/New_York date +%d) == 01 ]]; then
    upload "$WORK/$name.age" "$dest/$ENV_NAME/monthly/$(date -u +%Y)/$name.age"
  fi

  # 5. Heartbeat.
  if [[ -n $HEARTBEAT ]]; then curl -fsS -m 10 --retry 3 -o /dev/null "$HEARTBEAT" || log "warning: heartbeat ping failed"; fi
}


upload() {
  local file=$1 remote=$2 sent arrived
  rclone --quiet copyto --retries 5 "$file" "$remote"
  sent=$(stat -c '%s' "$file")
  arrived=$(rclone --quiet lsf --format s "$remote")
  [[ $arrived == "$sent" ]] || die "uploaded size $arrived differs from local size $sent"
  log "uploaded $remote ($sent bytes)"
}

main
