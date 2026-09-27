import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DiscordApiError } from '../src/discord';
import { DiscordBusyError, TokenBucket, guardDiscordClient } from '../src/discordGuard';
import { DISCORD_USER, RecordingLogger, TestClock, fakeDiscord, makeTestApp } from './helpers';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('TokenBucket', () => {
  it('allows a burst, then refills over time up to its capacity', () => {
    const clock = new TestClock();
    const bucket = new TokenBucket({ capacity: 3, perSecond: 2 }, clock);
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, true, false]);
    clock.advanceMs(500);
    expect([bucket.tryTake(), bucket.tryTake()]).toEqual([true, false]);
    clock.advanceMs(60_000);
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, true, false]);
    bucket.refund();
    expect(bucket.tryTake()).toBe(true);
  });
});

describe('Discord call budget', () => {
  it('stops unknown bearer tokens from reaching Discord once the budget is used up', async () => {
    const { app, discord, clock, logger } = makeTestApp({
      allowMockAuth: false,
      discordLimits: { invalid: { capacity: 10, perSecond: 1 } },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await request(app).get('/api/me').set(bearer(`random-${i}`))).status);
    expect(discord.fetchUser).toHaveBeenCalledTimes(10);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual(Array(30).fill(429));
    expect(logger.lines.filter((line) => line.includes('budget'))).toHaveLength(1);

    clock.advanceMs(3000);
    await request(app).get('/api/me').set(bearer('random-late'));
    expect(discord.fetchUser).toHaveBeenCalledTimes(11);
  });

  it('gives accepted tokens their share back, so real sign-ins are not limited', async () => {
    const discord = fakeDiscord();
    discord.fetchUser.mockImplementation(async (token) => ({ ...DISCORD_USER, id: token.replace('player-', '') }));
    const { app } = makeTestApp({ allowMockAuth: false, discord, discordLimits: { invalid: { capacity: 3, perSecond: 0 } } });
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get('/api/me').set(bearer(`player-${1000 + i}`));
      expect(res.status).toBe(200);
    }
    expect(discord.fetchUser).toHaveBeenCalledTimes(20);
  });

  it('rate-limits OAuth code exchanges locally', async () => {
    const { app, discord } = makeTestApp({ discordLimits: { exchanges: { capacity: 3, perSecond: 0 } } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(app).post('/api/token').send({ code: `code-${i}` })).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(discord.exchangeCode).toHaveBeenCalledTimes(3);
  });

  it('charges only answers Discord counts as invalid (401, 403, 429)', async () => {
    const inner = fakeDiscord();
    const guarded = guardDiscordClient(inner, {
      clock: new TestClock(),
      logger: new RecordingLogger(),
      limits: { invalid: { capacity: 2, perSecond: 0 } },
    });
    inner.fetchUser.mockRejectedValue(new DiscordApiError('Discord user lookup failed (HTTP 500)', 500));
    for (let i = 0; i < 5; i++) await expect(guarded.fetchUser('t')).rejects.toBeInstanceOf(DiscordApiError);

    inner.fetchUser.mockRejectedValue(new DiscordApiError('Discord user lookup failed (HTTP 429)', 429));
    await expect(guarded.fetchUser('t')).rejects.toBeInstanceOf(DiscordApiError);
    await expect(guarded.fetchUser('t')).rejects.toBeInstanceOf(DiscordApiError);
    await expect(guarded.fetchUser('t')).rejects.toBeInstanceOf(DiscordBusyError);
    expect(inner.fetchUser).toHaveBeenCalledTimes(7);
  });
});
