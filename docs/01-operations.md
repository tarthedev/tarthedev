# Operations: How the System Works Day to Day

Requirements in plain English, grouped by who uses them. Settings marked *(setting)* are starting values the owners can change.

This page describes the finished system. Until the switch, ServiceTitan still runs everything except the pilot crew's work; see [06-servicetitan-migration.md](06-servicetitan-migration.md).

## 1. Phones (CSRs and dispatchers)

- Calls ring in the browser through Twilio. Existing numbers are **ported from ServiceTitan Phones Pro at the switch**. Until then CSRs answer on Phones Pro and open the caller's file in the new system with a quick search (phone number lookup).
- **Screen pop:** caller ID opens the customer's file: name, service address(es), member status and renewal date, equipment with install year and age, last visit, open balance, notes.
- **Replacement flag** when any system at the location is older than 15 years *(setting)*.
- Calls are recorded. North Carolina is a one-party-consent state (N.C. Gen. Stat. § 15A-287), but the greeting still says calls may be recorded. Recordings are deleted after a retention period *(setting)*.
- Every inbound call is logged automatically. The CSR tags calls that **could not have been booked** (wrong number, vendor or sales call, "where's my tech", existing-job question, outside service area). That tag drives the booking rate.
- Inbound texts from customers land in a shared office inbox on that customer's file.

## 2. Booking

Five steps, about 60 seconds, with the script on screen:

1. **Who and where:** find or add the customer and service location.
2. **What's wrong:** pick from a list (no heat, no cooling, leak, water heater, drain, tune-up, estimate, other). AI reads the notes and tags job type, skills needed, estimated minutes, urgency and replacement likelihood.
3. **How urgent:** emergency, today, or scheduled. Members without heat or cooling go to the front.
4. **Pick a time:** AI suggests the best open arrival windows; CSR confirms one with the customer.
5. **Offer and confirm:** non-members are offered the membership; confirmation text goes out automatically, plus a reminder the day before.

Commercial bookings add: which of the customer's locations, and the customer's PO number when that customer requires one.

## 3. Dispatch board

- One row per tech on a timeline (FullCalendar Premium resource timeline), plus a **Waiting** column for booked-but-unassigned jobs and a **map** view.
- Each job block shows job type and status in words (Scheduled, On the way, Working, Done, Running late), not color alone.
- **AI auto-assigns** new jobs and shows its reasons ("Closest qualified tech, 12 minutes away. Strong on no-cooling calls. Fits the 10–12 window.").
- Dispatcher can drag any job; the dispatcher's move always wins. Each override asks for a one-tap reason: customer request, tech skill, tech running behind, traffic or distance, part availability, other.
- Moving a customer who was already told a time needs the dispatcher's one-tap OK.
- If the AI is unsure (low confidence), the job stays in Waiting and the dispatcher is pinged.
- Alerts: tech running late (send customer a new ETA after one-tap OK), job over its estimated time, emergency booked (AI proposes who to pull), tech idle.
- Tech locations come from the **iPads' built-in GPS** while our app is on screen (owner decision for now: the easiest option, nothing to buy; see [03-tech-stack.md](03-tech-stack.md#truck-gps)). Each truck has a dash mount and charger. When an iPad's screen locks or another app is in front, the board shows **"GPS paused since …"**; if pings stop with no notice, the tech shows as **stale**. Dispatch and ETAs fall back to job addresses and statuses, so nothing breaks.

### How the AI picks a tech

Hard rules first, then a weighted score. Details in [03-tech-stack.md](03-tech-stack.md#ai-dispatch).

| Step | What it checks |
|---|---|
| Can do the job | Skills: HVAC, plumbing, refrigeration, commercial |
| Makes the window | Shift hours and real drive time fit the promised window |
| Shortest drive | Drive minutes from the previous job |
| Strong on this call | Tech's gross profit and close rate on this job type, last 90 days |
| Fair share | On ordinary calls, evens out high-value work so every tech can climb the ladder |
| Customer's pick | A requested tech goes first |

**Replacement-likely calls go to the strongest closer (owner decision).** When the AI tags a call as a likely replacement (system over 15 years old *(setting)*, an estimate request, or notes that point to a failing system), it ranks the techs who can make the window by their replacement record over the last 180 days *(setting)*: replacement close rate × average replacement gross profit. The best-ranked tech gets the call; if they can't make the window, the next best does. Fair share does not apply to these calls. Every other call uses the normal score, where fair share applies.

The owners see a weekly report of high-value calls per tech, because pay depends on the calls each tech gets. Top closers will earn more under this rule, which is intended.

## 4. Tech iPad app

Runs on the techs' **iPad (A16) Wi-Fi + Cellular**, installed from Safari with **Add to Home Screen** (full screen, own icon). Signatures by finger or Apple Pencil (USB-C).

Before the switch only the pilot crew uses this app; everyone else stays on ServiceTitan. The **scoreboard** turns on when the pay plan rolls out after the switch.

- **Scoreboard** first: this week's gross profit, level and rate, distance to the next level, commission so far, bonuses, jobs waiting on customer payment. Tap any number to see the jobs behind it.
- **Day view:** today's jobs in order with address, window, job type, notes and member status.
- **On My Way:** starts the job clock and sends the customer a text with the tech's photo and an ETA link.
- **Job screen:** customer and equipment history, previous invoices, photos, notes.
- **Checklist** per job type. HVAC visits always include UV light, surge protection and indoor air quality, each marked **offered** or **declined**.
- **Photos** are required before quoting a replacement or major repair.
- **Proposal builder:** Good/Better/Best from pricebook templates, member and regular prices, GreenSky monthly payment estimates and apply link. Customer signs on the iPad.
- **Live job profit** shown before the tech applies a discount. Discounts over 10% *(setting)* need a manager's approval.
- **Invoice and payment:** text-to-pay link or typed card (Stripe), cash or check logged.
- **Done:** stops the job clock; review request goes out after payment.
- **Timesheet:** clock in/out for the day; job time comes from On My Way → Done.
- Push notifications for new or changed jobs (iPadOS 16.4+ with the app installed), with a text fallback for emergencies.

## 5. Pricebook and sales

- Imported from ServiceTitan: categories, services (tasks), materials, equipment, prices, member prices, costs, estimated hours, images.
- Each item can carry a **spiff** and belong to **combo** rules (see the commission plan).
- **Proposal templates** for common jobs (AC replacement, furnace replacement, water heater, UV and air quality bundles) with Good/Better/Best options.
- GreenSky: proposals show estimated monthly payments for the plans we offer and a link to apply. GreenSky has no public developer API, so the office records approval and funding in the job; the dealer fee is entered as a job cost.

## 6. Invoices and payments

| Method | Best for | Fee to us |
|---|---|---|
| Text-to-pay link (Stripe) | Most home visits | 2.9% + 30¢ |
| Card typed on iPad (Stripe Payment Element) | Customer hands over a card | 2.9% + 30¢ expected (Stripe's 3.4% + 30¢ manual-entry rate applies to cards keyed in its Dashboard; confirm with Stripe) |
| Optional: Stripe smart reader (S700, $299, no monthly fee) driven by our server, on the iPad's Personal Hotspot | Customers who want to tap or insert a card | 2.7% + 5¢ |
| ACH bank payment (Stripe) | Commercial, big tickets | 0.8%, max $5 |
| GreenSky financing | Systems and big repairs | Dealer fee (varies by plan) |
| Check or cash | Anyone who prefers it | None |

- Card fees and dealer fees are job costs, so they reduce gross profit.
- Never key cards into the Stripe Dashboard app (3.4% + 30¢, and it would give techs access to payouts).
- Tap to Pay is not possible on any iPad. Card-present options are the optional smart reader now, or a $59 Bluetooth reader once the App Store wrapper exists (phase 2).
- Sales tax is calculated per item and pushed to QuickBooks. We copy ServiceTitan's current tax setup (see open questions).
- Reminders for unpaid invoices at 3, 7 and 14 days *(setting)*.
- **Customer portal** (one-time link by text or email, no password): invoices, payments, membership, equipment, upcoming visits.

## 7. Memberships

- One yearly plan: two tune-ups (spring cooling, fall heating) and member pricing.
- Imported from ServiceTitan with start dates and remaining visits.
- Renewal reminders 30 days before the end date. **Auto-renew** only when the customer saved a card with Stripe and agreed to it.
- Each spring and fall, the system builds a list of members due, grouped by area, and suggests days that cluster nearby homes.

## 8. Commercial and new construction

- **Purchase orders:** store the customer's PO number; customers flagged "PO required" can't be invoiced without one.
- **Terms:** net-30 (or other) due dates, monthly statements, automatic reminders.
- **Many locations:** one bill-to customer with many sites, each with its own equipment and memberships.
- **Progress billing:** stages such as deposit, rough-in, trim-out, final.
- **Builder bids:** line-item bids that become the job (with billing stages) when won.
- **Aging report:** current, 30, 60, 90+ days by customer.
- Commercial and new construction are separate departments in reports.

## 9. Inventory and purchasing

- Stock locations: warehouse and each truck.
- Parts used on a job come off the truck's stock and onto the job's costs.
- Nightly **restock list** per truck.
- **Purchase orders** to suppliers, received against jobs or stock; supplier bills sync to QuickBooks as bills.
- If month 5 runs short, inventory launches as restock lists only and full counts follow.

## 10. Reports

- **Every day:** board status, revenue, gross profit, cash collected, jobs late or over time.
- **Every week:** tech scoreboard (gross profit, average ticket, close rate, UV and add-on attach rate, memberships sold, callbacks), commission and payroll sheet, CSR booking rate, high-value calls per tech.
- **Every month:** P&L by department (HVAC service, HVAC replacement, plumbing, commercial and refrigeration, new construction), members and renewal rate, aging.
- Department P&L combines job gross profit from our database with overhead pulled from QuickBooks (Reports API), so the bottom line matches the books. Departments map to QuickBooks **classes**.

Definitions: **close rate** = proposals presented that turned into a sale. **UV attach rate** = UV lights sold ÷ HVAC visits.
