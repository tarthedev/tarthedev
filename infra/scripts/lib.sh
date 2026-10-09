# shellcheck shell=bash
# Shared helpers for the infra scripts. Sourced by them, never run on its own.
#
# Layout on the droplet (docs/runbooks/deploy.md):
#   $DWRG_HOME/db-ca.crt                the managed database's CA certificate
#   $DWRG_HOME/backup.env               backup settings (infra/backup.env.example)
#   $DWRG_HOME/<env>/app.env            settings for one environment (infra/.env.production.example)
#   $DWRG_HOME/<env>/src                git checkout of the commit deployed to <env>
#   $DWRG_HOME/<env>/web/releases/<sha> web builds; web/current points at the live one
#   $DWRG_HOME/<env>/deploys.log        one line per deploy: time, commit, user, kind
# where <env> is production or staging.

export DWRG_HOME=${DWRG_HOME:-/opt/dwrg}

log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_env_name() {
  case "${1:-}" in
    production | staging) ;;
    *) die "the first argument must be production or staging (got '${1:-}')" ;;
  esac
}

other_env() { if [[ $1 == production ]]; then echo staging; else echo production; fi; }

# env_get FILE KEY: prints KEY's value from a KEY=value settings file (the last
# line wins), without surrounding quotes. Never `source` these files: a value
# such as a URL with & in it would run as shell code.
env_get() {
  local file=$1 key=$2 line
  line=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1) || return 1
  unquote "${line#*=}"
}

# unquote VALUE: VALUE without a trailing CR or one pair of surrounding quotes.
unquote() {
  local value=${1%$'\r'}
  if [[ $value =~ ^\'(.*)\'$ || $value =~ ^\"(.*)\"$ ]]; then
    value=${BASH_REMATCH[1]}
  fi
  printf '%s' "$value"
}

# db_identity URL: host:port/database, the part that says which database a URL
# points at (user, password and options removed).
db_identity() {
  local rest=${1#*://}
  rest=${rest##*@}
  rest=${rest%%\?*}
  local hostport=${rest%%/*} db=${rest#*/}
  [[ $hostport == *:* ]] || hostport="$hostport:5432"
  printf '%s/%s' "$hostport" "$db"
}

# check_settings ENV: refuses to go on when the settings for ENV are missing,
# readable by other users, labelled for the other environment, or (for
# staging) pointed at production's database.
check_settings() {
  local env_name=$1
  local file="$DWRG_HOME/$env_name/app.env"
  [[ -f $file ]] || die "$file is missing (copy infra/.env.production.example, docs/runbooks/deploy.md)"
  local mode
  mode=$(stat -c '%a' "$file")
  [[ ${mode: -1} == 0 ]] || die "$file is readable by other users: chmod 600 $file"
  local labelled
  labelled=$(env_get "$file" DWRG_ENV || true)
  [[ -z $labelled || $labelled == "$env_name" ]] ||
    die "$file says DWRG_ENV=$labelled, but this is $env_name"
  local url
  url=$(env_get "$file" DATABASE_URL || true)
  [[ -n $url ]] || die "DATABASE_URL is not set in $file"
  if [[ $env_name == staging && -f $DWRG_HOME/production/app.env ]]; then
    local prod_url
    prod_url=$(env_get "$DWRG_HOME/production/app.env" DATABASE_URL || true)
    [[ -z $prod_url || $(db_identity "$url") != "$(db_identity "$prod_url")" ]] ||
      die "staging's DATABASE_URL points at the production database ($(db_identity "$url"))"
  fi
  [[ -f $DWRG_HOME/db-ca.crt ]] ||
    die "$DWRG_HOME/db-ca.crt is missing (download the CA certificate from the database cluster's page)"
}

# compose ENV ARGS...: docker compose for ENV, with that environment's own
# checkout of the compose files and its settings file for ${...} values.
compose() {
  local env_name=$1
  shift
  local infra="$DWRG_HOME/$env_name/src/infra"
  local files=(-f "$infra/docker-compose.prod.yml")
  if [[ $env_name == staging ]]; then files+=(-f "$infra/docker-compose.staging.yml"); fi
  DWRG_ENV=$env_name docker compose --env-file "$DWRG_HOME/$env_name/app.env" "${files[@]}" "$@"
}

# export_rclone_settings FILE: exports the RCLONE_* lines of FILE. The off-site
# remote is configured entirely by them (rclone reads RCLONE_CONFIG_<REMOTE>_<OPTION>
# variables), so no rclone.conf holding keys sits anywhere else on disk.
export_rclone_settings() {
  local line
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(RCLONE_[A-Z0-9_]+)=(.*)$ ]] || continue
    export "${BASH_REMATCH[1]}=$(unquote "${BASH_REMATCH[2]}")"
  done <"$1"
}
