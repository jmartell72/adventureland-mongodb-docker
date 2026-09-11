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

## Pulling the published image

```sh
docker pull ghcr.io/<owner>/<repo>:latest
```

(Requires the package to be made accessible to your account, or authenticating with a PAT that has `read:packages`,
since it's published from a private repository.)
