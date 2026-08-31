import { ACTION_PRICING, type MeteredAction } from './pricing';
import { getBalance, spendCredits, withHeldCredits } from './ledger';
import { InsufficientCreditsError } from './errors';

/**
 * Translates product actions into credit amounts, so no route handler ever
 * hard-codes a price. Changing what a summary costs is a one-line edit in
 * pricing.ts and it propagates here, to the pricing page and to the quote the
 * client shows before the user commits.
 */

/** Credits required to perform `action` over `units` (minutes, notes or queries). */
export function quote(action: MeteredAction, units = 1): number {
  const pricing = ACTION_PRICING[action];
  // Always round up: a 61-second recording costs two minutes. Billing a
  // fraction of a credit would make balances impossible to reason about.
  return pricing.credits * Math.max(1, Math.ceil(units));
}

export function quoteAudio(action: Extract<MeteredAction, 'transcription' | 'diarization'>, durationSec: number): number {
  return quote(action, durationSec / 60);
}

/** Check affordability without moving anything. For enabling/disabling UI. */
export async function canAfford(userId: string, action: MeteredAction, units = 1): Promise<boolean> {
  return (await getBalance(userId)) >= quote(action, units);
}

/**
 * Run work that costs credits, holding an estimate up front and settling at the
 * true cost afterwards.
 *
 * `work` returns the actual units consumed, which for transcription is the
 * real audio duration the provider reported rather than the client's estimate
 * — clients under-report, deliberately or otherwise, and the provider's number
 * is the one we were actually billed for.
 */
export async function meteredRun<T>(params: {
  userId: string;
  action: MeteredAction;
  /** Upper-bound estimate, used for the hold. */
  estimatedUnits: number;
  idempotencyKey: string;
  ttlMs?: number;
  work: () => Promise<{ result: T; actualUnits: number }>;
}): Promise<{ result: T; creditsCharged: number }> {
  const estimate = quote(params.action, params.estimatedUnits);

  let charged = estimate;

  const result = await withHeldCredits(
    {
      userId: params.userId,
      amount: estimate,
      reason: params.action,
      idempotencyKey: params.idempotencyKey,
      ttlMs: params.ttlMs,
    },
    async () => {
      const { result, actualUnits } = await params.work();
      // Never charge more than was held, even if the provider reports a longer
      // duration than estimated — the hold is the ceiling the user agreed to.
      charged = Math.min(quote(params.action, actualUnits), estimate);
      return { result, actualCredits: charged };
    },
  );

  return { result, creditsCharged: charged };
}

/**
 * Charge for work that has already completed and cannot fail — typically
 * something computed from data we already hold.
 */
export async function meteredCharge(params: {
  userId: string;
  action: MeteredAction;
  units?: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const amount = quote(params.action, params.units ?? 1);
  await spendCredits({
    userId: params.userId,
    amount,
    reason: params.action,
    idempotencyKey: params.idempotencyKey,
    metadata: params.metadata,
  });
  return amount;
}

export { InsufficientCreditsError };
