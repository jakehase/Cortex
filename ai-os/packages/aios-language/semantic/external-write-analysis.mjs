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
  const boundaryPermissionPosture = buildBoundaryPermissionPosture({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    scope,
    permissionBoundary,
    kernelCall,
    writeEffects,
    boundaryTicket,
    boundaryAuditHandoff,
    boundaryRecoveryGuard
  });
  const boundaryDecisionReceipt = buildBoundaryDecisionReceipt({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    writeEffects,
    boundaryTicket,
    boundaryAuditHandoff,
    boundaryRecoveryGuard,
    boundaryPermissionPosture,
    kernelCall
  });
  const boundaryReleaseGate = buildBoundaryReleaseGate({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    writeEffects,
    boundaryTicket,
    boundaryAuditHandoff,
    boundaryRecoveryGuard,
    boundaryPermissionPosture,
    boundaryDecisionReceipt,
    kernelCall
  });
  const workspacePermissionHandoff = buildWorkspacePermissionHandoff({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    scope,
    writeEffects,
    boundaryTicket,
    boundaryAuditHandoff,
    boundaryRecoveryGuard,
    boundaryPermissionPosture,
    boundaryDecisionReceipt,
    boundaryReleaseGate,
    kernelCall
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
  const clientRuntimeAdoption = buildClientRuntimeAdoptionContract({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    lifecycleGate,
    writeEffects,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    kernelCall
  });
  const clientRuntimeAdoptionReceipt = buildClientRuntimeAdoptionReceipt({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    route,
    writeEffects,
    providerCommand,
    syncMetadata,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    clientRuntimeAdoption,
    lifecycleGate,
    boundaryTicket,
    boundaryAuditHandoff,
    providerHealth,
    kernelCall
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
    ...validateBoundaryPermissionPosture(boundaryPermissionPosture, writeEffects),
    ...validateBoundaryDecisionReceipt(boundaryDecisionReceipt, writeEffects),
    ...validateBoundaryReleaseGate(boundaryReleaseGate, writeEffects),
    ...validateWorkspacePermissionHandoff(workspacePermissionHandoff, writeEffects),
    ...validateProviderCommand(providerCommand, writeEffects),
    ...validateClientRuntimeHandoff(clientRuntimeHandoff, writeEffects),
    ...validateClientRequestSnapshot(clientRequestSnapshot, writeEffects),
    ...validateClientRuntimeAdoptionContract(clientRuntimeAdoption, writeEffects),
    ...validateClientRuntimeAdoptionReceipt(clientRuntimeAdoptionReceipt, writeEffects)
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
    clientRuntimeAdoptionReceipt,
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
    clientRuntimeAdoption,
    clientRuntimeAdoptionReceipt,
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
  const providerCommandLedger = buildProviderCommandLedger({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    providerCommand,
    persistedStatus,
    statusJournal,
    clientRequestSnapshot,
    boundaryTicket,
    boundaryAuditHandoff,
    providerHealth,
    kernelCall
  });
  const persistenceEnvelope = buildExternalWritePersistenceEnvelope({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    lifecycleGate,
    providerCommand,
    persistedStatus,
    statusJournal,
    providerCommandLedger,
    clientRequestSnapshot,
    clientRuntimeAdoptionReceipt,
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
    providerServiceContract,
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
  const operationalIncident = buildExternalWriteOperationalIncident({
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
    operationalHealth,
    diagnostics: baseDiagnostics,
    kernelCall
  });
  const recoveryRunbook = buildExternalWriteRecoveryRunbook({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    lifecycleGate,
    providerHealth,
    providerCommand,
    syncMetadata,
    persistedStatus,
    statusJournal,
    providerCommandLedger,
    persistenceEnvelope,
    replayManifest,
    operatorReadiness,
    operationalHealth,
    operationalIncident,
    kernelCall
  });
  const providerHandoffHealth = buildProviderHandoffHealthSummary({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    providerHealth,
    providerServiceContract,
    providerCommand,
    syncMetadata,
    providerCommandLedger,
    exportLedger,
    replayManifest,
    operationalHealth,
    operationalIncident,
    recoveryRunbook,
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
    operationalIncident,
    providerHandoffHealth,
    boundaryTicket,
    boundaryAuditHandoff,
    claimCoverage,
    diagnostics: baseDiagnostics,
    kernelCall
  });
  const analyticsPublication = buildExternalWriteAnalyticsPublicationContract({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    analyticsExport,
    acceptancePacket,
    operatorReadiness,
    operationalHealth,
    operationalIncident,
    boundaryDecisionReceipt,
    kernelCall
  });
  const timelinePublication = buildExternalWriteTimelinePublicationContract({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    analyticsExport,
    analyticsPublication,
    exportLedger,
    replayManifest,
    operatorReadiness,
    operationalHealth,
    operationalIncident,
    kernelCall
  });
  const routeExportState = buildExternalWriteRouteExportState({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    providerCommand,
    clientRequestSnapshot,
    acceptancePacket,
    exportLedger,
    replayManifest,
    operatorReadiness,
    operationalHealth,
    analyticsExport,
    analyticsPublication,
    timelinePublication,
    kernelCall
  });
  const resumeCursor = buildExternalWriteResumeCursor({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    providerCommand,
    persistedStatus,
    statusJournal,
    providerCommandLedger,
    persistenceEnvelope,
    exportLedger,
    replayManifest,
    analyticsExport,
    routeExportState,
    clientRequestSnapshot,
    clientRuntimeAdoptionReceipt,
    operationalHealth,
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
    routeExportState,
    boundaryTicket,
    boundaryAuditHandoff,
    boundaryRecoveryGuard,
    operationalIncident,
    kernelCall
  });
  const operatorHandoffManifest = buildExternalWriteOperatorHandoffManifest({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    lifecycleGate,
    providerHealth,
    providerCommand,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    clientRuntimeAdoption,
    clientRuntimeAdoptionReceipt,
    acceptancePacket,
    persistedStatus,
    statusJournal,
    providerCommandLedger,
    exportLedger,
    replayManifest,
    operatorReadiness,
    operationalHealth,
    analyticsExport,
    routeExportState,
    statusHandoff,
    boundaryTicket,
    boundaryAuditHandoff,
    boundaryRecoveryGuard,
    boundaryPermissionPosture,
    kernelCall
  });
  const operatorDecision = buildExternalWriteOperatorDecisionContract({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    analyticsDecision: analyticsExport?.operatorDecision,
    operatorHandoffManifest,
    acceptancePacket,
    clientRuntimeAdoptionReceipt,
    statusHandoff,
    routeExportState,
    boundaryDecisionReceipt,
    kernelCall
  });
  const acceptanceCheckpointBundle = buildExternalWriteAcceptanceCheckpointBundle({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    acceptancePacket,
    operatorReadiness,
    operatorHandoffManifest,
    operatorDecision,
    statusHandoff,
    routeExportState,
    resumeCursor,
    boundaryDecisionReceipt,
    boundaryReleaseGate,
    clientRuntimeAdoptionReceipt,
    analyticsPublication,
    kernelCall
  });
  const acceptancePreview = buildExternalWriteAcceptancePreview({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    acceptancePacket,
    acceptanceCheckpointBundle,
    operatorReadiness,
    operatorHandoffManifest,
    operatorDecision,
    statusHandoff,
    routeExportState,
    clientRuntimeAdoption,
    clientRuntimeAdoptionReceipt,
    boundaryDecisionReceipt,
    boundaryReleaseGate,
    providerHealth,
    providerServiceContract,
    kernelCall
  });
  const clientWorkflowStatusCapsule = buildClientWorkflowStatusCapsule({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    clientRequestSnapshot,
    clientRuntimeAdoption,
    clientRuntimeAdoptionReceipt,
    statusHandoff,
    persistedStatus,
    statusJournal,
    resumeCursor,
    acceptanceCheckpointBundle,
    operatorReadiness,
    operationalHealth,
    providerHealth,
    kernelCall
  });
  const clientWorkflowAdoptionLease = buildClientWorkflowAdoptionLease({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    clientRequestSnapshot,
    clientRuntimeAdoption,
    clientRuntimeAdoptionReceipt,
    clientWorkflowStatusCapsule,
    statusHandoff,
    resumeCursor,
    acceptanceCheckpointBundle,
    providerHealth,
    kernelCall
  });
  const stateRecoveryCapsule = buildExternalWriteStateRecoveryCapsule({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    providerCommand,
    persistedStatus,
    statusJournal,
    providerCommandLedger,
    persistenceEnvelope,
    resumeCursor,
    statusHandoff,
    clientWorkflowStatusCapsule,
    clientWorkflowAdoptionLease,
    acceptanceCheckpointBundle,
    operationalHealth,
    operationalIncident,
    recoveryRunbook,
    kernelCall
  });
  const stateIntegrityManifest = buildExternalWriteStateIntegrityManifest({
    programId: programId ?? kernelCall?.programId ?? null,
    operation: operation ?? kernelCall?.operation ?? null,
    status,
    writeEffects,
    route,
    persistedStatus,
    statusJournal,
    providerCommandLedger,
    persistenceEnvelope,
    resumeCursor,
    statusHandoff,
    stateRecoveryCapsule,
    acceptanceCheckpointBundle,
    clientRuntimeAdoptionReceipt,
    boundaryTicket,
    boundaryAuditHandoff,
    kernelCall
  });
  const diagnostics = [
    ...baseDiagnostics,
    ...validateExternalWriteAcceptancePacket(acceptancePacket, writeEffects),
    ...validatePersistedExternalWriteStatus(persistedStatus, writeEffects),
    ...validateExternalWriteStatusJournal(statusJournal, writeEffects),
    ...validateProviderCommandLedger(providerCommandLedger, writeEffects),
    ...validateExternalWritePersistenceEnvelope(persistenceEnvelope, writeEffects),
    ...validateExternalWriteExportLedger(exportLedger, writeEffects),
    ...validateExternalWriteReplayManifest(replayManifest, writeEffects),
    ...validateExternalWriteOperatorReadiness(operatorReadiness, writeEffects),
    ...validateExternalWriteOperationalHealth(operationalHealth, writeEffects),
    ...validateExternalWriteOperationalIncident(operationalIncident, operationalHealth, writeEffects),
    ...validateExternalWriteRecoveryRunbook(recoveryRunbook, operationalIncident, writeEffects),
    ...validateProviderHandoffHealthSummary(providerHandoffHealth, writeEffects),
    ...validateExternalWriteAnalyticsExport(analyticsExport, writeEffects),
    ...validateExternalWriteAnalyticsPublicationContract(analyticsPublication, writeEffects),
    ...validateExternalWriteTimelinePublicationContract(timelinePublication, writeEffects),
    ...validateExternalWriteRouteExportState(routeExportState, writeEffects),
    ...validateExternalWriteResumeCursor(resumeCursor, writeEffects),
    ...validateExternalWriteStatusHandoff(statusHandoff, writeEffects),
    ...validateClientWorkflowStatusCapsule(clientWorkflowStatusCapsule, writeEffects),
    ...validateClientWorkflowAdoptionLease(clientWorkflowAdoptionLease, writeEffects),
    ...validateExternalWriteStateRecoveryCapsule(stateRecoveryCapsule, writeEffects),
    ...validateExternalWriteStateIntegrityManifest(stateIntegrityManifest, writeEffects),
    ...validateClientRuntimeAdoptionReceipt(clientRuntimeAdoptionReceipt, writeEffects),
    ...validateExternalWriteOperatorHandoffManifest(operatorHandoffManifest, writeEffects),
    ...validateExternalWriteOperatorDecisionContract(operatorDecision, writeEffects),
    ...validateExternalWriteAcceptanceCheckpointBundle(acceptanceCheckpointBundle, writeEffects),
    ...validateExternalWriteAcceptancePreview(acceptancePreview, writeEffects)
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
      boundaryPermissionPosture,
    boundaryDecisionReceipt,
    boundaryReleaseGate,
      workspacePermissionHandoff,
    lifecycleGate,
      lifecycleControls,
      providerHealth,
      providerServiceContract,
      dispatch,
      providerCommand,
      sync: syncMetadata,
      clientRuntimeHandoff,
      clientRequestSnapshot,
      clientRuntimeAdoption,
      clientRuntimeAdoptionReceipt,
      acceptancePacket,
      persistedStatus,
      statusJournal,
      providerCommandLedger,
      persistenceEnvelope,
      exportLedger,
      replayManifest,
      operatorReadiness,
      operationalHealth,
      operationalIncident,
      recoveryRunbook,
      providerHandoffHealth,
      analyticsExport,
      analyticsPublication,
      timelinePublication,
      routeExportState,
      resumeCursor,
      statusHandoff,
      clientWorkflowStatusCapsule,
      clientWorkflowAdoptionLease,
      stateRecoveryCapsule,
      stateIntegrityManifest,
      operatorHandoffManifest,
      operatorDecision,
      acceptanceCheckpointBundle,
      acceptancePreview,
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
        lifecycleCommandQueueReadyCount: lifecycleControls.commandQueue?.ready ? 1 : 0,
        lifecycleCommandQueuePendingCount: lifecycleControls.commandQueue?.pending?.length ?? 0,
        lifecycleCommandQueueBlockedCount: lifecycleControls.commandQueue?.blocked?.length ?? 0,
        lifecycleCommandQueueMissingAcknowledgementCount: lifecycleControls.commandQueue?.missingAcknowledgements?.length ?? 0,
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
        providerSessionReadyCount: providerServiceContract.providerSession?.ready ? 1 : 0,
        providerSessionRenewalCount: providerServiceContract.providerSession?.renewalRequired ? 1 : 0,
        providerSessionBlockerCount: providerServiceContract.providerSession?.blockers?.length ?? 0,
        providerSessionCapabilityCount: providerServiceContract.providerSession?.capabilityVector?.length ?? 0,
        providerHandoffReceiptReadyCount: providerServiceContract.handoffReceipt?.ready ? 1 : 0,
        providerHandoffReceiptFreshCount: providerServiceContract.handoffReceipt?.fresh ? 1 : 0,
        providerHandoffReceiptAcknowledgedCount: providerServiceContract.handoffReceipt?.acknowledged ? 1 : 0,
        providerHandoffReceiptBlockerCount: providerServiceContract.handoffReceipt?.blockers?.length ?? 0,
        providerHandoffReceiptWarningCount: providerServiceContract.handoffReceipt?.warnings?.length ?? 0,
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
        boundaryPermissionPostureReadyCount: boundaryPermissionPosture.ready ? 1 : 0,
        boundaryPermissionPostureBlockerCount: boundaryPermissionPosture.blockers.length,
        boundaryPermissionPostureWarningCount: boundaryPermissionPosture.warnings.length,
        boundaryPermissionPostureEscalationCount: boundaryPermissionPosture.escalations.length,
        boundaryPermissionPostureRequiredAcknowledgementCount: boundaryPermissionPosture.requiredAcknowledgements.length,
        boundaryPermissionPostureMissingAcknowledgementCount: boundaryPermissionPosture.missingAcknowledgements.length,
        boundaryPermissionPostureAllowedEffectCount: boundaryPermissionPosture.effectAccess.allowed.length,
        boundaryPermissionPostureDeniedEffectCount: boundaryPermissionPosture.effectAccess.denied.length,
        boundaryPermissionPostureMissingAllowedEffectCount: boundaryPermissionPosture.effectAccess.missingAllowed.length,
        boundaryDecisionReceiptReadyCount: boundaryDecisionReceipt.ready ? 1 : 0,
        boundaryDecisionReceiptBlockerCount: boundaryDecisionReceipt.blockers.length,
        boundaryDecisionReceiptWarningCount: boundaryDecisionReceipt.warnings.length,
        boundaryDecisionReceiptReleaseCount: boundaryDecisionReceipt.release?.allowed ? 1 : 0,
        boundaryDecisionReceiptEvidenceCount: boundaryDecisionReceipt.evidence.length,
        boundaryReleaseGateReadyCount: boundaryReleaseGate.ready ? 1 : 0,
        boundaryReleaseGateReleaseCount: boundaryReleaseGate.releaseAllowed ? 1 : 0,
        boundaryReleaseGateBlockerCount: boundaryReleaseGate.blockers.length,
        boundaryReleaseGateWarningCount: boundaryReleaseGate.warnings.length,
        boundaryReleaseGateRequiredAcknowledgementCount: boundaryReleaseGate.requiredAcknowledgements.length,
        boundaryReleaseGateMissingAcknowledgementCount: boundaryReleaseGate.missingAcknowledgements.length,
        workspacePermissionHandoffReadyCount: workspacePermissionHandoff.ready ? 1 : 0,
        workspacePermissionHandoffReleaseCount: workspacePermissionHandoff.releaseAllowed ? 1 : 0,
        workspacePermissionHandoffScopeAlignedCount: workspacePermissionHandoff.scopeAlignment.aligned ? 1 : 0,
        workspacePermissionHandoffCommandCount: workspacePermissionHandoff.commands.length,
        workspacePermissionHandoffMissingAcknowledgementCount: workspacePermissionHandoff.missingAcknowledgements.length,
        workspacePermissionHandoffBlockerCount: workspacePermissionHandoff.blockers.length,
        workspacePermissionHandoffWarningCount: workspacePermissionHandoff.warnings.length,
        observedTruthBoundaryCount: claimCoverage.truthBoundaries.filter((boundary) => boundary.status === 'observed').length,
        providerCommandCount: providerCommand.required ? 1 : 0,
        providerCommandBlockerCount: providerCommand.blockers.length,
        syncReadyCount: syncMetadata.ready ? 1 : 0,
        clientRuntimeHandoffReadyCount: clientRuntimeHandoff.ready ? 1 : 0,
        clientRuntimeHandoffBlockerCount: clientRuntimeHandoff.blockers.length,
        clientRequestSnapshotReadyCount: clientRequestSnapshot.ready ? 1 : 0,
        clientRequestSnapshotBlockerCount: clientRequestSnapshot.blockers.length,
        clientRequestSnapshotCommandCount: clientRequestSnapshot.commands.length,
        clientRuntimeAdoptionReadyCount: clientRuntimeAdoption.ready ? 1 : 0,
        clientRuntimeAdoptionBlockerCount: clientRuntimeAdoption.blockers.length,
        clientRuntimeAdoptionCommandCount: clientRuntimeAdoption.commands.length,
        clientRuntimeAdoptionAcknowledgementCount: clientRuntimeAdoption.requiredAcknowledgements.length,
        clientRuntimeAdoptionReceiptReadyCount: clientRuntimeAdoptionReceipt.ready ? 1 : 0,
        clientRuntimeAdoptionReceiptBlockerCount: clientRuntimeAdoptionReceipt.blockers.length,
        clientRuntimeAdoptionReceiptWarningCount: clientRuntimeAdoptionReceipt.warnings.length,
        clientRuntimeAdoptionReceiptCheckpointCount: clientRuntimeAdoptionReceipt.checkpoints.length,
        previewNextStepCount: acceptancePacket.nextSteps.length,
        acceptanceBlockerCount: acceptancePacket.blockers.length,
        acceptanceWarningCount: acceptancePacket.warnings.length,
        persistedStatusReadyCount: persistedStatus.ready ? 1 : 0,
        persistedStatusBlockerCount: persistedStatus.blockers.length,
        statusJournalReadyCount: statusJournal.ready ? 1 : 0,
        statusJournalCheckpointCount: statusJournal.checkpoints.length,
        statusJournalCommandCount: statusJournal.commands.length,
        statusJournalBlockerCount: statusJournal.blockers.length,
        providerCommandLedgerReadyCount: providerCommandLedger.ready ? 1 : 0,
        providerCommandLedgerEntryCount: providerCommandLedger.entries.length,
        providerCommandLedgerDuplicateSafeCount: providerCommandLedger.duplicateSafe ? 1 : 0,
        providerCommandLedgerReplayableCount: providerCommandLedger.replayable ? 1 : 0,
        providerCommandLedgerBlockerCount: providerCommandLedger.blockers.length,
        persistenceEnvelopeReadyCount: persistenceEnvelope.ready ? 1 : 0,
        persistenceEnvelopeRestartSafeCount: persistenceEnvelope.restartSemantics.restartSafe ? 1 : 0,
        persistenceEnvelopeRecoveryHintCount: persistenceEnvelope.recoveryHints.length,
        persistenceEnvelopeBlockerCount: persistenceEnvelope.blockers.length,
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
        operationalIncidentOpenCount: operationalIncident.open ? 1 : 0,
        operationalIncidentRetryableCount: operationalIncident.retryable ? 1 : 0,
        operationalIncidentTerminalCount: operationalIncident.terminal ? 1 : 0,
        operationalIncidentEvidenceCount: operationalIncident.evidence.length,
        recoveryRunbookReadyCount: recoveryRunbook.ready ? 1 : 0,
        recoveryRunbookStepCount: recoveryRunbook.steps.length,
        recoveryRunbookExecutableStepCount: recoveryRunbook.steps.filter((step) => step.executable).length,
        recoveryRunbookBlockerCount: recoveryRunbook.blockers.length,
        recoveryRunbookWarningCount: recoveryRunbook.warnings.length,
        recoveryRunbookRetryAfterMs: recoveryRunbook.retryAfterMs ?? 0,
        providerHandoffHealthReadyCount: providerHandoffHealth.ready ? 1 : 0,
        providerHandoffHealthDegradedCount: providerHandoffHealth.degraded ? 1 : 0,
        providerHandoffHealthRetryableCount: providerHandoffHealth.retryable ? 1 : 0,
        providerHandoffHealthTerminalCount: providerHandoffHealth.terminal ? 1 : 0,
        providerHandoffHealthBlockerCount: providerHandoffHealth.blockers.length,
        providerHandoffHealthWarningCount: providerHandoffHealth.warnings.length,
        providerHandoffHealthDependencyCount: providerHandoffHealth.dependencies.length,
        providerHandoffHealthFailedDependencyCount: providerHandoffHealth.dependencies.filter((dependency) => dependency.ready === false).length,
        analyticsExportReadyCount: analyticsExport.ready ? 1 : 0,
        analyticsExportSnapshotCount: analyticsExport.historySnapshots.length,
        analyticsExportTimelineEventCount: analyticsExport.timeline.length,
        analyticsExportFailedPhaseCount: analyticsExport.counters.failedPhaseCount,
        analyticsExportDegradedPhaseCount: analyticsExport.counters.degradedPhaseCount,
        analyticsPublicationReadyCount: analyticsPublication.ready ? 1 : 0,
        analyticsPublicationPublisherCount: analyticsPublication.publishers.length,
        analyticsPublicationTargetCount: analyticsPublication.targets.length,
        analyticsPublicationAcknowledgementCount: analyticsPublication.acknowledgements.required.length,
        analyticsPublicationMissingAcknowledgementCount: analyticsPublication.acknowledgements.missing.length,
        analyticsPublicationFreshnessWarningCount: analyticsPublication.freshness.warnings.length,
        analyticsPublicationBlockerCount: analyticsPublication.blockers.length,
        timelinePublicationReadyCount: timelinePublication.ready ? 1 : 0,
        timelinePublicationEventCount: timelinePublication.events.length,
        timelinePublicationSnapshotCount: timelinePublication.snapshots.length,
        timelinePublicationDriftCount: timelinePublication.drift.changedSinceAcceptedSnapshot ? 1 : 0,
        timelinePublicationBlockerCount: timelinePublication.blockers.length,
        timelinePublicationWarningCount: timelinePublication.warnings.length,
        routeExportReadyCount: routeExportState.ready ? 1 : 0,
        routeExportChangedCount: routeExportState.changedSinceAcceptedSnapshot ? 1 : 0,
        routeExportSnapshotCount: routeExportState.snapshots.length,
        routeExportBlockerCount: routeExportState.blockers.length,
        routeExportWarningCount: routeExportState.warnings.length,
        statusHandoffReadyCount: statusHandoff.ready ? 1 : 0,
        statusHandoffCheckpointCount: statusHandoff.checkpoints.length,
        statusHandoffBlockerCount: statusHandoff.blockers.length,
        statusHandoffWarningCount: statusHandoff.warnings.length,
        clientWorkflowStatusCapsuleReadyCount: clientWorkflowStatusCapsule.ready ? 1 : 0,
        clientWorkflowStatusCapsuleRestartSafeCount: clientWorkflowStatusCapsule.restartSafe ? 1 : 0,
        clientWorkflowStatusCapsuleBlockerCount: clientWorkflowStatusCapsule.blockers.length,
        clientWorkflowStatusCapsuleWarningCount: clientWorkflowStatusCapsule.warnings.length,
        clientWorkflowStatusCapsuleCheckpointCount: clientWorkflowStatusCapsule.checkpoints.length,
        clientWorkflowAdoptionLeaseReadyCount: clientWorkflowAdoptionLease.ready ? 1 : 0,
        clientWorkflowAdoptionLeaseRestartSafeCount: clientWorkflowAdoptionLease.restartSafe ? 1 : 0,
        clientWorkflowAdoptionLeaseAlignedCount: clientWorkflowAdoptionLease.aligned ? 1 : 0,
        clientWorkflowAdoptionLeaseBlockerCount: clientWorkflowAdoptionLease.blockers.length,
        clientWorkflowAdoptionLeaseWarningCount: clientWorkflowAdoptionLease.warnings.length,
        stateRecoveryCapsuleReadyCount: stateRecoveryCapsule.ready ? 1 : 0,
        stateRecoveryCapsuleRestartSafeCount: stateRecoveryCapsule.restartSafe ? 1 : 0,
        stateRecoveryCapsuleCheckpointCount: stateRecoveryCapsule.checkpoints.length,
        stateRecoveryCapsuleCommandCount: stateRecoveryCapsule.commands.length,
        stateRecoveryCapsuleBlockerCount: stateRecoveryCapsule.blockers.length,
        stateRecoveryCapsuleWarningCount: stateRecoveryCapsule.warnings.length,
        stateIntegrityReadyCount: stateIntegrityManifest.ready ? 1 : 0,
        stateIntegrityRestartSafeCount: stateIntegrityManifest.restartSafe ? 1 : 0,
        stateIntegrityAlignedCount: stateIntegrityManifest.aligned ? 1 : 0,
        stateIntegrityCheckpointCount: stateIntegrityManifest.checkpoints.length,
        stateIntegrityMismatchCount: stateIntegrityManifest.mismatches.length,
        stateIntegrityBlockerCount: stateIntegrityManifest.blockers.length,
        stateIntegrityWarningCount: stateIntegrityManifest.warnings.length,
        operatorHandoffManifestReadyCount: operatorHandoffManifest.ready ? 1 : 0,
        operatorHandoffManifestStepCount: operatorHandoffManifest.steps.length,
        operatorHandoffManifestBlockerCount: operatorHandoffManifest.blockers.length,
        operatorHandoffManifestWarningCount: operatorHandoffManifest.warnings.length,
        operatorDecisionReadyCount: operatorDecision.ready ? 1 : 0,
        operatorDecisionCommandCount: operatorDecision.command?.commandId ? 1 : 0,
        operatorDecisionAcknowledgementRequiredCount: operatorDecision.acknowledgement?.required ? 1 : 0,
        operatorDecisionMissingAcknowledgementCount: operatorDecision.acknowledgement?.missingAcknowledgements?.length ?? 0,
        operatorDecisionBlockerCount: operatorDecision.blockers.length,
        operatorDecisionWarningCount: operatorDecision.warnings.length,
        acceptanceCheckpointReadyCount: acceptanceCheckpointBundle.ready ? 1 : 0,
        acceptanceCheckpointAlignedCount: acceptanceCheckpointBundle.aligned ? 1 : 0,
        acceptanceCheckpointRestartSafeCount: acceptanceCheckpointBundle.restartSafe ? 1 : 0,
        acceptanceCheckpointBlockerCount: acceptanceCheckpointBundle.blockers.length,
        acceptanceCheckpointWarningCount: acceptanceCheckpointBundle.warnings.length,
        acceptanceCheckpointCount: acceptanceCheckpointBundle.checkpoints.length,
        acceptancePreviewReadyCount: acceptancePreview.ready ? 1 : 0,
        acceptancePreviewRenderableCount: acceptancePreview.renderable ? 1 : 0,
        acceptancePreviewNextStepCount: acceptancePreview.nextSteps.length,
        acceptancePreviewBlockerCount: acceptancePreview.blockers.length,
        acceptancePreviewWarningCount: acceptancePreview.warnings.length
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
    stateIntegrity: {
      state: report?.stateIntegrityManifest?.state ?? 'unknown',
      ready: report?.stateIntegrityManifest?.ready ?? false,
      restartSafe: report?.stateIntegrityManifest?.restartSafe ?? false,
      aligned: report?.stateIntegrityManifest?.aligned ?? false,
      digest: report?.stateIntegrityManifest?.digest ?? null,
      checkpointCount: report?.stateIntegrityManifest?.checkpoints?.length ?? 0,
      mismatchCount: report?.stateIntegrityManifest?.mismatches?.length ?? 0,
      blockerCount: report?.stateIntegrityManifest?.blockers?.length ?? 0,
      warningCount: report?.stateIntegrityManifest?.warnings?.length ?? 0,
      nextAction: report?.stateIntegrityManifest?.nextAction ?? null
    },
    lifecycleGate: report?.lifecycleGate?.state ?? 'unknown',
    lifecycleControls: {
      state: report?.lifecycleControls?.state ?? 'unknown',
      ready: report?.lifecycleControls?.ready ?? false,
      effectiveEnabled: report?.lifecycleControls?.effectiveEnabled ?? false,
      selectedControl: report?.lifecycleControls?.selectedControl ?? null,
      scheduleStatus: report?.lifecycleControls?.schedule?.status ?? null,
      nextAction: report?.lifecycleControls?.nextAction ?? null,
      commandCount: report?.lifecycleControls?.commands?.length ?? 0,
      commandQueueState: report?.lifecycleControls?.commandQueue?.state ?? 'unknown',
      commandQueueReady: report?.lifecycleControls?.commandQueue?.ready ?? false,
      commandQueuePendingCount: report?.lifecycleControls?.commandQueue?.pending?.length ?? 0,
      commandQueueBlockedCount: report?.lifecycleControls?.commandQueue?.blocked?.length ?? 0,
      commandQueueMissingAcknowledgementCount: report?.lifecycleControls?.commandQueue?.missingAcknowledgements?.length ?? 0,
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
    providerHandoffHealth: {
      state: report?.providerHandoffHealth?.state ?? 'unknown',
      ready: report?.providerHandoffHealth?.ready ?? false,
      degraded: report?.providerHandoffHealth?.degraded ?? false,
      retryable: report?.providerHandoffHealth?.retryable ?? false,
      terminal: report?.providerHandoffHealth?.terminal ?? false,
      statusChannel: report?.providerHandoffHealth?.statusChannel ?? null,
      commandId: report?.providerHandoffHealth?.commandId ?? null,
      receiptDigest: report?.providerHandoffHealth?.receipt?.digest ?? null,
      retryAfterMs: report?.providerHandoffHealth?.retryWindow?.retryAfterMs ?? null,
      dependencyCount: report?.providerHandoffHealth?.dependencies?.length ?? 0,
      failedDependencyCount: report?.providerHandoffHealth?.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0,
      blockerCount: report?.providerHandoffHealth?.blockers?.length ?? 0,
      warningCount: report?.providerHandoffHealth?.warnings?.length ?? 0,
      nextAction: report?.providerHandoffHealth?.nextAction ?? null,
      digest: report?.providerHandoffHealth?.digest ?? null
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
      warningCount: report?.providerServiceContract?.warnings?.length ?? 0,
      negotiationReceipt: {
        state: report?.providerServiceContract?.capabilityNegotiationReceipt?.state ?? 'unknown',
        ready: report?.providerServiceContract?.capabilityNegotiationReceipt?.ready ?? false,
        synthesized: report?.providerServiceContract?.capabilityNegotiationReceipt?.synthesized ?? false,
        digest: report?.providerServiceContract?.capabilityNegotiationReceipt?.digest ?? null,
        commandId: report?.providerServiceContract?.capabilityNegotiationReceipt?.command?.commandId ?? null,
        missingCapabilityCount: report?.providerServiceContract?.capabilityNegotiationReceipt?.missingCapabilities?.length ?? 0,
        blockerCount: report?.providerServiceContract?.capabilityNegotiationReceipt?.blockers?.length ?? 0,
        warningCount: report?.providerServiceContract?.capabilityNegotiationReceipt?.warnings?.length ?? 0,
        nextAction: report?.providerServiceContract?.capabilityNegotiationReceipt?.nextAction ?? null
      },
      providerSession: {
        state: report?.providerServiceContract?.providerSession?.state ?? 'unknown',
        ready: report?.providerServiceContract?.providerSession?.ready ?? false,
        renewalRequired: report?.providerServiceContract?.providerSession?.renewalRequired ?? false,
        externalStateKey: report?.providerServiceContract?.providerSession?.externalStateKey ?? null,
        digest: report?.providerServiceContract?.providerSession?.digest ?? null,
        nextAction: report?.providerServiceContract?.providerSession?.nextAction ?? null,
        blockerCount: report?.providerServiceContract?.providerSession?.blockers?.length ?? 0
      },
      handoffReceipt: {
        state: report?.providerServiceContract?.handoffReceipt?.state ?? report?.providerServiceContract?.sync?.handoffReceipt?.state ?? 'unknown',
        ready: report?.providerServiceContract?.handoffReceipt?.ready ?? report?.providerServiceContract?.sync?.handoffReceipt?.ready ?? false,
        acknowledged: report?.providerServiceContract?.handoffReceipt?.acknowledged ?? report?.providerServiceContract?.sync?.handoffReceipt?.acknowledged ?? false,
        fresh: report?.providerServiceContract?.handoffReceipt?.fresh ?? report?.providerServiceContract?.sync?.handoffReceipt?.fresh ?? false,
        expectedDigest: report?.providerServiceContract?.handoffReceipt?.expectedDigest ?? report?.providerServiceContract?.sync?.handoffReceipt?.expectedDigest ?? null,
        digest: report?.providerServiceContract?.handoffReceipt?.digest ?? report?.providerServiceContract?.sync?.handoffReceipt?.digest ?? null,
        commandId: report?.providerServiceContract?.handoffReceipt?.command?.commandId ?? report?.providerServiceContract?.sync?.handoffReceipt?.command?.commandId ?? null,
        nextAction: report?.providerServiceContract?.handoffReceipt?.nextAction ?? report?.providerServiceContract?.sync?.handoffReceipt?.nextAction ?? null,
        blockerCount: report?.providerServiceContract?.handoffReceipt?.blockers?.length ?? report?.providerServiceContract?.sync?.handoffReceipt?.blockers?.length ?? 0,
        warningCount: report?.providerServiceContract?.handoffReceipt?.warnings?.length ?? report?.providerServiceContract?.sync?.handoffReceipt?.warnings?.length ?? 0
      }
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
    clientRuntimeAdoption: {
      state: report?.clientRuntimeAdoption?.state ?? 'unknown',
      ready: report?.clientRuntimeAdoption?.ready ?? false,
      digest: report?.clientRuntimeAdoption?.digest ?? null,
      presentationMode: report?.clientRuntimeAdoption?.presentationMode ?? null,
      userVisibleStatus: report?.clientRuntimeAdoption?.userVisibleStatus ?? null,
      nextAction: report?.clientRuntimeAdoption?.nextAction ?? null,
      commandCount: report?.clientRuntimeAdoption?.commands?.length ?? 0,
      blockerCount: report?.clientRuntimeAdoption?.blockers?.length ?? 0,
      acknowledgementCount: report?.clientRuntimeAdoption?.requiredAcknowledgements?.length ?? 0
    },
    clientRuntimeAdoptionReceipt: {
      state: report?.clientRuntimeAdoptionReceipt?.state ?? 'unknown',
      ready: report?.clientRuntimeAdoptionReceipt?.ready ?? false,
      receiptKey: report?.clientRuntimeAdoptionReceipt?.receiptKey ?? null,
      digest: report?.clientRuntimeAdoptionReceipt?.digest ?? null,
      statusChannel: report?.clientRuntimeAdoptionReceipt?.statusChannel ?? null,
      commandId: report?.clientRuntimeAdoptionReceipt?.command?.commandId ?? null,
      restartSafe: report?.clientRuntimeAdoptionReceipt?.restartSemantics?.restartSafe ?? false,
      checkpointCount: report?.clientRuntimeAdoptionReceipt?.checkpoints?.length ?? 0,
      blockerCount: report?.clientRuntimeAdoptionReceipt?.blockers?.length ?? 0,
      warningCount: report?.clientRuntimeAdoptionReceipt?.warnings?.length ?? 0,
      nextAction: report?.clientRuntimeAdoptionReceipt?.nextAction ?? null
    },
    acceptancePacket: {
      readiness: report?.acceptancePacket?.readinessState ?? 'unknown',
      acceptance: report?.acceptancePacket?.acceptanceState ?? 'unknown',
      acceptEnabled: report?.acceptancePacket?.acceptEnabled ?? false,
      nextAction: report?.acceptancePacket?.nextAction ?? null,
      blockerCount: report?.acceptancePacket?.blockers?.length ?? 0,
      warningCount: report?.acceptancePacket?.warnings?.length ?? 0
    },
    acceptancePreview: {
      state: report?.acceptancePreview?.state ?? 'unknown',
      ready: report?.acceptancePreview?.ready ?? false,
      renderable: report?.acceptancePreview?.renderable ?? false,
      presentationMode: report?.acceptancePreview?.presentationMode ?? null,
      userVisibleStatus: report?.acceptancePreview?.userVisibleStatus?.current ?? null,
      primaryAction: report?.acceptancePreview?.primaryAction ?? null,
      commandId: report?.acceptancePreview?.command?.commandId ?? null,
      digest: report?.acceptancePreview?.digest ?? null,
      validationOk: report?.acceptancePreview?.validationSummary?.ok ?? false,
      nextStepCount: report?.acceptancePreview?.nextSteps?.length ?? 0,
      blockerCount: report?.acceptancePreview?.blockers?.length ?? 0,
      warningCount: report?.acceptancePreview?.warnings?.length ?? 0
    },
    operatorDecision: {
      state: report?.operatorDecision?.state ?? report?.analyticsExport?.operatorDecision?.state ?? 'unknown',
      ready: report?.operatorDecision?.ready ?? report?.analyticsExport?.operatorDecision?.ready ?? false,
      presentationMode: report?.operatorDecision?.presentationMode ?? report?.analyticsExport?.operatorDecision?.presentationMode ?? null,
      primaryCommand: report?.operatorDecision?.primaryCommand ?? report?.analyticsExport?.operatorDecision?.primaryCommand ?? null,
      commandId: report?.operatorDecision?.command?.commandId ?? report?.analyticsExport?.operatorDecision?.command?.commandId ?? null,
      acknowledgementRequired: report?.operatorDecision?.acknowledgement?.required ?? report?.analyticsExport?.operatorDecision?.acknowledgement?.required ?? false,
      missingAcknowledgementCount: report?.operatorDecision?.acknowledgement?.missingAcknowledgements?.length ?? report?.analyticsExport?.operatorDecision?.acknowledgement?.missingAcknowledgements?.length ?? 0,
      digest: report?.operatorDecision?.digest ?? report?.analyticsExport?.operatorDecision?.digest ?? null,
      nextAction: report?.operatorDecision?.nextAction ?? report?.analyticsExport?.operatorDecision?.nextAction ?? null
    },
    acceptanceCheckpointBundle: {
      state: report?.acceptanceCheckpointBundle?.state ?? 'unknown',
      ready: report?.acceptanceCheckpointBundle?.ready ?? false,
      aligned: report?.acceptanceCheckpointBundle?.aligned ?? false,
      restartSafe: report?.acceptanceCheckpointBundle?.restartSafe ?? false,
      digest: report?.acceptanceCheckpointBundle?.digest ?? null,
      checkpointCount: report?.acceptanceCheckpointBundle?.checkpoints?.length ?? 0,
      commandId: report?.acceptanceCheckpointBundle?.commandId ?? null,
      nextAction: report?.acceptanceCheckpointBundle?.nextAction ?? null,
      blockerCount: report?.acceptanceCheckpointBundle?.blockers?.length ?? 0,
      warningCount: report?.acceptanceCheckpointBundle?.warnings?.length ?? 0
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
    providerCommandLedger: {
      state: report?.providerCommandLedger?.state ?? 'unknown',
      ready: report?.providerCommandLedger?.ready ?? false,
      ledgerKey: report?.providerCommandLedger?.ledgerKey ?? null,
      digest: report?.providerCommandLedger?.digest ?? null,
      activeCommandId: report?.providerCommandLedger?.activeCommandId ?? null,
      activeCommandState: report?.providerCommandLedger?.activeCommandState ?? null,
      replayMode: report?.providerCommandLedger?.replayMode ?? null,
      restartPolicy: report?.providerCommandLedger?.restartPolicy ?? null,
      duplicateSafe: report?.providerCommandLedger?.duplicateSafe ?? false,
      replayable: report?.providerCommandLedger?.replayable ?? false,
      entryCount: report?.providerCommandLedger?.entries?.length ?? 0,
      commandCount: report?.providerCommandLedger?.commands?.length ?? 0,
      blockerCount: report?.providerCommandLedger?.blockers?.length ?? 0,
      warningCount: report?.providerCommandLedger?.warnings?.length ?? 0
    },
    persistenceEnvelope: {
      state: report?.persistenceEnvelope?.state ?? 'unknown',
      ready: report?.persistenceEnvelope?.ready ?? false,
      envelopeKey: report?.persistenceEnvelope?.envelopeKey ?? null,
      digest: report?.persistenceEnvelope?.digest ?? null,
      resumePointer: report?.persistenceEnvelope?.resumePointer ?? null,
      statusChannel: report?.persistenceEnvelope?.statusChannel ?? null,
      commandId: report?.persistenceEnvelope?.commandId ?? null,
      restartSafe: report?.persistenceEnvelope?.restartSemantics?.restartSafe ?? false,
      duplicateCommandPolicy: report?.persistenceEnvelope?.restartSemantics?.onDuplicateCommand ?? null,
      manifestDigest: report?.persistenceEnvelope?.manifestDigest ?? null,
      recoveryHintCount: report?.persistenceEnvelope?.recoveryHints?.length ?? 0,
      blockerCount: report?.persistenceEnvelope?.blockers?.length ?? 0,
      warningCount: report?.persistenceEnvelope?.warnings?.length ?? 0,
      nextAction: report?.persistenceEnvelope?.nextAction ?? null
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
    operationalIncident: {
      state: report?.operationalIncident?.state ?? 'unknown',
      severity: report?.operationalIncident?.severity ?? 'none',
      open: report?.operationalIncident?.open ?? false,
      retryable: report?.operationalIncident?.retryable ?? false,
      terminal: report?.operationalIncident?.terminal ?? false,
      retryAfterMs: report?.operationalIncident?.retryWindow?.retryAfterMs ?? null,
      degradedMode: report?.operationalIncident?.degradedMode?.mode ?? null,
      owner: report?.operationalIncident?.owner ?? null,
      nextAction: report?.operationalIncident?.nextAction ?? null,
      evidenceCount: report?.operationalIncident?.evidence?.length ?? 0,
      digest: report?.operationalIncident?.digest ?? null
    },
    recoveryRunbook: {
      state: report?.recoveryRunbook?.state ?? 'unknown',
      ready: report?.recoveryRunbook?.ready ?? false,
      mode: report?.recoveryRunbook?.mode ?? null,
      primaryCommandId: report?.recoveryRunbook?.primaryCommandId ?? null,
      retryAfterMs: report?.recoveryRunbook?.retryAfterMs ?? null,
      digest: report?.recoveryRunbook?.digest ?? null,
      nextAction: report?.recoveryRunbook?.nextAction ?? null,
      stepCount: report?.recoveryRunbook?.steps?.length ?? 0,
      executableStepCount: report?.recoveryRunbook?.steps?.filter((step) => step.executable).length ?? 0,
      blockerCount: report?.recoveryRunbook?.blockers?.length ?? 0,
      warningCount: report?.recoveryRunbook?.warnings?.length ?? 0
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
    analyticsPublication: {
      state: report?.analyticsPublication?.state ?? 'unknown',
      ready: report?.analyticsPublication?.ready ?? false,
      digest: report?.analyticsPublication?.digest ?? null,
      publishCommandId: report?.analyticsPublication?.publishCommand?.commandId ?? null,
      publishReady: report?.analyticsPublication?.publishCommand?.ready ?? false,
      targetCount: report?.analyticsPublication?.targets?.length ?? 0,
      publisherCount: report?.analyticsPublication?.publishers?.length ?? 0,
      requiredAcknowledgementCount: report?.analyticsPublication?.acknowledgements?.required?.length ?? 0,
      missingAcknowledgementCount: report?.analyticsPublication?.acknowledgements?.missing?.length ?? 0,
      freshnessWarningCount: report?.analyticsPublication?.freshness?.warnings?.length ?? 0,
      changedSinceKernelSnapshot: report?.analyticsPublication?.freshness?.changedSinceKernelSnapshot ?? false,
      nextAction: report?.analyticsPublication?.nextAction ?? null,
      blockerCount: report?.analyticsPublication?.blockers?.length ?? 0,
      warningCount: report?.analyticsPublication?.warnings?.length ?? 0
    },
    timelinePublication: {
      state: report?.timelinePublication?.state ?? 'unknown',
      ready: report?.timelinePublication?.ready ?? false,
      digest: report?.timelinePublication?.digest ?? null,
      commandId: report?.timelinePublication?.publishCommand?.commandId ?? null,
      publishReady: report?.timelinePublication?.publishCommand?.ready ?? false,
      eventCount: report?.timelinePublication?.events?.length ?? 0,
      snapshotCount: report?.timelinePublication?.snapshots?.length ?? 0,
      latestEvent: report?.timelinePublication?.latestEvent?.phase ?? null,
      changedSinceAcceptedSnapshot: report?.timelinePublication?.drift?.changedSinceAcceptedSnapshot ?? false,
      changedSinceKernelSnapshot: report?.timelinePublication?.drift?.changedSinceKernelSnapshot ?? false,
      nextAction: report?.timelinePublication?.nextAction ?? null,
      blockerCount: report?.timelinePublication?.blockers?.length ?? 0,
      warningCount: report?.timelinePublication?.warnings?.length ?? 0
    },
    routeExportState: {
      state: report?.routeExportState?.state ?? 'unknown',
      ready: report?.routeExportState?.ready ?? false,
      digest: report?.routeExportState?.digest ?? null,
      analyticsPublicationDigest: report?.routeExportState?.analyticsPublication?.digest ?? null,
      acceptanceDigest: report?.routeExportState?.acceptanceDigest ?? null,
      exportDigest: report?.routeExportState?.exportDigest ?? null,
      changedSinceAcceptedSnapshot: report?.routeExportState?.changedSinceAcceptedSnapshot ?? false,
      publishCommandId: report?.routeExportState?.publishCommand?.commandId ?? null,
      publishCommandReady: report?.routeExportState?.publishCommand?.ready ?? false,
      snapshotCount: report?.routeExportState?.snapshots?.length ?? 0,
      timelineEventCount: report?.routeExportState?.timeline?.length ?? 0,
      nextAction: report?.routeExportState?.nextAction ?? null,
      blockerCount: report?.routeExportState?.blockers?.length ?? 0,
      warningCount: report?.routeExportState?.warnings?.length ?? 0
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
    clientWorkflowStatusCapsule: {
      state: report?.clientWorkflowStatusCapsule?.state ?? 'unknown',
      ready: report?.clientWorkflowStatusCapsule?.ready ?? false,
      digest: report?.clientWorkflowStatusCapsule?.digest ?? null,
      statusChannel: report?.clientWorkflowStatusCapsule?.statusChannel ?? null,
      resumePointer: report?.clientWorkflowStatusCapsule?.resumePointer ?? null,
      restartSafe: report?.clientWorkflowStatusCapsule?.restartSafe ?? false,
      visibleStatus: report?.clientWorkflowStatusCapsule?.visibleStatus?.current ?? null,
      nextAction: report?.clientWorkflowStatusCapsule?.nextAction ?? null,
      checkpointCount: report?.clientWorkflowStatusCapsule?.checkpoints?.length ?? 0,
      blockerCount: report?.clientWorkflowStatusCapsule?.blockers?.length ?? 0,
      warningCount: report?.clientWorkflowStatusCapsule?.warnings?.length ?? 0
    },
    stateRecoveryCapsule: {
      state: report?.stateRecoveryCapsule?.state ?? 'unknown',
      ready: report?.stateRecoveryCapsule?.ready ?? false,
      digest: report?.stateRecoveryCapsule?.digest ?? null,
      capsuleKey: report?.stateRecoveryCapsule?.capsuleKey ?? null,
      resumePointer: report?.stateRecoveryCapsule?.resumePointer ?? null,
      restartSafe: report?.stateRecoveryCapsule?.restartSafe ?? false,
      replayMode: report?.stateRecoveryCapsule?.replay?.mode ?? null,
      checkpointCount: report?.stateRecoveryCapsule?.checkpoints?.length ?? 0,
      commandCount: report?.stateRecoveryCapsule?.commands?.length ?? 0,
      blockerCount: report?.stateRecoveryCapsule?.blockers?.length ?? 0,
      warningCount: report?.stateRecoveryCapsule?.warnings?.length ?? 0,
      nextAction: report?.stateRecoveryCapsule?.nextAction ?? null
    },
    operatorHandoffManifest: {
      state: report?.operatorHandoffManifest?.state ?? 'unknown',
      ready: report?.operatorHandoffManifest?.ready ?? false,
      digest: report?.operatorHandoffManifest?.digest ?? null,
      presentationMode: report?.operatorHandoffManifest?.presentationMode ?? null,
      primaryAction: report?.operatorHandoffManifest?.primaryAction ?? null,
      statusChannel: report?.operatorHandoffManifest?.statusChannel ?? null,
      commandId: report?.operatorHandoffManifest?.command?.commandId ?? null,
      restartSafe: report?.operatorHandoffManifest?.restartSemantics?.restartSafe ?? false,
      stepCount: report?.operatorHandoffManifest?.steps?.length ?? 0,
      readyStepCount: report?.operatorHandoffManifest?.validationSummary?.readyStepCount ?? 0,
      blockerCount: report?.operatorHandoffManifest?.blockers?.length ?? 0,
      warningCount: report?.operatorHandoffManifest?.warnings?.length ?? 0
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
    boundaryPermissionPosture: {
      state: report?.boundaryPermissionPosture?.state ?? 'unknown',
      ready: report?.boundaryPermissionPosture?.ready ?? false,
      permissionMode: report?.boundaryPermissionPosture?.permissionMode ?? 'unknown',
      role: report?.boundaryPermissionPosture?.role ?? null,
      tenantId: report?.boundaryPermissionPosture?.tenantId ?? null,
      workspaceId: report?.boundaryPermissionPosture?.workspaceId ?? null,
      isolationKey: report?.boundaryPermissionPosture?.isolationKey ?? null,
      auditDigest: report?.boundaryPermissionPosture?.auditDigest ?? null,
      postureDigest: report?.boundaryPermissionPosture?.postureDigest ?? null,
      allowedEffectCount: report?.boundaryPermissionPosture?.effectAccess?.allowed?.length ?? 0,
      deniedEffectCount: report?.boundaryPermissionPosture?.effectAccess?.denied?.length ?? 0,
      missingAllowedEffectCount: report?.boundaryPermissionPosture?.effectAccess?.missingAllowed?.length ?? 0,
      escalationCount: report?.boundaryPermissionPosture?.escalations?.length ?? 0,
      missingAcknowledgementCount: report?.boundaryPermissionPosture?.missingAcknowledgements?.length ?? 0,
      nextAction: report?.boundaryPermissionPosture?.nextAction ?? null,
      blockerCount: report?.boundaryPermissionPosture?.blockers?.length ?? 0,
      warningCount: report?.boundaryPermissionPosture?.warnings?.length ?? 0
    },
    boundaryDecisionReceipt: {
      state: report?.boundaryDecisionReceipt?.state ?? 'unknown',
      ready: report?.boundaryDecisionReceipt?.ready ?? false,
      decision: report?.boundaryDecisionReceipt?.decision ?? 'unknown',
      releaseAllowed: report?.boundaryDecisionReceipt?.release?.allowed ?? false,
      receiptDigest: report?.boundaryDecisionReceipt?.receiptDigest ?? null,
      commandId: report?.boundaryDecisionReceipt?.command?.commandId ?? null,
      evidenceCount: report?.boundaryDecisionReceipt?.evidence?.length ?? 0,
      blockerCount: report?.boundaryDecisionReceipt?.blockers?.length ?? 0,
      warningCount: report?.boundaryDecisionReceipt?.warnings?.length ?? 0,
      nextAction: report?.boundaryDecisionReceipt?.nextAction ?? null
    },
    boundaryReleaseGate: {
      state: report?.boundaryReleaseGate?.state ?? 'unknown',
      ready: report?.boundaryReleaseGate?.ready ?? false,
      releaseAllowed: report?.boundaryReleaseGate?.releaseAllowed ?? false,
      gateDigest: report?.boundaryReleaseGate?.gateDigest ?? null,
      commandId: report?.boundaryReleaseGate?.command?.commandId ?? null,
      tenantId: report?.boundaryReleaseGate?.scope?.tenantId ?? null,
      workspaceId: report?.boundaryReleaseGate?.scope?.workspaceId ?? null,
      isolationKey: report?.boundaryReleaseGate?.scope?.isolationKey ?? null,
      restartSafe: report?.boundaryReleaseGate?.restartSemantics?.restartSafe ?? false,
      replayPolicy: report?.boundaryReleaseGate?.replayPolicy ?? null,
      missingAcknowledgementCount: report?.boundaryReleaseGate?.missingAcknowledgements?.length ?? 0,
      blockerCount: report?.boundaryReleaseGate?.blockers?.length ?? 0,
      warningCount: report?.boundaryReleaseGate?.warnings?.length ?? 0,
      nextAction: report?.boundaryReleaseGate?.nextAction ?? null
    },
    workspacePermissionHandoff: {
      state: report?.workspacePermissionHandoff?.state ?? 'unknown',
      ready: report?.workspacePermissionHandoff?.ready ?? false,
      releaseAllowed: report?.workspacePermissionHandoff?.releaseAllowed ?? false,
      handoffDigest: report?.workspacePermissionHandoff?.handoffDigest ?? null,
      commandId: report?.workspacePermissionHandoff?.commands?.[0]?.commandId ?? null,
      tenantId: report?.workspacePermissionHandoff?.scope?.tenantId ?? null,
      workspaceId: report?.workspacePermissionHandoff?.scope?.workspaceId ?? null,
      isolationKey: report?.workspacePermissionHandoff?.scope?.isolationKey ?? null,
      role: report?.workspacePermissionHandoff?.scope?.role ?? null,
      permissionMode: report?.workspacePermissionHandoff?.permissionMode ?? 'unknown',
      scopeAligned: report?.workspacePermissionHandoff?.scopeAlignment?.aligned ?? false,
      scopeMismatchCount: report?.workspacePermissionHandoff?.scopeAlignment?.mismatchCount ?? 0,
      restartSafe: report?.workspacePermissionHandoff?.restartSemantics?.restartSafe ?? false,
      missingAcknowledgementCount: report?.workspacePermissionHandoff?.missingAcknowledgements?.length ?? 0,
      commandCount: report?.workspacePermissionHandoff?.commands?.length ?? 0,
      blockerCount: report?.workspacePermissionHandoff?.blockers?.length ?? 0,
      warningCount: report?.workspacePermissionHandoff?.warnings?.length ?? 0,
      nextAction: report?.workspacePermissionHandoff?.nextAction ?? null
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
  diagnostics.push(...validateBoundaryPermissionPosture(report?.boundaryPermissionPosture, report?.writeEffects ?? []));
  diagnostics.push(...validateBoundaryDecisionReceipt(report?.boundaryDecisionReceipt, report?.writeEffects ?? []));
  diagnostics.push(...validateBoundaryReleaseGate(report?.boundaryReleaseGate, report?.writeEffects ?? []));
  diagnostics.push(...validateWorkspacePermissionHandoff(report?.workspacePermissionHandoff, report?.writeEffects ?? []));
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
  diagnostics.push(...validateClientRuntimeAdoptionContract(report?.clientRuntimeAdoption, report?.writeEffects ?? []));
  diagnostics.push(...validateClientRuntimeAdoptionReceipt(report?.clientRuntimeAdoptionReceipt, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteAcceptancePacket(report?.acceptancePacket, report?.writeEffects ?? []));
  diagnostics.push(...validatePersistedExternalWriteStatus(report?.persistedStatus, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteStatusJournal(report?.statusJournal, report?.writeEffects ?? []));
  diagnostics.push(...validateProviderCommandLedger(report?.providerCommandLedger, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWritePersistenceEnvelope(report?.persistenceEnvelope, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteExportLedger(report?.exportLedger, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteReplayManifest(report?.replayManifest, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteOperatorReadiness(report?.operatorReadiness, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteOperationalHealth(report?.operationalHealth, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteOperationalIncident(report?.operationalIncident, report?.operationalHealth, report?.writeEffects ?? []));
  diagnostics.push(...validateProviderHandoffHealthSummary(report?.providerHandoffHealth, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteAnalyticsExport(report?.analyticsExport, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteAnalyticsPublicationContract(report?.analyticsPublication, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteTimelinePublicationContract(report?.timelinePublication, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteRouteExportState(report?.routeExportState, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteStatusHandoff(report?.statusHandoff, report?.writeEffects ?? []));
  diagnostics.push(...validateClientWorkflowStatusCapsule(report?.clientWorkflowStatusCapsule, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteStateRecoveryCapsule(report?.stateRecoveryCapsule, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteStateIntegrityManifest(report?.stateIntegrityManifest, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteOperatorHandoffManifest(report?.operatorHandoffManifest, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteOperatorDecisionContract(report?.operatorDecision ?? report?.analyticsExport?.operatorDecision, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteAcceptanceCheckpointBundle(report?.acceptanceCheckpointBundle, report?.writeEffects ?? []));
  diagnostics.push(...validateExternalWriteAcceptancePreview(report?.acceptancePreview, report?.writeEffects ?? []));
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
  providerServiceContract,
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
  routeExportState,
  boundaryTicket,
  boundaryAuditHandoff,
  boundaryRecoveryGuard,
  operationalIncident,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const checkpoints = [
    statusCheckpoint('provider_command', providerCommand?.state, providerCommand?.commandId, providerCommand?.blockers),
    statusCheckpoint('provider_handoff_receipt', providerServiceContract?.handoffReceipt?.state ?? providerServiceContract?.sync?.handoffReceipt?.state, providerServiceContract?.handoffReceipt?.digest ?? providerServiceContract?.sync?.handoffReceipt?.digest, providerServiceContract?.handoffReceipt?.blockers ?? providerServiceContract?.sync?.handoffReceipt?.blockers),
    statusCheckpoint('persisted_status', persistedStatus?.state, persistedStatus?.digest, persistedStatus?.blockers),
    statusCheckpoint('status_journal', statusJournal?.state, statusJournal?.digest, statusJournal?.blockers),
    statusCheckpoint('client_request_snapshot', clientRequestSnapshot?.state, clientRequestSnapshot?.digest, clientRequestSnapshot?.blockers),
    statusCheckpoint('export_ledger', exportLedger?.state, exportLedger?.digest, exportLedger?.blockers),
    statusCheckpoint('replay_manifest', replayManifest?.state, replayManifest?.digest, replayManifest?.blockers),
    statusCheckpoint('boundary_recovery_guard', boundaryRecoveryGuard?.state, boundaryRecoveryGuard?.guardDigest, boundaryRecoveryGuard?.blockers),
    statusCheckpoint('analytics_export', analyticsExport?.state, analyticsExport?.digest, analyticsExport?.blockers),
    statusCheckpoint('route_export_state', routeExportState?.state, routeExportState?.digest, routeExportState?.blockers),
    statusCheckpoint('operational_retry', operationalIncident?.state, operationalIncident?.digest, operationalIncident?.blockers)
  ];
  const blockers = uniqueSorted([
    ...(providerCommand?.blockers ?? []).map((blocker) => `provider_command_${blocker}`),
    ...((providerServiceContract?.handoffReceipt?.blockers ?? providerServiceContract?.sync?.handoffReceipt?.blockers) ?? []).map((blocker) => `provider_handoff_receipt_${blocker}`),
    ...(persistedStatus?.blockers ?? []).map((blocker) => `persisted_status_${blocker}`),
    ...(statusJournal?.blockers ?? []).map((blocker) => `status_journal_${blocker}`),
    ...(clientRequestSnapshot?.blockers ?? []).map((blocker) => `client_request_${blocker}`),
    ...(exportLedger?.blockers ?? []).map((blocker) => `export_ledger_${blocker}`),
    ...(replayManifest?.blockers ?? []).map((blocker) => `replay_manifest_${blocker}`),
    ...(boundaryRecoveryGuard?.blockers ?? []).map((blocker) => `boundary_recovery_${blocker}`),
    ...(analyticsExport?.blockers ?? []).map((blocker) => `analytics_export_${blocker}`),
    ...(routeExportState?.blockers ?? []).map((blocker) => `route_export_${blocker}`),
    ...(!providerCommand?.commandId && writeRequired ? ['missing_status_handoff_command_id'] : []),
    ...(writeRequired && (providerServiceContract?.handoffReceipt?.state ?? providerServiceContract?.sync?.handoffReceipt?.state) === 'blocked' ? ['status_handoff_provider_receipt_blocked'] : []),
    ...(!route?.statusChannel && writeRequired ? ['missing_status_handoff_channel'] : []),
    ...(!persistedStatus?.digest && writeRequired ? ['missing_status_handoff_persisted_digest'] : []),
    ...(!statusJournal?.digest && writeRequired ? ['missing_status_handoff_journal_digest'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_status_handoff_client_request_digest'] : []),
    ...(!routeExportState?.digest && writeRequired ? ['missing_status_handoff_route_export_digest'] : []),
    ...(!boundaryTicket?.auditDigest && writeRequired ? ['missing_status_handoff_boundary_audit_digest'] : []),
    ...(boundaryRecoveryGuard?.ready === false && writeRequired ? ['status_handoff_boundary_recovery_not_ready'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(lifecycleGate?.warnings ?? []).map((warning) => `lifecycle_${warning}`),
    ...(providerHealth?.warnings ?? []).map((warning) => `provider_health_${warning}`),
    ...((providerServiceContract?.handoffReceipt?.warnings ?? providerServiceContract?.sync?.handoffReceipt?.warnings) ?? []).map((warning) => `provider_handoff_receipt_${warning}`),
    ...(operatorReadiness?.warnings ?? []).map((warning) => `operator_${warning}`),
    ...(operationalHealth?.degraded ? ['operational_health_degraded'] : []),
    ...(operationalIncident?.retryable ? ['operational_retry_scheduled'] : []),
    ...(operationalIncident?.state === 'degraded' ? ['operational_incident_degraded'] : []),
    ...(analyticsExport?.warnings ?? []).map((warning) => `analytics_${warning}`),
    ...(routeExportState?.warnings ?? []).map((warning) => `route_export_${warning}`)
  ]);
  const operationalRetry = buildExternalWriteOperationalRetryEnvelope({
    programId,
    operation,
    writeRequired,
    status,
    route,
    providerCommand,
    providerHealth,
    lifecycleGate,
    operationalHealth,
    operationalIncident,
    kernelCall
  });
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
    providerHandoffReceiptDigest: providerServiceContract?.handoffReceipt?.digest ?? providerServiceContract?.sync?.handoffReceipt?.digest ?? null,
    statusChannel: route?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    persistedDigest: persistedStatus?.digest ?? null,
    statusJournalDigest: statusJournal?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    replayDigest: replayManifest?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null,
    boundaryRecoveryDigest: boundaryRecoveryGuard?.guardDigest ?? null,
    analyticsDigest: analyticsExport?.digest ?? null,
    routeExportDigest: routeExportState?.digest ?? null,
    routeExportCommandId: routeExportState?.publishCommand?.commandId ?? null,
    operationalRetryDigest: operationalRetry.digest ?? null,
    operationalRetryState: operationalRetry.state
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
    routeExportDigest: routeExportState?.digest ?? null,
    routeExportCommandId: routeExportState?.publishCommand?.commandId ?? null,
    operationalRetry,
    providerHandoffReceipt: {
      state: providerServiceContract?.handoffReceipt?.state ?? providerServiceContract?.sync?.handoffReceipt?.state ?? 'unknown',
      ready: providerServiceContract?.handoffReceipt?.ready ?? providerServiceContract?.sync?.handoffReceipt?.ready ?? false,
      acknowledged: providerServiceContract?.handoffReceipt?.acknowledged ?? providerServiceContract?.sync?.handoffReceipt?.acknowledged ?? false,
      fresh: providerServiceContract?.handoffReceipt?.fresh ?? providerServiceContract?.sync?.handoffReceipt?.fresh ?? false,
      digest: providerServiceContract?.handoffReceipt?.digest ?? providerServiceContract?.sync?.handoffReceipt?.digest ?? null,
      nextAction: providerServiceContract?.handoffReceipt?.nextAction ?? providerServiceContract?.sync?.handoffReceipt?.nextAction ?? null
    },
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
  if (writeEffects.length && !statusHandoff.operationalRetry?.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_status_handoff_missing_operational_retry' });
  }
  if (writeEffects.length && !statusHandoff.providerHandoffReceipt?.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_status_handoff_missing_provider_handoff_receipt' });
  }
  if (statusHandoff.providerHandoffReceipt?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_status_handoff_provider_receipt_blocked',
      receiptDigest: statusHandoff.providerHandoffReceipt.digest ?? null
    });
  }
  if (statusHandoff.providerHandoffReceipt?.fresh === false || statusHandoff.providerHandoffReceipt?.acknowledged === false) {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_status_handoff_provider_receipt_review',
      receiptDigest: statusHandoff.providerHandoffReceipt.digest ?? null
    });
  }
  if (statusHandoff.operationalRetry?.retryScheduled && !statusHandoff.operationalRetry?.retryAfterMs) {
    diagnostics.push({ level: 'error', code: 'external_write_status_handoff_retry_missing_backoff' });
  }
  if (statusHandoff.operationalRetry?.state === 'terminal') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_status_handoff_terminal_retry_envelope',
      blockers: statusHandoff.operationalRetry.blockers ?? []
    });
  }
  if (statusHandoff.state === 'review' || statusHandoff.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_status_handoff_review', warnings: statusHandoff.warnings ?? [] });
  }
  return diagnostics;
}

function buildExternalWriteOperationalRetryEnvelope({
  programId,
  operation,
  writeRequired,
  status,
  route,
  providerCommand,
  providerHealth,
  lifecycleGate,
  operationalHealth,
  operationalIncident,
  kernelCall
}) {
  const retryWindow = operationalIncident?.retryWindow ?? {};
  const retryScheduled = operationalIncident?.retryable === true || retryWindow.scheduled === true;
  const retryAfterMs = retryScheduled
    ? retryWindow.retryAfterMs
      ?? operationalHealth?.retry?.retryAfterMs
      ?? providerHealth?.retryAfterMs
      ?? kernelCall?.recovery?.retry?.initialDelayMs
      ?? null
    : null;
  const attempt = Number(retryWindow.attempt ?? operationalHealth?.retry?.attempt ?? 0);
  const maxAttempts = Number(retryWindow.maxAttempts ?? operationalHealth?.retry?.maxAttempts ?? kernelCall?.recovery?.retry?.maxAttempts ?? 0);
  const exhausted = retryWindow.exhausted === true || (maxAttempts > 0 && attempt >= maxAttempts && retryScheduled);
  const degradedMode = operationalIncident?.degradedMode ?? operationalHealth?.degradedMode ?? null;
  const terminal = operationalIncident?.terminal === true || exhausted && operationalIncident?.open === true;
  const blocked = terminal || operationalIncident?.state === 'terminal';
  const state = !writeRequired
    ? 'not_required'
    : blocked
      ? 'terminal'
      : retryScheduled
        ? 'retry_scheduled'
        : degradedMode
          ? 'degraded'
          : operationalIncident?.open
            ? 'open'
            : 'closed';
  const blockers = uniqueSorted([
    ...(terminal ? ['operational_retry_terminal'] : []),
    ...(retryScheduled && !retryAfterMs ? ['missing_operational_retry_backoff'] : []),
    ...(retryScheduled && !providerCommand?.commandId ? ['missing_operational_retry_command'] : []),
    ...(retryScheduled && !route?.statusChannel ? ['missing_operational_retry_status_channel'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(retryScheduled ? ['operational_retry_backoff_active'] : []),
    ...(degradedMode ? ['operational_retry_degraded_mode'] : []),
    ...(exhausted ? ['operational_retry_attempts_exhausted'] : [])
  ]);
  const nextRetryCommand = retryScheduled
    ? {
        commandId: providerCommand?.commandId ?? null,
        target: providerCommand?.target ?? 'provider.mailchimp.retry',
        statusChannel: route?.statusChannel ?? null,
        idempotencyKey: route?.idempotencyKey ?? null,
        afterMs: retryAfterMs,
        attempt: attempt + 1,
        maxAttempts,
        policy: retryWindow.policy ?? operationalHealth?.retry?.backoffPolicy ?? kernelCall?.recovery?.retry?.strategy ?? 'exponential_backoff'
      }
    : null;
  const digestShape = {
    programId,
    operation,
    state,
    status,
    commandId: providerCommand?.commandId ?? null,
    statusChannel: route?.statusChannel ?? null,
    retryScheduled,
    retryAfterMs,
    attempt,
    maxAttempts,
    exhausted,
    degradedMode,
    incidentDigest: operationalIncident?.digest ?? null,
    healthDigest: operationalHealth?.digest ?? null
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operational-retry`,
    programId,
    operation,
    state,
    ready: blockers.length === 0 && state !== 'terminal',
    writeRequired,
    retryScheduled,
    retryAfterMs,
    attempt,
    maxAttempts,
    exhausted,
    degradedMode: degradedMode
      ? {
          mode: degradedMode.mode ?? 'degraded_review',
          allowDispatch: degradedMode.allowDispatch === true,
          requiresAcknowledgement: degradedMode.requiresAcknowledgement === true
        }
      : null,
    providerStatus: providerHealth?.status ?? 'unknown',
    lifecycleState: lifecycleGate?.state ?? 'unknown',
    incidentDigest: operationalIncident?.digest ?? null,
    healthDigest: operationalHealth?.digest ?? null,
    nextRetryCommand,
    blockers,
    warnings,
    nextAction: blockers.length
      ? externalWriteActionForDiagnostic(blockers[0])
      : retryScheduled
        ? 'wait_for_operational_retry_backoff'
        : degradedMode
          ? 'review_degraded_external_write_mode'
          : writeRequired
            ? 'publish_operational_retry_envelope'
            : 'continue_read_only',
    digest: stableHash(digestShape)
  };
}

function buildExternalWriteOperatorHandoffManifest({
  programId,
  operation,
  status,
  writeEffects,
  route,
  lifecycleGate,
  providerHealth,
  providerCommand,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  clientRuntimeAdoption,
  clientRuntimeAdoptionReceipt,
  acceptancePacket,
  persistedStatus,
  statusJournal,
  providerCommandLedger,
  exportLedger,
  replayManifest,
  operatorReadiness,
  operationalHealth,
  analyticsExport,
  routeExportState,
  statusHandoff,
  boundaryTicket,
  boundaryAuditHandoff,
  boundaryRecoveryGuard,
  boundaryPermissionPosture,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const steps = [
    operatorHandoffStep('preview_acceptance', acceptancePacket?.acceptanceState, acceptancePacket?.acceptEnabled === true || !writeRequired, acceptancePacket?.blockers, acceptancePacket?.warnings, acceptancePacket?.digest, acceptancePacket?.nextAction),
    operatorHandoffStep('provider_command', providerCommand?.state, Boolean(providerCommand?.commandId) || !writeRequired, providerCommand?.blockers, providerCommand?.warnings, providerCommand?.commandId, providerCommand?.nextAction),
    operatorHandoffStep('client_request_snapshot', clientRequestSnapshot?.state, clientRequestSnapshot?.ready === true || !writeRequired, clientRequestSnapshot?.blockers, clientRequestSnapshot?.warnings, clientRequestSnapshot?.digest, clientRequestSnapshot?.nextAction),
    operatorHandoffStep('client_runtime_adoption', clientRuntimeAdoption?.state, clientRuntimeAdoption?.ready === true || !writeRequired, clientRuntimeAdoption?.blockers, clientRuntimeAdoption?.warnings, clientRuntimeAdoption?.digest, clientRuntimeAdoption?.nextAction),
    operatorHandoffStep('client_runtime_adoption_receipt', clientRuntimeAdoptionReceipt?.state, clientRuntimeAdoptionReceipt?.ready === true || !writeRequired, clientRuntimeAdoptionReceipt?.blockers, clientRuntimeAdoptionReceipt?.warnings, clientRuntimeAdoptionReceipt?.digest, clientRuntimeAdoptionReceipt?.nextAction),
    operatorHandoffStep('persisted_status', persistedStatus?.state, persistedStatus?.ready === true || !writeRequired, persistedStatus?.blockers, persistedStatus?.warnings, persistedStatus?.digest, persistedStatus?.nextAction),
    operatorHandoffStep('status_journal', statusJournal?.state, statusJournal?.ready === true || !writeRequired, statusJournal?.blockers, statusJournal?.warnings, statusJournal?.digest, statusJournal?.nextAction),
    operatorHandoffStep('provider_command_ledger', providerCommandLedger?.state, providerCommandLedger?.ready === true || !writeRequired, providerCommandLedger?.blockers, providerCommandLedger?.warnings, providerCommandLedger?.digest, providerCommandLedger?.nextAction),
    operatorHandoffStep('export_ledger', exportLedger?.state, exportLedger?.ready === true || !writeRequired, exportLedger?.blockers, exportLedger?.warnings, exportLedger?.digest, exportLedger?.nextAction),
    operatorHandoffStep('replay_manifest', replayManifest?.state, replayManifest?.ready === true || !writeRequired, replayManifest?.blockers, replayManifest?.warnings, replayManifest?.digest, replayManifest?.nextAction),
    operatorHandoffStep('operator_readiness', operatorReadiness?.state, operatorReadiness?.ready === true || !writeRequired, operatorReadiness?.blockers, operatorReadiness?.warnings, operatorReadiness?.digest, operatorReadiness?.primaryAction),
    operatorHandoffStep('status_handoff', statusHandoff?.state, statusHandoff?.ready === true || !writeRequired, statusHandoff?.blockers, statusHandoff?.warnings, statusHandoff?.digest, statusHandoff?.nextAction),
    operatorHandoffStep('route_export', routeExportState?.state, routeExportState?.ready === true || !writeRequired, routeExportState?.blockers, routeExportState?.warnings, routeExportState?.digest, routeExportState?.nextAction),
    operatorHandoffStep('boundary_permission', boundaryPermissionPosture?.state, boundaryPermissionPosture?.ready === true || !writeRequired, boundaryPermissionPosture?.blockers, boundaryPermissionPosture?.warnings, boundaryPermissionPosture?.postureDigest, boundaryPermissionPosture?.nextAction),
    operatorHandoffStep('boundary_recovery', boundaryRecoveryGuard?.state, boundaryRecoveryGuard?.ready === true || !writeRequired, boundaryRecoveryGuard?.blockers, boundaryRecoveryGuard?.warnings, boundaryRecoveryGuard?.guardDigest, boundaryRecoveryGuard?.nextAction)
  ];
  const failed = steps.filter((step) => step.outcome === 'failed');
  const review = steps.filter((step) => step.outcome === 'review');
  const pending = steps.find((step) => step.outcome === 'pending');
  const missingRuntime = [
    ...(!route?.statusChannel && writeRequired ? ['missing_operator_handoff_status_channel'] : []),
    ...(!route?.idempotencyKey && writeRequired ? ['missing_operator_handoff_idempotency_key'] : []),
    ...(!providerCommand?.commandId && writeRequired ? ['missing_operator_handoff_command_id'] : []),
    ...(!clientRuntimeAdoptionReceipt?.digest && writeRequired ? ['missing_operator_handoff_client_adoption_receipt_digest'] : []),
    ...(!statusHandoff?.digest && writeRequired ? ['missing_operator_handoff_status_digest'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_operator_handoff_client_request_digest'] : []),
    ...(!routeExportState?.digest && writeRequired ? ['missing_operator_handoff_route_export_digest'] : []),
    ...(!boundaryTicket?.auditDigest && !boundaryAuditHandoff?.auditDigest && writeRequired ? ['missing_operator_handoff_boundary_audit_digest'] : [])
  ];
  const blockers = uniqueSorted([
    ...failed.flatMap((step) => step.blockers.length ? step.blockers.map((blocker) => `${step.name}_${blocker}`) : [`step_failed:${step.name}`]),
    ...missingRuntime
  ]);
  const warnings = uniqueSorted([
    ...review.flatMap((step) => step.warnings.length ? step.warnings.map((warning) => `${step.name}_${warning}`) : [`step_review:${step.name}`]),
    ...(providerHealth?.degraded ? ['provider_health_degraded'] : []),
    ...(operationalHealth?.degraded ? ['operational_health_degraded'] : []),
    ...(analyticsExport?.warnings ?? []).map((warning) => `analytics_${warning}`),
    ...(lifecycleGate?.warnings ?? []).map((warning) => `lifecycle_${warning}`)
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : lifecycleGate?.state === 'held'
        ? 'held'
        : lifecycleGate?.state === 'scheduled'
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : steps.every((step) => step.outcome === 'ready')
              ? 'ready'
              : 'waiting';
  const commandReady = state === 'ready' || state === 'review';
  const manifestKey = stableHash({
    programId,
    operation,
    statusChannel: route?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    commandId: providerCommand?.commandId ?? null,
    statusDigest: statusHandoff?.digest ?? null,
    routeExportDigest: routeExportState?.digest ?? null,
    boundaryDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null
  });
  const digestShape = {
    programId,
    operation,
    state,
    manifestKey,
    lifecycleState: lifecycleGate?.state ?? null,
    providerStatus: providerHealth?.status ?? null,
    steps: steps.map((step) => `${step.name}:${step.outcome}:${step.digest}`),
    blockers,
    warnings
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operator-handoff-manifest`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    presentationMode: state === 'ready'
      ? 'confirm'
      : state === 'review'
        ? 'review'
        : ['held', 'scheduled'].includes(state)
          ? 'defer'
          : 'repair',
    primaryAction: state === 'blocked'
      ? operatorHandoffAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? acknowledgementActionForWarning(warnings[0])
            : state === 'ready'
              ? 'publish_operator_handoff_manifest'
              : pending?.nextAction ?? 'wait_for_operator_handoff_manifest',
    manifestKey,
    statusChannel: route?.statusChannel ?? statusHandoff?.statusChannel ?? null,
    command: {
      commandId: commandReady ? `operator-handoff:${manifestKey}` : null,
      type: 'publish-operator-handoff-manifest',
      idempotencyKey: commandReady ? stableHash({ action: 'publish-operator-handoff-manifest', manifestKey }) : null,
      statusAfterReplay: commandReady ? 'operator_handoff_manifest_published' : 'operator_handoff_manifest_waiting',
      conflict: 'return-existing'
    },
    runtime: {
      idempotencyKey: route?.idempotencyKey ?? null,
      providerCommandId: providerCommand?.commandId ?? null,
      restartToken: statusHandoff?.restartToken ?? persistedStatus?.restartToken ?? kernelCall?.runtimeState?.profileRestartToken ?? null,
      clientRequestDigest: clientRequestSnapshot?.digest ?? null,
      clientRuntimeAdoptionReceiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
      statusHandoffDigest: statusHandoff?.digest ?? null,
      routeExportDigest: routeExportState?.digest ?? null,
      boundaryAuditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null
    },
    userVisibleStatus: {
      current: statusHandoff?.userVisibleStatus?.current ?? operatorReadiness?.userVisibleStatus ?? statusHandoffUserStatus(state),
      completion: statusHandoff?.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: statusHandoff?.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    steps,
    validationSummary: {
      readyStepCount: steps.filter((step) => step.outcome === 'ready').length,
      totalStepCount: steps.length,
      failedSteps: failed.map((step) => step.name),
      reviewSteps: review.map((step) => step.name),
      firstPendingStep: pending?.name ?? null,
      blockers,
      warnings
    },
    restartSemantics: {
      restartSafe: statusHandoff?.ready === true
        && replayManifest?.restartSafe !== false
        && providerCommandLedger?.duplicateSafe !== false
        && Boolean(route?.idempotencyKey || !writeRequired),
      onRestart: statusHandoff?.ready ? 'load_operator_handoff_manifest' : statusHandoff?.nextAction ?? 'resume_external_write_status_handoff',
      onDuplicateCommand: 'return_existing_operator_handoff_manifest',
      onStaleSnapshot: 'rebuild_operator_handoff_manifest',
      onBoundaryChange: 'invalidate_operator_handoff_manifest'
    },
    audit: {
      channel: route?.auditChannel ?? boundaryAuditHandoff?.auditChannel ?? null,
      tenantId: boundaryTicket?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
      workspaceId: boundaryTicket?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
      role: boundaryTicket?.role ?? kernelCall?.handoff?.scope?.role ?? null,
      isolationKey: boundaryTicket?.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null,
      auditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null
    },
    blockers,
    warnings,
    digest: stableHash(digestShape)
  };
}

function operatorHandoffStep(name, status, ready, blockers = [], warnings = [], digest = null, nextAction = null) {
  const normalizedBlockers = uniqueSorted(asArray(blockers).map((entry) => typeof entry === 'string' ? entry : entry?.code).filter(Boolean));
  const normalizedWarnings = uniqueSorted(asArray(warnings).map((entry) => typeof entry === 'string' ? entry : entry?.code).filter(Boolean));
  const normalizedStatus = status ?? 'unknown';
  const outcome = normalizedBlockers.length || ['blocked', 'failed'].includes(normalizedStatus)
    ? 'failed'
    : normalizedWarnings.length || ['review', 'degraded'].includes(normalizedStatus)
      ? 'review'
      : ready === false
        ? 'pending'
        : 'ready';
  return {
    name,
    status: normalizedStatus,
    ready: ready === true,
    outcome,
    blockers: normalizedBlockers,
    warnings: normalizedWarnings,
    digest: digest ?? null,
    nextAction
  };
}

function buildExternalWriteOperatorDecisionContract({
  programId,
  operation,
  status,
  writeEffects,
  route,
  analyticsDecision,
  operatorHandoffManifest,
  acceptancePacket,
  clientRuntimeAdoptionReceipt,
  statusHandoff,
  routeExportState,
  boundaryDecisionReceipt,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const sourceDecision = analyticsDecision ?? {};
  const sourceAcknowledgement = sourceDecision.acknowledgement ?? {};
  const requiredAcknowledgements = uniqueSorted([
    ...(sourceAcknowledgement.requiredAcknowledgements ?? []),
    ...(acceptancePacket?.requiredAcknowledgements ?? []),
    ...(writeRequired ? ['external_write_preview'] : [])
  ]);
  const missingAcknowledgements = uniqueSorted([
    ...(sourceAcknowledgement.missingAcknowledgements ?? []),
    ...(acceptancePacket?.missingAcknowledgements ?? [])
  ]);
  const sourceBlockers = uniqueSorted([
    ...(sourceDecision.blockers ?? []),
    ...(operatorHandoffManifest?.blockers ?? []).map((blocker) => `operator_handoff_${blocker}`),
    ...(boundaryDecisionReceipt?.release?.allowed === false && writeRequired ? ['boundary_release_not_allowed'] : []),
    ...(!route?.statusChannel && writeRequired ? ['missing_operator_decision_status_channel'] : []),
    ...(!route?.idempotencyKey && writeRequired ? ['missing_operator_decision_idempotency_key'] : []),
    ...(!statusHandoff?.digest && writeRequired ? ['missing_operator_decision_status_digest'] : []),
    ...(!routeExportState?.digest && writeRequired ? ['missing_operator_decision_route_export_digest'] : []),
    ...(!clientRuntimeAdoptionReceipt?.digest && writeRequired ? ['missing_operator_decision_client_receipt_digest'] : [])
  ]);
  const sourceWarnings = uniqueSorted([
    ...(sourceDecision.warnings ?? []),
    ...(operatorHandoffManifest?.warnings ?? []).map((warning) => `operator_handoff_${warning}`),
    ...(boundaryDecisionReceipt?.state === 'review' ? ['boundary_decision_requires_review'] : []),
    ...(status === 'review' ? ['external_write_status_review'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : sourceBlockers.length
      ? 'blocked'
      : missingAcknowledgements.length
        ? 'pending_acknowledgement'
        : sourceDecision.state === 'release_ready' && operatorHandoffManifest?.ready === true
          ? 'release_ready'
          : sourceWarnings.length || sourceDecision.state === 'pending_acknowledgement'
            ? 'pending_acknowledgement'
            : operatorHandoffManifest?.state === 'held'
              ? 'held'
              : operatorHandoffManifest?.state === 'scheduled'
                ? 'scheduled'
                : 'waiting';
  const ready = state === 'release_ready' || state === 'not_required';
  const evidence = {
    analyticsDecisionDigest: sourceDecision.digest ?? null,
    operatorHandoffDigest: operatorHandoffManifest?.digest ?? null,
    clientRuntimeAdoptionReceiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
    statusHandoffDigest: statusHandoff?.digest ?? null,
    routeExportDigest: routeExportState?.digest ?? null,
    boundaryDecisionDigest: boundaryDecisionReceipt?.receiptDigest ?? null,
    kernelPreviewDigest: kernelCall?.preview?.digest ?? null
  };
  const decisionInputs = {
    programId,
    operation,
    routeKey: route?.routeKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    sourceCommandId: sourceDecision.command?.commandId ?? null,
    operatorHandoffCommandId: operatorHandoffManifest?.command?.commandId ?? null,
    clientReceiptKey: clientRuntimeAdoptionReceipt?.receiptKey ?? null,
    boundaryDecision: boundaryDecisionReceipt?.decision ?? null
  };
  const digest = stableHash({
    schema: 'external-write-root-operator-decision',
    state,
    decisionInputs,
    evidence,
    requiredAcknowledgements,
    missingAcknowledgements,
    sourceBlockers,
    sourceWarnings
  });
  const commandId = ready && writeRequired
    ? sourceDecision.command?.commandId ?? `operator-release:${digest}`
    : null;
  const idempotencyKey = ready && writeRequired
    ? sourceDecision.command?.idempotencyKey ?? stableHash({ action: 'accept_and_release_mailchimp_write', digest, routeKey: route?.routeKey ?? null })
    : null;
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operator-decision-root`,
    programId,
    operation,
    state,
    ready,
    writeRequired,
    presentationMode: state === 'release_ready'
      ? 'confirm'
      : state === 'pending_acknowledgement'
        ? 'acknowledge'
        : state === 'blocked'
          ? 'repair'
          : ['held', 'scheduled'].includes(state)
            ? 'defer'
            : 'status',
    primaryCommand: state === 'blocked'
      ? externalWriteActionForDiagnostic(sourceBlockers[0])
      : state === 'pending_acknowledgement'
        ? 'collect_operator_acknowledgement'
        : state === 'held'
          ? 'await_manual_release'
          : state === 'scheduled'
            ? 'wait_for_schedule_window'
            : state === 'release_ready'
              ? 'accept_and_release_mailchimp_write'
              : writeRequired
                ? 'wait_for_operator_decision_contract'
                : 'continue_read_only',
    command: {
      type: 'mailchimp.external_write.operator_decision',
      commandId,
      idempotencyKey,
      statusAfterReplay: ready && writeRequired ? 'external_write_release_accepted' : state,
      conflict: 'return-existing',
      requiredInputs: writeRequired
        ? ['programId', 'operation', 'statusChannel', 'idempotencyKey', 'operatorHandoffDigest', 'statusHandoffDigest']
        : []
    },
    acknowledgement: {
      required: writeRequired && (state === 'pending_acknowledgement' || requiredAcknowledgements.length > 0),
      token: sourceAcknowledgement.token ?? (writeRequired ? stableHash({ type: 'operator-decision-root-ack', digest, requiredAcknowledgements }) : null),
      requiredAcknowledgements,
      missingAcknowledgements,
      reason: missingAcknowledgements.length
        ? 'operator_acknowledgement_missing'
        : sourceWarnings.length
          ? 'external_write_review_required'
          : writeRequired
            ? 'external_write_confirmation_required'
            : null
    },
    userVisibleStatus: {
      current: statusHandoff?.userVisibleStatus?.current ?? sourceDecision.status?.current ?? operatorHandoffManifest?.userVisibleStatus?.current ?? statusHandoffUserStatus(state),
      completion: statusHandoff?.userVisibleStatus?.completion ?? sourceDecision.status?.completion ?? 'mailchimp_write_synced',
      failure: statusHandoff?.userVisibleStatus?.failure ?? sourceDecision.status?.failure ?? 'mailchimp_write_needs_review'
    },
    decisionInputs,
    evidence,
    validationSummary: {
      ok: sourceBlockers.length === 0 && (!writeRequired || Boolean(digest)),
      blockerCount: sourceBlockers.length,
      warningCount: sourceWarnings.length,
      missingAcknowledgementCount: missingAcknowledgements.length,
      handoffReady: operatorHandoffManifest?.ready === true || !writeRequired,
      boundaryReleaseAllowed: boundaryDecisionReceipt?.release?.allowed === true || !writeRequired,
      restartSafe: operatorHandoffManifest?.restartSemantics?.restartSafe === true || !writeRequired
    },
    restartSemantics: {
      restartSafe: (operatorHandoffManifest?.restartSemantics?.restartSafe === true || !writeRequired) && Boolean(route?.idempotencyKey || !writeRequired),
      onRestart: ready ? 'load_operator_decision_contract' : operatorHandoffManifest?.restartSemantics?.onRestart ?? 'resume_operator_handoff_manifest',
      onDuplicateCommand: 'return_existing_operator_decision',
      onStaleSnapshot: 'rebuild_operator_decision_from_status_handoff',
      onBoundaryChange: 'invalidate_operator_decision_contract'
    },
    blockers: sourceBlockers,
    warnings: sourceWarnings,
    nextAction: ready
      ? writeRequired ? 'accept_and_release_mailchimp_write' : 'continue_read_only'
      : state === 'blocked'
        ? externalWriteActionForDiagnostic(sourceBlockers[0])
        : state === 'pending_acknowledgement'
          ? 'collect_operator_acknowledgement'
          : operatorHandoffManifest?.primaryAction ?? sourceDecision.nextAction ?? 'wait_for_operator_decision_contract',
    digest
  };
}

function validateExternalWriteOperatorDecisionContract(decision, writeEffects) {
  if (!writeEffects.length && !decision) return [];
  const diagnostics = [];
  if (!decision) return [{ level: 'error', code: 'external_write_missing_operator_decision_contract' }];
  if (writeEffects.length && decision.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_decision_not_write_required' });
  }
  if (writeEffects.length && !decision.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_decision_missing_digest' });
  }
  if (decision.ready && decision.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_decision_ready_with_blockers', blockers: decision.blockers });
  }
  if (decision.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_operator_decision_contract_blocked', blockers: decision.blockers ?? [] });
  }
  if (decision.ready && writeEffects.length && !decision.command?.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_decision_contract_missing_command' });
  }
  if (decision.ready && writeEffects.length && decision.restartSemantics?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_decision_not_restart_safe' });
  }
  if (decision.acknowledgement?.required && !decision.acknowledgement?.token) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_decision_missing_acknowledgement_token' });
  }
  if (decision.state === 'pending_acknowledgement' || decision.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_operator_decision_requires_acknowledgement', warnings: decision.warnings ?? [] });
  }
  return diagnostics;
}

function validateExternalWriteOperatorHandoffManifest(manifest, writeEffects) {
  if (!writeEffects.length && !manifest) return [];
  const diagnostics = [];
  if (!manifest) return [{ level: 'error', code: 'external_write_missing_operator_handoff_manifest' }];
  if (writeEffects.length && manifest.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_handoff_not_write_required' });
  }
  if (manifest.ready && manifest.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_handoff_ready_with_blockers', blockers: manifest.blockers });
  }
  if (manifest.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_operator_handoff_blocked', blockers: manifest.blockers ?? [] });
  }
  if (writeEffects.length && !manifest.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_handoff_missing_status_channel' });
  }
  if (writeEffects.length && !manifest.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_handoff_missing_digest' });
  }
  if ((manifest.state === 'ready' || manifest.state === 'review') && !manifest.command?.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_handoff_missing_command' });
  }
  if (manifest.ready && manifest.validationSummary?.readyStepCount !== manifest.validationSummary?.totalStepCount) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_handoff_ready_with_unready_steps' });
  }
  if (manifest.ready && writeEffects.length && manifest.restartSemantics?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_handoff_not_restart_safe' });
  }
  if (manifest.state === 'review' || manifest.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_operator_handoff_review', warnings: manifest.warnings ?? [] });
  }
  return diagnostics;
}

function operatorHandoffAction(blocker) {
  if (String(blocker).includes('status_channel')) return 'configure_operator_status_channel';
  if (String(blocker).includes('idempotency')) return 'provide_operator_handoff_idempotency_key';
  if (String(blocker).includes('command')) return 'rebuild_provider_command';
  if (String(blocker).includes('boundary')) return 'resolve_boundary_permission_handoff';
  if (String(blocker).includes('client_request')) return 'persist_client_request_snapshot';
  if (String(blocker).includes('route_export')) return 'publish_route_export_state';
  return 'resolve_operator_handoff_manifest';
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

function buildBoundaryPermissionPosture({
  programId,
  operation,
  route,
  scope,
  permissionBoundary,
  kernelCall,
  writeEffects,
  boundaryTicket,
  boundaryAuditHandoff,
  boundaryRecoveryGuard
}) {
  const normalizedScope = normalizeScope(scope);
  const handoffScope = normalizeScope(kernelCall?.handoff?.scope ?? {});
  const boundary = permissionBoundary ?? kernelCall?.handoff?.permissionBoundary ?? kernelCall?.lifecycle?.permissionBoundary ?? {};
  const writeRequired = writeEffects.length > 0;
  const allowedEffects = normalizeEffects([
    ...(boundary?.permissions?.allowedEffects ?? []),
    ...(kernelCall?.capabilities?.allowedEffects ?? [])
  ]);
  const deniedEffects = normalizeDeniedEffects([
    ...(boundary?.permissions?.deniedEffects ?? []),
    ...(kernelCall?.capabilities?.deniedEffects ?? [])
  ]).map((effect) => effect.effect);
  const requiredEffects = normalizeEffects(writeEffects);
  const missingAllowed = requiredEffects.filter((effect) => {
    if (allowedEffects.includes(effect) || allowedEffects.includes('mailchimp.write')) return false;
    return !allowedEffects.some((allowed) => effect.startsWith(`${allowed}.`) || effect.startsWith(`${allowed}:`));
  });
  const deniedRequired = requiredEffects.filter((effect) => deniedEffects.includes(effect));
  const role = normalizedScope.role ?? handoffScope.role ?? boundaryTicket?.role ?? 'automation_worker';
  const rolePolicy = normalizeRolePolicy(boundary?.roles ?? boundary?.rolePolicy, role);
  const requiredAcknowledgements = uniqueSorted([
    ...(boundaryAuditHandoff?.requiredAcknowledgements ?? []),
    ...(writeRequired ? ['external_write'] : []),
    ...(rolePolicy.requiresAcknowledgement ? [`role:${role}`] : []),
    ...(deniedRequired.length || missingAllowed.length ? ['permission_exception'] : [])
  ]);
  const observedAcknowledgements = normalizeAcknowledgements([
    ...(boundaryAuditHandoff?.acknowledgements ?? []),
    ...(kernelCall?.handoff?.audit?.acknowledgements ?? [])
  ]);
  const missingAcknowledgements = requiredAcknowledgements.filter((ack) => !observedAcknowledgements.includes(ack));
  const tenantId = normalizedScope.tenantId ?? handoffScope.tenantId ?? boundaryTicket?.tenantId ?? null;
  const workspaceId = normalizedScope.workspaceId ?? handoffScope.workspaceId ?? boundaryTicket?.workspaceId ?? null;
  const isolationKey = route?.isolationKey ?? handoffScope.isolationKey ?? boundaryTicket?.isolationKey ?? null;
  const scopeVector = {
    tenantBound: Boolean(tenantId),
    workspaceBound: Boolean(workspaceId),
    isolationBound: Boolean(isolationKey),
    handoffTenantMatches: !handoffScope.tenantId || !tenantId || handoffScope.tenantId === tenantId,
    handoffWorkspaceMatches: !handoffScope.workspaceId || !workspaceId || handoffScope.workspaceId === workspaceId,
    handoffIsolationMatches: !handoffScope.isolationKey || !isolationKey || handoffScope.isolationKey === isolationKey,
    auditScopeMatched: boundaryTicket?.boundaryChecks?.auditMatches !== false
  };
  const guardVector = {
    ticketReady: boundaryTicket?.ready === true || !writeRequired,
    auditReady: boundaryAuditHandoff?.ready === true || !writeRequired,
    recoveryGuardReady: boundaryRecoveryGuard?.ready === true || !writeRequired,
    recoveryRetryable: boundaryRecoveryGuard?.retryable !== false,
    replayPolicy: boundaryRecoveryGuard?.replayPolicy ?? (writeRequired ? 'unknown' : 'read_only_no_guard')
  };
  const blockers = uniqueSorted([
    ...(writeRequired && !scopeVector.tenantBound ? ['permission_posture_missing_tenant'] : []),
    ...(writeRequired && !scopeVector.workspaceBound ? ['permission_posture_missing_workspace'] : []),
    ...(writeRequired && !scopeVector.isolationBound ? ['permission_posture_missing_isolation'] : []),
    ...(!scopeVector.handoffTenantMatches ? ['permission_posture_tenant_mismatch'] : []),
    ...(!scopeVector.handoffWorkspaceMatches ? ['permission_posture_workspace_mismatch'] : []),
    ...(!scopeVector.handoffIsolationMatches ? ['permission_posture_isolation_mismatch'] : []),
    ...(!scopeVector.auditScopeMatched ? ['permission_posture_audit_scope_mismatch'] : []),
    ...(rolePolicy.allowed ? [] : ['permission_posture_role_not_allowed']),
    ...(deniedRequired.length ? ['permission_posture_denied_write_effect'] : []),
    ...(missingAllowed.length ? ['permission_posture_missing_allowed_write_effect'] : []),
    ...(writeRequired && !guardVector.ticketReady ? ['permission_posture_boundary_ticket_not_ready'] : []),
    ...(writeRequired && !guardVector.auditReady ? ['permission_posture_audit_handoff_not_ready'] : []),
    ...(writeRequired && !guardVector.recoveryGuardReady ? ['permission_posture_recovery_guard_not_ready'] : []),
    ...(writeRequired && !guardVector.recoveryRetryable ? ['permission_posture_recovery_guard_not_retryable'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(missingAcknowledgements.length ? ['permission_posture_acknowledgement_missing'] : []),
    ...(rolePolicy.requiresAcknowledgement ? ['permission_posture_role_requires_acknowledgement'] : []),
    ...((boundaryTicket?.warnings ?? []).map((warning) => `ticket_${warning}`)),
    ...((boundaryAuditHandoff?.warnings ?? []).map((warning) => `audit_${warning}`)),
    ...((boundaryRecoveryGuard?.warnings ?? []).map((warning) => `guard_${warning}`))
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const escalations = uniqueSorted([
    ...(blockers.map(boundaryPermissionEscalation)),
    ...((boundaryAuditHandoff?.escalations ?? []).map((escalation) => `audit_${escalation}`))
  ]);
  const postureShape = {
    programId,
    operation,
    state,
    tenantId,
    workspaceId,
    isolationKey,
    role,
    permissionMode: boundaryTicket?.permissionMode ?? boundary?.mode ?? 'unknown',
    requiredEffects,
    allowedEffects,
    deniedEffects,
    missingAllowed,
    deniedRequired,
    requiredAcknowledgements,
    missingAcknowledgements,
    guardVector
  };
  const postureDigest = stableHash(postureShape);
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.boundary-permission-posture`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    tenantId,
    workspaceId,
    isolationKey,
    role,
    permissionMode: postureShape.permissionMode,
    effectAccess: {
      required: requiredEffects,
      allowed: allowedEffects,
      denied: deniedEffects,
      deniedRequired,
      missingAllowed
    },
    rolePolicy,
    scopeVector,
    guardVector,
    auditDigest: boundaryAuditHandoff?.auditDigest ?? boundaryTicket?.auditDigest ?? null,
    postureDigest,
    requiredAcknowledgements,
    observedAcknowledgements,
    missingAcknowledgements,
    escalations,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? boundaryPermissionAction(blockers[0])
      : state === 'review'
        ? 'collect_permission_boundary_acknowledgement'
        : state === 'ready'
          ? 'publish_permission_posture_handoff'
          : 'continue_read_only'
  };
}

function validateBoundaryPermissionPosture(posture, writeEffects) {
  if (!writeEffects.length && !posture) return [];
  const diagnostics = [];
  if (!posture) return [{ level: 'error', code: 'external_write_missing_boundary_permission_posture' }];
  if (writeEffects.length && posture.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_permission_posture_not_write_required' });
  }
  if (posture.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_boundary_permission_posture_blocked',
      blockers: posture.blockers ?? []
    });
  }
  if (posture.ready && writeEffects.length && !posture.postureDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_permission_posture_missing_digest' });
  }
  if (posture.ready && writeEffects.length && posture.effectAccess?.deniedRequired?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_boundary_permission_posture_ready_with_denied_effects',
      deniedEffects: posture.effectAccess.deniedRequired
    });
  }
  if (posture.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_boundary_permission_posture_requires_review',
      warnings: posture.warnings ?? [],
      missingAcknowledgements: posture.missingAcknowledgements ?? []
    });
  }
  return diagnostics;
}

function buildBoundaryDecisionReceipt({
  programId,
  operation,
  route,
  writeEffects,
  boundaryTicket,
  boundaryAuditHandoff,
  boundaryRecoveryGuard,
  boundaryPermissionPosture,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const posture = boundaryPermissionPosture ?? {};
  const requiredEvidence = writeRequired
    ? ['boundary_ticket', 'boundary_audit', 'boundary_recovery_guard', 'permission_posture']
    : [];
  const evidence = [
    boundaryDecisionEvidence('boundary_ticket', boundaryTicket?.state, boundaryTicket?.auditDigest, boundaryTicket?.ready, boundaryTicket?.blockers, boundaryTicket?.warnings),
    boundaryDecisionEvidence('boundary_audit', boundaryAuditHandoff?.state, boundaryAuditHandoff?.auditDigest, boundaryAuditHandoff?.ready, boundaryAuditHandoff?.blockers, boundaryAuditHandoff?.warnings),
    boundaryDecisionEvidence('boundary_recovery_guard', boundaryRecoveryGuard?.state, boundaryRecoveryGuard?.guardDigest, boundaryRecoveryGuard?.ready, boundaryRecoveryGuard?.blockers, boundaryRecoveryGuard?.warnings),
    boundaryDecisionEvidence('permission_posture', posture.state, posture.postureDigest, posture.ready, posture.blockers, posture.warnings)
  ].filter((entry) => writeRequired || entry.digest || entry.state !== 'unknown');
  const missingEvidence = requiredEvidence.filter((name) => {
    const entry = evidence.find((item) => item.name === name);
    return !entry?.digest;
  });
  const blockers = uniqueSorted([
    ...missingEvidence.map((name) => `boundary_decision_missing_${name}_digest`),
    ...((boundaryTicket?.blockers ?? []).map((blocker) => `ticket_${blocker}`)),
    ...((boundaryAuditHandoff?.blockers ?? []).map((blocker) => `audit_${blocker}`)),
    ...((boundaryRecoveryGuard?.blockers ?? []).map((blocker) => `guard_${blocker}`)),
    ...((posture.blockers ?? []).map((blocker) => `posture_${blocker}`)),
    ...(writeRequired && boundaryTicket?.ready !== true ? ['boundary_decision_ticket_not_ready'] : []),
    ...(writeRequired && boundaryAuditHandoff?.ready !== true ? ['boundary_decision_audit_not_ready'] : []),
    ...(writeRequired && boundaryRecoveryGuard?.ready !== true ? ['boundary_decision_recovery_guard_not_ready'] : []),
    ...(writeRequired && posture.ready !== true ? ['boundary_decision_permission_posture_not_ready'] : []),
    ...(writeRequired && boundaryRecoveryGuard?.retryable === false ? ['boundary_decision_recovery_guard_not_retryable'] : [])
  ]);
  const warnings = uniqueSorted([
    ...((boundaryTicket?.warnings ?? []).map((warning) => `ticket_${warning}`)),
    ...((boundaryAuditHandoff?.warnings ?? []).map((warning) => `audit_${warning}`)),
    ...((boundaryRecoveryGuard?.warnings ?? []).map((warning) => `guard_${warning}`)),
    ...((posture.warnings ?? []).map((warning) => `posture_${warning}`)),
    ...((posture.missingAcknowledgements ?? []).map((ack) => `missing_ack:${ack}`))
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const decision = state === 'ready'
    ? 'release'
    : state === 'review'
      ? 'hold_for_acknowledgement'
      : state === 'blocked'
        ? 'deny'
        : 'not_required';
  const receiptShape = {
    programId,
    operation,
    state,
    decision,
    tenantId: posture.tenantId ?? boundaryTicket?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
    workspaceId: posture.workspaceId ?? boundaryTicket?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
    isolationKey: posture.isolationKey ?? boundaryTicket?.isolationKey ?? route?.isolationKey ?? null,
    role: posture.role ?? boundaryTicket?.role ?? kernelCall?.handoff?.scope?.role ?? null,
    permissionMode: posture.permissionMode ?? boundaryTicket?.permissionMode ?? 'unknown',
    effectAccess: posture.effectAccess ?? {},
    evidence: evidence.map((entry) => ({
      name: entry.name,
      state: entry.state,
      digest: entry.digest,
      ready: entry.ready
    })),
    blockers,
    warnings
  };
  const receiptDigest = stableHash(receiptShape);
  const command = writeRequired
    ? {
        type: 'mailchimp.external_write.boundary_decision',
        commandId: `boundary-decision:${receiptDigest}`,
        idempotencyKey: stableHash({
          programId,
          operation,
          receiptDigest,
          idempotencyKey: kernelCall?.handoff?.idempotencyKey ?? null
        }),
        statusAfterReplay: decision === 'release'
          ? 'boundary_release_recorded'
          : decision === 'hold_for_acknowledgement'
            ? 'boundary_acknowledgement_required'
            : 'boundary_release_denied',
        conflict: 'return-existing',
        requiredInputs: uniqueSorted([
          ...missingEvidence.map((name) => `${name}.digest`),
          ...((posture.missingAcknowledgements ?? []).map((ack) => `acknowledgement:${ack}`))
        ])
      }
    : null;
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.boundary-decision-receipt`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    decision,
    release: {
      allowed: decision === 'release',
      requiresAcknowledgement: decision === 'hold_for_acknowledgement',
      denied: decision === 'deny',
      replayPolicy: boundaryRecoveryGuard?.replayPolicy ?? posture.guardVector?.replayPolicy ?? (writeRequired ? 'unknown' : 'read_only_no_guard')
    },
    tenantId: receiptShape.tenantId,
    workspaceId: receiptShape.workspaceId,
    isolationKey: receiptShape.isolationKey,
    role: receiptShape.role,
    permissionMode: receiptShape.permissionMode,
    effectAccess: stableClone(receiptShape.effectAccess),
    evidence,
    missingEvidence,
    command,
    blockers,
    warnings,
    receiptDigest,
    nextAction: state === 'blocked'
      ? boundaryDecisionAction(blockers[0])
      : state === 'review'
        ? 'collect_boundary_decision_acknowledgement'
        : state === 'ready'
          ? 'publish_boundary_decision_receipt'
          : 'continue_read_only'
  };
}

function boundaryDecisionEvidence(name, state, digest, ready, blockers = [], warnings = []) {
  return {
    name,
    state: state ?? 'unknown',
    ready: ready === true,
    digest: digest ?? null,
    blockers: uniqueSorted(blockers ?? []),
    warnings: uniqueSorted(warnings ?? [])
  };
}

function validateBoundaryDecisionReceipt(receipt, writeEffects) {
  if (!writeEffects.length && !receipt) return [];
  const diagnostics = [];
  if (!receipt) return [{ level: 'error', code: 'external_write_missing_boundary_decision_receipt' }];
  if (writeEffects.length && receipt.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_decision_not_write_required' });
  }
  if (receipt.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_boundary_decision_blocked',
      blockers: receipt.blockers ?? []
    });
  }
  if (receipt.ready && writeEffects.length && !receipt.receiptDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_decision_missing_digest' });
  }
  if (receipt.ready && writeEffects.length && receipt.release?.allowed !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_decision_ready_without_release' });
  }
  if (receipt.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_boundary_decision_requires_acknowledgement',
      warnings: receipt.warnings ?? []
    });
  }
  return diagnostics;
}

function buildBoundaryReleaseGate({
  programId,
  operation,
  route,
  writeEffects,
  boundaryTicket,
  boundaryAuditHandoff,
  boundaryRecoveryGuard,
  boundaryPermissionPosture,
  boundaryDecisionReceipt,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const decision = boundaryDecisionReceipt ?? {};
  const posture = boundaryPermissionPosture ?? {};
  const scope = {
    tenantId: decision.tenantId ?? posture.tenantId ?? boundaryTicket?.tenantId ?? route?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
    workspaceId: decision.workspaceId ?? posture.workspaceId ?? boundaryTicket?.workspaceId ?? route?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
    isolationKey: decision.isolationKey ?? posture.isolationKey ?? boundaryTicket?.isolationKey ?? route?.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null,
    role: decision.role ?? posture.role ?? boundaryTicket?.role ?? kernelCall?.handoff?.scope?.role ?? null
  };
  const requiredAcknowledgements = uniqueSorted([
    ...(posture.requiredAcknowledgements ?? []),
    ...(boundaryAuditHandoff?.requiredAcknowledgements ?? []),
    ...(decision.release?.requiresAcknowledgement ? ['boundary_release'] : []),
    ...(writeRequired ? ['external_write'] : [])
  ]);
  const observedAcknowledgements = uniqueSorted([
    ...(posture.observedAcknowledgements ?? []),
    ...(boundaryAuditHandoff?.acknowledgements ?? []),
    ...(boundaryTicket?.audit?.acknowledgements ?? []),
    ...(kernelCall?.handoff?.audit?.acknowledgements ?? [])
  ]);
  const missingAcknowledgements = uniqueSorted([
    ...(posture.missingAcknowledgements ?? []),
    ...requiredAcknowledgements.filter((acknowledgement) => !observedAcknowledgements.includes(acknowledgement))
  ]);
  const evidence = [
    releaseGateEvidence('boundary_ticket', boundaryTicket?.state, boundaryTicket?.auditDigest, boundaryTicket?.ready, boundaryTicket?.blockers, boundaryTicket?.warnings),
    releaseGateEvidence('boundary_audit', boundaryAuditHandoff?.state, boundaryAuditHandoff?.auditDigest, boundaryAuditHandoff?.ready, boundaryAuditHandoff?.blockers, boundaryAuditHandoff?.warnings),
    releaseGateEvidence('boundary_recovery_guard', boundaryRecoveryGuard?.state, boundaryRecoveryGuard?.guardDigest, boundaryRecoveryGuard?.ready, boundaryRecoveryGuard?.blockers, boundaryRecoveryGuard?.warnings),
    releaseGateEvidence('permission_posture', posture.state, posture.postureDigest, posture.ready, posture.blockers, posture.warnings),
    releaseGateEvidence('boundary_decision_receipt', decision.state, decision.receiptDigest, decision.ready, decision.blockers, decision.warnings)
  ].filter((entry) => writeRequired || entry.digest || entry.state !== 'unknown');
  const missingEvidence = writeRequired
    ? evidence.filter((entry) => !entry.digest).map((entry) => entry.name)
    : [];
  const blockers = uniqueSorted([
    ...missingEvidence.map((name) => `release_gate_missing_${name}_digest`),
    ...((boundaryTicket?.blockers ?? []).map((blocker) => `ticket_${blocker}`)),
    ...((boundaryAuditHandoff?.blockers ?? []).map((blocker) => `audit_${blocker}`)),
    ...((boundaryRecoveryGuard?.blockers ?? []).map((blocker) => `guard_${blocker}`)),
    ...((posture.blockers ?? []).map((blocker) => `posture_${blocker}`)),
    ...((decision.blockers ?? []).map((blocker) => `decision_${blocker}`)),
    ...(writeRequired && !scope.tenantId ? ['release_gate_missing_tenant'] : []),
    ...(writeRequired && !scope.workspaceId ? ['release_gate_missing_workspace'] : []),
    ...(writeRequired && !scope.isolationKey ? ['release_gate_missing_isolation'] : []),
    ...(writeRequired && boundaryTicket?.ready !== true ? ['release_gate_boundary_ticket_not_ready'] : []),
    ...(writeRequired && boundaryAuditHandoff?.ready !== true ? ['release_gate_boundary_audit_not_ready'] : []),
    ...(writeRequired && boundaryRecoveryGuard?.ready !== true ? ['release_gate_boundary_recovery_guard_not_ready'] : []),
    ...(writeRequired && posture.ready !== true ? ['release_gate_permission_posture_not_ready'] : []),
    ...(writeRequired && decision.ready !== true ? ['release_gate_boundary_decision_not_ready'] : []),
    ...(writeRequired && decision.release?.allowed !== true ? ['release_gate_boundary_release_not_allowed'] : []),
    ...(writeRequired && boundaryRecoveryGuard?.retryable === false ? ['release_gate_recovery_guard_not_retryable'] : [])
  ]);
  const warnings = uniqueSorted([
    ...((boundaryTicket?.warnings ?? []).map((warning) => `ticket_${warning}`)),
    ...((boundaryAuditHandoff?.warnings ?? []).map((warning) => `audit_${warning}`)),
    ...((boundaryRecoveryGuard?.warnings ?? []).map((warning) => `guard_${warning}`)),
    ...((posture.warnings ?? []).map((warning) => `posture_${warning}`)),
    ...((decision.warnings ?? []).map((warning) => `decision_${warning}`)),
    ...(missingAcknowledgements.length ? ['release_gate_acknowledgement_missing'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : missingAcknowledgements.length || warnings.length
        ? 'review'
        : 'ready';
  const gateDigest = stableHash({
    programId,
    operation,
    state,
    scope,
    decision: decision.decision ?? null,
    releaseAllowed: decision.release?.allowed === true,
    writeEffects,
    evidence: evidence.map((entry) => `${entry.name}:${entry.state}:${entry.digest}:${entry.ready}`),
    requiredAcknowledgements,
    missingAcknowledgements,
    blockers,
    warnings
  });
  const releaseAllowed = state === 'ready' && decision.release?.allowed === true;
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.boundary-release-gate`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    releaseAllowed,
    scope,
    replayPolicy: boundaryRecoveryGuard?.replayPolicy ?? decision.release?.replayPolicy ?? (writeRequired ? 'unknown' : 'read_only_no_guard'),
    decision: decision.decision ?? (writeRequired ? 'unknown' : 'not_required'),
    decisionReceiptDigest: decision.receiptDigest ?? null,
    postureDigest: posture.postureDigest ?? null,
    auditDigest: boundaryAuditHandoff?.auditDigest ?? boundaryTicket?.auditDigest ?? null,
    guardDigest: boundaryRecoveryGuard?.guardDigest ?? null,
    evidence,
    missingEvidence,
    requiredAcknowledgements,
    observedAcknowledgements,
    missingAcknowledgements,
    command: writeRequired && (state === 'ready' || state === 'review')
      ? {
          type: 'mailchimp.external_write.boundary_release_gate',
          commandId: `boundary-release:${gateDigest}`,
          idempotencyKey: stableHash({
            action: 'mailchimp.external_write.boundary_release_gate',
            gateDigest,
            routeKey: route?.routeKey ?? null,
            idempotencyKey: kernelCall?.handoff?.idempotencyKey ?? null
          }),
          statusAfterReplay: releaseAllowed ? 'boundary_release_gate_open' : 'boundary_release_gate_review',
          conflict: 'return-existing',
          requiredInputs: missingAcknowledgements.map((acknowledgement) => `acknowledgement:${acknowledgement}`)
        }
      : null,
    restartSemantics: {
      restartSafe: (releaseAllowed || !writeRequired)
        && boundaryRecoveryGuard?.retryable !== false
        && Boolean(route?.idempotencyKey || kernelCall?.handoff?.idempotencyKey || !writeRequired),
      onRestart: state === 'blocked'
        ? 'reload_boundary_release_gate_before_provider_replay'
        : state === 'review'
          ? 'collect_boundary_release_acknowledgement'
          : releaseAllowed
            ? 'reuse_boundary_release_gate'
            : 'continue_read_only',
      onDuplicateCommand: 'return_existing_boundary_release_gate',
      onScopeMutation: 'invalidate_boundary_release_gate',
      onPermissionMutation: 'invalidate_boundary_release_gate'
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? boundaryReleaseGateAction(blockers[0])
      : state === 'review'
        ? 'collect_boundary_release_acknowledgement'
        : releaseAllowed
          ? 'open_boundary_release_gate'
          : 'continue_read_only',
    gateDigest
  };
}

function releaseGateEvidence(name, state, digest, ready, blockers = [], warnings = []) {
  return {
    name,
    state: state ?? 'unknown',
    ready: ready === true,
    digest: digest ?? null,
    blockers: uniqueSorted(blockers ?? []),
    warnings: uniqueSorted(warnings ?? [])
  };
}

function validateBoundaryReleaseGate(gate, writeEffects) {
  if (!writeEffects.length && !gate) return [];
  const diagnostics = [];
  if (!gate) return [{ level: 'error', code: 'external_write_missing_boundary_release_gate' }];
  if (writeEffects.length && gate.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_release_gate_not_write_required' });
  }
  if (gate.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_boundary_release_gate_blocked',
      blockers: gate.blockers ?? []
    });
  }
  if (gate.ready && writeEffects.length && !gate.gateDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_release_gate_missing_digest' });
  }
  if (gate.ready && writeEffects.length && gate.releaseAllowed !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_release_gate_ready_without_release' });
  }
  if (gate.ready && writeEffects.length && gate.restartSemantics?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_boundary_release_gate_not_restart_safe' });
  }
  if (gate.state === 'review' || gate.missingAcknowledgements?.length) {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_boundary_release_gate_requires_acknowledgement',
      missingAcknowledgements: gate.missingAcknowledgements ?? []
    });
  }
  return diagnostics;
}

function buildWorkspacePermissionHandoff({
  programId,
  operation,
  route,
  scope,
  writeEffects,
  boundaryTicket,
  boundaryAuditHandoff,
  boundaryRecoveryGuard,
  boundaryPermissionPosture,
  boundaryDecisionReceipt,
  boundaryReleaseGate,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const normalizedScope = normalizeScope(scope);
  const handoffScope = normalizeScope(kernelCall?.handoff?.scope ?? {});
  const releaseScope = boundaryReleaseGate?.scope ?? {};
  const tenantId = normalizedScope.tenantId
    ?? releaseScope.tenantId
    ?? boundaryPermissionPosture?.tenantId
    ?? boundaryTicket?.tenantId
    ?? handoffScope.tenantId
    ?? null;
  const workspaceId = normalizedScope.workspaceId
    ?? releaseScope.workspaceId
    ?? boundaryPermissionPosture?.workspaceId
    ?? boundaryTicket?.workspaceId
    ?? handoffScope.workspaceId
    ?? null;
  const isolationKey = route?.isolationKey
    ?? releaseScope.isolationKey
    ?? boundaryPermissionPosture?.isolationKey
    ?? boundaryTicket?.isolationKey
    ?? handoffScope.isolationKey
    ?? null;
  const role = normalizedScope.role
    ?? releaseScope.role
    ?? boundaryPermissionPosture?.role
    ?? boundaryTicket?.role
    ?? handoffScope.role
    ?? 'automation_worker';
  const sourceDigests = {
    boundaryTicket: boundaryTicket?.auditDigest ?? null,
    boundaryAudit: boundaryAuditHandoff?.auditDigest ?? null,
    boundaryRecoveryGuard: boundaryRecoveryGuard?.guardDigest ?? null,
    permissionPosture: boundaryPermissionPosture?.postureDigest ?? null,
    decisionReceipt: boundaryDecisionReceipt?.receiptDigest ?? null,
    releaseGate: boundaryReleaseGate?.gateDigest ?? null
  };
  const scopeAlignmentChecks = [
    workspaceScopeCheck('program_tenant', tenantId, normalizedScope.tenantId),
    workspaceScopeCheck('program_workspace', workspaceId, normalizedScope.workspaceId),
    workspaceScopeCheck('handoff_tenant', tenantId, handoffScope.tenantId),
    workspaceScopeCheck('handoff_workspace', workspaceId, handoffScope.workspaceId),
    workspaceScopeCheck('handoff_isolation', isolationKey, handoffScope.isolationKey),
    workspaceScopeCheck('release_tenant', tenantId, releaseScope.tenantId),
    workspaceScopeCheck('release_workspace', workspaceId, releaseScope.workspaceId),
    workspaceScopeCheck('release_isolation', isolationKey, releaseScope.isolationKey)
  ];
  const mismatches = scopeAlignmentChecks.filter((check) => check.state === 'mismatch');
  const missingRequiredDigests = writeRequired
    ? Object.entries(sourceDigests)
      .filter(([, digest]) => !digest)
      .map(([name]) => name)
    : [];
  const requiredAcknowledgements = uniqueSorted([
    ...(boundaryReleaseGate?.requiredAcknowledgements ?? []),
    ...(boundaryPermissionPosture?.requiredAcknowledgements ?? []),
    ...(boundaryAuditHandoff?.requiredAcknowledgements ?? []),
    ...(writeRequired ? ['workspace_permission_handoff'] : [])
  ]);
  const observedAcknowledgements = uniqueSorted([
    ...(boundaryReleaseGate?.observedAcknowledgements ?? []),
    ...(boundaryPermissionPosture?.observedAcknowledgements ?? []),
    ...(boundaryAuditHandoff?.acknowledgements ?? []),
    ...(kernelCall?.handoff?.audit?.acknowledgements ?? [])
  ]);
  const missingAcknowledgements = requiredAcknowledgements
    .filter((acknowledgement) => !observedAcknowledgements.includes(acknowledgement));
  const releaseAllowed = boundaryReleaseGate?.releaseAllowed === true
    && boundaryDecisionReceipt?.release?.allowed === true;
  const blockers = uniqueSorted([
    ...(writeRequired && !tenantId ? ['workspace_permission_missing_tenant'] : []),
    ...(writeRequired && !workspaceId ? ['workspace_permission_missing_workspace'] : []),
    ...(writeRequired && !isolationKey ? ['workspace_permission_missing_isolation'] : []),
    ...mismatches.map((check) => `workspace_permission_${check.name}_mismatch`),
    ...missingRequiredDigests.map((name) => `workspace_permission_missing_${name}_digest`),
    ...(writeRequired && boundaryTicket?.ready !== true ? ['workspace_permission_boundary_ticket_not_ready'] : []),
    ...(writeRequired && boundaryAuditHandoff?.ready !== true ? ['workspace_permission_audit_not_ready'] : []),
    ...(writeRequired && boundaryRecoveryGuard?.ready !== true ? ['workspace_permission_recovery_guard_not_ready'] : []),
    ...(writeRequired && boundaryPermissionPosture?.ready !== true ? ['workspace_permission_posture_not_ready'] : []),
    ...(writeRequired && boundaryDecisionReceipt?.ready !== true ? ['workspace_permission_decision_not_ready'] : []),
    ...(writeRequired && boundaryReleaseGate?.ready !== true ? ['workspace_permission_release_gate_not_ready'] : []),
    ...(writeRequired && !releaseAllowed ? ['workspace_permission_release_not_allowed'] : []),
    ...(writeRequired && boundaryRecoveryGuard?.retryable === false ? ['workspace_permission_recovery_not_retryable'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(missingAcknowledgements.length ? ['workspace_permission_acknowledgement_missing'] : []),
    ...((boundaryReleaseGate?.warnings ?? []).map((warning) => `release_${warning}`)),
    ...((boundaryDecisionReceipt?.warnings ?? []).map((warning) => `decision_${warning}`)),
    ...((boundaryPermissionPosture?.warnings ?? []).map((warning) => `posture_${warning}`)),
    ...((boundaryAuditHandoff?.warnings ?? []).map((warning) => `audit_${warning}`)),
    ...((boundaryRecoveryGuard?.warnings ?? []).map((warning) => `guard_${warning}`))
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : missingAcknowledgements.length || warnings.length
        ? 'awaiting_acknowledgement'
        : 'ready';
  const handoffDigest = stableHash({
    programId,
    operation,
    state,
    tenantId,
    workspaceId,
    isolationKey,
    role,
    writeEffects,
    sourceDigests,
    requiredAcknowledgements,
    missingAcknowledgements,
    scopeAlignment: scopeAlignmentChecks.map((check) => `${check.name}:${check.state}`),
    releaseAllowed
  });
  const commands = writeRequired ? [
    {
      type: 'mailchimp.external_write.workspace_permission_handoff',
      commandId: `workspace-permission:${handoffDigest}`,
      idempotencyKey: stableHash({
        action: 'workspace_permission_handoff',
        handoffDigest,
        idempotencyKey: route?.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null
      }),
      statusAfterReplay: state === 'ready'
        ? 'workspace_permission_handoff_ready'
        : state === 'awaiting_acknowledgement'
          ? 'workspace_permission_acknowledgement_required'
          : 'workspace_permission_handoff_blocked',
      writes: ['workspacePermissionHandoff', 'boundaryReleaseGateDigest', 'permissionPostureDigest'],
      conflict: 'return-existing',
      requiredInputs: uniqueSorted([
        ...missingRequiredDigests.map((name) => `${name}.digest`),
        ...missingAcknowledgements.map((acknowledgement) => `acknowledgement:${acknowledgement}`)
      ])
    },
    ...(missingAcknowledgements.length ? [{
      type: 'mailchimp.external_write.workspace_permission_acknowledgement',
      commandId: `workspace-permission-ack:${stableHash({ handoffDigest, missingAcknowledgements })}`,
      idempotencyKey: stableHash({
        action: 'workspace_permission_acknowledgement',
        handoffDigest,
        missingAcknowledgements
      }),
      statusAfterReplay: 'workspace_permission_acknowledgement_recorded',
      writes: ['workspacePermissionAcknowledgements'],
      conflict: 'return-existing',
      requiredInputs: missingAcknowledgements.map((acknowledgement) => `acknowledgement:${acknowledgement}`)
    }] : [])
  ] : [];
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.workspace-permission-handoff`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    releaseAllowed: releaseAllowed && state === 'ready',
    scope: {
      tenantId,
      workspaceId,
      isolationKey,
      role
    },
    permissionMode: boundaryPermissionPosture?.permissionMode ?? boundaryTicket?.permissionMode ?? 'unknown',
    effectAccess: stableClone(boundaryPermissionPosture?.effectAccess ?? {}),
    sourceDigests,
    scopeAlignment: {
      aligned: mismatches.length === 0,
      checks: scopeAlignmentChecks,
      mismatchCount: mismatches.length
    },
    requiredAcknowledgements,
    observedAcknowledgements,
    missingAcknowledgements,
    commands,
    handoffDigest,
    restartSemantics: {
      restartSafe: (state === 'ready' || !writeRequired)
        && boundaryReleaseGate?.restartSemantics?.restartSafe !== false
        && Boolean(route?.idempotencyKey || kernelCall?.handoff?.idempotencyKey || !writeRequired),
      onRestart: state === 'blocked'
        ? 'reload_workspace_permission_handoff'
        : state === 'awaiting_acknowledgement'
          ? 'collect_workspace_permission_acknowledgement'
          : state === 'ready'
            ? 'reuse_workspace_permission_handoff'
            : 'continue_read_only',
      onScopeMutation: 'invalidate_workspace_permission_handoff',
      onPermissionMutation: 'invalidate_workspace_permission_handoff',
      onDuplicateCommand: 'return_existing_workspace_permission_handoff'
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? workspacePermissionAction(blockers[0])
      : state === 'awaiting_acknowledgement'
        ? 'collect_workspace_permission_acknowledgement'
        : state === 'ready'
          ? 'publish_workspace_permission_handoff'
          : 'continue_read_only'
  };
}

function workspaceScopeCheck(name, expected, observed) {
  return {
    name,
    expected: expected ?? null,
    observed: observed ?? null,
    state: !expected || !observed || expected === observed ? 'matched' : 'mismatch'
  };
}

function validateWorkspacePermissionHandoff(handoff, writeEffects) {
  if (!writeEffects.length && !handoff) return [];
  const diagnostics = [];
  if (!handoff) return [{ level: 'error', code: 'external_write_missing_workspace_permission_handoff' }];
  if (writeEffects.length && handoff.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_workspace_permission_handoff_not_write_required' });
  }
  if (handoff.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_workspace_permission_handoff_blocked',
      blockers: handoff.blockers ?? []
    });
  }
  if (handoff.ready && writeEffects.length && !handoff.handoffDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_workspace_permission_handoff_missing_digest' });
  }
  if (handoff.ready && writeEffects.length && handoff.releaseAllowed !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_workspace_permission_handoff_ready_without_release' });
  }
  if (handoff.ready && writeEffects.length && handoff.scopeAlignment?.aligned !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_workspace_permission_handoff_scope_misaligned' });
  }
  if (handoff.ready && writeEffects.length && handoff.restartSemantics?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_workspace_permission_handoff_not_restart_safe' });
  }
  if (writeEffects.length && !handoff.commands?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_workspace_permission_handoff_missing_command' });
  }
  if (handoff.state === 'awaiting_acknowledgement' || handoff.missingAcknowledgements?.length) {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_workspace_permission_handoff_requires_acknowledgement',
      missingAcknowledgements: handoff.missingAcknowledgements ?? []
    });
  }
  return diagnostics;
}

function workspacePermissionAction(blocker) {
  if (String(blocker).includes('missing_tenant') || String(blocker).includes('missing_workspace')) return 'bind_workspace_scope_before_write';
  if (String(blocker).includes('mismatch')) return 'repair_workspace_permission_scope_alignment';
  if (String(blocker).includes('digest')) return 'rebuild_boundary_permission_evidence';
  if (String(blocker).includes('release_not_allowed') || String(blocker).includes('release_gate')) return 'repair_boundary_release_gate';
  if (String(blocker).includes('posture')) return 'repair_boundary_permission_posture';
  if (String(blocker).includes('audit')) return 'repair_boundary_audit_handoff';
  if (String(blocker).includes('recovery')) return 'repair_boundary_recovery_guard';
  return 'repair_workspace_permission_handoff';
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

function boundaryPermissionEscalation(blocker) {
  if (String(blocker).includes('tenant')) return 'escalate_tenant_permission_boundary';
  if (String(blocker).includes('workspace')) return 'escalate_workspace_permission_boundary';
  if (String(blocker).includes('isolation')) return 'escalate_isolation_boundary';
  if (String(blocker).includes('audit')) return 'escalate_audit_permission_handoff';
  if (String(blocker).includes('role')) return 'escalate_role_permission_review';
  if (String(blocker).includes('effect')) return 'escalate_write_effect_permission_review';
  if (String(blocker).includes('recovery')) return 'escalate_boundary_recovery_guard';
  return 'escalate_permission_boundary_review';
}

function boundaryPermissionAction(blocker) {
  if (String(blocker).includes('tenant')) return 'repair_tenant_permission_posture';
  if (String(blocker).includes('workspace')) return 'repair_workspace_permission_posture';
  if (String(blocker).includes('isolation')) return 'repair_isolation_permission_posture';
  if (String(blocker).includes('audit')) return 'repair_permission_audit_handoff';
  if (String(blocker).includes('role')) return 'change_execution_role_before_write';
  if (String(blocker).includes('denied')) return 'remove_denied_write_effect';
  if (String(blocker).includes('allowed')) return 'grant_boundary_write_effect';
  if (String(blocker).includes('recovery')) return 'repair_boundary_recovery_guard';
  return 'operator_permission_boundary_review';
}

function boundaryDecisionAction(blocker) {
  if (String(blocker).includes('tenant')) return 'repair_tenant_scope_before_boundary_release';
  if (String(blocker).includes('workspace')) return 'repair_workspace_scope_before_boundary_release';
  if (String(blocker).includes('isolation')) return 'repair_isolation_key_before_boundary_release';
  if (String(blocker).includes('ticket')) return 'repair_boundary_ticket_before_release';
  if (String(blocker).includes('audit')) return 'persist_boundary_audit_before_release';
  if (String(blocker).includes('guard')) return 'repair_boundary_recovery_guard_before_release';
  if (String(blocker).includes('posture')) return 'repair_permission_posture_before_release';
  if (String(blocker).includes('ack')) return 'collect_boundary_decision_acknowledgement';
  return 'operator_boundary_decision_review';
}

function boundaryReleaseGateAction(blocker) {
  if (String(blocker).includes('tenant')) return 'repair_tenant_scope_before_release_gate';
  if (String(blocker).includes('workspace')) return 'repair_workspace_scope_before_release_gate';
  if (String(blocker).includes('isolation')) return 'repair_isolation_scope_before_release_gate';
  if (String(blocker).includes('ticket')) return 'repair_boundary_ticket_before_release_gate';
  if (String(blocker).includes('audit')) return 'persist_boundary_audit_before_release_gate';
  if (String(blocker).includes('guard')) return 'repair_boundary_recovery_guard_before_release_gate';
  if (String(blocker).includes('posture')) return 'repair_permission_posture_before_release_gate';
  if (String(blocker).includes('decision')) return 'publish_boundary_decision_receipt_before_release_gate';
  if (String(blocker).includes('ack')) return 'collect_boundary_release_acknowledgement';
  return 'operator_boundary_release_gate_review';
}

function normalizeRolePolicy(policy = {}, role = 'automation_worker') {
  const roleName = role ?? 'automation_worker';
  const entries = Array.isArray(policy)
    ? policy.map((entry) => typeof entry === 'string' ? { role: entry } : entry)
    : Object.entries(policy ?? {}).map(([name, entry]) => typeof entry === 'boolean'
      ? { role: name, allowed: entry }
      : { role: name, ...(entry ?? {}) });
  const matched = entries.find((entry) => entry?.role === roleName || entry?.name === roleName);
  const defaultAllowed = ['automation_worker', 'operator'].includes(roleName);
  return {
    role: roleName,
    allowed: matched?.allowed ?? matched?.enabled ?? defaultAllowed,
    requiresAcknowledgement: matched?.requiresAcknowledgement ?? roleName === 'operator',
    source: matched ? 'permission_boundary' : 'default_boundary_roles'
  };
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
  const commandQueue = buildExternalLifecycleCommandQueue({
    programId,
    operation,
    state,
    effectiveEnabled,
    writeRequired,
    acceptedCommands,
    kernelCommandQueue: kernelCall?.lifecycle?.commandQueue,
    selectedControl,
    blockers,
    warnings,
    schedule
  });
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
    commandQueue,
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
  if (manifest.commandQueue?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_lifecycle_command_queue_blocked',
      blockers: manifest.commandQueue.blockers ?? []
    });
  }
  if (manifest.commandQueue?.state === 'awaiting_acknowledgement' && !manifest.commandQueue?.missingAcknowledgements?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_lifecycle_command_queue_ack_missing_detail' });
  }
  return diagnostics;
}

function buildExternalLifecycleCommandQueue({
  programId,
  operation,
  state,
  effectiveEnabled,
  writeRequired,
  acceptedCommands,
  kernelCommandQueue,
  selectedControl,
  blockers,
  warnings,
  schedule
}) {
  const kernelCommands = asArray(kernelCommandQueue?.commands).map((command) => ({
    id: command.id,
    action: command.action,
    requestedState: command.requestedState,
    state: command.state,
    requiresAcknowledgement: command.requiresAcknowledgement === true,
    acknowledgementToken: command.acknowledgementToken ?? null,
    nextAction: command.nextAction ?? null,
    source: command.source ?? 'kernel_lifecycle',
    reason: command.reason ?? null
  }));
  const fallbackCommands = kernelCommands.length
    ? []
    : acceptedCommands.map((command) => ({
        id: command.id,
        action: command.action,
        requestedState: command.nextState,
        state: command.accepted
          ? selectedControl === command.action || lifecycleControlNextState(command.action) === state
            ? 'applied'
            : 'pending'
          : 'blocked',
        requiresAcknowledgement: ['disable', 'pause', 'hold', 'schedule', 'reschedule'].includes(command.action) && writeRequired,
        acknowledgementToken: null,
        nextAction: lifecycleControlAction(command.action),
        source: command.source ?? 'external_write_lifecycle',
        reason: command.reason ?? null
      }));
  const commands = kernelCommands.length ? kernelCommands : fallbackCommands;
  const pending = commands.filter((command) => command.state === 'pending' || command.state === 'awaiting_acknowledgement');
  const applied = commands.filter((command) => command.state === 'applied');
  const blocked = commands.filter((command) => command.state === 'blocked');
  const missingAcknowledgements = kernelCommandQueue?.requiredAcknowledgements?.missing ?? commands
    .filter((command) => command.requiresAcknowledgement)
    .map((command) => `lifecycle_command:${command.action}`);
  const queueBlockers = uniqueSorted([
    ...blockers,
    ...blocked.map((command) => `lifecycle_command_blocked:${command.action}`)
  ]);
  const queueWarnings = uniqueSorted([
    ...warnings,
    ...(missingAcknowledgements.length ? ['lifecycle_command_acknowledgement_required'] : []),
    ...(schedule.status === 'scheduled' ? ['lifecycle_command_waiting_for_schedule_window'] : [])
  ]);
  const queueState = !writeRequired
    ? 'not_required'
    : queueBlockers.length
      ? 'blocked'
      : missingAcknowledgements.length
        ? 'awaiting_acknowledgement'
        : pending.length
          ? 'pending'
          : queueWarnings.length
            ? 'review'
            : commands.length
              ? 'applied'
              : effectiveEnabled
                ? 'empty'
                : 'disabled';
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.lifecycle-command-queue`,
    programId,
    operation,
    state: queueState,
    ready: ['applied', 'empty', 'disabled', 'not_required'].includes(queueState),
    writeRequired,
    effectiveEnabled,
    selectedCommandId: kernelCommandQueue?.selectedCommandId ?? applied.at(-1)?.id ?? null,
    selectedAction: kernelCommandQueue?.selectedAction ?? applied.at(-1)?.action ?? selectedControl,
    pending,
    applied,
    blocked,
    commands,
    missingAcknowledgements,
    nextAction: queueBlockers.length
      ? lifecycleControlAction(queueBlockers[0])
      : missingAcknowledgements.length
        ? 'collect_lifecycle_confirmation'
        : pending[0]?.nextAction
          ?? kernelCommandQueue?.nextAction
          ?? (queueWarnings.length ? 'review_lifecycle_command_queue' : 'continue_lifecycle_handoff'),
    blockers: queueBlockers,
    warnings: queueWarnings,
    digest: stableHash({
      programId,
      operation,
      state: queueState,
      kernelQueueDigest: kernelCommandQueue?.digest ?? null,
      commands: commands.map((command) => `${command.id}:${command.action}:${command.state}`),
      missingAcknowledgements,
      blockers: queueBlockers,
      warnings: queueWarnings
    })
  };
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
    ...asCapabilityList(provider.capabilities),
    ...asCapabilityList(provider.allowedCapabilities),
    ...asCapabilityList(provider.negotiation?.capabilities),
    ...asCapabilityList(kernelCall?.capabilities?.provider),
    ...asCapabilityList(kernelCall?.capabilities?.allowed)
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
  const negotiationReceipt = normalizeMailchimpProviderNegotiationReceipt({
    receipt: provider.negotiationReceipt ?? provider.capabilityNegotiationReceipt ?? provider.negotiation?.receipt,
    programId,
    operation,
    requiredCapabilities,
    acceptedCapabilities,
    missingCapabilities,
    scope,
    route,
    provider
  });
  const sync = {
    statusChannel: provider.sync?.statusChannel ?? route.statusChannel ?? null,
    auditChannel: provider.sync?.auditChannel ?? route.auditChannel ?? null,
    idempotencyKey: provider.sync?.idempotencyKey ?? route.idempotencyKey ?? null,
    externalStateKey: provider.sync?.externalStateKey
      ?? (scope.tenantId && scope.workspaceId
        ? `mailchimp:${scope.tenantId}:${scope.workspaceId}:${operation ?? 'unknown'}`
        : null),
    cursor: provider.sync?.cursor ?? kernelCall?.handoff?.providerCursor ?? null,
    cursorContract: normalizeMailchimpProviderCursorContract({
      provider,
      kernelCall,
      programId,
      operation,
      route
    }),
    checkpointDigest: stableHash({
      programId,
      operation,
      effects: writeEffects,
      tenantId: scope.tenantId ?? null,
      workspaceId: scope.workspaceId ?? null,
      idempotencyKey: provider.sync?.idempotencyKey ?? route.idempotencyKey ?? null
    })
  };
  sync.lease = buildMailchimpProviderSyncLease({
    provider,
    kernelCall,
    programId,
    operation,
    route,
    scope,
    sync,
    requiredCapabilities,
    deniedCapabilities,
    writeRequired: writeEffects.length > 0
  });
  sync.handoffReceipt = buildExternalWriteProviderHandoffReceipt({
    programId,
    operation,
    provider,
    route,
    sync,
    requiredCapabilities,
    acceptedCapabilities,
    missingCapabilities,
    deniedCapabilities,
    providerHealth,
    kernelCall,
    writeRequired: writeEffects.length > 0
  });
  const blockers = uniqueSorted([
    ...(providerHealth.blockers ?? []).map((blocker) => `health_${blocker}`),
    ...(negotiationReceipt.state === 'blocked' ? ['provider_negotiation_receipt_blocked'] : []),
    ...(negotiationReceipt.blockers ?? []).map((blocker) => `receipt_${blocker}`),
    ...(missingCapabilities.length ? ['provider_capability_mismatch'] : []),
    ...missingCapabilities.map((capability) => `missing_capability:${capability}`),
    ...(!sync.statusChannel && writeEffects.length ? ['missing_provider_status_channel'] : []),
    ...(!sync.idempotencyKey && writeEffects.length ? ['missing_provider_idempotency_key'] : []),
    ...(!sync.externalStateKey && writeEffects.length ? ['missing_provider_external_state_key'] : []),
    ...(sync.cursorContract.state === 'blocked' && writeEffects.length ? ['provider_sync_cursor_blocked'] : []),
    ...(sync.cursorContract.blockers ?? []).map((blocker) => `cursor_${blocker}`),
    ...(sync.lease.state === 'blocked' && writeEffects.length ? ['provider_sync_lease_blocked'] : []),
    ...(sync.lease.blockers ?? []).map((blocker) => `lease_${blocker}`),
    ...(sync.handoffReceipt.state === 'blocked' && writeEffects.length ? ['provider_handoff_receipt_blocked'] : []),
    ...(sync.handoffReceipt.blockers ?? []).map((blocker) => `handoff_receipt_${blocker}`),
    ...(lifecycleGate.ready === false && writeEffects.length ? ['lifecycle_not_ready_for_provider_contract'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(providerHealth.warnings ?? []).map((warning) => `health_${warning}`),
    ...(negotiationReceipt.state === 'review' ? ['provider_negotiation_receipt_review'] : []),
    ...(negotiationReceipt.warnings ?? []).map((warning) => `receipt_${warning}`),
    ...(declaredCapabilities.length === 0 && writeEffects.length ? ['provider_capabilities_defaulted'] : []),
    ...(providerHealth.degraded ? ['provider_health_degraded'] : []),
    ...(sync.cursor == null && writeEffects.length ? ['provider_cursor_not_declared'] : []),
    ...(sync.cursorContract.warnings ?? []).map((warning) => `cursor_${warning}`),
    ...(sync.lease.state === 'review' && writeEffects.length ? ['provider_sync_lease_review'] : []),
    ...(sync.lease.warnings ?? []).map((warning) => `lease_${warning}`),
    ...(sync.handoffReceipt.state === 'review' && writeEffects.length ? ['provider_handoff_receipt_review'] : []),
    ...(sync.handoffReceipt.warnings ?? []).map((warning) => `handoff_receipt_${warning}`)
  ]);
  const state = !writeEffects.length
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : providerHealth.degraded || warnings.length
        ? 'review'
        : 'ready';
  const providerSession = buildProviderSessionContract({
    programId,
    operation,
    provider,
    state,
    requiredCapabilities,
    declaredCapabilities,
    acceptedCapabilities,
    missingCapabilities,
    sync,
    providerHealth,
    kernelCall,
    writeRequired: writeEffects.length > 0
  });
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
    cursorDigest: sync.cursorContract.digest,
    leaseDigest: sync.lease.digest,
    handoffReceiptDigest: sync.handoffReceipt.digest,
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
    providerSession,
    handoffReceipt: sync.handoffReceipt,
    capabilityNegotiationReceipt: negotiationReceipt,
    negotiation: {
      status: state === 'blocked' ? 'blocked' : state === 'review' ? 'review' : 'accepted',
      accepted: state !== 'blocked',
      defaulted: declaredCapabilities.length === 0,
      providerStatus: providerHealth.status,
      healthReady: providerHealth.ready === true,
      receiptDigest: negotiationReceipt.digest,
      receiptState: negotiationReceipt.state
    },
    sync,
    handoffState: {
      externalStateKey: sync.externalStateKey,
      statusChannel: sync.statusChannel,
      checkpointDigest: sync.checkpointDigest,
      negotiationReceiptDigest: negotiationReceipt.digest,
      cursor: sync.cursor,
      cursorContract: sync.cursorContract,
      lease: sync.lease,
      handoffReceipt: sync.handoffReceipt,
      sessionDigest: providerSession.digest,
      renewalPolicy: providerSession.renewalPolicy,
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

function normalizeMailchimpProviderNegotiationReceipt({
  receipt = null,
  programId = null,
  operation = null,
  requiredCapabilities = [],
  acceptedCapabilities = [],
  missingCapabilities = [],
  scope = {},
  route = {},
  provider = {}
} = {}) {
  const declaredExternalStateKey = receipt?.externalStateKey
    ?? provider.sync?.externalStateKey
    ?? provider.externalStateKey
    ?? null;
  const declaredStatusChannel = receipt?.statusChannel
    ?? provider.sync?.statusChannel
    ?? provider.statusChannel
    ?? route.statusChannel
    ?? null;
  const receiptMissing = uniqueSorted([
    ...(receipt?.missingCapabilities ?? []),
    ...missingCapabilities
  ]);
  const blockers = uniqueSorted([
    ...(receipt?.blockers ?? []),
    ...(receiptMissing.length ? ['provider_negotiation_capability_gap'] : []),
    ...receiptMissing.map((capability) => `missing_capability:${capability}`),
    ...(!declaredExternalStateKey && requiredCapabilities.length ? ['provider_negotiation_missing_external_state_key'] : []),
    ...(!declaredStatusChannel && requiredCapabilities.length ? ['provider_negotiation_missing_status_channel'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(receipt?.warnings ?? []),
    ...(!receipt && requiredCapabilities.length ? ['provider_negotiation_receipt_synthesized'] : []),
    ...(receipt?.state === 'review' ? ['provider_negotiation_receipt_review'] : [])
  ]);
  const state = !requiredCapabilities.length
    ? 'not_required'
    : blockers.length || receipt?.state === 'blocked'
      ? 'blocked'
      : warnings.length
        ? 'review'
        : receipt?.state === 'accepted'
          ? 'accepted'
          : 'accepted';
  const digestShape = {
    programId,
    operation,
    state,
    requiredCapabilities,
    acceptedCapabilities,
    missingCapabilities: receiptMissing,
    externalStateKey: declaredExternalStateKey,
    statusChannel: declaredStatusChannel,
    sourceDigest: receipt?.sourceDigest ?? provider.session?.digest ?? null,
    receiptDigest: receipt?.digest ?? null,
    tenantId: scope.tenantId ?? null,
    workspaceId: scope.workspaceId ?? null
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.provider-negotiation-receipt`,
    state,
    ready: state === 'accepted' || state === 'not_required',
    synthesized: !receipt,
    provider: receipt?.provider ?? provider.provider ?? route.adapter ?? 'mailchimp',
    service: receipt?.service ?? provider.service ?? 'mailchimp',
    requiredCapabilities,
    acceptedCapabilities,
    missingCapabilities: receiptMissing,
    deniedCapabilities: uniqueSorted([
      ...(receipt?.deniedCapabilities ?? []),
      ...(provider.deniedCapabilities ?? [])
    ]),
    externalStateKey: declaredExternalStateKey,
    statusChannel: declaredStatusChannel,
    sourceDigest: receipt?.sourceDigest ?? provider.session?.digest ?? null,
    sessionDigest: receipt?.sessionDigest ?? provider.session?.digest ?? null,
    cursorDigest: receipt?.cursorDigest ?? provider.sync?.cursorContract?.digest ?? null,
    command: receipt?.command ?? (requiredCapabilities.length ? {
      commandId: `provider-receipt:${stableHash(digestShape)}`,
      type: 'persist-mailchimp-provider-negotiation-receipt',
      idempotencyKey: stableHash({
        programId,
        operation,
        action: 'provider-negotiation-receipt',
        sourceDigest: receipt?.sourceDigest ?? provider.session?.digest ?? null,
        routeKey: route.idempotencyKey ?? null
      }),
      statusAfterReplay: state,
      conflict: 'return-existing'
    } : null),
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? providerNegotiationReceiptAction(blockers[0])
      : state === 'review'
        ? 'review_mailchimp_provider_negotiation_receipt'
        : state === 'accepted'
          ? 'persist_mailchimp_provider_negotiation_receipt'
          : 'continue_read_only',
    digest: receipt?.digest ?? stableHash(digestShape)
  };
}

function providerNegotiationReceiptAction(blocker) {
  if (String(blocker).startsWith('missing_capability:')) return 'enable_mailchimp_provider_capability';
  if (blocker === 'provider_negotiation_missing_external_state_key') return 'bind_mailchimp_provider_external_state';
  if (blocker === 'provider_negotiation_missing_status_channel') return 'bind_mailchimp_provider_status_channel';
  return 'resolve_mailchimp_provider_negotiation_receipt';
}

function buildMailchimpProviderSyncLease({
  provider = {},
  kernelCall = null,
  programId = null,
  operation = null,
  route = {},
  scope = {},
  sync = {},
  requiredCapabilities = [],
  deniedCapabilities = [],
  writeRequired = false
} = {}) {
  const providerSync = provider.sync ?? {};
  const incoming = providerSync.lease
    ?? provider.lease
    ?? kernelCall?.provider?.sync?.lease
    ?? {};
  const resource = {
    audienceId: incoming.resource?.audienceId
      ?? incoming.audienceId
      ?? providerSync.audienceId
      ?? provider.audienceId
      ?? provider.listId
      ?? null,
    campaignId: incoming.resource?.campaignId
      ?? incoming.campaignId
      ?? providerSync.campaignId
      ?? provider.campaignId
      ?? null,
    segmentId: incoming.resource?.segmentId
      ?? incoming.segmentId
      ?? providerSync.segmentId
      ?? provider.segmentId
      ?? null,
    tenantId: incoming.resource?.tenantId ?? scope.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
    workspaceId: incoming.resource?.workspaceId ?? scope.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null
  };
  const required = Boolean(incoming.required ?? providerSync.leaseRequired ?? writeRequired);
  const ttlSeconds = Math.max(60, Number(incoming.ttlSeconds ?? providerSync.leaseTtlSeconds ?? provider.leaseTtlSeconds ?? 900));
  const renewalWindowSeconds = Math.max(30, Number(
    incoming.renewalWindowSeconds
      ?? providerSync.leaseRenewalWindowSeconds
      ?? provider.leaseRenewalWindowSeconds
      ?? Math.floor(ttlSeconds / 3)
  ));
  const blockers = uniqueSorted([
    ...(incoming.blockers ?? []),
    ...(required && !sync.externalStateKey ? ['external_write_sync_lease_missing_external_state_key'] : []),
    ...(required && !sync.statusChannel ? ['external_write_sync_lease_missing_status_channel'] : []),
    ...(required && !resource.audienceId && !resource.campaignId ? ['external_write_sync_lease_missing_mailchimp_resource'] : []),
    ...(deniedCapabilities.length ? ['external_write_sync_lease_denied_capability'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(incoming.warnings ?? []),
    ...(required && sync.cursorContract?.state === 'review' ? ['external_write_sync_lease_cursor_review'] : []),
    ...(required && sync.cursorContract?.state === 'blocked' ? ['external_write_sync_lease_cursor_blocked'] : []),
    ...(ttlSeconds < renewalWindowSeconds ? ['external_write_sync_lease_renewal_window_exceeds_ttl'] : [])
  ]);
  const state = !required
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const digestShape = {
    programId,
    operation,
    state,
    resource,
    externalStateKey: sync.externalStateKey ?? null,
    statusChannel: sync.statusChannel ?? null,
    cursorDigest: sync.cursorContract?.digest ?? null,
    ttlSeconds,
    renewalWindowSeconds,
    requiredCapabilities
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.mailchimp-provider-sync-lease`,
    state,
    ready: state === 'ready' || state === 'not_required',
    required,
    provider: provider.provider ?? route.adapter ?? 'mailchimp',
    service: provider.service ?? 'mailchimp',
    externalStateKey: sync.externalStateKey ?? null,
    statusChannel: sync.statusChannel ?? null,
    resource,
    owner: incoming.owner ?? providerSync.owner ?? scope.role ?? 'automation_worker',
    ttlSeconds,
    renewalWindowSeconds,
    renewalPolicy: incoming.renewalPolicy ?? provider.renewalPolicy ?? 'renew_before_expiry',
    replayPolicy: incoming.replayPolicy ?? provider.replayPolicy ?? 'return_existing_by_lease_key',
    cursorDigest: sync.cursorContract?.digest ?? null,
    blockers,
    warnings,
    command: required ? {
      type: 'persist-mailchimp-provider-sync-lease',
      commandId: `external-provider-sync-lease:${stableHash(digestShape)}`,
      idempotencyKey: stableHash({
        programId,
        operation,
        action: 'external-provider-sync-lease',
        externalStateKey: sync.externalStateKey ?? null,
        audienceId: resource.audienceId,
        campaignId: resource.campaignId
      }),
      statusAfterReplay: state,
      conflict: 'return-existing'
    } : null,
    nextAction: state === 'blocked'
      ? 'bind_mailchimp_provider_sync_lease'
      : state === 'review'
        ? 'review_mailchimp_provider_sync_lease'
        : required
          ? 'persist_mailchimp_provider_sync_lease'
          : 'continue_without_provider_sync_lease',
    digest: incoming.digest ?? stableHash(digestShape)
  };
}

function buildExternalWriteProviderHandoffReceipt({
  programId = null,
  operation = null,
  provider = {},
  route = {},
  sync = {},
  requiredCapabilities = [],
  acceptedCapabilities = [],
  missingCapabilities = [],
  deniedCapabilities = [],
  providerHealth = {},
  kernelCall = null,
  writeRequired = false
} = {}) {
  const incoming = provider.handoffReceipt
    ?? provider.sync?.handoffReceipt
    ?? kernelCall?.provider?.sync?.handoffReceipt
    ?? {};
  const required = Boolean(incoming.required ?? writeRequired);
  const expectedDigestShape = {
    programId,
    operation,
    provider: provider.provider ?? route.adapter ?? 'mailchimp',
    statusChannel: sync.statusChannel ?? null,
    externalStateKey: sync.externalStateKey ?? null,
    cursorDigest: sync.cursorContract?.digest ?? null,
    leaseDigest: sync.lease?.digest ?? null,
    requiredCapabilities,
    acceptedCapabilities,
    missingCapabilities,
    deniedCapabilities,
    idempotencyKey: sync.idempotencyKey ?? route.idempotencyKey ?? null
  };
  const expectedDigest = stableHash(expectedDigestShape);
  const receiptDigest = incoming.receiptDigest ?? incoming.digest ?? null;
  const acknowledgedDigests = uniqueSorted([
    ...(incoming.acknowledgedDigests ?? []),
    ...(provider.acknowledgedHandoffDigests ?? []),
    ...(provider.sync?.acknowledgedHandoffDigests ?? [])
  ]);
  const acknowledged = incoming.acknowledged === true
    || acknowledgedDigests.includes(expectedDigest)
    || (receiptDigest != null && acknowledgedDigests.includes(receiptDigest));
  const fresh = receiptDigest == null || receiptDigest === expectedDigest;
  const blockers = uniqueSorted([
    ...(incoming.blockers ?? []),
    ...(required && !sync.statusChannel ? ['external_write_handoff_receipt_missing_status_channel'] : []),
    ...(required && !sync.externalStateKey ? ['external_write_handoff_receipt_missing_external_state_key'] : []),
    ...(required && sync.cursorContract?.state === 'blocked' ? ['external_write_handoff_receipt_cursor_blocked'] : []),
    ...(required && sync.lease?.state === 'blocked' ? ['external_write_handoff_receipt_lease_blocked'] : []),
    ...(required && deniedCapabilities.length ? ['external_write_handoff_receipt_denied_capability'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(incoming.warnings ?? []),
    ...(required && !acknowledged ? ['external_write_handoff_receipt_acknowledgement_missing'] : []),
    ...(required && !fresh ? ['external_write_handoff_receipt_stale'] : []),
    ...(required && providerHealth.degraded ? ['external_write_handoff_receipt_provider_degraded'] : []),
    ...(required && missingCapabilities.length ? ['external_write_handoff_receipt_capability_gap'] : []),
    ...(required && sync.cursorContract?.state === 'review' ? ['external_write_handoff_receipt_cursor_review'] : []),
    ...(required && sync.lease?.state === 'review' ? ['external_write_handoff_receipt_lease_review'] : [])
  ]);
  const state = !required
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.provider-handoff-receipt`,
    provider: provider.provider ?? route.adapter ?? 'mailchimp',
    service: provider.service ?? 'mailchimp',
    programId,
    operation,
    required,
    state,
    ready: state === 'ready' || state === 'not_required',
    acknowledged,
    fresh,
    expectedDigest,
    receiptDigest,
    acknowledgedDigests,
    statusChannel: sync.statusChannel ?? null,
    externalStateKey: sync.externalStateKey ?? null,
    cursorDigest: sync.cursorContract?.digest ?? null,
    leaseDigest: sync.lease?.digest ?? null,
    command: required ? {
      type: 'ack-mailchimp-external-write-provider-handoff',
      commandId: `external-provider-handoff:${expectedDigest}`,
      idempotencyKey: stableHash({
        programId,
        operation,
        action: 'external-provider-handoff',
        expectedDigest,
        routeKey: route.idempotencyKey ?? null
      }),
      statusAfterReplay: state,
      conflict: 'return-existing'
    } : null,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? providerHandoffReceiptAction(blockers[0])
      : state === 'review'
        ? 'acknowledge_mailchimp_external_write_handoff'
        : required
          ? 'persist_mailchimp_external_write_handoff_receipt'
          : 'continue_without_provider_handoff_receipt',
    digest: receiptDigest ?? expectedDigest
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
  if (writeEffects.length && !contract.providerSession?.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_session_missing_digest' });
  }
  if (writeEffects.length && !contract.capabilityNegotiationReceipt?.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_negotiation_receipt_missing_digest' });
  }
  if (contract.capabilityNegotiationReceipt?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_negotiation_receipt_blocked',
      blockers: contract.capabilityNegotiationReceipt.blockers ?? []
    });
  }
  if (contract.capabilityNegotiationReceipt?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_provider_negotiation_receipt_review',
      warnings: contract.capabilityNegotiationReceipt.warnings ?? []
    });
  }
  if (contract.providerSession?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_session_blocked',
      blockers: contract.providerSession.blockers ?? []
    });
  }
  if (contract.providerSession?.renewalRequired) {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_provider_session_renewal_required',
      missingCapabilities: contract.providerSession.missingCapabilities ?? []
    });
  }
  if (writeEffects.length && !contract.handoffReceipt?.digest && !contract.sync?.handoffReceipt?.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_handoff_receipt_missing_digest' });
  }
  const handoffReceipt = contract.handoffReceipt ?? contract.sync?.handoffReceipt;
  if (handoffReceipt?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_handoff_receipt_blocked',
      blockers: handoffReceipt.blockers ?? []
    });
  }
  if (handoffReceipt?.fresh === false) {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_provider_handoff_receipt_stale',
      expectedDigest: handoffReceipt.expectedDigest ?? null,
      receiptDigest: handoffReceipt.receiptDigest ?? null
    });
  }
  if (handoffReceipt?.acknowledged === false && writeEffects.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_provider_handoff_receipt_unacknowledged' });
  }
  if (writeEffects.length && contract.sync?.cursorContract?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_cursor_blocked',
      blockers: contract.sync.cursorContract.blockers ?? []
    });
  }
  if (writeEffects.length && contract.sync?.lease?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_sync_lease_blocked',
      blockers: contract.sync.lease.blockers ?? []
    });
  }
  if (writeEffects.length && contract.sync?.cursorContract?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_provider_cursor_requires_review',
      warnings: contract.sync.cursorContract.warnings ?? []
    });
  }
  if (writeEffects.length && contract.sync?.lease?.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_provider_sync_lease_requires_review',
      warnings: contract.sync.lease.warnings ?? []
    });
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

function normalizeMailchimpProviderCursorContract({
  provider = {},
  kernelCall = null,
  programId = null,
  operation = null,
  route = {}
} = {}) {
  const sync = provider.sync ?? {};
  const incoming = sync.cursorContract ?? provider.cursorContract ?? kernelCall?.provider?.sync?.cursorContract ?? {};
  const cursor = incoming.cursor
    ?? sync.cursor
    ?? provider.syncCursor
    ?? provider.cursorValue
    ?? kernelCall?.handoff?.providerCursor
    ?? null;
  const watermark = incoming.watermark
    ?? sync.watermark
    ?? provider.syncWatermark
    ?? provider.watermark
    ?? null;
  const freshness = String(incoming.freshness ?? sync.cursorFreshness ?? provider.cursorFreshness ?? (cursor == null ? 'missing' : 'fresh'));
  const policy = incoming.policy ?? sync.cursorPolicy ?? provider.cursorPolicy ?? 'resume_from_last_seen';
  const required = incoming.required ?? sync.cursorRequired ?? false;
  const acceptableFreshness = uniqueSorted(asCapabilityList(
    incoming.acceptableFreshness
      ?? sync.acceptableFreshness
      ?? ['fresh', 'unknown']
  ));
  const cursorState = required && cursor == null
    ? 'missing'
    : !acceptableFreshness.includes(freshness)
      ? 'stale'
      : 'ready';
  const blockers = uniqueSorted([
    ...(incoming.blockers ?? []),
    ...(required && cursor == null ? ['provider_sync_cursor_missing'] : []),
    ...(cursorState === 'stale' && policy === 'strict_resume' ? ['provider_sync_cursor_stale'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(incoming.warnings ?? []),
    ...(cursorState === 'stale' && policy !== 'strict_resume' ? ['provider_sync_cursor_stale'] : []),
    ...(watermark == null && cursor != null ? ['provider_sync_watermark_missing'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'review'
      : cursorState === 'missing'
        ? 'blocked'
        : 'ready';
  const digestShape = {
    programId,
    operation,
    statusChannel: route.statusChannel ?? sync.statusChannel ?? null,
    externalStateKey: sync.externalStateKey ?? provider.externalStateKey ?? null,
    cursor,
    watermark,
    freshness,
    policy,
    state
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.provider-sync-cursor`,
    state,
    ready: state === 'ready',
    required: Boolean(required),
    cursor,
    watermark,
    freshness,
    policy,
    acceptableFreshness,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? 'restore_mailchimp_provider_cursor'
      : state === 'review'
        ? 'review_mailchimp_provider_cursor'
        : 'persist_mailchimp_provider_cursor',
    digest: incoming.digest ?? stableHash(digestShape)
  };
}

function buildProviderSessionContract({
  programId,
  operation,
  provider,
  state,
  requiredCapabilities,
  declaredCapabilities,
  acceptedCapabilities,
  missingCapabilities,
  sync,
  providerHealth,
  kernelCall,
  writeRequired
}) {
  const capabilityVector = uniqueSorted([
    ...requiredCapabilities.map((capability) => `required:${capability}`),
    ...declaredCapabilities.map((capability) => `declared:${capability}`),
    ...acceptedCapabilities.map((capability) => `accepted:${capability}`),
    ...missingCapabilities.map((capability) => `missing:${capability}`)
  ]);
  const renewalRequired = writeRequired && (
    missingCapabilities.length > 0
    || state === 'review'
    || sync.cursorContract?.state === 'review'
    || providerHealth.degraded === true
    || providerHealth.status === 'degraded'
  );
  const blockers = uniqueSorted([
    ...(!sync.statusChannel && writeRequired ? ['missing_provider_session_status_channel'] : []),
    ...(!sync.idempotencyKey && writeRequired ? ['missing_provider_session_idempotency_key'] : []),
    ...(!sync.externalStateKey && writeRequired ? ['missing_provider_session_external_state_key'] : []),
    ...(sync.cursorContract?.state === 'blocked' && writeRequired ? ['provider_session_cursor_blocked'] : []),
    ...missingCapabilities.map((capability) => `missing_capability:${capability}`)
  ]);
  const sessionState = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : renewalRequired
        ? 'renewal_required'
        : 'ready';
  const digestShape = {
    programId,
    operation,
    state: sessionState,
    externalStateKey: sync.externalStateKey,
    statusChannel: sync.statusChannel,
    idempotencyKey: sync.idempotencyKey,
    cursor: sync.cursor,
    cursorDigest: sync.cursorContract?.digest ?? null,
    capabilityVector
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.provider-session`,
    provider: provider.provider ?? kernelCall?.adapter ?? 'mailchimp',
    service: provider.service ?? 'mailchimp',
    programId,
    operation,
    state: sessionState,
    ready: sessionState === 'ready' || sessionState === 'not_required',
    writeRequired,
    externalStateKey: sync.externalStateKey,
    statusChannel: sync.statusChannel,
    idempotencyKey: sync.idempotencyKey,
    cursor: sync.cursor,
    cursorContract: sync.cursorContract,
    checkpointDigest: sync.checkpointDigest,
    capabilityVector,
    requiredCapabilities,
    declaredCapabilities,
    acceptedCapabilities,
    missingCapabilities,
    renewalRequired,
    renewalPolicy: provider.session?.renewalPolicy ?? (renewalRequired ? 'renegotiate_before_resume' : 'reuse_until_capability_drift'),
    replayPolicy: provider.session?.replayPolicy ?? 'return_existing_by_idempotency_key',
    blockers,
    nextAction: sessionState === 'blocked'
      ? providerServiceAction(blockers[0])
      : renewalRequired
        ? 'renegotiate_mailchimp_provider_session'
        : writeRequired
          ? 'persist_mailchimp_provider_session'
          : 'continue_read_only',
    digest: stableHash(digestShape)
  };
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
  if (String(blocker).includes('handoff_receipt')) return providerHandoffReceiptAction(blocker);
  if (String(blocker).includes('lifecycle')) return 'repair_lifecycle_before_provider_handoff';
  if (String(blocker).includes('health')) return 'resolve_provider_health';
  return 'review_mailchimp_provider_contract';
}

function providerHandoffReceiptAction(blocker) {
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('external_state_key')) return 'persist_provider_external_state_key';
  if (String(blocker).includes('cursor')) return 'repair_mailchimp_provider_cursor';
  if (String(blocker).includes('lease')) return 'repair_mailchimp_provider_sync_lease';
  if (String(blocker).includes('denied_capability')) return 'resolve_provider_denied_capability';
  if (String(blocker).includes('acknowledgement')) return 'acknowledge_mailchimp_external_write_handoff';
  if (String(blocker).includes('stale')) return 'refresh_mailchimp_external_write_handoff_receipt';
  return 'repair_mailchimp_external_write_handoff_receipt';
}

function asCapabilityList(value) {
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  if (value == null || value === false) return [];
  if (value === true) return ['mailchimp.write'];
  return String(value)
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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
      syncLease: {
        state: providerServiceContract?.sync?.lease?.state ?? 'unknown',
        ready: providerServiceContract?.sync?.lease?.ready ?? false,
        digest: providerServiceContract?.sync?.lease?.digest ?? null,
        commandId: providerServiceContract?.sync?.lease?.command?.commandId ?? null,
        resource: providerServiceContract?.sync?.lease?.resource ?? null,
        replayPolicy: providerServiceContract?.sync?.lease?.replayPolicy ?? null,
        nextAction: providerServiceContract?.sync?.lease?.nextAction ?? null
      },
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
    providerExternalStateKey: providerCommand.serviceContract?.externalStateKey
      ?? providerCommand.serviceContract?.sync?.externalStateKey
      ?? null,
    providerCursorState: providerCommand.serviceContract?.sync?.cursorContract?.state ?? 'unknown',
    providerCursorDigest: providerCommand.serviceContract?.sync?.cursorContract?.digest ?? null,
    providerSyncLeaseState: providerCommand.serviceContract?.syncLease?.state
      ?? providerCommand.serviceContract?.sync?.lease?.state
      ?? 'unknown',
    providerSyncLeaseDigest: providerCommand.serviceContract?.syncLease?.digest
      ?? providerCommand.serviceContract?.sync?.lease?.digest
      ?? null,
    providerSyncLeaseCommandId: providerCommand.serviceContract?.syncLease?.commandId
      ?? providerCommand.serviceContract?.sync?.lease?.command?.commandId
      ?? null,
    providerSyncLeaseResource: providerCommand.serviceContract?.syncLease?.resource
      ?? providerCommand.serviceContract?.sync?.lease?.resource
      ?? null,
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

function buildClientRuntimeAdoptionContract({
  programId,
  operation,
  route,
  lifecycleGate,
  writeEffects,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const requiredAcknowledgements = uniqueSorted([
    ...(kernelCall?.preview?.acceptance?.missingAcknowledgements ?? []),
    ...(lifecycleGate?.acknowledgementRequired ? ['lifecycle_gate'] : []),
    ...(clientRuntimeHandoff?.state === 'held' ? ['manual_release_hold'] : []),
    ...(providerCommand?.state === 'scheduled' ? ['scheduled_provider_dispatch'] : [])
  ]);
  const blockers = uniqueSorted([
    ...(clientRuntimeHandoff?.blockers ?? []).map((blocker) => `handoff_${blocker}`),
    ...(clientRequestSnapshot?.blockers ?? []).map((blocker) => `request_${blocker}`),
    ...(providerCommand?.blockers ?? []).map((blocker) => `provider_${blocker}`),
    ...(syncMetadata?.blockers ?? []).map((blocker) => `sync_${blocker}`),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_client_request_digest'] : []),
    ...(!clientRequestSnapshot?.requestKey && writeRequired ? ['missing_client_request_key'] : []),
    ...(!clientRuntimeHandoff?.idempotencyKey && writeRequired ? ['missing_client_idempotency_key'] : []),
    ...(!clientRuntimeHandoff?.statusChannel && writeRequired ? ['missing_client_status_channel'] : []),
    ...(!providerCommand?.commandId && writeRequired ? ['missing_provider_command_id'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(clientRuntimeHandoff?.providerHealth?.degraded ? ['provider_health_degraded'] : []),
    ...(clientRuntimeHandoff?.providerCommand?.safeToReplay === false && writeRequired ? ['provider_command_not_replay_safe'] : []),
    ...(requiredAcknowledgements.length ? ['client_adoption_requires_acknowledgement'] : []),
    ...(lifecycleGate?.state === 'scheduled' ? ['lifecycle_gate_scheduled'] : []),
    ...(lifecycleGate?.state === 'held' ? ['lifecycle_gate_held'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : clientRuntimeHandoff.state === 'held' || lifecycleGate?.state === 'held'
        ? 'held'
        : clientRuntimeHandoff.state === 'scheduled' || lifecycleGate?.state === 'scheduled'
          ? 'scheduled'
          : requiredAcknowledgements.length
            ? 'awaiting_acknowledgement'
            : clientRuntimeHandoff.ready === true && clientRequestSnapshot.ready === true && syncMetadata.ready === true
              ? 'adoptable'
              : 'waiting';
  const digestShape = {
    programId,
    operation,
    state,
    idempotencyKey: clientRuntimeHandoff?.idempotencyKey ?? route.idempotencyKey ?? null,
    statusChannel: clientRuntimeHandoff?.statusChannel ?? route.statusChannel ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    clientRequestKey: clientRequestSnapshot?.requestKey ?? null,
    providerCommandId: providerCommand?.commandId ?? null,
    syncDigest: syncMetadata?.digest ?? null,
    requiredAcknowledgements,
    blockers,
    warnings
  };
  const digest = stableHash(digestShape);
  const commands = [{
    type: 'persist-client-runtime-adoption',
    commandId: `client-adoption:${digest}`,
    idempotencyKey: stableHash({ action: 'persist-client-runtime-adoption', digest }),
    statusAfterReplay: state,
    conflict: 'return-existing',
    writes: ['clientRuntimeAdoption', 'visibleStatus', 'nextAction']
  }];
  if (requiredAcknowledgements.length) {
    commands.push({
      type: 'collect-client-runtime-adoption-acknowledgement',
      commandId: `client-adoption-ack:${stableHash({ digest, requiredAcknowledgements })}`,
      idempotencyKey: stableHash({ action: 'collect-client-runtime-adoption-acknowledgement', digest, requiredAcknowledgements }),
      statusAfterReplay: 'awaiting_client_runtime_acknowledgement',
      conflict: 'return-existing',
      writes: ['requiredAcknowledgements', 'clientRuntimeAdoption']
    });
  }
  if (state === 'adoptable') {
    commands.push({
      type: 'publish-client-runtime-adoptable',
      commandId: `client-adoption-ready:${digest}`,
      idempotencyKey: stableHash({ action: 'publish-client-runtime-adoptable', digest }),
      statusAfterReplay: 'ready_for_mailchimp_confirmation',
      conflict: 'return-existing',
      writes: ['clientRequestDigest', 'providerCommandId', 'statusChannel']
    });
  }
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.client-runtime-adoption`,
    state,
    ready: state === 'adoptable' || state === 'not_required',
    writeRequired,
    presentationMode: state === 'adoptable'
      ? 'confirm'
      : state === 'awaiting_acknowledgement'
        ? 'acknowledge'
        : ['held', 'scheduled'].includes(state)
          ? 'defer'
          : 'repair',
    target: clientRuntimeHandoff?.target ?? 'mailchimp.client.workflow',
    statusChannel: clientRuntimeHandoff?.statusChannel ?? route.statusChannel ?? null,
    idempotencyKey: clientRuntimeHandoff?.idempotencyKey ?? route.idempotencyKey ?? null,
    restartToken: clientRuntimeHandoff?.resume?.restartToken ?? syncMetadata?.restartToken ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    clientRequestKey: clientRequestSnapshot?.requestKey ?? null,
    providerCommandId: providerCommand?.commandId ?? null,
    providerCommandState: providerCommand?.state ?? 'unknown',
    syncState: syncMetadata?.state ?? 'unknown',
    resume: {
      mode: clientRuntimeHandoff?.resume?.mode ?? kernelCall?.handoff?.continuationMode ?? 'resume_after_kernel_ack',
      safeToResume: clientRuntimeHandoff?.resume?.safeToResume === true || clientRequestSnapshot?.resume?.safeToResume === true,
      snapshotHint: clientRuntimeHandoff?.resume?.snapshotHint ?? clientRequestSnapshot?.resume?.snapshotHint ?? null
    },
    scope: {
      tenantId: route.tenantId ?? null,
      workspaceId: route.workspaceId ?? null,
      isolationKey: route.isolationKey ?? null
    },
    userVisibleStatus: clientRuntimeAdoptionStatus(state),
    requiredAcknowledgements,
    commands,
    blockers,
    warnings,
    nextAction: clientRuntimeAdoptionAction({ state, blockers, requiredAcknowledgements, clientRuntimeHandoff, clientRequestSnapshot, syncMetadata }),
    digest
  };
}

function validateClientRuntimeAdoptionContract(adoption, writeEffects) {
  if (!writeEffects.length && !adoption) return [];
  const diagnostics = [];
  if (!adoption) return [{ level: 'error', code: 'external_write_missing_client_runtime_adoption' }];
  if (writeEffects.length && adoption.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_not_write_required' });
  }
  if (adoption.ready && adoption.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_ready_with_blockers', blockers: adoption.blockers });
  }
  if (adoption.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_blocked', blockers: adoption.blockers ?? [] });
  }
  if (writeEffects.length && !adoption.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_missing_digest' });
  }
  if (writeEffects.length && !adoption.commands?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_missing_command' });
  }
  if (adoption.state === 'awaiting_acknowledgement' && !adoption.requiredAcknowledgements?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_missing_acknowledgement_reason' });
  }
  if (adoption.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_client_runtime_adoption_review', warnings: adoption.warnings });
  }
  return diagnostics;
}

function buildClientRuntimeAdoptionReceipt({
  programId,
  operation,
  route,
  writeEffects,
  providerCommand,
  syncMetadata,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  clientRuntimeAdoption,
  lifecycleGate,
  boundaryTicket,
  boundaryAuditHandoff,
  providerHealth,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const checkpoints = [
    adoptionReceiptCheckpoint('client_request_snapshot', clientRequestSnapshot?.state, clientRequestSnapshot?.ready === true || !writeRequired, clientRequestSnapshot?.digest, clientRequestSnapshot?.blockers, clientRequestSnapshot?.warnings, clientRequestSnapshot?.nextAction),
    adoptionReceiptCheckpoint('client_runtime_handoff', clientRuntimeHandoff?.state, clientRuntimeHandoff?.ready === true || !writeRequired, clientRuntimeHandoff?.idempotencyKey ?? clientRuntimeHandoff?.statusChannel, clientRuntimeHandoff?.blockers, clientRuntimeHandoff?.warnings, clientRuntimeHandoff?.nextAction),
    adoptionReceiptCheckpoint('client_runtime_adoption', clientRuntimeAdoption?.state, clientRuntimeAdoption?.ready === true || !writeRequired, clientRuntimeAdoption?.digest, clientRuntimeAdoption?.blockers, clientRuntimeAdoption?.warnings, clientRuntimeAdoption?.nextAction),
    adoptionReceiptCheckpoint('provider_command', providerCommand?.state, Boolean(providerCommand?.commandId) || !writeRequired, providerCommand?.commandId, providerCommand?.blockers, providerCommand?.warnings, providerCommand?.nextAction),
    adoptionReceiptCheckpoint('sync_metadata', syncMetadata?.state, syncMetadata?.ready === true || !writeRequired, syncMetadata?.digest, syncMetadata?.blockers, syncMetadata?.warnings, syncMetadata?.nextAction),
    adoptionReceiptCheckpoint('boundary_ticket', boundaryTicket?.state, boundaryTicket?.ready === true || !writeRequired, boundaryTicket?.auditDigest, boundaryTicket?.blockers, boundaryTicket?.warnings, boundaryTicket?.nextAction),
    adoptionReceiptCheckpoint('boundary_audit', boundaryAuditHandoff?.state, boundaryAuditHandoff?.ready === true || !writeRequired, boundaryAuditHandoff?.auditDigest, boundaryAuditHandoff?.blockers, boundaryAuditHandoff?.warnings, boundaryAuditHandoff?.nextAction)
  ];
  const failed = checkpoints.filter((checkpoint) => checkpoint.outcome === 'failed');
  const review = checkpoints.filter((checkpoint) => checkpoint.outcome === 'review');
  const pending = checkpoints.find((checkpoint) => checkpoint.outcome === 'pending');
  const receiptKey = stableHash({
    programId,
    operation,
    clientRequestKey: clientRequestSnapshot?.requestKey ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    adoptionDigest: clientRuntimeAdoption?.digest ?? null,
    providerCommandId: providerCommand?.commandId ?? null,
    statusChannel: route?.statusChannel ?? clientRuntimeHandoff?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? clientRuntimeHandoff?.idempotencyKey ?? null
  });
  const statusAdoptionPreview = buildClientStatusAdoptionCheckpoint({
    programId,
    operation,
    receiptKey,
    state: null,
    route,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    clientRuntimeAdoption,
    providerCommand,
    syncMetadata,
    lifecycleGate,
    boundaryTicket,
    providerHealth,
    pending,
    writeRequired
  });
  const blockers = uniqueSorted([
    ...failed.flatMap((checkpoint) => checkpoint.blockers.length ? checkpoint.blockers.map((blocker) => `${checkpoint.name}_${blocker}`) : [`checkpoint_failed:${checkpoint.name}`]),
    ...(statusAdoptionPreview.blockers ?? []).map((blocker) => `status_adoption_${blocker}`),
    ...(!clientRuntimeAdoption?.digest && writeRequired ? ['missing_adoption_digest'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_request_digest'] : []),
    ...(!clientRequestSnapshot?.requestKey && writeRequired ? ['missing_request_key'] : []),
    ...(!providerCommand?.commandId && writeRequired ? ['missing_provider_command_id'] : []),
    ...(!route?.statusChannel && !clientRuntimeHandoff?.statusChannel && writeRequired ? ['missing_status_channel'] : []),
    ...(!route?.idempotencyKey && !clientRuntimeHandoff?.idempotencyKey && writeRequired ? ['missing_idempotency_key'] : []),
    ...(boundaryTicket?.ready === false && writeRequired ? ['boundary_ticket_not_ready'] : [])
  ]);
  const warnings = uniqueSorted([
    ...review.flatMap((checkpoint) => checkpoint.warnings.length ? checkpoint.warnings.map((warning) => `${checkpoint.name}_${warning}`) : [`checkpoint_review:${checkpoint.name}`]),
    ...(statusAdoptionPreview.warnings ?? []).map((warning) => `status_adoption_${warning}`),
    ...(providerHealth?.degraded ? ['provider_health_degraded'] : []),
    ...(clientRuntimeAdoption?.state === 'awaiting_acknowledgement' ? ['adoption_awaiting_acknowledgement'] : []),
    ...(lifecycleGate?.state === 'held' ? ['lifecycle_gate_held'] : []),
    ...(lifecycleGate?.state === 'scheduled' ? ['lifecycle_gate_scheduled'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : lifecycleGate?.state === 'held' || clientRuntimeAdoption?.state === 'held'
        ? 'held'
        : lifecycleGate?.state === 'scheduled' || clientRuntimeAdoption?.state === 'scheduled'
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : checkpoints.every((checkpoint) => checkpoint.outcome === 'ready')
              ? 'issued'
              : 'waiting';
  const statusAdoptionCheckpoint = buildClientStatusAdoptionCheckpoint({
    programId,
    operation,
    receiptKey,
    state,
    route,
    clientRuntimeHandoff,
    clientRequestSnapshot,
    clientRuntimeAdoption,
    providerCommand,
    syncMetadata,
    lifecycleGate,
    boundaryTicket,
    providerHealth,
    pending,
    writeRequired
  });
  const commandReady = ['issued', 'review'].includes(state);
  const digestShape = {
    programId,
    operation,
    receiptKey,
    state,
    checkpoints: checkpoints.map((checkpoint) => `${checkpoint.name}:${checkpoint.outcome}:${checkpoint.digest}`),
    statusAdoptionDigest: statusAdoptionCheckpoint.digest,
    blockers,
    warnings
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.client-runtime-adoption-receipt`,
    programId,
    operation,
    state,
    ready: state === 'issued' || state === 'not_required',
    writeRequired,
    receiptKey,
    target: clientRuntimeAdoption?.target ?? clientRuntimeHandoff?.target ?? 'mailchimp.client.workflow',
    statusChannel: route?.statusChannel ?? clientRuntimeHandoff?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? clientRuntimeHandoff?.idempotencyKey ?? null,
    restartToken: clientRuntimeAdoption?.restartToken ?? clientRuntimeHandoff?.resume?.restartToken ?? syncMetadata?.restartToken ?? kernelCall?.runtimeState?.profileRestartToken ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    clientRequestKey: clientRequestSnapshot?.requestKey ?? null,
    adoptionDigest: clientRuntimeAdoption?.digest ?? null,
    providerCommandId: providerCommand?.commandId ?? null,
    providerCommandState: providerCommand?.state ?? 'unknown',
    statusAdoptionCheckpoint,
    userVisibleStatus: {
      current: clientRuntimeAdoption?.userVisibleStatus ?? clientRuntimeHandoff?.userVisibleStatus?.pending ?? adoptionReceiptStatus(state),
      completion: clientRuntimeHandoff?.userVisibleStatus?.completion ?? 'mailchimp_runtime_adoption_persisted',
      failure: clientRuntimeHandoff?.userVisibleStatus?.failure ?? 'mailchimp_runtime_adoption_needs_review'
    },
    command: {
      commandId: commandReady ? `client-adoption-receipt:${receiptKey}` : null,
      type: 'persist-client-runtime-adoption-receipt',
      idempotencyKey: commandReady ? stableHash({ action: 'persist-client-runtime-adoption-receipt', receiptKey }) : null,
      statusAfterReplay: commandReady ? 'client_runtime_adoption_receipt_persisted' : 'client_runtime_adoption_receipt_waiting',
      conflict: 'return-existing',
      writes: ['clientRuntimeAdoptionReceipt', 'clientRequestDigest', 'providerCommandId', 'statusChannel']
    },
    checkpoints,
    restartSemantics: {
      restartSafe: Boolean(route?.idempotencyKey ?? clientRuntimeHandoff?.idempotencyKey ?? !writeRequired)
        && Boolean(clientRequestSnapshot?.digest ?? !writeRequired)
        && Boolean(clientRuntimeAdoption?.digest ?? !writeRequired)
        && statusAdoptionCheckpoint.restartSafe !== false
        && providerCommand?.safeToReplay !== false,
      onRestart: state === 'issued' ? 'load_client_runtime_adoption_receipt' : pending?.nextAction ?? clientRuntimeAdoption?.nextAction ?? 'resume_client_runtime_adoption',
      onDuplicateCommand: 'return_existing_client_runtime_adoption_receipt',
      onStaleRequestSnapshot: 'rebuild_client_runtime_adoption_receipt',
      onBoundaryChange: 'invalidate_client_runtime_adoption_receipt'
    },
    audit: {
      channel: route?.auditChannel ?? boundaryAuditHandoff?.auditChannel ?? 'audit.mailchimp.runtime_handoff',
      tenantId: route?.tenantId ?? boundaryTicket?.tenantId ?? null,
      workspaceId: route?.workspaceId ?? boundaryTicket?.workspaceId ?? null,
      isolationKey: route?.isolationKey ?? boundaryTicket?.isolationKey ?? null,
      auditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? adoptionReceiptAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? 'review_client_runtime_adoption_receipt'
            : state === 'issued'
              ? 'persist_client_runtime_adoption_receipt'
              : pending?.nextAction ?? 'wait_for_client_runtime_adoption_receipt',
    digest: stableHash(digestShape)
  };
}

function buildClientStatusAdoptionCheckpoint({
  programId,
  operation,
  receiptKey,
  state,
  route,
  clientRuntimeHandoff,
  clientRequestSnapshot,
  clientRuntimeAdoption,
  providerCommand,
  syncMetadata,
  lifecycleGate,
  boundaryTicket,
  providerHealth,
  pending,
  writeRequired
}) {
  const statusChannel = route?.statusChannel ?? clientRuntimeHandoff?.statusChannel ?? null;
  const idempotencyKey = route?.idempotencyKey ?? clientRuntimeHandoff?.idempotencyKey ?? null;
  const restartToken = clientRuntimeAdoption?.restartToken
    ?? clientRuntimeHandoff?.resume?.restartToken
    ?? syncMetadata?.restartToken
    ?? null;
  const userVisibleStatus = clientRuntimeAdoption?.userVisibleStatus
    ?? clientRuntimeHandoff?.userVisibleStatus?.pending
    ?? adoptionReceiptStatus(state);
  const blockers = uniqueSorted([
    ...(!statusChannel && writeRequired ? ['missing_status_channel'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_idempotency_key'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_client_request_digest'] : []),
    ...(!clientRuntimeAdoption?.digest && writeRequired ? ['missing_client_adoption_digest'] : []),
    ...(!providerCommand?.commandId && writeRequired ? ['missing_provider_command_id'] : []),
    ...(boundaryTicket?.ready === false && writeRequired ? ['boundary_ticket_not_ready'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(providerHealth?.degraded ? ['provider_degraded'] : []),
    ...(clientRuntimeAdoption?.state === 'awaiting_acknowledgement' ? ['awaiting_client_acknowledgement'] : []),
    ...(lifecycleGate?.state === 'held' ? ['manual_release_hold'] : []),
    ...(lifecycleGate?.state === 'scheduled' ? ['scheduled_release'] : [])
  ]);
  const checkpointState = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : ['held', 'scheduled', 'review', 'issued'].includes(state)
        ? state
        : clientRuntimeAdoption?.state === 'awaiting_acknowledgement'
          ? 'awaiting_acknowledgement'
          : 'waiting';
  const digestShape = {
    programId,
    operation,
    receiptKey,
    checkpointState,
    statusChannel,
    idempotencyKey,
    restartToken,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    clientRequestKey: clientRequestSnapshot?.requestKey ?? null,
    adoptionDigest: clientRuntimeAdoption?.digest ?? null,
    providerCommandId: providerCommand?.commandId ?? null,
    lifecycleState: lifecycleGate?.state ?? null,
    userVisibleStatus,
    blockers,
    warnings
  };
  const digest = stableHash(digestShape);
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.client-status-adoption-checkpoint`,
    state: checkpointState,
    ready: checkpointState === 'issued' || checkpointState === 'review' || checkpointState === 'not_required',
    writeRequired,
    receiptKey,
    statusChannel,
    idempotencyKey,
    restartToken,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    clientRequestKey: clientRequestSnapshot?.requestKey ?? null,
    adoptionDigest: clientRuntimeAdoption?.digest ?? null,
    providerCommandId: providerCommand?.commandId ?? null,
    userVisibleStatus,
    restartSafe: Boolean(idempotencyKey ?? !writeRequired)
      && Boolean(statusChannel ?? !writeRequired)
      && Boolean(clientRequestSnapshot?.digest ?? !writeRequired)
      && Boolean(clientRuntimeAdoption?.digest ?? !writeRequired),
    resumePointer: stableHash({
      receiptKey,
      statusChannel,
      restartToken,
      clientRequestDigest: clientRequestSnapshot?.digest ?? null,
      adoptionDigest: clientRuntimeAdoption?.digest ?? null
    }),
    command: {
      commandId: checkpointState === 'issued' || checkpointState === 'review'
        ? `client-status-adoption:${digest}`
        : null,
      type: 'persist-client-status-adoption-checkpoint',
      idempotencyKey: checkpointState === 'issued' || checkpointState === 'review'
        ? stableHash({ action: 'persist-client-status-adoption-checkpoint', digest })
        : null,
      statusAfterReplay: checkpointState === 'issued'
        ? 'client_status_adoption_checkpoint_persisted'
        : checkpointState === 'review'
          ? 'client_status_adoption_checkpoint_persisted_with_warnings'
          : 'client_status_adoption_checkpoint_waiting',
      conflict: 'return-existing',
      writes: ['clientStatusAdoptionCheckpoint', 'userVisibleStatus', 'resumePointer']
    },
    blockers,
    warnings,
    nextAction: checkpointState === 'blocked'
      ? adoptionReceiptAction(blockers[0])
      : checkpointState === 'held'
        ? 'await_manual_release'
        : checkpointState === 'scheduled'
          ? 'wait_for_schedule_window'
          : checkpointState === 'awaiting_acknowledgement'
            ? 'collect_client_runtime_adoption_acknowledgement'
            : checkpointState === 'issued' || checkpointState === 'review'
              ? 'persist_client_status_adoption_checkpoint'
              : pending?.nextAction ?? clientRuntimeAdoption?.nextAction ?? 'wait_for_client_status_adoption_checkpoint',
    digest
  };
}

function buildClientWorkflowStatusCapsule({
  programId,
  operation,
  status,
  writeEffects,
  route,
  clientRequestSnapshot,
  clientRuntimeAdoption,
  clientRuntimeAdoptionReceipt,
  statusHandoff,
  persistedStatus,
  statusJournal,
  resumeCursor,
  acceptanceCheckpointBundle,
  operatorReadiness,
  operationalHealth,
  providerHealth,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const statusAdoption = clientRuntimeAdoptionReceipt?.statusAdoptionCheckpoint ?? {};
  const statusChannel = statusHandoff?.statusChannel
    ?? clientRuntimeAdoptionReceipt?.statusChannel
    ?? route?.statusChannel
    ?? null;
  const idempotencyKey = route?.idempotencyKey
    ?? clientRuntimeAdoptionReceipt?.idempotencyKey
    ?? kernelCall?.handoff?.idempotencyKey
    ?? null;
  const restartToken = statusHandoff?.restartToken
    ?? clientRuntimeAdoptionReceipt?.restartToken
    ?? persistedStatus?.restartToken
    ?? kernelCall?.runtimeState?.profileRestartToken
    ?? null;
  const operatorLifecycleAction = normalizeKernelOperatorLifecycleAction(kernelCall, {
    status,
    writeRequired,
    statusChannel,
    idempotencyKey,
    restartToken
  });
  const checkpoints = [
    workflowStatusCheckpoint('client_request', clientRequestSnapshot?.state, clientRequestSnapshot?.digest, clientRequestSnapshot?.ready === true || !writeRequired, clientRequestSnapshot?.blockers, clientRequestSnapshot?.warnings),
    workflowStatusCheckpoint('client_adoption', clientRuntimeAdoption?.state, clientRuntimeAdoption?.digest, clientRuntimeAdoption?.ready === true || !writeRequired, clientRuntimeAdoption?.blockers, clientRuntimeAdoption?.warnings),
    workflowStatusCheckpoint('client_adoption_receipt', clientRuntimeAdoptionReceipt?.state, clientRuntimeAdoptionReceipt?.digest, clientRuntimeAdoptionReceipt?.ready === true || !writeRequired, clientRuntimeAdoptionReceipt?.blockers, clientRuntimeAdoptionReceipt?.warnings),
    workflowStatusCheckpoint('status_adoption', statusAdoption.state, statusAdoption.digest, statusAdoption.ready === true || !writeRequired, statusAdoption.blockers, statusAdoption.warnings),
    workflowStatusCheckpoint('status_handoff', statusHandoff?.state, statusHandoff?.digest, statusHandoff?.ready === true || !writeRequired, statusHandoff?.blockers, statusHandoff?.warnings),
    workflowStatusCheckpoint('acceptance_checkpoint', acceptanceCheckpointBundle?.state, acceptanceCheckpointBundle?.digest, acceptanceCheckpointBundle?.ready === true || !writeRequired, acceptanceCheckpointBundle?.blockers, acceptanceCheckpointBundle?.warnings),
    workflowStatusCheckpoint('resume_cursor', resumeCursor?.state, resumeCursor?.digest, resumeCursor?.ready === true || !writeRequired, resumeCursor?.blockers, resumeCursor?.warnings),
    workflowStatusCheckpoint('operator_lifecycle_action', operatorLifecycleAction.state, operatorLifecycleAction.digest, operatorLifecycleAction.ready === true || !writeRequired, operatorLifecycleAction.blockers, operatorLifecycleAction.warnings)
  ];
  const failed = checkpoints.filter((checkpoint) => checkpoint.outcome === 'failed');
  const review = checkpoints.filter((checkpoint) => checkpoint.outcome === 'review');
  const pending = checkpoints.find((checkpoint) => checkpoint.outcome === 'pending');
  const blockers = uniqueSorted([
    ...failed.flatMap((checkpoint) => checkpoint.blockers.length ? checkpoint.blockers.map((blocker) => `${checkpoint.name}_${blocker}`) : [`checkpoint_failed:${checkpoint.name}`]),
    ...(!statusChannel && writeRequired ? ['missing_workflow_status_channel'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_workflow_idempotency_key'] : []),
    ...(!clientRequestSnapshot?.requestKey && writeRequired ? ['missing_workflow_client_request_key'] : []),
    ...(!statusAdoption.resumePointer && writeRequired ? ['missing_workflow_status_resume_pointer'] : []),
    ...(clientRuntimeAdoptionReceipt?.restartSemantics?.restartSafe === false ? ['client_adoption_receipt_not_restart_safe'] : []),
    ...(statusAdoption.restartSafe === false ? ['client_status_adoption_not_restart_safe'] : []),
    ...(operatorLifecycleAction.state === 'blocked' ? operatorLifecycleAction.blockers.map((blocker) => `operator_lifecycle_${blocker}`) : []),
    ...(writeRequired && !operatorLifecycleAction.digest ? ['missing_operator_lifecycle_action_digest'] : []),
    ...(operatorLifecycleAction.requiresAcknowledgement && !operatorLifecycleAction.acknowledgementToken ? ['missing_operator_lifecycle_acknowledgement_token'] : [])
  ]);
  const warnings = uniqueSorted([
    ...review.flatMap((checkpoint) => checkpoint.warnings.length ? checkpoint.warnings.map((warning) => `${checkpoint.name}_${warning}`) : [`checkpoint_review:${checkpoint.name}`]),
    ...(providerHealth?.degraded ? ['provider_degraded'] : []),
    ...(operationalHealth?.state === 'degraded' ? ['operational_health_degraded'] : []),
    ...(statusJournal?.state === 'review' ? ['status_journal_review'] : []),
    ...(operatorLifecycleAction.warnings ?? []).map((warning) => `operator_lifecycle_${warning}`)
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : statusHandoff?.state === 'held' || clientRuntimeAdoptionReceipt?.state === 'held'
        ? 'held'
        : statusHandoff?.state === 'scheduled' || clientRuntimeAdoptionReceipt?.state === 'scheduled'
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : checkpoints.every((checkpoint) => checkpoint.outcome === 'ready')
              ? 'ready'
              : 'waiting';
  const resumePointer = stableHash({
    programId,
    operation,
    statusChannel,
    restartToken,
    requestKey: clientRequestSnapshot?.requestKey ?? null,
    requestDigest: clientRequestSnapshot?.digest ?? null,
    adoptionReceiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
    statusAdoptionPointer: statusAdoption.resumePointer ?? null,
    operatorLifecycleDigest: operatorLifecycleAction.digest ?? null,
    statusHandoffDigest: statusHandoff?.digest ?? null
  });
  const digestShape = {
    programId,
    operation,
    state,
    status,
    statusChannel,
    idempotencyKey,
    restartToken,
    resumePointer,
    checkpoints: checkpoints.map((checkpoint) => `${checkpoint.name}:${checkpoint.outcome}:${checkpoint.digest}`),
    blockers,
    warnings
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.client-workflow-status-capsule`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    statusChannel,
    idempotencyKey,
    restartToken,
    resumePointer,
    restartSafe: Boolean(idempotencyKey ?? !writeRequired)
      && Boolean(statusChannel ?? !writeRequired)
      && Boolean(clientRuntimeAdoptionReceipt?.digest ?? !writeRequired)
      && statusAdoption.restartSafe !== false,
    visibleStatus: {
      current: statusHandoff?.userVisibleStatus?.current
        ?? clientRuntimeAdoptionReceipt?.userVisibleStatus?.current
        ?? operatorReadiness?.userVisibleStatus
        ?? statusHandoffUserStatus(state),
      completion: statusHandoff?.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: statusHandoff?.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    request: {
      key: clientRequestSnapshot?.requestKey ?? null,
      digest: clientRequestSnapshot?.digest ?? null
    },
    adoption: {
      digest: clientRuntimeAdoption?.digest ?? null,
      receiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
      statusAdoptionDigest: statusAdoption.digest ?? null,
      statusAdoptionResumePointer: statusAdoption.resumePointer ?? null
    },
    operatorLifecycleAction,
    command: {
      commandId: state === 'ready' || state === 'review'
        ? `client-workflow-status:${stableHash(digestShape)}`
        : null,
      type: 'persist-client-workflow-status-capsule',
      idempotencyKey: state === 'ready' || state === 'review'
        ? stableHash({ action: 'persist-client-workflow-status-capsule', digestShape })
        : null,
      conflict: 'return-existing',
      statusAfterReplay: state === 'ready'
        ? 'client_workflow_status_ready'
        : state === 'review'
          ? 'client_workflow_status_ready_with_warnings'
          : 'client_workflow_status_waiting'
    },
    checkpoints,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? statusHandoffAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? 'review_client_workflow_status'
            : state === 'ready'
              ? 'persist_client_workflow_status_capsule'
              : pending?.nextAction ?? 'wait_for_client_workflow_status_capsule',
    digest: stableHash(digestShape)
  };
}

function validateClientWorkflowStatusCapsule(capsule, writeEffects) {
  if (!writeEffects.length && !capsule) return [];
  const diagnostics = [];
  if (!capsule) return [{ level: 'error', code: 'external_write_missing_client_workflow_status_capsule' }];
  if (writeEffects.length && capsule.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'client_workflow_status_capsule_not_write_required' });
  }
  if (capsule.ready && capsule.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'client_workflow_status_capsule_ready_with_blockers', blockers: capsule.blockers });
  }
  if (capsule.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'client_workflow_status_capsule_blocked', blockers: capsule.blockers ?? [] });
  }
  if (writeEffects.length && !capsule.digest) {
    diagnostics.push({ level: 'error', code: 'client_workflow_status_capsule_missing_digest' });
  }
  if (writeEffects.length && !capsule.resumePointer) {
    diagnostics.push({ level: 'error', code: 'client_workflow_status_capsule_missing_resume_pointer' });
  }
  if (writeEffects.length && !capsule.statusChannel) {
    diagnostics.push({ level: 'error', code: 'client_workflow_status_capsule_missing_status_channel' });
  }
  if (capsule.ready && capsule.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'client_workflow_status_capsule_not_restart_safe' });
  }
  if (writeEffects.length && !capsule.operatorLifecycleAction?.digest) {
    diagnostics.push({ level: 'error', code: 'client_workflow_status_capsule_missing_operator_lifecycle_action' });
  }
  if (capsule.operatorLifecycleAction?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'client_workflow_status_capsule_operator_lifecycle_blocked',
      blockers: capsule.operatorLifecycleAction.blockers ?? []
    });
  }
  if (capsule.operatorLifecycleAction?.requiresAcknowledgement && !capsule.operatorLifecycleAction?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'client_workflow_status_capsule_operator_lifecycle_ack_missing' });
  }
  if ((capsule.state === 'review' || capsule.warnings?.length) && capsule.state !== 'blocked') {
    diagnostics.push({ level: 'warning', code: 'client_workflow_status_capsule_review', warnings: capsule.warnings ?? [] });
  }
  return diagnostics;
}

function buildClientWorkflowAdoptionLease({
  programId,
  operation,
  status,
  writeEffects,
  route,
  clientRequestSnapshot,
  clientRuntimeAdoption,
  clientRuntimeAdoptionReceipt,
  clientWorkflowStatusCapsule,
  statusHandoff,
  resumeCursor,
  acceptanceCheckpointBundle,
  providerHealth,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const statusAdoption = clientRuntimeAdoptionReceipt?.statusAdoptionCheckpoint ?? {};
  const statusChannel = clientWorkflowStatusCapsule?.statusChannel
    ?? statusHandoff?.statusChannel
    ?? clientRuntimeAdoptionReceipt?.statusChannel
    ?? route?.statusChannel
    ?? null;
  const idempotencyKey = clientWorkflowStatusCapsule?.idempotencyKey
    ?? clientRuntimeAdoptionReceipt?.idempotencyKey
    ?? route?.idempotencyKey
    ?? kernelCall?.handoff?.idempotencyKey
    ?? null;
  const restartToken = clientWorkflowStatusCapsule?.restartToken
    ?? clientRuntimeAdoptionReceipt?.restartToken
    ?? statusHandoff?.restartToken
    ?? kernelCall?.runtimeState?.profileRestartToken
    ?? kernelCall?.runtimeState?.restartToken
    ?? null;
  const resumePointer = clientWorkflowStatusCapsule?.resumePointer
    ?? statusAdoption.resumePointer
    ?? resumeCursor?.resumePointer
    ?? null;
  const leaseKey = stableHash({
    programId,
    operation,
    statusChannel,
    idempotencyKey,
    restartToken,
    requestKey: clientRequestSnapshot?.requestKey ?? null,
    requestDigest: clientRequestSnapshot?.digest ?? null
  });
  const expectedResumePointer = stableHash({
    programId,
    operation,
    statusChannel,
    restartToken,
    requestKey: clientRequestSnapshot?.requestKey ?? null,
    requestDigest: clientRequestSnapshot?.digest ?? null,
    adoptionDigest: clientRuntimeAdoption?.digest ?? null,
    adoptionReceiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
    workflowStatusDigest: clientWorkflowStatusCapsule?.digest ?? null,
    statusAdoptionPointer: statusAdoption.resumePointer ?? null
  });
  const pointerAligned = !writeRequired
    || resumePointer === clientWorkflowStatusCapsule?.resumePointer
    || resumePointer === statusAdoption.resumePointer;
  const channelAligned = !writeRequired
    || [statusHandoff?.statusChannel, clientRuntimeAdoptionReceipt?.statusChannel, route?.statusChannel]
      .filter(Boolean)
      .every((candidate) => candidate === statusChannel);
  const restartTokenAligned = !writeRequired
    || [clientRuntimeAdoption?.restartToken, clientRuntimeAdoptionReceipt?.restartToken, statusHandoff?.restartToken]
      .filter(Boolean)
      .every((candidate) => candidate === restartToken);
  const requestAligned = !writeRequired
    || clientRuntimeAdoption?.clientRequestDigest === clientRequestSnapshot?.digest
    || clientRuntimeAdoption?.clientRequestDigest == null;
  const blockers = uniqueSorted([
    ...(!statusChannel && writeRequired ? ['missing_lease_status_channel'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_lease_idempotency_key'] : []),
    ...(!restartToken && writeRequired ? ['missing_lease_restart_token'] : []),
    ...(!resumePointer && writeRequired ? ['missing_lease_resume_pointer'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_lease_request_digest'] : []),
    ...(!clientRuntimeAdoption?.digest && writeRequired ? ['missing_lease_adoption_digest'] : []),
    ...(!clientRuntimeAdoptionReceipt?.digest && writeRequired ? ['missing_lease_adoption_receipt_digest'] : []),
    ...(!clientWorkflowStatusCapsule?.digest && writeRequired ? ['missing_lease_workflow_status_digest'] : []),
    ...(clientWorkflowStatusCapsule?.restartSafe === false ? ['workflow_status_not_restart_safe'] : []),
    ...(statusAdoption.restartSafe === false ? ['status_adoption_not_restart_safe'] : []),
    ...(pointerAligned ? [] : ['lease_resume_pointer_mismatch']),
    ...(channelAligned ? [] : ['lease_status_channel_mismatch']),
    ...(restartTokenAligned ? [] : ['lease_restart_token_mismatch']),
    ...(requestAligned ? [] : ['lease_request_digest_mismatch'])
  ]);
  const warnings = uniqueSorted([
    ...(providerHealth?.degraded ? ['provider_degraded'] : []),
    ...(status === 'review' ? ['external_write_review'] : []),
    ...(statusHandoff?.state === 'review' ? ['status_handoff_review'] : []),
    ...(acceptanceCheckpointBundle?.state === 'review' ? ['acceptance_checkpoint_review'] : []),
    ...(resumeCursor?.restartSemantics?.restartSafe === false ? ['resume_cursor_not_restart_safe'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : clientWorkflowStatusCapsule?.state === 'held' || statusHandoff?.state === 'held'
        ? 'held'
        : clientWorkflowStatusCapsule?.state === 'scheduled' || statusHandoff?.state === 'scheduled'
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : clientWorkflowStatusCapsule?.ready === true
              ? 'leased'
              : 'waiting';
  const aligned = pointerAligned && channelAligned && restartTokenAligned && requestAligned;
  const restartSafe = !writeRequired || (
    aligned
    && Boolean(statusChannel)
    && Boolean(idempotencyKey)
    && Boolean(restartToken)
    && Boolean(resumePointer)
    && clientWorkflowStatusCapsule?.restartSafe === true
    && statusAdoption.restartSafe !== false
  );
  const digestShape = {
    programId,
    operation,
    state,
    leaseKey,
    statusChannel,
    idempotencyKey,
    restartToken,
    resumePointer,
    expectedResumePointer,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    adoptionDigest: clientRuntimeAdoption?.digest ?? null,
    adoptionReceiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
    workflowStatusDigest: clientWorkflowStatusCapsule?.digest ?? null,
    statusHandoffDigest: statusHandoff?.digest ?? null,
    acceptanceCheckpointDigest: acceptanceCheckpointBundle?.digest ?? null,
    aligned,
    restartSafe,
    blockers,
    warnings
  };
  const digest = stableHash(digestShape);
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.client-workflow-adoption-lease`,
    programId,
    operation,
    state,
    ready: ['leased', 'review', 'not_required'].includes(state),
    writeRequired,
    leaseKey,
    statusChannel,
    idempotencyKey,
    restartToken,
    resumePointer,
    expectedResumePointer,
    aligned,
    alignment: {
      statusChannel: channelAligned,
      restartToken: restartTokenAligned,
      resumePointer: pointerAligned,
      requestDigest: requestAligned
    },
    restartSafe,
    request: {
      key: clientRequestSnapshot?.requestKey ?? null,
      digest: clientRequestSnapshot?.digest ?? null
    },
    adoption: {
      digest: clientRuntimeAdoption?.digest ?? null,
      receiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
      statusAdoptionDigest: statusAdoption.digest ?? null,
      workflowStatusDigest: clientWorkflowStatusCapsule?.digest ?? null
    },
    command: {
      commandId: ['leased', 'review'].includes(state) ? `client-workflow-adoption-lease:${digest}` : null,
      type: 'persist-client-workflow-adoption-lease',
      idempotencyKey: ['leased', 'review'].includes(state)
        ? stableHash({ action: 'persist-client-workflow-adoption-lease', digest })
        : null,
      conflict: 'return-existing',
      statusAfterReplay: state === 'leased'
        ? 'client_workflow_adoption_lease_persisted'
        : state === 'review'
          ? 'client_workflow_adoption_lease_persisted_with_warnings'
          : 'client_workflow_adoption_lease_waiting',
      writes: ['clientWorkflowAdoptionLease', 'resumePointer', 'restartToken', 'userVisibleStatus']
    },
    userVisibleStatus: {
      current: clientWorkflowStatusCapsule?.visibleStatus?.current ?? statusHandoff?.userVisibleStatus?.current ?? 'mailchimp_runtime_adoption_lease_pending',
      completion: clientWorkflowStatusCapsule?.visibleStatus?.completion ?? 'mailchimp_runtime_adoption_lease_persisted',
      failure: clientWorkflowStatusCapsule?.visibleStatus?.failure ?? 'mailchimp_runtime_adoption_lease_needs_review'
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
            ? 'review_client_workflow_adoption_lease'
            : state === 'leased'
              ? 'persist_client_workflow_adoption_lease'
              : clientWorkflowStatusCapsule?.nextAction ?? 'wait_for_client_workflow_adoption_lease',
    digest
  };
}

function validateClientWorkflowAdoptionLease(lease, writeEffects) {
  if (!writeEffects.length && !lease) return [];
  const diagnostics = [];
  if (!lease) return [{ level: 'error', code: 'external_write_missing_client_workflow_adoption_lease' }];
  if (writeEffects.length && lease.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'client_workflow_adoption_lease_not_write_required' });
  }
  if (lease.ready && lease.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'client_workflow_adoption_lease_ready_with_blockers', blockers: lease.blockers });
  }
  if (lease.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'client_workflow_adoption_lease_blocked', blockers: lease.blockers ?? [] });
  }
  if (writeEffects.length && !lease.digest) {
    diagnostics.push({ level: 'error', code: 'client_workflow_adoption_lease_missing_digest' });
  }
  if (writeEffects.length && !lease.leaseKey) {
    diagnostics.push({ level: 'error', code: 'client_workflow_adoption_lease_missing_key' });
  }
  if (writeEffects.length && !lease.resumePointer) {
    diagnostics.push({ level: 'error', code: 'client_workflow_adoption_lease_missing_resume_pointer' });
  }
  if (writeEffects.length && lease.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'client_workflow_adoption_lease_not_restart_safe' });
  }
  if (writeEffects.length && lease.aligned !== true) {
    diagnostics.push({ level: 'error', code: 'client_workflow_adoption_lease_not_aligned', alignment: lease.alignment ?? {} });
  }
  if (lease.state === 'review' || lease.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'client_workflow_adoption_lease_review', warnings: lease.warnings ?? [] });
  }
  return diagnostics;
}

function normalizeKernelOperatorLifecycleAction(kernelCall, {
  status,
  writeRequired,
  statusChannel,
  idempotencyKey,
  restartToken
}) {
  const source = kernelCall?.preview?.operatorLifecycleAction ?? null;
  if (source) {
    return {
      schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operator-lifecycle-action-ref`,
      state: source.state ?? 'unknown',
      ready: source.ready === true || !writeRequired,
      action: source.action ?? null,
      selectedCommandId: source.selectedCommandId ?? null,
      requestedState: source.requestedState ?? null,
      requiresAcknowledgement: source.requiresAcknowledgement === true,
      acknowledgementToken: source.acknowledgementToken ?? null,
      userVisibleStatus: source.userVisibleStatus ?? null,
      statusChannel: source.commands?.[0]?.statusChannel ?? statusChannel ?? null,
      idempotencyKey: source.commands?.[0]?.idempotencyKey ?? idempotencyKey ?? null,
      restartToken,
      commandIds: source.commands?.map((command) => command.id ?? command.commandId).filter(Boolean) ?? [],
      nextAction: source.nextAction ?? null,
      blockers: source.blockers ?? [],
      warnings: source.warnings ?? [],
      digest: source.digest ?? null
    };
  }
  const lifecycle = kernelCall?.lifecycle ?? {};
  const commandQueue = lifecycle.commandQueue ?? {};
  const selectedCommand = commandQueue.commands?.find((command) => command.id === commandQueue.selectedCommandId)
    ?? commandQueue.pending?.[0]
    ?? commandQueue.applied?.at?.(-1)
    ?? null;
  const action = selectedCommand?.action
    ?? (lifecycle.enabled === false ? 'disable' : lifecycle.schedule?.status === 'scheduled' ? 'schedule' : 'enable');
  const requiresAcknowledgement = selectedCommand?.requiresAcknowledgement === true
    || commandQueue.requiredAcknowledgements?.missing?.length > 0
    || ['disable', 'pause', 'hold', 'schedule', 'reschedule'].includes(action);
  const acknowledgementToken = selectedCommand?.acknowledgementToken
    ?? lifecycle.operatorDecision?.acknowledgement?.token
    ?? null;
  const blockers = uniqueSorted([
    ...(writeRequired && !kernelCall?.preview?.nextActionState?.digest ? ['missing_kernel_next_action_state'] : []),
    ...(requiresAcknowledgement && !acknowledgementToken ? ['operator_lifecycle_acknowledgement_missing'] : []),
    ...(commandQueue.state === 'blocked' ? (commandQueue.blockers ?? ['lifecycle_command_queue_blocked']) : [])
  ]);
  const warnings = uniqueSorted([
    ...(source ? [] : ['operator_lifecycle_action_synthesized_from_lifecycle']),
    ...(commandQueue.state === 'awaiting_acknowledgement' ? ['operator_lifecycle_awaiting_acknowledgement'] : []),
    ...(lifecycle.schedule?.status === 'scheduled' ? ['operator_lifecycle_scheduled'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : lifecycle.state === 'held'
      ? 'held'
      : lifecycle.schedule?.status === 'scheduled'
        ? 'scheduled'
        : warnings.length
          ? 'review'
          : 'ready';
  const digest = stableHash({
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    status,
    action,
    selectedCommandId: selectedCommand?.id ?? null,
    statusChannel,
    idempotencyKey,
    restartToken,
    blockers,
    warnings
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operator-lifecycle-action-ref`,
    state,
    ready: ['ready', 'review', 'held', 'scheduled'].includes(state) || !writeRequired,
    action,
    selectedCommandId: selectedCommand?.id ?? null,
    requestedState: selectedCommand?.requestedState ?? lifecycle.state ?? null,
    requiresAcknowledgement,
    acknowledgementToken,
    userVisibleStatus: statusHandoffUserStatus(state),
    statusChannel,
    idempotencyKey,
    restartToken,
    commandIds: selectedCommand?.id ? [selectedCommand.id] : [],
    nextAction: blockers.length
      ? statusHandoffAction(blockers[0])
      : requiresAcknowledgement && !acknowledgementToken
        ? 'collect_operator_lifecycle_acknowledgement'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'held'
            ? 'await_manual_release'
            : 'persist_operator_lifecycle_action',
    blockers,
    warnings,
    digest
  };
}

function buildExternalWriteStateRecoveryCapsule({
  programId,
  operation,
  status,
  writeEffects,
  route,
  providerCommand,
  persistedStatus,
  statusJournal,
  providerCommandLedger,
  persistenceEnvelope,
  resumeCursor,
  statusHandoff,
  clientWorkflowStatusCapsule,
  clientWorkflowAdoptionLease,
  acceptanceCheckpointBundle,
  operationalHealth,
  operationalIncident,
  recoveryRunbook,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const commandId = providerCommandLedger?.activeCommandId
    ?? providerCommand?.commandId
    ?? persistedStatus?.commandId
    ?? null;
  const commandDigest = providerCommandLedger?.activeCommandDigest
    ?? providerCommand?.replay?.commandDigest
    ?? persistedStatus?.commandDigest
    ?? null;
  const statusChannel = statusHandoff?.statusChannel
    ?? persistenceEnvelope?.statusChannel
    ?? persistedStatus?.statusChannel
    ?? route?.statusChannel
    ?? null;
  const idempotencyKey = providerCommandLedger?.idempotencyKey
    ?? persistenceEnvelope?.idempotencyKey
    ?? persistedStatus?.idempotencyKey
    ?? route?.idempotencyKey
    ?? kernelCall?.handoff?.idempotencyKey
    ?? null;
  const restartToken = statusHandoff?.restartToken
    ?? persistenceEnvelope?.restartToken
    ?? persistedStatus?.restartToken
    ?? kernelCall?.runtimeState?.profileRestartToken
    ?? kernelCall?.runtimeState?.restartToken
    ?? null;
  const resumePointer = resumeCursor?.resumePointer
    ?? persistenceEnvelope?.resumePointer
    ?? clientWorkflowStatusCapsule?.resumePointer
    ?? null;
  const checkpoints = [
    recoveryCapsuleCheckpoint('persisted_status', persistedStatus?.state, persistedStatus?.digest, persistedStatus?.ready === true || !writeRequired, persistedStatus?.blockers, []),
    recoveryCapsuleCheckpoint('status_journal', statusJournal?.state, statusJournal?.digest, statusJournal?.ready === true || !writeRequired, statusJournal?.blockers, []),
    recoveryCapsuleCheckpoint('provider_command_ledger', providerCommandLedger?.state, providerCommandLedger?.digest, providerCommandLedger?.ready === true || !writeRequired, providerCommandLedger?.blockers, providerCommandLedger?.warnings),
    recoveryCapsuleCheckpoint('persistence_envelope', persistenceEnvelope?.state, persistenceEnvelope?.digest, persistenceEnvelope?.ready === true || !writeRequired, persistenceEnvelope?.blockers, persistenceEnvelope?.warnings),
    recoveryCapsuleCheckpoint('resume_cursor', resumeCursor?.state, resumeCursor?.digest, resumeCursor?.ready === true || !writeRequired, resumeCursor?.blockers, resumeCursor?.warnings),
    recoveryCapsuleCheckpoint('status_handoff', statusHandoff?.state, statusHandoff?.digest, statusHandoff?.ready === true || !writeRequired, statusHandoff?.blockers, statusHandoff?.warnings),
    recoveryCapsuleCheckpoint('client_workflow_status', clientWorkflowStatusCapsule?.state, clientWorkflowStatusCapsule?.digest, clientWorkflowStatusCapsule?.ready === true || !writeRequired, clientWorkflowStatusCapsule?.blockers, clientWorkflowStatusCapsule?.warnings),
    recoveryCapsuleCheckpoint('client_workflow_adoption_lease', clientWorkflowAdoptionLease?.state, clientWorkflowAdoptionLease?.digest, clientWorkflowAdoptionLease?.ready === true || !writeRequired, clientWorkflowAdoptionLease?.blockers, clientWorkflowAdoptionLease?.warnings),
    recoveryCapsuleCheckpoint('acceptance_checkpoint', acceptanceCheckpointBundle?.state, acceptanceCheckpointBundle?.digest, acceptanceCheckpointBundle?.ready === true || !writeRequired, acceptanceCheckpointBundle?.blockers, acceptanceCheckpointBundle?.warnings),
    recoveryCapsuleCheckpoint('recovery_runbook', recoveryRunbook?.state, recoveryRunbook?.digest, recoveryRunbook?.ready === true || !writeRequired, recoveryRunbook?.blockers, recoveryRunbook?.warnings)
  ];
  const failed = checkpoints.filter((checkpoint) => checkpoint.outcome === 'failed');
  const review = checkpoints.filter((checkpoint) => checkpoint.outcome === 'review');
  const pending = checkpoints.find((checkpoint) => checkpoint.outcome === 'pending');
  const replayReady = providerCommandLedger?.replayable === true
    && providerCommandLedger?.duplicateSafe === true
    && Boolean(commandId)
    && Boolean(commandDigest);
  const restartSafe = !writeRequired || (
    persistenceEnvelope?.restartSemantics?.restartSafe === true
    && statusJournal?.restartSemantics?.restartSafe === true
    && clientWorkflowStatusCapsule?.restartSafe === true
    && clientWorkflowAdoptionLease?.restartSafe === true
    && acceptanceCheckpointBundle?.restartSafe === true
    && resumeCursor?.restartSemantics?.restartSafe === true
    && replayReady
  );
  const blockers = uniqueSorted([
    ...failed.flatMap((checkpoint) => checkpoint.blockers.length
      ? checkpoint.blockers.map((blocker) => `${checkpoint.name}_${blocker}`)
      : [`checkpoint_failed:${checkpoint.name}`]),
    ...(!commandId && writeRequired ? ['missing_state_recovery_command_id'] : []),
    ...(!commandDigest && writeRequired ? ['missing_state_recovery_command_digest'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_state_recovery_idempotency_key'] : []),
    ...(!statusChannel && writeRequired ? ['missing_state_recovery_status_channel'] : []),
    ...(!restartToken && writeRequired ? ['missing_state_recovery_restart_token'] : []),
    ...(!resumePointer && writeRequired ? ['missing_state_recovery_resume_pointer'] : []),
    ...(!clientWorkflowAdoptionLease?.digest && writeRequired ? ['missing_state_recovery_client_workflow_adoption_lease'] : []),
    ...(clientWorkflowAdoptionLease?.restartSafe === false ? ['state_recovery_client_workflow_adoption_lease_not_restart_safe'] : []),
    ...(clientWorkflowAdoptionLease?.aligned === false ? ['state_recovery_client_workflow_adoption_lease_not_aligned'] : []),
    ...(providerCommandLedger?.duplicateSafe === false && writeRequired ? ['state_recovery_command_not_duplicate_safe'] : []),
    ...(providerCommandLedger?.replayable === false && writeRequired ? ['state_recovery_command_not_replayable'] : []),
    ...(restartSafe === false ? ['state_recovery_not_restart_safe'] : [])
  ]);
  const warnings = uniqueSorted([
    ...review.flatMap((checkpoint) => checkpoint.warnings.length
      ? checkpoint.warnings.map((warning) => `${checkpoint.name}_${warning}`)
      : [`checkpoint_review:${checkpoint.name}`]),
    ...(operationalHealth?.degraded ? ['operational_health_degraded'] : []),
    ...(operationalIncident?.open ? ['operational_incident_open'] : []),
    ...(recoveryRunbook?.mode === 'operator_review' ? ['recovery_runbook_operator_review'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : statusHandoff?.state === 'held' || persistedStatus?.state === 'held'
        ? 'held'
        : statusHandoff?.state === 'scheduled' || persistedStatus?.state === 'scheduled'
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : checkpoints.every((checkpoint) => checkpoint.outcome === 'ready')
              ? 'ready'
              : 'waiting';
  const capsuleKey = idempotencyKey ? `external-write-state-recovery:${idempotencyKey}` : null;
  const digestShape = {
    programId,
    operation,
    status,
    state,
    capsuleKey,
    commandId,
    commandDigest,
    statusChannel,
    restartToken,
    resumePointer,
    clientWorkflowAdoptionLeaseDigest: clientWorkflowAdoptionLease?.digest ?? null,
    clientWorkflowAdoptionLeaseKey: clientWorkflowAdoptionLease?.leaseKey ?? null,
    clientWorkflowAdoptionLeaseRestartSafe: clientWorkflowAdoptionLease?.restartSafe === true || !writeRequired,
    restartSafe,
    checkpoints: checkpoints.map((checkpoint) => `${checkpoint.name}:${checkpoint.outcome}:${checkpoint.digest ?? ''}`),
    blockers,
    warnings
  };
  const digest = stableHash(digestShape);
  const commands = writeRequired && ['ready', 'review', 'held', 'scheduled'].includes(state) ? [
    {
      type: 'persist-external-write-state-recovery-capsule',
      commandId: `state-recovery:${digest}`,
      idempotencyKey: stableHash({ action: 'persist-external-write-state-recovery-capsule', capsuleKey, digest }),
      conflict: 'return-existing',
      statusAfterReplay: state === 'ready'
        ? 'state_recovery_ready'
        : state === 'review'
          ? 'state_recovery_ready_with_warnings'
          : state === 'held'
            ? 'state_recovery_manual_hold'
            : 'state_recovery_scheduled',
      writes: ['stateRecoveryCapsule', 'resumePointer', 'restartSemantics']
    }
  ] : [];
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.state-recovery-capsule`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    capsuleKey,
    commandId,
    commandDigest,
    idempotencyKey,
    statusChannel,
    restartToken,
    resumePointer,
    clientWorkflowAdoptionLease: {
      state: clientWorkflowAdoptionLease?.state ?? 'unknown',
      ready: clientWorkflowAdoptionLease?.ready === true || !writeRequired,
      digest: clientWorkflowAdoptionLease?.digest ?? null,
      leaseKey: clientWorkflowAdoptionLease?.leaseKey ?? null,
      restartSafe: clientWorkflowAdoptionLease?.restartSafe === true || !writeRequired,
      aligned: clientWorkflowAdoptionLease?.aligned === true || !writeRequired,
      resumePointer: clientWorkflowAdoptionLease?.resumePointer ?? null,
      commandId: clientWorkflowAdoptionLease?.command?.commandId ?? null
    },
    restartSafe,
    replay: {
      mode: providerCommandLedger?.replayMode ?? providerCommand?.replay?.mode ?? null,
      safeToReplay: replayReady || !writeRequired,
      duplicateSafe: providerCommandLedger?.duplicateSafe === true || !writeRequired,
      ledgerDigest: providerCommandLedger?.digest ?? null
    },
    restartSemantics: {
      restartSafe,
      onRestart: state === 'ready'
        ? 'load_state_recovery_capsule_and_resume_status_handoff'
        : state === 'held'
          ? 'restore_manual_hold_from_state_recovery_capsule'
          : state === 'scheduled'
            ? 'restore_schedule_from_state_recovery_capsule'
            : state === 'blocked'
              ? 'repair_state_recovery_capsule_before_replay'
              : writeRequired
                ? 'wait_for_state_recovery_capsule'
                : 'continue_read_only',
      onDuplicateCommand: 'return_existing_state_recovery_capsule',
      onStaleSnapshot: 'rebuild_from_persistence_envelope_and_status_journal'
    },
    checkpoints,
    commands,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? stateRecoveryCapsuleAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? 'review_state_recovery_capsule'
            : state === 'ready'
              ? 'persist_external_write_state_recovery_capsule'
              : pending?.nextAction ?? 'wait_for_state_recovery_capsule',
    digest
  };
}

function validateExternalWriteStateRecoveryCapsule(capsule, writeEffects) {
  if (!writeEffects.length && !capsule) return [];
  const diagnostics = [];
  if (!capsule) return [{ level: 'error', code: 'external_write_missing_state_recovery_capsule' }];
  if (writeEffects.length && capsule.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_state_recovery_capsule_not_write_required' });
  }
  if (capsule.ready && capsule.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_state_recovery_capsule_ready_with_blockers', blockers: capsule.blockers });
  }
  if (capsule.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_state_recovery_capsule_blocked', blockers: capsule.blockers ?? [] });
  }
  if (writeEffects.length && !capsule.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_state_recovery_capsule_missing_digest' });
  }
  if (writeEffects.length && !capsule.resumePointer) {
    diagnostics.push({ level: 'error', code: 'external_write_state_recovery_capsule_missing_resume_pointer' });
  }
  if (writeEffects.length && !capsule.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_state_recovery_capsule_missing_status_channel' });
  }
  if (capsule.ready && writeEffects.length && capsule.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_state_recovery_capsule_not_restart_safe' });
  }
  if (capsule.ready && writeEffects.length && capsule.replay?.safeToReplay !== true) {
    diagnostics.push({ level: 'warning', code: 'external_write_state_recovery_capsule_not_replay_safe' });
  }
  if (capsule.ready && writeEffects.length && !capsule.commands?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_state_recovery_capsule_missing_command' });
  }
  if ((capsule.state === 'review' || capsule.warnings?.length) && capsule.state !== 'blocked') {
    diagnostics.push({ level: 'warning', code: 'external_write_state_recovery_capsule_review', warnings: capsule.warnings ?? [] });
  }
  return diagnostics;
}

function recoveryCapsuleCheckpoint(name, state, digest, ready, blockers = [], warnings = []) {
  const checkpoint = workflowStatusCheckpoint(name, state, digest, ready, blockers, warnings);
  return {
    ...checkpoint,
    recoveryAction: checkpoint.outcome === 'failed'
      ? stateRecoveryCapsuleAction(checkpoint.blockers[0] ?? name)
      : checkpoint.outcome === 'review'
        ? 'review_state_recovery_checkpoint'
        : checkpoint.outcome === 'pending'
          ? `wait_for_${name}`
          : null
  };
}

function stateRecoveryCapsuleAction(blocker) {
  if (String(blocker).includes('command')) return 'repair_provider_command_ledger';
  if (String(blocker).includes('idempotency')) return 'restore_external_write_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_external_write_status_channel';
  if (String(blocker).includes('restart')) return 'persist_restart_safe_recovery_state';
  if (String(blocker).includes('resume_pointer')) return 'rebuild_persistence_envelope_resume_pointer';
  if (String(blocker).includes('workflow')) return 'repair_client_workflow_status_capsule';
  if (String(blocker).includes('acceptance')) return 'repair_acceptance_checkpoint_bundle';
  if (String(blocker).includes('runbook')) return 'repair_external_write_recovery_runbook';
  return 'repair_external_write_state_recovery_capsule';
}

function workflowStatusCheckpoint(name, state, digest, ready, blockers = [], warnings = []) {
  const normalizedBlockers = uniqueSorted(asArray(blockers).map((entry) => typeof entry === 'string' ? entry : entry?.code).filter(Boolean));
  const normalizedWarnings = uniqueSorted(asArray(warnings).map((entry) => typeof entry === 'string' ? entry : entry?.code).filter(Boolean));
  return {
    name,
    state: state ?? 'unknown',
    digest: digest ?? null,
    ready: ready === true,
    outcome: normalizedBlockers.length || ['blocked', 'failed'].includes(state)
      ? 'failed'
      : normalizedWarnings.length || ['review', 'degraded'].includes(state)
        ? 'review'
        : ready === true
          ? 'ready'
          : 'pending',
    blockers: normalizedBlockers,
    warnings: normalizedWarnings
  };
}

function adoptionReceiptCheckpoint(name, status, ready, digest, blockers = [], warnings = [], nextAction = null) {
  const normalizedBlockers = uniqueSorted(asArray(blockers).map((entry) => typeof entry === 'string' ? entry : entry?.code).filter(Boolean));
  const normalizedWarnings = uniqueSorted(asArray(warnings).map((entry) => typeof entry === 'string' ? entry : entry?.code).filter(Boolean));
  const normalizedStatus = status ?? 'unknown';
  const outcome = normalizedBlockers.length || ['blocked', 'failed'].includes(normalizedStatus)
    ? 'failed'
    : normalizedWarnings.length || ['review', 'degraded'].includes(normalizedStatus)
      ? 'review'
      : ready === false
        ? 'pending'
        : 'ready';
  return {
    name,
    status: normalizedStatus,
    ready: ready === true,
    outcome,
    digest: digest ?? null,
    blockers: normalizedBlockers,
    warnings: normalizedWarnings,
    nextAction
  };
}

function validateClientRuntimeAdoptionReceipt(receipt, writeEffects) {
  if (!writeEffects.length && !receipt) return [];
  const diagnostics = [];
  if (!receipt) return [{ level: 'error', code: 'external_write_missing_client_runtime_adoption_receipt' }];
  if (writeEffects.length && receipt.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_receipt_not_write_required' });
  }
  if (receipt.ready && receipt.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_receipt_ready_with_blockers', blockers: receipt.blockers });
  }
  if (receipt.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_receipt_blocked', blockers: receipt.blockers ?? [] });
  }
  if (writeEffects.length && !receipt.receiptKey) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_receipt_missing_key' });
  }
  if (writeEffects.length && !receipt.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_receipt_missing_digest' });
  }
  if (receipt.ready && writeEffects.length && !receipt.command?.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_receipt_missing_command' });
  }
  if (receipt.ready && writeEffects.length && receipt.restartSemantics?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_client_runtime_adoption_receipt_not_restart_safe' });
  }
  if (receipt.ready && writeEffects.length && !receipt.statusAdoptionCheckpoint?.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_client_status_adoption_checkpoint_missing_digest' });
  }
  if (receipt.ready && writeEffects.length && receipt.statusAdoptionCheckpoint?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_client_status_adoption_checkpoint_not_restart_safe' });
  }
  if (receipt.statusAdoptionCheckpoint?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_client_status_adoption_checkpoint_blocked',
      blockers: receipt.statusAdoptionCheckpoint.blockers ?? []
    });
  }
  if (receipt.state === 'review' || receipt.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_client_runtime_adoption_receipt_review', warnings: receipt.warnings ?? [] });
  }
  return diagnostics;
}

function adoptionReceiptStatus(state) {
  return {
    blocked: 'client_runtime_adoption_receipt_needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    review: 'client_runtime_adoption_receipt_ready_with_warnings',
    waiting: 'preparing_client_runtime_adoption_receipt',
    issued: 'client_runtime_adoption_receipt_ready',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function adoptionReceiptAction(blocker) {
  if (String(blocker).includes('request')) return 'persist_client_request_snapshot';
  if (String(blocker).includes('provider_command')) return 'rebuild_provider_command';
  if (String(blocker).includes('status_channel')) return 'bind_client_runtime_status_channel';
  if (String(blocker).includes('idempotency')) return 'provide_client_runtime_idempotency_key';
  if (String(blocker).includes('boundary')) return 'repair_boundary_handoff';
  return 'repair_client_runtime_adoption_receipt';
}

function clientRuntimeAdoptionStatus(state) {
  return {
    blocked: 'client_runtime_adoption_needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    awaiting_acknowledgement: 'waiting_for_client_runtime_acknowledgement',
    waiting: 'preparing_client_runtime_adoption',
    adoptable: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function clientRuntimeAdoptionAction({ state, blockers, requiredAcknowledgements, clientRuntimeHandoff, clientRequestSnapshot, syncMetadata }) {
  if (state === 'blocked') return clientRequestAction(blockers[0]);
  if (state === 'held') return 'await_manual_release';
  if (state === 'scheduled') return 'wait_for_schedule_window';
  if (requiredAcknowledgements.length) return 'collect_client_runtime_adoption_acknowledgement';
  if (state === 'adoptable') return 'publish_client_runtime_adoptable';
  return syncMetadata?.nextAction
    ?? clientRequestSnapshot?.nextAction
    ?? clientRuntimeHandoff?.nextAction
    ?? 'wait_for_client_runtime_adoption';
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

function buildExternalWriteAcceptancePreview({
  programId,
  operation,
  status,
  writeEffects,
  route,
  acceptancePacket,
  acceptanceCheckpointBundle,
  operatorReadiness,
  operatorHandoffManifest,
  operatorDecision,
  statusHandoff,
  routeExportState,
  clientRuntimeAdoption,
  clientRuntimeAdoptionReceipt,
  boundaryDecisionReceipt,
  boundaryReleaseGate,
  providerHealth,
  providerServiceContract,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const acknowledged = !(acceptancePacket?.missingAcknowledgements?.length);
  const releaseAllowed = boundaryDecisionReceipt?.release?.allowed !== false
    && boundaryReleaseGate?.releaseAllowed !== false;
  const routeExportReady = routeExportState?.ready === true || !writeRequired;
  const checkpointReady = acceptanceCheckpointBundle?.ready === true || !writeRequired;
  const checkpointRestartSafe = acceptanceCheckpointBundle?.restartSafe === true || !writeRequired;
  const operatorReady = operatorDecision?.ready === true
    || operatorHandoffManifest?.ready === true
    || !writeRequired;
  const clientReady = clientRuntimeAdoptionReceipt?.ready === true
    || clientRuntimeAdoption?.ready === true
    || !writeRequired;
  const providerReady = providerServiceContract?.ready !== false
    && providerHealth?.ready !== false;
  const blockers = uniqueSorted([
    ...(acceptancePacket?.blockers ?? []).map((blocker) => `acceptance_${blocker}`),
    ...(acceptanceCheckpointBundle?.blockers ?? []).map((blocker) => `checkpoint_${blocker}`),
    ...(operatorDecision?.blockers ?? []).map((blocker) => `operator_decision_${blocker}`),
    ...(operatorHandoffManifest?.blockers ?? []).map((blocker) => `operator_handoff_${blocker}`),
    ...(statusHandoff?.blockers ?? []).map((blocker) => `status_${blocker}`),
    ...(routeExportState?.blockers ?? []).map((blocker) => `route_export_${blocker}`),
    ...(clientRuntimeAdoption?.blockers ?? []).map((blocker) => `client_adoption_${blocker}`),
    ...(clientRuntimeAdoptionReceipt?.blockers ?? []).map((blocker) => `client_receipt_${blocker}`),
    ...(boundaryDecisionReceipt?.blockers ?? []).map((blocker) => `boundary_decision_${blocker}`),
    ...(boundaryReleaseGate?.blockers ?? []).map((blocker) => `boundary_release_${blocker}`),
    ...(providerServiceContract?.blockers ?? []).map((blocker) => `provider_service_${blocker}`),
    ...(providerHealth?.blockers ?? []).map((blocker) => `provider_health_${blocker}`),
    ...(writeRequired && !acceptancePacket?.commandId ? ['missing_acceptance_command_id'] : []),
    ...(writeRequired && !acceptancePacket?.statusChannel ? ['missing_acceptance_status_channel'] : []),
    ...(writeRequired && !acceptanceCheckpointBundle?.digest ? ['missing_acceptance_checkpoint_digest'] : []),
    ...(writeRequired && checkpointRestartSafe !== true ? ['acceptance_checkpoint_not_restart_safe'] : []),
    ...(writeRequired && operatorReady !== true ? ['operator_handoff_not_ready'] : []),
    ...(writeRequired && clientReady !== true ? ['client_runtime_adoption_not_ready'] : []),
    ...(writeRequired && releaseAllowed !== true ? ['boundary_release_not_allowed'] : []),
    ...(writeRequired && providerReady !== true ? ['provider_service_not_ready'] : []),
    ...(writeRequired && routeExportReady !== true ? ['route_export_not_ready'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(acceptancePacket?.warnings ?? []).map((warning) => `acceptance_${warning}`),
    ...(acceptanceCheckpointBundle?.warnings ?? []).map((warning) => `checkpoint_${warning}`),
    ...(operatorDecision?.warnings ?? []).map((warning) => `operator_decision_${warning}`),
    ...(operatorHandoffManifest?.warnings ?? []).map((warning) => `operator_handoff_${warning}`),
    ...(statusHandoff?.warnings ?? []).map((warning) => `status_${warning}`),
    ...(routeExportState?.warnings ?? []).map((warning) => `route_export_${warning}`),
    ...(clientRuntimeAdoptionReceipt?.warnings ?? []).map((warning) => `client_receipt_${warning}`),
    ...(boundaryDecisionReceipt?.warnings ?? []).map((warning) => `boundary_decision_${warning}`),
    ...(boundaryReleaseGate?.warnings ?? []).map((warning) => `boundary_release_${warning}`),
    ...(providerServiceContract?.warnings ?? []).map((warning) => `provider_service_${warning}`),
    ...(providerHealth?.warnings ?? []).map((warning) => `provider_health_${warning}`),
    ...(status === 'review' ? ['external_write_review_required'] : []),
    ...(routeExportState?.changedSinceAcceptedSnapshot ? ['route_export_changed_since_acceptance'] : []),
    ...(clientRuntimeAdoptionReceipt?.restartSemantics?.restartSafe === false ? ['client_receipt_not_restart_safe'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : acceptancePacket?.acceptanceState === 'pending_acknowledgement' || !acknowledged
        ? 'pending_acknowledgement'
        : warnings.length
          ? 'review'
          : 'ready';
  const nextSteps = buildExternalWriteAcceptancePreviewSteps({
    writeRequired,
    state,
    blockers,
    warnings,
    acceptancePacket,
    acceptanceCheckpointBundle,
    operatorHandoffManifest,
    operatorDecision,
    statusHandoff,
    routeExportState,
    clientRuntimeAdoptionReceipt
  });
  const primaryAction = acceptancePreviewPrimaryAction({
    state,
    blockers,
    acceptancePacket,
    operatorDecision,
    operatorHandoffManifest,
    routeExportState,
    statusHandoff,
    nextSteps
  });
  const commandId = operatorDecision?.command?.commandId
    ?? operatorHandoffManifest?.command?.commandId
    ?? acceptanceCheckpointBundle?.commandId
    ?? acceptancePacket?.commandId
    ?? null;
  const digestShape = {
    programId,
    operation,
    state,
    commandId,
    idempotencyKey: route?.idempotencyKey ?? acceptancePacket?.idempotencyKey ?? null,
    statusChannel: route?.statusChannel ?? acceptancePacket?.statusChannel ?? null,
    acceptanceDigest: acceptancePacket?.digest ?? null,
    checkpointDigest: acceptanceCheckpointBundle?.digest ?? null,
    operatorDecisionDigest: operatorDecision?.digest ?? null,
    operatorHandoffDigest: operatorHandoffManifest?.digest ?? null,
    statusHandoffDigest: statusHandoff?.digest ?? null,
    routeExportDigest: routeExportState?.digest ?? null,
    clientReceiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
    boundaryDecisionDigest: boundaryDecisionReceipt?.receiptDigest ?? null,
    boundaryReleaseDigest: boundaryReleaseGate?.gateDigest ?? null,
    blockers,
    warnings
  };
  const digest = stableHash(digestShape);
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.acceptance-preview`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    renderable: Boolean(programId && operation && (route?.statusChannel || !writeRequired)),
    writeRequired,
    presentationMode: state === 'blocked'
      ? 'repair'
      : state === 'pending_acknowledgement'
        ? 'acknowledgement'
        : state === 'review'
          ? 'review'
          : 'status',
    primaryAction,
    command: {
      type: writeRequired ? 'mailchimp.external_write.acceptance_preview' : 'mailchimp.external_write.read_only_preview',
      commandId,
      idempotencyKey: route?.idempotencyKey ?? acceptancePacket?.idempotencyKey ?? null,
      statusChannel: route?.statusChannel ?? acceptancePacket?.statusChannel ?? null,
      conflict: 'return-existing',
      statusAfterReplay: state
    },
    route: {
      statusChannel: route?.statusChannel ?? acceptancePacket?.statusChannel ?? null,
      auditChannel: route?.auditChannel ?? null,
      tenantId: route?.tenantId ?? null,
      workspaceId: route?.workspaceId ?? null,
      isolationKey: route?.isolationKey ?? null
    },
    userVisibleStatus: {
      current: acceptancePreviewUserStatus(state),
      completion: statusHandoff?.userVisibleStatus?.completion ?? 'mailchimp_write_synced',
      failure: statusHandoff?.userVisibleStatus?.failure ?? 'mailchimp_write_needs_review'
    },
    validationSummary: {
      ok: blockers.length === 0,
      state,
      errorCount: blockers.length,
      warningCount: warnings.length,
      missingAcknowledgementCount: acceptancePacket?.missingAcknowledgements?.length ?? 0,
      restartSafe: checkpointRestartSafe
        && clientRuntimeAdoptionReceipt?.restartSemantics?.restartSafe !== false
        && operatorDecision?.restartSemantics?.restartSafe !== false,
      releaseAllowed,
      routeExportReady,
      clientReady,
      providerReady,
      errors: blockers,
      warnings
    },
    acceptance: {
      readinessState: acceptancePacket?.readinessState ?? 'unknown',
      acceptanceState: acceptancePacket?.acceptanceState ?? 'unknown',
      acceptEnabled: acceptancePacket?.acceptEnabled === true,
      requiredAcknowledgements: acceptancePacket?.requiredAcknowledgements ?? [],
      acceptedAcknowledgements: acceptancePacket?.acceptedAcknowledgements ?? [],
      missingAcknowledgements: acceptancePacket?.missingAcknowledgements ?? [],
      nextAction: acceptancePacket?.nextAction ?? null
    },
    checkpoint: {
      state: acceptanceCheckpointBundle?.state ?? 'unknown',
      ready: checkpointReady,
      aligned: acceptanceCheckpointBundle?.aligned === true || !writeRequired,
      restartSafe: checkpointRestartSafe,
      digest: acceptanceCheckpointBundle?.digest ?? null,
      commandId: acceptanceCheckpointBundle?.commandId ?? null,
      checkpointCount: acceptanceCheckpointBundle?.checkpoints?.length ?? 0,
      nextAction: acceptanceCheckpointBundle?.nextAction ?? null
    },
    handoff: {
      operatorManifestDigest: operatorHandoffManifest?.digest ?? null,
      operatorDecisionDigest: operatorDecision?.digest ?? null,
      statusHandoffDigest: statusHandoff?.digest ?? null,
      routeExportDigest: routeExportState?.digest ?? null,
      clientReceiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
      boundaryDecisionDigest: boundaryDecisionReceipt?.receiptDigest ?? null,
      boundaryReleaseDigest: boundaryReleaseGate?.gateDigest ?? null,
      restartToken: statusHandoff?.restartToken
        ?? clientRuntimeAdoptionReceipt?.restartToken
        ?? kernelCall?.runtimeState?.profileRestartToken
        ?? null
    },
    nextSteps,
    blockers,
    warnings,
    digest
  };
}

function buildExternalWriteAcceptancePreviewSteps({
  writeRequired,
  state,
  blockers,
  warnings,
  acceptancePacket,
  acceptanceCheckpointBundle,
  operatorHandoffManifest,
  operatorDecision,
  statusHandoff,
  routeExportState,
  clientRuntimeAdoptionReceipt
}) {
  if (!writeRequired) {
    return [{ index: 0, phase: 'read_only', action: 'continue_read_only', reason: 'external_write_not_requested', terminal: true }];
  }
  if (blockers.length) {
    return blockers.map((reason, index) => ({
      index,
      phase: acceptancePreviewPhase(reason),
      action: acceptancePreviewAction(reason),
      reason,
      terminal: false
    }));
  }
  const acknowledgementSteps = (acceptancePacket?.missingAcknowledgements ?? []).map((reason, index) => ({
    index,
    phase: 'operator_acknowledgement',
    action: 'collect_operator_acknowledgement',
    reason,
    terminal: false
  }));
  if (acknowledgementSteps.length) return acknowledgementSteps;
  if (warnings.length) {
    return warnings.map((reason, index) => ({
      index,
      phase: acceptancePreviewPhase(reason),
      action: acceptancePreviewWarningAction(reason),
      reason,
      terminal: false
    }));
  }
  return [{
    index: 0,
    phase: 'acceptance_preview',
    action: state === 'ready'
      ? 'render_external_write_acceptance_preview'
      : acceptancePacket?.nextAction
        ?? acceptanceCheckpointBundle?.nextAction
        ?? operatorDecision?.nextAction
        ?? operatorHandoffManifest?.primaryAction
        ?? statusHandoff?.nextAction
        ?? routeExportState?.nextAction
        ?? clientRuntimeAdoptionReceipt?.nextAction
        ?? 'prepare_external_write_acceptance_preview',
    reason: state === 'ready' ? 'external_write_preview_ready' : 'external_write_preview_waiting',
    terminal: state === 'ready'
  }];
}

function validateExternalWriteAcceptancePreview(preview, writeEffects) {
  if (!writeEffects.length && !preview) return [];
  const diagnostics = [];
  if (!preview) return [{ level: 'error', code: 'external_write_missing_acceptance_preview' }];
  if (writeEffects.length && preview.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_preview_not_write_required' });
  }
  if (preview.ready && preview.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_preview_ready_with_blockers', blockers: preview.blockers });
  }
  if (preview.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_preview_blocked', blockers: preview.blockers ?? [] });
  }
  if (writeEffects.length && !preview.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_preview_missing_digest' });
  }
  if (writeEffects.length && !preview.command?.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_preview_missing_command_id' });
  }
  if (writeEffects.length && !preview.command?.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_preview_missing_status_channel' });
  }
  if (writeEffects.length && !preview.checkpoint?.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_preview_missing_checkpoint_digest' });
  }
  if (writeEffects.length && preview.validationSummary?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_preview_not_restart_safe' });
  }
  if (preview.renderable !== true && writeEffects.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_acceptance_preview_not_renderable' });
  }
  if (preview.state === 'review' || preview.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_acceptance_preview_review', warnings: preview.warnings ?? [] });
  }
  return diagnostics;
}

function acceptancePreviewPrimaryAction({
  state,
  blockers,
  acceptancePacket,
  operatorDecision,
  operatorHandoffManifest,
  routeExportState,
  statusHandoff,
  nextSteps
}) {
  if (blockers.length) return acceptancePreviewAction(blockers[0]);
  if (state === 'pending_acknowledgement') return 'collect_operator_acknowledgement';
  if (state === 'review') return nextSteps[0]?.action ?? 'review_external_write_acceptance_preview';
  if (state === 'ready') return 'render_external_write_acceptance_preview';
  if (state === 'not_required') return 'continue_read_only';
  return acceptancePacket?.nextAction
    ?? operatorDecision?.nextAction
    ?? operatorHandoffManifest?.primaryAction
    ?? routeExportState?.nextAction
    ?? statusHandoff?.nextAction
    ?? 'prepare_external_write_acceptance_preview';
}

function acceptancePreviewPhase(reason) {
  if (reason.startsWith('checkpoint_') || reason.includes('checkpoint')) return 'acceptance_checkpoint';
  if (reason.startsWith('operator_decision_')) return 'operator_decision';
  if (reason.startsWith('operator_handoff_')) return 'operator_handoff';
  if (reason.startsWith('status_')) return 'status_handoff';
  if (reason.startsWith('route_export_')) return 'route_export';
  if (reason.startsWith('client_')) return 'client_runtime';
  if (reason.startsWith('boundary_')) return 'boundary_release';
  if (reason.startsWith('provider_')) return 'provider_service';
  if (reason.startsWith('acceptance_')) return 'acceptance';
  return 'acceptance_preview';
}

function acceptancePreviewAction(reason) {
  if (reason.includes('acknowledgement')) return 'collect_operator_acknowledgement';
  if (reason.includes('checkpoint')) return 'publish_acceptance_checkpoint_bundle';
  if (reason.includes('operator_decision')) return 'publish_external_write_operator_decision';
  if (reason.includes('operator_handoff')) return 'publish_operator_handoff_manifest';
  if (reason.includes('status')) return 'publish_external_write_status_handoff';
  if (reason.includes('route_export')) return 'publish_route_export_state';
  if (reason.includes('client')) return 'persist_client_runtime_adoption_receipt';
  if (reason.includes('boundary')) return 'resolve_boundary_release_decision';
  if (reason.includes('provider')) return 'repair_mailchimp_provider_service';
  if (reason.includes('command_id')) return 'rebuild_provider_command';
  return 'repair_external_write_acceptance_preview';
}

function acceptancePreviewWarningAction(reason) {
  if (reason.includes('route_export_changed')) return 'refresh_route_export_snapshot';
  if (reason.includes('review')) return 'review_external_write_acceptance_preview';
  if (reason.includes('restart_safe')) return 'refresh_restart_safe_acceptance_snapshot';
  return 'review_external_write_acceptance_preview';
}

function acceptancePreviewUserStatus(state) {
  return {
    blocked: 'external_write_preview_needs_attention',
    pending_acknowledgement: 'external_write_waiting_for_acknowledgement',
    review: 'external_write_ready_with_warnings',
    ready: 'external_write_preview_ready',
    not_required: 'read_only_ready'
  }[state] ?? 'external_write_preview_pending';
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

function buildExternalWritePersistenceEnvelope({
  programId,
  operation,
  status,
  writeEffects,
  route,
  lifecycleGate,
  providerCommand,
  persistedStatus,
  statusJournal,
  providerCommandLedger,
  clientRequestSnapshot,
  clientRuntimeAdoptionReceipt,
  boundaryTicket,
  boundaryAuditHandoff,
  providerHealth,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const restartToken = persistedStatus?.restartToken
    ?? statusJournal?.restartToken
    ?? kernelCall?.runtimeState?.profileRestartToken
    ?? kernelCall?.runtimeState?.restartToken
    ?? null;
  const commandId = providerCommandLedger?.activeCommandId
    ?? persistedStatus?.commandId
    ?? providerCommand?.commandId
    ?? null;
  const commandDigest = providerCommandLedger?.activeCommandDigest
    ?? persistedStatus?.commandDigest
    ?? providerCommand?.replay?.commandDigest
    ?? null;
  const idempotencyKey = providerCommandLedger?.idempotencyKey
    ?? persistedStatus?.idempotencyKey
    ?? route?.idempotencyKey
    ?? null;
  const statusChannel = persistedStatus?.statusChannel
    ?? statusJournal?.statusChannel
    ?? route?.statusChannel
    ?? null;
  const resumePointer = restartToken && statusChannel
    ? `resume:${stableHash({ programId, operation, restartToken, statusChannel })}`
    : null;
  const recoveryHints = uniqueSorted([
    ...(providerHealth?.retryable ? ['retry_provider_after_backoff'] : []),
    ...(providerHealth?.degraded ? ['resume_with_provider_degraded_ack'] : []),
    ...(statusJournal?.state === 'held' ? ['restore_manual_hold'] : []),
    ...(statusJournal?.state === 'scheduled' ? ['restore_schedule_window'] : []),
    ...(providerCommandLedger?.replayMode ? [`provider_replay:${providerCommandLedger.replayMode}`] : []),
    ...(boundaryTicket?.ready === false ? ['repair_boundary_ticket_before_replay'] : []),
    ...(boundaryAuditHandoff?.ready === false ? ['repair_boundary_audit_before_replay'] : [])
  ]);
  const blockers = uniqueSorted([
    ...(persistedStatus?.blockers ?? []).map((blocker) => `status_${blocker}`),
    ...(statusJournal?.blockers ?? []).map((blocker) => `journal_${blocker}`),
    ...(providerCommandLedger?.blockers ?? []).map((blocker) => `ledger_${blocker}`),
    ...(clientRequestSnapshot?.blockers ?? []).map((blocker) => `client_request_${blocker}`),
    ...(clientRuntimeAdoptionReceipt?.blockers ?? []).map((blocker) => `client_receipt_${blocker}`),
    ...(boundaryTicket?.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(boundaryAuditHandoff?.blockers ?? []).map((blocker) => `audit_${blocker}`),
    ...(!commandId && writeRequired ? ['missing_envelope_command_id'] : []),
    ...(!commandDigest && writeRequired ? ['missing_envelope_command_digest'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_envelope_idempotency_key'] : []),
    ...(!statusChannel && writeRequired ? ['missing_envelope_status_channel'] : []),
    ...(!restartToken && writeRequired ? ['missing_envelope_restart_token'] : []),
    ...(!persistedStatus?.digest && writeRequired ? ['missing_envelope_status_digest'] : []),
    ...(!statusJournal?.digest && writeRequired ? ['missing_envelope_journal_digest'] : []),
    ...(!providerCommandLedger?.digest && writeRequired ? ['missing_envelope_ledger_digest'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_envelope_client_request_digest'] : []),
    ...(!clientRuntimeAdoptionReceipt?.digest && writeRequired ? ['missing_envelope_client_receipt_digest'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(providerHealth?.warnings ?? []).map((warning) => `provider_health_${warning}`),
    ...(statusJournal?.restartSemantics?.restartSafe === false ? ['journal_not_restart_safe'] : []),
    ...(providerCommandLedger?.duplicateSafe === false ? ['ledger_duplicate_unsafe'] : []),
    ...(providerCommandLedger?.replayable === false && writeRequired ? ['ledger_not_replayable'] : []),
    ...(clientRuntimeAdoptionReceipt?.restartSemantics?.restartSafe === false ? ['client_receipt_not_restart_safe'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : persistedStatus?.state === 'held' || statusJournal?.state === 'held'
        ? 'held'
        : persistedStatus?.state === 'scheduled' || statusJournal?.state === 'scheduled'
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : 'ready';
  const envelopeKey = idempotencyKey ? `external-write-envelope:${idempotencyKey}` : null;
  const manifestDigest = stableHash({
    programId,
    operation,
    state,
    status,
    commandId,
    commandDigest,
    idempotencyKey,
    statusChannel,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    statusJournalDigest: statusJournal?.digest ?? null,
    commandLedgerDigest: providerCommandLedger?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    clientReceiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
    boundaryAuditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.persistence-envelope`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    envelopeKey,
    resumePointer,
    commandId,
    commandDigest,
    idempotencyKey,
    statusChannel,
    restartToken,
    manifestDigest,
    persistedStatusDigest: persistedStatus?.digest ?? null,
    statusJournalDigest: statusJournal?.digest ?? null,
    providerCommandLedgerDigest: providerCommandLedger?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null,
    clientReceiptDigest: clientRuntimeAdoptionReceipt?.digest ?? null,
    scope: {
      tenantId: route?.tenantId ?? persistedStatus?.scope?.tenantId ?? null,
      workspaceId: route?.workspaceId ?? persistedStatus?.scope?.workspaceId ?? null,
      isolationKey: route?.isolationKey ?? persistedStatus?.scope?.isolationKey ?? null
    },
    restartSemantics: {
      restartSafe: ['ready', 'held', 'scheduled', 'not_required'].includes(state)
        && (providerCommandLedger?.duplicateSafe === true || !writeRequired)
        && (clientRuntimeAdoptionReceipt?.restartSemantics?.restartSafe === true || !writeRequired),
      onRestart: state === 'ready'
        ? 'load_persistence_envelope_and_resume_status_handoff'
        : state === 'held'
          ? 'restore_manual_hold_from_persistence_envelope'
          : state === 'scheduled'
            ? 'restore_schedule_from_persistence_envelope'
            : state === 'blocked'
              ? 'repair_persistence_envelope_before_replay'
              : writeRequired
                ? 'wait_for_persistence_envelope'
                : 'continue_read_only',
      onDuplicateCommand: 'return_existing_persistence_envelope',
      onStaleSnapshot: 'rebuild_envelope_from_status_journal_and_command_ledger'
    },
    recoveryHints,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? persistenceEnvelopeAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? 'review_persistence_envelope_warnings'
            : writeRequired
              ? 'persist_external_write_envelope'
              : 'continue_read_only',
    digest: stableHash({
      envelopeKey,
      resumePointer,
      manifestDigest,
      restartToken,
      recoveryHints,
      blockers,
      warnings
    })
  };
}

function validateExternalWritePersistenceEnvelope(envelope, writeEffects) {
  if (!writeEffects.length && !envelope) return [];
  const diagnostics = [];
  if (!envelope) return [{ level: 'error', code: 'external_write_missing_persistence_envelope' }];
  if (writeEffects.length && envelope.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_persistence_envelope_not_write_required' });
  }
  if (envelope.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_persistence_envelope_blocked', blockers: envelope.blockers ?? [] });
  }
  if (envelope.ready && writeEffects.length && !envelope.resumePointer) {
    diagnostics.push({ level: 'error', code: 'external_write_persistence_envelope_missing_resume_pointer' });
  }
  if (envelope.ready && writeEffects.length && !envelope.manifestDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_persistence_envelope_missing_manifest_digest' });
  }
  if (envelope.ready && writeEffects.length && envelope.restartSemantics?.restartSafe !== true) {
    diagnostics.push({ level: 'warning', code: 'external_write_persistence_envelope_not_restart_safe' });
  }
  if (envelope.ready && writeEffects.length && !envelope.providerCommandLedgerDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_persistence_envelope_missing_ledger_digest' });
  }
  return diagnostics;
}

function buildExternalWriteStateIntegrityManifest({
  programId,
  operation,
  status,
  writeEffects,
  route,
  persistedStatus,
  statusJournal,
  providerCommandLedger,
  persistenceEnvelope,
  resumeCursor,
  statusHandoff,
  stateRecoveryCapsule,
  acceptanceCheckpointBundle,
  clientRuntimeAdoptionReceipt,
  boundaryTicket,
  boundaryAuditHandoff,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const digestVector = {
    persistedStatus: persistedStatus?.digest ?? null,
    statusJournal: statusJournal?.digest ?? null,
    providerCommandLedger: providerCommandLedger?.digest ?? null,
    persistenceEnvelope: persistenceEnvelope?.digest ?? null,
    persistenceManifest: persistenceEnvelope?.manifestDigest ?? null,
    resumeCursor: resumeCursor?.digest ?? null,
    statusHandoff: statusHandoff?.digest ?? null,
    stateRecoveryCapsule: stateRecoveryCapsule?.digest ?? null,
    acceptanceCheckpoint: acceptanceCheckpointBundle?.digest ?? null,
    clientReceipt: clientRuntimeAdoptionReceipt?.digest ?? null,
    boundaryAudit: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null
  };
  const checkpoints = [
    integrityCheckpoint('persisted_status', persistedStatus?.state, digestVector.persistedStatus),
    integrityCheckpoint('status_journal', statusJournal?.state, digestVector.statusJournal),
    integrityCheckpoint('provider_command_ledger', providerCommandLedger?.state, digestVector.providerCommandLedger),
    integrityCheckpoint('persistence_envelope', persistenceEnvelope?.state, digestVector.persistenceEnvelope),
    integrityCheckpoint('resume_cursor', resumeCursor?.state, digestVector.resumeCursor),
    integrityCheckpoint('status_handoff', statusHandoff?.state, digestVector.statusHandoff),
    integrityCheckpoint('state_recovery_capsule', stateRecoveryCapsule?.state, digestVector.stateRecoveryCapsule),
    integrityCheckpoint('acceptance_checkpoint', acceptanceCheckpointBundle?.state, digestVector.acceptanceCheckpoint)
  ];
  const commandId = providerCommandLedger?.activeCommandId
    ?? persistenceEnvelope?.commandId
    ?? statusHandoff?.commandId
    ?? stateRecoveryCapsule?.commandId
    ?? null;
  const idempotencyKey = persistenceEnvelope?.idempotencyKey
    ?? statusHandoff?.idempotencyKey
    ?? route?.idempotencyKey
    ?? null;
  const statusChannel = persistenceEnvelope?.statusChannel
    ?? statusHandoff?.statusChannel
    ?? route?.statusChannel
    ?? null;
  const restartToken = persistenceEnvelope?.restartToken
    ?? statusHandoff?.restartToken
    ?? stateRecoveryCapsule?.restartToken
    ?? kernelCall?.runtimeState?.profileRestartToken
    ?? kernelCall?.runtimeState?.restartToken
    ?? null;
  const mismatches = uniqueSorted([
    ...(providerCommandLedger?.activeCommandId && persistenceEnvelope?.commandId && providerCommandLedger.activeCommandId !== persistenceEnvelope.commandId
      ? ['ledger_envelope_command_mismatch']
      : []),
    ...(providerCommandLedger?.activeCommandId && statusHandoff?.commandId && providerCommandLedger.activeCommandId !== statusHandoff.commandId
      ? ['ledger_status_handoff_command_mismatch']
      : []),
    ...(persistenceEnvelope?.statusChannel && statusHandoff?.statusChannel && persistenceEnvelope.statusChannel !== statusHandoff.statusChannel
      ? ['envelope_status_handoff_channel_mismatch']
      : []),
    ...(persistenceEnvelope?.manifestDigest && resumeCursor?.digestVector?.persistenceEnvelope && persistenceEnvelope.digest !== resumeCursor.digestVector.persistenceEnvelope
      ? ['resume_cursor_envelope_digest_mismatch']
      : []),
    ...(stateRecoveryCapsule?.digestVector?.persistenceEnvelope && persistenceEnvelope?.digest && stateRecoveryCapsule.digestVector.persistenceEnvelope !== persistenceEnvelope.digest
      ? ['state_capsule_envelope_digest_mismatch']
      : []),
    ...(acceptanceCheckpointBundle?.digestVector?.statusHandoff && statusHandoff?.digest && acceptanceCheckpointBundle.digestVector.statusHandoff !== statusHandoff.digest
      ? ['acceptance_status_handoff_digest_mismatch']
      : [])
  ]);
  const blockers = uniqueSorted([
    ...(!commandId && writeRequired ? ['missing_integrity_command_id'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_integrity_idempotency_key'] : []),
    ...(!statusChannel && writeRequired ? ['missing_integrity_status_channel'] : []),
    ...(!restartToken && writeRequired ? ['missing_integrity_restart_token'] : []),
    ...(!digestVector.persistenceEnvelope && writeRequired ? ['missing_integrity_persistence_envelope_digest'] : []),
    ...(!digestVector.stateRecoveryCapsule && writeRequired ? ['missing_integrity_state_recovery_capsule_digest'] : []),
    ...(!digestVector.acceptanceCheckpoint && writeRequired ? ['missing_integrity_acceptance_checkpoint_digest'] : []),
    ...(persistenceEnvelope?.restartSemantics?.restartSafe === false ? ['persistence_envelope_not_restart_safe'] : []),
    ...(stateRecoveryCapsule?.restartSafe === false ? ['state_recovery_capsule_not_restart_safe'] : []),
    ...(acceptanceCheckpointBundle?.restartSafe === false ? ['acceptance_checkpoint_not_restart_safe'] : []),
    ...mismatches
  ]);
  const warnings = uniqueSorted([
    ...(checkpoints.filter((checkpoint) => checkpoint.state === 'review').map((checkpoint) => `${checkpoint.phase}_review`)),
    ...(checkpoints.filter((checkpoint) => checkpoint.state === 'scheduled').map((checkpoint) => `${checkpoint.phase}_scheduled`)),
    ...(checkpoints.filter((checkpoint) => checkpoint.state === 'held').map((checkpoint) => `${checkpoint.phase}_held`)),
    ...(providerCommandLedger?.duplicateSafe === false ? ['provider_command_ledger_duplicate_unsafe'] : []),
    ...(providerCommandLedger?.replayable === false && writeRequired ? ['provider_command_ledger_not_replayable'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const aligned = mismatches.length === 0
    && checkpoints.every((checkpoint) => checkpoint.digest || !writeRequired);
  const restartSafe = !writeRequired || (
    aligned
    && persistenceEnvelope?.restartSemantics?.restartSafe === true
    && stateRecoveryCapsule?.restartSafe === true
    && acceptanceCheckpointBundle?.restartSafe === true
    && providerCommandLedger?.duplicateSafe === true
  );
  const manifestKey = idempotencyKey
    ? `external-write-integrity:${idempotencyKey}`
    : null;
  const manifestDigest = stableHash({
    programId,
    operation,
    status,
    state,
    commandId,
    idempotencyKey,
    statusChannel,
    restartToken,
    digestVector,
    aligned,
    restartSafe
  });

  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.state-integrity`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    manifestKey,
    manifestDigest,
    digest: stableHash({ manifestDigest, blockers, warnings }),
    commandId,
    idempotencyKey,
    statusChannel,
    restartToken,
    aligned,
    restartSafe,
    digestVector,
    checkpoints,
    mismatches,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? stateIntegrityAction(blockers[0])
      : state === 'review'
        ? 'review_external_write_state_integrity'
        : writeRequired
          ? 'persist_external_write_state_integrity_manifest'
          : 'continue_read_only'
  };
}

function validateExternalWriteStateIntegrityManifest(manifest, writeEffects) {
  if (!writeEffects.length && !manifest) return [];
  const diagnostics = [];
  if (!manifest) return [{ level: 'error', code: 'external_write_missing_state_integrity_manifest' }];
  if (writeEffects.length && manifest.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_state_integrity_not_write_required' });
  }
  if (manifest.ready && manifest.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_state_integrity_ready_with_blockers', blockers: manifest.blockers });
  }
  if (manifest.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_state_integrity_blocked', blockers: manifest.blockers ?? [] });
  }
  if (writeEffects.length && !manifest.manifestDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_state_integrity_missing_manifest_digest' });
  }
  if (writeEffects.length && manifest.aligned !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_state_integrity_not_aligned', mismatches: manifest.mismatches ?? [] });
  }
  if (writeEffects.length && manifest.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_state_integrity_not_restart_safe' });
  }
  if (manifest.state === 'review' || manifest.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_state_integrity_review', warnings: manifest.warnings ?? [] });
  }
  return diagnostics;
}

function integrityCheckpoint(phase, state, digest) {
  return {
    phase,
    state: state ?? 'unknown',
    digest: digest ?? null,
    present: Boolean(digest)
  };
}

function stateIntegrityAction(blocker) {
  if (String(blocker).includes('command')) return 'repair_provider_command_integrity';
  if (String(blocker).includes('status_channel')) return 'repair_status_channel_integrity';
  if (String(blocker).includes('restart')) return 'persist_restart_token_for_integrity';
  if (String(blocker).includes('persistence_envelope')) return 'rebuild_persistence_envelope_for_integrity';
  if (String(blocker).includes('state_recovery_capsule')) return 'rebuild_state_recovery_capsule';
  if (String(blocker).includes('acceptance_checkpoint')) return 'rebuild_acceptance_checkpoint_bundle';
  if (String(blocker).includes('mismatch')) return 'reconcile_external_write_state_digests';
  return 'repair_external_write_state_integrity_manifest';
}

function persistenceEnvelopeAction(blocker) {
  if (String(blocker).includes('journal')) return 'repair_status_journal_before_envelope';
  if (String(blocker).includes('ledger')) return 'repair_provider_command_ledger_before_envelope';
  if (String(blocker).includes('client_request')) return 'persist_client_request_before_envelope';
  if (String(blocker).includes('client_receipt')) return 'persist_client_receipt_before_envelope';
  if (String(blocker).includes('boundary')) return 'repair_boundary_ticket_before_envelope';
  if (String(blocker).includes('audit')) return 'repair_boundary_audit_before_envelope';
  if (String(blocker).includes('restart')) return 'persist_restart_token_before_envelope';
  if (String(blocker).includes('status_channel')) return 'bind_status_channel_before_envelope';
  if (String(blocker).includes('idempotency')) return 'persist_idempotency_key_before_envelope';
  return 'repair_external_write_persistence_envelope';
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

function buildProviderCommandLedger({
  programId,
  operation,
  status,
  writeEffects,
  route,
  providerCommand,
  persistedStatus,
  statusJournal,
  clientRequestSnapshot,
  boundaryTicket,
  boundaryAuditHandoff,
  providerHealth,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const activeCommandId = providerCommand?.commandId ?? persistedStatus?.commandId ?? null;
  const activeCommandDigest = providerCommand?.replay?.commandDigest ?? persistedStatus?.commandDigest ?? null;
  const ledgerKey = route?.idempotencyKey ? `provider-command:${route.idempotencyKey}` : null;
  const statusEntry = statusJournal?.latestCheckpoint
    ? {
        source: 'status_journal',
        phase: statusJournal.latestCheckpoint.phase,
        commandId: statusJournal.commandId ?? activeCommandId,
        commandDigest: statusJournal.latestCheckpoint.digest ?? statusJournal.digest ?? null,
        state: statusJournal.state ?? 'unknown',
        replayPolicy: statusJournal.restartSemantics?.onDuplicateCommand ?? null
      }
    : null;
  const persistedEntry = persistedStatus
    ? {
        source: 'persisted_status',
        phase: 'persisted_status',
        commandId: persistedStatus.commandId ?? activeCommandId,
        commandDigest: persistedStatus.commandDigest ?? activeCommandDigest,
        state: persistedStatus.state ?? 'unknown',
        replayPolicy: persistedStatus.replay?.safeToReplay === true
          ? 'reuse_persisted_provider_command'
          : 'hold_until_provider_command_is_replay_safe'
      }
    : null;
  const providerEntry = providerCommand
    ? {
        source: 'provider_command',
        phase: 'provider_command',
        commandId: providerCommand.commandId ?? activeCommandId,
        commandDigest: providerCommand.replay?.commandDigest ?? activeCommandDigest,
        state: providerCommand.state ?? 'unknown',
        replayPolicy: providerCommand.replay?.safeToReplay === true
          ? 'return_existing_by_idempotency_key'
          : 'do_not_replay_without_operator_review'
      }
    : null;
  const entries = [providerEntry, persistedEntry, statusEntry]
    .filter(Boolean)
    .map((entry, index) => ({
      index,
      ...entry,
      idempotencyKey: route?.idempotencyKey ?? persistedStatus?.idempotencyKey ?? null,
      statusChannel: route?.statusChannel ?? persistedStatus?.statusChannel ?? null,
      auditDigest: boundaryTicket?.auditDigest ?? boundaryAuditHandoff?.auditDigest ?? null,
      clientRequestDigest: clientRequestSnapshot?.digest ?? persistedStatus?.clientRequestDigest ?? null,
      digest: stableHash({
        source: entry.source,
        phase: entry.phase,
        commandId: entry.commandId ?? null,
        commandDigest: entry.commandDigest ?? null,
        idempotencyKey: route?.idempotencyKey ?? null,
        statusChannel: route?.statusChannel ?? null,
        state: entry.state
      })
    }));
  const uniqueCommandIds = uniqueSorted(entries.map((entry) => entry.commandId).filter(Boolean));
  const uniqueDigests = uniqueSorted(entries.map((entry) => entry.commandDigest).filter(Boolean));
  const duplicateSafe = Boolean(route?.idempotencyKey)
    && uniqueCommandIds.length <= 1
    && uniqueDigests.length <= 1
    && statusJournal?.restartSemantics?.onDuplicateCommand !== 'enqueue_new_provider_write';
  const replayable = providerCommand?.replay?.safeToReplay === true
    && persistedStatus?.replay?.safeToReplay !== false
    && statusJournal?.restartSemantics?.restartSafe !== false
    && duplicateSafe;
  const blockers = uniqueSorted([
    ...(!ledgerKey && writeRequired ? ['missing_command_ledger_key'] : []),
    ...(!activeCommandId && writeRequired ? ['missing_command_ledger_command_id'] : []),
    ...(!activeCommandDigest && writeRequired ? ['missing_command_ledger_digest'] : []),
    ...(!route?.statusChannel && writeRequired ? ['missing_command_ledger_status_channel'] : []),
    ...(!clientRequestSnapshot?.digest && writeRequired ? ['missing_command_ledger_client_request_digest'] : []),
    ...(uniqueCommandIds.length > 1 ? ['command_ledger_conflicting_command_ids'] : []),
    ...(uniqueDigests.length > 1 ? ['command_ledger_conflicting_digests'] : []),
    ...(duplicateSafe === false && writeRequired ? ['command_ledger_duplicate_policy_unsafe'] : []),
    ...(providerHealth?.retryable === false && writeRequired ? ['command_ledger_provider_not_retryable'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(providerHealth?.degraded ? ['command_ledger_provider_degraded'] : []),
    ...(statusJournal?.state === 'waiting' && writeRequired ? ['command_ledger_status_journal_waiting'] : []),
    ...(persistedStatus?.resume?.safeToResume === false && writeRequired ? ['command_ledger_restart_token_missing'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : providerCommand?.state === 'held' || persistedStatus?.state === 'held'
        ? 'held'
        : providerCommand?.state === 'scheduled' || persistedStatus?.state === 'scheduled'
          ? 'scheduled'
          : replayable
            ? 'ready'
            : 'waiting';
  const digestShape = {
    programId,
    operation,
    state,
    status,
    ledgerKey,
    activeCommandId,
    activeCommandDigest,
    idempotencyKey: route?.idempotencyKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    entryDigests: entries.map((entry) => entry.digest),
    duplicateSafe,
    replayable,
    continuationGeneration: kernelCall?.runtimeState?.continuationState?.generation ?? 0
  };
  const digest = stableHash(digestShape);
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.provider-command-ledger`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    ledgerKey,
    activeCommandId,
    activeCommandState: providerCommand?.state ?? persistedStatus?.replay?.commandState ?? null,
    activeCommandDigest,
    idempotencyKey: route?.idempotencyKey ?? persistedStatus?.idempotencyKey ?? null,
    statusChannel: route?.statusChannel ?? persistedStatus?.statusChannel ?? null,
    auditChannel: route?.auditChannel ?? null,
    duplicateSafe,
    replayable,
    replayMode: replayable
      ? 'reuse_existing_provider_command'
      : duplicateSafe
        ? 'wait_for_replayable_command_snapshot'
        : 'block_new_provider_write',
    restartPolicy: state === 'ready'
      ? 'load_provider_command_ledger_before_replay'
      : state === 'held'
        ? 'resume_hold_from_provider_command_ledger'
        : state === 'scheduled'
          ? 'resume_schedule_from_provider_command_ledger'
          : state === 'blocked'
            ? 'repair_provider_command_ledger_before_replay'
            : writeRequired
              ? 'wait_for_provider_command_ledger'
              : 'continue_read_only',
    entries,
    commands: writeRequired ? [
      {
        type: 'upsert-provider-command-ledger',
        commandId: `provider-command-ledger:${digest}`,
        idempotencyKey: stableHash({ ledgerKey, activeCommandId, action: 'upsert-provider-command-ledger' }),
        conflict: 'return-existing',
        writes: ['activeCommandId', 'activeCommandDigest', 'replayMode', 'statusChannel']
      },
      ...(state === 'blocked' ? [{
        type: 'hold-provider-command-ledger',
        commandId: `provider-command-ledger-hold:${stableHash({ digest, blockers })}`,
        idempotencyKey: stableHash({ ledgerKey, activeCommandId, action: 'hold-provider-command-ledger', blockers }),
        conflict: 'return-existing',
        writes: ['blockers', 'nextAction']
      }] : [])
    ] : [],
    scope: {
      tenantId: route?.tenantId ?? persistedStatus?.scope?.tenantId ?? null,
      workspaceId: route?.workspaceId ?? persistedStatus?.scope?.workspaceId ?? null,
      isolationKey: route?.isolationKey ?? persistedStatus?.scope?.isolationKey ?? null
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? providerCommandLedgerAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'persist_provider_command_ledger'
            : writeRequired
              ? 'wait_for_replayable_provider_command'
              : 'continue_read_only',
    digest
  };
}

function validateProviderCommandLedger(ledger, writeEffects) {
  if (!writeEffects.length && !ledger) return [];
  const diagnostics = [];
  if (!ledger) return [{ level: 'error', code: 'external_write_missing_provider_command_ledger' }];
  if (writeEffects.length && ledger.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_command_ledger_not_write_required' });
  }
  if (ledger.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_provider_command_ledger_blocked', blockers: ledger.blockers ?? [] });
  }
  if (ledger.ready && writeEffects.length && !ledger.activeCommandId) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_command_ledger_missing_command_id' });
  }
  if (ledger.ready && writeEffects.length && !ledger.activeCommandDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_command_ledger_missing_command_digest' });
  }
  if (writeEffects.length && ledger.duplicateSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_command_ledger_duplicate_policy_unsafe' });
  }
  if (ledger.ready && writeEffects.length && ledger.replayable !== true) {
    diagnostics.push({ level: 'warning', code: 'external_write_provider_command_ledger_not_replayable' });
  }
  if (ledger.ready && writeEffects.length && !ledger.commands?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_command_ledger_missing_command' });
  }
  return diagnostics;
}

function providerCommandLedgerAction(blocker) {
  if (String(blocker).includes('client_request')) return 'persist_client_request_before_provider_command_ledger';
  if (String(blocker).includes('command_id')) return 'persist_provider_command_before_provider_command_ledger';
  if (String(blocker).includes('digest')) return 'persist_provider_command_digest';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('duplicate')) return 'reuse_existing_provider_command_by_idempotency_key';
  if (String(blocker).includes('retryable')) return 'wait_for_retryable_provider_health';
  return 'operator_review_provider_command_ledger';
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

function buildExternalWriteOperationalIncident({
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
  operationalHealth,
  diagnostics,
  kernelCall
}) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.level === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.level === 'warning');
  const writeRequired = writeEffects.length > 0;
  const open = writeRequired && (
    errors.length > 0
    || operationalHealth?.failureState === 'retryable_failure'
    || operationalHealth?.failureState === 'failed'
    || operationalHealth?.degraded === true
  );
  const retryable = open
    && operationalHealth?.retry?.retryable === true
    && operationalHealth?.retry?.exhausted !== true;
  const terminal = open && !retryable && errors.length > 0;
  const severity = !open
    ? 'none'
    : terminal
      ? 'critical'
      : retryable
        ? 'warning'
        : 'notice';
  const failedDependencies = (operationalHealth?.dependencies ?? [])
    .filter((dependency) => dependency.ready === false)
    .map((dependency) => dependency.name);
  const evidence = [
    ...errors.map((diagnostic) => incidentEvidence('error', diagnostic.code, externalWriteDiagnosticSource(diagnostic.code), diagnostic.blockers ?? diagnostic.claims ?? diagnostic.effects ?? null)),
    ...warnings.map((diagnostic) => incidentEvidence('warning', diagnostic.code, externalWriteDiagnosticSource(diagnostic.code), diagnostic.blockers ?? diagnostic.claims ?? diagnostic.effects ?? null)),
    ...failedDependencies.map((dependency) => incidentEvidence('dependency', dependency, 'external_write_dependency', null)),
    ...(providerHealth?.blockers ?? []).map((blocker) => incidentEvidence('provider_blocker', blocker, 'mailchimp_provider', null))
  ];
  const owner = incidentOwner({
    providerHealth,
    lifecycleGate,
    providerCommand,
    operatorReadiness,
    errors
  });
  const blockers = uniqueSorted([
    ...errors.map((diagnostic) => diagnostic.code),
    ...(terminal ? ['terminal_external_write_failure'] : []),
    ...(writeRequired && open && !route?.statusChannel ? ['missing_incident_status_channel'] : []),
    ...(writeRequired && open && !providerCommand?.commandId ? ['missing_incident_provider_command'] : [])
  ]);
  const incidentWarnings = uniqueSorted([
    ...warnings.map((diagnostic) => diagnostic.code),
    ...(retryable ? ['retry_scheduled_for_external_write'] : []),
    ...(operationalHealth?.degraded ? ['external_write_degraded_mode_active'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : !open
      ? 'closed'
      : terminal
        ? 'terminal'
        : retryable
          ? 'retry_scheduled'
          : 'degraded';
  const retryWindow = {
    scheduled: retryable,
    attempt: operationalHealth?.retry?.attempt ?? 0,
    maxAttempts: operationalHealth?.retry?.maxAttempts ?? kernelCall?.recovery?.retry?.maxAttempts ?? 0,
    retryAfterMs: retryable ? operationalHealth?.retry?.retryAfterMs ?? null : null,
    policy: operationalHealth?.retry?.backoffPolicy ?? 'none',
    exhausted: operationalHealth?.retry?.exhausted === true
  };
  const degradedMode = operationalHealth?.degradedMode
    ? {
        mode: operationalHealth.degradedMode.mode,
        allowDispatch: operationalHealth.degradedMode.allowDispatch === true,
        requiresAcknowledgement: operationalHealth.degradedMode.requiresAcknowledgement === true
      }
    : null;
  const digestShape = {
    programId,
    operation,
    state,
    severity,
    owner,
    commandId: providerCommand?.commandId ?? null,
    statusChannel: route?.statusChannel ?? null,
    healthDigest: operationalHealth?.digest ?? null,
    retryWindow,
    failedDependencies,
    evidence: evidence.map((item) => `${item.kind}:${item.code}:${item.source}`)
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operational-incident`,
    programId,
    operation,
    state,
    severity,
    open,
    retryable,
    terminal,
    writeRequired,
    owner,
    statusAtDetection: status,
    statusChannel: route?.statusChannel ?? null,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    providerStatus: providerHealth?.status ?? 'unknown',
    lifecycleState: lifecycleGate?.state ?? 'unknown',
    persistedStatusState: persistedStatus?.state ?? 'unknown',
    exportLedgerState: exportLedger?.state ?? 'unknown',
    replayManifestState: replayManifest?.state ?? 'unknown',
    operatorReadinessState: operatorReadiness?.state ?? 'unknown',
    retryWindow,
    degradedMode,
    failedDependencies,
    evidence,
    blockers,
    warnings: incidentWarnings,
    nextAction: terminal
      ? externalWriteActionForDiagnostic(blockers[0] ?? 'external_write_operational_incident_terminal')
      : retryable
        ? 'retry_external_write_after_backoff'
        : open
          ? operationalHealth?.nextAction ?? 'review_external_write_incident'
          : writeRequired
            ? 'close_external_write_incident'
            : 'continue_read_only',
    digest: stableHash(digestShape)
  };
}

function validateExternalWriteOperationalIncident(incident, health, writeEffects) {
  if (!writeEffects.length && !incident) return [];
  const diagnostics = [];
  if (!incident) return [{ level: 'error', code: 'external_write_missing_operational_incident' }];
  if (writeEffects.length && incident.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_operational_incident_not_write_required' });
  }
  if (incident.open && !incident.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_operational_incident_missing_digest' });
  }
  if (incident.open && !incident.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_operational_incident_missing_status_channel' });
  }
  if (incident.open && !incident.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_operational_incident_missing_command_id' });
  }
  if (incident.retryable && !incident.retryWindow?.retryAfterMs) {
    diagnostics.push({ level: 'error', code: 'external_write_operational_incident_missing_retry_window' });
  }
  if (incident.terminal) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_operational_incident_terminal',
      blockers: incident.blockers ?? []
    });
  }
  if (health?.failureState === 'failed' && incident.terminal !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_operational_incident_terminal_mismatch' });
  }
  if (incident.open && !incident.evidence?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_operational_incident_missing_evidence' });
  }
  if (incident.state === 'degraded') {
    diagnostics.push({ level: 'warning', code: 'external_write_operational_incident_degraded', warnings: incident.warnings ?? [] });
  }
  return diagnostics;
}

function buildExternalWriteRecoveryRunbook({
  programId,
  operation,
  status,
  writeEffects,
  route,
  lifecycleGate,
  providerHealth,
  providerCommand,
  syncMetadata,
  persistedStatus,
  statusJournal,
  providerCommandLedger,
  persistenceEnvelope,
  replayManifest,
  operatorReadiness,
  operationalHealth,
  operationalIncident,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const retryAfterMs = operationalIncident?.retryWindow?.retryAfterMs
    ?? operationalHealth?.retry?.retryAfterMs
    ?? providerHealth?.retryAfterMs
    ?? null;
  const mode = !writeRequired
    ? 'not_required'
    : operationalIncident?.terminal
      ? 'manual_repair'
      : operationalIncident?.retryable
        ? 'backoff_retry'
        : operationalHealth?.degraded
          ? 'degraded_review'
          : 'normal_recovery';
  const rawSteps = [
    recoveryRunbookStep({
      id: 'capture_status_snapshot',
      label: 'Capture Mailchimp status snapshot',
      state: persistedStatus?.state ?? status,
      executable: Boolean(persistedStatus?.digest || statusJournal?.digest),
      commandId: statusJournal?.commands?.[0]?.commandId ?? null,
      statusChannel: route?.statusChannel ?? null,
      digest: persistedStatus?.digest ?? statusJournal?.digest ?? null,
      nextAction: persistedStatus?.nextAction ?? 'persist_external_write_status',
      blockers: [
        ...(!route?.statusChannel && writeRequired ? ['missing_status_channel'] : []),
        ...(!persistedStatus?.digest && writeRequired ? ['missing_persisted_status_digest'] : [])
      ],
      warnings: statusJournal?.warnings ?? []
    }),
    recoveryRunbookStep({
      id: 'verify_provider_health',
      label: 'Verify Mailchimp provider health',
      state: providerHealth?.status ?? 'unknown',
      executable: providerHealth?.ready === true || providerHealth?.retryable === true,
      commandId: providerCommand?.commandId ?? null,
      statusChannel: providerHealth?.statusChannel ?? route?.statusChannel ?? null,
      digest: providerHealth?.digest ?? null,
      nextAction: providerHealth?.nextAction ?? 'check_mailchimp_provider_health',
      blockers: providerHealth?.blockers ?? [],
      warnings: providerHealth?.warnings ?? []
    }),
    recoveryRunbookStep({
      id: 'respect_lifecycle_gate',
      label: 'Respect lifecycle release gate',
      state: lifecycleGate?.state ?? 'unknown',
      executable: lifecycleGate?.ready === true || ['held', 'scheduled'].includes(lifecycleGate?.state),
      commandId: lifecycleGate?.command?.commandId ?? null,
      statusChannel: route?.statusChannel ?? null,
      digest: lifecycleGate?.digest ?? null,
      nextAction: lifecycleGate?.nextAction ?? 'continue_lifecycle_gate',
      blockers: lifecycleGate?.blockers ?? [],
      warnings: lifecycleGate?.warnings ?? []
    }),
    recoveryRunbookStep({
      id: 'confirm_replay_safety',
      label: 'Confirm idempotent replay safety',
      state: replayManifest?.state ?? providerCommandLedger?.state ?? 'unknown',
      executable: replayManifest?.ready === true || providerCommandLedger?.replayable === true,
      commandId: replayManifest?.commands?.[0]?.commandId ?? providerCommand?.commandId ?? null,
      statusChannel: route?.statusChannel ?? null,
      digest: replayManifest?.digest ?? providerCommandLedger?.digest ?? null,
      nextAction: replayManifest?.nextAction ?? providerCommandLedger?.nextAction ?? 'confirm_provider_replay_safety',
      blockers: [
        ...(replayManifest?.blockers ?? []),
        ...(providerCommandLedger?.blockers ?? []),
        ...(!providerCommandLedger?.duplicateSafe && writeRequired ? ['provider_command_not_duplicate_safe'] : [])
      ],
      warnings: replayManifest?.warnings ?? []
    }),
    recoveryRunbookStep({
      id: 'restore_persistence_envelope',
      label: 'Restore external write persistence envelope',
      state: persistenceEnvelope?.state ?? 'unknown',
      executable: persistenceEnvelope?.ready === true && persistenceEnvelope?.restartSemantics?.restartSafe === true,
      commandId: persistenceEnvelope?.commands?.[0]?.commandId ?? null,
      statusChannel: route?.statusChannel ?? null,
      digest: persistenceEnvelope?.digest ?? null,
      nextAction: persistenceEnvelope?.nextAction ?? 'restore_external_write_persistence_envelope',
      blockers: persistenceEnvelope?.blockers ?? [],
      warnings: persistenceEnvelope?.warnings ?? []
    }),
    recoveryRunbookStep({
      id: 'resume_or_escalate',
      label: 'Resume Mailchimp write or escalate',
      state: operationalIncident?.state ?? operationalHealth?.state ?? 'unknown',
      executable: operationalIncident?.retryable === true || operationalIncident?.open === false,
      commandId: providerCommand?.commandId ?? replayManifest?.commands?.[0]?.commandId ?? null,
      statusChannel: route?.statusChannel ?? null,
      digest: operationalIncident?.digest ?? operationalHealth?.digest ?? null,
      nextAction: operationalIncident?.nextAction ?? operationalHealth?.nextAction ?? operatorReadiness?.nextAction ?? 'resume_external_write',
      blockers: operationalIncident?.blockers ?? [],
      warnings: operationalIncident?.warnings ?? []
    })
  ];
  const steps = rawSteps.map((step, index) => ({
    ...step,
    index,
    required: writeRequired,
    terminal: index === rawSteps.length - 1
  }));
  const blockers = uniqueSorted([
    ...steps.flatMap((step) => step.blockers.map((blocker) => `${step.id}:${blocker}`)),
    ...(operationalIncident?.terminal ? ['terminal_incident_requires_manual_repair'] : []),
    ...(writeRequired && !route?.idempotencyKey ? ['missing_runbook_idempotency_key'] : [])
  ]);
  const warnings = uniqueSorted([
    ...steps.flatMap((step) => step.warnings.map((warning) => `${step.id}:${warning}`)),
    ...(mode === 'degraded_review' ? ['runbook_degraded_review_required'] : []),
    ...(mode === 'backoff_retry' ? ['runbook_backoff_retry_scheduled'] : [])
  ]);
  const ready = !writeRequired || (blockers.length === 0 && steps.every((step) => step.executable || step.id === 'resume_or_escalate'));
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : mode === 'backoff_retry'
        ? 'retry_scheduled'
        : warnings.length
          ? 'review'
          : 'ready';
  const digestShape = {
    programId,
    operation,
    state,
    mode,
    status,
    statusChannel: route?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    retryAfterMs,
    steps: steps.map((step) => ({
      id: step.id,
      state: step.state,
      executable: step.executable,
      commandId: step.commandId,
      digest: step.digest
    })),
    incidentDigest: operationalIncident?.digest ?? null,
    kernelRestartToken: kernelCall?.runtimeState?.restartToken ?? null
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.recovery-runbook`,
    programId,
    operation,
    state,
    ready,
    mode,
    writeRequired,
    statusAtBuild: status,
    statusChannel: route?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    primaryCommandId: providerCommand?.commandId ?? replayManifest?.commands?.[0]?.commandId ?? null,
    retryAfterMs,
    restartToken: kernelCall?.runtimeState?.restartToken ?? kernelCall?.runtimeState?.profileRestartToken ?? null,
    steps,
    blockers,
    warnings,
    nextAction: blockers.length
      ? externalWriteActionForDiagnostic(blockers[0])
      : mode === 'backoff_retry'
        ? 'wait_for_recovery_backoff_then_replay'
        : mode === 'manual_repair'
          ? 'repair_external_write_before_replay'
          : steps.find((step) => !step.executable)?.nextAction ?? 'resume_external_write_recovery',
    digest: stableHash(digestShape)
  };
}

function validateExternalWriteRecoveryRunbook(runbook, incident, writeEffects) {
  if (!writeEffects.length && !runbook) return [];
  const diagnostics = [];
  if (!runbook) return [{ level: 'error', code: 'external_write_missing_recovery_runbook' }];
  if (writeEffects.length && runbook.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_recovery_runbook_not_write_required' });
  }
  if (writeEffects.length && !runbook.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_recovery_runbook_missing_digest' });
  }
  if (writeEffects.length && !runbook.steps?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_recovery_runbook_missing_steps' });
  }
  if (runbook.state === 'retry_scheduled' && !runbook.retryAfterMs) {
    diagnostics.push({ level: 'error', code: 'external_write_recovery_runbook_missing_retry_after' });
  }
  if (incident?.open && !runbook.primaryCommandId) {
    diagnostics.push({ level: 'error', code: 'external_write_recovery_runbook_missing_command' });
  }
  if (runbook.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_recovery_runbook_blocked',
      blockers: runbook.blockers ?? []
    });
  }
  if (runbook.state === 'review') {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_recovery_runbook_review',
      warnings: runbook.warnings ?? []
    });
  }
  return diagnostics;
}

function buildProviderHandoffHealthSummary({
  programId,
  operation,
  status,
  writeEffects,
  route,
  providerHealth,
  providerServiceContract,
  providerCommand,
  syncMetadata,
  providerCommandLedger,
  exportLedger,
  replayManifest,
  operationalHealth,
  operationalIncident,
  recoveryRunbook,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const receipt = providerServiceContract?.handoffReceipt ?? providerServiceContract?.sync?.handoffReceipt ?? {};
  const dependencies = [
    handoffHealthDependency('provider_health', providerHealth?.status, providerHealth?.ready, providerHealth?.blockers, providerHealth?.warnings, providerHealth?.nextAction),
    handoffHealthDependency('provider_service', providerServiceContract?.state, providerServiceContract?.ready, providerServiceContract?.blockers, providerServiceContract?.warnings, providerServiceContract?.nextAction),
    handoffHealthDependency('provider_receipt', receipt.state, receipt.ready, receipt.blockers, receipt.warnings, receipt.nextAction),
    handoffHealthDependency('provider_command', providerCommand?.state, providerCommand?.state === 'ready' || !writeRequired, providerCommand?.blockers, providerCommand?.warnings, providerCommand?.nextAction),
    handoffHealthDependency('sync_metadata', syncMetadata?.ready ? 'ready' : 'blocked', syncMetadata?.ready || !writeRequired, syncMetadata?.blockers, syncMetadata?.warnings, syncMetadata?.nextAction),
    handoffHealthDependency('command_ledger', providerCommandLedger?.state, providerCommandLedger?.ready || !writeRequired, providerCommandLedger?.blockers, providerCommandLedger?.warnings, providerCommandLedger?.nextAction),
    handoffHealthDependency('export_ledger', exportLedger?.state, exportLedger?.ready || !writeRequired, exportLedger?.blockers, exportLedger?.warnings, exportLedger?.nextAction),
    handoffHealthDependency('replay_manifest', replayManifest?.state, replayManifest?.ready || !writeRequired, replayManifest?.blockers, replayManifest?.warnings, replayManifest?.nextAction),
    handoffHealthDependency('operational_health', operationalHealth?.state, operationalHealth?.ready || !writeRequired, operationalHealth?.actionableErrors?.map((error) => error.code), operationalHealth?.warnings?.map((warning) => warning.code), operationalHealth?.nextAction),
    handoffHealthDependency('recovery_runbook', recoveryRunbook?.state, recoveryRunbook?.ready || !writeRequired, recoveryRunbook?.blockers, recoveryRunbook?.warnings, recoveryRunbook?.nextAction)
  ];
  const failedDependencies = dependencies.filter((dependency) => dependency.ready === false);
  const reviewDependencies = dependencies.filter((dependency) => dependency.ready !== false && dependency.warnings.length);
  const retryAfterMs = operationalIncident?.retryWindow?.retryAfterMs
    ?? operationalHealth?.retry?.retryAfterMs
    ?? providerHealth?.retryAfterMs
    ?? kernelCall?.recovery?.retry?.initialDelayMs
    ?? null;
  const retryable = writeRequired
    && providerHealth?.retryable !== false
    && operationalIncident?.terminal !== true
    && failedDependencies.every((dependency) => !dependency.blockers.some((blocker) => String(blocker).includes('denied') || String(blocker).includes('missing_capability')))
    && operationalHealth?.retry?.exhausted !== true;
  const degraded = providerHealth?.degraded === true
    || operationalHealth?.degraded === true
    || reviewDependencies.length > 0
    || status === 'review';
  const terminal = writeRequired && (operationalIncident?.terminal === true || (failedDependencies.length > 0 && retryable === false));
  const state = !writeRequired
    ? 'not_required'
    : terminal
      ? 'terminal'
      : failedDependencies.length
        ? retryable
          ? 'retry_scheduled'
          : 'blocked'
        : degraded
          ? 'degraded'
          : 'ready';
  const blockers = uniqueSorted([
    ...failedDependencies.flatMap((dependency) => dependency.blockers.map((blocker) => `${dependency.name}:${blocker}`)),
    ...(terminal ? ['provider_handoff_terminal'] : []),
    ...(writeRequired && !route?.statusChannel ? ['provider_handoff_missing_status_channel'] : []),
    ...(writeRequired && !providerCommand?.commandId ? ['provider_handoff_missing_command_id'] : []),
    ...(writeRequired && !receipt.digest ? ['provider_handoff_missing_receipt_digest'] : [])
  ]);
  const warnings = uniqueSorted([
    ...reviewDependencies.flatMap((dependency) => dependency.warnings.map((warning) => `${dependency.name}:${warning}`)),
    ...(degraded ? ['provider_handoff_degraded'] : []),
    ...(retryable && failedDependencies.length ? ['provider_handoff_retry_scheduled'] : [])
  ]);
  const digestShape = {
    programId,
    operation,
    state,
    commandId: providerCommand?.commandId ?? null,
    statusChannel: route?.statusChannel ?? null,
    receiptDigest: receipt.digest ?? null,
    providerHealthStatus: providerHealth?.status ?? 'unknown',
    dependencies: dependencies.map((dependency) => `${dependency.name}:${dependency.state}:${dependency.ready}`),
    retryable,
    retryAfterMs,
    blockers,
    warnings
  };
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.provider-handoff-health`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    degraded,
    retryable,
    terminal,
    statusChannel: route?.statusChannel ?? null,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    externalStateKey: providerServiceContract?.sync?.externalStateKey ?? null,
    providerStatus: providerHealth?.status ?? 'unknown',
    receipt: {
      state: receipt.state ?? 'unknown',
      ready: receipt.ready === true,
      acknowledged: receipt.acknowledged === true,
      fresh: receipt.fresh === true,
      digest: receipt.digest ?? null,
      nextAction: receipt.nextAction ?? null
    },
    retryWindow: {
      scheduled: retryable && failedDependencies.length > 0,
      retryAfterMs: retryable && failedDependencies.length > 0 ? retryAfterMs : null,
      attempt: operationalHealth?.retry?.attempt ?? 0,
      maxAttempts: operationalHealth?.retry?.maxAttempts ?? kernelCall?.recovery?.retry?.maxAttempts ?? 0,
      exhausted: operationalHealth?.retry?.exhausted === true
    },
    dependencies,
    blockers,
    warnings,
    nextAction: blockers.length
      ? externalWriteActionForDiagnostic(blockers[0])
      : retryable && failedDependencies.length
        ? 'retry_provider_handoff_after_backoff'
        : degraded
          ? 'review_provider_handoff_health'
          : writeRequired
            ? 'publish_provider_handoff_health'
            : 'continue_read_only',
    digest: stableHash(digestShape)
  };
}

function validateProviderHandoffHealthSummary(summary, writeEffects) {
  if (!writeEffects.length && !summary) return [];
  const diagnostics = [];
  if (!summary) return [{ level: 'error', code: 'external_write_missing_provider_handoff_health' }];
  if (writeEffects.length && summary.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_handoff_health_not_write_required' });
  }
  if (writeEffects.length && !summary.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_handoff_health_missing_digest' });
  }
  if (summary.ready && summary.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_handoff_health_ready_with_blockers',
      blockers: summary.blockers
    });
  }
  if (summary.retryWindow?.scheduled && !summary.retryWindow?.retryAfterMs) {
    diagnostics.push({ level: 'error', code: 'external_write_provider_handoff_health_missing_backoff' });
  }
  if (summary.terminal) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_provider_handoff_health_terminal',
      blockers: summary.blockers ?? []
    });
  }
  if (summary.degraded && !summary.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_provider_handoff_health_degraded_without_warning' });
  }
  return diagnostics;
}

function handoffHealthDependency(name, state, ready, blockers = [], warnings = [], nextAction = null) {
  const normalizedBlockers = uniqueSorted(blockers ?? []);
  const normalizedWarnings = uniqueSorted(warnings ?? []);
  return {
    name,
    state: state ?? (ready ? 'ready' : 'unknown'),
    ready: ready === true,
    blockers: normalizedBlockers,
    warnings: normalizedWarnings,
    nextAction: nextAction ?? (normalizedBlockers.length ? externalWriteActionForDiagnostic(normalizedBlockers[0]) : null)
  };
}

function recoveryRunbookStep({
  id,
  label,
  state,
  executable,
  commandId,
  statusChannel,
  digest,
  nextAction,
  blockers = [],
  warnings = []
}) {
  return {
    id,
    label,
    state: state ?? 'unknown',
    executable: executable === true,
    commandId: commandId ?? null,
    statusChannel: statusChannel ?? null,
    digest: digest ?? null,
    nextAction: nextAction ?? 'operator_review',
    blockers: uniqueSorted(blockers),
    warnings: uniqueSorted(warnings)
  };
}

function incidentEvidence(kind, code, source, detail) {
  return {
    kind,
    code,
    source,
    detail,
    digest: stableHash({ kind, code, source, detail })
  };
}

function incidentOwner({ providerHealth, lifecycleGate, providerCommand, operatorReadiness, errors }) {
  const codes = errors.map((diagnostic) => diagnostic.code);
  if (providerHealth?.status === 'blocked' || providerHealth?.status === 'unavailable') return 'mailchimp_provider';
  if (codes.some((code) => String(code).includes('claim'))) return 'verifier';
  if (codes.some((code) => String(code).includes('scope') || String(code).includes('boundary'))) return 'permission_boundary';
  if (providerCommand?.state === 'blocked') return 'provider_command';
  if (lifecycleGate?.state === 'held' || lifecycleGate?.state === 'scheduled') return 'lifecycle_control';
  if (operatorReadiness?.state === 'review') return 'operator';
  return errors.length ? 'runtime' : 'none';
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
  operationalIncident,
  providerHandoffHealth,
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
    analyticsPhase('operational_health', operationalHealth?.state, operationalHealth?.ready, operationalHealth?.actionableErrors?.map((error) => error.code), operationalHealth?.warnings?.map((warning) => warning.code), operationalHealth?.nextAction),
    analyticsPhase('operational_incident', operationalIncident?.state, !operationalIncident?.open || operationalIncident?.retryable === true, operationalIncident?.blockers, operationalIncident?.warnings, operationalIncident?.nextAction),
    analyticsPhase('provider_handoff_health', providerHandoffHealth?.state, providerHandoffHealth?.ready, providerHandoffHealth?.blockers, providerHandoffHealth?.warnings, providerHandoffHealth?.nextAction)
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
    },
    {
      id: `ewhist:${stableHash({ programId, operation, phase: 'incident', digest: operationalIncident?.digest })}`,
      sequence: 6,
      phase: 'incident',
      status: operationalIncident?.state ?? 'unknown',
      severity: operationalIncident?.severity ?? 'none',
      open: operationalIncident?.open === true,
      retryable: operationalIncident?.retryable === true,
      terminal: operationalIncident?.terminal === true,
      nextAction: operationalIncident?.nextAction ?? null
    },
    {
      id: `ewhist:${stableHash({ programId, operation, phase: 'provider_handoff_health', digest: providerHandoffHealth?.digest })}`,
      sequence: 7,
      phase: 'provider_handoff_health',
      status: providerHandoffHealth?.state ?? 'unknown',
      ready: providerHandoffHealth?.ready === true,
      degraded: providerHandoffHealth?.degraded === true,
      retryable: providerHandoffHealth?.retryable === true,
      terminal: providerHandoffHealth?.terminal === true,
      failedDependencyCount: providerHandoffHealth?.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0,
      nextAction: providerHandoffHealth?.nextAction ?? null
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
    actionableErrorCount: operationalHealth?.actionableErrors?.length ?? 0,
    operationalIncidentOpenCount: operationalIncident?.open ? 1 : 0,
    operationalIncidentRetryableCount: operationalIncident?.retryable ? 1 : 0,
    operationalIncidentTerminalCount: operationalIncident?.terminal ? 1 : 0,
    operationalIncidentEvidenceCount: operationalIncident?.evidence?.length ?? 0,
    providerHandoffHealthReadyCount: providerHandoffHealth?.ready ? 1 : 0,
    providerHandoffHealthDegradedCount: providerHandoffHealth?.degraded ? 1 : 0,
    providerHandoffHealthRetryableCount: providerHandoffHealth?.retryable ? 1 : 0,
    providerHandoffHealthTerminalCount: providerHandoffHealth?.terminal ? 1 : 0,
    providerHandoffHealthFailedDependencyCount: providerHandoffHealth?.dependencies?.filter((dependency) => dependency.ready === false)?.length ?? 0
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
    operationalHealthDigest: operationalHealth?.digest ?? null,
    operationalIncidentDigest: operationalIncident?.digest ?? null,
    operationalIncidentSeverity: operationalIncident?.severity ?? 'none',
    providerHandoffHealthDigest: providerHandoffHealth?.digest ?? null,
    providerHandoffHealthState: providerHandoffHealth?.state ?? 'unknown'
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
  const operatorDecision = buildExternalWriteOperatorDecision({
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
    operatorActionCard,
    counters,
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
    operatorDecision: operatorDecision.digest,
    operationalIncident: operationalIncident?.digest ?? null,
    providerHandoffHealth: providerHandoffHealth?.digest ?? null,
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
    operatorDecision,
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

function buildExternalWriteOperatorDecision({
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
  operatorActionCard,
  counters,
  blockers,
  warnings,
  writeRequired
}) {
  const missingAcknowledgements = uniqueSorted([
    ...(acceptancePacket?.missingAcknowledgements ?? []),
    ...(operatorReadiness?.missingAcknowledgements ?? [])
  ]);
  const requiredAcknowledgements = uniqueSorted([
    ...(acceptancePacket?.requiredAcknowledgements ?? []),
    ...(writeRequired ? ['external_write_preview'] : [])
  ]);
  const releaseBlocked = blockers.length > 0 || missingAcknowledgements.length > 0 || operatorActionCard?.ready === false;
  const reviewRequired = !releaseBlocked && (warnings.length > 0 || acceptancePacket?.acceptanceState === 'pending_acknowledgement');
  const decisionState = !writeRequired
    ? 'not_required'
    : releaseBlocked
      ? 'blocked'
      : reviewRequired
        ? 'pending_acknowledgement'
        : state === 'ready'
          ? 'release_ready'
          : 'waiting';
  const primaryCommand = decisionState === 'release_ready'
    ? 'accept_and_release_mailchimp_write'
    : decisionState === 'pending_acknowledgement'
      ? 'collect_operator_acknowledgement'
      : decisionState === 'blocked'
        ? externalWriteActionForDiagnostic(blockers[0] ?? missingAcknowledgements[0] ?? 'operator_decision_blocked')
        : 'continue_read_only';
  const decisionInputs = {
    programId,
    operation,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    requestKey: clientRequestSnapshot?.requestKey ?? null,
    persistedDigest: persistedStatus?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    replayDigest: replayManifest?.digest ?? null,
    operatorActionCardDigest: operatorActionCard?.digest ?? null,
    missingAcknowledgements
  };
  const acknowledgementToken = writeRequired
    ? stableHash({
        type: 'mailchimp-external-write-operator-decision-ack',
        ...decisionInputs,
        requiredAcknowledgements
      })
    : null;
  const decisionDigest = stableHash({
    state: decisionState,
    primaryCommand,
    decisionInputs,
    acknowledgementToken,
    blockers,
    warnings,
    counters
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.operator-decision`,
    programId,
    operation,
    state: decisionState,
    ready: decisionState === 'release_ready' || decisionState === 'not_required',
    writeRequired,
    presentationMode: decisionState === 'release_ready'
      ? 'confirm'
      : decisionState === 'pending_acknowledgement'
        ? 'acknowledge'
        : decisionState === 'blocked'
          ? 'repair'
          : 'status',
    primaryCommand,
    command: {
      type: 'mailchimp.external_write.operator_decision',
      commandId: decisionState === 'release_ready' ? `operator-release:${decisionDigest}` : null,
      idempotencyKey: decisionState === 'release_ready'
        ? stableHash({ action: primaryCommand, idempotencyKey: route?.idempotencyKey ?? null, decisionDigest })
        : null,
      statusAfterReplay: decisionState === 'release_ready' ? 'external_write_release_accepted' : decisionState,
      conflict: 'return-existing',
      requiredInputs: ['programId', 'operation', 'commandId', 'idempotencyKey', 'statusChannel', 'operatorActionCardDigest']
        .filter((name) => name !== 'commandId' || writeRequired)
    },
    acknowledgement: {
      required: writeRequired && (decisionState === 'pending_acknowledgement' || requiredAcknowledgements.length > 0),
      token: acknowledgementToken,
      requiredAcknowledgements,
      missingAcknowledgements,
      reason: missingAcknowledgements.length
        ? 'operator_acknowledgement_missing'
        : warnings.length
          ? 'external_write_review_required'
          : writeRequired
            ? 'external_write_confirmation_required'
            : null
    },
    status: {
      current: operatorActionCard?.userVisibleStatus?.current
        ?? operatorReadiness?.userVisibleStatus
        ?? clientRequestSnapshot?.visibleStatus?.current
        ?? null,
      completion: operatorActionCard?.userVisibleStatus?.completion
        ?? clientRequestSnapshot?.visibleStatus?.completion
        ?? 'mailchimp_write_synced',
      failure: operatorActionCard?.userVisibleStatus?.failure
        ?? clientRequestSnapshot?.visibleStatus?.failure
        ?? 'mailchimp_write_needs_review'
    },
    decisionInputs,
    evidence: {
      operatorActionCardDigest: operatorActionCard?.digest ?? null,
      persistedStatusDigest: persistedStatus?.digest ?? null,
      exportLedgerDigest: exportLedger?.digest ?? null,
      replayManifestDigest: replayManifest?.digest ?? null,
      readinessDigest: operatorReadiness?.digest ?? null,
      healthDigest: operationalHealth?.digest ?? null
    },
    validationSummary: {
      ok: releaseBlocked === false,
      errorCount: blockers.length,
      warningCount: warnings.length,
      missingAcknowledgementCount: missingAcknowledgements.length,
      failedPhaseCount: counters.failedPhaseCount ?? 0,
      degradedPhaseCount: counters.degradedPhaseCount ?? 0
    },
    blockers,
    warnings,
    nextAction: primaryCommand,
    digest: decisionDigest
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

function buildExternalWriteAnalyticsPublicationContract({
  programId,
  operation,
  status,
  writeEffects,
  route,
  analyticsExport,
  acceptancePacket,
  operatorReadiness,
  operationalHealth,
  operationalIncident,
  boundaryDecisionReceipt,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const accepted = acceptancePacket?.acceptEnabled === true
    && !(acceptancePacket?.missingAcknowledgements?.length);
  const operatorDecision = analyticsExport?.operatorDecision ?? {};
  const releaseAllowed = boundaryDecisionReceipt?.release?.allowed === true || !writeRequired;
  const requiredAcknowledgements = uniqueSorted([
    ...(writeRequired ? ['external_write_analytics_publication'] : []),
    ...(analyticsExport?.operatorDecision?.acknowledgement?.requiredAcknowledgements ?? []),
    ...(acceptancePacket?.requiredAcknowledgements ?? [])
  ]);
  const coveredAcknowledgements = uniqueSorted([
    ...(accepted ? ['external_write_analytics_publication'] : []),
    ...(analyticsExport?.operatorDecision?.acknowledgement?.missingAcknowledgements?.length ? [] : analyticsExport?.operatorDecision?.acknowledgement?.requiredAcknowledgements ?? []),
    ...(acceptancePacket?.coveredAcknowledgements ?? [])
  ]);
  const missingAcknowledgements = requiredAcknowledgements.filter((acknowledgement) => !coveredAcknowledgements.includes(acknowledgement));
  const publishers = [
    publicationPublisher('route_export', route?.statusChannel, analyticsExport?.digest, {
      required: writeRequired,
      commandId: operatorDecision?.command?.commandId ?? null,
      accepted,
      releaseAllowed
    }),
    publicationPublisher('audit_ledger', route?.auditChannel, analyticsExport?.exportSummary?.exportLedgerDigest, {
      required: writeRequired,
      operationalIncidentOpen: operationalIncident?.open === true,
      severity: operationalIncident?.severity ?? 'none'
    }),
    publicationPublisher('operator_console', operatorReadiness?.statusChannel ?? route?.statusChannel, analyticsExport?.operatorActionCard?.digest, {
      required: writeRequired,
      primaryAction: analyticsExport?.operatorActionCard?.primaryAction ?? null,
      ready: analyticsExport?.operatorActionCard?.ready === true
    })
  ];
  const targets = publishers.map((publisher) => ({
    name: publisher.name,
    channel: publisher.channel,
    required: publisher.required,
    ready: publisher.ready,
    digest: publisher.digest,
    blockerCount: publisher.blockers.length,
    warningCount: publisher.warnings.length
  }));
  const freshnessWarnings = uniqueSorted([
    ...(analyticsExport?.reporting?.changedSinceKernelSnapshot ? ['analytics_changed_since_kernel_snapshot'] : []),
    ...(analyticsExport?.operatorActionCard?.history?.latestSnapshotId !== analyticsExport?.reporting?.latestSnapshotId ? ['operator_card_snapshot_lag'] : []),
    ...(operationalHealth?.retry?.scheduled ? ['operational_retry_scheduled'] : []),
    ...(operationalIncident?.open && operationalIncident?.retryable ? ['retryable_incident_open'] : [])
  ]);
  const blockers = uniqueSorted([
    ...(analyticsExport?.blockers ?? []).map((blocker) => `analytics_${blocker}`),
    ...publishers.flatMap((publisher) => publisher.blockers.map((blocker) => `${publisher.name}_${blocker}`)),
    ...(writeRequired && !analyticsExport?.digest ? ['publication_missing_analytics_digest'] : []),
    ...(writeRequired && !accepted ? ['publication_acceptance_not_enabled'] : []),
    ...(writeRequired && !releaseAllowed ? ['publication_boundary_release_not_allowed'] : []),
    ...(writeRequired && missingAcknowledgements.length ? ['publication_missing_acknowledgement'] : []),
    ...(operationalIncident?.terminal ? ['publication_terminal_incident_open'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(analyticsExport?.warnings ?? []).map((warning) => `analytics_${warning}`),
    ...publishers.flatMap((publisher) => publisher.warnings.map((warning) => `${publisher.name}_${warning}`)),
    ...freshnessWarnings
  ]);
  const state = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'review'
      : writeRequired
        ? 'ready'
        : 'not_required';
  const publishDigest = stableHash({
    programId,
    operation,
    state,
    analyticsDigest: analyticsExport?.digest ?? null,
    publishers: publishers.map((publisher) => `${publisher.name}:${publisher.channel}:${publisher.digest}`),
    missingAcknowledgements,
    releaseAllowed,
    blockers,
    warnings
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.analytics-publication`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    status: status ?? 'unknown',
    routeKey: route?.routeKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    auditChannel: route?.auditChannel ?? null,
    analyticsDigest: analyticsExport?.digest ?? null,
    exportSummaryFormat: analyticsExport?.exportSummary?.format ?? null,
    publishers,
    targets,
    freshness: {
      latestSnapshotId: analyticsExport?.reporting?.latestSnapshotId ?? null,
      latestSnapshotDigest: analyticsExport?.reporting?.latestSnapshotDigest ?? null,
      changedSinceKernelSnapshot: analyticsExport?.reporting?.changedSinceKernelSnapshot === true,
      kernelSnapshotDigest: analyticsExport?.exportSummary?.latestKernelSnapshotDigest ?? kernelCall?.history?.latest?.digest ?? null,
      warnings: freshnessWarnings
    },
    acknowledgements: {
      required: requiredAcknowledgements,
      covered: coveredAcknowledgements,
      missing: missingAcknowledgements,
      token: writeRequired
        ? stableHash({
            type: 'mailchimp-external-write-analytics-publication-ack',
            programId,
            operation,
            analyticsDigest: analyticsExport?.digest ?? null,
            requiredAcknowledgements
          })
        : null
    },
    publishCommand: {
      type: 'mailchimp.external_write.analytics.publish',
      ready: state === 'ready' || state === 'not_required',
      commandId: writeRequired ? `analytics-publish:${publishDigest}` : null,
      idempotencyKey: writeRequired
        ? stableHash({
            action: 'publish_external_write_analytics',
            routeKey: route?.routeKey ?? null,
            analyticsDigest: analyticsExport?.digest ?? null,
            statusChannel: route?.statusChannel ?? null
          })
        : null,
      targetChannels: targets.filter((target) => target.required).map((target) => target.channel).filter(Boolean),
      statusAfterPublish: state === 'ready' ? 'mailchimp_analytics_published' : state,
      requiredInputs: ['programId', 'operation', 'analyticsDigest', 'statusChannel', 'acknowledgementToken']
        .filter((name) => writeRequired || name === 'programId' || name === 'operation')
    },
    blockers,
    warnings,
    nextAction: blockers.length
      ? externalWriteActionForDiagnostic(blockers[0])
      : warnings.length
        ? 'review_external_write_analytics_publication'
        : writeRequired
          ? 'publish_external_write_analytics'
          : 'continue_read_only',
    digest: publishDigest
  };
}

function publicationPublisher(name, channel, digest, detail = {}) {
  const required = detail.required === true;
  const blockers = uniqueSorted([
    ...(required && !channel ? ['missing_channel'] : []),
    ...(required && !digest ? ['missing_digest'] : []),
    ...(required && detail.accepted === false ? ['acceptance_not_enabled'] : []),
    ...(required && detail.releaseAllowed === false ? ['release_not_allowed'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(detail.operationalIncidentOpen && detail.severity !== 'none' ? ['incident_open'] : []),
    ...(detail.ready === false && required ? ['publisher_not_ready'] : [])
  ]);
  return {
    name,
    channel: channel ?? null,
    required,
    ready: blockers.length === 0,
    digest: digest ?? null,
    detail: stableClone(detail),
    blockers,
    warnings
  };
}

function buildExternalWriteTimelinePublicationContract({
  programId,
  operation,
  status,
  writeEffects,
  route,
  analyticsExport,
  analyticsPublication,
  exportLedger,
  replayManifest,
  operatorReadiness,
  operationalHealth,
  operationalIncident,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const sourceSnapshots = asArray(analyticsExport?.historySnapshots);
  const sourceTimeline = asArray(analyticsExport?.timeline);
  const events = sourceTimeline.map((event, index) => ({
    sequence: Number(event.sequence ?? index + 1),
    phase: event.event ?? event.phase ?? 'unknown',
    status: event.status ?? 'unknown',
    outcome: event.outcome ?? 'unknown',
    ready: event.ready === true,
    blockerCount: Number(event.blockerCount ?? 0),
    warningCount: Number(event.warningCount ?? 0),
    nextAction: event.nextAction ?? null,
    digest: stableHash({
      programId,
      operation,
      index,
      phase: event.event ?? event.phase ?? 'unknown',
      status: event.status ?? 'unknown',
      outcome: event.outcome ?? 'unknown',
      blockerCount: Number(event.blockerCount ?? 0),
      warningCount: Number(event.warningCount ?? 0)
    })
  }));
  const snapshots = sourceSnapshots.map((snapshot, index) => ({
    sequence: Number(snapshot.sequence ?? index + 1),
    id: snapshot.id ?? `timeline-snapshot:${stableHash({ programId, operation, index, snapshot })}`,
    phase: snapshot.phase ?? 'unknown',
    status: snapshot.status ?? 'unknown',
    digest: stableHash({
      programId,
      operation,
      sequence: Number(snapshot.sequence ?? index + 1),
      phase: snapshot.phase ?? 'unknown',
      status: snapshot.status ?? 'unknown',
      sourceDigest: snapshot.digest ?? snapshot.exportDigest ?? snapshot.replayDigest ?? null,
      sourceId: snapshot.id ?? null
    })
  }));
  const latestEvent = events.at(-1) ?? null;
  const latestSnapshot = snapshots.at(-1) ?? null;
  const acceptedDigest = route?.acceptedTimelineDigest
    ?? kernelCall?.handoff?.acceptedTimelineDigest
    ?? kernelCall?.preview?.routeExport?.timelineDigest
    ?? null;
  const kernelDigest = kernelCall?.history?.latest?.digest
    ?? kernelCall?.analytics?.history?.latest?.digest
    ?? analyticsExport?.reporting?.latestSnapshotDigest
    ?? null;
  const timelineDigest = stableHash({
    programId,
    operation,
    status,
    eventDigests: events.map((event) => event.digest),
    snapshotDigests: snapshots.map((snapshot) => snapshot.digest),
    analyticsDigest: analyticsExport?.digest ?? null,
    publicationDigest: analyticsPublication?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null
  });
  const drift = {
    acceptedDigest,
    kernelDigest,
    timelineDigest,
    changedSinceAcceptedSnapshot: Boolean(acceptedDigest && acceptedDigest !== timelineDigest),
    changedSinceKernelSnapshot: Boolean(kernelDigest && kernelDigest !== latestSnapshot?.digest),
    exportLedgerChanged: exportLedger?.changedSinceKernelSnapshot === true,
    analyticsChanged: analyticsExport?.reporting?.changedSinceKernelSnapshot === true
  };
  const blockers = uniqueSorted([
    ...(analyticsExport?.blockers ?? []).map((blocker) => `analytics_${blocker}`),
    ...(analyticsPublication?.blockers ?? []).map((blocker) => `publication_${blocker}`),
    ...(exportLedger?.blockers ?? []).map((blocker) => `ledger_${blocker}`),
    ...(replayManifest?.blockers ?? []).map((blocker) => `replay_${blocker}`),
    ...(writeRequired && !events.length ? ['timeline_publication_missing_events'] : []),
    ...(writeRequired && !snapshots.length ? ['timeline_publication_missing_snapshots'] : []),
    ...(writeRequired && !route?.statusChannel ? ['timeline_publication_missing_status_channel'] : []),
    ...(writeRequired && !analyticsExport?.digest ? ['timeline_publication_missing_analytics_digest'] : []),
    ...(writeRequired && !analyticsPublication?.digest ? ['timeline_publication_missing_publication_digest'] : []),
    ...(writeRequired && analyticsPublication?.state === 'blocked' ? ['timeline_publication_analytics_blocked'] : []),
    ...(operationalIncident?.terminal ? ['timeline_publication_terminal_incident'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(analyticsExport?.warnings ?? []).map((warning) => `analytics_${warning}`),
    ...(analyticsPublication?.warnings ?? []).map((warning) => `publication_${warning}`),
    ...(exportLedger?.warnings ?? []).map((warning) => `ledger_${warning}`),
    ...(operatorReadiness?.warnings ?? []).map((warning) => `operator_${warning}`),
    ...(operationalHealth?.degraded ? ['timeline_publication_operational_degraded'] : []),
    ...(operationalIncident?.open && !operationalIncident?.terminal ? ['timeline_publication_incident_open'] : []),
    ...(drift.changedSinceAcceptedSnapshot ? ['timeline_publication_changed_since_acceptance'] : []),
    ...(drift.changedSinceKernelSnapshot ? ['timeline_publication_changed_since_kernel_snapshot'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const commandId = writeRequired ? `timeline-publication:${timelineDigest}` : null;
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.timeline-publication`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    status: status ?? 'unknown',
    statusChannel: route?.statusChannel ?? null,
    auditChannel: route?.auditChannel ?? null,
    commandId,
    analyticsDigest: analyticsExport?.digest ?? null,
    analyticsPublicationDigest: analyticsPublication?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    replayDigest: replayManifest?.digest ?? null,
    latestEvent,
    latestSnapshot,
    events,
    snapshots,
    drift,
    publishCommand: {
      type: 'mailchimp.external_write.timeline.publish',
      ready: (state === 'ready' || state === 'not_required') && blockers.length === 0,
      commandId,
      idempotencyKey: writeRequired
        ? stableHash({
            action: 'publish_external_write_timeline',
            routeKey: route?.routeKey ?? null,
            statusChannel: route?.statusChannel ?? null,
            timelineDigest
          })
        : null,
      statusAfterPublish: state === 'ready' ? 'mailchimp_timeline_published' : state,
      requiredInputs: ['programId', 'operation', 'statusChannel', 'timelineDigest', 'analyticsDigest']
        .filter((name) => writeRequired || name === 'programId' || name === 'operation')
    },
    reportingState: {
      exportable: state === 'ready' || state === 'not_required',
      channel: route?.statusChannel ?? analyticsPublication?.statusChannel ?? null,
      latestPhase: latestEvent?.phase ?? null,
      eventCount: events.length,
      snapshotCount: snapshots.length,
      failedEventCount: events.filter((event) => event.outcome === 'failed').length,
      degradedEventCount: events.filter((event) => event.outcome === 'degraded').length
    },
    blockers,
    warnings,
    nextAction: blockers.length
      ? externalWriteActionForDiagnostic(blockers[0])
      : warnings.length
        ? 'review_external_write_timeline_publication'
        : writeRequired
          ? 'publish_external_write_timeline'
          : 'continue_read_only',
    digest: timelineDigest
  };
}

function validateExternalWriteTimelinePublicationContract(publication, writeEffects) {
  if (!writeEffects.length && !publication) return [];
  const diagnostics = [];
  if (!publication) return [{ level: 'error', code: 'external_write_missing_timeline_publication' }];
  if (writeEffects.length && publication.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_timeline_publication_not_write_required' });
  }
  if (writeEffects.length && !publication.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_timeline_publication_missing_digest' });
  }
  if (writeEffects.length && !publication.events?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_timeline_publication_missing_events' });
  }
  if (writeEffects.length && !publication.snapshots?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_timeline_publication_missing_snapshots' });
  }
  if (writeEffects.length && !publication.publishCommand?.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_timeline_publication_missing_command' });
  }
  if (publication.ready && publication.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_timeline_publication_ready_with_blockers', blockers: publication.blockers });
  }
  if (publication.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_timeline_publication_blocked', blockers: publication.blockers ?? [] });
  }
  if (publication.state === 'review' || publication.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'external_write_timeline_publication_review', warnings: publication.warnings ?? [] });
  }
  return diagnostics;
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

function buildExternalWriteRouteExportState({
  programId,
  operation,
  status,
  writeEffects,
  route,
  providerCommand,
  clientRequestSnapshot,
  acceptancePacket,
  exportLedger,
  replayManifest,
  operatorReadiness,
  operationalHealth,
  analyticsExport,
  analyticsPublication,
  timelinePublication,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const accepted = acceptancePacket?.acceptEnabled === true
    && !(acceptancePacket?.missingAcknowledgements?.length);
  const snapshots = [
    routeExportSnapshot('accepted_preview', acceptancePacket?.acceptanceState, acceptancePacket?.digest, {
      acceptEnabled: acceptancePacket?.acceptEnabled === true,
      missingAcknowledgementCount: acceptancePacket?.missingAcknowledgements?.length ?? 0,
      nextAction: acceptancePacket?.nextAction ?? null
    }),
    routeExportSnapshot('operator_readiness', operatorReadiness?.state, operatorReadiness?.digest, {
      ready: operatorReadiness?.ready === true,
      primaryAction: operatorReadiness?.primaryAction ?? null,
      nextStepCount: operatorReadiness?.nextSteps?.length ?? 0
    }),
    routeExportSnapshot('analytics_export', analyticsExport?.state, analyticsExport?.digest, {
      ready: analyticsExport?.ready === true,
      failedPhaseCount: analyticsExport?.counters?.failedPhaseCount ?? 0,
      degradedPhaseCount: analyticsExport?.counters?.degradedPhaseCount ?? 0
    }),
    routeExportSnapshot('analytics_publication', analyticsPublication?.state, analyticsPublication?.digest, {
      ready: analyticsPublication?.ready === true,
      publishCommandId: analyticsPublication?.publishCommand?.commandId ?? null,
      targetCount: analyticsPublication?.targets?.length ?? 0,
      missingAcknowledgementCount: analyticsPublication?.acknowledgements?.missing?.length ?? 0
    }),
    routeExportSnapshot('timeline_publication', timelinePublication?.state, timelinePublication?.digest, {
      ready: timelinePublication?.ready === true,
      publishCommandId: timelinePublication?.publishCommand?.commandId ?? null,
      eventCount: timelinePublication?.events?.length ?? 0,
      snapshotCount: timelinePublication?.snapshots?.length ?? 0,
      changedSinceAcceptedSnapshot: timelinePublication?.drift?.changedSinceAcceptedSnapshot === true
    }),
    routeExportSnapshot('export_ledger', exportLedger?.state, exportLedger?.digest, {
      ready: exportLedger?.ready === true,
      changedSinceKernelSnapshot: exportLedger?.changedSinceKernelSnapshot === true,
      latestCheckpoint: exportLedger?.latestCheckpoint?.phase ?? null
    }),
    routeExportSnapshot('replay_manifest', replayManifest?.state, replayManifest?.digest, {
      ready: replayManifest?.ready === true,
      restartSafe: replayManifest?.restartSafe === true,
      commandCount: replayManifest?.commands?.length ?? 0
    })
  ];
  const blockers = uniqueSorted([
    ...(analyticsExport?.blockers ?? []).map((blocker) => `analytics_${blocker}`),
    ...(exportLedger?.blockers ?? []).map((blocker) => `export_ledger_${blocker}`),
    ...(replayManifest?.blockers ?? []).map((blocker) => `replay_${blocker}`),
    ...(operatorReadiness?.blockers ?? []).map((blocker) => `operator_${blocker}`),
    ...(operationalHealth?.actionableErrors ?? []).map((error) => error.code ?? error).filter(Boolean),
    ...(writeRequired && !accepted ? ['route_export_acceptance_not_enabled'] : []),
    ...(writeRequired && !providerCommand?.commandId ? ['route_export_missing_provider_command_id'] : []),
    ...(writeRequired && !route?.statusChannel ? ['route_export_missing_status_channel'] : []),
    ...(writeRequired && !analyticsExport?.digest ? ['route_export_missing_analytics_digest'] : []),
    ...(writeRequired && !analyticsPublication?.digest ? ['route_export_missing_analytics_publication_digest'] : []),
    ...(writeRequired && analyticsPublication?.state === 'blocked' ? ['route_export_analytics_publication_blocked'] : []),
    ...(timelinePublication?.blockers ?? []).map((blocker) => `timeline_${blocker}`),
    ...(writeRequired && !timelinePublication?.digest ? ['route_export_missing_timeline_publication_digest'] : []),
    ...(writeRequired && !timelinePublication?.publishCommand?.commandId ? ['route_export_missing_timeline_publication_command'] : []),
    ...(writeRequired && !exportLedger?.digest ? ['route_export_missing_ledger_digest'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(analyticsExport?.warnings ?? []).map((warning) => `analytics_${warning}`),
    ...(analyticsPublication?.warnings ?? []).map((warning) => `analytics_publication_${warning}`),
    ...(timelinePublication?.warnings ?? []).map((warning) => `timeline_${warning}`),
    ...(exportLedger?.warnings ?? []).map((warning) => `export_ledger_${warning}`),
    ...(operatorReadiness?.warnings ?? []).map((warning) => `operator_${warning}`),
    ...(operationalHealth?.degraded ? ['operational_health_degraded'] : []),
    ...(exportLedger?.changedSinceKernelSnapshot ? ['export_ledger_changed_since_kernel_snapshot'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'review'
      : writeRequired
        ? 'ready'
        : 'not_required';
  const acceptanceDigest = stableHash({
    programId,
    operation,
    acceptanceState: acceptancePacket?.acceptanceState ?? null,
    acceptEnabled: acceptancePacket?.acceptEnabled === true,
    missingAcknowledgements: acceptancePacket?.missingAcknowledgements ?? [],
    operatorReadinessDigest: operatorReadiness?.digest ?? null
  });
  const exportDigest = stableHash({
    programId,
    operation,
    analyticsDigest: analyticsExport?.digest ?? null,
    analyticsPublicationDigest: analyticsPublication?.digest ?? null,
    timelinePublicationDigest: timelinePublication?.digest ?? null,
    exportLedgerDigest: exportLedger?.digest ?? null,
    replayDigest: replayManifest?.digest ?? null,
    clientRequestDigest: clientRequestSnapshot?.digest ?? null
  });
  const changedSinceAcceptedSnapshot = exportLedger?.changedSinceKernelSnapshot === true
    || analyticsExport?.reporting?.changedSinceKernelSnapshot === true;
  const publishCommand = {
    type: 'mailchimp.external_write.route_export.publish',
    ready: state === 'ready' || state === 'not_required',
    commandId: writeRequired
      ? `route-export:${stableHash({ programId, operation, exportDigest, statusChannel: route?.statusChannel ?? null })}`
      : null,
    idempotencyKey: writeRequired
      ? stableHash({
          action: 'publish_external_write_route_export',
          commandId: providerCommand?.commandId ?? null,
          routeKey: route?.routeKey ?? null,
          exportDigest
        })
      : null,
    statusAfterPublish: state === 'ready' ? 'mailchimp_route_export_ready' : state,
    requiredInputs: ['programId', 'operation', 'statusChannel', 'analyticsDigest', 'exportLedgerDigest']
      .filter((name) => writeRequired || name === 'programId' || name === 'operation')
  };
  const timeline = snapshots.map((snapshot, index) => ({
    sequence: index + 1,
    phase: snapshot.phase,
    status: snapshot.status,
    digest: snapshot.digest,
    changed: index === 0 ? false : snapshots[index - 1]?.digest !== snapshot.digest
  }));
  const digest = stableHash({
    programId,
    operation,
    state,
    acceptanceDigest,
    exportDigest,
    changedSinceAcceptedSnapshot,
    publishCommandId: publishCommand.commandId,
    snapshots: snapshots.map((snapshot) => `${snapshot.phase}:${snapshot.digest}`),
    blockers,
    warnings
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.route-export-state`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    status: status ?? 'unknown',
    routeKey: route?.routeKey ?? null,
    statusChannel: route?.statusChannel ?? null,
    auditChannel: route?.auditChannel ?? null,
    commandId: providerCommand?.commandId ?? null,
    idempotencyKey: route?.idempotencyKey ?? null,
    requestKey: clientRequestSnapshot?.requestKey ?? null,
    acceptanceDigest,
    exportDigest,
    analyticsPublication: {
      state: analyticsPublication?.state ?? 'unknown',
      ready: analyticsPublication?.ready === true,
      digest: analyticsPublication?.digest ?? null,
      publishCommandId: analyticsPublication?.publishCommand?.commandId ?? null,
      targetCount: analyticsPublication?.targets?.length ?? 0,
      nextAction: analyticsPublication?.nextAction ?? null
    },
    timelinePublication: {
      state: timelinePublication?.state ?? 'unknown',
      ready: timelinePublication?.ready === true,
      digest: timelinePublication?.digest ?? null,
      publishCommandId: timelinePublication?.publishCommand?.commandId ?? null,
      eventCount: timelinePublication?.events?.length ?? 0,
      snapshotCount: timelinePublication?.snapshots?.length ?? 0,
      changedSinceAcceptedSnapshot: timelinePublication?.drift?.changedSinceAcceptedSnapshot === true,
      nextAction: timelinePublication?.nextAction ?? null
    },
    latestKernelSnapshotDigest: kernelCall?.history?.latest?.digest ?? kernelCall?.analytics?.history?.latest?.digest ?? null,
    changedSinceAcceptedSnapshot,
    publishCommand,
    snapshots,
    timeline,
    blockers,
    warnings,
    nextAction: blockers.length
      ? externalWriteActionForDiagnostic(blockers[0])
      : warnings.length
        ? 'review_external_write_route_export'
        : writeRequired
          ? 'publish_external_write_route_export'
          : 'continue_read_only',
    digest
  };
}

function routeExportSnapshot(phase, status, digest, detail = {}) {
  return {
    id: `route-export:${stableHash({ phase, status, digest, detail })}`,
    phase,
    status: status ?? 'unknown',
    digest: digest ?? stableHash({ phase, status, detail }),
    detail: stableClone(detail)
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
  if (writeEffects.length && !analyticsExport.operatorDecision?.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_missing_operator_decision' });
  }
  if (analyticsExport.operatorDecision?.ready && !analyticsExport.operatorDecision?.command?.commandId && writeEffects.length) {
    diagnostics.push({ level: 'error', code: 'external_write_operator_decision_missing_command_id' });
  }
  if (analyticsExport.operatorDecision?.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_operator_decision_blocked',
      blockers: analyticsExport.operatorDecision.blockers ?? []
    });
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

function validateExternalWriteAnalyticsPublicationContract(publication, writeEffects) {
  if (!writeEffects.length && !publication) return [];
  const diagnostics = [];
  if (!publication) return [{ level: 'error', code: 'external_write_missing_analytics_publication' }];
  if (writeEffects.length && publication.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_publication_not_write_required' });
  }
  if (!publication.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_publication_missing_digest' });
  }
  if (writeEffects.length && !publication.analyticsDigest) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_publication_missing_analytics_digest' });
  }
  if (writeEffects.length && !publication.publishCommand?.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_publication_missing_publish_command' });
  }
  if (writeEffects.length && !publication.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_publication_missing_status_channel' });
  }
  if (writeEffects.length && !publication.targets?.some((target) => target.required && target.ready)) {
    diagnostics.push({ level: 'error', code: 'external_write_analytics_publication_missing_ready_target' });
  }
  if (publication.ready && publication.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_analytics_publication_ready_with_blockers',
      blockers: publication.blockers
    });
  }
  if (publication.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_analytics_publication_blocked',
      blockers: publication.blockers ?? []
    });
  }
  if (publication.acknowledgements?.missing?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_analytics_publication_missing_acknowledgements',
      missingAcknowledgements: publication.acknowledgements.missing
    });
  }
  if (publication.state === 'review' || publication.warnings?.length) {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_analytics_publication_review',
      warnings: publication.warnings ?? []
    });
  }
  if (publication.freshness?.changedSinceKernelSnapshot && publication.ready) {
    diagnostics.push({ level: 'warning', code: 'external_write_analytics_publication_changed_since_kernel_snapshot' });
  }
  return diagnostics;
}

function validateExternalWriteRouteExportState(routeExportState, writeEffects) {
  if (!writeEffects.length && !routeExportState) return [];
  const diagnostics = [];
  if (!routeExportState) return [{ level: 'error', code: 'external_write_missing_route_export_state' }];
  if (writeEffects.length && routeExportState.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_route_export_not_write_required' });
  }
  if (!routeExportState.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_route_export_missing_digest' });
  }
  if (writeEffects.length && !routeExportState.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_route_export_missing_status_channel' });
  }
  if (writeEffects.length && !routeExportState.publishCommand?.commandId) {
    diagnostics.push({ level: 'error', code: 'external_write_route_export_missing_publish_command' });
  }
  if (routeExportState.ready && routeExportState.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_route_export_ready_with_blockers',
      blockers: routeExportState.blockers
    });
  }
  if (routeExportState.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_route_export_blocked',
      blockers: routeExportState.blockers ?? []
    });
  }
  if (!routeExportState.snapshots?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_route_export_missing_snapshots' });
  }
  if (!routeExportState.timeline?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_route_export_missing_timeline' });
  }
  if (routeExportState.changedSinceAcceptedSnapshot && routeExportState.state === 'ready') {
    diagnostics.push({ level: 'warning', code: 'external_write_route_export_changed_since_acceptance' });
  }
  return diagnostics;
}

function buildExternalWriteResumeCursor({
  programId,
  operation,
  status,
  writeEffects,
  route,
  providerCommand,
  persistedStatus,
  statusJournal,
  providerCommandLedger,
  persistenceEnvelope,
  exportLedger,
  replayManifest,
  analyticsExport,
  routeExportState,
  clientRequestSnapshot,
  clientRuntimeAdoptionReceipt,
  operationalHealth,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const resumePointer = persistenceEnvelope?.resumePointer
    ?? persistedStatus?.resumePointer
    ?? statusJournal?.latestCheckpoint?.phase
    ?? routeExportState?.publishCommand?.commandId
    ?? null;
  const commandId = providerCommandLedger?.activeCommandId
    ?? providerCommand?.commandId
    ?? persistedStatus?.commandId
    ?? routeExportState?.commandId
    ?? null;
  const statusChannel = routeExportState?.statusChannel
    ?? persistedStatus?.statusChannel
    ?? route?.statusChannel
    ?? null;
  const restartToken = persistedStatus?.restartToken
    ?? kernelCall?.runtimeState?.profileRestartToken
    ?? kernelCall?.runtimeState?.restartToken
    ?? null;
  const ledgerDigest = providerCommandLedger?.digest ?? exportLedger?.digest ?? null;
  const envelopeDigest = persistenceEnvelope?.digest ?? null;
  const routeDigest = routeExportState?.digest ?? null;
  const analyticsDigest = analyticsExport?.digest ?? null;
  const replayDigest = replayManifest?.digest ?? null;
  const clientRequestDigest = clientRequestSnapshot?.digest ?? null;
  const clientReceiptDigest = clientRuntimeAdoptionReceipt?.digest ?? null;
  const latestKernelSnapshotDigest = kernelCall?.history?.latest?.digest
    ?? kernelCall?.analytics?.history?.latest?.digest
    ?? null;
  const checkpoints = [
    resumeCheckpoint('persisted_status', persistedStatus?.state, persistedStatus?.digest, {
      restartToken,
      statusChannel,
      commandId: persistedStatus?.commandId ?? null
    }),
    resumeCheckpoint('status_journal', statusJournal?.state, statusJournal?.digest, {
      latestCheckpoint: statusJournal?.latestCheckpoint?.phase ?? null,
      commandCount: statusJournal?.commands?.length ?? 0,
      restartPolicy: statusJournal?.restartSemantics?.onRestart ?? null
    }),
    resumeCheckpoint('provider_command_ledger', providerCommandLedger?.state, providerCommandLedger?.digest, {
      activeCommandId: providerCommandLedger?.activeCommandId ?? providerCommand?.commandId ?? null,
      duplicateSafe: providerCommandLedger?.duplicateSafe === true,
      replayable: providerCommandLedger?.replayable === true
    }),
    resumeCheckpoint('persistence_envelope', persistenceEnvelope?.state, persistenceEnvelope?.digest, {
      resumePointer,
      manifestDigest: persistenceEnvelope?.manifestDigest ?? null,
      restartSafe: persistenceEnvelope?.restartSemantics?.restartSafe === true
    }),
    resumeCheckpoint('route_export', routeExportState?.state, routeDigest, {
      publishCommandId: routeExportState?.publishCommand?.commandId ?? null,
      changedSinceAcceptedSnapshot: routeExportState?.changedSinceAcceptedSnapshot === true
    }),
    resumeCheckpoint('analytics_export', analyticsExport?.state, analyticsDigest, {
      latestSnapshotId: analyticsExport?.reporting?.latestSnapshotId ?? null,
      failedPhaseCount: analyticsExport?.counters?.failedPhaseCount ?? 0,
      degradedPhaseCount: analyticsExport?.counters?.degradedPhaseCount ?? 0
    }),
    resumeCheckpoint('client_runtime', clientRequestSnapshot?.state, clientRequestDigest, {
      requestKey: clientRequestSnapshot?.requestKey ?? null,
      receiptDigest: clientReceiptDigest
    })
  ];
  const blockers = uniqueSorted([
    ...(writeRequired && !commandId ? ['resume_cursor_missing_command_id'] : []),
    ...(writeRequired && !statusChannel ? ['resume_cursor_missing_status_channel'] : []),
    ...(writeRequired && !resumePointer ? ['resume_cursor_missing_resume_pointer'] : []),
    ...(writeRequired && !restartToken ? ['resume_cursor_missing_restart_token'] : []),
    ...(writeRequired && !ledgerDigest ? ['resume_cursor_missing_ledger_digest'] : []),
    ...(writeRequired && !envelopeDigest ? ['resume_cursor_missing_envelope_digest'] : []),
    ...(writeRequired && !routeDigest ? ['resume_cursor_missing_route_digest'] : []),
    ...(writeRequired && !analyticsDigest ? ['resume_cursor_missing_analytics_digest'] : []),
    ...(writeRequired && persistenceEnvelope?.restartSemantics?.restartSafe === false ? ['resume_cursor_envelope_not_restart_safe'] : []),
    ...(writeRequired && providerCommandLedger?.duplicateSafe === false ? ['resume_cursor_command_not_duplicate_safe'] : []),
    ...(writeRequired && providerCommandLedger?.replayable === false ? ['resume_cursor_command_not_replayable'] : []),
    ...(writeRequired && routeExportState?.changedSinceAcceptedSnapshot ? ['resume_cursor_route_export_changed_since_acceptance'] : []),
    ...(operationalHealth?.failureState === 'terminal' ? ['resume_cursor_terminal_operational_failure'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(analyticsExport?.warnings ?? []).map((warning) => `analytics_${warning}`),
    ...(routeExportState?.warnings ?? []).map((warning) => `route_export_${warning}`),
    ...(operationalHealth?.degraded ? ['operational_health_degraded'] : []),
    ...(latestKernelSnapshotDigest && latestKernelSnapshotDigest !== exportLedger?.digest ? ['kernel_snapshot_differs_from_export_ledger'] : [])
  ]);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const cursorKey = stableHash({
    programId,
    operation,
    commandId,
    statusChannel,
    resumePointer,
    restartToken,
    ledgerDigest,
    envelopeDigest,
    routeDigest,
    analyticsDigest,
    replayDigest,
    clientRequestDigest,
    clientReceiptDigest
  });
  const digest = stableHash({
    state,
    cursorKey,
    checkpoints: checkpoints.map((checkpoint) => `${checkpoint.phase}:${checkpoint.digest}`),
    blockers,
    warnings
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.resume-cursor`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    status: status ?? 'unknown',
    cursorKey,
    commandId,
    idempotencyKey: route?.idempotencyKey ?? persistedStatus?.idempotencyKey ?? null,
    statusChannel,
    restartToken,
    resumePointer,
    routeKey: route?.routeKey ?? null,
    digestVector: {
      persistedStatus: persistedStatus?.digest ?? null,
      statusJournal: statusJournal?.digest ?? null,
      providerCommandLedger: providerCommandLedger?.digest ?? null,
      persistenceEnvelope: envelopeDigest,
      exportLedger: exportLedger?.digest ?? null,
      replayManifest: replayDigest,
      routeExport: routeDigest,
      analyticsExport: analyticsDigest,
      clientRequest: clientRequestDigest,
      clientAdoptionReceipt: clientReceiptDigest,
      latestKernelSnapshot: latestKernelSnapshotDigest
    },
    restartSemantics: {
      restartSafe: state !== 'blocked',
      onRestart: state === 'ready'
        ? 'resume_from_external_write_cursor'
        : state === 'review'
          ? 'review_external_write_cursor_before_resume'
          : state === 'not_required'
            ? 'continue_read_only'
            : 'repair_external_write_cursor',
      onDuplicateCommand: providerCommandLedger?.duplicateSafe === false
        ? 'block_duplicate_provider_command'
        : 'return_existing_provider_command',
      onStaleSnapshot: routeExportState?.changedSinceAcceptedSnapshot
        ? 'rebuild_route_export_before_resume'
        : 'reuse_latest_route_export_snapshot'
    },
    checkpoints,
    blockers,
    warnings,
    nextAction: blockers.length
      ? externalWriteActionForDiagnostic(blockers[0])
      : warnings.length
        ? 'review_external_write_resume_cursor'
        : writeRequired
          ? 'persist_external_write_resume_cursor'
          : 'continue_read_only',
    digest
  };
}

function resumeCheckpoint(phase, state, digest, detail = {}) {
  return {
    id: `resume-cursor:${stableHash({ phase, state, digest, detail })}`,
    phase,
    state: state ?? 'unknown',
    digest: digest ?? null,
    ready: Boolean(digest) || state === 'not_required',
    detail: stableClone(detail)
  };
}

function validateExternalWriteResumeCursor(resumeCursor, writeEffects) {
  if (!writeEffects.length && !resumeCursor) return [];
  const diagnostics = [];
  if (!resumeCursor) return [{ level: 'error', code: 'external_write_missing_resume_cursor' }];
  if (writeEffects.length && resumeCursor.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_resume_cursor_not_write_required' });
  }
  if (!resumeCursor.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_resume_cursor_missing_digest' });
  }
  if (writeEffects.length && !resumeCursor.cursorKey) {
    diagnostics.push({ level: 'error', code: 'external_write_resume_cursor_missing_key' });
  }
  if (writeEffects.length && !resumeCursor.resumePointer) {
    diagnostics.push({ level: 'error', code: 'external_write_resume_cursor_missing_pointer' });
  }
  if (writeEffects.length && !resumeCursor.restartToken) {
    diagnostics.push({ level: 'warning', code: 'external_write_resume_cursor_missing_restart_token' });
  }
  if (writeEffects.length && !resumeCursor.digestVector?.persistenceEnvelope) {
    diagnostics.push({ level: 'error', code: 'external_write_resume_cursor_missing_envelope_digest' });
  }
  if (writeEffects.length && !resumeCursor.digestVector?.routeExport) {
    diagnostics.push({ level: 'error', code: 'external_write_resume_cursor_missing_route_digest' });
  }
  if (resumeCursor.ready && resumeCursor.blockers?.length) {
    diagnostics.push({
      level: 'error',
      code: 'external_write_resume_cursor_ready_with_blockers',
      blockers: resumeCursor.blockers
    });
  }
  if (resumeCursor.state === 'blocked') {
    diagnostics.push({
      level: 'error',
      code: 'external_write_resume_cursor_blocked',
      blockers: resumeCursor.blockers ?? []
    });
  }
  if (!resumeCursor.checkpoints?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_resume_cursor_missing_checkpoints' });
  }
  if (resumeCursor.state === 'review' || resumeCursor.warnings?.length) {
    diagnostics.push({
      level: 'warning',
      code: 'external_write_resume_cursor_review',
      warnings: resumeCursor.warnings ?? []
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

function buildExternalWriteAcceptanceCheckpointBundle({
  programId,
  operation,
  status,
  writeEffects,
  route,
  acceptancePacket,
  operatorReadiness,
  operatorHandoffManifest,
  operatorDecision,
  statusHandoff,
  routeExportState,
  resumeCursor,
  boundaryDecisionReceipt,
  boundaryReleaseGate,
  clientRuntimeAdoptionReceipt,
  analyticsPublication,
  kernelCall
}) {
  const writeRequired = writeEffects.length > 0;
  const checkpoints = [
    acceptanceCheckpoint('preview_acceptance', acceptancePacket?.state, acceptancePacket?.digest, {
      commandId: acceptancePacket?.commandId ?? acceptancePacket?.acceptCommand?.commandId,
      ready: acceptancePacket?.ready === true || !writeRequired,
      restartSafe: acceptancePacket?.restartSemantics?.restartSafe !== false,
      blockers: acceptancePacket?.blockers ?? [],
      warnings: acceptancePacket?.warnings ?? []
    }),
    acceptanceCheckpoint('operator_readiness', operatorReadiness?.state, operatorReadiness?.digest, {
      commandId: operatorReadiness?.commandId ?? operatorReadiness?.command?.commandId,
      ready: operatorReadiness?.ready === true || !writeRequired,
      restartSafe: operatorReadiness?.restartSemantics?.restartSafe !== false,
      blockers: operatorReadiness?.blockers ?? [],
      warnings: operatorReadiness?.warnings ?? []
    }),
    acceptanceCheckpoint('operator_handoff_manifest', operatorHandoffManifest?.state, operatorHandoffManifest?.digest, {
      commandId: operatorHandoffManifest?.command?.commandId,
      ready: operatorHandoffManifest?.ready === true || !writeRequired,
      restartSafe: operatorHandoffManifest?.restartSemantics?.restartSafe !== false,
      blockers: operatorHandoffManifest?.blockers ?? [],
      warnings: operatorHandoffManifest?.warnings ?? []
    }),
    acceptanceCheckpoint('operator_decision', operatorDecision?.state, operatorDecision?.digest, {
      commandId: operatorDecision?.command?.commandId,
      ready: operatorDecision?.ready === true || !writeRequired,
      restartSafe: operatorDecision?.restartSemantics?.restartSafe !== false,
      blockers: [
        ...(operatorDecision?.blockers ?? []),
        ...(writeRequired && !operatorDecision?.digest ? ['missing_operator_decision_digest'] : [])
      ],
      warnings: operatorDecision?.warnings ?? []
    }),
    acceptanceCheckpoint('boundary_decision_receipt', boundaryDecisionReceipt?.state, boundaryDecisionReceipt?.receiptDigest, {
      commandId: boundaryDecisionReceipt?.command?.commandId,
      ready: boundaryDecisionReceipt?.ready === true || !writeRequired,
      restartSafe: boundaryDecisionReceipt?.restartSemantics?.restartSafe !== false,
      blockers: [
        ...(boundaryDecisionReceipt?.blockers ?? []),
        ...(writeRequired && boundaryDecisionReceipt?.release?.allowed === false ? ['boundary_release_not_allowed'] : [])
      ],
      warnings: boundaryDecisionReceipt?.warnings ?? []
    }),
    acceptanceCheckpoint('boundary_release_gate', boundaryReleaseGate?.state, boundaryReleaseGate?.gateDigest, {
      commandId: boundaryReleaseGate?.command?.commandId,
      ready: boundaryReleaseGate?.ready === true || !writeRequired,
      restartSafe: boundaryReleaseGate?.restartSemantics?.restartSafe !== false,
      blockers: boundaryReleaseGate?.blockers ?? [],
      warnings: boundaryReleaseGate?.warnings ?? []
    }),
    acceptanceCheckpoint('client_runtime_adoption_receipt', clientRuntimeAdoptionReceipt?.state, clientRuntimeAdoptionReceipt?.digest, {
      commandId: clientRuntimeAdoptionReceipt?.commandId ?? clientRuntimeAdoptionReceipt?.command?.commandId,
      ready: clientRuntimeAdoptionReceipt?.ready === true || !writeRequired,
      restartSafe: clientRuntimeAdoptionReceipt?.restartSemantics?.restartSafe !== false,
      blockers: clientRuntimeAdoptionReceipt?.blockers ?? [],
      warnings: clientRuntimeAdoptionReceipt?.warnings ?? []
    }),
    acceptanceCheckpoint('status_handoff', statusHandoff?.state, statusHandoff?.digest, {
      commandId: statusHandoff?.commandId ?? statusHandoff?.command?.commandId,
      ready: statusHandoff?.ready === true || !writeRequired,
      restartSafe: statusHandoff?.restartSemantics?.restartSafe !== false,
      blockers: statusHandoff?.blockers ?? [],
      warnings: statusHandoff?.warnings ?? []
    }),
    acceptanceCheckpoint('route_export', routeExportState?.state, routeExportState?.digest, {
      commandId: routeExportState?.publishCommand?.commandId,
      ready: routeExportState?.ready === true || !writeRequired,
      restartSafe: routeExportState?.restartSemantics?.restartSafe !== false,
      blockers: routeExportState?.blockers ?? [],
      warnings: routeExportState?.warnings ?? []
    }),
    acceptanceCheckpoint('analytics_publication', analyticsPublication?.state, analyticsPublication?.digest, {
      commandId: analyticsPublication?.publishCommand?.commandId,
      ready: analyticsPublication?.ready === true || !writeRequired,
      restartSafe: analyticsPublication?.restartSemantics?.restartSafe !== false,
      blockers: analyticsPublication?.blockers ?? [],
      warnings: analyticsPublication?.freshness?.warnings ?? analyticsPublication?.warnings ?? []
    }),
    acceptanceCheckpoint('resume_cursor', resumeCursor?.state, resumeCursor?.digest, {
      commandId: resumeCursor?.commandId ?? resumeCursor?.command?.commandId,
      ready: resumeCursor?.ready === true || !writeRequired,
      restartSafe: resumeCursor?.restartSemantics?.restartSafe !== false,
      blockers: resumeCursor?.blockers ?? [],
      warnings: resumeCursor?.warnings ?? []
    })
  ];
  const blockers = uniqueSorted(checkpoints.flatMap((checkpoint) => (
    checkpoint.ready ? [] : checkpoint.blockers.length ? checkpoint.blockers.map((blocker) => `${checkpoint.phase}_${blocker}`) : [`${checkpoint.phase}_not_ready`]
  )));
  const warnings = uniqueSorted(checkpoints.flatMap((checkpoint) => checkpoint.warnings.map((warning) => `${checkpoint.phase}_${warning}`)));
  const digestSet = uniqueSorted(checkpoints.map((checkpoint) => checkpoint.digest).filter(Boolean));
  const commandIds = uniqueSorted(checkpoints.map((checkpoint) => checkpoint.commandId).filter(Boolean));
  const restartSafe = checkpoints.every((checkpoint) => checkpoint.restartSafe || !writeRequired);
  const aligned = checkpoints.every((checkpoint) => checkpoint.ready || !writeRequired)
    && restartSafe
    && Boolean(route?.statusChannel ?? kernelCall?.handoff?.statusChannel)
    && (!writeRequired || digestSet.length >= 4);
  const state = !writeRequired
    ? 'not_required'
    : blockers.length
      ? 'blocked'
      : warnings.length
        ? 'review'
        : 'ready';
  const digest = stableHash({
    programId,
    operation,
    state,
    status,
    statusChannel: route?.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null,
    digestSet,
    commandIds,
    restartSafe,
    aligned,
    blockers,
    warnings
  });
  return {
    schemaVersion: `${EXTERNAL_WRITE_ANALYSIS_VERSION}.acceptance-checkpoints`,
    programId,
    operation,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    aligned,
    restartSafe,
    statusChannel: route?.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
    idempotencyKey: route?.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null,
    commandId: commandIds[0] ?? null,
    commandIds,
    digestSet,
    checkpoints,
    blockers,
    warnings,
    nextAction: blockers.length
      ? acceptanceCheckpointAction(blockers[0])
      : warnings.length
        ? acceptanceCheckpointAction(warnings[0])
        : writeRequired
          ? 'publish_acceptance_checkpoint_bundle'
          : 'continue_read_only',
    digest
  };
}

function acceptanceCheckpoint(phase, state, digest, {
  commandId = null,
  ready = false,
  restartSafe = false,
  blockers = [],
  warnings = []
} = {}) {
  return {
    phase,
    state: state ?? 'unknown',
    digest: digest ?? null,
    commandId: commandId ?? null,
    ready: ready === true,
    restartSafe: restartSafe === true,
    blockers: uniqueSorted(blockers),
    warnings: uniqueSorted(warnings)
  };
}

function validateExternalWriteAcceptanceCheckpointBundle(bundle, writeEffects) {
  if (!writeEffects.length && !bundle) return [];
  const diagnostics = [];
  if (!bundle) return [{ level: 'error', code: 'external_write_missing_acceptance_checkpoint_bundle' }];
  if (writeEffects.length && bundle.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_checkpoint_not_write_required' });
  }
  if (bundle.ready && bundle.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_checkpoint_ready_with_blockers', blockers: bundle.blockers });
  }
  if (bundle.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_checkpoint_blocked', blockers: bundle.blockers ?? [] });
  }
  if (writeEffects.length && !bundle.digest) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_checkpoint_missing_digest' });
  }
  if (writeEffects.length && !bundle.statusChannel) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_checkpoint_missing_status_channel' });
  }
  if (writeEffects.length && !bundle.commandIds?.length) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_checkpoint_missing_command' });
  }
  if (writeEffects.length && bundle.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'external_write_acceptance_checkpoint_not_restart_safe' });
  }
  if (writeEffects.length && bundle.aligned !== true) {
    diagnostics.push({ level: 'warning', code: 'external_write_acceptance_checkpoint_not_fully_aligned' });
  }
  return diagnostics;
}

function acceptanceCheckpointAction(blocker) {
  if (String(blocker).includes('operator_decision')) return 'publish_external_write_operator_decision';
  if (String(blocker).includes('operator_handoff')) return 'publish_operator_handoff_manifest';
  if (String(blocker).includes('boundary_release')) return 'repair_boundary_release_decision';
  if (String(blocker).includes('boundary_decision')) return 'publish_boundary_decision_receipt';
  if (String(blocker).includes('client_runtime')) return 'persist_client_runtime_adoption_receipt';
  if (String(blocker).includes('status_handoff')) return 'publish_external_write_status_handoff';
  if (String(blocker).includes('route_export')) return 'publish_external_write_route_export';
  if (String(blocker).includes('analytics')) return 'publish_external_write_analytics';
  if (String(blocker).includes('resume_cursor')) return 'persist_external_write_resume_cursor';
  if (String(blocker).includes('restart_safe')) return 'repair_restart_safe_acceptance_bundle';
  return 'publish_acceptance_checkpoint_bundle';
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
