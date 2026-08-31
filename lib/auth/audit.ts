import { headers } from 'next/headers';

import { db } from '@/lib/db/client';
import { auditLog } from '@/lib/db/schema';

export interface AuditEvent {
  userId: string | null;
  event: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append a security-relevant event to the audit log.
 *
 * Never throws — an audit failure must not take down the operation it was
 * describing. Losing a log line is bad; failing a sign-in because the log
 * table is momentarily unavailable is worse.
 */
export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  try {
    let ip: string | null = null;
    let userAgent: string | null = null;

    try {
      const h = await headers();
      // Vercel sets x-forwarded-for; the leftmost entry is the client. Trusted
      // only because Vercel's proxy rewrites it — never trust this header when
      // running behind something that merely appends.
      ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
      userAgent = h.get('user-agent');
    } catch {
      // Called outside a request scope (a cron job, say). Fine — the event
      // still has value without request metadata.
    }

    await db.insert(auditLog).values({
      userId: event.userId,
      event: event.event,
      ip,
      userAgent: userAgent?.slice(0, 512) ?? null,
      metadata: event.metadata ?? null,
    });
  } catch (error) {
    console.error('audit log write failed', { event: event.event, error });
  }
}
