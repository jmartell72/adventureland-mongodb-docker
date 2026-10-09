# Runbook — Adventure Land private solo server

How this server is run, what has been decided, and what still needs to be done. The [README](../README.md)
covers first-time setup and the Traefik deployment; this file is the living record. Add new decisions at the
bottom of the Decisions section and never rewrite an old one (mark it superseded instead).

## Stack at a glance

| Piece | Where | Notes |
|---|---|---|
| Web backend (Express, `main.js`) | container `al_app`, port 8090 → `al.<domain>` | Login, character select, admin panel, Party Command Center, `/mcp` |
| Game server (Socket.IO, `node/server.js`) | same container, port 7192 → `al-ws.<domain>` | Also serves the internal `/server.api/eval` endpoint (`ACCESS_MASTER`-gated) |
| MongoDB 7.0 (single-node replica set `rs0`) | same container, `$DATA_DIR/mongo` | Replica set is required for transactions |
| Server-side bots (`bots.js`) | inside the web process | Connects alt characters over Socket.IO and drives them via `/server.api/eval` |
| Script sync (`script_sync.js`) | inside the web process | `$DATA_DIR/character-scripts/src/<char>/*.js` → in-game code slots |
| Backups (`scripts/backup.sh`) | same container, `$DATA_DIR/backups` | Every 6 h, keeps 14; "Backup now" in the admin panel |
| Game MCP (`mcp_api.js`) | `https://al.<domain>/mcp`, Bearer token | Token from `POST /api/generate_token` |
| CI/CD | `.github/workflows/docker-build.yml` | Every push to `main` builds and pushes `ghcr.io/jmartell72/adventureland-mongodb-docker:latest` and `:<sha>` |

## Routine operations

**Deploy a change** — merge to `main`, wait for the "Build and Push Docker Image" workflow, then on the host:

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

**Roll back** — set `GHCR_IMAGE=ghcr.io/jmartell72/adventureland-mongodb-docker:<previous-sha>` in `.env` and run the
same two commands. Every build is also tagged by commit SHA.

**Restart without losing the server lock** — always `docker compose ... restart` / `up -d`, never `docker kill`. If the
game server refuses to start with `Server Exists: SR_USI`, follow the README troubleshooting entry.

**Restore a backup**

```sh
docker exec al_app mongorestore --gzip --drop --archive=/backups/<file>.archive.gz
docker compose -f docker-compose.prod.yml restart
```

**Change server settings** — `https://al.<domain>/admin/panel`, or edit `$DATA_DIR/secretsandconfig/settings.json`
(picked up within ~2 s; the Discord token needs a restart).

## Developing without Docker (cloud sessions and local)

The whole game runs from the repo without Docker: the same three processes the image runs (mongod as a
single-node replica set, `main.js`, `node/server.js`), with data in `~/.al-dev`.

```sh
scripts/dev/up.sh          # start everything; first run imports map data and creates the test account
node scripts/dev/smoke.js  # log in as Kingmartell in headless Chromium, press I, save screenshots
scripts/dev/down.sh        # stop everything (rm -rf ~/.al-dev for a fresh world)
```

- Test account: `tester` / `tester`, admin, with Kingmartell (warrior), Burt (ranger) and Healz (priest).
- Logs: `~/.al-dev/logs/{web,game,mongod}.log`. Screenshots: `~/.al-dev/screenshots`.
- In Claude Code cloud sessions, `.claude/settings.json` runs `scripts/dev/session-start.sh` at startup, which
  installs MongoDB 7.0 and the npm dependencies. It needs network access to `fastdl.mongodb.org` and
  `raw.githubusercontent.com` (map data); the environment has full network access as of 2026-10-09.
- `AL_DEV_SECRET` (set by `up.sh`) makes `secretsandconfig/keys.js` derive its keys instead of randomizing them,
  so both processes agree on `ACCESS_MASTER`, and stops `main.js` rewriting `version.js`. The image never sets it.

A change is only called fixed once it has been seen working in the browser this way.

### Baseline database (`dev-data/`)

Every test starts from the same world: `dev-data/baseline.archive.gz` (a `mongodump --gzip` archive, ~2.4 MB).
`up.sh` restores it automatically when `~/.al-dev` has an empty database.

- Contents: the 112 maps and 2 uploads from the upstream dev datastore, plus account `tester` / `tester`
  (admin) with Kingmartell (warrior), Burt (ranger) and Healz (priest), all **level 20** with spare gear in their
  bags, and the **tutorial marked finished**. Level 1 characters always get the tutorial or Guide menu on login
  (`js/game.js`), which covered the game in early screenshots.
- `dev-data/tester.cookie` is the matching login cookie (dev database only; worthless against production).
- Taken with the web and game servers stopped, so every character is saved offline and `SR_USI` is not locked.
- Refresh it after changing `seed-account.js`: `scripts/dev/down.sh`, start only mongod, then
  `mongodump --uri="mongodb://127.0.0.1:27017/adventureland?replicaSet=rs0" --archive=dev-data/baseline.archive.gz --gzip`.
- Rebuild from nothing: `rm -rf ~/.al-dev && AL_DEV_FROM_SCRATCH=1 scripts/dev/up.sh`.

## Handoff — state as of 2026-10-09

For the next agent or session picking this up. Branch: `claude/charming-knuth-n2tq3s` (not merged; `main` deploys).

**Done on this branch**
1. `docs/RUNBOOK.md` with decision D-001 (party screen, gear swap, bot rework — accepted, not built) and the
   2026-10-09 stack review (D-002, proposed).
2. Run-without-Docker tooling in `scripts/dev/`: `up.sh`, `down.sh`, `smoke.js`, `seed-account.js`,
   `session-start.sh` (wired to `.claude/settings.json` SessionStart).
3. Small code changes so the game runs outside the image, production unchanged: `keys.js` derives keys from
   `AL_DEV_SECRET`; `options.js` template has `msgpack_path`; `main.js` skips rewriting `version.js` in dev mode.
4. Baseline database in `dev-data/` (above).

**Verified in the browser**: login as Kingmartell at level 20 with no tutorial/guide popup; pressing `I` opens
the party overlay with empty gear slots (the D-001 data bug, reproduced). A blank white box in the top-left of
early screenshots was a headless-Chromium WebGL artifact, not the game; `smoke.js` now launches with SwiftShader
(`--use-gl=angle --use-angle=swiftshader`) and the screen renders cleanly. Fresh start from an empty
`~/.al-dev` restores the baseline and passes `smoke.js`.

**Decided 2026-10-09**: move the fork code first (D-003), then build D-001 on top of it.

**Next steps**
1. Do D-003: move fork code into `game/fork/` and `game/js/fork/` with no behavior change. Run `smoke.js`
   before and after; open the admin panel, Party Command Center, event HUD, fast travel and right-click menu in
   the browser to confirm they still work.
2. Build D-001 steps 1–5 in order inside the new layout, checking each with `smoke.js` (extend it per feature:
   drag an item between characters, equip on another character, bot moves and attacks).
3. Then the D-002 items the user picks, starting with S1 (check production `unsecure_admin`).

**Gotchas**
- `pkill -f 'node main.js'` matches the shell running it; stop things with `scripts/dev/down.sh`.
- The game server takes several seconds to deregister on SIGTERM; `down.sh` waits up to 30 s per process.
- The repo's npm `package-lock.json` files are not committed (D-002 R2); `npm install` resolves fresh.

## Decisions

### D-001 — Party screen, gear swapping and companion bots (2026-10-09)

**Status:** accepted, not yet built.

**Context.** The goal since 2026-09-13 has been a Baldur's Gate 3 / NWN2-style party: see every character's
inventory and equipped gear in one place, move items and swap gear between them, switch who you're playing, and
have the rest of the party follow and fight. What was built instead is a separate full-screen overlay that took over
the Inventory key, and a server-side bot that teleports in small jumps. A review on 2026-10-09 found:

- The overlay reads `items`, `slots` and `xp` from the top level of the character document. The game saves them
  under `info.items`, `info.slots` and `info.xp` (`node/server.js` `sync_entity`), so every window is empty and
  the XP bar never moves.
- The Inventory key no longer opens your own inventory, so equipping items and using potions is impossible.
- Equipment in the overlay is display-only; gear swapping was never built.
- Drag-and-drop transfers send only a slot index from saved data and the server moves whatever is in that slot
  live, so it can move the wrong item.
- Bots change `player.x/y` directly instead of using the server's movement (`going_x/going_y` +
  `start_moving_element`), so clients never see them move, they pass through walls, and the server's spatial
  index goes stale. They act every 2 s, never drink potions or loot, and revive in place without notifying clients.
- The "Switch Character" HUD button passes the click event as the destination URL and navigates to
  `/[object MouseEvent]`.

**Decision.**

1. The Inventory key opens the game's own inventory again. The other party members' bags open as extra windows
   beside it (a separate key or HUD button, plus Esc to close). Online characters show live data; offline
   characters show saved data from `info.items` / `info.slots`.
2. Dropping an item on another character's gear slot runs the game's own equip handler for that character, so
   stats recalculate exactly as when you equip something yourself. Unequipping works the same way.
3. Transfers carry the item's name and level and the server refuses the move if the slot no longer holds that item.
4. Bots move with the server's real movement, act on their attack cooldown (about 4× a second instead of every
   2 s), drink potions under 50% HP, respawn properly, and notify clients after HP or buff changes. Add a
   **Stay** command next to Follow / Attacking / Passive.
5. Fix the Switch Character button and the XP bar.
6. Later, optional: the Mainframe-style runner (a headless browser per character running the real game client
   and your real CODE). It was recommended on 2026-09-13 but never built.

**Consequences.** The overlay in `js/party_command_center.js` is reworked, not extended. The bot movement code
in `bots.js` is replaced. Every step above needs to be checked in a real browser before it is called done, since
past rounds were marked fixed without being played.

### D-002 — Stack review follow-ups (2026-10-09)

**Status:** proposed, except W3 (restructure), which is accepted as D-003. See the review below.

### D-003 — Move fork code out of the upstream files before building D-001 (2026-10-09)

**Status:** accepted, not yet done. Comes before D-001.

**Context.** Fork changes are spread through very large upstream files: about 550 lines of admin/party HTML and
routes inline in `game/main.js`, nine patch sites in `game/node/server.js` (16k lines), plus `api.js`,
`adventure_functions.js`, `js/functions.js`, `js/html.js` and the HTML templates. That makes each change risky to
edit and makes picking up upstream changes later a manual hunt.

**Decision.** Move the code, not the history (no rebase or force-push; ordinary commits on the branch):

| Now | Moves to |
|---|---|
| `bots.js`, `settings.js`, `script_sync.js` | `game/fork/` (update the `require` paths in `main.js` and `node/server.js`) |
| Admin panel, Party Command Center and `/events_status` routes inline in `main.js` | `game/fork/web_routes.js`, loaded from `main.js` with the same `eval(fs.readFileSync(...))` pattern `main.js` already uses for `mcp_api.js`, so it keeps access to `app`, `db`, `get_user`, `is_admin` and `G` |
| Admin panel / party page HTML strings | `game/fork/views/` |
| `js/event_hud.js`, `fast_travel.js`, `switch_character.js`, `party_control.js`, `party_command_center.js` | `game/js/fork/` (update the `<script>` tags in `htmls/index.html` and `htmls/comm.html`) |
| `node/server.js` patch sites | Stay where they are when they're a line or two inside upstream logic (drm, inventory size, aggro/respawn multipliers, authfail clear, party auto-accept). The new `fast_travel` socket handler and the settings hookup move into `game/fork/server_hooks.js`, called from one line in `server.js` |
| `api.js` / `adventure_functions.js` username login | Stays (it's woven into the signup transaction); keep the `[private fork]` markers |

Every patch that stays in an upstream file keeps a one-line `// [private fork]` marker pointing at the fork module
or this decision. `game/README-FORK.md` gets a list of every remaining patch site.

**Rules for the move.** No behavior changes in the same commits; one commit per area so each can be checked on its
own; the Dockerfile copies `game/` whole, so no build changes are needed, but confirm with `smoke.js` and a manual
click-through after each commit.

## Stack review — 2026-10-09

Version data comes from the Private AI MCP service (`runtime_check`, `versions_check`) on 2026-10-09. Its
`deployment_assess` call was rate-limited (HTTP 429) and its browser tool returned HTTP 502, so the production site
itself was not checked from outside.

### Security

| # | Finding | Fix |
|---|---|---|
| S1 | The config template ships `Local: true` and `unsecure_admin: true`, which make **every request an admin** (`common/admin.js`). `patch-config.js` does not change them, and Traefik uses `chain-no-auth`. If production still has the template values, anyone who can reach `al.<domain>` can open `/admin/executor` and run code on the server. **Check `$DATA_DIR/secretsandconfig/options.js` now.** | Set `unsecure_admin: false` in production (patch-config should force it when `PUBLIC_SECURE=true`), keep `admin: true` on your account, and put `/admin` behind Traefik auth or Cloudflare Access. |
| S2 | `al-ws.<domain>` routes every path to port 7192, including `/server.api/eval` — a code-execution endpoint protected only by `ACCESS_MASTER`. | Add a Traefik rule that only routes the Socket.IO paths publicly; bots already call it on `127.0.0.1`. |
| S3 | The container runs as root with no healthcheck. | Add a `HEALTHCHECK`; dropping root needs the Mongo data directory ownership sorted out first. |

### Reliability and builds

| # | Finding | Fix |
|---|---|---|
| R1 | Base image is **Node 20, end-of-life since April 2026**. Current LTS is **Node 24.21.0**. | Move to `node:24-bookworm-slim` and test the native modules (`argon2`, `@mongodb-js/zstd`). |
| R2 | No lockfiles; every build resolves `^` ranges fresh, so two builds of the same commit can differ. | Commit `package-lock.json` for `game/` and `game/node/`, and use `npm ci`. |
| R3 | CI builds and pushes `:latest` with no tests, not even a syntax check. Every bug in D-001 shipped this way. | Add a CI job: `node --check` on changed files, the existing `node --test` suites, and a smoke test that boots the image, creates an account and logs a character in with Playwright. Only push `:latest` when that passes. |
| R4 | Backups live on the same host as the database. | Copy `$DATA_DIR/backups` off-host (rclone/restic to another machine or bucket). |
| R5 | Outdated majors (no action required): `mongodb` driver 6 → 7.7.0, `express` 4 → 5.2.1, `protobufjs` 6 → 8.8.0. `socket.io` 4.8.4 is current. MongoDB server 7.0 is still supported; plan 8.0. | Upgrade after R2/R3 exist, one at a time. |

### Development workflow (why fixes kept missing)

| # | Finding | Fix |
|---|---|---|
| W1 | Nothing was played end-to-end before being marked fixed. | **Done 2026-10-09:** full network access granted; `scripts/dev/` runs and playtests the game inside a cloud session (see "Developing without Docker"). The CI smoke test in R3 is still worth adding for the Docker image itself. |
| W2 | All work was committed straight to `main`, which deploys on every push. | Work on branches and open PRs; deploy from `main` only after CI passes. |
| W3 | Fork code is spread through very large upstream files (`node/server.js` 16k lines, `main.js` with ~550 lines of inline admin/party HTML). Hard to edit safely and hard to merge upstream later. | Restructure: move fork code into `game/fork/` (server routes, bots, party API) and `game/js/fork/` (client UI), leaving one-line hooks in the upstream files. Not a history rewrite — a normal set of commits. |

### Private AI MCP service

- `gateway_ping`, `runtime_check` and `versions_check` work.
- `browser_session_create` failed with "Browser origin returned non-JSON HTTP 502" — the browser worker looks down.
- `deployment_assess` returned "Upstream returned HTTP 429" on the first two calls of the session.
