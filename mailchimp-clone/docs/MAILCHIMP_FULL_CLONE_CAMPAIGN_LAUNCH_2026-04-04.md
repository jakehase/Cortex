# Mailchimp full-clone campaign launch — 2026-04-04

## Launch contract
- **Anchor:** `docs/MAILCHIMP_FULL_AUDIT_2026-04-04.md`
- **Checklist:** `docs/MAILCHIMP_FULL_AUDIT_GAP_CLOSURE_CHECKLIST_2026-04-04.md`
- **Target path:** `/root/clawd/mailchimp-clone`
- **Requested fidelity:** `full_clone`
- **Current truth at launch:** `parity_for_scope`
- **Stop condition:** `supervisor_green_or_blocker_report`

## Scope in this campaign
This campaign covers the full audited gap set:
- A. Public brand + marketing parity
- B. Frontend architecture parity
- C. Data model + persistence parity
- D. Delivery + jobs + operational workflow parity
- E. Reporting + analytics parity
- F. AI / predictive / optimization parity
- G. Integrations + API + OAuth parity
- H. Website builder parity
- I. Forms / popup forms / landing pages parity
- J. Campaign experimentation parity
- K. Automation / journey parity
- L. Audience / CRM / segmentation parity
- M. Security / account / enterprise parity
- N. Ops / deployment / scale parity
- O. Final parity proof gate

## Runtime roles
- **Worker:** `scripts/full-audit-campaign-worker-100-agent.mjs` delegating to the proven real-repo orchestrator path in `scripts/real-repo-100-agent-expansion-campaign.mjs`
- **Supervisor:** `scripts/full-audit-campaign-supervisor.mjs`
- **Watcher:** `scripts/full-audit-campaign-watch.mjs`

## Machine-readable state
- Contract: `strict_1to1_contract.json`
- Surface matrix: `artifacts/full_audit_campaign/surface_matrix.json`
- Program state: `artifacts/full_audit_campaign/program_state.json`
- Worker state: `artifacts/full_audit_campaign/worker_state.json`
- Summary: `artifacts/full_audit_campaign/completion_summary.json`
- Notification state: `artifacts/full_audit_campaign/notification_state.json`
- Blocker report: `artifacts/full_audit_campaign/blocker_report.json`
- Cortex-owned transport state: `artifacts/full_audit_campaign/cortex_transport/transport_status.json`
- Cortex-owned event stream: `artifacts/full_audit_campaign/cortex_transport/session_events.jsonl`
- Thread-binding readiness probe: `artifacts/full_audit_campaign/cortex_transport/thread_binding_probe.json`

## Launch truth
At launch, the campaign is expected to be **red** until the audited gaps are actually closed. A green state is only valid when the supervisor confirms the matrix is fully complete or a structured blocker report exists.

## Important update after truthful cleanup
The earlier wave6 / LOC-inflation delegate path was intentionally stopped and quarantined after the repo was cleaned back to a truthful baseline. Future 100-agent work should follow `docs/MAILCHIMP_FULL_CLONE_REPLAN_CLEAN_BASELINE_2026-04-04.md` instead of resuming the old wave6 delegate.
