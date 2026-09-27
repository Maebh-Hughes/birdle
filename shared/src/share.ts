import type { BirdReveal, GameView, LetterState } from './types';

/** The parts of a finished game that the share text needs. */
export interface ShareableGame
  extends Pick<GameView, 'mode' | 'puzzleNumber' | 'status' | 'hardMode' | 'hintUsed' | 'maxGuesses'> {
  guesses: readonly { readonly result: readonly LetterState[] }[];
  /** Used only in practice mode, for the closing "🐦 {Name}" line. */
  answer: Pick<BirdReveal, 'name'> | null;
}

export interface ShareOptions {
  /** High-contrast palette: 🟧 correct, 🟦 present. */
  colorBlind?: boolean;
  /** 'light' uses ⬜ for absent tiles instead of ⬛. */
  theme?: 'dark' | 'light';
}

/** Emoji for each tile state under the given display settings. */
export function shareEmoji(options: ShareOptions = {}): Record<LetterState, string> {
  return {
    correct: options.colorBlind ? '🟧' : '🟩',
    present: options.colorBlind ? '🟦' : '🟨',
    absent: options.theme === 'light' ? '⬜' : '⬛',
  };
}

/**
 * Spoiler-free result text, e.g.
 *
 *   BIRDLE #12 4/6*
 *   🟨⬛⬛⬛⬛
 *   ...
 *   🪶 hint used
 *
 * `X/6` on a loss, `*` for hard mode, the hint line only when the hint was used.
 * Practice games use the header `BIRDLE Free Flight 4/6` and end with `🐦 {Name}`;
 * daily games never name the answer. Throws for a game that is still in progress.
 */
export function buildShareText(game: ShareableGame, options: ShareOptions = {}): string {
  if (game.status === 'playing') throw new Error('Cannot share a game that is still in progress');

  const score = `${game.status === 'won' ? game.guesses.length : 'X'}/${game.maxGuesses}${game.hardMode ? '*' : ''}`;
  let title: string;
  if (game.mode === 'daily') {
    if (game.puzzleNumber === null) throw new Error('A daily game needs a puzzle number');
    title = `BIRDLE #${game.puzzleNumber}`;
  } else {
    title = 'BIRDLE Free Flight';
  }

  const emoji = shareEmoji(options);
  const lines = [`${title} ${score}`, ...game.guesses.map((row) => row.result.map((state) => emoji[state]).join(''))];
  if (game.hintUsed) lines.push('🪶 hint used');
  if (game.mode === 'practice' && game.answer) lines.push(`🐦 ${game.answer.name}`);
  return lines.join('\n');
}
