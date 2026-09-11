# Adventure Land (MongoDB Edition) — Docker Mirror

Builds and publishes a Docker image of [kaansoral/adventureland_mongodb](https://github.com/kaansoral/adventureland_mongodb),
its shared engine ([common_engine](https://github.com/kaansoral/common_engine)), and its config template
([adventureland_secretsandconfig](https://github.com/kaansoral/adventureland_secretsandconfig)), and keeps the image
up to date as those three repos change.

This repo contains no game source itself — the `Dockerfile` clones all three upstream repos at build time, pinned to
the commit SHAs recorded in [`upstream-refs.json`](upstream-refs.json).

## How auto-update works

- **`check-upstream.yml`** runs every 6 hours (and on demand). It resolves the current HEAD commit of each of the
  three upstream repos and, if any changed, updates `upstream-refs.json` and pushes the commit.
- **`docker-build.yml`** runs on every push to `main` that touches `upstream-refs.json` (or the Dockerfile/scripts),
  and on demand. It builds the image pinned to the refs in that file and pushes it to
  `ghcr.io/<this-repo>:latest` and `ghcr.io/<this-repo>:<adventureland_mongodb-sha>`.

So: upstream changes → `check-upstream` bumps the pin and pushes → that push triggers `docker-build` → a new image
lands in GHCR, generally within a few hours of the upstream change.

## Running locally

```sh
docker compose up --build
```

This starts MongoDB plus the app (Express backend on `:8090`, game server on `:7192`). The config template ships
with randomized dev defaults, which is fine for local use — see the
[upstream README](https://github.com/kaansoral/adventureland_mongodb#readme) for production configuration
(Stripe/Steam/Discord/SES keys, TLS, etc.) if you want those features.

Mongo runs as a single-node **replica set**, not a plain standalone instance — the app uses multi-document
transactions (`tx_get`/`tx_save` in `common_engine`, used by signup and other flows), which MongoDB only allows on a
replica set or `mongos`; a standalone instance fails with `Transaction numbers are only allowed on a replica set
member or mongos`. The `mongo-init` service initializes the replica set on first run only (it checks `rs.status()`
and no-ops if already done) and the app waits for it to finish before starting.

## Pulling the published image

```sh
docker pull ghcr.io/<owner>/<repo>:latest
```

The package is public, so this works with no login.

## Production deployment (Traefik)

`docker-compose.prod.yml` is a standalone file — copy just that one file to a host already running Traefik with an
external proxy network and run it as-is; it doesn't reference or depend on `docker-compose.yml`. It:

- Pulls the published image (no build tools needed on the host) and runs Mongo alongside it.
- Joins the app container to your `t2_proxy` network (for Traefik) and an `internal` network (for Mongo) — no ports
  are published to the host.
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

Since the image auto-updates in GHCR (see above), redeploying is just re-running those two commands — add a cron
job or a `docker compose ... pull && docker compose ... up -d` on a timer if you want that automated too.

Notes:

- The compose file assumes a `chain-no-auth@file` Traefik middleware and an `https` entrypoint already exist in your
  Traefik setup (matching the convention from your other services) — adjust the labels if yours are named
  differently.
- `tls.certresolver` is commented out, same as your other services; uncomment and set it if your Traefik doesn't
  already have a default resolver for these routers.
- A static IP on `t2_proxy` isn't set — add `ipv4_address:` under the `app` service's `t2_proxy` network entry if
  your setup expects one; pick an address outside your other containers' range.
