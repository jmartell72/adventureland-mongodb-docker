#!/bin/bash
set -euo pipefail

cd /app

# secretsandconfig/ may be a bind-mounted, initially-empty host directory in
# production (see docker-compose.prod.yml) — seed it from the image's
# built-in template on first boot so the app has something to run with.
if [ -z "$(ls -A /app/secretsandconfig 2>/dev/null)" ]; then
	echo "[entrypoint] secretsandconfig/ is empty, seeding from image template"
	cp -a /app/.secretsandconfig-template/. /app/secretsandconfig/
fi

node /app/scripts/patch-config.js

node main.js &
MAIN_PID=$!

node node/server.js "${GAME_SERVER_KEY:-local}" &
GAME_PID=$!

term() {
	kill -TERM "$MAIN_PID" "$GAME_PID" 2>/dev/null || true
}
trap term TERM INT

wait -n "$MAIN_PID" "$GAME_PID"
EXIT_CODE=$?
term
exit "$EXIT_CODE"
