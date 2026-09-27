import express, { Router, type Express } from 'express';
import type { HealthResponse } from '@birdle/shared';
import type { WordCatalog } from '@birdle/shared/server';
import { createAuthenticator, requireAuth } from './auth';
import type { Config } from './config';
import type { DiscordClient } from './discord';
import { guardDiscordClient, type DiscordLimits } from './discordGuard';
import { apiNotFound, errorHandler } from './errors';
import { FlockService } from './flock';
import { GameService } from './game';
import { createPuzzles } from './puzzle';
import { dailyRoutes } from './routes/daily';
import { instanceRoutes } from './routes/instances';
import { meRoutes } from './routes/me';
import { practiceRoutes } from './routes/practice';
import { tokenRoutes } from './routes/token';
import { systemClock, type Clock, type Logger } from './runtime';
import { clientStatic } from './static';
import type { Store } from './store';

/** Largest accepted JSON request body. Real requests are well under 1 KB. */
export const JSON_BODY_LIMIT = '16kb';

export type AppConfig = Pick<Config, 'allowMockAuth' | 'puzzleSeed' | 'clientDistDir'>;

export interface AppDeps {
  config: AppConfig;
  store: Store;
  discord: DiscordClient;
  /** Answers and the guess dictionary (inject a fixture catalog in tests). */
  words: WordCatalog;
  clock?: Clock;
  /** Random source for practice answers (default Math.random). */
  random?: () => number;
  logger?: Logger;
  /** Token cache tuning (defaults: 5 minutes, 1000 entries). */
  authCache?: { ttlMs?: number; maxEntries?: number };
  /** Budget of Discord calls (defaults: DEFAULT_DISCORD_LIMITS). */
  discordLimits?: Partial<DiscordLimits>;
}

export function createApp(deps: AppDeps): Express {
  const clock = deps.clock ?? systemClock;
  const logger = deps.logger ?? console;
  const puzzles = createPuzzles(deps.words, deps.config.puzzleSeed);
  const games = new GameService({ store: deps.store, puzzles, random: deps.random ?? Math.random });
  const flock = new FlockService({ store: deps.store, clock });
  const discord = guardDiscordClient(deps.discord, { clock, logger, limits: deps.discordLimits });
  const authenticator = createAuthenticator({
    discord,
    allowMockAuth: deps.config.allowMockAuth,
    clock,
    logger,
    cacheTtlMs: deps.authCache?.ttlMs,
    cacheMaxEntries: deps.authCache?.maxEntries,
  });

  const app = express();
  app.disable('x-powered-by');
  // Deliberately no X-Frame-Options: the page must load inside Discord's iframe.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  const api = Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: JSON_BODY_LIMIT }));

  api.get('/health', (_req, res) => {
    const body: HealthResponse = { ok: true };
    res.json(body);
  });
  api.use(tokenRoutes(discord, logger));

  api.use(requireAuth(authenticator, logger, (profile) => games.syncProfile(profile)));
  api.use(meRoutes(games, clock));
  api.use(dailyRoutes(games, clock));
  api.use(practiceRoutes(games));
  api.use(instanceRoutes(flock, clock));
  api.use(apiNotFound);

  app.use('/api', api);
  if (deps.config.clientDistDir) app.use(clientStatic(deps.config.clientDistDir));
  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.use(errorHandler(logger));

  return app;
}
