import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Sans } from 'next/font/google';
import { headers } from 'next/headers';

import { IS_STATIC_BUILD } from '@/lib/build-mode';
import './globals.css';

/**
 * CSP for the static build, delivered as a meta tag because GitHub Pages
 * cannot set response headers.
 *
 * Necessarily weaker than the nonce-based policy middleware serves on Vercel:
 * with no server to mint a per-request nonce, inline scripts can only be
 * allowed wholesale. Still worth having — it keeps `object-src`, `base-uri`
 * and `frame-ancestors` locked down, and the static build has no session
 * cookie or API surface for an injected script to abuse.
 */
const STATIC_CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' blob: data:`,
  `font-src 'self'`,
  `media-src 'self' blob:`,
  `connect-src 'self'`,
  `form-action 'self'`,
  `base-uri 'self'`,
  `object-src 'none'`,
  // No frame-ancestors: browsers ignore it when it arrives via <meta>, and
  // leaving it in only logs a console warning on every page load. Clickjacking
  // protection genuinely needs a response header, which GitHub Pages cannot
  // set — one more thing the hosted deployment gets and this build does not.
].join('; ');

/*
 * Fonts are self-hosted by next/font at build time rather than fetched from
 * Google at runtime. Three things fall out of that: no third-party origin in
 * the CSP, no extra DNS/TLS round trip on first paint, and no layout shift,
 * because the metrics-matched fallback is generated automatically.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fraunces',
  display: 'swap',
});

const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Reel — voice notes, transcribed and kept',
    template: '%s · Reel',
  },
  description:
    'Record a thought, get it transcribed, and find it again later. Works offline in your browser; syncs and adds AI when you want it to.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#1e1b18',
  colorScheme: 'dark',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  if (!IS_STATIC_BUILD) {
    /*
     * Reading headers opts this tree into dynamic rendering, and that is the
     * entire point of the call — the return value is unused.
     *
     * A nonce-based CSP only works if the page is rendered per request: Next.js
     * takes the nonce from the Content-Security-Policy header middleware sets
     * and stamps it onto the scripts it injects. Were these routes prerendered
     * at build time instead, every visitor would receive the same baked-in
     * nonce while middleware issued a fresh one per request, and the mismatch
     * would block the app's own scripts.
     *
     * The static export has no middleware and no request to read, so it skips
     * this and carries the weaker meta-tag policy above.
     */
    await headers();
  }

  return (
    <html lang="en" className={`${fraunces.variable} ${plex.variable}`}>
      <head>
        {IS_STATIC_BUILD ? (
          <meta httpEquiv="Content-Security-Policy" content={STATIC_CSP} />
        ) : null}
      </head>
      <body>
        <a href="#main" className="visually-hidden">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
