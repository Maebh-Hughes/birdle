import type { IDiscordSDK } from '@discord/embedded-app-sdk';
import type { GameView } from '@birdle/shared';
import { useEffect, useRef } from 'react';
import { describeError } from './errors';

type PresenceGame = Pick<GameView, 'mode' | 'puzzleNumber' | 'status' | 'guesses' | 'maxGuesses' | 'wordLength'> &
  Partial<Pick<GameView, 'category'>>;

export interface PresenceText {
  details: string;
  state: string;
}

/** "BIRDLE #12" / "BIRDLE Free Flight" + "Guess 3 of 6" / "Solved in 4/6" / "Stumped today". */
export function presenceText(game: PresenceGame): PresenceText {
  const details = game.mode === 'daily' ? `BIRDLE #${game.puzzleNumber ?? ''}`.trim() : 'BIRDLE Free Flight';
  const used = game.guesses.length;
  let state: string;
  if (game.status === 'won') state = `Solved in ${used}/${game.maxGuesses}`;
  else if (game.status === 'lost') state = game.mode === 'daily' ? 'Stumped today' : 'Stumped this time';
  else state = `Guess ${Math.min(used + 1, game.maxGuesses)} of ${game.maxGuesses}`;
  return { details, state };
}

/** Sets rich presence; never throws (presence must not break the game). */
export async function setPresence(sdk: IDiscordSDK, text: PresenceText, startMs: number): Promise<void> {
  try {
    await sdk.commands.setActivity({
      activity: { type: 0, details: text.details, state: text.state, timestamps: { start: startMs } },
    });
  } catch (error) {
    console.warn('BIRDLE: setActivity failed:', describeError(error));
  }
}

/** What tells one Free Flight round from the next (practice games have no puzzle number). */
export interface PracticeSnapshot {
  status: GameView['status'];
  guessCount: number;
  wordLength: number;
  category?: GameView['category'];
}

/** `next` is a fresh practice game rather than `previous` carrying on. */
export function isNewPracticeRound(previous: PracticeSnapshot | null, next: PracticeSnapshot): boolean {
  return (
    previous !== null &&
    next.status === 'playing' &&
    (previous.status !== 'playing' ||
      next.guessCount < previous.guessCount ||
      next.wordLength !== previous.wordLength ||
      (next.category ?? null) !== (previous.category ?? null))
  );
}

/**
 * Keeps the player's Discord presence in step with the visible game, skipping
 * unchanged updates. The elapsed-time start is per daily puzzle and per Free Flight round.
 */
export function usePresence(sdk: IDiscordSDK, enabled: boolean, game: PresenceGame | null): void {
  const lastSent = useRef('');
  const startTimes = useRef(new Map<string, number>());
  const practiceRound = useRef(0);
  const lastPractice = useRef<PracticeSnapshot | null>(null);
  const text = game ? presenceText(game) : null;
  const details = text?.details;
  const state = text?.state;
  const mode = game?.mode;
  const puzzleNumber = game?.puzzleNumber ?? null;
  const status = game?.status;
  const guessCount = game?.guesses.length ?? 0;
  const wordLength = game?.wordLength ?? 0;
  const category = game?.category ?? null;

  // Declared before the presence effect so a new round is counted before it is announced.
  useEffect(() => {
    if (mode !== 'practice' || status === undefined) return;
    const snapshot: PracticeSnapshot = { status, guessCount, wordLength, category };
    if (isNewPracticeRound(lastPractice.current, snapshot)) practiceRound.current += 1;
    lastPractice.current = snapshot;
  }, [mode, status, guessCount, wordLength, category]);

  useEffect(() => {
    if (!enabled || details === undefined || state === undefined) return;
    const key = `${details}\n${state}`;
    if (key === lastSent.current) return;
    lastSent.current = key;

    const sessionKey = mode === 'practice' ? `practice:${practiceRound.current}` : `daily:${puzzleNumber ?? ''}`;
    let start = startTimes.current.get(sessionKey);
    if (start === undefined) {
      start = Date.now();
      startTimes.current.set(sessionKey, start);
    }
    void setPresence(sdk, { details, state }, start);
  }, [sdk, enabled, details, state, mode, puzzleNumber]);
}
