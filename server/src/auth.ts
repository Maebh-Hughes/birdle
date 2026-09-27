import { createHash } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { PlayerProfile } from '@birdle/shared';
import { DiscordApiError, type DiscordClient, type DiscordUser } from './discord';
import { DiscordBusyError } from './discordGuard';
import { ApiError } from './errors';
import type { Clock, Logger } from './runtime';

export const AUTH_CACHE_TTL_MS = 5 * 60_000;
export const AUTH_CACHE_MAX_ENTRIES = 1000;
/** A token Discord rejected is refused locally for this long, without asking Discord again. */
export const REJECTED_TOKEN_TTL_MS = 60_000;
export const MOCK_TOKEN_PREFIX = 'mock:';

const MAX_TOKEN_LENGTH = 1024;
const MOCK_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_DISPLAY_NAME_LENGTH = 32;
const AVATAR_HASH_PATTERN = /^(a_)?[0-9a-f]{32}$/;
// Control characters and bidi overrides in a name would garble other players' Flock panels.
const UNSAFE_NAME_CHARS = /[\p{Cc}‎‏‪-‮⁦-⁩]/gu;

/** Discord CDN avatar URL (CSP-allowed inside Activities), or null for default avatars. */
export function avatarUrl(userId: string, avatarHash: string | null): string | null {
  if (avatarHash === null || !AVATAR_HASH_PATTERN.test(avatarHash)) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=64`;
}

export function cleanDisplayName(name: string): string {
  const cleaned = name.replace(UNSAFE_NAME_CHARS, '').replace(/\s+/g, ' ').trim();
  return Array.from(cleaned).slice(0, MAX_DISPLAY_NAME_LENGTH).join('').trim();
}

export function profileFromDiscordUser(user: DiscordUser): PlayerProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: cleanDisplayName(user.global_name ?? '') || user.username,
    avatarUrl: avatarUrl(user.id, user.avatar),
  };
}

/**
 * Parses `mock:<id>` or `mock:<id>:<URL-encoded display name>`. The id must be
 * 1-64 of [A-Za-z0-9._-]. Returns null for a malformed token.
 */
export function parseMockToken(token: string): PlayerProfile | null {
  if (!token.startsWith(MOCK_TOKEN_PREFIX)) return null;
  const rest = token.slice(MOCK_TOKEN_PREFIX.length);
  const separator = rest.indexOf(':');
  const id = separator === -1 ? rest : rest.slice(0, separator);
  if (!MOCK_ID_PATTERN.test(id)) return null;
  let name = '';
  if (separator !== -1) {
    try {
      name = decodeURIComponent(rest.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return { id, username: id, displayName: cleanDisplayName(name) || id, avatarUrl: null };
}

/** `Authorization: Bearer <token>` -> token, or null when missing or malformed. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? '');
  const token = match?.[1];
  return token !== undefined && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

/** Tokens are only held as SHA-256 digests, so a heap dump or log line can't leak them. */
function digest(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** A size-bounded map whose entries expire; the oldest entry is evicted first when full. */
class ExpiringCache<V> {
  // Map iteration order = insertion order, so the first key is the oldest entry.
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly clock: Clock;

  constructor(ttlMs: number, maxEntries: number, clock: Clock) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.clock = clock;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > this.clock.now().getTime()) return entry.value;
    this.entries.delete(key);
    return undefined;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.clock.now().getTime() + this.ttlMs });
  }
}

export interface AuthenticatorOptions {
  discord: DiscordClient;
  allowMockAuth: boolean;
  clock: Clock;
  logger: Logger;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
}

export interface Authenticator {
  /**
   * The player behind a bearer token, or null if the token is invalid. Throws
   * DiscordApiError when Discord is unreachable, DiscordBusyError when Discord
   * calls are being rationed.
   */
  authenticate(token: string): Promise<PlayerProfile | null>;
  /** Number of cached accepted tokens (for tests and diagnostics). */
  readonly cacheSize: number;
}

export function createAuthenticator(options: AuthenticatorOptions): Authenticator {
  const maxEntries = options.cacheMaxEntries ?? AUTH_CACHE_MAX_ENTRIES;
  const accepted = new ExpiringCache<PlayerProfile>(options.cacheTtlMs ?? AUTH_CACHE_TTL_MS, maxEntries, options.clock);
  // Repeating a rejected token must not reach Discord each time (see discordGuard.ts).
  const rejected = new ExpiringCache<true>(REJECTED_TOKEN_TTL_MS, maxEntries, options.clock);
  const inFlight = new Map<string, Promise<PlayerProfile | null>>();

  async function lookup(key: string, token: string): Promise<PlayerProfile | null> {
    const user = await options.discord.fetchUser(token);
    if (!user) {
      rejected.set(key, true);
      return null;
    }
    const profile = profileFromDiscordUser(user);
    accepted.set(key, profile);
    return profile;
  }

  return {
    get cacheSize() {
      return accepted.size;
    },

    async authenticate(token) {
      if (token.startsWith(MOCK_TOKEN_PREFIX)) {
        return options.allowMockAuth ? parseMockToken(token) : null;
      }
      const key = digest(token);
      const cached = accepted.get(key);
      if (cached) return cached;
      if (rejected.get(key)) return null;
      // Coalesce concurrent lookups of the same token (the client fires several requests at boot).
      let pending = inFlight.get(key);
      if (!pending) {
        pending = lookup(key, token).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return pending;
    },
  };
}

/** The authenticated player of a request that passed requireAuth. */
export function currentUser(res: Response): PlayerProfile {
  const user = res.locals.user as PlayerProfile | undefined;
  if (!user) throw new Error('currentUser() used on a route without requireAuth');
  return user;
}

/**
 * Bearer-token middleware: 401 UNAUTHORIZED without a valid token, 502 when
 * Discord can't verify it. `onUser` runs for every authenticated request
 * (the app uses it to keep stored profiles current).
 */
export function requireAuth(
  authenticator: Authenticator,
  logger: Logger,
  onUser: (profile: PlayerProfile) => Promise<void>,
): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req.get('authorization'));
    if (token === null) throw new ApiError('UNAUTHORIZED', 'Missing bearer token');
    let profile: PlayerProfile | null;
    try {
      profile = await authenticator.authenticate(token);
    } catch (error) {
      if (error instanceof DiscordBusyError) {
        throw new ApiError('BAD_REQUEST', 'Too many sign-in checks right now. Please try again in a minute.', 429);
      }
      if (!(error instanceof DiscordApiError)) throw error;
      logger.warn(`Could not verify a Discord token: ${error.message}`);
      throw new ApiError('BAD_REQUEST', "Couldn't verify your Discord sign-in. Please try again.", 502);
    }
    if (!profile) throw new ApiError('UNAUTHORIZED', 'Invalid or expired token');
    res.locals.user = profile;
    await onUser(profile);
    next();
  };
}
