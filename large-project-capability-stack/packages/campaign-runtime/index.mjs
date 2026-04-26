import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statMtimeMs(targetPath) {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return null;
  }
}

function transportThreadBindingReady(transportStatus = null) {
  return transportStatus?.threadBindingReady === true
    || transportStatus?.active?.threadBindingReadiness === true
    || transportStatus?.threadBinding?.active === true;
}

function transportExternalRuntimeActive(transportStatus = null) {
  return transportStatus?.externalClawhipRuntimeActive === true
    || transportStatus?.active?.externalClawhipRuntimeActive === true;
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
  const skipped = [];
  for (const artifactRoot of artifactRoots) {
    const source = path.resolve(repoRoot, artifactRoot);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(archiveRoot, path.basename(source));
    try {
      fs.cpSync(source, destination, { recursive: true });
      archived.push({ source, destination });
    } catch (error) {
      skipped.push({
        source,
        destination,
        error: String(error?.message || error)
      });
    }
  }
  const logPath = path.join(archiveRoot, logName);
  fs.writeFileSync(logPath, `[${isoNow()}] archived prior run artifacts\n${archived.map((entry) => `${entry.source} -> ${entry.destination}`).join('\n')}\n${skipped.length ? `\n[skipped]\n${skipped.map((entry) => `${entry.source} -> ${entry.destination} :: ${entry.error}`).join('\n')}\n` : ''}`);
  return { archiveRoot, archived, logPath };
}

export async function runDelegatedCampaignWorker({
  repoRoot,
  artifactRoot,
  reportsDir,
  workerState = {},
  workerStatePath,
  logPath,
  statusMirrorPath,
  delegateScript,
  delegateArtifactRoot,
  delegateCompletionSummaryPath,
  delegateBlockerPath,
  delegateProgramStatePath,
  role = 'delegated_campaign_worker',
  phase = 'delegated_worker_running',
  threadContext = null,
  transportStatus = null,
  transportStatusPath = null,
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
  updateWorkerState = (state) => state,
  heartbeatMs = 1000,
  stallTimeoutMs = 600000,
  delegateWatchPaths = []
}) {
  ensureDir(artifactRoot);
  ensureDir(reportsDir);

  const relative = (target) => target ? path.relative(repoRoot, target) : null;
  const effectiveRole = workerState.role || role;
  const effectivePhase = workerState.phase || phase;
  const startedAt = isoNow();
  const threadBindingReady = transportThreadBindingReady(transportStatus);
  const externalClawhipRuntimeActive = transportExternalRuntimeActive(transportStatus);
  const watchedPaths = [
    ...delegateWatchPaths,
    delegateCompletionSummaryPath,
    delegateProgramStatePath,
    delegateBlockerPath,
    delegateArtifactRoot,
    transportStatusPath
  ].filter(Boolean);
  const statusMirror = {
    generatedAt: startedAt,
    role: effectiveRole,
    phase: effectivePhase,
    startedAt,
    updatedAt: startedAt,
    running: true,
    ok: null,
    repoRoot,
    logPath: relative(logPath),
    delegateScript: relative(delegateScript),
    delegateArtifactRoot: relative(delegateArtifactRoot),
    delegateCompletionSummaryPath: relative(delegateCompletionSummaryPath),
    delegateBlockerPath: relative(delegateBlockerPath),
    delegateProgramStatePath: relative(delegateProgramStatePath),
    threadContext,
    transportStatus,
    transportStatusPath: relative(transportStatusPath),
    threadBindingReady,
    externalClawhipRuntimeActive,
    note: runningNote
  };
  writeJson(statusMirrorPath, statusMirror);

  const initialWorkerState = {
    ...workerState,
    role: effectiveRole,
    status: 'running',
    phase: effectivePhase,
    running: true,
    ok: null,
    delegateRunning: true,
    startedAt,
    updatedAt: startedAt,
    statusMirrorPath,
    artifactRoot,
    delegateScript: relative(delegateScript),
    delegateArtifactRoot: relative(delegateArtifactRoot),
    transportStatus,
    transportStatusPath,
    threadContext,
    threadBindingReady,
    externalClawhipRuntimeActive,
    note: runningNote
  };
  writeJson(workerStatePath, initialWorkerState);
  updateWorkerState(initialWorkerState);

  if (emitSessionEvent) {
    emitSessionEvent({
      artifactRoot,
      event: 'delegate_starting',
      summary: startSummary,
      summaryPath: transportStatusPath,
      reportPath: statusMirrorPath,
      repoPath: repoRoot,
      extra: {
        delegateScript: relative(delegateScript),
        delegateArtifactRoot: relative(delegateArtifactRoot),
        threadContext,
        transportStatus,
        threadBindingReady,
        externalClawhipRuntimeActive,
        ...extraStart
      }
    });
  }

  fs.appendFileSync(logPath, `[${isoNow()}] delegate worker starting script=${relative(delegateScript)}
`);

  const child = spawn(process.execPath, [delegateScript], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  let stdout = '';
  let stderr = '';
  let lastProgressMs = Math.max(Date.now(), ...watchedPaths.map((target) => statMtimeMs(target) || 0));
  child.stdout.on('data', (chunk) => {
    const textChunk = chunk.toString();
    stdout += textChunk;
    lastProgressMs = Date.now();
    fs.appendFileSync(logPath, textChunk);
  });
  child.stderr.on('data', (chunk) => {
    const textChunk = chunk.toString();
    stderr += textChunk;
    lastProgressMs = Date.now();
    fs.appendFileSync(logPath, textChunk);
  });

  let exitCode = null;
  let exitSignal = null;
  let childClosed = false;
  function terminateDelegateTree(signal = 'SIGTERM') {
    if (child.pid == null) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // ignore cleanup failures
      }
    }
  }
  const childDone = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      childClosed = true;
      resolve({ code, signal });
    });
  });

  let stalled = false;
  let stallReason = null;

  try {
    while (!childClosed) {
      const latestProgressMs = Math.max(lastProgressMs, ...watchedPaths.map((target) => statMtimeMs(target) || 0));
      if (latestProgressMs > lastProgressMs) lastProgressMs = latestProgressMs;

      const heartbeatAt = isoNow();
      const heartbeatMirror = {
        ...statusMirror,
        generatedAt: startedAt,
        updatedAt: heartbeatAt,
        running: true,
        ok: null,
        delegatePid: child.pid,
        lastProgressAt: new Date(lastProgressMs).toISOString()
      };
      writeJson(statusMirrorPath, heartbeatMirror);
      const heartbeatState = {
        ...initialWorkerState,
        updatedAt: heartbeatAt,
        lastProgressAt: heartbeatMirror.lastProgressAt,
        delegatePid: child.pid
      };
      writeJson(workerStatePath, heartbeatState);
      updateWorkerState(heartbeatState);

      if (stallTimeoutMs > 0 && Date.now() - lastProgressMs > stallTimeoutMs) {
        stalled = true;
        stallReason = `Delegate stalled with no watched artifact progress for ${stallTimeoutMs}ms.`;
        terminateDelegateTree('SIGTERM');
        break;
      }

      await Promise.race([childDone, sleep(heartbeatMs)]);
    }

    await childDone;

    let blocker = null;
    if (fs.existsSync(delegateBlockerPath)) blocker = load(delegateBlockerPath);
    const completionSummary = fs.existsSync(delegateCompletionSummaryPath) ? load(delegateCompletionSummaryPath) : null;
    const ok = !stalled && exitCode === 0 && (!blocker || blocker.blocker == null);
    const finishedAt = isoNow();
    const finalMirror = {
      ...statusMirror,
      generatedAt: startedAt,
      updatedAt: finishedAt,
      running: false,
      ok,
      exitCode,
      exitSignal,
      stdout,
      stderr,
      blocker,
      completionSummary,
      stalled,
      stallReason,
      delegatePid: child.pid,
      lastProgressAt: new Date(lastProgressMs).toISOString(),
      note: ok ? successNote : failureNote
    };
    writeJson(statusMirrorPath, finalMirror);

    const finalState = {
      ...initialWorkerState,
      status: ok ? 'completed' : 'failed',
      running: false,
      ok,
      delegateRunning: false,
      delegateOk: ok,
      delegateExitCode: exitCode,
      delegateExitSignal: exitSignal,
      updatedAt: finishedAt,
      blocker,
      completionSummary,
      stalled,
      stallReason,
      delegatePid: child.pid,
      lastProgressAt: new Date(lastProgressMs).toISOString(),
      note: ok ? successNote : failureNote
    };
    writeJson(workerStatePath, finalState);
    updateWorkerState(finalState);

    fs.appendFileSync(logPath, `[${isoNow()}] delegate worker finished ok=${ok} exitCode=${exitCode} signal=${exitSignal || 'none'} stalled=${stalled}
`);

    if (emitSessionEvent) {
      emitSessionEvent({
        artifactRoot,
        event: ok ? 'delegate_finished' : 'delegate_failed',
        summary: ok ? finishSummary : failSummary,
        summaryPath: transportStatusPath,
        reportPath: statusMirrorPath,
        repoPath: repoRoot,
        extra: {
          ok,
          exitCode,
          signal: exitSignal,
          stalled,
          stallReason,
          blocker,
          ...(extraFinish || {})
        }
      });
    }

    return { ok, statusCode: ok ? 0 : 1, statusMirror: finalMirror, completionSummary, blocker };
  } catch (error) {
    terminateDelegateTree('SIGTERM');
    const message = error instanceof Error ? error.stack || error.message : String(error);
    const statusMirrorError = {
      ...statusMirror,
      generatedAt: startedAt,
      updatedAt: isoNow(),
      running: false,
      ok: false,
      error: message,
      delegatePid: child.pid,
      stalled,
      stallReason,
      note: wrapperFailureNote
    };
    writeJson(statusMirrorPath, statusMirrorError);
    updateWorkerState({
      ...initialWorkerState,
      status: 'wrapper_failed',
      running: false,
      ok: false,
      delegateRunning: false,
      delegateOk: false,
      delegateExitCode: exitCode,
      delegateExitSignal: exitSignal,
      updatedAt: isoNow(),
      blocker: { blocker: message },
      stalled,
      stallReason,
      delegatePid: child.pid,
      note: wrapperFailureNote
    });
    fs.appendFileSync(logPath, `[${isoNow()}] delegate worker wrapper error ${message}
`);
    if (emitSessionEvent) {
      emitSessionEvent({
        artifactRoot,
        event: 'delegate_wrapper_error',
        summary: wrapperFailSummary,
        summaryPath: transportStatusPath,
        reportPath: statusMirrorPath,
        repoPath: repoRoot,
        extra: { wrapperError: message, stalled, stallReason }
      });
    }
    return { ok: false, statusCode: 1, statusMirror: statusMirrorError };
  }
}

export function deriveCampaignContinuation({
  green = false,
  blocker = null,
  blockerKind = null,
  nextFocus = [],
  syncOk = true,
  workerOk = true,
  supervisorOk = true
} = {}) {
  const normalizedNextFocus = Array.from(new Set((Array.isArray(nextFocus) ? nextFocus : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)));
  const blockerText = typeof blocker === 'string'
    ? blocker.trim()
    : typeof blocker?.blocker === 'string'
      ? blocker.blocker.trim()
      : '';
  const hasBlocker = blockerText.length > 0;
  const retrySafe = syncOk !== false && workerOk !== false && supervisorOk !== false;
  const blockerSemantics = !hasBlocker
    ? 'none'
    : blockerKind === 'strict_1to1_ceiling'
      ? 'claim_blocked'
      : normalizedNextFocus.length > 0 && retrySafe
        ? 'retryable'
        : 'terminal';
  const decision = green
    ? 'stop_green'
    : blockerSemantics === 'claim_blocked'
      ? normalizedNextFocus.length > 0 ? 'continue_next_iteration' : 'stop_claim_blocked'
      : blockerSemantics === 'retryable'
        ? 'continue_next_iteration'
        : hasBlocker
          ? 'stop_blocked'
          : normalizedNextFocus.length > 0
            ? 'continue_next_iteration'
            : 'stop_blocked';
  return {
    green: Boolean(green),
    hasBlocker,
    blockerKind: blockerKind || null,
    blockerSemantics,
    nextFocus: normalizedNextFocus,
    decision,
    shouldContinue: decision === 'continue_next_iteration',
    shouldStop: decision !== 'continue_next_iteration'
  };
}

export function shouldFinalizeRemoteExecutionMonitor({
  remoteExecutionStatus = null,
  mirroredTerminal = null,
  remoteWatchdog = null,
  launcherAlive = null,
  runnerAlive = null
} = {}) {
  if (remoteWatchdog) return { finalize: true, reason: 'watchdog' };
  if (remoteExecutionStatus?.running === true) return { finalize: false, reason: 'remote_running' };
  if (mirroredTerminal?.terminal) return { finalize: true, reason: 'mirrored_terminal' };
  if (launcherAlive === true || runnerAlive === true) return { finalize: false, reason: 'remote_process_still_alive' };
  if (remoteExecutionStatus?.running === false) return { finalize: true, reason: 'remote_stopped' };
  return { finalize: false, reason: 'await_remote_status' };
}

export function installProcessTerminationPersistence({ persist } = {}) {
  let persisted = false;
  const runPersist = (payload) => {
    if (persisted) return;
    persisted = true;
    try {
      persist?.(payload);
    } catch {}
  };

  process.once('SIGTERM', () => {
    runPersist({ type: 'signal', signal: 'SIGTERM' });
    process.exit(143);
  });
  process.once('SIGINT', () => {
    runPersist({ type: 'signal', signal: 'SIGINT' });
    process.exit(130);
  });
  process.once('uncaughtException', (error) => {
    runPersist({ type: 'uncaughtException', error: error instanceof Error ? error.stack || error.message : String(error) });
    throw error;
  });
  process.once('unhandledRejection', (reason) => {
    runPersist({ type: 'unhandledRejection', error: reason instanceof Error ? reason.stack || reason.message : String(reason) });
    throw reason;
  });

  return runPersist;
}

export function watchCampaignReadiness({
  programStatePath,
  summaryPath,
  notifyStatePath = null,
  cwd = null,
  notifyArgs = null,
  isReady = (program) => Boolean(program?.stopAllowed && (program?.supervisor?.status === 'green' || program?.supervisor?.blocker)),
  shouldNotify = (program, notification) => Boolean(program?.stopAllowed && notification?.awaitingNotifier && !notification?.delivered)
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

export function deriveProgramDecision(state = {}) {
  const continuation = deriveCampaignContinuation({
    green: state?.supervisor?.status === 'green',
    blocker: state?.supervisor?.blocker || null,
    blockerKind: state?.supervisor?.blockerKind || null,
    nextFocus: state?.nextFocus || []
  });
  const reason = continuation.decision === 'stop_green'
    ? 'supervisor_green'
    : continuation.decision === 'stop_claim_blocked'
      ? 'supervisor_claim_blocked'
      : continuation.decision === 'stop_blocked'
        ? 'supervisor_red_with_blocker'
        : 'continue';
  return {
    continuation,
    stopAllowed: continuation.shouldStop,
    done: continuation.shouldStop,
    reason,
    shouldRequeue: continuation.shouldContinue && state.mode === 'persistent'
  };
}

export function deriveStop(state) {
  return deriveProgramDecision(state);
}

export function setSupervisor(filePath, input) {
  const state = load(filePath);
  if (Array.isArray(input.nextFocus)) {
    state.nextFocus = Array.from(new Set(input.nextFocus.map((entry) => String(entry || '').trim()).filter(Boolean)));
  }
  state.supervisor = {
    status: input.status,
    blocker: input.blocker || null,
    blockerKind: input.blockerKind || null,
    matrixStatus: input.matrixStatus || null,
    parityStatus: input.parityStatus || null,
    updatedAt: new Date().toISOString(),
    note: input.note || null
  };
  const derived = deriveProgramDecision(state);
  state.supervisor.continuationDecision = input.continuationDecision || derived.continuation.decision;
  state.supervisor.continuation = {
    ...derived.continuation,
    ...(input.continuation || {})
  };
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
