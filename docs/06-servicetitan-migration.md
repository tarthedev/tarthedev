# Running Side by Side with ServiceTitan

**Owner decision (October 2026):** the ServiceTitan renewal date is not a deadline. Both systems run side by side, and work moves to the new system **in stages**, so day-to-day operations are never disrupted. ServiceTitan is turned off only when nothing is left in it.

Research behind this page was done October 2026 against ServiceTitan's public developer docs and API terms. Re-check anything marked *verify* once we are logged in to the developer portal.

## Stage 0: Ask and connect (weeks 1–3, before building anything)

These can block the whole approach, so they come first.

1. **Confirm the package.** ServiceTitan's help center says customer-built API apps need **The Works** or **Enterprise Plus**. If DWRG is on a lower package, get the upgrade price in writing. Third parties put The Works around $400–$500 per tech per month (unofficial), which could cost far more than our whole running budget. If the upgrade isn't worth it, use the **report-export fallback** below.
2. **Get written permission.** Read literally, ServiceTitan's API Terms (updated 2026-04-15) and customer Terms of Use restrict several things this plan does. The restrictions cover:
   - apps whose purpose is moving customers off ServiceTitan (3.4(21))
   - bulk extraction (3.4(27))
   - "analysis of Content" (3.4(15))
   - caching data for more than 24 hours (5.2)
   - keeping data after disconnecting (5.4)
   - building a "competitive product" (ToU 7(l))
   - the related license and usage clauses: 3.2, 3.4(1), 3.4(26), 5.1, 5.3 and 8.2

   Email integrations@servicetitan.com and the account manager a short, honest description:

   > "A customer-built, single-tenant app that mirrors our own data into our own internal system, writes bookings back during a gradual transition, and keeps our data."

   Ask for written confirmation, and have a lawyer read those clauses. This page reports what the clauses say, not a legal conclusion.
3. **Disclose AI use** when registering the app. The terms (3.4(37)) require disclosure for any app that relies on an AI system. Our AI dispatch does.
4. **Register the app** in the developer portal under a DWRG employee's login, not a contractor's. Approval can take about 2 business days. Credentials: client ID and secret, app key, tenant ID.
5. **Keep a backup channel no matter what:** monthly CSV report exports of customers, memberships, pricebook, invoices and payments, so DWRG never depends on API goodwill.

## How the sync works (when the API is allowed)

- **Webhooks:** not practical today (beta, account-gated). We **poll** ServiceTitan's `/export` feeds. They use continuation tokens, return active, inactive and deleted rows, and run about 15 minutes behind unless `includeRecentChanges=true`.
- **Rate limit:** 600 calls per 10 seconds per app per tenant. Our plan uses about 400 calls an hour. The first backfill is throttled too, so we stay well within the bulk-extraction clause.
- **Polling schedule:**
  - Every 5 minutes: jobs, appointments, appointment assignments, job history, invoices, invoice items, payments, estimates, customers, locations, contacts, memberships, membership status changes, recurring-service events, job splits, timesheets, payroll adjustments, purchase orders and receipts, calls, bookings, leads.
  - Hourly: pricebook, technicians, employees, business units, tag types, membership and recurring-service types, installed equipment.
  - Nightly (full pull or `modifiedOnOrAfter`): job types, campaigns, zones, arrival windows, shifts, payment types, tax zones.
  - Weekly: re-pull customers, locations and contacts to catch merges, un-merges and deletes.
  - Monthly: full re-baseline of every feed.
- **Storage:**
  - Each feed has a `st_sync_cursor` row (token, last run, last error).
  - Raw JSON lands in `st_raw_*` tables keyed by ServiceTitan ID and `modifiedOn`.
  - Mapping into our core tables is idempotent.
  - Money in invoice items arrives as decimal strings and is parsed straight to integer cents (CLAUDE.md rule 1).
- **Nightly reconciliation:** counts and dollar totals per business unit per day, compared with ServiceTitan's Reporting API. Any drift raises an alert.
- **If the API is ever cut off,** the new system keeps working on its last mirrored copy.

## The stages

| Stage | New system owns | ServiceTitan owns | Sync |
|---|---|---|---|
| **1. Mirror, reports and pay** | Reports, Profit Ladder commission, tech scoreboard, payroll sheet, office spiffs | Everything operational: booking, dispatch, field app, invoices, payments, memberships, pricebook, phones, QuickBooks posting | ServiceTitan → new only |
| **2. Booking and dispatch** | New customers, locations and contacts; jobs; appointments; tech assignment, including AI auto-assign | Job execution (dispatched, working, done), timesheets, estimates, invoices, payments, memberships, pricebook, phones, QuickBooks posting | New → ServiceTitan writes within seconds. Execution data comes back every 1–2 minutes |
| **3. Field, invoices and payments** | Everything for business units (or crews) that have moved | Everything for business units not yet moved | Mirror continues for the rest |
| **4. Phones and switch-off** | Everything, including phones (Twilio) | Read-only until the contract ends | Final full export, then disconnect |

### Stage 1: Mirror, reports and pay (no risk to operations)

- Techs keep working in the ServiceTitan mobile app. Our scoreboard is a **second icon** on their iPads.
- Gross profit inputs come from the mirror:
  - invoice items (price, cost, total cost, sold hours)
  - job splits
  - timesheets (labor)
  - estimates (sold by)
  - purchase orders
- Office spiffs come from the calls and bookings feeds.
- **Set the ladder from real history:** replay the last 12 months of mirrored jobs through the engine. The owners review what the plan would have cost and where each tech lands, then set the final ladder steps before the plan is signed.
- **Shadow-run 2–4 pay weeks:** the engine's numbers are checked against a hand calculation before anyone is paid from them.
- If a ServiceTitan invoice changes after pay was calculated, the engine writes **correction lines**, never edits (CLAUDE.md rule 3).
- This is how the **Profit Ladder can go live in about month 3**, long before the rest of the system is done.

### Stage 2: Booking and dispatch move over

- CSRs book in the new system, and the AI assigns the tech. The new system writes back to ServiceTitan:
  - customers and locations (`Customers_Create`, `Locations_Create`)
  - jobs (`Jobs_Create`, with appointments, technician IDs, business unit, job type and campaign)
  - schedule changes: reschedule, assign/unassign technicians, cancel, hold
- Techs still run the job in the ServiceTitan mobile app. So ServiceTitan still produces the invoices, payments and timesheets and still posts to QuickBooks.
- **Who wins a conflict:**
  - Schedule fields: the new system wins.
  - Status and money fields: ServiceTitan wins.
  - Customer contact fields: last writer wins, with an alert on every conflict.
  - Merges happen only in ServiceTitan (there is no merge API) and are copied across through `mergedToId`.
  - Nobody edits the schedule in ServiceTitan. Restrict it with ServiceTitan user roles where possible (*verify*).
- **No echo loops:** every record we write carries our ID in ServiceTitan's `externalData`. Inbound changes stamped as ours, with unchanged content, are ignored.
- **Phones stay on Phones Pro during stage 2.** ServiceTitan can't create calls through the API, so moving phones early would break its call and campaign tracking. Set `campaignId` on every job we create. Evaluate the Marketing Ads attribution endpoints (*verify*).
- **Truck GPS trackers** feed our board. ServiceTitan's board keeps using its own mobile-app GPS.

### Stage 3: Field, invoices and payments, one business unit at a time

This has to be a **hard switch** per business unit or crew. The API can't set appointment or tech statuses, and the public spec has no endpoint to create payments, so one job can't run half in each system.

For each business unit:

1. Stop creating ServiceTitan jobs for that business unit.
2. Its techs switch to our iPad app.
3. From then on the new system owns that unit's jobs, estimates, invoices, Stripe payments and memberships, and posts its own invoices to QuickBooks.
4. **Each invoice is posted to QuickBooks only by the system that created it,** matched to the existing QuickBooks customer, so nothing is ever double-posted.
5. Memberships move when their payments move. ServiceTitan bills members with stored cards, so members re-enter a card through a Stripe link at renewal (*verify* whether stored cards can transfer).
6. The pricebook moves to the new system when the first crew moves. Optionally push price changes back to ServiceTitan while other crews remain.

Suggested order (owners decide):

1. One pilot crew
2. Plumbing
3. HVAC service
4. HVAC replacement
5. Commercial and refrigeration
6. New construction

### Stage 4: Phones and switch-off

- Port the phone numbers to Twilio (ports can take weeks, so start early in this stage).
- Final full export. ServiceTitan stays read-only for lookups until the contract ends.
- Keep the raw exports permanently, subject to the written permission in stage 0.

## Fallback: report-export mode (if the API isn't available or allowed)

- The office downloads ServiceTitan report exports (customers, memberships, invoices with items, payments, technicians, timesheets) and drops them into an import page. Nightly or weekly; scheduled report emails, if available, *verify*.
- **Stage 1 still works.** The scoreboard updates daily instead of live.
- **Stage 2 is skipped,** because there are no write-backs.
- **Stage 3 still works** one business unit at a time. Each business unit lives fully in one system, so nothing has to be written back.

## Risks, most serious first

1. **Contract terms.** ServiceTitan can suspend immediately or terminate on 30 days' notice. Mitigation: written permission, CSV backups, and a design that keeps working on the last mirrored data.
2. **Cost of running both systems** with no end date. The full ServiceTitan subscription continues, possibly on a higher package to get API access.
3. **Write gaps** (statuses, payments, merges) force a hard switch per business unit in stage 3.
4. **Drift and double entry:** export lag, duplicate rows, merges and deletes, staff editing in the wrong system. Mitigation: ownership per field, `externalData` stamps, nightly reconciliation and alerts.
5. **Double posting to QuickBooks** once both systems create invoices. Rule: only the system that created an invoice posts it.
6. **Pay correctness** when ServiceTitan invoices are edited after pay has run. Mitigation: correction lines plus the worked-example tests.
7. **Unannounced API changes.** Mitigation: contract tests against ServiceTitan's integration environment and tolerant parsing.

## Still to verify after logging in to the developer portal

- Private API list: payment creation and webhook events may exist there.
- Export page sizes, token expiry and how deletes appear in each feed.
- Whether API-created records carry an identifiable user.
- Whether ServiceTitan roles can block schedule edits.
- Whether stored member cards can move to Stripe.
- How ServiceTitan's QuickBooks sync behaves when another system posts to the same QuickBooks company.
