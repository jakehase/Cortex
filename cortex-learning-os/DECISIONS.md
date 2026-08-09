# Cortex Learning OS Decisions

Append-only durable decisions for the project. Keep current state in `STATUS.md`; keep strategy in `plan.md`.

## Decision entry format

```markdown
## YYYY-MM-DD — <short decision title>

- Decision: <what changed>
- Reason: <why>
- Evidence: <commit/artifact/check>
- Supersedes: <older path/decision or n/a>
- Follow-up: <next action or n/a>
```

## Decisions

## 2026-07-07 — Create Cortex Learning OS as a verifier-gated learning layer

- Decision: Create `/root/clawd/cortex-learning-os` as the canonical project path for a learning layer built from capsules, curricula, practice attempts, verifiers, mistake ledgers, lesson promotion gates, and retrieval packs.
- Reason: Jake asked to turn the memory-system learning idea into a plan; the system should learn through exams and verified lessons, not raw memory volume or model-weight changes.
- Evidence: `/root/clawd/cortex-learning-os/plan.md`; `/root/clawd/docs/PLAN_INDEX.md`; `cd /root/clawd && node scripts/plan-doctor.mjs` returned `ok` with `0` errors, `5` indexed plans, and `17` pre-existing backup/DR plan-like warnings.
- Supersedes: Chat-only brainstorming about “Cortex Learning OS.”
- Follow-up: Start Wave 1 schema design.

## 2026-07-07 — Expand CLOS plan into execution checklist and estimates

- Decision: Keep initial implementation code local to `/root/clawd/cortex-learning-os`, and expand the plan with detailed stages A-I, token/time estimates, token budget rules, confusion-prevention rules, and pre-code decisions.
- Reason: Jake asked to make the plan thorough, organized, and detailed enough to prevent confusion, including estimates for token usage and time.
- Evidence: `/root/clawd/cortex-learning-os/plan.md` sections 18-21; `cd /root/clawd && node scripts/plan-doctor.mjs` returned `ok` with `0` errors, `5` indexed plans, and `17` pre-existing backup/DR plan-like warnings.
- Supersedes: The earlier high-level wave list as the only implementation guide.
- Follow-up: Start Stage A local scaffold when implementation is requested.

## 2026-07-07 — Confirm Cortex Learning OS plan already follows detailed planning standard

- Decision: Keep Cortex Learning OS as the reference example for the new detailed planning style, with only the estimate section title normalized to the shared template wording.
- Reason: It already contains detailed stages, acceptance checks, estimates, confusion-prevention rules, and open decisions before code starts.
- Evidence: `/root/clawd/cortex-learning-os/plan.md` sections 18-21.
- Supersedes: n/a.
- Follow-up: Use Stage A local scaffold when implementation begins.

## 2026-07-07 — Complete Stage A local scaffold

- Decision: Add a dependency-light local scaffold for Cortex Learning OS under `/root/clawd/cortex-learning-os`.
- Reason: Jake asked to execute low-token setup items first; Stage A is useful scaffolding without the heavier schema/capsule authoring work.
- Evidence: `package.json`, `src/paths.mjs`, `src/json.mjs`, `src/hash.mjs`, `src/validate-fixtures.mjs`, `tests/scaffold.test.mjs`.
- Supersedes: Planning-only state for Stage A.
- Follow-up: Stage B schema design remains next and is intentionally deferred until requested because it is more token-intensive.

## 2026-07-25 — Restart on an isolated branch and preserve the dormant prototype

- Decision: Base the restart on `origin/main` in worktree `/root/clawd/worktrees/cortex-learning-os-v0-20260725`, branch `feat/cortex-learning-os-v0-20260725`, and preserve the prior local prototype as commit `cb7b93007` before extending it.
- Reason: The original `/root/clawd/cortex-learning-os` directory was untracked inside a dirty, diverged memory-repair branch. Isolating the work prevented unrelated workspace changes from contaminating CLOS history.
- Evidence: commit `cb7b93007`; the preserved package passed its original `9/9` tests and fixture validation before extension.
- Supersedes: untracked-only local prototype state.
- Follow-up: merge/push the production slice through the authoritative remote default branch after final validation.

## 2026-07-25 — Quarantine a false-negative derangement verifier run

- Decision: Reject and quarantine run `math-foundations-smoke-20260725-052532795Z`; add regression checks for `D_6=265`, `D_8=14833`, `D_9=133496`, and `D_10=1334961`.
- Reason: The generated deterministic oracle incorrectly expected `0`, while Cortex's baseline and correction answers were correct. Promoting that “mistake” would teach a false lesson.
- Evidence: `artifacts/_quarantine/false-derangement-oracle-20260725-052532795Z/QUARANTINE.md`; `tests/math-foundations.test.mjs`.
- Supersedes: the run's original `blocked_correction_failed` interpretation.
- Follow-up: keep verifier regression fixtures as first-class evidence and never use the quarantined run for capability claims.

## 2026-07-25 — Complete and promote the first bounded learning loop

- Decision: Accept the exact-arithmetic stress run as the first qualified CLOS learning-loop proof and write its trusted lesson, retrieval pack, capability report, and qualified-run pointer to the canonical math-foundations capsule paths.
- Reason: The recorded model run produced a real deterministic baseline failure, passed a correction and independent promotion retest, satisfied all 10 promotion gates, and passed a different held-out item after loading the promoted retrieval pack.
- Evidence: implementation commit `b03add355`; `artifacts/math-foundations-smoke-20260725-052939567Z`; `artifacts/latest-qualified-run.json`; manifest replay `36/36`; local tests `14/14`.
- Supersedes: planning/scaffold-only CLOS status.
- Follow-up: run equal-difficulty randomized A/B retests before claiming retrieval causality or durable transfer.

## 2026-07-25 — Promote the qualified slice to the authoritative remote default branch

- Decision: Push `feat/cortex-learning-os-v0-20260725`, then fast-forward remote `main` after confirming `origin/main` remained an ancestor and the diff touched only `cortex-learning-os/` plus `docs/PLAN_INDEX.md`.
- Reason: The accepted production slice must live on the canonical default path and authoritative remote, not remain an opt-in local worktree.
- Evidence: `git ls-remote` showed both `main` and the feature branch at `944808d729183a1ec1ed0c6c114a6f0e024d35dc` immediately after promotion; `/root/clawd/cortex-learning-os` then matched the integrated project tree across all 139 files.
- Supersedes: feature-branch-only availability.
- Follow-up: preserve bounded claims and proceed to randomized equal-difficulty A/B transfer testing.

## 2026-07-25 — Preregister paired retrieval-versus-no-retrieval evidence

- Decision: Use 27 randomized identical-item pairs (54 fresh ephemeral Codex sessions), one generated exact-multiplication item per pair, deterministic exact grading, no allowed tools, no outcome-driven reruns, and a fixed two-sided exact McNemar analysis. Require at least 24 valid pairs and report mechanical completion separately from the bounded evidence gate.
- Reason: The prior 19/20 batch baseline and single-item post-promotion retest differ in task count and difficulty, so they cannot establish that retrieval caused the later pass. Pairing identical items removes that primary confound while fresh sessions prevent conversational carryover.
- Evidence: `src/ab-experiment.mjs`, `src/run-ab-experiment.mjs`, `src/model-answer-runner.mjs`, `tests/ab-experiment.test.mjs`; local `npm test` `19/19`; paired plan-only and fake-worker full-lifecycle smokes green.
- Supersedes: using the prior baseline/retest difference as retrieval-effect evidence.
- Follow-up: recover safe free space on Hetzner, launch the frozen experiment remotely, preserve a null result honestly if the preregistered gate does not pass, and do not auto-promote ordinary-task routing from one run.

## 2026-07-25 — Preserve the paired retrieval A/B as a mechanically green null result

- Decision: Record experiment `math-foundations-paired-ab-20260725T1600Z` as completed but threshold-not-passed, and make no retrieval-benefit, retrieval-harm, broad-learning, durability, mastery, or model-weight claim from it.
- Reason: All 27 pairs were valid, but pack and no-pack each passed 26/27; the paired lift was `0`, pack-only and no-pack-only wins were tied `1–1`, and the exact two-sided McNemar p-value was `1.0`. The `96.3%` accuracy in both arms also indicates a ceiling-limited efficacy test.
- Evidence: exact execution source `bde94bf4f872a75e7c744bc9b37c9b91e41a9600`; remote artifact `artifacts/math-foundations-paired-ab-20260725T1600Z`; local returned artifact `/root/clawd/artifacts/cortex-learning-os-ab-20260725/returns/math-foundations-paired-ab-20260725T1600Z`; `54/54` trials, `27/27` valid pairs, zero tool events, usage on every trial, return-bundle checksum pass, and `464/464` manifest hashes verified.
- Supersedes: treating the earlier single held-out pass as evidence that retrieval caused improvement.
- Follow-up: do not promote routing from this run. If another efficacy experiment is approved, preregister harder out-of-sample paired items that reduce ceiling effects while preserving the same fail-closed causal design.

## 2026-07-25 — Authorize one capped mechanism-and-utility go/no-go validation

- Decision: Give the Learning OS concept one bounded efficacy test comprising a genuinely novel seeded synthetic-procedure acquisition/transfer track and a low-sensitivity private-workspace correction retrieval track. Freeze the complete program before model calls, cap it at 111 calls, require both tracks to pass fixed effect, no-regression, token, and latency gates, and keep any successful result shadow-only pending a separate integration decision.
- Reason: The earlier generic multiplication A/B was ceiling-limited and returned zero lift, so further broad implementation without unique-information evidence would risk becoming gimmicky. Synthetic procedure transfer tests the mechanism, while recurring private corrections test practical utility.
- Evidence: `docs/go-no-go-validation-contract.md`; `src/go-no-go-experiment.mjs`; `src/run-go-no-go-validation.mjs`; `tests/go-no-go-experiment.test.mjs`; local tests `26/26`; frozen real-fixture plan smoke; fake-worker full-lifecycle smoke with acquisition promotion, both tracks passing, and complete manifest replay.
- Supersedes: the prior next step of an unspecified harder math efficacy test; the scope is now limited to these two stronger tests.
- Follow-up: push the isolated branch, run remotely on Hetzner with the private fixture outside Git, return and verify all artifacts, and accept either a clean pass, honest no-go, or blocker without outcome-driven broadening.

## 2026-07-25 — Accept the capped validation as a terminal no-go for broad Learning OS integration

- Decision: Record program `clos-go-no-go-20260725T181142Z` as mechanically complete but program-threshold-not-passed. Preserve CLOS as a verified memory/retrieval toolkit; do not enable default routing, broadly expand the OS framing, or rerun based on outcomes.
- Reason: Acquisition and the synthetic mechanism track passed strongly, but the private-workspace utility pack scored `27/27` versus `24/27` without the pack: `+11.11` percentage points and exact McNemar p `0.25`, below the frozen `+20` and p `≤0.05` effect requirements. The model inferred 24 of 27 utility answers without retrieval, so practical incremental value was too small for the declared gate.
- Evidence: remote artifact `/home/jake/clawd-runs/clos-go-no-go-20260725T181142Z/artifacts/clos-go-no-go-20260725T181142Z`; returned artifact `/root/clawd/artifacts/cortex-learning-os-go-no-go-20260725/returns/clos-go-no-go-20260725T181142Z`; `111/111` model calls, `108/108` valid transfer trials, `54/54` valid pairs, zero observed tool events, return checksum pass, and `950/950` manifest hashes verified.
- Supersedes: any expectation that a mechanism-only pass would justify default Learning OS integration.
- Follow-up: retain the verification, promotion, provenance, expiration, rollback, and bounded retrieval machinery as a toolkit; require a separate explicit decision for any future narrow retrieval application.

## 2026-07-25 — Correct the project-level interpretation of the first utility no-go

- Decision: Keep the first utility run's frozen no-go intact, but stop treating it as a reliable rejection of broader selective private retrieval.
- Reason: No-pack scored `24/27` and pack scored `27/27`, so the item set allowed at most `11.11` percentage points of observed lift and could not reach its 20-point gate. That is a ceiling-limited test, not evidence that a harder non-inferable private-fact workload cannot benefit.
- Evidence: returned analysis for `clos-go-no-go-20260725T181142Z`; utility pack `27/27`, no-pack `24/27`, p `0.25`; Jake's explicit ceiling correction in the follow-up thread.
- Supersedes: the broad wording that the terminal no-go alone justified stopping all further utility validation.
- Follow-up: any new test must be prospective, harder in the private-information dimension, and must never append outcome-selected items to the completed run.

## 2026-07-25 — Authorize one corrected open-ended private-utility validation

- Decision: Run one utility-only validation with a separately frozen disjoint calibration pool and held-out pool: 12 calibration facts / 24 no-pack sessions, then—only if headroom is confirmed—30 held-out private-fact clusters / 60 paired prompts / 120 sessions. Cap the full program at 144 calls and keep all behavior shadow-only.
- Reason: Open-ended, genuinely non-inferable private facts create meaningful headroom while a disjoint calibration gate catches another ceiling before spending the held-out budget. Treating facts as clustered statistical units prevents two paraphrases from being falsely counted as independent evidence.
- Evidence: `docs/private-utility-validation-contract.md`; `src/private-utility-experiment.mjs`; `src/run-private-utility-validation.mjs`; `tests/private-utility-experiment.test.mjs`; local tests `32/32`; real-fixture 144-session plan smoke; fake-worker `144/144` lifecycle and manifest replay.
- Supersedes: using the first multiple-choice utility fixture as the final project-level efficacy test.
- Follow-up: push exact source without fixtures, freeze both fixture hashes and the full schedule before calls, execute detached on Hetzner, and accept pass, no-go, calibration stop, or blocker without outcome-driven modification.

## 2026-07-25 — Accept the corrected validation as a selective shadow candidate

- Decision: Accept validation `clos-private-utility-20260725T192921Z` as a bounded pass for `go_selective_private_retrieval_shadow_candidate`; do not interpret it as default answer-path approval, broad ordinary-task utility, autonomous learning, durability, or model-weight learning.
- Reason: The disjoint calibration confirmed no-pack headroom, and the frozen held-out treatment cleared every validity, effect, no-regression, token, and latency gate at both item and clustered-fact levels.
- Evidence: returned `analysis.json` and `campaign_state.json` under `/root/clawd/artifacts/cortex-learning-os-private-utility-20260725/returns/clos-private-utility-20260725T192921Z`; `144/144` completed calls; calibration `24/24` valid with no-pack cluster accuracy `0/12`; held-out pack/no-pack item accuracy `60/60` versus `4/60`; clustered accuracy `30/30` versus `1/30`; cluster lift `96.67` points; exact McNemar p `4e-9`; zero no-pack-only clusters; maximum pack `271` tokens; return manifest `1,218/1,218` verified.
- Supersedes: the unresolved status of broader selective private utility after the first ceiling-limited fixture, while preserving that first run's immutable contract-level no-go.
- Follow-up: implement only a privacy-safe observe-only shadow and gather live backend evidence before proposing any answer influence.

## 2026-07-25 — Enable selective private retrieval only as an isolated shadow observer

- Decision: Make selective private retrieval default-on in `observe_only` mode behind an immediate kill switch. Nexus may classify and asynchronously retrieve a bounded principal-scoped candidate pack, but candidate content cannot enter routing, prompt context, reasoning, tools, or user-visible answers. Record only capped content-free telemetry joined by opaque observation IDs.
- Reason: The corrected validation justifies measuring the candidate against the real authenticated retrieval backend, but it does not prove live classifier precision, production retrieval quality, or causal answer benefit. Shadow isolation collects those facts without changing behavior or exposing private content.
- Evidence: `public/cortex_server/cortex_server/modules/private_retrieval_shadow.py`; Nexus integration and authenticated status endpoint in `public/cortex_server/cortex_server/routers/nexus.py`; route-gate isolation and telemetry in `plugins/cortex-route-gate/index.ts`; deployment controls in `public/docker-compose.yml`; contract in `public/cortex_server/docs/private-retrieval-shadow.md`; Python and Node tests covering eligibility, sensitive exclusions, principal isolation, bounded packs, failures, concurrency, atomic capped persistence, prompt/cache isolation, and no-content telemetry.
- Supersedes: validation-harness-only availability of the selective private retrieval candidate.
- Follow-up: inspect shadow eligibility/retrieval/latency evidence; require a separate explicit treatment/control promotion decision before any answer-path use.

## 2026-07-25 — Authorize a harder domain-specific novel-math validation

- Decision: Run one new preregistered 225-call math-learning benchmark using a seeded invented pair algebra, disjoint no-context calibration, fail/correct/retest promotion, randomized paired direct and compositional transfer, ordinary-arithmetic non-interference controls, and paired retrieval after a clean runner-process restart.
- Reason: The completed multiplication A/B was ceiling-limited and proved no incremental benefit for already-known multiplication. The later synthetic and private-fact tests proved general retrieval transfer and utility, but not domain-specific acquisition and generalization of genuinely new mathematical knowledge.
- Evidence: Jake's explicit “Do it” approval after the harder-math recommendation; `docs/novel-math-validation-contract.md`; `src/novel-math-experiment.mjs`; `src/run-novel-math-validation.mjs`; `src/verify-novel-math-artifacts.mjs`.
- Supersedes: treating the multiplication null result as the only available test of the math section; the historical result itself remains unchanged.
- Follow-up: validate locally, push exact source, run a real-worker canary, preregister on Hetzner, execute detached across the required process boundary, independently verify returned artifacts, and accept pass, frozen no-go, or blocker without outcome-driven modification.

## 2026-07-25 — Accept the verified bounded novel-math threshold pass

- Decision: Accept run `clos-novel-math-20260726T034546Z` as a verified pass for the frozen claim `bounded_acquisition_retention_and_fresh_session_generalization_for_one_seeded_novel_mathematical_microtheory`.
- Reason: All `225/225` preregistered real Codex calls completed. Definition-disjoint calibration confirmed headroom; acquisition and promotion passed; direct, compositional, ordinary-math regression, and clean-process durability tracks passed; every call had matching provider/model/runtime/usage evidence; and independent artifact verification returned `verified_threshold_pass` with zero errors.
- Evidence: execution commit `bb84e5b077db11223b088c063820a614e2f2c429`; frozen program SHA-256 `46724dbcd2d43b7ba9d6dfe31ef78083f5fc7febdcbc5b1137c9db0c31ca2c42`; returned archive SHA-256 `5b3c6219e070a6cc12b86486fa3e11fdf08b6d34924482981758a194eafee680`; verified return root `/root/clawd/artifacts/cortex-learning-os-novel-math-20260726/clos-novel-math-20260726T034546Z/returned`.
- Boundary: Do not relabel this as broad math improvement, long-duration or human-like learning, autonomous self-improvement, or model-weight change. The completed multiplication null result and all other prior contracts remain unchanged.
- Follow-up: Preserve the result and use a new prospectively approved contract for any broader domain, longer-duration, multi-seed, or answer-path claim.

## 2026-07-25 — Promote the reusable v0.6 mechanism, not the synthetic lesson

- Decision: Fast-forward the validated reusable novel-math acquisition, promotion, paired-evaluation, restart-integrity, and independent-verification machinery into canonical `main`; sync the same source to the canonical local and Hetzner default paths. Do not promote the benchmark's generated microtheory or trusted-lesson artifact into canonical capsules or the answer path.
- Reason: The verified run qualifies the mechanism for canonical availability, while its allowed claim is limited to one seeded invented microtheory. Loading synthetic test content into ordinary answers would exceed the evidence and create irrelevant behavior.
- Evidence: `origin/main` fast-forward through `ffc82c17c9aaae8c801941cba02c0108de77784b`; local and remote tests `41/41`; fixture validation green; remote canonical `validate:novel-math:plan` smoke at `0/225` executed calls with claimable `codex-cli 0.144.1` provenance; no novel-math diff under `capsules/`.
- Boundary: Canonical availability is not automatic answer influence. Any real lesson must independently clear fail/correct/retest promotion and the applicable safety/privacy approval before retrieval can affect a user-visible answer.
- Follow-up: Use the canonical harness prospectively for approved domains; preserve synthetic benchmark artifacts as evidence only.

## 2026-07-26 — Integrate verifier-promoted real math lessons into the live answer path

- Decision: Make CLOS a canonical live OpenClaw subsystem for narrowly matched real math lessons. Use an owner-only signed registry, independent control-plane replay of every learning and promotion phase, expiry and kill switches, content-free influence telemetry, and explicit isolation from training/Oracle/cron/subagent sessions. Keep synthetic benchmark lessons in artifact-only quarantine.
- Reason: Jake explicitly asked to move beyond a green harness and reach a state where the Learning OS is fully integrated and ready for ongoing math training. The existing exact-multiplication lesson independently passed the real math-foundations promotion and held-out gates, while the harder synthetic microtheory remains unsuitable for ordinary answers.
- Evidence: `docs/live-math-integration-contract.md`; `src/live-control.mjs`; `plugins/cortex-learning-os-live/`; live integration and Codex worker tests in the v0.7 suite.
- Supersedes: the v0.6 boundary that no CLOS lesson could affect ordinary answers. It does not supersede the prohibition on synthetic benchmark content or the null ordinary-multiplication A/B result.
- Follow-up: deploy and validate the canonical plugin/registry, run positive and negative live canaries, sync Hetzner, and preserve broad-math/model-weight claims as blocked.

## 2026-07-26 — Place repeatable math training on Hetzner with independent promotion and notification

- Decision: Start future real math training through a detached Hetzner Codex worker. A separate control-plane harvester must copy and re-verify candidate artifacts before signed-registry installation, while the standard detached notifier independently reports terminal completion or failure.
- Reason: Heavy model work must not block or overload the OpenClaw control host, and a remote worker must not be able to activate a self-reported lesson merely by writing green booleans or recomputing a transport manifest.
- Evidence: `scripts/remote-math-training-worker.sh`; `scripts/harvest-live-math-training.py`; `scripts/launch-live-math-training.sh`; independent replay/tamper tests.
- Supersedes: manually running `dogfood:* --promote-default` on the control host as the normal training path.
- Follow-up: use `./scripts/launch-live-math-training.sh --exam stress` for the next approved run; the no-call readiness gate is `--dry-run`.

## 2026-07-26 — Complete the v0.7 live math integration and training-readiness gate

- Decision: Mark the scoped math production slice ready for use. Keep the first independently promoted exact-multiplication lesson active, and permit future math learning runs only through the detached Hetzner launcher and independent control-plane promotion path.
- Reason: The production plugin loaded cleanly; positive and negative live canaries passed; local and remote suites passed `51/51`; registry integrity, privacy scan, gateway health, and local/remote source equality passed; and the no-model-call detached-launcher dry run passed.
- Evidence: implementation source `ef493ac15ebe4e193606e0b10b237ed81607af84`; `/root/.openclaw/cortex-learning-os/live-registry.json`; `/root/.openclaw/cortex-learning-os/telemetry.json`; `/tmp/clos-training-dry-run.json`; `STATUS.md` live integration section.
- Boundary: Ready means verifier-gated memory/retrieval learning for the declared math curricula. It does not mean model-weight training, broad math mastery, causal answer improvement, or automatic support for arbitrary domains.
- Follow-up: Start `./scripts/launch-live-math-training.sh --exam stress` only when Jake asks to begin the first post-integration run; accept a promoted lesson, an honest no-mistake stop, or a blocker without outcome-driven fabrication.

## 2026-07-26 — Complete the first post-integration live math-training cycle

- Decision: Accept retry `math-training-20260726T154658Z-e7e74b` as a completed verifier-gated learning cycle and install its independently replayed lesson `lesson_aadf75a434c4a1a9` into signed live registry revision `2`. Preserve failed attempt `math-training-20260726T154152Z-2244e4` as mechanical incident evidence only.
- Reason: The first attempt exposed a real transient-systemd PATH defect before model work. The canonical launcher/worker fix now preflights and passes the exact Codex executable under service user `jake`; the retry then passed the full remote worker, control-plane replay/install, signed-registry, and notifier path.
- Evidence: source/fix commit `aabb79b3ee267db6771d897d4a014e7a5c840e65`; local and exact worker-environment tests `52/52`; remote state `/home/jake/clawd-remote/state/cortex-learning-os/math-training-20260726T154658Z-e7e74b.json`; verified local artifact `/root/clawd/artifacts/cortex-learning-os-training/incoming/math-training-20260726T154658Z-e7e74b`; baseline `7/20`, correction/retest/held-out green, 36-file manifest, live registry signature valid, and terminal WhatsApp message `3EB04446BDDF17B203E295` delivered.
- Boundary: This supports only a bounded exact-multiplication learning sequence. It does not prove retrieval causality, broad or durable mathematics learning, mastery, autonomous self-improvement, or model-weight change.
- Follow-up: Monitor content-free activation and retest state; before another run, decide whether semantically equivalent promoted lessons should be deterministically deduplicated instead of accumulated.

## 2026-07-26 — Deduplicate equivalent live lessons and preserve newest evidence

- Decision: Compute a deterministic semantic key from capsule, domain, concepts, normalized rule, contraindications, and activation profiles; retain the newest promotion evidence for each key during every install and expose a signed-registry dedupe operation. Apply it to the live registry while preserving the pre-change registry and all originating run artifacts.
- Reason: The two active exact-multiplication records encoded the same remediation rule. Accumulating equivalent records added no distinct knowledge and could inject redundant context.
- Evidence: commit `a4c98acf07e81b241889f511bef4a674a5439f2e`; local and exact Hetzner worker-environment tests `53/53`; backup `/root/.openclaw/cortex-learning-os/backups/live-registry.revision-2.20260726T163151Z.json`; signed registry revision `3` with retained `lesson_aadf75a434c4a1a9`; content-free canary selected only that lesson.
- Supersedes: allowing semantically equivalent live lesson records to accumulate solely because their evidence-derived lesson IDs differ.
- Follow-up: Keep source artifacts immutable and monitor the retained lesson's activation and retest deadline.

## 2026-07-26 — Independently verify no-observed-mistake outcomes

- Decision: Treat a perfect baseline with no observed mistake as `candidate_no_lesson`, not as a worker failure or an unverified terminal success. The control-plane harvester must copy the manifest-backed artifacts, independently replay attempts/verifiers/score, verify real model provenance and positive usage, confirm no lesson artifacts exist, and only then mark the run completed without installing a lesson.
- Reason: Challenge run `math-training-20260726T163228Z-72fb6d` scored `20/20`, but its expected process exit `3` triggered the inherited shell `ERR` trap before the worker normalized the status. The math result was valid while the orchestration label was wrong.
- Evidence: recovery commit `4788779dfbd39deb00e54024ba115d2adea0b491`; local and exact Hetzner tests `54/54`; independently replayed local return `/root/clawd/artifacts/cortex-learning-os-training/incoming/math-training-20260726T163228Z-72fb6d`; corrected terminal state with baseline `20/20`, no installed lesson, signed registry revision `3`, and WhatsApp delivery `3EB0B7ECA2CC6B1C7245BE`.
- Supersedes: trusting the worker alone for no-lesson completion and the unsafe `set +e`/`ERR`-trap exit capture path.
- Follow-up: Do not repeat this perfect challenge merely to force a lesson; use a prospectively declared harder supported-profile exam if further ordinary-math acquisition is approved.

## 2026-07-26 — Make adaptive curriculum the default detached math-training mode

- Decision: Implement the frozen v0.8 adaptive curriculum contract as the canonical future launcher default. Keep baseline/challenge/stress fixed exams only behind explicit `--exam`; preserve their historical behavior and verifier.
- Reason: A fixed exam cannot provide prerequisite-aware selection, integrity-protected mastery, scheduled reviews, all-concept generated practice, bounded remediation, or failure-derived lesson candidates. The adaptive path adds those capabilities without moving trust to the remote worker.
- Architecture: The control plane validates the 36-node DAG, verifies signed owner-only mastery, selects exactly one action, and freezes a source/policy/curriculum/mastery-digest-bound plan. The worker uses seeded local-oracle exercises, may synthesize one strict no-tool model candidate only after a deterministic failure, and preregisters identical-item fresh-session candidate/no-context pairs. It emits only artifacts and a proposed delta. The harvester invokes independent regeneration, grading, provenance, candidate, exact-paired-analysis, policy, and delta replay before atomically signing mastery and optionally updating the existing signed live registry.
- Promotion boundary: Mechanical completion is separate from threshold qualification. A paired null result cannot install a lesson. Even a threshold pass needs a checked-in approved narrow activation profile. Unsupported-profile candidates remain evidence only.
- Evidence: `policies/adaptive-math-v0.8.json`; `src/curriculum-planner.mjs`; `src/generated-exercises.mjs`; `src/mastery-state.mjs`; `src/model-candidate.mjs`; `src/adaptive-evaluator.mjs`; `src/adaptive-session.mjs`; `src/adaptive-verifier.mjs`; `src/run-adaptive-curriculum.mjs`; detached launcher/worker/harvester changes; 9 deterministic adaptive tests with no model calls.
- Boundary: This is implementation and deterministic qualification, not live empirical adaptive learning. No adaptive session was executed, no canonical production mastery was advanced, and no new lesson was installed in this job.
- Supersedes: the v0.7 recommendation to use `--exam stress` as the ordinary next launcher behavior. It does not alter completed v0.7 evidence or allow worker-authored state mutation.
- Follow-up: Run the canonical no-call adaptive dry-run and the exact remote suite in an execution environment that permits nested subprocesses; only a separately authorized live adaptive session may create new empirical evidence.

## 2026-07-26 — Bind the adaptive release to exact artifacts and runtime truth

- Decision: Release v0.8 only with manifest-digest-bound applied-run receipts, a signed exact provider/model/reasoning/read-only runtime, independent summary/evidence-count replay, monotonic mastery timestamps, bounded consecutive-failure remediation, and terminal `blocked` publication for verified structured blockers.
- Reason: Run-ID-only idempotence could otherwise accept substituted artifacts, a blocker could be mislabeled as completion, lifetime attempt totals could strand legitimate lapse recovery, and self-consistent worker metadata could overstate the runtime or summary evidence actually returned.
- Evidence: hostile replay tests for same-run artifact substitution, false lesson-summary claims, model usage/tool/timing mutation, ordered tuple reversal, exact Bernoulli fractions, lapse recovery, and prerequisite attempt exhaustion; local and exact Hetzner suites `63/63`; fixture validation green; isolated adaptive-plan smoke bound to `openai-codex` / `gpt-5.6-sol` / reasoning `low` / read-only sandbox.
- Boundary: These checks qualify the implementation and control-plane trust boundary. They are not an empirical adaptive-learning result, mastery claim, lesson promotion, or authorization to run a live adaptive session.

## 2026-07-26 — Promote the verified adaptive implementation to the canonical default

- Decision: Atomically publish implementation commit `3141a74b8c1873605e7ef9a162a5043360a85a78` to the feature branch and `origin/main`, sync that exact tree and source marker to the control-plane and Hetzner canonical paths, and initialize signed revision-zero mastery through the adaptive-default no-call launcher dry-run.
- Reason: An accepted production feature is not finished while it exists only in an isolated worktree or unpublished branch. The authoritative remote, both canonical runtime paths, and the launcher preflight must agree before the default-path claim is allowed.
- Evidence: local canonical tests `63/63`; remote canonical adaptive/live/plugin tests `22/22`; fixture validation green on both hosts; source-tree content comparison clean; source markers and `origin/main` all matched; dry-run `math-training-20260726T191549Z-d125a2` used adaptive mode and froze a signed `gpt-5.6-sol` acquisition plan without a model call.
- Boundary: Promotion makes the adaptive engine and launcher default available. It does not execute adaptive training, advance mastery, install a lesson, or create empirical learning evidence.

## 2026-07-26 — Use mode-specific non-empty remote worker arguments

- Decision: Invoke adaptive workers as `run-id, adaptive, source-commit, codex-path, plan-path` and legacy workers as `run-id, exam, source-commit, codex-path`; reject every other mode at the worker boundary. Do not transport an empty adaptive exam placeholder through SSH/systemd.
- Reason: Real launch `math-training-20260726T193442Z-c47d96` proved that the empty quoted argument was lost when SSH reconstructed the remote command, shifting the Codex path into the expected-commit position. The worker correctly failed closed before state initialization and before a model call, but the launcher dry-run could not expose this transport behavior.
- Evidence: incident artifact `/root/clawd/artifacts/cortex-learning-os-real-adaptive-20260726/incident-pre-model-argument-shift.json`; full local suite `63/63`; Hetzner transient-systemd argument smoke reached `adaptive plan must be a regular file` and did not emit `invalid expected commit`.
- Boundary: A retry after this verified infrastructure repair is continuation of the single authorized session because the failed launch produced zero provider calls and zero learning evidence. It does not authorize outcome-driven reruns after a real attempt result.

## 2026-07-26 — Prove signed-plan readability as the execution user before launch

- Decision: After copying an adaptive plan, set `jake:jake` ownership and owner-only mode, verify it with `sudo -u jake -- test -r`, and require the worker itself to reject unreadable plans before creating run artifacts. The adaptive CLI must fail explicitly when JSON loading returns no object.
- Reason: Recovery run `math-training-20260726T194031Z-3b3dfe` copied the plan through root SSH as `root:root` mode `0600`; the `jake` systemd service could stat but not read it. Generic JSON fallback then produced a misleading null dereference. This was a transport/deployment defect, not a training outcome.
- Evidence: incident artifact `/root/clawd/artifacts/cortex-learning-os-real-adaptive-20260726/incident-pre-model-plan-permission.json`; remote ownership/readability proof; empty remote artifact root; notifier delivery record.
- Boundary: Ownership changes apply only to the per-run signed plan. Canonical mastery stays owner-only on the control plane, and the execution worker receives no authority to mutate or sign it.

## 2026-07-26 — Propose a separate semantic math-to-code transfer truth layer

- Decision: Add a v0.9 review candidate in which mathematical mastery, coding-transfer qualification, signed-registry activation, runtime answer influence, and empirical benefit remain separate records and claims. Declare only `exact-multiplication` and `algebra-factoring`; initialize their transfer state as `unassessed` and all other curriculum concepts as explicit `no_qualified_transfer`.
- Architecture: Use enumerated code-first semantic matchers, observable-assumption checks, hard negative gates, deterministic seeded acquisition/held-out/negative/assumption/regression families, local oracles, inert worker proposals, exact manifest replay, owner-only HMAC state, and a distinct signed transfer registry/trust root. Live transfer defaults to enabled shadow observation with zero answer influence.
- Reason: Mathematical success alone does not establish that a concept improves software work, and lexical overlap is not a safe activation mechanism. Qualification must be independently replayable and active use must fail closed at every boundary.
- Evidence: Candidate source and future test fixtures only. No test suite, model call, benchmark, qualification run, registry installation, live configuration change, or empirical benefit observation was performed in this implementation task.
- Boundary: This is a proposed implementation decision pending review and verification, not an accepted production release or claim that either profile transfers.

## 2026-07-27 — Add an executable inert semantic-transfer qualification worker

- Decision: Execute frozen semantic-transfer plans with a secretless worker that
  emits only owner-only attempts, content-free provider-call evidence, an inert
  proposal, and an exact byte manifest. Keep authentication, deterministic replay,
  qualification, state signing, and registry changes exclusively in the
  independent control plane.
- Reason: v0.9 had plan/apply/replay primitives and an inert proposal builder but
  no production path that could obtain real paired model evidence.
- Evidence: `src/run-transfer-qualification.mjs`,
  `src/transfer-qualification-worker.mjs`, and deterministic fake-adapter tests
  covering two-arm coverage, routing isolation, expected-answer privacy,
  provenance privacy, resume, drift, malformed output, exact manifests, and
  independent replay compatibility.
- Boundary: These are implementation tests only. No real model call occurred,
  neither profile qualified, thresholds are unchanged, and no live state,
  configuration, service, or registry changed. A later real run can correctly
  produce a null outcome.
- Runtime decision preserved: release defaults may be active, while active mode
  injects nothing without a qualified signed enabled entry.

## 2026-07-27 — Harden the transfer worker and retain an inert active-default release boundary

- Decision: Ship the coding-transfer runtime default as enabled `active`, but initialize an empty signed registry and require a separately signed qualified entry before any context can influence an answer. Do not run a real transfer qualification as part of this release; resume the due math review instead.
- Hardening: Freeze provider/model/reasoning/read-only/tool-free runtime in the signed plan; require provider and model binding plus positive provider-observed input/output usage; reject tool events; balance run-seeded arm order; durably checkpoint successful concurrent peers; reject duplicate call identities; and strictly bind two monic polynomial factors to two verified roots.
- Evidence: Locked local release gate `79/79`, fixture validation, syntax checks, 50 JSON parses, isolated signed-state/empty-registry control smoke, and hostile tests for missing provider evidence, runtime drift, concurrent interruption, tool events, expected-answer leakage, malformed output, duplicated resume rows, and incomplete polynomial roots.
- Boundary: Fake-adapter tests prove mechanics only. No real transfer model call occurred, neither profile is qualified, the initial registry has zero entries, and active-default therefore has zero transfer answer influence until a later separately authorized qualification and promotion.

## 2026-07-27 — Deploy v0.9 active-default transfer bridge with an empty signed registry

- Decision: Promote the mechanically verified bridge to the canonical OpenClaw plugin path and restart the gateway with transfer defaulting to `active`, while initializing the independent signed registry with zero entries.
- Evidence: Locked local gate `79/79`; exact Git-backed Hetzner gate `79/79`; fixture, syntax, and JSON validation; live plugin canaries `12/12`; healthy gateway probe; valid owner-only signed transfer state and registry; live telemetry with zero active applications.
- Correction caught before activation: The first config draft named a non-canonical registry trust-root path. Deployment verification rejected it; configuration was corrected to the initialized owner-only `transfer-registry.hmac` path before the gateway restart.
- Boundary: Deployment makes the bridge available but inert. Neither profile is qualified, the registry has zero entries, active mode applies no context, and no coding-transfer benefit is claimed.

## 2026-07-27 — Make xhigh the canonical adaptive-learning launch effort

- Decision: The detached adaptive launcher defaults to `xhigh`. The policy's `low` runtime remains a minimum reasoning floor for compatibility with already signed mastery; a control-plane-signed plan may strengthen that effort but may not weaken it or change provider, model, read-only sandbox, or no-tool constraints.
- Hardening: Bind the selected reasoning effort in the signed plan and require the returned raw Codex ledger to contain the exact matching `model_reasoning_effort` argument during independent replay. The runtime CLI now inherits model/reasoning from the signed plan rather than a local low default.
- Correction: Run `math-training-20260727T020121Z-cf935b` was mechanically valid and independently applied under its signed `low` runtime before the operator correction arrived, but it is not accepted as the intended xhigh review. Preserve it as superseded historical evidence, restore the exact signed revision-1 mastery snapshot proven by its own frozen plan digest, and replace it with a fresh xhigh factoring review.
- Boundary: A stronger reasoning setting does not itself prove mastery or transfer. The replacement still requires deterministic grading, exact artifact replay, and independent signed-state application.

## 2026-07-27 — Accept only the xhigh replacement factoring review

- Replacement run `math-training-20260727T022800Z-318c45` executed with the signed `xhigh` runtime and an exact raw `model_reasoning_effort="xhigh"` argument, then passed independent control-plane artifact, grading, runtime, and policy replay.
- Canonical mastery advanced from the restored signed revision 1 to revision 2 under the replacement receipt. The superseded low run `math-training-20260727T020121Z-cf935b` is intentionally absent from canonical `appliedRunIds`.
- The factoring result is one passed spaced review and schedules the next review for 2026-07-28; it does not prove broad mastery, model-weight learning, or semantic coding transfer.

## 2026-07-27 — Make xhigh the universal production default and preserve signed state

- Decision: Set OpenClaw global, `main`, and `oracle` agent defaults; every Learning OS production runtime/CLI/launcher fallback; the adaptive policy; and both Oracle executors to `xhigh`. The Oracle executor rejects a weaker environment override, and a static Learning OS regression test rejects weaker production defaults while preserving intentional negative tests and historical evidence.
- State migration: Verify and back up canonical signed mastery under the former policy, then re-sign the unchanged concept and applied-run state under the xhigh policy. The policy-only migration advanced the state revision from 2 to 3 and preserved both applied receipts.
- Incident repair: The Oracle endpoint's older recurring `503` was not an xhigh failure. `openclaw agent --local --json` completed successfully at xhigh but emitted response JSON to stderr with plugin logs before and after it; the bridge parsed stdout only. Parse combined process output and select only a response-shaped JSON object.
- Evidence: Learning OS `81/81` locally and in an exact Git-backed Hetzner checkout; Oracle `10/10` locally and on the live VM; direct raw runtime `requestShaping.thinking=xhigh`; repaired endpoint response `ORACLE_XHIGH_ENDPOINT_OK` from `openai-codex/gpt-5.6-sol`; healthy gateway and Oracle probes; origin branches and canonical source markers aligned.
- Boundary: Historical signed low-runtime artifacts remain immutable evidence of what ran then, not current defaults. `xhigh` configuration proves the requested runtime setting, not hidden provider reasoning-token expenditure, better answers, mastery, transfer benefit, or model-weight learning.

## 2026-07-27 — Repair weighted-mean grading and preserve failed candidate diagnostics

- Decision: Grade generated `statistics-weighted-mean` answers with deterministic absolute tolerance `1e-9` after explicitly requesting an exact fraction or at least nine decimal places. Preserve the failed candidate-synthesis raw call ledger and exact prompt, and require independent replay to verify their runtime, no-tool boundary, nonzero exit or explicit launch error, observed-failure linkage, and absence of fabricated output.
- Reason: Continuation child `math-training-20260727T054803Z-53b400` returned the correct rounded decimal `7.6666666667` for `23/3`, but strict binary-float equality compared it with `7.666666666666667` and created a false mathematical failure. Candidate synthesis then exited 1, while the old catch path retained only the generic message and deleted the temporary raw diagnostics.
- Evidence: Exact incident-seed regression accepts `7.6666666667` and `23/3` but rejects `7.66`; hostile replay mutates the failed worker sandbox and is rejected; local and Hetzner service-user suites pass `83/83`; fixtures and syntax checks are green.
- State boundary: Preserve the original structured blocker and signed mastery revision 69 unchanged. The repair does not retroactively pass that run or fabricate a mastery delta. A separately approved resume starts a fresh source-bound continuation from revision 69 and remains subject to the same first-blocker stop rule.

## 2026-07-27 — Supersede active review with versioned continuous acquisition

- Decision: Implement Jake's instruction, “stop the reviews just keep learning,” as a new `adaptive-math-continuous-v1` policy over a new `math-continuous-acquisition-v1` graph. The canonical planner selects acquisition, learning retry, prerequisite correction, or same-concept correction only. It never selects or schedules a review, ignores stale historical review dates when checking acquired prerequisites, rejects early-review directives, and returns `curriculum_frontier_reached` when the declared graph is exhausted.
- Compatibility: Preserve `adaptive-math-v0.8.json`, the original 36-node `curriculum.graph.json`, schema-v1 mastery, and their review transitions for revision-74 signature verification and audit/rollback tests. Do not reinterpret signed historical state under the new graph or policy.
- State semantics: Schema v2 records a successful first pass or correction as `acquired`, meaning covered once under the recorded call and deterministic verifier. Failures enter `learning` and may produce bounded correction work. No active transition creates `nextReviewAt`, and no v2 record calls one pass mastered, retained, or a spaced-review success.
- Curriculum: Retain the original 36 concept records and add exactly 48 coherent concepts across algebra/precalculus, calculus, linear algebra, probability/statistics, discrete mathematics, number theory, and optimization. All 84 concepts require seeded local-oracle exercise families and complete-item independent regeneration.
- Migration: Add a one-shot control-plane migration that verifies the revision-74 HMAC with the legacy graph/policy and caller-frozen source identities, rejects removal or rewriting of old concepts, advances revision exactly once, preserves historical counters/evidence/receipts/review timestamps, clears active review deadlines, maps legacy `review`/`mastered` to `acquired`, initializes only new concepts as unassessed, emits a signed audit artifact, and atomically signs v2 state. Repeating or applying the migration to drifted/tampered state fails closed.
- Runtime boundary: Keep one Hetzner child at a time, at most 100 sessions, 24 hours total across resume, four hours per child, and stop at the first genuine blocker. The remote worker remains secretless and proposal-only; independent control-plane replay and signing remain mandatory.
- Boundary: This source implementation does not migrate live revision 74, launch a model session, prove durable retention, prove broad mathematical mastery, change model weights, or establish autonomous learning. Acquisition evidence is only bounded model-call performance on the named independently replayed exercises.

## 2026-08-08 — Preregister representative applied-mathematics transfer qualification

- Decision: Start from exact source `55ca78a723f678c1c8bb17ae90e73649075156e9` on isolated branch `feat/cortex-learning-os-applied-math-transfer-20260808`. Freeze a representative 12-concept treatment bundle, 10 transfer families with three variants each, and five unrelated regression families with two variants each. Prove one paired hidden-test canary before authoring or running the full 40-task / 80-call program.
- Causal design: Separate task and treatment authors, deny each access to the other's output, freeze both SHA-256 digests before integration, use byte-identical paired task prompts and fresh `gpt-5.6-sol`/`xhigh`/no-tools sessions, and accept only deterministic hidden-verifier results plus independently replayed provider evidence.
- Retention decision: Preserve the August 5 deterministic `19/19` answer comparison as raw unqualified evidence only. Its `runnerAttestation` is null and authenticated application failed with `retention trusted raw execution failed: trusted execution attestation signature mismatch; answer/output binding mismatch`; do not synthesize or backdate an attestation and do not mutate canonical state. A retained-transfer claim requires a prospective runner repair and two disjoint authenticated windows at least 24 hours apart with the identical treatment digest.
- Thresholds: Require zero invalid scored trials, candidate accuracy at least `0.875`, no-pack accuracy at least `0.75`, lift at least `0.125`, more pack-only than no-pack-only wins, exact two-sided McNemar `p <= 0.05`, compositional and domain non-regression gates, zero semantic-negative injections, and no ordinary-coding regression.
- Boundary: A pass is retrieval-mediated evidence for the frozen representative surfaces only. It does not prove all 264 concepts are retained, human-equivalent or PhD-level understanding, model-weight change, Lean qualification, autonomous research ability, or production routing safety. The phase may emit shadow-routing eligibility but cannot activate production routing without a separate inspected change and explicit operator approval.
- Evidence: `docs/applied-math-transfer-contract.md`; `policies/applied-math-transfer-v1.json`; `benchmarks/applied-math-transfer-v1/`.
- Supersedes: Chat-only intent to use PhD mathematics broadly in coding without an empirical transfer contract; prior bounded transfer results remain immutable.
- Follow-up: Implement and independently replay the one-pair canary; scale only if it is green.

## 2026-08-08 — Supersede transfer qualification with direct implementation and one smoke

- Decision: Stop the 40-task/80-call benchmark, canary, and review path. Use Jake's new standing workflow: plan the change, make it, run exactly one focused smoke test, then apply/deploy it.
- Implementation: Add eight scoped applied-mathematics coding profiles to the canonical transfer bridge: numerical stability, network flow/matching, matrix conditioning, constrained optimization, stochastic reliability, state invariants/counterexamples, causal analysis, and modular reconstruction. Add an owner-only signed-registry installer that records them honestly as `operator_enabled` with `activationBasis=operator_direct` rather than independently qualified.
- One test: A single focused temporary-registry smoke selected only `numerical-stability` for a stable online-variance coding request, loaded the signed operator entry, and rendered `1625` characters of active context. Result: `ok=true`, registry revision `1`.
- Historical artifacts: Preserve preregistration commit `b9f6bfa282eb2c1dd7d77fe0fe1114c494b2cc85` and detached implementation worker `clos-applied-math-impl-20260808T235336Z`, but do not merge or run their expanded test/canary harness by default.
- Boundary: The one smoke proves mechanical routing/context behavior only. It does not prove retained mastery, broad transfer efficacy, regression freedom, model-weight change, PhD equivalence, Lean qualification, or research ability.
- Supersedes: The immediately preceding applied-mathematics transfer-qualification decision's execution/follow-up. Its artifact history remains valid; its campaign is not active.
- Applied: Source commit `833acc3ded6d61592947341d4041073d133b7ce1` was pushed; exact plugin source was installed on the canonical live path; eight signed operator-direct entries were applied at transfer-registry revision `1`; transfer context capacity was set to `4000`; and the restarted gateway reached active/running state with connectivity healthy. Deployment backup: `artifacts/cortex-learning-os-applied-math-direct-20260808/deploy-20260809T011451Z/`.

## 2026-08-08 — Expand active mathematics transfer to all 264 declared curriculum concepts

- Decision: Supersede the eight-profile applied-math v1 with an exact source-bound catalog over all `264/264` unique concepts in `math-phd-trajectory-v1`. Generate one signed `operator_enabled` / `operator_direct` entry per concept, use deterministic explicit-title/ID and curated application routing with bounded lexical fallback, select at most three entries, and record only selected profiles in telemetry.
- Implementation: Add `phd-math-transfer-catalog.v1.json`, a machine-readable 264-row surface matrix, catalog-driven matcher descriptors, concept-specific bounded operational context, 320-entry signed-registry support, selected-only runtime integration, and an exact full-spectrum installer. Raise the live context cap from `4000` to `8000` while preserving hard rejection above the configured bound.
- Workflow evidence: The one focused full-spectrum smoke passed with 264 catalog concepts, 264 signed entries, the expected three numerical-linear-algebra profiles, and `5656` rendered characters. No broad test campaign, canary set, or review round was run.
- Migration correction: The first guarded apply rejected the eight legacy IDs under the new matcher semantics before replacement and rolled back before restart. The installer now verifies the old owner-only registry envelope and HMAC first, removes only superseded `operator_direct` entries, refuses to discard incompatible independently qualified entries, then atomically signs the new catalog. The one focused migration smoke passed from 8 to 264 profiles at revision 2.
- Applied: Runtime source `d8f90f520d0b592cd1ce1601af0aafbe1afd21af` and migration fix `0a8e4177e3ee947b6a7a952def91aa96d37d9ed9` are pushed. The canonical plugin path matches the committed product source; live registry revision `2` contains 264 enabled operator-direct entries covering 264 unique concepts; configured context capacity is `8000`; and the gateway restarted active.
- Boundary: “Full spectrum” is exact curriculum-surface availability through bounded retrieval guidance. It does not prove empirical improvement, retention, model-weight learning, PhD equivalence, proof qualification, or autonomous research ability. Operator activation must not be relabeled independent qualification.
- Supersedes: The eight-profile scope in the immediately preceding direct-implementation decision. Its smoke and deployment remain immutable historical checkpoints.

## 2026-08-08 — Supersede external PhD-equivalence study with continuous evidence-bearing math learning

- Decision: Scratch `clos-phd-equivalence-usefulness-v1` as the active direction. Preserve its branch/commit only as immutable planning history; do not merge it, contact evaluators, recruit participants, spend funds, or launch its scored program.
- Replacement objective: Continue through the existing 264-concept trajectory while running four separate evidence lanes: prerequisite-aware acquisition, disjoint near-term validity, real elapsed-time R7/R30/R90 retention, and paired everyday Cortex utility qualification.
- Architecture: Extend the existing `adaptive-math-phd-v1` acquisition path, signed independent assessment-bank trust, `phd-retention-v1` machinery, detached Hetzner worker/control-plane harvester boundary, and signed live transfer registry. Do not build a parallel learning engine or reinterpret `acquired` as retained.
- Everyday boundary: Current 264 profiles remain honestly `operator_available`. Content-free telemetry may identify high-frequency candidates, but only privacy-safe paired treatment/control evidence may grant `utility_qualified` or `everyday_preferred` status. Raw conversations and user corrections cannot directly mutate lessons or signed state.
- First milestone: Run a no-model-call/no-mutation Phase-0 audit of exact live states, banks, execution readiness, and the full 264-row evidence matrix; then select the next prerequisite-ready cohort from observed state.
- Evidence plan: `docs/continuous-math-learning-validity-retention-everyday-plan.md`; canonical roadmap Wave 5.9.
- Boundary: This decision is planning, not proof of new acquisition, validity, retention, usefulness, or model-weight learning.
