# Architecture

## The one decision everything else follows from

**AI reads pixels. Application code does arithmetic.**

The vision model's only job is turning a screenshot into structured JSON. Every
percentage, gap, pace, projection, daily target and score is computed by
deterministic TypeScript, in `src/lib/kpi/`, covered by tests.

This is not only about cost, though it is much cheaper. It is about
trustworthiness: `computePace()` returns the same answer every time, can be
unit-tested against worked examples, and cannot hallucinate. A model asked to
divide 5 by 3 will usually be right, and "usually" is the wrong standard for the
number that tells you what to sell today.

The AI Coach receives a few hundred tokens of already-computed numbers and
writes judgement about them. It is told, in the system prompt, that every figure
it states must appear in the block it was given.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | One deployable process serving both UI and API. Server components mean the dashboard renders from the database with no client fetch waterfall. |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | The pace engine is the product; its types should be load-bearing. |
| Database | PostgreSQL 17 | Relational data with real constraints, plus `date` and `jsonb` where each fits. |
| ORM | Prisma 7 + `@prisma/adapter-pg` | Typed queries and a real migration history. |
| Styling | Tailwind CSS 4 | Tokens in CSS variables, so light/dark is one definition. |
| Charts | Recharts | Composable, themeable through CSS variables. |
| Validation | Zod 4 | One schema shared by the API boundary and the model's structured output. |
| Auth | Custom, scrypt + DB sessions | No dependency, no native build, revocable sessions. |
| Tests | Vitest | Fast, ESM-native. |

Deliberately **not** used: Kubernetes, microservices, a message queue, Redis, an
auth SaaS. This is one process, one database, one directory of images. Adding
infrastructure would add failure modes without removing any.

## Request flow

```
Screenshots
    │
    ▼
POST /api/snapshots ──── magic-byte validation, EXIF strip, resize to 1568px,
    │                    SHA-256 dedupe, write to storage driver
    ▼
Snapshot (DRAFT) + SnapshotImage rows
    │
    ▼
POST /api/snapshots/:id/process
    │
    ├── budget guardrail ─── over budget? downgrade or refuse, before any spend
    │
    ├── retry ladder ─────── 1. standard prompt, cheap model
    │                        2. explicit prompt, cheap model
    │                        3. explicit prompt, escalation model
    │
    ├── Zod schema validation ── malformed output never reaches the database
    ├── normalisation ────────── clamp confidence, drop unusable readings
    ├── KPI matching ─────────── key → alias → display name; no match = ask
    ├── conflict reconciliation ─ two screens disagreeing = a question, not a guess
    └── plausibility checks ──── negative counts, absurd magnitudes
    │
    ▼
MetricObservation rows
    │  confidence ≥ threshold AND plausible AND mapped  →  ACCEPTED
    │  anything else                                    →  PENDING / CONFLICT / UNMAPPED
    ▼
Snapshot CONFIRMED (nothing to review) or NEEDS_REVIEW
    │
    ▼
buildDashboard() ─── the single computed read model
    │
    ├── /              Command Center
    ├── /scorecard     the flat table
    ├── /kpi/[key]     detail and trend
    └── AI context ─── ~500 tokens for the coach
```

## The pace engine

`src/lib/kpi/pace.ts` is the heart of the system. It is a pure function.

The subtlety worth knowing about is **whether today counts**. Checking the
dashboard in the morning, today is a selling day still ahead of you. Checking it
after uploading the evening's screenshots, today is finished and its production
is already in the numbers. The same data means different things in those two
moments.

The engine takes `todayCounted` explicitly, and `buildDashboard` derives it:
*today counts as worked if a confirmed snapshot was captured today.* That
matches the actual workflow — you upload when you finish — and it means the
"today's target" card automatically becomes "next day's target" after you upload.

Given that, the engine splits the period into:

- **engaged units** — worked and reflected in `current`
- **remaining units** — still available to sell in

and derives everything from those two windows:

```
currentRate   = current / engaged
requiredRate  = (target − current) / remaining
projected     = currentRate × (engaged + remaining), never below current
expectedByNow = target × (engaged / total)
paceIndex     = current / expectedByNow          1.0 is exactly on pace
```

Status comes from `paceIndex`, with two guards that matter: a period where
nothing has been worked yet is `ON_TRACK`, not `BEHIND` (day one is not a
failure), and a period with no units left and an unmet goal is `MISSED` rather
than merely `BEHIND`.

**Units are shifts when a schedule exists.** "1.25 per remaining shift" is an
instruction. "1.0 per day" is trivia when two of those days are days off.

## Aggregation semantics

The Victra dashboard shows period-to-date running totals, so a KPI's current
value is the **latest** reading in the period, not the sum of readings
(`AggregationMode.LATEST`, the default). Daily production is then the difference
between consecutive captures — which is what the per-day chart shows.

`AggregationMode.SUM` exists for KPIs logged as per-shift increments instead.
It is per-KPI, editable in Settings.

## Cost control

Four mechanisms, in order of how much they save:

1. **Arithmetic in code.** The single largest saving. No model call for maths.
2. **Compact context.** `buildPerformanceContext()` sends computed summaries, not
   rows. A weekly context is ~500 tokens regardless of stored history.
3. **Fingerprint caching.** A coaching brief is cached against a hash of the
   numbers it was written from. Opening the dashboard ten times costs one call,
   not ten. `invalidateCoachCache()` fires when a snapshot is confirmed or a goal
   changes.
4. **Model routing.** Sonnet handles extraction, coaching, and chat. Opus is
   reached only by the retry ladder's last rung or the explicit Deep Analysis
   button.

Plus the guardrail in `src/lib/ai/budget.ts`, which runs **before** every call:

| Month-to-date | Extraction | Coach / chat / analysis |
|---|---|---|
| under 80% of budget | routed model | routed model |
| 80–100% | cheap model | cheap model |
| over budget | cheap model, warned | **blocked** |
| over 1.25× budget | **blocked** | **blocked** |

Extraction survives longer than the optional features because blocking it breaks
the core workflow — but it still has a hard ceiling. There is no path to an
unbounded bill.

Prices live in one table (`src/lib/ai/models.ts`), verified against Anthropic's
published rates on 2026-06-24, overridable at runtime via `AI_PRICE_OVERRIDES`
because rates change. An unknown model is priced at the top tier rather than at
zero, so the guardrail errs toward caution.

## Data model

Fifteen tables. The ones worth understanding:

- **`snapshots`** — one upload session. Append-only. Uploading twice in a day
  creates two observations, never an edit. History is the point.
- **`metric_observations`** — one KPI reading. `aiValue` holds what the model
  said; `correctedValue` holds what you said; `value` is what the dashboard
  reads. A correction never destroys the original, which is what makes
  extraction accuracy measurable over time.
- **`extraction_attempts`** — one row per rung of the retry ladder, with model,
  prompt version, tokens and cost. A failed extraction is diagnosable.
- **`ai_requests`** — the immutable cost ledger the budget guard reads.
- **`kpi_definitions`** — KPI names are data. A KPI the AI finds but you have not
  defined becomes an `UNMAPPED` observation and a prompt to create it.

Every table carries `userId`. The app ships single-user, but multi-user is a
change to the session lookup rather than a migration of every table.

Indexes are placed on what is actually queried — `(userId, kpiId, effectiveAt)`
for dashboard reads, `(userId, createdAt)` for the cost ledger — not on every
column.

## Security

- scrypt password hashing (N=32768) using Node's standard library.
- Sessions are random 32-byte tokens; only the SHA-256 hash is stored, and the
  cookie is additionally HMAC-signed so a forged cookie is rejected without a
  database round-trip.
- Screenshots are never public. They live outside the web root and are served
  only through an authenticated, ownership-checked route with
  `Cache-Control: private` and `X-Robots-Tag: noindex`.
- Upload format is decided by magic bytes, never by the `Content-Type` header.
- Storage keys are validated against traversal and re-checked after resolution.
- The Anthropic key is read only in server modules; `src/lib/env.ts` throws if it
  is ever imported into a client bundle.
- Rate limits on login, upload, and AI endpoints.
- Log metadata is redacted for anything matching a secret-shaped key.

## Extending it

The abstractions that exist because they were genuinely needed:

- **`AiProvider`** — swap models or providers without touching calling code. The
  `MockAiProvider` exercises the whole pipeline offline.
- **`StorageDriver`** — local disk today, S3/R2/B2 by changing one env var.
- **`Notification`** table + `evaluateAlerts()` — alerts are computed
  deterministically and rendered in-app. Email or push is a new consumer of
  objects that already exist, not a rewrite.
- **`userId` everywhere** — multi-user, team comparison, and manager views have
  a place to attach.
