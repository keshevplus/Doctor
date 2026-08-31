import { expireCredits } from '@/lib/credits/ledger';
import { isAuthorizedCron } from '@/lib/security/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Writes off lots past their expiry date.
 *
 * Expired credits already stop counting toward a balance the moment the
 * timestamp passes — this exists so the write-off appears in the transaction
 * log, which is what makes breakage a measured number rather than a guess.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await expireCredits();
  return Response.json(result);
}
