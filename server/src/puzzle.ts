import type { BirdReveal, PracticeCategory } from '@birdle/shared';
import { minimalBirdReveal, toBirdReveal, type WordCatalog } from '@birdle/shared/server';

/** Answer selection and lookups over an injectable word catalog. Words are uppercase. */
export interface Puzzles {
  /** Deterministic daily answer for puzzle `puzzleNumber` (>= 1) under the current word list. */
  dailyAnswer(puzzleNumber: number): string;
  /** How many answers a Free Flight category holds (0 = none yet). */
  practiceCount(category: PracticeCategory): number;
  /**
   * Random practice answer from a category, avoiding `previousWord` when possible.
   * Throws RangeError for an empty category (check practiceCount first).
   */
  randomPracticeAnswer(rng: () => number, previousWord: string | undefined, category: PracticeCategory): string;
  isValidGuess(word: string): boolean;
  /** The answer's hint, or null if the word is no longer in the catalog. */
  hintFor(answer: string): string | null;
  /** The end-of-game bird card for an answer. */
  reveal(answer: string): BirdReveal;
}

export function createPuzzles(words: WordCatalog, seed: string): Puzzles {
  return {
    dailyAnswer: (puzzleNumber) => words.dailyBird(puzzleNumber, seed).word,
    practiceCount: (category) => words.practicePool(category).length,
    randomPracticeAnswer: (rng, previousWord, category) => words.randomBird(rng, previousWord, category).word,
    isValidGuess: (word) => words.isValidGuess(word),
    hintFor: (answer) => words.findBird(answer)?.hint ?? null,
    reveal: (answer) => {
      const entry = words.findBird(answer);
      // A stored game or a pinned daily answer can outlive its entry when birds.json
      // changes; the game still works and ends with a minimal card.
      return entry ? toBirdReveal(entry) : minimalBirdReveal(answer);
    },
  };
}
