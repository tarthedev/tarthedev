# rollinsonnetwork.com

The whole site runs as one Cloudflare Worker (`rnet`):

- **Website** (`public/`): the home page, a lead qualifier form, and a pay section.
- **Lead alerts** (`POST /api/lead`): six quick questions, scored HOT / WARM / COLD. You get a
  Telegram message and an email (Resend) with their answers and a tap-to-call number. Every lead
  is also saved, and you can see them all at `/admin/leads?key=ADMIN_TOKEN`.
- **Payments** (`POST /api/checkout`): Stripe Checkout for the $756 website, with or without
  the $127/month care plan. The care plan's first charge is 30 days after the $756 payment.
  You get a "PAID" alert for every payment.
- **Invoices** (`POST /admin/invoice`): emails a client a $756 Stripe invoice when you'd rather
  bill them directly (for example, after approving a preview by phone).
- **Stripe webhook** (`POST /webhook`): payment alerts, failed-payment and cancellation alerts,
  and starts the care plan for invoiced clients.

## Deploy

You need Node 20+ and the Cloudflare account that owns rollinsonnetwork.com.

```sh
npm install
npx wrangler login

# Secrets (each command prompts for the value)
npx wrangler secret put STRIPE_SECRET_KEY      # sk_live_... (sk_test_... to try it first)
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # whsec_... from step 2 below
npx wrangler secret put ADMIN_TOKEN            # any long random string; only you use it
npx wrangler secret put TELEGRAM_BOT_TOKEN     # from @BotFather (step 3 below)
npx wrangler secret put TELEGRAM_CHAT_ID       # your chat ID (step 3 below)
npx wrangler secret put RESEND_API_KEY         # re_... from step 4 below

npm run deploy
```

The Worker is named `rnet`, the same as the Worker serving the site today, so a deploy replaces
it in place and rollinsonnetwork.com stays attached.

To redeploy automatically on every push instead, connect this GitHub repo in the Cloudflare
dashboard: **Workers & Pages > rnet > Settings > Build**.

### One-time setup

1. **Stripe prices.** Put your key in `.dev.vars` (copy `.dev.vars.example`), then run
   `npm run setup:stripe`. This creates "Five-page website build" ($756) and "Website care plan"
   ($127/month) in that Stripe account. Run it once with your test key and once with your live
   key. It's safe to re-run, and changing an amount in `scripts/setup-stripe.mjs` and re-running
   updates the price with no redeploy.
2. **Stripe webhook.** In the Dashboard under **Developers > Webhooks > Add endpoint**, add
   `https://rollinsonnetwork.com/webhook` with these events: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.deleted`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. **Phone alerts (Telegram).** In Telegram, message **@BotFather**, send `/newbot`, and follow
   the prompts. It gives you a bot token for `TELEGRAM_BOT_TOKEN`. Send your new bot any message,
   then open `https://api.telegram.org/bot<TOKEN>/getUpdates`; the `chat.id` number there is your
   `TELEGRAM_CHAT_ID`. HOT leads and payments arrive with sound; COLD leads arrive silently.
   (ntfy.sh doesn't accept connections from Cloudflare Workers, so it isn't used.)
4. **Email alerts (Resend).** Create a free account at resend.com and add the domain
   `rollinsonnetwork.com`. Add the DNS records it shows in Cloudflare DNS. They sit on a `send.`
   subdomain and don't touch your Zoho mail. Then create an API key for `RESEND_API_KEY`.
   Alerts go to `ALERT_EMAIL` in `wrangler.jsonc`.
5. **Stripe Dashboard settings** (no code):
   - **Tax > Registrations:** automatic tax is on. It charges $0 until you add a registration
     (for example, North Carolina once you're registered there), then it adds the right tax at checkout.
   - **Settings > Branding:** add your logo and color (shown on Checkout, receipts, invoices).
   - **Settings > Billing > Customer portal:** turn on the login link so clients can cancel the
     care plan or update their card themselves.
   - **Settings > Billing > Revenue recovery:** turn on Smart Retries and failed-payment emails.
   - **In person:** use Tap to Pay in the Stripe Dashboard app on your phone.

Leads are saved before any alert is sent, so you never lose one even if an alert fails. Bookmark
`https://rollinsonnetwork.com/admin/leads?key=<ADMIN_TOKEN>` on your phone to see them all.

## Local development

```sh
npm run dev                                        # http://localhost:8787
stripe listen --forward-to localhost:8787/webhook  # prints the whsec_ for .dev.vars
npm run typecheck
```

Test card: `4242 4242 4242 4242`, any future date, any CVC.

## Sending an invoice

```sh
curl -X POST https://rollinsonnetwork.com/admin/invoice \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Jane Smith","email":"jane@example.com","phone":"+12525550100",
       "address":{"line1":"100 Main St","city":"Elizabeth City","state":"NC","postal_code":"27909"},
       "care_plan":true}'
```

## Changing things

| What | Where |
| --- | --- |
| Page text, prices shown on the page | `public/index.html` |
| Qualifier questions | `public/index.html` (the `<fieldset data-step>` blocks) |
| How leads are scored | `scoreLead` in `src/leads.ts` |
| Amounts actually charged | `scripts/setup-stripe.mjs`, then `npm run setup:stripe` |
| Days before the first $127 charge | `CARE_PLAN_DELAY_DAYS` in `wrangler.jsonc` |
