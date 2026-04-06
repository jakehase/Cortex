import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  archiveArtifactRoots,
  initializeCampaign,
  setSupervisor,
  watchCampaign,
  watchCampaignReadiness,
  loadCampaign,
  claimWorkerIteration,
  completeWorkerIteration,
  runDelegatedCampaignWorker,
  writeJson
} from '../packages/campaign-runtime/index.mjs';

const execFileAsync = promisify(execFile);

test('persistent campaign does not stop while supervisor red without blocker', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-runtime-'));
  const statePath = path.join(dir, 'campaign.json');
  initializeCampaign(statePath, {});
  setSupervisor(statePath, { status: 'red', matrixStatus: 'partial' });
  await assert.rejects(() => watchCampaign(statePath, { timeoutMs: 150, intervalMs: 50 }), /Timed out/);
});

test('red supervisor without blocker explicitly requeues the worker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-runtime-requeue-'));
  const statePath = path.join(dir, 'campaign.json');
  initializeCampaign(statePath, {});
  claimWorkerIteration(statePath, { claimedBy: 'test-worker' });
  completeWorkerIteration(statePath, { ok: true, note: 'first pass complete' });
  const state = setSupervisor(statePath, { status: 'red', matrixStatus: 'partial', note: 'still more surfaces to cover' });
  assert.equal(state.stopAllowed, false);
  assert.equal(state.done, false);
  assert.equal(state.worker.shouldRequeue, true);
  assert.equal(state.worker.queuedIterations.length, 1);
  assert.equal(state.worker.requeueCount, 1);
});

test('worker supervisor notifier demo scripts produce a green closeout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-demo-'));
  const env = { ...process.env, LP_STACK_ARTIFACT_ROOT: dir, DEMO_TIMEOUT_MS: '1000' };
  await execFileAsync('node', ['apps/campaign-demo/worker.mjs'], { cwd: path.resolve(new URL('..', import.meta.url).pathname), env });
  await execFileAsync('node', ['apps/campaign-demo/supervisor.mjs'], { cwd: path.resolve(new URL('..', import.meta.url).pathname), env });
  await execFileAsync('node', ['apps/campaign-demo/notifier.mjs'], { cwd: path.resolve(new URL('..', import.meta.url).pathname), env });
  const state = loadCampaign(path.join(dir, 'campaign_state.json'));
  assert.equal(state.supervisor.status, 'green');
  assert.equal(state.notifier.delivered, true);
});

test('archiveArtifactRoots snapshots prior artifact trees into a rerun archive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-archive-'));
  fs.mkdirSync(path.join(dir, 'artifacts', 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'artifacts', 'beta'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'artifacts', 'alpha', 'state.json'), '{"ok":true}\n');
  fs.writeFileSync(path.join(dir, 'artifacts', 'beta', 'state.json'), '{"ok":false}\n');

  const archived = archiveArtifactRoots({
    repoRoot: dir,
    archiveBaseDir: path.join('artifacts', 'reruns'),
    artifactRoots: [path.join('artifacts', 'alpha'), path.join('artifacts', 'beta')],
    stamp: 'test-run'
  });

  assert.equal(archived.archived.length, 2);
  assert.equal(fs.existsSync(path.join(dir, 'artifacts', 'reruns', 'test-run', 'alpha', 'state.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'artifacts', 'reruns', 'test-run', 'beta', 'state.json')), true);
});

test('runDelegatedCampaignWorker mirrors delegate status and watchCampaignReadiness fires notifier', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-delegate-'));
  const artifactRoot = path.join(dir, 'artifacts', 'demo');
  const reportsDir = path.join(artifactRoot, 'reports');
  const workerStatePath = path.join(artifactRoot, 'worker_state.json');
  const logPath = path.join(reportsDir, 'worker.log');
  const statusMirrorPath = path.join(reportsDir, 'status.json');
  const delegateArtifactRoot = path.join(dir, 'artifacts', 'delegate');
  fs.mkdirSync(delegateArtifactRoot, { recursive: true });
  const delegateScript = path.join(dir, 'delegate.mjs');
  fs.writeFileSync(delegateScript, `
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = ${JSON.stringify(delegateArtifactRoot)};
mkdirSync(root, { recursive: true });
writeFileSync(path.join(root, 'completion_summary.json'), JSON.stringify({ supervisorConfirmedCompletion: true }, null, 2));
writeFileSync(path.join(root, 'program_state.json'), JSON.stringify({ supervisorStatus: 'green' }, null, 2));
console.log('delegate ok');
`);

  const worker = runDelegatedCampaignWorker({
    repoRoot: dir,
    artifactRoot,
    reportsDir,
    workerStatePath,
    logPath,
    statusMirrorPath,
    delegateScript,
    delegateArtifactRoot,
    delegateCompletionSummaryPath: path.join(delegateArtifactRoot, 'completion_summary.json'),
    delegateProgramStatePath: path.join(delegateArtifactRoot, 'program_state.json'),
    delegateBlockerPath: path.join(delegateArtifactRoot, 'blocker_report.json')
  });
  assert.equal(worker.ok, true);
  const workerState = JSON.parse(fs.readFileSync(workerStatePath, 'utf8'));
  assert.equal(workerState.status, 'delegate_finished');

  const programStatePath = path.join(artifactRoot, 'program_state.json');
  const summaryPath = path.join(artifactRoot, 'completion_summary.json');
  const notifyPath = path.join(artifactRoot, 'notification_state.json');
  const notifyScript = path.join(dir, 'notify.mjs');
  writeJson(programStatePath, {
    stopAllowed: true,
    supervisor: { status: 'green' }
  });
  writeJson(summaryPath, { supervisorConfirmedCompletion: true });
  writeJson(notifyPath, { awaitingNotifier: true, delivered: false });
  fs.writeFileSync(notifyScript, `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(notifyPath)}, JSON.stringify({ awaitingNotifier: true, delivered: true }, null, 2));
`);

  const watched = watchCampaignReadiness({
    programStatePath,
    summaryPath,
    notifyStatePath: notifyPath,
    cwd: dir,
    notifyArgs: [notifyScript]
  });
  assert.equal(watched.ready, true);
  const notification = JSON.parse(fs.readFileSync(notifyPath, 'utf8'));
  assert.equal(notification.delivered, true);
});
