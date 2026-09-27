// Generic checks of the real files in shared/data. They must hold for any
// valid birds.json, so they never name particular birds.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkBirdData } from '../src/birdData';
import { MAX_WORD_LENGTH, MIN_WORD_LENGTH } from '../src/constants';
import { PRACTICE_CATEGORIES, isDailyEligible, isInPracticeCategory } from '../src/kinds';
import {
  BIRDS,
  BIRDS_PATH,
  DAILY_POOL,
  GUESSES_PATH,
  dailyBird,
  findBird,
  isValidGuess,
  loadDictionary,
  randomBird,
  toBirdReveal,
  wordCatalog,
} from '../src/server';

describe('shared/data/birds.json', () => {
  const raw: unknown = JSON.parse(readFileSync(BIRDS_PATH, 'utf8'));

  it('passes every structural and editorial rule (npm run check:words)', () => {
    expect(checkBirdData(raw)).toEqual({ errors: [], editorial: [] });
  });

  it('is loaded completely, sorted by word', () => {
    expect(BIRDS).toHaveLength((raw as unknown[]).length);
    const words = BIRDS.map((b) => b.word);
    expect(words).toEqual([...words].sort());
  });

  it('has a daily pool of the daily-eligible entries only', () => {
    expect(DAILY_POOL.length).toBeGreaterThan(0);
    expect(DAILY_POOL).toEqual(BIRDS.filter(isDailyEligible));
  });

  it('has a practice pool for every category (some may still be empty)', () => {
    expect(wordCatalog.practicePool('all')).toEqual(BIRDS);
    expect(wordCatalog.practicePool('birds').length).toBeGreaterThan(0);
    for (const category of PRACTICE_CATEGORIES) {
      expect(wordCatalog.practicePool(category)).toEqual(BIRDS.filter((b) => isInPracticeCategory(b.kind, category)));
    }
  });

  it('makes every bird word a valid guess and findable', () => {
    for (const entry of BIRDS) {
      expect(isValidGuess(entry.word)).toBe(true);
      expect(isValidGuess(entry.word.toLowerCase())).toBe(true);
      expect(findBird(entry.word)).toBe(entry);
    }
  });

  it('builds a bird card with a "Learn more" link for every entry', () => {
    for (const entry of BIRDS) {
      const reveal = toBirdReveal(entry);
      expect(Object.keys(reveal).sort()).toEqual(['fact', 'infoSite', 'infoUrl', 'kind', 'name', 'source', 'word']);
      if (entry.wiki !== undefined) {
        expect(reveal.infoUrl).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\/[^\s/#]+(#\S+)?$/);
        expect(reveal.infoSite).toBe('Wikipedia');
      } else {
        expect(reveal.infoUrl).toBe(entry.link);
        expect(reveal.infoSite).not.toBe('');
      }
      expect(reveal.source).toBe(entry.source ?? null);
    }
  });

  it('gives a daily answer for the first puzzles and random practice birds', () => {
    for (let n = 1; n <= Math.min(DAILY_POOL.length, 60); n++) {
      expect(DAILY_POOL).toContain(dailyBird(n, 'birdle'));
    }
    expect(BIRDS).toContain(randomBird());
  });
});

describe('shared/data/guesses.txt', () => {
  const dictionary = loadDictionary(GUESSES_PATH);

  it('is a large list of 4-11 letter lowercase words', () => {
    expect(dictionary.size).toBeGreaterThan(100_000);
    const pattern = new RegExp(`^[a-z]{${MIN_WORD_LENGTH},${MAX_WORD_LENGTH}}$`);
    for (const word of dictionary) {
      if (!pattern.test(word)) throw new Error(`bad dictionary word ${word}`);
    }
  });

  it('backs isValidGuess (dictionary ∪ bird words), case-insensitively', () => {
    expect(wordCatalog.guessCount).toBeGreaterThanOrEqual(dictionary.size);
    let checked = 0;
    for (const word of dictionary) {
      if (checked++ % 5000 !== 0) continue;
      expect(isValidGuess(word)).toBe(true);
      expect(isValidGuess(word.toUpperCase())).toBe(true);
    }
    expect(isValidGuess('qqqqq')).toBe(false);
    expect(isValidGuess('abc')).toBe(false);
  });
});
