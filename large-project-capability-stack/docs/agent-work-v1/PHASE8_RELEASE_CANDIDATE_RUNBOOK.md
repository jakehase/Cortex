# Agent Work v1 Phase 8 release-candidate runbook

Status: Phase 8 candidate runbook. This document supports cross-repo qualification and release-candidate gating only. It is not Phase 9 release, public production deployment, universal/full parity, or 100-worker qualification.

## Boundary

- Control plane: `/root/clawd` on the OpenClaw host.
- Execution plane: `jake@37.27.129.239:/home/jake/clawd-remote` (`clawd-exec-hel1`).
- Heavy worker campaigns, cross-repo qualification, and six-hour soak run on Hetzner.
- The six-hour soak must run with production-quality and objective-truth gates enabled. Elapsed runtime/model churn over fewer than 12 changed product files, disabled gates, or shallow verifier-only green is blocker evidence rather than soak credit.
- Control-plane responsibilities: supervisor truth, status synthesis, notification, artifact consumption, and claim audit.
- External actions remain denied. Brownfield/PMHNP workers must not receive client data.

## Required qualification order

1. Deterministic no-model suite.
2. Real-worker bounded canary at 2-4 observed physical workers.
3. Restart/fault campaign at 8 observed physical workers.
4. Productive cross-repo campaign at 12 observed physical workers where 12-way low-overlap work exists.
5. Six-hour unattended soak with real worker activity across multiple waves.
6. Source sync, clean-room replay, release review, and claim audit.

## Required workload classes

| Workload class | Required evidence |
|---|---|
| Shared-stack self-dogfood | bounded real Agent Work product change with provenance and independent verification |
| AI OS/product-platform | nontrivial product/runtime surface with project-specific verifier evidence |
| Clone/parity slice | bounded Mailchimp slice with reference inventory, negative-space checks, product diff, provenance, and independent verification |
| Brownfield transfer | PMHNP denial-copilot or another approved brownfield repo, with no client data or external actions in worker context |

At least three workload classes must complete green. A fourth can be `blocked_with_specific_reason` only if the blocker proves a workload-specific external constraint rather than an Agent Work runtime defect.

## Evidence packets

Phase 8 writes:

- `artifacts/agent-work-v1/release-candidate/qualification_matrix.json`
- `artifacts/agent-work-v1/release-candidate/release_packet.json`
- workload packets for each workload class
- scale/duration packet
- fault/replay packet
- independent review packet
- remote proof and sync hash proof

## Scale and soak rules

- Requested/logical worker count does not count as physical-worker proof.
- Worker IDs must be observed from execution-plane worker/model-call evidence.
- Provider/model calls must be started and completed for the claimed physical scale.
- Provider-observed token usage must be positive.
- Six-hour soak must include positive implementation runtime and multiple waves.
- Verifier wait time, idle time, or process uptime does not count as coding time.

## Failure fixtures

Phase 8 fault/replay evidence must cover:

- controller restart
- worker loss
- verifier failure
- stale lease
- conflict
- provider error
- budget exhaustion
- disk pressure
- adversarial false-green attempts (`0` tolerated)
- clean-room replay from source plus artifacts

## Truth boundary

Phase 8 green means release-candidate qualification passed for the declared workload matrix and evidence.

It does **not** mean:

- Phase 9 release is complete;
- public production deployment occurred;
- universal/full parity is proven;
- 100 physical workers are proven;
- external writes are allowed;
- legacy paths are safe to delete.
