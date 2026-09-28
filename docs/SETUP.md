# Setup, start to finish

Budget about an afternoon for the setup itself. Texting registration (step 5) takes a few days to get approved, so start that first. Everything else works while you wait.

## What it costs

| Thing | Cost |
|---|---|
| VPS: DigitalOcean Basic droplet, 2 GB RAM | $12/month |
| Two Twilio phone numbers (sales line + demo line) | about $1.15/month each |
| Each receptionist client's number | about $1.15/month (bill it into their plan) |
| Texting registration (A2P 10DLC, sole proprietor) | $4 + $15 once, then $2/month |
| A live AI call, all in (Twilio ConversationRelay $0.07/min + phone minutes + Claude) | roughly $0.11 to $0.13 per minute |
| Phone line-type lookup per lead | $0.008 |
| Google Places search (40 businesses with phone + website) | about 2 to 4 cents per search; Google includes a free monthly allowance |
| Stripe, Cal.com, Resend | free tiers work; Stripe takes its usual card fee |

A typical receptionist client uses 100 to 200 minutes a month, so about $15 to $25 in cost against $149 (or $99). One who uses all 500 included minutes costs you about $65.

## 1. Get the server

1. Create a [DigitalOcean](https://www.digitalocean.com) account and make a droplet: **Ubuntu 24.04, Basic, Regular, 2 GB / 1 CPU ($12/mo), New York region.** New York is close to Twilio's US data center, which keeps call latency down. Add your SSH key when it asks.
2. SSH in (`ssh root@` followed by the IP DigitalOcean shows you) and install Docker:
   ```sh
   curl -fsSL https://get.docker.com | sh
   ```
3. Put the code on it:
   ```sh
   git clone https://github.com/tarthedev/tarthedev.git /opt/rollinson
   cd /opt/rollinson/voice-platform
   cp .env.example .env
   ```
   (If you make the repo private, which I'd recommend, use a GitHub deploy key or `gh auth login` to clone.)

## 2. Point voice.rollinsonnetwork.com at it

In Cloudflare, open **rollinsonnetwork.com → DNS → Add record**:

- Type `A`, name `voice`, IPv4 = your droplet's IP
- **Proxy status: DNS only (grey cloud).** The server gets its own free HTTPS certificate, and that needs the grey cloud.

Your website stays on Cloudflare Pages exactly as it is. Only the `voice.` subdomain goes to the VPS.

## 3. Fill in `.env`

Open it with `nano .env`. The business details (your name, cell, email, service area, prices) are already filled in from rollinsonnetwork.com. You need to add:

- `APP_SECRET`: run `openssl rand -hex 32` and paste the result
- `ADMIN_PASSWORD`: the dashboard password
- the keys from steps 4 to 10 below

## 4. Claude

[console.anthropic.com](https://console.anthropic.com) → **API Keys → Create key** → `ANTHROPIC_API_KEY`. Add a payment method and set a monthly spend limit you're comfortable with.

The live calls use `claude-opus-5` at low effort. If calls ever feel slow to answer, set `VOICE_MODEL=claude-haiku-4-5` in `.env` and restart. It replies faster and costs about a fifth as much, at some cost to how well it handles tricky objections.

## 5. Twilio (phone numbers, calls, texts)

1. Sign up at [twilio.com](https://www.twilio.com) and **upgrade the account** (add a card). Trial accounts can only call numbers you've verified.
2. **Buy two local numbers** in area code 252: **Phone Numbers → Buy a number**, with Voice and SMS checked. Use one as `SALES_CALLER_ID` (the AI calls from it and people call it back) and the other as `DEMO_LINE_NUMBER` (prospects call it to hear the receptionist). Write them as `+1` plus 10 digits.
3. Copy the **Account SID** and **Auth Token** from the console home page into `.env`.
4. **Trust Hub → Customer Profiles**: create a Business Profile (sole proprietor is fine), then:
   - **SHAKEN/STIR**: assign both numbers so calls go out "verified" instead of looking spoofed.
   - **CNAM**: set the caller ID name to `Rollinson Network`.
5. **Texting registration** (Messaging → Regulatory Compliance → A2P 10DLC): register a **Sole Proprietor** brand and campaign. Use case: "Customer care / Marketing: sending website previews, demo numbers, booking links, and payment links that customers request during a call." Add both numbers to the campaign. Approval takes a few days, and texts won't deliver until it's done.
6. Register both numbers at the [Free Caller Registry](https://www.freecallerregistry.com). It's one free form that goes to the three main spam-labeling companies, and it helps keep "Spam Likely" off your calls.

Pointing the numbers at your server happens in step 11. You don't need to type webhook URLs into Twilio.

## 6. Pick the voices

The AI speaks with ElevenLabs voices through Twilio. There's no separate ElevenLabs bill.

1. Browse the [ElevenLabs voice library](https://elevenlabs.io/voice-library) (a free account lets you preview). Filter for American English, conversational. Pick one voice for your sales rep and a different one for the receptionist, so the switch during the live demo is obvious.
2. Copy each voice's ID and set it in `.env` in this format: `voiceID-flash_v2_5-1.0_0.6_0.8`. The three numbers are speed, stability, and similarity. Lower stability sounds more expressive.
3. `SALES_AGENT_NAME` is the name the sales rep uses (default `Riley`). Match it to the voice you pick.

Until you pick, it uses the two voice IDs from Twilio's documentation.

## 7. Stripe (payment links)

1. [dashboard.stripe.com](https://dashboard.stripe.com) → **Developers → API keys** → secret key → `STRIPE_SECRET_KEY`.
2. After the server is running (step 11), create your products and prices in one go:
   ```sh
   docker compose exec app node dist/cli.js stripe:setup
   ```
   Paste the four `STRIPE_PRICE_...` lines it prints into `.env`, then reload the settings with `docker compose up -d --force-recreate app`. (Do the same any time you change `.env`.)
3. **Developers → Webhooks → Add endpoint**: URL `https://voice.rollinsonnetwork.com/stripe/webhook`, event `checkout.session.completed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

When someone pays, you get a text, the lead is marked won, and if they bought the receptionist, a draft client account appears in the dashboard for you to finish.

## 8. Cal.com (booking calls with you)

1. At [cal.com](https://cal.com), create a **15-minute** event type (e.g. "Quick call with Aaron") and connect your calendar.
2. **Settings → Developer → API keys** → `CALCOM_API_KEY`.
3. `CALCOM_EVENT_TYPE_ID`: open the event type; the number in the URL (`/event-types/123456`) is the ID.
4. `CALCOM_BOOKING_URL`: your public link for that event.

## 9. Email (Resend)

Your contact form already uses Resend. At [resend.com](https://resend.com), **Domains → Add** `rollinsonnetwork.com` and add the DNS records it shows in Cloudflare. Then create an API key → `RESEND_API_KEY`. Emails go out as `ai@rollinsonnetwork.com`; replies go to you.

## 10. Google Places (finding leads)

1. [console.cloud.google.com](https://console.cloud.google.com): create a project, enable billing, and enable **Places API (New)**.
2. **APIs & Services → Credentials → Create API key.** Restrict it to Places API (New). → `GOOGLE_PLACES_API_KEY`.
3. Optionally set a budget alert. The lead finder only fetches reviews for businesses you actually build a preview for.

## 11. Start it

```sh
cd /opt/rollinson/voice-platform
docker compose up -d --build
docker compose logs -f app      # Ctrl+C to stop watching
```

Open `https://voice.rollinsonnetwork.com/admin` and log in (`aaron` plus your password). The **Setup** row shows green for everything that's configured.

Click **Configure Twilio numbers** on the dashboard. That points your sales line and demo line at the server for calls and texts.

## 12. Test it on yourself

1. **Receptionist demo:** call your demo line from your cell. It asks what your business is, then answers as that business. Pretend to be a customer, ask for a quote, and give a name. You'll get the "new message" text. Say "end demo" to finish.
2. **Sales rep:** you can't cold-call your own cell (it's a mobile number, so that takes consent). Use the website form instead. Once the new website is up (step 13), fill in the "have my AI assistant call you" form with your cell and check the box. It calls within a minute during 8am to 8pm. Before the site is live, you can do the same with:
   ```sh
   curl -X POST https://voice.rollinsonnetwork.com/api/web-lead -H 'content-type: application/json' \
     -d '{"name":"Aaron","business":"Test Roofing","phone":"252-250-3044","interest":"both","consent":true,"started_at":0}'
   ```
   On the call, try: ask to see the website, ask for a live demo of the receptionist, say "end demo," ask for the payment link, ask whether it's a robot, and say "take me off your list."
3. Read the transcript under **Calls** in the dashboard.

## 13. Put the new website up

`website/index.html` is your live site with two additions: the AI receptionist section and the "have my AI assistant call you" form. Everything else is identical.

In Cloudflare: **Workers & Pages → your rollinsonnetwork.com project → Create deployment → upload** the `website` folder. (If the project is connected to a Git repo, commit the file there instead.) The demo-line button stays hidden until the server is live, and the form falls back to "text me instead" if the server is down.

## 14. Find leads and turn on the dialer

1. **Leads → Find businesses on Google**, e.g. `roofing contractor in Elizabeth City, NC`, `plumber in Camden County, NC`, `hair salon in Hertford, NC`. Each search checks every website, looks up whether the number is a landline or a cell, and scores the lead.
2. Look through the list. Open a few and click **Build preview** to see what prospects will get.
3. Cell-phone leads show up on **Call yourself**. Those are yours to dial (see COMPLIANCE.md about scrubbing them first).
4. When you're ready, set `DIALER_ENABLED=true` in `.env` and run `docker compose up -d --force-recreate app`. The AI calls one landline lead at a time on weekdays, 9:30 to 4:30, best leads first, up to 60 a day. **Pause/Resume** is on the dashboard.

You get a text when a prospect opens their preview, books a call, asks for a payment link, pays, or calls the demo line.

## 15. Onboarding a receptionist client

1. **Receptionist clients → Add a client** (or finish the draft Stripe created).
2. Fill in **What the receptionist should know**: services, prices they're OK sharing, hours, service area, FAQs, and anything it shouldn't say. The more specific, the better it sounds.
3. Set **When to transfer** (e.g. "no heat, burst pipe, gas smell, or the caller insists"), the owner's cell, and email.
4. **Find a number** (area code 252) → **Buy & connect**.
5. Switch **Status** to live and call the number yourself.
6. Have the client forward their existing business line to the AI number:
   - **Only when they don't answer or are busy** (most people want this): Verizon `*71` + the AI number. AT&T and T-Mobile: `**61*` + number + `#` (no answer) and `**67*` + number + `#` (busy).
   - **All calls**: `*72` + number (Verizon and most landlines), `**21*` + number + `#` (AT&T, T-Mobile). Cancel with `*73` or `##21#`.
   - Business landlines from Brightspeed or Spectrum usually use `*72` / `*73`; check the carrier's page if not.

Their minutes show on the clients page, and you get a text if anyone goes over their included minutes.

## Keeping it running

- **Updates:** `cd /opt/rollinson && git pull && cd voice-platform && docker compose up -d --build`
- **Backups:** add `15 3 * * * /opt/rollinson/voice-platform/scripts/backup.sh` to `crontab -e`. It keeps 30 days of nightly database copies in `voice-platform/backups/`. Also turn on DigitalOcean droplet backups ($2.40/mo).
- **Logs:** `docker compose logs --tail 200 app`

## When something's off

- **Dashboard won't load:** check the DNS record is grey-cloud and `docker compose logs caddy` for certificate errors.
- **Calls connect but it's silent:** the server must be reachable at `wss://voice.rollinsonnetwork.com/relay`. Check `docker compose logs app` for `relay` lines.
- **"invalid Twilio signature" in the logs:** `PUBLIC_BASE_URL` must exactly match the address Twilio uses, including `https://` and no trailing slash.
- **Texts don't arrive:** A2P registration isn't approved yet. Check Twilio → Messaging → Regulatory Compliance.
- **Calls show "Spam Likely":** finish SHAKEN/STIR, CNAM, and Free Caller Registry (step 5). Keep daily volume moderate. A sudden jump to hundreds of calls a day from one number gets flagged.
