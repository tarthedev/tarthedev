# KPI Command Center

A personal sales command center for Verizon/Victra retail KPIs.

Victra's dashboard has the numbers but no export. This turns screenshots of it
into structured data, then does the analysis Victra does not: pacing,
projections, shift-aware daily targets, trends, and coaching.

**The core idea: AI reads the pixels, application code does the arithmetic.**
The vision model's only job is screenshot → JSON. Every percentage, gap, pace and
projection is computed by deterministic, unit-tested TypeScript. That makes it
both far cheaper and far more trustworthy than asking a model to do maths.

---

## What it does

**Ingest** — Drop in a batch of screenshots. They become *one* snapshot, because
KPI data is spread across several Victra screens. Images are validated by magic
bytes, EXIF-stripped, resized to the vision model's native ceiling, and
de-duplicated before anything is sent.

**Verify** — Every extracted value carries a confidence score and the screenshot
it came from. Below the threshold, implausible, conflicting between screens, or
naming a KPI you have not defined — it waits for you instead of quietly entering
the database. Corrections preserve what the model said, so extraction accuracy
stays measurable.

**Calculate** — A pure pace engine turns confirmed readings into remaining
units, required rate, current rate, projected finish, pace index and status.
When you record a schedule it paces per *shift*: "1.25 per remaining shift" is
an instruction; "1.0 per day" is trivia when two of those days are days off.

**Coach** — An AI coach reads a few hundred tokens of already-computed numbers
and writes judgement about them: biggest win, biggest problem, ranked priorities,
forecast, and one thing to fix today. It is instructed that every figure it
states must come from the data block, so it cannot invent a KPI value.

**Control cost** — Every model call is logged with tokens and estimated cost.
Routine work runs on the cheap tier; the expensive model is reached only by the
retry ladder's last rung or a button you press. A budget guardrail runs *before*
each call and degrades gracefully — cheaper model, then optional features off,
then a hard stop. There is no path to a surprise bill.

---

## Quick start

### On a VPS — one command

```bash
curl -fsSL https://raw.githubusercontent.com/tarthedev/tarthedev/claude/verizon-kpi-command-center-np4niz/scripts/bootstrap-vps.sh \
  | sudo bash -s -- kpi.yourdomain.com
```

Installs Docker if needed, clones the app, generates its secrets on the server,
brings up the stack, and puts Caddy in front with automatic TLS. Re-runnable,
and it does not touch anything already serving traffic on the box. It starts in
mock AI mode so the whole app works before you add an API key.

If the domain sits behind Cloudflare's proxy the script detects it and prints
the two ways forward, since Let's Encrypt cannot validate through an orange
cloud.

### Locally

Requires Docker, or Node 20+ with PostgreSQL 16+.

```bash
bash scripts/preflight.sh     # survey the machine; changes nothing

cp .env.example .env
openssl rand -base64 48       # → SESSION_SECRET
openssl rand -base64 24       # → POSTGRES_PASSWORD

docker compose up -d --build
```

Open <http://localhost:3020> and create your account.

**No API key yet?** Set `AI_DEV_MODE=true`. A deterministic mock provider
exercises the entire pipeline — upload, extraction, low-confidence review, the
dashboard, the coach, the cost ledger — with no network calls and no spend.

### Local development

```bash
npm install
cp .env.example .env.local     # point DATABASE_URL at a local Postgres
npx prisma migrate deploy
npm run db:seed                # fictional sample data to look at
npm run dev
```

Seeded credentials: `demo@example.com` / `demo-password-123`.

---

## Screens

| | |
|---|---|
| **Command Center** | Greeting, period, units remaining, overall score, alerts, today's target, KPI cards, the "if I sell one more" simulator, and the coach's headline. |
| **Upload** | Drag-and-drop staging with thumbnails, reorder and remove, then one button. |
| **Snapshots** | Every upload, with confidence, model, prompt version, the readings, the raw model output, and the review queue. |
| **Scorecard** | The flat scannable table: current, goal, %, remaining, required, projected, status — plus a transparent score formula. |
| **KPI detail** | Cumulative trend against an even-pace line, production per day, best and slowest day, prior periods. |
| **Goals** | Minimum / target / stretch per KPI per period, and the shift calendar. |
| **History** | Weekly or monthly attainment over time, filterable by KPI. |
| **AI Coach** | The full brief, plus an explicit deep-analysis button. |
| **Ask** | Natural-language questions over your own numbers. |
| **AI Cost** | Today, week, month, all time; by model and by feature; budget bar; recent requests. |
| **Settings** | Pacing, KPI definitions and weights, models, thresholds, budget, theme, exports. |

Mobile-first throughout, installable as a PWA, with light and dark themes.

---

## Commands

```bash
npm run dev            # development server
npm run build          # production build
npm test               # 103 tests, mostly the calculation engine
npm run typecheck      # tsc --noEmit
npm run db:migrate     # create a migration
npm run db:deploy      # apply migrations
npm run db:seed        # fictional sample data
npm run db:studio      # browse the database
```

---

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the design and why each
  decision was made.
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — VPS deployment that does not
  disturb what is already running there.
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — daily use, backups, cost
  monitoring, fixing bad extractions.

---

## Privacy

Screenshots may contain workplace-sensitive information. They are stored outside
the web root, never given a public URL, and served only to your authenticated
session. Deleting a snapshot deletes its images. The Anthropic API key is
server-side only. The whole thing runs on your own machine.
