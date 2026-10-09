# Backup and restore runbook

How the data is protected, how to set up the nightly off-site backup, how to restore in each kind of trouble, and the monthly restore drill. Setting up the droplet is in [deploy.md](deploy.md); the alerts in [monitoring.md](monitoring.md).

## What protects the data

The database is the business's record. Customers, jobs, invoices, payments, pay lines and the audit log all live in Managed PostgreSQL. Nothing on the droplet needs a backup: it is rebuilt from git with [deploy.md](deploy.md), and the two `app.env` files are kept in the owners' password manager.

| Layer | Covers | Goes back | Restore takes | Use it when |
|---|---|---|---|---|
| **DigitalOcean point-in-time restore** (built into the managed cluster) | The whole cluster, to any minute | 7 days | 15–60 min (creates a new cluster) | Something went wrong in the last week |
| **Nightly dump, off-site** (`backup-db.sh` → Backblaze B2, `<env>/daily/`) | Each database, as of about 02:30 | 35 days (bucket rule) | About 10 min plus download time | The cluster is gone, or the damage is older than a week |
| **Monthly dump, off-site** (the 1st of the month's dump, also in `<env>/monthly/`) | Same | 13 months (bucket rule) | Same | Slow damage found late |
| **Monthly restore drill** | Proves the two dumps above actually restore | | 20 min a month | Always |

The retention periods are defaults that cost a few dollars a month. The owners can change them in the bucket's lifecycle rules.

The off-site dumps are encrypted on the droplet with [age](https://age-encryption.org) before they leave it. Only the holders of the private key can read them, and that key is never on the droplet. The droplet's storage key can add backups but not delete them. So a break-in on the droplet can neither read old backups nor destroy them.

Until the switch, ServiceTitan keeps its own copy of everything imported from it. That doesn't cover work done only in the new system (the pilot crew's jobs, payments, pay lines), so the backups matter from the pilot on.

Staging holds demo data only (owner decision), so it isn't backed up. When it starts holding real imported data, add a second timer running `backup-db.sh staging`.

## Setup

Do this right after the first deploy. About 30 minutes.

### 1. The encryption key (on an owner's computer, not the droplet)

Install age (`brew install age`, `winget install FiloSottile.age`, or `apt install age`), then:

```bash
age-keygen -o dwrg-backup.key
```

It prints the public key (`age1...`). Then:

- Store the whole contents of `dwrg-backup.key` in the owners' password manager, and print a copy for the office safe. **Without this key the off-site backups can't be read.**
- Optionally, the builder makes a second key the same way. Both public keys go into the settings, separated by a comma, and either private key can restore.
- Delete `dwrg-backup.key` from the computer's disk once it's stored.

### 2. The bucket (Backblaze B2)

1. Create a B2 account, then a bucket. Bucket names are global, so pick something like `dwrg-db-backups-<random>`.
   - **Files:** Private.
   - **Default encryption:** enabled.
   - **Object Lock:** optional, extra ransomware protection: with a 35-day default retention, not even the account owner can delete a fresh backup early. Object Lock can only be switched on when the bucket is created.
2. **Lifecycle rules** (*Lifecycle Settings › custom*), so old backups expire without the droplet needing delete rights:

   | File name prefix | Days until hidden | Days until deleted after hiding |
   |---|---|---|
   | `production/daily/` | 35 | 1 |
   | `production/monthly/` | 400 | 1 |

   If `BACKUP_DEST` includes a folder (e.g. `offsite:bucket/dwrg`), put it in front of each prefix (`dwrg/production/daily/`).
3. **An application key limited to this bucket, without delete rights.** The web console only offers "read and write", which includes delete, so use the [b2 command-line tool](https://www.backblaze.com/docs/cloud-storage-command-line-tools) (`pipx install b2`):

   ```bash
   b2 account authorize                         # with the account's master key, on your computer
   b2 key create --bucket <bucket> dwrg-droplet listBuckets,listFiles,readFiles,writeFiles
   ```

   (Older versions of the tool spell these `b2 authorize-account` and `b2 create-key`.) Note the key ID and the key: they go into the settings next.

Another S3-compatible store works the same way. [infra/backup.env.example](../../infra/backup.env.example) shows the settings for one.

### 3. On the droplet

```bash
cp /opt/dwrg/production/src/infra/backup.env.example /opt/dwrg/backup.env
chmod 600 /opt/dwrg/backup.env
nano /opt/dwrg/backup.env        # B2 key ID and key, bucket, age public key(s), heartbeat URL
```

For `BACKUP_HEARTBEAT_URL`, create a heartbeat ("cron job") check in the uptime service: expected daily, with a 3-hour grace period ([monitoring.md](monitoring.md#setup)). The backup pings it after every good run and pings `<url>/fail` when a run fails.

Run one backup by hand and watch it:

```bash
/opt/dwrg/production/src/infra/scripts/backup-db.sh production
```

It prints the database it dumped, the number of tables, where the file landed, and its size. Then turn on the nightly timer (02:30 business time, with up to 10 minutes of random delay; a night missed while the droplet was off runs at the next boot):

```bash
sudo systemctl enable --now dwrg-backup.timer
systemctl list-timers 'dwrg-*'
```

Finally, run the [restore drill](#monthly-restore-drill) once now. A backup that has never been restored isn't a backup yet.

### What a backup run does

[infra/scripts/backup-db.sh](../../infra/scripts/backup-db.sh):

1. Runs `pg_dump` (custom format, compressed) from the official `postgres:17` image, so the droplet needs no Postgres client. The connection string goes in through the environment, never the command line, and the server's certificate is checked against `/opt/dwrg/db-ca.crt`.
2. Checks that `pg_restore` can read the dump and that it holds table data.
3. Encrypts it to the age public key(s) and deletes the unencrypted copy at once.
4. Uploads it to `<BACKUP_DEST>/production/daily/<year>/<month>/dwrg-production-<UTC time>.dump.age`, and on the 1st of the month also to `.../production/monthly/<year>/`. Then it compares the uploaded size with the local one.
5. Pings the heartbeat. Any failure exits non-zero, pings `/fail`, and shows up in `journalctl -u dwrg-backup.service`.

### Files in Spaces (from month 4)

When photos and PDFs start going to Spaces, copy them off-site nightly too. Add a second remote to `backup.env`:

```
RCLONE_CONFIG_SPACES_TYPE=s3
RCLONE_CONFIG_SPACES_PROVIDER=DigitalOcean
RCLONE_CONFIG_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
RCLONE_CONFIG_SPACES_ACCESS_KEY_ID=<read-only Spaces key>
RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY=<secret>
```

Then add a step to the backup that runs `rclone copy spaces:dwrg-production offsite:<files bucket>/production`. Use `copy`, not `sync`: a file deleted in Spaces stays in the backup. Add it to the drill. This is a to-do, not built yet.

## Restoring

First, **stop and write down the time** the problem started, as closely as you can. The restore point depends on it. Then pick the case below. Every restore loses whatever was written after the restore point, so each case ends with putting that back.

### A. Wrong or lost data, in the last 7 days

Examples: a bad import, a bug that rewrote rows, someone deleted a customer.

Usually only some rows are wrong, so **don't roll the whole database back** over everyone's later work. Restore a copy next to it and take back only what's needed.

1. DigitalOcean console › the database cluster › **Backups › Restore from a point in time** (it may be labelled "Fork"). Pick a time just before the problem. It creates a new cluster. It's billed by the hour, so delete it when done.
2. Add the droplet to the new cluster's trusted sources. Connect to it read-only with its `doadmin` connection string:

   ```bash
   docker run --rm -it -e PGOPTIONS="-c default_transaction_read_only=on" postgres:17 psql "<fork connection string>"
   ```

3. Compare the affected rows with production and decide what to put back.
4. Put it back **through the app** wherever possible, so the audit log records who, when, before, after and a reason ("restored from the point-in-time copy of 10:42"). Where a script is unavoidable, have it reviewed, and make it write the same audit entries.
   - Money and pay changes always go into the audit log (CLAUDE.md rule 4).
   - Pay lines are append-only: correct them with new lines, never by editing (rule 3).
5. Delete the forked cluster.

### B. The whole database is lost or broken

Examples: the cluster is deleted, or corruption everywhere.

1. **Stop writes** so nothing lands in a broken database:

   ```bash
   /opt/dwrg/production/src/infra/scripts/dc.sh production stop api worker
   ```

   The app shows errors until the end of step 4. Tell the office to work on paper (or in ServiceTitan, before the switch).
2. **Pick the source.** A point-in-time restore loses the least (minutes) if the cluster still exists. The latest nightly dump loses up to a day.
3. **Restore:**
   - *Point in time:* restore to a new cluster just before the failure (case A, step 1). In the new cluster, check the users from [deploy.md](deploy.md#1-digitalocean-resources) step 1 exist and own their databases; set them up the same way if not. Download its CA certificate into `/opt/dwrg/db-ca.crt`.
   - *Nightly dump:* create a new cluster if the old one is gone (users, databases, ownership and trusted sources as in [deploy.md](deploy.md#1-digitalocean-resources)). Its `dwrg_production` database must be empty. Copy the age private key into memory only, and restore into it:

     ```bash
     cat > /dev/shm/dwrg-backup.key     # paste the private key, then Ctrl-D
     chmod 600 /dev/shm/dwrg-backup.key
      export RESTORE_TARGET_URL='<new dwrg_production connection string>'   # leading space: kept out of shell history
     AGE_IDENTITY=/dev/shm/dwrg-backup.key /opt/dwrg/production/src/infra/scripts/restore-db.sh latest
     shred -u /dev/shm/dwrg-backup.key; unset RESTORE_TARGET_URL
     ```

     `restore-db.sh` refuses a database that isn't empty, and refuses the database production currently points at. It restores in one transaction, then prints row counts per table, the newest audit-log entry and the number of migrations.
4. **Point production at it:** put the new connection string in `/opt/dwrg/production/app.env` as `DATABASE_URL`, then:

   ```bash
   /opt/dwrg/production/src/infra/scripts/dc.sh production run --rm migrate
   /opt/dwrg/production/src/infra/scripts/dc.sh production up -d
   ```

   Update the copy of `app.env` in the password manager.
5. **Put back the gap** between the restore point and the failure:
   - **Stripe payments:** in the Stripe Dashboard, resend the webhook events for the gap (*Developers › Webhooks › the endpoint › events*). Webhooks are idempotent on the event ID (`webhook_events`), so resending is safe even for events that made it in.
   - **QuickBooks:** compare what was posted in the gap with the restored invoices before the sync runs again, so nothing posts twice.
   - **Texts, calls, timesheets, jobs:** Twilio's logs and the office's notes. Re-enter through the app with a reason that names the restore.
6. Run a backup by hand (`backup-db.sh production`) to prove backups work against the new database.

### C. Data from weeks or months ago

Restore that dump into the throwaway database on the droplet, look, and copy out what's needed (case A, step 4):

```bash
AGE_IDENTITY=/dev/shm/dwrg-backup.key /opt/dwrg/production/src/infra/scripts/restore-db.sh \
  offsite:<bucket>/production/monthly/2026/dwrg-production-2026-11-01T073012Z.dump.age --keep
docker exec -it dwrg-restore-drill psql -U postgres -d dwrg_restore
docker rm -f -v dwrg-restore-drill  # when done; -v also deletes its data
```

To see which backups exist:

```bash
bash -c 'source /opt/dwrg/production/src/infra/scripts/lib.sh
  export_rclone_settings /opt/dwrg/backup.env
  rclone -q lsf -R --files-only "$(env_get /opt/dwrg/backup.env BACKUP_DEST)/production" | tail -n 20'
```

### D. The droplet is lost

No data is lost: the database lives in the managed cluster. Rebuild with [deploy.md](deploy.md#rebuilding-the-droplet-from-nothing), then set up the backup again from [Setup](#setup) step 3, restoring `backup.env` from the password manager.

### E. The age private key is lost

All copies lost (password manager, paper, second key) means the off-site dumps can't be read. Generate a new key pair at once ([Setup](#setup) step 1), put the new public key in `backup.env`, run a backup by hand, and do a drill with the new key. DigitalOcean's own backups are unaffected and still cover the last 7 days.

## Monthly restore drill

On the first Monday of each month, by whoever looks after the system. About 20 minutes on the droplet, and it touches nothing live. Record each drill in the [drill log](#drill-log).

- [ ] **Backups arrived.** The backup heartbeat check has been green all month, and `journalctl -u dwrg-backup.service --since -2d` shows last night's `uploaded ...` line.
- [ ] **Key into memory only.** Run `cat > /dev/shm/dwrg-backup.key`, paste the key from the password manager, press Ctrl-D, then `chmod 600 /dev/shm/dwrg-backup.key`.
- [ ] **Restore last night's backup** into the throwaway database, and note how long it takes:

  ```bash
  time AGE_IDENTITY=/dev/shm/dwrg-backup.key /opt/dwrg/production/src/infra/scripts/restore-db.sh latest --keep
  ```

- [ ] **Compare with live:**

  ```bash
  /opt/dwrg/production/src/infra/scripts/restore-db.sh --live-report
  ```

  Every table with rows live also has rows in the copy, and the counts are close: live is a little higher from today's work. Migrations are equal. The copy's newest audit-log entry is within about a day of the backup time.
- [ ] **Spot-check money** against the live app's numbers for the same day:

  ```bash
  docker exec dwrg-restore-drill psql -U postgres -d dwrg_restore -c \
    "SELECT count(*) AS invoices, sum(total_cents) AS total_cents, sum(balance_cents) AS open_cents FROM invoices"
  ```

- [ ] **Migrations run forward on a copy of production data** (build plan, "Recoverable"). If a release with new migrations is waiting, deploy it to staging (which builds its image), then run its migrations against the copy. `restore-db.sh --keep` printed the exact command, with the `DATABASE_URL` to use.
- [ ] **Clean up:** `docker rm -f -v dwrg-restore-drill && shred -u /dev/shm/dwrg-backup.key`.
- [ ] **Quarterly (January, April, July, October):** also do case A's point-in-time restore to an hour ago. Connect, count customers and invoices, then delete the forked cluster.
- [ ] **Write a line** in the drill log below and commit it.

If any step fails, that's the most important finding of the month. Fix it before anything else, and alert the owners if backups have silently not been restorable.

## Drill log

| Date | Backup used | Restore time | Counts match | Notes | By |
|---|---|---|---|---|---|
| | | | | | |
