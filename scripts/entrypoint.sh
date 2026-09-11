#!/bin/bash
set -euo pipefail

cd /app

if [ -n "${MONGODB_URI:-}" ]; then
	sed -i "s#mongodb_uri: \"[^\"]*\"#mongodb_uri: \"${MONGODB_URI}\"#" secretsandconfig/keys.js
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
