import type { BirdReveal } from '@birdle/shared';
import { toBirdReveal, wikiUrl, type WordCatalog } from '@birdle/shared/server';

/** Answer selection and lookups over an injectable word catalog. Words are uppercase. */
export interface Puzzles {
  /** Deterministic daily answer for puzzle `puzzleNumber` (>= 1). */
  dailyAnswer(puzzleNumber: number): string;
  /** Random practice answer from all birds, avoiding `previousWord` when possible. */
  randomPracticeAnswer(rng: () => number, previousWord?: string): string;
  isValidGuess(word: string): boolean;
  /** The answer's hint, or null if the word is no longer in the catalog. */
  hintFor(answer: string): string | null;
  /** The end-of-game bird card for an answer. */
  reveal(answer: string): BirdReveal;
}

function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

export function createPuzzles(words: WordCatalog, seed: string): Puzzles {
  return {
    dailyAnswer: (puzzleNumber) => words.dailyBird(puzzleNumber, seed).word,
    randomPracticeAnswer: (rng, previousWord) => words.randomBird(rng, previousWord).word,
    isValidGuess: (word) => words.isValidGuess(word),
    hintFor: (answer) => words.findBird(answer)?.hint ?? null,
    reveal: (answer) => {
      const entry = words.findBird(answer);
      if (entry) return toBirdReveal(entry);
      // A stored game can outlive its entry when birds.json is replaced; still show a card.
      const name = titleCase(answer);
      return { word: answer, name, kind: 'bird', fact: '', wikiUrl: wikiUrl(name) };
    },
  };
}
