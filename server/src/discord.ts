// Minimal Discord REST client: OAuth2 code exchange and token -> user lookup.
// Uses Node's global fetch. Error messages never include codes, tokens or secrets.

export const DISCORD_API_BASE = 'https://discord.com/api';

const DEFAULT_TIMEOUT_MS = 10_000;
/** Longest rate-limit wait honoured before the single retry; longer waits fail fast. */
const DEFAULT_MAX_RETRY_AFTER_MS = 5_000;

/** The fields of a Discord user object that BIRDLE uses. */
export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordClient {
  /** Exchanges an OAuth2 authorization code for an access token. */
  exchangeCode(code: string): Promise<string>;
  /**
   * The token's user, or null when Discord rejects the token or it was issued to
   * another application (or without the identify scope). Throws DiscordApiError
   * if Discord can't answer.
   */
  fetchUser(accessToken: string): Promise<DiscordUser | null>;
}

/** Discord could not be reached or answered with an error. `status` is null for network failures. */
export class DiscordApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'DiscordApiError';
    this.status = status;
  }
}

/** The server has no DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET. */
export class DiscordNotConfiguredError extends Error {
  constructor() {
    super('Discord OAuth2 credentials are not configured');
    this.name = 'DiscordNotConfiguredError';
  }
}

export interface DiscordClientOptions {
  clientId: string | null;
  clientSecret: string | null;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  apiBase?: string;
  timeoutMs?: number;
  maxRetryAfterMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Milliseconds to wait from a 429's JSON `retry_after` (seconds) or Retry-After header. */
function retryAfterMs(body: unknown, res: Response): number | null {
  const fromBody = isRecord(body) ? body.retry_after : undefined;
  const seconds = typeof fromBody === 'number' ? fromBody : Number(res.headers.get('retry-after') ?? Number.NaN);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}

function parseUser(body: unknown): DiscordUser | null {
  if (!isRecord(body)) return null;
  const { id, username, global_name: globalName, avatar } = body;
  if (typeof id !== 'string' || !/^\d{1,25}$/.test(id) || typeof username !== 'string' || username === '') return null;
  return {
    id,
    username,
    global_name: typeof globalName === 'string' && globalName !== '' ? globalName : null,
    avatar: typeof avatar === 'string' && avatar !== '' ? avatar : null,
  };
}

export function createDiscordClient(options: DiscordClientOptions): DiscordClient {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const apiBase = options.apiBase ?? DISCORD_API_BASE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;

  /** Sends a request, retrying once on 429 when Discord asks for a short wait. Resolves to [response, parsed JSON body]. */
  async function send(what: string, url: string, init: RequestInit): Promise<[Response, unknown]> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'could not connect';
        throw new DiscordApiError(`Discord ${what} failed: ${reason}`, null);
      }
      const body = await readJson(res);
      if (res.status !== 429 || attempt > 0) return [res, body];
      const waitMs = retryAfterMs(body, res);
      if (waitMs === null || waitMs > maxRetryAfterMs) return [res, body];
      await sleep(waitMs);
    }
  }

  return {
    async exchangeCode(code) {
      const { clientId, clientSecret } = options;
      if (!clientId || !clientSecret) throw new DiscordNotConfiguredError();
      // Activities send no redirect_uri (matches Discord's official Activity samples).
      const [res, body] = await send('token exchange', `${apiBase}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
        }),
      });
      if (!res.ok) {
        const reason = isRecord(body) && typeof body.error === 'string' && /^[a-z_]{1,64}$/.test(body.error) ? `: ${body.error}` : '';
        throw new DiscordApiError(`Discord token exchange failed (HTTP ${res.status}${reason})`, res.status);
      }
      const accessToken = isRecord(body) ? body.access_token : undefined;
      if (typeof accessToken !== 'string' || accessToken === '') {
        throw new DiscordApiError('Discord token exchange returned no access_token', res.status);
      }
      return accessToken;
    },

    async fetchUser(accessToken) {
      // Any Discord app's `identify` token could read /users/@me, so check which
      // application the token was issued to. GET /oauth2/@me answers both at once.
      const { clientId } = options;
      if (!clientId) return null;
      const [res, body] = await send('user lookup', `${apiBase}/v10/oauth2/@me`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      // 401: invalid/expired token; 403: not allowed. Both mean "not signed in".
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new DiscordApiError(`Discord user lookup failed (HTTP ${res.status})`, res.status);
      if (!isRecord(body) || !isRecord(body.application) || typeof body.application.id !== 'string') {
        throw new DiscordApiError('Discord user lookup returned an unexpected body', res.status);
      }
      if (body.application.id !== clientId) return null;
      // `user` is present only when the token has the identify scope.
      if (body.user === undefined) return null;
      const user = parseUser(body.user);
      if (!user) throw new DiscordApiError('Discord user lookup returned an unexpected body', res.status);
      return user;
    },
  };
}
