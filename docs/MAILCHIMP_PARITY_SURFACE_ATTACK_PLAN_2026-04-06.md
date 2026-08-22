# Mailchimp parity surface attack plan — 2026-04-06

## Reply anchor
Jake asked for a concrete surface-by-surface implementation attack plan after the remediated architecture produced an honest partial result.

## Objective grounding
- **Anchor:** current remediated Mailchimp parity run under the run-id aware / disposable-worktree architecture
- **Target path:** `/root/clawd/mailchimp-clone`
- **Execution plane:** VM102 disposable worktrees under `/home/jake/clawd-remote/mailchimp-runs/<run_id>/repo`
- **Fidelity target:** `full_clone`
- **Stop condition:** top-level Mailchimp parity supervisor reaches `green` with `matrixStatus=all_complete`, or a run-scoped real blocker is written

## Current remaining surfaces
The remediated run still leaves these surfaces partial:
- `C_data_model_and_persistence_parity`
- `E_reporting_analytics_parity`
- `F_ai_predictive_optimization_parity`
- `G_integrations_api_oauth_parity`
- `H_website_builder_parity`

## Dependency order
The next runs should not treat these as five independent surfaces. The dependency order is:
1. **C persistence**
2. **E reporting + F predictive**
3. **G integrations**
4. **H website builder**

Why:
- Reporting and predictive are downstream of durable state shape and persistence correctness
- Integrations depend on durable installation / sync state
- Website builder parity is partially browser-safe already, but still depends on stable persistence + route/data semantics

## Surface C — data model and persistence parity
### Goal
Close the underlying persistence mismatch so implementation runs stop failing early and downstream surfaces can validate against stable state.

### Primary target files
- `packages/app/storage.mjs`
- `packages/app/security.mjs`
- `packages/app/domain-growth.mjs`
- `apps/web/server.mjs`
- `packages/app/persistence-io.mjs`
- `packages/app/http-runtime.mjs`

### Required invariants
- legacy fallback remains `app.json`
- `persistState(state)` exists and is used consistently where state writes are intended
- no generated imports/calls mismatch (`persistState` vs aliased names)
- runtime/storage helper extraction must not change observable state shape unexpectedly

### Acceptance gates
- generator regression suite green
- `tests/security-ops-hardening.test.mjs` green
- `tests/current-product-parity.test.mjs` green
- full repo suite green on VM102 baseline after applying the persistence-focused patch set

### Mechanical proof of closure
Surface C only flips when:
- promoted diff includes the persistence target files above
- current run canonical summary remains non-blocked
- top-level surface matrix marks `C_data_model_and_persistence_parity=complete`

## Surface E — reporting and analytics parity
### Goal
Move reporting parity from heuristic/partial to product-surface complete once persistence is stable.

### Primary target files
- `packages/app/domain-campaigns.mjs`
- `packages/app/domain-current-product-ops.mjs`
- any reporting/analytics route files under `packages/app/routes/`

### Focus
- campaign/report metrics derived from stable persisted state
- remove simplistic/fabricated summary formulas that do not correspond to product behavior
- ensure analytics/reporting surfaces are validated through product tests, not inferred from changed files alone

### Acceptance gates
- `tests/current-product-parity.test.mjs` green
- any reporting-specific route/domain tests green
- no persistence regressions introduced

### Mechanical proof of closure
Surface E only flips when:
- reporting/campaign domain files are present in promoted diff
- top-level surface matrix marks `E_reporting_analytics_parity=complete`

## Surface F — AI and predictive optimization parity
### Goal
Close predictive/AI parity once stable persisted audience/campaign state is trustworthy.

### Primary target files
- `packages/app/domain-current-product-ops.mjs`
- `packages/app/ai-provider.mjs`
- `packages/app/predictive-model.mjs`
- related audience/campaign route files if predictive data is surfaced there

### Focus
- keep predictive logic behind extracted helpers/providers
- avoid fabricated helper exports that regress CRM/audience semantics
- preserve deterministic testability while increasing parity depth

### Acceptance gates
- generator regression suite green
- `tests/current-product-parity.test.mjs` green
- no audience/persistence regressions introduced

### Mechanical proof of closure
Surface F only flips when:
- promoted diff includes predictive/AI files
- top-level surface matrix marks `F_ai_predictive_optimization_parity=complete`

## Surface G — integrations / API / OAuth parity
### Goal
Move integrations from placeholder/fabricated sync behavior to provider-backed, parity-oriented flows.

### Primary target files
- `packages/app/domain-integration-marketplace.mjs`
- `packages/app/integration-provider.mjs`
- `packages/app/routes/integrations-marketplace.mjs`

### Focus
- provider-backed sync path instead of fabricated counts
- durable installation/sync run state
- OAuth installation paths must survive persistence/runtime refactors

### Acceptance gates
- generator regression suite green
- `tests/current-product-parity.test.mjs` green
- any integration-marketplace route/domain tests green

### Mechanical proof of closure
Surface G only flips when:
- promoted diff includes integration domain/provider files
- top-level surface matrix marks `G_integrations_api_oauth_parity=complete`

## Surface H — website builder parity
### Goal
Advance builder parity beyond browser-safety baseline into full builder behavior parity.

### Primary target files
- `packages/app/domain-website-builder.mjs`
- `apps/web/public/app-shell.css`
- related builder-facing routes under `packages/app/routes/`

### Focus
- preserve browser-safe builder overlay behavior
- add/validate revision-aware builder flows (undo/redo/history if present in product model)
- avoid intercepting UI or breaking browser realism while expanding builder semantics

### Acceptance gates
- `tests/browser-realism.test.mjs` green
- `tests/current-product-parity.test.mjs` green
- no browser-baseline drift between baseline refresh and implementation launch

### Mechanical proof of closure
Surface H only flips when:
- promoted diff includes builder domain/UI files
- browser realism remains green after promotion
- top-level surface matrix marks `H_website_builder_parity=complete`

## Recommended run strategy
### Run 1 — Persistence-only attack
- constrain implementation emphasis to Surface C
- require top-level diff proof touches only persistence/runtime/supporting files
- do not chase downstream surfaces yet

### Run 2 — Reporting + predictive
- only after C flips green
- target E and F together because they share campaign/audience state dependencies

### Run 3 — Integrations
- target G once persistence and predictive/reporting are stable enough to hold sync/install state

### Run 4 — Website builder
- target H after persistence is solid and browser baseline remains stable

## Run-level discipline
For each run:
- baseline refresh proof must be green first
- generator preflight must be green first
- run id must be current and canonical artifacts must exist
- promoted patch manifest must show the exact changed product files
- surface closure is accepted only from run-scoped canonical summary + top-level surface matrix, not from ad hoc inference

## What not to do
- do not reopen the old shared-baseline/shared-artifact architecture
- do not run generic parity attempts without naming the target surfaces
- do not claim surface completion from file edits alone
- do not mix stale qualification artifacts with current implementation scoring

## Success criteria
This attack plan is working when each run can be described like this:
- target surfaces: explicit
- changed product files: explicit
- promoted patch manifest: explicit
- canonical run summary: explicit
- surface matrix delta: explicit
- remaining surfaces: explicit

That is the path from “stable 100-agent system” to “trustworthy 1:1 parity closure.”
