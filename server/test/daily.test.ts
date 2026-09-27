import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { HINT_AFTER_GUESSES, MAX_GUESSES, type DailyGuessResponse, type GameResponse } from '@birdle/shared';
import { GameService } from '../src/game';
import { createPuzzles } from '../src/puzzle';
import { MemoryStore, type GameRecord } from '../src/store';
import {
  MISSES,
  ROBIN,
  TODAY,
  TODAY_PUZZLE,
  as,
  bird,
  dailyGuess,
  fixtureCatalog,
  makeTestApp,
  playDaily,
} from './helpers';

/** Everything that would give away today's answer. */
function expectNoSpoilers(rawJson: string): void {
  expect(rawJson.toLowerCase()).not.toContain('robin');
  expect(rawJson).not.toContain(ROBIN.hint);
  expect(rawJson).not.toContain(ROBIN.fact);
  expect(rawJson).not.toContain('wikipedia');
}

describe('GET /api/daily', () => {
  it('requires a bearer token', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/daily').query({ date: TODAY });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
  });

  it('returns a fresh game sized to the answer without revealing it', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/daily').query({ date: TODAY }).set(as('alice'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((res.body as GameResponse).game).toEqual({
      mode: 'daily',
      puzzleNumber: TODAY_PUZZLE,
      date: TODAY,
      wordLength: 5,
      guesses: [],
      status: 'playing',
      hardMode: false,
      hintUsed: false,
      hintAvailable: false,
      hint: null,
      answer: null,
      maxGuesses: MAX_GUESSES,
    });
    expectNoSpoilers(res.text);
  });

  it('sizes the board to answers of any length (4 and 11 letters)', async () => {
    for (const word of ['WREN', 'HUMMINGBIRD']) {
      const { app } = makeTestApp({ words: fixtureCatalog([bird(word)], []) });
      const res = await request(app).get('/api/daily').query({ date: TODAY }).set(as('alice'));
      expect((res.body as GameResponse).game.wordLength).toBe(word.length);
      const win = await dailyGuess(app, 'alice', word.toLowerCase());
      expect((win.body as DailyGuessResponse).game.status).toBe('won');
    }
  });
});

describe('date validation (BAD_DATE)', () => {
  const cases: [string, unknown, number][] = [
    ['yesterday (UTC)', '2026-10-04', 200],
    ['tomorrow (UTC)', '2026-10-06', 200],
    ['two days ago', '2026-10-03', 400],
    ['two days ahead', '2026-10-07', 400],
    ['an impossible date', '2026-02-30', 400],
    ['a non-date', 'today', 400],
    ['a sloppy format', '2026-10-5', 400],
  ];

  it.each(cases)('GET /api/daily with %s', async (_label, date, status) => {
    const { app } = makeTestApp();
    const res = await request(app)
      .get('/api/daily')
      .query({ date: date as string })
      .set(as('alice'));
    expect(res.status).toBe(status);
    if (status === 400) expect(res.body.error.code).toBe('BAD_DATE');
  });

  it('rejects a missing or repeated date parameter', async () => {
    const { app } = makeTestApp();
    const missing = await request(app).get('/api/daily').set(as('alice'));
    expect(missing.body.error.code).toBe('BAD_DATE');
    const repeated = await request(app).get(`/api/daily?date=${TODAY}&date=${TODAY}`).set(as('alice'));
    expect(repeated.body.error.code).toBe('BAD_DATE');
  });

  it('rejects dates before puzzle #1 even when they are within a day of today', async () => {
    const { app, clock } = makeTestApp();
    clock.set('2026-09-26T00:30:00Z');
    const res = await request(app).get('/api/daily').query({ date: '2026-09-25' }).set(as('alice'));
    expect(res.body.error.code).toBe('BAD_DATE');
  });

  it('validates the date of guesses and hints too', async () => {
    const { app } = makeTestApp();
    const guess = await dailyGuess(app, 'alice', 'slate', { date: '2026-10-09' });
    expect(guess.status).toBe(400);
    expect(guess.body.error.code).toBe('BAD_DATE');
    const hint = await request(app).post('/api/daily/hint').set(as('alice')).send({ date: 12 });
    expect(hint.body.error.code).toBe('BAD_DATE');
  });
});

describe('POST /api/daily/guess', () => {
  it('scores a guess and keeps the answer secret while playing', async () => {
    const { app } = makeTestApp();
    const res = await dailyGuess(app, 'alice', 'rains');
    expect(res.status).toBe(200);
    const { game, stats } = res.body as DailyGuessResponse;
    expect(game.guesses).toEqual([{ word: 'RAINS', result: ['correct', 'absent', 'present', 'present', 'absent'] }]);
    expect(game.status).toBe('playing');
    expect(stats.played).toBe(0);
    expect(res.text).not.toContain(ROBIN.hint);
    expect(res.text).not.toContain(ROBIN.fact);
    expect(res.text.toLowerCase()).not.toContain('robin');
  });

  it('never leaks the answer, hint or fact in any response before the game ends', async () => {
    const { app } = makeTestApp();
    const responses = [await request(app).get('/api/daily').query({ date: TODAY }).set(as('alice'))];
    for (const miss of MISSES.slice(0, MAX_GUESSES - 1)) responses.push(await dailyGuess(app, 'alice', miss));
    responses.push(await request(app).get('/api/daily').query({ date: TODAY }).set(as('alice')));
    responses.push(await request(app).get('/api/me').set(as('alice')));
    responses.push(await request(app).post('/api/instances/i-1/join').set(as('alice')).send({ date: TODAY }));
    responses.push(await request(app).get('/api/instances/i-1/flock').query({ date: TODAY }).set(as('alice')));
    responses.push(await dailyGuess(app, 'alice', 'zzzzz'));
    for (const res of responses) expectNoSpoilers(res.text);
    expect(responses.at(-1)?.body.error.code).toBe('NOT_IN_WORD_LIST');
  });

  it('accepts guesses case-insensitively and trims whitespace', async () => {
    const { app } = makeTestApp();
    const res = await dailyGuess(app, 'alice', '  SlAtE ');
    expect((res.body as DailyGuessResponse).game.guesses[0]?.word).toBe('SLATE');
  });

  it.each([
    ['too short', 'rain', 'Not enough letters'],
    ['too long', 'planet', 'Too many letters'],
    ['empty', '', 'Not enough letters'],
    ['non-letters', 'sl4te', 'Use letters A-Z only'],
    ['non-ASCII letters', 'straß', 'Use letters A-Z only'],
  ])('rejects a %s guess with 422 INVALID_GUESS', async (_label, guess, message) => {
    const { app } = makeTestApp();
    const res = await dailyGuess(app, 'alice', guess);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { code: 'INVALID_GUESS', message } });
  });

  it('rejects words that are not in the list with 422 NOT_IN_WORD_LIST', async () => {
    const { app } = makeTestApp();
    const res = await dailyGuess(app, 'alice', 'qwxyz');
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { code: 'NOT_IN_WORD_LIST', message: 'Not in word list' } });
  });

  it('accepts bird words that are not in the dictionary', async () => {
    const { app } = makeTestApp();
    const res = await dailyGuess(app, 'alice', 'talon');
    expect(res.status).toBe(200);
  });

  it('rejects malformed bodies with 400 BAD_REQUEST', async () => {
    const { app } = makeTestApp();
    const noGuess = await request(app).post('/api/daily/guess').set(as('alice')).send({ date: TODAY });
    expect(noGuess.status).toBe(400);
    expect(noGuess.body.error.code).toBe('BAD_REQUEST');
    const badFlag = await dailyGuess(app, 'alice', 'slate', { hardMode: 'yes' });
    expect(badFlag.status).toBe(400);
    expect(badFlag.body.error).toEqual({ code: 'BAD_REQUEST', message: 'hardMode must be a boolean' });
    const arrayBody = await request(app).post('/api/daily/guess').set(as('alice')).send([TODAY, 'slate']);
    expect(arrayBody.status).toBe(400);
    const huge = await dailyGuess(app, 'alice', 'a'.repeat(1000));
    expect(huge.body.error.code).toBe('INVALID_GUESS');
  });

  it('wins, reveals the bird card and hint, records stats, then refuses more guesses', async () => {
    const { app } = makeTestApp();
    await playDaily(app, 'alice', ['slate', 'rhino']);
    const res = await dailyGuess(app, 'alice', 'robin');
    const { game, stats } = res.body as DailyGuessResponse;
    expect(game.status).toBe('won');
    expect(game.guesses).toHaveLength(3);
    expect(game.answer).toEqual({
      word: 'ROBIN',
      name: 'European robin',
      kind: 'bird',
      fact: ROBIN.fact,
      wikiUrl: 'https://en.wikipedia.org/wiki/European_robin',
    });
    expect(game.hint).toBe(ROBIN.hint);
    expect(game.hintAvailable).toBe(false);
    expect(stats).toMatchObject({ played: 1, wins: 1, currentStreak: 1, maxStreak: 1, distribution: [0, 0, 1, 0, 0, 0] });

    const again = await dailyGuess(app, 'alice', 'slate');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('GAME_OVER');

    const reload = await request(app).get('/api/daily').query({ date: TODAY }).set(as('alice'));
    expect((reload.body as GameResponse).game.answer?.word).toBe('ROBIN');
  });

  it('loses after six misses and reveals the answer', async () => {
    const { app } = makeTestApp();
    const game = await playDaily(app, 'alice', MISSES.slice(0, MAX_GUESSES - 1));
    expect(game.status).toBe('playing');
    const res = await dailyGuess(app, 'alice', MISSES[MAX_GUESSES - 1]!);
    const body = res.body as DailyGuessResponse;
    expect(body.game.status).toBe('lost');
    expect(body.game.answer?.word).toBe('ROBIN');
    expect(body.game.hint).toBe(ROBIN.hint);
    expect(body.stats).toMatchObject({ played: 1, wins: 0, currentStreak: 0, distribution: [0, 0, 0, 0, 0, 0] });
  });

  it('keeps each player’s game separate', async () => {
    const { app } = makeTestApp();
    await playDaily(app, 'alice', ['slate']);
    const bob = await request(app).get('/api/daily').query({ date: TODAY }).set(as('bob'));
    expect((bob.body as GameResponse).game.guesses).toEqual([]);
  });

  it('keeps a stored game’s answer even if the answer list changes later', async () => {
    const store = new MemoryStore();
    const game: GameRecord = {
      mode: 'daily',
      puzzleNumber: TODAY_PUZZLE,
      date: TODAY,
      answer: 'EGRET',
      guesses: [{ word: 'SLATE', result: ['absent', 'absent', 'absent', 'present', 'present'] }],
      status: 'playing',
      hardMode: false,
      hintUsed: false,
    };
    await store.saveDailyGame('alice', TODAY_PUZZLE, game);
    const { app } = makeTestApp({ store });
    const res = await dailyGuess(app, 'alice', 'egret');
    const body = res.body as DailyGuessResponse;
    expect(body.game.status).toBe('won');
    expect(body.game.answer).toMatchObject({ word: 'EGRET', name: 'Egret', fact: '' });
  });

  it('serializes concurrent guesses from the same player', async () => {
    // Slow reads widen the window in which a double-submit would read stale state.
    class SlowStore extends MemoryStore {
      override async getDailyGame(userId: string, puzzleNumber: number) {
        const game = await super.getDailyGame(userId, puzzleNumber);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return game;
      }
    }
    const store = new SlowStore();
    const games = new GameService({ store, puzzles: createPuzzles(fixtureCatalog(), 'seed'), random: Math.random });
    for (const miss of MISSES.slice(0, MAX_GUESSES - 1)) await games.guessDaily('alice', TODAY, miss, false);

    const results = await Promise.allSettled([
      games.guessDaily('alice', TODAY, 'cheat', false),
      games.guessDaily('alice', TODAY, 'cheat', false),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'GAME_OVER' });
    expect((await store.getStats('alice'))?.played).toBe(1);
    expect((await store.getDailyGame('alice', TODAY_PUZZLE))?.guesses).toHaveLength(MAX_GUESSES);
  });
});

describe('hard mode', () => {
  it('is fixed by the first guess and enforces revealed letters', async () => {
    const { app } = makeTestApp();
    const first = await dailyGuess(app, 'alice', 'rains', { hardMode: true });
    expect((first.body as DailyGuessResponse).game.hardMode).toBe(true);

    const moved = await dailyGuess(app, 'alice', 'slate', { hardMode: true });
    expect(moved.status).toBe(422);
    expect(moved.body).toEqual({ error: { code: 'HARD_MODE', message: '1st letter must be R' } });

    const missing = await dailyGuess(app, 'alice', 'rusty', { hardMode: true });
    expect(missing.body).toEqual({ error: { code: 'HARD_MODE', message: 'Guess must contain I' } });

    // Turning the flag off mid-game has no effect.
    const stillHard = await dailyGuess(app, 'alice', 'slate', { hardMode: false });
    expect(stillHard.body.error.code).toBe('HARD_MODE');

    const ok = await dailyGuess(app, 'alice', 'rhino', { hardMode: true });
    expect(ok.status).toBe(200);
    expect((ok.body as DailyGuessResponse).game.guesses).toHaveLength(2);
  });

  it('cannot be switched on after the first guess', async () => {
    const { app } = makeTestApp();
    await playDaily(app, 'alice', ['rains']);
    const res = await dailyGuess(app, 'alice', 'slate', { hardMode: true });
    expect(res.status).toBe(200);
    expect((res.body as DailyGuessResponse).game.hardMode).toBe(false);
  });
});

describe('POST /api/daily/hint', () => {
  it(`is unavailable before ${HINT_AFTER_GUESSES} guesses, then reveals the hint once`, async () => {
    const { app } = makeTestApp();
    const early = await request(app).post('/api/daily/hint').set(as('alice')).send({ date: TODAY });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('HINT_UNAVAILABLE');

    const afterTwo = await playDaily(app, 'alice', MISSES.slice(0, 2));
    expect(afterTwo.hintAvailable).toBe(false);
    const stillEarly = await request(app).post('/api/daily/hint').set(as('alice')).send({ date: TODAY });
    expect(stillEarly.body.error.code).toBe('HINT_UNAVAILABLE');
    expectNoSpoilers(stillEarly.text);

    const afterThree = await playDaily(app, 'alice', MISSES.slice(2, 3));
    expect(afterThree).toMatchObject({ hintAvailable: true, hintUsed: false, hint: null });

    const res = await request(app).post('/api/daily/hint').set(as('alice')).send({ date: TODAY });
    expect(res.status).toBe(200);
    const { game } = res.body as GameResponse;
    expect(game).toMatchObject({ hintUsed: true, hintAvailable: false, hint: ROBIN.hint, answer: null });
    expect(res.text).not.toContain(ROBIN.fact);

    const again = await request(app).post('/api/daily/hint').set(as('alice')).send({ date: TODAY });
    expect(again.status).toBe(200);
    const reload = await request(app).get('/api/daily').query({ date: TODAY }).set(as('alice'));
    expect((reload.body as GameResponse).game.hint).toBe(ROBIN.hint);
  });

  it('does not affect stats and is refused once the game is over', async () => {
    const { app } = makeTestApp();
    await playDaily(app, 'alice', MISSES.slice(0, 3));
    await request(app).post('/api/daily/hint').set(as('alice')).send({ date: TODAY });
    const win = await dailyGuess(app, 'alice', 'robin');
    const body = win.body as DailyGuessResponse;
    expect(body.game.hintUsed).toBe(true);
    expect(body.stats).toMatchObject({ played: 1, wins: 1, distribution: [0, 0, 0, 1, 0, 0] });
    const late = await request(app).post('/api/daily/hint').set(as('alice')).send({ date: TODAY });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('GAME_OVER');
  });
});
