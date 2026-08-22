# Architecture

Monorepo layout:
- `apps/` runnable CLIs, supervisors, watchers, notifiers
- `packages/` reusable core libraries for contracts, runtime, parity, certification, and recovery
- `tests/` unit and script/integration coverage
- `docs/` human guidance and qualification reports
- `artifacts/` machine-readable campaign outputs

Core truth-gating packages:
- `packages/campaign-runtime` — persistent campaign state, worker iterations, requeue semantics, blocker-aware stop rules
- `packages/architecture-enforcer` — baseline repo hygiene plus claim-sensitive architecture budgets
- `packages/parity-harness` — HTTP, fixture, and browser-adapter evidence modes with mechanical downgrade flags
- `packages/certification` — evidence-weighted claim ladder and machine-readable certification artifacts
- `packages/surface-matrix` — surface checklist compiler and supervisor truth derivation

Boundary rules enforced by `packages/architecture-enforcer`:
- required top-level monorepo folders must exist
- no oversized single-file collapse in executable source
- package code may not reach directly into another package's internal source through sibling traversal
- architecture budgets evaluate whether a repo is plausible for `production_slice`, `scoped_parity`, `full_clone_credible`, `large_product_replica`, or `real_world_indistinguishable`

Qualification target:
- `/root/clawd/mailchimp-clone`
- qualification artifact root: `artifacts/qualification/mailchimp_full_clone_truth/`

Design intent:
- local green is not enough for strong clone claims
- a campaign may finish `scoped_completion_green` while still being denied `full_clone_credible`, `large_product_replica`, and `real_world_indistinguishable`
- lack of real browser automation evidence must remain mechanically visible in the artifact trail
- the top-tier path compiler should be able to explain, mechanically, what remains between scoped parity and real-world indistinguishability
