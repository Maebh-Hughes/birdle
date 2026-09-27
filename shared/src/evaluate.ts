import type { LetterState } from './types';

/**
 * Scores a guess against the answer with the standard Wordle two-pass algorithm:
 * exact matches first, then left to right `present` while unmatched copies of the
 * letter remain in the answer, else `absent`. Case-insensitive.
 */
export function evaluateGuess(guess: string, answer: string): LetterState[] {
  const g = guess.toUpperCase();
  const a = answer.toUpperCase();
  if (g.length !== a.length) {
    throw new RangeError(`Guess length ${g.length} does not match answer length ${a.length}`);
  }

  const result: LetterState[] = new Array<LetterState>(a.length).fill('absent');
  const remaining = new Map<string, number>();

  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) {
      result[i] = 'correct';
    } else {
      const letter = a[i]!;
      remaining.set(letter, (remaining.get(letter) ?? 0) + 1);
    }
  }

  for (let i = 0; i < g.length; i++) {
    if (result[i] === 'correct') continue;
    const letter = g[i]!;
    const left = remaining.get(letter) ?? 0;
    if (left > 0) {
      result[i] = 'present';
      remaining.set(letter, left - 1);
    }
  }

  return result;
}

/** True when every tile is `correct`. */
export function isSolved(result: readonly LetterState[]): boolean {
  return result.length > 0 && result.every((state) => state === 'correct');
}
