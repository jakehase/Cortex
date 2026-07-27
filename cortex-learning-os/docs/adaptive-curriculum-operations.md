# Adaptive Curriculum Operations v0.8

The canonical launcher defaults to adaptive curriculum mode:

```bash
./scripts/launch-live-math-training.sh --dry-run
./scripts/launch-live-math-training.sh
```

`--dry-run` performs source/runtime preflight and freezes a control-plane plan but makes no model call. A fixed exam is a legacy diagnostic and must be selected explicitly:

```bash
./scripts/launch-live-math-training.sh --exam baseline
./scripts/launch-live-math-training.sh --exam challenge
./scripts/launch-live-math-training.sh --exam stress
```

## Trust boundary

The control plane owns `/root/.openclaw/cortex-learning-os/mastery.json`, its separate HMAC secret, and the signed live registry. The remote worker receives an HMAC-signed frozen plan containing the selected action, base revision/digest, policy/curriculum digests, source commit, seed, finite budgets, and runtime contract. It never receives the HMAC secret or authority to sign or mutate canonical state.

The canonical launcher and checked-in policy both require reasoning `xhigh`. A signed plan may not weaken that effort or change provider, model, sandbox, or tool policy. The frozen plan binds provider `openai-codex`, model `gpt-5.6-sol`, `xhigh`, a read-only sandbox, and prohibited tool use. Returned call ledgers must contain the exact signed `model_reasoning_effort` and carry positive provider-observed usage.

The worker can terminate with:

- `candidate_mastery_delta`
- `candidate_lesson_and_mastery_delta`
- `curriculum_currently_satisfied`
- `structured_blocker`

The remote orchestration state exposes these as `candidate_adaptive` until the separate harvester copies the artifacts and runs `live-control.mjs adaptive-apply`. A verified `structured_blocker` is then published as `blocked`, never relabeled as completion.

## Independent application

`adaptive-apply` fails closed unless it can verify:

1. exact bounded manifest coverage with safe regular paths, byte sizes, and SHA-256;
2. source commit, policy digest, curriculum digest, and canonical mastery snapshot;
3. deterministic regeneration of every item from concept, role, seed, family, parameters, and oracle digest;
4. no-tool model provenance with positive usage and model-output/answer linkage;
5. independently reproduced deterministic attempts, verifiers, scores, candidate prompt/output/schema checks, and fixed-template/answer-leakage rejection;
6. identical-item fresh-session paired trials and the frozen exact McNemar/accuracy/lift/no-regression gates;
7. byte-equivalent reconstruction of the worker's proposed delta.

Canonical mastery is then replaced atomically in owner-only mode with a new HMAC signature. Each applied run binds its run ID to the exact returned manifest digest, so only a byte-identical retry is idempotent; a different artifact set reusing the run ID is rejected. A paired null result preserves evidence and may update verified exercise evidence, but installs no lesson. A threshold pass still installs no lesson when the concept lacks an approved live activation profile.

## Recovery

Do not edit mastery or registry JSON manually. A signature mismatch, source mismatch, policy drift, rewritten manifest, replay mismatch, or exhausted budget is a structured blocker. Preserve the returned artifact directory and worker state for diagnosis. Rerunning `adaptive-apply` for an already applied run is safe; it does not advance mastery revision twice.

Deterministic fake workers cover runtime and hostile replay paths without model calls. Real adaptive sessions are reported separately in canonical status and retain their exact signed runtime as historical evidence.
