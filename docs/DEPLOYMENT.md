# Deployment

Target: a Linux VPS that **already runs other things**. Nothing here replaces an
existing web server, rebinds a port in use, or restarts a service it did not
install.

---

## Step 0 — survey the server first

```bash
git clone <your-repo> /opt/kpi-command-center
cd /opt/kpi-command-center
bash scripts/preflight.sh
```

Read-only. It reports OS, RAM, CPU, disk, Docker, Node, PostgreSQL, which
reverse proxy is running, and which ports are taken — then tells you what to do
about each.

Act on its warnings before continuing:

- **Port 3020 or 5433 taken** → set `APP_PORT` / `POSTGRES_PORT` in `.env`.
- **nginx/Apache/Caddy already running** → you are adding a subdomain, not
  taking over. Use the matching template in `deploy/`.
- **Under 2 GB RAM** → build the image on your laptop and push it; a Next build
  can exhaust a small VPS.

---

## Step 1 — DNS

Point an A record at the server before requesting a certificate; Let's Encrypt
verifies over HTTP and fails if DNS has not propagated.

```
kpi.example.com.  A  <your-server-ip>
```

Check it:

```bash
dig +short kpi.example.com
```

---

## Step 2 — configure

```bash
cp .env.example .env
openssl rand -base64 48   # → SESSION_SECRET
openssl rand -base64 24   # → POSTGRES_PASSWORD
nano .env
```

Must be set:

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | ≥32 chars. Changing it signs everyone out. |
| `POSTGRES_PASSWORD` | Never leaves the Docker network. |
| `APP_URL` | `https://kpi.example.com`. The cookie's `Secure` flag is derived from this — get it right. |
| `ANTHROPIC_API_KEY` | Or leave blank and set `AI_DEV_MODE=true` to run on the mock provider. |
| `TIMEZONE` | Decides when "today" and the week boundary roll over. |

Lock it down:

```bash
chmod 600 .env
```

> **Try it without an API key first.** `AI_DEV_MODE=true` runs the entire
> pipeline — upload, extraction, review, dashboard, coach, cost ledger — against
> a deterministic mock. Confirm the deployment works, then add the key.

---

## Step 3 — start the stack

```bash
docker compose up -d --build
```

Three services: `db` (Postgres 17), `migrate` (one-shot, runs
`prisma migrate deploy` and exits), `app`. Compose waits for the database to be
healthy and for migrations to complete before starting the app.

Both `db` and `app` bind to **127.0.0.1 only**. Nothing is publicly reachable
until you add the reverse proxy in the next step.

```bash
docker compose ps
curl -fsS http://127.0.0.1:3020/api/health
# {"status":"ok","database":"up","latencyMs":3}
```

If the app is unhealthy: `docker compose logs app`.

---

## Step 4 — reverse proxy

Pick the one already running on the server. Each template creates a **new**
server block for your subdomain and leaves existing configuration untouched.

### nginx

```bash
sudo cp deploy/nginx/kpi.conf /etc/nginx/sites-available/kpi.conf
sudo sed -i 's/kpi.example.com/YOUR-DOMAIN/g' /etc/nginx/sites-available/kpi.conf
sudo ln -s /etc/nginx/sites-available/kpi.conf /etc/nginx/sites-enabled/
sudo nginx -t          # never skip this
sudo systemctl reload nginx
```

The template's TLS lines reference certificates that do not exist yet. Either
comment out the `443` block, get the certificate, then uncomment — or let
certbot do both:

```bash
sudo certbot --nginx -d kpi.example.com
```

### Caddy

Simplest option: certificates are automatic.

```bash
sudo sh -c 'cat deploy/caddy/Caddyfile >> /etc/caddy/Caddyfile'   # append, don't replace
sudo sed -i 's/kpi.example.com/YOUR-DOMAIN/g' /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Apache

```bash
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo cp deploy/apache/kpi.conf /etc/apache2/sites-available/kpi.conf
sudo sed -i 's/kpi.example.com/YOUR-DOMAIN/g' /etc/apache2/sites-available/kpi.conf
sudo a2ensite kpi
sudo apachectl configtest
sudo systemctl reload apache2
sudo certbot --apache -d kpi.example.com
```

### No proxy yet

Install Caddy — it is two commands and handles renewal without a cron job:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

---

## Step 5 — first sign-in

Open `https://kpi.example.com`. With no account yet you land on `/setup`.

1. Create your account — it becomes the owner.
2. Pick your timezone.
3. Nine starter KPIs are created (Internet, VMP, SMB, CPG, CPE, MNA, Upgrades,
   New Lines, Accessories). Rename, reweight, deactivate or add freely — they
   are only a starting point.
4. Set this period's targets on **Goals**, and mark your days off.
5. Upload your first batch of screenshots.

Then close registration:

```bash
sed -i 's/^ALLOW_REGISTRATION=true/ALLOW_REGISTRATION=false/' .env
docker compose up -d app
```

---

## Step 6 — backups

A deployment without a tested restore is not finished.

```bash
bash scripts/backup.sh     # dump + screenshot archive into ./backups
```

Nightly at 03:00:

```bash
crontab -e
0 3 * * * cd /opt/kpi-command-center && bash scripts/backup.sh >> /var/log/kpi-backup.log 2>&1
```

**Test the restore now, while nothing depends on it:**

```bash
bash scripts/restore.sh backups/kpi-db-<stamp>.dump
```

Copy backups off the server. A backup on the same disk is not a backup.

---

## Updating

```bash
bash scripts/update.sh
```

Backs up, records the current commit, pulls, rebuilds, migrates, restarts, and
polls `/api/health`. If health never comes up it prints the logs and tells you
to roll back.

## Rolling back

```bash
bash scripts/rollback.sh
```

Returns to the previous commit. This reverts **code, not data** — if the failed
deploy ran a destructive migration, restore the pre-update dump as well.

---

## Without Docker

Node 20+, PostgreSQL 16+, and a build toolchain for `sharp`.

```bash
sudo -u postgres createuser --pwprompt kpi
sudo -u postgres createdb -O kpi kpi

npm ci
npx prisma migrate deploy
npm run build

sudo useradd --system --home /opt/kpi-command-center kpi
sudo chown -R kpi:kpi /opt/kpi-command-center
sudo cp deploy/systemd/kpi.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now kpi
sudo journalctl -u kpi -f
```

Set `DATABASE_URL` to your local Postgres and `STORAGE_PATH` to a directory the
`kpi` user owns, **outside** any web root.

---

## Object storage instead of local disk

When the VPS disk gets tight, move screenshots to an S3-compatible bucket.
Cloudflare R2 has no egress fees, which suits this workload.

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT="https://<account>.r2.cloudflarestorage.com"
S3_REGION="auto"
S3_BUCKET="kpi-screenshots"
S3_ACCESS_KEY_ID="..."
S3_SECRET_ACCESS_KEY="..."
```

Two things to know:

- Existing images stay on local disk. Copy them into the bucket under the same
  keys before switching, or old snapshots will show a broken image.
- The local driver is the one covered by the test suite. The S3 driver signs
  requests itself (SigV4, no SDK) and has not been exercised against a live
  bucket here — upload a snapshot and confirm the image renders before you trust
  it with your only copy.

Keep the bucket **private**. The app streams images through its authenticated
route; a public bucket would undo that.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid environment configuration` on start | Missing or short `SESSION_SECRET` | `openssl rand -base64 48` |
| 502 from the proxy | App not running, or wrong port | `docker compose ps`; check `APP_PORT` matches the proxy config |
| Signed out on every request | `APP_URL` is `http://` but you browse over `https://` | Set `APP_URL` to the real HTTPS URL and restart |
| Uploads fail at ~1 MB | Proxy body limit | `client_max_body_size` (nginx) / `LimitRequestBody` (Apache) |
| Extraction times out | Proxy read timeout too low | Raise to 300s |
| `ANTHROPIC_API_KEY is required` | AI on with no key | Add the key, or `AI_DEV_MODE=true` |
| Extraction blocked | Monthly budget hit | Raise it in Settings, or wait for the month to roll over |
| Images 410 Gone | Storage path changed or volume lost | Restore the storage archive from a backup |
