import type { GuessRow } from './types';

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 22 -> "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Wordle hard-mode check. Every revealed `correct` letter must stay in place and
 * every revealed letter (`correct` or `present`) must be reused, as many times as
 * it was revealed in a single row. Returns the first violation as a Wordle-style
 * message ("2nd letter must be R", then "Guess must contain A"), or null if the
 * guess is allowed. Case-insensitive; messages use uppercase letters.
 */
export function hardModeViolation(guess: string, previous: readonly GuessRow[]): string | null {
  const g = guess.toUpperCase();

  // Position -> letter that must be there (all rows agree for a consistent game).
  const fixed = new Map<number, string>();
  // Letter -> minimum number of copies the guess must contain (first-seen order).
  const required = new Map<string, number>();

  for (const row of previous) {
    const word = row.word.toUpperCase();
    const counts = new Map<string, number>();
    row.result.forEach((state, i) => {
      const letter = word[i];
      if (letter === undefined || state === 'absent') return;
      if (state === 'correct' && !fixed.has(i)) fixed.set(i, letter);
      counts.set(letter, (counts.get(letter) ?? 0) + 1);
    });
    for (const [letter, count] of counts) {
      required.set(letter, Math.max(required.get(letter) ?? 0, count));
    }
  }

  for (const i of [...fixed.keys()].sort((a, b) => a - b)) {
    const letter = fixed.get(i)!;
    if (g[i] !== letter) return `${ordinal(i + 1)} letter must be ${letter}`;
  }

  for (const [letter, count] of required) {
    let have = 0;
    for (const ch of g) if (ch === letter) have++;
    if (have < count) return `Guess must contain ${letter}`;
  }

  return null;
}
