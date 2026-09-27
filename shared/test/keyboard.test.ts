import { describe, expect, it } from 'vitest';
import { BACKSPACE_KEY, ENTER_KEY, KEYBOARD_ROWS, keyStates } from '../src/keyboard';
import { row } from './helpers';

describe('keyStates', () => {
  it('is empty before any guess', () => {
    expect(keyStates([])).toEqual({});
  });

  it('records the state of each guessed letter', () => {
    expect(keyStates([row('CRANE', '.YG..')])).toEqual({
      C: 'absent',
      R: 'present',
      A: 'correct',
      N: 'absent',
      E: 'absent',
    });
  });

  it('upgrades present to correct across rows and never downgrades', () => {
    const rows = [row('CRANE', '.Y...'), row('ROBIN', 'G....'), row('BURNT', '..Y..')];
    expect(keyStates(rows).R).toBe('correct');
  });

  it('prefers the best state when a letter repeats within one row', () => {
    // ROOST vs ROBIN: first O correct, second O absent.
    expect(keyStates([row('ROOST', 'GG...')]).O).toBe('correct');
    // Second copy present, first absent.
    expect(keyStates([row('EERIE', '.Y...')]).E).toBe('present');
  });

  it('upgrades absent to present', () => {
    expect(keyStates([row('EERIE', '.....'), row('TENSE', '.Y...')]).E).toBe('present');
  });

  it('uses uppercase keys for lowercase words', () => {
    expect(keyStates([row('wren', 'G...')])).toEqual({ W: 'correct', R: 'absent', E: 'absent', N: 'absent' });
  });
});

describe('KEYBOARD_ROWS', () => {
  it('is a QWERTY layout with Enter and Backspace covering all 26 letters once', () => {
    const keys = KEYBOARD_ROWS.flat();
    expect(keys[19]).toBe(ENTER_KEY);
    expect(keys.at(-1)).toBe(BACKSPACE_KEY);
    const letters = keys.filter((key) => key.length === 1);
    expect(new Set(letters).size).toBe(26);
    expect(letters).toHaveLength(26);
  });
});
