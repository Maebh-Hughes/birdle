// BIRDLE server entry point: loads the root .env, validates config and word data,
// opens the JSON database and serves /api (plus the built client in production).

import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createApp } from './app';
import { ConfigError, ROOT_DIR, loadConfig } from './config';
import { createDiscordClient } from './discord';
import { pruneStaleData } from './maintenance';
import { gracefulShutdown } from './shutdown';
import { JsonFileStore } from './store';

const PRUNE_INTERVAL_MS = 60 * 60_000;
/** How long in-flight requests get to finish on shutdown. */
const SHUTDOWN_GRACE_MS = 5_000;
/** Hard limit for the whole shutdown, saving included. */
const SHUTDOWN_TIMEOUT_MS = 10_000;
/** SIGHUP: terminal or (on Windows) console window closed; SIGBREAK: Ctrl+Break on Windows. */
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const;

function describeStartupError(error: unknown): string {
  if (error instanceof ConfigError) return error.message;
  const problems = (error as { problems?: unknown } | null)?.problems;
  if (error instanceof Error && Array.isArray(problems)) {
    // BirdleDataError from @birdle/shared/server: the word data is malformed.
    return `${error.message}\n${problems.map((problem) => `  - ${String(problem)}`).join('\n')}`;
  }
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

async function main(): Promise<void> {
  loadDotenv({ path: join(ROOT_DIR, '.env'), quiet: true });
  const { config, warnings } = loadConfig(process.env);
  for (const warning of warnings) console.warn(`[config] ${warning}`);

  // Imported here (not at the top) so a data error is reported like any other startup error.
  const { wordCatalog } = await import('@birdle/shared/server');
  const store = await JsonFileStore.open(config.dataFile);

  if (config.clientDistDir && !existsSync(join(config.clientDistDir, 'index.html'))) {
    console.warn(`[static] ${config.clientDistDir} has no index.html; run \`npm run build\` to serve the client.`);
  }

  const app = createApp({
    config,
    store,
    discord: createDiscordClient({ clientId: config.discordClientId, clientSecret: config.discordClientSecret }),
    words: wordCatalog,
  });

  const prune = (): void => {
    pruneStaleData(store, new Date()).catch((error: unknown) => console.error('Pruning stale data failed:', error));
  };
  prune();
  setInterval(prune, PRUNE_INTERVAL_MS).unref();

  const server: Server = app.listen(config.port);
  server.on('listening', () => {
    const mode = config.isProduction ? 'production' : 'development';
    console.info(
      `BIRDLE server (${mode}) on http://localhost:${config.port} with ${wordCatalog.birds.length} answers ` +
        `(${wordCatalog.dailyPool.length} daily), ${wordCatalog.guessCount} valid guesses; ` +
        `mock auth ${config.allowMockAuth ? 'ON' : 'off'}; data in ${store.path}`,
    );
  });

  let shuttingDown = false;
  const shutdown = (reason: string, exitCode: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`${reason}; finishing requests, saving data and shutting down...`);
    setTimeout(() => {
      console.error('Shutdown timed out; exiting.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    gracefulShutdown(server, store, SHUTDOWN_GRACE_MS).then(
      () => process.exit(exitCode),
      (error: unknown) => {
        console.error('Failed to save data on shutdown:', error);
        process.exit(1);
      },
    );
  };

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') console.error(`Port ${config.port} is already in use (set PORT in .env).`);
    else console.error('Server error:', error);
    shutdown('Server error', 1);
  });
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, () => shutdown(`${signal} received`, 0));
}

main().catch((error: unknown) => {
  console.error(`BIRDLE server failed to start:\n${describeStartupError(error)}`);
  process.exit(1);
});
