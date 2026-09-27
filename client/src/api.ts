import {
  API_ERROR_CODES,
  type ApiErrorCode,
  type ConfigResponse,
  type DailyGuessRequest,
  type DailyGuessResponse,
  type DailyHintRequest,
  type FlockResponse,
  type GameResponse,
  type JoinInstanceRequest,
  type MeResponse,
  type OkResponse,
  type PracticeCategory,
  type PracticeGameResponse,
  type PracticeGuessRequest,
  type PracticeNewRequest,
  type TokenResponse,
} from '@birdle/shared';

// Typed wrapper around the BIRDLE server API. Every URL is relative (/api/...):
// the Vite dev server proxies it, and inside Discord the Activity proxy maps it.

/** Server error codes plus the two failures the client detects itself. */
export type ClientErrorCode = ApiErrorCode | 'NETWORK' | 'UNKNOWN';

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly code: ClientErrorCode,
    message: string,
    /** HTTP status, or null when no response arrived. */
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ApiOptions {
  fetch?: typeof fetch;
  /** Called when the server rejects the bearer token (session expired or revoked). */
  onUnauthorized?: () => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

function codeForStatus(status: number): ClientErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  return 'UNKNOWN';
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const serverMessage = typeof error?.message === 'string' && error.message ? error.message : null;
  // The server reports its own failures (5xx) with a placeholder code; only the status is meaningful.
  if (res.status >= 500) return new ApiError('UNKNOWN', serverMessage ?? `HTTP ${res.status}`, res.status);
  if (error && isApiErrorCode(error.code)) return new ApiError(error.code, serverMessage ?? error.code, res.status);
  return new ApiError(codeForStatus(res.status), `HTTP ${res.status}`, res.status);
}

interface JsonRequest {
  method: 'GET' | 'POST';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

async function requestJson<T>(path: string, init: JsonRequest, options: ApiOptions): Promise<T> {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  let res: Response;
  try {
    res = await fetchImpl(path, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (error) {
    // A cancellation by the caller propagates as-is; anything else (offline, timeout) is a network error.
    if (init.signal?.aborted) throw error;
    throw new ApiError('NETWORK', error instanceof Error ? error.message : 'Network error');
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!res.ok) {
    const error = await errorFromResponse(res);
    if (error.code === 'UNAUTHORIZED') options.onUnauthorized?.();
    throw error;
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('UNKNOWN', 'The server sent an invalid response', res.status);
  }
}

/** POST /api/token: trades a Discord OAuth code for an access token (never called in mock mode). */
export async function exchangeCode(code: string, options: Pick<ApiOptions, 'fetch' | 'timeoutMs'> = {}): Promise<string> {
  const body = await requestJson<Partial<TokenResponse>>('/api/token', { method: 'POST', body: { code } }, options);
  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new ApiError('UNKNOWN', 'The server did not return an access token');
  }
  return body.access_token;
}

/**
 * GET /api/config: public settings the client needs before signing in (no token).
 * Validates the shape, so a proxy's error page or an old server can't pass as a config.
 */
export async function fetchConfig(options: Pick<ApiOptions, 'fetch' | 'timeoutMs'> = {}): Promise<ConfigResponse> {
  const body = await requestJson<Partial<ConfigResponse> | null>('/api/config', { method: 'GET' }, options);
  const id = body?.discordClientId;
  if (id !== null && (typeof id !== 'string' || id.trim() === '')) {
    throw new ApiError('UNKNOWN', 'The server sent an invalid configuration');
  }
  return { discordClientId: id === null ? null : id.trim() };
}

export interface Api {
  /** `date` is the player's local puzzle date, so streaks are shown as of their "today". */
  me(date: string, options?: RequestOptions): Promise<MeResponse>;
  daily(date: string, options?: RequestOptions): Promise<GameResponse>;
  dailyGuess(body: DailyGuessRequest, options?: RequestOptions): Promise<DailyGuessResponse>;
  dailyHint(body: DailyHintRequest, options?: RequestOptions): Promise<GameResponse>;
  practice(options?: RequestOptions): Promise<PracticeGameResponse>;
  /** Starts a Free Flight round with an answer from `category`. */
  practiceNew(category: PracticeCategory, options?: RequestOptions): Promise<GameResponse>;
  practiceGuess(body: PracticeGuessRequest, options?: RequestOptions): Promise<GameResponse>;
  practiceHint(options?: RequestOptions): Promise<GameResponse>;
  joinInstance(instanceId: string, body: JoinInstanceRequest, options?: RequestOptions): Promise<OkResponse>;
  flock(instanceId: string, date: string, options?: RequestOptions): Promise<FlockResponse>;
}

/** API client authenticated with `token` (a Discord access token or a `mock:` token). */
export function createApi(token: string, options: ApiOptions = {}): Api {
  const get = <T>(path: string, opts?: RequestOptions) =>
    requestJson<T>(path, { method: 'GET', token, signal: opts?.signal }, options);
  const post = <T>(path: string, body: unknown, opts?: RequestOptions) =>
    requestJson<T>(path, { method: 'POST', body, token, signal: opts?.signal }, options);
  const instancePath = (instanceId: string) => `/api/instances/${encodeURIComponent(instanceId)}`;

  return {
    me: (date, opts) => get(`/api/me?date=${encodeURIComponent(date)}`, opts),
    daily: (date, opts) => get(`/api/daily?date=${encodeURIComponent(date)}`, opts),
    dailyGuess: (body, opts) => post('/api/daily/guess', body, opts),
    dailyHint: (body, opts) => post('/api/daily/hint', body, opts),
    practice: (opts) => get('/api/practice', opts),
    practiceNew: (category, opts) => post('/api/practice/new', { category } satisfies PracticeNewRequest, opts),
    practiceGuess: (body, opts) => post('/api/practice/guess', body, opts),
    practiceHint: (opts) => post('/api/practice/hint', {}, opts),
    joinInstance: (instanceId, body, opts) => post(`${instancePath(instanceId)}/join`, body, opts),
    flock: (instanceId, date, opts) => get(`${instancePath(instanceId)}/flock?date=${encodeURIComponent(date)}`, opts),
  };
}
