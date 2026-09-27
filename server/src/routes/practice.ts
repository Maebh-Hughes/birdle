import { Router } from 'express';
import type { GameResponse, PracticeGameResponse } from '@birdle/shared';
import { currentUser } from '../auth';
import type { GameService } from '../game';
import { bodyObject, optionalCategory, optionalHardMode, requireGuess } from '../validate';

/** Free Flight: unlimited random games, never counted in stats or shown in the Flock. */
export function practiceRoutes(games: GameService): Router {
  const router = Router();

  // GET /api/practice -> { game: GameView | null }
  router.get('/practice', async (_req, res) => {
    const body: PracticeGameResponse = { game: await games.getPractice(currentUser(res).id) };
    res.json(body);
  });

  // POST /api/practice/new { category? } -> { game } (replaces any current practice game)
  router.post('/practice/new', async (req, res) => {
    const category = optionalCategory(bodyObject(req));
    const body: GameResponse = { game: await games.newPractice(currentUser(res).id, category) };
    res.json(body);
  });

  // POST /api/practice/guess { guess, hardMode } -> { game }
  router.post('/practice/guess', async (req, res) => {
    const input = bodyObject(req);
    const guess = requireGuess(input);
    const hardMode = optionalHardMode(input);
    const body: GameResponse = { game: await games.guessPractice(currentUser(res).id, guess, hardMode) };
    res.json(body);
  });

  // POST /api/practice/hint -> { game }
  router.post('/practice/hint', async (req, res) => {
    bodyObject(req);
    const body: GameResponse = { game: await games.hintPractice(currentUser(res).id) };
    res.json(body);
  });

  return router;
}
