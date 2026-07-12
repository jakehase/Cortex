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

- reads the authoritative local or SSH-hosted JSON state;
- sends terminal states directly through `openclaw message send`;
- records delivery only after the send succeeds;
- uses an atomic delivery ledger to deduplicate retries;
- keeps following the state after a delivery so a later rerun can report a new blocker or completion;
- runs on the control plane, independently of the heavy runner.

Use `--once --dry-run` to validate routing and payloads without sending. For long jobs, install an enabled systemd service so monitoring survives shell and agent-session exits. The Cortex hardening continuation reference unit is at `deploy/systemd/cortex-hardening-continuation-v18-notifier.service`.
