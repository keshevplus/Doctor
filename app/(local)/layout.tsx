import { Suspense } from 'react';

import { AccountBadge, AccountBadgePlaceholder } from '@/components/AccountBadge';
import { Shell } from '@/components/Shell';
import { IS_STATIC_BUILD } from '@/lib/build-mode';

/**
 * Shell for the local-first routes: record, notes, analysis.
 *
 * Deliberately **not** auth-gated. These pages read and write IndexedDB in the
 * browser and never touch the server, which is what the landing page promises
 * ("no account needed") and what makes the free tier cost nothing to serve.
 * Gating them would have been both a broken promise and a self-inflicted
 * hosting bill.
 *
 * The signed-in badge streams in behind Suspense so the shell paints without
 * waiting on a session lookup. In the static build there is no session to read,
 * so it renders nothing rather than a sign-in button that could not work.
 */
export default function LocalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell
      badge={
        IS_STATIC_BUILD ? null : (
          <Suspense fallback={<AccountBadgePlaceholder />}>
            <AccountBadge />
          </Suspense>
        )
      }
    >
      {children}
    </Shell>
  );
}
