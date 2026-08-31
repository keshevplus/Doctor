'use client';

import { useState } from 'react';

import { CREDIT_PACKS, centsPerCredit, formatUsd } from '@/lib/credits/pricing';
import styles from './PricingTable.module.css';

interface PricingTableProps {
  /** Signed-out visitors get a sign-in prompt instead of a checkout redirect. */
  canPurchase: boolean;
}

export function PricingTable({ canPurchase }: PricingTableProps) {
  const [pendingPack, setPendingPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buy = async (packId: string) => {
    setPendingPack(packId);
    setError(null);

    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error?.message ?? 'Could not start checkout.');
        setPendingPack(null);
        return;
      }

      window.location.href = payload.url;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setPendingPack(null);
    }
  };

  return (
    <>
      {error ? (
        <p className="banner banner-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.grid}>
        {CREDIT_PACKS.map((pack) => (
          <div
            key={pack.id}
            className={`${styles.pack} ${pack.highlighted ? styles.highlighted : ''}`}
          >
            {pack.highlighted ? <span className={styles.badge}>Most bought</span> : null}

            <h3 className={styles.name}>{pack.name}</h3>
            <p className={styles.price}>{formatUsd(pack.priceCents)}</p>
            <p className={styles.credits}>{pack.credits.toLocaleString()} credits</p>
            <p className={styles.rate}>
              {(centsPerCredit(pack) / 100).toFixed(3).replace(/^0/, '$')} per credit
            </p>
            <p className={styles.blurb}>{pack.blurb}</p>

            {canPurchase ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={pendingPack !== null}
                onClick={() => buy(pack.id)}
              >
                {pendingPack === pack.id ? 'Opening checkout…' : 'Buy'}
              </button>
            ) : (
              <a className="btn btn-primary" href="/signin">
                Sign in to buy
              </a>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
