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
    persistedState: summarizePersistedProviderState(ir?.persistedState),
    clientHandoff: summarizeKernelClientRuntimeHandoffPacket(ir?.clientHandoff),
    clientRuntimeState: summarizeClientRuntimeState(ir?.preview?.runtimeWorkflow?.clientRuntimeState),
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
    recoveryLifecycleCommandReadyCount: ir?.semantic?.recovery?.analyticsSummary?.lifecycleCommandState?.ready ? 1 : 0,
    recoveryLifecycleCommandCount: ir?.semantic?.recovery?.analyticsSummary?.lifecycleCommandState?.commands?.length ?? 0
  };
  const statusRecovery = buildKernelStatusRecoveryReport(ir);
  counters.persistedExternalWriteReadyCount = statusRecovery.persistedExternalWrite.ready ? 1 : 0;
  counters.restartRecoveryReadyCount = statusRecovery.restartRecovery.ready ? 1 : 0;
  counters.statusRecoveryBlockerCount = statusRecovery.blockers.length;
  counters.statusRecoveryTimelineEventCount = statusRecovery.timeline.length;
  counters.providerServiceReadyCount = ir?.provider?.ready ? 1 : 0;
  counters.providerServiceBlockerCount = ir?.provider?.blockers?.length ?? 0;
  counters.providerServiceWarningCount = ir?.provider?.warnings?.length ?? 0;
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
      exportable: ir?.lifecycle?.exportable ?? false
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
    ...buildMissingClaimErrors(ir)
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
  const blockers = uniqueSorted([
    ...(input.blockers ?? []),
    ...deniedEffects.map((effect) => `provider_denied:${effect}`),
    ...missingEffects.map((effect) => `provider_missing_effect:${effect}`),
    ...(!endpoint ? ['provider_missing_endpoint'] : []),
    ...(!statusChannel ? ['provider_missing_status_channel'] : []),
    ...(status === 'blocked' ? ['provider_blocked'] : []),
    ...(status === 'unavailable' ? ['provider_unavailable'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(input.warnings ?? []),
    ...(status === 'degraded' ? ['provider_degraded'] : []),
    ...(ir?.lifecycle?.state === 'degraded' ? ['lifecycle_degraded'] : [])
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
    retryable: provider?.health?.retryable ?? false,
    missingEffects: provider?.negotiation?.missingEffects ?? [],
    blockerCount: provider?.blockers?.length ?? 0,
    warningCount: provider?.warnings?.length ?? 0,
    nextAction: provider?.nextAction ?? null
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
    operatorActionCard,
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
      operatorActionCardReadyCount: operatorActionCard.ready ? 1 : 0,
      operatorActionCardBlockerCount: operatorActionCard.blockers.length,
      operatorActionCardWarningCount: operatorActionCard.warnings.length,
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
    nextAction: preview?.nextSteps?.[0]?.action ?? preview?.acceptance?.nextAction ?? null,
    operatorActionCard: {
      state: preview?.operatorActionCard?.state ?? 'unknown',
      ready: preview?.operatorActionCard?.ready ?? false,
      primaryAction: preview?.operatorActionCard?.primaryAction ?? null,
      digest: preview?.operatorActionCard?.digest ?? null,
      commandId: preview?.operatorActionCard?.commandId ?? null,
      blockerCount: preview?.operatorActionCard?.blockers?.length ?? 0,
      warningCount: preview?.operatorActionCard?.warnings?.length ?? 0
    },
    runtimeWorkflow: summarizeRuntimeWorkflowHandoff(preview?.runtimeWorkflow),
    blockingReasons: preview?.readiness?.blockingReasons ?? [],
    warningReasons: preview?.readiness?.warningReasons ?? [],
    validation: preview?.validationSummary ?? { errorCount: 0, warningCount: 0, infoCount: 0 }
  };
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
    validation,
    nextAction: input.nextAction
  });
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.lifecycle`,
    enabled,
    state,
    operation: input.operation ?? 'unknown',
    settings,
    schedule,
    commands,
    operatorDecision,
    permissionBoundary,
    healthStatus,
    nextAction: input.nextAction ?? operatorDecision.nextAction ?? nextLifecycleAction({ enabled, state, schedule, validation }),
    exportable: enabled && state !== 'blocked' && validation.every((diagnostic) => diagnostic.level !== 'error'),
    validation
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
    blockedReasons: uniqueSorted([
      ...(reports?.externalWrite?.blockedReasons ?? []),
      ...(reports?.externalWrite?.statusHandoff?.blockers ?? []),
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

function buildLifecycleOperatorDecision({
  operation,
  enabled,
  state,
  settings,
  schedule,
  commands,
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
    acknowledgement: {
      token: requiresAcknowledgement ? stableHash({ type: 'lifecycle-ack', digestShape }) : null,
      reason: requiresAcknowledgement ? lifecycleAcknowledgementReason(decisionState, selectedCommand) : null,
      requiredBefore: decisionState === 'scheduled' ? 'schedule_release' : 'kernel_handoff'
    },
    blockers,
    warnings,
    nextAction: blockers.length
      ? actionForDiagnostic(blockers[0])
      : nextAction
        ?? lifecycleDecisionNextAction(decisionState, selectedCommand)
        ?? nextLifecycleAction({ enabled, state, schedule, validation }),
    digest: stableHash(digestShape)
  };
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
  const acknowledged = normalizeAcknowledgements(ir?.handoff?.audit?.acknowledgements);
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
      warningCount: previewSummary.validation.warningCount,
      blockingIssueCount: previewSummary.blockingReasons.length
    },
    operatorActionCard: preview?.operatorActionCard ?? null,
    statusRecovery: summarizeKernelStatusRecoveryReport(statusRecovery),
    runtimeWorkflow: previewSummary.runtimeWorkflow,
    audit: {
      channel: audit?.channel ?? ir?.handoff?.audit?.channel ?? 'audit.mailchimp.runtime_handoff',
      tenantId: audit?.tenantId ?? ir?.handoff?.scope?.tenantId ?? null,
      workspaceId: audit?.workspaceId ?? ir?.handoff?.scope?.workspaceId ?? null,
      idempotencyKey: audit?.idempotencyKey ?? ir?.handoff?.idempotencyKey ?? null
    }
  };
}

function buildKernelStatusRecoveryReport(ir) {
  const externalWrite = ir?.semantic?.externalWrite ?? {};
  const recovery = ir?.semantic?.recovery ?? {};
  const persistedProvider = ir?.persistedState ?? buildPersistedProviderState(ir);
  const persistedWrite = externalWrite?.persistedStatus ?? {};
  const restartRecovery = recovery?.restartRecovery ?? {};
  const writeRequired = externalWrite?.writeRequired === true || persistedProvider?.required === true;
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
  const blockers = uniqueSorted([
    ...(persistedWrite.blockers ?? []),
    ...(restartRecovery.blockers ?? []),
    ...(persistedProvider.blockers ?? []),
    ...(externalWrite.blockedReasons ?? []),
    ...(recovery.blockedReasons ?? []),
    ...(!commandId && writeRequired ? ['missing_status_recovery_command_id'] : []),
    ...(!idempotencyKey && writeRequired ? ['missing_status_recovery_idempotency_key'] : []),
    ...(!statusChannel && writeRequired ? ['missing_status_recovery_channel'] : [])
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
  const readiness = preview.readiness ?? {};
  const acceptance = preview.acceptance ?? {};
  const lifecycleDecision = ir?.lifecycle?.operatorDecision ?? {};
  const blockers = uniqueSorted([
    ...(readiness.blockingReasons ?? []),
    ...(runtimeWorkflow.blockers ?? []),
    ...(clientRuntimeState.blockers ?? []),
    ...(statusRecovery.blockers ?? []),
    ...(provider.blockers ?? []),
    ...(persistedState.blockers ?? []),
    ...(lifecycleDecision.state === 'blocked' ? (lifecycleDecision.blockers ?? ['lifecycle_operator_decision_blocked']) : [])
  ]);
  const warnings = uniqueSorted([
    ...(readiness.warningReasons ?? []),
    ...(runtimeWorkflow.warnings ?? []),
    ...(provider.warnings ?? []),
    ...(lifecycleDecision.requiresAcknowledgement ? ['lifecycle_operator_acknowledgement_required'] : []),
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
    lifecycleDecision: summarizeLifecycleOperatorDecision(lifecycleDecision),
    acceptance: {
      state: acceptance.state ?? 'unknown',
      enabled: acceptance.enabled === true,
      mode: acceptance.mode ?? 'unknown',
      missingAcknowledgements: acceptance.missingAcknowledgements ?? [],
      nextAction: acceptance.nextAction ?? null
    },
    runtimeWorkflow: summarizeRuntimeWorkflowHandoff(runtimeWorkflow),
    clientRuntimeState: summarizeClientRuntimeState(clientRuntimeState),
    statusRecovery: summarizeKernelStatusRecoveryReport(statusRecovery),
    provider: summarizeKernelProviderServiceContract(provider),
    persistedProvider: summarizePersistedProviderState(persistedState),
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
      lifecycleDecisionDigest: lifecycleDecision.digest ?? null
    })
  };
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
  if (packet.lifecycleDecision?.requiresAcknowledgement && !packet.lifecycleDecision?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'client_handoff_missing_lifecycle_acknowledgement_token' });
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
    lifecycleDecision: {
      state: packet?.lifecycleDecision?.state ?? 'unknown',
      selectedCommand: packet?.lifecycleDecision?.selectedCommand ?? null,
      requiresAcknowledgement: packet?.lifecycleDecision?.requiresAcknowledgement ?? false,
      digest: packet?.lifecycleDecision?.digest ?? null
    },
    blockerCount: packet?.blockers?.length ?? 0,
    warningCount: packet?.warnings?.length ?? 0,
    digest: packet?.digest ?? null
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
  const persistedClient = recovery?.persistedClientState ?? {};
  const writeRequired = externalWrite?.writeRequired === true;
  const blockers = uniqueSorted([
    ...(writeHandoff.blockers ?? []),
    ...(persistedClient.blockers ?? []),
    ...(persistedState?.blockers ?? []),
    ...(!persistedState?.commandId && writeRequired ? ['missing_client_runtime_command_id'] : []),
    ...(!persistedClient.statusChannel && !writeHandoff.statusChannel && writeRequired ? ['missing_client_runtime_status_channel'] : [])
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
      snapshotDigest: persistedClient.snapshotDigest ?? persistedState?.snapshotDigest ?? null
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
  const blockers = uniqueSorted([
    ...(providerCommand.blockers ?? []),
    ...(recoveryReplay.blockers ?? []),
    ...(providerService.blockers ?? []),
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
    snapshotDigest: recoverySync.snapshotDigest ?? null
  };
  return {
    schemaVersion: `${KERNEL_CALL_IR_VERSION}.persisted-provider-state`,
    provider: ir?.adapter ?? providerCommand.provider ?? 'mailchimp',
    service: 'mailchimp',
    providerService: summarizeKernelProviderServiceContract(providerService),
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
    changedSincePrevious: recoverySync.changedSincePrevious ?? false,
    commandState,
    replayState,
    safeToReplay: recoveryReplay.safeToReplay === true || providerCommand.replay?.safeToReplay === true,
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
    syncReady: state?.recovery?.syncReady ?? false,
    userVisibleStatus: state?.userVisibleStatus?.current ?? null,
    nextAction: state?.nextAction ?? null,
    blockerCount: state?.blockers?.length ?? 0
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
  return diagnostics;
}

function persistedProviderAction(blocker) {
  if (String(blocker).includes('command_id')) return 'persist_provider_command_id';
  if (String(blocker).includes('idempotency')) return 'persist_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'persist_provider_status_channel';
  if (String(blocker).includes('restart')) return 'persist_restart_token';
  return 'repair_persisted_provider_state';
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

function buildRequiredAcknowledgements({ semantic, lifecycle }) {
  return uniqueSorted([
    ...(semantic.externalWriteRequired ? ['external_write'] : []),
    ...(semantic.recoveryStatus === 'degraded' ? ['recovery_warning'] : []),
    ...(lifecycle?.schedule?.status === 'manual_hold' ? ['manual_release'] : []),
    ...(lifecycle?.settings?.allowDegradedHandoff === false ? ['strict_handoff'] : [])
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
