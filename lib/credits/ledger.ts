import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import { db, type DbOrTx } from '@/lib/db/client';
import {
  creditHolds,
  creditLots,
  creditTransactions,
  users,
  type CreditLotSource,
  type CreditTransactionReason,
  type HoldAllocation,
} from '@/lib/db/schema';
import {
  AccountSuspendedError,
  InsufficientCreditsError,
  LedgerIntegrityError,
  isUniqueViolation,
} from './errors';

/* ---------------------------------------------------------------------------
 * Concurrency model
 *
 * Every mutation takes `SELECT … FOR UPDATE` on the user's row first. That row
 * is the lock for the whole of that user's ledger, so all of their credit
 * movements are serialised while leaving different users fully parallel.
 *
 * This is deliberately a pessimistic lock rather than SERIALIZABLE isolation:
 * the contended case (one user firing several AI jobs at once) is common
 * enough that retry-on-serialisation-failure would be a real source of user
 * visible errors, and the critical section here is only a few milliseconds.
 *
 * Idempotency keys are a second, independent line of defence. Even if the lock
 * were somehow not held, the UNIQUE index on credit_transaction.idempotency_key
 * makes a duplicate grant impossible — the insert fails and we return the
 * original result instead.
 * ------------------------------------------------------------------------- */

/** Lock the user row and assert the account may transact. */
async function lockUser(tx: DbOrTx, userId: string): Promise<void> {
  const [user] = await tx
    .select({ id: users.id, suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');

  if (!user) throw new LedgerIntegrityError(`No such user: ${userId}`);
  if (user.suspendedAt) throw new AccountSuspendedError();
}

/** Predicate for lots that still hold spendable credits. */
function liveLot(userId: string) {
  return and(
    eq(creditLots.userId, userId),
    gt(creditLots.amountRemaining, 0),
    or(isNull(creditLots.expiresAt), gt(creditLots.expiresAt, sql`now()`)),
  );
}

export async function getBalance(userId: string, tx: DbOrTx = db): Promise<number> {
  const [row] = await tx
    .select({ balance: sql<number>`coalesce(sum(${creditLots.amountRemaining}), 0)::int` })
    .from(creditLots)
    .where(liveLot(userId));

  return row?.balance ?? 0;
}

/* ---------------------------------------------------------------------------
 * Granting
 * ------------------------------------------------------------------------- */

export interface GrantOptions {
  userId: string;
  amount: number;
  reason: Extract<
    CreditTransactionReason,
    'purchase' | 'signup_grant' | 'promo' | 'manual_adjustment' | 'refund_reversal'
  >;
  source: CreditLotSource;
  sourceRef?: string;
  /** Absolute expiry. Omit for credits that never expire. */
  expiresAt?: Date | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface LedgerResult {
  balance: number;
  /** True when the idempotency key had already been applied and this was a no-op. */
  alreadyApplied: boolean;
}

/**
 * Add credits to an account by opening a new lot.
 *
 * Callers may pass an existing transaction so that granting is atomic with
 * whatever caused it — the Stripe webhook marks the purchase paid and grants
 * the credits in one transaction, so there is no window where money is taken
 * but credits are missing.
 */
export async function grantCredits(opts: GrantOptions, outerTx?: DbOrTx): Promise<LedgerResult> {
  if (!Number.isInteger(opts.amount) || opts.amount <= 0) {
    throw new LedgerIntegrityError(`Grant amount must be a positive integer, got ${opts.amount}`);
  }

  const run = async (tx: DbOrTx): Promise<LedgerResult> => {
    const existing = await findTransactionByKey(tx, opts.idempotencyKey);
    if (existing) return { balance: existing.balanceAfter, alreadyApplied: true };

    await lockUser(tx, opts.userId);

    await tx.insert(creditLots).values({
      userId: opts.userId,
      amountInitial: opts.amount,
      amountRemaining: opts.amount,
      source: opts.source,
      sourceRef: opts.sourceRef ?? null,
      expiresAt: opts.expiresAt ?? null,
    });

    const balance = await getBalance(opts.userId, tx);

    try {
      await tx.insert(creditTransactions).values({
        userId: opts.userId,
        delta: opts.amount,
        balanceAfter: balance,
        reason: opts.reason,
        idempotencyKey: opts.idempotencyKey,
        metadata: opts.metadata ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Lost a race against a concurrent identical grant. Abort so the lot
        // insert above rolls back, then report the winner's result.
        throw new DuplicateGrantSignal(opts.idempotencyKey);
      }
      throw error;
    }

    return { balance, alreadyApplied: false };
  };

  try {
    return outerTx ? await run(outerTx) : await db.transaction(run);
  } catch (error) {
    if (error instanceof DuplicateGrantSignal) {
      const existing = await findTransactionByKey(db, error.idempotencyKey);
      if (existing) return { balance: existing.balanceAfter, alreadyApplied: true };
    }
    throw error;
  }
}

class DuplicateGrantSignal extends Error {
  constructor(readonly idempotencyKey: string) {
    super('duplicate grant');
  }
}

async function findTransactionByKey(tx: DbOrTx, idempotencyKey: string) {
  const [row] = await tx
    .select({ balanceAfter: creditTransactions.balanceAfter })
    .from(creditTransactions)
    .where(eq(creditTransactions.idempotencyKey, idempotencyKey))
    .limit(1);
  return row;
}

/* ---------------------------------------------------------------------------
 * Allocation
 * ------------------------------------------------------------------------- */

/**
 * Draw `amount` credits from the user's live lots, oldest-expiring first, and
 * decrement them in place.
 *
 * FIFO-by-expiry rather than FIFO-by-purchase matters: a user holding a
 * promotional lot expiring next week alongside a pack expiring next year
 * should burn the promo first, or it evaporates while they still had it. That
 * is both fairer and what people expect from any points system.
 *
 * The caller must already hold the user row lock.
 */
async function allocateFromLots(
  tx: DbOrTx,
  userId: string,
  amount: number,
): Promise<HoldAllocation> {
  const lots = await tx
    .select({ id: creditLots.id, remaining: creditLots.amountRemaining })
    .from(creditLots)
    .where(liveLot(userId))
    // NULLS LAST so never-expiring credits are spent only once dated ones are gone.
    .orderBy(sql`${creditLots.expiresAt} asc nulls last`, asc(creditLots.createdAt));

  const available = lots.reduce((sum, lot) => sum + lot.remaining, 0);
  if (available < amount) throw new InsufficientCreditsError(amount, available);

  const allocation: HoldAllocation = [];
  let outstanding = amount;

  for (const lot of lots) {
    if (outstanding === 0) break;
    const take = Math.min(lot.remaining, outstanding);

    await tx
      .update(creditLots)
      .set({ amountRemaining: sql`${creditLots.amountRemaining} - ${take}` })
      .where(eq(creditLots.id, lot.id));

    allocation.push({ lotId: lot.id, amount: take });
    outstanding -= take;
  }

  if (outstanding !== 0) {
    throw new LedgerIntegrityError(`Allocation short by ${outstanding} credits for user ${userId}`);
  }

  return allocation;
}

/** Put credits back into the exact lots they came from. */
async function restoreToLots(tx: DbOrTx, allocation: HoldAllocation): Promise<void> {
  for (const entry of allocation) {
    await tx
      .update(creditLots)
      .set({ amountRemaining: sql`${creditLots.amountRemaining} + ${entry.amount}` })
      .where(eq(creditLots.id, entry.lotId));
  }
}

/* ---------------------------------------------------------------------------
 * Spending
 * ------------------------------------------------------------------------- */

export interface SpendOptions {
  userId: string;
  amount: number;
  reason: CreditTransactionReason;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

/**
 * Charge an account immediately.
 *
 * Use this only for work that cannot fail after the charge — auto-tagging a
 * note from text we already hold, for instance. Anything that calls out to a
 * provider that might time out should use a hold instead, so a failure does
 * not bill the user for nothing.
 */
export async function spendCredits(opts: SpendOptions, outerTx?: DbOrTx): Promise<LedgerResult> {
  if (!Number.isInteger(opts.amount) || opts.amount <= 0) {
    throw new LedgerIntegrityError(`Spend amount must be a positive integer, got ${opts.amount}`);
  }

  const run = async (tx: DbOrTx): Promise<LedgerResult> => {
    const existing = await findTransactionByKey(tx, opts.idempotencyKey);
    if (existing) return { balance: existing.balanceAfter, alreadyApplied: true };

    await lockUser(tx, opts.userId);
    await allocateFromLots(tx, opts.userId, opts.amount);

    const balance = await getBalance(opts.userId, tx);

    await tx.insert(creditTransactions).values({
      userId: opts.userId,
      delta: -opts.amount,
      balanceAfter: balance,
      reason: opts.reason,
      idempotencyKey: opts.idempotencyKey,
      metadata: opts.metadata ?? null,
    });

    return { balance, alreadyApplied: false };
  };

  return outerTx ? run(outerTx) : db.transaction(run);
}

/* ---------------------------------------------------------------------------
 * Holds
 *
 * The lifecycle for anything that can fail:
 *
 *     hold(estimate) → do the work → capture(actual)
 *                                 ↘ release()  on failure
 *
 * Holding decrements the lots straight away, so the balance a user sees
 * already reflects in-flight work and two concurrent jobs cannot both be
 * admitted against the same credits. Capturing for less than was held refunds
 * the difference — you estimate generously and settle honestly.
 * ------------------------------------------------------------------------- */

export interface HoldOptions {
  userId: string;
  /** Upper bound on what the work will cost. */
  amount: number;
  reason: CreditTransactionReason;
  idempotencyKey: string;
  /** How long before the reclaim cron considers this abandoned. */
  ttlMs?: number;
}

const DEFAULT_HOLD_TTL_MS = 15 * 60 * 1000;

export interface HoldResult {
  holdId: string;
  balance: number;
  alreadyApplied: boolean;
}

export async function holdCredits(opts: HoldOptions): Promise<HoldResult> {
  if (!Number.isInteger(opts.amount) || opts.amount <= 0) {
    throw new LedgerIntegrityError(`Hold amount must be a positive integer, got ${opts.amount}`);
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: creditHolds.id, status: creditHolds.status })
      .from(creditHolds)
      .where(eq(creditHolds.idempotencyKey, opts.idempotencyKey))
      .limit(1);

    if (existing) {
      return {
        holdId: existing.id,
        balance: await getBalance(opts.userId, tx),
        alreadyApplied: true,
      };
    }

    await lockUser(tx, opts.userId);
    const allocation = await allocateFromLots(tx, opts.userId, opts.amount);

    const [hold] = await tx
      .insert(creditHolds)
      .values({
        userId: opts.userId,
        amount: opts.amount,
        reason: opts.reason,
        status: 'open',
        allocation,
        idempotencyKey: opts.idempotencyKey,
        expiresAt: new Date(Date.now() + (opts.ttlMs ?? DEFAULT_HOLD_TTL_MS)),
      })
      .returning({ id: creditHolds.id });

    if (!hold) throw new LedgerIntegrityError('Failed to create hold');

    return {
      holdId: hold.id,
      balance: await getBalance(opts.userId, tx),
      alreadyApplied: false,
    };
  });
}

/**
 * Settle a hold at its true cost. `actualAmount` may be less than the amount
 * held — the remainder goes back to the lots it came from — but never more.
 */
export async function captureHold(holdId: string, actualAmount: number): Promise<LedgerResult> {
  if (!Number.isInteger(actualAmount) || actualAmount < 0) {
    throw new LedgerIntegrityError(`Capture amount must be a non-negative integer, got ${actualAmount}`);
  }

  return db.transaction(async (tx) => {
    const [hold] = await tx
      .select()
      .from(creditHolds)
      .where(eq(creditHolds.id, holdId))
      .for('update');

    if (!hold) throw new LedgerIntegrityError(`No such hold: ${holdId}`);
    if (hold.status !== 'open') {
      // Already settled — a retry of the same capture. Report the ledger as it
      // stands rather than charging twice.
      return { balance: await getBalance(hold.userId, tx), alreadyApplied: true };
    }
    if (actualAmount > hold.amount) {
      throw new LedgerIntegrityError(
        `Cannot capture ${actualAmount} against a hold of ${hold.amount}`,
      );
    }

    await lockUser(tx, hold.userId);

    // Give back whatever was over-estimated, proportionally unwinding the
    // allocation from the last lot backwards so the earliest-expiring credits
    // stay spent.
    const refund = hold.amount - actualAmount;
    if (refund > 0) {
      const giveBack: HoldAllocation = [];
      let outstanding = refund;
      for (let i = hold.allocation.length - 1; i >= 0 && outstanding > 0; i--) {
        const entry = hold.allocation[i]!;
        const take = Math.min(entry.amount, outstanding);
        giveBack.push({ lotId: entry.lotId, amount: take });
        outstanding -= take;
      }
      await restoreToLots(tx, giveBack);
    }

    await tx
      .update(creditHolds)
      .set({ status: 'captured', settledAt: new Date() })
      .where(eq(creditHolds.id, holdId));

    const balance = await getBalance(hold.userId, tx);

    if (actualAmount > 0) {
      await tx.insert(creditTransactions).values({
        userId: hold.userId,
        delta: -actualAmount,
        balanceAfter: balance,
        reason: hold.reason,
        idempotencyKey: `hold:${holdId}:capture`,
        holdId,
        metadata: { heldAmount: hold.amount, capturedAmount: actualAmount },
      });
    }

    return { balance, alreadyApplied: false };
  });
}

/** Abandon a hold and return every credit to the lots it came from. */
export async function releaseHold(holdId: string, note = 'released'): Promise<LedgerResult> {
  return db.transaction(async (tx) => {
    const [hold] = await tx
      .select()
      .from(creditHolds)
      .where(eq(creditHolds.id, holdId))
      .for('update');

    if (!hold) throw new LedgerIntegrityError(`No such hold: ${holdId}`);
    if (hold.status !== 'open') {
      return { balance: await getBalance(hold.userId, tx), alreadyApplied: true };
    }

    await lockUser(tx, hold.userId);
    await restoreToLots(tx, hold.allocation);

    await tx
      .update(creditHolds)
      .set({ status: note === 'expired' ? 'expired' : 'released', settledAt: new Date() })
      .where(eq(creditHolds.id, holdId));

    // No credit_transaction row: a released hold never moved the balance, and
    // logging a +0 entry would only make the statement harder to read.
    return { balance: await getBalance(hold.userId, tx), alreadyApplied: false };
  });
}

/**
 * Convenience wrapper for the common shape: hold, run, settle. Guarantees the
 * hold is settled exactly once whichever way the work goes.
 */
export async function withHeldCredits<T>(
  opts: HoldOptions,
  work: (ctx: { holdId: string }) => Promise<{ result: T; actualCredits: number }>,
): Promise<T> {
  const { holdId } = await holdCredits(opts);
  try {
    const { result, actualCredits } = await work({ holdId });
    await captureHold(holdId, actualCredits);
    return result;
  } catch (error) {
    await releaseHold(holdId).catch(() => {
      // Swallow: the reclaim cron will pick this hold up at its TTL. Losing the
      // original error here would be far worse than a delayed refund.
    });
    throw error;
  }
}

/* ---------------------------------------------------------------------------
 * Maintenance (called from cron routes)
 * ------------------------------------------------------------------------- */

/** Release holds whose owning request died before settling them. */
export async function reclaimStaleHolds(limit = 200): Promise<number> {
  const stale = await db
    .select({ id: creditHolds.id })
    .from(creditHolds)
    .where(and(eq(creditHolds.status, 'open'), lte(creditHolds.expiresAt, sql`now()`)))
    .limit(limit);

  let reclaimed = 0;
  for (const hold of stale) {
    try {
      await releaseHold(hold.id, 'expired');
      reclaimed++;
    } catch {
      // Another worker settled it first; nothing to do.
    }
  }
  return reclaimed;
}

/**
 * Write off lots that have passed their expiry.
 *
 * Expired credits already stop counting toward the balance the moment the
 * timestamp passes — this pass exists to zero the lots and record the write-off
 * in the transaction log, so the ledger stays reconcilable and so breakage is
 * a measurable number rather than an inference.
 */
export async function expireCredits(limit = 500): Promise<{ lots: number; credits: number }> {
  const expired = await db
    .select({
      id: creditLots.id,
      userId: creditLots.userId,
      remaining: creditLots.amountRemaining,
    })
    .from(creditLots)
    .where(
      and(
        gt(creditLots.amountRemaining, 0),
        sql`${creditLots.expiresAt} is not null and ${creditLots.expiresAt} <= now()`,
      ),
    )
    .limit(limit);

  let credits = 0;

  for (const lot of expired) {
    await db.transaction(async (tx) => {
      await lockUser(tx, lot.userId);

      const [current] = await tx
        .select({ remaining: creditLots.amountRemaining })
        .from(creditLots)
        .where(eq(creditLots.id, lot.id))
        .for('update');

      if (!current || current.remaining <= 0) return;

      await tx.update(creditLots).set({ amountRemaining: 0 }).where(eq(creditLots.id, lot.id));

      const balance = await getBalance(lot.userId, tx);

      await tx.insert(creditTransactions).values({
        userId: lot.userId,
        delta: -current.remaining,
        balanceAfter: balance,
        reason: 'expiry',
        idempotencyKey: `expiry:${lot.id}`,
        metadata: { lotId: lot.id },
      });

      credits += current.remaining;
    });
  }

  return { lots: expired.length, credits };
}

/* ---------------------------------------------------------------------------
 * Reconciliation
 * ------------------------------------------------------------------------- */

/**
 * Assert the ledger's core invariant for one user:
 *
 *     sum(all transaction deltas) == sum(all lot remainders) + credits held open
 *
 * Lot remainders here are taken across *all* lots including expired ones,
 * because expiry is itself recorded as a negative transaction. Any drift means
 * a bug wrote to lots without logging a transaction. Run in tests and from an
 * admin endpoint; alert on non-zero drift.
 */
export async function reconcile(userId: string): Promise<{
  transactionSum: number;
  lotSum: number;
  heldOpen: number;
  drift: number;
}> {
  const [txRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${creditTransactions.delta}), 0)::int` })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));

  const [lotRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${creditLots.amountRemaining}), 0)::int` })
    .from(creditLots)
    .where(eq(creditLots.userId, userId));

  const [holdRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${creditHolds.amount}), 0)::int` })
    .from(creditHolds)
    .where(and(eq(creditHolds.userId, userId), eq(creditHolds.status, 'open')));

  const transactionSum = txRow?.sum ?? 0;
  const lotSum = lotRow?.sum ?? 0;
  const heldOpen = holdRow?.sum ?? 0;

  return {
    transactionSum,
    lotSum,
    heldOpen,
    drift: transactionSum - (lotSum + heldOpen),
  };
}
