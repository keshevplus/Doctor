import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { activityByDay, currentStreak, tagFrequencies, topWords, totals } from '../lib/analysis/stats.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('totals', () => {
  it('reports zero averages for an empty archive rather than NaN', () => {
    assert.deepEqual(totals([]), { noteCount: 0, wordCount: 0, averageWords: 0 });
  });

  it('counts words across notes', () => {
    const result = totals([
      { text: 'one two three', createdAt: 0 },
      { text: 'four five', createdAt: 0 },
    ]);
    assert.equal(result.noteCount, 2);
    assert.equal(result.wordCount, 5);
    assert.equal(result.averageWords, 3);
  });

  it('ignores surrounding whitespace when counting', () => {
    assert.equal(totals([{ text: '   spaced   out   ', createdAt: 0 }]).wordCount, 2);
  });
});

describe('activityByDay', () => {
  const now = new Date(2026, 0, 15, 12, 0, 0);

  it('returns one bucket per requested day, oldest first', () => {
    const buckets = activityByDay([], 7, now);
    assert.equal(buckets.length, 7);
    assert.equal(buckets[0]!.date.getDate(), 9);
    assert.equal(buckets[6]!.date.getDate(), 15);
  });

  it('buckets notes by local calendar day', () => {
    const buckets = activityByDay(
      [
        { text: 'a', createdAt: new Date(2026, 0, 15, 23, 30).getTime() },
        { text: 'b', createdAt: new Date(2026, 0, 15, 1, 0).getTime() },
        { text: 'c', createdAt: new Date(2026, 0, 14, 9, 0).getTime() },
      ],
      7,
      now,
    );
    assert.equal(buckets[6]!.count, 2);
    assert.equal(buckets[5]!.count, 1);
  });

  it('drops notes outside the window', () => {
    const buckets = activityByDay(
      [{ text: 'old', createdAt: now.getTime() - 30 * DAY }],
      7,
      now,
    );
    assert.equal(
      buckets.reduce((sum, b) => sum + b.count, 0),
      0,
    );
  });
});

describe('topWords', () => {
  it('filters stopwords and short words', () => {
    const result = topWords([{ text: 'the and but I go to the shop', createdAt: 0 }]);
    const words = result.map((r) => r.word);
    assert.ok(!words.includes('the'));
    assert.ok(!words.includes('and'));
    assert.ok(!words.includes('go'), 'two-letter words are dropped');
    assert.ok(words.includes('shop'));
  });

  it('filters spoken filler that a written-text stopword list would keep', () => {
    const result = topWords([
      { text: 'um like basically the deployment actually um like works', createdAt: 0 },
    ]);
    const words = result.map((r) => r.word);
    assert.ok(!words.includes('um'));
    assert.ok(!words.includes('like'));
    assert.ok(!words.includes('basically'));
    assert.ok(!words.includes('actually'));
    assert.deepEqual(words, ['deployment', 'works']);
  });

  it('strips apostrophes after stopword matching', () => {
    const result = topWords([{ text: "don't forget the standup", createdAt: 0 }]);
    const words = result.map((r) => r.word);
    assert.ok(!words.includes('dont'), "don't is treated as a stopword");
    assert.ok(words.includes('forget'));
  });

  it('sorts by count then alphabetically for stable output', () => {
    const result = topWords([{ text: 'beta beta alpha alpha gamma', createdAt: 0 }]);
    assert.deepEqual(
      result.map((r) => r.word),
      ['alpha', 'beta', 'gamma'],
    );
  });

  it('honours the limit', () => {
    const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    assert.equal(topWords([{ text, createdAt: 0 }], 5).length, 5);
  });
});

describe('tagFrequencies', () => {
  it('counts tags across notes, most used first', () => {
    const result = tagFrequencies([
      { tags: ['work', 'idea'] },
      { tags: ['work'] },
      { tags: ['work', 'idea'] },
    ]);
    assert.deepEqual(result, [
      { word: 'work', count: 3 },
      { word: 'idea', count: 2 },
    ]);
  });
});

describe('currentStreak', () => {
  const now = new Date(2026, 0, 15, 12, 0, 0);
  const at = (daysAgo: number, hour = 10) =>
    new Date(2026, 0, 15 - daysAgo, hour).getTime();

  it('is zero with no notes', () => {
    assert.equal(currentStreak([], now), 0);
  });

  it('counts consecutive days ending today', () => {
    const notes = [0, 1, 2].map((d) => ({ text: 'x', createdAt: at(d) }));
    assert.equal(currentStreak(notes, now), 3);
  });

  it('survives a day that has not been recorded yet', () => {
    // Nothing today, but yesterday and the day before — the streak is alive.
    const notes = [1, 2].map((d) => ({ text: 'x', createdAt: at(d) }));
    assert.equal(currentStreak(notes, now), 2);
  });

  it('breaks after a full missed day', () => {
    const notes = [2, 3].map((d) => ({ text: 'x', createdAt: at(d) }));
    assert.equal(currentStreak(notes, now), 0);
  });

  it('counts several notes on one day once', () => {
    const notes = [at(0, 9), at(0, 18), at(1, 11)].map((createdAt) => ({ text: 'x', createdAt }));
    assert.equal(currentStreak(notes, now), 2);
  });
});
