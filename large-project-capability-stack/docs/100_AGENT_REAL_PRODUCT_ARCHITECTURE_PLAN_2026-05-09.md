# 100-Agent Real Product Architecture Plan

Generated: 2026-05-09

## Anchor

The 100-agent Mailchimp production-slice product-diff endurance rung passed:

- 100 requested agents
- 100 observed agents / peak concurrency 100
- 100/100 shards merged
- real product-file diffs admitted on all 100 selected surfaces
- 30.14 minute endurance window
- no worker failures, timeouts, state-loss events, threshold failures, or truth conflicts

That proves the orchestration/admission plumbing can launch and sustain a 100-agent product-diff run. It does **not** prove real product architecture, functional parity, full-clone completion, or the ability to build a Mailchimp-scale app from a single objective.

## North star

Build a system that can take a large business/app objective — e.g. "build the real Mailchimp product class, not a simplified clone" — and run up to 100 agents continuously for long periods, producing cohesive, integrated, semantically meaningful product architecture until either:

1. the explicit product/parity surface matrix is green, or
2. a real blocker report explains why it cannot continue.

## Definitions

### Cohesive

Agents do not just edit 100 unrelated files. They work from one shared architecture blueprint, one dependency graph, one product surface matrix, and one integration queue. Their outputs compose into a single product.

### Continuous

The planner keeps replenishing executable work while the objective remains red. The system does not stop just because an initial backlog is exhausted. If no ready shards remain, it expands from the objective and negative-space audit.

### Real product architecture

A shard only counts if it advances a real product surface: data model, UI, API, workflows, persistence, jobs/events, integrations, auth/security, observability, migrations, tests, and user-facing behavior. Marker exports, placeholder files, syntax-only changes, and docs-only work do not count.

### One-shot

Not "one LLM response builds everything." It means one durable campaign launch with autonomous planning, decomposition, execution, verification, integration, and truth reporting until green or blocker.

## What is already proven

- Remote execution boundary works on VM102.
- Worker farm can reach 100 observed agents.
- Lease/timeout configuration can sustain 30-minute windows.
- Mechanical product-diff admission works at 100 selected surfaces.
- Artifact truth can distinguish threshold pass vs compressed pipe proof.
- Watcher/sync/report path can return final state cleanly.

## What is not yet proven

- Semantically meaningful architecture output at 100-agent scale.
- Continuous multi-hour productive throughput with dynamic replanning.
- Cross-agent cohesion: shared APIs, shared data model, no duplicate/incompatible systems.
- Integration and merge handling for large, real changes.
- Functional verifier green, browser/e2e green, database/job/integration green.
- Full Mailchimp-grade parity: rich client/editor, visual builders, journey runtime, CRM/warehouse realism, analytics pipelines, AI/provider systems, integrations, security, operational durability.
- One-shot business-program generation from a natural-language objective.

## Target architecture

### 1. Objective contract

Every major run starts with a contract containing:

- product objective
- fidelity: `prototype`, `production_slice`, `parity_for_scope`, or `full_clone`
- target app/business model
- explicit stop condition: `supervisor_green_or_blocker_report`
- non-negotiable product boundaries
- external constraints: stack, runtime, data layer, auth model, integration realism
- expected artifact roots and execution plane

### 2. Product blueprint

Before 100 implementation agents launch, architect agents produce a machine-readable blueprint:

- personas and jobs-to-be-done
- product areas/modules
- domain entities and lifecycle states
- data model and persistence plan
- API contracts
- UI routes/screens/components
- background jobs/events/queues
- integrations/provider contracts
- analytics/telemetry model
- security/authz/session/CSRF model
- testing strategy and acceptance gates

This blueprint becomes the authoritative source for planning and verification.

### 3. Surface matrix

The product objective is decomposed into a surface matrix with multiple truth layers:

- product areas
- user journeys
- backend services
- frontend screens/components
- data entities/migrations
- jobs/events
- integrations
- security controls
- observability
- tests/proofs

Each surface has:

- owner lane
- allowed files and expected files
- dependencies
- acceptance criteria
- required verifier class
- parity/quality expectations
- current status

### 4. Work unit schema

Every agent shard must include:

- exact surface id
- product goal
- architecture references from the blueprint
- allowed file set
- expected semantic changes
- integration points
- dependency assumptions
- tests/proofs to add or update
- anti-fluff admission criteria
- verifier commands
- rollback/retry metadata

### 5. Agent lanes

A 100-agent run should not be 100 identical coders. Use lanes:

- 3-5 principal architect agents: blueprint, contracts, data/API/UI architecture
- 5-10 planner/decomposer agents: maintain the ready queue and negative-space expansion
- 60-70 implementation agents: product vertical slices
- 8-12 integration/merge agents: reconcile shared interfaces, resolve conflicts, keep mainline coherent
- 8-12 verifier/QA agents: functional, API, browser, DB, security, integration, semantic audits
- 2-5 supervisor/truth agents: matrix truth, fake-green prevention, blocker classification

### 6. Continuous planning loop

The run operates as a loop:

1. Read objective + blueprint + matrix.
2. Select ready surfaces from the DAG.
3. Spawn bounded implementation shards.
4. Merge through an integration queue, not direct uncontrolled writes.
5. Run semantic/product verifiers.
6. Update matrix and artifact truth.
7. Run negative-space audit: what is still missing?
8. Generate new shards if objective remains red.
9. Continue until matrix green or blocker report.

## Real-product admission gates

The current deterministic metadata-patch mode proved admission mechanics. The next system needs a semantic product gate.

A shard counts only if all required gates pass:

### Product diff gate

- modifies real product paths, not docs/scripts/artifacts only
- no benchmark marker exports or placeholder-only files
- meaningful AST-level additions or behavior changes
- no excessive repetition/generated filler
- not concentrated in one dumping-ground file unless architecturally justified

### Architecture fit gate

- references blueprint surface id
- uses established data/API/component contracts
- does not create duplicate incompatible systems
- respects dependency graph
- updates contracts if it changes shared interfaces

### Functional gate

Depending on surface type:

- API route test or request proof
- frontend/browser proof or screenshot proof
- DB migration/read-write proof
- background job/event proof
- integration/provider mock or sandbox proof
- auth/security proof
- telemetry/analytics proof

### Integration gate

- merge applies cleanly
- no broken imports
- relevant tests pass
- app starts where applicable
- shared contracts remain compatible

### Truth gate

- mechanical green is not completion
- threshold pass is not product parity
- product parity requires the surface matrix to be green against the requested fidelity

## Mailchimp-grade target shape

To approximate real Mailchimp-class complexity, the target should not be one server-rendered toy app. It needs at least:

- rich frontend app shell
- drag/drop email editor architecture
- visual website/landing-page builder
- customer/audience CRM and segmentation model
- automation/journey builder and runtime
- campaign creation/scheduling/delivery workflow
- template/content asset system
- ecommerce/revenue attribution
- reporting/analytics pipelines
- integrations/provider framework
- AI/predictive layer with provider abstraction
- auth/session/security/permissions program
- database persistence and migrations, not JSON-file persistence
- background jobs/workers/queues
- observability/audit logs
- import/export/compliance surfaces
- browser/e2e proof pack

## Implementation sequence

### Phase 0 — Freeze the honest baseline

Create a canonical capability statement:

- 100-agent orchestration/admission proven at production-slice source/syntax level.
- Real architecture generation not yet proven.
- Full Mailchimp parity not yet proven.

Artifact: `capability_statement.json` and markdown summary.

### Phase 1 — Replace marker admission with semantic product admission

Build a semantic product-diff verifier:

- AST/change classifier
- placeholder/filler detector
- architecture reference checker
- product-path and diff-depth scorer
- duplicate/repetition/concentration audit
- semantic evidence artifact per shard

Exit: 100-agent compressed pipe proof where marker-only changes are rejected and meaningful product changes are required.

### Phase 2 — Build the product blueprint + surface matrix generator

Input: large objective + target fidelity.

Output:

- blueprint JSON
- surface matrix JSON
- dependency DAG
- verifier plan
- first work queue
- negative-space checklist

Exit: deterministic blueprint/matrix for a Mailchimp-class app with hundreds to thousands of surfaces.

### Phase 3 — Build dynamic queue replenishment

The planner must continue when the initial work graph exhausts:

- inspect red matrix surfaces
- identify missing product architecture
- generate new grounded shards
- avoid duplicate work
- classify blockers vs retryable failures
- keep at least N ready shards while objective remains red

Exit: 100-agent 2-hour run with no dead gaps and measurable productive throughput.

### Phase 4 — Build integration/merge control

Add an integration controller:

- per-agent isolated worktrees
- patch queue grouped by contract/interface risk
- conflict resolver lane
- shared API/data contract locking
- mainline qualification gates
- rollback and retry semantics

Exit: 100-agent run with many real semantic product changes merged without corrupting architecture.

### Phase 5 — Build functional proof packs

Add verifier packs by surface class:

- browser/e2e for UI flows
- API request/contract tests
- DB migration/read-write tests
- job/queue/event tests
- integration provider mock/sandbox tests
- security/auth/session tests
- analytics/telemetry tests

Exit: production-slice runs can claim functional progress, not just source/syntax progress.

### Phase 6 — Run the first real 100-agent semantic architecture benchmark

Benchmark shape:

- 100 agents
- 100+ semantic product shards
- 30-60 minute target
- no marker patches
- every shard tied to blueprint and surface matrix
- semantic product admission required
- functional verifier required for a subset of critical slices

Exit: `thresholdPass=true`, semantic product score above threshold, no fake-green incidents.

### Phase 7 — Long-duration cohesion benchmark

Benchmark shape:

- 100 agents
- 4-8 hours
- dynamic replanning required
- integration lane required
- negative-space audit every cycle
- no idle gaps beyond configured threshold
- product matrix must materially reduce over time

Exit: continuous productive throughput proven, not just one-wave execution.

### Phase 8 — One-shot large-program benchmark

Benchmark shape:

- new empty or minimal repo
- objective: build a Mailchimp-class product program to a declared fidelity
- blueprint generated by system
- dynamic work queue generated by system
- 100 agents run until parity-for-scope green or blocker

Exit: demonstrate one durable launch can create a coherent large application/program from objective to verified product surfaces.

### Phase 9 — Full-clone/parity track, only after Phase 8

For a real Mailchimp-scale/full-clone attempt:

- build or import a detailed real-product surface inventory
- define explicit parity surfaces
- require browser/functional/product proofs
- require production-grade persistence/job/integration architecture
- treat unknown/missing surfaces as red, not ignored
- stop only on full matrix green or blocker

## Immediate next engineering task

Do **not** run another source/syntax benchmark as the main next step. The next useful step is:

> Build `semantic_product_admission` in the shared benchmark/orchestrator stack, then rerun a 100-agent pipe proof where marker-only changes are rejected and semantically meaningful product architecture changes are required.

Suggested first files:

- `large-project-capability-stack/packages/system-benchmark/index.mjs`
- `large-project-capability-stack/apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs`
- `large-project-capability-stack/apps/system-benchmark/live-transfer-worker.mjs`
- new helper: `large-project-capability-stack/apps/system-benchmark/verify-semantic-product-diff.mjs`
- tests: `large-project-capability-stack/tests/system-benchmark.test.mjs`

## Success metrics

### Orchestration metrics

- observedAgentCount = 100
- peakConcurrency = 100
- no worker timeouts/failures/state loss
- no dead-gap windows in ready/in-progress work
- queue replenishment rate keeps up with completions

### Product metrics

- semantic product score above threshold
- functional verifier pass rate above threshold
- architecture fit score above threshold
- duplicate/repetition/filler below threshold
- product surface matrix reduction per hour

### Cohesion metrics

- shared contract compatibility
- conflict rate and resolution time
- import/build health
- mainline qualification health
- no duplicate subsystem creation without architecture approval

### Truth metrics

- no fake-green incidents
- no conflation of orchestration pass with product parity
- blocker reports classify retryable/terminal/claim-blocking separately

## Recommended next action

Implement Phase 1 immediately: semantic product admission. Once that passes locally, run a compressed 100-agent semantic pipe proof, then a 30-minute semantic endurance rung. Only after that should the system attempt multi-hour continuous architecture work.
