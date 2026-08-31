import type { NextRequest } from 'next/server';

/**
 * Client IP for rate limiting.
 *
 * On Vercel `x-forwarded-for` is rewritten by the proxy, so its leftmost entry
 * is trustworthy. Behind an infrastructure that appends rather than rewrites,
 * this header is attacker-controlled and must not be used for anything that
 * matters. Rate limiting only, never authorization.
 */
export function clientIp(request: NextRequest | Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}

/** JSON error with a stable machine-readable `code`. */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

export function rateLimitResponse(resetAt: Date): Response {
  const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  return Response.json(
    { error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

/**
 * Reject cross-origin state-changing requests.
 *
 * SameSite=Lax on the session cookie already blocks the classic CSRF shapes,
 * but it does not cover top-level POST navigations in every browser, and it is
 * cheap to check the declared origin as well. Defence in depth on the one
 * class of bug that turns a read-only session into a write.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  // Same-origin fetches from some clients omit Origin entirely; SameSite
  // already covers those.
  if (!origin) return true;

  const appUrl = process.env.APP_URL;
  if (!appUrl) return false;

  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
