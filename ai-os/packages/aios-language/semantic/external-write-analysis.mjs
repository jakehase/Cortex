export const EXTERNAL_WRITE_ANALYSIS_VERSION = 'aios.external-write-analysis.v1';

const WRITE_EFFECT_PATTERN = /(^|[.:_-])write($|[.:_-])|(^|[.:_-])(create|update|delete|send|publish|sync|upsert)($|[.:_-])/i;

export function analyzeExternalWriteContract({
  programId,
  operation,
  requestedEffects = [],
  runtimePolicy = {},
  permissionBoundary = {},
  kernelCall = null,
  scope = {},
  input = {},
  claims = {},
  lifecycle = null
} = {}) {
  const effects = normalizeEffects([
    ...requestedEffects,
    ...(runtimePolicy.allowedEffects ?? []),
    ...(permissionBoundary.permissions?.allowedEffects ?? [])
  ]);
  const deniedEffects = normalizeDeniedEffects([
    ...(runtimePolicy.deniedEffects ?? []),
    ...(permissionBoundary.permissions?.deniedEffects ?? []),
    ...(kernelCall?.capabilities?.deniedEffects ?? [])
  ]).filter((effect) => isExternalWriteEffect(effect.effect));
  const writeEffects = effects.filter((effect) => isExternalWriteEffect(effect));
  const verifierClaims = kernelCall?.verifier?.claims ?? [];
  const truthBoundaries = kernelCall?.truth?.boundaries ?? [];
  const idempotencyKey = kernelCall?.handoff?.idempotencyKey
    ?? stableWriteKey({ programId, operation, scope, input, writeEffects });
  const claimCoverage = buildClaimCoverage({ verifierClaims, claims, truthBoundaries });
  const route = buildWriteRoute({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    adapter: kernelCall?.adapter ?? runtimePolicy.adapter ?? 'mailchimp',
    scope,
    idempotencyKey
  });
  const lifecycleGate = normalizeLifecycleGate(lifecycle ?? kernelCall?.lifecycle);
  const lifecycleControls = buildLifecycleControlManifest({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    lifecycle: lifecycle ?? kernelCall?.lifecycle,
    lifecycleGate,
    scope,
    writeEffects,
    kernelCall
  });
  const providerHealth = normalizeProviderHealth(kernelCall?.provider, {
    adapter: kernelCall?.adapter ?? runtimePolicy.adapter ?? 'mailchimp',
    statusChannel: route.statusChannel,
    idempotencyKey,
    writeEffects
  });
  const providerServiceContract = buildMailchimpProviderServiceContract({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    provider: {
      ...(runtimePolicy.provider ?? {}),
      ...(kernelCall?.provider ?? {})
    },
    route,
    writeEffects,
    deniedEffects,
    scope,
    lifecycleGate,
    providerHealth,
    kernelCall
  });
  const boundaryTicket = buildTenantBoundaryTicket({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    scope,
    route,
    permissionBoundary,
    kernelCall,
    lifecycleGate,
    writeEffects
  });
  const boundaryAuditHandoff = buildBoundaryAuditHandoff({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    boundaryTicket,
    permissionBoundary,
    kernelCall,
    writeEffects
  });
  const boundaryRecoveryGuard = buildBoundaryRecoveryGuard({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    boundaryTicket,
    boundaryAuditHandoff,
    kernelCall,
    writeEffects
  });
  const dispatch = buildWriteDispatchPlan({
    statusChannel: route.statusChannel,
    auditChannel: route.auditChannel,
    idempotencyKey,
    lifecycleGate,
    writeEffects,
    providerHealth,
    providerServiceContract
  });
  const providerCommand = buildMailchimpProviderCommand({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    dispatch,
    lifecycleGate,
    writeEffects,
    scope,
    input,
    claimCoverage,
    boundaryTicket,
    boundaryAuditHandoff,
    providerHealth,
    providerServiceContract
  });
  const syncMetadata = buildWriteSyncMetadata({
    route,
    dispatch,
    providerCommand,
    lifecycleGate,
    kernelCall,
    providerHealth,
    providerServiceContract
  });
  const clientRuntimeHandoff = buildClientRuntimeHandoff({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    dispatch,
    providerCommand,
    syncMetadata,
    lifecycleGate,
    kernelCall,
    writeEffects,
    claimCoverage,
    boundaryTicket,
    boundaryAuditHandoff,
    providerHealth
  });
  const clientRequestSnapshot = buildClientRequestSnapshot({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    dispatch,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    lifecycleGate,
    writeEffects,
    claimCoverage,
    boundaryTicket,
    boundaryAuditHandoff,
    providerHealth,
    kernelCall,
    input
  });
  const baseDiagnostics = [
    ...validateWriteEffects(writeEffects, deniedEffects),
    ...validateWriteScope(scope),
    ...validateIdempotency(idempotencyKey),
    ...validateClaimCoverage(claimCoverage, writeEffects),
    ...validateLifecycleGate(lifecycleGate, writeEffects),
    ...validateLifecycleControlManifest(lifecycleControls, writeEffects),
    ...validateProviderHealth(providerHealth, writeEffects),
    ...validateProviderServiceContract(providerServiceContract, writeEffects),
    ...validateTenantBoundaryTicket(boundaryTicket, writeEffects),
    ...validateBoundaryAuditHandoff(boundaryAuditHandoff, writeEffects),
    ...validateBoundaryRecoveryGuard(boundaryRecoveryGuard, writeEffects),
    ...validateProviderCommand(providerCommand, writeEffects),
    ...validateClientRuntimeHandoff(clientRuntimeHandoff, writeEffects),
    ...validateClientRequestSnapshot(clientRequestSnapshot, writeEffects)
  ];
  const baseBlockedReasons = baseDiagnostics
    .filter((diagnostic) => diagnostic.level === 'error')
    .map((diagnostic) => diagnostic.code);
  const status = writeEffects.length === 0
    ? 'read_only'
    : baseBlockedReasons.length
      ? 'blocked'
      : baseDiagnostics.some((diagnostic) => diagnostic.level === 'warning')
        ? 'review'
        : 'ready';
  const acceptancePacket = buildExternalWriteAcceptancePacket({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    deniedEffects,
    route,
    lifecycleGate,
    dispatch,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    claimCoverage,
    boundaryTicket,
    boundaryAuditHandoff,
    providerHealth,
    kernelCall
  });
  const persistedStatus = buildPersistedExternalWriteStatus({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    lifecycleGate,
    dispatch,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    acceptancePacket,
    boundaryTicket,
    boundaryAuditHandoff,
    providerHealth,
    kernelCall
  });
  const statusJournal = buildExternalWriteStatusJournal({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    lifecycleGate,
    dispatch,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    acceptancePacket,
    persistedStatus,
    boundaryTicket,
    boundaryAuditHandoff,
    providerHealth,
    kernelCall
  });
  const exportLedger = buildExternalWriteExportLedger({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    lifecycleGate,
    providerHealth,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    acceptancePacket,
    persistedStatus,
    boundaryTicket,
    boundaryAuditHandoff,
    kernelCall
  });
  const replayManifest = buildExternalWriteReplayManifest({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    acceptancePacket,
    persistedStatus,
    exportLedger,
    boundaryTicket,
    boundaryAuditHandoff,
    providerHealth,
    kernelCall
  });
  const operatorReadiness = buildExternalWriteOperatorReadiness({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    lifecycleGate,
    dispatch,
    providerHealth,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    acceptancePacket,
    persistedStatus,
    exportLedger,
    replayManifest,
    boundaryTicket,
    boundaryAuditHandoff,
    kernelCall
  });
  const operationalHealth = buildExternalWriteOperationalHealth({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    lifecycleGate,
    providerHealth,
    providerCommand,
    persistedStatus,
    exportLedger,
    replayManifest,
    operatorReadiness,
    diagnostics: baseDiagnostics,
    kernelCall
  });
  const analyticsExport = buildExternalWriteAnalyticsExport({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    deniedEffects,
    route,
    lifecycleGate,
    providerHealth,
    dispatch,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    acceptancePacket,
    persistedStatus,
    exportLedger,
    replayManifest,
    operatorReadiness,
    operationalHealth,
    boundaryTicket,
    boundaryAuditHandoff,
    claimCoverage,
    diagnostics: baseDiagnostics,
    kernelCall
  });
  const statusHandoff = buildExternalWriteStatusHandoff({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    lifecycleGate,
    providerHealth,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    persistedStatus,
    statusJournal,
    exportLedger,
    replayManifest,
    operatorReadiness,
    operationalHealth,
    analyticsExport,
    boundaryTicket,
    boundaryAuditHandoff,
    boundaryRecoveryGuard,
    kernelCall
  });
  const diagnostics = [
    ...baseDiagnostics,
    ...validateExternalWriteAcceptancePacket(acceptancePacket, writeEffects),
    ...validatePersistedExternalWriteStatus(persistedStatus, writeEffects),
    ...validateExternalWriteStatusJournal(statusJournal, writeEffects),
    ...validateExternalWriteExportLedger(exportLedger, writeEffects),
    ...validateExternalWriteReplayManifest(replayManifest, writeEffects),
    ...validateExternalWriteOperatorReadiness(operatorReadiness, writeEffects),
    ...validateExternalWriteOperationalHealth(operationalHealth, writeEffects),
    ...validateExternalWriteAnalyticsExport(analyticsExport, writeEffects),
    ...validateExternalWriteStatusHandoff(statusHandoff, writeEffects)
  ];
  const blockedReasons = diagnostics
    .filter((diagnostic) => diagnostic.level === 'error')
    .map((diagnostic) => diagnostic.code);

  return {
    ok: blockedReasons.length === 0,
    report: {
      kind: 'ExternalWriteAnalysis',
      version: EXTERNAL_WRITE_ANALYSIS_VERSION,
      programId: programId ?? kernelCall?.programId ?? null,
      operation: operation ?? kernelCall?.operation ?? null,
      status,
      writeRequired: writeEffects.length > 0,
      writeEffects,
      deniedEffects,
      route,
      boundaryTicket,
      boundaryAuditHandoff,
      boundaryRecoveryGuard,
      lifecycleGate,
      lifecycleControls,
      providerHealth,
      providerServiceContract,
      dispatch,
      providerCommand,
      sync: syncMetadata,
      clientRuntimeHandoff,
      clientRequestSnapshot,
      acceptancePacket,
      persistedStatus,
      statusJournal,
      exportLedger,
      replayManifest,
      operatorReadiness,
      operationalHealth,
      analyticsExport,
      statusHandoff,
      idempotency: {
        key: idempotencyKey,
        source: kernelCall?.handoff?.idempotencyKey ? 'kernel_handoff' : 'derived_from_write_shape',
        stable: Boolean(idempotencyKey)
      },
      claims: claimCoverage,
      scope: normalizeScope(scope),
      counters: {
        requestedEffectCount: normalizeEffects(requestedEffects).length,
        writeEffectCount: writeEffects.length,
        deniedEffectCount: deniedEffects.length,
        missingClaimCount: claimCoverage.missing.length,
        lifecycleGateBlockerCount: lifecycleGate.blockers.length,
        lifecycleGateWarningCount: lifecycleGate.warnings.length,
        lifecycleControlReadyCount: lifecycleControls.ready ? 1 : 0,
        lifecycleControlAvailableCount: lifecycleControls.controls.filter((control) => control.available).length,
        lifecycleControlCommandCount: lifecycleControls.commands.length,
        lifecycleControlBlockerCount: lifecycleControls.blockers.length,
        lifecycleControlWarningCount: lifecycleControls.warnings.length,
        providerHealthReadyCount: providerHealth.ready ? 1 : 0,
        providerHealthBlockerCount: providerHealth.blockers.length,
        providerHealthWarningCount: providerHealth.warnings.length,
        providerHealthRetryableCount: providerHealth.retryable ? 1 : 0,
        providerCapabilityRequiredCount: providerServiceContract.requiredCapabilities.length,
        providerCapabilityAcceptedCount: providerServiceContract.acceptedCapabilities.length,
        providerCapabilityMissingCount: providerServiceContract.missingCapabilities.length,
        providerServiceReadyCount: providerServiceContract.ready ? 1 : 0,
        providerServiceCommandCount: providerServiceContract.commands.length,
        boundaryTicketReadyCount: boundaryTicket.ready ? 1 : 0,
        boundaryTicketBlockerCount: boundaryTicket.blockers.length,
        boundaryTicketWarningCount: boundaryTicket.warnings.length,
        boundaryAuditReadyCount: boundaryAuditHandoff.ready ? 1 : 0,
        boundaryAuditCommandCount: boundaryAuditHandoff.commands.length,
        boundaryAuditEscalationCount: boundaryAuditHandoff.escalations.length,
        boundaryAuditScopeMismatchCount: boundaryAuditHandoff.scopeChecks.filter((check) => check.state !== 'matched').length,
        boundaryRecoveryGuardReadyCount: boundaryRecoveryGuard.ready ? 1 : 0,
        boundaryRecoveryGuardBlockerCount: boundaryRecoveryGuard.blockers.length,
        boundaryRecoveryGuardWarningCount: boundaryRecoveryGuard.warnings.length,
        boundaryRecoveryGuardCommandCount: boundaryRecoveryGuard.commands.length,
        boundaryRecoveryGuardRetryableCount: boundaryRecoveryGuard.retryable ? 1 : 0,
        observedTruthBoundaryCount: claimCoverage.truthBoundaries.filter((boundary) => boundary.status === 'observed').length,
        providerCommandCount: providerCommand.required ? 1 : 0,
        providerCommandBlockerCount: providerCommand.blockers.length,
        syncReadyCount: syncMetadata.ready ? 1 : 0,
        clientRuntimeHandoffReadyCount: clientRuntimeHandoff.ready ? 1 : 0,
        clientRuntimeHandoffBlockerCount: clientRuntimeHandoff.blockers.length,
        clientRequestSnapshotReadyCount: clientRequestSnapshot.ready ? 1 : 0,
        clientRequestSnapshotBlockerCount: clientRequestSnapshot.blockers.length,
        clientRequestSnapshotCommandCount: clientRequestSnapshot.commands.length,
        previewNextStepCount: acceptancePacket.nextSteps.length,
        acceptanceBlockerCount: acceptancePacket.blockers.length,
        acceptanceWarningCount: acceptancePacket.warnings.length,
        persistedStatusReadyCount: persistedStatus.ready ? 1 : 0,
        persistedStatusBlockerCount: persistedStatus.blockers.length,
        statusJournalReadyCount: statusJournal.ready ? 1 : 0,
        statusJournalCheckpointCount: statusJournal.checkpoints.length,
        statusJournalCommandCount: statusJournal.commands.length,
        statusJournalBlockerCount: statusJournal.blockers.length,
        exportLedgerReadyCount: exportLedger.ready ? 1 : 0,
        exportLedgerCheckpointCount: exportLedger.timeline.length,
        exportLedgerBlockerCount: exportLedger.blockers.length,
        exportLedgerWarningCount: exportLedger.warnings.length,
        exportLedgerChangedCount: exportLedger.changedSinceKernelSnapshot ? 1 : 0,
        replayManifestReadyCount: replayManifest.ready ? 1 : 0,
        replayManifestCommandCount: replayManifest.commands.length,
        replayManifestBlockerCount: replayManifest.blockers.length,
        replayManifestRestartSafeCount: replayManifest.restartSafe ? 1 : 0,
        operatorReadinessReadyCount: operatorReadiness.ready ? 1 : 0,
        operatorReadinessBlockerCount: operatorReadiness.blockers.length,
        operatorReadinessWarningCount: operatorReadiness.warnings.length,
        operatorReadinessStepCount: operatorReadiness.nextSteps.length,
        operationalHealthFailureCount: operationalHealth.failureState === 'failed' ? 1 : 0,
        operationalHealthDegradedCount: operationalHealth.degraded ? 1 : 0,
        operationalHealthRetryScheduledCount: operationalHealth.retry.scheduled ? 1 : 0,
        operationalHealthActionableErrorCount: operationalHealth.actionableErrors.length,
        analyticsExportReadyCount: analyticsExport.ready ? 1 : 0,
        analyticsExportSnapshotCount: analyticsExport.historySnapshots.length,
        analyticsExportTimelineEventCount: analyticsExport.timeline.length,
        analyticsExportFailedPhaseCount: analyticsExport.counters.failedPhaseCount,
        analyticsExportDegradedPhaseCount: analyticsExport.counters.degradedPhaseCount,
        statusHandoffReadyCount: statusHandoff.ready ? 1 : 0,
        statusHandoffCheckpointCount: statusHandoff.checkpoints.length,
        statusHandoffBlockerCount: statusHandoff.blockers.length,
        statusHandoffWarningCount: statusHandoff.warnings.length
      },
      blockedReasons,
      nextAction: operationalHealth.nextAction ?? nextWriteAction({ status, writeEffects, blockedReasons, lifecycleGate, providerCommand })
    },
    diagnostics
  };
}

export function summarizeExternalWriteAnalysis(report) {
  return {
    status: report?.status ?? 'unknown',
    writeRequired: report?.writeRequired ?? false,
    writeEffects: report?.writeEffects ?? [],
    deniedEffects: (report?.deniedEffects ?? []).map((effect) => effect.effect ?? effect),
    missingClaims: report?.claims?.missing ?? [],
    idempotencyKey: report?.idempotency?.key ?? null,
    lifecycleGate: report?.lifecycleGate?.state ?? 'unknown',
    lifecycleControls: {
      state: report?.lifecycleControls?.state ?? 'unknown',
      ready: report?.lifecycleControls?.ready ?? false,
      effectiveEnabled: report?.lifecycleControls?.effectiveEnabled ?? false,
      selectedControl: report?.lifecycleControls?.selectedControl ?? null,
      scheduleStatus: report?.lifecycleControls?.schedule?.status ?? null,
      nextAction: report?.lifecycleControls?.nextAction ?? null,
      commandCount: report?.lifecycleControls?.commands?.length ?? 0,
      blockerCount: report?.lifecycleControls?.blockers?.length ?? 0,
      warningCount: report?.lifecycleControls?.warnings?.length ?? 0
    },
    dispatchStatus: report?.dispatch?.status ?? 'unknown',
    providerCommand: {
      commandId: report?.providerCommand?.commandId ?? null,
      state: report?.providerCommand?.state ?? 'unknown',
      effectCount: report?.providerCommand?.effects?.length ?? 0,
      syncReady: report?.sync?.ready ?? false
    },
    providerHealth: {
      status: report?.providerHealth?.status ?? 'unknown',
      ready: report?.providerHealth?.ready ?? false,
      degraded: report?.providerHealth?.degraded ?? false,
      retryable: report?.providerHealth?.retryable ?? false,
      retryAfterMs: report?.providerHealth?.retryAfterMs ?? null,
      nextAction: report?.providerHealth?.nextAction ?? null,
      blockerCount: report?.providerHealth?.blockers?.length ?? 0,
      warningCount: report?.providerHealth?.warnings?.length ?? 0
    },
    providerServiceContract: {
      state: report?.providerServiceContract?.state ?? 'unknown',
      ready: report?.providerServiceContract?.ready ?? false,
      negotiationStatus: report?.providerServiceContract?.negotiation?.status ?? 'unknown',
      requiredCapabilityCount: report?.providerServiceContract?.requiredCapabilities?.length ?? 0,
      acceptedCapabilityCount: report?.providerServiceContract?.acceptedCapabilities?.length ?? 0,
      missingCapabilityCount: report?.providerServiceContract?.missingCapabilities?.length ?? 0,
      statusChannel: report?.providerServiceContract?.sync?.statusChannel ?? null,
      commandCount: report?.providerServiceContract?.commands?.length ?? 0,
      digest: report?.providerServiceContract?.digest ?? null,
      nextAction: report?.providerServiceContract?.nextAction ?? null,
      blockerCount: report?.providerServiceContract?.blockers?.length ?? 0,
      warningCount: report?.providerServiceContract?.warnings?.length ?? 0
    },
    clientRuntimeHandoff: {
      state: report?.clientRuntimeHandoff?.state ?? 'unknown',
      ready: report?.clientRuntimeHandoff?.ready ?? false,
      pendingStatus: report?.clientRuntimeHandoff?.userVisibleStatus?.pending ?? null,
      nextAction: report?.clientRuntimeHandoff?.nextAction ?? null,
      blockerCount: report?.clientRuntimeHandoff?.blockers?.length ?? 0
    },
    clientRequestSnapshot: {
      state: report?.clientRequestSnapshot?.state ?? 'unknown',
      ready: report?.clientRequestSnapshot?.ready ?? false,
      digest: report?.clientRequestSnapshot?.digest ?? null,
      requestKey: report?.clientRequestSnapshot?.requestKey ?? null,
      statusChannel: report?.clientRequestSnapshot?.statusChannel ?? null,
      visibleStatus: report?.clientRequestSnapshot?.visibleStatus?.current ?? null,
      nextAction: report?.clientRequestSnapshot?.nextAction ?? null,
      commandCount: report?.clientRequestSnapshot?.commands?.length ?? 0,
      blockerCount: report?.clientRequestSnapshot?.blockers?.length ?? 0
    },
    acceptancePacket: {
      readiness: report?.acceptancePacket?.readinessState ?? 'unknown',
      acceptance: report?.acceptancePacket?.acceptanceState ?? 'unknown',
      acceptEnabled: report?.acceptancePacket?.acceptEnabled ?? false,
      nextAction: report?.acceptancePacket?.nextAction ?? null,
      blockerCount: report?.acceptancePacket?.blockers?.length ?? 0,
      warningCount: report?.acceptancePacket?.warnings?.length ?? 0
    },
    persistedStatus: {
      state: report?.persistedStatus?.state ?? 'unknown',
      ready: report?.persistedStatus?.ready ?? false,
      digest: report?.persistedStatus?.digest ?? null,
      commandId: report?.persistedStatus?.commandId ?? null,
      restartToken: report?.persistedStatus?.restartToken ?? null,
      userVisibleStatus: report?.persistedStatus?.userVisibleStatus?.current ?? null,
      nextAction: report?.persistedStatus?.nextAction ?? null,
      blockerCount: report?.persistedStatus?.blockers?.length ?? 0
    },
    statusJournal: {
      state: report?.statusJournal?.state ?? 'unknown',
      ready: report?.statusJournal?.ready ?? false,
      digest: report?.statusJournal?.digest ?? null,
      latestCheckpoint: report?.statusJournal?.latestCheckpoint?.phase ?? null,
      checkpointCount: report?.statusJournal?.checkpoints?.length ?? 0,
      commandCount: report?.statusJournal?.commands?.length ?? 0,
      restartPolicy: report?.statusJournal?.restartSemantics?.onRestart ?? null,
      duplicateCommandPolicy: report?.statusJournal?.restartSemantics?.onDuplicateCommand ?? null,
      nextAction: report?.statusJournal?.nextAction ?? null,
      blockerCount: report?.statusJournal?.blockers?.length ?? 0
    },
    exportLedger: {
      state: report?.exportLedger?.state ?? 'unknown',
      ready: report?.exportLedger?.ready ?? false,
      digest: report?.exportLedger?.digest ?? null,
      exportStatus: report?.exportLedger?.exportStatus ?? 'unknown',
      latestCheckpoint: report?.exportLedger?.latestCheckpoint?.phase ?? null,
      checkpointCount: report?.exportLedger?.timeline?.length ?? 0,
      changedSinceKernelSnapshot: report?.exportLedger?.changedSinceKernelSnapshot ?? false,
      nextAction: report?.exportLedger?.nextAction ?? null,
      blockerCount: report?.exportLedger?.blockers?.length ?? 0,
      warningCount: report?.exportLedger?.warnings?.length ?? 0
    },
    replayManifest: {
      state: report?.replayManifest?.state ?? 'unknown',
      ready: report?.replayManifest?.ready ?? false,
      restartSafe: report?.replayManifest?.restartSafe ?? false,
      digest: report?.replayManifest?.digest ?? null,
      replayCursor: report?.replayManifest?.replayCursor ?? null,
      commandCount: report?.replayManifest?.commands?.length ?? 0,
      staleSnapshotPolicy: report?.replayManifest?.restartSemantics?.onStaleSnapshot ?? null,
      duplicateCommandPolicy: report?.replayManifest?.restartSemantics?.onDuplicateCommand ?? null,
      nextAction: report?.replayManifest?.nextAction ?? null,
      blockerCount: report?.replayManifest?.blockers?.length ?? 0
    },
    operatorReadiness: {
      state: report?.operatorReadiness?.state ?? 'unknown',
      ready: report?.operatorReadiness?.ready ?? false,
      userVisibleStatus: report?.operatorReadiness?.userVisibleStatus ?? null,
      primaryAction: report?.operatorReadiness?.primaryAction ?? null,
      lifecycleDecision: {
        state: report?.operatorReadiness?.lifecycleDecision?.state ?? 'unknown',
        selectedCommand: report?.operatorReadiness?.lifecycleDecision?.selectedCommand ?? null,
        requiresAcknowledgement: report?.operatorReadiness?.lifecycleDecision?.requiresAcknowledgement ?? false,
        digest: report?.operatorReadiness?.lifecycleDecision?.digest ?? null
      },
      blockerCount: report?.operatorReadiness?.blockers?.length ?? 0,
      warningCount: report?.operatorReadiness?.warnings?.length ?? 0,
      nextStepCount: report?.operatorReadiness?.nextSteps?.length ?? 0
    },
    operationalHealth: {
      state: report?.operationalHealth?.state ?? 'unknown',
      failureState: report?.operationalHealth?.failureState ?? 'unknown',
      degraded: report?.operationalHealth?.degraded ?? false,
      retryable: report?.operationalHealth?.retry?.retryable ?? false,
      retryAfterMs: report?.operationalHealth?.retry?.retryAfterMs ?? null,
      attempt: report?.operationalHealth?.retry?.attempt ?? 0,
      maxAttempts: report?.operationalHealth?.retry?.maxAttempts ?? 0,
      nextAction: report?.operationalHealth?.nextAction ?? null,
      actionableErrorCount: report?.operationalHealth?.actionableErrors?.length ?? 0
    },
    analyticsExport: {
      state: report?.analyticsExport?.state ?? 'unknown',
      ready: report?.analyticsExport?.ready ?? false,
      digest: report?.analyticsExport?.digest ?? null,
      exportStatus: report?.analyticsExport?.exportSummary?.status ?? 'unknown',
      snapshotCount: report?.analyticsExport?.historySnapshots?.length ?? 0,
      timelineEventCount: report?.analyticsExport?.timeline?.length ?? 0,
      failedPhaseCount: report?.analyticsExport?.counters?.failedPhaseCount ?? 0,
      degradedPhaseCount: report?.analyticsExport?.counters?.degradedPhaseCount ?? 0,
      reportChannel: report?.analyticsExport?.reporting?.channel ?? null,
      nextAction: report?.analyticsExport?.nextAction ?? null,
      blockerCount: report?.analyticsExport?.blockers?.length ?? 0,
      warningCount: report?.analyticsExport?.warnings?.length ?? 0
    },
    statusHandoff: {
      state: report?.statusHandoff?.state ?? 'unknown',
      ready: report?.statusHandoff?.ready ?? false,
      digest: report?.statusHandoff?.digest ?? null,
      commandId: report?.statusHandoff?.commandId ?? null,
      statusChannel: report?.statusHandoff?.statusChannel ?? null,
      restartToken: report?.statusHandoff?.restartToken ?? null,
      checkpointCount: report?.statusHandoff?.checkpoints?.length ?? 0,
      nextAction: report?.statusHandoff?.nextAction ?? null,
      blockerCount: report?.statusHandoff?.blockers?.length ?? 0,
      warningCount: report?.statusHandoff?.warnings?.length ?? 0
    },
    boundaryTicket: {
      state: report?.boundaryTicket?.state ?? 'unknown',
      ready: report?.boundaryTicket?.ready ?? false,
      role: report?.boundaryTicket?.role ?? null,
      permissionMode: report?.boundaryTicket?.permissionMode ?? 'unknown',
      auditDigest: report?.boundaryTicket?.auditDigest ?? null,
      blockerCount: report?.boundaryTicket?.blockers?.length ?? 0,
      warningCount: report?.boundaryTicket?.warnings?.length ?? 0
    },
    boundaryAuditHandoff: {
      state: report?.boundaryAuditHandoff?.state ?? 'unknown',
      ready: report?.boundaryAuditHandoff?.ready ?? false,
      auditRecordId: report?.boundaryAuditHandoff?.auditRecordId ?? null,
      auditDigest: report?.boundaryAuditHandoff?.auditDigest ?? null,
      commandCount: report?.boundaryAuditHandoff?.commands?.length ?? 0,
      escalationCount: report?.boundaryAuditHandoff?.escalations?.length ?? 0,
      scopeMismatchCount: report?.boundaryAuditHandoff?.scopeChecks?.filter?.((check) => check.state !== 'matched')?.length ?? 0,
      nextAction: report?.boundaryAuditHandoff?.nextAction ?? null
    },
    boundaryRecoveryGuard: {
      state: report?.boundaryRecoveryGuard?.state ?? 'unknown',
      ready: report?.boundaryRecoveryGuard?.ready ?? false,
      retryable: report?.boundaryRecoveryGuard?.retryable ?? false,
      guardDigest: report?.boundaryRecoveryGuard?.guardDigest ?? null,
      replayPolicy: report?.boundaryRecoveryGuard?.replayPolicy ?? null,
      commandCount: report?.boundaryRecoveryGuard?.commands?.length ?? 0,
      blockerCount: report?.boundaryRecoveryGuard?.blockers?.length ?? 0,
      warningCount: report?.boundaryRecoveryGuard?.warnings?.length ?? 0,
      nextAction: report?.boundaryRecoveryGuard?.nextAction ?? null
    },
    nextAction: report?.nextAction ?? 'operator_review'
  };
}

export function validateExternalWriteAnalysis(report) {
  const diagnostics = [];
  if (!report?.version) diagnostics.push({ level: 'error', code: 'missing_external_write_report_version' });
  if (report?.writeRequired && !report?.writeEffects?.length) {
    diagnostics.push({ level: 'error', code: 'write_required_without_effects' });
  }
  if (report?.writeRequired && !report?.idempotency?.key) {
    diagnostics.push({ level: 'error', code: 'external_write_missing_idempotency_key' });
  }
  if (report?.deniedEffects?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_denied_effects_present' });
  }
  if (report?.writeRequired && report?.claims?.missing?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_missing_required_claims', claims: report.claims.missing });
  }
  if (report?.writeRequired && report?.lifecycleGate?.ready === false) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_lifecycle_gate_blocked',
      blockers: report.lifecycleGate.blockers ?? []
    });
  }
  diagnostics.push(...validateLifecycleControlManifest(report?.lifecycleControls, report?.writeEffects ?? []));
  if (report?.writeRequired && !report?.providerCommand?.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_missing_provider_command_id' });
  }
  diagnostics.push(...validateProviderHealth(report?.providerHealth, report?.writeEffects ?? []));
  diagnostics.push(...validateProviderServiceContract(report?.providerServiceContract, report?.writeEffects ?? []));
  diagnostics.push(...validateTenantBoundaryTicket(report?.boundaryTicket, report?.writeEffects ?? []));
  diagnostics.push(...validateBoundaryAuditHandoff(report?.boundaryAuditHandoff, report?.writeEffects ?? []));
  diagnostics.push(...validateBoundaryRecoveryGuard(report?.boundaryRecoveryGuard, report?.writeEffects ?? []));
  if (report?.providerCommand?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_command_blocked',
      blockers: report.providerCommand.blockers ?? []
    });
  }
  if (report?.writeRequired && report?.sync?.ready !== true && !report?.providerCommand?.blockers?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_sync_not_ready' });
  }
  diagnostics.push(...validateClientRuntimeHandoff(report?.clientRuntimeHandoff, report?.writeEffects ?? []));
  diagnostics.push(...validateClientRequestSnapshot(report?.clientRequestSnapshot, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteAcceptancePacket(report?.acceptancePacket, report?.writeEffects ?? []));
  diagnostics.push(...validatePersistedExternalWriteStatus(report?.persistedStatus, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteStatusJournal(report?.statusJournal, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteExportLedger(report?.exportLedger, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteReplayManifest(report?.replayManifest, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteOperatorReadiness(report?.operatorReadiness, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteOperationalHealth(report?.operationalHealth, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteAnalyticsExport(report?.analyticsExport, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteStatusHandoff(report?.statusHandoff, report?.writeEffects ?? []));
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
    diagnostics
  };
}

function buildExternalWriteStatusHandoff({
  programId,
  operation,
  status,
  writeEffects,
  route,
  lifecycleGate,
  providerHealth,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  persistedStatus,
  statusJournal,
  exportLedger,
  replayManifest,
  operatorReadiness,
  operationalHealth,
  analyticsExport,
  boundaryTicket,
  boundaryAuditHandoff,
  boundaryRecoveryGuard,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const checkpoints = [
    statusCheckpoint('provider_command', providerCommand?.state, providerCommand?.commandId, providerCommand?.blockers),
    statusCheckpoint('persisted_status', persistedStatus?.state, persistedStatus?.digest, persistedStatus?.blockers),
    statusCheckpoint('status_journal', statusJournal?.state, statusJournal?.digest, statusJournal?.blockers),
    statusCheckpoint('client_request_snapshot', clientRequestSnapshot?.state, clientRequestSnapshot?.digest, clientRequestSnapshot?.blockers),
    statusCheckpoint('export_ledger', exportLedger?.state, exportLedger?.digest, exportLedger?.blockers),
    statusCheckpoint('replay_manifest', replayManifest?.state, replayManifest?.digest, replayManifest?.blockers),
    statusCheckpoint('boundary_recovery_guard', boundaryRecoveryGuard?.state, boundaryRecoveryGuard?.guardDigest, boundaryRecoveryGuard?.blockers),
    statusCheckpoint('analytics_export', analyticsExport?.state, analyticsExport?.digest, analyticsExport?.blockers)
  ];
  const blockers = uniqueSorted([
    ...(providerCommand?.blockers ?? []).map((blocker) => `provider_command_${blocker}`),
    ...(persistedStatus?.blockers ?? []).map((blocker) => `persisted_status_${blocker}`),
    ...(statusJournal?.blockers ?? []).map((blocker) => `status_journal_${blocker}`),
    ...(clientRequestSnapshot?.blockers ?? []).map((blocker) => `client_request_${blocker}`),
    ...(exportLedger?.blockers ?? []).map((blocker) => `export_ledger_${blocker}`),
    ...(replayManifest?.blockers ?? []).map((blocker) => `replay_manifest_${blocker}`),
    ...(boundaryRecoveryGuard?.blockers ?? []).map((blocker) => `boundary_recovery_${blocker}`),
    ...(analyticsExport?.blockers ?? []).map((blocker) => `analytics_export_${blocker}`),
    ...(!providerCommand?.commandId && writeRequired ? ['missing_status_handoff_command_id'] : []),
    ...(!route?.statusChannel && writeRequired ? ['missing_status_handoff_channel'] : []),
    ...(!persistedStatus?.digest && writeRequired ? ['missing_status_handoff_persisted_digest'] : []),
    ...(!statusJournal?.digest && writeRequired ? ['missing_status_handoff_journal_digest'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_status_handoff_client_request_digest'] : []),
    ...(!boundaryTicket?.auditDigest && writeRequired ? ['missing_status_handoff_boundary_audit_digest'] : []),
    ...(boundaryRecoveryGuard?.ready === false && writeRequired ? ['status_handoff_boundary_recovery_not_ready'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(lifecycleGate?.warnings ?? []).map((warning) => `lifecycle_${warning}`),
    ...(providerHealth?.warnings ?? []).map((warning) => `provider_health_${warning}`),
    ...(operatorReadiness?.warnings ?? []).map((warning) => `operator_${warning}`),
    ...(operationalHealth?.degraded ? ['operational_health_degraded'] : []),
    ...(analyticsExport?.warnings ?? []).map((warning) => `analytics_${warning}`)
  ]);
  const state = blockers.length
    ? 'blocked'
    : lifecycleGate?.state === 'held'
      ? 'held'
      : lifecycleGate?.state === 'scheduled'
        ? 'scheduled'
        : writeRequired
          ? warnings.length
            ? 'review'
            : 'ready'
          : 'not_required';
  const digestShape = {
    programId,
    operation,
    state,
    commandId: providerCommand?.commandId ?? null,
    statusChannel: route?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    persistedDigest: persistedStatus?.digest ?? null,
    statusJournalDigest: statusJournal?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    replayDigest: replayManifest?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null,
    boundaryRecoveryDigest: boundaryRecoveryGuard?.guardDigest ?? null,
    analyticsDigest: analyticsExport?.digest ?? null
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.status-handoff`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    restartToken: persistedStatus?.restartToken ?? kernelCall?.runtimeState?.profileRestartToken ?? kernelCall?.runtimeState?.restartToken ?? null,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    statusJournalDigest: statusJournal?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    replayDigest: replayManifest?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null,
    boundaryRecoveryDigest: boundaryRecoveryGuard?.guardDigest ?? null,
    analyticsDigest: analyticsExport?.digest ?? null,
    provider: {
      status: providerHealth?.status ?? 'unknown',
      ready: providerHealth?.ready ?? false,
      retryable: providerHealth?.retryable ?? true,
      retryAfterMs: providerHealth?.retryAfterMs ?? null
    },
    checkpoints,
    userVisibleStatus: {
      current: clientRuntimeHandoff?.userVisibleStatus?.pending ?? persistedStatus?.userVisibleStatus?.current ?? statusHandoffUserStatus(state),
      completion: clientRuntimeHandoff?.userVisibleStatus?.completion ?? persistedStatus?.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: clientRuntimeHandoff?.userVisibleStatus?.failure ?? persistedStatus?.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? statusHandoffAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? acknowledgementActionForWarning(warnings[0])
            : writeRequired
              ? 'publish_external_write_status_handoff'
              : 'continue_read_only',
    digest: stableHash(digestShape)
  };
}

function validateExternalWriteStatusHandoff(statusHandoff, writeEffects) {
  if (!writeEffects.length && !statusHandoff) return [];
  const diagnostics = [];
  if (!statusHandoff) return [{ level: 'error', code: 'external_write_missing_status_handoff' }];
  if (writeEffects.length && statusHandoff.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_status_handoff_not_write_required' });
  }
  if (statusHandoff.ready && statusHandoff.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_status_handoff_ready_with_blockers', blockers: statusHandoff.blockers });
  }
  if (statusHandoff.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_status_handoff_blocked', blockers: statusHandoff.blockers ?? [] });
  }
  if (writeEffects.length && !statusHandoff.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_status_handoff_missing_command_id' });
  }
  if (writeEffects.length && !statusHandoff.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_status_handoff_missing_status_channel' });
  }
  if (writeEffects.length && !statusHandoff.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_status_handoff_missing_digest' });
  }
  if (statusHandoff.state === 'review' || statusHandoff.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_status_handoff_review', warnings: statusHandoff.warnings ?? [] });
  }
  return diagnostics;
}

function validateWriteEffects(writeEffects, deniedEffects) {
  const diagnostics = [];
  if (deniedEffects.length) {
    diagnostics.push({ level: 'error', code: 'external_write_denied_effects_present', effects: deniedEffects.map((effect) => effect.effect) });
  }
  if (!writeEffects.length) {
    diagnostics.push({ level: 'info', code: 'external_write_not_requested' });
  }
  return diagnostics;
}

function validateWriteScope(scope) {
  const normalized = normalizeScope(scope);
  const diagnostics = [];
  if (!normalized.tenantId) diagnostics.push({ level: 'error', code: 'external_write_missing_tenant_scope' });
  if (!normalized.workspaceId) diagnostics.push({ level: 'error', code: 'external_write_missing_workspace_scope' });
  if (normalized.role && !['automation_worker', 'operator'].includes(normalized.role)) {
    diagnostics.push({ level: 'error', code: 'external_write_role_not_authorized', role: normalized.role });
  }
  return diagnostics;
}

function buildTenantBoundaryTicket({
  programId,
  operation,
  scope,
  route,
  permissionBoundary,
  kernelCall,
  lifecycleGate,
  writeEffects
}) {
  const normalizedScope = normalizeScope(scope);
  const handoffScope = normalizeScope(kernelCall?.handoff?.scope ?? {});
  const boundary = permissionBoundary ?? kernelCall?.handoff?.permissionBoundary ?? kernelCall?.lifecycle?.permissionBoundary ?? {};
  const allowedEffects = normalizeEffects(boundary?.permissions?.allowedEffects ?? kernelCall?.capabilities?.allowedEffects ?? []);
  const deniedEffects = normalizeDeniedEffects(boundary?.permissions?.deniedEffects ?? kernelCall?.capabilities?.deniedEffects ?? []);
  const requiredWriteEffects = writeEffects.filter((effect) => isExternalWriteEffect(effect));
  const missingAllowedEffects = requiredWriteEffects.filter((effect) => !allowedEffects.includes(effect) && !allowedEffects.includes('mailchimp.write'));
  const role = normalizedScope.role ?? handoffScope.role ?? 'automation_worker';
  const audit = kernelCall?.handoff?.audit ?? {};
  const tenantMatches = !handoffScope.tenantId || !normalizedScope.tenantId || handoffScope.tenantId === normalizedScope.tenantId;
  const workspaceMatches = !handoffScope.workspaceId || !normalizedScope.workspaceId || handoffScope.workspaceId === normalizedScope.workspaceId;
  const isolationMatches = !handoffScope.isolationKey || !route.isolationKey || handoffScope.isolationKey === route.isolationKey;
  const auditMatches = (!audit.tenantId || audit.tenantId === normalizedScope.tenantId)
    && (!audit.workspaceId || audit.workspaceId === normalizedScope.workspaceId)
    && (!audit.isolationKey || audit.isolationKey === route.isolationKey);
  const authorizedRole = ['automation_worker', 'operator'].includes(role);
  const blockers = uniqueSorted([
    ...(!normalizedScope.tenantId ? ['missing_tenant_scope'] : []),
    ...(!normalizedScope.workspaceId ? ['missing_workspace_scope'] : []),
    ...(!route.isolationKey ? ['missing_isolation_key'] : []),
    ...(!tenantMatches ? ['tenant_scope_mismatch'] : []),
    ...(!workspaceMatches ? ['workspace_scope_mismatch'] : []),
    ...(!isolationMatches ? ['isolation_key_mismatch'] : []),
    ...(!auditMatches ? ['audit_scope_mismatch'] : []),
    ...(!authorizedRole ? ['role_not_authorized'] : []),
    ...(deniedEffects.some((effect) => requiredWriteEffects.includes(effect.effect)) ? ['write_effect_denied_by_boundary'] : []),
    ...(missingAllowedEffects.length ? ['write_effect_not_allowed_by_boundary'] : []),
    ...((lifecycleGate?.ready === false && requiredWriteEffects.length) ? ['lifecycle_not_ready_for_boundary'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(!String(normalizedScope.tenantId ?? '').startsWith('tenant:') ? ['tenant_scope_not_namespaced'] : []),
    ...(!String(normalizedScope.workspaceId ?? '').startsWith('workspace:') ? ['workspace_scope_not_namespaced'] : []),
    ...(role === 'operator' ? ['operator_role_requires_acknowledgement'] : []),
    ...(audit.acknowledgements?.includes?.('external_write') ? [] : requiredWriteEffects.length ? ['missing_external_write_audit_acknowledgement'] : [])
  ]);
  const state = !requiredWriteEffects.length
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const auditDigest = stableHash({
    programId,
    operation,
    tenantId: normalizedScope.tenantId ?? null,
    workspaceId: normalizedScope.workspaceId ?? null,
    isolationKey: route.isolationKey ?? null,
    role,
    writeEffects: requiredWriteEffects,
    allowedEffects,
    deniedEffects: deniedEffects.map((effect) => effect.effect),
    auditChannel: route.auditChannel
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.tenant-boundary-ticket`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired: requiredWriteEffects.length > 0,
    tenantId: normalizedScope.tenantId ?? null,
    workspaceId: normalizedScope.workspaceId ?? null,
    isolationKey: route.isolationKey ?? null,
    role,
    permissionMode: boundary?.mode ?? (allowedEffects.length ? 'explicit_allow' : 'runtime_policy'),
    allowedEffects,
    deniedEffects: deniedEffects.map((effect) => effect.effect),
    missingAllowedEffects,
    boundaryChecks: {
      tenantMatches,
      workspaceMatches,
      isolationMatches,
      auditMatches,
      authorizedRole
    },
    audit: {
      channel: route.auditChannel,
      runtimeChannel: audit.channel ?? null,
      acknowledgements: normalizeAcknowledgements(audit.acknowledgements),
      acceptedBy: audit.acceptedBy ?? null,
      acceptedAt: audit.acceptedAt ?? null
    },
    auditDigest,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? boundaryTicketAction(blockers[0])
      : state === 'review'
        ? 'collect_boundary_audit_acknowledgement'
        : state === 'ready'
          ? 'attach_boundary_ticket_to_provider_command'
          : 'continue_read_only'
  };
}

function validateTenantBoundaryTicket(ticket, writeEffects) {
  if (!writeEffects.length && !ticket) return [];
  const diagnostics = [];
  if (!ticket) return [{ level: 'error', code: 'external_write_missing_tenant_boundary_ticket' }];
  if (writeEffects.length && ticket.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_ticket_not_write_required' });
  }
  if (ticket.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_ticket_blocked', blockers: ticket.blockers ?? [] });
  }
  if (ticket.ready && !ticket.auditDigest && writeEffects.length) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_ticket_missing_audit_digest' });
  }
  if (ticket.ready && writeEffects.length && ticket.boundaryChecks?.auditMatches !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_ticket_audit_mismatch' });
  }
  if (ticket.state === 'review') {
    diagnostics.push({ level: 'warning', code: 'external_write_boundary_ticket_requires_review', warnings: ticket.warnings ?? [] });
  }
  return diagnostics;
}

function buildBoundaryAuditHandoff({
  programId,
  operation,
  route,
  boundaryTicket,
  permissionBoundary,
  kernelCall,
  writeEffects
}) {
  const writeRequired = writeEffects.length > 0;
  const audit = kernelCall?.handoff?.audit ?? {};
  const boundary = permissionBoundary ?? kernelCall?.handoff?.permissionBoundary ?? {};
  const expected = {
    tenantId: boundaryTicket?.tenantId ?? route?.tenantId ?? null,
    workspaceId: boundaryTicket?.workspaceId ?? route?.workspaceId ?? null,
    isolationKey: boundaryTicket?.isolationKey ?? route?.isolationKey ?? null,
    auditChannel: route?.auditChannel ?? audit.channel ?? null,
    permissionMode: boundaryTicket?.permissionMode ?? boundary?.mode ?? 'unknown'
  };
  const observed = {
    tenantId: audit.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
    workspaceId: audit.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
    isolationKey: audit.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null,
    auditChannel: audit.channel ?? null,
    permissionMode: boundary?.mode ?? boundaryTicket?.permissionMode ?? 'unknown'
  };
  const scopeChecks = ['tenantId', 'workspaceId', 'isolationKey'].map((field) => ({
    field,
    expected: expected[field],
    observed: observed[field],
    state: !expected[field] || !observed[field] || expected[field] === observed[field] ? 'matched' : 'mismatch'
  }));
  const acknowledgements = normalizeAcknowledgements(audit.acknowledgements);
  const requiredAcknowledgements = uniqueSorted([
    ...(writeRequired ? ['external_write'] : []),
    ...(boundaryTicket?.warnings?.includes('operator_role_requires_acknowledgement') ? ['operator_boundary'] : []),
    ...(boundaryTicket?.warnings?.includes('tenant_scope_not_namespaced') ? ['tenant_scope'] : []),
    ...(boundaryTicket?.warnings?.includes('workspace_scope_not_namespaced') ? ['workspace_scope'] : [])
  ]);
  const missingAcknowledgements = requiredAcknowledgements.filter((acknowledgement) => !acknowledgements.includes(acknowledgement));
  const escalations = uniqueSorted([
    ...(boundaryTicket?.blockers ?? []).map((blocker) => boundaryAuditEscalation(blocker)),
    ...scopeChecks.filter((check) => check.state === 'mismatch').map((check) => `repair_${check.field}`),
    ...(writeRequired && missingAcknowledgements.length ? ['collect_audit_acknowledgement'] : [])
  ]);
  const blockers = uniqueSorted([
    ...(writeRequired && !expected.tenantId ? ['missing_audit_tenant'] : []),
    ...(writeRequired && !expected.workspaceId ? ['missing_audit_workspace'] : []),
    ...(writeRequired && !expected.isolationKey ? ['missing_audit_isolation'] : []),
    ...(scopeChecks.some((check) => check.state === 'mismatch') ? ['audit_scope_mismatch'] : []),
    ...((boundaryTicket?.state === 'blocked') ? ['boundary_ticket_blocked'] : [])
  ]);
  const warnings = uniqueSorted([
    ...((boundaryTicket?.state === 'review') ? ['boundary_ticket_requires_review'] : []),
    ...(missingAcknowledgements.length ? ['audit_acknowledgement_missing'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const auditShape = {
    programId,
    operation,
    state,
    expected,
    observed,
    writeEffects,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? null,
    acknowledgements,
    missingAcknowledgements
  };
  const auditDigest = stableHash(auditShape);
  const auditRecordId = writeRequired ? `boundary-audit:${auditDigest}` : null;
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.boundary-audit-handoff`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    auditRecordId,
    auditDigest,
    channel: expected.auditChannel,
    expected,
    observed,
    scopeChecks,
    acknowledgements,
    requiredAcknowledgements,
    missingAcknowledgements,
    escalations,
    commands: writeRequired ? [
      {
        type: 'persist-boundary-audit-handoff',
        commandId: `audit-handoff:${auditDigest}`,
        idempotencyKey: stableHash({ auditRecordId, action: 'persist-boundary-audit-handoff' }),
        statusAfterReplay: state,
        conflict: 'return-existing'
      },
      ...(escalations.length ? [{
        type: 'raise-boundary-escalation',
        commandId: `audit-escalation:${stableHash({ auditRecordId, escalations })}`,
        idempotencyKey: stableHash({ auditRecordId, escalations, action: 'raise-boundary-escalation' }),
        statusAfterReplay: 'needs_boundary_review',
        conflict: 'return-existing'
      }] : [])
    ] : [],
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? boundaryAuditAction(blockers[0])
      : state === 'review'
        ? 'collect_boundary_audit_acknowledgement'
        : state === 'ready'
          ? 'persist_boundary_audit_handoff'
          : 'continue_read_only'
  };
}

function validateBoundaryAuditHandoff(handoff, writeEffects) {
  if (!writeEffects.length && !handoff) return [];
  const diagnostics = [];
  if (!handoff) return [{ level: 'error', code: 'external_write_missing_boundary_audit_handoff' }];
  if (writeEffects.length && handoff.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_audit_not_write_required' });
  }
  if (handoff.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_audit_blocked', blockers: handoff.blockers ?? [] });
  }
  if (handoff.ready && writeEffects.length && !handoff.auditRecordId) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_audit_missing_record_id' });
  }
  if (handoff.ready && writeEffects.length && !handoff.commands?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_audit_missing_command' });
  }
  if (handoff.state === 'review') {
    diagnostics.push({ level: 'warning', code: 'external_write_boundary_audit_requires_acknowledgement', missingAcknowledgements: handoff.missingAcknowledgements ?? [] });
  }
  return diagnostics;
}

function buildBoundaryRecoveryGuard({
  programId,
  operation,
  route,
  boundaryTicket,
  boundaryAuditHandoff,
  kernelCall,
  writeEffects
}) {
  const writeRequired = writeEffects.length > 0;
  const ticketBlockers = boundaryTicket?.blockers ?? [];
  const auditBlockers = boundaryAuditHandoff?.blockers ?? [];
  const scopeMismatches = boundaryAuditHandoff?.scopeChecks?.filter?.((check) => check.state !== 'matched') ?? [];
  const missingAcknowledgements = boundaryAuditHandoff?.missingAcknowledgements ?? [];
  const hardBoundaryFailures = uniqueSorted([
    ...ticketBlockers.filter((blocker) => /mismatch|denied|not_allowed|not_authorized/.test(String(blocker))),
    ...auditBlockers.filter((blocker) => /mismatch|missing_audit|blocked/.test(String(blocker))),
    ...scopeMismatches.map((check) => `${check.field}_mismatch`)
  ]);
  const recoverableBoundaryFailures = uniqueSorted([
    ...missingAcknowledgements.map((acknowledgement) => `missing_acknowledgement:${acknowledgement}`),
    ...(boundaryTicket?.warnings ?? []),
    ...(boundaryAuditHandoff?.warnings ?? [])
  ]);
  const blockers = uniqueSorted([
    ...hardBoundaryFailures,
    ...(!boundaryTicket ? ['missing_boundary_ticket'] : []),
    ...(!boundaryAuditHandoff ? ['missing_boundary_audit_handoff'] : []),
    ...(writeRequired && boundaryTicket?.ready === false ? ['boundary_ticket_not_ready'] : []),
    ...(writeRequired && boundaryAuditHandoff?.ready === false && boundaryAuditHandoff?.state !== 'review' ? ['boundary_audit_not_ready'] : [])
  ]);
  const warnings = uniqueSorted([
    ...recoverableBoundaryFailures,
    ...(writeRequired && boundaryAuditHandoff?.state === 'review' ? ['boundary_audit_review_required'] : [])
  ]);
  const retryable = writeRequired
    ? blockers.length === 0 && !hardBoundaryFailures.length
    : true;
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const guardDigest = stableHash({
    programId,
    operation,
    state,
    route: {
      tenantId: route?.tenantId ?? null,
      workspaceId: route?.workspaceId ?? null,
      isolationKey: route?.isolationKey ?? null,
      auditChannel: route?.auditChannel ?? null
    },
    ticket: {
      state: boundaryTicket?.state ?? null,
      auditDigest: boundaryTicket?.auditDigest ?? null,
      blockers: ticketBlockers,
      warnings: boundaryTicket?.warnings ?? []
    },
    audit: {
      state: boundaryAuditHandoff?.state ?? null,
      auditDigest: boundaryAuditHandoff?.auditDigest ?? null,
      missingAcknowledgements,
      scopeMismatches: scopeMismatches.map((check) => check.field)
    },
    writeEffects
  });
  const commandBase = {
    guardDigest,
    tenantId: boundaryTicket?.tenantId ?? route?.tenantId ?? null,
    workspaceId: boundaryTicket?.workspaceId ?? route?.workspaceId ?? null,
    isolationKey: boundaryTicket?.isolationKey ?? route?.isolationKey ?? null
  };
  const commands = writeRequired ? [
    {
      type: 'persist-boundary-recovery-guard',
      commandId: `boundary-guard:${guardDigest}`,
      idempotencyKey: stableHash({ ...commandBase, action: 'persist-boundary-recovery-guard' }),
      statusAfterReplay: state,
      conflict: 'return-existing'
    },
    ...(blockers.length ? [{
      type: 'hold-provider-replay-for-boundary',
      commandId: `boundary-guard-hold:${stableHash({ ...commandBase, blockers })}`,
      idempotencyKey: stableHash({ ...commandBase, action: 'hold-provider-replay-for-boundary', blockers }),
      statusAfterReplay: 'needs_boundary_repair',
      conflict: 'return-existing'
    }] : [])
  ] : [];
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.boundary-recovery-guard`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    retryable,
    tenantId: commandBase.tenantId,
    workspaceId: commandBase.workspaceId,
    isolationKey: commandBase.isolationKey,
    auditRecordId: boundaryAuditHandoff?.auditRecordId ?? null,
    auditDigest: boundaryAuditHandoff?.auditDigest ?? boundaryTicket?.auditDigest ?? null,
    ticketDigest: boundaryTicket?.auditDigest ?? null,
    guardDigest,
    replayPolicy: state === 'blocked'
      ? 'hold_replay_until_boundary_repaired'
      : state === 'review'
        ? 'replay_after_boundary_acknowledgement'
        : writeRequired
          ? 'replay_with_boundary_guard'
          : 'read_only_no_guard',
    restartSemantics: {
      onRestart: state === 'blocked' ? 'reload_boundary_audit_before_replay' : 'reuse_guard_digest',
      onDuplicateCommand: 'return-existing-boundary-guard',
      onScopeMutation: 'invalidate-provider-replay'
    },
    scopeMismatches: scopeMismatches.map((check) => ({
      field: check.field,
      expected: check.expected ?? null,
      observed: check.observed ?? null
    })),
    missingAcknowledgements,
    commands,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? boundaryRecoveryGuardAction(blockers[0])
      : state === 'review'
        ? 'collect_boundary_acknowledgement_before_replay'
        : state === 'ready'
          ? 'persist_boundary_recovery_guard'
          : 'continue_read_only'
  };
}

function validateBoundaryRecoveryGuard(guard, writeEffects) {
  if (!writeEffects.length && !guard) return [];
  const diagnostics = [];
  if (!guard) return [{ level: 'error', code: 'external_write_missing_boundary_recovery_guard' }];
  if (writeEffects.length && guard.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_guard_not_write_required' });
  }
  if (guard.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_recovery_guard_blocked', blockers: guard.blockers ?? [] });
  }
  if (guard.ready && writeEffects.length && !guard.guardDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_guard_missing_digest' });
  }
  if (guard.ready && writeEffects.length && !guard.commands?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_guard_missing_command' });
  }
  if (guard.state === 'review') {
    diagnostics.push({ level: 'warning', code: 'external_write_boundary_guard_requires_acknowledgement', missingAcknowledgements: guard.missingAcknowledgements ?? [] });
  }
  if (guard.retryable === false && guard.state !== 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_guard_nonretryable_without_block' });
  }
  return diagnostics;
}

function boundaryRecoveryGuardAction(blocker) {
  if (String(blocker).includes('tenant')) return 'repair_tenant_boundary_before_replay';
  if (String(blocker).includes('workspace')) return 'repair_workspace_boundary_before_replay';
  if (String(blocker).includes('isolation')) return 'repair_isolation_boundary_before_replay';
  if (String(blocker).includes('audit')) return 'persist_boundary_audit_before_replay';
  if (String(blocker).includes('role')) return 'change_execution_role_before_replay';
  if (String(blocker).includes('effect')) return 'repair_write_permission_before_replay';
  return 'hold_provider_replay_for_boundary_review';
}

function boundaryAuditEscalation(blocker) {
  if (String(blocker).includes('tenant')) return 'repair_tenant_boundary';
  if (String(blocker).includes('workspace')) return 'repair_workspace_boundary';
  if (String(blocker).includes('isolation')) return 'repair_isolation_boundary';
  if (String(blocker).includes('audit')) return 'repair_audit_handoff';
  if (String(blocker).includes('role')) return 'review_actor_role';
  if (String(blocker).includes('effect')) return 'review_write_permission';
  return 'operator_boundary_review';
}

function boundaryAuditAction(blocker) {
  if (String(blocker).includes('tenant')) return 'repair_tenant_scope_before_audit';
  if (String(blocker).includes('workspace')) return 'repair_workspace_scope_before_audit';
  if (String(blocker).includes('isolation')) return 'repair_isolation_scope_before_audit';
  if (String(blocker).includes('scope')) return 'repair_audit_scope_handoff';
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  return 'operator_boundary_review';
}

function boundaryTicketAction(blocker) {
  if (String(blocker).includes('tenant')) return 'repair_tenant_scope_before_write';
  if (String(blocker).includes('workspace')) return 'repair_workspace_scope_before_write';
  if (String(blocker).includes('isolation')) return 'repair_isolation_key_before_write';
  if (String(blocker).includes('audit')) return 'repair_audit_handoff_scope';
  if (String(blocker).includes('role')) return 'change_execution_role_or_remove_write';
  if (String(blocker).includes('effect')) return 'resolve_permission_boundary_effects';
  if (String(blocker).includes('lifecycle')) return 'repair_lifecycle_controls';
  return 'operator_review';
}

function validateIdempotency(idempotencyKey) {
  if (idempotencyKey) return [];
  return [{ level: 'error', code: 'external_write_missing_idempotency_key' }];
}

function validateClaimCoverage(claimCoverage, writeEffects) {
  if (!writeEffects.length || claimCoverage.missing.length === 0) return [];
  return [{ level: 'error', code: 'external_write_missing_required_claims', claims: claimCoverage.missing }];
}

function validateLifecycleGate(gate, writeEffects) {
  if (!writeEffects.length) return [];
  return [
    ...gate.blockers.map((code) => ({ level: 'error', code, state: gate.state })),
    ...gate.warnings.map((code) => ({ level: 'warning', code, state: gate.state }))
  ];
}

function validateProviderHealth(providerHealth, writeEffects) {
  if (!writeEffects.length) return [];
  const diagnostics = [];
  if (!providerHealth) return [{ level: 'error', code: 'external_write_missing_provider_health' }];
  if (providerHealth.ready !== true && providerHealth.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_health_blocked',
      blockers: providerHealth.blockers
    });
  }
  if (providerHealth.status === 'degraded') {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_provider_health_degraded',
      retryAfterMs: providerHealth.retryAfterMs ?? null,
      warnings: providerHealth.warnings ?? []
    });
  }
  if (providerHealth.retryable === false && providerHealth.ready !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_health_not_retryable' });
  }
  return diagnostics;
}

function validateProviderCommand(providerCommand, writeEffects) {
  if (!writeEffects.length) return [];
  const diagnostics = [];
  if (!providerCommand.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_missing_provider_command_id' });
  }
  if (!providerCommand.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_missing_provider_status_channel' });
  }
  if (!providerCommand.scope.tenantId || !providerCommand.scope.workspaceId) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_command_missing_scope' });
  }
  if (providerCommand.state === 'held') {
    diagnostics.push({ level: 'warning', code: 'external_write_provider_command_held' });
  }
  if (providerCommand.state === 'scheduled') {
    diagnostics.push({ level: 'warning', code: 'external_write_provider_command_scheduled' });
  }
  if (writeEffects.length && providerCommand.serviceContract?.ready === false) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_command_service_contract_blocked',
      blockers: providerCommand.serviceContract.missingCapabilities ?? []
    });
  }
  return diagnostics;
}

function validateClientRuntimeHandoff(handoff, writeEffects) {
  if (!writeEffects.length && !handoff) return [];
  const diagnostics = [];
  if (!handoff) return [{ level: 'error', code: 'external_write_missing_client_runtime_handoff' }];
  if (writeEffects.length && handoff.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_client_handoff_not_write_required' });
  }
  if (handoff.ready && handoff.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_client_handoff_ready_with_blockers',
      blockers: handoff.blockers
    });
  }
  if (writeEffects.length && !handoff.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_client_handoff_missing_status_channel' });
  }
  if (writeEffects.length && !handoff.idempotencyKey) {
    diagnostics.push({ level: 'error', code: 'external_write_client_handoff_missing_idempotency_key' });
  }
  if (handoff.ready && handoff.providerCommand?.safeToReplay !== true && writeEffects.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_client_handoff_not_replay_safe' });
  }
  return diagnostics;
}

function validateExternalWriteAcceptancePacket(packet, writeEffects) {
  if (!writeEffects.length && !packet) return [];
  const diagnostics = [];
  if (!packet) {
    return [{ level: 'error', code: 'external_write_missing_acceptance_packet' }];
  }
  if (writeEffects.length && packet.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_packet_not_write_required' });
  }
  if (packet.acceptEnabled && packet.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_acceptance_enabled_with_blockers',
      blockers: packet.blockers
    });
  }
  if (packet.acceptanceState === 'accepted' && packet.acceptEnabled !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_state_not_enabled' });
  }
  if (packet.acceptEnabled && !packet.commandId && packet.writeRequired) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_missing_command_id' });
  }
  if (packet.acceptEnabled && packet.validationSummary?.errorCount > 0) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_acceptance_enabled_with_validation_errors',
      errors: packet.validationSummary.errors ?? []
    });
  }
  return diagnostics;
}

function buildClaimCoverage({ verifierClaims, claims, truthBoundaries }) {
  const normalizedClaims = verifierClaims.map((claim) => ({
    name: claim.name,
    status: claim.status ?? (Object.prototype.hasOwnProperty.call(claims, claim.name) ? 'present' : 'missing'),
    valueHash: claim.valueHash ?? (Object.prototype.hasOwnProperty.call(claims, claim.name) ? stableHash(claims[claim.name]) : null)
  }));
  return {
    required: normalizedClaims.map((claim) => claim.name).sort(),
    present: normalizedClaims.filter((claim) => claim.status === 'present').map((claim) => claim.name).sort(),
    missing: normalizedClaims.filter((claim) => claim.status === 'missing').map((claim) => claim.name).sort(),
    truthBoundaries: truthBoundaries.map((boundary) => ({
      name: boundary.name,
      status: boundary.status ?? 'declared',
      authority: boundary.authority ?? 'aios_local'
    }))
  };
}

function buildWriteRoute({ programId, operation, adapter, scope, idempotencyKey }) {
  return {
    adapter,
    target: `kernel.jobs.${operation ?? 'unknown'}`,
    statusChannel: `kernel.status.${adapter ?? 'mailchimp'}`,
    auditChannel: 'audit.mailchimp.external_write',
    tenantId: scope.tenantId ?? null,
    workspaceId: scope.workspaceId ?? null,
    isolationKey: scope.isolationKey ?? stableWriteKey({ programId, operation, tenantId: scope.tenantId, workspaceId: scope.workspaceId }),
    idempotencyKey
  };
}

function nextWriteAction({ status, writeEffects, blockedReasons, providerCommand }) {
  if (!writeEffects.length) return 'continue_read_only';
  if (providerCommand?.state === 'held') return 'await_manual_release';
  if (providerCommand?.state === 'scheduled') return 'wait_for_schedule_window';
  if (blockedReasons.includes('external_write_lifecycle_disabled')) return 'enable_lifecycle_before_write';
  if (blockedReasons.includes('external_write_lifecycle_blocked')) return 'repair_lifecycle_before_write';
  if (blockedReasons.includes('external_write_lifecycle_not_exportable')) return 'repair_lifecycle_controls';
  if (blockedReasons.includes('external_write_denied_effects_present')) return 'resolve_denied_write_effects';
  if (blockedReasons.includes('external_write_missing_required_claims')) return 'collect_required_claims';
  if (blockedReasons.includes('external_write_role_not_authorized')) return 'change_execution_role_or_remove_write';
  if (blockedReasons.length) return 'operator_review';
  if (status === 'review') return 'confirm_write_handoff';
  return 'enqueue_external_write';
}

function normalizeLifecycleGate(lifecycle = {}) {
  const enabled = lifecycle?.enabled !== false;
  const state = lifecycle?.state ?? (enabled ? 'enabled' : 'disabled');
  const schedule = lifecycle?.schedule ?? {};
  const scheduleStatus = schedule.status ?? (schedule.mode === 'manual' ? 'manual_hold' : 'ready');
  const exportable = lifecycle?.exportable !== false;
  const validation = lifecycle?.validation ?? [];
  const blockers = [
    ...(!enabled ? ['external_write_lifecycle_disabled'] : []),
    ...(state === 'blocked' ? ['external_write_lifecycle_blocked'] : []),
    ...(!exportable ? ['external_write_lifecycle_not_exportable'] : []),
    ...validation
      .filter((diagnostic) => diagnostic.level === 'error')
      .map((diagnostic) => `external_write_${diagnostic.code}`)
  ];
  const warnings = [
    ...(scheduleStatus === 'manual_hold' ? ['external_write_manual_release_required'] : []),
    ...(scheduleStatus === 'scheduled' ? ['external_write_waiting_for_schedule'] : []),
    ...validation
      .filter((diagnostic) => diagnostic.level === 'warning')
      .map((diagnostic) => `external_write_${diagnostic.code}`)
  ];
  return {
    state,
    enabled,
    ready: blockers.length === 0,
    exportable,
    nextAction: lifecycle?.nextAction ?? null,
    schedule: {
      mode: schedule.mode ?? 'immediate',
      status: scheduleStatus,
      notBefore: schedule.notBefore ?? null,
      notAfter: schedule.notAfter ?? null,
      timezone: schedule.timezone ?? 'UTC'
    },
    settings: {
      priority: lifecycle?.settings?.priority ?? 'normal',
      concurrencyLimit: lifecycle?.settings?.concurrencyLimit ?? 1,
      timeoutMs: lifecycle?.settings?.timeoutMs ?? 60000
    },
    blockers: uniqueSorted(blockers),
    warnings: uniqueSorted(warnings)
  };
}

function buildLifecycleControlManifest({
  programId,
  operation,
  lifecycle = {},
  lifecycleGate,
  scope,
  writeEffects,
  kernelCall
}) {
  const settings = lifecycleGate.settings ?? {};
  const schedule = lifecycleGate.schedule ?? {};
  const rawCommands = [
    ...(asArray(lifecycle?.commands)),
    ...(asArray(kernelCall?.lifecycle?.commands))
  ];
  const commands = rawCommands
    .map((command, index) => normalizeLifecycleControlCommand(command, index))
    .filter(Boolean);
  const commandActions = commands.map((command) => command.action);
  const enableRequested = commandActions.some((action) => ['enable', 'resume', 'release'].includes(action));
  const disableRequested = commandActions.some((action) => ['disable', 'pause', 'hold'].includes(action));
  const scheduleRequested = commandActions.some((action) => ['schedule', 'reschedule'].includes(action))
    || schedule.status === 'scheduled'
    || Boolean(schedule.notBefore);
  const effectiveEnabled = disableRequested
    ? false
    : enableRequested
      ? true
      : lifecycleGate.enabled !== false;
  const selectedControl = disableRequested
    ? 'disable'
    : scheduleRequested
      ? 'schedule'
      : enableRequested
        ? 'enable'
        : lifecycleGate.schedule.status === 'manual_hold'
          ? 'manual_hold'
          : 'run';
  const settingIssues = validateLifecycleControlSettings(settings);
  const scheduleIssues = validateLifecycleControlSchedule(schedule, scheduleRequested);
  const commandIssues = commands.flatMap(validateLifecycleControlCommand);
  const writeRequired = writeEffects.length > 0;
  const blockers = uniqueSorted([
    ...(lifecycleGate.blockers ?? []),
    ...settingIssues.filter((issue) => issue.level === 'error').map((issue) => issue.code),
    ...scheduleIssues.filter((issue) => issue.level === 'error').map((issue) => issue.code),
    ...commandIssues.filter((issue) => issue.level === 'error').map((issue) => issue.code),
    ...(writeRequired && !scope?.tenantId ? ['lifecycle_control_missing_tenant_scope'] : []),
    ...(writeRequired && !scope?.workspaceId ? ['lifecycle_control_missing_workspace_scope'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(lifecycleGate.warnings ?? []),
    ...settingIssues.filter((issue) => issue.level === 'warning').map((issue) => issue.code),
    ...scheduleIssues.filter((issue) => issue.level === 'warning').map((issue) => issue.code),
    ...commandIssues.filter((issue) => issue.level === 'warning').map((issue) => issue.code),
    ...(writeRequired && selectedControl === 'manual_hold' ? ['lifecycle_control_manual_release_required'] : []),
    ...(writeRequired && selectedControl === 'schedule' ? ['lifecycle_control_scheduled_release'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : !effectiveEnabled
        ? 'disabled'
        : selectedControl === 'manual_hold'
          ? 'held'
          : selectedControl === 'schedule'
            ? 'scheduled'
            : warnings.length
              ? 'review'
              : 'ready';
  const controls = ['enable', 'disable', 'manual_hold', 'schedule', 'run'].map((name) => ({
    name,
    available: lifecycleControlAvailable(name, { state, blockers, effectiveEnabled, writeRequired }),
    selected: name === selectedControl || (name === 'run' && selectedControl === 'run'),
    commandId: writeRequired ? `lifecycle-control:${stableHash({ programId, operation, name, state })}` : null,
    nextState: lifecycleControlNextState(name),
    requiresAcknowledgement: ['disable', 'manual_hold', 'schedule'].includes(name) && writeRequired
  }));
  const acceptedCommands = commands.map((command) => ({
    ...command,
    accepted: !validateLifecycleControlCommand(command).some((issue) => issue.level === 'error'),
    nextState: lifecycleControlNextState(command.action)
  }));
  const commandLedger = acceptedCommands.map((command) => ({
    type: 'persist-lifecycle-control',
    commandId: `lifecycle-command:${stableHash({ programId, operation, command })}`,
    idempotencyKey: stableHash({
      programId,
      operation,
      lifecycleCommandId: command.id,
      action: command.action
    }),
    statusAfterReplay: command.nextState,
    conflict: 'return-existing'
  }));
  const digest = stableHash({
    programId,
    operation,
    state,
    effectiveEnabled,
    selectedControl,
    settings,
    schedule,
    commands: acceptedCommands.map((command) => `${command.id}:${command.action}:${command.accepted}`),
    blockers,
    warnings
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.lifecycle-controls`,
    programId,
    operation,
    state,
    ready: ['ready', 'review', 'disabled', 'held', 'scheduled', 'not_required'].includes(state),
    writeRequired,
    effectiveEnabled,
    selectedControl,
    settings,
    schedule,
    controls,
    commands: commandLedger,
    appliedCommands: acceptedCommands,
    validation: {
      settingIssues,
      scheduleIssues,
      commandIssues
    },
    userVisibleStatus: lifecycleControlStatus(state),
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? lifecycleControlAction(blockers[0])
      : state === 'disabled'
        ? 'keep_lifecycle_disabled'
        : state === 'held'
          ? 'await_manual_release'
          : state === 'scheduled'
            ? 'wait_for_schedule_window'
            : warnings.length
              ? lifecycleControlAction(warnings[0])
              : writeRequired
                ? 'continue_lifecycle_enabled'
                : 'continue_read_only',
    digest
  };
}

function normalizeLifecycleControlCommand(command, index) {
  if (typeof command === 'string') {
    return {
      id: `lifecycle-command:${stableHash({ command, index })}`,
      action: command.trim().toLowerCase(),
      source: 'program',
      reason: null
    };
  }
  const action = String(command?.action ?? command?.op ?? command?.command ?? '').trim().toLowerCase();
  if (!action) return null;
  return {
    id: command?.id ?? `lifecycle-command:${stableHash({ action, index, source: command?.source })}`,
    action,
    source: command?.source ?? 'program',
    reason: command?.reason ?? null,
    settings: command?.settings ?? {},
    schedule: command?.schedule ?? {}
  };
}

function validateLifecycleControlSettings(settings = {}) {
  const diagnostics = [];
  const concurrencyLimit = Number(settings.concurrencyLimit ?? 1);
  const timeoutMs = Number(settings.timeoutMs ?? 60000);
  if (!Number.isFinite(concurrencyLimit) || concurrencyLimit < 1) {
    diagnostics.push({ level: 'error', code: 'lifecycle_control_invalid_concurrency_limit' });
  }
  if (Number.isFinite(concurrencyLimit) && concurrencyLimit > 10) {
    diagnostics.push({ level: 'warning', code: 'lifecycle_control_high_concurrency_limit' });
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    diagnostics.push({ level: 'error', code: 'lifecycle_control_invalid_timeout_ms' });
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 300000) {
    diagnostics.push({ level: 'warning', code: 'lifecycle_control_long_timeout_ms' });
  }
  if (!['low', 'normal', 'high', 'urgent'].includes(String(settings.priority ?? 'normal'))) {
    diagnostics.push({ level: 'warning', code: 'lifecycle_control_unknown_priority' });
  }
  return diagnostics;
}

function validateLifecycleControlSchedule(schedule = {}, scheduleRequested = false) {
  const diagnostics = [];
  if (!scheduleRequested) return diagnostics;
  if (schedule.status === 'scheduled' && !schedule.notBefore) {
    diagnostics.push({ level: 'warning', code: 'lifecycle_control_schedule_without_not_before' });
  }
  if (schedule.notBefore && schedule.notAfter && String(schedule.notBefore) > String(schedule.notAfter)) {
    diagnostics.push({ level: 'error', code: 'lifecycle_control_schedule_window_invalid' });
  }
  if (schedule.timezone && typeof schedule.timezone !== 'string') {
    diagnostics.push({ level: 'error', code: 'lifecycle_control_timezone_invalid' });
  }
  return diagnostics;
}

function validateLifecycleControlCommand(command) {
  const supported = ['enable', 'disable', 'pause', 'hold', 'resume', 'release', 'schedule', 'reschedule', 'run'];
  const diagnostics = [];
  if (!supported.includes(command.action)) {
    diagnostics.push({ level: 'error', code: 'lifecycle_control_command_unknown', action: command.action });
  }
  if (['disable', 'pause', 'hold'].includes(command.action) && !command.reason) {
    diagnostics.push({ level: 'warning', code: 'lifecycle_control_hold_reason_missing', commandId: command.id });
  }
  return diagnostics;
}

function validateLifecycleControlManifest(manifest, writeEffects) {
  if (!writeEffects.length && !manifest) return [];
  const diagnostics = [];
  if (!manifest) return [{ level: 'error', code: 'external_write_missing_lifecycle_control_manifest' }];
  if (writeEffects.length && manifest.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_lifecycle_control_not_write_required' });
  }
  if (manifest.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_lifecycle_control_blocked', blockers: manifest.blockers ?? [] });
  }
  if (manifest.ready && writeEffects.length && !manifest.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_lifecycle_control_missing_digest' });
  }
  if (manifest.state === 'review') {
    diagnostics.push({ level: 'warning', code: 'external_write_lifecycle_control_review', warnings: manifest.warnings ?? [] });
  }
  return diagnostics;
}

function lifecycleControlAvailable(name, { state, blockers, effectiveEnabled, writeRequired }) {
  if (!writeRequired) return name === 'run';
  if (state === 'blocked') return name !== 'run' && !blockers.includes('lifecycle_control_command_unknown');
  if (name === 'enable') return !effectiveEnabled;
  if (name === 'disable') return effectiveEnabled;
  if (name === 'manual_hold') return effectiveEnabled;
  if (name === 'schedule') return effectiveEnabled;
  return effectiveEnabled && !['disabled', 'held', 'scheduled'].includes(state);
}

function lifecycleControlNextState(action) {
  return {
    enable: 'ready',
    resume: 'ready',
    release: 'ready',
    run: 'ready',
    disable: 'disabled',
    pause: 'held',
    hold: 'held',
    schedule: 'scheduled',
    reschedule: 'scheduled'
  }[action] ?? 'blocked';
}

function lifecycleControlStatus(state) {
  return {
    blocked: 'needs_lifecycle_repair',
    disabled: 'lifecycle_disabled',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    review: 'lifecycle_ready_with_warnings',
    ready: 'lifecycle_ready',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function lifecycleControlAction(reason) {
  if (String(reason).includes('concurrency')) return 'repair_lifecycle_concurrency';
  if (String(reason).includes('timeout')) return 'repair_lifecycle_timeout';
  if (String(reason).includes('schedule')) return 'repair_lifecycle_schedule';
  if (String(reason).includes('timezone')) return 'repair_lifecycle_timezone';
  if (String(reason).includes('disabled')) return 'enable_lifecycle_before_write';
  if (String(reason).includes('manual')) return 'await_manual_release';
  if (String(reason).includes('tenant') || String(reason).includes('workspace')) return 'repair_lifecycle_scope';
  if (String(reason).includes('command')) return 'repair_lifecycle_command';
  return 'repair_lifecycle_controls';
}

function normalizeProviderHealth(provider = {}, fallback = {}) {
  const rawStatus = provider?.health?.status ?? provider?.status ?? 'available';
  const status = ['available', 'ready', 'degraded', 'blocked', 'unavailable'].includes(rawStatus)
    ? rawStatus
    : 'available';
  const blockers = uniqueSorted([
    ...(provider?.blockers ?? []),
    ...(provider?.negotiation?.accepted === false ? ['provider_capability_negotiation_failed'] : []),
    ...(provider?.sync?.statusChannel || fallback.statusChannel ? [] : ['provider_missing_status_channel']),
    ...(provider?.sync?.idempotencyKey || fallback.idempotencyKey ? [] : ['provider_missing_idempotency_key']),
    ...(status === 'blocked' ? ['provider_blocked'] : []),
    ...(status === 'unavailable' ? ['provider_unavailable'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(provider?.warnings ?? []),
    ...(status === 'degraded' || provider?.health?.degraded ? ['provider_degraded'] : [])
  ]);
  const writeRequired = (fallback.writeEffects ?? []).length > 0;
  const ready = !writeRequired || ((provider?.ready !== false) && blockers.length === 0 && !['blocked', 'unavailable'].includes(status));
  const retryable = provider?.health?.retryable !== false
    && !blockers.some((blocker) => String(blocker).startsWith('provider_denied:') || String(blocker).startsWith('provider_missing_effect:'));
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.provider-health`,
    provider: provider?.provider ?? fallback.adapter ?? 'mailchimp',
    service: provider?.service ?? 'mailchimp',
    status: status === 'ready' ? 'available' : status,
    ready,
    degraded: status === 'degraded' || provider?.health?.degraded === true,
    retryable,
    retryAfterMs: Number(provider?.health?.retryAfterMs ?? fallback.retryAfterMs ?? 1000),
    syncStatus: provider?.sync?.status ?? (ready ? 'ready' : 'blocked'),
    statusChannel: provider?.sync?.statusChannel ?? fallback.statusChannel ?? null,
    idempotencyKey: provider?.sync?.idempotencyKey ?? fallback.idempotencyKey ?? null,
    endpoint: provider?.endpoint ?? null,
    missingEffects: provider?.negotiation?.missingEffects ?? [],
    blockers,
    warnings,
    nextAction: providerHealthAction({ status, blockers, retryable })
  };
}

function buildMailchimpProviderServiceContract({
  programId,
  operation,
  provider = {},
  route,
  writeEffects,
  deniedEffects,
  scope,
  lifecycleGate,
  providerHealth,
  kernelCall
}) {
  const requiredCapabilities = uniqueSorted([
    ...writeEffects.flatMap(mailchimpCapabilitiesForEffect),
    ...(writeEffects.length ? ['mailchimp.sync.status', 'mailchimp.idempotent-write'] : [])
  ]);
  const declaredCapabilities = uniqueSorted([
    ...(provider.capabilities ?? []),
    ...(provider.allowedCapabilities ?? []),
    ...(provider.negotiation?.capabilities ?? []),
    ...(kernelCall?.capabilities?.provider ?? []),
    ...(kernelCall?.capabilities?.allowed ?? [])
  ]);
  const acceptedCapabilities = requiredCapabilities.filter((capability) => (
    declaredCapabilities.length === 0
      ? defaultMailchimpCapabilitySupported(capability)
      : declaredCapabilities.includes(capability) || declaredCapabilities.includes('mailchimp.*')
  ));
  const deniedCapabilities = uniqueSorted([
    ...(provider.deniedCapabilities ?? []),
    ...(provider.negotiation?.deniedCapabilities ?? []),
    ...deniedEffects.flatMap((effect) => mailchimpCapabilitiesForEffect(effect.effect).map((capability) => `denied:${capability}`))
  ]);
  const missingCapabilities = requiredCapabilities.filter((capability) => (
    !acceptedCapabilities.includes(capability)
    || deniedCapabilities.includes(capability)
    || deniedCapabilities.includes(`denied:${capability}`)
  ));
  const sync = {
    statusChannel: provider.sync?.statusChannel ?? route.statusChannel ?? null,
    auditChannel: provider.sync?.auditChannel ?? route.auditChannel ?? null,
    idempotencyKey: provider.sync?.idempotencyKey ?? route.idempotencyKey ?? null,
    externalStateKey: provider.sync?.externalStateKey
      ?? (scope.tenantId && scope.workspaceId
        ? `mailchimp:${scope.tenantId}:${scope.workspaceId}:${operation ?? 'unknown'}`
        : null),
    cursor: provider.sync?.cursor ?? kernelCall?.handoff?.providerCursor ?? null,
    checkpointDigest: stableHash({
      programId,
      operation,
      effects: writeEffects,
      tenantId: scope.tenantId ?? null,
      workspaceId: scope.workspaceId ?? null,
      idempotencyKey: provider.sync?.idempotencyKey ?? route.idempotencyKey ?? null
    })
  };
  const blockers = uniqueSorted([
    ...(providerHealth.blockers ?? []).map((blocker) => `health_${blocker}`),
    ...(missingCapabilities.length ? ['provider_capability_mismatch'] : []),
    ...missingCapabilities.map((capability) => `missing_capability:${capability}`),
    ...(!sync.statusChannel && writeEffects.length ? ['missing_provider_status_channel'] : []),
    ...(!sync.idempotencyKey && writeEffects.length ? ['missing_provider_idempotency_key'] : []),
    ...(!sync.externalStateKey && writeEffects.length ? ['missing_provider_external_state_key'] : []),
    ...(lifecycleGate.ready === false && writeEffects.length ? ['lifecycle_not_ready_for_provider_contract'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(providerHealth.warnings ?? []).map((warning) => `health_${warning}`),
    ...(declaredCapabilities.length === 0 && writeEffects.length ? ['provider_capabilities_defaulted'] : []),
    ...(providerHealth.degraded ? ['provider_health_degraded'] : []),
    ...(sync.cursor == null && writeEffects.length ? ['provider_cursor_not_declared'] : [])
  ]);
  const state = !writeEffects.length
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : providerHealth.degraded || warnings.length
        ? 'review'
        : 'ready';
  const commands = writeEffects.length ? [
    {
      type: 'negotiate-mailchimp-provider-capabilities',
      commandId: `provider-negotiate:${stableHash({ programId, operation, requiredCapabilities, acceptedCapabilities })}`,
      idempotencyKey: stableHash({ programId, operation, action: 'provider-negotiate', idempotencyKey: sync.idempotencyKey }),
      statusAfterReplay: state,
      conflict: 'return-existing'
    },
    {
      type: 'persist-mailchimp-provider-sync-state',
      commandId: `provider-sync:${stableHash(sync)}`,
      idempotencyKey: stableHash({ programId, operation, action: 'provider-sync', externalStateKey: sync.externalStateKey }),
      statusAfterReplay: state === 'ready' ? 'provider_sync_ready' : 'provider_sync_review',
      conflict: 'return-existing'
    }
  ] : [];
  const digest = stableHash({
    programId,
    operation,
    state,
    requiredCapabilities,
    acceptedCapabilities,
    missingCapabilities,
    statusChannel: sync.statusChannel,
    externalStateKey: sync.externalStateKey,
    providerStatus: providerHealth.status
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.mailchimp-provider-service-contract`,
    provider: provider.provider ?? route.adapter ?? 'mailchimp',
    service: provider.service ?? 'mailchimp',
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired: writeEffects.length > 0,
    requiredCapabilities,
    declaredCapabilities,
    acceptedCapabilities,
    deniedCapabilities,
    missingCapabilities,
    negotiation: {
      status: state === 'blocked' ? 'blocked' : state === 'review' ? 'review' : 'accepted',
      accepted: state !== 'blocked',
      defaulted: declaredCapabilities.length === 0,
      providerStatus: providerHealth.status,
      healthReady: providerHealth.ready === true
    },
    sync,
    handoffState: {
      externalStateKey: sync.externalStateKey,
      statusChannel: sync.statusChannel,
      checkpointDigest: sync.checkpointDigest,
      cursor: sync.cursor,
      retryAfterMs: providerHealth.retryAfterMs ?? null,
      replayPolicy: providerHealth.retryable === false ? 'hold_for_provider_repair' : 'return_existing_or_retry'
    },
    commands,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? providerServiceAction(blockers[0])
      : state === 'review'
        ? 'review_mailchimp_provider_capabilities'
        : state === 'ready'
          ? 'persist_mailchimp_provider_service_contract'
          : 'continue_read_only',
    digest
  };
}

function validateProviderServiceContract(contract, writeEffects) {
  if (!writeEffects.length && !contract) return [];
  const diagnostics = [];
  if (!contract) return [{ level: 'error', code: 'external_write_missing_provider_service_contract' }];
  if (writeEffects.length && contract.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_service_not_write_required' });
  }
  if (contract.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_service_blocked',
      blockers: contract.blockers ?? []
    });
  }
  if (contract.ready && writeEffects.length && !contract.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_service_missing_digest' });
  }
  if (contract.ready && writeEffects.length && !contract.sync?.externalStateKey) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_service_missing_external_state_key' });
  }
  if (contract.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_provider_service_requires_review',
      warnings: contract.warnings ?? []
    });
  }
  return diagnostics;
}

function mailchimpCapabilitiesForEffect(effect) {
  const normalized = String(effect ?? '').toLowerCase();
  if (normalized.includes('campaign') && (normalized.includes('send') || normalized.includes('publish'))) {
    return ['mailchimp.campaigns.send', 'mailchimp.campaigns.write'];
  }
  if (normalized.includes('campaign')) return ['mailchimp.campaigns.write'];
  if (normalized.includes('audience') || normalized.includes('member') || normalized.includes('contact')) {
    return ['mailchimp.audiences.write'];
  }
  if (normalized.includes('template')) return ['mailchimp.templates.write'];
  if (normalized.includes('segment')) return ['mailchimp.segments.write'];
  return ['mailchimp.write'];
}

function defaultMailchimpCapabilitySupported(capability) {
  return [
    'mailchimp.write',
    'mailchimp.sync.status',
    'mailchimp.idempotent-write',
    'mailchimp.campaigns.write',
    'mailchimp.campaigns.send',
    'mailchimp.audiences.write',
    'mailchimp.templates.write',
    'mailchimp.segments.write'
  ].includes(capability);
}

function providerServiceAction(blocker) {
  if (String(blocker).includes('capability')) return 'negotiate_mailchimp_provider_capability';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('external_state')) return 'persist_provider_external_state_key';
  if (String(blocker).includes('lifecycle')) return 'repair_lifecycle_before_provider_handoff';
  if (String(blocker).includes('health')) return 'resolve_provider_health';
  return 'review_mailchimp_provider_contract';
}

function providerHealthAction({ status, blockers, retryable }) {
  if (blockers.some((blocker) => String(blocker).startsWith('provider_denied:'))) return 'resolve_provider_denied_effect';
  if (blockers.some((blocker) => String(blocker).startsWith('provider_missing_effect:'))) return 'enable_provider_capability';
  if (blockers.includes('provider_missing_status_channel')) return 'bind_provider_status_channel';
  if (blockers.includes('provider_missing_idempotency_key')) return 'provide_provider_idempotency_key';
  if (status === 'unavailable' && retryable) return 'retry_provider_after_backoff';
  if (status === 'degraded') return 'handoff_with_provider_degraded_ack';
  if (blockers.length) return 'resolve_provider_health';
  return 'continue_provider_handoff';
}

function buildWriteDispatchPlan({ statusChannel, auditChannel, idempotencyKey, lifecycleGate, writeEffects, providerHealth, providerServiceContract }) {
  const status = !writeEffects.length
    ? 'not_required'
    : providerHealth.ready !== true || providerServiceContract?.ready === false
      ? 'blocked'
      : lifecycleGate.ready
      ? lifecycleGate.schedule.status === 'scheduled'
        ? 'scheduled'
        : lifecycleGate.schedule.status === 'manual_hold'
          ? 'held'
          : 'ready'
      : 'blocked';
  return {
    status,
    writeEffectCount: writeEffects.length,
    statusChannel,
    auditChannel,
    idempotencyKey,
    release: {
      mode: lifecycleGate.schedule.mode,
      notBefore: lifecycleGate.schedule.notBefore,
      notAfter: lifecycleGate.schedule.notAfter,
      timezone: lifecycleGate.schedule.timezone,
      nextAction: status === 'ready'
        ? 'enqueue_external_write'
        : providerHealth.ready !== true
          ? providerHealth.nextAction
        : providerServiceContract?.ready === false
          ? providerServiceContract.nextAction
        : status === 'scheduled'
          ? 'wait_for_schedule_window'
          : status === 'held'
            ? 'await_manual_release'
            : 'repair_lifecycle_controls'
    }
  };
}

function buildMailchimpProviderCommand({
  programId,
  operation,
  route,
  dispatch,
  lifecycleGate,
  writeEffects,
  scope,
  input,
  claimCoverage,
  boundaryTicket,
  boundaryAuditHandoff,
  providerHealth,
  providerServiceContract
}) {
  const required = writeEffects.length > 0;
  const blockers = uniqueSorted([
    ...(!route.idempotencyKey && required ? ['missing_idempotency_key'] : []),
    ...(!route.statusChannel && required ? ['missing_status_channel'] : []),
    ...(!scope.tenantId && required ? ['missing_tenant_scope'] : []),
    ...(!scope.workspaceId && required ? ['missing_workspace_scope'] : []),
    ...(lifecycleGate.blockers ?? []),
    ...(providerHealth.blockers ?? []),
    ...(providerServiceContract?.blockers ?? []).map((blocker) => `provider_service_${blocker}`),
    ...(boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(boundaryAuditHandoff?.blockers ?? []).map((blocker) => `boundary_audit_${blocker}`)
  ]);
  const state = !required
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : dispatch.status === 'held'
        ? 'held'
        : dispatch.status === 'scheduled'
          ? 'scheduled'
          : 'ready';
  const commandShape = {
    programId,
    operation,
    target: route.target,
    effects: writeEffects,
    tenantId: scope.tenantId ?? null,
    workspaceId: scope.workspaceId ?? null,
    inputHash: stableHash(input),
    claimHash: stableHash({
      present: claimCoverage.present,
      missing: claimCoverage.missing
    }),
    boundaryAuditDigest: boundaryAuditHandoff?.auditDigest ?? null,
    idempotencyKey: route.idempotencyKey
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.mailchimp-provider-command`,
    required,
    provider: route.adapter ?? 'mailchimp',
    service: 'mailchimp',
    providerHealth: {
      status: providerHealth.status,
      ready: providerHealth.ready,
      degraded: providerHealth.degraded,
      retryable: providerHealth.retryable,
      retryAfterMs: providerHealth.retryAfterMs,
      nextAction: providerHealth.nextAction
    },
    serviceContract: {
      state: providerServiceContract?.state ?? 'unknown',
      ready: providerServiceContract?.ready ?? false,
      negotiationStatus: providerServiceContract?.negotiation?.status ?? 'unknown',
      requiredCapabilities: providerServiceContract?.requiredCapabilities ?? [],
      acceptedCapabilities: providerServiceContract?.acceptedCapabilities ?? [],
      missingCapabilities: providerServiceContract?.missingCapabilities ?? [],
      externalStateKey: providerServiceContract?.sync?.externalStateKey ?? null,
      digest: providerServiceContract?.digest ?? null
    },
    commandId: required ? `mailchimp-command:${stableHash(commandShape)}` : null,
    idempotencyKey: route.idempotencyKey ?? null,
    target: route.target,
    statusChannel: route.statusChannel,
    auditChannel: route.auditChannel,
    state,
    mode: dispatch.release.mode,
    releaseAction: dispatch.release.nextAction,
    effects: writeEffects.map((effect) => ({
      effect,
      external: true,
      capability: effect.startsWith('mailchimp.') ? effect : 'mailchimp.write'
    })),
    scope: normalizeScope(scope),
    payloadShape: {
      inputHash: stableHash(input),
      claimHash: commandShape.claimHash,
      truthBoundaryCount: claimCoverage.truthBoundaries.length,
      missingClaimCount: claimCoverage.missing.length
    },
    schedule: stableClone(dispatch.release),
    boundaryTicket: {
      state: boundaryTicket?.state ?? 'unknown',
      ready: boundaryTicket?.ready === true,
      auditDigest: boundaryTicket?.auditDigest ?? null,
      isolationKey: boundaryTicket?.isolationKey ?? route.isolationKey ?? null,
      tenantId: boundaryTicket?.tenantId ?? scope.tenantId ?? null,
      workspaceId: boundaryTicket?.workspaceId ?? scope.workspaceId ?? null,
      permissionMode: boundaryTicket?.permissionMode ?? 'unknown'
    },
    boundaryAuditHandoff: {
      state: boundaryAuditHandoff?.state ?? 'unknown',
      ready: boundaryAuditHandoff?.ready === true,
      auditRecordId: boundaryAuditHandoff?.auditRecordId ?? null,
      auditDigest: boundaryAuditHandoff?.auditDigest ?? null,
      commandCount: boundaryAuditHandoff?.commands?.length ?? 0,
      escalationCount: boundaryAuditHandoff?.escalations?.length ?? 0
    },
    blockers,
    replay: {
      strategy: 'idempotent_command',
      safeToReplay: required && blockers.length === 0 && providerHealth.retryable !== false,
      dedupeKey: route.idempotencyKey ?? null,
      commandDigest: stableHash(commandShape)
    },
    nextAction: state === 'blocked'
      ? providerCommandAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : required
            ? 'publish_mailchimp_provider_command'
            : 'continue_read_only'
  };
}

function buildWriteSyncMetadata({ route, dispatch, providerCommand, lifecycleGate, kernelCall, providerHealth }) {
  const ready = providerCommand.required
    ? providerCommand.state === 'ready' && providerCommand.replay.safeToReplay && providerHealth.ready === true
    : true;
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.sync`,
    ready,
    provider: providerCommand.provider,
    commandId: providerCommand.commandId,
    commandState: providerCommand.state,
    statusChannel: route.statusChannel,
    auditChannel: route.auditChannel,
    idempotencyKey: route.idempotencyKey,
    isolationKey: route.isolationKey,
    releaseStatus: dispatch.status,
    providerHealthStatus: providerHealth.status,
    providerHealthReady: providerHealth.ready,
    providerRetryAfterMs: providerHealth.retryAfterMs,
    providerServiceState: providerCommand.serviceContract?.state ?? 'unknown',
    providerServiceDigest: providerCommand.serviceContract?.digest ?? null,
    providerExternalStateKey: providerCommand.serviceContract?.externalStateKey ?? null,
    providerAcceptedCapabilities: providerCommand.serviceContract?.acceptedCapabilities ?? [],
    providerMissingCapabilities: providerCommand.serviceContract?.missingCapabilities ?? [],
    lifecycleState: lifecycleGate.state,
    lifecycleReady: lifecycleGate.ready,
    restartToken: kernelCall?.runtimeState?.profileRestartToken ?? kernelCall?.runtimeState?.restartToken ?? null,
    snapshotHint: stableHash({
      programId: kernelCall?.programId ?? null,
      operation: kernelCall?.operation ?? null,
      commandId: providerCommand.commandId,
      state: providerCommand.state,
      releaseStatus: dispatch.status,
      lifecycleState: lifecycleGate.state
    }),
    nextAction: ready
      ? 'sync_mailchimp_provider_command'
      : providerCommand.nextAction
  };
}

function buildClientRuntimeHandoff({
  programId,
  operation,
  route,
  dispatch,
  providerCommand,
  syncMetadata,
  lifecycleGate,
  kernelCall,
  writeEffects,
  claimCoverage,
  boundaryTicket,
  boundaryAuditHandoff,
  providerHealth
}) {
  const writeRequired = writeEffects.length > 0;
  const providerBlocked = providerCommand.state === 'blocked';
  const blockers = uniqueSorted([
    ...(providerCommand.blockers ?? []).map((blocker) => `provider_${blocker}`),
    ...(providerHealth.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
    ...(lifecycleGate.blockers ?? []),
    ...(boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(boundaryAuditHandoff?.blockers ?? []).map((blocker) => `boundary_audit_${blocker}`),
    ...(!route.idempotencyKey && writeRequired ? ['missing_idempotency_key'] : []),
    ...(!route.statusChannel && writeRequired ? ['missing_status_channel'] : []),
    ...(!syncMetadata.ready && providerCommand.state === 'ready' ? ['sync_not_ready'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length || providerBlocked
      ? 'blocked'
      : providerCommand.state === 'held'
        ? 'held'
        : providerCommand.state === 'scheduled'
          ? 'scheduled'
          : syncMetadata.ready
            ? 'ready'
            : 'syncing';
  const statusMap = {
    not_required: 'read_only_ready',
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    syncing: 'syncing_provider_command',
    ready: 'ready_for_confirmation'
  };
  const commandDigest = providerCommand.replay?.commandDigest ?? stableHash({
    commandId: providerCommand.commandId,
    idempotencyKey: providerCommand.idempotencyKey,
    effects: providerCommand.effects,
    inputHash: providerCommand.payloadShape?.inputHash ?? null
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.client-runtime-handoff`,
    programId,
    operation,
    writeRequired,
    state,
    ready: state === 'ready' || state === 'not_required',
    target: kernelCall?.handoff?.target ?? 'mailchimp.client.workflow',
    statusChannel: route.statusChannel ?? null,
    auditChannel: route.auditChannel ?? null,
    idempotencyKey: route.idempotencyKey ?? null,
    isolationKey: route.isolationKey ?? null,
    dispatchStatus: dispatch.status,
    userVisibleStatus: {
      pending: statusMap[state] ?? 'operator_review',
      completion: writeRequired ? 'mailchimp_write_synced' : 'read_only_complete',
      failure: 'mailchimp_write_needs_review'
    },
    providerCommand: {
      commandId: providerCommand.commandId,
      state: providerCommand.state,
      safeToReplay: providerCommand.replay?.safeToReplay === true,
      commandDigest
    },
    providerHealth: {
      status: providerHealth.status,
      ready: providerHealth.ready,
      degraded: providerHealth.degraded,
      retryable: providerHealth.retryable,
      retryAfterMs: providerHealth.retryAfterMs,
      nextAction: providerHealth.nextAction
    },
    resume: {
      mode: kernelCall?.handoff?.continuationMode ?? 'resume_after_kernel_ack',
      restartToken: kernelCall?.runtimeState?.profileRestartToken ?? kernelCall?.runtimeState?.restartToken ?? null,
      snapshotHint: syncMetadata.snapshotHint ?? null,
      nextAction: syncMetadata.nextAction
    },
    claims: {
      missing: claimCoverage.missing,
      presentCount: claimCoverage.present.length,
      requiredCount: claimCoverage.required.length
    },
    boundaryTicket: {
      state: boundaryTicket?.state ?? 'unknown',
      ready: boundaryTicket?.ready === true,
      auditDigest: boundaryTicket?.auditDigest ?? null,
      nextAction: boundaryTicket?.nextAction ?? null
    },
    boundaryAuditHandoff: {
      state: boundaryAuditHandoff?.state ?? 'unknown',
      ready: boundaryAuditHandoff?.ready === true,
      auditRecordId: boundaryAuditHandoff?.auditRecordId ?? null,
      auditDigest: boundaryAuditHandoff?.auditDigest ?? null,
      nextAction: boundaryAuditHandoff?.nextAction ?? null
    },
    blockers,
    nextAction: clientRuntimeHandoffAction({ state, blockers, providerCommand, syncMetadata })
  };
}

function buildClientRequestSnapshot({
  programId,
  operation,
  route,
  dispatch,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  lifecycleGate,
  writeEffects,
  claimCoverage,
  boundaryTicket,
  boundaryAuditHandoff,
  providerHealth,
  kernelCall,
  input
}) {
  const writeRequired = writeEffects.length > 0;
  const request = kernelCall?.handoff?.request
    ?? kernelCall?.runtimeState?.request
    ?? kernelCall?.handoff?.client
    ?? {};
  const requestId = optionalString(request.requestId)
    ?? optionalString(request.id)
    ?? stableWriteKey({ programId, operation, inputHash: stableHash(input) });
  const workflowId = optionalString(request.workflowId)
    ?? optionalString(request.workflow)
    ?? `${route.adapter ?? 'mailchimp'}:${operation ?? 'unknown'}`;
  const requestKey = [
    'mailchimp',
    route.tenantId ?? 'tenant:unknown',
    route.workspaceId ?? 'workspace:unknown',
    workflowId,
    requestId
  ].join(':');
  const state = !writeRequired
    ? 'not_required'
    : clientRuntimeHandoff.state === 'blocked' || providerCommand.state === 'blocked'
      ? 'blocked'
      : clientRuntimeHandoff.state === 'held'
        ? 'held'
        : clientRuntimeHandoff.state === 'scheduled'
          ? 'scheduled'
          : clientRuntimeHandoff.ready === true && syncMetadata.ready === true
            ? 'ready'
            : 'waiting';
  const resumeGeneration = Number(kernelCall?.runtimeState?.continuationState?.generation ?? 0);
  const blockers = uniqueSorted([
    ...(clientRuntimeHandoff.blockers ?? []),
    ...(providerCommand.blockers ?? []).map((blocker) => `provider_${blocker}`),
    ...(providerHealth.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
    ...(boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(boundaryAuditHandoff?.blockers ?? []).map((blocker) => `boundary_audit_${blocker}`),
    ...(!requestId && writeRequired ? ['missing_client_request_id'] : []),
    ...(!workflowId && writeRequired ? ['missing_client_workflow_id'] : []),
    ...(!route.statusChannel && writeRequired ? ['missing_client_status_channel'] : []),
    ...(!route.idempotencyKey && writeRequired ? ['missing_client_idempotency_key'] : []),
    ...(!providerCommand.commandId && writeRequired ? ['missing_client_provider_command'] : []),
    ...(lifecycleGate.ready === false && writeRequired ? ['lifecycle_not_ready_for_client_request'] : [])
  ]);
  const digestShape = {
    programId,
    operation,
    state,
    requestKey,
    requestId,
    workflowId,
    commandId: providerCommand.commandId ?? null,
    commandDigest: providerCommand.replay?.commandDigest ?? null,
    idempotencyKey: route.idempotencyKey ?? null,
    statusChannel: route.statusChannel ?? null,
    resumeGeneration,
    inputHash: stableHash(input),
    claimHash: stableHash({ present: claimCoverage.present, missing: claimCoverage.missing }),
    boundaryTicketDigest: boundaryTicket?.auditDigest ?? null,
    boundaryAuditDigest: boundaryAuditHandoff?.auditDigest ?? null
  };
  const digest = stableHash(digestShape);
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.client-request-snapshot`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    requestKey,
    requestId,
    workflowId,
    programId,
    operation,
    product: 'mailchimp',
    statusChannel: route.statusChannel ?? null,
    auditChannel: route.auditChannel ?? null,
    idempotencyKey: route.idempotencyKey ?? null,
    commandId: providerCommand.commandId ?? null,
    commandDigest: providerCommand.replay?.commandDigest ?? null,
    dispatchStatus: dispatch.status,
    clientRuntimeState: clientRuntimeHandoff.state,
    providerCommandState: providerCommand.state,
    resume: {
      mode: clientRuntimeHandoff.resume?.mode ?? kernelCall?.handoff?.continuationMode ?? 'resume_after_kernel_ack',
      restartToken: clientRuntimeHandoff.resume?.restartToken ?? syncMetadata.restartToken ?? null,
      generation: resumeGeneration,
      snapshotHint: clientRuntimeHandoff.resume?.snapshotHint ?? syncMetadata.snapshotHint ?? null,
      safeToResume: Boolean(clientRuntimeHandoff.resume?.restartToken ?? syncMetadata.restartToken)
        || kernelCall?.handoff?.continuationMode === 'none'
    },
    scope: {
      tenantId: route.tenantId ?? null,
      workspaceId: route.workspaceId ?? null,
      isolationKey: route.isolationKey ?? null
    },
    boundaryAuditHandoff: {
      state: boundaryAuditHandoff?.state ?? 'unknown',
      ready: boundaryAuditHandoff?.ready === true,
      auditRecordId: boundaryAuditHandoff?.auditRecordId ?? null,
      auditDigest: boundaryAuditHandoff?.auditDigest ?? null,
      commandIds: (boundaryAuditHandoff?.commands ?? []).map((command) => command.commandId)
    },
    visibleStatus: {
      current: clientRuntimeHandoff.userVisibleStatus?.pending ?? clientRequestStatus(state),
      completion: clientRuntimeHandoff.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: clientRuntimeHandoff.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    commands: [
      {
        type: 'persist-client-request-snapshot',
        commandId: `client-request:${digest}`,
        idempotencyKey: stableHash({ requestKey, digest, action: 'persist-client-request-snapshot' }),
        statusAfterReplay: state,
        conflict: 'return-existing'
      },
      ...(writeRequired ? [{
        type: 'bind-provider-command',
        commandId: providerCommand.commandId,
        idempotencyKey: stableHash({ requestKey, providerCommand: providerCommand.commandId, action: 'bind-provider-command' }),
        statusAfterReplay: providerCommand.state,
        conflict: 'return-existing'
      }] : [])
    ],
    blockers,
    nextAction: state === 'blocked'
      ? clientRequestAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'persist_client_request_snapshot'
            : writeRequired
              ? clientRuntimeHandoff.nextAction ?? 'wait_for_client_runtime_handoff'
              : 'continue_read_only',
    digest
  };
}

function validateClientRequestSnapshot(snapshot, writeEffects) {
  if (!writeEffects.length && !snapshot) return [];
  const diagnostics = [];
  if (!snapshot) return [{ level: 'error', code: 'external_write_missing_client_request_snapshot' }];
  if (writeEffects.length && snapshot.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_client_request_snapshot_not_write_required' });
  }
  if (snapshot.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_client_request_snapshot_blocked', blockers: snapshot.blockers ?? [] });
  }
  if (snapshot.ready && writeEffects.length && !snapshot.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_client_request_snapshot_missing_digest' });
  }
  if (snapshot.ready && writeEffects.length && !snapshot.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_client_request_snapshot_missing_status_channel' });
  }
  if (snapshot.ready && writeEffects.length && !snapshot.commands?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_client_request_snapshot_missing_command' });
  }
  return diagnostics;
}

function clientRequestStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'preparing_client_request',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function clientRequestAction(blocker) {
  if (String(blocker).includes('request')) return 'repair_client_request_identity';
  if (String(blocker).includes('workflow')) return 'repair_client_workflow_identity';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('provider')) return 'resolve_provider_command';
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('lifecycle')) return 'repair_lifecycle_controls';
  return 'repair_client_request_snapshot';
}

function clientRuntimeHandoffAction({ state, blockers, providerCommand, syncMetadata }) {
  if (blockers.length) return providerCommandAction(blockers[0]);
  if (state === 'held') return 'await_manual_release';
  if (state === 'scheduled') return 'wait_for_schedule_window';
  if (state === 'syncing') return syncMetadata.nextAction ?? 'sync_mailchimp_provider_command';
  if (state === 'ready') return 'render_external_write_confirmation';
  if (state === 'not_required') return 'continue_read_only';
  return providerCommand.nextAction ?? 'operator_review';
}

function buildExternalWriteAcceptancePacket({
  programId,
  operation,
  status,
  writeEffects,
  deniedEffects,
  route,
  lifecycleGate,
  dispatch,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  claimCoverage,
  boundaryTicket,
  boundaryAuditHandoff,
  providerHealth,
  kernelCall
}) {
  const validationCodes = uniqueSorted([
    ...deniedEffects.map((effect) => 'external_write_denied_effects_present'),
    ...(claimCoverage.missing.length ? ['external_write_missing_required_claims'] : []),
    ...(lifecycleGate.blockers ?? []),
    ...(boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(boundaryAuditHandoff?.blockers ?? []).map((blocker) => `boundary_audit_${blocker}`),
    ...(providerHealth?.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
    ...(providerCommand.blockers ?? []).map((blocker) => `provider_${blocker}`),
    ...(!route.idempotencyKey && writeEffects.length ? ['external_write_missing_idempotency_key'] : []),
    ...(!route.statusChannel && writeEffects.length ? ['external_write_missing_status_channel'] : []),
    ...(clientRuntimeHandoff.blockers ?? []).map((blocker) => `client_${blocker}`),
    ...(clientRequestSnapshot?.blockers ?? []).map((blocker) => `client_request_${blocker}`)
  ]);
  const warnings = uniqueSorted([
    ...(lifecycleGate.warnings ?? []),
    ...(providerCommand.state === 'held' ? ['external_write_provider_command_held'] : []),
    ...(providerCommand.state === 'scheduled' ? ['external_write_provider_command_scheduled'] : []),
    ...(providerHealth?.warnings ?? []).map((warning) => `provider_health_${warning}`),
    ...(boundaryTicket?.warnings ?? []).map((warning) => `boundary_${warning}`),
    ...(boundaryAuditHandoff?.warnings ?? []).map((warning) => `boundary_audit_${warning}`),
    ...(status === 'review' ? ['external_write_review_required'] : [])
  ]);
  const blockers = uniqueSorted([
    ...validationCodes,
    ...(providerCommand.state === 'blocked' ? ['external_write_provider_command_blocked'] : [])
  ]);
  const readinessState = !writeEffects.length
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : syncMetadata.ready
          ? 'ready'
          : 'waiting_for_sync';
  const requiredAcknowledgements = uniqueSorted([
    ...(writeEffects.length ? ['external_write'] : []),
    ...(providerCommand.state === 'held' ? ['manual_release'] : []),
    ...(providerCommand.state === 'scheduled' ? ['scheduled_release'] : [])
  ]);
  const acceptedAcknowledgements = normalizeAcknowledgements(kernelCall?.handoff?.audit?.acknowledgements);
  const missingAcknowledgements = requiredAcknowledgements.filter((acknowledgement) => !acceptedAcknowledgements.includes(acknowledgement));
  const acceptEnabled = writeEffects.length > 0
    && readinessState === 'ready'
    && missingAcknowledgements.length === 0
    && syncMetadata.ready === true;
  const acceptanceState = !writeEffects.length
    ? 'not_required'
    : acceptEnabled
      ? 'accepted'
      : blockers.length
        ? 'blocked'
        : 'pending_acknowledgement';
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.acceptance-packet`,
    programId,
    operation,
    writeRequired: writeEffects.length > 0,
    readinessState,
    acceptanceState,
    acceptEnabled,
    commandId: providerCommand.commandId,
    commandState: providerCommand.state,
    clientRuntimeState: clientRuntimeHandoff.state,
    clientRequestSnapshot: {
      state: clientRequestSnapshot?.state ?? 'unknown',
      ready: clientRequestSnapshot?.ready === true,
      digest: clientRequestSnapshot?.digest ?? null,
      requestKey: clientRequestSnapshot?.requestKey ?? null,
      visibleStatus: clientRequestSnapshot?.visibleStatus?.current ?? null,
      nextAction: clientRequestSnapshot?.nextAction ?? null
    },
    idempotencyKey: route.idempotencyKey,
    statusChannel: route.statusChannel,
    auditChannel: route.auditChannel,
    releaseStatus: dispatch.status,
    providerHealth: {
      status: providerHealth?.status ?? 'unknown',
      ready: providerHealth?.ready ?? false,
      degraded: providerHealth?.degraded ?? false,
      retryable: providerHealth?.retryable ?? false,
      retryAfterMs: providerHealth?.retryAfterMs ?? null,
      nextAction: providerHealth?.nextAction ?? null
    },
    syncReady: syncMetadata.ready,
    clientRuntimeReady: clientRuntimeHandoff.ready,
    scope: {
      tenantId: route.tenantId ?? null,
      workspaceId: route.workspaceId ?? null,
      isolationKey: route.isolationKey ?? null
    },
    boundaryTicket: {
      state: boundaryTicket?.state ?? 'unknown',
      ready: boundaryTicket?.ready === true,
      auditDigest: boundaryTicket?.auditDigest ?? null,
      permissionMode: boundaryTicket?.permissionMode ?? 'unknown',
      nextAction: boundaryTicket?.nextAction ?? null
    },
    boundaryAuditHandoff: {
      state: boundaryAuditHandoff?.state ?? 'unknown',
      ready: boundaryAuditHandoff?.ready === true,
      auditRecordId: boundaryAuditHandoff?.auditRecordId ?? null,
      auditDigest: boundaryAuditHandoff?.auditDigest ?? null,
      commandCount: boundaryAuditHandoff?.commands?.length ?? 0,
      nextAction: boundaryAuditHandoff?.nextAction ?? null
    },
    validationSummary: {
      ok: blockers.length === 0,
      errorCount: blockers.length,
      warningCount: warnings.length,
      errors: blockers,
      warnings
    },
    requiredAcknowledgements,
    acceptedAcknowledgements,
    missingAcknowledgements,
    blockers,
    warnings,
    nextAction: externalWriteAcceptanceNextAction({
      readinessState,
      acceptanceState,
      blockers,
      missingAcknowledgements,
      providerCommand,
      syncMetadata
    }),
    nextSteps: buildExternalWriteNextSteps({
      blockers,
      warnings,
      missingAcknowledgements,
      providerCommand,
      syncMetadata,
      writeEffects
    })
  };
}

function externalWriteAcceptanceNextAction({
  readinessState,
  acceptanceState,
  blockers,
  missingAcknowledgements,
  providerCommand,
  syncMetadata
}) {
  if (blockers.length) return providerCommandAction(blockers[0]);
  if (providerCommand.state === 'held') return 'await_manual_release';
  if (providerCommand.state === 'scheduled') return 'wait_for_schedule_window';
  if (missingAcknowledgements.length) return 'collect_operator_acknowledgement';
  if (readinessState === 'waiting_for_sync') return 'sync_mailchimp_provider_command';
  if (acceptanceState === 'accepted' && syncMetadata.ready) return 'publish_external_write_acceptance';
  return providerCommand.nextAction ?? 'operator_review';
}

function buildExternalWriteNextSteps({ blockers, warnings, missingAcknowledgements, providerCommand, syncMetadata, writeEffects }) {
  if (!writeEffects.length) {
    return [{ index: 0, action: 'continue_read_only', reason: 'external_write_not_requested', terminal: true }];
  }
  const blockerSteps = blockers.map((reason, index) => ({
    index,
    action: providerCommandAction(reason),
    reason,
    terminal: false
  }));
  if (blockerSteps.length) return blockerSteps;
  const acknowledgementSteps = missingAcknowledgements.map((reason, index) => ({
    index,
    action: 'collect_operator_acknowledgement',
    reason,
    terminal: false
  }));
  if (acknowledgementSteps.length) return acknowledgementSteps;
  const warningSteps = warnings.map((reason, index) => ({
    index,
    action: providerCommand.nextAction,
    reason,
    terminal: false
  }));
  if (warningSteps.length) return warningSteps;
  return [{
    index: 0,
    action: syncMetadata.ready ? 'publish_external_write_acceptance' : 'sync_mailchimp_provider_command',
    reason: syncMetadata.ready ? 'external_write_ready_for_acceptance' : 'external_write_sync_not_ready',
    terminal: syncMetadata.ready
  }];
}

function buildPersistedExternalWriteStatus({
  programId,
  operation,
  status,
  writeEffects,
  route,
  lifecycleGate,
  dispatch,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  acceptancePacket,
  boundaryTicket,
  providerHealth,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const restartToken = clientRuntimeHandoff?.resume?.restartToken
    ?? syncMetadata?.restartToken
    ?? kernelCall?.runtimeState?.profileRestartToken
    ?? kernelCall?.runtimeState?.restartToken
    ?? null;
  const commandDigest = providerCommand?.replay?.commandDigest
    ?? clientRuntimeHandoff?.providerCommand?.commandDigest
    ?? null;
  const blockers = uniqueSorted([
    ...(clientRuntimeHandoff?.blockers ?? []),
    ...(acceptancePacket?.blockers ?? []),
    ...(boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(providerHealth?.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
    ...(providerCommand?.blockers ?? []).map((blocker) => `provider_${blocker}`),
    ...(lifecycleGate?.blockers ?? []),
    ...(clientRequestSnapshot?.blockers ?? []).map((blocker) => `client_request_${blocker}`),
    ...(!providerCommand?.commandId && writeRequired ? ['missing_persisted_command_id'] : []),
    ...(!route?.idempotencyKey && writeRequired ? ['missing_persisted_idempotency_key'] : []),
    ...(!route?.statusChannel && writeRequired ? ['missing_persisted_status_channel'] : []),
    ...(!commandDigest && writeRequired ? ['missing_persisted_command_digest'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : providerCommand.state === 'held'
        ? 'held'
        : providerCommand.state === 'scheduled'
          ? 'scheduled'
          : acceptancePacket.acceptEnabled && syncMetadata.ready
            ? 'ready'
            : 'waiting';
  const resumeGeneration = Number(kernelCall?.runtimeState?.continuationState?.generation ?? 0);
  const digestShape = {
    programId,
    operation,
    state,
    commandId: providerCommand.commandId ?? null,
    idempotencyKey: route.idempotencyKey ?? null,
    statusChannel: route.statusChannel ?? null,
    restartToken,
    commandDigest,
    dispatchStatus: dispatch.status,
    providerHealthStatus: providerHealth?.status ?? null,
    acceptanceState: acceptancePacket.acceptanceState,
    resumeGeneration
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.persisted-status`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    sourceStatus: status,
    commandId: providerCommand.commandId ?? null,
    commandDigest,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    clientRequestKey: clientRequestSnapshot?.requestKey ?? null,
    idempotencyKey: route.idempotencyKey ?? null,
    statusChannel: route.statusChannel ?? null,
    auditChannel: route.auditChannel ?? null,
    restartToken,
    snapshotHint: syncMetadata.snapshotHint ?? null,
    dispatchStatus: dispatch.status,
    lifecycleState: lifecycleGate.state,
    boundaryTicket: {
      state: boundaryTicket?.state ?? 'unknown',
      ready: boundaryTicket?.ready === true,
      auditDigest: boundaryTicket?.auditDigest ?? null,
      nextAction: boundaryTicket?.nextAction ?? null
    },
    providerHealth: {
      status: providerHealth?.status ?? 'unknown',
      ready: providerHealth?.ready ?? false,
      degraded: providerHealth?.degraded ?? false,
      retryable: providerHealth?.retryable ?? false,
      retryAfterMs: providerHealth?.retryAfterMs ?? null,
      nextAction: providerHealth?.nextAction ?? null
    },
    acceptanceState: acceptancePacket.acceptanceState,
    readinessState: acceptancePacket.readinessState,
    scope: {
      tenantId: route.tenantId ?? null,
      workspaceId: route.workspaceId ?? null,
      isolationKey: route.isolationKey ?? null
    },
    clientRequestSnapshot: {
      state: clientRequestSnapshot?.state ?? 'unknown',
      ready: clientRequestSnapshot?.ready === true || !writeRequired,
      digest: clientRequestSnapshot?.digest ?? null,
      requestKey: clientRequestSnapshot?.requestKey ?? null,
      commandCount: clientRequestSnapshot?.commands?.length ?? 0,
      nextAction: clientRequestSnapshot?.nextAction ?? null
    },
    replay: {
      safeToReplay: providerCommand.replay?.safeToReplay === true,
      dedupeKey: providerCommand.replay?.dedupeKey ?? route.idempotencyKey ?? null,
      commandDigest,
      commandState: providerCommand.state
    },
    resume: {
      mode: kernelCall?.handoff?.continuationMode ?? 'resume_after_kernel_ack',
      generation: resumeGeneration,
      safeToResume: Boolean(restartToken) || kernelCall?.handoff?.continuationMode === 'none',
      nextAction: clientRuntimeHandoff?.resume?.nextAction ?? syncMetadata.nextAction
    },
    userVisibleStatus: {
      current: clientRuntimeHandoff?.userVisibleStatus?.pending ?? persistedWriteStatus(state),
      completion: clientRuntimeHandoff?.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: clientRuntimeHandoff?.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    blockers,
    nextAction: state === 'blocked'
      ? persistedWriteAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'persist_external_write_status'
            : writeRequired
              ? acceptancePacket.nextAction ?? 'wait_for_external_write_acceptance'
              : 'continue_read_only',
    digest: stableHash(digestShape)
  };
}

function validatePersistedExternalWriteStatus(state, writeEffects) {
  if (!writeEffects.length && !state) return [];
  const diagnostics = [];
  if (!state) return [{ level: 'error', code: 'external_write_missing_persisted_status' }];
  if (writeEffects.length && state.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_persisted_status_not_write_required' });
  }
  if (state.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_persisted_status_blocked', blockers: state.blockers ?? [] });
  }
  if (state.ready && writeEffects.length && !state.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_persisted_status_missing_command_id' });
  }
  if (state.ready && writeEffects.length && state.replay?.safeToReplay !== true) {
    diagnostics.push({ level: 'warning', code: 'external_write_persisted_status_not_replay_safe' });
  }
  if (state.writeRequired && state.resume?.safeToResume !== true) {
    diagnostics.push({ level: 'warning', code: 'external_write_persisted_status_missing_restart_token' });
  }
  if (state.ready && writeEffects.length && !state.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_persisted_status_missing_digest' });
  }
  return diagnostics;
}

function buildExternalWriteStatusJournal({
  programId,
  operation,
  status,
  writeEffects,
  route,
  lifecycleGate,
  dispatch,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  acceptancePacket,
  persistedStatus,
  boundaryTicket,
  boundaryAuditHandoff,
  providerHealth,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const baseKey = {
    programId,
    operation,
    idempotencyKey: route?.idempotencyKey ?? null,
    commandId: providerCommand?.commandId ?? null,
    statusChannel: route?.statusChannel ?? null
  };
  const checkpoints = [
    journalCheckpoint('requested', status, {
      effectCount: writeEffects.length,
      denied: false,
      digest: stableHash({ ...baseKey, effects: writeEffects })
    }),
    journalCheckpoint('tenant_boundary', boundaryTicket?.state ?? 'unknown', {
      ready: boundaryTicket?.ready === true || !writeRequired,
      digest: boundaryTicket?.auditDigest ?? null,
      nextAction: boundaryTicket?.nextAction ?? null
    }),
    journalCheckpoint('provider_command', providerCommand?.state ?? 'unknown', {
      ready: Boolean(providerCommand?.commandId) || !writeRequired,
      digest: providerCommand?.replay?.commandDigest ?? null,
      nextAction: providerCommand?.nextAction ?? null
    }),
    journalCheckpoint('client_request', clientRequestSnapshot?.state ?? 'unknown', {
      ready: clientRequestSnapshot?.ready === true || !writeRequired,
      digest: clientRequestSnapshot?.digest ?? null,
      nextAction: clientRequestSnapshot?.nextAction ?? null
    }),
    journalCheckpoint('persisted_status', persistedStatus?.state ?? 'unknown', {
      ready: persistedStatus?.ready === true || !writeRequired,
      digest: persistedStatus?.digest ?? null,
      nextAction: persistedStatus?.nextAction ?? null
    })
  ];
  const latestCheckpoint = checkpoints[checkpoints.length - 1] ?? null;
  const blockers = uniqueSorted([
    ...(persistedStatus?.blockers ?? []),
    ...(boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(boundaryAuditHandoff?.blockers ?? []).map((blocker) => `audit_${blocker}`),
    ...(clientRequestSnapshot?.blockers ?? []).map((blocker) => `client_request_${blocker}`),
    ...(providerHealth?.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
    ...(!route?.idempotencyKey && writeRequired ? ['missing_journal_idempotency_key'] : []),
    ...(!route?.statusChannel && writeRequired ? ['missing_journal_status_channel'] : []),
    ...(!providerCommand?.commandId && writeRequired ? ['missing_journal_command_id'] : []),
    ...(!persistedStatus?.digest && writeRequired ? ['missing_journal_status_digest'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_journal_client_request_digest'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : persistedStatus.state === 'held'
        ? 'held'
        : persistedStatus.state === 'scheduled'
          ? 'scheduled'
          : persistedStatus.ready === true
            ? 'ready'
            : 'waiting';
  const digestShape = {
    ...baseKey,
    state,
    checkpoints: checkpoints.map((checkpoint) => `${checkpoint.phase}:${checkpoint.state}:${checkpoint.digest ?? ''}`),
    persistedStatusDigest: persistedStatus?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null,
    resumeGeneration: persistedStatus?.resume?.generation ?? kernelCall?.runtimeState?.continuationState?.generation ?? 0
  };
  const journalDigest = stableHash(digestShape);
  const commandBase = {
    journalDigest,
    programId,
    operation,
    idempotencyKey: route?.idempotencyKey ?? null
  };
  const commands = writeRequired ? [
    {
      type: 'append-external-write-status-journal',
      commandId: `status-journal:${journalDigest}`,
      idempotencyKey: stableHash({ ...commandBase, action: 'append-external-write-status-journal' }),
      statusAfterReplay: state,
      conflict: 'return-existing',
      writes: ['latestCheckpoint', 'statusDigest', 'clientRequestDigest', 'restartPolicy']
    },
    ...(state === 'blocked' ? [{
      type: 'hold-external-write-status-journal',
      commandId: `status-journal-hold:${stableHash({ journalDigest, blockers })}`,
      idempotencyKey: stableHash({ ...commandBase, action: 'hold-external-write-status-journal', blockers }),
      statusAfterReplay: 'needs_operator_review',
      conflict: 'return-existing',
      writes: ['blockers', 'nextAction']
    }] : [])
  ] : [];
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.status-journal`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    journalKey: route?.idempotencyKey ? `external-write:${route.idempotencyKey}` : null,
    statusChannel: route?.statusChannel ?? null,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    restartToken: persistedStatus?.restartToken ?? clientRuntimeHandoff?.resume?.restartToken ?? null,
    latestCheckpoint,
    checkpoints,
    commands,
    restartSemantics: {
      restartSafe: state === 'ready' || state === 'held' || state === 'scheduled',
      onRestart: state === 'ready'
        ? 'load_latest_status_journal_checkpoint'
        : state === 'held'
          ? 'resume_manual_hold_from_status_journal'
          : state === 'scheduled'
            ? 'resume_schedule_from_status_journal'
            : state === 'blocked'
              ? 'hold_for_status_journal_repair'
              : writeRequired
                ? 'wait_for_persisted_status_checkpoint'
                : 'continue_read_only',
      onDuplicateCommand: 'return_existing_status_journal_entry',
      onStaleCheckpoint: 'reload_latest_status_journal_before_replay'
    },
    clientRequest: {
      digest: clientRequestSnapshot?.digest ?? null,
      requestKey: clientRequestSnapshot?.requestKey ?? null,
      visibleStatus: clientRequestSnapshot?.visibleStatus?.current ?? persistedStatus?.userVisibleStatus?.current ?? null
    },
    persistedStatusDigest: persistedStatus?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null,
    providerHealthStatus: providerHealth?.status ?? 'unknown',
    dispatchStatus: dispatch?.status ?? 'unknown',
    lifecycleState: lifecycleGate?.state ?? 'unknown',
    blockers,
    nextAction: state === 'blocked'
      ? statusJournalAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'append_external_write_status_journal'
            : writeRequired
              ? persistedStatus?.nextAction ?? acceptancePacket?.nextAction ?? syncMetadata?.nextAction ?? 'wait_for_persisted_status'
              : 'continue_read_only',
    digest: journalDigest
  };
}

function journalCheckpoint(phase, state, detail = {}) {
  return {
    phase,
    state,
    ready: detail.ready === true,
    digest: detail.digest ?? null,
    nextAction: detail.nextAction ?? null,
    effectCount: detail.effectCount,
    denied: detail.denied
  };
}

function validateExternalWriteStatusJournal(journal, writeEffects) {
  if (!writeEffects.length && !journal) return [];
  const diagnostics = [];
  if (!journal) return [{ level: 'error', code: 'external_write_missing_status_journal' }];
  if (writeEffects.length && journal.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_status_journal_not_write_required' });
  }
  if (journal.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_status_journal_blocked', blockers: journal.blockers ?? [] });
  }
  if (journal.ready && writeEffects.length && !journal.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_status_journal_missing_digest' });
  }
  if (journal.ready && writeEffects.length && !journal.commands?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_status_journal_missing_command' });
  }
  if (writeEffects.length && !journal.latestCheckpoint?.phase) {
    diagnostics.push({ level: 'error', code: 'external_write_status_journal_missing_latest_checkpoint' });
  }
  if (writeEffects.length && journal.restartSemantics?.restartSafe !== true && ['ready', 'held', 'scheduled'].includes(journal.state)) {
    diagnostics.push({ level: 'warning', code: 'external_write_status_journal_not_restart_safe' });
  }
  return diagnostics;
}

function statusJournalAction(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_before_status_journal';
  if (String(blocker).includes('audit')) return 'repair_boundary_audit_before_status_journal';
  if (String(blocker).includes('client_request')) return 'persist_client_request_before_status_journal';
  if (String(blocker).includes('command_id')) return 'persist_provider_command_before_status_journal';
  if (String(blocker).includes('idempotency')) return 'persist_idempotency_key_before_status_journal';
  if (String(blocker).includes('status_channel')) return 'bind_status_channel_before_status_journal';
  if (String(blocker).includes('status_digest')) return 'persist_external_write_status_before_journal';
  return 'operator_review_status_journal';
}

function buildExternalWriteExportLedger({
  programId,
  operation,
  status,
  writeEffects,
  route,
  lifecycleGate,
  providerHealth,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  acceptancePacket,
  persistedStatus,
  boundaryTicket,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const kernelSnapshotDigest = kernelCall?.analytics
    ? stableHash({
        counters: kernelCall.analytics.counters ?? {},
        exportReady: kernelCall.analytics.exportReady === true,
        healthStatus: kernelCall.analytics.healthStatus ?? null
      })
    : null;
  const timeline = [
    {
      phase: 'write_contract',
      state: status,
      ready: !writeRequired || status === 'ready',
      digest: stableHash({ programId, operation, status, writeEffects })
    },
    {
      phase: 'provider_command',
      state: providerCommand?.state ?? 'unknown',
      ready: !writeRequired || providerCommand?.state === 'ready',
      digest: providerCommand?.replay?.commandDigest ?? null
    },
    {
      phase: 'client_request_snapshot',
      state: clientRequestSnapshot?.state ?? 'unknown',
      ready: clientRequestSnapshot?.ready === true || !writeRequired,
      digest: clientRequestSnapshot?.digest ?? null
    },
    {
      phase: 'acceptance',
      state: acceptancePacket?.acceptanceState ?? 'unknown',
      ready: !writeRequired || acceptancePacket?.acceptEnabled === true,
      digest: stableHash({
        commandId: acceptancePacket?.commandId ?? null,
        acceptanceState: acceptancePacket?.acceptanceState ?? null,
        missingAcknowledgements: acceptancePacket?.missingAcknowledgements ?? []
      })
    },
    {
      phase: 'persisted_status',
      state: persistedStatus?.state ?? 'unknown',
      ready: persistedStatus?.ready === true,
      digest: persistedStatus?.digest ?? null
    },
    {
      phase: 'tenant_boundary',
      state: boundaryTicket?.state ?? 'unknown',
      ready: boundaryTicket?.ready === true || !writeRequired,
      digest: boundaryTicket?.auditDigest ?? null
    }
  ];
  const blockers = uniqueSorted([
    ...(providerCommand?.blockers ?? []).map((blocker) => `provider_${blocker}`),
    ...(acceptancePacket?.blockers ?? []).map((blocker) => `acceptance_${blocker}`),
    ...(persistedStatus?.blockers ?? []).map((blocker) => `persisted_${blocker}`),
    ...(clientRequestSnapshot?.blockers ?? []).map((blocker) => `client_request_${blocker}`),
    ...(boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(providerHealth?.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
    ...(lifecycleGate?.blockers ?? []),
    ...(!route?.statusChannel && writeRequired ? ['missing_export_status_channel'] : []),
    ...(!route?.idempotencyKey && writeRequired ? ['missing_export_idempotency_key'] : []),
    ...(!persistedStatus?.digest && writeRequired ? ['missing_export_status_digest'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(acceptancePacket?.warnings ?? []),
    ...(persistedStatus?.resume?.safeToResume === false && writeRequired ? ['export_resume_token_missing'] : []),
    ...(providerHealth?.degraded ? ['export_provider_degraded'] : []),
    ...(lifecycleGate?.warnings ?? [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : persistedStatus?.state === 'held'
        ? 'held'
        : persistedStatus?.state === 'scheduled'
          ? 'scheduled'
          : persistedStatus?.ready && acceptancePacket?.acceptEnabled
            ? 'ready'
            : 'waiting';
  const digestShape = {
    programId,
    operation,
    state,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? null,
    kernelSnapshotDigest
  };
  const digest = stableHash(digestShape);
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.export-ledger`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    exportStatus: state === 'ready'
      ? 'export_ready'
      : state === 'not_required'
        ? 'read_only_export'
        : state === 'held'
          ? 'manual_release_pending'
          : state === 'scheduled'
            ? 'schedule_window_pending'
            : state === 'blocked'
              ? 'export_blocked'
              : 'export_waiting',
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    auditChannel: route?.auditChannel ?? null,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    commandDigest: providerCommand?.replay?.commandDigest ?? persistedStatus?.commandDigest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? null,
    kernelSnapshotDigest,
    changedSinceKernelSnapshot: Boolean(kernelSnapshotDigest && kernelSnapshotDigest !== digest),
    latestCheckpoint: timeline.at(-1) ?? null,
    timeline,
    counters: {
      checkpointCount: timeline.length,
      readyCheckpointCount: timeline.filter((checkpoint) => checkpoint.ready).length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      writeEffectCount: writeEffects.length
    },
    scope: {
      tenantId: route?.tenantId ?? null,
      workspaceId: route?.workspaceId ?? null,
      isolationKey: route?.isolationKey ?? null
    },
    userVisibleStatus: {
      current: persistedStatus?.userVisibleStatus?.current ?? clientRuntimeHandoff?.userVisibleStatus?.pending ?? persistedWriteStatus(state),
      completion: persistedStatus?.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: persistedStatus?.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? externalWriteExportAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'publish_external_write_export_ledger'
            : writeRequired
              ? acceptancePacket?.nextAction ?? persistedStatus?.nextAction ?? 'wait_for_external_write_export_ledger'
              : 'continue_read_only',
    digest
  };
}

function validateExternalWriteExportLedger(ledger, writeEffects) {
  if (!writeEffects.length && !ledger) return [];
  const diagnostics = [];
  if (!ledger) return [{ level: 'error', code: 'external_write_missing_export_ledger' }];
  if (writeEffects.length && ledger.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_export_ledger_not_write_required' });
  }
  if (ledger.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_export_ledger_blocked', blockers: ledger.blockers ?? [] });
  }
  if (ledger.ready && writeEffects.length && !ledger.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_export_ledger_missing_digest' });
  }
  if (ledger.ready && writeEffects.length && !ledger.persistedStatusDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_export_ledger_missing_status_digest' });
  }
  if (ledger.ready && writeEffects.length && !ledger.timeline?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_export_ledger_missing_timeline' });
  }
  return diagnostics;
}

function buildExternalWriteReplayManifest({
  programId,
  operation,
  status,
  writeEffects,
  route,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  acceptancePacket,
  persistedStatus,
  exportLedger,
  boundaryTicket,
  providerHealth,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const restartToken = persistedStatus?.restartToken
    ?? clientRuntimeHandoff?.resume?.restartToken
    ?? syncMetadata?.restartToken
    ?? null;
  const replayCursor = stableHash({
    requestKey: clientRequestSnapshot?.requestKey ?? null,
    commandId: providerCommand?.commandId ?? null,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    restartToken
  });
  const commandSources = [
    ...(clientRequestSnapshot?.commands ?? []).map((command) => ({
      phase: 'client_request',
      type: command.type,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      statusAfterReplay: command.statusAfterReplay,
      conflict: command.conflict ?? 'return-existing',
      digest: stableHash(command)
    })),
    ...(providerCommand?.required ? [{
      phase: 'provider_command',
      type: 'publish-mailchimp-provider-command',
      commandId: providerCommand.commandId,
      idempotencyKey: providerCommand.idempotencyKey,
      statusAfterReplay: providerCommand.state,
      conflict: 'return-existing',
      digest: providerCommand.replay?.commandDigest ?? stableHash(providerCommand)
    }] : []),
    ...(acceptancePacket?.writeRequired ? [{
      phase: 'acceptance',
      type: 'publish-external-write-acceptance',
      commandId: acceptancePacket.commandId ? `acceptance:${acceptancePacket.commandId}` : null,
      idempotencyKey: stableHash({
        commandId: acceptancePacket.commandId,
        routeIdempotencyKey: acceptancePacket.idempotencyKey,
        action: 'publish-external-write-acceptance'
      }),
      statusAfterReplay: acceptancePacket.acceptanceState,
      conflict: 'return-existing',
      digest: stableHash({
        commandId: acceptancePacket.commandId,
        acceptanceState: acceptancePacket.acceptanceState,
        missingAcknowledgements: acceptancePacket.missingAcknowledgements ?? []
      })
    }] : []),
    ...(persistedStatus?.writeRequired ? [{
      phase: 'persisted_status',
      type: 'persist-external-write-status',
      commandId: persistedStatus.commandId ? `persisted:${persistedStatus.commandId}` : null,
      idempotencyKey: stableHash({
        commandId: persistedStatus.commandId,
        digest: persistedStatus.digest,
        action: 'persist-external-write-status'
      }),
      statusAfterReplay: persistedStatus.state,
      conflict: 'return-existing',
      digest: persistedStatus.digest
    }] : [])
  ];
  const commands = commandSources
    .filter((command) => command.commandId || !writeRequired)
    .map((command, index) => ({
      index,
      phase: command.phase,
      type: command.type,
      commandId: command.commandId ?? `noop:${index}`,
      idempotencyKey: command.idempotencyKey ?? stableHash({ replayCursor, index, type: command.type }),
      statusAfterReplay: command.statusAfterReplay ?? 'unknown',
      conflict: command.conflict,
      digest: command.digest
    }));
  const duplicateKeys = commands
    .map((command) => command.idempotencyKey)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  const blockers = uniqueSorted([
    ...(persistedStatus?.blockers ?? []).map((blocker) => `persisted_${blocker}`),
    ...(exportLedger?.blockers ?? []).map((blocker) => `export_${blocker}`),
    ...(boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(providerHealth?.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
    ...(!commands.length && writeRequired ? ['missing_replay_commands'] : []),
    ...(!providerCommand?.commandId && writeRequired ? ['missing_replay_provider_command'] : []),
    ...(!route?.idempotencyKey && writeRequired ? ['missing_replay_idempotency_key'] : []),
    ...(!route?.statusChannel && writeRequired ? ['missing_replay_status_channel'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_replay_client_request_digest'] : []),
    ...(!persistedStatus?.digest && writeRequired ? ['missing_replay_persisted_status_digest'] : []),
    ...(!exportLedger?.digest && writeRequired ? ['missing_replay_export_ledger_digest'] : []),
    ...(duplicateKeys.length ? ['duplicate_replay_idempotency_key'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : persistedStatus?.state === 'held' || exportLedger?.state === 'held'
        ? 'held'
        : persistedStatus?.state === 'scheduled' || exportLedger?.state === 'scheduled'
          ? 'scheduled'
          : persistedStatus?.ready && exportLedger?.ready
            ? 'ready'
            : 'waiting';
  const restartSafe = !writeRequired
    || (blockers.length === 0
      && commands.every((command) => command.idempotencyKey && command.conflict === 'return-existing')
      && (Boolean(restartToken) || kernelCall?.handoff?.continuationMode === 'none'));
  const digestShape = {
    programId,
    operation,
    state,
    sourceStatus: status,
    commandIds: commands.map((command) => command.commandId),
    idempotencyKeys: commands.map((command) => command.idempotencyKey),
    replayCursor,
    restartToken,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.replay-manifest`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    restartSafe,
    writeRequired,
    replayCursor,
    restartToken,
    statusChannel: route?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    commandId: providerCommand?.commandId ?? null,
    commands,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? null,
    restartSemantics: {
      onRestart: restartSafe ? 'load_replay_manifest_and_return_current_status' : 'hold_for_replay_repair',
      onDuplicateCommand: 'return_existing_command_result',
      onStaleSnapshot: 'reload_latest_status_before_replay',
      onMissingStatus: 'rebuild_from_client_request_snapshot',
      onProviderUnavailable: providerHealth?.retryable === false ? 'hold_for_provider_repair' : 'retry_after_provider_backoff'
    },
    userVisibleStatus: {
      current: persistedStatus?.userVisibleStatus?.current ?? clientRuntimeHandoff?.userVisibleStatus?.pending ?? persistedWriteStatus(state),
      replaying: state === 'ready' ? 'restoring_mailchimp_write_status' : 'repairing_mailchimp_write_replay',
      completion: persistedStatus?.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: persistedStatus?.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    blockers,
    nextAction: state === 'blocked'
      ? externalWriteReplayAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'persist_external_write_replay_manifest'
            : writeRequired
              ? persistedStatus?.nextAction ?? exportLedger?.nextAction ?? 'wait_for_replay_manifest_inputs'
              : 'continue_read_only',
    digest: stableHash(digestShape)
  };
}

function validateExternalWriteReplayManifest(manifest, writeEffects) {
  if (!writeEffects.length && !manifest) return [];
  const diagnostics = [];
  if (!manifest) return [{ level: 'error', code: 'external_write_missing_replay_manifest' }];
  if (writeEffects.length && manifest.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_replay_manifest_not_write_required' });
  }
  if (manifest.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_replay_manifest_blocked', blockers: manifest.blockers ?? [] });
  }
  if (manifest.ready && writeEffects.length && manifest.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_replay_manifest_not_restart_safe' });
  }
  if (manifest.ready && writeEffects.length && !manifest.replayCursor) {
    diagnostics.push({ level: 'error', code: 'external_write_replay_manifest_missing_cursor' });
  }
  if (manifest.ready && writeEffects.length && !manifest.commands?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_replay_manifest_missing_commands' });
  }
  const missingKeys = (manifest.commands ?? []).filter((command) => !command.idempotencyKey);
  if (missingKeys.length) {
    diagnostics.push({ level: 'error', code: 'external_write_replay_manifest_command_missing_idempotency_key' });
  }
  return diagnostics;
}

function externalWriteReplayAction(blocker) {
  if (String(blocker).includes('client_request')) return 'rebuild_client_request_snapshot';
  if (String(blocker).includes('persisted')) return 'persist_external_write_status';
  if (String(blocker).includes('export')) return 'publish_external_write_export_ledger';
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('provider_health')) return 'resolve_provider_health';
  if (String(blocker).includes('provider_command') || String(blocker).includes('command')) return 'persist_provider_command_id';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  return 'repair_external_write_replay_manifest';
}

function buildExternalWriteOperatorReadiness({
  programId,
  operation,
  status,
  writeEffects,
  route,
  lifecycleGate,
  dispatch,
  providerHealth,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  acceptancePacket,
  persistedStatus,
  exportLedger,
  replayManifest,
  boundaryTicket,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const lifecycleDecision = normalizeKernelLifecycleDecision(kernelCall?.lifecycle?.operatorDecision);
  const phaseChecks = [
    {
      phase: 'lifecycle_operator_decision',
      state: lifecycleDecision.state,
      ready: lifecycleDecision.ready || !writeRequired,
      action: lifecycleDecision.nextAction ?? 'review_lifecycle_operator_decision',
      blockerCodes: lifecycleDecision.blockers.map((blocker) => `lifecycle_${blocker}`),
      warningCodes: lifecycleDecision.warnings.map((warning) => `lifecycle_${warning}`)
    },
    {
      phase: 'tenant_boundary',
      state: boundaryTicket?.state ?? 'unknown',
      ready: boundaryTicket?.ready === true || !writeRequired,
      action: boundaryTicket?.nextAction ?? 'repair_tenant_boundary_ticket',
      blockerCodes: (boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
      warningCodes: (boundaryTicket?.warnings ?? []).map((warning) => `boundary_${warning}`)
    },
    {
      phase: 'provider_health',
      state: providerHealth?.status ?? 'unknown',
      ready: providerHealth?.ready === true || !writeRequired,
      action: providerHealth?.nextAction ?? 'resolve_provider_health',
      blockerCodes: (providerHealth?.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
      warningCodes: (providerHealth?.warnings ?? []).map((warning) => `provider_health_${warning}`)
    },
    {
      phase: 'provider_command',
      state: providerCommand?.state ?? 'unknown',
      ready: providerCommand?.state === 'ready' || providerCommand?.required === false || !writeRequired,
      action: providerCommand?.nextAction ?? 'publish_mailchimp_provider_command',
      blockerCodes: (providerCommand?.blockers ?? []).map((blocker) => `provider_${blocker}`),
      warningCodes: [
        ...(providerCommand?.state === 'held' ? ['provider_command_held'] : []),
        ...(providerCommand?.state === 'scheduled' ? ['provider_command_scheduled'] : [])
      ]
    },
    {
      phase: 'client_runtime_handoff',
      state: clientRuntimeHandoff?.state ?? 'unknown',
      ready: clientRuntimeHandoff?.ready === true || !writeRequired,
      action: clientRuntimeHandoff?.nextAction ?? 'render_external_write_confirmation',
      blockerCodes: (clientRuntimeHandoff?.blockers ?? []).map((blocker) => `client_${blocker}`),
      warningCodes: []
    },
    {
      phase: 'client_request_snapshot',
      state: clientRequestSnapshot?.state ?? 'unknown',
      ready: clientRequestSnapshot?.ready === true || !writeRequired,
      action: clientRequestSnapshot?.nextAction ?? 'persist_client_request_snapshot',
      blockerCodes: (clientRequestSnapshot?.blockers ?? []).map((blocker) => `client_request_${blocker}`),
      warningCodes: []
    },
    {
      phase: 'operator_acceptance',
      state: acceptancePacket?.acceptanceState ?? 'unknown',
      ready: acceptancePacket?.acceptEnabled === true || !writeRequired,
      action: acceptancePacket?.nextAction ?? 'publish_external_write_acceptance',
      blockerCodes: acceptancePacket?.blockers ?? [],
      warningCodes: acceptancePacket?.warnings ?? []
    },
    {
      phase: 'persisted_status',
      state: persistedStatus?.state ?? 'unknown',
      ready: persistedStatus?.ready === true || !writeRequired,
      action: persistedStatus?.nextAction ?? 'persist_external_write_status',
      blockerCodes: (persistedStatus?.blockers ?? []).map((blocker) => `persisted_${blocker}`),
      warningCodes: persistedStatus?.resume?.safeToResume === false ? ['persisted_restart_token_missing'] : []
    },
    {
      phase: 'export_ledger',
      state: exportLedger?.state ?? 'unknown',
      ready: exportLedger?.ready === true || !writeRequired,
      action: exportLedger?.nextAction ?? 'publish_external_write_export_ledger',
      blockerCodes: (exportLedger?.blockers ?? []).map((blocker) => `export_${blocker}`),
      warningCodes: exportLedger?.warnings ?? []
    },
    {
      phase: 'replay_manifest',
      state: replayManifest?.state ?? 'unknown',
      ready: replayManifest?.ready === true || !writeRequired,
      action: replayManifest?.nextAction ?? 'persist_external_write_replay_manifest',
      blockerCodes: (replayManifest?.blockers ?? []).map((blocker) => `replay_${blocker}`),
      warningCodes: replayManifest?.restartSafe === false && writeRequired ? ['replay_manifest_not_restart_safe'] : []
    }
  ];
  const blockers = uniqueSorted(phaseChecks.flatMap((check) => check.ready ? [] : check.blockerCodes.length ? check.blockerCodes : [`${check.phase}_not_ready`]));
  const warnings = uniqueSorted([
    ...phaseChecks.flatMap((check) => check.warningCodes),
    ...(status === 'review' ? ['external_write_status_review'] : []),
    ...(lifecycleGate?.warnings ?? []),
    ...(dispatch?.status === 'held' ? ['external_write_manual_release_pending'] : []),
    ...(dispatch?.status === 'scheduled' ? ['external_write_schedule_window_pending'] : []),
    ...(providerHealth?.degraded ? ['provider_health_degraded'] : [])
  ]);
  const waitingPhase = phaseChecks.find((check) => check.ready !== true);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : dispatch?.status === 'held'
        ? 'held'
        : dispatch?.status === 'scheduled'
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : 'ready';
  const nextSteps = phaseChecks
    .filter((check) => check.ready !== true || check.warningCodes.length)
    .map((check, index) => ({
      index,
      phase: check.phase,
      state: check.state,
      action: check.ready ? acknowledgementActionForWarning(check.warningCodes[0]) : check.action,
      reason: check.ready ? check.warningCodes[0] ?? 'review_recommended' : check.blockerCodes[0] ?? `${check.phase}_not_ready`,
      terminal: false
    }));
  if (!nextSteps.length) {
    nextSteps.push({
      index: 0,
      phase: writeRequired ? 'external_write' : 'read_only',
      state,
      action: writeRequired ? 'publish_external_write_ready_state' : 'continue_read_only',
      reason: writeRequired ? 'external_write_ready' : 'external_write_not_requested',
      terminal: true
    });
  }
  const digestShape = {
    programId,
    operation,
    state,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    replayManifestDigest: replayManifest?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? null,
    lifecycleDecisionDigest: lifecycleDecision.digest ?? null,
    blockers,
    warnings
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operator-readiness`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    userVisibleStatus: operatorReadinessStatus(state),
    primaryAction: state === 'blocked'
      ? operatorReadinessAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? nextSteps[0]?.action ?? 'confirm_write_handoff'
            : writeRequired
              ? 'publish_external_write_ready_state'
              : 'continue_read_only',
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    auditChannel: route?.auditChannel ?? null,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    replayManifestDigest: replayManifest?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? null,
    lifecycleDecision,
    providerHealth: {
      status: providerHealth?.status ?? 'unknown',
      ready: providerHealth?.ready ?? false,
      degraded: providerHealth?.degraded ?? false,
      retryable: providerHealth?.retryable ?? true,
      retryAfterMs: providerHealth?.retryAfterMs ?? null
    },
    phaseChecks,
    nextSteps,
    blockers,
    warnings,
    digest: stableHash(digestShape)
  };
}

function validateExternalWriteOperatorReadiness(readiness, writeEffects) {
  if (!writeEffects.length && !readiness) return [];
  const diagnostics = [];
  if (!readiness) return [{ level: 'error', code: 'external_write_missing_operator_readiness' }];
  if (writeEffects.length && readiness.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_readiness_not_write_required' });
  }
  if (readiness.ready && readiness.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_operator_readiness_ready_with_blockers',
      blockers: readiness.blockers
    });
  }
  if (readiness.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_operator_readiness_blocked', blockers: readiness.blockers ?? [] });
  }
  if (readiness.ready && writeEffects.length && !readiness.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_readiness_missing_command_id' });
  }
  if (readiness.ready && writeEffects.length && !readiness.persistedStatusDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_readiness_missing_status_digest' });
  }
  if (readiness.ready && writeEffects.length && !readiness.exportLedgerDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_readiness_missing_export_digest' });
  }
  if (readiness.ready && writeEffects.length && !readiness.replayManifestDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_readiness_missing_replay_digest' });
  }
  if (readiness.lifecycleDecision?.requiresAcknowledgement && !readiness.lifecycleDecision?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_readiness_missing_lifecycle_acknowledgement' });
  }
  if (readiness.state === 'review' || readiness.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_operator_readiness_review', warnings: readiness.warnings ?? [] });
  }
  return diagnostics;
}

function normalizeKernelLifecycleDecision(decision = {}) {
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
    selectedCommand: decision?.selectedCommand?.action ?? null,
    selectedCommandId: decision?.selectedCommand?.id ?? null,
    effectiveEnabled: decision?.effectiveEnabled ?? true,
    scheduleStatus: decision?.scheduleStatus ?? null,
    requiresAcknowledgement: decision?.requiresAcknowledgement === true,
    acknowledgementToken: decision?.acknowledgement?.token ?? null,
    acknowledgementReason: decision?.acknowledgement?.reason ?? null,
    blockers,
    warnings,
    nextAction: decision?.nextAction ?? null,
    digest: decision?.digest ?? null
  };
}

function buildExternalWriteOperationalHealth({
  programId,
  operation,
  status,
  writeEffects,
  route,
  lifecycleGate,
  providerHealth,
  providerCommand,
  persistedStatus,
  exportLedger,
  replayManifest,
  operatorReadiness,
  diagnostics,
  kernelCall
}) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.level === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.level === 'warning');
  const actionableErrors = errors.map((diagnostic, index) => ({
    index,
    code: diagnostic.code,
    source: externalWriteDiagnosticSource(diagnostic.code),
    retryable: externalWriteDiagnosticRetryable(diagnostic.code, providerHealth),
    action: externalWriteActionForDiagnostic(diagnostic.code),
    detail: diagnostic.blockers ?? diagnostic.claims ?? diagnostic.effects ?? null
  }));
  const retryAttempt = Math.max(0, Number(kernelCall?.recovery?.retry?.attempt ?? kernelCall?.health?.retry?.attempt ?? 0));
  const maxAttempts = Math.max(1, Number(kernelCall?.recovery?.retry?.maxAttempts ?? kernelCall?.health?.retry?.maxAttempts ?? 3));
  const providerRetryAfter = Number(providerHealth?.retryAfterMs);
  const fallbackDelay = Math.min(30000, 1000 * (2 ** Math.min(retryAttempt, 5)));
  const retryable = providerHealth?.retryable !== false
    && actionableErrors.every((error) => error.retryable !== false)
    && retryAttempt < maxAttempts;
  const degraded = providerHealth?.degraded === true
    || warnings.length > 0
    || operatorReadiness?.state === 'review'
    || lifecycleGate?.state === 'held'
    || lifecycleGate?.state === 'scheduled';
  const failureState = errors.length
    ? retryable
      ? 'retryable_failure'
      : 'failed'
    : degraded
      ? 'degraded'
      : status === 'read_only'
        ? 'not_required'
        : 'healthy';
  const state = failureState === 'failed'
    ? 'blocked'
    : failureState === 'retryable_failure'
      ? 'retry_scheduled'
      : degraded
        ? 'degraded'
        : status === 'read_only'
          ? 'not_required'
          : 'ready';
  const retryAfterMs = retryable
    ? Number.isFinite(providerRetryAfter) && providerRetryAfter > 0
      ? providerRetryAfter
      : fallbackDelay
    : null;
  const digestShape = {
    programId,
    operation,
    state,
    failureState,
    providerStatus: providerHealth?.status ?? 'unknown',
    providerCommandState: providerCommand?.state ?? 'unknown',
    persistedStatusState: persistedStatus?.state ?? 'unknown',
    exportLedgerState: exportLedger?.state ?? 'unknown',
    replayManifestState: replayManifest?.state ?? 'unknown',
    operatorReadinessState: operatorReadiness?.state ?? 'unknown',
    errors: actionableErrors.map((error) => `${error.code}:${error.retryable}`),
    warnings: warnings.map((warning) => warning.code),
    retryAttempt,
    retryAfterMs
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operational-health`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    failureState,
    degraded,
    writeRequired: writeEffects.length > 0,
    statusChannel: route?.statusChannel ?? null,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    providerStatus: providerHealth?.status ?? 'unknown',
    lifecycleState: lifecycleGate?.state ?? 'unknown',
    retry: {
      retryable,
      scheduled: retryable && errors.length > 0,
      attempt: retryAttempt,
      maxAttempts,
      retryAfterMs,
      backoffPolicy: retryable ? 'exponential_with_provider_override' : 'none',
      exhausted: retryAttempt >= maxAttempts
    },
    degradedMode: degraded ? {
      mode: lifecycleGate?.state === 'held'
        ? 'manual_release_hold'
        : lifecycleGate?.state === 'scheduled'
          ? 'schedule_window_hold'
          : providerHealth?.degraded
            ? 'provider_degraded'
            : 'operator_review',
      allowDispatch: errors.length === 0 && providerCommand?.state !== 'blocked',
      requiresAcknowledgement: warnings.length > 0 || providerHealth?.degraded === true
    } : null,
    dependencies: [
      { name: 'provider-command', state: providerCommand?.state ?? 'unknown', ready: providerCommand?.state === 'ready' || !writeEffects.length },
      { name: 'persisted-status', state: persistedStatus?.state ?? 'unknown', ready: persistedStatus?.ready === true || !writeEffects.length },
      { name: 'export-ledger', state: exportLedger?.state ?? 'unknown', ready: exportLedger?.ready === true || !writeEffects.length },
      { name: 'replay-manifest', state: replayManifest?.state ?? 'unknown', ready: replayManifest?.ready === true || !writeEffects.length },
      { name: 'operator-readiness', state: operatorReadiness?.state ?? 'unknown', ready: operatorReadiness?.ready === true || !writeEffects.length }
    ],
    actionableErrors,
    warnings: warnings.map((warning) => ({
      code: warning.code,
      source: externalWriteDiagnosticSource(warning.code),
      action: externalWriteActionForDiagnostic(warning.code)
    })),
    nextAction: actionableErrors[0]?.action
      ?? (degraded ? externalWriteDegradedAction(lifecycleGate, providerHealth, warnings) : null)
      ?? (writeEffects.length ? 'publish_external_write_ready_state' : 'continue_read_only'),
    digest: stableHash(digestShape)
  };
}

function validateExternalWriteOperationalHealth(health, writeEffects) {
  if (!writeEffects.length && !health) return [];
  const diagnostics = [];
  if (!health) return [{ level: 'error', code: 'external_write_missing_operational_health' }];
  if (writeEffects.length && health.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_operational_health_not_write_required' });
  }
  if (health.ready && health.actionableErrors?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_operational_health_ready_with_errors',
      errors: health.actionableErrors.map((error) => error.code)
    });
  }
  if (health.failureState === 'failed') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_operational_health_failed',
      errors: health.actionableErrors?.map((error) => error.code) ?? []
    });
  }
  if (health.retry?.scheduled && !health.retry?.retryAfterMs) {
    diagnostics.push({ level: 'error', code: 'external_write_retry_missing_backoff' });
  }
  if (health.degraded && !health.degradedMode) {
    diagnostics.push({ level: 'warning', code: 'external_write_degraded_mode_missing' });
  }
  return diagnostics;
}

function buildExternalWriteAnalyticsExport({
  programId,
  operation,
  status,
  writeEffects,
  deniedEffects,
  route,
  lifecycleGate,
  providerHealth,
  dispatch,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  acceptancePacket,
  persistedStatus,
  exportLedger,
  replayManifest,
  operatorReadiness,
  operationalHealth,
  boundaryTicket,
  boundaryAuditHandoff,
  claimCoverage,
  diagnostics,
  kernelCall
}) {
  const phases = [
    analyticsPhase('scope_boundary', boundaryTicket?.state, boundaryTicket?.ready, boundaryTicket?.blockers, boundaryTicket?.warnings, boundaryTicket?.nextAction),
    analyticsPhase('claim_coverage', claimCoverage?.missing?.length ? 'blocked' : 'ready', !claimCoverage?.missing?.length, claimCoverage?.missing, [], claimCoverage?.missing?.length ? 'collect_required_claims' : 'continue'),
    analyticsPhase('lifecycle_gate', lifecycleGate?.state, lifecycleGate?.ready, lifecycleGate?.blockers, lifecycleGate?.warnings, lifecycleGate?.nextAction),
    analyticsPhase('provider_health', providerHealth?.status, providerHealth?.ready, providerHealth?.blockers, providerHealth?.warnings, providerHealth?.nextAction),
    analyticsPhase('provider_command', providerCommand?.state, providerCommand?.state === 'ready' || !writeEffects.length, providerCommand?.blockers, providerCommand?.warnings, providerCommand?.nextAction),
    analyticsPhase('dispatch', dispatch?.status, dispatch?.status !== 'blocked', [], dispatch?.warnings, dispatch?.nextAction),
    analyticsPhase('client_runtime_handoff', clientRuntimeHandoff?.state, clientRuntimeHandoff?.ready, clientRuntimeHandoff?.blockers, clientRuntimeHandoff?.warnings, clientRuntimeHandoff?.nextAction),
    analyticsPhase('client_request_snapshot', clientRequestSnapshot?.state, clientRequestSnapshot?.ready, clientRequestSnapshot?.blockers, clientRequestSnapshot?.warnings, clientRequestSnapshot?.nextAction),
    analyticsPhase('acceptance_packet', acceptancePacket?.acceptanceState, acceptancePacket?.acceptEnabled || !writeEffects.length, acceptancePacket?.blockers, acceptancePacket?.warnings, acceptancePacket?.nextAction),
    analyticsPhase('persisted_status', persistedStatus?.state, persistedStatus?.ready, persistedStatus?.blockers, [], persistedStatus?.nextAction),
    analyticsPhase('export_ledger', exportLedger?.state, exportLedger?.ready, exportLedger?.blockers, exportLedger?.warnings, exportLedger?.nextAction),
    analyticsPhase('replay_manifest', replayManifest?.state, replayManifest?.ready, replayManifest?.blockers, [], replayManifest?.nextAction),
    analyticsPhase('operator_readiness', operatorReadiness?.state, operatorReadiness?.ready, operatorReadiness?.blockers, operatorReadiness?.warnings, operatorReadiness?.nextAction),
    analyticsPhase('operational_health', operationalHealth?.state, operationalHealth?.ready, operationalHealth?.actionableErrors?.map((error) => error.code), operationalHealth?.warnings?.map((warning) => warning.code), operationalHealth?.nextAction)
  ];
  const failedPhases = phases.filter((phase) => phase.outcome === 'failed');
  const degradedPhases = phases.filter((phase) => phase.outcome === 'degraded');
  const blockedDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === 'error');
  const warningDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === 'warning');
  const latestKernelSnapshot = kernelCall?.analytics?.history?.latest ?? kernelCall?.history?.latest ?? null;
  const historySnapshots = [
    {
      id: `ewhist:${stableHash({ programId, operation, phase: 'request', route: route?.statusChannel, effects: writeEffects })}`,
      sequence: 1,
      phase: 'request',
      status,
      writeRequired: writeEffects.length > 0,
      effectCount: writeEffects.length,
      deniedEffectCount: deniedEffects.length,
      statusChannel: route?.statusChannel ?? null,
      idempotencyKey: route?.idempotencyKey ?? null
    },
    {
      id: `ewhist:${stableHash({ programId, operation, phase: 'provider', commandId: providerCommand?.commandId, state: providerCommand?.state })}`,
      sequence: 2,
      phase: 'provider',
      status: providerCommand?.state ?? providerHealth?.status ?? 'unknown',
      commandId: providerCommand?.commandId ?? null,
      providerStatus: providerHealth?.status ?? 'unknown',
      syncReady: syncMetadata?.ready === true,
      retryable: providerHealth?.retryable !== false,
      nextAction: providerCommand?.nextAction ?? providerHealth?.nextAction ?? null
    },
    {
      id: `ewhist:${stableHash({ programId, operation, phase: 'client', requestKey: clientRequestSnapshot?.requestKey, digest: clientRequestSnapshot?.digest })}`,
      sequence: 3,
      phase: 'client_runtime',
      status: clientRuntimeHandoff?.state ?? clientRequestSnapshot?.state ?? 'unknown',
      handoffReady: clientRuntimeHandoff?.ready === true,
      snapshotReady: clientRequestSnapshot?.ready === true,
      requestKey: clientRequestSnapshot?.requestKey ?? null,
      digest: clientRequestSnapshot?.digest ?? null,
      visibleStatus: clientRequestSnapshot?.visibleStatus?.current ?? clientRuntimeHandoff?.userVisibleStatus?.pending ?? null
    },
    {
      id: `ewhist:${stableHash({ programId, operation, phase: 'export', exportDigest: exportLedger?.digest, replayDigest: replayManifest?.digest })}`,
      sequence: 4,
      phase: 'export',
      status: exportLedger?.state ?? 'unknown',
      exportReady: exportLedger?.ready === true,
      exportDigest: exportLedger?.digest ?? null,
      replayDigest: replayManifest?.digest ?? null,
      changedSinceKernelSnapshot: exportLedger?.changedSinceKernelSnapshot ?? false,
      latestCheckpoint: exportLedger?.latestCheckpoint?.phase ?? null
    },
    {
      id: `ewhist:${stableHash({ programId, operation, phase: 'health', digest: operationalHealth?.digest })}`,
      sequence: 5,
      phase: 'health',
      status: operationalHealth?.state ?? 'unknown',
      failureState: operationalHealth?.failureState ?? 'unknown',
      degraded: operationalHealth?.degraded === true,
      retryScheduled: operationalHealth?.retry?.scheduled === true,
      retryAfterMs: operationalHealth?.retry?.retryAfterMs ?? null,
      nextAction: operationalHealth?.nextAction ?? null
    }
  ];
  const timeline = phases.map((phase, index) => ({
    sequence: index + 1,
    event: phase.phase,
    status: phase.status,
    outcome: phase.outcome,
    ready: phase.ready,
    blockerCount: phase.blockers.length,
    warningCount: phase.warnings.length,
    nextAction: phase.nextAction
  }));
  const counters = {
    writeEffectCount: writeEffects.length,
    deniedEffectCount: deniedEffects.length,
    missingClaimCount: claimCoverage?.missing?.length ?? 0,
    phaseCount: phases.length,
    readyPhaseCount: phases.filter((phase) => phase.outcome === 'ready').length,
    failedPhaseCount: failedPhases.length,
    degradedPhaseCount: degradedPhases.length,
    diagnosticErrorCount: blockedDiagnostics.length,
    diagnosticWarningCount: warningDiagnostics.length,
    providerCommandCount: providerCommand?.required ? 1 : 0,
    exportCheckpointCount: exportLedger?.timeline?.length ?? 0,
    replayCommandCount: replayManifest?.commands?.length ?? 0,
    boundaryAuditCommandCount: boundaryAuditHandoff?.commands?.length ?? 0,
    actionableErrorCount: operationalHealth?.actionableErrors?.length ?? 0
  };
  const blockers = uniqueSorted([
    ...failedPhases.map((phase) => `phase_failed:${phase.phase}`),
    ...blockedDiagnostics.map((diagnostic) => diagnostic.code)
  ]);
  const warnings = uniqueSorted([
    ...degradedPhases.map((phase) => `phase_degraded:${phase.phase}`),
    ...warningDiagnostics.map((diagnostic) => diagnostic.code)
  ]);
  const state = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'review'
      : writeEffects.length
        ? 'ready'
        : 'not_required';
  const exportSummary = {
    format: 'aios.mailchimp.external-write.analytics.v1',
    programId,
    operation,
    status: state,
    writeRequired: writeEffects.length > 0,
    exportReady: state === 'ready' || state === 'not_required',
    routeKey: route?.routeKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    counters,
    failedPhases: failedPhases.map((phase) => phase.phase),
    degradedPhases: degradedPhases.map((phase) => phase.phase),
    historySnapshotIds: historySnapshots.map((snapshot) => snapshot.id),
    latestKernelSnapshotDigest: latestKernelSnapshot?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    replayManifestDigest: replayManifest?.digest ?? null,
    operationalHealthDigest: operationalHealth?.digest ?? null
  };
  const operatorActionCard = buildExternalWriteOperatorActionCard({
    programId,
    operation,
    state,
    route,
    providerCommand,
    clientRequestSnapshot,
    acceptancePacket,
    persistedStatus,
    exportLedger,
    replayManifest,
    operatorReadiness,
    operationalHealth,
    counters,
    historySnapshots,
    timeline,
    blockers,
    warnings,
    writeRequired: writeEffects.length > 0
  });
  const digest = stableHash({
    programId,
    operation,
    state,
    counters,
    snapshots: historySnapshots.map((snapshot) => snapshot.id),
    timeline: timeline.map((event) => `${event.event}:${event.outcome}:${event.status}`),
    operatorActionCard: operatorActionCard.digest,
    blockers,
    warnings
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.analytics-export`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired: writeEffects.length > 0,
    counters,
    historySnapshots,
    timeline,
    exportSummary,
    operatorActionCard,
    reporting: {
      channel: route?.auditChannel ?? route?.statusChannel ?? 'kernel.analytics.mailchimp.external_write',
      cadence: writeEffects.length ? 'per_external_write' : 'per_read_only_analysis',
      retention: writeEffects.length ? 'durable_audit' : 'ephemeral_summary',
      latestSnapshotId: historySnapshots.at(-1)?.id ?? null,
      latestSnapshotDigest: stableHash(historySnapshots.at(-1) ?? {}),
      changedSinceKernelSnapshot: latestKernelSnapshot?.digest ? latestKernelSnapshot.digest !== exportLedger?.digest : exportLedger?.changedSinceKernelSnapshot ?? false
    },
    blockers,
    warnings,
    nextAction: blockers.length
      ? externalWriteActionForDiagnostic(blockers[0])
      : warnings.length
        ? externalWriteDegradedAction(lifecycleGate, providerHealth, warningDiagnostics)
        : writeEffects.length
          ? 'publish_external_write_analytics_export'
          : 'continue_read_only',
    digest
  };
}

function buildExternalWriteOperatorActionCard({
  programId,
  operation,
  state,
  route,
  providerCommand,
  clientRequestSnapshot,
  acceptancePacket,
  persistedStatus,
  exportLedger,
  replayManifest,
  operatorReadiness,
  operationalHealth,
  counters,
  historySnapshots,
  timeline,
  blockers,
  warnings,
  writeRequired
}) {
  const ready = (state === 'ready' || state === 'not_required') && !blockers.length;
  const primaryAction = blockers.length
    ? externalWriteActionForDiagnostic(blockers[0])
    : warnings.length
      ? 'review_external_write_action_card'
      : writeRequired
        ? 'confirm_external_write_handoff'
        : 'continue_read_only';
  const validationSummary = {
    ok: ready,
    errorCount: blockers.length,
    warningCount: warnings.length,
    failedPhaseCount: counters.failedPhaseCount ?? 0,
    degradedPhaseCount: counters.degradedPhaseCount ?? 0,
    actionableErrorCount: counters.actionableErrorCount ?? 0,
    missingAcknowledgementCount: acceptancePacket?.missingAcknowledgements?.length ?? 0
  };
  const digestShape = {
    programId,
    operation,
    state,
    primaryAction,
    commandId: providerCommand?.commandId ?? null,
    requestKey: clientRequestSnapshot?.requestKey ?? null,
    persistedDigest: persistedStatus?.digest ?? null,
    exportDigest: exportLedger?.digest ?? null,
    replayDigest: replayManifest?.digest ?? null,
    readinessDigest: operatorReadiness?.digest ?? null,
    healthDigest: operationalHealth?.digest ?? null,
    latestSnapshotId: historySnapshots.at(-1)?.id ?? null,
    latestTimelineEvent: timeline.at(-1)?.event ?? null,
    blockers,
    warnings
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operator-action-card`,
    programId,
    operation,
    state,
    ready,
    writeRequired,
    title: writeRequired ? `Confirm Mailchimp ${operation ?? 'write'} handoff` : `Mailchimp ${operation ?? 'operation'} is read-only`,
    primaryAction,
    secondaryActions: uniqueSorted([
      ...(operatorReadiness?.nextAction ? [operatorReadiness.nextAction] : []),
      ...(persistedStatus?.nextAction ? [persistedStatus.nextAction] : []),
      ...(exportLedger?.nextAction ? [exportLedger.nextAction] : []),
      ...(replayManifest?.nextAction ? [replayManifest.nextAction] : []),
      ...(operationalHealth?.nextAction ? [operationalHealth.nextAction] : [])
    ]).filter((action) => action !== primaryAction).slice(0, 4),
    statusChannel: route?.statusChannel ?? null,
    auditChannel: route?.auditChannel ?? null,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    requestKey: clientRequestSnapshot?.requestKey ?? null,
    userVisibleStatus: {
      current: operatorReadiness?.userVisibleStatus ?? clientRequestSnapshot?.visibleStatus?.current ?? persistedStatus?.userVisibleStatus?.current ?? null,
      completion: clientRequestSnapshot?.visibleStatus?.completion ?? persistedStatus?.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: clientRequestSnapshot?.visibleStatus?.failure ?? persistedStatus?.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    validationSummary,
    history: {
      latestSnapshotId: historySnapshots.at(-1)?.id ?? null,
      snapshotCount: historySnapshots.length,
      timelineEventCount: timeline.length,
      exportLedgerDigest: exportLedger?.digest ?? null,
      replayManifestDigest: replayManifest?.digest ?? null,
      persistedStatusDigest: persistedStatus?.digest ?? null
    },
    blockers,
    warnings,
    digest: stableHash(digestShape)
  };
}

function analyticsPhase(phase, status, ready, blockers = [], warnings = [], nextAction = null) {
  const normalizedBlockers = uniqueSorted(asArray(blockers).map((entry) => typeof entry === 'string' ? entry : entry?.code));
  const normalizedWarnings = uniqueSorted(asArray(warnings).map((entry) => typeof entry === 'string' ? entry : entry?.code));
  const normalizedStatus = status ?? 'unknown';
  const outcome = normalizedBlockers.length || normalizedStatus === 'blocked' || normalizedStatus === 'failed'
    ? 'failed'
    : normalizedWarnings.length || normalizedStatus === 'degraded' || normalizedStatus === 'review' || normalizedStatus === 'held' || normalizedStatus === 'scheduled'
      ? 'degraded'
      : ready === false
        ? 'pending'
        : 'ready';
  return {
    phase,
    status: normalizedStatus,
    ready: ready !== false && outcome !== 'failed',
    outcome,
    blockers: normalizedBlockers,
    warnings: normalizedWarnings,
    nextAction
  };
}

function validateExternalWriteAnalyticsExport(analyticsExport, writeEffects) {
  if (!writeEffects.length && !analyticsExport) return [];
  const diagnostics = [];
  if (!analyticsExport) return [{ level: 'error', code: 'external_write_missing_analytics_export' }];
  if (writeEffects.length && analyticsExport.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_export_not_write_required' });
  }
  if (!analyticsExport.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_export_missing_digest' });
  }
  if (!analyticsExport.historySnapshots?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_export_missing_history' });
  }
  if (!analyticsExport.timeline?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_export_missing_timeline' });
  }
  if (!analyticsExport.operatorActionCard?.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_export_missing_operator_action_card' });
  }
  if (analyticsExport.ready && analyticsExport.operatorActionCard?.ready === false) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_export_card_not_ready' });
  }
  if (writeEffects.length && !analyticsExport.operatorActionCard?.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_action_card_missing_command_id' });
  }
  if (analyticsExport.ready && analyticsExport.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_analytics_export_ready_with_blockers',
      blockers: analyticsExport.blockers
    });
  }
  if (analyticsExport.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_analytics_export_blocked',
      blockers: analyticsExport.blockers ?? []
    });
  }
  if (analyticsExport.state === 'review' || analyticsExport.warnings?.length) {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_analytics_export_review',
      warnings: analyticsExport.warnings ?? []
    });
  }
  return diagnostics;
}

function externalWriteDiagnosticSource(code) {
  if (String(code).includes('provider')) return 'provider';
  if (String(code).includes('lifecycle')) return 'lifecycle';
  if (String(code).includes('boundary') || String(code).includes('scope') || String(code).includes('role')) return 'tenant_boundary';
  if (String(code).includes('claim')) return 'verifier_claims';
  if (String(code).includes('client')) return 'client_runtime';
  if (String(code).includes('export')) return 'export_ledger';
  if (String(code).includes('replay')) return 'replay_manifest';
  return 'external_write';
}

function statusCheckpoint(phase, state, digest, blockers = []) {
  return {
    phase,
    state: state ?? 'unknown',
    digest: digest ?? null,
    ready: !asArray(blockers).length && !['blocked', 'failed'].includes(state),
    blockerCount: asArray(blockers).length
  };
}

function statusHandoffUserStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    review: 'ready_with_warnings',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function statusHandoffAction(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('journal')) return 'persist_external_write_status_journal';
  if (String(blocker).includes('client_request')) return 'persist_client_request_snapshot';
  if (String(blocker).includes('replay')) return 'persist_replay_manifest';
  if (String(blocker).includes('analytics')) return 'publish_external_write_analytics_export';
  if (String(blocker).includes('export_ledger')) return 'repair_external_write_export_ledger';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('command_id')) return 'persist_provider_command_id';
  return providerCommandAction(blocker);
}

function externalWriteDiagnosticRetryable(code, providerHealth) {
  if (providerHealth?.retryable === false && String(code).includes('provider')) return false;
  if (String(code).includes('denied') || String(code).includes('not_authorized') || String(code).includes('missing_required_claims')) return false;
  if (String(code).includes('missing_tenant') || String(code).includes('missing_workspace')) return false;
  return true;
}

function externalWriteActionForDiagnostic(code) {
  if (String(code).includes('provider')) return providerCommandAction(code);
  if (String(code).includes('lifecycle')) return 'repair_lifecycle_controls';
  if (String(code).includes('boundary') || String(code).includes('scope') || String(code).includes('role')) return 'repair_tenant_boundary_ticket';
  if (String(code).includes('claim')) return 'collect_required_claims';
  if (String(code).includes('client_request')) return 'persist_client_request_snapshot';
  if (String(code).includes('client')) return 'repair_client_runtime_handoff';
  if (String(code).includes('export')) return 'publish_external_write_export_ledger';
  if (String(code).includes('replay')) return 'persist_replay_manifest';
  if (String(code).includes('idempotency')) return 'provide_provider_idempotency_key';
  return 'operator_review';
}

function externalWriteDegradedAction(lifecycleGate, providerHealth, warnings) {
  if (lifecycleGate?.state === 'held') return 'await_manual_release';
  if (lifecycleGate?.state === 'scheduled') return 'wait_for_schedule_window';
  if (providerHealth?.degraded) return 'handoff_with_provider_degraded_ack';
  return acknowledgementActionForWarning(warnings[0]?.code);
}

function operatorReadinessStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    review: 'ready_with_warnings',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function operatorReadinessAction(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('provider_health') || String(blocker).includes('provider_')) return providerCommandAction(blocker);
  if (String(blocker).includes('client')) return 'repair_client_runtime_handoff';
  if (String(blocker).includes('acceptance') || String(blocker).includes('acknowledgement')) return 'collect_operator_acknowledgement';
  if (String(blocker).includes('persisted')) return 'persist_external_write_status';
  if (String(blocker).includes('export')) return 'publish_external_write_export_ledger';
  if (String(blocker).includes('lifecycle')) return 'repair_lifecycle_controls';
  return 'operator_review';
}

function acknowledgementActionForWarning(warning) {
  if (String(warning).includes('manual_release')) return 'await_manual_release';
  if (String(warning).includes('schedule')) return 'wait_for_schedule_window';
  if (String(warning).includes('provider_health')) return 'handoff_with_provider_degraded_ack';
  if (String(warning).includes('boundary')) return 'collect_boundary_audit_acknowledgement';
  return 'confirm_write_handoff';
}

function externalWriteExportAction(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('acceptance')) return 'collect_operator_acknowledgement';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_digest')) return 'persist_external_write_status_digest';
  if (String(blocker).includes('provider')) return 'resolve_provider_health';
  if (String(blocker).includes('lifecycle')) return 'repair_lifecycle_controls';
  return 'repair_external_write_export_ledger';
}

function persistedWriteStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'waiting_for_external_write_acceptance',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function persistedWriteAction(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('provider_health_provider_denied')) return 'resolve_provider_denied_effect';
  if (String(blocker).includes('provider_health_provider_missing_effect')) return 'enable_provider_capability';
  if (String(blocker).includes('provider_unavailable')) return 'retry_provider_after_backoff';
  if (String(blocker).includes('provider_blocked')) return 'resolve_provider_health';
  if (String(blocker).includes('command_id')) return 'persist_provider_command_id';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('restart')) return 'persist_restart_token';
  if (String(blocker).includes('digest')) return 'persist_provider_command_digest';
  if (String(blocker).includes('lifecycle')) return 'repair_lifecycle_controls';
  return 'repair_external_write_persisted_status';
}

function providerCommandAction(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('provider_denied')) return 'resolve_provider_denied_effect';
  if (String(blocker).includes('provider_missing_effect')) return 'enable_provider_capability';
  if (String(blocker).includes('provider_unavailable')) return 'retry_provider_after_backoff';
  if (String(blocker).includes('provider_blocked')) return 'resolve_provider_health';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('tenant') || String(blocker).includes('workspace')) return 'provide_tenant_and_workspace_scope';
  if (String(blocker).includes('lifecycle')) return 'repair_lifecycle_controls';
  return 'resolve_provider_command';
}

function isExternalWriteEffect(effect) {
  return effect === 'mailchimp.write' || WRITE_EFFECT_PATTERN.test(effect);
}

function normalizeEffects(effects) {
  return [...new Set(effects.filter(Boolean).map(String))].sort();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function normalizeDeniedEffects(effects) {
  return effects
    .map((effect) => typeof effect === 'string' ? { effect, reason: 'denied' } : effect)
    .filter((effect) => effect?.effect)
    .sort((left, right) => left.effect.localeCompare(right.effect));
}

function normalizeScope(scope = {}) {
  return {
    tenantId: scope.tenantId ?? null,
    workspaceId: scope.workspaceId ?? null,
    role: scope.role ?? null,
    isolationKey: scope.isolationKey ?? null
  };
}

function normalizeAcknowledgements(value) {
  return uniqueSorted(asArray(value).map((entry) => typeof entry === 'string' ? entry : entry?.code));
}

function optionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableWriteKey(value) {
  return `write:${stableHash(value)}`;
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
