# BIRDLE 🐦

**BIRDLE** is a Wordle-style daily word game about birds that runs as a **Discord Activity**. You launch it from a
voice channel or the App Launcher, the same way as Discord's own Wordle activity, and everyone in the call plays the
same puzzle. Every answer is a bird word from 4 to 11 letters long: bird names like WREN, ROBIN, PELICAN and
HUMMINGBIRD, bird vocabulary like TALON, PREEN and NESTLING, and fictional birds: Pokémon, video game birds and
birds from books.

It also runs in a normal browser, with no Discord account needed, which is how you develop and test it.

- [The game](#the-game)
- [Quick start (browser, no Discord needed)](#quick-start-browser-no-discord-needed)
- [Running it inside Discord](#running-it-inside-discord)
- [Production deployment](#production-deployment)
- [Configuration](#configuration)
- [Adding and editing birds](#adding-and-editing-birds)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

Architecture, the API reference and the security model are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## The game

- **One bird a day.** Everyone gets the same daily puzzle, numbered from #1 (26 September 2026). It changes at
  your local midnight. If you're still on yesterday's board then, you can finish it first: a *Play today's* button
  (on the board, in Stats and on the bird card) takes you to the new puzzle.
- **Six guesses, any length.** The board is as wide as the day's answer, anywhere from 4 to 11 letters ("Today's bird
  has 7 letters"). You always get six guesses.
- **Real words only.** Each guess has to be a real word of the right length. BIRDLE accepts about 140,000 words, and
  every answer in its list counts as a word too.
- **Colour clues.** After each guess the tiles flip:
  - 🟩 **green**: the letter is in the right spot.
  - 🟨 **gold**: the letter is in the word, but in another spot.
  - ⬛ **slate**: the letter isn't in the word.

  Repeated letters are scored the standard Wordle way.
- **Hint 🪶.** After three guesses you can reveal a one-line hint. Your shared result will show that you used it.
- **Hard mode.** Every revealed hint has to be used in later guesses: green letters stay in place and gold letters
  must be reused. You set it before your first guess, and it is locked for the rest of that game.
- **Real and fictional birds.** Most answers are real birds and bird words. Pokémon, video game birds and birds from
  books are answers too, but only the best-known ones can be the daily bird; Free Flight has them all.
- **Bird card.** When a game ends, win or lose, you get a card with the bird's name, what kind of bird it is (Bird,
  Bird word, Pokémon, Video game bird or Literary bird), where a fictional bird comes from ("from Pokémon Red &
  Blue"), a fun fact and a *Learn more on …* button. It opens the bird's page: Wikipedia for real birds, or a fan wiki
  such as Bulbapedia for characters.
- **Free Flight.** Unlimited practice games with random birds, including rarer ones. These don't count toward your
  stats and aren't shown in the Flock. A category picker above the board (and on the bird card, next to *New bird*)
  chooses where the birds come from:
  - **All**: every bird;
  - **Real birds**: real birds and bird words only;
  - **Pokémon**: bird Pokémon;
  - **Games & books**: birds from video games and books.

  BIRDLE remembers your choice. A fresh round you haven't guessed in yet switches to the new category straight away;
  a round you've started keeps its bird, and the new category applies from the next one. If a category has no birds
  in the word list yet, BIRDLE says so and you can pick another. If a fresh round can't switch (say, the connection
  dropped), a "Couldn't switch" note with a *Try again* button appears under the picker; BIRDLE doesn't keep retrying
  by itself.
- **The Flock.** Players in the same Activity see each other's progress on today's puzzle as coloured squares only,
  never letters.
- **Stats and sharing.** BIRDLE tracks games played, win %, current and best streak, and a guess distribution. Share
  posts a spoiler-free grid:

  ```
  BIRDLE #12 4/6*
  🟨⬛⬛⬛⬛
  ⬛🟩⬛🟨⬛
  🟩🟩⬛🟩⬛
  🟩🟩🟩🟩🟩
  🪶 hint used
  ```

  `*` means hard mode and `X/6` means a loss. Inside Discord, Share opens Discord's share dialog; in a browser it
  copies the text.
- **Settings.** Hard mode, a colour-blind palette (🟧/🟦), and a theme: Dusk (dark), Daylight (light) or System. You
  can type on your physical keyboard or use the on-screen one.

## Quick start (browser, no Discord needed)

You need **Node.js 22.12 or newer** (developed on 22.14) and **npm 11**.

```sh
npm install
npm run dev
```

This starts the API server on <http://localhost:3001> and the Vite dev server on <http://localhost:5173>. Vite
proxies `/api` to the API server. You don't need a `.env` file: outside Discord the client uses Discord's SDK mock,
and the dev server accepts **mock sign-ins**.

Open **<http://localhost:5173/?user=alice>**. The `?user=` name is who you play as.

**To see the Flock**, open a second tab at **<http://localhost:5173/?user=bob>**. All local tabs share one pretend
Activity instance, so each player sees the other's coloured rows update within about five seconds. Without `?user=`,
you get a random guest id that is remembered in `localStorage`.

Games and stats are saved to `server/data/birdle-db.json` (git-ignored). Delete that file to start fresh.

## Running it inside Discord

In development, Discord loads the Vite dev server through a public HTTPS tunnel. The steps below take about ten
minutes the first time.

### 1. Turn on Developer Mode in Discord

- Desktop or web: **User Settings → Advanced → Developer Mode**.
- Mobile: **User Settings → Appearance → Developer Mode**.

### 2. Create the application

1. Go to <https://discord.com/developers/applications> and click **New Application**. Name it (for example
   "BIRDLE") and create it.
   - If friends should be able to test it, create it under a **Team** (or transfer it to one later). Until the app
     is distributed, only the owner and the team's members can launch the Activity.
2. **Installation → Installation Contexts**: tick **User Install** and **Guild Install**.
3. **OAuth2**:
   - Under **Redirects**, add the placeholder `https://127.0.0.1` and save. The Activity sign-in flow doesn't use
     it, but the portal expects one.
   - Copy the **Client ID**. Reset and copy the **Client Secret**.
4. Create your `.env` in the repo root from the example and fill in both values:

   ```sh
   cp .env.example .env
   ```

   ```ini
   DISCORD_CLIENT_ID=123456789012345678   # your Client ID
   DISCORD_CLIENT_SECRET=...              # your Client Secret; never commit it
   ```

   Only the server reads them. When BIRDLE starts inside Discord, the client asks the server for the Client ID
   (`GET /api/config`) before it talks to Discord. Setups that used `VITE_DISCORD_CLIENT_ID` keep working (see
   [Configuration](#configuration)).

### 3. Start the dev servers and a tunnel

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/),
then use two terminals:

```sh
# terminal 1
npm run dev

# terminal 2: a free "quick tunnel" to the Vite dev server
cloudflared tunnel --url http://localhost:5173
```

cloudflared prints a URL like `https://random-words-here.trycloudflare.com`. Vite already accepts
`*.trycloudflare.com` hosts.

For hot reload through the tunnel, add this to `.env` and restart `npm run dev`:

```ini
VITE_HMR_CLIENT_PORT=443
```

### 4. Point the Activity at the tunnel

In the Developer Portal, open **Activities**:

1. **URL Mappings**: map the prefix `/` to your tunnel host, **without** `https://`, for example
   `random-words-here.trycloudflare.com`. Save.
   - Only the root mapping is needed. The client calls `/api/...` on its own origin, and Vite forwards those calls
     to the API server.
2. **Settings**:
   - Tick **Enable Activities**. This also creates the default "Launch" entry-point command.
   - Under **Supported Platforms**, **Web** is on by default. Tick **iOS** and **Android** too if you want to play on
     phones; the Activity won't appear on unticked platforms.
   - Optionally set the default orientation lock to **portrait**. BIRDLE also asks Discord's mobile app for portrait
     itself.

A quick tunnel gets a new hostname every time you start it, so update the URL mapping each time. When you're done,
reset or remove the mapping, because free tunnel hostnames can later be claimed by someone else.

### 5. Launch it

- **Desktop or web:** join a voice channel in a server you're in (or open any text channel), click the **App
  Launcher** (the rocket icon, or the Activities button in the call), and pick BIRDLE. If you don't see it, search
  for your app's name.
- **Mobile:** join a voice channel, open Activities, and pick BIRDLE.

The first launch shows Discord's authorization prompt. BIRDLE asks for `identify` (your name and avatar) and
`rpc.activities.write` (the "Playing BIRDLE #12 · Guess 3 of 6" status). Anyone else in the channel who opens the
Activity joins the same instance, and you'll see each other in the Flock.

**Who can see it?** While the app isn't distributed, only its owner and members of its developer team can launch it.
To let friends test, add them to the Team that owns the app.

**Security note:** while the tunnel is running, your dev server is reachable by anyone who knows the URL, and dev mode
accepts mock sign-ins. If that matters to you, add `BIRDLE_ALLOW_MOCK_AUTH=false` to `.env` while tunnelling. The
game inside Discord signs in with real Discord tokens and keeps working. The Vite dev server only serves files from
`client/`, `shared/src/` and `node_modules/` (`server.fs.allow` in `client/vite.config.ts`), so the answer list in
`shared/data`, the server source and the database are not reachable through the tunnel. Keep it that way if you edit
the Vite config.

## Production deployment

BIRDLE runs as **one Node process** that serves the built client and the `/api` routes on one port. That's why a
single Discord URL mapping (`/` → your host) is enough.

Self-hosting on TrueNAS SCALE: see [docs/TRUENAS.md](docs/TRUENAS.md). It runs the published Docker image
(`ghcr.io/maebh-hughes/birdle`) as a TrueNAS app, step by step. The steps below are for running BIRDLE from a
checkout of this repo.

1. On the server, put a `.env` in the repo root (or set real environment variables) with at least
   `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `PUZZLE_SEED`, `PORT` and a persistent `DATA_FILE` (see below).
2. Install and build:

   ```sh
   npm ci
   npm run build     # vite build -> client/dist, then the bundle safety check
   ```

   The build doesn't depend on your Discord application. The client reads the Client ID from the server when it
   starts (`GET /api/config`), so one build, or one Docker image, works for any Discord app, and changing
   `DISCORD_CLIENT_ID` only needs a restart. (If `VITE_DISCORD_CLIENT_ID` is set when you build, that ID is compiled
   into the client and used instead; then you must rebuild when it changes.)
3. Start the server:

   ```sh
   npm start
   ```

   `npm start` sets `NODE_ENV=production` for you, so you don't need to set it yourself. In production, the server:
   - serves `client/dist` with an SPA fallback;
   - refuses to start without the Discord credentials (`DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`);
   - rejects `mock:` tokens (unless you explicitly set `BIRDLE_ALLOW_MOCK_AUTH=true`, which you shouldn't);
   - warns at startup, but still starts, if `PUZZLE_SEED` is unset, blank or the public default.

   In any mode, the server also refuses to start while `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` or
   `PUZZLE_SEED` still contains the `CHANGE_ME` placeholder from the deploy templates.
4. Put it behind **HTTPS**, since Discord's proxy only talks to HTTPS targets. Use your platform's TLS or a reverse
   proxy such as Caddy or nginx in front of `PORT`.
5. In the Developer Portal, change **Activities → URL Mappings** so that `/` points at your production host (for
   example `birdle.example.com`, with no protocol).

Things to know for production:

- **Data lives in one JSON file** (`DATA_FILE`): profiles, stats, games, and the answer of each daily puzzle already
  served (see [pinned answers](#adding-and-editing-birds)). Put it on a **persistent disk or volume**, for example
  `DATA_FILE=/var/lib/birdle/birdle-db.json`, and back it up. Writes are atomic (a temp file flushed to disk, then a
  rename) and batched every 250 ms.
- **Run exactly one instance.** The JSON store isn't shared between processes.
- **Stop it with SIGINT or SIGTERM** (SIGHUP and, on Windows, Ctrl+Break or closing the console window work too). The
  server stops taking new connections, lets requests in progress finish (up to 5 s), saves pending changes, then
  exits. Any process manager works (systemd, pm2, Docker, a PaaS).
- **Choose a private, random `PUZZLE_SEED`** before the first puzzle is played, and keep it. The daily answers are
  worked out from the seed and the word list, so with the public default (`birdle`) anyone who has the word list can
  compute every answer in advance. Changing the seed later reshuffles the daily answers that haven't been served yet;
  puzzles already served keep their pinned answer.
- The server prunes old data every hour: Flock memberships idle for more than 24 h, and daily games and pinned daily
  answers more than 3 puzzles old (only puzzles within a day of today can be played or shown). Stats are kept
  forever.
- **Discord calls are rationed.** Discord bans an IP from its API for a while after 10,000 rejected requests in 10
  minutes, and anyone can make the server ask Discord about a made-up token or sign-in code. So rejected tokens are
  remembered for a minute, and when too many unknown tokens or sign-ins arrive at once the server answers `429` for a
  moment instead of asking Discord.

## Configuration

The server loads `.env` from the repo root, and variables already set in the environment take priority. Vite reads
the same file (only `VITE_*` variables reach the browser bundle). Blank values count as unset. Every setting is
documented in [`.env.example`](.env.example).

| Variable | Used by | Default | Description |
|---|---|---|---|
| `DISCORD_CLIENT_ID` | server | — | The Discord application (client) ID, numeric. Needed inside Discord and in production. Read at runtime: the client gets it from the server's public `GET /api/config` when it starts inside Discord, so no rebuild is needed when it changes. |
| `VITE_DISCORD_CLIENT_ID` | server, client build | — | Optional older alias of `DISCORD_CLIENT_ID`. The server uses it when `DISCORD_CLIENT_ID` is unset (both set with different values is a startup error). If it is set when the client is built, Vite compiles it in and the client uses it instead of asking `/api/config`. |
| `DISCORD_CLIENT_SECRET` | server | — | The OAuth2 client secret, used for the `/api/token` code exchange. Server-only; never commit it. Required in production. |
| `PORT` | server, Vite proxy | `3001` | The API server port (in production, the only port). Vite proxies `/api` to it in development. |
| `DATA_FILE` | server | `./server/data/birdle-db.json` | The JSON database. Relative paths resolve against the repo root. Use a persistent location in production. |
| `PUZZLE_SEED` | server | `birdle` | Seed for the daily answer order (up to 200 characters). In production use a private random value, set once and kept: anyone who knows the seed can compute the answers. |
| `BIRDLE_ALLOW_MOCK_AUTH` | server | on in dev, off in production | Accept `mock:<id>:<name>` tokens for browser play. Accepts `true`/`false`, `1`/`0`, `yes`/`no` or `on`/`off`. Enabling it in production logs a loud warning. |
| `NODE_ENV` | server | `development` | `production` serves `client/dist`, requires the Discord credentials and turns mock sign-in off. `npm start` sets it for you. |
| `VITE_HMR_CLIENT_PORT` | Vite dev server | — | Set it to `443` when Discord loads the dev server through an HTTPS tunnel, so hot reload works. |
| `VITE_ALLOWED_HOSTS` | Vite dev server | — | Extra hostnames the dev server accepts, comma-separated. `*.trycloudflare.com` is always allowed. Use this for ngrok or your own domain. |

## Adding and editing birds

All answers live in **[`shared/data/birds.json`](shared/data/birds.json)**, an array of entries like these:

```json
[
  {
    "word": "WREN",
    "name": "Wren",
    "kind": "bird",
    "hint": "Tiny brown songbird that often cocks its short tail upright; very loud for its size",
    "fact": "Despite being tiny, the Eurasian wren has a remarkably loud song. A wren was pictured on the British farthing coin from 1937 until the coin was withdrawn.",
    "wiki": "Wren",
    "obscurity": 1
  },
  {
    "word": "FARFETCHD",
    "name": "Farfetch'd",
    "kind": "pokemon",
    "source": "Pokémon Red & Blue",
    "hint": "Wild duck Pokémon that is never seen without the leek stalk it carries",
    "fact": "Its Galarian form can evolve into Sirfetch'd, which wields its leek like a lance.",
    "link": "https://bulbapedia.bulbagarden.net/wiki/Farfetch%27d_(Pok%C3%A9mon)",
    "obscurity": 1
  }
]
```

| Field | Rules |
|---|---|
| `word` | 4–11 uppercase letters A–Z: the letters-only form of the name, with no spaces, hyphens or apostrophes (`HUMMINGBIRD`, `FARFETCHD` for "Farfetch'd", `HOOH` for "Ho-Oh"). Must be unique. |
| `name` | The display name on the bird card. It may contain spaces, punctuation and accents (`"Kākāpō"`, `"Great tit"`, `"Farfetch'd"`). |
| `kind` | `"bird"` (a real bird), `"term"` (bird vocabulary: TALON, PREEN, NESTLING), `"pokemon"`, `"game"` (a video game bird) or `"literature"` (a bird from a book). The card labels them Bird, Bird word, Pokémon, Video game bird and Literary bird. A lost game says "The word was…" for a term and "The bird was…" otherwise. |
| `source` | Where a fictional bird comes from, shown on the card as "from …" (for example `"Pokémon Red & Blue"`, `"The Legend of Zelda"`, `"Harry Potter"`). **Required** for `pokemon`, `game` and `literature`, at most 60 characters. Leave it out for `bird` and `term`. |
| `hint` | One line, shown after 3 guesses if the player asks for it. At most 110 characters, and it must not contain the word or the name (ignoring case, accents and punctuation, so "Farfetchd" and "farfetch'd" both count). |
| `fact` | The fun fact on the bird card, at most 220 characters. |
| `wiki` | The English Wikipedia article title, as it appears in the URL, optionally with a `#Section` (for example `Talon_(anatomy)`). The card's button, *Learn more on Wikipedia*, opens `https://en.wikipedia.org/wiki/<wiki>`. |
| `link` | A full `https://` URL for a page that isn't on Wikipedia, such as a Bulbapedia or fan-wiki page. The button names the site: *Learn more on Bulbapedia*, *Fandom* (any `*.fandom.com` wiki), *Zelda Wiki*, or otherwise the host name. Each entry has **exactly one** of `wiki` and `link`. |
| `obscurity` | `1` = well known, `2` = fairly known, `3` = rare. **Daily** answers are real birds and bird words (`bird`, `term`) with `1` or `2`, plus Pokémon, video game and literary birds with `1` only. Everything appears in Free Flight. |

**Free Flight categories** draw from these kinds: *All* (every entry), *Real birds* (`bird` and `term`), *Pokémon*
(`pokemon`) and *Games & books* (`game` and `literature`).

Don't add images: BIRDLE shows no official artwork, only names and short original text.

After editing, validate the data. The check covers word format and length, duplicates, required fields (including
`source` and exactly one of `wiki`/`link`), hint, fact and source length, and hints that give away the word or name.
Its summary counts the entries by kind, length and obscurity, and shows the daily pool and each Free Flight
category:

```sh
npm run check:words
# or check a candidate file before swapping it in:
npm run check:words -- ./new-birds.json
```

Then restart the server, which loads the data once at startup.

Good to know:

- Every bird word is automatically a valid guess, even if it isn't in the dictionary (`shared/data/guesses.txt`), so
  you don't need to edit the dictionary.
- **Daily answers are pinned once served.** The first time a daily puzzle is served, the server saves its answer in
  the data file and uses that word from then on. Adding or removing daily-eligible entries reshuffles the order of
  puzzles nobody has been served yet, but never changes today's answer or an earlier one. If you remove a word that
  was already a daily answer, that puzzle still works; its bird card just shows the word, without a fact, and links to
  a Wikipedia search.
- A Free Flight category with no entries (for example no `pokemon` entries yet) can't start a round: the game says
  so, and the player can pick another category.
- `npm run build` also checks that no hint, fact, "Learn more" link, dictionary or answer list (words or names) ended
  up in the client bundle (`npm run check:bundle`).

## Scripts

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm run dev` | Starts the API server (`tsx watch`, port 3001) and the Vite dev server (port 5173) together. |
| `npm run dev:server` / `npm run dev:client` | Starts just one of the two. |
| `npm run build` | Builds the client into `client/dist`, then runs `check:bundle`. |
| `npm start` | Runs the production server (`NODE_ENV=production`), which serves `client/dist` and `/api` on `PORT`. |
| `npm test` | Runs the Vitest suites in `shared`, `server` and `client`. |
| `npm run typecheck` | Runs `tsc --noEmit` in every workspace. |
| `npm run check:words` | Validates `shared/data/birds.json` and `guesses.txt`, and prints a summary (by kind, length and obscurity, the daily pool and the Free Flight categories). |
| `npm run check:bundle` | Scans `client/dist` for leaked hints, facts, "Learn more" links, the dictionary, the answer list (words or names) or the client secret. |
| `npm run preview -w client` | Serves the built client with `vite preview` (port 4173, `/api` proxied), for a quick look at a build. |

## Project structure

```
BIRDLE/
├─ package.json            npm workspaces + root scripts
├─ .env.example            every setting, documented (copy to .env)
├─ scripts/check-bundle.mjs  fails the build if server-only data leaks into client/dist
├─ docs/ARCHITECTURE.md    architecture, API reference, security model
├─ docs/TRUENAS.md         self-hosting on TrueNAS SCALE with the Docker image
├─ Dockerfile, deploy/, .github/workflows/  the Docker image, TrueNAS app files, image publishing
├─ shared/                 @birdle/shared: rules + types used by both sides (TypeScript source, no build)
│  ├─ data/                birds.json (answers), guesses.txt (ENABLE2K dictionary), SOURCE.md
│  ├─ scripts/check-words.mjs
│  └─ src/
│     ├─ index.ts          client-safe exports: types, evaluate, hard mode, dates, share text, stats…
│     ├─ kinds.ts          bird kinds and labels, the daily pool rule, Free Flight categories
│     └─ server.ts         SERVER-ONLY: loads birds.json + dictionary (answers, hints, facts)
├─ server/                 @birdle/server: Express 5 API, run with tsx
│  ├─ src/
│  │  ├─ index.ts          entry: .env, config, data, JSON store, listen, graceful shutdown
│  │  ├─ app.ts            createApp(deps): middleware, routes, static client in production
│  │  ├─ config.ts         env parsing + validation
│  │  ├─ auth.ts           bearer tokens: Discord (/oauth2/@me, cached) or mock
│  │  ├─ discord.ts        OAuth2 code exchange + user lookup
│  │  ├─ discordGuard.ts   budget of Discord calls (avoids Discord's invalid-request IP ban)
│  │  ├─ shutdown.ts       graceful shutdown: finish requests, then save
│  │  ├─ game.ts           daily/practice games, hints, stats (per-user lock)
│  │  ├─ flock.ts          Activity-instance membership + colours-only progress
│  │  ├─ store.ts          Store interface, MemoryStore, JsonFileStore (games, stats, pinned daily answers)
│  │  ├─ static.ts         client/dist serving with SPA fallback + cache headers
│  │  └─ routes/           token, me, daily, practice, instances (GET /api/config is in app.ts)
│  └─ test/
└─ client/                 @birdle/client: Vite + React 19
   ├─ vite.config.ts       envDir '..', /api proxy, allowedHosts, HMR port
   └─ src/
      ├─ main.tsx, App.tsx, session.ts, GameScreen.tsx
      ├─ startup.ts        the error screen text when BIRDLE can't set up Discord
      ├─ api.ts            typed fetch wrapper (Bearer token, ApiError)
      ├─ discord/          SDK bootstrap (real vs mock), auth, participants, presence, share, links, mobile
      ├─ game/             reducer (typing, reveal, toasts) + useGame hook
      ├─ hooks/            useFlock, keyboard, media queries, countdown
      ├─ components/       Board, Keyboard, modals, BirdCard, CategoryPicker, FlockPanel, …
      └─ styles.css
```

## Troubleshooting

**`blocked:csp` in the console inside Discord.** Activities can only talk to their own origin (through the URL
mapping) and a short allow-list of Discord hosts. BIRDLE only calls relative `/api/...` URLs and loads avatars from
`cdn.discordapp.com/avatars/`, so this usually means one of these:
- The `/` URL mapping is missing or points at an old tunnel host. Check **Activities → URL Mappings** against the
  URL cloudflared printed this time.
- New code loads something from another domain, such as a web font, a CDN script or an absolute `https://` URL.
  Bundle the asset instead, or add a URL mapping for that host and call it through the mapped prefix.

For the full devtools console, run Discord in a web browser (discord.com/app).

**"Blocked request. This host (…) is not allowed."** Vite rejected the tunnel's hostname. `*.trycloudflare.com` is
allowed out of the box. For other tunnels (ngrok and so on) or a custom domain, add the host to `VITE_ALLOWED_HOSTS`
in `.env` and restart `npm run dev`.

**The Activity loads but hot reload doesn't, or the console shows WebSocket errors.** Set
`VITE_HMR_CLIENT_PORT=443` in `.env` and restart the dev servers.

**401 / "Sign-in failed" / "Session expired".**
- *In a browser:* the server isn't accepting mock tokens. That happens in production (`npm start`) or when
  `BIRDLE_ALLOW_MOCK_AUTH=false`. Use `npm run dev` for browser play.
- *Inside Discord:* the Discord access token was rejected or has expired. Press **Retry** to sign in again. If it
  keeps failing, check that `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` belong to the **same** application as
  the Activity you launched, and restart the dev servers after editing `.env`.
- *"Server trouble … Discord sign-in is not configured":* `DISCORD_CLIENT_SECRET` or `DISCORD_CLIENT_ID` is missing
  on the server.
- *"Couldn't complete Discord sign-in":* Discord rejected the code exchange, usually because the client secret is
  wrong or was reset. Copy it again from the portal.

**"rpc.activities.write" is not granted / authorization fails.** BIRDLE requests `rpc.activities.write` only for the
"Playing BIRDLE" rich-presence status. If Discord refuses that scope, BIRDLE automatically retries with just
`identify`. The game works normally, but your status won't show puzzle progress, and the console shows a warning.
Nothing needs fixing.

**"BIRDLE isn't set up for Discord yet".** The page was opened by Discord, but the server has no Discord application
ID (and none was compiled into the client). Set `DISCORD_CLIENT_ID` in `.env` or the container's environment,
restart the server (`npm run dev`, `npm start` or the app), then relaunch the Activity.

**"BIRDLE couldn't start" with "HTTP 404" (or another HTTP error).** Inside Discord the client first reads
`/api/config` from the BIRDLE server. Check that the `/` URL mapping points at the BIRDLE server (in development: the
tunnel and `npm run dev` are both running), and that the client and server come from the same version.

**Stuck on the loading screen, then "Discord did not respond".** The Discord handshake didn't finish within 20
seconds. Close and relaunch the Activity. Also check that the tunnel is still running and that the URL mapping
matches it.

**Free Flight says "There are no … in Free Flight yet".** The word list has no entries for that category yet (for
example no `pokemon` entries). Pick another category, or add some birds (see
[Adding and editing birds](#adding-and-editing-birds)).

**The server refuses to start in production.** It prints every configuration problem (for example missing Discord
credentials or an invalid `PORT`) and exits. Fix the listed variables.

**"Port 3001 is already in use".** Another copy is still running. Stop it, or set a different `PORT` in `.env`; the
Vite proxy follows it.

## Credits

- **Valid-guess dictionary:** words from the ENABLE2K word list (Enhanced North American Benchmark LExicon) by Alan
  Beale and Mendel Cooper, released into the Public Domain. Source and details are in
  [shared/data/SOURCE.md](shared/data/SOURCE.md).
- **Bird facts and hints:** short summaries written for BIRDLE, based on the page each bird card links to: the
  English Wikipedia article (`https://en.wikipedia.org/wiki/<article>`), or for some Pokémon, video game and literary
  birds a fan wiki page such as Bulbapedia. Wikipedia text is available under the
  [Creative Commons Attribution-ShareAlike 4.0 License](https://creativecommons.org/licenses/by-sa/4.0/). Follow a
  card's *Learn more* link for the full page, its authors and its license.
- **Characters:** Pokémon and other character names are trademarks of their respective owners. BIRDLE is an
  unofficial fan project and is not affiliated with or endorsed by them. BIRDLE uses no official artwork or images.
- Built with the [Discord Embedded App SDK](https://github.com/discord/embedded-app-sdk), React, Vite and Express.
