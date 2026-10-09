# Open Questions

Each question says why it matters. Answered questions are kept at the bottom with the decision, so the reasoning isn't lost.

## Needed now

1. **OK to use the iPads' own GPS instead of buying trackers?** It's the easiest option: nothing to buy except a dash mount and charger per truck. The catch: location pauses whenever the screen locks or another app is in front, and the board shows that. Plug-in trackers (Spytec, about $9–$15 per truck per month, free hardware, no contract) are the fallback if the pilot shows gaps. See [03-tech-stack.md](03-tech-stack.md#truck-gps).
2. **Tracking policy for employees.** Location only while clocked in (Start day to End day)? Who can see it? We'll show techs a notice in the app. The owners should decide this.
3. **Export one of each ServiceTitan report** in month 1, so the importer matches your real files. The reports needed are customers and locations, installed equipment, memberships, pricebook, technicians, invoices with line items and costs, payments, and timesheets.

## Needed by the pilot (about month 6)

4. **Who is the pilot crew: which two techs and which CSR?**
5. **Skills matrix: which techs do HVAC, plumbing, refrigeration and commercial, and which certifications or licenses does each hold?** The AI uses this to decide who can take a job.
6. **How are after-hours and emergency calls handled today (on-call rotation, after-hours fee, who answers)?** Affects booking rules.
7. **Who besides techs sells replacements (which roles)?** Needed to track the lead source for the $150 lead bonus.
8. **How does ServiceTitan tax invoices today: which items are taxable, and at what rates?** North Carolina treats repair/maintenance work and capital improvements differently for sales tax. We'll copy the current setup and have the CPA confirm it.
9. **Which GreenSky plans do you offer?** Needed to show estimated monthly payments on proposals.
10. **Which suppliers do you buy from, and do they offer online ordering or price files?** Affects purchase orders and costs.
11. **Is 10% the right discount limit before a manager must approve?**
12. **Are the two combos the right bundles?** They are Clean Air (UV + surge + membership) and Water Guard (leak shut-off + filter or softener + membership). Any other add-ons to push, such as smart thermostats or water heater flushes?
13. **Do you want card-present payments before the App Store version exists?** If yes: a Stripe S700 smart reader ($299 per truck, no monthly fee) on each iPad's Personal Hotspot. Check that the carrier plans include hotspot.

## Needed by the switch

14. **All at once, or one business unit at a time?**
15. **How many phone numbers are on Phones Pro, including any call-tracking numbers used for advertising?** All of them have to be ported.

## Later (phase 2)

16. **What platform is the website on?** Matters for online booking and the portal link.

## Answered

| Question | Decision |
|---|---|
| ServiceTitan renewal date | Doesn't matter. ServiceTitan keeps running while we build; a pilot crew proves the new system; then everyone switches ([06](06-servicetitan-migration.md)). |
| ServiceTitan API | **No API.** Data comes over through report exports uploaded on the Import page, so no API package upgrade and no permission request ([06](06-servicetitan-migration.md)). |
| Commission plan legal review | Handled by the owners' CPA. |
| When the pay plan starts | After the switch, once the system is fully operational and tested. Until then: history replay to set the ladder, and practice mode on the pilot crew's jobs ([02](02-commission-plan.md#9a-when-the-plan-starts-owner-decision)). |
| Tech iPads | iPad (A16) Wi-Fi + Cellular: built-in GPS, web push. Tap to Pay is not possible on any iPad. |
| Truck GPS | Wanted something easier than Bouncie or self-hosted trackers. Recommendation: the iPads' own GPS (question 1 above asks to confirm). |
| Replacement-likely calls | Go to the strongest replacement closer who can make the window; fair share applies to other calls ([01](01-operations.md#how-the-ai-picks-a-tech)). |
| Burdened labor cost | Wage × 1.30, a dated setting that can be overridden per worker ([02](02-commission-plan.md)). |
| Membership plan | Keep as drafted: one yearly plan, about $150–$250, two tune-ups, member pricing. The exact price and discount come from the plan in ServiceTitan when it's imported. |
