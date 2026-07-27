import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  LEGACY_ADAPTIVE_POLICY_PATH,
  loadAdaptivePolicy,
  policyDigest,
} from '../src/adaptive-policy.mjs';
import { buildAdaptiveSessionPlan, runAdaptiveSession } from '../src/adaptive-session.mjs';
import { verifyAdaptiveArtifacts } from '../src/adaptive-verifier.mjs';
import {
  buildEarlyReviewDirective,
  selectNextAction,
  validateCurriculumGraph,
} from '../src/curriculum-planner.mjs';
import {
  EXERCISE_ROLES,
  GENERATED_CONCEPT_IDS,
  generateExercise,
  replayGeneratedExercise,
  validateGeneratedExerciseCoverage,
  verifyGeneratedAnswer,
} from '../src/generated-exercises.mjs';
import { sha256File, sha256Text } from '../src/hash.mjs';
import {
  buildContinuousMasteryMigration,
  migrateMasteryStore,
  verifyMasteryMigrationAudit,
} from '../src/mastery-migration.mjs';
import {
  applyMasteryDelta,
  createMasteryState,
  signMasteryState,
  verifyMasteryState,
} from '../src/mastery-state.mjs';
import { buildExamPrompt } from '../src/model-answer-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const legacyGraph = read('capsules/math-foundations/curriculum.graph.json');
const graph = read('capsules/math-foundations/curriculum.continuous-acquisition-v1.graph.json');
const capsule = read('capsules/math-foundations/capsule.json');
const legacyPolicy = loadAdaptivePolicy(LEGACY_ADAPTIVE_POLICY_PATH).policy;
const policy = loadAdaptivePolicy().policy;
const secret = 'continuous-acquisition-test-secret-with-forty-eight-chars';
const sourceCommit = 'c'.repeat(40);
const now = '2026-07-27T15:39:00.000Z';

function graphDigest(value) {
  return sha256Text(canonicalJson(value));
}

function markAcquired(record, timestamp = now) {
  Object.assign(record, {
    state: 'acquired',
    attempts: 1,
    passes: 1,
    failures: 0,
    consecutivePasses: 1,
    consecutiveFailures: 0,
    acquiredAt: timestamp,
    lastAttemptedAt: timestamp,
    lastEvidenceDigest: 'a'.repeat(64),
    lastRunId: 'acquisition-fixture',
    nextReviewAt: null,
  });
}

function activeSignedState({ allAcquired = false } = {}) {
  const state = createMasteryState({ graph, policy, now });
  if (allAcquired) for (const record of Object.values(state.concepts)) markAcquired(record);
  return signMasteryState(state, secret);
}

function legacyRevision74() {
  const state = createMasteryState({ graph: legacyGraph, policy: legacyPolicy, now: '2026-07-27T14:11:00.084Z' });
  state.revision = 74;
  state.appliedRunIds = ['legacy-run-74'];
  state.appliedRunReceipts = [{ runId: 'legacy-run-74', artifactManifestDigest: 'b'.repeat(64) }];
  for (const [index, record] of Object.values(state.concepts).entries()) {
    Object.assign(record, {
      state: index === 0 ? 'mastered' : 'review',
      attempts: index + 2,
      passes: index + 1,
      failures: 1,
      consecutivePasses: 1,
      consecutiveFailures: 0,
      reviewStage: index === 0 ? 4 : 2,
      lastAttemptedAt: '2026-07-27T14:11:00.084Z',
      lastReviewedAt: `2026-07-${String((index % 20) + 1).padStart(2, '0')}T14:11:00.084Z`,
      nextReviewAt: '2026-08-03T14:11:00.084Z',
      lastEvidenceDigest: index.toString(16).padStart(64, '0'),
      lastRunId: 'legacy-run-74',
    });
  }
  state.pendingRepairs = [{
    failedConceptId: 'statistics-weighted-mean',
    evidenceDigest: 'e'.repeat(64),
    runId: 'legacy-run-74',
  }];
  return signMasteryState(state, secret);
}

function migrationOptions(sourceState, overrides = {}) {
  return {
    sourceState,
    secret,
    legacyGraph,
    legacyPolicy,
    targetGraph: graph,
    targetPolicy: policy,
    expectedSourceRevision: 74,
    expectedSourceStateDigest: sha256Text(canonicalJson(sourceState)),
    expectedSourceCurriculumDigest: graphDigest(legacyGraph),
    expectedSourcePolicyDigest: policyDigest(legacyPolicy),
    expectedTargetCurriculumDigest: graphDigest(graph),
    expectedTargetPolicyDigest: policyDigest(policy),
    sourceCommit,
    expectedSourceCommit: sourceCommit,
    now: '2026-07-27T16:00:00.000Z',
    ...overrides,
  };
}

function fakePassingExam({ exam, learningContext, evidenceRole, sessionId, runId }) {
  const item = exam.items[0];
  const answer = Array.isArray(item.checker.expected) ? item.checker.expected.join(',') : String(item.checker.expected);
  const completedAt = '2026-07-27T15:39:01.000Z';
  const answerSet = {
    schemaVersion: 'cortex.learning_os.answer_set.v0',
    runId,
    answers: [{ itemId: item.itemId, answer }],
    answerSource: {
      kind: 'codex_exec_ephemeral',
      provider: 'openai-codex',
      model: policy.modelRuntime.model,
      sessionId,
      usage: { input_tokens: 10, output_tokens: 2 },
    },
    evidenceRole,
    toolsUsed: [],
    startedAt: '2026-07-27T15:39:00.500Z',
    completedAt,
  };
  return {
    prompt: buildExamPrompt({ exam, learningContext }),
    answerSet,
    raw: {
      command: '/fixture/codex',
      args: [
        'exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
        '--model', policy.modelRuntime.model, '--config', 'model_reasoning_effort="xhigh"',
        '--json', '--output-schema', '/fixture/schema.json',
      ],
      exitCode: 0,
      sessionId,
      finalText: JSON.stringify({ answers: answerSet.answers }),
      events: [{ type: 'turn.completed', usage: answerSet.answerSource.usage }],
    },
  };
}

test('continuous graph adds exactly 48 coherent concepts while legacy graph and policy remain verifiable', () => {
  assert.equal(validateCurriculumGraph(legacyGraph).ok, true);
  const validation = validateCurriculumGraph(graph);
  assert.equal(validation.ok, true);
  assert.equal(legacyGraph.concepts.length, 36);
  assert.equal(graph.concepts.length, 84);
  const activeById = new Map(graph.concepts.map((concept) => [concept.conceptId, concept]));
  for (const concept of legacyGraph.concepts) assert.equal(canonicalJson(activeById.get(concept.conceptId)), canonicalJson(concept));
  const added = graph.concepts.filter((concept) => !legacyGraph.concepts.some((legacy) => legacy.conceptId === concept.conceptId));
  assert.equal(added.length, 48);
  assert.deepEqual(
    [...new Set(added.map((concept) => concept.category))].sort(),
    ['algebra-precalculus', 'calculus', 'discrete-mathematics', 'linear-algebra', 'number-theory', 'optimization', 'probability-statistics'],
  );
  assert.equal(policy.reviewSelection.enabled, false);
  assert.equal(policy.reviewSelection.scheduleNewReviews, false);
  const legacy = legacyRevision74();
  assert.equal(verifyMasteryState(legacy, secret, { graph: legacyGraph, policy: legacyPolicy }).ok, true);

  const cyclic = structuredClone(graph);
  cyclic.concepts.find((concept) => concept.conceptId === 'number-fractions').prerequisites.push('calculus-fundamental-theorem');
  assert.equal(validateCurriculumGraph(cyclic).ok, false);
  const missingGenerator = structuredClone(graph);
  missingGenerator.concepts.push({
    conceptId: 'unsupported-new-concept',
    title: 'Unsupported',
    category: 'test',
    prerequisites: [],
    outcomes: ['Must fail closed.'],
  });
  assert.equal(validateCurriculumGraph(missingGenerator).ok, true);
  assert.deepEqual(validateGeneratedExerciseCoverage(missingGenerator), {
    ok: false,
    missing: ['unsupported-new-concept'],
  });
  assert.throws(
    () => generateExercise({ conceptId: 'unsupported-new-concept', seed: 'x', role: 'acquisition' }),
    /unsupported generated-exercise conceptId/,
  );
});

test('active planner suppresses overdue and future reviews and ignores stale dates for acquired prerequisites', () => {
  const state = activeSignedState({ allAcquired: true });
  const target = state.concepts['algebra-polynomial-arithmetic'];
  Object.assign(target, {
    state: 'unassessed',
    attempts: 0,
    passes: 0,
    failures: 0,
    consecutivePasses: 0,
    acquiredAt: null,
    lastAttemptedAt: null,
    lastEvidenceDigest: null,
    lastRunId: null,
  });
  state.concepts['algebra-linear-equations'].nextReviewAt = '2020-01-01T00:00:00.000Z';
  state.concepts['algebra-factoring'].nextReviewAt = '2099-01-01T00:00:00.000Z';
  const action = selectNextAction({ graph, mastery: state, policy, now, seed: 'review-suppression' });
  assert.equal(action.kind, 'acquisition');
  assert.equal(action.conceptId, 'algebra-polynomial-arithmetic');
  assert.notEqual(action.role, 'spaced-review');
  assert.throws(
    () => selectNextAction({
      graph,
      mastery: state,
      policy,
      now,
      seed: 'early-review-rejected',
      operatorDirective: buildEarlyReviewDirective(now),
    }),
    /early-review directives are disabled/,
  );
  assert.throws(() => buildAdaptiveSessionPlan({
    runId: 'active-early-review-rejected',
    graph,
    policy,
    mastery: activeSignedState(),
    sourceCommit,
    seed: 'early-review',
    signingSecret: secret,
    allowEarlyReview: true,
    now,
  }), /early-review mode is disabled/);
});

test('continuous state records covered-once acquisition and genuine correction without scheduling reviews', () => {
  const state = activeSignedState();
  const passDelta = {
    schemaVersion: 'cortex.learning_os.mastery_delta.v2',
    runId: 'continuous-pass',
    baseRevision: 0,
    curriculumId: graph.curriculumId,
    capsuleId: graph.capsuleId,
    policyDigest: policyDigest(policy),
    completedAt: '2026-07-27T15:39:01.000Z',
    events: [{
      conceptId: 'algebra-factoring',
      role: 'acquisition',
      passed: true,
      completedAt: '2026-07-27T15:39:01.000Z',
      evidenceDigest: '1'.repeat(64),
    }],
  };
  const acquired = applyMasteryDelta({
    state,
    delta: passDelta,
    graph,
    policy,
    artifactManifestDigest: '2'.repeat(64),
  });
  assert.equal(acquired.concepts['algebra-factoring'].state, 'acquired');
  assert.equal(acquired.concepts['algebra-factoring'].acquiredAt, passDelta.completedAt);
  assert.equal(acquired.concepts['algebra-factoring'].nextReviewAt, null);
  assert.equal(acquired.concepts['algebra-factoring'].lastReviewedAt, null);
  assert.throws(() => applyMasteryDelta({
    state,
    delta: {
      ...passDelta,
      runId: 'forbidden-review',
      events: [{ ...passDelta.events[0], role: 'spaced-review' }],
    },
    graph,
    policy,
    artifactManifestDigest: '3'.repeat(64),
  }), /invalid mastery event/);

  const failed = applyMasteryDelta({
    state,
    delta: {
      ...passDelta,
      runId: 'continuous-failure',
      events: [{ ...passDelta.events[0], passed: false, role: 'acquisition' }],
    },
    graph,
    policy,
    artifactManifestDigest: '4'.repeat(64),
  });
  assert.equal(failed.concepts['algebra-factoring'].state, 'learning');
  assert.equal(failed.pendingRepairs[0].failedConceptId, 'algebra-factoring');
  assert.equal(failed.concepts['algebra-factoring'].nextReviewAt, null);
  const corrected = applyMasteryDelta({
    state: signMasteryState(failed, secret),
    delta: {
      ...passDelta,
      runId: 'continuous-correction',
      baseRevision: 1,
      completedAt: '2026-07-27T15:39:02.000Z',
      events: [{
        ...passDelta.events[0],
        role: 'correction',
        completedAt: '2026-07-27T15:39:02.000Z',
        evidenceDigest: '5'.repeat(64),
      }],
    },
    graph,
    policy,
    artifactManifestDigest: '6'.repeat(64),
  });
  assert.equal(corrected.concepts['algebra-factoring'].state, 'acquired');
  assert.equal(corrected.pendingRepairs.length, 0);
  assert.equal(corrected.concepts['algebra-factoring'].nextReviewAt, null);
});

test('bounded signed migration preserves evidence, clears schedules, rejects tampering, removal, mismatch, and repetition', () => {
  const sourceState = legacyRevision74();
  const built = buildContinuousMasteryMigration(migrationOptions(sourceState));
  assert.equal(built.targetState.revision, 75);
  assert.equal(Object.keys(built.targetState.concepts).length, 84);
  assert.equal(Object.values(built.targetState.concepts).filter((record) => record.state === 'acquired').length, 36);
  assert.equal(Object.values(built.targetState.concepts).filter((record) => record.state === 'unassessed').length, 48);
  assert.equal(Object.values(built.targetState.concepts).every((record) => record.nextReviewAt === null), true);
  assert.deepEqual(built.targetState.appliedRunIds, sourceState.appliedRunIds);
  assert.deepEqual(built.targetState.appliedRunReceipts, sourceState.appliedRunReceipts);
  assert.deepEqual(built.targetState.pendingRepairs, sourceState.pendingRepairs);
  for (const concept of legacyGraph.concepts) {
    const before = sourceState.concepts[concept.conceptId];
    const after = built.targetState.concepts[concept.conceptId];
    for (const field of [
      'attempts', 'passes', 'failures', 'consecutivePasses', 'consecutiveFailures',
      'lastAttemptedAt', 'lastReviewedAt', 'lastEvidenceDigest', 'lastRunId',
    ]) assert.equal(after[field], before[field], `${concept.conceptId}.${field}`);
    assert.equal(after.historicalReviewStage, before.reviewStage);
    assert.equal(after.historicalNextReviewAt, before.nextReviewAt);
  }
  assert.equal(verifyMasteryMigrationAudit(built.audit, secret), true);
  const tamperedAudit = structuredClone(built.audit);
  tamperedAudit.addedConceptIds.pop();
  assert.equal(verifyMasteryMigrationAudit(tamperedAudit, secret), false);
  assert.equal(verifyMasteryState(signMasteryState(built.targetState, secret), secret, { graph, policy }).ok, true);

  const postMigrationDelta = {
    schemaVersion: 'cortex.learning_os.mastery_delta.v2',
    runId: 'first-post-migration-acquisition',
    baseRevision: 75,
    curriculumId: graph.curriculumId,
    capsuleId: graph.capsuleId,
    policyDigest: policyDigest(policy),
    completedAt: '2026-07-27T16:00:01.000Z',
    events: [{
      conceptId: 'algebra-polynomial-arithmetic',
      role: 'acquisition',
      passed: true,
      completedAt: '2026-07-27T16:00:01.000Z',
      evidenceDigest: '9'.repeat(64),
    }],
  };
  const advanced = applyMasteryDelta({
    state: signMasteryState(built.targetState, secret),
    delta: postMigrationDelta,
    graph,
    policy,
    artifactManifestDigest: '8'.repeat(64),
  });
  assert.equal(advanced.revision, 76);
  assert.equal(advanced.migration.targetRevision, 75);
  assert.equal(verifyMasteryState(signMasteryState(advanced, secret), secret, { graph, policy }).ok, true);
  const futureMigration = structuredClone(advanced);
  futureMigration.migration.targetRevision = 77;
  assert.match(
    verifyMasteryState(signMasteryState(futureMigration, secret), secret, { graph, policy }).errors.join('; '),
    /invalid continuous mastery migration receipt/,
  );

  const tampered = structuredClone(sourceState);
  tampered.concepts['number-fractions'].passes += 1;
  assert.throws(
    () => buildContinuousMasteryMigration(migrationOptions(tampered)),
    /legacy mastery verification failed/,
  );
  assert.throws(
    () => buildContinuousMasteryMigration(migrationOptions(sourceState, {
      expectedSourcePolicyDigest: '0'.repeat(64),
    })),
    /source policy digest mismatch/,
  );
  assert.throws(
    () => buildContinuousMasteryMigration(migrationOptions(sourceState, {
      expectedSourceStateDigest: '0'.repeat(64),
    })),
    /source state digest mismatch/,
  );
  assert.throws(
    () => buildContinuousMasteryMigration(migrationOptions(sourceState, {
      expectedSourceCommit: 'd'.repeat(40),
    })),
    /source commit mismatch/,
  );
  const removedGraph = structuredClone(graph);
  removedGraph.concepts = removedGraph.concepts.filter((concept) => concept.conceptId !== 'reasoning-truth-boundary');
  assert.throws(
    () => buildContinuousMasteryMigration(migrationOptions(sourceState, {
      targetGraph: removedGraph,
      expectedTargetCurriculumDigest: graphDigest(removedGraph),
    })),
    /removes legacy concepts/,
  );
  const rewrittenGraph = structuredClone(graph);
  rewrittenGraph.concepts.find((concept) => concept.conceptId === 'number-fractions').title = 'Rewritten legacy concept';
  assert.throws(
    () => buildContinuousMasteryMigration(migrationOptions(sourceState, {
      targetGraph: rewrittenGraph,
      expectedTargetCurriculumDigest: graphDigest(rewrittenGraph),
    })),
    /rewrites legacy concepts/,
  );
  assert.throws(
    () => buildContinuousMasteryMigration(migrationOptions(signMasteryState(built.targetState, secret), {
      expectedSourceRevision: 75,
    })),
    /already migrated/,
  );

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-continuous-migration-'));
  try {
    const statePath = path.join(temporary, 'mastery.json');
    const secretPath = path.join(temporary, 'mastery.hmac');
    const auditPath = path.join(temporary, 'migration-audit.json');
    fs.writeFileSync(statePath, `${JSON.stringify(sourceState, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    const migrated = migrateMasteryStore({
      statePath,
      secretPath,
      auditPath,
      ...migrationOptions(sourceState),
      sourceState: undefined,
      secret: undefined,
    });
    assert.equal(migrated.state.revision, 75);
    assert.equal(fs.statSync(statePath).mode & 0o077, 0);
    assert.equal(fs.statSync(auditPath).mode & 0o077, 0);
    assert.equal(verifyMasteryMigrationAudit(JSON.parse(fs.readFileSync(auditPath, 'utf8')), secret), true);
    assert.throws(() => migrateMasteryStore({
      statePath,
      secretPath,
      auditPath: path.join(temporary, 'second-audit.json'),
      ...migrationOptions(sourceState),
      sourceState: undefined,
      secret: undefined,
    }), /already migrated/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('all 84 active concepts regenerate complete items and local oracle digests deterministically', () => {
  assert.deepEqual(GENERATED_CONCEPT_IDS, graph.concepts.map((concept) => concept.conceptId).sort());
  const itemIds = new Set();
  for (const concept of graph.concepts) {
    for (const role of EXERCISE_ROLES) {
      const first = generateExercise({ conceptId: concept.conceptId, seed: 'active-catalog', role });
      const second = generateExercise({ conceptId: concept.conceptId, seed: 'active-catalog', role });
      assert.equal(canonicalJson(first), canonicalJson(second));
      assert.equal(canonicalJson(replayGeneratedExercise(first)), canonicalJson(first));
      const oracleDigest = sha256Text(canonicalJson({
        family: first.generation.family,
        parameters: first.generation.parameters,
        checker: first.checker,
      }));
      assert.equal(first.generation.oracleDigest, oracleDigest);
      const answer = Array.isArray(first.checker.expected) ? first.checker.expected.join(',') : first.checker.expected;
      assert.equal(verifyGeneratedAnswer({ item: first, answer }).passed, true, `${concept.conceptId}:${role}`);
      assert.equal(itemIds.has(first.itemId), false);
      itemIds.add(first.itemId);
    }
  }
  assert.equal(itemIds.size, 84 * EXERCISE_ROLES.length);
});

test('active session applies acquisition evidence and reports an honest terminal curriculum frontier', () => {
  const state = activeSignedState();
  const plan = buildAdaptiveSessionPlan({
    runId: 'continuous-acquisition-pass',
    graph,
    policy,
    mastery: state,
    sourceCommit,
    seed: 'continuous-pass',
    signingSecret: secret,
    now,
  });
  assert.equal(plan.schemaVersion, 'cortex.learning_os.adaptive_session_plan.v2');
  assert.equal(plan.operatorDirective, null);
  assert.equal(plan.action.role, 'acquisition');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-continuous-session-'));
  try {
    const summary = runAdaptiveSession({
      plan,
      graph,
      policy,
      capsule,
      artifactRoot: temporary,
      sourceCommit,
      callExam: fakePassingExam,
      callCandidate: () => { throw new Error('candidate call must not run after a pass'); },
    });
    assert.equal(summary.status, 'candidate_acquisition_delta');
    assert.equal(summary.acquisitionDeltaProposed, true);
    const replay = verifyAdaptiveArtifacts({
      artifactRoot: temporary,
      graph,
      policy,
      capsule,
      currentMastery: state,
      expectedSourceCommit: sourceCommit,
      planSecret: secret,
    });
    const applied = applyMasteryDelta({
      state,
      delta: replay.recomputedDelta,
      graph,
      policy,
      artifactManifestDigest: replay.artifactManifestDigest,
    });
    assert.equal(applied.concepts[plan.action.conceptId].state, 'acquired');
    assert.equal(applied.concepts[plan.action.conceptId].nextReviewAt, null);
    assert.throws(() => verifyAdaptiveArtifacts({
      artifactRoot: temporary,
      graph,
      policy,
      capsule,
      currentMastery: state,
      expectedSourceCommit: 'd'.repeat(40),
      planSecret: secret,
    }), /source mismatch/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  const frontierState = activeSignedState({ allAcquired: true });
  const frontierPlan = buildAdaptiveSessionPlan({
    runId: 'continuous-frontier',
    graph,
    policy,
    mastery: frontierState,
    sourceCommit,
    seed: 'frontier',
    signingSecret: secret,
    now,
  });
  assert.equal(frontierPlan.action.reasonCode, 'curriculum_frontier_reached');
  const frontierRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-continuous-frontier-'));
  try {
    const summary = runAdaptiveSession({
      plan: frontierPlan,
      graph,
      policy,
      capsule,
      artifactRoot: frontierRoot,
      sourceCommit,
      callExam: () => { throw new Error('frontier must make no model call'); },
      callCandidate: () => { throw new Error('frontier must make no candidate call'); },
    });
    assert.equal(summary.status, 'curriculum_frontier_reached');
    assert.equal(summary.modelCalls, 0);
    assert.equal(summary.acquisitionDeltaProposed, false);
    const replay = verifyAdaptiveArtifacts({
      artifactRoot: frontierRoot,
      graph,
      policy,
      capsule,
      currentMastery: frontierState,
      expectedSourceCommit: sourceCommit,
      planSecret: secret,
    });
    assert.equal(replay.recomputedDelta, null);
    const summaryPath = path.join(frontierRoot, 'session_summary.json');
    const mutatedSummary = { ...JSON.parse(fs.readFileSync(summaryPath, 'utf8')), modelCalls: 1 };
    fs.writeFileSync(summaryPath, `${JSON.stringify(mutatedSummary, null, 2)}\n`);
    const manifestPath = path.join(frontierRoot, 'artifact_manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const summaryRow = manifest.files.find((row) => row.path === 'session_summary.json');
    summaryRow.bytes = fs.statSync(summaryPath).size;
    summaryRow.sha256 = sha256File(summaryPath);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => verifyAdaptiveArtifacts({
      artifactRoot: frontierRoot,
      graph,
      policy,
      capsule,
      currentMastery: frontierState,
      expectedSourceCommit: sourceCommit,
      planSecret: secret,
    }), /invalid curriculum_frontier_reached artifact/);
  } finally {
    fs.rmSync(frontierRoot, { recursive: true, force: true });
  }
});
