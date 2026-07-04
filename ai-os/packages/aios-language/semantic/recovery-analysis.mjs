export const RECOVERY_ANALYSIS_VERSION = 'aios.recovery-analysis.v1';

export function analyzeRecoveryContract({
  programId,
  operation,
  kernelCall = null,
  externalWriteReport = null,
  continuationState = {},
  runtimePolicy = {},
  exportReport = null
} = {}) {
  const retry = normalizeRetry(kernelCall?.recovery?.retry ?? runtimePolicy.retry);
  const rollback = normalizeRollback({
    action: kernelCall?.recovery?.rollbackAction ?? runtimePolicy.rollbackAction,
    required: kernelCall?.recovery?.rollbackRequired,
    failureStatus: kernelCall?.recovery?.failureStatus
  });
  const continuation = normalizeContinuation(continuationState ?? kernelCall?.runtimeState?.continuationState);
  const handoff = normalizeHandoff(kernelCall);
  const write = normalizeExternalWrite(externalWriteReport);
  const provider = buildProviderRecoveryContract({ kernelCall, handoff, write, exportReport });
  const replay = buildProviderReplayPlan({ continuation, handoff, write, provider, exportReport });
  const externalHandoff = buildExternalHandoffState({ continuation, handoff, write, provider, replay });
  const restartRecovery = buildRestartRecoveryPlan({
    kernelCall,
    continuation,
    handoff,
    write,
    provider,
    replay,
    externalHandoff,
    exportReport
  });
  const persistedClientState = buildPersistedClientRuntimeState({
    kernelCall,
    continuation,
    handoff,
    write,
    provider,
    replay,
    externalHandoff,
    restartRecovery,
    exportReport
  });
  const acceptanceHandoff = buildRecoveryAcceptanceHandoff({
    continuation,
    handoff,
    write,
    provider,
    replay,
    externalHandoff,
    restartRecovery,
    persistedClientState,
    exportReport
  });
  const exportContinuity = buildRecoveryExportContinuity({
    kernelCall,
    continuation,
    handoff,
    write,
    provider,
    replay,
    externalHandoff,
    restartRecovery,
    persistedClientState,
    acceptanceHandoff,
    exportReport
  });
  const readinessPreview = buildRecoveryReadinessPreview({
    kernelCall,
    continuation,
    handoff,
    write,
    provider,
    replay,
    externalHandoff,
    restartRecovery,
    persistedClientState,
    acceptanceHandoff,
    exportContinuity,
    exportReport
  });
  const statusHandoff = buildRecoveryStatusHandoff({
    kernelCall,
    continuation,
    handoff,
    write,
    provider,
    replay,
    externalHandoff,
    restartRecovery,
    persistedClientState,
    acceptanceHandoff,
    exportContinuity,
    readinessPreview,
    exportReport
  });
  const sync = buildRecoverySyncMetadata({ kernelCall, continuation, handoff, write, provider, exportReport, replay, restartRecovery });
  const timeline = buildRecoveryTimeline({ kernelCall, continuation, exportReport, write, provider, externalHandoff, replay, restartRecovery, persistedClientState, acceptanceHandoff, exportContinuity });
  const diagnostics = [
    ...validateRollback(rollback, write),
    ...validateRetry(retry),
    ...validateContinuation(continuation, handoff),
    ...validateProviderRecovery(provider, write),
    ...validateProviderReplay(replay, write),
    ...validateExternalStateRecoveryCapsule(write.stateRecoveryCapsule, write),
    ...validateRecoveryStateIntegrityManifest(write.stateIntegrityManifest, write),
    ...validateRestartRecoveryPlan(restartRecovery, write),
    ...validatePersistedClientRuntimeState(persistedClientState, write),
    ...validateRecoveryAcceptanceHandoff(acceptanceHandoff, write),
    ...validateRecoveryExportContinuity(exportContinuity, write),
    ...validateRecoveryReadinessPreview(readinessPreview, write),
    ...validateRecoveryStatusHandoff(statusHandoff, write),
    ...validateWriteRecovery(write, rollback),
    ...validateKernelHealth(kernelCall)
  ];
  const blockedReasons = diagnostics
    .filter((diagnostic) => diagnostic.level === 'error')
    .map((diagnostic) => diagnostic.code);
  const status = blockedReasons.length
    ? 'blocked'
    : write.status === 'blocked'
      ? 'blocked'
      : continuation.status === 'paused'
        ? 'paused'
        : diagnostics.some((diagnostic) => diagnostic.level === 'warning')
        ? 'degraded'
          : 'ready';
  const analyticsSummary = buildRecoveryAnalyticsSummary({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    blockedReasons,
    retry,
    rollback,
    continuation,
    handoff,
    write,
    provider,
    sync,
    replay,
    externalHandoff,
    restartRecovery,
    persistedClientState,
    acceptanceHandoff,
    exportContinuity,
    readinessPreview,
    statusHandoff,
    timeline,
    diagnostics,
    exportReport
  });

  return {
    ok: blockedReasons.length === 0,
    report: {
      kind: 'RecoveryAnalysis',
      version: RECOVERY_ANALYSIS_VERSION,
      programId: programId ?? kernelCall?.programId ?? null,
      operation: operation ?? kernelCall?.operation ?? null,
      status,
      rollback,
      retry,
      continuation,
      handoff,
      externalWrite: write,
      provider,
      sync,
      replay,
      externalHandoff,
      restartRecovery,
      persistedClientState,
      acceptanceHandoff,
      exportContinuity,
      readinessPreview,
      statusHandoff,
      timeline,
      analyticsSummary,
      counters: {
        retryableErrorCount: kernelCall?.analytics?.counters?.retryableErrorCount ?? 0,
        actionableErrorCount: kernelCall?.analytics?.counters?.actionableErrorCount ?? 0,
        continuationEventCount: continuation.events.length,
        recoveryTimelineEventCount: timeline.length,
        writeBlockedCount: write.status === 'blocked' ? 1 : 0,
        providerHealthReadyCount: write.providerHealth?.ready ? 1 : 0,
        providerHealthDegradedCount: write.providerHealth?.degraded ? 1 : 0,
        providerHealthRetryableCount: write.providerHealth?.retryable ? 1 : 0,
        providerHealthBlockerCount: write.providerHealth?.blockers?.length ?? 0,
        providerCommandLedgerReadyCount: write.providerCommandLedger?.ready ? 1 : 0,
        providerCommandLedgerEntryCount: write.providerCommandLedger?.entries?.length ?? 0,
        providerCommandLedgerCommandCount: write.providerCommandLedger?.commands?.length ?? 0,
        providerCommandLedgerDuplicateSafeCount: write.providerCommandLedger?.duplicateSafe ? 1 : 0,
        providerCommandLedgerReplayableCount: write.providerCommandLedger?.replayable ? 1 : 0,
        providerCommandLedgerBlockerCount: write.providerCommandLedger?.blockers?.length ?? 0,
        persistenceEnvelopeReadyCount: write.persistenceEnvelope?.ready ? 1 : 0,
        persistenceEnvelopeRestartSafeCount: write.persistenceEnvelopeRestartSafe ? 1 : 0,
        persistenceEnvelopeRecoveryHintCount: write.persistenceEnvelope?.recoveryHints?.length ?? 0,
        persistenceEnvelopeBlockerCount: write.persistenceEnvelope?.blockers?.length ?? 0,
        providerServiceReadyCount: provider.serviceContract?.ready ? 1 : 0,
        providerServiceMissingCapabilityCount: provider.serviceContract?.missingCapabilities?.length ?? 0,
        providerServiceCommandCount: provider.serviceContract?.commandCount ?? 0,
        providerSessionReadyCount: provider.serviceContract?.providerSession?.ready ? 1 : 0,
        providerSessionRenewalCount: provider.serviceContract?.providerSession?.renewalRequired ? 1 : 0,
        providerSessionBlockerCount: provider.serviceContract?.providerSession?.blockers?.length ?? 0,
        providerHandoffReceiptReadyCount: provider.serviceContract?.handoffReceipt?.ready ? 1 : 0,
        providerHandoffReceiptFreshCount: provider.serviceContract?.handoffReceipt?.fresh ? 1 : 0,
        providerHandoffReceiptAcknowledgedCount: provider.serviceContract?.handoffReceipt?.acknowledged ? 1 : 0,
        providerHandoffReceiptBlockerCount: provider.serviceContract?.handoffReceipt?.blockers?.length ?? 0,
        providerHandoffReceiptWarningCount: provider.serviceContract?.handoffReceipt?.warnings?.length ?? 0,
        lifecycleControlReadyCount: provider.lifecycleControl?.ready ? 1 : 0,
        lifecycleControlCommandCount: provider.lifecycleControl?.commandCount ?? write.lifecycleControls?.commands?.length ?? 0,
        lifecycleControlBlockerCount: provider.lifecycleControl?.blockers?.length ?? 0,
        boundaryRecoveryGuardReadyCount: write.boundaryRecoveryGuard?.ready ? 1 : 0,
        boundaryRecoveryGuardBlockerCount: write.boundaryRecoveryGuard?.blockers?.length ?? 0,
        boundaryRecoveryGuardWarningCount: write.boundaryRecoveryGuard?.warnings?.length ?? 0,
        boundaryRecoveryGuardRetryableCount: write.boundaryRecoveryGuard?.retryable ? 1 : 0,
        boundaryPermissionPostureReadyCount: write.boundaryPermissionPosture?.ready ? 1 : 0,
        boundaryPermissionPostureBlockerCount: write.boundaryPermissionPosture?.blockers?.length ?? 0,
        boundaryPermissionPostureWarningCount: write.boundaryPermissionPosture?.warnings?.length ?? 0,
        boundaryPermissionPostureEscalationCount: write.boundaryPermissionPosture?.escalations?.length ?? 0,
        boundaryPermissionPostureMissingAcknowledgementCount: write.boundaryPermissionPosture?.missingAcknowledgements?.length ?? 0,
        boundaryDecisionReceiptReadyCount: write.boundaryDecisionReceipt?.ready ? 1 : 0,
        boundaryDecisionReceiptReleaseCount: write.boundaryDecisionReceipt?.release?.allowed ? 1 : 0,
        boundaryDecisionReceiptBlockerCount: write.boundaryDecisionReceipt?.blockers?.length ?? 0,
        boundaryDecisionReceiptWarningCount: write.boundaryDecisionReceipt?.warnings?.length ?? 0,
        boundaryDecisionReceiptEvidenceCount: write.boundaryDecisionReceipt?.evidence?.length ?? 0,
        boundaryReleaseGateReadyCount: write.boundaryReleaseGate?.ready ? 1 : 0,
        boundaryReleaseGateReleaseCount: write.boundaryReleaseGate?.releaseAllowed ? 1 : 0,
        boundaryReleaseGateBlockerCount: write.boundaryReleaseGate?.blockers?.length ?? 0,
        boundaryReleaseGateWarningCount: write.boundaryReleaseGate?.warnings?.length ?? 0,
        boundaryReleaseGateMissingAcknowledgementCount: write.boundaryReleaseGate?.missingAcknowledgements?.length ?? 0,
        boundaryReleaseGateRestartSafeCount: write.boundaryReleaseGate?.restartSemantics?.restartSafe ? 1 : 0,
        operationalIncidentOpenCount: write.operationalIncident?.open ? 1 : 0,
        operationalIncidentRetryableCount: write.operationalIncident?.retryable ? 1 : 0,
        operationalIncidentTerminalCount: write.operationalIncident?.terminal ? 1 : 0,
        operationalIncidentEvidenceCount: write.operationalIncident?.evidence?.length ?? 0,
        providerBlockerCount: provider.blockers.length,
        replayCommandCount: replay.required ? 1 : 0,
        replayBlockerCount: replay.blockers.length,
        replayCommandLedgerReadyCount: replay.commandLedgerReplayable ? 1 : 0,
        replayCommandLedgerEntryCount: replay.commandLedgerEntryCount ?? 0,
        restartRecoveryReadyCount: restartRecovery.ready ? 1 : 0,
        restartRecoveryBlockerCount: restartRecovery.blockers.length,
        syncReadyCount: sync.ready ? 1 : 0,
        persistedClientStateReadyCount: persistedClientState.ready ? 1 : 0,
        persistedClientStateBlockerCount: persistedClientState.blockers.length,
        persistedClientRequestReadyCount: persistedClientState.clientRequestSnapshot?.ready ? 1 : 0,
        persistedClientRequestCommandCount: persistedClientState.clientRequestSnapshot?.commandCount ?? 0,
        persistedClientAdoptionReadyCount: persistedClientState.clientRuntimeAdoption?.ready ? 1 : 0,
        persistedClientAdoptionCommandCount: persistedClientState.clientRuntimeAdoption?.commandCount ?? 0,
        persistedClientAdoptionAcknowledgementCount: persistedClientState.clientRuntimeAdoption?.acknowledgementCount ?? 0,
        persistedClientAdoptionReceiptReadyCount: persistedClientState.clientRuntimeAdoptionReceipt?.ready ? 1 : 0,
        persistedClientAdoptionReceiptRestartSafeCount: persistedClientState.clientRuntimeAdoptionReceipt?.restartSafe ? 1 : 0,
        persistedClientAdoptionReceiptCheckpointCount: persistedClientState.clientRuntimeAdoptionReceipt?.checkpointCount ?? 0,
        persistedClientAdoptionReceiptBlockerCount: persistedClientState.clientRuntimeAdoptionReceipt?.blockers?.length ?? 0,
        persistedClientWorkflowStatusReadyCount: persistedClientState.clientWorkflowStatusCapsule?.ready ? 1 : 0,
        persistedClientWorkflowStatusRestartSafeCount: persistedClientState.clientWorkflowStatusCapsule?.restartSafe ? 1 : 0,
        persistedClientWorkflowStatusBlockerCount: persistedClientState.clientWorkflowStatusCapsule?.blockers?.length ?? 0,
        persistedClientWorkflowStatusWarningCount: persistedClientState.clientWorkflowStatusCapsule?.warnings?.length ?? 0,
        persistedClientWorkflowAdoptionLeaseReadyCount: persistedClientState.clientWorkflowAdoptionLease?.ready ? 1 : 0,
        persistedClientWorkflowAdoptionLeaseRestartSafeCount: persistedClientState.clientWorkflowAdoptionLease?.restartSafe ? 1 : 0,
        persistedClientWorkflowAdoptionLeaseAlignedCount: persistedClientState.clientWorkflowAdoptionLease?.aligned ? 1 : 0,
        persistedClientWorkflowAdoptionLeaseBlockerCount: persistedClientState.clientWorkflowAdoptionLease?.blockers?.length ?? 0,
        persistedClientWorkflowAdoptionLeaseWarningCount: persistedClientState.clientWorkflowAdoptionLease?.warnings?.length ?? 0,
        externalStateRecoveryCapsuleReadyCount: write.stateRecoveryCapsule?.ready ? 1 : 0,
        externalStateRecoveryCapsuleRestartSafeCount: write.stateRecoveryCapsule?.restartSafe ? 1 : 0,
        externalStateRecoveryCapsuleCommandCount: write.stateRecoveryCapsule?.commands?.length ?? 0,
        externalStateRecoveryCapsuleCheckpointCount: write.stateRecoveryCapsule?.checkpoints?.length ?? 0,
        externalStateRecoveryCapsuleBlockerCount: write.stateRecoveryCapsule?.blockers?.length ?? 0,
        externalStateRecoveryCapsuleWarningCount: write.stateRecoveryCapsule?.warnings?.length ?? 0,
        externalAcceptancePreviewReadyCount: write.acceptancePreview?.ready ? 1 : 0,
        externalAcceptancePreviewRenderableCount: write.acceptancePreview?.renderable ? 1 : 0,
        externalAcceptancePreviewNextStepCount: write.acceptancePreview?.nextSteps?.length ?? 0,
        externalAcceptancePreviewBlockerCount: write.acceptancePreview?.blockers?.length ?? 0,
        externalAcceptancePreviewWarningCount: write.acceptancePreview?.warnings?.length ?? 0,
        acceptanceHandoffReadyCount: acceptanceHandoff.ready ? 1 : 0,
        acceptanceHandoffBlockerCount: acceptanceHandoff.blockers.length,
        exportContinuityReadyCount: exportContinuity.ready ? 1 : 0,
        exportContinuityBlockerCount: exportContinuity.blockers.length,
        exportContinuityCheckpointCount: exportContinuity.timeline.length,
        exportContinuityChangedCount: exportContinuity.changedSinceExternalLedger ? 1 : 0,
        readinessPreviewReadyCount: readinessPreview.ready ? 1 : 0,
        readinessPreviewBlockerCount: readinessPreview.blockers.length,
        readinessPreviewWarningCount: readinessPreview.warnings.length,
        readinessPreviewNextStepCount: readinessPreview.nextSteps.length,
        statusHandoffReadyCount: statusHandoff.ready ? 1 : 0,
        statusHandoffCheckpointCount: statusHandoff.checkpoints.length,
        statusHandoffBlockerCount: statusHandoff.blockers.length,
        statusHandoffWarningCount: statusHandoff.warnings.length,
        operationalRetryReadyCount: write.operationalRetry?.ready ? 1 : 0,
        operationalRetryScheduledCount: write.operationalRetry?.retryScheduled ? 1 : 0,
        operationalRetryDegradedCount: write.operationalRetry?.degradedMode ? 1 : 0,
        operationalRetryTerminalCount: write.operationalRetry?.state === 'terminal' ? 1 : 0,
        operationalRetryExhaustedCount: write.operationalRetry?.exhausted ? 1 : 0,
        operationalRetryBlockerCount: write.operationalRetry?.blockers?.length ?? 0,
        providerHandoffHealthReadyCount: write.providerHandoffHealth?.ready ? 1 : 0,
        providerHandoffHealthDegradedCount: write.providerHandoffHealth?.degraded ? 1 : 0,
        providerHandoffHealthRetryableCount: write.providerHandoffHealth?.retryable ? 1 : 0,
        providerHandoffHealthTerminalCount: write.providerHandoffHealth?.terminal ? 1 : 0,
        providerHandoffHealthBlockerCount: write.providerHandoffHealth?.blockers?.length ?? 0,
        providerHandoffHealthWarningCount: write.providerHandoffHealth?.warnings?.length ?? 0,
        providerHandoffHealthDependencyCount: write.providerHandoffHealth?.dependencies?.length ?? 0,
        providerHandoffHealthFailedDependencyCount: write.providerHandoffHealth?.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0,
        operatorHandoffManifestReadyCount: write.operatorHandoffManifest?.ready ? 1 : 0,
        operatorHandoffManifestStepCount: write.operatorHandoffManifest?.steps?.length ?? 0,
        operatorHandoffManifestBlockerCount: write.operatorHandoffManifest?.blockers?.length ?? 0,
        operatorHandoffManifestWarningCount: write.operatorHandoffManifest?.warnings?.length ?? 0
      },
      blockedReasons,
      nextAction: analyticsSummary.nextAction ?? nextRecoveryAction({ status, blockedReasons, write, continuation, kernelCall, provider, externalHandoff, replay, acceptanceHandoff, readinessPreview })
    },
    diagnostics
  };
}

export function summarizeRecoveryAnalysis(report) {
  return {
    status: report?.status ?? 'unknown',
    rollbackAction: report?.rollback?.action ?? null,
    retryStrategy: report?.retry?.strategy ?? null,
    retryMaxAttempts: report?.retry?.maxAttempts ?? 0,
    continuationStatus: report?.continuation?.status ?? 'unknown',
    externalWriteStatus: report?.externalWrite?.status ?? 'unknown',
    providerStatus: report?.provider?.status ?? 'unknown',
    providerHealth: {
      status: report?.provider?.health?.status ?? report?.externalWrite?.providerHealth?.status ?? 'unknown',
      ready: report?.provider?.health?.ready ?? report?.externalWrite?.providerHealth?.ready ?? false,
      degraded: report?.provider?.health?.degraded ?? report?.externalWrite?.providerHealth?.degraded ?? false,
      retryable: report?.provider?.health?.retryable ?? report?.externalWrite?.providerHealth?.retryable ?? false,
      retryAfterMs: report?.provider?.health?.retryAfterMs ?? report?.externalWrite?.providerHealth?.retryAfterMs ?? null,
      nextAction: report?.provider?.health?.nextAction ?? report?.externalWrite?.providerHealth?.nextAction ?? null
    },
    lifecycleControl: {
      state: report?.provider?.lifecycleControl?.state ?? report?.externalWrite?.lifecycleControls?.state ?? 'unknown',
      ready: report?.provider?.lifecycleControl?.ready ?? report?.externalWrite?.lifecycleControls?.ready ?? false,
      selectedControl: report?.provider?.lifecycleControl?.selectedControl ?? report?.externalWrite?.lifecycleControls?.selectedControl ?? null,
      userVisibleStatus: report?.provider?.lifecycleControl?.userVisibleStatus ?? report?.externalWrite?.lifecycleControls?.userVisibleStatus ?? null,
      digest: report?.provider?.lifecycleControl?.digest ?? report?.externalWrite?.lifecycleControls?.digest ?? null,
      nextAction: report?.provider?.lifecycleControl?.nextAction ?? report?.externalWrite?.lifecycleControls?.nextAction ?? null,
      commandCount: report?.provider?.lifecycleControl?.commandCount ?? report?.externalWrite?.lifecycleControls?.commands?.length ?? 0,
      blockerCount: report?.provider?.lifecycleControl?.blockers?.length ?? report?.externalWrite?.lifecycleControls?.blockers?.length ?? 0,
      warningCount: report?.provider?.lifecycleControl?.warnings?.length ?? report?.externalWrite?.lifecycleControls?.warnings?.length ?? 0
    },
    providerServiceContract: {
      state: report?.provider?.serviceContract?.state ?? report?.externalWrite?.providerServiceContract?.state ?? 'unknown',
      ready: report?.provider?.serviceContract?.ready ?? report?.externalWrite?.providerServiceContract?.ready ?? false,
      negotiationStatus: report?.provider?.serviceContract?.negotiationStatus ?? report?.externalWrite?.providerServiceContract?.negotiation?.status ?? 'unknown',
      missingCapabilityCount: report?.provider?.serviceContract?.missingCapabilities?.length ?? report?.externalWrite?.providerServiceContract?.missingCapabilities?.length ?? 0,
      externalStateKey: report?.provider?.serviceContract?.externalStateKey ?? report?.externalWrite?.providerServiceContract?.sync?.externalStateKey ?? null,
      digest: report?.provider?.serviceContract?.digest ?? report?.externalWrite?.providerServiceContract?.digest ?? null,
      nextAction: report?.provider?.serviceContract?.nextAction ?? report?.externalWrite?.providerServiceContract?.nextAction ?? null,
      providerSession: {
        state: report?.provider?.serviceContract?.providerSession?.state ?? report?.externalWrite?.providerServiceContract?.providerSession?.state ?? 'unknown',
        ready: report?.provider?.serviceContract?.providerSession?.ready ?? report?.externalWrite?.providerServiceContract?.providerSession?.ready ?? false,
        renewalRequired: report?.provider?.serviceContract?.providerSession?.renewalRequired ?? report?.externalWrite?.providerServiceContract?.providerSession?.renewalRequired ?? false,
        externalStateKey: report?.provider?.serviceContract?.providerSession?.externalStateKey ?? report?.externalWrite?.providerServiceContract?.providerSession?.externalStateKey ?? null,
        digest: report?.provider?.serviceContract?.providerSession?.digest ?? report?.externalWrite?.providerServiceContract?.providerSession?.digest ?? null,
        nextAction: report?.provider?.serviceContract?.providerSession?.nextAction ?? report?.externalWrite?.providerServiceContract?.providerSession?.nextAction ?? null,
        blockerCount: report?.provider?.serviceContract?.providerSession?.blockers?.length ?? report?.externalWrite?.providerServiceContract?.providerSession?.blockers?.length ?? 0
      },
      handoffReceipt: {
        state: report?.provider?.serviceContract?.handoffReceipt?.state ?? report?.externalWrite?.providerServiceContract?.handoffReceipt?.state ?? report?.externalWrite?.providerServiceContract?.sync?.handoffReceipt?.state ?? 'unknown',
        ready: report?.provider?.serviceContract?.handoffReceipt?.ready ?? report?.externalWrite?.providerServiceContract?.handoffReceipt?.ready ?? report?.externalWrite?.providerServiceContract?.sync?.handoffReceipt?.ready ?? false,
        acknowledged: report?.provider?.serviceContract?.handoffReceipt?.acknowledged ?? report?.externalWrite?.providerServiceContract?.handoffReceipt?.acknowledged ?? report?.externalWrite?.providerServiceContract?.sync?.handoffReceipt?.acknowledged ?? false,
        fresh: report?.provider?.serviceContract?.handoffReceipt?.fresh ?? report?.externalWrite?.providerServiceContract?.handoffReceipt?.fresh ?? report?.externalWrite?.providerServiceContract?.sync?.handoffReceipt?.fresh ?? false,
        digest: report?.provider?.serviceContract?.handoffReceipt?.digest ?? report?.externalWrite?.providerServiceContract?.handoffReceipt?.digest ?? report?.externalWrite?.providerServiceContract?.sync?.handoffReceipt?.digest ?? null,
        nextAction: report?.provider?.serviceContract?.handoffReceipt?.nextAction ?? report?.externalWrite?.providerServiceContract?.handoffReceipt?.nextAction ?? report?.externalWrite?.providerServiceContract?.sync?.handoffReceipt?.nextAction ?? null,
        blockerCount: report?.provider?.serviceContract?.handoffReceipt?.blockers?.length ?? report?.externalWrite?.providerServiceContract?.handoffReceipt?.blockers?.length ?? report?.externalWrite?.providerServiceContract?.sync?.handoffReceipt?.blockers?.length ?? 0,
        warningCount: report?.provider?.serviceContract?.handoffReceipt?.warnings?.length ?? report?.externalWrite?.providerServiceContract?.handoffReceipt?.warnings?.length ?? report?.externalWrite?.providerServiceContract?.sync?.handoffReceipt?.warnings?.length ?? 0
      }
    },
    boundaryRecoveryGuard: {
      state: report?.provider?.boundaryRecoveryGuard?.state ?? report?.externalWrite?.boundaryRecoveryGuard?.state ?? 'unknown',
      ready: report?.provider?.boundaryRecoveryGuard?.ready ?? report?.externalWrite?.boundaryRecoveryGuard?.ready ?? false,
      retryable: report?.provider?.boundaryRecoveryGuard?.retryable ?? report?.externalWrite?.boundaryRecoveryGuard?.retryable ?? false,
      guardDigest: report?.provider?.boundaryRecoveryGuard?.guardDigest ?? report?.externalWrite?.boundaryRecoveryGuard?.guardDigest ?? null,
      replayPolicy: report?.provider?.boundaryRecoveryGuard?.replayPolicy ?? report?.externalWrite?.boundaryRecoveryGuard?.replayPolicy ?? null,
      nextAction: report?.provider?.boundaryRecoveryGuard?.nextAction ?? report?.externalWrite?.boundaryRecoveryGuard?.nextAction ?? null,
      blockerCount: report?.provider?.boundaryRecoveryGuard?.blockers?.length ?? report?.externalWrite?.boundaryRecoveryGuard?.blockers?.length ?? 0,
      warningCount: report?.provider?.boundaryRecoveryGuard?.warnings?.length ?? report?.externalWrite?.boundaryRecoveryGuard?.warnings?.length ?? 0
    },
    boundaryPermissionPosture: {
      state: report?.externalWrite?.boundaryPermissionPosture?.state ?? 'unknown',
      ready: report?.externalWrite?.boundaryPermissionPosture?.ready ?? false,
      permissionMode: report?.externalWrite?.boundaryPermissionPosture?.permissionMode ?? 'unknown',
      role: report?.externalWrite?.boundaryPermissionPosture?.role ?? null,
      auditDigest: report?.externalWrite?.boundaryPermissionPosture?.auditDigest ?? null,
      postureDigest: report?.externalWrite?.boundaryPermissionPosture?.postureDigest ?? null,
      replayPolicy: report?.externalWrite?.boundaryPermissionPosture?.guardVector?.replayPolicy ?? null,
      nextAction: report?.externalWrite?.boundaryPermissionPosture?.nextAction ?? null,
      blockerCount: report?.externalWrite?.boundaryPermissionPosture?.blockers?.length ?? 0,
      warningCount: report?.externalWrite?.boundaryPermissionPosture?.warnings?.length ?? 0,
      missingAcknowledgementCount: report?.externalWrite?.boundaryPermissionPosture?.missingAcknowledgements?.length ?? 0,
      escalationCount: report?.externalWrite?.boundaryPermissionPosture?.escalations?.length ?? 0
    },
    boundaryDecisionReceipt: {
      state: report?.externalWrite?.boundaryDecisionReceipt?.state ?? 'unknown',
      ready: report?.externalWrite?.boundaryDecisionReceipt?.ready ?? false,
      decision: report?.externalWrite?.boundaryDecisionReceipt?.decision ?? 'unknown',
      releaseAllowed: report?.externalWrite?.boundaryDecisionReceipt?.release?.allowed ?? false,
      receiptDigest: report?.externalWrite?.boundaryDecisionReceipt?.receiptDigest ?? null,
      commandId: report?.externalWrite?.boundaryDecisionReceipt?.command?.commandId ?? null,
      evidenceCount: report?.externalWrite?.boundaryDecisionReceipt?.evidence?.length ?? 0,
      blockerCount: report?.externalWrite?.boundaryDecisionReceipt?.blockers?.length ?? 0,
      warningCount: report?.externalWrite?.boundaryDecisionReceipt?.warnings?.length ?? 0,
      nextAction: report?.externalWrite?.boundaryDecisionReceipt?.nextAction ?? null
    },
    boundaryReleaseGate: {
      state: report?.externalWrite?.boundaryReleaseGate?.state ?? 'unknown',
      ready: report?.externalWrite?.boundaryReleaseGate?.ready ?? false,
      releaseAllowed: report?.externalWrite?.boundaryReleaseGate?.releaseAllowed ?? false,
      gateDigest: report?.externalWrite?.boundaryReleaseGate?.gateDigest ?? null,
      commandId: report?.externalWrite?.boundaryReleaseGate?.command?.commandId ?? null,
      restartSafe: report?.externalWrite?.boundaryReleaseGate?.restartSemantics?.restartSafe ?? false,
      replayPolicy: report?.externalWrite?.boundaryReleaseGate?.replayPolicy ?? null,
      nextAction: report?.externalWrite?.boundaryReleaseGate?.nextAction ?? null,
      blockerCount: report?.externalWrite?.boundaryReleaseGate?.blockers?.length ?? 0,
      warningCount: report?.externalWrite?.boundaryReleaseGate?.warnings?.length ?? 0,
      missingAcknowledgementCount: report?.externalWrite?.boundaryReleaseGate?.missingAcknowledgements?.length ?? 0
    },
    syncReady: report?.sync?.ready ?? false,
    replayState: report?.replay?.state ?? 'unknown',
    replayCommandId: report?.replay?.commandId ?? null,
    providerCommandLedger: {
      state: report?.replay?.commandLedgerState ?? report?.externalWrite?.providerCommandLedger?.state ?? 'unknown',
      ready: report?.externalWrite?.providerCommandLedger?.ready ?? false,
      digest: report?.replay?.commandLedgerDigest ?? report?.externalWrite?.providerCommandLedger?.digest ?? null,
      replayMode: report?.replay?.commandLedgerReplayMode ?? report?.externalWrite?.providerCommandLedger?.replayMode ?? null,
      restartPolicy: report?.replay?.commandLedgerRestartPolicy ?? report?.externalWrite?.providerCommandLedger?.restartPolicy ?? null,
      duplicateSafe: report?.replay?.commandLedgerDuplicateSafe ?? report?.externalWrite?.providerCommandLedger?.duplicateSafe ?? false,
      replayable: report?.replay?.commandLedgerReplayable ?? report?.externalWrite?.providerCommandLedger?.replayable ?? false,
      entryCount: report?.replay?.commandLedgerEntryCount ?? report?.externalWrite?.providerCommandLedger?.entries?.length ?? 0,
      commandCount: report?.replay?.commandLedgerCommandIds?.length ?? report?.externalWrite?.providerCommandLedger?.commands?.length ?? 0
    },
    persistenceEnvelope: {
      state: report?.restartRecovery?.persistenceEnvelopeState ?? report?.externalWrite?.persistenceEnvelope?.state ?? 'unknown',
      ready: report?.persistedClientState?.persistenceEnvelope?.ready ?? report?.externalWrite?.persistenceEnvelope?.ready ?? false,
      digest: report?.restartRecovery?.persistenceEnvelopeDigest ?? report?.externalWrite?.persistenceEnvelope?.digest ?? null,
      resumePointer: report?.restartRecovery?.persistenceEnvelopeResumePointer ?? report?.externalWrite?.persistenceEnvelope?.resumePointer ?? null,
      manifestDigest: report?.restartRecovery?.persistenceEnvelopeManifestDigest ?? report?.externalWrite?.persistenceEnvelope?.manifestDigest ?? null,
      restartSafe: report?.restartRecovery?.persistenceEnvelopeRestartSafe ?? report?.externalWrite?.persistenceEnvelope?.restartSemantics?.restartSafe ?? false,
      recoveryHintCount: report?.restartRecovery?.persistenceEnvelopeRecoveryHints?.length ?? report?.externalWrite?.persistenceEnvelope?.recoveryHints?.length ?? 0,
      blockerCount: report?.externalWrite?.persistenceEnvelope?.blockers?.length ?? 0,
      nextAction: report?.externalWrite?.persistenceEnvelope?.nextAction ?? null
    },
    resumeCursor: {
      state: report?.analyticsSummary?.resumeCursor?.state ?? report?.restartRecovery?.resumeCursor?.state ?? report?.externalWrite?.resumeCursor?.state ?? 'unknown',
      ready: report?.analyticsSummary?.resumeCursor?.ready ?? report?.restartRecovery?.resumeCursor?.ready ?? report?.externalWrite?.resumeCursor?.ready ?? false,
      digest: report?.analyticsSummary?.resumeCursor?.digest ?? report?.restartRecovery?.resumeCursor?.digest ?? report?.externalWrite?.resumeCursor?.digest ?? null,
      cursorKey: report?.analyticsSummary?.resumeCursor?.cursorKey ?? report?.restartRecovery?.resumeCursor?.cursorKey ?? report?.externalWrite?.resumeCursor?.cursorKey ?? null,
      resumePointer: report?.analyticsSummary?.resumeCursor?.resumePointer ?? report?.restartRecovery?.resumeCursor?.resumePointer ?? report?.externalWrite?.resumeCursor?.resumePointer ?? null,
      restartSafe: report?.analyticsSummary?.resumeCursor?.restartSafe ?? report?.restartRecovery?.resumeCursor?.restartSafe ?? report?.externalWrite?.resumeCursor?.restartSemantics?.restartSafe ?? false,
      commandAligned: report?.analyticsSummary?.resumeCursor?.commandAligned ?? report?.restartRecovery?.resumeCursor?.commandAligned ?? false,
      statusChannelAligned: report?.analyticsSummary?.resumeCursor?.statusChannelAligned ?? report?.restartRecovery?.resumeCursor?.statusChannelAligned ?? false,
      envelopeDigestAligned: report?.analyticsSummary?.resumeCursor?.envelopeDigestAligned ?? report?.restartRecovery?.resumeCursor?.envelopeDigestAligned ?? false,
      routeDigestAligned: report?.analyticsSummary?.resumeCursor?.routeDigestAligned ?? report?.restartRecovery?.resumeCursor?.routeDigestAligned ?? false,
      checkpointCount: report?.analyticsSummary?.resumeCursor?.checkpointCount ?? report?.restartRecovery?.resumeCursor?.checkpointCount ?? report?.externalWrite?.resumeCursor?.checkpoints?.length ?? 0,
      nextAction: report?.analyticsSummary?.resumeCursor?.nextAction ?? report?.restartRecovery?.resumeCursor?.nextAction ?? report?.externalWrite?.resumeCursor?.nextAction ?? null
    },
    externalHandoffState: report?.externalHandoff?.state ?? 'unknown',
    restartRecovery: {
      state: report?.restartRecovery?.state ?? 'unknown',
      ready: report?.restartRecovery?.ready ?? false,
      digest: report?.restartRecovery?.digest ?? null,
      statusDigest: report?.restartRecovery?.statusDigest ?? null,
      statusJournalDigest: report?.restartRecovery?.statusJournalDigest ?? null,
      statusJournalState: report?.restartRecovery?.statusJournalState ?? 'unknown',
      statusJournalRestartPolicy: report?.restartRecovery?.statusJournalRestartPolicy ?? null,
      providerCommandLedgerDigest: report?.restartRecovery?.providerCommandLedgerDigest ?? null,
      providerCommandLedgerRestartPolicy: report?.restartRecovery?.providerCommandLedgerRestartPolicy ?? null,
      nextAction: report?.restartRecovery?.nextAction ?? null,
      blockerCount: report?.restartRecovery?.blockers?.length ?? 0
    },
    persistedClientState: {
      state: report?.persistedClientState?.state ?? 'unknown',
      ready: report?.persistedClientState?.ready ?? false,
      clientRequestDigest: report?.persistedClientState?.clientRequestSnapshot?.digest ?? null,
      clientRequestKey: report?.persistedClientState?.clientRequestSnapshot?.requestKey ?? null,
      clientAdoptionDigest: report?.persistedClientState?.clientRuntimeAdoption?.digest ?? null,
      clientAdoptionState: report?.persistedClientState?.clientRuntimeAdoption?.state ?? 'unknown',
      clientAdoptionReceiptDigest: report?.persistedClientState?.clientRuntimeAdoptionReceipt?.digest ?? null,
      clientAdoptionReceiptState: report?.persistedClientState?.clientRuntimeAdoptionReceipt?.state ?? 'unknown',
      clientAdoptionReceiptRestartSafe: report?.persistedClientState?.clientRuntimeAdoptionReceipt?.restartSafe ?? false,
      clientWorkflowStatusDigest: report?.persistedClientState?.clientWorkflowStatusCapsule?.digest ?? null,
      clientWorkflowStatusState: report?.persistedClientState?.clientWorkflowStatusCapsule?.state ?? 'unknown',
      clientWorkflowStatusRestartSafe: report?.persistedClientState?.clientWorkflowStatusCapsule?.restartSafe ?? false,
      statusChannel: report?.persistedClientState?.statusChannel ?? null,
      userVisibleStatus: report?.persistedClientState?.userVisibleStatus?.current ?? null,
      nextAction: report?.persistedClientState?.nextAction ?? null,
      blockerCount: report?.persistedClientState?.blockers?.length ?? 0
    },
    stateRecoveryCapsule: {
      state: report?.restartRecovery?.stateRecoveryCapsule?.state ?? report?.externalWrite?.stateRecoveryCapsule?.state ?? 'unknown',
      ready: report?.restartRecovery?.stateRecoveryCapsule?.ready ?? report?.externalWrite?.stateRecoveryCapsule?.ready ?? false,
      digest: report?.restartRecovery?.stateRecoveryCapsule?.digest ?? report?.externalWrite?.stateRecoveryCapsule?.digest ?? null,
      capsuleKey: report?.restartRecovery?.stateRecoveryCapsule?.capsuleKey ?? report?.externalWrite?.stateRecoveryCapsule?.capsuleKey ?? null,
      resumePointer: report?.restartRecovery?.stateRecoveryCapsule?.resumePointer ?? report?.externalWrite?.stateRecoveryCapsule?.resumePointer ?? null,
      restartSafe: report?.restartRecovery?.stateRecoveryCapsule?.restartSafe ?? report?.externalWrite?.stateRecoveryCapsule?.restartSafe ?? false,
      replayMode: report?.restartRecovery?.stateRecoveryCapsule?.replayMode ?? report?.externalWrite?.stateRecoveryCapsule?.replay?.mode ?? null,
      checkpointCount: report?.restartRecovery?.stateRecoveryCapsule?.checkpointCount ?? report?.externalWrite?.stateRecoveryCapsule?.checkpoints?.length ?? 0,
      commandCount: report?.restartRecovery?.stateRecoveryCapsule?.commandCount ?? report?.externalWrite?.stateRecoveryCapsule?.commands?.length ?? 0,
      blockerCount: report?.restartRecovery?.stateRecoveryCapsule?.blockers?.length ?? report?.externalWrite?.stateRecoveryCapsule?.blockers?.length ?? 0,
      warningCount: report?.restartRecovery?.stateRecoveryCapsule?.warnings?.length ?? report?.externalWrite?.stateRecoveryCapsule?.warnings?.length ?? 0,
      nextAction: report?.restartRecovery?.stateRecoveryCapsule?.nextAction ?? report?.externalWrite?.stateRecoveryCapsule?.nextAction ?? null
    },
    acceptanceHandoff: {
      state: report?.acceptanceHandoff?.state ?? 'unknown',
      ready: report?.acceptanceHandoff?.ready ?? false,
      nextAction: report?.acceptanceHandoff?.nextAction ?? null,
      operatorDecisionSource: report?.acceptanceHandoff?.operatorDecision?.source ?? report?.externalWrite?.operatorDecisionSource ?? 'unknown',
      operatorDecisionRestartSafe: report?.acceptanceHandoff?.operatorDecision?.restartSafe ?? report?.externalWrite?.operatorDecision?.restartSemantics?.restartSafe ?? false,
      blockerCount: report?.acceptanceHandoff?.blockers?.length ?? 0
    },
    exportContinuity: {
      state: report?.exportContinuity?.state ?? 'unknown',
      ready: report?.exportContinuity?.ready ?? false,
      digest: report?.exportContinuity?.digest ?? null,
      ledgerDigest: report?.exportContinuity?.ledgerDigest ?? null,
      snapshotDigest: report?.exportContinuity?.snapshotDigest ?? null,
      changedSinceExternalLedger: report?.exportContinuity?.changedSinceExternalLedger ?? false,
      checkpointCount: report?.exportContinuity?.timeline?.length ?? 0,
      nextAction: report?.exportContinuity?.nextAction ?? null,
      blockerCount: report?.exportContinuity?.blockers?.length ?? 0
    },
    readinessPreview: {
      state: report?.readinessPreview?.state ?? 'unknown',
      ready: report?.readinessPreview?.ready ?? false,
      userVisibleStatus: report?.readinessPreview?.userVisibleStatus ?? null,
      primaryAction: report?.readinessPreview?.primaryAction ?? null,
      acceptanceCheckpointBundle: {
        state: report?.readinessPreview?.acceptanceCheckpointBundle?.state ?? report?.externalWrite?.acceptanceCheckpointBundle?.state ?? 'unknown',
        ready: report?.readinessPreview?.acceptanceCheckpointBundle?.ready ?? report?.externalWrite?.acceptanceCheckpointBundle?.ready ?? false,
        aligned: report?.readinessPreview?.acceptanceCheckpointBundle?.aligned ?? report?.externalWrite?.acceptanceCheckpointBundle?.aligned ?? false,
        restartSafe: report?.readinessPreview?.acceptanceCheckpointBundle?.restartSafe ?? report?.externalWrite?.acceptanceCheckpointBundle?.restartSafe ?? false,
        digest: report?.readinessPreview?.acceptanceCheckpointBundle?.digest ?? report?.externalWrite?.acceptanceCheckpointBundle?.digest ?? null,
        commandId: report?.readinessPreview?.acceptanceCheckpointBundle?.commandId ?? report?.externalWrite?.acceptanceCheckpointBundle?.commandId ?? null,
        checkpointCount: report?.readinessPreview?.acceptanceCheckpointBundle?.checkpointCount ?? report?.externalWrite?.acceptanceCheckpointBundle?.checkpoints?.length ?? 0,
        nextAction: report?.readinessPreview?.acceptanceCheckpointBundle?.nextAction ?? report?.externalWrite?.acceptanceCheckpointBundle?.nextAction ?? null,
        blockerCount: report?.readinessPreview?.acceptanceCheckpointBundle?.blockers?.length ?? report?.externalWrite?.acceptanceCheckpointBundle?.blockers?.length ?? 0,
        warningCount: report?.readinessPreview?.acceptanceCheckpointBundle?.warnings?.length ?? report?.externalWrite?.acceptanceCheckpointBundle?.warnings?.length ?? 0
      },
      acceptancePreview: {
        state: report?.readinessPreview?.acceptancePreview?.state ?? report?.externalWrite?.acceptancePreview?.state ?? 'unknown',
        ready: report?.readinessPreview?.acceptancePreview?.ready ?? report?.externalWrite?.acceptancePreview?.ready ?? false,
        renderable: report?.readinessPreview?.acceptancePreview?.renderable ?? report?.externalWrite?.acceptancePreview?.renderable ?? false,
        presentationMode: report?.readinessPreview?.acceptancePreview?.presentationMode ?? report?.externalWrite?.acceptancePreview?.presentationMode ?? null,
        primaryAction: report?.readinessPreview?.acceptancePreview?.primaryAction ?? report?.externalWrite?.acceptancePreview?.primaryAction ?? null,
        commandId: report?.readinessPreview?.acceptancePreview?.commandId ?? report?.externalWrite?.acceptancePreview?.command?.commandId ?? null,
        digest: report?.readinessPreview?.acceptancePreview?.digest ?? report?.externalWrite?.acceptancePreview?.digest ?? null,
        validationOk: report?.readinessPreview?.acceptancePreview?.validationOk ?? report?.externalWrite?.acceptancePreview?.validationSummary?.ok ?? false,
        nextStepCount: report?.readinessPreview?.acceptancePreview?.nextStepCount ?? report?.externalWrite?.acceptancePreview?.nextSteps?.length ?? 0,
        blockerCount: report?.readinessPreview?.acceptancePreview?.blockers?.length ?? report?.externalWrite?.acceptancePreview?.blockers?.length ?? 0,
        warningCount: report?.readinessPreview?.acceptancePreview?.warnings?.length ?? report?.externalWrite?.acceptancePreview?.warnings?.length ?? 0
      },
      operatorHandoffManifest: {
        state: report?.readinessPreview?.operatorHandoffManifest?.state ?? report?.externalWrite?.operatorHandoffManifest?.state ?? 'unknown',
        ready: report?.readinessPreview?.operatorHandoffManifest?.ready ?? report?.externalWrite?.operatorHandoffManifest?.ready ?? false,
        presentationMode: report?.readinessPreview?.operatorHandoffManifest?.presentationMode ?? report?.externalWrite?.operatorHandoffManifest?.presentationMode ?? null,
        primaryAction: report?.readinessPreview?.operatorHandoffManifest?.primaryAction ?? report?.externalWrite?.operatorHandoffManifest?.primaryAction ?? null,
        commandId: report?.readinessPreview?.operatorHandoffManifest?.commandId ?? report?.externalWrite?.operatorHandoffManifest?.command?.commandId ?? null,
        digest: report?.readinessPreview?.operatorHandoffManifest?.digest ?? report?.externalWrite?.operatorHandoffManifest?.digest ?? null
      },
      operatorDecision: {
        state: report?.readinessPreview?.operatorDecision?.state ?? report?.externalWrite?.operatorDecision?.state ?? 'unknown',
        ready: report?.readinessPreview?.operatorDecision?.ready ?? report?.externalWrite?.operatorDecision?.ready ?? false,
        presentationMode: report?.readinessPreview?.operatorDecision?.presentationMode ?? report?.externalWrite?.operatorDecision?.presentationMode ?? null,
        primaryCommand: report?.readinessPreview?.operatorDecision?.primaryCommand ?? report?.externalWrite?.operatorDecision?.primaryCommand ?? null,
        commandId: report?.readinessPreview?.operatorDecision?.commandId ?? report?.externalWrite?.operatorDecision?.command?.commandId ?? report?.externalWrite?.operatorHandoffManifest?.command?.commandId ?? null,
        digest: report?.readinessPreview?.operatorDecision?.digest ?? report?.externalWrite?.operatorDecision?.digest ?? report?.externalWrite?.operatorHandoffManifest?.digest ?? null,
        source: report?.readinessPreview?.operatorDecision?.source ?? report?.externalWrite?.operatorDecisionSource ?? 'unknown',
        restartSafe: report?.readinessPreview?.operatorDecision?.restartSafe ?? report?.externalWrite?.operatorDecision?.restartSemantics?.restartSafe ?? false
      },
      lifecycleDecision: {
        state: report?.readinessPreview?.lifecycleDecision?.state ?? 'unknown',
        selectedCommand: report?.readinessPreview?.lifecycleDecision?.selectedCommand ?? null,
        requiresAcknowledgement: report?.readinessPreview?.lifecycleDecision?.requiresAcknowledgement ?? false,
        digest: report?.readinessPreview?.lifecycleDecision?.digest ?? null
      },
      blockerCount: report?.readinessPreview?.blockers?.length ?? 0,
      warningCount: report?.readinessPreview?.warnings?.length ?? 0,
      nextStepCount: report?.readinessPreview?.nextSteps?.length ?? 0
    },
    statusHandoff: {
      state: report?.statusHandoff?.state ?? 'unknown',
      ready: report?.statusHandoff?.ready ?? false,
      digest: report?.statusHandoff?.digest ?? null,
      externalDigest: report?.statusHandoff?.externalDigest ?? null,
      recoveryDigest: report?.statusHandoff?.recoveryDigest ?? null,
      statusChannel: report?.statusHandoff?.statusChannel ?? null,
      commandId: report?.statusHandoff?.commandId ?? null,
      restartToken: report?.statusHandoff?.restartToken ?? null,
      checkpointCount: report?.statusHandoff?.checkpoints?.length ?? 0,
      nextAction: report?.statusHandoff?.nextAction ?? null,
      blockerCount: report?.statusHandoff?.blockers?.length ?? 0,
      warningCount: report?.statusHandoff?.warnings?.length ?? 0
    },
    operationalRetry: {
      state: report?.statusHandoff?.operationalRetry?.state ?? report?.externalWrite?.operationalRetry?.state ?? 'unknown',
      ready: report?.statusHandoff?.operationalRetry?.ready ?? report?.externalWrite?.operationalRetry?.ready ?? false,
      retryScheduled: report?.statusHandoff?.operationalRetry?.retryScheduled ?? report?.externalWrite?.operationalRetry?.retryScheduled ?? false,
      retryAfterMs: report?.statusHandoff?.operationalRetry?.retryAfterMs ?? report?.externalWrite?.operationalRetry?.retryAfterMs ?? null,
      attempt: report?.statusHandoff?.operationalRetry?.attempt ?? report?.externalWrite?.operationalRetry?.attempt ?? 0,
      maxAttempts: report?.statusHandoff?.operationalRetry?.maxAttempts ?? report?.externalWrite?.operationalRetry?.maxAttempts ?? 0,
      exhausted: report?.statusHandoff?.operationalRetry?.exhausted ?? report?.externalWrite?.operationalRetry?.exhausted ?? false,
      degradedMode: report?.statusHandoff?.operationalRetry?.degradedMode?.mode ?? report?.externalWrite?.operationalRetry?.degradedMode?.mode ?? null,
      commandId: report?.statusHandoff?.operationalRetry?.nextRetryCommand?.commandId ?? report?.externalWrite?.operationalRetry?.nextRetryCommand?.commandId ?? null,
      digest: report?.statusHandoff?.operationalRetry?.digest ?? report?.externalWrite?.operationalRetry?.digest ?? null,
      nextAction: report?.statusHandoff?.operationalRetry?.nextAction ?? report?.externalWrite?.operationalRetry?.nextAction ?? null
    },
    providerHandoffHealth: {
      state: report?.analyticsSummary?.providerHandoffHealth?.state ?? report?.externalWrite?.providerHandoffHealth?.state ?? 'unknown',
      ready: report?.analyticsSummary?.providerHandoffHealth?.ready ?? report?.externalWrite?.providerHandoffHealth?.ready ?? false,
      degraded: report?.analyticsSummary?.providerHandoffHealth?.degraded ?? report?.externalWrite?.providerHandoffHealth?.degraded ?? false,
      retryable: report?.analyticsSummary?.providerHandoffHealth?.retryable ?? report?.externalWrite?.providerHandoffHealth?.retryable ?? false,
      terminal: report?.analyticsSummary?.providerHandoffHealth?.terminal ?? report?.externalWrite?.providerHandoffHealth?.terminal ?? false,
      statusChannel: report?.analyticsSummary?.providerHandoffHealth?.statusChannel ?? report?.externalWrite?.providerHandoffHealth?.statusChannel ?? null,
      commandId: report?.analyticsSummary?.providerHandoffHealth?.commandId ?? report?.externalWrite?.providerHandoffHealth?.commandId ?? null,
      receiptDigest: report?.analyticsSummary?.providerHandoffHealth?.receiptDigest ?? report?.externalWrite?.providerHandoffHealth?.receipt?.digest ?? null,
      retryAfterMs: report?.analyticsSummary?.providerHandoffHealth?.retryAfterMs ?? report?.externalWrite?.providerHandoffHealth?.retryWindow?.retryAfterMs ?? null,
      dependencyCount: report?.analyticsSummary?.providerHandoffHealth?.dependencyCount ?? report?.externalWrite?.providerHandoffHealth?.dependencies?.length ?? 0,
      failedDependencyCount: report?.analyticsSummary?.providerHandoffHealth?.failedDependencyCount ?? report?.externalWrite?.providerHandoffHealth?.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0,
      blockerCount: report?.analyticsSummary?.providerHandoffHealth?.blockerCount ?? report?.externalWrite?.providerHandoffHealth?.blockers?.length ?? 0,
      warningCount: report?.analyticsSummary?.providerHandoffHealth?.warningCount ?? report?.externalWrite?.providerHandoffHealth?.warnings?.length ?? 0,
      digest: report?.analyticsSummary?.providerHandoffHealth?.digest ?? report?.externalWrite?.providerHandoffHealth?.digest ?? null,
      nextAction: report?.analyticsSummary?.providerHandoffHealth?.nextAction ?? report?.externalWrite?.providerHandoffHealth?.nextAction ?? null
    },
    analyticsSummary: {
      status: report?.analyticsSummary?.status ?? 'unknown',
      exportReady: report?.analyticsSummary?.exportReady ?? false,
      reportDigest: report?.analyticsSummary?.reportDigest ?? null,
      lifecycleCommandState: {
        state: report?.analyticsSummary?.lifecycleCommandState?.state ?? 'unknown',
        ready: report?.analyticsSummary?.lifecycleCommandState?.ready ?? false,
        selectedCommand: report?.analyticsSummary?.lifecycleCommandState?.selectedCommand ?? null,
        queueState: report?.analyticsSummary?.lifecycleCommandState?.lifecycleQueue?.state ?? 'unknown',
        queueDigest: report?.analyticsSummary?.lifecycleCommandState?.lifecycleQueue?.digest ?? null,
        pendingCount: report?.analyticsSummary?.lifecycleCommandState?.lifecycleQueue?.pendingCount ?? 0,
        blockedCount: report?.analyticsSummary?.lifecycleCommandState?.lifecycleQueue?.blockedCount ?? 0,
        missingAcknowledgementCount: report?.analyticsSummary?.lifecycleCommandState?.lifecycleQueue?.missingAcknowledgementCount ?? 0,
        commandCount: report?.analyticsSummary?.lifecycleCommandState?.commands?.length ?? 0,
        nextAction: report?.analyticsSummary?.lifecycleCommandState?.nextAction ?? null
      },
      snapshotCount: report?.analyticsSummary?.historySnapshots?.length ?? 0,
      timelineCount: report?.analyticsSummary?.timeline?.length ?? 0,
      failedPhaseCount: report?.analyticsSummary?.counters?.failedPhaseCount ?? 0,
      degradedPhaseCount: report?.analyticsSummary?.counters?.degradedPhaseCount ?? 0,
      nextAction: report?.analyticsSummary?.nextAction ?? null
    },
    routeExportState: {
      state: report?.analyticsSummary?.routeExport?.state ?? report?.externalWrite?.routeExportState?.state ?? 'unknown',
      ready: report?.analyticsSummary?.routeExport?.ready ?? report?.externalWrite?.routeExportState?.ready ?? false,
      digest: report?.analyticsSummary?.routeExport?.digest ?? report?.externalWrite?.routeExportState?.digest ?? null,
      publishCommandId: report?.analyticsSummary?.routeExport?.publishCommandId ?? report?.externalWrite?.routeExportState?.publishCommand?.commandId ?? null,
      changedSinceAcceptedSnapshot: report?.analyticsSummary?.routeExport?.changedSinceAcceptedSnapshot ?? report?.externalWrite?.routeExportState?.changedSinceAcceptedSnapshot ?? false,
      nextAction: report?.analyticsSummary?.routeExport?.nextAction ?? report?.externalWrite?.routeExportState?.nextAction ?? null,
      blockerCount: report?.analyticsSummary?.routeExport?.blockers?.length ?? report?.externalWrite?.routeExportState?.blockers?.length ?? 0,
      warningCount: report?.analyticsSummary?.routeExport?.warnings?.length ?? report?.externalWrite?.routeExportState?.warnings?.length ?? 0
    },
    operationalIncident: {
      state: report?.analyticsSummary?.operationalIncident?.state ?? report?.externalWrite?.operationalIncident?.state ?? 'unknown',
      severity: report?.analyticsSummary?.operationalIncident?.severity ?? report?.externalWrite?.operationalIncident?.severity ?? 'none',
      open: report?.analyticsSummary?.operationalIncident?.open ?? report?.externalWrite?.operationalIncident?.open ?? false,
      retryable: report?.analyticsSummary?.operationalIncident?.retryable ?? report?.externalWrite?.operationalIncident?.retryable ?? false,
      terminal: report?.analyticsSummary?.operationalIncident?.terminal ?? report?.externalWrite?.operationalIncident?.terminal ?? false,
      owner: report?.analyticsSummary?.operationalIncident?.owner ?? report?.externalWrite?.operationalIncident?.owner ?? null,
      retryAfterMs: report?.analyticsSummary?.operationalIncident?.retryAfterMs ?? report?.externalWrite?.operationalIncident?.retryWindow?.retryAfterMs ?? null,
      digest: report?.analyticsSummary?.operationalIncident?.digest ?? report?.externalWrite?.operationalIncident?.digest ?? null,
      nextAction: report?.analyticsSummary?.operationalIncident?.nextAction ?? report?.externalWrite?.operationalIncident?.nextAction ?? null
    },
    recoveryRunbook: {
      state: report?.analyticsSummary?.recoveryRunbook?.state ?? report?.externalWrite?.recoveryRunbook?.state ?? 'unknown',
      ready: report?.analyticsSummary?.recoveryRunbook?.ready ?? report?.externalWrite?.recoveryRunbook?.ready ?? false,
      mode: report?.analyticsSummary?.recoveryRunbook?.mode ?? report?.externalWrite?.recoveryRunbook?.mode ?? null,
      primaryCommandId: report?.analyticsSummary?.recoveryRunbook?.primaryCommandId ?? report?.externalWrite?.recoveryRunbook?.primaryCommandId ?? null,
      retryAfterMs: report?.analyticsSummary?.recoveryRunbook?.retryAfterMs ?? report?.externalWrite?.recoveryRunbook?.retryAfterMs ?? null,
      digest: report?.analyticsSummary?.recoveryRunbook?.digest ?? report?.externalWrite?.recoveryRunbook?.digest ?? null,
      nextAction: report?.analyticsSummary?.recoveryRunbook?.nextAction ?? report?.externalWrite?.recoveryRunbook?.nextAction ?? null,
      stepCount: report?.analyticsSummary?.recoveryRunbook?.stepCount ?? report?.externalWrite?.recoveryRunbook?.steps?.length ?? 0,
      executableStepCount: report?.analyticsSummary?.recoveryRunbook?.executableStepCount ?? report?.externalWrite?.recoveryRunbook?.steps?.filter((step) => step.executable).length ?? 0,
      blockerCount: report?.analyticsSummary?.recoveryRunbook?.blockerCount ?? report?.externalWrite?.recoveryRunbook?.blockers?.length ?? 0,
      warningCount: report?.analyticsSummary?.recoveryRunbook?.warningCount ?? report?.externalWrite?.recoveryRunbook?.warnings?.length ?? 0
    },
    nextAction: report?.nextAction ?? 'operator_review',
    blockedReasons: report?.blockedReasons ?? []
  };
}

export function validateRecoveryAnalysis(report) {
  const diagnostics = [];
  if (!report?.version) diagnostics.push({ level: 'error', code: 'missing_recovery_report_version' });
  if (report?.rollback?.required && !report?.rollback?.action) {
    diagnostics.push({ level: 'error', code: 'recovery_missing_rollback_action' });
  }
  if ((report?.retry?.maxAttempts ?? 0) < 1) {
    diagnostics.push({ level: 'error', code: 'recovery_invalid_retry_policy' });
  }
  if (report?.externalWrite?.writeRequired && !report?.rollback?.required) {
    diagnostics.push({ level: 'error', code: 'recovery_write_requires_rollback' });
  }
  if (report?.handoff?.requiresResume && !report?.continuation?.restartToken) {
    diagnostics.push({ level: 'warning', code: 'recovery_missing_restart_token' });
  }
  if (report?.provider?.status === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_provider_contract_blocked',
      blockers: report.provider.blockers ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && report?.replay?.required && !report?.replay?.commandId) {
    diagnostics.push({ level: 'error', code: 'recovery_missing_replay_command_id' });
  }
  diagnostics.push(...validateExternalStateRecoveryCapsule(report?.externalWrite?.stateRecoveryCapsule, report?.externalWrite ?? {}));
  diagnostics.push(...validateRecoveryStateIntegrityManifest(report?.externalWrite?.stateIntegrityManifest, report?.externalWrite ?? {}));
  if (report?.replay?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_provider_replay_blocked',
      blockers: report.replay.blockers ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && report?.externalWrite?.boundaryPermissionPosture?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_boundary_permission_posture_blocked',
      blockers: report.externalWrite.boundaryPermissionPosture.blockers ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && report?.externalWrite?.boundaryPermissionPosture?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_boundary_permission_posture_requires_review',
      missingAcknowledgements: report.externalWrite.boundaryPermissionPosture.missingAcknowledgements ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && report?.externalWrite?.boundaryDecisionReceipt?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_boundary_decision_receipt_blocked',
      blockers: report.externalWrite.boundaryDecisionReceipt.blockers ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && report?.externalWrite?.boundaryDecisionReceipt?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_boundary_decision_receipt_requires_review',
      warnings: report.externalWrite.boundaryDecisionReceipt.warnings ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && report?.externalWrite?.boundaryReleaseGate?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_boundary_release_gate_blocked',
      blockers: report.externalWrite.boundaryReleaseGate.blockers ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && report?.externalWrite?.boundaryReleaseGate?.releaseAllowed !== true) {
    diagnostics.push({
      level: report?.externalWrite?.boundaryReleaseGate?.state === 'review' ? 'warning' : 'error',
      code: 'recovery_boundary_release_gate_not_open',
      nextAction: report.externalWrite.boundaryReleaseGate?.nextAction ?? 'open_boundary_release_gate'
    });
  }
  if (report?.externalWrite?.writeRequired && report?.externalWrite?.boundaryReleaseGate?.restartSemantics?.restartSafe === false) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_boundary_release_gate_not_restart_safe',
      nextAction: report.externalWrite.boundaryReleaseGate?.nextAction ?? 'rebuild_boundary_release_gate'
    });
  }
  if (report?.externalWrite?.writeRequired && !report?.externalWrite?.recoveryRunbook?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_missing_external_write_runbook' });
  }
  if (report?.externalWrite?.writeRequired && !report?.externalWrite?.recoveryRunbook?.steps?.length) {
    diagnostics.push({ level: 'error', code: 'recovery_external_write_runbook_missing_steps' });
  }
  if (report?.externalWrite?.recoveryRunbook?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_external_write_runbook_blocked',
      blockers: report.externalWrite.recoveryRunbook.blockers ?? []
    });
  }
  if (report?.externalWrite?.recoveryRunbook?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_external_write_runbook_review',
      warnings: report.externalWrite.recoveryRunbook.warnings ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && !report?.externalWrite?.providerHandoffHealth?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_missing_provider_handoff_health' });
  }
  if (report?.externalWrite?.providerHandoffHealth?.terminal) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_provider_handoff_health_terminal',
      blockers: report.externalWrite.providerHandoffHealth.blockers ?? []
    });
  }
  if (report?.externalWrite?.providerHandoffHealth?.retryWindow?.scheduled && !report?.externalWrite?.providerHandoffHealth?.retryWindow?.retryAfterMs) {
    diagnostics.push({ level: 'error', code: 'recovery_provider_handoff_health_missing_backoff' });
  }
  if (report?.externalWrite?.providerHandoffHealth?.degraded) {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_provider_handoff_health_degraded',
      warnings: report.externalWrite.providerHandoffHealth.warnings ?? []
    });
  }
  diagnostics.push(...validateRestartRecoveryPlan(report?.restartRecovery, report?.externalWrite ?? {}));
  diagnostics.push(...validatePersistedClientRuntimeState(report?.persistedClientState, report?.externalWrite ?? {}));
  diagnostics.push(...validateRecoveryAcceptanceHandoff(report?.acceptanceHandoff, report?.externalWrite ?? {}));
  diagnostics.push(...validateRecoveryExportContinuity(report?.exportContinuity, report?.externalWrite ?? {}));
  diagnostics.push(...validateRecoveryReadinessPreview(report?.readinessPreview, report?.externalWrite ?? {}));
  diagnostics.push(...validateRecoveryStatusHandoff(report?.statusHandoff, report?.externalWrite ?? {}));
  diagnostics.push(...validateRecoveryAnalyticsSummary(report?.analyticsSummary, report));
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
    diagnostics
  };
}

function buildRecoveryStatusHandoff({
  kernelCall,
  continuation,
  handoff,
  write,
  provider,
  replay,
  externalHandoff,
  restartRecovery,
  persistedClientState,
  acceptanceHandoff,
  exportContinuity,
  readinessPreview,
  exportReport
}) {
  const externalStatusHandoff = write.statusHandoff ?? {};
  const operationalRetry = write.operationalRetry ?? externalStatusHandoff.operationalRetry ?? {};
  const writeRequired = write.writeRequired === true;
  const checkpoints = [
    recoveryStatusCheckpoint('external_status_handoff', externalStatusHandoff.state, externalStatusHandoff.digest, externalStatusHandoff.blockers),
    recoveryStatusCheckpoint('external_operational_retry', operationalRetry.state, operationalRetry.digest, operationalRetry.blockers),
    recoveryStatusCheckpoint('provider_handoff_health', write.providerHandoffHealth?.state, write.providerHandoffHealth?.digest, write.providerHandoffHealth?.blockers),
    recoveryStatusCheckpoint('provider_recovery', provider.status, provider.digest ?? provider.serviceContract?.digest, provider.blockers),
    recoveryStatusCheckpoint('boundary_decision_receipt', write.boundaryDecisionReceipt?.state, write.boundaryDecisionReceipt?.receiptDigest, write.boundaryDecisionReceipt?.blockers),
    recoveryStatusCheckpoint('boundary_release_gate', write.boundaryReleaseGate?.state, write.boundaryReleaseGate?.gateDigest, write.boundaryReleaseGate?.blockers),
    recoveryStatusCheckpoint('provider_replay', replay.state, replay.commandDigest ?? replay.commandId, replay.blockers),
    recoveryStatusCheckpoint('external_handoff', externalHandoff.state, externalHandoff.digest, externalHandoff.blockers),
    recoveryStatusCheckpoint('restart_recovery', restartRecovery.state, restartRecovery.digest, restartRecovery.blockers),
    recoveryStatusCheckpoint('persisted_client_state', persistedClientState.state, persistedClientState.digest, persistedClientState.blockers),
    recoveryStatusCheckpoint('client_runtime_adoption', persistedClientState.clientRuntimeAdoption?.state, persistedClientState.clientRuntimeAdoption?.digest, persistedClientState.clientRuntimeAdoption?.blockers),
    recoveryStatusCheckpoint('client_runtime_adoption_receipt', persistedClientState.clientRuntimeAdoptionReceipt?.state, persistedClientState.clientRuntimeAdoptionReceipt?.digest, persistedClientState.clientRuntimeAdoptionReceipt?.blockers),
    recoveryStatusCheckpoint('acceptance_handoff', acceptanceHandoff.state, acceptanceHandoff.digest, acceptanceHandoff.blockers),
    recoveryStatusCheckpoint('export_continuity', exportContinuity.state, exportContinuity.digest, exportContinuity.blockers),
    recoveryStatusCheckpoint('readiness_preview', readinessPreview.state, readinessPreview.digest, readinessPreview.blockers)
  ];
  const blockers = uniqueSorted([
    ...(externalStatusHandoff.blockers ?? []).map((blocker) => `external_status_${blocker}`),
    ...(operationalRetry.blockers ?? []).map((blocker) => `operational_retry_${blocker}`),
    ...(writeRequired && !operationalRetry.digest ? ['missing_recovery_operational_retry_digest'] : []),
    ...(operationalRetry.state === 'terminal' ? ['recovery_operational_retry_terminal'] : []),
    ...(operationalRetry.retryScheduled && !operationalRetry.retryAfterMs ? ['recovery_operational_retry_missing_backoff'] : []),
    ...(writeRequired && !write.providerHandoffHealth?.digest ? ['missing_recovery_provider_handoff_health'] : []),
    ...(write.providerHandoffHealth?.terminal ? ['recovery_provider_handoff_health_terminal'] : []),
    ...(write.providerHandoffHealth?.blockers ?? []).map((blocker) => `provider_handoff_health_${blocker}`),
    ...(provider.blockers ?? []).map((blocker) => `provider_${blocker}`),
    ...(write.boundaryDecisionReceipt?.blockers ?? []).map((blocker) => `boundary_decision_${blocker}`),
    ...(writeRequired && write.boundaryDecisionReceipt?.ready !== true ? ['missing_recovery_boundary_decision_receipt'] : []),
    ...(writeRequired && write.boundaryDecisionReceipt?.release?.allowed === false ? ['recovery_boundary_release_not_allowed'] : []),
    ...(write.boundaryReleaseGate?.blockers ?? []).map((blocker) => `boundary_release_gate_${blocker}`),
    ...(writeRequired && write.boundaryReleaseGate?.ready !== true ? ['missing_recovery_boundary_release_gate'] : []),
    ...(writeRequired && write.boundaryReleaseGate?.releaseAllowed !== true ? ['recovery_boundary_release_gate_not_open'] : []),
    ...(writeRequired && write.boundaryReleaseGate?.restartSemantics?.restartSafe === false ? ['recovery_boundary_release_gate_not_restart_safe'] : []),
    ...(replay.blockers ?? []).map((blocker) => `replay_${blocker}`),
    ...(externalHandoff.blockers ?? []).map((blocker) => `external_handoff_${blocker}`),
    ...(restartRecovery.blockers ?? []).map((blocker) => `restart_${blocker}`),
    ...(persistedClientState.blockers ?? []).map((blocker) => `client_${blocker}`),
    ...(persistedClientState.clientRuntimeAdoption?.state === 'blocked' ? ['client_runtime_adoption_blocked'] : []),
    ...(persistedClientState.clientRuntimeAdoptionReceipt?.state === 'blocked' ? ['client_runtime_adoption_receipt_blocked'] : []),
    ...(acceptanceHandoff.blockers ?? []).map((blocker) => `acceptance_${blocker}`),
    ...(exportContinuity.blockers ?? []).map((blocker) => `export_${blocker}`),
    ...(readinessPreview.blockers ?? []).map((blocker) => `readiness_${blocker}`),
    ...(!externalStatusHandoff.digest && writeRequired ? ['missing_recovery_external_status_handoff_digest'] : []),
    ...(!restartRecovery.digest && writeRequired ? ['missing_recovery_status_handoff_restart_digest'] : []),
    ...(!persistedClientState.digest && writeRequired ? ['missing_recovery_status_handoff_client_digest'] : []),
    ...(!persistedClientState.clientRuntimeAdoption?.digest && writeRequired ? ['missing_recovery_status_handoff_client_adoption_digest'] : []),
    ...(!persistedClientState.clientRuntimeAdoptionReceipt?.digest && writeRequired ? ['missing_recovery_status_handoff_client_adoption_receipt_digest'] : []),
    ...(!exportContinuity.digest && writeRequired ? ['missing_recovery_status_handoff_export_digest'] : []),
    ...(!handoff.statusChannel && writeRequired ? ['missing_recovery_status_handoff_channel'] : []),
    ...(!replay.commandId && writeRequired ? ['missing_recovery_status_handoff_command_id'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(externalStatusHandoff.warnings ?? []).map((warning) => `external_status_${warning}`),
    ...(operationalRetry.warnings ?? []).map((warning) => `operational_retry_${warning}`),
    ...(operationalRetry.retryScheduled ? ['operational_retry_scheduled'] : []),
    ...(operationalRetry.degradedMode ? ['operational_retry_degraded_mode'] : []),
    ...(write.providerHandoffHealth?.warnings ?? []).map((warning) => `provider_handoff_health_${warning}`),
    ...(write.providerHandoffHealth?.degraded ? ['provider_handoff_health_degraded'] : []),
    ...(provider.health?.degraded ? ['provider_health_degraded'] : []),
    ...(write.boundaryDecisionReceipt?.state === 'review' ? ['boundary_decision_receipt_requires_review'] : []),
    ...(write.boundaryReleaseGate?.state === 'review' ? ['boundary_release_gate_requires_review'] : []),
    ...((write.boundaryReleaseGate?.missingAcknowledgements ?? []).map((acknowledgement) => `boundary_release_gate_missing_ack:${acknowledgement}`)),
    ...(persistedClientState.clientRuntimeAdoption?.state === 'awaiting_acknowledgement' ? ['client_runtime_adoption_awaiting_acknowledgement'] : []),
    ...(persistedClientState.clientRuntimeAdoptionReceipt?.state === 'review' ? ['client_runtime_adoption_receipt_review'] : []),
    ...(readinessPreview.warnings ?? []).map((warning) => `readiness_${warning}`),
    ...(exportContinuity.changedSinceExternalLedger ? ['export_continuity_changed_since_external_ledger'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : externalStatusHandoff.state === 'held' || readinessPreview.state === 'held'
      ? 'held'
      : externalStatusHandoff.state === 'scheduled' || readinessPreview.state === 'scheduled'
        ? 'scheduled'
        : writeRequired
          ? warnings.length
            ? 'review'
            : 'ready'
          : 'not_required';
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    externalDigest: externalStatusHandoff.digest ?? null,
    operationalRetryDigest: operationalRetry.digest ?? null,
    operationalRetryState: operationalRetry.state ?? 'unknown',
    providerHandoffHealthDigest: write.providerHandoffHealth?.digest ?? null,
    providerHandoffHealthState: write.providerHandoffHealth?.state ?? 'unknown',
    boundaryDecisionReceiptDigest: write.boundaryDecisionReceipt?.receiptDigest ?? null,
    boundaryReleaseGateDigest: write.boundaryReleaseGate?.gateDigest ?? null,
    restartDigest: restartRecovery.digest ?? null,
    persistedClientDigest: persistedClientState.digest ?? null,
    clientAdoptionDigest: persistedClientState.clientRuntimeAdoption?.digest ?? null,
    clientAdoptionReceiptDigest: persistedClientState.clientRuntimeAdoptionReceipt?.digest ?? null,
    acceptanceDigest: acceptanceHandoff.digest ?? null,
    exportDigest: exportContinuity.digest ?? null,
    readinessDigest: readinessPreview.digest ?? null,
    commandId: replay.commandId ?? provider.commandId ?? write.commandId ?? null,
    restartToken: restartRecovery.restartToken ?? continuation.restartToken ?? null,
    snapshotDigest: exportReport?.history?.latest?.digest ?? null
  };
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.status-handoff`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    externalDigest: externalStatusHandoff.digest ?? null,
    operationalRetry: {
      state: operationalRetry.state ?? 'unknown',
      ready: operationalRetry.ready === true || !writeRequired,
      digest: operationalRetry.digest ?? null,
      retryScheduled: operationalRetry.retryScheduled === true,
      retryAfterMs: operationalRetry.retryAfterMs ?? null,
      attempt: operationalRetry.attempt ?? 0,
      maxAttempts: operationalRetry.maxAttempts ?? 0,
      exhausted: operationalRetry.exhausted === true,
      degradedMode: operationalRetry.degradedMode ?? null,
      nextRetryCommand: operationalRetry.nextRetryCommand ?? null,
      nextAction: operationalRetry.nextAction ?? null
    },
    providerHandoffHealth: {
      state: write.providerHandoffHealth?.state ?? 'unknown',
      ready: write.providerHandoffHealth?.ready === true || !writeRequired,
      degraded: write.providerHandoffHealth?.degraded === true,
      retryable: write.providerHandoffHealth?.retryable === true,
      terminal: write.providerHandoffHealth?.terminal === true,
      digest: write.providerHandoffHealth?.digest ?? null,
      receiptDigest: write.providerHandoffHealth?.receipt?.digest ?? null,
      retryAfterMs: write.providerHandoffHealth?.retryWindow?.retryAfterMs ?? null,
      failedDependencyCount: write.providerHandoffHealth?.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0,
      nextAction: write.providerHandoffHealth?.nextAction ?? null
    },
    boundaryDecisionReceiptDigest: write.boundaryDecisionReceipt?.receiptDigest ?? null,
    boundaryReleaseGateDigest: write.boundaryReleaseGate?.gateDigest ?? null,
    recoveryDigest: stableHash(digestShape),
    statusChannel: handoff.statusChannel ?? externalStatusHandoff.statusChannel ?? null,
    commandId: replay.commandId ?? provider.commandId ?? write.commandId ?? null,
    idempotencyKey: handoff.idempotencyKey ?? externalStatusHandoff.idempotencyKey ?? write.idempotencyKey ?? null,
    restartToken: restartRecovery.restartToken ?? externalStatusHandoff.restartToken ?? continuation.restartToken ?? null,
    snapshotDigest: exportReport?.history?.latest?.digest ?? null,
    persistedClientDigest: persistedClientState.digest ?? null,
    clientAdoptionDigest: persistedClientState.clientRuntimeAdoption?.digest ?? null,
    clientAdoptionReceiptDigest: persistedClientState.clientRuntimeAdoptionReceipt?.digest ?? null,
    exportContinuityDigest: exportContinuity.digest ?? null,
    checkpoints,
    userVisibleStatus: {
      current: readinessPreview.userVisibleStatus?.current ?? readinessPreview.userVisibleStatus ?? persistedClientState.userVisibleStatus?.current ?? externalStatusHandoff.userVisibleStatus?.current ?? recoveryStatusHandoffUserStatus(state),
      completion: persistedClientState.userVisibleStatus?.completion ?? externalStatusHandoff.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: persistedClientState.userVisibleStatus?.failure ?? externalStatusHandoff.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? recoveryStatusHandoffAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? recoveryPreviewWarningAction(warnings[0])
            : writeRequired
              ? 'publish_recovery_status_handoff'
              : 'continue_read_only',
    digest: stableHash({
      ...digestShape,
      blockers,
      warnings
    })
  };
}

function validateRecoveryStatusHandoff(statusHandoff, write) {
  if (!write?.writeRequired && !statusHandoff) return [];
  const diagnostics = [];
  if (!statusHandoff) return [{ level: 'error', code: 'recovery_missing_status_handoff' }];
  if (write?.writeRequired && statusHandoff.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_not_write_required' });
  }
  if (statusHandoff.ready && statusHandoff.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_ready_with_blockers', blockers: statusHandoff.blockers });
  }
  if (statusHandoff.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_blocked', blockers: statusHandoff.blockers ?? [] });
  }
  if (write?.writeRequired && !statusHandoff.externalDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_missing_external_digest' });
  }
  if (write?.writeRequired && !statusHandoff.operationalRetry?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_missing_operational_retry_digest' });
  }
  if (statusHandoff.operationalRetry?.retryScheduled && !statusHandoff.operationalRetry?.retryAfterMs) {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_operational_retry_missing_backoff' });
  }
  if (statusHandoff.operationalRetry?.state === 'terminal') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_status_handoff_operational_retry_terminal',
      nextAction: statusHandoff.operationalRetry.nextAction ?? 'repair_external_write_before_replay'
    });
  }
  if (write?.writeRequired && !statusHandoff.boundaryDecisionReceiptDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_missing_boundary_decision_receipt_digest' });
  }
  if (write?.writeRequired && !statusHandoff.boundaryReleaseGateDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_missing_boundary_release_gate_digest' });
  }
  if (write?.writeRequired && !statusHandoff.commandId) {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_missing_command_id' });
  }
  if (write?.writeRequired && !statusHandoff.statusChannel) {
    diagnostics.push({ level: 'error', code: 'recovery_status_handoff_missing_status_channel' });
  }
  if (statusHandoff.state === 'review' || statusHandoff.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'recovery_status_handoff_review', warnings: statusHandoff.warnings ?? [] });
  }
  return diagnostics;
}

function normalizeRetry(input = {}) {
  const maxAttempts = Number(input?.maxAttempts ?? 3);
  const initialDelayMs = Number(input?.initialDelayMs ?? 1000);
  const maxDelayMs = Number(input?.maxDelayMs ?? 30000);
  return {
    strategy: input?.strategy ?? 'exponential_backoff',
    maxAttempts: Number.isFinite(maxAttempts) ? Math.max(0, maxAttempts) : 3,
    initialDelayMs: Number.isFinite(initialDelayMs) ? Math.max(100, initialDelayMs) : 1000,
    maxDelayMs: Number.isFinite(maxDelayMs) ? Math.max(1000, maxDelayMs) : 30000,
    retryableStatuses: [...new Set(input?.retryableStatuses ?? ['queued', 'runtime_unavailable'])].sort()
  };
}

function normalizeRollback(input = {}) {
  const required = input.required !== false;
  return {
    required,
    action: input.action ?? (required ? 'discard_local_plan' : null),
    failureStatus: input.failureStatus ?? 'needs_operator_review',
    localOnly: ['discard_local_plan', 'release_checkpoint', null].includes(input.action ?? 'discard_local_plan')
  };
}

function normalizeContinuation(input = {}) {
  const events = asArray(input?.events).map((event, index) => ({
    index,
    op: event.op ?? event.action ?? 'event',
    status: event.stateStatus ?? event.status ?? 'unknown',
    generation: Number(event.generation ?? input?.generation ?? 0),
    id: event.id ?? null
  }));
  return {
    status: input?.status ?? 'queued',
    generation: Number(input?.generation ?? 0),
    restartToken: input?.restartToken ?? null,
    resumeAction: input?.resumeAction ?? 'resume_after_kernel_ack',
    checkpointHash: input?.checkpointHash ?? stableHash(input?.checkpoint ?? {}),
    events
  };
}

function normalizeHandoff(kernelCall) {
  return {
    idempotencyKey: kernelCall?.handoff?.idempotencyKey ?? null,
    statusChannel: kernelCall?.handoff?.statusChannel ?? 'kernel.status.mailchimp',
    target: kernelCall?.handoff?.target ?? 'mailchimp.client.workflow',
    continuationMode: kernelCall?.handoff?.continuationMode ?? 'resume_after_kernel_ack',
    requiresResume: (kernelCall?.handoff?.continuationMode ?? 'resume_after_kernel_ack') !== 'none',
    exportReady: kernelCall?.analytics?.exportReady === true
  };
}

function normalizeExternalWrite(report = {}) {
  const clientRuntimeHandoff = report?.clientRuntimeHandoff
    ? stableClone(report.clientRuntimeHandoff)
    : null;
  const clientRequestSnapshot = report?.clientRequestSnapshot
    ? stableClone(report.clientRequestSnapshot)
    : null;
  const clientRuntimeAdoption = report?.clientRuntimeAdoption
    ? stableClone(report.clientRuntimeAdoption)
    : null;
  const clientRuntimeAdoptionReceipt = report?.clientRuntimeAdoptionReceipt
    ? stableClone(report.clientRuntimeAdoptionReceipt)
    : null;
  const clientWorkflowStatusCapsule = report?.clientWorkflowStatusCapsule
    ? stableClone(report.clientWorkflowStatusCapsule)
    : null;
  const operatorLifecycleAction = clientWorkflowStatusCapsule?.operatorLifecycleAction
    ?? report?.operatorLifecycleAction
    ?? report?.kernelOperatorLifecycleAction
    ?? null;
  return {
    status: report?.status ?? 'unknown',
    writeRequired: report?.writeRequired === true,
    nextAction: report?.nextAction ?? null,
    idempotencyKey: report?.idempotency?.key ?? null,
    commandId: report?.providerCommand?.commandId ?? null,
    commandState: report?.providerCommand?.state ?? null,
    syncReady: report?.sync?.ready === true,
    replaySafe: report?.providerCommandLedger?.replayable === true || report?.providerCommand?.replay?.safeToReplay === true,
    blockedReasons: report?.blockedReasons ?? [],
    dispatchStatus: report?.dispatch?.status ?? 'unknown',
    clientRuntimeHandoff,
    clientRequestSnapshot,
    clientRuntimeAdoption,
    clientRuntimeAdoptionReceipt,
    clientWorkflowStatusCapsule,
    operatorLifecycleAction: operatorLifecycleAction ? stableClone(operatorLifecycleAction) : null,
    clientRequestDigest: report?.clientRequestSnapshot?.digest ?? null,
    clientRequestKey: report?.clientRequestSnapshot?.requestKey ?? null,
    clientRuntimeAdoptionReceiptDigest: report?.clientRuntimeAdoptionReceipt?.digest ?? null,
    clientRuntimeAdoptionReceiptKey: report?.clientRuntimeAdoptionReceipt?.receiptKey ?? null,
    clientWorkflowStatusDigest: clientWorkflowStatusCapsule?.digest ?? null,
    clientWorkflowStatusResumePointer: clientWorkflowStatusCapsule?.resumePointer ?? null,
    operatorLifecycleActionDigest: operatorLifecycleAction?.digest ?? null,
    lifecycleGate: {
      state: report?.lifecycleGate?.state ?? 'unknown',
      ready: report?.lifecycleGate?.ready !== false,
      blockers: report?.lifecycleGate?.blockers ?? [],
      warnings: report?.lifecycleGate?.warnings ?? []
    },
    lifecycleControls: report?.lifecycleControls
      ? stableClone(report.lifecycleControls)
      : {
          state: 'unknown',
          ready: false,
          effectiveEnabled: false,
          selectedControl: null,
          userVisibleStatus: null,
          blockers: [],
          warnings: [],
          commands: [],
          nextAction: null,
          digest: null
        },
    acceptancePacket: report?.acceptancePacket
      ? stableClone(report.acceptancePacket)
      : {
          readinessState: 'unknown',
          acceptanceState: 'unknown',
          acceptEnabled: false,
          nextAction: null,
          blockers: [],
          warnings: [],
          missingAcknowledgements: []
        },
    acceptancePreview: report?.acceptancePreview
      ? stableClone(report.acceptancePreview)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          renderable: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          presentationMode: report?.writeRequired ? 'repair' : 'status',
          primaryAction: report?.writeRequired ? 'prepare_external_write_acceptance_preview' : 'continue_read_only',
          command: {
            commandId: report?.providerCommand?.commandId ?? null,
            idempotencyKey: report?.idempotency?.key ?? null,
            statusChannel: report?.route?.statusChannel ?? null,
            statusAfterReplay: report?.writeRequired ? 'unknown' : 'not_required'
          },
          userVisibleStatus: {
            current: report?.writeRequired ? 'external_write_preview_pending' : 'read_only_ready',
            completion: 'mailchimp_write_synced',
            failure: 'mailchimp_write_needs_review'
          },
          validationSummary: {
            ok: !report?.writeRequired,
            errorCount: report?.writeRequired ? 1 : 0,
            warningCount: 0,
            restartSafe: !report?.writeRequired,
            releaseAllowed: !report?.writeRequired
          },
          checkpoint: {
            digest: report?.acceptanceCheckpointBundle?.digest ?? null,
            restartSafe: report?.acceptanceCheckpointBundle?.restartSafe === true || !report?.writeRequired
          },
          nextSteps: report?.writeRequired
            ? [{ index: 0, phase: 'acceptance_preview', action: 'prepare_external_write_acceptance_preview', reason: 'missing_acceptance_preview', terminal: false }]
            : [{ index: 0, phase: 'read_only', action: 'continue_read_only', reason: 'external_write_not_requested', terminal: true }],
          blockers: report?.writeRequired ? ['missing_external_write_acceptance_preview'] : [],
          warnings: [],
          digest: null
        },
    persistedStatus: report?.persistedStatus ? stableClone(report.persistedStatus) : null,
    persistedStatusDigest: report?.persistedStatus?.digest ?? null,
    persistedStatusState: report?.persistedStatus?.state ?? 'unknown',
    persistedCommandDigest: report?.persistedStatus?.commandDigest ?? report?.providerCommand?.replay?.commandDigest ?? null,
    statusJournal: report?.statusJournal ? stableClone(report.statusJournal) : null,
    statusJournalDigest: report?.statusJournal?.digest ?? null,
    statusJournalState: report?.statusJournal?.state ?? 'unknown',
    statusJournalRestartPolicy: report?.statusJournal?.restartSemantics?.onRestart ?? null,
    statusJournalCommandCount: report?.statusJournal?.commands?.length ?? 0,
    providerCommandLedger: report?.providerCommandLedger
      ? stableClone(report.providerCommandLedger)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          ledgerKey: null,
          activeCommandId: report?.providerCommand?.commandId ?? null,
          activeCommandDigest: report?.providerCommand?.replay?.commandDigest ?? null,
          replayMode: report?.writeRequired ? 'unknown' : 'continue_read_only',
          restartPolicy: report?.writeRequired ? null : 'continue_read_only',
          duplicateSafe: !report?.writeRequired,
          replayable: false,
          entries: [],
          commands: [],
          blockers: report?.writeRequired ? ['missing_provider_command_ledger'] : [],
          warnings: [],
          digest: null
        },
    providerCommandLedgerDigest: report?.providerCommandLedger?.digest ?? null,
    providerCommandLedgerState: report?.providerCommandLedger?.state ?? 'unknown',
    providerCommandLedgerReplayMode: report?.providerCommandLedger?.replayMode ?? null,
    providerCommandLedgerEntryCount: report?.providerCommandLedger?.entries?.length ?? 0,
    persistenceEnvelope: report?.persistenceEnvelope
      ? stableClone(report.persistenceEnvelope)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          envelopeKey: null,
          resumePointer: null,
          manifestDigest: null,
          restartSemantics: {
            restartSafe: !report?.writeRequired,
            onRestart: report?.writeRequired ? 'wait_for_persistence_envelope' : 'continue_read_only',
            onDuplicateCommand: 'return_existing_persistence_envelope',
            onStaleSnapshot: 'rebuild_envelope_from_status_journal_and_command_ledger'
          },
          recoveryHints: [],
          blockers: report?.writeRequired ? ['missing_persistence_envelope'] : [],
          warnings: [],
          digest: null
        },
    persistenceEnvelopeDigest: report?.persistenceEnvelope?.digest ?? null,
    persistenceEnvelopeState: report?.persistenceEnvelope?.state ?? 'unknown',
    persistenceEnvelopeResumePointer: report?.persistenceEnvelope?.resumePointer ?? null,
    persistenceEnvelopeManifestDigest: report?.persistenceEnvelope?.manifestDigest ?? null,
    persistenceEnvelopeRestartSafe: report?.persistenceEnvelope?.restartSemantics?.restartSafe === true || !report?.writeRequired,
    stateIntegrityManifest: report?.stateIntegrityManifest
      ? stableClone(report.stateIntegrityManifest)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          manifestKey: null,
          manifestDigest: null,
          digest: null,
          commandId: report?.providerCommand?.commandId ?? null,
          idempotencyKey: report?.idempotency?.key ?? null,
          statusChannel: report?.route?.statusChannel ?? null,
          restartToken: report?.persistedStatus?.restartToken ?? null,
          aligned: !report?.writeRequired,
          restartSafe: !report?.writeRequired,
          digestVector: {},
          checkpoints: [],
          mismatches: [],
          blockers: report?.writeRequired ? ['missing_state_integrity_manifest'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'persist_external_write_state_integrity_manifest' : 'continue_read_only'
        },
    stateIntegrityDigest: report?.stateIntegrityManifest?.digest ?? null,
    stateIntegrityManifestDigest: report?.stateIntegrityManifest?.manifestDigest ?? null,
    stateIntegrityState: report?.stateIntegrityManifest?.state ?? 'unknown',
    stateIntegrityAligned: report?.stateIntegrityManifest?.aligned === true || !report?.writeRequired,
    stateIntegrityRestartSafe: report?.stateIntegrityManifest?.restartSafe === true || !report?.writeRequired,
    statusHandoff: report?.statusHandoff
      ? stableClone(report.statusHandoff)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          digest: null,
          commandId: report?.providerCommand?.commandId ?? null,
          statusChannel: report?.route?.statusChannel ?? null,
          restartToken: report?.persistedStatus?.restartToken ?? null,
          checkpoints: [],
          blockers: report?.writeRequired ? ['missing_external_write_status_handoff'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'publish_external_write_status_handoff' : 'continue_read_only'
        },
    statusHandoffDigest: report?.statusHandoff?.digest ?? null,
    operationalRetry: report?.statusHandoff?.operationalRetry
      ? stableClone(report.statusHandoff.operationalRetry)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          retryScheduled: false,
          retryAfterMs: null,
          attempt: 0,
          maxAttempts: 0,
          exhausted: false,
          degradedMode: null,
          providerStatus: report?.providerHealth?.status ?? 'unknown',
          lifecycleState: report?.lifecycleGate?.state ?? 'unknown',
          incidentDigest: report?.operationalIncident?.digest ?? null,
          healthDigest: report?.operationalHealth?.digest ?? null,
          nextRetryCommand: null,
          blockers: report?.writeRequired ? ['missing_external_write_operational_retry'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'publish_operational_retry_envelope' : 'continue_read_only',
          digest: null
        },
    operationalRetryDigest: report?.statusHandoff?.operationalRetry?.digest ?? null,
    providerHandoffHealth: report?.providerHandoffHealth
      ? stableClone(report.providerHandoffHealth)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          degraded: false,
          retryable: false,
          terminal: false,
          statusChannel: report?.route?.statusChannel ?? null,
          commandId: report?.providerCommand?.commandId ?? null,
          idempotencyKey: report?.idempotency?.key ?? null,
          externalStateKey: report?.providerServiceContract?.sync?.externalStateKey ?? null,
          providerStatus: report?.providerHealth?.status ?? 'unknown',
          receipt: {
            state: report?.providerServiceContract?.handoffReceipt?.state ?? report?.providerServiceContract?.sync?.handoffReceipt?.state ?? 'unknown',
            ready: report?.providerServiceContract?.handoffReceipt?.ready ?? report?.providerServiceContract?.sync?.handoffReceipt?.ready ?? false,
            acknowledged: report?.providerServiceContract?.handoffReceipt?.acknowledged ?? report?.providerServiceContract?.sync?.handoffReceipt?.acknowledged ?? false,
            fresh: report?.providerServiceContract?.handoffReceipt?.fresh ?? report?.providerServiceContract?.sync?.handoffReceipt?.fresh ?? false,
            digest: report?.providerServiceContract?.handoffReceipt?.digest ?? report?.providerServiceContract?.sync?.handoffReceipt?.digest ?? null,
            nextAction: report?.providerServiceContract?.handoffReceipt?.nextAction ?? report?.providerServiceContract?.sync?.handoffReceipt?.nextAction ?? null
          },
          retryWindow: {
            scheduled: false,
            retryAfterMs: null,
            attempt: 0,
            maxAttempts: 0,
            exhausted: false
          },
          dependencies: [],
          blockers: report?.writeRequired ? ['missing_provider_handoff_health'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'publish_provider_handoff_health' : 'continue_read_only',
          digest: null
        },
    providerHandoffHealthDigest: report?.providerHandoffHealth?.digest ?? null,
    resumeCursor: report?.resumeCursor
      ? stableClone(report.resumeCursor)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          cursorKey: null,
          commandId: report?.providerCommand?.commandId ?? null,
          idempotencyKey: report?.idempotency?.key ?? null,
          statusChannel: report?.route?.statusChannel ?? null,
          restartToken: report?.persistedStatus?.restartToken ?? null,
          resumePointer: null,
          digestVector: {},
          restartSemantics: {
            restartSafe: !report?.writeRequired,
            onRestart: report?.writeRequired ? 'wait_for_external_write_resume_cursor' : 'continue_read_only',
            onDuplicateCommand: 'return_existing_provider_command',
            onStaleSnapshot: 'rebuild_external_write_resume_cursor'
          },
          checkpoints: [],
          blockers: report?.writeRequired ? ['missing_external_write_resume_cursor'] : [],
          warnings: [],
          digest: null
        },
    resumeCursorDigest: report?.resumeCursor?.digest ?? null,
    operatorHandoffManifest: report?.operatorHandoffManifest
      ? stableClone(report.operatorHandoffManifest)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          presentationMode: report?.writeRequired ? 'repair' : 'status',
          primaryAction: report?.writeRequired ? 'publish_operator_handoff_manifest' : 'continue_read_only',
          manifestKey: null,
          statusChannel: report?.route?.statusChannel ?? null,
          command: {
            commandId: null,
            idempotencyKey: null,
            statusAfterReplay: report?.writeRequired ? 'unknown' : 'not_required'
          },
          runtime: {
            idempotencyKey: report?.idempotency?.key ?? null,
            providerCommandId: report?.providerCommand?.commandId ?? null,
            restartToken: report?.persistedStatus?.restartToken ?? null,
            statusHandoffDigest: report?.statusHandoff?.digest ?? null,
            routeExportDigest: report?.routeExportState?.digest ?? null
          },
          steps: [],
          validationSummary: {
            readyStepCount: report?.writeRequired ? 0 : 1,
            totalStepCount: report?.writeRequired ? 0 : 1,
            failedSteps: report?.writeRequired ? ['operator_handoff_manifest'] : [],
            reviewSteps: [],
            firstPendingStep: report?.writeRequired ? 'operator_handoff_manifest' : null,
            blockers: report?.writeRequired ? ['missing_operator_handoff_manifest'] : [],
            warnings: []
          },
          restartSemantics: {
            restartSafe: !report?.writeRequired,
            onRestart: report?.writeRequired ? 'resume_external_write_status_handoff' : 'continue_read_only',
            onDuplicateCommand: 'return_existing_operator_handoff_manifest',
            onStaleSnapshot: 'rebuild_operator_handoff_manifest'
          },
          blockers: report?.writeRequired ? ['missing_operator_handoff_manifest'] : [],
          warnings: [],
          digest: null
        },
    operatorHandoffDigest: report?.operatorHandoffManifest?.digest ?? null,
    exportLedger: report?.exportLedger ? stableClone(report.exportLedger) : null,
    exportLedgerDigest: report?.exportLedger?.digest ?? null,
    exportLedgerState: report?.exportLedger?.state ?? 'unknown',
    operatorReadiness: report?.operatorReadiness
      ? stableClone(report.operatorReadiness)
      : {
          state: 'unknown',
          ready: false,
          userVisibleStatus: null,
          primaryAction: null,
          blockers: [],
          warnings: [],
          nextSteps: []
        },
    analyticsActionCard: report?.analyticsExport?.operatorActionCard
      ? stableClone(report.analyticsExport.operatorActionCard)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          primaryAction: report?.writeRequired ? 'confirm_external_write_handoff' : 'continue_read_only',
          secondaryActions: [],
          commandId: report?.providerCommand?.commandId ?? null,
          idempotencyKey: report?.idempotency?.key ?? null,
          statusChannel: report?.route?.statusChannel ?? null,
          digest: null,
          blockers: report?.writeRequired ? ['missing_external_write_operator_action_card'] : [],
          warnings: []
        },
    operatorDecision: report?.operatorDecision ?? report?.analyticsExport?.operatorDecision
      ? stableClone(report.operatorDecision ?? report.analyticsExport.operatorDecision)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          presentationMode: report?.writeRequired ? 'repair' : 'status',
          primaryCommand: report?.writeRequired ? 'publish_external_write_operator_decision' : 'continue_read_only',
          command: {
            type: 'mailchimp.external_write.operator_decision',
            commandId: null,
            idempotencyKey: null,
            statusAfterReplay: report?.writeRequired ? 'unknown' : 'not_required',
            conflict: 'return-existing',
            requiredInputs: []
          },
          acknowledgement: {
            required: report?.writeRequired === true,
            token: null,
            requiredAcknowledgements: report?.writeRequired ? ['external_write_preview'] : [],
            missingAcknowledgements: report?.writeRequired ? ['external_write_preview'] : [],
            reason: report?.writeRequired ? 'missing_external_write_operator_decision' : null
          },
          status: {
            current: report?.writeRequired ? 'external_write_waiting_for_confirmation' : 'read_only_ready',
            completion: 'mailchimp_write_synced',
            failure: 'mailchimp_write_needs_review'
          },
          decisionInputs: {},
          evidence: {},
          validationSummary: {
            ok: !report?.writeRequired,
            errorCount: report?.writeRequired ? 1 : 0,
            warningCount: 0,
            missingAcknowledgementCount: report?.writeRequired ? 1 : 0
          },
          blockers: report?.writeRequired ? ['missing_external_write_operator_decision'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'publish_external_write_operator_decision' : 'continue_read_only',
          digest: null
        },
    operatorDecisionSource: report?.operatorDecision
      ? 'external_write_root'
      : report?.analyticsExport?.operatorDecision
        ? 'analytics_export'
        : 'synthesized_missing_contract',
    operationalIncident: report?.operationalIncident
      ? stableClone(report.operationalIncident)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          severity: 'none',
          open: false,
          retryable: false,
          terminal: false,
          writeRequired: report?.writeRequired === true,
          owner: 'none',
          retryWindow: {
            scheduled: false,
            attempt: 0,
            maxAttempts: 0,
            retryAfterMs: null,
            policy: 'none',
            exhausted: false
          },
          degradedMode: null,
          failedDependencies: [],
          evidence: [],
          blockers: report?.writeRequired ? ['missing_external_write_operational_incident'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'publish_external_write_operational_incident' : 'continue_read_only',
          digest: null
        },
    recoveryRunbook: report?.recoveryRunbook
      ? stableClone(report.recoveryRunbook)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          mode: report?.writeRequired ? 'missing_runbook' : 'not_required',
          writeRequired: report?.writeRequired === true,
          primaryCommandId: report?.providerCommand?.commandId ?? null,
          retryAfterMs: report?.operationalIncident?.retryWindow?.retryAfterMs ?? null,
          restartToken: report?.persistedStatus?.restartToken ?? null,
          steps: [],
          blockers: report?.writeRequired ? ['missing_external_write_recovery_runbook'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'publish_external_write_recovery_runbook' : 'continue_read_only',
          digest: null
        },
    providerHealth: report?.providerHealth
      ? stableClone(report.providerHealth)
      : {
          status: 'unknown',
          ready: false,
          degraded: false,
          retryable: true,
          retryAfterMs: null,
          blockers: [],
          warnings: [],
          nextAction: null
        },
    providerServiceContract: report?.providerServiceContract
      ? stableClone(report.providerServiceContract)
      : {
          state: 'unknown',
          ready: !report?.writeRequired,
          negotiation: { status: 'unknown', accepted: !report?.writeRequired },
          requiredCapabilities: [],
          acceptedCapabilities: [],
          missingCapabilities: [],
          sync: {},
          handoffState: {},
          commands: [],
          blockers: [],
          warnings: []
        },
    boundaryTicket: report?.boundaryTicket
      ? stableClone(report.boundaryTicket)
      : {
          state: 'unknown',
          ready: false,
          auditDigest: null,
          blockers: [],
          warnings: []
        },
    boundaryPermissionPosture: report?.boundaryPermissionPosture
      ? stableClone(report.boundaryPermissionPosture)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          permissionMode: 'unknown',
          role: null,
          effectAccess: {
            required: [],
            allowed: [],
            denied: [],
            deniedRequired: [],
            missingAllowed: []
          },
          scopeVector: {},
          guardVector: {
            ticketReady: !report?.writeRequired,
            auditReady: !report?.writeRequired,
            recoveryGuardReady: !report?.writeRequired,
            recoveryRetryable: !report?.writeRequired,
            replayPolicy: report?.writeRequired ? 'missing_permission_posture' : 'read_only_no_guard'
          },
          auditDigest: report?.boundaryTicket?.auditDigest ?? null,
          postureDigest: null,
          requiredAcknowledgements: report?.writeRequired ? ['external_write'] : [],
          observedAcknowledgements: [],
          missingAcknowledgements: report?.writeRequired ? ['external_write'] : [],
          escalations: [],
          blockers: report?.writeRequired ? ['missing_boundary_permission_posture'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'publish_permission_posture_handoff' : 'continue_read_only'
        },
    boundaryDecisionReceipt: report?.boundaryDecisionReceipt
      ? stableClone(report.boundaryDecisionReceipt)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          decision: report?.writeRequired ? 'unknown' : 'not_required',
          release: {
            allowed: !report?.writeRequired,
            requiresAcknowledgement: false,
            denied: false,
            replayPolicy: report?.writeRequired ? 'missing_boundary_decision_receipt' : 'read_only_no_guard'
          },
          receiptDigest: null,
          evidence: [],
          missingEvidence: report?.writeRequired
            ? ['boundary_ticket', 'boundary_audit', 'boundary_recovery_guard', 'permission_posture']
            : [],
          command: null,
          blockers: report?.writeRequired ? ['missing_boundary_decision_receipt'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'publish_boundary_decision_receipt' : 'continue_read_only'
        },
    boundaryReleaseGate: report?.boundaryReleaseGate
      ? stableClone(report.boundaryReleaseGate)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          writeRequired: report?.writeRequired === true,
          releaseAllowed: !report?.writeRequired,
          scope: {
            tenantId: report?.boundaryDecisionReceipt?.tenantId ?? report?.boundaryTicket?.tenantId ?? null,
            workspaceId: report?.boundaryDecisionReceipt?.workspaceId ?? report?.boundaryTicket?.workspaceId ?? null,
            isolationKey: report?.boundaryDecisionReceipt?.isolationKey ?? report?.boundaryTicket?.isolationKey ?? null,
            role: report?.boundaryDecisionReceipt?.role ?? report?.boundaryTicket?.role ?? null
          },
          replayPolicy: report?.writeRequired ? 'missing_boundary_release_gate' : 'read_only_no_guard',
          decision: report?.boundaryDecisionReceipt?.decision ?? (report?.writeRequired ? 'unknown' : 'not_required'),
          decisionReceiptDigest: report?.boundaryDecisionReceipt?.receiptDigest ?? null,
          postureDigest: report?.boundaryPermissionPosture?.postureDigest ?? null,
          auditDigest: report?.boundaryTicket?.auditDigest ?? null,
          guardDigest: report?.boundaryRecoveryGuard?.guardDigest ?? null,
          evidence: [],
          missingEvidence: report?.writeRequired ? ['boundary_release_gate'] : [],
          requiredAcknowledgements: report?.writeRequired ? ['external_write'] : [],
          observedAcknowledgements: [],
          missingAcknowledgements: report?.writeRequired ? ['external_write'] : [],
          command: null,
          restartSemantics: {
            restartSafe: !report?.writeRequired,
            onRestart: report?.writeRequired ? 'reload_boundary_release_gate_before_provider_replay' : 'continue_read_only',
            onDuplicateCommand: 'return_existing_boundary_release_gate',
            onScopeMutation: 'invalidate_boundary_release_gate',
            onPermissionMutation: 'invalidate_boundary_release_gate'
          },
          blockers: report?.writeRequired ? ['missing_boundary_release_gate'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'open_boundary_release_gate' : 'continue_read_only',
          gateDigest: null
        },
    boundaryRecoveryGuard: report?.boundaryRecoveryGuard
      ? stableClone(report.boundaryRecoveryGuard)
      : {
          state: report?.writeRequired ? 'unknown' : 'not_required',
          ready: !report?.writeRequired,
          retryable: !report?.writeRequired,
          guardDigest: null,
          replayPolicy: report?.writeRequired ? 'missing_boundary_guard' : 'read_only_no_guard',
          commands: [],
          blockers: report?.writeRequired ? ['missing_boundary_recovery_guard'] : [],
          warnings: [],
          nextAction: report?.writeRequired ? 'persist_boundary_recovery_guard' : 'continue_read_only'
        }
  };
}

function validateRollback(rollback, write) {
  const diagnostics = [];
  if (rollback.required && !rollback.action) {
    diagnostics.push({ level: 'error', code: 'recovery_missing_rollback_action' });
  }
  if (write.writeRequired && !rollback.required) {
    diagnostics.push({ level: 'error', code: 'recovery_write_requires_rollback' });
  }
  if (write.writeRequired && rollback.localOnly) {
    diagnostics.push({ level: 'warning', code: 'recovery_write_rollback_is_local_only', action: rollback.action });
  }
  return diagnostics;
}

function validateRetry(retry) {
  const diagnostics = [];
  if (retry.maxAttempts < 1) diagnostics.push({ level: 'error', code: 'recovery_invalid_retry_policy' });
  if (retry.initialDelayMs > retry.maxDelayMs) {
    diagnostics.push({ level: 'error', code: 'recovery_retry_delay_window_invalid' });
  }
  return diagnostics;
}

function validateContinuation(continuation, handoff) {
  const diagnostics = [];
  if (handoff.requiresResume && !continuation.restartToken) {
    diagnostics.push({ level: 'warning', code: 'recovery_missing_restart_token' });
  }
  if (!handoff.idempotencyKey) {
    diagnostics.push({ level: 'error', code: 'recovery_missing_handoff_idempotency_key' });
  }
  return diagnostics;
}

function validateWriteRecovery(write, rollback) {
  if (write.status !== 'blocked') return [];
  return [{
    level: 'error',
    code: 'recovery_external_write_blocked',
    blockedReasons: write.blockedReasons,
    rollbackAction: rollback.action
  }];
}

function validateProviderRecovery(provider, write) {
  const diagnostics = [];
  if (provider.status === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_provider_contract_blocked',
      blockers: provider.blockers
    });
  }
  if (write.writeRequired && provider.statusChannel == null) {
    diagnostics.push({ level: 'error', code: 'recovery_provider_missing_status_channel' });
  }
  if (write.writeRequired && provider.idempotencyKey == null) {
    diagnostics.push({ level: 'error', code: 'recovery_provider_missing_idempotency_key' });
  }
  if (write.writeRequired && provider.commandId == null) {
    diagnostics.push({ level: 'error', code: 'recovery_provider_missing_command_id' });
  }
  if (provider.status === 'deferred') {
    diagnostics.push({ level: 'warning', code: 'recovery_provider_handoff_deferred', reason: provider.deferReason });
  }
  if (write.writeRequired && provider.health?.ready === false && provider.health?.retryable === false) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_provider_health_not_retryable',
      blockers: provider.health.blockers ?? []
    });
  }
  if (provider.health?.degraded) {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_provider_health_degraded',
      retryAfterMs: provider.health.retryAfterMs ?? null
    });
  }
  if (write.writeRequired && provider.lifecycleControl?.ready === false && provider.lifecycleControl?.state !== 'disabled') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_provider_lifecycle_control_blocked',
      blockers: provider.lifecycleControl.blockers ?? []
    });
  }
  if (write.writeRequired && provider.serviceContract?.ready === false) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_provider_service_contract_blocked',
      blockers: provider.serviceContract.missingCapabilities ?? provider.serviceContract.blockers ?? []
    });
  }
  if (write.writeRequired && provider.serviceContract?.providerSession?.ready === false) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_provider_session_blocked',
      blockers: provider.serviceContract.providerSession.blockers ?? []
    });
  }
  if (provider.serviceContract?.providerSession?.renewalRequired) {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_provider_session_renewal_required',
      missingCapabilities: provider.serviceContract.providerSession.missingCapabilities ?? []
    });
  }
  if (write.writeRequired && provider.boundaryRecoveryGuard?.ready === false) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_boundary_guard_blocked',
      blockers: provider.boundaryRecoveryGuard.blockers ?? []
    });
  }
  if (write.writeRequired && provider.boundaryRecoveryGuard?.retryable === false) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_boundary_guard_not_retryable',
      nextAction: provider.boundaryRecoveryGuard.nextAction ?? 'repair_boundary_before_replay'
    });
  }
  return diagnostics;
}

function validateProviderReplay(replay, write) {
  if (!write.writeRequired) return [];
  const diagnostics = [];
  if (!replay.commandId) {
    diagnostics.push({ level: 'error', code: 'recovery_missing_replay_command_id' });
  }
  if (!replay.commandDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_missing_replay_command_digest' });
  }
  if (!replay.commandLedgerDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_missing_provider_command_ledger_digest' });
  }
  if (replay.commandLedgerDuplicateSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_provider_command_ledger_duplicate_unsafe' });
  }
  if (replay.commandLedgerReplayable !== true && replay.state !== 'deferred') {
    diagnostics.push({ level: 'warning', code: 'recovery_provider_command_ledger_not_replayable' });
  }
  if (write.writeRequired && replay.boundaryReleaseGate?.releaseAllowed !== true) {
    diagnostics.push({
      level: replay.boundaryReleaseGate?.state === 'review' ? 'warning' : 'error',
      code: 'recovery_provider_replay_boundary_release_gate_not_open',
      nextAction: replay.boundaryReleaseGate?.nextAction ?? 'open_boundary_release_gate'
    });
  }
  if (write.writeRequired && replay.boundaryReleaseGate?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_provider_replay_boundary_release_gate_not_restart_safe' });
  }
  if (replay.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_provider_replay_blocked', blockers: replay.blockers });
  }
  if (replay.state === 'waiting_for_snapshot') {
    diagnostics.push({ level: 'warning', code: 'recovery_replay_waiting_for_snapshot' });
  }
  return diagnostics;
}

function validateExternalStateRecoveryCapsule(capsule, write) {
  if (!write?.writeRequired && !capsule) return [];
  const diagnostics = [];
  if (!capsule) return [{ level: 'error', code: 'recovery_missing_external_state_recovery_capsule' }];
  if (write?.writeRequired && capsule.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_external_state_recovery_capsule_not_write_required' });
  }
  if (capsule.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_external_state_recovery_capsule_blocked', blockers: capsule.blockers ?? [] });
  }
  if (capsule.ready && capsule.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'recovery_external_state_recovery_capsule_ready_with_blockers', blockers: capsule.blockers });
  }
  if (write?.writeRequired && !capsule.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_external_state_recovery_capsule_missing_digest' });
  }
  if (write?.writeRequired && !capsule.resumePointer) {
    diagnostics.push({ level: 'error', code: 'recovery_external_state_recovery_capsule_missing_resume_pointer' });
  }
  if (write?.writeRequired && !capsule.statusChannel) {
    diagnostics.push({ level: 'error', code: 'recovery_external_state_recovery_capsule_missing_status_channel' });
  }
  if (write?.writeRequired && capsule.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_external_state_recovery_capsule_not_restart_safe' });
  }
  if (write?.writeRequired && capsule.replay?.safeToReplay !== true) {
    diagnostics.push({ level: 'warning', code: 'recovery_external_state_recovery_capsule_not_replay_safe' });
  }
  if (write?.writeRequired && !capsule.commands?.length && ['ready', 'review', 'held', 'scheduled'].includes(capsule.state)) {
    diagnostics.push({ level: 'error', code: 'recovery_external_state_recovery_capsule_missing_command' });
  }
  if ((capsule.state === 'review' || capsule.warnings?.length) && capsule.state !== 'blocked') {
    diagnostics.push({ level: 'warning', code: 'recovery_external_state_recovery_capsule_review', warnings: capsule.warnings ?? [] });
  }
  return diagnostics;
}

function validateKernelHealth(kernelCall) {
  if (!kernelCall?.health?.actionableErrors?.length) return [];
  return kernelCall.health.actionableErrors.map((error) => ({
    level: error.retryable === false ? 'error' : 'warning',
    code: 'recovery_kernel_actionable_error',
    errorCode: error.code,
    retryable: error.retryable
  }));
}

function buildRecoveryTimeline({ kernelCall, continuation, exportReport, write, provider, externalHandoff, replay, restartRecovery, persistedClientState, acceptanceHandoff, exportContinuity }) {
  return [
    {
      phase: 'compiled',
      status: kernelCall?.status ?? 'queued',
      action: 'capture_kernel_call'
    },
    {
      phase: 'write_analysis',
      status: write.status,
      action: write.nextAction ?? 'continue'
    },
    {
      phase: 'recovery_policy',
      status: kernelCall?.health?.status ?? 'unknown',
      action: kernelCall?.recovery?.rollbackAction ?? 'discard_local_plan'
    },
    {
      phase: 'handoff',
      status: continuation.status,
      action: continuation.resumeAction
    },
    {
      phase: 'provider_contract',
      status: provider.status,
      action: provider.nextAction
    },
    {
      phase: 'boundary_recovery_guard',
      status: provider.boundaryRecoveryGuard?.state ?? write.boundaryRecoveryGuard?.state ?? 'unknown',
      action: provider.boundaryRecoveryGuard?.nextAction ?? write.boundaryRecoveryGuard?.nextAction ?? 'continue_boundary_recovery'
    },
    {
      phase: 'boundary_decision_receipt',
      status: provider.boundaryDecisionReceipt?.state ?? write.boundaryDecisionReceipt?.state ?? 'unknown',
      action: provider.boundaryDecisionReceipt?.nextAction ?? write.boundaryDecisionReceipt?.nextAction ?? 'continue_boundary_decision'
    },
    {
      phase: 'boundary_release_gate',
      status: write.boundaryReleaseGate?.state ?? 'unknown',
      action: write.boundaryReleaseGate?.nextAction ?? 'continue_boundary_release_gate'
    },
    {
      phase: 'provider_replay',
      status: replay.state,
      action: replay.nextAction
    },
    {
      phase: 'external_recovery_runbook',
      status: write.recoveryRunbook?.state ?? 'unknown',
      action: write.recoveryRunbook?.nextAction ?? 'publish_external_write_recovery_runbook'
    },
    {
      phase: 'external_handoff',
      status: externalHandoff.state,
      action: externalHandoff.nextAction
    },
    {
      phase: 'restart_recovery',
      status: restartRecovery.state,
      action: restartRecovery.nextAction
    },
    {
      phase: 'persist_client_runtime',
      status: persistedClientState.state,
      action: persistedClientState.nextAction
    },
    {
      phase: 'acceptance_handoff',
      status: acceptanceHandoff.state,
      action: acceptanceHandoff.nextAction
    },
    {
      phase: 'export_continuity',
      status: exportContinuity.state,
      action: exportContinuity.nextAction
    },
    {
      phase: 'export',
      status: exportReport?.analytics?.exportReady === true ? 'ready' : 'not_ready',
      action: exportReport?.analytics?.exportReady === true ? 'publish_status_snapshot' : 'hold_status_snapshot'
    }
  ];
}

function buildRecoveryAnalyticsSummary({
  programId,
  operation,
  status,
  blockedReasons,
  retry,
  rollback,
  continuation,
  handoff,
  write,
  provider,
  sync,
  replay,
  externalHandoff,
  restartRecovery,
  persistedClientState,
  acceptanceHandoff,
  exportContinuity,
  readinessPreview,
  timeline,
  diagnostics,
  exportReport
}) {
  const normalizedTimeline = timeline.map((event, index) => ({
    index,
    phase: event.phase,
    status: event.status ?? 'unknown',
    action: event.action ?? null,
    terminal: ['blocked', 'failed'].includes(event.status),
    degraded: ['degraded', 'review', 'held', 'scheduled', 'waiting'].includes(event.status)
  }));
  const failedPhases = normalizedTimeline.filter((event) => event.terminal);
  const degradedPhases = normalizedTimeline.filter((event) => event.degraded);
  const diagnosticCounts = diagnostics.reduce((counts, diagnostic) => {
    counts[diagnostic.level] = (counts[diagnostic.level] ?? 0) + 1;
    return counts;
  }, {});
  const latestSnapshotDigest = exportReport?.history?.latest?.digest ?? null;
  const historySnapshots = [
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'status', status })}`,
      phase: 'status',
      status,
      digest: stableHash({ status, blockedReasons, retry, rollback })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'provider', providerStatus: provider.status })}`,
      phase: 'provider',
      status: provider.status,
      digest: stableHash({
        commandId: provider.commandId,
        statusChannel: provider.statusChannel,
        health: provider.health,
        replayState: replay.state
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'operational_retry', retryDigest: write.operationalRetry?.digest })}`,
      phase: 'operational_retry',
      status: write.operationalRetry?.state ?? 'unknown',
      digest: stableHash({
        retryDigest: write.operationalRetry?.digest ?? null,
        retryScheduled: write.operationalRetry?.retryScheduled === true,
        retryAfterMs: write.operationalRetry?.retryAfterMs ?? null,
        attempt: write.operationalRetry?.attempt ?? 0,
        exhausted: write.operationalRetry?.exhausted === true
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'provider_handoff_health', digest: write.providerHandoffHealth?.digest })}`,
      phase: 'provider_handoff_health',
      status: write.providerHandoffHealth?.state ?? 'unknown',
      digest: stableHash({
        digest: write.providerHandoffHealth?.digest ?? null,
        ready: write.providerHandoffHealth?.ready === true,
        degraded: write.providerHandoffHealth?.degraded === true,
        retryable: write.providerHandoffHealth?.retryable === true,
        terminal: write.providerHandoffHealth?.terminal === true,
        failedDependencyCount: write.providerHandoffHealth?.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0,
        receiptDigest: write.providerHandoffHealth?.receipt?.digest ?? null
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'incident', incidentDigest: write.operationalIncident?.digest })}`,
      phase: 'operational_incident',
      status: write.operationalIncident?.state ?? 'unknown',
      digest: stableHash({
        incidentDigest: write.operationalIncident?.digest ?? null,
        severity: write.operationalIncident?.severity ?? 'none',
        retryWindow: write.operationalIncident?.retryWindow ?? null,
        owner: write.operationalIncident?.owner ?? null
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'runbook', runbookDigest: write.recoveryRunbook?.digest })}`,
      phase: 'recovery_runbook',
      status: write.recoveryRunbook?.state ?? 'unknown',
      digest: stableHash({
        runbookDigest: write.recoveryRunbook?.digest ?? null,
        mode: write.recoveryRunbook?.mode ?? null,
        stepCount: write.recoveryRunbook?.steps?.length ?? 0,
        primaryCommandId: write.recoveryRunbook?.primaryCommandId ?? null
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'boundary_decision', receiptDigest: write.boundaryDecisionReceipt?.receiptDigest })}`,
      phase: 'boundary_decision',
      status: write.boundaryDecisionReceipt?.state ?? 'unknown',
      digest: stableHash({
        receiptDigest: write.boundaryDecisionReceipt?.receiptDigest ?? null,
        decision: write.boundaryDecisionReceipt?.decision ?? 'unknown',
        releaseAllowed: write.boundaryDecisionReceipt?.release?.allowed === true,
        evidenceCount: write.boundaryDecisionReceipt?.evidence?.length ?? 0
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'boundary_release_gate', gateDigest: write.boundaryReleaseGate?.gateDigest })}`,
      phase: 'boundary_release_gate',
      status: write.boundaryReleaseGate?.state ?? 'unknown',
      digest: stableHash({
        gateDigest: write.boundaryReleaseGate?.gateDigest ?? null,
        releaseAllowed: write.boundaryReleaseGate?.releaseAllowed === true,
        restartSafe: write.boundaryReleaseGate?.restartSemantics?.restartSafe === true,
        missingAcknowledgementCount: write.boundaryReleaseGate?.missingAcknowledgements?.length ?? 0,
        replayPolicy: write.boundaryReleaseGate?.replayPolicy ?? null
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'client', persistedState: persistedClientState.state })}`,
      phase: 'client_runtime',
      status: persistedClientState.state,
      digest: stableHash({
        persistedClientDigest: persistedClientState.digest,
        restartDigest: restartRecovery.digest,
        externalHandoffState: externalHandoff.state
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'resume_cursor', resumeCursorDigest: restartRecovery.resumeCursor?.digest })}`,
      phase: 'resume_cursor',
      status: restartRecovery.resumeCursor?.state ?? 'unknown',
      digest: stableHash({
        resumeCursorDigest: restartRecovery.resumeCursor?.digest ?? null,
        cursorKey: restartRecovery.resumeCursor?.cursorKey ?? null,
        resumePointer: restartRecovery.resumeCursor?.resumePointer ?? null,
        restartSafe: restartRecovery.resumeCursor?.restartSafe === true,
        aligned: restartRecovery.resumeCursor?.commandAligned === true
          && restartRecovery.resumeCursor?.statusChannelAligned === true
          && restartRecovery.resumeCursor?.envelopeDigestAligned === true
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'state_recovery_capsule', capsuleDigest: restartRecovery.stateRecoveryCapsule?.digest })}`,
      phase: 'state_recovery_capsule',
      status: restartRecovery.stateRecoveryCapsule?.state ?? 'unknown',
      digest: stableHash({
        capsuleDigest: restartRecovery.stateRecoveryCapsule?.digest ?? null,
        capsuleKey: restartRecovery.stateRecoveryCapsule?.capsuleKey ?? null,
        restartSafe: restartRecovery.stateRecoveryCapsule?.restartSafe === true,
        replaySafe: restartRecovery.stateRecoveryCapsule?.replaySafe === true,
        checkpointCount: restartRecovery.stateRecoveryCapsule?.checkpointCount ?? 0,
        commandCount: restartRecovery.stateRecoveryCapsule?.commandCount ?? 0
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'state_integrity', integrityDigest: write.stateIntegrityManifest?.digest })}`,
      phase: 'state_integrity',
      status: write.stateIntegrityManifest?.state ?? 'unknown',
      digest: stableHash({
        integrityDigest: write.stateIntegrityManifest?.digest ?? null,
        manifestDigest: write.stateIntegrityManifest?.manifestDigest ?? null,
        aligned: write.stateIntegrityManifest?.aligned === true,
        restartSafe: write.stateIntegrityManifest?.restartSafe === true,
        mismatchCount: write.stateIntegrityManifest?.mismatches?.length ?? 0,
        checkpointCount: write.stateIntegrityManifest?.checkpoints?.length ?? 0
      })
    },
    {
      id: `recovery:${stableHash({ programId, operation, phase: 'export', continuityState: exportContinuity.state })}`,
      phase: 'export_continuity',
      status: exportContinuity.state,
      digest: stableHash({
        exportContinuityDigest: exportContinuity.digest,
        ledgerDigest: exportContinuity.ledgerDigest,
        latestSnapshotDigest
      })
    }
  ];
  const exportReady = status !== 'blocked'
    && readinessPreview.ready === true
    && exportContinuity.ready === true
    && persistedClientState.ready === true
    && acceptanceHandoff.ready === true
    && failedPhases.length === 0;
  const reportRows = [
    {
      key: 'recovery_status',
      label: 'Recovery status',
      value: status,
      action: readinessPreview.primaryAction ?? null
    },
    {
      key: 'retry_policy',
      label: 'Retry policy',
      value: `${retry.strategy}:${retry.maxAttempts}`,
      action: retry.maxAttempts > 0 ? 'apply_retry_policy' : 'repair_retry_policy'
    },
    {
      key: 'provider_replay',
      label: 'Provider replay',
      value: replay.state,
      action: replay.nextAction
    },
    {
      key: 'provider_command_ledger',
      label: 'Provider command ledger',
      value: replay.commandLedgerState ?? 'unknown',
      action: replay.commandLedgerReplayMode === 'reuse_existing_provider_command'
        ? 'reuse_existing_provider_command'
        : replay.nextAction
    },
    {
      key: 'client_runtime',
      label: 'Client runtime',
      value: persistedClientState.state,
      action: persistedClientState.nextAction
    },
    {
      key: 'resume_cursor',
      label: 'Resume cursor',
      value: restartRecovery.resumeCursor?.state ?? 'unknown',
      action: restartRecovery.resumeCursor?.nextAction ?? restartRecovery.nextAction
    },
    {
      key: 'state_recovery_capsule',
      label: 'State recovery capsule',
      value: restartRecovery.stateRecoveryCapsule?.state ?? 'unknown',
      action: restartRecovery.stateRecoveryCapsule?.nextAction ?? restartRecovery.nextAction
    },
    {
      key: 'state_integrity_manifest',
      label: 'State integrity',
      value: write.stateIntegrityManifest?.state ?? 'unknown',
      action: write.stateIntegrityManifest?.nextAction ?? restartRecovery.stateRecoveryCapsule?.nextAction ?? restartRecovery.nextAction
    },
    {
      key: 'export_continuity',
      label: 'Export continuity',
      value: exportContinuity.state,
      action: exportContinuity.nextAction
    },
    {
      key: 'operator_action_card',
      label: 'Operator action card',
      value: write.analyticsActionCard?.state ?? 'unknown',
      action: write.analyticsActionCard?.primaryAction ?? write.nextAction
    },
    {
      key: 'operational_incident',
      label: 'Operational incident',
      value: write.operationalIncident?.state ?? 'unknown',
      action: write.operationalIncident?.nextAction ?? write.nextAction
    },
    {
      key: 'provider_handoff_health',
      label: 'Provider handoff health',
      value: write.providerHandoffHealth?.state ?? 'unknown',
      action: write.providerHandoffHealth?.nextAction ?? write.operationalIncident?.nextAction ?? write.nextAction
    },
    {
      key: 'recovery_runbook',
      label: 'Recovery runbook',
      value: write.recoveryRunbook?.state ?? 'unknown',
      action: write.recoveryRunbook?.nextAction ?? write.operationalIncident?.nextAction ?? write.nextAction
    },
    {
      key: 'boundary_permission_posture',
      label: 'Boundary permission posture',
      value: write.boundaryPermissionPosture?.state ?? 'unknown',
      action: write.boundaryPermissionPosture?.nextAction ?? write.boundaryRecoveryGuard?.nextAction ?? write.nextAction
    },
    {
      key: 'boundary_decision_receipt',
      label: 'Boundary decision receipt',
      value: write.boundaryDecisionReceipt?.decision ?? write.boundaryDecisionReceipt?.state ?? 'unknown',
      action: write.boundaryDecisionReceipt?.nextAction ?? write.boundaryPermissionPosture?.nextAction ?? write.nextAction
    },
    {
      key: 'boundary_release_gate',
      label: 'Boundary release gate',
      value: write.boundaryReleaseGate?.releaseAllowed ? 'open' : write.boundaryReleaseGate?.state ?? 'unknown',
      action: write.boundaryReleaseGate?.nextAction ?? write.boundaryDecisionReceipt?.nextAction ?? write.nextAction
    }
  ];
  const lifecycleCommandState = buildRecoveryLifecycleCommandState({
    write,
    provider,
    replay,
    readinessPreview,
    recoveryStatus: status,
    exportReady
  });
  const routeExport = buildRecoveryRouteExportState({
    write,
    provider,
    replay,
    readinessPreview,
    exportContinuity,
    exportReady
  });
  const nextAction = blockedReasons.length
    ? recoveryAnalyticsAction(blockedReasons[0])
    : write.operationalIncident?.terminal
      ? write.operationalIncident.nextAction ?? 'resolve_external_write_terminal_incident'
    : write.operationalIncident?.retryable
      ? write.operationalIncident.nextAction ?? 'retry_external_write_after_backoff'
    : write.recoveryRunbook?.state === 'blocked'
      ? write.recoveryRunbook.nextAction ?? 'repair_external_write_recovery_runbook'
    : write.recoveryRunbook?.state === 'retry_scheduled'
      ? write.recoveryRunbook.nextAction ?? 'wait_for_recovery_backoff_then_replay'
    : lifecycleCommandState.blockers.length
      ? recoveryAnalyticsAction(lifecycleCommandState.blockers[0])
    : routeExport.blockers.length
      ? recoveryAnalyticsAction(routeExport.blockers[0])
    : failedPhases[0]?.action
      ?? degradedPhases[0]?.action
      ?? (exportReady ? 'publish_recovery_analytics_summary' : readinessPreview.primaryAction);
  const reportDigest = stableHash({
    programId,
    operation,
    status,
    exportReady,
    historySnapshots: historySnapshots.map((snapshot) => snapshot.digest),
    stateIntegrityDigest: write.stateIntegrityManifest?.digest ?? null,
    stateIntegrityManifestDigest: write.stateIntegrityManifest?.manifestDigest ?? null,
    timeline: normalizedTimeline.map((event) => `${event.phase}:${event.status}:${event.action}`),
    diagnosticCounts,
    nextAction
  });
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.analytics-summary`,
    programId,
    operation,
    status,
    exportReady,
    reportDigest,
    latestSnapshotDigest,
    changedSincePrevious: exportReport?.history?.changedSincePrevious === true,
    operatorActionCard: write.analyticsActionCard,
    providerHandoffHealth: {
      state: write.providerHandoffHealth?.state ?? 'unknown',
      ready: write.providerHandoffHealth?.ready === true,
      degraded: write.providerHandoffHealth?.degraded === true,
      retryable: write.providerHandoffHealth?.retryable === true,
      terminal: write.providerHandoffHealth?.terminal === true,
      statusChannel: write.providerHandoffHealth?.statusChannel ?? null,
      commandId: write.providerHandoffHealth?.commandId ?? null,
      receiptDigest: write.providerHandoffHealth?.receipt?.digest ?? null,
      retryAfterMs: write.providerHandoffHealth?.retryWindow?.retryAfterMs ?? null,
      dependencyCount: write.providerHandoffHealth?.dependencies?.length ?? 0,
      failedDependencyCount: write.providerHandoffHealth?.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0,
      blockerCount: write.providerHandoffHealth?.blockers?.length ?? 0,
      warningCount: write.providerHandoffHealth?.warnings?.length ?? 0,
      digest: write.providerHandoffHealth?.digest ?? null,
      nextAction: write.providerHandoffHealth?.nextAction ?? null
    },
    boundaryDecisionReceipt: {
      state: write.boundaryDecisionReceipt?.state ?? 'unknown',
      ready: write.boundaryDecisionReceipt?.ready === true,
      decision: write.boundaryDecisionReceipt?.decision ?? 'unknown',
      releaseAllowed: write.boundaryDecisionReceipt?.release?.allowed === true,
      receiptDigest: write.boundaryDecisionReceipt?.receiptDigest ?? null,
      commandId: write.boundaryDecisionReceipt?.command?.commandId ?? null,
      evidenceCount: write.boundaryDecisionReceipt?.evidence?.length ?? 0,
      nextAction: write.boundaryDecisionReceipt?.nextAction ?? null
    },
    boundaryReleaseGate: {
      state: write.boundaryReleaseGate?.state ?? 'unknown',
      ready: write.boundaryReleaseGate?.ready === true,
      releaseAllowed: write.boundaryReleaseGate?.releaseAllowed === true,
      gateDigest: write.boundaryReleaseGate?.gateDigest ?? null,
      commandId: write.boundaryReleaseGate?.command?.commandId ?? null,
      restartSafe: write.boundaryReleaseGate?.restartSemantics?.restartSafe === true,
      replayPolicy: write.boundaryReleaseGate?.replayPolicy ?? null,
      missingAcknowledgementCount: write.boundaryReleaseGate?.missingAcknowledgements?.length ?? 0,
      nextAction: write.boundaryReleaseGate?.nextAction ?? null
    },
    lifecycleCommandState,
    routeExport,
    providerCommandLedger: {
      state: replay.commandLedgerState ?? write.providerCommandLedger?.state ?? 'unknown',
      digest: replay.commandLedgerDigest ?? write.providerCommandLedger?.digest ?? null,
      replayMode: replay.commandLedgerReplayMode ?? write.providerCommandLedger?.replayMode ?? null,
      restartPolicy: replay.commandLedgerRestartPolicy ?? write.providerCommandLedger?.restartPolicy ?? null,
      duplicateSafe: replay.commandLedgerDuplicateSafe ?? write.providerCommandLedger?.duplicateSafe ?? false,
      replayable: replay.commandLedgerReplayable ?? write.providerCommandLedger?.replayable ?? false,
      entryCount: replay.commandLedgerEntryCount ?? write.providerCommandLedger?.entries?.length ?? 0,
      commandCount: replay.commandLedgerCommandIds?.length ?? write.providerCommandLedger?.commands?.length ?? 0
    },
    resumeCursor: {
      state: restartRecovery.resumeCursor?.state ?? write.resumeCursor?.state ?? 'unknown',
      ready: restartRecovery.resumeCursor?.ready ?? write.resumeCursor?.ready ?? false,
      digest: restartRecovery.resumeCursor?.digest ?? write.resumeCursor?.digest ?? null,
      cursorKey: restartRecovery.resumeCursor?.cursorKey ?? write.resumeCursor?.cursorKey ?? null,
      resumePointer: restartRecovery.resumeCursor?.resumePointer ?? write.resumeCursor?.resumePointer ?? null,
      restartSafe: restartRecovery.resumeCursor?.restartSafe ?? write.resumeCursor?.restartSemantics?.restartSafe ?? false,
      commandAligned: restartRecovery.resumeCursor?.commandAligned ?? false,
      statusChannelAligned: restartRecovery.resumeCursor?.statusChannelAligned ?? false,
      envelopeDigestAligned: restartRecovery.resumeCursor?.envelopeDigestAligned ?? false,
      routeDigestAligned: restartRecovery.resumeCursor?.routeDigestAligned ?? false,
      checkpointCount: restartRecovery.resumeCursor?.checkpointCount ?? write.resumeCursor?.checkpoints?.length ?? 0,
      nextAction: restartRecovery.resumeCursor?.nextAction ?? write.resumeCursor?.nextAction ?? null
    },
    stateIntegrity: {
      state: write.stateIntegrityManifest?.state ?? 'unknown',
      ready: write.stateIntegrityManifest?.ready === true,
      digest: write.stateIntegrityManifest?.digest ?? null,
      manifestDigest: write.stateIntegrityManifest?.manifestDigest ?? null,
      manifestKey: write.stateIntegrityManifest?.manifestKey ?? null,
      aligned: write.stateIntegrityManifest?.aligned === true,
      restartSafe: write.stateIntegrityManifest?.restartSafe === true,
      checkpointCount: write.stateIntegrityManifest?.checkpoints?.length ?? 0,
      mismatchCount: write.stateIntegrityManifest?.mismatches?.length ?? 0,
      blockerCount: write.stateIntegrityManifest?.blockers?.length ?? 0,
      warningCount: write.stateIntegrityManifest?.warnings?.length ?? 0,
      nextAction: write.stateIntegrityManifest?.nextAction ?? null
    },
    statusChannel: provider.statusChannel ?? handoff.statusChannel ?? null,
    idempotencyKey: provider.idempotencyKey ?? handoff.idempotencyKey ?? null,
    restartToken: restartRecovery.restartToken ?? continuation.restartToken ?? null,
    counters: {
      timelineEventCount: normalizedTimeline.length,
      failedPhaseCount: failedPhases.length,
      degradedPhaseCount: degradedPhases.length,
      diagnosticErrorCount: diagnosticCounts.error ?? 0,
      diagnosticWarningCount: diagnosticCounts.warning ?? 0,
      retryAttemptBudget: retry.maxAttempts,
      blockedReasonCount: blockedReasons.length,
      writeRequiredCount: write.writeRequired ? 1 : 0,
      syncReadyCount: sync.ready ? 1 : 0,
      operatorActionCardReadyCount: write.analyticsActionCard?.ready ? 1 : 0,
      operationalIncidentOpenCount: write.operationalIncident?.open ? 1 : 0,
      operationalIncidentRetryableCount: write.operationalIncident?.retryable ? 1 : 0,
      operationalIncidentTerminalCount: write.operationalIncident?.terminal ? 1 : 0,
      operationalIncidentEvidenceCount: write.operationalIncident?.evidence?.length ?? 0,
      operationalIncidentRetryAfterMs: write.operationalIncident?.retryWindow?.retryAfterMs ?? 0,
      recoveryRunbookReadyCount: write.recoveryRunbook?.ready ? 1 : 0,
      recoveryRunbookStepCount: write.recoveryRunbook?.steps?.length ?? 0,
      recoveryRunbookExecutableStepCount: write.recoveryRunbook?.steps?.filter((step) => step.executable).length ?? 0,
      recoveryRunbookBlockerCount: write.recoveryRunbook?.blockers?.length ?? 0,
      recoveryRunbookWarningCount: write.recoveryRunbook?.warnings?.length ?? 0,
      recoveryRunbookRetryAfterMs: write.recoveryRunbook?.retryAfterMs ?? 0,
      providerCommandLedgerReadyCount: replay.commandLedgerReplayable ? 1 : 0,
      providerCommandLedgerEntryCount: replay.commandLedgerEntryCount ?? write.providerCommandLedger?.entries?.length ?? 0,
      providerCommandLedgerCommandCount: replay.commandLedgerCommandIds?.length ?? write.providerCommandLedger?.commands?.length ?? 0,
      providerCommandLedgerDuplicateSafeCount: replay.commandLedgerDuplicateSafe ? 1 : 0,
      stateIntegrityReadyCount: write.stateIntegrityManifest?.ready ? 1 : 0,
      stateIntegrityRestartSafeCount: write.stateIntegrityManifest?.restartSafe ? 1 : 0,
      stateIntegrityAlignedCount: write.stateIntegrityManifest?.aligned ? 1 : 0,
      stateIntegrityCheckpointCount: write.stateIntegrityManifest?.checkpoints?.length ?? 0,
      stateIntegrityMismatchCount: write.stateIntegrityManifest?.mismatches?.length ?? 0,
      stateIntegrityBlockerCount: write.stateIntegrityManifest?.blockers?.length ?? 0,
      stateIntegrityWarningCount: write.stateIntegrityManifest?.warnings?.length ?? 0,
      providerHandoffReceiptReadyCount: provider.serviceContract?.handoffReceipt?.ready ? 1 : 0,
      providerHandoffReceiptFreshCount: provider.serviceContract?.handoffReceipt?.fresh ? 1 : 0,
      providerHandoffReceiptAcknowledgedCount: provider.serviceContract?.handoffReceipt?.acknowledged ? 1 : 0,
      providerHandoffReceiptBlockerCount: provider.serviceContract?.handoffReceipt?.blockers?.length ?? 0,
      providerHandoffReceiptWarningCount: provider.serviceContract?.handoffReceipt?.warnings?.length ?? 0,
      boundaryPermissionPostureReadyCount: write.boundaryPermissionPosture?.ready ? 1 : 0,
      boundaryPermissionPostureBlockerCount: write.boundaryPermissionPosture?.blockers?.length ?? 0,
      boundaryPermissionPostureWarningCount: write.boundaryPermissionPosture?.warnings?.length ?? 0,
      boundaryPermissionPostureMissingAcknowledgementCount: write.boundaryPermissionPosture?.missingAcknowledgements?.length ?? 0,
      boundaryPermissionPostureEscalationCount: write.boundaryPermissionPosture?.escalations?.length ?? 0,
      boundaryDecisionReceiptReadyCount: write.boundaryDecisionReceipt?.ready ? 1 : 0,
      boundaryDecisionReceiptReleaseCount: write.boundaryDecisionReceipt?.release?.allowed ? 1 : 0,
      boundaryDecisionReceiptBlockerCount: write.boundaryDecisionReceipt?.blockers?.length ?? 0,
      boundaryDecisionReceiptWarningCount: write.boundaryDecisionReceipt?.warnings?.length ?? 0,
      boundaryDecisionReceiptEvidenceCount: write.boundaryDecisionReceipt?.evidence?.length ?? 0,
      boundaryReleaseGateReadyCount: write.boundaryReleaseGate?.ready ? 1 : 0,
      boundaryReleaseGateReleaseCount: write.boundaryReleaseGate?.releaseAllowed ? 1 : 0,
      boundaryReleaseGateRestartSafeCount: write.boundaryReleaseGate?.restartSemantics?.restartSafe ? 1 : 0,
      boundaryReleaseGateBlockerCount: write.boundaryReleaseGate?.blockers?.length ?? 0,
      boundaryReleaseGateWarningCount: write.boundaryReleaseGate?.warnings?.length ?? 0,
      boundaryReleaseGateMissingAcknowledgementCount: write.boundaryReleaseGate?.missingAcknowledgements?.length ?? 0,
      lifecycleCommandReadyCount: lifecycleCommandState.ready ? 1 : 0,
      lifecycleCommandQueuePendingCount: lifecycleCommandState.lifecycleQueue?.pendingCount ?? 0,
      lifecycleCommandQueueBlockedCount: lifecycleCommandState.lifecycleQueue?.blockedCount ?? 0,
      lifecycleCommandQueueMissingAcknowledgementCount: lifecycleCommandState.lifecycleQueue?.missingAcknowledgementCount ?? 0,
      lifecycleCommandBlockerCount: lifecycleCommandState.blockers.length,
      lifecycleCommandWarningCount: lifecycleCommandState.warnings.length,
      routeExportReadyCount: routeExport.ready ? 1 : 0,
      routeExportChangedCount: routeExport.changedSinceAcceptedSnapshot ? 1 : 0,
      routeExportBlockerCount: routeExport.blockers.length,
      routeExportWarningCount: routeExport.warnings.length,
      resumeCursorReadyCount: restartRecovery.resumeCursor?.ready ? 1 : 0,
      resumeCursorRestartSafeCount: restartRecovery.resumeCursor?.restartSafe ? 1 : 0,
      resumeCursorAlignedCount: restartRecovery.resumeCursor?.commandAligned
        && restartRecovery.resumeCursor?.statusChannelAligned
        && restartRecovery.resumeCursor?.envelopeDigestAligned
        ? 1
        : 0,
      resumeCursorCheckpointCount: restartRecovery.resumeCursor?.checkpointCount ?? write.resumeCursor?.checkpoints?.length ?? 0
    },
    historySnapshots,
    timeline: normalizedTimeline,
    reportRows,
    operationalIncident: {
      state: write.operationalIncident?.state ?? 'unknown',
      severity: write.operationalIncident?.severity ?? 'none',
      open: write.operationalIncident?.open === true,
      retryable: write.operationalIncident?.retryable === true,
      terminal: write.operationalIncident?.terminal === true,
      owner: write.operationalIncident?.owner ?? null,
      retryAfterMs: write.operationalIncident?.retryWindow?.retryAfterMs ?? null,
      nextAction: write.operationalIncident?.nextAction ?? null,
      digest: write.operationalIncident?.digest ?? null
    },
    recoveryRunbook: {
      state: write.recoveryRunbook?.state ?? 'unknown',
      ready: write.recoveryRunbook?.ready === true,
      mode: write.recoveryRunbook?.mode ?? null,
      primaryCommandId: write.recoveryRunbook?.primaryCommandId ?? null,
      retryAfterMs: write.recoveryRunbook?.retryAfterMs ?? null,
      stepCount: write.recoveryRunbook?.steps?.length ?? 0,
      executableStepCount: write.recoveryRunbook?.steps?.filter((step) => step.executable).length ?? 0,
      blockerCount: write.recoveryRunbook?.blockers?.length ?? 0,
      warningCount: write.recoveryRunbook?.warnings?.length ?? 0,
      nextAction: write.recoveryRunbook?.nextAction ?? null,
      digest: write.recoveryRunbook?.digest ?? null
    },
    blockedReasons,
    nextAction
  };
}

function buildRecoveryLifecycleCommandState({
  write,
  provider,
  replay,
  readinessPreview,
  recoveryStatus,
  exportReady
}) {
  const card = write.analyticsActionCard ?? {};
  const lifecycleQueue = write.lifecycleControls?.commandQueue ?? {};
  const queuedCommands = asArray(lifecycleQueue.commands);
  const commands = uniqueSorted([
    ...queuedCommands.map((command) => command.nextAction ?? command.action).filter(Boolean),
    ...(card.primaryAction ? [card.primaryAction] : []),
    ...(card.secondaryActions ?? []),
    ...(provider.nextAction ? [provider.nextAction] : []),
    ...(replay.nextAction ? [replay.nextAction] : []),
    ...(readinessPreview.primaryAction ? [readinessPreview.primaryAction] : [])
  ]);
  const blockers = uniqueSorted([
    ...(lifecycleQueue.state === 'blocked' ? (lifecycleQueue.blockers ?? ['lifecycle_command_queue_blocked']) : []),
    ...(write.writeRequired && !card.digest ? ['missing_external_write_operator_action_card'] : []),
    ...(write.writeRequired && !card.commandId ? ['operator_action_card_missing_command_id'] : []),
    ...(card.ready === false && card.blockers?.length ? card.blockers.map((blocker) => `operator_action_card_${blocker}`) : []),
    ...(recoveryStatus === 'blocked' ? ['recovery_status_blocked'] : []),
    ...(write.writeRequired && !commands.length ? ['missing_lifecycle_recovery_command'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(lifecycleQueue.state === 'awaiting_acknowledgement' ? ['lifecycle_command_queue_awaiting_acknowledgement'] : []),
    ...(lifecycleQueue.warnings ?? []).map((warning) => `lifecycle_queue_${warning}`),
    ...(card.warnings ?? []).map((warning) => `operator_action_card_${warning}`),
    ...(readinessPreview.warnings ?? []).map((warning) => `readiness_${warning}`),
    ...(exportReady ? [] : ['recovery_export_not_ready'])
  ]);
  const state = blockers.length
    ? 'blocked'
    : lifecycleQueue.state === 'awaiting_acknowledgement'
      ? 'awaiting_acknowledgement'
      : lifecycleQueue.state === 'pending'
        ? 'pending'
    : warnings.length
      ? 'review'
      : write.writeRequired
        ? 'ready'
        : 'not_required';
  const selectedCommand = blockers.length
    ? recoveryAnalyticsAction(blockers[0])
    : lifecycleQueue.state === 'awaiting_acknowledgement'
      ? 'collect_lifecycle_confirmation'
    : lifecycleQueue.state === 'pending'
      ? lifecycleQueue.nextAction ?? 'apply_pending_lifecycle_command'
    : warnings.length
      ? recoveryPreviewWarningAction(warnings[0])
      : write.writeRequired
        ? 'publish_recovery_lifecycle_commands'
        : 'continue_read_only';
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.lifecycle-command-state`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired: write.writeRequired,
    selectedCommand,
    lifecycleQueue: {
      state: lifecycleQueue.state ?? 'unknown',
      ready: lifecycleQueue.ready ?? false,
      selectedCommandId: lifecycleQueue.selectedCommandId ?? null,
      selectedAction: lifecycleQueue.selectedAction ?? null,
      pendingCount: lifecycleQueue.pending?.length ?? 0,
      appliedCount: lifecycleQueue.applied?.length ?? 0,
      blockedCount: lifecycleQueue.blocked?.length ?? 0,
      missingAcknowledgementCount: lifecycleQueue.missingAcknowledgements?.length ?? 0,
      nextAction: lifecycleQueue.nextAction ?? null,
      digest: lifecycleQueue.digest ?? null
    },
    commandIds: commands.map((action) => `recovery-command:${stableHash({ action, commandId: card.commandId, status: recoveryStatus })}`),
    commands: commands.map((action) => ({
      action,
      commandId: `recovery-command:${stableHash({ action, commandId: card.commandId, status: recoveryStatus })}`,
      statusChannel: provider.statusChannel ?? write.statusHandoff?.statusChannel ?? null,
      idempotencyKey: provider.idempotencyKey ?? write.idempotencyKey ?? null,
      source: queuedCommands.some((command) => command.nextAction === action || command.action === action)
        ? 'external_write_lifecycle_command_queue'
        : action === card.primaryAction
          ? 'external_write_operator_action_card'
          : 'recovery_analysis'
    })),
    operatorActionCardDigest: card.digest ?? null,
    providerCommandId: provider.commandId ?? replay.commandId ?? card.commandId ?? null,
    nextAction: selectedCommand,
    blockers,
    warnings,
    digest: stableHash({
      state,
      commands,
      lifecycleQueueDigest: lifecycleQueue.digest ?? null,
      cardDigest: card.digest ?? null,
      providerCommandId: provider.commandId ?? replay.commandId ?? card.commandId ?? null,
      blockers,
      warnings
    })
  };
}

function buildRecoveryRouteExportState({
  write,
  provider,
  replay,
  readinessPreview,
  exportContinuity,
  exportReady
}) {
  const routeExport = write.routeExportState ?? {};
  const blockers = uniqueSorted([
    ...(routeExport.blockers ?? []).map((blocker) => `route_export_${blocker}`),
    ...(write.writeRequired && !routeExport.digest ? ['missing_route_export_digest'] : []),
    ...(write.writeRequired && !routeExport.publishCommand?.commandId ? ['missing_route_export_publish_command'] : []),
    ...(write.writeRequired && replay.state === 'blocked' ? ['provider_replay_blocked'] : []),
    ...(write.writeRequired && exportContinuity.ready === false ? ['export_continuity_not_ready'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(routeExport.warnings ?? []).map((warning) => `route_export_${warning}`),
    ...(routeExport.changedSinceAcceptedSnapshot ? ['route_export_changed_since_acceptance'] : []),
    ...(readinessPreview.warnings ?? []).map((warning) => `readiness_${warning}`),
    ...(exportReady ? [] : ['recovery_export_not_ready'])
  ]);
  const state = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'review'
      : routeExport.ready
        ? 'ready'
        : write.writeRequired
          ? 'not_ready'
          : 'not_required';
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.route-export-state`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired: write.writeRequired === true,
    statusChannel: routeExport.statusChannel ?? provider.statusChannel ?? null,
    publishCommandId: routeExport.publishCommand?.commandId ?? null,
    publishReady: routeExport.publishCommand?.ready === true && blockers.length === 0,
    commandId: routeExport.commandId ?? provider.commandId ?? replay.commandId ?? null,
    digest: routeExport.digest ?? null,
    acceptanceDigest: routeExport.acceptanceDigest ?? null,
    exportDigest: routeExport.exportDigest ?? null,
    changedSinceAcceptedSnapshot: routeExport.changedSinceAcceptedSnapshot === true,
    nextAction: blockers.length
      ? recoveryAnalyticsAction(blockers[0])
      : warnings.length
        ? recoveryPreviewWarningAction(warnings[0])
        : routeExport.nextAction ?? (write.writeRequired ? 'publish_external_write_route_export' : 'continue_read_only'),
    blockers,
    warnings
  };
}

function validateRecoveryStateIntegrityManifest(manifest, write) {
  if (!write?.writeRequired && !manifest) return [];
  const diagnostics = [];
  if (!manifest) return [{ level: 'error', code: 'recovery_missing_state_integrity_manifest' }];
  if (write?.writeRequired && manifest.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_state_integrity_not_write_required' });
  }
  if (manifest.ready && manifest.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'recovery_state_integrity_ready_with_blockers', blockers: manifest.blockers });
  }
  if (manifest.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_state_integrity_blocked', blockers: manifest.blockers ?? [] });
  }
  if (write?.writeRequired && !manifest.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_state_integrity_missing_digest' });
  }
  if (write?.writeRequired && !manifest.manifestDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_state_integrity_missing_manifest_digest' });
  }
  if (write?.writeRequired && manifest.aligned !== true) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_state_integrity_digest_mismatch',
      mismatches: manifest.mismatches ?? []
    });
  }
  if (write?.writeRequired && manifest.restartSafe !== true) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_state_integrity_not_restart_safe',
      nextAction: manifest.nextAction ?? 'rebuild_external_write_state_integrity_manifest'
    });
  }
  if (manifest.state === 'review' || manifest.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'recovery_state_integrity_review', warnings: manifest.warnings ?? [] });
  }
  return diagnostics;
}

function validateRecoveryAnalyticsSummary(summary, report) {
  if (!report?.externalWrite?.writeRequired && !summary) return [];
  const diagnostics = [];
  if (!summary) return [{ level: 'error', code: 'recovery_missing_analytics_summary' }];
  if (summary.exportReady && summary.blockedReasons?.length) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_export_ready_with_blockers', blockers: summary.blockedReasons });
  }
  if (summary.exportReady && !summary.reportDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_report_digest' });
  }
  if (report?.externalWrite?.writeRequired && !summary.historySnapshots?.length) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_history_snapshots' });
  }
  if (report?.externalWrite?.writeRequired && !summary.operatorActionCard?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_operator_action_card' });
  }
  if (summary.lifecycleCommandState?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_analytics_lifecycle_command_state_blocked',
      blockers: summary.lifecycleCommandState.blockers ?? []
    });
  }
  if (summary.lifecycleCommandState?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_analytics_lifecycle_command_state_review',
      warnings: summary.lifecycleCommandState.warnings ?? []
    });
  }
  if (summary.lifecycleCommandState?.state === 'awaiting_acknowledgement') {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_analytics_lifecycle_command_queue_awaiting_acknowledgement',
      missingAcknowledgementCount: summary.lifecycleCommandState.lifecycleQueue?.missingAcknowledgementCount ?? 0
    });
  }
  if (summary.lifecycleCommandState?.state === 'pending') {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_analytics_lifecycle_command_queue_pending',
      pendingCount: summary.lifecycleCommandState.lifecycleQueue?.pendingCount ?? 0
    });
  }
  if (report?.externalWrite?.writeRequired && !summary.routeExport?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_route_export_digest' });
  }
  if (report?.externalWrite?.writeRequired && !summary.routeExport?.publishCommandId) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_route_export_publish_command' });
  }
  if (summary.routeExport?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_analytics_route_export_blocked',
      blockers: summary.routeExport.blockers ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && !summary.recoveryRunbook?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_runbook_digest' });
  }
  if (report?.externalWrite?.writeRequired && !summary.recoveryRunbook?.stepCount) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_runbook_steps' });
  }
  if (summary.recoveryRunbook?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_analytics_runbook_blocked',
      blockers: report?.externalWrite?.recoveryRunbook?.blockers ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && !summary.boundaryReleaseGate?.gateDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_boundary_release_gate_digest' });
  }
  if (report?.externalWrite?.writeRequired && summary.boundaryReleaseGate?.releaseAllowed !== true) {
    diagnostics.push({
      level: summary.boundaryReleaseGate?.state === 'review' ? 'warning' : 'error',
      code: 'recovery_analytics_boundary_release_gate_not_open',
      nextAction: summary.boundaryReleaseGate?.nextAction ?? 'open_boundary_release_gate'
    });
  }
  if (report?.externalWrite?.writeRequired && summary.boundaryReleaseGate?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_boundary_release_gate_not_restart_safe' });
  }
  if (summary.routeExport?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_analytics_route_export_review',
      warnings: summary.routeExport.warnings ?? []
    });
  }
  if (report?.externalWrite?.writeRequired && !summary.resumeCursor?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_resume_cursor_digest' });
  }
  if (report?.externalWrite?.writeRequired && summary.resumeCursor?.restartSafe === false) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_resume_cursor_not_restart_safe' });
  }
  if (report?.externalWrite?.writeRequired && summary.resumeCursor?.commandAligned === false) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_resume_cursor_command_mismatch' });
  }
  if (report?.externalWrite?.writeRequired && summary.resumeCursor?.statusChannelAligned === false) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_resume_cursor_status_channel_mismatch' });
  }
  if (report?.externalWrite?.writeRequired && summary.resumeCursor?.envelopeDigestAligned === false) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_resume_cursor_envelope_mismatch' });
  }
  if (report?.externalWrite?.writeRequired && summary.resumeCursor?.routeDigestAligned === false) {
    diagnostics.push({ level: 'warning', code: 'recovery_analytics_resume_cursor_route_changed' });
  }
  if (report?.externalWrite?.writeRequired && !summary.stateIntegrity?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_state_integrity_digest' });
  }
  if (report?.externalWrite?.writeRequired && summary.stateIntegrity?.aligned !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_state_integrity_not_aligned' });
  }
  if (report?.externalWrite?.writeRequired && summary.stateIntegrity?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_state_integrity_not_restart_safe' });
  }
  if (summary.stateIntegrity?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_analytics_state_integrity_review',
      warningCount: summary.stateIntegrity.warningCount ?? 0
    });
  }
  if (summary.counters?.failedPhaseCount > 0) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_failed_phases', failedPhaseCount: summary.counters.failedPhaseCount });
  }
  if (summary.operationalIncident?.terminal) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_analytics_terminal_operational_incident',
      incidentDigest: summary.operationalIncident.digest ?? null
    });
  }
  if (summary.operationalIncident?.open && !summary.operationalIncident?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_operational_incident_digest' });
  }
  if (summary.operationalIncident?.retryable && !summary.operationalIncident?.retryAfterMs) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_missing_operational_incident_retry_after' });
  }
  if (report?.externalWrite?.writeRequired && summary.providerService?.handoffReceipt?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_analytics_provider_handoff_receipt_blocked',
      receiptDigest: summary.providerService.handoffReceipt.digest ?? null
    });
  }
  if (report?.externalWrite?.writeRequired && summary.providerService?.handoffReceipt?.fresh === false) {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_analytics_provider_handoff_receipt_stale',
      receiptDigest: summary.providerService.handoffReceipt.digest ?? null
    });
  }
  if (report?.externalWrite?.writeRequired && summary.providerService?.handoffReceipt?.acknowledged === false) {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_analytics_provider_handoff_receipt_unacknowledged',
      receiptDigest: summary.providerService.handoffReceipt.digest ?? null
    });
  }
  if (summary.counters?.degradedPhaseCount > 0) {
    diagnostics.push({ level: 'warning', code: 'recovery_analytics_degraded_phases', degradedPhaseCount: summary.counters.degradedPhaseCount });
  }
  return diagnostics;
}

function recoveryAnalyticsAction(blocker) {
  if (String(blocker).includes('retry')) return 'repair_retry_policy';
  if (String(blocker).includes('rollback')) return 'declare_rollback_action';
  if (String(blocker).includes('provider_replay')) return 'persist_replayable_provider_command';
  if (String(blocker).includes('provider_service')) return 'negotiate_mailchimp_provider_capability';
  if (String(blocker).includes('provider')) return 'resolve_provider_contract';
  if (String(blocker).includes('boundary_decision')) return 'publish_boundary_decision_receipt';
  if (String(blocker).includes('boundary_release_gate')) return 'open_boundary_release_gate';
  if (String(blocker).includes('boundary_release')) return 'repair_boundary_release_decision';
  if (String(blocker).includes('persisted_client')) return 'repair_persisted_client_runtime_state';
  if (String(blocker).includes('export')) return 'publish_recovery_export_continuity';
  if (String(blocker).includes('acceptance')) return 'collect_operator_acknowledgement';
  if (String(blocker).includes('external_write')) return 'resolve_external_write_before_recovery';
  return 'operator_review';
}

function nextRecoveryAction({ status, blockedReasons, write, continuation, kernelCall, provider, externalHandoff, replay, acceptanceHandoff, readinessPreview }) {
  if (blockedReasons.includes('recovery_provider_contract_blocked')) return provider.nextAction;
  if (blockedReasons.includes('recovery_provider_replay_blocked')) return replay.nextAction;
  if (blockedReasons.includes('recovery_boundary_decision_receipt_blocked')) return write.boundaryDecisionReceipt?.nextAction ?? 'publish_boundary_decision_receipt';
  if (blockedReasons.includes('recovery_boundary_release_gate_blocked')) return write.boundaryReleaseGate?.nextAction ?? 'open_boundary_release_gate';
  if (blockedReasons.includes('recovery_boundary_release_gate_not_open')) return write.boundaryReleaseGate?.nextAction ?? 'open_boundary_release_gate';
  if (blockedReasons.includes('recovery_restart_plan_blocked')) return 'repair_restart_recovery_checkpoint';
  if (blockedReasons.includes('recovery_persisted_client_state_blocked')) return 'repair_persisted_client_runtime_state';
  if (blockedReasons.includes('recovery_acceptance_handoff_blocked')) return acceptanceHandoff.nextAction;
  if (blockedReasons.includes('recovery_readiness_preview_blocked')) return readinessPreview.primaryAction;
  if (blockedReasons.includes('recovery_external_write_blocked')) return write.nextAction ?? 'resolve_external_write';
  if (blockedReasons.includes('recovery_invalid_retry_policy')) return 'repair_retry_policy';
  if (blockedReasons.includes('recovery_missing_rollback_action')) return 'declare_rollback_action';
  if (externalHandoff.state === 'held') return externalHandoff.nextAction;
  if (externalHandoff.state === 'scheduled') return externalHandoff.nextAction;
  if (externalHandoff.state === 'degraded') return externalHandoff.nextAction;
  if (acceptanceHandoff.state === 'pending_acknowledgement') return acceptanceHandoff.nextAction;
  if (readinessPreview.state === 'review') return readinessPreview.primaryAction;
  if (replay.state === 'waiting_for_snapshot') return replay.nextAction;
  if (status === 'paused') return continuation.resumeAction ?? 'resume_after_kernel_ack';
  if (kernelCall?.health?.status === 'unhealthy') return 'run_recovery_before_handoff';
  if (status === 'degraded') return 'handoff_with_recovery_warning';
  return 'handoff_status_ready';
}

function buildPersistedClientRuntimeState({
  kernelCall,
  continuation,
  handoff,
  write,
  provider,
  replay,
  externalHandoff,
  restartRecovery,
  exportReport
}) {
  const handoffSnapshot = write.clientRuntimeHandoff ?? {};
  const requestSnapshot = write.clientRequestSnapshot ?? {};
  const adoption = write.clientRuntimeAdoption ?? {};
  const adoptionReceipt = write.clientRuntimeAdoptionReceipt ?? {};
  const writeRequired = write.writeRequired === true;
  const persistedStatus = write.persistedStatus ?? {};
  const statusJournal = write.statusJournal ?? {};
  const persistenceEnvelope = write.persistenceEnvelope ?? {};
  const commandId = replay.commandId ?? provider.commandId ?? persistedStatus.commandId ?? handoffSnapshot.providerCommand?.commandId ?? write.commandId ?? null;
  const idempotencyKey = replay.idempotencyKey ?? provider.idempotencyKey ?? persistedStatus.idempotencyKey ?? handoffSnapshot.idempotencyKey ?? handoff.idempotencyKey ?? null;
  const statusChannel = provider.statusChannel ?? persistedStatus.statusChannel ?? handoffSnapshot.statusChannel ?? handoff.statusChannel ?? null;
  const restartToken = restartRecovery.restartToken ?? replay.restartToken ?? continuation.restartToken ?? persistedStatus.restartToken ?? handoffSnapshot.resume?.restartToken ?? null;
  const snapshotDigest = exportReport?.history?.latest?.digest ?? restartRecovery.exportSnapshotDigest ?? replay.snapshotDigest ?? persistedStatus.snapshotHint ?? null;
  const clientRequestDigest = requestSnapshot.digest ?? persistedStatus.clientRequestDigest ?? null;
  const clientRequestKey = requestSnapshot.requestKey ?? persistedStatus.clientRequestKey ?? null;
  const adoptionDigest = adoption.digest ?? null;
  const adoptionReceiptDigest = adoptionReceipt.digest ?? write.clientRuntimeAdoptionReceiptDigest ?? null;
  const adoptionReceiptKey = adoptionReceipt.receiptKey ?? write.clientRuntimeAdoptionReceiptKey ?? null;
  const adoptionReceiptRestartSafe = adoptionReceipt.restartSemantics?.restartSafe === true || !writeRequired;
  const statusAdoptionCheckpoint = adoptionReceipt.statusAdoptionCheckpoint ?? write.clientStatusAdoptionCheckpoint ?? {};
  const statusAdoptionDigest = statusAdoptionCheckpoint.digest ?? write.clientStatusAdoptionDigest ?? null;
  const statusAdoptionResumePointer = statusAdoptionCheckpoint.resumePointer ?? write.clientStatusAdoptionResumePointer ?? null;
  const statusAdoptionRestartSafe = statusAdoptionCheckpoint.restartSafe === true || !writeRequired;
  const workflowStatusCapsule = write.clientWorkflowStatusCapsule ?? {};
  const workflowStatusDigest = workflowStatusCapsule.digest ?? write.clientWorkflowStatusDigest ?? null;
  const workflowStatusResumePointer = workflowStatusCapsule.resumePointer ?? write.clientWorkflowStatusResumePointer ?? null;
  const workflowStatusRestartSafe = workflowStatusCapsule.restartSafe === true || !writeRequired;
  const workflowAdoptionLease = write.clientWorkflowAdoptionLease ?? {};
  const workflowAdoptionLeaseDigest = workflowAdoptionLease.digest ?? write.clientWorkflowAdoptionLeaseDigest ?? null;
  const workflowAdoptionLeaseKey = workflowAdoptionLease.leaseKey ?? write.clientWorkflowAdoptionLeaseKey ?? null;
  const workflowAdoptionLeaseResumePointer = workflowAdoptionLease.resumePointer ?? write.clientWorkflowAdoptionLeaseResumePointer ?? null;
  const workflowAdoptionLeaseRestartSafe = workflowAdoptionLease.restartSafe === true || !writeRequired;
  const workflowAdoptionLeaseAligned = workflowAdoptionLease.aligned === true || !writeRequired;
  const workflowAdoptionLeaseStatusAligned = !writeRequired
    || !workflowAdoptionLease.statusChannel
    || !statusChannel
    || workflowAdoptionLease.statusChannel === statusChannel;
  const workflowAdoptionLeaseRestartTokenAligned = !writeRequired
    || !workflowAdoptionLease.restartToken
    || !restartToken
    || workflowAdoptionLease.restartToken === restartToken;
  const workflowAdoptionLeaseResumeAligned = !writeRequired
    || !workflowAdoptionLeaseResumePointer
    || !workflowStatusResumePointer
    || workflowAdoptionLeaseResumePointer === workflowStatusResumePointer;
  const operatorLifecycleAction = workflowStatusCapsule.operatorLifecycleAction ?? write.operatorLifecycleAction ?? {};
  const operatorLifecycleDigest = operatorLifecycleAction.digest ?? write.operatorLifecycleActionDigest ?? null;
  const operatorLifecycleRestartSafe = Boolean(operatorLifecycleAction.idempotencyKey ?? idempotencyKey ?? !writeRequired)
    && Boolean(operatorLifecycleAction.statusChannel ?? statusChannel ?? !writeRequired)
    && (!operatorLifecycleAction.requiresAcknowledgement || Boolean(operatorLifecycleAction.acknowledgementToken));
  const blockers = uniqueSorted([
    ...(handoffSnapshot.blockers ?? []),
    ...(requestSnapshot.blockers ?? []).map((blocker) => `client_request_${blocker}`),
    ...(adoption.blockers ?? []).map((blocker) => `client_adoption_${blocker}`),
    ...(adoptionReceipt.blockers ?? []).map((blocker) => `client_adoption_receipt_${blocker}`),
    ...(persistedStatus.blockers ?? []),
    ...(statusJournal.blockers ?? []).map((blocker) => `status_journal_${blocker}`),
    ...(persistenceEnvelope.blockers ?? []).map((blocker) => `persistence_envelope_${blocker}`),
    ...(provider.blockers ?? []),
    ...(replay.blockers ?? []),
    ...(restartRecovery.blockers ?? []),
    ...(externalHandoff.state === 'blocked' ? ['external_handoff_blocked'] : []),
    ...(write.boundaryTicket?.ready === false && writeRequired ? ['boundary_ticket_not_ready'] : []),
    ...(!commandId && writeRequired ? ['missing_client_command_id'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_client_idempotency_key'] : []),
    ...(!statusChannel && writeRequired ? ['missing_client_status_channel'] : []),
    ...(!restartToken && handoff.requiresResume ? ['missing_client_restart_token'] : []),
    ...(!snapshotDigest && writeRequired ? ['missing_client_snapshot_digest'] : []),
    ...(!write.statusJournalDigest && writeRequired ? ['missing_client_status_journal_digest'] : []),
    ...(!write.persistenceEnvelopeDigest && writeRequired ? ['missing_client_persistence_envelope_digest'] : []),
    ...(!write.persistenceEnvelopeResumePointer && writeRequired ? ['missing_client_persistence_envelope_resume_pointer'] : []),
    ...(write.persistenceEnvelopeRestartSafe === false ? ['client_persistence_envelope_not_restart_safe'] : []),
    ...(!clientRequestDigest && writeRequired ? ['missing_client_request_digest'] : []),
    ...(!clientRequestKey && writeRequired ? ['missing_client_request_key'] : []),
    ...(!adoptionDigest && writeRequired ? ['missing_client_adoption_digest'] : []),
    ...(!adoptionReceiptDigest && writeRequired ? ['missing_client_adoption_receipt_digest'] : []),
    ...(!adoptionReceiptKey && writeRequired ? ['missing_client_adoption_receipt_key'] : []),
    ...(adoptionReceiptRestartSafe === false ? ['client_adoption_receipt_not_restart_safe'] : []),
    ...(!statusAdoptionDigest && writeRequired ? ['missing_client_status_adoption_digest'] : []),
    ...(!statusAdoptionResumePointer && writeRequired ? ['missing_client_status_adoption_resume_pointer'] : []),
    ...(statusAdoptionRestartSafe === false ? ['client_status_adoption_not_restart_safe'] : []),
    ...(!workflowStatusDigest && writeRequired ? ['missing_client_workflow_status_digest'] : []),
    ...(!workflowStatusResumePointer && writeRequired ? ['missing_client_workflow_status_resume_pointer'] : []),
    ...(workflowStatusRestartSafe === false ? ['client_workflow_status_not_restart_safe'] : []),
    ...(workflowStatusCapsule.state === 'blocked' ? (workflowStatusCapsule.blockers ?? ['client_workflow_status_blocked']) : []),
    ...(!workflowAdoptionLeaseDigest && writeRequired ? ['missing_client_workflow_adoption_lease_digest'] : []),
    ...(!workflowAdoptionLeaseKey && writeRequired ? ['missing_client_workflow_adoption_lease_key'] : []),
    ...(!workflowAdoptionLeaseResumePointer && writeRequired ? ['missing_client_workflow_adoption_lease_resume_pointer'] : []),
    ...(workflowAdoptionLeaseRestartSafe === false ? ['client_workflow_adoption_lease_not_restart_safe'] : []),
    ...(workflowAdoptionLeaseAligned === false ? ['client_workflow_adoption_lease_not_aligned'] : []),
    ...(workflowAdoptionLeaseStatusAligned ? [] : ['client_workflow_adoption_lease_status_channel_mismatch']),
    ...(workflowAdoptionLeaseRestartTokenAligned ? [] : ['client_workflow_adoption_lease_restart_token_mismatch']),
    ...(workflowAdoptionLeaseResumeAligned ? [] : ['client_workflow_adoption_lease_resume_pointer_mismatch']),
    ...(workflowAdoptionLease.state === 'blocked' ? (workflowAdoptionLease.blockers ?? ['client_workflow_adoption_lease_blocked']) : []),
    ...(!operatorLifecycleDigest && writeRequired ? ['missing_operator_lifecycle_action_digest'] : []),
    ...(operatorLifecycleRestartSafe === false ? ['operator_lifecycle_action_not_restart_safe'] : []),
    ...(operatorLifecycleAction.state === 'blocked' ? (operatorLifecycleAction.blockers ?? ['operator_lifecycle_action_blocked']) : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : !writeRequired
      ? 'not_required'
      : adoption.state === 'held'
        ? 'held'
        : adoption.state === 'scheduled'
          ? 'scheduled'
          : adoption.state === 'awaiting_acknowledgement'
            ? 'pending_acknowledgement'
            : externalHandoff.state === 'held'
              ? 'held'
              : externalHandoff.state === 'scheduled'
                ? 'scheduled'
                : replay.state === 'ready' && provider.status === 'ready'
                  ? 'ready'
                  : 'waiting';
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    commandId,
    idempotencyKey,
    statusChannel,
    restartToken,
    snapshotDigest,
    persistenceEnvelopeDigest: write.persistenceEnvelopeDigest ?? persistenceEnvelope.digest ?? null,
    persistenceEnvelopeResumePointer: write.persistenceEnvelopeResumePointer ?? persistenceEnvelope.resumePointer ?? null,
    clientRequestDigest,
    clientRequestKey,
    adoptionDigest,
    adoptionReceiptDigest,
    adoptionReceiptKey,
    statusAdoptionDigest,
    statusAdoptionResumePointer,
    workflowStatusDigest,
    workflowStatusResumePointer,
    workflowAdoptionLeaseDigest,
    workflowAdoptionLeaseKey,
    workflowAdoptionLeaseResumePointer,
    workflowAdoptionLeaseRestartSafe,
    workflowAdoptionLeaseAligned,
    operatorLifecycleDigest,
    state
  };
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.persisted-client-runtime`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    target: handoffSnapshot.target ?? handoff.target,
    statusChannel,
    idempotencyKey,
    commandId,
    restartToken,
    snapshotDigest,
    clientRequestSnapshot: {
      state: requestSnapshot.state ?? 'unknown',
      ready: requestSnapshot.ready === true || !writeRequired,
      digest: clientRequestDigest,
      requestKey: clientRequestKey,
      visibleStatus: requestSnapshot.visibleStatus?.current ?? null,
      commandCount: requestSnapshot.commands?.length ?? 0,
      nextAction: requestSnapshot.nextAction ?? null
    },
    clientRuntimeAdoption: {
      state: adoption.state ?? 'unknown',
      ready: adoption.ready === true || !writeRequired,
      digest: adoptionDigest,
      presentationMode: adoption.presentationMode ?? null,
      userVisibleStatus: adoption.userVisibleStatus ?? null,
      commandCount: adoption.commands?.length ?? 0,
      acknowledgementCount: adoption.requiredAcknowledgements?.length ?? 0,
      nextAction: adoption.nextAction ?? null,
      blockers: adoption.blockers ?? [],
      warnings: adoption.warnings ?? []
    },
    clientRuntimeAdoptionReceipt: {
      state: adoptionReceipt.state ?? 'unknown',
      ready: adoptionReceipt.ready === true || !writeRequired,
      receiptKey: adoptionReceiptKey,
      digest: adoptionReceiptDigest,
      statusChannel: adoptionReceipt.statusChannel ?? statusChannel,
      commandId: adoptionReceipt.command?.commandId ?? null,
      idempotencyKey: adoptionReceipt.command?.idempotencyKey ?? adoptionReceipt.idempotencyKey ?? null,
      restartSafe: adoptionReceiptRestartSafe,
      checkpointCount: adoptionReceipt.checkpoints?.length ?? 0,
      nextAction: adoptionReceipt.nextAction ?? null,
      blockers: adoptionReceipt.blockers ?? [],
      warnings: adoptionReceipt.warnings ?? []
    },
    clientStatusAdoptionCheckpoint: {
      state: statusAdoptionCheckpoint.state ?? 'unknown',
      ready: statusAdoptionCheckpoint.ready === true || !writeRequired,
      digest: statusAdoptionDigest,
      resumePointer: statusAdoptionResumePointer,
      statusChannel: statusAdoptionCheckpoint.statusChannel ?? statusChannel,
      idempotencyKey: statusAdoptionCheckpoint.idempotencyKey ?? idempotencyKey,
      restartToken: statusAdoptionCheckpoint.restartToken ?? restartToken,
      commandId: statusAdoptionCheckpoint.command?.commandId ?? null,
      commandIdempotencyKey: statusAdoptionCheckpoint.command?.idempotencyKey ?? null,
      restartSafe: statusAdoptionRestartSafe,
      userVisibleStatus: statusAdoptionCheckpoint.userVisibleStatus ?? null,
      nextAction: statusAdoptionCheckpoint.nextAction ?? null,
      blockers: statusAdoptionCheckpoint.blockers ?? [],
      warnings: statusAdoptionCheckpoint.warnings ?? []
    },
    clientWorkflowStatusCapsule: {
      state: workflowStatusCapsule.state ?? 'unknown',
      ready: workflowStatusCapsule.ready === true || !writeRequired,
      digest: workflowStatusDigest,
      resumePointer: workflowStatusResumePointer,
      statusChannel: workflowStatusCapsule.statusChannel ?? statusChannel,
      idempotencyKey: workflowStatusCapsule.idempotencyKey ?? idempotencyKey,
      restartToken: workflowStatusCapsule.restartToken ?? restartToken,
      commandId: workflowStatusCapsule.command?.commandId ?? null,
      commandIdempotencyKey: workflowStatusCapsule.command?.idempotencyKey ?? null,
      restartSafe: workflowStatusRestartSafe,
      visibleStatus: workflowStatusCapsule.visibleStatus?.current ?? null,
      checkpointCount: workflowStatusCapsule.checkpoints?.length ?? 0,
      nextAction: workflowStatusCapsule.nextAction ?? null,
      blockers: workflowStatusCapsule.blockers ?? [],
      warnings: workflowStatusCapsule.warnings ?? []
    },
    clientWorkflowAdoptionLease: {
      state: workflowAdoptionLease.state ?? 'unknown',
      ready: workflowAdoptionLease.ready === true || !writeRequired,
      digest: workflowAdoptionLeaseDigest,
      leaseKey: workflowAdoptionLeaseKey,
      resumePointer: workflowAdoptionLeaseResumePointer,
      statusChannel: workflowAdoptionLease.statusChannel ?? statusChannel,
      idempotencyKey: workflowAdoptionLease.idempotencyKey ?? idempotencyKey,
      restartToken: workflowAdoptionLease.restartToken ?? restartToken,
      commandId: workflowAdoptionLease.command?.commandId ?? null,
      commandIdempotencyKey: workflowAdoptionLease.command?.idempotencyKey ?? null,
      restartSafe: workflowAdoptionLeaseRestartSafe,
      aligned: workflowAdoptionLeaseAligned
        && workflowAdoptionLeaseStatusAligned
        && workflowAdoptionLeaseRestartTokenAligned
        && workflowAdoptionLeaseResumeAligned,
      alignment: {
        statusChannel: workflowAdoptionLeaseStatusAligned,
        restartToken: workflowAdoptionLeaseRestartTokenAligned,
        resumePointer: workflowAdoptionLeaseResumeAligned,
        sourceAligned: workflowAdoptionLeaseAligned
      },
      requestDigest: workflowAdoptionLease.request?.digest ?? clientRequestDigest,
      adoptionDigest: workflowAdoptionLease.adoption?.digest ?? adoptionDigest,
      adoptionReceiptDigest: workflowAdoptionLease.adoption?.receiptDigest ?? adoptionReceiptDigest,
      workflowStatusDigest: workflowAdoptionLease.adoption?.workflowStatusDigest ?? workflowStatusDigest,
      nextAction: workflowAdoptionLease.nextAction ?? null,
      blockers: workflowAdoptionLease.blockers ?? [],
      warnings: workflowAdoptionLease.warnings ?? []
    },
    operatorLifecycleAction: {
      state: operatorLifecycleAction.state ?? 'unknown',
      ready: operatorLifecycleAction.ready === true || !writeRequired,
      action: operatorLifecycleAction.action ?? null,
      digest: operatorLifecycleDigest,
      selectedCommandId: operatorLifecycleAction.selectedCommandId ?? null,
      requestedState: operatorLifecycleAction.requestedState ?? null,
      requiresAcknowledgement: operatorLifecycleAction.requiresAcknowledgement === true,
      acknowledgementToken: operatorLifecycleAction.acknowledgementToken ?? null,
      restartSafe: operatorLifecycleRestartSafe,
      statusChannel: operatorLifecycleAction.statusChannel ?? statusChannel,
      idempotencyKey: operatorLifecycleAction.idempotencyKey ?? idempotencyKey,
      commandCount: operatorLifecycleAction.commandIds?.length ?? operatorLifecycleAction.commands?.length ?? 0,
      nextAction: operatorLifecycleAction.nextAction ?? null,
      blockers: operatorLifecycleAction.blockers ?? [],
      warnings: operatorLifecycleAction.warnings ?? []
    },
    checkpointHash: continuation.checkpointHash,
    providerStatus: provider.status,
    replayState: replay.state,
    restartRecoveryState: restartRecovery.state,
    restartRecoveryDigest: restartRecovery.digest,
    statusJournal: {
      state: statusJournal.state ?? write.statusJournalState ?? 'unknown',
      ready: statusJournal.ready === true || !writeRequired,
      digest: write.statusJournalDigest ?? statusJournal.digest ?? null,
      latestCheckpoint: statusJournal.latestCheckpoint?.phase ?? null,
      commandCount: statusJournal.commands?.length ?? 0,
      restartPolicy: statusJournal.restartSemantics?.onRestart ?? null,
      nextAction: statusJournal.nextAction ?? null
    },
    persistenceEnvelope: {
      state: persistenceEnvelope.state ?? write.persistenceEnvelopeState ?? 'unknown',
      ready: persistenceEnvelope.ready === true || !writeRequired,
      digest: write.persistenceEnvelopeDigest ?? persistenceEnvelope.digest ?? null,
      resumePointer: write.persistenceEnvelopeResumePointer ?? persistenceEnvelope.resumePointer ?? null,
      manifestDigest: write.persistenceEnvelopeManifestDigest ?? persistenceEnvelope.manifestDigest ?? null,
      restartSafe: write.persistenceEnvelopeRestartSafe === true || !writeRequired,
      recoveryHintCount: persistenceEnvelope.recoveryHints?.length ?? 0,
      nextAction: persistenceEnvelope.nextAction ?? null
    },
    externalHandoffState: externalHandoff.state,
    boundaryTicket: {
      state: write.boundaryTicket?.state ?? 'unknown',
      ready: write.boundaryTicket?.ready === true,
      auditDigest: write.boundaryTicket?.auditDigest ?? null,
      nextAction: write.boundaryTicket?.nextAction ?? null
    },
    userVisibleStatus: {
      current: persistedStatus.userVisibleStatus?.current ?? handoffSnapshot.userVisibleStatus?.pending ?? persistedClientStatus(state),
      completion: persistedStatus.userVisibleStatus?.completion ?? handoffSnapshot.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: persistedStatus.userVisibleStatus?.failure ?? handoffSnapshot.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    resume: {
      mode: handoff.continuationMode,
      action: continuation.resumeAction,
      requiresResume: handoff.requiresResume,
      safeToResume: Boolean(restartToken) || handoff.requiresResume === false
    },
    scope: {
      tenantId: handoffSnapshot.scope?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
      workspaceId: handoffSnapshot.scope?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
      isolationKey: handoffSnapshot.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null
    },
    blockers,
    digest: stableHash(digestShape),
    nextAction: state === 'blocked'
      ? persistedClientAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'pending_acknowledgement'
            ? adoption.nextAction ?? 'collect_client_runtime_adoption_acknowledgement'
          : state === 'ready'
            ? 'persist_client_runtime_handoff'
            : writeRequired
              ? 'wait_for_replayable_provider_state'
              : 'continue_without_client_runtime_write'
  };
}

function buildRestartRecoveryPlan({ kernelCall, continuation, handoff, write, provider, replay, externalHandoff, exportReport }) {
  const persistedStatus = write.persistedStatus ?? {};
  const statusJournal = write.statusJournal ?? {};
  const persistenceEnvelope = write.persistenceEnvelope ?? {};
  const commandLedger = write.providerCommandLedger ?? {};
  const stateRecoveryCapsule = write.stateRecoveryCapsule ?? {};
  const writeRequired = write.writeRequired === true;
  const commandId = commandLedger.activeCommandId ?? persistedStatus.commandId ?? replay.commandId ?? provider.commandId ?? write.commandId ?? null;
  const commandDigest = commandLedger.activeCommandDigest ?? replay.commandDigest ?? persistedStatus.commandDigest ?? write.persistedCommandDigest ?? null;
  const idempotencyKey = commandLedger.idempotencyKey ?? persistedStatus.idempotencyKey ?? replay.idempotencyKey ?? provider.idempotencyKey ?? handoff.idempotencyKey ?? null;
  const statusChannel = persistedStatus.statusChannel ?? provider.statusChannel ?? handoff.statusChannel ?? null;
  const restartToken = persistedStatus.restartToken ?? replay.restartToken ?? continuation.restartToken ?? null;
  const exportSnapshotDigest = exportReport?.history?.latest?.digest ?? replay.snapshotDigest ?? null;
  const statusDigest = persistedStatus.digest ?? null;
  const journalDigest = write.statusJournalDigest ?? statusJournal.digest ?? null;
  const envelopeDigest = write.persistenceEnvelopeDigest ?? persistenceEnvelope.digest ?? null;
  const envelopeResumePointer = write.persistenceEnvelopeResumePointer ?? persistenceEnvelope.resumePointer ?? null;
  const envelopeRestartSafe = write.persistenceEnvelopeRestartSafe === true || persistenceEnvelope.restartSemantics?.restartSafe === true || !writeRequired;
  const journalRestartSafe = statusJournal.restartSemantics?.restartSafe === true || !writeRequired;
  const commandLedgerRestartSafe = commandLedger.restartPolicy
    ? !String(commandLedger.restartPolicy).includes('repair_provider_command_ledger')
    : !writeRequired;
  const clientRequestDigest = write.clientRequestDigest ?? write.clientRequestSnapshot?.digest ?? persistedStatus.clientRequestDigest ?? null;
  const clientRequestKey = write.clientRequestKey ?? write.clientRequestSnapshot?.requestKey ?? persistedStatus.clientRequestKey ?? null;
  const clientAdoptionReceiptDigest = write.clientRuntimeAdoptionReceipt?.digest ?? write.clientRuntimeAdoptionReceiptDigest ?? null;
  const clientAdoptionReceiptKey = write.clientRuntimeAdoptionReceipt?.receiptKey ?? write.clientRuntimeAdoptionReceiptKey ?? null;
  const clientAdoptionReceiptRestartSafe = write.clientRuntimeAdoptionReceipt?.restartSemantics?.restartSafe === true || !writeRequired;
  const clientStatusAdoptionCheckpoint = write.clientRuntimeAdoptionReceipt?.statusAdoptionCheckpoint ?? write.clientStatusAdoptionCheckpoint ?? {};
  const clientStatusAdoptionDigest = clientStatusAdoptionCheckpoint.digest ?? write.clientStatusAdoptionDigest ?? null;
  const clientStatusAdoptionResumePointer = clientStatusAdoptionCheckpoint.resumePointer ?? write.clientStatusAdoptionResumePointer ?? null;
  const clientStatusAdoptionRestartSafe = clientStatusAdoptionCheckpoint.restartSafe === true || !writeRequired;
  const resumeCursor = write.resumeCursor ?? {};
  const resumeCursorDigest = write.resumeCursorDigest ?? resumeCursor.digest ?? null;
  const resumeCursorPointer = resumeCursor.resumePointer ?? envelopeResumePointer ?? null;
  const resumeCursorRestartSafe = resumeCursor.restartSemantics?.restartSafe === true || !writeRequired;
  const resumeCursorCommandAligned = !writeRequired
    || !resumeCursor.commandId
    || !commandId
    || resumeCursor.commandId === commandId;
  const resumeCursorStatusAligned = !writeRequired
    || !resumeCursor.statusChannel
    || !statusChannel
    || resumeCursor.statusChannel === statusChannel;
  const resumeCursorEnvelopeAligned = !writeRequired
    || !resumeCursor.digestVector?.persistenceEnvelope
    || !envelopeDigest
    || resumeCursor.digestVector.persistenceEnvelope === envelopeDigest;
  const resumeCursorRouteAligned = !writeRequired
    || !resumeCursor.digestVector?.routeExport
    || !write.routeExportState?.digest
    || resumeCursor.digestVector.routeExport === write.routeExportState.digest;
  const stateRecoveryCapsuleRestartSafe = stateRecoveryCapsule.restartSafe === true
    || stateRecoveryCapsule.restartSemantics?.restartSafe === true
    || !writeRequired;
  const stateRecoveryCapsuleReplaySafe = stateRecoveryCapsule.replay?.safeToReplay === true || !writeRequired;
  const stateRecoveryCapsuleCommandAligned = !writeRequired
    || !stateRecoveryCapsule.commandId
    || !commandId
    || stateRecoveryCapsule.commandId === commandId;
  const stateRecoveryCapsuleStatusAligned = !writeRequired
    || !stateRecoveryCapsule.statusChannel
    || !statusChannel
    || stateRecoveryCapsule.statusChannel === statusChannel;
  const stateRecoveryCapsulePointerAligned = !writeRequired
    || !stateRecoveryCapsule.resumePointer
    || !resumeCursorPointer
    || stateRecoveryCapsule.resumePointer === resumeCursorPointer;
  const blockers = uniqueSorted([
    ...(persistedStatus.blockers ?? []),
    ...(statusJournal.blockers ?? []).map((blocker) => `status_journal_${blocker}`),
    ...(persistenceEnvelope.blockers ?? []).map((blocker) => `persistence_envelope_${blocker}`),
    ...(commandLedger.blockers ?? []).map((blocker) => `command_ledger_${blocker}`),
    ...(!commandId && writeRequired ? ['missing_restart_command_id'] : []),
    ...(!commandDigest && writeRequired ? ['missing_restart_command_digest'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_restart_idempotency_key'] : []),
    ...(!statusChannel && writeRequired ? ['missing_restart_status_channel'] : []),
    ...(!statusDigest && writeRequired ? ['missing_restart_status_digest'] : []),
    ...(!journalDigest && writeRequired ? ['missing_restart_status_journal_digest'] : []),
    ...(!envelopeDigest && writeRequired ? ['missing_restart_persistence_envelope_digest'] : []),
    ...(!envelopeResumePointer && writeRequired ? ['missing_restart_persistence_envelope_resume_pointer'] : []),
    ...(envelopeRestartSafe === false ? ['persistence_envelope_not_restart_safe'] : []),
    ...(journalRestartSafe === false ? ['status_journal_not_restart_safe'] : []),
    ...(!commandLedger.digest && writeRequired ? ['missing_restart_provider_command_ledger_digest'] : []),
    ...(commandLedgerRestartSafe === false && writeRequired ? ['provider_command_ledger_not_restart_safe'] : []),
    ...(commandLedger.duplicateSafe === false && writeRequired ? ['provider_command_ledger_duplicate_unsafe'] : []),
    ...(!clientRequestDigest && writeRequired ? ['missing_restart_client_request_digest'] : []),
    ...(!clientRequestKey && writeRequired ? ['missing_restart_client_request_key'] : []),
    ...(!clientAdoptionReceiptDigest && writeRequired ? ['missing_restart_client_adoption_receipt_digest'] : []),
    ...(!clientAdoptionReceiptKey && writeRequired ? ['missing_restart_client_adoption_receipt_key'] : []),
    ...(clientAdoptionReceiptRestartSafe === false ? ['client_adoption_receipt_not_restart_safe'] : []),
    ...(!clientStatusAdoptionDigest && writeRequired ? ['missing_restart_client_status_adoption_digest'] : []),
    ...(!clientStatusAdoptionResumePointer && writeRequired ? ['missing_restart_client_status_adoption_resume_pointer'] : []),
    ...(clientStatusAdoptionRestartSafe === false ? ['client_status_adoption_not_restart_safe'] : []),
    ...(!resumeCursorDigest && writeRequired ? ['missing_restart_resume_cursor_digest'] : []),
    ...(!resumeCursorPointer && writeRequired ? ['missing_restart_resume_cursor_pointer'] : []),
    ...(resumeCursorRestartSafe === false ? ['resume_cursor_not_restart_safe'] : []),
    ...(resumeCursorCommandAligned ? [] : ['resume_cursor_command_mismatch']),
    ...(resumeCursorStatusAligned ? [] : ['resume_cursor_status_channel_mismatch']),
    ...(resumeCursorEnvelopeAligned ? [] : ['resume_cursor_envelope_digest_mismatch']),
    ...(resumeCursorRouteAligned ? [] : ['resume_cursor_route_digest_mismatch']),
    ...(resumeCursor.state === 'blocked' && writeRequired ? ['resume_cursor_blocked'] : []),
    ...(stateRecoveryCapsule.blockers ?? []).map((blocker) => `state_recovery_${blocker}`),
    ...(!stateRecoveryCapsule.digest && writeRequired ? ['missing_restart_state_recovery_capsule_digest'] : []),
    ...(!stateRecoveryCapsule.resumePointer && writeRequired ? ['missing_restart_state_recovery_capsule_resume_pointer'] : []),
    ...(stateRecoveryCapsuleRestartSafe === false ? ['state_recovery_capsule_not_restart_safe'] : []),
    ...(stateRecoveryCapsuleReplaySafe === false ? ['state_recovery_capsule_not_replay_safe'] : []),
    ...(stateRecoveryCapsuleCommandAligned ? [] : ['state_recovery_capsule_command_mismatch']),
    ...(stateRecoveryCapsuleStatusAligned ? [] : ['state_recovery_capsule_status_channel_mismatch']),
    ...(stateRecoveryCapsulePointerAligned ? [] : ['state_recovery_capsule_resume_pointer_mismatch']),
    ...(stateRecoveryCapsule.state === 'blocked' && writeRequired ? ['state_recovery_capsule_blocked'] : []),
    ...(write.boundaryTicket?.ready === false && writeRequired ? ['boundary_ticket_not_ready'] : []),
    ...(!exportSnapshotDigest && writeRequired ? ['missing_restart_export_snapshot'] : []),
    ...(externalHandoff.state === 'blocked' ? ['restart_external_handoff_blocked'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : externalHandoff.state === 'held'
        ? 'held'
        : externalHandoff.state === 'scheduled'
          ? 'scheduled'
          : replay.state === 'ready' || persistedStatus.ready === true
            ? 'ready'
            : 'waiting';
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    commandId,
    commandDigest,
    idempotencyKey,
    statusChannel,
    restartToken,
    statusDigest,
    journalDigest,
    envelopeDigest,
    envelopeResumePointer,
    clientRequestDigest,
    clientRequestKey,
    clientAdoptionReceiptDigest,
    clientAdoptionReceiptKey,
    clientStatusAdoptionDigest,
    clientStatusAdoptionResumePointer,
    resumeCursorDigest,
    resumeCursorPointer,
    resumeCursorRestartSafe,
    stateRecoveryCapsuleDigest: stateRecoveryCapsule.digest ?? null,
    stateRecoveryCapsuleRestartSafe,
    stateRecoveryCapsuleReplaySafe,
    exportSnapshotDigest,
    continuationGeneration: continuation.generation
  };
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.restart-recovery`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    commandId,
    idempotencyKey,
    statusChannel,
    restartToken,
    statusDigest,
    statusJournalDigest: journalDigest,
    statusJournalState: statusJournal.state ?? write.statusJournalState ?? 'unknown',
    statusJournalLatestCheckpoint: statusJournal.latestCheckpoint?.phase ?? null,
    statusJournalRestartPolicy: statusJournal.restartSemantics?.onRestart ?? null,
    statusJournalCommandIds: (statusJournal.commands ?? []).map((command) => command.commandId).filter(Boolean),
    persistenceEnvelopeDigest: envelopeDigest,
    persistenceEnvelopeState: persistenceEnvelope.state ?? write.persistenceEnvelopeState ?? 'unknown',
    persistenceEnvelopeResumePointer: envelopeResumePointer,
    persistenceEnvelopeManifestDigest: write.persistenceEnvelopeManifestDigest ?? persistenceEnvelope.manifestDigest ?? null,
    persistenceEnvelopeRestartSafe: envelopeRestartSafe,
    persistenceEnvelopeRecoveryHints: persistenceEnvelope.recoveryHints ?? [],
    providerCommandLedgerDigest: commandLedger.digest ?? null,
    providerCommandLedgerState: commandLedger.state ?? 'unknown',
    providerCommandLedgerReplayMode: commandLedger.replayMode ?? null,
    providerCommandLedgerRestartPolicy: commandLedger.restartPolicy ?? null,
    providerCommandLedgerCommandIds: (commandLedger.commands ?? []).map((command) => command.commandId).filter(Boolean),
    clientRequestDigest,
    clientRequestKey,
    clientAdoptionReceiptDigest,
    clientAdoptionReceiptKey,
    clientAdoptionReceiptRestartSafe,
    clientStatusAdoptionDigest,
    clientStatusAdoptionResumePointer,
    clientStatusAdoptionRestartSafe,
    clientStatusAdoptionCheckpoint: {
      state: clientStatusAdoptionCheckpoint.state ?? 'unknown',
      ready: clientStatusAdoptionCheckpoint.ready === true || !writeRequired,
      commandId: clientStatusAdoptionCheckpoint.command?.commandId ?? null,
      statusChannel: clientStatusAdoptionCheckpoint.statusChannel ?? statusChannel,
      userVisibleStatus: clientStatusAdoptionCheckpoint.userVisibleStatus ?? null,
      nextAction: clientStatusAdoptionCheckpoint.nextAction ?? null
    },
    resumeCursor: {
      state: resumeCursor.state ?? 'unknown',
      ready: resumeCursor.ready === true || !writeRequired,
      digest: resumeCursorDigest,
      cursorKey: resumeCursor.cursorKey ?? null,
      resumePointer: resumeCursorPointer,
      restartSafe: resumeCursorRestartSafe,
      commandAligned: resumeCursorCommandAligned,
      statusChannelAligned: resumeCursorStatusAligned,
      envelopeDigestAligned: resumeCursorEnvelopeAligned,
      routeDigestAligned: resumeCursorRouteAligned,
      checkpointCount: resumeCursor.checkpoints?.length ?? 0,
      nextAction: resumeCursor.nextAction ?? null
    },
    stateRecoveryCapsule: {
      state: stateRecoveryCapsule.state ?? 'unknown',
      ready: stateRecoveryCapsule.ready === true || !writeRequired,
      digest: stateRecoveryCapsule.digest ?? null,
      capsuleKey: stateRecoveryCapsule.capsuleKey ?? null,
      resumePointer: stateRecoveryCapsule.resumePointer ?? null,
      restartSafe: stateRecoveryCapsuleRestartSafe,
      replaySafe: stateRecoveryCapsuleReplaySafe,
      replayMode: stateRecoveryCapsule.replay?.mode ?? null,
      commandId: stateRecoveryCapsule.commandId ?? null,
      commandAligned: stateRecoveryCapsuleCommandAligned,
      statusChannelAligned: stateRecoveryCapsuleStatusAligned,
      resumePointerAligned: stateRecoveryCapsulePointerAligned,
      checkpointCount: stateRecoveryCapsule.checkpoints?.length ?? 0,
      commandCount: stateRecoveryCapsule.commands?.length ?? 0,
      blockers: stateRecoveryCapsule.blockers ?? [],
      warnings: stateRecoveryCapsule.warnings ?? [],
      nextAction: stateRecoveryCapsule.nextAction ?? null
    },
    exportSnapshotDigest,
    persistedStatusState: persistedStatus.state ?? 'unknown',
    continuationGeneration: continuation.generation,
    replaySafe: replay.safeToReplay === true || commandLedger.replayable === true || persistedStatus.replay?.safeToReplay === true,
    journalRestartSafe,
    providerCommandLedgerRestartSafe: commandLedgerRestartSafe,
    boundaryTicket: {
      state: write.boundaryTicket?.state ?? 'unknown',
      ready: write.boundaryTicket?.ready === true,
      auditDigest: write.boundaryTicket?.auditDigest ?? persistedStatus.boundaryTicket?.auditDigest ?? null,
      nextAction: write.boundaryTicket?.nextAction ?? null
    },
    clientRequestSnapshot: {
      state: write.clientRequestSnapshot?.state ?? 'unknown',
      ready: write.clientRequestSnapshot?.ready === true || !writeRequired,
      digest: clientRequestDigest,
      requestKey: clientRequestKey,
      nextAction: write.clientRequestSnapshot?.nextAction ?? null
    },
    resume: {
      mode: handoff.continuationMode,
      requiresResume: handoff.requiresResume,
      safeToResume: Boolean(restartToken) || handoff.requiresResume === false,
      action: continuation.resumeAction
    },
    blockers,
    nextAction: state === 'blocked'
      ? restartRecoveryAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'publish_restart_safe_recovery_state'
            : replay.nextAction ?? 'wait_for_restart_recovery_state',
    digest: stableHash(digestShape)
  };
}

function validateRestartRecoveryPlan(plan, write) {
  if (!write?.writeRequired && !plan) return [];
  const diagnostics = [];
  if (!plan) return [{ level: 'error', code: 'recovery_missing_restart_plan' }];
  if (write?.writeRequired && plan.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_not_write_required' });
  }
  if (plan.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_blocked', blockers: plan.blockers ?? [] });
  }
  if (plan.ready && write?.writeRequired && !plan.statusDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_status_digest' });
  }
  if (plan.ready && write?.writeRequired && !plan.statusJournalDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_status_journal_digest' });
  }
  if (plan.ready && write?.writeRequired && !plan.persistenceEnvelopeDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_persistence_envelope_digest' });
  }
  if (plan.ready && write?.writeRequired && !plan.persistenceEnvelopeResumePointer) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_persistence_envelope_resume_pointer' });
  }
  if (plan.ready && write?.writeRequired && !plan.providerCommandLedgerDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_provider_command_ledger_digest' });
  }
  if (plan.ready && write?.writeRequired && !plan.clientRequestSnapshot?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_client_request_digest' });
  }
  if (plan.ready && write?.writeRequired && !plan.resumeCursor?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_resume_cursor_digest' });
  }
  if (plan.ready && write?.writeRequired && !plan.resumeCursor?.resumePointer) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_resume_cursor_pointer' });
  }
  if (write?.writeRequired && plan.journalRestartSafe === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_status_journal_not_restart_safe' });
  }
  if (write?.writeRequired && plan.persistenceEnvelopeRestartSafe === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_persistence_envelope_not_restart_safe' });
  }
  if (write?.writeRequired && plan.providerCommandLedgerRestartSafe === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_provider_command_ledger_not_restart_safe' });
  }
  if (write?.writeRequired && plan.resumeCursor?.restartSafe === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_resume_cursor_not_restart_safe' });
  }
  if (write?.writeRequired && plan.resumeCursor?.commandAligned === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_resume_cursor_command_mismatch' });
  }
  if (write?.writeRequired && plan.resumeCursor?.statusChannelAligned === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_resume_cursor_status_channel_mismatch' });
  }
  if (write?.writeRequired && plan.resumeCursor?.envelopeDigestAligned === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_resume_cursor_envelope_mismatch' });
  }
  if (write?.writeRequired && plan.resumeCursor?.routeDigestAligned === false) {
    diagnostics.push({ level: 'warning', code: 'recovery_restart_plan_resume_cursor_route_changed' });
  }
  if (plan.ready && write?.writeRequired && !plan.stateRecoveryCapsule?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_state_recovery_capsule' });
  }
  if (write?.writeRequired && plan.stateRecoveryCapsule?.restartSafe === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_state_recovery_capsule_not_restart_safe' });
  }
  if (write?.writeRequired && plan.stateRecoveryCapsule?.replaySafe === false) {
    diagnostics.push({ level: 'warning', code: 'recovery_restart_plan_state_recovery_capsule_not_replay_safe' });
  }
  if (write?.writeRequired && plan.stateRecoveryCapsule?.commandAligned === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_state_recovery_capsule_command_mismatch' });
  }
  if (write?.writeRequired && plan.stateRecoveryCapsule?.statusChannelAligned === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_state_recovery_capsule_status_channel_mismatch' });
  }
  if (write?.writeRequired && plan.stateRecoveryCapsule?.resumePointerAligned === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_state_recovery_capsule_resume_pointer_mismatch' });
  }
  if (write?.writeRequired && plan.resume?.safeToResume !== true) {
    diagnostics.push({ level: 'warning', code: 'recovery_restart_plan_missing_restart_token' });
  }
  return diagnostics;
}

function restartRecoveryAction(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('command_id')) return 'persist_provider_command_id';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('status_journal')) return 'persist_external_write_status_journal';
  if (String(blocker).includes('persistence_envelope')) return 'persist_external_write_persistence_envelope';
  if (String(blocker).includes('status_digest')) return 'persist_external_write_status_digest';
  if (String(blocker).includes('client_request')) return 'persist_client_request_snapshot';
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('handoff')) return 'repair_external_handoff';
  return providerActionForBlocker(blocker);
}

function validatePersistedClientRuntimeState(state, write) {
  if (!write?.writeRequired && !state) return [];
  const diagnostics = [];
  if (!state) return [{ level: 'error', code: 'recovery_missing_persisted_client_state' }];
  if (write?.writeRequired && state.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_not_write_required' });
  }
  if (state.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_blocked', blockers: state.blockers ?? [] });
  }
  if (state.ready && write?.writeRequired && !state.commandId) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_command_id' });
  }
  if (state.ready && write?.writeRequired && !state.snapshotDigest) {
    diagnostics.push({ level: 'warning', code: 'recovery_persisted_client_state_missing_snapshot_digest' });
  }
  if (state.ready && write?.writeRequired && !state.statusJournal?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_status_journal_digest' });
  }
  if (state.ready && write?.writeRequired && !state.persistenceEnvelope?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_persistence_envelope_digest' });
  }
  if (state.ready && write?.writeRequired && !state.persistenceEnvelope?.resumePointer) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_persistence_envelope_resume_pointer' });
  }
  if (state.ready && write?.writeRequired && state.persistenceEnvelope?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_persistence_envelope_not_restart_safe' });
  }
  if (state.ready && write?.writeRequired && !state.clientRequestSnapshot?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_client_request_digest' });
  }
  if (state.ready && write?.writeRequired && !state.clientRuntimeAdoption?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_client_adoption_digest' });
  }
  if (state.ready && write?.writeRequired && !state.clientRuntimeAdoptionReceipt?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_client_adoption_receipt_digest' });
  }
  if (state.ready && write?.writeRequired && state.clientRuntimeAdoptionReceipt?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_adoption_receipt_not_restart_safe' });
  }
  if (state.ready && write?.writeRequired && !state.clientStatusAdoptionCheckpoint?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_status_adoption_digest' });
  }
  if (state.ready && write?.writeRequired && !state.clientStatusAdoptionCheckpoint?.resumePointer) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_status_adoption_resume_pointer' });
  }
  if (state.ready && write?.writeRequired && state.clientStatusAdoptionCheckpoint?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_status_adoption_not_restart_safe' });
  }
  if (state.ready && write?.writeRequired && !state.clientWorkflowStatusCapsule?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_workflow_status_digest' });
  }
  if (state.ready && write?.writeRequired && !state.clientWorkflowStatusCapsule?.resumePointer) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_workflow_status_resume_pointer' });
  }
  if (state.ready && write?.writeRequired && state.clientWorkflowStatusCapsule?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_workflow_status_not_restart_safe' });
  }
  if (state.ready && write?.writeRequired && !state.clientWorkflowAdoptionLease?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_workflow_adoption_lease' });
  }
  if (state.ready && write?.writeRequired && !state.clientWorkflowAdoptionLease?.leaseKey) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_workflow_adoption_lease_key' });
  }
  if (state.ready && write?.writeRequired && !state.clientWorkflowAdoptionLease?.resumePointer) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_workflow_adoption_lease_resume_pointer' });
  }
  if (state.ready && write?.writeRequired && state.clientWorkflowAdoptionLease?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_workflow_adoption_lease_not_restart_safe' });
  }
  if (state.ready && write?.writeRequired && state.clientWorkflowAdoptionLease?.aligned !== true) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_persisted_client_state_workflow_adoption_lease_not_aligned',
      alignment: state.clientWorkflowAdoptionLease?.alignment ?? {}
    });
  }
  if (state.clientWorkflowStatusCapsule?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_persisted_client_state_workflow_status_blocked',
      blockers: write?.clientWorkflowStatusCapsule?.blockers ?? []
    });
  }
  if (state.clientWorkflowAdoptionLease?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_persisted_client_state_workflow_adoption_lease_blocked',
      blockers: write?.clientWorkflowAdoptionLease?.blockers ?? []
    });
  }
  if (state.clientWorkflowAdoptionLease?.state === 'review' || state.clientWorkflowAdoptionLease?.warnings?.length) {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_persisted_client_state_workflow_adoption_lease_review',
      warnings: state.clientWorkflowAdoptionLease?.warnings ?? []
    });
  }
  if (state.ready && write?.writeRequired && !state.operatorLifecycleAction?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_operator_lifecycle_action' });
  }
  if (state.ready && write?.writeRequired && state.operatorLifecycleAction?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_operator_lifecycle_not_restart_safe' });
  }
  if (state.operatorLifecycleAction?.requiresAcknowledgement && !state.operatorLifecycleAction?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_operator_lifecycle_ack_missing' });
  }
  if (state.operatorLifecycleAction?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_persisted_client_state_operator_lifecycle_blocked',
      blockers: state.operatorLifecycleAction.blockers ?? []
    });
  }
  if (state.clientStatusAdoptionCheckpoint?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_persisted_client_state_status_adoption_blocked',
      blockers: write?.clientRuntimeAdoptionReceipt?.statusAdoptionCheckpoint?.blockers ?? []
    });
  }
  if (state.clientRuntimeAdoption?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_persisted_client_state_adoption_blocked',
      blockers: write?.clientRuntimeAdoption?.blockers ?? []
    });
  }
  if (state.clientRuntimeAdoptionReceipt?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_persisted_client_state_adoption_receipt_blocked',
      blockers: write?.clientRuntimeAdoptionReceipt?.blockers ?? []
    });
  }
  if (state.state === 'pending_acknowledgement' && !state.clientRuntimeAdoption?.acknowledgementCount) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_adoption_acknowledgement' });
  }
  return diagnostics;
}

function persistedClientStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    pending_acknowledgement: 'waiting_for_client_runtime_acknowledgement',
    waiting: 'recovering_provider_state',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function persistedClientAction(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('command_id')) return 'persist_provider_command_id';
  if (String(blocker).includes('idempotency')) return 'persist_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('restart')) return 'persist_restart_token';
  if (String(blocker).includes('persistence_envelope')) return 'persist_external_write_persistence_envelope';
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('client_request')) return 'persist_client_request_snapshot';
  if (String(blocker).includes('client_adoption')) return 'persist_client_runtime_adoption';
  return providerActionForBlocker(blocker);
}

function normalizeRecoveryLifecycleControl(control = {}) {
  const blockers = uniqueSorted(control?.blockers ?? []);
  const warnings = uniqueSorted(control?.warnings ?? []);
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.provider-lifecycle-control`,
    state: control?.state ?? 'unknown',
    ready: control?.ready === true,
    effectiveEnabled: control?.effectiveEnabled === true,
    selectedControl: control?.selectedControl ?? null,
    userVisibleStatus: control?.userVisibleStatus ?? null,
    schedule: {
      status: control?.schedule?.status ?? null,
      mode: control?.schedule?.mode ?? null,
      notBefore: control?.schedule?.notBefore ?? null,
      notAfter: control?.schedule?.notAfter ?? null,
      timezone: control?.schedule?.timezone ?? null
    },
    commandCount: control?.commands?.length ?? 0,
    availableControls: (control?.controls ?? [])
      .filter((entry) => entry?.available)
      .map((entry) => entry.name)
      .sort(),
    blockers,
    warnings,
    nextAction: control?.nextAction ?? (
      blockers.length
        ? providerActionForBlocker(blockers[0])
        : warnings.length
          ? 'review_lifecycle_control'
          : 'continue_lifecycle_control'
    ),
    digest: control?.digest ?? null
  };
}

function buildProviderRecoveryContract({ kernelCall, handoff, write, exportReport }) {
  const lifecycleBlockers = write.lifecycleGate.blockers ?? [];
  const lifecycleControl = normalizeRecoveryLifecycleControl(write.lifecycleControls);
  const providerHealth = write.providerHealth ?? {};
  const providerService = write.providerServiceContract ?? {};
  const blockers = [
    ...write.blockedReasons,
    ...lifecycleBlockers,
    ...(lifecycleControl.blockers ?? []).map((blocker) => `lifecycle_control_${blocker}`),
    ...(write.writeRequired && lifecycleControl.state === 'blocked' ? ['lifecycle_control_blocked'] : []),
    ...(providerHealth.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
    ...(providerService.blockers ?? []).map((blocker) => `provider_service_${blocker}`),
    ...(providerService.providerSession?.blockers ?? []).map((blocker) => `provider_session_${blocker}`),
    ...(providerService.handoffReceipt?.blockers ?? providerService.sync?.handoffReceipt?.blockers ?? []).map((blocker) => `provider_handoff_receipt_${blocker}`),
    ...(write.writeRequired && providerService.ready === false ? ['provider_service_contract_not_ready'] : []),
    ...(write.writeRequired && providerService.providerSession?.ready === false ? ['provider_session_not_ready'] : []),
    ...(write.writeRequired && (providerService.handoffReceipt?.state ?? providerService.sync?.handoffReceipt?.state) === 'blocked' ? ['provider_handoff_receipt_blocked'] : []),
    ...(write.boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(write.boundaryTicket?.ready === false && write.writeRequired ? ['boundary_ticket_not_ready'] : []),
    ...(write.boundaryPermissionPosture?.blockers ?? []).map((blocker) => `boundary_posture_${blocker}`),
    ...(write.boundaryPermissionPosture?.ready === false && write.writeRequired ? ['boundary_permission_posture_not_ready'] : []),
    ...(write.boundaryDecisionReceipt?.blockers ?? []).map((blocker) => `boundary_decision_${blocker}`),
    ...(write.boundaryDecisionReceipt?.ready === false && write.writeRequired ? ['boundary_decision_receipt_not_ready'] : []),
    ...(write.boundaryDecisionReceipt?.release?.allowed === false && write.writeRequired ? ['boundary_release_not_allowed'] : []),
    ...(write.boundaryRecoveryGuard?.blockers ?? []).map((blocker) => `boundary_guard_${blocker}`),
    ...(write.boundaryRecoveryGuard?.ready === false && write.writeRequired ? ['boundary_recovery_guard_not_ready'] : []),
    ...(write.boundaryRecoveryGuard?.retryable === false && write.writeRequired ? ['boundary_recovery_guard_not_retryable'] : []),
    ...(!handoff.idempotencyKey ? ['missing_provider_idempotency_key'] : []),
    ...(!handoff.statusChannel ? ['missing_provider_status_channel'] : [])
  ];
  const degraded = providerHealth.degraded === true || providerHealth.status === 'degraded';
  const deferred = write.dispatchStatus === 'held' || write.dispatchStatus === 'scheduled';
  const status = blockers.length
    ? 'blocked'
    : deferred
      ? 'deferred'
      : degraded
        ? 'degraded'
      : exportReport?.analytics?.exportReady === true
        ? 'ready'
        : 'waiting_for_export';
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.provider-recovery`,
    provider: kernelCall?.adapter ?? 'mailchimp',
    service: 'mailchimp',
    target: handoff.target,
    status,
    statusChannel: handoff.statusChannel,
    idempotencyKey: handoff.idempotencyKey ?? write.idempotencyKey,
    commandId: write.commandId ?? null,
    commandState: write.commandState ?? null,
    replaySafe: write.replaySafe,
    exportReady: exportReport?.analytics?.exportReady === true,
    dispatchStatus: write.dispatchStatus,
    deferReason: deferred ? write.dispatchStatus : null,
    lifecycleControl,
    serviceContract: {
      state: providerService.state ?? 'unknown',
      ready: providerService.ready === true || !write.writeRequired,
      negotiationStatus: providerService.negotiation?.status ?? 'unknown',
      requiredCapabilities: providerService.requiredCapabilities ?? [],
      acceptedCapabilities: providerService.acceptedCapabilities ?? [],
      missingCapabilities: providerService.missingCapabilities ?? [],
      externalStateKey: providerService.sync?.externalStateKey ?? providerService.handoffState?.externalStateKey ?? null,
      checkpointDigest: providerService.sync?.checkpointDigest ?? providerService.handoffState?.checkpointDigest ?? null,
      providerSession: providerService.providerSession ? stableClone(providerService.providerSession) : null,
      handoffReceipt: providerService.handoffReceipt
        ? stableClone(providerService.handoffReceipt)
        : providerService.sync?.handoffReceipt
          ? stableClone(providerService.sync.handoffReceipt)
          : null,
      commandCount: providerService.commands?.length ?? 0,
      digest: providerService.digest ?? null,
      nextAction: providerService.nextAction ?? null
    },
    health: {
      status: providerHealth.status ?? 'unknown',
      ready: providerHealth.ready ?? false,
      degraded,
      retryable: providerHealth.retryable !== false,
      retryAfterMs: providerHealth.retryAfterMs ?? null,
      nextAction: providerHealth.nextAction ?? null,
      blockers: providerHealth.blockers ?? [],
      warnings: providerHealth.warnings ?? []
    },
    boundaryTicket: {
      state: write.boundaryTicket?.state ?? 'unknown',
      ready: write.boundaryTicket?.ready === true,
      auditDigest: write.boundaryTicket?.auditDigest ?? null,
      nextAction: write.boundaryTicket?.nextAction ?? null
    },
    boundaryRecoveryGuard: {
      state: write.boundaryRecoveryGuard?.state ?? 'unknown',
      ready: write.boundaryRecoveryGuard?.ready === true,
      retryable: write.boundaryRecoveryGuard?.retryable !== false,
      guardDigest: write.boundaryRecoveryGuard?.guardDigest ?? null,
      auditDigest: write.boundaryRecoveryGuard?.auditDigest ?? null,
      replayPolicy: write.boundaryRecoveryGuard?.replayPolicy ?? null,
      commandCount: write.boundaryRecoveryGuard?.commands?.length ?? 0,
      blockers: write.boundaryRecoveryGuard?.blockers ?? [],
      warnings: write.boundaryRecoveryGuard?.warnings ?? [],
      nextAction: write.boundaryRecoveryGuard?.nextAction ?? null
    },
    boundaryPermissionPosture: {
      state: write.boundaryPermissionPosture?.state ?? 'unknown',
      ready: write.boundaryPermissionPosture?.ready === true,
      permissionMode: write.boundaryPermissionPosture?.permissionMode ?? 'unknown',
      role: write.boundaryPermissionPosture?.role ?? null,
      postureDigest: write.boundaryPermissionPosture?.postureDigest ?? null,
      auditDigest: write.boundaryPermissionPosture?.auditDigest ?? null,
      replayPolicy: write.boundaryPermissionPosture?.guardVector?.replayPolicy ?? null,
      blockerCount: write.boundaryPermissionPosture?.blockers?.length ?? 0,
      warningCount: write.boundaryPermissionPosture?.warnings?.length ?? 0,
      missingAcknowledgementCount: write.boundaryPermissionPosture?.missingAcknowledgements?.length ?? 0,
      nextAction: write.boundaryPermissionPosture?.nextAction ?? null
    },
    boundaryDecisionReceipt: {
      state: write.boundaryDecisionReceipt?.state ?? 'unknown',
      ready: write.boundaryDecisionReceipt?.ready === true,
      decision: write.boundaryDecisionReceipt?.decision ?? 'unknown',
      releaseAllowed: write.boundaryDecisionReceipt?.release?.allowed === true,
      receiptDigest: write.boundaryDecisionReceipt?.receiptDigest ?? null,
      commandId: write.boundaryDecisionReceipt?.command?.commandId ?? null,
      evidenceCount: write.boundaryDecisionReceipt?.evidence?.length ?? 0,
      blockerCount: write.boundaryDecisionReceipt?.blockers?.length ?? 0,
      warningCount: write.boundaryDecisionReceipt?.warnings?.length ?? 0,
      nextAction: write.boundaryDecisionReceipt?.nextAction ?? null
    },
    blockers: uniqueSorted(blockers),
    nextAction: status === 'blocked'
      ? providerActionForBlocker(blockers[0])
      : status === 'deferred'
        ? write.dispatchStatus === 'scheduled'
          ? 'wait_for_schedule_window'
          : 'await_manual_release'
        : status === 'degraded'
          ? providerHealth.nextAction ?? 'handoff_with_provider_degraded_ack'
        : status === 'waiting_for_export'
          ? 'hold_provider_sync_until_export_ready'
          : 'publish_provider_recovery_state'
  };
}

function buildRecoverySyncMetadata({ kernelCall, continuation, handoff, write, provider, exportReport, replay, restartRecovery }) {
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.sync`,
    ready: provider.status === 'ready' && replay.state === 'ready' && restartRecovery.ready === true,
    providerStatus: provider.status,
    providerHealth: {
      status: provider.health?.status ?? 'unknown',
      ready: provider.health?.ready ?? false,
      degraded: provider.health?.degraded ?? false,
      retryable: provider.health?.retryable ?? true,
      retryAfterMs: provider.health?.retryAfterMs ?? null,
      nextAction: provider.health?.nextAction ?? null
    },
    lifecycleControl: {
      state: provider.lifecycleControl?.state ?? write.lifecycleControls?.state ?? 'unknown',
      ready: provider.lifecycleControl?.ready ?? write.lifecycleControls?.ready ?? false,
      selectedControl: provider.lifecycleControl?.selectedControl ?? write.lifecycleControls?.selectedControl ?? null,
      digest: provider.lifecycleControl?.digest ?? write.lifecycleControls?.digest ?? null,
      nextAction: provider.lifecycleControl?.nextAction ?? write.lifecycleControls?.nextAction ?? null
    },
    providerService: {
      state: provider.serviceContract?.state ?? write.providerServiceContract?.state ?? 'unknown',
      ready: provider.serviceContract?.ready ?? write.providerServiceContract?.ready ?? false,
      negotiationStatus: provider.serviceContract?.negotiationStatus ?? write.providerServiceContract?.negotiation?.status ?? 'unknown',
      externalStateKey: provider.serviceContract?.externalStateKey ?? write.providerServiceContract?.sync?.externalStateKey ?? null,
      checkpointDigest: provider.serviceContract?.checkpointDigest ?? write.providerServiceContract?.sync?.checkpointDigest ?? null,
      digest: provider.serviceContract?.digest ?? write.providerServiceContract?.digest ?? null,
      handoffReceipt: {
        state: provider.serviceContract?.handoffReceipt?.state ?? write.providerServiceContract?.handoffReceipt?.state ?? write.providerServiceContract?.sync?.handoffReceipt?.state ?? 'unknown',
        ready: provider.serviceContract?.handoffReceipt?.ready ?? write.providerServiceContract?.handoffReceipt?.ready ?? write.providerServiceContract?.sync?.handoffReceipt?.ready ?? false,
        acknowledged: provider.serviceContract?.handoffReceipt?.acknowledged ?? write.providerServiceContract?.handoffReceipt?.acknowledged ?? write.providerServiceContract?.sync?.handoffReceipt?.acknowledged ?? false,
        fresh: provider.serviceContract?.handoffReceipt?.fresh ?? write.providerServiceContract?.handoffReceipt?.fresh ?? write.providerServiceContract?.sync?.handoffReceipt?.fresh ?? false,
        digest: provider.serviceContract?.handoffReceipt?.digest ?? write.providerServiceContract?.handoffReceipt?.digest ?? write.providerServiceContract?.sync?.handoffReceipt?.digest ?? null,
        nextAction: provider.serviceContract?.handoffReceipt?.nextAction ?? write.providerServiceContract?.handoffReceipt?.nextAction ?? write.providerServiceContract?.sync?.handoffReceipt?.nextAction ?? null
      },
      nextAction: provider.serviceContract?.nextAction ?? write.providerServiceContract?.nextAction ?? null
    },
    boundaryRecoveryGuard: {
      state: provider.boundaryRecoveryGuard?.state ?? write.boundaryRecoveryGuard?.state ?? 'unknown',
      ready: provider.boundaryRecoveryGuard?.ready ?? write.boundaryRecoveryGuard?.ready ?? false,
      retryable: provider.boundaryRecoveryGuard?.retryable ?? write.boundaryRecoveryGuard?.retryable ?? false,
      guardDigest: provider.boundaryRecoveryGuard?.guardDigest ?? write.boundaryRecoveryGuard?.guardDigest ?? null,
      replayPolicy: provider.boundaryRecoveryGuard?.replayPolicy ?? write.boundaryRecoveryGuard?.replayPolicy ?? null,
      nextAction: provider.boundaryRecoveryGuard?.nextAction ?? write.boundaryRecoveryGuard?.nextAction ?? null
    },
    statusChannel: provider.statusChannel,
    idempotencyKey: provider.idempotencyKey,
    commandId: replay.commandId,
    commandState: replay.state,
    restartToken: continuation.restartToken,
    checkpointHash: continuation.checkpointHash,
    snapshotDigest: exportReport?.history?.latest?.digest ?? null,
    restartRecoveryDigest: restartRecovery.digest,
    externalWriteStatusDigest: restartRecovery.statusDigest,
    changedSincePrevious: exportReport?.history?.changedSincePrevious ?? false,
    source: {
      programId: kernelCall?.programId ?? null,
      operation: kernelCall?.operation ?? null,
      handoffTarget: handoff.target,
      writeStatus: write.status,
      dispatchStatus: write.dispatchStatus
    },
    replay: {
      required: replay.required,
      safeToReplay: replay.safeToReplay,
      nextAction: replay.nextAction,
      blockers: replay.blockers
    }
  };
}

function buildProviderReplayPlan({ continuation, handoff, write, provider, exportReport }) {
  const required = write.writeRequired === true;
  const persistedStatus = write.persistedStatus ?? {};
  const statusJournal = write.statusJournal ?? {};
  const commandLedger = write.providerCommandLedger ?? {};
  const snapshotReady = Boolean(exportReport?.history?.latest?.digest ?? persistedStatus.snapshotHint);
  const commandId = commandLedger.activeCommandId ?? provider.commandId ?? persistedStatus.commandId ?? null;
  const commandDigest = commandLedger.activeCommandDigest ?? write.persistedCommandDigest ?? persistedStatus.commandDigest ?? null;
  const idempotencyKey = commandLedger.idempotencyKey ?? provider.idempotencyKey ?? persistedStatus.idempotencyKey ?? null;
  const restartToken = continuation.restartToken ?? persistedStatus.restartToken ?? null;
  const journalReady = statusJournal.ready === true || !required;
  const ledgerReady = commandLedger.ready === true || !required;
  const ledgerDuplicateSafe = commandLedger.duplicateSafe === true || !required;
  const ledgerReplayable = commandLedger.replayable === true || (!required && commandLedger.replayable !== false);
  const ledgerDeferred = required && ['held', 'scheduled', 'waiting'].includes(commandLedger.state);
  const blockers = uniqueSorted([
    ...(provider.blockers ?? []),
    ...(statusJournal.blockers ?? []).map((blocker) => `status_journal_${blocker}`),
    ...(commandLedger.blockers ?? []).map((blocker) => `command_ledger_${blocker}`),
    ...(write.boundaryTicket?.ready === false && required ? ['boundary_ticket_not_ready'] : []),
    ...(write.boundaryRecoveryGuard?.ready === false && required ? ['boundary_recovery_guard_not_ready'] : []),
    ...(write.boundaryRecoveryGuard?.retryable === false && required ? ['boundary_recovery_guard_not_retryable'] : []),
    ...(write.boundaryReleaseGate?.ready === false && required ? ['boundary_release_gate_not_ready'] : []),
    ...(write.boundaryReleaseGate?.releaseAllowed !== true && required ? ['boundary_release_gate_not_open'] : []),
    ...(write.boundaryReleaseGate?.restartSemantics?.restartSafe === false && required ? ['boundary_release_gate_not_restart_safe'] : []),
    ...(provider.health?.ready === false && provider.health?.retryable === false && required ? ['provider_health_not_retryable'] : []),
    ...(!commandId && required ? ['missing_provider_command_id'] : []),
    ...(!commandDigest && required ? ['missing_provider_command_digest'] : []),
    ...(!idempotencyKey && required ? ['missing_provider_idempotency_key'] : []),
    ...(!restartToken && handoff.requiresResume ? ['missing_restart_token'] : []),
    ...(!write.statusJournalDigest && required ? ['missing_status_journal_digest'] : []),
    ...(!statusJournal.commands?.length && required ? ['missing_status_journal_command'] : []),
    ...(!commandLedger.commands?.length && required ? ['missing_provider_command_ledger_command'] : []),
    ...(journalReady === false && required ? ['status_journal_not_ready'] : []),
    ...(ledgerReady === false && required ? ['provider_command_ledger_not_ready'] : []),
    ...(ledgerDuplicateSafe === false && required ? ['provider_command_ledger_duplicate_unsafe'] : []),
    ...(ledgerReplayable === false && required && !ledgerDeferred ? ['provider_command_ledger_not_replayable'] : []),
    ...(write.replaySafe === false && required ? ['provider_command_not_replay_safe'] : [])
  ]);
  const state = !required
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : !snapshotReady
        ? 'waiting_for_snapshot'
        : provider.status === 'deferred' || ledgerDeferred
          ? 'deferred'
          : 'ready';
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.provider-replay`,
    required,
    state,
    provider: provider.provider,
    commandId,
    commandDigest,
    idempotencyKey,
    restartToken,
    checkpointHash: continuation.checkpointHash,
    snapshotDigest: exportReport?.history?.latest?.digest ?? persistedStatus.snapshotHint ?? null,
    statusJournalDigest: write.statusJournalDigest ?? null,
    statusJournalState: write.statusJournalState,
    statusJournalRestartPolicy: write.statusJournalRestartPolicy,
    statusJournalCommandIds: (statusJournal.commands ?? []).map((command) => command.commandId).filter(Boolean),
    commandLedgerDigest: commandLedger.digest ?? null,
    commandLedgerState: commandLedger.state ?? 'unknown',
    commandLedgerKey: commandLedger.ledgerKey ?? null,
    commandLedgerReplayMode: commandLedger.replayMode ?? null,
    commandLedgerRestartPolicy: commandLedger.restartPolicy ?? null,
    commandLedgerEntryCount: commandLedger.entries?.length ?? 0,
    commandLedgerCommandIds: (commandLedger.commands ?? []).map((command) => command.commandId).filter(Boolean),
    boundaryReleaseGate: {
      state: write.boundaryReleaseGate?.state ?? 'unknown',
      ready: write.boundaryReleaseGate?.ready === true || !required,
      releaseAllowed: write.boundaryReleaseGate?.releaseAllowed === true || !required,
      gateDigest: write.boundaryReleaseGate?.gateDigest ?? null,
      commandId: write.boundaryReleaseGate?.command?.commandId ?? null,
      restartSafe: write.boundaryReleaseGate?.restartSemantics?.restartSafe === true || !required,
      replayPolicy: write.boundaryReleaseGate?.replayPolicy ?? null,
      nextAction: write.boundaryReleaseGate?.nextAction ?? null
    },
    commandLedgerDuplicateSafe: commandLedger.duplicateSafe === true,
    commandLedgerReplayable: commandLedger.replayable === true,
    boundaryAuditDigest: write.boundaryTicket?.auditDigest ?? persistedStatus.boundaryTicket?.auditDigest ?? null,
    boundaryGuardDigest: write.boundaryRecoveryGuard?.guardDigest ?? null,
    boundaryReplayPolicy: write.boundaryRecoveryGuard?.replayPolicy ?? null,
    safeToReplay: required && state === 'ready' && ledgerReplayable,
    providerHealth: {
      status: provider.health?.status ?? 'unknown',
      retryable: provider.health?.retryable ?? true,
      retryAfterMs: provider.health?.retryAfterMs ?? null
    },
    blockers,
    nextAction: state === 'blocked'
      ? providerActionForBlocker(blockers[0])
      : state === 'waiting_for_snapshot'
        ? 'wait_for_export_snapshot'
      : state === 'deferred'
          ? commandLedger.nextAction ?? provider.nextAction
          : required
            ? commandLedger.replayMode === 'reuse_existing_provider_command'
              ? 'reuse_existing_provider_command'
              : 'persist_replayable_provider_command'
            : 'continue_without_provider_replay'
  };
}

function buildExternalHandoffState({ continuation, handoff, write, provider, replay }) {
  const state = provider.status === 'blocked'
    ? 'blocked'
    : write.dispatchStatus === 'held'
      ? 'held'
      : write.dispatchStatus === 'scheduled'
        ? 'scheduled'
        : provider.status === 'degraded'
          ? 'degraded'
        : provider.status === 'ready' && replay.state === 'ready'
          ? 'ready'
          : 'waiting';
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.external-handoff`,
    state,
    requiresResume: handoff.requiresResume,
    continuationMode: handoff.continuationMode,
    restartToken: continuation.restartToken,
    statusChannel: provider.statusChannel,
    idempotencyKey: provider.idempotencyKey,
    commandId: replay.commandId,
    providerHealth: {
      status: provider.health?.status ?? 'unknown',
      degraded: provider.health?.degraded ?? false,
      retryable: provider.health?.retryable ?? true,
      retryAfterMs: provider.health?.retryAfterMs ?? null
    },
    lifecycleControl: {
      state: provider.lifecycleControl?.state ?? write.lifecycleControls?.state ?? 'unknown',
      ready: provider.lifecycleControl?.ready ?? write.lifecycleControls?.ready ?? false,
      userVisibleStatus: provider.lifecycleControl?.userVisibleStatus ?? write.lifecycleControls?.userVisibleStatus ?? null,
      nextAction: provider.lifecycleControl?.nextAction ?? write.lifecycleControls?.nextAction ?? null,
      digest: provider.lifecycleControl?.digest ?? write.lifecycleControls?.digest ?? null
    },
    providerService: {
      state: provider.serviceContract?.state ?? write.providerServiceContract?.state ?? 'unknown',
      ready: provider.serviceContract?.ready ?? write.providerServiceContract?.ready ?? false,
      externalStateKey: provider.serviceContract?.externalStateKey ?? write.providerServiceContract?.sync?.externalStateKey ?? null,
      checkpointDigest: provider.serviceContract?.checkpointDigest ?? write.providerServiceContract?.sync?.checkpointDigest ?? null,
      digest: provider.serviceContract?.digest ?? write.providerServiceContract?.digest ?? null,
      nextAction: provider.serviceContract?.nextAction ?? write.providerServiceContract?.nextAction ?? null
    },
    boundaryRecoveryGuard: {
      state: provider.boundaryRecoveryGuard?.state ?? write.boundaryRecoveryGuard?.state ?? 'unknown',
      ready: provider.boundaryRecoveryGuard?.ready ?? write.boundaryRecoveryGuard?.ready ?? false,
      retryable: provider.boundaryRecoveryGuard?.retryable ?? write.boundaryRecoveryGuard?.retryable ?? false,
      guardDigest: provider.boundaryRecoveryGuard?.guardDigest ?? write.boundaryRecoveryGuard?.guardDigest ?? null,
      replayPolicy: provider.boundaryRecoveryGuard?.replayPolicy ?? write.boundaryRecoveryGuard?.replayPolicy ?? null,
      nextAction: provider.boundaryRecoveryGuard?.nextAction ?? write.boundaryRecoveryGuard?.nextAction ?? null
    },
    replayState: replay.state,
    nextAction: state === 'blocked'
      ? provider.nextAction
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
        : state === 'degraded'
            ? provider.health?.nextAction ?? 'handoff_with_provider_degraded_ack'
        : state === 'ready'
            ? 'publish_provider_recovery_state'
            : replay.nextAction ?? 'hold_provider_sync_until_export_ready'
  };
}

function buildRecoveryAcceptanceHandoff({ continuation, handoff, write, provider, replay, externalHandoff, restartRecovery, persistedClientState, exportReport }) {
  const packet = write.acceptancePacket ?? {};
  const operatorDecision = write.operatorDecision ?? {};
  const blockers = uniqueSorted([
    ...(packet.blockers ?? []),
    ...(operatorDecision.blockers ?? []).map((blocker) => `operator_decision_${blocker}`),
    ...(provider.blockers ?? []),
    ...(replay.blockers ?? []),
    ...(restartRecovery.blockers ?? []),
    ...(persistedClientState.blockers ?? []).map((blocker) => `client_${blocker}`),
    ...(write.boundaryTicket?.ready === false && write.writeRequired ? ['boundary_ticket_not_ready'] : []),
    ...(write.boundaryRecoveryGuard?.ready === false && write.writeRequired ? ['boundary_recovery_guard_not_ready'] : []),
    ...(write.writeRequired && !operatorDecision.digest ? ['missing_operator_decision_digest'] : []),
    ...(write.writeRequired && operatorDecision.state === 'blocked' ? ['operator_decision_blocked'] : []),
    ...(externalHandoff.state === 'blocked' ? ['external_handoff_blocked'] : []),
    ...(!continuation.restartToken && handoff.requiresResume ? ['missing_restart_token'] : []),
    ...(!exportReport?.history?.latest?.digest && write.writeRequired ? ['missing_export_snapshot'] : [])
  ]);
  const requiredAcknowledgements = uniqueSorted([
    ...(packet.requiredAcknowledgements ?? []),
    ...(operatorDecision.acknowledgement?.requiredAcknowledgements ?? [])
  ]);
  const missingAcknowledgements = uniqueSorted([
    ...(packet.missingAcknowledgements ?? []),
    ...(operatorDecision.acknowledgement?.missingAcknowledgements ?? [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : !write.writeRequired
      ? 'not_required'
      : packet.acceptanceState === 'pending_acknowledgement' || operatorDecision.state === 'pending_acknowledgement' || missingAcknowledgements.length
        ? 'pending_acknowledgement'
        : externalHandoff.state === 'held'
          ? 'held'
          : externalHandoff.state === 'scheduled'
            ? 'scheduled'
            : packet.acceptEnabled && replay.state === 'ready'
              ? 'ready'
              : 'waiting';
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.acceptance-handoff`,
    state,
    ready: state === 'ready',
    writeRequired: write.writeRequired,
    acceptanceState: packet.acceptanceState ?? 'unknown',
    operatorDecisionState: operatorDecision.state ?? 'unknown',
    readinessState: packet.readinessState ?? 'unknown',
    acceptEnabled: packet.acceptEnabled === true && (operatorDecision.ready === true || !write.writeRequired),
    requiredAcknowledgements,
    missingAcknowledgements,
    commandId: replay.commandId ?? write.commandId ?? packet.commandId ?? null,
    idempotencyKey: replay.idempotencyKey ?? provider.idempotencyKey ?? packet.idempotencyKey ?? null,
    statusChannel: provider.statusChannel ?? packet.statusChannel ?? null,
    restartToken: continuation.restartToken,
    snapshotDigest: exportReport?.history?.latest?.digest ?? replay.snapshotDigest ?? null,
    restartRecovery: {
      state: restartRecovery.state,
      ready: restartRecovery.ready,
      digest: restartRecovery.digest,
      statusDigest: restartRecovery.statusDigest
    },
    persistedClientState: {
      state: persistedClientState.state,
      ready: persistedClientState.ready,
      digest: persistedClientState.digest,
      userVisibleStatus: persistedClientState.userVisibleStatus?.current ?? null
    },
    boundaryTicket: {
      state: write.boundaryTicket?.state ?? 'unknown',
      ready: write.boundaryTicket?.ready === true,
      auditDigest: write.boundaryTicket?.auditDigest ?? null,
      nextAction: write.boundaryTicket?.nextAction ?? null
    },
    boundaryRecoveryGuard: {
      state: write.boundaryRecoveryGuard?.state ?? 'unknown',
      ready: write.boundaryRecoveryGuard?.ready === true,
      retryable: write.boundaryRecoveryGuard?.retryable !== false,
      guardDigest: write.boundaryRecoveryGuard?.guardDigest ?? null,
      replayPolicy: write.boundaryRecoveryGuard?.replayPolicy ?? null,
      nextAction: write.boundaryRecoveryGuard?.nextAction ?? null
    },
    operatorDecision: {
      source: write.operatorDecisionSource ?? 'unknown',
      state: operatorDecision.state ?? 'unknown',
      ready: operatorDecision.ready === true,
      presentationMode: operatorDecision.presentationMode ?? null,
      primaryCommand: operatorDecision.primaryCommand ?? null,
      commandId: operatorDecision.command?.commandId ?? null,
      idempotencyKey: operatorDecision.command?.idempotencyKey ?? null,
      acknowledgementToken: operatorDecision.acknowledgement?.token ?? null,
      digest: operatorDecision.digest ?? null,
      restartSafe: operatorDecision.restartSemantics?.restartSafe === true || !write.writeRequired,
      nextAction: operatorDecision.nextAction ?? null
    },
    blockers,
    nextAction: state === 'blocked'
      ? recoveryAcceptanceAction(blockers[0])
      : state === 'pending_acknowledgement'
        ? operatorDecision.nextAction ?? 'collect_operator_acknowledgement'
        : state === 'held'
          ? 'await_manual_release'
          : state === 'scheduled'
            ? 'wait_for_schedule_window'
            : state === 'ready'
              ? 'publish_recovery_acceptance_handoff'
              : replay.nextAction ?? packet.nextAction ?? 'wait_for_recovery_acceptance'
  };
}

function buildRecoveryExportContinuity({
  kernelCall,
  continuation,
  handoff,
  write,
  provider,
  replay,
  externalHandoff,
  restartRecovery,
  persistedClientState,
  acceptanceHandoff,
  exportReport
}) {
  const writeRequired = write.writeRequired === true;
  const ledger = write.exportLedger ?? {};
  const snapshotDigest = exportReport?.history?.latest?.digest ?? replay.snapshotDigest ?? restartRecovery.exportSnapshotDigest ?? null;
  const ledgerDigest = ledger.digest ?? write.persistedStatusDigest ?? restartRecovery.statusDigest ?? null;
  const restartToken = restartRecovery.restartToken ?? continuation.restartToken ?? persistedClientState.restartToken ?? null;
  const checkpoints = [
    {
      phase: 'external_write_ledger',
      state: ledger.state ?? write.exportLedgerState ?? 'unknown',
      digest: ledgerDigest,
      ready: ledger.ready === true || !writeRequired
    },
    {
      phase: 'provider_replay',
      state: replay.state,
      digest: replay.snapshotDigest ?? null,
      ready: replay.state === 'ready' || !writeRequired
    },
    {
      phase: 'restart_recovery',
      state: restartRecovery.state,
      digest: restartRecovery.digest ?? null,
      ready: restartRecovery.ready === true || !writeRequired
    },
    {
      phase: 'client_runtime_state',
      state: persistedClientState.state,
      digest: persistedClientState.digest ?? null,
      ready: persistedClientState.ready === true || !writeRequired
    },
    {
      phase: 'acceptance_handoff',
      state: acceptanceHandoff.state,
      digest: acceptanceHandoff.snapshotDigest ?? null,
      ready: acceptanceHandoff.ready === true || !writeRequired
    }
  ];
  const blockers = uniqueSorted([
    ...(ledger.blockers ?? []).map((blocker) => `ledger_${blocker}`),
    ...(replay.blockers ?? []).map((blocker) => `replay_${blocker}`),
    ...(restartRecovery.blockers ?? []).map((blocker) => `restart_${blocker}`),
    ...(persistedClientState.blockers ?? []).map((blocker) => `client_${blocker}`),
    ...(acceptanceHandoff.blockers ?? []).map((blocker) => `acceptance_${blocker}`),
    ...(externalHandoff.state === 'blocked' ? ['external_handoff_blocked'] : []),
    ...(!ledgerDigest && writeRequired ? ['missing_external_write_ledger_digest'] : []),
    ...(!snapshotDigest && writeRequired ? ['missing_export_snapshot_digest'] : []),
    ...(!restartToken && handoff.requiresResume ? ['missing_export_restart_token'] : []),
    ...(provider.health?.ready === false && provider.health?.retryable === false && writeRequired ? ['provider_health_not_retryable'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : externalHandoff.state === 'held'
        ? 'held'
        : externalHandoff.state === 'scheduled'
          ? 'scheduled'
          : checkpoints.every((checkpoint) => checkpoint.ready)
            ? 'ready'
            : 'waiting';
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ledgerDigest,
    snapshotDigest,
    restartToken,
    continuationGeneration: continuation.generation,
    commandId: replay.commandId ?? provider.commandId ?? null
  };
  const digest = stableHash(digestShape);
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.export-continuity`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    ledgerDigest,
    snapshotDigest,
    restartToken,
    statusChannel: provider.statusChannel ?? handoff.statusChannel ?? null,
    idempotencyKey: provider.idempotencyKey ?? handoff.idempotencyKey ?? null,
    commandId: replay.commandId ?? provider.commandId ?? null,
    changedSinceExternalLedger: Boolean(ledgerDigest && digest !== ledgerDigest),
    timeline: checkpoints,
    counters: {
      checkpointCount: checkpoints.length,
      readyCheckpointCount: checkpoints.filter((checkpoint) => checkpoint.ready).length,
      blockerCount: blockers.length,
      writeRequiredCount: writeRequired ? 1 : 0
    },
    userVisibleStatus: {
      current: persistedClientState.userVisibleStatus?.current ?? ledger.userVisibleStatus?.current ?? exportContinuityStatus(state),
      completion: persistedClientState.userVisibleStatus?.completion ?? ledger.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: persistedClientState.userVisibleStatus?.failure ?? ledger.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    blockers,
    nextAction: state === 'blocked'
      ? exportContinuityAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'publish_recovery_export_continuity'
            : writeRequired
              ? acceptanceHandoff.nextAction ?? replay.nextAction ?? 'wait_for_recovery_export_continuity'
              : 'continue_read_only',
    digest
  };
}

function buildRecoveryReadinessPreview({
  kernelCall,
  continuation,
  handoff,
  write,
  provider,
  replay,
  externalHandoff,
  restartRecovery,
  persistedClientState,
  acceptanceHandoff,
  exportContinuity,
  exportReport
}) {
  const writeRequired = write.writeRequired === true;
  const externalReadiness = write.operatorReadiness ?? {};
  const acceptancePreview = write.acceptancePreview ?? {};
  const acceptanceCheckpointBundle = write.acceptanceCheckpointBundle ?? {};
  const operatorDecision = write.operatorDecision ?? {};
  const operatorHandoffManifest = write.operatorHandoffManifest ?? {};
  const operatorLifecycleAction = persistedClientState.operatorLifecycleAction ?? write.operatorLifecycleAction ?? {};
  const operatorDecisionSource = write.operatorDecisionSource ?? 'unknown';
  const rootOperatorDecisionReady = operatorDecisionSource === 'external_write_root'
    && Boolean(operatorDecision.digest)
    && (operatorDecision.restartSemantics?.restartSafe === true || !writeRequired);
  const lifecycleDecision = normalizeRecoveryLifecycleDecision(externalReadiness.lifecycleDecision);
  const phaseChecks = [
    {
      phase: 'external_write_acceptance_preview',
      state: acceptancePreview.state ?? 'unknown',
      ready: acceptancePreview.ready === true || !writeRequired,
      action: acceptancePreview.primaryAction ?? 'prepare_external_write_acceptance_preview',
      blockers: [
        ...(acceptancePreview.blockers ?? []),
        ...(writeRequired && acceptancePreview.renderable !== true ? ['acceptance_preview_not_renderable'] : []),
        ...(writeRequired && !acceptancePreview.digest ? ['acceptance_preview_digest_missing'] : []),
        ...(writeRequired && acceptancePreview.validationSummary?.restartSafe !== true ? ['acceptance_preview_not_restart_safe'] : [])
      ],
      warnings: [
        ...(acceptancePreview.warnings ?? []),
        ...(writeRequired && acceptancePreview.validationSummary?.releaseAllowed === false ? ['acceptance_preview_release_not_allowed'] : [])
      ]
    },
    {
      phase: 'acceptance_checkpoint_bundle',
      state: acceptanceCheckpointBundle.state ?? 'unknown',
      ready: acceptanceCheckpointBundle.ready === true || !writeRequired,
      action: acceptanceCheckpointBundle.nextAction ?? 'publish_acceptance_checkpoint_bundle',
      blockers: [
        ...(acceptanceCheckpointBundle.blockers ?? []),
        ...(writeRequired && acceptanceCheckpointBundle.restartSafe !== true ? ['acceptance_checkpoint_not_restart_safe'] : []),
        ...(writeRequired && acceptanceCheckpointBundle.aligned !== true ? ['acceptance_checkpoint_not_aligned'] : [])
      ],
      warnings: acceptanceCheckpointBundle.warnings ?? []
    },
    {
      phase: 'operator_handoff_manifest',
      state: operatorHandoffManifest.state ?? 'unknown',
      ready: operatorHandoffManifest.ready === true || !writeRequired,
      action: operatorHandoffManifest.primaryAction ?? 'publish_operator_handoff_manifest',
      blockers: operatorHandoffManifest.blockers ?? [],
      warnings: operatorHandoffManifest.warnings ?? []
    },
    {
      phase: 'external_write_operator_decision',
      state: operatorDecision.state ?? 'unknown',
      ready: rootOperatorDecisionReady || operatorDecision.ready === true || operatorHandoffManifest.ready === true || !writeRequired,
      action: operatorDecision.nextAction ?? operatorDecision.primaryCommand ?? operatorHandoffManifest.primaryAction ?? 'publish_external_write_operator_decision',
      blockers: [
        ...(operatorDecision.blockers ?? []),
        ...(writeRequired && !operatorDecision.digest ? ['operator_decision_digest_missing'] : [])
      ],
      warnings: [
        ...(operatorDecision.warnings ?? []),
        ...(writeRequired && operatorDecisionSource !== 'external_write_root' ? [`operator_decision_source_${operatorDecisionSource}`] : []),
        ...(writeRequired && operatorDecision.restartSemantics?.restartSafe === false ? ['operator_decision_not_restart_safe'] : [])
      ]
    },
    {
      phase: 'lifecycle_operator_decision',
      state: lifecycleDecision.state,
      ready: lifecycleDecision.ready || !writeRequired,
      action: lifecycleDecision.nextAction ?? 'review_lifecycle_operator_decision',
      blockers: lifecycleDecision.blockers,
      warnings: lifecycleDecision.warnings
    },
    {
      phase: 'operator_lifecycle_action',
      state: operatorLifecycleAction.state ?? 'unknown',
      ready: operatorLifecycleAction.ready === true || !writeRequired,
      action: operatorLifecycleAction.nextAction ?? 'persist_operator_lifecycle_action',
      blockers: [
        ...(operatorLifecycleAction.blockers ?? []),
        ...(writeRequired && !operatorLifecycleAction.digest ? ['operator_lifecycle_action_digest_missing'] : []),
        ...(writeRequired && operatorLifecycleAction.restartSafe === false ? ['operator_lifecycle_action_not_restart_safe'] : []),
        ...(operatorLifecycleAction.requiresAcknowledgement && !operatorLifecycleAction.acknowledgementToken ? ['operator_lifecycle_acknowledgement_missing'] : [])
      ],
      warnings: operatorLifecycleAction.warnings ?? []
    },
    {
      phase: 'external_write_readiness',
      state: externalReadiness.state ?? write.status,
      ready: externalReadiness.ready === true || !writeRequired,
      action: externalReadiness.primaryAction ?? write.nextAction ?? 'resolve_external_write_before_recovery',
      blockers: externalReadiness.blockers ?? write.blockedReasons ?? [],
      warnings: externalReadiness.warnings ?? []
    },
    {
      phase: 'boundary_decision_receipt',
      state: write.boundaryDecisionReceipt?.state ?? 'unknown',
      ready: write.boundaryDecisionReceipt?.ready === true || !writeRequired,
      action: write.boundaryDecisionReceipt?.nextAction ?? 'publish_boundary_decision_receipt',
      blockers: [
        ...(write.boundaryDecisionReceipt?.blockers ?? []),
        ...(writeRequired && write.boundaryDecisionReceipt?.release?.allowed === false ? ['boundary_release_not_allowed'] : [])
      ],
      warnings: write.boundaryDecisionReceipt?.warnings ?? []
    },
    {
      phase: 'provider_recovery',
      state: provider.status,
      ready: provider.status === 'ready' || !writeRequired,
      action: provider.nextAction,
      blockers: provider.blockers ?? [],
      warnings: provider.health?.degraded ? ['provider_health_degraded'] : []
    },
    {
      phase: 'provider_session',
      state: provider.serviceContract?.providerSession?.state ?? write.providerServiceContract?.providerSession?.state ?? 'unknown',
      ready: provider.serviceContract?.providerSession?.ready === true || !writeRequired,
      action: provider.serviceContract?.providerSession?.nextAction ?? write.providerServiceContract?.providerSession?.nextAction ?? 'persist_mailchimp_provider_session',
      blockers: provider.serviceContract?.providerSession?.blockers ?? write.providerServiceContract?.providerSession?.blockers ?? [],
      warnings: provider.serviceContract?.providerSession?.renewalRequired || write.providerServiceContract?.providerSession?.renewalRequired ? ['provider_session_renewal_required'] : []
    },
    {
      phase: 'provider_replay',
      state: replay.state,
      ready: replay.state === 'ready' || !writeRequired,
      action: replay.nextAction,
      blockers: replay.blockers ?? [],
      warnings: replay.state === 'waiting_for_snapshot' ? ['replay_waiting_for_snapshot'] : []
    },
    {
      phase: 'restart_recovery',
      state: restartRecovery.state,
      ready: restartRecovery.ready === true || !writeRequired,
      action: restartRecovery.nextAction,
      blockers: restartRecovery.blockers ?? [],
      warnings: restartRecovery.resume?.safeToResume === false ? ['restart_token_missing'] : []
    },
    {
      phase: 'persisted_client_state',
      state: persistedClientState.state,
      ready: persistedClientState.ready === true || !writeRequired,
      action: persistedClientState.nextAction,
      blockers: persistedClientState.blockers ?? [],
      warnings: []
    },
    {
      phase: 'acceptance_handoff',
      state: acceptanceHandoff.state,
      ready: acceptanceHandoff.ready === true || !writeRequired,
      action: acceptanceHandoff.nextAction,
      blockers: acceptanceHandoff.blockers ?? [],
      warnings: acceptanceHandoff.missingAcknowledgements?.length ? ['acceptance_acknowledgement_missing'] : []
    },
    {
      phase: 'export_continuity',
      state: exportContinuity.state,
      ready: exportContinuity.ready === true || !writeRequired,
      action: exportContinuity.nextAction,
      blockers: exportContinuity.blockers ?? [],
      warnings: exportContinuity.changedSinceExternalLedger ? ['export_continuity_changed_since_external_ledger'] : []
    }
  ];
  const blockers = uniqueSorted(phaseChecks.flatMap((check) => (
    check.ready ? [] : check.blockers.length ? check.blockers.map((blocker) => `${check.phase}_${blocker}`) : [`${check.phase}_not_ready`]
  )));
  const warnings = uniqueSorted([
    ...phaseChecks.flatMap((check) => check.warnings.map((warning) => `${check.phase}_${warning}`)),
    ...(externalHandoff.state === 'degraded' ? ['external_handoff_degraded'] : []),
    ...(exportReport?.analytics?.exportReady === true ? [] : writeRequired ? ['export_snapshot_not_ready'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : externalHandoff.state === 'held'
        ? 'held'
        : externalHandoff.state === 'scheduled'
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : 'ready';
  const nextSteps = phaseChecks
    .filter((check) => check.ready !== true || check.warnings.length)
    .map((check, index) => ({
      index,
      phase: check.phase,
      state: check.state,
      action: check.ready ? recoveryPreviewWarningAction(check.warnings[0]) : check.action,
      reason: check.ready ? check.warnings[0] ?? 'review_recommended' : check.blockers[0] ?? `${check.phase}_not_ready`,
      terminal: false
    }));
  if (!nextSteps.length) {
    nextSteps.push({
      index: 0,
      phase: writeRequired ? 'recovery_readiness' : 'read_only',
      state,
      action: writeRequired ? 'publish_recovery_readiness_preview' : 'continue_read_only',
      reason: writeRequired ? 'recovery_ready_for_operator_confirmation' : 'external_write_not_requested',
      terminal: true
    });
  }
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    restartRecoveryDigest: restartRecovery.digest ?? null,
    persistedClientDigest: persistedClientState.digest ?? null,
    exportContinuityDigest: exportContinuity.digest ?? null,
    externalReadinessDigest: externalReadiness.digest ?? null,
    acceptancePreviewDigest: acceptancePreview.digest ?? null,
    acceptanceCheckpointDigest: acceptanceCheckpointBundle.digest ?? null,
    operatorHandoffDigest: operatorHandoffManifest.digest ?? null,
    operatorDecisionDigest: operatorDecision.digest ?? null,
    operatorDecisionSource,
    operatorLifecycleDigest: operatorLifecycleAction.digest ?? null,
    rootOperatorDecisionReady,
    lifecycleDecisionDigest: lifecycleDecision.digest ?? null,
    checkpointHash: continuation.checkpointHash,
    restartToken: continuation.restartToken ?? null,
    blockers,
    warnings
  };
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.readiness-preview`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    userVisibleStatus: recoveryPreviewStatus(state),
    primaryAction: state === 'blocked'
      ? recoveryPreviewAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? nextSteps[0]?.action ?? 'confirm_recovery_readiness'
            : writeRequired
              ? 'publish_recovery_readiness_preview'
              : 'continue_read_only',
    statusChannel: provider.statusChannel ?? handoff.statusChannel ?? null,
    idempotencyKey: provider.idempotencyKey ?? handoff.idempotencyKey ?? null,
    commandId: replay.commandId ?? provider.commandId ?? operatorHandoffManifest.command?.commandId ?? null,
    restartToken: restartRecovery.restartToken ?? continuation.restartToken ?? null,
    snapshotDigest: exportContinuity.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null,
    externalReadinessDigest: externalReadiness.digest ?? null,
    acceptancePreview: {
      state: acceptancePreview.state ?? 'unknown',
      ready: acceptancePreview.ready === true || !writeRequired,
      renderable: acceptancePreview.renderable === true || !writeRequired,
      presentationMode: acceptancePreview.presentationMode ?? null,
      primaryAction: acceptancePreview.primaryAction ?? null,
      commandId: acceptancePreview.command?.commandId ?? null,
      statusChannel: acceptancePreview.command?.statusChannel ?? acceptancePreview.route?.statusChannel ?? null,
      userVisibleStatus: acceptancePreview.userVisibleStatus?.current ?? null,
      validationOk: acceptancePreview.validationSummary?.ok === true || !writeRequired,
      restartSafe: acceptancePreview.validationSummary?.restartSafe === true || !writeRequired,
      releaseAllowed: acceptancePreview.validationSummary?.releaseAllowed !== false,
      digest: acceptancePreview.digest ?? null,
      nextStepCount: acceptancePreview.nextSteps?.length ?? 0,
      blockers: acceptancePreview.blockers ?? [],
      warnings: acceptancePreview.warnings ?? []
    },
    acceptanceCheckpointBundle: {
      state: acceptanceCheckpointBundle.state ?? 'unknown',
      ready: acceptanceCheckpointBundle.ready === true || !writeRequired,
      aligned: acceptanceCheckpointBundle.aligned === true || !writeRequired,
      restartSafe: acceptanceCheckpointBundle.restartSafe === true || !writeRequired,
      digest: acceptanceCheckpointBundle.digest ?? null,
      commandId: acceptanceCheckpointBundle.commandId ?? null,
      checkpointCount: acceptanceCheckpointBundle.checkpoints?.length ?? 0,
      nextAction: acceptanceCheckpointBundle.nextAction ?? null,
      blockers: acceptanceCheckpointBundle.blockers ?? [],
      warnings: acceptanceCheckpointBundle.warnings ?? []
    },
    operatorHandoffManifest: {
      state: operatorHandoffManifest.state ?? 'unknown',
      ready: operatorHandoffManifest.ready === true || !writeRequired,
      presentationMode: operatorHandoffManifest.presentationMode ?? null,
      primaryAction: operatorHandoffManifest.primaryAction ?? null,
      commandId: operatorHandoffManifest.command?.commandId ?? null,
      statusChannel: operatorHandoffManifest.statusChannel ?? null,
      restartSafe: operatorHandoffManifest.restartSemantics?.restartSafe ?? false,
      digest: operatorHandoffManifest.digest ?? null
    },
    operatorDecision: {
      source: operatorDecisionSource,
      state: operatorDecision.state ?? 'unknown',
      ready: rootOperatorDecisionReady || operatorDecision.ready === true || operatorHandoffManifest.ready === true || !writeRequired,
      presentationMode: operatorDecision.presentationMode ?? operatorHandoffManifest.presentationMode ?? null,
      primaryCommand: operatorDecision.primaryCommand ?? operatorHandoffManifest.primaryAction ?? null,
      commandId: operatorDecision.command?.commandId ?? operatorHandoffManifest.command?.commandId ?? null,
      acknowledgementToken: operatorDecision.acknowledgement?.token ?? null,
      restartSafe: operatorDecision.restartSemantics?.restartSafe === true || !writeRequired,
      digest: operatorDecision.digest ?? operatorHandoffManifest.digest ?? null
    },
    lifecycleDecision,
    operatorLifecycleAction: {
      state: operatorLifecycleAction.state ?? 'unknown',
      ready: operatorLifecycleAction.ready === true || !writeRequired,
      action: operatorLifecycleAction.action ?? null,
      digest: operatorLifecycleAction.digest ?? null,
      selectedCommandId: operatorLifecycleAction.selectedCommandId ?? null,
      requestedState: operatorLifecycleAction.requestedState ?? null,
      requiresAcknowledgement: operatorLifecycleAction.requiresAcknowledgement === true,
      acknowledgementToken: operatorLifecycleAction.acknowledgementToken ?? null,
      restartSafe: operatorLifecycleAction.restartSafe === true || !writeRequired,
      statusChannel: operatorLifecycleAction.statusChannel ?? provider.statusChannel ?? handoff.statusChannel ?? null,
      idempotencyKey: operatorLifecycleAction.idempotencyKey ?? provider.idempotencyKey ?? handoff.idempotencyKey ?? null,
      commandCount: operatorLifecycleAction.commandCount ?? operatorLifecycleAction.commandIds?.length ?? operatorLifecycleAction.commands?.length ?? 0,
      nextAction: operatorLifecycleAction.nextAction ?? null,
      blockers: operatorLifecycleAction.blockers ?? [],
      warnings: operatorLifecycleAction.warnings ?? []
    },
    restartRecoveryDigest: restartRecovery.digest ?? null,
    persistedClientDigest: persistedClientState.digest ?? null,
    exportContinuityDigest: exportContinuity.digest ?? null,
    userMessages: {
      current: exportContinuity.userVisibleStatus?.current ?? persistedClientState.userVisibleStatus?.current ?? recoveryPreviewStatus(state),
      completion: exportContinuity.userVisibleStatus?.completion ?? persistedClientState.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: exportContinuity.userVisibleStatus?.failure ?? persistedClientState.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    phaseChecks,
    nextSteps,
    blockers,
    warnings,
    digest: stableHash(digestShape)
  };
}

function validateRecoveryReadinessPreview(preview, write) {
  if (!write?.writeRequired && !preview) return [];
  const diagnostics = [];
  if (!preview) return [{ level: 'error', code: 'recovery_missing_readiness_preview' }];
  if (write?.writeRequired && preview.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_not_write_required' });
  }
  if (preview.ready && preview.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_readiness_preview_ready_with_blockers',
      blockers: preview.blockers
    });
  }
  if (preview.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_blocked', blockers: preview.blockers ?? [] });
  }
  if (preview.ready && write?.writeRequired && !preview.commandId) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_command_id' });
  }
  if (write?.writeRequired && !preview.acceptanceCheckpointBundle?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_acceptance_checkpoint_bundle' });
  }
  if (write?.writeRequired && !preview.acceptancePreview?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_acceptance_preview' });
  }
  if (write?.writeRequired && preview.acceptancePreview?.renderable !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_acceptance_preview_not_renderable' });
  }
  if (preview.ready && write?.writeRequired && preview.acceptancePreview?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_acceptance_preview_not_restart_safe' });
  }
  if (preview.acceptancePreview?.validationOk === false && write?.writeRequired) {
    diagnostics.push({
      level: preview.acceptancePreview?.blockers?.length ? 'error' : 'warning',
      code: 'recovery_readiness_preview_acceptance_preview_validation_failed',
      blockers: preview.acceptancePreview?.blockers ?? []
    });
  }
  if (write?.writeRequired && preview.acceptanceCheckpointBundle?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_acceptance_checkpoint_not_restart_safe' });
  }
  if (write?.writeRequired && preview.acceptanceCheckpointBundle?.aligned !== true) {
    diagnostics.push({ level: 'warning', code: 'recovery_readiness_preview_acceptance_checkpoint_not_aligned' });
  }
  if (preview.ready && write?.writeRequired && !preview.restartRecoveryDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_restart_digest' });
  }
  if (preview.ready && write?.writeRequired && !preview.exportContinuityDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_export_digest' });
  }
  if (preview.lifecycleDecision?.requiresAcknowledgement && !preview.lifecycleDecision?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_lifecycle_acknowledgement' });
  }
  if (write?.writeRequired && !preview.operatorLifecycleAction?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_operator_lifecycle_action' });
  }
  if (preview.ready && write?.writeRequired && preview.operatorLifecycleAction?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_operator_lifecycle_not_restart_safe' });
  }
  if (preview.operatorLifecycleAction?.requiresAcknowledgement && !preview.operatorLifecycleAction?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_operator_lifecycle_ack_missing' });
  }
  if (preview.operatorLifecycleAction?.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_operator_lifecycle_blocked' });
  }
  if (write?.writeRequired && !preview.operatorDecision?.digest && !preview.operatorHandoffManifest?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_operator_decision' });
  }
  if (preview.ready && write?.writeRequired && preview.operatorDecision?.restartSafe === false) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_operator_decision_not_restart_safe' });
  }
  if (write?.writeRequired && preview.operatorDecision?.source && preview.operatorDecision.source !== 'external_write_root') {
    diagnostics.push({
      level: 'warning',
      code: 'recovery_readiness_preview_operator_decision_fallback',
      source: preview.operatorDecision.source
    });
  }
  if (write?.writeRequired && preview.operatorHandoffManifest?.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_operator_handoff_blocked' });
  }
  if (preview.ready && write?.writeRequired && preview.operatorHandoffManifest?.restartSafe === false) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_operator_handoff_not_restart_safe' });
  }
  if (preview.operatorDecision?.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_operator_decision_blocked' });
  }
  if (preview.state === 'review' || preview.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'recovery_readiness_preview_review', warnings: preview.warnings ?? [] });
  }
  return diagnostics;
}

function normalizeRecoveryLifecycleDecision(decision = {}) {
  const state = decision?.state ?? 'unknown';
  const blockers = state === 'blocked'
    ? decision?.blockers?.length ? decision.blockers : ['lifecycle_operator_decision_blocked']
    : [];
  const warnings = uniqueSorted([
    ...(decision?.warnings ?? []),
    ...(decision?.requiresAcknowledgement ? ['lifecycle_acknowledgement_required'] : [])
  ]);
  return {
    state,
    ready: ['ready', 'not_required'].includes(state) || (!decision?.requiresAcknowledgement && state !== 'blocked'),
    selectedCommand: decision?.selectedCommand ?? null,
    selectedCommandId: decision?.selectedCommandId ?? null,
    requiresAcknowledgement: decision?.requiresAcknowledgement === true,
    acknowledgementToken: decision?.acknowledgementToken ?? null,
    acknowledgementReason: decision?.acknowledgementReason ?? null,
    scheduleStatus: decision?.scheduleStatus ?? null,
    blockers,
    warnings,
    nextAction: decision?.nextAction ?? null,
    digest: decision?.digest ?? null
  };
}

function recoveryPreviewStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    review: 'ready_with_warnings',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function recoveryPreviewAction(blocker) {
  if (String(blocker).includes('external_write_readiness')) return 'resolve_external_write_before_recovery';
  if (String(blocker).includes('boundary_decision')) return 'publish_boundary_decision_receipt';
  if (String(blocker).includes('boundary_release')) return 'repair_boundary_release_decision';
  if (String(blocker).includes('provider_recovery')) return 'resolve_provider_contract';
  if (String(blocker).includes('provider_replay')) return 'persist_replayable_provider_command';
  if (String(blocker).includes('restart_recovery')) return 'repair_restart_recovery_checkpoint';
  if (String(blocker).includes('persisted_client')) return 'repair_persisted_client_runtime_state';
  if (String(blocker).includes('acceptance')) return 'collect_operator_acknowledgement';
  if (String(blocker).includes('export_continuity')) return 'publish_recovery_export_continuity';
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  return providerActionForBlocker(blocker);
}

function recoveryPreviewWarningAction(warning) {
  if (String(warning).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(warning).includes('acknowledgement')) return 'collect_operator_acknowledgement';
  if (String(warning).includes('restart')) return 'persist_restart_token';
  if (String(warning).includes('provider')) return 'handoff_with_provider_degraded_ack';
  if (String(warning).includes('export')) return 'publish_recovery_export_continuity';
  return 'confirm_recovery_readiness';
}

function validateRecoveryExportContinuity(continuity, write) {
  if (!write?.writeRequired && !continuity) return [];
  const diagnostics = [];
  if (!continuity) return [{ level: 'error', code: 'recovery_missing_export_continuity' }];
  if (write?.writeRequired && continuity.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_export_continuity_not_write_required' });
  }
  if (continuity.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_export_continuity_blocked', blockers: continuity.blockers ?? [] });
  }
  if (continuity.ready && write?.writeRequired && !continuity.ledgerDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_export_continuity_missing_ledger_digest' });
  }
  if (continuity.ready && write?.writeRequired && !continuity.snapshotDigest) {
    diagnostics.push({ level: 'warning', code: 'recovery_export_continuity_missing_snapshot_digest' });
  }
  return diagnostics;
}

function exportContinuityStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'recovering_export_continuity',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function exportContinuityAction(blocker) {
  if (String(blocker).includes('ledger')) return 'repair_external_write_export_ledger';
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('restart')) return 'persist_restart_token';
  if (String(blocker).includes('client')) return 'persist_client_runtime_handoff';
  if (String(blocker).includes('acceptance')) return 'collect_operator_acknowledgement';
  if (String(blocker).includes('handoff')) return 'repair_external_handoff';
  return providerActionForBlocker(blocker);
}

function validateRecoveryAcceptanceHandoff(handoff, write) {
  if (!write?.writeRequired && !handoff) return [];
  const diagnostics = [];
  if (!handoff) return [{ level: 'error', code: 'recovery_missing_acceptance_handoff' }];
  if (write?.writeRequired && handoff.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'recovery_acceptance_handoff_not_write_required' });
  }
  if (handoff.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_acceptance_handoff_blocked', blockers: handoff.blockers ?? [] });
  }
  if (handoff.ready && handoff.missingAcknowledgements?.length) {
    diagnostics.push({
      level: 'error',
      code: 'recovery_acceptance_ready_with_missing_acknowledgements',
      missingAcknowledgements: handoff.missingAcknowledgements
    });
  }
  if (handoff.ready && !handoff.commandId && handoff.writeRequired) {
    diagnostics.push({ level: 'error', code: 'recovery_acceptance_missing_command_id' });
  }
  return diagnostics;
}

function recoveryAcceptanceAction(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('acknowledgement')) return 'collect_operator_acknowledgement';
  if (String(blocker).includes('restart')) return 'persist_restart_token';
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('handoff')) return 'repair_external_handoff';
  return providerActionForBlocker(blocker);
}

function providerActionForBlocker(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('provider_denied')) return 'resolve_provider_denied_effect';
  if (String(blocker).includes('provider_missing_effect')) return 'enable_provider_capability';
  if (String(blocker).includes('provider_unavailable')) return 'retry_provider_after_backoff';
  if (String(blocker).includes('provider_health_not_retryable')) return 'resolve_provider_health';
  if (String(blocker).includes('provider_blocked')) return 'resolve_provider_health';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('lifecycle')) return 'repair_lifecycle_controls';
  if (String(blocker).includes('external_write')) return 'resolve_external_write_before_recovery';
  return 'resolve_provider_contract';
}

function recoveryStatusCheckpoint(phase, state, digest, blockers = []) {
  return {
    phase,
    state: state ?? 'unknown',
    digest: digest ?? null,
    ready: !asArray(blockers).length && !['blocked', 'failed'].includes(state),
    blockerCount: asArray(blockers).length
  };
}

function recoveryStatusHandoffUserStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    review: 'ready_with_warnings',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function recoveryStatusHandoffAction(blocker) {
  if (String(blocker).includes('external_status')) return 'publish_external_write_status_handoff';
  if (String(blocker).includes('boundary_decision')) return 'publish_boundary_decision_receipt';
  if (String(blocker).includes('boundary_release')) return 'repair_boundary_release_decision';
  if (String(blocker).includes('restart')) return 'repair_restart_recovery_checkpoint';
  if (String(blocker).includes('client')) return 'repair_persisted_client_runtime_state';
  if (String(blocker).includes('acceptance')) return 'collect_operator_acknowledgement';
  if (String(blocker).includes('export')) return 'publish_recovery_export_continuity';
  if (String(blocker).includes('readiness')) return 'publish_recovery_readiness_preview';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('command_id')) return 'persist_replayable_provider_command';
  return providerActionForBlocker(blocker);
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function stableHash(value) {
  const serialized = JSON.stringify(stableClone(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableClone(nested)])
    );
  }
  return value;
}
