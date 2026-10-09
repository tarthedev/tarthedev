# Build Plan: Side by Side, in Stages

One builder with Claude Code. Month 1 starts October 2026. **There is no hard cutover date** (owner decision). ServiceTitan keeps running while work moves over in the stages described in [06-servicetitan-migration.md](06-servicetitan-migration.md). Months below are targets, not deadlines; a stage starts only when the one before it is proven.

| Stage | Target | What the business gets |
|---|---|---|
| 0. Ask and connect | Weeks 1–3 | ServiceTitan API access confirmed in writing (or the report-export fallback chosen) |
| 1. Mirror, reports and pay | Live by about month 3 | Reports, the Profit Ladder, tech scoreboards, payroll sheet, office spiffs, all on ServiceTitan data |
| 2. Booking and dispatch | Live by about month 6 | Booking screen, dispatch board with AI auto-assign, truck GPS; techs still work in the ServiceTitan app |
| 3. Field, invoices, payments | Pilot crew from about month 8, then one business unit at a time | Our iPad app, Good/Better/Best, Stripe, memberships, customer portal, inventory |
| 4. Phones and switch-off | When the last business unit has moved | Twilio phones, ServiceTitan read-only, then off |

## Outside paperwork (long lead times, start early)

| When | What | Why |
|---|---|---|
| Week 1 | Confirm the ServiceTitan package includes API access (The Works or Enterprise Plus); price an upgrade if not | Decides API sync vs report-export fallback |
| Week 1 | Written permission from ServiceTitan + a lawyer's read of the API Terms; disclose AI use at app registration | The terms restrict migration apps and data retention as written |
| Week 1 | Register the app (about 2 business days for approval) | Needed for the mirror |
| Month 1 | NC employment attorney or CPA reviews the commission plan | Must be signed off before anyone is paid by it |
| Month 2 | Email Bouncie for written OK on commercial fleet use (their terms restrict "commercial purposes" and over 150 ignition-on hours a month) | Decides the tracker choice |
| Month 3 | Two-week tracker pilot: one Bouncie, one Teltonika + Traccar | Pick the winner before buying for every truck |
| Month 3 | Twilio account and A2P 10DLC texting registration | Arrival and reminder texts start in stage 2 |
| Month 4 | FullCalendar Premium license | Dispatch board |
| Month 5 | Stripe account application | Payments start in stage 3 |
| Month 6 | Ask GreenSky to move the merchant account off ServiceTitan's sponsorship | Financing must keep working for moved business units |
| Stage 4 | Port phone numbers from Phones Pro to Twilio | Ports can take weeks |

## Month 1: Foundation and connection

- Monorepo scaffold (pnpm workspaces), `CLAUDE.md` commands, lint, typecheck, Vitest, GitHub Actions.
- DigitalOcean droplet, managed Postgres, Spaces, Caddy, staging and production stacks, Sentry, uptime checks, backups.
- Better Auth with roles: owner, manager, dispatcher/CSR, tech, installer.
- ServiceTitan connector in `apps/worker`: OAuth, `st_sync_cursor`, raw landing tables, throttled backfill, 5-minute/hourly/nightly/weekly schedules.
- (Fallback path instead: CSV report import page.)

**Exit test:** the mirror has run for a week with no gaps.

## Month 2: Mirror mapped, reports, pay engine in shadow

- Map raw ServiceTitan rows into core tables: customers, locations, contacts, equipment, memberships, pricebook, technicians, business units, jobs, appointments, invoices and items, payments, estimates, job splits, timesheets, POs, calls.
- Nightly reconciliation against ServiceTitan's Reporting API, with drift alerts.
- Reports: job, tech and department gross profit; P&L with QuickBooks overhead (read-only QuickBooks connection).
- `packages/core` commission engine exactly per [02-commission-plan.md](02-commission-plan.md), with every worked example as a test. Runs in **shadow** (no pay yet).

**Exit test:** mirror totals match ServiceTitan per business unit per day; the engine's results for two techs match a hand calculation for two past weeks.

## Month 3: Stage 1 goes live (the Profit Ladder)

- Tech scoreboard as a home-screen web app on the iPads, alongside the ServiceTitan app.
- Pay sheets, weekly payroll sheet with overtime true-up, callbacks (marked in our app), spiffs, combos, review verification, office spiffs and booking rate from the calls feed.
- Shadow-run 2–4 pay weeks, then pay from it once the owners and CPA sign off.
- Tracker pilot (one Bouncie, one Teltonika + Traccar).

**Exit test:** two consecutive payroll weeks paid from the engine with no corrections needed.

## Months 4–5: Booking and dispatch (built, then stage 2 goes live)

- Booking screen with script, membership offer, AI note reading (structured output).
- Dispatch board: FullCalendar resource timeline, Waiting column, map with tracker positions, drag and drop.
- AI auto-assign: hard-rule filter, weighted score, replacement-likely calls to the strongest closer, reasons, override reasons, weekly fair-share report.
- Write-back to ServiceTitan: customers, locations, jobs, appointments, tech assignments, through a queue with `externalData` stamps, conflict rules and echo suppression.
- Execution data back from ServiceTitan every 1–2 minutes (`includeRecentChanges=true`).
- Trackers installed in every truck (pilot winner).
- Confirmation, day-before reminder and On My Way texts (Twilio), using tracker ETA.

**Exit test (end of month 5, then go live):** a full week of bookings made in the new system appear correctly in ServiceTitan, and techs notice nothing different in their ServiceTitan app.

## Months 6–7: Field, money and memberships (built)

- iPad field app (PWA): day view, job screen with history and equipment, checklists (UV, surge and air quality always asked on HVAC), photos, signatures, On My Way, timesheets.
- Proposal builder: Good/Better/Best, member vs regular price, GreenSky monthly payments and apply link.
- Invoices: member pricing, discount approval over 10%, sales tax, PDFs, progress billing, PO-required customers, terms, statements.
- Stripe: payment links, Payment Element, ACH, saved cards, idempotent webhooks. Optional server-driven smart reader.
- Memberships: sell, renew, auto-renew, visit tracking.
- Customer portal. Review request texts.
- QuickBooks posting for invoices the new system creates (never for mirrored ServiceTitan invoices).
- Truck inventory, restock lists, purchase orders and receiving.

**Exit test:** a full job runs on the iPad in staging (booked, worked, sold, invoiced, paid by text, posted to QuickBooks), and nothing is written to ServiceTitan for it.

## Month 8 onward: Stage 3, one business unit at a time

1. Pilot crew (two techs) moves completely: their jobs stop being created in ServiceTitan.
2. Two clean weeks, then the next business unit. Suggested order: plumbing, HVAC service, HVAC replacement, commercial and refrigeration, new construction.
3. Each move: techs switch apps, the pricebook owner flips at the first move, memberships move as they renew.

**Exit test per business unit:** two clean payroll weeks and a clean month-end in QuickBooks with no double-posted invoices.

## Stage 4: Phones and switch-off

- Twilio browser phone: screen pop, recording, call tagging. Port the numbers.
- Final full export; ServiceTitan read-only until the contract ends.
- Restore-from-backup drill.

## If we fall behind (cut list, in order)

1. AI dispatch launches in **suggest** mode (dispatcher clicks to accept) instead of auto-assign.
2. Inventory launches as **restock lists** only.
3. VROOM whole-day reshuffle moves to phase 2.
4. Builder bids move to phase 2 (progress billing stays).

Because ServiceTitan keeps running, slipping a stage costs ServiceTitan subscription months, not operations.

## Risks

| Risk | Plan |
|---|---|
| API not included in our ServiceTitan package, or not permitted | Confirm in week 1; report-export fallback keeps stages 1 and 3 working |
| Paying for two systems with no end date | Each stage has a target month; owners review the ServiceTitan bill against progress every month |
| Drift between the systems | One owner per field, `externalData` stamps, nightly reconciliation with alerts |
| Double posting to QuickBooks | Only the system that created an invoice posts it |
| Commission bugs | Pure, tested engine; shadow-run 2–4 weeks; attorney/CPA review |
| Bouncie terms forbid commercial use | Written OK first; Teltonika + Traccar is the runner-up |
| iPad web-app limits | Text-to-pay and Payment Element now; optional smart reader; App Store wrapper with a Bluetooth reader in phase 2 |
| One-person bus factor | Everything in git, docs in `docs/`, Compose files, runbooks for deploy and restore |

## Phase 2 (after ServiceTitan is off)

- AI phone receptionist for after-hours and overflow calls.
- Online booking on the website.
- Capacitor App Store wrapper for:
  - a $59 Stripe Reader M2 per truck over Bluetooth (chip and tap, and offline card collection)
  - GPS that keeps working with the screen locked
- Marketing campaigns (tune-ups, renewals, reviews).
- Job-value predictions and pricebook suggestions.

Tap to Pay is not on this list. Apple supports it only on iPhone, not iPad. A tech's own iPhone could do it later through a separate iPhone app, but that is optional.
