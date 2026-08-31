import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth, signIn } from '@/lib/auth';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'Sign in' };

const SAFE_NEXT = /^\/[a-zA-Z0-9\-_/]*$/;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  const { next } = await searchParams;

  // Only relative in-app paths are accepted as a post-login destination.
  // Passing an attacker-supplied absolute URL through to redirectTo is the
  // classic open-redirect, and it is worth more here than usual because the
  // user arrives at it already authenticated.
  const destination = next && SAFE_NEXT.test(next) ? next : '/record';

  if (session?.user) redirect(destination);

  return (
    <div className={styles.page}>
      <main id="main" className={styles.card}>
        <h1 className={styles.wordmark}>Reel</h1>
        <p className={styles.lead}>
          Sign in to sync across devices and use credits. Your existing notes stay in this browser
          either way.
        </p>

        <form
          action={async () => {
            'use server';
            await signIn('passkey', { redirectTo: destination });
          }}
        >
          <button type="submit" className={`btn btn-primary ${styles.wide}`}>
            Continue with a passkey
          </button>
        </form>
        <p className={styles.hint}>
          Face ID, Touch ID, Windows Hello or a security key. Nothing to remember, and nothing a
          phishing site can capture.
        </p>

        <div className={styles.divider}>
          <span>or</span>
        </div>

        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: destination });
          }}
        >
          <button type="submit" className={`btn ${styles.wide}`}>
            Continue with Google
          </button>
        </form>

        <form
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: destination });
          }}
        >
          <button type="submit" className={`btn ${styles.wide}`}>
            Continue with GitHub
          </button>
        </form>

        <form
          className={styles.emailForm}
          action={async (formData: FormData) => {
            'use server';
            const email = String(formData.get('email') ?? '');
            await signIn('resend', { email, redirectTo: destination });
          }}
        >
          <label htmlFor="email" className="visually-hidden">
            Email address
          </label>
          <input id="email" name="email" type="email" placeholder="you@example.com" required />
          <button type="submit" className="btn">
            Email me a link
          </button>
        </form>

        <p className={styles.footer}>
          <Link href="/">Back to Reel</Link>
        </p>
      </main>
    </div>
  );
}
