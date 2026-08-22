# Cortex → GitHub Public Sync (Fail-Closed)

This repo is configured as a **public-safe export mirror** of `/opt/clawdbot`.

## Safety model

- Git tracking is fail-closed (`.gitignore` ignores everything by default).
- Only these tracked paths are allowed:
  - `public/**` (generated export)
  - `sync/**` (automation scripts)
  - `.gitignore`
  - `README_PUBLIC_SYNC.md`
- Export scope is strict allowlist in `sync/export_allowlist.txt`.
- Pre-commit/push secret scan runs via `sync/scan_public_secrets.py`.
- If scan fails, sync aborts and nothing is pushed.

## Manual commands

```bash
# Run one safe sync pass (commit+push if origin configured)
/opt/clawdbot/sync/cortex_git_sync.sh

# Preview only (no commit/push)
/opt/clawdbot/sync/cortex_git_sync.sh --dry-run
```

## PM2 supervision

```bash
pm2 start /opt/clawdbot/sync/pm2.ecosystem.config.cjs
pm2 save
pm2 status
```

## Disable / rollback

```bash
# Disable autosync without uninstalling
touch /opt/clawdbot/.autosync-disabled

# Re-enable
rm -f /opt/clawdbot/.autosync-disabled

# Stop/remove supervisor
pm2 stop cortex-git-autosync
pm2 delete cortex-git-autosync
```

## One-command GitHub cutover

After you provide token + repo:

```bash
GITHUB_TOKEN='YOUR_TOKEN' GITHUB_REPO='owner/repo' \
  /opt/clawdbot/sync/setup_github_cutover.sh
```

Then autosync pushes to `origin` automatically.
