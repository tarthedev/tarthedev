# Commission Plan: "The Profit Ladder"

This is the source of truth for pay. The commission engine (`packages/core`) implements exactly this, and every worked example at the bottom is a test that must pass to the cent.

All dollar amounts and percentages are **starting values** stored in settings with effective dates. Changing a setting never rewrites history. Before launch, the ladder steps are tuned by replaying 12 months of ServiceTitan history imported from report exports. The plan starts after the switch (section 9a).

> **Before launch:** the owners' CPA reviews this plan (handled by the owners), and every employee signs the written plan, including the callback deduction authorization. This document is a design spec, not legal advice.

## 1. Who is on the plan

| Role | Base pay | Earns |
|---|---|---|
| Service techs (HVAC and plumbing) | Hourly, unchanged | Profit Ladder commission, item spiffs, combo bonuses, membership spiffs, review spiffs, lead bonus |
| CSRs and dispatchers who take calls | Hourly, unchanged | Booking spiffs, membership spiffs, booking-rate bonus |
| Installers | Hourly, unchanged | Nothing new (their time counts as labor on the install's gross profit) |
| Owners and managers who sell replacements | n/a | Not on the plan; the tech who turned over the lead gets the lead bonus |

## 2. Definitions

- **Pay week:** Monday 00:00 through Sunday 23:59, America/New_York.
- **Finished:** the job's status becomes Done (tech taps Done). The office can correct the date with a logged reason.
- **Sale:** invoice subtotal after all discounts (member pricing counts as a discount), **excluding sales tax**.
- **Parts and equipment:** actual cost of everything used on the job: truck stock at stock cost, PO items at bill cost (pricebook cost until the bill arrives).
- **Labor:** for every worker on the job (techs and installers), clocked time from **On My Way** to **Done** × that worker's **burdened hourly cost** = wage × **1.30** (30% for employer payroll taxes, workers' comp and benefits; owner decision, stored as a setting with an effective date and overridable per worker). Example used in the decks: $21 wage → $27.30/hr, shown rounded as $27.
- **Other job costs:** permits, GreenSky dealer fees, card and ACH processing fees, subcontractor bills, equipment rental, disposal fees.
- **Gross profit (GP):** Sale − Parts and equipment − Labor − Other job costs. Can be negative.
- **Paid in full:** invoice balance is $0. For financed jobs, when GreenSky funds.

## 3. Who gets credit for a job's GP

- **Default:** the job's GP is split among the techs on it **in proportion to their clocked time** on the job. A manager can set a different split with a reason.
- **Replacement sold by a tech:** 100% of the install job's GP goes to the tech who sold it (the "sold by" tech on the accepted estimate), credited in the week the **install** is finished. Installers' time is labor in that GP.
- **Replacement sold by an owner or manager:** no tech gets GP credit. The tech recorded as **lead source** on the estimate gets the **$150 lead bonus** when the customer pays in full.
- **Callback and warranty visits** (jobs linked to an earlier job as a callback) are **excluded** from every week score. See section 6.

## 4. The ladder

| Level | Week score (GP of jobs finished that week) | Rate |
|---|---|---|
| Starter | $0 – $2,999.99 | 5% |
| Bronze | $3,000 – $4,499.99 | 8% |
| Silver | $4,500 – $5,999.99 | 10% |
| Gold | $6,000 – $7,999.99 | 12% |
| Platinum | $8,000 and up | 14% |

- **Week score** = sum of the tech's credited GP for jobs finished that week, **including negative-GP jobs**. Thresholds are inclusive (exactly $4,500.00 is Silver).
- The week's level and rate **lock Sunday night** (job dates corrected later don't change a locked week unless an owner reopens it, which is logged).
- **The rate applies to all of that week's GP** (whole-week jump, not tax brackets).
- **Commission line per job** = max(0, rate × the tech's credited GP on that job), rounded half-up to the cent. A negative-GP job lowers the week score but never creates a negative commission line, so a week's commission never goes below $0.

## 5. When commission is paid

- A job's commission line becomes **payable** when that job is paid in full. Partial payments pay nothing until the balance is $0.
- Payable lines go on the **next weekly payroll run** after they become payable, at the **rate locked for the week the job was finished**.
- Example: a commercial job finished in week 1 (tech was Gold) and paid on net-30 terms in week 6 pays at 12% in week 6's run.
- If a job's costs change **after** its commission line was paid (late supplier bill, etc.) by more than $50 *(setting)*, the engine adds an adjustment line (positive or negative) on the next run. Smaller changes are ignored.
- **Refunds and chargebacks** after commission was paid create a deduction line for the commission on the refunded amount.

## 6. Callbacks (the 30-day "oops rule")

- A **callback** is a job at the same location for the same problem within **30 days** of the original job's finish date. The dispatcher links it to the original job when booking.
- A manager marks it **tech-caused** or **not tech-caused**, with a reason the tech can see. Examples of not tech-caused: a new part failed from the factory, the customer changed something, a different problem.
- **Tech-caused:** a deduction line equal to the commission on the original job (or the original tech's share of it). If that commission wasn't paid yet, it is cancelled instead.
- Spiffs on the original job stay, unless the item itself was refunded or removed.
- The callback visit itself is excluded from week scores; the tech who runs it is paid hourly.
- Deductions follow NC G.S. 95-25.8: signed written authorization (in the plan every tech signs), the amount shown on the pay sheet **before** payday, and never reducing pay below minimum wage or touching overtime wages. Any amount that can't be taken carries forward to the next run.

## 7. Tech spiffs

Paid on top of commission, when the invoice they're on is paid in full.

| Item sold | Spiff |
|---|---|
| UV light | $50 |
| Air purifier or air scrubber | $50 |
| Whole-home dehumidifier | $75 |
| Surge protector | $20 |
| Whole-home water filter or softener | $75 |
| Leak-detection shut-off valve | $40 |
| Membership sold | $40 |
| 5-star Google review naming the tech | $20 |
| Replacement lead turned over and sold by owner/manager | $150 |

Rules:

- Item spiffs are set on pricebook items (any item can carry one), credited to the tech(s) on the invoice using the same split as GP.
- **Membership spiff:** paid when the membership payment is collected. A membership refunded within 30 days creates a deduction line.
- **Review spiff:** the review must be 5 stars on Google, mention the tech by name, and be posted within 30 days of the visit. The office verifies it in the app before it pays. One per job.

### Combo bonuses

Paid **in addition to** each item's own spiff, once per invoice per combo, when every item in the combo is on the **same invoice**:

| Combo | Items on one invoice | Combo bonus | Total bonuses |
|---|---|---|---|
| Clean Air Combo | UV light + surge protector + membership | $75 | $185 |
| Water Guard Combo | Leak shut-off valve + water filter or softener + membership | $75 | $230 |

Combos are configurable rules (item categories + bonus), so new ones can be added without code changes.

## 8. Office spiffs (CSRs and dispatchers)

Credit goes to the user who **created the booking** (or sold or renewed the membership on the phone).

| What | Pays | Paid when |
|---|---|---|
| Booked a job that becomes a paid invoice with subtotal ≥ $500 | $5 | Invoice paid in full |
| Membership sold on the phone | $15 | Membership paid |
| Membership renewed on the phone | $10 | Renewal paid |
| Weekly booking rate 80% – 89.99% | $50 | That week's payroll |
| Weekly booking rate 90% or better | $100 | That week's payroll |

- **Booking rate** = calls the user booked ÷ bookable calls the user handled that week. Bookable calls = inbound calls answered by the user, minus calls tagged non-bookable.
- Requires at least **30 bookable calls** that week. Managers can see and correct tags (logged).

## 9. Weekly payroll sheet

Produced every Monday for the previous pay week; the office keys it into QuickBooks Online Payroll (Intuit's payroll API is limited to its partner program). Hours also sync to QuickBooks as time activities.

Per employee:

- Regular hours and overtime hours (over 40 in the pay week).
- Commission lines payable this run (each linked to its job).
- Spiffs and bonuses payable this run.
- Deductions (callbacks, refunds), shown before payday.
- **Overtime regular-rate adjustment** (below).
- A plain-English pay sheet the employee can open on their iPad.

### Overtime regular-rate adjustment

Under the FLSA, non-discretionary commissions and spiffs are part of the regular rate for overtime. For each workweek **W** with overtime:

```
adjustment(W) = 0.5 × (commission + spiffs attributable to W) ÷ total hours worked in W × overtime hours in W
```

- Commission lines are attributable to the week the job was **finished**; spiffs to the week of the job or sale; the booking-rate bonus to its own week.
- When lines attributable to an earlier week W are paid in a later run (late customer payment), the engine recomputes adjustment(W) and pays the difference as an "overtime true-up" line.
- Confirm this method with the CPA before launch.

## 9a. When the plan starts (owner decision)

The Profit Ladder starts **after the switch, once the whole system is fully operational and tested**, not before. Until then everyone keeps today's pay.

1. **Month 1 onward:** the engine is built in `packages/core` with every worked example below as a test.
2. **Month 2:** imported ServiceTitan history (invoices with line items and costs, payments, timesheets) is replayed through the engine for the last 12 months. The owners use it to set the final ladder steps. Nobody is paid from this.
3. **Pilot:** the engine runs in **practice mode** on the pilot crew's real jobs in the new system. Only the office sees it. Its numbers are compared with a hand calculation.
4. **After the switch:** practice mode runs for 2–4 weeks on everyone's real jobs. The office and the CPA check it (the CPA review is handled by the owners). Every employee reads and signs the written plan.
5. **Rollout:** the scoreboard turns on in the iPad app and the Profit Ladder pays from the next full pay week.

## 10. Worked examples (golden tests)

Wage $21/hr. The examples pass a burdened cost of exactly **$27.00/hr** as the input, a round number for illustration (the live setting, wage × 1.30, gives $27.30).

1. **One job.** Sale $850, parts $150, labor 2.0 h × $27 = $54, card fee $26 → GP **$620**. Tech is Silver that week → commission **$62.00**.
2. **Example week.** Week score $5,100 → Silver (10%) → commission **$510.00**. Spiffs: 2 UV lights ($100) + 2 memberships ($80) + 1 surge protector ($20) + 1 Clean Air Combo bonus ($75) + 3 reviews ($60) = **$335.00**. Hourly 40 × $21 = **$840.00**. Week total **$1,685.00**.
3. **Threshold jump.** Week score $5,900 → Silver → $590.00. Week score $6,000 → Gold → **$720.00**.
4. **Starter week.** Week score $2,400 → 5% → **$120.00**.
5. **Exact threshold and a negative job.** Jobs with GP $3,200, $1,500 and −$200 → week score $4,500.00 → Silver. Lines: $320.00, $150.00, $0.00 → **$470.00**.
6. **Callback.** Example 1's job pays $62.00 in week 1's run. A tech-caused callback is booked in week 3 → deduction line **−$62.00** in week 3's run.
7. **Not tech-caused callback.** Same as 6 but marked "part failed from factory" → no deduction.
8. **Late commercial payment with overtime.** Job finished in week 1, credited GP $1,000; tech was Gold (12%) in week 1 and worked 45 hours. Customer pays in week 6 → commission **$120.00** in week 6's run, plus overtime true-up for week 1 = 0.5 × ($120 ÷ 45) × 5 = **$6.67**.
9. **Combo.** One invoice with UV light, surge protector and membership → $50 + $20 + $40 + $75 = **$185.00** in bonuses.
10. **Split job.** Two techs on a $1,000-GP job, 3 h and 1 h clocked → credited GP $750 and $250, each at their own week's rate.
11. **Owner-sold replacement.** Tech recorded as lead source; customer pays in full → tech gets **$150.00** lead bonus and no GP credit.
12. **CSR week.** 90 bookable calls, 76 booked → 84.4% → **$50.00**. 25 bookable calls at 92% → **$0** (under the 30-call minimum).

## 11. Explaining it to techs (the five-year-old version)

- Your hourly pay stays the same. Commission is extra.
- Lemonade stand: a cup sells for $1, lemons and sugar cost 30¢, your time costs 20¢, so 50¢ is profit. You get a slice of the profit.
- The more profit you make in a week, the bigger your slice: 5¢, 8¢, 10¢, 12¢ or 14¢ of every profit dollar.
- Reach a new level and **every** profit dollar that week pays the new rate.
- Bonus stickers for UV lights, air quality, memberships and reviews. Combo meals pay an extra prize.
- Money shows up when the customer pays. If we have to go back within 30 days because something was missed, that job's commission comes back.
- The iPad scoreboard shows all of it, live.

The techs' slide deck uses exactly these examples.
