import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PricingTable } from '@/components/PricingTable';
import { auth } from '@/lib/auth';
import { FULL_APP_URL, IS_STATIC_BUILD } from '@/lib/build-mode';
import { ACTION_PRICING, SIGNUP_GRANT_CREDITS, SUBSCRIPTION, formatUsd } from '@/lib/credits/pricing';
import styles from './page.module.css';

export default async function LandingPage() {
  // The static build has no session to read. On Vercel, signed-in visitors
  // have no use for the pitch and go straight to the app.
  if (!IS_STATIC_BUILD) {
    const session = await auth();
    if (session?.user) redirect('/record');
  }

  return (
    <div className="shell">
      <main id="main">
        <header className={styles.hero}>
          <h1 className={styles.wordmark}>Reel</h1>
          <p className={styles.pitch}>
            Say the thing before you lose it. Reel records, transcribes as you speak, and keeps it
            somewhere you can actually find it again.
          </p>
          <div className={styles.heroActions}>
            {/* Straight into the app: recording needs no account, so sending
                people to a sign-in page first would be a pointless gate. */}
            <Link href="/record" className="btn btn-primary">
              Start recording
            </Link>
            <a href="#pricing" className="btn">
              See pricing
            </a>
          </div>
          <p className={styles.note}>
            Recording, transcription in your browser, tagging, search and export are free and work
            offline. No account needed to try it.
          </p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.heading}>Your notes stay yours</h2>
          <div className={styles.featureGrid}>
            <Feature
              title="Works without an account"
              body="Notes are stored in your browser. Nothing is uploaded until you sign in and turn on sync, and you can export everything as text, Markdown or JSON at any time."
            />
            <Feature
              title="Live transcription, free"
              body="Your browser's own speech recognition writes the transcript as you talk. It costs nothing because it never leaves your device."
            />
            <Feature
              title="Credits only for the heavy lifting"
              body="Cloud transcription, summaries and asking questions across your archive cost credits, because they cost us. Everything else does not."
            />
          </div>
        </section>

        <section className={styles.section} id="pricing">
          <h2 className={styles.heading}>Pricing</h2>
          <p className={styles.sectionLead}>
            One credit is one minute of cloud transcription. Buy a pack when you need one — they do
            not auto-renew, and new accounts start with {SIGNUP_GRANT_CREDITS} credits free.
          </p>

          {IS_STATIC_BUILD && !FULL_APP_URL ? (
            <p className="banner">
              This is the free, offline build. Credits and the AI features need the hosted version,
              which is not linked from here yet.
            </p>
          ) : null}

          <PricingTable
            canPurchase={false}
            signInHref={IS_STATIC_BUILD ? (FULL_APP_URL ?? '/record') : '/signin'}
          />

          <h3 className={styles.subheading}>What credits buy</h3>
          <ul className={styles.rateList}>
            {Object.values(ACTION_PRICING).map((action) => (
              <li key={action.action}>
                <strong>{action.label}</strong>
                <span className={styles.rate}>
                  {action.credits} {action.credits === 1 ? 'credit' : 'credits'}{' '}
                  {action.unit === 'per_audio_minute'
                    ? 'per minute'
                    : action.unit === 'per_note'
                      ? 'per note'
                      : 'per question'}
                </span>
              </li>
            ))}
          </ul>

          <div className={styles.subscription}>
            <h3 className={styles.subheading}>Or subscribe</h3>
            <p>
              <strong>{SUBSCRIPTION.name}</strong> — {formatUsd(SUBSCRIPTION.priceCentsMonthly)} a
              month, including {SUBSCRIPTION.monthlyCredits} credits that roll over up to{' '}
              {SUBSCRIPTION.monthlyCredits * SUBSCRIPTION.rolloverCapMultiple}.
            </p>
            <ul className={styles.perks}>
              {SUBSCRIPTION.perks.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>
          </div>
        </section>

        <footer className={styles.footer}>
          {IS_STATIC_BUILD ? (
            <>
              <Link href="/record">Open Reel</Link>
              <span aria-hidden="true">·</span>
              {FULL_APP_URL ? (
                <>
                  <a href={FULL_APP_URL}>Full version with sync &amp; AI</a>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <a href="https://github.com/keshevplus/Doctor">Source</a>
            </>
          ) : (
            <>
              <Link href="/signin">Sign in</Link>
              <span aria-hidden="true">·</span>
              <Link href="/privacy">Privacy</Link>
              <span aria-hidden="true">·</span>
              <Link href="/terms">Terms</Link>
            </>
          )}
        </footer>
      </main>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel">
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.featureBody}>{body}</p>
    </div>
  );
}
