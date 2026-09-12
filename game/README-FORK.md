# This is a private fork

`game/` is a vendored, one-time merge of three upstream repos, forked for a private
single-player instance. It is **not** a git submodule and does **not** auto-update — the
GitHub Actions build/push pipeline only rebuilds when this repo's own `main` changes.

Forked from:

| Repo | Commit |
|---|---|
| [adventureland_mongodb](https://github.com/kaansoral/adventureland_mongodb) | `ddcf7222c3264f1404382e1ff5dea8e73f6cb4b4` |
| [common_engine](https://github.com/kaansoral/common_engine) (vendored into `common/`) | `fa74fabf5d3782503712621e037bfb934ecb8439` |
| [adventureland_secretsandconfig](https://github.com/kaansoral/adventureland_secretsandconfig) (vendored into `secretsandconfig/`) | `6b3493be30abe367cfaf879a2d5ad370742e0866` |

## Picking up upstream changes

There's no automation for this anymore — it's a manual, reviewed step:

```sh
git remote add upstream-mongodb https://github.com/kaansoral/adventureland_mongodb.git
git fetch upstream-mongodb
git diff HEAD:game upstream-mongodb/main -- .   # review what changed
# merge in whatever you want by hand, re-apply patches below if upstream touched those lines
```

(Same pattern for `common_engine` into `game/common/` and `adventureland_secretsandconfig`
into `game/secretsandconfig/`, adjusting paths.)

## Gameplay patches already applied (vs. stock upstream)

- **`node/server.js`**: `drm_check` set to `0` (was `1`). Disables the Steam/Mac-App-Store
  ownership check, which otherwise permanently applies "Authorization Failure" (-85%
  gold/luck, -20% xp) to every character on a deployment with no Steam/MAS integration.
- **`api.js`**: signup now sets `verified: true` on the new user document. Otherwise "Not
  Verified" (-25% gold/luck) never clears, since clearing it requires clicking a link in an
  email this deployment has no SES keys configured to send.
- **`design/monsters.js`**: four scheduled "raid boss" events were built assuming many
  simultaneous attackers within a fixed time window (Franky is literally flagged
  `"cooperative":true`) and were unkillable solo at their original stats. Scaled down;
  XP/gold rewards untouched:

  | Event | HP: stock → forked | Attack: stock → forked |
  |---|---|---|
  | Goo Brawl (`rgoo`) | 1,000,000 → 50,000 | 320 (unchanged) |
  | Giga Crab (`crabxx`) | 960,000 → 50,000 | 16,000 → 1,500 |
  | Ice Golem (`icegolem`) | 16,000,000 → 500,000 | 2,400 (unchanged) |
  | Franky (`franky`) | 120,000,000 → 2,000,000 | 2,910 (unchanged) |

See `git log` on this file for the exact diffs and commit messages.
