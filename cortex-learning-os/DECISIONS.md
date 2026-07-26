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
