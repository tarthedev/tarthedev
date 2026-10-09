# DWRG Platform: Overview

Plain-English summary of what we are building, for whom, and why. Every other file in `docs/` goes deeper on one part of this page.

## The business

- **DWRG Heating & Cooling** (Doug Williams / Rick Gilbert), Elizabeth City, NC.
- Work types, **all on day one**: residential HVAC service and replacement, residential plumbing, commercial HVAC and refrigeration, new construction.
- 6–15 field staff. Service techs are paid **hourly today** (about $18–$24/hr) with no commission yet.
- Average service/repair ticket: **$700–$1,000**.
- Runs on **ServiceTitan** today, including ServiceTitan Payments and Phones Pro. **No hard cutover date:** both systems run side by side and work moves over in stages (owner decision).
- Techs carry **iPad (A16) Wi-Fi + Cellular** tablets: built-in GPS, Home Screen web push, current iPadOS.
- Books: **QuickBooks Online** and **QuickBooks Online Payroll**, weekly payroll.
- Pricing: flat-rate pricebook in ServiceTitan (we import it).
- Memberships: one yearly plan, about $150–$250, two tune-ups.
- Financing: **GreenSky**.
- Cell signal is solid across the service area, so the app is online-first.

## The goal

Our own ServiceTitan-style system, built around **gross profit**:

1. Maximize profit per job, with special focus on UV lights, air quality and other add-ons.
2. Pay techs a share of the gross profit they produce, on a ladder that rewards hitting weekly goals, plus spiffs and combo bonuses.
3. Make the pay plan simple enough to explain to a five-year-old, and show it live on the tech's iPad.
4. Move off ServiceTitan in stages, running both side by side, without disrupting daily work.

## The eleven parts

| Part | What it does | Replaces in ServiceTitan |
|---|---|---|
| Phones | Browser phone (Twilio), caller's file pops up, call recording, call tagging | Phones Pro |
| Booking | 60-second booking screen with script and membership offer | Call booking |
| Dispatch board | Live calendar per tech, map, Waiting area, **AI auto-assign with dispatcher override** | Dispatch board, Dispatch Pro |
| Tech iPad app | Safari "Add to Home Screen" app: jobs, history, checklists, photos, signatures, arrival texts | Field mobile app |
| Pricebook and sales | Flat-rate prices, Good/Better/Best proposals, GreenSky monthly payments | Pricebook, proposals |
| Invoices and payments | Text-to-pay links, typed card, ACH, net-30, progress billing (Stripe) | ServiceTitan Payments |
| Memberships | Yearly plans, renewals, auto-renew, tune-up season lists | Memberships |
| Inventory and POs | Truck stock, restock lists, purchase orders to suppliers | Inventory, purchasing |
| Pay and commission | Live scoreboard, weekly commission, payroll sheet | Performance pay |
| Customer experience | "On my way" text with tech photo and live ETA, review requests, customer portal | Customer texts, portal |
| Reports and QuickBooks | Job, tech and department gross profit; P&L; QuickBooks sync | Reporting, accounting sync |

Also in the first release: **GPS trackers in every truck** (Bouncie, or Teltonika + Traccar as the runner-up) feeding the dispatch map and customer ETAs.

Deliberately **after ServiceTitan is off** (phase 2): AI phone receptionist, online booking on the website, an App Store wrapper that adds a Bluetooth card reader (Stripe M2) and locked-screen GPS, marketing campaigns, pricing insights. Tap to Pay is not possible on any iPad (Apple supports it on iPhone only).

## One job, start to finish

1. Call comes in on the browser phone; the customer's file pops up.
2. CSR books it in about 60 seconds using the on-screen script.
3. AI assigns the best tech (skills, window, drive time, results on this kind of call, fair share, customer preference) and explains why.
4. Customer gets a confirmation text and a reminder the day before.
5. Tech taps **On My Way**; customer gets a text with the tech's photo and a live ETA link.
6. Tech diagnoses on the iPad with history, equipment ages and a checklist that always asks about UV, surge protection and air quality.
7. Tech presents Good/Better/Best with GreenSky monthly payments; customer signs on the iPad.
8. Invoice and payment on the spot (text-to-pay link or typed card).
9. Review request goes out after payment; the job's gross profit and spiffs land on the tech's scoreboard.
10. Invoice and payment sync to QuickBooks; reports update.

## Where the extra profit comes from

- Good/Better/Best on every call.
- Add-on prompts the tech must answer (offered or declined).
- Member price shown beside the regular price on every invoice.
- Live gross profit on the iPad, so techs see the cost of a discount before giving it.
- The right tech on the right call.
- The 30-day callback rule, so doing it right the first time pays.

## Pay plan in one paragraph

Techs keep their hourly pay. On top, they earn a percentage of the **gross profit** of the jobs they finish each week (sale minus parts, labor and all other job costs). The percentage depends on the week's total: Starter 5% (under $3,000), Bronze 8% ($3,000+), Silver 10% ($4,500+), Gold 12% ($6,000+), Platinum 14% ($8,000+). The level reached applies to **the whole week**. Each job's commission is paid once the customer pays in full; a tech-caused callback within 30 days takes that job's commission back. Spiffs and combo bonuses pay on top. CSRs and dispatchers earn spiffs for booked sales, memberships and booking rate. Full rules: [02-commission-plan.md](02-commission-plan.md).

## Running cost

About **$280–$565 a month** once everything is live: hosting, phones and texting, email, maps, AI, the calendar license and truck GPS trackers, against a $200–$600 budget. Card fees and GreenSky dealer fees are extra (paid today too). While both systems run, the ServiceTitan subscription continues on top. Breakdown in [03-tech-stack.md](03-tech-stack.md).

## Timeline

No hard deadline. ServiceTitan keeps running while work moves over in stages ([06-servicetitan-migration.md](06-servicetitan-migration.md), [04-build-plan.md](04-build-plan.md)):

| Stage | Target | What moves |
|---|---|---|
| 0. Ask and connect | Weeks 1–3 | Confirm ServiceTitan API access (package and written permission) or pick the report-export fallback |
| 1. Mirror, reports and pay | About month 3 | Reports, the Profit Ladder and scoreboards run on ServiceTitan data; techs keep the ServiceTitan app |
| 2. Booking and dispatch | About month 6 | Booking, dispatch board, AI auto-assign, truck GPS; jobs are written back to ServiceTitan |
| 3. Field, invoices, payments | Pilot crew from about month 8 | One business unit at a time switches fully to our iPad app, Stripe and memberships |
| 4. Phones and switch-off | When the last unit has moved | Twilio phones; ServiceTitan read-only, then off |

The pay plan doesn't wait for the rest: it can go live in stage 1, on ServiceTitan's data.

## Files in this folder

| File | What's in it |
|---|---|
| [01-operations.md](01-operations.md) | How booking, dispatch, field work, sales, invoicing, memberships, commercial and reports work |
| [02-commission-plan.md](02-commission-plan.md) | Exact pay rules, edge cases, worked examples (these become tests) |
| [03-tech-stack.md](03-tech-stack.md) | Technology choices, architecture, integrations, iPad limits, costs |
| [04-build-plan.md](04-build-plan.md) | Month-by-month tasks, exit tests, outside paperwork, risks |
| [05-data-model.md](05-data-model.md) | Tables and key fields |
| [06-servicetitan-migration.md](06-servicetitan-migration.md) | Running side by side with ServiceTitan: stages, sync, permission, fallback |
| [07-open-questions.md](07-open-questions.md) | Questions still to answer before or during the build |
