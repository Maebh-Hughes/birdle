import { DEFAULT_ERROR_MESSAGES } from '@birdle/shared';
import { ApiError } from '../api';

export const NETWORK_MESSAGE = "Can't reach the nest. Check your connection and try again.";
export const UNKNOWN_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Player-facing text for a failed request. The server's own message is used only
 * for HARD_MODE ("2nd letter must be R") and INVALID_GUESS ("Too many letters"),
 * where it names the exact problem; every other code gets the shared default text.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return UNKNOWN_MESSAGE;
  switch (error.code) {
    case 'NETWORK':
      return NETWORK_MESSAGE;
    case 'UNKNOWN':
      return UNKNOWN_MESSAGE;
    case 'HARD_MODE':
    case 'INVALID_GUESS':
      return error.message && error.message !== error.code ? error.message : DEFAULT_ERROR_MESSAGES[error.code];
    default:
      return DEFAULT_ERROR_MESSAGES[error.code];
  }
}

/**
 * The server's game differs from the one on screen: it already ended, it was
 * replaced (another tab started a new Free Flight bird of a different length),
 * or it no longer exists. The client never sends a wrong-length guess itself.
 */
export function isStaleGameError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'GAME_OVER' || error.code === 'INVALID_GUESS' || error.code === 'NOT_FOUND')
  );
}

/**
 * No answer came back (timeout, dropped connection) or the server failed
 * (5xx), so the request may still have been applied.
 */
export function isUncertainOutcome(error: unknown): boolean {
  return !(error instanceof ApiError) || error.code === 'NETWORK' || error.code === 'UNKNOWN';
}

/** A guess the server refused on its merits: shake the row, keep the letters. */
export function isRejectedGuess(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'INVALID_GUESS' || error.code === 'NOT_IN_WORD_LIST' || error.code === 'HARD_MODE')
  );
}
