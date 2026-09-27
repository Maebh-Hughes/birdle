import { DAILY_MAX_OBSCURITY } from './constants';

// Pure answer-selection helpers. They take the word list as a parameter so they
// can be tested with fixtures; the real list is only loaded by ./server.

/** Minimal shape of a pool entry (BirdEntry satisfies it). */
export interface PoolEntry {
  word: string;
  obscurity: number;
}

/** Deterministic 32-bit hash of a string (FNV-1a with a murmur3 finalizer). */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 PRNG: returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Fisher-Yates shuffle driven by mulberry32(seed). Returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Shuffle seed for one pass ("cycle") through the daily pool. */
export function cycleSeed(seed: string, cycle: number): number {
  return hashString(`${seed}:${cycle}`);
}

/**
 * Daily answer for puzzle `puzzleNumber` (>= 1). Puzzles walk through the pool
 * in a seeded shuffled order: no repeats within a cycle of `pool.length`
 * puzzles, and every cycle uses a fresh order. `pool` must be in a stable order
 * (use buildDailyPool).
 */
export function dailyAnswer<T>(pool: readonly T[], puzzleNumber: number, seed: string): T {
  if (pool.length === 0) throw new RangeError('The daily pool is empty');
  if (!Number.isInteger(puzzleNumber) || puzzleNumber < 1) {
    throw new RangeError(`Invalid puzzle number ${puzzleNumber}`);
  }
  const cycle = Math.floor((puzzleNumber - 1) / pool.length);
  const index = (puzzleNumber - 1) % pool.length;
  return seededShuffle(pool, cycleSeed(seed, cycle))[index]!;
}

function byWord(a: PoolEntry, b: PoolEntry): number {
  return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
}

/** Daily answer candidates: entries with obscurity <= DAILY_MAX_OBSCURITY, sorted by word. */
export function buildDailyPool<T extends PoolEntry>(entries: readonly T[]): T[] {
  return entries.filter((entry) => entry.obscurity <= DAILY_MAX_OBSCURITY).sort(byWord);
}

/** Practice ("Free Flight") candidates: every entry, sorted by word. */
export function buildPracticePool<T extends PoolEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(byWord);
}

/** Uniform random pick; `rng` returns floats in [0, 1) (default Math.random). */
export function pickRandom<T>(items: readonly T[], rng: () => number = Math.random): T {
  if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
  const index = Math.min(Math.floor(rng() * items.length), items.length - 1);
  return items[index]!;
}
