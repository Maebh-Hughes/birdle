import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../src/api';
import { NETWORK_MESSAGE } from '../src/game/errors';
import { useGame, type UseGameOptions } from '../src/game/useGame';
import { makeGame, makeStats, row } from './fixtures';
import type { GameView } from '@birdle/shared';

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
    practiceNew: vi.fn(() => Promise.resolve({ game: makeGame({ mode: 'practice', puzzleNumber: null, date: null, wordLength: 7 }) })),
    practiceGuess: unexpected('practiceGuess'),
    practiceHint: unexpected('practiceHint'),
    joinInstance: unexpected('joinInstance'),
    flock: unexpected('flock'),
    ...overrides,
  };
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
    expect(result.current.game?.wordLength).toBe(7);
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
