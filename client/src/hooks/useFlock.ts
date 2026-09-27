import type { FlockPlayer } from '@birdle/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, type Api } from '../api';
import { describeError } from '../discord/errors';
import { watchParticipants, type Participant } from '../discord/participants';
import type { DiscordEnv } from '../discord/sdk';
import { mergeFlock, type FlockEntry } from '../flock';

export const FLOCK_POLL_MS = 5_000;
const NO_PLAYERS: FlockPlayer[] = [];

interface UseFlockOptions {
  env: DiscordEnv;
  api: Api;
  /** The daily puzzle date the Flock is about. */
  date: string;
  selfId: string;
}

export interface FlockController {
  entries: FlockEntry[];
  /** Fetch now (e.g. right after the player's own guess). */
  refresh: () => void;
}

/**
 * The Flock: joins this Activity instance on the server, polls its colours-only
 * progress every 5 s while the page is visible, and merges in Discord's live
 * participant list so connected players who haven't played show as idle.
 */
export function useFlock({ env, api, date, selfId }: UseFlockOptions): FlockController {
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [players, setPlayers] = useState<{ date: string; list: FlockPlayer[] }>({ date, list: [] });

  const dateRef = useRef(date);
  const joinedDate = useRef<string | null>(null);
  const inFlight = useRef(false);
  const rerun = useRef(false);

  const sync = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      rerun.current = true;
      return;
    }
    inFlight.current = true;
    const day = dateRef.current;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (joinedDate.current !== day) {
            await api.joinInstance(env.instanceId, { date: day });
            joinedDate.current = day;
          }
          const { players: list } = await api.flock(env.instanceId, day);
          if (dateRef.current === day) setPlayers({ date: day, list });
          return;
        } catch (error) {
          // 403 = the server forgot (or never saw) our join: join again once.
          if (error instanceof ApiError && error.code === 'FORBIDDEN' && attempt === 0) {
            joinedDate.current = null;
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      console.warn('BIRDLE: could not update the Flock:', describeError(error));
    } finally {
      inFlight.current = false;
      if (rerun.current) {
        rerun.current = false;
        void sync();
      }
    }
  }, [api, env.instanceId]);

  // Discord participants: subscribe, then snapshot.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => Promise<void>) | null = null;
    watchParticipants(env.sdk, (list) => {
      if (!cancelled) setParticipants(list);
    })
      .then((unsubscribe) => {
        if (cancelled) void unsubscribe();
        else stop = unsubscribe;
      })
      .catch((error: unknown) => console.warn('BIRDLE: participant updates unavailable:', describeError(error)));
    return () => {
      cancelled = true;
      void stop?.();
    };
  }, [env.sdk]);

  // (Re)join and fetch whenever the puzzle date changes.
  useEffect(() => {
    dateRef.current = date;
    void sync();
  }, [date, sync]);

  // Someone joined or left: their progress may have changed what we show.
  useEffect(() => {
    if (participants !== null) void sync();
  }, [participants, sync]);

  // Poll while visible; catch up as soon as the page is shown again.
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible';
    const timer = window.setInterval(() => {
      if (visible()) void sync();
    }, FLOCK_POLL_MS);
    const onVisibility = () => {
      if (visible()) void sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sync]);

  const list = players.date === date ? players.list : NO_PLAYERS;
  const entries = useMemo(
    () => mergeFlock(list, participants, selfId, env.embedded),
    [list, participants, selfId, env.embedded],
  );
  const refresh = useCallback(() => void sync(), [sync]);
  return { entries, refresh };
}
