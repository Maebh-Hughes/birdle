import { describe, expect, it, vi } from 'vitest';
import { DiscordApiError, DiscordNotConfiguredError, createDiscordClient } from '../src/discord';

type FetchArgs = Parameters<typeof fetch>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function setup(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const client = createDiscordClient({ clientId: '123456789012345678', clientSecret: 's3cret', fetch: fetchMock, sleep });
  return { client, fetchMock, sleep };
}

describe('exchangeCode', () => {
  it('posts the documented form fields (no redirect_uri) and returns the access token', async () => {
    const { client, fetchMock } = setup(
      json({ access_token: 'tok', token_type: 'Bearer', expires_in: 604800, refresh_token: 'r', scope: 'identify' }),
    );
    await expect(client.exchangeCode('the-code')).resolves.toBe('tok');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://discord.com/api/oauth2/token');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(init?.body as URLSearchParams);
    expect(Object.fromEntries(form)).toEqual({
      client_id: '123456789012345678',
      client_secret: 's3cret',
      grant_type: 'authorization_code',
      code: 'the-code',
    });
  });

  it('retries once on 429, honouring retry_after', async () => {
    const { client, fetchMock, sleep } = setup(json({ retry_after: 0.4, global: false }, 429), json({ access_token: 'tok' }));
    await expect(client.exchangeCode('c')).resolves.toBe('tok');
    expect(sleep).toHaveBeenCalledWith(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up on a second 429 or a long wait', async () => {
    const twice = setup(json({ retry_after: 0.1 }, 429), json({ retry_after: 0.1 }, 429));
    await expect(twice.client.exchangeCode('c')).rejects.toMatchObject({ status: 429 });
    expect(twice.fetchMock).toHaveBeenCalledTimes(2);

    const long = setup(json({ retry_after: 3600 }, 429));
    await expect(long.client.exchangeCode('c')).rejects.toBeInstanceOf(DiscordApiError);
    expect(long.sleep).not.toHaveBeenCalled();
  });

  it('reports Discord errors without echoing the code or secret', async () => {
    const { client } = setup(json({ error: 'invalid_grant', error_description: 'Invalid "code" in request.' }, 400));
    const error = (await client.exchangeCode('secret-code').catch((e: unknown) => e)) as DiscordApiError;
    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('Discord token exchange failed (HTTP 400: invalid_grant)');
    expect(error.message).not.toMatch(/secret/);
  });

  it('treats network failures and missing tokens as Discord errors', async () => {
    const offline = setup(new TypeError('fetch failed'));
    await expect(offline.client.exchangeCode('c')).rejects.toMatchObject({ status: null });
    const empty = setup(json({ token_type: 'Bearer' }));
    await expect(empty.client.exchangeCode('c')).rejects.toBeInstanceOf(DiscordApiError);
  });

  it('refuses to run without credentials', async () => {
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();
    const client = createDiscordClient({ clientId: null, clientSecret: 'x', fetch: fetchMock });
    await expect(client.exchangeCode('c')).rejects.toBeInstanceOf(DiscordNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const NELLY = { id: '80351110224678912', username: 'nelly', global_name: 'Nelly', avatar: null, discriminator: '0' };

/** A GET /oauth2/@me body; `user` is missing when the token lacks the identify scope. */
function authorization(applicationId: string, user?: unknown) {
  return { application: { id: applicationId, name: 'Some app' }, scopes: ['identify'], expires: '2026-10-12T00:00:00+00:00', user };
}

describe('fetchUser', () => {
  it('reads /oauth2/@me with the bearer token', async () => {
    const { client, fetchMock } = setup(json(authorization('123456789012345678', NELLY)));
    await expect(client.fetchUser('tok')).resolves.toEqual({
      id: '80351110224678912',
      username: 'nelly',
      global_name: 'Nelly',
      avatar: null,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://discord.com/api/v10/oauth2/@me');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
  });

  it('rejects tokens issued to another application or without the identify scope', async () => {
    expect(await setup(json(authorization('999999999999999999', NELLY))).client.fetchUser('other-app')).toBeNull();
    expect(await setup(json(authorization('123456789012345678'))).client.fetchUser('no-identify')).toBeNull();
  });

  it('rejects every token without calling Discord when no application id is configured', async () => {
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();
    const client = createDiscordClient({ clientId: null, clientSecret: null, fetch: fetchMock });
    expect(await client.fetchUser('tok')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for rejected tokens and throws for Discord outages', async () => {
    expect(await setup(json({ message: '401: Unauthorized', code: 0 }, 401)).client.fetchUser('bad')).toBeNull();
    await expect(setup(json({}, 502)).client.fetchUser('tok')).rejects.toMatchObject({ status: 502 });
    await expect(setup(json({ id: 42 })).client.fetchUser('tok')).rejects.toBeInstanceOf(DiscordApiError);
    await expect(setup(json(authorization('123456789012345678', { id: 42 }))).client.fetchUser('tok')).rejects.toBeInstanceOf(
      DiscordApiError,
    );
  });
});
