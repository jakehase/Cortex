# Cortex Learning OS Plan

## Plan metadata

- Project slug: `cortex-learning-os`
- Plan owner: Jake + Cortex
- Created: `2026-07-07`
- Last updated: `2026-08-08`
- Status: `active_applied_math_transfer_qualification`
- Fidelity target: `parity_for_scope_representative_applied_math_transfer`
- Primary stop condition: `paired_canary_then_retention_integration_transfer_gates_green_or_precise_blocker`
- Status file: `STATUS.md`
- Decisions log: `DECISIONS.md`
- Plan index entry: `/root/clawd/docs/PLAN_INDEX.md`

## Companion lifecycle files

This `plan.md` is the stable operating contract. Keep current state and decisions in companion files:

```text
STATUS.md      # current checkpoint, latest verified commit/artifact, blockers, next 1-3 actions
DECISIONS.md   # append-only durable decisions and supersession notes
```

## 1. Working name

**Cortex Learning OS** (`cortex-learning-os`)

## 2. Decision summary

Build Cortex Learning OS as a production-slice platform for durable, verifier-gated learning on top of the existing Cortex/OpenClaw memory system. The first milestone is a working **Learning Capsule v0** contract plus a small math-domain exam harness that can prove the loop: curriculum → practice attempt → grading/verifier → mistake log → distilled lesson → promotion gate → retrieval pack. This plan does not claim the system has already become expert-level, does not modify model weights, and does not authorize live trading or external actions.

## 3. Core thesis / objective

What we are building:

- **Cortex Learning OS**: an operating layer that turns memory, practice, verifiers, feedback, and distillation into durable domain expertise capsules.

Why it matters:

- Current LLM sessions can reason well, but they do not reliably retain a long-lived learning trajectory.
- Cortex has memory and tool access, but needs a disciplined learning loop so experience compounds instead of becoming a pile of notes.
- A domain capsule should become more useful over time because it records examples, mistakes, corrections, verified lessons, and retrieval strategy.

Primary objective:

- Create a reusable system where Jake can say: **“Train Cortex on domain X until it can pass benchmark Y and perform task Z under verifier gates.”**

User/operator served:

- Jake, as the operator of Cortex/OpenClaw and future domain-specific expert capsules.

Desired outcome:

- A domain capsule can be bootstrapped, trained, tested, promoted, and used by Cortex in later work with explicit confidence and truth boundaries.

Why existing tools are insufficient:

- Raw memory stores context but does not separate raw notes, candidate lessons, trusted lessons, exams, mistakes, and promotion gates.
- Skills define procedures but do not by themselves run curricula or prove learning progress.
- Benchmarks prove isolated runs but do not currently become a durable learning curriculum.

Success changes:

- Cortex can accumulate domain expertise in a controlled way.
- Future task performance improves because relevant verified lessons are retrieved before action.
- Bad lessons are quarantined instead of silently becoming habits.

## 4. Scope

In scope for the production slice:

- Learning Capsule v0 file/schema layout.
- Curriculum graph for one starter domain.
- Practice/exam attempt records.
- Verifier result records.
- Mistake ledger and lesson distillation records.
- Promotion gate from raw/candidate lessons to trusted capsule memory.
- Runtime retrieval pack generation for Cortex before solving a task.
- Initial math-domain capsule as the first proof target.
- Signed live registry for independently promoted, expiring math lessons.
- Narrow OpenClaw task-time lesson injection with answer-influence telemetry and kill switches.
- Detached Hetzner Codex math training plus control-plane re-verification and qualified-lesson installation.
- Optional later quant-research capsule, paper-only and verifier-heavy.

## 5. Non-goals

Out of scope for this plan:

- Changing base model weights or claiming true neural fine-tuning.
- Claiming PM-level trading competence without long paper/live out-of-sample evidence.
- Live brokerage integration, trading execution, or financial advice automation.
- External writes or user-visible actions without explicit approval.
- Treating unverified notes as trusted expertise.
- Building another generic Codex replacement or agent swarm.

Eventual ambition:

- A general expertise factory for math, quant research, billing operations, codebase architecture, infra ops, and other domains.

Current milestone:

- A local/internal production slice proving the learning loop on math foundations.

## 6. Active path / repo layout

Active project path:

```text
/root/clawd/cortex-learning-os
```

Important planned paths:

```text
/root/clawd/cortex-learning-os/plan.md                         # canonical operating contract
/root/clawd/cortex-learning-os/STATUS.md                       # current checkpoint and next actions
/root/clawd/cortex-learning-os/DECISIONS.md                    # durable decision log
/root/clawd/cortex-learning-os/package.json                    # local scripts for Learning OS v0, once implementation starts
/root/clawd/cortex-learning-os/src/                             # local implementation code for v0 before broader integration
/root/clawd/cortex-learning-os/tests/                           # local tests for schemas, loops, gates, dashboards
/root/clawd/cortex-learning-os/capsules/<domain>/              # domain capsule root
/root/clawd/cortex-learning-os/schemas/                        # JSON schemas for capsule records
/root/clawd/cortex-learning-os/exams/                          # exam definitions and fixtures
/root/clawd/cortex-learning-os/artifacts/                      # local learning runs and proof artifacts
/root/clawd/large-project-capability-stack/                    # later integration target only after v0 proves stable
```

Quarantined or superseded paths:

```text
n/a for initial planning; future stale capsule experiments must be moved under _quarantine/ with manifests.
```

Path rules:

- Canonical plan/lifecycle files live in `/root/clawd/cortex-learning-os`.
- First implementation code lives in `/root/clawd/cortex-learning-os` to avoid confusing it with SLOS, AI OS, or Cortex/Codex consolidation.
- Reusable code may later move into `large-project-capability-stack`, but only after a decision entry names the package/surface and migration verifier.
- Capsule artifacts are evidence, not automatically trusted memory.
- Trusted lessons must be promoted by a gate, not copied from raw attempts.

## 7. Prior art and existing assets

Prior-art gate decision: `extend_existing`

Prior-art command/artifact:

```text
memory_search: "Cortex Learning OS learning capsules memory verifiers exams training expertise"
```

Observed prior-art state:

- No existing canonical Cortex Learning OS project was found in memory search.
- Existing Cortex/OpenClaw components already provide memory, skills, routing, local files, plan lifecycle, and truth-gate discipline.

Existing assets to reuse/extend:

- Cortex memory search/write-through behavior.
- Workspace project planning lifecycle.
- Existing skills as procedural memory.
- Claim/truth gate ideas from `large-project-capability-stack`.
- Existing AI OS adapter only as an internal handoff/status substrate, not a replacement runtime.
- Codex/model workers as bounded execution assistants when code needs to be written.

Known overlaps or duplication risks:

- Raw memory hoarding without tests.
- Creating another vague “AI OS” instead of a focused learning layer.
- Treating benchmark pass rates as understanding.
- Treating quant backtests as trading skill without out-of-sample/paper evidence.

Decision:

- Build a small, schema-first learning loop and prove it with exams before expanding.

## 8. Target architecture

Architecture summary:

Cortex Learning OS is a local/internal learning control plane. It manages domain-specific capsules that contain curricula, verified lessons, mistakes, exam results, and retrieval packs. It does not change model weights. It changes what Cortex can reliably retrieve, how it practices, and how lessons become trusted.

Subsystems:

- **Capsule Registry** — tracks domains, capsule versions, status, prerequisites, and trust level.
- **Curriculum Graph** — maps concepts, dependencies, learning objectives, and exam coverage.
- **Practice Engine** — creates or selects exercises/projects and records attempts.
- **Verifier Harness** — grades attempts using deterministic checks where possible: CAS, unit tests, proof checks, source checks, simulations, backtests.
- **Mistake Ledger** — stores failures, root-cause analysis, and anti-patterns.
- **Lesson Distiller** — compresses repeated verified patterns into candidate lessons.
- **Promotion Gate** — promotes candidate lessons to trusted capsule memory only after evidence thresholds.
- **Retrieval Pack Builder** — prepares the compact context Cortex should load before performing a domain task.
- **Truth Dashboard** — reports capability by exam, not vibes.
- **Signed Live Registry** — stores only independently replayed, scoped, unexpired lessons under a control-plane HMAC trust root.
- **OpenClaw Live Adapter** — classifies the latest structured user turn and injects only matching lessons; training/Oracle/cron/subagent sessions are bypassed.
- **Detached Training Pipeline** — runs Codex exams on Hetzner, returns artifacts for independent control-plane replay, and hot-installs only qualified lessons.

Key boundaries:

- **Raw memory vs trusted lesson**: raw notes are never equal to promoted expertise.
- **Practice result vs capability claim**: passing one exercise does not imply domain mastery.
- **Research vs execution**: quant research can use historical/paper data; live trades require a separate explicit approval and safety plan.
- **Control plane vs execution plane**: heavy training/evaluation runs must use the remote execution plane or write a blocker.
- **Private data boundary**: do not store secrets, PHI, or sensitive external data in general learning capsules.

Interface contracts:

```text
capsule.json              # domain, version, trust state, active exams, promotion thresholds
curriculum.graph.json     # concept nodes, prerequisites, objectives, coverage
attempt.json              # prompt/problem, answer, tools used, timing, self-rating
verifier_result.json      # deterministic grading, failures, score, reproducibility info
mistake.json              # root cause, correction, related concepts, recurrence count
lesson_candidate.json     # distilled rule with supporting evidence
trusted_lesson.json       # promoted lesson with gate proof and expiration/retest policy
retrieval_pack.md/json    # compact task-time context built from trusted capsule content
capability_report.json    # exam pass/fail matrix and allowed claims
```

Architecture decisions:

| Decision | Options considered | Chosen option | Reason | Revisit when |
|---|---|---|---|---|
| Learning mechanism | model fine-tune vs memory/verifier loop | memory/verifier loop | auditable, private, reversible, cheaper | a safe private fine-tuning path becomes useful |
| First domain | quant trading directly vs math foundations | math foundations | safer, deterministic verifiers, builds prerequisites | math capsule passes baseline exams |
| Knowledge trust | all memory retrieved equally vs promoted lessons | promoted lessons | prevents confident bad habits | retrieval quality is proven robust |
| Trading path | live trading bot vs quant truth lab | quant truth lab | avoids casino behavior and legal/financial risk | paper trading has long verified record |

## 9. Surface matrix / subsystem ownership

| Surface / subsystem | Owner / agent squad | Primary files | Allowed write scope | Verifiers | Claim allowed when |
|---|---|---|---|---|---|
| Plan lifecycle | Cortex | `plan.md`, `STATUS.md`, `DECISIONS.md`, `/root/clawd/docs/PLAN_INDEX.md` | docs only | `node scripts/plan-doctor.mjs` | plan is indexed and companion files exist |
| Capsule schema | future implementer | `schemas/*.schema.json`, package code TBD | schema/tests only | schema validation tests | fixtures pass and invalid records fail |
| Math capsule v0 | future implementer | `capsules/math-foundations/**`, exams/artifacts | local capsule files | deterministic exam harness | capability report proves bounded claims |
| Lesson promotion | future implementer | promotion gate code + fixtures | gate/tests only | negative/positive promotion tests | only evidence-backed lessons promote |
| Retrieval pack | future implementer | pack builder + capsule fixtures | code/tests/docs | snapshot + relevance tests | packs cite trusted lessons and omit raw untrusted notes |
| Live lesson registry | Cortex | `src/live-control.mjs`, `plugins/cortex-learning-os-live/**` | signed state + plugin only | signature, replay, tamper, expiry, scope, canaries | independently replayed lesson enters only matching live math prompts |
| Detached math training | Cortex | `scripts/*math-training*`, Hetzner artifacts | remote artifacts; control state | source pin, remote tests, manifest replay, notifier | qualified run is installed or a terminal blocker is delivered |
| Quant extension | future implementer/reviewer | `capsules/quant-truth-lab/**` | paper/research only | leakage/backtest/paper ledger checks | no live-trading claim; research-only report green |

Ownership rules:

- Docs/tests/harness diffs are scaffolding unless the surface is explicitly docs/tests/harness.
- No external financial execution without a new approved plan.
- Shared Cortex memory writes must label raw/candidate/trusted state clearly.

## 10. Agent strategy

Agent count target: `0-5` for initial implementation; no high-scale launch.

Execution placement:

- Control plane: `/root/clawd` local OpenClaw host.
- Execution plane: Hetzner `jake@37.27.129.239` only if large evaluations or data-heavy benchmarks are introduced.
- Remote boundary required? `yes` for heavy practice/evaluation, market-data-scale backtests, or many-agent runs.
- Heavy execution allowed locally? `no` by default.

Agent roles:

- planner: keep scope, truth boundaries, and lifecycle files current.
- schema implementer: define capsule/attempt/verifier/lesson schemas.
- verifier implementer: build exam harness and deterministic graders.
- capsule author: create math curriculum and examples.
- reviewer/auditor: check overclaim risks and promotion gate evidence.

Launch gates before using many agents:

- [ ] surface matrix exists
- [ ] file ownership/lease strategy exists
- [ ] verifier catalog exists
- [ ] artifact return contract exists
- [ ] blocker format exists
- [ ] stop condition is machine-checkable or artifact-backed
- [ ] execution plane is verified when needed

## 11. Phases / waves

### Wave 0 — Planning and contract

Goal:

- Create canonical plan, status, decision log, and plan index entry.

Outputs:

- `plan.md`
- `STATUS.md`
- `DECISIONS.md`
- `/root/clawd/docs/PLAN_INDEX.md` entry

Verifiers:

```bash
cd /root/clawd && node scripts/plan-doctor.mjs
```

Stop condition:

```text
plan indexed with 0 plan-doctor errors or blocker recorded
```

### Wave 1 — Capsule v0 schema

Goal:

- Define machine-readable contracts for capsules, curricula, attempts, verifier results, mistakes, candidate lessons, trusted lessons, and retrieval packs.

Outputs:

- JSON schemas.
- Valid/invalid fixtures.
- Initial CLI or test helper for validation.

Verifiers:

```bash
node --test <capsule-schema-tests>
```

Stop condition:

```text
schemas validate all positive fixtures and reject negative fixtures
```

### Wave 2 — Math foundations capsule

Goal:

- Build the first domain capsule around deterministic math learning, starting with foundations required for quant research: algebra, functions, probability, statistics, optimization basics.

Outputs:

- `capsules/math-foundations/curriculum.graph.json`
- starter exam set
- initial trusted-empty capability report

Verifiers:

```bash
node --test <math-capsule-tests>
```

Stop condition:

```text
curriculum coverage exists and baseline exam can run reproducibly
```

### Wave 3 — Practice → verify → mistake loop

Goal:

- Implement the loop that records attempts, grades them, attributes mistakes, and stores raw/candidate lessons.

Outputs:

- attempt records
- verifier results
- mistake ledger entries
- candidate lesson records

Verifiers:

```bash
node --test <learning-loop-tests>
```

Stop condition:

```text
at least one passing and one failing fixture produce correct lesson/mistake artifacts
```

### Wave 4 — Promotion gate and retrieval pack

Goal:

- Promote lessons only after evidence thresholds and build compact retrieval packs for task-time use.

Outputs:

- promotion report
- trusted lesson artifact
- retrieval pack artifact

Verifiers:

```bash
node --test <promotion-and-retrieval-tests>
```

Stop condition:

```text
unverified candidate lessons cannot promote; verified lessons can promote; retrieval pack only includes trusted/cited lessons
```

### Wave 5 — Capability dashboard

Goal:

- Report what the capsule can and cannot claim based on exam performance.

Outputs:

- `capability_report.json`
- markdown dashboard
- allowed/not-allowed claim summary

Verifiers:

```bash
node --test <capability-report-tests>
```

Stop condition:

```text
dashboard separates observed exam scores from inferred expertise and includes gaps
```

### Wave 5.5 — Retrieval-treatment A/B evidence

Goal:

- Test whether the promoted retrieval treatment improves performance on a bounded exact-multiplication surface without comparing mismatched task difficulty or reusing model sessions.

Outputs:

- immutable preregistration with generated paired items, randomization seed, arm order, model/runtime, invalid-trial policy, and fixed analysis thresholds
- 27 identical-item pairs / 54 fresh ephemeral trials across `pack` and `no_pack` arms, with 24 valid pairs required
- raw provider events, answer sets, deterministic verifier outputs, per-trial validity records, paired analysis, and hashed manifest
- separate mechanical-completion and bounded-causal-evidence results

Verifiers:

```bash
npm test
npm run experiment:ab:plan -- --experiment-id <id> --seed <seed>
npm run experiment:ab -- --experiment-id <id> --seed <seed>
```

Stop condition:

```text
all 54 preregistered fresh-session trials complete exactly once, or a durable blocker is written; retrieval benefit may be claimed only when >=24 pairs are valid, invalid-pair rate <=10%, pack lift >=10 percentage points, pack-only wins exceed no-pack-only wins, and two-sided exact McNemar p <=0.05
```

Truth boundary:

- Passing supports only a bounded retrieval-context effect for the declared exact-multiplication/model/runtime configuration.
- Completion without threshold passage is an honest null result, not a failed implementation.
- No outcome-driven reruns, broad math-learning claim, durability claim, model-weight claim, or automatic ordinary-task routing promotion is allowed.

### Wave 5.6 — Harder novel-math acquisition and restart transfer

Goal:

- Test whether the Learning OS can acquire one genuinely invented mathematical microtheory, promote it after fail/correct/retest evidence, apply it to disjoint direct and compositional items in fresh sessions, avoid ordinary-math interference, and reload the unchanged lesson after a clean runner-process restart.

Frozen design:

- 12-call definition-disjoint no-context calibration.
- 3-call target acquisition and promotion gate.
- 30 direct identical-item pack/no-pack pairs.
- 30 compositional identical-item pack/no-pack pairs.
- 25 ordinary-arithmetic irrelevant-pack/no-pack regression pairs.
- 20 durability pairs in a distinct process.
- 225 maximum calls, unique fresh sessions, no tools, exact deterministic grading, exact McNemar tests, frozen provider/model/reasoning/worker provenance, and no outcome-driven reruns.

Outputs:

- `docs/novel-math-validation-contract.md`
- `src/novel-math-experiment.mjs`
- `src/run-novel-math-validation.mjs`
- `src/verify-novel-math-artifacts.mjs`
- returned run `clos-novel-math-20260726T034546Z`

Result:

- **Completed green.** All `225/225` real Codex calls completed; calibration, acquisition/promotion, direct transfer, compositional transfer, ordinary-math regression, clean-process durability, provider evidence, and independent artifact verification passed.
- Direct and compositional tracks were each pack `30/30` versus no-pack `0/30`; durability was `20/20` versus `0/20`; ordinary arithmetic was `25/25` in both arms.
- Independent decision: `verified_threshold_pass` with zero errors.
- Canonical promotion completed: the reusable v0.6 mechanism and validation commands are on `origin/main` and synced to both canonical local and Hetzner default paths. The synthetic benchmark lesson remains artifact-only and cannot influence live answers.

Stop condition reached:

```text
bounded_acquisition_retention_and_fresh_session_generalization_for_one_seeded_novel_mathematical_microtheory
```

Truth boundary:

- This is one bounded retrieval-mediated result for one seeded invented microtheory. It is not broad mathematical mastery, human-like or time-durable learning, autonomous self-improvement, or model-weight change.

### Wave 5.7 — Direct applied-mathematics implementation

Supersession:

- Jake stopped the transfer-benchmark, canary, and review path on `2026-08-08` and directed the standing workflow: plan, make the change, run one focused smoke test, then apply it.
- `docs/applied-math-transfer-contract.md`, `policies/applied-math-transfer-v1.json`, `benchmarks/applied-math-transfer-v1/`, and detached worker `clos-applied-math-impl-20260808T235336Z` remain historical planning/implementation artifacts. Do not run their 40-task/80-call campaign or merge the generated test harness by default.

Goal:

- Directly extend the canonical Cortex Learning OS transfer bridge with concise applied-mathematics guidance for high-value coding and systems requests.

Target:

- Isolated branch: `feat/cortex-learning-os-applied-math-transfer-20260808`.
- Product files: `plugins/cortex-learning-os-live/transfer.mjs` and `plugins/cortex-learning-os-live/transfer-registry.mjs`.
- Production state: the existing owner-only signed transfer registry under `/root/.openclaw/cortex-learning-os/`.

Execution:

1. Add scoped matchers and compact transfer contexts for numerical stability, flow/matching, matrix conditioning, constrained optimization, stochastic reliability, state invariants/counterexamples, and causal analysis.
2. Record direct operator activation honestly; do not label entries independently qualified.
3. Run exactly one focused smoke command proving a representative coding request selects an operator-enabled profile and renders bounded context.
4. Commit/persist the source, back up current live files/state, install the changed plugin and signed entries, and restart the gateway once.

Stop condition:

```text
applied_math_transfer_profiles_are_on_the_canonical_active_path_and_the_one_focused_smoke_passes
```

Truth boundary:

- The smoke supports only mechanical routing/context operation.
- Do not claim scientific transfer benefit, retained mastery of all 264 concepts, model-weight change, PhD equivalence, Lean qualification, research ability, or regression freedom.

### Wave 5.8 — Full-spectrum 264-concept PhD mathematics transfer

Reply anchor and fidelity:

- Anchor: Jake's `2026-08-08 20:43 CDT` instruction, “Continue it until its a full spectrum phd math transfer,” immediately following the deployed eight-profile v1.
- Fidelity: full catalog coverage for the canonical 264-concept curriculum on the production answer path, not a statistical efficacy or human-equivalence claim.
- Active branch/worktree: `feat/cortex-learning-os-applied-math-transfer-20260808` at `/root/clawd/worktrees/cortex-learning-os-applied-math-transfer-20260808`.

Scope and product surfaces:

- Every concept in `capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json` is represented by one immutable transfer profile with title, category, stage, tracks, prerequisites, declared outcome, retrieval terms, and bounded reasoning/verification context.
- Automatic routing covers exact concept/title/outcome language plus common coding, systems, scientific-computing, data, reliability, cryptography, formal-reasoning, and research-practice application terms.
- Product files: `plugins/cortex-learning-os-live/transfer.mjs`, `transfer-registry.mjs`, `index.ts`, `phd-math-transfer-catalog.v1.json`, and the signed-registry installer.
- Machine-readable surface matrix: `surfaces/full-spectrum-phd-math-transfer-v1.json`.

Non-goals:

- No benchmark, canary, broad suite, empirical transfer study, model-weight training, canonical mastery mutation, Lean qualification, autonomous research claim, or production-provider change.
- Do not claim a concept is relevant when the request has no grounded lexical/application match; fail closed rather than inject encyclopedic context.

Architecture and ownership:

1. Extend the existing signed transfer primitive; do not build a parallel retrieval system. The prior-art decision is `extend_existing` (the Cortex prior-art CLI hung during workspace scanning, so direct source inspection established the existing `transfer.mjs`/signed-registry/index hook as the reusable path).
2. Build a deterministic catalog from the exact 264-node graph plus canonical rubric stage/track mappings.
3. Route with bounded deterministic scoring: explicit concept IDs/titles first, curated application aliases second, distinctive title/outcome term overlap third. Return at most three concepts.
4. Generate compact concept-specific context from declared outcomes, prerequisites, category method guidance, and explicit verification/truth boundaries.
5. Install all 264 profiles as HMAC-signed `operator_enabled` / `operator_direct` entries for `main`; preserve fail-closed registry and context-size behavior.
6. Control-plane implementation only; no heavy agent farm or remote execution is needed. Jake owns activation; the plugin owns deterministic selection; the registry owns authorization/integrity.

Implementation sequence and acceptance:

1. Freeze the exact source digest and 264-row surface matrix. Acceptance: unique concept IDs and source-bound rows exist.
2. Implement catalog loading, deterministic full-spectrum routing, bounded context generation, 264-entry registry support, and selected-only telemetry. Acceptance: the diff touches all listed product surfaces.
3. Run exactly one focused end-to-end smoke command against a temporary signed registry. It must prove: catalog count `264`; one cross-domain systems request selects expected advanced concepts; only signed operator entries are rendered; context stays within the configured bound.
4. If that one smoke passes, commit and push exact source, back up live plugin/config/registry, install the exact product files and all 264 signed profiles, raise the bounded context limit only if required, and restart the gateway once.
   - Legacy transition rule added after the first guarded apply blocked at `2026-08-08 21:33 CDT`: verify the old registry envelope with its existing HMAC before new matcher semantics are applied; remove only superseded `operator_direct` entries; preserve compatible independently qualified entries; then atomically sign the 264-profile replacement. Never bypass signature verification or silently retain an entry that the new catalog cannot validate.
   - Run exactly one focused migration smoke for this fix using an eight-profile signed temporary registry followed by the 264-profile installer. This is the one test for the migration fix, not a new campaign.
5. Record live registry revision, exact hashes, active gateway state, and the completed 264-row surface matrix. These are deployment-state observations, not extra tests.

Evidence and replay:

- Source catalog and surface matrix carry the exact curriculum SHA-256.
- One focused smoke command is recorded in `artifacts/cortex-learning-os-applied-math-direct-20260808/full-spectrum/`.
- Deployment backup and installed hashes live under the same artifact root.
- No broad replay/test command is authorized by this wave.

Risks and confusion prevention:

- Lexical routing can miss paraphrases or overmatch generic terms; require distinctive evidence and keep at most three profiles.
- Catalog coverage is not proof that all concepts improve answers. Say `full-spectrum catalog implemented`, not `PhD mastery proven`.
- The 264-node graph includes foundational and research-practice concepts as well as graduate mathematics; preserve all rows rather than reporting only impressive topics.
- One smoke establishes mechanical operation only and cannot justify regression or efficacy claims.

Rough effort:

- Implementation: one bounded local coding pass, approximately 8–15k source/catalog lines and under one hour of control-plane compute.
- Validation: exactly one focused smoke, expected under one minute.
- Deployment: one signed registry transaction and one gateway restart.

Machine stop condition:

```text
surface_matrix.completed == 264
and surface_matrix.total == 264
and live_registry.active_operator_profiles == 264
and focused_smoke.status == passed
and installed_source_hashes_match_committed_source == true
and gateway.state == active
```

Truth boundary:

- Completion means all 264 canonical concepts are available through the active signed retrieval/context path with deterministic matching and bounded guidance.
- It does not establish retained mastery, universal relevance, empirical answer improvement, formal theorem-proving qualification, independent research ability, human PhD equivalence, or model-weight change.

### Wave 5.9 — Continuous math learning, validity, retention, and everyday Cortex use

Reply anchor and supersession:

- Anchor: Jake's `2026-08-08 22:54 CDT` instruction to scratch the external PhD-equivalence plan, continue learning more mathematics, test validity and retention at the same time, and determine how to use the result in everyday Cortex.
- The `clos-phd-equivalence-usefulness-v1` plan and branch remain historical Git evidence only. They are not active, are not merged into this branch, and authorize no evaluator outreach, spending, recruitment, or scored program.
- Active branch/worktree: `feat/cortex-learning-os-continuous-math-evidence-20260808` at `/root/clawd/worktrees/cortex-learning-os-applied-math-transfer-20260808`.
- Full operating contract: [`docs/continuous-math-learning-validity-retention-everyday-plan.md`](docs/continuous-math-learning-validity-retention-everyday-plan.md).

Objective and fidelity:

- Extend the existing 264-concept acquisition, retention, and signed transfer paths into one ongoing evidence loop.
- “Learning” means signed covered-once evidence, independently verified corrections/lessons, time-separated retention, and measured task utility. It does not mean model-weight training.
- This wave is planning only until implementation touches the declared product surfaces and Phase-0 live audit artifacts exist.

Four independent lanes:

1. **Acquisition:** continue prerequisite-aware concept coverage with independently authored signed assessment items; promote a lesson only after genuine failure and paired fresh-session lift.
2. **Validity:** within 24–72 hours, test newly acquired/corrected concepts on disjoint direct and compositional/proof/error-diagnosis families.
3. **Retention:** use the existing production retention path for real R7 windows, then disjoint R30/R90 windows; acquisition continues while clocks run.
4. **Everyday utility:** retain honest `operator_available` status for current profiles, collect content-free activation evidence, run paired utility qualification on privacy-safe task families, and mark only passing profiles `utility_qualified`/`everyday_preferred`.

Architecture and ownership:

- Extend `adaptive-math-phd-v1`, `phd-retention-v1`, existing assessment-bank trust, control-plane replay/signing, detached Hetzner workers, and the signed live transfer registry. Do not build a parallel learner.
- Keep acquisition, validity, retention, and utility in separate ledgers with a 264-row evidence matrix and exact negative space.
- The learner cannot author or grade its own evidence. Source/lesson author, assessment author/reviewer, worker, grader, harvester, and utility auditor remain capability-separated.
- Raw private chats, client data, credentials, and personal information are never learning artifacts. Everyday corrections create quarantined gap candidates only; trusted state changes still require independent evidence.

Implementation sequence:

1. Phase 0: inspect live signed acquisition/lesson/retention/transfer states, banks, exact source, Hetzner readiness, and notifier; create the 264-row evidence matrix with no model call or state mutation.
2. Select up to 24 prerequisite-ready concepts across at least six tracks for the first cohort, based on observed live state rather than memory.
3. Continue acquisition one detached child at a time through the existing signed bank/worker/harvester path.
4. Schedule disjoint validity packs 24–72 hours later and preserve failures as correction candidates.
5. Freeze genuine R7/R30/R90 retention commitments and execute only after real elapsed time.
6. Use content-free everyday telemetry to choose 4–8 high-frequency utility families; calibrate disjoint tasks, then run frozen fresh-session treatment/control pairs.
7. Feed verified gaps—not raw conversations—back into the next acquisition cohort. Expand beyond the 264 frontier only through source-grounded, reviewed DAG additions.
8. For implementation changes, follow plan → change → one focused smoke → apply. Assessment runs are evidence collection, not a broad software test campaign.

Evidence and artifacts:

- Future root: `/root/clawd/artifacts/cortex-learning-os-continuous-math/<campaign-id>/`.
- Required state layers: catalog availability, acquired once, validity confirmed, R7/R30/R90 retention, runtime activation, causal utility, and model-weight learning (unclaimed).
- Required artifacts include source/live-state freezes, bank inventory, cohort plan, separate lane states, provider ledger, manifests, integrity and threshold reports, truth conflicts, completion/blocker reports, and next-wave plan.
- Progress is reported as exact counts such as `acquiredOnce`, `validityConfirmed`, `retentionR7`, and `utilityQualified`; never as a vibe-based percentage.

Execution boundary and continuation:

- Heavy model execution belongs on Hetzner; local control plane freezes plans, verifies/signs state, consumes artifacts, and notifies.
- Preserve existing bounds: one active child, at most 100 sessions and 24 hours per continuation, four hours per child, stop on first blocker/non-advance/source drift/frontier/budget exhaustion.
- One bounded wave ending does not complete the objective. Generate the next grounded wave from evidence-matrix gaps, due retention windows, and everyday utility candidates.

Immediate milestone and stop condition:

```text
phase_0_live_truth_audit_complete
and exact_264_row_evidence_matrix_written
and next_prerequisite_ready_cohort_identified
and no_model_call_or_state_mutation_performed
or precise_readiness_blocker_reported
```

Truth boundary:

- This wave creates the route to continued learning and evidence; the plan itself proves nothing.
- Profile availability is not acquisition, acquisition is not validity, validity is not retention, activation is not utility, and none implies model-weight learning.

### Wave 6 — Quant Truth Lab extension

Goal:

- Extend from math foundations into quant research safely: backtesting, leakage detection, risk metrics, paper-only ledgers.

Outputs:

- quant curriculum
- backtest verifier fixtures
- fake-edge graveyard
- paper-trading-only policy gate

Verifiers:

```bash
node --test <quant-truth-lab-tests>
```

Stop condition:

```text
research-only quant capsule can detect at least one deliberately leaky/overfit strategy fixture and refuses live-trading claims
```

## 12. Verifier and evidence contract

Minimum evidence for any learning claim:

- capsule version
- exam or task definition
- attempt record
- verifier result
- failure/mistake record when applicable
- promoted lesson evidence when a trusted lesson changes
- capability report with allowed and disallowed claims

Allowed evidence types:

- deterministic tests
- symbolic/math checks where available
- source-backed research checks
- simulation and backtest artifacts with leakage controls
- human review annotations

Disallowed evidence types:

- vibes
- raw memory volume
- “it answered well once”
- in-sample-only backtests
- self-graded assertions without a verifier

## 13. Artifacts and replay commands

Canonical artifacts will live under:

```text
/root/clawd/cortex-learning-os/artifacts/<run-id>/
```

Initial replay command:

```bash
cd /root/clawd && node scripts/plan-doctor.mjs
```

Future replay command shape:

```bash
cd /root/clawd/<implementation-path> && node --test <learning-os-tests>
```

## 14. Stop condition

Current planning stop condition:

```text
completed_and_delivered: canonical plan, STATUS, DECISIONS, and PLAN_INDEX entry exist; plan-doctor has 0 errors or blocker is recorded.
```

Implementation stop condition for the first production slice:

```text
all_phase_verifiers_green_or_blocker: Learning Capsule v0 schemas, math capsule baseline exam, practice/verify/mistake loop, promotion gate, retrieval pack, and capability dashboard are all green, or a structured blocker is written.
```

## 15. Truth boundary

Allowed claim after this planning task:

- Cortex Learning OS has a canonical implementation plan and lifecycle files.

Allowed claim after Wave 1-5 only if verifiers pass:

- Cortex Learning OS has a working production-slice learning capsule loop for bounded math-domain training.

Not allowed yet:

- Cortex is an expert mathematician.
- Cortex is as good as a quant PM.
- Cortex can trade profitably.
- Memory alone proves understanding.
- Raw notes are trusted lessons.
- Any live financial action is approved.

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Memory hoarding masquerades as learning | promotion gate requires verifier evidence |
| Bad lessons become durable habits | candidate/trusted separation and mistake ledger |
| Overclaiming math or quant expertise | capability dashboard with allowed/not-allowed claims |
| Backtest overfitting or leakage | explicit leakage fixtures and out-of-sample gates |
| Live-trading temptation | paper-only quant extension unless new approval plan exists |
| Privacy leakage | no secrets/PHI in general capsules; redaction rules before memory writes |
| Duplicating existing Cortex/AI OS layers | extend existing memory/skills/verifiers; do not build a replacement runtime |
| Heavy runs on control host | remote execution boundary for large evaluations |

## 17. Immediate next milestone

Wave 0 completion is done. The immediate next milestone is **Wave 1 — Learning Capsule v0 schema**.

Wave 1 checklist:

1. Create local implementation scaffolding under `/root/clawd/cortex-learning-os`.
2. Define the v0 record schemas.
3. Add valid and invalid fixtures for every schema.
4. Add a local validation helper.
5. Add tests proving accepted/rejected fixtures behave correctly.
6. Update `STATUS.md` and `DECISIONS.md` with validation evidence.

Wave 0 completed steps:

1. Create `plan.md`, `STATUS.md`, and `DECISIONS.md`.
2. Add Cortex Learning OS to `/root/clawd/docs/PLAN_INDEX.md`.
3. Run `node scripts/plan-doctor.mjs`.
4. If green, begin Wave 1 by drafting schemas for Learning Capsule v0.

## 18. Detailed implementation sequence

This section is deliberately operational. Follow it when implementing so the project does not drift into vague memory-hoarding or accidental trading/AI-OS/SLOS work.

### Stage A — Local project scaffold

Purpose: create a boring, legible local package before writing learning logic.

Steps:

1. Create directories:

   ```text
   /root/clawd/cortex-learning-os/src/
   /root/clawd/cortex-learning-os/tests/
   /root/clawd/cortex-learning-os/schemas/
   /root/clawd/cortex-learning-os/fixtures/valid/
   /root/clawd/cortex-learning-os/fixtures/invalid/
   /root/clawd/cortex-learning-os/capsules/math-foundations/
   /root/clawd/cortex-learning-os/exams/math-foundations/
   /root/clawd/cortex-learning-os/artifacts/
   ```

2. Add `package.json` with minimal scripts:

   ```json
   {
     "type": "module",
     "scripts": {
       "test": "node --test tests/*.test.mjs",
       "validate:fixtures": "node src/validate-fixtures.mjs"
     }
   }
   ```

3. Add `src/paths.mjs` for canonical project paths and safe artifact path helpers.
4. Add `src/json.mjs` for deterministic JSON read/write helpers.
5. Add `src/hash.mjs` for SHA256 helper used by artifact manifests.
6. Add `tests/scaffold.test.mjs` proving canonical paths and JSON helpers work.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
```

Claim allowed:

- Local Cortex Learning OS package scaffold exists.

Claim not allowed:

- Learning loop exists.

### Stage B — Learning Capsule v0 schemas

Purpose: define the durable record contracts before building behavior.

Schemas to create:

1. `schemas/capsule.schema.json`
   - domain id, version, status, trust level, active curriculum, active exam set, promotion thresholds, truth boundary.
2. `schemas/curriculum-graph.schema.json`
   - concept nodes, prerequisites, outcomes, exam coverage, dependencies.
3. `schemas/exam.schema.json`
   - exam id, version, domain, time limit, allowed tools, sections, scoring policy, pass threshold.
4. `schemas/exam-item.schema.json`
   - problem statement, expected answer/checker, concept tags, difficulty, deterministic grading mode.
5. `schemas/attempt.schema.json`
   - run id, item id, answer, reasoning summary, tools used, started/finished timestamps, artifact refs.
6. `schemas/verifier-result.schema.json`
   - score, pass/fail, checker output, reproducibility metadata, failure reasons.
7. `schemas/mistake.schema.json`
   - root cause, correction, concept tags, recurrence count, related attempts.
8. `schemas/lesson-candidate.schema.json`
   - proposed lesson, evidence refs, confidence, contraindications, needed retests.
9. `schemas/trusted-lesson.schema.json`
   - promoted lesson, promotion proof, expiry/retest policy, retrieval tags.
10. `schemas/promotion-report.schema.json`
    - candidate id, gate decision, evidence, failures, promoted artifact path.
11. `schemas/retrieval-pack.schema.json`
    - task type, included trusted lessons, excluded raw notes, token estimate, citations.
12. `schemas/capability-report.schema.json`
    - exam matrix, observed pass rates, allowed claims, disallowed claims, open gaps.
13. `schemas/run-manifest.schema.json`
    - artifact list, hashes, commands, runtime, claim boundary.

Implementation steps:

1. Write schemas with explicit required fields.
2. Add one valid fixture per schema.
3. Add at least two invalid fixtures per schema:
   - missing required truth boundary.
   - raw note or candidate lesson trying to claim trusted status.
4. Build `src/schema-validator.mjs` using local JSON-schema validation. If no dependency is added, use a small internal required-field/type validator for v0 and document the limitation.
5. Build `src/validate-fixtures.mjs` to validate every fixture and print JSON summary.
6. Add `tests/schema-validation.test.mjs`.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
cd /root/clawd/cortex-learning-os && npm run validate:fixtures
```

Claim allowed:

- Learning Capsule v0 schema contract exists and validates fixtures.

Claim not allowed:

- The system has learned anything yet.

### Stage C — Math-foundations capsule skeleton

Purpose: define the first domain in a way that is testable and deterministic.

Initial domain scope:

1. Algebra and symbolic manipulation.
2. Functions and transformations.
3. Probability basics.
4. Descriptive statistics.
5. Optimization basics.
6. Error analysis / common false shortcuts.

Steps:

1. Create `capsules/math-foundations/capsule.json` with trust state `untrained`.
2. Create `capsules/math-foundations/curriculum.graph.json` with at least 30 concept nodes.
3. Create `exams/math-foundations/baseline.exam.json` with 20-30 deterministic items.
4. Use mixed checkers:
   - exact string/numeric answer for simple items.
   - numeric tolerance for decimal/statistical items.
   - expression equivalence only if a safe checker is implemented.
5. Create `capability_report.json` initialized to `not_evaluated` / no expertise claim.
6. Add tests that every exam concept maps to a curriculum node.
7. Add tests that no trusted lessons exist before promotion.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
```

Claim allowed:

- Math-foundations capsule skeleton and baseline exam exist.

Claim not allowed:

- Math competence improved.

### Stage D — Exam runner and verifier harness

Purpose: make practice measurable.

Steps:

1. Build `src/exam-runner.mjs` that can run fixture attempts against exam items.
2. Build `src/checkers.mjs` with v0 checker modes:
   - `exact_number`
   - `numeric_tolerance`
   - `exact_string`
   - `set_equality`
   - `multiple_choice`
3. Build `src/write-attempt.mjs` to write attempt records.
4. Build `src/verify-attempt.mjs` to write verifier results.
5. Add passing fixtures.
6. Add failing fixtures.
7. Add malformed attempt fixtures.
8. Ensure verifier failures are structured, not just thrown stack traces.
9. Write run artifacts under `artifacts/<run-id>/` with a manifest.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
node src/exam-runner.mjs --exam exams/math-foundations/baseline.exam.json --fixture fixtures/valid/math-baseline-attempts.json --artifact-root artifacts/local-smoke
```

Claim allowed:

- Cortex Learning OS can grade deterministic math exam attempts.

Claim not allowed:

- Cortex itself passed the exam, unless the attempts are actually generated by Cortex under a recorded run.

### Stage E — Mistake ledger and candidate lesson distillation

Purpose: turn failures into learning material without promoting them too early.

Steps:

1. Build `src/mistake-ledger.mjs`.
2. Define mistake categories:
   - arithmetic slip
   - algebraic transformation error
   - probability independence error
   - denominator/base-rate error
   - optimization condition missed
   - overgeneralized rule
   - unsupported assumption
3. On failed verifier result, require a mistake entry before any lesson candidate can be created.
4. Build `src/lesson-distiller.mjs` that creates candidate lessons from:
   - repeated mistake categories.
   - corrected passing attempts.
   - explicit human/validator annotations.
5. Candidate lessons must include:
   - supporting attempt ids.
   - verifier result ids.
   - negative examples / when not to apply.
   - required retest ids.
6. Add tests that raw mistakes cannot become trusted lessons directly.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
```

Claim allowed:

- The system records and distills candidate lessons from verified outcomes.

Claim not allowed:

- Candidate lessons are trusted knowledge.

### Stage F — Promotion gate

Purpose: define what makes a lesson trusted.

Initial v0 promotion thresholds:

1. Candidate lesson has at least one supporting verifier-passed correction.
2. Candidate lesson cites at least one failure or edge case it prevents.
3. Candidate lesson includes at least one contraindication / “do not apply when.”
4. Candidate lesson passes a retest item tagged to the same concept.
5. Candidate lesson does not contradict an existing trusted lesson.
6. Promotion report records evidence and truth boundary.

Steps:

1. Build `src/promotion-gate.mjs`.
2. Add positive promotion fixture.
3. Add negative fixtures:
   - no verifier evidence.
   - only raw memory evidence.
   - no contraindication.
   - contradiction with trusted lesson.
   - retest failed.
4. Emit `trusted_lesson.json` only when green.
5. Emit `promotion_report.json` for both green and red decisions.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
```

Claim allowed:

- Trusted lessons are gated by evidence.

Claim not allowed:

- Trusted lessons are globally true forever; they require retest/expiry policy.

### Stage G — Retrieval pack builder

Purpose: make trusted learning usable at task time without flooding the model.

Steps:

1. Build `src/retrieval-pack-builder.mjs`.
2. Inputs:
   - domain id.
   - task type.
   - concept tags.
   - max token budget.
3. Include only:
   - trusted lessons.
   - relevant mistake warnings.
   - current capability boundaries.
   - cited exam/verifier references.
4. Exclude:
   - raw attempts unless explicitly requested.
   - failed lesson candidates.
   - uncited notes.
5. Add approximate token estimator.
6. Add tests that retrieval packs stay under budget.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
```

Claim allowed:

- Cortex can generate bounded retrieval packs from trusted capsule content.

Claim not allowed:

- Retrieval pack quality proves domain expertise by itself.

### Stage H — Capability dashboard

Purpose: show what the capsule can actually claim.

Steps:

1. Build `src/capability-report.mjs`.
2. Report by domain, concept, exam, and verifier type.
3. Separate:
   - observed scores.
   - inferred readiness.
   - confidence.
   - missing coverage.
   - disallowed claims.
4. Add markdown renderer for human review.
5. Add tests that a capsule with weak coverage cannot claim broad expertise.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
```

Claim allowed:

- A bounded capability report exists.

Claim not allowed:

- Expert-level math or quant competence unless the report explicitly supports that claim.

### Stage I — First dogfood learning run

Purpose: prove the loop end-to-end with Cortex attempts, not just fixtures.

Steps:

1. Select 10-20 held-out math-foundations exam items.
2. Have Cortex answer under a recorded attempt run.
3. Grade with deterministic verifier.
4. Write mistake entries for failures.
5. Distill at least one candidate lesson.
6. Promote a lesson only if it passes the gate.
7. Build a retrieval pack.
8. Re-run a small retest using the retrieval pack.
9. Compare before/after scores without overclaiming.
10. Write capability report.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
node src/run-learning-smoke.mjs --domain math-foundations --artifact-root artifacts/math-foundations-smoke
```

Claim allowed:

- End-to-end learning loop works for a bounded math-foundations smoke run.

Claim not allowed:

- Expert mathematician.

### Stage J — Live scoped math integration

Purpose: make promoted real math lessons usable in the canonical OpenClaw answer path and make future training safely repeatable.

Steps:

1. Create an owner-only HMAC key and signed live registry outside Git.
2. Independently replay phase grading, mistake reconstruction, candidate distillation, promotion, and held-out linkage before registry installation.
3. Add narrow activation profiles and exclude training, Oracle, cron, and subagent sessions.
4. Add content-free answer-influence telemetry, per-lesson enable flags, registry enable flag, expiry, and a plugin kill switch.
5. Seed the first real math-foundations lesson; never seed synthetic novel-math benchmark content.
6. Deploy the OpenClaw plugin on the canonical default path and validate configuration.
7. Run positive, non-math, mismatched-math, and telemetry-leakage canaries.
8. Add a detached Hetzner Codex worker, independent control-plane harvester, and independent notifier.
9. Require canonical local/remote commit equality before training launch.
10. Sync source to canonical local, remote `main`, and Hetzner; preserve evidence artifacts.

Acceptance checks:

```bash
cd /root/clawd/cortex-learning-os && npm test
npm run live:verify
openclaw config validate
./scripts/launch-live-math-training.sh --exam stress --dry-run
openclaw gateway status
```

Claim allowed:

- Verifier-promoted, scoped, unexpired math lessons can enter matching live prompts, and new bounded math training can run detached through the same gates.

Claim not allowed:

- Model weights changed, broad mathematics was learned, or live lesson injection caused better answers without separate treatment/control evidence.

The full contract is [`docs/live-math-integration-contract.md`](docs/live-math-integration-contract.md).

## 19. Time, token, compute, and execution budget estimates

These are rough planning estimates for LLM/context usage and elapsed work. They exclude deterministic local test output unless that output is fed back into a model. They also exclude hidden provider overhead and any future heavy remote runs.

### Estimate summary

| Stage | Human/agent elapsed time | LLM token estimate | Local compute/test time | Notes |
|---|---:|---:|---:|---|
| A. Local scaffold | 1-2 hours | 20k-40k | <5 min | Mostly boilerplate and tests |
| B. Capsule v0 schemas | 4-8 hours | 80k-160k | <10 min | Highest precision needed; many fixtures |
| C. Math capsule skeleton | 4-8 hours | 80k-180k | <10 min | Curriculum and exam authoring heavy |
| D. Exam runner/verifiers | 4-8 hours | 70k-150k | <15 min | Deterministic code/tests |
| E. Mistake + lesson distillation | 4-8 hours | 80k-160k | <15 min | Taxonomy and edge cases matter |
| F. Promotion gate | 3-6 hours | 50k-110k | <10 min | Needs negative tests |
| G. Retrieval pack builder | 3-6 hours | 50k-100k | <10 min | Token budgeting + relevance tests |
| H. Capability dashboard | 3-6 hours | 50k-100k | <10 min | Truth-boundary heavy |
| I. First dogfood run | 3-8 hours | 60k-180k | 10-30 min | Depends on number of exam items |

### Production-slice total

Expected for Waves 1-5 / Stages A-H:

```text
Elapsed implementation time: 26-52 hours
LLM token budget: ~480k-1.1M tokens
Local test/runtime budget: usually under 2 hours total
Calendar time if worked steadily by one agent: ~3-7 focused workdays
Calendar time with parallel subagents after schemas stabilize: ~2-4 focused workdays
```

First dogfood run adds:

```text
Elapsed time: 3-8 hours
LLM token budget: ~60k-180k tokens
```

Quant Truth Lab extension estimate, after math capsule v0 is green:

```text
Elapsed implementation time: 20-50 hours
LLM token budget: ~350k-900k tokens
Local/remote compute: depends on historical data volume; remote execution likely needed for larger backtests
```

### Token budget rules

Per-run targets:

| Context pack | Target | Hard cap | Rule |
|---|---:|---:|---|
| Schema implementation prompt | 8k-16k | 24k | Include only current schema + tests, not entire project |
| Exam authoring prompt | 8k-20k | 32k | Batch by concept area |
| Attempt grading feedback | 2k-6k | 10k | Include problem, answer, verifier summary, not raw logs |
| Lesson distillation | 6k-16k | 24k | Include clustered mistakes and corrections only |
| Retrieval pack | 2k-6k | 8k | Compact enough to use inside later tasks |
| Capability report synthesis | 4k-12k | 18k | Include matrix summary and blockers |

Memory write policy:

- Raw attempts stay in artifacts.
- Candidate lessons stay in capsule files.
- Trusted lessons may be summarized into durable memory only after promotion.
- Daily memory gets status summaries, not full exam content.

## 20. Confusion-prevention rules

Use these rules during implementation and review:

1. **One active path**: `/root/clawd/cortex-learning-os` is the active CLOS implementation path.
2. **No invisible promotion**: raw notes, attempts, and candidate lessons cannot be used as trusted knowledge unless a promotion report exists.
3. **No expertise from volume**: the number of stored examples is not a capability claim.
4. **No trading by implication**: quant research remains paper/research-only unless a new explicit trading plan and approval exists.
5. **No SLOS/AI OS drift**: reuse ideas from SLOS/AI OS, but do not move implementation into those projects without a decision entry.
6. **Every run has a run id**: attempts, verifier results, mistakes, lessons, and retrieval packs must be traceable.
7. **Every claim has a layer**: distinguish scaffold, schema green, exam green, learning-loop green, capsule capability, and real-world task performance.
8. **Every failure teaches or blocks**: failed verifiers should produce either a mistake record or a blocker.
9. **Small batches first**: do not generate thousands of lessons before the promotion gate is proven.
10. **Keep retrieval compact**: task-time packs should be useful, not encyclopedic.

## 21. Open decisions before code starts

| Decision | Recommendation | Why | Needed before |
|---|---|---|---|
| Implementation package location | Start directly in `/root/clawd/cortex-learning-os` | Avoid confusing this with SLOS/AI OS/shared-stack code | Stage A |
| Schema validator | Start with a tiny internal validator unless dependency approval is desired | Keeps first slice dependency-light | Stage B |
| First exam scope | Math foundations, 20-30 deterministic items | Enough to prove loop without overbuilding | Stage C |
| CAS/symbolic math dependency | Defer; use numeric/exact checkers first | Avoid dependency and correctness complexity | Stage D |
| First promotion threshold | Conservative v0 thresholds listed in Stage F | Prevents bad lessons becoming trusted | Stage F |
| Quant extension | Defer until math v0 loop is green | Avoid jumping to high-noise market research | Stage I+ |
