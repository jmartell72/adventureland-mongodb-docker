#!/bin/bash
set -euo pipefail

cd /app

# [private fork] Ops alerts - separate from the in-game Discord chat relay
# (which lives in node/server.js and only works while that process is
# healthy). This is a plain webhook POST from bash, so it still fires on the
# failure modes an in-process relay can't report on its own: a crashed game
# process, or the container never coming up in the first place. Dormant
# (no-op) unless DISCORD_ALERT_WEBHOOK is set - create a webhook URL from a
# Discord channel's Integrations settings, no bot/token needed.
discord_alert() {
	[ -z "${DISCORD_ALERT_WEBHOOK:-}" ] && return 0
	local payload
	payload=$(node -e 'process.stdout.write(JSON.stringify({content: process.argv[1]}))' "$1" 2>/dev/null) || return 0
	curl -fsS -m 5 -X POST -H "Content-Type: application/json" -d "$payload" "$DISCORD_ALERT_WEBHOOK" >/dev/null 2>&1 \
		|| echo "[entrypoint] discord alert failed"
}

echo "[entrypoint] starting mongod"
mongod --replSet rs0 --dbpath /data/db --logpath /data/db/mongod.log &
MONGO_PID=$!

echo "[entrypoint] waiting for mongod to accept connections"
for i in $(seq 1 60); do
	mongosh --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1 && break
	sleep 1
done

# The app uses MongoDB multi-document transactions (tx_get/tx_save), which
# only work on a replica set, even a single-node one - a plain standalone
# mongod fails every transactional call. Idempotent: no-ops on every boot
# after the first (checked via rs.status()).
mongosh --quiet --eval '
	try { rs.status(); print("[entrypoint] replica set already initialized"); }
	catch (e) { rs.initiate({_id: "rs0", members: [{_id: 0, host: "127.0.0.1:27017"}]}); print("[entrypoint] replica set initiated"); }
'

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

discord_alert "🟢 Adventure Land started"

# Scheduled world-data backups (accounts, characters, map data - everything)
# to /backups (bind-mount that to a host directory in production). See
# scripts/backup.sh for the actual mongodump + pruning; the admin panel's
# "Backup now" button runs the same script on demand.
(
	while true; do
		sleep "$(( ${BACKUP_INTERVAL_HOURS:-6} * 3600 ))"
		/app/scripts/backup.sh || { echo "[entrypoint] scheduled backup failed"; discord_alert "🟡 Adventure Land: scheduled backup failed"; }
	done
) &
BACKUP_LOOP_PID=$!

SHUTTING_DOWN=0
term() {
	if [ "$SHUTTING_DOWN" = "1" ]; then return 0; fi
	SHUTTING_DOWN=1
	discord_alert "🟡 Adventure Land stopping (signal received)"

	kill -TERM "$BACKUP_LOOP_PID" 2>/dev/null || true
	kill -TERM "$MAIN_PID" "$GAME_PID" 2>/dev/null || true
	# node/server.js deregisters itself from MongoDB (sets online:false) as
	# part of its own graceful shutdown sequence *after* being signaled -
	# it does not happen synchronously in the signal handler. Wait for both
	# to actually exit before touching mongod, or the deregistration write
	# never happens and the next boot refuses to start ("Server Exists")
	# until MongoDB's own 12-minute staleness window passes. Capped well
	# under this service's stop_grace_period so we still exit if something
	# hangs.
	for i in $(seq 1 25); do
		kill -0 "$MAIN_PID" 2>/dev/null || kill -0 "$GAME_PID" 2>/dev/null || break
		sleep 1
	done

	echo "[entrypoint] stopping mongod"
	kill -TERM "$MONGO_PID" 2>/dev/null || true
	wait "$MONGO_PID" 2>/dev/null || true
	return 0
}
trap term TERM INT

wait -n "$MAIN_PID" "$GAME_PID"
EXIT_CODE=$?
# If SHUTTING_DOWN is already 1, term() (the trap) killed these children
# itself in response to a signal (docker stop/restart) - expected, already
# alerted above. Otherwise one of them exited on its own - a real crash.
if [ "$SHUTTING_DOWN" != "1" ]; then
	discord_alert "🔴 Adventure Land: a process exited unexpectedly (code $EXIT_CODE), container is shutting down"
fi
term
exit "$EXIT_CODE"
