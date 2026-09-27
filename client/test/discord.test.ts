import type { DiscordSDKMock, IDiscordSDK } from '@discord/embedded-app-sdk';
import type { GameView } from '@birdle/shared';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from '../src/discord/auth';
import { describeError } from '../src/discord/errors';
import { MOCK_USER_KEY, mockToken, resolveMockIdentity, slugify } from '../src/discord/mockIdentity';
import { watchParticipants } from '../src/discord/participants';
import { presenceText, usePresence } from '../src/discord/presence';
import { isDiscordLaunch, type DiscordEnv } from '../src/discord/sdk';
import { makeGame, row } from './fixtures';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('launch detection', () => {
  it('needs frame_id, instance_id and platform', () => {
    expect(isDiscordLaunch('?frame_id=1&instance_id=2&platform=desktop')).toBe(true);
    expect(isDiscordLaunch('?frame_id=1&instance_id=2')).toBe(false);
    expect(isDiscordLaunch('?user=alice')).toBe(false);
    expect(isDiscordLaunch('')).toBe(false);
  });
});

describe('mock identity', () => {
  it('names the player from ?user=', () => {
    const identity = resolveMockIdentity('?user=Álvaro%20Díaz', null);
    expect(identity).toEqual({ id: 'alvaro-diaz', displayName: 'Álvaro Díaz', token: 'mock:alvaro-diaz:%C3%81lvaro%20D%C3%ADaz' });
  });

  it('still produces a safe id for names without ASCII letters', () => {
    const identity = resolveMockIdentity('?user=%F0%9F%90%A6', null);
    expect(identity.id).toMatch(/^user-[a-z0-9]+$/);
    expect(identity.displayName).toBe('🐦');
  });

  it('remembers a random guest id in localStorage', () => {
    const first = resolveMockIdentity('', window.localStorage, () => 0.5);
    expect(first.id).toMatch(/^guest-[a-z0-9]{6}$/);
    expect(window.localStorage.getItem(MOCK_USER_KEY)).toBe(first.id);
    expect(resolveMockIdentity('', window.localStorage, () => 0.1)).toEqual(first);
  });

  it('works without storage', () => {
    const identity = resolveMockIdentity('', null, () => 0.25);
    expect(identity.token).toBe(mockToken(identity.id, identity.displayName));
  });

  it('slugify keeps a-z, 0-9 and single dashes', () => {
    expect(slugify('  Mr. Bird  Watcher! ')).toBe('mr-bird-watcher');
    expect(slugify('***')).toBe('');
  });
});

function embeddedEnv(commands: Partial<IDiscordSDK['commands']>): DiscordEnv {
  const sdk = { ready: vi.fn(async () => undefined), commands } as unknown as IDiscordSDK;
  return { embedded: true, sdk, clientId: '123', instanceId: 'i-1', platform: 'desktop' };
}

const authResult = (scopes: string[]) => ({
  access_token: 'discord-token',
  user: { id: '42', username: 'wren', discriminator: '0', public_flags: 0 },
  scopes,
  expires: '',
  application: { id: '123', name: 'BIRDLE', description: '' },
});

describe('authenticate', () => {
  it('authorizes, exchanges the code on the server, then authenticates', async () => {
    const authorize = vi.fn(async () => ({ code: 'oauth-code' }));
    const authenticateCommand = vi.fn(async () => authResult(['identify', 'rpc.activities.write']));
    const exchange = vi.fn(async () => 'discord-token');
    const auth = await authenticate(embeddedEnv({ authorize, authenticate: authenticateCommand } as never), exchange);

    expect(authorize).toHaveBeenCalledWith({
      client_id: '123',
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify', 'rpc.activities.write'],
    });
    expect(exchange).toHaveBeenCalledWith('oauth-code');
    expect(authenticateCommand).toHaveBeenCalledWith({ access_token: 'discord-token' });
    expect(auth).toEqual({ token: 'discord-token', presenceEnabled: true });
  });

  it('retries with identify only when the presence scope is refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const authorize = vi
      .fn()
      .mockRejectedValueOnce({ code: 5000, message: 'scope not allowed' })
      .mockResolvedValueOnce({ code: 'oauth-code' });
    const authenticateCommand = vi.fn(async () => authResult(['identify']));
    const auth = await authenticate(embeddedEnv({ authorize, authenticate: authenticateCommand } as never), async () => 't');
    expect(authorize).toHaveBeenLastCalledWith(expect.objectContaining({ scope: ['identify'] }));
    expect(auth.presenceEnabled).toBe(false);
  });

  it('never sends a mock code to the server', async () => {
    const exchange = vi.fn();
    const sdk = { ready: vi.fn(async () => undefined), commands: { authenticate: vi.fn(async () => authResult([])) } };
    const identity = resolveMockIdentity('?user=alice', null);
    const env: DiscordEnv = {
      embedded: false,
      sdk: sdk as unknown as IDiscordSDK,
      mock: sdk as unknown as DiscordSDKMock,
      identity,
      clientId: 'x',
      instanceId: '123456789012345678',
      platform: 'desktop',
    };
    expect(await authenticate(env, exchange)).toEqual({ token: 'mock:alice:alice', presenceEnabled: true });
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe('describeError', () => {
  it('handles SDK error payloads, Errors and anything else', () => {
    expect(describeError({ code: 4002, message: 'Invalid command' })).toBe('Invalid command (code 4002)');
    expect(describeError({ code: 5000 })).toBe('Discord error 5000');
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
  });
});

/**
 * Mimics the SDK's subscribe/unsubscribe: the listener is registered before the
 * RPC is sent (and kept if Discord refuses), only the first listener sends
 * SUBSCRIBE, and unsubscribe sends UNSUBSCRIBE when exactly one listener is left.
 */
function participantsSdk(options: { refuseSubscribe?: boolean; refuseUnsubscribe?: boolean } = {}) {
  const listeners: unknown[] = [];
  const rpc: string[] = [];
  const sdk = {
    subscribe: vi.fn(async (_event: string, listener: unknown) => {
      const count = listeners.length;
      listeners.push(listener);
      if (count === 0) {
        rpc.push('SUBSCRIBE');
        if (options.refuseSubscribe) throw { code: 4004, message: 'Unknown event' };
      }
    }),
    unsubscribe: vi.fn(async (_event: string, listener: unknown) => {
      if (listeners.length === 1) {
        rpc.push('UNSUBSCRIBE');
        if (options.refuseUnsubscribe) throw { code: 4004, message: 'Unknown event' };
      }
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    }),
    commands: {
      getInstanceConnectedParticipants: vi.fn(async () => ({
        participants: [{ id: '1', username: 'wren', discriminator: '0', bot: false, flags: 0 }],
      })),
    },
  };
  return { sdk, listeners, rpc, typed: sdk as unknown as IDiscordSDK };
}

describe('watchParticipants', () => {
  it('subscribes, reads the snapshot and unsubscribes on stop', async () => {
    const { typed, listeners, rpc } = participantsSdk();
    const onChange = vi.fn();
    const stop = await watchParticipants(typed, onChange);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: '1' })]);
    expect(listeners).toHaveLength(1);
    await stop();
    expect(listeners).toHaveLength(0);
    expect(rpc).toEqual(['SUBSCRIBE', 'UNSUBSCRIBE']);
  });

  it('still reads the snapshot when Discord refuses the subscription, and drops the stray listener', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const options = { refuseSubscribe: true };
    const { typed, sdk, listeners, rpc } = participantsSdk(options);
    const onChange = vi.fn();
    const stop = await watchParticipants(typed, onChange);
    expect(sdk.commands.getInstanceConnectedParticipants).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: '1' })]);
    expect(listeners).toHaveLength(0);

    // A later watcher (e.g. after signing in again) gets a real SUBSCRIBE...
    options.refuseSubscribe = false;
    await watchParticipants(typed, () => undefined);
    expect(rpc).toEqual(['SUBSCRIBE', 'UNSUBSCRIBE', 'SUBSCRIBE']);
    // ...which the first watcher's stop leaves alone.
    await stop();
    expect(rpc).toHaveLength(3);
    expect(listeners).toHaveLength(1);
  });

  it('never rejects, even when Discord refuses both', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { typed, sdk } = participantsSdk({ refuseSubscribe: true, refuseUnsubscribe: true });
    const stop = await watchParticipants(typed, () => undefined);
    await expect(stop()).resolves.toBeUndefined();
    expect(sdk.unsubscribe).toHaveBeenCalledTimes(2);
  });
});

describe('usePresence', () => {
  it('starts the elapsed time afresh for each Free Flight round', async () => {
    const setActivity = vi.fn(async () => ({}));
    const sdk = { commands: { setActivity } } as unknown as IDiscordSDK;
    const now = vi.spyOn(Date, 'now');
    const practice = (patch: Partial<GameView>) => makeGame({ mode: 'practice', puzzleNumber: null, date: null, ...patch });

    now.mockReturnValue(1_000);
    const { rerender } = renderHook(({ game }: { game: GameView }) => usePresence(sdk, true, game), {
      initialProps: { game: practice({}) },
    });
    now.mockReturnValue(61_000);
    rerender({ game: practice({ guesses: [row('STORK', 'CRANE')] }) });
    now.mockReturnValue(601_000);
    rerender({ game: practice({ status: 'won', guesses: [row('STORK', 'CRANE'), row('CRANE', 'CRANE')] }) });
    now.mockReturnValue(605_000);
    rerender({ game: practice({ wordLength: 7 }) });

    const starts = setActivity.mock.calls.map((call) => (call as unknown as [{ activity: { state: string; timestamps: { start: number } } }])[0].activity);
    expect(starts.map((activity) => [activity.state, activity.timestamps.start])).toEqual([
      ['Guess 1 of 6', 1_000],
      ['Guess 2 of 6', 1_000],
      ['Solved in 2/6', 1_000],
      ['Guess 1 of 6', 605_000],
    ]);
  });
});

describe('presenceText', () => {
  it('describes daily and practice progress', () => {
    expect(presenceText(makeGame({ puzzleNumber: 12, guesses: [row('STORK', 'CRANE'), row('CRAKE', 'CRANE')] }))).toEqual({
      details: 'BIRDLE #12',
      state: 'Guess 3 of 6',
    });
    expect(presenceText(makeGame({ puzzleNumber: 12, status: 'won', guesses: Array(4).fill(row('CRANE', 'CRANE')) })).state).toBe(
      'Solved in 4/6',
    );
    expect(presenceText(makeGame({ status: 'lost', guesses: Array(6).fill(row('STORK', 'CRANE')) })).state).toBe('Stumped today');
    expect(presenceText(makeGame({ mode: 'practice', puzzleNumber: null })).details).toBe('BIRDLE Free Flight');
  });
});
