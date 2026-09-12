# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim

# Private single-player fork: game source lives directly in this repo under
# game/ (vendored from adventureland_mongodb + common_engine +
# adventureland_secretsandconfig, with gameplay patches already applied —
# see game/README-FORK.md). MongoDB runs inside this same container since
# there's no scaling need for a solo instance.

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates gnupg curl python3 make g++ \
    && curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
        > /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mongodb-org \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY game/ ./

# Stash a pristine copy of secretsandconfig: in production it's bind-mounted
# to a persistent host directory (shadowing this build-time copy), so
# entrypoint.sh seeds it from here on first boot. Keys you add by hand there
# survive rebuilds since patch-config.js only ever mutates specific fields.
RUN cp -a secretsandconfig .secretsandconfig-template

RUN npm install --omit=dev \
    && cd node && npm install --omit=dev

RUN mkdir -p /data/db

COPY scripts/entrypoint.sh /app/entrypoint.sh
COPY scripts/patch-config.js /app/scripts/patch-config.js
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production \
    MONGODB_URI=mongodb://127.0.0.1:27017/adventureland?replicaSet=rs0 \
    GAME_SERVER_KEY=local

EXPOSE 8090 7192

ENTRYPOINT ["/app/entrypoint.sh"]
