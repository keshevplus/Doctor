# Reel — business plan

Every number in this document is derived from `lib/credits/pricing.ts`. That
file is the source of truth; this is the explanation. `test/pricing.test.ts`
asserts the invariants below hold, so a price edit that breaks the economics
fails CI rather than quietly shipping.

---

## 1. What we sell

Reel is a voice notes app. You talk, it transcribes, and the note is findable
later by search, tag or question.

The product splits along a line that also happens to be the cost line:

| Free, forever, no account | Paid, metered by credits |
| --- | --- |
| Recording | Cloud transcription (accurate, punctuated, any browser) |
| Live transcription via the browser's own speech API | Summaries and action items |
| Tagging, search, edit, delete | Auto-tagging |
| Full export (txt / md / json) | Ask-your-notes across the archive |
| Local storage, works offline | Speaker labels |
| | Sync across devices |

This is not a crippled free tier. The free tier is a genuinely complete voice
notes app that runs entirely in the browser, which is why it costs us nothing
to give away: no server touches a free user's data, so a free user's marginal
cost is a static file download.

**That is the whole strategy.** Competitors put the basic product behind a
subscription and must therefore convert users to survive hosting them. We host
nothing until someone wants something that genuinely costs money, so we can be
patient, and the free tier can be good enough to recommend to a friend.

---

## 2. Who it is for

Ordered by how well the credit model fits them, not by market size.

**Primary — people who think out loud.** Founders, researchers, writers,
therapists between sessions, anyone who has an idea while walking and loses it
by the time they are at a keyboard. They record short notes daily. They will
burn 30–150 credits a month, mostly on summaries, and they buy a Spark or Reel
pack two or three times a year.

**Secondary — interviewers.** Journalists, user researchers, oral historians,
recruiters. They record long-form audio and need accurate transcription with
speaker labels. A single one-hour interview is 60 credits of transcription plus
120 of diarization. They buy Studio and Archive packs, and they are the reason
the bulk tiers exist.

**Tertiary — people with an existing backlog.** Someone with two years of voice
memos on a phone who wants them searchable. A one-time Archive pack purchase,
possibly the only one they ever make. Low lifetime value, high initial order
value, and cheap to serve because the work is batchable off-peak.

We are explicitly **not** chasing the enterprise meeting-transcription market
(Otter, Fireflies, Granola). That segment wants calendar integration, SSO,
admin controls and per-seat pricing, and it is defended by companies with
sales teams. Reel is a personal tool, sold to individuals, with no seat count.

---

## 3. Why credits rather than a subscription

Credits and a subscription are both offered, but credits lead, for three
reasons.

**The costs are genuinely variable.** Transcribing a two-hour interview costs
us roughly 300× what transcribing a 30-second note does. A flat subscription
either overcharges the light user or gets destroyed by the heavy one, and
"unlimited" plans in this category survive only by hiding a fair-use limit in
the terms. Credits let a light user pay $6 twice a year and a heavy user pay
$140, both at the same margin.

**Usage is bursty and seasonal.** A researcher does forty interviews in March
and none in July. Asking them to pay in July for capacity they used in March is
how you get churn. Packs with a 12-month life match that shape.

**No subscription to cancel is no subscription to think about.** The decision
to buy a $6 pack is small; the decision to start a $12/month recurring charge
is not. Removing the recurring commitment removes the biggest objection at the
point where a new user is least convinced.

The subscription exists anyway, because a business with only one-off purchases
has no predictable revenue and no way to forecast. It is positioned for the
steady daily user who would otherwise buy a Reel pack every quarter, and it is
priced so that habit is slightly cheaper as a subscription than as packs.

### The unit

**1 credit = 1 minute of cloud transcription.**

Anchoring to a physical unit rather than an abstract token count is what makes
"how many credits do I need?" answerable in your head. Everything else is
priced relative to that anchor:

| Action | Credits | Unit |
| --- | --- | --- |
| Cloud transcription | 1 | per audio minute |
| Auto-tagging | 1 | per note |
| Summary & action items | 2 | per note |
| Speaker labels | 2 | per audio minute |
| Ask your notes | 3 | per question |

Fractional charges are rounded up: a 61-second recording costs 2 credits.
Balances stay whole numbers, which keeps them checkable by hand.

---

## 4. Pricing

New accounts get **100 credits free**, expiring after 30 days. Enough to
transcribe an hour of audio and summarise a dozen notes — enough to find out
whether the paid features are worth anything to you, and time-boxed so it
prompts a decision rather than becoming a permanent free tier.

### Credit packs

| Pack | Credits | Price | Per credit | Positioned as |
| --- | --- | --- | --- | --- |
| Spark | 300 | $6 | $0.020 | ~5 hours of transcription. A first purchase. |
| **Reel** | **1,000** | **$18** | **$0.018** | **Steady daily use for a few months.** |
| Studio | 3,000 | $48 | $0.016 | Interviews, where minutes add up fast. |
| Archive | 10,000 | $140 | $0.014 | Backfilling an existing library. |

Credits from packs are valid for **12 months**. Packs do not auto-renew.

The per-credit price falls monotonically with pack size — enforced by a test,
because it is exactly the kind of thing that breaks silently when someone
adjusts one tier in isolation, and a bulk pack that is worse value than the
mid pack is both an embarrassment and a refund request.

### Subscription

**Reel Pro — $12/month**, including 800 credits/month, rolling over up to
1,600.

Effective rate $0.015/credit: better than the Reel pack, worse than Archive.
Someone buying a Reel pack every two months ($9/month for 500 credits/month)
gets more credits for less by subscribing, which is the intended nudge. The
rollover cap stops unused allowance accumulating into an unbounded liability —
a subscriber who lapses for six months and returns should not find 4,800
credits waiting.

Pro also carries the non-metered goods: sync, priority queue, unlimited notes.

---

## 5. Unit economics

Blended cost of goods, weighted by the assumed usage mix in `pricing.ts`:

**$0.0033 per credit.**

| Pack | Revenue | Stripe fee | Provider cost | Gross profit | Margin |
| --- | --- | --- | --- | --- | --- |
| Spark | $6 | $0.47 | $0.99 | $4.53 | **75.6%** |
| Reel | $18 | $0.82 | $3.31 | $13.87 | **77.0%** |
| Studio | $48 | $1.69 | $9.93 | $36.38 | **75.8%** |
| Archive | $140 | $4.36 | $33.10 | $102.54 | **73.2%** |
| Pro (monthly, full burn) | $12 | $0.65 | $2.65 | $8.70 | **72.5%** |

Three things worth noticing.

**Margins are flat across tiers by design.** The volume discount is calibrated
to give back roughly what the fixed Stripe fee costs on small orders, so we are
indifferent to which pack someone buys. There is no tier we are quietly hoping
you avoid.

**These assume every credit is burned.** They are the floor. Real margin is
higher by the breakage rate (§6).

**Stripe's fixed 30¢ is why there is no pack below $6.** At $3 the fee is 12%
of revenue. A cheaper entry point would be worse for us and barely better for
the customer; the free grant is the trial, not a $3 pack.

### Fixed costs at launch

| | Monthly |
| --- | --- |
| Vercel Pro | $20 |
| Neon Postgres (scale-to-zero, launch tier) | $19 |
| Vercel Blob (~50 GB) | $12 |
| Domain, email (Resend free tier) | $3 |
| **Total** | **~$54** |

Break-even is roughly **four Reel packs a month**. That is a genuinely low bar,
and it is low because the free tier costs nothing to serve. Infrastructure
scales with paid usage, not with signups — the failure mode where a viral free
product bankrupts its owner is structurally unavailable here.

---

## 6. Expiry, breakage and the liability

Sold credits are **deferred revenue**, not revenue. They are a liability until
redeemed. This matters more than it sounds: a business that books credit sales
as revenue looks profitable right up until everyone spends at once.

- Credits are recognised as revenue **when consumed**, not when sold.
- The outstanding balance is a liability, reportable at any moment as
  `SUM(credit_lot.amount_remaining)` across all users.
- **Breakage** — credits that expire unredeemed — is recognised at expiry, and
  recorded as an explicit `expiry` transaction so it is a measured number
  rather than an inference from a shrinking balance.

Industry breakage on prepaid digital credits runs 10–20%. We assume **12%** for
planning, which puts realised margin around 78–80% against the 73–77% floor
above. Breakage is upside, and it is deliberately not in the headline numbers.

### The expiry policy, and why it is 12 months

Twelve months is long enough that nobody loses credits they were realistically
going to use, and short enough to bound the liability and prompt re-purchase.

Two things keep it honest:

- **Expiring credits are spent first.** The ledger consumes lots in
  expiry order, so a promotional lot expiring next week is burned before a pack
  expiring next year. You cannot lose credits while holding newer ones.
- **Warn before expiry.** Email at 30 days and 7 days out. An expiry that
  arrives as a surprise is a support ticket and a lost customer; one that
  arrives after two warnings is a purchase prompt.

> **Legal note, requiring actual advice before launch.** Prepaid credits sold
> for a specific service are generally treated differently from gift cards, but
> "generally" is doing a lot of work. Several US states (California prominent
> among them) restrict expiry on instruments that look like stored value, and
> the EU Consumer Rights Directive and UK equivalents impose their own
> constraints. The design is deliberately defensive — credits are non-
> transferable, redeemable only for Reel services, never refundable for cash,
> and never marketed as a stored-value instrument — but **a lawyer should
> review the terms in each market before selling there.** If a jurisdiction
> turns out to prohibit expiry, the fallback is to disable expiry there:
> `credit_lot.expires_at` is nullable, so it is a configuration change, not a
> migration.

### Refunds

Unused credits are refundable within 14 days of purchase. Partially used packs
are not, and the terms say so plainly before purchase.

The webhook claws back credits on refund. If the customer already spent them
the ledger refuses to go negative — the shortfall is flagged for manual review
rather than resolved automatically, because someone who consumed the service
and then refunded is a conversation, not a state machine transition.

---

## 7. Getting to first customers

No paid acquisition at launch. The margins support it eventually, but paying
for traffic before knowing what converts is how you learn an expensive lesson
about the wrong audience.

**Where the first thousand users come from:**

1. **The free tier is the marketing.** A tool that works offline, needs no
   account, and exports everything is shareable in a way a signup-walled
   product is not. "Here, just open this" is the whole pitch.
2. **Communities with the pain.** r/QualitativeResearch, oral history mailing
   lists, PhD and academic-writing Discords, journalism tool roundups. These
   people already pay for transcription and already resent what they pay.
3. **Comparison content.** Honest, specific posts on transcription cost per
   hour across providers. We win that comparison on price for intermittent use
   and lose it for daily heavy use — saying so builds more trust than winning
   every row would.
4. **Being the answer to "I don't want a subscription."** A real, recurring
   complaint about every competitor. It is our entire positioning and it is
   searchable.

**Funnel assumptions.** These are assumptions to be replaced with measurement,
not forecasts:

| Stage | Assumed rate |
| --- | --- |
| Visitor → records a note | 25% (no signup friction) |
| Recorder → still using at day 7 | 20% |
| Retained → creates an account | 30% |
| Account → spends the free grant | 50% |
| Grant spent → first purchase | 25% |
| Purchaser → repeat purchase within 12 months | 45% |

Composed, that is roughly **0.19% of visitors becoming paying customers** — low
in absolute terms, and expected for a free-first funnel with four stages before
money. The compensation is that the top of the funnel is cheap and the free
users cost nothing to keep.

### Illustrative first year

Assumes the rates above hold and traffic grows steadily. Not a forecast.

| | Month 3 | Month 6 | Month 12 |
| --- | --- | --- | --- |
| Monthly visitors | 3,000 | 12,000 | 40,000 |
| Paying customers (cumulative) | 6 | 45 | 260 |
| Pro subscribers | 1 | 12 | 70 |
| Monthly revenue | ~$110 | ~$700 | ~$3,100 |
| Monthly costs | ~$60 | ~$110 | ~$390 |
| **Monthly gross profit** | **~$50** | **~$590** | **~$2,710** |

Month 12 at roughly $3.1k MRR is a real side business and not yet a salary.
The honest read: this is a sustainable small product, and the decision about
whether it can be more than that should be made at month 6 on measured
conversion, not on this table.

---

## 8. Risks

**Provider prices are the whole margin.** Transcription cost per minute has
fallen steadily, which has been in our favour, but the position depends on it
not reversing. Mitigations: `estimatedCogsCents` is one edit away from
repricing; the provider is behind an interface; and packs sold at old prices
are honoured at their recorded credit count, so a cost increase affects new
sales rather than retroactively breaking old ones. **If blended COGS doubles,
margins fall to the high 40s** — survivable, but it would force a price rise.

**Browsers may make cloud transcription unnecessary.** On-device speech
recognition keeps improving, and the free tier already uses it. If it becomes
good enough for interview-grade transcription, our largest credit sink
evaporates. This is a genuine existential risk and the mitigation is to move
value toward what happens *after* transcription — summaries, cross-archive
questions, structure — which needs a model that will not be running locally
for some time.

**Nobody wants another notes app.** The category is crowded and free
alternatives are everywhere. The wedge is narrow and specific: no subscription,
works offline, exports everything, does not upload your notes by default. If
that wedge does not resonate, the product does not differentiate on features.

**Credit models can feel hostile.** Users have been trained by game
monetisation to distrust them. Countermeasures are all in the product already:
the balance is always visible; every action's price is on the billing page
before you use it; the transaction log shows exactly where each credit went;
credits never expire silently; and holds mean failed work is never charged.
The rule of thumb is that no user should ever be surprised by a balance.

**Concentration in the interview segment.** The high-value users are a small
group, and a competitor bundling transcription into a tool they already pay for
could take them at once.

---

## 9. What to measure

In priority order. Everything above is downstream of these.

1. **Blended COGS per credit, measured.** The single most important number.
   Every margin figure here rests on an assumed usage mix. Replace it with real
   data as soon as there is any.
2. **Free-to-paid conversion, by acquisition source.** Determines whether paid
   acquisition is ever viable.
3. **Repeat purchase rate at 12 months.** The difference between a business and
   a one-off sale.
4. **Breakage rate.** Both a margin input and an early warning: rising breakage
   means people are buying and then not finding the product useful.
5. **Credits per active user per month.** Tells you whether the pack sizes are
   right. If most users burn a Spark pack in a week, Spark is too small.
6. **Ledger drift.** `reconcile()` per user should always return zero. Any
   non-zero value is a correctness bug in something that handles money, and
   should page someone.
