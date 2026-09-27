import { describe, expect, it } from 'vitest';
import { DEFAULT_ERROR_MESSAGES, WIN_MESSAGES, winMessage } from '../src/messages';
import { API_ERROR_CODES } from '../src/types';

describe('winMessage', () => {
  it.each([
    [1, 'Eagle-eyed!'],
    [2, 'Soaring!'],
    [3, 'Fine feathered!'],
    [4, 'Chirpy!'],
    [5, 'Just flew in!'],
    [6, 'Phew — by a feather!'],
  ])('%i guesses -> %s', (count, message) => {
    expect(winMessage(count)).toBe(message);
  });

  it('clamps out-of-range counts', () => {
    expect(winMessage(0)).toBe(WIN_MESSAGES[0]);
    expect(winMessage(9)).toBe(WIN_MESSAGES[5]);
  });
});

describe('DEFAULT_ERROR_MESSAGES', () => {
  it('has a message for every API error code', () => {
    for (const code of API_ERROR_CODES) expect(DEFAULT_ERROR_MESSAGES[code]).toMatch(/\S/);
    expect(DEFAULT_ERROR_MESSAGES.INVALID_GUESS).toBe('Not enough letters');
    expect(DEFAULT_ERROR_MESSAGES.NOT_IN_WORD_LIST).toBe('Not in word list');
  });
});
