# Cortex Learning OS

Cortex Learning OS is a local, verifier-gated learning layer for Cortex/OpenClaw. It stores curricula, recorded attempts, deterministic verifier results, mistakes, candidate lessons, promoted trusted lessons, retrieval packs, bounded capability reports, and separately qualified semantic coding-transfer profiles. It does not modify model weights.

## v0.9 semantic coding-transfer production slice

The v0.9 production slice adds a separate math-to-code transfer spine for two declared hypotheses:

- `exact-multiplication` → arbitrary-precision and overflow-safe exact integer multiplication with deterministic product verification.
- `algebra-factoring` → exact integer-polynomial construction, expansion, integer-root checking, and zero verification.

Math acquisition evidence is not coding-transfer qualification. An acquired or historically reviewed math concept never enters coding context because of acquisition state or a keyword. Transfer requires a separately signed qualification state, an independently replayed manifest-bound qualification report, a signed transfer-registry entry, an enumerated semantic matcher, observable assumptions, no negative gate, allowed scope, unexpired evidence, active mode, and a clear kill switch.

The canonical transfer default is `transferEnabled: true` plus `transferMode: "active"`, per the operator's direct-live decision. Active mode still injects nothing unless a separately qualified, signed, enabled, unexpired profile matches all assumptions and no negative gate. This release contains no checked-in qualification, does not manufacture a live entry from implementation tests, and makes no empirical transfer-benefit claim. See [`docs/semantic-coding-transfer-contract.md`](docs/semantic-coding-transfer-contract.md).

## Current production slice

The canonical starter capsule is `capsules/math-foundations/`. Its active continuous-acquisition slice contains:

- an 84-node acyclic curriculum: the original 36 concepts plus 48 coherent next concepts
- explicit `adaptive-math-continuous-v1` policy with review selection and scheduling disabled
- schema-v2 owner-only HMAC state using honest `acquired` (covered-once) semantics
- one-shot signed migration from the legacy revision-74 representation
- 30-item deterministic baseline exam
- exactness/reliability challenge exams
- no-tool OpenClaw model attempt capture
- deterministic answer checkers
- mistake ledger and lesson candidate generation
- fail-closed promotion requiring independent correction and retest evidence
- token-bounded retrieval pack generation
- canonical trusted lesson and capability report paths
- signed, hot-reloaded live lesson registry
- narrowly scoped OpenClaw prompt integration with expiry and kill switches
- content-free answer-influence telemetry
- detached Hetzner Codex training, control-plane re-verification, and automatic qualified-lesson installation
- deterministic adaptive planning over the complete prerequisite graph
- seeded, locally replayable exercise families for all 84 curriculum concepts
- acquisition, learning retry, and genuine correction with no active review due dates
- failure-gated structured model-derived candidates that cannot copy fixed exam templates
- preregistered paired candidate-context versus no-context promotion analysis
- worker-only acquisition proposals with independent control-plane policy and grading replay

The latest qualified run pointer is `artifacts/latest-qualified-run.json`. The live architecture and exact claim boundary are defined in [`docs/live-math-integration-contract.md`](docs/live-math-integration-contract.md).

## Commands

```bash
npm test
npm run validate:fixtures
npm run exam:fixture
npm run dogfood:math
npm run dogfood:challenge
npm run dogfood:stress
npm run train:math
npm run train:math:challenge
npm run train:math:stress
npm run train:adaptive -- --plan <frozen-plan.json> --artifact-root <dir> --source-commit <sha>
npm run live:status
npm run live:verify
npm run live:adaptive:plan -- --run-id <id> --seed <seed> --source-commit <sha> --out <plan.json>
npm run live:adaptive:apply -- --artifact-root <returned-dir> --source-commit <sha>
npm run live:adaptive:migrate-continuous -- --audit-out <audit.json> --source-commit <sha> --expected-source-commit <sha> --expected-source-revision 74 --expected-source-state-digest <sha256> --expected-source-curriculum-digest <sha256> --expected-source-policy-digest <sha256> --expected-target-curriculum-digest <sha256> --expected-target-policy-digest <sha256>
npm run transfer:init
npm run transfer:status
npm run transfer:verify
npm run transfer:plan -- --profile exact-multiplication --run-id <id> --model gpt-5.6-sol --reasoning xhigh --out <owner-only-dir>
npm run transfer:apply -- --artifacts <returned-owner-only-dir>
npm run transfer:promote -- --profile exact-multiplication
npm run transfer:disable -- --profile exact-multiplication
npm run transfer:revoke -- --profile exact-multiplication
npm run transfer:registry
./scripts/launch-live-math-training.sh --dry-run
./scripts/launch-live-math-training.sh
./scripts/launch-adaptive-math-continuation.sh --dry-run
./scripts/launch-adaptive-math-continuation.sh
./scripts/launch-live-math-training.sh --exam stress # explicit legacy diagnostic
npm run experiment:ab:plan -- --experiment-id <id> --seed <seed>
npm run experiment:ab -- --experiment-id <id> --seed <seed>
npm run validate:go-no-go:plan -- --program-id <id> --seed <seed> --utility-fixture <private-json> --artifact-root <dir>
npm run validate:go-no-go -- --resume --program-id <id> --artifact-root <dir>
npm run validate:private-utility:plan -- --validation-id <id> --seed <seed> --calibration-fixture <private-json> --holdout-fixture <private-json> --artifact-root <dir>
npm run validate:private-utility -- --resume --validation-id <id> --artifact-root <dir>
npm run validate:novel-math:canary -- --out <canary-json>
npm run validate:novel-math:plan -- --validation-id <id> --seed <seed> --artifact-root <dir>
npm run validate:novel-math -- --resume --phase immediate --validation-id <id> --artifact-root <dir>
npm run validate:novel-math -- --resume --phase durability --validation-id <id> --artifact-root <dir>
npm run validate:novel-math:verify -- --artifact-root <dir> --out <verification-json>
```

`dogfood:*` uses isolated, non-delivering `openclaw agent` sessions. A run writes immutable evidence under `artifacts/<run-id>/`. With `--promote-default`, canonical capsule files change only after every promotion gate and the held-out retest pass.

The detached launcher defaults to continuous acquisition. The control plane verifies signed schema-v2 state, selects one acquisition/learning/correction action from the frozen policy, and creates a digest-bound plan before any remote work. Overdue or future historical review dates are never selected and do not block an acquired prerequisite. An early-review request fails closed. The remote worker may emit generated exercises, model provenance, deterministic grading records, candidate/paired evidence, and a proposed acquisition delta. It cannot write canonical state or the live registry. After return, `adaptive-apply` checks exact manifest coverage and source identity, regenerates the complete item and oracle digest, re-grades every answer, replays candidate validation and exact paired analysis, reconstructs the delta, and only then atomically signs state. A lesson is installed only when the paired threshold passes and the concept has an approved narrow activation profile.

The continuation launcher runs those same one-action sessions sequentially from a lightweight control-plane supervisor. It starts another remote session only after the prior result has reached terminal independent replay and advanced signed acquisition state. It permits one remote child, at most 100 sessions, 24 persisted wall-clock hours, and four hours per child. It stops on the first genuine blocker, source drift, no progress, or `curriculum_frontier_reached`. Frontier is an honest zero-call terminal result: it schedules no review and does not busy-loop or fabricate learning. Per-session notifications are suppressed; an independent supervisor-level notifier reports the terminal result.

The original 36-concept graph, v0.8 policy, schema-v1 state transitions, and spaced-review generators remain available only to verify signed historical evidence and exercise audit/rollback paths. The bounded migration command verifies the exact legacy HMAC and caller-supplied source/target identities, preserves counters, evidence and applied receipts plus historical review timestamps/stages, clears active review dates, converts passed legacy records to `acquired`, adds only new concepts as unassessed, increments the revision once, writes a signed audit, and atomically signs v2 state. See [`docs/adaptive-curriculum-operations.md`](docs/adaptive-curriculum-operations.md); do not run migration without separately frozen live-state digests and authorization.

Fixed exams remain available only through explicit `--exam baseline|challenge|stress`. They retain the v0.7 behavior and artifact verifier for diagnostics and historical reproducibility.

`experiment:ab` preregisters and runs a randomized paired comparison of the promoted retrieval treatment against no retrieval context. The default plan has 27 identical-item pairs / 54 fresh ephemeral Codex sessions, three pairs above the 24-valid-pair minimum; the separate ≤10% invalid-rate gate permits at most two invalid pairs. It uses deterministic grading, no allowed tools, fixed exact-McNemar analysis, and no outcome-driven reruns. Use `--plan-only` to inspect and freeze the full schedule before model calls; use `--resume` only to continue missing trials without rerunning any completed or invalid trial.

`validate:go-no-go` is the capped efficacy program in [`docs/go-no-go-validation-contract.md`](docs/go-no-go-validation-contract.md). It first requires fail-then-correct-then-retest promotion of a seeded synthetic procedure, then runs 27 paired fresh-session mechanism comparisons and 27 paired private-workspace utility comparisons. The private utility fixture is an explicit input and must remain outside the public repository. The frozen program caps execution at 111 model calls and requires both tracks to clear preregistered effect, no-regression, token, and latency gates. A pass creates only a bounded shadow-integration candidate; it does not enable default routing.

`validate:private-utility` is the corrected ceiling-resistant test in [`docs/private-utility-validation-contract.md`](docs/private-utility-validation-contract.md). It freezes disjoint private calibration and held-out fixtures before any model call, checks no-pack headroom on 12 facts / 24 open-ended sessions, then conditionally runs 30 held-out fact clusters / 60 paired prompts / 120 fresh sessions. Fact clusters, not repeated paraphrases, are the primary statistical unit. The private fixtures remain outside Git. Validation `clos-private-utility-20260725T192921Z` passed its frozen gates and permits only a selective private-retrieval shadow candidate.

The candidate is implemented in Cortex as a default-on, observe-only shadow. It uses authenticated principal scope, bounded asynchronous retrieval, an immediate kill switch, and content-free capped telemetry. Retrieved candidates are discarded and cannot enter model context or alter answers. See [`../public/cortex_server/docs/private-retrieval-shadow.md`](../public/cortex_server/docs/private-retrieval-shadow.md).

`validate:novel-math` is the harder domain-specific benchmark in [`docs/novel-math-validation-contract.md`](docs/novel-math-validation-contract.md). It freezes one invented pair algebra before any calls, confirms no-context headroom on a disjoint algebra, requires fail/correct/retest promotion, measures randomized paired direct and compositional transfer, stresses ordinary arithmetic with an irrelevant pack, and then reloads the unchanged promoted lesson in a distinct process for a paired post-restart test. The fixed program contains 225 model calls and separates mechanical completion, frozen threshold pass, and independent artifact recomputation.

The reusable v0.7 mechanism is canonical. Synthetic benchmark microtheories remain artifact-only and can never enter the live math registry through the default installer. Independently promoted real `math-foundations-v0` lessons can influence matching live math answers only after artifact re-verification, approved activation-profile mapping, signed-registry installation, and expiry checks. Training and Oracle sessions are excluded from live retrieval so prior lessons cannot contaminate baseline evidence.

## Canonical default paths

```text
capsules/math-foundations/capsule.json
capsules/math-foundations/trusted_lessons.json
capsules/math-foundations/latest_retrieval_pack.json
capsules/math-foundations/capability_report.json
artifacts/latest-qualified-run.json
/root/.openclaw/cortex-learning-os/live-registry.json
/root/.openclaw/cortex-learning-os/mastery.json
/root/.openclaw/cortex-learning-os/mastery.hmac
/root/.openclaw/cortex-learning-os/<operator-selected-migration-audit>.json
/root/.openclaw/cortex-learning-os/telemetry.json
/root/.openclaw/cortex-learning-os/transfer-state.json
/root/.openclaw/cortex-learning-os/transfer-state.hmac
/root/.openclaw/cortex-learning-os/transfer-registry.json
/root/.openclaw/cortex-learning-os/transfer-registry.hmac
/root/.openclaw/cortex-learning-os/transfer-telemetry.json
```

## Truth boundary

A green learning-loop run proves only that the declared bounded loop completed for the named evidence. An `acquired` record proves only that the named fresh exercise was passed and independently replayed under the frozen policy; it does not prove durable retention or general concept mastery. Transfer profile validity, coding-transfer qualification, signed-registry installation, active answer influence, and empirical transfer benefit are separate truth layers. A live telemetry record with `answerInfluence=true` proves only that signed scoped context entered that prompt; it does not by itself prove a better answer. A completed paired run supports candidate-context benefit only if all preregistered validity, lift, no-regression, and exact-test gates pass; mechanical completion is reported separately. None of these results proves general mathematical expertise, broad coding ability, model-weight learning, autonomous self-improvement, or improvement outside the declared scope.
