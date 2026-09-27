import { localIsoDate, type PlayerProfile, type Stats } from '@birdle/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createApi, type Api } from './api';
import { authenticate } from './discord/auth';
import { describeError } from './discord/errors';
import { lockPortraitOnMobile } from './discord/mobile';
import { configureMock, type DiscordEnv } from './discord/sdk';

export interface Session {
  api: Api;
  user: PlayerProfile;
  stats: Stats;
  presenceEnabled: boolean;
}

/** Signs in (Discord or mock), then loads the player's profile and stats. */
export async function startSession(env: DiscordEnv, onUnauthorized: () => void): Promise<Session> {
  const auth = await authenticate(env);
  void lockPortraitOnMobile(env);
  const api = createApi(auth.token, { onUnauthorized });
  const { user, stats } = await api.me(localIsoDate());
  // Mock participants should carry the server's id for this player, so the Flock
  // matches them up (the server decides how mock ids are stored).
  if (!env.embedded) configureMock(env.mock, env.clientId, { id: user.id, displayName: user.displayName });
  return { api, user, stats, presenceEnabled: auth.presenceEnabled };
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; session: Session }
  | { status: 'error'; title: string; message: string; detail?: string };

function failure(error: unknown, env: DiscordEnv): Extract<SessionState, { status: 'error' }> {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK') {
      return { status: 'error', title: 'No connection', message: "Can't reach the BIRDLE server. Check your connection and try again." };
    }
    if (error.code === 'UNAUTHORIZED') {
      const detail = env.embedded
        ? error.message
        : 'Browser play signs in with a mock token, which this server does not accept (see BIRDLE_ALLOW_MOCK_AUTH).';
      return { status: 'error', title: 'Sign-in failed', message: 'The BIRDLE server did not accept your sign-in.', detail };
    }
    return { status: 'error', title: 'Server trouble', message: 'The BIRDLE server could not sign you in.', detail: describeError(error) };
  }
  return { status: 'error', title: 'Discord sign-in failed', message: "We couldn't sign you in with Discord.", detail: describeError(error) };
}

const EXPIRED: SessionState = {
  status: 'error',
  title: 'Session expired',
  message: 'Your sign-in has expired. Retry to sign in again.',
};

/** Runs startSession once per attempt (StrictMode-safe); `retry` starts a new attempt. */
export function useSession(env: DiscordEnv): { state: SessionState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const started = useRef<{ attempt: number; promise: Promise<Session> } | null>(null);

  const onUnauthorized = useCallback(() => setState(EXPIRED), []);

  useEffect(() => {
    if (started.current?.attempt !== attempt) {
      started.current = { attempt, promise: startSession(env, onUnauthorized) };
    }
    let cancelled = false;
    started.current.promise.then(
      (session) => {
        if (!cancelled) setState({ status: 'ready', session });
      },
      (error: unknown) => {
        if (!cancelled) setState(failure(error, env));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [env, attempt, onUnauthorized]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}
