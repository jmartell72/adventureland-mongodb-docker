#!/bin/bash
# Dev only: run the whole game without Docker - mongod (single-node replica
# set), the web backend and the game server - the same three processes
# scripts/entrypoint.sh runs inside the image. Idempotent: anything already
# running is left alone. An empty database is restored from
# dev-data/baseline.archive.gz (set AL_DEV_FROM_SCRATCH=1 to rebuild it from
# the upstream map import + seed-account.js instead).
#
#   scripts/dev/up.sh      start everything, print the login cookie
#   scripts/dev/down.sh    stop everything (data is kept in ~/.al-dev)
#
# Needs mongod on PATH (scripts/dev/session-start.sh installs it) and
# network access to raw.githubusercontent.com for the one-time map import.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEV="${AL_DEV_DIR:-$HOME/.al-dev}"
mkdir -p "$DEV/db" "$DEV/logs"

export AL_DEV_SECRET="${AL_DEV_SECRET:-al-dev-secret}"
export MONGODB_URI="mongodb://127.0.0.1:27017/adventureland?replicaSet=rs0"
export GAME_SERVER_KEY=local

mongo_node() {
	(cd "$REPO/game" && node -e "$1")
}

if ! { [ -f "$DEV/mongod.pid" ] && kill -0 "$(cat "$DEV/mongod.pid")" 2>/dev/null; }; then
	echo "[dev] starting mongod"
	mongod --replSet rs0 --dbpath "$DEV/db" --bind_ip 127.0.0.1 --port 27017 --fork \
		--pidfilepath "$DEV/mongod.pid" --logpath "$DEV/logs/mongod.log" >/dev/null 2>&1 </dev/null
fi

mongo_node '
const { MongoClient } = require("mongodb");
(async () => {
	const c = new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true");
	await c.connect();
	try { await c.db("admin").command({ replSetGetStatus: 1 }); }
	catch (e) { await c.db("admin").command({ replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] } }); console.log("[dev] replica set initiated"); }
	for (let i = 0; i < 30; i++) {
		const s = await c.db("admin").command({ hello: 1 });
		if (s.isWritablePrimary) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	await c.close();
})();'

MAPS=$(mongo_node '
const { MongoClient } = require("mongodb");
(async () => { const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
console.log(await c.db("adventureland").collection("map").countDocuments()); await c.close(); })();')
BASELINE="$REPO/dev-data/baseline.archive.gz"
if [ "$MAPS" = "0" ] && [ -z "${AL_DEV_FROM_SCRATCH:-}" ] && [ -f "$BASELINE" ]; then
	# The shared starting point: map data plus the tester account and party,
	# tutorial finished. See "Baseline database" in docs/RUNBOOK.md.
	echo "[dev] restoring baseline database"
	mongorestore --quiet --uri="$MONGODB_URI" --archive="$BASELINE" --gzip --drop
	cp "$REPO/dev-data/tester.cookie" "$DEV/cookie"
elif [ "$MAPS" = "0" ]; then
	echo "[dev] importing map data (one time)"
	[ -f "$DEV/db.rdbms" ] || curl -fsSL -o "$DEV/db.rdbms" https://raw.githubusercontent.com/kaansoral/adventureland-appserver/main/storage/db.rdbms
	[ -x "$DEV/venv/bin/python" ] || { python3 -m venv "$DEV/venv" && "$DEV/venv/bin/pip" -q install pymongo; }
	(cd "$REPO/game/agentic" && RDBMS_PATH="$DEV/db.rdbms" MONGO_URI="$MONGODB_URI" "$DEV/venv/bin/python" _migrate_rdbms.py | tail -3)
fi

start() { # name, pid file, command...
	local name=$1 pidfile="$DEV/$1.pid"
	shift
	if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then return; fi
	echo "[dev] starting $name"
	(cd "$REPO/game" || exit 1; nohup "$@" >"$DEV/logs/$name.log" 2>&1 </dev/null & echo $! >"$pidfile")
}
start web node main.js
start game node node/server.js local

for i in $(seq 1 60); do
	curl -fs -o /dev/null http://127.0.0.1:8090/ && grep -q "Calculations took" "$DEV/logs/game.log" 2>/dev/null && break
	sleep 1
done
curl -fs -o /dev/null http://127.0.0.1:8090/ || { echo "[dev] web server didn't come up - see $DEV/logs/web.log"; exit 1; }

if [ ! -f "$DEV/cookie" ]; then
	node "$REPO/scripts/dev/seed-account.js" | tee "$DEV/seed.log"
	grep -o 'auth=[^ ]*' "$DEV/seed.log" | tail -1 >"$DEV/cookie"
fi

echo "[dev] up: http://127.0.0.1:8090  (login: tester / tester)"
echo "[dev] cookie: $(cat "$DEV/cookie")"
echo "[dev] logs: $DEV/logs"
