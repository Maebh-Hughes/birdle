import { MAX_GUESSES } from './constants';
import type { Stats } from './types';

/** Stats of a player who has never finished a daily puzzle. */
export function emptyStats(): Stats {
  return {
    played: 0,
    wins: 0,
    currentStreak: 0,
    maxStreak: 0,
    distribution: new Array<number>(MAX_GUESSES).fill(0),
    lastPlayedPuzzle: null,
    lastWonPuzzle: null,
  };
}

/**
 * Stats after finishing daily puzzle `puzzleNumber` (returns a new object).
 * Win: streak = lastWonPuzzle === n - 1 ? streak + 1 : 1. Loss: streak = 0.
 * A puzzle older than lastPlayedPuzzle (finished late, e.g. yesterday's after
 * today's) counts toward played/wins/distribution but leaves streaks untouched.
 */
export function recordGameResult(stats: Stats, puzzleNumber: number, won: boolean, guessCount: number): Stats {
  if (won && (!Number.isInteger(guessCount) || guessCount < 1 || guessCount > MAX_GUESSES)) {
    throw new RangeError(`A win needs 1-${MAX_GUESSES} guesses, got ${guessCount}`);
  }

  const distribution = Array.from({ length: MAX_GUESSES }, (_, i) => stats.distribution[i] ?? 0);
  if (won) distribution[guessCount - 1]! += 1;
  const next: Stats = {
    ...stats,
    played: stats.played + 1,
    wins: stats.wins + (won ? 1 : 0),
    distribution,
  };

  if (stats.lastPlayedPuzzle !== null && puzzleNumber < stats.lastPlayedPuzzle) return next;

  next.lastPlayedPuzzle = puzzleNumber;
  if (won) {
    next.currentStreak = stats.lastWonPuzzle === puzzleNumber - 1 ? stats.currentStreak + 1 : 1;
    next.maxStreak = Math.max(stats.maxStreak, next.currentStreak);
    next.lastWonPuzzle = puzzleNumber;
  } else {
    next.currentStreak = 0;
  }
  return next;
}

/**
 * Stats as shown on puzzle `currentPuzzle`: a streak whose last win is older
 * than yesterday's puzzle has lapsed and displays as 0.
 */
export function statsForDisplay(stats: Stats, currentPuzzle: number): Stats {
  const lapsed = stats.lastWonPuzzle === null || stats.lastWonPuzzle < currentPuzzle - 1;
  return lapsed && stats.currentStreak !== 0 ? { ...stats, currentStreak: 0 } : stats;
}
