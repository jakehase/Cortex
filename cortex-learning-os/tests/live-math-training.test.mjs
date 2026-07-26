import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function answerValue(checker) {
  if (Array.isArray(checker.expected)) return checker.expected.join(',');
  return String(checker.expected);
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

test('math training rejects unsupported runner values before making a model call', () => {
  const result = spawnSync(process.execPath, [
    path.join(root, 'src/run-learning-smoke.mjs'), '--runner', 'unknown-runner',
  ], { encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--runner must be openclaw or codex/);
});
