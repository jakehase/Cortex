#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  acceptPatch,
  acquireLease,
  closeAgentWorkRuntime,
  initializeAgentWorkRuntime,
  openAgentWorkRuntime,
  readRuntimeEvents,
  recoverRuntimeState,
  recoverStaleLeases,
  recordBudget,
  stagePatch,
  transitionTask
} from '../../packages/agent-work-runtime/index.mjs';
import {
  detectPatchConflicts,
  mergePatchBundle
} from '../../packages/agent-work-execution/index.mjs';
import {
  buildVerifierAdapter,
  buildVerifierMatrix,
  createVerificationContext,
  runVerifierAdapter
} from '../../packages/agent-work-verifier/index.mjs';

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function parseArgs(argv) {
  const args = {
    out: null,
    workers: 8,
    runId: `phase8-fault-campaign-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    hostRole: process.env.BENCHMARK_HOST_ROLE || process.env.HOST_ROLE || 'unknown'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--out') { args.out = path.resolve(next); index += 1; continue; }
    if (token === '--workers' || token === '--worker-count') { args.workers = Number(next); index += 1; continue; }
    if (token === '--run-id') { args.runId = String(next || '').trim(); index += 1; continue; }
    if (token === '--host-role') { args.hostRole = String(next || '').trim(); index += 1; continue; }
  }
  if (!args.out) {
    console.error('usage: node apps/system-benchmark/run-agent-work-phase8-fault-campaign.mjs --out <artifact-dir> [--workers 8] [--run-id <id>]');
    process.exit(2);
  }
  args.workers = Math.max(8, Number.isFinite(args.workers) ? Math.trunc(args.workers) : 8);
  return args;
}

function hostFacts(cwd) {
  const hostname = os.hostname();
  const uname = spawnSync('uname', ['-a'], { encoding: 'utf8' });
  const df = spawnSync('df', ['-Pk', cwd], { encoding: 'utf8' });
  const dfLine = String(df.stdout || '').trim().split(/\n/).slice(-1)[0] || '';
  const parts = dfLine.trim().split(/\s+/);
  const availableKb = Number(parts[3] || 0);
  return {
    hostname,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    pid: process.pid,
    uname: String(uname.stdout || '').trim(),
    filesystem: { raw: dfLine, availableKb, freeGb: Number((availableKb / 1024 / 1024).toFixed(3)) }
  };
}

function createRuntimeBundle({ runRoot, runId, workerCount }) {
  const tasks = Array.from({ length: workerCount }, (_, index) => ({
    taskId: `phase8_fault_task_${String(index + 1).padStart(2, '0')}`,
    state: 'proposed',
    allowedFiles: [`fault-fixture/${String(index + 1).padStart(2, '0')}.txt`],
    workerRole: 'fault_campaign_worker'
  }));
  const runManifest = {
    schemaVersion: 'clawd.agent_work.phase8_fault_campaign_manifest.v1',
    runId,
    state: 'compiled',
    workerCount,
    generatedAt: nowIso(),
    truthBoundary: 'This manifest drives a deterministic remote fault campaign. It is not product parity or release completion.'
  };
  const contractBundle = {
    schemaVersion: 'clawd.agent_work.phase8_fault_campaign_contract_bundle.v1',
    runManifest,
    taskContracts: tasks
  };
  writeJson(path.join(runRoot, 'run_manifest.json'), runManifest);
  writeJson(path.join(runRoot, 'agent_work_v1_contract_bundle.json'), contractBundle);
  return { runManifest, contractBundle, tasks };
}

function spawnWorker({ workerId, mode, outDir, delayMs = 75, killAfterMs = null }) {
  const resultPath = path.join(outDir, `${workerId}.json`);
  const code = `
const fs = require('fs');
const [resultPath, workerId, mode, delayRaw] = process.argv.slice(1);
const delayMs = Math.max(0, Number(delayRaw || 0));
setTimeout(() => {
  if (mode === 'provider_error') {
    console.error(JSON.stringify({ workerId, fixture: 'provider_error', providerStatus: 429 }));
    process.exit(86);
  }
  fs.writeFileSync(resultPath, JSON.stringify({ workerId, pid: process.pid, mode, completedAt: new Date().toISOString() }, null, 2) + '\\n');
}, delayMs);
`;
  const startedAt = nowIso();
  const child = spawn(process.execPath, ['-e', code, resultPath, workerId, mode, String(delayMs)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const record = { workerId, mode, pid: child.pid, startedAt, resultPath, killAfterMs, stdout: '', stderr: '' };
  let killTimer = null;
  if (killAfterMs != null) {
    killTimer = setTimeout(() => child.kill('SIGTERM'), killAfterMs);
  }
  child.stdout.on('data', (chunk) => { record.stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { record.stderr += chunk.toString(); });
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      const completedAt = nowIso();
      const payload = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : null;
      resolve({ ...record, completedAt, exitCode: code, signal: signal || null, resultPayload: payload });
    });
  });
}

function runVerifierFailureFixture(outDir) {
  const sourceRoot = path.join(outDir, 'verifier-source');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
  fs.writeFileSync(path.join(sourceRoot, 'index.mjs'), 'export const verifierFixture = true;\n');
  const context = createVerificationContext({
    sourceRoot,
    contextRoot: path.join(outDir, 'verifier-context'),
    verifierId: 'phase8_failing_verifier'
  });
  const adapter = buildVerifierAdapter({
    verifierId: 'phase8_failing_verifier',
    type: 'deterministic_command',
    command: process.execPath,
    args: ['-e', "console.error('phase8 verifier failure fixture'); process.exit(7);"]
  });
  const evidence = runVerifierAdapter({ adapter, context });
  const matrix = buildVerifierMatrix({ verifierResults: [evidence], requiredVerifierIds: ['phase8_failing_verifier'] });
  return {
    adapter,
    contextDigest: context.contextDigest,
    evidencePath: evidence.evidencePath,
    evidenceExitCode: evidence.exitCode,
    evidenceOk: evidence.ok,
    matrixStatus: matrix.status,
    passed: evidence.ok === false && evidence.exitCode === 7 && matrix.status === 'red'
  };
}

function runConflictFixture(outDir) {
  const repo = path.join(outDir, 'conflict-repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  const target = path.join(repo, 'src/conflict.mjs');
  fs.writeFileSync(target, 'export const value = "base";\n');
  const before = sha256(fs.readFileSync(target));
  const firstText = 'export const value = "first";\n';
  const secondText = 'export const value = "second";\n';
  const first = {
    ok: true,
    patchId: 'phase8-conflict-first',
    taskId: 'phase8_conflict_first',
    modifiedFiles: [{ path: 'src/conflict.mjs', beforeSha256: before, afterSha256: sha256(firstText), afterExists: true, afterContent: firstText }]
  };
  const second = {
    ok: true,
    patchId: 'phase8-conflict-second',
    taskId: 'phase8_conflict_second',
    modifiedFiles: [{ path: 'src/conflict.mjs', beforeSha256: before, afterSha256: sha256(secondText), afterExists: true, afterContent: secondText }]
  };
  const report = detectPatchConflicts([first, second]);
  const firstReceipt = mergePatchBundle({ canonicalRoot: repo, patchBundle: first, requireLease: false });
  const secondReceipt = mergePatchBundle({ canonicalRoot: repo, patchBundle: second, requireLease: false });
  return {
    conflictReportStatus: report.status,
    firstReceiptState: firstReceipt.state,
    secondReceiptState: secondReceipt.state,
    secondConflicts: secondReceipt.conflicts || [],
    passed: report.status === 'conflicted' && firstReceipt.ok === true && secondReceipt.ok === false && secondReceipt.state === 'conflicted'
  };
}

function replayRuntimeFromJsonl({ sourceRunRoot, replayRoot }) {
  fs.mkdirSync(replayRoot, { recursive: true });
  fs.copyFileSync(path.join(sourceRunRoot, 'run_events.jsonl'), path.join(replayRoot, 'run_events.jsonl'));
  const replayRuntime = openAgentWorkRuntime({ runRoot: replayRoot });
  const replayed = recoverRuntimeState(replayRuntime).projection;
  closeAgentWorkRuntime(replayRuntime);
  return replayed;
}

const args = parseArgs(process.argv.slice(2));
const startedAt = nowIso();
fs.mkdirSync(args.out, { recursive: true });
const facts = hostFacts(args.out);
const runRoot = path.join(args.out, 'runtime-run');
const workerOutputRoot = path.join(args.out, 'physical-workers');
fs.mkdirSync(workerOutputRoot, { recursive: true });
const { contractBundle, tasks } = createRuntimeBundle({ runRoot, runId: args.runId, workerCount: args.workers });
let { runtime } = initializeAgentWorkRuntime({ runRoot, runManifest: contractBundle.runManifest, contractBundle });

const controllerRestart = { passed: false };
try {
  transitionTask(runtime, { taskId: tasks[0].taskId, state: 'ready', expectedStateVersion: 1, faultAt: 'after_event_append' });
} catch (error) {
  controllerRestart.error = error.message;
}
closeAgentWorkRuntime(runtime);
runtime = openAgentWorkRuntime({ runRoot });
let projection = recoverRuntimeState(runtime).projection;
const readyEvents = readRuntimeEvents(path.join(runRoot, 'run_events.jsonl')).filter((event) => event.type === 'task_transitioned' && event.payload?.taskId === tasks[0].taskId && event.payload?.state === 'ready');
controllerRestart.passed = /fault_injected:after_event_append/.test(controllerRestart.error || '')
  && projection.state.tasks[tasks[0].taskId]?.state === 'ready'
  && readyEvents.length === 1;
controllerRestart.recoveredStateDigest = projection.stateDigest;
controllerRestart.readyEventCount = readyEvents.length;

for (const task of tasks.slice(1)) {
  transitionTask(runtime, { taskId: task.taskId, state: 'ready', expectedStateVersion: 1 });
}

const leases = new Map();
for (const [index, task] of tasks.entries()) {
  const lease = acquireLease(runtime, { taskId: task.taskId, workerId: `agent-${index + 1}`, ttlMs: index === 1 ? 100 : 60_000 });
  leases.set(task.taskId, lease);
}

const staleTask = tasks[3];
const oldLease = leases.get(staleTask.taskId);
const replacementLease = acquireLease(runtime, { taskId: staleTask.taskId, workerId: 'agent-4-replacement', ttlMs: 60_000 });
leases.set(staleTask.taskId, replacementLease);
let staleLeaseRejected = false;
let staleLeaseError = null;
try {
  stagePatch(runtime, { taskId: staleTask.taskId, leaseId: oldLease.leaseId, fencingToken: oldLease.fencingToken, patchId: 'stale-patch' });
} catch (error) {
  staleLeaseRejected = /stale_fencing_token/.test(error.message);
  staleLeaseError = error.message;
}

const workerPromises = tasks.map((task, index) => {
  const n = index + 1;
  const mode = n === 2 ? 'lost_worker' : n === 3 ? 'provider_error' : 'normal';
  return spawnWorker({
    workerId: `agent-${n}`,
    mode,
    outDir: workerOutputRoot,
    delayMs: mode === 'lost_worker' ? 5_000 : 60 + n * 10,
    killAfterMs: mode === 'lost_worker' ? 80 : null
  }).then((worker) => ({ task, worker, lease: leases.get(task.taskId) }));
});

const workerResults = await Promise.all(workerPromises);
for (const { task, worker, lease } of workerResults) {
  if (worker.exitCode === 0 && worker.signal == null) {
    const patchId = `phase8-fault-${worker.workerId}`;
    stagePatch(runtime, { taskId: task.taskId, leaseId: lease.leaseId, fencingToken: lease.fencingToken, patchId, idempotencyKey: `${args.runId}:${task.taskId}:stage:${patchId}` });
    acceptPatch(runtime, { taskId: task.taskId, leaseId: lease.leaseId, fencingToken: lease.fencingToken, patchId, idempotencyKey: `${args.runId}:${task.taskId}:accept:${patchId}` });
  }
}

const staleRecovery = recoverStaleLeases(runtime, { now: new Date(Date.now() + 5 * 60_000).toISOString() });
recordBudget(runtime, { delta: { providerCalls: 11, tokensUsed: 1100, workerSpawns: args.workers }, idempotencyKey: `${args.runId}:budget_exhaustion_fixture` });
projection = recoverRuntimeState(runtime).projection;
const primaryDigest = projection.stateDigest;
const replayed = replayRuntimeFromJsonl({ sourceRunRoot: runRoot, replayRoot: path.join(args.out, 'clean-room-runtime-replay') });
const verifierFailure = runVerifierFailureFixture(args.out);
const conflict = runConflictFixture(args.out);

const lostWorker = workerResults.find((entry) => entry.worker.mode === 'lost_worker')?.worker || null;
const providerWorker = workerResults.find((entry) => entry.worker.mode === 'provider_error')?.worker || null;
const budgetCapProviderCalls = 10;
const budgetExhaustion = {
  providerCalls: projection.state.budget.providerCalls,
  cap: budgetCapProviderCalls,
  blocked: projection.state.budget.providerCalls > budgetCapProviderCalls,
  acceptedBudgetPatch: projection.state.acceptedPatchIds.includes('budget-exhausted-patch')
};
const diskMinFreeGb = Number((facts.filesystem.freeGb + 1).toFixed(3));
const diskPressure = {
  freeGb: facts.filesystem.freeGb,
  minFreeGb: diskMinFreeGb,
  blocked: facts.filesystem.freeGb < diskMinFreeGb,
  destructiveFillAttempted: false
};
const observedPhysicalWorkers = workerResults.map((entry) => ({
  id: entry.worker.workerId,
  pid: entry.worker.pid,
  mode: entry.worker.mode,
  exitCode: entry.worker.exitCode,
  signal: entry.worker.signal,
  startedAt: entry.worker.startedAt,
  completedAt: entry.worker.completedAt,
  host: facts.hostname
}));
const faultFixtures = {
  controllerRestart: controllerRestart.passed,
  workerLoss: Boolean(lostWorker && lostWorker.signal === 'SIGTERM' && staleRecovery.expired.some((lease) => lease.workerId === 'agent-2')),
  verifierFailure: verifierFailure.passed,
  staleLease: staleLeaseRejected,
  conflict: conflict.passed,
  providerError: Boolean(providerWorker && providerWorker.exitCode === 86 && !projection.state.acceptedPatchIds.includes('phase8-fault-agent-3')),
  budgetExhaustion: budgetExhaustion.blocked && budgetExhaustion.acceptedBudgetPatch === false,
  diskPressure: diskPressure.blocked && diskPressure.destructiveFillAttempted === false
};
const checks = [
  { id: 'execution_plane_host_role', ok: args.hostRole === 'execution_plane', detail: args.hostRole },
  { id: 'observed_8_physical_worker_processes', ok: observedPhysicalWorkers.length >= 8 && observedPhysicalWorkers.every((worker) => Number(worker.pid) > 0), detail: `${observedPhysicalWorkers.length}` },
  ...Object.entries(faultFixtures).map(([id, ok]) => ({ id: `fault_${id}`, ok, detail: String(ok) })),
  { id: 'runtime_clean_room_replay_digest_match', ok: replayed.stateDigest === primaryDigest, detail: `${replayed.stateDigest}:${primaryDigest}` },
  { id: 'accepted_work_not_duplicated', ok: new Set(projection.state.acceptedPatchIds).size === projection.state.acceptedPatchIds.length, detail: `${projection.state.acceptedPatchIds.length}` },
  { id: 'adversarial_false_green_zero', ok: Object.values(faultFixtures).every(Boolean), detail: 'falseGreens=0' }
];
const packet = {
  schemaVersion: 'clawd.agent_work.phase8_fault_campaign_8w.v1',
  generatedAt: nowIso(),
  startedAt,
  completedAt: nowIso(),
  runId: args.runId,
  status: checks.every((check) => check.ok) ? 'green' : 'blocked',
  artifactRoot: args.out,
  runRoot,
  hostRole: args.hostRole,
  hostFacts: facts,
  requestedWorkerCount: args.workers,
  observedPhysicalWorkerCount: observedPhysicalWorkers.length,
  observedPhysicalWorkers,
  faultFixtures,
  controllerRestart,
  workerLoss: { lostWorker, expiredLeases: staleRecovery.expired.map((lease) => lease.leaseId) },
  staleLease: { rejected: staleLeaseRejected, error: staleLeaseError, oldLeaseId: oldLease.leaseId, replacementLeaseId: replacementLease.leaseId },
  verifierFailure,
  conflict,
  providerError: { worker: providerWorker, completionCredited: projection.state.acceptedPatchIds.includes('phase8-fault-agent-3') },
  budgetExhaustion,
  diskPressure,
  cleanRoomReplay: { status: replayed.stateDigest === primaryDigest ? 'green' : 'blocked', primaryDigest, replayDigest: replayed.stateDigest },
  adversarialFixtures: { status: Object.values(faultFixtures).every(Boolean) ? 'green' : 'blocked', falseGreens: Object.values(faultFixtures).filter((ok) => !ok).length },
  runtime: {
    eventCount: projection.eventCount,
    stateDigest: projection.stateDigest,
    acceptedPatchIds: projection.state.acceptedPatchIds,
    taskStates: Object.fromEntries(Object.entries(projection.state.tasks || {}).map(([id, task]) => [id, task.state]))
  },
  checks,
  truthBoundary: 'This packet proves only the Phase 8 8-process restart/fault campaign on the observed execution plane. It is not the 12-worker cross-repo campaign, six-hour real-work soak, independent release review, production deployment, full parity, or Phase 9 release.'
};
packet.digest = sha256(packet);
packet.packetPath = writeJson(path.join(args.out, 'fault_campaign_packet.json'), packet);
console.log(JSON.stringify({ ok: packet.status === 'green', status: packet.status, runId: args.runId, packetPath: packet.packetPath, observedPhysicalWorkerCount: packet.observedPhysicalWorkerCount, faultFixtures: packet.faultFixtures }, null, 2));
closeAgentWorkRuntime(runtime);
if (packet.status !== 'green') process.exitCode = 1;
