#!/usr/bin/env bash
# Restores an encrypted backup made by backup-db.sh, for the monthly restore
# drill or a real recovery (docs/runbooks/backup-restore.md).
#
#   AGE_IDENTITY=/dev/shm/dwrg-backup.key infra/scripts/restore-db.sh <backup> [--keep]
#   infra/scripts/restore-db.sh --live-report
#
# <backup>       a local .dump.age file, a path in the off-site bucket as
#                printed by backup-db.sh, or "latest" for the newest nightly
#                production backup
# --keep         leave the throwaway drill database running afterwards
# --live-report  restore nothing; print the same report for the live
#                production database (read-only), to compare in the drill
#
# AGE_IDENTITY is the file holding the age private key. It lives off the
# droplet; for a drill, copy it to /dev/shm (memory only) and delete it after.
#
# Where it restores:
#   - by default, a throwaway Postgres container named dwrg-restore-drill on
#     this machine. Nothing else uses it, so a drill can't hurt anything. It is
#     removed with its data volume at the end (unless --keep), so no copy of
#     customer data stays behind on disk.
#   - with RESTORE_TARGET_URL set (export it; don't type it on the command
#     line), into that database, which must be empty. Used for a real recovery
#     into a new database. The live production database is refused.
#
# It ends with a row count for every table, the newest audit_log entry and
# the number of applied migrations, to compare with the live system.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib.sh"

CONFIG="$DWRG_HOME/backup.env"
DRILL=dwrg-restore-drill
WORK=""
KEEP=false
IMAGE=postgres:17
DRILL_PASSWORD=""

cleanup() {
  local code=$?
  if [[ -n $WORK ]]; then rm -rf "$WORK"; fi
  if [[ $KEEP == false ]]; then docker rm -f -v "$DRILL" >/dev/null 2>&1 || true; fi
  exit "$code"
}

main() {
  local source=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --live-report)
        live_report
        return
        ;;
      --keep) KEEP=true ;;
      -*) die "unknown option $1" ;;
      *) source=$1 ;;
    esac
    shift
  done
  [[ -n $source ]] || die "usage: AGE_IDENTITY=<key file> restore-db.sh <backup file | remote path | latest> [--keep]"
  [[ -n ${AGE_IDENTITY:-} && -f $AGE_IDENTITY ]] || die "set AGE_IDENTITY to the file with the age private key"
  if [[ -f $CONFIG ]]; then
    local configured
    configured=$(env_get "$CONFIG" BACKUP_PG_IMAGE || true)
    IMAGE=${configured:-$IMAGE}
  fi

  local target=${RESTORE_TARGET_URL:-}
  if [[ -n $target && -f $DWRG_HOME/production/app.env ]]; then
    local live
    live=$(env_get "$DWRG_HOME/production/app.env" DATABASE_URL || true)
    [[ -z $live || $(db_identity "$target") != "$(db_identity "$live")" ]] ||
      die "RESTORE_TARGET_URL is the live production database. Restore into a new, empty database and switch DATABASE_URL to it."
  fi

  trap cleanup EXIT
  mkdir -p "$DWRG_HOME/backups"
  WORK=$(mktemp -d "$DWRG_HOME/backups/restore.XXXXXX")

  # 1. Fetch.
  local encrypted="$WORK/backup.dump.age"
  if [[ -f $source ]]; then
    cp "$source" "$encrypted"
  else
    [[ -f $CONFIG ]] || die "$source is not a local file, and $CONFIG (for the off-site bucket) is missing"
    command -v rclone >/dev/null || die "rclone is not installed"
    export_rclone_settings "$CONFIG"
    if [[ $source == latest ]]; then
      local dest newest
      dest=$(env_get "$CONFIG" BACKUP_DEST)
      newest=$(rclone --quiet lsf --recursive --files-only "$dest/production/daily" | sort | tail -n 1)
      [[ -n $newest ]] || die "no backups found under $dest/production/daily"
      source="$dest/production/daily/$newest"
    fi
    log "downloading $source"
    rclone --quiet copyto "$source" "$encrypted"
  fi

  # 2. Decrypt and check.
  age --decrypt --identity "$AGE_IDENTITY" --output "$WORK/backup.dump" "$encrypted"
  rm -f "$encrypted"
  chmod 644 "$WORK/backup.dump"
  docker run --rm -v "$WORK:/work:ro" "$IMAGE" pg_restore --list /work/backup.dump >/dev/null
  log "backup decrypted and readable ($(du -h "$WORK/backup.dump" | cut -f1))"

  # 3. Restore. One transaction: it all goes in, or nothing does.
  local restore=(pg_restore --no-owner --no-privileges --exit-on-error --single-transaction)
  if [[ -z $target ]]; then
    log "starting the throwaway database $DRILL"
    docker rm -f -v "$DRILL" >/dev/null 2>&1 || true
    DRILL_PASSWORD=$(openssl rand -hex 16)
    docker run -d --name "$DRILL" -e POSTGRES_PASSWORD="$DRILL_PASSWORD" \
      -e POSTGRES_DB=dwrg_restore "$IMAGE" >/dev/null
    local tries=0
    # Over TCP: while the image initialises, its temporary server listens on
    # the socket only, so a TCP answer means the real server is up.
    until docker exec "$DRILL" pg_isready -q -h 127.0.0.1 -U postgres -d dwrg_restore 2>/dev/null; do
      ((++tries < 60)) || die "the throwaway database did not start"
      sleep 1
    done
    docker cp "$WORK/backup.dump" "$DRILL:/tmp/backup.dump" >/dev/null
    log "restoring"
    docker exec "$DRILL" "${restore[@]}" -U postgres -d dwrg_restore /tmp/backup.dump
    docker exec "$DRILL" rm -f /tmp/backup.dump
    report docker exec -i "$DRILL" psql -U postgres -d dwrg_restore
  else
    local ca_args=()
    if [[ -f $DWRG_HOME/db-ca.crt ]]; then
      ca_args=(-v "$DWRG_HOME/db-ca.crt:/run/db-ca.crt:ro" -e PGSSLROOTCERT=/run/db-ca.crt)
    fi
    # Through the environment, never the command line (visible in `ps`).
    export PGURL=$target
    # shellcheck disable=SC2016 # $PGURL and $@ expand inside the container's shell.
    local psql_target=(docker run --rm -i -e PGURL "${ca_args[@]}" "$IMAGE" sh -c 'exec psql "$PGURL" "$@"' psql)
    local existing
    existing=$("${psql_target[@]}" -tA <<<"SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');")
    [[ $existing == 0 ]] || die "the target database $(db_identity "$target") is not empty ($existing tables)"
    log "restoring into $(db_identity "$target")"
    docker run --rm -e PGURL "${ca_args[@]}" -v "$WORK:/work:ro" "$IMAGE" \
      sh -c 'exec '"${restore[*]}"' --dbname="$PGURL" /work/backup.dump'
    report "${psql_target[@]}"
  fi

  log "restore finished"
  if [[ -z $target && $KEEP == true ]]; then
    log "the drill database is still running. Query it:"
    log "  docker exec -it $DRILL psql -U postgres -d dwrg_restore"
    log "Run an image's migrations against it (copy of production data):"
    log "  docker run --rm --network container:$DRILL -w /app/packages/db \\"
    log "    -e DATABASE_URL=postgres://postgres:$DRILL_PASSWORD@127.0.0.1:5432/dwrg_restore \\"
    log "    dwrg-api:<commit> node --import tsx src/migrate.ts"
    log "Remove it (and its data volume) when done: docker rm -f -v $DRILL"
  fi
}

# The report for the live production database. Only SELECTs.
live_report() {
  local app_env="$DWRG_HOME/production/app.env"
  [[ -f $app_env ]] || die "$app_env is missing"
  local url ca_args=()
  url=$(env_get "$app_env" DATABASE_URL)
  if [[ -f $DWRG_HOME/db-ca.crt ]]; then
    ca_args=(-v "$DWRG_HOME/db-ca.crt:/run/db-ca.crt:ro" -e PGSSLROOTCERT=/run/db-ca.crt)
  fi
  log "live report for $(db_identity "$url")"
  export PGURL=$url
  # shellcheck disable=SC2016 # $PGURL and $@ expand inside the container's shell.
  report docker run --rm -i -e PGURL -e PGOPTIONS="-c default_transaction_read_only=on" \
    "${ca_args[@]}" "$IMAGE" sh -c 'exec psql "$PGURL" "$@"' psql
}

# report PSQL_COMMAND...: row counts and the checks to compare with live.
report() {
  "$@" -q -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo
\echo 'Rows per table (compare with the live system):'
SELECT table_schema || '.' || table_name AS "table",
  (xpath('/row/n/text()', query_to_xml(
    format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS "rows"
FROM information_schema.tables
WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1;
\echo 'Newest audit_log entry (should be close to the backup time):'
SELECT count(*) AS audit_rows, max("at") AS newest_entry FROM public.audit_log;
\echo 'Applied migrations (should match packages/db/drizzle of the live version):'
SELECT count(*) AS migrations FROM drizzle.__drizzle_migrations;
SQL
}


main "$@"
