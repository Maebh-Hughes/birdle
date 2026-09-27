import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyStats, recordGameResult, type PlayerProfile } from '@birdle/shared';
import { JsonFileStore, MemoryStore, nodeFileSystem, type GameRecord, type StoreFileSystem } from '../src/store';
import { RecordingLogger } from './helpers';

const profile: PlayerProfile = { id: 'u1', username: 'u1', displayName: 'User One', avatarUrl: null };
const daily: GameRecord = {
  mode: 'daily',
  puzzleNumber: 7,
  date: '2026-10-02',
  answer: 'ROBIN',
  guesses: [{ word: 'RAINS', result: ['correct', 'absent', 'present', 'present', 'absent'] }],
  status: 'playing',
  hardMode: true,
  hintUsed: false,
};
const practice: GameRecord = { ...daily, mode: 'practice', puzzleNumber: null, date: null, answer: 'KAKAPO', guesses: [] };
const stats = recordGameResult(emptyStats(), 6, true, 3);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'birdle-store-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fill(store: MemoryStore): Promise<void> {
  await store.saveProfile(profile);
  await store.saveStats('u1', stats);
  await store.saveDailyGame('u1', 7, daily);
  await store.savePracticeGame('u1', practice);
  await store.saveInstanceMember('i-1', { userId: 'u1', joinedAt: 1000, lastSeen: 2000 });
}

async function expectFilled(store: MemoryStore): Promise<void> {
  expect(await store.getProfile('u1')).toEqual(profile);
  expect(await store.getStats('u1')).toEqual(stats);
  expect(await store.getDailyGame('u1', 7)).toEqual(daily);
  expect(await store.getPracticeGame('u1')).toEqual(practice);
  expect(await store.getInstanceMembers('i-1')).toEqual([{ userId: 'u1', joinedAt: 1000, lastSeen: 2000 }]);
}

describe('MemoryStore', () => {
  it('returns copies, so callers cannot mutate stored state', async () => {
    const store = new MemoryStore();
    await store.saveDailyGame('u1', 7, daily);
    const copy = await store.getDailyGame('u1', 7);
    copy!.guesses.push({ word: 'SLATE', result: ['absent', 'absent', 'absent', 'absent', 'absent'] });
    expect((await store.getDailyGame('u1', 7))?.guesses).toHaveLength(1);
    expect(await store.getDailyGame('u1', 8)).toBeUndefined();
  });

  it('prunes old daily games and expired members', async () => {
    const store = new MemoryStore();
    await store.saveDailyGame('u1', 3, { ...daily, puzzleNumber: 3 });
    await store.saveDailyGame('u1', 7, daily);
    await store.saveInstanceMember('i-1', { userId: 'u1', joinedAt: 0, lastSeen: 10 });
    await store.prune({ dailyPuzzlesBefore: 5, membersSeenBefore: 11 });
    expect(await store.getDailyGame('u1', 3)).toBeUndefined();
    expect(await store.getDailyGame('u1', 7)).toEqual(daily);
    expect(await store.getInstanceMembers('i-1')).toEqual([]);
    expect(await store.getMemberships('u1')).toEqual([]);
  });

  it('lists and removes a player’s memberships across instances', async () => {
    const store = new MemoryStore();
    await store.saveInstanceMember('i-1', { userId: 'u1', joinedAt: 1, lastSeen: 2 });
    await store.saveInstanceMember('i-2', { userId: 'u1', joinedAt: 3, lastSeen: 4 });
    await store.saveInstanceMember('i-2', { userId: 'u2', joinedAt: 5, lastSeen: 6 });
    expect(await store.getMemberships('u1')).toEqual([
      { instanceId: 'i-1', userId: 'u1', joinedAt: 1, lastSeen: 2 },
      { instanceId: 'i-2', userId: 'u1', joinedAt: 3, lastSeen: 4 },
    ]);
    await store.removeInstanceMember('i-1', 'u1');
    await store.removeInstanceMember('i-1', 'nobody');
    expect((await store.getMemberships('u1')).map((membership) => membership.instanceId)).toEqual(['i-2']);
    expect(await store.getInstanceMembers('i-1')).toEqual([]);
    expect((await store.getInstanceMembers('i-2')).map((member) => member.userId)).toEqual(['u1', 'u2']);
  });
});

describe('JsonFileStore', () => {
  it('starts empty when the file is missing and creates its directory', async () => {
    const path = join(dir, 'nested', 'deeper', 'db.json');
    const logger = new RecordingLogger();
    const store = await JsonFileStore.open(path, { logger });
    expect(await store.getProfile('u1')).toBeUndefined();
    expect(existsSync(join(dir, 'nested', 'deeper'))).toBe(true);
    expect(existsSync(path)).toBe(false);
    await store.saveProfile(profile);
    await store.flush();
    expect(existsSync(path)).toBe(true);
  });

  it('round-trips everything through the file', async () => {
    const path = join(dir, 'db.json');
    const first = await JsonFileStore.open(path, { logger: new RecordingLogger() });
    await fill(first);
    await first.flush();
    expect(await readdir(dir)).toEqual(['db.json']); // the temp file was renamed away

    const second = await JsonFileStore.open(path, { logger: new RecordingLogger() });
    await expectFilled(second);
    expect(await second.getMemberships('u1')).toEqual([{ instanceId: 'i-1', userId: 'u1', joinedAt: 1000, lastSeen: 2000 }]);
  });

  it('batches changes into one debounced write', async () => {
    const path = join(dir, 'db.json');
    const store = await JsonFileStore.open(path, { logger: new RecordingLogger(), saveDelayMs: 30 });
    await fill(store);
    expect(existsSync(path)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const reopened = await JsonFileStore.open(path, { logger: new RecordingLogger() });
    await expectFilled(reopened);
  });

  it('keeps user ids like __proto__ as plain data', async () => {
    const path = join(dir, 'db.json');
    const store = await JsonFileStore.open(path, { logger: new RecordingLogger() });
    await store.saveProfile({ ...profile, id: '__proto__' });
    await store.flush();
    const reopened = await JsonFileStore.open(path, { logger: new RecordingLogger() });
    expect((await reopened.getProfile('__proto__'))?.id).toBe('__proto__');
  });

  it.each([
    ['invalid JSON', '{"version": 1, "profiles": '],
    ['an empty file', ''],
    ['the wrong shape', JSON.stringify({ version: 99, users: [] })],
  ])('backs up a corrupt file (%s) and starts fresh with a loud warning', async (_label, content) => {
    const path = join(dir, 'db.json');
    await writeFile(path, content, 'utf8');
    const logger = new RecordingLogger();
    const store = await JsonFileStore.open(path, { logger });

    expect(logger.text).toMatch(/is corrupt/);
    expect(logger.text).toMatch(/EMPTY database/);
    const files = await readdir(dir);
    const backup = files.find((name) => /^db\.corrupt-.+\.json$/.test(name));
    expect(backup).toBeDefined();
    expect(await readFile(join(dir, backup!), 'utf8')).toBe(content);
    expect(existsSync(path)).toBe(false);

    await store.saveProfile(profile);
    await store.flush();
    const reopened = await JsonFileStore.open(path, { logger: new RecordingLogger() });
    expect(await reopened.getProfile('u1')).toEqual(profile);
  });

  it('drops individually malformed records and keeps the rest', async () => {
    const path = join(dir, 'db.json');
    const good = await JsonFileStore.open(path, { logger: new RecordingLogger() });
    await fill(good);
    await good.flush();
    const data = JSON.parse(await readFile(path, 'utf8'));
    data.profiles.u2 = { id: 'someone-else', username: 'x', displayName: 'x', avatarUrl: null };
    data.daily.u1['8'] = { ...daily, puzzleNumber: 8, answer: 'nope!' };
    data.stats.u3 = { played: -1 };
    await writeFile(path, JSON.stringify(data), 'utf8');

    const logger = new RecordingLogger();
    const store = await JsonFileStore.open(path, { logger });
    expect(logger.text).toMatch(/Ignored 3 malformed record/);
    await expectFilled(store);
    expect(await store.getProfile('u2')).toBeUndefined();
  });
});

describe('JsonFileStore writes', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function eventually(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('condition not met in time');
      await sleep(10);
    }
  }

  function fileSystem(overrides: Partial<StoreFileSystem>): StoreFileSystem {
    return { ...nodeFileSystem, ...overrides };
  }

  async function reopen(path: string): Promise<JsonFileStore> {
    return JsonFileStore.open(path, { logger: new RecordingLogger() });
  }

  it('flushes the data to disk before renaming it over the database', async () => {
    const path = join(dir, 'db.json');
    const steps: string[] = [];
    const fs: StoreFileSystem = {
      async writeFileDurably(file, data) {
        steps.push(`write ${basename(file)}`);
        await nodeFileSystem.writeFileDurably(file, data);
      },
      async rename(from, to) {
        steps.push(`rename ${basename(from)} ${basename(to)}`);
        await nodeFileSystem.rename(from, to);
      },
      async syncDirectory() {
        steps.push('sync directory');
      },
    };
    const store = await JsonFileStore.open(path, { logger: new RecordingLogger(), fileSystem: fs });
    await store.saveProfile(profile);
    await store.flush();
    expect(steps).toEqual(['write db.json.tmp', 'rename db.json.tmp db.json', 'sync directory']);
  });

  it('keeps changes whose write failed and saves them on the retry', async () => {
    const path = join(dir, 'db.json');
    let failures = 1;
    const fs = fileSystem({
      async writeFileDurably(file, data) {
        if (failures-- > 0) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
        await nodeFileSystem.writeFileDurably(file, data);
      },
    });
    const logger = new RecordingLogger();
    const store = await JsonFileStore.open(path, { logger, saveDelayMs: 5, retryDelayMs: 30, fileSystem: fs });
    await store.saveProfile(profile);
    await eventually(() => existsSync(path));
    expect(logger.text).toMatch(/Failed to save .*retrying/);
    expect(await (await reopen(path)).getProfile('u1')).toEqual(profile);
  });

  /** Makes the next serialization of the store's data fail, as it would for a state too large to stringify. */
  function failNextSerialization(): void {
    const original = JSON.stringify.bind(JSON) as (...args: unknown[]) => string;
    let failed = false;
    const stringify = (...args: unknown[]): string => {
      const value = args[0];
      if (!failed && typeof value === 'object' && value !== null && 'profiles' in value) {
        failed = true;
        throw new RangeError('Invalid string length');
      }
      return original(...args);
    };
    vi.spyOn(JSON, 'stringify').mockImplementation(stringify as typeof JSON.stringify);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries after serialization itself fails', async () => {
    const path = join(dir, 'db.json');
    const logger = new RecordingLogger();
    const store = await JsonFileStore.open(path, { logger, saveDelayMs: 5, retryDelayMs: 30 });
    failNextSerialization();
    await store.saveProfile(profile);
    await eventually(() => existsSync(path));
    expect(logger.text).toMatch(/Invalid string length/);
    expect(await (await reopen(path)).getProfile('u1')).toEqual(profile);
  });

  it('never has flush() report an unsaved change as saved', async () => {
    const path = join(dir, 'db.json');
    const store = await JsonFileStore.open(path, { logger: new RecordingLogger(), saveDelayMs: 60_000 });
    await store.saveStats('u1', stats);
    failNextSerialization();
    await expect(store.flush()).rejects.toThrow('Invalid string length');
    expect(existsSync(path)).toBe(false);
    await store.flush();
    expect(await (await reopen(path)).getStats('u1')).toEqual(stats);
  });

  it('waits for a write in progress on flush() and saves changes made during it', async () => {
    const path = join(dir, 'db.json');
    let writes = 0;
    let release = () => {};
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fs = fileSystem({
      async writeFileDurably(file, data) {
        writes++;
        if (writes === 1) {
          markStarted();
          await gate;
        }
        await nodeFileSystem.writeFileDurably(file, data);
      },
    });
    const store = await JsonFileStore.open(path, { logger: new RecordingLogger(), saveDelayMs: 5, fileSystem: fs });
    await store.saveProfile(profile);
    await started; // the timed write (with the profile only) is under way
    await store.saveStats('u1', stats);

    let flushed = false;
    const flush = store.flush().then(() => {
      flushed = true;
    });
    await sleep(30);
    expect(flushed).toBe(false);
    release();
    await flush;
    expect(writes).toBe(2);
    const reopened = await reopen(path);
    expect(await reopened.getProfile('u1')).toEqual(profile);
    expect(await reopened.getStats('u1')).toEqual(stats);
  });

  it('retries a rename refused by a Windows sharing violation', async () => {
    const path = join(dir, 'db.json');
    let refusals = 2;
    const fs = fileSystem({
      async rename(from, to) {
        if (refusals-- > 0) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
        await nodeFileSystem.rename(from, to);
      },
    });
    const store = await JsonFileStore.open(path, { logger: new RecordingLogger(), fileSystem: fs });
    await store.saveProfile(profile);
    await store.flush();
    expect(refusals).toBe(-1);
    expect(await (await reopen(path)).getProfile('u1')).toEqual(profile);
  });
});
