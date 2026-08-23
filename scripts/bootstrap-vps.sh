#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# KPI Command Center — one-command VPS installer.
#
#   sudo bash bootstrap-vps.sh kpi.example.com
#   sudo bash bootstrap-vps.sh kpi.example.com --origin-cert
#
# Installs Docker if missing, clones the app, generates its secrets on this
# machine, brings up the stack, and puts Caddy in front of it with TLS.
#
# Safe to re-run: every step checks before it acts, and nothing already
# serving traffic on this box is modified.
# ---------------------------------------------------------------------------
set -euo pipefail

DOMAIN="${1:-}"
TLS_MODE="letsencrypt"
[ "${2:-}" = "--origin-cert" ] && TLS_MODE="origin-cert"

APP_DIR="${APP_DIR:-/opt/kpi-command-center}"
REPO="${REPO:-https://github.com/tarthedev/tarthedev.git}"
BRANCH="${BRANCH:-claude/verizon-kpi-command-center-np4niz}"
APP_PORT="${APP_PORT:-3020}"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
info() { printf '    %s\n' "$1"; }

[ -n "$DOMAIN" ] || die "Usage: sudo bash bootstrap-vps.sh <domain> [--origin-cert]"
[ "$(id -u)" -eq 0 ] || die "Run as root (use sudo)."

# Normalise: DNS is case-insensitive but Caddy site addresses are not.
DOMAIN="$(echo "$DOMAIN" | tr '[:upper:]' '[:lower:]')"

bold "KPI Command Center installer"
info "domain:    ${DOMAIN}"
info "directory: ${APP_DIR}"
info "tls:       ${TLS_MODE}"

# --- 1. prerequisites ------------------------------------------------------
bold "1/7  Prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates dnsutils >/dev/null
ok "base packages"

if ! command -v docker >/dev/null 2>&1; then
  info "installing Docker (official convenience script)…"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
  ok "Docker installed"
else
  ok "Docker already present: $(docker --version | awk '{print $3}' | tr -d ,)"
fi

docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin missing. Install docker-compose-plugin and re-run."
systemctl is-active --quiet docker || systemctl start docker
ok "Docker daemon running"

# --- 2. DNS ----------------------------------------------------------------
bold "2/7  DNS"
SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
RESOLVED="$(dig +short "$DOMAIN" A | grep -E '^[0-9]+\.' | head -1 || true)"
info "this server: ${SERVER_IP}"
info "${DOMAIN} → ${RESOLVED:-<no A record>}"

BEHIND_CLOUDFLARE=false
if [ -z "$RESOLVED" ]; then
  die "${DOMAIN} has no A record. Add one pointing at ${SERVER_IP}, then re-run."
elif [ "$RESOLVED" != "$SERVER_IP" ]; then
  # Cloudflare's published ranges start 104.16-28 and 172.64-71.
  if echo "$RESOLVED" | grep -qE '^(104\.(1[6-9]|2[0-8])\.|172\.(6[4-9]|7[01])\.)'; then
    BEHIND_CLOUDFLARE=true
    warn "${DOMAIN} resolves to Cloudflare (${RESOLVED}), not to this server."
    info "The DNS record is proxied — the orange cloud is ON."
  else
    warn "${DOMAIN} points at ${RESOLVED}, which is not this server (${SERVER_IP})."
  fi
else
  ok "DNS points directly at this server"
fi

if [ "$BEHIND_CLOUDFLARE" = true ] && [ "$TLS_MODE" = "letsencrypt" ]; then
  cat <<EOF

  ──────────────────────────────────────────────────────────────────────
  Cloudflare's proxy is in front of this domain, so Let's Encrypt cannot
  validate against this server. Pick one:

  A) Keep Cloudflare's proxy  (recommended — hides this server's IP)
     1. Cloudflare → SSL/TLS → Origin Server → Create Certificate
     2. Save the certificate to /etc/ssl/kpi/origin.pem
        and the private key to  /etc/ssl/kpi/origin.key
     3. Cloudflare → SSL/TLS → Overview → set mode to "Full (strict)"
     4. Re-run:  sudo bash $0 ${DOMAIN} --origin-cert

  B) Turn the proxy off  (simplest)
     1. Cloudflare → DNS → click the orange cloud on "${DOMAIN}"
        so it turns grey (DNS only)
     2. Wait about a minute, then re-run this script unchanged.
  ──────────────────────────────────────────────────────────────────────
EOF
  exit 2
fi

if [ "$TLS_MODE" = "origin-cert" ]; then
  [ -s /etc/ssl/kpi/origin.pem ] || die "/etc/ssl/kpi/origin.pem is missing or empty."
  [ -s /etc/ssl/kpi/origin.key ] || die "/etc/ssl/kpi/origin.key is missing or empty."
  chmod 600 /etc/ssl/kpi/origin.key
  ok "Cloudflare origin certificate present"
fi

# --- 3. source -------------------------------------------------------------
bold "3/7  Application source"
if [ -d "${APP_DIR}/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet "origin/${BRANCH}"
  ok "updated existing checkout"
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
  ok "cloned to ${APP_DIR}"
fi
cd "$APP_DIR"

# --- 4. configuration ------------------------------------------------------
bold "4/7  Configuration"
if [ -f .env ]; then
  ok ".env already exists — leaving it untouched"
  info "delete it and re-run if you want fresh secrets"
else
  # Secrets are generated here, on this machine. They are never transmitted.
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  POSTGRES_PASSWORD="$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 32)"

  cat > .env <<EOF
# Generated by bootstrap-vps.sh on $(date -Iseconds)
DATABASE_URL="postgresql://kpi:${POSTGRES_PASSWORD}@127.0.0.1:5432/kpi?schema=public"
POSTGRES_USER=kpi
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=kpi
POSTGRES_PORT=5433

APP_PORT=${APP_PORT}
APP_URL="https://${DOMAIN}"
SESSION_SECRET="${SESSION_SECRET}"
SESSION_TTL_DAYS=30
TIMEZONE="America/New_York"
ALLOW_REGISTRATION=true

# Add your key here, then: docker compose up -d app
ANTHROPIC_API_KEY=""
AI_ENABLED=true
# Starts in mock mode so the whole app works before you add a key.
AI_DEV_MODE=true

AI_EXTRACTION_MODEL="claude-sonnet-5"
AI_COACH_MODEL="claude-sonnet-5"
AI_CHAT_MODEL="claude-sonnet-5"
AI_ESCALATION_MODEL="claude-opus-5"
AI_DEEP_ANALYSIS_MODEL="claude-opus-5"

AI_MONTHLY_BUDGET_USD=10
AI_CONFIDENCE_THRESHOLD=0.8
AI_MAX_EXTRACTION_ATTEMPTS=3

STORAGE_DRIVER=local
STORAGE_PATH="/app/storage"

MAX_UPLOAD_MB=15
MAX_IMAGES_PER_SNAPSHOT=30

RATE_LIMIT_LOGIN_PER_15MIN=10
RATE_LIMIT_UPLOAD_PER_HOUR=60
RATE_LIMIT_AI_PER_HOUR=120
EOF
  chmod 600 .env
  ok "generated .env with fresh secrets (chmod 600)"
  info "starting in AI_DEV_MODE — no API key needed to try it"
fi

# --- 5. stack --------------------------------------------------------------
bold "5/7  Application stack"
info "building (first run takes a few minutes)…"
docker compose up -d --build 2>&1 | grep -viE "^#|warn|pull|download|extract|waiting" | tail -5 || true

info "waiting for health…"
HEALTHY=false
for i in $(seq 1 90); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    HEALTHY=true; ok "app healthy after ${i}s"; break
  fi
  sleep 1
done
if [ "$HEALTHY" != true ]; then
  warn "app did not become healthy. Recent logs:"
  docker compose logs --tail=40 app
  die "Fix the errors above, then re-run this script."
fi

# --- 6. reverse proxy ------------------------------------------------------
bold "6/7  Reverse proxy and TLS"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  ok "Caddy installed"
else
  ok "Caddy already present"
fi

# Each site lives in its own file, so anything else Caddy serves is untouched.
mkdir -p /etc/caddy/sites
grep -q 'import sites/\*' /etc/caddy/Caddyfile 2>/dev/null || \
  printf '\nimport sites/*\n' >> /etc/caddy/Caddyfile

if [ "$TLS_MODE" = "origin-cert" ]; then
  TLS_LINE="tls /etc/ssl/kpi/origin.pem /etc/ssl/kpi/origin.key"
else
  TLS_LINE="# TLS is automatic via Let's Encrypt"
fi

cat > "/etc/caddy/sites/${DOMAIN}.caddy" <<EOF
# KPI Command Center — generated by bootstrap-vps.sh
${DOMAIN} {
	${TLS_LINE}

	reverse_proxy 127.0.0.1:${APP_PORT} {
		header_up X-Real-IP {remote_host}
		transport http {
			read_timeout 300s
			write_timeout 300s
		}
	}

	request_body {
		max_size 200MB
	}

	header {
		X-Robots-Tag "noindex, nofollow, noarchive"
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	encode zstd gzip
}
EOF
ok "wrote /etc/caddy/sites/${DOMAIN}.caddy"

caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
  || die "Caddy config failed validation. Check /etc/caddy/Caddyfile."
systemctl reload caddy 2>/dev/null || systemctl restart caddy
ok "Caddy reloaded"

# Only touch the firewall if it is already active — never lock anyone out.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 22/tcp  >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ok "ufw: 22, 80, 443 allowed"
fi

# --- 7. verify -------------------------------------------------------------
bold "7/7  Verification"
info "waiting for the certificate…"
LIVE=false
for i in $(seq 1 60); do
  CODE="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 8 "https://${DOMAIN}/api/health" 2>/dev/null || echo 000)"
  if [ "$CODE" = "200" ]; then LIVE=true; ok "https://${DOMAIN} is live"; break; fi
  sleep 2
done

if [ "$LIVE" != true ]; then
  warn "HTTPS is not answering yet."
  info "The app itself is healthy on 127.0.0.1:${APP_PORT}."
  info "Certificate issuance can take a minute. Check with:"
  info "  journalctl -u caddy -n 50 --no-pager"
fi

# Backups from day one — an install without them is not finished.
CRON="0 3 * * * cd ${APP_DIR} && bash scripts/backup.sh >> /var/log/kpi-backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'kpi-command-center.*backup.sh'; echo "$CRON" ) | crontab -
ok "nightly backup scheduled for 03:00"

bold "Done"
cat <<EOF
  Open:  https://${DOMAIN}
  Create your account — the first one becomes the owner.

  Currently running in mock AI mode, so the full pipeline works without an
  API key. To switch on real extraction:

    nano ${APP_DIR}/.env        # set ANTHROPIC_API_KEY, and AI_DEV_MODE=false
    cd ${APP_DIR} && docker compose up -d app

  After you have created your account, close signup:

    sed -i 's/^ALLOW_REGISTRATION=true/ALLOW_REGISTRATION=false/' ${APP_DIR}/.env
    cd ${APP_DIR} && docker compose up -d app

  Logs:     cd ${APP_DIR} && docker compose logs -f app
  Update:   cd ${APP_DIR} && bash scripts/update.sh
  Backup:   cd ${APP_DIR} && bash scripts/backup.sh
EOF
