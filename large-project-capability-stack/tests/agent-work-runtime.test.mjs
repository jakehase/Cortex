import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acceptPatch,
  acquireLease,
  backupRuntime,
  buildRecoveryQualificationPacket,
  cancelRuntime,
  closeAgentWorkRuntime,
  initializeAgentWorkRuntime,
  indexArtifact,
  openAgentWorkRuntime,
  pauseRuntime,
  projectRuntimeEvents,
  readRuntimeEvents,
  reconcileRemoteHeartbeat,
  recoverRuntimeState,
  recoverStaleLeases,
  recordBudget,
  recordRemoteHeartbeat,
  resumeRuntime,
  stagePatch,
  transitionTask
} from '../packages/agent-work-runtime/index.mjs';
import { compileObjective, replayRun, cancelRun, resumeRun, getRunStatus } from '../packages/canonical-agent-work/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/agent-work-v1/v0-cortex-handoff.json'), 'utf8'));

function tmpRunRoot(label = 'agent-work-runtime-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function planRunRoot() {
  const runRoot = tmpRunRoot();
  const planned = compileObjective({ input: fixture, outputDir: runRoot });
  assert.equal(planned.ok, true);
  return { runRoot, planned };
}

function openPlannedRuntime() {
  const { runRoot } = planRunRoot();
  return { runRoot, runtime: openAgentWorkRuntime({ runRoot }) };
}

test('Agent Work runtime initializes SQLite WAL state and portable JSONL events', () => {
  const { runRoot } = planRunRoot();
  const runtime = openAgentWorkRuntime({ runRoot });
  assert.equal(runtime.journalMode, 'wal');
  assert.equal(fs.existsSync(path.join(runRoot, 'run.db')), true);
  assert.equal(fs.existsSync(path.join(runRoot, 'run_events.jsonl')), true);
  const recovery = recoverRuntimeState(runtime);
  assert.ok(recovery.projection.eventCount >= 3);
  assert.equal(recovery.projection.state.runState, 'compiled');
  assert.equal(Object.keys(recovery.projection.state.tasks).length, 2);
  closeAgentWorkRuntime(runtime);
});

test('runtime replay from JSONL rebuilds the same accepted task and budget truth after injected crash', () => {
  const { runRoot, runtime } = openPlannedRuntime();
  const taskId = Object.keys(recoverRuntimeState(runtime).projection.state.tasks)[0];
  assert.throws(() => transitionTask(runtime, { taskId, state: 'ready', expectedStateVersion: 1, faultAt: 'after_event_append' }), /fault_injected/);
  const recovered = recoverRuntimeState(runtime).projection;
  assert.equal(recovered.state.tasks[taskId].state, 'ready');
  assert.equal(recovered.state.tasks[taskId].stateVersion, 2);
  recordBudget(runtime, { delta: { tokensUsed: 10, providerCalls: 1 }, idempotencyKey: 'budget-once' });
  recordBudget(runtime, { delta: { tokensUsed: 10, providerCalls: 1 }, idempotencyKey: 'budget-once' });
  const afterBudget = recoverRuntimeState(runtime).projection;
  assert.equal(afterBudget.state.budget.tokensUsed, 10);
  assert.equal(afterBudget.state.budget.providerCalls, 1);
  closeAgentWorkRuntime(runtime);

  const reopened = openAgentWorkRuntime({ runRoot });
  const replayed = recoverRuntimeState(reopened).projection;
  assert.equal(replayed.stateDigest, afterBudget.stateDigest);
  assert.equal(replayed.state.tasks[taskId].state, 'ready');
  assert.equal(replayed.state.budget.tokensUsed, 10);
  closeAgentWorkRuntime(reopened);
});

test('lease fencing rejects stale workers and accepted patches are not duplicated after resume', () => {
  const { runtime } = openPlannedRuntime();
  const taskId = Object.keys(recoverRuntimeState(runtime).projection.state.tasks)[0];
  transitionTask(runtime, { taskId, state: 'ready', expectedStateVersion: 1 });
  const oldLease = acquireLease(runtime, { taskId, workerId: 'worker-old', ttlMs: 60_000 });
  const newLease = acquireLease(runtime, { taskId, workerId: 'worker-new', ttlMs: 60_000 });
  assert.throws(() => stagePatch(runtime, { taskId, leaseId: oldLease.leaseId, fencingToken: oldLease.fencingToken, patchId: 'patch-old' }), /stale_fencing_token/);
  stagePatch(runtime, { taskId, leaseId: newLease.leaseId, fencingToken: newLease.fencingToken, patchId: 'patch-1' });
  const accepted = acceptPatch(runtime, { taskId, leaseId: newLease.leaseId, fencingToken: newLease.fencingToken, patchId: 'patch-1', idempotencyKey: 'accept-patch-1' });
  const duplicate = acceptPatch(runtime, { taskId, leaseId: newLease.leaseId, fencingToken: newLease.fencingToken, patchId: 'patch-1', idempotencyKey: 'accept-patch-1' });
  assert.equal(duplicate.duplicate, true);
  const state = recoverRuntimeState(runtime).projection.state;
  assert.deepEqual(state.acceptedPatchIds, ['patch-1']);
  assert.equal(state.tasks[taskId].state, 'accepted');
  closeAgentWorkRuntime(runtime);
});

test('stale lease recovery and unknown remote state block rather than fabricate completion', () => {
  const { runtime } = openPlannedRuntime();
  const taskId = Object.keys(recoverRuntimeState(runtime).projection.state.tasks)[0];
  transitionTask(runtime, { taskId, state: 'ready', expectedStateVersion: 1 });
  const acquiredAt = '2026-07-10T00:00:00.000Z';
  const lease = acquireLease(runtime, { taskId, workerId: 'worker-stale', ttlMs: 1000, generatedAt: acquiredAt });
  const stale = recoverStaleLeases(runtime, { now: '2026-07-10T00:00:02.000Z' });
  assert.equal(stale.expired.map((entry) => entry.leaseId).includes(lease.leaseId), true);
  assert.equal(stale.projection.state.leases[lease.leaseId].state, 'expired');

  recordRemoteHeartbeat(runtime, { heartbeat: { running: true, heartbeatAt: '2026-07-10T00:00:00.000Z' } });
  const reconciled = reconcileRemoteHeartbeat(runtime, { staleAfterMs: 1000, generatedAt: '2026-07-10T00:00:05.000Z' });
  assert.equal(reconciled.blocked, true);
  const projection = recoverRuntimeState(runtime).projection;
  assert.equal(projection.state.blocker.code, 'unknown_remote_state');
  assert.equal(projection.state.truth.ok, false);
  closeAgentWorkRuntime(runtime);
});

test('artifact indexing is content-hashed and replayable without chat context', () => {
  const { runRoot, runtime } = openPlannedRuntime();
  const artifactPath = path.join(runRoot, 'sample-artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify({ ok: true }) + '\n');
  indexArtifact(runtime, { artifactId: 'sample-artifact', filePath: artifactPath, schemaVersion: 'fixture.schema.v1' });
  const projection = recoverRuntimeState(runtime).projection;
  assert.equal(projection.state.artifacts['sample-artifact'].bytes, fs.statSync(artifactPath).size);
  assert.match(projection.state.artifacts['sample-artifact'].sha256, /^[a-f0-9]{64}$/);
  const events = readRuntimeEvents(path.join(runRoot, 'run_events.jsonl'));
  const replayed = projectRuntimeEvents(events).state;
  assert.equal(replayed.artifacts['sample-artifact'].sha256, projection.state.artifacts['sample-artifact'].sha256);
  closeAgentWorkRuntime(runtime);
});

test('runtime migrations and backup/restore qualification packet are written', () => {
  const { runRoot, runtime } = openPlannedRuntime();
  pauseRuntime(runtime, { reason: 'fault injection pause' });
  resumeRuntime(runtime, { reason: 'fault injection resume' });
  cancelRuntime(runtime, { reason: 'operator stop for backup test' });
  const backup = backupRuntime({ runRoot, backupPath: path.join(runRoot, 'backups/run.db.backup') });
  assert.equal(fs.existsSync(backup.backupPath), true);
  assert.match(backup.sha256, /^[a-f0-9]{64}$/);
  const { packet, packetPath } = buildRecoveryQualificationPacket({ runRoot, checks: { backupRestore: true, faultInjection: true } });
  assert.equal(fs.existsSync(packetPath), true);
  assert.deepEqual(packet.migrationVersions, [1]);
  assert.equal(packet.journalMode, 'wal');
  assert.equal(packet.checks.backupRestore, true);
  closeAgentWorkRuntime(runtime);
});

test('facade resume/cancel/replay operate through durable runtime events', () => {
  const { runRoot } = planRunRoot();
  const resumed = resumeRun({ runRoot });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.state, 'running');
  assert.equal(fs.existsSync(path.join(runRoot, 'recovery_qualification_packet.json')), true);
  const replayed = replayRun({ runRoot });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.data.projection.eventCount > 0, true);
  const cancelled = cancelRun({ runRoot, reason: 'operator done testing runtime' });
  assert.equal(cancelled.exitCode, 4);
  assert.equal(cancelled.data.runtime.state.cancelled, true);
  const status = getRunStatus({ runRoot });
  assert.equal(status.state, 'cancelled');
  assert.equal(status.data.runtime.state.cancelled, true);
});
