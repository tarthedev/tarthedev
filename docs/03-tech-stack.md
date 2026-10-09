# Tech Stack and Architecture

Built by one developer with Claude Code, hosted on a VPS, running cost $200–$600/month.

## Ground rules

1. **One language:** TypeScript in the browser, the API, the worker and the import scripts.
2. **Boring, proven tools** that Claude Code knows well.
3. **Money in integer cents.** Never floats. Every money change goes to the audit log.
4. **Card numbers never touch our server.** Stripe's hosted fields and links only; we store Stripe IDs.
5. **Tests guard the paycheck.** The commission engine ships with the worked examples in [02-commission-plan.md](02-commission-plan.md) as tests.
6. **Small, shippable steps.** One feature per branch, deployed to staging, demoed to the office weekly.

## The app and the server

| Layer | Pick | Why |
|---|---|---|
| Web app (office, iPad, customer portal) | React 19 + Vite + TypeScript | One app, three role-based faces |
| Installable on iPad | vite-plugin-pwa (Workbox) | Home-screen icon, full screen, cached app shell |
| Routing and data | TanStack Router + TanStack Query | Typed routes, caching, retries |
| UI kit | Tailwind CSS + shadcn/ui | Consistent, big touch targets |
| Dispatch board | FullCalendar Premium (resource timeline) | Proven tech-per-row scheduler with drag and drop; about $480/yr. Fallback: custom board on dnd-kit |
| Maps | Google Maps JavaScript API | Map view, address autocomplete |
| API | Node.js (current LTS) + Hono + Zod | Small, fast, typed; schemas shared with the app |
| Live updates | WebSockets + Postgres LISTEN/NOTIFY | Board and scoreboards update instantly |
| Database | PostgreSQL 17+ + Drizzle ORM | Typed queries, migrations in git |
| Background jobs | pg-boss (queue inside Postgres) | Texts, syncs, payroll runs, no Redis to operate |
| Auth | Better Auth | Roles, 2FA for office, quick PIN login on iPads, one-time links for the customer portal |
| PDFs | HTML → PDF with Playwright on the server | Invoices, proposals, pay sheets look like the screens |
| Tests | Vitest (logic) + Playwright with WebKit at iPad size | Catch Safari-specific bugs before techs do |

## Outside services

| Service | Used for | Notes |
|---|---|---|
| Stripe | Text-to-pay links, typed cards (Payment Element), ACH, saved cards for membership auto-renew | Webhooks mark invoices paid; process each event ID exactly once |
| Twilio | Browser phone (Voice JS SDK), call recording, texting, number porting | A2P 10DLC brand and campaign registration before business texting |
| QuickBooks Online (Accounting API) | Customers, items, invoices, payments, bills, time activities, classes; P&L report pull | Payroll API is partner-only, so commission goes on a weekly payroll sheet |
| Google Maps Platform | Geocoding, autocomplete, route matrix (drive times) | Per-API free monthly allowance; cache drive times per location pair |
| Claude API | Reading booking notes into structured job data, writing assignment reasons, weekly owner brief | Default to the current Opus model; check the exact model ID when building |
| Postmark | Invoice, receipt, reminder and portal emails | |
| GreenSky | Financing | No public developer API: monthly-payment display + apply link; office records approval and funding |
| DigitalOcean | Droplet, managed Postgres, Spaces object storage | |
| Backblaze B2 (or similar) | Nightly off-site copy of database dumps and files | |
| Sentry + an uptime checker | Errors and outage alerts | Free tiers |
| GitHub Actions | Tests and deploys | |
| ServiceTitan API (V2) | Stage 1–3 mirror (export feeds, polled) and stage 2 write-back of customers, jobs, appointments, assignments | Needs The Works or Enterprise Plus package and written permission; see [06-servicetitan-migration.md](06-servicetitan-migration.md) |
| Truck GPS trackers: Bouncie (or Teltonika + self-hosted Traccar) | Live truck positions, trip start/end, job-site arrival geo-zones, ETAs | See [Truck GPS trackers](#truck-gps-trackers) |

## Architecture

```
 Office browser        Tech iPad (home-screen app)        Customer phone      Truck GPS trackers
 (board, phones)       (jobs, sales, scoreboard)          (texts, pay links)  (webhooks, or TCP to Traccar)
        \                         |                               /                 |
         \______________ HTTPS + WebSockets via Caddy ___________/__________________/
                                  |
        +------------------------ DigitalOcean droplet (Docker Compose) ---+
        |   api (Hono, WebSockets)    worker (pg-boss jobs)                |
        +----------------|-----------------------|-------------------------+
                         |                       |
               Managed PostgreSQL         Spaces (photos, PDFs)
                         |
   Outbound API calls and inbound webhooks:
   Stripe · Twilio · QuickBooks · Google Maps · Claude API · Postmark · Bouncie
   ServiceTitan API: export feeds polled every 5 min; stage 2 write-back queue
```

- **api** handles requests, auth, and pushes live updates over WebSockets.
- **worker** runs everything slow or scheduled: the ServiceTitan mirror (polling, mapping, nightly reconciliation) and stage 2 write-back queue, texts and emails, QuickBooks sync, Stripe, Twilio and tracker webhook follow-ups, drive-time refresh, Sunday-night week lock, Monday payroll run, nightly restock lists.
- Postgres **LISTEN/NOTIFY** tells the api when the worker changed something.
- **Staging** runs as a second Compose stack on the same droplet with its own database in the same managed cluster and its own subdomain.

### Monorepo layout

```
apps/web          React PWA (office, iPad, portal)
apps/api          Hono API + WebSockets
apps/worker       pg-boss jobs
packages/db       Drizzle schema + migrations
packages/core     pricing, gross profit, commission, spiffs (pure functions)
packages/shared   Zod schemas and types shared by app and server
tools/st-import   ServiceTitan backfill, CSV fallback import, reconciliation scripts
docs/             this plan
CLAUDE.md         house rules for Claude Code
```

## AI dispatch

Math first, AI for judgment. Scheduling has hard constraints, so a scoring engine (and later a solver) makes the choice; Claude handles reading messy notes and explaining choices.

1. **Read:** on booking, Claude turns the notes into structured data (structured outputs): job type, required skills, estimated minutes, urgency, replacement likelihood.
2. **Filter (hard rules):** drop techs without the skill, outside their shift, or who can't make the window given drive time (Google route matrix, cached).
3. **Score (weighted):** drive minutes; tech's GP and close rate on this job type over the last 90 days; fair share of high-value calls this week; customer's requested tech; workload balance. **Replacement-likely calls skip fair share** and rank eligible techs by replacement close rate × average replacement GP over the last 180 days; the top-ranked tech who can make the window gets the call (owner decision, see [01-operations.md](01-operations.md#how-the-ai-picks-a-tech)).
4. **Assign and explain:** top score gets the job; reasons are stored and shown. Low confidence → Waiting + ping the dispatcher.
5. **Reshuffle:** when the day breaks (emergency, late tech), propose moves. Version 1 is greedy insertion in TypeScript; if time allows in month 5, add **VROOM** (open-source route optimizer, self-hosted in Docker) for whole-day optimization. Moving a confirmed customer always needs the dispatcher's OK.
6. **Learn:** override reasons feed a weekly report; owners approve any change to the weights.

## The iPad: what a Safari home-screen app can and can't do

| Works | Doesn't work in a web app |
|---|---|
The techs' devices are **iPad (A16) Wi-Fi + Cellular**: built-in GPS/GNSS (Wi-Fi-only iPads have none), current iPadOS, Apple Pencil (USB-C) for signatures.

| Works | Doesn't work in a web app |
|---|---|
| Home-screen icon, full screen | GPS while the screen is locked (iPadOS suspends the page); truck trackers cover this |
| Camera photos, signatures | Bluetooth card readers (need Stripe's native SDK; Safari has no Web Bluetooth) |
| Location while the app is open | Card payments with no signal |
| Web push once installed (iPadOS 16.4+) | |
| Text-to-pay links, typed cards (Payment Element) | |
| A Stripe smart reader (S700) driven by our server over the internet | |

- **Tap to Pay is impossible on any iPad,** native or web: Apple and Stripe support it on iPhone only (iPads lack the NFC payment reader).
- **Card-present now (optional):** a Stripe S700 smart reader ($299, no monthly fee, 2.7% + 5¢) using Stripe's **server-driven** integration. Our server sends the invoice amount to the reader assigned to that tech; the reader connects over the iPad's Personal Hotspot. Bench-test the hotspot first (Stripe readers don't support Wi-Fi 6 networks, and the carrier plan must include hotspot). Don't use the Terminal JavaScript SDK in the field: it needs the iPad and reader on the same local network.
- Web push can occasionally stop delivering on iOS, so emergency alerts also go out by text.
- **Phase 2 escape hatch:** wrap the same web app in a thin Capacitor App Store app. That allows a **$59 Stripe Reader M2 per truck over Bluetooth** (chip and tap, 2.7% + 5¢, offline card collection) and locked-screen GPS, without a rewrite. The community Capacitor Stripe Terminal plugin pins Stripe's iOS SDK 5.x (critical fixes only since October 2026), so prototype first and plan for SDK 6.x.

## Truck GPS trackers

Owner decision: new trackers in every truck. Two candidates; a two-week pilot of one of each decides.

| | Bouncie (recommended) | Teltonika + Traccar (runner-up) |
|---|---|---|
| Hardware | ~$90 per truck, OBD-II plug-in, 4G LTE | ~$100 per truck (e.g., FMM00A/FMM80A LTE-M OBD, AT&T certified), or hardwired FMx130 |
| Monthly | $8.35 per truck (3+ devices), no contract | IoT SIM ~$1–2 per truck + maybe $6–12/month more droplet for Traccar |
| 6 / 15 trucks per month | ~$50 / ~$125 | ~$10–25 / ~$25–35 |
| API | Self-serve OAuth API; live vehicle snapshot; trip webhooks streaming positions; geo-zones by API for job-site arrival | Open-source Traccar (Apache-2.0) on our server forwards every position to our API as JSON; WebSocket and REST |
| Catch | Consumer terms forbid "commercial purposes" and cap use at 3,000 miles / 150 hours a month (idle counts); warranty excludes commercial use. **Get written OK from Bouncie first.** | We run it: configure devices, manage SIMs, expose TCP port 5027 outside Caddy, no support line |

- Bouncie webhooks use a shared key (not a signature): check the header, and dedupe on device, transaction ID and timestamp in `webhook_events`. Geo-zones are per device, so arrival zones are per truck per job.
- Teltonika: tune the Send Period (default 120 s) to about 10–15 s while moving; confirm AT&T LTE-M coverage and SIM attach around Elizabeth City before ordering.
- Pilot exit test: webhook latency, gaps, and ETA accuracy against the iPad's own GPS; for Bouncie, written confirmation of commercial use.
- During stages 1–2, ServiceTitan's board keeps using its own mobile-app GPS; trackers feed only our board.

## Security

- Roles: owner, manager, dispatcher/CSR, tech, installer, customer. Techs see only their jobs and pay; CSRs can't see payroll.
- Two-factor for office logins; iPads use a device passcode plus a short PIN.
- Audit log for every money change: who, when, before and after.
- Webhooks verified by signature and processed idempotently.
- Backups: managed point-in-time restore + nightly off-site copy + a monthly restore drill.
- Automatic OS updates on the droplet, dependency alerts, secrets only in server environment variables.
- Call recordings and customer data retained for a set period *(setting)*.

## Monthly running costs (estimates, October 2026 published prices)

| Item | Per month |
|---|---|
| App server (DigitalOcean droplet, 4 vCPU / 8 GB) | $48 |
| Managed Postgres with daily backups | $30 |
| Spaces storage + off-site backup copy | ~$7 |
| Twilio: numbers, ~4,000–8,000 call minutes, recording, ~2,000–3,000 texts, A2P fees | $100–$180 |
| Postmark | $15 |
| Google Maps Platform | $0–$40 |
| Claude API | $30–$80 |
| FullCalendar Premium (about $480/yr) | ~$40 |
| Truck GPS trackers, 6–15 trucks (Bouncie; Teltonika + Traccar is ~$10–35) | ~$50–$125 |
| **Total** | **~$280–$565** |

One-time: trackers ~$90–$100 per truck. Optional: a Stripe S700 smart reader at $299 per truck.

Not included:
- Stripe fees: 2.9% + 30¢ for online and Payment Element cards (expected; 3.4% + 30¢ applies to cards keyed in Stripe's Dashboard or Terminal MOTO), 2.7% + 5¢ in person on a reader, ACH 0.8% capped at $5.
- GreenSky dealer fees (commonly reported around 7%, varies by plan).
- The ServiceTitan subscription, which continues while both systems run (possibly on a higher package for API access).

Card and dealer fees exist today and count as job costs.
