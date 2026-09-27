import { Router } from 'express';
import type { FlockResponse, OkResponse } from '@birdle/shared';
import { currentUser } from '../auth';
import type { FlockService } from '../flock';
import type { Clock } from '../runtime';
import { bodyObject, requireInstanceId, requirePlayableDate } from '../validate';

export function instanceRoutes(flock: FlockService, clock: Clock): Router {
  const router = Router();

  // POST /api/instances/:instanceId/join { date } -> { ok: true }
  router.post('/instances/:instanceId/join', async (req, res) => {
    const instanceId = requireInstanceId(req.params.instanceId);
    requirePlayableDate(bodyObject(req).date, clock.now());
    await flock.join(instanceId, currentUser(res).id);
    const body: OkResponse = { ok: true };
    res.json(body);
  });

  // GET /api/instances/:instanceId/flock?date=YYYY-MM-DD -> { players } (403 unless joined)
  router.get('/instances/:instanceId/flock', async (req, res) => {
    const instanceId = requireInstanceId(req.params.instanceId);
    const date = requirePlayableDate(req.query.date, clock.now());
    const body: FlockResponse = { players: await flock.flock(instanceId, currentUser(res).id, date) };
    res.json(body);
  });

  return router;
}
