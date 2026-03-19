Cortex GitHub sync status

Live branch
- `openclaw-sync`
- compare / PR URL: `https://github.com/jakehase/Cortex/compare/main...openclaw-sync`
- direct PR page: `https://github.com/jakehase/Cortex/pull/new/openclaw-sync`

Current state
- clean export push works from `/root/clawd/.cortex-export`
- direct PR creation via GitHub API is blocked by the current PAT scope (`Resource not accessible by personal access token`)

Automation added
- Gateway cron job: `cortex-auto-export-sync`
- cadence: every 5 minutes
- action: run `./scripts/autocommit-cortex.sh` from `/root/clawd`
- behavior: exports Cortex-scoped files only, commits clean mirror, pushes to `openclaw-sync`

Notes
- This avoids pushing dirty `/root/clawd` history, which contains old secret-bearing commits blocked by GitHub push protection.
- If the token later gets the right PR scope, PR creation can be automated too.
