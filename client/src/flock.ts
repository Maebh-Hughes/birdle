import type { FlockPlayer, FlockStatus } from '@birdle/shared';
import { participantAvatarUrl, participantName, type Participant } from './discord/participants';

/** One row of the Flock panel: a server-side player and/or a connected Activity participant. */
export interface FlockEntry extends FlockPlayer {
  /** Currently in the Activity instance (players who left but played today stay listed). */
  connected: boolean;
  isSelf: boolean;
}

const STATUS_ORDER: Record<FlockStatus, number> = { won: 0, playing: 1, lost: 2, idle: 3 };

function compareEntries(a: FlockEntry, b: FlockEntry): number {
  if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
  const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  // Winners with fewer guesses first; players further along first.
  if (a.status === 'won' && a.rows.length !== b.rows.length) return a.rows.length - b.rows.length;
  if (a.status === 'playing' && a.rows.length !== b.rows.length) return b.rows.length - a.rows.length;
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Merges the server's Flock (players who joined this instance, colours only)
 * with Discord's connected participants: connected participants who haven't
 * played show as idle. `participants` is null until the SDK has answered.
 * With `trackConnections` off (mock mode, where the participant list is fake)
 * every listed player counts as connected.
 */
export function mergeFlock(
  players: readonly FlockPlayer[],
  participants: readonly Participant[] | null,
  selfId: string,
  trackConnections = true,
): FlockEntry[] {
  const connected = new Map((participants ?? []).filter((p) => !p.bot).map((p) => [p.id, p]));
  const entries: FlockEntry[] = players.map((player) => {
    const participant = connected.get(player.id);
    return {
      ...player,
      displayName: participant ? participantName(participant) : player.displayName,
      avatarUrl: player.avatarUrl ?? (participant ? participantAvatarUrl(participant) : null),
      connected: !trackConnections || participants === null || participant !== undefined,
      isSelf: player.id === selfId,
    };
  });

  const listed = new Set(players.map((player) => player.id));
  for (const participant of connected.values()) {
    if (listed.has(participant.id)) continue;
    entries.push({
      id: participant.id,
      username: participant.username,
      displayName: participantName(participant),
      avatarUrl: participantAvatarUrl(participant),
      status: 'idle',
      rows: [],
      hintUsed: false,
      hardMode: false,
      connected: true,
      isSelf: participant.id === selfId,
    });
  }
  return entries.sort(compareEntries);
}

/**
 * While the player's own daily guess is still flipping, shows their Flock row
 * as it was before that guess, so the panel doesn't give the result (or a win)
 * away ahead of the board. `revealedRows` is the number of settled rows, or
 * null when nothing is flipping.
 */
export function hideUnrevealedRows(entries: FlockEntry[], revealedRows: number | null): FlockEntry[] {
  if (revealedRows === null) return entries;
  return entries.map((entry) =>
    entry.isSelf && entry.rows.length > revealedRows
      ? { ...entry, rows: entry.rows.slice(0, revealedRows), status: revealedRows === 0 ? 'idle' : 'playing' }
      : entry,
  );
}

/** Short status line, e.g. "Solved 4/6", "Guess 3 of 6", "Stumped", "Not started". */
export function flockStatusText(entry: Pick<FlockEntry, 'status' | 'rows'>, maxGuesses: number): string {
  switch (entry.status) {
    case 'won':
      return `Solved ${entry.rows.length}/${maxGuesses}`;
    case 'lost':
      return `Stumped X/${maxGuesses}`;
    case 'playing':
      return entry.rows.length === 0 ? 'Just started' : `Guess ${Math.min(entry.rows.length + 1, maxGuesses)} of ${maxGuesses}`;
    case 'idle':
      return 'Not started';
  }
}
