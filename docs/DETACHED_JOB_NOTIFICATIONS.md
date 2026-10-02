# Detached job notifications

Detached and remote jobs must not rely on an exec-completion wake for user-visible delivery. A completion wake may queue a system event without sending a chat message.

Use the control-plane notifier:

```bash
python3 /root/clawd/scripts/detached_job_notifier.py \
  --ssh-host user@execution-host \
  --state-file /absolute/path/to/state.json \
  --job-label "Human-readable job name"
```

The default route is read from the private, mode-0600 file:

```text
/root/clawd/state/notification-routing/default.json
```

The notifier:

- reads an authoritative local or SSH-hosted `cortex.detached-job-terminal.v2` JSON state;
- validates the immutable job/run identity, UTC completion time, terminal sequence, verification result, and truth boundary;
- for successful states, verifies the named artifact's SHA-256 before rendering success wording;
- accepts delivery only after a versioned positive sender acknowledgement containing a message ID;
- durably records a pre-send attempt and fences an uncertain outcome from automatic resend;
- keys deduplication on the run, terminal revision, and verified artifact identity;
- keeps following the state after a delivery so a later rerun can report a new blocker or completion;
- optionally requires a terminal state to remain unchanged through `--terminal-grace-seconds`, suppressing transient blockers that recover automatically;
- runs on the control plane, independently of the heavy runner.

A successful terminal state has this minimum shape (the digest must match the local or remote file):

```json
{
  "schemaVersion": "cortex.detached-job-terminal.v2",
  "jobId": "hardening",
  "runId": "run-20260822-001",
  "status": "completed",
  "completedAt": "2026-08-22T23:00:00Z",
  "terminalSequence": 1,
  "verificationPassed": true,
  "artifactManifest": {
    "path": "/absolute/path/to/result.json",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "truthBoundary": "The named result artifact was verified; deployment was not performed."
}
```

Failed and blocked states require `verificationPassed: false` plus a non-empty `blocker`, `error`, or `reason`; an artifact manifest is optional for those states. The default freshness window is 24 hours and can be reduced with `--max-state-age-seconds`.

Use `--once --dry-run` to validate routing and payloads without sending or changing the ledger. If the ledger reports `delivery_outcome_uncertain`, reconcile the pending attempt with the provider before removing it; automatic retry is intentionally blocked to prevent a crash-window duplicate. Only configure `--sender-idempotency-flag` when the installed sender documents that exact long option.

For long jobs, install an enabled systemd service so monitoring survives shell and agent-session exits. Set a terminal grace period (the Cortex hardening reference unit uses 120 seconds) so only persistent terminal states interrupt the user. The reference unit is at `deploy/systemd/cortex-hardening-continuation-v18-notifier.service`.
