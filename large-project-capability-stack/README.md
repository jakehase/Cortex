# Large Project Capability Stack

Reusable execution substrate for giant supervised build campaigns.

Capabilities:
- Task contracts with explicit fidelity / scope / stop conditions
- Issue DAG + machine-readable surface matrix
- Persistent campaign runtime with worker requeue semantics
- Claim-sensitive architecture budget enforcement
- Evidence-weighted certification / claim ladder
- HTTP + browser-adapter parity evidence model
- Recovery ledger and qualification supervisor/watch/notifier flow
- Multi-agent scale orchestrator with shard planning, leases, context packs, merge gating, artifact-bus state, recovery, and simulator-backed scale qualification

Phase-2 truth hardening highlights:
- small repos can now be green for scoped completion without being certified as credible full clones
- claim strength is gated by evidence shape, not just local green status
- browser evidence is explicitly classified as real browser proof vs simulated/browser-adapter vs HTTP-only
- architecture budgets contribute to realism gating for large-project clone claims

Quick start:
- `npm test`
- `npm run qualification`
- `npm run qualification:orchestrator`

Important artifacts:
- qualification root: `artifacts/qualification/mailchimp_full_clone_truth/`
- orchestrator qualification root: `artifacts/qualification/multi_agent_orchestrator/`
- truth report: `docs/MAILCHIMP_REAL_WORLD_INDISTINGUISHABLE_TRUTH_REPORT_2026-04-02.md`
- multi-agent orchestrator report: `docs/MULTI_AGENT_SCALE_ORCHESTRATOR_REPORT_2026-04-02.md`
- top-tier path root: `artifacts/qualification/mailchimp_real_world_indistinguishable_path/`
- top-tier path report: `docs/MAILCHIMP_REAL_WORLD_INDISTINGUISHABLE_PATH_REPORT_2026-04-02.md`
- claim ladder + realism docs: `docs/TRUTH_GATING.md`
