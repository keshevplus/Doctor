/**
 * The single source of truth for what things cost.
 *
 * The pricing page, the Stripe catalog sync script, the metering code and
 * docs/BUSINESS.md all derive from this file. If a number appears in two
 * places and one of them is not this file, that is a bug.
 */

/* ---------------------------------------------------------------------------
 * What a credit buys
 *
 * The unit is deliberately anchored to one thing a user can picture:
 *
 *     1 credit = 1 minute of cloud transcription.
 *
 * Every other action is priced relative to that. Anchoring to a physical unit
 * rather than an abstract token count is what keeps "how many credits do I
 * need?" answerable without a calculator.
 * ------------------------------------------------------------------------- */

export type MeteredAction =
  | 'transcription'
  | 'summary'
  | 'auto_tag'
  | 'ask_notes'
  | 'diarization';

export interface ActionPricing {
  readonly action: MeteredAction;
  readonly label: string;
  readonly description: string;
  /** Credits charged per unit. */
  readonly credits: number;
  readonly unit: 'per_audio_minute' | 'per_note' | 'per_query';
  /**
   * What one unit costs us at the provider, in cents. Used to compute margin
   * and to sanity-check that no action is priced below cost. Update these when
   * you renegotiate or switch providers.
   */
  readonly estimatedCogsCents: number;
}

export const ACTION_PRICING: Readonly<Record<MeteredAction, ActionPricing>> = {
  transcription: {
    action: 'transcription',
    label: 'Cloud transcription',
    description:
      'Accurate, punctuated transcription of recorded audio. Runs server-side, so it works on browsers with no speech API and on files you upload.',
    credits: 1,
    unit: 'per_audio_minute',
    estimatedCogsCents: 0.4,
  },
  summary: {
    action: 'summary',
    label: 'Summary & action items',
    description: 'Condense a note into a short summary plus any commitments or follow-ups it contains.',
    credits: 2,
    unit: 'per_note',
    estimatedCogsCents: 0.3,
  },
  auto_tag: {
    action: 'auto_tag',
    label: 'Auto-tagging',
    description: 'Suggest tags for a note based on its content and the tags you already use.',
    credits: 1,
    unit: 'per_note',
    estimatedCogsCents: 0.1,
  },
  ask_notes: {
    action: 'ask_notes',
    label: 'Ask your notes',
    description: 'Ask a question across your whole archive and get an answer with citations to specific notes.',
    credits: 3,
    unit: 'per_query',
    estimatedCogsCents: 1.2,
  },
  diarization: {
    action: 'diarization',
    label: 'Speaker labels',
    description: 'Split a multi-speaker recording into labelled turns.',
    credits: 2,
    unit: 'per_audio_minute',
    estimatedCogsCents: 0.8,
  },
} as const;

/* ---------------------------------------------------------------------------
 * Credit packs
 *
 * Prepaid, non-refundable-once-used service credits. Prices step down with
 * volume so the marginal credit gets cheaper, which is what makes the larger
 * packs worth buying without needing a subscription.
 * ------------------------------------------------------------------------- */

export interface CreditPack {
  readonly id: string;
  readonly name: string;
  readonly credits: number;
  readonly priceCents: number;
  /** Stable key used to look the price up in Stripe. Never reuse across price changes. */
  readonly stripeLookupKey: string;
  readonly blurb: string;
  readonly highlighted?: boolean;
}

/** Purchased credits stay valid for this long. See BUSINESS.md on expiry policy. */
export const PACK_EXPIRY_MONTHS = 12;

export const CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: 'spark',
    name: 'Spark',
    credits: 300,
    priceCents: 600,
    stripeLookupKey: 'reel_credits_spark_v1',
    blurb: 'About five hours of transcription. Enough to decide whether this fits how you work.',
  },
  {
    id: 'reel',
    name: 'Reel',
    credits: 1_000,
    priceCents: 1_800,
    stripeLookupKey: 'reel_credits_reel_v1',
    blurb: 'The steady-use pack. Daily notes with summaries, for a few months.',
    highlighted: true,
  },
  {
    id: 'studio',
    name: 'Studio',
    credits: 3_000,
    priceCents: 4_800,
    stripeLookupKey: 'reel_credits_studio_v1',
    blurb: 'For interviews and long recordings, where minutes add up quickly.',
  },
  {
    id: 'archive',
    name: 'Archive',
    credits: 10_000,
    priceCents: 14_000,
    stripeLookupKey: 'reel_credits_archive_v1',
    blurb: 'Bulk rate, for backfilling an existing library of recordings in one go.',
  },
] as const;

/* ---------------------------------------------------------------------------
 * Subscription
 *
 * Packs are the headline product, but a monthly plan is what turns this into a
 * business with predictable revenue. The included allowance is priced between
 * the Reel and Studio pack rates: better than casual buying, worse than bulk.
 * ------------------------------------------------------------------------- */

export interface Subscription {
  readonly id: string;
  readonly name: string;
  readonly priceCentsMonthly: number;
  readonly monthlyCredits: number;
  readonly stripeLookupKey: string;
  /** Unused monthly credits roll over, capped at this multiple of the allowance. */
  readonly rolloverCapMultiple: number;
  readonly perks: readonly string[];
}

export const SUBSCRIPTION: Subscription = {
  id: 'pro',
  name: 'Reel Pro',
  priceCentsMonthly: 1_200,
  monthlyCredits: 800,
  stripeLookupKey: 'reel_pro_monthly_v1',
  rolloverCapMultiple: 2,
  perks: [
    'Sync across every device',
    '800 credits a month, rolling over up to 1,600',
    'Unlimited notes and full-text search',
    'Priority transcription queue',
    'Export your whole archive at any time',
  ],
} as const;

/** Credits handed to a new account so the paid features can be tried before buying. */
export const SIGNUP_GRANT_CREDITS = 100;
export const SIGNUP_GRANT_EXPIRY_DAYS = 30;

/* ---------------------------------------------------------------------------
 * Derived figures
 * ------------------------------------------------------------------------- */

export function centsPerCredit(pack: CreditPack): number {
  return pack.priceCents / pack.credits;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function getPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

/** Stripe's US card rate. Used for contribution-margin maths, not for billing. */
export const STRIPE_FEE_PERCENT = 0.029;
export const STRIPE_FEE_FIXED_CENTS = 30;

export function stripeFeeCents(amountCents: number): number {
  return amountCents * STRIPE_FEE_PERCENT + STRIPE_FEE_FIXED_CENTS;
}

/**
 * Blended cost of goods for one credit, in cents, weighted by an assumed usage
 * mix. The mix is a launch assumption to be replaced with measured data — it
 * is the single most important number to revisit once real traffic exists,
 * because every margin figure in BUSINESS.md is downstream of it.
 */
export const ASSUMED_USAGE_MIX: Readonly<Record<MeteredAction, number>> = {
  transcription: 0.62,
  summary: 0.18,
  auto_tag: 0.08,
  ask_notes: 0.09,
  diarization: 0.03,
};

export function blendedCogsCentsPerCredit(): number {
  let cost = 0;
  for (const [action, share] of Object.entries(ASSUMED_USAGE_MIX) as [MeteredAction, number][]) {
    const pricing = ACTION_PRICING[action];
    // Cost per credit for this action = cost of one unit / credits charged for it.
    cost += share * (pricing.estimatedCogsCents / pricing.credits);
  }
  return cost;
}

/** Gross margin on a pack after provider costs and Stripe fees, as a 0–1 fraction. */
export function packGrossMargin(pack: CreditPack): number {
  const revenue = pack.priceCents;
  const fees = stripeFeeCents(revenue);
  // Assumes every credit is eventually consumed — the conservative case.
  // Breakage (unredeemed credits) makes the realised margin higher.
  const cogs = pack.credits * blendedCogsCentsPerCredit();
  return (revenue - fees - cogs) / revenue;
}
