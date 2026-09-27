import {
  FACT_MAX_LENGTH,
  HINT_MAX_LENGTH,
  MAX_WORD_LENGTH,
  MIN_WORD_LENGTH,
  SOURCE_MAX_LENGTH,
  WIKIPEDIA_BASE_URL,
} from './constants';
import { BIRD_KINDS, FICTIONAL_KINDS, isBirdKind, isDailyEligible, isFictionalKind } from './kinds';
import type { BirdEntry, BirdKind, BirdReveal } from './types';

// Validation and parsing of the word data. Pure: no fs, no data. The loader
// lives in ./server and the CLI in scripts/check-words.mjs.

export const BIRD_WORD_PATTERN = new RegExp(`^[A-Z]{${MIN_WORD_LENGTH},${MAX_WORD_LENGTH}}$`);
export const DICTIONARY_WORD_PATTERN = new RegExp(`^[a-z]{${MIN_WORD_LENGTH},${MAX_WORD_LENGTH}}$`);
export { BIRD_KINDS };

const BIRD_FIELDS: readonly string[] = ['word', 'name', 'kind', 'source', 'hint', 'fact', 'wiki', 'link', 'obscurity'];
const TEXT_FIELDS = ['name', 'hint', 'fact'] as const;
/** Names shorter than this (after removing punctuation) are not searched for in the hint. */
const MIN_NAME_CHECK_LENGTH = 4;
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
  /** Editorial problems (lengths, hint giving away the answer, stray fields/whitespace): fail `check:words` only. */
  editorial: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lowercase with diacritics removed, so "Kākāpō" matches "kakapo". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Folded forms of a text to search in: punctuation removed ("Farfetch'd" ->
 * "farfetchd", "Ho-Oh" -> "hooh") and punctuation read as a space
 * ("Sir-Hootington" -> "sir hootington"), spaces collapsed.
 */
function searchable(text: string): string[] {
  const folded = fold(text);
  const tidy = (value: string) => value.replace(/\s+/g, ' ').trim();
  return [tidy(folded.replace(/[^\p{L}\p{N}\s]/gu, '')), tidy(folded.replace(/[^\p{L}\p{N}\s]/gu, ' '))];
}

function charCount(text: string): number {
  return [...text].length;
}

/** A full https URL with a host and no credentials, or null. */
function parseHttpsUrl(value: string): URL | null {
  if (value !== value.trim() || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return null;
  return url;
}

function isWikipediaHost(hostname: string): boolean {
  return hostname === 'wikipedia.org' || hostname.endsWith('.wikipedia.org');
}

const has = (entry: Record<string, unknown>, key: string): boolean => Object.hasOwn(entry, key);

/**
 * Checks parsed birds.json content against the data rules.
 *
 * Structural (errors): an array of objects; word ^[A-Z]{4,11}$ and unique; kind
 * one of BIRD_KINDS; obscurity 1-3; non-empty name, hint and fact; exactly one
 * of `wiki` (a non-empty Wikipedia title) or `link` (a full https URL); a
 * non-empty `source` for pokemon/game/literature and none for bird/term; and at
 * least one daily-eligible entry.
 *
 * Editorial: hint <= 110, fact <= 220 and source <= 60 characters; the hint
 * must not contain the word or the name (ignoring case, accents and
 * punctuation); no unexpected fields, stray whitespace or Wikipedia `link`s.
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
    const { word, name, kind, obscurity, hint, fact } = entry;
    const label = `[${index}]${typeof word === 'string' ? ` ${word}` : ''}`;
    const trimmedStringField = (field: string, value: unknown): void => {
      if (typeof value === 'string' && value !== value.trim()) {
        editorial.push(`${label}: "${field}" has leading or trailing whitespace`);
      }
    };

    if (typeof word !== 'string' || !BIRD_WORD_PATTERN.test(word)) {
      errors.push(`${label}: "word" must be ${MIN_WORD_LENGTH}-${MAX_WORD_LENGTH} uppercase letters A-Z, got ${JSON.stringify(word)}`);
    } else {
      const seen = firstIndex.get(word);
      if (seen === undefined) firstIndex.set(word, index);
      else errors.push(`${label}: duplicate word (first at [${seen}])`);
    }

    for (const field of TEXT_FIELDS) {
      const value = entry[field];
      if (typeof value !== 'string' || value.trim() === '') errors.push(`${label}: "${field}" must be a non-empty string`);
      else trimmedStringField(field, value);
    }

    const validKind = isBirdKind(kind);
    if (!validKind) {
      errors.push(`${label}: "kind" must be one of ${BIRD_KINDS.map((k) => `"${k}"`).join(', ')}, got ${JSON.stringify(kind)}`);
    }

    // source: required for fictional birds, absent for real ones.
    if (validKind && isFictionalKind(kind)) {
      const source = entry.source;
      if (typeof source !== 'string' || source.trim() === '') {
        errors.push(`${label}: "source" must be a non-empty string for kind "${kind}" (e.g. the game or book)`);
      } else {
        trimmedStringField('source', source);
        const length = charCount(source);
        if (length > SOURCE_MAX_LENGTH) editorial.push(`${label}: source is ${length} characters (max ${SOURCE_MAX_LENGTH})`);
      }
    } else if (validKind && has(entry, 'source')) {
      errors.push(`${label}: "source" is only for kinds ${FICTIONAL_KINDS.map((k) => `"${k}"`).join(', ')}; remove it from a "${kind}" entry`);
    }

    // Exactly one of wiki / link.
    const hasWiki = has(entry, 'wiki');
    const hasLink = has(entry, 'link');
    if (hasWiki && hasLink) {
      errors.push(`${label}: has both "wiki" and "link"; use exactly one`);
    } else if (!hasWiki && !hasLink) {
      errors.push(`${label}: needs exactly one of "wiki" (a Wikipedia title) or "link" (a full https URL)`);
    } else if (hasWiki) {
      const wiki = entry.wiki;
      if (typeof wiki !== 'string' || wiki.trim() === '' || wiki.trim().startsWith('#')) {
        errors.push(`${label}: "wiki" must be a non-empty Wikipedia article title`);
      } else {
        trimmedStringField('wiki', wiki);
      }
    } else {
      const link = entry.link;
      const url = typeof link === 'string' ? parseHttpsUrl(link) : null;
      if (!url) errors.push(`${label}: "link" must be a full https:// URL, got ${JSON.stringify(link)}`);
      else if (isWikipediaHost(url.hostname)) editorial.push(`${label}: "link" points to Wikipedia; use "wiki" with the article title instead`);
    }

    if (obscurity !== 1 && obscurity !== 2 && obscurity !== 3) {
      errors.push(`${label}: "obscurity" must be 1, 2 or 3, got ${JSON.stringify(obscurity)}`);
    } else if (validKind && isDailyEligible({ kind, obscurity })) {
      dailyEligible++;
    }

    for (const key of Object.keys(entry)) {
      if (!BIRD_FIELDS.includes(key)) editorial.push(`${label}: unexpected field "${key}"`);
    }

    if (typeof hint === 'string') {
      const length = charCount(hint);
      if (length > HINT_MAX_LENGTH) editorial.push(`${label}: hint is ${length} characters (max ${HINT_MAX_LENGTH})`);
      const texts = searchable(hint);
      const answer = typeof word === 'string' ? word.toLowerCase() : '';
      const names = typeof name === 'string' ? searchable(name).filter((form) => form.length >= MIN_NAME_CHECK_LENGTH) : [];
      if (answer !== '' && texts.some((text) => text.includes(answer))) {
        editorial.push(`${label}: hint contains the word`);
      } else if (names.some((form) => texts.some((text) => text.includes(form)))) {
        editorial.push(`${label}: hint contains the name`);
      }
    }
    if (typeof fact === 'string') {
      const length = charCount(fact);
      if (length > FACT_MAX_LENGTH) editorial.push(`${label}: fact is ${length} characters (max ${FACT_MAX_LENGTH})`);
    }
  });

  if (data.length > 0 && dailyEligible === 0) {
    errors.push('no entry is daily-eligible (bird/term with obscurity <= 2, or pokemon/game/literature with obscurity 1), so there would be no daily answers');
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
  return (data as Record<string, unknown>[]).map((entry) => {
    const parsed: BirdEntry = {
      word: entry.word as string,
      name: entry.name as string,
      kind: entry.kind as BirdKind,
      hint: entry.hint as string,
      fact: entry.fact as string,
      obscurity: entry.obscurity as BirdEntry['obscurity'],
    };
    if (typeof entry.source === 'string') parsed.source = entry.source;
    if (typeof entry.wiki === 'string') parsed.wiki = entry.wiki;
    if (typeof entry.link === 'string') parsed.link = entry.link;
    return parsed;
  });
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

const encodeWikiPart = (part: string): string => encodeURIComponent(part.trim().replace(/ /g, '_'));

/**
 * Wikipedia URL for an article title, optionally with a #Section
 * ("Kākāpō" -> https://en.wikipedia.org/wiki/K%C4%81k%C4%81p%C5%8D,
 *  "Owl#Symbolism" -> https://en.wikipedia.org/wiki/Owl#Symbolism).
 */
export function wikiUrl(title: string): string {
  const hash = title.indexOf('#');
  if (hash === -1) return WIKIPEDIA_BASE_URL + encodeWikiPart(title);
  const section = title.slice(hash + 1);
  return WIKIPEDIA_BASE_URL + encodeWikiPart(title.slice(0, hash)) + (section.trim() ? `#${encodeWikiPart(section)}` : '');
}

/** Friendly names of known "Learn more" hosts (after removing a leading "www."). */
const KNOWN_SITES: Readonly<Record<string, string>> = {
  'bulbapedia.bulbagarden.net': 'Bulbapedia',
  'zeldawiki.wiki': 'Zelda Wiki',
  'fandom.com': 'Fandom',
  'wikipedia.org': 'Wikipedia',
};

/**
 * The site name shown on the "Learn more" button for a link: a known wiki's
 * name (Bulbapedia, Fandom for any *.fandom.com, Zelda Wiki, Wikipedia),
 * otherwise the hostname without "www.".
 */
export function infoSiteFor(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'the web';
  }
  host = host.replace(/^www\./, '');
  const known = KNOWN_SITES[host];
  if (known) return known;
  if (host.endsWith('.fandom.com')) return 'Fandom';
  if (isWikipediaHost(host)) return 'Wikipedia';
  return host;
}

/** Wikipedia's search for a name: the "Learn more" page of an answer that is no longer in the list. */
export function wikipediaSearchUrl(query: string): string {
  return `${WIKIPEDIA_BASE_URL}Special:Search?search=${encodeURIComponent(query)}`;
}

/** The bird card for a finished game (no hint, obscurity or raw wiki title). */
export function toBirdReveal(entry: BirdEntry): BirdReveal {
  const infoUrl = entry.link ?? wikiUrl(entry.wiki ?? entry.name);
  return {
    word: entry.word,
    name: entry.name,
    kind: entry.kind,
    source: entry.source ?? null,
    fact: entry.fact,
    infoUrl,
    infoSite: entry.link === undefined ? 'Wikipedia' : infoSiteFor(entry.link),
  };
}

/**
 * A minimal bird card for an answer that has left the word list (a stored game
 * or a pinned daily answer outlived its birds.json entry): the word as its
 * name, no fact, and a Wikipedia search as the "Learn more" page.
 */
export function minimalBirdReveal(word: string): BirdReveal {
  const name = word.charAt(0) + word.slice(1).toLowerCase();
  return { word, name, kind: 'bird', source: null, fact: '', infoUrl: wikipediaSearchUrl(name), infoSite: 'Wikipedia' };
}
