#!/bin/bash
# Dev only: stop what scripts/dev/up.sh started. Data stays in ~/.al-dev;
# delete that directory for a completely fresh world.
DEV="${AL_DEV_DIR:-$HOME/.al-dev}"
for name in game web; do
	if [ -f "$DEV/$name.pid" ]; then
		pid=$(cat "$DEV/$name.pid")
		if kill "$pid" 2>/dev/null; then
			# The game server deregisters itself from Mongo on SIGTERM before
			# exiting - wait for it, or the next start hits "Server Exists".
			for i in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
			kill -9 "$pid" 2>/dev/null
			echo "[dev] stopped $name"
		fi
		rm -f "${DEV:?}/$name.pid"
	fi
done
mongod --dbpath "$DEV/db" --shutdown >/dev/null 2>&1 && echo "[dev] stopped mongod"
rm -f "${DEV:?}/mongod.pid"
exit 0
