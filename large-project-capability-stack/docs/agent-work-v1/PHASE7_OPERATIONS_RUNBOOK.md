# Agent Work v1 Phase 7 operations runbook

Status: Phase 7 candidate runbook. This document supports operations/security/remote-deployment readiness only. It is not a release, scale-tier, soak, full-parity, or production-deployment claim.

## Boundary

- Control plane: `/root/clawd` on the OpenClaw host.
- Execution plane: `jake@37.27.129.239:/home/jake/clawd-remote` (`clawd-exec-hel1`).
- Heavy tests, long-running qualification, and worker farms run on Hetzner.
- Chat/control-plane host remains responsible for supervision, status synthesis, and lightweight notifications.
- Notifications must stay outside the heavy runner so a runner crash can still produce a blocker notification.

## Phase 7 acceptance matrix

| Gate | Required evidence | Blocking condition |
|---|---|---|
| Execution-plane install/doctor | install manifest + live remote doctor | missing Node/npm/rsync/Codex path, root user, missing workspace/public Cortex context, low disk |
| Heartbeat/log/artifact sync | heartbeat packet with log rotation, artifact return path, disk/budget alarms | stale heartbeat, logs unbounded, no artifact return path, alarm disabled |
| Emergency stop/drain/cancel/resume | control-plane separation packet | no emergency stop, no drain, cancel not durable, resume skips remote reconciliation |
| Notifier separation | notifier-loss and runner-loss fixtures | notifier loss changes truth; runner loss cannot write blocker/notify |
| Security fixtures | path/command/secret malicious fixtures | path escape, shell/network command, unredacted secret survives |
| Backup/restore | state backup + fresh-checkout runbook + artifact list | backup missing/unhashed, replay not green, fresh-checkout procedure missing |
| Remote qualification | focused/full tests on Hetzner + sync hash proof | remote tests red or selected-file hash mismatch |

## Standard preflight

Run from the control plane:

```bash
ssh -o BatchMode=yes jake@37.27.129.239 'set -euo pipefail; export PATH=/home/jake/.local/bin:$PATH; hostname; id -un; node -v; npm -v; command -v rsync; command -v codex; df -h /home/jake/clawd-remote'
```

Expected:

- host is `clawd-exec-hel1`;
- user is `jake`, not `root`;
- Node and npm are present;
- rsync is present;
- Codex is present when `/home/jake/.local/bin` is on PATH;
- `/home/jake/clawd-remote` exists with sufficient disk;
- `public/cortex_server` is linked into the qualification root when legacy compatibility tests require it.

## Sync and qualification pattern

1. Create a timestamped remote root under `/home/jake/clawd-remote/qualification/agent-work-phase7-<timestamp>`.
2. Sync the stack source excluding `.git`, `node_modules`, local `artifacts`, and caches.
3. Link `/home/jake/clawd-remote/public` into the qualification root as `public` when tests depend on Cortex context.
4. Run focused Phase 7 tests on Hetzner.
5. Run full `npm test` on Hetzner.
6. Run `BENCHMARK_HOST_ROLE=execution_plane node apps/agent-work/cli.mjs doctor --execution-plane --json` on Hetzner.
7. Pull artifacts back to the control plane.
8. Compare selected-file SHA256s between local and remote.
9. Write `operations_readiness_packet.json`, `surface_matrix.json`, and remote proof artifacts.

## Emergency stop and graceful drain

Minimum procedure:

1. Write an operator stop marker in the run artifact root.
2. Stop admitting new leases.
3. Let currently running workers finish only if their leases remain current.
4. Fence stale leases.
5. Preserve worker evidence before cleanup.
6. Run independent verification only on admitted patch bundles.
7. Write either terminal blocker or exact allowed operations claim.

Stop/drain does not grant completion credit.

## Cancel and resume

Cancel must append a durable runtime event and preserve artifacts.

Resume must:

1. Rebuild runtime projection from JSONL/SQLite.
2. Reconcile remote heartbeat and unknown remote state.
3. Expire stale leases.
4. Recheck budgets/disk before launching new workers.
5. Continue only if no blocker is present.

## Backup/restore

A recovery runbook is valid only if it can start from:

- fresh source checkout or synced source digest;
- backed-up `run.db` / WAL state or replayable JSONL events;
- returned artifacts and manifests;
- documented commands;
- no chat memory.

Required Phase 7 artifacts:

- `operations_readiness_packet.json`
- `surface_matrix.json`
- remote test summary
- remote sync hash proof
- backup/restore packet

## Truth boundary

Phase 7 green means operations/security/remote-deployment readiness is proven for the supplied qualification evidence.

It does **not** mean:

- Agent Work v1 is released;
- 12 physical workers are proven;
- a six-hour soak passed;
- cross-repo qualification passed;
- full parity/full clone is proven;
- production deployment is complete.
