# Formal proof kernel

## Product boundary

The formal-proof surface verifies one Lean proof term against one immutable
theorem template. It is fail-closed and pinned to:

- Lean `v4.32.1`, toolchain `leanprover/lean4:v4.32.1`, commit
  `f054605aea4b840552cca2e725580bffd1e1b704`;
- official Linux x86_64 archive SHA-256
  `57d5c062a6b4bae6fba511a1704aa124dff461c37d0fc94585637fbb7d951b50`;
- mathlib tag `v4.32.1`, commit
  `520045ab14e26149ee970e2e617ca04b09bde5d6`; and
- product source commit `97266f3f17e26dcecbe7029981b48555d618ec81`.

`proof-kernel/lean-toolchain`, `proof-kernel/lakefile.toml`, and
`proof-kernel/ProofKernel/Prelude.lean` are immutable verifier inputs. The v1
prelude permits only `Mathlib.Data.Nat.Basic`.

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
fetches the exact tag, obtains mathlib's compiled cache, builds the proof
project, and finishes by running preflight. Rerunning it against an exact
installation is idempotent.

The read-only readiness check is:

```bash
./scripts/preflight-lean-proof-kernel.sh
```

It emits JSON and exits:

- `0` only when exact product bytes, installation receipt, executable digests,
  Lean version/commit/architecture, Lake manifest, mathlib HEAD/tag/clean
  tracked worktree, compiled import, and the representative theorem all pass;
- `3` when the pinned installation is absent or incomplete; or
- `4` when present state is invalid or drifted.

The toolchain, project, and mathlib cache should be installed on a
control-plane-owned filesystem that candidates cannot modify.

## API

`src/lean-proof-verifier.mjs` exports the integration surface:

- `createProofTask(...)` creates a strict task with theorem/template, prelude,
  toolchain, source, seed/run, and resource bindings.
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
  the exact source, reruns Lean at the recorded temporary pathname, and rejects
  any result substitution.
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
`schemas/proof-kernel-evidence.schema.json`.

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
source commit, run/seed, limits, executable/version/digests, mathlib identity,
complete argv/minimal environment, process result, timeout/output-limit state,
and bounded output digests. Its self-digest detects accidental mutation; it is
not a signature. Trust across hosts or principals requires independent replay
against trusted task, candidate, and template bytes.

## Truth boundary

A kernel-accepted result proves only the exact formal theorem statement under
the exact pinned trusted imports. It does not prove that a learner understood
the proof, can solve related problems, has broad mathematical mastery, produced
a novel result, satisfied an informal specification, or earned a PhD.

Preflight readiness proves installation identity and one representative kernel
run. Static rejection proves only that banned syntax was not observed. A
candidate rejected before Lean has no kernel result. Mechanical harness tests
and an absent-kernel skip never count as theorem acceptance.
