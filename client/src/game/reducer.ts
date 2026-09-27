import {
  DEFAULT_ERROR_MESSAGES,
  HINT_AFTER_GUESSES,
  hardModeViolation,
  keyStates,
  winMessage,
  type GameMode,
  type GameView,
  type GuessRow,
  type LetterState,
  type Stats,
} from '@birdle/shared';

// Pure game-screen state. The server owns the game (GameView); this adds what
// the player is typing, the in-flight guess, animation phases and toasts.

export type ToastTone = 'info' | 'error' | 'success';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

export const TOAST_MS: Readonly<Record<ToastTone, number>> = { info: 2200, error: 2200, success: 2600 };
export const LOSS_TOAST_MS = 5000;
export const MAX_TOASTS = 3;

/** A guess accepted by the client and waiting for the server. */
export interface PendingGuess {
  id: number;
  mode: GameMode;
  guess: string;
  hardMode: boolean;
  /** Daily puzzle date (ignored in practice mode). */
  date: string;
}

export interface GameState {
  mode: GameMode;
  /** The daily puzzle's local date (YYYY-MM-DD). */
  dailyDate: string;
  /** Last known server state of each mode's game. */
  games: Record<GameMode, GameView | null>;
  loading: boolean;
  /** Set when the active game could not be loaded at all. */
  loadError: string | null;
  /** Letters typed into the current row (uppercase). */
  current: string;
  pending: PendingGuess | null;
  nextGuessId: number;
  hintPending: boolean;
  /**
   * A guess in this mode failed in a way that may still have reached the server
   * (timeout, dropped connection, 5xx), so it may have been counted. Nothing more
   * is sent in this mode until its game has been reloaded from the server.
   */
  resync: GameMode | null;
  /** Row whose tiles are flipping; its colours are not yet "known" to the keyboard. */
  revealingRow: number | null;
  bounceRow: number | null;
  /** Bump `nonce` to shake `row` again. */
  shake: { row: number; nonce: number } | null;
  toasts: Toast[];
  nextToastId: number;
  stats: Stats;
  /** Screen-reader summary of the last revealed guess. */
  announcement: string;
  /** Incremented when a game ends in this session (after its reveal). */
  finished: number;
}

export type GameAction =
  | { type: 'mode/set'; mode: GameMode }
  | { type: 'date/set'; date: string }
  | { type: 'load/start'; mode: GameMode }
  | { type: 'load/success'; mode: GameMode; game: GameView }
  | { type: 'load/failure'; mode: GameMode; message: string }
  | { type: 'key/letter'; letter: string }
  | { type: 'key/backspace' }
  | { type: 'guess/submit'; hardMode: boolean }
  | { type: 'guess/success'; id: number; game: GameView; stats?: Stats }
  | { type: 'guess/failure'; id: number; message: string; shake: boolean; uncertain?: boolean }
  | { type: 'reveal/done' }
  | { type: 'bounce/done' }
  | { type: 'hint/start' }
  | { type: 'hint/success'; mode: GameMode; game: GameView }
  | { type: 'hint/failure'; message: string }
  | { type: 'toast/show'; message: string; tone?: ToastTone; durationMs?: number }
  | { type: 'toast/dismiss'; id: number }
  | { type: 'stats/set'; stats: Stats };

export function initialGameState(options: { date: string; stats: Stats; mode?: GameMode }): GameState {
  return {
    mode: options.mode ?? 'daily',
    dailyDate: options.date,
    games: { daily: null, practice: null },
    loading: false,
    loadError: null,
    current: '',
    pending: null,
    nextGuessId: 1,
    hintPending: false,
    resync: null,
    revealingRow: null,
    bounceRow: null,
    shake: null,
    toasts: [],
    nextToastId: 1,
    stats: options.stats,
    announcement: '',
    finished: 0,
  };
}

// ---- selectors ----

export function activeGame(state: GameState): GameView | null {
  return state.games[state.mode];
}

/** Letters can be typed only into a live game with nothing in flight or flipping. */
export function canType(state: GameState): boolean {
  const game = activeGame(state);
  return game !== null && game.status === 'playing' && state.pending === null && state.revealingRow === null;
}

export type SubmitCheck =
  | { kind: 'ok'; game: GameView; guess: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'ignore' };

/** Whether Enter should send the current row, show a problem, or do nothing (busy / over / resyncing). */
export function checkSubmit(state: GameState): SubmitCheck {
  const game = activeGame(state);
  if (game === null || !canType(state) || state.resync === state.mode) return { kind: 'ignore' };
  if (state.current.length < game.wordLength) return { kind: 'invalid', message: DEFAULT_ERROR_MESSAGES.INVALID_GUESS };
  if (game.hardMode) {
    const violation = hardModeViolation(state.current, game.guesses);
    if (violation) return { kind: 'invalid', message: violation };
  }
  return { kind: 'ok', game, guess: state.current };
}

/** Keyboard colours, ignoring a row that is still flipping. */
export function visibleKeyStates(state: GameState): Record<string, LetterState> {
  const game = activeGame(state);
  if (!game) return {};
  const rows = state.revealingRow === null ? game.guesses : game.guesses.slice(0, state.revealingRow);
  return keyStates(rows);
}

/**
 * The game as the actions area shows it: while a game-ending guess is still
 * flipping, as it was before that guess, so the result isn't given away early.
 */
export function gameBeforeReveal(game: GameView, revealingRow: number | null): GameView {
  if (revealingRow === null || game.status === 'playing') return game;
  return {
    ...game,
    status: 'playing',
    guesses: game.guesses.slice(0, revealingRow),
    // The server's rule for a game in progress.
    hintAvailable: !game.hintUsed && game.hint !== null && revealingRow >= HINT_AFTER_GUESSES,
    hint: game.hintUsed ? game.hint : null,
    answer: null,
  };
}

/** Same game at the same point: tells whether a game that just ended is still the one on screen. */
export function isSameGameState(a: GameView | null, b: GameView): boolean {
  return (
    a !== null &&
    a.mode === b.mode &&
    a.date === b.date &&
    a.puzzleNumber === b.puzzleNumber &&
    a.wordLength === b.wordLength &&
    a.guesses.length === b.guesses.length &&
    a.status === b.status
  );
}

/** "Guess 2: R correct, O absent, ..." */
export function describeGuess(row: GuessRow, index: number): string {
  const letters = [...row.word].map((letter, i) => `${letter} ${row.result[i] ?? 'absent'}`);
  return `Guess ${index + 1}: ${letters.join(', ')}`;
}

function lossMessage(game: GameView): string {
  if (!game.answer) return 'Out of guesses';
  return `The ${game.answer.kind === 'term' ? 'word' : 'bird'} was ${game.answer.word}`;
}

// ---- helpers ----

function withToast(state: GameState, message: string, tone: ToastTone, durationMs = TOAST_MS[tone]): GameState {
  // Re-showing the same message restarts it instead of stacking duplicates.
  const others = state.toasts.filter((toast) => toast.message !== message);
  const toast: Toast = { id: state.nextToastId, message, tone, durationMs };
  return { ...state, toasts: [...others, toast].slice(-MAX_TOASTS), nextToastId: state.nextToastId + 1 };
}

function withShake(state: GameState): GameState {
  const game = activeGame(state);
  if (!game) return state;
  return { ...state, shake: { row: game.guesses.length, nonce: (state.shake?.nonce ?? 0) + 1 } };
}

/** Stores the server's latest view of a mode's game, which also settles any doubt about that mode's last guess. */
function setGame(state: GameState, mode: GameMode, game: GameView): GameState {
  return { ...state, games: { ...state.games, [mode]: game }, resync: state.resync === mode ? null : state.resync };
}

/** A daily response for another day's puzzle than the one now current. */
function isStaleDaily(state: GameState, mode: GameMode, game: GameView): boolean {
  return mode === 'daily' && game.date !== state.dailyDate;
}

/** Same puzzle at the same point, so the letters being typed still apply. */
function sameRow(previous: GameView | null, next: GameView): boolean {
  return (
    previous !== null &&
    previous.mode === next.mode &&
    previous.puzzleNumber === next.puzzleNumber &&
    previous.wordLength === next.wordLength &&
    previous.guesses.length === next.guesses.length &&
    next.status === 'playing'
  );
}

const RESET_BOARD = { current: '', revealingRow: null, bounceRow: null, shake: null } as const;

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'mode/set':
      if (action.mode === state.mode) return state;
      return { ...state, ...RESET_BOARD, mode: action.mode, loading: false, loadError: null };

    case 'date/set': {
      // Wait for an in-flight guess or hint: its response belongs to the board on screen.
      if (action.date === state.dailyDate || state.pending !== null || state.hintPending) return state;
      const daily = state.games.daily?.date === action.date ? state.games.daily : null;
      const next: GameState = { ...state, dailyDate: action.date, games: { ...state.games, daily } };
      return state.mode === 'daily' ? { ...next, ...RESET_BOARD, loadError: null } : next;
    }

    case 'load/start':
      if (action.mode !== state.mode) return state;
      return { ...state, loading: true, loadError: null };

    case 'load/success': {
      const previous = state.games[action.mode];
      const next = setGame(state, action.mode, action.game);
      if (action.mode !== state.mode) return next;
      const board = sameRow(previous, action.game) ? {} : RESET_BOARD;
      return { ...next, ...board, loading: false, loadError: null };
    }

    case 'load/failure': {
      if (action.mode !== state.mode) return state;
      const next = { ...state, loading: false };
      // Keep showing a game we already have; only an empty board becomes an error screen.
      return activeGame(state) ? withToast(next, action.message, 'error') : { ...next, loadError: action.message };
    }

    case 'key/letter': {
      const game = activeGame(state);
      const letter = action.letter.toUpperCase();
      if (!game || !canType(state) || !/^[A-Z]$/.test(letter)) return state;
      if (state.current.length >= game.wordLength) return state;
      return { ...state, current: state.current + letter };
    }

    case 'key/backspace':
      if (!canType(state) || state.current === '') return state;
      return { ...state, current: state.current.slice(0, -1) };

    case 'guess/submit': {
      const check = checkSubmit(state);
      if (check.kind === 'ignore') return state;
      if (check.kind === 'invalid') return withShake(withToast(state, check.message, 'error'));
      const { game, guess } = check;
      const pending: PendingGuess = {
        id: state.nextGuessId,
        mode: state.mode,
        guess,
        // The server fixes hard mode with a game's first guess.
        hardMode: game.guesses.length > 0 ? game.hardMode : action.hardMode,
        date: game.date ?? state.dailyDate,
      };
      return { ...state, pending, nextGuessId: state.nextGuessId + 1 };
    }

    case 'guess/success': {
      const pending = state.pending;
      if (!pending || pending.id !== action.id) return state;
      if (isStaleDaily(state, pending.mode, action.game)) return { ...state, pending: null };
      const previous = state.games[pending.mode];
      const next: GameState = {
        ...setGame(state, pending.mode, action.game),
        pending: null,
        stats: action.stats ?? state.stats,
      };
      if (pending.mode !== state.mode) return next;
      const grew = action.game.guesses.length > (previous?.guesses.length ?? 0);
      return {
        ...next,
        current: '',
        shake: null,
        loading: false,
        revealingRow: grew ? action.game.guesses.length - 1 : null,
      };
    }

    case 'guess/failure': {
      const pending = state.pending;
      if (!pending || pending.id !== action.id) return state;
      const resync = action.uncertain ? pending.mode : state.resync;
      const next = withToast({ ...state, pending: null, resync }, action.message, 'error');
      return action.shake && pending.mode === state.mode ? withShake(next) : next;
    }

    case 'reveal/done': {
      if (state.revealingRow === null) return state;
      const game = activeGame(state);
      const row = game?.guesses[state.revealingRow];
      let next: GameState = {
        ...state,
        revealingRow: null,
        announcement: row ? describeGuess(row, state.revealingRow) : state.announcement,
      };
      if (game?.status === 'won') {
        next = { ...next, bounceRow: game.guesses.length - 1, finished: state.finished + 1 };
        next = withToast(next, winMessage(game.guesses.length), 'success');
      } else if (game?.status === 'lost') {
        next = withToast({ ...next, finished: state.finished + 1 }, lossMessage(game), 'info', LOSS_TOAST_MS);
      }
      return next;
    }

    case 'bounce/done':
      return state.bounceRow === null ? state : { ...state, bounceRow: null };

    case 'hint/start':
      return { ...state, hintPending: true };

    case 'hint/success': {
      if (isStaleDaily(state, action.mode, action.game)) return { ...state, hintPending: false };
      const next: GameState = { ...setGame(state, action.mode, action.game), hintPending: false };
      if (action.mode !== state.mode) return next;
      // This response supersedes any load of the same game that was in flight.
      const hint = action.game.hintUsed ? action.game.hint : null;
      return { ...next, loading: false, announcement: hint ? `Hint: ${hint}` : state.announcement };
    }

    case 'hint/failure':
      return withToast({ ...state, hintPending: false }, action.message, 'error');

    case 'toast/show':
      return withToast(state, action.message, action.tone ?? 'info', action.durationMs);

    case 'toast/dismiss':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };

    case 'stats/set':
      return { ...state, stats: action.stats };
  }
}
