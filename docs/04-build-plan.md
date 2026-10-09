# Build Plan: Six Months to Cutover

One builder with Claude Code. Month 1 starts now (October 2026). Cutover lands **at least two weeks before the ServiceTitan renewal date**.

## Outside paperwork (long lead times, start early)

| When | What | Why it can't wait |
|---|---|---|
| Week 1 | Request ServiceTitan API credentials (developer portal) and pull report exports as a backup | Nothing else works without the data |
| Week 1 | Ask ServiceTitan, in writing, about data access after the contract ends and the cost of a 1–3 month extension | Insurance if we slip |
| Month 1 | Twilio account; A2P 10DLC brand and campaign registration | Carriers block unregistered business texts |
| Month 1 | Book an NC employment attorney or CPA to review the commission plan | Must be signed off before anyone is paid by it |
| Month 2 | Stripe account application and verification | Payments must be live for the pilot |
| Month 2 | Ask GreenSky to move the merchant account off ServiceTitan's sponsorship | Financing must keep working after ServiceTitan |
| Month 2 | FullCalendar Premium license | Needed for the board |
| Month 3 | Start porting phone numbers from Phones Pro to Twilio | Ports can take weeks |
| Month 4 | Pick pilot team: 1 CSR, 2 techs | Training in month 4, live in month 5 |

## Month 1: Foundation and data

- Monorepo scaffold (pnpm workspaces), `CLAUDE.md`, lint, typecheck, Vitest, GitHub Actions.
- DigitalOcean droplet, managed Postgres, Spaces, Caddy, staging and production stacks, Sentry, uptime checks, backups.
- Better Auth with roles: owner, manager, dispatcher/CSR, tech, installer.
- Core tables: customers, locations, contacts, equipment, memberships, pricebook, business units, settings, audit log.
- `tools/st-import`: ServiceTitan export to raw JSON, then idempotent import keyed on ServiceTitan IDs.
- QuickBooks Online OAuth connection; customers and items mapping.

**Exit test:** imported customer, equipment, membership and invoice counts and yearly dollar totals match ServiceTitan's reports.

## Month 2: Schedule and field

- Jobs, appointments, assignments, statuses; WebSocket live updates.
- Dispatch board: FullCalendar resource timeline, Waiting column, drag and drop, map view.
- iPad app (PWA): install flow, day view, job screen with history and equipment, checklists (UV / surge / air quality always asked on HVAC), photos, signatures.
- On My Way text with tech photo and ETA link; confirmation and day-before reminder texts.
- Timesheets (clock in/out, On My Way → Done per job) and foreground GPS pings.
- Push notifications with text fallback.

**Exit test:** a test job goes from booked to done on a real iPad, with the customer texts arriving.

## Month 3: Sell and get paid

- Proposal builder: Good/Better/Best templates, member vs regular price, GreenSky monthly payment display and apply link, signature.
- Invoices: member pricing, discounts with approval over 10%, sales tax, PDFs.
- Stripe: payment links (text-to-pay), Payment Element for typed cards, ACH, saved cards; idempotent webhooks.
- Memberships: sell, renew, auto-renew with saved card, visit tracking, renewal reminders.
- Customer portal (one-time links).
- QuickBooks sync: invoices, payments, classes. Review request texts.

**Exit test:** a real invoice paid by text link lands in QuickBooks in the right class.

## Month 4: Profit and pay

- Job costing: parts from truck stock and POs, labor from time entries × burdened cost, other job costs (fees, permits, subs).
- Purchase orders and receiving; supplier bills to QuickBooks.
- `packages/core` commission engine exactly per [02-commission-plan.md](02-commission-plan.md), with every worked example as a test.
- Tech scoreboard on the iPad; pay sheets; weekly payroll sheet including the overtime true-up.
- Callbacks (link, tech-caused flag, deductions). Spiff and combo rules. Office spiffs.
- Commercial: PO-required customers, terms, statements, multi-site, progress billing, builder bids, aging report.
- Reports: job, tech and department GP; P&L with QuickBooks overhead via the Reports API.
- Training copy of the system (anonymized data) for practice.

**Exit test:** last month's real jobs, replayed, produce the right commission to the penny for at least two techs checked by hand.

## Month 5: Phones, AI and pilot

- Twilio browser phone: inbound routing, screen pop, recording, call log, non-bookable tagging, booking rate.
- AI: Claude note reading (structured output), hard-rule filter, weighted scoring, auto-assign with reasons, override reasons, weekly fair-share report. VROOM reshuffle if time allows.
- Truck inventory and nightly restock lists.
- **Pilot:** 1 CSR and 2 techs run real work on the new system; everyone else stays on ServiceTitan.

**Exit test:** the pilot team runs a full week without touching ServiceTitan.

## Month 6: Cutover

- Final ServiceTitan delta import (everything changed since the last export).
- Port the phone numbers; everyone switches; cheat sheet at every desk.
- Fix list from the pilot.
- Two payroll runs checked by hand against the engine.
- Restore-from-backup drill.
- ServiceTitan kept read-only for lookups until the contract ends.

**Exit test:** two clean payroll weeks and a clean month-end close in QuickBooks.

## If we fall behind (cut list, in order)

1. AI dispatch launches in **suggest** mode (dispatcher clicks to accept) instead of auto-assign.
2. Inventory launches as **restock lists** only; full stock counts follow.
3. VROOM whole-day reshuffle moves to phase 2.
4. Builder bids move to phase 2 (progress billing stays).
5. Last resort: a short ServiceTitan extension (ask in week 1 what it costs).

## Risks

| Risk | Plan |
|---|---|
| Can't get data out of ServiceTitan | Request API access in week 1; monthly exports from month 1; report exports as backup |
| Phone numbers stuck in Phones Pro | Start the port in month 3; test on a quiet morning |
| Texts blocked | A2P 10DLC registration in month 1 |
| GreenSky tied to ServiceTitan | Ask GreenSky in month 2 to move the merchant account |
| Stripe approval delay | Apply in month 2 |
| Commission bugs | Pure, tested engine; replay real months; hand-check two techs; attorney/CPA review |
| iPad web-app limits | Text-to-pay now; Capacitor App Store wrapper in phase 2 |
| One-person bus factor | Everything in git, docs in `docs/`, infrastructure as Compose files, runbooks for deploy and restore |

## Phase 2 (after ServiceTitan is gone)

AI phone receptionist for after-hours and overflow, online booking on the website, Capacitor App Store wrapper (Tap to Pay, background GPS), truck GPS tracker integration, marketing campaigns (tune-ups, renewals, reviews), job-value predictions and pricebook suggestions.
