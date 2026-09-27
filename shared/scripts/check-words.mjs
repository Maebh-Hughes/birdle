// Validates shared/data (npm run check:words). Runs under tsx so it can reuse
// the TypeScript rules in ../src/birdData.ts (the same ones the server uses).
// Exits 1 and lists every problem when birds.json or guesses.txt break a rule.
//
// Optional arguments check candidate files instead of shared/data, e.g.
//   npm run check:words -- ./new-birds.json [./new-guesses.txt]
// (relative paths resolve against the directory npm was run from).

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BirdleDataError, checkBirdData, parseDictionary } from '../src/birdData.ts';
import { DAILY_MAX_OBSCURITY } from '../src/constants.ts';

const [birdsArg, guessesArg] = process.argv.slice(2);
const invokedFrom = process.env.INIT_CWD ?? process.cwd();
const birdsPath = birdsArg
  ? resolve(invokedFrom, birdsArg)
  : fileURLToPath(new URL('../data/birds.json', import.meta.url));
const guessesPath = guessesArg
  ? resolve(invokedFrom, guessesArg)
  : fileURLToPath(new URL('../data/guesses.txt', import.meta.url));

const birdsName = basename(birdsPath);
const guessesName = basename(guessesPath);

/** @type {string[]} */
const problems = [];

/** @param {string} text */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** @param {string} path @returns {string | null} */
function read(path) {
  try {
    return stripBom(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** @type {unknown} */
let birds;
const birdsText = read(birdsPath);
if (birdsText !== null) {
  try {
    birds = JSON.parse(birdsText);
  } catch (error) {
    problems.push(`${birdsName} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (birds !== undefined) {
  const { errors, editorial } = checkBirdData(birds);
  problems.push(...errors.map((p) => `${birdsName} ${p}`), ...editorial.map((p) => `${birdsName} ${p}`));
}

/** @type {Set<string>} */
let dictionary = new Set();
const guessesText = read(guessesPath);
if (guessesText !== null) {
  try {
    dictionary = parseDictionary(guessesText, guessesName);
  } catch (error) {
    if (!(error instanceof BirdleDataError)) throw error;
    if (error.problems.length > 0) problems.push(...error.problems.map((p) => `${guessesName} ${p}`));
    else problems.push(error.message);
  }
}

if (problems.length > 0) {
  console.error(`check:words found ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

/**
 * "key: count" pairs, sorted by key.
 * @template T
 * @param {readonly T[]} list
 * @param {(item: T) => string | number} key
 */
function tally(list, key) {
  /** @type {Map<string | number, number>} */
  const counts = new Map();
  for (const item of list) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, n]) => `${k}: ${n}`)
    .join(', ');
}

const entries = /** @type {{ word: string; kind: string; obscurity: number }[]} */ (birds);
const daily = entries.filter((b) => b.obscurity <= DAILY_MAX_OBSCURITY);
const outsideDictionary = entries.filter((b) => !dictionary.has(b.word.toLowerCase())).length;

console.log('check:words OK');
console.log(`  ${birdsName}: ${entries.length} entries (${tally(entries, (b) => b.kind)})`);
console.log(`    by length:    ${tally(entries, (b) => b.word.length)}`);
console.log(`    by obscurity: ${tally(entries, (b) => b.obscurity)}`);
console.log(`    daily pool (obscurity <= ${DAILY_MAX_OBSCURITY}): ${daily.length} (by length ${tally(daily, (b) => b.word.length)})`);
console.log(`  ${guessesName}: ${dictionary.size.toLocaleString('en-US')} words`);
console.log(`  ${outsideDictionary} bird words are not in ${guessesName} (still valid guesses via ${birdsName})`);
