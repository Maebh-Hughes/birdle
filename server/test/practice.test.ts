import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { GameResponse, MeResponse, PracticeGameResponse } from '@birdle/shared';
import { CATEGORY_BIRDS, HEDWIG, HOOH, KAKAPO, ROBIN, TALON, TODAY, as, fixtureCatalog, makeTestApp } from './helpers';

// The fixture birds sorted by word are KAKAPO, ROBIN, TALON; random() = 0 picks the first candidate.
const first = () => 0;

function practiceGuess(app: ReturnType<typeof makeTestApp>['app'], guess: string, hardMode = false) {
  return request(app).post('/api/practice/guess').set(as('alice')).send({ guess, hardMode });
}

describe('practice (Free Flight)', () => {
  it('has no game until one is started', async () => {
    const { app } = makeTestApp({ random: first });
    const res = await request(app).get('/api/practice').set(as('alice'));
    expect(res.status).toBe(200);
    expect(res.body as PracticeGameResponse).toEqual({ game: null });

    const guess = await practiceGuess(app, 'planet');
    expect(guess.status).toBe(404);
    expect(guess.body.error.code).toBe('NOT_FOUND');
    const hint = await request(app).post('/api/practice/hint').set(as('alice'));
    expect(hint.body.error.code).toBe('NOT_FOUND');
  });

  it('draws from all birds, including practice-only ones, without revealing the answer', async () => {
    const { app } = makeTestApp({ random: first });
    const res = await request(app).post('/api/practice/new').set(as('alice'));
    expect(res.status).toBe(200);
    const { game } = res.body as GameResponse;
    expect(game).toMatchObject({ mode: 'practice', puzzleNumber: null, date: null, category: 'all', wordLength: 6, answer: null, hint: null });
    expect(res.text.toLowerCase()).not.toContain('kakapo');
    expect(res.text).not.toContain(KAKAPO.hint);
    expect(res.text).not.toContain(KAKAPO.fact);
  });

  it('plays to a win with the bird card, and never touches daily stats', async () => {
    const { app } = makeTestApp({ random: first });
    await request(app).post('/api/practice/new').set(as('alice'));
    expect((await practiceGuess(app, 'planet')).status).toBe(200);
    const win = await practiceGuess(app, 'kakapo');
    const { game } = win.body as GameResponse;
    expect(game.status).toBe('won');
    expect(game.answer).toEqual({
      word: 'KAKAPO',
      name: 'Kakapo',
      kind: 'bird',
      source: null,
      fact: KAKAPO.fact,
      infoUrl: 'https://en.wikipedia.org/wiki/Kakapo',
      infoSite: 'Wikipedia',
    });
    expect(win.body).not.toHaveProperty('stats');

    const me = await request(app).get('/api/me').set(as('alice'));
    expect((me.body as MeResponse).stats).toMatchObject({ played: 0, wins: 0, currentStreak: 0 });

    const over = await practiceGuess(app, 'garden');
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('GAME_OVER');
  });

  it('applies the same guess rules and hint gating as daily games', async () => {
    const { app } = makeTestApp({ random: first });
    await request(app).post('/api/practice/new').set(as('alice'));
    expect((await practiceGuess(app, 'slate')).body.error.code).toBe('INVALID_GUESS');
    expect((await practiceGuess(app, 'zzzzzz')).body.error.code).toBe('NOT_IN_WORD_LIST');
    const early = await request(app).post('/api/practice/hint').set(as('alice'));
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('HINT_UNAVAILABLE');

    for (const word of ['planet', 'garden', 'planet']) await practiceGuess(app, word);
    const hint = await request(app).post('/api/practice/hint').set(as('alice'));
    expect((hint.body as GameResponse).game).toMatchObject({ hintUsed: true, hint: KAKAPO.hint, answer: null });
  });

  it('replaces the current game with a different bird when a new one starts', async () => {
    const { app } = makeTestApp({ random: first });
    await request(app).post('/api/practice/new').set(as('alice'));
    await practiceGuess(app, 'planet');
    const next = await request(app).post('/api/practice/new').set(as('alice'));
    const { game } = next.body as GameResponse;
    expect(game.guesses).toEqual([]);
    expect(game.wordLength).toBe(5); // ROBIN: the previous answer is skipped
    const current = await request(app).get('/api/practice').set(as('alice'));
    expect((current.body as PracticeGameResponse).game?.guesses).toEqual([]);
  });

  it('does not appear in the Flock or affect the daily game', async () => {
    const { app } = makeTestApp({ random: first });
    await request(app).post('/api/instances/i-1/join').set(as('alice')).send({ date: TODAY });
    await request(app).post('/api/practice/new').set(as('alice'));
    await practiceGuess(app, 'planet');
    const flock = await request(app).get('/api/instances/i-1/flock').query({ date: TODAY }).set(as('alice'));
    expect(flock.body.players[0]).toMatchObject({ id: 'alice', status: 'idle', rows: [] });
    const daily = await request(app).get('/api/daily').query({ date: TODAY }).set(as('alice'));
    expect((daily.body as GameResponse).game.guesses).toEqual([]);
  });
});

describe('Free Flight categories', () => {
  type TestApp = ReturnType<typeof makeTestApp>;
  const withCategories = (random: () => number = first) => makeTestApp({ random, words: fixtureCatalog(CATEGORY_BIRDS) });
  const newGame = (app: TestApp['app'], body?: object) => {
    const req = request(app).post('/api/practice/new').set(as('alice'));
    return body === undefined ? req : req.send(body);
  };
  /** The stored answer (the API never shows it before the game ends). */
  const storedAnswer = async (store: TestApp['store']) => (await store.getPracticeGame('alice'))?.answer;

  it.each([
    ['all', [HEDWIG, HOOH, KAKAPO, ROBIN, TALON]],
    ['birds', [KAKAPO, ROBIN, TALON]],
    ['pokemon', [HOOH]],
    ['fiction', [HEDWIG]],
  ] as const)('draws "%s" answers from its kinds only', async (category, entries) => {
    const seen = new Set<string>();
    for (const r of [0, 0.21, 0.41, 0.61, 0.81, 0.99]) {
      const { app, store } = withCategories(() => r);
      const res = await newGame(app, { category });
      expect(res.status).toBe(200);
      expect((res.body as GameResponse).game).toMatchObject({ mode: 'practice', category, answer: null, hint: null });
      seen.add((await storedAnswer(store))!);
    }
    expect([...seen].sort()).toEqual(entries.map((entry) => entry.word).sort());
  });

  it('keeps the category of the current game when it is loaded again', async () => {
    const { app } = withCategories();
    await newGame(app, { category: 'pokemon' });
    const current = await request(app).get('/api/practice').set(as('alice'));
    expect((current.body as PracticeGameResponse).game).toMatchObject({ category: 'pokemon', wordLength: 4 });
  });

  it('reveals a fictional bird with its source and linked site', async () => {
    const { app } = withCategories();
    await newGame(app, { category: 'pokemon' });
    const win = await request(app).post('/api/practice/guess').set(as('alice')).send({ guess: 'hooh' });
    const { game } = win.body as GameResponse;
    expect(game.status).toBe('won');
    expect(game.answer).toEqual({
      word: 'HOOH',
      name: 'Ho-Oh',
      kind: 'pokemon',
      source: 'Pokémon Gold & Silver',
      fact: HOOH.fact,
      infoUrl: HOOH.link,
      infoSite: 'Bulbapedia',
    });
  });

  it("defaults to 'all' for a missing body, an empty body or a missing category", async () => {
    for (const body of [undefined, {}, { other: true }]) {
      const { app } = withCategories();
      const res = await newGame(app, body);
      expect(res.status).toBe(200);
      expect((res.body as GameResponse).game.category).toBe('all');
    }
  });

  it.each([['movies'], ['ALL'], [''], [null], [3], [['birds']]])('rejects category %j with 400 BAD_REQUEST', async (category) => {
    const { app } = withCategories();
    await newGame(app, { category: 'birds' });
    const res = await newGame(app, { category });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'category must be one of all, birds, pokemon, fiction' } });
    // The current game is untouched.
    const current = await request(app).get('/api/practice').set(as('alice'));
    expect((current.body as PracticeGameResponse).game?.category).toBe('birds');
  });

  it.each([
    ['pokemon', 'There are no bird Pokémon in Free Flight yet. Pick another category.'],
    ['fiction', 'There are no video game or book birds in Free Flight yet. Pick another category.'],
  ] as const)('answers an empty "%s" category with a clear 400 and keeps the current game', async (category, message) => {
    const { app } = makeTestApp({ random: first }); // real birds only
    await newGame(app, { category: 'birds' });
    const res = await newGame(app, { category });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message } });
    const current = await request(app).get('/api/practice').set(as('alice'));
    expect((current.body as PracticeGameResponse).game?.category).toBe('birds');
  });

  it('avoids the previous answer within the category', async () => {
    const { app, store } = withCategories();
    const answers: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      await newGame(app, { category: 'birds' });
      answers.push(await storedAnswer(store));
    }
    expect(answers).toEqual(['KAKAPO', 'ROBIN', 'KAKAPO', 'ROBIN']); // random() = 0: first of the others
    expect(TALON.kind).toBe('term');
  });
});
