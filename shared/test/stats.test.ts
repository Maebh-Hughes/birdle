import { describe, expect, it } from 'vitest';
import { emptyStats, recordGameResult, statsForDisplay } from '../src/stats';
import type { Stats } from '../src/types';

function play(results: [puzzle: number, won: boolean, guesses: number][]): Stats {
  return results.reduce((stats, [puzzle, won, guesses]) => recordGameResult(stats, puzzle, won, guesses), emptyStats());
}

describe('emptyStats', () => {
  it('starts at zero with a 6-slot distribution', () => {
    expect(emptyStats()).toEqual({
      played: 0,
      wins: 0,
      currentStreak: 0,
      maxStreak: 0,
      distribution: [0, 0, 0, 0, 0, 0],
      lastPlayedPuzzle: null,
      lastWonPuzzle: null,
    });
    expect(emptyStats().distribution).not.toBe(emptyStats().distribution);
  });
});

describe('recordGameResult', () => {
  it('counts a first win', () => {
    expect(play([[5, true, 3]])).toEqual({
      played: 1,
      wins: 1,
      currentStreak: 1,
      maxStreak: 1,
      distribution: [0, 0, 1, 0, 0, 0],
      lastPlayedPuzzle: 5,
      lastWonPuzzle: 5,
    });
  });

  it('extends the streak on consecutive wins', () => {
    const stats = play([
      [1, true, 4],
      [2, true, 2],
      [3, true, 6],
    ]);
    expect(stats.currentStreak).toBe(3);
    expect(stats.maxStreak).toBe(3);
    expect(stats.distribution).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('restarts the streak at 1 after a missed day', () => {
    const stats = play([
      [1, true, 4],
      [2, true, 4],
      [4, true, 4],
    ]);
    expect(stats.currentStreak).toBe(1);
    expect(stats.maxStreak).toBe(2);
  });

  it('resets the streak to 0 on a loss and keeps the max', () => {
    const stats = play([
      [1, true, 4],
      [2, true, 4],
      [3, false, 6],
    ]);
    expect(stats).toMatchObject({ played: 3, wins: 2, currentStreak: 0, maxStreak: 2, lastPlayedPuzzle: 3, lastWonPuzzle: 2 });
    expect(stats.distribution).toEqual([0, 0, 0, 2, 0, 0]);
  });

  it('starts a new streak after a loss', () => {
    const stats = play([
      [1, true, 4],
      [2, false, 6],
      [3, true, 5],
    ]);
    expect(stats.currentStreak).toBe(1);
  });

  it('counts a late result for an older puzzle without touching streaks', () => {
    const stats = play([
      [10, true, 3],
      [12, true, 3],
      [11, true, 2],
    ]);
    expect(stats).toMatchObject({ played: 3, wins: 3, currentStreak: 1, lastPlayedPuzzle: 12, lastWonPuzzle: 12 });
    expect(stats.distribution).toEqual([0, 1, 2, 0, 0, 0]);
  });

  it('does not mutate its input', () => {
    const before = emptyStats();
    recordGameResult(before, 1, true, 1);
    expect(before).toEqual(emptyStats());
  });

  it('rejects impossible win guess counts', () => {
    expect(() => recordGameResult(emptyStats(), 1, true, 0)).toThrow(RangeError);
    expect(() => recordGameResult(emptyStats(), 1, true, 7)).toThrow(RangeError);
  });
});

describe('statsForDisplay', () => {
  const stats = play([
    [1, true, 4],
    [2, true, 4],
  ]);

  it('keeps a streak that is still alive (won today or yesterday)', () => {
    expect(statsForDisplay(stats, 2).currentStreak).toBe(2);
    expect(statsForDisplay(stats, 3).currentStreak).toBe(2);
  });

  it('shows a lapsed streak as 0 without changing anything else', () => {
    const shown = statsForDisplay(stats, 4);
    expect(shown.currentStreak).toBe(0);
    expect(shown.maxStreak).toBe(2);
    expect(stats.currentStreak).toBe(2);
  });
});
