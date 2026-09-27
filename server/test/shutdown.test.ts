import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyStats } from '@birdle/shared';
import type { DiscordUser } from '../src/discord';
import { gracefulShutdown } from '../src/shutdown';
import { JsonFileStore } from '../src/store';
import { DISCORD_USER, RecordingLogger, TODAY, fakeDiscord, makeTestApp } from './helpers';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'birdle-shutdown-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A running server whose Discord token check waits until `verify()` is called. */
async function startServer() {
  const path = join(dir, 'db.json');
  const store = await JsonFileStore.open(path, { logger: new RecordingLogger(), saveDelayMs: 60_000 });
  let verify: (user: DiscordUser) => void = () => {};
  let markChecking = () => {};
  const checking = new Promise<void>((resolve) => (markChecking = resolve));
  const discord = fakeDiscord();
  discord.fetchUser.mockImplementation(
    () =>
      new Promise((resolve) => {
        verify = resolve;
        markChecking();
      }),
  );
  const { app } = makeTestApp({ store, discord, allowMockAuth: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;

  const guess = () =>
    fetch(`http://127.0.0.1:${port}/api/daily/guess`, {
      method: 'POST',
      headers: { Authorization: 'Bearer discord-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: TODAY, guess: 'slate', hardMode: false }),
    });
  return { path, store, server, port, guess, checking, verify: (user: DiscordUser) => verify(user) };
}

describe('gracefulShutdown', () => {
  it('lets an in-flight request finish before saving, so an answered guess is on disk', async () => {
    const { path, store, server, guess, checking, verify } = await startServer();
    const response = guess();
    await checking; // the request is waiting on its Discord token check

    const shutdown = gracefulShutdown(server, store, 5_000);
    verify(DISCORD_USER);
    const res = await response;
    expect(res.status).toBe(200);
    await shutdown;

    const saved = JSON.parse(await readFile(path, 'utf8')) as { daily: Record<string, Record<string, { guesses: unknown[] }>> };
    expect(saved.daily[DISCORD_USER.id]?.['10']?.guesses).toHaveLength(1);
  });

  it('stops accepting connections, and cuts requests still running after the grace period', async () => {
    const { store, server, port, guess, checking } = await startServer();
    const response = guess().catch((error: unknown) => error);
    await checking; // never verified: this request hangs

    const started = Date.now();
    await gracefulShutdown(server, store, 100);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(await response).toBeInstanceOf(Error);
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
  });

  it('still saves when the server never started listening', async () => {
    const path = join(dir, 'db.json');
    const store = await JsonFileStore.open(path, { logger: new RecordingLogger(), saveDelayMs: 60_000 });
    await store.saveStats('u1', emptyStats());
    const { app } = makeTestApp({ store });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await gracefulShutdown(server, store, 100);
    expect(JSON.parse(await readFile(path, 'utf8')).stats.u1).toBeDefined();
  });
});
