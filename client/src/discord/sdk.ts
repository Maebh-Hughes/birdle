import { DiscordSDK, DiscordSDKMock, Platform, type IDiscordSDK } from '@discord/embedded-app-sdk';
import { getLocalStorage } from '../storage';
import { resolveMockIdentity, type MockIdentity } from './mockIdentity';
import type { Participant } from './participants';

// SDK bootstrap: the real DiscordSDK inside Discord, DiscordSDKMock in a plain
// browser (local development and multi-tab testing).

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

export function createDiscordEnv(
  search: string = window.location.search,
  storage: Storage | null = getLocalStorage(),
): DiscordEnv {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim() ?? '';

  if (isDiscordLaunch(search)) {
    if (!clientId) throw new Error('VITE_DISCORD_CLIENT_ID is not set, so BIRDLE cannot talk to Discord.');
    const sdk = new DiscordSDK(clientId, { disableConsoleLogOverride: false });
    return {
      embedded: true,
      sdk,
      clientId,
      instanceId: sdk.instanceId,
      platform: sdk.platform === Platform.MOBILE ? 'mobile' : 'desktop',
    };
  }

  const identity = resolveMockIdentity(search, storage);
  const mockClientId = clientId || 'birdle-local';
  // Its instanceId is the fixed '123456789012345678', so every local tab shares one Flock.
  const mock = new DiscordSDKMock(mockClientId, 'mock_guild', 'mock_channel', null);
  configureMock(mock, mockClientId, identity);
  return { embedded: false, sdk: mock, mock, identity, clientId: mockClientId, instanceId: mock.instanceId, platform: 'desktop' };
}
