import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildTerminalStateWrite,
  deriveContinuationDecision,
  deriveTopLevelIterationDecision,
  detectRunTruthContradictions,
  reduceRunState,
  writeTerminalStateArtifacts
} from '../packages/orchestrator-run-state/index.mjs';

const generatedAt = '2026-05-16T22:00:00.000Z';
const freshHeartbeat = '2026-05-16T21:59:45.000Z';

test('run-state reducer stops green only when threshold, supervisor, mechanical, and scale truth agree', () => {
  const runState = reduceRunState({
    programState: { running: false, done: true, stopAllowed: true },
    supervisorStatus: { topLevel: { status: 'green' } },
    thresholdEvaluation: { thresholdPass: true },
    completionSummary: { thresholdPass: true, mechanicalGreen: true, scaleProofReady: true }
  }, { generatedAt });

  assert.equal(runState.terminalState, 'threshold_pass');
  assert.equal(runState.terminal, true);
  assert.equal(runState.ok, true);
  assert.equal(deriveContinuationDecision({ runState }).decision, 'must_stop_green');
});

test('run-state reducer allows scoped threshold pass when scale proof is explicitly not required', () => {
  const runState = reduceRunState({
    programState: { running: false, done: true, stopAllowed: true },
    supervisorStatus: { status: 'green' },
    thresholdEvaluation: { thresholdPass: true, scaleProofRequired: false },
    completionSummary: { thresholdPass: true, mechanicalGreen: true, scaleProofReady: false, scaleProofRequired: false }
  }, { generatedAt });

  assert.equal(runState.terminalState, 'threshold_pass');
  assert.equal(runState.ok, true);
  assert.equal(runState.truth.scaleProofRequired, false);
  assert.equal(runState.truth.scaleProofSatisfied, true);
});

test('run-state reducer detects local stopped while remote execution heartbeat is still running', () => {
  const contradictions = detectRunTruthContradictions({
    programState: { running: false, done: true, updatedAt: freshHeartbeat },
    remoteExecutionStatus: { running: true, heartbeatAt: freshHeartbeat }
  }, { now: Date.parse(generatedAt), staleAfterMs: 60_000 });

  assert.equal(contradictions.some((entry) => entry.type === 'local_stopped_while_remote_running'), true);
  const runState = reduceRunState({
    programState: { running: false, done: true, updatedAt: freshHeartbeat },
    remoteExecutionStatus: { running: true, heartbeatAt: freshHeartbeat }
  }, { generatedAt, staleAfterMs: 60_000 });
  assert.equal(runState.terminalState, 'contradiction_blocked');
  assert.match(runState.nextAction, /truth_contradictions/);
});

test('run-state reducer blocks terminal artifacts while remote execution heartbeat is still running', () => {
  const runState = reduceRunState({
    programState: { running: true, updatedAt: freshHeartbeat },
    remoteExecutionStatus: { running: true, heartbeatAt: freshHeartbeat },
    completionSummary: { running: false, done: true, thresholdPass: true, mechanicalGreen: true, scaleProofReady: true },
    supervisorStatus: { topLevel: { status: 'green' } },
    thresholdEvaluation: { thresholdPass: true }
  }, { generatedAt, staleAfterMs: 60_000 });

  assert.equal(runState.terminalState, 'contradiction_blocked');
  assert.equal(runState.contradictions.some((entry) => entry.type === 'terminal_artifact_while_remote_running'), true);
  assert.equal(deriveTopLevelIterationDecision({ runState, nextFocus: ['focus.next'] }).decision, 'must_stop_truth_contradiction');
});

test('supervisor green plus threshold red becomes contradiction-blocked, not completion', () => {
  const runState = reduceRunState({
    programState: { running: false, done: true },
    supervisorStatus: { topLevel: { status: 'green' } },
    thresholdEvaluation: { thresholdPass: false },
    completionSummary: { thresholdPass: false, mechanicalGreen: true, scaleProofReady: true }
  }, { generatedAt });

  assert.equal(runState.terminalState, 'contradiction_blocked');
  assert.equal(runState.contradictions.some((entry) => entry.type === 'supervisor_green_threshold_red'), true);
  assert.equal(deriveContinuationDecision({ runState }).decision, 'must_stop_blocked');
});

test('matrix green with failed claim ledger is contradiction-blocked', () => {
  const runState = reduceRunState({
    programState: { running: false, done: true },
    surfaceMatrix: { status: 'all_complete' },
    claimLedger: { summary: { status: 'red', counterclaimedCount: 1 } },
    completionSummary: { thresholdPass: false, mechanicalGreen: true, scaleProofReady: true }
  }, { generatedAt });

  assert.equal(runState.terminalState, 'contradiction_blocked');
  assert.equal(runState.contradictions.some((entry) => entry.type === 'matrix_green_claim_ledger_red'), true);
});

test('run-state reducer distinguishes soaking, retryable blockers, claim blockers, timeout, and remote wait', () => {
  assert.equal(reduceRunState({
    programState: { running: true },
    supervisorStatus: { topLevel: { status: 'green' } },
    completionSummary: { soaking: true }
  }, { generatedAt }).terminalState, 'soaking_after_green');

  assert.equal(reduceRunState({
    blocker: { blocker: 'Transient verifier outage', retryable: true }
  }, { generatedAt }).terminalState, 'blocked_retryable');

  assert.equal(reduceRunState({
    blocker: { blocker: 'Strict 1:1 ceiling red', kind: 'strict_1to1_ceiling' }
  }, { generatedAt }).terminalState, 'claim_blocked');

  assert.equal(reduceRunState({ timedOut: true }, { generatedAt }).terminalState, 'timeout_incomplete');
  assert.equal(reduceRunState({ remoteExecutionStatus: { running: true, heartbeatAt: freshHeartbeat } }, { generatedAt }).terminalState, 'waiting_remote');
});

test('top-level iteration decision will not launch from active remote or bare claim-blocked states', () => {
  const remoteRunning = reduceRunState({
    remoteExecutionStatus: { running: true, heartbeatAt: freshHeartbeat }
  }, { generatedAt, staleAfterMs: 60_000 });
  assert.equal(deriveTopLevelIterationDecision({ runState: remoteRunning, nextFocus: ['focus.next'] }).decision, 'must_wait_active_run');

  const claimBlocked = reduceRunState({
    blocker: { blocker: 'Strict 1:1 parity ceiling is still red.', kind: 'strict_1to1_ceiling' }
  }, { generatedAt });
  const decision = deriveTopLevelIterationDecision({ runState: claimBlocked, nextFocus: ['focus.next'] });
  assert.equal(decision.decision, 'must_stop_claim_blocked');
  assert.equal(decision.mayStart, false);
});

test('top-level iteration decision allows claim-blocked continuation only with explicit expansion or proven progress override', () => {
  const claimBlocked = reduceRunState({
    blocker: { blocker: 'Strict 1:1 parity ceiling is still red.', kind: 'strict_1to1_ceiling' }
  }, { generatedAt });
  const expanded = deriveTopLevelIterationDecision({
    runState: claimBlocked,
    objectiveExpansion: { shouldExpand: true, remainingObjectiveIds: ['focus.remaining'], expansionWorkUnitCount: 1 }
  });
  assert.equal(expanded.decision, 'may_start_next_iteration');
  assert.equal(expanded.reason, 'claim_blocked_but_explicit_objective_expansion');
  assert.equal(expanded.objectiveExpansionWorkCount, 1);

  const progressing = deriveTopLevelIterationDecision({
    runState: claimBlocked,
    nextFocus: ['focus.next'],
    productProgressOverride: true
  });
  assert.equal(progressing.decision, 'may_start_next_iteration');
  assert.equal(progressing.reason, 'claim_blocked_but_proven_product_progress_override');
});

test('top-level iteration decision rejects objective expansion metadata without executable work units', () => {
  const claimBlocked = reduceRunState({
    blocker: { blocker: 'Strict 1:1 parity ceiling is still red.', kind: 'strict_1to1_ceiling' }
  }, { generatedAt });
  const decision = deriveTopLevelIterationDecision({
    runState: claimBlocked,
    objectiveExpansion: { shouldExpand: true, remainingObjectiveIds: ['focus.remaining'] }
  });
  assert.equal(decision.decision, 'must_stop_claim_blocked');
  assert.equal(decision.reason, 'objective_expansion_missing_executable_work');
  assert.equal(decision.mayStart, false);
  assert.equal(decision.objectiveExpansionWorkCount, 0);
});

test('terminal state writer produces durable program/run/blocker artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-terminal-'));
  const runState = reduceRunState({
    blocker: { blocker: 'No selected-run landed product diff', retryable: true }
  }, { generatedAt });
  const written = writeTerminalStateArtifacts({ artifactRoot: root, runState, reason: 'unit_test_blocker' });

  assert.equal(fs.existsSync(written.programStatePath), true);
  assert.equal(fs.existsSync(written.runStatePath), true);
  assert.equal(fs.existsSync(written.blockerPath), true);
  const program = JSON.parse(fs.readFileSync(written.programStatePath, 'utf8'));
  assert.equal(program.terminalState, 'blocked_retryable');
  assert.equal(program.stopReason, 'unit_test_blocker');

  const terminalWrite = buildTerminalStateWrite({ runState, reason: 'explicit_reason' });
  assert.equal(terminalWrite.stopReason, 'explicit_reason');
  assert.equal(terminalWrite.done, true);
});
