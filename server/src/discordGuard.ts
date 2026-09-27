// Discord bans an IP from its whole API for a while once it has sent 10,000
// invalid responses (401, 403 or 429) in 10 minutes. Anyone can make BIRDLE call
// Discord (a made-up bearer token, a bogus OAuth code), so those calls are
// budgeted locally. All players reach the server through Discord's proxy, so a
// per-IP limit would not tell them apart: the budget is global.

import { DiscordApiError, DiscordNotConfiguredError, type DiscordClient } from './discord';
import type { Clock, Logger } from './runtime';

/** `capacity` calls in a burst, refilled at `perSecond`. */
export interface RateLimit {
  capacity: number;
  perSecond: number;
}

export interface DiscordLimits {
  /** Discord calls that may be answered 401, 403 or 429; a call's share is returned when Discord accepts it. */
  invalid: RateLimit;
  /** OAuth2 code exchanges (POST /api/token). */
  exchanges: RateLimit;
}

export const DEFAULT_DISCORD_LIMITS: DiscordLimits = {
  // At most about 3,100 invalid responses per 10 minutes: under a third of Discord's limit.
  invalid: { capacity: 100, perSecond: 5 },
  exchanges: { capacity: 30, perSecond: 2 },
};

const INVALID_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);
const WARNING_INTERVAL_MS = 60_000;

/** Thrown instead of calling Discord while the budget is used up. */
export class DiscordBusyError extends Error {
  constructor() {
    super('Too many Discord sign-in checks right now');
    this.name = 'DiscordBusyError';
  }
}

export class TokenBucket {
  private readonly limit: RateLimit;
  private readonly clock: Clock;
  private tokens: number;
  private updatedAt: number;

  constructor(limit: RateLimit, clock: Clock) {
    this.limit = limit;
    this.clock = clock;
    this.tokens = limit.capacity;
    this.updatedAt = clock.now().getTime();
  }

  tryTake(): boolean {
    const now = this.clock.now().getTime();
    const elapsedSeconds = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.limit.capacity, this.tokens + elapsedSeconds * this.limit.perSecond);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  refund(): void {
    this.tokens = Math.min(this.limit.capacity, this.tokens + 1);
  }
}

export interface DiscordGuardOptions {
  clock: Clock;
  logger: Logger;
  limits?: Partial<DiscordLimits>;
}

/** Wraps a DiscordClient so that it throws DiscordBusyError rather than risk an IP ban. */
export function guardDiscordClient(client: DiscordClient, options: DiscordGuardOptions): DiscordClient {
  const limits: DiscordLimits = { ...DEFAULT_DISCORD_LIMITS, ...options.limits };
  const invalid = new TokenBucket(limits.invalid, options.clock);
  const exchanges = new TokenBucket(limits.exchanges, options.clock);
  let lastWarning = Number.NEGATIVE_INFINITY;

  function busy(): DiscordBusyError {
    const now = options.clock.now().getTime();
    if (now - lastWarning >= WARNING_INTERVAL_MS) {
      lastWarning = now;
      options.logger.warn('Discord call budget used up (many unknown tokens or sign-ins); refusing Discord lookups for now.');
    }
    return new DiscordBusyError();
  }

  /** Runs `call` against the invalid-response budget; its share is returned unless Discord refused it. */
  async function budgeted<T>(call: () => Promise<T>, refused: (result: T) => boolean): Promise<T> {
    if (!invalid.tryTake()) throw busy();
    let result: T;
    try {
      result = await call();
    } catch (error) {
      const status = error instanceof DiscordApiError ? error.status : null;
      if (status === null || !INVALID_STATUSES.has(status)) invalid.refund();
      throw error;
    }
    if (!refused(result)) invalid.refund();
    return result;
  }

  return {
    async exchangeCode(code) {
      if (!exchanges.tryTake()) throw busy();
      try {
        return await budgeted(() => client.exchangeCode(code), () => false);
      } catch (error) {
        // No Discord call was made.
        if (error instanceof DiscordNotConfiguredError) exchanges.refund();
        throw error;
      }
    },
    // A null user means Discord (or the audience check) rejected the token.
    fetchUser: (accessToken) => budgeted(() => client.fetchUser(accessToken), (user) => user === null),
  };
}
