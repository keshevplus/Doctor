import { lt, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { rateLimitBuckets } from '@/lib/db/schema';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: Date;
}

export interface RateLimitOptions {
  /** Logical bucket, e.g. 'signin' or 'transcribe'. */
  scope: string;
  /** Who is being limited — a user id where known, otherwise a client IP. */
  subject: string;
  limit: number;
  windowMs: number;
}

/**
 * Fixed-window rate limiter backed by Postgres.
 *
 * A fixed window rather than a sliding one: it is a single atomic upsert, and
 * the worst case — 2× the limit across a window boundary — is acceptable for
 * every bucket here. A sliding window would need either a sorted set (Redis) or
 * a per-hit row, and neither is worth the cost at this stage.
 *
 * Swap this for Upstash Redis when write volume makes the extra row-per-window
 * per-subject noticeable; the interface is intentionally narrow enough that
 * nothing else has to change.
 */
export async function rateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / opts.windowMs) * opts.windowMs;
  const resetAt = new Date(windowStart + opts.windowMs);
  const key = `${opts.scope}:${opts.subject}:${windowStart}`;

  try {
    const [row] = await db
      .insert(rateLimitBuckets)
      .values({ key, count: 1, expiresAt: resetAt })
      .onConflictDoUpdate({
        target: rateLimitBuckets.key,
        set: { count: sql`${rateLimitBuckets.count} + 1` },
      })
      .returning({ count: rateLimitBuckets.count });

    const count = row?.count ?? 1;
    return {
      ok: count <= opts.limit,
      remaining: Math.max(0, opts.limit - count),
      resetAt,
    };
  } catch (error) {
    // Fail open. A limiter that takes the whole app down when the database
    // hiccups is a worse outage than the abuse it was preventing. The tradeoff
    // would be different for a bucket guarding something irreversible.
    console.error('rate limit check failed, allowing request', { scope: opts.scope, error });
    return { ok: true, remaining: opts.limit, resetAt };
  }
}

/** Housekeeping for expired buckets; called from the cron route. */
export async function pruneRateLimitBuckets(): Promise<number> {
  const deleted = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.expiresAt, new Date()))
    .returning({ key: rateLimitBuckets.key });
  return deleted.length;
}

/**
 * Preset buckets.
 *
 * Auth endpoints are tight because they are the ones worth brute-forcing.
 * Credit-spending endpoints are limited per user as a blast-radius control on
 * a stolen session: an attacker with a valid cookie still cannot drain an
 * account's credits in one burst.
 */
export const LIMITS = {
  signin: { limit: 10, windowMs: 15 * 60 * 1000 },
  signinPerIp: { limit: 30, windowMs: 15 * 60 * 1000 },
  passkeyRegister: { limit: 5, windowMs: 60 * 60 * 1000 },
  checkout: { limit: 10, windowMs: 60 * 60 * 1000 },
  transcribe: { limit: 60, windowMs: 60 * 60 * 1000 },
  ai: { limit: 120, windowMs: 60 * 60 * 1000 },
  notesWrite: { limit: 600, windowMs: 60 * 60 * 1000 },
} as const;
