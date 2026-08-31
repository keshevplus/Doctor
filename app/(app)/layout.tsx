import Link from 'next/link';

import { Shell } from '@/components/Shell';
import { requireUser } from '@/lib/auth/guards';
import { getBalance } from '@/lib/credits/ledger';
import styles from '@/components/AccountBadge.module.css';

/**
 * Shell for routes that genuinely need an account — currently just billing.
 *
 * `requireUser()` here is the authorization boundary: anything dropped into
 * this segment inherits it, rather than depending on someone remembering to
 * add a check. The local-first routes live in `(local)` precisely because they
 * do not belong behind it.
 */
export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const balance = await getBalance(user.id);

  return (
    <Shell
      badge={
        <Link href="/billing" className={styles.balance}>
          <span className={styles.value}>{balance.toLocaleString()}</span>
          <span className={styles.label}>credits</span>
        </Link>
      }
    >
      {children}
    </Shell>
  );
}
