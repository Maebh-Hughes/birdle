import { describe, expect, it } from 'vitest';
import {
  buildDailyPool,
  buildPracticePool,
  cycleSeed,
  dailyAnswer,
  hashString,
  mulberry32,
  pickRandom,
  seededShuffle,
} from '../src/puzzle';
import type { BirdEntry } from '../src/types';
import { bird, character } from './helpers';

// Fixture list with every length 4-11 and every obscurity level, deliberately unsorted.
const FIXTURE: BirdEntry[] = [
  bird('WREN'),
  bird('CROW', { obscurity: 2 }),
  bird('SMEW', { obscurity: 3 }),
  bird('ROBIN'),
  bird('EGRET', { obscurity: 2 }),
  bird('TWITE', { obscurity: 3 }),
  bird('PUFFIN'),
  bird('TALON', { kind: 'term' }),
  bird('PELICAN'),
  bird('FLAMINGO'),
  bird('CASSOWARY', { obscurity: 2 }),
  bird('KINGFISHER'),
  bird('HUMMINGBIRD'),
  bird('WHIMBREL', { obscurity: 3 }),
  bird('BUDGERIGAR', { obscurity: 2 }),
  bird('NIGHTINGALE', { obscurity: 2 }),
  bird('SANDPIPER'),
  bird('OSTRICH'),
];
const POOL = buildDailyPool(FIXTURE);
const words = (entries: readonly BirdEntry[]) => entries.map((entry) => entry.word);

function cycleWords(pool: readonly BirdEntry[], cycle: number, seed = 'test-seed'): string[] {
  const start = cycle * pool.length + 1;
  return Array.from({ length: pool.length }, (_, i) => dailyAnswer(pool, start + i, seed).word);
}

describe('hashString / mulberry32', () => {
  it('hashes deterministically to unsigned 32-bit integers', () => {
    expect(hashString('birdle:0')).toBe(hashString('birdle:0'));
    expect(hashString('birdle:0')).not.toBe(hashString('birdle:1'));
    for (const input of ['', 'a', 'birdle', 'x'.repeat(1000)]) {
      const h = hashString(input);
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
    }
  });

  it('produces a reproducible stream of floats in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 1000 }, () => a());
    expect(values).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(990);
    expect(mulberry32(43)()).not.toBe(values[0]);
  });
});

describe('seededShuffle', () => {
  const items = Array.from({ length: 30 }, (_, i) => i);

  it('returns a permutation without mutating the input', () => {
    const copy = [...items];
    const shuffled = seededShuffle(items, 7);
    expect(items).toEqual(copy);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it('is deterministic per seed and differs between seeds', () => {
    expect(seededShuffle(items, 7)).toEqual(seededShuffle(items, 7));
    expect(seededShuffle(items, 7)).not.toEqual(seededShuffle(items, 8));
  });

  it('handles empty and single-item lists', () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle(['only'], 1)).toEqual(['only']);
  });
});

describe('buildDailyPool / buildPracticePool', () => {
  it('excludes obscurity 3 and sorts by word', () => {
    expect(words(POOL)).toEqual([
      'BUDGERIGAR',
      'CASSOWARY',
      'CROW',
      'EGRET',
      'FLAMINGO',
      'HUMMINGBIRD',
      'KINGFISHER',
      'NIGHTINGALE',
      'OSTRICH',
      'PELICAN',
      'PUFFIN',
      'ROBIN',
      'SANDPIPER',
      'TALON',
      'WREN',
    ]);
    expect(POOL.every((entry) => entry.obscurity <= 2)).toBe(true);
  });

  it('keeps mixed lengths and bird terms', () => {
    const lengths = new Set(POOL.map((entry) => entry.word.length));
    expect([...lengths].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(POOL.some((entry) => entry.kind === 'term')).toBe(true);
  });

  it('does not depend on input order', () => {
    expect(buildDailyPool([...FIXTURE].reverse())).toEqual(POOL);
  });

  it('practice pool keeps every entry, sorted', () => {
    const practice = buildPracticePool(FIXTURE);
    expect(practice).toHaveLength(FIXTURE.length);
    expect(words(practice)).toEqual([...words(FIXTURE)].sort());
    expect(practice.some((entry) => entry.obscurity === 3)).toBe(true);
  });
});

describe('daily pool rule with fictional birds', () => {
  const MIXED: BirdEntry[] = [
    bird('WREN', { obscurity: 2 }),
    bird('TALON', { kind: 'term', obscurity: 2 }),
    bird('SMEW', { obscurity: 3 }),
    character('HOOH', 'pokemon', { obscurity: 1 }),
    character('LUGIA', 'pokemon', { obscurity: 2 }),
    character('KAEPORA', 'game', { obscurity: 1 }),
    character('NAVIS', 'game', { obscurity: 3 }),
    character('HEDWIG', 'literature', { obscurity: 1 }),
    character('ZAZU', 'literature', { obscurity: 2 }),
  ];

  it('takes bird/term up to obscurity 2 and pokemon/game/literature at obscurity 1 only', () => {
    expect(words(buildDailyPool(MIXED))).toEqual(['HEDWIG', 'HOOH', 'KAEPORA', 'TALON', 'WREN']);
  });

  it('never picks a fictional bird above obscurity 1 as a daily answer', () => {
    const pool = buildDailyPool(MIXED);
    for (let n = 1; n <= pool.length * 4; n++) {
      expect(['LUGIA', 'NAVIS', 'ZAZU', 'SMEW']).not.toContain(dailyAnswer(pool, n, 'birdle').word);
    }
  });

  it('builds a practice pool per category', () => {
    expect(words(buildPracticePool(MIXED, 'all'))).toEqual(words(MIXED).sort());
    expect(words(buildPracticePool(MIXED, 'birds'))).toEqual(['SMEW', 'TALON', 'WREN']);
    expect(words(buildPracticePool(MIXED, 'pokemon'))).toEqual(['HOOH', 'LUGIA']);
    expect(words(buildPracticePool(MIXED, 'fiction'))).toEqual(['HEDWIG', 'KAEPORA', 'NAVIS', 'ZAZU']);
    expect(buildPracticePool(FIXTURE, 'pokemon')).toEqual([]);
  });
});

describe('dailyAnswer', () => {
  it('is deterministic for the same pool, puzzle number and seed', () => {
    for (let n = 1; n <= 40; n++) {
      expect(dailyAnswer(POOL, n, 'test-seed')).toBe(dailyAnswer(POOL, n, 'test-seed'));
    }
  });

  it('never repeats within a cycle and covers the whole pool', () => {
    const first = cycleWords(POOL, 0);
    expect(new Set(first).size).toBe(POOL.length);
    expect([...first].sort()).toEqual(words(POOL));
  });

  it('uses a different order in the next cycle, again without repeats', () => {
    const first = cycleWords(POOL, 0);
    const second = cycleWords(POOL, 1);
    expect([...second].sort()).toEqual(words(POOL));
    expect(second).not.toEqual(first);
  });

  it('follows the spec formula: shuffle(pool, cycleSeed(seed, cycle))[index]', () => {
    const n = POOL.length * 2 + 5; // cycle 2, index 4
    expect(dailyAnswer(POOL, n, 'birdle')).toBe(seededShuffle(POOL, cycleSeed('birdle', 2))[4]);
  });

  it('depends on the seed', () => {
    expect(cycleWords(POOL, 0, 'seed-a')).not.toEqual(cycleWords(POOL, 0, 'seed-b'));
  });

  it('never picks an obscurity-3 entry', () => {
    const obscure = new Set(FIXTURE.filter((entry) => entry.obscurity === 3).map((entry) => entry.word));
    for (let n = 1; n <= POOL.length * 5; n++) {
      expect(obscure.has(dailyAnswer(POOL, n, 'birdle').word)).toBe(false);
    }
  });

  it('works on plain string pools', () => {
    expect(['A', 'B', 'C']).toContain(dailyAnswer(['A', 'B', 'C'], 1, 'x'));
  });

  it('rejects invalid puzzle numbers and empty pools', () => {
    expect(() => dailyAnswer(POOL, 0, 'x')).toThrow(RangeError);
    expect(() => dailyAnswer(POOL, -3, 'x')).toThrow(RangeError);
    expect(() => dailyAnswer(POOL, 1.5, 'x')).toThrow(RangeError);
    expect(() => dailyAnswer([], 1, 'x')).toThrow(RangeError);
  });
});

describe('pickRandom', () => {
  it('maps the rng range onto the list', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(pickRandom(list, () => 0)).toBe('a');
    expect(pickRandom(list, () => 0.5)).toBe('c');
    expect(pickRandom(list, () => 0.999_999)).toBe('d');
    expect(pickRandom(list, () => 1)).toBe('d'); // defensive clamp
  });

  it('defaults to Math.random and rejects empty lists', () => {
    expect(['x', 'y']).toContain(pickRandom(['x', 'y']));
    expect(() => pickRandom([])).toThrow(RangeError);
  });
});
