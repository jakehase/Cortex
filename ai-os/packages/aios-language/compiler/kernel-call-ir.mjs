export const KERNEL_CALL_IR_VERSION = 'aios.kernel-call-ir.v1';

export function createKernelCallIR({
  programId,
  profile,
  runtimePolicy,
  input = {},
  claims = {},
  status = 'queued',
  rollback = {},
  handoff = {},
  lifecycle = {},
  semanticReports = {}
} = {}) {
  const normalizedProfile = profile ?? {};
  const operation = normalizedProfile.operation ?? runtimePolicy?.operation ?? 'unknown';
  const capabilities = [...new Set(normalizedProfile.capabilities ?? [])].sort();
  const memoryBindings = normalizeMemoryBindings(normalizedProfile.memory ?? []);
  const verifierClaims = normalizeVerifierClaims(normalizedProfile.verifier?.requiredClaims ?? [], claims);
  const truthBoundaries = normalizeTruthBoundaries(normalizedProfile.verifier?.truthBoundaries ?? [], claims);

  const ir = {
    kind: 'KernelCallIR',
    version: KERNEL_CALL_IR_VERSION,
    programId: programId ?? deterministicProgramId(operation, input),
    adapter: runtimePolicy?.adapter ?? normalizedProfile.runtimeAdapter ?? 'mailchimp',
    operation,
    status,
    call: {
      target: `kernel.jobs.${operation}`,
      method: 'enqueue',
      input: stableClone(input)
    },
    capabilities: {
      required: capabilities,
      allowedEffects: [...new Set(runtimePolicy?.allowedEffects ?? [])].sort(),
      deniedEffects: runtimePolicy?.deniedEffects ?? []
    },
    memory: memoryBindings,
    verifier: {
      mode: runtimePolicy?.verifierMode ?? (normalizedProfile.verifier?.strict === false ? 'advisory' : 'strict'),
      claims: verifierClaims,
      missingClaims: verifierClaims.filter((claim) => claim.status === 'missing').map((claim) => claim.name)
    },
    recovery: {
      rollbackRequired: runtimePolicy?.rollbackRequired !== false,
      rollbackAction: rollback.action ?? normalizedProfile.recovery?.rollback ?? 'discard_local_plan',
      failureStatus: rollback.failureStatus ?? normalizedProfile.recovery?.statusOnFailure ?? 'needs_operator_review',
      retry: normalizeRetryPolicy(rollback.retry ?? runtimePolicy?.retry)
    },
    truth: {
      reportRequired: runtimePolicy?.truthBoundaryReport !== false,
      boundaries: truthBoundaries
    },
    handoff: {
      target: handoff.handoffTarget ?? 'mailchimp.client.workflow',
      continuationMode: handoff.continuationMode ?? 'resume_after_kernel_ack',
      statusChannel: handoff.statusChannel ?? 'kernel.status.mailchimp',
      idempotencyKey: handoff.idempotencyKey ?? deterministicProgramId(operation, input),
      scope: normalizeHandoffScope(handoff.scope),
      audit: stableClone(handoff.audit ?? {}),
      continuationState: stableClone(handoff.continuationState ?? null)
    },
    runtimeState: {
      featureState: stableClone(runtimePolicy?.featureState ?? null),
      continuationState: stableClone(handoff.continuationState ?? null),
      degradedMode: runtimePolicy?.featureState?.status === 'degraded',
      restartToken: runtimePolicy?.featureState?.restartToken ?? null,
      profileRestartToken: handoff.continuationState?.restartToken ?? null
    },
    semantic: normalizeSemanticReports(semanticReports),
    lifecycle: normalizeLifecycleControls({
      status,
      operation,
      settings: {
        ...(runtimePolicy?.settings ?? {}),
        ...(handoff.settings ?? {}),
        ...(lifecycle.settings ?? {})
      },
      enabled: lifecycle.enabled ?? runtimePolicy?.enabled,
      schedule: lifecycle.schedule ?? runtimePolicy?.schedule,
      nextAction: lifecycle.nextAction ?? runtimePolicy?.nextAction,
      health: runtimePolicy?.health,
      permissionBoundary: handoff.permissionBoundary ?? runtimePolicy?.permissionBoundary ?? null
    })
  };
  ir.provider = buildKernelProviderServiceContract(ir, runtimePolicy?.provider ?? runtimePolicy?.providerContract ?? {});
  ir.health = deriveKernelCallHealth(ir);
  ir.analytics = deriveKernelCallAnalytics(ir);
  ir.timeline = buildKernelCallTimeline(ir);
  ir.preview = buildKernelCallUIPreview(ir);
  ir.persistedState = buildPersistedProviderState(ir);
  ir.clientHandoff = buildKernelClientRuntimeHandoffPacket(ir);

  return {
    ok: validateKernelCallIR(ir).ok,
    ir,
    diagnostics: validateKernelCallIR(ir).diagnostics
  };
}

export function attachKernelCallSemanticReports(ir, semanticReports = {}) {
  const next = {
    ...stableClone(ir),
    semantic: normalizeSemanticReports({
      ...(ir?.semantic ?? {}),
      ...semanticReports
    })
  };
  next.provider = buildKernelProviderServiceContract(next, next.provider ?? {});
  next.health = deriveKernelCallHealth(next);
  next.analytics = deriveKernelCallAnalytics(next);
  next.timeline = buildKernelCallTimeline(next);
  next.preview = buildKernelCallUIPreview(next);
  next.persistedState = buildPersistedProviderState(next);
  next.clientHandoff = buildKernelClientRuntimeHandoffPacket(next);
  return next;
}

export function validateKernelCallIR(ir) {
  const diagnostics = [];
  if (!ir?.programId) diagnostics.push({ level: 'error', code: 'missing_program_id' });
  if (!ir?.operation || ir.operation === 'unknown') diagnostics.push({ level: 'error', code: 'missing_operation' });
  if (!ir?.adapter) diagnostics.push({ level: 'error', code: 'missing_runtime_adapter' });
  if (!ir?.capabilities?.required?.length) diagnostics.push({ level: 'error', code: 'missing_capabilities' });
  if (ir?.capabilities?.deniedEffects?.length) {
    diagnostics.push({ level: 'error', code: 'denied_effects_present' });
  }
  if (ir?.verifier?.mode === 'strict' && ir.verifier.missingClaims.length) {
    diagnostics.push({
      level: 'error',
      code: 'missing_strict_verifier_claims',
      claims: ir.verifier.missingClaims
    });
  }
  if (ir?.truth?.reportRequired && !ir.truth.boundaries.length) {
    diagnostics.push({ level: 'warning', code: 'empty_truth_boundary_report' });
  }
  if (ir?.recovery?.rollbackRequired && !ir.recovery.rollbackAction) {
    diagnostics.push({ level: 'error', code: 'missing_rollback_action' });
  }
  if (ir?.recovery?.retry?.maxAttempts < 1) {
    diagnostics.push({ level: 'error', code: 'invalid_retry_policy' });
  }
  if (!ir?.handoff?.idempotencyKey) {
    diagnostics.push({ level: 'error', code: 'missing_handoff_idempotency_key' });
  }
  if (!ir?.handoff?.scope?.tenantId || !ir?.handoff?.scope?.workspaceId) {
    diagnostics.push({ level: 'error', code: 'missing_handoff_scope' });
  }
  if (ir?.runtimeState?.featureState?.status === 'blocked') {
    diagnostics.push({ level: 'error', code: 'feature_state_blocked' });
  }
  diagnostics.push(...validateSemanticReports(ir?.semantic));
  diagnostics.push(...validateLifecycleControls(ir?.lifecycle));
  diagnostics.push(...validateKernelProviderServiceContract(ir?.provider, ir));
  diagnostics.push(...validateAcceptanceState(ir?.preview?.acceptance));
  diagnostics.push(...validateKernelNextActionState(ir?.preview?.nextActionState, ir));
  diagnostics.push(...validateKernelOperatorLifecycleAction(ir?.preview?.operatorLifecycleAction, ir));
  diagnostics.push(...validateRouteExportPreview(ir?.preview?.routeExport, ir));
  diagnostics.push(...validatePersistedProviderState(ir?.persistedState, ir));
  diagnostics.push(...validateKernelClientRuntimeHandoffPacket(ir?.clientHandoff, ir));
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
    diagnostics
  };
}

export function summarizeKernelCallIR(ir) {
  return {
    programId: ir?.programId,
    adapter: ir?.adapter,
    operation: ir?.operation,
    status: ir?.status,
    requiredCapabilities: ir?.capabilities?.required ?? [],
    deniedEffects: (ir?.capabilities?.deniedEffects ?? []).map((effect) => effect.effect),
    missingClaims: ir?.verifier?.missingClaims ?? [],
    rollbackAction: ir?.recovery?.rollbackAction,
    truthBoundaries: (ir?.truth?.boundaries ?? []).map((boundary) => boundary.name),
    health: ir?.health?.status,
    degradedMode: ir?.runtimeState?.degradedMode ?? false,
    actionableErrors: ir?.health?.actionableErrors ?? [],
    idempotencyKey: ir?.handoff?.idempotencyKey,
    restartToken: ir?.runtimeState?.restartToken,
    profileRestartToken: ir?.runtimeState?.profileRestartToken,
    lifecycle: {
      enabled: ir?.lifecycle?.enabled ?? true,
      state: ir?.lifecycle?.state ?? 'unknown',
      nextAction: ir?.lifecycle?.nextAction ?? null,
      scheduleStatus: ir?.lifecycle?.schedule?.status ?? 'unscheduled'
    },
    provider: summarizeKernelProviderServiceContract(ir?.provider),
    providerHandoffHealth: summarizeKernelProviderHandoffHealth(ir),
    persistedState: summarizePersistedProviderState(ir?.persistedState),
    providerSession: summarizeProviderSessionState(ir?.persistedState?.providerSession),
    clientHandoff: summarizeKernelClientRuntimeHandoffPacket(ir?.clientHandoff),
    clientRuntimeState: summarizeClientRuntimeState(ir?.preview?.runtimeWorkflow?.clientRuntimeState),
    recoveryRunbook: summarizeKernelRecoveryRunbook(ir),
    semantic: summarizeSemanticReports(ir?.semantic),
    preview: summarizeKernelCallUIPreview(ir?.preview),
    analytics: ir?.analytics?.counters ?? {}
  };
}

export function deriveKernelCallAnalytics(ir) {
  const deniedEffects = ir?.capabilities?.deniedEffects ?? [];
  const missingClaims = ir?.verifier?.missingClaims ?? [];
  const boundaries = ir?.truth?.boundaries ?? [];
  const memory = ir?.memory ?? [];
  const actionableErrors = ir?.health?.actionableErrors ?? [];
  const continuationEvents = ir?.runtimeState?.continuationState?.events ?? [];
  const lifecycleWarnings = ir?.lifecycle?.validation?.filter((diagnostic) => diagnostic.level === 'warning') ?? [];
  const semanticDiagnostics = collectSemanticDiagnostics(ir?.semantic);
  const counters = {
    requiredCapabilityCount: (ir?.capabilities?.required ?? []).length,
    allowedEffectCount: (ir?.capabilities?.allowedEffects ?? []).length,
    deniedEffectCount: deniedEffects.length,
    memoryBindingCount: memory.length,
    boundedMemoryBindingCount: memory.filter((binding) => binding.retention === 'bounded').length,
    missingClaimCount: missingClaims.length,
    truthBoundaryCount: boundaries.length,
    observedTruthBoundaryCount: boundaries.filter((boundary) => boundary.status === 'observed').length,
    actionableErrorCount: actionableErrors.length,
    retryableErrorCount: actionableErrors.filter((error) => error.retryable !== false).length,
    continuationEventCount: continuationEvents.length,
    duplicateContinuationCommandCount: continuationEvents.filter((event) => event.status === 'duplicate').length,
    lifecycleWarningCount: lifecycleWarnings.length,
    lifecycleDisabledCount: ir?.lifecycle?.enabled === false ? 1 : 0,
    scheduledHandoffCount: ir?.lifecycle?.schedule?.status === 'scheduled' ? 1 : 0,
    lifecycleConfirmationRequiredCount: ir?.lifecycle?.confirmationState?.requiredAcknowledgements?.length ?? 0,
    lifecycleConfirmationMissingCount: ir?.lifecycle?.confirmationState?.missingAcknowledgements?.length ?? 0,
    lifecycleConfirmationAppliedCount: ir?.lifecycle?.confirmationState?.appliedConfirmations?.length ?? 0,
    lifecycleConfirmationSatisfiedCount: ir?.lifecycle?.confirmationState?.satisfied ? 1 : 0,
    lifecycleCommandQueueReadyCount: ir?.lifecycle?.commandQueue?.ready ? 1 : 0,
    lifecycleCommandQueuePendingCount: ir?.lifecycle?.commandQueue?.pending?.length ?? 0,
    lifecycleCommandQueueAppliedCount: ir?.lifecycle?.commandQueue?.applied?.length ?? 0,
    lifecycleCommandQueueBlockedCount: ir?.lifecycle?.commandQueue?.blocked?.length ?? 0,
    lifecycleCommandQueueAckMissingCount: ir?.lifecycle?.commandQueue?.requiredAcknowledgements?.missing?.length ?? 0,
    semanticErrorCount: semanticDiagnostics.filter((diagnostic) => diagnostic.level === 'error').length,
    externalWriteRequiredCount: ir?.semantic?.externalWrite?.writeRequired ? 1 : 0,
    recoveryBlockedCount: ir?.semantic?.recovery?.status === 'blocked' ? 1 : 0,
    externalStatusHandoffReadyCount: ir?.semantic?.externalWrite?.statusHandoff?.ready ? 1 : 0,
    externalStatusHandoffBlockerCount: ir?.semantic?.externalWrite?.statusHandoff?.blockers?.length ?? 0,
    recoveryStatusHandoffReadyCount: ir?.semantic?.recovery?.statusHandoff?.ready ? 1 : 0,
    recoveryStatusHandoffBlockerCount: ir?.semantic?.recovery?.statusHandoff?.blockers?.length ?? 0,
    operatorActionCardReadyCount: ir?.semantic?.externalWrite?.analyticsExport?.operatorActionCard?.ready ? 1 : 0,
    operatorActionCardBlockerCount: ir?.semantic?.externalWrite?.analyticsExport?.operatorActionCard?.blockers?.length ?? 0,
    operatorActionCardWarningCount: ir?.semantic?.externalWrite?.analyticsExport?.operatorActionCard?.warnings?.length ?? 0,
    externalClientRuntimeAdoptionReadyCount: ir?.semantic?.externalWrite?.clientRuntimeAdoption?.ready ? 1 : 0,
    externalClientRuntimeAdoptionBlockerCount: ir?.semantic?.externalWrite?.clientRuntimeAdoption?.blockers?.length ?? 0,
    externalClientRuntimeAdoptionCommandCount: ir?.semantic?.externalWrite?.clientRuntimeAdoption?.commands?.length ?? 0,
    externalClientRuntimeAdoptionAcknowledgementCount: ir?.semantic?.externalWrite?.clientRuntimeAdoption?.requiredAcknowledgements?.length ?? 0,
    externalClientRuntimeAdoptionReceiptReadyCount: ir?.semantic?.externalWrite?.clientRuntimeAdoptionReceipt?.ready ? 1 : 0,
    externalClientRuntimeAdoptionReceiptRestartSafeCount: ir?.semantic?.externalWrite?.clientRuntimeAdoptionReceipt?.restartSemantics?.restartSafe ? 1 : 0,
    externalClientRuntimeAdoptionReceiptBlockerCount: ir?.semantic?.externalWrite?.clientRuntimeAdoptionReceipt?.blockers?.length ?? 0,
    externalClientRuntimeAdoptionReceiptCheckpointCount: ir?.semantic?.externalWrite?.clientRuntimeAdoptionReceipt?.checkpoints?.length ?? 0,
    externalClientWorkflowStatusReadyCount: ir?.semantic?.externalWrite?.clientWorkflowStatusCapsule?.ready ? 1 : 0,
    externalClientWorkflowStatusRestartSafeCount: ir?.semantic?.externalWrite?.clientWorkflowStatusCapsule?.restartSafe ? 1 : 0,
    externalClientWorkflowStatusBlockerCount: ir?.semantic?.externalWrite?.clientWorkflowStatusCapsule?.blockers?.length ?? 0,
    externalClientWorkflowStatusWarningCount: ir?.semantic?.externalWrite?.clientWorkflowStatusCapsule?.warnings?.length ?? 0,
    externalBoundaryPermissionPostureReadyCount: ir?.semantic?.externalWrite?.boundaryPermissionPosture?.ready ? 1 : 0,
    externalBoundaryPermissionPostureBlockerCount: ir?.semantic?.externalWrite?.boundaryPermissionPosture?.blockers?.length ?? 0,
    externalBoundaryPermissionPostureWarningCount: ir?.semantic?.externalWrite?.boundaryPermissionPosture?.warnings?.length ?? 0,
    externalBoundaryPermissionPostureEscalationCount: ir?.semantic?.externalWrite?.boundaryPermissionPosture?.escalations?.length ?? 0,
    externalBoundaryPermissionPostureMissingAcknowledgementCount: ir?.semantic?.externalWrite?.boundaryPermissionPosture?.missingAcknowledgements?.length ?? 0,
    externalBoundaryPermissionPostureDeniedEffectCount: ir?.semantic?.externalWrite?.boundaryPermissionPosture?.effectAccess?.deniedRequired?.length ?? 0,
    externalBoundaryPermissionPostureMissingAllowedEffectCount: ir?.semantic?.externalWrite?.boundaryPermissionPosture?.effectAccess?.missingAllowed?.length ?? 0,
    externalBoundaryDecisionReceiptReadyCount: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.ready ? 1 : 0,
    externalBoundaryDecisionReceiptReleaseCount: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.release?.allowed ? 1 : 0,
    externalBoundaryDecisionReceiptBlockerCount: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.blockers?.length ?? 0,
    externalBoundaryDecisionReceiptWarningCount: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.warnings?.length ?? 0,
    externalBoundaryDecisionReceiptEvidenceCount: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.evidence?.length ?? 0,
    externalOperationalIncidentOpenCount: ir?.semantic?.externalWrite?.operationalIncident?.open ? 1 : 0,
    externalOperationalIncidentRetryableCount: ir?.semantic?.externalWrite?.operationalIncident?.retryable ? 1 : 0,
    externalOperationalIncidentTerminalCount: ir?.semantic?.externalWrite?.operationalIncident?.terminal ? 1 : 0,
    externalOperationalIncidentEvidenceCount: ir?.semantic?.externalWrite?.operationalIncident?.evidence?.length ?? 0,
    externalOperationalIncidentRetryAfterMs: ir?.semantic?.externalWrite?.operationalIncident?.retryWindow?.retryAfterMs ?? 0,
    externalProviderHandoffHealthReadyCount: ir?.semantic?.externalWrite?.providerHandoffHealth?.ready ? 1 : 0,
    externalProviderHandoffHealthDegradedCount: ir?.semantic?.externalWrite?.providerHandoffHealth?.degraded ? 1 : 0,
    externalProviderHandoffHealthRetryableCount: ir?.semantic?.externalWrite?.providerHandoffHealth?.retryable ? 1 : 0,
    externalProviderHandoffHealthTerminalCount: ir?.semantic?.externalWrite?.providerHandoffHealth?.terminal ? 1 : 0,
    externalProviderHandoffHealthBlockerCount: ir?.semantic?.externalWrite?.providerHandoffHealth?.blockers?.length ?? 0,
    externalProviderHandoffHealthWarningCount: ir?.semantic?.externalWrite?.providerHandoffHealth?.warnings?.length ?? 0,
    externalProviderHandoffHealthFailedDependencyCount: ir?.semantic?.externalWrite?.providerHandoffHealth?.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0,
    externalRecoveryRunbookReadyCount: ir?.semantic?.externalWrite?.recoveryRunbook?.ready ? 1 : 0,
    externalRecoveryRunbookStepCount: ir?.semantic?.externalWrite?.recoveryRunbook?.steps?.length ?? 0,
    externalRecoveryRunbookExecutableStepCount: ir?.semantic?.externalWrite?.recoveryRunbook?.steps?.filter((step) => step.executable).length ?? 0,
    externalRecoveryRunbookBlockerCount: ir?.semantic?.externalWrite?.recoveryRunbook?.blockers?.length ?? 0,
    externalRecoveryRunbookWarningCount: ir?.semantic?.externalWrite?.recoveryRunbook?.warnings?.length ?? 0,
    externalRecoveryRunbookRetryAfterMs: ir?.semantic?.externalWrite?.recoveryRunbook?.retryAfterMs ?? 0,
    externalRouteExportReadyCount: ir?.semantic?.externalWrite?.routeExportState?.ready ? 1 : 0,
    externalRouteExportChangedCount: ir?.semantic?.externalWrite?.routeExportState?.changedSinceAcceptedSnapshot ? 1 : 0,
    externalRouteExportSnapshotCount: ir?.semantic?.externalWrite?.routeExportState?.snapshots?.length ?? 0,
    externalRouteExportBlockerCount: ir?.semantic?.externalWrite?.routeExportState?.blockers?.length ?? 0,
    externalRouteExportWarningCount: ir?.semantic?.externalWrite?.routeExportState?.warnings?.length ?? 0,
    externalAnalyticsPublicationReadyCount: ir?.semantic?.externalWrite?.analyticsPublication?.ready ? 1 : 0,
    externalAnalyticsPublicationTargetCount: ir?.semantic?.externalWrite?.analyticsPublication?.targets?.length ?? 0,
    externalAnalyticsPublicationPublisherCount: ir?.semantic?.externalWrite?.analyticsPublication?.publishers?.length ?? 0,
    externalAnalyticsPublicationMissingAcknowledgementCount: ir?.semantic?.externalWrite?.analyticsPublication?.acknowledgements?.missing?.length ?? 0,
    externalAnalyticsPublicationFreshnessWarningCount: ir?.semantic?.externalWrite?.analyticsPublication?.freshness?.warnings?.length ?? 0,
    externalAnalyticsPublicationBlockerCount: ir?.semantic?.externalWrite?.analyticsPublication?.blockers?.length ?? 0,
    externalTimelinePublicationReadyCount: ir?.semantic?.externalWrite?.timelinePublication?.ready ? 1 : 0,
    externalTimelinePublicationEventCount: ir?.semantic?.externalWrite?.timelinePublication?.events?.length ?? 0,
    externalTimelinePublicationSnapshotCount: ir?.semantic?.externalWrite?.timelinePublication?.snapshots?.length ?? 0,
    externalTimelinePublicationDriftCount: ir?.semantic?.externalWrite?.timelinePublication?.drift?.changedSinceAcceptedSnapshot ? 1 : 0,
    externalTimelinePublicationBlockerCount: ir?.semantic?.externalWrite?.timelinePublication?.blockers?.length ?? 0,
    externalTimelinePublicationWarningCount: ir?.semantic?.externalWrite?.timelinePublication?.warnings?.length ?? 0,
    externalResumeCursorReadyCount: ir?.semantic?.externalWrite?.resumeCursor?.ready ? 1 : 0,
    externalResumeCursorRestartSafeCount: ir?.semantic?.externalWrite?.resumeCursor?.restartSemantics?.restartSafe ? 1 : 0,
    externalResumeCursorCheckpointCount: ir?.semantic?.externalWrite?.resumeCursor?.checkpoints?.length ?? 0,
    externalResumeCursorBlockerCount: ir?.semantic?.externalWrite?.resumeCursor?.blockers?.length ?? 0,
    externalResumeCursorWarningCount: ir?.semantic?.externalWrite?.resumeCursor?.warnings?.length ?? 0,
    externalAcceptanceCheckpointReadyCount: ir?.semantic?.externalWrite?.acceptanceCheckpointBundle?.ready ? 1 : 0,
    externalAcceptanceCheckpointAlignedCount: ir?.semantic?.externalWrite?.acceptanceCheckpointBundle?.aligned ? 1 : 0,
    externalAcceptanceCheckpointRestartSafeCount: ir?.semantic?.externalWrite?.acceptanceCheckpointBundle?.restartSafe ? 1 : 0,
    externalAcceptanceCheckpointCount: ir?.semantic?.externalWrite?.acceptanceCheckpointBundle?.checkpoints?.length ?? 0,
    externalAcceptanceCheckpointBlockerCount: ir?.semantic?.externalWrite?.acceptanceCheckpointBundle?.blockers?.length ?? 0,
    externalAcceptanceCheckpointWarningCount: ir?.semantic?.externalWrite?.acceptanceCheckpointBundle?.warnings?.length ?? 0,
    externalPersistenceEnvelopeReadyCount: ir?.semantic?.externalWrite?.persistenceEnvelope?.ready ? 1 : 0,
    externalPersistenceEnvelopeRestartSafeCount: ir?.semantic?.externalWrite?.persistenceEnvelope?.restartSemantics?.restartSafe ? 1 : 0,
    externalPersistenceEnvelopeRecoveryHintCount: ir?.semantic?.externalWrite?.persistenceEnvelope?.recoveryHints?.length ?? 0,
    externalPersistenceEnvelopeBlockerCount: ir?.semantic?.externalWrite?.persistenceEnvelope?.blockers?.length ?? 0,
    externalStateIntegrityReadyCount: ir?.semantic?.externalWrite?.stateIntegrityManifest?.ready ? 1 : 0,
    externalStateIntegrityRestartSafeCount: ir?.semantic?.externalWrite?.stateIntegrityManifest?.restartSafe ? 1 : 0,
    externalStateIntegrityAlignedCount: ir?.semantic?.externalWrite?.stateIntegrityManifest?.aligned ? 1 : 0,
    externalStateIntegrityCheckpointCount: ir?.semantic?.externalWrite?.stateIntegrityManifest?.checkpoints?.length ?? 0,
    externalStateIntegrityMismatchCount: ir?.semantic?.externalWrite?.stateIntegrityManifest?.mismatches?.length ?? 0,
    externalStateIntegrityBlockerCount: ir?.semantic?.externalWrite?.stateIntegrityManifest?.blockers?.length ?? 0,
    externalStateIntegrityWarningCount: ir?.semantic?.externalWrite?.stateIntegrityManifest?.warnings?.length ?? 0,
    recoveryStateIntegrityReadyCount: ir?.semantic?.recovery?.analyticsSummary?.stateIntegrity?.ready ? 1 : 0,
    recoveryStateIntegrityRestartSafeCount: ir?.semantic?.recovery?.analyticsSummary?.stateIntegrity?.restartSafe ? 1 : 0,
    recoveryStateIntegrityAlignedCount: ir?.semantic?.recovery?.analyticsSummary?.stateIntegrity?.aligned ? 1 : 0,
    recoveryStateIntegrityMismatchCount: ir?.semantic?.recovery?.analyticsSummary?.stateIntegrity?.mismatchCount ?? 0,
    recoveryClientRuntimeAdoptionReadyCount: ir?.semantic?.recovery?.persistedClientState?.clientRuntimeAdoption?.ready ? 1 : 0,
    recoveryClientRuntimeAdoptionCommandCount: ir?.semantic?.recovery?.persistedClientState?.clientRuntimeAdoption?.commandCount ?? 0,
    recoveryClientRuntimeAdoptionAcknowledgementCount: ir?.semantic?.recovery?.persistedClientState?.clientRuntimeAdoption?.acknowledgementCount ?? 0,
    recoveryClientRuntimeAdoptionReceiptReadyCount: ir?.semantic?.recovery?.persistedClientState?.clientRuntimeAdoptionReceipt?.ready ? 1 : 0,
    recoveryClientRuntimeAdoptionReceiptRestartSafeCount: ir?.semantic?.recovery?.persistedClientState?.clientRuntimeAdoptionReceipt?.restartSafe ? 1 : 0,
    recoveryClientRuntimeAdoptionReceiptBlockerCount: ir?.semantic?.recovery?.persistedClientState?.clientRuntimeAdoptionReceipt?.blockers?.length ?? 0,
    recoveryClientWorkflowStatusReadyCount: ir?.semantic?.recovery?.persistedClientState?.clientWorkflowStatusCapsule?.ready ? 1 : 0,
    recoveryClientWorkflowStatusRestartSafeCount: ir?.semantic?.recovery?.persistedClientState?.clientWorkflowStatusCapsule?.restartSafe ? 1 : 0,
    recoveryClientWorkflowStatusBlockerCount: ir?.semantic?.recovery?.persistedClientState?.clientWorkflowStatusCapsule?.blockers?.length ?? 0,
    recoveryClientWorkflowStatusWarningCount: ir?.semantic?.recovery?.persistedClientState?.clientWorkflowStatusCapsule?.warnings?.length ?? 0,
    recoveryLifecycleCommandReadyCount: ir?.semantic?.recovery?.analyticsSummary?.lifecycleCommandState?.ready ? 1 : 0,
    recoveryLifecycleCommandCount: ir?.semantic?.recovery?.analyticsSummary?.lifecycleCommandState?.commands?.length ?? 0,
    recoveryOperationalIncidentOpenCount: ir?.semantic?.recovery?.analyticsSummary?.operationalIncident?.open ? 1 : 0,
    recoveryOperationalIncidentRetryableCount: ir?.semantic?.recovery?.analyticsSummary?.operationalIncident?.retryable ? 1 : 0,
    recoveryOperationalIncidentTerminalCount: ir?.semantic?.recovery?.analyticsSummary?.operationalIncident?.terminal ? 1 : 0,
    recoveryProviderHandoffHealthReadyCount: ir?.semantic?.recovery?.analyticsSummary?.providerHandoffHealth?.ready ? 1 : 0,
    recoveryProviderHandoffHealthDegradedCount: ir?.semantic?.recovery?.analyticsSummary?.providerHandoffHealth?.degraded ? 1 : 0,
    recoveryProviderHandoffHealthRetryableCount: ir?.semantic?.recovery?.analyticsSummary?.providerHandoffHealth?.retryable ? 1 : 0,
    recoveryProviderHandoffHealthTerminalCount: ir?.semantic?.recovery?.analyticsSummary?.providerHandoffHealth?.terminal ? 1 : 0,
    recoveryProviderHandoffHealthFailedDependencyCount: ir?.semantic?.recovery?.analyticsSummary?.providerHandoffHealth?.failedDependencyCount ?? 0,
    recoveryRunbookReadyCount: ir?.semantic?.recovery?.analyticsSummary?.recoveryRunbook?.ready ? 1 : 0,
    recoveryRunbookStepCount: ir?.semantic?.recovery?.analyticsSummary?.recoveryRunbook?.stepCount ?? 0,
    recoveryRunbookExecutableStepCount: ir?.semantic?.recovery?.analyticsSummary?.recoveryRunbook?.executableStepCount ?? 0,
    recoveryRunbookBlockerCount: ir?.semantic?.recovery?.analyticsSummary?.recoveryRunbook?.blockerCount ?? 0,
    recoveryRunbookWarningCount: ir?.semantic?.recovery?.analyticsSummary?.recoveryRunbook?.warningCount ?? 0,
    recoveryRunbookRetryAfterMs: ir?.semantic?.recovery?.analyticsSummary?.recoveryRunbook?.retryAfterMs ?? 0,
    recoveryResumeCursorReadyCount: ir?.semantic?.recovery?.analyticsSummary?.resumeCursor?.ready ? 1 : 0,
    recoveryResumeCursorRestartSafeCount: ir?.semantic?.recovery?.analyticsSummary?.resumeCursor?.restartSafe ? 1 : 0,
    recoveryResumeCursorAlignedCount: ir?.semantic?.recovery?.analyticsSummary?.resumeCursor?.commandAligned
      && ir?.semantic?.recovery?.analyticsSummary?.resumeCursor?.statusChannelAligned
      && ir?.semantic?.recovery?.analyticsSummary?.resumeCursor?.envelopeDigestAligned
      ? 1
      : 0,
    recoveryResumeCursorCheckpointCount: ir?.semantic?.recovery?.analyticsSummary?.resumeCursor?.checkpointCount ?? 0,
    externalOperationalRetryReadyCount: ir?.semantic?.externalWrite?.statusHandoff?.operationalRetry?.ready ? 1 : 0,
    externalOperationalRetryScheduledCount: ir?.semantic?.externalWrite?.statusHandoff?.operationalRetry?.retryScheduled ? 1 : 0,
    externalOperationalRetryDegradedCount: ir?.semantic?.externalWrite?.statusHandoff?.operationalRetry?.degradedMode ? 1 : 0,
    externalOperationalRetryTerminalCount: ir?.semantic?.externalWrite?.statusHandoff?.operationalRetry?.state === 'terminal' ? 1 : 0,
    externalOperationalRetryExhaustedCount: ir?.semantic?.externalWrite?.statusHandoff?.operationalRetry?.exhausted ? 1 : 0,
    recoveryOperationalRetryReadyCount: ir?.semantic?.recovery?.statusHandoff?.operationalRetry?.ready ? 1 : 0,
    recoveryOperationalRetryScheduledCount: ir?.semantic?.recovery?.statusHandoff?.operationalRetry?.retryScheduled ? 1 : 0,
    recoveryOperationalRetryDegradedCount: ir?.semantic?.recovery?.statusHandoff?.operationalRetry?.degradedMode ? 1 : 0,
    recoveryOperationalRetryTerminalCount: ir?.semantic?.recovery?.statusHandoff?.operationalRetry?.state === 'terminal' ? 1 : 0,
    recoveryOperationalRetryExhaustedCount: ir?.semantic?.recovery?.statusHandoff?.operationalRetry?.exhausted ? 1 : 0,
    recoveryAcceptanceCheckpointReadyCount: ir?.semantic?.recovery?.readinessPreview?.acceptanceCheckpointBundle?.ready ? 1 : 0,
    recoveryAcceptanceCheckpointAlignedCount: ir?.semantic?.recovery?.readinessPreview?.acceptanceCheckpointBundle?.aligned ? 1 : 0,
    recoveryAcceptanceCheckpointRestartSafeCount: ir?.semantic?.recovery?.readinessPreview?.acceptanceCheckpointBundle?.restartSafe ? 1 : 0,
    recoveryAcceptanceCheckpointBlockerCount: ir?.semantic?.recovery?.readinessPreview?.acceptanceCheckpointBundle?.blockers?.length ?? 0,
    recoveryAcceptanceCheckpointWarningCount: ir?.semantic?.recovery?.readinessPreview?.acceptanceCheckpointBundle?.warnings?.length ?? 0,
    clientLifecycleAdoptionReadyCount: ir?.clientHandoff?.lifecycleAdoption?.ready ? 1 : 0,
    clientLifecycleAdoptionBlockerCount: ir?.clientHandoff?.lifecycleAdoption?.blockers?.length ?? 0,
    clientLifecycleAdoptionAcknowledgementCount: ir?.clientHandoff?.lifecycleAdoption?.requiredAcknowledgements?.length ?? 0,
    clientLifecycleAdoptionCommandCount: ir?.clientHandoff?.lifecycleAdoption?.commands?.length ?? 0,
    kernelNextActionReadyCount: ir?.preview?.nextActionState?.ready ? 1 : 0,
    kernelNextActionCommandCount: ir?.preview?.nextActionState?.commands?.length ?? 0,
    kernelNextActionBlockerCount: ir?.preview?.nextActionState?.blockers?.length ?? 0,
    kernelNextActionWarningCount: ir?.preview?.nextActionState?.warnings?.length ?? 0,
    clientNextActionReadyCount: ir?.clientHandoff?.nextActionState?.ready ? 1 : 0,
    clientNextActionCommandCount: ir?.clientHandoff?.nextActionState?.commands?.length ?? 0
  };
  const statusRecovery = buildKernelStatusRecoveryReport(ir);
  counters.persistedExternalWriteReadyCount = statusRecovery.persistedExternalWrite.ready ? 1 : 0;
  counters.restartRecoveryReadyCount = statusRecovery.restartRecovery.ready ? 1 : 0;
  counters.statusRecoveryBlockerCount = statusRecovery.blockers.length;
  counters.statusRecoveryTimelineEventCount = statusRecovery.timeline.length;
  counters.providerServiceReadyCount = ir?.provider?.ready ? 1 : 0;
  counters.providerServiceBlockerCount = ir?.provider?.blockers?.length ?? 0;
  counters.providerServiceWarningCount = ir?.provider?.warnings?.length ?? 0;
  counters.providerSessionReadyCount = ir?.persistedState?.providerSession?.ready ? 1 : 0;
  counters.providerSessionRenewalCount = ir?.persistedState?.providerSession?.renewalRequired ? 1 : 0;
  counters.providerSessionBlockerCount = ir?.persistedState?.providerSession?.blockers?.length ?? 0;
  counters.providerSessionCapabilityCount = ir?.persistedState?.providerSession?.capabilityVector?.length ?? 0;
  counters.providerSessionMissingCapabilityCount = ir?.persistedState?.providerSession?.missingCapabilities?.length ?? 0;
  counters.providerCheckpointReadyCount = ir?.persistedState?.checkpointManifest?.ready ? 1 : 0;
  counters.providerCheckpointRequiredCount = ir?.persistedState?.checkpointManifest?.required ? 1 : 0;
  counters.providerCheckpointEntryCount = ir?.persistedState?.checkpointManifest?.entryCount ?? 0;
  counters.providerCheckpointRestartSafeEntryCount = ir?.persistedState?.checkpointManifest?.restartSafeEntryCount ?? 0;
  counters.providerCheckpointChangedCount = ir?.persistedState?.checkpointManifest?.changedSincePrevious ? 1 : 0;
  counters.providerCheckpointBlockerCount = ir?.persistedState?.checkpointManifest?.blockerCount ?? 0;
  counters.providerCheckpointWarningCount = ir?.persistedState?.checkpointManifest?.warningCount ?? 0;
  counters.providerHandoffReceiptReadyCount = ir?.provider?.sync?.handoffReceipt?.ready ? 1 : 0;
  counters.providerHandoffReceiptFreshCount = ir?.provider?.sync?.handoffReceipt?.fresh ? 1 : 0;
  counters.providerHandoffReceiptAcknowledgedCount = ir?.provider?.sync?.handoffReceipt?.acknowledged ? 1 : 0;
  counters.providerHandoffReceiptBlockerCount = ir?.provider?.sync?.handoffReceipt?.blockers?.length ?? 0;
  counters.providerHandoffReceiptWarningCount = ir?.provider?.sync?.handoffReceipt?.warnings?.length ?? 0;
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.analytics`,
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    status: ir?.status ?? 'unknown',
    healthStatus: ir?.health?.status ?? 'unknown',
    counters,
    ratios: {
      observedTruthBoundaryRatio: ratio(counters.observedTruthBoundaryCount, counters.truthBoundaryCount),
      retryableErrorRatio: ratio(counters.retryableErrorCount, counters.actionableErrorCount)
    },
    restartTokens: {
      feature: ir?.runtimeState?.restartToken ?? null,
      profile: ir?.runtimeState?.profileRestartToken ?? null
    },
    lifecycle: {
      state: ir?.lifecycle?.state ?? 'unknown',
      nextAction: ir?.lifecycle?.nextAction ?? null,
      scheduleStatus: ir?.lifecycle?.schedule?.status ?? 'unscheduled',
      exportable: ir?.lifecycle?.exportable ?? false,
      confirmationState: ir?.lifecycle?.confirmationState?.state ?? 'not_required',
      confirmationSatisfied: ir?.lifecycle?.confirmationState?.satisfied ?? false,
      missingConfirmations: ir?.lifecycle?.confirmationState?.missingAcknowledgements ?? [],
      commandQueue: summarizeLifecycleCommandQueue(ir?.lifecycle?.commandQueue)
    },
    provider: summarizeKernelProviderServiceContract(ir?.provider),
    runtimeWorkflow: summarizeRuntimeWorkflowHandoff(ir?.preview?.runtimeWorkflow),
    statusRecovery: summarizeKernelStatusRecoveryReport(statusRecovery),
    exportReady: actionableErrors.every((error) => error.retryable !== false)
      && deniedEffects.length === 0
      && counters.semanticErrorCount === 0
      && Boolean(ir?.handoff?.idempotencyKey)
      && ir?.lifecycle?.exportable !== false
  };
}

export function createKernelCallHistorySnapshot(ir, previousSnapshots = []) {
  const prior = asArray(previousSnapshots)
    .map(normalizeHistorySnapshot)
    .filter(Boolean);
  const analytics = ir?.analytics ?? deriveKernelCallAnalytics(ir);
  const snapshot = {
    sequence: prior.length + 1,
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    status: ir?.status ?? 'unknown',
    health: ir?.health?.status ?? 'unknown',
    idempotencyKey: ir?.handoff?.idempotencyKey ?? null,
    restartToken: ir?.runtimeState?.restartToken ?? null,
    profileRestartToken: ir?.runtimeState?.profileRestartToken ?? null,
    counters: stableClone(analytics.counters),
    digest: stableHash({
      programId: ir?.programId ?? null,
      status: ir?.status ?? null,
      health: ir?.health?.status ?? null,
      counters: analytics.counters,
      restartToken: ir?.runtimeState?.restartToken ?? null,
      profileRestartToken: ir?.runtimeState?.profileRestartToken ?? null
    })
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.history`,
    snapshots: [...prior, snapshot],
    latest: snapshot,
    changedSincePrevious: prior.at(-1)?.digest !== snapshot.digest
  };
}

export function exportKernelCallIRReport(ir, previousSnapshots = []) {
  const analytics = ir?.analytics ?? deriveKernelCallAnalytics(ir);
  const history = createKernelCallHistorySnapshot(ir, previousSnapshots);
  const preview = ir?.preview ?? buildKernelCallUIPreview(ir);
  const exportSummary = buildExportSummary({ ir, analytics, history, preview });
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.report`,
    summary: summarizeKernelCallIR(ir),
    analytics,
    timeline: ir?.timeline ?? buildKernelCallTimeline(ir),
    history,
    preview,
    exportSummary,
    audit: {
      channel: ir?.handoff?.audit?.channel ?? 'audit.mailchimp.runtime_handoff',
      tenantId: ir?.handoff?.scope?.tenantId ?? null,
      workspaceId: ir?.handoff?.scope?.workspaceId ?? null,
      isolationKey: ir?.handoff?.scope?.isolationKey ?? null,
      idempotencyKey: ir?.handoff?.idempotencyKey ?? null
    },
    persistedState: ir?.persistedState ?? buildPersistedProviderState(ir),
    statusRecovery: buildKernelStatusRecoveryReport(ir),
    clientHandoff: ir?.clientHandoff ?? buildKernelClientRuntimeHandoffPacket(ir),
    clientRuntimeState: summarizeClientRuntimeState(preview?.runtimeWorkflow?.clientRuntimeState),
    semantic: summarizeSemanticReports(ir?.semantic)
  };
}

export function buildKernelCallStatusRecoveryReport(ir) {
  return buildKernelStatusRecoveryReport(ir);
}

export function deriveKernelCallHealth(ir) {
  const validation = validateKernelCallIRWithoutHealth(ir);
  const actionableErrors = [
    ...validation.diagnostics
      .filter((diagnostic) => diagnostic.level === 'error')
      .map((diagnostic) => actionableErrorFromDiagnostic(diagnostic, ir)),
    ...buildDeniedEffectErrors(ir),
    ...buildMissingClaimErrors(ir),
    ...buildClientRuntimeAdoptionErrors(ir)
  ];
  const warnings = validation.diagnostics.filter((diagnostic) => diagnostic.level === 'warning');
  const degradedReasons = [
    ...(ir?.runtimeState?.degradedMode ? ['feature_state_degraded'] : []),
    ...warnings.map((warning) => warning.code)
  ];
  const canRetry = actionableErrors.every((error) => error.retryable !== false);
  const status = actionableErrors.length
    ? 'unhealthy'
    : degradedReasons.length
      ? 'degraded'
      : 'healthy';

  return {
    status,
    canRetry,
    retryAfterMs: canRetry && status !== 'healthy' ? ir?.recovery?.retry?.initialDelayMs ?? 1000 : null,
    degradedReasons: uniqueSorted(degradedReasons),
    actionableErrors,
    operatorMessage: buildOperatorMessage(status, actionableErrors, degradedReasons)
  };
}

function normalizeMemoryBindings(memory) {
  return memory.map((entry) => ({
    name: entry.name,
    scope: entry.scope ?? 'job',
    retention: entry.retention ?? 'ephemeral',
    ttlSeconds: Number(entry.ttlSeconds ?? 3600),
    mode: entry.retention === 'bounded' ? 'read_write_bounded' : 'read_write_ephemeral'
  }));
}

function buildKernelCallTimeline(ir) {
  const continuation = ir?.runtimeState?.continuationState ?? {};
  const events = asArray(continuation.events)
    .map((event) => ({
      phase: 'profile_continuation',
      status: event.stateStatus ?? event.status ?? 'unknown',
      generation: Number(event.generation ?? 0),
      code: event.op ?? 'event',
      id: event.id ?? null
    }));
  return [
    {
      phase: 'compiled',
      status: ir?.status ?? 'queued',
      generation: 0,
      code: 'kernel_call_ir_created',
      id: ir?.programId ?? null
    },
    {
      phase: 'validated',
      status: ir?.health?.status ?? 'unknown',
      generation: 0,
      code: ir?.health?.status === 'healthy' ? 'ready_for_handoff' : 'requires_attention',
      id: ir?.handoff?.idempotencyKey ?? null
    },
    ...events,
    {
      phase: 'handoff',
      status: continuation.status ?? ir?.status ?? 'queued',
      generation: Number(continuation.generation ?? 0),
      code: continuation.resumeAction ?? 'resume_after_kernel_ack',
      id: continuation.restartToken ?? ir?.runtimeState?.restartToken ?? null
    }
  ];
}

function normalizeRetryPolicy(input = {}) {
  const maxAttempts = Number(input.maxAttempts ?? 3);
  const initialDelayMs = Number(input.initialDelayMs ?? 1000);
  const maxDelayMs = Number(input.maxDelayMs ?? 30000);
  return {
    strategy: input.strategy ?? 'exponential_backoff',
    maxAttempts: Number.isFinite(maxAttempts) ? Math.max(0, maxAttempts) : 3,
    initialDelayMs: Number.isFinite(initialDelayMs) ? Math.max(100, initialDelayMs) : 1000,
    maxDelayMs: Number.isFinite(maxDelayMs) ? Math.max(1000, maxDelayMs) : 30000,
    retryableStatuses: [...new Set(input.retryableStatuses ?? ['queued', 'runtime_unavailable'])].sort()
  };
}

function normalizeHandoffScope(scope = {}) {
  return {
    tenantId: scope.tenantId ?? 'tenant:local',
    workspaceId: scope.workspaceId ?? 'workspace:local',
    role: scope.role ?? 'automation_worker',
    isolationKey: scope.isolationKey ?? deterministicProgramId('scope', {
      tenantId: scope.tenantId ?? 'tenant:local',
      workspaceId: scope.workspaceId ?? 'workspace:local'
    })
  };
}

function buildKernelProviderServiceContract(ir, input = {}) {
  const operation = ir?.operation ?? input.operation ?? 'unknown';
  const service = input.service ?? 'mailchimp';
  const statusChannel = input.statusChannel ?? ir?.handoff?.statusChannel ?? `kernel.status.${service}`;
  const endpoint = input.endpoint ?? `provider.${service}.${operation}`;
  const externalStateKey = input.externalStateKey
    ?? input.sync?.externalStateKey
    ?? (ir?.handoff?.scope?.tenantId && ir?.handoff?.scope?.workspaceId
      ? `${service}:${ir.handoff.scope.tenantId}:${ir.handoff.scope.workspaceId}:${operation}`
      : null);
  const requiredCapabilities = uniqueSorted([
    ...(ir?.capabilities?.required ?? []),
    ...(input.requiredCapabilities ?? [])
  ]);
  const allowedEffects = uniqueSorted([
    ...(ir?.capabilities?.allowedEffects ?? []),
    ...(input.allowedEffects ?? [])
  ]);
  const deniedEffects = uniqueSorted([
    ...(ir?.capabilities?.deniedEffects ?? []).map((effect) => effect.effect ?? effect),
    ...(input.deniedEffects ?? []).map((effect) => effect.effect ?? effect)
  ]);
  const missingEffects = requiredCapabilities
    .filter((capability) => capability.startsWith('mailchimp.'))
    .filter((capability) => !allowedEffects.includes(capability) && !allowedEffects.includes('mailchimp.write'));
  const requestedStatus = input.status ?? input.healthStatus ?? 'available';
  const status = ['available', 'degraded', 'unavailable', 'blocked'].includes(requestedStatus)
    ? requestedStatus
    : 'available';
  const cursorContract = normalizeKernelProviderCursorContract({
    input,
    ir,
    externalStateKey,
    statusChannel
  });
  const checkpointManifest = normalizeKernelProviderCheckpointManifest({
    input,
    ir,
    externalStateKey,
    statusChannel,
    cursorContract
  });
  const syncLease = normalizeKernelProviderSyncLeaseContract({
    input,
    ir,
    externalStateKey,
    statusChannel,
    cursorContract,
    checkpointManifest,
    requiredCapabilities,
    deniedEffects
  });
  const handoffReceipt = buildKernelProviderHandoffReceipt({
    ir,
    input,
    status,
    statusChannel,
    externalStateKey,
    cursorContract,
    syncLease,
    requiredCapabilities,
    allowedEffects,
    missingEffects,
    deniedEffects
  });
  const blockers = uniqueSorted([
    ...(input.blockers ?? []),
    ...deniedEffects.map((effect) => `provider_denied:${effect}`),
    ...missingEffects.map((effect) => `provider_missing_effect:${effect}`),
    ...(!endpoint ? ['provider_missing_endpoint'] : []),
    ...(!statusChannel ? ['provider_missing_status_channel'] : []),
    ...(status === 'blocked' ? ['provider_blocked'] : []),
    ...(status === 'unavailable' ? ['provider_unavailable'] : []),
    ...(syncLease.state === 'blocked' ? syncLease.blockers.map((blocker) => `sync_lease_${blocker}`) : []),
    ...(checkpointManifest.state === 'blocked' ? checkpointManifest.blockers.map((blocker) => `checkpoint_${blocker}`) : []),
    ...(handoffReceipt.state === 'blocked' ? handoffReceipt.blockers.map((blocker) => `handoff_receipt_${blocker}`) : [])
  ]);
  const warnings = uniqueSorted([
    ...(input.warnings ?? []),
    ...(status === 'degraded' ? ['provider_degraded'] : []),
    ...(ir?.lifecycle?.state === 'degraded' ? ['lifecycle_degraded'] : []),
    ...(syncLease.state === 'review' ? syncLease.warnings.map((warning) => `sync_lease_${warning}`) : []),
    ...(checkpointManifest.state === 'review' ? checkpointManifest.warnings.map((warning) => `checkpoint_${warning}`) : []),
    ...(handoffReceipt.state === 'review' ? handoffReceipt.warnings.map((warning) => `handoff_receipt_${warning}`) : [])
  ]);
  const ready = blockers.length === 0 && status !== 'unavailable' && status !== 'blocked';
  const syncStatus = !ready
    ? 'blocked'
    : status === 'degraded'
      ? 'degraded'
      : ir?.lifecycle?.schedule?.status === 'scheduled'
        ? 'scheduled'
        : ir?.lifecycle?.schedule?.status === 'manual_hold'
          ? 'held'
          : 'ready';
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.provider-service`,
    provider: input.provider ?? ir?.adapter ?? 'mailchimp',
    service,
    operation,
    endpoint,
    target: input.target ?? ir?.handoff?.target ?? 'mailchimp.client.workflow',
    status,
    ready,
    health: {
      status: blockers.length ? 'blocked' : status,
      degraded: status === 'degraded' || warnings.includes('lifecycle_degraded'),
      retryable: !blockers.some((blocker) => blocker.startsWith('provider_denied:') || blocker.startsWith('provider_missing_effect:')),
      retryAfterMs: Number(input.retryAfterMs ?? ir?.recovery?.retry?.initialDelayMs ?? 1000)
    },
    sync: {
      status: syncStatus,
      statusChannel,
      externalStateKey,
      cursor: input.sync?.cursor ?? input.cursor ?? null,
      cursorContract,
      checkpointManifest,
      lease: syncLease,
      handoffReceipt,
      idempotencyKey: input.idempotencyKey ?? ir?.handoff?.idempotencyKey ?? null,
      commandTarget: ir?.call?.target ?? `kernel.jobs.${operation}`,
      externalHandoffRequired: requiredCapabilities.some((capability) => capability.startsWith('mailchimp.'))
    },
    negotiation: {
      requiredCapabilities,
      allowedEffects,
      deniedEffects,
      missingEffects,
      accepted: blockers.length === 0
    },
    blockers,
    warnings,
    nextAction: providerServiceNextAction({ ready, status, blockers, syncStatus })
  };
}

function validateKernelProviderServiceContract(provider, ir) {
  const diagnostics = [];
  if (!provider) return [{ level: 'error', code: 'missing_provider_service_contract' }];
  if (!provider.provider || !provider.service) {
    diagnostics.push({ level: 'error', code: 'provider_service_identity_missing' });
  }
  if (provider.sync?.externalHandoffRequired && !provider.sync?.statusChannel) {
    diagnostics.push({ level: 'error', code: 'provider_service_missing_status_channel' });
  }
  if (provider.status === 'blocked' || provider.status === 'unavailable' || provider.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'provider_service_unavailable', blockers: provider.blockers ?? [] });
  }
  if (provider.status === 'degraded') {
    diagnostics.push({ level: 'warning', code: 'provider_service_degraded', warnings: provider.warnings ?? [] });
  }
  if (provider.sync?.externalHandoffRequired && provider.sync?.cursorContract?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'provider_service_cursor_blocked',
      blockers: provider.sync.cursorContract.blockers ?? []
    });
  }
  if (provider.sync?.externalHandoffRequired && provider.sync?.lease?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'provider_service_sync_lease_blocked',
      blockers: provider.sync.lease.blockers ?? []
    });
  }
  if (provider.sync?.externalHandoffRequired && provider.sync?.checkpointManifest?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'provider_service_checkpoint_blocked',
      blockers: provider.sync.checkpointManifest.blockers ?? []
    });
  }
  if (provider.sync?.externalHandoffRequired && provider.sync?.checkpointManifest?.required && !provider.sync.checkpointManifest.digest) {
    diagnostics.push({ level: 'error', code: 'provider_service_missing_checkpoint_digest' });
  }
  if (provider.sync?.externalHandoffRequired && provider.sync?.handoffReceipt?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'provider_service_handoff_receipt_blocked',
      blockers: provider.sync.handoffReceipt.blockers ?? []
    });
  }
  if (provider.sync?.cursorContract?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'provider_service_cursor_requires_review',
      warnings: provider.sync.cursorContract.warnings ?? []
    });
  }
  if (provider.sync?.lease?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'provider_service_sync_lease_requires_review',
      warnings: provider.sync.lease.warnings ?? []
    });
  }
  if (provider.sync?.checkpointManifest?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'provider_service_checkpoint_requires_review',
      warnings: provider.sync.checkpointManifest.warnings ?? []
    });
  }
  if (provider.sync?.handoffReceipt?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'provider_service_handoff_receipt_requires_review',
      warnings: provider.sync.handoffReceipt.warnings ?? []
    });
  }
  if (ir?.capabilities?.required?.some((capability) => capability.startsWith('mailchimp.')) && provider.negotiation?.accepted !== true) {
    diagnostics.push({ level: 'error', code: 'provider_service_capability_negotiation_failed' });
  }
  return diagnostics;
}

function summarizeKernelProviderServiceContract(provider = {}) {
  return {
    provider: provider?.provider ?? 'mailchimp',
    service: provider?.service ?? 'mailchimp',
    status: provider?.status ?? 'unknown',
    ready: provider?.ready ?? false,
    syncStatus: provider?.sync?.status ?? 'unknown',
    statusChannel: provider?.sync?.statusChannel ?? null,
    externalStateKey: provider?.sync?.externalStateKey ?? null,
    cursorState: provider?.sync?.cursorContract?.state ?? 'unknown',
    cursorDigest: provider?.sync?.cursorContract?.digest ?? null,
    syncLeaseState: provider?.sync?.lease?.state ?? 'unknown',
    syncLeaseDigest: provider?.sync?.lease?.digest ?? null,
    syncLeaseResource: provider?.sync?.lease?.resource ?? null,
    checkpointState: provider?.sync?.checkpointManifest?.state ?? 'unknown',
    checkpointDigest: provider?.sync?.checkpointManifest?.digest ?? null,
    checkpointSnapshotKey: provider?.sync?.checkpointManifest?.snapshotKey ?? null,
    checkpointChangedSincePrevious: provider?.sync?.checkpointManifest?.changedSincePrevious === true,
    checkpointEntryCount: provider?.sync?.checkpointManifest?.entries?.length ?? 0,
    handoffReceiptState: provider?.sync?.handoffReceipt?.state ?? 'unknown',
    handoffReceiptDigest: provider?.sync?.handoffReceipt?.digest ?? null,
    handoffReceiptFresh: provider?.sync?.handoffReceipt?.fresh === true,
    handoffReceiptAcknowledged: provider?.sync?.handoffReceipt?.acknowledged === true,
    retryable: provider?.health?.retryable ?? false,
    missingEffects: provider?.negotiation?.missingEffects ?? [],
    blockerCount: provider?.blockers?.length ?? 0,
    warningCount: provider?.warnings?.length ?? 0,
    nextAction: provider?.nextAction ?? null
  };
}

function buildKernelProviderHandoffReceipt({
  ir,
  input = {},
  status = 'available',
  statusChannel = null,
  externalStateKey = null,
  cursorContract = {},
  syncLease = {},
  requiredCapabilities = [],
  allowedEffects = [],
  missingEffects = [],
  deniedEffects = []
} = {}) {
  const incoming = input.handoffReceipt ?? input.sync?.handoffReceipt ?? {};
  const required = Boolean(incoming.required ?? requiredCapabilities.some((capability) => capability.startsWith('mailchimp.')));
  const acknowledgedDigests = uniqueSorted([
    ...(incoming.acknowledgedDigests ?? []),
    ...(input.acknowledgedDigests ?? [])
  ]);
  const expectedDigestShape = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    provider: input.provider ?? ir?.adapter ?? 'mailchimp',
    statusChannel,
    externalStateKey,
    cursorDigest: cursorContract?.digest ?? null,
    leaseDigest: syncLease?.digest ?? null,
    requiredCapabilities,
    allowedEffects,
    missingEffects,
    deniedEffects,
    idempotencyKey: input.idempotencyKey ?? ir?.handoff?.idempotencyKey ?? null
  };
  const expectedDigest = stableHash(expectedDigestShape);
  const receiptDigest = incoming.digest ?? null;
  const acknowledged = incoming.acknowledged === true
    || acknowledgedDigests.includes(expectedDigest)
    || (receiptDigest != null && acknowledgedDigests.includes(receiptDigest));
  const fresh = receiptDigest == null || receiptDigest === expectedDigest;
  const blockers = uniqueSorted([
    ...(incoming.blockers ?? []),
    ...(required && !statusChannel ? ['provider_handoff_receipt_missing_status_channel'] : []),
    ...(required && !externalStateKey ? ['provider_handoff_receipt_missing_external_state_key'] : []),
    ...(required && syncLease?.state === 'blocked' ? ['provider_handoff_receipt_sync_lease_blocked'] : []),
    ...(required && cursorContract?.state === 'blocked' ? ['provider_handoff_receipt_cursor_blocked'] : []),
    ...(required && deniedEffects.length ? ['provider_handoff_receipt_denied_effect'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(incoming.warnings ?? []),
    ...(required && !acknowledged ? ['provider_handoff_receipt_acknowledgement_missing'] : []),
    ...(required && !fresh ? ['provider_handoff_receipt_stale'] : []),
    ...(required && status === 'degraded' ? ['provider_handoff_receipt_provider_degraded'] : []),
    ...(required && missingEffects.length ? ['provider_handoff_receipt_capability_gap'] : []),
    ...(required && syncLease?.state === 'review' ? ['provider_handoff_receipt_sync_lease_review'] : []),
    ...(required && cursorContract?.state === 'review' ? ['provider_handoff_receipt_cursor_review'] : [])
  ]);
  const state = !required
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.provider-handoff-receipt`,
    provider: input.provider ?? ir?.adapter ?? 'mailchimp',
    service: input.service ?? 'mailchimp',
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    required,
    state,
    ready: state === 'ready' || state === 'not_required',
    acknowledged,
    fresh,
    expectedDigest,
    receiptDigest,
    acknowledgedDigests,
    statusChannel,
    externalStateKey,
    cursorDigest: cursorContract?.digest ?? null,
    leaseDigest: syncLease?.digest ?? null,
    command: required ? {
      type: 'ack-mailchimp-provider-handoff-receipt',
      commandId: `kernel-provider-handoff-receipt:${expectedDigest}`,
      idempotencyKey: stableHash({
        programId: ir?.programId ?? null,
        operation: ir?.operation ?? null,
        action: 'kernel-provider-handoff-receipt',
        expectedDigest
      }),
      statusAfterReplay: state,
      conflict: 'return-existing'
    } : null,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? providerHandoffReceiptAction(blockers[0])
      : state === 'review'
        ? 'acknowledge_mailchimp_provider_handoff_receipt'
        : required
          ? 'persist_mailchimp_provider_handoff_receipt'
          : 'continue_without_provider_handoff_receipt',
    digest: receiptDigest ?? expectedDigest
  };
}

function normalizeKernelProviderCursorContract({
  input = {},
  ir = null,
  externalStateKey = null,
  statusChannel = null
} = {}) {
  const sync = input.sync ?? {};
  const incoming = sync.cursorContract ?? input.cursorContract ?? {};
  const cursor = incoming.cursor
    ?? sync.cursor
    ?? input.cursor
    ?? ir?.handoff?.providerCursor
    ?? null;
  const watermark = incoming.watermark
    ?? sync.watermark
    ?? input.watermark
    ?? null;
  const freshness = String(incoming.freshness ?? sync.cursorFreshness ?? input.cursorFreshness ?? (cursor == null ? 'missing' : 'fresh'));
  const policy = incoming.policy ?? sync.cursorPolicy ?? input.cursorPolicy ?? 'resume_from_last_seen';
  const required = incoming.required ?? sync.cursorRequired ?? false;
  const acceptableFreshness = uniqueSorted(asArray(
    incoming.acceptableFreshness
      ?? sync.acceptableFreshness
      ?? ['fresh', 'unknown']
  ).map(String));
  const cursorState = required && cursor == null
    ? 'missing'
    : !acceptableFreshness.includes(freshness)
      ? 'stale'
      : 'ready';
  const blockers = uniqueSorted([
    ...(incoming.blockers ?? []),
    ...(required && cursor == null ? ['kernel_provider_cursor_missing'] : []),
    ...(cursorState === 'stale' && policy === 'strict_resume' ? ['kernel_provider_cursor_stale'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(incoming.warnings ?? []),
    ...(cursorState === 'stale' && policy !== 'strict_resume' ? ['kernel_provider_cursor_stale'] : []),
    ...(watermark == null && cursor != null ? ['kernel_provider_cursor_watermark_missing'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'review'
      : cursorState === 'missing'
        ? 'blocked'
        : 'ready';
  const digestShape = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    externalStateKey,
    statusChannel,
    cursor,
    watermark,
    freshness,
    policy,
    state
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.provider-sync-cursor`,
    state,
    ready: state === 'ready',
    required: Boolean(required),
    cursor,
    watermark,
    freshness,
    policy,
    acceptableFreshness,
    externalStateKey,
    statusChannel,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? 'restore_kernel_provider_cursor'
      : state === 'review'
        ? 'review_kernel_provider_cursor'
        : 'persist_kernel_provider_cursor',
    digest: incoming.digest ?? stableHash(digestShape)
  };
}

function normalizeKernelProviderCheckpointManifest({
  input = {},
  ir = null,
  externalStateKey = null,
  statusChannel = null,
  cursorContract = {}
} = {}) {
  const sync = input.sync ?? {};
  const incoming = sync.checkpointManifest ?? sync.checkpoint ?? input.checkpointManifest ?? input.session?.checkpointManifest ?? {};
  const phases = uniqueSorted(asList(incoming.phases ?? sync.checkpointPhases ?? ['provider_cursor', 'provider_lease', 'external_handoff']));
  const required = Boolean(
    incoming.required
      ?? sync.checkpointRequired
      ?? sync.leaseRequired
      ?? cursorContract?.required
      ?? false
  );
  const latestDigest = incoming.latestDigest
    ?? sync.checkpointDigest
    ?? input.checkpointDigest
    ?? null;
  const previousDigest = incoming.previousDigest
    ?? sync.previousCheckpointDigest
    ?? input.previousCheckpointDigest
    ?? null;
  const changedSincePrevious = Boolean(
    incoming.changedSincePrevious
      ?? sync.changedSincePrevious
      ?? (latestDigest && previousDigest && latestDigest !== previousDigest)
  );
  const snapshotKey = incoming.snapshotKey
    ?? sync.snapshotKey
    ?? (externalStateKey ? `${externalStateKey}:checkpoint` : null);
  const persistMode = incoming.persistMode ?? sync.checkpointPersistMode ?? 'replace_by_external_state_key';
  const replayMode = incoming.replayMode ?? sync.checkpointReplayMode ?? 'resume_from_checkpoint_digest';
  const entries = phases.map((phase) => {
    const digest = stableHash({
      programId: ir?.programId ?? null,
      operation: ir?.operation ?? null,
      phase,
      externalStateKey,
      statusChannel,
      cursorDigest: cursorContract?.digest ?? null,
      latestDigest,
      snapshotKey
    });
    return {
      phase,
      state: cursorContract?.state === 'blocked' && phase === 'provider_cursor'
        ? 'blocked'
        : latestDigest
          ? 'ready'
          : required
            ? 'waiting'
            : 'optional',
      digest,
      cursorDigest: cursorContract?.digest ?? null,
      changedSincePrevious,
      restartSafe: Boolean(snapshotKey && replayMode === 'resume_from_checkpoint_digest'),
      nextAction: latestDigest
        ? 'persist_kernel_provider_checkpoint'
        : required
          ? 'capture_kernel_provider_checkpoint'
          : 'continue_without_kernel_provider_checkpoint'
    };
  });
  const blockers = uniqueSorted([
    ...(incoming.blockers ?? []),
    ...(required && !externalStateKey ? ['kernel_provider_checkpoint_missing_external_state_key'] : []),
    ...(required && !statusChannel ? ['kernel_provider_checkpoint_missing_status_channel'] : []),
    ...(required && !snapshotKey ? ['kernel_provider_checkpoint_missing_snapshot_key'] : []),
    ...(required && cursorContract?.state === 'blocked' ? ['kernel_provider_checkpoint_cursor_blocked'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(incoming.warnings ?? []),
    ...(required && !latestDigest ? ['kernel_provider_checkpoint_digest_not_captured'] : []),
    ...(cursorContract?.state === 'review' ? ['kernel_provider_checkpoint_cursor_review'] : []),
    ...(changedSincePrevious ? ['kernel_provider_checkpoint_changed_since_previous'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'review'
      : required
        ? 'ready'
        : 'optional';
  const digestShape = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    externalStateKey,
    statusChannel,
    snapshotKey,
    latestDigest,
    previousDigest,
    phases,
    entries: entries.map((entry) => ({ phase: entry.phase, state: entry.state, digest: entry.digest })),
    persistMode,
    replayMode
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.provider-sync-checkpoint-manifest`,
    state,
    ready: state === 'ready' || state === 'optional',
    required,
    externalStateKey,
    statusChannel,
    snapshotKey,
    latestDigest,
    previousDigest,
    changedSincePrevious,
    cursorDigest: cursorContract?.digest ?? null,
    phases,
    entries,
    persistMode,
    replayMode,
    blockers,
    warnings,
    command: required ? {
      type: 'persist-mailchimp-provider-sync-checkpoint',
      commandId: `kernel-provider-sync-checkpoint:${stableHash(digestShape)}`,
      idempotencyKey: stableHash({
        programId: ir?.programId ?? null,
        operation: ir?.operation ?? null,
        action: 'kernel-provider-sync-checkpoint',
        externalStateKey,
        snapshotKey
      }),
      persistMode,
      replayMode,
      statusAfterReplay: state,
      conflict: 'return-existing'
    } : null,
    nextAction: state === 'blocked'
      ? kernelProviderCheckpointAction(blockers[0])
      : state === 'review'
        ? 'review_kernel_provider_checkpoint'
        : required
          ? 'persist_kernel_provider_checkpoint'
          : 'continue_without_kernel_provider_checkpoint',
    digest: incoming.digest ?? stableHash(digestShape)
  };
}

function kernelProviderCheckpointAction(blocker) {
  if (blocker === 'kernel_provider_checkpoint_missing_external_state_key') return 'bind_kernel_provider_external_state';
  if (blocker === 'kernel_provider_checkpoint_missing_status_channel') return 'bind_kernel_provider_status_channel';
  if (blocker === 'kernel_provider_checkpoint_missing_snapshot_key') return 'bind_kernel_provider_snapshot_key';
  if (blocker === 'kernel_provider_checkpoint_cursor_blocked') return 'restore_kernel_provider_cursor';
  return 'repair_kernel_provider_checkpoint';
}

function normalizeKernelProviderSyncLeaseContract({
  input = {},
  ir = null,
  externalStateKey = null,
  statusChannel = null,
  cursorContract = {},
  checkpointManifest = {},
  requiredCapabilities = [],
  deniedEffects = []
} = {}) {
  const sync = input.sync ?? {};
  const incoming = sync.lease ?? input.lease ?? input.session?.syncLease ?? {};
  const resource = {
    audienceId: incoming.resource?.audienceId ?? incoming.audienceId ?? sync.audienceId ?? input.audienceId ?? input.listId ?? null,
    campaignId: incoming.resource?.campaignId ?? incoming.campaignId ?? sync.campaignId ?? input.campaignId ?? null,
    segmentId: incoming.resource?.segmentId ?? incoming.segmentId ?? sync.segmentId ?? input.segmentId ?? null,
    tenantId: incoming.resource?.tenantId ?? ir?.handoff?.scope?.tenantId ?? null,
    workspaceId: incoming.resource?.workspaceId ?? ir?.handoff?.scope?.workspaceId ?? null
  };
  const required = Boolean(
    incoming.required
    ?? sync.leaseRequired
    ?? requiredCapabilities.some((capability) => capability.startsWith('mailchimp.'))
  );
  const ttlSeconds = Math.max(60, Number(incoming.ttlSeconds ?? sync.leaseTtlSeconds ?? 900));
  const renewalWindowSeconds = Math.max(30, Number(incoming.renewalWindowSeconds ?? sync.leaseRenewalWindowSeconds ?? Math.floor(ttlSeconds / 3)));
  const blockers = uniqueSorted([
    ...(incoming.blockers ?? []),
    ...(required && !externalStateKey ? ['kernel_provider_sync_lease_missing_external_state_key'] : []),
    ...(required && !statusChannel ? ['kernel_provider_sync_lease_missing_status_channel'] : []),
    ...(required && !resource.audienceId && !resource.campaignId ? ['kernel_provider_sync_lease_missing_mailchimp_resource'] : []),
    ...(deniedEffects.length ? ['kernel_provider_sync_lease_denied_effect'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(incoming.warnings ?? []),
    ...(required && cursorContract?.state === 'review' ? ['kernel_provider_sync_lease_cursor_review'] : []),
    ...(required && cursorContract?.state === 'blocked' ? ['kernel_provider_sync_lease_cursor_blocked'] : []),
    ...(ttlSeconds < renewalWindowSeconds ? ['kernel_provider_sync_lease_renewal_window_exceeds_ttl'] : [])
  ]);
  const state = !required
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const digestShape = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    state,
    externalStateKey,
    statusChannel,
    resource,
    ttlSeconds,
    renewalWindowSeconds,
    cursorDigest: cursorContract?.digest ?? null,
    checkpointDigest: checkpointManifest?.digest ?? null
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.provider-sync-lease`,
    state,
    ready: state === 'ready' || state === 'not_required',
    required,
    externalStateKey,
    statusChannel,
    resource,
    owner: incoming.owner ?? sync.owner ?? ir?.handoff?.scope?.role ?? 'automation_worker',
    ttlSeconds,
    renewalWindowSeconds,
    renewalPolicy: incoming.renewalPolicy ?? input.renewalPolicy ?? 'renew_before_expiry',
    replayPolicy: incoming.replayPolicy ?? input.replayPolicy ?? 'return_existing_by_lease_key',
    cursorDigest: cursorContract?.digest ?? null,
    checkpointDigest: checkpointManifest?.digest ?? null,
    blockers,
    warnings,
    command: required ? {
      type: 'persist-mailchimp-provider-sync-lease',
      commandId: `kernel-provider-sync-lease:${stableHash(digestShape)}`,
      idempotencyKey: stableHash({
        programId: ir?.programId ?? null,
        operation: ir?.operation ?? null,
        action: 'kernel-provider-sync-lease',
        externalStateKey,
        audienceId: resource.audienceId,
        campaignId: resource.campaignId
      }),
      checkpointDigest: checkpointManifest?.digest ?? null,
      statusAfterReplay: state,
      conflict: 'return-existing'
    } : null,
    nextAction: state === 'blocked'
      ? 'bind_kernel_provider_sync_lease'
      : state === 'review'
        ? 'review_kernel_provider_sync_lease'
        : required
          ? 'persist_kernel_provider_sync_lease'
          : 'continue_without_kernel_provider_sync_lease',
    digest: incoming.digest ?? stableHash(digestShape)
  };
}

function providerServiceNextAction({ ready, status, blockers, syncStatus }) {
  if (blockers.some((blocker) => blocker.startsWith('provider_denied:'))) return 'resolve_provider_denied_effect';
  if (blockers.some((blocker) => blocker.startsWith('provider_missing_effect:'))) return 'enable_provider_capability';
  if (blockers.includes('provider_missing_status_channel')) return 'bind_provider_status_channel';
  if (status === 'blocked') return 'resolve_provider_block';
  if (status === 'unavailable') return 'retry_provider_after_backoff';
  if (syncStatus === 'held') return 'await_manual_release';
  if (syncStatus === 'scheduled') return 'wait_for_schedule_window';
  if (status === 'degraded') return 'handoff_with_provider_degraded_ack';
  return ready ? 'sync_provider_service_contract' : 'operator_review';
}

function validateKernelCallIRWithoutHealth(ir) {
  const diagnostics = [];
  if (!ir?.programId) diagnostics.push({ level: 'error', code: 'missing_program_id' });
  if (!ir?.operation || ir.operation === 'unknown') diagnostics.push({ level: 'error', code: 'missing_operation' });
  if (!ir?.adapter) diagnostics.push({ level: 'error', code: 'missing_runtime_adapter' });
  if (!ir?.capabilities?.required?.length) diagnostics.push({ level: 'error', code: 'missing_capabilities' });
  if (ir?.capabilities?.deniedEffects?.length) diagnostics.push({ level: 'error', code: 'denied_effects_present' });
  if (ir?.verifier?.mode === 'strict' && ir.verifier.missingClaims.length) {
    diagnostics.push({ level: 'error', code: 'missing_strict_verifier_claims', claims: ir.verifier.missingClaims });
  }
  if (ir?.truth?.reportRequired && !ir.truth.boundaries.length) {
    diagnostics.push({ level: 'warning', code: 'empty_truth_boundary_report' });
  }
  if (ir?.recovery?.rollbackRequired && !ir.recovery.rollbackAction) {
    diagnostics.push({ level: 'error', code: 'missing_rollback_action' });
  }
  if (ir?.recovery?.retry?.maxAttempts < 1) diagnostics.push({ level: 'error', code: 'invalid_retry_policy' });
  if (!ir?.handoff?.idempotencyKey) diagnostics.push({ level: 'error', code: 'missing_handoff_idempotency_key' });
  if (!ir?.handoff?.scope?.tenantId || !ir?.handoff?.scope?.workspaceId) {
    diagnostics.push({ level: 'error', code: 'missing_handoff_scope' });
  }
  if (ir?.runtimeState?.featureState?.status === 'blocked') {
    diagnostics.push({ level: 'error', code: 'feature_state_blocked' });
  }
  diagnostics.push(...validateSemanticReports(ir?.semantic));
  diagnostics.push(...validateLifecycleControls(ir?.lifecycle));
  diagnostics.push(...validateKernelProviderServiceContract(ir?.provider, ir));
  diagnostics.push(...validateAcceptanceState(ir?.preview?.acceptance));
  diagnostics.push(...validatePersistedProviderState(ir?.persistedState, ir));
  diagnostics.push(...validateKernelClientRuntimeHandoffPacket(ir?.clientHandoff, ir));
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
    diagnostics
  };
}

function actionableErrorFromDiagnostic(diagnostic, ir) {
  const retryable = ![
    'missing_capabilities',
    'missing_runtime_adapter',
    'missing_handoff_scope',
    'feature_state_blocked',
    'lifecycle_disabled',
    'lifecycle_permission_boundary_blocked'
  ].includes(diagnostic.code);
  return {
    code: diagnostic.code,
    retryable,
    action: actionForDiagnostic(diagnostic.code),
    statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
    details: stableClone(diagnostic)
  };
}

function buildDeniedEffectErrors(ir) {
  return (ir?.capabilities?.deniedEffects ?? []).map((effect) => ({
    code: 'denied_runtime_effect',
    effect: effect.effect,
    retryable: false,
    action: 'enable_required_feature_or_remove_effect',
    statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
    details: stableClone(effect)
  }));
}

function buildMissingClaimErrors(ir) {
  if (ir?.verifier?.mode !== 'strict') return [];
  return (ir?.verifier?.missingClaims ?? []).map((claim) => ({
    code: 'missing_verifier_claim',
    claim,
    retryable: true,
    action: 'collect_claim_before_enqueue',
    statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review'
  }));
}

function buildClientRuntimeAdoptionErrors(ir) {
  const adoption = ir?.semantic?.externalWrite?.clientRuntimeAdoption ?? null;
  const adoptionReceipt = ir?.semantic?.externalWrite?.clientRuntimeAdoptionReceipt ?? null;
  const recoveryAdoption = ir?.semantic?.recovery?.persistedClientState?.clientRuntimeAdoption ?? null;
  const recoveryAdoptionReceipt = ir?.semantic?.recovery?.persistedClientState?.clientRuntimeAdoptionReceipt ?? null;
  if (!ir?.semantic?.externalWrite?.writeRequired || !adoption) return [];
  const errors = [];
  if (adoption.state === 'blocked') {
    errors.push({
      code: 'client_runtime_adoption_blocked',
      retryable: true,
      action: adoption.nextAction ?? 'repair_client_runtime_adoption',
      statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
      details: {
        blockers: adoption.blockers ?? [],
        digest: adoption.digest ?? null,
        clientRequestDigest: adoption.clientRequestDigest ?? null
      }
    });
  }
  if (adoption.state === 'awaiting_acknowledgement' && !adoption.requiredAcknowledgements?.length) {
    errors.push({
      code: 'client_runtime_adoption_acknowledgement_unshaped',
      retryable: false,
      action: 'repair_client_runtime_adoption_acknowledgement',
      statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
      details: { digest: adoption.digest ?? null }
    });
  }
  if (recoveryAdoption?.state === 'blocked') {
    errors.push({
      code: 'recovery_client_runtime_adoption_blocked',
      retryable: true,
      action: recoveryAdoption.nextAction ?? 'persist_client_runtime_adoption',
      statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
      details: {
        blockers: recoveryAdoption.blockers ?? [],
        digest: recoveryAdoption.digest ?? null
      }
    });
  }
  if (!adoptionReceipt?.digest) {
    errors.push({
      code: 'client_runtime_adoption_receipt_missing',
      retryable: true,
      action: 'persist_client_runtime_adoption_receipt',
      statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
      details: {
        adoptionDigest: adoption.digest ?? null,
        clientRequestDigest: adoption.clientRequestDigest ?? null
      }
    });
  }
  if (adoptionReceipt?.state === 'blocked') {
    errors.push({
      code: 'client_runtime_adoption_receipt_blocked',
      retryable: true,
      action: adoptionReceipt.nextAction ?? 'repair_client_runtime_adoption_receipt',
      statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
      details: {
        blockers: adoptionReceipt.blockers ?? [],
        receiptKey: adoptionReceipt.receiptKey ?? null,
        digest: adoptionReceipt.digest ?? null
      }
    });
  }
  if (adoptionReceipt?.ready && adoptionReceipt?.restartSemantics?.restartSafe !== true) {
    errors.push({
      code: 'client_runtime_adoption_receipt_not_restart_safe',
      retryable: false,
      action: 'rebuild_client_runtime_adoption_receipt',
      statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
      details: {
        receiptKey: adoptionReceipt.receiptKey ?? null,
        digest: adoptionReceipt.digest ?? null
      }
    });
  }
  if (recoveryAdoptionReceipt?.state === 'blocked') {
    errors.push({
      code: 'recovery_client_runtime_adoption_receipt_blocked',
      retryable: true,
      action: recoveryAdoptionReceipt.nextAction ?? 'repair_persisted_client_runtime_state',
      statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
      details: {
        blockers: recoveryAdoptionReceipt.blockers ?? [],
        digest: recoveryAdoptionReceipt.digest ?? null
      }
    });
  }
  if (recoveryAdoptionReceipt?.ready && recoveryAdoptionReceipt?.restartSafe !== true) {
    errors.push({
      code: 'recovery_client_runtime_adoption_receipt_not_restart_safe',
      retryable: false,
      action: 'rebuild_recovery_client_runtime_adoption_receipt',
      statusOnFailure: ir?.recovery?.failureStatus ?? 'needs_operator_review',
      details: {
        digest: recoveryAdoptionReceipt.digest ?? null,
        receiptKey: recoveryAdoptionReceipt.receiptKey ?? null
      }
    });
  }
  return errors;
}

function actionForDiagnostic(code) {
  return {
    missing_program_id: 'provide_program_id_or_stable_input',
    missing_operation: 'select_supported_mailchimp_operation',
    missing_runtime_adapter: 'bind_mailchimp_runtime_adapter',
    missing_capabilities: 'declare_mailchimp_capability_contract',
    denied_effects_present: 'resolve_denied_effects_before_enqueue',
    missing_strict_verifier_claims: 'collect_required_verifier_claims',
    missing_rollback_action: 'declare_rollback_action',
    invalid_retry_policy: 'set_retry_max_attempts',
    missing_handoff_idempotency_key: 'provide_handoff_idempotency_key',
    missing_handoff_scope: 'provide_tenant_and_workspace_scope',
    feature_state_blocked: 'recover_feature_flag_state',
    lifecycle_disabled: 'enable_lifecycle_before_handoff',
    lifecycle_invalid_schedule_window: 'repair_lifecycle_schedule_window',
    lifecycle_permission_boundary_blocked: 'resolve_permission_boundary_before_handoff',
    semantic_external_write_blocked: 'resolve_external_write_before_handoff',
    semantic_recovery_blocked: 'repair_recovery_contract_before_handoff'
  }[code] ?? 'operator_review';
}

function buildOperatorMessage(status, actionableErrors, degradedReasons) {
  if (status === 'healthy') return 'Kernel call is ready for Mailchimp runtime handoff.';
  if (status === 'degraded') {
    return `Kernel call can continue in degraded mode: ${degradedReasons.join(', ')}`;
  }
  return `Kernel call is blocked by ${actionableErrors.map((error) => error.code).join(', ')}`;
}

export function buildKernelCallUIPreview(ir) {
  const health = ir?.health ?? deriveKernelCallHealth(ir);
  const analytics = ir?.analytics ?? deriveKernelCallAnalytics({ ...ir, health });
  const semantic = summarizeSemanticReports(ir?.semantic);
  const readiness = derivePreviewReadiness({ ir, health, analytics, semantic });
  const acceptance = deriveAcceptanceState({ ir, health, analytics, semantic, readiness });
  const nextSteps = buildExplainableNextSteps({ ir, health, semantic, readiness, acceptance });
  const operatorActionCard = buildKernelOperatorActionCard({
    ir,
    health,
    analytics,
    semantic,
    readiness,
    acceptance,
    nextSteps
  });
  const acceptanceCheckpointBundle = buildKernelAcceptanceCheckpointPreview({
    ir,
    semantic,
    readiness,
    acceptance,
    operatorActionCard
  });
  const routeExport = buildKernelRouteExportPreview({ ir, semantic, readiness, acceptance, operatorActionCard });
  const nextActionState = buildKernelNextActionState({
    ir,
    health,
    analytics,
    semantic,
    readiness,
    acceptance,
    nextSteps,
    operatorActionCard,
    routeExport
  });
  const operatorLifecycleAction = buildKernelOperatorLifecycleAction({
    ir,
    readiness,
    acceptance,
    nextActionState,
    routeExport
  });
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.ui-preview`,
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    adapter: ir?.adapter ?? 'mailchimp',
    status: ir?.status ?? 'unknown',
    title: `Mailchimp ${ir?.operation ?? 'operation'} handoff`,
    subtitle: previewSubtitle({ health, readiness, semantic }),
    readiness,
    acceptance,
    acceptanceCheckpointBundle,
    lifecycleCommandQueue: summarizeLifecycleCommandQueue(ir?.lifecycle?.commandQueue),
    routeExport,
    operatorActionCard,
    nextActionState,
    operatorLifecycleAction,
    validationSummary: buildValidationSummary(ir),
    nextSteps,
    handoff: {
      target: ir?.handoff?.target ?? null,
      queue: ir?.call?.target ?? null,
      statusChannel: ir?.handoff?.statusChannel ?? null,
      idempotencyKey: ir?.handoff?.idempotencyKey ?? null,
      continuationMode: ir?.handoff?.continuationMode ?? null,
      restartToken: ir?.runtimeState?.profileRestartToken ?? ir?.runtimeState?.restartToken ?? null
    },
    runtimeWorkflow: buildRuntimeWorkflowHandoff({ ir, health, analytics, semantic, readiness, acceptance }),
    scope: {
      tenantId: ir?.handoff?.scope?.tenantId ?? null,
      workspaceId: ir?.handoff?.scope?.workspaceId ?? null,
      role: ir?.handoff?.scope?.role ?? null,
      isolationKey: ir?.handoff?.scope?.isolationKey ?? null
    },
    counters: {
      blockingIssueCount: readiness.blockingReasons.length,
      warningCount: readiness.warningReasons.length,
      actionableErrorCount: analytics.counters?.actionableErrorCount ?? 0,
      missingClaimCount: analytics.counters?.missingClaimCount ?? 0,
      deniedEffectCount: analytics.counters?.deniedEffectCount ?? 0,
      externalWriteRequiredCount: analytics.counters?.externalWriteRequiredCount ?? 0,
      recoveryBlockedCount: analytics.counters?.recoveryBlockedCount ?? 0,
      lifecycleCommandQueueReadyCount: ir?.lifecycle?.commandQueue?.ready ? 1 : 0,
      lifecycleCommandQueuePendingCount: ir?.lifecycle?.commandQueue?.pending?.length ?? 0,
      lifecycleCommandQueueBlockedCount: ir?.lifecycle?.commandQueue?.blocked?.length ?? 0,
      routeExportReadyCount: routeExport.ready ? 1 : 0,
      routeExportChangedCount: routeExport.changedSinceAcceptedSnapshot ? 1 : 0,
      routeExportBlockerCount: routeExport.blockers.length,
      routeExportWarningCount: routeExport.warnings.length,
      analyticsPublicationReadyCount: routeExport.analyticsPublication?.ready ? 1 : 0,
      analyticsPublicationTargetCount: routeExport.analyticsPublication?.targetCount ?? 0,
      analyticsPublicationMissingAcknowledgementCount: routeExport.analyticsPublication?.missingAcknowledgementCount ?? 0,
      analyticsPublicationFreshnessWarningCount: routeExport.analyticsPublication?.freshnessWarningCount ?? 0,
      timelinePublicationReadyCount: routeExport.timelinePublication?.ready ? 1 : 0,
      timelinePublicationEventCount: routeExport.timelinePublication?.eventCount ?? 0,
      timelinePublicationSnapshotCount: routeExport.timelinePublication?.snapshotCount ?? 0,
      timelinePublicationDriftCount: routeExport.timelinePublication?.changedSinceAcceptedSnapshot ? 1 : 0,
      timelinePublicationBlockerCount: routeExport.timelinePublication?.blockerCount ?? 0,
      timelinePublicationWarningCount: routeExport.timelinePublication?.warningCount ?? 0,
      operatorActionCardReadyCount: operatorActionCard.ready ? 1 : 0,
      operatorActionCardBlockerCount: operatorActionCard.blockers.length,
      operatorActionCardWarningCount: operatorActionCard.warnings.length,
      acceptanceCheckpointReadyCount: acceptanceCheckpointBundle.ready ? 1 : 0,
      acceptanceCheckpointAlignedCount: acceptanceCheckpointBundle.aligned ? 1 : 0,
      acceptanceCheckpointRestartSafeCount: acceptanceCheckpointBundle.restartSafe ? 1 : 0,
      acceptanceCheckpointBlockerCount: acceptanceCheckpointBundle.blockerCount,
      acceptanceCheckpointWarningCount: acceptanceCheckpointBundle.warningCount,
      acceptanceCheckpointCount: acceptanceCheckpointBundle.checkpointCount,
      nextActionReadyCount: nextActionState.ready ? 1 : 0,
      nextActionCommandCount: nextActionState.commands.length,
      nextActionBlockerCount: nextActionState.blockers.length,
      nextActionWarningCount: nextActionState.warnings.length,
      operatorLifecycleActionReadyCount: operatorLifecycleAction.ready ? 1 : 0,
      operatorLifecycleActionCommandCount: operatorLifecycleAction.commands.length,
      operatorLifecycleActionBlockerCount: operatorLifecycleAction.blockers.length,
      operatorLifecycleActionWarningCount: operatorLifecycleAction.warnings.length,
      runtimeWorkflowBlockedCount: readiness.blockingReasons.length ? 1 : 0
    }
  };
}

export function summarizeKernelCallUIPreview(preview = {}) {
  return {
    status: preview?.status ?? 'unknown',
    readiness: preview?.readiness?.state ?? 'unknown',
    acceptance: preview?.acceptance?.state ?? 'unknown',
    acceptEnabled: preview?.acceptance?.enabled ?? false,
    nextAction: preview?.nextActionState?.primaryAction ?? preview?.nextSteps?.[0]?.action ?? preview?.acceptance?.nextAction ?? null,
    operatorActionCard: {
      state: preview?.operatorActionCard?.state ?? 'unknown',
      ready: preview?.operatorActionCard?.ready ?? false,
      primaryAction: preview?.operatorActionCard?.primaryAction ?? null,
      digest: preview?.operatorActionCard?.digest ?? null,
      commandId: preview?.operatorActionCard?.commandId ?? null,
      blockerCount: preview?.operatorActionCard?.blockers?.length ?? 0,
      warningCount: preview?.operatorActionCard?.warnings?.length ?? 0
    },
    acceptanceCheckpointBundle: {
      state: preview?.acceptanceCheckpointBundle?.state ?? 'unknown',
      ready: preview?.acceptanceCheckpointBundle?.ready ?? false,
      aligned: preview?.acceptanceCheckpointBundle?.aligned ?? false,
      restartSafe: preview?.acceptanceCheckpointBundle?.restartSafe ?? false,
      digest: preview?.acceptanceCheckpointBundle?.digest ?? null,
      commandId: preview?.acceptanceCheckpointBundle?.commandId ?? null,
      checkpointCount: preview?.acceptanceCheckpointBundle?.checkpointCount ?? 0,
      nextAction: preview?.acceptanceCheckpointBundle?.nextAction ?? null,
      blockerCount: preview?.acceptanceCheckpointBundle?.blockerCount ?? 0,
      warningCount: preview?.acceptanceCheckpointBundle?.warningCount ?? 0
    },
    routeExport: {
      state: preview?.routeExport?.state ?? 'unknown',
      ready: preview?.routeExport?.ready ?? false,
      publishCommandId: preview?.routeExport?.publishCommandId ?? null,
      analyticsPublishCommandId: preview?.routeExport?.analyticsPublication?.publishCommandId ?? null,
      digest: preview?.routeExport?.digest ?? null,
      changedSinceAcceptedSnapshot: preview?.routeExport?.changedSinceAcceptedSnapshot ?? false,
      analyticsPublication: {
        state: preview?.routeExport?.analyticsPublication?.state ?? 'unknown',
        ready: preview?.routeExport?.analyticsPublication?.ready ?? false,
        digest: preview?.routeExport?.analyticsPublication?.digest ?? null,
        targetCount: preview?.routeExport?.analyticsPublication?.targetCount ?? 0,
        missingAcknowledgementCount: preview?.routeExport?.analyticsPublication?.missingAcknowledgementCount ?? 0,
        freshnessWarningCount: preview?.routeExport?.analyticsPublication?.freshnessWarningCount ?? 0
      },
      timelinePublication: {
        state: preview?.routeExport?.timelinePublication?.state ?? 'unknown',
        ready: preview?.routeExport?.timelinePublication?.ready ?? false,
        digest: preview?.routeExport?.timelinePublication?.digest ?? null,
        publishCommandId: preview?.routeExport?.timelinePublication?.publishCommandId ?? null,
        eventCount: preview?.routeExport?.timelinePublication?.eventCount ?? 0,
        snapshotCount: preview?.routeExport?.timelinePublication?.snapshotCount ?? 0,
        changedSinceAcceptedSnapshot: preview?.routeExport?.timelinePublication?.changedSinceAcceptedSnapshot ?? false,
        blockerCount: preview?.routeExport?.timelinePublication?.blockerCount ?? 0,
        warningCount: preview?.routeExport?.timelinePublication?.warningCount ?? 0
      },
      nextAction: preview?.routeExport?.nextAction ?? null,
      blockerCount: preview?.routeExport?.blockers?.length ?? 0,
      warningCount: preview?.routeExport?.warnings?.length ?? 0
    },
    nextActionState: summarizeKernelNextActionState(preview?.nextActionState),
    operatorLifecycleAction: summarizeKernelOperatorLifecycleAction(preview?.operatorLifecycleAction),
    runtimeWorkflow: summarizeRuntimeWorkflowHandoff(preview?.runtimeWorkflow),
    blockingReasons: preview?.readiness?.blockingReasons ?? [],
    warningReasons: preview?.readiness?.warningReasons ?? [],
    validation: preview?.validationSummary ?? { errorCount: 0, warningCount: 0, infoCount: 0 }
  };
}

function buildKernelAcceptanceCheckpointPreview({
  ir,
  semantic,
  readiness,
  acceptance,
  operatorActionCard
}) {
  const source = ir?.semantic?.externalWrite?.acceptanceCheckpointBundle ?? {};
  const writeRequired = semantic?.externalWriteRequired === true;
  const blockers = uniqueSorted([
    ...(source.blockers ?? []),
    ...(writeRequired && source.restartSafe !== true ? ['acceptance_checkpoint_not_restart_safe'] : []),
    ...(writeRequired && source.aligned !== true ? ['acceptance_checkpoint_not_aligned'] : []),
    ...(readiness?.state === 'blocked' ? ['preview_readiness_blocked'] : []),
    ...(operatorActionCard?.state === 'blocked' ? ['operator_action_card_blocked'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(source.warnings ?? []),
    ...(acceptance?.missingAcknowledgements?.length ? ['acceptance_acknowledgement_missing'] : []),
    ...(readiness?.warningReasons ?? []).filter((warning) => String(warning).includes('acceptance') || String(warning).includes('external_write'))
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : source.ready
          ? 'ready'
          : 'waiting_for_acceptance';
  const digest = source.digest ?? stableHash({
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    state,
    acceptanceState: acceptance?.state ?? null,
    operatorActionDigest: operatorActionCard?.digest ?? null,
    blockers,
    warnings
  });
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.acceptance-checkpoint-preview`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    aligned: source.aligned === true || !writeRequired,
    restartSafe: source.restartSafe === true || !writeRequired,
    digest,
    sourceDigest: source.digest ?? null,
    commandId: source.commandId ?? operatorActionCard?.commandId ?? null,
    checkpointCount: source.checkpoints?.length ?? source.checkpointCount ?? 0,
    statusChannel: source.statusChannel ?? ir?.handoff?.statusChannel ?? null,
    idempotencyKey: source.idempotencyKey ?? ir?.handoff?.idempotencyKey ?? null,
    nextAction: blockers.length
      ? actionForDiagnostic(blockers[0])
      : warnings.length
        ? actionForDiagnostic(warnings[0])
        : source.nextAction ?? acceptance?.nextAction ?? 'publish_acceptance_checkpoint_bundle',
    blockerCount: blockers.length,
    warningCount: warnings.length,
    blockers,
    warnings
  };
}

function buildKernelNextActionState({
  ir,
  health,
  analytics,
  semantic,
  readiness,
  acceptance,
  nextSteps,
  operatorActionCard,
  routeExport
}) {
  const lifecycle = ir?.lifecycle ?? {};
  const statusRecovery = buildKernelStatusRecoveryReport(ir);
  const primaryStep = nextSteps.find((step) => step.severity === 'error')
    ?? nextSteps.find((step) => step.severity === 'warning')
    ?? nextSteps[0]
    ?? null;
  const lifecycleDecision = lifecycle.operatorDecision ?? {};
  const externalNextAction = semantic?.externalWriteNextAction ?? ir?.semantic?.externalWrite?.nextAction ?? null;
  const recoveryNextAction = semantic?.recoveryNextAction ?? ir?.semantic?.recovery?.nextAction ?? null;
  const blockers = uniqueSorted([
    ...(readiness?.blockingReasons ?? []),
    ...(operatorActionCard?.blockers ?? []).map((blocker) => `operator_${blocker}`),
    ...(routeExport?.blockers ?? []).map((blocker) => `route_${blocker}`),
    ...(statusRecovery.state === 'blocked' ? (statusRecovery.blockers ?? ['status_recovery_blocked']) : []),
    ...(lifecycleDecision.state === 'blocked' ? (lifecycleDecision.blockers ?? ['lifecycle_operator_decision_blocked']) : [])
  ]);
  const warnings = uniqueSorted([
    ...(readiness?.warningReasons ?? []),
    ...(operatorActionCard?.warnings ?? []).map((warning) => `operator_${warning}`),
    ...(routeExport?.warnings ?? []).map((warning) => `route_${warning}`),
    ...(statusRecovery.state === 'held' ? ['status_recovery_held'] : []),
    ...(statusRecovery.state === 'scheduled' ? ['status_recovery_scheduled'] : []),
    ...(lifecycleDecision.requiresAcknowledgement ? ['lifecycle_decision_requires_acknowledgement'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : statusRecovery.state === 'held' || lifecycle.state === 'held'
      ? 'held'
      : statusRecovery.state === 'scheduled' || lifecycle.state === 'scheduled'
        ? 'scheduled'
        : acceptance?.enabled
          ? warnings.length
            ? 'review'
            : 'ready'
          : 'waiting_for_acceptance';
  const primaryAction = blockers.length
    ? actionForDiagnostic(blockers[0])
    : state === 'held'
      ? 'await_manual_release'
      : state === 'scheduled'
        ? 'wait_for_schedule_window'
        : primaryStep?.action
          ?? externalNextAction
          ?? recoveryNextAction
          ?? acceptance?.nextAction
          ?? 'operator_review';
  const seed = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    idempotencyKey: ir?.handoff?.idempotencyKey ?? null,
    state,
    primaryAction,
    statusRecoveryDigest: statusRecovery.digest ?? null,
    routeDigest: routeExport?.digest ?? null,
    operatorActionDigest: operatorActionCard?.digest ?? null,
    lifecycleDecisionDigest: lifecycleDecision.digest ?? null
  };
  const commands = [{
    id: stableHash({ type: 'kernel-next-action-command', seed, action: 'persist-next-action' }),
    type: 'persist-kernel-next-action-state',
    idempotencyKey: stableHash({ type: 'kernel-next-action-idempotency', seed, action: 'persist-next-action' }),
    statusAfterReplay: state,
    writes: ['nextActionState', 'visibleStatus', 'primaryAction'],
    conflict: 'return-existing',
    target: ir?.handoff?.target ?? 'mailchimp.client.workflow'
  }];
  if (state === 'ready') {
    commands.push({
      id: stableHash({ type: 'kernel-next-action-command', seed, action: 'publish-ready' }),
      type: 'publish-kernel-next-action-ready',
      idempotencyKey: stableHash({ type: 'kernel-next-action-idempotency', seed, action: 'publish-ready' }),
      statusAfterReplay: 'ready_for_operator_acceptance',
      writes: ['acceptanceState', 'routeExportDigest', 'statusRecoveryDigest'],
      conflict: 'return-existing',
      target: routeExport?.statusChannel ?? ir?.handoff?.statusChannel ?? null
    });
  }
  if (lifecycleDecision.requiresAcknowledgement) {
    commands.push({
      id: stableHash({ type: 'kernel-next-action-command', seed, action: 'collect-lifecycle-ack' }),
      type: 'collect-next-action-lifecycle-acknowledgement',
      idempotencyKey: stableHash({
        type: 'kernel-next-action-idempotency',
        seed,
        action: 'collect-lifecycle-ack',
        token: lifecycleDecision.acknowledgement?.token ?? null
      }),
      statusAfterReplay: 'awaiting_lifecycle_acknowledgement',
      writes: ['lifecycleAcknowledgementToken', 'nextActionState'],
      conflict: 'return-existing',
      target: ir?.handoff?.target ?? 'mailchimp.client.workflow'
    });
  }
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.next-action-state`,
    state,
    ready: ['ready', 'review', 'held', 'scheduled', 'waiting_for_acceptance'].includes(state) && blockers.length === 0,
    primaryAction,
    source: primaryStep
      ? {
          code: primaryStep.code ?? null,
          severity: primaryStep.severity ?? null,
          reason: primaryStep.reason ?? null
        }
      : {
          code: externalNextAction ?? recoveryNextAction ?? acceptance?.nextAction ?? null,
          severity: warnings.length ? 'warning' : 'info',
          reason: 'derived_from_runtime_contract'
        },
    userVisibleStatus: kernelNextActionVisibleStatus(state),
    acceptance: {
      state: acceptance?.state ?? 'unknown',
      enabled: acceptance?.enabled === true,
      nextAction: acceptance?.nextAction ?? null,
      missingAcknowledgements: acceptance?.missingAcknowledgements ?? []
    },
    routeExport: {
      state: routeExport?.state ?? 'unknown',
      ready: routeExport?.ready === true,
      digest: routeExport?.digest ?? null,
      publishCommandId: routeExport?.publishCommandId ?? null,
      changedSinceAcceptedSnapshot: routeExport?.changedSinceAcceptedSnapshot ?? false
    },
    lifecycle: {
      state: lifecycle.state ?? 'unknown',
      enabled: lifecycle.enabled !== false,
      selectedCommand: lifecycleDecision.selectedCommand?.action ?? lifecycleDecision.selectedCommand ?? null,
      requiresAcknowledgement: lifecycleDecision.requiresAcknowledgement === true,
      acknowledgementToken: lifecycleDecision.acknowledgement?.token ?? null,
      digest: lifecycleDecision.digest ?? null
    },
    statusRecovery: {
      state: statusRecovery.state ?? 'unknown',
      ready: statusRecovery.ready === true,
      digest: statusRecovery.digest ?? null,
      nextAction: statusRecovery.nextAction ?? null
    },
    health: {
      status: health?.status ?? 'unknown',
      actionableErrorCount: analytics?.counters?.actionableErrorCount ?? 0,
      semanticErrorCount: analytics?.counters?.semanticErrorCount ?? 0
    },
    commands,
    blockers,
    warnings,
    digest: stableHash({ ...seed, commandIds: commands.map((command) => command.id), blockers, warnings })
  };
}

function validateKernelNextActionState(nextActionState, ir) {
  if (!nextActionState) return [{ level: 'error', code: 'missing_kernel_next_action_state' }];
  const diagnostics = [];
  if (!nextActionState.digest || !nextActionState.schemaVersion) {
    diagnostics.push({ level: 'error', code: 'kernel_next_action_state_identity_missing' });
  }
  if (nextActionState.ready && nextActionState.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'kernel_next_action_ready_with_blockers', blockers: nextActionState.blockers });
  }
  if (!nextActionState.primaryAction) {
    diagnostics.push({ level: 'error', code: 'kernel_next_action_missing_primary_action' });
  }
  if (!nextActionState.commands?.length) {
    diagnostics.push({ level: 'error', code: 'kernel_next_action_missing_commands' });
  }
  if (nextActionState.state === 'ready' && nextActionState.acceptance?.enabled !== true) {
    diagnostics.push({ level: 'error', code: 'kernel_next_action_ready_without_acceptance' });
  }
  if (nextActionState.lifecycle?.requiresAcknowledgement && !nextActionState.lifecycle?.acknowledgementToken) {
    diagnostics.push({ level: 'warning', code: 'kernel_next_action_lifecycle_acknowledgement_token_missing' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && nextActionState.routeExport?.ready && !nextActionState.routeExport?.digest) {
    diagnostics.push({ level: 'error', code: 'kernel_next_action_route_export_digest_missing' });
  }
  return diagnostics;
}

function buildKernelOperatorLifecycleAction({
  ir,
  readiness,
  acceptance,
  nextActionState,
  routeExport
}) {
  const lifecycle = ir?.lifecycle ?? {};
  const operatorDecision = lifecycle.operatorDecision ?? {};
  const commandQueue = lifecycle.commandQueue ?? {};
  const selectedCommand = operatorDecision.selectedCommand
    ?? commandQueue.commands?.find((command) => command.id === commandQueue.selectedCommandId)
    ?? commandQueue.pending?.[0]
    ?? commandQueue.applied?.at?.(-1)
    ?? null;
  const action = selectedCommand?.action
    ?? (lifecycle.enabled === false ? 'disable' : lifecycle.schedule?.status === 'scheduled' ? 'schedule' : 'enable');
  const requiresAcknowledgement = operatorDecision.requiresAcknowledgement === true
    || commandQueue.requiredAcknowledgements?.missing?.length > 0
    || ['disable', 'pause', 'hold', 'schedule', 'reschedule'].includes(action);
  const acknowledgementToken = operatorDecision.acknowledgement?.token
    ?? selectedCommand?.acknowledgementToken
    ?? (requiresAcknowledgement
      ? stableHash({
          type: 'kernel-operator-lifecycle-action-ack',
          programId: ir?.programId ?? null,
          operation: ir?.operation ?? null,
          action,
          selectedCommandId: selectedCommand?.id ?? null,
          lifecycleState: lifecycle.state ?? null
        })
      : null);
  const blockers = uniqueSorted([
    ...(readiness?.state === 'blocked' ? ['preview_readiness_blocked'] : []),
    ...(operatorDecision.state === 'blocked' ? (operatorDecision.blockers ?? ['lifecycle_operator_decision_blocked']) : []),
    ...(commandQueue.state === 'blocked' ? (commandQueue.blockers ?? ['lifecycle_command_queue_blocked']) : []),
    ...(nextActionState?.state === 'blocked' ? (nextActionState.blockers ?? ['kernel_next_action_blocked']) : []),
    ...(requiresAcknowledgement && !acknowledgementToken ? ['lifecycle_action_missing_acknowledgement_token'] : []),
    ...(routeExport?.state === 'blocked' ? (routeExport.blockers ?? ['route_export_blocked']).map((blocker) => `route_${blocker}`) : [])
  ]);
  const warnings = uniqueSorted([
    ...(operatorDecision.requiresAcknowledgement ? ['lifecycle_action_requires_acknowledgement'] : []),
    ...(commandQueue.state === 'awaiting_acknowledgement' ? ['lifecycle_command_queue_awaiting_acknowledgement'] : []),
    ...(lifecycle.state === 'degraded' ? ['lifecycle_degraded'] : []),
    ...(lifecycle.schedule?.status === 'scheduled' ? ['lifecycle_scheduled'] : []),
    ...(nextActionState?.state === 'review' ? (nextActionState.warnings ?? ['kernel_next_action_review']) : []),
    ...(routeExport?.warnings ?? []).map((warning) => `route_${warning}`)
  ]);
  const state = blockers.length
    ? 'blocked'
    : lifecycle.state === 'held' || action === 'hold' || action === 'pause'
      ? 'held'
      : lifecycle.schedule?.status === 'scheduled' || ['schedule', 'reschedule'].includes(action)
        ? 'scheduled'
        : requiresAcknowledgement && !acceptance?.enabled
          ? 'awaiting_acceptance'
          : warnings.length
            ? 'review'
            : 'ready';
  const actionId = stableHash({
    type: 'kernel-operator-lifecycle-action',
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    action,
    selectedCommandId: selectedCommand?.id ?? null,
    lifecycleState: lifecycle.state ?? null,
    nextActionDigest: nextActionState?.digest ?? null,
    routeDigest: routeExport?.digest ?? null
  });
  const commandSeed = {
    actionId,
    state,
    action,
    acknowledgementToken,
    idempotencyKey: ir?.handoff?.idempotencyKey ?? null,
    statusChannel: ir?.handoff?.statusChannel ?? null
  };
  const commands = [{
    id: `kernel-lifecycle-action:${actionId}`,
    type: 'persist-operator-lifecycle-action',
    action,
    idempotencyKey: stableHash({ type: 'operator-lifecycle-action-idempotency', commandSeed }),
    target: ir?.handoff?.target ?? 'mailchimp.client.workflow',
    statusChannel: ir?.handoff?.statusChannel ?? null,
    statusAfterReplay: state === 'ready'
      ? 'operator_lifecycle_action_ready'
      : state === 'review'
        ? 'operator_lifecycle_action_review'
        : state,
    writes: ['operatorLifecycleAction', 'lifecycleCommandQueue', 'nextActionState'],
    conflict: 'return-existing'
  }];
  if (requiresAcknowledgement) {
    commands.push({
      id: `kernel-lifecycle-action-ack:${stableHash({ actionId, acknowledgementToken })}`,
      type: 'collect-operator-lifecycle-acknowledgement',
      action,
      acknowledgementToken,
      idempotencyKey: stableHash({ type: 'operator-lifecycle-ack-idempotency', actionId, acknowledgementToken }),
      target: ir?.handoff?.target ?? 'mailchimp.client.workflow',
      statusChannel: ir?.handoff?.statusChannel ?? null,
      statusAfterReplay: 'operator_lifecycle_acknowledgement_collected',
      writes: ['lifecycleAcknowledgementToken', 'operatorLifecycleAction'],
      conflict: 'return-existing'
    });
  }
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.operator-lifecycle-action`,
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    state,
    ready: ['ready', 'review', 'held', 'scheduled', 'awaiting_acceptance'].includes(state) && blockers.length === 0,
    action,
    selectedCommandId: selectedCommand?.id ?? null,
    selectedCommandSource: selectedCommand?.source ?? null,
    requestedState: selectedCommand?.requestedState ?? lifecycle.state ?? null,
    requiresAcknowledgement,
    acknowledgementToken,
    acknowledgementReason: operatorDecision.acknowledgement?.reason ?? selectedCommand?.reason ?? null,
    userVisibleStatus: operatorLifecycleActionStatus(state),
    schedule: {
      status: lifecycle.schedule?.status ?? null,
      mode: lifecycle.schedule?.mode ?? null,
      notBefore: lifecycle.schedule?.notBefore ?? null,
      notAfter: lifecycle.schedule?.notAfter ?? null,
      timezone: lifecycle.schedule?.timezone ?? null
    },
    settingsDigest: stableHash(lifecycle.settings ?? {}),
    routeExportDigest: routeExport?.digest ?? null,
    nextActionDigest: nextActionState?.digest ?? null,
    commands,
    blockers,
    warnings,
    nextAction: blockers.length
      ? actionForDiagnostic(blockers[0])
      : requiresAcknowledgement && state === 'awaiting_acceptance'
        ? 'collect_operator_lifecycle_acknowledgement'
        : state === 'held'
          ? 'await_manual_release'
          : state === 'scheduled'
            ? 'wait_for_schedule_window'
            : warnings.length
              ? 'review_operator_lifecycle_action'
              : 'persist_operator_lifecycle_action',
    digest: stableHash({ ...commandSeed, commands: commands.map((command) => command.id), blockers, warnings })
  };
}

function summarizeKernelOperatorLifecycleAction(action = {}) {
  return {
    state: action?.state ?? 'unknown',
    ready: action?.ready ?? false,
    action: action?.action ?? null,
    selectedCommandId: action?.selectedCommandId ?? null,
    requestedState: action?.requestedState ?? null,
    requiresAcknowledgement: action?.requiresAcknowledgement ?? false,
    acknowledgementToken: action?.acknowledgementToken ?? null,
    scheduleStatus: action?.schedule?.status ?? null,
    nextAction: action?.nextAction ?? null,
    commandCount: action?.commands?.length ?? 0,
    blockerCount: action?.blockers?.length ?? 0,
    warningCount: action?.warnings?.length ?? 0,
    digest: action?.digest ?? null
  };
}

function validateKernelOperatorLifecycleAction(action, ir) {
  if (!action) return [{ level: 'error', code: 'missing_kernel_operator_lifecycle_action' }];
  const diagnostics = [];
  if (!action.schemaVersion || !action.digest) {
    diagnostics.push({ level: 'error', code: 'kernel_operator_lifecycle_action_identity_missing' });
  }
  if (action.ready && action.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'kernel_operator_lifecycle_action_ready_with_blockers',
      blockers: action.blockers
    });
  }
  if (!action.action) {
    diagnostics.push({ level: 'error', code: 'kernel_operator_lifecycle_action_missing_action' });
  }
  if (!action.commands?.length) {
    diagnostics.push({ level: 'error', code: 'kernel_operator_lifecycle_action_missing_commands' });
  }
  if (action.requiresAcknowledgement && !action.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'kernel_operator_lifecycle_action_missing_acknowledgement_token' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && action.ready && !action.nextActionDigest) {
    diagnostics.push({ level: 'warning', code: 'kernel_operator_lifecycle_action_missing_next_action_digest' });
  }
  if (action.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'kernel_operator_lifecycle_action_blocked',
      blockers: action.blockers ?? []
    });
  }
  return diagnostics;
}

function operatorLifecycleActionStatus(state) {
  return {
    blocked: 'operator_lifecycle_action_needs_attention',
    held: 'operator_lifecycle_waiting_for_manual_release',
    scheduled: 'operator_lifecycle_waiting_for_schedule',
    awaiting_acceptance: 'operator_lifecycle_waiting_for_acknowledgement',
    review: 'operator_lifecycle_action_ready_for_review',
    ready: 'operator_lifecycle_action_ready'
  }[state] ?? 'operator_lifecycle_action_unknown';
}

function summarizeKernelNextActionState(nextActionState = {}) {
  return {
    state: nextActionState?.state ?? 'unknown',
    ready: nextActionState?.ready ?? false,
    primaryAction: nextActionState?.primaryAction ?? null,
    userVisibleStatus: nextActionState?.userVisibleStatus ?? null,
    routeExportState: nextActionState?.routeExport?.state ?? 'unknown',
    routeExportReady: nextActionState?.routeExport?.ready ?? false,
    lifecycleState: nextActionState?.lifecycle?.state ?? 'unknown',
    lifecycleSelectedCommand: nextActionState?.lifecycle?.selectedCommand ?? null,
    requiresAcknowledgement: nextActionState?.lifecycle?.requiresAcknowledgement ?? false,
    commandCount: nextActionState?.commands?.length ?? 0,
    blockerCount: nextActionState?.blockers?.length ?? 0,
    warningCount: nextActionState?.warnings?.length ?? 0,
    digest: nextActionState?.digest ?? null
  };
}

function kernelNextActionVisibleStatus(state) {
  return {
    blocked: 'mailchimp_next_action_needs_attention',
    held: 'mailchimp_next_action_waiting_for_manual_release',
    scheduled: 'mailchimp_next_action_waiting_for_schedule',
    review: 'mailchimp_next_action_ready_for_review',
    ready: 'mailchimp_next_action_ready',
    waiting_for_acceptance: 'mailchimp_next_action_waiting_for_acceptance'
  }[state] ?? 'mailchimp_next_action_unknown';
}

export function buildExportReadySummary(reportOrIR) {
  const ir = reportOrIR?.kind === 'KernelCallIR' ? reportOrIR : null;
  const report = ir ? exportKernelCallIRReport(ir) : reportOrIR;
  const preview = report?.preview ?? (ir ? buildKernelCallUIPreview(ir) : {});
  const analytics = report?.analytics ?? (ir ? deriveKernelCallAnalytics(ir) : {});
  const history = report?.history ?? (ir ? createKernelCallHistorySnapshot(ir) : {});
  return buildExportSummary({
    ir,
    analytics,
    history,
    preview,
    summary: report?.summary,
    audit: report?.audit
  });
}

function normalizeVerifierClaims(requiredClaims, claims) {
  return [...new Set(requiredClaims)]
    .sort()
    .map((name) => ({
      name,
      status: Object.prototype.hasOwnProperty.call(claims, name) ? 'present' : 'missing',
      valueHash: Object.prototype.hasOwnProperty.call(claims, name) ? stableHash(claims[name]) : null
    }));
}

function normalizeTruthBoundaries(boundaries, claims) {
  return [...new Set(boundaries)]
    .sort()
    .map((name) => ({
      name,
      status: Object.prototype.hasOwnProperty.call(claims, name) ? 'observed' : 'declared',
      authority: name.startsWith('mailchimp') ? 'mailchimp_remote' : 'aios_local'
    }));
}

function normalizeLifecycleControls(input = {}) {
  const enabled = input.enabled !== false;
  const schedule = normalizeLifecycleSchedule(input.schedule);
  const settings = normalizeLifecycleSettings(input.settings);
  const commands = asArray(input.commands).map((command, index) => normalizeLifecycleCommand(command, index));
  const confirmations = asArray(input.confirmations).map((confirmation, index) => normalizeLifecycleConfirmation(confirmation, index));
  const commandValidation = commands.flatMap(validateLifecycleCommand);
  const permissionBoundary = input.permissionBoundary ? stableClone(input.permissionBoundary) : null;
  const boundaryDenied = permissionBoundary?.permissions?.deniedEffects?.length ?? 0;
  const healthStatus = input.health?.status ?? 'unknown';
  const state = !enabled
    ? 'disabled'
    : boundaryDenied
      ? 'blocked'
      : healthStatus === 'blocked'
        ? 'blocked'
        : healthStatus === 'degraded'
          ? 'degraded'
          : schedule.status === 'scheduled'
            ? 'scheduled'
            : 'enabled';
  const validation = [
    ...validateLifecycleSettings(settings),
    ...validateLifecycleSchedule(schedule),
    ...commandValidation,
    ...(boundaryDenied
      ? [{ level: 'error', code: 'lifecycle_permission_boundary_blocked', deniedEffectCount: boundaryDenied }]
      : [])
  ];
  if (!enabled) {
    validation.push({ level: 'error', code: 'lifecycle_disabled' });
  }
  const operatorDecision = buildLifecycleOperatorDecision({
    operation: input.operation ?? 'unknown',
    enabled,
    state,
    settings,
    schedule,
    commands,
    confirmations,
    validation,
    nextAction: input.nextAction
  });
  const confirmationValidation = validateLifecycleConfirmationState(operatorDecision.confirmationState);
  const commandQueue = buildLifecycleCommandQueue({
    operation: input.operation ?? 'unknown',
    enabled,
    state,
    settings,
    schedule,
    commands,
    operatorDecision,
    validation,
    permissionBoundary
  });
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.lifecycle`,
    enabled,
    state,
    operation: input.operation ?? 'unknown',
    settings,
    schedule,
    commands,
    confirmations,
    commandQueue,
    operatorDecision,
    confirmationState: operatorDecision.confirmationState,
    permissionBoundary,
    healthStatus,
    nextAction: input.nextAction ?? commandQueue.nextAction ?? operatorDecision.nextAction ?? nextLifecycleAction({ enabled, state, schedule, validation }),
    exportable: enabled && state !== 'blocked' && validation.every((diagnostic) => diagnostic.level !== 'error'),
    validation: [
      ...validation,
      ...confirmationValidation
    ]
  };
}

function normalizeSemanticReports(reports = {}) {
  return {
    externalWrite: reports.externalWrite ? stableClone(reports.externalWrite) : null,
    recovery: reports.recovery ? stableClone(reports.recovery) : null
  };
}

function summarizeSemanticReports(reports = {}) {
  return {
    externalWriteStatus: reports?.externalWrite?.status ?? 'not_analyzed',
    externalWriteRequired: reports?.externalWrite?.writeRequired ?? false,
    externalWriteNextAction: reports?.externalWrite?.nextAction ?? null,
    acceptanceCheckpointBundle: {
      state: reports?.externalWrite?.acceptanceCheckpointBundle?.state ?? 'not_analyzed',
      ready: reports?.externalWrite?.acceptanceCheckpointBundle?.ready ?? false,
      aligned: reports?.externalWrite?.acceptanceCheckpointBundle?.aligned ?? false,
      restartSafe: reports?.externalWrite?.acceptanceCheckpointBundle?.restartSafe ?? false,
      digest: reports?.externalWrite?.acceptanceCheckpointBundle?.digest ?? null,
      commandId: reports?.externalWrite?.acceptanceCheckpointBundle?.commandId ?? null,
      checkpointCount: reports?.externalWrite?.acceptanceCheckpointBundle?.checkpoints?.length ?? 0,
      nextAction: reports?.externalWrite?.acceptanceCheckpointBundle?.nextAction ?? null,
      blockerCount: reports?.externalWrite?.acceptanceCheckpointBundle?.blockers?.length ?? 0,
      warningCount: reports?.externalWrite?.acceptanceCheckpointBundle?.warnings?.length ?? 0
    },
    boundaryPermissionPosture: {
      state: reports?.externalWrite?.boundaryPermissionPosture?.state ?? 'not_analyzed',
      ready: reports?.externalWrite?.boundaryPermissionPosture?.ready ?? false,
      permissionMode: reports?.externalWrite?.boundaryPermissionPosture?.permissionMode ?? 'unknown',
      role: reports?.externalWrite?.boundaryPermissionPosture?.role ?? null,
      postureDigest: reports?.externalWrite?.boundaryPermissionPosture?.postureDigest ?? null,
      nextAction: reports?.externalWrite?.boundaryPermissionPosture?.nextAction ?? null,
      blockerCount: reports?.externalWrite?.boundaryPermissionPosture?.blockers?.length ?? 0,
      warningCount: reports?.externalWrite?.boundaryPermissionPosture?.warnings?.length ?? 0,
      missingAcknowledgementCount: reports?.externalWrite?.boundaryPermissionPosture?.missingAcknowledgements?.length ?? 0
    },
    boundaryDecisionReceipt: {
      state: reports?.externalWrite?.boundaryDecisionReceipt?.state ?? 'not_analyzed',
      ready: reports?.externalWrite?.boundaryDecisionReceipt?.ready ?? false,
      decision: reports?.externalWrite?.boundaryDecisionReceipt?.decision ?? 'unknown',
      releaseAllowed: reports?.externalWrite?.boundaryDecisionReceipt?.release?.allowed ?? false,
      receiptDigest: reports?.externalWrite?.boundaryDecisionReceipt?.receiptDigest ?? null,
      commandId: reports?.externalWrite?.boundaryDecisionReceipt?.command?.commandId ?? null,
      nextAction: reports?.externalWrite?.boundaryDecisionReceipt?.nextAction ?? null,
      blockerCount: reports?.externalWrite?.boundaryDecisionReceipt?.blockers?.length ?? 0,
      warningCount: reports?.externalWrite?.boundaryDecisionReceipt?.warnings?.length ?? 0,
      evidenceCount: reports?.externalWrite?.boundaryDecisionReceipt?.evidence?.length ?? 0
    },
    recoveryStatus: reports?.recovery?.status ?? 'not_analyzed',
    recoveryNextAction: reports?.recovery?.nextAction ?? null,
    statusHandoff: {
      externalState: reports?.externalWrite?.statusHandoff?.state ?? 'not_analyzed',
      externalReady: reports?.externalWrite?.statusHandoff?.ready ?? false,
      externalDigest: reports?.externalWrite?.statusHandoff?.digest ?? null,
      externalNextAction: reports?.externalWrite?.statusHandoff?.nextAction ?? null,
      recoveryState: reports?.recovery?.statusHandoff?.state ?? 'not_analyzed',
      recoveryReady: reports?.recovery?.statusHandoff?.ready ?? false,
      recoveryDigest: reports?.recovery?.statusHandoff?.digest ?? null,
      recoveryExternalDigest: reports?.recovery?.statusHandoff?.externalDigest ?? null,
      recoveryNextAction: reports?.recovery?.statusHandoff?.nextAction ?? null
    },
    routeExport: {
      state: reports?.externalWrite?.routeExportState?.state ?? 'not_analyzed',
      ready: reports?.externalWrite?.routeExportState?.ready ?? false,
      digest: reports?.externalWrite?.routeExportState?.digest ?? null,
      analyticsPublicationDigest: reports?.externalWrite?.routeExportState?.analyticsPublication?.digest ?? reports?.externalWrite?.analyticsPublication?.digest ?? null,
      statusChannel: reports?.externalWrite?.routeExportState?.statusChannel ?? null,
      publishCommandId: reports?.externalWrite?.routeExportState?.publishCommand?.commandId ?? null,
      publishReady: reports?.externalWrite?.routeExportState?.publishCommand?.ready ?? false,
      changedSinceAcceptedSnapshot: reports?.externalWrite?.routeExportState?.changedSinceAcceptedSnapshot ?? false,
      snapshotCount: reports?.externalWrite?.routeExportState?.snapshots?.length ?? 0,
      timelineEventCount: reports?.externalWrite?.routeExportState?.timeline?.length ?? 0,
      nextAction: reports?.externalWrite?.routeExportState?.nextAction ?? null,
      blockerCount: reports?.externalWrite?.routeExportState?.blockers?.length ?? 0,
      warningCount: reports?.externalWrite?.routeExportState?.warnings?.length ?? 0
    },
    analyticsPublication: {
      state: reports?.externalWrite?.analyticsPublication?.state ?? 'not_analyzed',
      ready: reports?.externalWrite?.analyticsPublication?.ready ?? false,
      digest: reports?.externalWrite?.analyticsPublication?.digest ?? null,
      analyticsDigest: reports?.externalWrite?.analyticsPublication?.analyticsDigest ?? null,
      publishCommandId: reports?.externalWrite?.analyticsPublication?.publishCommand?.commandId ?? null,
      publishReady: reports?.externalWrite?.analyticsPublication?.publishCommand?.ready ?? false,
      statusChannel: reports?.externalWrite?.analyticsPublication?.statusChannel ?? null,
      targetCount: reports?.externalWrite?.analyticsPublication?.targets?.length ?? 0,
      publisherCount: reports?.externalWrite?.analyticsPublication?.publishers?.length ?? 0,
      missingAcknowledgementCount: reports?.externalWrite?.analyticsPublication?.acknowledgements?.missing?.length ?? 0,
      freshnessWarningCount: reports?.externalWrite?.analyticsPublication?.freshness?.warnings?.length ?? 0,
      changedSinceKernelSnapshot: reports?.externalWrite?.analyticsPublication?.freshness?.changedSinceKernelSnapshot ?? false,
      nextAction: reports?.externalWrite?.analyticsPublication?.nextAction ?? null,
      blockerCount: reports?.externalWrite?.analyticsPublication?.blockers?.length ?? 0,
      warningCount: reports?.externalWrite?.analyticsPublication?.warnings?.length ?? 0
    },
    recoveryRunbook: {
      externalState: reports?.externalWrite?.recoveryRunbook?.state ?? 'not_analyzed',
      externalReady: reports?.externalWrite?.recoveryRunbook?.ready ?? false,
      externalMode: reports?.externalWrite?.recoveryRunbook?.mode ?? null,
      externalDigest: reports?.externalWrite?.recoveryRunbook?.digest ?? null,
      externalPrimaryCommandId: reports?.externalWrite?.recoveryRunbook?.primaryCommandId ?? null,
      externalRetryAfterMs: reports?.externalWrite?.recoveryRunbook?.retryAfterMs ?? null,
      externalStepCount: reports?.externalWrite?.recoveryRunbook?.steps?.length ?? 0,
      recoveryState: reports?.recovery?.analyticsSummary?.recoveryRunbook?.state ?? 'not_analyzed',
      recoveryReady: reports?.recovery?.analyticsSummary?.recoveryRunbook?.ready ?? false,
      recoveryDigest: reports?.recovery?.analyticsSummary?.recoveryRunbook?.digest ?? null,
      recoveryNextAction: reports?.recovery?.analyticsSummary?.recoveryRunbook?.nextAction ?? null,
      blockerCount: uniqueSorted([
        ...(reports?.externalWrite?.recoveryRunbook?.blockers ?? []),
        ...(reports?.recovery?.externalWrite?.recoveryRunbook?.blockers ?? [])
      ]).length,
      warningCount: uniqueSorted([
        ...(reports?.externalWrite?.recoveryRunbook?.warnings ?? []),
        ...(reports?.recovery?.externalWrite?.recoveryRunbook?.warnings ?? [])
      ]).length
    },
    blockedReasons: uniqueSorted([
      ...(reports?.externalWrite?.blockedReasons ?? []),
      ...(reports?.externalWrite?.statusHandoff?.blockers ?? []),
      ...(reports?.externalWrite?.routeExportState?.blockers ?? []),
      ...(reports?.externalWrite?.analyticsPublication?.blockers ?? []),
      ...(reports?.externalWrite?.recoveryRunbook?.blockers ?? []),
      ...(reports?.externalWrite?.boundaryPermissionPosture?.blockers ?? []),
      ...(reports?.externalWrite?.boundaryDecisionReceipt?.blockers ?? []),
      ...(reports?.recovery?.blockedReasons ?? []),
      ...(reports?.recovery?.statusHandoff?.blockers ?? [])
    ])
  };
}

function validateSemanticReports(reports = {}) {
  const diagnostics = [];
  if (reports?.externalWrite?.status === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_external_write_blocked',
      blockedReasons: reports.externalWrite.blockedReasons ?? []
    });
  }
  if (reports?.recovery?.status === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_recovery_blocked',
      blockedReasons: reports.recovery.blockedReasons ?? []
    });
  }
  if (reports?.externalWrite?.writeRequired && reports?.externalWrite?.statusHandoff?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_external_status_handoff_blocked',
      blockedReasons: reports.externalWrite.statusHandoff.blockers ?? []
    });
  }
  if (reports?.externalWrite?.writeRequired && reports?.externalWrite?.routeExportState?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_external_route_export_blocked',
      blockedReasons: reports.externalWrite.routeExportState.blockers ?? []
    });
  }
  if (reports?.externalWrite?.writeRequired && !reports?.externalWrite?.routeExportState?.publishCommand?.commandId) {
    diagnostics.push({ level: 'error', code: 'semantic_external_route_export_missing_publish_command' });
  }
  if (reports?.externalWrite?.writeRequired && !reports?.externalWrite?.analyticsPublication?.publishCommand?.commandId) {
    diagnostics.push({ level: 'error', code: 'semantic_external_analytics_publication_missing_publish_command' });
  }
  if (reports?.externalWrite?.writeRequired && reports?.externalWrite?.analyticsPublication?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_external_analytics_publication_blocked',
      blockedReasons: reports.externalWrite.analyticsPublication.blockers ?? []
    });
  }
  if (reports?.externalWrite?.writeRequired && !reports?.externalWrite?.recoveryRunbook?.digest) {
    diagnostics.push({ level: 'error', code: 'semantic_external_recovery_runbook_missing_digest' });
  }
  if (reports?.externalWrite?.writeRequired && reports?.externalWrite?.recoveryRunbook?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_external_recovery_runbook_blocked',
      blockedReasons: reports.externalWrite.recoveryRunbook.blockers ?? []
    });
  }
  if (reports?.recovery?.externalWrite?.writeRequired && reports?.recovery?.analyticsSummary?.recoveryRunbook?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_recovery_runbook_blocked',
      blockedReasons: reports.recovery.externalWrite.recoveryRunbook?.blockers ?? []
    });
  }
  if (reports?.externalWrite?.routeExportState?.changedSinceAcceptedSnapshot) {
    diagnostics.push({
      level: 'warning',
      code: 'semantic_external_route_export_changed_since_acceptance',
      digest: reports.externalWrite.routeExportState.digest ?? null
    });
  }
  if (reports?.externalWrite?.writeRequired && reports?.recovery?.statusHandoff?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_recovery_status_handoff_blocked',
      blockedReasons: reports.recovery.statusHandoff.blockers ?? []
    });
  }
  if (reports?.externalWrite?.writeRequired && reports?.recovery?.statusHandoff?.externalDigest
    && reports?.externalWrite?.statusHandoff?.digest
    && reports.recovery.statusHandoff.externalDigest !== reports.externalWrite.statusHandoff.digest) {
    diagnostics.push({
      level: 'error',
      code: 'semantic_status_handoff_digest_mismatch',
      externalDigest: reports.externalWrite.statusHandoff.digest,
      recoveryExternalDigest: reports.recovery.statusHandoff.externalDigest
    });
  }
  if (reports?.externalWrite?.writeRequired && reports?.externalWrite?.boundaryPermissionPosture?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_boundary_permission_posture_blocked',
      blockedReasons: reports.externalWrite.boundaryPermissionPosture.blockers ?? []
    });
  }
  if (reports?.externalWrite?.writeRequired && reports?.externalWrite?.boundaryPermissionPosture?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'semantic_boundary_permission_posture_requires_review',
      missingAcknowledgements: reports.externalWrite.boundaryPermissionPosture.missingAcknowledgements ?? []
    });
  }
  if (reports?.externalWrite?.writeRequired && reports?.externalWrite?.boundaryDecisionReceipt?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'semantic_boundary_decision_receipt_blocked',
      blockedReasons: reports.externalWrite.boundaryDecisionReceipt.blockers ?? []
    });
  }
  if (reports?.externalWrite?.writeRequired && reports?.externalWrite?.boundaryDecisionReceipt?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'semantic_boundary_decision_receipt_requires_review',
      warnings: reports.externalWrite.boundaryDecisionReceipt.warnings ?? []
    });
  }
  return diagnostics;
}

function collectSemanticDiagnostics(reports = {}) {
  return validateSemanticReports(reports);
}

function normalizeLifecycleSettings(settings = {}) {
  const concurrencyLimit = Number(settings.concurrencyLimit ?? 1);
  const timeoutMs = Number(settings.timeoutMs ?? 60000);
  const priority = settings.priority ?? 'normal';
  return {
    concurrencyLimit: Number.isFinite(concurrencyLimit) ? Math.max(1, Math.min(10, concurrencyLimit)) : 1,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(900000, timeoutMs)) : 60000,
    priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
    allowDegradedHandoff: settings.allowDegradedHandoff !== false
  };
}

function normalizeLifecycleSchedule(schedule = {}) {
  const mode = schedule.mode ?? (schedule.notBefore || schedule.notAfter ? 'window' : 'immediate');
  const notBefore = schedule.notBefore ?? null;
  const notAfter = schedule.notAfter ?? null;
  return {
    mode: ['immediate', 'window', 'manual'].includes(mode) ? mode : 'immediate',
    status: mode === 'manual' ? 'manual_hold' : mode === 'window' ? 'scheduled' : 'ready',
    notBefore,
    notAfter,
    timezone: schedule.timezone ?? 'UTC'
  };
}

function validateLifecycleControls(lifecycle = {}) {
  if (!lifecycle) return [{ level: 'error', code: 'missing_lifecycle_controls' }];
  const diagnostics = lifecycle.validation ?? [
    ...validateLifecycleSettings(lifecycle.settings ?? {}),
    ...validateLifecycleSchedule(lifecycle.schedule ?? {})
  ];
  if (lifecycle.operatorDecision?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'lifecycle_operator_decision_blocked',
      blockers: lifecycle.operatorDecision.blockers ?? []
    });
  }
  if (lifecycle.operatorDecision?.requiresAcknowledgement && !lifecycle.operatorDecision?.acknowledgement?.token) {
    diagnostics.push({ level: 'error', code: 'lifecycle_operator_decision_missing_acknowledgement_token' });
  }
  diagnostics.push(...validateLifecycleCommandQueue(lifecycle.commandQueue, lifecycle));
  diagnostics.push(...validateLifecycleConfirmationState(lifecycle.confirmationState));
  return diagnostics;
}

function validateLifecycleSettings(settings = {}) {
  const diagnostics = [];
  if (settings.concurrencyLimit < 1 || settings.concurrencyLimit > 10) {
    diagnostics.push({ level: 'error', code: 'lifecycle_invalid_concurrency_limit' });
  }
  if (settings.timeoutMs < 1000 || settings.timeoutMs > 900000) {
    diagnostics.push({ level: 'error', code: 'lifecycle_invalid_timeout' });
  }
  if (!['low', 'normal', 'high'].includes(settings.priority)) {
    diagnostics.push({ level: 'warning', code: 'lifecycle_unknown_priority' });
  }
  return diagnostics;
}

function validateLifecycleSchedule(schedule = {}) {
  const diagnostics = [];
  if (schedule.mode === 'window' && schedule.notBefore && schedule.notAfter && String(schedule.notBefore) > String(schedule.notAfter)) {
    diagnostics.push({ level: 'error', code: 'lifecycle_invalid_schedule_window' });
  }
  if (schedule.mode === 'manual') {
    diagnostics.push({ level: 'warning', code: 'lifecycle_manual_hold' });
  }
  return diagnostics;
}

function normalizeLifecycleCommand(command, index) {
  const action = String(command?.action ?? command?.op ?? 'review').trim().toLowerCase();
  const schedule = command?.schedule && typeof command.schedule === 'object' ? command.schedule : {};
  const settings = command?.settings && typeof command.settings === 'object' ? command.settings : {};
  return {
    id: command?.id ?? `kernel-lifecycle:${stableHash({ index, action, schedule, settings, reason: command?.reason ?? null })}`,
    action,
    source: command?.source ?? 'program',
    reason: command?.reason ?? null,
    enabled: command?.enabled,
    settings: normalizeLifecycleSettings(settings),
    schedule: normalizeLifecycleSchedule(schedule),
    requestedState: lifecycleRequestedState(action)
  };
}

function normalizeLifecycleConfirmation(confirmation, index) {
  const action = confirmation?.action == null ? null : String(confirmation.action).trim().toLowerCase();
  const token = confirmation?.token ?? confirmation?.acknowledgementToken ?? confirmation?.ack ?? null;
  const commandId = confirmation?.commandId ?? confirmation?.lifecycleCommandId ?? null;
  const state = confirmation?.state ?? confirmation?.requestedState ?? null;
  return {
    id: confirmation?.id ?? `kernel-lifecycle-confirmation:${stableHash({ index, token, commandId, action, state })}`,
    token,
    commandId,
    action,
    state,
    actor: confirmation?.actor ?? confirmation?.by ?? 'operator',
    accepted: confirmation?.accepted !== false,
    reason: confirmation?.reason ?? null,
    source: confirmation?.source ?? 'program'
  };
}

function validateLifecycleCommand(command) {
  const diagnostics = [];
  if (!['enable', 'disable', 'pause', 'hold', 'resume', 'schedule', 'reschedule', 'review'].includes(command.action)) {
    diagnostics.push({ level: 'error', code: 'lifecycle_unknown_command', action: command.action });
  }
  if (['schedule', 'reschedule'].includes(command.action) && command.schedule?.mode === 'immediate') {
    diagnostics.push({ level: 'warning', code: 'lifecycle_schedule_command_without_window', commandId: command.id });
  }
  return diagnostics;
}

function buildLifecycleCommandQueue({
  operation,
  enabled,
  state,
  settings,
  schedule,
  commands,
  operatorDecision,
  validation,
  permissionBoundary
}) {
  const deniedEffects = permissionBoundary?.permissions?.deniedEffects ?? [];
  const commandRows = commands.map((command, index) => {
    const commandDiagnostics = validateLifecycleCommand(command);
    const requiresAcknowledgement = ['disable', 'pause', 'hold', 'schedule', 'reschedule'].includes(command.action)
      || operatorDecision.selectedCommand?.id === command.id && operatorDecision.requiresAcknowledgement === true;
    const blocked = commandDiagnostics.some((diagnostic) => diagnostic.level === 'error')
      || state === 'blocked'
      || deniedEffects.length > 0;
    const warnings = uniqueSorted([
      ...commandDiagnostics.filter((diagnostic) => diagnostic.level === 'warning').map((diagnostic) => diagnostic.code),
      ...(requiresAcknowledgement && operatorDecision.confirmationState?.satisfied !== true
        ? ['lifecycle_command_awaiting_acknowledgement']
        : []),
      ...(schedule.status === 'scheduled' && ['enable', 'resume'].includes(command.action)
        ? ['lifecycle_command_waiting_for_schedule_window']
        : [])
    ]);
    const commandState = blocked
      ? 'blocked'
      : requiresAcknowledgement && operatorDecision.confirmationState?.satisfied !== true
        ? 'awaiting_acknowledgement'
        : command.requestedState === state || operatorDecision.selectedCommand?.id === command.id
          ? 'applied'
          : 'pending';
    return {
      index,
      id: command.id,
      action: command.action,
      requestedState: command.requestedState,
      source: command.source,
      reason: command.reason,
      state: commandState,
      requiresAcknowledgement,
      acknowledgementToken: requiresAcknowledgement ? operatorDecision.acknowledgement?.token ?? null : null,
      nextAction: lifecycleCommandQueueAction({ command, commandState, warnings }),
      scheduleStatus: command.schedule?.status ?? schedule.status,
      settingsDigest: stableHash(command.settings ?? settings),
      scheduleDigest: stableHash(command.schedule ?? schedule),
      blockers: blocked
        ? uniqueSorted([
            ...commandDiagnostics.filter((diagnostic) => diagnostic.level === 'error').map((diagnostic) => diagnostic.code),
            ...(state === 'blocked' ? ['lifecycle_state_blocked'] : []),
            ...deniedEffects.map((effect) => `permission_denied:${effect.effect ?? effect}`)
          ])
        : [],
      warnings
    };
  });
  const pending = commandRows.filter((command) => command.state === 'pending' || command.state === 'awaiting_acknowledgement');
  const applied = commandRows.filter((command) => command.state === 'applied');
  const blocked = commandRows.filter((command) => command.state === 'blocked');
  const requiredAcknowledgements = uniqueSorted(commandRows
    .filter((command) => command.requiresAcknowledgement)
    .map((command) => `lifecycle_command:${command.action}`));
  const coveredAcknowledgements = operatorDecision.confirmationState?.coveredAcknowledgements ?? [];
  const missingAcknowledgements = requiredAcknowledgements.filter((acknowledgement) => !coveredAcknowledgements.includes(acknowledgement));
  const blockers = uniqueSorted([
    ...blocked.flatMap((command) => command.blockers),
    ...validation.filter((diagnostic) => diagnostic.level === 'error').map((diagnostic) => diagnostic.code)
  ]);
  const warnings = uniqueSorted([
    ...pending.flatMap((command) => command.warnings),
    ...validation.filter((diagnostic) => diagnostic.level === 'warning').map((diagnostic) => diagnostic.code)
  ]);
  const queueState = blockers.length
    ? 'blocked'
    : missingAcknowledgements.length
      ? 'awaiting_acknowledgement'
      : pending.length
        ? 'pending'
        : warnings.length
          ? 'review'
          : commandRows.length
            ? 'applied'
            : enabled
              ? 'empty'
              : 'disabled';
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.lifecycle-command-queue`,
    operation,
    state: queueState,
    ready: ['applied', 'empty'].includes(queueState),
    enabled,
    selectedCommandId: operatorDecision.selectedCommand?.id ?? null,
    selectedAction: operatorDecision.selectedCommand?.action ?? null,
    pending,
    applied,
    blocked,
    commands: commandRows,
    requiredAcknowledgements: {
      required: requiredAcknowledgements,
      covered: coveredAcknowledgements,
      missing: missingAcknowledgements
    },
    nextAction: blockers.length
      ? actionForDiagnostic(blockers[0])
      : missingAcknowledgements.length
        ? 'collect_lifecycle_confirmation'
        : pending.length
          ? pending[0].nextAction
          : warnings.length
            ? 'review_lifecycle_command_queue'
            : enabled
              ? 'continue_lifecycle_handoff'
              : 'enable_lifecycle_before_handoff',
    blockers,
    warnings,
    digest: stableHash({
      operation,
      state,
      enabled,
      settings,
      schedule,
      selectedCommandId: operatorDecision.selectedCommand?.id ?? null,
      commands: commandRows.map((command) => `${command.id}:${command.action}:${command.state}`),
      missingAcknowledgements,
      blockers,
      warnings
    })
  };
}

function lifecycleCommandQueueAction({ command, commandState, warnings }) {
  if (commandState === 'blocked') return 'repair_lifecycle_command';
  if (commandState === 'awaiting_acknowledgement') return 'collect_lifecycle_confirmation';
  if (warnings.includes('lifecycle_command_waiting_for_schedule_window')) return 'wait_for_schedule_window';
  if (command.action === 'schedule' || command.action === 'reschedule') return 'apply_lifecycle_schedule';
  if (command.action === 'disable') return 'disable_lifecycle';
  if (command.action === 'pause' || command.action === 'hold') return 'hold_lifecycle';
  if (command.action === 'enable' || command.action === 'resume') return 'enable_lifecycle';
  return 'review_lifecycle_command';
}

function validateLifecycleCommandQueue(queue, lifecycle = {}) {
  const diagnostics = [];
  if (!queue) return [{ level: 'error', code: 'missing_lifecycle_command_queue' }];
  if (queue.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'lifecycle_command_queue_blocked', blockers: queue.blockers ?? [] });
  }
  if (queue.ready && !queue.digest) {
    diagnostics.push({ level: 'error', code: 'lifecycle_command_queue_missing_digest' });
  }
  if (queue.requiredAcknowledgements?.missing?.length && lifecycle.confirmationState?.satisfied === true) {
    diagnostics.push({
      level: 'error',
      code: 'lifecycle_command_queue_acknowledgement_mismatch',
      missingAcknowledgements: queue.requiredAcknowledgements.missing
    });
  }
  if (queue.state === 'awaiting_acknowledgement') {
    diagnostics.push({
      level: 'warning',
      code: 'lifecycle_command_queue_awaiting_acknowledgement',
      missingAcknowledgements: queue.requiredAcknowledgements?.missing ?? []
    });
  }
  return diagnostics;
}

function summarizeLifecycleCommandQueue(queue = {}) {
  return {
    state: queue?.state ?? 'unknown',
    ready: queue?.ready ?? false,
    selectedCommandId: queue?.selectedCommandId ?? null,
    selectedAction: queue?.selectedAction ?? null,
    pendingCount: queue?.pending?.length ?? 0,
    appliedCount: queue?.applied?.length ?? 0,
    blockedCount: queue?.blocked?.length ?? 0,
    missingAcknowledgementCount: queue?.requiredAcknowledgements?.missing?.length ?? 0,
    nextAction: queue?.nextAction ?? null,
    digest: queue?.digest ?? null
  };
}

function validateLifecycleConfirmationState(confirmationState = {}) {
  if (!confirmationState) return [];
  const diagnostics = [];
  if (confirmationState.state === 'missing') {
    diagnostics.push({
      level: 'warning',
      code: 'lifecycle_confirmation_missing',
      missingAcknowledgements: confirmationState.missingAcknowledgements ?? []
    });
  }
  if (confirmationState.satisfied && confirmationState.missingAcknowledgements?.length) {
    diagnostics.push({
      level: 'error',
      code: 'lifecycle_confirmation_satisfied_with_missing_acknowledgements',
      missingAcknowledgements: confirmationState.missingAcknowledgements
    });
  }
  if (confirmationState.requiredAcknowledgements?.length && !confirmationState.digest) {
    diagnostics.push({ level: 'error', code: 'lifecycle_confirmation_missing_digest' });
  }
  return diagnostics;
}

function buildLifecycleOperatorDecision({
  operation,
  enabled,
  state,
  settings,
  schedule,
  commands,
  confirmations,
  validation,
  nextAction
}) {
  const selectedCommand = selectLifecycleCommand(commands, state);
  const commandState = selectedCommand?.requestedState ?? state;
  const blockers = uniqueSorted([
    ...validation.filter((diagnostic) => diagnostic.level === 'error').map((diagnostic) => diagnostic.code),
    ...(state === 'blocked' ? ['lifecycle_state_blocked'] : [])
  ]);
  const warnings = uniqueSorted([
    ...validation.filter((diagnostic) => diagnostic.level === 'warning').map((diagnostic) => diagnostic.code),
    ...(state === 'degraded' ? ['lifecycle_degraded'] : []),
    ...(state === 'scheduled' ? ['lifecycle_scheduled'] : []),
    ...(state === 'disabled' ? ['lifecycle_disabled_by_policy'] : [])
  ]);
  const decisionState = blockers.length
    ? 'blocked'
    : commandState === 'disabled'
      ? 'disabled'
      : commandState === 'held'
        ? 'held'
        : commandState === 'scheduled'
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : 'ready';
  const requiresAcknowledgement = ['review', 'held', 'scheduled', 'disabled'].includes(decisionState)
    || commands.some((command) => ['disable', 'pause', 'hold', 'schedule', 'reschedule'].includes(command.action));
  const digestShape = {
    operation,
    enabled,
    state,
    decisionState,
    selectedCommandId: selectedCommand?.id ?? null,
    settings,
    schedule,
    commands: commands.map((command) => `${command.id}:${command.action}:${command.requestedState}`),
    blockers,
    warnings
  };
  const acknowledgement = {
    token: requiresAcknowledgement ? stableHash({ type: 'lifecycle-ack', digestShape }) : null,
    reason: requiresAcknowledgement ? lifecycleAcknowledgementReason(decisionState, selectedCommand) : null,
    requiredBefore: decisionState === 'scheduled' ? 'schedule_release' : 'kernel_handoff'
  };
  const confirmationState = buildLifecycleConfirmationCoverage({
    operation,
    decisionState,
    selectedCommand,
    requiresAcknowledgement,
    acknowledgement,
    confirmations,
    blockers,
    warnings
  });
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.lifecycle-operator-decision`,
    operation,
    state: decisionState,
    selectedCommand: selectedCommand
      ? {
          id: selectedCommand.id,
          action: selectedCommand.action,
          requestedState: selectedCommand.requestedState,
          source: selectedCommand.source,
          reason: selectedCommand.reason
        }
      : null,
    commandCount: commands.length,
    effectiveEnabled: decisionState === 'disabled' ? false : enabled,
    scheduleStatus: schedule.status,
    requiresAcknowledgement,
    acknowledgement,
    confirmationState,
    blockers,
    warnings,
    nextAction: blockers.length
      ? actionForDiagnostic(blockers[0])
      : confirmationState.missingAcknowledgements.length
        ? 'collect_lifecycle_confirmation'
      : nextAction
        ?? lifecycleDecisionNextAction(decisionState, selectedCommand)
        ?? nextLifecycleAction({ enabled, state, schedule, validation }),
    digest: stableHash(digestShape)
  };
}

function buildLifecycleConfirmationCoverage({
  operation,
  decisionState,
  selectedCommand,
  requiresAcknowledgement,
  acknowledgement,
  confirmations,
  blockers,
  warnings
}) {
  const requiredAcknowledgements = uniqueSorted([
    ...(requiresAcknowledgement ? ['lifecycle_operator_decision'] : []),
    ...(selectedCommand?.action ? [`lifecycle_command:${selectedCommand.action}`] : []),
    ...(decisionState === 'scheduled' ? ['lifecycle_schedule'] : []),
    ...(decisionState === 'held' ? ['lifecycle_manual_hold'] : []),
    ...(decisionState === 'disabled' ? ['lifecycle_disable'] : [])
  ]);
  const acceptedConfirmations = confirmations.filter((confirmation) => confirmation.accepted !== false);
  const appliedConfirmations = acceptedConfirmations.filter((confirmation) => lifecycleConfirmationMatches({
    confirmation,
    requiredAcknowledgements,
    acknowledgement,
    selectedCommand,
    decisionState
  }));
  const coveredAcknowledgements = uniqueSorted(appliedConfirmations.flatMap((confirmation) => lifecycleConfirmationCoverage({
    confirmation,
    requiredAcknowledgements,
    acknowledgement,
    selectedCommand,
    decisionState
  })));
  const missingAcknowledgements = requiredAcknowledgements.filter((acknowledgementName) => !coveredAcknowledgements.includes(acknowledgementName));
  const state = blockers.length
    ? 'blocked'
    : !requiredAcknowledgements.length
      ? 'not_required'
      : missingAcknowledgements.length
        ? 'missing'
        : warnings.length
          ? 'review'
          : 'confirmed';
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.lifecycle-confirmation`,
    operation,
    state,
    satisfied: missingAcknowledgements.length === 0,
    requiredAcknowledgements,
    coveredAcknowledgements,
    missingAcknowledgements,
    appliedConfirmations: appliedConfirmations.map((confirmation) => ({
      id: confirmation.id,
      action: confirmation.action,
      commandId: confirmation.commandId,
      tokenMatched: confirmation.token != null && confirmation.token === acknowledgement.token,
      actor: confirmation.actor,
      source: confirmation.source,
      reason: confirmation.reason
    })),
    nextAction: missingAcknowledgements.length
      ? 'collect_lifecycle_confirmation'
      : state === 'blocked'
        ? 'repair_lifecycle_controls'
        : state === 'review'
          ? 'review_lifecycle_confirmation'
          : 'continue_lifecycle_handoff',
    digest: stableHash({
      operation,
      decisionState,
      selectedCommandId: selectedCommand?.id ?? null,
      acknowledgementToken: acknowledgement.token ?? null,
      requiredAcknowledgements,
      coveredAcknowledgements,
      missingAcknowledgements,
      appliedConfirmationIds: appliedConfirmations.map((confirmation) => confirmation.id)
    })
  };
}

function lifecycleConfirmationMatches({
  confirmation,
  requiredAcknowledgements,
  acknowledgement,
  selectedCommand,
  decisionState
}) {
  if (confirmation.token && confirmation.token === acknowledgement.token) return true;
  if (confirmation.commandId && confirmation.commandId === selectedCommand?.id) return true;
  if (confirmation.action && selectedCommand?.action && confirmation.action === selectedCommand.action) return true;
  if (confirmation.state && confirmation.state === decisionState) return true;
  return requiredAcknowledgements.includes(confirmation.token);
}

function lifecycleConfirmationCoverage({
  confirmation,
  requiredAcknowledgements,
  acknowledgement,
  selectedCommand,
  decisionState
}) {
  if (confirmation.token && confirmation.token === acknowledgement.token) return requiredAcknowledgements;
  const coverage = [];
  if (requiredAcknowledgements.includes(confirmation.token)) coverage.push(confirmation.token);
  if (confirmation.commandId && confirmation.commandId === selectedCommand?.id) {
    coverage.push('lifecycle_operator_decision');
    if (selectedCommand?.action) coverage.push(`lifecycle_command:${selectedCommand.action}`);
  }
  if (confirmation.action && selectedCommand?.action && confirmation.action === selectedCommand.action) {
    coverage.push('lifecycle_operator_decision', `lifecycle_command:${selectedCommand.action}`);
    if (selectedCommand.action === 'schedule' || selectedCommand.action === 'reschedule') coverage.push('lifecycle_schedule');
    if (selectedCommand.action === 'hold' || selectedCommand.action === 'pause') coverage.push('lifecycle_manual_hold');
    if (selectedCommand.action === 'disable') coverage.push('lifecycle_disable');
  }
  if (confirmation.state && confirmation.state === decisionState) {
    if (decisionState === 'scheduled') coverage.push('lifecycle_schedule');
    if (decisionState === 'held') coverage.push('lifecycle_manual_hold');
    if (decisionState === 'disabled') coverage.push('lifecycle_disable');
  }
  return uniqueSorted(coverage);
}

function selectLifecycleCommand(commands, state) {
  const actionable = commands.filter((command) => command.action !== 'review');
  return actionable.at(-1) ?? commands.at(-1) ?? (state === 'scheduled'
    ? { id: 'implicit-schedule', action: 'schedule', requestedState: 'scheduled', source: 'runtime', reason: null }
    : state === 'disabled'
      ? { id: 'implicit-disable', action: 'disable', requestedState: 'disabled', source: 'runtime', reason: null }
      : null);
}

function lifecycleRequestedState(action) {
  return {
    enable: 'enabled',
    resume: 'enabled',
    disable: 'disabled',
    pause: 'held',
    hold: 'held',
    schedule: 'scheduled',
    reschedule: 'scheduled',
    review: 'review'
  }[action] ?? 'review';
}

function lifecycleDecisionNextAction(state, selectedCommand) {
  if (state === 'blocked') return 'repair_lifecycle_controls';
  if (state === 'disabled') return 'confirm_lifecycle_disabled';
  if (state === 'held') return 'await_manual_release';
  if (state === 'scheduled') return 'confirm_lifecycle_schedule';
  if (state === 'review') return selectedCommand ? 'review_lifecycle_command' : 'review_lifecycle_controls';
  return 'publish_lifecycle_handoff_ready';
}

function lifecycleAcknowledgementReason(state, selectedCommand) {
  if (selectedCommand?.reason) return selectedCommand.reason;
  if (state === 'disabled') return 'operator_disabled_lifecycle';
  if (state === 'held') return 'operator_hold_required';
  if (state === 'scheduled') return 'scheduled_release_requires_confirmation';
  return 'lifecycle_review_required';
}

function nextLifecycleAction({ enabled, state, schedule, validation }) {
  if (!enabled) return 'enable_lifecycle_before_handoff';
  if (validation.some((diagnostic) => diagnostic.level === 'error')) return 'repair_lifecycle_controls';
  if (state === 'blocked') return 'resolve_runtime_policy';
  if (schedule.status === 'manual_hold') return 'await_manual_release';
  if (schedule.status === 'scheduled') return 'wait_for_schedule_window';
  if (state === 'degraded') return 'handoff_with_degraded_mode_ack';
  return 'enqueue_kernel_job';
}

function derivePreviewReadiness({ ir, health, analytics, semantic }) {
  const lifecycle = ir?.lifecycle ?? {};
  const blockingReasons = uniqueSorted([
    ...asArray(health?.actionableErrors).filter((error) => error.retryable === false).map((error) => error.code),
    ...(analytics?.counters?.semanticErrorCount ? ['semantic_contract_blocked'] : []),
    ...(analytics?.counters?.deniedEffectCount ? ['denied_effects_present'] : []),
    ...(analytics?.counters?.missingClaimCount ? ['missing_verifier_claims'] : []),
    ...(lifecycle.exportable === false ? ['lifecycle_not_exportable'] : []),
    ...(semantic.blockedReasons ?? [])
  ]);
  const warningReasons = uniqueSorted([
    ...(health?.degradedReasons ?? []),
    ...(lifecycle.schedule?.status === 'manual_hold' ? ['manual_release_required'] : []),
    ...(lifecycle.schedule?.status === 'scheduled' ? ['scheduled_release_window'] : []),
    ...(semantic.externalWriteRequired ? ['external_write_requires_confirmation'] : []),
    ...(analytics?.counters?.duplicateContinuationCommandCount ? ['duplicate_continuation_commands'] : [])
  ]);
  const state = blockingReasons.length
    ? 'blocked'
    : warningReasons.length
      ? 'review'
      : analytics?.exportReady === true
        ? 'ready'
        : 'not_ready';
  return {
    state,
    exportReady: analytics?.exportReady === true && blockingReasons.length === 0,
    canPreview: Boolean(ir?.programId && ir?.operation),
    blockingReasons,
    warningReasons,
    requiredAcknowledgements: buildRequiredAcknowledgements({ semantic, lifecycle }),
    primaryAction: readinessPrimaryAction({ state, lifecycle, semantic })
  };
}

function buildKernelRouteExportPreview({ ir, semantic, readiness, acceptance, operatorActionCard }) {
  const routeExport = ir?.semantic?.externalWrite?.routeExportState ?? {};
  const analyticsPublication = ir?.semantic?.externalWrite?.analyticsPublication ?? {};
  const timelinePublication = ir?.semantic?.externalWrite?.timelinePublication ?? routeExport.timelinePublication ?? {};
  const blockers = uniqueSorted([
    ...(routeExport.blockers ?? []),
    ...(analyticsPublication.blockers ?? []).map((blocker) => `analytics_publication_${blocker}`),
    ...(timelinePublication.blockers ?? []).map((blocker) => `timeline_publication_${blocker}`),
    ...(readiness.blockingReasons ?? []).filter((reason) => String(reason).includes('route_export')),
    ...(semantic.externalWriteRequired && !routeExport.digest ? ['route_export_missing_digest'] : []),
    ...(semantic.externalWriteRequired && !routeExport.publishCommand?.commandId ? ['route_export_missing_publish_command'] : []),
    ...(semantic.externalWriteRequired && !analyticsPublication.digest ? ['route_export_missing_analytics_publication'] : []),
    ...(semantic.externalWriteRequired && !analyticsPublication.publishCommand?.commandId ? ['route_export_missing_analytics_publication_command'] : []),
    ...(semantic.externalWriteRequired && !timelinePublication.digest ? ['route_export_missing_timeline_publication'] : []),
    ...(semantic.externalWriteRequired && !timelinePublication.publishCommand?.commandId ? ['route_export_missing_timeline_publication_command'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(routeExport.warnings ?? []),
    ...(analyticsPublication.warnings ?? []).map((warning) => `analytics_publication_${warning}`),
    ...(timelinePublication.warnings ?? []).map((warning) => `timeline_publication_${warning}`),
    ...(routeExport.changedSinceAcceptedSnapshot ? ['route_export_changed_since_acceptance'] : []),
    ...(analyticsPublication.freshness?.changedSinceKernelSnapshot ? ['analytics_publication_changed_since_kernel_snapshot'] : []),
    ...(timelinePublication.drift?.changedSinceAcceptedSnapshot ? ['timeline_publication_changed_since_acceptance'] : []),
    ...(timelinePublication.drift?.changedSinceKernelSnapshot ? ['timeline_publication_changed_since_kernel_snapshot'] : []),
    ...(operatorActionCard?.ready === false && semantic.externalWriteRequired ? ['operator_action_card_not_ready'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'review'
      : routeExport.ready
        ? 'ready'
        : semantic.externalWriteRequired
          ? 'not_ready'
          : 'not_required';
  const publishCommandId = routeExport.publishCommand?.commandId ?? null;
  const digest = stableHash({
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    state,
    semanticDigest: routeExport.digest ?? null,
    analyticsPublicationDigest: analyticsPublication.digest ?? null,
    timelinePublicationDigest: timelinePublication.digest ?? null,
    publishCommandId,
    analyticsPublishCommandId: analyticsPublication.publishCommand?.commandId ?? null,
    timelinePublishCommandId: timelinePublication.publishCommand?.commandId ?? null,
    acceptanceState: acceptance.state,
    blockers,
    warnings
  });
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.route-export-preview`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired: semantic.externalWriteRequired === true,
    statusChannel: routeExport.statusChannel ?? ir?.handoff?.statusChannel ?? null,
    publishCommandId,
    publishReady: routeExport.publishCommand?.ready === true && blockers.length === 0,
    analyticsPublication: {
      state: analyticsPublication.state ?? 'not_analyzed',
      ready: analyticsPublication.ready === true,
      digest: analyticsPublication.digest ?? null,
      publishCommandId: analyticsPublication.publishCommand?.commandId ?? null,
      publishReady: analyticsPublication.publishCommand?.ready === true && blockers.length === 0,
      targetCount: analyticsPublication.targets?.length ?? 0,
      missingAcknowledgementCount: analyticsPublication.acknowledgements?.missing?.length ?? 0,
      freshnessWarningCount: analyticsPublication.freshness?.warnings?.length ?? 0,
      nextAction: analyticsPublication.nextAction ?? null
    },
    timelinePublication: {
      state: timelinePublication.state ?? 'not_analyzed',
      ready: timelinePublication.ready === true,
      digest: timelinePublication.digest ?? null,
      publishCommandId: timelinePublication.publishCommand?.commandId ?? null,
      publishReady: timelinePublication.publishCommand?.ready === true && blockers.length === 0,
      eventCount: timelinePublication.events?.length ?? 0,
      snapshotCount: timelinePublication.snapshots?.length ?? 0,
      latestEvent: timelinePublication.latestEvent?.phase ?? null,
      changedSinceAcceptedSnapshot: timelinePublication.drift?.changedSinceAcceptedSnapshot === true,
      changedSinceKernelSnapshot: timelinePublication.drift?.changedSinceKernelSnapshot === true,
      blockerCount: timelinePublication.blockers?.length ?? 0,
      warningCount: timelinePublication.warnings?.length ?? 0,
      nextAction: timelinePublication.nextAction ?? null
    },
    digest,
    semanticDigest: routeExport.digest ?? null,
    acceptanceDigest: routeExport.acceptanceDigest ?? null,
    exportDigest: routeExport.exportDigest ?? null,
    changedSinceAcceptedSnapshot: routeExport.changedSinceAcceptedSnapshot === true,
    snapshotCount: routeExport.snapshots?.length ?? 0,
    timelineEventCount: routeExport.timeline?.length ?? 0,
    nextAction: blockers.length
      ? actionForDiagnostic(blockers[0])
      : warnings.length
        ? 'review_external_write_route_export'
        : routeExport.nextAction ?? (semantic.externalWriteRequired ? 'publish_external_write_route_export' : 'continue_read_only'),
    blockers,
    warnings
  };
}

function buildKernelOperatorActionCard({
  ir,
  health,
  analytics,
  semantic,
  readiness,
  acceptance,
  nextSteps
}) {
  const externalCard = ir?.semantic?.externalWrite?.analyticsExport?.operatorActionCard ?? {};
  const recoveryLifecycle = ir?.semantic?.recovery?.analyticsSummary?.lifecycleCommandState ?? {};
  const blockers = uniqueSorted([
    ...readiness.blockingReasons,
    ...(externalCard.blockers ?? []).map((blocker) => `external_card_${blocker}`),
    ...(recoveryLifecycle.blockers ?? []).map((blocker) => `recovery_command_${blocker}`)
  ]);
  const warnings = uniqueSorted([
    ...readiness.warningReasons,
    ...(externalCard.warnings ?? []).map((warning) => `external_card_${warning}`),
    ...(recoveryLifecycle.warnings ?? []).map((warning) => `recovery_command_${warning}`)
  ]);
  const state = blockers.length
    ? 'blocked'
    : acceptance.enabled
      ? 'accepted'
      : warnings.length || acceptance.missingAcknowledgements?.length
        ? 'review'
        : readiness.exportReady
          ? 'ready'
          : 'not_ready';
  const primaryAction = blockers.length
    ? actionForDiagnostic(blockers[0])
    : acceptance.missingAcknowledgements?.length
      ? 'collect_operator_acknowledgement'
      : externalCard.primaryAction
        ?? recoveryLifecycle.selectedCommand
        ?? nextSteps[0]?.action
        ?? acceptance.nextAction
        ?? 'operator_review';
  const digestShape = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    state,
    primaryAction,
    externalCardDigest: externalCard.digest ?? null,
    recoveryLifecycleDigest: recoveryLifecycle.digest ?? null,
    acceptanceState: acceptance.state,
    readinessState: readiness.state,
    commandId: externalCard.commandId ?? ir?.persistedState?.commandId ?? null,
    blockers,
    warnings
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.operator-action-card`,
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    state,
    ready: ['accepted', 'ready'].includes(state) && blockers.length === 0,
    primaryAction,
    secondaryActions: uniqueSorted([
      ...(externalCard.secondaryActions ?? []),
      ...(recoveryLifecycle.commands ?? []).map((command) => command.action),
      ...(nextSteps ?? []).map((step) => step.action)
    ]).filter((action) => action !== primaryAction).slice(0, 5),
    title: externalCard.title ?? `Mailchimp ${ir?.operation ?? 'operation'} handoff`,
    commandId: externalCard.commandId ?? ir?.persistedState?.commandId ?? null,
    statusChannel: externalCard.statusChannel ?? ir?.handoff?.statusChannel ?? null,
    idempotencyKey: externalCard.idempotencyKey ?? ir?.handoff?.idempotencyKey ?? null,
    externalActionCardDigest: externalCard.digest ?? null,
    recoveryLifecycleDigest: recoveryLifecycle.digest ?? null,
    validationSummary: {
      ok: blockers.length === 0,
      errorCount: blockers.length,
      warningCount: warnings.length,
      actionableErrorCount: analytics?.counters?.actionableErrorCount ?? 0,
      missingAcknowledgementCount: acceptance.missingAcknowledgements?.length ?? 0,
      externalCardReady: externalCard.ready === true,
      recoveryLifecycleReady: recoveryLifecycle.ready === true
    },
    health: {
      status: health?.status ?? 'unknown',
      canRetry: health?.canRetry ?? false
    },
    userVisibleStatus: externalCard.userVisibleStatus ?? {
      current: acceptance.enabled ? 'ready_for_confirmation' : readiness.primaryAction,
      completion: 'mailchimp_write_synced',
      failure: 'mailchimp_write_needs_review'
    },
    blockers,
    warnings,
    digest: stableHash(digestShape)
  };
}

function deriveAcceptanceState({ ir, health, analytics, semantic, readiness }) {
  const requiredAcknowledgements = readiness.requiredAcknowledgements;
  const acknowledged = uniqueSorted([
    ...normalizeAcknowledgements(ir?.handoff?.audit?.acknowledgements),
    ...(ir?.lifecycle?.confirmationState?.coveredAcknowledgements ?? [])
  ]);
  const missingAcknowledgements = requiredAcknowledgements.filter((item) => !acknowledged.includes(item));
  const blocked = readiness.blockingReasons.length > 0 || health?.status === 'unhealthy';
  const enabled = !blocked && missingAcknowledgements.length === 0 && readiness.exportReady;
  return {
    state: enabled ? 'accepted' : blocked ? 'blocked' : 'pending_acknowledgement',
    enabled,
    mode: semantic.externalWriteRequired ? 'explicit_external_write_acceptance' : 'implicit_read_only_acceptance',
    acceptedAt: ir?.handoff?.audit?.acceptedAt ?? null,
    acceptedBy: ir?.handoff?.audit?.acceptedBy ?? null,
    requiredAcknowledgements,
    acknowledged,
    missingAcknowledgements,
    nextAction: acceptanceNextAction({ enabled, blocked, missingAcknowledgements, analytics })
  };
}

function buildValidationSummary(ir) {
  const diagnostics = validateKernelCallIRWithoutHealth({
    ...stableClone(ir),
    preview: null
  }).diagnostics;
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
    errorCount: diagnostics.filter((diagnostic) => diagnostic.level === 'error').length,
    warningCount: diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length,
    infoCount: diagnostics.filter((diagnostic) => diagnostic.level === 'info').length,
    codes: uniqueSorted(diagnostics.map((diagnostic) => diagnostic.code)),
    errors: diagnostics.filter((diagnostic) => diagnostic.level === 'error').map((diagnostic) => diagnostic.code),
    warnings: diagnostics.filter((diagnostic) => diagnostic.level === 'warning').map((diagnostic) => diagnostic.code)
  };
}

function buildExplainableNextSteps({ ir, health, semantic, readiness, acceptance }) {
  if (readiness.blockingReasons.length) {
    return readiness.blockingReasons.map((reason, index) => ({
      index,
      action: actionForDiagnostic(reason),
      reason,
      label: labelForNextStep(reason),
      terminal: false
    }));
  }
  if (acceptance.missingAcknowledgements.length) {
    return acceptance.missingAcknowledgements.map((acknowledgement, index) => ({
      index,
      action: 'collect_operator_acknowledgement',
      reason: acknowledgement,
      label: labelForAcknowledgement(acknowledgement),
      terminal: false
    }));
  }
  if (readiness.state === 'review') {
    return readiness.warningReasons.map((reason, index) => ({
      index,
      action: readiness.primaryAction,
      reason,
      label: labelForNextStep(reason),
      terminal: false
    }));
  }
  return [{
    index: 0,
    action: semantic.recoveryNextAction ?? semantic.externalWriteNextAction ?? ir?.lifecycle?.nextAction ?? 'enqueue_kernel_job',
    reason: health?.status === 'healthy' ? 'ready_for_handoff' : 'ready_with_recovery_context',
    label: 'Ready for Mailchimp runtime handoff',
    terminal: true
  }];
}

function buildExportSummary({ ir, analytics = {}, history = {}, preview = {}, summary = {}, audit = {} }) {
  const previewSummary = summarizeKernelCallUIPreview(preview);
  const counters = analytics.counters ?? {};
  const statusRecovery = ir ? buildKernelStatusRecoveryReport(ir) : analytics.statusRecovery;
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.export-summary`,
    programId: ir?.programId ?? summary?.programId ?? null,
    operation: ir?.operation ?? summary?.operation ?? null,
    status: ir?.status ?? summary?.status ?? 'unknown',
    exportReady: analytics.exportReady === true && previewSummary.acceptEnabled === true,
    acceptanceState: previewSummary.acceptance,
    readinessState: previewSummary.readiness,
    nextAction: previewSummary.nextAction ?? 'operator_review',
    snapshotDigest: history?.latest?.digest ?? null,
    changedSincePrevious: history?.changedSincePrevious ?? false,
    counters: {
      actionableErrorCount: counters.actionableErrorCount ?? 0,
      semanticErrorCount: counters.semanticErrorCount ?? 0,
      externalWriteRequiredCount: counters.externalWriteRequiredCount ?? 0,
      recoveryBlockedCount: counters.recoveryBlockedCount ?? 0,
      operatorActionCardReadyCount: counters.operatorActionCardReadyCount ?? preview?.operatorActionCard?.ready ? 1 : 0,
      operatorActionCardBlockerCount: counters.operatorActionCardBlockerCount ?? preview?.operatorActionCard?.blockers?.length ?? 0,
      recoveryLifecycleCommandCount: counters.recoveryLifecycleCommandCount ?? 0,
      externalOperationalIncidentOpenCount: counters.externalOperationalIncidentOpenCount ?? 0,
      externalOperationalIncidentRetryableCount: counters.externalOperationalIncidentRetryableCount ?? 0,
      externalOperationalIncidentTerminalCount: counters.externalOperationalIncidentTerminalCount ?? 0,
      externalProviderHandoffHealthReadyCount: counters.externalProviderHandoffHealthReadyCount ?? 0,
      externalProviderHandoffHealthDegradedCount: counters.externalProviderHandoffHealthDegradedCount ?? 0,
      externalProviderHandoffHealthRetryableCount: counters.externalProviderHandoffHealthRetryableCount ?? 0,
      externalProviderHandoffHealthTerminalCount: counters.externalProviderHandoffHealthTerminalCount ?? 0,
      externalProviderHandoffHealthFailedDependencyCount: counters.externalProviderHandoffHealthFailedDependencyCount ?? 0,
      recoveryOperationalIncidentOpenCount: counters.recoveryOperationalIncidentOpenCount ?? 0,
      recoveryOperationalIncidentTerminalCount: counters.recoveryOperationalIncidentTerminalCount ?? 0,
      recoveryProviderHandoffHealthReadyCount: counters.recoveryProviderHandoffHealthReadyCount ?? 0,
      recoveryProviderHandoffHealthDegradedCount: counters.recoveryProviderHandoffHealthDegradedCount ?? 0,
      recoveryProviderHandoffHealthTerminalCount: counters.recoveryProviderHandoffHealthTerminalCount ?? 0,
      externalRecoveryRunbookReadyCount: counters.externalRecoveryRunbookReadyCount ?? 0,
      externalRecoveryRunbookStepCount: counters.externalRecoveryRunbookStepCount ?? 0,
      externalRecoveryRunbookBlockerCount: counters.externalRecoveryRunbookBlockerCount ?? 0,
      recoveryRunbookReadyCount: counters.recoveryRunbookReadyCount ?? 0,
      recoveryRunbookStepCount: counters.recoveryRunbookStepCount ?? 0,
      recoveryRunbookBlockerCount: counters.recoveryRunbookBlockerCount ?? 0,
      persistenceEnvelopeReadyCount: counters.externalPersistenceEnvelopeReadyCount ?? 0,
      persistenceEnvelopeRestartSafeCount: counters.externalPersistenceEnvelopeRestartSafeCount ?? 0,
      persistenceEnvelopeRecoveryHintCount: counters.externalPersistenceEnvelopeRecoveryHintCount ?? 0,
      persistenceEnvelopeBlockerCount: counters.externalPersistenceEnvelopeBlockerCount ?? 0,
      stateIntegrityReadyCount: counters.externalStateIntegrityReadyCount ?? 0,
      stateIntegrityRestartSafeCount: counters.externalStateIntegrityRestartSafeCount ?? 0,
      stateIntegrityAlignedCount: counters.externalStateIntegrityAlignedCount ?? 0,
      stateIntegrityMismatchCount: counters.externalStateIntegrityMismatchCount ?? 0,
      stateIntegrityBlockerCount: counters.externalStateIntegrityBlockerCount ?? 0,
      recoveryStateIntegrityReadyCount: counters.recoveryStateIntegrityReadyCount ?? 0,
      recoveryStateIntegrityRestartSafeCount: counters.recoveryStateIntegrityRestartSafeCount ?? 0,
      recoveryStateIntegrityAlignedCount: counters.recoveryStateIntegrityAlignedCount ?? 0,
      recoveryStateIntegrityMismatchCount: counters.recoveryStateIntegrityMismatchCount ?? 0,
      routeExportReadyCount: counters.externalRouteExportReadyCount ?? (preview?.routeExport?.ready ? 1 : 0),
      routeExportChangedCount: counters.externalRouteExportChangedCount ?? (preview?.routeExport?.changedSinceAcceptedSnapshot ? 1 : 0),
      routeExportBlockerCount: counters.externalRouteExportBlockerCount ?? preview?.routeExport?.blockers?.length ?? 0,
      analyticsPublicationReadyCount: counters.externalAnalyticsPublicationReadyCount ?? (preview?.routeExport?.analyticsPublication?.ready ? 1 : 0),
      analyticsPublicationTargetCount: counters.externalAnalyticsPublicationTargetCount ?? preview?.routeExport?.analyticsPublication?.targetCount ?? 0,
      analyticsPublicationPublisherCount: counters.externalAnalyticsPublicationPublisherCount ?? 0,
      analyticsPublicationMissingAcknowledgementCount: counters.externalAnalyticsPublicationMissingAcknowledgementCount ?? preview?.routeExport?.analyticsPublication?.missingAcknowledgementCount ?? 0,
      analyticsPublicationFreshnessWarningCount: counters.externalAnalyticsPublicationFreshnessWarningCount ?? preview?.routeExport?.analyticsPublication?.freshnessWarningCount ?? 0,
      analyticsPublicationBlockerCount: counters.externalAnalyticsPublicationBlockerCount ?? 0,
      timelinePublicationReadyCount: counters.externalTimelinePublicationReadyCount ?? (preview?.routeExport?.timelinePublication?.ready ? 1 : 0),
      timelinePublicationEventCount: counters.externalTimelinePublicationEventCount ?? preview?.routeExport?.timelinePublication?.eventCount ?? 0,
      timelinePublicationSnapshotCount: counters.externalTimelinePublicationSnapshotCount ?? preview?.routeExport?.timelinePublication?.snapshotCount ?? 0,
      timelinePublicationDriftCount: counters.externalTimelinePublicationDriftCount ?? (preview?.routeExport?.timelinePublication?.changedSinceAcceptedSnapshot ? 1 : 0),
      timelinePublicationBlockerCount: counters.externalTimelinePublicationBlockerCount ?? preview?.routeExport?.timelinePublication?.blockerCount ?? 0,
      timelinePublicationWarningCount: counters.externalTimelinePublicationWarningCount ?? preview?.routeExport?.timelinePublication?.warningCount ?? 0,
      externalResumeCursorReadyCount: counters.externalResumeCursorReadyCount ?? 0,
      externalResumeCursorRestartSafeCount: counters.externalResumeCursorRestartSafeCount ?? 0,
      externalResumeCursorCheckpointCount: counters.externalResumeCursorCheckpointCount ?? 0,
      externalResumeCursorBlockerCount: counters.externalResumeCursorBlockerCount ?? 0,
      recoveryResumeCursorReadyCount: counters.recoveryResumeCursorReadyCount ?? 0,
      recoveryResumeCursorRestartSafeCount: counters.recoveryResumeCursorRestartSafeCount ?? 0,
      recoveryResumeCursorAlignedCount: counters.recoveryResumeCursorAlignedCount ?? 0,
      boundaryDecisionReceiptReadyCount: counters.externalBoundaryDecisionReceiptReadyCount ?? 0,
      boundaryDecisionReceiptReleaseCount: counters.externalBoundaryDecisionReceiptReleaseCount ?? 0,
      boundaryDecisionReceiptBlockerCount: counters.externalBoundaryDecisionReceiptBlockerCount ?? 0,
      boundaryDecisionReceiptWarningCount: counters.externalBoundaryDecisionReceiptWarningCount ?? 0,
      boundaryDecisionReceiptEvidenceCount: counters.externalBoundaryDecisionReceiptEvidenceCount ?? 0,
      warningCount: previewSummary.validation.warningCount,
      blockingIssueCount: previewSummary.blockingReasons.length
    },
    operationalIncident: summarizeKernelOperationalIncident(ir),
    providerHandoffHealth: summarizeKernelProviderHandoffHealth(ir),
    recoveryRunbook: summarizeKernelRecoveryRunbook(ir),
    resumeCursor: summarizeKernelResumeCursor(ir),
    operatorActionCard: preview?.operatorActionCard ?? null,
    routeExport: preview?.routeExport ?? null,
    boundaryDecisionReceipt: {
      state: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.state ?? 'not_analyzed',
      decision: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.decision ?? 'unknown',
      releaseAllowed: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.release?.allowed ?? false,
      receiptDigest: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.receiptDigest ?? null,
      commandId: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.command?.commandId ?? null,
      nextAction: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.nextAction ?? null
    },
    persistenceEnvelope: summarizeKernelPersistenceEnvelope(ir),
    stateIntegrity: summarizeKernelStateIntegrity(ir),
    statusRecovery: summarizeKernelStatusRecoveryReport(statusRecovery),
    runtimeWorkflow: previewSummary.runtimeWorkflow,
    audit: {
      channel: audit?.channel ?? ir?.handoff?.audit?.channel ?? 'audit.mailchimp.runtime_handoff',
      tenantId: audit?.tenantId ?? ir?.handoff?.scope?.tenantId ?? null,
      workspaceId: audit?.workspaceId ?? ir?.handoff?.scope?.workspaceId ?? null,
      boundaryDecisionReceiptDigest: ir?.semantic?.externalWrite?.boundaryDecisionReceipt?.receiptDigest ?? null,
      idempotencyKey: audit?.idempotencyKey ?? ir?.handoff?.idempotencyKey ?? null
    }
  };
}

function summarizeKernelPersistenceEnvelope(ir) {
  const externalEnvelope = ir?.semantic?.externalWrite?.persistenceEnvelope ?? {};
  const recoveryEnvelope = ir?.semantic?.recovery?.persistedClientState?.persistenceEnvelope ?? {};
  const restartRecovery = ir?.semantic?.recovery?.restartRecovery ?? {};
  const envelope = externalEnvelope.digest ? externalEnvelope : recoveryEnvelope;
  return {
    state: restartRecovery.persistenceEnvelopeState ?? envelope.state ?? 'unknown',
    ready: envelope.ready ?? false,
    digest: restartRecovery.persistenceEnvelopeDigest ?? envelope.digest ?? null,
    resumePointer: restartRecovery.persistenceEnvelopeResumePointer ?? envelope.resumePointer ?? null,
    manifestDigest: restartRecovery.persistenceEnvelopeManifestDigest ?? envelope.manifestDigest ?? null,
    restartSafe: restartRecovery.persistenceEnvelopeRestartSafe ?? envelope.restartSemantics?.restartSafe ?? false,
    recoveryHints: restartRecovery.persistenceEnvelopeRecoveryHints ?? envelope.recoveryHints ?? [],
    blockerCount: externalEnvelope.blockers?.length ?? 0,
    warningCount: externalEnvelope.warnings?.length ?? 0,
    nextAction: externalEnvelope.nextAction ?? recoveryEnvelope.nextAction ?? null
  };
}

function summarizeKernelProviderHandoffHealth(ir) {
  const external = ir?.semantic?.externalWrite?.providerHandoffHealth ?? {};
  const recovery = ir?.semantic?.recovery?.analyticsSummary?.providerHandoffHealth
    ?? ir?.semantic?.recovery?.statusHandoff?.providerHandoffHealth
    ?? {};
  const source = recovery.digest ? recovery : external;
  return {
    state: source.state ?? 'unknown',
    ready: source.ready ?? false,
    degraded: source.degraded ?? false,
    retryable: source.retryable ?? false,
    terminal: source.terminal ?? false,
    statusChannel: source.statusChannel ?? external.statusChannel ?? ir?.handoff?.statusChannel ?? null,
    commandId: source.commandId ?? external.commandId ?? null,
    receiptDigest: source.receiptDigest ?? external.receipt?.digest ?? null,
    retryAfterMs: source.retryAfterMs ?? external.retryWindow?.retryAfterMs ?? null,
    dependencyCount: source.dependencyCount ?? external.dependencies?.length ?? 0,
    failedDependencyCount: source.failedDependencyCount ?? external.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0,
    blockerCount: source.blockerCount ?? external.blockers?.length ?? 0,
    warningCount: source.warningCount ?? external.warnings?.length ?? 0,
    digest: source.digest ?? external.digest ?? null,
    nextAction: source.nextAction ?? external.nextAction ?? null
  };
}

function summarizeKernelStateIntegrity(ir) {
  const external = ir?.semantic?.externalWrite?.stateIntegrityManifest ?? {};
  const recovery = ir?.semantic?.recovery?.analyticsSummary?.stateIntegrity ?? {};
  const manifest = recovery.digest ? recovery : external;
  return {
    state: manifest.state ?? 'unknown',
    ready: manifest.ready ?? false,
    digest: manifest.digest ?? null,
    manifestDigest: manifest.manifestDigest ?? null,
    manifestKey: manifest.manifestKey ?? external.manifestKey ?? null,
    aligned: manifest.aligned ?? false,
    restartSafe: manifest.restartSafe ?? false,
    checkpointCount: manifest.checkpointCount ?? external.checkpoints?.length ?? 0,
    mismatchCount: manifest.mismatchCount ?? external.mismatches?.length ?? 0,
    blockerCount: manifest.blockerCount ?? external.blockers?.length ?? 0,
    warningCount: manifest.warningCount ?? external.warnings?.length ?? 0,
    nextAction: manifest.nextAction ?? external.nextAction ?? null,
    digestVector: external.digestVector ?? null
  };
}

function summarizeKernelResumeCursor(ir) {
  const externalCursor = ir?.semantic?.externalWrite?.resumeCursor ?? {};
  const recoveryCursor = ir?.semantic?.recovery?.analyticsSummary?.resumeCursor
    ?? ir?.semantic?.recovery?.restartRecovery?.resumeCursor
    ?? {};
  const cursor = recoveryCursor.digest ? recoveryCursor : externalCursor;
  const commandAligned = recoveryCursor.commandAligned
    ?? (!externalCursor.commandId || !ir?.semantic?.recovery?.restartRecovery?.commandId || externalCursor.commandId === ir.semantic.recovery.restartRecovery.commandId);
  const statusChannelAligned = recoveryCursor.statusChannelAligned
    ?? (!externalCursor.statusChannel || !ir?.handoff?.statusChannel || externalCursor.statusChannel === ir.handoff.statusChannel);
  const envelopeDigestAligned = recoveryCursor.envelopeDigestAligned
    ?? (!externalCursor.digestVector?.persistenceEnvelope
      || !ir?.semantic?.recovery?.restartRecovery?.persistenceEnvelopeDigest
      || externalCursor.digestVector.persistenceEnvelope === ir.semantic.recovery.restartRecovery.persistenceEnvelopeDigest);
  const routeDigestAligned = recoveryCursor.routeDigestAligned
    ?? (!externalCursor.digestVector?.routeExport
      || !ir?.semantic?.externalWrite?.routeExportState?.digest
      || externalCursor.digestVector.routeExport === ir.semantic.externalWrite.routeExportState.digest);
  return {
    state: cursor.state ?? 'unknown',
    ready: cursor.ready ?? false,
    digest: cursor.digest ?? null,
    externalDigest: externalCursor.digest ?? null,
    recoveryDigest: recoveryCursor.digest ?? null,
    cursorKey: cursor.cursorKey ?? null,
    resumePointer: cursor.resumePointer ?? null,
    restartSafe: recoveryCursor.restartSafe ?? externalCursor.restartSemantics?.restartSafe ?? false,
    commandId: cursor.commandId ?? externalCursor.commandId ?? null,
    statusChannel: cursor.statusChannel ?? externalCursor.statusChannel ?? ir?.handoff?.statusChannel ?? null,
    checkpointCount: recoveryCursor.checkpointCount ?? externalCursor.checkpoints?.length ?? 0,
    alignment: {
      command: commandAligned === true,
      statusChannel: statusChannelAligned === true,
      persistenceEnvelope: envelopeDigestAligned === true,
      routeExport: routeDigestAligned === true
    },
    digestVector: {
      persistedStatus: externalCursor.digestVector?.persistedStatus ?? null,
      statusJournal: externalCursor.digestVector?.statusJournal ?? null,
      providerCommandLedger: externalCursor.digestVector?.providerCommandLedger ?? null,
      persistenceEnvelope: externalCursor.digestVector?.persistenceEnvelope ?? null,
      routeExport: externalCursor.digestVector?.routeExport ?? null,
      analyticsExport: externalCursor.digestVector?.analyticsExport ?? null
    },
    nextAction: cursor.nextAction ?? externalCursor.nextAction ?? null
  };
}

function summarizeKernelOperationalIncident(ir) {
  const externalIncident = ir?.semantic?.externalWrite?.operationalIncident ?? {};
  const recoveryIncident = ir?.semantic?.recovery?.analyticsSummary?.operationalIncident ?? {};
  const incident = externalIncident.digest ? externalIncident : recoveryIncident;
  return {
    state: incident.state ?? 'unknown',
    severity: incident.severity ?? 'none',
    open: incident.open ?? false,
    retryable: incident.retryable ?? false,
    terminal: incident.terminal ?? false,
    owner: incident.owner ?? null,
    retryAfterMs: incident.retryWindow?.retryAfterMs ?? incident.retryAfterMs ?? null,
    externalDigest: externalIncident.digest ?? null,
    recoveryDigest: recoveryIncident.digest ?? null,
    nextAction: incident.nextAction ?? null
  };
}

function summarizeKernelRecoveryRunbook(ir) {
  const externalRunbook = ir?.semantic?.externalWrite?.recoveryRunbook ?? {};
  const recoveryRunbook = ir?.semantic?.recovery?.analyticsSummary?.recoveryRunbook ?? {};
  const runbook = recoveryRunbook.digest ? recoveryRunbook : externalRunbook;
  const externalSteps = externalRunbook.steps ?? [];
  return {
    state: runbook.state ?? 'unknown',
    ready: runbook.ready ?? false,
    mode: runbook.mode ?? externalRunbook.mode ?? null,
    primaryCommandId: runbook.primaryCommandId ?? externalRunbook.primaryCommandId ?? null,
    retryAfterMs: runbook.retryAfterMs ?? externalRunbook.retryAfterMs ?? null,
    externalDigest: externalRunbook.digest ?? null,
    recoveryDigest: recoveryRunbook.digest ?? null,
    stepCount: runbook.stepCount ?? externalSteps.length ?? 0,
    executableStepCount: runbook.executableStepCount ?? externalSteps.filter((step) => step.executable).length ?? 0,
    blockerCount: runbook.blockerCount ?? externalRunbook.blockers?.length ?? 0,
    warningCount: runbook.warningCount ?? externalRunbook.warnings?.length ?? 0,
    nextAction: runbook.nextAction ?? externalRunbook.nextAction ?? null
  };
}

function buildKernelStatusRecoveryReport(ir) {
  const externalWrite = ir?.semantic?.externalWrite ?? {};
  const recovery = ir?.semantic?.recovery ?? {};
  const persistedProvider = ir?.persistedState ?? buildPersistedProviderState(ir);
  const persistedWrite = externalWrite?.persistedStatus ?? {};
  const persistenceEnvelope = externalWrite?.persistenceEnvelope ?? {};
  const restartRecovery = recovery?.restartRecovery ?? {};
  const writeRequired = externalWrite?.writeRequired === true || persistedProvider?.required === true;
  const externalOperationalRetry = externalWrite?.statusHandoff?.operationalRetry ?? externalWrite?.operationalRetry ?? {};
  const recoveryOperationalRetry = recovery?.statusHandoff?.operationalRetry ?? {};
  const operationalRetry = {
    state: recoveryOperationalRetry.state ?? externalOperationalRetry.state ?? 'unknown',
    ready: recoveryOperationalRetry.ready === true || externalOperationalRetry.ready === true || !writeRequired,
    digest: recoveryOperationalRetry.digest ?? externalOperationalRetry.digest ?? null,
    retryScheduled: recoveryOperationalRetry.retryScheduled === true || externalOperationalRetry.retryScheduled === true,
    retryAfterMs: recoveryOperationalRetry.retryAfterMs ?? externalOperationalRetry.retryAfterMs ?? null,
    attempt: recoveryOperationalRetry.attempt ?? externalOperationalRetry.attempt ?? 0,
    maxAttempts: recoveryOperationalRetry.maxAttempts ?? externalOperationalRetry.maxAttempts ?? 0,
    exhausted: recoveryOperationalRetry.exhausted === true || externalOperationalRetry.exhausted === true,
    degradedMode: recoveryOperationalRetry.degradedMode ?? externalOperationalRetry.degradedMode ?? null,
    nextRetryCommand: recoveryOperationalRetry.nextRetryCommand ?? externalOperationalRetry.nextRetryCommand ?? null,
    nextAction: recoveryOperationalRetry.nextAction ?? externalOperationalRetry.nextAction ?? null,
    externalDigest: externalOperationalRetry.digest ?? null,
    recoveryDigest: recoveryOperationalRetry.digest ?? null
  };
  const commandId = persistedWrite.commandId
    ?? restartRecovery.commandId
    ?? persistedProvider.commandId
    ?? null;
  const idempotencyKey = persistedWrite.idempotencyKey
    ?? restartRecovery.idempotencyKey
    ?? persistedProvider.idempotencyKey
    ?? ir?.handoff?.idempotencyKey
    ?? null;
  const statusChannel = persistedWrite.statusChannel
    ?? restartRecovery.statusChannel
    ?? persistedProvider.statusChannel
    ?? ir?.handoff?.statusChannel
    ?? null;
  const snapshotDigest = restartRecovery.exportSnapshotDigest
    ?? persistedProvider.snapshotDigest
    ?? recovery?.sync?.snapshotDigest
    ?? persistedWrite.snapshotHint
    ?? null;
  const envelopeDigest = restartRecovery.persistenceEnvelopeDigest
    ?? persistenceEnvelope.digest
    ?? recovery?.persistedClientState?.persistenceEnvelope?.digest
    ?? null;
  const blockers = uniqueSorted([
    ...(persistedWrite.blockers ?? []),
    ...(persistenceEnvelope.blockers ?? []).map((blocker) => `persistence_envelope_${blocker}`),
    ...(externalOperationalRetry.blockers ?? []).map((blocker) => `external_operational_retry_${blocker}`),
    ...(recoveryOperationalRetry.blockers ?? []).map((blocker) => `recovery_operational_retry_${blocker}`),
    ...(restartRecovery.blockers ?? []),
    ...(persistedProvider.blockers ?? []),
    ...(externalWrite.blockedReasons ?? []),
    ...(recovery.blockedReasons ?? []),
    ...(!commandId && writeRequired ? ['missing_status_recovery_command_id'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_status_recovery_idempotency_key'] : []),
    ...(!statusChannel && writeRequired ? ['missing_status_recovery_channel'] : []),
    ...(!envelopeDigest && writeRequired ? ['missing_status_recovery_persistence_envelope_digest'] : []),
    ...(!operationalRetry.digest && writeRequired ? ['missing_status_recovery_operational_retry_digest'] : []),
    ...(operationalRetry.retryScheduled && !operationalRetry.retryAfterMs ? ['status_recovery_operational_retry_missing_backoff'] : []),
    ...(operationalRetry.state === 'terminal' ? ['status_recovery_operational_retry_terminal'] : []),
    ...(!(
      restartRecovery.persistenceEnvelopeResumePointer
      ?? persistenceEnvelope.resumePointer
      ?? recovery?.persistedClientState?.persistenceEnvelope?.resumePointer
    ) && writeRequired ? ['missing_status_recovery_persistence_envelope_resume_pointer'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : persistedProvider.status === 'held' || persistedWrite.state === 'held' || restartRecovery.state === 'held'
      ? 'held'
      : persistedProvider.status === 'scheduled' || persistedWrite.state === 'scheduled' || restartRecovery.state === 'scheduled'
        ? 'scheduled'
        : persistedProvider.status === 'ready' || persistedWrite.ready === true || restartRecovery.ready === true
          ? 'ready'
          : writeRequired
            ? 'waiting'
            : 'not_required';
  const timeline = [
    {
      phase: 'kernel_ir',
      state: ir?.status ?? 'unknown',
      digest: stableHash({ programId: ir?.programId ?? null, operation: ir?.operation ?? null, status: ir?.status ?? null })
    },
    {
      phase: 'persisted_external_write',
      state: persistedWrite.state ?? 'unknown',
      digest: persistedWrite.digest ?? null
    },
    {
      phase: 'persistence_envelope',
      state: restartRecovery.persistenceEnvelopeState ?? persistenceEnvelope.state ?? 'unknown',
      digest: envelopeDigest
    },
    {
      phase: 'operational_retry',
      state: operationalRetry.state ?? 'unknown',
      digest: operationalRetry.digest ?? null
    },
    {
      phase: 'restart_recovery',
      state: restartRecovery.state ?? 'unknown',
      digest: restartRecovery.digest ?? null
    },
    {
      phase: 'persisted_provider',
      state: persistedProvider.status ?? 'unknown',
      digest: persistedProvider.digest ?? null
    },
    {
      phase: 'runtime_workflow',
      state: ir?.preview?.runtimeWorkflow?.state ?? 'unknown',
      digest: ir?.preview?.runtimeWorkflow?.clientRuntimeState?.digest ?? null
    }
  ];
  const digestShape = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    state,
    commandId,
    idempotencyKey,
    statusChannel,
    persistedWriteDigest: persistedWrite.digest ?? null,
    persistenceEnvelopeDigest: envelopeDigest,
    operationalRetryDigest: operationalRetry.digest ?? null,
    operationalRetryState: operationalRetry.state,
    retryScheduled: operationalRetry.retryScheduled,
    retryAfterMs: operationalRetry.retryAfterMs,
    restartRecoveryDigest: restartRecovery.digest ?? null,
    providerDigest: persistedProvider.digest ?? null,
    snapshotDigest
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.status-recovery`,
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    commandId,
    idempotencyKey,
    statusChannel,
    restartToken: restartRecovery.restartToken ?? persistedProvider.restartToken ?? persistedWrite.restartToken ?? ir?.runtimeState?.profileRestartToken ?? null,
    snapshotDigest,
    persistedExternalWrite: {
      state: persistedWrite.state ?? 'unknown',
      ready: persistedWrite.ready === true,
      digest: persistedWrite.digest ?? null,
      userVisibleStatus: persistedWrite.userVisibleStatus?.current ?? null
    },
    persistenceEnvelope: {
      state: restartRecovery.persistenceEnvelopeState ?? persistenceEnvelope.state ?? recovery?.persistedClientState?.persistenceEnvelope?.state ?? 'unknown',
      ready: persistenceEnvelope.ready === true || recovery?.persistedClientState?.persistenceEnvelope?.ready === true,
      digest: envelopeDigest,
      resumePointer: restartRecovery.persistenceEnvelopeResumePointer
        ?? persistenceEnvelope.resumePointer
        ?? recovery?.persistedClientState?.persistenceEnvelope?.resumePointer
        ?? null,
      manifestDigest: restartRecovery.persistenceEnvelopeManifestDigest
        ?? persistenceEnvelope.manifestDigest
        ?? recovery?.persistedClientState?.persistenceEnvelope?.manifestDigest
        ?? null,
      restartSafe: restartRecovery.persistenceEnvelopeRestartSafe
        ?? persistenceEnvelope.restartSemantics?.restartSafe
        ?? recovery?.persistedClientState?.persistenceEnvelope?.restartSafe
        ?? false,
      recoveryHints: restartRecovery.persistenceEnvelopeRecoveryHints ?? persistenceEnvelope.recoveryHints ?? []
    },
    operationalRetry,
    restartRecovery: {
      state: restartRecovery.state ?? 'unknown',
      ready: restartRecovery.ready === true,
      digest: restartRecovery.digest ?? null,
      statusDigest: restartRecovery.statusDigest ?? null
    },
    persistedProvider: {
      state: persistedProvider.status ?? 'unknown',
      ready: persistedProvider.status === 'ready' || persistedProvider.status === 'not_required',
      digest: persistedProvider.digest ?? null,
      safeToReplay: persistedProvider.safeToReplay === true
    },
    userVisibleStatus: {
      current: recovery?.persistedClientState?.userVisibleStatus?.current
        ?? persistedWrite.userVisibleStatus?.current
        ?? persistedProvider.userVisibleStatus?.current
        ?? kernelStatusRecoveryUserStatus(state),
      completion: recovery?.persistedClientState?.userVisibleStatus?.completion
        ?? persistedWrite.userVisibleStatus?.completion
        ?? persistedProvider.userVisibleStatus?.completion
        ?? 'mailchimp_write_synced',
      failure: recovery?.persistedClientState?.userVisibleStatus?.failure
        ?? persistedWrite.userVisibleStatus?.failure
        ?? persistedProvider.userVisibleStatus?.failure
        ?? 'mailchimp_write_needs_review'
    },
    scope: {
      tenantId: persistedWrite.scope?.tenantId ?? persistedProvider.scope?.tenantId ?? ir?.handoff?.scope?.tenantId ?? null,
      workspaceId: persistedWrite.scope?.workspaceId ?? persistedProvider.scope?.workspaceId ?? ir?.handoff?.scope?.workspaceId ?? null,
      isolationKey: persistedWrite.scope?.isolationKey ?? persistedProvider.scope?.isolationKey ?? ir?.handoff?.scope?.isolationKey ?? null
    },
    timeline,
    blockers,
    nextAction: state === 'blocked'
      ? persistedProviderAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'publish_kernel_status_recovery_report'
            : writeRequired
              ? recovery?.nextAction ?? externalWrite?.nextAction ?? 'wait_for_status_recovery'
              : 'continue_read_only',
    digest: stableHash(digestShape)
  };
}

function summarizeKernelStatusRecoveryReport(report = {}) {
  return {
    state: report?.state ?? 'unknown',
    ready: report?.ready ?? false,
    commandId: report?.commandId ?? null,
    snapshotDigest: report?.snapshotDigest ?? null,
    persistedExternalWriteState: report?.persistedExternalWrite?.state ?? 'unknown',
    restartRecoveryState: report?.restartRecovery?.state ?? 'unknown',
    persistedProviderState: report?.persistedProvider?.state ?? 'unknown',
    operationalRetryState: report?.operationalRetry?.state ?? 'unknown',
    operationalRetryScheduled: report?.operationalRetry?.retryScheduled ?? false,
    operationalRetryAfterMs: report?.operationalRetry?.retryAfterMs ?? null,
    userVisibleStatus: report?.userVisibleStatus?.current ?? null,
    nextAction: report?.nextAction ?? null,
    blockerCount: report?.blockers?.length ?? 0,
    timelineEventCount: report?.timeline?.length ?? 0,
    digest: report?.digest ?? null
  };
}

export function buildKernelClientRuntimeHandoffPacket(ir) {
  const preview = ir?.preview ?? buildKernelCallUIPreview({
    ...stableClone(ir),
    clientHandoff: null
  });
  const runtimeWorkflow = preview.runtimeWorkflow ?? {};
  const clientRuntimeState = runtimeWorkflow.clientRuntimeState ?? buildPreviewClientRuntimeState({
    ir,
    externalWrite: ir?.semantic?.externalWrite ?? {},
    recovery: ir?.semantic?.recovery ?? {},
    persistedState: ir?.persistedState
  });
  const statusRecovery = buildKernelStatusRecoveryReport({
    ...stableClone(ir),
    preview
  });
  const provider = ir?.provider ?? buildKernelProviderServiceContract(ir, {});
  const persistedState = ir?.persistedState ?? buildPersistedProviderState(ir);
  const providerSession = persistedState.providerSession ?? buildProviderSessionState({ ir, persistedState, provider });
  const adoptionReceipt = ir?.semantic?.externalWrite?.clientRuntimeAdoptionReceipt
    ?? ir?.semantic?.recovery?.persistedClientState?.clientRuntimeAdoptionReceipt
    ?? null;
  const workflowStatusCapsule = ir?.semantic?.recovery?.persistedClientState?.clientWorkflowStatusCapsule
    ?? ir?.semantic?.externalWrite?.clientWorkflowStatusCapsule
    ?? null;
  const readiness = preview.readiness ?? {};
  const acceptance = preview.acceptance ?? {};
  const nextActionState = preview.nextActionState ?? buildKernelNextActionState({
    ir,
    health: ir?.health ?? deriveKernelCallHealth(ir),
    analytics: ir?.analytics ?? deriveKernelCallAnalytics(ir),
    semantic: summarizeSemanticReports(ir?.semantic),
    readiness,
    acceptance,
    nextSteps: preview.nextSteps ?? [],
    operatorActionCard: preview.operatorActionCard ?? {},
    routeExport: preview.routeExport ?? {}
  });
  const lifecycleDecision = ir?.lifecycle?.operatorDecision ?? {};
  const blockers = uniqueSorted([
    ...(readiness.blockingReasons ?? []),
    ...(nextActionState.state === 'blocked' ? (nextActionState.blockers ?? ['kernel_next_action_blocked']) : []),
    ...(runtimeWorkflow.blockers ?? []),
    ...(clientRuntimeState.blockers ?? []),
    ...(statusRecovery.blockers ?? []),
    ...(provider.blockers ?? []),
    ...(persistedState.blockers ?? []),
    ...(adoptionReceipt?.state === 'blocked' ? (adoptionReceipt.blockers ?? ['client_runtime_adoption_receipt_blocked']) : []),
    ...(ir?.semantic?.externalWrite?.writeRequired && !adoptionReceipt?.digest ? ['missing_client_runtime_adoption_receipt'] : []),
    ...(adoptionReceipt?.ready && (adoptionReceipt?.restartSemantics?.restartSafe ?? adoptionReceipt?.restartSafe) === false ? ['client_runtime_adoption_receipt_not_restart_safe'] : []),
    ...(workflowStatusCapsule?.state === 'blocked' ? (workflowStatusCapsule.blockers ?? ['client_workflow_status_blocked']) : []),
    ...(ir?.semantic?.externalWrite?.writeRequired && !workflowStatusCapsule?.digest ? ['missing_client_workflow_status_capsule'] : []),
    ...(workflowStatusCapsule?.ready && workflowStatusCapsule?.restartSafe === false ? ['client_workflow_status_not_restart_safe'] : []),
    ...(lifecycleDecision.state === 'blocked' ? (lifecycleDecision.blockers ?? ['lifecycle_operator_decision_blocked']) : [])
  ]);
  const warnings = uniqueSorted([
    ...(readiness.warningReasons ?? []),
    ...(nextActionState.warnings ?? []).map((warning) => `next_action_${warning}`),
    ...(runtimeWorkflow.warnings ?? []),
    ...(provider.warnings ?? []),
    ...(adoptionReceipt?.state === 'review' ? ['client_runtime_adoption_receipt_review'] : []),
    ...(workflowStatusCapsule?.state === 'review' ? ['client_workflow_status_review'] : []),
    ...(lifecycleDecision.requiresAcknowledgement && lifecycleDecision.confirmationState?.satisfied !== true
      ? ['lifecycle_operator_acknowledgement_required']
      : []),
    ...(lifecycleDecision.warnings ?? []),
    ...(statusRecovery.state === 'held' ? ['manual_release_hold'] : []),
    ...(statusRecovery.state === 'scheduled' ? ['scheduled_status_recovery'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : statusRecovery.state === 'held'
      ? 'held'
      : statusRecovery.state === 'scheduled'
        ? 'scheduled'
        : acceptance.enabled && runtimeWorkflow.exportReady && clientRuntimeState.ready
          ? 'ready'
          : warnings.length
            ? 'review'
            : clientRuntimeState.ready
              ? 'waiting_for_acceptance'
              : 'waiting_for_runtime_state';
  const handoffScope = [
    ir?.programId,
    ir?.operation,
    ir?.handoff?.idempotencyKey,
    clientRuntimeState.digest,
    statusRecovery.digest,
    state
  ];
  const commands = buildKernelClientHandoffCommands({
    ir,
    state,
    acceptance,
    clientRuntimeState,
    statusRecovery,
    provider,
    persistedState,
    scope: handoffScope
  });
  const lifecycleAdoption = buildClientLifecycleAdoptionGate({
    ir,
    state,
    acceptance,
    runtimeWorkflow,
    clientRuntimeState,
    statusRecovery,
    lifecycleDecision
  });
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.client-handoff`,
    id: stableHash({ type: 'kernel-client-handoff', handoffScope }),
    product: 'mailchimp',
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    adapter: ir?.adapter ?? 'mailchimp',
    state,
    ready: state === 'ready',
    visibleStatus: kernelClientHandoffVisibleStatus(state),
    nextAction: kernelClientHandoffNextAction({ state, blockers, warnings, acceptance, runtimeWorkflow, statusRecovery }),
    target: {
      workflow: ir?.handoff?.target ?? null,
      queue: ir?.call?.target ?? null,
      statusChannel: clientRuntimeState.statusChannel ?? statusRecovery.statusChannel ?? ir?.handoff?.statusChannel ?? null,
      idempotencyKey: clientRuntimeState.idempotencyKey ?? statusRecovery.idempotencyKey ?? ir?.handoff?.idempotencyKey ?? null,
      continuationMode: ir?.handoff?.continuationMode ?? null,
      restartToken: clientRuntimeState.restartToken ?? statusRecovery.restartToken ?? ir?.runtimeState?.profileRestartToken ?? null
    },
    scope: {
      tenantId: clientRuntimeState.scope?.tenantId ?? ir?.handoff?.scope?.tenantId ?? null,
      workspaceId: clientRuntimeState.scope?.workspaceId ?? ir?.handoff?.scope?.workspaceId ?? null,
      isolationKey: clientRuntimeState.scope?.isolationKey ?? ir?.handoff?.scope?.isolationKey ?? null,
      role: ir?.handoff?.scope?.role ?? null
    },
    readiness: {
      state: readiness.state ?? 'unknown',
      exportReady: readiness.exportReady === true,
      primaryAction: readiness.primaryAction ?? null,
      requiredAcknowledgements: readiness.requiredAcknowledgements ?? [],
      blockingReasons: readiness.blockingReasons ?? [],
      warningReasons: readiness.warningReasons ?? []
    },
    nextActionState: {
      ...summarizeKernelNextActionState(nextActionState),
      commands: nextActionState.commands ?? []
    },
    lifecycleCommandQueue: summarizeLifecycleCommandQueue(ir?.lifecycle?.commandQueue),
    lifecycleDecision: summarizeLifecycleOperatorDecision(lifecycleDecision),
    lifecycleAdoption,
    acceptance: {
      state: acceptance.state ?? 'unknown',
      enabled: acceptance.enabled === true,
      mode: acceptance.mode ?? 'unknown',
      missingAcknowledgements: acceptance.missingAcknowledgements ?? [],
      nextAction: acceptance.nextAction ?? null
    },
    runtimeWorkflow: summarizeRuntimeWorkflowHandoff(runtimeWorkflow),
    clientRuntimeState: summarizeClientRuntimeState(clientRuntimeState),
    clientRuntimeAdoptionReceipt: summarizeClientRuntimeAdoptionReceipt(adoptionReceipt),
    clientWorkflowStatusCapsule: summarizeClientWorkflowStatusCapsule(workflowStatusCapsule),
    statusRecovery: summarizeKernelStatusRecoveryReport(statusRecovery),
    provider: summarizeKernelProviderServiceContract(provider),
    persistedProvider: summarizePersistedProviderState(persistedState),
    providerSession: summarizeProviderSessionState(providerSession),
    commands,
    blockers,
    warnings,
    digest: stableHash({
      programId: ir?.programId ?? null,
      operation: ir?.operation ?? null,
      state,
      commandIds: commands.map((command) => command.id),
      blockers,
      warnings,
      clientRuntimeDigest: clientRuntimeState.digest,
      statusRecoveryDigest: statusRecovery.digest,
      providerSessionDigest: providerSession.digest,
      adoptionReceiptDigest: adoptionReceipt?.digest ?? null,
      workflowStatusDigest: workflowStatusCapsule?.digest ?? null,
      nextActionDigest: nextActionState.digest ?? null,
      lifecycleCommandQueueDigest: ir?.lifecycle?.commandQueue?.digest ?? null,
      lifecycleAdoptionDigest: lifecycleAdoption.digest,
      lifecycleDecisionDigest: lifecycleDecision.digest ?? null
    })
  };
}

function buildClientLifecycleAdoptionGate({
  ir,
  state,
  acceptance,
  runtimeWorkflow,
  clientRuntimeState,
  statusRecovery,
  lifecycleDecision
}) {
  const lifecycle = ir?.lifecycle ?? {};
  const selectedCommand = lifecycleDecision?.selectedCommand ?? null;
  const confirmationState = lifecycleDecision?.confirmationState ?? lifecycle?.confirmationState ?? {};
  const requiredAcknowledgements = uniqueSorted([
    ...(acceptance?.missingAcknowledgements ?? []),
    ...(confirmationState.missingAcknowledgements ?? (
      lifecycleDecision?.requiresAcknowledgement ? ['lifecycle_operator_decision'] : []
    )),
    ...(selectedCommand?.action && !confirmationState.coveredAcknowledgements?.includes(`lifecycle_command:${selectedCommand.action}`)
      ? [`lifecycle_command:${selectedCommand.action}`]
      : [])
  ]);
  const blockers = uniqueSorted([
    ...(lifecycleDecision?.state === 'blocked' ? (lifecycleDecision.blockers ?? ['lifecycle_operator_decision_blocked']) : []),
    ...(lifecycle?.exportable === false ? ['lifecycle_not_exportable'] : []),
    ...(clientRuntimeState?.state === 'blocked' ? (clientRuntimeState.blockers ?? ['client_runtime_state_blocked']) : []),
    ...(statusRecovery?.state === 'blocked' ? (statusRecovery.blockers ?? ['status_recovery_blocked']) : []),
    ...(runtimeWorkflow?.state === 'blocked' ? (runtimeWorkflow.blockers ?? ['runtime_workflow_blocked']) : []),
    ...(state === 'blocked' ? ['client_handoff_blocked'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(lifecycleDecision?.warnings ?? []),
    ...(runtimeWorkflow?.warnings ?? []),
    ...(statusRecovery?.state === 'held' ? ['status_recovery_held'] : []),
    ...(statusRecovery?.state === 'scheduled' ? ['status_recovery_scheduled'] : []),
    ...(requiredAcknowledgements.length ? ['lifecycle_adoption_requires_acknowledgement'] : [])
  ]);
  const schedule = {
    status: lifecycle?.schedule?.status ?? lifecycleDecision?.scheduleStatus ?? 'unscheduled',
    mode: lifecycle?.schedule?.mode ?? null,
    notBefore: lifecycle?.schedule?.notBefore ?? null,
    notAfter: lifecycle?.schedule?.notAfter ?? null,
    timezone: lifecycle?.schedule?.timezone ?? null
  };
  const gateState = blockers.length
    ? 'blocked'
    : lifecycleDecision?.state === 'held' || statusRecovery?.state === 'held'
      ? 'held'
      : lifecycleDecision?.state === 'scheduled' || statusRecovery?.state === 'scheduled'
        ? 'scheduled'
        : requiredAcknowledgements.length
          ? 'awaiting_acknowledgement'
          : clientRuntimeState?.ready && statusRecovery?.ready
            ? 'adoptable'
            : 'waiting';
  const commands = buildClientLifecycleAdoptionCommands({
    ir,
    gateState,
    selectedCommand,
    requiredAcknowledgements,
    clientRuntimeState,
    statusRecovery,
    lifecycleDecision
  });
  const digestShape = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    gateState,
    selectedCommandId: selectedCommand?.id ?? null,
    lifecycleDecisionDigest: lifecycleDecision?.digest ?? null,
    clientRuntimeDigest: clientRuntimeState?.digest ?? null,
    statusRecoveryDigest: statusRecovery?.digest ?? null,
    requiredAcknowledgements,
    blockers,
    warnings
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.client-lifecycle-adoption`,
    state: gateState,
    ready: gateState === 'adoptable',
    presentationMode: gateState === 'adoptable'
      ? 'apply'
      : gateState === 'awaiting_acknowledgement'
        ? 'acknowledge'
        : ['held', 'scheduled'].includes(gateState)
          ? 'defer'
          : 'repair',
    selectedCommand: selectedCommand
      ? {
          id: selectedCommand.id ?? null,
          action: selectedCommand.action ?? null,
          requestedState: selectedCommand.requestedState ?? null,
          source: selectedCommand.source ?? null,
          reason: selectedCommand.reason ?? null
        }
      : null,
    effectiveEnabled: lifecycleDecision?.effectiveEnabled ?? lifecycle?.enabled !== false,
    schedule,
    requiredAcknowledgements,
    acknowledgementToken: lifecycleDecision?.acknowledgement?.token ?? null,
    confirmationState: {
      state: confirmationState.state ?? 'not_required',
      satisfied: confirmationState.satisfied ?? false,
      missingAcknowledgements: confirmationState.missingAcknowledgements ?? [],
      appliedConfirmationCount: confirmationState.appliedConfirmations?.length ?? 0,
      digest: confirmationState.digest ?? null
    },
    runtimeStateDigest: clientRuntimeState?.digest ?? null,
    statusRecoveryDigest: statusRecovery?.digest ?? null,
    userVisibleStatus: clientLifecycleAdoptionStatus(gateState),
    commands,
    blockers,
    warnings,
    nextAction: clientLifecycleAdoptionAction({
      gateState,
      blockers,
      warnings,
      requiredAcknowledgements,
      selectedCommand,
      runtimeWorkflow,
      statusRecovery
    }),
    digest: stableHash(digestShape)
  };
}

function buildClientLifecycleAdoptionCommands({
  ir,
  gateState,
  selectedCommand,
  requiredAcknowledgements,
  clientRuntimeState,
  statusRecovery,
  lifecycleDecision
}) {
  const seed = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    idempotencyKey: ir?.handoff?.idempotencyKey ?? null,
    clientRuntimeDigest: clientRuntimeState?.digest ?? null,
    statusRecoveryDigest: statusRecovery?.digest ?? null,
    lifecycleDecisionDigest: lifecycleDecision?.digest ?? null
  };
  const commands = [{
    id: stableHash({ type: 'client-lifecycle-adoption-command', seed, action: 'persist-gate' }),
    type: 'persist-client-lifecycle-adoption-gate',
    idempotencyKey: stableHash({ type: 'client-lifecycle-adoption-idempotency', seed, action: 'persist-gate' }),
    statusAfterReplay: gateState,
    writes: ['lifecycleAdoptionGate', 'visibleStatus', 'nextAction'],
    conflict: 'return-existing',
    target: ir?.handoff?.target ?? 'mailchimp.client.workflow'
  }];
  if (requiredAcknowledgements.length) {
    commands.push({
      id: stableHash({ type: 'client-lifecycle-adoption-command', seed, action: 'collect-acknowledgement', requiredAcknowledgements }),
      type: 'collect-lifecycle-adoption-acknowledgement',
      idempotencyKey: stableHash({ type: 'client-lifecycle-adoption-idempotency', seed, action: 'collect-acknowledgement', token: lifecycleDecision?.acknowledgement?.token }),
      statusAfterReplay: 'awaiting_lifecycle_acknowledgement',
      writes: ['lifecycleAcknowledgementToken', 'requiredAcknowledgements'],
      conflict: 'return-existing',
      target: ir?.handoff?.target ?? 'mailchimp.client.workflow'
    });
  }
  if (gateState === 'adoptable') {
    commands.push({
      id: stableHash({ type: 'client-lifecycle-adoption-command', seed, action: 'apply', selectedCommand }),
      type: 'apply-client-lifecycle-adoption',
      idempotencyKey: stableHash({ type: 'client-lifecycle-adoption-idempotency', seed, action: 'apply' }),
      statusAfterReplay: selectedCommand?.requestedState ?? 'lifecycle_adopted',
      writes: ['lifecycleState', 'clientRuntimeDigest', 'statusRecoveryDigest'],
      conflict: 'return-existing',
      target: ir?.handoff?.target ?? 'mailchimp.client.workflow'
    });
  }
  return commands;
}

function clientLifecycleAdoptionStatus(state) {
  return {
    blocked: 'lifecycle_adoption_needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    awaiting_acknowledgement: 'waiting_for_lifecycle_acknowledgement',
    waiting: 'preparing_lifecycle_adoption',
    adoptable: 'ready_to_apply_lifecycle_adoption'
  }[state] ?? 'operator_review';
}

function clientLifecycleAdoptionAction({
  gateState,
  blockers,
  warnings,
  requiredAcknowledgements,
  selectedCommand,
  runtimeWorkflow,
  statusRecovery
}) {
  if (gateState === 'blocked') return actionForDiagnostic(blockers[0]);
  if (gateState === 'held') return 'await_manual_release';
  if (gateState === 'scheduled') return 'wait_for_schedule_window';
  if (requiredAcknowledgements.length) return 'collect_lifecycle_adoption_acknowledgement';
  if (gateState === 'adoptable') {
    return selectedCommand?.action === 'disable'
      ? 'apply_lifecycle_disable_to_client_runtime'
      : selectedCommand?.action === 'hold' || selectedCommand?.action === 'pause'
        ? 'apply_lifecycle_hold_to_client_runtime'
        : selectedCommand?.action === 'schedule' || selectedCommand?.action === 'reschedule'
          ? 'apply_lifecycle_schedule_to_client_runtime'
          : 'apply_lifecycle_adoption_to_client_runtime';
  }
  if (warnings.length) return 'review_lifecycle_adoption_gate';
  return statusRecovery?.nextAction ?? runtimeWorkflow?.nextAction ?? 'wait_for_lifecycle_adoption_gate';
}

function buildKernelClientHandoffCommands(input) {
  const {
    ir,
    state,
    acceptance,
    clientRuntimeState,
    statusRecovery,
    provider,
    persistedState,
    scope
  } = input;
  const commandSeed = [
    ...scope,
    clientRuntimeState.commandId,
    statusRecovery.commandId,
    persistedState.commandId
  ];
  const commands = [
    {
      id: stableHash({ type: 'client-command', commandSeed, command: 'persist-client-runtime-state' }),
      type: 'persist-client-runtime-state',
      idempotencyKey: stableHash({ type: 'client-command-idempotency', commandSeed, command: 'persist-client-runtime-state' }),
      statusAfterReplay: state,
      writes: ['clientRuntimeState', 'visibleStatus', 'nextAction', 'statusChannel'],
      conflict: 'return-existing',
      target: ir?.handoff?.target ?? 'mailchimp.client.workflow'
    }
  ];
  if (state === 'ready') {
    commands.push({
      id: stableHash({ type: 'client-command', commandSeed, command: 'publish-kernel-handoff-ready' }),
      type: 'publish-kernel-handoff-ready',
      idempotencyKey: stableHash({ type: 'client-command-idempotency', commandSeed, command: 'publish-kernel-handoff-ready' }),
      statusAfterReplay: 'ready_for_kernel_handoff',
      writes: ['acceptanceState', 'providerStatus', 'statusRecoveryDigest'],
      conflict: 'return-existing',
      target: provider.sync?.commandTarget ?? ir?.call?.target ?? null
    });
  }
  if (acceptance.missingAcknowledgements?.length) {
    commands.push({
      id: stableHash({ type: 'client-command', commandSeed, command: 'collect-acknowledgement' }),
      type: 'collect-operator-acknowledgement',
      idempotencyKey: stableHash({ type: 'client-command-idempotency', commandSeed, command: 'collect-acknowledgement' }),
      statusAfterReplay: 'pending_acknowledgement',
      writes: ['missingAcknowledgements', 'auditAcknowledgementState'],
      conflict: 'return-existing',
      target: ir?.handoff?.target ?? 'mailchimp.client.workflow'
    });
  }
  if (ir?.lifecycle?.operatorDecision?.requiresAcknowledgement) {
    commands.push({
      id: stableHash({ type: 'client-command', commandSeed, command: 'acknowledge-lifecycle-decision', digest: ir.lifecycle.operatorDecision.digest }),
      type: 'acknowledge-lifecycle-operator-decision',
      idempotencyKey: stableHash({ type: 'client-command-idempotency', commandSeed, command: 'acknowledge-lifecycle-decision', token: ir.lifecycle.operatorDecision.acknowledgement?.token }),
      statusAfterReplay: ir.lifecycle.operatorDecision.state,
      writes: ['lifecycleDecision', 'lifecycleAcknowledgementToken', 'visibleStatus'],
      conflict: 'return-existing',
      target: ir?.handoff?.target ?? 'mailchimp.client.workflow'
    });
  }
  if (state === 'blocked') {
    commands.push({
      id: stableHash({ type: 'client-command', commandSeed, command: 'publish-handoff-blocked' }),
      type: 'publish-handoff-blocked',
      idempotencyKey: stableHash({ type: 'client-command-idempotency', commandSeed, command: 'publish-handoff-blocked' }),
      statusAfterReplay: 'handoff_blocked',
      writes: ['blockers', 'actionableErrors', 'recoveryAction'],
      conflict: 'return-existing',
      target: ir?.handoff?.target ?? 'mailchimp.client.workflow'
    });
  }
  return commands;
}

function validateKernelClientRuntimeHandoffPacket(packet, ir) {
  if (!packet) return [];
  const diagnostics = [];
  if (!packet.id || !packet.schemaVersion) {
    diagnostics.push({ level: 'error', code: 'client_handoff_packet_identity_missing' });
  }
  if (packet.ready && packet.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'client_handoff_ready_with_blockers', blockers: packet.blockers });
  }
  if (packet.ready && !packet.target?.statusChannel && ir?.semantic?.externalWrite?.writeRequired) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_status_channel' });
  }
  if (packet.ready && !packet.target?.idempotencyKey) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_idempotency_key' });
  }
  if (!packet.commands?.length) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_commands' });
  }
  if (!packet.nextActionState?.digest) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_next_action_state' });
  }
  if (packet.nextActionState?.ready && packet.nextActionState?.blockerCount > 0) {
    diagnostics.push({ level: 'error', code: 'client_handoff_next_action_ready_with_blockers' });
  }
  if (packet.lifecycleDecision?.requiresAcknowledgement && !packet.lifecycleDecision?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_lifecycle_acknowledgement_token' });
  }
  if (!packet.lifecycleAdoption?.digest) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_lifecycle_adoption_gate' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && !packet.clientRuntimeAdoptionReceipt?.digest) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_client_runtime_adoption_receipt' });
  }
  if (packet.clientRuntimeAdoptionReceipt?.ready && packet.clientRuntimeAdoptionReceipt?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'client_handoff_client_runtime_adoption_receipt_not_restart_safe' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && !packet.clientWorkflowStatusCapsule?.digest) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_client_workflow_status_capsule' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && !packet.clientWorkflowStatusCapsule?.resumePointer) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_client_workflow_status_resume_pointer' });
  }
  if (packet.clientWorkflowStatusCapsule?.ready && packet.clientWorkflowStatusCapsule?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'client_handoff_client_workflow_status_not_restart_safe' });
  }
  if (packet.clientWorkflowStatusCapsule?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'client_handoff_client_workflow_status_blocked',
      blockers: packet.clientWorkflowStatusCapsule.blockers ?? []
    });
  }
  if (packet.lifecycleAdoption?.ready && packet.lifecycleAdoption?.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'client_handoff_lifecycle_adoption_ready_with_blockers',
      blockers: packet.lifecycleAdoption.blockers
    });
  }
  if (packet.lifecycleAdoption?.state === 'awaiting_acknowledgement' && !packet.lifecycleAdoption?.acknowledgementToken) {
    diagnostics.push({ level: 'warning', code: 'client_handoff_lifecycle_adoption_missing_acknowledgement_token' });
  }
  if (packet.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'client_handoff_blocked', blockers: packet.blockers ?? [] });
  }
  return diagnostics;
}

function summarizeKernelClientRuntimeHandoffPacket(packet = {}) {
  return {
    state: packet?.state ?? 'unknown',
    ready: packet?.ready ?? false,
    visibleStatus: packet?.visibleStatus ?? null,
    nextAction: packet?.nextAction ?? null,
    commandCount: packet?.commands?.length ?? 0,
    statusChannel: packet?.target?.statusChannel ?? null,
    idempotencyKey: packet?.target?.idempotencyKey ?? null,
    nextActionState: packet?.nextActionState ?? summarizeKernelNextActionState(packet?.nextActionState),
    lifecycleDecision: {
      state: packet?.lifecycleDecision?.state ?? 'unknown',
      selectedCommand: packet?.lifecycleDecision?.selectedCommand ?? null,
      requiresAcknowledgement: packet?.lifecycleDecision?.requiresAcknowledgement ?? false,
      confirmationState: packet?.lifecycleDecision?.confirmationState?.state ?? 'not_required',
      confirmationSatisfied: packet?.lifecycleDecision?.confirmationState?.satisfied ?? false,
      missingConfirmations: packet?.lifecycleDecision?.confirmationState?.missingAcknowledgements ?? [],
      digest: packet?.lifecycleDecision?.digest ?? null
    },
    lifecycleAdoption: {
      state: packet?.lifecycleAdoption?.state ?? 'unknown',
      ready: packet?.lifecycleAdoption?.ready ?? false,
      presentationMode: packet?.lifecycleAdoption?.presentationMode ?? null,
      selectedCommand: packet?.lifecycleAdoption?.selectedCommand?.action ?? null,
      acknowledgementCount: packet?.lifecycleAdoption?.requiredAcknowledgements?.length ?? 0,
      confirmationState: packet?.lifecycleAdoption?.confirmationState?.state ?? 'not_required',
      confirmationSatisfied: packet?.lifecycleAdoption?.confirmationState?.satisfied ?? false,
      commandCount: packet?.lifecycleAdoption?.commands?.length ?? 0,
      nextAction: packet?.lifecycleAdoption?.nextAction ?? null,
      digest: packet?.lifecycleAdoption?.digest ?? null
    },
    clientRuntimeAdoptionReceipt: summarizeClientRuntimeAdoptionReceipt(packet?.clientRuntimeAdoptionReceipt),
    clientWorkflowStatusCapsule: summarizeClientWorkflowStatusCapsule(packet?.clientWorkflowStatusCapsule),
    blockerCount: packet?.blockers?.length ?? 0,
    warningCount: packet?.warnings?.length ?? 0,
    digest: packet?.digest ?? null
  };
}

function summarizeClientRuntimeAdoptionReceipt(receipt = {}) {
  return {
    state: receipt?.state ?? 'unknown',
    ready: receipt?.ready ?? false,
    receiptKey: receipt?.receiptKey ?? null,
    digest: receipt?.digest ?? null,
    commandId: receipt?.command?.commandId ?? null,
    statusChannel: receipt?.statusChannel ?? null,
    restartSafe: receipt?.restartSemantics?.restartSafe ?? receipt?.restartSafe ?? false,
    checkpointCount: receipt?.checkpoints?.length ?? receipt?.checkpointCount ?? 0,
    nextAction: receipt?.nextAction ?? null,
    blockerCount: receipt?.blockers?.length ?? 0,
    warningCount: receipt?.warnings?.length ?? 0
  };
}

function summarizeClientWorkflowStatusCapsule(capsule = {}) {
  return {
    state: capsule?.state ?? 'unknown',
    ready: capsule?.ready ?? false,
    digest: capsule?.digest ?? null,
    statusChannel: capsule?.statusChannel ?? null,
    resumePointer: capsule?.resumePointer ?? null,
    restartSafe: capsule?.restartSafe ?? false,
    visibleStatus: capsule?.visibleStatus?.current ?? capsule?.visibleStatus ?? null,
    commandId: capsule?.command?.commandId ?? null,
    checkpointCount: capsule?.checkpoints?.length ?? capsule?.checkpointCount ?? 0,
    nextAction: capsule?.nextAction ?? null,
    blockerCount: capsule?.blockers?.length ?? capsule?.blockerCount ?? 0,
    warningCount: capsule?.warnings?.length ?? capsule?.warningCount ?? 0
  };
}

function summarizeLifecycleOperatorDecision(decision = {}) {
  return {
    state: decision?.state ?? 'unknown',
    selectedCommand: decision?.selectedCommand?.action ?? null,
    selectedCommandId: decision?.selectedCommand?.id ?? null,
    effectiveEnabled: decision?.effectiveEnabled ?? true,
    scheduleStatus: decision?.scheduleStatus ?? null,
    requiresAcknowledgement: decision?.requiresAcknowledgement === true,
    acknowledgementToken: decision?.acknowledgement?.token ?? null,
    acknowledgementReason: decision?.acknowledgement?.reason ?? null,
    confirmationState: {
      state: decision?.confirmationState?.state ?? 'not_required',
      satisfied: decision?.confirmationState?.satisfied ?? false,
      requiredAcknowledgements: decision?.confirmationState?.requiredAcknowledgements ?? [],
      missingAcknowledgements: decision?.confirmationState?.missingAcknowledgements ?? [],
      appliedConfirmationCount: decision?.confirmationState?.appliedConfirmations?.length ?? 0,
      digest: decision?.confirmationState?.digest ?? null
    },
    nextAction: decision?.nextAction ?? null,
    blockerCount: decision?.blockers?.length ?? 0,
    warningCount: decision?.warnings?.length ?? 0,
    digest: decision?.digest ?? null
  };
}

function kernelClientHandoffVisibleStatus(state) {
  return {
    blocked: 'blocked_before_handoff',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    review: 'review_before_handoff',
    ready: 'ready_for_handoff',
    waiting_for_acceptance: 'waiting_for_acceptance',
    waiting_for_runtime_state: 'waiting_for_runtime_state'
  }[state] ?? 'operator_review';
}

function kernelClientHandoffNextAction({ state, blockers, warnings, acceptance, runtimeWorkflow, statusRecovery }) {
  if (state === 'blocked') return persistedProviderAction(blockers[0]);
  if (state === 'held') return 'await_manual_release';
  if (state === 'scheduled') return 'wait_for_schedule_window';
  if (acceptance.missingAcknowledgements?.length) return 'collect_operator_acknowledgement';
  if (state === 'review') return warnings.includes('external_write_requires_confirmation')
    ? 'confirm_external_write'
    : runtimeWorkflow.nextAction ?? 'review_runtime_workflow';
  if (state === 'ready') return 'publish_kernel_client_handoff';
  return statusRecovery.nextAction ?? runtimeWorkflow.nextAction ?? 'wait_for_client_runtime_state';
}

function kernelStatusRecoveryUserStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'recovering_status_checkpoint',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function buildRuntimeWorkflowHandoff({ ir, health, analytics, semantic, readiness, acceptance }) {
  const externalWrite = ir?.semantic?.externalWrite ?? {};
  const recovery = ir?.semantic?.recovery ?? {};
  const lifecycle = ir?.lifecycle ?? {};
  const dispatchStatus = externalWrite?.dispatch?.status ?? (externalWrite?.writeRequired ? 'unknown' : 'not_required');
  const recoveryHandoff = recovery?.externalHandoff ?? {};
  const clientRuntimeState = buildPreviewClientRuntimeState({
    ir,
    externalWrite,
    recovery,
    persistedState: ir?.persistedState
  });
  const blockers = uniqueSorted([
    ...(readiness.blockingReasons ?? []),
    ...(clientRuntimeState.blockers ?? []),
    ...(externalWrite?.blockedReasons ?? []),
    ...(recovery?.blockedReasons ?? [])
  ]);
  const warnings = uniqueSorted([
    ...(readiness.warningReasons ?? []),
    ...(externalWrite?.lifecycleGate?.warnings ?? []),
    ...(recovery?.provider?.status === 'deferred' ? ['provider_handoff_deferred'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : recoveryHandoff.state === 'held'
      ? 'held'
      : recoveryHandoff.state === 'scheduled'
        ? 'scheduled'
        : acceptance.enabled && analytics.exportReady && clientRuntimeState.ready !== false
          ? 'ready'
          : readiness.state;
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.runtime-workflow`,
    state,
    nextAction: runtimeWorkflowNextAction({
      state,
      dispatchStatus,
      readiness,
      acceptance,
      externalWrite,
      recovery,
      lifecycle
    }),
    client: {
      target: ir?.handoff?.target ?? null,
      statusChannel: ir?.handoff?.statusChannel ?? null,
      idempotencyKey: ir?.handoff?.idempotencyKey ?? null,
      continuationMode: ir?.handoff?.continuationMode ?? null,
      restartToken: ir?.runtimeState?.profileRestartToken ?? ir?.runtimeState?.restartToken ?? null
    },
    lifecycle: {
      state: lifecycle.state ?? 'unknown',
      enabled: lifecycle.enabled !== false,
      scheduleStatus: lifecycle.schedule?.status ?? 'unscheduled',
      nextAction: lifecycle.nextAction ?? null,
      exportable: lifecycle.exportable !== false
    },
    externalWrite: {
      required: externalWrite?.writeRequired === true,
      status: externalWrite?.status ?? 'not_analyzed',
      dispatchStatus,
      releaseAction: externalWrite?.dispatch?.release?.nextAction ?? null,
      lifecycleGate: externalWrite?.lifecycleGate?.state ?? 'unknown'
    },
    recovery: {
      status: recovery?.status ?? 'not_analyzed',
      providerStatus: recovery?.provider?.status ?? 'unknown',
      externalHandoffState: recoveryHandoff.state ?? 'unknown',
      syncReady: recovery?.sync?.ready === true,
      snapshotDigest: recovery?.sync?.snapshotDigest ?? null
    },
    clientRuntimeState,
    acceptance: {
      state: acceptance.state,
      enabled: acceptance.enabled,
      missingAcknowledgements: acceptance.missingAcknowledgements ?? []
    },
    blockers,
    warnings,
    exportReady: analytics.exportReady === true && acceptance.enabled === true && blockers.length === 0,
    healthStatus: health?.status ?? 'unknown'
  };
}

function summarizeRuntimeWorkflowHandoff(workflow = {}) {
  return {
    state: workflow?.state ?? 'unknown',
    nextAction: workflow?.nextAction ?? null,
    exportReady: workflow?.exportReady ?? false,
    dispatchStatus: workflow?.externalWrite?.dispatchStatus ?? 'unknown',
    providerStatus: workflow?.recovery?.providerStatus ?? 'unknown',
    syncReady: workflow?.recovery?.syncReady ?? false,
    clientRuntimeState: workflow?.clientRuntimeState?.state ?? 'unknown',
    clientRuntimeReady: workflow?.clientRuntimeState?.ready ?? false,
    clientRuntimeStatus: workflow?.clientRuntimeState?.userVisibleStatus?.current ?? null,
    blockerCount: workflow?.blockers?.length ?? 0,
    warningCount: workflow?.warnings?.length ?? 0
  };
}

function buildPreviewClientRuntimeState({ ir, externalWrite, recovery, persistedState }) {
  const writeHandoff = externalWrite?.clientRuntimeHandoff ?? {};
  const adoptionReceipt = externalWrite?.clientRuntimeAdoptionReceipt
    ?? recovery?.persistedClientState?.clientRuntimeAdoptionReceipt
    ?? {};
  const persistedClient = recovery?.persistedClientState ?? {};
  const writeRequired = externalWrite?.writeRequired === true;
  const blockers = uniqueSorted([
    ...(writeHandoff.blockers ?? []),
    ...(persistedClient.blockers ?? []),
    ...(persistedState?.blockers ?? []),
    ...(adoptionReceipt.state === 'blocked' ? (adoptionReceipt.blockers ?? ['client_runtime_adoption_receipt_blocked']) : []),
    ...(!persistedState?.commandId && writeRequired ? ['missing_client_runtime_command_id'] : []),
    ...(!persistedClient.statusChannel && !writeHandoff.statusChannel && writeRequired ? ['missing_client_runtime_status_channel'] : []),
    ...(!adoptionReceipt.digest && writeRequired ? ['missing_client_runtime_adoption_receipt_digest'] : []),
    ...(adoptionReceipt.ready && adoptionReceipt.restartSafe === false ? ['client_runtime_adoption_receipt_not_restart_safe'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : persistedClient.state === 'ready' || writeHandoff.state === 'ready' || persistedState?.status === 'ready'
      ? 'ready'
      : ['held', 'scheduled'].includes(persistedClient.state)
        ? persistedClient.state
        : writeRequired
          ? 'waiting'
          : 'not_required';
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.preview-client-runtime-state`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    target: persistedClient.target ?? writeHandoff.target ?? ir?.handoff?.target ?? null,
    statusChannel: persistedClient.statusChannel ?? writeHandoff.statusChannel ?? persistedState?.statusChannel ?? ir?.handoff?.statusChannel ?? null,
    idempotencyKey: persistedClient.idempotencyKey ?? writeHandoff.idempotencyKey ?? persistedState?.idempotencyKey ?? ir?.handoff?.idempotencyKey ?? null,
    commandId: persistedClient.commandId ?? writeHandoff.providerCommand?.commandId ?? persistedState?.commandId ?? null,
    restartToken: persistedClient.restartToken ?? writeHandoff.resume?.restartToken ?? persistedState?.restartToken ?? ir?.runtimeState?.profileRestartToken ?? null,
    snapshotDigest: persistedClient.snapshotDigest ?? persistedState?.snapshotDigest ?? recovery?.sync?.snapshotDigest ?? null,
    clientRuntimeAdoptionReceipt: summarizeClientRuntimeAdoptionReceipt(adoptionReceipt),
    userVisibleStatus: {
      current: persistedClient.userVisibleStatus?.current
        ?? writeHandoff.userVisibleStatus?.pending
        ?? previewClientRuntimeStatus(state),
      completion: persistedClient.userVisibleStatus?.completion
        ?? writeHandoff.userVisibleStatus?.completion
        ?? 'mailchimp_write_synced',
      failure: persistedClient.userVisibleStatus?.failure
        ?? writeHandoff.userVisibleStatus?.failure
        ?? 'mailchimp_write_needs_review'
    },
    scope: {
      tenantId: persistedClient.scope?.tenantId ?? persistedState?.scope?.tenantId ?? ir?.handoff?.scope?.tenantId ?? null,
      workspaceId: persistedClient.scope?.workspaceId ?? persistedState?.scope?.workspaceId ?? ir?.handoff?.scope?.workspaceId ?? null,
      isolationKey: persistedClient.scope?.isolationKey ?? persistedState?.scope?.isolationKey ?? ir?.handoff?.scope?.isolationKey ?? null
    },
    blockers,
    digest: stableHash({
      programId: ir?.programId ?? null,
      operation: ir?.operation ?? null,
      state,
      commandId: persistedClient.commandId ?? persistedState?.commandId ?? null,
      idempotencyKey: persistedClient.idempotencyKey ?? persistedState?.idempotencyKey ?? null,
      snapshotDigest: persistedClient.snapshotDigest ?? persistedState?.snapshotDigest ?? null,
      adoptionReceiptDigest: adoptionReceipt.digest ?? null
    }),
    nextAction: state === 'blocked'
      ? persistedProviderAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'publish_client_runtime_state'
            : writeRequired
              ? 'wait_for_client_runtime_state'
              : 'continue_read_only'
  };
}

function summarizeClientRuntimeState(state = {}) {
  return {
    state: state?.state ?? 'unknown',
    ready: state?.ready ?? false,
    commandId: state?.commandId ?? null,
    statusChannel: state?.statusChannel ?? null,
    userVisibleStatus: state?.userVisibleStatus?.current ?? null,
    clientRuntimeAdoptionReceipt: state?.clientRuntimeAdoptionReceipt ?? summarizeClientRuntimeAdoptionReceipt(null),
    nextAction: state?.nextAction ?? null,
    blockerCount: state?.blockers?.length ?? 0
  };
}

function previewClientRuntimeStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'recovering_provider_state',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function buildPersistedProviderState(ir) {
  const externalWrite = ir?.semantic?.externalWrite ?? {};
  const recovery = ir?.semantic?.recovery ?? {};
  const providerCommand = externalWrite?.providerCommand ?? {};
  const providerService = ir?.provider ?? {};
  const writeSync = externalWrite?.sync ?? {};
  const recoveryReplay = recovery?.replay ?? {};
  const recoverySync = recovery?.sync ?? {};
  const commandId = providerCommand.commandId ?? recoveryReplay.commandId ?? recoverySync.commandId ?? null;
  const idempotencyKey = providerCommand.idempotencyKey
    ?? recoveryReplay.idempotencyKey
    ?? recoverySync.idempotencyKey
    ?? ir?.handoff?.idempotencyKey
    ?? null;
  const statusChannel = providerCommand.statusChannel
    ?? recoverySync.statusChannel
    ?? ir?.handoff?.statusChannel
    ?? null;
  const restartToken = recoveryReplay.restartToken
    ?? recoverySync.restartToken
    ?? ir?.runtimeState?.profileRestartToken
    ?? ir?.runtimeState?.restartToken
    ?? null;
  const writeRequired = externalWrite?.writeRequired === true || providerCommand.required === true || recoveryReplay.required === true;
  const providerSession = buildProviderSessionState({
    ir,
    providerCommand,
    providerService,
    recoveryReplay,
    recoverySync,
    writeSync,
    writeRequired
  });
  const syncLease = externalWrite?.providerServiceContract?.sync?.lease
    ?? providerService?.sync?.lease
    ?? null;
  const checkpointManifest = externalWrite?.providerServiceContract?.sync?.checkpointManifest
    ?? providerService?.sync?.checkpointManifest
    ?? null;
  const handoffReceipt = externalWrite?.providerServiceContract?.sync?.handoffReceipt
    ?? providerService?.sync?.handoffReceipt
    ?? null;
  const blockers = uniqueSorted([
    ...(providerCommand.blockers ?? []),
    ...(recoveryReplay.blockers ?? []),
    ...(providerService.blockers ?? []),
    ...(providerSession.blockers ?? []).map((blocker) => `session_${blocker}`),
    ...(syncLease?.blockers ?? []).map((blocker) => `sync_lease_${blocker}`),
    ...(checkpointManifest?.blockers ?? []).map((blocker) => `checkpoint_${blocker}`),
    ...(handoffReceipt?.blockers ?? []).map((blocker) => `handoff_receipt_${blocker}`),
    ...(checkpointManifest?.state === 'blocked' && writeRequired ? ['provider_checkpoint_blocked'] : []),
    ...(handoffReceipt?.state === 'blocked' && writeRequired ? ['provider_handoff_receipt_blocked'] : []),
    ...(recovery?.blockedReasons ?? []),
    ...(externalWrite?.blockedReasons ?? []),
    ...(!commandId && writeRequired ? ['missing_persisted_provider_command_id'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_persisted_provider_idempotency_key'] : []),
    ...(!statusChannel && writeRequired ? ['missing_persisted_provider_status_channel'] : [])
  ]);
  const commandState = providerCommand.state
    ?? writeSync.commandState
    ?? recoveryReplay.state
    ?? recoverySync.commandState
    ?? (writeRequired ? 'unknown' : 'not_required');
  const replayState = recoveryReplay.state ?? (writeRequired ? 'not_analyzed' : 'not_required');
  const persistedStatus = blockers.length
    ? 'blocked'
    : !writeRequired
      ? 'not_required'
      : commandState === 'held'
        ? 'held'
        : commandState === 'scheduled'
          ? 'scheduled'
          : recoverySync.ready === true || writeSync.ready === true
            ? 'ready'
            : 'waiting';
  const digestShape = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    commandId,
    idempotencyKey,
    statusChannel,
    restartToken,
    commandState,
    replayState,
    snapshotDigest: recoverySync.snapshotDigest ?? null,
    checkpointDigest: checkpointManifest?.digest ?? recoveryReplay.checkpointHash ?? recoverySync.checkpointHash ?? null
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.persisted-provider-state`,
    provider: ir?.adapter ?? providerCommand.provider ?? 'mailchimp',
    service: 'mailchimp',
    providerService: summarizeKernelProviderServiceContract(providerService),
    providerSession,
    syncLease: summarizeKernelProviderSyncLease(syncLease),
    checkpointManifest: summarizeKernelProviderCheckpointManifest(checkpointManifest),
    handoffReceipt: summarizeProviderHandoffReceipt(handoffReceipt),
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    status: persistedStatus,
    required: writeRequired,
    commandId,
    idempotencyKey,
    statusChannel,
    auditChannel: providerCommand.auditChannel ?? ir?.handoff?.audit?.channel ?? 'audit.mailchimp.runtime_handoff',
    restartToken,
    checkpointHash: recoveryReplay.checkpointHash ?? recoverySync.checkpointHash ?? null,
    snapshotDigest: recoveryReplay.snapshotDigest ?? recoverySync.snapshotDigest ?? null,
    providerCheckpointDigest: checkpointManifest?.digest ?? null,
    providerCheckpointChangedSincePrevious: checkpointManifest?.changedSincePrevious === true,
    changedSincePrevious: recoverySync.changedSincePrevious ?? false,
    commandState,
    replayState,
    safeToReplay: recoveryReplay.safeToReplay === true || providerCommand.replay?.safeToReplay === true,
    leaseSafeToReplay: syncLease?.replayPolicy === 'return_existing_by_lease_key' && syncLease?.state !== 'blocked',
    checkpointSafeToReplay: checkpointManifest?.replayMode === 'resume_from_checkpoint_digest' && checkpointManifest?.state !== 'blocked',
    handoffReceiptFresh: handoffReceipt?.fresh === true,
    handoffReceiptAcknowledged: handoffReceipt?.acknowledged === true,
    renewalRequired: providerSession.renewalRequired,
    scope: {
      tenantId: providerCommand.scope?.tenantId ?? ir?.handoff?.scope?.tenantId ?? null,
      workspaceId: providerCommand.scope?.workspaceId ?? ir?.handoff?.scope?.workspaceId ?? null,
      isolationKey: providerCommand.scope?.isolationKey ?? ir?.handoff?.scope?.isolationKey ?? null
    },
    command: {
      target: providerCommand.target ?? ir?.call?.target ?? null,
      effects: providerCommand.effects ?? [],
      payloadShape: providerCommand.payloadShape ?? null,
      releaseAction: providerCommand.releaseAction ?? externalWrite?.dispatch?.release?.nextAction ?? null
    },
    recovery: {
      nextAction: recoveryReplay.nextAction ?? recovery?.nextAction ?? null,
      handoffState: recovery?.externalHandoff?.state ?? 'unknown',
      syncReady: recoverySync.ready === true
    },
    userVisibleStatus: {
      current: recovery?.persistedClientState?.userVisibleStatus?.current
        ?? externalWrite?.clientRuntimeHandoff?.userVisibleStatus?.pending
        ?? null,
      completion: recovery?.persistedClientState?.userVisibleStatus?.completion
        ?? externalWrite?.clientRuntimeHandoff?.userVisibleStatus?.completion
        ?? null,
      failure: recovery?.persistedClientState?.userVisibleStatus?.failure
        ?? externalWrite?.clientRuntimeHandoff?.userVisibleStatus?.failure
        ?? null
    },
    blockers,
    nextAction: persistedStatus === 'blocked'
      ? persistedProviderAction(blockers[0])
      : persistedStatus === 'held'
        ? 'await_manual_release'
        : persistedStatus === 'scheduled'
          ? 'wait_for_schedule_window'
          : persistedStatus === 'ready'
            ? 'persist_mailchimp_provider_state'
            : writeRequired
              ? 'wait_for_provider_state'
              : 'continue_without_provider_state',
    digest: stableHash(digestShape)
  };
}

function summarizePersistedProviderState(state = {}) {
  return {
    status: state?.status ?? 'unknown',
    required: state?.required ?? false,
    commandId: state?.commandId ?? null,
    idempotencyKey: state?.idempotencyKey ?? null,
    replayState: state?.replayState ?? 'unknown',
    safeToReplay: state?.safeToReplay ?? false,
    renewalRequired: state?.renewalRequired ?? state?.providerSession?.renewalRequired ?? false,
    providerSession: summarizeProviderSessionState(state?.providerSession),
    syncLease: state?.syncLease ?? summarizeKernelProviderSyncLease(null),
    checkpointManifest: state?.checkpointManifest ?? summarizeKernelProviderCheckpointManifest(null),
    handoffReceipt: state?.handoffReceipt ?? summarizeProviderHandoffReceipt(null),
    syncReady: state?.recovery?.syncReady ?? false,
    userVisibleStatus: state?.userVisibleStatus?.current ?? null,
    nextAction: state?.nextAction ?? null,
    blockerCount: state?.blockers?.length ?? 0
  };
}

function summarizeKernelProviderSyncLease(lease = {}) {
  return {
    state: lease?.state ?? 'unknown',
    ready: lease?.ready ?? false,
    required: lease?.required ?? false,
    externalStateKey: lease?.externalStateKey ?? null,
    statusChannel: lease?.statusChannel ?? null,
    resource: lease?.resource ?? null,
    digest: lease?.digest ?? null,
    commandId: lease?.command?.commandId ?? null,
    renewalPolicy: lease?.renewalPolicy ?? null,
    replayPolicy: lease?.replayPolicy ?? null,
    blockerCount: lease?.blockers?.length ?? 0,
    warningCount: lease?.warnings?.length ?? 0,
    nextAction: lease?.nextAction ?? null
  };
}

function summarizeKernelProviderCheckpointManifest(manifest = {}) {
  return {
    state: manifest?.state ?? 'unknown',
    ready: manifest?.ready ?? false,
    required: manifest?.required ?? false,
    externalStateKey: manifest?.externalStateKey ?? null,
    statusChannel: manifest?.statusChannel ?? null,
    snapshotKey: manifest?.snapshotKey ?? null,
    latestDigest: manifest?.latestDigest ?? null,
    previousDigest: manifest?.previousDigest ?? null,
    digest: manifest?.digest ?? null,
    cursorDigest: manifest?.cursorDigest ?? null,
    changedSincePrevious: manifest?.changedSincePrevious === true,
    entryCount: manifest?.entries?.length ?? 0,
    restartSafeEntryCount: manifest?.entries?.filter((entry) => entry.restartSafe).length ?? 0,
    commandId: manifest?.command?.commandId ?? null,
    persistMode: manifest?.persistMode ?? null,
    replayMode: manifest?.replayMode ?? null,
    blockerCount: manifest?.blockers?.length ?? 0,
    warningCount: manifest?.warnings?.length ?? 0,
    nextAction: manifest?.nextAction ?? null
  };
}

function validatePersistedProviderState(state, ir) {
  if (!state) return [];
  const diagnostics = [];
  if (state.required && !state.commandId) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_state_missing_command_id' });
  }
  if (state.required && !state.idempotencyKey) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_state_missing_idempotency_key' });
  }
  if (state.required && !state.statusChannel) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_state_missing_status_channel' });
  }
  if (state.status === 'blocked') {
    diagnostics.push({ level: 'error', code: 'persisted_provider_state_blocked', blockers: state.blockers ?? [] });
  }
  if (state.required && ir?.semantic?.recovery?.sync?.ready === true && state.safeToReplay !== true) {
    diagnostics.push({ level: 'warning', code: 'persisted_provider_state_not_replay_safe' });
  }
  if (state.required && state.syncLease?.required && !state.syncLease?.digest) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_state_missing_sync_lease_digest' });
  }
  if (state.syncLease?.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'persisted_provider_sync_lease_blocked' });
  }
  if (state.required && state.checkpointManifest?.required && !state.checkpointManifest?.digest) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_state_missing_checkpoint_digest' });
  }
  if (state.checkpointManifest?.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'persisted_provider_checkpoint_blocked' });
  }
  if (state.required && state.checkpointManifest?.required && state.checkpointSafeToReplay !== true) {
    diagnostics.push({ level: 'warning', code: 'persisted_provider_checkpoint_not_replay_safe' });
  }
  if (state.required && state.handoffReceipt?.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'persisted_provider_handoff_receipt_blocked' });
  }
  if (state.required && state.handoffReceipt?.fresh === false) {
    diagnostics.push({ level: 'warning', code: 'persisted_provider_handoff_receipt_stale' });
  }
  if (state.required && state.handoffReceipt?.acknowledged === false) {
    diagnostics.push({ level: 'warning', code: 'persisted_provider_handoff_receipt_unacknowledged' });
  }
  diagnostics.push(...validateProviderSessionState(state.providerSession, state, ir));
  return diagnostics;
}

function buildProviderSessionState({
  ir,
  providerCommand = {},
  providerService = {},
  recoveryReplay = {},
  recoverySync = {},
  writeSync = {},
  persistedState = null,
  provider = null,
  writeRequired = null
} = {}) {
  const service = providerService?.service ?? provider?.service ?? persistedState?.service ?? 'mailchimp';
  const commandId = persistedState?.commandId
    ?? providerCommand.commandId
    ?? recoveryReplay.commandId
    ?? recoverySync.commandId
    ?? null;
  const idempotencyKey = persistedState?.idempotencyKey
    ?? providerCommand.idempotencyKey
    ?? recoveryReplay.idempotencyKey
    ?? recoverySync.idempotencyKey
    ?? ir?.handoff?.idempotencyKey
    ?? null;
  const statusChannel = persistedState?.statusChannel
    ?? providerCommand.statusChannel
    ?? recoverySync.statusChannel
    ?? providerService?.sync?.statusChannel
    ?? provider?.sync?.statusChannel
    ?? ir?.handoff?.statusChannel
    ?? null;
  const externalStateKey = providerService?.sync?.externalStateKey
    ?? providerService?.handoffState?.externalStateKey
    ?? provider?.sync?.externalStateKey
    ?? null;
  const required = writeRequired ?? (
    providerCommand.required === true
    || recoveryReplay.required === true
    || ir?.semantic?.externalWrite?.writeRequired === true
  );
  const requiredCapabilities = uniqueSorted([
    ...(providerService?.requiredCapabilities ?? []),
    ...(provider?.negotiation?.requiredCapabilities ?? []),
    ...(ir?.capabilities?.required ?? [])
  ]);
  const acceptedCapabilities = uniqueSorted([
    ...(providerService?.acceptedCapabilities ?? []),
    ...(provider?.negotiation?.allowedEffects ?? []),
    ...(ir?.capabilities?.allowedEffects ?? [])
  ]);
  const missingCapabilities = uniqueSorted([
    ...(providerService?.missingCapabilities ?? []),
    ...(provider?.negotiation?.missingEffects ?? [])
  ]);
  const capabilityVector = uniqueSorted([
    ...requiredCapabilities.map((capability) => `required:${capability}`),
    ...acceptedCapabilities.map((capability) => `accepted:${capability}`),
    ...missingCapabilities.map((capability) => `missing:${capability}`)
  ]);
  const checkpointDigest = providerService?.sync?.checkpointDigest
    ?? providerService?.handoffState?.checkpointDigest
    ?? recoverySync.checkpointDigest
    ?? writeSync.checkpointDigest
    ?? persistedState?.checkpointHash
    ?? null;
  const snapshotDigest = persistedState?.snapshotDigest
    ?? recoveryReplay.snapshotDigest
    ?? recoverySync.snapshotDigest
    ?? null;
  const renewalRequired = required && (
    missingCapabilities.length > 0
    || providerService?.state === 'review'
    || provider?.status === 'degraded'
    || provider?.sync?.status === 'degraded'
    || providerService?.sync?.cursorContract?.state === 'review'
    || provider?.sync?.cursorContract?.state === 'review'
  );
  const cursorContract = providerService?.sync?.cursorContract
    ?? provider?.sync?.cursorContract
    ?? normalizeKernelProviderCursorContract({
      input: provider,
      ir,
      externalStateKey,
      statusChannel
    });
  const blockers = uniqueSorted([
    ...(!commandId && required ? ['missing_provider_session_command_id'] : []),
    ...(!idempotencyKey && required ? ['missing_provider_session_idempotency_key'] : []),
    ...(!statusChannel && required ? ['missing_provider_session_status_channel'] : []),
    ...(!externalStateKey && required ? ['missing_provider_session_external_state_key'] : []),
    ...(cursorContract.state === 'blocked' && required ? ['provider_session_cursor_blocked'] : []),
    ...missingCapabilities.map((capability) => `missing_capability:${capability}`)
  ]);
  const state = !required
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : renewalRequired
        ? 'renewal_required'
        : 'ready';
  const digestShape = {
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    service,
    commandId,
    idempotencyKey,
    statusChannel,
    externalStateKey,
    cursorDigest: cursorContract.digest,
    checkpointDigest,
    snapshotDigest,
    capabilityVector,
    state
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.provider-session`,
    provider: ir?.adapter ?? providerCommand.provider ?? provider?.provider ?? 'mailchimp',
    service,
    programId: ir?.programId ?? null,
    operation: ir?.operation ?? null,
    state,
    ready: state === 'ready' || state === 'not_required',
    required,
    commandId,
    idempotencyKey,
    statusChannel,
    externalStateKey,
    cursorContract,
    checkpointDigest,
    snapshotDigest,
    requiredCapabilities,
    acceptedCapabilities,
    missingCapabilities,
    capabilityVector,
    renewalRequired,
    resumePolicy: renewalRequired ? 'renegotiate_then_resume' : 'resume_with_persisted_session',
    conflictPolicy: 'return_existing_by_idempotency_key',
    blockers,
    nextAction: state === 'blocked'
      ? persistedProviderAction(blockers[0])
      : renewalRequired
        ? 'renegotiate_mailchimp_provider_session'
        : required
          ? 'persist_mailchimp_provider_session'
          : 'continue_without_provider_session',
    digest: stableHash(digestShape)
  };
}

function summarizeProviderSessionState(session = {}) {
  return {
    state: session?.state ?? 'unknown',
    ready: session?.ready ?? false,
    required: session?.required ?? false,
    commandId: session?.commandId ?? null,
    externalStateKey: session?.externalStateKey ?? null,
    renewalRequired: session?.renewalRequired ?? false,
    acceptedCapabilityCount: session?.acceptedCapabilities?.length ?? 0,
    missingCapabilityCount: session?.missingCapabilities?.length ?? 0,
    resumePolicy: session?.resumePolicy ?? null,
    nextAction: session?.nextAction ?? null,
    blockerCount: session?.blockers?.length ?? 0,
    digest: session?.digest ?? null
  };
}

function summarizeProviderHandoffReceipt(receipt = {}) {
  return {
    state: receipt?.state ?? 'unknown',
    ready: receipt?.ready ?? false,
    required: receipt?.required ?? false,
    acknowledged: receipt?.acknowledged ?? false,
    fresh: receipt?.fresh ?? false,
    expectedDigest: receipt?.expectedDigest ?? null,
    receiptDigest: receipt?.receiptDigest ?? null,
    statusChannel: receipt?.statusChannel ?? null,
    externalStateKey: receipt?.externalStateKey ?? null,
    commandId: receipt?.command?.commandId ?? null,
    nextAction: receipt?.nextAction ?? null,
    blockerCount: receipt?.blockers?.length ?? 0,
    warningCount: receipt?.warnings?.length ?? 0,
    digest: receipt?.digest ?? null
  };
}

function validateProviderSessionState(session, persistedState, ir) {
  if (!persistedState?.required && !session) return [];
  const diagnostics = [];
  if (!session) return [{ level: 'error', code: 'persisted_provider_session_missing' }];
  if (persistedState?.required && session.required !== true) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_session_not_required' });
  }
  if (session.required && !session.commandId) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_session_missing_command_id' });
  }
  if (session.required && !session.idempotencyKey) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_session_missing_idempotency_key' });
  }
  if (session.required && !session.statusChannel) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_session_missing_status_channel' });
  }
  if (session.required && !session.externalStateKey) {
    diagnostics.push({ level: 'error', code: 'persisted_provider_session_missing_external_state_key' });
  }
  if (session.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'persisted_provider_session_blocked', blockers: session.blockers ?? [] });
  }
  if (session.renewalRequired && ir?.provider?.ready === true) {
    diagnostics.push({
      level: 'warning',
      code: 'persisted_provider_session_requires_renewal',
      missingCapabilities: session.missingCapabilities ?? []
    });
  }
  return diagnostics;
}

function persistedProviderAction(blocker) {
  if (String(blocker).includes('command_id')) return 'persist_provider_command_id';
  if (String(blocker).includes('idempotency')) return 'persist_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'persist_provider_status_channel';
  if (String(blocker).includes('restart')) return 'persist_restart_token';
  return 'repair_persisted_provider_state';
}

function providerHandoffReceiptAction(blocker) {
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('external_state_key')) return 'bind_provider_external_state_key';
  if (String(blocker).includes('sync_lease')) return 'repair_kernel_provider_sync_lease';
  if (String(blocker).includes('cursor')) return 'repair_kernel_provider_cursor';
  if (String(blocker).includes('denied_effect')) return 'resolve_provider_denied_effect';
  return 'repair_provider_handoff_receipt';
}

function runtimeWorkflowNextAction({ state, dispatchStatus, readiness, acceptance, externalWrite, recovery, lifecycle }) {
  if (state === 'blocked') {
    return recovery?.nextAction
      ?? externalWrite?.nextAction
      ?? readiness.primaryAction
      ?? 'resolve_runtime_workflow_blockers';
  }
  if (state === 'held') return 'await_manual_release';
  if (state === 'scheduled') return 'wait_for_schedule_window';
  if (acceptance.missingAcknowledgements?.length) return 'collect_operator_acknowledgement';
  if (dispatchStatus === 'ready') return 'publish_client_handoff';
  if (lifecycle.schedule?.status === 'scheduled') return 'wait_for_schedule_window';
  return acceptance.nextAction ?? lifecycle.nextAction ?? 'enqueue_kernel_job';
}

function validateAcceptanceState(acceptance = {}) {
  if (!acceptance) return [];
  const diagnostics = [];
  if (acceptance.enabled && acceptance.missingAcknowledgements?.length) {
    diagnostics.push({
      level: 'error',
      code: 'acceptance_enabled_with_missing_acknowledgements',
      missingAcknowledgements: acceptance.missingAcknowledgements
    });
  }
  if (acceptance.state === 'accepted' && acceptance.enabled !== true) {
    diagnostics.push({ level: 'error', code: 'acceptance_state_not_enabled' });
  }
  return diagnostics;
}

function validateRouteExportPreview(routeExport = {}, ir = {}) {
  if (!ir?.semantic?.externalWrite?.writeRequired && !routeExport) return [];
  const diagnostics = [];
  if (!routeExport) return [{ level: 'error', code: 'missing_route_export_preview' }];
  if (ir?.semantic?.externalWrite?.writeRequired && routeExport.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'route_export_preview_not_write_required' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && !routeExport.publishCommandId) {
    diagnostics.push({ level: 'error', code: 'route_export_preview_missing_publish_command' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && !routeExport.analyticsPublication?.publishCommandId) {
    diagnostics.push({ level: 'error', code: 'route_export_preview_missing_analytics_publication_command' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && routeExport.analyticsPublication?.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'route_export_preview_analytics_publication_blocked' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && !routeExport.timelinePublication?.publishCommandId) {
    diagnostics.push({ level: 'error', code: 'route_export_preview_missing_timeline_publication_command' });
  }
  if (ir?.semantic?.externalWrite?.writeRequired && routeExport.timelinePublication?.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'route_export_preview_timeline_publication_blocked' });
  }
  if (routeExport.ready && routeExport.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'route_export_preview_ready_with_blockers', blockers: routeExport.blockers });
  }
  if (routeExport.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'route_export_preview_blocked', blockers: routeExport.blockers ?? [] });
  }
  if (routeExport.changedSinceAcceptedSnapshot && routeExport.ready) {
    diagnostics.push({ level: 'warning', code: 'route_export_preview_changed_since_acceptance' });
  }
  return diagnostics;
}

function buildRequiredAcknowledgements({ semantic, lifecycle }) {
  return uniqueSorted([
    ...(semantic.externalWriteRequired ? ['external_write'] : []),
    ...(semantic.recoveryStatus === 'degraded' ? ['recovery_warning'] : []),
    ...(lifecycle?.schedule?.status === 'manual_hold' ? ['manual_release'] : []),
    ...(lifecycle?.settings?.allowDegradedHandoff === false ? ['strict_handoff'] : []),
    ...(lifecycle?.confirmationState?.missingAcknowledgements ?? [])
  ]);
}

function normalizeAcknowledgements(value) {
  return uniqueSorted(asArray(value).map((entry) => typeof entry === 'string' ? entry : entry?.code));
}

function readinessPrimaryAction({ state, lifecycle, semantic }) {
  if (state === 'blocked') return semantic.recoveryNextAction ?? semantic.externalWriteNextAction ?? 'operator_review';
  if (lifecycle?.schedule?.status === 'manual_hold') return 'await_manual_release';
  if (lifecycle?.schedule?.status === 'scheduled') return 'wait_for_schedule_window';
  if (semantic.externalWriteRequired) return 'confirm_write_handoff';
  return 'enqueue_kernel_job';
}

function acceptanceNextAction({ enabled, blocked, missingAcknowledgements, analytics }) {
  if (enabled) return 'publish_handoff_acceptance';
  if (blocked) return 'resolve_blocking_preview_issues';
  if (missingAcknowledgements.length) return 'collect_operator_acknowledgement';
  if (analytics?.exportReady !== true) return 'wait_for_export_ready';
  return 'operator_review';
}

function previewSubtitle({ health, readiness, semantic }) {
  if (readiness.state === 'blocked') return 'Resolve blocking issues before Mailchimp handoff.';
  if (readiness.state === 'review' && semantic.externalWriteRequired) return 'External write is ready for operator confirmation.';
  if (readiness.state === 'review') return 'Review warnings before accepting the handoff.';
  if (health?.status === 'healthy') return 'Ready to enqueue with deterministic recovery metadata.';
  return 'Ready with recovery context attached.';
}

function labelForNextStep(reason) {
  return {
    denied_effects_present: 'Resolve denied Mailchimp effects',
    missing_verifier_claims: 'Collect required verifier claims',
    lifecycle_not_exportable: 'Repair lifecycle controls',
    semantic_contract_blocked: 'Repair semantic contract',
    external_write_requires_confirmation: 'Confirm external write handoff',
    manual_release_required: 'Release manual lifecycle hold',
    scheduled_release_window: 'Wait for schedule window',
    duplicate_continuation_commands: 'Review duplicate continuation commands',
    ready_for_handoff: 'Ready for Mailchimp runtime handoff'
  }[reason] ?? actionForDiagnostic(reason);
}

function labelForAcknowledgement(acknowledgement) {
  return {
    external_write: 'Acknowledge Mailchimp external write',
    recovery_warning: 'Acknowledge recovery warning',
    manual_release: 'Acknowledge manual lifecycle release',
    strict_handoff: 'Acknowledge strict handoff settings'
  }[acknowledgement] ?? acknowledgement;
}

function normalizeHistorySnapshot(snapshot = {}) {
  if (!snapshot.programId && !snapshot.digest) return null;
  return {
    sequence: Number(snapshot.sequence ?? 0),
    programId: snapshot.programId ?? null,
    operation: snapshot.operation ?? null,
    status: snapshot.status ?? 'unknown',
    health: snapshot.health ?? 'unknown',
    idempotencyKey: snapshot.idempotencyKey ?? null,
    restartToken: snapshot.restartToken ?? null,
    profileRestartToken: snapshot.profileRestartToken ?? null,
    counters: stableClone(snapshot.counters ?? {}),
    digest: snapshot.digest ?? stableHash(snapshot)
  };
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function deterministicProgramId(operation, input) {
  return `aios:${operation}:${stableHash(input)}`;
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

function stableHash(value) {
  const serialized = JSON.stringify(stableClone(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function asList(value) {
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  if (value == null || value === false) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
