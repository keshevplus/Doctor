import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTION_PRICING,
  ASSUMED_USAGE_MIX,
  CREDIT_PACKS,
  SUBSCRIPTION,
  blendedCogsCentsPerCredit,
  centsPerCredit,
  getPack,
  packGrossMargin,
} from '../lib/credits/pricing.ts';

/**
 * These are business invariants, not implementation details. Each one encodes a
 * mistake that is easy to make while editing prices and expensive to discover
 * in production — selling credits below cost, or accidentally making the bulk
 * pack the worst deal.
 */

describe('credit pack catalog', () => {
  it('has unique ids and Stripe lookup keys', () => {
    const ids = CREDIT_PACKS.map((p) => p.id);
    const keys = CREDIT_PACKS.map((p) => p.stripeLookupKey);
    assert.equal(new Set(ids).size, ids.length, 'pack ids must be unique');
    assert.equal(new Set(keys).size, keys.length, 'lookup keys must be unique');
  });

  it('gets cheaper per credit as packs get bigger', () => {
    const bySize = [...CREDIT_PACKS].sort((a, b) => a.credits - b.credits);
    for (let i = 1; i < bySize.length; i++) {
      const previous = centsPerCredit(bySize[i - 1]!);
      const current = centsPerCredit(bySize[i]!);
      assert.ok(
        current < previous,
        `${bySize[i]!.id} (${current.toFixed(4)}¢/credit) should beat ${bySize[i - 1]!.id} (${previous.toFixed(4)}¢/credit)`,
      );
    }
  });

  it('prices every pack above cost with room for Stripe fees', () => {
    for (const pack of CREDIT_PACKS) {
      const margin = packGrossMargin(pack);
      assert.ok(
        margin > 0.5,
        `${pack.id} gross margin is ${(margin * 100).toFixed(1)}%, below the 50% floor`,
      );
    }
  });

  it('resolves packs by id and rejects unknown ones', () => {
    assert.equal(getPack('reel')?.credits, 1_000);
    assert.equal(getPack('nonexistent'), undefined);
  });

  it('uses whole-cent prices', () => {
    for (const pack of CREDIT_PACKS) {
      assert.ok(Number.isInteger(pack.priceCents), `${pack.id} price must be integer cents`);
      assert.ok(Number.isInteger(pack.credits), `${pack.id} credits must be a whole number`);
    }
  });
});

describe('action pricing', () => {
  it('charges at least one credit for every action', () => {
    for (const pricing of Object.values(ACTION_PRICING)) {
      assert.ok(pricing.credits >= 1, `${pricing.action} must cost at least 1 credit`);
      assert.ok(Number.isInteger(pricing.credits), `${pricing.action} must cost whole credits`);
    }
  });

  it('never sells an action below its provider cost, even at the bulk rate', () => {
    const cheapestRate = Math.min(...CREDIT_PACKS.map(centsPerCredit));
    for (const pricing of Object.values(ACTION_PRICING)) {
      const revenue = pricing.credits * cheapestRate;
      assert.ok(
        revenue > pricing.estimatedCogsCents,
        `${pricing.action} earns ${revenue.toFixed(3)}¢ but costs ${pricing.estimatedCogsCents}¢ at the bulk rate`,
      );
    }
  });
});

describe('usage mix', () => {
  it('sums to 1', () => {
    const total = Object.values(ASSUMED_USAGE_MIX).reduce((sum, share) => sum + share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `usage mix sums to ${total}, expected 1`);
  });

  it('covers every metered action', () => {
    assert.deepEqual(
      Object.keys(ASSUMED_USAGE_MIX).sort(),
      Object.keys(ACTION_PRICING).sort(),
    );
  });

  it('produces a blended cost below every pack rate', () => {
    const cogs = blendedCogsCentsPerCredit();
    assert.ok(cogs > 0, 'blended cost should be positive');
    for (const pack of CREDIT_PACKS) {
      assert.ok(
        centsPerCredit(pack) > cogs,
        `${pack.id} sells credits at ${centsPerCredit(pack).toFixed(4)}¢ but they cost ${cogs.toFixed(4)}¢`,
      );
    }
  });
});

describe('subscription', () => {
  it('prices its allowance between the mid and bulk pack rates', () => {
    const effective = SUBSCRIPTION.priceCentsMonthly / SUBSCRIPTION.monthlyCredits;
    const rates = CREDIT_PACKS.map(centsPerCredit).sort((a, b) => a - b);
    const cheapest = rates[0]!;
    const dearest = rates[rates.length - 1]!;
    assert.ok(
      effective > cheapest && effective < dearest,
      `subscription at ${effective.toFixed(4)}¢/credit should sit between ${cheapest.toFixed(4)} and ${dearest.toFixed(4)}`,
    );
  });

  it('caps rollover so liability cannot grow without bound', () => {
    assert.ok(SUBSCRIPTION.rolloverCapMultiple >= 1);
    assert.ok(SUBSCRIPTION.rolloverCapMultiple <= 3, 'unbounded rollover becomes a balance-sheet problem');
  });
});
