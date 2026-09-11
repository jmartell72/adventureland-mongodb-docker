# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim

# Pinned to specific commit SHAs of the three upstream repos this game is
# split across (see upstream-refs.json). The check-upstream workflow updates
# these SHAs automatically and a rebuild picks up the new code.
ARG ADVENTURELAND_REF=main
ARG COMMON_ENGINE_REF=main
ARG SECRETSANDCONFIG_REF=main

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Main game repo (Express backend + game server source)
RUN git clone https://github.com/kaansoral/adventureland_mongodb.git . \
    && git checkout "$ADVENTURELAND_REF"

# Shared engine, symlinked as ./common in the upstream dev setup — here it's
# just a real directory in the same spot, which the app code reads from.
RUN git clone https://github.com/kaansoral/common_engine.git common \
    && cd common && git checkout "$COMMON_ENGINE_REF"

# Config template, symlinked as ./secretsandconfig upstream. Ships with
# randomized dev defaults per its README; mongodb_uri is rewritten at
# container start (see entrypoint.sh) to point at $MONGODB_URI.
RUN git clone https://github.com/kaansoral/adventureland_secretsandconfig.git secretsandconfig \
    && cd secretsandconfig && git checkout "$SECRETSANDCONFIG_REF"

RUN npm install --omit=dev \
    && cd node && npm install --omit=dev

COPY scripts/entrypoint.sh /app/entrypoint.sh
COPY scripts/patch-config.js /app/scripts/patch-config.js
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production \
    MONGODB_URI=mongodb://mongo:27017/adventureland \
    GAME_SERVER_KEY=local

EXPOSE 8090 7192

ENTRYPOINT ["/app/entrypoint.sh"]
