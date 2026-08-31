import Link from 'next/link';

import { AppNav } from './AppNav';
import styles from './Shell.module.css';

interface ShellProps {
  /** Rendered top-right: a credit balance, a sign-in link, or nothing. */
  badge?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The app chrome — wordmark, tab bar, main region.
 *
 * Shared by both route groups. The local-first group and the auth-gated group
 * differ only in what they can put in the badge slot, and duplicating the
 * header to express that difference would guarantee the two drift apart.
 */
export function Shell({ badge, children }: ShellProps) {
  return (
    <div className="shell">
      <header className={styles.header}>
        <div>
          <h1 className={styles.wordmark}>
            <Link href="/record">Reel</Link>
          </h1>
          <p className={styles.tagline}>Voice notes, transcribed and kept</p>
        </div>
        {badge}
      </header>

      <AppNav />

      <main id="main">{children}</main>
    </div>
  );
}
