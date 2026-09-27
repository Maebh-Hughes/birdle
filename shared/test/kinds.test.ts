import { describe, expect, it } from 'vitest';
import {
  BIRD_KINDS,
  DEFAULT_PRACTICE_CATEGORY,
  FICTIONAL_KINDS,
  KIND_LABELS,
  PRACTICE_CATEGORIES,
  PRACTICE_CATEGORY_DESCRIPTIONS,
  PRACTICE_CATEGORY_KINDS,
  PRACTICE_CATEGORY_LABELS,
  isBirdKind,
  isDailyEligible,
  isFictionalKind,
  isInPracticeCategory,
  isPracticeCategory,
} from '../src/kinds';

describe('bird kinds', () => {
  it('lists real and fictional kinds', () => {
    expect(BIRD_KINDS).toEqual(['bird', 'term', 'pokemon', 'game', 'literature']);
    expect(FICTIONAL_KINDS.every((kind) => isFictionalKind(kind))).toBe(true);
    expect(isFictionalKind('bird')).toBe(false);
    expect(isFictionalKind('term')).toBe(false);
    expect(isBirdKind('pokemon')).toBe(true);
    expect(isBirdKind('mammal')).toBe(false);
    expect(isBirdKind(undefined)).toBe(false);
  });

  it('labels every kind for the bird card', () => {
    expect(KIND_LABELS).toEqual({
      bird: 'Bird',
      term: 'Bird word',
      pokemon: 'Pokémon',
      game: 'Video game bird',
      literature: 'Literary bird',
    });
  });
});

describe('isDailyEligible (the daily pool rule)', () => {
  it.each([
    ['bird', 1, true],
    ['bird', 2, true],
    ['bird', 3, false],
    ['term', 2, true],
    ['term', 3, false],
    ['pokemon', 1, true],
    ['pokemon', 2, false],
    ['game', 1, true],
    ['game', 2, false],
    ['literature', 1, true],
    ['literature', 3, false],
  ] as const)('%s with obscurity %i -> %s', (kind, obscurity, eligible) => {
    expect(isDailyEligible({ kind, obscurity })).toBe(eligible);
  });
});

describe('Free Flight categories', () => {
  it('maps each category to its kinds', () => {
    expect(PRACTICE_CATEGORIES).toEqual(['all', 'birds', 'pokemon', 'fiction']);
    expect(DEFAULT_PRACTICE_CATEGORY).toBe('all');
    expect(PRACTICE_CATEGORY_KINDS).toEqual({
      all: BIRD_KINDS,
      birds: ['bird', 'term'],
      pokemon: ['pokemon'],
      fiction: ['game', 'literature'],
    });
  });

  it('puts every kind in "all" and in exactly one other category', () => {
    for (const kind of BIRD_KINDS) {
      expect(isInPracticeCategory(kind, 'all')).toBe(true);
      expect(PRACTICE_CATEGORIES.filter((category) => category !== 'all' && isInPracticeCategory(kind, category))).toHaveLength(1);
    }
  });

  it('validates category values', () => {
    for (const category of PRACTICE_CATEGORIES) expect(isPracticeCategory(category)).toBe(true);
    for (const value of ['ALL', 'bird', '', null, undefined, 3, ['all']]) expect(isPracticeCategory(value)).toBe(false);
  });

  it('has a label and a description for every category', () => {
    for (const category of PRACTICE_CATEGORIES) {
      expect(PRACTICE_CATEGORY_LABELS[category]).toBeTruthy();
      expect(PRACTICE_CATEGORY_DESCRIPTIONS[category]).toBeTruthy();
    }
  });
});
