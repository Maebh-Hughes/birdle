# Self-hosting BIRDLE on TrueNAS SCALE

This guide takes you from "the code is on GitHub" to "my friends are playing BIRDLE in Discord", with
BIRDLE running as a custom app on your own TrueNAS SCALE server. You don't need to know Docker. Set
aside about an hour the first time.

How the pieces fit together:

```text
Players in Discord
   |  Discord loads the Activity through its own proxy, which needs a public HTTPS address
   v
https://birdle.example.com            <- your hostname, served by Cloudflare
   |  Cloudflare Tunnel: an outgoing connection from your server, so no router ports are opened
   v
TrueNAS app "birdle"
   |- cloudflared container  ---->  birdle container (port 3001: the game and its /api)
   |                                     |
   |                                     v
   '------------------------------  /mnt/POOL/apps/birdle   (dataset holding birdle-db.json)
```

GitHub builds the BIRDLE image for you every time you push, and TrueNAS downloads it from the GitHub
Container Registry as `ghcr.io/maebh-hughes/birdle`.

Already running **Nginx Proxy Manager** (or another reverse proxy) with ports 80 and 443 forwarded? Then you
don't need Cloudflare at all: the proxy provides the HTTPS address ([option C](#option-c-you-already-run-a-reverse-proxy)),
and you can install BIRDLE with TrueNAS's ordinary **Custom App** form instead of YAML
([Install with the Custom App form](#install-with-the-custom-app-form-no-yaml)).

**Contents**

- [Before you start](#before-you-start)
- Step 1: [Get the image built on GitHub](#1-get-the-image-built-on-github)
- Step 2: [Let TrueNAS download the image](#2-let-truenas-download-the-image)
- Step 3: [Create the Discord application](#3-create-the-discord-application)
- Step 4: [Create a dataset for BIRDLE's data](#4-create-a-dataset-for-birdles-data)
- Step 5: [Get a public HTTPS address](#5-get-a-public-https-address)
- Step 6: [Install the app on TrueNAS](#6-install-the-app-on-truenas) (with YAML, or with the
  [Custom App form](#install-with-the-custom-app-form-no-yaml))
- Step 7: [Point Discord at your server](#7-point-discord-at-your-server)
- Step 8: [Launch it](#8-launch-it)
- [Updating BIRDLE](#updating-birdle)
- [Backups](#backups)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [Other ways to run the image](#other-ways-to-run-the-image)

## Before you start

You need:

- **TrueNAS SCALE 24.10 ("Electric Eel") or later.** That's the version where apps became plain Docker
  containers, and "Install via YAML" appeared. This guide follows **25.10 ("Goldeye")**, the current
  release for general use as of September 2026. From 25.04 onward TrueNAS calls SCALE "TrueNAS Community
  Edition"; the menus are the same. On 24.04 or older, upgrade first.
- **Apps switched on.** Open **Apps** once. If TrueNAS asks you to choose a pool for apps, pick one and
  click **Save** (you can also do it later from **Apps → Configuration → Choose Pool**).
- **The BIRDLE code on GitHub** at <https://github.com/Maebh-Hughes/birdle>, including the file
  `.github/workflows/docker-publish.yml`.
- **A Discord account** with Developer Mode on: **User Settings → Advanced → Developer Mode** on desktop or
  web, or **User Settings → Appearance → Developer Mode** on mobile.
- **A public HTTPS address**, one of:
  - a reverse proxy you already run, such as Nginx Proxy Manager, with ports 80 and 443 forwarded to it and
    a hostname whose DNS points at your home IP ([option C](#option-c-you-already-run-a-reverse-proxy)); or
  - a free Cloudflare account and a domain name that uses Cloudflare for its DNS
    ([option A](#option-a-recommended-cloudflare-tunnel-with-your-own-domain)). Buying one through
    Cloudflare's own registrar is the easiest, because it's set up automatically. No domain? See
    [option B](#option-b-no-domain-a-quick-tunnel-testing-only) for a test-only alternative.

TrueNAS SCALE runs on x86-64 hardware, and that's the only kind of image the GitHub workflow builds.

Throughout this guide, replace:

| Placeholder | With |
|---|---|
| `POOL` | The name of your storage pool (the top line in **Datasets**), for example `tank` |
| `birdle.example.com` | The public hostname you choose in step 5 |
| `TRUENAS-IP` | Your TrueNAS server's address on your home network, for example `192.168.1.20` |

## 1. Get the image built on GitHub

1. Push the code to the `main` branch of <https://github.com/Maebh-Hughes/birdle>.
2. On GitHub, open the repository's **Actions** tab. A run of the **Docker image** workflow starts by
   itself. It has two jobs:
   - **Typecheck, test and build** runs the project's checks and tests.
   - **Build and push the image** builds the Docker image and publishes it.

   The first run takes about five minutes. Wait until it shows a green tick. If there's a red cross, click
   it to see which step failed.
   - If the Actions tab says workflows are disabled, enable them under **Settings → Actions → General**.
   - GitHub Actions is free for public repositories. (A private repository would use your account's free
     monthly minutes instead, which is still plenty.)
3. The image now appears on your GitHub profile under **Packages** as **birdle**, and in the repository's
   sidebar. Its full name is `ghcr.io/maebh-hughes/birdle`. It's all lowercase, because image names must be.
   It starts out **private**, even though the repository is public: step 2 deals with that.

You don't need to add any secrets to the repository. The workflow publishes with GitHub's built-in token,
and your Discord and Cloudflare settings only ever go into TrueNAS. A pull request to `main` runs the tests
but publishes nothing.

You get these image tags:

| Tag | Meaning |
|---|---|
| `latest` | The newest build of `main`. The TrueNAS files use this. |
| `sha-1a2b3c4` | One exact commit. Useful for rolling back. |
| `1.2.3`, `1.2`, `1` | Releases. Push a Git tag such as `v1.2.3` to create them (see [Updating BIRDLE](#updating-birdle)). |

You can also start a build by hand: **Actions → Docker image → Run workflow**.

## 2. Let TrueNAS download the image

GitHub publishes a new image as **private**, even when the repository is public, so right now only you can
download it. TrueNAS needs to be able to download it as well. There are two ways to allow that.

### Recommended for a public repository: make the image public

This takes one minute, and TrueNAS then needs no key at all. Because the repository is already public, the
image reveals nothing new: it contains the same source code and answer list that anyone can read on GitHub.
What stays secret is the *order* of the daily answers, which depends on your `PUZZLE_SEED`, and your
Discord and Cloudflare secrets. None of those are ever in the image.

1. On GitHub, click your profile picture → **Your profile** → the **Packages** tab → **birdle**. (It's also
   linked from the repository's sidebar, under **Packages**.)
2. Click **Package settings** (right side), scroll to the **Danger Zone**, click **Change visibility**, choose
   **Public**, type `birdle` to confirm, and click **I understand the consequences, change package
   visibility**.

GitHub doesn't let you make a public package private again; you would have to delete it. That's no problem
while the repository itself is public.

### Alternative: keep the image private and give TrueNAS a read-only key

This takes about five minutes.

1. **Make a token on GitHub.** Click your profile picture (top right) → **Settings** → **Developer settings**
   (at the bottom of the left menu) → **Personal access tokens** → **Tokens (classic)** → **Generate new
   token** → **Generate new token (classic)**. GitHub's container registry only accepts classic tokens.
   - **Note:** `TrueNAS BIRDLE`, so you remember what it's for.
   - **Expiration:** your choice. When the token expires, the version TrueNAS already has keeps running, but
     TrueNAS can't download updates until you give it a new token. A token that can only read packages is
     low-risk, so a long expiration (or **No expiration**) is reasonable. If you pick a date, put a reminder
     in your calendar.
   - **Select scopes:** tick **only** `read:packages`. Nothing else.
   - Click **Generate token** at the bottom and copy the token (it starts with `ghp_`). GitHub shows it only
     once. If you lose it, delete it and make a new one.
2. **Give it to TrueNAS.** Go to **Apps**, open the **Configuration** menu at the top right and choose
   **Sign-in to a Docker registry**. On the **Docker Registries** screen, click **Add Registry** and fill in:
   - **URI:** choose **Other Registry**, then enter `https://ghcr.io`
   - **Name:** `GitHub` (any name works; it's only a label)
   - **Username:** your GitHub username, `Maebh-Hughes`
   - **Password:** the token
   - Click **Save**. TrueNAS signs in to check the details, so a typo in the token shows up here.

When the token expires, make a new one the same way, then edit the **GitHub** entry on the **Docker
Registries** screen and paste in the new token.

Use this route if you ever make the repository private again, since a public image would then expose the
source code and the full answer list, including every hint and fact.

## 3. Create the Discord application

1. Go to <https://discord.com/developers/applications>, click **New Application**, name it (for example
   `BIRDLE`) and create it.
   - If friends should help test it, create it under a **Team**, or transfer it to one later. See
     [Who can play?](#who-can-play).
2. **Installation → Installation Contexts:** tick **User Install** and **Guild Install**.
3. **OAuth2:**
   - Under **Redirects**, add `https://127.0.0.1` and save. BIRDLE doesn't use it, but the portal wants one.
   - Copy the **Client ID**, a long number. That's your `DISCORD_CLIENT_ID`. (It's the same number as the
     **Application ID** on the **General Information** page.)
   - Click **Reset Secret** and copy the **Client Secret**. That's your `DISCORD_CLIENT_SECRET`. Discord
     shows it only once, so keep it somewhere safe, such as a password manager.
4. **Activities → Settings:**
   - Tick **Enable Activities**. This also creates the "Launch" command.
   - Under **Supported Platforms**, **Web** is on by default. Tick **iOS** and **Android** too if people
     will play on phones.
   - Optionally set the default orientation to **portrait**.

Leave **Activities → URL Mappings** for step 7, when you have your hostname.

## 4. Create a dataset for BIRDLE's data

BIRDLE keeps everything (games, streaks, stats) in one small file, `birdle-db.json`. Give it a dataset of its
own, so that snapshots and backups are easy.

1. Go to **Datasets**, select your pool, and click **Add Dataset**.
2. **Name:** `apps`. **Dataset Preset:** **Apps**. Click **Save**. Skip this step if you already have an
   `apps` dataset.
3. Select the `apps` dataset and click **Add Dataset** again.
4. **Name:** `birdle`. **Dataset Preset:** **Apps**. Click **Save**.

Its path is `/mnt/POOL/apps/birdle`. The **Apps** preset gives the built-in `apps` group (ID 568) permission
to change files there, and the BIRDLE container runs as that user and group (`568:568`), so it can save its
data and nothing more.

To double-check, select the `birdle` dataset and look at its **Permissions** panel: it should list the
**apps** group with **Modify** access. If it doesn't (for example because the dataset already existed, or
it inherited other permissions from its parent), click **Edit** on that panel, add an entry for **Group**
`apps` with **Modify** permissions, and click **Save Access Control List**.

The dataset stays empty until someone plays: BIRDLE creates `birdle-db.json` the first time it has
something to save.

## 5. Get a public HTTPS address

Discord only loads Activities from a public HTTPS address, and a home server usually sits behind a router
that the internet can't reach. Pick one of these options.

### Option A (recommended): Cloudflare Tunnel with your own domain

A tunnel is a small program, `cloudflared`, that runs next to BIRDLE on your TrueNAS. It connects *out* to
Cloudflare, and Cloudflare serves your hostname with a valid HTTPS certificate. You don't open any ports on
your router, and your home IP address stays hidden.

1. **Put your domain on Cloudflare**, if it isn't already. In the [Cloudflare dashboard](https://dash.cloudflare.com)
   click **Add a domain** and follow the steps. That usually means changing your domain's nameservers where you
   bought it. Wait until the domain shows as **Active**.
2. **Create the tunnel.** Go to **Networking → Tunnels → Create a tunnel**. If it asks for a connector type,
   choose **Cloudflared**. Name it, for example `truenas-birdle`, and create it.
   - Cloudflare moves these menus now and then. In the Zero Trust dashboard (<https://one.dash.cloudflare.com>)
     the same page is under **Networks** (**Tunnels**, or **Connectors → Cloudflare Tunnels**).
3. **Copy the token.** Cloudflare now shows install commands. Choose **Docker**. The command looks like
   `docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJhIjoi...`. Copy only the
   long text after `--token`. That's your `TUNNEL_TOKEN`. **Don't run the command**; TrueNAS runs cloudflared
   for you in step 6.
4. **Publish your hostname.** Continue to the tunnel's routes, or open the tunnel later and go to its
   **Routes** tab. Choose **Add route → Published application**:
   - **Subdomain:** `birdle`
   - **Domain:** your domain
   - **Path:** leave empty
   - **Service URL:** `http://birdle:3001`. That's plain `http` (Cloudflare adds the HTTPS), and `birdle`
     is the name of BIRDLE's container inside the app, not `localhost`.

   Save. Cloudflare creates the DNS record for `birdle.example.com` by itself. In older dashboards this
   screen is called **Public Hostname**, with **Service Type** `HTTP` and **URL** `birdle:3001`.

The tunnel shows as down until you install the app in step 6. After that it turns **Healthy**.

Use **`deploy/truenas/birdle-cloudflared.yaml`** in step 6.

### Option B (no domain): a quick tunnel, testing only

Cloudflare's free "quick tunnels" need no account and no domain. They give you a random address like
`https://some-random-words.trycloudflare.com`. However:

- The address **changes every time the app restarts**, including TrueNAS reboots and BIRDLE updates, and
  you have to update Discord's URL mapping each time.
- There's no uptime guarantee. It's fine for trying BIRDLE out, but not for a server your friends rely on.

To use one, take `deploy/truenas/birdle-cloudflared.yaml` and change the `cloudflared` part as its comments
describe: set `command: tunnel --no-autoupdate --url http://birdle:3001` and delete the `environment` block
with `TUNNEL_TOKEN`. After installing, find the address in the **cloudflared** container's logs (see
[Troubleshooting](#where-are-the-logs)). Look for a box saying your quick tunnel has been created.

### Option C: you already run a reverse proxy

If you already publish services with a reverse proxy (Nginx Proxy Manager, Caddy, Traefik and so on), BIRDLE
only needs to be reachable on your home network, and the proxy gives it its public HTTPS address. Install
BIRDLE with **`deploy/truenas/birdle.yaml`** or with the
[Custom App form](#install-with-the-custom-app-form-no-yaml); either way it serves
`http://TRUENAS-IP:30180`. BIRDLE needs nothing special from the proxy: no WebSockets and no extra headers.
Don't put a login page in front of it, because Discord can't get past one.

**With Nginx Proxy Manager** (do this after step 6, once BIRDLE answers on `http://TRUENAS-IP:30180/api/health`):

1. **DNS:** where your domain's DNS is managed (your registrar, for example Hostinger), add an **A record**
   for the subdomain, such as `birdle`, pointing to your home's public IP address. Skip this if it already
   exists.
2. **Router:** port **80** and port **443** from the internet must both be forwarded to Nginx Proxy
   Manager's HTTP and HTTPS ports. On TrueNAS, the Nginx Proxy Manager app shows which host ports those are
   under **Apps → Installed → nginx-proxy-manager → Edit → Network Configuration**. Port 80 alone isn't
   enough: Let's Encrypt uses port 80 to issue the certificate, but Discord connects on 443. Don't forward
   port 30180.
3. In Nginx Proxy Manager, go to **Hosts → Proxy Hosts → Add Proxy Host**. On the **Details** tab:
   - **Domain Names:** `birdle.example.com`
   - **Scheme:** `http`
   - **Forward Hostname / IP:** `TRUENAS-IP` (your TrueNAS server's LAN address, not `localhost`)
   - **Forward Port:** `30180`
   - Turn on **Block Common Exploits**. **Websockets Support** can be on or off. Leave **Cache Assets** off.
   - Leave **Access List** as **Publicly Accessible**: Discord can't sign in to an access list.
4. On the **SSL** tab: **SSL Certificate** → **Request a new SSL Certificate**, then turn on **Force SSL**
   and **HTTP/2 Support**. Enter your email address, agree to the Let's Encrypt terms, and click **Save**.
   Nginx Proxy Manager fetches the certificate, which takes a few seconds.
5. Check it from outside your home network (for example on your phone with Wi-Fi off):
   `https://birdle.example.com/api/health` should show `{"ok":true}` with a valid padlock.

## 6. Install the app on TrueNAS

### Make a puzzle seed

`PUZZLE_SEED` is a private random value that decides the order of the daily answers. Anyone who knows it
(and the word list) could work out every future answer. Set it **once** and never change it: changing it
later reshuffles all the upcoming daily puzzles. (A puzzle that has already been handed out keeps its
answer.)

In TrueNAS, open **System → Shell** and run:

```sh
openssl rand -hex 24
```

Copy the 48-character result. On a Windows PC you can use PowerShell instead:
`-join ((1..2) | ForEach-Object { [guid]::NewGuid().ToString('N') })`.

### Fill in the YAML

Using a reverse proxy (step 5, option C) and would rather fill in a form than edit YAML? Skip to
[Install with the Custom App form](#install-with-the-custom-app-form-no-yaml).

1. Open the YAML file for your option from the repository in a text editor. On GitHub, open the file and
   click **Raw** to copy it:
   - Step 5 option A or B: [`deploy/truenas/birdle-cloudflared.yaml`](../deploy/truenas/birdle-cloudflared.yaml)
   - Step 5 option C: [`deploy/truenas/birdle.yaml`](../deploy/truenas/birdle.yaml)
2. Replace every `CHANGE_ME`, keeping the quotes around the values:

   | Setting | Value |
   |---|---|
   | `DISCORD_CLIENT_ID` | The Client ID from step 3 (only digits) |
   | `DISCORD_CLIENT_SECRET` | The Client Secret from step 3 |
   | `PUZZLE_SEED` | The random value you just made |
   | `TUNNEL_TOKEN` | The tunnel token from step 5 (option A only; option B deletes this line) |

3. In the `source:` line under `volumes`, replace `POOL` with your pool's name, so it reads for example
   `source: /mnt/tank/apps/birdle`.
4. Check that no `CHANGE_ME` or `POOL` is left. BIRDLE refuses to start while `DISCORD_CLIENT_ID`,
   `DISCORD_CLIENT_SECRET` or `PUZZLE_SEED` still contains `CHANGE_ME` (see
   [Troubleshooting](#the-app-wont-start-or-keeps-restarting)), but it can't check the `POOL` path or the
   tunnel's `TUNNEL_TOKEN`. Don't leave `PUZZLE_SEED` empty either: without a seed, BIRDLE still starts, but
   it only prints a `[config]` warning and uses the public default seed, and anyone with the word list can
   then work out the daily answers.

Also in the file:

- `user: "568:568"` runs BIRDLE as the TrueNAS `apps` user. Leave it as it is.
- `ports: "30180:3001"` (in `birdle.yaml`, and optional in the other file) makes BIRDLE reachable at
  `http://TRUENAS-IP:30180` on your home network. You can change `30180` if that port is taken.
- The `TZ` line is optional, and BIRDLE doesn't need it: the server works in UTC, and each player gets the
  puzzle for their own local date either way.
- `read_only`, `tmpfs`, `security_opt` and `cap_drop` lock the container down (see
  [Security notes](#security-notes)). Leave them as they are.

### Install it

1. Go to **Apps → Discover Apps**, open the three-dot menu (⋮) at the top right, and choose
   **Install via YAML**.
2. **Application Name:** `birdle`, in lowercase.
3. Paste your edited file into **Custom Config** and click **Save**.
4. TrueNAS downloads the image and starts the app. In **Apps → Installed**, **birdle** goes from
   **Deploying** to **Running** within a minute or two.

### Install with the Custom App form (no YAML)

This is the same app, entered through TrueNAS's ordinary form. It installs a single container, so use it
with a reverse proxy (step 5, option C). For a Cloudflare tunnel you'd either use the YAML above, or install
the **Cloudflared** app from **Discover Apps** separately and give its route the service URL
`http://TRUENAS-IP:30180`.

Go to **Apps → Discover Apps** and click **Custom App** (top right). Fill in the sections below and leave
everything that isn't mentioned at its default. The panel on the right jumps between sections.

| Section | Field | Value |
|---|---|---|
| **Application Name** | Application Name | `birdle` |
| **Image Configuration** | Repository | `ghcr.io/maebh-hughes/birdle` |
| | Tag | `latest` |
| | Pull Policy | **Only pull image if not present on host** (the default; updates come through TrueNAS's update badge, see [Updating BIRDLE](#updating-birdle)) |
| **Container Configuration** | Entrypoint, Command | leave empty (the image knows how to start) |
| | Environment Variables | click **Add** three times and fill in the three rows below |
| | → Name `DISCORD_CLIENT_ID` | Value: the Client ID from step 3 (only digits) |
| | → Name `DISCORD_CLIENT_SECRET` | Value: the Client Secret from step 3 |
| | → Name `PUZZLE_SEED` | Value: the random value from [Make a puzzle seed](#make-a-puzzle-seed) |
| | Restart Policy | **Unless Stopped** |
| | Disable Builtin Healthcheck | leave **unticked** (TrueNAS then shows whether BIRDLE is healthy) |
| **Security Context Configuration** | Privileged | leave **unticked** |
| | Custom User | **tick it**, then User ID `568` and Group ID `568` (the TrueNAS `apps` user) |
| **Network Configuration** | Host Network | leave **unticked** |
| | Ports | click **Add**: Container Port `3001`, Host Port `30180`, Protocol **TCP** |
| **Portal Configuration** | | skip it (opening BIRDLE outside Discord only shows a sign-in error) |
| **Storage Configuration** | Storage | click **Add**, then Type **Host Path** |
| | Mount Path | `/data` |
| | Host Path | `/mnt/POOL/apps/birdle` (the dataset from step 4; you can browse to it) |
| | Read Only, Enable ACL | leave **unticked** (the dataset's **Apps** preset already lets BIRDLE write) |
| **Resources Configuration** | | optional: tick **Enable Resource Limits** and set, for example, 1 CPU and 512 MB. BIRDLE normally uses well under 150 MB. |

Click **Install**. TrueNAS downloads the image and starts the app. In **Apps → Installed**, **birdle** goes
from **Deploying** to **Running** within a minute or two. If it stops again right away, see
[The app won't start](#the-app-wont-start-or-keeps-restarting): a typo in an environment variable name, or a
`CHANGE_ME`-style placeholder, is the usual cause.

A form install doesn't get the YAML's extra lockdown (read-only root filesystem, no capabilities). BIRDLE
still runs as the unprivileged `apps` user and writes only to `/data`, which is the part that matters most.

### Check that it works

1. Open the app's logs (see [Where are the logs?](#where-are-the-logs)). On its first start, the **birdle**
   container prints something like this:

   ```text
   No database at /data/birdle-db.json yet; starting with an empty one.
   BIRDLE server (production) on http://localhost:3001 with 825 answers (348 daily), ...; mock auth off; data in /data/birdle-db.json
   ```

   The first line is normal until someone has played. What matters is `mock auth off` and no lines
   starting with `[config]`: those are warnings, for example about a missing `PUZZLE_SEED`.

   With a tunnel, the **cloudflared** container's logs should include `Registered tunnel connection`.
   Warnings about ICMP or UDP buffer sizes there are harmless.
2. Open `https://birdle.example.com/api/health` in your browser. It should show `{"ok":true}`.
   - With `birdle.yaml`, `http://TRUENAS-IP:30180/api/health` should show the same on your home network.
3. Open `https://birdle.example.com/api/config`. It should show your Client ID:
   `{"discordClientId":"123..."}`. The game reads it from here when it starts inside Discord.
4. Opening `https://birdle.example.com` in an ordinary browser tab shows the BIRDLE page, and then a
   **Sign-in failed** screen. That's expected: sign-in only works inside Discord.

## 7. Point Discord at your server

In the [Developer Portal](https://discord.com/developers/applications), open your application, then
**Activities → URL Mappings**:

- **Prefix:** `/`
- **Target:** `birdle.example.com`, with **no** `https://` and no slash at the end.

Save. BIRDLE serves the game and its `/api` from the same address, so this one mapping is all it needs.

## 8. Launch it

- **Desktop or web:** join a voice channel, or open a text channel, in a server you're in. Click the
  **App Launcher** (the rocket icon, or the Activities button in a call) and pick BIRDLE. If it's not listed,
  search for your app's name.
- **Mobile:** join a voice channel, open **Activities** and pick BIRDLE.

The first time, Discord asks you to authorize the app. Everyone in the channel who opens the Activity joins
the same game room, and you can see each other in the Flock.

### Who can play?

Until your Activity is made public, only you and the members of the app's developer **Team** can launch it.
Discord also lets you invite **App Testers**, and unverified Activities only work in fewer-than-25-member
servers. The limits change from time to time, so check Discord's developer help pages for the current rules.
The [README](../README.md#running-it-inside-discord) has more on running BIRDLE inside Discord.

## Updating BIRDLE

**Publishing a new version:** push your changes to `main`. GitHub builds a new `latest` image (check the
**Actions** tab for the green tick).

**Installing it on TrueNAS:** TrueNAS checks for newer images now and then (the **Check for docker image
updates** option under **Apps → Configuration → Settings**, which is on by default). When it notices one,
**birdle** gets an update badge, a yellow circle with an exclamation mark, in **Apps → Installed**. Select
the app, open the three-dot menu (⋮) on its **Application Info** panel and choose **Update**, or click
**Update All** at the top. The badge can take a while to appear. The update downloads the new image and
restarts BIRDLE, which takes a few seconds.

**If you'd rather decide exactly which version runs,** use version tags:

1. Tag a release and push the tag:

   ```sh
   git tag v1.0.0
   git push origin v1.0.0
   ```

   GitHub then builds `ghcr.io/maebh-hughes/birdle:1.0.0`.
2. In TrueNAS, go to **Apps → Installed**, select **birdle** and click **Edit** on its **Application Info**
   panel. If you installed with YAML, the **Edit App YAML** screen opens: change the image line to
   `image: ghcr.io/maebh-hughes/birdle:1.0.0` and click **Save**. If you installed with the Custom App form,
   the same form opens: change **Tag** to `1.0.0` and click **Update**.
3. To go back, edit the tag again. Older versions and every `sha-...` tag stay available.

Updating never touches your data, which lives in the dataset. BIRDLE saves everything before it stops.

**Changing a setting**, such as a new Discord secret, works the same way: **Edit**, change the value, then
**Save**. The app restarts with the new value.

Every build adds a version to the package on GitHub. GitHub doesn't currently charge for storing container
images, but you can delete old versions from the package's page if you want to tidy up. Keep the one that's
running.

## Backups

All of BIRDLE's data is the one file `/mnt/POOL/apps/birdle/birdle-db.json` (it appears once someone has
played). BIRDLE writes it safely (to a temporary file first, then swapped in), so snapshots taken while it
runs are fine.

- **Automatic snapshots:** go to **Data Protection → Periodic Snapshot Tasks → Add**. Choose the dataset
  `POOL/apps/birdle`, a lifetime (for example 2 weeks) and a daily schedule, then **Save**.
- **Off the server:** add a **Replication Task** or a **Cloud Sync Task** for the same dataset.
- **Restoring:** stop the app (**Apps → Installed → birdle → Stop**). Then either roll the dataset back
  (**Datasets → birdle → Data Protection → Manage Snapshots**, pick one, **Rollback**), or copy the old file
  out of `/mnt/POOL/apps/birdle/.zfs/snapshot/<snapshot name>/`. Start the app again.
- **Keep your settings too:** save the Client ID, the Client Secret, the tunnel token and especially
  `PUZZLE_SEED` in a password manager. You'll need the same seed if you ever reinstall.

## Troubleshooting

### Where are the logs?

Go to **Apps → Installed**, select **birdle**, and find the **Workloads** panel. Click the **View Logs**
icon next to a container (**birdle** or **cloudflared**). In the window that opens, keep the default log
options and click **Connect**. Most problems explain themselves in the first few lines.

### The app won't start, or keeps restarting

Check the **birdle** logs:

- **`Invalid configuration:`** followed by a list. BIRDLE refuses to start until the settings are right:
  - *"...still contains the placeholder "CHANGE_ME"; replace it with your real value"*: the setting named at
    the start of the line (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` or `PUZZLE_SEED`) wasn't filled in.
    See [Fill in the YAML](#fill-in-the-yaml).
  - *"...must be the numeric application id..."*: `DISCORD_CLIENT_ID` isn't only digits: it still says
    `CHANGE_ME`, or has extra characters.
  - *"...are not both set... required in production"*: the Client ID or the Client Secret is missing.

  Fix the value with **Edit**, then **Save**.
- **`bind source path does not exist`** or **`invalid mount config`**: the `source:` path is wrong.
  Usually `POOL` wasn't replaced, or there's a typo, or the dataset doesn't exist. Compare with the path
  shown in **Datasets**.
- **`EACCES: permission denied`** on `/data/...`: the container can't write to the dataset. Select the
  dataset in **Datasets**, click **Edit** on the **Permissions** panel, and make sure the `apps` group
  (568) has **Modify** access (see [step 4](#4-create-a-dataset-for-birdles-data)). Don't "fix" it by
  running the container as root.
- **`EROFS: read-only file system`** on a path that is *not* under `/data`: BIRDLE tried to write
  somewhere it normally never does. As a stopgap, delete the `read_only: true` line with **Edit**, and
  report it as a bug.
- **The app shows as unhealthy** and the tunnel container never starts: the tunnel waits until BIRDLE's
  health check passes. Check the **birdle** logs for one of the problems above.

### "pull access denied", "denied", "unauthorized" or "failed to fetch anonymous token"

TrueNAS couldn't download the image:

- The package is private and TrueNAS has no key, or the key is wrong. See
  [step 2](#2-let-truenas-download-the-image).
- Your token expired, was deleted, or lacks the `read:packages` scope. Make a new one and update the
  **GitHub** entry under **Apps → Configuration → Sign-in to a Docker registry**.
- The image name is misspelled. It must be all lowercase: `ghcr.io/maebh-hughes/birdle:latest`.
- The GitHub build hasn't finished, or failed. Check the **Actions** tab.

### Checking the server: /api/health

`https://birdle.example.com/api/health` should show `{"ok":true}`.

- **It works on your home network (`http://TRUENAS-IP:30180/api/health`) but not from the internet:** the
  problem is the tunnel or proxy, not BIRDLE. Check that the **cloudflared** logs say
  `Registered tunnel connection`, that the tunnel is **Healthy** in Cloudflare, and that the route's service
  URL is exactly `http://birdle:3001`.
- **A Cloudflare error page (502 "Bad gateway", or error 1033):** the tunnel is down, or its service URL is
  wrong: `https` instead of `http`, `localhost` instead of `birdle`, or a wrong port.
- **Nothing works:** BIRDLE isn't running. Check its logs.

### `blocked:csp` in Discord's console, or a blank Activity

Discord only lets an Activity load from its URL mapping. Check that **Activities → URL Mappings** has prefix
`/` pointing at exactly your hostname, with no `https://` and no trailing slash. To see Discord's console,
open Discord in a web browser (discord.com/app) and use the browser's developer tools.

Cloudflare security features can also block Discord's proxy, because it can't solve challenges. If the
Activity shows a Cloudflare page or stays blank, turn off **Under Attack Mode**, **Bot Fight Mode** or any
**Cloudflare Access** login for this hostname.

### Error screens inside Discord

BIRDLE shows an error screen with a title, a short message and sometimes a detail line. By title:

- **Server trouble**, with the detail *"Couldn't complete Discord sign-in"*: Discord rejected BIRDLE's
  sign-in. The Client Secret is wrong or was reset, or the Client ID and secret belong to a different
  application than the Activity you launched. The **birdle** logs show Discord's reason (for example
  `invalid_client`). Copy both values again from the portal, then **Edit** → **Save**.
- **Server trouble**, with the detail *"Too many sign-ins right now"*: BIRDLE is holding back calls to
  Discord for a moment. Wait a minute and press **Retry**.
- **Discord sign-in failed:** Discord itself didn't finish the sign-in, for example because you declined
  the authorization prompt, or because `DISCORD_CLIENT_ID` belongs to a different application than the
  Activity you launched. Press **Retry**, and check the Client ID.
- **Sign-in failed** or **Session expired:** BIRDLE didn't accept the sign-in, or it ran out. Press
  **Retry**. If it keeps happening, check that the Client ID matches the application whose Activity you're
  launching.
- **BIRDLE isn't set up for Discord yet:** the server has no Client ID to give the game. Open
  `https://birdle.example.com/api/config`: it should show your Client ID. If it shows `null`, set
  `DISCORD_CLIENT_ID`.
- **No connection:** the game can't reach BIRDLE at all. See
  [Checking the server](#checking-the-server-apihealth).
- **A Cloudflare page (403, or a challenge) instead of BIRDLE:** a Cloudflare security feature is blocking
  Discord. See the previous section.

### The update badge doesn't appear

- Check that the GitHub build succeeded (a green tick in the **Actions** tab).
- Check that **Check for docker image updates** is on under **Apps → Configuration → Settings**.
- If the image is private, check that TrueNAS's registry key hasn't expired (see
  [step 2](#2-let-truenas-download-the-image)).
- TrueNAS only checks every so often. If you don't want to wait, use [version tags](#updating-birdle) and
  change the tag with **Edit**.

## Security notes

- **Treat these as secrets:** `DISCORD_CLIENT_SECRET`, `TUNNEL_TOKEN` and `PUZZLE_SEED`. TrueNAS stores
  them in the app's settings, where TrueNAS administrators can see them. Don't commit them to Git, paste them
  into Discord or GitHub issues, or show them in screenshots. The Docker build never includes `.env` files,
  so a local `.env` can't leak into the image.
- **If one leaks:**
  - Client Secret: in the Developer Portal, go to **OAuth2 → Reset Secret**, then update the app.
  - Tunnel token: refresh the tunnel's token in Cloudflare (or delete the tunnel and create a new one), then
    update the app.
  - `PUZZLE_SEED`: anyone with it can predict future answers. Changing it reshuffles the upcoming daily
    puzzles.
- **Leave `BIRDLE_ALLOW_MOCK_AUTH` unset.** It exists for local development. If it's on, anyone can play,
  and change stats, as any player without signing in. The image runs in production mode, where it's off.
  Also leave `NODE_ENV` alone.
- **The container is locked down:** it runs as the unprivileged `apps` user (568). The YAML install also
  gives it a read-only root filesystem, `no-new-privileges` and drops every Linux capability. Either way it
  writes only to its dataset (and, with YAML, a small in-memory `/tmp`).
- **The image's visibility should match the repository's** (step 2). A public image lets anyone download
  the source code and the answer list, though never your seed or any secret; with a public repository those
  are public anyway.
- **Only the tunnel or your reverse proxy should be public.** Don't forward port 30180 on your router for
  BIRDLE: with Nginx Proxy Manager, forward only ports 80 and 443 to the proxy. With a tunnel, if you don't
  need LAN access, remove the `ports` lines.
- **Run a single copy.** BIRDLE keeps its data in one file and doesn't support two copies sharing it.
- **Keep things updated:** TrueNAS itself, the BIRDLE image (rebuilds pick up Node.js security fixes), and
  cloudflared (`latest` is updated whenever the app is updated).
- **GitHub:** the workflow uses the built-in `GITHUB_TOKEN` with only `contents: read` and
  `packages: write`. You don't need to add any secrets to the repository. The token you gave TrueNAS can
  only read packages.

## Other ways to run the image

The image works on any Docker host with an x86-64 CPU, not only TrueNAS. If the image is private, run
`docker login ghcr.io` first, with your GitHub username and a `read:packages` token as the password.

```sh
docker run -d --name birdle --restart unless-stopped -p 3001:3001 \
  -v birdle-data:/data \
  -e DISCORD_CLIENT_ID=123456789012345678 \
  -e DISCORD_CLIENT_SECRET=your-secret \
  -e PUZZLE_SEED=your-random-seed \
  ghcr.io/maebh-hughes/birdle:latest
```

To build it yourself from the repository, run `docker build -t birdle .`.

About the image:

- **Port:** 3001, serving the game and `/api`.
- **Data:** `/data/birdle-db.json`. Put a volume or bind mount on `/data`.
- **User:** it runs as any non-root user. The default is 1000:1000; TrueNAS uses 568:568.
- **Read-only:** it writes nothing outside `/data`, so `--read-only` works (add `--tmpfs /tmp` to be safe).
- **Health check:** `GET /api/health`, every 30 seconds.
- **Memory:** about 100 MB while running.
- **Stopping:** on `docker stop`, BIRDLE finishes open requests, saves its data and exits within 10
  seconds.
- **Settings:** `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are required; BIRDLE won't start without
  them. Always set `PUZZLE_SEED` too: without it BIRDLE starts anyway, with only a `[config]` warning, and
  uses the public default seed, so anyone with the word list can work out the daily answers. BIRDLE won't
  start while any of these three still contains `CHANGE_ME`. `TZ` is optional. `PORT` and `DATA_FILE`
  already have the right values.
