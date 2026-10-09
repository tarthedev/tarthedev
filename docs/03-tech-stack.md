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
| Tech location: the iPads' built-in GPS | Dispatch map, arrival detection, customer ETAs | No extra hardware; see [Truck GPS](#truck-gps). Fallback if the pilot shows gaps: Spytec plug-in trackers |

## Architecture

```
 Office browser        Tech iPad (home-screen app)        Customer phone
 (board, phones)       (jobs, sales, scoreboard, GPS)     (texts, pay links, portal)
        \                         |                               /
         \______________ HTTPS + WebSockets via Caddy ___________/
                                  |
        +------------------------ DigitalOcean droplet (Docker Compose) ---+
        |   api (Hono, WebSockets)    worker (pg-boss jobs)                |
        +----------------|-----------------------|-------------------------+
                         |                       |
               Managed PostgreSQL         Spaces (photos, PDFs)
                         |
   Outbound API calls and inbound webhooks:
   Stripe · Twilio · QuickBooks · Google Maps · Claude API · Postmark
   ServiceTitan: no API; report exports uploaded on the office Import page
```

- **api** handles requests, auth, and pushes live updates over WebSockets.
- **worker** runs everything slow or scheduled: ServiceTitan report imports and import reports, texts and emails, QuickBooks sync, Stripe and Twilio webhook follow-ups, drive-time refresh, Sunday-night week lock, Monday payroll run, nightly restock lists.
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
tools/st-import   ServiceTitan report-export parsers, import mapping, import reports
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
| Home-screen icon, full screen | GPS while the screen is locked or another app is in front (WebKit stops location when the page isn't visible) |
| Camera photos, signatures | Bluetooth card readers (need Stripe's native SDK; Safari has no Web Bluetooth) |
| Location while the app is open | Card payments with no signal |
| Web push once installed (iPadOS 16.4+) | |
| Text-to-pay links, typed cards (Payment Element) | |
| A Stripe smart reader (S700) driven by our server over the internet | |

- **Tap to Pay is impossible on any iPad,** native or web: Apple and Stripe support it on iPhone only (iPads lack the NFC payment reader).
- **Card-present now (optional):** a Stripe S700 smart reader ($299, no monthly fee, 2.7% + 5¢) using Stripe's **server-driven** integration. Our server sends the invoice amount to the reader assigned to that tech; the reader connects over the iPad's Personal Hotspot. Bench-test the hotspot first (Stripe readers don't support Wi-Fi 6 networks, and the carrier plan must include hotspot). Don't use the Terminal JavaScript SDK in the field: it needs the iPad and reader on the same local network.
- Web push can occasionally stop delivering on iOS, so emergency alerts also go out by text.
- **Phase 2 escape hatch:** wrap the same web app in a thin Capacitor App Store app. That allows a **$59 Stripe Reader M2 per truck over Bluetooth** (chip and tap, 2.7% + 5¢, offline card collection) and locked-screen GPS, without a rewrite. The community Capacitor Stripe Terminal plugin pins Stripe's iOS SDK 5.x (critical fixes only since October 2026), so prototype first and plan for SDK 6.x.

## Truck GPS

**Owner decision: iPad GPS for now** (the easiest option). No trackers to buy: the techs' iPads (A16 Wi-Fi + Cellular, built-in GPS) report location while our app is on screen. Each truck gets a dash or vent mount out of direct sun and a USB-C car charger (20W or more).

How it works:

- **Start day.** The tech taps *Start day* (or *On My Way*). That tap starts `watchPosition` with high accuracy and requests a Screen Wake Lock so the screen stays on (supported in Home Screen web apps since iPadOS 18.4). Auto-Lock is lengthened in Settings.
- **Pings.** Uploads go every 10–15 seconds while moving into `gps_pings`, queued in IndexedDB when there's no signal. The watch restarts whenever the app becomes visible again.
- **Paused, not silent.** When the page is hidden (screen locked, cover closed, another app in front), WebKit stops location at once. The app sends a "paused" beacon (`sendBeacon`) as it hides, and the board shows **"GPS paused since 10:42"**. A server heartbeat marks a tech **stale** if pings stop with no beacon (dead iPad, overheating, no signal).
- **Dispatch doesn't depend on it.** AI drive times use job addresses, job statuses and the last known fix.
- **ETAs.** *On My Way* computes the ETA from the current fix, or from the previous job's address if there's no fresh fix, and texts it. The live link shows the dot only when the last ping is under about 2 minutes old; otherwise it shows the ETA only.
- **Arrival** is detected within a radius of the job address.
- **Coverage report:** a daily GPS coverage percentage per tech for on-the-clock time.
- **Pilot only at first.** Until the switch, only the pilot crew's iPads report; ServiceTitan's board keeps using its own mobile-app GPS.

Settings per iPad:

- Location Services on.
- Safari Websites set to *While Using* with Precise Location on.
- Settings › Apps › Safari › Location set to *Allow*. Test on a real iPad whether this stops repeat prompts in the Home Screen app; Apple doesn't document it.
- Optionally push the app as a full-screen Web Clip from **Apple Business** (free, built-in MDM). This doesn't need erasing the iPads.
- Don't use Guided Access or Single App Mode.

Known limits and what to test in month 1 on one iPad:

- Location-permission prompts across cold launches.
- The wake lock after returning from the background (the first request needs a tap; show a big "Tap to resume GPS" banner).
- Low Power Mode, which shortens Auto-Lock to 30 seconds. Keep the iPads charging.
- Heat on the dash: Apple says charging can stop and the screen can dim when hot.
- Navigation: opening Maps full screen pauses our GPS. Techs navigate on their phones, or tile Maps beside our app with Windowed Apps on iPadOS 26+ (test).

**If the pilot shows poor coverage:**

1. Easiest plug-in fallback: **Spytec GPS Pulse OBD**, business plan.
   - $0 hardware, about 30-second OBD install.
   - $14.95 per truck per month month-to-month, or $8.95 on annual prepay, with 5–10% off at 5+ devices.
   - No contract, sold to service fleets.
   - Its own app and map work on day one and include customer ETA texts.
   - API access (Hapn) is issued on request and its price isn't published, so get it in writing first.
   - Pilot on month-to-month: their annual plans are non-refundable.
2. If Spytec won't provide an API: **OneStep GPS** at $13.95 per truck per month plus $20 activation, no contract, free open API and webhooks.
3. Phase 2 alternative: the Capacitor App Store wrapper with background location, which keeps working with the screen locked. It needs an Apple Developer membership ($99/yr). The community plugin supports Capacitor up to 7, so prototype first.

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
| **Total** | **~$270–$440** |

One-time: a dash mount and USB-C car charger per truck (GPS uses the iPads). Optional: a Stripe S700 smart reader at $299 per truck. Only if the pilot needs plug-in trackers: Spytec at about $9–$15 per truck per month.

Not included:
- Stripe fees: 2.9% + 30¢ for online and Payment Element cards (expected; 3.4% + 30¢ applies to cards keyed in Stripe's Dashboard or Terminal MOTO), 2.7% + 5¢ in person on a reader, ACH 0.8% capped at $5.
- GreenSky dealer fees (commonly reported around 7%, varies by plan).
- The ServiceTitan subscription, which continues until the switch.

Card and dealer fees exist today and count as job costs.
