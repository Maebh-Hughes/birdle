import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@birdle/shared';
import { REJECTED_TOKEN_TTL_MS, bearerToken, cleanDisplayName, createAuthenticator, parseMockToken } from '../src/auth';
import { DiscordApiError, createDiscordClient } from '../src/discord';
import { DISCORD_TOKEN, DISCORD_USER, RecordingLogger, TestClock, as, fakeDiscord, makeTestApp } from './helpers';

describe('bearer tokens', () => {
  it('parses the Authorization header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc ')).toBe('abc');
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer a b')).toBeNull();
    expect(bearerToken(`Bearer ${'x'.repeat(2000)}`)).toBeNull();
  });

  it.each([
    [undefined, 'Missing bearer token'],
    ['Token abc', 'Missing bearer token'],
    ['Bearer nope', 'Invalid or expired token'],
    ['Bearer mock:', 'Invalid or expired token'],
    ['Bearer mock:has space', 'Missing bearer token'],
    ['Bearer mock:bad/id:Name', 'Invalid or expired token'],
    ['Bearer mock:alice:%E0%A4%A', 'Invalid or expired token'],
  ])('rejects Authorization %s with 401', async (header, message) => {
    const { app } = makeTestApp();
    const req = request(app).get('/api/me');
    if (header !== undefined) req.set('Authorization', header);
    const res = await req;
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message } });
  });
});

describe('mock auth', () => {
  it('parses mock tokens into profiles', () => {
    expect(parseMockToken('mock:alice')).toEqual({ id: 'alice', username: 'alice', displayName: 'alice', avatarUrl: null });
    expect(parseMockToken(`mock:u_1.x-2:${encodeURIComponent('Ada: the "Birder"')}`)).toMatchObject({
      id: 'u_1.x-2',
      displayName: 'Ada: the "Birder"',
    });
    expect(parseMockToken('mock:bob:%20%20')?.displayName).toBe('bob');
    expect(parseMockToken(`mock:${'a'.repeat(65)}`)).toBeNull();
    expect(parseMockToken('mock:ok:%ZZ')).toBeNull();
  });

  it('cleans display names', () => {
    expect(cleanDisplayName('  Ada‮\u0007  Lovelace ')).toBe('Ada Lovelace');
    expect(cleanDisplayName('x'.repeat(40))).toHaveLength(32);
    expect(cleanDisplayName('🐦'.repeat(40))).toBe('🐦'.repeat(32));
  });

  it('accepts mock tokens when enabled, without calling Discord', async () => {
    const { app, discord } = makeTestApp({ allowMockAuth: true });
    const res = await request(app).get('/api/me').set(as('alice', 'Alice 🐦'));
    expect(res.status).toBe(200);
    expect((res.body as MeResponse).user).toEqual({ id: 'alice', username: 'alice', displayName: 'Alice 🐦', avatarUrl: null });
    expect(discord.fetchUser).not.toHaveBeenCalled();
  });

  it('rejects mock tokens when mock auth is disabled (production default), without calling Discord', async () => {
    const { app, discord } = makeTestApp({ allowMockAuth: false });
    const res = await request(app).get('/api/me').set(as('alice'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(discord.fetchUser).not.toHaveBeenCalled();
  });
});

describe('Discord tokens', () => {
  it('resolves the Discord user into a profile', async () => {
    const { app } = makeTestApp({ allowMockAuth: false });
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${DISCORD_TOKEN}`);
    expect(res.status).toBe(200);
    expect((res.body as MeResponse).user).toEqual({
      id: DISCORD_USER.id,
      username: 'nelly',
      displayName: 'Nelly',
      avatarUrl: `https://cdn.discordapp.com/avatars/${DISCORD_USER.id}/${DISCORD_USER.avatar}.png?size=64`,
    });
  });

  it('falls back to the username and drops unusable avatar hashes', async () => {
    const discord = fakeDiscord();
    discord.fetchUser.mockResolvedValue({ id: '1234567890', username: 'plain', global_name: null, avatar: '../../x' });
    const { app } = makeTestApp({ discord });
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer some-token');
    expect((res.body as MeResponse).user).toEqual({ id: '1234567890', username: 'plain', displayName: 'plain', avatarUrl: null });
  });

  it('answers 502 when Discord cannot verify the token, without logging it', async () => {
    const discord = fakeDiscord();
    discord.fetchUser.mockRejectedValue(new DiscordApiError('Discord user lookup failed (HTTP 500)', 500));
    const logger = new RecordingLogger();
    const { app } = makeTestApp({ discord, logger });
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer secret-token-value');
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(logger.text).toContain('HTTP 500');
    expect(logger.text).not.toContain('secret-token-value');
  });

  it('caches token lookups for 5 minutes and coalesces concurrent ones', async () => {
    const discord = fakeDiscord();
    const clock = new TestClock();
    const auth = createAuthenticator({ discord, allowMockAuth: false, clock, logger: new RecordingLogger() });
    const [a, b] = await Promise.all([auth.authenticate(DISCORD_TOKEN), auth.authenticate(DISCORD_TOKEN)]);
    expect(a).toEqual(b);
    expect(discord.fetchUser).toHaveBeenCalledTimes(1);

    clock.advanceMs(4 * 60_000);
    await auth.authenticate(DISCORD_TOKEN);
    expect(discord.fetchUser).toHaveBeenCalledTimes(1);

    clock.advanceMs(2 * 60_000);
    await auth.authenticate(DISCORD_TOKEN);
    expect(discord.fetchUser).toHaveBeenCalledTimes(2);
  });

  it('remembers rejected tokens for a minute, so repeating one does not reach Discord', async () => {
    const discord = fakeDiscord();
    const clock = new TestClock();
    const auth = createAuthenticator({ discord, allowMockAuth: false, clock, logger: new RecordingLogger() });
    for (let i = 0; i < 20; i++) expect(await auth.authenticate('bad')).toBeNull();
    expect(discord.fetchUser).toHaveBeenCalledTimes(1);
    expect(auth.cacheSize).toBe(0);
    clock.advanceMs(REJECTED_TOKEN_TTL_MS);
    expect(await auth.authenticate('bad')).toBeNull();
    expect(discord.fetchUser).toHaveBeenCalledTimes(2);
  });

  it('does not cache Discord failures', async () => {
    const discord = fakeDiscord();
    discord.fetchUser.mockRejectedValueOnce(new DiscordApiError('Discord user lookup failed (HTTP 500)', 500));
    const auth = createAuthenticator({ discord, allowMockAuth: false, clock: new TestClock(), logger: new RecordingLogger() });
    await expect(auth.authenticate(DISCORD_TOKEN)).rejects.toBeInstanceOf(DiscordApiError);
    expect(await auth.authenticate(DISCORD_TOKEN)).toMatchObject({ id: DISCORD_USER.id });
    expect(discord.fetchUser).toHaveBeenCalledTimes(2);
  });

  it('bounds the cache by evicting the oldest entries', async () => {
    const discord = fakeDiscord();
    discord.fetchUser.mockImplementation(async (token) => ({ ...DISCORD_USER, username: token }));
    const auth = createAuthenticator({
      discord,
      allowMockAuth: false,
      clock: new TestClock(),
      logger: new RecordingLogger(),
      cacheMaxEntries: 3,
    });
    for (const token of ['t1', 't2', 't3', 't4']) await auth.authenticate(token);
    expect(auth.cacheSize).toBe(3);
    await auth.authenticate('t4');
    await auth.authenticate('t2');
    expect(discord.fetchUser).toHaveBeenCalledTimes(4);
    await auth.authenticate('t1'); // evicted
    expect(discord.fetchUser).toHaveBeenCalledTimes(5);
  });

  it('keeps stored profiles current for the Flock', async () => {
    const { app, store } = makeTestApp();
    await request(app).get('/api/me').set(as('alice', 'Old Name'));
    await request(app).get('/api/me').set(as('alice', 'New Name'));
    expect((await store.getProfile('alice'))?.displayName).toBe('New Name');
  });
});

describe('POST /api/token', () => {
  it('exchanges the code with Discord and returns only the access token', async () => {
    const { app, discord } = makeTestApp();
    const res = await request(app).post('/api/token').send({ code: 'oauth-code' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ access_token: DISCORD_TOKEN });
    expect(discord.exchangeCode).toHaveBeenCalledWith('oauth-code');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['no body', undefined],
    ['no code', {}],
    ['an empty code', { code: '  ' }],
    ['a non-string code', { code: 42 }],
    ['an oversized code', { code: 'c'.repeat(600) }],
  ])('rejects %s with 400 BAD_REQUEST', async (_label, body) => {
    const { app, discord } = makeTestApp();
    const req = request(app).post('/api/token');
    const res = await (body === undefined ? req : req.send(body));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(discord.exchangeCode).not.toHaveBeenCalled();
  });

  it('answers 502 when Discord rejects the exchange', async () => {
    const discord = fakeDiscord();
    discord.exchangeCode.mockRejectedValue(new DiscordApiError('Discord token exchange failed (HTTP 400: invalid_grant)', 400));
    const logger = new RecordingLogger();
    const { app } = makeTestApp({ discord, logger });
    const res = await request(app).post('/api/token').send({ code: 'expired-code' });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: "Couldn't complete Discord sign-in. Please try again." } });
    expect(logger.text).toContain('invalid_grant');
    expect(logger.text).not.toContain('expired-code');
  });

  it('answers 503 when the server has no Discord credentials', async () => {
    const { app } = makeTestApp({ discord: createDiscordClient({ clientId: null, clientSecret: null }) });
    const res = await request(app).post('/api/token').send({ code: 'oauth-code' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
