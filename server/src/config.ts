import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PUZZLE_SEED } from '@birdle/shared';

/** Repository root (the root .env and relative DATA_FILE paths resolve against it). */
export const ROOT_DIR: string = fileURLToPath(new URL('../../', import.meta.url));

export const DEFAULT_PORT = 3001;
export const DEFAULT_DATA_FILE = './server/data/birdle-db.json';
const MAX_SEED_LENGTH = 200;

export interface Config {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  /** Discord application id (DISCORD_CLIENT_ID, or its alias VITE_DISCORD_CLIENT_ID); null when unset. Public. */
  discordClientId: string | null;
  /** OAuth2 client secret; null when unset. Never log it. */
  discordClientSecret: string | null;
  /** Absolute path of the JSON database file. */
  dataFile: string;
  puzzleSeed: string;
  /** Accept `mock:<id>:<name>` bearer tokens (local play without Discord). */
  allowMockAuth: boolean;
  /** Built client served with SPA fallback (production only); null = API only. */
  clientDistDir: string | null;
}

export interface LoadedConfig {
  config: Config;
  /** Non-fatal problems to print at startup. */
  warnings: string[];
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** Placeholder used by the deploy templates for values the installer must fill in. */
const PLACEHOLDER = 'CHANGE_ME';
const PLACEHOLDER_CHECKED_VARIABLES = [
  'DISCORD_CLIENT_ID',
  'VITE_DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'PUZZLE_SEED',
] as const;

/** Trimmed value, or undefined when unset or blank (e.g. `KEY=` copied from .env.example). */
function read(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

/**
 * Parses and validates the server's environment. Throws ConfigError listing
 * every problem; returns warnings for settings that work but deserve attention.
 */
export function loadConfig(env: Env, rootDir: string = ROOT_DIR): LoadedConfig {
  const problems: string[] = [];
  const warnings: string[] = [];

  const nodeEnv = read(env, 'NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';

  // The deploy templates (deploy/truenas/*.yaml) ship CHANGE_ME placeholders; refuse to start with one left in,
  // because a placeholder PUZZLE_SEED would silently make every daily answer guessable.
  for (const key of PLACEHOLDER_CHECKED_VARIABLES) {
    if (read(env, key)?.toUpperCase().includes(PLACEHOLDER)) {
      problems.push(`${key} still contains the placeholder "${PLACEHOLDER}"; replace it with your real value`);
    }
  }

  let port = DEFAULT_PORT;
  const rawPort = read(env, 'PORT');
  if (rawPort !== undefined) {
    const parsed = Number(rawPort);
    if (/^\d+$/.test(rawPort) && parsed >= 1 && parsed <= 65_535) port = parsed;
    else problems.push(`PORT must be an integer from 1 to 65535 (got "${rawPort}")`);
  }

  // DISCORD_CLIENT_ID is read at runtime (and served to the client by GET /api/config),
  // so one build works for any Discord application. VITE_DISCORD_CLIENT_ID, which
  // older setups use and Vite can compile into the client, is accepted as an alias.
  const primaryClientId = read(env, 'DISCORD_CLIENT_ID');
  const aliasClientId = read(env, 'VITE_DISCORD_CLIENT_ID');
  const clientIdVariable = primaryClientId !== undefined ? 'DISCORD_CLIENT_ID' : 'VITE_DISCORD_CLIENT_ID';
  const discordClientId = primaryClientId ?? aliasClientId ?? null;
  if (primaryClientId !== undefined && aliasClientId !== undefined && primaryClientId !== aliasClientId) {
    problems.push(
      'DISCORD_CLIENT_ID and VITE_DISCORD_CLIENT_ID are both set but differ; set only DISCORD_CLIENT_ID ' +
        '(a client built with a different VITE_DISCORD_CLIENT_ID would sign in to the wrong application)',
    );
  } else if (discordClientId !== null && !/^\d{15,25}$/.test(discordClientId)) {
    problems.push(`${clientIdVariable} must be the numeric application id from the Discord Developer Portal`);
  }
  const discordClientSecret = read(env, 'DISCORD_CLIENT_SECRET') ?? null;

  let allowMockAuth = !isProduction;
  const rawMock = read(env, 'BIRDLE_ALLOW_MOCK_AUTH');
  if (rawMock !== undefined) {
    const parsed = parseBoolean(rawMock);
    if (parsed === undefined) problems.push(`BIRDLE_ALLOW_MOCK_AUTH must be true or false (got "${rawMock}")`);
    else allowMockAuth = parsed;
  }

  const discordConfigured = discordClientId !== null && discordClientSecret !== null;
  if (!discordConfigured) {
    const message =
      'DISCORD_CLIENT_ID (or VITE_DISCORD_CLIENT_ID) and DISCORD_CLIENT_SECRET are not both set, so Discord sign-in (POST /api/token) is disabled';
    if (isProduction && !allowMockAuth) problems.push(`${message}; they are required in production`);
    else warnings.push(`${message}; only mock tokens will work.`);
  }
  if (isProduction && allowMockAuth) {
    warnings.push(
      'BIRDLE_ALLOW_MOCK_AUTH is enabled in PRODUCTION: anyone can act as any user with a "mock:" token. Turn it off for real deployments!',
    );
  }

  const puzzleSeed = read(env, 'PUZZLE_SEED') ?? DEFAULT_PUZZLE_SEED;
  if (puzzleSeed.length > MAX_SEED_LENGTH) problems.push(`PUZZLE_SEED must be at most ${MAX_SEED_LENGTH} characters`);
  if (isProduction && puzzleSeed === DEFAULT_PUZZLE_SEED) {
    warnings.push(
      `PUZZLE_SEED is the public default "${DEFAULT_PUZZLE_SEED}": anyone with the word list can work out every daily answer. ` +
        'Set a private random value (before the first puzzle is played, since changing it reshuffles the answers).',
    );
  }

  const rawDataFile = read(env, 'DATA_FILE') ?? DEFAULT_DATA_FILE;
  const dataFile = isAbsolute(rawDataFile) ? rawDataFile : resolve(rootDir, rawDataFile);

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    config: {
      nodeEnv,
      isProduction,
      port,
      discordClientId,
      discordClientSecret,
      dataFile,
      puzzleSeed,
      allowMockAuth,
      clientDistDir: isProduction ? resolve(rootDir, 'client', 'dist') : null,
    },
    warnings,
  };
}
