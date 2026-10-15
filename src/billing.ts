import Stripe from 'stripe';
import type { Env } from './index';
import { formatPhone, sendAlert } from './alerts';
import { normalizePhone } from './leads';

const BUILD_PRICE = 'rn_website_build'; // $756 one time
const CARE_PLAN_PRICE = 'rn_care_monthly'; // $127 / month
const DAY = 86400;

export function stripeClient(env: Env) {
  return new Stripe(env.STRIPE_SECRET_KEY);
}

// "Pay" buttons on the site. A plain form post, so it works without JavaScript.
export async function createCheckout(request: Request, env: Env, stripe: Stripe): Promise<Response> {
  const form = await request.formData();
  const plan = form.get('plan') === 'care' ? 'care' : 'site';
  const origin = new URL(request.url).origin;
  const build = await priceByLookupKey(stripe, BUILD_PRICE);
  const automaticTax = env.AUTOMATIC_TAX === 'true';

  const common: Stripe.Checkout.SessionCreateParams = {
    success_url: `${origin}/thanks?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#pay`,
    billing_address_collection: 'required',
    phone_number_collection: { enabled: true },
    automatic_tax: { enabled: automaticTax },
    custom_fields: [{ key: 'business', label: { type: 'custom', custom: 'Business name' }, type: 'text' }],
    metadata: { plan },
  };

  let session: Stripe.Checkout.Session;
  if (plan === 'care') {
    const care = await priceByLookupKey(stripe, CARE_PLAN_PRICE);
    const delayDays = Number(env.CARE_PLAN_DELAY_DAYS || '30');
    session = await stripe.checkout.sessions.create({
      ...common,
      mode: 'subscription',
      line_items: [
        { price: build.id, quantity: 1 },
        { price: care.id, quantity: 1 },
      ],
      // One-time items are charged at checkout even during a trial, so this is $756 today and the
      // first $127 when the trial ends. Checkout shows those terms to the customer before they pay.
      subscription_data: {
        trial_period_days: delayDays,
        metadata: { source: 'website' },
      },
    });
  } else {
    session = await stripe.checkout.sessions.create({
      ...common,
      mode: 'payment',
      line_items: [{ price: build.id, quantity: 1 }],
      customer_creation: 'always',
      invoice_creation: { enabled: true },
    });
  }
  return Response.redirect(session.url!, 303);
}

interface BuildInvoiceRequest {
  name: string;
  email: string;
  phone?: string;
  address: { line1: string; line2?: string; city: string; state: string; postal_code: string };
  care_plan: boolean;
  request_id?: string;
}

// For you, not the public: emails a client a $756 hosted invoice (e.g. after a preview approved by phone).
// If care_plan is true, the card they pay with is saved and the $127/mo plan starts once it's paid.
export async function createBuildInvoice(request: Request, env: Env, stripe: Stripe): Promise<Response> {
  const body = (await request.json()) as BuildInvoiceRequest;
  const problem = validateInvoiceRequest(body);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const idempotencyKey = body.request_id ?? crypto.randomUUID();
  const customer = await upsertCustomer(stripe, body);
  const price = await priceByLookupKey(stripe, BUILD_PRICE);

  const draft = await stripe.invoices.create(
    {
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 7,
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      automatic_tax: { enabled: env.AUTOMATIC_TAX === 'true' },
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
  return Response.json({ invoice_id: sent.id, hosted_invoice_url: sent.hosted_invoice_url, amount_due: sent.amount_due });
}

export async function handleWebhook(request: Request, env: Env, stripe: Stripe): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'missing signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return Response.json({ error: 'invalid signature' }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (event.data.object.payment_status === 'paid') await alertCheckoutPaid(env, event.data.object);
      break;
    case 'invoice.paid':
      await startCarePlanIfRequested(stripe, env, event.data.object);
      break;
    case 'invoice.payment_failed':
      await alertCustomer(stripe, env, event.data.object.customer, 'Payment failed', [
        `Invoice ${event.data.object.number ?? event.data.object.id} for ${money(event.data.object.amount_due)} failed.`,
        'Stripe will retry automatically. A quick call may help.',
      ]);
      break;
    case 'customer.subscription.deleted':
      await alertCustomer(stripe, env, event.data.object.customer, 'Care plan cancelled', [
        `Subscription ${event.data.object.id} ended.`,
      ]);
      break;
  }
  return Response.json({ received: true });
}

async function alertCheckoutPaid(env: Env, session: Stripe.Checkout.Session) {
  const d = session.customer_details;
  const phone = normalizePhone(d?.phone ?? '') ?? undefined;
  const business = session.custom_fields.find((f) => f.key === 'business')?.text?.value;
  const plan = session.metadata?.plan === 'care' ? 'Website + $127/mo care plan' : 'Website only';
  await sendAlert(env, {
    title: `PAID ${money(session.amount_total ?? 0)}: ${business || d?.name || 'new client'}`,
    lines: [
      `${d?.name ?? ''}${business ? ` — ${business}` : ''}`,
      ...(phone ? [`Phone: ${formatPhone(phone)}`] : []),
      ...(d?.email ? [`Email: ${d.email}`] : []),
      `Plan: ${plan}`,
      `Checkout: ${session.id}`,
    ],
    phone,
    replyTo: d?.email ?? undefined,
    priority: 'urgent',
  });
}

async function alertCustomer(
  stripe: Stripe,
  env: Env,
  customerRef: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  title: string,
  lines: string[],
) {
  const id = typeof customerRef === 'string' ? customerRef : customerRef?.id;
  const customer = id ? await stripe.customers.retrieve(id) : null;
  const c = customer && !customer.deleted ? customer : null;
  const phone = normalizePhone(c?.phone ?? '') ?? undefined;
  await sendAlert(env, {
    title: `${title}: ${c?.name ?? id ?? 'unknown customer'}`,
    lines: [...lines, ...(phone ? [`Phone: ${formatPhone(phone)}`] : []), ...(c?.email ? [`Email: ${c.email}`] : [])],
    phone,
    priority: 'high',
  });
}

async function startCarePlanIfRequested(stripe: Stripe, env: Env, invoice: Stripe.Invoice) {
  // Only an admin build invoice starts a care plan; subscription renewals also fire invoice.paid.
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
      billing_cycle_anchor: paidAt + delayDays * DAY,
      proration_behavior: 'none',
      automatic_tax: { enabled: env.AUTOMATIC_TAX === 'true' },
      metadata: { build_invoice: invoice.id! },
    },
    { idempotencyKey: `care-plan:${invoice.id}` },
  );
  console.log(`care plan ${subscription.id} started for ${customerId}`);
}

async function upsertCustomer(stripe: Stripe, body: BuildInvoiceRequest): Promise<Stripe.Customer> {
  const details = { name: body.name, phone: body.phone, address: { ...body.address, country: 'US' } };
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

function validateInvoiceRequest(body: BuildInvoiceRequest): string | null {
  if (!body?.name || !body.email) return 'name and email are required';
  const a = body.address;
  if (!a?.line1 || !a.city || !a.state || !a.postal_code) return 'address needs line1, city, state, postal_code';
  if (typeof body.care_plan !== 'boolean') return 'care_plan must be true or false';
  return null;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
}
