# Cortex Learning OS Status

## Metadata

- Project slug: `cortex-learning-os`
- Canonical plan: `/root/clawd/cortex-learning-os/plan.md`
- Decisions log: `/root/clawd/cortex-learning-os/DECISIONS.md`
- Last updated: `2026-07-27`
- Status: `v0_9_4_owner_authorized_early_review_green_pending_live_session`
- Current fidelity: `production_single_session_early_review_qualified_pending_launch`
- Package version: `0.9.4`

## Current checkpoint

**v0.9.4 explicit early-review path qualified:** the ordinary planner remains time-gated by default so scheduled reviews retain their retention meaning. An owner may now explicitly request one immediate early practice review with `--early-review`. The HMAC-signed plan binds an exact `owner_authorized_early_review` directive, authorization timestamp, `single_session` scope, and truth boundary; normal due reviews, repairs, acquisitions, and retries retain priority, and the override selects only the earliest future eligible review when the ordinary planner would otherwise stop. Independent replay regenerates the action from that exact signed directive and rejects directive mutation even when the transport manifest is recomputed. Early practice may advance signed mastery after normal evidence gates but must never be labeled due/overdue retention evidence.

Local qualification is green at `84/84`, fixture validation is green, syntax/schema/diff checks pass, and an isolated no-call CLI proof from signed mastery revision `73` selected `algebra-factoring` with xhigh and the exact single-session directive. Jake explicitly authorized immediate execution; the previously armed due-time timer was disabled and cancelled. Remote qualification, canonical commit/push/deploy, and the one detached live session remain pending before any runtime or mastery claim.

**v0.9.3 weighted-mean and candidate-diagnostic repair qualified:** authorized continuation `math-continuation-20260727T043434Z-305671` stopped honestly at its first replay-verified blocker after 67 child sessions. The first 66 children advanced signed mastery from revision 3 to 69; final child `math-training-20260727T054803Z-53b400` selected `statistics-weighted-mean`, received rounded answer `7.6666666667` for exact value `23/3`, and was rejected by a strict binary-float equality check before its candidate-synthesis worker exited 1. The blocker advanced no state. Canonical mastery remains signature-valid revision 69 with 34 concepts in review, 2 unassessed, and no pending repair; the lesson registry remains unchanged.

Generated weighted-mean exercises now explicitly accept an exact fraction or a decimal accurate to at least nine places and use deterministic `1e-9` numeric tolerance. The exact incident seed passes for both `7.6666666667` and `23/3` while rejecting `7.66`. A failed candidate-synthesis process now persists its raw call ledger and exact prompt in owner-only artifacts; the independent verifier replays the observed failure and prompt, checks the signed model/reasoning/read-only/no-tools runtime, requires either a genuine nonzero exit or an explicit launch error, binds the summary exit code, and rejects fabricated candidate output. The original blocker artifacts remain immutable historical evidence.

Qualification is green: full local suite `83/83`, exact Hetzner service-user staging suite `83/83`, fixtures `12` valid plus `1` intentionally invalid, syntax checks green, and hostile diagnostic-runtime mutation rejected. No resumed model session was launched during this repair qualification; the separately approved resume must start a new source-bound continuation from signed mastery revision 69.

**Universal xhigh-default rollout complete:** OpenClaw's global default and explicit `main` and `oracle` agent defaults are `xhigh`, and the gateway was restarted with a healthy connectivity probe. Every Learning OS production model runtime, CLI fallback, transfer runtime, remote launcher, and checked-in adaptive policy now defaults to `xhigh`; a regression test rejects weaker production literals. Canonical mastery was signature-verified against the former policy, backed up, and migrated from revision 2 to revision 3 under policy digest `5b2cef824cab80cf0ae3c7ccf2604c2a43b081df29e5a0168529ce50ba8f57f5` without changing concept state or applied-run receipts.

The Oracle executor now defaults to and fail-closes on `xhigh`, exposes the setting through `/health`, and passes `--thinking xhigh` to OpenClaw. Its pre-existing recurring `503` was traced to successful `openclaw agent --local --json` output being written to stderr between plugin log prefixes and suffixes while the bridge parsed stdout only. The parser now selects the response-shaped JSON object from combined process output. Local and VM Oracle tests pass `10/10`; direct runtime evidence recorded `requestShaping.thinking=xhigh`; and the repaired endpoint returned exact response `ORACLE_XHIGH_ENDPOINT_OK` from `openai-codex/gpt-5.6-sol` through session `oracle-prod-bridge-short-acc9d6eb3a7a`.

Release verification: local Learning OS suite `81/81`; exact Git-backed Hetzner suite `81/81`; fixtures green; local and Hetzner canonical Learning OS trees content-identical after excluding runtime caches/artifacts; Oracle unit tests `10/10` both locally and on the live VM; gateway and Oracle health probes green. Implementation commits are `f80a25fde09be878841c4bffbe82f1a1409df8d0`, `55aa1f05587b2bcc0a072e6a34579f4c8887f811`, and Oracle output repair `d261220a85bbe2a267c8dcc1ab91c5a03da695ec`.

**Adaptive-runtime correction complete:** `math-training-20260727T020121Z-cf935b` completed mechanically under its signed `low` runtime but is retained only as superseded historical evidence. The exact signed revision-1 mastery snapshot was restored. Canonical release `577f8cdd635b2dcb7d8df528c1594af0923b81f9` freezes `xhigh` in each signed adaptive plan and independently requires the exact raw Codex runtime argument. Replacement run `math-training-20260727T022800Z-318c45` executed with raw `model_reasoning_effort="xhigh"`, passed deterministic factoring replay, and was independently applied. Mastery reached revision 2 at that checkpoint; the later policy-only xhigh migration advanced it to revision 3 without changing concepts or receipts. The superseded low run remains absent from applied receipts.

The v0.9 semantic coding-transfer implementation is deployed on the canonical OpenClaw path. It declares two bounded profiles (`exact-multiplication` and `algebra-factoring`), keeps transfer state distinct from mastery, and initializes an independent signed transfer registry with zero entries. The runtime default is enabled `active`, but the empty registry produces zero transfer context. The other 34 concepts are explicit `no_qualified_transfer`; the two declared surfaces remain `unassessed`. No profile is qualified.

The implementation includes strict schemas, digest-bound profiles and policy, run-seeded balanced two-arm ordering, strict exact oracles, a signed provider/model/reasoning/read-only/tool-free runtime contract, an enumerated router with hard negative gates, signed owner-only atomic transfer state, a secretless executable worker with durable concurrent resume, positive provider-usage evidence, exact-manifest replay, separate apply/promotion commands, independent transfer telemetry, and deterministic tests.

Release evidence is green: locked local gate `79/79`, exact Git-backed Hetzner gate `79/79`, fixture and syntax validation, 50 JSON parses, isolated empty-registry control smoke, live plugin canaries `12/12`, valid owner-only signed transfer state/registry, healthy gateway reload, and live observations showing `activeApplied: 0`. No real transfer qualification was performed and no empirical coding-transfer benefit is claimed. Historical v0.8 math mastery and signed lesson records below are unchanged.

Cortex Learning OS v0.8 now contains the frozen adaptive-curriculum production slice. The default detached launcher freezes one control-plane-selected curriculum action; the remote worker can collect evidence and propose a delta only; the harvester independently regenerates items, re-grades answers, replays model provenance/candidate/paired policy, signs canonical mastery, and conditionally updates the existing signed lesson registry. The v0.7 fixed-exam path remains available explicitly. The implementation qualification itself made no empirical claim; one later authorized live adaptive session has now completed as recorded below. Historical v0.7 live lesson and no-mistake evidence remains unchanged, and the separate selective private-retrieval subsystem remains observe-only.

The production slice now includes:

- 63 machine tests, including 9 new adaptive tests for graph/planner behavior, the complete generator catalog, signed mastery, candidate quarantine, paired pass/null outcomes, hostile artifact replay, idempotence, and budget exhaustion.
- 19 JSON record/output schemas plus internal contract validation.
- A 36-concept math-foundations curriculum.
- A checked-in digest-bound adaptive policy with prerequisite gates, 0/1/7/30/90-day review stages, finite session budgets, candidate limits, and exact paired thresholds.
- Deterministic seeded exercise families and local oracles for every role across all 36 concepts.
- A signed atomic canonical mastery store and pure replayable transitions with pending prerequisite repair and run-ID idempotence.
- Manifest-digest-bound run receipts: an exact retry is idempotent, while artifact substitution under a reused run ID fails closed.
- A strict structured no-tool model candidate path that is allowed only after independently graded failure and rejects answer leakage and fixed-template copying.
- A six-pair fresh-session candidate-context/no-context gate requiring all valid pairs, at least 83% candidate accuracy, at least 50-point lift, no control-only regression, and exact McNemar p at most 0.05.
- Adaptive worker artifacts, inert proposed deltas, independent control-plane replay/application, and adaptive-default launcher/worker/harvester integration.
- A signed provider/model/reasoning/read-only runtime contract, terminal `blocked` publication for structured blockers, ordered-coordinate checking, exact rational Bernoulli verification, and bounded consecutive-failure remediation.
- A 30-item deterministic baseline exam, a 20-item exactness/reliability challenge, and a 20-item exact-arithmetic stress exam.
- Recorded no-tool OpenClaw/Cortex answer capture with provider/model/usage provenance.
- Attempt records, verifier results, mistake records, candidate lessons, promotion reports, trusted lessons, retrieval packs, capability reports, and hashed manifests.
- Canonical default capsule files under `capsules/math-foundations/`.
- A preregistered randomized paired A/B harness for 27 identical-item pairs / 54 fresh Codex sessions, at least 24 valid pairs, deterministic grading, fail-closed invalid-trial handling, and separate mechanical versus evidence thresholds.

Release verification for this implementation passed locally and on the exact Hetzner candidate mirror: `npm test` `63/63`, fixture validation `12` valid plus `1` intentionally invalid with zero unexpected failures, syntax/schema checks, isolated signed adaptive-plan smoke, and root plan-doctor `0` errors / `0` warnings. The remote verification state is `/home/jake/clawd-runs/cortex-learning-os-adaptive-verify-20260726/artifacts/state.json`. No live adaptive model session was run during that qualification stage.

Canonical integration is complete. Implementation commit `3141a74b8c1873605e7ef9a162a5043360a85a78` was atomically pushed to both `origin/main` and `origin/feat/cortex-learning-os-adaptive-20260726`; the exact committed product tree was synced to `/root/clawd/cortex-learning-os` and `/home/jake/clawd-remote/cortex-learning-os` with matching source markers. The local canonical suite passed `63/63`; the remote canonical adaptive/live/plugin subset passed `22/22`; and no-call default-launch dry-run `math-training-20260726T191549Z-d125a2` selected adaptive mode, froze a signed acquisition plan, verified `codex-cli 0.144.1`, and matched local, remote, and `origin/main` source commit. At that release checkpoint, canonical mastery was signed, owner-only revision `0`, with all 36 concepts unassessed and no empirical adaptive run applied.

The first authorized real adaptive launch, `math-training-20260726T193442Z-c47d96`, exposed an SSH/systemd argument-boundary defect before worker state initialization or any model call: the empty adaptive exam placeholder was dropped and positional arguments shifted, so the worker failed closed with `invalid expected commit`. The launcher and worker now use explicit mode-specific non-empty argument layouts. Regression verification passed the full local `63/63` suite and a real Hetzner systemd boundary smoke that reached the intended missing-plan rejection with the exact commit, Codex path, and plan positions intact. The failed launch advanced no mastery and installed no lesson; a post-fix retry remains infrastructure recovery, not an outcome-driven rerun.

The first recovery launch, `math-training-20260726T194031Z-3b3dfe`, then exposed a second pre-model boundary: `scp` created the signed plan as `root:root` mode `0600`, while the isolated worker runs as `jake`. The worker reached the adaptive CLI, but `readJson` could not read the plan and returned `null`; no provider call started and the artifact root remained empty. The launcher now transfers plan ownership to `jake`, verifies readability as the service user before starting any watcher or worker, the worker independently requires readability, and the CLI emits an explicit unreadable/invalid-plan error instead of a null dereference. Canonical mastery remained revision `0` with no applied run at that incident checkpoint.

Final authorized continuation `math-training-20260726T194628Z-94e41e` completed on Hetzner from source `bf186b6203e9f7a8bf6825216f7660e933f27b4d`. The signed plan selected `algebra-factoring` acquisition. One `openai-codex/gpt-5.6-sol` read-only/no-tools call answered the generated zeros exercise correctly; deterministic replay passed `1/1`, with 14,562 input and 44 output tokens and positive runtime. The control plane independently replayed the 11-file manifest and applied its digest-bound receipt. Signed mastery is now revision `1`: `algebra-factoring` is in immediate review, 35 concepts remain unassessed, and no repair is pending. No failure-derived candidate was warranted, so paired threshold is not applicable, no lesson was installed, and signed live-registry revision remains `3`. Terminal state and independent WhatsApp delivery are both recorded.

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
- Validation at the original qualified-run checkpoint: `npm test` passed `14/14`; `npm run validate:fixtures` passed with 12 valid records and 1 intentionally invalid record.
- Validation at the original A/B branch checkpoint: `npm test` passed `21/21`; fixtures passed; paired plan-only and fake-worker lifecycle smokes froze and completed successfully before the real A/B model calls.

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
- Private-retrieval promotion remains blocked: shadow success, pack availability, latency, and baseline run success are not causal quality evidence. This is a separate subsystem from the approved scoped math lesson registry.
- Deployment state: the selective private observer is canonical and default-on in observe-only mode; it cannot inject private retrieval into answers. The v0.7 live math adapter uses only independently promoted `math-foundations-v0` lessons from its separate signed registry.

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
- Canonical integration: `origin/main` was fast-forwarded through result commit `ffc82c17c9aaae8c801941cba02c0108de77784b`; package v0.6.0 was synced to `/root/clawd/cortex-learning-os` and `/home/jake/clawd-remote/cortex-learning-os` while preserving both artifact stores. Local and remote default-path tests passed `41/41`; a remote `validate:novel-math:plan` smoke preregistered all 225 calls from canonical source with claimable Codex provenance and `0` model calls executed.
- Answer boundary: no generated microtheory or promoted benchmark lesson was copied into canonical capsules, live retrieval, prompts, or answers. Only the reusable acquisition/promotion/paired-evaluation/restart-verification machinery is canonical; answer influence still requires a trusted lesson to clear the existing promotion gate in a separately authorized use case.

## Live math integration evidence

- Final exercised implementation source: `ef493ac15ebe4e193606e0b10b237ed81607af84`; the status-only release commit is its direct descendant on `origin/main` and `feat/cortex-learning-os-live-math-20260726`.
- Tests: local `51/51`; Hetzner `51/51` with the exact canonical source marker.
- Plugin: `cortex-learning-os-live` is enabled and loaded from `/root/clawd/plugins/cortex-learning-os-live/index.ts` with no plugin diagnostics.
- Registry: HMAC signature valid, revision `1`, owner-only state/key permissions, one enabled/unexpired lesson `lesson_e30152a45fdf9a6a`, activation profile `exact_multiplication`.
- Independent promotion replay: the control plane re-graded all four phases, reconstructed the mistake/candidate/promotion proof, checked held-out linkage, and rejected a test artifact whose worker rewrote verifier output and recomputed its transport manifest.
- Positive live canary (`2026-07-26T06:25:34Z`): exact multiplication selected the expected lesson, telemetry recorded `answerInfluence=true`, and OpenClaw returned the correct integer `426763565`.
- Non-math live canary: returned `READY`; telemetry recorded no match and no answer influence.
- Mismatched-math canary: linear-equation intent was recognized, no exact-multiplication lesson was selected, and the answer `3` was correct.
- Telemetry boundary: records contain pseudonymous principal tags, lesson/profile IDs, registry revision/key ID, query-source enum, and outcome only; prompts, answers, and lesson text are absent.
- Gateway: healthy after production plugin restart; loopback connectivity probe passed.
- Detached launcher: `--exam stress --dry-run` passed with matching local/remote commit `ef493ac15ebe4e193606e0b10b237ed81607af84`, valid live registry, executable remote worker, separate control-plane harvester/notifier units, and `0` training model calls.
- Backup evidence: local pre-v0.7 source archive `/root/clawd/backups/cortex-learning-os/pre-live-v0.7-20260726T053218Z.tar.gz` SHA-256 `8ec0101a0b5347b8d068e9625001e821ae0ab083521c44b85d60a5c8a439493f`; OpenClaw config backup `/root/clawd/backups/cortex-learning-os/openclaw-pre-clos-live-20260726T053330Z.json`; Hetzner pre-v0.7 source archive preserved under `/home/jake/backups/`.

Additional honest evidence:

- The initial 30-item baseline scored `30/30`; the loop stopped rather than fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052255174Z`.
- The corrected reliability challenge scored `20/20`; it also stopped without fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052716583Z`.
- An earlier reliability-challenge run was invalid because the generated derangement oracle incorrectly expected `0`. Cortex's answers `D_10=1334961` and `D_6=265` were correct. That root is preserved only as verifier-regression evidence under `artifacts/_quarantine/false-derangement-oracle-20260725-052532795Z/` and produced no candidate/default promotion.

## First post-integration live training result

- Initial attempt `math-training-20260726T154152Z-2244e4` failed before any model call because the transient systemd PATH omitted `/home/jake/.local/bin`. The runtime was fixed canonically at commit `aabb79b3ee267db6771d897d4a014e7a5c840e65`: the launcher now preflights `/home/jake/.local/bin/codex` as service user `jake`, passes it explicitly to the worker, and regression coverage preserves this boundary.
- Local and exact worker-environment Hetzner tests passed `52/52`; the post-fix no-call dry-run identified `codex-cli 0.144.1`; local, remote, and `origin/main` source state matched before launch.
- Retry `math-training-20260726T154658Z-e7e74b` completed at `2026-07-26T15:49:16Z`. Its 20-item stress baseline scored `7/20` (`0.35`) with 13 deterministic failures; the loop selected failure `mfs-07`, then passed correction, independent promotion retest, all ten promotion gates, and a distinct held-out retest.
- The control-plane harvester copied and independently replayed the 36-file manifest-backed artifact set, installed `lesson_aadf75a434c4a1a9`, and verified signed registry revision `2`. Local evidence root: `/root/clawd/artifacts/cortex-learning-os-training/incoming/math-training-20260726T154658Z-e7e74b`.
- The independent notifier delivered the terminal completion over WhatsApp as message `3EB04446BDDF17B203E295`; worker, harvester, and notifier units then exited successfully.
- Allowed claim: one recorded exact-multiplication failure was followed by passed correction, promotion retest, and a distinct held-out pass under the declared verifier-gated loop. This does not isolate retrieval causality or establish broad/durable math improvement or model-weight learning.

## Deduplication and challenge no-lesson result

- Canonical commit `a4c98acf07e81b241889f511bef4a674a5439f2e` added semantic lesson keys, deterministic newest-evidence retention, automatic install-time deduplication, and an operator dedupe command. Live revision `3` removed older equivalent record `lesson_e30152a45fdf9a6a` and retained `lesson_aadf75a434c4a1a9`; the previous registry and both original run artifacts remain preserved.
- A content-free post-dedup hook canary selected only the retained lesson with `answerInfluence=true`. Registry signature and single-lesson state remained valid.
- Challenge run `math-training-20260726T163228Z-72fb6d` produced a real `gpt-5.6-sol` baseline score of `20/20` with positive provider-observed usage and no tool use. It generated no mistake, candidate, promotion, or lesson.
- The worker initially labeled the expected no-observed-mistake exit code `3` as a failure because the inherited `ERR` trap fired before status normalization. Commit `4788779dfbd39deb00e54024ba115d2adea0b491` replaced that unsafe capture path and added a `candidate_no_lesson` state plus independent control-plane manifest/replay verification.
- The existing run was recovered without another model call: all baseline attempts, verifier results, and score were independently replayed, terminal state became `completed`, registry stayed at revision `3`, and corrected WhatsApp notification `3EB0B7ECA2CC6B1C7245BE` was delivered. Local and exact Hetzner worker-environment tests passed `54/54`.
- Allowed claim: this declared challenge exam had no observed error in this run. It does not create a lesson or prove broad mastery, durable improvement, retrieval benefit, or model-weight learning.

## Active blockers / unproven surfaces

- The completed bounded production slice remains green.
- The randomized A/B executed successfully, but its preregistered evidence threshold did not pass: both arms scored `26/27`, lift was `0`, and exact McNemar p was `1.0`.
- Broad math improvement and time-durable learning remain unproven. The novel-math run proved one unchanged lesson survived a clean process boundary, not long-duration retention.
- Retrieval-pack benefit and harm remain unproven under the declared exact-multiplication/model/runtime configuration.
- Retrieval-mediated benefit is now proven only for one seeded invented mathematical microtheory under the novel-math contract; do not generalize that result to ordinary known mathematics or broader domains.
- The capped mechanism track proved bounded retrieval transfer for seeded novel information. Its first private-workspace utility arm failed the frozen effect threshold (`+11.11` points, p `0.25`) and remains an immutable no-go for that contract, although the corrected held-out validation later passed its separate frozen gates.
- The corrected validation proves bounded utility only for selectively routed, genuinely non-inferable private workspace facts represented by its frozen pool.
- Ordinary non-math and nonmatching-math behavior remains unchanged by the live math adapter. The separate selective private-retrieval observer remains default-on shadow-only and cannot inject retrieved private content.
- Real-world activation-profile precision across a broad workload, longer production latency distribution, and causal answer-quality lift from live math lessons remain unproven.
- Model weights were not changed.

## Next actions

1. Monitor content-free activation telemetry and the retained exact-multiplication lesson's expiry/retest state; keep all kill switches intact.
2. If more ordinary-math lessons are desired, prospectively declare a harder supported-profile exam rather than repeating the now-perfect challenge or single-rule stress exams.
3. Preserve all prior A/B, private-utility, novel-math, first-live-run, and no-lesson frozen claims unchanged.
4. Add any non-math domain only through a new curriculum, deterministic verifier catalog, privacy review, and approved activation profiles.

## Do not use / superseded

- Do not treat AI OS, SLOS, or Cortex/Codex consolidation as this project; they are related assets, not the CLOS implementation path.
- Do not use the quarantined false-derangement run as learning or capability evidence.
- Do not treat deterministic expected-answer fixtures as model capability evidence.

## Truth boundary

Allowed claims:

- Cortex Learning OS has a working, artifact-backed production slice.
- One bounded exact-arithmetic failure was followed by passed correction, independent promotion retest, and a different held-out retest after a gated retrieval pack.
- One scoped real math lesson passed the declared promotion gates, independently replayed on the control plane, and is active in the live signed registry for matching exact-multiplication turns.
- In the capped go/no-go, seeded synthetic-procedure retrieval transferred perfectly across fresh sessions under the declared runtime.
- The private-utility pack improved three of 27 paired items with no regressions, but this did not meet the first preregistered utility effect threshold.
- The corrected, disjoint clustered private-utility validation passed all frozen gates under its declared workload and supports only a selective shadow candidate.
- The preregistered harder novel-math validation passed all frozen calibration, acquisition, direct-transfer, compositional-transfer, ordinary-math regression, clean-process durability, provider-evidence, and independent-integrity gates for one seeded invented microtheory.
- The selective private observer may retrieve and record content-free operational evidence while remaining isolated from the answer path.
- The live math adapter can inject only signed, enabled, unexpired lessons into matching main-agent math turns; the positive and two negative canaries passed.
- The detached Hetzner training path is ready to start bounded math learning without blocking the OpenClaw control plane.

Not allowed:

- Cortex broadly learned mathematics.
- The retrieval pack alone caused the held-out pass.
- The improvement is durable beyond the declared process-restart and `retestAfter` boundaries.
- Cortex is an expert mathematician, quant PM, or profitable trader.
- Model weights changed.
- Live trading or external financial actions are approved.
- Shadow pack availability or successful retrieval proves answer-quality improvement.
- Private retrieval is approved to influence prompts, reasoning, tools, or user-visible answers.
- CLOS has learned mathematics broadly or can learn arbitrary new domains without domain-specific curricula and verifiers.
- Live lesson injection itself proves causal answer-quality improvement.

## v0.9 qualification worker hardening (2026-07-27)

- Implemented the inert qualification worker and `transfer:run` CLI.
- Added pre-call frozen-input validation, balanced run-seeded two-arm order,
  router-gated candidate rendering, positive provider usage, tool-event rejection,
  owner-only attempts, durable keyed resume, runtime drift rejection, and an exact
  content-free provider-ledger manifest.
- Deterministic fake-adapter tests establish mechanics only. No real transfer A/B
  qualification was run, neither profile is qualified, no signed transfer state or
  registry was promoted, and no empirical transfer benefit is claimed.
- Release behavior is active-by-default at runtime, but active mode injects nothing
  unless an independently qualified, signed, enabled, unexpired entry exists.
- A real transfer qualification and control-plane `transfer:apply` remain a separate
  future evidence event, not a prerequisite for inert bridge deployment. A truthful
  null, no-transfer, invalid, or blocked outcome remains acceptable.
