import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { ErrorScreen } from '../src/components/Screens';
import { createDiscordEnv, MissingClientIdError, resolveClientId } from '../src/discord/sdk';
import { startupFailure } from '../src/startup';

// What happened, in order: server calls and DiscordSDK constructions.
const events = vi.hoisted(() => [] as string[]);

// The real DiscordSDK needs a Discord parent window; this one only records that it was built.
vi.mock('@discord/embedded-app-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@discord/embedded-app-sdk')>();
  class FakeDiscordSDK {
    readonly instanceId = 'i-1';
    readonly platform = actual.Platform.DESKTOP;
    constructor(readonly clientId: string) {
      events.push(`new DiscordSDK(${clientId})`);
    }
  }
  return { ...actual, DiscordSDK: FakeDiscordSDK };
});

const DISCORD_LAUNCH = '?frame_id=f&instance_id=i-1&platform=desktop';
const SERVER_ID = '123456789012345678';
const BUILD_ID = '876543210987654321';

function serveConfig(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      events.push(`GET ${url}`);
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

beforeEach(() => {
  events.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Discord client id at startup', () => {
  it('asks the server (GET /api/config) before creating the DiscordSDK when the build has no id', async () => {
    serveConfig({ discordClientId: SERVER_ID });
    const env = await createDiscordEnv({ search: DISCORD_LAUNCH, buildClientId: '' });
    expect(events).toEqual(['GET /api/config', `new DiscordSDK(${SERVER_ID})`]);
    expect(env).toMatchObject({ embedded: true, clientId: SERVER_ID, instanceId: 'i-1', platform: 'desktop' });
  });

  it('uses a build-time VITE_DISCORD_CLIENT_ID without asking the server', async () => {
    serveConfig({ discordClientId: SERVER_ID });
    const env = await createDiscordEnv({ search: DISCORD_LAUNCH, buildClientId: ` ${BUILD_ID} ` });
    expect(events).toEqual([`new DiscordSDK(${BUILD_ID})`]);
    expect(env.clientId).toBe(BUILD_ID);
  });

  it('fails with MissingClientIdError, before any SDK exists, when the server has no id either', async () => {
    serveConfig({ discordClientId: null });
    await expect(createDiscordEnv({ search: DISCORD_LAUNCH, buildClientId: '' })).rejects.toBeInstanceOf(MissingClientIdError);
    expect(events).toEqual(['GET /api/config']);
  });

  it('reports a server without /api/config (or a broken answer) as a startup failure, not a missing id', async () => {
    serveConfig({ error: { code: 'NOT_FOUND', message: 'No such API route' } }, 404);
    await expect(createDiscordEnv({ search: DISCORD_LAUNCH, buildClientId: '' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    serveConfig({ discordClientId: 42 });
    await expect(createDiscordEnv({ search: DISCORD_LAUNCH, buildClientId: '' })).rejects.toBeInstanceOf(ApiError);
    expect(events.filter((event) => event.startsWith('new DiscordSDK'))).toEqual([]);
  });

  it('needs no client id and no server call in a plain browser (mock mode)', async () => {
    serveConfig({ discordClientId: null });
    const env = await createDiscordEnv({ search: '?user=alice', buildClientId: '', storage: null });
    expect(env.embedded).toBe(false);
    expect(env.clientId).toBe('birdle-local');
    expect(events).toEqual([]);
  });

  it('resolveClientId prefers the build-time id and reads the config otherwise', async () => {
    const loadConfig = vi.fn(async () => ({ discordClientId: SERVER_ID }));
    await expect(resolveClientId(BUILD_ID, loadConfig)).resolves.toBe(BUILD_ID);
    expect(loadConfig).not.toHaveBeenCalled();
    await expect(resolveClientId('  ', loadConfig)).resolves.toBe(SERVER_ID);
    await expect(resolveClientId('', async () => ({ discordClientId: null }))).rejects.toBeInstanceOf(MissingClientIdError);
  });
});

describe('startup error screen', () => {
  it('explains a missing Discord client id to the server owner', () => {
    const failure = startupFailure(new MissingClientIdError());
    render(<ErrorScreen {...failure} onRetry={() => undefined} retryLabel="Reload" />);
    expect(screen.getByRole('heading', { name: 'BIRDLE isn’t set up for Discord yet' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('no Discord application ID');
    expect(screen.getByText(/set DISCORD_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('tells a connection problem apart from other failures', () => {
    expect(startupFailure(new ApiError('NETWORK', 'Failed to fetch'))).toMatchObject({ title: 'No connection' });
    expect(startupFailure(new Error('boom'))).toEqual({
      title: 'BIRDLE couldn’t start',
      message: 'Something went wrong while connecting to Discord.',
      detail: 'boom',
    });
  });
});
