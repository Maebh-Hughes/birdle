import {
  BACKSPACE_KEY,
  ENTER_KEY,
  localIsoDate,
  msUntilNextLocalMidnight,
  type GameMode,
  type GameView,
  type LetterState,
  type Stats,
} from '@birdle/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { isAbortError, type Api } from '../api';
import { errorMessage, isRejectedGuess, isStaleGameError, isUncertainOutcome } from './errors';
import {
  activeGame,
  gameReducer,
  initialGameState,
  isSameGameState,
  visibleKeyStates,
  type GameState,
  type ToastTone,
} from './reducer';
import { bounceDuration, GAME_OVER_DELAY_MS, revealDuration } from './timing';

export interface UseGameOptions {
  api: Api;
  initialStats: Stats;
  /** The hard-mode setting, sent with a game's first guess. */
  hardMode: boolean;
  /** Skip animation delays (prefers-reduced-motion). */
  reducedMotion: boolean;
  /** A game finished in this session, its reveal has played out, and it is still on screen. */
  onGameOver?: (game: GameView) => void;
  /** The server accepted a daily guess (the Flock should refresh). */
  onDailyGuess?: () => void;
  /** Today's local date; injectable for tests. */
  today?: () => string;
}

export interface GameController {
  state: GameState;
  game: GameView | null;
  keys: Record<string, LetterState>;
  /** The local date moved on while yesterday's daily board (with guesses) is still shown. */
  newDayAvailable: boolean;
  pressKey: (key: string) => void;
  revealHint: () => Promise<void>;
  setMode: (mode: GameMode) => void;
  newPracticeGame: () => Promise<void>;
  reload: () => void;
  startNewDay: () => void;
  showToast: (message: string, tone?: ToastTone, durationMs?: number) => void;
  dismissToast: (id: number) => void;
}

/** Game screen controller: server calls, typing, submit, reveal sequencing and toasts. */
export function useGame(options: UseGameOptions): GameController {
  const { api, reducedMotion } = options;
  const [state, dispatch] = useReducer(gameReducer, options, (opts) =>
    initialGameState({ date: (opts.today ?? localIsoDate)(), stats: opts.initialStats }),
  );

  // Event handlers and timers read the latest values through refs.
  const stateRef = useRef(state);
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    stateRef.current = state;
    optionsRef.current = options;
  });

  // Each mode's latest request wins: older responses for that mode are dropped.
  const requestSeq = useRef<Record<GameMode, number>>({ daily: 0, practice: 0 });
  const beginRequest = (mode: GameMode) => ++requestSeq.current[mode];
  const isLatest = (mode: GameMode, seq: number) => requestSeq.current[mode] === seq;
  /** A daily response for the puzzle now current (not one the day has moved on from). */
  const isCurrent = (mode: GameMode, game: GameView) => mode !== 'daily' || game.date === stateRef.current.dailyDate;

  const [reloadCount, setReloadCount] = useState(0);
  const reload = useCallback(() => setReloadCount((n) => n + 1), []);

  // Load (or resume) the active mode's game. Entering Free Flight resumes an
  // unfinished practice game or starts a new one. Practice games don't depend
  // on the date, so a new day doesn't reload (and replace) them.
  const mode = state.mode;
  const loadDate = mode === 'daily' ? state.dailyDate : null;
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const seq = beginRequest(mode);
    dispatch({ type: 'load/start', mode });

    const load = async (): Promise<GameView> => {
      if (loadDate !== null) return (await api.daily(loadDate, { signal })).game;
      const { game } = await api.practice({ signal });
      return game && game.status === 'playing' ? game : (await api.practiceNew({ signal })).game;
    };
    load().then(
      (game) => {
        if (!signal.aborted && isLatest(mode, seq)) dispatch({ type: 'load/success', mode, game });
      },
      (error: unknown) => {
        if (signal.aborted || isAbortError(error) || !isLatest(mode, seq)) return;
        dispatch({ type: 'load/failure', mode, message: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [api, mode, loadDate, reloadCount]);

  // Send a guess the reducer accepted. The reducer allows one at a time.
  useEffect(() => {
    const pending = state.pending;
    if (!pending) return;
    const request: Promise<{ game: GameView; stats?: Stats }> =
      pending.mode === 'daily'
        ? api.dailyGuess({ date: pending.date, guess: pending.guess, hardMode: pending.hardMode })
        : api.practiceGuess({ guess: pending.guess, hardMode: pending.hardMode });
    request.then(
      (response) => {
        const current = isCurrent(pending.mode, response.game);
        // Newer than any load of this game still in flight (unless it is for a past day).
        if (current) beginRequest(pending.mode);
        dispatch({ type: 'guess/success', id: pending.id, game: response.game, stats: response.stats });
        if (current && pending.mode === 'daily') optionsRef.current.onDailyGuess?.();
      },
      (error: unknown) => {
        const uncertain = isUncertainOutcome(error);
        dispatch({
          type: 'guess/failure',
          id: pending.id,
          message: errorMessage(error),
          shake: isRejectedGuess(error),
          uncertain,
        });
        // Finished or replaced elsewhere (another tab or device), or the guess may
        // have been counted after all: show the server's real state.
        if (uncertain || isStaleGameError(error)) reload();
      },
    );
  }, [api, state.pending, reload]);

  const game = activeGame(state);
  const wordLength = game?.wordLength ?? 0;

  // Reveal -> (bounce) -> game over, each step after its animation.
  useEffect(() => {
    if (state.revealingRow === null) return;
    const timer = window.setTimeout(() => dispatch({ type: 'reveal/done' }), reducedMotion ? 0 : revealDuration(wordLength));
    return () => window.clearTimeout(timer);
  }, [state.revealingRow, wordLength, reducedMotion]);

  useEffect(() => {
    if (state.bounceRow === null) return;
    const timer = window.setTimeout(() => dispatch({ type: 'bounce/done' }), reducedMotion ? 0 : bounceDuration(wordLength));
    return () => window.clearTimeout(timer);
  }, [state.bounceRow, wordLength, reducedMotion]);

  // Report a finished game once its celebration has played, unless the player
  // has moved to another game (mode, day or new bird) in the meantime.
  const reportedFinish = useRef(0);
  useEffect(() => {
    const finish = state.finished;
    if (finish === 0 || finish === reportedFinish.current) return;
    const finishedGame = activeGame(stateRef.current);
    if (!finishedGame || finishedGame.status === 'playing') return;
    const celebration = finishedGame.status === 'won' ? bounceDuration(finishedGame.wordLength) : 0;
    const delay = reducedMotion ? 400 : celebration + GAME_OVER_DELAY_MS;
    const timer = window.setTimeout(() => {
      reportedFinish.current = finish;
      if (isSameGameState(activeGame(stateRef.current), finishedGame)) optionsRef.current.onGameOver?.(finishedGame);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.finished, reducedMotion]);

  // A new daily puzzle unlocks at local midnight. The timer is re-armed after
  // every check, since a clock or time-zone change can make it fire early.
  const [today, setToday] = useState(() => (options.today ?? localIsoDate)());
  useEffect(() => {
    const check = () => setToday((optionsRef.current.today ?? localIsoDate)());
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        check();
        arm();
      }, msUntilNextLocalMidnight() + 1000);
    };
    arm();
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  // Move on automatically only when yesterday's board is empty; otherwise the
  // player keeps it (to finish or admire) and gets a "new puzzle" prompt.
  const daily = state.games.daily;
  const dailyStarted = daily !== null && daily.guesses.length > 0;
  const newDay = today !== state.dailyDate;
  const busy = state.pending !== null || state.hintPending;
  useEffect(() => {
    if (newDay && !dailyStarted && !busy) dispatch({ type: 'date/set', date: today });
  }, [newDay, dailyStarted, today, busy]);

  const pressKey = useCallback(
    (key: string) => {
      if (key === ENTER_KEY) {
        const current = stateRef.current;
        // The last guess may have been counted: check the server before sending anything.
        if (current.resync === current.mode) {
          if (!current.loading) reload();
          return;
        }
        dispatch({ type: 'guess/submit', hardMode: optionsRef.current.hardMode });
      } else if (key === BACKSPACE_KEY) dispatch({ type: 'key/backspace' });
      else dispatch({ type: 'key/letter', letter: key });
    },
    [reload],
  );

  const hintBusy = useRef(false);
  const revealHint = useCallback(async () => {
    const current = stateRef.current;
    const target = activeGame(current);
    if (!target || !target.hintAvailable || hintBusy.current) return;
    const hintMode = current.mode;
    hintBusy.current = true;
    dispatch({ type: 'hint/start' });
    try {
      const { game: updated } =
        hintMode === 'daily' ? await api.dailyHint({ date: target.date ?? current.dailyDate }) : await api.practiceHint();
      if (isCurrent(hintMode, updated)) beginRequest(hintMode);
      dispatch({ type: 'hint/success', mode: hintMode, game: updated });
    } catch (error) {
      dispatch({ type: 'hint/failure', message: errorMessage(error) });
      if (isStaleGameError(error)) reload();
    } finally {
      hintBusy.current = false;
    }
  }, [api, reload]);

  const practiceBusy = useRef(false);
  const newPracticeGame = useCallback(async () => {
    if (practiceBusy.current || stateRef.current.mode !== 'practice' || stateRef.current.pending) return;
    practiceBusy.current = true;
    const seq = beginRequest('practice');
    dispatch({ type: 'load/start', mode: 'practice' });
    try {
      const { game: fresh } = await api.practiceNew();
      if (isLatest('practice', seq)) dispatch({ type: 'load/success', mode: 'practice', game: fresh });
    } catch (error) {
      if (isLatest('practice', seq)) dispatch({ type: 'load/failure', mode: 'practice', message: errorMessage(error) });
    } finally {
      practiceBusy.current = false;
    }
  }, [api]);

  const setMode = useCallback((next: GameMode) => dispatch({ type: 'mode/set', mode: next }), []);
  const startNewDay = useCallback(() => dispatch({ type: 'date/set', date: today }), [today]);
  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info', durationMs?: number) => dispatch({ type: 'toast/show', message, tone, durationMs }),
    [],
  );
  const dismissToast = useCallback((id: number) => dispatch({ type: 'toast/dismiss', id }), []);

  const keys = useMemo(() => visibleKeyStates(state), [state]);

  return {
    state,
    game,
    keys,
    newDayAvailable: newDay && dailyStarted,
    pressKey,
    revealHint,
    setMode,
    newPracticeGame,
    reload,
    startNewDay,
    showToast,
    dismissToast,
  };
}
