// SERVER-ONLY entry point (@birdle/shared/server). It loads the answer list with
// hints and facts plus the guess dictionary, so it must never be imported by
// client code. The data is read and validated once, when this module is loaded.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BirdleDataError, parseBirdData, parseDictionary } from './birdData';
import { buildDailyPool, buildPracticePool, dailyAnswer, pickRandom } from './puzzle';
import type { BirdEntry } from './types';

export {
  BIRD_KINDS,
  BIRD_WORD_PATTERN,
  BirdleDataError,
  DICTIONARY_WORD_PATTERN,
  checkBirdData,
  parseBirdData,
  parseDictionary,
  toBirdReveal,
  wikiUrl,
} from './birdData';
export type { BirdDataReport } from './birdData';
export type { BirdEntry, BirdKind, BirdReveal, Obscurity } from './types';

export const BIRDS_PATH: string = fileURLToPath(new URL('../data/birds.json', import.meta.url));
export const GUESSES_PATH: string = fileURLToPath(new URL('../data/guesses.txt', import.meta.url));

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readText(path: string): string {
  try {
    return stripBom(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new BirdleDataError(`Cannot read ${path}: ${(error as Error).message}`);
  }
}

/** Reads and structurally validates birds.json. Throws BirdleDataError when unreadable or malformed. */
export function loadBirds(path: string = BIRDS_PATH): BirdEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(readText(path));
  } catch (error) {
    if (error instanceof BirdleDataError) throw error;
    throw new BirdleDataError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  return parseBirdData(data, path);
}

/** Reads and validates guesses.txt (lowercase words). Throws BirdleDataError when unreadable or malformed. */
export function loadDictionary(path: string = GUESSES_PATH): Set<string> {
  return parseDictionary(readText(path), path);
}

/** Answers plus the guess validator, built from injectable word lists (use fixtures in tests). */
export interface WordCatalog {
  /** Every answer entry (the practice pool), sorted by word, frozen. */
  readonly birds: readonly BirdEntry[];
  /** Daily candidates (obscurity <= 2), sorted by word, frozen. */
  readonly dailyPool: readonly BirdEntry[];
  /** Number of distinct valid guesses (dictionary ∪ bird words). */
  readonly guessCount: number;
  /** Case-insensitive: in the dictionary or one of the bird words. */
  isValidGuess(word: string): boolean;
  /** Case-insensitive lookup of an answer entry. */
  findBird(word: string): BirdEntry | undefined;
  /** Deterministic daily answer for puzzle `puzzleNumber` (>= 1) under `seed`. */
  dailyBird(puzzleNumber: number, seed: string): BirdEntry;
  /** Random practice answer from all birds, avoiding `excludeWord` when possible. */
  randomBird(rng?: () => number, excludeWord?: string): BirdEntry;
}

export function createWordCatalog(birds: readonly BirdEntry[], dictionary: Iterable<string>): WordCatalog {
  const entries = buildPracticePool(birds.map((bird) => Object.freeze({ ...bird })));
  const all = Object.freeze(entries);
  const dailyPool = Object.freeze(buildDailyPool(entries));
  const byWord = new Map(entries.map((entry) => [entry.word, entry] as const));

  const guesses = new Set<string>();
  for (const word of dictionary) guesses.add(word.toLowerCase());
  for (const entry of entries) guesses.add(entry.word.toLowerCase());

  return {
    birds: all,
    dailyPool,
    guessCount: guesses.size,
    isValidGuess: (word) => guesses.has(word.toLowerCase()),
    findBird: (word) => byWord.get(word.toUpperCase()),
    dailyBird: (puzzleNumber, seed) => dailyAnswer(dailyPool, puzzleNumber, seed),
    randomBird: (rng = Math.random, excludeWord) => {
      const exclude = excludeWord?.toUpperCase();
      const candidates = all.length > 1 && exclude !== undefined ? all.filter((entry) => entry.word !== exclude) : all;
      return pickRandom(candidates, rng);
    },
  };
}

/** The catalog built from shared/data at module load. */
export const wordCatalog: WordCatalog = createWordCatalog(loadBirds(), loadDictionary());

/** All answer entries (birds.json), sorted by word. */
export const BIRDS: readonly BirdEntry[] = wordCatalog.birds;

/** Daily answer candidates: obscurity <= 2, sorted by word. */
export const DAILY_POOL: readonly BirdEntry[] = wordCatalog.dailyPool;

/** True when `word` (any case) is in the dictionary or is a bird word. */
export function isValidGuess(word: string): boolean {
  return wordCatalog.isValidGuess(word);
}

/** Answer entry for `word` (any case), if it is one. */
export function findBird(word: string): BirdEntry | undefined {
  return wordCatalog.findBird(word);
}

/** Daily answer entry for a puzzle number under the given seed (PUZZLE_SEED). */
export function dailyBird(puzzleNumber: number, seed: string): BirdEntry {
  return wordCatalog.dailyBird(puzzleNumber, seed);
}

/** Random practice answer from all birds; pass the previous word to avoid an immediate repeat. */
export function randomBird(rng?: () => number, excludeWord?: string): BirdEntry {
  return wordCatalog.randomBird(rng, excludeWord);
}
