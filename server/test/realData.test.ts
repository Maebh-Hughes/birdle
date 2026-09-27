// Generic checks that the server's puzzle layer works with the real word data.
// They assert properties of whatever birds.json contains, never particular birds.
import { describe, expect, it } from 'vitest';
import { MAX_WORD_LENGTH, MIN_WORD_LENGTH } from '@birdle/shared';
import { wordCatalog } from '@birdle/shared/server';
import { createPuzzles } from '../src/puzzle';

describe('real word data', () => {
  const puzzles = createPuzzles(wordCatalog, 'birdle');

  it('gives every daily puzzle of the first cycles a valid, hinted answer with a bird card', () => {
    const cycles = 2 * wordCatalog.dailyPool.length;
    for (let n = 1; n <= cycles; n++) {
      const answer = puzzles.dailyAnswer(n);
      expect(answer.length).toBeGreaterThanOrEqual(MIN_WORD_LENGTH);
      expect(answer.length).toBeLessThanOrEqual(MAX_WORD_LENGTH);
      expect(puzzles.isValidGuess(answer)).toBe(true);
      expect(puzzles.hintFor(answer)).toBeTruthy();
      expect(puzzles.reveal(answer).fact).toBeTruthy();
    }
  });

  it('picks practice answers from the whole list', () => {
    const answer = puzzles.randomPracticeAnswer(() => 0.999);
    expect(wordCatalog.findBird(answer)).toBeDefined();
    expect(puzzles.reveal(answer).wikiUrl).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\/\S+$/);
  });
});
