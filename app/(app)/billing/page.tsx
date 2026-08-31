import type { Metadata } from 'next';
import { desc, eq } from 'drizzle-orm';

import { PricingTable } from '@/components/PricingTable';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db/client';
import { creditTransactions } from '@/lib/db/schema';
import { getBalance } from '@/lib/credits/ledger';
import { ACTION_PRICING, SIGNUP_GRANT_CREDITS } from '@/lib/credits/pricing';
import { formatTimestamp } from '@/lib/export/format';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'Credits' };

// Balances change on purchase and on every AI action, so this page must never
// be served from a cache.
export const dynamic = 'force-dynamic';

const REASON_LABELS: Record<string, string> = {
  purchase: 'Credit pack',
  signup_grant: 'Welcome credits',
  promo: 'Promotional credits',
  manual_adjustment: 'Adjustment',
  refund_reversal: 'Refund',
  expiry: 'Expired',
  transcription: 'Transcription',
  summary: 'Summary',
  auto_tag: 'Auto-tagging',
  ask_notes: 'Ask your notes',
  diarization: 'Speaker labels',
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ purchase?: string; cancelled?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [balance, history] = await Promise.all([
    getBalance(user.id),
    db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, user.id))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(25),
  ]);

  return (
    <>
      {params.purchase ? (
        <p className="banner">
          Payment received. Credits appear here as soon as Stripe confirms the charge — usually
          within a few seconds. Refresh if this page still shows the old balance.
        </p>
      ) : null}

      {params.cancelled ? <p className="banner">Checkout cancelled. Nothing was charged.</p> : null}

      <section className="panel" style={{ marginBottom: 24 }}>
        <p className={styles.balanceLabel}>Balance</p>
        <p className={styles.balance}>{balance.toLocaleString()}</p>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          1 credit = 1 minute of cloud transcription. New accounts start with{' '}
          {SIGNUP_GRANT_CREDITS} free credits.
        </p>
      </section>

      <h2 className={styles.sectionHeading}>Buy credits</h2>
      <PricingTable canPurchase />

      <h2 className={styles.sectionHeading}>What credits buy</h2>
      <div className="panel">
        <table className={styles.rateTable}>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(ACTION_PRICING).map((action) => (
              <tr key={action.action}>
                <td>
                  <strong>{action.label}</strong>
                  <span className={styles.actionDescription}>{action.description}</span>
                </td>
                <td className={styles.rateCell}>
                  {action.credits} {action.credits === 1 ? 'credit' : 'credits'}
                  <span className={styles.rateUnit}>
                    {action.unit === 'per_audio_minute'
                      ? 'per minute'
                      : action.unit === 'per_note'
                        ? 'per note'
                        : 'per question'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className={styles.sectionHeading}>Recent activity</h2>
      {history.length === 0 ? (
        <p className="empty-state">Nothing yet.</p>
      ) : (
        <div className="panel">
          <table className={styles.historyTable}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">Change</th>
                <th scope="col">Balance</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id}>
                  <td className="muted">{formatTimestamp(entry.createdAt.getTime())}</td>
                  <td>{REASON_LABELS[entry.reason] ?? entry.reason}</td>
                  <td className={entry.delta > 0 ? styles.positive : styles.negative}>
                    {entry.delta > 0 ? '+' : ''}
                    {entry.delta}
                  </td>
                  <td className="muted">{entry.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
