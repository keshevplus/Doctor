import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';

import { auth } from '@/lib/auth';
import { getBalance } from '@/lib/credits/ledger';
import styles from './AccountBadge.module.css';

/**
 * Credit balance for a signed-in visitor, or a sign-in prompt for everyone
 * else.
 *
 * Its own async server component so the local-first shell can render it inside
 * Suspense — the session lookup and balance query happen off the critical path
 * rather than blocking first paint on pages that do not otherwise need a
 * server at all.
 */
export async function AccountBadge() {
  /*
   * Fails soft, deliberately.
   *
   * This badge is decoration on pages that are otherwise entirely local-first.
   * If the session lookup or the balance query throws — database unreachable,
   * connection limit hit — the recording UI behind it still works perfectly,
   * and taking the whole page down to report that a credit count is unavailable
   * would turn a cosmetic outage into a total one. An app whose selling point
   * is that it works offline must not 500 because Postgres blinked.
   */
  try {
    const userId = (await auth())?.user?.id;

    if (!userId) {
      return (
        <Link href="/signin" className={styles.signin}>
          Sign in
        </Link>
      );
    }

    const balance = await getBalance(userId);

    return (
      <Link href="/billing" className={styles.balance}>
        <span className={styles.value}>{balance.toLocaleString()}</span>
        <span className={styles.label}>credits</span>
      </Link>
    );
  } catch (error) {
    /*
     * Next.js signals control flow by throwing — `redirect()`, `notFound()`,
     * and the DynamicServerError that marks a route as needing per-request
     * rendering all surface as exceptions. Swallowing those would be worse
     * than the outage this catch exists for: absorb the dynamic-usage signal
     * and Next may decide this tree can be prerendered at build time, which
     * would bake one visitor's credit balance into HTML served to everyone.
     *
     * unstable_rethrow re-throws exactly those and leaves genuine failures.
     */
    unstable_rethrow(error);

    console.error('account badge unavailable', error);
    return null;
  }
}

/** Same footprint as the resolved badge, so nothing shifts when it arrives. */
export function AccountBadgePlaceholder() {
  return <span className={styles.placeholder} aria-hidden="true" />;
}
