import { HINT_AFTER_GUESSES, MAX_GUESSES } from './constants';
import type { ApiErrorCode } from './types';

/** Toast after a win, indexed by guess count - 1. */
export const WIN_MESSAGES: readonly string[] = [
  'Eagle-eyed!',
  'Soaring!',
  'Fine feathered!',
  'Chirpy!',
  'Just flew in!',
  'Phew — by a feather!',
];

/** Win toast for a game solved in `guessCount` guesses (clamped to 1..MAX_GUESSES). */
export function winMessage(guessCount: number): string {
  const index = Math.min(Math.max(Math.trunc(guessCount), 1), MAX_GUESSES) - 1;
  return WIN_MESSAGES[index]!;
}

/** Player-facing fallback text for each API error code (the server may send a more specific message). */
export const DEFAULT_ERROR_MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  BAD_REQUEST: 'Something went wrong with that request',
  UNAUTHORIZED: 'Please sign in again',
  BAD_DATE: "That puzzle isn't available",
  NOT_IN_WORD_LIST: 'Not in word list',
  HARD_MODE: 'Hard mode: use every revealed hint',
  INVALID_GUESS: 'Not enough letters',
  GAME_OVER: 'This game is already over',
  HINT_UNAVAILABLE: `The hint unlocks after ${HINT_AFTER_GUESSES} guesses`,
  NOT_FOUND: 'Not found',
  FORBIDDEN: "You can't do that",
};
