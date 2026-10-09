# Deploy runbook

How the platform is hosted, how to set up the droplet the first time, and how to ship, migrate and roll back. Companion runbooks: [backup-restore.md](backup-restore.md) and [monitoring.md](monitoring.md). Architecture and costs are in [03-tech-stack.md](../03-tech-stack.md).

## What runs where

One DigitalOcean droplet runs two copies of the platform with Docker Compose. Both use one DigitalOcean Managed PostgreSQL cluster.

| | Production | Staging |
|---|---|---|
| Address | `https://app.<domain>` | `https://staging.<domain>` |
| Compose project | `dwrg-production` | `dwrg-staging` |
| Containers | `caddy`, `api`, `worker` | `api`, `worker` (capped at 1 CPU and 1 GB each) |
| Database | `dwrg_production` | `dwrg_staging` (same cluster) |
| Settings | `/opt/dwrg/production/app.env` | `/opt/dwrg/staging/app.env` |
| Code | `/opt/dwrg/production/src` (git checkout of the live commit) | `/opt/dwrg/staging/src` |
| Web files | `/opt/dwrg/production/web/current` | `/opt/dwrg/staging/web/current` |

```
 internet ──443──> caddy (production project, owns ports 80/443)
                     ├─ app.<domain>      /api, /health ─> api-production:8787   other paths ─> production web files
                     └─ staging.<domain>  /api, /health ─> api-staging:8787      other paths ─> staging web files
 api, worker ──TLS──> Managed PostgreSQL (private network)
```

- **Caddy** gets HTTPS certificates automatically, serves the web app's files and passes `/api/*` (including `/api/auth` and the WebSocket) and `/health` to the API. Config: [infra/Caddyfile](../../infra/Caddyfile).
- **api** is the Hono API, built from [apps/api/Dockerfile](../../apps/api/Dockerfile). It runs the TypeScript source with tsx, as a non-root user with a read-only filesystem.
- **worker** runs the background jobs. For now it is a placeholder that only reports healthy. It uses the API image until `apps/worker` has its jobs.
- **migrate** is a one-off container from the API image that applies database migrations. `deploy.sh` runs it.

The files: [infra/docker-compose.prod.yml](../../infra/docker-compose.prod.yml) (both environments), [infra/docker-compose.staging.yml](../../infra/docker-compose.staging.yml) (staging's differences), and the scripts in [infra/scripts/](../../infra/scripts/).

**Always go through `infra/scripts/dc.sh <production|staging> ...`** instead of calling `docker compose` yourself. It picks the right files, project and settings, and refuses obvious mistakes: a settings file other users can read, a staging file labelled production, staging pointed at the production database, or demo data aimed at production.

## First-time setup

About two hours. Do the steps in order. Commands run as the `deploy` user unless they start with `sudo`.

### 1. DigitalOcean resources

Put everything in the same region and VPC. NYC3 is the closest region to Elizabeth City.

1. **Droplet:** Ubuntu 24.04 LTS (or 26.04 LTS), Basic, 4 vCPU / 8 GB. Tick **Monitoring** (installs the metrics agent used for alerts) and add your SSH key. Droplet backups are optional: everything on the droplet can be rebuilt from git with this runbook, apart from the settings files, which you keep in the password manager.
2. **Managed PostgreSQL 17** cluster in the same region and VPC.
   - Under *Settings › Trusted sources*, add only the droplet.
   - Under *Users & Databases*, create databases `dwrg_production` and `dwrg_staging`, and users `dwrg_production` and `dwrg_staging`.
   - Make each user the owner of its own database, so migrations can create tables and staging's user can't read production. Connect as `doadmin` (from the droplet, after step 4: `docker run --rm -it postgres:17 psql "<doadmin connection string>"`) and run:

     ```sql
     ALTER DATABASE dwrg_production OWNER TO dwrg_production;
     ALTER DATABASE dwrg_staging OWNER TO dwrg_staging;
     REVOKE CONNECT ON DATABASE dwrg_production FROM PUBLIC;
     REVOKE CONNECT ON DATABASE dwrg_staging FROM PUBLIC;
     GRANT CONNECT ON DATABASE dwrg_production TO dwrg_production;
     GRANT CONNECT ON DATABASE dwrg_staging TO dwrg_staging;
     ```

     If Postgres says you must be able to `SET ROLE`, run `GRANT dwrg_production TO doadmin;` (and the same for staging) first.
   - On *Overview › Connection details*, choose **VPC network** and note each user's connection string (port 25060). Click **Download CA certificate**: it becomes `/opt/dwrg/db-ca.crt` in step 7.
3. **Cloud Firewall** applied to the droplet. Inbound: TCP 22 (only from your own IP addresses if you can), TCP 80, TCP 443 and UDP 443 (HTTP/3). Outbound: everything.

   Use the Cloud Firewall, not only `ufw`. Docker writes its own iptables rules for published ports, so `ufw` doesn't actually guard ports 80 and 443 on a Docker host. The Cloud Firewall sits outside the droplet, so Docker can't bypass it.

### 2. DNS

At the domain's DNS host:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `app` | droplet IPv4 | 300 |
| A | `staging` | droplet IPv4 | 300 |
| CAA (optional) | `@` | `0 issue "letsencrypt.org"` and `0 issue "sectigo.com"` | 3600 |

Don't add AAAA (IPv6) records. Docker's default networks are IPv4-only, so IPv6 visitors would reach the API through Docker's proxy and every request would appear to come from the same internal address, which spoils logs and rate limits. The CAA record allows Caddy's two certificate authorities, Let's Encrypt and ZeroSSL (whose certificates are issued by Sectigo). Check with `dig +short app.<domain>` before the first deploy: Caddy can only get a certificate once the name points at the droplet.

### 3. The server

Log in as root once to create the `deploy` user, then use that user from then on.

```bash
# as root
adduser --gecos "" deploy                      # set a password: it's the sudo password
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
```

Check that `ssh deploy@<droplet>` and `sudo -v` work in a second terminal, then turn off password logins and root login:

```bash
sudo tee /etc/ssh/sshd_config.d/10-dwrg.conf >/dev/null <<'EOF'
PasswordAuthentication no
PermitRootLogin no
EOF
sudo systemctl reload ssh
```

Business time zone, swap (the web build peaks above 2 GB), and automatic security updates with a nightly reboot window:

```bash
sudo timedatectl set-timezone America/New_York
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades git curl age rclone
sudo tee /etc/apt/apt.conf.d/52dwrg-reboot >/dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
EOF
```

A reboot takes the site down for a minute or two at 03:30, only when an update needs one. Every container comes back by itself (`restart: unless-stopped`). Once phones run through the platform (after the switch), give Twilio a fallback number so calls still ring during that minute.

### 4. Docker

Docker's own packages (Ubuntu's are older). From [docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Keep containers running while Docker itself is upgraded, and cap the logs of anything not started by Compose (Compose sets its own caps):

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "live-restore": true,
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
EOF
sudo systemctl restart docker
sudo usermod -aG docker deploy      # log out and back in afterwards
docker network create dwrg-edge     # shared by both projects so Caddy reaches both APIs
```

Membership in the `docker` group is as good as root. Only `deploy` gets it.

### 5. Access to the code

A read-only deploy key, so the droplet can fetch from GitHub but never push:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "dwrg droplet"
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
cat ~/.ssh/github_deploy.pub
```

Add the printed key on GitHub under *tarthedev/tarthedev › Settings › Deploy keys*, without write access. Then:

```bash
sudo mkdir -p /opt/dwrg && sudo chown deploy:deploy /opt/dwrg
git clone git@github.com:tarthedev/tarthedev.git /opt/dwrg/production/src
git clone git@github.com:tarthedev/tarthedev.git /opt/dwrg/staging/src
mkdir -p /opt/dwrg/production/web /opt/dwrg/staging/web
```

### 6. Settings files

Each environment has one settings file. The template [infra/.env.production.example](../../infra/.env.production.example) explains every line.

```bash
cp /opt/dwrg/production/src/infra/.env.production.example /opt/dwrg/production/app.env
cp /opt/dwrg/production/src/infra/.env.production.example /opt/dwrg/staging/app.env
chmod 600 /opt/dwrg/*/app.env
openssl rand -hex 32     # run twice: one BETTER_AUTH_SECRET for each file
nano /opt/dwrg/production/app.env
nano /opt/dwrg/staging/app.env
```

In the staging file, set `DWRG_ENV=staging`, staging's own database URL, user and auth secret, and `https://staging.<domain>` for `BETTER_AUTH_URL` and `WEB_ORIGIN`. Keep the same `DOMAIN` and `ACME_EMAIL` in both files.

Save both files in the owners' password manager as well. They're the only thing on the droplet that git can't rebuild.

### 7. Database certificate

```bash
nano /opt/dwrg/db-ca.crt     # paste the CA certificate downloaded in step 1
chmod 644 /opt/dwrg/db-ca.crt
```

The API checks the database server against this certificate (`sslmode=verify-full`), so a machine pretending to be the database can't intercept connections.

### 8. First deploy

Staging first, then production with the same commit (production only accepts commits staging has run):

```bash
/opt/dwrg/staging/src/infra/scripts/deploy.sh staging main
/opt/dwrg/production/src/infra/scripts/deploy.sh production main
```

The first run takes a few minutes: it downloads the Node and Caddy images and installs dependencies. Later deploys reuse all of that. Staging's address works once production's Caddy is running.

Check from your own computer:

```bash
curl -sS https://app.<domain>/health
curl -sS https://staging.<domain>/health
```

Load demo data into staging, the practice copy (owner decision: no real customer data yet):

```bash
/opt/dwrg/staging/src/infra/scripts/dc.sh staging run --rm -e NODE_ENV=staging \
  --workdir /app/packages/db migrate node --import tsx src/seed/cli.ts
```

`dc.sh` refuses this command for production, and the seed itself refuses a database that holds anything other than demo data.

### 9. Timers, backups and alerts

```bash
sudo cp /opt/dwrg/production/src/infra/systemd/dwrg-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dwrg-restart-unhealthy.timer
```

- `dwrg-restart-unhealthy.timer` restarts a container whose healthcheck keeps failing. Docker only restarts containers that exit, and a hung API doesn't exit.
- The backup timer is enabled once the backup settings are in place: follow [backup-restore.md](backup-restore.md#setup).
- Then set up the alerts in [monitoring.md](monitoring.md#setup).

## Deploying a new version

The routine path, after the change is merged to `main` and CI is green:

```bash
/opt/dwrg/staging/src/infra/scripts/deploy.sh staging main
# try it on https://staging.<domain>; demo it to the office
/opt/dwrg/production/src/infra/scripts/deploy.sh production <commit>   # the commit staging printed
```

Use the commit id, not `main`, for production: `main` may have moved on since staging took it.

What `deploy.sh` does, in order:

1. Fetches from GitHub and resolves the commit.
2. Builds the API image `dwrg-api:<commit>` and the web files from a clean copy of that commit (`git archive`, so nothing uncommitted on the droplet ends up in a build). Production reuses what staging built, so promoting a commit takes seconds. Build output goes to `/opt/dwrg/<env>/build.log`.
3. Checks out the commit in `/opt/dwrg/<env>/src`, which holds the compose files and the Caddyfile.
4. Production only: validates the Caddyfile.
5. Runs migrations with the new image. The old version keeps serving meanwhile.
6. Points `dwrg-api:<env>` at the new image and recreates `api` and `worker`, then waits until they are healthy. **If they don't become healthy, it switches back to the previous version by itself** and prints their last log lines.
7. Switches the web files (an atomic symlink change), reloads Caddy without dropping connections, records the deploy in `/opt/dwrg/<env>/deploys.log`, and deletes builds older than the last five deploys.

Users don't see errors during the switch. While the API container restarts (a few seconds), Caddy holds incoming requests and retries for up to 30 seconds. Open WebSockets drop and the app reconnects them. Pages already open keep their loaded code until the next reload, and the service worker picks up the new version.

Notes:

- `deploy.sh` runs from the live checkout. A change to `deploy.sh` itself takes effect from the following deploy.
- Only one deploy runs at a time (there is a lock), and the droplet's checkouts must not have local edits. Every change goes through git.
- **Emergency fix straight to production:** add `--skip-staging-check`, then deploy the same commit to staging afterwards.
- **Monthly base-image refresh:** rebuild the live commit on the latest patched Node image. Run `DWRG_BUILD_ARGS=--pull /opt/dwrg/staging/src/infra/scripts/deploy.sh staging <live commit> --rebuild`, check staging, then deploy that commit to production. Production uses the rebuilt image.

## Database migrations

Migrations are SQL files in `packages/db/drizzle`, generated with `pnpm db:generate` and committed. `deploy.sh` applies them before switching versions. All pending migrations run in one transaction, so a failing migration changes nothing and the deploy stops with the old version still serving.

**Rule: every migration must work with the version before it.** Rollbacks never undo migrations, and the old version keeps serving while they run. So:

- Add columns as nullable or with a default. Add tables freely.
- Renaming or dropping a column takes two releases. First ship code that no longer uses it, then drop it in a later release.
- Big data rewrites belong in a worker job, not in a migration, so they don't hold locks during a deploy.
- Before merging a risky migration, try it on a copy of production data: restore last night's backup into the throwaway database ([backup-restore.md](backup-restore.md#monthly-restore-drill)) and run `migrate` against it.

By hand:

```bash
/opt/dwrg/production/src/infra/scripts/dc.sh production run --rm migrate    # applies pending migrations with the live image
```

Which migrations have run (read-only):

```bash
/opt/dwrg/production/src/infra/scripts/restore-db.sh --live-report | tail -n 5
```

## Rolling back

Back to the commit deployed before the current one:

```bash
/opt/dwrg/production/src/infra/scripts/deploy.sh production --rollback
```

Or to any earlier commit, picked from `/opt/dwrg/production/deploys.log` (staging ran it at the time, so the staging check passes):

```bash
/opt/dwrg/production/src/infra/scripts/deploy.sh production <commit>
```

A rollback is an ordinary deploy of an older commit. The image and web files of the last five deploys are kept, so it builds nothing and takes about ten seconds. What it doesn't undo:

- **Migrations.** The database keeps its newer shape, which the old code handles because of the rule above.
- **Data** written by the newer version. If that data is wrong, fix it through the app so the audit log records it, or follow [backup-restore.md](backup-restore.md) for a restore.

`--rollback` steps back one deploy at a time from the latest entry, so two rollbacks in a row flip between the same two versions. To go further back, name the commit.

## When a deploy fails

`deploy.sh` stops at the first error and says where it got to. Nothing is half-switched: before step 6 the old version never stopped, and in step 6 it switches back by itself.

| Message | Meaning | What to do |
|---|---|---|
| `another deploy is running` | Another `deploy.sh` holds the lock | Wait for it. If none is running (`pgrep -fa deploy.sh`), run it again |
| `... has local changes` | Someone edited files on the droplet | `git -C /opt/dwrg/<env>/src diff`. Put the change in git, then `git -C /opt/dwrg/<env>/src checkout -- .` |
| `never ran on staging` | Production only takes commits staging has run | Deploy it to staging first, or `--skip-staging-check` for an emergency |
| `the API build failed` / `the web build failed` | Compile, type or install error | Read the tail it prints (full log in `/opt/dwrg/<env>/build.log`). Usually CI would have caught it: fix in git |
| `infra/Caddyfile ... is invalid` | The new Caddyfile doesn't parse | Production is untouched. Fix the Caddyfile in git |
| Error during `running migrations` | A migration failed and was rolled back | The old version still serves. Fix the migration in git. Never edit the database by hand to make a migration pass |
| `new version unhealthy: switching back` | The new API or worker never answered its healthcheck | It is back on the previous version. Read the printed logs (often a missing setting in `app.env` or a crash on startup) |
| `ROLLBACK FAILED` | Neither version starts | Usually the database or the settings, not the code. Follow "Production is down" in [monitoring.md](monitoring.md#production-is-down) |
| `warning: ... did not answer through Caddy` | The containers are healthy, but the public address didn't answer from the droplet | DNS, the certificate, or Caddy. `dc.sh production logs --since 10m caddy` |

## Changing settings

Edit the environment's `app.env`, then recreate its containers so they read it:

```bash
nano /opt/dwrg/production/app.env
/opt/dwrg/production/src/infra/scripts/dc.sh production up -d
```

`up -d` recreates only the containers whose settings changed. To rotate a secret, put the new value in, run the command above, and revoke the old value at the provider. A new `BETTER_AUTH_SECRET` signs everyone out. Update the copy in the password manager.

## Changing the Caddyfile

Edit [infra/Caddyfile](../../infra/Caddyfile) in git like any other change. Caddy runs only in the production project, so a Caddyfile change takes effect when the commit reaches production: `deploy.sh` validates it and reloads Caddy without dropping connections. To apply an emergency edit by hand:

```bash
cd /opt/dwrg/production/src/infra
./scripts/dc.sh production exec caddy caddy validate --config /etc/dwrg-infra/Caddyfile --adapter caddyfile
./scripts/dc.sh production exec caddy caddy reload --config /etc/dwrg-infra/Caddyfile --adapter caddyfile
```

Then commit the same edit to git; the next deploy refuses to run while the checkout has local changes.

The security headers include a Content-Security-Policy that lists every outside service the browser may load from (Stripe, Google Maps, Twilio, Sentry, Spaces). When an integration lands, try it on staging with the browser console open. A blocked request shows as a CSP error: add that exact host to the Caddyfile in the same change.

## Everyday commands

```bash
D=/opt/dwrg/production/src/infra/scripts/dc.sh

$D production ps                          # what's running, and health
$D production logs --since 1h api         # API logs (also: worker, caddy)
$D production logs -f --tail 50 api       # follow live
$D production restart api                 # restart one service
$D production exec api sh                 # a shell inside the API container
docker stats --no-stream                  # CPU and memory per container
cat /opt/dwrg/production/deploys.log      # deploy history: time, commit, who, kind
git -C /opt/dwrg/production/src log -1    # what production runs
df -h / && docker system df               # disk
$D staging stop                           # free resources by stopping staging; `up -d` brings it back
```

## Keeping the droplet up to date

- **Ubuntu security updates** install by themselves every night (unattended-upgrades), with a reboot at 03:30 when one is needed.
- **Docker** comes from Docker's own repository, which the automatic updates don't cover. Once a month, run `sudo apt update && sudo apt upgrade`. With `live-restore`, the containers keep running while Docker restarts.
- **Node base image:** refresh it monthly with `--rebuild` and `DWRG_BUILD_ARGS=--pull` (see [Deploying a new version](#deploying-a-new-version)).
- **Caddy** is pinned to `caddy:2.11-alpine` in the compose file, which pulls patch releases. Move to a new minor version with a commit, through staging.

## Rebuilding the droplet from nothing

If the droplet is lost, the database is unaffected: it lives in the managed cluster. Create a new droplet and repeat the [first-time setup](#first-time-setup), restoring both `app.env` files from the password manager. Skip the database part of step 1, but add the new droplet to the cluster's trusted sources. Then point DNS at the new IP and deploy the commits listed at the end of the old `deploys.log`, or the latest `main`, through staging. Caddy fetches new certificates by itself.

## Optional: deploy staging from GitHub Actions

When pushes to `main` should reach staging without a login, give Actions an SSH key that can only run the staging deploy. In `/home/deploy/.ssh/authorized_keys`:

```
command="/opt/dwrg/staging/src/infra/scripts/deploy.sh staging main",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-actions
```

Then a workflow job, after the CI checks pass, runs `ssh deploy@<droplet>` with that key (stored as an Actions secret). Production stays a deliberate, manual step.
