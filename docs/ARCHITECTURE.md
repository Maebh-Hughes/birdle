# BIRDLE architecture

BIRDLE is an npm-workspaces monorepo with three TypeScript (ESM) packages:

| Package | Role |
|---|---|
| `shared` (`@birdle/shared`) | Game rules and API types, used by both sides. Source-only, with no build step: Vite and tsx consume the `.ts` files directly. It has two entry points: `@birdle/shared` (client-safe) and `@birdle/shared/server` (answers, hints, facts and the dictionary, **server-only**). |
| `server` (`@birdle/server`) | An Express 5 API, run from source with `tsx`. It owns every game and is the only guess validator. In production it also serves the built client. |
| `client` (`@birdle/client`) | Vite + React 19 + `@discord/embedded-app-sdk`. It renders the game and talks to Discord and the API, and it never learns the answer before a game ends. |

## Diagram

```
                         Discord client (desktop / web / mobile)
   ┌───────────────────────────────────────────────────────────────────────────┐
   │  iframe  https://<CLIENT_ID>.discordsays.com                              │
   │  ┌─────────────────────────────────────────────────────────────────────┐  │
   │  │ BIRDLE client (React)                                               │  │
   │  │  discord/  DiscordSDK ◄── postMessage RPC ──► Discord client        │  │
   │  │            authorize · authenticate · participants · setActivity    │  │
   │  │            shareLink · openExternalLink · orientation lock          │  │
   │  │  api.ts    fetch('/api/...', Authorization: Bearer <token>)         │  │
   │  └──────────────────────────────┬──────────────────────────────────────┘  │
   └─────────────────────────────────┼─────────────────────────────────────────┘
                                     │ relative /api/* and page assets
                                     ▼
                     Discord Activity proxy (URL mapping  "/" → your host)
                                     │
            ┌────────────────────────┴───────────────────────────┐
            │ development                                        │ production
            ▼                                                    ▼
  cloudflared tunnel → Vite :5173                     HTTPS → Node :PORT (one process)
     ├─ client source (HMR)                              ├─ /api/*  Express API
     └─ /api/* ── proxy ──► Express :3001               └─ /*      client/dist (SPA fallback)
                              │
          ┌───────────────────┼──────────────────────────┐
          ▼                   ▼                          ▼
   @birdle/shared/server   JsonFileStore (DATA_FILE)   discord.com/api
   birds.json +            profiles, stats, daily +    POST /oauth2/token
   guesses.txt (answers,   practice games, instance    GET  /v10/oauth2/@me
   hints, facts, dict)     memberships
```

In a plain browser (local development), `DiscordSDKMock` replaces the real SDK and the page talks straight to Vite on
`localhost:5173`. There is no Discord and no tunnel, and sign-in uses `mock:` tokens.

## Data flow

### Start-up and sign-in

1. `main.tsx` checks for the `frame_id`, `instance_id` and `platform` query parameters.
   - All present (launched by Discord): it creates `new DiscordSDK(VITE_DISCORD_CLIENT_ID)`.
   - Otherwise (plain browser): it creates `DiscordSDKMock(clientId, 'mock_guild', 'mock_channel', null)`. The
     mock's instance id is the fixed `123456789012345678`, so all local tabs share one Flock.
2. Inside Discord (`session.ts` → `discord/auth.ts`):
   1. `ready()`, which times out after 20 s.
   2. `authorize({ scope: ['identify', 'rpc.activities.write'], prompt: 'none', response_type: 'code', state: '' })`.
      If that rejects, it retries once with `['identify']` and rich presence is turned off.
   3. `POST /api/token { code }` returns `{ access_token }`.
   4. `authenticate({ access_token })`.

   The Discord access token is then the API bearer token.
3. In the browser (mock mode), the identity comes from `?user=<name>`, or a random `guest-xxxxxx` id kept in
   `localStorage`. The bearer token is `mock:<id>:<encodeURIComponent(displayName)>`, and the mock OAuth code is
   never sent to the server.
4. `GET /api/me?date=<local date>` returns `{ user, stats }`. Streaks are computed as of the player's local puzzle
   date, so a player whose date differs from UTC still sees the right streak. A date that isn't playable (a device
   clock days off) falls back to the UTC date rather than failing sign-in, so Free Flight still works.
5. `useGame` loads `GET /api/daily?date=<local date>`. `useFlock` joins the instance and starts polling (below).

### Playing a guess

1. The reducer (`game/reducer.ts`) collects letters. It never lets you type past `wordLength`, and it checks length
   and hard mode locally so the feedback is instant. Only one guess can be in flight at a time.
2. `POST /api/daily/guess { date, guess, hardMode }` goes to the server. The server checks, in order:
   1. the date (`BAD_DATE`);
   2. the body (`BAD_REQUEST`);
   3. whether the game is already over (`GAME_OVER`);
   4. letters and length (`INVALID_GUESS`);
   5. the word list (`NOT_IN_WORD_LIST`);
   6. hard mode (`HARD_MODE`).

   It then evaluates the guess (the two-pass duplicate-letter algorithm) and saves it under the player's lock. If the
   game has ended, it also updates stats.
3. The response `{ game, stats }` drives the flip animation. When the game ends, `game.answer` (the bird card) and
   `game.hint` arrive for the first time.
4. Some errors show that the game on screen is stale: `GAME_OVER`, `INVALID_GUESS` and (in Free Flight) `NOT_FOUND`.
   These happen when the game was finished or replaced in another tab. The client then reloads the game from the
   server.
5. A guess that fails without a clear answer (timeout, dropped connection, `5xx`) may still have been saved. The
   client reloads the game and sends nothing more in that mode until the reload succeeds (Enter retries the reload).
   The typed letters stay only if the server's game hasn't moved on, so a guess is never counted twice.
6. The bird card opens after the reveal and celebration, and only if that game is still on screen: switching to Free
   Flight, starting a new bird or moving to a new day in the meantime cancels it.
7. After local midnight a new daily puzzle is picked up (the check is re-armed each time, so a clock or time-zone
   change can't stop it). A board with guesses is kept, with a "Play today's" prompt, until any guess or hint in flight
   has been answered.

### The Flock

1. The client subscribes to `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` first, then reads the
   `getInstanceConnectedParticipants()` snapshot, so no change is missed in between. If Discord refuses the
   subscription, the snapshot is still read and the SDK's stray listener is removed.
2. `POST /api/instances/:instanceId/join { date }` registers the player in the instance.
3. `GET /api/instances/:instanceId/flock?date=` returns every member's progress on that date's puzzle, as colours
   only. The client polls it every 5 s while the page is visible, and right after each of the player's own daily
   guesses. A `403` (the membership expired) makes the client join again once and retry. While the player's own
   newest row is still flipping, their Flock row is shown as it was before it, so the panel doesn't give the result
   away early.
4. `flock.ts` merges the two lists:
   - Connected participants who haven't played appear as *idle*.
   - Players who left but already played stay listed.
   - Names come from Discord (nickname → global name → username) when available.

   In mock mode the participant list is fake, so every listed player counts as connected.

### Sharing, links and presence

- **Share:**
  - Inside Discord it calls `shareLink({ message, custom_id: 'birdle-<n>' })`.
  - If that isn't available, or in a browser, it falls back to `navigator.clipboard`, then `execCommand('copy')`,
    then a read-only textarea for manual copying.
  - Daily share text never names the answer.
- **Learn more:** `openExternalLink({ url })` inside Discord, or `window.open(url, '_blank', 'noopener')` in a
  browser.
- **Rich presence:** `setActivity({ activity: { type: 0, details, state, timestamps: { start } } })`.
  - `details` is "BIRDLE #12" or "BIRDLE Free Flight".
  - `state` is "Guess 3 of 6", "Solved in 4/6" or "Stumped today".
  - `timestamps.start` is when the daily puzzle or the current Free Flight round started.
  - It is sent only when `rpc.activities.write` was granted, and any failure is ignored.

## API reference

All routes are under `/api` and exchange JSON. Every `/api` response carries `Cache-Control: no-store`. Request
bodies are limited to 16 KB. Words in responses are uppercase. Guesses are trimmed and case-insensitive. Types come
from `shared/src/types.ts`.

**Authentication.** Every route except `GET /api/health` and `POST /api/token` needs
`Authorization: Bearer <token>`, where the token is either:
- a Discord OAuth2 access token, or
- when mock auth is enabled, `mock:<id>` or `mock:<id>:<URL-encoded display name>`. `<id>` is 1–64 characters from
  `[A-Za-z0-9._-]`.

**Dates.** `date` is the player's local calendar date as `YYYY-MM-DD`. The server accepts it only if it is a real
date within UTC today ± 1 day (which covers every time zone) and its puzzle number is ≥ 1. The puzzle number is
`daysBetween('2026-09-26', date) + 1`.

### Routes

| Method & path | Request | Success response | Errors (besides 401) |
|---|---|---|---|
| `GET /api/health` | — | `{ ok: true }` | — |
| `POST /api/token` | `{ code }` (1–512 chars) | `{ access_token }` | 400 missing or invalid code · 429 too many sign-ins at once · 502 Discord rejected the exchange or couldn't be reached · 503 Discord credentials not configured |
| `GET /api/me[?date=]` | optional `date` (default, or when not playable: today's UTC date) | `{ user: PlayerProfile, stats: Stats }` | — |
| `GET /api/daily?date=` | `date` | `{ game: GameView }` (an empty game if none; nothing is stored until the first guess) | 400 `BAD_DATE` |
| `POST /api/daily/guess` | `{ date, guess, hardMode? }` | `{ game: GameView, stats: Stats }` | 400 `BAD_DATE` / `BAD_REQUEST` · 409 `GAME_OVER` · 422 `INVALID_GUESS` / `NOT_IN_WORD_LIST` / `HARD_MODE` |
| `POST /api/daily/hint` | `{ date }` | `{ game: GameView }` (calling it again is harmless) | 400 `BAD_DATE` · 409 `GAME_OVER` · 422 `HINT_UNAVAILABLE` (fewer than 3 guesses) |
| `GET /api/practice` | — | `{ game: GameView \| null }` | — |
| `POST /api/practice/new` | `{}` | `{ game: GameView }`, which replaces the current practice game and avoids the previous answer | — |
| `POST /api/practice/guess` | `{ guess, hardMode? }` | `{ game: GameView }` (no stats) | 404 `NOT_FOUND` (no practice game) · 409 `GAME_OVER` · 422 as for daily |
| `POST /api/practice/hint` | `{}` | `{ game: GameView }` | 404 `NOT_FOUND` · 409 `GAME_OVER` · 422 `HINT_UNAVAILABLE` |
| `POST /api/instances/:instanceId/join` | `{ date }` (validated, not stored) | `{ ok: true }`; a player stays in at most 5 instances, an instance keeps at most 100 members (the least recently seen are dropped) | 400 `BAD_REQUEST` (id not `[A-Za-z0-9._:-]{1,128}`) / `BAD_DATE` |
| `GET /api/instances/:instanceId/flock?date=` | `date` | `{ players: FlockPlayer[] }` | 400 `BAD_REQUEST` / `BAD_DATE` · 403 `FORBIDDEN` (not joined in the last 24 h) |

A `hardMode` value that is present but not a boolean is a `400 BAD_REQUEST`. It only matters on a game's first guess,
which fixes hard mode for the rest of the game. An unknown `/api` route returns `404 NOT_FOUND`. Any authenticated
route can answer `429` while Discord lookups of unknown tokens are being rationed (see Token validation).

### Errors

Every non-2xx response has the body `{ "error": { "code": ApiErrorCode, "message": string } }`.

| Code | HTTP | Typical message |
|---|---|---|
| `BAD_REQUEST` | 400 | "Expected a JSON object body", "guess must be a string", "Missing OAuth2 code", "Malformed JSON body" |
| `UNAUTHORIZED` | 401 | "Missing bearer token", "Invalid or expired token" |
| `BAD_DATE` | 400 | "That puzzle isn't available", "Missing puzzle date" |
| `INVALID_GUESS` | 422 | "Not enough letters", "Too many letters", "Use letters A-Z only" |
| `NOT_IN_WORD_LIST` | 422 | "Not in word list" |
| `HARD_MODE` | 422 | "2nd letter must be R", "Guess must contain A" |
| `HINT_UNAVAILABLE` | 422 | "The hint unlocks after 3 guesses" |
| `GAME_OVER` | 409 | "This game is already over" |
| `NOT_FOUND` | 404 | "No practice game yet; …", "No such API route" |
| `FORBIDDEN` | 403 | "Join this activity instance first" |

The shared error-code list has no code for server failures or rate limits. So `5xx` responses (500 internal error,
502 Discord failure, 503 Discord not configured), `429` (Discord calls rationed), and `413`/`415` for oversized or
unsupported bodies, carry `code: "BAD_REQUEST"`. Clients must branch on the HTTP status for those: the BIRDLE client treats any `5xx` as an
`UNKNOWN` failure. Internal error details are logged, never sent.

### Response shapes

```ts
interface GameView {
  mode: 'daily' | 'practice';
  puzzleNumber: number | null;   // null in practice
  date: string | null;           // null in practice
  wordLength: number;            // 4-11
  guesses: { word: string; result: ('correct' | 'present' | 'absent')[] }[];
  status: 'playing' | 'won' | 'lost';
  hardMode: boolean;             // false until the first guess, then fixed
  hintUsed: boolean;
  hintAvailable: boolean;        // playing && guesses >= 3 && !hintUsed
  hint: string | null;           // only once used, or once the game is over
  answer: BirdReveal | null;     // only once the game is over
  maxGuesses: number;            // 6
}
interface BirdReveal { word: string; name: string; kind: 'bird' | 'term'; fact: string; wikiUrl: string }
interface Stats {
  played: number; wins: number; currentStreak: number; maxStreak: number;
  distribution: number[];        // wins by guess count, length 6
  lastPlayedPuzzle: number | null; lastWonPuzzle: number | null;
}
interface PlayerProfile { id: string; username: string; displayName: string; avatarUrl: string | null }
interface FlockPlayer extends PlayerProfile {
  status: 'playing' | 'won' | 'lost' | 'idle';   // idle = no guesses on this date's puzzle
  rows: ('correct' | 'present' | 'absent')[][];  // colours only, never letters
  hintUsed: boolean; hardMode: boolean;
}
```

**Stats rules:**
- Only daily games count.
- A win on puzzle *n* sets the streak to `streak + 1` if the last win was *n − 1*, otherwise to `1`. A loss resets
  the streak to `0`.
- When stats are read, a streak whose last win is older than yesterday's puzzle shows as `0`.
- Finishing an older puzzle (yesterday's, after today's) counts toward played, wins and distribution, but leaves the
  streaks alone.

**Flock rules:**
- The Flock lists at most 50 players: the caller plus the 49 most recently seen, in join order.
- A membership expires 24 h after the last join or poll. Polls refresh it at most once an hour, to avoid a write on
  every poll.
- Instance ids come from the client, so what one account can make the server store is bounded: a player is a member
  of at most 5 instances and an instance keeps at most 100 members, dropping the least recently seen.

### Daily answer selection

- `DAILY_POOL` is every `birds.json` entry with `obscurity ≤ 2`, sorted by word.
- For puzzle *n*: `cycle = ⌊(n−1)/len⌋`, `idx = (n−1) mod len`, and the answer is
  `seededShuffle(DAILY_POOL, hash(PUZZLE_SEED + ':' + cycle))[idx]`. The shuffle is a Fisher–Yates driven by
  mulberry32.
- So there are no repeats within a cycle, and each cycle gets a fresh order.
- Free Flight picks uniformly from **all** entries and avoids the previous answer.

## Storage

`JsonFileStore` keeps everything in memory and persists it to `DATA_FILE` as one JSON document:
`{ version: 1, profiles, stats, daily, practice, instances }`.

- **Writes:** batched up to 250 ms after the first unsaved change. Each write goes to `<file>.tmp`, which is flushed
  to disk (`fsync`) and then renamed over the real file (on POSIX the directory is synced too), so a crash or power
  cut never leaves a half-written database. A failed write, including a failed serialization, keeps the changes
  pending and is retried after 5 s.
- **Shutdown:** SIGINT, SIGTERM, SIGHUP and (on Windows) SIGBREAK stop new connections, let requests in progress
  finish (up to 5 s, then the rest are cut), and only then flush pending writes and exit. A request that got its
  answer has its changes on disk.
- **Corrupt data:** a corrupt file is moved aside as `<name>.corrupt-<time>.json`, and the server starts empty with
  a loud error. Individually malformed records are dropped with a warning.
- **Concurrency:** every state change for a user runs under that user's in-process lock (`KeyedMutex`), so
  double-submits and retries apply one after another instead of overwriting each other.
- **Pruning:** an hourly job removes instance memberships idle for more than 24 h and daily games more than 3 puzzles
  older than today's UTC puzzle. Only dates within a day of today can be read, so older games would only slow every
  write. Stats are kept.
- **Scaling:** run a single server process. The store is not shared between processes.

## Security model

### Answer secrecy

- The answer list, hints, facts and dictionary are loaded only by `@birdle/shared/server`. Client code imports only
  the `@birdle/shared` index, which has no word data and no `fs`. `npm run build` runs `scripts/check-bundle.mjs`,
  which fails the build if `client/dist` contains:
  - any hint or fact;
  - adjacent dictionary words;
  - `birds.json` keys;
  - more than 20 bird words as string literals (How to play shows a few examples);
  - the configured client secret.
- The server is the only guess validator. The client never ships a dictionary, so it can't be used to narrow down
  answers.
- A `GameView` includes `answer` only once `status` is `won` or `lost`, and includes `hint` only once it was used or
  the game is over. Error messages never mention the answer.
- The Flock sends colours only. Other players' letters and answers never leave the server. Server tests assert that
  no answer, hint, fact or Wikipedia link appears in any response before the game ends, including `/api/me`, the
  Flock and error bodies.
- Daily share text never names the answer. Only Free Flight shares end with `🐦 {Name}`.
- The daily order depends only on the word list and `PUZZLE_SEED`, and the shuffle code is public. A production
  server with the default seed logs a warning at startup: set a private random seed there.
- The Vite dev server (reachable through a tunnel in development) serves only `client/`, `shared/src/` and
  `node_modules/`, so `shared/data`, the server source and the database can't be fetched through `/@fs/`.

### Token validation

- Discord access tokens are checked against `GET https://discord.com/api/v10/oauth2/@me`, which returns the token's
  application and user in one call:
  - `401` or `403`, a token issued to another application (not `VITE_DISCORD_CLIENT_ID`), or one without the
    `identify` scope → the token is invalid, and the API answers `401 UNAUTHORIZED`;
  - network failure, timeout or `5xx` → `502`, never a silent pass.
  - (The spec named `/users/@me`, which answers for any app's token; `/oauth2/@me` adds the audience check.)
- Valid tokens are cached for **5 minutes** in a map bounded to **1000** entries, evicting the oldest first.
  Rejected tokens are remembered for **1 minute** the same way. Both caches are keyed by the token's **SHA-256
  digest**, so raw tokens are never kept or logged. Concurrent checks of one token share a single Discord call.
- **Discord call budget** (`discordGuard.ts`): Discord bans an IP from its whole API for a while after 10,000 `401`,
  `403` or `429` responses in 10 minutes, and anyone can make the server look up a made-up token. Every Discord call
  takes a share of a token bucket (100 at once, refilled at 5/s, so at most about 3,100 rejections per 10 minutes);
  the share comes back when Discord accepts the call. OAuth2 code exchanges have their own bucket (30 at once, 2/s).
  When a bucket is empty the server answers `429` without calling Discord. Players all reach the server through
  Discord's proxy, so the budget is global rather than per IP.
- The OAuth2 code exchange (`POST https://discord.com/api/oauth2/token`, form-encoded `client_id`, `client_secret`,
  `grant_type=authorization_code`, `code`, and no `redirect_uri`):
  - happens only on the server, and returns only `{ access_token }` to the client;
  - retries once on `429` if Discord asks for a wait of 5 s or less;
  - never puts codes, tokens or the secret in error messages.
- `DISCORD_CLIENT_SECRET` is read only by the server. Vite exposes only `VITE_*` variables to the browser, and the
  bundle check greps for the secret.

### Mock auth

- `mock:` tokens let anyone claim any identity, so they are meant for local development only. They are accepted only
  when `BIRDLE_ALLOW_MOCK_AUTH` is true, or when it is unset and `NODE_ENV` isn't `production`.
- In production they are rejected (`401`) unless explicitly enabled, and enabling them logs a loud warning at
  startup.
- In production the server also refuses to start without the Discord credentials, unless mock auth was explicitly
  enabled.
- When the dev server is exposed through a public tunnel, set `BIRDLE_ALLOW_MOCK_AUTH=false` if the dev data matters.
  The dev server's file serving is restricted either way (see Answer secrecy).

### Other measures

- **Names:** display names from mock tokens and Discord `global_name` have control and bidi-override characters
  removed and are capped at 32 characters. The client renders every name as text, never as HTML.
- **Avatars:** avatar URLs are built only from a validated hash on `cdn.discordapp.com/avatars/`, a host on the
  Activity CSP allow-list. Default avatars fall back to an initials bubble.
- **Input limits:**
  - JSON bodies are limited to 16 KB.
  - Guesses longer than 64 characters are rejected.
  - Instance ids must match `[A-Za-z0-9._:-]{1,128}`.
  - Every body field is type-checked.
- **Headers:**
  - `X-Content-Type-Options: nosniff` and no `X-Powered-By`.
  - Deliberately **no** `X-Frame-Options`, because the page must load inside Discord's iframe.
  - `index.html` is served with `no-cache`, and hashed `/assets/*` are immutable for a year.
  - A missing file that has an extension gets a plain-text 404, never the SPA page.
- **Client storage:** the client keeps only settings and the mock guest id in `localStorage`, and every access is
  wrapped in try/catch. All game state lives on the server.
