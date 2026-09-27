/** Shortest answer / guess length. */
export const MIN_WORD_LENGTH = 4;
/** Longest answer / guess length. */
export const MAX_WORD_LENGTH = 11;
/** Guesses per game, whatever the word length. */
export const MAX_GUESSES = 6;
/** The hint unlocks once this many guesses have been made. */
export const HINT_AFTER_GUESSES = 3;
/** Calendar date (YYYY-MM-DD) of daily puzzle #1. */
export const EPOCH_DATE = '2026-09-26';
/** Default for the PUZZLE_SEED env variable that shuffles the daily order. */
export const DEFAULT_PUZZLE_SEED = 'birdle';
/** Birds with obscurity above this are practice-only (never a daily answer). */
export const DAILY_MAX_OBSCURITY = 2;
/** Editorial limits for birds.json (enforced by `npm run check:words`). */
export const HINT_MAX_LENGTH = 110;
export const FACT_MAX_LENGTH = 220;
export const WIKIPEDIA_BASE_URL = 'https://en.wikipedia.org/wiki/';
