# Architecture

Why the code is shaped the way it is. For what the code *does*, read the code —
this covers the decisions that are not obvious from any single file.

---

## The shape

```
app/                    Routes only. Thin — pages compose, they don't implement.
  (app)/                Signed-in shell. requireUser() in the segment layout.
  api/                  Route handlers.
components/             Presentational + interactive React. One CSS module each.
lib/
  analysis/             Pure stats. No imports, fully unit-tested.
  auth/                 Auth.js config, guards, audit log.
  billing/              Stripe client and checkout.
  credits/              Pricing, ledger, metering. The money.
  db/                   Drizzle schema and client.
  export/               Pure serializers. Unit-tested.
  local/                IndexedDB store, v1 migration, React hook.
  recorder/             Speech + audio capture state machine.
  security/             Rate limiting, CSP, request helpers, cron auth.
test/                   Node test runner, no framework.
legacy/reel-v1.html     The original single-file app, kept for reference.
```

The rule that keeps this from re-collapsing into a monolith: **a route handler
should read like a list of calls into `lib/`.** If a route grows business
logic, that logic belongs in `lib/` where it can be tested without a request.

`lib/` uses relative imports internally and avoids the `@/` alias, so its
modules can be loaded straight by the test runner with no bundler or path
resolver. `app/` and `components/` use `@/` freely.

---

## Local-first, and why it is also the business model

Notes live in IndexedDB and are read and written there first. Sync, when a user
is signed in, happens afterwards in the background.

This is usually argued for on UX grounds — no spinner, works on a train — and
those hold. But the reason it is load-bearing here is cost: a signed-out user
never touches our infrastructure, so the free tier's marginal cost is a static
file download. That is what lets the free tier be a genuinely complete app
rather than a demo, which is the whole go-to-market (see BUSINESS.md §1).

v1 used `localStorage`. IndexedDB replaces it because it stores `Blob`s
natively — audio no longer pays the ~33% base64 tax — and the quota is
hundreds of megabytes rather than five.

**v1 data is imported, never destroyed.** `migrateV1Notes()` copies the old
`reel-voice-notes` key into IndexedDB and deliberately leaves the original in
place. If the migration has a bug, that copy is the only remaining record of
notes someone may have kept for a year. Clearing it is a manual action in
Settings, offered only after an import has succeeded.

---

## The credit ledger

The part most worth reading carefully: `lib/credits/ledger.ts`.

**Three tables, because they answer different questions.**

- `credit_lot` — balance-bearing buckets. Credits enter the system only by
  creating a lot. Per-lot expiry is what makes "expire the oldest first"
  expressible at all.
- `credit_transaction` — append-only log. Never updated, never deleted. This is
  what you reconcile against and what you show a customer disputing a charge.
- `credit_hold` — reservations against lots for work that might fail.

The invariant, asserted by `reconcile()`:

```
SUM(transaction.delta) == SUM(lot.amount_remaining) + SUM(open hold amounts)
```

Any drift means something wrote to lots without logging a transaction. It
should page someone.

**Holds exist so failure is never billed.** Transcription calls a provider that
can time out. Charging up front means billing for nothing when it does;
charging afterwards means two concurrent jobs can both be admitted against the
same credits. So: hold an estimate, do the work, capture the true cost. A hold
decrements the lots immediately, so the balance a user sees is already net of
in-flight work. Capture for less than was held and the difference goes back to
the lots it came from.

Crashed requests leave holds open; a cron releases anything past its TTL every
ten minutes, so credits are never stranded indefinitely.

**Consumption is FIFO by expiry, not by purchase date.** A promo lot expiring
next week is spent before a pack expiring next year. Otherwise a user watches
credits evaporate while holding newer ones — the opposite of what any points
system does, and a support ticket every time.

**Concurrency: a pessimistic lock on the user row.** `SELECT … FOR UPDATE` on
`user` serialises that user's ledger while leaving other users fully parallel.
Chosen over `SERIALIZABLE` because the contended case — one user firing several
AI jobs at once — is common enough that retry-on-serialisation-failure would
surface as real user-visible errors, and the critical section is milliseconds.

Idempotency keys are the independent second line. Every retryable caller
supplies a stable key and a `UNIQUE` index turns "retry" into "no-op" *in the
database*, not in application logic that can be raced.

**The driver choice is load-bearing.** `lib/db/client.ts` uses
`drizzle-orm/neon-serverless` (WebSocket), not `neon-http`. The HTTP driver is
faster for one-shot queries but **cannot open a transaction** — it would
silently degrade every `db.transaction()` into a series of autocommitted
statements, which is precisely how you double-spend credits under load.

---

## Auth

**Passwordless, passkeys first.** There is no password field anywhere. That
removes credential stuffing, password reuse, and the breach blast radius in one
move. The server stores only a WebAuthn *public* key, so a full database leak
yields nothing an attacker can sign in with, and the credential is
origin-bound by the browser — phishing-resistant in a way no OTP can be.

OAuth (Google, GitHub) and a short-lived email magic link cover people without
a passkey-capable device.

**Automatic account linking is off**, deliberately. With it on, a provider that
does not verify email ownership lets an attacker register at that provider with
a victim's address and get merged into the victim's Reel account. Linking a
second method happens from settings, while already authenticated — which proves
control of the original account first.

**Database sessions, not JWTs.** A JWT is valid until it expires; you cannot
revoke it. That makes "sign out everywhere" and "lock this account now" both
unimplementable. One indexed lookup per request buys real revocation —
`revokeAllSessions()` deletes the rows and the sessions are gone.

**The session cookie uses the `__Host-` prefix** in production. The browser
enforces that such a cookie is Secure, `Path=/`, and carries no `Domain`
attribute — that last part means no subdomain can set it, so a compromised
marketing subdomain cannot plant a session-fixation cookie on the app. Auth.js
defaults to the weaker `__Secure-` prefix.

### Middleware is not the security boundary

`middleware.ts` redirects visitors with no session cookie away from app routes.
That is a *convenience*, based only on a cookie being present — it validates
nothing.

Authorization is `requireUser()`, called in the `(app)` segment layout and in
every API route. Treating a middleware matcher as the boundary is a well-worn
way to ship an auth bypass: one mismatched glob and a route is silently public.
Putting the guard in the segment layout means a new route dropped into `(app)/`
inherits it rather than needing someone to remember.

Middleware also deliberately does **not** call `auth()` — that would put a
database round trip in front of every request, for a check the route is about
to perform anyway.

---

## Payments

**Only the webhook grants credits.** The `success_url` the customer lands on
after paying proves nothing — it is a URL, and anyone can visit it with any
purchase id. Granting there would be a free-credit generator. The webhook is
the only channel whose authenticity is verifiable, so it is the only one
trusted with balances.

The handler holds three properties:

1. **Authenticity** — HMAC signature verified against the endpoint secret, on
   the raw request body. (`request.text()`, never `request.json()` — re-
   serialising changes bytes and breaks the signature.)
2. **Idempotency** — the Stripe event id is inserted into
   `processed_webhook_event`; a conflicting insert means a previous delivery
   already did the work. Stripe delivers at-least-once.
3. **Atomicity** — marking the purchase paid and granting the credits happen in
   one transaction. There is no state where money was taken and credits are
   missing.

On handler failure the idempotency claim is released so Stripe's retry can
succeed; otherwise a transient database error would permanently strand a paid
purchase.

**Prices are never accepted from the client.** The browser sends a pack id; the
server resolves the price from its own catalog. The webhook then cross-checks
`amount_total` against the recorded purchase and refuses to grant on mismatch.

Stripe prices are looked up by **lookup key**, not hard-coded `price_…` ids —
those differ between test and live mode, so hard-coding them means the code
works in exactly one of them.

---

## Performance

**Server Components by default.** `'use client'` appears only where there is
genuine interactivity: the recorder, the note list, the pricing buttons. The
billing page's tables and the landing page ship no component JavaScript.

**Fonts are self-hosted** by `next/font` at build time rather than fetched from
Google at runtime. Three consequences: no third-party origin in the CSP, no
extra DNS/TLS round trip before first paint, and no layout shift, because the
metrics-matched fallback is generated automatically.

**Middleware stays free of database access**, per above — it runs on every
request including static assets.

**`useDeferredValue` on note search** keeps typing responsive on a large
archive: the input updates immediately while the filtered list re-renders at
lower priority.

**`preload="none"` on note audio.** A list of fifty notes must not fetch fifty
audio blobs on render.

**Object URLs are revoked** when a note card unmounts. Leaking them pins every
played recording in memory for the life of the page.

**Connection pooling** is capped at 3 per instance and the pool is reused
across warm invocations. A fresh pool per request exhausts Neon's connection
limit quickly, and serverless functions handle one request at a time anyway, so
a large per-instance pool buys nothing.

---

## Content Security Policy

Set in middleware because it carries a per-request nonce; the static headers
that need no nonce are in `next.config.ts` so the CDN applies them without
running middleware.

`script-src` is `'self' 'nonce-…' 'strict-dynamic'`. `strict-dynamic` lets the
nonce-approved Next.js bootstrap load the rest of the chunk graph, so no bundle
hash has to be enumerated.

`style-src` needs `'unsafe-inline'`: Next.js injects inline `<style>` for
critical CSS and does not nonce it. This is a real weakening, and an accepted
one — style injection without script injection is a defacement, not a data
breach.

---

## Testing

`node --test` with the built-in runner and no framework. The pure modules —
`analysis/stats`, `export/format`, `credits/pricing` — are fully covered.

`test/pricing.test.ts` is worth calling out: it asserts **business**
invariants, not implementation details. No action priced below cost at the bulk
rate; per-credit price falls monotonically with pack size; every pack clears a
50% margin floor; the usage mix sums to 1. Each encodes a mistake that is easy
to make while editing prices and expensive to find in production.

The ledger is not unit-tested here — it is meaningless without a real Postgres,
since the correctness properties *are* the transaction and locking semantics.
It needs integration tests against a throwaway database before this handles
real money. That is the largest known gap.

---

## Known gaps

Honest list of what is scaffolded but not finished:

- **Sync is designed, not implemented.** The schema, tombstones and version
  counters are in place; `/api/notes` sync endpoints are not written.
- **AI features are metered but not wired.** `meteredRun()` is ready and the
  pricing exists; the provider calls in `/api/transcribe` and `/api/ai/*` are
  not implemented.
- **No ledger integration tests.** See above. Blocking for real money.
- **Subscription billing is priced but not implemented** — no Stripe
  subscription lifecycle handling, no monthly credit grant cron.
- **`/privacy` and `/terms` are linked but do not exist.** Needed before
  selling anything.
- **The credit expiry warning emails** described in BUSINESS.md §6 are policy,
  not code. `expire-credits` writes off lots but sends nothing beforehand.
