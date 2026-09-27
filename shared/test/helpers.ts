import type { BirdEntry, GuessRow, LetterState } from '../src/types';

const CODES: Record<string, LetterState> = { G: 'correct', Y: 'present', '.': 'absent' };

/** "GY..G" -> ['correct', 'present', 'absent', 'absent', 'correct'] */
export function states(pattern: string): LetterState[] {
  return [...pattern].map((code) => {
    const state = CODES[code];
    if (!state) throw new Error(`Unknown state code "${code}"`);
    return state;
  });
}

export function row(word: string, pattern: string): GuessRow {
  return { word, result: states(pattern) };
}

/** A valid fixture entry; override any field. */
export function bird(word: string, overrides: Partial<BirdEntry> = {}): BirdEntry {
  const name = word.charAt(0) + word.slice(1).toLowerCase();
  return {
    word,
    name,
    kind: 'bird',
    hint: `Fixture hint number ${word.length}`,
    fact: `Fixture fact about a ${word.length}-letter entry.`,
    wiki: name,
    obscurity: 1,
    ...overrides,
  };
}
