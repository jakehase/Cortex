# Formal proof kernel

## Product boundary

The formal-proof surface verifies one Lean proof term against one immutable
theorem template. It is fail-closed and pinned to:

- Lean `v4.32.1`, toolchain `leanprover/lean4:v4.32.1`, commit
  `f054605aea4b840552cca2e725580bffd1e1b704`;
- official Linux x86_64 archive SHA-256
  `57d5c062a6b4bae6fba511a1704aa124dff461c37d0fc94585637fbb7d951b50`;
- mathlib tag `v4.32.1`, commit
  `520045ab14e26149ee970e2e617ca04b09bde5d6`.

`proof-kernel/lean-toolchain`, `proof-kernel/lakefile.toml`, and
`proof-kernel/ProofKernel/Prelude.lean` are immutable verifier inputs. The v1
prelude permits the single pinned `Mathlib` umbrella import. Candidate text
cannot add an import, command, directive, declaration, path, or process call.

The product Git identity is deliberately not embedded in tracked source. Every
task, candidate, and evidence record carries a `deployment` binding containing
the actual deployed commit, tree, and named content digests. Verification and
replay require the independently supplied expected deployment.

## Operator installation and preflight

Verification never installs, updates, or downloads anything. An operator must
invoke the installer explicitly from the `cortex-learning-os` directory:

```bash
./scripts/install-lean-proof-kernel.sh \
  --archive /operator/cache/lean-4.32.1-linux.tar.zst
```

The archive must already be a regular non-symlink file with the pinned digest.
An existing cache directory can be selected with `--cache-dir`; the expected
archive name inside it is `lean-4.32.1-linux.tar.zst`. To explicitly authorize
the installer to download the official release asset to a caller-selected
location, use:

```bash
./scripts/install-lean-proof-kernel.sh \
  --download-to /operator/cache/lean-4.32.1-linux.tar.zst
```

The installer refuses to overwrite an invalid installation. It records and
rechecks Lean/Lake executable digests, resolves mathlib at the exact commit,
fetches the exact tag, obtains mathlib's compiled cache, and builds the proof
project. That is not yet production-ready.

After the build, and only from a clean committed product tree with a configured
production trust policy, generate an unsigned exact-byte request:

```bash
node src/proof-runtime-attestation-request.mjs \
  --plan /root/.openclaw/cortex-learning-os/phd/campaigns/CAMPAIGN/plan.v2.json \
  --secret /root/.openclaw/cortex-learning-os/phd/qualification.hmac \
  > /operator/signed/proof-runtime-attestation-request.json
```

The saved plan HMAC authenticates the campaign's exact executable-bound v3
deployment. Request generation verifies its v2 source projection against the
clean committed program and descriptor-validates the separately approved static
model executable. A canonical source-only v2 deployment cannot produce a
production proof-runtime request.

A separately protected build authority must validate that request and sign its
exact request SHA-256 together with the decoded runtime payload using an
Ed25519 `proof_runtime` authority from the production trust policy. The request
itself contains no placeholder or synthetic signature. The resulting authority
payload has schema `cortex.learning_os.proof_runtime_authority_payload.v1` and
contains both `requestSha256` and `runtimePayload`. The authority attestation
must be encoded as canonical JSON without a trailing newline so its exact bytes
are unambiguous. Then install the inseparable request/attestation pair without
replacing any different receipt:

```bash
./scripts/install-lean-proof-kernel.sh \
  --runtime-request /operator/signed/proof-runtime-attestation-request.json \
  --runtime-attestation /operator/signed/proof-runtime-attestation.json
```

Supplying only one member of the pair is rejected. Without this separate
signature, the installer exits non-green after the build and prints the
request command. Rerunning against exact installation, request, and attestation
bytes is idempotent.

The read-only readiness check is:

```bash
./scripts/preflight-lean-proof-kernel.sh
```

It emits JSON and exits:

- `0` only when exact product bytes, installation receipt, executable digests,
  Lean version/commit/architecture, the exact Lake package allowlist and
  manifest record, mathlib HEAD/tag/clean tracked worktree, the exact
  authenticated manifest records for every Lean runtime file and compiled
  dependency file, exact product files cross-bound to the named
  `proof-runtime-product` deployment content digest, deployment and
  trust-policy bindings, compiled import, and the representative theorem all
  pass;
- `3` when the pinned installation is absent or incomplete; or
- `4` when present state is invalid or drifted.

The heavy installation/build and qualification replay belong on a protected
execution plane whose files candidates cannot modify. The build, candidate,
and replay authorities are separate. In production, the `proof_runtime` and
`proof_replay` authority IDs and Ed25519 verification-key digests must both be
different. The protected replay authority supplies its exact replay evidence
and a signature binding that evidence digest. The campaign receipt factory
then replays internally from raw task/candidate/template bytes, reconstructs
and compares the stable evidence and exact proof-runtime identity, retains the
authority's full replay evidence and signature, and only then adds the
control-plane signature. The remote candidate worker never mutates canonical
signed state.

## API

`src/lean-proof-verifier.mjs` exports the integration surface:

- `createProofTask(...)` creates a strict task with theorem/template, prelude,
  toolchain, deployed commit/tree/content, seed/run, and resource bindings.
- `src/phd-proof-registry.mjs` supplies a trusted template for each of the
  seven rubric obligations and materializes the research template only after
  binding the research artifact SHA-256.
- `src/phd-proof-candidate-runner.mjs` runs an ephemeral xhigh Codex candidate
  in an isolated directory, supplies exact task bytes, enforces the strict
  proof-term schema, retains actual provider usage and prompt/output digests,
  and rejects tool events or missing positive usage.
- `serializeProofRecord(record)` produces the only accepted deterministic JSON
  byte encoding.
- `createProofCandidate({ taskBytes, candidateId, proofTerm })` binds the exact
  task bytes and canonical task digest and performs static rejection.
- `verifyLeanProof({ taskBytes, candidateBytes, trustedTemplateBytes,
  proofKernelRoot? })` reruns exact preflight, constructs and checks the source,
  invokes Lean, cleans up, and returns strict kernel evidence. A wrong proof
  returns evidence with `kernelAccepted: false`; malformed, unsafe, drifted, or
  absent inputs throw a `ProofKernelError`.
- `replayLeanProofEvidence({ taskBytes, candidateBytes, trustedTemplateBytes,
  evidence, proofKernelRoot? })` rebinds all bytes and identities, reconstructs
  the exact source, reauthenticates the exact signed runtime record and bytes,
  reruns Lean at the recorded temporary pathname, and rejects any runtime,
  manifest, deployment, source, or result substitution.
- `validateProofTask`, `validateProofCandidate`,
  `validateCandidateProofTerm`, and `validateKernelEvidence` provide pure
  fail-closed validation.

`trustedTemplateBytes` is a trusted control-plane input, never candidate output.
The task binds its SHA-256. The template must start with the immutable prelude,
contain exactly the allowlisted import and exact theorem statement, and contain
one parenthesized `{{CORTEX_PROOF_HOLE}}`. Only the validated candidate proof
term replaces that marker.

Task, candidate, and evidence wire contracts are
`schemas/proof-task.schema.json`,
`schemas/proof-candidate.schema.json`, and
`schemas/proof-kernel-evidence.schema.json`. The nested exact runtime envelope,
unsigned runtime/replay requests, and replay receipt are defined by
`schemas/proof-runtime-evidence.schema.json`,
`schemas/proof-runtime-attestation-request.schema.json`,
`schemas/proof-replay-request.schema.json`, and
`schemas/proof-replay-receipt.schema.json`.
All task, kernel, runtime, and nested replay deployment fields reference the
single exact versioned contract in
`schemas/deployment-binding.schema.json`. Production records use
`deployment_binding.v3`, including the recursively immutable execution closure,
approved model executable, and approved research runtime; downlevel deployment
records remain fixture-only.

## Security guarantees

Before Lean runs, the verifier rejects `sorry`, `admit`, `sorryAx`, new
`axiom`/`opaque`/unsafe declarations, declaration and namespace commands,
imports, `set_option`, hash directives, metaprogramming escape hatches, native
evaluation, strings, comments, file/path/process/environment APIs, shell
substitution text, proof-hole text, and unbalanced delimiters. Balanced
parenthesized insertion prevents code from escaping the designated hole.

Lean is executed directly with an argv array and `shell: false`. Candidate text
is never an executable, option, environment value, path, or working directory.
The environment contains only `LANG`, `LC_ALL`, an invocation-private `HOME`,
and the locally derived `LEAN_PATH`. The command has a fixed proof-project cwd,
heartbeats and recursion bounds, a wall timeout, bounded stdout/stderr, and an
invocation-private regular source file with owner-only permissions. The runtime
contains no Lake update, installer, HTTP client, download, or candidate I/O
path. Temporary files are removed in `finally`, including error paths.

Evidence binds exact task and candidate bytes, canonical records, theorem,
template, proof term, allowed imports, prelude, rendered source, toolchain,
deployed commit/tree/content, trust policy, run/seed, limits,
executable/version/digests, the raw canonical proof-runtime attestation bytes
and signed record, runtime authority/key identity, exact Lean/Lake/product and
compiled-dependency manifests, mathlib identity, complete argv/minimal
environment, process result, timeout/output-limit state, and bounded output
digests. Replay reconstructs and compares that complete identity. Its
self-digest detects accidental mutation; production authority comes only from
the separately trusted Ed25519 signatures and independent replay.

## Truth boundary

A kernel-accepted result proves only the exact formal theorem statement under
the exact pinned trusted imports. It does not prove that a learner understood
the proof, can solve related problems, has broad mathematical mastery, produced
a novel result, satisfied an informal specification, or earned a PhD.

Preflight readiness proves installation identity and one representative kernel
run. Static rejection proves only that banned syntax was not observed. A
candidate rejected before Lean has no kernel result. Mechanical harness tests
and an absent-kernel skip never count as theorem acceptance.

The representative natural-number theorem remains only a readiness harness.
Qualification requires accepted and independently replayed evidence for all
seven registry templates. Until the independent worker installs pinned Lean
and performs those runs, the proof layer remains outstanding.
