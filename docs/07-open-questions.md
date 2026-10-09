# Open Questions

Each question says why it matters. Answered questions are kept at the bottom with the decision, so the reasoning isn't lost.

## Needed now

1. **Tracking policy for employees.** Location only while clocked in (Start day to End day)? Who can see it? We'll show techs a notice in the app. The owners should decide this.

## Needed by the pilot (about month 6)

2. **Export one of each ServiceTitan report** so the importer's column mappings match your real files: customers and locations, installed equipment, memberships, pricebook, technicians, invoices with line items and costs, payments, and timesheets. Until then we build on demo data.
3. **Which two techs and which CSR/dispatcher are the pilot crew?** (Names only; the crew size is decided.)
4. **Skills matrix: which techs do HVAC, plumbing, refrigeration and commercial, and which certifications or licenses does each hold?** The AI uses this to decide who can take a job.
5. **How are after-hours and emergency calls handled today (on-call rotation, after-hours fee, who answers)?** Affects booking rules.
6. **Who besides techs sells replacements (which roles)?** Needed to track the lead source for the $150 lead bonus.
7. **How does ServiceTitan tax invoices today: which items are taxable, and at what rates?** North Carolina treats repair/maintenance work and capital improvements differently for sales tax. We'll copy the current setup and have the CPA confirm it.
8. **Which GreenSky plans do you offer?** Needed to show estimated monthly payments on proposals.
9. **Which suppliers do you buy from, and do they offer online ordering or price files?** Affects purchase orders and costs.
10. **Is 10% the right discount limit before a manager must approve?**
11. **Are the two combos the right bundles?** They are Clean Air (UV + surge + membership) and Water Guard (leak shut-off + filter or softener + membership). Any other add-ons to push, such as smart thermostats or water heater flushes?
12. **Do you want card-present payments before the App Store version exists?** If yes: a Stripe S700 smart reader ($299 per truck, no monthly fee) on each iPad's Personal Hotspot. Check that the carrier plans include hotspot.

## Needed by the switch

13. **All at once, or one business unit at a time?**
14. **How many phone numbers are on Phones Pro, including any call-tracking numbers used for advertising?** All of them have to be ported.

## Later (phase 2)

15. **What platform is the website on?** Matters for online booking and the portal link.

## Pay plan details (needed before the pay plan rolls out)

Building the engine turned up places where [02](02-commission-plan.md) can be read two ways. The engine uses the reading in *italics* for now, and its tests pin that reading, so changing it is a small, tested change. The owners (and the CPA where noted) should confirm each before rollout.

16. **Can one membership complete both combos?** An invoice with a UV light, surge protector, leak shut-off valve, water filter and one membership: does it pay both combo bonuses? *Currently yes: both pay ($150 in combo bonuses).*
17. **Can a refund deduction be bigger than the commission paid on the job?** *Currently no: it is capped at the commission still standing on the job.* Example 1 fully refunded deducts $62, not $85.
18. **Does the review spiff wait until the job's invoice is paid in full?** Other spiffs do; a review isn't on an invoice. *Currently it pays once the office verifies the review.*
19. **The 30-day callback window ends on which date: when the callback is booked, or when it's run?** *Currently the booking date, and day 30 counts.*
20. **The $50 cost-change threshold: per change, or the total change since the commission was settled?** *Currently the total, so several small late bills add up.*
21. **Rounding a negative half cent: away from zero (−$6.18) or in the employee's favor (−$6.17)?** It only matters for deduction lines that land on exactly half a cent. *Currently away from zero.*
22. **For the CPA, with the overtime method in section 9:** callback and refund deductions don't lower the commission counted in that week's overtime adjustment, but negative cost adjustments do. *That's the current behavior.*

## Answered

| Question | Decision |
|---|---|
| ServiceTitan renewal date | Doesn't matter. ServiceTitan keeps running while we build; a pilot crew proves the new system; then everyone switches ([06](06-servicetitan-migration.md)). |
| ServiceTitan API | **No API.** Data comes over through report exports uploaded on the Import page, so no API package upgrade and no permission request ([06](06-servicetitan-migration.md)). |
| Commission plan legal review | Handled by the owners' CPA. |
| When the pay plan starts | After the switch, once the system is fully operational and tested. Until then: history replay to set the ladder, and practice mode on the pilot crew's jobs ([02](02-commission-plan.md#9a-when-the-plan-starts-owner-decision)). |
| Tech iPads | iPad (A16) Wi-Fi + Cellular: built-in GPS, web push. Tap to Pay is not possible on any iPad. |
| Truck GPS | iPad GPS for now (owner decision): dash mount and charger per truck; Spytec plug-in trackers only if the pilot shows gaps. |
| Real data vs demo data | Build and test on demo data for now; real ServiceTitan exports come later, before the pilot. |
| Pilot crew | Two techs and one CSR/dispatcher (one person doing both). |
| Replacement-likely calls | Go to the strongest replacement closer who can make the window; fair share applies to other calls ([01](01-operations.md#how-the-ai-picks-a-tech)). |
| Burdened labor cost | Wage × 1.30, a dated setting that can be overridden per worker ([02](02-commission-plan.md)). |
| Membership plan | Keep as drafted: one yearly plan, about $150–$250, two tune-ups, member pricing. The exact price and discount come from the plan in ServiceTitan when it's imported. |
