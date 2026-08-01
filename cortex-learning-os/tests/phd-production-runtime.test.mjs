import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  assembleExamAttempt,
  assembleProofRun,
  assembleResearchEvidence,
  atomicWritePhdCampaignReport,
  buildCandidateExamRelease,
  buildCanonicalQualificationJobs,
  buildDetachedQualificationJobs,
  buildExamJobDescriptors,
  buildProofCandidateJobDescriptors,
  buildSealedQualificationBanks,
  buildResearchJobDescriptor,
  createAcquisitionQualificationReceipt,
  createProofReplayReceipt,
  freezePhdCampaign,
  phdCampaignVerificationBundleSha256,
  verifyAndAtomicWritePhdCampaignReport,
  verifyDetachedQualificationJobPlan,
  verifyQualificationHarvestEvidence,
  verifyPhdCampaign,
} from '../src/phd-campaign.mjs';
import { generateExercise } from '../src/generated-exercises.mjs';
import { researchSourceBundleDigest } from '../src/frozen-research-reproduction.mjs';
import { sha256File, sha256Text } from '../src/hash.mjs';
import { buildProofRuntimeAttestationPayload } from '../src/lean-proof-preflight.mjs';
import { observeApprovedResearchDaemon } from '../src/approved-research-runtime.mjs';
import {
  deploymentBindingDigest,
  sourceDeploymentBinding,
} from '../src/deployment-identity.mjs';
import { loadCanonicalPhdProgram } from '../src/phd-program-runtime.mjs';
import { buildLayeredPhdStatus } from '../src/phd-status.mjs';
import { createMasteryState, signMasteryState } from '../src/mastery-state.mjs';
import {
  createProofCandidate,
  parseProofRecordBytes,
  serializeProofRecord,
} from '../src/lean-proof-verifier.mjs';
import { createObligationProofTask, loadProofObligationRegistry, materializeProofTemplate } from '../src/phd-proof-registry.mjs';
import {
  createProofCandidateReplayMaterialization,
  createProofCandidateJobTask,
  createResearchArtifactSource,
  DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA,
  materializeResearchArtifactDigest,
  validateProofCandidateJobTask,
} from '../src/proof-candidate-job-task.mjs';
import {
  cycle10QualificationDeployment,
} from './research-runtime-fixture.mjs';
import {
  assertRetentionResumeRuntimeIdentity,
  buildRetentionWaitContract,
  buildRetentionWorkerPrompt,
  buildRetentionWindowTask,
  evaluateRetentionStatus,
  gradeRetentionWindow,
  releaseRetentionWindow,
  validateRetentionPolicy,
} from '../src/phd-retention.mjs';

const secret = 'phd-production-runtime-test-secret-000000000000000000';
const sourceCommit = 'a'.repeat(40);
const sourceTree = 'b'.repeat(40);
const runtime = loadCanonicalPhdProgram({
  sourceCommit,
  sourceTree,
  allowWorkingTreeFixtures: true,
});
const retentionProgramInputs = {
  graph: runtime.graph,
  rubric: runtime.rubric,
  trustPolicy: runtime.trustPolicy,
};

test('fixture mode is a strict boolean at exported campaign and retention boundaries', async () => {
  const campaignConsumers = [
    buildCandidateExamRelease,
    buildExamJobDescriptors,
    buildProofCandidateJobDescriptors,
    buildResearchJobDescriptor,
    assembleExamAttempt,
    assembleResearchEvidence,
    buildCanonicalQualificationJobs,
    buildDetachedQualificationJobs,
    assembleProofRun,
    verifyQualificationHarvestEvidence,
    verifyPhdCampaign,
  ];
  for (const hostileFixtureOnly of [0, 1, 'true', {}, []]) {
    assert.throws(
      () => createAcquisitionQualificationReceipt({ fixtureOnly: hostileFixtureOnly }),
      /acquisition receipt fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => freezePhdCampaign({ fixtureOnly: hostileFixtureOnly }),
      /campaign fixtureOnly must be a boolean/,
    );
    await assert.rejects(
      createProofReplayReceipt({ fixtureOnly: hostileFixtureOnly }),
      /proof replay fixtureOnly must be a boolean/,
    );
    for (const consumer of campaignConsumers) {
      assert.throws(
        () => consumer({ campaign: { fixtureOnly: hostileFixtureOnly } }),
        /campaign fixtureOnly must be a boolean/,
      );
    }
    assert.throws(
      () => atomicWritePhdCampaignReport(null, null, null, {
        fixtureOnly: hostileFixtureOnly,
      }),
      /campaign report publication fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => verifyAndAtomicWritePhdCampaignReport(null, null, null, {
        fixtureOnly: hostileFixtureOnly,
      }),
      /campaign report publication fixtureOnly must be a boolean/,
    );

    const policyValidation = validateRetentionPolicy(fixturePolicy, {
      fixtureOnly: hostileFixtureOnly,
    });
    assert.equal(policyValidation.ok, false);
    assert.match(policyValidation.errors.join('; '), /fixtureOnly must be a boolean/);
    assert.throws(
      () => buildRetentionWindowTask({
        policy: fixturePolicy,
        fixtureOnly: hostileFixtureOnly,
      }),
      /fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => releaseRetentionWindow({ fixtureOnly: hostileFixtureOnly }),
      /retention fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => gradeRetentionWindow({ fixtureOnly: hostileFixtureOnly }),
      /retention fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => evaluateRetentionStatus({ fixtureOnly: hostileFixtureOnly }),
      /retention fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => buildRetentionWorkerPrompt({ fixtureOnly: hostileFixtureOnly }),
      /retention release fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => assertRetentionResumeRuntimeIdentity({ fixtureOnly: hostileFixtureOnly }),
      /retention wait fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => materializeProofTemplate({ fixtureOnly: hostileFixtureOnly }),
      /proof task fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => createObligationProofTask({ fixtureOnly: hostileFixtureOnly }),
      /proof task fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => buildProofRuntimeAttestationPayload({ fixtureOnly: hostileFixtureOnly }),
      /proof runtime fixtureOnly must be a boolean/,
    );
    assert.throws(
      () => observeApprovedResearchDaemon(null, { fixtureOnly: hostileFixtureOnly }),
      /approved research runtime fixtureOnly must be a boolean/,
    );
  }
});

function timedWorkerCall(campaign, call) {
  const jobDigest = sha256Text(canonicalJson({
    campaignId: campaign.campaignId,
    role: call.role,
    sessionId: call.plannedSessionId || call.sessionId,
    promptSha256: call.promptSha256 || null,
  }));
  const expiresAt = campaign.expiresAt;
  const notBefore = campaign.frozenAt;
  return {
    ...call,
    jobDigest,
    notBefore,
    expiresAt,
    executionIntervalSha256: sha256Text(canonicalJson({
      jobDigest,
      notBefore,
      startedAt: call.startedAt,
      completedAt: call.completedAt,
      expiresAt,
    })),
  };
}
const fixturePolicy = {
  ...structuredClone(runtime.retentionPolicy),
  production: false,
  minimumSeparationSeconds: 10,
};
const acquisitionBinding = {
  subjectId: 'candidate-retention',
  curriculumId: runtime.graph.curriculumId,
  policyDigest: runtime.deployment.contentDigests['acquisition-policy'],
  stateRevision: 91,
  stateDigest: 'c'.repeat(64),
  completedAt: '2026-01-01T00:00:00.000Z',
};

function resignWorkerJob(job) {
  const { controlPlaneSignature: _signature, ...payload } = job;
  return {
    ...payload,
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: sha256Text(secret).slice(0, 16),
      digest: crypto.createHmac('sha256', secret)
        .update(canonicalJson(payload))
        .digest('hex'),
    },
  };
}

function resealDetachedJob(job) {
  const payload = structuredClone(job);
  delete payload.controlPlaneSignature;
  payload.descriptorSha256 = sha256Text(canonicalJson({
    jobId: payload.jobId,
    role: payload.role,
    sessionId: payload.sessionId,
    executor: payload.executor,
    dependencies: payload.dependencies,
    promptBase64: payload.promptBase64,
    outputSchema: payload.outputSchema || null,
    task: payload.task || null,
    timeoutSeconds: payload.limits.timeoutSeconds,
    maxOutputBytes: payload.limits.maxOutputBytes,
  }));
  payload.idempotencyKey = sha256Text(canonicalJson({
    campaignId: payload.campaignId,
    jobId: payload.jobId,
    descriptorSha256: payload.descriptorSha256,
  }));
  return resignWorkerJob(payload);
}

function resealDetachedPlan(plan) {
  const payload = structuredClone(plan);
  delete payload.controlPlaneSignature;
  payload.descriptorSetSha256 = sha256Text(canonicalJson(payload.jobs.map((job) => ({
    jobId: job.jobId,
    descriptorSha256: job.descriptorSha256,
    idempotencyKey: job.idempotencyKey,
  }))));
  return resignWorkerJob(payload);
}

function selectedMappings(excluded = new Set(), excludedFamilies = new Set()) {
  const selected = [];
  const selectedFamilies = new Set();
  const family = (mapping) => generateExercise({
    conceptId: mapping.conceptId,
    seed: 'retention-family-probe',
    role: 'held-out',
  }).generation.family;
  const eligible = (mapping) => mapping
    && !excluded.has(mapping.conceptId)
    && !excludedFamilies.has(family(mapping))
    && !selectedFamilies.has(family(mapping));
  const add = (mapping) => {
    if (!eligible(mapping)) return false;
    selected.push(mapping);
    selectedFamilies.add(family(mapping));
    return true;
  };
  for (const track of runtime.rubric.tracks) {
    const mapping = runtime.rubric.conceptMappings.find((row) => (
      row.tracks.includes(track.trackId) && eligible(row)
    ));
    add(mapping);
  }
  for (const stage of ['proof_foundations', 'undergraduate_core', 'graduate_core']) {
    if (!selected.some((row) => row.stage === stage)) {
      add(runtime.rubric.conceptMappings.find((row) => row.stage === stage && eligible(row)));
    }
  }
  for (const mapping of runtime.rubric.conceptMappings) {
    if (selected.length >= fixturePolicy.minimumItemsPerWindow) break;
    add(mapping);
  }
  assert.equal(selected.length >= fixturePolicy.minimumItemsPerWindow, true);
  return selected;
}

function retentionItems(seed, excluded = new Set(), excludedFamilies = new Set()) {
  const mappings = selectedMappings(excluded, excludedFamilies);
  return {
    mappings: mappings.map((mapping) => ({ stage: mapping.stage, track: mapping.tracks[0] })),
    items: mappings.map((mapping, index) => generateExercise({
      conceptId: mapping.conceptId,
      seed: `${seed}:${index}`,
      role: 'held-out',
    })),
  };
}

function answers(items) {
  return items.map((item) => ({ itemId: item.itemId, answer: item.checker.expected }));
}

function attempt(task, items, {
  sessionId,
  startedAt,
  completedAt,
  usage = { inputTokens: 100, outputTokens: 20 },
} = {}) {
  return {
    taskId: task.taskId,
    subjectId: task.subjectId,
    provider: fixturePolicy.modelRuntime.provider,
    model: fixturePolicy.modelRuntime.model,
    thinking: 'xhigh',
    sandbox: 'read-only',
    toolsAllowed: false,
    toolsUsed: [],
    usage,
    sessionId,
    startedAt,
    completedAt,
    answers: answers(items),
  };
}

test('canonical program binds commit/tree/content and exposes only explicit fixture mechanics for advanced IDs', () => {
  assert.equal(runtime.ok, true, runtime.errors.join('; '));
  assert.equal(runtime.graph.concepts.length, 264);
  assert.equal(runtime.assessmentCoverage.generatedFixtureMechanicsConceptCount, 264);
  assert.equal(runtime.assessmentCoverage.advancedConceptSpecificProductionSurfaceCount, 0);
  assert.equal(runtime.assessmentCoverage.productionAssessmentSchemaReady, true);
  assert.equal(runtime.assessmentCoverage.externallySuppliedSignedBankCount, 0);
  assert.equal(runtime.assessmentCoverage.productionAssessmentRegistryReady, false);
  assert.equal(runtime.assessmentCoverage.productionBlockers.length >= 2, true);
  assert.deepEqual(runtime.assessmentCoverage.missingConceptIds, []);
  assert.equal(runtime.deployment.sourceCommit, sourceCommit);
  assert.equal(runtime.deployment.sourceTree, sourceTree);
  assert.equal(Object.values(runtime.deployment.contentDigests).every((value) => /^[0-9a-f]{64}$/.test(value)), true);
  assert.equal(runtime.acquisitionPolicy.reviewSelection.enabled, false);
  assert.equal(runtime.retentionPolicy.minimumSeparationSeconds >= 7 * 24 * 60 * 60, true);
  for (const [index, concept] of runtime.graph.concepts.entries()) {
    const item = generateExercise({ conceptId: concept.conceptId, seed: 'canonical-coverage', role: 'acquisition' });
    assert.equal(item.conceptIds[0], concept.conceptId);
    assert.match(item.generation.oracleDigest, /^[0-9a-f]{64}$/);
    if (index >= 84) {
      assert.equal(item.generation.assessmentClass, 'synthetic_track_drill_unqualified');
      assert.match(item.truthBoundary, /ineligible for production/);
    }
  }
});

test('layered status never promotes unsigned acquisition, retention, or campaign inputs', () => {
  const status = buildLayeredPhdStatus({
    program: runtime,
    acquisitionStatus: {
      acquiredOnce: { count: 264 },
      unassessed: { count: 0 },
      learningOrCorrection: { count: 0 },
    },
    retentionStatus: {
      status: 'retained_mastery_qualified',
      retainedMasteryQualified: true,
    },
    campaignReport: {
      layers: {
        qualification: true,
        proof: true,
        specialization: true,
        research: true,
      },
      phd_math_qualified: true,
    },
    proofPreflight: { status: 'absent' },
  });
  assert.equal(status.acquisition.status, 'unverified');
  assert.equal(status.retention.status, 'unverified');
  assert.equal(status.qualification.status, 'unverified');
  assert.equal(status.phd_math_qualified, false);
  const staleSignedClaim = buildLayeredPhdStatus({
    program: runtime,
    campaignReportVerified: true,
    campaignReport: {
      layers: {
        qualification: true,
        proof: true,
        specialization: true,
        research: true,
      },
      phd_math_qualified: true,
    },
    proofPreflight: { status: 'absent' },
  });
  assert.equal(staleSignedClaim.program.status, 'structurally_valid_production_blocked');
  assert.equal(staleSignedClaim.phd_math_qualified, false);
});

test('retention signs an unseen first window, emits a durable wait, and blocks inadequate disjoint second coverage', () => {
  const firstBank = retentionItems('retention-first');
  assert.throws(() => buildRetentionWindowTask({
    taskId: 'retention.invented.labels',
    subjectId: 'candidate-retention',
    windowIndex: 1,
    deployment: runtime.deployment,
    programDigests: runtime.program.digests,
    policy: fixturePolicy,
    acquisitionBinding,
    sealedItems: firstBank.items,
    itemMappings: firstBank.items.map((item, index) => ({
      conceptId: item.conceptIds[0],
      stage: `invented-stage-${index % 3}`,
      tracks: [`invented-track-${index % 15}`],
    })),
    issuedAt: '2026-01-02T00:00:00.000Z',
    signingSecret: secret,
    fixtureOnly: true,
    ...retentionProgramInputs,
  }), /caller-supplied retention stage or track mappings are forbidden/);
  const firstTask = buildRetentionWindowTask({
    taskId: 'retention.window.1',
    subjectId: 'candidate-retention',
    windowIndex: 1,
    deployment: runtime.deployment,
    programDigests: runtime.program.digests,
    policy: fixturePolicy,
    acquisitionBinding,
    sealedItems: firstBank.items,
    issuedAt: '2026-01-02T00:00:00.000Z',
    signingSecret: secret,
    fixtureOnly: true,
    ...retentionProgramInputs,
  });
  assert.throws(() => releaseRetentionWindow({
    task: firstTask,
    sealedItems: firstBank.items,
    policy: fixturePolicy,
    deployment: runtime.deployment,
    signingSecret: secret,
    now: '2026-01-01T23:59:59.000Z',
    fixtureOnly: true,
    ...retentionProgramInputs,
  }), /not eligible/);
  const release = releaseRetentionWindow({
    task: firstTask,
    sealedItems: firstBank.items,
    policy: fixturePolicy,
    deployment: runtime.deployment,
    signingSecret: secret,
    now: '2026-01-02T00:00:00.000Z',
    fixtureOnly: true,
    ...retentionProgramInputs,
  });
  assert.equal(canonicalJson(release).includes('"checker":'), false);
  const first = gradeRetentionWindow({
    task: firstTask,
    sealedItems: firstBank.items,
    attempt: attempt(firstTask, firstBank.items, {
      sessionId: 'retention-session-one',
      startedAt: '2026-01-02T00:00:01.000Z',
      completedAt: '2026-01-02T00:00:02.000Z',
    }),
    policy: fixturePolicy,
    deployment: runtime.deployment,
    signingSecret: secret,
    now: '2026-01-02T00:00:02.000Z',
    fixtureOnly: true,
    ...retentionProgramInputs,
  });
  assert.equal(first.status, 'passed');
  const waiting = evaluateRetentionStatus({
    subjectId: 'candidate-retention',
    windows: [first],
    policy: fixturePolicy,
    deployment: runtime.deployment,
    acquisitionBinding,
    signingSecret: secret,
    now: '2026-01-02T00:00:05.000Z',
    fixtureOnly: true,
  });
  assert.equal(waiting.status, 'not_eligible_yet');
  const waitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-plan-'));
  const wait = buildRetentionWaitContract({
    status: waiting,
    statePath: path.join(waitRoot, 'retention.json'),
    notifierPath: path.join(waitRoot, 'detached_job_notifier.py'),
    resumeBundlePath: path.join(waitRoot, 'retention-resume.json'),
    releasePath: path.join(waitRoot, 'retention-release.json'),
    qualificationSecretPath: path.join(waitRoot, 'qualification.hmac'),
    createdAt: '2026-01-02T00:00:05.000Z',
    signingSecret: secret,
  });
  assert.equal(wait.chatTurnHeld, false);
  assert.equal(wait.routineReviewScheduled, false);
  fs.rmSync(waitRoot, { recursive: true, force: true });

  const secondBank = retentionItems(
    'retention-second',
    new Set(firstBank.items.map((item) => item.generation.conceptId)),
    new Set(firstBank.items.map((item) => item.generation.family)),
  );
  assert.throws(() => buildRetentionWindowTask({
    taskId: 'retention.window.2',
    subjectId: 'candidate-retention',
    windowIndex: 2,
    deployment: runtime.deployment,
    programDigests: runtime.program.digests,
    policy: fixturePolicy,
    acquisitionBinding,
    sealedItems: secondBank.items,
    issuedAt: '2026-01-02T00:00:12.000Z',
    previousWindow: first,
    signingSecret: secret,
    fixtureOnly: true,
    ...retentionProgramInputs,
  }), /track coverage/);
});

test('retention rejects deployment tamper, compressed/backdated time, semantic-family reuse, and fake usage', () => {
  assert.equal(validateRetentionPolicy(runtime.retentionPolicy, { fixtureOnly: true }).ok, false);
  const adversarialAcquisition = {
    ...acquisitionBinding,
    subjectId: 'candidate-adversarial',
  };
  const firstBank = retentionItems('adversarial-first');
  assert.throws(() => buildRetentionWindowTask({
    taskId: 'retention.production.backdated',
    subjectId: 'candidate-adversarial',
    windowIndex: 1,
    deployment: runtime.deployment,
    programDigests: runtime.program.digests,
    policy: runtime.retentionPolicy,
    acquisitionBinding: adversarialAcquisition,
    sealedItems: firstBank.items,
    issuedAt: '2026-01-03T00:00:00.000Z',
    signingSecret: secret,
    ...retentionProgramInputs,
  }), /synthetic generated exercises are fixture-only/);
  const firstTask = buildRetentionWindowTask({
    taskId: 'retention.adversarial.1',
    subjectId: 'candidate-adversarial',
    windowIndex: 1,
    deployment: runtime.deployment,
    programDigests: runtime.program.digests,
    policy: fixturePolicy,
    acquisitionBinding: adversarialAcquisition,
    sealedItems: firstBank.items,
    issuedAt: '2026-01-03T00:00:00.000Z',
    signingSecret: secret,
    fixtureOnly: true,
    ...retentionProgramInputs,
  });
  const goodAttempt = attempt(firstTask, firstBank.items, {
    sessionId: 'retention-adversarial-one',
    startedAt: '2026-01-03T00:00:01.000Z',
    completedAt: '2026-01-03T00:00:02.000Z',
  });
  const changedDeployment = structuredClone(runtime.deployment);
  changedDeployment.sourceTree = 'd'.repeat(40);
  assert.throws(() => gradeRetentionWindow({
    task: firstTask, sealedItems: firstBank.items, attempt: goodAttempt,
    policy: fixturePolicy, deployment: changedDeployment, signingSecret: secret,
    now: goodAttempt.completedAt, fixtureOnly: true,
    ...retentionProgramInputs,
  }), /substitution/);
  const backdated = { ...goodAttempt, startedAt: '2026-01-02T00:00:00.000Z', completedAt: '2026-01-02T00:00:01.000Z' };
  assert.throws(() => gradeRetentionWindow({
    task: firstTask, sealedItems: firstBank.items, attempt: backdated,
    policy: fixturePolicy, deployment: runtime.deployment, signingSecret: secret,
    now: '2026-01-03T00:00:02.000Z', fixtureOnly: true,
    ...retentionProgramInputs,
  }), /backdating|timestamp/);
  assert.throws(() => gradeRetentionWindow({
    task: firstTask,
    sealedItems: firstBank.items,
    attempt: { ...goodAttempt, usage: {} },
    policy: fixturePolicy,
    deployment: runtime.deployment,
    signingSecret: secret,
    now: goodAttempt.completedAt,
    fixtureOnly: true,
    ...retentionProgramInputs,
  }), /provider usage/);
  const first = gradeRetentionWindow({
    task: firstTask, sealedItems: firstBank.items, attempt: goodAttempt,
    policy: fixturePolicy, deployment: runtime.deployment, signingSecret: secret,
    now: goodAttempt.completedAt, fixtureOnly: true,
    ...retentionProgramInputs,
  });
  assert.throws(() => buildRetentionWindowTask({
    taskId: 'retention.adversarial.reuse',
    subjectId: 'candidate-adversarial',
    windowIndex: 2,
    deployment: runtime.deployment,
    programDigests: runtime.program.digests,
    policy: fixturePolicy,
    acquisitionBinding: adversarialAcquisition,
    sealedItems: firstBank.items,
    issuedAt: '2026-01-03T00:00:12.000Z',
    previousWindow: first,
    signingSecret: secret,
    fixtureOnly: true,
    ...retentionProgramInputs,
  }), /overlap/);
  const secondBank = retentionItems(
    'adversarial-second',
    new Set(firstBank.items.map((item) => item.generation.conceptId)),
  );
  assert.throws(() => buildRetentionWindowTask({
    taskId: 'retention.adversarial.2',
    subjectId: 'candidate-adversarial',
    windowIndex: 2,
    deployment: runtime.deployment,
    programDigests: runtime.program.digests,
    policy: fixturePolicy,
    acquisitionBinding: adversarialAcquisition,
    sealedItems: secondBank.items,
    issuedAt: '2026-01-03T00:00:12.000Z',
    previousWindow: first,
    signingSecret: secret,
    fixtureOnly: true,
    ...retentionProgramInputs,
  }), /semantic theorem family/);
});

function campaignFixture({ retentionSessions = [] } = {}) {
  const banks = buildSealedQualificationBanks({
    blueprint: runtime.blueprint,
    graph: runtime.graph,
    rubric: runtime.rubric,
    seed: 'sealed-campaign-fixture',
  });
  const examCount = runtime.blueprint.coreExams.length + 1;
  const roles = {
    candidateSessions: Array.from({ length: examCount }, (_, index) => `exam-candidate-${index}`),
    proctorIds: Array.from({ length: examCount }, (_, index) => `exam-proctor-${index}`),
    graderIds: Array.from({ length: examCount }, (_, index) => `exam-grader-${index}`),
    proofCandidateSessions: runtime.proofRegistry.entries.map((_, index) => `proof-candidate-${index}`),
    proofReplaySessions: runtime.proofRegistry.entries.map((_, index) => `proof-replay-${index}`),
    researchCandidateSession: 'research-candidate',
    researchReviewerSession: 'research-reviewer',
    researchReproducerSession: 'research-reproducer',
    retentionSessions,
  };
  const researchProgram = {
    corpus: {
      entries: [
        { id: 'finite-sums-1', claim: 'The first n natural numbers sum to n(n+1)/2.' },
      ],
    },
    environment: {
      runtime: 'lean-4.32.1',
      method: 'exact finite evaluation',
      executionKind: 'host_fixture',
      immutable: true,
      networkDisabled: true,
      lockDigest: '4'.repeat(64),
    },
    assumptions: {
      domain: 'natural numbers',
      bound: 3,
    },
    boundedClaim: 'The finite summation artifact reproduces its declared equality under explicit assumptions.',
    noveltyCeiling: 'bounded_corpus_only',
  };
  const reproductionSource = Buffer.from([
    "import fs from 'node:fs';",
    "fs.writeFileSync('result.json', JSON.stringify({reproducedSequence:[0,1,3,6],matches:true}));",
    '',
  ].join('\n'));
  researchProgram.sourceBundle = {
    schemaVersion: 'cortex.learning_os.research_source_bundle.v1',
    files: [{
      path: 'run.mjs',
      bytesBase64: reproductionSource.toString('base64'),
      sha256: sha256Text(reproductionSource),
      executable: false,
    }],
  };
  researchProgram.sourceBundleSha256 = researchSourceBundleDigest(researchProgram.sourceBundle);
  researchProgram.reproduction = {
    command: [process.execPath, 'run.mjs'],
    outputPaths: ['result.json'],
    resultPath: 'result.json',
    timeoutSeconds: 60,
  };
  researchProgram.corpusDigest = sha256Text(canonicalJson(researchProgram.corpus));
  researchProgram.environmentDigest = sha256Text(canonicalJson(researchProgram.environment));
  researchProgram.assumptionsDigest = sha256Text(canonicalJson(researchProgram.assumptions));
  const campaign = freezePhdCampaign({
    campaignId: 'campaign-fixture',
    subjectId: 'candidate-campaign',
    deployment: runtime.deployment,
    program: runtime.program,
    blueprint: runtime.blueprint,
    graph: runtime.graph,
    rubric: runtime.rubric,
    proofRegistry: runtime.proofRegistry,
    sealedBanks: banks,
    roles,
    researchProgram,
    modelRuntime: runtime.retentionPolicy.modelRuntime,
    trustPolicy: runtime.trustPolicy,
    frozenAt: '2026-02-01T00:00:00.000Z',
    expiresAt: '2026-03-01T00:00:00.000Z',
    signingSecret: secret,
    fixtureOnly: true,
  });
  const releasedAtByExam = Object.fromEntries(campaign.exams.map((exam, index) => [
    exam.examId,
    `2026-02-0${index + 2}T00:00:01.000Z`,
  ]));
  const examDescriptors = buildExamJobDescriptors({
    campaign,
    sealedBanks: banks,
    releasedAtByExam,
  });
  const attempts = campaign.exams.map((exam, index) => {
    const bank = banks[exam.examId];
    return {
      examId: exam.examId,
      subjectId: campaign.subjectId,
      promptCommitmentDigest: exam.promptCommitmentDigest,
      promptReleasedAt: releasedAtByExam[exam.examId],
      exactPromptBytes: true,
      promptSha256: sha256Text(examDescriptors[index].prompt),
      startedAt: `2026-02-0${index + 2}T00:00:02.000Z`,
      completedAt: `2026-02-0${index + 2}T01:00:00.000Z`,
      candidateSessionId: exam.candidateSessionId,
      proctorId: exam.proctorId,
      graderId: exam.graderId,
      provider: 'openai-codex',
      model: campaign.modelRuntime.model,
      thinking: 'xhigh',
      toolsAllowed: false,
      toolsUsed: [],
      usage: { inputTokens: 1000, outputTokens: 500 },
      keyMaterialObserved: false,
      candidateKeyDigestObserved: null,
      promptText: 'candidate-visible sealed examination prompts',
      answers: answers(bank.items),
      claimedScore: 1,
      claimedPassed: true,
    };
  });
  const artifact = { theorem: 'finite summation equality', computation: [0, 1, 3, 6] };
  const artifactDigest = sha256Text(canonicalJson(artifact));
  const result = { reproducedSequence: [0, 1, 3, 6], matches: true };
  const resultDigest = sha256Text(canonicalJson(result));
  const reviewArtifact = {
    status: 'passed',
    adversarial: true,
    findings: ['The bounded computation matches every declared finite case.'],
  };
  const reviewDigest = sha256Text(canonicalJson(reviewArtifact));
  const candidateDescriptor = buildResearchJobDescriptor({
    campaign,
    role: 'research_candidate',
  });
  const reviewDescriptor = buildResearchJobDescriptor({
    campaign,
    role: 'adversarial_review',
    artifact,
    artifactDigest,
  });
  const reproductionDescriptor = buildResearchJobDescriptor({
    campaign,
    role: 'reproduction',
    artifact,
    artifactDigest,
  });
  const execution = (sessionId, prompt, bindings) => ({
    provider: 'openai-codex',
    model: campaign.modelRuntime.model,
    thinking: 'xhigh',
    sandbox: 'read-only',
    toolsAllowed: false,
    toolsUsed: [],
    usage: { inputTokens: 200, outputTokens: 100 },
    sessionId,
    exactPromptBytes: true,
    promptSha256: sha256Text(prompt),
    startedAt: '2026-02-08T00:00:00.000Z',
    completedAt: '2026-02-08T00:01:00.000Z',
    ...bindings,
  });
  const research = {
    candidateSessionId: roles.researchCandidateSession,
    artifact,
    artifactDigest,
    result,
    corpusDigest: researchProgram.corpusDigest,
    environmentDigest: researchProgram.environmentDigest,
    assumptionsDigest: researchProgram.assumptionsDigest,
    resultDigest,
    mainTheoremTemplateSha256: '5'.repeat(64),
    candidateExecution: execution(
      roles.researchCandidateSession,
      candidateDescriptor.prompt,
      { artifactDigest },
    ),
    review: {
      sessionId: roles.researchReviewerSession,
      artifactDigest,
      status: 'passed',
      adversarial: true,
      artifact: reviewArtifact,
      reviewDigest,
      execution: execution(
        roles.researchReviewerSession,
        reviewDescriptor.prompt,
        { artifactDigest, reviewDigest },
      ),
    },
    reproduction: {
      sessionId: roles.researchReproducerSession,
      artifactDigest,
      environmentDigest: researchProgram.environmentDigest,
      result,
      resultDigest,
      status: 'passed',
      execution: execution(
        roles.researchReproducerSession,
        reproductionDescriptor.prompt,
        { artifactDigest, resultDigest },
      ),
    },
    novelty: {
      status: 'bounded_corpus_only',
      scope: 'No match was found only in the declared frozen corpus.',
      globalNoveltyClaim: false,
    },
  };
  return { banks, roles, researchProgram, campaign, attempts, research };
}

test('sealed paths recompute thresholds and valid cross-deployment reports remain unverified', () => {
  const fixture = campaignFixture();
  const acquiredAt = new Date().toISOString();
  const unsignedMastery = createMasteryState({
    graph: runtime.graph,
    policy: runtime.acquisitionPolicy,
    now: acquiredAt,
  });
  for (const [conceptId, record] of Object.entries(unsignedMastery.concepts)) {
    Object.assign(record, {
      state: 'acquired',
      attempts: 1,
      passes: 1,
      consecutivePasses: 1,
      lastAttemptedAt: acquiredAt,
      acquiredAt,
      lastEvidenceDigest: sha256Text(`acquisition:${conceptId}`),
      lastRunId: `acquisition.${conceptId}`,
    });
  }
  const masterySecret = 'phd-acquisition-mastery-test-secret-0000000000000000';
  const signedMastery = signMasteryState(unsignedMastery, masterySecret);
  const acquisitionReceipt = createAcquisitionQualificationReceipt({
    subjectId: fixture.campaign.subjectId,
    deployment: runtime.deployment,
    state: signedMastery,
    graph: runtime.graph,
    policy: runtime.acquisitionPolicy,
    masterySecret,
    signingSecret: secret,
    fixtureOnly: true,
    verifiedAt: acquiredAt,
  });
  const release = buildCandidateExamRelease({
    campaign: fixture.campaign,
    examId: fixture.campaign.exams[0].examId,
    sealedBank: fixture.banks[fixture.campaign.exams[0].examId],
    releasedAt: '2026-02-02T00:00:01.000Z',
  });
  assert.equal(release.candidateKeyMaterialIncluded, false);
  assert.equal(canonicalJson(release).includes('"checker":'), false);
  assert.equal(canonicalJson(release).includes('keyDigest'), false);
  const report = verifyPhdCampaign({
    campaign: fixture.campaign,
    expectedDeployment: runtime.deployment,
    sealedBanks: fixture.banks,
    examAttempts: fixture.attempts,
    proofRuns: [],
    research: fixture.research,
    retentionStatus: { status: 'retained_mastery_qualified', retainedMasteryQualified: true },
    acquisitionReceipt,
    signingSecret: secret,
    evaluatedAt: '2026-02-10T00:00:00.000Z',
  });
  assert.equal(report.examResults.length, 5);
  assert.equal(report.examResults.every((exam) => exam.passed), true);
  assert.equal(report.layers.acquisition, true);
  assert.equal(report.phd_math_qualified, false);
  assert.ok(report.blockers.includes('claim:fixture campaigns never qualify live claims'));
  const campaignBundle = {
    campaign: fixture.campaign,
    expectedDeployment: runtime.deployment,
    sealedBanks: fixture.banks,
    examAttempts: fixture.attempts,
    proofRuns: [],
    research: fixture.research,
    retentionStatus: { status: 'retained_mastery_qualified', retainedMasteryQualified: true },
    acquisitionReceipt,
  };
  assert.equal(canonicalJson(verifyPhdCampaign({
    ...campaignBundle,
    signingSecret: secret,
    evaluatedAt: report.evaluatedAt,
  })), canonicalJson(report));
  const publicationRoot = fs.mkdtempSync(path.join(
    // Authenticated publication rejects a validator-controlled TMPDIR below
    // any writable non-sticky ancestor. Keep this product-path regression on
    // the independently trusted sticky Linux temporary root.
    '/tmp',
    'clos-verified-campaign-publication-',
  ));
  try {
    const reportPath = path.join(publicationRoot, 'campaign-report.json');
    assert.throws(() => verifyAndAtomicWritePhdCampaignReport(
      reportPath,
      {
        campaign: {
          fixtureOnly: false,
        },
      },
      secret,
      { fixtureOnly: true },
    ), /publication mode must match the completely verified campaign/);
    assert.equal(fs.existsSync(reportPath), false);
    const published = verifyAndAtomicWritePhdCampaignReport(
      reportPath,
      {
        ...campaignBundle,
        evaluatedAt: report.evaluatedAt,
      },
      secret,
      { fixtureOnly: true },
    );
    assert.equal(canonicalJson(published), canonicalJson(report));
    assert.equal(
      canonicalJson(JSON.parse(fs.readFileSync(reportPath, 'utf8'))),
      canonicalJson(report),
    );
    assert.equal(
      canonicalJson(verifyAndAtomicWritePhdCampaignReport(
        reportPath,
        {
          ...campaignBundle,
          evaluatedAt: report.evaluatedAt,
        },
        secret,
        { fixtureOnly: true },
      )),
      canonicalJson(report),
    );
    assert.throws(
      () => verifyAndAtomicWritePhdCampaignReport(
        path.join(publicationRoot, 'secret-bearing-bundle-report.json'),
        {
          ...campaignBundle,
          evaluatedAt: report.evaluatedAt,
          signingSecret: 'must-not-be-serialized',
        },
        secret,
        { fixtureOnly: true },
      ),
      /without secret material/,
    );
    assert.throws(
      () => verifyAndAtomicWritePhdCampaignReport(
        path.join(publicationRoot, 'self-digested-bundle-report.json'),
        {
          ...campaignBundle,
          evaluatedAt: report.evaluatedAt,
          verificationBundleSha256: 'f'.repeat(64),
        },
        secret,
        {
          bundlePath: path.join(
            publicationRoot,
            'self-digested-campaign-bundle.json',
          ),
          fixtureOnly: true,
        },
      ),
      /self-declared bundle digest/,
    );
    const pairedReportPath = path.join(
      publicationRoot,
      'paired-campaign-report.json',
    );
    const pairedBundlePath = path.join(
      publicationRoot,
      'paired-campaign-bundle.json',
    );
    const pairedInputs = {
      ...campaignBundle,
      evaluatedAt: report.evaluatedAt,
    };
    const pairedBundleSha256 = phdCampaignVerificationBundleSha256(
      pairedInputs,
    );
    const pairedReport = verifyPhdCampaign({
      ...pairedInputs,
      signingSecret: secret,
      verificationBundleSha256: pairedBundleSha256,
    });
    const paired = verifyAndAtomicWritePhdCampaignReport(
      pairedReportPath,
      pairedInputs,
      secret,
      {
        bundlePath: pairedBundlePath,
        fixtureOnly: true,
      },
    );
    assert.equal(canonicalJson(paired), canonicalJson(pairedReport));
    assert.equal(paired.verificationBundleSha256, pairedBundleSha256);
    assert.equal(
      canonicalJson(JSON.parse(fs.readFileSync(pairedBundlePath, 'utf8'))),
      canonicalJson(pairedInputs),
    );
    assert.equal(
      canonicalJson(JSON.parse(fs.readFileSync(pairedReportPath, 'utf8'))),
      canonicalJson(pairedReport),
    );
    const summaryEquivalentInputs = {
      ...pairedInputs,
      ignoredBySummaryProjection: {
        purpose: 'prove that complete bundle bytes, not only report fields, are bound',
      },
    };
    const unboundSummaryEquivalent = verifyPhdCampaign({
      ...summaryEquivalentInputs,
      signingSecret: secret,
    });
    assert.equal(
      canonicalJson(unboundSummaryEquivalent),
      canonicalJson(report),
    );
    const summaryEquivalentBundleSha256 =
      phdCampaignVerificationBundleSha256(summaryEquivalentInputs);
    const boundSummaryEquivalent = verifyPhdCampaign({
      ...summaryEquivalentInputs,
      signingSecret: secret,
      verificationBundleSha256: summaryEquivalentBundleSha256,
    });
    assert.notEqual(summaryEquivalentBundleSha256, pairedBundleSha256);
    assert.notEqual(
      canonicalJson(boundSummaryEquivalent),
      canonicalJson(pairedReport),
    );
    assert.equal(
      boundSummaryEquivalent.verificationBundleSha256,
      summaryEquivalentBundleSha256,
    );
    const alternatePairedInputs = {
      ...pairedInputs,
      evaluatedAt: '2026-02-10T00:00:01.000Z',
    };
    const alternatePairedReport = verifyPhdCampaign({
      ...alternatePairedInputs,
      signingSecret: secret,
      verificationBundleSha256:
        phdCampaignVerificationBundleSha256(alternatePairedInputs),
    });
    for (const attackPhase of [
      'pair_before_published_consumption',
      'pair_after_bundle_consumption_before_report_consumption',
      'pair_after_report_consumption_before_bundle_confirmation',
    ]) {
      const attackReportPath = path.join(
        publicationRoot,
        `${attackPhase}-report.json`,
      );
      const attackBundlePath = path.join(
        publicationRoot,
        `${attackPhase}-bundle.json`,
      );
      let attacked = false;
      assert.throws(() => verifyAndAtomicWritePhdCampaignReport(
        attackReportPath,
        pairedInputs,
        secret,
        {
          bundlePath: attackBundlePath,
          fixtureOnly: true,
          crashInjector(phase) {
            if (attacked || phase !== attackPhase) return;
            attacked = true;
            if (phase
                === 'pair_after_bundle_consumption_before_report_consumption') {
              fs.writeFileSync(
                attackReportPath,
                `${JSON.stringify(alternatePairedReport, null, 2)}\n`,
              );
            } else {
              fs.writeFileSync(
                attackBundlePath,
                `${JSON.stringify(alternatePairedInputs, null, 2)}\n`,
              );
            }
          },
        },
      ), /published campaign|changed across its protected consumer handoff/,
      attackPhase);
      assert.equal(attacked, true, attackPhase);
    }
    const consumedCrashReportPath = path.join(
      publicationRoot,
      'paired-consumption-crash-report.json',
    );
    const consumedCrashBundlePath = path.join(
      publicationRoot,
      'paired-consumption-crash-bundle.json',
    );
    assert.throws(() => verifyAndAtomicWritePhdCampaignReport(
      consumedCrashReportPath,
      pairedInputs,
      secret,
      {
        bundlePath: consumedCrashBundlePath,
        fixtureOnly: true,
        crashInjector(phase) {
          if (phase === 'pair_before_published_consumption') {
            throw new Error('crash:before-published-pair-consumption');
          }
        },
      },
    ), /crash:before-published-pair-consumption/);
    const consumedCrashRecovered = verifyAndAtomicWritePhdCampaignReport(
      consumedCrashReportPath,
      pairedInputs,
      secret,
      {
        bundlePath: consumedCrashBundlePath,
        fixtureOnly: true,
      },
    );
    assert.equal(
      canonicalJson(consumedCrashRecovered),
      canonicalJson(pairedReport),
    );
    assert.throws(
      () => verifyAndAtomicWritePhdCampaignReport(
        pairedReportPath,
        pairedInputs,
        secret,
        {
          bundlePath: pairedReportPath,
          fixtureOnly: true,
        },
      ),
      /bundle and report publication targets must be distinct/,
    );
    const pairedCrashReportPath = path.join(
      publicationRoot,
      'paired-campaign-report-crash-recovery.json',
    );
    const pairedCrashBundlePath = path.join(
      publicationRoot,
      'paired-campaign-bundle-crash-recovery.json',
    );
    assert.throws(
      () => verifyAndAtomicWritePhdCampaignReport(
        pairedCrashReportPath,
        pairedInputs,
        secret,
        {
          bundlePath: pairedCrashBundlePath,
          fixtureOnly: true,
          crashInjector(phase) {
            if (phase === 'report_after_stage_file_fsync') {
              throw new Error('crash:verified-campaign-after-bundle-before-report-return');
            }
          },
        },
      ),
      /crash:verified-campaign-after-bundle-before-report-return/,
    );
    assert.equal(
      canonicalJson(JSON.parse(fs.readFileSync(pairedCrashBundlePath, 'utf8'))),
      canonicalJson(pairedInputs),
    );
    assert.equal(fs.existsSync(pairedCrashReportPath), false);
    const pairedRecovered = verifyAndAtomicWritePhdCampaignReport(
      pairedCrashReportPath,
      pairedInputs,
      secret,
      {
        bundlePath: pairedCrashBundlePath,
        fixtureOnly: true,
      },
    );
    assert.equal(canonicalJson(pairedRecovered), canonicalJson(pairedReport));
    const crashReportPath = path.join(
      publicationRoot,
      'campaign-report-crash-recovery.json',
    );
    assert.throws(() => verifyAndAtomicWritePhdCampaignReport(
      crashReportPath,
      {
        ...campaignBundle,
        evaluatedAt: report.evaluatedAt,
      },
      secret,
      {
        fixtureOnly: true,
        crashInjector(phase) {
          if (phase === 'after_target_file_fsync') {
            throw new Error('crash:verified-campaign-after-target-file-fsync');
          }
        },
      },
    ), /crash:verified-campaign-after-target-file-fsync/);
    const recovered = verifyAndAtomicWritePhdCampaignReport(
      crashReportPath,
      {
        ...campaignBundle,
        evaluatedAt: report.evaluatedAt,
      },
      secret,
      { fixtureOnly: true },
    );
    assert.equal(canonicalJson(recovered), canonicalJson(report));
    assert.equal(
      canonicalJson(JSON.parse(fs.readFileSync(crashReportPath, 'utf8'))),
      canonicalJson(report),
    );
    assert.equal(fs.statSync(crashReportPath).nlink, 1);
    assert.equal(
      fs.readdirSync(publicationRoot).some((name) => name.includes('.publish-')),
      false,
    );
  } finally {
    fs.rmSync(publicationRoot, { recursive: true, force: true });
  }
  const otherQualificationDeployment = cycle10QualificationDeployment(runtime.deployment);
  const crossDeploymentStatus = buildLayeredPhdStatus({
    program: {
      ...runtime,
      deployment: sourceDeploymentBinding(otherQualificationDeployment),
      ok: true,
      productionTrustReady: true,
      sourceMode: 'exact_git_blobs',
    },
    campaignReport: report,
    campaignBundle,
    qualificationSigningSecret: secret,
    proofPreflight: { status: 'absent' },
  });
  assert.equal(crossDeploymentStatus.qualification.status, 'unverified');
  assert.equal(crossDeploymentStatus.phd_math_qualified, false);
  const explicitCrossDeploymentStatus = buildLayeredPhdStatus({
    program: {
      ...runtime,
      deployment: sourceDeploymentBinding(otherQualificationDeployment),
      ok: true,
      productionTrustReady: true,
      sourceMode: 'exact_git_blobs',
    },
    campaignReport: report,
    campaignBundle,
    qualificationDeployment: otherQualificationDeployment,
    qualificationSigningSecret: secret,
    proofPreflight: { status: 'absent' },
  });
  assert.equal(explicitCrossDeploymentStatus.qualification.status, 'unverified');
  assert.equal(explicitCrossDeploymentStatus.phd_math_qualified, false);

  const thresholdFraud = structuredClone(fixture.attempts);
  thresholdFraud[0].answers[0].answer = 'definitely-wrong';
  assert.equal(verifyPhdCampaign({
    campaign: fixture.campaign,
    expectedDeployment: runtime.deployment,
    sealedBanks: fixture.banks,
    examAttempts: thresholdFraud,
    proofRuns: [],
    research: fixture.research,
    retentionStatus: null,
    acquisitionStatus: null,
    signingSecret: secret,
    evaluatedAt: '2026-02-10T00:00:00.000Z',
  }).blockers.some((blocker) => /threshold recomputation/.test(blocker)), true);

  const leakage = structuredClone(fixture.attempts);
  leakage[0].candidateKeyDigestObserved = fixture.campaign.exams[0].keyDigest;
  assert.equal(verifyPhdCampaign({
    campaign: fixture.campaign,
    expectedDeployment: runtime.deployment,
    sealedBanks: fixture.banks,
    examAttempts: leakage,
    proofRuns: [],
    research: fixture.research,
    retentionStatus: null,
    acquisitionStatus: null,
    signingSecret: secret,
    evaluatedAt: '2026-02-10T00:00:00.000Z',
  }).blockers.some((blocker) => /key leakage/.test(blocker)), true);

  const promptSubstitution = structuredClone(fixture.attempts);
  promptSubstitution[0].promptSha256 = 'f'.repeat(64);
  assert.equal(verifyPhdCampaign({
    campaign: fixture.campaign,
    expectedDeployment: runtime.deployment,
    sealedBanks: fixture.banks,
    examAttempts: promptSubstitution,
    proofRuns: [],
    research: fixture.research,
    retentionStatus: null,
    acquisitionReceipt: null,
    signingSecret: secret,
    evaluatedAt: '2026-02-10T00:00:00.000Z',
  }).blockers.some((blocker) => /exact prompt bytes/.test(blocker)), true);
});

test('campaign fails closed on role collision, reproduction drift, novelty overclaim, and theorem-artifact mismatch', () => {
  const fixture = campaignFixture();
  const collided = structuredClone(fixture.roles);
  collided.researchReviewerSession = collided.researchCandidateSession;
  assert.throws(() => freezePhdCampaign({
    campaignId: 'campaign-collision',
    subjectId: 'candidate-campaign',
    deployment: runtime.deployment,
    program: runtime.program,
    blueprint: runtime.blueprint,
    graph: runtime.graph,
    rubric: runtime.rubric,
    proofRegistry: runtime.proofRegistry,
    sealedBanks: fixture.banks,
    roles: collided,
    researchProgram: fixture.researchProgram,
    modelRuntime: runtime.retentionPolicy.modelRuntime,
    trustPolicy: runtime.trustPolicy,
    frozenAt: '2026-02-01T00:00:00.000Z',
    expiresAt: '2026-03-01T00:00:00.000Z',
    signingSecret: secret,
    fixtureOnly: true,
  }), /role collision/);
  for (const mutate of [
    (research) => { research.reproduction.environmentDigest = 'f'.repeat(64); },
    (research) => { research.corpusDigest = 'f'.repeat(64); },
    (research) => { research.review.execution.usage = {}; },
    (research) => { research.novelty.globalNoveltyClaim = true; },
    (research) => { research.mainTheoremTemplateSha256 = 'f'.repeat(64); },
  ]) {
    const research = structuredClone(fixture.research);
    mutate(research);
    const report = verifyPhdCampaign({
      campaign: fixture.campaign,
      expectedDeployment: runtime.deployment,
      sealedBanks: fixture.banks,
      examAttempts: fixture.attempts,
      proofRuns: [],
      research,
      retentionStatus: null,
      acquisitionStatus: null,
      signingSecret: secret,
      evaluatedAt: '2026-02-10T00:00:00.000Z',
    });
    assert.equal(report.layers.research, false);
    assert.equal(report.blockers.some((blocker) => (
      /reproduction mismatch|corpus, environment|execution identity|novelty overclaim|artifact-main-theorem/.test(blocker)
    )), true);
  }
});

test('detached job plans freeze exact prompt bytes and declare idempotent crash recovery with no partial apply', () => {
  const fixture = campaignFixture();
  const plan = buildDetachedQualificationJobs({
    campaign: fixture.campaign,
    descriptors: [{
      jobId: 'campaign-fixture.exam-0',
      role: 'exam',
      sessionId: fixture.roles.candidateSessions[0],
      prompt: '{"sealed":"candidate prompt only"}',
      outputSchema: 'model-answer-output.schema.json',
    }],
    signingSecret: secret,
  });
  assert.equal(plan.jobs[0].promptSha256, sha256Text(Buffer.from('{"sealed":"candidate prompt only"}')));
  assert.equal(plan.jobs[0].canonicalStateAuthority, false);
  assert.match(plan.jobs[0].controlPlaneSignature.digest, /^[0-9a-f]{64}$/);
  assert.equal(plan.resumePolicy.idempotentByJobIdAndPromptDigest, true);
  assert.equal(plan.resumePolicy.partialApplyAllowed, false);
  assert.match(plan.resumePolicy.crashRecovery, /rerun_missing_jobs_only/);
  const planValidation = verifyDetachedQualificationJobPlan(plan, secret, {
    expectedCampaignId: fixture.campaign.campaignId,
    expectedDeployment: fixture.campaign.deployment,
    now: '2026-02-10T00:00:00.000Z',
  });
  assert.equal(planValidation.ok, true, planValidation.errors.join('; '));
  assert.throws(() => buildDetachedQualificationJobs({
    campaign: fixture.campaign,
    descriptors: [
      {
        jobId: 'duplicate-job',
        role: 'exam',
        sessionId: fixture.roles.candidateSessions[0],
        prompt: 'first',
        outputSchema: 'model-answer-output.schema.json',
      },
      {
        jobId: 'duplicate-job',
        role: 'exam',
        sessionId: fixture.roles.candidateSessions[0],
        prompt: 'second',
        outputSchema: 'model-answer-output.schema.json',
      },
    ],
    signingSecret: secret,
  }), /reuse/);
  assert.throws(() => buildDetachedQualificationJobs({
    campaign: fixture.campaign,
    descriptors: [{
      jobId: 'proof-session-role-fraud',
      role: 'proof_candidate',
      sessionId: fixture.roles.candidateSessions[0],
      prompt: 'attempt to reuse an exam session for a proof',
      outputSchema: 'proof-candidate-output.schema.json',
    }],
    signingSecret: secret,
  }), /invalid detached qualification job descriptor/);

  const firstExam = fixture.campaign.exams[0];
  const firstAttempt = fixture.attempts[0];
  const examCall = timedWorkerCall(fixture.campaign, {
    schemaVersion: 'cortex.learning_os.phd_worker_call.v2',
    role: 'exam',
    sessionId: firstExam.candidateSessionId,
    provider: 'openai-codex',
    model: fixture.campaign.modelRuntime.model,
    thinking: 'xhigh',
    sandbox: 'read-only',
    toolsAllowed: false,
    toolsUsed: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    exactPromptBytes: true,
    promptSha256: firstAttempt.promptSha256,
    outputSha256: sha256Text(Buffer.from(JSON.stringify({ answers: firstAttempt.answers }))),
    startedAt: firstAttempt.startedAt,
    completedAt: firstAttempt.completedAt,
  });
  assert.throws(() => assembleExamAttempt({
    campaign: fixture.campaign,
    examId: firstExam.examId,
    sealedBank: fixture.banks[firstExam.examId],
    releasedAt: firstAttempt.promptReleasedAt,
    modelCall: { ...examCall, outputSha256: 'e'.repeat(64) },
    outputBytes: Buffer.from(JSON.stringify({ answers: firstAttempt.answers })),
  }), /invalid exam worker evidence/);
  const assembledExam = assembleExamAttempt({
    campaign: fixture.campaign,
    examId: firstExam.examId,
    sealedBank: fixture.banks[firstExam.examId],
    releasedAt: firstAttempt.promptReleasedAt,
    modelCall: examCall,
    outputBytes: Buffer.from(JSON.stringify({ answers: firstAttempt.answers })),
  });
  assert.equal(assembledExam.claimedPassed, true);
  assert.equal(assembledExam.claimedScore, 1);

  const researchDescriptors = Object.fromEntries([
    buildResearchJobDescriptor({ campaign: fixture.campaign, role: 'research_candidate' }),
    buildResearchJobDescriptor({
      campaign: fixture.campaign,
      role: 'adversarial_review',
      artifact: fixture.research.artifact,
      artifactDigest: fixture.research.artifactDigest,
    }),
    buildResearchJobDescriptor({
      campaign: fixture.campaign,
      role: 'reproduction',
      artifact: fixture.research.artifact,
      artifactDigest: fixture.research.artifactDigest,
    }),
  ].map((descriptor) => [descriptor.role, descriptor]));
  const researchCall = (role, outputBytes) => timedWorkerCall(fixture.campaign, {
    schemaVersion: 'cortex.learning_os.phd_worker_call.v2',
    role,
    sessionId: researchDescriptors[role].sessionId,
    provider: 'openai-codex',
    model: fixture.campaign.modelRuntime.model,
    thinking: 'xhigh',
    sandbox: 'read-only',
    toolsAllowed: false,
    toolsUsed: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    exactPromptBytes: true,
    promptSha256: sha256Text(researchDescriptors[role].prompt),
    outputSha256: sha256Text(outputBytes),
    startedAt: '2026-02-08T00:00:00.000Z',
    completedAt: '2026-02-08T00:01:00.000Z',
  });
  const candidateOutput = {
    artifact: fixture.research.artifact,
    result: fixture.research.result,
    novelty: fixture.research.novelty,
  };
  const reviewOutput = fixture.research.review.artifact;
  const reproductionOutput = {
    status: 'passed',
    result: fixture.research.reproduction.result,
    notes: 'Independent frozen-environment reproduction matched.',
    fixtureOnly: true,
  };
  const candidateOutputBytes = Buffer.from(JSON.stringify(candidateOutput));
  const reviewOutputBytes = Buffer.from(JSON.stringify(reviewOutput));
  const reproductionOutputBytes = Buffer.from(JSON.stringify(reproductionOutput));
  assert.throws(() => assembleResearchEvidence({
    campaign: fixture.campaign,
    candidateOutput,
    candidateOutputBytes,
    candidateCall: { ...researchCall('research_candidate', candidateOutputBytes), outputSha256: 'd'.repeat(64) },
    reviewOutput,
    reviewOutputBytes,
    reviewCall: researchCall('adversarial_review', reviewOutputBytes),
    reproductionOutput,
    reproductionOutputBytes,
    reproductionCall: researchCall('reproduction', reproductionOutputBytes),
    mainTheoremTemplateSha256: fixture.research.mainTheoremTemplateSha256,
  }), /not bound/);
  const assembledResearch = assembleResearchEvidence({
    campaign: fixture.campaign,
    candidateOutput,
    candidateOutputBytes,
    candidateCall: researchCall('research_candidate', candidateOutputBytes),
    reviewOutput,
    reviewOutputBytes,
    reviewCall: researchCall('adversarial_review', reviewOutputBytes),
    reproductionOutput,
    reproductionOutputBytes,
    reproductionCall: researchCall('reproduction', reproductionOutputBytes),
    mainTheoremTemplateSha256: fixture.research.mainTheoremTemplateSha256,
  });
  assert.equal(assembledResearch.artifactDigest, fixture.research.artifactDigest);
  assert.equal(assembledResearch.reproduction.resultDigest, fixture.research.resultDigest);
});

test('canonical jobs build through detached artifacts and harvest into unsigned independent authority requests', () => {
  const fixture = campaignFixture({ retentionSessions: ['retention-candidate-window-1'] });
  const retentionBank = retentionItems('canonical-jobs-retention');
  const retentionAcquisitionBinding = {
    ...acquisitionBinding,
    subjectId: fixture.campaign.subjectId,
  };
  const retentionTask = buildRetentionWindowTask({
    taskId: 'retention.canonical-jobs.window-1',
    subjectId: fixture.campaign.subjectId,
    windowIndex: 1,
    deployment: runtime.deployment,
    programDigests: runtime.program.digests,
    policy: fixturePolicy,
    acquisitionBinding: retentionAcquisitionBinding,
    sealedItems: retentionBank.items,
    graph: runtime.graph,
    rubric: runtime.rubric,
    trustPolicy: runtime.trustPolicy,
    issuedAt: '2026-01-02T00:00:00.000Z',
    signingSecret: secret,
    fixtureOnly: true,
  });
  const retentionRelease = releaseRetentionWindow({
    task: retentionTask,
    sealedItems: retentionBank.items,
    graph: runtime.graph,
    rubric: runtime.rubric,
    policy: fixturePolicy,
    deployment: runtime.deployment,
    trustPolicy: runtime.trustPolicy,
    signingSecret: secret,
    now: '2026-01-02T00:00:01.000Z',
    fixtureOnly: true,
  });
  const plan = buildCanonicalQualificationJobs({
    campaign: fixture.campaign,
    sealedBanks: fixture.banks,
    releasedAtByExam: Object.fromEntries(fixture.attempts.map((attempt) => [
      attempt.examId,
      attempt.promptReleasedAt,
    ])),
    retentionAssignments: [{ task: retentionTask, release: retentionRelease }],
    fixtureResearchArtifactDigest: fixture.research.artifactDigest,
    signingSecret: secret,
  });
  const rebuiltPlan = buildCanonicalQualificationJobs({
    campaign: fixture.campaign,
    sealedBanks: fixture.banks,
    releasedAtByExam: Object.fromEntries(fixture.attempts.map((attempt) => [
      attempt.examId,
      attempt.promptReleasedAt,
    ])),
    retentionAssignments: [{ task: retentionTask, release: retentionRelease }],
    fixtureResearchArtifactDigest: fixture.research.artifactDigest,
    signingSecret: secret,
  });
  assert.equal(canonicalJson(rebuiltPlan), canonicalJson(plan));
  const roles = plan.jobs.map((job) => job.role);
  assert.equal(roles.filter((role) => role === 'exam').length, 5);
  assert.equal(roles.filter((role) => role === 'proof_candidate').length, 7);
  assert.equal(roles.includes('research_candidate'), true);
  assert.equal(roles.includes('formal_research_theorem'), true);
  assert.equal(roles.includes('research_review_request'), true);
  assert.equal(roles.includes('reproduction'), true);
  assert.equal(roles.filter((role) => role === 'retention').length, 1);
  assert.equal(plan.protectedAuthorityTasks.filter((task) => task.role === 'proof_replay').length, 7);
  assert.equal(plan.resumePolicy.idempotentByJobIdAndDescriptorDigest, true);
  assert.equal(new Set(plan.jobs.map((job) => job.idempotencyKey)).size, plan.jobs.length);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-phd-e2e-'));
  try {
    const artifactRoot = path.join(temporary, 'artifacts');
    fs.mkdirSync(artifactRoot, { mode: 0o700 });
    const fakeCodex = path.join(temporary, 'fake-codex.sh');
    const candidateOutput = {
      artifact: fixture.research.artifact,
      result: fixture.research.result,
      novelty: fixture.research.novelty,
    };
    fs.writeFileSync(fakeCodex, [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'last=""',
      'while [[ $# -gt 0 ]]; do',
      '  if [[ "$1" == "--output-last-message" ]]; then last="$2"; shift 2; else shift; fi',
      'done',
      'prompt="$(mktemp)"',
      'trap \'rm -f "$prompt"\' EXIT',
      'cat > "$prompt"',
      `research='${JSON.stringify(candidateOutput)}'`,
      'if grep -q "Produce one Lean 4 proof term" "$prompt"; then',
      '  printf \'%s\' \'{"proofTerm":"by\\n  omega"}\' > "$last"',
      'else',
      '  printf \'%s\' "$research" > "$last"',
      'fi',
      'printf \'%s\\n\' \'{"type":"thread.started","thread_id":"provider-session-fixture","request_id":"provider-request-fixture"}\'',
      'printf \'%s\\n\' \'{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}\'',
      '',
    ].join('\n'), { mode: 0o700 });
    const mechanicallyInvalidCodex = path.join(temporary, 'mechanically-invalid-codex.sh');
    fs.writeFileSync(mechanicallyInvalidCodex, [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'last=""',
      'while [[ $# -gt 0 ]]; do',
      '  if [[ "$1" == "--output-last-message" ]]; then last="$2"; shift 2; else shift; fi',
      'done',
      'cat >/dev/null',
      'printf \'%s\' \'{"answers":[]}\' > "$last"',
      'printf \'%s\\n\' \'{"type":"thread.started","thread_id":"invalid-session","request_id":"invalid-request"}\'',
      'printf \'%s\\n\' \'{"type":"item.completed","item":{"type":"command_execution"}}\'',
      'printf \'%s\\n\' \'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\'',
      '',
    ].join('\n'), { mode: 0o700 });
    const sealFixtureTree = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          sealFixtureTree(child);
          fs.chmodSync(child, 0o555);
        } else {
          fs.chmodSync(child, 0o444);
        }
      }
      fs.chmodSync(directory, 0o555);
    };
    const unsealFixtureTree = (directory) => {
      if (!fs.existsSync(directory)) return;
      fs.chmodSync(directory, 0o700);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) unsealFixtureTree(child);
        else fs.chmodSync(child, 0o600);
      }
    };
    const runJob = (job, {
      expectedStatus = 0,
      harvest = true,
      codexCommand = fakeCodex,
    } = {}) => {
      const workerJob = resignWorkerJob({
        ...structuredClone(job),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      const jobPath = path.join(temporary, `${job.jobId}.json`);
      const target = path.join(artifactRoot, job.jobId);
      const jobBytes = Buffer.from(`${JSON.stringify(workerJob, null, 2)}\n`, 'utf8');
      fs.writeFileSync(jobPath, jobBytes, { mode: 0o600 });
      fs.mkdirSync(target, { mode: 0o700 });
      const result = spawnSync(process.execPath, [
        path.resolve('src/run-phd-worker.mjs'),
        '--job', jobPath,
        '--expected-job-file-sha256', sha256Text(jobBytes),
        '--plan-digest', sha256Text(canonicalJson(plan)),
        '--campaign-digest', workerJob.campaignDigest,
        '--descriptor-set-sha256', plan.descriptorSetSha256,
        '--product-tree', workerJob.deployment.productTree,
        '--runtime-sha256', workerJob.deployment.runtimeSha256,
        '--closure-sha256', workerJob.deployment.closureSha256,
        '--checkout-root', path.resolve('..'),
        '--job-root', temporary,
        '--artifact-root', target,
        '--dependency-root', artifactRoot,
        '--codex-command', codexCommand,
      ], { encoding: 'utf8' });
      assert.equal(result.status, expectedStatus, JSON.stringify({
        error: result.error?.message || null,
        stdout: result.stdout,
        stderr: result.stderr,
        artifactOutput: fs.existsSync(path.join(target, 'output.json'))
          ? fs.readFileSync(path.join(target, 'output.json'), 'utf8')
          : null,
      }));
      if (fs.existsSync(path.join(target, 'artifact-manifest.json'))) {
        sealFixtureTree(target);
      }
      if (!harvest) return target;
      const harvestProbe = spawnSync('python3', ['-c', [
        'import importlib.util,json,pathlib,sys',
        "p=pathlib.Path(sys.argv[1])",
        "s=importlib.util.spec_from_file_location('harvest',sys.argv[2])",
        'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
        "j=json.loads(pathlib.Path(sys.argv[3]).read_text())",
        'print(json.dumps(m.validate_harvested(p,j)))',
      ].join(';'), target, path.resolve('scripts/harvest-phd-qualification.py'), jobPath], {
        encoding: 'utf8',
      });
      assert.equal(harvestProbe.status, 0, harvestProbe.stderr);
      assert.deepEqual(JSON.parse(harvestProbe.stdout), [true, '']);
      return target;
    };

    const researchJob = plan.jobs.find((job) => job.role === 'research_candidate');
    runJob(researchJob);
    const failedExamRoot = runJob(plan.jobs.find((job) => job.role === 'exam'), {
      expectedStatus: 4,
      codexCommand: mechanicallyInvalidCodex,
    });
    const failedExamSummary = JSON.parse(fs.readFileSync(
      path.join(failedExamRoot, 'worker-summary.json'),
      'utf8',
    ));
    assert.equal(failedExamSummary.status, 'failed');
    assert.equal(failedExamSummary.blocker.code, 'mechanically_invalid');
    const reproductionJob = plan.jobs.find((job) => job.executor === 'frozen_research_reproduction');
    const reproductionRoot = runJob(reproductionJob);
    const reproductionRequest = JSON.parse(fs.readFileSync(
      path.join(reproductionRoot, 'reproduction-authority-request.json'),
      'utf8',
    ));
    assert.equal(reproductionRequest.status, 'ready_for_independent_authority');
    assert.equal(reproductionRequest.unsigned, true);
    assert.equal(reproductionRequest.selfAttestation, false);
    assert.equal(reproductionRequest.authorityAttestation, null);
    assert.equal(reproductionRequest.process.exitCode, 0);
    assert.equal(reproductionRequest.requestedAttestationPayload.artifactDigest, fixture.research.artifactDigest);
    assert.equal(reproductionRequest.requestedAttestationPayload.exitCode, 0);
    assert.equal(
      reproductionRequest.requestedAttestationPayload.executionEvidenceSha256,
      reproductionRequest.executionEvidenceSha256,
    );
    assert.equal(fs.existsSync(path.join(reproductionRoot, 'source-exact', 'run.mjs')), true);
    assert.equal(fs.existsSync(path.join(reproductionRoot, 'stdout.raw')), true);
    assert.equal(fs.existsSync(path.join(reproductionRoot, 'outputs', 'result.json')), true);

    const materializationJob = plan.jobs.find((job) => job.role === 'formal_research_theorem');
    const materializationRoot = runJob(materializationJob);
    assert.equal(
      sha256Text(fs.readFileSync(path.join(materializationRoot, 'trusted-template.lean'))),
      materializationJob.task.proofTask.trustedTemplateSha256,
    );
    const reviewRequestJob = plan.jobs.find((job) => job.role === 'research_review_request');
    const reviewRoot = runJob(reviewRequestJob);
    const reviewRequest = JSON.parse(fs.readFileSync(
      path.join(reviewRoot, 'research-review-authority-request.json'),
      'utf8',
    ));
    const reviewRequestBytes = fs.readFileSync(
      path.join(reviewRoot, 'research-review-authority-request.json'),
    );
    assert.equal(reviewRequest.unsigned, true);
    assert.equal(reviewRequest.authorityAttestation, null);
    assert.equal(reviewRequestBytes.toString('utf8'), canonicalJson(reviewRequest));
    assert.deepEqual(
      reviewRequestBytes,
      fs.readFileSync(path.join(reviewRoot, 'output.json')),
    );
    assert.equal(reviewRequest.requestJobId, reviewRequestJob.jobId);

    const proofJob = plan.jobs.find((job) => (
      job.role === 'proof_candidate'
      && job.task.obligationId === 'formal-proof-induction-well-ordering'
    ));
    const proofRoot = runJob(proofJob);
    const replayRequestBytes = fs.readFileSync(
      path.join(proofRoot, 'independent-replay-request.json'),
    );
    const replayRequest = JSON.parse(replayRequestBytes);
    assert.equal(replayRequestBytes.toString('utf8'), canonicalJson(replayRequest));
    assert.equal(replayRequest.unsigned, true);
    assert.equal(replayRequest.selfAttestation, false);
    assert.equal(replayRequest.kernelEvidence, null);
    assert.equal(replayRequest.authorityReplayEvidence, null);
    assert.equal(replayRequest.replayAuthorityAttestation, null);
    assert.equal(replayRequest.taskBytesSha256, proofJob.task.taskBytesSha256);

    const researchRoot = path.join(artifactRoot, researchJob.jobId);
    const storedResearchJob = JSON.parse(fs.readFileSync(
      path.join(researchRoot, 'job.json'),
      'utf8',
    ));
    const expiredCompletion = new Date(
      Date.parse(storedResearchJob.expiresAt) + 1,
    ).toISOString();
    const researchCallPath = path.join(researchRoot, 'model-call.json');
    const researchSummaryPath = path.join(researchRoot, 'worker-summary.json');
    const researchManifestPath = path.join(researchRoot, 'artifact-manifest.json');
    const researchCall = JSON.parse(fs.readFileSync(researchCallPath, 'utf8'));
    const researchSummary = JSON.parse(fs.readFileSync(researchSummaryPath, 'utf8'));
    const researchManifest = JSON.parse(fs.readFileSync(researchManifestPath, 'utf8'));
    unsealFixtureTree(researchRoot);
    const expiredIntervalDigest = sha256Text(canonicalJson({
      jobDigest: researchSummary.jobDigest,
      startedAt: researchSummary.startedAt,
      completedAt: expiredCompletion,
      expiresAt: storedResearchJob.expiresAt,
    }));
    researchCall.completedAt = expiredCompletion;
    researchCall.executionIntervalSha256 = expiredIntervalDigest;
    researchSummary.completedAt = expiredCompletion;
    researchSummary.executionIntervalSha256 = expiredIntervalDigest;
    researchManifest.completedAt = expiredCompletion;
    researchManifest.executionIntervalSha256 = expiredIntervalDigest;
    fs.writeFileSync(researchCallPath, `${JSON.stringify(researchCall, null, 2)}\n`);
    fs.writeFileSync(researchSummaryPath, `${JSON.stringify(researchSummary, null, 2)}\n`);
    for (const target of [researchCallPath, researchSummaryPath]) {
      const relative = path.basename(target);
      const record = researchManifest.files.find((row) => row.path === relative);
      record.bytes = fs.statSync(target).size;
      record.sha256 = sha256File(target);
    }
    fs.writeFileSync(
      researchManifestPath,
      `${JSON.stringify(researchManifest, null, 2)}\n`,
    );
    unsealFixtureTree(reviewRoot);
    fs.rmSync(reviewRoot, { recursive: true, force: true });
    const rejectedDependencyRoot = runJob(reviewRequestJob, { expectedStatus: 4 });
    assert.match(
      JSON.parse(fs.readFileSync(
        path.join(rejectedDependencyRoot, 'worker-summary.json'),
        'utf8',
      )).blocker.message,
      /research dependency is not a terminal bound candidate/,
    );
  } finally {
    const artifactRoot = path.join(temporary, 'artifacts');
    if (fs.existsSync(artifactRoot)) {
      const unseal = (directory) => {
        fs.chmodSync(directory, 0o700);
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const child = path.join(directory, entry.name);
          if (entry.isDirectory()) unseal(child);
          else fs.chmodSync(child, 0o600);
        }
      };
      unseal(artifactRoot);
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('trusted proof registry covers all seven obligations and research tasks bind artifact/template/deployment digests', () => {
  const registry = loadProofObligationRegistry({ rubric: runtime.rubric });
  assert.equal(registry.entries.length, 7);
  const artifactDigest = '9'.repeat(64);
  const template = materializeProofTemplate({
    obligationId: 'formal-proof-research-main-result',
    researchArtifactDigest: artifactDigest,
    fixtureOnly: true,
  }).toString('utf8');
  assert.match(template, new RegExp(artifactDigest));
  assert.doesNotMatch(template, /CORTEX_RESEARCH_ARTIFACT_SHA256/);
  assert.throws(() => materializeProofTemplate({
    obligationId: 'formal-proof-research-main-result',
    researchArtifactDigest: artifactDigest,
  }), /campaign-frozen external template bytes/);
  const built = createObligationProofTask({
    obligationId: 'formal-proof-research-main-result',
    researchArtifactDigest: artifactDigest,
    fixtureOnly: true,
    deployment: runtime.deployment,
    runId: 'research-proof-run',
    seed: 'research-proof-seed',
  });
  assert.equal(built.task.deployment.sourceTree, sourceTree);
  assert.equal(built.task.theorem.templateSha256, sha256Text(built.trustedTemplateBytes));
  const substituted = structuredClone(runtime.deployment);
  substituted.sourceCommit = 'f'.repeat(40);
  assert.notDeepEqual(built.task.deployment, substituted);

  const fixture = campaignFixture();
  const ordinary = createObligationProofTask({
    obligationId: 'formal-proof-induction-well-ordering',
    deployment: runtime.deployment,
    runId: 'ordinary-proof-run',
    seed: 'ordinary-proof-seed',
  });
  const candidate = createProofCandidate({
    taskBytes: ordinary.taskBytes,
    candidateId: 'ordinary-proof-candidate',
    proofTerm: 'by\n  omega',
  });
  const candidateBytes = serializeProofRecord(candidate);
  const outputBytes = Buffer.from(JSON.stringify({ proofTerm: candidate.proof.term }));
  const proofIndex = fixture.campaign.proofObligationIds.indexOf('formal-proof-induction-well-ordering');
  const candidateCall = timedWorkerCall(fixture.campaign, {
    schemaVersion: 'cortex.learning_os.phd_worker_call.v2',
    role: 'proof_candidate',
    sessionId: fixture.roles.proofCandidateSessions[proofIndex],
    provider: 'openai-codex',
    model: fixture.campaign.modelRuntime.model,
    thinking: 'xhigh',
    sandbox: 'read-only',
    toolsAllowed: false,
    toolsUsed: [],
    usage: { inputTokens: 100, outputTokens: 20 },
    exactPromptBytes: true,
    outputSha256: sha256Text(outputBytes),
    startedAt: '2026-02-08T00:00:00.000Z',
    completedAt: '2026-02-08T00:01:00.000Z',
  });
  const kernelEvidence = {
    bindings: {
      taskBytesSha256: parseProofRecordBytes(ordinary.taskBytes).bytesSha256,
      candidateBytesSha256: parseProofRecordBytes(candidateBytes).bytesSha256,
      templateSha256: sha256Text(ordinary.trustedTemplateBytes),
    },
  };
  assert.throws(() => assembleProofRun({
    campaign: fixture.campaign,
    obligationId: ordinary.obligationId,
    taskBytes: ordinary.taskBytes,
    candidateBytes,
    trustedTemplateBytes: ordinary.trustedTemplateBytes,
    candidateCall,
    candidateOutputBytes: Buffer.from('{"proofTerm":"by\\n  exact False.elim (by contradiction)"}'),
    kernelEvidence,
  }), /raw output/);
  const assembled = assembleProofRun({
    campaign: fixture.campaign,
    obligationId: ordinary.obligationId,
    taskBytes: ordinary.taskBytes,
    candidateBytes,
    trustedTemplateBytes: ordinary.trustedTemplateBytes,
    candidateCall,
    candidateOutputBytes: outputBytes,
    kernelEvidence,
  });
  assert.equal(assembled.candidateExecution.candidateBytesSha256, kernelEvidence.bindings.candidateBytesSha256);
});

test('canonical proof job tasks preserve ordinary identity and materialize research identity only from the signed dependency', () => {
  const artifact = {
    theorem: 'bounded-main-result',
    assumptions: ['explicit'],
  };
  const artifactDigest = sha256Text(canonicalJson(artifact));
  const ordinary = createObligationProofTask({
    obligationId: 'formal-proof-rank-nullity',
    deployment: runtime.deployment,
    runId: 'canonical-ordinary-proof',
    seed: 'canonical-ordinary-seed',
  });
  const ordinaryTask = createProofCandidateJobTask({
    obligationId: ordinary.obligationId,
    taskBytes: ordinary.taskBytes,
    trustedTemplateBytes: ordinary.trustedTemplateBytes,
    replaySessionId: 'ordinary-replay-session',
  });
  assert.equal(validateProofCandidateJobTask(ordinaryTask).ok, true);
  assert.equal(materializeResearchArtifactDigest(ordinaryTask), null);
  const omitted = structuredClone(ordinaryTask);
  delete omitted.researchArtifactDigest;
  assert.equal(validateProofCandidateJobTask(omitted).ok, false);

  const main = createObligationProofTask({
    obligationId: 'formal-proof-research-main-result',
    researchArtifactDigest: artifactDigest,
    fixtureOnly: true,
    deployment: runtime.deployment,
    runId: 'canonical-research-proof',
    seed: 'canonical-research-seed',
  });
  const source = createResearchArtifactSource({
    dependencyJobId: 'campaign.research_candidate',
    candidateSessionId: 'research-candidate-session',
    candidatePromptSha256: 'a'.repeat(64),
  });
  const dependentTask = createProofCandidateJobTask({
    obligationId: main.obligationId,
    taskBytes: main.taskBytes,
    trustedTemplateBytes: main.trustedTemplateBytes,
    replaySessionId: 'research-replay-session',
    claimSemanticsSha256: 'b'.repeat(64),
    researchArtifactSource: source,
  });
  assert.equal(
    dependentTask.schemaVersion,
    DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA,
  );
  assert.equal(validateProofCandidateJobTask(dependentTask).ok, true);
  const dependencyBinding = {
    jobId: source.dependencyJobId,
    candidateSessionId: source.candidateSessionId,
    outputSha256: 'c'.repeat(64),
    artifact,
    artifactDigest,
  };
  assert.equal(
    materializeResearchArtifactDigest(dependentTask, dependencyBinding),
    artifactDigest,
  );
  assert.throws(
    () => materializeResearchArtifactDigest(dependentTask),
    /materialization is invalid/,
  );
  assert.throws(
    () => materializeResearchArtifactDigest(dependentTask, {
      ...dependencyBinding,
      artifactDigest: 'd'.repeat(64),
    }),
    /materialization is invalid/,
  );
  const substituted = structuredClone(dependentTask);
  substituted.researchArtifactSource.dependencyJobId = 'campaign.other_candidate';
  assert.notEqual(
    sha256Text(canonicalJson(substituted)),
    sha256Text(canonicalJson(dependentTask)),
  );

  const productionCampaign = structuredClone(campaignFixture().campaign);
  productionCampaign.campaignId = 'production-shaped-dependent-proof';
  productionCampaign.fixtureOnly = false;
  productionCampaign.proofObligationIds = [
    ordinary.obligationId,
    main.obligationId,
  ];
  productionCampaign.roles.proofCandidateSessions = [
    'ordinary-production-candidate',
    'research-production-candidate',
  ];
  productionCampaign.roles.proofReplaySessions = [
    'ordinary-production-replay',
    'research-production-replay',
  ];
  productionCampaign.deploymentDigest = deploymentBindingDigest(
    productionCampaign.deployment,
  );
  productionCampaign.proofTemplates = [ordinary, main].map((materialized, index) => ({
    obligationId: materialized.obligationId,
    theoremStatementSha256: materialized.task.theorem.statementSha256,
    templateBlueprintSha256: sha256Text(materialized.trustedTemplateBytes),
    frozenTemplateBase64: materialized.trustedTemplateBytes.toString('base64'),
    frozenTemplateSha256: sha256Text(materialized.trustedTemplateBytes),
    frozenTaskBase64: materialized.taskBytes.toString('base64'),
    frozenTaskSha256: sha256Text(materialized.taskBytes),
    taskIdentity: {
      taskId: materialized.task.taskId,
      runId: materialized.task.runIdentity.runId,
      seed: materialized.task.runIdentity.seed,
    },
    researchArtifactBound: index === 1,
    claimSemanticsSha256: index === 1 ? 'b'.repeat(64) : null,
    source: index === 1
      ? 'campaign_frozen_external_theorem_source'
      : 'campaign_frozen_committed_obligation',
  }));
  const productionResearchJob = buildResearchJobDescriptor({
    campaign: productionCampaign,
    role: 'research_candidate',
  });
  const productionDescriptors = buildProofCandidateJobDescriptors({
    campaign: productionCampaign,
    proofTasks: [
      ordinary,
      { ...main, researchArtifactDigest: null },
    ],
    researchArtifactJob: productionResearchJob,
  });
  assert.equal(
    productionDescriptors[0].task.schemaVersion,
    'cortex.learning_os.proof_candidate_job_task.v1',
  );
  assert.equal(
    productionDescriptors[1].task.schemaVersion,
    DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA,
  );
  assert.deepEqual(
    productionDescriptors[1].dependencies,
    [productionResearchJob.jobId],
  );
  assert.equal(
    productionDescriptors[1].task.researchArtifactSource.candidatePromptSha256,
    sha256Text(productionResearchJob.prompt),
  );
  assert.equal(
    materializeResearchArtifactDigest(
      productionDescriptors[1].task,
      {
        ...dependencyBinding,
        jobId: productionResearchJob.jobId,
        candidateSessionId: productionResearchJob.sessionId,
      },
    ),
    artifactDigest,
  );
  const stagedReplay = createProofCandidateReplayMaterialization({
    job: {
      ...productionDescriptors[1],
      campaignId: productionCampaign.campaignId,
      deployment: productionCampaign.deployment,
    },
    outputBytes: Buffer.from('{"proofTerm":"by\\n  omega"}'),
    dependencyBinding: {
      ...dependencyBinding,
      jobId: productionResearchJob.jobId,
      candidateSessionId: productionResearchJob.sessionId,
    },
  });
  assert.equal(
    stagedReplay.replayRequest.researchArtifactDigest,
    artifactDigest,
  );
  assert.equal(
    stagedReplay.replayRequest.taskBytesSha256,
    productionDescriptors[1].task.taskBytesSha256,
  );
  assert.equal(
    stagedReplay.replayRequest.trustedTemplateSha256,
    productionDescriptors[1].task.trustedTemplateSha256,
  );
  assert.equal(
    stagedReplay.replayRequest.candidateBytesSha256,
    sha256Text(stagedReplay.candidateBytes),
  );
  assert.equal(
    stagedReplay.replayRequest.proofTaskSha256,
    sha256Text(canonicalJson(productionDescriptors[1].task)),
  );
});

test('production plans reject research-main v1 downgrade and split proof/materialization tasks', () => {
  const fixture = campaignFixture();
  const deployment = cycle10QualificationDeployment(runtime.deployment);
  const campaign = structuredClone(fixture.campaign);
  campaign.campaignId = 'production-research-main-identity';
  campaign.fixtureOnly = false;
  campaign.deployment = deployment;
  campaign.deploymentDigest = deploymentBindingDigest(deployment);
  campaign.roles.proofCandidateSessions = ['production-research-main-candidate'];
  campaign.roles.proofReplaySessions = ['production-research-main-replay'];
  const artifactDigest = 'd'.repeat(64);
  const claimSemanticsSha256 = 'b'.repeat(64);
  const main = createObligationProofTask({
    obligationId: 'formal-proof-research-main-result',
    researchArtifactDigest: artifactDigest,
    fixtureOnly: true,
    deployment,
    runId: 'production-research-main-run',
    seed: 'production-research-main-seed',
  });
  campaign.proofObligationIds = [main.obligationId];
  campaign.proofTemplates = [{
    obligationId: main.obligationId,
    theoremStatementSha256: main.task.theorem.statementSha256,
    templateBlueprintSha256: sha256Text(main.trustedTemplateBytes),
    frozenTemplateBase64: main.trustedTemplateBytes.toString('base64'),
    frozenTemplateSha256: sha256Text(main.trustedTemplateBytes),
    frozenTaskBase64: main.taskBytes.toString('base64'),
    frozenTaskSha256: sha256Text(main.taskBytes),
    taskIdentity: {
      taskId: main.task.taskId,
      runId: main.task.runIdentity.runId,
      seed: main.task.runIdentity.seed,
    },
    researchArtifactBound: true,
    claimSemanticsSha256,
    source: 'campaign_frozen_external_theorem_source',
  }];
  const signedCampaign = resignWorkerJob(campaign);
  const researchJob = buildResearchJobDescriptor({
    campaign: signedCampaign,
    role: 'research_candidate',
  });
  const [proofJob] = buildProofCandidateJobDescriptors({
    campaign: signedCampaign,
    proofTasks: [{ ...main, researchArtifactDigest: null }],
    researchArtifactJob: researchJob,
  });
  const materializationJob = {
    jobId: `${signedCampaign.campaignId}.formal-research-theorem`,
    role: 'formal_research_theorem',
    sessionId: signedCampaign.roles.researchMaterializerSession,
    executor: 'frozen_task_materialization',
    dependencies: [researchJob.jobId],
    task: {
      schemaVersion: 'cortex.learning_os.formal_research_materialization_task.v1',
      obligationId: proofJob.task.obligationId,
      proofTask: structuredClone(proofJob.task),
      researchArtifactSource: structuredClone(proofJob.task.researchArtifactSource),
      claimSemanticsSha256,
    },
    timeoutSeconds: 60,
    maxOutputBytes: 2 * 1024 * 1024,
  };
  const protectedReplay = {
    taskId: `${proofJob.jobId}.protected-replay`,
    role: 'proof_replay',
    sessionId: proofJob.task.replaySessionId,
    dependsOn: [proofJob.jobId, materializationJob.jobId],
    proofTaskSha256: sha256Text(canonicalJson(proofJob.task)),
    exactTaskBytesSha256: proofJob.task.taskBytesSha256,
    exactTemplateSha256: proofJob.task.trustedTemplateSha256,
    claimSemanticsSha256,
    authorityCapability: 'proof_replay',
  };
  const plan = buildDetachedQualificationJobs({
    campaign: signedCampaign,
    descriptors: [researchJob, proofJob, materializationJob],
    protectedAuthorityTasks: [protectedReplay],
    signingSecret: secret,
  });
  const valid = verifyDetachedQualificationJobPlan(plan, secret, {
    expectedCampaignId: signedCampaign.campaignId,
    expectedDeployment: deployment,
    now: '2026-02-10T00:00:00.000Z',
  });
  assert.equal(valid.ok, true, valid.errors.join('; '));

  const v1Task = createProofCandidateJobTask({
    obligationId: main.obligationId,
    taskBytes: main.taskBytes,
    trustedTemplateBytes: main.trustedTemplateBytes,
    replaySessionId: proofJob.task.replaySessionId,
    claimSemanticsSha256,
    researchArtifactDigest: artifactDigest,
  });
  const downgraded = structuredClone(plan);
  const downgradedProofIndex = downgraded.jobs.findIndex((job) => (
    job.jobId === proofJob.jobId
  ));
  downgraded.jobs[downgradedProofIndex].task = v1Task;
  downgraded.jobs[downgradedProofIndex].dependencies = [];
  downgraded.jobs[downgradedProofIndex] = resealDetachedJob(
    downgraded.jobs[downgradedProofIndex],
  );
  downgraded.protectedAuthorityTasks[0].proofTaskSha256 = sha256Text(canonicalJson(v1Task));
  const signedDowngrade = resealDetachedPlan(downgraded);
  const downgradeValidation = verifyDetachedQualificationJobPlan(
    signedDowngrade,
    secret,
    { now: '2026-02-10T00:00:00.000Z' },
  );
  assert.equal(downgradeValidation.ok, false);
  assert.match(
    downgradeValidation.errors.join('; '),
    /detached proof task or research materialization scope is invalid|not dependent/,
  );

  const alternateTask = createProofCandidateJobTask({
    obligationId: main.obligationId,
    taskBytes: main.taskBytes,
    trustedTemplateBytes: main.trustedTemplateBytes,
    replaySessionId: 'split-materialization-replay',
    claimSemanticsSha256,
    researchArtifactSource: proofJob.task.researchArtifactSource,
  });
  const split = structuredClone(plan);
  const materializationIndex = split.jobs.findIndex((job) => (
    job.jobId === materializationJob.jobId
  ));
  split.jobs[materializationIndex].task.proofTask = alternateTask;
  split.jobs[materializationIndex] = resealDetachedJob(split.jobs[materializationIndex]);
  const signedSplit = resealDetachedPlan(split);
  const splitValidation = verifyDetachedQualificationJobPlan(signedSplit, secret, {
    now: '2026-02-10T00:00:00.000Z',
  });
  assert.equal(splitValidation.ok, false);
  assert.match(
    splitValidation.errors.join('; '),
    /proof and materialization do not share one exact proof task/,
  );
});
