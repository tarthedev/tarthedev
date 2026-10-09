# Running Side by Side with ServiceTitan: Prove It, Then Switch

**Owner decisions (October 2026):**

- The ServiceTitan renewal date is not a deadline.
- **No ServiceTitan API.** Data comes over through ServiceTitan's own report exports. That avoids the API package requirement (The Works or Enterprise Plus) and the API terms that restrict migration apps.
- Running side by side is only about **proving the new system works** before everyone moves. ServiceTitan keeps running the business until then.

## The idea in one paragraph

ServiceTitan keeps doing everything while we build. We load ServiceTitan's data into the new system from report exports and refresh it regularly. When the new system is ready, one **pilot crew** runs all of its work in it, end to end, while everyone else stays on ServiceTitan. When the pilot has proven itself, everyone switches, the phones move, and ServiceTitan goes read-only until the contract ends.

## Getting the data in: report exports

ServiceTitan reports export to CSV or Excel. `tools/st-import` reads them through an **Import** page in the office app:

- Upload the file.
- Pick the report type (or let it be detected from the columns).
- Preview the rows.
- Import.

| Export | Used for | How often |
|---|---|---|
| Customers and locations (with contacts) | Customer files, screen lookups, history | Full at the start, then weekly until the switch |
| Installed equipment | Equipment ages, replacement flags | Full at the start, then weekly |
| Memberships (with start/end, visits remaining) | Member status and pricing | Full at the start, then weekly |
| Pricebook (services, materials, equipment, prices, member prices, costs) | Our pricebook | Full at the start; again before the pilot and the switch |
| Technicians and business units | Users, skills, departments | Once, then when staff change |
| Jobs and invoices with line items (and costs), payments | History, reports, replaying the pay plan to set the ladder | Full history at the start (as many years as the reports allow), refreshed before the pilot |
| Timesheets / job time | Labor in the 12-month pay replay | With the history import |
| Open invoices and balances | Collections after the switch | At the switch |
| Future appointments | Jobs already booked past the switch date | At the switch |

Import rules:

- **Idempotent.** Every row keeps its ServiceTitan ID (customer ID, location ID, job number, invoice number), so re-importing updates rows instead of duplicating them.
- **Raw files kept.** Each upload is stored unchanged, with who uploaded it and when.
- **Money parsed straight to integer cents** (CLAUDE.md rule 1).
- **Prove it.** After each import, an import report shows counts and dollar totals per business unit and year next to the totals from ServiceTitan's own summary reports. Differences are explained or fixed.
- **Read-only.** ServiceTitan data is never written back. ServiceTitan only receives what people type into it.

Which exact report names and columns DWRG's ServiceTitan offers gets confirmed in month 1. We export one of each, and the importer is built to match.

## Stages

| Stage | Target | ServiceTitan does | New system does |
|---|---|---|---|
| **1. Build and load** | Months 1–5 | Everything, as today | Imports, reports on imported history, and everything built and tested in a training copy with real customer data |
| **2. Pilot crew** | About month 6 | Everything for all other techs | All work for one pilot crew (2 techs + 1 CSR), end to end |
| **3. Switch** | When the pilot has proven itself (owner decision) | Read-only lookups until the contract ends | Everything |
| **4. Pay plan rollout** | After the switch, once fully operational | Nothing | Practice-mode pay on everyone's jobs for 2–4 weeks, then the Profit Ladder pays |

### The pay plan waits for the switch

Owner decision: the Profit Ladder starts only after the switch, once everything is running and tested ([02-commission-plan.md](02-commission-plan.md#9a-when-the-plan-starts-owner-decision)). Imported history is used to replay the plan and set the ladder steps, never to pay anyone. During the pilot, the engine runs in practice mode on the pilot crew's jobs, and only the office sees it.

### Stage 2: the pilot crew

The pilot crew runs **everything** in the new system: the booking screen, the dispatch board, the iPad app, Good/Better/Best, invoices, Stripe payments and posting to QuickBooks. Their pay stays as it is today; the commission engine runs in practice mode on their jobs. Everyone else stays on ServiceTitan. A job lives in exactly one system; `system_of_record` says which system owns each crew.

Rules while both run:

- **Phones stay on Phones Pro.** CSRs book pilot-crew jobs in the new system and everyone else's in ServiceTitan. The caller's file opens in the new system by phone-number search.
- **QuickBooks: each system posts only its own invoices.** ServiceTitan keeps posting its invoices. The new system posts only the pilot crew's, matched to the existing QuickBooks customer, with a review list for possible duplicates.
- **New customers.** A customer first created for the pilot crew lives in the new system. If ServiceTitan also needs them later (booked to a non-pilot tech), the CSR adds them there too. This is the only double entry, and only for new customers.
- **Memberships** stay billed and renewed in ServiceTitan until the switch. If a pilot tech does a member's tune-up, the office marks the visit used in ServiceTitan as well.
- **Pricebook:** imported before the pilot. Price changes during the pilot are made in both systems; there should be few.

**The pilot proves out when:**

- four consecutive weeks have clean bookings, jobs, invoices, payments and QuickBooks postings for the pilot crew
- the practice-mode pay numbers for two weeks match a hand calculation
- the crew and the CSR say it is at least as fast as ServiceTitan

### Stage 3: the switch

All at once, or one business unit at a time if the owners prefer:

1. Final import: customers, equipment, memberships, open invoices and balances, and future appointments, everything changed since the last import.
2. Everyone moves to the new system. Port the phone numbers from Phones Pro to Twilio (start the port a few weeks ahead; ports can take weeks).
3. Memberships move as they renew: members save a card through a Stripe link, because cards stored in ServiceTitan's payment system can't be exported.
4. GreenSky merchant account moved off ServiceTitan's sponsorship (ask GreenSky a month ahead).
5. ServiceTitan stays read-only for lookups until the contract ends. Keep a full set of final exports permanently.

## Risks

| Risk | Plan |
|---|---|
| Exports missing a field we need (e.g., item costs, IDs) | Export one of each report in month 1, before building the importer; check for custom report options in ServiceTitan |
| Import drift (new or changed records between imports) | Weekly re-imports keyed on ServiceTitan IDs; import report with totals; final import at the switch |
| Double posting to QuickBooks | Each system posts only the invoices it created |
| Pilot customers also booked in ServiceTitan | Only new customers need double entry; phone-number search finds existing ones |
| Paying for two systems with no end date | The pilot has a clear pass/fail test; owners review progress monthly |
