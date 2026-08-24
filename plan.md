# Cortex q9 anti-regression operating contract

## Objective
Produce, qualify, deploy, and persist a Cortex q9 release that makes regressions difficult to ship, immediately visible, and safely reversible. The release must unify the immutable q8 source and operational overlay, eliminate live scope exclusions, expose layered attestation/capacity truth, add real shadow-scope canaries, and deploy atomically from read-only release directories.

## Active paths
- Control-plane artifact root: `/root/clawd/artifacts/cortex-anti-regression-q9-20260824T215704Z`
- Isolated source clone: `/root/clawd/artifacts/cortex-anti-regression-q9-20260824T215704Z/source`
- Production root (read-only inspection until guarded cutover): `/root/clawd`
- Heavy execution plane: `jake@37.27.129.239`
- Remote q9 workspace: `/home/jake/cortex-campaign-workspaces/cortex-anti-regression-q9-20260824T215704Z`

## Base identity
- q8 parent commit: `02491ba4370e28bd8bdd6520af6787e456da4c8a`
- accepted operational parent: `a090f551546200c21fec01fb69b01bf715d09ea8`
- authoritative remote: `https://github.com/jakehase/Cortex.git`

## Scope
1. Read-only capacity/quota diagnosis and safe graph-capacity remediation with backup and replay proof.
2. Complete deployed-surface inventory: source, plugins, units, config schemas/digests, AIOS, workers, watchdog, tunnel, notifier, mutable roots, remote refs.
3. A single q9 release envelope with file hashes, modes, source-vs-runtime classification, config templates, service contracts, provenance, and rollback metadata.
4. Layered `/system/attestation` truth: runtime, capacity, source integrity, security, provider, evidence freshness, rollback readiness, and remote persistence.
5. Real isolated canaries for memory store/retrieve, principal denial, provider routing/receipt, OpenClaw handoff, and explicitly confirmed external-action delivery.
6. Immutable release directories, read-only source, mutable state outside source, atomic current-pointer cutover, and exact rollback.
7. Remote full qualification, fault injection, live stage, burn-in, rollback drill, authoritative persistence, and contradiction audit.

## Non-goals
- No model-weight training.
- No safeguard bypass or automatic approval of AIOS promotion.
- No quota increase without capacity forensics, backup, retention/compaction policy, and headroom proof.
- No user-visible external action during canaries without an explicit confirmed and idempotent demo lane.
- No mutation of the q8 commit/tree or rewriting historical campaign evidence.

## Architecture
- **Release plane:** immutable `/opt/cortex/releases/<release-id>` plus atomic `/opt/cortex/current` pointer.
- **State plane:** `/var/lib/cortex`, `/var/log/cortex`, and `/run/cortex`; no runtime writes under release source.
- **Attestation plane:** signed/hash-bound machine-readable layer receipts with timestamps and independent statuses.
- **Canary plane:** shadow tenant/workspace/principal scopes with bounded TTL, cleanup receipts, and no production-data dependency.
- **Control plane:** this OpenClaw host performs discovery, approval-sensitive cutover, notifier supervision, and evidence reconciliation.
- **Execution plane:** Hetzner performs repo-scale suites, fault injection, package construction, and replay verification.

## Subsystem ownership
- Capacity and graph retention: q9 capacity controller + graph policy.
- Source/release provenance: release-envelope builder/verifier.
- Runtime/systemd deployment: atomic deployer and rollback controller.
- Security/principal isolation: existing scope HMAC/auth middleware plus negative canaries.
- AIOS/provider: frozen AIOS contracts; q9 reports freshness separately from runtime availability.
- OpenClaw/plugins/handoff: operational overlay integrated into q9 source and manifest.
- Observability: `/system/attestation`, capacity telemetry, notifier receipts.

## Agent/execution strategy
- Light inspection, source edits, config synthesis, and approval-sensitive actions stay on the control plane.
- Full Python/Node suites, fault injection, archive construction, and burn-in replay run on Hetzner after exact sync proof.
- No bare local Codex fallback. Model-backed delegation, if needed, uses `/root/clawd/scripts/codex-worker-launcher.mjs` with an integrity-bound result/handoff.
- Detached launchers require independent control-plane notification and authoritative state artifacts.

## Verifier/evidence contract
A gate is green only with a current artifact and replay command. Required layers:
1. exact source/envelope identity and zero unclassified files;
2. capacity headroom and quota admission;
3. Python, Node, schema, OpenAPI, and shell verification;
4. negative auth, injection, fail-closed, and race tests;
5. real shadow canaries with cleanup receipts;
6. isolated q9 stage and provider execution;
7. atomic deployment plus live runtime checks;
8. actual rollback and redeploy;
9. authoritative remote refs verified from a fresh anonymous clone;
10. final contradiction count zero.

## Artifacts and replay
- `state.json`: campaign state; never collapses truth layers.
- `capacity/`: read-only baseline, backup, remediation, and headroom receipts.
- `surface-envelope/`: manifest, config/unit contracts, provenance, mutable-root map.
- `qualification/`: remote suite/fault-injection outputs and source-integrity diff.
- `deployment/`: stage, cutover, burn-in, rollback, and redeploy evidence.
- `audit/`: gate matrix, remote verification, contradiction report.
- Every terminal artifact records exact commands or script paths needed to replay safely.

## Stop condition
Stop and roll back on any source mismatch, unclassified deployed surface, capacity below threshold, failed negative auth test, stale/invalid provider receipt, canary cleanup failure, service instability, rollback mismatch, remote divergence, or contradiction. Do not claim q9 green until all layers pass.

## Truth boundary
Planning is not implementation. Unit tests are not live proof. A passing stage is not production. Expired AIOS evidence is not a runtime outage, but it is not a current attestation. q9 green requires exact source, capacity, security, provider, live deployment, rollback, remote persistence, and experiential canary evidence to agree.

## Risks
- Current graph workspace row quota is exhausted and cleanup could destroy live knowledge if not fully classified/backed up.
- Production presently mixes q8 scope and operational overlay.
- Runtime history includes source-tree mutation by Chronos in the prior release shape.
- AIOS evidence has an intentional 15-minute freshness window.
- Local `/root/clawd` git state is heavily divergent and must not be used as q9 source.
- Systemd/config cutover can affect live Cortex/OpenClaw and requires exact preimages and independent recovery.

## Next milestone
Complete the live read-only capacity audit and complete deployed-surface manifest. Only then select a safe quota remediation and begin q9 source changes.
