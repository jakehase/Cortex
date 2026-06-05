import { reduceRunState } from '../orchestrator-run-state/index.mjs';

function nowIso() {
  return new Date().toISOString();
}

function stableList(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function workId(work = {}) {
  return String(work.id || work.leafId || work.strictGap || work.parentSurfaceId || work.surfaceId || work.focusId || '').trim();
}

function proofLeafId(entry = {}) {
  return String(entry.leafId || entry.id || '').trim();
}

function isExitPass(value) {
  return value === 0 || value === '0' || value === true || value === 'pass' || value === 'passed';
}

function hasBlocker(blocker = null) {
  if (!blocker) return false;
  if (typeof blocker === 'string') return blocker.trim().length > 0;
  return String(blocker.blocker || blocker.message || blocker.reason || '').trim().length > 0;
}

function normalizeProofMap(proofMap = {}) {
  const entries = Array.isArray(proofMap?.leafProofs)
    ? proofMap.leafProofs
    : Object.entries(proofMap || {})
      .filter(([, value]) => value && typeof value === 'object')
      .map(([id, value]) => ({ id, ...value }));
  const leafProofs = entries
    .map((entry) => ({ ...entry, leafId: proofLeafId(entry) }))
    .filter((entry) => entry.leafId);
  const greenLeafProofs = leafProofs.filter((entry) => entry.status === 'green' && (entry.testStatus === 'pass' || entry.testCommandExitCode === 0 || entry.testCommandExitCode == null));
  return {
    status: proofMap?.status || (greenLeafProofs.length === leafProofs.length && leafProofs.length ? 'green' : leafProofs.length ? 'partial' : 'not_provided'),
    leafProofs,
    greenLeafProofs,
    greenLeafIds: new Set(greenLeafProofs.map((entry) => entry.leafId)),
    leafProofCount: leafProofs.length,
    greenLeafProofCount: greenLeafProofs.length
  };
}

export function normalizeNextWorkQueue(queue = {}, { completedIds = [], allowUnsupported = true } = {}) {
  const completed = new Set(stableList(completedIds));
  const rawWork = Array.isArray(queue?.work) ? queue.work : Array.isArray(queue) ? queue : [];
  const work = [];
  const skipped = [];
  for (const [index, entry] of rawWork.entries()) {
    const id = workId(entry) || `work_${index + 1}`;
    const normalized = { ...entry, id, queueIndex: index };
    if (completed.has(id) || completed.has(normalized.leafId) || completed.has(normalized.strictGap)) {
      skipped.push({ id, reason: 'already_completed_or_proven' });
      continue;
    }
    if (!allowUnsupported && normalized.supportedByContinuationRunner === false) {
      skipped.push({ id, reason: 'unsupported_by_runner' });
      continue;
    }
    work.push(normalized);
  }
  return {
    schemaVersion: 'claw.autonomy.next_work_queue.v1',
    generatedAt: nowIso(),
    count: work.length,
    originalCount: rawWork.length,
    work,
    skipped
  };
}

export function buildNextAssignments({
  nextWorkQueue = {},
  completedIds = [],
  maxAssignments = 3,
  focusAllowlist = [],
  allowUnsupported = true
} = {}) {
  const allow = new Set(stableList(focusAllowlist));
  const queue = normalizeNextWorkQueue(nextWorkQueue, { completedIds, allowUnsupported });
  const filtered = allow.size
    ? queue.work.filter((entry) => allow.has(entry.id) || allow.has(entry.parentSurfaceId) || allow.has(entry.focusId) || allow.has(entry.strictGap))
    : queue.work;
  return {
    schemaVersion: 'claw.autonomy.next_assignments.v1',
    generatedAt: nowIso(),
    count: Math.min(filtered.length, Math.max(0, Number(maxAssignments) || 0)),
    assignments: filtered.slice(0, Math.max(0, Number(maxAssignments) || 0)).map((entry, index) => ({
      id: entry.id,
      assignmentId: `autonomy.${String(index + 1).padStart(3, '0')}.${entry.id}`,
      parentSurfaceId: entry.parentSurfaceId || null,
      strictGap: entry.strictGap || null,
      lane: entry.lane || 'domain_product_depth',
      productGoal: entry.productGoal || entry.requiredWork || entry.strictGap || entry.id,
      allowedFiles: Array.isArray(entry.allowedFiles) ? entry.allowedFiles : [],
      targetedTests: Array.isArray(entry.targetedTests) ? entry.targetedTests : [],
      proofKinds: Array.isArray(entry.proofKinds) ? entry.proofKinds : [],
      stopCondition: entry.stopCondition || 'leaf_surface_proven_green_or_blocker_report',
      sourceQueueIndex: entry.queueIndex
    })),
    queue
  };
}

export function summarizePatchAdmission({ patchQueue = {}, implementationResults = [] } = {}) {
  const rejected = Array.isArray(patchQueue?.rejected) ? patchQueue.rejected : [];
  const merged = Array.isArray(patchQueue?.merged) ? patchQueue.merged : [];
  const results = Array.isArray(implementationResults) ? implementationResults : [];
  const modifiedFiles = stableList([
    ...merged.flatMap((patch) => patch.filePaths || patch.modifiedFiles || patch.metadata?.modifiedFiles || []),
    ...results.flatMap((result) => result.modifiedFiles || result.metadata?.modifiedFiles || [])
  ]);
  const zeroModifiedRejections = rejected.filter((patch) => patch.rejectionReason === 'zero_modified_files' || patch.reason === 'zero_modified_files');
  const zeroModifiedResults = results.filter((result) => Array.isArray(result.modifiedFiles) && result.modifiedFiles.length === 0 && (result.metadata?.claimIntegrityKind === 'zero_modified_files' || result.claimIntegrityKind === 'zero_modified_files'));
  return {
    schemaVersion: 'claw.autonomy.patch_admission_summary.v1',
    generatedAt: nowIso(),
    mergedCount: merged.length,
    rejectedCount: rejected.length,
    modifiedFiles,
    modifiedFileCount: modifiedFiles.length,
    zeroModifiedRejectionCount: zeroModifiedRejections.length,
    zeroModifiedResultCount: zeroModifiedResults.length,
    zeroModifiedObserved: zeroModifiedRejections.length > 0 || zeroModifiedResults.length > 0,
    productivePatchObserved: modifiedFiles.length > 0 || merged.length > 0
  };
}

export function deriveProofCredit({
  proofMap = null,
  requestedLeafIds = [],
  preflightSummary = {},
  testExitCodes = {},
  requiredExitCodeKeys = []
} = {}) {
  const proof = normalizeProofMap(proofMap || {});
  const requested = stableList(requestedLeafIds);
  const missingRequestedLeafIds = requested.filter((id) => !proof.greenLeafIds.has(id));
  const requiredKeys = requiredExitCodeKeys.length ? requiredExitCodeKeys : Object.keys(testExitCodes || {});
  const failingExitCodeKeys = requiredKeys.filter((key) => !isExitPass(testExitCodes?.[key]));
  const requestedLeavesComplete = requested.length > 0 && missingRequestedLeafIds.length === 0;
  const allRequiredTestsPass = failingExitCodeKeys.length === 0;
  return {
    schemaVersion: 'claw.autonomy.proof_credit.v1',
    generatedAt: nowIso(),
    proofMapStatus: proof.status,
    proofLeafCount: proof.leafProofCount,
    greenProofLeafCount: proof.greenLeafProofCount,
    requestedLeafIds: requested,
    requestedLeavesComplete,
    missingRequestedLeafIds,
    testExitCodes,
    allRequiredTestsPass,
    failingExitCodeKeys,
    preflight: {
      ok: preflightSummary?.ok === true,
      thresholdPass: preflightSummary?.thresholdPass === true,
      inventoryReady: preflightSummary?.inventoryReady === true,
      greenLeafSurfaceCount: Number(preflightSummary?.greenLeafSurfaceCount || 0),
      redLeafSurfaceCount: Number(preflightSummary?.redLeafSurfaceCount || 0),
      nextWorkQueueCount: Number(preflightSummary?.nextWorkQueueCount || 0)
    },
    scopedCreditOk: requestedLeavesComplete && allRequiredTestsPass,
    globalThresholdPass: preflightSummary?.thresholdPass === true
  };
}

export function deriveArtifactContractStatus({ artifacts = {}, requireBlockerWhenRed = true, requiredArtifactKeys = null } = {}) {
  const required = Array.isArray(requiredArtifactKeys) && requiredArtifactKeys.length
    ? requiredArtifactKeys
    : ['completionSummary', 'thresholdEvaluation', 'runStateTruth'];
  const normalized = Object.fromEntries(Object.entries(artifacts || {}).map(([key, value]) => [key, Boolean(value)]));
  const missing = required.filter((key) => !normalized[key]);
  const red = artifacts?.thresholdEvaluation?.thresholdPass === false || artifacts?.completionSummary?.thresholdPass === false || hasBlocker(artifacts?.blockerReport || artifacts?.completionSummary?.blocker);
  if (requireBlockerWhenRed && red && !normalized.blockerReport && !hasBlocker(artifacts?.completionSummary?.blocker)) missing.push('blockerReport');
  return {
    schemaVersion: 'claw.autonomy.artifact_contract.v1',
    generatedAt: nowIso(),
    ok: missing.length === 0,
    missing,
    present: normalized,
    requiredArtifactKeys: required,
    requireBlockerWhenRed,
    red
  };
}

export function deriveAutonomousIterationDecision(input = {}) {
  const generatedAt = input.generatedAt || nowIso();
  const runState = input.runState || reduceRunState({
    ...(input.runStateInput || {}),
    completionSummary: input.completionSummary,
    thresholdEvaluation: input.thresholdEvaluation,
    blocker: input.blockerReport || input.completionSummary?.blocker || input.blocker
  }, { generatedAt });
  const admission = summarizePatchAdmission({ patchQueue: input.patchQueue, implementationResults: input.implementationResults });
  const proofCredit = deriveProofCredit({
    proofMap: input.proofMap,
    requestedLeafIds: input.requestedLeafIds,
    preflightSummary: input.preflightSummary,
    testExitCodes: input.testExitCodes,
    requiredExitCodeKeys: input.requiredExitCodeKeys
  });
  const completedIds = stableList([...(input.completedIds || []), ...proofCredit.requestedLeafIds.filter((id) => !proofCredit.missingRequestedLeafIds.includes(id))]);
  const nextAssignments = buildNextAssignments({
    nextWorkQueue: input.nextWorkQueue,
    completedIds,
    maxAssignments: input.maxAssignments ?? 3,
    focusAllowlist: input.focusAllowlist,
    allowUnsupported: input.allowUnsupported !== false
  });
  const artifactContract = input.artifactContract || deriveArtifactContractStatus({ artifacts: input.artifacts || {}, requireBlockerWhenRed: input.requireBlockerWhenRed !== false, requiredArtifactKeys: input.requiredArtifactKeys });
  const strictFullCloneRequired = input.strictFullCloneRequired === true || input.requestedFidelity === 'full_clone';
  const globalPass = proofCredit.globalThresholdPass || input.completionSummary?.thresholdPass === true || input.thresholdEvaluation?.thresholdPass === true;
  let decision = 'stop_blocked';
  let mayStart = false;
  let shouldStop = true;
  let reason = 'no_admissible_next_action';
  let supervisorStatus = 'red';

  if (!artifactContract.ok) {
    decision = 'stop_artifact_contract_blocked';
    reason = 'artifact_contract_incomplete';
  } else if (runState.terminalState === 'waiting_remote' || (runState.running && !runState.terminal)) {
    decision = 'wait_active_run';
    mayStart = false;
    shouldStop = false;
    reason = 'run_still_active';
  } else if (globalPass && !hasBlocker(input.blockerReport || input.completionSummary?.blocker)) {
    decision = 'stop_green_global_threshold';
    shouldStop = true;
    supervisorStatus = 'green';
    reason = 'global_threshold_pass';
  } else if (!strictFullCloneRequired && proofCredit.scopedCreditOk) {
    decision = 'stop_green_for_requested_scope';
    shouldStop = true;
    supervisorStatus = 'green';
    reason = 'requested_leaf_proofs_and_tests_green';
  } else if (nextAssignments.count > 0 && (admission.zeroModifiedObserved || input.zeroDiffObserved === true)) {
    decision = 'continue_next_work_queue';
    mayStart = true;
    shouldStop = false;
    reason = 'zero_modified_files_replan_from_next_work_queue';
  } else if (nextAssignments.count > 0 && (input.preflightSummary?.thresholdPass === false || input.completionSummary?.thresholdPass === false || hasBlocker(input.blockerReport || input.completionSummary?.blocker))) {
    decision = 'continue_next_work_queue';
    mayStart = true;
    shouldStop = false;
    reason = 'red_preflight_or_blocker_with_executable_next_work';
  } else if (input.objectiveExpansionPlan?.shouldExpand === true && Number(input.objectiveExpansionPlan?.expansionWorkUnitCount || input.objectiveExpansionPlan?.executableWorkUnitCount || input.objectiveExpansionPlan?.workGraph?.workUnits?.length || 0) > 0) {
    decision = 'continue_objective_expansion_plan';
    mayStart = true;
    shouldStop = false;
    reason = 'explicit_objective_expansion_plan_available';
  } else if (runState.terminalState === 'claim_blocked') {
    decision = 'stop_claim_blocked';
    reason = 'claim_blocked_without_executable_expansion';
  } else if (nextAssignments.count === 0 && !globalPass && !proofCredit.scopedCreditOk) {
    decision = 'stop_blocked_no_executable_work';
    reason = 'no_next_work_and_no_green_scope';
  }

  return {
    schemaVersion: 'claw.autonomy.iteration_decision.v1',
    generatedAt,
    decision,
    mayStart,
    shouldStop,
    reason,
    supervisorStatus,
    runState,
    admission,
    proofCredit,
    nextAssignments,
    artifactContract,
    truthBoundary: 'This decision gates orchestration continuation or scoped credit. It does not convert product parity into a full-clone claim unless global threshold evidence is green.'
  };
}
