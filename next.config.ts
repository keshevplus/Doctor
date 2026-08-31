import type { NextConfig } from 'next';

/*
 * Two build targets from one codebase.
 *
 *   default          → Vercel. Server components, route handlers, middleware,
 *                      Postgres, Stripe. The whole product.
 *   STATIC_EXPORT=1  → GitHub Pages. A pre-rendered bundle of the local-first
 *                      half only, since Pages serves files and nothing else.
 *
 * The static target is produced by scripts/build-pages.mjs, which removes the
 * server-only routes before building rather than stubbing them — a stub would
 * let a dead sign-in button ship.
 */
const isStaticExport = process.env.STATIC_EXPORT === '1';

// Project Pages are served from /<repo>, so assets need that prefix. User or
// custom-domain Pages sit at the root and set BASE_PATH to empty.
const basePath = process.env.BASE_PATH ?? '';

const config: NextConfig = {
  reactStrictMode: true,

  ...(isStaticExport
    ? {
        output: 'export' as const,
        basePath,
        // Trailing slashes make directory-style URLs resolve correctly on a
        // plain file host without server-side rewrites.
        trailingSlash: true,
        // The static host has no image optimiser to call.
        images: { unoptimized: true },
      }
    : {}),

  // Trim the serverless bundle: these are only ever imported from Node-runtime
  // route handlers, never from the edge middleware.
  serverExternalPackages: ['@neondatabase/serverless', 'ws', '@simplewebauthn/server'],

  experimental: {
    // Auth.js v5 gates the WebAuthn (passkey) provider behind this flag.
    authInterrupts: true,
  },

  // Security headers that never need a per-request nonce live here so they are
  // applied by the CDN edge without running middleware. The CSP itself is set
  // in middleware.ts because it carries a per-request nonce.
  //
  // Omitted entirely for the static export: a file host sets no headers, and
  // leaving them configured only produces a warning per build. The static
  // build carries its policy in a meta tag instead (see app/layout.tsx).
  async headers() {
    if (isStaticExport) return [];

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            // Microphone is the one capability Reel genuinely needs.
            value: 'camera=(), geolocation=(), interest-cohort=(), microphone=(self), payment=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default config;
