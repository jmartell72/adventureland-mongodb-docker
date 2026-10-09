#!/bin/bash
# Claude Code cloud sessions only (wired up in .claude/settings.json): make a
# fresh container ready to run the game with scripts/dev/up.sh. Installs the
# MongoDB server binaries if missing and the npm dependencies for both
# processes. Safe to run repeatedly.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
MONGO=mongodb-linux-x86_64-ubuntu2204-7.0.14

if ! command -v mongod >/dev/null; then
	curl -fsSL "https://fastdl.mongodb.org/linux/$MONGO.tgz" | tar -xz -C /opt
	ln -sf /opt/$MONGO/bin/* /usr/local/bin/
fi

[ -d "$REPO/game/node_modules" ] || (cd "$REPO/game" && npm install --omit=dev --no-audit --no-fund >/dev/null)
[ -d "$REPO/game/node/node_modules" ] || (cd "$REPO/game/node" && npm install --omit=dev --no-audit --no-fund >/dev/null)
[ -d "$REPO/scripts/dev/node_modules" ] || (cd "$REPO/scripts/dev" && npm install --no-audit --no-fund >/dev/null)
echo "Dev environment ready: run scripts/dev/up.sh to start the game."
