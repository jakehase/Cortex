import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function load(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function save(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  return state;
}

function isoNow() {
  return new Date().toISOString();
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function archiveArtifactRoots({ repoRoot, archiveBaseDir, artifactRoots = [], stamp = null, logName = 'launch.log' }) {
  const safeStamp = stamp || new Date().toISOString().replace(/[:]/g, '').replace(/\..+/, '').replace('T', '-').replace(/-/g, '').replace('Z', '');
  const archiveRoot = path.resolve(repoRoot, archiveBaseDir, safeStamp);
  ensureDir(archiveRoot);
  const archived = [];
  for (const artifactRoot of artifactRoots) {
    const source = path.resolve(repoRoot, artifactRoot);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(archiveRoot, path.basename(source));
    fs.cpSync(source, destination, { recursive: true });
    archived.push({ source, destination });
  }
  const logPath = path.join(archiveRoot, logName);
  fs.writeFileSync(logPath, `[${isoNow()}] archived prior run artifacts\n${archived.map((entry) => `${entry.source} -> ${entry.destination}`).join('\n')}\n`);
  return { archiveRoot, archived, logPath };
}

export function runDelegatedCampaignWorker({
  repoRoot,
  artifactRoot,
  reportsDir,
  workerStatePath,
  logPath,
  statusMirrorPath,
  delegateScript,
  delegateArtifactRoot,
  delegateCompletionSummaryPath,
  delegateProgramStatePath,
  delegateBlockerPath,
  role = 'delegated_campaign_worker',
  phase = 'delegated_worker_running',
  threadContext = null,
  transportStatus = null,
  transportStatusPath = null,
  startedAt = null,
  runningNote = 'Delegated campaign worker running.',
  successNote = 'Delegated campaign worker finished successfully.',
  failureNote = 'Delegated campaign worker failed.',
  wrapperFailureNote = 'Delegated campaign worker wrapper failed.',
  startSummary = 'Started delegated campaign worker.',
  finishSummary = 'Delegated campaign worker finished.',
  failSummary = 'Delegated campaign worker failed.',
  wrapperFailSummary = 'Delegated campaign worker wrapper failed.',
  emitSessionEvent = null,
  extraStart = {},
  extraFinish = null,
  maxBuffer = 1024 * 1024 * 200
}) {
  ensureDir(artifactRoot);
  ensureDir(reportsDir);

  const relative = (target) => target ? path.relative(repoRoot, target) : null;
  const updateWorkerState = (patch) => {
    const prior = readJson(workerStatePath, {});
    const next = {
      ...prior,
      role,
      delegateScript: relative(delegateScript),
      delegateArtifactRoot: relative(delegateArtifactRoot),
      threadContext,
      updatedAt: isoNow(),
      ...patch
    };
    return writeJson(workerStatePath, next);
  };

  const startedAtIso = startedAt || readJson(workerStatePath, {})?.startedAt || isoNow();
  updateWorkerState({
    status: 'running',
    phase,
    startedAt: startedAtIso,
    threadBindingReady: transportStatus?.threadBinding?.active || false,
    externalClawhipRuntimeActive: transportStatus?.active?.externalClawhipRuntimeActive || false,
    transportStatusPath: relative(transportStatusPath),
    note: runningNote
  });

  if (emitSessionEvent) {
    emitSessionEvent({
      artifactRoot,
      event: 'session.started',
      summary: startSummary,
      threadContext,
      repoPath: repoRoot,
      extra: {
        delegateScript: relative(delegateScript),
        delegateArtifactRoot: relative(delegateArtifactRoot),
        transportStatus,
        ...extraStart
      }
    });
  }

  writeJson(statusMirrorPath, {
    generatedAt: isoNow(),
    ok: null,
    running: true,
    phase: 'delegate_starting',
    logPath: relative(logPath),
    delegateArtifactRoot: relative(delegateArtifactRoot),
    transportStatusPath: relative(transportStatusPath),
    note: 'Delegate launch started. This file exists immediately so the worker cannot disappear without leaving state.'
  });

  try {
    const startedAtMs = Date.now();
    const result = spawnSync(process.execPath, [delegateScript], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer
    });
    const combinedOutput = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n[spawn-error] ${String(result.error.message || result.error)}` : ''}`;
    fs.writeFileSync(logPath, combinedOutput);

    const delegateSummary = readJson(delegateCompletionSummaryPath, null);
    const delegateProgramState = readJson(delegateProgramStatePath, null);
    const delegateBlocker = readJson(delegateBlockerPath, null);
    const ok = result.status === 0 && !result.error;
    const statusMirror = {
      generatedAt: isoNow(),
      ok,
      running: false,
      exitCode: result.status,
      signal: result.signal,
      spawnError: result.error ? String(result.error.message || result.error) : null,
      durationMs: Date.now() - startedAtMs,
      logPath: relative(logPath),
      delegateArtifactRoot: relative(delegateArtifactRoot),
      delegateCompletionSummary: delegateSummary,
      delegateProgramState,
      delegateBlocker,
      transportStatusPath: relative(transportStatusPath)
    };
    writeJson(statusMirrorPath, statusMirror);

    updateWorkerState({
      status: ok ? 'delegate_finished' : 'delegate_failed',
      phase: ok ? 'awaiting_supervisor_reconcile' : 'delegate_failed',
      finishedAt: isoNow(),
      ok,
      exitCode: result.status,
      signal: result.signal,
      spawnError: result.error ? String(result.error.message || result.error) : null,
      delegateSummaryPath: relative(delegateCompletionSummaryPath),
      delegateProgramStatePath: relative(delegateProgramStatePath),
      delegateBlockerPath: relative(delegateBlockerPath),
      delegateStatusMirrorPath: relative(statusMirrorPath),
      note: ok ? successNote : failureNote
    });

    if (emitSessionEvent) {
      emitSessionEvent({
        artifactRoot,
        event: ok ? 'session.finished' : 'session.failed',
        summary: ok ? finishSummary : failSummary,
        threadContext,
        repoPath: repoRoot,
        extra: {
          ok,
          exitCode: result.status,
          signal: result.signal,
          spawnError: result.error ? String(result.error.message || result.error) : null,
          delegateBlocker,
          delegateSummary,
          ...(typeof extraFinish === 'function' ? extraFinish({ ok, result, delegateSummary, delegateProgramState, delegateBlocker }) : (extraFinish || {}))
        }
      });
    }

    return { ok, statusCode: ok ? 0 : 1, statusMirror };
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    fs.writeFileSync(logPath, `${message}\n`);
    const statusMirror = {
      generatedAt: isoNow(),
      ok: false,
      running: false,
      phase: 'wrapper_exception',
      logPath: relative(logPath),
      delegateArtifactRoot: relative(delegateArtifactRoot),
      wrapperError: message,
      transportStatusPath: relative(transportStatusPath)
    };
    writeJson(statusMirrorPath, statusMirror);
    updateWorkerState({
      status: 'delegate_failed',
      phase: 'wrapper_exception',
      finishedAt: isoNow(),
      ok: false,
      delegateStatusMirrorPath: relative(statusMirrorPath),
      note: wrapperFailureNote
    });
    if (emitSessionEvent) {
      emitSessionEvent({
        artifactRoot,
        event: 'session.failed',
        summary: wrapperFailSummary,
        threadContext,
        repoPath: repoRoot,
        extra: { wrapperError: message }
      });
    }
    return { ok: false, statusCode: 1, statusMirror };
  }
}

export function watchCampaignReadiness({
  programStatePath,
  summaryPath,
  notifyStatePath = null,
  cwd = null,
  notifyArgs = null,
  isReady = (program) => Boolean(program?.stopAllowed && (program?.supervisor?.status === 'green' || program?.supervisor?.blocker)),
  shouldNotify = (program, notification) => Boolean(program?.supervisor?.status === 'green' && notification?.awaitingNotifier && !notification?.delivered)
}) {
  const program = readJson(programStatePath, {});
  const summary = readJson(summaryPath, {});
  const notification = notifyStatePath ? readJson(notifyStatePath, {}) : {};
  const ready = isReady(program, summary, notification);

  if (ready && notifyArgs && shouldNotify(program, notification, summary)) {
    spawnSync(process.execPath, notifyArgs, { cwd, encoding: 'utf8', stdio: 'pipe' });
  }

  return { ready, program, summary, notification };
}

function newIteration(id, input = {}) {
  return {
    id,
    requestedAt: new Date().toISOString(),
    reason: input.reason || 'manual_request',
    note: input.note || null,
    payload: input.payload || {}
  };
}

export function initializeCampaign(filePath, input = {}) {
  const state = {
    version: 2,
    createdAt: new Date().toISOString(),
    mode: input.mode || 'persistent',
    stopCondition: input.stopCondition || 'supervisor_green_or_blocker_report',
    contractPath: input.contractPath || null,
    graphPath: input.graphPath || null,
    matrixPath: input.matrixPath || null,
    ledgerPath: input.ledgerPath || null,
    worker: {
      steps: [],
      lastHeartbeatAt: null,
      activeIteration: null,
      iterations: [],
      nextIterationId: 1,
      queuedIterations: [newIteration(1, { reason: 'campaign_initialized' })],
      shouldRequeue: true,
      requeueCount: 0,
      lastRequeueReason: 'campaign_initialized'
    },
    supervisor: { status: 'red', blocker: null, matrixStatus: null, updatedAt: null },
    notifier: { delivered: false, deliveredAt: null, note: null },
    stopAllowed: false,
    done: false,
    stopReason: 'continue'
  };
  return save(filePath, state);
}

export function recoverCampaign(filePath, seed = {}) {
  if (fs.existsSync(filePath)) return load(filePath);
  return initializeCampaign(filePath, seed);
}

export function requestWorkerIteration(filePath, input = {}) {
  const state = load(filePath);
  const iteration = newIteration(state.worker.nextIterationId, input);
  state.worker.nextIterationId += 1;
  state.worker.queuedIterations.push(iteration);
  state.worker.shouldRequeue = true;
  state.worker.lastRequeueReason = iteration.reason;
  return save(filePath, state);
}

export function claimWorkerIteration(filePath, input = {}) {
  const state = load(filePath);
  const iteration = state.worker.queuedIterations.shift() || newIteration(state.worker.nextIterationId, { reason: input.reason || 'ad_hoc_iteration' });
  if (!state.worker.queuedIterations.length && iteration.id === state.worker.nextIterationId) state.worker.nextIterationId += 1;
  state.worker.activeIteration = {
    ...iteration,
    startedAt: new Date().toISOString(),
    claimedBy: input.claimedBy || 'worker'
  };
  state.worker.shouldRequeue = state.worker.queuedIterations.length > 0;
  state.worker.lastHeartbeatAt = new Date().toISOString();
  return save(filePath, state);
}

export function completeWorkerIteration(filePath, result = {}) {
  const state = load(filePath);
  const active = state.worker.activeIteration || newIteration(state.worker.nextIterationId, { reason: 'implicit_completion' });
  state.worker.iterations.push({
    ...active,
    completedAt: new Date().toISOString(),
    ok: result.ok !== false,
    note: result.note || null,
    outcome: result.outcome || null
  });
  state.worker.activeIteration = null;
  state.worker.lastHeartbeatAt = new Date().toISOString();
  return save(filePath, state);
}

export function updateWorker(filePath, step) {
  const state = load(filePath);
  state.worker.steps.push({ at: new Date().toISOString(), iterationId: state.worker.activeIteration?.id || null, ...step });
  state.worker.lastHeartbeatAt = new Date().toISOString();
  return save(filePath, state);
}

export function deriveStop(state) {
  const supervisorGreen = state.supervisor.status === 'green';
  const blockerStop = state.supervisor.status === 'red' && Boolean(state.supervisor.blocker);
  return {
    stopAllowed: supervisorGreen || blockerStop,
    done: supervisorGreen || blockerStop,
    reason: supervisorGreen ? 'supervisor_green' : blockerStop ? 'supervisor_red_with_blocker' : 'continue',
    shouldRequeue: !supervisorGreen && !blockerStop && state.mode === 'persistent'
  };
}

export function setSupervisor(filePath, input) {
  const state = load(filePath);
  state.supervisor = {
    status: input.status,
    blocker: input.blocker || null,
    matrixStatus: input.matrixStatus || null,
    updatedAt: new Date().toISOString(),
    note: input.note || null
  };
  const derived = deriveStop(state);
  state.stopAllowed = derived.stopAllowed;
  state.done = derived.done;
  state.stopReason = derived.reason;
  state.worker.shouldRequeue = derived.shouldRequeue;
  if (derived.shouldRequeue) {
    state.worker.requeueCount += 1;
    state.worker.lastRequeueReason = input.note || 'supervisor_red_without_blocker';
    if (state.worker.queuedIterations.length === 0) {
      const iteration = newIteration(state.worker.nextIterationId, { reason: 'supervisor_red_without_blocker', note: input.note || null });
      state.worker.nextIterationId += 1;
      state.worker.queuedIterations.push(iteration);
    }
  }
  return save(filePath, state);
}

export function markNotifierDelivered(filePath, note) {
  const state = load(filePath);
  state.notifier = {
    delivered: true,
    deliveredAt: new Date().toISOString(),
    note: note || 'delivered'
  };
  return save(filePath, state);
}

export async function watchCampaign(filePath, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    const state = load(filePath);
    const derived = deriveStop(state);
    if (derived.stopAllowed) return { ...state, ...derived };
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for supervisor_green_or_blocker_report');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export function loadCampaign(filePath) {
  return load(filePath);
}
