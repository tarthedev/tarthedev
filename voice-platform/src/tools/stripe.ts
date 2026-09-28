import Stripe from "stripe";
import { config, publicUrl } from "../config.js";
import { offer } from "../offer.js";

let stripe: Stripe | null = null;

export function stripeClient(): Stripe {
  if (!config.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
  stripe ??= new Stripe(config.STRIPE_SECRET_KEY);
  return stripe;
}

export const PRODUCTS = {
  website: `Website, $${offer.website.price.toLocaleString()} one time`,
  website_care: `Website hosting and upkeep, $${offer.website.monthly}/month`,
  receptionist: `AI receptionist, $${offer.receptionist.soloMonthly}/month`,
  website_and_receptionist: `Website ($${offer.website.price.toLocaleString()}) + upkeep ($${offer.website.monthly}/mo) + AI receptionist at the client rate ($${offer.receptionist.addonMonthly}/mo)`,
  receptionist_addon: `AI receptionist for existing website clients, $${offer.receptionist.addonMonthly}/month`,
} as const;

export type ProductKey = keyof typeof PRODUCTS;

function lineItems(product: ProductKey): { items: { price: string; quantity: number }[]; recurring: boolean } {
  const p = (id: string, name: string) => {
    if (!id) throw new Error(`Stripe price for ${name} is not configured`);
    return { price: id, quantity: 1 };
  };
  switch (product) {
    case "website":
      return { items: [p(config.STRIPE_PRICE_WEBSITE, "STRIPE_PRICE_WEBSITE")], recurring: false };
    case "website_care":
      return { items: [p(config.STRIPE_PRICE_WEBSITE_MONTHLY, "STRIPE_PRICE_WEBSITE_MONTHLY")], recurring: true };
    case "receptionist":
      return { items: [p(config.STRIPE_PRICE_RECEPTIONIST_SOLO, "STRIPE_PRICE_RECEPTIONIST_SOLO")], recurring: true };
    case "receptionist_addon":
      return { items: [p(config.STRIPE_PRICE_RECEPTIONIST_ADDON, "STRIPE_PRICE_RECEPTIONIST_ADDON")], recurring: true };
    case "website_and_receptionist":
      return {
        items: [
          p(config.STRIPE_PRICE_WEBSITE, "STRIPE_PRICE_WEBSITE"),
          p(config.STRIPE_PRICE_WEBSITE_MONTHLY, "STRIPE_PRICE_WEBSITE_MONTHLY"),
          p(config.STRIPE_PRICE_RECEPTIONIST_ADDON, "STRIPE_PRICE_RECEPTIONIST_ADDON"),
        ],
        recurring: true,
      };
  }
}

/** A Checkout link tied to the lead, so the webhook knows who paid. Links expire after 24 hours. */
export async function createCheckoutLink(opts: {
  product: ProductKey;
  leadId: number;
  businessName: string;
  email?: string | null;
}): Promise<string> {
  const { items, recurring } = lineItems(opts.product);
  const session = await stripeClient().checkout.sessions.create({
    mode: recurring ? "subscription" : "payment",
    line_items: items,
    customer_email: opts.email ?? undefined,
    client_reference_id: String(opts.leadId),
    metadata: { lead_id: String(opts.leadId), product: opts.product, business: opts.businessName.slice(0, 200) },
    ...(recurring
      ? { subscription_data: { metadata: { lead_id: String(opts.leadId), product: opts.product } } }
      : { payment_intent_data: { metadata: { lead_id: String(opts.leadId), product: opts.product } } }),
    success_url: publicUrl(`/thanks?session_id={CHECKOUT_SESSION_ID}`),
    cancel_url: publicUrl(`/thanks?canceled=1`),
    expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/** One-time setup: create the products and prices in Stripe and print the IDs for .env. */
export async function createStripeCatalog() {
  const s = stripeClient();
  const make = async (name: string, amount: number, interval?: "month") => {
    const product = await s.products.create({ name });
    const price = await s.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: amount * 100,
      ...(interval ? { recurring: { interval } } : {}),
    });
    return price.id;
  };
  return {
    STRIPE_PRICE_WEBSITE: await make("Five-page website", offer.website.price),
    STRIPE_PRICE_WEBSITE_MONTHLY: await make("Website hosting and upkeep", offer.website.monthly, "month"),
    STRIPE_PRICE_RECEPTIONIST_SOLO: await make("AI receptionist", offer.receptionist.soloMonthly, "month"),
    STRIPE_PRICE_RECEPTIONIST_ADDON: await make(
      "AI receptionist (website client rate)",
      offer.receptionist.addonMonthly,
      "month",
    ),
  };
}
