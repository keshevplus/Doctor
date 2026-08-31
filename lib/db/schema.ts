import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AdapterAccountType } from 'next-auth/adapters';

/* ---------------------------------------------------------------------------
 * Auth.js tables
 *
 * Shapes are dictated by @auth/drizzle-adapter — do not rename columns. We use
 * database sessions rather than JWTs so that a session can actually be revoked
 * server-side (see lib/auth/sessions.ts). A stolen JWT is valid until it
 * expires; a stolen database session dies the moment we delete the row.
 * ------------------------------------------------------------------------- */

export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date', withTimezone: true }),
  image: text('image'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  // Bumped whenever the account's security posture changes (passkey removed,
  // email changed, user hits "sign out everywhere"). Sessions issued before
  // this instant are rejected even if their row still exists.
  sessionsValidFrom: timestamp('sessions_valid_from', { withTimezone: true })
    .notNull()
    .defaultNow(),

  // Set when an account is suspended for abuse. Checked on every credit spend.
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),

  stripeCustomerId: text('stripe_customer_id').unique(),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable(
  'session',
  {
    sessionToken: text('sessionToken').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),

    // Recorded at sign-in for the "active devices" screen. Never used for
    // authorization — IPs move and user agents lie.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenIp: text('last_seen_ip'),
    lastSeenUserAgent: text('last_seen_user_agent'),
  },
  (table) => [index('session_user_idx').on(table.userId)],
);

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    // Auth.js stores the magic-link token hashed; we never see the plaintext
    // after it leaves in the email.
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/**
 * WebAuthn credentials. The `credentialPublicKey` is exactly that — public —
 * so a database leak does not let an attacker authenticate as anyone. This is
 * the whole reason passkeys are the primary factor here rather than passwords.
 */
export const authenticators = pgTable(
  'authenticator',
  {
    credentialID: text('credentialID').notNull().unique(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerAccountId: text('providerAccountId').notNull(),
    credentialPublicKey: text('credentialPublicKey').notNull(),
    counter: integer('counter').notNull(),
    credentialDeviceType: text('credentialDeviceType').notNull(),
    credentialBackedUp: boolean('credentialBackedUp').notNull(),
    transports: text('transports'),

    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.credentialID] })],
);

/* ---------------------------------------------------------------------------
 * Notes
 * ------------------------------------------------------------------------- */

export const notes = pgTable(
  'note',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    text: text('text').notNull().default(''),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),

    audioUrl: text('audio_url'),
    audioDurationSec: integer('audio_duration_sec'),

    summary: text('summary'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // Soft delete. Sync needs to replicate a deletion to other devices, which
    // a hard delete cannot express. Purged for real by a retention job.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    // Monotonic per-note counter for last-writer-wins sync conflict resolution.
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('note_user_updated_idx').on(table.userId, table.updatedAt),
    index('note_tags_idx').using('gin', table.tags),
  ],
);

/* ---------------------------------------------------------------------------
 * Credit ledger
 *
 * Three tables, and the split matters:
 *
 *   credit_lot         — a *balance-bearing* bucket. Credits enter the system
 *                        only by creating a lot. Each lot has its own expiry,
 *                        so "expire the oldest credits first" is expressible.
 *   credit_transaction — an append-only audit log. Never mutated, never
 *                        deleted. This is what you reconcile against and what
 *                        you show a customer who disputes a charge.
 *   credit_hold        — a reservation against lots for work that may fail.
 *
 * The invariant that makes this whole thing auditable:
 *
 *   balance(user) == SUM(credit_lot.amount_remaining) WHERE not expired
 *                 == SUM(credit_transaction.delta)
 *
 * A hold decrements `amount_remaining` immediately, so a held credit cannot be
 * double-spent by a concurrent request — the balance a user sees is already
 * net of in-flight work.
 * ------------------------------------------------------------------------- */

export type CreditLotSource = 'purchase' | 'signup_grant' | 'promo' | 'manual_adjustment' | 'refund_reversal';

export const creditLots = pgTable(
  'credit_lot',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    amountInitial: integer('amount_initial').notNull(),
    amountRemaining: integer('amount_remaining').notNull(),

    source: text('source').$type<CreditLotSource>().notNull(),
    // purchase.id for 'purchase', a promo code for 'promo', an admin user id
    // for 'manual_adjustment'.
    sourceRef: text('source_ref'),

    // NULL means never expires. Signup grants expire; purchased credits get a
    // long window (see lib/credits/pricing.ts).
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The FIFO consumption query: live lots for a user, oldest-expiring first.
    // Partial index keeps it small — drained lots are the majority over time
    // but are never scanned.
    index('credit_lot_spend_idx')
      .on(table.userId, table.expiresAt, table.createdAt)
      .where(sql`${table.amountRemaining} > 0`),
  ],
);

export type CreditTransactionReason =
  | 'purchase'
  | 'signup_grant'
  | 'promo'
  | 'manual_adjustment'
  | 'refund_reversal'
  | 'expiry'
  | 'transcription'
  | 'summary'
  | 'auto_tag'
  | 'ask_notes'
  | 'diarization';

export const creditTransactions = pgTable(
  'credit_transaction',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Positive for grants, negative for spends. Never zero.
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),

    reason: text('reason').$type<CreditTransactionReason>().notNull(),

    // The single most important column in this schema. Every caller that can
    // be retried — Stripe webhooks, client-initiated AI jobs, cron sweeps —
    // supplies a stable key, and the UNIQUE constraint turns "retry" into
    // "no-op" at the database level rather than in application logic that can
    // be raced.
    idempotencyKey: text('idempotency_key').notNull(),

    holdId: text('hold_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('credit_transaction_idem_idx').on(table.idempotencyKey),
    index('credit_transaction_user_idx').on(table.userId, table.createdAt),
  ],
);

export type CreditHoldStatus = 'open' | 'captured' | 'released' | 'expired';

/** Which lots a hold drew from, so a release can put the credits back exactly. */
export type HoldAllocation = { lotId: string; amount: number }[];

export const creditHolds = pgTable(
  'credit_hold',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    amount: integer('amount').notNull(),
    status: text('status').$type<CreditHoldStatus>().notNull().default('open'),
    reason: text('reason').$type<CreditTransactionReason>().notNull(),

    allocation: jsonb('allocation').$type<HoldAllocation>().notNull(),

    idempotencyKey: text('idempotency_key').notNull(),

    // A crashed function leaves an open hold behind. The reclaim cron releases
    // anything past this instant so credits are never stranded.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('credit_hold_idem_idx').on(table.idempotencyKey),
    index('credit_hold_reclaim_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'open'`),
  ],
);

/* ---------------------------------------------------------------------------
 * Billing
 * ------------------------------------------------------------------------- */

export type PurchaseStatus = 'pending' | 'paid' | 'refunded' | 'failed';

export const purchases = pgTable(
  'purchase',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    packId: text('pack_id').notNull(),
    credits: integer('credits').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('usd'),

    status: text('status').$type<PurchaseStatus>().notNull().default('pending'),

    stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [index('purchase_user_idx').on(table.userId, table.createdAt)],
);

/**
 * Stripe delivers webhooks at-least-once and will happily send the same event
 * twice. Inserting the event id here is the gate: if the insert conflicts, we
 * have already granted those credits and the delivery is dropped.
 */
export const processedWebhookEvents = pgTable('processed_webhook_event', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------------------------------------------------------------------
 * Audit log
 *
 * Security-relevant events only — sign-ins, passkey changes, credit
 * adjustments, suspensions. Deliberately separate from credit_transaction:
 * this one is allowed to be lossy, that one is not.
 * ------------------------------------------------------------------------- */

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    event: text('event').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_log_user_idx').on(table.userId, table.createdAt)],
);

/* ---------------------------------------------------------------------------
 * Rate limiting
 *
 * A fixed-window counter in Postgres. Chosen over Upstash/Redis to keep the
 * dependency count down at launch; the interface in lib/security/rate-limit.ts
 * is narrow enough to swap for Redis when write volume justifies it.
 * ------------------------------------------------------------------------- */

export const rateLimitBuckets = pgTable(
  'rate_limit_bucket',
  {
    // "{scope}:{subject}:{windowStartEpoch}"
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('rate_limit_expiry_idx').on(table.expiresAt)],
);
