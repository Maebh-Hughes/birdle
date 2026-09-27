import { puzzleNumberForDate, utcIsoDate } from '@birdle/shared';
import { INSTANCE_MEMBERSHIP_TTL_MS } from './flock';
import type { Store } from './store';

/**
 * Daily games are kept this many puzzles back from today's UTC puzzle. Only
 * puzzles within a day of today can be read (see isPlayableDate), so older games
 * would only slow every save; stats are aggregated separately and kept forever.
 */
export const DAILY_GAME_RETENTION_PUZZLES = 3;

/** Drops expired instance memberships and old daily games so the store stays small. */
export async function pruneStaleData(store: Store, now: Date): Promise<void> {
  await store.prune({
    membersSeenBefore: now.getTime() - INSTANCE_MEMBERSHIP_TTL_MS,
    dailyPuzzlesBefore: puzzleNumberForDate(utcIsoDate(now)) - DAILY_GAME_RETENTION_PUZZLES,
  });
}
