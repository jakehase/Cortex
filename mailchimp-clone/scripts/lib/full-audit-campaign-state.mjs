export function resolveCampaignBlocker({ completionSummary = null, programState = null, campaignState = null, canonicalSummary = null, blockerReport = null, workerStatus = null } = {}) {
  const authoritativeGreen = programState?.allComplete === true
    || programState?.green === true
    || programState?.supervisorStatus === 'green'
    || campaignState?.supervisor?.status === 'green';
  if (authoritativeGreen) return null;
  return canonicalSummary?.blocker
    || completionSummary?.blocker
    || programState?.blocker
    || campaignState?.supervisor?.blocker
    || blockerReport
    || workerStatus?.remoteBlocker
    || workerStatus?.remoteExecutionStatus?.remoteBlocker
    || workerStatus?.remoteExecutionStatus?.blocker
    || null;
}

function parseTimestampMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function isArtifactFreshForRun({
  artifact = null,
  currentRun = null,
  runId = null,
  timestampKeys = ['generatedAt', 'createdAt', 'startedAt'],
  requireRunMatch = false,
  minTimestamp = null
} = {}) {
  if (!artifact || typeof artifact !== 'object') return false;
  if (requireRunMatch && runId && artifact.runId && artifact.runId !== runId) return false;
  const artifactTimestamp = timestampKeys
    .map((key) => parseTimestampMs(artifact[key]))
    .find((value) => Number.isFinite(value));
  if (!Number.isFinite(artifactTimestamp)) return false;
  const baselineTimestamp = Number.isFinite(minTimestamp)
    ? minTimestamp
    : parseTimestampMs(currentRun?.generatedAt) ?? parseTimestampMs(currentRun?.startedAt);
  if (!Number.isFinite(baselineTimestamp)) return true;
  return artifactTimestamp >= baselineTimestamp;
}

export function buildStaleDelegateEvidenceBlocker({ runId = null, currentRun = null } = {}) {
  return {
    blocker: 'Delegate qualification evidence is stale for the active Mailchimp one-pass run.',
    nextAction: `Regenerate fresh run-local qualification artifacts for run ${runId || currentRun?.runId || 'unknown'} before accepting a green parity result.`
  };
}

function stageExplicitlyIncomplete(stage) {
  const value = stage?.complete;
  if (value === false || value === 0 || value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function delegateTruthConflictDetails({ completionSummary = null, programState = null } = {}) {
  const incompleteCompletionStages = Array.isArray(completionSummary?.stages)
    ? completionSummary.stages.filter(stageExplicitlyIncomplete).map((stage) => stage?.id).filter(Boolean)
    : [];
  const incompleteProgramStages = Array.isArray(programState?.stages)
    ? programState.stages.filter(stageExplicitlyIncomplete).map((stage) => stage?.id).filter(Boolean)
    : [];
  const nestedBlocker = programState?.campaignState?.supervisor?.blocker || programState?.supervisor?.blocker || null;
  return {
    incompleteCompletionStages,
    incompleteProgramStages,
    nestedBlocker,
    hasConflict: incompleteCompletionStages.length > 0 || incompleteProgramStages.length > 0 || Boolean(nestedBlocker)
  };
}

export function buildContradictoryDelegateTruthBlocker({ conflict = null, runId = null } = {}) {
  const details = [];
  if (conflict?.incompleteCompletionStages?.length) details.push(`completion stages incomplete: ${conflict.incompleteCompletionStages.join(', ')}`);
  if (conflict?.incompleteProgramStages?.length) details.push(`program stages incomplete: ${conflict.incompleteProgramStages.join(', ')}`);
  if (conflict?.nestedBlocker?.blocker) details.push(`nested blocker still present: ${conflict.nestedBlocker.blocker}`);
  return {
    blocker: 'Delegate qualification truth is internally contradictory for the active Mailchimp one-pass run.',
    nextAction: `Reconcile the delegate supervisor/program state for run ${runId || 'unknown'} before accepting green.${details.length ? ` Evidence: ${details.join(' | ')}` : ''}`
  };
}

export function deriveCanonicalStatuses({ completionSummary = null, programState = null, campaignState = null, canonicalSummary = null, blocker = null } = {}) {
  const authoritativeGreen = !blocker && (
    programState?.allComplete === true
    || programState?.green === true
    || programState?.supervisorStatus === 'green'
    || campaignState?.supervisor?.status === 'green'
  );
  if (authoritativeGreen) {
    return {
      supervisorStatus: 'green',
      matrixStatus: programState?.matrixStatus || campaignState?.supervisor?.matrixStatus || 'all_complete',
      parityStatus: 'full',
      green: true
    };
  }
  const provenCoordinationScaleTier = Number(
    canonicalSummary?.provenCoordinationScaleTier
      ?? completionSummary?.provenCoordinationScaleTier
      ?? canonicalSummary?.highestPassingTier
      ?? completionSummary?.highestPassingTier
      ?? 0
  );
  const allRequestedTiersPassed = canonicalSummary?.allRequestedTiersPassed ?? completionSummary?.allRequestedTiersPassed ?? null;
  const repoIntegrityOk = canonicalSummary?.repoIntegrityOk ?? completionSummary?.repoIntegrityOk ?? true;
  const authoritativeSupervisorStatus = programState?.supervisorStatus || campaignState?.supervisor?.status || null;
  const authoritativeMatrixStatus = programState?.matrixStatus || campaignState?.supervisor?.matrixStatus || null;
  const authoritativeParityStatus = programState?.parityStatus || campaignState?.supervisor?.parityStatus || null;
  const inferredGreen = !authoritativeSupervisorStatus
    && !authoritativeMatrixStatus
    && !blocker
    && repoIntegrityOk !== false
    && (allRequestedTiersPassed === true || provenCoordinationScaleTier >= 100);
  if (blocker) {
    return {
      supervisorStatus: 'red',
      matrixStatus: authoritativeMatrixStatus === 'all_complete' ? 'partial' : (authoritativeMatrixStatus || 'partial'),
      parityStatus: 'partial',
      green: false
    };
  }
  const supervisorStatus = authoritativeSupervisorStatus
    || (inferredGreen
      ? 'green'
      : canonicalSummary?.supervisorStatus
        || completionSummary?.supervisorStatus
        || 'red');
  const matrixStatus = authoritativeMatrixStatus
    || (inferredGreen
      ? 'all_complete'
      : canonicalSummary?.matrixStatus
        || canonicalSummary?.surfaceMatrixStatus
        || completionSummary?.surfaceMatrixStatus
        || completionSummary?.matrixStatus
        || 'partial');
  const green = supervisorStatus === 'green' && matrixStatus === 'all_complete';
  const parityStatus = authoritativeParityStatus
    || (green
      ? 'full'
      : blocker
        ? 'blocked'
        : canonicalSummary?.parityStatus
          || completionSummary?.parityStatus
          || 'partial');
  return { supervisorStatus, matrixStatus, parityStatus, green };
}

export function deriveProductThroughputEvidence({ liveExecutionSummary = null, patchQueueReport = null, syncStatus = null } = {}) {
  const shardCount = Number(liveExecutionSummary?.shardCount ?? 0);
  const mergedShardCount = Number(liveExecutionSummary?.mergedShardCount ?? 0);
  const workerSpawnCount = Number(liveExecutionSummary?.metrics?.workerSpawnCount ?? 0);
  const mergedPatchCount = Array.isArray(patchQueueReport?.merged)
    ? patchQueueReport.merged.length
    : Number(liveExecutionSummary?.metrics?.mergedPatchCount ?? 0);
  const newlyLandedProductFileCount = Number(syncStatus?.canonicalLandingEvidence?.newlyLandedProductFileCount ?? 0);
  const canonicalSynchronizedProductFileCount = Number(syncStatus?.canonicalLandingEvidence?.canonicalSynchronizedProductFileCount ?? 0);
  const alreadyMatchedProductFileCount = Number(syncStatus?.canonicalLandingEvidence?.alreadyMatchedProductFileCount ?? 0);
  const admittedProductWork = mergedPatchCount > 0 && canonicalSynchronizedProductFileCount > 0;
  const zeroWork = !admittedProductWork;
  return {
    shardCount,
    mergedShardCount,
    workerSpawnCount,
    mergedPatchCount,
    newlyLandedProductFileCount,
    canonicalSynchronizedProductFileCount,
    alreadyMatchedProductFileCount,
    admittedProductWork,
    zeroWork,
    note: zeroWork
      ? 'No admitted selected-tier product patch landed in the canonical checkout.'
      : 'Selected-tier admitted product-work throughput evidence was observed.'
  };
}

export function buildZeroWorkScopedGreenBlocker({ productThroughput = null, truthPreflight = null } = {}) {
  return {
    blocker: 'Scoped Mailchimp matrix is mechanically satisfied, but no live product-work throughput was proven.',
    nextAction: 'Do not report this as Mailchimp parity or productive orchestration. Build a broader remaining-work matrix from Mailchimp-scale product gaps, then rerun with real product-code shards and landing evidence.',
    blockerKind: 'zero_work_scoped_green',
    productThroughput: productThroughput || null,
    truthPreflight: truthPreflight ? {
      ok: truthPreflight.ok === true,
      guardrail: truthPreflight.guardrail || null,
      memoryTruth: truthPreflight.memoryTruth || null
    } : null
  };
}

export function deriveRequestedOutcome({ requestedFidelity = null, orchestration = null, blocker = null, strict1to1 = null, benchmarkGate = null, productThroughput = null, truthPreflight = null } = {}) {
  const fidelity = String(requestedFidelity || '').trim().toLowerCase();
  const orchestrationTruth = orchestration || {
    supervisorStatus: 'red',
    matrixStatus: 'partial',
    parityStatus: 'partial',
    green: false
  };
  if (blocker) {
    return {
      requestedFidelity: fidelity || null,
      supervisorStatus: orchestrationTruth.supervisorStatus,
      matrixStatus: orchestrationTruth.matrixStatus,
      parityStatus: orchestrationTruth.parityStatus,
      green: false,
      blocker,
      blockerKind: 'orchestration',
      note: 'Delegate/orchestration run is still blocked or incomplete.'
    };
  }
  if (orchestrationTruth.green && productThroughput?.zeroWork === true && truthPreflight?.memoryTruth?.assumeAbundantRemainingWork === true) {
    const zeroWorkBlocker = buildZeroWorkScopedGreenBlocker({ productThroughput, truthPreflight });
    return {
      requestedFidelity: fidelity || null,
      supervisorStatus: 'red',
      matrixStatus: 'scope_satisfied_zero_work',
      parityStatus: 'not_full_clone',
      green: false,
      blocker: zeroWorkBlocker,
      blockerKind: 'zero_work_scoped_green',
      note: 'Scoped matrix passed, but Mailchimp memory says full-clone parity is not proven and abundant real product work remains; zero-work green is only a saturation canary.'
    };
  }
  const strictCeilingRequired = fidelity === 'full_clone' && strict1to1?.required === true;
  if (strictCeilingRequired && strict1to1?.blocker) {
    return {
      requestedFidelity: fidelity,
      supervisorStatus: 'red',
      matrixStatus: strict1to1?.state?.matrixStatus || 'blocked',
      parityStatus: strict1to1?.state?.parityStatus || 'blocked',
      green: false,
      blocker: strict1to1.blocker,
      blockerKind: 'strict_1to1_ceiling',
      note: orchestrationTruth.green
        ? 'Delegate/orchestration run passed, but full-clone completion remains blocked by the strict 1:1 ceiling.'
        : 'Full-clone completion remains blocked by the strict 1:1 ceiling.'
    };
  }
  if (benchmarkGate?.blocker) {
    return {
      requestedFidelity: fidelity || null,
      supervisorStatus: 'red',
      matrixStatus: benchmarkGate?.matrixStatus || orchestrationTruth.matrixStatus || 'blocked',
      parityStatus: benchmarkGate?.parityStatus || orchestrationTruth.parityStatus || 'blocked',
      green: false,
      blocker: benchmarkGate.blocker,
      blockerKind: benchmarkGate.blockerKind || 'benchmark_threshold_gate',
      note: orchestrationTruth.green
        ? 'Delegate/orchestration run passed, but benchmark thresholds were not met.'
        : 'Benchmark thresholds were not met.'
    };
  }
  return {
    requestedFidelity: fidelity || null,
    supervisorStatus: orchestrationTruth.supervisorStatus,
    matrixStatus: orchestrationTruth.matrixStatus,
    parityStatus: orchestrationTruth.parityStatus,
    green: Boolean(orchestrationTruth.green),
    blocker: null,
    blockerKind: null,
    note: orchestrationTruth.green
      ? 'Delegate/orchestration run passed.'
      : 'Delegate/orchestration run remains partial.'
  };
}

export function buildOutcomeHeadline({ orchestration = null, requestedOutcome = null } = {}) {
  if (requestedOutcome?.blockerKind === 'zero_work_scoped_green') return 'Scoped matrix passed, but no product-work throughput was proven.';
  if (requestedOutcome?.green) return 'Full-audit campaign complete.';
  if (requestedOutcome?.blockerKind === 'strict_1to1_ceiling' && orchestration?.green) {
    return 'Orchestration passed, full-clone strict 1:1 ceiling still red.';
  }
  if (requestedOutcome?.blockerKind === 'benchmark_threshold_gate' && orchestration?.green) {
    return 'Orchestration passed, but benchmark threshold gate stayed red.';
  }
  if (requestedOutcome?.blockerKind === 'orchestration') {
    return 'Orchestration is still blocked.';
  }
  if (orchestration?.green) return 'Orchestration passed.';
  return 'Full-audit campaign is still in progress.';
}

export function buildNotifierEligibilityPayload({ runId, supervisorStatus, matrixStatus, blocker = null, generatedAt = new Date().toISOString() } = {}) {
  const green = supervisorStatus === 'green' && matrixStatus === 'all_complete';
  return {
    generatedAt,
    runId,
    eligible: Boolean(green || blocker),
    kind: green ? 'success' : blocker ? 'blocker' : null,
    supervisorStatus,
    matrixStatus,
    blocker: blocker || null,
    note: green
      ? 'Eligible for success notification.'
      : blocker
        ? 'Eligible for blocker notification.'
        : 'Not eligible while run is partial.'
  };
}
