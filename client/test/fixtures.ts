import { emptyStats, evaluateGuess, type BirdReveal, type GameView, type GuessRow, type Stats } from '@birdle/shared';

// Hand-made games: the client never sees the word list, and tests must not
// depend on which birds are in shared/data/birds.json.

export function row(guess: string, answer: string): GuessRow {
  return { word: guess, result: evaluateGuess(guess, answer) };
}

/** A game view; practice games (mode 'practice') default to the 'all' category. */
export function makeGame(overrides: Partial<GameView> = {}): GameView {
  return {
    mode: 'daily',
    puzzleNumber: 7,
    date: '2026-10-02',
    category: overrides.mode === 'practice' ? 'all' : null,
    wordLength: 5,
    guesses: [],
    status: 'playing',
    hardMode: false,
    hintUsed: false,
    hintAvailable: false,
    hint: null,
    answer: null,
    maxGuesses: 6,
    ...overrides,
  };
}

export function makeStats(overrides: Partial<Stats> = {}): Stats {
  return { ...emptyStats(), ...overrides };
}

/** A bird card for a real bird (Wikipedia link). */
export function makeReveal(overrides: Partial<BirdReveal> = {}): BirdReveal {
  return {
    word: 'CRANE',
    name: 'Crane',
    kind: 'bird',
    source: null,
    fact: 'Fixture fact.',
    infoUrl: 'https://en.wikipedia.org/wiki/Crane_(bird)',
    infoSite: 'Wikipedia',
    ...overrides,
  };
}
