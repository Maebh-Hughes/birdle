// Fails the build if the client bundle (client/dist) leaks server-only data:
// bird hints or facts, the guess dictionary, the answer list (words, display
// names such as "Farfetch'd", or the answers' "Learn more" links), or the
// Discord client secret. Run after `vite build` (npm run build does both).
//
// Usage: node scripts/check-bundle.mjs [path/to/birds.json]
// (default: shared/data/birds.json; pass a candidate file to check it as well).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(root, 'client', 'dist');
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.map', '.txt', '.svg', '.webmanifest']);
/**
 * The UI shows no example answers, but a few short words can turn up as string
 * literals by coincidence (in libraries, say); more than this looks like the
 * answer list.
 */
const MAX_BIRD_WORDS = 10;

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

// A relative path resolves against the directory npm was run from (as in check:words).
const birdsPath = process.argv[2]
  ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2])
  : join(root, 'shared', 'data', 'birds.json');
const birds = JSON.parse(readFileSync(birdsPath, 'utf8'));
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

// 3. The answer list: birds.json keys, or many answers as string literals. An
//    answer counts when its word or its display name is quoted; names matter
//    for Pokémon and other characters, whose name isn't just the word
//    ("Farfetch'd" is FARFETCHD). A minifier may write non-ASCII letters as
//    \uXXXX escapes, so names are looked for in that form too.
const keyHit = contents.find(({ text }) => /["']?obscurity["']?\s*:\s*[123]\b/.test(text));
if (keyHit) problems.push(`${keyHit.file} appears to contain birds.json entries ("obscurity" keys)`);
const allText = contents.map(({ text }) => text).join('\n');
/** @param {string} value */
const isQuoted = (value) => new RegExp(`["'\`]${escapeRegExp(value)}["'\`]`).test(allText);
/** @param {string} value @param {boolean} upper hex digits in upper case */
const escapeNonAscii = (value, upper) =>
  value.replace(/[^\x20-\x7e]/g, (ch) => {
    const hex = ch.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${upper ? hex.toUpperCase() : hex}`;
  });
const quotedWords = birds
  .filter((bird) => {
    const name = typeof bird.name === 'string' ? bird.name : '';
    const names = name ? [name, escapeNonAscii(name, false), escapeNonAscii(name, true)] : [];
    return [String(bird.word), ...names].some(isQuoted);
  })
  .map((bird) => String(bird.word));
if (quotedWords.length > MAX_BIRD_WORDS) {
  problems.push(
    `the bundle contains ${quotedWords.length} bird words or names as string literals (max ${MAX_BIRD_WORDS}); the answer list may be bundled`,
  );
}

// 4. "Learn more" links. A link to a non-Wikipedia page (Bulbapedia, a fandom
//    wiki, ...) or a Wikipedia article URL names one answer, so any of them in
//    the bundle is a leak. Article titles are encoded as in wikiUrl().
/** @param {string} title */
const wikiPath = (title) => encodeURIComponent(title.split('#')[0].trim().replace(/ /g, '_'));
for (const bird of birds) {
  const url = typeof bird.link === 'string' ? bird.link : typeof bird.wiki === 'string' ? `wikipedia.org/wiki/${wikiPath(bird.wiki)}` : '';
  if (!url || url.endsWith('/wiki/')) continue;
  const hit = contents.find(({ text }) => text.includes(url));
  if (hit) problems.push(`${hit.file} contains the "Learn more" link of ${bird.word}: ${url}`);
}

// 5. The Discord client secret, if one is configured.
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
  `check:bundle OK: ${contents.length} files (${kb} KB) scanned against ${birds.length} answers; no hints, facts, ` +
    `links, dictionary or secret; ${quotedWords.length} bird word literal${quotedWords.length === 1 ? '' : 's'}` +
    `${quotedWords.length ? ` (${quotedWords.join(', ')})` : ''}.`,
);
