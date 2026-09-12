#!/bin/bash
# World data backup: dumps the whole adventureland database (accounts,
# characters, map data, everything) to a timestamped, gzip-compressed
# archive under /backups (bind-mount that to a host directory — see
# docker-compose.prod.yml). Keeps the last BACKUP_KEEP archives, deletes
# older ones. Safe to run while the server is live (mongodump takes a
# consistent snapshot).
set -euo pipefail

BACKUP_DIR="/backups"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/adventureland-$STAMP.archive.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] starting: $ARCHIVE"
mongodump --uri="mongodb://127.0.0.1:27017/adventureland?replicaSet=rs0" --archive="$ARCHIVE" --gzip
echo "[backup] done: $(du -h "$ARCHIVE" | cut -f1)"

# Prune: keep the newest $KEEP archives, delete the rest.
ls -1t "$BACKUP_DIR"/adventureland-*.archive.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
	echo "[backup] pruning old archive: $old"
	rm -f "$old"
done
