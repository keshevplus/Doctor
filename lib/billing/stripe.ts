import Stripe from 'stripe';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { purchases, users } from '@/lib/db/schema';
import { getPack, type CreditPack } from '@/lib/credits/pricing';

/**
 * As with the database handle: constructing a Stripe client opens no
 * connection, so eager construction costs nothing, and throwing here for a
 * missing key would make `next build` require production secrets.
 *
 * The placeholder names itself so a misconfigured deployment fails with a
 * Stripe auth error mentioning the variable rather than an opaque 401.
 */
export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY ?? 'sk_test_STRIPE_SECRET_KEY_is_not_set',
  {
    // Pinning the version means a Stripe-side upgrade cannot silently change
    // the shape of the webhook payloads this code parses.
    apiVersion: '2025-02-24.acacia',
    appInfo: { name: 'Reel', version: '2.0.0' },
    maxNetworkRetries: 2,
  },
);

/** Get or create the Stripe customer for a user, memoised on the user row. */
export async function ensureStripeCustomer(userId: string, email: string | null): Promise<string> {
  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create(
    {
      email: email ?? undefined,
      metadata: { userId },
    },
    // If this call is retried after a network failure, Stripe returns the same
    // customer rather than creating a duplicate.
    { idempotencyKey: `customer:${userId}` },
  );

  await db
    .update(users)
    .set({ stripeCustomerId: customer.id })
    .where(eq(users.id, userId));

  return customer.id;
}

export interface CheckoutParams {
  userId: string;
  email: string | null;
  packId: string;
}

/**
 * Start a credit pack purchase.
 *
 * The price is resolved from our own catalog by pack id — the client sends
 * only the id, never an amount. Accepting a client-supplied price is the
 * single most common way a checkout flow gets exploited, and no amount of
 * webhook validation fully undoes it.
 */
export async function createCheckoutSession(
  params: CheckoutParams,
): Promise<{ url: string; purchaseId: string }> {
  const pack = getPack(params.packId);
  if (!pack) throw new Error(`Unknown pack: ${params.packId}`);

  const customerId = await ensureStripeCustomer(params.userId, params.email);

  // Record the intent before sending the user to Stripe, so the webhook has
  // something authoritative to match against when it comes back.
  const [purchase] = await db
    .insert(purchases)
    .values({
      userId: params.userId,
      packId: pack.id,
      credits: pack.credits,
      amountCents: pack.priceCents,
      status: 'pending',
    })
    .returning({ id: purchases.id });

  if (!purchase) throw new Error('Failed to create purchase record');

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      customer: customerId,
      line_items: [{ price: await resolvePriceId(pack), quantity: 1 }],

      // Both the session and the payment intent carry the purchase id. The
      // webhook needs it on whichever object the event happens to deliver.
      metadata: { purchaseId: purchase.id, userId: params.userId, packId: pack.id },
      payment_intent_data: {
        metadata: { purchaseId: purchase.id, userId: params.userId },
      },

      success_url: `${appUrl}/billing?purchase=${purchase.id}`,
      cancel_url: `${appUrl}/billing?cancelled=1`,

      // Credits are a digital service; collecting tax correctly is not optional
      // once you sell across borders.
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto' },

      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    },
    { idempotencyKey: `checkout:${purchase.id}` },
  );

  if (!session.url) throw new Error('Stripe returned a session with no URL');

  await db
    .update(purchases)
    .set({ stripeCheckoutSessionId: session.id })
    .where(eq(purchases.id, purchase.id));

  return { url: session.url, purchaseId: purchase.id };
}

/**
 * Look up the Stripe Price for a pack by its stable lookup key.
 *
 * Lookup keys rather than hard-coded `price_…` ids: the ids differ between
 * test and live mode, so hard-coding them means the code only works in one of
 * them. Run `npm run stripe:sync` to create the catalog in a new account.
 */
const priceCache = new Map<string, string>();

async function resolvePriceId(pack: CreditPack): Promise<string> {
  const cached = priceCache.get(pack.stripeLookupKey);
  if (cached) return cached;

  const prices = await stripe.prices.list({
    lookup_keys: [pack.stripeLookupKey],
    active: true,
    limit: 1,
  });

  const price = prices.data[0];
  if (!price) {
    throw new Error(
      `No active Stripe price with lookup key "${pack.stripeLookupKey}". Run: npm run stripe:sync`,
    );
  }

  // Guard against the catalog drifting away from pricing.ts — if someone edits
  // the amount in the Stripe dashboard, fail loudly rather than charging a
  // price the app does not believe in.
  if (price.unit_amount !== pack.priceCents) {
    throw new Error(
      `Stripe price ${price.id} is ${price.unit_amount}¢ but pack "${pack.id}" expects ${pack.priceCents}¢`,
    );
  }

  priceCache.set(pack.stripeLookupKey, price.id);
  return price.id;
}
