import {
  HINT_AFTER_GUESSES,
  MAX_GUESSES,
  emptyStats,
  evaluateGuess,
  hardModeViolation,
  isSolved,
  puzzleNumberForDate,
  recordGameResult,
  statsForDisplay,
  type DailyGuessResponse,
  type GameView,
  type PlayerProfile,
  type PracticeCategory,
  type Stats,
} from '@birdle/shared';
import { ApiError } from './errors';
import { KeyedMutex } from './lock';
import type { Puzzles } from './puzzle';
import type { GameRecord, Store } from './store';

/**
 * The client's view of a game. The answer's bird card is only included once the
 * game is over, and the hint only once it was used or the game is over.
 */
export function toGameView(game: GameRecord, puzzles: Puzzles): GameView {
  const over = game.status !== 'playing';
  const hint = puzzles.hintFor(game.answer);
  return {
    mode: game.mode,
    puzzleNumber: game.puzzleNumber,
    date: game.date,
    category: game.category,
    wordLength: game.answer.length,
    guesses: game.guesses.map((row) => ({ word: row.word, result: [...row.result] })),
    status: game.status,
    hardMode: game.hardMode,
    hintUsed: game.hintUsed,
    hintAvailable: !over && !game.hintUsed && hint !== null && game.guesses.length >= HINT_AFTER_GUESSES,
    hint: over || game.hintUsed ? hint : null,
    answer: over ? puzzles.reveal(game.answer) : null,
    maxGuesses: MAX_GUESSES,
  };
}

/**
 * Applies one guess, or throws the matching ApiError. Checks run in Wordle's
 * order: letters/length, word list, then hard mode. Hard mode is fixed by the
 * flag sent with a game's first guess.
 */
export function playGuess(
  game: GameRecord,
  rawGuess: string,
  hardMode: boolean,
  isValidGuess: (word: string) => boolean,
): GameRecord {
  if (game.status !== 'playing') throw new ApiError('GAME_OVER');
  const trimmed = rawGuess.trim();
  // Checked before uppercasing: 'ß'.toUpperCase() is 'SS'.
  if (!/^[A-Za-z]*$/.test(trimmed)) throw new ApiError('INVALID_GUESS', 'Use letters A-Z only');
  const guess = trimmed.toUpperCase();
  if (guess.length < game.answer.length) throw new ApiError('INVALID_GUESS', 'Not enough letters');
  if (guess.length > game.answer.length) throw new ApiError('INVALID_GUESS', 'Too many letters');
  // The answer itself always counts, even if it has since left the word list.
  if (guess !== game.answer && !isValidGuess(guess)) throw new ApiError('NOT_IN_WORD_LIST');

  const hard = game.guesses.length === 0 ? hardMode : game.hardMode;
  if (hard) {
    const violation = hardModeViolation(guess, game.guesses);
    if (violation) throw new ApiError('HARD_MODE', violation);
  }

  const result = evaluateGuess(guess, game.answer);
  const guesses = [...game.guesses, { word: guess, result }];
  const status = isSolved(result) ? 'won' : guesses.length >= MAX_GUESSES ? 'lost' : 'playing';
  return { ...game, guesses, status, hardMode: hard };
}

/** Reveals the hint (idempotent), or throws GAME_OVER / HINT_UNAVAILABLE. */
export function revealHint(game: GameRecord, puzzles: Puzzles): GameRecord {
  if (game.status !== 'playing') throw new ApiError('GAME_OVER');
  if (game.hintUsed) return game;
  if (game.guesses.length < HINT_AFTER_GUESSES) {
    throw new ApiError('HINT_UNAVAILABLE', `The hint unlocks after ${HINT_AFTER_GUESSES} guesses`);
  }
  if (puzzles.hintFor(game.answer) === null) throw new ApiError('HINT_UNAVAILABLE', 'No hint for this bird');
  return { ...game, hintUsed: true };
}

/** What an empty Free Flight category is missing, for the error message. */
const CATEGORY_CONTENTS: Readonly<Record<PracticeCategory, string>> = {
  all: 'birds',
  birds: 'real birds',
  pokemon: 'bird Pokémon',
  fiction: 'video game or book birds',
};

/** The 400 for a Free Flight category that has no answers (yet). */
export function emptyCategoryError(category: PracticeCategory): ApiError {
  return new ApiError('BAD_REQUEST', `There are no ${CATEGORY_CONTENTS[category]} in Free Flight yet. Pick another category.`);
}

function sameProfile(a: PlayerProfile, b: PlayerProfile): boolean {
  return a.id === b.id && a.username === b.username && a.displayName === b.displayName && a.avatarUrl === b.avatarUrl;
}

export interface GameServiceOptions {
  store: Store;
  puzzles: Puzzles;
  /** Random source for practice answers. */
  random: () => number;
}

/**
 * Daily and practice games plus stats. Every state change for a user runs under
 * that user's lock, so concurrent requests (double-submits, retries) are applied
 * one after another instead of overwriting each other.
 */
export class GameService {
  private readonly store: Store;
  private readonly puzzles: Puzzles;
  private readonly random: () => number;
  private readonly locks = new KeyedMutex();
  private readonly isValidGuess = (word: string): boolean => this.puzzles.isValidGuess(word);

  constructor(options: GameServiceOptions) {
    this.store = options.store;
    this.puzzles = options.puzzles;
    this.random = options.random;
  }

  private withUser<T>(userId: string, task: () => Promise<T>): Promise<T> {
    return this.locks.run(userId, task);
  }

  /** Stores the player's latest Discord/mock profile (shown to others in the Flock) when it changed. */
  async syncProfile(profile: PlayerProfile): Promise<void> {
    const stored = await this.store.getProfile(profile.id);
    if (stored && sameProfile(stored, profile)) return;
    await this.withUser(profile.id, () => this.store.saveProfile(profile));
  }

  /** Daily stats as displayed on puzzle `currentPuzzle` (lapsed streaks show as 0). */
  async stats(userId: string, currentPuzzle: number): Promise<Stats> {
    return statsForDisplay((await this.store.getStats(userId)) ?? emptyStats(), currentPuzzle);
  }

  /**
   * The answer of daily puzzle `puzzleNumber`. The first time a puzzle is
   * served its answer is pinned in the store, and from then on the pinned word
   * is used even if birds.json changes (which reshuffles the computed order).
   * Puzzles nobody has been served yet follow the current word list.
   */
  private async dailyAnswer(puzzleNumber: number): Promise<string> {
    const pinned = await this.store.getDailyAnswer(puzzleNumber);
    if (pinned !== undefined) return pinned;
    return this.store.pinDailyAnswer(puzzleNumber, this.puzzles.dailyAnswer(puzzleNumber));
  }

  private async dailyGame(userId: string, date: string): Promise<GameRecord> {
    const puzzleNumber = puzzleNumberForDate(date);
    const stored = await this.store.getDailyGame(userId, puzzleNumber);
    if (stored) return stored;
    // The game itself is not persisted until the first guess; its answer is pinned now.
    return {
      mode: 'daily',
      puzzleNumber,
      date,
      category: null,
      answer: await this.dailyAnswer(puzzleNumber),
      guesses: [],
      status: 'playing',
      hardMode: false,
      hintUsed: false,
    };
  }

  /** `date` must already be validated as playable. */
  async getDaily(userId: string, date: string): Promise<GameView> {
    return toGameView(await this.dailyGame(userId, date), this.puzzles);
  }

  async guessDaily(userId: string, date: string, guess: string, hardMode: boolean): Promise<DailyGuessResponse> {
    return this.withUser(userId, async () => {
      const puzzleNumber = puzzleNumberForDate(date);
      const game = playGuess(await this.dailyGame(userId, date), guess, hardMode, this.isValidGuess);
      await this.store.saveDailyGame(userId, puzzleNumber, game);
      let stats = (await this.store.getStats(userId)) ?? emptyStats();
      if (game.status !== 'playing') {
        stats = recordGameResult(stats, puzzleNumber, game.status === 'won', game.guesses.length);
        await this.store.saveStats(userId, stats);
      }
      return { game: toGameView(game, this.puzzles), stats: statsForDisplay(stats, puzzleNumber) };
    });
  }

  async hintDaily(userId: string, date: string): Promise<GameView> {
    return this.withUser(userId, async () => {
      const current = await this.dailyGame(userId, date);
      const game = revealHint(current, this.puzzles);
      if (game !== current) await this.store.saveDailyGame(userId, puzzleNumberForDate(date), game);
      return toGameView(game, this.puzzles);
    });
  }

  async getPractice(userId: string): Promise<GameView | null> {
    const game = await this.store.getPracticeGame(userId);
    return game ? toGameView(game, this.puzzles) : null;
  }

  /**
   * Starts a new practice game with an answer from `category`, replacing any
   * current one. Throws a 400 when the category has no answers.
   */
  async newPractice(userId: string, category: PracticeCategory = 'all'): Promise<GameView> {
    if (this.puzzles.practiceCount(category) === 0) throw emptyCategoryError(category);
    return this.withUser(userId, async () => {
      const previous = await this.store.getPracticeGame(userId);
      const game: GameRecord = {
        mode: 'practice',
        puzzleNumber: null,
        date: null,
        category,
        answer: this.puzzles.randomPracticeAnswer(this.random, previous?.answer, category),
        guesses: [],
        status: 'playing',
        hardMode: false,
        hintUsed: false,
      };
      await this.store.savePracticeGame(userId, game);
      return toGameView(game, this.puzzles);
    });
  }

  private async practiceGame(userId: string): Promise<GameRecord> {
    const game = await this.store.getPracticeGame(userId);
    if (!game) throw new ApiError('NOT_FOUND', 'No practice game yet; start one with POST /api/practice/new');
    return game;
  }

  async guessPractice(userId: string, guess: string, hardMode: boolean): Promise<GameView> {
    return this.withUser(userId, async () => {
      const game = playGuess(await this.practiceGame(userId), guess, hardMode, this.isValidGuess);
      await this.store.savePracticeGame(userId, game);
      return toGameView(game, this.puzzles);
    });
  }

  async hintPractice(userId: string): Promise<GameView> {
    return this.withUser(userId, async () => {
      const current = await this.practiceGame(userId);
      const game = revealHint(current, this.puzzles);
      if (game !== current) await this.store.savePracticeGame(userId, game);
      return toGameView(game, this.puzzles);
    });
  }
}
