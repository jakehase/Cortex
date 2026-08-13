import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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
