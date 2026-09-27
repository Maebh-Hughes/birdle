import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDays, type DailyGuessResponse, type MeResponse, type Stats } from '@birdle/shared';
import { MISSES, as, dailyGuess, makeTestApp, playDaily } from './helpers';

/** Puzzle #1 is 2026-09-26. */
const DAY1 = '2026-09-26';
const day = (n: number): string => addDays(DAY1, n - 1);

async function winOn(ctx: ReturnType<typeof makeTestApp>, n: number): Promise<Stats> {
  ctx.clock.setDate(day(n));
  const res = await dailyGuess(ctx.app, 'alice', 'robin', { date: day(n) });
  return (res.body as DailyGuessResponse).stats;
}

async function loseOn(ctx: ReturnType<typeof makeTestApp>, n: number): Promise<void> {
  ctx.clock.setDate(day(n));
  const game = await playDaily(ctx.app, 'alice', MISSES, day(n));
  expect(game.status).toBe('lost');
}

async function meOn(ctx: ReturnType<typeof makeTestApp>, n: number): Promise<Stats> {
  ctx.clock.setDate(day(n));
  const res = await request(ctx.app).get('/api/me').query({ date: day(n) }).set(as('alice'));
  return (res.body as MeResponse).stats;
}

describe('daily stats and streaks', () => {
  it('starts empty', async () => {
    const ctx = makeTestApp();
    const res = await request(ctx.app).get('/api/me').set(as('alice', 'Alice A.'));
    expect(res.status).toBe(200);
    expect(res.body as MeResponse).toEqual({
      user: { id: 'alice', username: 'alice', displayName: 'Alice A.', avatarUrl: null },
      stats: {
        played: 0,
        wins: 0,
        currentStreak: 0,
        maxStreak: 0,
        distribution: [0, 0, 0, 0, 0, 0],
        lastPlayedPuzzle: null,
        lastWonPuzzle: null,
      },
    });
  });

  it('extends the streak on consecutive wins and restarts it after a skipped puzzle', async () => {
    const ctx = makeTestApp();
    expect(await winOn(ctx, 1)).toMatchObject({ currentStreak: 1, maxStreak: 1 });
    expect(await winOn(ctx, 2)).toMatchObject({ currentStreak: 2, maxStreak: 2 });
    expect(await winOn(ctx, 3)).toMatchObject({ currentStreak: 3, maxStreak: 3 });
    // Puzzle 4 skipped.
    expect(await winOn(ctx, 5)).toMatchObject({
      played: 4,
      wins: 4,
      currentStreak: 1,
      maxStreak: 3,
      distribution: [4, 0, 0, 0, 0, 0],
      lastPlayedPuzzle: 5,
      lastWonPuzzle: 5,
    });
  });

  it('resets the streak on a loss but keeps the max', async () => {
    const ctx = makeTestApp();
    await winOn(ctx, 1);
    await winOn(ctx, 2);
    await loseOn(ctx, 3);
    expect(await meOn(ctx, 3)).toMatchObject({ played: 3, wins: 2, currentStreak: 0, maxStreak: 2, lastWonPuzzle: 2 });
    expect(await winOn(ctx, 4)).toMatchObject({ played: 4, wins: 3, currentStreak: 1, maxStreak: 2 });
  });

  it('shows a lapsed streak as 0 once a puzzle has been missed', async () => {
    const ctx = makeTestApp();
    await winOn(ctx, 1);
    await winOn(ctx, 2);
    expect(await meOn(ctx, 2)).toMatchObject({ currentStreak: 2 });
    expect(await meOn(ctx, 3)).toMatchObject({ currentStreak: 2 }); // today's puzzle not played yet: still alive
    expect(await meOn(ctx, 4)).toMatchObject({ currentStreak: 0, maxStreak: 2 }); // puzzle 3 missed
  });

  it('counts the guess distribution by guesses used', async () => {
    const ctx = makeTestApp();
    ctx.clock.setDate(day(1));
    await playDaily(ctx.app, 'alice', ['slate', 'duvet', 'robin'], day(1));
    ctx.clock.setDate(day(2));
    await playDaily(ctx.app, 'alice', [...MISSES.slice(0, 5), 'robin'], day(2));
    expect(await meOn(ctx, 2)).toMatchObject({ played: 2, wins: 2, distribution: [0, 0, 1, 0, 0, 1], currentStreak: 2 });
  });

  it("counts yesterday's puzzle finished after today's without touching the streak", async () => {
    const ctx = makeTestApp();
    await winOn(ctx, 5);
    // Still 2026-09-30 somewhere: the player finishes puzzle 4 late.
    const late = await dailyGuess(ctx.app, 'alice', 'robin', { date: day(4) });
    expect((late.body as DailyGuessResponse).stats).toMatchObject({
      played: 2,
      wins: 2,
      currentStreak: 1,
      lastPlayedPuzzle: 5,
      lastWonPuzzle: 5,
    });
  });

  it('falls back to the UTC date when the /api/me date is not playable, instead of failing sign-in', async () => {
    const ctx = makeTestApp();
    await winOn(ctx, 1);
    await winOn(ctx, 2);
    ctx.clock.setDate(day(3));
    for (const date of ['1999-01-01', day(1), day(5), 'garbage']) {
      const res = await request(ctx.app).get('/api/me').query({ date }).set(as('alice'));
      expect(res.status, date).toBe(200);
      // As of puzzle 3 (today in UTC): the streak is still alive.
      expect((res.body as MeResponse).stats, date).toMatchObject({ currentStreak: 2, wins: 2 });
    }
  });
});
