import NextAuth from 'next-auth';
import Passkey from 'next-auth/providers/passkey';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { accounts, authenticators, sessions, users, verificationTokens } from '@/lib/db/schema';
import { grantCredits } from '@/lib/credits/ledger';
import { SIGNUP_GRANT_CREDITS, SIGNUP_GRANT_EXPIRY_DAYS } from '@/lib/credits/pricing';
import { recordAuditEvent } from './audit';
import { authConfig } from './config';

/**
 * Node-runtime auth. Everything that needs the database lives here.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
    authenticatorsTable: authenticators,
  }),

  // Required for the passkey provider.
  experimental: { enableWebAuthn: true },

  providers: [
    ...authConfig.providers,
    // Passkeys are the primary factor. The server stores only a public key, so
    // a database breach yields nothing an attacker can sign in with, and the
    // credential is bound to this origin by the browser, which makes it
    // phishing-resistant in a way no OTP or password can be.
    Passkey,
  ],

  callbacks: {
    async session({ session, user }) {
      // Expose the user id to server components; everything downstream keys
      // off it. Nothing sensitive beyond that goes into the session object.
      session.user.id = user.id;
      return session;
    },

    async signIn({ user }) {
      if (!user.id) return true;

      const [row] = await db
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      // Refuse sign-in outright for suspended accounts rather than letting a
      // session exist and failing later at the point of spend.
      return !row?.suspendedAt;
    },
  },

  events: {
    async createUser({ user }) {
      if (!user.id) return;

      // Give new accounts something to try the paid features with. Keyed on
      // the user id so a retried adapter call cannot double-grant.
      await grantCredits({
        userId: user.id,
        amount: SIGNUP_GRANT_CREDITS,
        reason: 'signup_grant',
        source: 'signup_grant',
        expiresAt: new Date(Date.now() + SIGNUP_GRANT_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        idempotencyKey: `signup_grant:${user.id}`,
      }).catch((error) => {
        // A failed welcome grant must not block account creation. It is
        // recoverable by re-running the grant with the same key.
        console.error('signup grant failed', { userId: user.id, error });
      });

      await recordAuditEvent({ userId: user.id, event: 'account.created' });
    },

    async signIn({ user, account }) {
      await recordAuditEvent({
        userId: user.id ?? null,
        event: 'auth.signin',
        metadata: { provider: account?.provider ?? 'unknown' },
      });
    },

    async signOut(message) {
      const userId =
        'token' in message ? (message.token?.sub ?? null) : (message.session?.userId ?? null);
      await recordAuditEvent({ userId, event: 'auth.signout' });
    },
  },
});
