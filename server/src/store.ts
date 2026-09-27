import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import {
  MAX_GUESSES,
  MAX_WORD_LENGTH,
  MIN_WORD_LENGTH,
  isPracticeCategory,
  type GameMode,
  type GameStatus,
  type GuessRow,
  type PlayerProfile,
  type PracticeCategory,
  type Stats,
} from '@birdle/shared';
import type { Logger } from './runtime';

/** A game as stored on the server. Holds the answer: never send it to clients as-is. */
export interface GameRecord {
  mode: GameMode;
  /** Daily puzzle number; null in practice. */
  puzzleNumber: number | null;
  /** Daily puzzle date (YYYY-MM-DD); null in practice. */
  date: string | null;
  /** Free Flight category the answer was drawn from; null for daily games. */
  category: PracticeCategory | null;
  /** Uppercase answer word. */
  answer: string;
  guesses: GuessRow[];
  status: GameStatus;
  hardMode: boolean;
  hintUsed: boolean;
}

export interface InstanceMember {
  userId: string;
  /** When this membership started (ms since epoch). */
  joinedAt: number;
  /** Last join or Flock poll (ms since epoch). */
  lastSeen: number;
}

/** One of a player's instance memberships. */
export interface Membership extends InstanceMember {
  instanceId: string;
}

export interface PruneOptions {
  /** Drop instance memberships last seen before this time (ms). */
  membersSeenBefore: number;
  /** Drop daily games and pinned daily answers of puzzles numbered below this. */
  dailyPuzzlesBefore: number;
}

/** Persistence for BIRDLE. Implementations return copies, so callers can't mutate stored state by accident. */
export interface Store {
  getProfile(userId: string): Promise<PlayerProfile | undefined>;
  saveProfile(profile: PlayerProfile): Promise<void>;
  getStats(userId: string): Promise<Stats | undefined>;
  saveStats(userId: string, stats: Stats): Promise<void>;
  getDailyGame(userId: string, puzzleNumber: number): Promise<GameRecord | undefined>;
  saveDailyGame(userId: string, puzzleNumber: number, game: GameRecord): Promise<void>;
  getPracticeGame(userId: string): Promise<GameRecord | undefined>;
  savePracticeGame(userId: string, game: GameRecord): Promise<void>;
  /** The answer pinned to daily puzzle `puzzleNumber` when it was first served, if any. */
  getDailyAnswer(puzzleNumber: number): Promise<string | undefined>;
  /**
   * Pins `answer` to daily puzzle `puzzleNumber` unless an answer is pinned
   * already, and resolves to the pinned answer either way (first pin wins).
   */
  pinDailyAnswer(puzzleNumber: number, answer: string): Promise<string>;
  getInstanceMembers(instanceId: string): Promise<InstanceMember[]>;
  saveInstanceMember(instanceId: string, member: InstanceMember): Promise<void>;
  removeInstanceMember(instanceId: string, userId: string): Promise<void>;
  /** Every instance the player is a member of. */
  getMemberships(userId: string): Promise<Membership[]>;
  prune(options: PruneOptions): Promise<void>;
  /** Persists pending changes now (no-op for in-memory stores). */
  flush(): Promise<void>;
}

interface StoreState {
  profiles: Map<string, PlayerProfile>;
  stats: Map<string, Stats>;
  daily: Map<string, Map<number, GameRecord>>;
  practice: Map<string, GameRecord>;
  /** Daily puzzle number -> the answer it was first served with. */
  dailyAnswers: Map<number, string>;
  instances: Map<string, Map<string, InstanceMember>>;
  /** Index of `instances` by player: userId -> instance ids. */
  memberships: Map<string, Set<string>>;
}

function emptyState(): StoreState {
  return {
    profiles: new Map(),
    stats: new Map(),
    daily: new Map(),
    practice: new Map(),
    dailyAnswers: new Map(),
    instances: new Map(),
    memberships: new Map(),
  };
}

function indexMembership(state: StoreState, userId: string, instanceId: string): void {
  let ids = state.memberships.get(userId);
  if (!ids) state.memberships.set(userId, (ids = new Set()));
  ids.add(instanceId);
}

function unindexMembership(state: StoreState, userId: string, instanceId: string): void {
  const ids = state.memberships.get(userId);
  ids?.delete(instanceId);
  if (ids?.size === 0) state.memberships.delete(userId);
}

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory store (tests, and the base of JsonFileStore). */
export class MemoryStore implements Store {
  protected state: StoreState = emptyState();

  /** Called after every mutation. */
  protected changed(): void {}

  async getProfile(userId: string): Promise<PlayerProfile | undefined> {
    const profile = this.state.profiles.get(userId);
    return profile && clone(profile);
  }

  async saveProfile(profile: PlayerProfile): Promise<void> {
    this.state.profiles.set(profile.id, clone(profile));
    this.changed();
  }

  async getStats(userId: string): Promise<Stats | undefined> {
    const stats = this.state.stats.get(userId);
    return stats && clone(stats);
  }

  async saveStats(userId: string, stats: Stats): Promise<void> {
    this.state.stats.set(userId, clone(stats));
    this.changed();
  }

  async getDailyGame(userId: string, puzzleNumber: number): Promise<GameRecord | undefined> {
    const game = this.state.daily.get(userId)?.get(puzzleNumber);
    return game && clone(game);
  }

  async saveDailyGame(userId: string, puzzleNumber: number, game: GameRecord): Promise<void> {
    let games = this.state.daily.get(userId);
    if (!games) this.state.daily.set(userId, (games = new Map()));
    games.set(puzzleNumber, clone(game));
    this.changed();
  }

  async getPracticeGame(userId: string): Promise<GameRecord | undefined> {
    const game = this.state.practice.get(userId);
    return game && clone(game);
  }

  async savePracticeGame(userId: string, game: GameRecord): Promise<void> {
    this.state.practice.set(userId, clone(game));
    this.changed();
  }

  async getDailyAnswer(puzzleNumber: number): Promise<string | undefined> {
    return this.state.dailyAnswers.get(puzzleNumber);
  }

  async pinDailyAnswer(puzzleNumber: number, answer: string): Promise<string> {
    // No await between the check and the set, so concurrent requests can't both pin.
    const pinned = this.state.dailyAnswers.get(puzzleNumber);
    if (pinned !== undefined) return pinned;
    this.state.dailyAnswers.set(puzzleNumber, answer);
    this.changed();
    return answer;
  }

  async getInstanceMembers(instanceId: string): Promise<InstanceMember[]> {
    return [...(this.state.instances.get(instanceId)?.values() ?? [])].map(clone);
  }

  async saveInstanceMember(instanceId: string, member: InstanceMember): Promise<void> {
    let members = this.state.instances.get(instanceId);
    if (!members) this.state.instances.set(instanceId, (members = new Map()));
    members.set(member.userId, clone(member));
    indexMembership(this.state, member.userId, instanceId);
    this.changed();
  }

  async removeInstanceMember(instanceId: string, userId: string): Promise<void> {
    const members = this.state.instances.get(instanceId);
    if (!members?.delete(userId)) return;
    if (members.size === 0) this.state.instances.delete(instanceId);
    unindexMembership(this.state, userId, instanceId);
    this.changed();
  }

  async getMemberships(userId: string): Promise<Membership[]> {
    return [...(this.state.memberships.get(userId) ?? [])].flatMap((instanceId) => {
      const member = this.state.instances.get(instanceId)?.get(userId);
      return member ? [{ ...clone(member), instanceId }] : [];
    });
  }

  async prune({ membersSeenBefore, dailyPuzzlesBefore }: PruneOptions): Promise<void> {
    let removed = 0;
    for (const [instanceId, members] of this.state.instances) {
      for (const [userId, member] of members) {
        if (member.lastSeen < membersSeenBefore) {
          members.delete(userId);
          unindexMembership(this.state, userId, instanceId);
          removed++;
        }
      }
      if (members.size === 0) this.state.instances.delete(instanceId);
    }
    for (const [userId, games] of this.state.daily) {
      for (const puzzleNumber of games.keys()) {
        if (puzzleNumber < dailyPuzzlesBefore) {
          games.delete(puzzleNumber);
          removed++;
        }
      }
      if (games.size === 0) this.state.daily.delete(userId);
    }
    for (const puzzleNumber of this.state.dailyAnswers.keys()) {
      if (puzzleNumber < dailyPuzzlesBefore) {
        this.state.dailyAnswers.delete(puzzleNumber);
        removed++;
      }
    }
    if (removed > 0) this.changed();
  }

  async flush(): Promise<void> {}
}

// ---- JSON file persistence ----

const FILE_VERSION = 1;

/**
 * On-disk format (version 1). Object.fromEntries keeps keys like "__proto__" as
 * plain data. `dailyAnswers` and game `category` fields were added later; files
 * without them still load (see fromFile).
 */
interface StoreFile {
  version: typeof FILE_VERSION;
  profiles: Record<string, PlayerProfile>;
  stats: Record<string, Stats>;
  daily: Record<string, Record<string, GameRecord>>;
  practice: Record<string, GameRecord>;
  /** Daily puzzle number -> pinned answer. */
  dailyAnswers: Record<string, string>;
  instances: Record<string, Record<string, { joinedAt: number; lastSeen: number }>>;
}

function toFile(state: StoreState): StoreFile {
  const nested = <K, V, O>(outer: Map<string, Map<K, V>>, map: (value: V) => O) =>
    Object.fromEntries(
      [...outer].map(([key, inner]) => [key, Object.fromEntries([...inner].map(([k, v]) => [String(k), map(v)]))]),
    );
  return {
    version: FILE_VERSION,
    profiles: Object.fromEntries(state.profiles),
    stats: Object.fromEntries(state.stats),
    daily: nested(state.daily, (game) => game),
    practice: Object.fromEntries(state.practice),
    dailyAnswers: Object.fromEntries([...state.dailyAnswers].map(([puzzleNumber, answer]) => [String(puzzleNumber), answer])),
    instances: nested(state.instances, ({ joinedAt, lastSeen }) => ({ joinedAt, lastSeen })),
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isNullableCount = (value: unknown): boolean => value === null || isCount(value);
const LETTER_STATES: readonly unknown[] = ['correct', 'present', 'absent'];
const GAME_STATUSES: readonly unknown[] = ['playing', 'won', 'lost'];
const ANSWER_PATTERN = new RegExp(`^[A-Z]{${MIN_WORD_LENGTH},${MAX_WORD_LENGTH}}$`);

function isProfile(value: unknown, id: string): value is PlayerProfile {
  return (
    isRecord(value) &&
    value.id === id &&
    typeof value.username === 'string' &&
    typeof value.displayName === 'string' &&
    (value.avatarUrl === null || typeof value.avatarUrl === 'string')
  );
}

function isStats(value: unknown): value is Stats {
  return (
    isRecord(value) &&
    isCount(value.played) &&
    isCount(value.wins) &&
    isCount(value.currentStreak) &&
    isCount(value.maxStreak) &&
    Array.isArray(value.distribution) &&
    value.distribution.length === MAX_GUESSES &&
    value.distribution.every(isCount) &&
    isNullableCount(value.lastPlayedPuzzle) &&
    isNullableCount(value.lastWonPuzzle)
  );
}

function isGuessRow(value: unknown, length: number): value is GuessRow {
  return (
    isRecord(value) &&
    typeof value.word === 'string' &&
    value.word.length === length &&
    Array.isArray(value.result) &&
    value.result.length === length &&
    value.result.every((state) => LETTER_STATES.includes(state))
  );
}

/**
 * A stored game. `category` is optional in the file: games saved before Free
 * Flight categories existed have none (see withCategory).
 */
function isGameRecord(value: unknown, mode: GameMode): value is Omit<GameRecord, 'category'> & { category?: unknown } {
  if (!isRecord(value) || value.mode !== mode || typeof value.answer !== 'string') return false;
  const answer = value.answer;
  const daily = mode === 'daily';
  return (
    ANSWER_PATTERN.test(answer) &&
    (daily ? Number.isInteger(value.puzzleNumber) : value.puzzleNumber === null) &&
    (daily ? typeof value.date === 'string' : value.date === null) &&
    (daily ? value.category === undefined || value.category === null : value.category === undefined || isPracticeCategory(value.category)) &&
    Array.isArray(value.guesses) &&
    value.guesses.length <= MAX_GUESSES &&
    value.guesses.every((row) => isGuessRow(row, answer.length)) &&
    GAME_STATUSES.includes(value.status) &&
    typeof value.hardMode === 'boolean' &&
    typeof value.hintUsed === 'boolean'
  );
}

/** A stored game with its category filled in: null for daily games, 'all' for older practice games. */
function withCategory(game: Omit<GameRecord, 'category'> & { category?: unknown }): GameRecord {
  const category = game.mode === 'daily' ? null : isPracticeCategory(game.category) ? game.category : 'all';
  return { ...game, category };
}

function isMemberTimes(value: unknown): value is { joinedAt: number; lastSeen: number } {
  return isRecord(value) && isCount(value.joinedAt) && isCount(value.lastSeen);
}

/**
 * Pins the answer of every puzzle that has stored games but no pinned answer:
 * the one most of its games have. Needed for files written before answers
 * were pinned, so a changed word list can't give later players another answer.
 */
function pinAnswersOfStoredGames(state: StoreState): void {
  const votes = new Map<number, Map<string, number>>();
  for (const games of state.daily.values()) {
    for (const [puzzleNumber, game] of games) {
      if (state.dailyAnswers.has(puzzleNumber)) continue;
      let counts = votes.get(puzzleNumber);
      if (!counts) votes.set(puzzleNumber, (counts = new Map()));
      counts.set(game.answer, (counts.get(game.answer) ?? 0) + 1);
    }
  }
  for (const [puzzleNumber, counts] of votes) {
    const [answer] = [...counts].reduce((best, next) => (next[1] > best[1] ? next : best));
    state.dailyAnswers.set(puzzleNumber, answer);
  }
}

/**
 * Rebuilds the state from a parsed file. Returns null when the file's overall
 * shape is wrong (treated as corrupt); individually malformed records are
 * dropped and counted instead, so one bad entry doesn't cost everyone's data.
 */
function fromFile(data: unknown): { state: StoreState; dropped: number } | null {
  if (!isRecord(data) || data.version !== FILE_VERSION) return null;
  const sections = ['profiles', 'stats', 'daily', 'practice', 'instances'] as const;
  if (!sections.every((section) => isRecord(data[section]))) return null;
  const file = data as unknown as Record<(typeof sections)[number], UnknownRecord>;

  const state = emptyState();
  let dropped = 0;
  const keep = (ok: boolean): boolean => {
    if (!ok) dropped++;
    return ok;
  };

  for (const [id, profile] of Object.entries(file.profiles)) {
    if (keep(isProfile(profile, id))) state.profiles.set(id, profile as PlayerProfile);
  }
  for (const [id, stats] of Object.entries(file.stats)) {
    if (keep(isStats(stats))) state.stats.set(id, stats as Stats);
  }
  for (const [userId, games] of Object.entries(file.daily)) {
    if (!keep(isRecord(games))) continue;
    const byPuzzle = new Map<number, GameRecord>();
    for (const [key, game] of Object.entries(games as UnknownRecord)) {
      const puzzleNumber = Number(key);
      if (keep(isGameRecord(game, 'daily') && game.puzzleNumber === puzzleNumber)) {
        byPuzzle.set(puzzleNumber, withCategory(game as Omit<GameRecord, 'category'>));
      }
    }
    if (byPuzzle.size > 0) state.daily.set(userId, byPuzzle);
  }
  for (const [userId, game] of Object.entries(file.practice)) {
    if (keep(isGameRecord(game, 'practice'))) state.practice.set(userId, withCategory(game as Omit<GameRecord, 'category'>));
  }
  // Missing in files written before daily answers were pinned.
  const pins: unknown = (data as UnknownRecord).dailyAnswers ?? {};
  if (keep(isRecord(pins))) {
    for (const [key, answer] of Object.entries(pins as UnknownRecord)) {
      const puzzleNumber = Number(key);
      const ok = /^[1-9]\d*$/.test(key) && Number.isSafeInteger(puzzleNumber) && typeof answer === 'string' && ANSWER_PATTERN.test(answer);
      if (keep(ok)) state.dailyAnswers.set(puzzleNumber, answer as string);
    }
  }
  pinAnswersOfStoredGames(state);
  for (const [instanceId, members] of Object.entries(file.instances)) {
    if (!keep(isRecord(members))) continue;
    const byUser = new Map<string, InstanceMember>();
    for (const [userId, times] of Object.entries(members as UnknownRecord)) {
      if (!keep(isMemberTimes(times))) continue;
      const { joinedAt, lastSeen } = times as { joinedAt: number; lastSeen: number };
      byUser.set(userId, { userId, joinedAt, lastSeen });
      indexMembership(state, userId, instanceId);
    }
    if (byUser.size > 0) state.instances.set(instanceId, byUser);
  }
  return { state, dropped };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The file operations JsonFileStore writes with (replaceable in tests). */
export interface StoreFileSystem {
  /** Writes `data` to `path` and flushes it to the disk before resolving. */
  writeFileDurably(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Makes a rename inside `dir` durable, where the platform allows it. */
  syncDirectory(dir: string): Promise<void>;
}

export const nodeFileSystem: StoreFileSystem = {
  async writeFileDurably(path, data) {
    const handle = await open(path, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename,
  async syncDirectory(dir) {
    // Windows can't open a directory to sync it (NTFS journals the rename itself).
    if (process.platform === 'win32') return;
    try {
      const handle = await open(dir, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      // Best effort: some file systems can't sync a directory. The data itself is on disk.
    }
  },
};

/** rename() that retries briefly on Windows sharing violations (antivirus, indexers, editors). */
async function renameWithRetry(fs: StoreFileSystem, from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) throw error;
      await sleep(25 * 2 ** attempt);
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

export interface JsonFileStoreOptions {
  logger?: Logger;
  /** Delay between the first unsaved change and the write that includes it. */
  saveDelayMs?: number;
  /** Delay before trying again after a failed write. */
  retryDelayMs?: number;
  fileSystem?: StoreFileSystem;
}

export const DEFAULT_SAVE_DELAY_MS = 250;
export const DEFAULT_RETRY_DELAY_MS = 5_000;

/**
 * In-memory store persisted to one JSON file. Changes are batched into a write
 * at most `saveDelayMs` after the first unsaved change; each write goes to a
 * temp file that is flushed to the disk and then renamed over the data file, so
 * a crash or power cut never leaves a half-written database. Call flush() before exiting.
 */
export class JsonFileStore extends MemoryStore {
  readonly path: string;
  private readonly logger: Logger;
  private readonly saveDelayMs: number;
  private readonly retryDelayMs: number;
  private readonly fs: StoreFileSystem;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();

  private constructor(path: string, options: JsonFileStoreOptions) {
    super();
    this.path = path;
    this.logger = options.logger ?? console;
    this.saveDelayMs = options.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.fs = options.fileSystem ?? nodeFileSystem;
  }

  /**
   * Opens (or starts) the database at `path`, creating its directory. A missing
   * file starts empty; a corrupt one is moved aside (`<name>.corrupt-<time>.json`)
   * and the store starts empty with a loud warning.
   */
  static async open(path: string, options: JsonFileStoreOptions = {}): Promise<JsonFileStore> {
    const store = new JsonFileStore(path, options);
    await mkdir(dirname(path), { recursive: true });
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      this.logger.info(`No database at ${this.path} yet; starting with an empty one.`);
      return;
    }

    let parsed: ReturnType<typeof fromFile> = null;
    let reason = 'unexpected structure';
    try {
      parsed = fromFile(JSON.parse(text.replace(/^﻿/, '')));
    } catch (error) {
      reason = `invalid JSON: ${(error as Error).message}`;
    }

    if (!parsed) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const extension = extname(this.path);
      const backup = `${this.path.slice(0, this.path.length - extension.length)}.corrupt-${stamp}${extension || '.json'}`;
      await renameWithRetry(this.fs, this.path, backup);
      this.logger.error(
        [
          '',
          '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
          `!!! BIRDLE database ${this.path} is corrupt (${reason}).`,
          `!!! It was moved to ${backup}`,
          '!!! Starting with an EMPTY database: all games and stats are reset.',
          '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
          '',
        ].join('\n'),
      );
      return;
    }

    if (parsed.dropped > 0) {
      this.logger.warn(`Ignored ${parsed.dropped} malformed record(s) in ${this.path}.`);
    }
    this.state = parsed.state;
  }

  protected override changed(): void {
    this.dirty = true;
    this.schedule(this.saveDelayMs);
  }

  private schedule(delayMs: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.persist().catch((error: unknown) => {
        this.logger.error(`Failed to save ${this.path}; retrying in ${this.retryDelayMs / 1000}s:`, error);
        this.schedule(this.retryDelayMs);
      });
    }, delayMs);
    // Don't keep the process alive just for this; shutdown calls flush().
    this.timer.unref();
  }

  /** Writes the current state if it changed; writes never overlap. */
  private persist(): Promise<void> {
    const run = this.writing.then(async () => {
      if (!this.dirty) return;
      // Changes made while this write is under way mark the store dirty again.
      this.dirty = false;
      try {
        // Serialized inside the try: if even that fails (a huge state), the changes stay pending.
        const json = JSON.stringify(toFile(this.state));
        const temp = `${this.path}.tmp`;
        await mkdir(dirname(this.path), { recursive: true });
        await this.fs.writeFileDurably(temp, json);
        await renameWithRetry(this.fs, temp, this.path);
        await this.fs.syncDirectory(dirname(this.path));
      } catch (error) {
        this.dirty = true;
        throw error;
      }
    });
    this.writing = run.catch(() => undefined);
    return run;
  }

  override async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.persist();
  }
}
