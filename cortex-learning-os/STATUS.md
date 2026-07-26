# Cortex Learning OS Status

## Metadata

- Project slug: `cortex-learning-os`
- Canonical plan: `/root/clawd/cortex-learning-os/plan.md`
- Decisions log: `/root/clawd/cortex-learning-os/DECISIONS.md`
- Last updated: `2026-07-25 23:22 CDT`
- Status: `active`
- Current fidelity: `production_slice_plus_default_on_selective_private_retrieval_shadow_observer`
- Package version: `0.6.0`

## Current checkpoint

Cortex Learning OS has completed its first bounded, verifier-gated learning loop for the math-foundations capsule. The implementation is integrated into the authoritative remote `main`; the verified implementation commit is `b03add355` and its first lifecycle/documentation integration commit is `944808d72`. The feature branch `feat/cortex-learning-os-v0-20260725` is preserved at that integration point.

The production slice now includes:

- 32 machine tests covering contracts, deterministic checkers, fail-closed promotion, retrieval limits, curriculum coverage, learning-loop behavior, paired randomization, strict Codex structured output, frozen-runtime resume enforcement, exact McNemar analysis, Codex tool-event detection, dual-track go/no-go planning, disjoint private calibration/holdout design, fact-cluster analysis, cost/no-regression gates, and fail-closed fixture/runtime validation.
- 14 JSON record schemas plus internal contract validation.
- A 36-concept math-foundations curriculum.
- A 30-item deterministic baseline exam, a 20-item exactness/reliability challenge, and a 20-item exact-arithmetic stress exam.
- Recorded no-tool OpenClaw/Cortex answer capture with provider/model/usage provenance.
- Attempt records, verifier results, mistake records, candidate lessons, promotion reports, trusted lessons, retrieval packs, capability reports, and hashed manifests.
- Canonical default capsule files under `capsules/math-foundations/`.
- A preregistered randomized paired A/B harness for 27 identical-item pairs / 54 fresh Codex sessions, at least 24 valid pairs, deterministic grading, fail-closed invalid-trial handling, and separate mechanical versus evidence thresholds.

## Latest qualified evidence

- Qualified pointer: `artifacts/latest-qualified-run.json`
- Artifact root: `artifacts/math-foundations-smoke-20260725-052939567Z`
- Artifact manifest: 36 files, direct SHA-256 replay check `36/36` matched.
- Model path: OpenClaw isolated/non-delivering agent sessions; provider `openai-codex`; model `gpt-5.6-sol`; no tools declared.
- Exact-arithmetic stress baseline: `19/20` (`0.95`), with one deterministic multi-digit multiplication failure.
- Correction: `1/1` passed.
- Independent promotion retest: `1/1` passed.
- Promotion gate: all 10 gates passed; lesson `lesson_e30152a45fdf9a6a` promoted with 90-day retest date.
- Held-out post-promotion retest: `1/1` passed using the canonical 336-token retrieval pack.
- Canonical default update: completed (`defaultPromoted=true`).
- Latest local validation: `npm test` passed `14/14`; `npm run validate:fixtures` passed with 12 valid records and 1 intentionally invalid record.
- Latest A/B branch validation: `npm test` passed `21/21`; fixtures passed; paired plan-only and fake-worker lifecycle smokes froze and completed successfully before the real A/B model calls.

## Latest randomized A/B evidence

- Experiment: `math-foundations-paired-ab-20260725T1600Z`.
- Exact execution source: branch `feat/cortex-learning-os-ab-20260725`, commit `bde94bf4f872a75e7c744bc9b37c9b91e41a9600`.
- Mechanical result: completed `54/54` fresh ephemeral Codex trials across all `27/27` valid pairs; zero invalid trials and zero observed tool events.
- Provider evidence: model `gpt-5.6-sol`; usage present for `54/54` trials; `795,631` input tokens, `352,000` cached input tokens, `24,304` output tokens, and `22,374` reasoning-output tokens recorded.
- Paired outcome: both arms passed `26/27` (`96.2963%`); `25` both-pass pairs, `0` both-fail pairs, `1` pack-only win, and `1` no-pack-only win.
- Estimated effect: absolute pack lift `0`; two-sided exact McNemar p-value `1.0`.
- Evidence gate: **not passed**. The run is mechanically green but provides no bounded evidence that the retrieval pack helped or harmed under this declared configuration.
- Artifact verification: the control-plane return bundle checksum passed and all `464/464` manifest-listed files matched SHA-256.

## Approved capped go/no-go validation

- Reply anchor: Jake approved the recommendation to give the underlying lesson/retrieval idea one rigorous bounded chance: novel synthetic mechanism transfer plus recurring private-workspace utility, with no default integration unless both pass.
- Harness: 3-call synthetic acquisition/promotion gate, then 27 mechanism pairs and 27 private-utility pairs in fresh ephemeral sessions; 111 model calls maximum.
- Preregistered per-track gates: at least 24 valid pairs, invalid rate no greater than 10%, at least 20-point lift, exact McNemar p no greater than 0.05, at most one no-pack-only regression, mean input overhead no greater than 1,200 tokens, pack estimate no greater than 900 tokens, and median latency overhead no greater than 10 seconds.
- Privacy: the nine-rule/27-item utility fixture is outside the public repository and passed a targeted credential/email/IP/secret-pattern scan.
- Local validation: `npm test` passed `26/26`; real-fixture plan smoke froze 111 calls and 108 unique transfer sessions without model calls; fake-worker full lifecycle completed 105/105 calls for the reduced 24-item test fixture, promoted acquisition, passed both synthetic tracks, and replayed every manifest hash.
- Terminal execution: `111/111` model calls completed; acquisition promoted; all `108/108` transfer trials and `54/54` pairs were valid; zero observed tool events; usage recorded on every transfer trial.
- Mechanism result: **passed** — pack `27/27`, no-pack `0/27`, absolute lift `100` points, exact McNemar p `1.5e-8`; all cost/no-regression gates passed.
- Utility result: **threshold not passed** — pack `27/27`, no-pack `24/27`, absolute lift `11.11` points versus required `20`, exact McNemar p `0.25`; no-regression and cost gates passed but the effect gate failed.
- Program decision: **NO-GO — preserve as verified memory/retrieval toolkit**. No default integration, broad OS claim, or outcome-driven rerun is allowed.
- Artifact return: tarball checksum passed and the control plane verified `950/950` manifest files with zero mismatches.

## Corrected selective private-utility validation

- Interpretation correction: the first utility arm was ceiling-limited. No-pack scored `24/27` while pack was perfect, so the maximum observable lift was `3/27 = 11.11` points—below the frozen 20-point gate. Its contract-level no-go remains immutable, but it cannot reliably reject broader selective private retrieval.
- Reply anchor: Jake approved one corrected harder utility-only validation by saying “Do it” after identifying the ceiling.
- Design: freeze both disjoint fixture pools before any model call; calibration has 12 facts / 24 open-ended no-pack sessions; held-out efficacy has 30 independent facts, two paraphrases per fact, 60 identical-item pairs / 120 fresh sessions; 144-call maximum.
- Primary statistical unit: one private-fact cluster. Both paraphrases must pass for an arm to pass that cluster. Calibration facts contribute no held-out wins.
- Calibration gate: at least 90% valid; no-pack item accuracy no greater than 60%; no-pack cluster accuracy no greater than 50%. A failure stops before held-out calls.
- Held-out gate: at least 90% valid pairs/clusters, pack item accuracy at least 90%, pack cluster accuracy at least 85%, item and cluster lift at least 20 points, exact cluster-level McNemar p no greater than 0.05, at most one no-pack-only cluster, and all token/latency gates.
- Privacy: 12 calibration facts and 30 different held-out facts are low-sensitivity, open-ended, and outside Git; no credentials, client-identifying facts, financial identifiers, email addresses, or network addresses.
- Local validation: `npm test` passed `32/32`; real-fixture plan smoke froze 144 calls and 144 unique sessions; fake-worker full lifecycle completed `144/144`, passed calibration and all clustered held-out gates, and replayed every manifest hash.
- Terminal state: all `144/144` calls completed; calibration and held-out validation passed; decision `go_selective_private_retrieval_shadow_candidate`.
- Calibration: `24/24` valid items, no-pack item accuracy `1/24` (`4.17%`), no-pack cluster accuracy `0/12`; headroom gate passed.
- Held-out items: `60/60` valid pairs; pack `60/60`, no-pack `4/60`, absolute lift `93.33` points, zero no-pack-only outcomes.
- Held-out clusters: `30/30` valid; pack `30/30`, no-pack `1/30`, `29` pack-only clusters, zero no-pack-only clusters, absolute lift `96.67` points, exact McNemar p `4e-9`.
- Cost gates: maximum observed pack `271` tokens, mean input overhead `277.07` tokens, median latency overhead `-1.389` seconds; all frozen validity/effect/no-regression/token/latency gates passed.
- Returned artifact verification: checksum passed and `1,218/1,218` manifest-listed files matched SHA-256 with zero mismatches.

## Approved selective private-retrieval shadow implementation

- Reply anchor: after the corrected validation passed, Jake approved implementing the selective private-retrieval candidate.
- Integration boundary: default-on **observe-only** shadow execution. Retrieval candidates cannot alter model context, route selection, reasoning text, tool decisions, or user-visible answers.
- Nexus classifies only bounded private-fact, preference, prior-decision, project-state, and operational-setting lookups; it rejects action/generation requests, unanchored general questions, external volatile lookups, sensitive-secret terms, empty input, and oversized shadow input.
- Retrieval uses `librarian.robust_search()` with the authenticated principal's tenant and derived storage-workspace scope. It simulates at most 3 candidates / 600 estimated tokens by default, then discards all content.
- Execution is asynchronous and fail-open, with a two-worker pool, bounded pending queue, per-principal rate limit, latency-SLA telemetry, immediate kill switch, and no answer-path dependency.
- Telemetry stores only opaque observation IDs and content-free operational fields. Raw queries, prompts, snippets, candidate scores, source IDs, metadata bodies, outputs, and exception messages are excluded.
- Server and route-gate state are principal-scoped, record-capped, lock-protected, atomically replaced, and mode `0600`; ephemeral observation markers are stripped from last-good route caches and never rendered into prompts.
- Authenticated content-free inspection is available at `GET /nexus/private-retrieval-shadow/status`.
- Promotion remains blocked: shadow retrieval success, pack availability, latency, and baseline run success are not causal quality evidence. Answer-path use requires a separate approved treatment/control evaluation and privacy review.
- Deployment state: implemented and validated on `feat/cortex-learning-os-ab-20260725` as the deployment candidate; not yet merged into remote `main` or activated in a live service by this change.

## Completed harder novel-math validation

- Reply anchor: Jake approved the harder math-learning test with “Do it” after asking whether the math section should receive a more difficult evaluation.
- Exact execution source: branch `feat/cortex-learning-os-novel-math-20260725`, commit `bb84e5b077db11223b088c063820a614e2f2c429`; pushed and verified on `origin` before execution. Frozen `program.json` SHA-256: `46724dbcd2d43b7ba9d6dfe31ef78083f5fc7febdcbc5b1137c9db0c31ca2c42`.
- Design: one seeded private invented pair algebra; separate definition-disjoint no-context calibration; three-call fail/correct/retest acquisition and promotion; 30 direct pack/no-pack pairs; 30 compositional pairs; 25 ordinary-arithmetic interference pairs; and 20 paired durability items after a clean runner-process restart. Maximum and executed budget: `225/225` unique fresh Codex calls.
- Runtime evidence: provider `openai-codex`, model `gpt-5.6-sol`, reasoning `low`, tools forbidden, default Codex worker `codex-cli 0.144.1`; all `225/225` records had positive runtime, matching provider/model metadata, and positive provider-observed input/output usage. No explicit worker override was used.
- Calibration passed: `12/12` valid; no-pack `0/12`; headroom confirmed without contributing any target-theory efficacy wins.
- Acquisition passed: the no-context baseline failed, correction passed, independent compositional retest passed, and the scoped target lesson promoted.
- Direct transfer passed: `30/30` valid pairs; pack `30/30`, no-pack `0/30`, `+100` percentage-point lift, exact two-sided McNemar `p=2e-9`.
- Compositional transfer passed: `30/30` valid pairs; pack `30/30`, no-pack `0/30`, `+100` points, exact two-sided McNemar `p=2e-9`.
- Ordinary-math regression passed under deliberately irrelevant retrieval: `25/25` valid pairs; both arms `25/25`; absolute harm `0`.
- Clean-process durability passed: a distinct second Node process reloaded the unchanged trusted-lesson digest after the immediate process exited; `20/20` valid pairs, pack `20/20`, no-pack `0/20`, `+100` points, exact two-sided McNemar `p=1.907e-6`.
- Final truth layers: mechanical green `true`; frozen outcome pass `true`; real-model-work evidence pass `true`; threshold pass `true`; independent verification decision `verified_threshold_pass` with zero errors.
- Return verification: archive SHA-256 `5b3c6219e070a6cc12b86486fa3e11fdf08b6d34924482981758a194eafee680`; the control plane matched all `2,146/2,146` manifest entries. Verified return root: `/root/clawd/artifacts/cortex-learning-os-novel-math-20260726/clos-novel-math-20260726T034546Z/returned`.
- Allowed claim: `bounded_acquisition_retention_and_fresh_session_generalization_for_one_seeded_novel_mathematical_microtheory`. This does not prove broad math improvement, human-like or time-durable learning, autonomous self-improvement, or model-weight change.

Additional honest evidence:

- The initial 30-item baseline scored `30/30`; the loop stopped rather than fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052255174Z`.
- The corrected reliability challenge scored `20/20`; it also stopped without fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052716583Z`.
- An earlier reliability-challenge run was invalid because the generated derangement oracle incorrectly expected `0`. Cortex's answers `D_10=1334961` and `D_6=265` were correct. That root is preserved only as verifier-regression evidence under `artifacts/_quarantine/false-derangement-oracle-20260725-052532795Z/` and produced no candidate/default promotion.

## Active blockers / unproven surfaces

- The completed bounded production slice remains green.
- The randomized A/B executed successfully, but its preregistered evidence threshold did not pass: both arms scored `26/27`, lift was `0`, and exact McNemar p was `1.0`.
- Broad math improvement and time-durable learning remain unproven. The novel-math run proved one unchanged lesson survived a clean process boundary, not long-duration retention.
- Retrieval-pack benefit and harm remain unproven under the declared exact-multiplication/model/runtime configuration.
- Retrieval-mediated benefit is now proven only for one seeded invented mathematical microtheory under the novel-math contract; do not generalize that result to ordinary known mathematics or broader domains.
- The capped mechanism track proved bounded retrieval transfer for seeded novel information. Its first private-workspace utility arm failed the frozen effect threshold (`+11.11` points, p `0.25`) and remains an immutable no-go for that contract, although the corrected held-out validation later passed its separate frozen gates.
- The corrected validation proves bounded utility only for selectively routed, genuinely non-inferable private workspace facts represented by its frozen pool.
- Ordinary Cortex answer behavior remains unchanged. The observer is default-on only in shadow mode and cannot inject retrieved content.
- Real-world classifier precision, retrieval availability, production latency distribution, and answer-quality lift under the live retrieval backend remain unproven.
- Model weights were not changed.

## Next actions

1. Preserve the completed A/B, go/no-go, corrected private-utility, and novel-math validations with their separate frozen claims unchanged.
2. Merge/deploy the validated selective-retrieval shadow candidate through normal change control, retaining the immediate kill switch.
3. Run the selective observer in production shadow mode long enough to measure eligibility precision, empty/error rates, bounded pack availability, and latency without answer influence.
4. Review content-free telemetry and manually audited, privacy-safe samples; tune only prospectively.
5. Require a new approved identical-item treatment/control contract before any retrieved candidate can enter model context or affect answers.

## Do not use / superseded

- Do not treat AI OS, SLOS, or Cortex/Codex consolidation as this project; they are related assets, not the CLOS implementation path.
- Do not use the quarantined false-derangement run as learning or capability evidence.
- Do not treat deterministic expected-answer fixtures as model capability evidence.

## Truth boundary

Allowed claims:

- Cortex Learning OS has a working, artifact-backed production slice.
- One bounded exact-arithmetic failure was followed by passed correction, independent promotion retest, and a different held-out retest after a gated retrieval pack.
- One scoped lesson passed the declared promotion gates and is available on the canonical capsule path.
- In the capped go/no-go, seeded synthetic-procedure retrieval transferred perfectly across fresh sessions under the declared runtime.
- The private-utility pack improved three of 27 paired items with no regressions, but this did not meet the first preregistered utility effect threshold.
- The corrected, disjoint clustered private-utility validation passed all frozen gates under its declared workload and supports only a selective shadow candidate.
- The preregistered harder novel-math validation passed all frozen calibration, acquisition, direct-transfer, compositional-transfer, ordinary-math regression, clean-process durability, provider-evidence, and independent-integrity gates for one seeded invented microtheory.
- The selective observer may retrieve and record content-free operational evidence while remaining isolated from the answer path.

Not allowed:

- Cortex broadly learned mathematics.
- The retrieval pack alone caused the held-out pass.
- The improvement is durable across sessions or time.
- Cortex is an expert mathematician, quant PM, or profitable trader.
- Model weights changed.
- Live trading or external financial actions are approved.
- Shadow pack availability or successful retrieval proves answer-quality improvement.
- Private retrieval is approved to influence prompts, reasoning, tools, or user-visible answers.
