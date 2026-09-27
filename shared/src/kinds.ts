import { DAILY_MAX_OBSCURITY, DAILY_MAX_OBSCURITY_FICTIONAL } from './constants';
import type { BirdKind, Obscurity, PracticeCategory } from './types';

// Kinds of answers, the daily pool rule and the Free Flight categories. Pure and
// client-safe: the client uses the labels, the server and check:words the rules.

export const BIRD_KINDS: readonly BirdKind[] = ['bird', 'term', 'pokemon', 'game', 'literature'];

/** Fictional birds: they name their `source` and must be very well known to be daily answers. */
export const FICTIONAL_KINDS: readonly BirdKind[] = ['pokemon', 'game', 'literature'];

export function isBirdKind(value: unknown): value is BirdKind {
  return typeof value === 'string' && (BIRD_KINDS as readonly string[]).includes(value);
}

export function isFictionalKind(kind: BirdKind): boolean {
  return FICTIONAL_KINDS.includes(kind);
}

/** The kind label on the bird card. */
export const KIND_LABELS: Readonly<Record<BirdKind, string>> = {
  bird: 'Bird',
  term: 'Bird word',
  pokemon: 'Pokémon',
  game: 'Video game bird',
  literature: 'Literary bird',
};

/** Highest obscurity each kind can have and still be a daily answer. */
export const DAILY_MAX_OBSCURITY_BY_KIND: Readonly<Record<BirdKind, Obscurity>> = {
  bird: DAILY_MAX_OBSCURITY,
  term: DAILY_MAX_OBSCURITY,
  pokemon: DAILY_MAX_OBSCURITY_FICTIONAL,
  game: DAILY_MAX_OBSCURITY_FICTIONAL,
  literature: DAILY_MAX_OBSCURITY_FICTIONAL,
};

/**
 * The daily pool rule: real birds and bird words with obscurity <= 2, plus
 * Pokémon, video game and literary birds with obscurity 1. Everything else is
 * Free Flight only.
 */
export function isDailyEligible(entry: { kind: BirdKind; obscurity: number }): boolean {
  return entry.obscurity <= DAILY_MAX_OBSCURITY_BY_KIND[entry.kind];
}

export const PRACTICE_CATEGORIES: readonly PracticeCategory[] = ['all', 'birds', 'pokemon', 'fiction'];

export const DEFAULT_PRACTICE_CATEGORY: PracticeCategory = 'all';

/** The kinds each Free Flight category draws from. */
export const PRACTICE_CATEGORY_KINDS: Readonly<Record<PracticeCategory, readonly BirdKind[]>> = {
  all: BIRD_KINDS,
  birds: ['bird', 'term'],
  pokemon: ['pokemon'],
  fiction: ['game', 'literature'],
};

/** Short labels for the category picker. */
export const PRACTICE_CATEGORY_LABELS: Readonly<Record<PracticeCategory, string>> = {
  all: 'All',
  birds: 'Real birds',
  pokemon: 'Pokémon',
  fiction: 'Games & books',
};

/** What each category holds, for tooltips and error messages. */
export const PRACTICE_CATEGORY_DESCRIPTIONS: Readonly<Record<PracticeCategory, string>> = {
  all: 'Every bird: real, Pokémon, video games and books',
  birds: 'Real birds and bird words only',
  pokemon: 'Bird Pokémon',
  fiction: 'Birds from video games and books',
};

export function isPracticeCategory(value: unknown): value is PracticeCategory {
  return typeof value === 'string' && (PRACTICE_CATEGORIES as readonly string[]).includes(value);
}

export function isInPracticeCategory(kind: BirdKind, category: PracticeCategory): boolean {
  return PRACTICE_CATEGORY_KINDS[category].includes(kind);
}
