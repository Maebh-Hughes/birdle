import type { Types } from '@discord/embedded-app-sdk';
import { exchangeCode } from '../api';
import { describeError } from './errors';
import type { DiscordEnv } from './sdk';

export interface DiscordAuth {
  /** Bearer token for the BIRDLE API: the Discord access token, or a `mock:` token. */
  token: string;
  /** setActivity needs rpc.activities.write, which may not have been granted. */
  presenceEnabled: boolean;
}

const PRESENCE_SCOPE: Types.OAuthScopes = 'rpc.activities.write';
const FULL_SCOPES: Types.OAuthScopes[] = ['identify', PRESENCE_SCOPE];

/** Discord normally answers the handshake at once; don't sit on the loading screen forever. */
export const READY_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function authorize(env: DiscordEnv, scope: Types.OAuthScopes[]): Promise<string> {
  const { code } = await env.sdk.commands.authorize({
    client_id: env.clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope,
  });
  return code;
}

/**
 * Inside Discord: ready -> authorize -> POST /api/token -> authenticate.
 * If authorizing with rpc.activities.write fails, retries once with identify only
 * (the game still works, without rich presence).
 * Mock mode never sends the fake OAuth code to the server; it uses a `mock:` token.
 */
export async function authenticate(
  env: DiscordEnv,
  exchange: (code: string) => Promise<string> = exchangeCode,
): Promise<DiscordAuth> {
  await withTimeout(env.sdk.ready(), READY_TIMEOUT_MS, 'Discord did not respond. Try reopening the Activity.');

  if (!env.embedded) {
    await env.sdk.commands.authenticate({ access_token: env.identity.token });
    return { token: env.identity.token, presenceEnabled: true };
  }

  let code: string;
  try {
    code = await authorize(env, FULL_SCOPES);
  } catch (error) {
    console.warn(`BIRDLE: authorize with ${PRESENCE_SCOPE} failed, retrying with identify only:`, describeError(error));
    code = await authorize(env, ['identify']);
  }

  const accessToken = await exchange(code);
  const auth = await env.sdk.commands.authenticate({ access_token: accessToken });
  if (!auth) throw new Error('Discord did not accept the access token.');
  return {
    token: accessToken,
    presenceEnabled: (auth.scopes as readonly unknown[]).includes(PRESENCE_SCOPE),
  };
}
