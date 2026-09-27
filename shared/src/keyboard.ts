import type { GuessRow, LetterState } from './types';

export const ENTER_KEY = 'ENTER';
export const BACKSPACE_KEY = 'BACKSPACE';

/** On-screen QWERTY layout; the last row starts with Enter and ends with Backspace. */
export const KEYBOARD_ROWS: readonly (readonly string[])[] = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  [ENTER_KEY, 'Z', 'X', 'C', 'V', 'B', 'N', 'M', BACKSPACE_KEY],
];

const PRIORITY: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 };

/**
 * Best known state of every guessed letter (uppercase keys), for colouring the
 * keyboard: correct > present > absent. Letters never guessed are omitted.
 */
export function keyStates(rows: readonly GuessRow[]): Record<string, LetterState> {
  const states: Record<string, LetterState> = {};
  for (const row of rows) {
    const word = row.word.toUpperCase();
    row.result.forEach((state, i) => {
      const letter = word[i];
      if (letter === undefined) return;
      const current = states[letter];
      if (current === undefined || PRIORITY[state] > PRIORITY[current]) states[letter] = state;
    });
  }
  return states;
}
