import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { buildAcquisitionStatus } from '../src/acquisition-status.mjs';
import { loadAdaptivePolicy, policyDigest } from '../src/adaptive-policy.mjs';
import { runAdaptiveSession } from '../src/adaptive-session.mjs';
import {
  buildAdditiveMasteryMigration,
  migrateAdditiveMasteryStore,
  verifyAdditiveMigrationAudit,
} from '../src/additive-mastery-migration.mjs';
import { sha256Text } from '../src/hash.mjs';
import {
  applyMasteryDelta,
  createMasteryState,
  signMasteryState,
  verifyMasteryState,
} from '../src/mastery-state.mjs';
import { buildExamPrompt } from '../src/model-answer-runner.mjs';
import {
  buildParallelWave,
  selectParallelWaveActions,
  verifyAndApplyParallelWaveFixture as verifyAndApplyParallelWave,
  verifyParallelWave,
} from '../src/parallel-wave.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const graph = read('capsules/math-foundations/curriculum.continuous-acquisition-v1.graph.json');
const capsule = read('capsules/math-foundations/capsule.json');
const { policy } = loadAdaptivePolicy(path.join(root, 'policies/adaptive-math-continuous-v1.json'));
const secret = 'parallel-acceleration-test-secret-with-at-least-forty-eight-characters';
const sourceCommit = 'a'.repeat(40);
const sourceTree = 'b'.repeat(40);

function acquiredRecord(record, timestamp) {
  Object.assign(record, {
    state: 'acquired',
    attempts: 1,
    passes: 1,
    failures: 0,
    consecutivePasses: 1,
    consecutiveFailures: 0,
    acquiredAt: timestamp,
    lastAttemptedAt: timestamp,
    lastEvidenceDigest: '1'.repeat(64),
    lastRunId: 'fixture-acquired',
    nextReviewAt: null,
  });
}

function resetRecord(record) {
  Object.assign(record, {
    state: 'unassessed',
    attempts: 0,
    passes: 0,
    failures: 0,
    consecutivePasses: 0,
    consecutiveFailures: 0,
    acquiredAt: null,
    lastAttemptedAt: null,
    lastReviewedAt: null,
    historicalNextReviewAt: null,
    nextReviewAt: null,
    lastEvidenceDigest: null,
    lastRunId: null,
  });
}

function waveState({ selectedCount = 4, now = new Date(Date.now() - 60_000).toISOString() } = {}) {
  const state = createMasteryState({ graph, policy, now });
  for (const record of Object.values(state.concepts)) acquiredRecord(record, now);
  const roots = graph.concepts.filter((concept) => concept.prerequisites.length === 0)
    .slice(0, selectedCount).map((concept) => concept.conceptId);
  for (const conceptId of roots) resetRecord(state.concepts[conceptId]);
  return { state: signMasteryState(state, secret), roots, now };
}

function buildWaveFixture({ concurrency = 4, selectedCount = concurrency } = {}) {
  const fixture = waveState({ selectedCount });
  const wave = buildParallelWave({
    waveId: `wave-fixture-${concurrency}-${selectedCount}`,
    graph,
    policy,
    capsule,
    state: fixture.state,
    sourceCommit,
    sourceTree,
    seed: 'wave-fixture-seed',
    concurrency,
    signingSecret: secret,
    now: fixture.now,
    expiresAt: new Date(Date.parse(fixture.now) + 60 * 60 * 1000).toISOString(),
  });
  return { ...fixture, wave };
}

function fakeExamCaller(start, { observedPass = true, correctionPass = true } = {}) {
  let call = 0;
  return ({ exam, learningContext, evidenceRole, sessionId, runId }) => {
    call += 1;
    const item = exam.items[0];
    const passed = evidenceRole === 'correction' ? correctionPass : observedPass;
    const answer = passed
      ? (Array.isArray(item.checker.expected) ? item.checker.expected.join(',') : String(item.checker.expected))
      : '__wrong__';
    const completedAt = new Date(Date.parse(start) + call * 1000).toISOString();
    const usage = { input_tokens: 12, output_tokens: 2 };
    const answerSet = {
      schemaVersion: 'cortex.learning_os.answer_set.v0',
      runId,
      answers: [{ itemId: item.itemId, answer }],
      answerSource: {
        kind: 'codex_exec_ephemeral',
        provider: 'openai-codex',
        model: policy.modelRuntime.model,
        sessionId,
        usage,
      },
      evidenceRole,
      toolsUsed: [],
      startedAt: new Date(Date.parse(completedAt) - 100).toISOString(),
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
        events: [{ type: 'turn.completed', usage }],
      },
    };
  };
}

function fakeCandidateCaller(start) {
  return ({ prompt, sessionId }) => {
    const output = {
      rule: 'Translate the prompt into explicit symbolic constraints, apply one valid operation at a time, and check the result in the original statement.',
      scope: 'The named bounded concept and deterministic exercise family.',
      contraindications: ['Do not assume a cancelled quantity is nonzero.', 'Do not extend the conclusion beyond the stated constraints.'],
      likelyRootCause: 'A constraint or inverse operation was not carried through consistently.',
    };
    const usage = { input_tokens: 24, output_tokens: 8 };
    return {
      output,
      completedAt: new Date(Date.parse(start) + 2000).toISOString(),
      provenance: {
        kind: 'codex_exec_ephemeral',
        provider: 'openai-codex',
        model: policy.modelRuntime.model,
        sessionId,
        usage,
        toolsUsed: [],
        runtimeMs: 5,
      },
      raw: {
        command: '/fixture/codex',
        args: [
          'exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
          '--model', policy.modelRuntime.model, '--config', 'model_reasoning_effort="xhigh"',
          '--json', '--output-schema', '/fixture/schema.json',
        ],
        exitCode: 0,
        sessionId,
        finalText: JSON.stringify(output),
        events: [{ type: 'turn.completed', usage }],
      },
      prompt,
    };
  };
}

function runWaveChildren(wave, { learningFailureIndex = -1 } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-parallel-wave-'));
  const artifactRoots = new Map();
  for (const [index, selected] of wave.selected.entries()) {
    const childRoot = path.join(temporary, selected.child.artifactRelativeRoot);
    artifactRoots.set(selected.child.runId, childRoot);
    const learningFailure = index === learningFailureIndex;
    const summary = runAdaptiveSession({
      plan: selected.child.sessionPlan,
      graph,
      policy,
      capsule,
      artifactRoot: childRoot,
      sourceCommit,
      fixedTemplates: [],
      callExam: fakeExamCaller(wave.generatedAt, {
        observedPass: !learningFailure,
        correctionPass: false,
      }),
      callCandidate: fakeCandidateCaller(wave.generatedAt),
    });
    assert.notEqual(summary.status, 'structured_blocker');
  }
  return { temporary, artifactRoots };
}

function rewriteManifest(artifactRoot) {
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

test('parallel selection is deterministic, bounded, prerequisite-ready, disjoint, and never selects review work', () => {
  const { state } = waveState({ selectedCount: 8 });
  for (const concurrency of [1, 4, 8]) {
    const first = selectParallelWaveActions({ graph, state, policy, seed: 'deterministic', concurrency });
    const second = selectParallelWaveActions({ graph, state, policy, seed: 'deterministic', concurrency });
    assert.deepEqual(first, second);
    assert.equal(first.length, concurrency);
    assert.equal(first.every((action) => ['acquisition', 'correction'].includes(action.role)), true);
    assert.equal(first.some((action) => /review/.test(`${action.kind}:${action.role}`)), false);
    for (const action of first) {
      const concept = graph.concepts.find((row) => row.conceptId === action.conceptId);
      assert.equal(concept.prerequisites.every((id) => state.concepts[id].state === 'acquired'), true);
    }
    const footprints = first.flatMap((action) => [action.conceptId, action.blockedConceptId].filter(Boolean));
    assert.equal(new Set(footprints).size, footprints.length);
  }
  for (const invalid of [0, 9, 1.5]) {
    assert.throws(
      () => selectParallelWaveActions({ graph, state, policy, concurrency: invalid }),
      /concurrency must be 1..8/,
    );
  }

  const repairState = structuredClone(state);
  const failed = 'functions-inverse';
  for (const prerequisite of graph.concepts.find((row) => row.conceptId === failed).prerequisites) {
    resetRecord(repairState.concepts[prerequisite]);
  }
  repairState.pendingRepairs = [{ failedConceptId: failed, evidenceDigest: '2'.repeat(64), runId: 'failed-run' }];
  const repair = selectParallelWaveActions({
    graph,
    state: signMasteryState({ ...repairState, signature: undefined }, secret),
    policy,
    concurrency: 4,
  }).find((action) => action.blockedConceptId === failed);
  assert.ok(repair);
  const repairConcept = graph.concepts.find((row) => row.conceptId === repair.conceptId);
  assert.equal(repairConcept.prerequisites.every((id) => repairState.concepts[id].state === 'acquired'), true);
});

test('signed wave freezes exact identities, records, generated bytes, xhigh children, expiry, and merge order without exposing the HMAC secret', () => {
  const { wave, state } = buildWaveFixture();
  assert.equal(verifyParallelWave({
    wave,
    graph,
    policy,
    capsule,
    signingSecret: secret,
    expectedSourceCommit: sourceCommit,
    expectedSourceTree: sourceTree,
    now: wave.generatedAt,
  }), true);
  assert.equal(wave.concurrency, 4);
  assert.equal(wave.identities.state.baseRevision, state.revision);
  assert.equal(wave.identities.state.sha256, sha256Text(canonicalJson(state)));
  assert.deepEqual(wave.mergeOrder, wave.selected.map((row) => row.child.runId));
  assert.equal(canonicalJson(wave).includes(secret), false);
  for (const row of wave.selected) {
    assert.equal(row.child.modelRuntime.thinking, 'xhigh');
    assert.deepEqual(row.child.constraints, {
      executionPlane: 'hetzner',
      detached: true,
      sandbox: 'read-only',
      toolsAllowed: false,
      hmacSecretAvailable: false,
    });
    assert.equal(row.generated.observed.itemSha256, sha256Text(row.generated.observed.itemBytes));
    assert.equal(row.generated.observed.oracleSha256, sha256Text(row.generated.observed.oracleBytes));
  }
  assert.throws(() => verifyParallelWave({
    wave,
    graph,
    policy,
    capsule,
    signingSecret: secret,
    expectedSourceCommit: sourceCommit,
    expectedSourceTree: sourceTree,
    now: new Date(Date.parse(wave.expiresAt) + 1).toISOString(),
  }), /expired/);
  const tampered = structuredClone(wave);
  tampered.selected[0].sourceConceptRecord.attempts += 1;
  assert.throws(() => verifyParallelWave({
    wave: tampered,
    graph,
    policy,
    capsule,
    signingSecret: secret,
    expectedSourceCommit: sourceCommit,
    expectedSourceTree: sourceTree,
    now: wave.generatedAt,
  }), /signature mismatch/);
});

test('all child evidence is replayed before one deterministic atomic merge; replay is idempotent', () => {
  const { wave, state } = buildWaveFixture();
  const artifacts = runWaveChildren(wave);
  try {
    const result = verifyAndApplyParallelWave({
      wave,
      artifactRoots: artifacts.artifactRoots,
      graph,
      policy,
      capsule,
      currentState: state,
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: wave.generatedAt,
    });
    assert.equal(result.applied, true);
    assert.equal(result.state.revision, state.revision + 1);
    assert.deepEqual(result.state.appliedRunIds, wave.mergeOrder);
    assert.deepEqual(
      result.state.appliedRunReceipts.map((row) => row.runId),
      wave.mergeOrder,
    );
    const signed = signMasteryState(result.state, secret);
    assert.equal(verifyMasteryState(signed, secret, { graph, policy }).ok, true);
    const repeated = verifyAndApplyParallelWave({
      wave,
      artifactRoots: artifacts.artifactRoots,
      graph,
      policy,
      capsule,
      currentState: signed,
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: wave.generatedAt,
    });
    assert.equal(repeated.applied, false);
    assert.equal(repeated.alreadyApplied, true);
    assert.equal(repeated.state.revision, signed.revision);
    const expiredReplay = verifyAndApplyParallelWave({
      wave,
      artifactRoots: artifacts.artifactRoots,
      graph,
      policy,
      capsule,
      currentState: signed,
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: new Date(Date.parse(wave.expiresAt) + 1000).toISOString(),
    });
    assert.equal(expiredReplay.alreadyApplied, true);
    const substitutedRoot = artifacts.artifactRoots.get(wave.mergeOrder[0]);
    const summaryPath = path.join(substitutedRoot, 'session_summary.json');
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    summary.substitution = 'same runId, different artifact bytes';
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    rewriteManifest(substitutedRoot);
    assert.throws(() => verifyAndApplyParallelWave({
      wave,
      artifactRoots: artifacts.artifactRoots,
      graph,
      policy,
      capsule,
      currentState: signed,
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: wave.generatedAt,
    }), /artifact receipt mismatch|artifact substitution/);
  } finally {
    fs.rmSync(artifacts.temporary, { recursive: true, force: true });
  }
});

test('stale unrelated revision advancement is accepted while selected-record, repair, and partial-application conflicts fail closed', () => {
  const { wave, state } = buildWaveFixture({ concurrency: 2, selectedCount: 2 });
  const artifacts = runWaveChildren(wave);
  try {
    const footprints = new Set(wave.selected.flatMap((row) => row.footprintConceptIds));
    const unrelated = graph.concepts.find((concept) => !footprints.has(concept.conceptId)).conceptId;
    const completedAt = new Date(Date.parse(wave.generatedAt) + 5000).toISOString();
    const unrelatedState = signMasteryState(applyMasteryDelta({
      state,
      graph,
      policy,
      artifactManifestDigest: '3'.repeat(64),
      delta: {
        schemaVersion: 'cortex.learning_os.mastery_delta.v2',
        runId: 'unrelated-disjoint-run',
        baseRevision: state.revision,
        curriculumId: graph.curriculumId,
        capsuleId: graph.capsuleId,
        policyDigest: policyDigest(policy),
        completedAt,
        events: [{
          conceptId: unrelated,
          role: 'acquisition',
          passed: true,
          completedAt,
          evidenceDigest: '4'.repeat(64),
        }],
      },
    }), secret);
    const accepted = verifyAndApplyParallelWave({
      wave,
      artifactRoots: artifacts.artifactRoots,
      graph,
      policy,
      capsule,
      currentState: unrelatedState,
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: wave.generatedAt,
    });
    assert.equal(accepted.state.revision, unrelatedState.revision + 1);
    assert.equal(accepted.state.concepts[unrelated].attempts, unrelatedState.concepts[unrelated].attempts);

    const selectedId = wave.selected[0].action.conceptId;
    const overlapping = structuredClone(unrelatedState);
    overlapping.concepts[selectedId].attempts += 1;
    overlapping.concepts[selectedId].failures += 1;
    overlapping.concepts[selectedId].state = 'learning';
    overlapping.concepts[selectedId].lastAttemptedAt = completedAt;
    overlapping.concepts[selectedId].lastEvidenceDigest = '5'.repeat(64);
    overlapping.concepts[selectedId].lastRunId = 'overlap';
    assert.throws(() => verifyAndApplyParallelWave({
      wave,
      artifactRoots: artifacts.artifactRoots,
      graph,
      policy,
      capsule,
      currentState: signMasteryState({ ...overlapping, signature: undefined }, secret),
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: wave.generatedAt,
    }), /selected concept record is stale/);

    const repairConflict = structuredClone(unrelatedState);
    repairConflict.pendingRepairs.push({
      failedConceptId: selectedId,
      evidenceDigest: '6'.repeat(64),
      runId: 'unrelated-repair',
    });
    assert.throws(() => verifyAndApplyParallelWave({
      wave,
      artifactRoots: artifacts.artifactRoots,
      graph,
      policy,
      capsule,
      currentState: signMasteryState({ ...repairConflict, signature: undefined }, secret),
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: wave.generatedAt,
    }), /repair record is stale/);

    const fullyApplied = signMasteryState(accepted.state, secret);
    const partial = structuredClone(fullyApplied);
    partial.appliedRunIds.pop();
    partial.appliedRunReceipts.pop();
    assert.throws(() => verifyAndApplyParallelWave({
      wave,
      artifactRoots: artifacts.artifactRoots,
      graph,
      policy,
      capsule,
      currentState: signMasteryState({ ...partial, signature: undefined }, secret),
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: wave.generatedAt,
    }), /partial prior application/);
  } finally {
    fs.rmSync(artifacts.temporary, { recursive: true, force: true });
  }
});

test('source, manifest, plan, provider, usage, and no-tools tampering reject the entire wave without mutating input state', () => {
  const mutations = [
    {
      expected: /child plan differs|signature/,
      apply(root) {
        const planPath = path.join(root, 'adaptive_plan.json');
        const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
        plan.seed = 'substituted-seed';
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
        rewriteManifest(root);
      },
    },
    {
      expected: /source.*mismatch/,
      source: 'c'.repeat(40),
    },
    {
      expected: /manifest mutation/,
      apply(root) {
        const manifestPath = path.join(root, 'artifact_manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.files[0].sha256 = '0'.repeat(64);
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    },
    {
      expected: /source mismatch or incomplete model provenance/,
      apply(root) {
        const target = path.join(root, 'observed-attempt/answers.json');
        const answers = JSON.parse(fs.readFileSync(target, 'utf8'));
        answers.answerSource.provider = 'synthetic-provider';
        fs.writeFileSync(target, `${JSON.stringify(answers, null, 2)}\n`);
        rewriteManifest(root);
      },
    },
    {
      expected: /missing positive model usage/,
      apply(root) {
        const target = path.join(root, 'observed-attempt/answers.json');
        const answers = JSON.parse(fs.readFileSync(target, 'utf8'));
        answers.answerSource.usage = {};
        fs.writeFileSync(target, `${JSON.stringify(answers, null, 2)}\n`);
        rewriteManifest(root);
      },
    },
    {
      expected: /observed tool use/,
      apply(root) {
        const target = path.join(root, 'observed-attempt/answers.json');
        const answers = JSON.parse(fs.readFileSync(target, 'utf8'));
        answers.toolsUsed = ['shell'];
        fs.writeFileSync(target, `${JSON.stringify(answers, null, 2)}\n`);
        rewriteManifest(root);
      },
    },
  ];
  for (const mutation of mutations) {
    const { wave, state } = buildWaveFixture({ concurrency: 1, selectedCount: 1 });
    const artifacts = runWaveChildren(wave);
    try {
      const childRoot = artifacts.artifactRoots.get(wave.mergeOrder[0]);
      mutation.apply?.(childRoot);
      const before = canonicalJson(state);
      assert.throws(() => verifyAndApplyParallelWave({
        wave,
        artifactRoots: artifacts.artifactRoots,
        graph,
        policy,
        capsule,
        currentState: state,
        signingSecret: secret,
        expectedSourceCommit: mutation.source || sourceCommit,
        expectedSourceTree: sourceTree,
        allowTestFixtures: true,
        now: wave.generatedAt,
      }), mutation.expected);
      assert.equal(canonicalJson(state), before);
    } finally {
      fs.rmSync(artifacts.temporary, { recursive: true, force: true });
    }
  }
});

test('genuine learning failure is merged with successful disjoint evidence, while missing infrastructure evidence causes no partial mutation', () => {
  const { wave, state } = buildWaveFixture({ concurrency: 2, selectedCount: 2 });
  const artifacts = runWaveChildren(wave, { learningFailureIndex: 1 });
  try {
    const result = verifyAndApplyParallelWave({
      wave,
      artifactRoots: artifacts.artifactRoots,
      graph,
      policy,
      capsule,
      currentState: state,
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: wave.generatedAt,
    });
    assert.equal(result.state.concepts[wave.selected[0].action.conceptId].state, 'acquired');
    assert.equal(result.state.concepts[wave.selected[1].action.conceptId].state, 'learning');
    assert.equal(result.state.revision, state.revision + 1);

    const missing = new Map(artifacts.artifactRoots);
    missing.delete(wave.mergeOrder[1]);
    const before = canonicalJson(state);
    assert.throws(() => verifyAndApplyParallelWave({
      wave,
      artifactRoots: missing,
      graph,
      policy,
      capsule,
      currentState: state,
      signingSecret: secret,
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      allowTestFixtures: true,
      now: wave.generatedAt,
    }), /artifact root missing/);
    assert.equal(canonicalJson(state), before);
  } finally {
    fs.rmSync(artifacts.temporary, { recursive: true, force: true });
  }
});

function migrationFixture() {
  const now = new Date(Date.now() - 120_000).toISOString();
  const state = createMasteryState({ graph, policy, now });
  state.revision = 9;
  acquiredRecord(state.concepts['number-fractions'], now);
  state.pendingRepairs = [{
    failedConceptId: 'algebra-factoring',
    evidenceDigest: '7'.repeat(64),
    runId: 'prior-run',
  }];
  state.appliedRunIds = ['prior-run'];
  state.appliedRunReceipts = [{ runId: 'prior-run', artifactManifestDigest: '8'.repeat(64) }];
  state.migration = {
    schemaVersion: 'cortex.learning_os.mastery_migration_receipt.v1',
    migrationId: 'prior-v1-to-v2',
    sourceRevision: 0,
    targetRevision: 1,
    sourceStateDigest: '1'.repeat(64),
    sourcePolicyDigest: '2'.repeat(64),
    sourceCurriculumDigest: '3'.repeat(64),
    targetPolicyDigest: '4'.repeat(64),
    targetCurriculumDigest: '5'.repeat(64),
    migratedAt: now,
  };
  const sourceState = signMasteryState(state, secret);
  const targetGraph = structuredClone(graph);
  targetGraph.concepts.push({
    conceptId: 'future-phd-interface-concept',
    title: 'Deployment-supplied future concept',
    category: 'integration-interface',
    prerequisites: ['reasoning-truth-boundary'],
    outcomes: ['Integration supplies the formal graph and qualification assets.'],
  });
  const targetPolicy = structuredClone(policy);
  const expected = {
    expectedSourceRevision: sourceState.revision,
    expectedSourceStateDigest: sha256Text(canonicalJson(sourceState)),
    expectedSourceGraphDigest: sha256Text(canonicalJson(graph)),
    expectedSourcePolicyDigest: policyDigest(policy),
    expectedTargetGraphDigest: sha256Text(canonicalJson(targetGraph)),
    expectedTargetPolicyDigest: policyDigest(targetPolicy),
    sourceCommit,
    expectedSourceCommit: sourceCommit,
    sourceTree,
    expectedSourceTree: sourceTree,
    now: new Date(Date.parse(now) + 60_000).toISOString(),
  };
  return { sourceState, targetGraph, targetPolicy, expected };
}

test('additive v2 migration preserves all evidence and prior receipts byte-for-byte, adds only unassessed records, and advances once', () => {
  const fixture = migrationFixture();
  const built = buildAdditiveMasteryMigration({
    sourceState: fixture.sourceState,
    secret,
    sourceGraph: graph,
    sourcePolicy: policy,
    targetGraph: fixture.targetGraph,
    targetPolicy: fixture.targetPolicy,
    ...fixture.expected,
  });
  assert.equal(built.targetState.revision, fixture.sourceState.revision + 1);
  assert.equal(built.targetState.updatedAt, fixture.expected.now);
  for (const conceptId of Object.keys(fixture.sourceState.concepts)) {
    assert.equal(canonicalJson(built.targetState.concepts[conceptId]), canonicalJson(fixture.sourceState.concepts[conceptId]));
  }
  assert.equal(
    canonicalJson(built.targetState.concepts['future-phd-interface-concept']),
    canonicalJson(createMasteryState({ graph: fixture.targetGraph, policy: fixture.targetPolicy }).concepts['future-phd-interface-concept']),
  );
  for (const field of ['pendingRepairs', 'appliedRunIds', 'appliedRunReceipts', 'migration']) {
    assert.equal(canonicalJson(built.targetState[field]), canonicalJson(fixture.sourceState[field]), field);
  }
  assert.equal(built.targetState.graphMigrations.length, 1);
  assert.equal(verifyAdditiveMigrationAudit(built.audit, secret), true);
  const tamperedAudit = structuredClone(built.audit);
  tamperedAudit.addedConceptIds.push('fabricated-audit-concept');
  assert.equal(verifyAdditiveMigrationAudit(tamperedAudit, secret), false);
  assert.equal(verifyMasteryState(signMasteryState(built.targetState, secret), secret, {
    graph: fixture.targetGraph,
    policy: fixture.targetPolicy,
  }).ok, true);
  const status = buildAcquisitionStatus({ state: signMasteryState(built.targetState, secret), graph: fixture.targetGraph });
  assert.equal(status.acquiredOnce.conceptIds.includes('number-fractions'), true);
  assert.equal(status.learningOrCorrection.conceptIds.includes('algebra-factoring'), true);
  assert.equal(status.unassessed.conceptIds.includes('future-phd-interface-concept'), true);
  assert.equal(status.formalQualification.ownership, 'external_integration');
  assert.equal(status.reviewSelectionEnabled, false);
  assert.doesNotMatch(canonicalJson(status), /mastered|retained/);
});

test('additive migration rejects removal, rewrite, repetition, bad signature, stale freeze, and non-monotonic time; store audit is owner-only', () => {
  const fixture = migrationFixture();
  const options = {
    sourceState: fixture.sourceState,
    secret,
    sourceGraph: graph,
    sourcePolicy: policy,
    targetGraph: fixture.targetGraph,
    targetPolicy: fixture.targetPolicy,
    ...fixture.expected,
  };
  const removed = structuredClone(fixture.targetGraph);
  const prerequisiteIds = new Set(removed.concepts.flatMap((concept) => concept.prerequisites));
  const removable = graph.concepts.find((concept) => !prerequisiteIds.has(concept.conceptId)).conceptId;
  removed.concepts = removed.concepts.filter((concept) => concept.conceptId !== removable);
  assert.throws(() => buildAdditiveMasteryMigration({
    ...options,
    targetGraph: removed,
    expectedTargetGraphDigest: sha256Text(canonicalJson(removed)),
  }), /removes source concepts/);
  const rewritten = structuredClone(fixture.targetGraph);
  rewritten.concepts.find((concept) => concept.conceptId === 'number-fractions').title = 'rewrite';
  assert.throws(() => buildAdditiveMasteryMigration({
    ...options,
    targetGraph: rewritten,
    expectedTargetGraphDigest: sha256Text(canonicalJson(rewritten)),
  }), /rewrites source concepts/);
  const tampered = structuredClone(fixture.sourceState);
  tampered.concepts['number-fractions'].passes += 1;
  assert.throws(() => buildAdditiveMasteryMigration({
    ...options,
    sourceState: tampered,
    expectedSourceStateDigest: sha256Text(canonicalJson(tampered)),
  }), /signature or state invalid/);
  assert.throws(() => buildAdditiveMasteryMigration({
    ...options,
    expectedSourceRevision: fixture.sourceState.revision + 1,
  }), /source revision mismatch/);
  assert.throws(() => buildAdditiveMasteryMigration({
    ...options,
    now: new Date(Date.parse(fixture.sourceState.updatedAt) - 1).toISOString(),
  }), /non-monotonic/);
  const built = buildAdditiveMasteryMigration(options);
  const repeatedSource = signMasteryState(built.targetState, secret);
  assert.throws(() => buildAdditiveMasteryMigration({
    ...options,
    sourceState: repeatedSource,
    sourceGraph: fixture.targetGraph,
    sourcePolicy: fixture.targetPolicy,
    expectedSourceRevision: repeatedSource.revision,
    expectedSourceStateDigest: sha256Text(canonicalJson(repeatedSource)),
    expectedSourceGraphDigest: sha256Text(canonicalJson(fixture.targetGraph)),
  }), /adds no new concepts|already applied/);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-additive-migration-'));
  try {
    const statePath = path.join(temporary, 'mastery.json');
    const secretPath = path.join(temporary, 'mastery.hmac');
    const auditPath = path.join(temporary, 'audit.json');
    fs.writeFileSync(statePath, `${JSON.stringify(fixture.sourceState, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    const stored = migrateAdditiveMasteryStore({
      statePath,
      secretPath,
      auditPath,
      sourceGraph: graph,
      sourcePolicy: policy,
      targetGraph: fixture.targetGraph,
      targetPolicy: fixture.targetPolicy,
      ...fixture.expected,
    });
    assert.equal(stored.state.revision, fixture.sourceState.revision + 1);
    assert.equal(fs.statSync(statePath).mode & 0o077, 0);
    assert.equal(fs.statSync(auditPath).mode & 0o077, 0);
    assert.equal(verifyAdditiveMigrationAudit(JSON.parse(fs.readFileSync(auditPath, 'utf8')), secret), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  for (const crashPhase of ['state_written', 'audit_written']) {
    const recoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `clos-additive-recovery-${crashPhase}-`));
    try {
      const statePath = path.join(recoveryRoot, 'mastery.json');
      const secretPath = path.join(recoveryRoot, 'mastery.hmac');
      const auditPath = path.join(recoveryRoot, 'audit.json');
      const journalPath = `${auditPath}.transaction.json`;
      fs.writeFileSync(statePath, `${JSON.stringify(fixture.sourceState, null, 2)}\n`, { mode: 0o600 });
      fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
      const migrationOptions = {
        statePath,
        secretPath,
        auditPath,
        sourceGraph: graph,
        sourcePolicy: policy,
        targetGraph: fixture.targetGraph,
        targetPolicy: fixture.targetPolicy,
        ...fixture.expected,
      };
      assert.throws(() => migrateAdditiveMasteryStore({
        ...migrationOptions,
        onPhase: (phase) => {
          if (phase === crashPhase) throw new Error(`simulated process loss after ${phase}`);
        },
      }), /simulated process loss/);
      assert.equal(fs.existsSync(journalPath), true);
      const recovered = migrateAdditiveMasteryStore(migrationOptions);
      assert.equal(recovered.state.revision, fixture.sourceState.revision + 1);
      assert.equal(verifyAdditiveMigrationAudit(recovered.audit, secret), true);
      assert.equal(fs.existsSync(auditPath), true);
      const replay = migrateAdditiveMasteryStore(migrationOptions);
      assert.equal(replay.alreadyApplied, true);
    } finally {
      fs.rmSync(recoveryRoot, { recursive: true, force: true });
    }
  }

  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-additive-legacy-audit-first-'));
  try {
    const statePath = path.join(legacyRoot, 'mastery.json');
    const secretPath = path.join(legacyRoot, 'mastery.hmac');
    const auditPath = path.join(legacyRoot, 'audit.json');
    const frozen = buildAdditiveMasteryMigration(options);
    fs.writeFileSync(statePath, `${JSON.stringify(fixture.sourceState, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    fs.writeFileSync(auditPath, `${JSON.stringify(frozen.audit, null, 2)}\n`, { mode: 0o600 });
    const recovered = migrateAdditiveMasteryStore({
      statePath,
      secretPath,
      auditPath,
      sourceGraph: graph,
      sourcePolicy: policy,
      targetGraph: fixture.targetGraph,
      targetPolicy: fixture.targetPolicy,
      ...fixture.expected,
      now: new Date(Date.parse(fixture.expected.now) + 60_000).toISOString(),
    });
    assert.equal(recovered.state.revision, fixture.sourceState.revision + 1);
    assert.equal(canonicalJson(recovered.audit), canonicalJson(frozen.audit));
    assert.equal(fs.existsSync(`${auditPath}.transaction.json`), true);
  } finally {
    fs.rmSync(legacyRoot, { recursive: true, force: true });
  }
});

test('parallel launchers and supervisor keep all Codex work detached on Hetzner with acquisition-only defaults', () => {
  const waveLauncher = fs.readFileSync(path.join(root, 'scripts/launch-parallel-adaptive-wave.sh'), 'utf8');
  const child = fs.readFileSync(path.join(root, 'scripts/remote-parallel-adaptive-child.sh'), 'utf8');
  const harvester = fs.readFileSync(path.join(root, 'scripts/harvest-parallel-adaptive-wave.py'), 'utf8');
  const continuation = fs.readFileSync(path.join(root, 'scripts/continue_parallel_adaptive_math.py'), 'utf8');
  const continuationLauncher = fs.readFileSync(path.join(root, 'scripts/launch-parallel-adaptive-continuation.sh'), 'utf8');
  assert.match(waveLauncher, /CONCURRENCY=4/);
  assert.match(waveLauncher, /concurrent detached Hetzner Codex children/);
  assert.match(waveLauncher, /--property=User=jake --property=Group=jake/);
  assert.match(waveLauncher, /SOURCE_TREE=.*rev-parse/);
  assert.match(waveLauncher, /systemd-run/);
  assert.match(child, /PLAN_SANDBOX.*read-only/s);
  assert.match(child, /toolsAllowed/);
  assert.match(child, /curriculum[.]phd-trajectory-v1[.]graph[.]json/);
  assert.match(child, /adaptive-math-phd-v1[.]json/);
  assert.doesNotMatch(child, /mastery[.]hmac|HMAC/);
  assert.match(harvester, /all children independently replayed and merged in one atomic signed state update/);
  assert.match(harvester, /time[.]sleep\(max\(5[.]0, args[.]poll_seconds\)\)/);
  assert.match(continuation, /max-waves/);
  assert.match(continuation, /max-sessions/);
  assert.match(continuation, /curriculum_frontier_reached/);
  assert.match(continuation, /reviewSelectionEnabled/);
  assert.match(continuation, /concurrent detached Hetzner Codex children/);
  assert.match(continuation, /curriculum[.]phd-trajectory-v1[.]graph[.]json/);
  assert.match(continuation, /adaptive-math-phd-v1[.]json/);
  assert.doesNotMatch(continuation, /spaced.review|nextReviewAt|shadow/i);
  assert.match(continuationLauncher, /Restart=on-failure/);
  assert.match(continuationLauncher, /detached_job_notifier[.]py/);
});
