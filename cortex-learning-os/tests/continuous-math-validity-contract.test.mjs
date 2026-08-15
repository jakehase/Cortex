import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  createExecutionEvidenceCore,
  executionEvidenceSha256,
  validateExecutionEvidenceCore,
} from '../src/execution-evidence.mjs';
import { sha256Bytes, sha256Text } from '../src/hash.mjs';
import { canonicalCodexExamArgs } from '../src/model-answer-runner.mjs';
import { loadCanonicalPhdProgram } from '../src/phd-program-runtime.mjs';
import {
  createExecutionAttestation,
  PHD_TRUST_POLICY_SCHEMA,
  validatePhdTrustPolicy,
  verifyTrustedExecutionEvidence,
} from '../src/phd-trust.mjs';
import {
  signValidityPlan,
  validateValidityPlan,
  VALIDITY_PLAN_SCHEMA,
} from '../src/validity-plan.mjs';
import {
  signValidityState,
  validateValidityState,
  VALIDITY_STATE_SCHEMA,
} from '../src/validity-state.mjs';

const FIXED_TIME = '2026-08-13T00:00:00.000Z';
const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLOS_ROOT = path.resolve(TEST_ROOT, '..');
const CONTINUATION_SCRIPT = path.join(CLOS_ROOT, 'scripts', 'continue_continuous_math_bank.py');
const REPAIR_CONCEPT_IDS = [
  'differential-equations-weak-solutions',
  'statistics-likelihood-estimation',
  'statistics-neyman-pearson-testing',
  'numerical-analysis-conditioning',
];

function buildEphemeralTrustPolicy(canonicalTrustPolicy) {
  const privateKeys = new Map();
  const authorities = canonicalTrustPolicy.authorities.map((authority, index) => {
    assert.equal(authority.capabilities.length, 1);
    const [capability] = authority.capabilities;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    privateKeys.set(
      capability,
      privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    );
    return {
      authorityId: `ephemeral-validity-smoke-${String(index + 1).padStart(2, '0')}-${capability}`,
      capabilities: [capability],
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      keyId: sha256Text(publicKey.export({ format: 'der', type: 'spki' })),
    };
  });
  const trustPolicy = {
    schemaVersion: PHD_TRUST_POLICY_SCHEMA,
    policyId: 'ephemeral-full-validity-smoke-policy',
    boundaryId: 'ephemeral-full-validity-smoke-boundary',
    productionEnabled: true,
    authorities,
    truthBoundary: 'Ephemeral in-memory keys exercise signing mechanics only and are never production evidence.',
  };
  const validation = validatePhdTrustPolicy(trustPolicy, { requireProduction: true });
  assert.equal(validation.ok, true, validation.errors.join('; '));
  return { privateKeys, trustPolicy };
}

function signPlan(planCore, fixture) {
  return signValidityPlan(planCore, {
    ...fixture.validationOptions,
    privateKeyPem: fixture.privateKeys.get('proctor'),
  });
}

function signState(stateCore, fixture) {
  return signValidityState(stateCore, {
    ...fixture.validationOptions,
    privateKeyPem: fixture.privateKeys.get('grader'),
  });
}

test('full 288-concept validity contract signs fail-closed plan and state without provider calls', () => {
  const program = loadCanonicalPhdProgram({
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    productTree: 'c'.repeat(40),
    allowWorkingTreeFixtures: true,
  });
  assert.equal(program.ok, true, program.errors.join('; '));
  assert.equal(program.sourceMode, 'working_tree_fixture');
  assert.equal(program.productionTrustReady, false);
  assert.equal(program.graph.version, '1.1.0');

  const conceptIds = program.graph.concepts.map((concept) => concept.conceptId);
  assert.equal(conceptIds.length, 288);
  assert.equal(new Set(conceptIds).size, 288);

  const { privateKeys, trustPolicy } = buildEphemeralTrustPolicy(program.trustPolicy);
  const source = {
    sourceCommit: '1'.repeat(40),
    sourceTree: '2'.repeat(40),
    productTree: '3'.repeat(40),
  };
  const bank = {
    bankId: 'ephemeral-full-validity-smoke-bank',
    bankDigest: '4'.repeat(64),
    bankSha256: '5'.repeat(64),
    campaign: {
      campaignId: 'ephemeral-full-validity-smoke-bank-campaign',
      campaignDigest: '6'.repeat(64),
    },
  };
  const acquiredConcepts = conceptIds.map((conceptId, index) => ({
    conceptId,
    acquiredAt: FIXED_TIME,
    evidenceDigest: sha256Text(`ephemeral-acquisition-evidence:${conceptId}`),
    runId: `ephemeral-acquisition-${String(index + 1).padStart(3, '0')}`,
  }));
  const acquisition = {
    revision: 1,
    stateSha256: '7'.repeat(64),
    acquiredOnceCount: conceptIds.length,
    concepts: acquiredConcepts,
  };
  const expectedAcquisition = {
    revision: acquisition.revision,
    stateSha256: acquisition.stateSha256,
    acquiredOnceCount: acquisition.acquiredOnceCount,
  };
  const threshold = {
    requiredRoles: ['validity-direct', 'validity-compositional'],
    minimumScore: 0.8,
    requireAllFamilies: true,
    requireCompositionalPass: true,
    undeclaredToolsAllowed: false,
  };
  const sessions = conceptIds.map((conceptId, index) => {
    const ordinal = String(index + 1).padStart(3, '0');
    const itemIds = [
      `ephemeral-validity-${ordinal}-direct`,
      `ephemeral-validity-${ordinal}-compositional`,
    ];
    const itemContentDigests = itemIds.map((itemId) => (
      sha256Text(`ephemeral-item-content:${conceptId}:${itemId}`)
    ));
    const task = {
      conceptId,
      itemIds,
      itemContentDigests,
      bankDigest: bank.bankDigest,
      acquisitionEvidenceDigest: acquiredConcepts[index].evidenceDigest,
    };
    const taskSha256 = sha256Text(canonicalJson(task));
    const jobId = `ephemeral-full-validity-${ordinal}`;
    return {
      conceptId,
      sessionId: `${jobId}.candidate`,
      itemIds,
      itemContentDigests,
      taskSha256,
      jobId,
      jobSha256: sha256Text(canonicalJson({
        campaignId: 'ephemeral-full-validity-smoke',
        jobId,
        taskSha256,
        sourceCommit: source.sourceCommit,
      })),
    };
  });
  const modelRuntime = {
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    thinking: 'ultra',
    serviceTier: 'fast',
    sandbox: 'read-only',
    toolsAllowed: false,
  };
  const planCore = {
    schemaVersion: VALIDITY_PLAN_SCHEMA,
    campaignId: 'ephemeral-full-validity-smoke',
    generatedAt: FIXED_TIME,
    notBefore: '2026-08-12T23:55:00.000Z',
    expiresAt: '2026-08-14T00:00:00.000Z',
    source,
    bank,
    acquisition,
    modelRuntime,
    threshold,
    sessions,
    truthBoundary: 'This in-memory fixture proves contract and binding mechanics only; it calls no provider, launches no campaign, writes no state, and grants no validity credit.',
    planSha256: null,
    proctorAttestation: null,
  };
  const validationOptions = {
    trustPolicy,
    conceptIds,
    expectedSource: source,
    expectedBank: bank,
    expectedAcquisition,
  };
  const fixture = { privateKeys, validationOptions };
  const signedPlan = signPlan(planCore, fixture);
  const planValidation = validateValidityPlan(signedPlan, validationOptions);
  assert.equal(planValidation.ok, true, planValidation.errors.join('; '));
  assert.deepEqual(signedPlan.modelRuntime, modelRuntime);

  assert.equal(signedPlan.sessions.length, 288);
  assert.equal(new Set(signedPlan.sessions.map((session) => session.conceptId)).size, 288);
  assert.equal(new Set(signedPlan.sessions.map((session) => session.sessionId)).size, 288);
  assert.deepEqual(
    signedPlan.sessions.map((session) => session.conceptId).sort(),
    [...conceptIds].sort(),
  );
  const itemBindings = signedPlan.sessions.flatMap((session) => (
    session.itemIds.map((itemId, index) => ({
      conceptId: session.conceptId,
      itemId,
      itemContentDigest: session.itemContentDigests[index],
    }))
  ));
  assert.equal(itemBindings.length, 576);
  assert.equal(new Set(itemBindings.map((binding) => binding.itemId)).size, 576);
  assert.equal(new Set(itemBindings.map((binding) => binding.itemContentDigest)).size, 576);
  assert.equal(new Set(itemBindings.map((binding) => canonicalJson(binding))).size, 576);

  const invalidRuntimeCases = [
    ['missing serviceTier', (runtime) => { delete runtime.serviceTier; }],
    ['wrong serviceTier', (runtime) => { runtime.serviceTier = 'standard'; }],
    ['weaker reasoning', (runtime) => { runtime.thinking = 'xhigh'; }],
    ['extra runtime key', (runtime) => { runtime.unapprovedRuntimeField = true; }],
  ];
  for (const [label, mutate] of invalidRuntimeCases) {
    const invalidPlan = structuredClone(planCore);
    mutate(invalidPlan.modelRuntime);
    assert.throws(
      () => signPlan(invalidPlan, fixture),
      /validity plan model runtime is invalid/,
      label,
    );
  }

  const executionRoot = '/tmp/ephemeral-full-validity-contract';
  const requestedExecutable = '/opt/ephemeral-validity/codex';
  const executedExecutable = '/proc/self/fd/3';
  const schemaPath = `${executionRoot}/model-answer.schema.json`;
  const outputPath = `${executionRoot}/last-message.json`;
  const promptBytes = Buffer.from('ephemeral validity contract prompt', 'utf8');
  const outputBytes = Buffer.from('{"answers":[]}', 'utf8');
  const eventLedgerBytes = Buffer.from('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n', 'utf8');
  const stderrBytes = Buffer.alloc(0);
  const executionBindings = {
    candidateId: null,
    candidateSessionId: signedPlan.sessions[0].sessionId,
    candidateSha256: sha256Bytes(outputBytes),
    taskId: signedPlan.sessions[0].conceptId,
    taskSha256: signedPlan.sessions[0].taskSha256,
    jobId: signedPlan.sessions[0].jobId,
    jobSha256: signedPlan.sessions[0].jobSha256,
    campaignId: signedPlan.campaignId,
    campaignSha256: signedPlan.planSha256,
    deploymentSha256: '8'.repeat(64),
    sourceSha256: '9'.repeat(64),
  };
  const executable = {
    invoked: requestedExecutable,
    resolvedPath: executedExecutable,
    bytes: 1,
    sha256: 'a'.repeat(64),
  };
  const buildExecutionCore = (runtime) => {
    const commandArgs = canonicalCodexExamArgs({
      temporaryRoot: executionRoot,
      schemaPath,
      lastMessagePath: outputPath,
      model: runtime.model,
      thinking: runtime.thinking,
      serviceTier: runtime.serviceTier ?? null,
    });
    return createExecutionEvidenceCore({
      executionKind: 'model',
      bindings: executionBindings,
      declaredEnvironment: {
        executionKind: 'host_process',
        role: 'validity_candidate',
        modelRuntime: runtime,
      },
      observedEnvironment: { fixture: 'ephemeral-no-provider-validity-contract' },
      requestedArgv: [requestedExecutable, ...commandArgs],
      executedArgv: [executedExecutable, ...commandArgs],
      executable,
      cwd: executionRoot,
      startedAt: '2026-08-13T00:00:10.000Z',
      completedAt: '2026-08-13T00:00:11.000Z',
      exitCode: 0,
      input: {
        name: 'prompt',
        mediaType: 'text/plain; charset=utf-8',
        bytes: promptBytes,
      },
      stdout: eventLedgerBytes,
      stderr: stderrBytes,
      outputFiles: [{
        name: 'model_output',
        path: 'last-message.json',
        mediaType: 'application/json',
        bytes: outputBytes,
      }],
      model: {
        ...runtime,
        toolsUsed: [],
        usage: { input_tokens: 1, output_tokens: 1 },
        providerRequestId: null,
        providerSessionId: 'ephemeral-provider-session',
        plannedSessionId: signedPlan.sessions[0].sessionId,
      },
    });
  };
  const tieredExecutionCore = buildExecutionCore(modelRuntime);
  assert.equal(validateExecutionEvidenceCore(tieredExecutionCore).ok, true);
  const tieredExecutionDigest = executionEvidenceSha256(tieredExecutionCore);
  const tieredAttestation = createExecutionAttestation({
    trustPolicy,
    privateKeyPem: privateKeys.get('execution'),
    executionEvidenceCore: tieredExecutionCore,
    executionEvidenceSha256: tieredExecutionDigest,
    executionId: 'ephemeral-tiered-validity-execution',
  });
  const trustedExpected = {
    modelRuntime,
    role: 'validity_candidate',
    plannedSessionId: signedPlan.sessions[0].sessionId,
    promptSha256: sha256Bytes(promptBytes),
    bindings: executionBindings,
    startedAt: tieredExecutionCore.process.startedAt,
    completedAt: tieredExecutionCore.process.completedAt,
    notBefore: signedPlan.notBefore,
    notAfter: signedPlan.expiresAt,
    approvedExecutable: {
      path: requestedExecutable,
      bytes: executable.bytes,
      sha256: executable.sha256,
    },
  };
  const verifyExecution = (core, digest, attestation) => verifyTrustedExecutionEvidence({
    attestation,
    trustPolicy,
    executionEvidenceCore: core,
    executionEvidenceSha256: digest,
    inputBytes: promptBytes,
    rawOutputBytes: outputBytes,
    rawEventLedgerBytes: eventLedgerBytes,
    rawStderrBytes: stderrBytes,
    expected: trustedExpected,
  });
  assert.equal(
    verifyExecution(tieredExecutionCore, tieredExecutionDigest, tieredAttestation).ok,
    true,
  );

  const argvTamper = structuredClone(tieredExecutionCore);
  const tierIndex = argvTamper.command.requestedArgv.indexOf('service_tier="fast"');
  assert.notEqual(tierIndex, -1);
  argvTamper.command.requestedArgv[tierIndex] = 'service_tier="standard"';
  argvTamper.command.executedArgv[tierIndex] = 'service_tier="standard"';
  argvTamper.command.requestedArgvSha256 = sha256Text(canonicalJson(
    argvTamper.command.requestedArgv,
  ));
  argvTamper.command.executedArgvSha256 = sha256Text(canonicalJson(
    argvTamper.command.executedArgv,
  ));
  const argvTamperValidation = validateExecutionEvidenceCore(argvTamper);
  assert.equal(argvTamperValidation.ok, false);
  assert.match(argvTamperValidation.errors.join('; '), /exact stdin-only canonical worker command/);

  const { serviceTier: _omittedTier, ...tierlessRuntime } = modelRuntime;
  const tierlessExecutionCore = buildExecutionCore(tierlessRuntime);
  const tierlessExecutionDigest = executionEvidenceSha256(tierlessExecutionCore);
  const tierlessAttestation = createExecutionAttestation({
    trustPolicy,
    privateKeyPem: privateKeys.get('execution'),
    executionEvidenceCore: tierlessExecutionCore,
    executionEvidenceSha256: tierlessExecutionDigest,
    executionId: 'ephemeral-tierless-validity-execution',
  });
  const tierlessVerification = verifyExecution(
    tierlessExecutionCore,
    tierlessExecutionDigest,
    tierlessAttestation,
  );
  assert.equal(tierlessVerification.ok, false);
  assert.match(tierlessVerification.errors.join('; '), /runtime, prompt, role, or session binding mismatch/);

  const stateConcepts = conceptIds.map((conceptId, index) => ({
    conceptId,
    acquisitionState: 'acquired_once',
    acquisitionEvidenceDigest: acquiredConcepts[index].evidenceDigest,
    validityState: 'validity_pending',
    requiredItemCount: 2,
    passedItemCount: 0,
    failedItemCount: 0,
    errorItemCount: 0,
    score: 0,
    sessionId: null,
    completedAt: null,
    itemResults: [],
    blockedReasons: [],
  }));
  const counts = {
    conceptCount: 288,
    acquiredOnce: 288,
    validityPending: 288,
    validityConfirmed: 0,
    validityFailed: 0,
    validityBlocked: 0,
  };
  const stateCore = {
    schemaVersion: VALIDITY_STATE_SCHEMA,
    campaignId: signedPlan.campaignId,
    generatedAt: '2026-08-13T00:01:00.000Z',
    source,
    bank,
    acquisition: expectedAcquisition,
    threshold,
    concepts: stateConcepts,
    counts,
    truthBoundary: 'This signed in-memory state is pending-only fixture evidence and grants no validity, retention, utility, or model-weight claim.',
    stateSha256: null,
    graderAttestation: null,
  };
  const signedState = signState(stateCore, fixture);
  const stateValidation = validateValidityState(signedState, validationOptions);
  assert.equal(stateValidation.ok, true, stateValidation.errors.join('; '));
  assert.deepEqual(stateValidation.counts, counts);
  assert.equal(new Set(signedState.concepts.map((row) => row.conceptId)).size, 288);

  const falseGreenState = structuredClone(stateCore);
  falseGreenState.concepts[0].validityState = 'validity_confirmed';
  falseGreenState.concepts[0].sessionId = signedPlan.sessions[0].sessionId;
  falseGreenState.concepts[0].completedAt = '2026-08-13T00:00:30.000Z';
  falseGreenState.counts.validityPending = 287;
  falseGreenState.counts.validityConfirmed = 1;
  assert.throws(
    () => signState(falseGreenState, fixture),
    /confirmed validity threshold is not met/,
  );
});

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function fileSha256(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function fixtureItem(concept, assessmentRole) {
  const expected = `${concept.conceptId}-${assessmentRole}-answer`;
  return {
    itemKey: `${concept.conceptId}:${assessmentRole}:1`,
    conceptId: concept.conceptId,
    assessmentRole,
    variant: 1,
    prompt: `Synthetic no-provider prompt for ${concept.conceptId} in ${assessmentRole}. Return the bound answer.`,
    answerFormat: 'Return the exact bound string.',
    checker: {
      mode: 'exact_string',
      expectedJson: JSON.stringify(expected),
      tolerance: 0,
      caseSensitive: true,
    },
    outcomeCoverage: [...concept.outcomes],
    authorRationale: `Synthetic derivation binds the unique expected string ${expected}.`,
  };
}

function acceptedHashes(priorRoot) {
  return Object.fromEntries(
    fs.readdirSync(path.join(priorRoot, 'batches'))
      .map((name) => path.join(priorRoot, 'batches', name, 'accepted.json'))
      .filter((target) => fs.existsSync(target))
      .sort()
      .map((target) => [path.relative(priorRoot, target), fileSha256(target)]),
  );
}

function treeSnapshot(root) {
  const entries = [];
  const visit = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      const target = path.join(current, name);
      const relative = path.relative(root, target);
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) {
        entries.push(`directory:${relative}`);
        visit(target);
      } else {
        entries.push(`file:${relative}:${fileSha256(target)}`);
      }
    }
  };
  visit(root);
  return entries;
}

function regularTreeManifest(root) {
  const directories = ['.'];
  const files = [];
  const visit = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      const target = path.join(current, name);
      const relativePath = path.relative(root, target).split(path.sep).join('/');
      const stat = fs.lstatSync(target);
      assert.equal(stat.isSymbolicLink(), false, `fixture manifest rejects symlink ${relativePath}`);
      if (stat.isDirectory()) {
        directories.push(relativePath);
        visit(target);
      } else {
        assert.equal(stat.isFile(), true, `fixture manifest requires regular file ${relativePath}`);
        files.push({ relativePath, sha256: fileSha256(target), bytes: stat.size });
      }
    }
  };
  visit(root);
  directories.sort();
  files.sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ));
  const totalBytes = files.reduce((total, row) => total + row.bytes, 0);
  const manifestSha256 = sha256Text(canonicalJson({ directories, files }));
  return {
    schemaVersion: 'cortex.learning_os.regular_tree_manifest.v1',
    algorithm: 'sha256',
    directories,
    files,
    directoryCount: directories.length,
    fileCount: files.length,
    regularFileCount: files.length,
    bytes: totalBytes,
    totalBytes,
    sha256: manifestSha256,
    manifestSha256,
  };
}

function replaceCommandArgument(commandArgs, flag, value) {
  const updated = [...commandArgs];
  const index = updated.indexOf(flag);
  assert.notEqual(index, -1, `missing fixture command argument ${flag}`);
  updated[index + 1] = value;
  return updated;
}

function buildContinuationFixture(label) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `clos-continuation-${label}-`));
  const historicalRuntimeRoot = path.join(fixtureRoot, 'historical-runtime');
  const historicalInputsRoot = path.join(historicalRuntimeRoot, 'inputs');
  const priorRoot = path.join(historicalRuntimeRoot, 'commissioning');
  const freshRuntimeRoot = path.join(fixtureRoot, 'fresh-runtime');
  const continuationRoot = path.join(freshRuntimeRoot, 'commissioning');
  const homeRoot = path.join(fixtureRoot, 'home');
  const campaignId = `synthetic-${label}-validity-bank`;
  const source = {
    sourceCommit: '1'.repeat(40),
    sourceTree: '2'.repeat(40),
    productTree: '3'.repeat(40),
  };
  fs.mkdirSync(priorRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(homeRoot, { recursive: true, mode: 0o700 });
  const concepts = Array.from({ length: 288 }, (_, index) => ({
    conceptId: `fixture-concept-${String(index + 1).padStart(3, '0')}`,
    title: `Fixture concept ${index + 1}`,
    category: 'synthetic',
    prerequisites: [],
    outcomes: [`Prove synthetic fixture outcome ${index + 1}.`],
    stage: 'fixture',
    tracks: ['fixture-track'],
    sourceIds: [],
  }));
  REPAIR_CONCEPT_IDS.forEach((conceptId, offset) => {
    concepts[196 + offset] = {
      conceptId,
      title: `Repair fixture ${offset + 1}`,
      category: 'synthetic-repair',
      prerequisites: [],
      outcomes: [`Prove repair fixture outcome ${offset + 1}.`],
      stage: 'fixture',
      tracks: ['fixture-track'],
      sourceIds: [],
    };
  });
  const itemBlueprints = [
    { assessmentRole: 'validity-direct', variant: 1 },
    { assessmentRole: 'validity-compositional', variant: 1 },
  ];
  const modelRuntime = {
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    thinking: 'ultra',
    serviceTier: 'fast',
    sandbox: 'read-only',
    toolsAllowed: false,
  };
  const spec = {
    schemaVersion: 'cortex.learning_os.continuous_math_bank_commissioning_spec.v1',
    campaignId,
    purpose: 'validity',
    source,
    curriculum: { curriculumId: 'synthetic-fixture', version: '1.0.0' },
    conceptCount: 288,
    expectedItemCount: 576,
    concepts,
    itemBlueprints,
    secrecyClass: 'synthetic_no_provider_fixture',
    modelRuntime,
    provenancePolicy: { independentReviewerRequired: true },
    truthBoundary: 'Synthetic fixture input grants no validity or other learning credit.',
  };
  const specPath = path.join(historicalInputsRoot, 'validity.commissioning-spec.json');
  writeJson(specPath, spec);

  for (let batchIndex = 1; batchIndex <= 72; batchIndex += 1) {
    const batchId = `batch-${String(batchIndex).padStart(3, '0')}`;
    const batchRoot = path.join(priorRoot, 'batches', batchId);
    fs.mkdirSync(batchRoot, { recursive: true, mode: 0o700 });
    if (batchIndex === 50) {
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        fs.mkdirSync(path.join(batchRoot, `attempt-${attempt}`), { mode: 0o700 });
      }
      writeJson(path.join(batchRoot, 'progress.json'), {
        acceptedConceptIds: [],
        pendingConceptIds: REPAIR_CONCEPT_IDS,
        receipts: [],
      });
      continue;
    }
    const batchConcepts = concepts.slice((batchIndex - 1) * 4, batchIndex * 4);
    const items = batchConcepts.flatMap((concept) => (
      itemBlueprints.map(({ assessmentRole }) => fixtureItem(concept, assessmentRole))
    ));
    writeJson(path.join(batchRoot, 'accepted.json'), {
      batchId,
      conceptIds: batchConcepts.map((concept) => concept.conceptId),
      items,
      receipts: [{
        attempt: 1,
        batchId,
        authorThreadId: `prior-${label}-${batchId}-author`,
        authorUsage: { input_tokens: 10, output_tokens: 10, reasoning_output_tokens: 1 },
        reviewerThreadId: `prior-${label}-${batchId}-reviewer`,
        reviewerUsage: { input_tokens: 10, output_tokens: 10, reasoning_output_tokens: 1 },
        acceptedConceptIds: batchConcepts.map((concept) => concept.conceptId),
        rejected: {},
      }],
    });
  }

  const blockerIds = REPAIR_CONCEPT_IDS.map((conceptId) => `'${conceptId}'`).join(', ');
  const priorState = {
    schemaVersion: 'cortex.learning_os.continuous_math_bank_commissioning_state.v1',
    status: 'blocked',
    campaignId,
    purpose: 'validity',
    artifactRoot: priorRoot,
    source,
    model: 'gpt-5.6-sol',
    thinking: 'ultra',
    concurrency: 4,
    batchSize: 4,
    totalBatches: 72,
    completedBatches: 71,
    acceptedConcepts: 284,
    acceptedItems: 568,
    providerCallsStarted: 142,
    providerCallsCompleted: 142,
    providerInputTokens: 1420,
    providerOutputTokens: 1420,
    providerReasoningTokens: 142,
    blocker: `batch-050 exhausted independent review repairs: [${blockerIds}]`,
    startedAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    completedAt: FIXED_TIME,
    truthBoundary: 'Synthetic blocked commissioning state grants no learning credit.',
  };
  const priorStatePath = path.join(priorRoot, 'state.json');
  writeJson(priorStatePath, priorState);

  const repairConcepts = concepts.slice(196, 200);
  const repairItems = repairConcepts.flatMap((concept) => (
    itemBlueprints.map(({ assessmentRole }) => fixtureItem(concept, assessmentRole))
  ));
  const authorPayload = {
    batchId: 'batch-050',
    items: repairItems,
  };
  const reviewerPayload = {
    batchId: 'batch-050',
    accepted: true,
    batchIssues: [],
    reviews: repairItems.map((item) => ({
      itemKey: item.itemKey,
      accepted: true,
      recomputedExpectedJson: item.checker.expectedJson,
      issues: [],
      reviewRationale: 'Synthetic independent recomputation confirms the exact bound answer.',
    })),
  };
  const authorSchema = path.join(CLOS_ROOT, 'schemas', 'continuous-math-bank-author-output.schema.json');
  const reviewerSchema = path.join(CLOS_ROOT, 'schemas', 'continuous-math-bank-reviewer-output.schema.json');
  const fakeCodex = path.join(fixtureRoot, 'fake-codex.py');
  fs.writeFileSync(fakeCodex, `#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

output = Path(sys.argv[sys.argv.index("-o") + 1])
role = "author" if output.name.startswith("author-") else "reviewer"
with open(os.environ["FAKE_CODEX_CALL_LOG"], "a", encoding="utf-8") as handle:
    handle.write(role + "\\n")
if role == "author" and os.environ.get("FAKE_CODEX_MUTATE_PATH"):
    with open(os.environ["FAKE_CODEX_MUTATE_PATH"], "ab") as handle:
        handle.write(b" ")
payload = json.loads(os.environ["FAKE_CODEX_AUTHOR_JSON" if role == "author" else "FAKE_CODEX_REVIEWER_JSON"])
output.write_text(json.dumps(payload), encoding="utf-8")
print(json.dumps({"type": "thread.started", "thread_id": "fresh-" + role + "-${label}"}))
print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 11, "output_tokens": 12, "reasoning_output_tokens": 1}}))
`, { mode: 0o700 });
  fs.chmodSync(fakeCodex, 0o700);
  const approvedBinding = path.join(historicalInputsRoot, 'approved-model-executable.json');
  writeJson(approvedBinding, {
    schemaVersion: 'cortex.learning_os.approved_model_executable.v1',
    path: fakeCodex,
    bytes: fs.statSync(fakeCodex).size,
    sha256: fileSha256(fakeCodex),
  });
  const callLog = path.join(fixtureRoot, 'fake-codex-calls.log');
  const expectedRuntimeMaterials = {
    authorSchema: { path: authorSchema, sha256: fileSha256(authorSchema) },
    reviewerSchema: { path: reviewerSchema, sha256: fileSha256(reviewerSchema) },
    approvedModelExecutableBinding: {
      path: approvedBinding,
      sha256: fileSha256(approvedBinding),
    },
    codexExecutable: {
      path: fakeCodex,
      sha256: fileSha256(fakeCodex),
      bytes: fs.statSync(fakeCodex).size,
    },
  };
  const commandArgs = [
    CONTINUATION_SCRIPT,
    '--historical-runtime-root', historicalRuntimeRoot,
    '--fresh-runtime-root', freshRuntimeRoot,
    '--root', continuationRoot,
    '--prior-root', priorRoot,
    '--spec', specPath,
    '--author-schema', authorSchema,
    '--reviewer-schema', reviewerSchema,
    '--codex', fakeCodex,
    '--approved-model-executable-binding', approvedBinding,
    '--home', homeRoot,
    '--empty', path.join(freshRuntimeRoot, 'empty'),
    '--expected-campaign-id', campaignId,
    '--expected-source-commit', source.sourceCommit,
    '--expected-source-tree', source.sourceTree,
    '--expected-product-tree', source.productTree,
    '--expected-prior-state-sha256', fileSha256(priorStatePath),
    '--expected-spec-sha256', fileSha256(specPath),
    '--expected-author-schema-sha256', fileSha256(authorSchema),
    '--expected-reviewer-schema-sha256', fileSha256(reviewerSchema),
    '--expected-approved-model-executable-binding-sha256', fileSha256(approvedBinding),
    '--model', 'gpt-5.6-sol',
    '--thinking', 'ultra',
    '--service-tier', 'fast',
    '--max-attempts', '6',
    '--call-timeout', '30',
  ];
  const environment = {
    ...process.env,
    FAKE_CODEX_AUTHOR_JSON: JSON.stringify(authorPayload),
    FAKE_CODEX_REVIEWER_JSON: JSON.stringify(reviewerPayload),
    FAKE_CODEX_CALL_LOG: callLog,
  };
  return {
    fixtureRoot,
    historicalRuntimeRoot,
    freshRuntimeRoot,
    priorRoot,
    continuationRoot,
    specPath,
    priorStatePath,
    authorSchema,
    reviewerSchema,
    fakeCodex,
    approvedBinding,
    expectedRuntimeMaterials,
    spec,
    commandArgs,
    environment,
    callLog,
  };
}

test('batch-050 commissioning continuation reuses exact inventory and rejects hostile mutation without provider calls', (t) => {
  const happy = buildContinuationFixture('happy');
  const hostile = buildContinuationFixture('hostile');
  const overlapping = buildContinuationFixture('overlapping');
  t.after(() => {
    fs.rmSync(happy.fixtureRoot, { recursive: true, force: true });
    fs.rmSync(hostile.fixtureRoot, { recursive: true, force: true });
    fs.rmSync(overlapping.fixtureRoot, { recursive: true, force: true });
  });

  const priorHashes = acceptedHashes(happy.priorRoot);
  const priorTree = treeSnapshot(happy.priorRoot);
  const expectedPriorManifest = regularTreeManifest(happy.priorRoot);
  assert.equal(Object.keys(priorHashes).length, 71);
  assert.equal(fs.existsSync(happy.freshRuntimeRoot), false);
  const happyResult = spawnSync('python3', happy.commandArgs, {
    encoding: 'utf8',
    env: happy.environment,
  });
  assert.equal(happyResult.status, 0, `${happyResult.stdout}\n${happyResult.stderr}`);
  assert.deepEqual(fs.readFileSync(happy.callLog, 'utf8').trim().split('\n'), ['author', 'reviewer']);
  assert.deepEqual(acceptedHashes(happy.priorRoot), priorHashes);
  assert.deepEqual(treeSnapshot(happy.priorRoot), priorTree);
  assert.equal(JSON.parse(fs.readFileSync(path.join(happy.priorRoot, 'state.json'), 'utf8')).status, 'blocked');
  assert.equal(fs.readdirSync(path.join(happy.priorRoot, 'batches', 'batch-050')).filter((name) => name.startsWith('attempt-')).length, 6);
  assert.equal(fs.existsSync(path.join(happy.continuationRoot, 'batches', 'batch-050', 'attempt-1', 'author-output.json')), true);
  assert.equal(fs.existsSync(path.join(happy.continuationRoot, 'batches', 'batch-050', 'attempt-1', 'reviewer-output.json')), true);

  const outputPath = path.join(happy.continuationRoot, 'commissioned-content.json');
  const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  const state = JSON.parse(fs.readFileSync(path.join(happy.continuationRoot, 'state.json'), 'utf8'));
  assert.equal(state.status, 'completed');
  assert.equal(state.historicalRuntimeRoot, happy.historicalRuntimeRoot);
  assert.equal(state.freshRuntimeRoot, happy.freshRuntimeRoot);
  assert.equal(state.priorBlockedRoot, happy.priorRoot);
  assert.deepEqual(fs.readdirSync(happy.freshRuntimeRoot).sort(), ['commissioning', 'empty']);
  assert.equal(state.completedBatches, 72);
  assert.equal(state.acceptedConcepts, 288);
  assert.equal(state.acceptedItems, 576);
  assert.equal(state.providerCallsStarted, 2);
  assert.equal(state.providerCallsCompleted, 2);
  assert.equal(state.outputSha256, fileSha256(outputPath));
  assert.equal(output.schemaVersion, 'cortex.learning_os.commissioned_assessment_content.v2');
  assert.equal(output.conceptCount, 288);
  assert.equal(output.itemCount, 576);
  assert.equal(output.items.length, 576);
  assert.equal(new Set(output.items.map((item) => item.itemKey)).size, 576);
  assert.equal(new Set(output.items.map((item) => item.conceptId)).size, 288);
  assert.equal(output.batchReceipts.length, 72);
  assert.deepEqual(output.continuationProvenance, state.continuationProvenance);
  assert.equal(output.continuationProvenance.historicalRuntimeRoot, happy.historicalRuntimeRoot);
  assert.equal(output.continuationProvenance.freshRuntimeRoot, happy.freshRuntimeRoot);
  assert.deepEqual(output.continuationProvenance.runtimeMaterials, happy.expectedRuntimeMaterials);
  assert.deepEqual(output.continuationProvenance.priorRootManifest, expectedPriorManifest);
  assert.equal(output.continuationProvenance.reusedAcceptedArtifacts.length, 71);
  assert.equal(output.continuationProvenance.partition.reusedConcepts, 284);
  assert.equal(output.continuationProvenance.partition.reusedItems, 568);
  assert.equal(
    output.continuationProvenance.reusedAcceptedInventorySha256,
    sha256Text(canonicalJson(output.continuationProvenance.reusedAcceptedArtifacts)),
  );
  assert.deepEqual(output.continuationProvenance.partition.repairConceptIds, REPAIR_CONCEPT_IDS);
  const repairArtifact = output.continuationProvenance.repairAcceptedArtifact;
  const repairRoot = path.join(happy.continuationRoot, 'batches', 'batch-050');
  const repairAcceptedPath = path.join(repairRoot, 'accepted.json');
  const repairAccepted = JSON.parse(fs.readFileSync(repairAcceptedPath, 'utf8'));
  const expectedUsage = { input_tokens: 11, output_tokens: 12, reasoning_output_tokens: 1 };
  const expectedReceipt = {
    attempt: 1,
    batchId: 'batch-050',
    authorThreadId: 'fresh-author-happy',
    authorUsage: expectedUsage,
    reviewerThreadId: 'fresh-reviewer-happy',
    reviewerUsage: expectedUsage,
    acceptedConceptIds: [...REPAIR_CONCEPT_IDS].sort(),
    rejected: {},
  };
  assert.equal(repairArtifact.attemptCount, 1);
  assert.equal(repairArtifact.acceptedAttempt, 1);
  assert.equal(repairArtifact.reviewedAttemptCount, 1);
  assert.equal(repairArtifact.sha256, fileSha256(repairAcceptedPath));
  assert.equal(repairArtifact.bytes, fs.statSync(repairAcceptedPath).size);
  assert.deepEqual(repairAccepted.receipts, [expectedReceipt]);
  assert.deepEqual(output.batchReceipts[49], { batchId: 'batch-050', receipts: [expectedReceipt] });
  assert.deepEqual(repairArtifact.providerCalls, [
    {
      attempt: 1,
      role: 'author',
      threadId: 'fresh-author-happy',
      eventsSha256: fileSha256(path.join(repairRoot, 'attempt-1', 'author-events.jsonl')),
      usage: expectedUsage,
    },
    {
      attempt: 1,
      role: 'reviewer',
      threadId: 'fresh-reviewer-happy',
      eventsSha256: fileSha256(path.join(repairRoot, 'attempt-1', 'reviewer-events.jsonl')),
      usage: expectedUsage,
    },
  ]);
  assert.deepEqual(repairArtifact.artifactManifest, regularTreeManifest(repairRoot));
  assert.match(output.truthBoundary, /no validity, retention, utility, mastery, or model-weight credit/);

  const pipelinePath = path.join(CLOS_ROOT, 'scripts', 'run_continuous_math_validity_pipeline.py');
  const adoptionProbe = spawnSync('python3', [
    '-c',
    `import importlib.util, json, sys
module_spec = importlib.util.spec_from_file_location("validity_pipeline", sys.argv[1])
module = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(module)
state = json.load(open(sys.argv[2], encoding="utf-8"))
content = json.load(open(sys.argv[3], encoding="utf-8"))
commissioning_spec = json.load(open(sys.argv[4], encoding="utf-8"))
runtime_materials = json.loads(sys.argv[5])
provenance = module.validate_continuation_state(
    state,
    bank_id=commissioning_spec["campaignId"],
    source=commissioning_spec["source"],
    historical_runtime_root=sys.argv[6],
    runtime_root=sys.argv[7],
    prior_root=sys.argv[8],
    continuation_root=sys.argv[9],
    prior_state_sha256=sys.argv[10],
    commissioned_content_sha256=sys.argv[11],
    spec_sha256=sys.argv[12],
    spec=commissioning_spec,
    runtime_materials=runtime_materials,
)
module.validate_continuation_content(
    content,
    bank_id=commissioning_spec["campaignId"],
    source=commissioning_spec["source"],
    spec=commissioning_spec,
    provenance=provenance,
)
`,
    pipelinePath,
    path.join(happy.continuationRoot, 'state.json'),
    outputPath,
    happy.specPath,
    JSON.stringify(happy.expectedRuntimeMaterials),
    happy.historicalRuntimeRoot,
    happy.freshRuntimeRoot,
    happy.priorRoot,
    happy.continuationRoot,
    fileSha256(happy.priorStatePath),
    fileSha256(outputPath),
    fileSha256(happy.specPath),
  ], { encoding: 'utf8' });
  assert.equal(adoptionProbe.status, 0, `${adoptionProbe.stdout}\n${adoptionProbe.stderr}`);

  const mutateTarget = path.join(hostile.priorRoot, 'batches', 'batch-001', 'accepted.json');
  const hostileResult = spawnSync('python3', hostile.commandArgs, {
    encoding: 'utf8',
    env: { ...hostile.environment, FAKE_CODEX_MUTATE_PATH: mutateTarget },
  });
  assert.equal(hostileResult.status, 2, `${hostileResult.stdout}\n${hostileResult.stderr}`);
  assert.deepEqual(fs.readFileSync(hostile.callLog, 'utf8').trim().split('\n'), ['author', 'reviewer']);
  assert.equal(fs.existsSync(path.join(hostile.continuationRoot, 'commissioned-content.json')), false);
  const hostileState = JSON.parse(fs.readFileSync(path.join(hostile.continuationRoot, 'state.json'), 'utf8'));
  const hostileBlocker = JSON.parse(fs.readFileSync(path.join(hostile.continuationRoot, 'blocker-report.json'), 'utf8'));
  assert.equal(hostileState.status, 'blocked');
  assert.equal(hostileBlocker.status, 'blocked');
  assert.equal(hostileBlocker.schemaVersion, 'cortex.learning_os.continuous_math_bank_commissioning_continuation_blocker.v1');
  assert.match(hostileState.blocker.message, /prior root, accepted inventory, or runtime material changed during continuation/);
  assert.match(hostileState.truthBoundary, /no validity, retention, utility, mastery, or model-weight credit/);

  const overlappingFreshRuntime = path.join(overlapping.historicalRuntimeRoot, 'nested-fresh-runtime');
  let overlappingCommand = replaceCommandArgument(
    overlapping.commandArgs,
    '--fresh-runtime-root',
    overlappingFreshRuntime,
  );
  overlappingCommand = replaceCommandArgument(
    overlappingCommand,
    '--root',
    path.join(overlappingFreshRuntime, 'commissioning'),
  );
  overlappingCommand = replaceCommandArgument(
    overlappingCommand,
    '--empty',
    path.join(overlappingFreshRuntime, 'empty'),
  );
  const overlappingResult = spawnSync('python3', overlappingCommand, {
    encoding: 'utf8',
    env: overlapping.environment,
  });
  assert.equal(overlappingResult.status, 2, `${overlappingResult.stdout}\n${overlappingResult.stderr}`);
  const overlappingBlocker = JSON.parse(overlappingResult.stderr);
  assert.equal(overlappingBlocker.status, 'blocked');
  assert.equal(overlappingBlocker.phase, 'preflight');
  assert.equal(overlappingBlocker.blocker.code, 'continuation_preflight_rejected');
  assert.match(overlappingBlocker.blocker.message, /historical and fresh runtime roots must be disjoint/);
  assert.equal(fs.existsSync(overlapping.callLog), false);
  assert.equal(fs.existsSync(overlappingFreshRuntime), false);

  const pipelineSource = fs.readFileSync(path.join(CLOS_ROOT, 'scripts', 'run_continuous_math_validity_pipeline.py'), 'utf8');
  const launcherPath = path.join(CLOS_ROOT, 'scripts', 'launch_continuous_math_validity.sh');
  const launcherSource = fs.readFileSync(launcherPath, 'utf8');
  for (const flag of [
    '--prior-blocked-commissioning-root',
    '--prior-blocked-commissioning-state-sha256',
    '--adopt-commissioning-continuation-root',
    '--adopt-commissioning-continuation-state-sha256',
    '--adopt-commissioned-content-sha256',
    '--adoption-runtime-root',
    '--expected-source-commit',
    '--external-supervisor-path',
    '--external-supervisor-sha256',
    '--resume',
  ]) {
    assert.equal(pipelineSource.includes(flag), true, `pipeline is missing ${flag}`);
    assert.equal(launcherSource.includes(flag), true, `launcher is missing ${flag}`);
  }
  assert.equal(launcherSource.includes('--frozen-source-repo-root'), true);
  assert.match(launcherSource, /EXPECTED_SOURCE_COMMIT="93486b4a88cb6d6981b4db6c780eb7dbb3e4f98c"/);
  assert.match(launcherSource, /repaired pipeline supervisor must remain external to the frozen source checkout/);
  assert.match(pipelineSource, /pipeline supervisor must be this exact external regular file outside the frozen source checkout/);
  assert.match(launcherSource, /PIPELINE_ARGUMENTS\+=\(--resume\)/);
  assert.match(pipelineSource, /source_commit != args\.expected_source_commit/);
  const launcherSyntax = spawnSync('bash', ['-n', launcherPath], { encoding: 'utf8' });
  assert.equal(launcherSyntax.status, 0, launcherSyntax.stderr);
  assert.match(pipelineSource, /adoption never falls back to commissioning/);
});
