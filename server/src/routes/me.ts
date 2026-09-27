import { Router } from 'express';
import { isPlayableDate, puzzleNumberForDate, utcIsoDate, type MeResponse } from '@birdle/shared';
import { currentUser } from '../auth';
import type { GameService } from '../game';
import type { Clock } from '../runtime';

/**
 * GET /api/me[?date=YYYY-MM-DD] -> { user, stats }. Streaks are displayed as of
 * the given local date's puzzle, so a lapsed streak shows 0. The date is only a
 * display hint: a missing or unplayable one (a device clock days off) falls back
 * to today's UTC date instead of failing sign-in, which would lock the player out
 * of Free Flight too.
 */
export function meRoutes(games: GameService, clock: Clock): Router {
  const router = Router();

  router.get('/me', async (req, res) => {
    const user = currentUser(res);
    const now = clock.now();
    const requested = req.query.date;
    const date = isPlayableDate(requested, now) ? requested : utcIsoDate(now);
    const body: MeResponse = { user, stats: await games.stats(user.id, puzzleNumberForDate(date)) };
    res.json(body);
  });

  return router;
}
