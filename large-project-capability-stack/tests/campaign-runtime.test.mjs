import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deriveCampaignContinuation,
  deriveProgramDecision,
  initializeCampaign,
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
