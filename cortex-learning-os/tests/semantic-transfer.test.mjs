import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  emptyTransferRegistry,
  signTransferRegistry,
  verifyTransferRegistry,
} from '../../plugins/cortex-learning-os-live/transfer-registry.mjs';
import { routeCodingTransfer } from '../../plugins/cortex-learning-os-live/transfer.mjs';
import { readJson } from '../src/json.mjs';
import { sha256Text } from '../src/hash.mjs';
import { CLOS_ROOT } from '../src/paths.mjs';
import { buildTransferQualificationPlan, replayTransferQualification } from '../src/transfer-qualification.mjs';
import { loadAllTransferProfiles, loadTransferProfile, validateTransferProfile } from '../src/transfer-profiles.mjs';
import {
  applyTransferQualification,
  createTransferState,
  signTransferState,
  verifyTransferState,
} from '../src/transfer-state.mjs';
import { generateTransferTasks, replayTransferOracle } from '../src/transfer-tasks.mjs';
import { buildInertTransferProposal } from '../src/transfer-worker-proposal.mjs';

const secret = 'transfer-test-secret-that-is-at-least-thirty-two-bytes';
const graph = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/curriculum.graph.json'));
const policy = readJson(path.join(CLOS_ROOT, 'policies/coding-transfer-v0.9.json'));
const profiles = loadAllTransferProfiles({ graph });

function attemptFor(plan, task, arm, result, index) {
  const payload = {
    schemaVersion: 'cortex.learning_os.transfer_attempt.v1',
    attemptId: `${plan.runId}:${arm}:${index}`,
    runId: plan.runId,
    profileId: plan.profileId,
    taskId: task.taskId,
    taskDigest: task.taskDigest,
    family: task.family,
    arm,
    valid: true,
    validityReasonCode: 'worker-proposed',
    semanticDecision: {
      applicable: false,
      reasonCodes: ['worker-proposed'],
      observedAssumptionCodes: [],
      negativeGateCodes: [],
    },
    oracle: {
      oracleId: task.oracleId,
      executed: false,
      passed: false,
      resultDigest: '0'.repeat(64),
    },
    result,
    startedAt: '2026-07-26T10:00:00.000Z',
    completedAt: '2026-07-26T10:00:01.000Z',
  };
  return { ...payload, evidenceDigest: '0'.repeat(64) };
}

function qualificationArtifacts({ noTransferFailures = 4, runId, providerEvidence = true }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-transfer-'));
  const profile = loadTransferProfile('exact-multiplication', { graph });
  const tasks = generateTransferTasks(profile, { seed: runId });
  const runtime = {
    schemaVersion: 'cortex.learning_os.transfer_runtime.v1',
    provider: 'test-fixture', runner: 'fake-transfer-model', model: 'fake-model-v1',
    reasoningEffort: 'xhigh', sandbox: 'read-only', toolsAllowed: false,
  };
  const plan = buildTransferQualificationPlan({
    runId,
    profile,
    policy,
    tasks,
    sourceCommit: profile.source.baseCommit,
    signingSecret: secret,
    runtime,
    generatedAt: '2026-07-26T09:00:00.000Z',
  });
  let failed = 0;
  const attempts = tasks.flatMap((task, index) => {
    const correct = task.oracleId === 'exact-integer-product-v1' ? task.expected : '';
    let baseline = correct;
    if (task.oracleId === 'exact-integer-product-v1' && failed < noTransferFailures) {
      baseline = 'incorrect';
      failed += 1;
    }
    return [
      attemptFor(plan, task, 'candidate', correct, index),
      attemptFor(plan, task, 'no-transfer', baseline, index),
    ];
  });
  const providerCalls = attempts.map((attempt, index) => ({
    callId: attempt.attemptId,
    taskId: attempt.taskId,
    arm: attempt.arm,
    provider: runtime.provider,
    model: 'fake-model-v1',
    commandIdentity: { executable: 'fake-transfer-model', argvDigest: 'a'.repeat(64) },
    runtimeContractDigest: sha256Text(canonicalJson(runtime)),
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    runtimeMs: 1000,
    exitStatus: 0,
    usage: { input_tokens: 100 + index, output_tokens: 1, cached_input_tokens: 0, total_tokens: 101 + index },
  }));
  buildInertTransferProposal({
    artifactRoot: root,
    plan,
    tasks,
    attempts,
    providerCalls: providerEvidence ? providerCalls : null,
    completedAt: '2026-07-26T11:00:00.000Z',
  });
  return { root, profile, tasks, plan };
}

test('profiles are strict, digest-bound declarations rather than qualifications', () => {
  assert.equal(profiles.length, 2);
  for (const profile of profiles) assert.equal(validateTransferProfile(profile, { conceptIds: new Set(graph.concepts.map((row) => row.conceptId)) }).ok, true);
  assert.equal(validateTransferProfile({ ...profiles[0], unexpected: true }).ok, false);
  assert.match(profiles[0].truthBoundary, /not checked in as qualified/);
});

test('all 36 concepts initialize separately from mastery with only two declared surfaces unassessed', () => {
  const state = createTransferState({ graph, policy, profiles, now: '2026-07-26T08:00:00.000Z' });
  assert.equal(Object.keys(state.concepts).length, 36);
  assert.equal(Object.values(state.concepts).filter((row) => row.state === 'unassessed').length, 2);
  assert.equal(Object.values(state.concepts).filter((row) => row.state === 'no_qualified_transfer').length, 34);
  const signed = signTransferState(state, secret);
  assert.equal(verifyTransferState(signed, secret, { graph, policy, profiles }).ok, true);
  assert.equal(verifyTransferState({ ...signed, revision: 9 }, secret, { graph, policy, profiles }).ok, false);
});

test('semantic router requires software context and rejects factoring homonyms and assumptions', () => {
  assert.equal(routeCodingTransfer('Factor x^2 - 5x + 6.').applicable, false);
  for (const query of [
    'Refactor this TypeScript function.',
    'Implement multi-factor authentication.',
    'Build a Factorio plugin.',
    'Code a business risk factor model.',
  ]) {
    const route = routeCodingTransfer(query, { allowedProfileIds: ['algebra-factoring'] });
    assert.equal(route.applicable, false);
    assert.ok(route.evaluations[0].negativeGateCodes.length > 0);
  }
  assert.equal(routeCodingTransfer('Implement exact univariate polynomial expansion with integer coefficients and verify integer roots evaluate to zero.', { allowedProfileIds: ['algebra-factoring'] }).applicable, true);
});

test('polynomial oracle binds exactly two monic factors to exactly two verified roots', () => {
  const profile = loadTransferProfile('algebra-factoring', { graph });
  const task = generateTransferTasks(profile, { seed: 'strict-polynomial-oracle' })
    .find((row) => row.oracleId === 'integer-polynomial-identity-v1'
      && new Set(JSON.parse(row.expected).roots).size === 2);
  assert.equal(replayTransferOracle(task, task.expected).passed, true);
  const parsed = JSON.parse(task.expected);
  assert.equal(replayTransferOracle(task, JSON.stringify({ factors: parsed.factors, roots: [] })).passed, false);
  assert.equal(replayTransferOracle(task, JSON.stringify({ factors: parsed.factors, roots: [parsed.roots[0], parsed.roots[0]] })).passed, false);
  assert.equal(replayTransferOracle(task, JSON.stringify({ factors: parsed.factors, roots: parsed.roots, extra: true })).passed, false);
});

test('the transfer registry has an independent tamper-evident trust root', () => {
  const signed = signTransferRegistry(emptyTransferRegistry('2026-07-26T08:00:00.000Z'), secret);
  assert.equal(verifyTransferRegistry(signed, secret).ok, true);
  assert.equal(verifyTransferRegistry({ ...signed, enabled: false }, secret).ok, false);
  assert.equal(verifyTransferRegistry(signed, `${secret}-different`).ok, false);
});

test('independent replay distinguishes pass from null and binds idempotence to the manifest digest', () => {
  const passing = qualificationArtifacts({ runId: 'transfer-pass-fixture', noTransferFailures: 4 });
  const nullRun = qualificationArtifacts({ runId: 'transfer-null-fixture', noTransferFailures: 0 });
  try {
    const passReport = replayTransferQualification({ artifactRoot: passing.root, profile: passing.profile, policy, tasks: passing.tasks, signingSecret: secret });
    const nullReport = replayTransferQualification({ artifactRoot: nullRun.root, profile: nullRun.profile, policy, tasks: nullRun.tasks, signingSecret: secret });
    assert.equal(passReport.outcome, 'qualified');
    assert.equal(nullReport.outcome, 'null');
    const state = createTransferState({ graph, policy, profiles, now: '2026-07-26T08:00:00.000Z' });
    const applied = applyTransferQualification({ state, report: passReport, profile: passing.profile, graph, policy, profiles });
    assert.equal(applied.concepts['number-fractions'].state, 'qualified');
    assert.equal(applyTransferQualification({ state: applied, report: passReport, profile: passing.profile, graph, policy, profiles }), applied);
    assert.throws(() => applyTransferQualification({
      state: applied,
      report: { ...passReport, artifactManifestDigest: 'f'.repeat(64) },
      profile: passing.profile,
      graph,
      policy,
      profiles,
    }), /artifact receipt mismatch/);
    assert.notEqual(canonicalJson(passReport), canonicalJson(nullReport));
  } finally {
    fs.rmSync(passing.root, { recursive: true, force: true });
    fs.rmSync(nullRun.root, { recursive: true, force: true });
  }
});

test('synthetic attempts without provider-observed usage cannot qualify', () => {
  const run = qualificationArtifacts({ runId: 'transfer-no-provider-proof', noTransferFailures: 4, providerEvidence: false });
  try {
    const report = replayTransferQualification({ artifactRoot: run.root, profile: run.profile, policy, tasks: run.tasks, signingSecret: secret });
    assert.equal(report.gates.providerEvidence, false);
    assert.equal(report.outcome, 'invalid');
  } finally {
    fs.rmSync(run.root, { recursive: true, force: true });
  }
});
