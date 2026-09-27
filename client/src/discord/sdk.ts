import { DiscordSDK, DiscordSDKMock, Platform, type IDiscordSDK } from '@discord/embedded-app-sdk';
import type { ConfigResponse } from '@birdle/shared';
import { fetchConfig } from '../api';
import { getLocalStorage } from '../storage';
import { resolveMockIdentity, type MockIdentity } from './mockIdentity';
import type { Participant } from './participants';

// SDK bootstrap: the real DiscordSDK inside Discord, DiscordSDKMock in a plain
// browser (local development and multi-tab testing). Nothing is created at
// import time: inside Discord the application id may have to come from the
// server first (GET /api/config), so one client build works for any Discord app.

interface BaseEnv {
  sdk: IDiscordSDK;
  clientId: string;
  /** Shared by everyone in the same Activity launch; keys the Flock. */
  instanceId: string;
  platform: 'desktop' | 'mobile';
}

export interface EmbeddedEnv extends BaseEnv {
  embedded: true;
}

export interface MockEnv extends BaseEnv {
  embedded: false;
  mock: DiscordSDKMock;
  identity: MockIdentity;
}

export type DiscordEnv = EmbeddedEnv | MockEnv;

/** Discord launches Activities with these query params; `new DiscordSDK()` throws without them. */
export function isDiscordLaunch(search: string): boolean {
  const query = new URLSearchParams(search);
  return query.get('frame_id') != null && query.get('instance_id') != null && query.get('platform') != null;
}

/**
 * Points the mock's commands at `player`. `_updateCommandMocks` rebuilds from the
 * SDK defaults on every call, so all overrides are passed together.
 */
export function configureMock(mock: DiscordSDKMock, clientId: string, player: { id: string; displayName: string }): void {
  const me: Participant = {
    id: player.id,
    username: player.id,
    discriminator: '0',
    global_name: player.displayName,
    avatar: null,
    bot: false,
    flags: 0,
  };
  mock._updateCommandMocks({
    authenticate: async () => ({
      access_token: 'mock_token',
      user: { id: me.id, username: me.username, discriminator: '0', global_name: me.global_name, avatar: null, public_flags: 0 },
      scopes: ['identify', 'rpc.activities.write'],
      expires: new Date(2112, 1, 1).toString(),
      application: { id: clientId, name: 'BIRDLE', description: 'Local mock' },
    }),
    getInstanceConnectedParticipants: async () => ({ participants: [me] }),
    getActivityInstanceConnectedParticipants: async () => ({ participants: [me] }),
    userSettingsGetLocale: async () => ({ locale: navigator.language || 'en-US' }),
  });
}

/** Inside Discord, but neither the build nor the server has a Discord application id. */
export class MissingClientIdError extends Error {
  override readonly name = 'MissingClientIdError';

  constructor() {
    super('No Discord application ID is configured (set DISCORD_CLIENT_ID on the BIRDLE server).');
  }
}

/**
 * The Discord application id: the build-time VITE_DISCORD_CLIENT_ID when one
 * was compiled in, otherwise the server's DISCORD_CLIENT_ID from GET /api/config.
 * Throws MissingClientIdError when neither has one.
 */
export async function resolveClientId(buildClientId: string, loadConfig: () => Promise<ConfigResponse>): Promise<string> {
  const built = buildClientId.trim();
  if (built) return built;
  const { discordClientId } = await loadConfig();
  if (!discordClientId) throw new MissingClientIdError();
  return discordClientId;
}

export interface DiscordEnvOptions {
  /** Default: window.location.search. */
  search?: string;
  /** For the mock guest id. Default: localStorage (null when unavailable). */
  storage?: Storage | null;
  /** Default: import.meta.env.VITE_DISCORD_CLIENT_ID (blank = ask the server). */
  buildClientId?: string;
  /** Default: GET /api/config. */
  loadConfig?: () => Promise<ConfigResponse>;
}

/**
 * Creates the SDK for this page: inside Discord (launch query parameters
 * present) the real DiscordSDK, constructed only once the application id is
 * known; in a plain browser the mock, which needs no id and no server call.
 */
export async function createDiscordEnv(options: DiscordEnvOptions = {}): Promise<DiscordEnv> {
  const search = options.search ?? window.location.search;
  const buildClientId = (options.buildClientId ?? import.meta.env.VITE_DISCORD_CLIENT_ID ?? '').trim();

  if (isDiscordLaunch(search)) {
    const clientId = await resolveClientId(buildClientId, options.loadConfig ?? (() => fetchConfig()));
    const sdk = new DiscordSDK(clientId, { disableConsoleLogOverride: false });
    return {
      embedded: true,
      sdk,
      clientId,
      instanceId: sdk.instanceId,
      platform: sdk.platform === Platform.MOBILE ? 'mobile' : 'desktop',
    };
  }

  const identity = resolveMockIdentity(search, options.storage === undefined ? getLocalStorage() : options.storage);
  const mockClientId = buildClientId || 'birdle-local';
  // Its instanceId is the fixed '123456789012345678', so every local tab shares one Flock.
  const mock = new DiscordSDKMock(mockClientId, 'mock_guild', 'mock_channel', null);
  configureMock(mock, mockClientId, identity);
  return { embedded: false, sdk: mock, mock, identity, clientId: mockClientId, instanceId: mock.instanceId, platform: 'desktop' };
}
