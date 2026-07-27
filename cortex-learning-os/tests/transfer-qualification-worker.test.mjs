import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { readJson } from '../src/json.mjs';
import { CLOS_ROOT } from '../src/paths.mjs';
import { buildTransferQualificationPlan, replayTransferQualification, verifyTransferArtifactManifest } from '../src/transfer-qualification.mjs';
import { runTransferQualification } from '../src/transfer-qualification-worker.mjs';
import { loadTransferProfile } from '../src/transfer-profiles.mjs';
import { generateTransferTasks } from '../src/transfer-tasks.mjs';

const secret = 'worker-test-control-plane-secret-at-least-32-bytes';
const graph = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/curriculum.graph.json'));
const policy = readJson(path.join(CLOS_ROOT, 'policies/coding-transfer-v0.9.json'));
const fake = path.join(CLOS_ROOT, 'tests/fake-transfer-model.mjs');

function fixture(runId = 'worker-fixture', profileId = 'exact-multiplication') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-transfer-worker-'));
  fs.chmodSync(root, 0o700);
  const profile = loadTransferProfile(profileId, { graph });
  const tasks = generateTransferTasks(profile, { seed: runId });
  const runtime = {
    schemaVersion: 'cortex.learning_os.transfer_runtime.v1',
    provider: 'test-fixture', runner: 'fake-transfer-model', model: 'fake-model-v1',
    reasoningEffort: 'low', sandbox: 'read-only', toolsAllowed: false,
  };
  const plan = buildTransferQualificationPlan({
    runId, profile, policy, tasks, sourceCommit: profile.source.baseCommit,
    signingSecret: secret, generatedAt: '2026-07-27T08:00:00.000Z',
    runtime,
  });
  fs.writeFileSync(path.join(root, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'tasks.json'), `${JSON.stringify(tasks, null, 2)}\n`, { mode: 0o600 });
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-transfer-log-'));
  return { root, profile, tasks, plan, logRoot, log: path.join(logRoot, 'calls.json') };
}

function options(value, extra = []) {
  return {
    artifactRoot: value.root,
    model: 'fake-model-v1',
    concurrency: 1,
    modelCommand: fake,
    modelArgs: ['--log', value.log, '--jsonl-output', '{output}', ...extra],
    timeoutMs: 5000,
  };
}

function cleanup(value) {
  fs.rmSync(value.root, { recursive: true, force: true });
  fs.rmSync(value.logRoot, { recursive: true, force: true });
}

test('worker produces exact two-arm coverage, private provider evidence, and replayable exact manifest', async () => {
  const value = fixture('worker-full');
  try {
    const result = await runTransferQualification(options(value));
    assert.equal(result.attempts.length, value.tasks.length * 2);
    assert.equal(new Set(result.attempts.map((row) => `${row.taskId}:${row.arm}`)).size, result.attempts.length);
    assert.deepEqual(result.attempts.map((row) => ({ taskId: row.taskId, arm: row.arm })), value.plan.trialOrder);
    const candidateFirst = value.plan.trialOrder.filter((row, index) => row.arm === 'candidate' && index % 2 === 0).length;
    const baselineFirst = value.plan.trialOrder.filter((row, index) => row.arm === 'no-transfer' && index % 2 === 0).length;
    assert.ok(Math.abs(candidateFirst - baselineFirst) <= 1);
    assert.equal(fs.statSync(path.join(value.root, 'attempts.json')).mode & 0o077, 0);
    const ledgerText = fs.readFileSync(path.join(value.root, 'provider_calls.json'), 'utf8');
    assert.doesNotMatch(ledgerText, /Computational formulation|Task:|overflow-safe|CLOS_|expected|auth|secret/i);
    for (const row of result.providerCalls) {
      assert.equal(row.model, 'fake-model-v1');
      assert.ok(row.runtimeMs > 0);
      assert.equal(row.exitStatus, 0);
      assert.ok(row.usage.input_tokens > 0);
      assert.deepEqual(Object.keys(row).sort(), [
        'arm', 'callId', 'commandIdentity', 'completedAt', 'exitStatus', 'model', 'provider',
        'runtimeContractDigest', 'runtimeMs', 'startedAt', 'taskId', 'usage',
      ]);
    }
    const verified = verifyTransferArtifactManifest(value.root, policy);
    assert.ok(verified.manifest.files.some((row) => row.path === 'provider_calls.json'));
    assert.deepEqual(verified.manifest.files.map((row) => row.path).sort(), [
      'attempts.json', 'plan.json', 'provider_calls.json', 'tasks.json', 'worker_proposal.json',
    ]);
    const report = replayTransferQualification({
      artifactRoot: value.root, profile: value.profile, policy, tasks: value.tasks, signingSecret: secret,
    });
    assert.equal(report.counts.total, value.tasks.length * 2);
  } finally { cleanup(value); }
});

test('candidate context is isolated by semantic routing and expected answers never enter prompts', async () => {
  const value = fixture('worker-routing', 'algebra-factoring');
  try {
    await runTransferQualification(options(value));
    const prompts = JSON.parse(fs.readFileSync(value.log, 'utf8')).map((row) => row.prompt);
    const taskById = new Map(value.tasks.map((task) => [task.taskId, task]));
    for (let index = 0; index < value.plan.trialOrder.length; index += 1) {
      const trial = value.plan.trialOrder[index];
      const task = taskById.get(trial.taskId);
      const prompt = prompts[index];
      if (trial.arm === 'no-transfer' || ['negative-semantic', 'assumption-violation'].includes(task.family)) {
        assert.doesNotMatch(prompt, /Computational formulation:/);
      } else assert.match(prompt, /Computational formulation:/);
      assert.equal(prompt.includes(task.expected), false);
    }
  } finally { cleanup(value); }
});

test('interrupted execution resumes without duplicate completed calls and rejects model/config drift', async () => {
  const value = fixture('worker-resume');
  const interrupted = options(value, ['--interrupt-at', '3']);
  interrupted.concurrency = 1;
  try {
    await assert.rejects(runTransferQualification(interrupted), /model adapter failed/);
    const before = JSON.parse(fs.readFileSync(path.join(value.root, 'provider_calls.json'), 'utf8'));
    assert.equal(before.length, 3);
    const resumed = await runTransferQualification(interrupted);
    assert.equal(resumed.providerCalls.length, value.tasks.length * 2);
    assert.equal(new Set(resumed.providerCalls.map((row) => row.callId)).size, resumed.providerCalls.length);
  } finally { cleanup(value); }

  const drift = fixture('worker-drift');
  const first = options(drift, ['--interrupt-at', '2']);
  first.concurrency = 1;
  try {
    await assert.rejects(runTransferQualification(first), /model adapter failed/);
    await assert.rejects(runTransferQualification({ ...first, model: 'different-model' }), /runtime does not match frozen plan|configuration drift/);
    await assert.rejects(runTransferQualification({ ...first, concurrency: 2 }), /configuration drift/);
  } finally { cleanup(drift); }
});

test('concurrent interruption checkpoints successful peers and resumes without duplicate calls', async () => {
  const value = fixture('worker-concurrent-resume');
  const interrupted = options(value, ['--concurrent-safe', '--interrupt-baseline-once']);
  interrupted.concurrency = 2;
  try {
    await assert.rejects(runTransferQualification(interrupted), /model adapter failed/);
    const before = JSON.parse(fs.readFileSync(path.join(value.root, 'provider_calls.json'), 'utf8'));
    assert.equal(before.length, 1);
    const resumed = await runTransferQualification(interrupted);
    assert.equal(resumed.providerCalls.length, value.tasks.length * 2);
    assert.equal(new Set(resumed.providerCalls.map((row) => row.callId)).size, resumed.providerCalls.length);
  } finally { cleanup(value); }
});

test('worker fails closed before calls on substitution and on malformed/incomplete adapter output', async () => {
  const substituted = fixture('worker-substitution');
  try {
    substituted.tasks[0].prompt += ' changed';
    fs.writeFileSync(path.join(substituted.root, 'tasks.json'), `${JSON.stringify(substituted.tasks, null, 2)}\n`, { mode: 0o600 });
    await assert.rejects(runTransferQualification(options(substituted)), /task coverage|task binding/);
    assert.equal(fs.existsSync(substituted.log), false);
  } finally { cleanup(substituted); }

  const malformed = fixture('worker-malformed');
  try {
    const bad = options(malformed, ['--malformed']);
    bad.concurrency = 1;
    await assert.rejects(runTransferQualification(bad), /malformed JSONL/);
    assert.equal(fs.existsSync(path.join(malformed.root, 'attempts.json')), false);
    assert.equal(fs.existsSync(path.join(malformed.root, 'artifact_manifest.json')), false);
  } finally { cleanup(malformed); }

  const toolUse = fixture('worker-tool-event');
  try {
    await assert.rejects(runTransferQualification(options(toolUse, ['--tool-event'])), /prohibited tool event/);
    assert.equal(fs.existsSync(path.join(toolUse.root, 'attempts.json')), false);
    assert.equal(fs.existsSync(path.join(toolUse.root, 'artifact_manifest.json')), false);
  } finally { cleanup(toolUse); }
});

test('resume rejects duplicate keys and malformed timestamps', async () => {
  for (const mutation of ['duplicate', 'timestamp']) {
    const value = fixture(`worker-hostile-${mutation}`);
    const interrupted = options(value, ['--interrupt-at', '2']);
    interrupted.concurrency = 1;
    try {
      await assert.rejects(runTransferQualification(interrupted), /model adapter failed/);
      const attemptsPath = path.join(value.root, 'attempts.json');
      const callsPath = path.join(value.root, 'provider_calls.json');
      const attempts = JSON.parse(fs.readFileSync(attemptsPath, 'utf8'));
      const calls = JSON.parse(fs.readFileSync(callsPath, 'utf8'));
      if (mutation === 'duplicate') {
        attempts[1] = structuredClone(attempts[0]);
        calls[1] = structuredClone(calls[0]);
      } else {
        attempts[0].completedAt = 'not-a-time';
        calls[0].completedAt = 'not-a-time';
      }
      fs.writeFileSync(attemptsPath, `${JSON.stringify(attempts, null, 2)}\n`, { mode: 0o600 });
      fs.writeFileSync(callsPath, `${JSON.stringify(calls, null, 2)}\n`, { mode: 0o600 });
      await assert.rejects(runTransferQualification(interrupted), /resumable worker artifact binding/);
    } finally { cleanup(value); }
  }
});
