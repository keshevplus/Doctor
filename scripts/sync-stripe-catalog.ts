/**
 * Create or update the Stripe product catalog from lib/credits/pricing.ts.
 *
 *     npm run stripe:sync
 *
 * Run once against a fresh Stripe account, and again whenever a pack is added.
 *
 * Prices in Stripe are immutable, so changing an amount means creating a new
 * price and moving the lookup key across — this script does that, which is why
 * lookup keys are versioned (`…_v1`). The old price is deactivated but kept,
 * so historical invoices still resolve.
 */
import Stripe from 'stripe';

import { CREDIT_PACKS, SUBSCRIPTION } from '../lib/credits/pricing';

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error('STRIPE_SECRET_KEY is not set');
  process.exit(1);
}

const stripe = new Stripe(secretKey, { apiVersion: '2025-02-24.acacia' });

async function upsertPrice(opts: {
  productName: string;
  productDescription: string;
  lookupKey: string;
  unitAmount: number;
  recurring?: { interval: 'month' };
  metadata: Record<string, string>;
}): Promise<void> {
  const existing = await stripe.prices.list({
    lookup_keys: [opts.lookupKey],
    active: true,
    limit: 1,
  });

  const current = existing.data[0];
  if (current && current.unit_amount === opts.unitAmount) {
    console.log(`  = ${opts.lookupKey} already correct (${current.id})`);
    return;
  }

  const products = await stripe.products.search({
    query: `metadata['reel_key']:'${opts.metadata.reel_key}'`,
    limit: 1,
  });

  const product =
    products.data[0] ??
    (await stripe.products.create({
      name: opts.productName,
      description: opts.productDescription,
      metadata: opts.metadata,
    }));

  if (current) {
    // Free the lookup key before reusing it — Stripe allows only one active
    // price per key.
    await stripe.prices.update(current.id, { lookup_key: `${opts.lookupKey}_retired_${Date.now()}` });
    await stripe.prices.update(current.id, { active: false });
    console.log(`  ~ retired ${current.id} (was ${current.unit_amount}¢)`);
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: opts.unitAmount,
    lookup_key: opts.lookupKey,
    transfer_lookup_key: true,
    ...(opts.recurring ? { recurring: opts.recurring } : {}),
    metadata: opts.metadata,
  });

  console.log(`  + ${opts.lookupKey} → ${price.id} (${opts.unitAmount}¢)`);
}

async function main(): Promise<void> {
  console.log('Syncing credit packs…');
  for (const pack of CREDIT_PACKS) {
    await upsertPrice({
      productName: `Reel — ${pack.name} credit pack`,
      productDescription: `${pack.credits.toLocaleString()} Reel credits. ${pack.blurb}`,
      lookupKey: pack.stripeLookupKey,
      unitAmount: pack.priceCents,
      metadata: { reel_key: `pack_${pack.id}`, credits: String(pack.credits), packId: pack.id },
    });
  }

  console.log('Syncing subscription…');
  await upsertPrice({
    productName: `Reel ${SUBSCRIPTION.name}`,
    productDescription: `${SUBSCRIPTION.monthlyCredits} credits a month, sync across devices, and unlimited notes.`,
    lookupKey: SUBSCRIPTION.stripeLookupKey,
    unitAmount: SUBSCRIPTION.priceCentsMonthly,
    recurring: { interval: 'month' },
    metadata: {
      reel_key: `subscription_${SUBSCRIPTION.id}`,
      credits: String(SUBSCRIPTION.monthlyCredits),
    },
  });

  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
