# syntax=docker/dockerfile:1

# BIRDLE container image: ONE Node.js process that serves the built client and the /api routes on
# port 3001 and keeps its JSON database in /data.
#
#   docker build -t birdle .
#   docker run -d --name birdle -p 3001:3001 -v birdle-data:/data \
#     -e DISCORD_CLIENT_ID=... -e DISCORD_CLIENT_SECRET=... -e PUZZLE_SEED=... birdle
#
# The Discord client ID is read at runtime (GET /api/config), so one image works for any Discord app.
# It runs as any non-root UID:GID (e.g. --user 568:568, the TrueNAS "apps" user) and writes only to
# /data, so it also runs with a read-only root filesystem (--read-only). No secrets are baked in: the
# build context never includes .env files (see .dockerignore), and every setting comes from the
# environment at run time. Step-by-step TrueNAS SCALE + Discord guide: docs/TRUENAS.md

# Node.js 22 on Debian 13 "trixie" slim. Node 22 matches package.json "engines" and the CI. Debian 13
# is the current Debian stable with full security support (Debian 12 "bookworm" moved to LTS-only
# support in June 2026). glibc rather than Alpine's musl: glibc Linux is a Tier 1 Node.js platform
# while musl is "experimental", and the native binaries this project runs (esbuild, used by tsx at
# runtime) and builds with (rolldown and lightningcss, used by Vite) are most widely tested on glibc.
# The tag is pinned to the Node major and the Debian release, so every rebuild picks up their security
# patches. For byte-for-byte reproducible builds pin a digest (node:22-trixie-slim@sha256:...), and
# then bump it yourself. Node 22 reaches end of life in April 2027: move to the next LTS before then.
ARG NODE_IMAGE=node:22-trixie-slim

# ---- 1. build: install everything, build the client (vite build + the bundle leak check) ----------
# client/dist is plain static files, so this stage runs on the build machine's own platform, even
# when cross-building for another architecture.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
ENV npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci
COPY . .
RUN npm run build

# ---- 2. deps: production dependencies of the server workspace only -----------------------------
# express, dotenv, tsx (which runs the TypeScript source) and the @birdle/shared workspace link, with
# the target platform's esbuild binary. No dev tools, no client libraries.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev --workspace=server

# ---- 3. app: exactly the files the server needs at runtime ---------------------------------------
FROM deps AS app
COPY shared/src shared/src
COPY shared/data shared/data
COPY server/src server/src
COPY --from=build /app/client/dist client/dist
# Readable (and directories enterable) by any UID, writable by nobody but root.
RUN chmod -R a+rX,go-w /app

# ---- 4. runtime -------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

LABEL org.opencontainers.image.title="BIRDLE" \
      org.opencontainers.image.description="A Wordle-style bird word game that runs as a Discord Activity" \
      org.opencontainers.image.source="https://github.com/Maebh-Hughes/birdle" \
      org.opencontainers.image.url="https://github.com/Maebh-Hughes/birdle" \
      org.opencontainers.image.documentation="https://github.com/Maebh-Hughes/birdle/blob/main/docs/TRUENAS.md"

# TSX_DISABLE_CACHE: tsx would otherwise cache compiled files under /tmp; with it the server writes
# nothing outside /data.
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_FILE=/data/birdle-db.json \
    TSX_DISABLE_CACHE=1

WORKDIR /app
COPY --from=app /app ./

# /data is the only writable place. Mode 0777 lets whatever UID the container runs as write there
# when nothing is mounted (or into a new named volume, which starts as a copy of it). A bind mount,
# such as a TrueNAS host path, keeps the host's permissions instead: see docs/TRUENAS.md.
RUN mkdir /data && chmod 0777 /data
VOLUME /data

EXPOSE 3001

# The image's built-in "node" user. Override freely (docker run --user / compose user: "568:568").
USER 1000:1000

# Node runs as PID 1 with tsx loaded in-process (no npm or tsx CLI wrapper in between), so SIGTERM from
# `docker stop` reaches the server's own handler: it stops accepting connections, lets requests in
# progress finish (up to 5 s), saves /data and exits 0 (hard limit 10 s). No init process is needed:
# the only child process is esbuild's compiler service (started by tsx), which Node itself waits for,
# and which ends with Node when the container stops.
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health', { signal: AbortSignal.timeout(4000) }).then((res) => process.exit(res.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "--import", "tsx", "server/src/index.ts"]
