import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware. Two jobs, and neither of them is authorization.
 *
 *   1. Attach a Content-Security-Policy carrying a fresh per-request nonce.
 *   2. Redirect obviously-signed-out visitors away from app routes, so they
 *      land on the sign-in page instead of a flash of empty UI.
 *
 * The redirect is a *user experience* affordance built on the mere presence of
 * a cookie — it does not validate anything. Real authorization happens in
 * `requireUser()` inside every protected route. Treating a middleware matcher
 * as a security boundary is a well-worn way to ship an auth bypass: one
 * mismatched glob and a route is silently public.
 *
 * Deliberately does not call `auth()`. Doing so would put a database round
 * trip in front of every request including static assets, for a check the
 * route is about to repeat anyway.
 */

const APP_ROUTES = ['/record', '/notes', '/analysis', '/billing', '/settings'];

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';

  return [
    `default-src 'self'`,
    // 'strict-dynamic' lets the nonce-approved Next.js bootstrap load the rest
    // of the chunk graph, so no bundle hash has to be enumerated here.
    // unsafe-eval is dev-only — the React refresh runtime needs it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ''}`,
    // Next.js injects inline <style> for critical CSS and does not nonce it,
    // so unsafe-inline is unavoidable here. Low risk: style injection without
    // script injection is a defacement, not a data breach.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com`,
    // Fonts are self-hosted via next/font — no external font origin needed.
    `font-src 'self'`,
    // Recorded audio is played from blob: URLs locally and from Vercel Blob
    // once uploaded.
    `media-src 'self' blob: https://*.public.blob.vercel-storage.com`,
    `connect-src 'self' https://*.public.blob.vercel-storage.com https://api.stripe.com`,
    `frame-src https://js.stripe.com https://hooks.stripe.com`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  const { pathname } = request.nextUrl;
  const needsSession = APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (needsSession && !hasSessionCookie(request)) {
    const signin = new URL('/signin', request.url);
    signin.searchParams.set('next', pathname);
    return NextResponse.redirect(signin);
  }

  // The nonce travels to the app on a request header so the root layout can
  // read it and stamp it onto its own <script> tags.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  return response;
}

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has('__Host-authjs.session-token') ||
    request.cookies.has('__Secure-authjs.session-token') ||
    request.cookies.has('authjs.session-token')
  );
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the image optimiser. The webhook
     * route is excluded too — Stripe does not need a CSP and the redirect
     * logic must never touch it.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|.*\\.(?:png|jpg|jpeg|svg|webp|woff2)$).*)',
  ],
};
