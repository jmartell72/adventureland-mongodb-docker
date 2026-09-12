# Adventure Land — Private Solo Fork

A private, single-player fork of [kaansoral/adventureland_mongodb](https://github.com/kaansoral/adventureland_mongodb)
(merged with its `common_engine` and `adventureland_secretsandconfig` dependencies), built into one Docker image
with MongoDB bundled inside the same container.

Game source lives directly in this repo under [`game/`](game/) — see [`game/README-FORK.md`](game/README-FORK.md)
for exactly which upstream commits this was forked from and what gameplay patches have been applied (Steam/MAS
ownership check disabled, email verification bypassed, four raid-boss events scaled down to be soloable). **This is
a fork, not a mirror** — it does not auto-update from upstream. GitHub Actions rebuilds the image on every push to
this repo's own `main`; picking up upstream changes is a manual, reviewed step (see `game/README-FORK.md`).

## Why MongoDB is bundled in the container

This is a single-player instance with no need to scale the database separately, so `Dockerfile` installs
`mongodb-org` alongside Node and `scripts/entrypoint.sh` starts `mongod` itself before the app. It still runs as a
single-node **replica set** (not a plain standalone instance) — the app uses multi-document transactions
(`tx_get`/`tx_save`), which MongoDB only allows on a replica set or `mongos`. `entrypoint.sh` initializes the
replica set on first boot only (checks `rs.status()`, no-ops after that).

## Running locally

```sh
docker compose up --build
```

Starts the app (Express backend on `:8090`, game server on `:7192`) with MongoDB inside the same container. The
vendored config template ships with randomized dev defaults, fine for local use.

## Pulling the published image

```sh
docker pull ghcr.io/jmartell72/adventureland-mongodb-docker:latest
```

Public package, no login needed.

## Production deployment (Traefik)

`docker-compose.prod.yml` is standalone — copy just that one file to a host already running Traefik with an
external proxy network and run it as-is. It:

- Pulls the published image (no build tools needed on the host) — MongoDB runs inside it.
- Joins the app container to your `t2_proxy` network — no ports published to the host.
- Adds two routers, since the web backend (Express, `:8090`) and the game server (Socket.IO, `:7192`) are separate
  HTTP servers in the same container: one for `al.$DOMAINNAME`, one for `al-ws.$DOMAINNAME`. Rename both to whatever
  subdomains you want — they just need matching DNS records pointed at the host.
- Sets `BASE_URL`, `GAME_SERVER_ADDRESS`, and `PUBLIC_SECURE=true` so the app generates correct HTTPS/WSS URLs and
  secure cookies. These are applied at container start by `scripts/patch-config.js`, which rewrites
  `secretsandconfig/options.js`/`keys.js` from env vars. The app already runs with `trust proxy` enabled and listens
  plain HTTP internally, so Traefik terminating TLS in front of it is the intended setup.
- Persists all state under `$DATA_DIR` on the host (default `/home/docker/adventureland`), so a server reboot,
  container recreation, or image update never loses anything:
  - `$DATA_DIR/mongo` — the Mongo database (accounts, characters, map data, everything gameplay-related).
  - `$DATA_DIR/secretsandconfig` — the config/secrets directory. On first boot (empty directory) it's seeded from
    the image's built-in template; after that it's yours. Add real values directly in
    `$DATA_DIR/secretsandconfig/keys.js` (Stripe, Steam, Discord, Amazon SES, `ACCESS_MASTER`, etc.) or
    `options.js` — `patch-config.js` only ever overwrites the specific fields listed above on each restart, so
    anything else you set by hand is preserved across restarts and image rebuilds.

Create a `.env` next to `docker-compose.prod.yml`:

```sh
DOMAINNAME=example.com
# Optional — defaults shown below
#DATA_DIR=/home/docker/adventureland
#GHCR_IMAGE=ghcr.io/jmartell72/adventureland-mongodb-docker:latest
```

Then, on the host:

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Since this is now a fork (see above), redeploying only picks up a new image after *you've* pushed a change and CI
has rebuilt it — there's no more background auto-update pulling in upstream commits.

Notes:

- The compose file assumes a `chain-no-auth@file` Traefik middleware and an `https` entrypoint already exist in your
  Traefik setup (matching the convention from your other services) — adjust the labels if yours are named
  differently.
- `tls.certresolver` is commented out, same as your other services; uncomment and set it if your Traefik doesn't
  already have a default resolver for these routers.
- A static IP on `t2_proxy` isn't set — add `ipv4_address:` under the `app` service's `t2_proxy` network entry if
  your setup expects one; pick an address outside your other containers' range.

## Admin settings panel

`al.$DOMAINNAME/admin/panel` — a small settings UI (XP/gold/luck multipliers, character/IP limits, Discord relay
token). No login beyond just being on this server: `Local: true` + `unsecure_admin: true` (both set by default)
make every request admin, same as the stock `/admin/executor`/`/admin/renderer` routes.

Settings persist to `secretsandconfig/settings.json` (so `$DATA_DIR/secretsandconfig/settings.json` in production) —
hand-edit it directly if you prefer; a file watcher picks up changes within ~2 seconds, no restart needed. The one
exception is the Discord token, which only takes effect on the next boot (the relay is constructed once at startup).

## Troubleshooting

**Container stuck restart-looping, logs show `Server Exists: SR_<region><name>`.** The game server refuses to
start if it thinks another instance with the same ID is already running — it checks MongoDB and bails out if that
server's record is `online: true` and was updated within the last 12 minutes. This is meant to prevent two
instances fighting over the same ID, but it means an *ungraceful* shutdown (SIGKILL, OOM, a host crash, or —
before this was fixed — a `stop_grace_period` too short for the app's own shutdown sequence to finish) leaves a
stale record, and the next boot has to wait out that 12-minute window. `entrypoint.sh` and `stop_grace_period: 30s`
are meant to prevent this by giving the game server real time to deregister on every normal stop/restart, but if
you still hit it (e.g. `docker kill`, an OOM, a host reboot), you can clear it immediately instead of waiting:

```sh
docker exec al_app mongosh --quiet adventureland --eval \
  'db.server.updateOne({_id:"SR_USI"}, {$set:{online:false}})'
```

(`SR_USI` is `SR_` + region + name, e.g. `SR_USI` for the default `local` server def — check `db.server.find()` if
you changed those.) The container will start cleanly on its next restart attempt.

**Fresh database — "Game hasn't loaded yet" and characters won't spawn.** A brand-new MongoDB has no map/world
data at all (only what signup/character-creation create), and the client waits for map data that will never
arrive. See [`game/README-FORK.md`](game/README-FORK.md) or the upstream README's
["Seeding Game Data"](https://github.com/kaansoral/adventureland_mongodb#seeding-game-data) section — import the
RDBMS dump via `game/agentic/_migrate_rdbms.py` (needs Python 3 + `pymongo`, run from a container or host that can
reach the app container's Mongo on `127.0.0.1:27017` inside it, e.g. `docker exec -i al_app ...` or a container on
the same network). This only touches `map`/`upload` collections in that dump, not accounts, so it's safe to run
against a database that already has real users. **The game server loads map geometry into memory once at boot**
(`node/server.js`'s `init_game()`), so restart the `app` container after importing.
