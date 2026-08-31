import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';

import { stripe } from '@/lib/billing/stripe';
import { db } from '@/lib/db/client';
import { processedWebhookEvents, purchases } from '@/lib/db/schema';
import { grantCredits, spendCredits } from '@/lib/credits/ledger';
import { PACK_EXPIRY_MONTHS, getPack } from '@/lib/credits/pricing';
import { recordAuditEvent } from '@/lib/auth/audit';
import { isUniqueViolation } from '@/lib/credits/errors';

export const runtime = 'nodejs';
// Signature verification needs the byte-exact body, so nothing may cache,
// rewrite or revalidate this route.
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook — the *only* place credits are granted from a purchase.
 *
 * The success_url the customer lands on after paying proves nothing: it is
 * just a URL, and anyone can visit it with any purchase id. Granting credits
 * there would be a free-credit generator. The webhook is the only channel
 * whose authenticity we can verify, so it is the only one trusted to move
 * money-equivalent balances.
 *
 * Three properties this handler has to hold:
 *
 *   1. Authenticity — HMAC signature check against the endpoint secret.
 *   2. Idempotency  — Stripe retries; every delivery of the same event id
 *                     after the first must be a no-op.
 *   3. Atomicity    — marking the purchase paid and granting the credits
 *                     happen in one transaction, so there is no state where
 *                     the customer has been charged but has no credits.
 */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set; refusing to process webhooks');
    return Response.json({ error: 'Not configured' }, { status: 500 });
  }

  // Raw text, not request.json(). Re-serialising JSON changes bytes and the
  // signature check would fail.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    // An invalid signature is either a misconfiguration or someone probing.
    // Either way: no processing, no detail in the response.
    console.warn('stripe webhook signature verification failed', error);
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Claim the event. The unique primary key is the idempotency gate — if the
  // insert conflicts, a previous delivery already did this work.
  try {
    await db.insert(processedWebhookEvents).values({ id: event.id, type: event.type });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json({ received: true, duplicate: true });
    }
    throw error;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'charge.refunded':
        await handleRefund(event.data.object);
        break;

      case 'checkout.session.expired':
        await handleSessionExpired(event.data.object);
        break;

      default:
        // Unhandled types are still recorded as processed so Stripe stops
        // retrying them.
        break;
    }
  } catch (error) {
    console.error('stripe webhook handler failed', { eventId: event.id, type: event.type, error });

    // Release the idempotency claim so Stripe's retry can have another go —
    // otherwise a transient database error would permanently strand a paid
    // purchase with no credits.
    await db
      .delete(processedWebhookEvents)
      .where(eq(processedWebhookEvents.id, event.id))
      .catch(() => {});

    return Response.json({ error: 'Handler failed' }, { status: 500 });
  }

  return Response.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // Unpaid sessions can complete (e.g. a delayed payment method). Credits are
  // granted on payment, not on completion.
  if (session.payment_status !== 'paid') return;

  const purchaseId = session.metadata?.purchaseId;
  if (!purchaseId) {
    console.error('checkout.session.completed with no purchaseId metadata', { id: session.id });
    return;
  }

  const [purchase] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .limit(1);

  if (!purchase) {
    console.error('checkout.session.completed for unknown purchase', { purchaseId });
    return;
  }

  if (purchase.status === 'paid') return;

  // Cross-check what Stripe says was collected against what we recorded when
  // the session was created. A mismatch means either tampering or a catalog
  // that drifted mid-flight; neither should quietly grant credits.
  if (session.amount_total !== null && session.amount_total !== purchase.amountCents) {
    console.error('checkout amount mismatch — refusing to grant', {
      purchaseId,
      expected: purchase.amountCents,
      received: session.amount_total,
    });
    await db.update(purchases).set({ status: 'failed' }).where(eq(purchases.id, purchaseId));
    return;
  }

  const pack = getPack(purchase.packId);
  // Trust the credits recorded on the purchase row rather than today's catalog:
  // the customer bought what the pack contained at purchase time, and repricing
  // must not retroactively change a completed order.
  const credits = purchase.credits;

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + PACK_EXPIRY_MONTHS);

  await db.transaction(async (tx) => {
    await tx
      .update(purchases)
      .set({
        status: 'paid',
        paidAt: new Date(),
        stripePaymentIntentId:
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
      })
      .where(eq(purchases.id, purchaseId));

    await grantCredits(
      {
        userId: purchase.userId,
        amount: credits,
        reason: 'purchase',
        source: 'purchase',
        sourceRef: purchaseId,
        expiresAt,
        idempotencyKey: `purchase:${purchaseId}`,
        metadata: { packId: purchase.packId, packName: pack?.name ?? purchase.packId },
      },
      tx,
    );
  });

  await recordAuditEvent({
    userId: purchase.userId,
    event: 'billing.credits_purchased',
    metadata: { purchaseId, packId: purchase.packId, credits },
  });
}

/**
 * Claw back credits on a refund.
 *
 * If the customer has already spent them the balance would go negative, which
 * the ledger refuses. In that case we take what is left and flag the shortfall
 * for manual review rather than inventing a negative balance — a customer who
 * refunds after consuming the service is a support conversation, not something
 * to resolve automatically.
 */
async function handleRefund(charge: Stripe.Charge): Promise<void> {
  // Metadata set on a PaymentIntent is not copied onto its Charges, so the
  // payment intent id is the reliable join back to our purchase row. Metadata
  // is only a fallback for charges created outside the checkout flow.
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;

  const [purchase] = paymentIntentId
    ? await db
        .select()
        .from(purchases)
        .where(eq(purchases.stripePaymentIntentId, paymentIntentId))
        .limit(1)
    : charge.metadata?.purchaseId
      ? await db
          .select()
          .from(purchases)
          .where(eq(purchases.id, charge.metadata.purchaseId))
          .limit(1)
      : [];

  if (!purchase || purchase.status !== 'paid') return;
  const purchaseId = purchase.id;

  await db.update(purchases).set({ status: 'refunded' }).where(eq(purchases.id, purchaseId));

  try {
    await spendCredits({
      userId: purchase.userId,
      amount: purchase.credits,
      reason: 'refund_reversal',
      idempotencyKey: `refund:${purchaseId}`,
      metadata: { purchaseId, chargeId: charge.id },
    });
  } catch {
    await recordAuditEvent({
      userId: purchase.userId,
      event: 'billing.refund_clawback_shortfall',
      metadata: { purchaseId, credits: purchase.credits, needsReview: true },
    });
  }

  await recordAuditEvent({
    userId: purchase.userId,
    event: 'billing.refunded',
    metadata: { purchaseId, amountCents: charge.amount_refunded },
  });
}

async function handleSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
  const purchaseId = session.metadata?.purchaseId;
  if (!purchaseId) return;

  await db
    .update(purchases)
    .set({ status: 'failed' })
    .where(eq(purchases.id, purchaseId));
}
