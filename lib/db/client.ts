import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import * as schema from './schema';

/**
 * Note the driver choice: `neon-serverless` (WebSocket), not `neon-http`.
 *
 * The HTTP driver is faster for one-shot queries but it cannot open a
 * transaction, and the credit ledger is built entirely on multi-statement
 * transactions with row locks. Using the HTTP driver here would silently
 * degrade every `db.transaction()` call into a series of autocommitted
 * statements — which is exactly how you end up double-spending credits under
 * concurrency.
 */
if (typeof WebSocket === 'undefined') {
  // Node runtime (Vercel serverless functions) has no global WebSocket.
  neonConfig.webSocketConstructor = ws;
}

declare global {
  var __reelPool: Pool | undefined;
}

/**
 * `next build` evaluates every route module to collect page data, so throwing
 * here for a missing DATABASE_URL would make the build itself require
 * production secrets.
 *
 * It does not need to. `new Pool()` opens no socket — it connects on first
 * query — so constructing eagerly is already lazy where it counts. When the
 * variable is absent we hand it a placeholder whose *hostname* names the
 * problem, so the eventual connection failure reads
 * `getaddrinfo ENOTFOUND DATABASE_URL-is-not-set` rather than something about
 * localhost and a refused port.
 *
 * The adapter must receive a genuine Drizzle instance, incidentally: Auth.js
 * detects the dialect by inspecting it, and a lazy Proxy standing in for one
 * fails that check with "Unsupported database type (object)".
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://unset:unset@DATABASE_URL-is-not-set:5432/unset';

// Reuse the pool across hot reloads in dev and across warm invocations in
// production. A fresh Pool per request exhausts Neon's connection limit fast.
const pool =
  globalThis.__reelPool ??
  new Pool({
    connectionString,
    // Serverless functions handle one request at a time, so a large pool per
    // instance buys nothing and costs connections.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__reelPool = pool;
}

export const db = drizzle(pool, { schema });

export type Db = typeof db;

/**
 * The type of the transaction handle passed to `db.transaction(async (tx) => …)`.
 * Ledger helpers accept either `db` or a `tx` so they can compose into a larger
 * transaction — granting credits and marking a purchase paid must be atomic.
 */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export { schema };
