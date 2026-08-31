import { reclaimStaleHolds } from '@/lib/credits/ledger';
import { pruneRateLimitBuckets } from '@/lib/security/rate-limit';
import { isAuthorizedCron } from '@/lib/security/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Returns credits stranded by requests that died mid-flight.
 *
 * A function that times out between holding credits and settling the hold
 * leaves the user's balance short until this runs. Every ten minutes bounds
 * how long that can last.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reclaimed = await reclaimStaleHolds();
  const prunedBuckets = await pruneRateLimitBuckets();

  return Response.json({ reclaimed, prunedBuckets });
}
