import {
  DAILY_MAX_OBSCURITY,
  FACT_MAX_LENGTH,
  HINT_MAX_LENGTH,
  MAX_WORD_LENGTH,
  MIN_WORD_LENGTH,
  WIKIPEDIA_BASE_URL,
} from './constants';
import type { BirdEntry, BirdKind, BirdReveal } from './types';

// Validation and parsing of the word data. Pure: no fs, no data. The loader
// lives in ./server and the CLI in scripts/check-words.mjs.

export const BIRD_WORD_PATTERN = new RegExp(`^[A-Z]{${MIN_WORD_LENGTH},${MAX_WORD_LENGTH}}$`);
export const DICTIONARY_WORD_PATTERN = new RegExp(`^[a-z]{${MIN_WORD_LENGTH},${MAX_WORD_LENGTH}}$`);
export const BIRD_KINDS: readonly BirdKind[] = ['bird', 'term'];

const BIRD_FIELDS: readonly string[] = ['word', 'name', 'kind', 'hint', 'fact', 'wiki', 'obscurity'];
const TEXT_FIELDS = ['name', 'hint', 'fact', 'wiki'] as const;
const MAX_LISTED_PROBLEMS = 25;

/** Thrown when a data file is malformed; `problems` lists every issue found. */
export class BirdleDataError extends Error {
  readonly problems: readonly string[];

  constructor(summary: string, problems: readonly string[] = []) {
    const listed = problems.slice(0, MAX_LISTED_PROBLEMS).map((p) => `\n  - ${p}`).join('');
    const more = problems.length > MAX_LISTED_PROBLEMS ? `\n  ... and ${problems.length - MAX_LISTED_PROBLEMS} more` : '';
    super(`${summary}${listed}${more}`);
    this.name = 'BirdleDataError';
    this.problems = problems;
  }
}

export interface BirdDataReport {
  /** Structural problems: the data is unusable and the server refuses to load it. */
  errors: string[];
  /** Editorial problems (lengths, hint giving away the word, stray fields/whitespace): fail `check:words` only. */
  editorial: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lowercase with diacritics removed, so "Kākāpō" matches "kakapo". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function charCount(text: string): number {
  return [...text].length;
}

/**
 * Checks parsed birds.json content against the data rules: an array of
 * {word, name, kind, hint, fact, wiki, obscurity} with word ^[A-Z]{4,11}$ and
 * unique, kind 'bird' | 'term', obscurity 1-3, non-empty text fields, and at
 * least one daily-eligible entry; editorially, hint <= 110 and fact <= 220
 * characters and the hint must not contain the word.
 */
export function checkBirdData(data: unknown): BirdDataReport {
  const errors: string[] = [];
  const editorial: string[] = [];

  if (!Array.isArray(data)) {
    errors.push('expected a JSON array of bird entries');
    return { errors, editorial };
  }
  if (data.length === 0) errors.push('the list is empty');

  const firstIndex = new Map<string, number>();
  let dailyEligible = 0;

  data.forEach((entry: unknown, index) => {
    if (!isRecord(entry)) {
      errors.push(`[${index}]: expected an object, got ${entry === null ? 'null' : typeof entry}`);
      return;
    }
    const { word, kind, obscurity, hint, fact } = entry;
    const label = `[${index}]${typeof word === 'string' ? ` ${word}` : ''}`;

    if (typeof word !== 'string' || !BIRD_WORD_PATTERN.test(word)) {
      errors.push(`${label}: "word" must be ${MIN_WORD_LENGTH}-${MAX_WORD_LENGTH} uppercase letters A-Z, got ${JSON.stringify(word)}`);
    } else {
      const seen = firstIndex.get(word);
      if (seen === undefined) firstIndex.set(word, index);
      else errors.push(`${label}: duplicate word (first at [${seen}])`);
    }

    for (const field of TEXT_FIELDS) {
      const value = entry[field];
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`${label}: "${field}" must be a non-empty string`);
      } else if (value !== value.trim()) {
        editorial.push(`${label}: "${field}" has leading or trailing whitespace`);
      }
    }

    if (typeof kind !== 'string' || !(BIRD_KINDS as readonly string[]).includes(kind)) {
      errors.push(`${label}: "kind" must be one of ${BIRD_KINDS.map((k) => `"${k}"`).join(', ')}, got ${JSON.stringify(kind)}`);
    }

    if (obscurity !== 1 && obscurity !== 2 && obscurity !== 3) {
      errors.push(`${label}: "obscurity" must be 1, 2 or 3, got ${JSON.stringify(obscurity)}`);
    } else if (obscurity <= DAILY_MAX_OBSCURITY) {
      dailyEligible++;
    }

    for (const key of Object.keys(entry)) {
      if (!BIRD_FIELDS.includes(key)) editorial.push(`${label}: unexpected field "${key}"`);
    }

    if (typeof hint === 'string') {
      const length = charCount(hint);
      if (length > HINT_MAX_LENGTH) editorial.push(`${label}: hint is ${length} characters (max ${HINT_MAX_LENGTH})`);
      if (typeof word === 'string' && word !== '' && fold(hint).includes(word.toLowerCase())) {
        editorial.push(`${label}: hint contains the word`);
      }
    }
    if (typeof fact === 'string') {
      const length = charCount(fact);
      if (length > FACT_MAX_LENGTH) editorial.push(`${label}: fact is ${length} characters (max ${FACT_MAX_LENGTH})`);
    }
  });

  if (data.length > 0 && dailyEligible === 0) {
    errors.push(`no entry has obscurity <= ${DAILY_MAX_OBSCURITY}, so there would be no daily answers`);
  }

  return { errors, editorial };
}

/**
 * Validates parsed birds.json content structurally and returns typed entries.
 * Throws BirdleDataError listing every structural problem. Editorial problems
 * are not fatal here (run `npm run check:words` for those).
 */
export function parseBirdData(data: unknown, source = 'birds.json'): BirdEntry[] {
  const { errors } = checkBirdData(data);
  if (errors.length > 0) {
    throw new BirdleDataError(`${source} is malformed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`, errors);
  }
  return (data as Record<string, unknown>[]).map((entry) => ({
    word: entry.word as string,
    name: entry.name as string,
    kind: entry.kind as BirdKind,
    hint: entry.hint as string,
    fact: entry.fact as string,
    wiki: entry.wiki as string,
    obscurity: entry.obscurity as BirdEntry['obscurity'],
  }));
}

/**
 * Parses guesses.txt: one lowercase 4-11 letter word per line (LF or CRLF;
 * blank lines ignored). Throws BirdleDataError on any other line or if empty.
 */
export function parseDictionary(text: string, source = 'guesses.txt'): Set<string> {
  const words = new Set<string>();
  const problems: string[] = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') return;
    if (DICTIONARY_WORD_PATTERN.test(line)) words.add(line);
    else problems.push(`line ${i + 1}: ${JSON.stringify(line)} is not ${MIN_WORD_LENGTH}-${MAX_WORD_LENGTH} lowercase letters a-z`);
  });
  if (problems.length > 0) {
    throw new BirdleDataError(`${source} is malformed (${problems.length} bad line${problems.length === 1 ? '' : 's'}):`, problems);
  }
  if (words.size === 0) throw new BirdleDataError(`${source} contains no words`);
  return words;
}

/** Wikipedia URL for an article title ("Kākāpō" -> https://en.wikipedia.org/wiki/K%C4%81k%C4%81p%C5%8D). */
export function wikiUrl(title: string): string {
  return WIKIPEDIA_BASE_URL + encodeURIComponent(title.trim().replace(/ /g, '_'));
}

/** The bird card for a finished game (no hint, obscurity or raw wiki title). */
export function toBirdReveal(entry: BirdEntry): BirdReveal {
  return { word: entry.word, name: entry.name, kind: entry.kind, fact: entry.fact, wikiUrl: wikiUrl(entry.wiki) };
}
