import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Sans } from 'next/font/google';
import { headers } from 'next/headers';

import './globals.css';

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
  // The nonce minted by middleware for this request. Next.js reads it off the
  // header automatically and stamps it onto the scripts it injects.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={`${fraunces.variable} ${plex.variable}`}>
      <body>
        <a href="#main" className="visually-hidden">
          Skip to content
        </a>
        {children}
        {nonce ? <meta name="csp-nonce" content={nonce} /> : null}
      </body>
    </html>
  );
}
