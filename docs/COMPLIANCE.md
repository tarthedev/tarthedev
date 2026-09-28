# Calling rules: what the system enforces, and what's on you

This is the plain-English version of why the AI sales rep behaves the way it does. It isn't legal advice. Before you turn the dialer on, spend 30 minutes with a North Carolina attorney who does TCPA work and show them this page. The rules below are current as of September 2026.

## The one rule that shapes everything

In February 2024 the FCC ruled that AI-generated voices count as an "artificial voice" under the Telephone Consumer Protection Act (TCPA). So an AI call is treated like a robocall:

| Who you're calling | Can the AI cold-call them? |
|---|---|
| A **business landline** (or fixed business VoIP line) | **Yes.** The TCPA's artificial-voice consent rules cover cell phones and residential lines, not business landlines. North Carolina's telephone solicitation law (N.C.G.S. 75-101 to 75-105) also only covers residential and wireless subscribers. |
| A **cell phone**, even a business owner's | **No, not without prior express written consent.** A person can still call it; the AI can't. |
| A **residential line** | **No, not without prior express written consent.** |
| Someone who **filled out your website form and checked the box** | **Yes, on the number they gave**, because that checkbox is written consent. |

Penalties are $500 to $1,500 **per call**, and TCPA lawsuits are a whole industry. That's why the gate below has no override button.

## What the software enforces on every AI call

The code is in `voice-platform/src/dialer/compliance.ts`, and each rule has a test in `voice-platform/test/compliance.test.ts`.

1. **Line-type check first.** Every lead's number goes through Twilio Lookup (about $0.008 each), which reports landline, mobile, fixed VoIP, and so on. The AI only cold-calls `landline` and `fixedVoip`. Everything else lands on the **Call yourself** page of the dashboard for you to dial by hand.
2. **Consent for everything else.** Website leads who check the box get a stored consent record: the exact wording, a timestamp, their IP, their browser, and the page. Keep these. They're your proof.
3. **Do-not-call list.** Anyone who says "stop calling," "take me off your list," or texts STOP is added to a permanent internal list immediately, across calls and texts. The AI is told to honor it on the spot.
4. **Calling hours.** The law allows 8am to 9pm in the called person's time zone, and the code enforces that as a hard limit. Cold calls are narrower by default: weekdays, 9:30 to 4:30, which is also when owners pick up.
5. **Pacing.** At most 3 attempts per lead, 48 hours apart, never twice in one day, and a daily cap (60 by default).
6. **AI disclosure.** The AI's first sentence on every outbound call says its name, that it's an AI assistant, who it's calling for, and that the call is recorded. If anyone asks whether it's a person, it says it's an AI. It never claims to be human. Texas, California, Utah, and others already require this, and an FCC rule proposed in 2024 would require it nationwide. Being upfront also turns out to be a good hook: "I'm actually a pretty good example of the receptionist thing."
7. **Honest caller ID.** Calls go out from your real Twilio number, which rings back to you. No spoofing (NC law 75-102 bans it).
8. **Facts only.** The sales rep may only state prices and terms written in `voice-platform/src/offer.ts`. It's told never to invent discounts, guarantees, or refund terms.

## What you need to do

- **Scrub your manual calls.** Before you call cell numbers from the **Call yourself** list, check them against the National Do Not Call Registry. Register at [telemarketing.donotcall.gov](https://telemarketing.donotcall.gov) to get a Subscription Account Number. Your first five area codes are free (252 covers your whole area), and you have to renew every year. Download the 252 list, then load it with `docker compose exec app node dist/cli.js dnc:import /data/252.txt` (copy the file into `voice-platform/data/` first). Re-download at least every 31 days.
- **Register for texting (A2P 10DLC).** US carriers block business texts from unregistered numbers. As a sole proprietor, Twilio charges $4 once for the brand, $15 once for campaign vetting, and $2/month. See SETUP.md.
- **Don't add `mobile` to `AI_COLD_CALL_LINE_TYPES`.** That one setting is the difference between legal and $500 a call.
- **Keep the website checkbox unchecked by default,** and don't make it required to buy anything. The form already works this way.
- **Recording.** North Carolina only requires one party's consent to record, and the AI announces the recording anyway. If you ever call into all-party-consent states (California, Florida, Pennsylvania, and others), keep the announcement on.
- **Google data.** Google's terms say to store Places data (other than the place ID) for no more than 30 days. The lead finder stores it so the dashboard works. If you build a large database, delete old leads you never called, or re-run the search to refresh them.

## Sources

- FCC declaratory ruling on AI voices and the TCPA (Feb 2024): [fcc.gov](https://www.fcc.gov/document/fcc-confirms-tcpa-applies-ai-technologies-generate-human-voices)
- North Carolina telephone solicitation law, Chapter 75, Article 4: [ncleg.gov](https://www.ncleg.net/enactedlegislation/statutes/html/byarticle/chapter_75/article_4.html)
- 2026 overview of AI outbound compliance and state disclosure laws: [Retell AI playbook](https://www.retellai.com/blog/tcpa-compliance-playbook-voice-ai-outbound)
- National Do Not Call Registry fees (first five area codes free): [FTC](https://www.ftc.gov/news-events/news/press-releases/2026/08/ftc-announces-2027-telemarketer-fees-access-national-do-not-call-registry)
- A2P 10DLC sole proprietor fees: [Twilio](https://support.twilio.com/hc/en-us/articles/9550596959643-A2P-10DLC-Sole-Proprietor-Brands-FAQ)
