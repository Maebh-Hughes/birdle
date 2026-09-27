import { describe, expect, it } from 'vitest';
import { addDays, dateForPuzzleNumber, isPlayableDate, puzzleNumberForDate } from '@birdle/shared';
import { DAILY_GAME_RETENTION_PUZZLES, pruneStaleData } from '../src/maintenance';
import { MemoryStore, type GameRecord } from '../src/store';
import { TODAY, TODAY_PUZZLE } from './helpers';

function dailyGame(puzzleNumber: number): GameRecord {
  return {
    mode: 'daily',
    puzzleNumber,
    date: dateForPuzzleNumber(puzzleNumber),
    category: null,
    answer: 'ROBIN',
    guesses: [],
    status: 'playing',
    hardMode: false,
    hintUsed: false,
  };
}

describe('pruneStaleData', () => {
  it('keeps every daily game that can still be read and drops older ones', async () => {
    const store = new MemoryStore();
    const now = new Date(`${TODAY}T23:59:00Z`);
    const puzzles = Array.from({ length: 8 }, (_, i) => TODAY_PUZZLE - 6 + i);
    for (const n of puzzles) await store.saveDailyGame('alice', n, dailyGame(n));

    await pruneStaleData(store, now);

    for (const n of puzzles) {
      const date = dateForPuzzleNumber(n);
      const kept = (await store.getDailyGame('alice', n)) !== undefined;
      if (isPlayableDate(date, now)) expect(kept, date).toBe(true);
      expect(kept, date).toBe(n >= TODAY_PUZZLE - DAILY_GAME_RETENTION_PUZZLES);
    }
    // The earliest date a client can still ask for (UTC today - 1) is inside the retention window.
    expect(puzzleNumberForDate(addDays(TODAY, -1))).toBeGreaterThanOrEqual(TODAY_PUZZLE - DAILY_GAME_RETENTION_PUZZLES);
  });

  it('drops pinned daily answers older than the retention window, like the games', async () => {
    const store = new MemoryStore();
    const now = new Date(`${TODAY}T23:59:00Z`);
    const puzzles = Array.from({ length: 8 }, (_, i) => TODAY_PUZZLE - 6 + i);
    for (const n of puzzles) await store.pinDailyAnswer(n, 'ROBIN');

    await pruneStaleData(store, now);

    for (const n of puzzles) {
      const date = dateForPuzzleNumber(n);
      const kept = (await store.getDailyAnswer(n)) !== undefined;
      if (isPlayableDate(date, now)) expect(kept, date).toBe(true);
      expect(kept, date).toBe(n >= TODAY_PUZZLE - DAILY_GAME_RETENTION_PUZZLES);
    }
  });
});
