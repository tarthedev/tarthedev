# Rollinson Network AI

An AI sales rep and AI receptionist for [rollinsonnetwork.com](https://rollinsonnetwork.com).

- **AI receptionist (a product you sell):** answers a local business's phone 24/7, knows their services and hours, takes messages, books appointments, transfers emergencies to the owner's cell, and texts the owner a summary after every call. $149/month, or $99 for your website clients, with 500 minutes included.
- **AI sales rep (works for you):** finds local businesses on Google, checks their websites, builds each one a free preview site, calls the ones it's allowed to call, and gives a live demo on the call. It texts the preview link, or switches the call over so they can hear the receptionist answer as *their* business, then texts a Stripe payment link when they're ready. If they'd rather talk to you first, it books a call on your calendar or transfers them to your cell.

## How a sales call goes

```
 Google Places ──► lead list ──► website check + landline/cell lookup + score
                                     │
                     cell phone ◄────┴────► business landline (or website form with consent)
                          │                          │
               "Call yourself" list          AI dialer, weekdays 9:30–4:30
               (you dial by hand)                    │
                                                     ▼
       "Hi, this is Riley, I'm an AI assistant calling for Aaron Rollinson..."
                                                     │
            ┌──────────────── demo while still on the phone ────────────────┐
            │ texts the free preview site (their name, number, reviews)     │
            │ switches the call to their receptionist ("say 'end demo'")    │
            │ or texts the demo number to call later                        │
            └───────────────────────────────┬───────────────────────────────┘
                                            ▼
             Stripe payment link by text · or book a call with you · or live transfer
                                            ▼
               You get a text: 👀 opened preview · 📅 booked · 💳 link sent · 💰 paid
```

## What's in this repo

| Folder | What it is |
|---|---|
| `voice-platform/` | The server: phone calls, AI agents, lead finder, preview sites, dialer, dashboard. TypeScript on Node 22 with SQLite. Runs in Docker on a small VPS. |
| `website/` | Your live rollinsonnetwork.com page, unchanged except for an AI receptionist section and a "have my AI assistant call you now" form. |
| `docs/SETUP.md` | Step by step: VPS, DNS, Twilio, Claude, Stripe, Cal.com, going live, onboarding clients. |
| `docs/COMPLIANCE.md` | Who the AI may call, what the code enforces, and what you need to do. **Read before turning on the dialer.** |

## How it works

- **Phone:** [Twilio ConversationRelay](https://www.twilio.com/docs/voice/conversationrelay) handles the call audio, speech-to-text (Deepgram), and the voice (ElevenLabs). It streams the caller's words to this server over a WebSocket and speaks the replies as they're written, so the AI starts talking before it has finished thinking. Callers can interrupt it, and it stops mid-sentence like a person would.
- **Brain:** Claude (`claude-opus-5`, low effort for speed) runs each conversation with a toolbox: text the preview, start the live demo, send a payment link, check your Cal.com calendar, book, transfer, schedule a callback, add someone to the do-not-call list, and end the call. The sales playbook and the facts it's allowed to state are in `voice-platform/src/agents/sales.ts` and `voice-platform/src/offer.ts`.
- **Live demo switch:** when the prospect says yes, the sales session ends, Twilio starts a receptionist session on the same call with a different voice ("Thanks for calling Albemarle Roofing!"), and "end demo" brings the sales rep back with the conversation intact.
- **Preview sites:** Claude writes the copy from the business's Google listing and real reviews. It's told not to invent licenses, years in business, prices, or guarantees, and review quotes are checked word for word against the actual reviews. The site is served at `voice.rollinsonnetwork.com/p/...`, marked "not live yet," and hidden from search engines. You get a text when they open it; if they open it during the call, the AI knows.

## Quick start (local, for poking around)

```sh
cd voice-platform
npm install
cp .env.example .env        # set APP_SECRET and ADMIN_PASSWORD at least
npm run dev                  # http://localhost:3000/admin
npm test                     # 58 tests: compliance rules, call flow, webhooks, website form, dashboard
```

Real phone calls need a public HTTPS address, so for anything beyond poking around, follow `docs/SETUP.md`.

## Changing things

| To change... | Edit |
|---|---|
| Prices, what's included, the terms the AI may state | `voice-platform/src/offer.ts` (keep it matching the website) |
| How the sales rep pitches and handles objections | `salesPlaybook()` in `voice-platform/src/agents/sales.ts` |
| The receptionist's behavior (for all clients) | `receptionistPrompt()` in `voice-platform/src/agents/receptionist.ts` |
| One client's services, hours, FAQs, and transfer rules | Dashboard → Receptionist clients |
| Calling hours, daily cap, attempts, voicemail on/off | `voice-platform/.env` |
| Names and voices | `SALES_AGENT_NAME`, `SALES_VOICE`, `RECEPTIONIST_VOICE` in `.env` |
