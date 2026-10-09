# Open Questions

Each question says why it matters. Answered questions are kept at the bottom with the decision, so the reasoning isn't lost.

## Needed now (they decide how the side-by-side run works)

1. **Which ServiceTitan package are you on: The Works, Enterprise Plus, or something lower?** ServiceTitan only allows customer-built API apps on The Works or Enterprise Plus. If you're on a lower package, we need the upgrade price in writing, or we use the report-export fallback (scoreboard updates daily instead of live, and stage 2 is skipped).
2. **Are you comfortable asking ServiceTitan, in writing, for permission to mirror your data and write bookings back during a gradual move?** As written, their API terms restrict apps whose purpose is moving off ServiceTitan, and restrict keeping copies of the data. A lawyer should read those clauses too. See [06-servicetitan-migration.md](06-servicetitan-migration.md#stage-0-ask-and-connect-weeks-13-before-building-anything).
3. **How many trucks get a GPS tracker, and are their OBD-II ports easy to reach?** This sets the tracker count (cost runs about $50–$125 a month for 6–15 trucks on Bouncie) and whether plug-in trackers work.
4. **Who will email Bouncie for written OK on commercial fleet use?** Their consumer terms forbid "commercial purposes" and cap use at 150 ignition-on hours a month. If they won't confirm, we use Teltonika + Traccar.

## Needed by stage 2 (booking and dispatch, about month 4–6)

5. **Skills matrix: which techs do HVAC, plumbing, refrigeration and commercial, and which certifications or licenses does each hold?** The AI uses this to decide who can take a job.
6. **How are after-hours and emergency calls handled today (on-call rotation, after-hours fee, who answers)?** Affects booking rules and phone routing.
7. **Who besides techs sells replacements (which roles)?** Needed to track the lead source for the $150 lead bonus.

## Needed by stage 3 (field, invoices, payments)

8. **How does ServiceTitan tax invoices today: which items are taxable, and at what rates?** North Carolina treats repair/maintenance work and capital improvements differently for sales tax. We'll copy the current setup and have the CPA confirm it.
9. **Which GreenSky plans do you offer?** Needed to show estimated monthly payments on proposals.
10. **Which suppliers do you buy from, and do they offer online ordering or price files?** Affects how purchase orders and costs flow in.
11. **Is 10% the right discount limit before a manager must approve?**
12. **Are the two combos (Clean Air: UV + surge + membership; Water Guard: leak shut-off + filter or softener + membership) the right bundles? Any other add-ons to push, such as smart thermostats or water heater flushes?**
13. **Do you want card-present payments before the App Store wrapper exists?** If yes: a Stripe S700 smart reader ($299 per truck, no monthly fee) on each iPad's Personal Hotspot. Check that the carrier plans include hotspot.
14. **Which business unit or crew moves first?** Suggested: one pilot crew, then plumbing, HVAC service, HVAC replacement, commercial, new construction.

## Needed by stage 4 (phones)

15. **How many phone numbers are on Phones Pro, including any call-tracking numbers used for advertising?** All of them have to be ported.

## Later (phase 2)

16. **What platform is the website on?** Matters for online booking and the portal link.

## Answered

| Question | Decision |
|---|---|
| ServiceTitan renewal date | Doesn't matter. Run both systems side by side and move work over in stages ([06](06-servicetitan-migration.md)). |
| Truck GPS | Buy new trackers. Bouncie recommended, Teltonika + Traccar runner-up, decided by a two-week pilot ([03](03-tech-stack.md#truck-gps-trackers)). |
| Tech iPads | iPad (A16) Wi-Fi + Cellular: built-in GPS, web push. Tap to Pay is not possible on any iPad. |
| Replacement-likely calls | Go to the strongest replacement closer who can make the window; fair share applies to other calls ([01](01-operations.md#how-the-ai-picks-a-tech)). |
| Burdened labor cost | Wage × 1.30, a dated setting that can be overridden per worker ([02](02-commission-plan.md)). |
| Membership plan | Keep as drafted: one yearly plan, about $150–$250, two tune-ups, member pricing. The exact price and discount come from the plan already set up in ServiceTitan when it's mirrored. |
