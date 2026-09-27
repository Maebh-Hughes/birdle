import { Router } from 'express';
import type { DailyGuessResponse, GameResponse } from '@birdle/shared';
import { currentUser } from '../auth';
import type { GameService } from '../game';
import type { Clock } from '../runtime';
import { bodyObject, optionalHardMode, requireGuess, requirePlayableDate } from '../validate';

export function dailyRoutes(games: GameService, clock: Clock): Router {
  const router = Router();

  // GET /api/daily?date=YYYY-MM-DD -> { game }
  router.get('/daily', async (req, res) => {
    const date = requirePlayableDate(req.query.date, clock.now());
    const body: GameResponse = { game: await games.getDaily(currentUser(res).id, date) };
    res.json(body);
  });

  // POST /api/daily/guess { date, guess, hardMode } -> { game, stats }
  router.post('/daily/guess', async (req, res) => {
    const input = bodyObject(req);
    const date = requirePlayableDate(input.date, clock.now());
    const guess = requireGuess(input);
    const hardMode = optionalHardMode(input);
    const body: DailyGuessResponse = await games.guessDaily(currentUser(res).id, date, guess, hardMode);
    res.json(body);
  });

  // POST /api/daily/hint { date } -> { game }
  router.post('/daily/hint', async (req, res) => {
    const date = requirePlayableDate(bodyObject(req).date, clock.now());
    const body: GameResponse = { game: await games.hintDaily(currentUser(res).id, date) };
    res.json(body);
  });

  return router;
}
