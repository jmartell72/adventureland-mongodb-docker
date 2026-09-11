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

SHUTTING_DOWN=0
term() {
	if [ "$SHUTTING_DOWN" = "1" ]; then return; fi
	SHUTTING_DOWN=1
	kill -TERM "$MAIN_PID" "$GAME_PID" 2>/dev/null || true
	# node/server.js deregisters itself from MongoDB (sets online:false) as
	# part of its own graceful shutdown sequence *after* being signaled -
	# it does not happen synchronously in the signal handler. If this
	# script (and therefore the container) exits before that completes,
	# the record is left stale and the next boot refuses to start
	# ("Server Exists") until MongoDB's own 12-minute staleness window
	# passes. So: actually wait for both processes to exit, don't just
	# forward the signal and return. Capped well under this service's
	# stop_grace_period so we still exit if something hangs.
	for i in $(seq 1 25); do
		kill -0 "$MAIN_PID" 2>/dev/null || kill -0 "$GAME_PID" 2>/dev/null || return 0
		sleep 1
	done
	echo "[entrypoint] graceful shutdown timed out after 25s, giving up waiting"
	return 0
}
trap term TERM INT

wait -n "$MAIN_PID" "$GAME_PID"
EXIT_CODE=$?
term
exit "$EXIT_CODE"
