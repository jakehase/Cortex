import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deriveCampaignContinuation,
  deriveObjectiveExpansion,
  deriveProgramDecision,
  initializeCampaign,
  installProcessTerminationPersistence,
  persistProcessTerminalState,
  readJson,
  runDelegatedCampaignWorker,
  setSupervisor,
  shouldFinalizeRemoteExecutionMonitor
} from '../packages/campaign-runtime/index.mjs';

test('campaign continuation treats retryable orchestration blockers as continue-next-iteration', () => {
  const decision = deriveCampaignContinuation({
    blocker: 'Partial parity-surface reduction was proven, but remaining red surfaces are still open.',
    blockerKind: 'orchestration',
    nextFocus: ['focus.alpha', 'focus.beta']
  });
  assert.equal(decision.blockerSemantics, 'retryable');
  assert.equal(decision.decision, 'continue_next_iteration');
  assert.equal(decision.shouldContinue, true);
});

test('campaign continuation treats strict claim blockers with no remaining focus as stop-claim-blocked', () => {
  const decision = deriveCampaignContinuation({
    blocker: 'Strict 1:1 parity ceiling is still red.',
    blockerKind: 'strict_1to1_ceiling',
    nextFocus: []
  });
  assert.equal(decision.blockerSemantics, 'claim_blocked');
  assert.equal(decision.decision, 'stop_claim_blocked');
  assert.equal(decision.shouldStop, true);
});

test('campaign continuation does not treat strict claim blockers as work inventory just because nextFocus exists', () => {
  const decision = deriveCampaignContinuation({
    blocker: 'Strict 1:1 parity ceiling is still red.',
    blockerKind: 'strict_1to1_ceiling',
    nextFocus: ['focus.alpha']
  });
  assert.equal(decision.blockerSemantics, 'claim_blocked');
  assert.equal(decision.decision, 'stop_claim_blocked');
  assert.equal(decision.shouldStop, true);
});

test('campaign continuation expands strict claim blocker when shared objective plan has new work', () => {
  const decision = deriveCampaignContinuation({
    blocker: 'Strict 1:1 parity ceiling is still red.',
    blockerKind: 'strict_1to1_ceiling',
    requestedFidelity: 'full_clone',
    matrixStatus: 'all_complete',
    parityStatus: 'blocked',
    currentWorkCount: 0,
    scopeAlreadySatisfied: true,
    nextFocus: [],
    objectiveExpansionPlan: {
      shouldExpand: true,
      reason: 'strict_ceiling_red_objective_expansion_available',
      mode: 'architecture_epic_negative_space',
      expansionWorkUnitCount: 4,
      remainingObjectiveIds: ['rich_client_editor_architecture'],
      truthBoundary: 'shared objective expansion is not completion evidence'
    }
  });
  assert.equal(decision.decision, 'continue_next_iteration');
  assert.equal(decision.blockerSemantics, 'objective_expansion');
  assert.equal(decision.objectiveExpansion.expansionWorkUnitCount, 4);
  assert.equal(decision.shouldContinue, true);
});

test('campaign continuation expands exhausted scoped graph when the large objective remains incomplete', () => {
  const decision = deriveCampaignContinuation({
    blocker: 'Scoped matrix is satisfied, but no live product-work throughput was proven.',
    blockerKind: 'zero_work_scoped_green',
    requestedFidelity: 'full_clone',
    matrixStatus: 'scope_satisfied_zero_work',
    parityStatus: 'not_full_clone',
    currentWorkCount: 0,
    remainingObjectiveIds: ['focus.contacts_table', 'focus.contact_profile']
  });
  assert.equal(decision.decision, 'stop_objective_expansion_required');
  assert.equal(decision.blockerSemantics, 'objective_expansion_required');
  assert.equal(decision.objectiveExpansion.needsExpansion, true);
  assert.equal(decision.objectiveExpansion.shouldExpand, false);
  assert.equal(decision.objectiveExpansion.hasExecutableWork, false);
  assert.deepEqual(decision.objectiveExpansion.remainingObjectiveIds, ['focus.contacts_table', 'focus.contact_profile']);
});

test('objective expansion records missing executable plan instead of treating ids as runnable work', () => {
  const expansion = deriveObjectiveExpansion({
    requestedFidelity: 'full_clone',
    matrixStatus: 'all_complete',
    parityStatus: 'not_full_clone',
    currentWorkCount: 0,
    scopeAlreadySatisfied: true,
    remainingObjectiveIds: ['focus.remaining']
  });
  assert.equal(expansion.needsExpansion, true);
  assert.equal(expansion.shouldExpand, false);
  assert.equal(expansion.hasExecutableWork, false);
  assert.equal(expansion.expansionWorkUnitCount, 0);
  assert.equal(expansion.reason, 'objective_expansion_requires_executable_work_graph');
});

test('campaign continuation prefers stop-green when completion is proven', () => {
  const decision = deriveCampaignContinuation({
    green: true,
    blocker: null,
    blockerKind: null,
    nextFocus: []
  });
  assert.equal(decision.decision, 'stop_green');
});

test('remote execution monitor does not finalize while remote status is still running', () => {
  const decision = shouldFinalizeRemoteExecutionMonitor({
    remoteExecutionStatus: { running: true },
    mirroredTerminal: { terminal: true, blocked: true }
  });
  assert.equal(decision.finalize, false);
  assert.equal(decision.reason, 'remote_running');
});

test('remote execution monitor finalizes once remote status stops and mirrored terminal exists', () => {
  const decision = shouldFinalizeRemoteExecutionMonitor({
    remoteExecutionStatus: { running: false },
    mirroredTerminal: { terminal: true, blocked: true }
  });
  assert.equal(decision.finalize, true);
});

test('remote execution monitor does not finalize when the remote status stopped but remote processes are still alive', () => {
  const decision = shouldFinalizeRemoteExecutionMonitor({
    remoteExecutionStatus: { running: false, childPid: 1234 },
    mirroredTerminal: { terminal: false },
    launcherAlive: true,
    runnerAlive: true
  });
  assert.equal(decision.finalize, false);
  assert.equal(decision.reason, 'remote_process_still_alive');
});

test('program decision keeps a persistent campaign alive when continuation says continue-next-iteration', () => {
  const decision = deriveProgramDecision({
    mode: 'persistent',
    supervisor: {
      status: 'red',
      blocker: { blocker: 'Partial parity-surface reduction was proven, but remaining red surfaces are still open.' },
      blockerKind: 'orchestration'
    },
    nextFocus: ['focus.alpha']
  });
  assert.equal(decision.continuation.decision, 'continue_next_iteration');
  assert.equal(decision.stopAllowed, false);
  assert.equal(decision.shouldRequeue, true);
});

test('program decision requeues persistent campaigns for shared objective expansion', () => {
  const decision = deriveProgramDecision({
    mode: 'persistent',
    objective: {
      requestedFidelity: 'full_clone',
      currentWorkCount: 0,
      scopeAlreadySatisfied: true,
      remainingObjectiveIds: ['focus.remaining'],
      objectiveExpansionPlan: {
        shouldExpand: true,
        expansionWorkUnitCount: 1,
        remainingObjectiveIds: ['focus.remaining'],
        workGraph: { workUnits: [{ id: 'focus.remaining', allowedFiles: ['packages/app/domain-campaigns.mjs'] }] }
      }
    },
    supervisor: {
      status: 'red',
      blocker: { blocker: 'Scoped matrix is mechanically satisfied, but full clone remains red.' },
      blockerKind: 'zero_work_scoped_green',
      matrixStatus: 'scope_satisfied_zero_work',
      parityStatus: 'not_full_clone'
    },
    nextFocus: []
  });
  assert.equal(decision.continuation.blockerSemantics, 'objective_expansion');
  assert.equal(decision.stopAllowed, false);
  assert.equal(decision.shouldRequeue, true);
});

test('program decision blocks zero-work scoped exhaustion until an executable objective plan exists', () => {
  const decision = deriveProgramDecision({
    mode: 'persistent',
    objective: {
      requestedFidelity: 'full_clone',
      currentWorkCount: 0,
      scopeAlreadySatisfied: true,
      remainingObjectiveIds: ['focus.remaining']
    },
    supervisor: {
      status: 'red',
      blocker: { blocker: 'Scoped matrix is mechanically satisfied, but full clone remains red.' },
      blockerKind: 'zero_work_scoped_green',
      matrixStatus: 'scope_satisfied_zero_work',
      parityStatus: 'not_full_clone'
    },
    nextFocus: []
  });
  assert.equal(decision.continuation.blockerSemantics, 'objective_expansion_required');
  assert.equal(decision.continuation.decision, 'stop_objective_expansion_required');
  assert.equal(decision.stopAllowed, true);
  assert.equal(decision.shouldRequeue, false);
});

test('setSupervisor persists shared continuation metadata on the canonical program state', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-runtime-'));
  const statePath = path.join(tmpDir, 'program_state.json');
  initializeCampaign(statePath, { mode: 'persistent' });
  setSupervisor(statePath, {
    status: 'red',
    blocker: { blocker: 'Strict 1:1 parity ceiling is still red.' },
    blockerKind: 'strict_1to1_ceiling',
    matrixStatus: 'partial',
    parityStatus: 'blocked',
    nextFocus: []
  });
  const state = readJson(statePath, null);
  assert.equal(state.supervisor.continuationDecision, 'stop_claim_blocked');
  assert.equal(state.supervisor.continuation.decision, 'stop_claim_blocked');
  assert.equal(state.stopReason, 'supervisor_claim_blocked');
  assert.equal(state.stopAllowed, true);
});

test('process terminal persistence writes program, run-state, and blocker artifacts on failure payloads', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-runtime-terminal-'));
  const artifactRoot = path.join(tmpDir, 'artifacts');
  const written = persistProcessTerminalState({
    artifactRoot,
    payload: { type: 'uncaughtException', error: new Error('synthetic crash') },
    runStateInput: {
      programState: { running: true },
      remoteExecutionStatus: { running: false }
    }
  });

  assert.equal(fs.existsSync(written.programStatePath), true);
  assert.equal(fs.existsSync(written.runStatePath), true);
  assert.equal(fs.existsSync(written.blockerPath), true);
  const program = readJson(written.programStatePath, null);
  assert.equal(program.terminalState, 'blocked_terminal');
  assert.equal(program.stopReason, 'uncaught_exception');
  assert.match(program.error, /synthetic crash/);
});

test('process termination hook persists terminal truth once and forwards artifact paths to caller', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-runtime-hook-'));
  const calls = [];
  const runPersist = installProcessTerminationPersistence({
    artifactRoot: tmpDir,
    getRunStateInput: () => ({ programState: { running: true } }),
    persist: (payload) => calls.push(payload)
  });

  runPersist({ type: 'signal', signal: 'SIGTERM' });
  runPersist({ type: 'signal', signal: 'SIGTERM' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].terminalPersistenceError, null);
  assert.equal(fs.existsSync(path.join(tmpDir, 'program_state.json')), true);
  assert.equal(fs.existsSync(path.join(tmpDir, 'run_state_truth.json')), true);
  const state = readJson(path.join(tmpDir, 'program_state.json'), null);
  assert.equal(state.terminalState, 'operator_stopped');
  assert.equal(state.signal, 'SIGTERM');
  assert.equal(state.stopAllowed, true);
});

test('delegated campaign worker preserves legacy role/phase fields and transport readiness semantics', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-runtime-delegate-'));
  const artifactRoot = path.join(tmpDir, 'artifacts');
  const reportsDir = path.join(artifactRoot, 'reports');
  const workerStatePath = path.join(artifactRoot, 'worker_state.json');
  const statusMirrorPath = path.join(artifactRoot, 'status_mirror.json');
  const logPath = path.join(artifactRoot, 'delegate.log');
  const delegateArtifactRoot = path.join(tmpDir, 'delegate-artifacts');
  const delegateCompletionSummaryPath = path.join(delegateArtifactRoot, 'completion_summary.json');
  const delegateBlockerPath = path.join(delegateArtifactRoot, 'blocker_report.json');
  const delegateProgramStatePath = path.join(delegateArtifactRoot, 'program_state.json');
  const transportStatusPath = path.join(artifactRoot, 'transport_status.json');
  const delegateScript = path.join(tmpDir, 'delegate.mjs');

  fs.mkdirSync(delegateArtifactRoot, { recursive: true });
  fs.writeFileSync(delegateScript, `
import fs from 'node:fs';
fs.mkdirSync(${JSON.stringify(delegateArtifactRoot)}, { recursive: true });
fs.writeFileSync(${JSON.stringify(delegateProgramStatePath)}, JSON.stringify({ running: false, status: 'green' }, null, 2));
fs.writeFileSync(${JSON.stringify(delegateCompletionSummaryPath)}, JSON.stringify({ ok: true }, null, 2));
`);

  const result = await runDelegatedCampaignWorker({
    repoRoot: tmpDir,
    artifactRoot,
    reportsDir,
    workerStatePath,
    logPath,
    statusMirrorPath,
    delegateScript,
    delegateArtifactRoot,
    delegateCompletionSummaryPath,
    delegateBlockerPath,
    delegateProgramStatePath,
    role: 'real_repo_100_agent_orchestrator',
    phase: 'delegated_to_100_agent_path',
    transportStatus: {
      threadBinding: { active: true },
      active: {
        threadBindingReadiness: true,
        externalClawhipRuntimeActive: false
      }
    },
    transportStatusPath,
    heartbeatMs: 10,
    stallTimeoutMs: 1000
  });

  assert.equal(result.ok, true);
  const workerState = readJson(workerStatePath, null);
  const statusMirror = readJson(statusMirrorPath, null);
  assert.equal(workerState.role, 'real_repo_100_agent_orchestrator');
  assert.equal(workerState.phase, 'delegated_to_100_agent_path');
  assert.equal(workerState.threadBindingReady, true);
  assert.equal(workerState.externalClawhipRuntimeActive, false);
  assert.equal(statusMirror.role, 'real_repo_100_agent_orchestrator');
  assert.equal(statusMirror.phase, 'delegated_to_100_agent_path');
  assert.equal(statusMirror.threadBindingReady, true);
  assert.equal(statusMirror.externalClawhipRuntimeActive, false);
});
