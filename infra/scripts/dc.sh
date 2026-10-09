#!/usr/bin/env bash
# docker compose for one environment of the platform.
#
#   infra/scripts/dc.sh <production|staging> <docker compose arguments...>
#
#   infra/scripts/dc.sh production ps
#   infra/scripts/dc.sh production logs --since 1h api
#   infra/scripts/dc.sh staging restart worker
#   infra/scripts/dc.sh production run --rm migrate
#
# It uses that environment's own checkout of the compose files
# ($DWRG_HOME/<env>/src/infra), so commands match the deployed version, and it
# checks the settings file before handing over to docker compose. Don't call
# `docker compose` directly: without DWRG_ENV it refuses to start.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib.sh"

main() {
  local env_name=${1:-}
  shift || true
  require_env_name "$env_name"
  [[ $# -gt 0 ]] || die "usage: dc.sh <production|staging> <docker compose arguments...>"
  if [[ $env_name == production && " $* " == *seed* ]]; then
    die "demo data is never loaded into production"
  fi
  check_settings "$env_name"
  compose "$env_name" "$@"
}

main "$@"
