import { format } from 'node:util';
import type { Express } from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import type { BirdEntry, GameView } from '@birdle/shared';
import { createWordCatalog, type WordCatalog } from '@birdle/shared/server';
import { createApp, type AppDeps } from '../src/app';
import type { DiscordClient, DiscordUser } from '../src/discord';
import type { Clock, Logger } from '../src/runtime';
import { MemoryStore, type Store } from '../src/store';

/** A valid fixture entry; override any field. */
export function bird(word: string, overrides: Partial<BirdEntry> = {}): BirdEntry {
  const name = word.charAt(0) + word.slice(1).toLowerCase();
  return {
    word,
    name,
    kind: 'bird',
    hint: `Fixture hint for a ${word.length}-letter entry`,
    fact: `Fixture fact about a ${word.length}-letter entry.`,
    wiki: name,
    obscurity: 1,
    ...overrides,
  };
}

/** The only daily-eligible fixture, so every daily answer is ROBIN. */
export const ROBIN = bird('ROBIN', {
  name: 'European robin',
  hint: 'Red-breasted garden songbird',
  fact: 'Often sings under streetlights at night.',
  wiki: 'European robin',
});
export const KAKAPO = bird('KAKAPO', {
  name: 'Kakapo',
  hint: 'Flightless nocturnal parrot',
  fact: 'The heaviest parrot in the world.',
  obscurity: 3,
});
export const TALON = bird('TALON', {
  kind: 'term',
  hint: 'A raptor claw',
  fact: 'Owls can lock their grip shut.',
  wiki: 'Talon (anatomy)',
  obscurity: 3,
});
export const FIXTURE_BIRDS: readonly BirdEntry[] = [ROBIN, KAKAPO, TALON];

/** Five-letter guesses that share no letters with ROBIN. */
export const MISSES = ['slate', 'duvet', 'flask', 'gawky', 'whelp', 'cheat'] as const;
export const FIXTURE_DICTIONARY: readonly string[] = [
  ...MISSES,
  'rains',
  'rhino',
  'rusty',
  'crane',
  'track',
  'burnt',
  'planet',
  'garden',
];

export function fixtureCatalog(
  birds: readonly BirdEntry[] = FIXTURE_BIRDS,
  dictionary: readonly string[] = FIXTURE_DICTIONARY,
): WordCatalog {
  return createWordCatalog(birds, dictionary);
}

/** 2026-10-05 is puzzle #10 (EPOCH_DATE 2026-09-26 is #1). */
export const TODAY = '2026-10-05';
export const TODAY_PUZZLE = 10;

export class TestClock implements Clock {
  private current: Date;

  constructor(iso = `${TODAY}T12:00:00Z`) {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }

  /** Noon UTC on `date` (YYYY-MM-DD). */
  setDate(date: string): void {
    this.set(`${date}T12:00:00Z`);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class RecordingLogger implements Logger {
  readonly lines: string[] = [];
  info = (...args: unknown[]): void => void this.lines.push(format(...args));
  warn = (...args: unknown[]): void => void this.lines.push(format(...args));
  error = (...args: unknown[]): void => void this.lines.push(format(...args));

  get text(): string {
    return this.lines.join('\n');
  }
}

export const DISCORD_TOKEN = 'discord-access-token-123';
export const DISCORD_USER: DiscordUser = {
  id: '80351110224678912',
  username: 'nelly',
  global_name: 'Nelly',
  avatar: '8342729096ea3675442027381ff50dfe',
};

export function fakeDiscord() {
  return {
    exchangeCode: vi.fn<(code: string) => Promise<string>>(async () => DISCORD_TOKEN),
    fetchUser: vi.fn<(token: string) => Promise<DiscordUser | null>>(async (token) =>
      token === DISCORD_TOKEN ? DISCORD_USER : null,
    ),
  } satisfies DiscordClient;
}

export interface TestAppOptions extends Partial<Omit<AppDeps, 'config'>> {
  allowMockAuth?: boolean;
  clientDistDir?: string | null;
}

export function makeTestApp(options: TestAppOptions = {}) {
  const store: Store = options.store ?? new MemoryStore();
  const clock = (options.clock as TestClock | undefined) ?? new TestClock();
  const discord = (options.discord as ReturnType<typeof fakeDiscord> | undefined) ?? fakeDiscord();
  const logger = (options.logger as RecordingLogger | undefined) ?? new RecordingLogger();
  const words = options.words ?? fixtureCatalog();
  const app: Express = createApp({
    ...options,
    config: {
      allowMockAuth: options.allowMockAuth ?? true,
      puzzleSeed: 'test-seed',
      clientDistDir: options.clientDistDir ?? null,
    },
    store,
    clock,
    discord,
    logger,
    words,
  });
  return { app, store, clock, discord, logger, words };
}

/** Authorization header for a mock user. */
export function as(id: string, displayName?: string): Record<string, string> {
  const suffix = displayName === undefined ? '' : `:${encodeURIComponent(displayName)}`;
  return { Authorization: `Bearer mock:${id}${suffix}` };
}

export function dailyGuess(app: Express, user: string, guess: string, extra: Record<string, unknown> = {}) {
  return request(app).post('/api/daily/guess').set(as(user)).send({ date: TODAY, guess, hardMode: false, ...extra });
}

/** Plays several daily guesses in order, failing loudly on the first rejection. */
export async function playDaily(app: Express, user: string, guesses: readonly string[], date = TODAY): Promise<GameView> {
  let game: GameView | undefined;
  for (const guess of guesses) {
    const res = await dailyGuess(app, user, guess, { date });
    if (res.status !== 200) throw new Error(`Guess ${guess} failed: ${res.status} ${res.text}`);
    game = (res.body as { game: GameView }).game;
  }
  if (!game) throw new Error('No guesses played');
  return game;
}
