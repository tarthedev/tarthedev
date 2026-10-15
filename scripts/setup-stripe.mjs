// Creates (or reuses) the Rollinson Network products and prices in Stripe.
// Safe to re-run: prices are looked up by lookup_key before anything is created.
// Usage: npm run setup:stripe   (reads STRIPE_SECRET_KEY from .dev.vars)
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const catalog = [
  {
    lookup_key: 'rn_build_intro',
    product: { name: 'Website build (introductory rate)', tax_code: 'txcd_10701200' },
    unit_amount: 120000,
  },
  {
    lookup_key: 'rn_build_standard',
    product: { name: 'Website build', tax_code: 'txcd_10701200' },
    unit_amount: 200000,
  },
  {
    lookup_key: 'rn_care_monthly',
    product: { name: 'Website care plan (hosting, domain, updates)', tax_code: 'txcd_10701100' },
    unit_amount: 12900,
    recurring: { interval: 'month' },
  },
];

for (const item of catalog) {
  const existing = await stripe.prices.list({ lookup_keys: [item.lookup_key], limit: 1 });
  if (existing.data.length) {
    console.log(`exists  ${item.lookup_key} -> ${existing.data[0].id}`);
    continue;
  }
  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: item.unit_amount,
    lookup_key: item.lookup_key,
    tax_behavior: 'exclusive',
    ...(item.recurring && { recurring: item.recurring }),
    product_data: item.product,
  });
  console.log(`created ${item.lookup_key} -> ${price.id}`);
}
