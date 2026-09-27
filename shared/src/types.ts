// Game model and API DTOs shared by the server and the client.
// Words are always uppercase A-Z in these types.

export type LetterState = 'correct' | 'present' | 'absent';

export interface GuessRow {
  word: string;
  result: LetterState[];
}

export type GameStatus = 'playing' | 'won' | 'lost';

export type GameMode = 'daily' | 'practice';

/**
 * 'bird' = a real bird, 'term' = bird vocabulary (TALON, PREEN); the others are
 * fictional birds: 'pokemon', 'game' (video games) and 'literature' (books, myths, films).
 */
export type BirdKind = 'bird' | 'term' | 'pokemon' | 'game' | 'literature';

/**
 * Obscurity 1 = well known, 2 = fairly known, 3 = rare (practice only). Daily
 * answers are real birds and bird words up to 2, fictional birds only at 1.
 */
export type Obscurity = 1 | 2 | 3;

/** Free Flight answer pools: 'birds' = bird + term, 'fiction' = game + literature. */
export type PracticeCategory = 'all' | 'birds' | 'pokemon' | 'fiction';

/** One entry of shared/data/birds.json. Server-only data: never send hint/fact before the game ends. */
export interface BirdEntry {
  /** The answer: 4-11 letters A-Z, the letters-only form of the name ("Farfetch'd" -> FARFETCHD). */
  word: string;
  /** Display name; may contain spaces, punctuation and accents ("Ho-Oh", "Kākāpō"). */
  name: string;
  kind: BirdKind;
  /** Where a fictional bird comes from ("Pokémon Red & Blue"). Required for pokemon/game/literature, absent otherwise. */
  source?: string;
  hint: string;
  fact: string;
  /** English Wikipedia article title, optionally with a #Section ("Kākāpō", "Talon_(anatomy)"). Exactly one of wiki / link. */
  wiki?: string;
  /** Full https URL of a non-Wikipedia page (e.g. Bulbapedia). Exactly one of wiki / link. */
  link?: string;
  obscurity: Obscurity;
}

/** The "bird card" shown once a game is over. */
export interface BirdReveal {
  word: string;
  name: string;
  kind: BirdKind;
  /** Where a fictional bird comes from; null for real birds and bird words. */
  source: string | null;
  fact: string;
  /** The "Learn more" page. */
  infoUrl: string;
  /** Friendly name of the infoUrl site: "Wikipedia", "Bulbapedia", "Fandom", ... */
  infoSite: string;
}

export interface GameView {
  mode: GameMode;
  /** Daily puzzle number; null in practice mode. */
  puzzleNumber: number | null;
  /** Daily puzzle date (YYYY-MM-DD); null in practice mode. */
  date: string | null;
  /** The Free Flight category the answer was drawn from; null in daily mode. */
  category: PracticeCategory | null;
  /** Length of the answer (4-11); the board is this wide. */
  wordLength: number;
  guesses: GuessRow[];
  status: GameStatus;
  hardMode: boolean;
  hintUsed: boolean;
  hintAvailable: boolean;
  /** Only set once the hint was used or the game is over. */
  hint: string | null;
  /** Only set once the game is over. */
  answer: BirdReveal | null;
  maxGuesses: number;
}

export interface Stats {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  /** distribution[i] = wins in i + 1 guesses (length MAX_GUESSES). */
  distribution: number[];
  lastPlayedPuzzle: number | null;
  lastWonPuzzle: number | null;
}

export interface PlayerProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export type FlockStatus = GameStatus | 'idle';

/**
 * A player in the same Activity instance. Colours only, never letters.
 * The puzzle's word length is implied by rows[i].length.
 */
export interface FlockPlayer extends PlayerProfile {
  status: FlockStatus;
  rows: LetterState[][];
  hintUsed: boolean;
  hardMode: boolean;
}

// ---- API ----

export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'BAD_DATE',
  'NOT_IN_WORD_LIST',
  'HARD_MODE',
  'INVALID_GUESS',
  'GAME_OVER',
  'HINT_UNAVAILABLE',
  'NOT_FOUND',
  'FORBIDDEN',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Body of every non-2xx API response. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

/** GET /api/health */
export interface HealthResponse {
  ok: true;
}

/** GET /api/config (public, no auth): settings the client needs before it can sign in. */
export interface ConfigResponse {
  /** The Discord application (client) id, or null when the server has none configured. */
  discordClientId: string | null;
}

/** POST /api/token */
export interface TokenRequest {
  code: string;
}
export interface TokenResponse {
  access_token: string;
}

/** GET /api/me */
export interface MeResponse {
  user: PlayerProfile;
  stats: Stats;
}

/** GET /api/daily?date=, POST /api/daily/hint, POST /api/practice/new|guess|hint */
export interface GameResponse {
  game: GameView;
}

/** POST /api/daily/guess */
export interface DailyGuessRequest {
  date: string;
  guess: string;
  hardMode: boolean;
}
export interface DailyGuessResponse {
  game: GameView;
  stats: Stats;
}

/** POST /api/daily/hint */
export interface DailyHintRequest {
  date: string;
}

/** POST /api/practice/new */
export interface PracticeNewRequest {
  /** Default 'all'. */
  category?: PracticeCategory;
}

/** GET /api/practice */
export interface PracticeGameResponse {
  game: GameView | null;
}

/** POST /api/practice/guess */
export interface PracticeGuessRequest {
  guess: string;
  hardMode: boolean;
}

/** POST /api/instances/:instanceId/join */
export interface JoinInstanceRequest {
  date: string;
}
export interface OkResponse {
  ok: true;
}

/** GET /api/instances/:instanceId/flock?date= */
export interface FlockResponse {
  players: FlockPlayer[];
}
