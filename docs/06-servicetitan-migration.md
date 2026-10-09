# ServiceTitan Migration

Goal: every customer, location, piece of equipment, membership, pricebook item and the job/invoice history moves into the new system, and the totals match ServiceTitan before we trust them.

## 1. Get access (week 1)

- Request API credentials through ServiceTitan's developer portal. Connecting requires a developer account plus a client ID and secret, an app ID and key, and the tenant ID.
- Ask the account manager in writing: what data access remains after the contract ends, and whether a full export is offered on exit.
- Pull **report exports (CSV)** for customers, memberships, pricebook, invoices and payments now, as a backup and as the "truth" for reconciliation.

## 2. Export

`tools/st-import` writes raw JSON per entity, paginated, with retries, into a dated folder (never edited by hand):

- Customers, locations, contacts
- Equipment (installed equipment per location)
- Memberships and recurring services (start/end, visits remaining)
- Pricebook: categories, services, materials, equipment, images, member pricing, costs
- Technicians and business units
- Jobs and appointments (history)
- Estimates (including open ones)
- Invoices and invoice items, payments, open balances
- Attachments (photos, signed documents), which may need separate calls

Run the export **monthly from month 1** so the data is never stranded.

## 3. Load

- Import is **idempotent**: every row keeps `st_id`; re-running updates instead of duplicating.
- Map ServiceTitan business units to ours: HVAC service, HVAC replacement, plumbing, commercial and refrigeration, new construction.
- Historical invoices import as closed, read-only history (they don't re-sync to QuickBooks, which already has them).
- Open balances import as open invoices so collections continue.

## 4. Prove it

Reconciliation report, per year and per business unit:

- Counts: customers, locations, equipment, active memberships, jobs, invoices.
- Dollars: invoice totals, payments, open balances.
- Every difference is explained or fixed before go-live.

## 5. Replay pay

- Run the last 12 months of jobs through the commission engine using imported costs and hours.
- Owners review: what the plan would have cost, how many techs land at each level, and whether the ladder steps need adjusting.
- Set the final ladder in settings before the plan is signed.

## 6. Final sync and cutover (month 6)

- Delta export of everything changed since the last export; import; reconcile again.
- Phone numbers ported; everyone moves.
- ServiceTitan stays read-only for lookups until the contract ends. Keep the raw exports permanently.
