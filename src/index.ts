import Stripe from 'stripe';

interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  ADMIN_TOKEN: string;
  AUTOMATIC_TAX: string;
  CARE_PLAN_DELAY_DAYS: string;
}

const BUILD_PRICES = { intro: 'rn_build_intro', standard: 'rn_build_standard' } as const;
const CARE_PLAN_PRICE = 'rn_care_monthly';

interface BuildInvoiceRequest {
  name: string;
  email: string;
  phone?: string;
  address: { line1: string; line2?: string; city: string; state: string; postal_code: string };
  build: keyof typeof BUILD_PRICES;
  care_plan: boolean;
  request_id?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);

    try {
      if (request.method === 'POST' && pathname === '/webhook') return await handleWebhook(request, env, stripe);
      if (request.method === 'POST' && pathname === '/admin/invoice') {
        if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
        return await createBuildInvoice(request, env, stripe);
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error(err);
      const message = err instanceof Stripe.errors.StripeError ? err.message : 'internal error';
      return json({ error: message }, err instanceof Stripe.errors.StripeInvalidRequestError ? 400 : 500);
    }
  },
} satisfies ExportedHandler<Env>;

// Called by you (not the public site) once a client approves their preview.
// Creates the build-fee invoice and emails the client a hosted payment link.
async function createBuildInvoice(request: Request, env: Env, stripe: Stripe): Promise<Response> {
  const body = (await request.json()) as BuildInvoiceRequest;
  const problem = validate(body);
  if (problem) return json({ error: problem }, 400);

  const idempotencyKey = body.request_id ?? crypto.randomUUID();
  const automaticTax = env.AUTOMATIC_TAX === 'true';
  const customer = await upsertCustomer(stripe, body);
  const price = await priceByLookupKey(stripe, BUILD_PRICES[body.build]);

  const draft = await stripe.invoices.create(
    {
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 7,
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      automatic_tax: { enabled: automaticTax },
      metadata: { care_plan: String(body.care_plan) },
    },
    { idempotencyKey: `${idempotencyKey}:invoice` },
  );
  await stripe.invoiceItems.create(
    { customer: customer.id, invoice: draft.id, pricing: { price: price.id } },
    { idempotencyKey: `${idempotencyKey}:item` },
  );
  const invoice = await stripe.invoices.finalizeInvoice(draft.id!);

  // Save the card the client pays with so the care plan can bill it monthly.
  if (body.care_plan) {
    const paymentIntentId = await invoicePaymentIntentId(stripe, invoice.id!);
    if (paymentIntentId) await stripe.paymentIntents.update(paymentIntentId, { setup_future_usage: 'off_session' });
  }

  const sent = await stripe.invoices.sendInvoice(invoice.id!);
  return json({ invoice_id: sent.id, hosted_invoice_url: sent.hosted_invoice_url, amount_due: sent.amount_due });
}

async function handleWebhook(request: Request, env: Env, stripe: Stripe): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'missing signature' }, 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return json({ error: 'invalid signature' }, 400);
  }

  switch (event.type) {
    case 'invoice.paid':
      await startCarePlanIfRequested(stripe, env, event.data.object);
      break;
    case 'invoice.payment_failed':
      console.warn(`payment failed: invoice ${event.data.object.id} customer ${event.data.object.customer}`);
      break;
    case 'customer.subscription.deleted':
      console.log(`care plan cancelled: ${event.data.object.id} customer ${event.data.object.customer}`);
      break;
  }
  return json({ received: true });
}

async function startCarePlanIfRequested(stripe: Stripe, env: Env, invoice: Stripe.Invoice) {
  // Only the one-off build invoice starts a care plan; subscription renewals also fire invoice.paid.
  if (invoice.metadata?.care_plan !== 'true' || invoice.parent?.subscription_details) return;

  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer!.id;
  const paymentIntentId = await invoicePaymentIntentId(stripe, invoice.id!, 'paid');
  const paymentIntent = paymentIntentId ? await stripe.paymentIntents.retrieve(paymentIntentId) : null;
  const paymentMethodId =
    typeof paymentIntent?.payment_method === 'string' ? paymentIntent.payment_method : paymentIntent?.payment_method?.id;
  if (!paymentMethodId) {
    console.warn(`invoice ${invoice.id} paid without a reusable payment method; start the care plan manually`);
    return;
  }

  // Stripe can redeliver an event days later, past the 24h idempotency-key window.
  const existing = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  if (existing.data.some((s) => s.metadata.build_invoice === invoice.id)) return;

  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
  const price = await priceByLookupKey(stripe, CARE_PLAN_PRICE);
  const delayDays = Number(env.CARE_PLAN_DELAY_DAYS || '30');
  // Anchor on when the invoice was paid (not now) so retried deliveries send identical parameters.
  const paidAt = invoice.status_transitions.paid_at ?? Math.floor(Date.now() / 1000);

  const subscription = await stripe.subscriptions.create(
    {
      customer: customerId,
      items: [{ price: price.id }],
      default_payment_method: paymentMethodId,
      billing_cycle_anchor: paidAt + delayDays * 86400,
      proration_behavior: 'none',
      automatic_tax: { enabled: env.AUTOMATIC_TAX === 'true' },
      metadata: { build_invoice: invoice.id! },
    },
    { idempotencyKey: `care-plan:${invoice.id}` },
  );
  console.log(`care plan ${subscription.id} started for ${customerId}`);
}

async function upsertCustomer(stripe: Stripe, body: BuildInvoiceRequest): Promise<Stripe.Customer> {
  const details = {
    name: body.name,
    phone: body.phone,
    address: { ...body.address, country: 'US' },
  };
  const existing = await stripe.customers.list({ email: body.email, limit: 1 });
  if (existing.data.length) return stripe.customers.update(existing.data[0].id, details);
  return stripe.customers.create({ email: body.email, ...details });
}

async function priceByLookupKey(stripe: Stripe, lookupKey: string): Promise<Stripe.Price> {
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (!prices.data.length) throw new Error(`price ${lookupKey} not found; run npm run setup:stripe`);
  return prices.data[0];
}

async function invoicePaymentIntentId(stripe: Stripe, invoiceId: string, status?: 'paid'): Promise<string | null> {
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, ...(status && { status }), limit: 1 });
  const intent = payments.data[0]?.payment.payment_intent;
  if (!intent) return null;
  return typeof intent === 'string' ? intent : intent.id;
}

function validate(body: BuildInvoiceRequest): string | null {
  if (!body?.name || !body.email) return 'name and email are required';
  if (!(body.build in BUILD_PRICES)) return 'build must be "intro" or "standard"';
  const a = body.address;
  if (!a?.line1 || !a.city || !a.state || !a.postal_code) return 'address needs line1, city, state, postal_code';
  if (typeof body.care_plan !== 'boolean') return 'care_plan must be true or false';
  return null;
}

function isAdmin(request: Request, env: Env): boolean {
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (!env.ADMIN_TOKEN || header.length !== expected.length) return false;
  const enc = new TextEncoder();
  return crypto.subtle.timingSafeEqual(enc.encode(header), enc.encode(expected));
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}
