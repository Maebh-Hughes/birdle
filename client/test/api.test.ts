import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, exchangeCode, fetchConfig } from '../src/api';
import { errorMessage, isRejectedGuess, NETWORK_MESSAGE, practiceStartMessage, UNKNOWN_MESSAGE } from '../src/game/errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('api client', () => {
  it('sends the bearer token and JSON body to relative /api URLs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, { game: { status: 'playing' }, stats: {} }));
    const api = createApi('mock:alice:Alice', { fetch });
    await api.dailyGuess({ date: '2026-10-02', guess: 'STORK', hardMode: false });

    const [url, init = {}] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/daily/guess');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer mock:alice:Alice');
    expect(JSON.parse(String(init.body))).toEqual({ date: '2026-10-02', guess: 'STORK', hardMode: false });
  });

  it('encodes path and query parameters', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, { players: [] }));
    await createApi('t', { fetch }).flock('a/b', '2026-10-02');
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/instances/a%2Fb/flock?date=2026-10-02');
  });

  it("asks /api/me for stats as of the player's local date", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, { user: {}, stats: {} }));
    await createApi('t', { fetch }).me('2026-10-02');
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/me?date=2026-10-02');
  });

  it('turns error bodies into ApiErrors with the server code', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(422, { error: { code: 'HARD_MODE', message: '2nd letter must be R' } }));
    const error = await createApi('t', { fetch }).practiceGuess({ guess: 'STORK', hardMode: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'HARD_MODE', status: 422, message: '2nd letter must be R' });
    expect(errorMessage(error)).toBe('2nd letter must be R');
    expect(isRejectedGuess(error)).toBe(true);
  });

  it('falls back to the HTTP status when the body is not an API error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await createApi('t', { fetch }).me('2026-10-02').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'UNKNOWN', status: 502 });
    expect(errorMessage(error)).toBe(UNKNOWN_MESSAGE);
  });

  it('treats server failures (5xx) as UNKNOWN whatever placeholder code they carry', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse(502, { error: { code: 'BAD_REQUEST', message: "Couldn't verify your Discord sign-in. Please try again." } }),
    );
    const error = await createApi('t', { fetch }).me('2026-10-02').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'UNKNOWN', status: 502, message: "Couldn't verify your Discord sign-in. Please try again." });
    expect(errorMessage(error)).toBe(UNKNOWN_MESSAGE);
  });

  it('reports 401 through onUnauthorized', async () => {
    const onUnauthorized = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }));
    await expect(createApi('t', { fetch, onUnauthorized }).me('2026-10-02')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('maps a failed fetch to a NETWORK error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await createApi('t', { fetch }).me('2026-10-02').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'NETWORK' });
    expect(errorMessage(error)).toBe(NETWORK_MESSAGE);
  });

  it('uses the default message for codes whose server text is not player-facing', () => {
    expect(errorMessage(new ApiError('NOT_IN_WORD_LIST', 'guess "XYZZY" is not a word', 422))).toBe('Not in word list');
    expect(errorMessage(new ApiError('NOT_FOUND', 'No practice game yet; start one with POST /api/practice/new', 404))).toBe('Not found');
    expect(isRejectedGuess(new ApiError('GAME_OVER', 'over', 409))).toBe(false);
  });

  it("shows the server's INVALID_GUESS text, which names the exact problem", () => {
    expect(errorMessage(new ApiError('INVALID_GUESS', 'Too many letters', 422))).toBe('Too many letters');
    expect(errorMessage(new ApiError('INVALID_GUESS', 'INVALID_GUESS', 422))).toBe('Not enough letters');
  });

  it('exchangeCode posts the code without a bearer token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, { access_token: 'abc' }));
    expect(await exchangeCode('code-1', { fetch })).toBe('abc');
    const [url, init = {}] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/token');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({ code: 'code-1' });
  });

  it('starts a Free Flight round in the chosen category', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, { game: { status: 'playing' } }));
    await createApi('t', { fetch }).practiceNew('pokemon');
    const [url, init = {}] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/practice/new');
    expect(JSON.parse(String(init.body))).toEqual({ category: 'pokemon' });
  });

  it("shows the server's reason when a Free Flight category can't start, and the usual text otherwise", () => {
    const reason = 'There are no bird Pokémon in Free Flight yet. Pick another category.';
    expect(practiceStartMessage(new ApiError('BAD_REQUEST', reason, 400))).toBe(reason);
    expect(practiceStartMessage(new ApiError('NETWORK', 'Failed to fetch'))).toBe(NETWORK_MESSAGE);
    expect(practiceStartMessage(new ApiError('BAD_REQUEST', 'Too many requests', 429))).toBe(errorMessage(new ApiError('BAD_REQUEST', 'x', 429)));
  });
});

describe('fetchConfig', () => {
  it('reads GET /api/config without a bearer token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, { discordClientId: ' 123456789012345678 ' }));
    await expect(fetchConfig({ fetch })).resolves.toEqual({ discordClientId: '123456789012345678' });
    const [url, init = {}] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/config');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('accepts a server without a client id (null)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, { discordClientId: null }));
    await expect(fetchConfig({ fetch })).resolves.toEqual({ discordClientId: null });
  });

  it.each([{}, { discordClientId: '' }, { discordClientId: 42 }, null, 'nope'])('rejects a malformed config %j', async (body) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, body));
    await expect(fetchConfig({ fetch })).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});
