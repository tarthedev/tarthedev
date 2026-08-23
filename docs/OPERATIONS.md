# Operations

Day-to-day running of the app once it is deployed.

## Daily use

The workflow the whole system is built around:

1. Finish your shift.
2. Open the Victra KPI dashboard and screenshot every screen with numbers on it.
3. Open the app on your phone → **Upload**.
4. Select all the screenshots. Reorder or remove any before sending.
5. **Process KPI snapshot.**
6. If anything is uncertain or two screens disagree, confirm it — one tap each.
7. The Command Center updates: where you are, what is left, what tomorrow needs.

Add it to your iPhone home screen (Share → Add to Home Screen) and it opens
standalone, without browser chrome.

## Health

```bash
curl -fsS https://kpi.example.com/api/health
# {"status":"ok","database":"up","latencyMs":3}
```

`503` means the app is running but cannot reach Postgres.

```bash
docker compose ps
docker compose logs -f app
docker compose logs --tail=100 db
```

Application logs are JSON lines on stdout. Anything notable is also written to
the `event_logs` table, with secret-shaped keys redacted.

## Backups

```bash
bash scripts/backup.sh                       # database + screenshots
BACKUP_DIR=/mnt/vol bash scripts/backup.sh   # somewhere else
RETENTION_DAYS=30 bash scripts/backup.sh     # keep longer
```

Produces `kpi-db-<stamp>.dump` (custom format, compressed) and
`kpi-storage-<stamp>.tar.gz`, pruning anything older than the retention window.
The script fails loudly on an empty dump rather than leaving a file that looks
like a backup.

Restore:

```bash
bash scripts/restore.sh backups/kpi-db-<stamp>.dump
bash scripts/restore.sh backups/kpi-db-<stamp>.dump backups/kpi-storage-<stamp>.tar.gz
```

Destructive, so it requires typing `RESTORE`. It stops the app, restores,
re-applies any newer migrations, and restarts.

Copy backups off the server — a backup on the same disk survives nothing that
matters.

## Watching AI cost

**AI Cost** in the sidebar shows today, this week, this month and all time, plus
a breakdown by model and by feature, the budget bar, and the last 30 requests
with token counts and latency.

Expected order of magnitude with the default routing:

| Action | Rough cost |
|---|---|
| Snapshot, 5 screenshots | ~$0.01 |
| Coaching brief | ~$0.005, then free until your numbers change |
| One question | ~$0.002 |
| Deep analysis | ~$0.05 |

Daily use lands well inside a $10 monthly budget. If spend looks wrong:

1. Check **Cost by feature** — one feature dominating is the signal.
2. Check **Cost by model** — routine work should not be on the expensive model.
3. Check the request list for repeated failures; a retry ladder that keeps
   firing means extraction is struggling on those screenshots.

To cut cost further: raise `AI_CONFIDENCE_THRESHOLD` (fewer escalations),
upload fewer screenshots per snapshot, or point `AI_EXTRACTION_MODEL` at a
cheaper model.

## When extraction gets a value wrong

Correct it. **Snapshots → the snapshot → the reading → edit → Accept.** The
model's original reading is preserved in `aiValue`; your value becomes the
effective one and the row is marked corrected.

This matters beyond the one number: exporting the observations CSV and comparing
`aiValue` to `correctedValue` tells you how well extraction is actually working,
per KPI. If one KPI is consistently misread, add the exact on-screen label as an
alias in **Settings → KPI definitions** — aliases go into the extraction prompt.

## When two screenshots disagree

The snapshot page shows both readings side by side with their source images and
confidence. Pick one. The system will not choose for you, because the usual
cause is that the screenshots were taken at different moments — and picking
silently would corrupt the history.

## When a new KPI appears

An unfamiliar label becomes an `UNMAPPED` reading with a **New KPI detected**
badge. Either create it (the label becomes the display name and an alias) or
assign the reading to an existing KPI. Nothing is stored against a KPI you have
not approved.

## Session and log housekeeping

Expired sessions and old logs accumulate slowly. Monthly, if you like:

```sql
DELETE FROM sessions WHERE "expiresAt" < now();
DELETE FROM event_logs WHERE "createdAt" < now() - interval '90 days';
```

Never delete from `snapshots`, `metric_observations` or `ai_requests` — history
and the cost ledger are the point.

## Rotating the API key

```bash
nano .env                      # replace ANTHROPIC_API_KEY
docker compose up -d app       # picks up the new value
```

No migration, no restart of the database.

## Rotating the session secret

```bash
openssl rand -base64 48        # → SESSION_SECRET
docker compose up -d app
```

Every session is invalidated; sign in again. Do this if you suspect the secret
leaked.

## Disk usage

Screenshots dominate. Each is normalised to at most 1568px on the long edge —
roughly 200–500 KB.

```bash
docker system df -v | grep app-storage
du -sh storage/            # bare-metal
```

At ten screenshots a day that is roughly 1.5 GB a year. When it matters, delete
old snapshots from the UI (which removes their images too) or switch
`STORAGE_DRIVER=s3`.

## Restoring onto a fresh server

1. Deploy normally (`docs/DEPLOYMENT.md`), stopping before first sign-in.
2. `bash scripts/restore.sh <db.dump> <storage.tar.gz>`
3. Sign in with your existing credentials — they came back with the dump.
