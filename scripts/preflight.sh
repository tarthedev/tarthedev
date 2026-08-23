#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pre-deployment survey.
#
# READ-ONLY. Changes nothing, installs nothing, restarts nothing. Run this
# first — the VPS probably already hosts something, and the deployment must not
# disturb it.
#
#   bash scripts/preflight.sh
# ---------------------------------------------------------------------------
set -uo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }

APP_PORT="${APP_PORT:-3020}"
PG_PORT="${POSTGRES_PORT:-5433}"

has() { command -v "$1" >/dev/null 2>&1; }

# --- host ------------------------------------------------------------------
bold "Host"
if [ -r /etc/os-release ]; then
  . /etc/os-release
  ok "OS: ${PRETTY_NAME:-unknown}"
else
  warn "OS: could not read /etc/os-release"
fi
ok "Kernel: $(uname -r)  Arch: $(uname -m)"

CPUS=$(nproc 2>/dev/null || echo "?")
MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
ok "CPU cores: ${CPUS}"
if [ "$MEM_MB" -gt 0 ]; then
  ok "RAM: ${MEM_MB} MB"
  [ "$MEM_MB" -lt 1024 ] && warn "Under 1 GB RAM. Next builds may fail — build elsewhere, or add swap."
  [ "$MEM_MB" -lt 2048 ] && info "Under 2 GB: build the image on your laptop and push it, rather than building on the VPS."
fi

DISK_AVAIL=$(df -Pk / 2>/dev/null | awk 'NR==2 {printf "%.1f", $4/1024/1024}')
ok "Free disk on /: ${DISK_AVAIL:-?} GB"
awk -v g="${DISK_AVAIL:-0}" 'BEGIN { if (g+0 < 5) exit 0; exit 1 }' && warn "Under 5 GB free. Docker images plus Postgres want more headroom."

# --- toolchain -------------------------------------------------------------
bold "Toolchain"
if has docker; then
  ok "Docker: $(docker --version 2>/dev/null | head -1)"
  if docker compose version >/dev/null 2>&1; then
    ok "Docker Compose: $(docker compose version --short 2>/dev/null)"
  else
    warn "Docker Compose v2 plugin not found. Install docker-compose-plugin."
  fi
  docker info >/dev/null 2>&1 || warn "Docker daemon unreachable as this user. Try sudo, or add yourself to the docker group."
else
  warn "Docker not installed. Either install it, or follow the bare-metal path in docs/DEPLOYMENT.md."
fi

if has node; then
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
  ok "Node: $(node -v)"
  [ "${NODE_MAJOR:-0}" -lt 20 ] && warn "Node 20+ required for the bare-metal path."
else
  info "Node not installed (only needed for the bare-metal path)."
fi

has psql && ok "psql client: $(psql --version | awk '{print $3}')" || info "psql client not installed (handy for backups and restores)."
has git && ok "git: $(git --version | awk '{print $3}')" || warn "git not installed."
has openssl && ok "openssl present (used to generate secrets)" || warn "openssl not installed — needed to generate SESSION_SECRET."

# --- existing services -----------------------------------------------------
bold "Existing web services — do not disturb these"
FOUND_PROXY=""
for svc in nginx apache2 httpd caddy traefik haproxy lighttpd; do
  if has "$svc" || systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\.service"; then
    STATE=$(systemctl is-active "$svc" 2>/dev/null || echo "unknown")
    if [ "$STATE" = "active" ]; then
      ok "${svc}: RUNNING"
      FOUND_PROXY="${FOUND_PROXY} ${svc}"
    else
      info "${svc}: installed, ${STATE}"
    fi
  fi
done

if [ -n "$FOUND_PROXY" ]; then
  warn "Reverse proxy already serving traffic:${FOUND_PROXY}"
  info "Add a NEW server block on your own subdomain. Do not replace or reorder existing configuration."
  case "$FOUND_PROXY" in
    *nginx*)   info "Template: deploy/nginx/kpi.conf" ;;
    *caddy*)   info "Template: deploy/caddy/Caddyfile" ;;
    *apache*|*httpd*) info "Template: deploy/apache/kpi.conf" ;;
  esac
else
  info "No reverse proxy detected. Caddy is the simplest option — it obtains certificates automatically."
fi

if [ -d /etc/nginx/sites-enabled ]; then
  SITES=$(find /etc/nginx/sites-enabled -type l -o -type f 2>/dev/null | wc -l)
  info "nginx sites-enabled: ${SITES} config(s) — leave every one of them alone."
fi

# --- ports -----------------------------------------------------------------
bold "Ports"
listening() {
  if has ss; then ss -lntH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un
  elif has netstat; then netstat -lnt 2>/dev/null | awk 'NR>2 {print $4}' | sed 's/.*://' | sort -un
  fi
}
PORTS_IN_USE=$(listening)

port_busy() { echo "$PORTS_IN_USE" | grep -qx "$1"; }

for p in 80 443; do
  port_busy "$p" && info "Port ${p}: in use (expected — that is the reverse proxy)" || info "Port ${p}: free"
done

if port_busy "$APP_PORT"; then
  warn "Port ${APP_PORT} is taken. Set APP_PORT in .env to something free."
else
  ok "Port ${APP_PORT} free for the app"
fi

if port_busy "$PG_PORT"; then
  warn "Port ${PG_PORT} is taken. Set POSTGRES_PORT in .env to something free."
else
  ok "Port ${PG_PORT} free for Postgres"
fi

port_busy 5432 && info "Port 5432 in use — an existing Postgres. The stack uses ${PG_PORT} to avoid it."

# --- postgres --------------------------------------------------------------
bold "PostgreSQL"
if systemctl is-active postgresql >/dev/null 2>&1; then
  warn "A system PostgreSQL is running. The compose stack brings its own on port ${PG_PORT} and will not touch it."
  has psql && info "Server version: $(psql --version | awk '{print $3}')"
else
  info "No system PostgreSQL running. The compose stack provides one."
fi

# --- summary ---------------------------------------------------------------
bold "Next steps"
info "1. cp .env.example .env  and fill in every CHANGE_ME"
info "2. SESSION_SECRET:    openssl rand -base64 48"
info "3. POSTGRES_PASSWORD: openssl rand -base64 24"
info "4. Point a DNS A record for your subdomain at this server"
info "5. docker compose up -d --build"
info "6. Add the reverse-proxy config from deploy/ and obtain a certificate"
info ""
info "Full walkthrough: docs/DEPLOYMENT.md"
