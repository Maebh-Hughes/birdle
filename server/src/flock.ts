import { puzzleNumberForDate, type FlockPlayer, type PlayerProfile } from '@birdle/shared';
import { ApiError } from './errors';
import type { Clock } from './runtime';
import type { GameRecord, InstanceMember, Store } from './store';

/** Memberships not refreshed (join or Flock poll) for this long expire. */
export const INSTANCE_MEMBERSHIP_TTL_MS = 24 * 60 * 60_000;
/** Most players returned by one Flock request (the caller is always included). */
export const MAX_FLOCK_PLAYERS = 50;
/** Flock polls refresh a membership at most this often, to avoid a database write every poll. */
const MEMBERSHIP_REFRESH_MS = 60 * 60_000;
/** Instances one player stays a member of; joining another drops the least recently seen. */
export const MAX_INSTANCES_PER_USER = 5;
/** Members one instance keeps; a newcomer beyond this drops the least recently seen member. */
export const MAX_MEMBERS_PER_INSTANCE = 100;

/** Most recently seen first; among equals, the later-added one first. */
function recentFirst<T extends { lastSeen: number }>(items: readonly T[]): T[] {
  return [...items].reverse().sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Colours only: a player's letters and answer never leave the server through the Flock. */
export function toFlockPlayer(profile: PlayerProfile, game: GameRecord | undefined): FlockPlayer {
  const started = game !== undefined && game.guesses.length > 0;
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    status: started ? game.status : 'idle',
    rows: started ? game.guesses.map((row) => [...row.result]) : [],
    hintUsed: started ? game.hintUsed : false,
    hardMode: started ? game.hardMode : false,
  };
}

export interface FlockServiceOptions {
  store: Store;
  clock: Clock;
}

/** Players who joined the same Discord Activity instance, and their daily progress. */
export class FlockService {
  private readonly store: Store;
  private readonly clock: Clock;

  constructor(options: FlockServiceOptions) {
    this.store = options.store;
    this.clock = options.clock;
  }

  private async activeMembers(instanceId: string, now: number): Promise<InstanceMember[]> {
    const members = await this.store.getInstanceMembers(instanceId);
    return members.filter((member) => member.lastSeen > now - INSTANCE_MEMBERSHIP_TTL_MS);
  }

  /**
   * Registers (or refreshes) the caller as a member of the instance. Instance ids
   * come from the client, so what one account can make the server store is bounded.
   */
  async join(instanceId: string, userId: string): Promise<void> {
    const now = this.clock.now().getTime();
    const members = await this.activeMembers(instanceId, now);
    const existing = members.find((member) => member.userId === userId);
    await this.store.saveInstanceMember(instanceId, { userId, joinedAt: existing?.joinedAt ?? now, lastSeen: now });

    const otherInstances = (await this.store.getMemberships(userId)).filter((membership) => membership.instanceId !== instanceId);
    for (const stale of recentFirst(otherInstances).slice(MAX_INSTANCES_PER_USER - 1)) {
      await this.store.removeInstanceMember(stale.instanceId, userId);
    }
    if (!existing) {
      const otherMembers = (await this.store.getInstanceMembers(instanceId)).filter((member) => member.userId !== userId);
      for (const stale of recentFirst(otherMembers).slice(MAX_MEMBERS_PER_INSTANCE - 1)) {
        await this.store.removeInstanceMember(instanceId, stale.userId);
      }
    }
  }

  /**
   * Every active member's progress on the daily puzzle of `date` (already
   * validated), in join order. 403 FORBIDDEN unless the caller is a member.
   */
  async flock(instanceId: string, userId: string, date: string): Promise<FlockPlayer[]> {
    const now = this.clock.now().getTime();
    const members = await this.activeMembers(instanceId, now);
    const self = members.find((member) => member.userId === userId);
    if (!self) throw new ApiError('FORBIDDEN', 'Join this activity instance first');
    if (now - self.lastSeen >= MEMBERSHIP_REFRESH_MS) {
      await this.store.saveInstanceMember(instanceId, { ...self, lastSeen: now });
    }

    // Keep the most recently seen members when over the cap, then show them in join order.
    const others = members
      .filter((member) => member !== self)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, MAX_FLOCK_PLAYERS - 1);
    const shown = [self, ...others].sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1));

    const puzzleNumber = puzzleNumberForDate(date);
    const players = await Promise.all(
      shown.map(async (member) => {
        const profile = await this.store.getProfile(member.userId);
        if (!profile) return null;
        return toFlockPlayer(profile, await this.store.getDailyGame(member.userId, puzzleNumber));
      }),
    );
    return players.filter((player): player is FlockPlayer => player !== null);
  }
}
