/**
 * Whether this bundle is the static export destined for GitHub Pages.
 *
 * GitHub Pages serves files, nothing more: no Node runtime, no request
 * handlers, no database, no place to keep a secret. So the static build ships
 * only the local-first half of Reel — recording, notes, analysis, export — all
 * of which run entirely in the browser against IndexedDB and genuinely need no
 * server.
 *
 * Anything that reads a cookie, queries Postgres or talks to Stripe is
 * excluded from that build rather than stubbed. A stub would let a broken
 * sign-in button ship; an exclusion cannot.
 *
 * Read via `NEXT_PUBLIC_` so the value is inlined at build time and usable
 * from both server and client components.
 */
export const IS_STATIC_BUILD = process.env.NEXT_PUBLIC_STATIC_BUILD === '1';

/**
 * Where the full, server-backed deployment lives — the Vercel URL. The static
 * build links out to it for anything it cannot do itself: signing in, buying
 * credits, sync.
 *
 * Undefined until someone sets it. That is deliberate: with no value, the
 * static build simply omits those links rather than pointing them at a guessed
 * domain that may belong to somebody else.
 */
export const FULL_APP_URL = process.env.NEXT_PUBLIC_FULL_APP_URL || null;
