#!/usr/bin/env bash
# Deploy one commit to one environment, or roll back (docs/runbooks/deploy.md).
#
#   infra/scripts/deploy.sh staging main               the tip of main, to staging
#   infra/scripts/deploy.sh production 1a2b3c4d        a commit staging already ran
#   infra/scripts/deploy.sh production --rollback      back to the commit deployed before the current one
#
# Options:
#   --skip-staging-check   let production take a commit staging never ran (emergency fixes only)
#   --rebuild              build the image and web files again even if they exist (with
#                          DWRG_BUILD_ARGS=--pull, picks up a patched Node base image)
#
# Steps:
#   1. fetch from GitHub and resolve the commit
#   2. build the API image dwrg-api:<sha> and the web files (skipped when they
#      exist already, so promoting a staging commit or rolling back builds nothing)
#   3. check out the commit in $DWRG_HOME/<env>/src (compose files, Caddyfile)
#   4. production only: validate the Caddyfile
#   5. run database migrations with the new image (the old version keeps serving)
#   6. point dwrg-api:<env> at the new image and recreate api and worker; wait
#      until healthy, and switch back to the previous version if they aren't
#   7. switch the web files, reload Caddy (production), record the deploy in
#      $DWRG_HOME/<env>/deploys.log, prune old builds
#
# Migrations never run backwards. A rollback runs the old code against the
# newer schema, so every migration must keep working with the version before it
# (add columns and tables first; drop them in a later release).
#
# Environment:
#   DWRG_HOME        default /opt/dwrg
#   NODE_IMAGE       Node base image for the builds (default node:22-trixie-slim)
#   DWRG_BUILD_ARGS  extra `docker build` options, e.g. "--pull" to pick up a
#                    patched base image
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib.sh"

KEEP_DEPLOYS=5 # web builds and images kept per environment, besides the live one

usage() {
  sed -n '2,11p' "$(readlink -f "${BASH_SOURCE[0]}")" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

# Globals used by the exit handler.
ENV_NAME=""
SRC=""
PHASE="prepare"
PREVIOUS=""
PREVIOUS_CHECKOUT=""
PREVIOUS_IMAGE=""
SHA=""
REBUILD=false

main() {
  local target="" skip_staging_check=false rollback=false
  ENV_NAME=${1:-}
  [[ $# -gt 0 ]] && shift
  require_env_name "$ENV_NAME"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --rollback) rollback=true ;;
      --skip-staging-check) skip_staging_check=true ;;
      --rebuild) REBUILD=true ;;
      -h | --help) usage ;;
      -*) die "unknown option $1" ;;
      *)
        [[ -z $target ]] || die "one commit or branch only"
        target=$1
        ;;
    esac
    shift
  done
  [[ $rollback == true || -n $target ]] || usage
  [[ $rollback == false || -z $target ]] || die "--rollback takes no commit (deploy the commit you want instead)"

  SRC="$DWRG_HOME/$ENV_NAME/src"
  local web="$DWRG_HOME/$ENV_NAME/web"
  local deploys="$DWRG_HOME/$ENV_NAME/deploys.log"

  exec 9>"$DWRG_HOME/deploy.lock"
  flock -n 9 || die "another deploy is running"

  check_settings "$ENV_NAME"
  [[ -d $SRC/.git ]] || die "$SRC is not a git checkout (docs/runbooks/deploy.md, first-time setup)"
  if [[ -n $(git -C "$SRC" status --porcelain --untracked-files=no) ]]; then
    die "$SRC has local changes. Changes go through git; see them with: git -C $SRC diff"
  fi
  docker network inspect dwrg-edge >/dev/null 2>&1 || docker network create dwrg-edge >/dev/null
  # Caddy mounts both; if Docker had to create them they'd belong to root.
  mkdir -p "$DWRG_HOME/production/web" "$DWRG_HOME/staging/web"

  # 1. Which commit.
  log "fetching"
  git -C "$SRC" fetch --quiet --prune --tags origin
  PREVIOUS=$(last_deployed "$deploys")
  local kind=deploy
  if [[ $rollback == true ]]; then
    SHA=$(deployed_before "$deploys" "$PREVIOUS")
    [[ -n $SHA ]] || die "no earlier deploy in $deploys to roll back to"
    kind=rollback
  else
    SHA=$(resolve_commit "$target")
    if [[ $ENV_NAME == production && $skip_staging_check == false ]] &&
      ! awk '{print $2}' "$DWRG_HOME/staging/deploys.log" 2>/dev/null | grep -qx "$SHA"; then
      die "commit ${SHA:0:12} never ran on staging. Deploy it there first, or pass --skip-staging-check for an emergency fix."
    fi
  fi
  local live=${PREVIOUS:0:12}
  log "$kind ${SHA:0:12} to $ENV_NAME (live now: ${live:-nothing})"
  git -C "$SRC" log -1 --format='          %h %s (%an, %ar)' "$SHA" >&2

  # 2. Builds.
  build_api
  build_web "$web"

  # 3. Check out. From here on a failure puts things back (on_exit).
  trap on_exit EXIT
  PREVIOUS_CHECKOUT=$(git -C "$SRC" rev-parse HEAD)
  PHASE="checked-out"
  git -C "$SRC" -c advice.detachedHead=false checkout --quiet --detach "$SHA"

  # 4. Caddyfile (Caddy only runs in production; staging's copy is not used).
  if [[ $ENV_NAME == production ]]; then
    local out
    if ! out=$(compose production run --rm --no-deps -T caddy \
      caddy validate --config /etc/dwrg-infra/Caddyfile --adapter caddyfile 2>&1); then
      printf '%s\n' "$out" | tail -n 20 >&2
      die "infra/Caddyfile in ${SHA:0:12} is invalid"
    fi
  fi

  # 5. Migrations, with the new code, while the old version keeps serving.
  log "running migrations"
  MIGRATE_TAG=$SHA compose "$ENV_NAME" run --rm migrate

  # 6. Switch API and worker.
  log "switching api and worker"
  PREVIOUS_IMAGE=$(docker image inspect --format '{{.Id}}' "dwrg-api:$ENV_NAME" 2>/dev/null || true)
  PHASE="switched"
  docker tag "dwrg-api:$SHA" "dwrg-api:$ENV_NAME"
  compose "$ENV_NAME" up --detach --remove-orphans --wait --wait-timeout 180

  # 7. Web files, Caddy, record, prune.
  ln -sfn "releases/$SHA" "$web/current.new"
  mv -T "$web/current.new" "$web/current"
  if [[ $ENV_NAME == production ]]; then
    compose production exec -T caddy \
      caddy reload --config /etc/dwrg-infra/Caddyfile --adapter caddyfile >/dev/null 2>&1 ||
      log "warning: caddy reload failed; Caddy keeps its previous configuration"
  fi
  PHASE="done"
  printf '%s %s %s %s\n' "$(date --iso-8601=seconds)" "$SHA" "${SUDO_USER:-$(id -un)}" "$kind" >>"$deploys"
  smoke_test
  prune
  log "done: $ENV_NAME runs ${SHA:0:12}"
}

# The commit for a branch name (as it is on GitHub), tag or commit id.
resolve_commit() {
  local ref=$1 sha
  if sha=$(git -C "$SRC" rev-parse --verify --quiet "refs/remotes/origin/$ref^{commit}"); then
    printf '%s' "$sha"
  elif sha=$(git -C "$SRC" rev-parse --verify --quiet "$ref^{commit}"); then
    printf '%s' "$sha"
  else
    die "unknown branch, tag or commit: $ref"
  fi
}

last_deployed() { if [[ -f $1 ]]; then tail -n 1 "$1" | awk '{print $2}'; fi; }

# The most recent deployed commit other than $2.
deployed_before() {
  [[ -f $1 ]] || return 0
  awk '{print $2}' "$1" | tac | grep -vx -m 1 "$2" || true
}

build_opts() {
  local opts=()
  if [[ -n ${NODE_IMAGE:-} ]]; then opts+=(--build-arg "NODE_IMAGE=$NODE_IMAGE"); fi
  if [[ -n ${DWRG_BUILD_ARGS:-} ]]; then
    local extra
    read -r -a extra <<<"$DWRG_BUILD_ARGS"
    opts+=("${extra[@]}")
  fi
  if ((${#opts[@]})); then printf '%s\n' "${opts[@]}"; fi
}

# docker_build LABEL ARGS...: builds from a clean copy of the commit (git
# archive, so nothing uncommitted reaches it), logging to build.log.
docker_build() {
  local label=$1
  shift
  local opts buildlog="$DWRG_HOME/$ENV_NAME/build.log"
  mapfile -t opts < <(build_opts)
  if ! git -C "$SRC" archive --format=tar "$SHA" |
    docker build --progress=plain "${opts[@]}" --build-arg "APP_VERSION=$SHA" "$@" - >"$buildlog" 2>&1; then
    tail -n 40 "$buildlog" >&2
    die "the $label build failed (full log: $buildlog)"
  fi
}

build_api() {
  if [[ $REBUILD == false ]] && docker image inspect "dwrg-api:$SHA" >/dev/null 2>&1; then
    log "API image dwrg-api:${SHA:0:12} exists, not rebuilding"
    return
  fi
  log "building the API image"
  docker_build API -f apps/api/Dockerfile -t "dwrg-api:$SHA"
}

build_web() {
  local web=$1
  local dest="$web/releases/$SHA"
  if [[ $REBUILD == false && -f $dest/index.html ]]; then
    log "web build ${SHA:0:12} exists, not rebuilding"
    return
  fi
  mkdir -p "$web/releases"
  local incoming="$web/releases/.incoming-$SHA"
  rm -rf "$incoming"
  local twin
  twin="$DWRG_HOME/$(other_env "$ENV_NAME")/web/releases/$SHA"
  if [[ $REBUILD == false && -f $twin/index.html ]]; then
    log "copying the web build from $(other_env "$ENV_NAME")"
    cp -a "$twin" "$incoming"
  else
    log "building the web app"
    docker_build web -f apps/web/Dockerfile --output "type=local,dest=$incoming"
  fi
  [[ -f $incoming/index.html ]] || die "the web build has no index.html"
  chmod -R a+rX "$incoming"
  if [[ -d $dest ]]; then
    # --rebuild of the live commit: swap the folder in place of the old one.
    mv -T "$dest" "$web/releases/.replaced-$SHA"
    mv -T "$incoming" "$dest"
    rm -rf "$web/releases/.replaced-$SHA"
  else
    mv -T "$incoming" "$dest"
  fi
}

# Runs on every exit once the checkout has started; puts things back on failure.
on_exit() {
  local code=$?
  [[ $code -ne 0 ]] || return 0
  case "$PHASE" in
    checked-out)
      log "failed before switching: $ENV_NAME still runs ${PREVIOUS:0:12}"
      git -C "$SRC" checkout --quiet --detach "$PREVIOUS_CHECKOUT" || true
      ;;
    switched)
      # The exact image and files that ran before (also right for --rebuild of the live commit).
      if [[ -n $PREVIOUS_IMAGE ]] && docker image inspect "$PREVIOUS_IMAGE" >/dev/null 2>&1; then
        log "new version unhealthy: switching back to ${PREVIOUS:0:12}"
        compose "$ENV_NAME" logs --tail 40 api worker >&2 || true
        docker tag "$PREVIOUS_IMAGE" "dwrg-api:$ENV_NAME"
        git -C "$SRC" checkout --quiet --detach "$PREVIOUS_CHECKOUT" || true
        if compose "$ENV_NAME" up --detach --remove-orphans --wait --wait-timeout 180; then
          log "back on ${PREVIOUS:0:12}; the web files were not switched"
        else
          log "ROLLBACK FAILED: $ENV_NAME is down. See docs/runbooks/deploy.md, 'When a deploy fails'."
        fi
      else
        log "new version unhealthy and there is no previous image to go back to. See docs/runbooks/deploy.md."
      fi
      ;;
  esac
  exit "$code"
}

# Through Caddy, the way users reach it. A warning only: the containers are
# already healthy, and a brand-new site may still be getting its certificate.
smoke_test() {
  local domain host
  domain=$(env_get "$DWRG_HOME/$ENV_NAME/app.env" DOMAIN || true)
  [[ -n $domain ]] || return 0
  if [[ $ENV_NAME == production ]]; then host="app.$domain"; else host="staging.$domain"; fi
  if curl -fs -o /dev/null --max-time 15 --resolve "$host:443:127.0.0.1" "https://$host/health"; then
    log "https://$host/health answers"
  else
    log "warning: https://$host/health did not answer through Caddy (DNS, certificate or Caddy; see docs/runbooks/monitoring.md)"
  fi
}

# Keeps what the last $KEEP_DEPLOYS deploys of each environment used, plus
# whatever is live, so a rollback rarely has to rebuild. Web builds are per
# environment; images are shared (staging's image is promoted to production).
prune() {
  local env_name all_recent=""
  for env_name in production staging; do
    local web="$DWRG_HOME/$env_name/web" recent="" live dir name
    if [[ -f $DWRG_HOME/$env_name/deploys.log ]]; then
      recent=$(tail -n "$KEEP_DEPLOYS" "$DWRG_HOME/$env_name/deploys.log" | awk '{print $2}')
    fi
    all_recent+="$recent"$'\n'
    [[ -d $web/releases ]] || continue
    live=$(readlink "$web/current" 2>/dev/null || true)
    for dir in "$web"/releases/*/; do
      [[ -d $dir ]] || continue
      name=$(basename "$dir")
      if ! grep -qx "$name" <<<"$recent" && [[ $live != "releases/$name" ]]; then
        rm -rf "$dir"
      fi
    done
  done
  local tag
  for tag in $(docker image ls dwrg-api --format '{{.Tag}}' | grep -E '^[0-9a-f]{40}$' || true); do
    # The live commits are always among the recent ones (last line of each log).
    grep -qx "$tag" <<<"$all_recent" || docker image rm "dwrg-api:$tag" >/dev/null 2>&1 || true
  done
  docker image prune --force >/dev/null 2>&1 || true
  docker builder prune --force --filter until=168h >/dev/null 2>&1 || true
}

main "$@"
