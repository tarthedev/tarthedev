# Build Plan: Build, Pilot, Switch

One builder with Claude Code, starting October 2026. **There is no hard cutover date** (owner decision). ServiceTitan keeps running the business while we build. A pilot crew proves the new system, and then everyone switches; details in [06-servicetitan-migration.md](06-servicetitan-migration.md). Months are targets, not deadlines.

| Stage | Target | What the business gets |
|---|---|---|
| 1. Build and load | Months 1–5 | ServiceTitan data imported from report exports; reports; every feature built and tested in a training copy |
| (Optional) Early Profit Ladder | From about month 2–3 | Pay plan, scoreboards and payroll sheet for everyone, from weekly report uploads |
| 2. Pilot crew | About month 6 | One crew (2 techs + 1 CSR) runs all its work in the new system |
| 3. Switch | When the pilot has proven itself | Everyone moves; phones ported; ServiceTitan read-only |

## Outside paperwork

| When | What | Why |
|---|---|---|
| Month 1 | Export one of each ServiceTitan report we need (customers, locations, equipment, memberships, pricebook, invoices with items and costs, payments, timesheets, technicians) | The importer is built to match the real files |
| Month 2 | Twilio account and A2P 10DLC texting registration | Arrival and reminder texts need it before the pilot |
| Month 3 | FullCalendar Premium license | Dispatch board |
| Month 4 | Stripe account application | Payments for the pilot |
| Month 5 | GPS setup for the pilot trucks (see [03-tech-stack.md](03-tech-stack.md#truck-gps)) | Map and ETAs for the pilot |
| A month before the switch | Ask GreenSky to move the merchant account off ServiceTitan's sponsorship | Financing must keep working |
| A few weeks before the switch | Start porting phone numbers from Phones Pro to Twilio | Ports can take weeks |

The commission plan's legal review is handled by the owners' CPA.

## Month 1: Foundation and import

- Monorepo scaffold (pnpm workspaces), `CLAUDE.md` commands, lint, typecheck, Vitest, GitHub Actions.
- DigitalOcean droplet, managed Postgres, Spaces, Caddy, staging and production stacks, Sentry, uptime checks, backups.
- Better Auth with roles: owner, manager, dispatcher/CSR, tech, installer.
- Core tables: customers, locations, contacts, equipment, memberships, pricebook, business units, settings, audit log.
- `tools/st-import` + the office **Import** page: upload, detect, preview, import (idempotent on ServiceTitan IDs), keep the raw file, and show an import report with totals.
- `packages/core` commission engine per [02-commission-plan.md](02-commission-plan.md), with every worked example as a test.

**Exit test:** a full import matches ServiceTitan's summary totals per business unit and year; all commission tests pass.

## Month 2: History, reports, and the optional early Profit Ladder

- Import job, invoice, payment and timesheet history.
- Reports: job, tech and department gross profit; P&L with QuickBooks overhead (read-only QuickBooks connection).
- Replay 12 months of history through the commission engine; owners set the final ladder steps.
- (Optional, recommended) Tech scoreboard as a home-screen web app on the iPads, plus pay sheets and the weekly payroll sheet with overtime true-up, all from weekly report uploads. Shadow-run 2–4 weeks, then pay from it.

**Exit test:** the engine matches a hand calculation for two techs over two past weeks.

## Month 3: Booking and dispatch

- Booking screen with script, membership offer, AI note reading (structured output).
- Dispatch board: FullCalendar resource timeline, Waiting column, map, drag and drop.
- AI auto-assign: hard-rule filter, weighted score, replacement-likely calls to the strongest closer, reasons, override reasons, weekly fair-share report.
- Confirmation and day-before reminder texts (Twilio).

## Month 4: Field app and getting paid

- iPad field app (PWA): day view, job screen with history and equipment, checklists (UV, surge and air quality always asked on HVAC), photos, signatures, On My Way text with ETA, timesheets.
- Proposal builder: Good/Better/Best, member vs regular price, GreenSky monthly payments and apply link.
- Invoices: member pricing, discount approval over 10%, sales tax, PDFs.
- Stripe: payment links, Payment Element, ACH, saved cards, idempotent webhooks.
- QuickBooks posting for invoices the new system creates (never for imported ServiceTitan invoices).

**Exit test:** a full job runs on a real iPad in the training copy: booked, worked, sold, invoiced, paid by text, posted to QuickBooks.

## Month 5: Profit, commercial, inventory, practice

- Job costing from our own jobs: parts, labor from time entries, fees, permits, subcontractors.
- Purchase orders and receiving; supplier bills to QuickBooks; truck stock and restock lists.
- Commercial: PO-required customers, terms, statements, multi-site, progress billing, builder bids, aging.
- Memberships: sell, renew, auto-renew, visit tracking. Customer portal. Review request texts.
- GPS for the pilot trucks.
- Training copy refreshed with the latest import; pilot crew and CSR practice in it.

**Exit test:** the pilot crew completes a practice week in the training copy.

## Month 6: Pilot crew goes live (stage 2)

- `system_of_record` set so the pilot crew's jobs live in the new system.
- Fresh import of customers, equipment, memberships and pricebook right before go-live.
- Daily check-in with the pilot crew; a fix list worked every day.

**Pass test:** four clean weeks of bookings, jobs, invoices, payments and QuickBooks postings; two payroll weeks checked by hand; the crew says it's at least as fast as ServiceTitan.

## Switch (stage 3), when the pilot passes

- Final import: customers, equipment, memberships, open invoices and balances, future appointments.
- Everyone moves (all at once, or one business unit at a time); cheat sheet at every desk.
- Twilio browser phone: screen pop, recording, call tagging, booking rate; numbers ported.
- Members save cards via Stripe links as they renew.
- ServiceTitan read-only until the contract ends; final full exports kept.
- Restore-from-backup drill.

## If we fall behind (cut list, in order)

1. AI dispatch launches in **suggest** mode (dispatcher clicks to accept) instead of auto-assign.
2. Inventory launches as **restock lists** only.
3. VROOM whole-day reshuffle moves to phase 2.
4. Builder bids move to phase 2 (progress billing stays).

Because ServiceTitan keeps running the business, a slip costs ServiceTitan subscription months, not operations.

## Risks

| Risk | Plan |
|---|---|
| ServiceTitan exports lack a needed field | Export one of each report in month 1, before building the importer |
| Data drifts between imports | Weekly re-imports keyed on ServiceTitan IDs, import reports with totals, final import at the switch |
| Double posting to QuickBooks | Each system posts only the invoices it created |
| Commission bugs | Pure, tested engine; history replay; shadow-run; CPA sign-off |
| Paying for two systems with no end date | Clear pilot pass test; owners review progress monthly |
| iPad web-app limits | Text-to-pay and Payment Element now; optional smart reader; App Store wrapper with a Bluetooth reader in phase 2 |
| One-person bus factor | Everything in git, docs in `docs/`, Compose files, runbooks for deploy and restore |

## Phase 2 (after the switch)

- AI phone receptionist for after-hours and overflow calls.
- Online booking on the website.
- Capacitor App Store wrapper for:
  - a $59 Stripe Reader M2 per truck over Bluetooth (chip and tap, and offline card collection)
  - background location
- Marketing campaigns (tune-ups, renewals, reviews).
- Job-value predictions and pricebook suggestions.

Tap to Pay is not on this list. Apple supports it only on iPhone, not iPad.
