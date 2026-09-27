import { describe, expect, it } from 'vitest';
import { evaluateGuess, isSolved } from '../src/evaluate';
import { isWordShape, normalizeWord } from '../src/words';
import { states } from './helpers';

// Patterns: G = correct, Y = present, . = absent
describe('evaluateGuess', () => {
  it.each([
    ['ROBIN', 'ROOST', 'GG...', 'the second O finds no unmatched O left'],
    ['EAGLE', 'GEESE', 'YY..G', 'the exact final E uses one E; only one more E is present'],
    ['EGRET', 'EERIE', 'GYG..', 'three Es guessed, two in the answer'],
    ['KITE', 'TOTE', '..GG', 'a later exact match wins over an earlier present'],
    ['SWIFT', 'TWIST', '.GGYG', 'the exact final T leaves no T for the first one'],
    ['PIPIT', 'PAPPY', 'G.G..', 'the surplus P is absent'],
    ['GOOSE', 'OOZES', 'YG.YY', 'one O exact, the other O present'],
    ['LOON', 'ONTO', 'YY.Y', 'both Os present, none exact'],
  ])('answer %s, guess %s -> %s (%s)', (answer, guess, expected) => {
    expect(evaluateGuess(guess, answer)).toEqual(states(expected));
  });

  it('handles the shortest words (4 letters)', () => {
    expect(evaluateGuess('WREN', 'WREN')).toEqual(states('GGGG'));
    expect(evaluateGuess('NEWT', 'WREN')).toEqual(states('YYY.'));
  });

  it('handles the longest words (11 letters)', () => {
    expect(evaluateGuess('HUMMINGBIRD', 'HUMMINGBIRD')).toEqual(states('GGGGGGGGGGG'));
    expect(evaluateGuess('MOCKINGBIRD', 'HUMMINGBIRD')).toEqual(states('Y...GGGGGGG'));
  });

  it('returns all correct for the answer and all absent when no letter matches', () => {
    expect(evaluateGuess('ROBIN', 'ROBIN')).toEqual(states('GGGGG'));
    expect(evaluateGuess('CLUMP', 'ROBIN')).toEqual(states('.....'));
  });

  it('is case-insensitive', () => {
    expect(evaluateGuess('robin', 'ROBIN')).toEqual(states('GGGGG'));
    expect(evaluateGuess('ROOST', 'robin')).toEqual(states('GG...'));
  });

  it('rejects guesses of a different length', () => {
    expect(() => evaluateGuess('ROBINS', 'ROBIN')).toThrow(RangeError);
  });
});

describe('isSolved', () => {
  it('is true only when every tile is correct', () => {
    expect(isSolved(states('GGGG'))).toBe(true);
    expect(isSolved(states('GGYG'))).toBe(false);
    expect(isSolved([])).toBe(false);
  });
});

describe('normalizeWord / isWordShape', () => {
  it('trims and uppercases', () => {
    expect(normalizeWord('  robin ')).toBe('ROBIN');
  });

  it('accepts 4-11 ASCII letters, optionally of an exact length', () => {
    expect(isWordShape('wren')).toBe(true);
    expect(isWordShape('HUMMINGBIRD')).toBe(true);
    expect(isWordShape('EMU')).toBe(false);
    expect(isWordShape('HUMMINGBIRDS')).toBe(false);
    expect(isWordShape('BLUE-JAY')).toBe(false);
    expect(isWordShape('KĀKĀ')).toBe(false);
    expect(isWordShape('ROBIN', 5)).toBe(true);
    expect(isWordShape('ROBIN', 6)).toBe(false);
  });
});
