Cortex auto-commit helper

Script: `scripts/autocommit-cortex.sh`

Current design
- works from `/root/clawd`
- exports only Cortex-scoped files into a clean mirror repo at `/root/clawd/.cortex-export`
- commits and pushes the clean mirror to the GitHub Cortex repo
- uses a stable manifest only; no per-run timestamps are written into tracked export files

Why this design exists
- the main `/root/clawd` git history contains unrelated files and old secret-bearing history
- GitHub push protection blocks direct pushes from that history
- a clean export repo avoids dragging dirty history into `jakehase/Cortex`

Exported paths
- `plugins/cortex-route-gate`
- `plugins/cortex-memory-bridge`
- `plugins/cortex-browser-bridge`
- `scripts/cortex-upgrade-selftest.mjs`
- `docs/CORTEX_*.md`
- `docs/cortex_*`

Defaults
- remote URL: `https://github.com/jakehase/Cortex.git`
- branch: `openclaw-sync`
- clean mirror dir: `/root/clawd/.cortex-export`

Usage
- `./scripts/autocommit-cortex.sh`
- override branch: `GIT_BRANCH=main ./scripts/autocommit-cortex.sh`
- override export dir: `EXPORT_ROOT=/tmp/cortex-export ./scripts/autocommit-cortex.sh`

Result
- only Cortex-scoped files are committed
- the push is made from a clean export history, not the dirty workspace history
