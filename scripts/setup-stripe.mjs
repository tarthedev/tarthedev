// Creates (or reuses) the Rollinson Network products and prices in Stripe.
// Safe to re-run: prices are looked up by lookup_key. If the amount changed, a new price takes
// over the lookup_key and the old one is archived, so the Worker picks up new pricing with no deploy.
// Usage: npm run setup:stripe   (reads STRIPE_SECRET_KEY from .dev.vars)
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const catalog = [
  {
    lookup_key: 'rn_website_build',
    product: { name: 'Five-page website build', tax_code: 'txcd_10701200' },
    unit_amount: 75600,
  },
  {
    lookup_key: 'rn_care_monthly',
    product: { name: 'Website care plan (hosting, domain, updates)', tax_code: 'txcd_10701100' },
    unit_amount: 12700,
    recurring: { interval: 'month' },
  },
];

for (const item of catalog) {
  const [existing] = (await stripe.prices.list({ lookup_keys: [item.lookup_key], limit: 1 })).data;
  const sameInterval = existing?.recurring?.interval === item.recurring?.interval;
  if (existing && existing.unit_amount === item.unit_amount && sameInterval) {
    console.log(`exists  ${item.lookup_key} -> ${existing.id}`);
    continue;
  }
  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: item.unit_amount,
    lookup_key: item.lookup_key,
    transfer_lookup_key: true,
    tax_behavior: 'exclusive',
    ...(item.recurring && { recurring: item.recurring }),
    ...(existing ? { product: existing.product } : { product_data: item.product }),
  });
  if (existing) {
    await stripe.products.update(price.product, {
      name: item.product.name,
      tax_code: item.product.tax_code,
      default_price: price.id,
    });
    await stripe.prices.update(existing.id, { active: false });
  }
  console.log(`${existing ? 'updated' : 'created'} ${item.lookup_key} -> ${price.id}`);
}

// Archive prices from the earlier $1,200 / $2,000 pricing.
for (const key of ['rn_build_intro', 'rn_build_standard']) {
  const [old] = (await stripe.prices.list({ lookup_keys: [key], limit: 1 })).data;
  if (old?.active) {
    await stripe.prices.update(old.id, { lookup_key: '' });
    await stripe.products.update(typeof old.product === 'string' ? old.product : old.product.id, { active: false });
    console.log(`archived ${key}`);
  }
}
