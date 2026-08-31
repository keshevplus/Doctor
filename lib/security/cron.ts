import { timingSafeEqual } from 'node:crypto';

/**
 * Verify a Vercel Cron invocation.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Without this check the
 * cron paths are ordinary public routes, and `/api/cron/expire-credits` is not
 * something an anonymous caller should be able to trigger at will.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET is not set; refusing cron invocation');
    return false;
  }

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;

  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);

  // Length must match before timingSafeEqual, which throws on unequal buffers.
  // Comparing lengths first leaks only the secret's length, not its content.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
