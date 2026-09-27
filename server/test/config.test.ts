import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_PORT, ROOT_DIR, loadConfig } from '../src/config';

const ROOT = resolve('/srv/birdle');
const DISCORD = { VITE_DISCORD_CLIENT_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 'secret' };
const PRIVATE_SEED = { PUZZLE_SEED: 'k3-private-seed' };

function problemsOf(env: Record<string, string>): readonly string[] {
  try {
    loadConfig(env, ROOT);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('has development defaults with mock auth on', () => {
    const { config, warnings } = loadConfig({}, ROOT);
    expect(config).toEqual({
      nodeEnv: 'development',
      isProduction: false,
      port: DEFAULT_PORT,
      discordClientId: null,
      discordClientSecret: null,
      dataFile: join(ROOT, 'server', 'data', 'birdle-db.json'),
      puzzleSeed: 'birdle',
      allowMockAuth: true,
      clientDistDir: null,
    });
    expect(warnings.join('\n')).toMatch(/only mock tokens will work/);
  });

  it('turns mock auth off and serves the client in production', () => {
    const { config, warnings } = loadConfig({ NODE_ENV: 'production', ...DISCORD, ...PRIVATE_SEED }, ROOT);
    expect(config).toMatchObject({
      isProduction: true,
      allowMockAuth: false,
      discordClientId: '123456789012345678',
      clientDistDir: join(ROOT, 'client', 'dist'),
    });
    expect(warnings).toEqual([]);
  });

  it('allows mock auth in production only when explicitly enabled, with a loud warning', () => {
    const { config, warnings } = loadConfig({ NODE_ENV: 'production', BIRDLE_ALLOW_MOCK_AUTH: 'true' }, ROOT);
    expect(config.allowMockAuth).toBe(true);
    expect(warnings.join('\n')).toMatch(/PRODUCTION/);
  });

  it('lets development switch mock auth off', () => {
    expect(loadConfig({ BIRDLE_ALLOW_MOCK_AUTH: 'false', ...DISCORD }, ROOT).config.allowMockAuth).toBe(false);
  });

  it('treats blank values as unset and resolves DATA_FILE against the repo root', () => {
    const { config } = loadConfig({ PORT: ' ', PUZZLE_SEED: '', DATA_FILE: 'data/db.json', DISCORD_CLIENT_SECRET: '' }, ROOT);
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.puzzleSeed).toBe('birdle');
    expect(config.dataFile).toBe(join(ROOT, 'data', 'db.json'));
    expect(config.discordClientSecret).toBeNull();
    const absolute = resolve('/var/lib/birdle.json');
    expect(loadConfig({ DATA_FILE: absolute }, ROOT).config.dataFile).toBe(absolute);
  });

  it('reports every invalid value at once', () => {
    const problems = problemsOf({
      PORT: '99999',
      BIRDLE_ALLOW_MOCK_AUTH: 'maybe',
      VITE_DISCORD_CLIENT_ID: 'my-app',
      PUZZLE_SEED: 'x'.repeat(201),
    });
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toMatch(/PORT/);
    expect(problems.join('\n')).toMatch(/BIRDLE_ALLOW_MOCK_AUTH/);
    expect(problems.join('\n')).toMatch(/VITE_DISCORD_CLIENT_ID/);
    expect(problems.join('\n')).toMatch(/PUZZLE_SEED/);
    expect(problemsOf({ PORT: '3001.5' })).toHaveLength(1);
  });

  it('warns in production when PUZZLE_SEED is the public default', () => {
    const unset = loadConfig({ NODE_ENV: 'production', ...DISCORD }, ROOT).warnings;
    expect(unset).toHaveLength(1);
    expect(unset[0]).toMatch(/PUZZLE_SEED is the public default/);
    expect(loadConfig({ NODE_ENV: 'production', ...DISCORD, PUZZLE_SEED: 'birdle' }, ROOT).warnings).toHaveLength(1);
    expect(loadConfig({ NODE_ENV: 'production', ...DISCORD, ...PRIVATE_SEED }, ROOT).warnings).toEqual([]);
    expect(loadConfig({ ...DISCORD }, ROOT).warnings).toEqual([]);
    // A blank seed (the placeholder deleted, nothing pasted) starts too, with the same warning (docs/TRUENAS.md).
    const blank = loadConfig({ NODE_ENV: 'production', ...DISCORD, PUZZLE_SEED: ' ' }, ROOT);
    expect(blank.config.puzzleSeed).toBe('birdle');
    expect(blank.warnings).toEqual([expect.stringMatching(/PUZZLE_SEED is the public default/)]);
  });

  it('refuses to start with a CHANGE_ME placeholder from the deploy templates left in', () => {
    const problems = problemsOf({
      NODE_ENV: 'production',
      DISCORD_CLIENT_ID: 'CHANGE_ME',
      DISCORD_CLIENT_SECRET: 'CHANGE_ME',
      PUZZLE_SEED: 'change_me',
    });
    for (const key of ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'PUZZLE_SEED']) {
      expect(problems).toContainEqual(expect.stringMatching(new RegExp(`^${key} still contains the placeholder`)));
    }
    expect(problemsOf({ ...DISCORD, ...PRIVATE_SEED })).toEqual([]);
  });

  it('refuses to start with either TrueNAS template as shipped, as docs/TRUENAS.md says', () => {
    for (const file of ['birdle.yaml', 'birdle-cloudflared.yaml']) {
      const yaml = readFileSync(join(ROOT_DIR, 'deploy', 'truenas', file), 'utf8');
      const settings = [...yaml.matchAll(/^ +([A-Z_]+): "([^"]*)"\r?$/gm)];
      const env = Object.fromEntries(settings.map(([, key, value]) => [key, value]));
      expect(env).toMatchObject({ DISCORD_CLIENT_ID: 'CHANGE_ME', DISCORD_CLIENT_SECRET: 'CHANGE_ME', PUZZLE_SEED: 'CHANGE_ME' });
      const problems = problemsOf({ NODE_ENV: 'production', ...env });
      for (const key of ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'PUZZLE_SEED']) {
        expect(problems).toContain(`${key} still contains the placeholder "CHANGE_ME"; replace it with your real value`);
      }
    }
  });

  it('reads the client id from DISCORD_CLIENT_ID, with VITE_DISCORD_CLIENT_ID as an alias', () => {
    const id = '123456789012345678';
    expect(loadConfig({ DISCORD_CLIENT_ID: id }, ROOT).config.discordClientId).toBe(id);
    expect(loadConfig({ VITE_DISCORD_CLIENT_ID: id }, ROOT).config.discordClientId).toBe(id);
    expect(loadConfig({ DISCORD_CLIENT_ID: id, VITE_DISCORD_CLIENT_ID: ` ${id} ` }, ROOT).config.discordClientId).toBe(id);
    expect(loadConfig({ DISCORD_CLIENT_ID: ' ', VITE_DISCORD_CLIENT_ID: id }, ROOT).config.discordClientId).toBe(id);
    const production = { NODE_ENV: 'production', DISCORD_CLIENT_ID: id, DISCORD_CLIENT_SECRET: 's', ...PRIVATE_SEED };
    expect(loadConfig(production, ROOT)).toMatchObject({ config: { discordClientId: id, allowMockAuth: false }, warnings: [] });
  });

  it('names the variable that holds an invalid client id', () => {
    expect(problemsOf({ DISCORD_CLIENT_ID: 'my-app' })).toEqual([
      'DISCORD_CLIENT_ID must be the numeric application id from the Discord Developer Portal',
    ]);
    expect(problemsOf({ VITE_DISCORD_CLIENT_ID: 'my-app' })).toEqual([
      'VITE_DISCORD_CLIENT_ID must be the numeric application id from the Discord Developer Portal',
    ]);
  });

  it('refuses two different client ids', () => {
    const problems = problemsOf({ DISCORD_CLIENT_ID: '123456789012345678', VITE_DISCORD_CLIENT_ID: '876543210987654321' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/DISCORD_CLIENT_ID and VITE_DISCORD_CLIENT_ID are both set but differ/);
  });

  it('requires Discord credentials in production when mock auth is off', () => {
    const problems = problemsOf({ NODE_ENV: 'production', VITE_DISCORD_CLIENT_ID: '123456789012345678' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/required in production/);
    expect(problemsOf({ NODE_ENV: 'production', DISCORD_CLIENT_SECRET: 's' })[0]).toMatch(
      /DISCORD_CLIENT_ID \(or VITE_DISCORD_CLIENT_ID\) and DISCORD_CLIENT_SECRET are not both set/,
    );
  });
});
