// Daily answers are pinned in the store the first time a puzzle is served, so
// editing birds.json (which reshuffles the computed order) never changes a puzzle
// that players have already seen, even across a restart.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, type DailyGuessResponse, type GameResponse } from '@birdle/shared';
import { createPuzzles } from '../src/puzzle';
import { JsonFileStore, MemoryStore } from '../src/store';
import { RecordingLogger, TODAY, TODAY_PUZZLE, as, bird, dailyGuess, fixtureCatalog, makeTestApp } from './helpers';

// Two word lists whose only daily-eligible entries differ: before and after an edit of birds.json.
const BEFORE = fixtureCatalog([bird('ROBIN', { hint: 'Red-breasted garden songbird', fact: 'Sings at night.' })], ['slate', 'crane']);
const AFTER = fixtureCatalog([bird('CRANE', { hint: 'Tall wading bird', fact: 'Dances.' })], ['slate', 'robin']);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'birdle-pins-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const getDaily = (app: ReturnType<typeof makeTestApp>['app'], user: string, date = TODAY) =>
  request(app).get('/api/daily').query({ date }).set(as(user));

describe('pinned daily answers', () => {
  it('pins the answer the first time a puzzle is served, before anyone guesses', async () => {
    const { app, store } = makeTestApp({ words: BEFORE });
    expect(await store.getDailyAnswer(TODAY_PUZZLE)).toBeUndefined();
    const res = await getDaily(app, 'alice');
    expect((res.body as GameResponse).game.wordLength).toBe(5);
    expect(await store.getDailyAnswer(TODAY_PUZZLE)).toBe('ROBIN');
    // Nothing leaks: the pin is server-side only.
    expect(res.text.toLowerCase()).not.toContain('robin');
  });

  it('survives a restart with a different bird list', async () => {
    const path = join(dir, 'db.json');
    const first = await JsonFileStore.open(path, { logger: new RecordingLogger() });
    const before = makeTestApp({ store: first, words: BEFORE });
    await getDaily(before.app, 'alice'); // served (and pinned) before the edit
    await first.flush();

    // Restart with the edited list, whose computed answer for today is CRANE.
    expect(createPuzzles(AFTER, 'test-seed').dailyAnswer(TODAY_PUZZLE)).toBe('CRANE');
    const second = await JsonFileStore.open(path, { logger: new RecordingLogger() });
    const after = makeTestApp({ store: second, words: AFTER });

    // A player who had not started yet still gets ROBIN, which is no longer in the list.
    const bob = await getDaily(after.app, 'bob');
    expect((bob.body as GameResponse).game.wordLength).toBe(5);
    const win = await dailyGuess(after.app, 'bob', 'robin');
    expect(win.status).toBe(200);
    expect((win.body as DailyGuessResponse).game.status).toBe('won');

    // Tomorrow was never served, so it follows the current list.
    const tomorrow = addDays(TODAY, 1);
    const next = await getDaily(after.app, 'bob', tomorrow);
    expect(next.status).toBe(200);
    expect(await second.getDailyAnswer(TODAY_PUZZLE + 1)).toBe('CRANE');
  });

  it('plays a pinned word that left the list: evaluated normally, no hint, minimal bird card', async () => {
    const store = new MemoryStore();
    await store.pinDailyAnswer(TODAY_PUZZLE, 'EGRET');
    const { app } = makeTestApp({ store, words: BEFORE }); // has no EGRET

    const fresh = await getDaily(app, 'alice');
    expect((fresh.body as GameResponse).game).toMatchObject({ wordLength: 5, hint: null, answer: null });

    const miss = await dailyGuess(app, 'alice', 'slate');
    expect((miss.body as DailyGuessResponse).game.guesses[0]?.result).toEqual(['absent', 'absent', 'absent', 'present', 'present']);
    await dailyGuess(app, 'alice', 'crane');
    const third = await dailyGuess(app, 'alice', 'robin');
    // Three guesses would unlock a hint, but there is none for this word.
    expect((third.body as DailyGuessResponse).game.hintAvailable).toBe(false);
    const hint = await request(app).post('/api/daily/hint').set(as('alice')).send({ date: TODAY });
    expect(hint.status).toBe(422);
    expect(hint.body.error).toEqual({ code: 'HINT_UNAVAILABLE', message: 'No hint for this bird' });

    // The pinned word is accepted as a guess even though no list contains it.
    const win = await dailyGuess(app, 'alice', 'egret');
    const { game, stats } = win.body as DailyGuessResponse;
    expect(game.status).toBe('won');
    expect(game.answer).toEqual({
      word: 'EGRET',
      name: 'Egret',
      kind: 'bird',
      source: null,
      fact: '',
      infoUrl: 'https://en.wikipedia.org/wiki/Special:Search?search=Egret',
      infoSite: 'Wikipedia',
    });
    expect(game.hint).toBeNull();
    expect(stats).toMatchObject({ played: 1, wins: 1 });
  });

  it('gives every player of a puzzle the same answer when several are served at once', async () => {
    const { app, store } = makeTestApp({ words: BEFORE });
    const responses = await Promise.all(['a', 'b', 'c', 'd'].map((user) => getDaily(app, user)));
    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(await store.getDailyAnswer(TODAY_PUZZLE)).toBe('ROBIN');
  });

  it('keeps a game in progress on its own answer, even if the pin differs', async () => {
    const store = new MemoryStore();
    await store.saveDailyGame('alice', TODAY_PUZZLE, {
      mode: 'daily',
      puzzleNumber: TODAY_PUZZLE,
      date: TODAY,
      category: null,
      answer: 'CRANE',
      guesses: [],
      status: 'playing',
      hardMode: false,
      hintUsed: false,
    });
    await store.pinDailyAnswer(TODAY_PUZZLE, 'ROBIN');
    const { app } = makeTestApp({ store, words: BEFORE });
    expect(((await dailyGuess(app, 'alice', 'crane')).body as DailyGuessResponse).game.status).toBe('won');
    expect(((await dailyGuess(app, 'bob', 'robin')).body as DailyGuessResponse).game.status).toBe('won');
  });
});
