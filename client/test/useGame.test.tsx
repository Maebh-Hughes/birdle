import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../src/api';
import { NETWORK_MESSAGE, UNKNOWN_MESSAGE } from '../src/game/errors';
import { useGame, type UseGameOptions } from '../src/game/useGame';
import { makeGame, makeStats, row } from './fixtures';
import type { GameView, PracticeCategory } from '@birdle/shared';

const TODAY = '2026-10-02';

function fakeApi(overrides: Partial<Api> = {}): Api {
  const game = makeGame({ date: TODAY });
  const unexpected = (name: string) => vi.fn(() => Promise.reject(new Error(`unexpected ${name}`)));
  return {
    me: unexpected('me'),
    daily: vi.fn(() => Promise.resolve({ game })),
    dailyGuess: unexpected('dailyGuess'),
    dailyHint: unexpected('dailyHint'),
    practice: vi.fn(() => Promise.resolve({ game: null })),
    practiceNew: vi.fn((category: PracticeCategory) => Promise.resolve({ game: practiceGame({ category, wordLength: 7 }) })),
    practiceGuess: unexpected('practiceGuess'),
    practiceHint: unexpected('practiceHint'),
    joinInstance: unexpected('joinInstance'),
    flock: unexpected('flock'),
    ...overrides,
  };
}

function practiceGame(patch: Partial<GameView> = {}): GameView {
  return makeGame({ mode: 'practice', puzzleNumber: null, date: null, ...patch });
}

function setup(api: Api, options: Partial<UseGameOptions> = {}) {
  return renderHook(() =>
    useGame({
      api,
      initialStats: makeStats(),
      hardMode: false,
      reducedMotion: true,
      today: () => TODAY,
      ...options,
    }),
  );
}

async function ready(result: { current: ReturnType<typeof useGame> }) {
  await waitFor(() => expect(result.current.game).not.toBeNull());
}

function typeWord(result: { current: ReturnType<typeof useGame> }, word: string) {
  act(() => {
    for (const letter of word) result.current.pressKey(letter);
  });
}

describe('useGame', () => {
  it("loads today's daily game on mount", async () => {
    const api = fakeApi();
    const { result } = setup(api);
    await ready(result);
    expect(api.daily).toHaveBeenCalledWith(TODAY, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result.current.state.mode).toBe('daily');
  });

  it('sends one request however often Enter is pressed while a guess is pending', async () => {
    let resolve: (value: { game: GameView; stats: ReturnType<typeof makeStats> }) => void = () => undefined;
    const dailyGuess = vi.fn(() => new Promise<{ game: GameView; stats: ReturnType<typeof makeStats> }>((r) => (resolve = r)));
    const api = fakeApi({ dailyGuess });
    const { result } = setup(api, { hardMode: true });
    await ready(result);

    typeWord(result, 'STORK');
    act(() => {
      result.current.pressKey('ENTER');
      result.current.pressKey('ENTER');
    });
    act(() => result.current.pressKey('ENTER'));

    await waitFor(() => expect(dailyGuess).toHaveBeenCalledTimes(1));
    expect(dailyGuess).toHaveBeenCalledWith({ date: TODAY, guess: 'STORK', hardMode: true });
    expect(result.current.state.pending).not.toBeNull();

    await act(async () => {
      resolve({ game: makeGame({ date: TODAY, guesses: [row('STORK', 'CRANE')] }), stats: makeStats() });
    });
    await waitFor(() => expect(result.current.state.pending).toBeNull());
    expect(result.current.game?.guesses).toHaveLength(1);
    expect(dailyGuess).toHaveBeenCalledTimes(1);
  });

  it('maps NOT_IN_WORD_LIST to a toast and keeps the letters', async () => {
    const api = fakeApi({
      dailyGuess: vi.fn(() => Promise.reject(new ApiError('NOT_IN_WORD_LIST', 'nope', 422))),
    });
    const { result } = setup(api);
    await ready(result);
    typeWord(result, 'XYZZY');
    act(() => result.current.pressKey('ENTER'));

    await waitFor(() => expect(result.current.state.toasts.map((t) => t.message)).toContain('Not in word list'));
    expect(result.current.state.current).toBe('XYZZY');
    expect(result.current.state.shake).not.toBeNull();
  });

  it("uses the server's hard-mode message", async () => {
    const api = fakeApi({
      dailyGuess: vi.fn(() => Promise.reject(new ApiError('HARD_MODE', '2nd letter must be R', 422))),
    });
    const { result } = setup(api);
    await ready(result);
    typeWord(result, 'STORK');
    act(() => result.current.pressKey('ENTER'));
    await waitFor(() => expect(result.current.state.toasts.at(-1)?.message).toBe('2nd letter must be R'));
  });

  it('reports network failures without shaking', async () => {
    const api = fakeApi({ dailyGuess: vi.fn(() => Promise.reject(new ApiError('NETWORK', 'Failed to fetch'))) });
    const { result } = setup(api);
    await ready(result);
    typeWord(result, 'STORK');
    act(() => result.current.pressKey('ENTER'));
    await waitFor(() => expect(result.current.state.toasts.at(-1)?.message).toBe(NETWORK_MESSAGE));
    expect(result.current.state.shake).toBeNull();
  });

  it('reloads the game when the server says it is already over', async () => {
    const api = fakeApi({ dailyGuess: vi.fn(() => Promise.reject(new ApiError('GAME_OVER', 'over', 409))) });
    const { result } = setup(api);
    await ready(result);
    const loads = vi.mocked(api.daily).mock.calls.length;
    typeWord(result, 'STORK');
    act(() => result.current.pressKey('ENTER'));
    await waitFor(() => expect(vi.mocked(api.daily).mock.calls.length).toBeGreaterThan(loads));
  });

  it('reloads Free Flight when the server has a different game (replaced in another tab)', async () => {
    const api = fakeApi({ practiceGuess: vi.fn(() => Promise.reject(new ApiError('INVALID_GUESS', 'Too many letters', 422))) });
    const { result } = setup(api);
    await ready(result);
    act(() => result.current.setMode('practice'));
    await waitFor(() => expect(result.current.game?.mode).toBe('practice'));
    const loads = vi.mocked(api.practice).mock.calls.length;
    typeWord(result, 'PELICAN');
    act(() => result.current.pressKey('ENTER'));
    await waitFor(() => expect(result.current.state.toasts.at(-1)?.message).toBe('Too many letters'));
    await waitFor(() => expect(vi.mocked(api.practice).mock.calls.length).toBeGreaterThan(loads));
  });

  it('calls onGameOver once the winning reveal is done', async () => {
    const won = makeGame({ date: TODAY, status: 'won', guesses: [row('CRANE', 'CRANE')] });
    const api = fakeApi({ dailyGuess: vi.fn(() => Promise.resolve({ game: won, stats: makeStats({ wins: 1 }) })) });
    const onGameOver = vi.fn();
    const onDailyGuess = vi.fn();
    const { result } = setup(api, { onGameOver, onDailyGuess });
    await ready(result);
    typeWord(result, 'CRANE');
    act(() => result.current.pressKey('ENTER'));

    await waitFor(() => expect(onGameOver).toHaveBeenCalledWith(won), { timeout: 2000 });
    expect(onDailyGuess).toHaveBeenCalledTimes(1);
    expect(result.current.state.stats.wins).toBe(1);
    expect(result.current.state.toasts.some((t) => t.message === 'Eagle-eyed!')).toBe(true);
  });

  it('does not report a finished game once the player has moved to another one', async () => {
    const won = makeGame({ date: TODAY, status: 'won', guesses: [row('CRANE', 'CRANE')] });
    const api = fakeApi({ dailyGuess: vi.fn(() => Promise.resolve({ game: won, stats: makeStats({ wins: 1 }) })) });
    const onGameOver = vi.fn();
    const { result } = setup(api, { onGameOver });
    await ready(result);
    typeWord(result, 'CRANE');
    act(() => result.current.pressKey('ENTER'));
    await waitFor(() => expect(result.current.state.finished).toBe(1));

    // Straight to Free Flight during the celebration: the daily's card must not pop up there.
    act(() => result.current.setMode('practice'));
    await waitFor(() => expect(result.current.game?.mode).toBe('practice'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(onGameOver).not.toHaveBeenCalled();
  });

  it('waits for a guess in flight before moving to a new day', async () => {
    let today = TODAY;
    const started = makeGame({ date: TODAY, guesses: [row('STORK', 'CRANE')] });
    let answer: (value: { game: GameView; stats: ReturnType<typeof makeStats> }) => void = () => undefined;
    const api = fakeApi({
      daily: vi.fn((date: string) => Promise.resolve({ game: date === TODAY ? started : makeGame({ date, puzzleNumber: 8 }) })),
      dailyGuess: vi.fn(() => new Promise<{ game: GameView; stats: ReturnType<typeof makeStats> }>((resolve) => (answer = resolve))),
    });
    const { result } = setup(api, { today: () => today });
    await ready(result);

    today = '2026-10-03';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.newDayAvailable).toBe(true);

    typeWord(result, 'CRAKE');
    act(() => result.current.pressKey('ENTER'));
    await waitFor(() => expect(api.dailyGuess).toHaveBeenCalled());
    act(() => result.current.startNewDay());
    expect(result.current.state.dailyDate).toBe(TODAY);

    await act(async () => {
      answer({ game: makeGame({ date: TODAY, guesses: [...started.guesses, row('CRAKE', 'CRANE')] }), stats: makeStats() });
    });
    expect(result.current.game?.guesses).toHaveLength(2);

    act(() => result.current.startNewDay());
    await waitFor(() => expect(result.current.game?.puzzleNumber).toBe(8));
    expect(result.current.state.dailyDate).toBe('2026-10-03');
    expect(api.daily).toHaveBeenLastCalledWith('2026-10-03', expect.anything());
  });

  it('after a guess that may have reached the server, reloads before anything is sent again', async () => {
    let loads = 0;
    let finishReload: (value: { game: GameView }) => void = () => undefined;
    const api = fakeApi({
      daily: vi.fn(() => {
        loads++;
        if (loads === 1) return Promise.resolve({ game: makeGame({ date: TODAY }) });
        return new Promise<{ game: GameView }>((resolve) => (finishReload = resolve));
      }),
      dailyGuess: vi.fn(() => Promise.reject(new ApiError('NETWORK', 'Failed to fetch'))),
    });
    const { result } = setup(api);
    await ready(result);
    typeWord(result, 'STORK');
    act(() => result.current.pressKey('ENTER'));
    await waitFor(() => expect(loads).toBe(2));
    expect(result.current.state.current).toBe('STORK');

    act(() => result.current.pressKey('ENTER'));
    expect(api.dailyGuess).toHaveBeenCalledTimes(1);

    // The server had counted it after all.
    await act(async () => finishReload({ game: makeGame({ date: TODAY, guesses: [row('STORK', 'CRANE')] }) }));
    expect(result.current.game?.guesses).toHaveLength(1);
    expect(result.current.state.current).toBe('');
    expect(result.current.state.resync).toBeNull();
  });

  it('keeps a Free Flight game when the date changes', async () => {
    let today = TODAY;
    const api = fakeApi();
    const { result } = setup(api, { today: () => today });
    await ready(result);
    act(() => result.current.setMode('practice'));
    await waitFor(() => expect(result.current.game?.mode).toBe('practice'));
    const practiceLoads = vi.mocked(api.practice).mock.calls.length;

    today = '2026-10-03';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(result.current.state.dailyDate).toBe('2026-10-03'));
    expect(vi.mocked(api.practice).mock.calls.length).toBe(practiceLoads);
    expect(api.practiceNew).toHaveBeenCalledTimes(1);
  });

  it('Free Flight starts a new practice game when there is none to resume', async () => {
    const api = fakeApi();
    const { result } = setup(api);
    await ready(result);
    act(() => result.current.setMode('practice'));
    await waitFor(() => expect(result.current.game?.mode).toBe('practice'));
    expect(api.practice).toHaveBeenCalled();
    expect(api.practiceNew).toHaveBeenCalledTimes(1);
    expect(api.practiceNew).toHaveBeenCalledWith('all', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result.current.game?.wordLength).toBe(7);
  });
});

describe('useGame Free Flight categories', () => {
  /** Renders useGame in Free Flight with a category that can be changed later. */
  function setupPractice(api: Api, category: PracticeCategory) {
    const hook = renderHook(
      ({ practiceCategory }: { practiceCategory: PracticeCategory }) =>
        useGame({ api, initialStats: makeStats(), hardMode: false, reducedMotion: true, today: () => TODAY, practiceCategory }),
      { initialProps: { practiceCategory: category } },
    );
    act(() => hook.result.current.setMode('practice'));
    return hook;
  }

  const inPractice = async (result: { current: ReturnType<typeof useGame> }) => {
    await waitFor(() => expect(result.current.game?.mode).toBe('practice'));
    await waitFor(() => expect(result.current.state.loading).toBe(false));
  };

  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

  it('starts new rounds in the chosen category', async () => {
    const api = fakeApi();
    const { result } = setupPractice(api, 'birds');
    await inPractice(result);
    expect(api.practiceNew).toHaveBeenCalledTimes(1);
    expect(api.practiceNew).toHaveBeenCalledWith('birds', expect.anything());
    expect(result.current.game?.category).toBe('birds');

    await act(() => result.current.newPracticeGame());
    expect(api.practiceNew).toHaveBeenCalledTimes(2);
    expect(api.practiceNew).toHaveBeenLastCalledWith('birds', undefined);
  });

  it('resumes an untouched round of the chosen category instead of replacing it', async () => {
    const api = fakeApi({ practice: vi.fn(() => Promise.resolve({ game: practiceGame({ category: 'pokemon', wordLength: 6 }) })) });
    const { result } = setupPractice(api, 'pokemon');
    await inPractice(result);
    expect(result.current.game?.wordLength).toBe(6);
    expect(api.practiceNew).not.toHaveBeenCalled();
  });

  it('replaces an untouched round of another category on entry, but resumes one under way', async () => {
    const untouched = fakeApi({ practice: vi.fn(() => Promise.resolve({ game: practiceGame({ category: 'all', wordLength: 6 }) })) });
    const first = setupPractice(untouched, 'birds');
    await inPractice(first.result);
    expect(untouched.practiceNew).toHaveBeenCalledTimes(1);
    expect(untouched.practiceNew).toHaveBeenCalledWith('birds', expect.anything());
    expect(first.result.current.game?.category).toBe('birds');
    first.unmount();

    const started = practiceGame({ category: 'all', wordLength: 5, guesses: [row('STORK', 'CRANE')] });
    const underway = fakeApi({ practice: vi.fn(() => Promise.resolve({ game: started })) });
    const second = setupPractice(underway, 'birds');
    await inPractice(second.result);
    expect(second.result.current.game).toEqual(started);
    expect(underway.practiceNew).not.toHaveBeenCalled();
  });

  it('swaps an untouched round as soon as another category is chosen', async () => {
    const api = fakeApi();
    const { result, rerender } = setupPractice(api, 'all');
    await inPractice(result);
    act(() => result.current.pressKey('O'));

    rerender({ practiceCategory: 'birds' });
    await waitFor(() => expect(result.current.game?.category).toBe('birds'));
    expect(api.practiceNew).toHaveBeenCalledTimes(2);
    expect(api.practiceNew).toHaveBeenLastCalledWith('birds', undefined);
    expect(result.current.state.current).toBe('');
  });

  it('keeps a round under way when the category changes; the next bird comes from the new one', async () => {
    const started = practiceGame({ category: 'all', guesses: [row('STORK', 'CRANE')] });
    const api = fakeApi({ practice: vi.fn(() => Promise.resolve({ game: started })) });
    const { result, rerender } = setupPractice(api, 'all');
    await inPractice(result);

    rerender({ practiceCategory: 'birds' });
    await settle();
    expect(api.practiceNew).not.toHaveBeenCalled();
    expect(result.current.game).toEqual(started);

    await act(() => result.current.newPracticeGame());
    expect(api.practiceNew).toHaveBeenCalledWith('birds', undefined);
    expect(result.current.game?.category).toBe('birds');
  });

  it("shows the server's reason when a category can't start, and doesn't retry it by itself", async () => {
    const reason = 'There are no bird Pokémon in Free Flight yet. Pick another category.';
    const practiceNew = vi.fn((category: PracticeCategory) =>
      category === 'pokemon'
        ? Promise.reject(new ApiError('BAD_REQUEST', reason, 400))
        : Promise.resolve({ game: practiceGame({ category }) }),
    );
    const api = fakeApi({ practiceNew });
    const { result, rerender } = setupPractice(api, 'pokemon');
    await waitFor(() => expect(result.current.state.loadError).toBe(reason));
    await settle();
    expect(practiceNew).toHaveBeenCalledTimes(1);

    // Picking another category starts a round in it.
    rerender({ practiceCategory: 'birds' });
    await waitFor(() => expect(result.current.game?.category).toBe('birds'));
    expect(result.current.state.loadError).toBeNull();

    // Back to the empty one: the untouched round stays, and the reason shows as a toast.
    rerender({ practiceCategory: 'pokemon' });
    await waitFor(() => expect(result.current.state.toasts.at(-1)?.message).toBe(reason));
    await settle();
    expect(practiceNew).toHaveBeenCalledTimes(3);
    expect(result.current.game?.category).toBe('birds');
  });

  it('never starts a round by itself when only reading the saved one failed; Try again resumes it', async () => {
    const saved = practiceGame({ guesses: [row('STORK', 'CRANE'), row('HERON', 'CRANE'), row('EGRET', 'CRANE')] });
    let readFails = true;
    const practice = vi.fn(() =>
      readFails ? Promise.reject(new ApiError('UNKNOWN', 'HTTP 502', 502)) : Promise.resolve({ game: saved }),
    );
    const api = fakeApi({ practice });
    const { result, rerender } = setupPractice(api, 'all');
    await waitFor(() => expect(result.current.state.loadError).toBe(UNKNOWN_MESSAGE));
    await settle();
    expect(api.practiceNew).not.toHaveBeenCalled();

    // Not even for a newly chosen category: the server may hold a round under way.
    rerender({ practiceCategory: 'birds' });
    await settle();
    expect(api.practiceNew).not.toHaveBeenCalled();

    readFails = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.game).toEqual(saved));
    expect(api.practiceNew).not.toHaveBeenCalled();
  });

  it('does not swap a round kept from earlier in the session when reading the saved one fails', async () => {
    let readFails = false;
    const kept = practiceGame({ wordLength: 6 });
    const practice = vi.fn(() =>
      readFails ? Promise.reject(new ApiError('NETWORK', 'Failed to fetch')) : Promise.resolve({ game: kept }),
    );
    const api = fakeApi({ practice });
    const { result, rerender } = setupPractice(api, 'all');
    await inPractice(result);

    // Another category is chosen elsewhere (the bird card); back in Free Flight the read fails.
    act(() => result.current.setMode('daily'));
    readFails = true;
    rerender({ practiceCategory: 'birds' });
    act(() => result.current.setMode('practice'));
    await waitFor(() => expect(result.current.state.toasts.at(-1)?.message).toBe(NETWORK_MESSAGE));
    await settle();
    expect(api.practiceNew).not.toHaveBeenCalled();
    expect(result.current.game?.category).toBe('all');
  });

  it('waits for the reload after a first guess that may have been counted before following a new category', async () => {
    let server = practiceGame({ category: 'all', wordLength: 5 });
    let failGuess: (error: unknown) => void = () => undefined;
    const api = fakeApi({
      practice: vi.fn(() => Promise.resolve({ game: server })),
      practiceGuess: vi.fn(() => {
        // The server counts the guess, but its answer never arrives.
        server = { ...server, guesses: [row('STORK', 'CRANE')] };
        return new Promise<{ game: GameView }>((_, reject) => (failGuess = reject));
      }),
    });
    const { result, rerender } = setupPractice(api, 'all');
    await inPractice(result);
    typeWord(result, 'STORK');
    act(() => result.current.pressKey('ENTER'));
    await waitFor(() => expect(api.practiceGuess).toHaveBeenCalled());

    rerender({ practiceCategory: 'birds' });
    await act(async () => failGuess(new ApiError('NETWORK', 'Failed to fetch')));
    await waitFor(() => expect(result.current.game?.guesses).toHaveLength(1));
    await settle();
    expect(api.practiceNew).not.toHaveBeenCalled();
    expect(result.current.game?.category).toBe('all');
    expect(result.current.state.resync).toBeNull();
  });

  it('reloads, rather than follows a new category, when a first guess finds the round replaced elsewhere', async () => {
    const elsewhere = practiceGame({ category: 'all', wordLength: 6, guesses: [row('PUFFIN', 'TOUCAN')] });
    let server = practiceGame({ category: 'all', wordLength: 5 });
    let failGuess: (error: unknown) => void = () => undefined;
    const api = fakeApi({
      practice: vi.fn(() => Promise.resolve({ game: server })),
      practiceGuess: vi.fn(() => {
        // Another tab starts (and plays) a round of another length meanwhile.
        server = elsewhere;
        return new Promise<{ game: GameView }>((_, reject) => (failGuess = reject));
      }),
    });
    const { result, rerender } = setupPractice(api, 'all');
    await inPractice(result);
    typeWord(result, 'STORK');
    act(() => result.current.pressKey('ENTER'));
    await waitFor(() => expect(api.practiceGuess).toHaveBeenCalled());

    rerender({ practiceCategory: 'birds' });
    await act(async () => failGuess(new ApiError('INVALID_GUESS', 'Too few letters', 422)));
    await waitFor(() => expect(result.current.game).toEqual(elsewhere));
    await settle();
    expect(api.practiceNew).not.toHaveBeenCalled();
  });

  it("offers a retry when an untouched round can't switch category, but doesn't retry by itself", async () => {
    let offline = true;
    const practiceNew = vi.fn((category: PracticeCategory) =>
      offline
        ? Promise.reject(new ApiError('NETWORK', 'Failed to fetch'))
        : Promise.resolve({ game: practiceGame({ category, wordLength: 7 }) }),
    );
    const untouched = practiceGame({ category: 'all', wordLength: 6 });
    const api = fakeApi({ practice: vi.fn(() => Promise.resolve({ game: untouched })), practiceNew });
    const { result, rerender } = setupPractice(api, 'all');
    await inPractice(result);
    expect(result.current.categorySwitchFailed).toBe(false);

    rerender({ practiceCategory: 'birds' });
    await waitFor(() => expect(result.current.state.toasts.at(-1)?.message).toBe(NETWORK_MESSAGE));
    await settle();
    expect(practiceNew).toHaveBeenCalledTimes(1);
    expect(result.current.game?.category).toBe('all');
    expect(result.current.categorySwitchFailed).toBe(true);

    offline = false;
    await act(() => result.current.newPracticeGame());
    expect(practiceNew).toHaveBeenLastCalledWith('birds', undefined);
    expect(result.current.game?.category).toBe('birds');
    expect(result.current.categorySwitchFailed).toBe(false);
  });

  it('does not loop when rounds come back without a category (an older server)', async () => {
    const legacy = () => ({ ...practiceGame(), category: undefined }) as unknown as GameView;
    const api = fakeApi({ practiceNew: vi.fn(() => Promise.resolve({ game: legacy() })) });
    const { result } = setupPractice(api, 'birds');
    await inPractice(result);
    await settle();
    expect(api.practiceNew).toHaveBeenCalledTimes(1);
  });
});

describe('useGame at local midnight', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks again when the midnight timer fires early (the clock was stepped back)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 23, 0, 0));
    const api = fakeApi({ daily: vi.fn((date: string) => Promise.resolve({ game: makeGame({ date }) })) });
    const { result } = renderHook(() => useGame({ api, initialStats: makeStats(), hardMode: false, reducedMotion: true }));
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(result.current.state.dailyDate).toBe('2026-10-02');

    // A time sync steps the wall clock back 5 s after the midnight timer was set,
    // so it fires at 23:59:56 and finds the same date. The Activity stays visible.
    vi.setSystemTime(Date.now() - 5000);
    await act(() => vi.advanceTimersByTimeAsync(2 * 60 * 60_000));
    expect(result.current.state.dailyDate).toBe('2026-10-03');
    expect(api.daily).toHaveBeenLastCalledWith('2026-10-03', expect.anything());
  });
});
