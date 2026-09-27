import { describe, expect, it } from 'vitest';
import { dailyAnswer } from '../src/puzzle';
import { createWordCatalog } from '../src/server';
import { bird } from './helpers';

// Bird words deliberately missing from the fixture dictionary (like TWITE in the real one).
const BIRDS = [bird('WREN'), bird('TWITE', { obscurity: 2 }), bird('ROBIN', { obscurity: 3 }), bird('PELICAN')];
const DICTIONARY = ['crane', 'roost', 'geese', 'robin', 'trail'];

describe('createWordCatalog', () => {
  const catalog = createWordCatalog(BIRDS, DICTIONARY);

  it('accepts dictionary words and every bird word, case-insensitively', () => {
    for (const word of ['crane', 'CRANE', 'Roost', 'wren', 'TWITE', 'twite', 'Pelican', 'ROBIN']) {
      expect(catalog.isValidGuess(word)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const word of ['xxxxx', 'crane ', 'cranes', '', 'CRAN']) {
      expect(catalog.isValidGuess(word)).toBe(false);
    }
  });

  it('counts the union of dictionary and bird words', () => {
    expect(catalog.guessCount).toBe(8); // 5 dictionary words + WREN, TWITE, PELICAN (ROBIN is in both)
  });

  it('sorts birds and builds the daily pool without obscurity 3', () => {
    expect(catalog.birds.map((b) => b.word)).toEqual(['PELICAN', 'ROBIN', 'TWITE', 'WREN']);
    expect(catalog.dailyPool.map((b) => b.word)).toEqual(['PELICAN', 'TWITE', 'WREN']);
  });

  it('freezes entries so shared data cannot be mutated', () => {
    expect(Object.isFrozen(catalog.birds)).toBe(true);
    expect(Object.isFrozen(catalog.dailyPool)).toBe(true);
    expect(Object.isFrozen(catalog.birds[0])).toBe(true);
  });

  it('finds birds by word in any case', () => {
    expect(catalog.findBird('twite')?.word).toBe('TWITE');
    expect(catalog.findBird('crane')).toBeUndefined();
  });

  it('picks daily birds deterministically from the daily pool', () => {
    for (let n = 1; n <= 9; n++) {
      const entry = catalog.dailyBird(n, 'seed');
      expect(entry).toBe(dailyAnswer(catalog.dailyPool, n, 'seed'));
      expect(entry.obscurity).toBeLessThanOrEqual(2);
    }
    const cycle = [1, 2, 3].map((n) => catalog.dailyBird(n, 'seed').word);
    expect(new Set(cycle).size).toBe(3);
  });

  it('picks practice birds from all entries and can avoid a repeat', () => {
    expect(catalog.randomBird(() => 0).word).toBe('PELICAN');
    expect(catalog.randomBird(() => 0.3).word).toBe('ROBIN'); // obscurity 3 is fine for practice
    expect(catalog.randomBird(() => 0, 'pelican').word).toBe('ROBIN');
    const single = createWordCatalog([bird('WREN')], []);
    expect(single.randomBird(() => 0, 'WREN').word).toBe('WREN');
  });
});
