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

# Private self-hosted server patches: this game ships two account-penalty
# systems (recurring "debuff" conditions) that only make sense for the
# official commercial release and actively hurt a private instance:
#   - drm_check: gates a Steam/Mac-App-Store ownership check; without that
#     integration configured, it permanently applies "Authorization
#     Failure" (-85% gold/luck, -20% xp) to every character.
#   - email verification: "Not Verified" (-25% gold/luck) never clears
#     because sending the verification email requires SES keys this
#     deployment doesn't have configured.
# Re-applied on every build since the repo is freshly cloned each time; the
# grep after each sed fails the build loudly if upstream ever changes these
# lines, instead of silently shipping an unpatched image.
RUN sed -i 's/drm_check: 1,/drm_check: 0,/' node/server.js \
    && grep -q 'drm_check: 0,' node/server.js \
    && sed -i 's/everification: random_string(12),/everification: random_string(12),\n\t\t\t\t\tverified: true,/' api.js \
    && grep -q 'verified: true,' api.js

# Shared engine, symlinked as ./common in the upstream dev setup — here it's
# just a real directory in the same spot, which the app code reads from.
RUN git clone https://github.com/kaansoral/common_engine.git common \
    && cd common && git checkout "$COMMON_ENGINE_REF"

# Config template, symlinked as ./secretsandconfig upstream. Ships with
# randomized dev defaults per its README; entrypoint.sh rewrites fields from
# env vars at container start (see scripts/patch-config.js). Stashed a second
# copy at .secretsandconfig-template: in production, secretsandconfig/ is
# bind-mounted to a persistent host directory (see docker-compose.prod.yml),
# which shadows this build-time clone, so entrypoint.sh seeds it from the
# template on first boot. Any keys you add by hand there (Stripe, Discord,
# etc.) survive rebuilds and restarts since patch-config.js only ever
# mutates specific fields, not the whole file.
RUN git clone https://github.com/kaansoral/adventureland_secretsandconfig.git secretsandconfig \
    && cd secretsandconfig && git checkout "$SECRETSANDCONFIG_REF" && rm -rf .git \
    && cd .. && cp -a secretsandconfig .secretsandconfig-template

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
