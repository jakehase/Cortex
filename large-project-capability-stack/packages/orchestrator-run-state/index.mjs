import fs from 'node:fs';
import path from 'node:path';

const TERMINAL_STATES = new Set([
  'threshold_pass',
  'blocked_retryable',
  'blocked_terminal',
  'claim_blocked',
  'timeout_incomplete',
  'operator_stopped',
  'contradiction_blocked'
]);

function nowIso() {
  return new Date().toISOString();
}

function parseTime(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function ageMs(value, now = Date.now()) {
  const parsed = parseTime(value);
  return parsed == null ? null : Math.max(0, now - parsed);
}

function text(value = '') {
  return String(value || '').trim();
}

function hasBlocker(blocker = null) {
  if (!blocker) return false;
  if (typeof blocker === 'string') return text(blocker).length > 0;
  return text(blocker.blocker || blocker.message || blocker.reason || '').length > 0;
}

function statusOf(input = {}) {
  if (!input) return null;
  if (input.status) return String(input.status);
  if (input.phase) return String(input.phase);
  if (input.running === true) return 'running';
  if (input.terminal === true || input.done === true || input.stopAllowed === true) return 'terminal';
  if (input.ok === true) return 'ok';
  if (input.ok === false) return 'failed';
  return null;
}

function componentState(name, input = {}, { now = Date.now(), staleAfterMs = 5 * 60_000 } = {}) {
  const heartbeatAt = input?.heartbeatAt || input?.updatedAt || input?.generatedAt || input?.lastHeartbeatAt || input?.lastProgressAt || null;
  const heartbeatAgeMs = ageMs(heartbeatAt, now);
  const stale = heartbeatAgeMs != null && staleAfterMs > 0 && heartbeatAgeMs > staleAfterMs;
  const running = input?.running === true || input?.active === true;
  const terminal = input?.terminal === true || input?.done === true || input?.running === false || input?.stopAllowed === true;
  const ok = input?.ok ?? input?.pass ?? null;
  return {
    name,
    present: Boolean(input && Object.keys(input || {}).length > 0),
    status: statusOf(input),
    running,
    terminal,
    ok,
    heartbeatAt,
    heartbeatAgeMs,
    stale,
    raw: input || null
  };
}

export function detectRunTruthContradictions(input = {}, options = {}) {
  const now = options.now || Date.now();
  const staleAfterMs = options.staleAfterMs || 5 * 60_000;
  const local = componentState('local_runner', input.localRunnerStatus || input.programState || {}, { now, staleAfterMs });
  const remote = componentState('remote_execution', input.remoteExecutionStatus || {}, { now, staleAfterMs });
  const worker = componentState('worker_farm', input.workerFarmStatus || input.orchestratorSummary || {}, { now, staleAfterMs });
  const supervisor = input.supervisorStatus || input.supervisor || {};
  const threshold = input.thresholdEvaluation || {};
  const matrix = input.surfaceMatrix || {};
  const claimLedger = input.claimLedger || input.supervisor?.claimLedger || {};
  const completion = input.completionSummary || {};
  const contradictions = [];

  const remoteHeartbeatFresh = remote.heartbeatAgeMs == null || remote.heartbeatAgeMs <= staleAfterMs;
  if (local.present && (local.terminal || local.running === false) && remote.running === true && remoteHeartbeatFresh) {
    contradictions.push({
      type: 'local_stopped_while_remote_running',
      severity: 'fatal',
      local: { running: local.running, terminal: local.terminal, status: local.status },
      remote: { running: remote.running, heartbeatAt: remote.heartbeatAt, heartbeatAgeMs: remote.heartbeatAgeMs }
    });
  }
  if (local.running === true && local.stale) {
    contradictions.push({ type: 'local_running_status_stale', severity: 'fatal', heartbeatAt: local.heartbeatAt, heartbeatAgeMs: local.heartbeatAgeMs });
  }
  if (remote.running === true && remote.stale) {
    contradictions.push({ type: 'remote_running_status_stale', severity: 'fatal', heartbeatAt: remote.heartbeatAt, heartbeatAgeMs: remote.heartbeatAgeMs });
  }
  const supervisorGreen = supervisor?.topLevel?.status === 'green' || supervisor?.supervisorStatus === 'green' || supervisor?.status === 'green';
  const thresholdPass = threshold?.thresholdPass === true || completion?.thresholdPass === true;
  const soakingAfterGreen = input.soaking === true || completion?.soaking === true || completion?.status === 'soaking_after_green';
  if (supervisorGreen && thresholdPass === false && !soakingAfterGreen) {
    contradictions.push({ type: 'supervisor_green_threshold_red', severity: 'fatal', supervisorStatus: 'green', thresholdPass });
  }
  const matrixGreen = ['all_complete', 'orchestrator_green', 'green'].includes(String(matrix?.status || matrix?.matrixStatus || ''));
  const claimRed = claimLedger?.summary?.status === 'red' || claimLedger?.status === 'red' || Number(claimLedger?.summary?.counterclaimedCount || 0) > 0;
  if (matrixGreen && claimRed) {
    contradictions.push({ type: 'matrix_green_claim_ledger_red', severity: 'fatal', matrixStatus: matrix?.status || matrix?.matrixStatus, claimLedgerStatus: claimLedger?.summary?.status || claimLedger?.status });
  }
  const blocker = input.blocker || completion?.blocker || null;
  if (thresholdPass && hasBlocker(blocker)) {
    contradictions.push({ type: 'threshold_pass_with_blocker', severity: 'fatal', blocker });
  }
  const terminalArtifactClaim = completion?.terminal === true
    || completion?.done === true
    || completion?.running === false
    || thresholdPass
    || hasBlocker(blocker);
  if (remote.running === true && remoteHeartbeatFresh && terminalArtifactClaim) {
    contradictions.push({
      type: 'terminal_artifact_while_remote_running',
      severity: 'fatal',
      remote: { running: remote.running, heartbeatAt: remote.heartbeatAt, heartbeatAgeMs: remote.heartbeatAgeMs },
      completion: {
        terminal: completion?.terminal ?? null,
        done: completion?.done ?? null,
        running: completion?.running ?? null,
        thresholdPass,
        blockerPresent: hasBlocker(blocker)
      }
    });
  }
  const parityStatus = input.parityStatus || completion?.parityStatus || input.supervisor?.parityStatus || null;
  const requestedFidelity = input.requestedFidelity || completion?.requestedFidelity || input.contract?.fidelity || null;
  if (['full_clone', 'full'].includes(String(requestedFidelity || '')) && completion?.claimedComplete === true && !['full', 'full_clone'].includes(String(parityStatus || ''))) {
    contradictions.push({ type: 'full_clone_claim_without_parity_evidence', severity: 'fatal', requestedFidelity, parityStatus });
  }
  if (worker.running === true && worker.stale) {
    contradictions.push({ type: 'worker_farm_running_status_stale', severity: 'fatal', heartbeatAt: worker.heartbeatAt, heartbeatAgeMs: worker.heartbeatAgeMs });
  }
  return contradictions;
}

function classifyBlocker(blocker = null, input = {}) {
  const kind = text(input.blockerKind || blocker?.kind || blocker?.blockerKind || blocker?.family || input.blockerFamily);
  const retryable = blocker?.retryable === true || input.retryable === true || kind === 'retryable' || kind.endsWith('_retryable');
  const claimBlocked = input.claimBlocked === true
    || blocker?.claimBlocked === true
    || ['strict_1to1_ceiling', 'claim_blocked', 'strict_claim_blocked'].includes(kind)
    || /strict[_ -]?1:?1|1:1.*ceiling|claim[_ -]?blocked/i.test(kind)
    || /strict\s+1:1\s+(parity\s+)?ceiling|full-clone claim remains blocked|cannot be treated as full-clone complete/i.test(text(blocker?.blocker || blocker?.message || blocker?.reason || ''));
  if (claimBlocked) return 'claim_blocked';
  if (retryable) return 'blocked_retryable';
  return 'blocked_terminal';
}

export function reduceRunState(input = {}, options = {}) {
  const generatedAt = options.generatedAt || nowIso();
  const now = parseTime(generatedAt) || Date.now();
  const staleAfterMs = options.staleAfterMs || input.staleAfterMs || 5 * 60_000;
  const local = componentState('local_runner', input.localRunnerStatus || input.programState || {}, { now, staleAfterMs });
  const remote = componentState('remote_execution', input.remoteExecutionStatus || {}, { now, staleAfterMs });
  const worker = componentState('worker_farm', input.workerFarmStatus || input.orchestratorSummary || {}, { now, staleAfterMs });
  const artifactSync = componentState('artifact_sync', input.artifactSyncStatus || {}, { now, staleAfterMs });
  const terminalizer = componentState('terminalizer', input.terminalizerStatus || {}, { now, staleAfterMs });
  const supervisorStatus = input.supervisorStatus || input.supervisor || {};
  const completion = input.completionSummary || {};
  const threshold = input.thresholdEvaluation || {};
  const blocker = input.blocker || completion.blocker || null;
  const contradictions = detectRunTruthContradictions(input, { now, staleAfterMs });
  const thresholdPass = input.thresholdPass === true || threshold.thresholdPass === true || completion.thresholdPass === true;
  const mechanicalGreen = input.mechanicalGreen === true || completion.mechanicalGreen === true;
  const scaleProofReady = input.scaleProofReady === true || completion.scaleProofReady === true;
  const supervisorGreen = supervisorStatus?.topLevel?.status === 'green' || supervisorStatus?.supervisorStatus === 'green' || supervisorStatus?.status === 'green';
  const timedOut = input.timedOut === true || completion.stopReason === 'timeout_incomplete' || completion.timeoutIncomplete === true;
  const operatorStopped = input.operatorStopped === true || completion.stopReason === 'operator_stopped' || input.signal === 'SIGINT';
  const soaking = input.soaking === true || completion.soaking === true || completion.status === 'soaking_after_green';
  let terminalState = 'running';
  let running = local.running || remote.running || worker.running;
  let stopAllowed = false;
  let ok = false;

  if (contradictions.length) {
    terminalState = 'contradiction_blocked';
    running = false;
    stopAllowed = true;
  } else if (operatorStopped) {
    terminalState = 'operator_stopped';
    running = false;
    stopAllowed = true;
  } else if (timedOut) {
    terminalState = 'timeout_incomplete';
    running = false;
    stopAllowed = true;
  } else if (soaking && supervisorGreen) {
    terminalState = 'soaking_after_green';
    running = true;
    stopAllowed = false;
  } else if (thresholdPass && supervisorGreen && mechanicalGreen && scaleProofReady) {
    terminalState = 'threshold_pass';
    running = false;
    stopAllowed = true;
    ok = true;
  } else if (hasBlocker(blocker)) {
    terminalState = classifyBlocker(blocker, input);
    running = false;
    stopAllowed = true;
  } else if (remote.running === true) {
    terminalState = 'waiting_remote';
    running = true;
  } else if (worker.running === true || local.running === true) {
    terminalState = 'running';
    running = true;
  } else if (supervisorGreen && !thresholdPass) {
    terminalState = 'blocked_terminal';
    running = false;
    stopAllowed = true;
  } else if (local.terminal || completion.generatedAt) {
    terminalState = 'blocked_terminal';
    running = false;
    stopAllowed = true;
  }

  return {
    schemaVersion: 'claw.run_state_truth.v1',
    generatedAt,
    terminalState,
    terminal: TERMINAL_STATES.has(terminalState),
    running,
    ok,
    stopAllowed,
    components: { localRunner: local, remoteExecution: remote, workerFarm: worker, artifactSync, terminalizer },
    truth: { mechanicalGreen, scaleProofReady, supervisorGreen, thresholdPass, blockerPresent: hasBlocker(blocker), contradictionCount: contradictions.length },
    blocker: hasBlocker(blocker) ? blocker : null,
    contradictions,
    nextAction: deriveNextAction({ terminalState, contradictions, blocker, remote })
  };
}

function deriveNextAction({ terminalState, contradictions = [], blocker = null, remote = {} } = {}) {
  if (terminalState === 'threshold_pass') return 'write_completion_summary_and_stop';
  if (terminalState === 'contradiction_blocked') return `write_blocker_report_for_truth_contradictions:${contradictions.map((entry) => entry.type).join(',')}`;
  if (terminalState === 'waiting_remote') return remote.running ? 'wait_for_remote_execution_heartbeat_or_terminal_artifact' : 'wait_for_remote_status';
  if (terminalState === 'blocked_retryable') return 'repair_retryable_blocker_then_continue_or_rerun';
  if (terminalState === 'claim_blocked') return 'stop_claim_blocked_without_completion_claim';
  if (terminalState === 'timeout_incomplete') return 'write_timeout_blocker_and_preserve_resume_artifacts';
  if (terminalState === 'operator_stopped') return 'write_operator_stopped_terminal_state';
  if (terminalState === 'soaking_after_green') return 'continue_soak_until_duration_or_blocker';
  if (terminalState === 'blocked_terminal') return hasBlocker(blocker) ? 'write_terminal_blocker_report' : 'write_blocker_report_for_incomplete_run';
  return 'continue_monitoring';
}

export function deriveContinuationDecision(input = {}) {
  const runState = input.runState || reduceRunState(input);
  if (runState.terminalState === 'threshold_pass') return { decision: 'must_stop_green', shouldContinue: false, shouldStop: true, reason: 'threshold_pass' };
  if (runState.terminalState === 'soaking_after_green') return { decision: 'continue_soaking', shouldContinue: true, shouldStop: false, reason: 'soaking_after_green' };
  if (runState.terminalState === 'waiting_remote') return { decision: 'must_wait_for_remote', shouldContinue: false, shouldStop: false, reason: 'remote_execution_running' };
  if (runState.terminalState === 'blocked_retryable') return { decision: 'may_continue_after_repair', shouldContinue: true, shouldStop: false, reason: 'retryable_blocker' };
  if (runState.terminalState === 'claim_blocked') return { decision: 'must_stop_claim_blocked', shouldContinue: false, shouldStop: true, reason: 'claim_blocked' };
  if (runState.terminal || runState.terminalState === 'blocked_terminal') return { decision: 'must_stop_blocked', shouldContinue: false, shouldStop: true, reason: runState.terminalState };
  return { decision: 'continue_monitoring', shouldContinue: true, shouldStop: false, reason: runState.terminalState };
}

function normalizeIds(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)));
}

function objectiveExpansionWorkCount(expansion = null) {
  const direct = Number(expansion?.expansionWorkUnitCount ?? expansion?.executableWorkUnitCount ?? NaN);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const graphCount = Array.isArray(expansion?.workGraph?.workUnits) ? expansion.workGraph.workUnits.length : 0;
  return graphCount > 0 ? graphCount : 0;
}

export function deriveTopLevelIterationDecision(input = {}) {
  const runState = input.runState || reduceRunState(input);
  const nextFocus = normalizeIds(input.nextFocus || input.remainingObjectiveIds || input.objectiveExpansion?.remainingObjectiveIds || []);
  const repairApplied = input.repairApplied === true || input.blockerRepaired === true;
  const safeToLaunch = input.safeToLaunch !== false;
  if (runState.terminalState === 'waiting_remote' || (runState.running === true && !runState.terminal)) {
    return {
      decision: 'must_wait_active_run',
      mayStart: false,
      shouldContinue: false,
      shouldStop: false,
      reason: runState.terminalState === 'waiting_remote' ? 'remote_execution_running' : 'run_still_active',
      runState,
      nextFocus
    };
  }
  if (runState.terminalState === 'threshold_pass') {
    return { decision: 'must_stop_green', mayStart: false, shouldContinue: false, shouldStop: true, reason: 'threshold_pass', runState, nextFocus };
  }
  if (runState.terminalState === 'claim_blocked') {
    const expansionIds = normalizeIds(input.objectiveExpansion?.remainingObjectiveIds || input.objectiveExpansion?.nextFocus || []);
    const expansionWorkCount = objectiveExpansionWorkCount(input.objectiveExpansion);
    const explicitObjectiveExpansion = input.objectiveExpansion?.shouldExpand === true && expansionIds.length > 0 && expansionWorkCount > 0;
    const provenProgressOverride = input.productProgressOverride === true || input.provenProductProgress === true;
    if (safeToLaunch && (explicitObjectiveExpansion || provenProgressOverride)) {
      return {
        decision: 'may_start_next_iteration',
        mayStart: true,
        shouldContinue: true,
        shouldStop: false,
        reason: explicitObjectiveExpansion ? 'claim_blocked_but_explicit_objective_expansion' : 'claim_blocked_but_proven_product_progress_override',
        runState,
        nextFocus: nextFocus.length > 0 ? nextFocus : expansionIds,
        objectiveExpansionWorkCount: expansionWorkCount
      };
    }
    const missingExecutableExpansion = input.objectiveExpansion?.shouldExpand === true && expansionIds.length > 0 && expansionWorkCount === 0;
    return {
      decision: 'must_stop_claim_blocked',
      mayStart: false,
      shouldContinue: false,
      shouldStop: true,
      reason: missingExecutableExpansion ? 'objective_expansion_missing_executable_work' : 'claim_blocked_is_not_work_inventory',
      runState,
      nextFocus,
      objectiveExpansionWorkCount: expansionWorkCount
    };
  }
  if (runState.terminalState === 'blocked_retryable') {
    const mayStart = repairApplied && safeToLaunch && nextFocus.length > 0;
    return {
      decision: mayStart ? 'may_start_next_iteration' : 'repair_before_next_iteration',
      mayStart,
      shouldContinue: mayStart,
      shouldStop: !mayStart,
      reason: mayStart ? 'retryable_blocker_repaired_with_next_focus' : 'retryable_blocker_requires_repair_before_launch',
      runState,
      nextFocus
    };
  }
  if (runState.terminalState === 'contradiction_blocked') {
    return { decision: 'must_stop_truth_contradiction', mayStart: false, shouldContinue: false, shouldStop: true, reason: 'truth_contradiction_requires_audit', runState, nextFocus };
  }
  if (runState.terminal || runState.terminalState === 'blocked_terminal') {
    return { decision: 'must_stop_blocked', mayStart: false, shouldContinue: false, shouldStop: true, reason: runState.terminalState, runState, nextFocus };
  }
  return {
    decision: nextFocus.length > 0 && safeToLaunch ? 'may_start_next_iteration' : 'continue_monitoring',
    mayStart: nextFocus.length > 0 && safeToLaunch,
    shouldContinue: nextFocus.length > 0 && safeToLaunch,
    shouldStop: false,
    reason: runState.terminalState,
    runState,
    nextFocus
  };
}

export function buildTerminalStateWrite({ runState, previousState = {}, reason = null, signal = null, error = null, generatedAt = nowIso() } = {}) {
  const state = runState || reduceRunState(previousState, { generatedAt });
  return {
    schemaVersion: 'claw.terminal_program_state.v1',
    generatedAt,
    status: state.ok ? 'passed' : state.terminal ? 'blocked' : 'running',
    terminalState: state.terminalState,
    running: state.running,
    done: state.terminal,
    ok: state.ok,
    stopAllowed: state.stopAllowed,
    stopReason: reason || state.terminalState,
    signal: signal || null,
    error: error ? (error instanceof Error ? error.stack || error.message : String(error)) : null,
    blocker: state.blocker,
    contradictions: state.contradictions,
    nextAction: state.nextAction,
    previousState
  };
}

export function writeTerminalStateArtifacts({ artifactRoot, runState, reason = null, signal = null, error = null, programStateName = 'program_state.json', runStateName = 'run_state_truth.json', blockerName = 'blocker_report.json' } = {}) {
  if (!artifactRoot) throw new Error('artifactRoot is required');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const state = runState || reduceRunState({});
  const terminalWrite = buildTerminalStateWrite({ runState: state, reason, signal, error });
  const programStatePath = path.join(artifactRoot, programStateName);
  const runStatePath = path.join(artifactRoot, runStateName);
  fs.writeFileSync(programStatePath, `${JSON.stringify(terminalWrite, null, 2)}\n`);
  fs.writeFileSync(runStatePath, `${JSON.stringify(state, null, 2)}\n`);
  let blockerPath = null;
  if (!state.ok && state.terminal) {
    blockerPath = path.join(artifactRoot, blockerName);
    fs.writeFileSync(blockerPath, `${JSON.stringify({
      generatedAt: terminalWrite.generatedAt,
      status: 'blocked',
      terminalState: state.terminalState,
      blocker: state.blocker?.blocker || state.nextAction,
      nextAction: state.nextAction,
      contradictions: state.contradictions
    }, null, 2)}\n`);
  }
  return { programStatePath, runStatePath, blockerPath, terminalWrite };
}
