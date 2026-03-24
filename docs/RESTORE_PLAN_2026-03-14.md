# OpenClaw restore plan — 2026-03-14

## What went wrong

The previous restore used a backup labeled:

- `cortex-auto-backup-20260314_021001.tar.zst`

But VM102's own restored backup log shows:

- `2026-03-13T02:10:14Z` → **created** `cortex-auto-backup-20260313_021001.tar.zst`
- `2026-03-14T02:10:01Z` → only **creating** `cortex-auto-backup-20260314_021001.tar.zst`
- there is **no** matching `created ...20260314_021001.tar.zst`

So the Mar 14 archive should be treated as incomplete/interrupted.

## Best restore source

Best most recent **completed** VM102 backup:

- `/opt/clawdbot/backups/cortex-auto-backup-20260313_021001.tar.zst`

Important:

- that archive is **not currently present on CT101**
- the currently staged tree at
  - `/root/recovery/vm102-openclaw-state-20260313-2110/openclaw_state`
  is **not** a seamless restore source because it is missing a top-level `credentials/`
  directory

## Local safety anchor

Fresh official verified CT101 rollback backup created before any new restore work:

- `/root/recovery/2026-03-14T18-39-53.644Z-openclaw-backup.tar.gz`

Use this only as a rollback/safety anchor, not as the target VM102 restore.

## Official OpenClaw guidance this plan follows

From `docs/install/migrating.md`:

- stop the gateway before copying so files are not changing mid-copy
- migrate/restore the **entire** `$OPENCLAW_STATE_DIR`
- do **not** copy only `openclaw.json`
- run `openclaw doctor`
- then restart the gateway
- ensure ownership matches the user running the gateway

## Restore policy

### Allowed

- restore a **full** OpenClaw state tree as one unit
- validate archive contents offline first
- run `openclaw doctor --non-interactive`
- restart only inside a guarded script with rollback

### Not allowed

- no piecemeal copy into live `~/.openclaw`
- no restore from the incomplete Mar 14 VM102 archive
- no promote of the current staged `openclaw_state` tree as-is
- no restart without an automatic rollback path

## Recommended workflow

### Path A — preferred

1. Get this exact file onto CT101:
   - `cortex-auto-backup-20260313_021001.tar.zst`
2. Validate it **offline** with the dry-run restore script:
   - `scripts/openclaw-safe-restore.sh --source-archive /path/to/cortex-auto-backup-20260313_021001.tar.zst`
3. Confirm the dry-run reports a full state tree, especially:
   - `credentials/`
   - `identity/`
   - `agents/`
   - `workspace/`
   - `openclaw.json`
4. Only then run the guarded live restore:
   - `scripts/openclaw-safe-restore.sh --source-archive /path/to/cortex-auto-backup-20260313_021001.tar.zst --execute`
5. Let the script:
   - create a fresh verified safety backup
   - stop gateway
   - swap `~/.openclaw` atomically
   - run `openclaw doctor --non-interactive`
   - start gateway
   - verify `Runtime: running` and `RPC probe: ok`
   - auto-rollback if verification fails

### Path B — fallback only if Path A is impossible

If the actual Mar 13 archive cannot be recovered, do **not** blindly restore the staged VM102 tree.

Why:

- the staged tree is missing `credentials/`
- it has an older `openclaw.json`
- promoting it directly already created a hybrid broken state once

If forced into fallback mode later, the right move is a **surgical repair plan**, not a blanket restore.
That would need a separate checklist and should be treated as a different operation.

## Detached execution note

A restart will interrupt the chat session. If/when live restore time comes, run the script detached from the chat turn, for example via a host shell or background exec, so the restore/rollback logic keeps running even if the session drops.

## Artifacts created during this investigation

- Script: `scripts/openclaw-safe-restore.sh`
- This plan: `docs/RESTORE_PLAN_2026-03-14.md`
- Safety backup: `/root/recovery/2026-03-14T18-39-53.644Z-openclaw-backup.tar.gz`
