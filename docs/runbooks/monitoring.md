# Monitoring runbook

What watches the platform, how to set the watchers up, and what to do when an alert fires. Hosting is in [deploy.md](deploy.md); backups in [backup-restore.md](backup-restore.md).

## What watches what

| Watcher | Watches | Tells you |
|---|---|---|
| **Uptime service** (outside DigitalOcean) | `https://app.<domain>/health` every minute or so; the certificate's expiry; the nightly backup's heartbeat | Production is down for anyone on the internet; the certificate isn't renewing; a backup didn't run or failed |
| **Sentry** | Errors and slow requests in the API, the worker and the browser app, tagged with the commit (`APP_VERSION`) and the environment (`DWRG_ENV`) | Something broke, in which version, for whom |
| **DigitalOcean Monitoring** | Droplet CPU, memory and disk; the database cluster's CPU, memory, disk and connections | The machine or the database is running out of room |
| **Docker healthchecks** | `api`: `GET /health` every 15 s. `worker`: its heartbeat file. `caddy`: its admin endpoint | Feeds `deploy.sh` (switches back a version that never gets healthy) and the restarter below |
| **`dwrg-restart-unhealthy.timer`** | Once a minute, restarts a container that stays unhealthy | Each restart goes to the journal: `journalctl -t dwrg-restart-unhealthy` |

**The `/health` contract.** The API answers `GET /health` with 200 and a tiny JSON body when it is up and can run `SELECT 1` on Postgres within about 2 seconds, and with 503 otherwise. It needs no login and shows nothing secret. Caddy passes `/health` through unchanged, so the same URL serves Docker and the uptime service.

## Setup

About an hour, after the first deploy. Alerts go to the owner and the builder. Use push or text for the ones marked **urgent**, and email for the rest.

### Uptime service

Use a service that offers HTTP checks, certificate checks and heartbeat checks in one place, such as Better Stack Uptime (free tier). The alternative is UptimeRobot for HTTP checks plus healthchecks.io for heartbeats. Install its phone app for push alerts.

| Check | Type | Target | Interval | Alert |
|---|---|---|---|---|
| Production API | HTTP, expect status 200 | `https://app.<domain>/health` | 1–3 min; alert after 2 failures in a row | **Urgent** |
| Production app shell | HTTP, expect 200 | `https://app.<domain>/` | 5 min | Email |
| Staging | HTTP, expect 200 | `https://staging.<domain>/health` | 5 min | Email |
| Certificate | TLS expiry | `app.<domain>` and `staging.<domain>` | Daily; alert under 14 days left | Email |
| Nightly backup | Heartbeat | Its ping URL goes into `BACKUP_HEARTBEAT_URL` in `/opt/dwrg/backup.env` | Every 24 h, 3 h grace | **Urgent** |

Caddy renews certificates 30 days before they expire, so a certificate under 14 days means renewals have been failing for two weeks.

### Sentry

1. Create a Sentry organization (free plan) and two projects: `dwrg-server` (Node), shared by the API and the worker, and `dwrg-web` (React).
2. Put `dwrg-server`'s DSN in both `app.env` files as `SENTRY_DSN`. The environment comes from `DWRG_ENV`, so staging and production share a project and stay apart in filters.
3. `dwrg-web`'s DSN isn't secret: browser DSNs are public by design. It can live in the web app's code in git, or come from the API. One web build serves both environments.
4. Alert rules, filtered to `environment:production`:
   - a new issue is created: email;
   - an issue happens more than 20 times in 5 minutes: **urgent**;
   - a resolved issue comes back (regression): email.
5. For staging, a weekly email digest is enough.

**Not wired in the code yet.** The API, worker and web app must each start Sentry with:

- `environment: DWRG_ENV` (the web app: `production` on `app.`, `staging` on `staging.`);
- `release: APP_VERSION` (the web app: `VITE_APP_VERSION`);
- a `service` tag of `api` or `worker` on the server.

The worker must also report every pg-boss job that fails for good. Performance tracing at a low sample rate makes slow requests visible (build plan, "Observable"). The Caddyfile's Content-Security-Policy already allows the browser to send to `*.sentry.io`.

### DigitalOcean Monitoring

Under *Monitoring › Create alert policy*, for the droplet (the metrics agent was installed with the droplet):

| Metric | Condition | Alert |
|---|---|---|
| CPU | above 80% for 15 min | Email |
| Memory | above 85% for 10 min | Email |
| Disk utilization | above 80% for 5 min | **Urgent** |

For the database cluster (on its *Insights* page, or *Monitoring › Create alert policy* with the cluster as the resource): CPU above 80% for 10 min, memory above 85%, disk above 75%. All by email.

Also subscribe to [status.digitalocean.com](https://status.digitalocean.com) for the region in use.

### Alerts the office will rely on (add as features land)

"Anything the office relies on has an alert" (build plan, "Observable"). As each feature is built, add its alert in the same change:

| Feature | Alert |
|---|---|
| Stripe payments | Stripe emails when webhook deliveries keep failing: set the alert email in the Stripe Dashboard. Failed webhook handling also reaches Sentry |
| Twilio texts and calls | Twilio Console › Monitor › Alerts: email on errors (failed deliveries, webhook errors) |
| QuickBooks sync | Every failed posting reaches Sentry; a disconnected QuickBooks connection becomes an urgent Sentry issue |
| Scheduled jobs (Sunday week lock, Monday payroll run, nightly restock lists) | The worker pings a heartbeat check after each run, the same way the backup does: a missed Monday run alerts by Monday morning |

## When an alert fires

Start from the alert, and use the everyday commands in [deploy.md](deploy.md#everyday-commands). `D` below is `/opt/dwrg/production/src/infra/scripts/dc.sh`. After any outage, add a line to the [incident log](#incident-log).

### Production is down

The uptime check on `/health` is failing.

1. **Confirm** from your phone: open `https://app.<domain>/health`. Check [status.digitalocean.com](https://status.digitalocean.com) for the region.
2. **Tell the office** if it lasts more than a few minutes: until it's fixed, work goes on paper (and in ServiceTitan, until the switch).
3. **Log in** (`ssh deploy@<droplet>`). If the droplet doesn't answer, open its page in the DigitalOcean console: check the graphs, use the Recovery Console, or power-cycle it. If it's gone, rebuild with [deploy.md](deploy.md#rebuilding-the-droplet-from-nothing).
4. **Look:** `$D production ps`.

| What `ps` shows | Next |
|---|---|
| `api` restarting, or unhealthy | `$D production logs --since 15m api`. **Deployed recently?** Roll back first and investigate after: `/opt/dwrg/production/src/infra/scripts/deploy.sh production --rollback` |
| API logs show connection refused, timeouts, `too many connections` or a certificate error | It's the database. Check the cluster's page: is it online, is the droplet still in its trusted sources, and how close are its connections to the limit? Free connections with `$D staging stop`. A certificate error means `/opt/dwrg/db-ca.crt` doesn't match the cluster |
| API logs show a missing or invalid setting | Fix `/opt/dwrg/production/app.env`, then `$D production up -d` |
| `caddy` missing or unhealthy | `$D production logs --since 15m caddy`, then `$D production up -d caddy` |
| Everything healthy, but the site is down from outside | DNS (`dig +short app.<domain>` must be the droplet's IP), the Cloud Firewall (ports 80 and 443), or the certificate: `$D production logs caddy \| grep -iE 'acme\|certificate\|error'` |

5. **Still stuck:** `$D production up -d` recreates anything missing. `$D production restart` restarts everything (a few seconds of errors).

### Staging is down

Not urgent. Usually the latest staging deploy was bad: deploy the previous commit, or fix forward. Production's Caddy serves staging too, so if both are down, start with "Production is down".

### Certificate expiring

Caddy should have renewed it already. Check, in order:

1. `$D production logs --since 24h caddy | grep -iE 'acme|certificate|error'` shows the reason.
2. DNS still points `app` and `staging` at the droplet.
3. Port 80 is open in the Cloud Firewall: Let's Encrypt's check uses it.
4. A CAA record, if there is one, allows `letsencrypt.org`.

Then run `$D production restart caddy` and watch the logs for `certificate obtained successfully`.

### Backup missed or failed

DigitalOcean's own 7-day point-in-time restore still covers the data, so fix it today, without panic.

```bash
journalctl -u dwrg-backup.service -n 50 --no-pager
/opt/dwrg/production/src/infra/scripts/backup-db.sh production     # run by hand to see the error
```

| Common cause | Fix |
|---|---|
| B2 key revoked or expired, wrong bucket | Make a new key ([backup-restore.md](backup-restore.md#2-the-bucket-backblaze-b2)) and update `backup.env` |
| Database unreachable | As in "Production is down" (database row) |
| `BACKUP_AGE_RECIPIENT` wrong | It must be the public key(s) (`age1...`), never the private key |
| Disk full | See "Disk filling up" |
| Timer not running | `systemctl list-timers 'dwrg-*'`; `sudo systemctl enable --now dwrg-backup.timer` |

When it works again, check that the heartbeat turned green.

### Error spike in Sentry

1. **Which release?** If the errors started with a deploy, roll back (`deploy.sh production --rollback`), then investigate.
2. **Money or pay involved** (payments, invoices, pay lines, QuickBooks postings)? Stop before retrying anything:
   - Check `audit_log` and the Stripe Dashboard for what actually happened.
   - Never correct money or pay by editing the database. Corrections go through the app, so the audit log records them, and pay corrections are new lines (CLAUDE.md rules 3 and 4).
3. **Otherwise:** fix forward through staging. Resolve the issue in Sentry with the fixing release.

### High CPU on the droplet

```bash
docker stats --no-stream
```

- A deploy's build uses CPU for a couple of minutes: expected.
- Staging busy: `$D staging stop` (staging is capped at one CPU per container anyway).
- The API or worker busy: check its logs and Sentry for a runaway loop or a slow query.
- If it's simply growth, resize the droplet in DigitalOcean (*Resize › CPU and RAM only*, so you can size back down). It takes a few minutes of downtime: do it after hours.

### Memory high, or a container killed

```bash
docker stats --no-stream
journalctl -k --since -1h | grep -iE 'out of memory|killed process'
docker inspect -f '{{.Name}} OOMKilled={{.State.OOMKilled}}' $(docker ps -aq)
```

Staging's containers are capped at 1 GB each, so a staging leak can't take production down. Restart what was killed (`$D <env> up -d`). If production keeps growing, look for a leak (Sentry, logs), and resize as a stopgap.

### Disk filling up

```bash
df -h /
docker system df
sudo du -sh /opt/dwrg/* /var/lib/docker 2>/dev/null
```

| Usual culprit | Fix |
|---|---|
| Docker build cache | `docker builder prune -f` (only slows the next build) |
| Old images | `docker image prune -f`. `deploy.sh` already keeps only the last five deploys' images |
| `/opt/dwrg/backups` | Should be empty between runs. Delete leftovers of a crashed run |
| System journal | `sudo journalctl --vacuum-size=500M` |

Container logs can't fill the disk: each container keeps at most 5 × 20 MB.

### Database CPU, memory or disk high

Open the cluster's *Insights* page: slow queries and connection counts. Sentry's performance data shows which endpoint runs the slow query. Fix it with an index or a better query, shipped as a migration through staging.

The cluster's disk can be grown in place (*Resize*). Its CPU and memory resize takes a short failover.

### A container was restarted for being unhealthy

```bash
journalctl -t dwrg-restart-unhealthy --since -1d
$D production logs --since 30m api       # what happened before the restart
```

Once can be a blip. If it repeats, or the uptime check also fired, treat it as "Production is down".

## Logs

- **Containers:** `$D production logs [--since 1h] [-f] api|worker|caddy`. Docker keeps 5 × 20 MB per container, about days to weeks, depending on traffic.
- **Caddy access log:** JSON, one line per request, in Caddy's container log. Query strings are replaced with `?redacted` (one-time portal links carry tokens), and cookies and authorization headers are never logged.
- **Deploys:** `/opt/dwrg/<env>/deploys.log` (history) and `/opt/dwrg/<env>/build.log` (the last build).
- **Backups and restarts:** `journalctl -u dwrg-backup.service`, `journalctl -t dwrg-restart-unhealthy`.

If logs need to be kept longer or searched across days, ship them to a log service (Better Stack Logs has a free tier) with Docker's logging driver. Not set up yet.

## Incident log

One line per outage or data problem: what happened, how long it lasted, the cause, and what changed so it doesn't happen again.

| Date | Duration | What happened | Cause | Follow-up |
|---|---|---|---|---|
| | | | | |
