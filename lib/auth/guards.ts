import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { auth } from './index';
import { db } from '@/lib/db/client';
import { sessions, users } from '@/lib/db/schema';
import { recordAuditEvent } from './audit';

export interface AuthedUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
}

/**
 * Authorization for server components and route handlers.
 *
 * This — not middleware — is the security boundary. Middleware runs before the
 * route and is convenient for redirects, but it is easy to misconfigure a
 * matcher and leave a route uncovered, and on some deployments it can be
 * bypassed outright. Every protected surface calls this so that being reachable
 * without a session is impossible rather than merely unlikely.
 */
export async function requireUser(): Promise<AuthedUser> {
  const user = (await auth())?.user;

  // `redirect()` throws, so control never reaches the return — but narrowing
  // the whole user object rather than just its id is what lets TypeScript know
  // that.
  if (!user?.id) redirect('/signin');

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    image: user.image ?? null,
  };
}

/** Same check for JSON endpoints, which should get a 401 rather than a redirect. */
export async function requireApiUser(): Promise<AuthedUser | null> {
  const user = (await auth())?.user;
  if (!user?.id) return null;

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    image: user.image ?? null,
  };
}

/**
 * Sign out every device.
 *
 * Deleting the session rows *is* the revocation — this is the capability that
 * database sessions buy and JWTs cannot offer. `sessionsValidFrom` is bumped
 * alongside as a record of when the account was last cleared, and as a
 * tripwire: any session row predating it is evidence of a bug.
 */
export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ token: sessions.sessionToken });

  await db.update(users).set({ sessionsValidFrom: new Date() }).where(eq(users.id, userId));

  await recordAuditEvent({
    userId,
    event: 'auth.sessions_revoked',
    metadata: { reason, count: deleted.length },
  });

  return deleted.length;
}
