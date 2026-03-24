# Cortex Automation Matrix (2026-02-19)

This pass automated recurring operational work so Cortex can run with minimal manual intervention.

## New automation controller
- Script: `scripts/auto_ops.sh`
- Tasks:
  - `health_guard` (2-min monitor + conservative self-heal restart after 3 consecutive failures, with cooldown)
  - `backup` (daily compressed backup + checksum + retention pruning)
  - `ci_gate` (full CI gate with enforced replay)
  - `route_sanity` (cross-level routing contract checks)
  - `state_audit` (persistent-state presence checks)
  - `housekeeping` (old artifacts/log cleanup + stale backup cleanup)

## Existing automation retained
- `scripts/nightly_intelligence_checks.sh`
  - enforced replay + extended replay
  - appends summary to `docs/NIGHTLY_INTELLIGENCE_LOG.md`

## Scheduled automations (crontab)
- `*/2 * * * *` health guard
- `10 2 * * *` backup
- `20 3 * * *` nightly intelligence checks
- `35 3 * * *` CI gate
- `50 3 * * *` route sanity checks
- `05 4 * * *` housekeeping
- `20 4 * * 1` requirements lock refresh

## Persistence guarantees
- Nexus smartness state paths are now bind-mounted host config state:
  - `/opt/clawdbot/config/state/nexus_autotune_state.json`
  - `/opt/clawdbot/config/state/nexus_checkpoints.jsonl`
  - `/opt/clawdbot/config/state/nexus_referent_state.json`
- Survive container restart/recreate and VM reboot.

## Validation completed
- `auto_ops.sh state_audit` PASS
- `auto_ops.sh route_sanity` PASS
- `auto_ops.sh health_guard` PASS
- `auto_ops.sh backup` PASS (checksum generated)
- `auto_ops.sh ci_gate` PASS
