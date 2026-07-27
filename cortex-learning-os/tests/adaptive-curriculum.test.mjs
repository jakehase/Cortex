import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { analyzeCandidatePairs } from '../src/adaptive-evaluator.mjs';
import { loadAdaptivePolicy } from '../src/adaptive-policy.mjs';
import { buildAdaptiveSessionPlan, runAdaptiveSession } from '../src/adaptive-session.mjs';
import { verifyAdaptiveArtifacts } from '../src/adaptive-verifier.mjs';
import { buildExamPrompt } from '../src/model-answer-runner.mjs';
import { prerequisiteClosure, selectNextAction, validateCurriculumGraph } from '../src/curriculum-planner.mjs';
import { GENERATED_CONCEPT_IDS, EXERCISE_ROLES, generateExercise, replayGeneratedExercise, verifyGeneratedAnswer } from '../src/generated-exercises.mjs';
import {
  applyMasteryDelta,
  atomicWriteMasteryState,
  createMasteryState,
  initializeMasteryStore,
  signMasteryState,
  verifyMasteryState,
} from '../src/mastery-state.mjs';
import { buildCandidateRecord } from '../src/model-candidate.mjs';
import { sha256Text } from '../src/hash.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const graph = read('capsules/math-foundations/curriculum.graph.json');
const capsule = read('capsules/math-foundations/capsule.json');
const { policy } = loadAdaptivePolicy(path.join(root, 'policies/adaptive-math-v0.8.json'));
const sourceCommit = 'a'.repeat(40);
const secret = 'adaptive-test-secret-with-more-than-thirty-two-characters';

function masteredState(now = '2026-07-26T12:00:00.000Z') {
  const state = createMasteryState({ graph, policy, now });
  for (const record of Object.values(state.concepts)) {
    Object.assign(record, {
      state: 'review',
      attempts: 1,
      passes: 1,
      failures: 0,
      consecutivePasses: 1,
      consecutiveFailures: 0,
      reviewStage: 1,
      lastAttemptedAt: now,
      lastReviewedAt: now,
      nextReviewAt: '2027-01-01T00:00:00.000Z',
      lastEvidenceDigest: '1'.repeat(64),
      lastRunId: 'fixture-prior',
    });
  }
  return signMasteryState(state, secret);
}

function resetConcept(state, conceptId) {
  state.concepts[conceptId] = {
    state: 'unassessed', attempts: 0, passes: 0, failures: 0, consecutivePasses: 0, consecutiveFailures: 0,
    reviewStage: 0, lastAttemptedAt: null, lastReviewedAt: null, nextReviewAt: null,
    lastEvidenceDigest: null, lastRunId: null,
  };
}

function fakeExamCaller({ thresholdPass = false, perfect = false, thinking = 'xhigh' } = {}) {
  let call = 0;
  return ({ exam, learningContext, evidenceRole, sessionId, runId }) => {
    call += 1;
    const item = exam.items[0];
    const paired = String(evidenceRole).startsWith('paired_');
    const shouldPass = perfect || evidenceRole === 'correction'
      || (paired && (thresholdPass ? evidenceRole === 'paired_candidate_context' : true));
    const answer = shouldPass
      ? (Array.isArray(item.checker.expected) ? item.checker.expected.join(',') : String(item.checker.expected))
      : '__deterministically_wrong__';
    const completedAt = new Date(Date.parse('2026-07-26T12:00:00.000Z') + call * 1000).toISOString();
    const answerSet = {
      schemaVersion: 'cortex.learning_os.answer_set.v0',
      runId,
      answers: [{ itemId: item.itemId, answer }],
      answerSource: {
        kind: 'codex_exec_ephemeral',
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        sessionId,
        usage: { input_tokens: 20, output_tokens: 2 },
      },
      evidenceRole,
      toolsUsed: [],
      startedAt: new Date(Date.parse(completedAt) - 100).toISOString(),
      completedAt,
    };
    const usage = { input_tokens: 20, output_tokens: 2 };
    return {
      prompt: buildExamPrompt({ exam, learningContext }),
      answerSet,
      raw: {
        command: '/fake/codex',
        args: ['exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only', '--model', 'gpt-5.6-sol', '--config', `model_reasoning_effort="${thinking}"`, '--json', '--output-schema', '/fake/schema.json'],
        exitCode: 0,
        sessionId,
        finalText: JSON.stringify({ answers: answerSet.answers }),
        events: [{ type: 'turn.completed', usage }],
      },
    };
  };
}

function fakeCandidateCaller(overrides = {}, thinking = 'xhigh') {
  return ({ prompt, sessionId }) => {
    const output = {
      rule: 'For linear equations, preserve equality while undoing operations in reverse order and verify by substitution.',
      scope: 'Linear equations with one unknown and reversible arithmetic operations.',
      contraindications: ['Do not divide by a quantity that may be zero.', 'This does not directly solve nonlinear equations.'],
      likelyRootCause: 'The inverse operation was applied to only one side of the equation.',
      ...overrides,
    };
    return {
      output,
      completedAt: '2026-07-26T12:00:02.000Z',
      provenance: {
        kind: 'codex_exec_ephemeral',
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        sessionId,
        usage: { input_tokens: 30, output_tokens: 10 },
        toolsUsed: [],
        runtimeMs: 5,
      },
      raw: {
        command: '/fake/codex',
        args: ['exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only', '--model', 'gpt-5.6-sol', '--config', `model_reasoning_effort="${thinking}"`, '--json', '--output-schema', '/fake/schema.json'],
        exitCode: 0,
        sessionId,
        finalText: JSON.stringify(output),
        events: [{ type: 'turn.completed', usage: { input_tokens: 30, output_tokens: 10 } }],
      },
      prompt,
    };
  };
}

function runFixture({ thresholdPass = false, perfect = false, candidateOverrides = {}, candidateCaller = null, policyOverride = policy, runtimeOverride = null } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-adaptive-test-'));
  const state = masteredState();
  resetConcept(state, 'algebra-linear-equations');
  const signed = signMasteryState({ ...state, signature: undefined }, secret);
  const plan = buildAdaptiveSessionPlan({
    runId: `adaptive-fixture-${thresholdPass ? 'pass' : perfect ? 'perfect' : 'null'}`,
    graph,
    policy: policyOverride,
    mastery: signed,
    sourceCommit,
    seed: 'fixture-seed',
    signingSecret: secret,
    runtimeOverride,
    now: '2026-07-26T12:00:00.000Z',
  });
  const summary = runAdaptiveSession({
    plan,
    graph,
    policy: policyOverride,
    capsule,
    artifactRoot: temporary,
    sourceCommit,
    fixedTemplates: [],
    callExam: fakeExamCaller({ thresholdPass, perfect, thinking: plan.modelRuntime.thinking }),
    callCandidate: candidateCaller || fakeCandidateCaller(candidateOverrides, plan.modelRuntime.thinking),
  });
  return { temporary, state: signed, plan, summary, policy: policyOverride };
}

function rewriteRootManifest(artifactRoot) {
  const manifestPath = path.join(artifactRoot, 'artifact_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (target !== manifestPath) {
        files.push({
          path: path.relative(artifactRoot, target),
          sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
          bytes: fs.statSync(target).size,
        });
      }
    }
  };
  visit(artifactRoot);
  manifest.files = files.sort((left, right) => left.path.localeCompare(right.path));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

test('graph validation is deterministic, rejects cycles, and planner honors review/prerequisite priority', () => {
  const validated = validateCurriculumGraph(graph);
  assert.equal(validated.ok, true);
  assert.equal(validated.topologicalOrder.length, 36);
  assert.deepEqual(prerequisiteClosure(graph, 'functions-inverse'), ['functions-evaluation', 'number-fractions', 'algebra-inverse-operations', 'algebra-linear-equations']);
  const cyclic = structuredClone(graph);
  cyclic.concepts.find((row) => row.conceptId === 'number-fractions').prerequisites.push('algebra-linear-equations');
  assert.equal(validateCurriculumGraph(cyclic).ok, false);

  const state = masteredState();
  state.concepts['statistics-mean'].nextReviewAt = '2026-07-20T00:00:00.000Z';
  assert.equal(selectNextAction({ graph, mastery: state, policy, now: '2026-07-26T00:00:00.000Z', seed: 'x' }).conceptId, 'statistics-mean');
  state.concepts['statistics-mean'].nextReviewAt = '2027-01-01T00:00:00.000Z';
  state.concepts['algebra-inverse-operations'].state = 'lapsed';
  state.concepts['algebra-inverse-operations'].consecutivePasses = 0;
  state.pendingRepairs = [{ failedConceptId: 'algebra-linear-equations', evidenceDigest: '2'.repeat(64), runId: 'failed' }];
  const repair = selectNextAction({ graph, mastery: state, policy, now: '2026-07-26T00:00:00.000Z', seed: 'x' });
  assert.equal(repair.kind, 'prerequisite_repair');
  assert.equal(repair.conceptId, 'algebra-inverse-operations');
  state.concepts['algebra-inverse-operations'].consecutiveFailures = policy.budgets.maxAttemptsPerConcept;
  const exhaustedRepair = selectNextAction({ graph, mastery: state, policy, now: '2026-07-26T00:00:00.000Z', seed: 'x' });
  assert.equal(exhaustedRepair.kind, 'terminal');
  assert.equal(exhaustedRepair.reasonCode, 'prerequisite_attempt_budget_exhausted');
  state.concepts['algebra-inverse-operations'].consecutiveFailures = 0;
  state.pendingRepairs = [];
  state.concepts['algebra-linear-equations'].nextReviewAt = '2026-07-20T00:00:00.000Z';
  const gated = selectNextAction({ graph, mastery: state, policy, now: '2026-07-26T00:00:00.000Z', seed: 'x' });
  assert.notEqual(gated.conceptId, 'algebra-linear-equations');
});

test('owner-authorized early review is signed, single-session, and independently replayed', () => {
  const now = '2026-07-26T12:00:00.000Z';
  const state = masteredState(now);
  const normal = selectNextAction({ graph, mastery: state, policy, now, seed: 'early-review-test' });
  assert.equal(normal.reasonCode, 'curriculum_currently_satisfied');
  const plan = buildAdaptiveSessionPlan({
    runId: 'adaptive-early-review-fixture',
    graph,
    policy,
    mastery: state,
    sourceCommit,
    seed: 'early-review-test',
    signingSecret: secret,
    allowEarlyReview: true,
    now,
  });
  assert.deepEqual(plan.operatorDirective, {
    type: 'owner_authorized_early_review',
    scope: 'single_session',
    authorizedAt: now,
    truthBoundary: 'This is explicitly early practice, not a due or overdue retention review.',
  });
  assert.equal(plan.action.kind, 'spaced_review');
  assert.equal(plan.action.reasonCode, 'owner_authorized_early_review');
  assert.match(plan.truthBoundary, /explicitly early practice/);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-adaptive-early-review-'));
  try {
    const summary = runAdaptiveSession({
      plan, graph, policy, capsule, artifactRoot: temporary, sourceCommit, fixedTemplates: [],
      callExam: fakeExamCaller({ perfect: true, thinking: plan.modelRuntime.thinking }),
      callCandidate: fakeCandidateCaller({}, plan.modelRuntime.thinking),
    });
    assert.equal(summary.status, 'candidate_mastery_delta');
    const options = {
      artifactRoot: temporary, graph, policy, capsule, currentMastery: state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    };
    const replay = verifyAdaptiveArtifacts(options);
    assert.equal(replay.recomputedDelta.events.length, 1);
    assert.equal(replay.recomputedDelta.events[0].role, 'spaced-review');

    const planPath = path.join(temporary, 'adaptive_plan.json');
    const tampered = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    tampered.operatorDirective.scope = 'multi_session';
    fs.writeFileSync(planPath, `${JSON.stringify(tampered, null, 2)}\n`);
    rewriteRootManifest(temporary);
    assert.throws(() => verifyAdaptiveArtifacts(options), /signature|operator directive/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('all 36 concepts and every role have deterministic fresh replayable generated exercises', () => {
  assert.deepEqual(
    graph.concepts.map((row) => row.conceptId).sort().filter((conceptId) => !GENERATED_CONCEPT_IDS.includes(conceptId)),
    [],
  );
  const itemIds = new Set();
  for (const concept of graph.concepts) {
    for (const role of EXERCISE_ROLES) {
      const first = generateExercise({ conceptId: concept.conceptId, seed: 'catalog-seed', role });
      const second = generateExercise({ conceptId: concept.conceptId, seed: 'catalog-seed', role });
      assert.equal(canonicalJson(first), canonicalJson(second));
      assert.equal(canonicalJson(replayGeneratedExercise(first)), canonicalJson(first));
      const answer = Array.isArray(first.checker.expected) ? first.checker.expected.join(',') : first.checker.expected;
      assert.equal(verifyGeneratedAnswer({ item: first, answer }).passed, true, `${concept.conceptId}:${role}`);
      assert.equal(itemIds.has(first.itemId), false, first.itemId);
      itemIds.add(first.itemId);
      assert.doesNotMatch(first.prompt, /checker\.expected|expected answer/i);
    }
  }
  const overlapAnswers = new Set();
  for (let index = 0; index < 64; index += 1) {
    overlapAnswers.add(generateExercise({ conceptId: 'reasoning-self-overlap', seed: `overlap-${index}`, role: 'acquisition' }).checker.expected);
    const bernoulli = generateExercise({ conceptId: 'statistics-bernoulli', seed: `bernoulli-${index}`, role: 'acquisition' });
    const { numerator, denominator } = bernoulli.generation.parameters;
    assert.equal(verifyGeneratedAnswer({
      item: bernoulli,
      answer: `${numerator * (denominator - numerator)}/${denominator ** 2}`,
    }).passed, true);
  }
  assert.deepEqual([...overlapAnswers].sort(), ['A', 'B']);
  const weighted = generateExercise({
    conceptId: 'statistics-weighted-mean',
    seed: 'math-training-20260727T054803Z-53b400:observed',
    role: 'acquisition',
  });
  assert.equal(weighted.checker.mode, 'numeric_tolerance');
  assert.equal(weighted.checker.tolerance, 1e-9);
  assert.equal(verifyGeneratedAnswer({ item: weighted, answer: '7.6666666667' }).passed, true);
  assert.equal(verifyGeneratedAnswer({ item: weighted, answer: '23/3' }).passed, true);
  assert.equal(verifyGeneratedAnswer({ item: weighted, answer: '7.66' }).passed, false);
  const ordered = Array.from({ length: 64 }, (_, index) => generateExercise({
    conceptId: 'optimization-multivariate', seed: `ordered-${index}`, role: 'acquisition',
  })).find((item) => item.checker.expected[0] !== item.checker.expected[1]);
  assert.ok(ordered);
  assert.equal(verifyGeneratedAnswer({ item: ordered, answer: ordered.checker.expected.join(',') }).passed, true);
  assert.equal(verifyGeneratedAnswer({ item: ordered, answer: [...ordered.checker.expected].reverse().join(',') }).passed, false);
  assert.throws(() => generateExercise({ conceptId: 'unknown', seed: 'x', role: 'baseline' }), /unsupported/);
  assert.throws(() => generateExercise({ conceptId: 'number-fractions', seed: '', role: 'baseline' }), /seed/);
  const tampered = generateExercise({ conceptId: 'number-fractions', seed: 'x', role: 'baseline' });
  tampered.generation.parameters.a += 1;
  assert.throws(() => replayGeneratedExercise(tampered), /replay mismatch/);
});

test('signed mastery transitions are replayable, spaced, idempotent, owner-only, and tamper-evident', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-mastery-'));
  try {
    const statePath = path.join(temporary, 'mastery.json');
    const secretPath = path.join(temporary, 'mastery.hmac');
    const initialized = initializeMasteryStore({ statePath, secretPath, graph, policy, now: '2026-07-26T00:00:00.000Z' });
    assert.equal(fs.statSync(statePath).mode & 0o077, 0);
    assert.equal(fs.statSync(secretPath).mode & 0o077, 0);
    const delta = {
      schemaVersion: 'cortex.learning_os.mastery_delta.v1',
      runId: 'mastery-pass-1',
      baseRevision: 0,
      curriculumId: graph.curriculumId,
      capsuleId: graph.capsuleId,
      policyDigest: initialized.state.policyDigest,
      completedAt: '2026-07-26T00:00:01.000Z',
      events: [{
        conceptId: 'number-fractions', role: 'acquisition', passed: true,
        completedAt: '2026-07-26T00:00:01.000Z', evidenceDigest: '3'.repeat(64),
      }],
    };
    const artifactManifestDigest = '4'.repeat(64);
    const next = applyMasteryDelta({ state: initialized.state, delta, graph, policy, artifactManifestDigest });
    assert.equal(next.revision, 1);
    assert.equal(next.concepts['number-fractions'].state, 'review');
    assert.equal(next.concepts['number-fractions'].nextReviewAt, '2026-07-26T00:00:01.000Z');
    const signed = atomicWriteMasteryState(statePath, next, initialized.secret, { graph, policy });
    assert.equal(verifyMasteryState(signed, initialized.secret, { graph, policy }).ok, true);
    assert.equal(applyMasteryDelta({ state: signed, delta, graph, policy, artifactManifestDigest }).revision, 1);
    assert.throws(
      () => applyMasteryDelta({ state: signed, delta, graph, policy, artifactManifestDigest: '5'.repeat(64) }),
      /artifact receipt mismatch/,
    );
    const lapseDelta = {
      ...delta,
      runId: 'mastery-lapse-1',
      baseRevision: 1,
      completedAt: '2026-07-27T00:00:01.000Z',
      events: [{
        conceptId: 'number-fractions', role: 'spaced-review', passed: false,
        completedAt: '2026-07-27T00:00:01.000Z', evidenceDigest: '6'.repeat(64),
      }],
    };
    const lapsed = applyMasteryDelta({ state: signed, delta: lapseDelta, graph, policy, artifactManifestDigest: '6'.repeat(64) });
    assert.equal(lapsed.concepts['number-fractions'].state, 'lapsed');
    assert.equal(lapsed.concepts['number-fractions'].consecutiveFailures, 1);
    const signedLapsed = signMasteryState(lapsed, initialized.secret);
    const recoveryDelta = {
      ...delta,
      runId: 'mastery-recovery-1',
      baseRevision: 2,
      completedAt: '2026-07-27T00:01:01.000Z',
      events: [{
        conceptId: 'number-fractions', role: 'correction', passed: true,
        completedAt: '2026-07-27T00:01:01.000Z', evidenceDigest: '7'.repeat(64),
      }],
    };
    const recovered = applyMasteryDelta({ state: signedLapsed, delta: recoveryDelta, graph, policy, artifactManifestDigest: '7'.repeat(64) });
    assert.equal(recovered.concepts['number-fractions'].state, 'review');
    assert.equal(recovered.concepts['number-fractions'].consecutiveFailures, 0);
    assert.equal(recovered.concepts['number-fractions'].nextReviewAt, recoveryDelta.completedAt);
    signed.concepts['number-fractions'].lastRunId = 'tampered-after-signing';
    const tampered = verifyMasteryState(signed, initialized.secret, { graph, policy });
    assert.equal(tampered.ok, false);
    assert.ok(tampered.errors.includes('mastery signature mismatch'));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('candidate provider schema omits unsupported uniqueItems while runtime validation enforces uniqueness', () => {
  const outputSchema = read('schemas/adaptive-candidate-output.schema.json');
  assert.equal(canonicalJson(outputSchema).includes('uniqueItems'), false);
  const item = generateExercise({ conceptId: 'algebra-linear-equations', seed: 'duplicate-contraindications', role: 'acquisition' });
  const attempt = { itemId: item.itemId, answer: '0' };
  const verifier = { itemId: item.itemId, status: 'failed', score: 0, verifierResultId: 'verify-duplicate-contraindications' };
  const concept = graph.concepts.find((row) => row.conceptId === 'algebra-linear-equations');
  const fixture = fakeCandidateCaller()({ prompt: '', sessionId: 'candidate-schema-regression' });
  const candidate = buildCandidateRecord({
    output: {
      ...fixture.output,
      contraindications: ['Do not divide by zero.', 'Do not divide by zero.'],
    },
    concept,
    failedItem: item,
    attempt,
    verifier,
    provenance: fixture.provenance,
    prompt: 'candidate schema regression',
    policy,
  });
  assert.equal(candidate.status, 'quarantined');
  assert.ok(candidate.validationErrors.includes('invalid candidate contraindications'));
});

test('candidate validation rejects fabricated failures, copied templates, missing usage, and tool use', () => {
  const item = generateExercise({ conceptId: 'algebra-linear-equations', seed: 'candidate', role: 'acquisition' });
  const attempt = { itemId: item.itemId, answer: '0' };
  const verifier = { itemId: item.itemId, status: 'failed', score: 0, verifierResultId: 'verify-fixture' };
  const concept = graph.concepts.find((row) => row.conceptId === 'algebra-linear-equations');
  const output = fakeCandidateCaller()({ prompt: '', sessionId: 'x' }).output;
  const provenance = fakeCandidateCaller()({ prompt: '', sessionId: 'x' }).provenance;
  const valid = buildCandidateRecord({ output, concept, failedItem: item, attempt, verifier, provenance, prompt: 'p', policy, fixedTemplates: [] });
  assert.equal(valid.status, 'validated');
  assert.equal(buildCandidateRecord({ output, concept, failedItem: item, attempt, verifier: { ...verifier, status: 'passed', score: 1 }, provenance, prompt: 'p', policy }).status, 'quarantined');
  assert.equal(buildCandidateRecord({ output, concept, failedItem: item, attempt, verifier, provenance, prompt: 'p', policy, fixedTemplates: [output.rule] }).status, 'quarantined');
  assert.equal(buildCandidateRecord({ output, concept, failedItem: item, attempt, verifier, provenance: { ...provenance, usage: {} }, prompt: 'p', policy }).status, 'quarantined');
  assert.equal(buildCandidateRecord({ output, concept, failedItem: item, attempt, verifier, provenance: { ...provenance, toolsUsed: ['shell'] }, prompt: 'p', policy }).status, 'quarantined');
  assert.equal(buildCandidateRecord({ output: { ...output, rule: 'For algebra, this method is always valid without exception.' }, concept, failedItem: item, attempt, verifier, provenance, prompt: 'p', policy }).status, 'quarantined');
});

test('adaptive session pass produces only a replayable mastery proposal and no candidate', () => {
  const fixture = runFixture({ perfect: true });
  try {
    assert.equal(fixture.summary.status, 'candidate_mastery_delta');
    assert.equal(fixture.summary.lessonProposed, false);
    assert.equal(fs.existsSync(path.join(fixture.temporary, 'candidate/candidate.json')), false);
    const replay = verifyAdaptiveArtifacts({
      artifactRoot: fixture.temporary, graph, policy, capsule, currentMastery: fixture.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    });
    assert.equal(replay.recomputedDelta.events.length, 1);
    assert.equal(replay.liveEntry, null);
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test('signed adaptive plans enforce xhigh reasoning and replay rejects reasoning substitution', () => {
  assert.throws(() => buildAdaptiveSessionPlan({
    runId: 'adaptive-weaker-runtime', graph, policy, mastery: masteredState(), sourceCommit,
    seed: 'weaker-runtime', signingSecret: secret,
    runtimeOverride: { ...policy.modelRuntime, thinking: 'none' },
  }), /runtime override is invalid or weaker/);
  const fixture = runFixture({ perfect: true, runtimeOverride: { ...policy.modelRuntime, thinking: 'xhigh' } });
  try {
    assert.equal(fixture.plan.modelRuntime.thinking, 'xhigh');
    const options = {
      artifactRoot: fixture.temporary, graph, policy, capsule, currentMastery: fixture.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    };
    assert.equal(verifyAdaptiveArtifacts(options).recomputedDelta.events.length, 1);
    const callPath = path.join(fixture.temporary, 'observed-attempt/model_call.json');
    const call = JSON.parse(fs.readFileSync(callPath, 'utf8'));
    call.args[call.args.indexOf('--config') + 1] = 'model_reasoning_effort="low"';
    fs.writeFileSync(callPath, `${JSON.stringify(call, null, 2)}\n`);
    rewriteRootManifest(fixture.temporary);
    assert.throws(() => verifyAdaptiveArtifacts(options), /raw model runtime is not the approved/);
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test('paired threshold pass is independently recomputed while a null result installs no lesson', () => {
  const passed = runFixture({ thresholdPass: true });
  const nulled = runFixture({ thresholdPass: false });
  try {
    const passReplay = verifyAdaptiveArtifacts({
      artifactRoot: passed.temporary, graph, policy, capsule, currentMastery: passed.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    });
    assert.equal(passReplay.analysis.thresholdPassed, true);
    assert.match(passReplay.liveEntry.lessonId, /^adaptive_lesson_/);
    const nullReplay = verifyAdaptiveArtifacts({
      artifactRoot: nulled.temporary, graph, policy, capsule, currentMastery: nulled.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    });
    assert.equal(nullReplay.analysis.thresholdPassed, false);
    assert.equal(nullReplay.liveEntry, null);
    assert.equal(nulled.summary.lessonProposed, false);
  } finally {
    fs.rmSync(passed.temporary, { recursive: true, force: true });
    fs.rmSync(nulled.temporary, { recursive: true, force: true });
  }
});

test('adaptive verifier rejects delta rewrite, manifest mutation, source mismatch, and replay accepts one run only once', () => {
  const fixture = runFixture({ perfect: true });
  try {
    const options = {
      artifactRoot: fixture.temporary, graph, policy, capsule, currentMastery: fixture.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    };
    const replay = verifyAdaptiveArtifacts(options);
    const applied = signMasteryState(applyMasteryDelta({
      state: fixture.state,
      delta: replay.recomputedDelta,
      graph,
      policy,
      artifactManifestDigest: replay.artifactManifestDigest,
    }), secret);
    const repeated = verifyAdaptiveArtifacts({ ...options, currentMastery: applied });
    assert.equal(repeated.alreadyApplied, true);
    assert.equal(applyMasteryDelta({
      state: applied,
      delta: repeated.recomputedDelta,
      graph,
      policy,
      artifactManifestDigest: repeated.artifactManifestDigest,
    }).revision, applied.revision);
    const receiptSummaryPath = path.join(fixture.temporary, 'session_summary.json');
    const receiptManifestPath = path.join(fixture.temporary, 'artifact_manifest.json');
    const originalSummary = fs.readFileSync(receiptSummaryPath, 'utf8');
    const originalManifest = fs.readFileSync(receiptManifestPath, 'utf8');
    const changedSummary = JSON.parse(originalSummary);
    changedSummary.workerNote = 'same run id, different returned artifact';
    fs.writeFileSync(receiptSummaryPath, `${JSON.stringify(changedSummary, null, 2)}\n`);
    rewriteRootManifest(fixture.temporary);
    assert.throws(() => verifyAdaptiveArtifacts({ ...options, currentMastery: applied }), /artifact receipt mismatch/);
    fs.writeFileSync(receiptSummaryPath, originalSummary);
    fs.writeFileSync(receiptManifestPath, originalManifest);
    assert.throws(() => verifyAdaptiveArtifacts({ ...options, expectedSourceCommit: 'b'.repeat(40) }), /source mismatch/);

    const deltaPath = path.join(fixture.temporary, 'proposed_mastery_delta.json');
    const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'));
    delta.events[0].passed = false;
    fs.writeFileSync(deltaPath, `${JSON.stringify(delta, null, 2)}\n`);
    const manifestPath = path.join(fixture.temporary, 'artifact_manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const row = manifest.files.find((entry) => entry.path === 'proposed_mastery_delta.json');
    row.sha256 = crypto.createHash('sha256').update(fs.readFileSync(deltaPath)).digest('hex');
    row.bytes = fs.statSync(deltaPath).size;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => verifyAdaptiveArtifacts(options), /worker-rewritten mastery delta/);

    row.sha256 = '0'.repeat(64);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => verifyAdaptiveArtifacts(options), /manifest mutation/);
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test('adaptive verifier rejects fabricated no-failure candidates and artifact-level missing usage or tool use', () => {
  const perfect = runFixture({ perfect: true });
  const candidateSource = runFixture({ thresholdPass: true });
  try {
    fs.cpSync(path.join(candidateSource.temporary, 'candidate'), path.join(perfect.temporary, 'candidate'), { recursive: true });
    rewriteRootManifest(perfect.temporary);
    assert.throws(() => verifyAdaptiveArtifacts({
      artifactRoot: perfect.temporary, graph, policy, capsule, currentMastery: perfect.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    }), /fabricated no-failure candidate/);
  } finally {
    fs.rmSync(perfect.temporary, { recursive: true, force: true });
    fs.rmSync(candidateSource.temporary, { recursive: true, force: true });
  }

  for (const mutation of ['usage', 'tools', 'timing']) {
    const fixture = runFixture({ perfect: true });
    try {
      const answerPath = path.join(fixture.temporary, 'observed-attempt/answers.json');
      const answers = JSON.parse(fs.readFileSync(answerPath, 'utf8'));
      if (mutation === 'usage') answers.answerSource.usage = {};
      else if (mutation === 'tools') answers.toolsUsed = ['shell'];
      else answers.completedAt = '2099-01-01T00:00:00.000Z';
      fs.writeFileSync(answerPath, `${JSON.stringify(answers, null, 2)}\n`);
      rewriteRootManifest(fixture.temporary);
      assert.throws(() => verifyAdaptiveArtifacts({
        artifactRoot: fixture.temporary, graph, policy, capsule, currentMastery: fixture.state,
        expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
      }), mutation === 'usage' ? /missing positive model usage/ : mutation === 'tools' ? /observed tool use/ : /timing is outside/);
    } finally {
      fs.rmSync(fixture.temporary, { recursive: true, force: true });
    }
  }

  const summaryFixture = runFixture({ perfect: true });
  try {
    const summaryPath = path.join(summaryFixture.temporary, 'session_summary.json');
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    summary.status = 'candidate_lesson_and_mastery_delta';
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    rewriteRootManifest(summaryFixture.temporary);
    assert.throws(() => verifyAdaptiveArtifacts({
      artifactRoot: summaryFixture.temporary, graph, policy, capsule, currentMastery: summaryFixture.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    }), /summary overstates lesson evidence/);
  } finally {
    fs.rmSync(summaryFixture.temporary, { recursive: true, force: true });
  }

  const planFixture = runFixture({ perfect: true });
  try {
    const planPath = path.join(planFixture.temporary, 'adaptive_plan.json');
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    plan.seed = 'worker-rewritten-seed';
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    rewriteRootManifest(planFixture.temporary);
    assert.throws(() => verifyAdaptiveArtifacts({
      artifactRoot: planFixture.temporary, graph, policy, capsule, currentMastery: planFixture.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    }), /plan signature mismatch/);
  } finally {
    fs.rmSync(planFixture.temporary, { recursive: true, force: true });
  }
});

test('budget exhaustion is a bounded structured blocker without a mastery proposal', () => {
  const constrained = structuredClone(policy);
  constrained.budgets.maxModelCalls = 2;
  const fixture = runFixture({ thresholdPass: true, policyOverride: constrained });
  try {
    assert.equal(fixture.summary.status, 'structured_blocker');
    assert.equal(fixture.summary.blockerCode, 'budget_exhausted');
    assert.equal(fs.existsSync(path.join(fixture.temporary, 'proposed_mastery_delta.json')), false);
    const replay = verifyAdaptiveArtifacts({
      artifactRoot: fixture.temporary, graph, policy: constrained, capsule, currentMastery: fixture.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    });
    assert.equal(replay.recomputedDelta, null);
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test('candidate worker failure preserves independently replayable raw diagnostics', () => {
  const fixture = runFixture({
    candidateCaller: ({ sessionId }) => {
      const workerRaw = {
        command: '/fake/codex',
        args: [
          'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only',
          '--skip-git-repo-check', '--model', 'gpt-5.6-sol', '--config', 'model_reasoning_effort="xhigh"',
          '--json', '--output-schema', '/fake/adaptive-candidate-output.schema.json',
        ],
        exitCode: 1,
        signal: null,
        error: null,
        stderr: 'fixture candidate provider failure',
        events: [],
        finalText: '',
        sessionId,
      };
      throw Object.assign(new Error('candidate worker exited 1'), { workerRaw });
    },
  });
  try {
    assert.equal(fixture.summary.status, 'structured_blocker');
    assert.equal(fixture.summary.blockerCode, 'mechanical_failure');
    assert.equal(fixture.summary.workerExitCode, 1);
    assert.deepEqual(fixture.summary.diagnosticEvidenceRefs, ['candidate/model_call.json', 'candidate/model_prompt.txt']);
    assert.equal(fs.statSync(path.join(fixture.temporary, 'candidate/model_call.json')).mode & 0o077, 0);
    const raw = JSON.parse(fs.readFileSync(path.join(fixture.temporary, 'candidate/model_call.json'), 'utf8'));
    assert.equal(raw.stderr, 'fixture candidate provider failure');
    const replay = verifyAdaptiveArtifacts({
      artifactRoot: fixture.temporary, graph, policy, capsule, currentMastery: fixture.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    });
    assert.equal(replay.recomputedDelta, null);

    raw.args[raw.args.indexOf('--sandbox') + 1] = 'workspace-write';
    fs.writeFileSync(path.join(fixture.temporary, 'candidate/model_call.json'), `${JSON.stringify(raw, null, 2)}\n`);
    rewriteRootManifest(fixture.temporary);
    assert.throws(() => verifyAdaptiveArtifacts({
      artifactRoot: fixture.temporary, graph, policy, capsule, currentMastery: fixture.state,
      expectedSourceCommit: sourceCommit, fixedTemplates: [], planSecret: secret,
    }), /failed candidate diagnostic is not the approved/);
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});
