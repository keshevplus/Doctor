import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

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
  async headers() {
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
