import { describe, expect, it } from 'vitest';
import { evaluateGuess } from '../src/evaluate';
import { hardModeViolation, ordinal } from '../src/hardMode';
import { row } from './helpers';

describe('ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [10, '10th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
    [111, '111th'],
  ])('%i -> %s', (n, expected) => {
    expect(ordinal(n)).toBe(expected);
  });
});

describe('hardModeViolation', () => {
  // TRAIL against some answer: R correct in 2nd place, A present elsewhere.
  const trail = row('TRAIL', '.GY..');

  it('allows anything on the first guess', () => {
    expect(hardModeViolation('ZZZZZ', [])).toBeNull();
  });

  it('requires revealed correct letters to stay in place', () => {
    expect(hardModeViolation('CARPS', [trail])).toBe('2nd letter must be R');
  });

  it('requires revealed present letters to be reused', () => {
    expect(hardModeViolation('CREST', [trail])).toBe('Guess must contain A');
  });

  it('accepts a guess that uses every revealed hint', () => {
    expect(hardModeViolation('BRAVE', [trail])).toBeNull();
    expect(hardModeViolation('ARBOR', [trail])).toBeNull(); // A may move anywhere
  });

  it('reports position violations before missing letters', () => {
    expect(hardModeViolation('ZZZZZ', [trail])).toBe('2nd letter must be R');
  });

  it('checks positions in order and uses correct ordinals', () => {
    const rows = [row('ABCD', 'G..G')];
    expect(hardModeViolation('XBCX', rows)).toBe('1st letter must be A');
    expect(hardModeViolation('ABCX', rows)).toBe('4th letter must be D');
    expect(hardModeViolation('AXYD', [row('ABCD', '..G.')])).toBe('3rd letter must be C');
    const eleven = row('MOCKINGBIRD', '..........G');
    expect(hardModeViolation('HUMMINGBIRX', [eleven])).toBe('11th letter must be D');
    expect(hardModeViolation('HUMMINGBIRD', [eleven])).toBeNull();
  });

  it('requires as many copies of a letter as one row revealed', () => {
    // GEESE vs EAGLE: G present, first E present, last E correct -> two Es needed, one at the end.
    const geese = { word: 'GEESE', result: evaluateGuess('GEESE', 'EAGLE') };
    expect(hardModeViolation('LODGE', [geese])).toBe('Guess must contain E');
    expect(hardModeViolation('EAGLE', [geese])).toBeNull();
    expect(hardModeViolation('GLEBE', [geese])).toBeNull();
  });

  it('does not require letters revealed as absent to be avoided', () => {
    expect(hardModeViolation('TRACT', [trail])).toBeNull();
  });

  it('accumulates constraints from every previous row', () => {
    const rows = [row('STORK', 'Y....'), row('CRANE', '..G..')];
    expect(hardModeViolation('BLAST', rows)).toBeNull();
    expect(hardModeViolation('BLACK', rows)).toBe('Guess must contain S');
    expect(hardModeViolation('SLOTH', rows)).toBe('3rd letter must be A');
  });

  it('is case-insensitive and reports uppercase letters', () => {
    expect(hardModeViolation('brave', [row('trail', '.GY..')])).toBeNull();
    expect(hardModeViolation('carps', [row('trail', '.GY..')])).toBe('2nd letter must be R');
    expect(hardModeViolation('crest', [row('trail', '.GY..')])).toBe('Guess must contain A');
  });
});
