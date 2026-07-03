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
        providerServiceReadyCount: provider.serviceContract?.ready ? 1 : 0,
        providerServiceMissingCapabilityCount: provider.serviceContract?.missingCapabilities?.length ?? 0,
        providerServiceCommandCount: provider.serviceContract?.commandCount ?? 0,
        lifecycleControlReadyCount: provider.lifecycleControl?.ready ? 1 : 0,
        lifecycleControlCommandCount: provider.lifecycleControl?.commandCount ?? write.lifecycleControls?.commands?.length ?? 0,
        lifecycleControlBlockerCount: provider.lifecycleControl?.blockers?.length ?? 0,
        boundaryRecoveryGuardReadyCount: write.boundaryRecoveryGuard?.ready ? 1 : 0,
        boundaryRecoveryGuardBlockerCount: write.boundaryRecoveryGuard?.blockers?.length ?? 0,
        boundaryRecoveryGuardWarningCount: write.boundaryRecoveryGuard?.warnings?.length ?? 0,
        boundaryRecoveryGuardRetryableCount: write.boundaryRecoveryGuard?.retryable ? 1 : 0,
        providerBlockerCount: provider.blockers.length,
        replayCommandCount: replay.required ? 1 : 0,
        replayBlockerCount: replay.blockers.length,
        restartRecoveryReadyCount: restartRecovery.ready ? 1 : 0,
        restartRecoveryBlockerCount: restartRecovery.blockers.length,
        syncReadyCount: sync.ready ? 1 : 0,
        persistedClientStateReadyCount: persistedClientState.ready ? 1 : 0,
        persistedClientStateBlockerCount: persistedClientState.blockers.length,
        persistedClientRequestReadyCount: persistedClientState.clientRequestSnapshot?.ready ? 1 : 0,
        persistedClientRequestCommandCount: persistedClientState.clientRequestSnapshot?.commandCount ?? 0,
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
        statusHandoffWarningCount: statusHandoff.warnings.length
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
      nextAction: report?.provider?.serviceContract?.nextAction ?? report?.externalWrite?.providerServiceContract?.nextAction ?? null
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
    syncReady: report?.sync?.ready ?? false,
    replayState: report?.replay?.state ?? 'unknown',
    replayCommandId: report?.replay?.commandId ?? null,
    externalHandoffState: report?.externalHandoff?.state ?? 'unknown',
    restartRecovery: {
      state: report?.restartRecovery?.state ?? 'unknown',
      ready: report?.restartRecovery?.ready ?? false,
      digest: report?.restartRecovery?.digest ?? null,
      statusDigest: report?.restartRecovery?.statusDigest ?? null,
      statusJournalDigest: report?.restartRecovery?.statusJournalDigest ?? null,
      statusJournalState: report?.restartRecovery?.statusJournalState ?? 'unknown',
      statusJournalRestartPolicy: report?.restartRecovery?.statusJournalRestartPolicy ?? null,
      nextAction: report?.restartRecovery?.nextAction ?? null,
      blockerCount: report?.restartRecovery?.blockers?.length ?? 0
    },
    persistedClientState: {
      state: report?.persistedClientState?.state ?? 'unknown',
      ready: report?.persistedClientState?.ready ?? false,
      clientRequestDigest: report?.persistedClientState?.clientRequestSnapshot?.digest ?? null,
      clientRequestKey: report?.persistedClientState?.clientRequestSnapshot?.requestKey ?? null,
      statusChannel: report?.persistedClientState?.statusChannel ?? null,
      userVisibleStatus: report?.persistedClientState?.userVisibleStatus?.current ?? null,
      nextAction: report?.persistedClientState?.nextAction ?? null,
      blockerCount: report?.persistedClientState?.blockers?.length ?? 0
    },
    acceptanceHandoff: {
      state: report?.acceptanceHandoff?.state ?? 'unknown',
      ready: report?.acceptanceHandoff?.ready ?? false,
      nextAction: report?.acceptanceHandoff?.nextAction ?? null,
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
    analyticsSummary: {
      status: report?.analyticsSummary?.status ?? 'unknown',
      exportReady: report?.analyticsSummary?.exportReady ?? false,
      reportDigest: report?.analyticsSummary?.reportDigest ?? null,
      snapshotCount: report?.analyticsSummary?.historySnapshots?.length ?? 0,
      timelineCount: report?.analyticsSummary?.timeline?.length ?? 0,
      failedPhaseCount: report?.analyticsSummary?.counters?.failedPhaseCount ?? 0,
      degradedPhaseCount: report?.analyticsSummary?.counters?.degradedPhaseCount ?? 0,
      nextAction: report?.analyticsSummary?.nextAction ?? null
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
  if (report?.replay?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'recovery_provider_replay_blocked',
      blockers: report.replay.blockers ?? []
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
  const writeRequired = write.writeRequired === true;
  const checkpoints = [
    recoveryStatusCheckpoint('external_status_handoff', externalStatusHandoff.state, externalStatusHandoff.digest, externalStatusHandoff.blockers),
    recoveryStatusCheckpoint('provider_recovery', provider.status, provider.digest ?? provider.serviceContract?.digest, provider.blockers),
    recoveryStatusCheckpoint('provider_replay', replay.state, replay.commandDigest ?? replay.commandId, replay.blockers),
    recoveryStatusCheckpoint('external_handoff', externalHandoff.state, externalHandoff.digest, externalHandoff.blockers),
    recoveryStatusCheckpoint('restart_recovery', restartRecovery.state, restartRecovery.digest, restartRecovery.blockers),
    recoveryStatusCheckpoint('persisted_client_state', persistedClientState.state, persistedClientState.digest, persistedClientState.blockers),
    recoveryStatusCheckpoint('acceptance_handoff', acceptanceHandoff.state, acceptanceHandoff.digest, acceptanceHandoff.blockers),
    recoveryStatusCheckpoint('export_continuity', exportContinuity.state, exportContinuity.digest, exportContinuity.blockers),
    recoveryStatusCheckpoint('readiness_preview', readinessPreview.state, readinessPreview.digest, readinessPreview.blockers)
  ];
  const blockers = uniqueSorted([
    ...(externalStatusHandoff.blockers ?? []).map((blocker) => `external_status_${blocker}`),
    ...(provider.blockers ?? []).map((blocker) => `provider_${blocker}`),
    ...(replay.blockers ?? []).map((blocker) => `replay_${blocker}`),
    ...(externalHandoff.blockers ?? []).map((blocker) => `external_handoff_${blocker}`),
    ...(restartRecovery.blockers ?? []).map((blocker) => `restart_${blocker}`),
    ...(persistedClientState.blockers ?? []).map((blocker) => `client_${blocker}`),
    ...(acceptanceHandoff.blockers ?? []).map((blocker) => `acceptance_${blocker}`),
    ...(exportContinuity.blockers ?? []).map((blocker) => `export_${blocker}`),
    ...(readinessPreview.blockers ?? []).map((blocker) => `readiness_${blocker}`),
    ...(!externalStatusHandoff.digest && writeRequired ? ['missing_recovery_external_status_handoff_digest'] : []),
    ...(!restartRecovery.digest && writeRequired ? ['missing_recovery_status_handoff_restart_digest'] : []),
    ...(!persistedClientState.digest && writeRequired ? ['missing_recovery_status_handoff_client_digest'] : []),
    ...(!exportContinuity.digest && writeRequired ? ['missing_recovery_status_handoff_export_digest'] : []),
    ...(!handoff.statusChannel && writeRequired ? ['missing_recovery_status_handoff_channel'] : []),
    ...(!replay.commandId && writeRequired ? ['missing_recovery_status_handoff_command_id'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(externalStatusHandoff.warnings ?? []).map((warning) => `external_status_${warning}`),
    ...(provider.health?.degraded ? ['provider_health_degraded'] : []),
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
    restartDigest: restartRecovery.digest ?? null,
    persistedClientDigest: persistedClientState.digest ?? null,
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
    recoveryDigest: stableHash(digestShape),
    statusChannel: handoff.statusChannel ?? externalStatusHandoff.statusChannel ?? null,
    commandId: replay.commandId ?? provider.commandId ?? write.commandId ?? null,
    idempotencyKey: handoff.idempotencyKey ?? externalStatusHandoff.idempotencyKey ?? write.idempotencyKey ?? null,
    restartToken: restartRecovery.restartToken ?? externalStatusHandoff.restartToken ?? continuation.restartToken ?? null,
    snapshotDigest: exportReport?.history?.latest?.digest ?? null,
    persistedClientDigest: persistedClientState.digest ?? null,
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
  return {
    status: report?.status ?? 'unknown',
    writeRequired: report?.writeRequired === true,
    nextAction: report?.nextAction ?? null,
    idempotencyKey: report?.idempotency?.key ?? null,
    commandId: report?.providerCommand?.commandId ?? null,
    commandState: report?.providerCommand?.state ?? null,
    syncReady: report?.sync?.ready === true,
    replaySafe: report?.providerCommand?.replay?.safeToReplay === true,
    blockedReasons: report?.blockedReasons ?? [],
    dispatchStatus: report?.dispatch?.status ?? 'unknown',
    clientRuntimeHandoff,
    clientRequestSnapshot,
    clientRequestDigest: report?.clientRequestSnapshot?.digest ?? null,
    clientRequestKey: report?.clientRequestSnapshot?.requestKey ?? null,
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
    persistedStatus: report?.persistedStatus ? stableClone(report.persistedStatus) : null,
    persistedStatusDigest: report?.persistedStatus?.digest ?? null,
    persistedStatusState: report?.persistedStatus?.state ?? 'unknown',
    persistedCommandDigest: report?.persistedStatus?.commandDigest ?? report?.providerCommand?.replay?.commandDigest ?? null,
    statusJournal: report?.statusJournal ? stableClone(report.statusJournal) : null,
    statusJournalDigest: report?.statusJournal?.digest ?? null,
    statusJournalState: report?.statusJournal?.state ?? 'unknown',
    statusJournalRestartPolicy: report?.statusJournal?.restartSemantics?.onRestart ?? null,
    statusJournalCommandCount: report?.statusJournal?.commands?.length ?? 0,
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
  if (replay.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'recovery_provider_replay_blocked', blockers: replay.blockers });
  }
  if (replay.state === 'waiting_for_snapshot') {
    diagnostics.push({ level: 'warning', code: 'recovery_replay_waiting_for_snapshot' });
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
      phase: 'provider_replay',
      status: replay.state,
      action: replay.nextAction
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
      key: 'client_runtime',
      label: 'Client runtime',
      value: persistedClientState.state,
      action: persistedClientState.nextAction
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
  const nextAction = blockedReasons.length
    ? recoveryAnalyticsAction(blockedReasons[0])
    : lifecycleCommandState.blockers.length
      ? recoveryAnalyticsAction(lifecycleCommandState.blockers[0])
    : failedPhases[0]?.action
      ?? degradedPhases[0]?.action
      ?? (exportReady ? 'publish_recovery_analytics_summary' : readinessPreview.primaryAction);
  const reportDigest = stableHash({
    programId,
    operation,
    status,
    exportReady,
    historySnapshots: historySnapshots.map((snapshot) => snapshot.digest),
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
    lifecycleCommandState,
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
      lifecycleCommandReadyCount: lifecycleCommandState.ready ? 1 : 0,
      lifecycleCommandBlockerCount: lifecycleCommandState.blockers.length,
      lifecycleCommandWarningCount: lifecycleCommandState.warnings.length
    },
    historySnapshots,
    timeline: normalizedTimeline,
    reportRows,
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
  const commands = uniqueSorted([
    ...(card.primaryAction ? [card.primaryAction] : []),
    ...(card.secondaryActions ?? []),
    ...(provider.nextAction ? [provider.nextAction] : []),
    ...(replay.nextAction ? [replay.nextAction] : []),
    ...(readinessPreview.primaryAction ? [readinessPreview.primaryAction] : [])
  ]);
  const blockers = uniqueSorted([
    ...(write.writeRequired && !card.digest ? ['missing_external_write_operator_action_card'] : []),
    ...(write.writeRequired && !card.commandId ? ['operator_action_card_missing_command_id'] : []),
    ...(card.ready === false && card.blockers?.length ? card.blockers.map((blocker) => `operator_action_card_${blocker}`) : []),
    ...(recoveryStatus === 'blocked' ? ['recovery_status_blocked'] : []),
    ...(write.writeRequired && !commands.length ? ['missing_lifecycle_recovery_command'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(card.warnings ?? []).map((warning) => `operator_action_card_${warning}`),
    ...(readinessPreview.warnings ?? []).map((warning) => `readiness_${warning}`),
    ...(exportReady ? [] : ['recovery_export_not_ready'])
  ]);
  const state = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'review'
      : write.writeRequired
        ? 'ready'
        : 'not_required';
  const selectedCommand = blockers.length
    ? recoveryAnalyticsAction(blockers[0])
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
    commandIds: commands.map((action) => `recovery-command:${stableHash({ action, commandId: card.commandId, status: recoveryStatus })}`),
    commands: commands.map((action) => ({
      action,
      commandId: `recovery-command:${stableHash({ action, commandId: card.commandId, status: recoveryStatus })}`,
      statusChannel: provider.statusChannel ?? write.statusHandoff?.statusChannel ?? null,
      idempotencyKey: provider.idempotencyKey ?? write.idempotencyKey ?? null,
      source: action === card.primaryAction ? 'external_write_operator_action_card' : 'recovery_analysis'
    })),
    operatorActionCardDigest: card.digest ?? null,
    providerCommandId: provider.commandId ?? replay.commandId ?? card.commandId ?? null,
    nextAction: selectedCommand,
    blockers,
    warnings,
    digest: stableHash({
      state,
      commands,
      cardDigest: card.digest ?? null,
      providerCommandId: provider.commandId ?? replay.commandId ?? card.commandId ?? null,
      blockers,
      warnings
    })
  };
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
  if (summary.counters?.failedPhaseCount > 0) {
    diagnostics.push({ level: 'error', code: 'recovery_analytics_failed_phases', failedPhaseCount: summary.counters.failedPhaseCount });
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
  if (String(blocker).includes('persisted_client')) return 'repair_persisted_client_runtime_state';
  if (String(blocker).includes('export')) return 'publish_recovery_export_continuity';
  if (String(blocker).includes('acceptance')) return 'collect_operator_acknowledgement';
  if (String(blocker).includes('external_write')) return 'resolve_external_write_before_recovery';
  return 'operator_review';
}

function nextRecoveryAction({ status, blockedReasons, write, continuation, kernelCall, provider, externalHandoff, replay, acceptanceHandoff, readinessPreview }) {
  if (blockedReasons.includes('recovery_provider_contract_blocked')) return provider.nextAction;
  if (blockedReasons.includes('recovery_provider_replay_blocked')) return replay.nextAction;
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
  const writeRequired = write.writeRequired === true;
  const persistedStatus = write.persistedStatus ?? {};
  const statusJournal = write.statusJournal ?? {};
  const commandId = replay.commandId ?? provider.commandId ?? persistedStatus.commandId ?? handoffSnapshot.providerCommand?.commandId ?? write.commandId ?? null;
  const idempotencyKey = replay.idempotencyKey ?? provider.idempotencyKey ?? persistedStatus.idempotencyKey ?? handoffSnapshot.idempotencyKey ?? handoff.idempotencyKey ?? null;
  const statusChannel = provider.statusChannel ?? persistedStatus.statusChannel ?? handoffSnapshot.statusChannel ?? handoff.statusChannel ?? null;
  const restartToken = restartRecovery.restartToken ?? replay.restartToken ?? continuation.restartToken ?? persistedStatus.restartToken ?? handoffSnapshot.resume?.restartToken ?? null;
  const snapshotDigest = exportReport?.history?.latest?.digest ?? restartRecovery.exportSnapshotDigest ?? replay.snapshotDigest ?? persistedStatus.snapshotHint ?? null;
  const clientRequestDigest = requestSnapshot.digest ?? persistedStatus.clientRequestDigest ?? null;
  const clientRequestKey = requestSnapshot.requestKey ?? persistedStatus.clientRequestKey ?? null;
  const blockers = uniqueSorted([
    ...(handoffSnapshot.blockers ?? []),
    ...(requestSnapshot.blockers ?? []).map((blocker) => `client_request_${blocker}`),
    ...(persistedStatus.blockers ?? []),
    ...(statusJournal.blockers ?? []).map((blocker) => `status_journal_${blocker}`),
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
    ...(!clientRequestDigest && writeRequired ? ['missing_client_request_digest'] : []),
    ...(!clientRequestKey && writeRequired ? ['missing_client_request_key'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : !writeRequired
      ? 'not_required'
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
    clientRequestDigest,
    clientRequestKey,
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
  const writeRequired = write.writeRequired === true;
  const commandId = persistedStatus.commandId ?? replay.commandId ?? provider.commandId ?? write.commandId ?? null;
  const idempotencyKey = persistedStatus.idempotencyKey ?? replay.idempotencyKey ?? provider.idempotencyKey ?? handoff.idempotencyKey ?? null;
  const statusChannel = persistedStatus.statusChannel ?? provider.statusChannel ?? handoff.statusChannel ?? null;
  const restartToken = persistedStatus.restartToken ?? replay.restartToken ?? continuation.restartToken ?? null;
  const exportSnapshotDigest = exportReport?.history?.latest?.digest ?? replay.snapshotDigest ?? null;
  const statusDigest = persistedStatus.digest ?? null;
  const journalDigest = write.statusJournalDigest ?? statusJournal.digest ?? null;
  const journalRestartSafe = statusJournal.restartSemantics?.restartSafe === true || !writeRequired;
  const clientRequestDigest = write.clientRequestDigest ?? write.clientRequestSnapshot?.digest ?? persistedStatus.clientRequestDigest ?? null;
  const clientRequestKey = write.clientRequestKey ?? write.clientRequestSnapshot?.requestKey ?? persistedStatus.clientRequestKey ?? null;
  const blockers = uniqueSorted([
    ...(persistedStatus.blockers ?? []),
    ...(statusJournal.blockers ?? []).map((blocker) => `status_journal_${blocker}`),
    ...(!commandId && writeRequired ? ['missing_restart_command_id'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_restart_idempotency_key'] : []),
    ...(!statusChannel && writeRequired ? ['missing_restart_status_channel'] : []),
    ...(!statusDigest && writeRequired ? ['missing_restart_status_digest'] : []),
    ...(!journalDigest && writeRequired ? ['missing_restart_status_journal_digest'] : []),
    ...(journalRestartSafe === false ? ['status_journal_not_restart_safe'] : []),
    ...(!clientRequestDigest && writeRequired ? ['missing_restart_client_request_digest'] : []),
    ...(!clientRequestKey && writeRequired ? ['missing_restart_client_request_key'] : []),
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
    idempotencyKey,
    statusChannel,
    restartToken,
    statusDigest,
    journalDigest,
    clientRequestDigest,
    clientRequestKey,
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
    clientRequestDigest,
    clientRequestKey,
    exportSnapshotDigest,
    persistedStatusState: persistedStatus.state ?? 'unknown',
    continuationGeneration: continuation.generation,
    replaySafe: replay.safeToReplay === true || persistedStatus.replay?.safeToReplay === true,
    journalRestartSafe,
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
  if (plan.ready && write?.writeRequired && !plan.clientRequestSnapshot?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_missing_client_request_digest' });
  }
  if (write?.writeRequired && plan.journalRestartSafe === false) {
    diagnostics.push({ level: 'error', code: 'recovery_restart_plan_status_journal_not_restart_safe' });
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
  if (state.ready && write?.writeRequired && !state.clientRequestSnapshot?.digest) {
    diagnostics.push({ level: 'error', code: 'recovery_persisted_client_state_missing_client_request_digest' });
  }
  return diagnostics;
}

function persistedClientStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
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
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('client_request')) return 'persist_client_request_snapshot';
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
    ...(write.writeRequired && providerService.ready === false ? ['provider_service_contract_not_ready'] : []),
    ...(write.boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(write.boundaryTicket?.ready === false && write.writeRequired ? ['boundary_ticket_not_ready'] : []),
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
  const snapshotReady = Boolean(exportReport?.history?.latest?.digest ?? persistedStatus.snapshotHint);
  const commandId = provider.commandId ?? persistedStatus.commandId ?? null;
  const idempotencyKey = provider.idempotencyKey ?? persistedStatus.idempotencyKey ?? null;
  const restartToken = continuation.restartToken ?? persistedStatus.restartToken ?? null;
  const journalReady = statusJournal.ready === true || !required;
  const blockers = uniqueSorted([
    ...(provider.blockers ?? []),
    ...(statusJournal.blockers ?? []).map((blocker) => `status_journal_${blocker}`),
    ...(write.boundaryTicket?.ready === false && required ? ['boundary_ticket_not_ready'] : []),
    ...(write.boundaryRecoveryGuard?.ready === false && required ? ['boundary_recovery_guard_not_ready'] : []),
    ...(write.boundaryRecoveryGuard?.retryable === false && required ? ['boundary_recovery_guard_not_retryable'] : []),
    ...(provider.health?.ready === false && provider.health?.retryable === false && required ? ['provider_health_not_retryable'] : []),
    ...(!commandId && required ? ['missing_provider_command_id'] : []),
    ...(!idempotencyKey && required ? ['missing_provider_idempotency_key'] : []),
    ...(!restartToken && handoff.requiresResume ? ['missing_restart_token'] : []),
    ...(!write.statusJournalDigest && required ? ['missing_status_journal_digest'] : []),
    ...(!statusJournal.commands?.length && required ? ['missing_status_journal_command'] : []),
    ...(journalReady === false && required ? ['status_journal_not_ready'] : []),
    ...(write.replaySafe === false && required ? ['provider_command_not_replay_safe'] : [])
  ]);
  const state = !required
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : !snapshotReady
        ? 'waiting_for_snapshot'
        : provider.status === 'deferred'
          ? 'deferred'
          : 'ready';
  return {
    schemaVersion: `${RECOVERY_ANALYSIS_VERSION}.provider-replay`,
    required,
    state,
    provider: provider.provider,
    commandId,
    idempotencyKey,
    restartToken,
    checkpointHash: continuation.checkpointHash,
    snapshotDigest: exportReport?.history?.latest?.digest ?? persistedStatus.snapshotHint ?? null,
    statusJournalDigest: write.statusJournalDigest ?? null,
    statusJournalState: write.statusJournalState,
    statusJournalRestartPolicy: write.statusJournalRestartPolicy,
    statusJournalCommandIds: (statusJournal.commands ?? []).map((command) => command.commandId).filter(Boolean),
    boundaryAuditDigest: write.boundaryTicket?.auditDigest ?? persistedStatus.boundaryTicket?.auditDigest ?? null,
    boundaryGuardDigest: write.boundaryRecoveryGuard?.guardDigest ?? null,
    boundaryReplayPolicy: write.boundaryRecoveryGuard?.replayPolicy ?? null,
    safeToReplay: required && state === 'ready',
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
          ? provider.nextAction
          : required
            ? 'persist_replayable_provider_command'
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
  const blockers = uniqueSorted([
    ...(packet.blockers ?? []),
    ...(provider.blockers ?? []),
    ...(replay.blockers ?? []),
    ...(restartRecovery.blockers ?? []),
    ...(persistedClientState.blockers ?? []).map((blocker) => `client_${blocker}`),
    ...(write.boundaryTicket?.ready === false && write.writeRequired ? ['boundary_ticket_not_ready'] : []),
    ...(write.boundaryRecoveryGuard?.ready === false && write.writeRequired ? ['boundary_recovery_guard_not_ready'] : []),
    ...(externalHandoff.state === 'blocked' ? ['external_handoff_blocked'] : []),
    ...(!continuation.restartToken && handoff.requiresResume ? ['missing_restart_token'] : []),
    ...(!exportReport?.history?.latest?.digest && write.writeRequired ? ['missing_export_snapshot'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : !write.writeRequired
      ? 'not_required'
      : packet.acceptanceState === 'pending_acknowledgement'
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
    readinessState: packet.readinessState ?? 'unknown',
    acceptEnabled: packet.acceptEnabled === true,
    requiredAcknowledgements: packet.requiredAcknowledgements ?? [],
    missingAcknowledgements: packet.missingAcknowledgements ?? [],
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
    blockers,
    nextAction: state === 'blocked'
      ? recoveryAcceptanceAction(blockers[0])
      : state === 'pending_acknowledgement'
        ? 'collect_operator_acknowledgement'
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
  const lifecycleDecision = normalizeRecoveryLifecycleDecision(externalReadiness.lifecycleDecision);
  const phaseChecks = [
    {
      phase: 'lifecycle_operator_decision',
      state: lifecycleDecision.state,
      ready: lifecycleDecision.ready || !writeRequired,
      action: lifecycleDecision.nextAction ?? 'review_lifecycle_operator_decision',
      blockers: lifecycleDecision.blockers,
      warnings: lifecycleDecision.warnings
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
      phase: 'provider_recovery',
      state: provider.status,
      ready: provider.status === 'ready' || !writeRequired,
      action: provider.nextAction,
      blockers: provider.blockers ?? [],
      warnings: provider.health?.degraded ? ['provider_health_degraded'] : []
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
    commandId: replay.commandId ?? provider.commandId ?? null,
    restartToken: restartRecovery.restartToken ?? continuation.restartToken ?? null,
    snapshotDigest: exportContinuity.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null,
    externalReadinessDigest: externalReadiness.digest ?? null,
    lifecycleDecision,
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
  if (preview.ready && write?.writeRequired && !preview.restartRecoveryDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_restart_digest' });
  }
  if (preview.ready && write?.writeRequired && !preview.exportContinuityDigest) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_export_digest' });
  }
  if (preview.lifecycleDecision?.requiresAcknowledgement && !preview.lifecycleDecision?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'recovery_readiness_preview_missing_lifecycle_acknowledgement' });
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
