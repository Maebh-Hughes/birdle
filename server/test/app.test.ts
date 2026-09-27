import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store';
import { RecordingLogger, TODAY, as, makeTestApp } from './helpers';

describe('API basics', () => {
  it('GET /api/health needs no auth', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeUndefined(); // must stay embeddable in Discord
  });

  it('GET /api/config needs no auth and returns only the public client id', async () => {
    for (const discordClientId of ['123456789012345678', null]) {
      const { app } = makeTestApp({ discordClientId });
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({ discordClientId });
    }
    // A bearer token changes nothing.
    const { app } = makeTestApp({ discordClientId: '123456789012345678' });
    expect((await request(app).get('/api/config').set(as('alice'))).body).toEqual({ discordClientId: '123456789012345678' });
  });

  it('answers unknown API routes with 404 NOT_FOUND', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/nope').set(as('alice'));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'No such API route' } });
  });

  it('rejects malformed JSON with 400 BAD_REQUEST', async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .post('/api/daily/guess')
      .set(as('alice'))
      .set('Content-Type', 'application/json')
      .send('{"date": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
  });

  it('rejects oversized bodies with 413', async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .post('/api/daily/guess')
      .set(as('alice'))
      .send({ date: TODAY, guess: 'slate', padding: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'Request body too large' } });
  });

  it('turns unexpected failures into a logged 500 without internals', async () => {
    class BrokenStore extends MemoryStore {
      override async getStats(): Promise<never> {
        throw new Error('disk on fire');
      }
    }
    const logger = new RecordingLogger();
    const { app } = makeTestApp({ store: new BrokenStore(), logger });
    const res = await request(app).get('/api/me').set(as('alice'));
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.text).not.toContain('disk on fire');
    expect(logger.text).toContain('disk on fire');
  });

  it('does not serve the client outside production', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(404);
  });
});

describe('production static serving', () => {
  let dist: string;
  const indexHtml = '<!doctype html><title>BIRDLE</title><div id="root"></div>';

  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), 'birdle-dist-'));
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'index.html'), indexHtml);
    await writeFile(join(dist, 'assets', 'index-abc123.js'), 'console.log("birdle")');
    await writeFile(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  });
  afterAll(async () => {
    await rm(dist, { recursive: true, force: true });
  });

  it('serves index.html with no-cache at / and as the SPA fallback', async () => {
    const { app } = makeTestApp({ clientDistDir: dist });
    for (const path of ['/', '/stats', '/some/deep/link?frame_id=1&instance_id=2&platform=desktop', '/index.html']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toBe(indexHtml);
    }
  });

  it('caches hashed assets forever and never answers a missing file with HTML', async () => {
    const { app } = makeTestApp({ clientDistDir: dist });
    const asset = await request(app).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(app).get('/favicon.svg')).headers['cache-control']).toBe('public, max-age=3600');

    const missing = await request(app).get('/assets/index-old.js');
    expect(missing.status).toBe(404);
    expect(missing.headers['content-type']).not.toMatch(/html/);
  });

  it('serves the page when the install path has a dot-directory (e.g. ~/.local)', async () => {
    const hidden = join(dist, '.hidden', 'dist');
    await mkdir(hidden, { recursive: true });
    await writeFile(join(hidden, 'index.html'), indexHtml);
    const { app } = makeTestApp({ clientDistDir: hidden });
    for (const path of ['/', '/?frame_id=1&instance_id=2&platform=desktop', '/practice', '/index.html']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.text).toBe(indexHtml);
    }
    // Dotfiles inside the build are still not served.
    await writeFile(join(hidden, '.env'), 'SECRET=1');
    expect((await request(app).get('/.env')).text).not.toContain('SECRET');
  });

  it('keeps API routes and errors as JSON', async () => {
    const { app } = makeTestApp({ clientDistDir: dist });
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true });
    const unknown = await request(app).get('/api/unknown').set(as('alice'));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
    expect((await request(app).post('/stats')).status).toBe(404);
  });
});
