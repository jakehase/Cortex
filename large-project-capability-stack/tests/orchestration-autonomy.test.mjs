import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNextAssignments,
  deriveArtifactContractStatus,
  deriveAutonomousIterationDecision,
  deriveProofCredit,
  normalizeNextWorkQueue,
  summarizePatchAdmission
} from '../packages/orchestration-autonomy/index.mjs';

const COMPLETE_ARTIFACTS = {
  completionSummary: { thresholdPass: false },
  thresholdEvaluation: { thresholdPass: false },
  runStateTruth: { terminalState: 'blocked_terminal' },
  blockerReport: { blocker: 'red with executable queue' }
};

test('shared autonomy replans zero-modified handlers from executable next work queue', () => {
  const decision = deriveAutonomousIterationDecision({
    completionSummary: { thresholdPass: false, blocker: { blockerKind: 'zero_modified_files', blocker: 'handler emitted no product delta' } },
    thresholdEvaluation: { thresholdPass: false },
    blockerReport: { blockerKind: 'zero_modified_files', blocker: 'handler emitted no product delta' },
    patchQueue: { rejected: [{ id: 'patch-1', rejectionReason: 'zero_modified_files' }], merged: [] },
    nextWorkQueue: { work: [{ id: 'dashboard_home__req_04', parentSurfaceId: 'dashboard_home', productGoal: 'fresh dashboard runtime proof', allowedFiles: ['packages/app/routes/platform.mjs'] }] },
    preflightSummary: { thresholdPass: false, greenLeafSurfaceCount: 13, redLeafSurfaceCount: 50, nextWorkQueueCount: 50 },
    artifacts: COMPLETE_ARTIFACTS,
    maxAssignments: 1
  });

  assert.equal(decision.decision, 'continue_next_work_queue');
  assert.equal(decision.mayStart, true);
  assert.equal(decision.reason, 'zero_modified_files_replan_from_next_work_queue');
  assert.equal(decision.nextAssignments.count, 1);
  assert.equal(decision.nextAssignments.assignments[0].id, 'dashboard_home__req_04');
  assert.equal(decision.admission.zeroModifiedObserved, true);
});

test('shared autonomy gives scoped green only when proof map and required tests are green', () => {
  const requestedLeafIds = ['signup_onboarding__req_01', 'dashboard_home__req_01'];
  const decision = deriveAutonomousIterationDecision({
    requestedFidelity: 'production_slice',
    requestedLeafIds,
    completionSummary: { thresholdPass: false },
    thresholdEvaluation: { thresholdPass: false },
    proofMap: {
      status: 'green',
      leafProofs: requestedLeafIds.map((leafId) => ({ leafId, status: 'green', testStatus: 'pass', productFiles: ['packages/app/view.mjs'], targetedTests: ['tests/platform-spine.test.mjs'], proofKinds: ['product_diff'], assertions: ['runtime proof'] }))
    },
    preflightSummary: { ok: true, thresholdPass: false, inventoryReady: true, greenLeafSurfaceCount: 13, redLeafSurfaceCount: 50, nextWorkQueueCount: 50 },
    testExitCodes: { targeted: 0, phase9Preflight: 0 },
    requiredExitCodeKeys: ['targeted', 'phase9Preflight'],
    artifacts: COMPLETE_ARTIFACTS
  });

  assert.equal(decision.decision, 'stop_green_for_requested_scope');
  assert.equal(decision.supervisorStatus, 'green');
  assert.equal(decision.proofCredit.scopedCreditOk, true);
  assert.equal(decision.proofCredit.globalThresholdPass, false);
});

test('shared autonomy refuses scoped green when a requested proof leaf is missing', () => {
  const credit = deriveProofCredit({
    requestedLeafIds: ['leaf_a', 'leaf_b'],
    proofMap: { status: 'green', leafProofs: [{ leafId: 'leaf_a', status: 'green', testStatus: 'pass' }] },
    testExitCodes: { targeted: 0 }
  });
  assert.equal(credit.scopedCreditOk, false);
  assert.deepEqual(credit.missingRequestedLeafIds, ['leaf_b']);
});

test('artifact contract requires terminal truth artifacts before red-run continuation credit', () => {
  const contract = deriveArtifactContractStatus({
    artifacts: {
      completionSummary: { thresholdPass: false },
      thresholdEvaluation: { thresholdPass: false },
      blockerReport: { blocker: 'blocked' }
    }
  });

  assert.equal(contract.ok, false);
  assert.deepEqual(contract.missing, ['runStateTruth']);
});

test('next assignment builder skips already proven leaves and preserves proof contract fields', () => {
  const assignments = buildNextAssignments({
    completedIds: ['leaf_a'],
    maxAssignments: 2,
    nextWorkQueue: {
      work: [
        { id: 'leaf_a', parentSurfaceId: 'surface_a', productGoal: 'done already' },
        { id: 'leaf_b', parentSurfaceId: 'surface_b', lane: 'reporting_analytics', productGoal: 'prove analytics runtime', allowedFiles: ['packages/app/routes/reports.mjs'], targetedTests: ['tests/reports.test.mjs'], proofKinds: ['analytics_telemetry', 'product_diff'] }
      ]
    }
  });

  assert.equal(assignments.count, 1);
  assert.equal(assignments.assignments[0].id, 'leaf_b');
  assert.deepEqual(assignments.assignments[0].proofKinds, ['analytics_telemetry', 'product_diff']);
  assert.equal(assignments.queue.skipped[0].reason, 'already_completed_or_proven');
});

test('patch admission summary treats non-empty surviving product files as productive', () => {
  const summary = summarizePatchAdmission({
    patchQueue: { merged: [{ filePaths: ['packages/app/domain-core.mjs'] }], rejected: [{ rejectionReason: 'zero_modified_files' }] }
  });
  assert.equal(summary.productivePatchObserved, true);
  assert.equal(summary.zeroModifiedObserved, true);
  assert.equal(summary.modifiedFileCount, 1);
});

test('next work queue normalization can reject unsupported queued work', () => {
  const queue = normalizeNextWorkQueue({ work: [{ strictGap: 'gap a', supportedByContinuationRunner: false }, { strictGap: 'gap b', supportedByContinuationRunner: true }] }, { allowUnsupported: false });
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].strictGap, 'gap b');
});
