# Reel

Voice notes that transcribe as you speak, and stay findable afterwards.

Recording, live transcription, tagging, search and export are free, work
offline, and need no account — notes live in your browser and nothing is
uploaded. Cloud transcription, summaries and cross-archive questions cost
credits, because they cost us.

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — why the code is shaped this way
- **[docs/BUSINESS.md](docs/BUSINESS.md)** — pricing, unit economics, go-to-market

## Two deployments

The app splits cleanly in half, and the halves host differently.

| | GitHub Pages | Vercel |
| --- | --- | --- |
| Record, live transcription | ✅ | ✅ |
| Notes, tags, search, export | ✅ | ✅ |
| Analysis | ✅ | ✅ |
| Works offline, no account | ✅ | ✅ |
| Sign in (passkeys, OAuth) | ✗ | ✅ |
| Credits, Stripe checkout | ✗ | ✅ |
| Cloud transcription, AI | ✗ | ✅ |
| Cross-device sync | ✗ | ✅ |

GitHub Pages serves files and nothing else — no Node runtime, no request
handlers, no database, nowhere to keep a secret — so the auth, credits and
Stripe half genuinely cannot run there. It is not a configuration problem to
solve; it is what Pages is.

What *can* run there is the entire local-first half, because it was built to
need no server: notes live in the browser's IndexedDB and never leave it. So
the Pages build is a complete, free, offline voice notes app, and the Vercel
build is that plus an account.

`npm run build:pages` produces the static one. It removes the server-only
routes before building rather than stubbing them, so a dead sign-in button
cannot ship — the Credits tab is simply absent.

---

## Running it

```bash
npm install
cp .env.example .env.local     # fill in the values below
npm run db:migrate             # apply the checked-in migration
npm run dev
```

### Minimum to boot

| Variable | Where from |
| --- | --- |
| `APP_URL` | `http://localhost:3000` in dev |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `DATABASE_URL` | A Neon Postgres **pooled** connection string |

Everything else in `.env.example` gates a specific feature: without Stripe keys
the billing page renders but checkout fails; without an OAuth client that
provider's button fails. The app boots regardless.

`DATABASE_URL` must be the pooled endpoint (`-pooler` in the hostname).
Serverless functions open far more connections than a direct endpoint tolerates.

### Stripe

```bash
npm run stripe:sync                                        # create the catalog
stripe listen --forward-to localhost:3000/api/stripe/webhook   # get the signing secret
```

Put the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`. Credits are granted
**only** by the webhook, so without it a test purchase completes and no credits
arrive — that is the intended behaviour, not a bug.

### Commands

```bash
npm run dev          # dev server
npm run build        # production build (Vercel target)
npm run build:pages  # static build (GitHub Pages target) → out/
npm run serve:pages  # serve out/ under the same base path Pages uses
npm test             # unit tests (node --test, no framework)
npm run test:e2e     # browser smoke test against a served static build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run db:generate  # generate migrations from lib/db/schema.ts
npm run db:migrate   # apply them
npm run db:studio    # browse the database
npm run stripe:sync  # push the pricing catalog to Stripe
```

---

## Deploying to Vercel

1. **Import the repository** in Vercel. The framework preset is detected;
   `vercel.json` sets the region and the cron schedules.

2. **Attach Postgres** — Storage → Neon. This sets `DATABASE_URL`.
   Confirm the value is the pooled endpoint.

3. **Attach Blob storage** for note audio. This sets `BLOB_READ_WRITE_TOKEN`.

4. **Set the environment variables** from `.env.example`. Everything marked
   SENSITIVE should be created as a Vercel *Sensitive* variable so it cannot be
   read back out of the dashboard afterwards.

   `APP_URL` must exactly match the production origin — WebAuthn checks the
   relying-party id against it, and a mismatch makes every passkey fail.

5. **Point the Stripe webhook** at `https://<your-domain>/api/stripe/webhook`,
   subscribed to `checkout.session.completed`, `checkout.session.expired` and
   `charge.refunded`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.

6. **Set `CRON_SECRET`.** Vercel sends it as a bearer token on scheduled
   invocations, and the cron handlers reject anything else. Without it the cron
   routes refuse to run — deliberately, since `expire-credits` should not be
   triggerable by an anonymous caller.

7. **Run migrations on deploy.** Either as a build step or manually:
   `DATABASE_URL=… npm run db:migrate`. Do not migrate from the app at boot —
   every cold-starting instance would race every other one.

8. **Run `npm run stripe:sync`** against the live key to create the catalog.

---

## Deploying to GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and publishes on every
push to `main`, and can be run by hand from the Actions tab.

1. **Settings → Pages → Source: GitHub Actions.** Not "Deploy from a branch" —
   the site is built, not committed.

2. That is the whole setup. `BASE_PATH` is derived from the repository name, so
   a project page at `https://<user>.github.io/<repo>/` works with no config.

3. **Optional:** set a repository variable `FULL_APP_URL` (Settings → Secrets
   and variables → Actions → Variables) to your Vercel URL. The static build
   then links to it for sign-in and credits. Left unset, those links are simply
   omitted rather than pointed at a guessed domain.

To check the export locally exactly as Pages will serve it:

```bash
npm run build:pages
npm run serve:pages     # http://localhost:8099/Doctor/
npm run test:e2e        # in another shell
```

The e2e test drives real Chromium against the built site. It exists because the
failures that matter in a static export — hydration mismatches, IndexedDB
breaking under the export's asset paths, links to routes that only exist in the
server build — all produce a completely successful build and a broken page. It
has already caught one such bug.

For a custom domain or a user page served from the root, set `BASE_PATH` to an
empty string.

---

### Cron jobs

| Path | Schedule | Does |
| --- | --- | --- |
| `/api/cron/reclaim-holds` | every 10 min | Releases credit holds stranded by crashed requests; prunes rate-limit rows |
| `/api/cron/expire-credits` | daily 03:00 | Writes off expired credit lots and logs the breakage |

---

## Upgrading from v1

The original single-file app is preserved at
[`legacy/reel-v1.html`](legacy/reel-v1.html) and still works standalone.

Notes saved by it are imported automatically the first time you open v2 in the
same browser. **The v1 `localStorage` data is left in place**, not deleted — if
the import has a bug, that copy is the only remaining record. Clear it manually
once you have confirmed your notes came across.

---

## Status

Working: recording, live transcription, local storage, v1 import, tagging,
search, export, analysis, auth, the credit ledger, and Stripe checkout.

Not yet implemented: cross-device sync, the AI features themselves (metering is
ready, the provider calls are not), subscription lifecycle, and ledger
integration tests. See [Known gaps](docs/ARCHITECTURE.md#known-gaps) — the
ledger integration tests are blocking before this handles real money.
