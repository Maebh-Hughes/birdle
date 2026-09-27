// Fails the build if the client bundle (client/dist) leaks server-only data:
// bird hints or facts, the guess dictionary, the answer list, or the Discord
// client secret. Run after `vite build` (npm run build does both).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(root, 'client', 'dist');
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.map', '.txt', '.svg', '.webmanifest']);
/** The UI may show a few example bird words (How to play); more than this looks like the answer list. */
const MAX_BIRD_WORDS = 20;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/**
 * Longest run of plain ASCII (letters, digits, spaces, simple punctuation) in `text`,
 * so a match survives minifiers re-escaping quotes or non-ASCII characters.
 * @param {string} text
 */
function probe(text) {
  const runs = text.match(/[A-Za-z0-9 ,.;:()-]+/g) ?? [];
  return runs.map((run) => run.trim()).reduce((best, run) => (run.length > best.length ? run : best), '');
}

/** @param {string} word */
const escapeRegExp = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readSecret() {
  if (process.env.DISCORD_CLIENT_SECRET) return process.env.DISCORD_CLIENT_SECRET;
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*DISCORD_CLIENT_SECRET\s*=/.test(l));
  const value = line?.slice(line.indexOf('=') + 1).replace(/\s+#.*$/, '').trim() ?? '';
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

if (!existsSync(distDir)) {
  console.error(`check:bundle: ${relative(root, distDir)} does not exist; build the client first (npm run build).`);
  process.exit(1);
}

const files = walk(distDir).filter((file) => TEXT_EXTENSIONS.has(extname(file).toLowerCase()));
const contents = files.map((file) => ({ file: relative(root, file), text: readFileSync(file, 'utf8') }));

const birds = JSON.parse(readFileSync(join(root, 'shared', 'data', 'birds.json'), 'utf8'));
const dictionary = readFileSync(join(root, 'shared', 'data', 'guesses.txt'), 'utf8').split(/\r?\n/).filter(Boolean);

/** @type {string[]} */
const problems = [];

// 1. Hints and facts (every one of them).
for (const bird of birds) {
  for (const field of ['hint', 'fact']) {
    const needle = probe(String(bird[field] ?? ''));
    if (needle.length < 12) continue;
    const hit = contents.find(({ text }) => text.includes(needle));
    if (hit) problems.push(`${hit.file} contains the ${field} of ${bird.word}: "${needle}"`);
  }
}

// 2. The dictionary: adjacent pairs of words from its start, middle and end.
const samples = [0, Math.floor(dictionary.length / 2), dictionary.length - 4];
for (const start of samples) {
  const [a, b] = [dictionary[start], dictionary[start + 1]];
  if (!a || !b) continue;
  const pattern = new RegExp(`\\b${escapeRegExp(a)}\\W{1,6}${escapeRegExp(b)}\\b`);
  const hit = contents.find(({ text }) => pattern.test(text));
  if (hit) problems.push(`${hit.file} appears to contain the guess dictionary ("${a}" next to "${b}")`);
}

// 3. The answer list: birds.json keys or many bird words as string literals.
const keyHit = contents.find(({ text }) => /["']?obscurity["']?\s*:\s*[123]\b/.test(text));
if (keyHit) problems.push(`${keyHit.file} appears to contain birds.json entries ("obscurity" keys)`);
const allText = contents.map(({ text }) => text).join('\n');
const quotedWords = birds
  .map((bird) => String(bird.word))
  .filter((word) => new RegExp(`["'\`]${escapeRegExp(word)}["'\`]`).test(allText));
if (quotedWords.length > MAX_BIRD_WORDS) {
  problems.push(`the bundle contains ${quotedWords.length} bird words as string literals (max ${MAX_BIRD_WORDS}); the answer list may be bundled`);
}

// 4. The Discord client secret, if one is configured.
const secret = readSecret();
if (secret.length >= 8) {
  const hit = contents.find(({ text }) => text.includes(secret));
  if (hit) problems.push(`${hit.file} contains DISCORD_CLIENT_SECRET`);
}

if (problems.length > 0) {
  console.error(`check:bundle FAILED: the client bundle leaks server-only data (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const kb = Math.round(contents.reduce((sum, { text }) => sum + text.length, 0) / 1024);
console.log(
  `check:bundle OK: ${contents.length} files (${kb} KB) scanned; no hints, facts, dictionary or secret; ` +
    `${quotedWords.length} bird word literal${quotedWords.length === 1 ? '' : 's'}${quotedWords.length ? ` (${quotedWords.join(', ')})` : ''}.`,
);
