import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { deploymentBindingDigest } from '../src/deployment-identity.mjs';
import { sha256Text } from '../src/hash.mjs';
import {
  DEFAULT_PROOF_KERNEL_ROOT,
  PINNED_LEAN_PROOF_CONTEXT,
  PINNED_LEAN_PROOF_IDENTITIES,
  PROOF_RUNTIME_EVIDENCE_SCHEMA,
  PROOF_TRUTH_BOUNDARY,
  buildProofRuntimeAttestationRequest,
  buildProofRuntimeEvidence,
  buildRuntimeContentManifest,
  preflightLeanProofKernel,
  validateProofRuntimeEvidence,
} from '../src/lean-proof-preflight.mjs';
import {
  PROOF_CANDIDATE_SCHEMA,
  PROOF_EVIDENCE_SCHEMA,
  PROOF_TASK_SCHEMA,
  canonicalProofDigest,
  createProofCandidate,
  createProofTask,
  parseProofRecordBytes,
  renderTrustedProofSource,
  replayLeanProofEvidence,
  serializeProofRecord,
  validateCandidateProofTerm,
  validateKernelEvidence,
  validateProofCandidate,
  validateReplayEvidenceIdentity,
  validateProofTask,
  verifyLeanProof,
  withTemporaryProofSource,
} from '../src/lean-proof-verifier.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLOS_ROOT = path.resolve(TEST_ROOT, '..');
const KERNEL_ROOT = path.join(CLOS_ROOT, 'proof-kernel');
const TEMPLATE_PATH = path.join(KERNEL_ROOT, 'fixtures/nat-add-zero.template.lean');
const VALID_PROOF_PATH = path.join(KERNEL_ROOT, 'fixtures/valid/nat-add-zero.proof');
const WRONG_PROOF_PATH = path.join(KERNEL_ROOT, 'fixtures/invalid/wrong-theorem.proof');
const TEMPLATE_BYTES = fs.readFileSync(TEMPLATE_PATH);
const VALID_PROOF = fs.readFileSync(VALID_PROOF_PATH, 'utf8').trim();
const WRONG_PROOF = fs.readFileSync(WRONG_PROOF_PATH, 'utf8').trim();
const THEOREM_STATEMENT = 'theorem candidate_nat_add_zero (n : Nat) : n + 0 = n';
const EMPTY_SHA256 = sha256Text('');
const PREFLIGHT = preflightLeanProofKernel();
const {
  publicKey: FIXTURE_RUNTIME_PUBLIC_KEY,
  privateKey: FIXTURE_RUNTIME_PRIVATE_KEY,
} = crypto.generateKeyPairSync('ed25519');
const FIXTURE_RUNTIME_KEY_ID = sha256Text(FIXTURE_RUNTIME_PUBLIC_KEY.export({
  format: 'der',
  type: 'spki',
}));
const FIXTURE_RUNTIME_POLICY = {
  schemaVersion: 'cortex.learning_os.phd_trust_policy.v1',
  policyId: 'fixture-proof-runtime-policy',
  boundaryId: 'fixture-proof-runtime-boundary',
  productionEnabled: false,
  authorities: [{
    authorityId: 'fixture-proof-runtime-authority',
    capabilities: ['proof_runtime'],
    publicKeyPem: FIXTURE_RUNTIME_PUBLIC_KEY.export({
      format: 'pem',
      type: 'spki',
    }).toString(),
    keyId: FIXTURE_RUNTIME_KEY_ID,
  }],
  truthBoundary: 'Fixture-only authority exercises proof-runtime signature mechanics.',
};
const FIXTURE_PRODUCT_PATHS = [
  'lean-toolchain',
  'lakefile.toml',
  'ProofKernel.lean',
  'ProofKernel/Prelude.lean',
  'ProofKernel/Representative.lean',
];
const FIXTURE_PRODUCT_MANIFEST = FIXTURE_PRODUCT_PATHS.map((manifestPath, index) => ({
  path: manifestPath,
  bytes: index + 1,
  sha256: String(index + 1).repeat(64),
}));
const DEPLOYMENT = {
  schemaVersion: 'cortex.learning_os.deployment_binding.v1',
  sourceCommit: '1'.repeat(40),
  sourceTree: '2'.repeat(40),
  contentDigests: {
    'proof-registry': '3'.repeat(64),
    'proof-runtime-product': sha256Text(canonicalJson(FIXTURE_PRODUCT_MANIFEST)),
    'trust-policy': sha256Text(canonicalJson(FIXTURE_RUNTIME_POLICY)),
  },
};

function fixtureRuntimeEvidence({ manifestDigest = '7'.repeat(64), attestationId = 'fixture-runtime-attestation' } = {}) {
  const productManifest = structuredClone(FIXTURE_PRODUCT_MANIFEST);
  const payload = {
    schemaVersion: 'cortex.learning_os.proof_runtime_attestation_payload.v1',
    fixtureOnly: true,
    product: {
      productId: 'cortex-learning-os-proof-runtime',
      manifest: productManifest,
      manifestSha256: sha256Text(canonicalJson(productManifest)),
    },
    deployment: structuredClone(DEPLOYMENT),
    deploymentSha256: deploymentBindingDigest(DEPLOYMENT),
    trust: {
      policyId: FIXTURE_RUNTIME_POLICY.policyId,
      boundaryId: FIXTURE_RUNTIME_POLICY.boundaryId,
      policySha256: DEPLOYMENT.contentDigests['trust-policy'],
    },
    toolchain: structuredClone(PINNED_LEAN_PROOF_IDENTITIES),
    trustedContext: structuredClone(PINNED_LEAN_PROOF_CONTEXT),
    leanInstallation: {
      schemaVersion: 'cortex.learning_os.lean_proof_installation.v1',
      leanRelease: PINNED_LEAN_PROOF_IDENTITIES.leanRelease,
      leanToolchain: PINNED_LEAN_PROOF_IDENTITIES.leanToolchain,
      leanCommit: PINNED_LEAN_PROOF_IDENTITIES.leanCommit,
      leanArchiveSha256: PINNED_LEAN_PROOF_IDENTITIES.leanArchiveSha256,
      leanExecutableSha256: '1'.repeat(64),
      lakeExecutableSha256: '2'.repeat(64),
    },
    lakeManifest: {
      packages: [
        'Cli',
        'LeanSearchClient',
        'Qq',
        'aesop',
        'batteries',
        'importGraph',
        'mathlib',
        'plausible',
        'proofwidgets',
      ].map((name) => name === 'mathlib'
        ? {
          name,
          type: 'git',
          rev: PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit,
        }
        : { name }),
    },
    leanRootManifest: [{
      path: 'bin/lean',
      type: 'file',
      bytes: 1,
      executable: true,
      sha256: manifestDigest,
    }],
    compiledDependenciesManifest: [{
      root: '.lake/packages/mathlib/.lake/build/lib/lean',
      path: 'Mathlib.olean',
      type: 'file',
      bytes: 1,
      executable: false,
      sha256: manifestDigest,
    }],
  };
  const request = buildProofRuntimeAttestationRequest(payload);
  const requestBytes = Buffer.from(canonicalJson(request), 'utf8');
  const core = {
    schemaVersion: 'cortex.learning_os.authority_attestation.v1',
    attestationId,
    authorityId: 'fixture-proof-runtime-authority',
    payload: {
      schemaVersion: 'cortex.learning_os.proof_runtime_authority_payload.v1',
      requestSha256: sha256Text(requestBytes),
      runtimePayload: payload,
    },
  };
  const attestation = {
    ...core,
    signature: {
      algorithm: 'ed25519',
      keyId: FIXTURE_RUNTIME_KEY_ID,
      valueBase64: crypto.sign(
        null,
        Buffer.from(canonicalJson(core), 'utf8'),
        FIXTURE_RUNTIME_PRIVATE_KEY,
      ).toString('base64'),
    },
  };
  return buildProofRuntimeEvidence(
    Buffer.from(canonicalJson(attestation)),
    requestBytes,
  );
}

function makeTask(overrides = {}) {
  return createProofTask({
    taskId: 'proof-task.nat-add-zero',
    conceptId: 'nat.add-zero',
    theoremStatement: THEOREM_STATEMENT,
    trustedTemplateBytes: TEMPLATE_BYTES,
    runId: 'proof-run.20260727',
    seed: 'proof-seed-001',
    deployment: DEPLOYMENT,
    ...overrides,
  });
}

function makeRecords({ proofTerm = VALID_PROOF, candidateId = 'proof-candidate.valid' } = {}) {
  const task = makeTask();
  const taskBytes = serializeProofRecord(task);
  const candidate = createProofCandidate({ taskBytes, candidateId, proofTerm });
  const candidateBytes = serializeProofRecord(candidate);
  return { task, taskBytes, candidate, candidateBytes };
}

function mutation(value, mutate) {
  const copy = structuredClone(value);
  mutate(copy);
  return copy;
}

function assertStaticRejection(proofTerm, pattern) {
  const taskBytes = serializeProofRecord(makeTask());
  assert.throws(
    () => createProofCandidate({
      taskBytes,
      candidateId: 'proof-candidate.rejected',
      proofTerm,
    }),
    (error) => error?.code === 'CANDIDATE_STATIC_REJECTION' && pattern.test(error.message),
  );
}

function evidenceWithId(core) {
  const { schemaVersion, ...rest } = core;
  return {
    schemaVersion,
    evidenceId: `sha256:${sha256Text(canonicalJson(core))}`,
    ...rest,
  };
}

function syntheticEvidence({ runtimeEvidence = fixtureRuntimeEvidence() } = {}) {
  const { task, taskBytes, candidate, candidateBytes } = makeRecords();
  const taskEnvelope = parseProofRecordBytes(taskBytes, 'task');
  const candidateEnvelope = parseProofRecordBytes(candidateBytes, 'candidate');
  const rendered = renderTrustedProofSource({
    task,
    candidate,
    trustedTemplateBytes: TEMPLATE_BYTES,
  });
  const temporaryDirectory = path.join(os.tmpdir(), 'clos-lean-proof-ABC123');
  const sourcePath = path.join(temporaryDirectory, 'Candidate.lean');
  const leanPath = '/opt/cortex-proof/.lake/packages/mathlib/.lake/build/lib/lean';
  const core = {
    schemaVersion: PROOF_EVIDENCE_SCHEMA,
    taskId: task.taskId,
    candidateId: candidate.candidateId,
    conceptId: task.conceptId,
    bindings: {
      taskBytesSha256: taskEnvelope.bytesSha256,
      taskCanonicalSha256: taskEnvelope.canonicalSha256,
      candidateBytesSha256: candidateEnvelope.bytesSha256,
      candidateCanonicalSha256: candidateEnvelope.canonicalSha256,
      theoremStatementSha256: task.theorem.statementSha256,
      templateSha256: task.theorem.templateSha256,
      candidateProofBytesSha256: candidate.proof.bytesSha256,
      allowedImportsSha256: task.trustedContext.allowedImportsSha256,
      preludeSha256: task.trustedContext.preludeSha256,
      renderedSourceSha256: rendered.sourceSha256,
    },
    toolchain: { ...PINNED_LEAN_PROOF_IDENTITIES },
    deployment: structuredClone(DEPLOYMENT),
    runIdentity: { ...task.runIdentity },
    limits: { ...task.limits },
    kernel: {
      leanVersion: `Lean (version 4.32.1, x86_64-unknown-linux-gnu, commit ${PINNED_LEAN_PROOF_IDENTITIES.leanCommit}, Release)`,
      leanExecutable: '/opt/cortex-lean/bin/lean',
      leanExecutableSha256: '1'.repeat(64),
      lakeExecutable: '/opt/cortex-lean/bin/lake',
      lakeExecutableSha256: '2'.repeat(64),
      mathlibRoot: '/opt/cortex-proof/.lake/packages/mathlib',
      mathlibHead: PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit,
      mathlibTagCommit: PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit,
      lakeManifestSha256: '3'.repeat(64),
      leanPathSha256: sha256Text(leanPath),
      leanToolchainSha256: PINNED_LEAN_PROOF_CONTEXT.leanToolchainSha256,
      lakefileSha256: PINNED_LEAN_PROOF_CONTEXT.lakefileSha256,
      preludeSha256: PINNED_LEAN_PROOF_CONTEXT.preludeSha256,
      authenticatedRuntime: structuredClone(runtimeEvidence),
    },
    command: {
      executable: '/opt/cortex-lean/bin/lean',
      argv: [
        `-DmaxHeartbeats=${task.limits.maxHeartbeats}`,
        `-DmaxRecDepth=${task.limits.maxRecDepth}`,
        '-DwarningAsError=true',
        sourcePath,
      ],
      cwd: '/opt/cortex-proof',
      environment: {
        LANG: 'C',
        LC_ALL: 'C',
        HOME: temporaryDirectory,
        LEAN_PATH: leanPath,
      },
    },
    startedAt: '2026-07-27T12:00:00.000Z',
    completedAt: '2026-07-27T12:00:00.010Z',
    durationMs: 10,
    process: {
      exitCode: 1,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      errorCode: null,
    },
    output: {
      stdout: { observedBytes: 0, capturedBytes: 0, truncated: false, sha256: EMPTY_SHA256 },
      stderr: { observedBytes: 0, capturedBytes: 0, truncated: false, sha256: EMPTY_SHA256 },
    },
    kernelAccepted: false,
    truthBoundary: PROOF_TRUTH_BOUNDARY,
  };
  return evidenceWithId(core);
}

test('proof-kernel project and schemas pin every upstream and product identity', () => {
  assert.equal(fs.readFileSync(path.join(KERNEL_ROOT, 'lean-toolchain'), 'utf8'), 'leanprover/lean4:v4.32.1\n');
  const lakefile = fs.readFileSync(path.join(KERNEL_ROOT, 'lakefile.toml'), 'utf8');
  assert.match(lakefile, /rev = "520045ab14e26149ee970e2e617ca04b09bde5d6"/);
  assert.equal(PINNED_LEAN_PROOF_IDENTITIES.leanCommit, 'f054605aea4b840552cca2e725580bffd1e1b704');
  assert.equal(PINNED_LEAN_PROOF_IDENTITIES.leanArchiveSha256, '57d5c062a6b4bae6fba511a1704aa124dff461c37d0fc94585637fbb7d951b50');
  assert.equal(PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit, '520045ab14e26149ee970e2e617ca04b09bde5d6');

  for (const [file, schemaVersion] of [
    ['proof-task.schema.json', PROOF_TASK_SCHEMA],
    ['proof-candidate.schema.json', PROOF_CANDIDATE_SCHEMA],
    ['proof-kernel-evidence.schema.json', PROOF_EVIDENCE_SCHEMA],
  ]) {
    const schema = JSON.parse(fs.readFileSync(path.join(CLOS_ROOT, 'schemas', file), 'utf8'));
    assert.equal(schema.$id, schemaVersion);
    assert.equal(schema.additionalProperties, false);
    assert.ok(schema.required.length >= 10);
  }
  for (const [file, schemaVersion] of [
    ['proof-runtime-evidence.schema.json', PROOF_RUNTIME_EVIDENCE_SCHEMA],
    ['proof-runtime-attestation-request.schema.json', 'cortex.learning_os.proof_runtime_attestation_request.v1'],
    ['proof-replay-request.schema.json', 'cortex.learning_os.proof_replay_request.v2'],
    ['proof-replay-receipt.schema.json', 'cortex.learning_os.proof_replay_receipt.v1'],
  ]) {
    const schema = JSON.parse(fs.readFileSync(path.join(CLOS_ROOT, 'schemas', file), 'utf8'));
    assert.equal(schema.$id, schemaVersion);
    assert.equal(schema.additionalProperties, false);
  }
});

test('task and candidate records strictly bind exact bytes, canonical digests, and identities', () => {
  const { task, taskBytes, candidate, candidateBytes } = makeRecords();
  assert.deepEqual(validateProofTask(task), { ok: true, errors: [] });
  assert.deepEqual(validateProofCandidate(candidate, taskBytes), { ok: true, errors: [] });
  assert.equal(parseProofRecordBytes(taskBytes).bytesSha256, candidate.taskBinding.bytesSha256);
  assert.equal(parseProofRecordBytes(taskBytes).canonicalSha256, candidate.taskBinding.canonicalSha256);
  assert.equal(parseProofRecordBytes(candidateBytes).canonicalSha256, canonicalProofDigest(candidate));

  assert.throws(
    () => parseProofRecordBytes(Buffer.from(JSON.stringify(task))),
    (error) => error?.code === 'NON_DETERMINISTIC_RECORD_BYTES',
  );
  assert.throws(
    () => parseProofRecordBytes(Buffer.concat([taskBytes, Buffer.from(' ')])),
    (error) => error?.code === 'NON_DETERMINISTIC_RECORD_BYTES',
  );
  const changedTaskBytes = serializeProofRecord(mutation(task, (copy) => { copy.runIdentity.seed = 'different-seed'; }));
  assert.match(validateProofCandidate(candidate, changedTaskBytes).errors.join('; '), /exact task bytes|run identity/);

  const extraTask = { ...task, unexpected: true };
  assert.equal(validateProofTask(extraTask).ok, false);
  const extraCandidate = { ...candidate, unexpected: true };
  assert.equal(validateProofCandidate(extraCandidate, taskBytes).ok, false);
  const wrongProofDigest = mutation(candidate, (copy) => { copy.proof.bytesSha256 = '0'.repeat(64); });
  assert.match(validateProofCandidate(wrongProofDigest, taskBytes).errors.join('; '), /proof byte digest/);
});

test('task validation fails closed on every frozen identity, context, digest, and resource bound', () => {
  const task = makeTask();
  const cases = [
    mutation(task, (copy) => { copy.theorem.statementSha256 = '0'.repeat(64); }),
    mutation(task, (copy) => { copy.theorem.templateSha256 = 'bad'; }),
    mutation(task, (copy) => { copy.trustedContext.allowedImports = ['Mathlib.Data.Nat.Basic']; }),
    mutation(task, (copy) => { copy.trustedContext.allowedImportsSha256 = '0'.repeat(64); }),
    mutation(task, (copy) => { copy.trustedContext.preludeSha256 = '0'.repeat(64); }),
    mutation(task, (copy) => { copy.toolchain.leanCommit = '0'.repeat(40); }),
    mutation(task, (copy) => { copy.toolchain.mathlibCommit = '0'.repeat(40); }),
    mutation(task, (copy) => { copy.deployment.sourceTree = 'invalid-tree'; }),
    mutation(task, (copy) => { copy.runIdentity.runId = '../escape'; }),
    mutation(task, (copy) => { copy.limits.timeoutMs = 30_001; }),
    mutation(task, (copy) => { copy.limits.maxCandidateBytes = 65_537; }),
    mutation(task, (copy) => { copy.limits.maxSourceBytes = 1; }),
    mutation(task, (copy) => { copy.limits.maxStdoutBytes = 65_537; }),
    mutation(task, (copy) => { copy.limits.maxStderrBytes = 65_537; }),
    mutation(task, (copy) => { copy.limits.maxHeartbeats = 2_000_001; }),
    mutation(task, (copy) => { copy.limits.maxRecDepth = 10_001; }),
    mutation(task, (copy) => { copy.truthBoundary = 'proof means mastery'; }),
  ];
  for (const invalid of cases) assert.equal(validateProofTask(invalid).ok, false);
});

test('static proof validation rejects banned declarations, directives, I/O, and injection classes', () => {
  const rejected = [
    ['sorry', 'by\n  sorry', /sorry/],
    ['admit', 'by\n  exact admit', /admit/],
    ['sorryAx', 'by\n  exact sorryAx _ true', /sorryAx/],
    ['axiom', 'by\n  axiom escape : False', /axiom/],
    ['opaque', 'by\n  opaque escape : False', /opaque/],
    ['unsafe', 'by\n  unsafe def escape := 1', /unsafe/],
    ['unsafeCast', 'by\n  exact unsafeCast trivial', /unsafeCast/],
    ['lcProof', 'by\n  exact lcProof', /lcProof/],
    ['partial', 'by\n  partial def escape := escape', /partial/],
    ['extern', 'by\n  extern "escape" escape : Nat', /extern|string literals/],
    ['arbitrary import', 'by\n  exact rfl\nimport Mathlib', /import/],
    ['prelude command', 'by\n  exact rfl\nprelude', /prelude/],
    ['new theorem', 'by\n  theorem escape : True := by trivial', /theorem/],
    ['new definition', 'by\n  def escape := 1', /def/],
    ['new instance', 'by\n  instance : Inhabited Nat := ⟨0⟩', /instance/],
    ['new structure', 'by\n  structure Escape where x : Nat', /structure/],
    ['new inductive', 'by\n  inductive Escape | x', /inductive/],
    ['new class', 'by\n  class Escape where x : Nat', /class/],
    ['namespace escape', 'by\n  namespace Escape', /namespace/],
    ['end escape', 'by\n  exact rfl\nend Escape', /end/],
    ['set_option', 'by\n  set_option pp.all true in exact rfl', /set_option/],
    ['hash directive', 'by\n  exact rfl\n#eval 1', /directives/],
    ['run_tac', 'by\n  run_tac Lean.Elab.Tactic.closeMainGoalUsing `True.intro', /run_tac|command injection/],
    ['native_decide', 'by\n  native_decide', /native_decide/],
    ['include_str', 'by\n  exact include_str "/etc/passwd"', /string literals|include_str/],
    ['IO', 'by\n  exact IO.getEnv "HOME"', /string literals|IO/],
    ['System path', 'by\n  exact System.FilePath.mk "/tmp/x"', /string literals|System/],
    ['process spawn', 'by\n  exact Process.spawn {}', /Process|spawn/],
    ['environment', 'by\n  exact getEnv "HOME"', /string literals|getEnv/],
    ['read file', 'by\n  exact readFile "/etc/passwd"', /string literals|readFile/],
    ['write file', 'by\n  exact writeFile "/tmp/x" "x"', /string literals|writeFile/],
    ['string path', 'by\n  exact "/etc/passwd"', /string literals/],
    ['line comment hiding', 'by\n  exact rfl -- import Mathlib', /comments/],
    ['block comment hiding', 'by\n  exact rfl /- sorry -/', /comments/],
    ['shell substitution', 'by\n  exact $(touch /tmp/pwned)', /command injection/],
    ['backtick injection', 'by\n  exact `rm', /command injection/],
    ['hole marker', `by\n  exact ${'{{CORTEX_PROOF_HOLE}}'}`, /command injection/],
    ['unbalanced close', 'by\n  exact rfl)', /unbalanced/],
    ['interactive suggestion', 'by\n  exact?', /suggestion/],
  ];
  for (const [label, proofTerm, pattern] of rejected) {
    assert.doesNotThrow(() => assertStaticRejection(proofTerm, pattern), label);
  }
  assert.deepEqual(validateCandidateProofTerm('by\n  simp'), { ok: true, errors: [] });
  assert.deepEqual(validateCandidateProofTerm('by\n  intro h\n  exact h'), { ok: true, errors: [] });
});

test('trusted source construction admits only the exact prelude, imports, statement, and one proof hole', () => {
  const { task, candidate } = makeRecords();
  const rendered = renderTrustedProofSource({ task, candidate, trustedTemplateBytes: TEMPLATE_BYTES });
  assert.equal(
    rendered.sourceText,
    fs.readFileSync(TEMPLATE_PATH, 'utf8').replace('{{CORTEX_PROOF_HOLE}}', VALID_PROOF),
  );
  assert.equal(rendered.templateSha256, task.theorem.templateSha256);
  assert.equal(Buffer.byteLength(rendered.sourceText), rendered.sourceBytes.length);

  const assertTemplateRejected = (templateText, expectedCode) => {
    const localTask = makeTask({ trustedTemplateBytes: Buffer.from(templateText) });
    const taskBytes = serializeProofRecord(localTask);
    const localCandidate = createProofCandidate({
      taskBytes,
      candidateId: 'proof-candidate.template-test',
      proofTerm: VALID_PROOF,
    });
    assert.throws(
      () => renderTrustedProofSource({
        task: localTask,
        candidate: localCandidate,
        trustedTemplateBytes: Buffer.from(templateText),
      }),
      (error) => error?.code === expectedCode,
    );
  };

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  assertTemplateRejected(template.replace(
    'import Mathlib',
    'import Mathlib\nimport Mathlib.Data.Nat.Basic',
  ), 'IMPORT_MISMATCH');
  assertTemplateRejected(template.replace(
    '{{CORTEX_PROOF_HOLE}}',
    '{{CORTEX_PROOF_HOLE}}{{CORTEX_PROOF_HOLE}}',
  ), 'INVALID_PROOF_HOLE');
  assertTemplateRejected(template.replace(
    '({{CORTEX_PROOF_HOLE}})',
    '{{CORTEX_PROOF_HOLE}}',
  ), 'INVALID_PROOF_HOLE');
  assertTemplateRejected(template.replace(THEOREM_STATEMENT, 'theorem another_name : True'), 'THEOREM_TEMPLATE_MISMATCH');
  assertTemplateRejected(template.replace(
    'namespace CortexLearningOS.ProofKernel.Candidate',
    'namespace CortexLearningOS.ProofKernel.Candidate\n\naxiom escape : False',
  ), 'UNSAFE_TRUSTED_TEMPLATE');
  assertTemplateRejected(template.replace(
    'import Mathlib',
    'import Mathlib.Data.Nat.Defs',
  ), 'PRELUDE_MISMATCH');

  assert.throws(
    () => renderTrustedProofSource({
      task,
      candidate,
      trustedTemplateBytes: Buffer.concat([TEMPLATE_BYTES, Buffer.from('\n')]),
    }),
    (error) => error?.code === 'TEMPLATE_DIGEST_MISMATCH',
  );
});

test('temporary proof sources are regular, private, bounded, and cleaned on success or error', async () => {
  let successfulDirectory;
  const result = await withTemporaryProofSource(Buffer.from('example : True := by trivial\n'), async ({
    temporaryDirectory,
    sourcePath,
  }) => {
    successfulDirectory = temporaryDirectory;
    const stat = fs.lstatSync(sourcePath);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o077, 0);
    return fs.readFileSync(sourcePath, 'utf8');
  });
  assert.equal(result, 'example : True := by trivial\n');
  assert.equal(fs.existsSync(successfulDirectory), false);

  let failedDirectory;
  await assert.rejects(
    withTemporaryProofSource(Buffer.from('example : True := by trivial\n'), async ({ temporaryDirectory }) => {
      failedDirectory = temporaryDirectory;
      throw new Error('forced callback failure');
    }),
    /forced callback failure/,
  );
  assert.equal(fs.existsSync(failedDirectory), false);
});

test('kernel evidence validation is strict, self-digesting, and truth-bounded', () => {
  const evidence = syntheticEvidence();
  assert.deepEqual(validateKernelEvidence(evidence), { ok: true, errors: [] });

  const extra = { ...evidence, unexpected: true };
  assert.equal(validateKernelEvidence(extra).ok, false);
  const changedBinding = mutation(evidence, (copy) => {
    copy.bindings.taskBytesSha256 = 'f'.repeat(64);
  });
  assert.match(validateKernelEvidence(changedBinding).errors.join('; '), /evidenceId/);
  const falseAcceptance = mutation(evidence, (copy) => {
    copy.kernelAccepted = true;
  });
  assert.match(validateKernelEvidence(falseAcceptance).errors.join('; '), /evidenceId|kernelAccepted/);
  const overclaim = mutation(evidence, (copy) => {
    copy.truthBoundary = 'This proves a PhD.';
  });
  assert.match(validateKernelEvidence(overclaim).errors.join('; '), /truthBoundary|evidenceId/);
});

test('proof-runtime evidence rejects omitted or substituted exact attestation bytes and changed signed bindings', () => {
  const runtime = fixtureRuntimeEvidence();
  const validate = (value) => validateProofRuntimeEvidence(value, {
    trustPolicy: FIXTURE_RUNTIME_POLICY,
    expectedDeployment: DEPLOYMENT,
    allowFixture: true,
  });
  assert.equal(validate(runtime).ok, true, validate(runtime).errors.join('; '));
  assert.equal(validateProofRuntimeEvidence(runtime, {
    trustPolicy: FIXTURE_RUNTIME_POLICY,
    expectedDeployment: DEPLOYMENT,
  }).ok, false);

  const omittedBytes = structuredClone(runtime);
  delete omittedBytes.attestationBytesBase64;
  assert.equal(validate(omittedBytes).ok, false);
  const omittedRequest = structuredClone(runtime);
  delete omittedRequest.requestBytesBase64;
  assert.equal(validate(omittedRequest).ok, false);
  const changedRequest = structuredClone(runtime);
  const decodedRequest = JSON.parse(Buffer.from(
    changedRequest.requestBytesBase64,
    'base64',
  ).toString('utf8'));
  decodedRequest.runtimePayloadSha256 = '0'.repeat(64);
  changedRequest.requestBytesBase64 = Buffer.from(canonicalJson(decodedRequest)).toString('base64');
  changedRequest.requestSha256 = sha256Text(canonicalJson(decodedRequest));
  assert.match(validate(changedRequest).errors.join('; '), /request/);
  const extraRecord = structuredClone(runtime);
  extraRecord.uncheckedMetadata = true;
  assert.equal(validate(extraRecord).ok, false);

  const substitute = fixtureRuntimeEvidence({
    manifestDigest: '8'.repeat(64),
    attestationId: 'fixture-runtime-substitute',
  });
  const substitutedBytes = structuredClone(runtime);
  substitutedBytes.attestationBytesBase64 = substitute.attestationBytesBase64;
  substitutedBytes.attestationSha256 = substitute.attestationSha256;
  assert.match(validate(substitutedBytes).errors.join('; '), /attestation bytes|digest/);

  for (const mutate of [
    (copy) => { copy.attestation.payload.runtimePayload.leanRootManifest[0].sha256 = '9'.repeat(64); },
    (copy) => { copy.attestation.payload.runtimePayload.deployment.sourceCommit = 'a'.repeat(40); },
    (copy) => { copy.attestation.payload.runtimePayload.product.manifest[0].sha256 = 'b'.repeat(64); },
  ]) {
    const changed = structuredClone(runtime);
    mutate(changed);
    assert.equal(validate(changed).ok, false);
  }
});

test('replay identity comparison rejects an otherwise valid replay under a different exact runtime', () => {
  const original = syntheticEvidence({
    runtimeEvidence: fixtureRuntimeEvidence({
      manifestDigest: '7'.repeat(64),
      attestationId: 'fixture-runtime-original',
    }),
  });
  const differentRuntime = syntheticEvidence({
    runtimeEvidence: fixtureRuntimeEvidence({
      manifestDigest: '8'.repeat(64),
      attestationId: 'fixture-runtime-different',
    }),
  });
  assert.equal(validateKernelEvidence(original).ok, true);
  assert.equal(validateKernelEvidence(differentRuntime).ok, true);
  assert.match(
    validateReplayEvidenceIdentity(original, differentRuntime).errors.join('; '),
    /exact runtime/,
  );
});

test('installer and verifier expose no implicit runtime installation or shell execution path', () => {
  const verifierSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/lean-proof-verifier.mjs'), 'utf8');
  const preflightSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/lean-proof-preflight.mjs'), 'utf8');
  const requestSource = fs.readFileSync(
    path.join(CLOS_ROOT, 'src/proof-runtime-attestation-request.mjs'),
    'utf8',
  );
  const installerSource = fs.readFileSync(path.join(CLOS_ROOT, 'scripts/install-lean-proof-kernel.sh'), 'utf8');
  assert.doesNotMatch(verifierSource, /\bexec(?:File|Sync)?\s*\(/);
  assert.match(verifierSource, /shell: false/);
  assert.doesNotMatch(verifierSource, /\bcurl\b|\bwget\b|lake.*update/);
  assert.match(installerSource, /--download-to/);
  assert.match(installerSource, /57d5c062a6b4bae6fba511a1704aa124dff461c37d0fc94585637fbb7d951b50/);
  assert.match(installerSource, /lake_bin" update mathlib/);
  assert.match(installerSource, /--runtime-attestation/);
  assert.match(preflightSource, /EXPECTED_LAKE_PACKAGE_NAMES/);
  assert.match(preflightSource, /compiledDependenciesManifest/);
  assert.match(preflightSource, /proof-runtime-attestation[.]json/);
  assert.match(preflightSource, /capability: 'proof_runtime'/);
  assert.match(requestSource, /buildProofRuntimeAttestationRequest/);
  assert.match(requestSource, /process[.]stdout[.]write[(]canonicalJson[(]/);
  assert.doesNotMatch(requestSource, /console[.]log[(]canonicalJson[(]/);
  assert.match(preflightSource, /selfAttestation: false/);
  assert.match(preflightSource, /requestBytesBase64/);
  assert.match(preflightSource, /requestSha256/);
  assert.doesNotMatch(requestSource, /valueBase64|<proof-runtime-authority>/);
  assert.equal(fs.statSync(path.join(CLOS_ROOT, 'scripts/install-lean-proof-kernel.sh')).mode & 0o111, 0o111);
  assert.equal(fs.statSync(path.join(CLOS_ROOT, 'scripts/preflight-lean-proof-kernel.sh')).mode & 0o111, 0o111);
});

test('runtime manifests admit only the exact declared internal symlinks and bind resolved bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-runtime-manifest-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-runtime-outside-'));
  try {
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(path.join(root, 'lib/libexact.so.1'), 'runtime-v1');
    fs.symlinkSync('libexact.so.1', path.join(root, 'lib/libexact.so'));
    const rows = buildRuntimeContentManifest(root, {
      allowedSymlinks: { 'lib/libexact.so': 'libexact.so.1' },
    });
    const link = rows.find((row) => row.path === 'lib/libexact.so');
    assert.equal(link.type, 'symlink');
    assert.equal(link.target, 'libexact.so.1');
    assert.equal(link.targetSha256, sha256Text('runtime-v1'));
    assert.throws(
      () => buildRuntimeContentManifest(root),
      /unapproved symlink/,
    );
    fs.writeFileSync(path.join(outside, 'escape.so'), 'outside');
    fs.symlinkSync(path.join(outside, 'escape.so'), path.join(root, 'lib/escape.so'));
    assert.throws(
      () => buildRuntimeContentManifest(root, {
        allowedSymlinks: {
          'lib/libexact.so': 'libexact.so.1',
          'lib/escape.so': path.join(outside, 'escape.so'),
        },
      }),
      /escapes its root/,
    );
    fs.unlinkSync(path.join(root, 'lib/escape.so'));
    assert.throws(
      () => buildRuntimeContentManifest(root, {
        allowedSymlinks: {
          'lib/libexact.so': 'libexact.so.1',
          'lib/missing.so': 'missing.so.1',
        },
      }),
      /missing an expected symlink/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('preflight rejects a missing or substituted Lean library root module before runtime use', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-proof-layout-'));
  try {
    fs.copyFileSync(path.join(KERNEL_ROOT, 'lean-toolchain'), path.join(root, 'lean-toolchain'));
    fs.copyFileSync(path.join(KERNEL_ROOT, 'lakefile.toml'), path.join(root, 'lakefile.toml'));
    fs.mkdirSync(path.join(root, 'ProofKernel'));
    fs.copyFileSync(path.join(KERNEL_ROOT, 'ProofKernel/Prelude.lean'), path.join(root, 'ProofKernel/Prelude.lean'));
    fs.copyFileSync(path.join(KERNEL_ROOT, 'ProofKernel/Representative.lean'), path.join(root, 'ProofKernel/Representative.lean'));
    assert.match(preflightLeanProofKernel({ proofKernelRoot: root }).errors.join('; '), /root module/);
    fs.writeFileSync(path.join(root, 'ProofKernel.lean'), 'import Mathlib\n');
    assert.match(preflightLeanProofKernel({ proofKernelRoot: root }).errors.join('; '), /root module/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read-only explicit preflight distinguishes exact ready, absent, and invalid states', () => {
  assert.notEqual(PREFLIGHT.status, 'invalid', PREFLIGHT.errors.join('; '));
  assert.equal(PREFLIGHT.ready, PREFLIGHT.status === 'ready');
  assert.deepEqual(PREFLIGHT.identities, PINNED_LEAN_PROOF_IDENTITIES);
  const before = fs.readFileSync(path.join(KERNEL_ROOT, 'ProofKernel/Prelude.lean'));
  const repeated = preflightLeanProofKernel();
  assert.equal(repeated.status, PREFLIGHT.status);
  assert.deepEqual(repeated.errors, PREFLIGHT.errors);
  assert.deepEqual(fs.readFileSync(path.join(KERNEL_ROOT, 'ProofKernel/Prelude.lean')), before);

  const invalidRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-invalid-proof-kernel-'));
  try {
    const invalid = preflightLeanProofKernel({ proofKernelRoot: invalidRoot });
    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.ready, false);
  } finally {
    fs.rmSync(invalidRoot, { recursive: true, force: true });
  }
});

test('verification fails closed without a successful exact preflight and still cleans its workspace', async () => {
  const absentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-absent-proof-kernel-'));
  try {
    fs.cpSync(KERNEL_ROOT, absentRoot, { recursive: true });
    const { taskBytes, candidateBytes } = makeRecords();
    const substitutedDeployment = structuredClone(DEPLOYMENT);
    substitutedDeployment.sourceCommit = 'f'.repeat(40);
    await assert.rejects(
      verifyLeanProof({
        taskBytes,
        candidateBytes,
        trustedTemplateBytes: TEMPLATE_BYTES,
        proofKernelRoot: absentRoot,
        expectedDeployment: substitutedDeployment,
      }),
      (error) => error?.code === 'DEPLOYMENT_SUBSTITUTION',
    );
    await assert.rejects(
      verifyLeanProof({
        taskBytes,
        candidateBytes,
        trustedTemplateBytes: TEMPLATE_BYTES,
        proofKernelRoot: absentRoot,
        expectedDeployment: DEPLOYMENT,
      }),
      (error) => error?.code === 'KERNEL_ABSENT',
    );
    assert.deepEqual(
      fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('clos-lean-proof-')),
      [],
    );
  } finally {
    fs.rmSync(absentRoot, { recursive: true, force: true });
  }
});

test('real pinned Lean accepts the valid theorem, rejects a wrong proof, and independently replays exact evidence', async (t) => {
  if (PREFLIGHT.status === 'absent') {
    t.skip(`exact preflight reports pinned kernel absent: ${PREFLIGHT.errors.join('; ')}`);
    return;
  }
  assert.equal(PREFLIGHT.status, 'ready', PREFLIGHT.errors.join('; '));

  const acceptedRecords = makeRecords();
  const accepted = await verifyLeanProof({
    taskBytes: acceptedRecords.taskBytes,
    candidateBytes: acceptedRecords.candidateBytes,
    trustedTemplateBytes: TEMPLATE_BYTES,
    expectedDeployment: DEPLOYMENT,
  });
  assert.equal(accepted.kernelAccepted, true);
  assert.equal(accepted.process.exitCode, 0);
  assert.equal(accepted.process.timedOut, false);
  assert.equal(accepted.process.outputLimitExceeded, false);
  assert.equal(accepted.command.executable, PREFLIGHT.leanExecutable);
  assert.equal(accepted.command.argv.length, 4);
  assert.equal(fs.existsSync(accepted.command.argv.at(-1)), false);
  assert.deepEqual(validateKernelEvidence(accepted), { ok: true, errors: [] });

  const acceptedReplay = await replayLeanProofEvidence({
    taskBytes: acceptedRecords.taskBytes,
    candidateBytes: acceptedRecords.candidateBytes,
    trustedTemplateBytes: TEMPLATE_BYTES,
    evidence: accepted,
    expectedDeployment: DEPLOYMENT,
  });
  assert.equal(acceptedReplay.verified, true);
  assert.equal(acceptedReplay.replayEvidence.kernelAccepted, true);
  assert.equal(fs.existsSync(accepted.command.argv.at(-1)), false);

  const wrongRecords = makeRecords({
    proofTerm: WRONG_PROOF,
    candidateId: 'proof-candidate.wrong',
  });
  const rejected = await verifyLeanProof({
    taskBytes: wrongRecords.taskBytes,
    candidateBytes: wrongRecords.candidateBytes,
    trustedTemplateBytes: TEMPLATE_BYTES,
    expectedDeployment: DEPLOYMENT,
  });
  assert.equal(rejected.kernelAccepted, false);
  assert.notEqual(rejected.process.exitCode, 0);
  assert.equal(rejected.process.timedOut, false);
  assert.equal(fs.existsSync(rejected.command.argv.at(-1)), false);
  const rejectedReplay = await replayLeanProofEvidence({
    taskBytes: wrongRecords.taskBytes,
    candidateBytes: wrongRecords.candidateBytes,
    trustedTemplateBytes: TEMPLATE_BYTES,
    evidence: rejected,
    expectedDeployment: DEPLOYMENT,
  });
  assert.equal(rejectedReplay.verified, true);
  assert.equal(rejectedReplay.replayEvidence.kernelAccepted, false);

  const substitutedRecords = makeRecords({ candidateId: 'proof-candidate.substituted' });
  await assert.rejects(
    replayLeanProofEvidence({
      taskBytes: substitutedRecords.taskBytes,
      candidateBytes: substitutedRecords.candidateBytes,
      trustedTemplateBytes: TEMPLATE_BYTES,
      evidence: accepted,
      expectedDeployment: DEPLOYMENT,
    }),
    (error) => error?.code === 'EVIDENCE_SUBSTITUTION',
  );
  const tamperedEvidence = mutation(accepted, (copy) => {
    copy.kernelAccepted = false;
  });
  await assert.rejects(
    replayLeanProofEvidence({
      taskBytes: acceptedRecords.taskBytes,
      candidateBytes: acceptedRecords.candidateBytes,
      trustedTemplateBytes: TEMPLATE_BYTES,
      evidence: tamperedEvidence,
      expectedDeployment: DEPLOYMENT,
    }),
    (error) => error?.code === 'INVALID_EVIDENCE',
  );
});
