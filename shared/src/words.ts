import { MAX_WORD_LENGTH, MIN_WORD_LENGTH } from './constants';

/** Trims and uppercases user input ("  robin " -> "ROBIN"). */
export function normalizeWord(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * True when `word` is 4-11 ASCII letters (any case), optionally of an exact length.
 * Says nothing about whether it is in the word list; only the server can check that.
 */
export function isWordShape(word: string, length?: number): boolean {
  if (length !== undefined && word.length !== length) return false;
  return word.length >= MIN_WORD_LENGTH && word.length <= MAX_WORD_LENGTH && /^[A-Za-z]+$/.test(word);
}
