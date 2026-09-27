import { describe, expect, it } from 'vitest';
import {
  activeGame,
  checkSubmit,
  gameBeforeReveal,
  gameReducer,
  initialGameState,
  isSameGameState,
  visibleKeyStates,
  type GameAction,
  type GameState,
} from '../src/game/reducer';
import { makeGame, makeStats, row } from './fixtures';
import type { GameView } from '@birdle/shared';

function stateWith(game: GameView | null, patch: Partial<GameState> = {}): GameState {
  const base = initialGameState({ date: '2026-10-02', stats: makeStats() });
  return { ...base, games: { ...base.games, [game?.mode ?? 'daily']: game }, mode: game?.mode ?? 'daily', ...patch };
}

function run(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, state);
}

function type(state: GameState, letters: string): GameState {
  return run(state, ...[...letters].map((letter): GameAction => ({ type: 'key/letter', letter })));
}

describe('typing', () => {
  it('stops at the word length (4 letters)', () => {
    const state = type(stateWith(makeGame({ wordLength: 4 })), 'WRENS');
    expect(state.current).toBe('WREN');
  });

  it('stops at the word length (11 letters)', () => {
    const state = type(stateWith(makeGame({ wordLength: 11 })), 'ABCDEFGHIJKLMNOP');
    expect(state.current).toBe('ABCDEFGHIJK');
  });

  it('uppercases letters and ignores anything else', () => {
    const state = run(
      stateWith(makeGame()),
      { type: 'key/letter', letter: 'o' },
      { type: 'key/letter', letter: '1' },
      { type: 'key/letter', letter: 'É' },
      { type: 'key/letter', letter: 'AB' },
      { type: 'key/letter', letter: 'w' },
    );
    expect(state.current).toBe('OW');
  });

  it('backspace removes the last letter and is a no-op on an empty row', () => {
    let state = type(stateWith(makeGame()), 'OWL');
    state = run(state, { type: 'key/backspace' });
    expect(state.current).toBe('OW');
    state = run(state, { type: 'key/backspace' }, { type: 'key/backspace' }, { type: 'key/backspace' });
    expect(state.current).toBe('');
  });

  it('ignores keys when there is no game, the game is over, a guess is pending or a row is flipping', () => {
    expect(type(stateWith(null), 'OWL').current).toBe('');
    expect(type(stateWith(makeGame({ status: 'won' })), 'OWL').current).toBe('');

    const pending = run(type(stateWith(makeGame({ wordLength: 4 })), 'KITE'), { type: 'guess/submit', hardMode: false });
    expect(pending.pending).not.toBeNull();
    expect(run(pending, { type: 'key/backspace' }).current).toBe('KITE');

    const flipping = stateWith(makeGame(), { revealingRow: 0 });
    expect(type(flipping, 'A').current).toBe('');
  });
});

describe('submitting', () => {
  it('rejects a short row with "Not enough letters" and a shake, without a request', () => {
    const state = run(type(stateWith(makeGame()), 'OWL'), { type: 'guess/submit', hardMode: false });
    expect(state.pending).toBeNull();
    expect(state.toasts.map((t) => t.message)).toEqual(['Not enough letters']);
    expect(state.shake).toEqual({ row: 0, nonce: 1 });
    expect(state.current).toBe('OWL');
  });

  it('bumps the shake nonce on repeated invalid submits without stacking toasts', () => {
    const state = run(
      type(stateWith(makeGame()), 'OWL'),
      { type: 'guess/submit', hardMode: false },
      { type: 'guess/submit', hardMode: false },
    );
    expect(state.shake?.nonce).toBe(2);
    expect(state.toasts).toHaveLength(1);
  });

  it('creates one pending guess and ignores a second submit while it is in flight', () => {
    const typed = type(stateWith(makeGame()), 'STORK');
    const once = run(typed, { type: 'guess/submit', hardMode: true });
    expect(once.pending).toMatchObject({ id: 1, mode: 'daily', guess: 'STORK', hardMode: true, date: '2026-10-02' });
    const twice = run(once, { type: 'guess/submit', hardMode: true });
    expect(twice).toBe(once);
  });

  it("keeps a started game's hard-mode flag regardless of the setting", () => {
    const game = makeGame({ hardMode: false, guesses: [row('STORK', 'CRANE')] });
    const state = run(type(stateWith(game), 'CRAKE'), { type: 'guess/submit', hardMode: true });
    expect(state.pending?.hardMode).toBe(false);
  });

  it('checks hard mode locally before sending', () => {
    const game = makeGame({ hardMode: true, guesses: [row('STORK', 'CRANE')] });
    const check = checkSubmit(type(stateWith(game), 'EAGLE'));
    expect(check).toEqual({ kind: 'invalid', message: 'Guess must contain R' });
  });

  it('on success: stores the game, clears the row and starts the reveal of the new row', () => {
    const typed = run(type(stateWith(makeGame()), 'STORK'), { type: 'guess/submit', hardMode: false });
    const updated = makeGame({ guesses: [row('STORK', 'CRANE')] });
    const stats = makeStats({ played: 3 });
    const state = run(typed, { type: 'guess/success', id: 1, game: updated, stats });
    expect(activeGame(state)).toBe(updated);
    expect(state.pending).toBeNull();
    expect(state.current).toBe('');
    expect(state.revealingRow).toBe(0);
    expect(state.stats).toBe(stats);
  });

  it('ignores a response for a guess that is no longer pending', () => {
    const typed = run(type(stateWith(makeGame()), 'STORK'), { type: 'guess/submit', hardMode: false });
    const state = run(typed, { type: 'guess/success', id: 99, game: makeGame({ guesses: [row('STORK', 'CRANE')] }) });
    expect(state).toBe(typed);
  });

  it('on a rejected guess: toast, shake, keep the letters', () => {
    const typed = run(type(stateWith(makeGame()), 'XYZZY'), { type: 'guess/submit', hardMode: false });
    const state = run(typed, { type: 'guess/failure', id: 1, message: 'Not in word list', shake: true });
    expect(state.pending).toBeNull();
    expect(state.current).toBe('XYZZY');
    expect(state.toasts.at(-1)?.message).toBe('Not in word list');
    expect(state.shake?.row).toBe(0);
  });

  it('on a network failure: toast without a shake', () => {
    const typed = run(type(stateWith(makeGame()), 'STORK'), { type: 'guess/submit', hardMode: false });
    const state = run(typed, { type: 'guess/failure', id: 1, message: 'offline', shake: false });
    expect(state.shake).toBeNull();
    expect(state.toasts.at(-1)?.tone).toBe('error');
  });
});

describe('reveal sequencing', () => {
  it('holds back the flipping row from the keyboard colours', () => {
    const game = makeGame({ guesses: [row('STORK', 'CRANE'), row('CRAKE', 'CRANE')] });
    const flipping = visibleKeyStates(stateWith(game, { revealingRow: 1 }));
    expect(flipping.C).toBeUndefined();
    expect(flipping.R).toBe('present');
    const done = visibleKeyStates(stateWith(game));
    expect(done.C).toBe('correct');
    expect(done.R).toBe('correct');
  });

  it('after the last flip of a win: win message, bounce and a finish', () => {
    const game = makeGame({ status: 'won', guesses: [row('STORK', 'CRANE'), row('CRANE', 'CRANE')] });
    const state = run(stateWith(game, { revealingRow: 1 }), { type: 'reveal/done' });
    expect(state.revealingRow).toBeNull();
    expect(state.bounceRow).toBe(1);
    expect(state.finished).toBe(1);
    expect(state.toasts.at(-1)).toMatchObject({ message: 'Soaring!', tone: 'success' });
    expect(state.announcement).toContain('Guess 2: C correct');
  });

  it('after the last flip of a loss: shows the answer', () => {
    const game = makeGame({
      status: 'lost',
      guesses: Array.from({ length: 6 }, () => row('STORK', 'CRANE')),
      answer: { word: 'CRANE', name: 'Crane', kind: 'bird', fact: 'Fixture fact.', wikiUrl: 'https://example.org' },
    });
    const state = run(stateWith(game, { revealingRow: 5 }), { type: 'reveal/done' });
    expect(state.toasts.at(-1)?.message).toBe('The bird was CRANE');
    expect(state.finished).toBe(1);
    expect(state.bounceRow).toBeNull();
  });
});

describe('modes and loading', () => {
  it('switching mode clears the row and animation state', () => {
    const state = run(type(stateWith(makeGame()), 'OWL'), { type: 'mode/set', mode: 'practice' });
    expect(state.mode).toBe('practice');
    expect(state.current).toBe('');
    expect(activeGame(state)).toBeNull();
  });

  it('a load keeps typed letters only when the board has not moved on', () => {
    const typed = type(stateWith(makeGame()), 'OWL');
    const same = run(typed, { type: 'load/success', mode: 'daily', game: makeGame() });
    expect(same.current).toBe('OWL');
    const moved = run(typed, { type: 'load/success', mode: 'daily', game: makeGame({ guesses: [row('STORK', 'CRANE')] }) });
    expect(moved.current).toBe('');
  });

  it('a failed load is an error screen without a game, a toast with one', () => {
    const empty = run(stateWith(null), { type: 'load/failure', mode: 'daily', message: 'offline' });
    expect(empty.loadError).toBe('offline');
    const withGame = run(stateWith(makeGame()), { type: 'load/failure', mode: 'daily', message: 'offline' });
    expect(withGame.loadError).toBeNull();
    expect(withGame.toasts.at(-1)?.message).toBe('offline');
  });

  it('keeps at most three toasts', () => {
    const state = run(
      stateWith(makeGame()),
      ...['a', 'b', 'c', 'd'].map((message): GameAction => ({ type: 'toast/show', message })),
    );
    expect(state.toasts.map((t) => t.message)).toEqual(['b', 'c', 'd']);
  });
});

describe('a new day', () => {
  const YESTERDAY = '2026-10-02';
  const TODAY = '2026-10-03';
  const started = makeGame({ date: YESTERDAY, guesses: [row('STORK', 'CRANE')] });

  it('waits for a guess or hint in flight before moving to the new day', () => {
    const pending = run(type(stateWith(started), 'CRAKE'), { type: 'guess/submit', hardMode: false });
    expect(run(pending, { type: 'date/set', date: TODAY })).toBe(pending);
    const hinting = run(stateWith(started), { type: 'hint/start' });
    expect(run(hinting, { type: 'date/set', date: TODAY })).toBe(hinting);

    const answered = run(pending, { type: 'guess/success', id: 1, game: makeGame({ date: YESTERDAY, guesses: [...started.guesses, row('CRAKE', 'CRANE')] }) });
    const moved = run(answered, { type: 'date/set', date: TODAY });
    expect(moved.dailyDate).toBe(TODAY);
    expect(activeGame(moved)).toBeNull();
  });

  it("drops a guess or hint response for a day that is no longer current", () => {
    const state = stateWith(null, {
      dailyDate: TODAY,
      pending: { id: 4, mode: 'daily', guess: 'CRAKE', hardMode: false, date: YESTERDAY },
      hintPending: true,
    });
    const stale = makeGame({ date: YESTERDAY, status: 'won', guesses: [row('CRANE', 'CRANE')] });
    const afterGuess = run(state, { type: 'guess/success', id: 4, game: stale });
    expect(afterGuess.pending).toBeNull();
    expect(afterGuess.games.daily).toBeNull();
    expect(afterGuess.revealingRow).toBeNull();
    const afterHint = run(state, { type: 'hint/success', mode: 'daily', game: stale });
    expect(afterHint.hintPending).toBe(false);
    expect(afterHint.games.daily).toBeNull();
  });
});

describe('a guess whose fate is unknown', () => {
  it('blocks sending anything in that mode until the game is reloaded, keeping the letters', () => {
    const sent = run(type(stateWith(makeGame()), 'STORK'), { type: 'guess/submit', hardMode: false });
    const failed = run(sent, { type: 'guess/failure', id: 1, message: 'offline', shake: false, uncertain: true });
    expect(failed.resync).toBe('daily');
    expect(failed.current).toBe('STORK');
    expect(checkSubmit(failed)).toEqual({ kind: 'ignore' });
    expect(run(failed, { type: 'guess/submit', hardMode: false }).pending).toBeNull();

    // The server did count it: the reload shows it and clears the row.
    const counted = run(failed, { type: 'load/success', mode: 'daily', game: makeGame({ guesses: [row('STORK', 'CRANE')] }) });
    expect(counted.resync).toBeNull();
    expect(counted.current).toBe('');

    // It didn't: the letters stay, ready to send again.
    const lost = run(failed, { type: 'load/success', mode: 'daily', game: makeGame() });
    expect(lost.resync).toBeNull();
    expect(lost.current).toBe('STORK');
    expect(checkSubmit(lost).kind).toBe('ok');
  });

  it('is not raised by a rejection the server clearly made', () => {
    const sent = run(type(stateWith(makeGame()), 'XYZZY'), { type: 'guess/submit', hardMode: false });
    expect(run(sent, { type: 'guess/failure', id: 1, message: 'Not in word list', shake: true }).resync).toBeNull();
  });
});

describe('hints', () => {
  it('announces a revealed hint and settles any load it superseded', () => {
    const game = makeGame({ hintAvailable: true, guesses: Array.from({ length: 3 }, () => row('STORK', 'CRANE')) });
    const state = run(stateWith(game, { loading: true }), { type: 'hint/start' });
    const revealed = run(state, {
      type: 'hint/success',
      mode: 'daily',
      game: { ...game, hintAvailable: false, hintUsed: true, hint: 'Tall wading bird' },
    });
    expect(revealed.announcement).toBe('Hint: Tall wading bird');
    expect(revealed.loading).toBe(false);
    expect(revealed.hintPending).toBe(false);
  });
});

describe('gameBeforeReveal', () => {
  const guesses = [row('STORK', 'CRANE'), row('SLATE', 'CRANE'), row('BRINE', 'CRANE'), row('CRANE', 'CRANE')];
  const won = makeGame({
    status: 'won',
    guesses,
    hint: 'Tall wading bird',
    answer: { word: 'CRANE', name: 'Crane', kind: 'bird', fact: 'Fixture fact.', wikiUrl: 'https://example.org' },
  });

  it('shows a game-ending guess as still in progress while it flips', () => {
    const shown = gameBeforeReveal(won, 3);
    expect(shown).toMatchObject({ status: 'playing', hintAvailable: true, hint: null, answer: null });
    expect(shown.guesses).toHaveLength(3);
    expect(gameBeforeReveal({ ...won, hintUsed: true }, 3)).toMatchObject({ hintAvailable: false, hint: 'Tall wading bird' });
    expect(gameBeforeReveal(won, 1).hintAvailable).toBe(false);
  });

  it('leaves games alone when nothing is flipping or the game goes on', () => {
    expect(gameBeforeReveal(won, null)).toBe(won);
    const playing = makeGame({ guesses });
    expect(gameBeforeReveal(playing, 3)).toBe(playing);
  });
});

describe('isSameGameState', () => {
  it('matches the same game at the same point only', () => {
    const won = makeGame({ status: 'won', guesses: [row('CRANE', 'CRANE')] });
    expect(isSameGameState({ ...won }, won)).toBe(true);
    expect(isSameGameState(null, won)).toBe(false);
    expect(isSameGameState(makeGame({ mode: 'practice', puzzleNumber: null, date: null }), won)).toBe(false);
    expect(isSameGameState({ ...won, date: '2026-10-03', puzzleNumber: 8 }, won)).toBe(false);
    expect(isSameGameState(makeGame(), won)).toBe(false);
  });
});
