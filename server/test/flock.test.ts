import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { FlockPlayer, FlockResponse } from '@birdle/shared';
import { INSTANCE_MEMBERSHIP_TTL_MS, MAX_FLOCK_PLAYERS, MAX_INSTANCES_PER_USER, MAX_MEMBERS_PER_INSTANCE } from '../src/flock';
import { pruneStaleData } from '../src/maintenance';
import { MemoryStore } from '../src/store';
import { MISSES, TODAY, as, dailyGuess, makeTestApp, playDaily } from './helpers';

type App = ReturnType<typeof makeTestApp>['app'];

function join(app: App, user: string, instanceId = 'i-123-gc-1', date: unknown = TODAY) {
  return request(app).post(`/api/instances/${instanceId}/join`).set(as(user)).send({ date });
}

function flock(app: App, user: string, instanceId = 'i-123-gc-1', date = TODAY) {
  return request(app).get(`/api/instances/${instanceId}/flock`).query({ date }).set(as(user));
}

describe('instances and the Flock', () => {
  it('lists members with colours only, never letters', async () => {
    const { app } = makeTestApp();
    expect((await join(app, 'alice')).body).toEqual({ ok: true });
    await join(app, 'bob');
    await playDaily(app, 'alice', ['rains', 'slate']);
    await request(app).post('/api/daily/hint').set(as('alice')).send({ date: TODAY }); // too early: no effect

    const res = await flock(app, 'bob');
    expect(res.status).toBe(200);
    const { players } = res.body as FlockResponse;
    expect(players).toEqual<FlockPlayer[]>([
      {
        id: 'alice',
        username: 'alice',
        displayName: 'alice',
        avatarUrl: null,
        status: 'playing',
        rows: [
          ['correct', 'absent', 'present', 'present', 'absent'],
          ['absent', 'absent', 'absent', 'absent', 'absent'],
        ],
        hintUsed: false,
        hardMode: false,
      },
      { id: 'bob', username: 'bob', displayName: 'bob', avatarUrl: null, status: 'idle', rows: [], hintUsed: false, hardMode: false },
    ]);
    const raw = res.text.toLowerCase();
    for (const word of ['rains', 'slate', 'robin']) expect(raw).not.toContain(word);
  });

  it('shows finished games without the answer', async () => {
    const { app } = makeTestApp();
    await join(app, 'alice');
    await join(app, 'bob');
    await playDaily(app, 'alice', ['slate', 'robin']);
    await playDaily(app, 'bob', MISSES);
    const { players } = (await flock(app, 'alice')).body as FlockResponse;
    expect(players.map((player) => [player.id, player.status, player.rows.length])).toEqual([
      ['alice', 'won', 2],
      ['bob', 'lost', 6],
    ]);
    expect(JSON.stringify(players).toLowerCase()).not.toContain('robin');
  });

  it('returns 403 FORBIDDEN to players who have not joined', async () => {
    const { app } = makeTestApp();
    await join(app, 'alice');
    const res = await flock(app, 'mallory');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    // Joining a different instance doesn't help.
    await join(app, 'mallory', 'i-999');
    expect((await flock(app, 'mallory')).status).toBe(403);
  });

  it('validates the instance id and dates', async () => {
    const { app } = makeTestApp();
    expect((await join(app, 'alice', 'bad$id')).body.error.code).toBe('BAD_REQUEST');
    expect((await join(app, 'alice', 'a%2Fb')).body.error.code).toBe('BAD_REQUEST');
    expect((await join(app, 'alice', 'x'.repeat(129))).body.error.code).toBe('BAD_REQUEST');
    expect((await join(app, 'alice', 'i-1', '2020-01-01')).body.error.code).toBe('BAD_DATE');
    expect((await join(app, 'alice', 'i-1', null)).body.error.code).toBe('BAD_DATE');
    await join(app, 'alice', 'i-1');
    expect((await flock(app, 'alice', 'i-1', 'nope')).body.error.code).toBe('BAD_DATE');
    const unauthenticated = await request(app).get('/api/instances/i-1/flock').query({ date: TODAY });
    expect(unauthenticated.status).toBe(401);
  });

  it('expires memberships after 24 hours without a join or poll', async () => {
    const { app, clock } = makeTestApp();
    clock.set(`${TODAY}T00:30:00Z`);
    await join(app, 'alice');
    await join(app, 'bob');
    clock.advanceMs(20 * 60 * 60_000);
    expect((await flock(app, 'alice')).body.players).toHaveLength(2); // refreshes alice only
    clock.advanceMs(5 * 60 * 60_000);
    const res = await flock(app, 'alice');
    expect((res.body as FlockResponse).players.map((player) => player.id)).toEqual(['alice']);
    expect((await flock(app, 'bob')).status).toBe(403);
  });

  it('caps the number of players returned, always including the caller', async () => {
    const { app, clock } = makeTestApp();
    for (let i = 0; i < MAX_FLOCK_PLAYERS + 5; i++) {
      await join(app, `p${i}`);
      clock.advanceMs(1000);
    }
    const res = await flock(app, 'p0');
    const ids = (res.body as FlockResponse).players.map((player) => player.id);
    expect(ids).toHaveLength(MAX_FLOCK_PLAYERS);
    expect(ids[0]).toBe('p0');
    expect(ids).not.toContain('p1'); // least recently seen are dropped
    expect(ids).toContain(`p${MAX_FLOCK_PLAYERS + 4}`);
  });

  it('keeps a player in a bounded number of instances, dropping the least recently seen', async () => {
    const { app, clock, store } = makeTestApp();
    for (let i = 0; i < 12; i++) {
      expect((await join(app, 'alice', `i-${i}`)).status).toBe(200);
      clock.advanceMs(1000);
    }
    const kept = (await store.getMemberships('alice')).map((membership) => membership.instanceId).sort();
    expect(kept).toHaveLength(MAX_INSTANCES_PER_USER);
    expect(kept).toEqual(['i-10', 'i-11', 'i-7', 'i-8', 'i-9']);
    expect((await flock(app, 'alice', 'i-0')).status).toBe(403);
    expect((await flock(app, 'alice', 'i-11')).status).toBe(200);
  });

  it('bounds what one account can store by joining made-up instances, even within one clock tick', async () => {
    const { app, store } = makeTestApp();
    for (let i = 0; i < 60; i++) await join(app, 'mallory', `made-up-${i}`);
    const kept = (await store.getMemberships('mallory')).map((membership) => membership.instanceId).sort();
    expect(kept).toEqual(['made-up-55', 'made-up-56', 'made-up-57', 'made-up-58', 'made-up-59']);
    expect(await store.getInstanceMembers('made-up-0')).toEqual([]);
  });

  it('caps the members one instance keeps, dropping the least recently seen', async () => {
    const { app, clock, store } = makeTestApp();
    for (let i = 0; i < MAX_MEMBERS_PER_INSTANCE + 3; i++) {
      await join(app, `p${i}`);
      clock.advanceMs(1000);
    }
    const ids = (await store.getInstanceMembers('i-123-gc-1')).map((member) => member.userId);
    expect(ids).toHaveLength(MAX_MEMBERS_PER_INSTANCE);
    expect(ids).not.toContain('p0');
    expect(ids).toContain(`p${MAX_MEMBERS_PER_INSTANCE + 2}`);
  });

  it('only reports progress on the requested date’s puzzle', async () => {
    const { app } = makeTestApp();
    await join(app, 'alice');
    await dailyGuess(app, 'alice', 'slate', { date: '2026-10-04' });
    const today = (await flock(app, 'alice')).body as FlockResponse;
    expect(today.players[0]?.status).toBe('idle');
    const yesterday = (await flock(app, 'alice', 'i-123-gc-1', '2026-10-04')).body as FlockResponse;
    expect(yesterday.players[0]?.rows).toHaveLength(1);
  });

  it('prunes expired memberships from the store', async () => {
    const store = new MemoryStore();
    const now = new Date(`${TODAY}T12:00:00Z`).getTime();
    await store.saveInstanceMember('i-1', { userId: 'old', joinedAt: 0, lastSeen: now - INSTANCE_MEMBERSHIP_TTL_MS - 1 });
    await store.saveInstanceMember('i-1', { userId: 'new', joinedAt: now, lastSeen: now });
    await store.saveInstanceMember('i-2', { userId: 'old', joinedAt: 0, lastSeen: 0 });
    await pruneStaleData(store, new Date(now));
    expect((await store.getInstanceMembers('i-1')).map((member) => member.userId)).toEqual(['new']);
    expect(await store.getInstanceMembers('i-2')).toEqual([]);
  });
});
