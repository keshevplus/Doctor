import type { NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';

/**
 * Edge-safe half of the auth configuration.
 *
 * Deliberately imports nothing that touches the database, the Node crypto
 * module or the WebAuthn library, so it can be pulled into middleware without
 * dragging the Postgres driver into the edge bundle. The adapter, the passkey
 * provider and every database-backed callback live in ./index.ts, which only
 * ever runs in the Node runtime.
 */

const isProduction = process.env.NODE_ENV === 'production';

export const authConfig = {
  // Database sessions, not JWT. A JWT cannot be revoked before it expires,
  // which means "sign out all devices" and "lock this account now" are both
  // unimplementable. Paying one indexed lookup per request buys real
  // revocation, and that is the right trade for an app holding people's notes.
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60,
    // Only rewrite the session row once a day rather than on every request.
    updateAge: 24 * 60 * 60,
  },

  pages: {
    signIn: '/signin',
    verifyRequest: '/signin/check-email',
    error: '/signin/error',
  },

  cookies: {
    sessionToken: {
      // The __Host- prefix is enforced by the browser: the cookie must be
      // Secure, Path=/, and carry no Domain attribute. That last part is the
      // valuable one — it makes the cookie unsettable by any subdomain, so a
      // compromised marketing subdomain cannot plant a session fixation cookie
      // on the app. Auth.js defaults to the weaker __Secure- prefix.
      name: isProduction ? '__Host-authjs.session-token' : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isProduction,
      },
    },
  },

  providers: [
    Google({
      allowDangerousEmailAccountLinking: false,
    }),
    GitHub({
      allowDangerousEmailAccountLinking: false,
    }),
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.AUTH_EMAIL_FROM,
      // Short window. A magic link sitting in an inbox is a bearer token; the
      // Auth.js default of 24 hours is far longer than anyone needs to click.
      maxAge: 10 * 60,
    }),
  ],

  // Vercel terminates TLS upstream, so trust the forwarded host.
  trustHost: true,
} satisfies NextAuthConfig;

/**
 * Account linking is off above, and that is a security decision rather than an
 * oversight.
 *
 * With it on, a provider that does not verify email ownership lets an attacker
 * register an account at that provider using a victim's address and get merged
 * into the victim's existing Reel account. Users who want several sign-in
 * methods link them explicitly from settings while already authenticated,
 * which proves control of the original account first.
 */
