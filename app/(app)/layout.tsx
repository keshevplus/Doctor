import Link from 'next/link';

import { AppNav } from '@/components/AppNav';
import { requireUser } from '@/lib/auth/guards';
import { getBalance } from '@/lib/credits/ledger';
import styles from './layout.module.css';

/**
 * Shell for every signed-in route.
 *
 * `requireUser()` here means each of these pages is behind auth by
 * construction rather than by remembering to add a check — a new route dropped
 * into this segment inherits the guard. Middleware also redirects signed-out
 * visitors, but that is a convenience; this is the boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const balance = await getBalance(user.id);

  return (
    <div className="shell">
      <header className={styles.header}>
        <div>
          <h1 className={styles.wordmark}>
            <Link href="/record">Reel</Link>
          </h1>
          <p className={styles.tagline}>Voice notes, transcribed and kept</p>
        </div>

        <Link href="/billing" className={styles.balance}>
          <span className={styles.balanceValue}>{balance.toLocaleString()}</span>
          <span className={styles.balanceLabel}>credits</span>
        </Link>
      </header>

      <AppNav />

      <main id="main">{children}</main>
    </div>
  );
}
