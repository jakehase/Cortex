import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  atomicWriteSignedRegistry,
  loadSignedRegistry,
  readRegistrySecret,
} from '../../plugins/cortex-learning-os-live/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function answerValue(checker) {
  if (Array.isArray(checker.expected)) return checker.expected.join(',');
  return String(checker.expected);
}

function writeFakeCodexWorker(workerPath, answers) {
  fs.writeFileSync(workerPath, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const prompt = fs.readFileSync(0, 'utf8');
const items = [...prompt.matchAll(/\\"itemId\\":\\"([^\\"]+)\\"/g)].map((match) => match[1]);
const answerMap = ${JSON.stringify(answers)};
const rows = items.map((itemId) => ({ itemId, answer: answerMap[itemId] ?? '0' }));
fs.writeFileSync(value('--output-last-message'), JSON.stringify({ answers: rows }) + '\\n');
console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 0 } }));
`, { mode: 0o755 });
}

test('math training runs through the Codex worker path and produces installable green artifacts', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-live-training-'));
  const artifactRoot = path.join(temporary, 'artifacts');
  const workerPath = path.join(temporary, 'fake-codex-worker.mjs');
  const exam = JSON.parse(fs.readFileSync(path.join(root, 'exams/math-foundations/baseline.exam.json'), 'utf8'));
  const answers = {};
  for (const item of exam.items) {
    answers[item.itemId] = answerValue(item.checker);
    for (const key of ['correctionItem', 'promotionRetestItem', 'heldoutRetestItem']) {
      const remediation = item.remediation?.[key];
      if (remediation) answers[remediation.itemId] = answerValue(remediation.checker);
    }
  }
  // Force one observed failure. The training loop must correct, retest, promote,
  // and then pass a distinct held-out item rather than fabricating a lesson.
  answers['mf-01'] = '0';
  writeFakeCodexWorker(workerPath, answers);
  try {
    const result = spawnSync(process.execPath, [
      path.join(root, 'src/run-learning-smoke.mjs'),
      '--runner', 'codex',
      '--codex-command', workerPath,
      '--thinking', 'none',
      '--run-id', 'math-live-training-test',
      '--artifact-root', artifactRoot,
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'run_summary.json'), 'utf8'));
    assert.equal(summary.status, 'green');
    assert.equal(summary.learningLoopCompleted, true);
    assert.equal(summary.runner.kind, 'codex');
    assert.equal(summary.runner.model, 'gpt-5.6-sol');
    assert.match(summary.promotedLessonId, /^lesson_/);
    const trusted = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'trusted_lesson.json'), 'utf8'));
    assert.equal(trusted.promotionProof.promoted, true);
    assert.ok(Object.values(trusted.promotionProof.gates).every((value) => value === true));
    const modelCall = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'baseline/model_call.json'), 'utf8'));
    assert.equal(modelCall.command, workerPath);
    assert.equal(modelCall.exitCode, 0);
    assert.equal(summary.defaultPromoted, false);

    const stateRoot = path.join(temporary, 'live-state');
    const initialized = spawnSync(process.execPath, [path.join(root, 'src/live-control.mjs'), 'init', '--state-root', stateRoot], { encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    const installed = spawnSync(process.execPath, [
      path.join(root, 'src/live-control.mjs'), 'install', '--state-root', stateRoot,
      '--artifact-root', artifactRoot, '--profiles', 'auto',
    ], { encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    const installedStatus = JSON.parse(installed.stdout);
    assert.equal(installedStatus.installedLessonId, trusted.lessonId);
    assert.deepEqual(installedStatus.lessons[0].activationProfiles, ['linear_equation']);

    const registryPath = path.join(stateRoot, 'live-registry.json');
    const secretPath = path.join(stateRoot, 'registry.hmac');
    const secret = readRegistrySecret(secretPath);
    const registry = loadSignedRegistry(registryPath, secret);
    const activeLesson = registry.lessons[0];
    const olderDuplicate = {
      ...activeLesson,
      lessonId: `${activeLesson.lessonId}_older`,
      promotedAt: '2026-07-01T00:00:00.000Z',
      retestAfter: '2026-09-29T00:00:00.000Z',
      source: { ...activeLesson.source, runId: 'older-duplicate-evidence' },
    };
    atomicWriteSignedRegistry(registryPath, {
      ...registry,
      revision: registry.revision + 1,
      updatedAt: '2026-07-26T16:00:00.000Z',
      lessons: [olderDuplicate, activeLesson],
    }, secret);
    const deduplicated = spawnSync(process.execPath, [
      path.join(root, 'src/live-control.mjs'), 'deduplicate', '--state-root', stateRoot,
    ], { encoding: 'utf8' });
    assert.equal(deduplicated.status, 0, deduplicated.stderr);
    const deduplicatedStatus = JSON.parse(deduplicated.stdout);
    assert.equal(deduplicatedStatus.changed, true);
    assert.deepEqual(deduplicatedStatus.deduplicatedLessonIds, [olderDuplicate.lessonId]);
    assert.equal(deduplicatedStatus.lessonCount, 1);
    assert.equal(deduplicatedStatus.lessons[0].lessonId, activeLesson.lessonId);

    const reinstalled = spawnSync(process.execPath, [
      path.join(root, 'src/live-control.mjs'), 'install', '--state-root', stateRoot,
      '--artifact-root', artifactRoot, '--profiles', 'auto',
    ], { encoding: 'utf8' });
    assert.equal(reinstalled.status, 0, reinstalled.stderr);
    const reinstalledStatus = JSON.parse(reinstalled.stdout);
    assert.equal(reinstalledStatus.lessonCount, 1);
    assert.deepEqual(reinstalledStatus.deduplicatedLessonIds, []);

    // A hostile worker can recompute a transport manifest. Promotion must still
    // fail because the control plane independently replays deterministic grading.
    const verifierPath = path.join(artifactRoot, 'baseline/verifier_results.json');
    const verifiers = JSON.parse(fs.readFileSync(verifierPath, 'utf8'));
    verifiers[0].status = 'passed';
    verifiers[0].score = 1;
    fs.writeFileSync(verifierPath, `${JSON.stringify(verifiers, null, 2)}\n`);
    const manifestPath = path.join(artifactRoot, 'artifact_manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const row = manifest.files.find((candidate) => candidate.path === 'baseline/verifier_results.json');
    row.sha256 = crypto.createHash('sha256').update(fs.readFileSync(verifierPath)).digest('hex');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const rejected = spawnSync(process.execPath, [
      path.join(root, 'src/live-control.mjs'), 'install', '--state-root', stateRoot,
      '--artifact-root', artifactRoot, '--profiles', 'auto',
    ], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /verifier replay mismatch/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('no-observed-mistake artifacts require independent replay and produce no lesson', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-live-no-mistake-'));
  const artifactRoot = path.join(temporary, 'artifacts');
  const workerPath = path.join(temporary, 'fake-codex-worker.mjs');
  const examPath = path.join(root, 'exams/math-foundations/reliability-challenge.exam.json');
  const exam = JSON.parse(fs.readFileSync(examPath, 'utf8'));
  const answers = Object.fromEntries(exam.items.map((item) => [item.itemId, answerValue(item.checker)]));
  writeFakeCodexWorker(workerPath, answers);
  try {
    const result = spawnSync(process.execPath, [
      path.join(root, 'src/run-learning-smoke.mjs'),
      '--runner', 'codex',
      '--codex-command', workerPath,
      '--thinking', 'none',
      '--exam', examPath,
      '--run-id', 'math-no-observed-mistake-test',
      '--artifact-root', artifactRoot,
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 3, result.stderr || result.stdout);
    const stateRoot = path.join(temporary, 'live-state');
    assert.equal(spawnSync(process.execPath, [
      path.join(root, 'src/live-control.mjs'), 'init', '--state-root', stateRoot,
    ], { encoding: 'utf8' }).status, 0);
    const verified = spawnSync(process.execPath, [
      path.join(root, 'src/live-control.mjs'), 'verify-no-observed-mistake',
      '--state-root', stateRoot, '--artifact-root', artifactRoot,
    ], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    const proof = JSON.parse(verified.stdout);
    assert.equal(proof.baselineScore, 1);
    assert.equal(proof.passedItemCount, exam.items.length);
    assert.equal(proof.noLessonInstalled, true);
    assert.equal(loadSignedRegistry(path.join(stateRoot, 'live-registry.json'), readRegistrySecret(path.join(stateRoot, 'registry.hmac'))).lessons.length, 0);

    const verifierPath = path.join(artifactRoot, 'baseline/verifier_results.json');
    const verifiers = JSON.parse(fs.readFileSync(verifierPath, 'utf8'));
    verifiers[0].status = 'failed';
    verifiers[0].score = 0;
    fs.writeFileSync(verifierPath, `${JSON.stringify(verifiers, null, 2)}\n`);
    const manifestPath = path.join(artifactRoot, 'artifact_manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.files.find((row) => row.path === 'baseline/verifier_results.json').sha256 = crypto.createHash('sha256').update(fs.readFileSync(verifierPath)).digest('hex');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const rejected = spawnSync(process.execPath, [
      path.join(root, 'src/live-control.mjs'), 'verify-no-observed-mistake',
      '--state-root', stateRoot, '--artifact-root', artifactRoot,
    ], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /verifier replay mismatch/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('math training rejects unsupported runner values before making a model call', () => {
  const result = spawnSync(process.execPath, [
    path.join(root, 'src/run-learning-smoke.mjs'), '--runner', 'unknown-runner',
  ], { encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--runner must be openclaw or codex/);
});

test('detached launcher preflights and passes the exact remote Codex executable', () => {
  const launcherPath = path.join(root, 'scripts/launch-live-math-training.sh');
  const workerPath = path.join(root, 'scripts/remote-math-training-worker.sh');
  const harvesterPath = path.join(root, 'scripts/harvest-live-math-training.py');
  for (const script of [launcherPath, workerPath]) {
    const syntax = spawnSync('/bin/bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  const launcher = fs.readFileSync(launcherPath, 'utf8');
  const worker = fs.readFileSync(workerPath, 'utf8');
  assert.match(launcher, /sudo -u jake -- "\$REMOTE_CODEX_BIN" --version/);
  assert.match(launcher, /MODE="adaptive"/);
  assert.match(launcher, /adaptive-plan/);
  assert.match(launcher, /chown jake:jake "\$REMOTE_PLAN"/);
  assert.match(launcher, /sudo -u jake -- test -r "\$REMOTE_PLAN"/);
  assert.match(launcher, /"\$RUN_ID" adaptive "\$LOCAL_COMMIT" "\$REMOTE_CODEX_BIN" "\$REMOTE_PLAN"/);
  assert.match(launcher, /"\$RUN_ID" "\$EXAM" "\$LOCAL_COMMIT" "\$REMOTE_CODEX_BIN"/);
  assert.match(worker, /MODE_ARG="\$\{2:-adaptive\}"/);
  assert.match(worker, /CODEX_BIN="\$\{4:-\/home\/jake\/\.local\/bin\/codex\}"/);
  assert.match(worker, /adaptive plan must be readable by the worker service user/);
  assert.match(worker, /\[\[ -x "\$CODEX_BIN" \]\]/);
  assert.match(worker, /--codex-command "\$CODEX_BIN"/);
  assert.match(worker, /if npm run "\$NPM_SCRIPT"/);
  assert.match(worker, /write_state candidate_no_lesson/);
  assert.match(worker, /write_state candidate_adaptive/);
  assert.doesNotMatch(worker, /set \+e\s+npm run/);
  const harvester = fs.readFileSync(harvesterPath, 'utf8');
  assert.match(harvester, /"candidate_green", "candidate_no_lesson", "candidate_adaptive"/);
  assert.match(harvester, /"verify-no-observed-mistake"/);
  assert.match(harvester, /"adaptive-apply"/);
  assert.match(harvester, /TERMINAL = \{"blocked", "completed", "failed"\}/);
  assert.match(harvester, /"status": "blocked" if is_blocked else "completed"/);
  const harvesterSyntax = spawnSync('python3', ['-m', 'py_compile', harvesterPath], { encoding: 'utf8' });
  assert.equal(harvesterSyntax.status, 0, harvesterSyntax.stderr);

  const unsafe = spawnSync('/bin/bash', [
    workerPath,
    'math-training-20260726T154152Z-abcdef',
    'stress',
    '0'.repeat(40),
    'relative/codex',
  ], { encoding: 'utf8' });
  assert.equal(unsafe.status, 2);
  assert.match(unsafe.stderr, /invalid Codex executable path/);

  const adaptiveArguments = spawnSync('/bin/bash', [
    workerPath,
    'math-training-20260726T154152Z-abcdef',
    'adaptive',
    '0'.repeat(40),
    '/missing/codex',
    '/missing/adaptive-plan.json',
  ], { encoding: 'utf8' });
  assert.equal(adaptiveArguments.status, 2);
  assert.match(adaptiveArguments.stderr, /adaptive plan must be a regular file/);
  assert.doesNotMatch(adaptiveArguments.stderr, /invalid expected commit/);

  const badPlanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-bad-plan-'));
  const badPlan = path.join(badPlanRoot, 'plan.json');
  fs.writeFileSync(badPlan, '{not-json\n');
  const invalidPlan = spawnSync(process.execPath, [
    path.join(root, 'src/run-adaptive-curriculum.mjs'),
    '--plan', badPlan,
    '--artifact-root', path.join(badPlanRoot, 'artifacts'),
  ], { encoding: 'utf8' });
  fs.rmSync(badPlanRoot, { recursive: true, force: true });
  assert.equal(invalidPlan.status, 1);
  assert.match(invalidPlan.stderr, /adaptive plan is unreadable or invalid JSON/);
});
