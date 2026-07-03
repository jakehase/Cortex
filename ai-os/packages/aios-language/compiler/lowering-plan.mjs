import {
  buildTruthBoundaryReport,
  deriveClientRuntimeContract,
  deriveProfilePermissionBoundary,
  normalizeProfile,
  parseProfileSource,
  shapeProfileContinuationState
} from '../source/profile.mjs';
import {
  normalizeFeatureFlags,
  resolveMailchimpRuntimePolicy,
  shapeFeatureFlagState
} from '../source/feature-flags.mjs';
import {
  analyzeExternalWriteContract,
  summarizeExternalWriteAnalysis,
  validateExternalWriteAnalysis
} from '../semantic/external-write-analysis.mjs';
import {
  analyzeRecoveryContract,
  summarizeRecoveryAnalysis,
  validateRecoveryAnalysis
} from '../semantic/recovery-analysis.mjs';
import {
  attachKernelCallSemanticReports,
  buildExportReadySummary,
  createKernelCallIR,
  exportKernelCallIRReport,
  summarizeKernelCallIR,
  summarizeKernelCallUIPreview,
  validateKernelCallIR
} from './kernel-call-ir.mjs';

export const LOWERING_PLAN_VERSION = 'aios.lowering-plan.v1';

export function parseMailchimpProgram(source = '') {
  const profileSourceLines = [];
  const featureSourceLines = [];
  const input = {};
  const claims = {};
  const requestedEffects = [];
  const client = {};
  const scope = {};
  const provider = {};
  const flagCommands = [];
  const continuationCommands = [];
  const lifecycleCommands = [];
  const continuationState = {};
  const lifecycle = {};
  let programId;
  let status = 'queued';

  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (key === 'program') programId = value;
    else if (key === 'status') status = value;
    else if (key === 'input') Object.assign(input, parseKeyValue(value));
    else if (key === 'claim') Object.assign(claims, parseKeyValue(value));
    else if (key === 'effect') requestedEffects.push(value);
    else if (key === 'tenant') scope.tenantId = value;
    else if (key === 'workspace') scope.workspaceId = value;
    else if (key === 'role') scope.role = value;
    else if (key.startsWith('provider.')) provider[key.slice(9)] = coerceScalar(value);
    else if (key.startsWith('client.')) client[key.slice(7)] = value;
    else if (key === 'flagCommand') flagCommands.push(parseFlagCommand(value));
    else if (key === 'continuationCommand') continuationCommands.push(parseContinuationCommand(value));
    else if (key === 'lifecycleCommand') lifecycleCommands.push(parseLifecycleCommand(value));
    else if (key.startsWith('continuation.')) continuationState[key.slice(13)] = coerceScalar(value);
    else if (key === 'lifecycle') lifecycle.enabled = parseLifecycleEnabled(value);
    else if (key.startsWith('lifecycle.')) assignLifecycleField(lifecycle, key.slice(10), coerceScalar(value));
    else if (key.startsWith('schedule.')) assignLifecycleField(lifecycle, `schedule.${key.slice(9)}`, coerceScalar(value));
    else if (key.startsWith('flag.')) featureSourceLines.push(`${key.slice(5)}: ${value}`);
    else profileSourceLines.push(`${key}: ${value}`);
  }

  return {
    kind: 'MailchimpProgram',
    version: LOWERING_PLAN_VERSION,
    programId,
    profileAst: parseProfileSource(profileSourceLines.join('\n')),
    featureFlags: normalizeFeatureFlags(featureSourceLines.join('\n')).flags,
    input,
    claims,
    requestedEffects,
    client,
    provider,
    scope,
    flagCommands: flagCommands.filter(Boolean),
    continuationCommands: continuationCommands.filter(Boolean),
    lifecycleCommands: lifecycleCommands.filter(Boolean),
    continuationState,
    lifecycle,
    status
  };
}

export function lowerMailchimpProgramToPlan(programOrSource = '', options = {}) {
  const program = typeof programOrSource === 'string' ? parseMailchimpProgram(programOrSource) : programOrSource;
  const profileResult = normalizeProfile(options.profile ?? profileFromProgram(program));
  if (!profileResult.ok) return loweringError('profile_normalization_failed', profileResult.diagnostics);

  const featureFlags = {
    ...(program.featureFlags ?? {}),
    ...(options.featureFlags ?? {})
  };
  const featureState = shapeFeatureFlagState({
    flags: featureFlags,
    generation: options.featureFlagGeneration ?? program.featureFlagGeneration,
    history: options.featureFlagHistory ?? program.featureFlagHistory,
    commands: [
      ...(program.flagCommands ?? []),
      ...(options.flagCommands ?? [])
    ]
  });
  const requestedEffects = uniqueSorted([
    ...(program.requestedEffects ?? []),
    ...(options.requestedEffects ?? [])
  ]);
  const runtimePolicy = resolveMailchimpRuntimePolicy({
    operation: profileResult.profile.operation,
    featureFlags: featureState,
    requestedEffects,
    scope: {
      ...(program.scope ?? {}),
      ...(options.scope ?? {}),
      tenantId: options.tenantId ?? options.scope?.tenantId ?? program.scope?.tenantId ?? options.input?.tenantId ?? program.input?.tenantId,
      workspaceId: options.workspaceId ?? options.scope?.workspaceId ?? program.scope?.workspaceId ?? options.input?.workspaceId ?? program.input?.workspaceId,
      role: options.role ?? options.scope?.role ?? program.scope?.role
    }
  });
  const input = {
    ...(program.input ?? {}),
    ...(options.input ?? {})
  };
  const scope = normalizeExecutionScope({
    ...(program.scope ?? {}),
    ...(options.scope ?? {}),
    tenantId: options.tenantId ?? options.scope?.tenantId ?? program.scope?.tenantId ?? options.input?.tenantId ?? program.input?.tenantId,
    workspaceId: options.workspaceId ?? options.scope?.workspaceId ?? program.scope?.workspaceId ?? options.input?.workspaceId ?? program.input?.workspaceId,
    role: options.role ?? options.scope?.role ?? program.scope?.role
  });
  const clientRuntime = deriveClientRuntimeContract(
    {
      ...profileResult.profile,
      clientRuntime: {
        ...(profileResult.profile.clientRuntime ?? {}),
        ...(program.client ?? {}),
        ...(options.client ?? {}),
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId
      }
    },
    {
      ...(program.client ?? {}),
      ...(options.client ?? {}),
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      inputHash: stableHash(input)
    }
  );
  const permissionBoundary = deriveProfilePermissionBoundary(profileResult.profile, {
    ...scope,
    auditChannel: options.auditChannel ?? options.scope?.auditChannel ?? program.scope?.auditChannel
  }, requestedEffects);
  const continuationState = shapeProfileContinuationState(profileResult.profile, {
    ...(program.continuationState ?? {}),
    ...(options.continuationState ?? {}),
    status: options.status ?? program.status ?? program.continuationState?.status,
    request: {
      ...(program.client ?? {}),
      ...(options.client ?? {}),
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      inputHash: stableHash(input)
    },
    checkpoint: {
      ...(program.continuationState?.checkpoint ?? {}),
      ...(options.continuationState?.checkpoint ?? {}),
      inputHash: stableHash(input),
      claimHash: stableHash({
        ...(program.claims ?? {}),
        ...(options.claims ?? {})
      })
    },
    commands: [
      ...(program.continuationCommands ?? []),
      ...(options.continuationCommands ?? [])
    ]
  });
  const truthReport = buildTruthBoundaryReport(profileResult.profile, {
    ...(program.claims ?? {}),
    ...(options.claims ?? {})
  });
  let kernelCall = createKernelCallIR({
    programId: options.programId ?? program.programId,
    profile: profileResult.profile,
    runtimePolicy: {
      ...runtimePolicy.runtimePolicy,
      provider: {
        ...(runtimePolicy.runtimePolicy?.provider ?? {}),
        ...(program.provider ?? {}),
        ...(options.provider ?? {}),
        ...(options.providerContract ?? {})
      }
    },
    input,
    claims: {
      ...(program.claims ?? {}),
      ...(options.claims ?? {})
    },
    status: options.status ?? program.status ?? 'queued',
    rollback: options.rollback,
    handoff: {
      ...(clientRuntime.contract ?? {}),
      scope,
      permissionBoundary: permissionBoundary.boundary,
      audit: buildAuditHandoff({
        programId: options.programId ?? program.programId,
        operation: profileResult.profile.operation,
        scope,
        runtimePolicy: runtimePolicy.runtimePolicy,
        featureState,
        continuationState: continuationState.state,
        permissionBoundary: permissionBoundary.boundary
      }),
      continuationState: continuationState.state
    },
    lifecycle: {
      ...(program.lifecycle ?? {}),
      ...(options.lifecycle ?? {}),
      nextAction: runtimePolicy.runtimePolicy?.nextAction ?? permissionBoundary.boundary?.nextAction,
      settings: {
        ...(program.lifecycle?.settings ?? {}),
        ...(options.lifecycle?.settings ?? {})
      },
      schedule: {
        ...(program.lifecycle?.schedule ?? {}),
        ...(options.lifecycle?.schedule ?? {})
      },
      commands: [
        ...(program.lifecycleCommands ?? []),
        ...(program.lifecycle?.commands ?? []),
        ...(options.lifecycleCommands ?? []),
        ...(options.lifecycle?.commands ?? [])
      ]
    }
  });
  const preliminaryExportReport = exportKernelCallIRReport(kernelCall.ir, options.historySnapshots ?? program.historySnapshots ?? []);
  const externalWriteAnalysis = analyzeExternalWriteContract({
    programId: options.programId ?? program.programId,
    operation: profileResult.profile.operation,
    requestedEffects,
    runtimePolicy: runtimePolicy.runtimePolicy,
    permissionBoundary: permissionBoundary.boundary,
    kernelCall: kernelCall.ir,
    scope,
    input,
    claims: {
      ...(program.claims ?? {}),
      ...(options.claims ?? {})
    },
    lifecycle: kernelCall.ir.lifecycle
  });
  const externalWriteValidation = validateExternalWriteAnalysis(externalWriteAnalysis.report);
  const kernelCallWithWriteAnalysis = attachKernelCallSemanticReports(kernelCall.ir, {
    externalWrite: externalWriteAnalysis.report
  });
  const recoveryAnalysis = analyzeRecoveryContract({
    programId: options.programId ?? program.programId,
    operation: profileResult.profile.operation,
    kernelCall: kernelCallWithWriteAnalysis,
    externalWriteReport: externalWriteAnalysis.report,
    continuationState: continuationState.state,
    runtimePolicy: runtimePolicy.runtimePolicy,
    exportReport: preliminaryExportReport
  });
  const recoveryValidation = validateRecoveryAnalysis(recoveryAnalysis.report);
  kernelCall = {
    ...kernelCall,
    ir: attachKernelCallSemanticReports(kernelCallWithWriteAnalysis, {
      recovery: recoveryAnalysis.report
    })
  };
  const validation = validateKernelCallIR(kernelCall.ir);
  const exportReport = exportKernelCallIRReport(kernelCall.ir, options.historySnapshots ?? program.historySnapshots ?? []);
  const uiPreview = kernelCall.ir.preview;
  const acceptanceSummary = buildPlanAcceptanceSummary({
    kernelCall: kernelCall.ir,
    exportReport,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report
  });
  const providerContract = buildProviderHandoffContract({
    profile: profileResult.profile,
    runtimePolicy: runtimePolicy.runtimePolicy,
    permissionBoundary: permissionBoundary.boundary,
    kernelCall: kernelCall.ir,
    exportReport,
    uiPreview,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report
  });
  const providerPersistence = buildProviderPersistenceContract({
    kernelCall: kernelCall.ir,
    providerContract,
    exportReport,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report
  });
  const clientRuntimeState = buildClientRuntimeStateContract({
    kernelCall: kernelCall.ir,
    providerPersistence,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    clientRuntime: clientRuntime.contract,
    exportReport
  });
  const clientWorkflow = buildClientWorkflowHandoff({
    kernelCall: kernelCall.ir,
    uiPreview,
    acceptanceSummary,
    providerContract,
    providerPersistence,
    clientRuntimeState,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    clientRuntime: clientRuntime.contract
  });
  const workflowAcceptancePacket = buildWorkflowAcceptancePacket({
    kernelCall: kernelCall.ir,
    acceptanceSummary,
    providerContract,
    providerPersistence,
    clientRuntimeState,
    clientWorkflow,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    exportReport
  });
  const statusRecoveryPacket = buildStatusRecoveryPacket({
    kernelCall: kernelCall.ir,
    exportReport,
    acceptanceSummary,
    workflowAcceptancePacket,
    providerPersistence,
    clientRuntimeState,
    clientWorkflow,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report
  });
  const mailchimpExportHandoff = buildMailchimpExportHandoff({
    kernelCall: kernelCall.ir,
    exportReport,
    acceptanceSummary,
    workflowAcceptancePacket,
    providerContract,
    providerPersistence,
    clientRuntimeState,
    clientWorkflow,
    statusRecoveryPacket,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report
  });
  const operatorExportBriefing = buildOperatorExportBriefing({
    kernelCall: kernelCall.ir,
    uiPreview,
    acceptanceSummary,
    workflowAcceptancePacket,
    statusRecoveryPacket,
    mailchimpExportHandoff,
    providerContract,
    providerPersistence,
    clientRuntimeState,
    clientWorkflow,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    exportReport
  });
  const routeAcceptanceDecision = buildRouteAcceptanceDecision({
    kernelCall: kernelCall.ir,
    acceptanceSummary,
    workflowAcceptancePacket,
    statusRecoveryPacket,
    mailchimpExportHandoff,
    operatorExportBriefing,
    providerPersistence,
    clientRuntimeState,
    clientWorkflow,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    exportReport
  });
  const routeClientAcceptanceHandoff = buildRouteClientAcceptanceHandoff({
    kernelCall: kernelCall.ir,
    acceptanceSummary,
    workflowAcceptancePacket,
    statusRecoveryPacket,
    mailchimpExportHandoff,
    operatorExportBriefing,
    routeAcceptanceDecision,
    providerPersistence,
    clientRuntimeState,
    clientWorkflow,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    exportReport
  });
  const clientRuntimeAdoptionHandoff = buildClientRuntimeAdoptionHandoff({
    kernelCall: kernelCall.ir,
    acceptanceSummary,
    workflowAcceptancePacket,
    statusRecoveryPacket,
    mailchimpExportHandoff,
    operatorExportBriefing,
    routeAcceptanceDecision,
    routeClientAcceptanceHandoff,
    providerPersistence,
    clientRuntimeState,
    clientWorkflow,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    exportReport
  });
  const lifecycleControlPanel = buildLifecycleControlPanel({
    kernelCall: kernelCall.ir,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    routeAcceptanceDecision,
    commands: kernelCall.ir.lifecycle?.commands ?? []
  });
  const semanticLifecycleControls = buildSemanticLifecycleControls({
    kernelCall: kernelCall.ir,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    lifecycleControlPanel,
    routeAcceptanceDecision
  });
  const mailchimpAnalyticsExport = buildMailchimpAnalyticsExportState({
    kernelCall: kernelCall.ir,
    exportReport,
    externalWriteReport: externalWriteAnalysis.report,
    recoveryReport: recoveryAnalysis.report,
    statusRecoveryPacket,
    mailchimpExportHandoff,
    operatorExportBriefing,
    routeAcceptanceDecision,
    lifecycleControlPanel
  });
  const diagnostics = [
    ...profileResult.diagnostics,
    ...(clientRuntime.diagnostics ?? []),
    ...(permissionBoundary.diagnostics ?? []),
    ...(continuationState.diagnostics ?? []),
    ...validateExecutionScope(scope, requestedEffects),
    ...runtimePolicy.diagnostics,
    ...truthReport.diagnostics,
    ...externalWriteAnalysis.diagnostics,
    ...externalWriteValidation.diagnostics,
    ...recoveryAnalysis.diagnostics,
    ...recoveryValidation.diagnostics,
    ...kernelCall.diagnostics,
    ...validation.diagnostics,
    ...validateStatusRecoveryPacket(statusRecoveryPacket, externalWriteAnalysis.report),
    ...validateMailchimpExportHandoff(mailchimpExportHandoff, externalWriteAnalysis.report),
    ...validateOperatorExportBriefing(operatorExportBriefing, externalWriteAnalysis.report),
    ...validateRouteAcceptanceDecision(routeAcceptanceDecision, externalWriteAnalysis.report),
    ...validateRouteClientAcceptanceHandoff(routeClientAcceptanceHandoff, externalWriteAnalysis.report),
    ...validateClientRuntimeAdoptionHandoff(clientRuntimeAdoptionHandoff, externalWriteAnalysis.report),
    ...validateLifecycleControlPanel(lifecycleControlPanel, externalWriteAnalysis.report),
    ...validateSemanticLifecycleControls(semanticLifecycleControls, externalWriteAnalysis.report),
    ...validateMailchimpAnalyticsExportState(mailchimpAnalyticsExport, externalWriteAnalysis.report)
  ];

  return {
    ok: runtimePolicy.ok && permissionBoundary.ok && continuationState.ok && validation.ok && diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
    plan: {
      kind: 'LoweringPlan',
      version: LOWERING_PLAN_VERSION,
      sourceKind: program.kind ?? 'MailchimpProgram',
      profile: profileResult.profile,
      featureFlags: normalizeFeatureFlags(featureState.flags).flags,
      featureState,
      continuationState: continuationState.state,
      scope,
      permissionBoundary: permissionBoundary.boundary,
      runtimePolicy: runtimePolicy.runtimePolicy,
      truthReport: truthReport.report,
      externalWriteReport: externalWriteAnalysis.report,
      recoveryReport: recoveryAnalysis.report,
      kernelCalls: [kernelCall.ir],
      summary: summarizeKernelCallIR(kernelCall.ir),
      analytics: buildLoweringAnalytics({
        kernelCall: kernelCall.ir,
        featureState,
        continuationState: continuationState.state,
        permissionBoundary: permissionBoundary.boundary,
        exportReport,
        acceptanceSummary,
        providerContract,
        providerPersistence,
        clientRuntimeState,
        clientWorkflow,
        statusRecoveryPacket,
        mailchimpExportHandoff,
        operatorExportBriefing,
        routeAcceptanceDecision,
        routeClientAcceptanceHandoff,
        clientRuntimeAdoptionHandoff,
        lifecycleControlPanel,
        semanticLifecycleControls,
        mailchimpAnalyticsExport
      }),
      exportReport,
      uiPreview,
      acceptanceSummary,
      workflowAcceptancePacket,
      mailchimpExportHandoff,
      operatorExportBriefing,
      routeAcceptanceDecision,
      routeClientAcceptanceHandoff,
      clientRuntimeAdoptionHandoff,
      lifecycleControlPanel,
      semanticLifecycleControls,
      mailchimpAnalyticsExport,
      providerContract,
      providerPersistence,
      clientRuntimeState,
      clientWorkflow,
      statusRecoveryPacket,
      handoff: {
        adapter: profileResult.profile.runtimeAdapter,
        queue: `kernel.jobs.${profileResult.profile.operation}`,
        status: kernelCall.ir.status,
        provider: providerContract,
        rollbackAction: kernelCall.ir.recovery.rollbackAction,
        client: clientRuntime.contract,
        audit: kernelCall.ir.handoff.audit,
        permissionBoundary: {
          isolationKey: permissionBoundary.boundary?.isolationKey ?? null,
          nextAction: permissionBoundary.boundary?.nextAction ?? null,
          deniedEffects: permissionBoundary.boundary?.permissions?.deniedEffects ?? []
        },
        resume: {
          idempotencyKey: clientRuntime.contract?.idempotencyKey,
          featureRestartToken: featureState.restartToken,
          profileRestartToken: continuationState.state?.restartToken,
          statusChannel: clientRuntime.contract?.statusChannel,
          nextStatus: clientRuntime.contract?.userVisibleWorkflow?.pendingStatus,
          resumeAction: continuationState.state?.resumeAction,
          lifecycleNextAction: kernelCall.ir.lifecycle?.nextAction ?? null,
          exportReady: exportReport.analytics?.exportReady ?? false,
          acceptanceState: acceptanceSummary.acceptanceState,
          previewNextAction: acceptanceSummary.nextAction,
          workflowState: clientWorkflow.state,
          workflowNextAction: clientWorkflow.nextAction,
          dispatchStatus: clientWorkflow.externalWrite.dispatchStatus,
          providerSyncReady: clientWorkflow.provider.syncReady,
          providerServiceState: providerContract.serviceContract.state,
          providerServiceReady: providerContract.serviceContract.ready,
          providerServiceDigest: providerContract.serviceContract.digest,
          providerServiceNextAction: providerContract.serviceContract.nextAction,
          providerMissingCapabilities: providerContract.serviceContract.missingCapabilities,
          providerCommandId: providerPersistence.commandId,
          persistedProviderState: providerPersistence.status,
          replaySafe: providerPersistence.safeToReplay,
          clientRuntimeState: clientRuntimeState.state,
          clientRuntimeReady: clientRuntimeState.ready,
          clientRuntimeStatus: clientRuntimeState.userVisibleStatus.current,
          clientRuntimeDigest: clientRuntimeState.digest,
          clientRequestSnapshotState: statusRecoveryPacket.clientRequestSnapshot.state,
          clientRequestSnapshotReady: statusRecoveryPacket.clientRequestSnapshot.ready,
          clientRequestSnapshotDigest: statusRecoveryPacket.clientRequestSnapshot.digest,
          clientRequestKey: statusRecoveryPacket.clientRequestSnapshot.requestKey,
          acceptancePacketState: workflowAcceptancePacket.state,
          acceptancePacketReady: workflowAcceptancePacket.ready,
          acceptancePacketNextAction: workflowAcceptancePacket.nextAction,
          statusRecoveryState: statusRecoveryPacket.state,
          statusRecoveryReady: statusRecoveryPacket.ready,
          statusRecoveryDigest: statusRecoveryPacket.digest,
          statusRecoveryNextAction: statusRecoveryPacket.nextAction,
          statusJournalState: statusRecoveryPacket.statusJournal.state,
          statusJournalReady: statusRecoveryPacket.statusJournal.ready,
          statusJournalDigest: statusRecoveryPacket.statusJournal.digest,
          statusJournalNextAction: statusRecoveryPacket.statusJournal.nextAction,
          externalStatusHandoffState: externalWriteAnalysis.report.statusHandoff?.state ?? 'unknown',
          externalStatusHandoffReady: externalWriteAnalysis.report.statusHandoff?.ready ?? false,
          externalStatusHandoffDigest: externalWriteAnalysis.report.statusHandoff?.digest ?? null,
          externalStatusHandoffNextAction: externalWriteAnalysis.report.statusHandoff?.nextAction ?? null,
          recoveryStatusHandoffState: recoveryAnalysis.report.statusHandoff?.state ?? 'unknown',
          recoveryStatusHandoffReady: recoveryAnalysis.report.statusHandoff?.ready ?? false,
          recoveryStatusHandoffDigest: recoveryAnalysis.report.statusHandoff?.digest ?? null,
          recoveryStatusHandoffExternalDigest: recoveryAnalysis.report.statusHandoff?.externalDigest ?? null,
          recoveryStatusHandoffNextAction: recoveryAnalysis.report.statusHandoff?.nextAction ?? null,
          boundaryTicketState: statusRecoveryPacket.boundaryTicket.state,
          boundaryTicketAuditDigest: statusRecoveryPacket.boundaryTicket.auditDigest,
          boundaryRecoveryGuardState: externalWriteAnalysis.report.boundaryRecoveryGuard?.state ?? 'unknown',
          boundaryRecoveryGuardDigest: externalWriteAnalysis.report.boundaryRecoveryGuard?.guardDigest ?? null,
          boundaryRecoveryReplayPolicy: externalWriteAnalysis.report.boundaryRecoveryGuard?.replayPolicy ?? null,
          boundaryRecoveryGuardNextAction: externalWriteAnalysis.report.boundaryRecoveryGuard?.nextAction ?? null,
          mailchimpExportState: mailchimpExportHandoff.state,
          mailchimpExportReady: mailchimpExportHandoff.ready,
          mailchimpExportDigest: mailchimpExportHandoff.digest,
          mailchimpExportNextAction: mailchimpExportHandoff.nextAction,
          operatorBriefingState: operatorExportBriefing.state,
          operatorBriefingReady: operatorExportBriefing.ready,
          operatorBriefingDigest: operatorExportBriefing.digest,
          operatorBriefingNextAction: operatorExportBriefing.nextAction,
          routeAcceptanceState: routeAcceptanceDecision.state,
          routeAcceptanceReady: routeAcceptanceDecision.ready,
          routeAcceptanceDigest: routeAcceptanceDecision.digest,
          routeAcceptanceNextAction: routeAcceptanceDecision.nextAction,
          routeClientAcceptanceState: routeClientAcceptanceHandoff.state,
          routeClientAcceptanceReady: routeClientAcceptanceHandoff.ready,
          routeClientAcceptanceDigest: routeClientAcceptanceHandoff.digest,
          routeClientAcceptanceNextAction: routeClientAcceptanceHandoff.nextAction,
          routeClientAcceptanceCommandId: routeClientAcceptanceHandoff.command.commandId,
          clientRuntimeAdoptionState: clientRuntimeAdoptionHandoff.state,
          clientRuntimeAdoptionReady: clientRuntimeAdoptionHandoff.ready,
          clientRuntimeAdoptionDigest: clientRuntimeAdoptionHandoff.digest,
          clientRuntimeAdoptionNextAction: clientRuntimeAdoptionHandoff.nextAction,
          clientRuntimeAdoptionCommandId: clientRuntimeAdoptionHandoff.command.commandId,
          lifecycleControlState: lifecycleControlPanel.state,
          lifecycleControlReady: lifecycleControlPanel.ready,
          lifecycleControlNextAction: lifecycleControlPanel.nextAction,
          lifecycleControlDigest: lifecycleControlPanel.digest,
          semanticLifecycleState: semanticLifecycleControls.state,
          semanticLifecycleReady: semanticLifecycleControls.ready,
          semanticLifecycleSelectedControl: semanticLifecycleControls.selectedControl,
          semanticLifecycleNextAction: semanticLifecycleControls.nextAction,
          semanticLifecycleDigest: semanticLifecycleControls.digest,
          mailchimpAnalyticsExportState: mailchimpAnalyticsExport.state,
          mailchimpAnalyticsExportReady: mailchimpAnalyticsExport.ready,
          mailchimpAnalyticsExportDigest: mailchimpAnalyticsExport.digest,
          mailchimpAnalyticsExportNextAction: mailchimpAnalyticsExport.nextAction
        },
        semantic: {
          externalWrite: summarizeExternalWriteAnalysis(externalWriteAnalysis.report),
          recovery: summarizeRecoveryAnalysis(recoveryAnalysis.report)
        }
      }
    },
    diagnostics: dedupeDiagnostics(diagnostics)
  };
}

export function lowerMailchimpAstToKernelCalls(ast, options = {}) {
  const lowered = lowerMailchimpProgramToPlan(ast, options);
  if (!lowered.ok) {
    return {
      ok: false,
      kernelCalls: [],
      diagnostics: lowered.diagnostics
    };
  }
  return {
    ok: true,
    kernelCalls: lowered.plan.kernelCalls,
    diagnostics: lowered.diagnostics
  };
}

export function buildRollbackPlan(loweringPlan) {
  const calls = loweringPlan?.kernelCalls ?? loweringPlan?.plan?.kernelCalls ?? [];
  return {
    kind: 'RollbackPlan',
    version: LOWERING_PLAN_VERSION,
    steps: calls.map((call, index) => ({
      index,
      programId: call.programId,
      operation: call.operation,
      action: call.recovery.rollbackAction,
      statusOnFailure: call.recovery.failureStatus,
      memoryToDiscard: call.memory
        .filter((binding) => binding.retention === 'ephemeral')
        .map((binding) => binding.name)
    }))
  };
}

function buildLifecycleControlPanel({
  kernelCall,
  externalWriteReport,
  recoveryReport,
  routeAcceptanceDecision,
  commands
}) {
  const lifecycle = kernelCall?.lifecycle ?? {};
  const settings = lifecycle.settings ?? {};
  const schedule = lifecycle.schedule ?? {};
  const kernelDecision = lifecycle.operatorDecision ?? {};
  const normalizedCommands = asArray(commands).map((command, index) => normalizeLifecycleCommand(command, index));
  const settingIssues = validateLifecycleSettings(settings);
  const scheduleIssues = validateLifecycleSchedule(schedule);
  const commandIssues = normalizedCommands.flatMap(validateLifecycleCommand);
  const writeRequired = externalWriteReport?.writeRequired === true;
  const enableRequested = normalizedCommands.some((command) => ['enable', 'resume'].includes(command.action));
  const disableRequested = normalizedCommands.some((command) => ['disable', 'pause', 'hold'].includes(command.action));
  const scheduleRequested = normalizedCommands.some((command) => ['schedule', 'reschedule'].includes(command.action)) || Object.keys(schedule).length > 0;
  const blockers = uniqueSorted([
    ...settingIssues.filter((issue) => issue.level === 'error').map((issue) => issue.code),
    ...scheduleIssues.filter((issue) => issue.level === 'error').map((issue) => issue.code),
    ...commandIssues.filter((issue) => issue.level === 'error').map((issue) => issue.code),
    ...(writeRequired && externalWriteReport?.operationalHealth?.failureState === 'failed' ? ['external_write_health_failed'] : []),
    ...(recoveryReport?.status === 'blocked' ? ['recovery_blocked'] : []),
    ...(routeAcceptanceDecision?.state === 'blocked' ? ['route_acceptance_blocked'] : [])
  ]);
  const warnings = uniqueSorted([
    ...settingIssues.filter((issue) => issue.level === 'warning').map((issue) => issue.code),
    ...scheduleIssues.filter((issue) => issue.level === 'warning').map((issue) => issue.code),
    ...commandIssues.filter((issue) => issue.level === 'warning').map((issue) => issue.code),
    ...(externalWriteReport?.operationalHealth?.degraded ? ['external_write_degraded'] : []),
    ...(recoveryReport?.status === 'degraded' ? ['recovery_degraded'] : []),
    ...(routeAcceptanceDecision?.state === 'review' ? ['route_acceptance_review'] : [])
  ]);
  const effectiveEnabled = disableRequested
    ? false
    : enableRequested
      ? true
      : lifecycle.enabled !== false;
  const state = blockers.length
    ? 'blocked'
    : !effectiveEnabled
      ? 'disabled'
      : lifecycle.state === 'held' || disableRequested
        ? 'held'
        : scheduleRequested
          ? 'scheduled'
          : warnings.length
            ? 'review'
            : 'enabled';
  const controls = [
    {
      name: 'enable',
      available: state !== 'blocked',
      selected: effectiveEnabled,
      commandId: `lifecycle-enable:${stableHash({ programId: kernelCall?.programId ?? null, operation: kernelCall?.operation ?? null, enabled: true })}`,
      nextState: 'enabled'
    },
    {
      name: 'disable',
      available: state !== 'blocked',
      selected: !effectiveEnabled,
      commandId: `lifecycle-disable:${stableHash({ programId: kernelCall?.programId ?? null, operation: kernelCall?.operation ?? null, enabled: false })}`,
      nextState: 'disabled'
    },
    {
      name: 'manual_hold',
      available: state !== 'blocked' && writeRequired,
      selected: lifecycle.state === 'held' || disableRequested,
      commandId: `lifecycle-hold:${stableHash({ programId: kernelCall?.programId ?? null, operation: kernelCall?.operation ?? null, route: routeAcceptanceDecision?.digest ?? null })}`,
      nextState: 'held'
    },
    {
      name: 'schedule',
      available: state !== 'blocked' && effectiveEnabled,
      selected: scheduleRequested,
      commandId: `lifecycle-schedule:${stableHash({ schedule, programId: kernelCall?.programId ?? null, operation: kernelCall?.operation ?? null })}`,
      nextState: 'scheduled'
    }
  ];
  const appliedCommands = normalizedCommands.map((command) => ({
    id: command.id,
    action: command.action,
    source: command.source,
    accepted: !validateLifecycleCommand(command).some((issue) => issue.level === 'error'),
    nextState: lifecycleNextStateForCommand(command.action),
    reason: command.reason
  }));
  const selectedKernelCommand = kernelDecision.selectedCommand
    ? {
        id: kernelDecision.selectedCommand.id ?? null,
        action: kernelDecision.selectedCommand.action ?? null,
        requestedState: kernelDecision.selectedCommand.requestedState ?? null,
        source: kernelDecision.selectedCommand.source ?? null,
        reason: kernelDecision.selectedCommand.reason ?? null
      }
    : null;
  const operatorDecision = {
    state: kernelDecision.state ?? state,
    selectedCommand: selectedKernelCommand
      ?? appliedCommands.at(-1)
      ?? null,
    effectiveEnabled: kernelDecision.effectiveEnabled ?? effectiveEnabled,
    requiresAcknowledgement: kernelDecision.requiresAcknowledgement === true
      || ['disabled', 'held', 'scheduled', 'review'].includes(state),
    acknowledgementToken: kernelDecision.acknowledgement?.token ?? (
      ['disabled', 'held', 'scheduled', 'review'].includes(state)
        ? stableHash({
            type: 'lowering-lifecycle-ack',
            programId: kernelCall?.programId ?? null,
            operation: kernelCall?.operation ?? null,
            state,
            selectedCommand: appliedCommands.at(-1)?.id ?? null
          })
        : null
    ),
    acknowledgementReason: kernelDecision.acknowledgement?.reason
      ?? appliedCommands.at(-1)?.reason
      ?? (state === 'scheduled' ? 'scheduled_release_requires_confirmation' : null),
    nextAction: kernelDecision.nextAction ?? null,
    digest: kernelDecision.digest ?? null
  };
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    effectiveEnabled,
    settings,
    schedule,
    commands: appliedCommands.map((command) => `${command.id}:${command.action}:${command.accepted}`),
    operatorDecision,
    blockers,
    warnings,
    routeAcceptanceDigest: routeAcceptanceDecision?.digest ?? null
  };
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.lifecycle-control-panel`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready: ['enabled', 'disabled', 'held', 'scheduled'].includes(state),
    writeRequired,
    effectiveEnabled,
    settings,
    schedule,
    controls,
    appliedCommands,
    operatorDecision: {
      ...operatorDecision,
      digest: operatorDecision.digest ?? stableHash({
        programId: kernelCall?.programId ?? null,
        operation: kernelCall?.operation ?? null,
        state: operatorDecision.state,
        selectedCommand: operatorDecision.selectedCommand?.id ?? operatorDecision.selectedCommand?.action ?? null,
        acknowledgementToken: operatorDecision.acknowledgementToken,
        routeAcceptanceDigest: routeAcceptanceDecision?.digest ?? null
      })
    },
    commandCount: appliedCommands.length,
    validation: {
      settingIssues,
      scheduleIssues,
      commandIssues
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? lifecycleActionForBlocker(blockers[0])
      : state === 'disabled'
        ? 'keep_lifecycle_disabled'
        : state === 'held'
          ? 'await_manual_release'
          : state === 'scheduled'
            ? 'wait_for_schedule_window'
            : warnings.length
              ? lifecycleActionForWarning(warnings[0])
              : 'continue_lifecycle_enabled',
    digest: stableHash(digestShape)
  };
}

function validateLifecycleControlPanel(panel, externalWriteReport) {
  const diagnostics = [];
  if (!panel) return [{ level: 'error', code: 'missing_lifecycle_control_panel' }];
  if (externalWriteReport?.writeRequired && panel.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'lifecycle_control_panel_not_write_required' });
  }
  if (panel.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'lifecycle_control_panel_blocked', blockers: panel.blockers ?? [] });
  }
  if (panel.ready && !panel.digest) {
    diagnostics.push({ level: 'error', code: 'lifecycle_control_panel_missing_digest' });
  }
  if (panel.operatorDecision?.requiresAcknowledgement && !panel.operatorDecision?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'lifecycle_control_panel_missing_acknowledgement_token' });
  }
  if (panel.state === 'scheduled' && !Object.keys(panel.schedule ?? {}).length) {
    diagnostics.push({ level: 'warning', code: 'lifecycle_control_panel_schedule_empty' });
  }
  return diagnostics;
}

function buildSemanticLifecycleControls({
  kernelCall,
  externalWriteReport,
  recoveryReport,
  lifecycleControlPanel,
  routeAcceptanceDecision
}) {
  const writeRequired = externalWriteReport?.writeRequired === true;
  const semanticControls = externalWriteReport?.lifecycleControls ?? {};
  const recoveryControl = recoveryReport?.provider?.lifecycleControl ?? recoveryReport?.sync?.lifecycleControl ?? {};
  const state = semanticControls.state
    ?? recoveryControl.state
    ?? lifecycleControlPanel?.state
    ?? 'unknown';
  const selectedControl = semanticControls.selectedControl
    ?? recoveryControl.selectedControl
    ?? lifecycleControlPanel?.controls?.find((control) => control.selected)?.name
    ?? null;
  const blockers = uniqueSorted([
    ...(semanticControls.blockers ?? []).map((blocker) => `semantic_${blocker}`),
    ...(recoveryControl.blockers ?? []).map((blocker) => `recovery_${blocker}`),
    ...(lifecycleControlPanel?.blockers ?? []).map((blocker) => `panel_${blocker}`),
    ...(routeAcceptanceDecision?.state === 'blocked' ? ['route_acceptance_blocked'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(semanticControls.warnings ?? []).map((warning) => `semantic_${warning}`),
    ...(recoveryControl.warnings ?? []).map((warning) => `recovery_${warning}`),
    ...(lifecycleControlPanel?.warnings ?? []).map((warning) => `panel_${warning}`),
    ...(routeAcceptanceDecision?.state === 'review' ? ['route_acceptance_review'] : [])
  ]);
  const availableControls = uniqueSorted([
    ...(semanticControls.controls ?? [])
      .filter((control) => control.available)
      .map((control) => control.name),
    ...(recoveryControl.availableControls ?? []),
    ...(lifecycleControlPanel?.controls ?? [])
      .filter((control) => control.available)
      .map((control) => control.name)
  ]);
  const commandIds = uniqueSorted([
    ...(semanticControls.commands ?? []).map((command) => command.commandId),
    ...(lifecycleControlPanel?.appliedCommands ?? []).map((command) => command.id)
  ]);
  const operatorDecision = lifecycleControlPanel?.operatorDecision ?? kernelCall?.lifecycle?.operatorDecision ?? {};
  const ready = blockers.length === 0
    && (semanticControls.ready === true || lifecycleControlPanel?.ready === true || !writeRequired);
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready,
    selectedControl,
    semanticDigest: semanticControls.digest ?? null,
    recoveryDigest: recoveryControl.digest ?? null,
    panelDigest: lifecycleControlPanel?.digest ?? null,
    operatorDecisionDigest: operatorDecision.digest ?? null,
    routeDigest: routeAcceptanceDecision?.digest ?? null,
    blockers,
    warnings
  };
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.semantic-lifecycle-controls`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready,
    writeRequired,
    effectiveEnabled: semanticControls.effectiveEnabled ?? lifecycleControlPanel?.effectiveEnabled ?? false,
    selectedControl,
    userVisibleStatus: semanticControls.userVisibleStatus
      ?? recoveryControl.userVisibleStatus
      ?? semanticLifecycleStatus(state),
    schedule: {
      status: semanticControls.schedule?.status ?? recoveryControl.schedule?.status ?? lifecycleControlPanel?.schedule?.status ?? null,
      mode: semanticControls.schedule?.mode ?? recoveryControl.schedule?.mode ?? lifecycleControlPanel?.schedule?.mode ?? null,
      notBefore: semanticControls.schedule?.notBefore ?? recoveryControl.schedule?.notBefore ?? lifecycleControlPanel?.schedule?.notBefore ?? null,
      notAfter: semanticControls.schedule?.notAfter ?? recoveryControl.schedule?.notAfter ?? lifecycleControlPanel?.schedule?.notAfter ?? null,
      timezone: semanticControls.schedule?.timezone ?? recoveryControl.schedule?.timezone ?? lifecycleControlPanel?.schedule?.timezone ?? null
    },
    controls: availableControls.map((name) => ({
      name,
      selected: name === selectedControl,
      routeAction: lifecycleRouteAction(name),
      commandId: semanticControls.controls?.find((control) => control.name === name)?.commandId
        ?? lifecycleControlPanel?.controls?.find((control) => control.name === name)?.commandId
        ?? null
    })),
    commandIds,
    operatorDecision: {
      state: operatorDecision.state ?? state,
      selectedCommand: operatorDecision.selectedCommand?.action ?? operatorDecision.selectedCommand ?? null,
      selectedCommandId: operatorDecision.selectedCommand?.id ?? null,
      requiresAcknowledgement: operatorDecision.requiresAcknowledgement === true,
      acknowledgementToken: operatorDecision.acknowledgementToken ?? operatorDecision.acknowledgement?.token ?? null,
      acknowledgementReason: operatorDecision.acknowledgementReason ?? operatorDecision.acknowledgement?.reason ?? null,
      nextAction: operatorDecision.nextAction ?? null,
      digest: operatorDecision.digest ?? null
    },
    digests: {
      semantic: semanticControls.digest ?? null,
      recovery: recoveryControl.digest ?? null,
      panel: lifecycleControlPanel?.digest ?? null,
      operatorDecision: operatorDecision.digest ?? null,
      routeAcceptance: routeAcceptanceDecision?.digest ?? null
    },
    blockers,
    warnings,
    nextAction: blockers.length
      ? semanticLifecycleAction(blockers[0])
      : state === 'disabled'
        ? 'keep_lifecycle_disabled'
        : state === 'held'
          ? 'await_manual_release'
          : state === 'scheduled'
            ? 'wait_for_schedule_window'
            : warnings.length
              ? 'review_semantic_lifecycle_controls'
              : semanticControls.nextAction
                ?? lifecycleControlPanel?.nextAction
                ?? 'continue_lifecycle_enabled',
    digest: stableHash(digestShape)
  };
}

function validateSemanticLifecycleControls(summary, externalWriteReport) {
  const diagnostics = [];
  if (!externalWriteReport?.writeRequired && !summary) return diagnostics;
  if (!summary) return [{ level: 'error', code: 'missing_semantic_lifecycle_controls' }];
  if (externalWriteReport?.writeRequired && summary.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'semantic_lifecycle_controls_not_write_required' });
  }
  if (summary.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'semantic_lifecycle_controls_blocked', blockers: summary.blockers ?? [] });
  }
  if (summary.ready && externalWriteReport?.writeRequired && !summary.digest) {
    diagnostics.push({ level: 'error', code: 'semantic_lifecycle_controls_missing_digest' });
  }
  if (summary.operatorDecision?.requiresAcknowledgement && !summary.operatorDecision?.acknowledgementToken) {
    diagnostics.push({ level: 'error', code: 'semantic_lifecycle_controls_missing_acknowledgement_token' });
  }
  if (summary.state === 'scheduled' && !summary.schedule?.status) {
    diagnostics.push({ level: 'warning', code: 'semantic_lifecycle_schedule_status_missing' });
  }
  return diagnostics;
}

function lifecycleRouteAction(controlName) {
  return {
    enable: 'enable_lifecycle_before_write',
    disable: 'disable_lifecycle',
    manual_hold: 'hold_lifecycle_for_operator',
    schedule: 'schedule_lifecycle_release',
    run: 'continue_lifecycle_enabled'
  }[controlName] ?? 'review_lifecycle_control';
}

function semanticLifecycleStatus(state) {
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

function semanticLifecycleAction(reason) {
  if (String(reason).includes('panel_')) return lifecycleActionForBlocker(String(reason).replace(/^panel_/, ''));
  if (String(reason).includes('schedule')) return 'repair_lifecycle_schedule';
  if (String(reason).includes('timeout')) return 'repair_lifecycle_timeout';
  if (String(reason).includes('concurrency')) return 'repair_lifecycle_concurrency';
  if (String(reason).includes('route_acceptance')) return 'repair_route_acceptance_decision';
  if (String(reason).includes('disabled')) return 'enable_lifecycle_before_write';
  if (String(reason).includes('manual')) return 'await_manual_release';
  return 'repair_lifecycle_controls';
}

function buildMailchimpAnalyticsExportState({
  kernelCall,
  exportReport,
  externalWriteReport,
  recoveryReport,
  statusRecoveryPacket,
  mailchimpExportHandoff,
  operatorExportBriefing,
  routeAcceptanceDecision,
  lifecycleControlPanel,
  mailchimpAnalyticsExport
}) {
  const externalAnalytics = externalWriteReport?.analyticsExport ?? {};
  const recoveryAnalytics = recoveryReport?.analyticsSummary ?? {};
  const externalActionCard = externalAnalytics.operatorActionCard ?? {};
  const recoveryLifecycleCommands = recoveryAnalytics.lifecycleCommandState ?? {};
  const semantic = kernelCall?.semantic ?? {};
  const checkpoints = [
    analyticsCheckpoint('kernel_export', exportReport?.analytics?.exportReady ? 'ready' : 'not_ready', exportReport?.analytics?.exportReady === true, [], [], exportReport?.history?.latest?.digest),
    analyticsCheckpoint('external_write', externalAnalytics.state, externalAnalytics.ready, externalAnalytics.blockers, externalAnalytics.warnings, externalAnalytics.digest),
    analyticsCheckpoint('operator_action_card', externalActionCard.state, externalActionCard.ready, externalActionCard.blockers, externalActionCard.warnings, externalActionCard.digest),
    analyticsCheckpoint(
      'boundary_recovery_guard',
      externalWriteReport?.boundaryRecoveryGuard?.state,
      externalWriteReport?.boundaryRecoveryGuard?.ready,
      externalWriteReport?.boundaryRecoveryGuard?.blockers,
      externalWriteReport?.boundaryRecoveryGuard?.warnings,
      externalWriteReport?.boundaryRecoveryGuard?.guardDigest
    ),
    analyticsCheckpoint('recovery', recoveryAnalytics.status ?? recoveryReport?.status, recoveryAnalytics.exportReady ?? recoveryReport?.exportContinuity?.ready, recoveryReport?.blockedReasons, recoveryAnalytics.timeline?.filter?.((event) => event.status === 'blocked')?.map?.((event) => event.phase), recoveryAnalytics.reportDigest),
    analyticsCheckpoint('recovery_lifecycle_commands', recoveryLifecycleCommands.state, recoveryLifecycleCommands.ready, recoveryLifecycleCommands.blockers, recoveryLifecycleCommands.warnings, recoveryLifecycleCommands.digest),
    analyticsCheckpoint('status_recovery', statusRecoveryPacket?.state, statusRecoveryPacket?.ready, statusRecoveryPacket?.blockers, statusRecoveryPacket?.warnings, statusRecoveryPacket?.digest),
    analyticsCheckpoint('mailchimp_export_handoff', mailchimpExportHandoff?.state, mailchimpExportHandoff?.ready, mailchimpExportHandoff?.blockers, mailchimpExportHandoff?.warnings, mailchimpExportHandoff?.digest),
    analyticsCheckpoint('operator_briefing', operatorExportBriefing?.state, operatorExportBriefing?.ready, operatorExportBriefing?.blockers, operatorExportBriefing?.warnings, operatorExportBriefing?.digest),
    analyticsCheckpoint('route_acceptance', routeAcceptanceDecision?.state, routeAcceptanceDecision?.ready, routeAcceptanceDecision?.blockers, routeAcceptanceDecision?.warnings, routeAcceptanceDecision?.digest),
    analyticsCheckpoint('lifecycle_control', lifecycleControlPanel?.state, lifecycleControlPanel?.ready, lifecycleControlPanel?.blockers, lifecycleControlPanel?.warnings, lifecycleControlPanel?.digest)
  ];
  const failedCheckpoints = checkpoints.filter((checkpoint) => checkpoint.outcome === 'failed');
  const reviewCheckpoints = checkpoints.filter((checkpoint) => checkpoint.outcome === 'review');
  const timeline = checkpoints.map((checkpoint, index) => ({
    sequence: index + 1,
    event: checkpoint.name,
    status: checkpoint.status,
    outcome: checkpoint.outcome,
    ready: checkpoint.ready,
    digest: checkpoint.digest,
    blockerCount: checkpoint.blockers.length,
    warningCount: checkpoint.warnings.length
  }));
  const historySnapshots = [
    {
      id: `mcpexp:${stableHash({ programId: kernelCall?.programId, phase: 'kernel', digest: exportReport?.history?.latest?.digest })}`,
      sequence: 1,
      phase: 'kernel',
      status: kernelCall?.health?.status ?? kernelCall?.status ?? 'unknown',
      exportReady: exportReport?.analytics?.exportReady === true,
      digest: exportReport?.history?.latest?.digest ?? null,
      timelineEvents: exportReport?.timeline?.length ?? 0
    },
    {
      id: `mcpexp:${stableHash({ programId: kernelCall?.programId, phase: 'semantic', external: externalAnalytics.digest, recovery: recoveryAnalytics.reportDigest })}`,
      sequence: 2,
      phase: 'semantic',
      status: externalWriteReport?.status ?? 'unknown',
      externalWriteAnalyticsDigest: externalAnalytics.digest ?? null,
      operatorActionCardDigest: externalActionCard.digest ?? null,
      operatorActionCardAction: externalActionCard.primaryAction ?? null,
      operatorActionCardReady: externalActionCard.ready === true,
      recoveryAnalyticsDigest: recoveryAnalytics.reportDigest ?? null,
      recoveryLifecycleCommandDigest: recoveryLifecycleCommands.digest ?? null,
      recoveryLifecycleSelectedCommand: recoveryLifecycleCommands.selectedCommand ?? null,
      boundaryRecoveryGuardDigest: externalWriteReport?.boundaryRecoveryGuard?.guardDigest ?? null,
      boundaryRecoveryGuardState: externalWriteReport?.boundaryRecoveryGuard?.state ?? 'unknown',
      writeRequired: externalWriteReport?.writeRequired === true,
      recoveryStatus: recoveryReport?.status ?? 'unknown'
    },
    {
      id: `mcpexp:${stableHash({ programId: kernelCall?.programId, phase: 'handoff', mailchimp: mailchimpExportHandoff?.digest, route: routeAcceptanceDecision?.digest })}`,
      sequence: 3,
      phase: 'handoff',
      status: mailchimpExportHandoff?.state ?? 'unknown',
      mailchimpExportDigest: mailchimpExportHandoff?.digest ?? null,
      operatorBriefingDigest: operatorExportBriefing?.digest ?? null,
      routeAcceptanceDigest: routeAcceptanceDecision?.digest ?? null,
      lifecycleControlDigest: lifecycleControlPanel?.digest ?? null
    }
  ];
  const counters = {
    checkpointCount: checkpoints.length,
    readyCheckpointCount: checkpoints.filter((checkpoint) => checkpoint.outcome === 'ready').length,
    failedCheckpointCount: failedCheckpoints.length,
    reviewCheckpointCount: reviewCheckpoints.length,
    historySnapshotCount: historySnapshots.length,
    externalAnalyticsSnapshotCount: externalAnalytics.historySnapshots?.length ?? 0,
    externalAnalyticsTimelineCount: externalAnalytics.timeline?.length ?? 0,
    operatorActionCardReadyCount: externalActionCard.ready ? 1 : 0,
    operatorActionCardBlockerCount: externalActionCard.blockers?.length ?? 0,
    operatorActionCardWarningCount: externalActionCard.warnings?.length ?? 0,
    recoveryAnalyticsTimelineCount: recoveryAnalytics.timeline?.length ?? 0,
    recoveryLifecycleCommandReadyCount: recoveryLifecycleCommands.ready ? 1 : 0,
    recoveryLifecycleCommandCount: recoveryLifecycleCommands.commands?.length ?? 0,
    recoveryLifecycleCommandBlockerCount: recoveryLifecycleCommands.blockers?.length ?? 0,
    boundaryRecoveryGuardReadyCount: externalWriteReport?.boundaryRecoveryGuard?.ready ? 1 : 0,
    boundaryRecoveryGuardBlockerCount: externalWriteReport?.boundaryRecoveryGuard?.blockers?.length ?? 0,
    boundaryRecoveryGuardWarningCount: externalWriteReport?.boundaryRecoveryGuard?.warnings?.length ?? 0,
    boundaryRecoveryGuardRetryableCount: externalWriteReport?.boundaryRecoveryGuard?.retryable ? 1 : 0,
    kernelTimelineCount: exportReport?.timeline?.length ?? 0,
    statusRecoveryTimelineCount: statusRecoveryPacket?.timeline?.length ?? 0,
    operatorBriefingCheckpointCount: operatorExportBriefing?.timeline?.length ?? 0,
    writeRequiredCount: externalWriteReport?.writeRequired ? 1 : 0,
    semanticBlockedCount: semantic.externalWrite?.status === 'blocked' || semantic.recovery?.status === 'blocked' ? 1 : 0
  };
  const state = failedCheckpoints.length
    ? 'blocked'
    : reviewCheckpoints.length
      ? 'review'
      : 'ready';
  const blockers = uniqueSorted(failedCheckpoints.flatMap((checkpoint) => [
    `analytics_checkpoint_failed:${checkpoint.name}`,
    ...checkpoint.blockers
  ]));
  const warnings = uniqueSorted(reviewCheckpoints.flatMap((checkpoint) => [
    `analytics_checkpoint_review:${checkpoint.name}`,
    ...checkpoint.warnings
  ]));
  const digest = stableHash({
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    counters,
    checkpoints: checkpoints.map((checkpoint) => `${checkpoint.name}:${checkpoint.outcome}:${checkpoint.digest}`),
    snapshots: historySnapshots.map((snapshot) => snapshot.id)
  });
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.mailchimp-analytics-export`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready: state === 'ready',
    counters,
    historySnapshots,
    timeline,
    exportSummary: {
      format: 'aios.mailchimp.lowering.analytics-export.v1',
      programId: kernelCall?.programId ?? null,
      operation: kernelCall?.operation ?? null,
      status: state,
      exportReady: state === 'ready',
      digest,
      externalWriteAnalyticsDigest: externalAnalytics.digest ?? null,
      operatorActionCardDigest: externalActionCard.digest ?? null,
      operatorActionCardAction: externalActionCard.primaryAction ?? null,
      recoveryAnalyticsDigest: recoveryAnalytics.reportDigest ?? null,
      recoveryLifecycleCommandDigest: recoveryLifecycleCommands.digest ?? null,
      recoveryLifecycleSelectedCommand: recoveryLifecycleCommands.selectedCommand ?? null,
      boundaryRecoveryGuardDigest: externalWriteReport?.boundaryRecoveryGuard?.guardDigest ?? null,
      boundaryRecoveryGuardState: externalWriteReport?.boundaryRecoveryGuard?.state ?? 'unknown',
      boundaryRecoveryReplayPolicy: externalWriteReport?.boundaryRecoveryGuard?.replayPolicy ?? null,
      mailchimpExportDigest: mailchimpExportHandoff?.digest ?? null,
      routeAcceptanceDigest: routeAcceptanceDecision?.digest ?? null,
      lifecycleControlDigest: lifecycleControlPanel?.digest ?? null,
      historySnapshotIds: historySnapshots.map((snapshot) => snapshot.id),
      failedCheckpoints: failedCheckpoints.map((checkpoint) => checkpoint.name),
      reviewCheckpoints: reviewCheckpoints.map((checkpoint) => checkpoint.name),
      counters
    },
    reporting: {
      channel: mailchimpExportHandoff?.auditChannel ?? kernelCall?.handoff?.audit?.channel ?? 'kernel.analytics.mailchimp.lowering',
      retention: externalWriteReport?.writeRequired ? 'durable_audit' : 'ephemeral_summary',
      latestSnapshotId: historySnapshots.at(-1)?.id ?? null,
      latestSnapshotDigest: stableHash(historySnapshots.at(-1) ?? {}),
      changedSinceExternalWriteExport: externalAnalytics.digest ? externalAnalytics.digest !== mailchimpExportHandoff?.externalWriteExportDigest : false
    },
    operatorActionCard: {
      state: externalActionCard.state ?? 'unknown',
      ready: externalActionCard.ready === true,
      primaryAction: externalActionCard.primaryAction ?? null,
      secondaryActions: externalActionCard.secondaryActions ?? [],
      commandId: externalActionCard.commandId ?? null,
      digest: externalActionCard.digest ?? null,
      validationSummary: externalActionCard.validationSummary ?? null,
      recoveryLifecycleCommand: recoveryLifecycleCommands.selectedCommand ?? null,
      recoveryLifecycleDigest: recoveryLifecycleCommands.digest ?? null
    },
    blockers,
    warnings,
    nextAction: blockers.length
      ? nextPlanActionForBlocker(blockers[0])
      : warnings.length
        ? 'review_mailchimp_analytics_export'
        : 'publish_mailchimp_analytics_export',
    digest
  };
}

function analyticsCheckpoint(name, status, ready, blockers = [], warnings = [], digest = null) {
  const normalizedBlockers = uniqueSorted(asArray(blockers).map((entry) => typeof entry === 'string' ? entry : entry?.code));
  const normalizedWarnings = uniqueSorted(asArray(warnings).map((entry) => typeof entry === 'string' ? entry : entry?.code));
  const normalizedStatus = status ?? 'unknown';
  const outcome = normalizedBlockers.length || normalizedStatus === 'blocked' || normalizedStatus === 'failed'
    ? 'failed'
    : normalizedWarnings.length || normalizedStatus === 'review' || normalizedStatus === 'degraded'
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
    digest: digest ?? null
  };
}

function validateMailchimpAnalyticsExportState(state, externalWriteReport) {
  const diagnostics = [];
  if (!state) return [{ level: 'error', code: 'missing_mailchimp_analytics_export_state' }];
  if (externalWriteReport?.writeRequired && state.exportSummary?.externalWriteAnalyticsDigest == null) {
    diagnostics.push({ level: 'error', code: 'mailchimp_analytics_export_missing_external_write_digest' });
  }
  if (externalWriteReport?.writeRequired && !state.operatorActionCard?.digest) {
    diagnostics.push({ level: 'error', code: 'mailchimp_analytics_export_missing_operator_action_card' });
  }
  if (state.operatorActionCard?.ready && !state.operatorActionCard?.primaryAction) {
    diagnostics.push({ level: 'error', code: 'mailchimp_analytics_export_operator_action_missing_primary_action' });
  }
  if (externalWriteReport?.writeRequired && !state.operatorActionCard?.recoveryLifecycleDigest) {
    diagnostics.push({ level: 'error', code: 'mailchimp_analytics_export_missing_recovery_lifecycle_digest' });
  }
  if (!state.digest) {
    diagnostics.push({ level: 'error', code: 'mailchimp_analytics_export_missing_digest' });
  }
  if (!state.historySnapshots?.length) {
    diagnostics.push({ level: 'error', code: 'mailchimp_analytics_export_missing_history' });
  }
  if (!state.timeline?.length) {
    diagnostics.push({ level: 'error', code: 'mailchimp_analytics_export_missing_timeline' });
  }
  if (state.ready && state.blockers?.length) {
    diagnostics.push({ level: 'error', code: 'mailchimp_analytics_export_ready_with_blockers', blockers: state.blockers });
  }
  if (state.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'mailchimp_analytics_export_blocked', blockers: state.blockers ?? [] });
  }
  if (state.state === 'review' || state.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'mailchimp_analytics_export_review', warnings: state.warnings ?? [] });
  }
  return diagnostics;
}

function normalizeLifecycleCommand(command, index) {
  const action = String(command?.action ?? command?.op ?? 'review').trim().toLowerCase();
  return {
    id: command?.id ?? `lifecycle:${stableHash({ index, action, command })}`,
    action,
    source: command?.source ?? 'program',
    enabled: command?.enabled,
    reason: command?.reason ?? null,
    settings: command?.settings ?? {},
    schedule: command?.schedule ?? {}
  };
}

function validateLifecycleSettings(settings) {
  const issues = [];
  const timeoutMs = Number(settings.timeoutMs ?? settings.timeout);
  const maxConcurrent = Number(settings.maxConcurrent ?? settings.concurrency);
  if ((settings.timeoutMs ?? settings.timeout) != null && (!Number.isFinite(timeoutMs) || timeoutMs < 100)) {
    issues.push({ level: 'error', code: 'lifecycle_timeout_invalid' });
  }
  if ((settings.maxConcurrent ?? settings.concurrency) != null && (!Number.isInteger(maxConcurrent) || maxConcurrent < 1)) {
    issues.push({ level: 'error', code: 'lifecycle_concurrency_invalid' });
  }
  if (settings.mode && !['automatic', 'manual', 'scheduled'].includes(String(settings.mode))) {
    issues.push({ level: 'warning', code: 'lifecycle_mode_unknown' });
  }
  return issues;
}

function validateLifecycleSchedule(schedule) {
  const issues = [];
  if (schedule.windowStart && schedule.windowEnd && String(schedule.windowStart) >= String(schedule.windowEnd)) {
    issues.push({ level: 'error', code: 'lifecycle_schedule_window_invalid' });
  }
  if (schedule.timezone === '') {
    issues.push({ level: 'warning', code: 'lifecycle_schedule_timezone_empty' });
  }
  if (schedule.retryAfterMs != null && Number(schedule.retryAfterMs) < 0) {
    issues.push({ level: 'error', code: 'lifecycle_schedule_retry_after_invalid' });
  }
  return issues;
}

function validateLifecycleCommand(command) {
  const issues = [];
  if (!['enable', 'disable', 'pause', 'hold', 'resume', 'schedule', 'reschedule', 'review'].includes(command.action)) {
    issues.push({ level: 'error', code: 'lifecycle_command_unknown', action: command.action });
  }
  if (['schedule', 'reschedule'].includes(command.action) && !Object.keys(command.schedule ?? {}).length) {
    issues.push({ level: 'warning', code: 'lifecycle_command_missing_schedule' });
  }
  return issues;
}

function lifecycleNextStateForCommand(action) {
  return {
    enable: 'enabled',
    resume: 'enabled',
    disable: 'disabled',
    pause: 'held',
    hold: 'held',
    schedule: 'scheduled',
    reschedule: 'scheduled'
  }[action] ?? 'review';
}

function lifecycleActionForBlocker(blocker) {
  if (String(blocker).includes('schedule')) return 'repair_lifecycle_schedule';
  if (String(blocker).includes('timeout') || String(blocker).includes('concurrency')) return 'repair_lifecycle_settings';
  if (String(blocker).includes('external_write')) return 'resolve_external_write_before_lifecycle_change';
  if (String(blocker).includes('recovery')) return 'resolve_recovery_before_lifecycle_change';
  if (String(blocker).includes('route_acceptance')) return 'repair_route_acceptance_before_lifecycle_change';
  return 'repair_lifecycle_controls';
}

function lifecycleActionForWarning(warning) {
  if (String(warning).includes('schedule')) return 'review_lifecycle_schedule';
  if (String(warning).includes('external_write')) return 'handoff_with_provider_degraded_ack';
  if (String(warning).includes('recovery')) return 'review_recovery_degraded_state';
  return 'review_lifecycle_controls';
}

function buildStatusRecoveryPacket({
  kernelCall,
  exportReport,
  acceptanceSummary,
  workflowAcceptancePacket,
  providerPersistence,
  clientRuntimeState,
  clientWorkflow,
  externalWriteReport,
  recoveryReport
}) {
  const restartRecovery = recoveryReport?.restartRecovery ?? {};
  const persistedWriteStatus = externalWriteReport?.persistedStatus ?? {};
  const statusJournal = externalWriteReport?.statusJournal ?? {};
  const externalStatusHandoff = externalWriteReport?.statusHandoff ?? {};
  const recoveryStatusHandoff = recoveryReport?.statusHandoff ?? {};
  const externalClientRequest = externalWriteReport?.clientRequestSnapshot ?? {};
  const recoveryClientRequest = recoveryReport?.persistedClientState?.clientRequestSnapshot
    ?? recoveryReport?.restartRecovery?.clientRequestSnapshot
    ?? {};
  const clientRequestSnapshot = {
    state: recoveryClientRequest.state ?? externalClientRequest.state ?? 'unknown',
    ready: recoveryClientRequest.ready === true || externalClientRequest.ready === true || !externalWriteReport?.writeRequired,
    digest: recoveryClientRequest.digest ?? externalClientRequest.digest ?? null,
    requestKey: recoveryClientRequest.requestKey ?? externalClientRequest.requestKey ?? null,
    requestId: externalClientRequest.requestId ?? null,
    workflowId: externalClientRequest.workflowId ?? null,
    visibleStatus: recoveryClientRequest.visibleStatus ?? externalClientRequest.visibleStatus?.current ?? null,
    commandCount: recoveryClientRequest.commandCount ?? externalClientRequest.commands?.length ?? 0,
    nextAction: recoveryClientRequest.nextAction ?? externalClientRequest.nextAction ?? null
  };
  const boundaryTicket = externalWriteReport?.boundaryTicket
    ?? persistedWriteStatus.boundaryTicket
    ?? recoveryReport?.provider?.boundaryTicket
    ?? {};
  const writeRequired = externalWriteReport?.writeRequired === true;
  const blockers = uniqueSorted([
    ...(workflowAcceptancePacket?.blockers ?? []),
    ...(providerPersistence?.blockers ?? []),
    ...(clientRuntimeState?.blockers ?? []),
    ...(restartRecovery.blockers ?? []),
    ...(persistedWriteStatus.blockers ?? []),
    ...(statusJournal.blockers ?? []).map((blocker) => `status_journal_${blocker}`),
    ...(externalStatusHandoff.blockers ?? []).map((blocker) => `external_status_handoff_${blocker}`),
    ...(recoveryStatusHandoff.blockers ?? []).map((blocker) => `recovery_status_handoff_${blocker}`),
    ...(boundaryTicket.blockers ?? []).map((blocker) => `boundary_${blocker}`),
    ...(boundaryTicket.ready === false && writeRequired ? ['boundary_ticket_not_ready'] : []),
    ...(!clientRequestSnapshot.digest && writeRequired ? ['missing_status_recovery_client_request_digest'] : []),
    ...(!clientRequestSnapshot.requestKey && writeRequired ? ['missing_status_recovery_client_request_key'] : []),
    ...(clientRequestSnapshot.ready === false && writeRequired ? ['client_request_snapshot_not_ready'] : []),
    ...(!workflowAcceptancePacket?.snapshotDigest && writeRequired ? ['missing_status_recovery_snapshot'] : []),
    ...(!statusJournal.digest && writeRequired ? ['missing_status_recovery_status_journal'] : []),
    ...(!externalStatusHandoff.digest && writeRequired ? ['missing_status_recovery_external_status_handoff'] : []),
    ...(!recoveryStatusHandoff.digest && writeRequired ? ['missing_status_recovery_recovery_status_handoff'] : []),
    ...(externalStatusHandoff.digest && recoveryStatusHandoff.externalDigest && externalStatusHandoff.digest !== recoveryStatusHandoff.externalDigest
      ? ['status_recovery_handoff_digest_mismatch']
      : []),
    ...(statusJournal.ready === false && writeRequired ? ['status_recovery_status_journal_not_ready'] : []),
    ...(!workflowAcceptancePacket?.idempotencyKey && writeRequired ? ['missing_status_recovery_idempotency_key'] : []),
    ...(!workflowAcceptancePacket?.statusChannel && writeRequired ? ['missing_status_recovery_channel'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : clientWorkflow?.state === 'held'
      ? 'held'
      : clientWorkflow?.state === 'scheduled'
        ? 'scheduled'
        : workflowAcceptancePacket?.ready && restartRecovery.ready !== false
          ? 'ready'
          : writeRequired
            ? 'waiting'
            : 'not_required';
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    commandId: workflowAcceptancePacket?.commandId ?? null,
    idempotencyKey: workflowAcceptancePacket?.idempotencyKey ?? null,
    statusChannel: workflowAcceptancePacket?.statusChannel ?? null,
    restartRecoveryDigest: restartRecovery.digest ?? null,
    persistedStatusDigest: persistedWriteStatus.digest ?? null,
    statusJournalDigest: statusJournal.digest ?? restartRecovery.statusJournalDigest ?? null,
    statusJournalState: statusJournal.state ?? restartRecovery.statusJournalState ?? 'unknown',
    externalStatusHandoffDigest: externalStatusHandoff.digest ?? null,
    recoveryStatusHandoffDigest: recoveryStatusHandoff.digest ?? null,
    boundaryAuditDigest: boundaryTicket.auditDigest ?? null,
    snapshotDigest: workflowAcceptancePacket?.snapshotDigest ?? null,
    clientRuntimeDigest: clientRuntimeState?.digest ?? null
  };
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.status-recovery-packet`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    commandId: workflowAcceptancePacket?.commandId ?? providerPersistence?.commandId ?? null,
    idempotencyKey: workflowAcceptancePacket?.idempotencyKey ?? providerPersistence?.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null,
    statusChannel: workflowAcceptancePacket?.statusChannel ?? providerPersistence?.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
    restartToken: workflowAcceptancePacket?.restartToken
      ?? restartRecovery.restartToken
      ?? clientRuntimeState?.restartToken
      ?? kernelCall?.runtimeState?.profileRestartToken
      ?? null,
    snapshotDigest: workflowAcceptancePacket?.snapshotDigest
      ?? restartRecovery.exportSnapshotDigest
      ?? exportReport?.history?.latest?.digest
      ?? null,
    persistedStatusDigest: persistedWriteStatus.digest ?? restartRecovery.statusDigest ?? null,
    statusJournal: {
      state: statusJournal.state ?? restartRecovery.statusJournalState ?? 'unknown',
      ready: statusJournal.ready === true || !writeRequired,
      digest: statusJournal.digest ?? restartRecovery.statusJournalDigest ?? null,
      latestCheckpoint: statusJournal.latestCheckpoint?.phase ?? restartRecovery.statusJournalLatestCheckpoint ?? null,
      commandCount: statusJournal.commands?.length ?? restartRecovery.statusJournalCommandIds?.length ?? 0,
      restartPolicy: statusJournal.restartSemantics?.onRestart ?? restartRecovery.statusJournalRestartPolicy ?? null,
      duplicateCommandPolicy: statusJournal.restartSemantics?.onDuplicateCommand ?? null,
      nextAction: statusJournal.nextAction ?? null
    },
    statusHandoff: {
      externalState: externalStatusHandoff.state ?? 'unknown',
      externalReady: externalStatusHandoff.ready === true || !writeRequired,
      externalDigest: externalStatusHandoff.digest ?? null,
      recoveryState: recoveryStatusHandoff.state ?? 'unknown',
      recoveryReady: recoveryStatusHandoff.ready === true || !writeRequired,
      recoveryDigest: recoveryStatusHandoff.digest ?? null,
      recoveryExternalDigest: recoveryStatusHandoff.externalDigest ?? null,
      commandId: recoveryStatusHandoff.commandId ?? externalStatusHandoff.commandId ?? null,
      statusChannel: recoveryStatusHandoff.statusChannel ?? externalStatusHandoff.statusChannel ?? null,
      nextAction: recoveryStatusHandoff.nextAction ?? externalStatusHandoff.nextAction ?? null
    },
    restartRecoveryDigest: restartRecovery.digest ?? null,
    clientRequestSnapshot,
    boundaryTicket: {
      state: boundaryTicket.state ?? 'unknown',
      ready: boundaryTicket.ready === true || !writeRequired,
      auditDigest: boundaryTicket.auditDigest ?? null,
      permissionMode: boundaryTicket.permissionMode ?? 'unknown',
      nextAction: boundaryTicket.nextAction ?? null
    },
    exportReady: exportReport?.analytics?.exportReady === true && acceptanceSummary?.exportReady === true,
    workflowReady: workflowAcceptancePacket?.ready === true,
    providerPersistenceStatus: providerPersistence?.status ?? 'unknown',
    clientRuntimeState: clientRuntimeState?.state ?? 'unknown',
    clientWorkflowState: clientWorkflow?.state ?? 'unknown',
    userVisibleStatus: {
      current: clientRuntimeState?.userVisibleStatus?.current
        ?? persistedWriteStatus.userVisibleStatus?.current
        ?? statusRecoveryUserStatus(state),
      completion: clientRuntimeState?.userVisibleStatus?.completion
        ?? persistedWriteStatus.userVisibleStatus?.completion
        ?? 'mailchimp_write_synced',
      failure: clientRuntimeState?.userVisibleStatus?.failure
        ?? persistedWriteStatus.userVisibleStatus?.failure
        ?? 'mailchimp_write_needs_review'
    },
    scope: {
      tenantId: workflowAcceptancePacket?.scope?.tenantId ?? clientRuntimeState?.scope?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
      workspaceId: workflowAcceptancePacket?.scope?.workspaceId ?? clientRuntimeState?.scope?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
      isolationKey: workflowAcceptancePacket?.scope?.isolationKey ?? clientRuntimeState?.scope?.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null
    },
    timeline: [
      { phase: 'external_write_status', state: persistedWriteStatus.state ?? 'unknown', digest: persistedWriteStatus.digest ?? null },
      { phase: 'external_write_status_journal', state: statusJournal.state ?? 'unknown', digest: statusJournal.digest ?? null },
      { phase: 'external_status_handoff', state: externalStatusHandoff.state ?? 'unknown', digest: externalStatusHandoff.digest ?? null },
      { phase: 'recovery_status_handoff', state: recoveryStatusHandoff.state ?? 'unknown', digest: recoveryStatusHandoff.digest ?? null },
      { phase: 'restart_recovery', state: restartRecovery.state ?? 'unknown', digest: restartRecovery.digest ?? null },
      { phase: 'tenant_boundary_ticket', state: boundaryTicket.state ?? 'unknown', digest: boundaryTicket.auditDigest ?? null },
      { phase: 'client_request_snapshot', state: clientRequestSnapshot.state, digest: clientRequestSnapshot.digest },
      { phase: 'provider_persistence', state: providerPersistence?.status ?? 'unknown', digest: providerPersistence?.digest ?? null },
      { phase: 'client_runtime_state', state: clientRuntimeState?.state ?? 'unknown', digest: clientRuntimeState?.digest ?? null },
      { phase: 'workflow_acceptance', state: workflowAcceptancePacket?.state ?? 'unknown', digest: workflowAcceptancePacket?.digest ?? null }
    ],
    blockers,
    nextAction: state === 'blocked'
      ? nextPlanActionForBlocker(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'publish_status_recovery_packet'
            : writeRequired
              ? workflowAcceptancePacket?.nextAction ?? 'wait_for_status_recovery_packet'
              : 'continue_read_only',
    digest: stableHash(digestShape)
  };
}

function validateStatusRecoveryPacket(packet, externalWriteReport) {
  if (!externalWriteReport?.writeRequired && !packet) return [];
  const diagnostics = [];
  if (!packet) return [{ level: 'error', code: 'missing_status_recovery_packet' }];
  if (externalWriteReport?.writeRequired && packet.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'status_recovery_packet_not_write_required' });
  }
  if (packet.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'status_recovery_packet_blocked', blockers: packet.blockers ?? [] });
  }
  if (packet.ready && externalWriteReport?.writeRequired && !packet.digest) {
    diagnostics.push({ level: 'error', code: 'status_recovery_packet_missing_digest' });
  }
  if (packet.ready && externalWriteReport?.writeRequired && !packet.snapshotDigest) {
    diagnostics.push({ level: 'warning', code: 'status_recovery_packet_missing_snapshot_digest' });
  }
  if (packet.ready && externalWriteReport?.writeRequired && !packet.statusJournal?.digest) {
    diagnostics.push({ level: 'error', code: 'status_recovery_packet_missing_status_journal_digest' });
  }
  if (externalWriteReport?.writeRequired && packet.statusJournal?.ready === false) {
    diagnostics.push({
      level: 'error',
      code: 'status_recovery_packet_status_journal_not_ready',
      statusJournal: packet.statusJournal
    });
  }
  if (externalWriteReport?.writeRequired && packet.boundaryTicket?.ready !== true) {
    diagnostics.push({
      level: 'error',
      code: 'status_recovery_packet_boundary_ticket_not_ready',
      boundaryTicket: packet.boundaryTicket
    });
  }
  if (packet.ready && externalWriteReport?.writeRequired && !packet.clientRequestSnapshot?.digest) {
    diagnostics.push({ level: 'error', code: 'status_recovery_packet_missing_client_request_digest' });
  }
  return diagnostics;
}

function buildMailchimpExportHandoff({
  kernelCall,
  exportReport,
  acceptanceSummary,
  workflowAcceptancePacket,
  providerContract,
  providerPersistence,
  clientRuntimeState,
  clientWorkflow,
  statusRecoveryPacket,
  externalWriteReport,
  recoveryReport
}) {
  const writeRequired = externalWriteReport?.writeRequired === true;
  const externalLedger = externalWriteReport?.exportLedger ?? {};
  const recoveryContinuity = recoveryReport?.exportContinuity ?? {};
  const externalStatusHandoff = externalWriteReport?.statusHandoff ?? {};
  const recoveryStatusHandoff = recoveryReport?.statusHandoff ?? {};
  const blockers = uniqueSorted([
    ...(acceptanceSummary?.blockers ?? []).map((blocker) => `acceptance_${blocker}`),
    ...(workflowAcceptancePacket?.blockers ?? []).map((blocker) => `workflow_${blocker}`),
    ...(providerPersistence?.blockers ?? []).map((blocker) => `provider_${blocker}`),
    ...(clientRuntimeState?.blockers ?? []).map((blocker) => `client_${blocker}`),
    ...(statusRecoveryPacket?.blockers ?? []).map((blocker) => `status_recovery_${blocker}`),
    ...(externalStatusHandoff.blockers ?? []).map((blocker) => `external_status_handoff_${blocker}`),
    ...(recoveryStatusHandoff.blockers ?? []).map((blocker) => `recovery_status_handoff_${blocker}`),
    ...(externalLedger.blockers ?? []).map((blocker) => `external_ledger_${blocker}`),
    ...(recoveryContinuity.blockers ?? []).map((blocker) => `recovery_continuity_${blocker}`),
    ...(providerContract?.negotiation?.blockers ?? []).map((blocker) => `provider_contract_${blocker}`),
    ...(!exportReport?.history?.latest?.digest && writeRequired ? ['missing_mailchimp_export_snapshot'] : []),
    ...(!externalLedger.digest && writeRequired ? ['missing_external_write_export_ledger'] : []),
    ...(!recoveryContinuity.digest && writeRequired ? ['missing_recovery_export_continuity'] : []),
    ...(!externalStatusHandoff.digest && writeRequired ? ['missing_mailchimp_external_status_handoff'] : []),
    ...(!recoveryStatusHandoff.digest && writeRequired ? ['missing_mailchimp_recovery_status_handoff'] : []),
    ...(externalStatusHandoff.digest && recoveryStatusHandoff.externalDigest && externalStatusHandoff.digest !== recoveryStatusHandoff.externalDigest
      ? ['mailchimp_status_handoff_digest_mismatch']
      : []),
    ...(!workflowAcceptancePacket?.idempotencyKey && writeRequired ? ['missing_mailchimp_export_idempotency_key'] : []),
    ...(!workflowAcceptancePacket?.statusChannel && writeRequired ? ['missing_mailchimp_export_status_channel'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(acceptanceSummary?.warnings ?? []),
    ...(clientWorkflow?.warnings ?? []),
    ...(providerContract?.negotiation?.warnings ?? []).map((warning) => `provider_contract_${warning}`),
    ...(externalLedger.warnings ?? []).map((warning) => `external_ledger_${warning}`),
    ...(externalStatusHandoff.warnings ?? []).map((warning) => `external_status_${warning}`),
    ...(recoveryStatusHandoff.warnings ?? []).map((warning) => `recovery_status_${warning}`),
    ...(recoveryReport?.status === 'degraded' ? ['recovery_degraded'] : []),
    ...(externalWriteReport?.status === 'review' ? ['external_write_review'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : clientWorkflow?.state === 'held'
      ? 'held'
      : clientWorkflow?.state === 'scheduled'
        ? 'scheduled'
        : workflowAcceptancePacket?.ready
          && statusRecoveryPacket?.ready
          && providerPersistence?.status === 'ready'
          && clientRuntimeState?.ready
          && (!writeRequired || (externalLedger.ready && recoveryContinuity.ready))
          ? 'ready'
          : writeRequired
            ? 'waiting'
            : 'not_required';
  const timeline = [
    {
      phase: 'kernel_export',
      state: exportReport?.exportSummary?.readinessState ?? 'unknown',
      digest: exportReport?.history?.latest?.digest ?? null,
      ready: exportReport?.analytics?.exportReady === true
    },
    {
      phase: 'external_write_ledger',
      state: externalLedger.state ?? 'unknown',
      digest: externalLedger.digest ?? null,
      ready: externalLedger.ready === true || !writeRequired
    },
    {
      phase: 'external_status_handoff',
      state: externalStatusHandoff.state ?? 'unknown',
      digest: externalStatusHandoff.digest ?? null,
      ready: externalStatusHandoff.ready === true || !writeRequired
    },
    {
      phase: 'recovery_status_handoff',
      state: recoveryStatusHandoff.state ?? 'unknown',
      digest: recoveryStatusHandoff.digest ?? null,
      ready: recoveryStatusHandoff.ready === true || !writeRequired
    },
    {
      phase: 'recovery_continuity',
      state: recoveryContinuity.state ?? 'unknown',
      digest: recoveryContinuity.digest ?? null,
      ready: recoveryContinuity.ready === true || !writeRequired
    },
    {
      phase: 'provider_persistence',
      state: providerPersistence?.status ?? 'unknown',
      digest: providerPersistence?.digest ?? null,
      ready: providerPersistence?.status === 'ready' || !writeRequired
    },
    {
      phase: 'workflow_acceptance',
      state: workflowAcceptancePacket?.state ?? 'unknown',
      digest: workflowAcceptancePacket?.digest ?? null,
      ready: workflowAcceptancePacket?.ready === true || !writeRequired
    },
    {
      phase: 'status_recovery',
      state: statusRecoveryPacket?.state ?? 'unknown',
      digest: statusRecoveryPacket?.digest ?? null,
      ready: statusRecoveryPacket?.ready === true || !writeRequired
    }
  ];
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    snapshotDigest: exportReport?.history?.latest?.digest ?? null,
    externalLedgerDigest: externalLedger.digest ?? null,
    recoveryContinuityDigest: recoveryContinuity.digest ?? null,
    externalStatusHandoffDigest: externalStatusHandoff.digest ?? null,
    recoveryStatusHandoffDigest: recoveryStatusHandoff.digest ?? null,
    workflowAcceptanceDigest: workflowAcceptancePacket?.digest ?? null,
    statusRecoveryDigest: statusRecoveryPacket?.digest ?? null,
    commandId: workflowAcceptancePacket?.commandId ?? providerPersistence?.commandId ?? null
  };
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.mailchimp-export-handoff`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    provider: providerContract?.provider ?? kernelCall?.adapter ?? 'mailchimp',
    service: 'mailchimp',
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    commandId: workflowAcceptancePacket?.commandId ?? providerPersistence?.commandId ?? null,
    idempotencyKey: workflowAcceptancePacket?.idempotencyKey ?? providerPersistence?.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null,
    statusChannel: workflowAcceptancePacket?.statusChannel ?? providerPersistence?.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
    restartToken: workflowAcceptancePacket?.restartToken ?? recoveryContinuity.restartToken ?? clientRuntimeState?.restartToken ?? null,
    snapshotDigest: exportReport?.history?.latest?.digest ?? null,
    externalLedgerDigest: externalLedger.digest ?? null,
    recoveryContinuityDigest: recoveryContinuity.digest ?? null,
    externalStatusHandoffDigest: externalStatusHandoff.digest ?? null,
    recoveryStatusHandoffDigest: recoveryStatusHandoff.digest ?? null,
    workflowAcceptanceDigest: workflowAcceptancePacket?.digest ?? null,
    statusRecoveryDigest: statusRecoveryPacket?.digest ?? null,
    exportReady: state === 'ready'
      && acceptanceSummary?.exportReady === true
      && exportReport?.analytics?.exportReady === true,
    scope: {
      tenantId: workflowAcceptancePacket?.scope?.tenantId ?? clientRuntimeState?.scope?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
      workspaceId: workflowAcceptancePacket?.scope?.workspaceId ?? clientRuntimeState?.scope?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
      isolationKey: workflowAcceptancePacket?.scope?.isolationKey ?? clientRuntimeState?.scope?.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null
    },
    userVisibleStatus: {
      current: clientRuntimeState?.userVisibleStatus?.current
        ?? recoveryContinuity.userVisibleStatus?.current
        ?? externalLedger.userVisibleStatus?.current
        ?? mailchimpExportStatus(state),
      completion: clientRuntimeState?.userVisibleStatus?.completion
        ?? recoveryContinuity.userVisibleStatus?.completion
        ?? 'mailchimp_write_synced',
      failure: clientRuntimeState?.userVisibleStatus?.failure
        ?? recoveryContinuity.userVisibleStatus?.failure
        ?? 'mailchimp_write_needs_review'
    },
    counters: {
      checkpointCount: timeline.length,
      readyCheckpointCount: timeline.filter((checkpoint) => checkpoint.ready).length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      writeRequiredCount: writeRequired ? 1 : 0,
      statusHandoffReadyCount: externalStatusHandoff.ready && recoveryStatusHandoff.ready ? 1 : 0
    },
    timeline,
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? mailchimpExportAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'publish_mailchimp_export_handoff'
            : writeRequired
              ? workflowAcceptancePacket?.nextAction ?? statusRecoveryPacket?.nextAction ?? 'wait_for_mailchimp_export_handoff'
              : 'continue_read_only',
    digest: stableHash(digestShape)
  };
}

function validateMailchimpExportHandoff(handoff, externalWriteReport) {
  if (!externalWriteReport?.writeRequired && !handoff) return [];
  const diagnostics = [];
  if (!handoff) return [{ level: 'error', code: 'missing_mailchimp_export_handoff' }];
  if (externalWriteReport?.writeRequired && handoff.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'mailchimp_export_handoff_not_write_required' });
  }
  if (handoff.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'mailchimp_export_handoff_blocked', blockers: handoff.blockers ?? [] });
  }
  if (handoff.ready && externalWriteReport?.writeRequired && !handoff.digest) {
    diagnostics.push({ level: 'error', code: 'mailchimp_export_handoff_missing_digest' });
  }
  if (handoff.ready && externalWriteReport?.writeRequired && !handoff.externalLedgerDigest) {
    diagnostics.push({ level: 'error', code: 'mailchimp_export_handoff_missing_external_ledger' });
  }
  if (handoff.ready && externalWriteReport?.writeRequired && !handoff.recoveryContinuityDigest) {
    diagnostics.push({ level: 'error', code: 'mailchimp_export_handoff_missing_recovery_continuity' });
  }
  return diagnostics;
}

function buildOperatorExportBriefing({
  kernelCall,
  uiPreview,
  acceptanceSummary,
  workflowAcceptancePacket,
  statusRecoveryPacket,
  mailchimpExportHandoff,
  providerContract,
  providerPersistence,
  clientRuntimeState,
  clientWorkflow,
  externalWriteReport,
  recoveryReport,
  exportReport
}) {
  const previewSummary = summarizeKernelCallUIPreview(uiPreview);
  const writeRequired = externalWriteReport?.writeRequired === true;
  const blockers = uniqueSorted([
    ...(acceptanceSummary?.blockers ?? []).map((blocker) => `acceptance_${blocker}`),
    ...(workflowAcceptancePacket?.blockers ?? []).map((blocker) => `workflow_${blocker}`),
    ...(statusRecoveryPacket?.blockers ?? []).map((blocker) => `status_recovery_${blocker}`),
    ...(mailchimpExportHandoff?.blockers ?? []).map((blocker) => `export_${blocker}`),
    ...(clientWorkflow?.blockers ?? []).map((blocker) => `client_workflow_${blocker}`),
    ...(providerPersistence?.blockers ?? []).map((blocker) => `provider_persistence_${blocker}`),
    ...(clientRuntimeState?.blockers ?? []).map((blocker) => `client_runtime_${blocker}`),
    ...(externalWriteReport?.blockedReasons ?? []).map((blocker) => `external_write_${blocker}`),
    ...(recoveryReport?.blockedReasons ?? []).map((blocker) => `recovery_${blocker}`),
    ...(!exportReport?.history?.latest?.digest && writeRequired ? ['missing_operator_export_snapshot'] : []),
    ...(!workflowAcceptancePacket?.idempotencyKey && writeRequired ? ['missing_operator_idempotency_key'] : []),
    ...(!workflowAcceptancePacket?.statusChannel && writeRequired ? ['missing_operator_status_channel'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(acceptanceSummary?.warnings ?? []),
    ...(workflowAcceptancePacket?.warnings ?? []),
    ...(mailchimpExportHandoff?.warnings ?? []),
    ...(clientWorkflow?.warnings ?? []),
    ...(externalWriteReport?.status === 'review' ? ['external_write_review'] : []),
    ...(recoveryReport?.status === 'degraded' ? ['recovery_degraded'] : []),
    ...(providerContract?.health?.degraded ? ['provider_degraded'] : [])
  ]);
  const checkpoints = [
    {
      id: 'preview',
      label: 'Preview',
      state: previewSummary.readiness,
      ready: previewSummary.acceptEnabled === true,
      digest: stableHash({
        readiness: previewSummary.readiness,
        acceptance: previewSummary.acceptance,
        nextAction: previewSummary.nextAction
      }),
      nextAction: previewSummary.nextAction ?? acceptanceSummary?.nextAction ?? null
    },
    {
      id: 'acceptance',
      label: 'Acceptance',
      state: workflowAcceptancePacket?.state ?? 'unknown',
      ready: workflowAcceptancePacket?.ready === true,
      digest: workflowAcceptancePacket?.digest ?? null,
      nextAction: workflowAcceptancePacket?.nextAction ?? null
    },
    {
      id: 'status_recovery',
      label: 'Status Recovery',
      state: statusRecoveryPacket?.state ?? 'unknown',
      ready: statusRecoveryPacket?.ready === true,
      digest: statusRecoveryPacket?.digest ?? null,
      nextAction: statusRecoveryPacket?.nextAction ?? null
    },
    {
      id: 'mailchimp_export',
      label: 'Mailchimp Export',
      state: mailchimpExportHandoff?.state ?? 'unknown',
      ready: mailchimpExportHandoff?.ready === true,
      digest: mailchimpExportHandoff?.digest ?? null,
      nextAction: mailchimpExportHandoff?.nextAction ?? null
    },
    {
      id: 'client_runtime',
      label: 'Client Runtime',
      state: clientRuntimeState?.state ?? 'unknown',
      ready: clientRuntimeState?.ready === true,
      digest: clientRuntimeState?.digest ?? null,
      nextAction: clientRuntimeState?.nextAction ?? null
    }
  ];
  const state = blockers.length
    ? 'blocked'
    : clientWorkflow?.state === 'held'
      ? 'held'
      : clientWorkflow?.state === 'scheduled'
        ? 'scheduled'
        : checkpoints.every((checkpoint) => checkpoint.ready || (!writeRequired && checkpoint.id !== 'preview'))
          ? 'ready'
          : warnings.length
            ? 'review'
            : 'waiting';
  const userVisibleStatus = {
    current: clientRuntimeState?.userVisibleStatus?.current
      ?? mailchimpExportHandoff?.userVisibleStatus?.current
      ?? operatorBriefingStatus(state),
    completion: clientRuntimeState?.userVisibleStatus?.completion
      ?? mailchimpExportHandoff?.userVisibleStatus?.completion
      ?? 'mailchimp_write_synced',
    failure: clientRuntimeState?.userVisibleStatus?.failure
      ?? mailchimpExportHandoff?.userVisibleStatus?.failure
      ?? 'mailchimp_write_needs_review'
  };
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    snapshotDigest: exportReport?.history?.latest?.digest ?? null,
    workflowAcceptanceDigest: workflowAcceptancePacket?.digest ?? null,
    statusRecoveryDigest: statusRecoveryPacket?.digest ?? null,
    mailchimpExportDigest: mailchimpExportHandoff?.digest ?? null,
    currentStatus: userVisibleStatus.current,
    blockers
  };

  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.operator-export-briefing`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    provider: providerContract?.provider ?? kernelCall?.adapter ?? 'mailchimp',
    service: 'mailchimp',
    state,
    ready: state === 'ready',
    writeRequired,
    acceptEnabled: acceptanceSummary?.acceptEnabled === true && workflowAcceptancePacket?.acceptEnabled === true,
    commandId: workflowAcceptancePacket?.commandId ?? providerPersistence?.commandId ?? null,
    idempotencyKey: workflowAcceptancePacket?.idempotencyKey ?? providerPersistence?.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null,
    statusChannel: workflowAcceptancePacket?.statusChannel ?? providerPersistence?.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
    restartToken: workflowAcceptancePacket?.restartToken ?? clientRuntimeState?.restartToken ?? recoveryReport?.sync?.restartToken ?? null,
    snapshotDigest: exportReport?.history?.latest?.digest ?? null,
    userVisibleStatus,
    preview: {
      readiness: previewSummary.readiness,
      acceptance: previewSummary.acceptance,
      nextAction: previewSummary.nextAction ?? null,
      missingAcknowledgements: acceptanceSummary?.missingAcknowledgements ?? []
    },
    exportReadiness: {
      kernelExportReady: exportReport?.analytics?.exportReady === true,
      acceptanceExportReady: acceptanceSummary?.exportReady === true,
      mailchimpExportReady: mailchimpExportHandoff?.ready === true,
      statusRecoveryReady: statusRecoveryPacket?.ready === true,
      changedSincePrevious: exportReport?.history?.changedSincePrevious === true
    },
    providerState: {
      contractStatus: providerContract?.negotiation?.status ?? 'unknown',
      healthStatus: providerContract?.health?.status ?? 'unknown',
      persistenceStatus: providerPersistence?.status ?? 'unknown',
      commandId: providerPersistence?.commandId ?? workflowAcceptancePacket?.commandId ?? null,
      replaySafe: providerPersistence?.safeToReplay === true
    },
    timeline: checkpoints,
    counters: {
      checkpointCount: checkpoints.length,
      readyCheckpointCount: checkpoints.filter((checkpoint) => checkpoint.ready).length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      missingAcknowledgementCount: acceptanceSummary?.missingAcknowledgements?.length ?? 0,
      writeRequiredCount: writeRequired ? 1 : 0
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? operatorBriefingAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'present_mailchimp_export_briefing'
            : checkpoints.find((checkpoint) => checkpoint.ready !== true)?.nextAction
              ?? mailchimpExportHandoff?.nextAction
              ?? acceptanceSummary?.nextAction
              ?? 'operator_review',
    digest: stableHash(digestShape)
  };
}

function validateOperatorExportBriefing(briefing, externalWriteReport) {
  if (!externalWriteReport?.writeRequired && !briefing) return [];
  const diagnostics = [];
  if (!briefing) return [{ level: 'error', code: 'missing_operator_export_briefing' }];
  if (externalWriteReport?.writeRequired && briefing.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'operator_export_briefing_not_write_required' });
  }
  if (briefing.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'operator_export_briefing_blocked', blockers: briefing.blockers ?? [] });
  }
  if (briefing.ready && externalWriteReport?.writeRequired && !briefing.snapshotDigest) {
    diagnostics.push({ level: 'warning', code: 'operator_export_briefing_missing_snapshot_digest' });
  }
  if (briefing.ready && externalWriteReport?.writeRequired && !briefing.idempotencyKey) {
    diagnostics.push({ level: 'error', code: 'operator_export_briefing_missing_idempotency_key' });
  }
  if (briefing.ready && briefing.acceptEnabled !== true) {
    diagnostics.push({ level: 'error', code: 'operator_export_briefing_ready_without_acceptance' });
  }
  return diagnostics;
}

function buildRouteAcceptanceDecision({
  kernelCall,
  acceptanceSummary,
  workflowAcceptancePacket,
  statusRecoveryPacket,
  mailchimpExportHandoff,
  operatorExportBriefing,
  providerPersistence,
  clientRuntimeState,
  clientWorkflow,
  externalWriteReport,
  recoveryReport,
  exportReport
}) {
  const writeRequired = externalWriteReport?.writeRequired === true;
  const checks = [
    {
      id: 'kernel-preview',
      label: 'Kernel Preview',
      state: acceptanceSummary?.readinessState ?? 'unknown',
      ready: acceptanceSummary?.acceptEnabled === true,
      digest: stableHash({
        readinessState: acceptanceSummary?.readinessState ?? null,
        acceptanceState: acceptanceSummary?.acceptanceState ?? null,
        missingAcknowledgements: acceptanceSummary?.missingAcknowledgements ?? []
      }),
      nextAction: acceptanceSummary?.nextAction ?? null
    },
    {
      id: 'workflow-acceptance',
      label: 'Workflow Acceptance',
      state: workflowAcceptancePacket?.state ?? 'unknown',
      ready: workflowAcceptancePacket?.ready === true,
      digest: workflowAcceptancePacket?.digest ?? null,
      nextAction: workflowAcceptancePacket?.nextAction ?? null
    },
    {
      id: 'status-recovery',
      label: 'Status Recovery',
      state: statusRecoveryPacket?.state ?? 'unknown',
      ready: statusRecoveryPacket?.ready === true || !writeRequired,
      digest: statusRecoveryPacket?.digest ?? null,
      nextAction: statusRecoveryPacket?.nextAction ?? null
    },
    {
      id: 'mailchimp-export',
      label: 'Mailchimp Export',
      state: mailchimpExportHandoff?.state ?? 'unknown',
      ready: mailchimpExportHandoff?.ready === true || !writeRequired,
      digest: mailchimpExportHandoff?.digest ?? null,
      nextAction: mailchimpExportHandoff?.nextAction ?? null
    },
    {
      id: 'operator-briefing',
      label: 'Operator Briefing',
      state: operatorExportBriefing?.state ?? 'unknown',
      ready: operatorExportBriefing?.ready === true,
      digest: operatorExportBriefing?.digest ?? null,
      nextAction: operatorExportBriefing?.nextAction ?? null
    }
  ];
  const blockers = uniqueSorted([
    ...(acceptanceSummary?.blockers ?? []).map((blocker) => `preview_${blocker}`),
    ...(workflowAcceptancePacket?.blockers ?? []).map((blocker) => `workflow_${blocker}`),
    ...(statusRecoveryPacket?.blockers ?? []).map((blocker) => `status_${blocker}`),
    ...(mailchimpExportHandoff?.blockers ?? []).map((blocker) => `export_${blocker}`),
    ...(operatorExportBriefing?.blockers ?? []).map((blocker) => `operator_${blocker}`),
    ...(externalWriteReport?.blockedReasons ?? []).map((blocker) => `external_write_${blocker}`),
    ...(recoveryReport?.blockedReasons ?? []).map((blocker) => `recovery_${blocker}`),
    ...(!workflowAcceptancePacket?.commandId && writeRequired ? ['missing_route_command_id'] : []),
    ...(!workflowAcceptancePacket?.idempotencyKey && writeRequired ? ['missing_route_idempotency_key'] : []),
    ...(!workflowAcceptancePacket?.statusChannel && writeRequired ? ['missing_route_status_channel'] : []),
    ...(!workflowAcceptancePacket?.restartToken && recoveryReport?.handoff?.requiresResume ? ['missing_route_restart_token'] : []),
    ...(!operatorExportBriefing?.snapshotDigest && writeRequired ? ['missing_route_snapshot_digest'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(acceptanceSummary?.warnings ?? []).map((warning) => `preview_${warning}`),
    ...(workflowAcceptancePacket?.warnings ?? []).map((warning) => `workflow_${warning}`),
    ...(mailchimpExportHandoff?.warnings ?? []).map((warning) => `export_${warning}`),
    ...(operatorExportBriefing?.warnings ?? []).map((warning) => `operator_${warning}`),
    ...(externalWriteReport?.status === 'review' ? ['external_write_review'] : []),
    ...(recoveryReport?.status === 'degraded' ? ['recovery_degraded'] : []),
    ...(exportReport?.history?.changedSincePrevious ? ['export_snapshot_changed'] : [])
  ]);
  const firstUnready = checks.find((check) => check.ready !== true);
  const state = blockers.length
    ? 'blocked'
    : clientWorkflow?.state === 'held'
      ? 'held'
      : clientWorkflow?.state === 'scheduled'
        ? 'scheduled'
        : checks.every((check) => check.ready)
          ? 'ready'
          : warnings.length
            ? 'review'
            : 'waiting';
  const ready = state === 'ready'
    && workflowAcceptancePacket?.acceptEnabled === true
    && operatorExportBriefing?.acceptEnabled === true;
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    commandId: workflowAcceptancePacket?.commandId ?? providerPersistence?.commandId ?? null,
    idempotencyKey: workflowAcceptancePacket?.idempotencyKey ?? providerPersistence?.idempotencyKey ?? null,
    statusChannel: workflowAcceptancePacket?.statusChannel ?? providerPersistence?.statusChannel ?? null,
    restartToken: workflowAcceptancePacket?.restartToken ?? clientRuntimeState?.restartToken ?? null,
    snapshotDigest: operatorExportBriefing?.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null,
    checkDigests: checks.map((check) => `${check.id}:${check.digest ?? 'none'}`),
    blockers
  };
  const decisionId = `route-acceptance:${stableHash(digestShape)}`;
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.route-acceptance-decision`,
    decisionId,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready,
    writeRequired,
    presentationMode: state === 'ready'
      ? 'confirm'
      : state === 'review'
        ? 'review'
        : state === 'held'
          ? 'manual_release'
          : state === 'scheduled'
            ? 'scheduled'
            : 'repair',
    commandId: workflowAcceptancePacket?.commandId ?? providerPersistence?.commandId ?? null,
    idempotencyKey: workflowAcceptancePacket?.idempotencyKey ?? providerPersistence?.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null,
    statusChannel: workflowAcceptancePacket?.statusChannel ?? providerPersistence?.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
    restartToken: workflowAcceptancePacket?.restartToken ?? clientRuntimeState?.restartToken ?? recoveryReport?.sync?.restartToken ?? null,
    snapshotDigest: operatorExportBriefing?.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null,
    userVisibleStatus: {
      current: operatorExportBriefing?.userVisibleStatus?.current
        ?? mailchimpExportHandoff?.userVisibleStatus?.current
        ?? clientRuntimeState?.userVisibleStatus?.current
        ?? routeAcceptanceStatus(state),
      completion: operatorExportBriefing?.userVisibleStatus?.completion
        ?? clientRuntimeState?.userVisibleStatus?.completion
        ?? 'mailchimp_write_synced',
      failure: operatorExportBriefing?.userVisibleStatus?.failure
        ?? clientRuntimeState?.userVisibleStatus?.failure
        ?? 'mailchimp_write_needs_review'
    },
    scope: {
      tenantId: workflowAcceptancePacket?.scope?.tenantId ?? clientRuntimeState?.scope?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
      workspaceId: workflowAcceptancePacket?.scope?.workspaceId ?? clientRuntimeState?.scope?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
      isolationKey: workflowAcceptancePacket?.scope?.isolationKey ?? clientRuntimeState?.scope?.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null
    },
    validationSummary: {
      readyCheckCount: checks.filter((check) => check.ready).length,
      totalCheckCount: checks.length,
      firstUnreadyCheck: firstUnready?.id ?? null,
      blockers,
      warnings,
      checks
    },
    acceptCommand: {
      id: ready ? `accept-mailchimp-route:${stableHash({ decisionId, commandId: digestShape.commandId })}` : null,
      type: 'accept-mailchimp-route-preview',
      idempotencyKey: ready ? stableHash({ decisionId, idempotencyKey: digestShape.idempotencyKey, action: 'accept' }) : null,
      requiredInputs: ['decisionId', 'idempotencyKey', 'statusChannel', 'snapshotDigest'].filter((name) => (
        name !== 'snapshotDigest' || writeRequired
      )),
      statusAfterReplay: ready ? 'route_preview_accepted' : 'route_preview_waiting',
      conflict: 'return-existing'
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? routeAcceptanceAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'ready'
            ? 'present_route_acceptance_confirmation'
            : firstUnready?.nextAction
              ?? operatorExportBriefing?.nextAction
              ?? acceptanceSummary?.nextAction
              ?? 'operator_review',
    digest: stableHash(digestShape)
  };
}

function validateRouteAcceptanceDecision(decision, externalWriteReport) {
  if (!externalWriteReport?.writeRequired && !decision) return [];
  const diagnostics = [];
  if (!decision) return [{ level: 'error', code: 'missing_route_acceptance_decision' }];
  if (externalWriteReport?.writeRequired && decision.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'route_acceptance_decision_not_write_required' });
  }
  if (decision.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'route_acceptance_decision_blocked', blockers: decision.blockers ?? [] });
  }
  if (decision.ready && !decision.acceptCommand?.id) {
    diagnostics.push({ level: 'error', code: 'route_acceptance_ready_missing_accept_command' });
  }
  if (decision.ready && externalWriteReport?.writeRequired && !decision.snapshotDigest) {
    diagnostics.push({ level: 'warning', code: 'route_acceptance_missing_snapshot_digest' });
  }
  if (decision.ready && decision.validationSummary?.readyCheckCount !== decision.validationSummary?.totalCheckCount) {
    diagnostics.push({ level: 'error', code: 'route_acceptance_ready_with_unready_checks' });
  }
  return diagnostics;
}

function buildRouteClientAcceptanceHandoff({
  kernelCall,
  acceptanceSummary,
  workflowAcceptancePacket,
  statusRecoveryPacket,
  mailchimpExportHandoff,
  operatorExportBriefing,
  routeAcceptanceDecision,
  providerPersistence,
  clientRuntimeState,
  clientWorkflow,
  externalWriteReport,
  recoveryReport,
  exportReport
}) {
  const writeRequired = externalWriteReport?.writeRequired === true;
  const checks = [
    {
      id: 'route-decision',
      state: routeAcceptanceDecision?.state ?? 'unknown',
      ready: routeAcceptanceDecision?.ready === true,
      digest: routeAcceptanceDecision?.digest ?? null,
      nextAction: routeAcceptanceDecision?.nextAction ?? null
    },
    {
      id: 'workflow-acceptance',
      state: workflowAcceptancePacket?.state ?? 'unknown',
      ready: workflowAcceptancePacket?.ready === true,
      digest: workflowAcceptancePacket?.digest ?? null,
      nextAction: workflowAcceptancePacket?.nextAction ?? null
    },
    {
      id: 'status-recovery',
      state: statusRecoveryPacket?.state ?? 'unknown',
      ready: statusRecoveryPacket?.ready === true || !writeRequired,
      digest: statusRecoveryPacket?.digest ?? null,
      nextAction: statusRecoveryPacket?.nextAction ?? null
    },
    {
      id: 'mailchimp-export',
      state: mailchimpExportHandoff?.state ?? 'unknown',
      ready: mailchimpExportHandoff?.ready === true || !writeRequired,
      digest: mailchimpExportHandoff?.digest ?? null,
      nextAction: mailchimpExportHandoff?.nextAction ?? null
    },
    {
      id: 'operator-briefing',
      state: operatorExportBriefing?.state ?? 'unknown',
      ready: operatorExportBriefing?.ready === true,
      digest: operatorExportBriefing?.digest ?? null,
      nextAction: operatorExportBriefing?.nextAction ?? null
    },
    {
      id: 'client-runtime',
      state: clientRuntimeState?.state ?? 'unknown',
      ready: clientRuntimeState?.ready === true || !writeRequired,
      digest: clientRuntimeState?.digest ?? null,
      nextAction: clientRuntimeState?.nextAction ?? null
    }
  ];
  const blockers = uniqueSorted([
    ...(routeAcceptanceDecision?.blockers ?? []).map((blocker) => `route_${blocker}`),
    ...(workflowAcceptancePacket?.blockers ?? []).map((blocker) => `workflow_${blocker}`),
    ...(statusRecoveryPacket?.blockers ?? []).map((blocker) => `status_${blocker}`),
    ...(mailchimpExportHandoff?.blockers ?? []).map((blocker) => `export_${blocker}`),
    ...(operatorExportBriefing?.blockers ?? []).map((blocker) => `operator_${blocker}`),
    ...(clientRuntimeState?.blockers ?? []).map((blocker) => `client_${blocker}`),
    ...(externalWriteReport?.blockedReasons ?? []).map((blocker) => `external_write_${blocker}`),
    ...(recoveryReport?.blockedReasons ?? []).map((blocker) => `recovery_${blocker}`),
    ...(!routeAcceptanceDecision?.acceptCommand?.id && routeAcceptanceDecision?.ready ? ['missing_client_route_accept_command'] : []),
    ...(!workflowAcceptancePacket?.idempotencyKey && writeRequired ? ['missing_client_route_idempotency_key'] : []),
    ...(!workflowAcceptancePacket?.statusChannel && writeRequired ? ['missing_client_route_status_channel'] : []),
    ...(!routeAcceptanceDecision?.snapshotDigest && writeRequired ? ['missing_client_route_snapshot_digest'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(routeAcceptanceDecision?.warnings ?? []).map((warning) => `route_${warning}`),
    ...(workflowAcceptancePacket?.warnings ?? []).map((warning) => `workflow_${warning}`),
    ...(mailchimpExportHandoff?.warnings ?? []).map((warning) => `export_${warning}`),
    ...(operatorExportBriefing?.warnings ?? []).map((warning) => `operator_${warning}`),
    ...(acceptanceSummary?.warnings ?? []).map((warning) => `acceptance_${warning}`),
    ...(externalWriteReport?.status === 'review' ? ['external_write_review'] : []),
    ...(recoveryReport?.status === 'degraded' ? ['recovery_degraded'] : []),
    ...(exportReport?.history?.changedSincePrevious ? ['export_snapshot_changed'] : [])
  ]);
  const firstUnready = checks.find((check) => check.ready !== true);
  const state = blockers.length
    ? 'blocked'
    : clientWorkflow?.state === 'held'
      ? 'held'
      : clientWorkflow?.state === 'scheduled'
        ? 'scheduled'
        : routeAcceptanceDecision?.state === 'review' || warnings.length
          ? 'review'
          : checks.every((check) => check.ready)
            ? 'ready'
            : 'waiting';
  const ready = state === 'ready'
    && routeAcceptanceDecision?.ready === true
    && workflowAcceptancePacket?.acceptEnabled === true;
  const commandId = ready
    ? `client-route-acceptance:${stableHash({
        decisionId: routeAcceptanceDecision?.decisionId,
        routeDigest: routeAcceptanceDecision?.digest,
        providerCommandId: providerPersistence?.commandId ?? workflowAcceptancePacket?.commandId ?? null
      })}`
    : null;
  const idempotencyKey = ready
    ? stableHash({
        action: 'persist-client-route-acceptance',
        decisionId: routeAcceptanceDecision?.decisionId,
        idempotencyKey: workflowAcceptancePacket?.idempotencyKey ?? providerPersistence?.idempotencyKey ?? null,
        snapshotDigest: routeAcceptanceDecision?.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null
      })
    : null;
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    routeDecisionDigest: routeAcceptanceDecision?.digest ?? null,
    workflowAcceptanceDigest: workflowAcceptancePacket?.digest ?? null,
    statusRecoveryDigest: statusRecoveryPacket?.digest ?? null,
    mailchimpExportDigest: mailchimpExportHandoff?.digest ?? null,
    clientRuntimeDigest: clientRuntimeState?.digest ?? null,
    commandId,
    blockers
  };
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.route-client-acceptance-handoff`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    service: 'mailchimp',
    state,
    ready,
    writeRequired,
    decisionId: routeAcceptanceDecision?.decisionId ?? null,
    routeDecisionDigest: routeAcceptanceDecision?.digest ?? null,
    presentationMode: routeAcceptanceDecision?.presentationMode ?? (
      state === 'ready' ? 'confirm' : state === 'review' ? 'review' : 'repair'
    ),
    command: {
      commandId,
      type: 'persist-client-route-acceptance',
      idempotencyKey,
      statusAfterReplay: ready ? 'client_route_acceptance_ready' : 'client_route_acceptance_waiting',
      conflict: 'return-existing',
      requiredInputs: ['decisionId', 'routeDecisionDigest', 'statusChannel', 'idempotencyKey'].filter((name) => (
        name !== 'idempotencyKey' || writeRequired
      ))
    },
    userVisibleStatus: {
      current: routeAcceptanceDecision?.userVisibleStatus?.current
        ?? operatorExportBriefing?.userVisibleStatus?.current
        ?? clientRuntimeState?.userVisibleStatus?.current
        ?? routeClientAcceptanceStatus(state),
      completion: routeAcceptanceDecision?.userVisibleStatus?.completion
        ?? clientRuntimeState?.userVisibleStatus?.completion
        ?? 'mailchimp_write_synced',
      failure: routeAcceptanceDecision?.userVisibleStatus?.failure
        ?? clientRuntimeState?.userVisibleStatus?.failure
        ?? 'mailchimp_write_needs_review'
    },
    runtime: {
      commandId: workflowAcceptancePacket?.commandId ?? providerPersistence?.commandId ?? null,
      idempotencyKey: workflowAcceptancePacket?.idempotencyKey ?? providerPersistence?.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null,
      statusChannel: workflowAcceptancePacket?.statusChannel ?? providerPersistence?.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
      restartToken: workflowAcceptancePacket?.restartToken ?? clientRuntimeState?.restartToken ?? recoveryReport?.sync?.restartToken ?? null,
      snapshotDigest: routeAcceptanceDecision?.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null
    },
    scope: {
      tenantId: routeAcceptanceDecision?.scope?.tenantId ?? clientRuntimeState?.scope?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
      workspaceId: routeAcceptanceDecision?.scope?.workspaceId ?? clientRuntimeState?.scope?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
      isolationKey: routeAcceptanceDecision?.scope?.isolationKey ?? clientRuntimeState?.scope?.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null
    },
    preview: {
      acceptanceState: acceptanceSummary?.acceptanceState ?? 'unknown',
      readinessState: acceptanceSummary?.readinessState ?? 'unknown',
      missingAcknowledgements: acceptanceSummary?.missingAcknowledgements ?? [],
      externalWriteStatus: externalWriteReport?.status ?? 'unknown',
      recoveryStatus: recoveryReport?.status ?? 'unknown',
      mailchimpExportState: mailchimpExportHandoff?.state ?? 'unknown'
    },
    validationSummary: {
      readyCheckCount: checks.filter((check) => check.ready).length,
      totalCheckCount: checks.length,
      firstUnreadyCheck: firstUnready?.id ?? null,
      blockers,
      warnings,
      checks
    },
    restartSemantics: {
      restartSafe: statusRecoveryPacket?.ready === true
        && recoveryReport?.restartRecovery?.ready !== false
        && (!writeRequired || Boolean(workflowAcceptancePacket?.idempotencyKey)),
      onRestart: ready ? 'load_client_route_acceptance_handoff' : statusRecoveryPacket?.nextAction ?? 'resume_status_recovery',
      onDuplicateCommand: 'return_existing_client_route_acceptance',
      onStaleSnapshot: 'reload_latest_route_acceptance_decision'
    },
    export: {
      snapshotDigest: exportReport?.history?.latest?.digest ?? null,
      changedSincePrevious: exportReport?.history?.changedSincePrevious === true,
      mailchimpExportDigest: mailchimpExportHandoff?.digest ?? null,
      operatorBriefingDigest: operatorExportBriefing?.digest ?? null
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? routeClientAcceptanceAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? routeAcceptanceDecision?.nextAction ?? 'review_client_route_acceptance'
            : state === 'ready'
              ? 'present_client_route_acceptance'
              : firstUnready?.nextAction ?? 'wait_for_client_route_acceptance_handoff',
    digest: stableHash(digestShape)
  };
}

function validateRouteClientAcceptanceHandoff(handoff, externalWriteReport) {
  if (!externalWriteReport?.writeRequired && !handoff) return [];
  const diagnostics = [];
  if (!handoff) return [{ level: 'error', code: 'missing_route_client_acceptance_handoff' }];
  if (externalWriteReport?.writeRequired && handoff.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'route_client_acceptance_not_write_required' });
  }
  if (handoff.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'route_client_acceptance_blocked', blockers: handoff.blockers ?? [] });
  }
  if (handoff.ready && !handoff.command?.commandId) {
    diagnostics.push({ level: 'error', code: 'route_client_acceptance_missing_command' });
  }
  if (handoff.ready && externalWriteReport?.writeRequired && !handoff.command?.idempotencyKey) {
    diagnostics.push({ level: 'error', code: 'route_client_acceptance_missing_idempotency' });
  }
  if (handoff.ready && handoff.validationSummary?.readyCheckCount !== handoff.validationSummary?.totalCheckCount) {
    diagnostics.push({ level: 'error', code: 'route_client_acceptance_ready_with_unready_checks' });
  }
  if (handoff.state === 'review' || handoff.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'route_client_acceptance_review', warnings: handoff.warnings ?? [] });
  }
  return diagnostics;
}

function buildClientRuntimeAdoptionHandoff({
  kernelCall,
  acceptanceSummary,
  workflowAcceptancePacket,
  statusRecoveryPacket,
  mailchimpExportHandoff,
  operatorExportBriefing,
  routeAcceptanceDecision,
  routeClientAcceptanceHandoff,
  providerPersistence,
  clientRuntimeState,
  clientWorkflow,
  externalWriteReport,
  recoveryReport,
  exportReport
}) {
  const writeRequired = externalWriteReport?.writeRequired === true;
  const runtime = routeClientAcceptanceHandoff?.runtime ?? {};
  const adoptionKey = `runtime-adoption:${stableHash({
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    clientRequestKey: statusRecoveryPacket?.clientRequestSnapshot?.requestKey ?? null,
    routeDigest: routeClientAcceptanceHandoff?.digest ?? null,
    snapshotDigest: runtime.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null
  })}`;
  const checkpoints = [
    adoptionCheckpoint('client-runtime', clientRuntimeState?.state, clientRuntimeState?.ready === true || !writeRequired, clientRuntimeState?.blockers, clientRuntimeState?.warnings, clientRuntimeState?.digest, clientRuntimeState?.nextAction),
    adoptionCheckpoint('workflow-acceptance', workflowAcceptancePacket?.state, workflowAcceptancePacket?.ready === true, workflowAcceptancePacket?.blockers, workflowAcceptancePacket?.warnings, workflowAcceptancePacket?.digest, workflowAcceptancePacket?.nextAction),
    adoptionCheckpoint('status-recovery', statusRecoveryPacket?.state, statusRecoveryPacket?.ready === true || !writeRequired, statusRecoveryPacket?.blockers, statusRecoveryPacket?.warnings, statusRecoveryPacket?.digest, statusRecoveryPacket?.nextAction),
    adoptionCheckpoint('route-decision', routeAcceptanceDecision?.state, routeAcceptanceDecision?.ready === true, routeAcceptanceDecision?.blockers, routeAcceptanceDecision?.warnings, routeAcceptanceDecision?.digest, routeAcceptanceDecision?.nextAction),
    adoptionCheckpoint('route-client-acceptance', routeClientAcceptanceHandoff?.state, routeClientAcceptanceHandoff?.ready === true, routeClientAcceptanceHandoff?.blockers, routeClientAcceptanceHandoff?.warnings, routeClientAcceptanceHandoff?.digest, routeClientAcceptanceHandoff?.nextAction),
    adoptionCheckpoint('mailchimp-export', mailchimpExportHandoff?.state, mailchimpExportHandoff?.ready === true || !writeRequired, mailchimpExportHandoff?.blockers, mailchimpExportHandoff?.warnings, mailchimpExportHandoff?.digest, mailchimpExportHandoff?.nextAction),
    adoptionCheckpoint('operator-briefing', operatorExportBriefing?.state, operatorExportBriefing?.ready === true, operatorExportBriefing?.blockers, operatorExportBriefing?.warnings, operatorExportBriefing?.digest, operatorExportBriefing?.nextAction),
    adoptionCheckpoint('recovery', recoveryReport?.status, recoveryReport?.restartRecovery?.ready !== false, recoveryReport?.blockedReasons, recoveryReport?.readinessPreview?.warnings, recoveryReport?.restartRecovery?.digest, recoveryReport?.nextAction)
  ];
  const failed = checkpoints.filter((checkpoint) => checkpoint.outcome === 'failed');
  const review = checkpoints.filter((checkpoint) => checkpoint.outcome === 'review');
  const firstPending = checkpoints.find((checkpoint) => checkpoint.outcome === 'pending');
  const missingRuntime = [
    ...(!runtime.statusChannel && writeRequired ? ['missing_runtime_status_channel'] : []),
    ...(!runtime.idempotencyKey && writeRequired ? ['missing_runtime_idempotency_key'] : []),
    ...(!runtime.snapshotDigest && writeRequired ? ['missing_runtime_snapshot_digest'] : []),
    ...(!statusRecoveryPacket?.clientRequestSnapshot?.requestKey && writeRequired ? ['missing_runtime_request_key'] : [])
  ];
  const blockers = uniqueSorted([
    ...failed.flatMap((checkpoint) => checkpoint.blockers.length ? checkpoint.blockers.map((blocker) => `${checkpoint.name}_${blocker}`) : [`checkpoint_failed:${checkpoint.name}`]),
    ...missingRuntime
  ]);
  const warnings = uniqueSorted([
    ...review.flatMap((checkpoint) => checkpoint.warnings.length ? checkpoint.warnings.map((warning) => `${checkpoint.name}_${warning}`) : [`checkpoint_review:${checkpoint.name}`]),
    ...(acceptanceSummary?.warnings ?? []).map((warning) => `acceptance_${warning}`),
    ...(exportReport?.history?.changedSincePrevious ? ['export_snapshot_changed'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : clientWorkflow?.state === 'held'
      ? 'held'
      : clientWorkflow?.state === 'scheduled'
        ? 'scheduled'
        : warnings.length || routeClientAcceptanceHandoff?.state === 'review'
          ? 'review'
          : checkpoints.every((checkpoint) => checkpoint.outcome === 'ready')
            ? 'adoptable'
            : 'waiting';
  const ready = state === 'adoptable';
  const commandId = ready
    ? `client-runtime-adoption:${stableHash({
        adoptionKey,
        routeDigest: routeClientAcceptanceHandoff?.digest ?? null,
        providerCommandId: providerPersistence?.commandId ?? workflowAcceptancePacket?.commandId ?? null
      })}`
    : null;
  const idempotencyKey = ready
    ? stableHash({
        action: 'persist-client-runtime-adoption',
        adoptionKey,
        routeClientAcceptanceCommand: routeClientAcceptanceHandoff?.command?.idempotencyKey ?? null,
        runtimeIdempotencyKey: runtime.idempotencyKey ?? providerPersistence?.idempotencyKey ?? null
      })
    : null;
  const digestShape = {
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    adoptionKey,
    routeDigest: routeClientAcceptanceHandoff?.digest ?? null,
    statusRecoveryDigest: statusRecoveryPacket?.digest ?? null,
    exportDigest: mailchimpExportHandoff?.digest ?? null,
    checkpoints: checkpoints.map((checkpoint) => `${checkpoint.name}:${checkpoint.outcome}:${checkpoint.digest}`),
    blockers
  };
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.client-runtime-adoption-handoff`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    service: 'mailchimp',
    adoptionKey,
    state,
    ready,
    writeRequired,
    presentationMode: state === 'adoptable' ? 'confirm' : state === 'review' ? 'review' : 'repair',
    command: {
      commandId,
      type: 'persist-client-runtime-adoption',
      idempotencyKey,
      statusAfterReplay: ready ? 'client_runtime_adoption_ready' : 'client_runtime_adoption_waiting',
      conflict: 'return-existing',
      requiredInputs: ['adoptionKey', 'routeClientAcceptanceDigest', 'statusChannel', 'snapshotDigest']
    },
    userVisibleStatus: {
      current: ready
        ? 'ready_for_runtime_adoption'
        : state === 'review'
          ? 'runtime_adoption_ready_with_warnings'
          : state === 'held'
            ? 'waiting_for_manual_release'
            : state === 'scheduled'
              ? 'waiting_for_schedule_window'
              : state === 'waiting'
                ? 'preparing_runtime_adoption'
                : 'runtime_adoption_needs_attention',
      completion: routeClientAcceptanceHandoff?.userVisibleStatus?.completion ?? 'mailchimp_runtime_adopted',
      failure: routeClientAcceptanceHandoff?.userVisibleStatus?.failure ?? 'mailchimp_runtime_adoption_needs_review'
    },
    runtime: {
      commandId: runtime.commandId ?? providerPersistence?.commandId ?? workflowAcceptancePacket?.commandId ?? null,
      idempotencyKey: runtime.idempotencyKey ?? providerPersistence?.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null,
      statusChannel: runtime.statusChannel ?? providerPersistence?.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
      restartToken: runtime.restartToken ?? recoveryReport?.sync?.restartToken ?? null,
      snapshotDigest: runtime.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null,
      clientRequestKey: statusRecoveryPacket?.clientRequestSnapshot?.requestKey ?? null,
      clientRequestDigest: statusRecoveryPacket?.clientRequestSnapshot?.digest ?? null
    },
    checkpoints,
    validationSummary: {
      readyCheckCount: checkpoints.filter((checkpoint) => checkpoint.outcome === 'ready').length,
      totalCheckCount: checkpoints.length,
      failedCheckpoints: failed.map((checkpoint) => checkpoint.name),
      reviewCheckpoints: review.map((checkpoint) => checkpoint.name),
      firstPendingCheckpoint: firstPending?.name ?? null,
      blockers,
      warnings
    },
    restartSemantics: {
      restartSafe: statusRecoveryPacket?.ready === true
        && routeClientAcceptanceHandoff?.restartSemantics?.restartSafe === true
        && recoveryReport?.restartRecovery?.ready !== false
        && (!writeRequired || Boolean(runtime.idempotencyKey ?? providerPersistence?.idempotencyKey)),
      onRestart: ready ? 'load_client_runtime_adoption_handoff' : firstPending?.nextAction ?? statusRecoveryPacket?.nextAction ?? 'resume_status_recovery',
      onDuplicateCommand: 'return_existing_client_runtime_adoption',
      onStaleSnapshot: 'reload_latest_runtime_adoption_snapshot',
      onRouteDecisionChange: 'rebuild_client_runtime_adoption_handoff'
    },
    export: {
      latestSnapshotDigest: exportReport?.history?.latest?.digest ?? null,
      changedSincePrevious: exportReport?.history?.changedSincePrevious === true,
      routeClientAcceptanceDigest: routeClientAcceptanceHandoff?.digest ?? null,
      mailchimpExportDigest: mailchimpExportHandoff?.digest ?? null,
      operatorBriefingDigest: operatorExportBriefing?.digest ?? null
    },
    blockers,
    warnings,
    nextAction: state === 'blocked'
      ? clientRuntimeAdoptionAction(blockers[0])
      : state === 'held'
        ? 'await_manual_release'
        : state === 'scheduled'
          ? 'wait_for_schedule_window'
          : state === 'review'
            ? routeClientAcceptanceHandoff?.nextAction ?? 'review_client_runtime_adoption'
            : ready
              ? 'persist_client_runtime_adoption_handoff'
              : firstPending?.nextAction ?? 'wait_for_client_runtime_adoption_handoff',
    digest: stableHash(digestShape)
  };
}

function adoptionCheckpoint(name, status, ready, blockers = [], warnings = [], digest = null, nextAction = null) {
  const normalizedBlockers = uniqueSorted(asArray(blockers).map((entry) => typeof entry === 'string' ? entry : entry?.code));
  const normalizedWarnings = uniqueSorted(asArray(warnings).map((entry) => typeof entry === 'string' ? entry : entry?.code));
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

function validateClientRuntimeAdoptionHandoff(handoff, externalWriteReport) {
  if (!externalWriteReport?.writeRequired && !handoff) return [];
  const diagnostics = [];
  if (!handoff) return [{ level: 'error', code: 'missing_client_runtime_adoption_handoff' }];
  if (externalWriteReport?.writeRequired && handoff.writeRequired !== true) {
    diagnostics.push({ level: 'error', code: 'client_runtime_adoption_not_write_required' });
  }
  if (handoff.state === 'blocked') {
    diagnostics.push({ level: 'error', code: 'client_runtime_adoption_blocked', blockers: handoff.blockers ?? [] });
  }
  if (handoff.ready && !handoff.command?.commandId) {
    diagnostics.push({ level: 'error', code: 'client_runtime_adoption_missing_command' });
  }
  if (handoff.ready && externalWriteReport?.writeRequired && !handoff.command?.idempotencyKey) {
    diagnostics.push({ level: 'error', code: 'client_runtime_adoption_missing_idempotency' });
  }
  if (handoff.ready && handoff.validationSummary?.readyCheckCount !== handoff.validationSummary?.totalCheckCount) {
    diagnostics.push({ level: 'error', code: 'client_runtime_adoption_ready_with_unready_checks' });
  }
  if (handoff.ready && handoff.restartSemantics?.restartSafe !== true) {
    diagnostics.push({ level: 'error', code: 'client_runtime_adoption_not_restart_safe' });
  }
  if (handoff.state === 'review' || handoff.warnings?.length) {
    diagnostics.push({ level: 'warning', code: 'client_runtime_adoption_review', warnings: handoff.warnings ?? [] });
  }
  return diagnostics;
}

function clientRuntimeAdoptionAction(blocker) {
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('route-client') || String(blocker).includes('route_client')) return 'repair_client_route_acceptance_handoff';
  if (String(blocker).includes('route')) return 'repair_route_acceptance_decision';
  if (String(blocker).includes('workflow')) return 'repair_workflow_acceptance_packet';
  if (String(blocker).includes('status')) return 'repair_status_recovery_packet';
  if (String(blocker).includes('export')) return 'repair_mailchimp_export_handoff';
  if (String(blocker).includes('operator')) return 'repair_operator_export_briefing';
  if (String(blocker).includes('recovery')) return 'repair_recovery_contract';
  if (String(blocker).includes('client-runtime') || String(blocker).includes('client_runtime')) return 'repair_client_runtime_state';
  return 'repair_client_runtime_adoption_handoff';
}

function routeClientAcceptanceStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'preparing_client_confirmation',
    review: 'ready_for_review',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function routeClientAcceptanceAction(blocker) {
  if (String(blocker).includes('command')) return 'persist_provider_command_id';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('workflow')) return 'repair_workflow_acceptance_packet';
  if (String(blocker).includes('status')) return 'repair_status_recovery_packet';
  if (String(blocker).includes('export')) return 'repair_mailchimp_export_handoff';
  if (String(blocker).includes('operator')) return 'repair_operator_export_briefing';
  if (String(blocker).includes('external_write')) return 'resolve_external_write_before_confirmation';
  if (String(blocker).includes('recovery')) return 'repair_recovery_contract';
  return 'repair_client_route_acceptance_handoff';
}

function routeAcceptanceStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'preparing_route_confirmation',
    review: 'ready_for_review',
    ready: 'ready_for_confirmation'
  }[state] ?? 'operator_review';
}

function routeAcceptanceAction(blocker) {
  if (String(blocker).includes('command_id')) return 'persist_provider_command_id';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('restart')) return 'persist_restart_token';
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('workflow')) return 'repair_workflow_acceptance_packet';
  if (String(blocker).includes('status')) return 'repair_status_recovery_packet';
  if (String(blocker).includes('export')) return 'repair_mailchimp_export_handoff';
  if (String(blocker).includes('operator')) return 'repair_operator_export_briefing';
  if (String(blocker).includes('external_write')) return 'resolve_external_write_before_confirmation';
  if (String(blocker).includes('recovery')) return 'repair_recovery_contract';
  return 'repair_route_acceptance_decision';
}

function operatorBriefingStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'preparing_operator_briefing',
    review: 'ready_for_review',
    ready: 'ready_for_confirmation'
  }[state] ?? 'operator_review';
}

function operatorBriefingAction(blocker) {
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('acceptance')) return 'collect_operator_acknowledgement';
  if (String(blocker).includes('status_recovery')) return 'repair_status_recovery_packet';
  if (String(blocker).includes('client_runtime')) return 'persist_client_runtime_handoff';
  if (String(blocker).includes('provider')) return 'resolve_provider_contract';
  if (String(blocker).includes('external_write')) return 'resolve_external_write_before_recovery';
  if (String(blocker).includes('recovery')) return 'repair_recovery_contract';
  return 'repair_operator_export_briefing';
}

function mailchimpExportStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'preparing_mailchimp_export',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function mailchimpExportAction(blocker) {
  if (String(blocker).includes('external_ledger')) return 'repair_external_write_export_ledger';
  if (String(blocker).includes('recovery_continuity')) return 'repair_recovery_export_continuity';
  if (String(blocker).includes('snapshot')) return 'wait_for_export_snapshot';
  if (String(blocker).includes('idempotency')) return 'provide_provider_idempotency_key';
  if (String(blocker).includes('status_channel')) return 'bind_provider_status_channel';
  if (String(blocker).includes('client_request')) return 'persist_client_request_snapshot';
  if (String(blocker).includes('provider')) return 'resolve_provider_contract';
  if (String(blocker).includes('client')) return 'persist_client_runtime_handoff';
  if (String(blocker).includes('acceptance')) return 'collect_operator_acknowledgement';
  return 'repair_mailchimp_export_handoff';
}

function statusRecoveryUserStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'recovering_status_checkpoint',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function profileFromProgram(program) {
  const profile = {};
  for (const declaration of program.profileAst?.declarations ?? []) {
    if (declaration.kind !== 'ProfileDeclaration') continue;
    if (declaration.key === 'profile') profile.name = declaration.value;
    if (declaration.key === 'adapter') profile.runtimeAdapter = declaration.value;
    if (declaration.key === 'operation') profile.operation = declaration.value;
    if (declaration.key === 'capability') {
      profile.capabilities = [...(profile.capabilities ?? []), declaration.value];
    }
    if (declaration.key === 'claim') {
      profile.requiredClaims = [...(profile.requiredClaims ?? []), declaration.value];
    }
    if (declaration.key === 'truth') {
      profile.truthBoundaries = [...(profile.truthBoundaries ?? []), declaration.value];
    }
    if (declaration.key === 'memory') {
      profile.memory = [...(profile.memory ?? []), parseMemoryValue(declaration.value)];
    }
    if (declaration.key === 'rollback') profile.rollback = declaration.value;
    if (declaration.key === 'statusOnFailure') profile.statusOnFailure = declaration.value;
  }
  return profile;
}

function parseKeyValue(value) {
  const separator = value.indexOf('=');
  if (separator === -1) return {};
  return {
    [value.slice(0, separator).trim()]: coerceScalar(value.slice(separator + 1).trim())
  };
}

function parseFlagCommand(value) {
  const parsed = value
    .split(/\s+/)
    .filter(Boolean)
    .reduce((accumulator, pair) => ({ ...accumulator, ...parseKeyValue(pair) }), {});
  if (!parsed.flag) return null;
  return parsed;
}

function parseContinuationCommand(value) {
  const parsed = value
    .split(/\s+/)
    .filter(Boolean)
    .reduce((accumulator, pair) => ({ ...accumulator, ...parseKeyValue(pair) }), {});
  if (!parsed.op && !parsed.action) return null;
  return parsed;
}

function parseLifecycleCommand(value) {
  const parsed = value
    .split(/\s+/)
    .filter(Boolean)
    .reduce((accumulator, pair) => ({ ...accumulator, ...parseKeyValue(pair) }), {});
  const action = parsed.action ?? parsed.op ?? parsed.command;
  if (!action) return null;
  return {
    id: parsed.id ?? `lifecycle:${stableHash(parsed)}`,
    action: String(action),
    source: parsed.source ?? 'program',
    enabled: parsed.enabled,
    reason: parsed.reason ?? null,
    settings: Object.fromEntries(
      Object.entries(parsed)
        .filter(([key]) => key.startsWith('settings.'))
        .map(([key, nested]) => [key.slice(9), nested])
    ),
    schedule: Object.fromEntries(
      Object.entries(parsed)
        .filter(([key]) => key.startsWith('schedule.'))
        .map(([key, nested]) => [key.slice(9), nested])
    )
  };
}

function parseLifecycleEnabled(value) {
  if (typeof value === 'boolean') return value;
  return !['disabled', 'off', 'false', '0', 'manual_hold'].includes(String(value).trim().toLowerCase());
}

function assignLifecycleField(lifecycle, path, value) {
  if (path === 'enabled') {
    lifecycle.enabled = parseLifecycleEnabled(value);
    return;
  }
  if (path.startsWith('settings.')) {
    lifecycle.settings = {
      ...(lifecycle.settings ?? {}),
      [path.slice(9)]: value
    };
    return;
  }
  if (path.startsWith('schedule.')) {
    lifecycle.schedule = {
      ...(lifecycle.schedule ?? {}),
      [path.slice(9)]: value
    };
    return;
  }
  lifecycle[path] = value;
}

function parseMemoryValue(value) {
  const [name, scope = 'job', retention = 'ephemeral', ttlSeconds = 3600] = value
    .split(/\s+/)
    .filter(Boolean);
  return {
    name,
    scope,
    retention,
    ttlSeconds: Number(ttlSeconds)
  };
}

function coerceScalar(value) {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value.replace(/^"|"$/g, '');
}

function normalizeExecutionScope(scope = {}) {
  return {
    tenantId: optionalString(scope.tenantId) ?? 'tenant:local',
    workspaceId: optionalString(scope.workspaceId) ?? 'workspace:local',
    role: optionalString(scope.role) ?? 'automation_worker',
    isolationKey: deterministicScopeKey(scope.tenantId ?? 'tenant:local', scope.workspaceId ?? 'workspace:local')
  };
}

function validateExecutionScope(scope, requestedEffects) {
  const diagnostics = [];
  if (!scope.tenantId.startsWith('tenant:')) {
    diagnostics.push({ level: 'warning', code: 'tenant_scope_not_namespaced', tenantId: scope.tenantId });
  }
  if (!scope.workspaceId.startsWith('workspace:')) {
    diagnostics.push({ level: 'warning', code: 'workspace_scope_not_namespaced', workspaceId: scope.workspaceId });
  }
  if (requestedEffects.includes('mailchimp.write') && !['automation_worker', 'operator'].includes(scope.role)) {
    diagnostics.push({ level: 'error', code: 'role_cannot_request_mailchimp_write', role: scope.role });
  }
  return diagnostics;
}

function buildAuditHandoff({ programId, operation, scope, runtimePolicy, featureState, continuationState, permissionBoundary }) {
  return {
    channel: 'audit.mailchimp.runtime_handoff',
    programId: programId ?? null,
    operation,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    role: scope.role,
    isolationKey: scope.isolationKey,
    allowedEffects: runtimePolicy?.allowedEffects ?? [],
    deniedEffects: (runtimePolicy?.deniedEffects ?? []).map((effect) => effect.effect),
    featureGeneration: featureState.generation,
    featureRestartToken: featureState.restartToken,
    profileGeneration: continuationState?.generation ?? 0,
    profileRestartToken: continuationState?.restartToken ?? null,
    resumeAction: continuationState?.resumeAction ?? null,
    permissionBoundary: permissionBoundary
      ? {
          isolationKey: permissionBoundary.isolationKey,
          nextAction: permissionBoundary.nextAction,
          deniedEffectCount: permissionBoundary.permissions?.deniedEffects?.length ?? 0
        }
      : null
  };
}

function buildPlanAcceptanceSummary({ kernelCall, exportReport, externalWriteReport, recoveryReport }) {
  const previewSummary = summarizeKernelCallUIPreview(kernelCall?.preview);
  const exportSummary = buildExportReadySummary({
    ...exportReport,
    preview: kernelCall?.preview
  });
  const externalPacket = externalWriteReport?.acceptancePacket ?? {};
  const recoveryAcceptance = recoveryReport?.acceptanceHandoff ?? {};
  const blockers = uniqueSorted([
    ...(previewSummary.blockingReasons ?? []),
    ...(externalWriteReport?.blockedReasons ?? []),
    ...(recoveryReport?.blockedReasons ?? []),
    ...(externalPacket.blockers ?? []),
    ...(recoveryAcceptance.blockers ?? [])
  ]);
  const warnings = uniqueSorted([
    ...(previewSummary.warningReasons ?? []),
    ...(externalWriteReport?.status === 'review' ? ['external_write_review'] : []),
    ...(recoveryReport?.status === 'degraded' ? ['recovery_degraded'] : []),
    ...(externalPacket.warnings ?? [])
  ]);
  const exportReady = exportSummary.exportReady === true
    && blockers.length === 0
    && (externalWriteReport?.writeRequired ? recoveryAcceptance.ready === true : true);
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.acceptance-summary`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    readinessState: exportReady ? 'ready' : blockers.length ? 'blocked' : previewSummary.readiness,
    acceptanceState: previewSummary.acceptance,
    acceptEnabled: previewSummary.acceptEnabled && exportReady && (externalWriteReport?.writeRequired ? externalPacket.acceptEnabled === true : true),
    exportReady,
    nextAction: blockers.length
      ? nextPlanActionForBlocker(blockers[0])
      : previewSummary.nextAction ?? exportSummary.nextAction ?? 'operator_review',
    blockers,
    warnings,
    requiredAcknowledgements: uniqueSorted([
      ...(kernelCall?.preview?.acceptance?.requiredAcknowledgements ?? []),
      ...(externalPacket.requiredAcknowledgements ?? []),
      ...(recoveryAcceptance.requiredAcknowledgements ?? [])
    ]),
    missingAcknowledgements: uniqueSorted([
      ...(kernelCall?.preview?.acceptance?.missingAcknowledgements ?? []),
      ...(externalPacket.missingAcknowledgements ?? []),
      ...(recoveryAcceptance.missingAcknowledgements ?? [])
    ]),
    exportSummary,
    externalWriteAcceptance: {
      readinessState: externalPacket.readinessState ?? 'unknown',
      acceptanceState: externalPacket.acceptanceState ?? 'unknown',
      acceptEnabled: externalPacket.acceptEnabled ?? false,
      nextAction: externalPacket.nextAction ?? null
    },
    recoveryAcceptance: {
      state: recoveryAcceptance.state ?? 'unknown',
      ready: recoveryAcceptance.ready ?? false,
      nextAction: recoveryAcceptance.nextAction ?? null
    },
    validationSummary: previewSummary.validation
  };
}

function buildProviderHandoffContract({ profile, runtimePolicy, permissionBoundary, kernelCall, exportReport, uiPreview, externalWriteReport, recoveryReport }) {
  const requiredCapabilities = kernelCall?.capabilities?.required ?? [];
  const allowedEffects = runtimePolicy?.allowedEffects ?? [];
  const providerHealth = kernelCall?.provider ?? {};
  const semanticService = externalWriteReport?.providerServiceContract ?? {};
  const recoveryService = recoveryReport?.provider?.serviceContract ?? recoveryReport?.sync?.providerService ?? {};
  const deniedEffects = [
    ...(runtimePolicy?.deniedEffects ?? []),
    ...(permissionBoundary?.permissions?.deniedEffects ?? [])
  ].map((effect) => typeof effect === 'string' ? effect : effect.effect).filter(Boolean);
  const previewSummary = summarizeKernelCallUIPreview(uiPreview);
  const negotiation = negotiateProviderCapabilities({
    requiredCapabilities,
    allowedEffects,
    deniedEffects,
    exportReady: exportReport.analytics?.exportReady === true,
    acceptEnabled: previewSummary.acceptEnabled,
    providerHealth
  });
  const serviceContract = {
    schemaVersion: `${LOWERING_PLAN_VERSION}.provider-service-contract`,
    state: semanticService.state ?? recoveryService.state ?? negotiation.status ?? 'unknown',
    ready: semanticService.ready ?? recoveryService.ready ?? negotiation.status === 'accepted',
    negotiationStatus: semanticService.negotiation?.status ?? recoveryService.negotiationStatus ?? negotiation.status,
    requiredCapabilities: semanticService.requiredCapabilities ?? recoveryService.requiredCapabilities ?? requiredCapabilities,
    acceptedCapabilities: semanticService.acceptedCapabilities ?? recoveryService.acceptedCapabilities ?? allowedEffects,
    missingCapabilities: semanticService.missingCapabilities ?? recoveryService.missingCapabilities ?? negotiation.missingCapabilities ?? [],
    externalStateKey: semanticService.sync?.externalStateKey ?? recoveryService.externalStateKey ?? null,
    statusChannel: semanticService.sync?.statusChannel ?? recoveryService.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
    checkpointDigest: semanticService.sync?.checkpointDigest ?? recoveryService.checkpointDigest ?? null,
    digest: semanticService.digest ?? recoveryService.digest ?? null,
    commandCount: semanticService.commands?.length ?? recoveryService.commandCount ?? 0,
    nextAction: semanticService.nextAction ?? recoveryService.nextAction ?? null,
    blockers: semanticService.blockers ?? [],
    warnings: semanticService.warnings ?? []
  };
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.provider-handoff`,
    provider: profile?.runtimeAdapter ?? runtimePolicy?.adapter ?? 'mailchimp',
    service: 'mailchimp',
    operation: kernelCall?.operation ?? profile?.operation ?? 'unknown',
    health: {
      status: providerHealth?.status ?? 'unknown',
      ready: providerHealth?.ready ?? false,
      degraded: providerHealth?.health?.degraded ?? providerHealth?.status === 'degraded',
      retryable: providerHealth?.health?.retryable ?? true,
      retryAfterMs: providerHealth?.health?.retryAfterMs ?? null,
      nextAction: providerHealth?.nextAction ?? null,
      blockers: providerHealth?.blockers ?? [],
      warnings: providerHealth?.warnings ?? []
    },
    target: kernelCall?.handoff?.target ?? 'mailchimp.client.workflow',
    queue: kernelCall?.call?.target ?? null,
    statusChannel: kernelCall?.handoff?.statusChannel ?? null,
    idempotencyKey: kernelCall?.handoff?.idempotencyKey ?? null,
    scope: {
      tenantId: permissionBoundary?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
      workspaceId: permissionBoundary?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
      isolationKey: permissionBoundary?.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null
    },
    negotiation,
    serviceContract,
    sync: {
      exportReady: exportReport.analytics?.exportReady === true,
      snapshotDigest: exportReport.history?.latest?.digest ?? null,
      changedSincePrevious: exportReport.history?.changedSincePrevious ?? false,
      timelineEventCount: exportReport.timeline?.length ?? 0,
      previewState: previewSummary.readiness,
      acceptanceState: previewSummary.acceptance,
      providerSyncStatus: providerHealth?.sync?.status ?? 'unknown',
      providerReady: providerHealth?.ready ?? false,
      providerServiceState: serviceContract.state,
      providerServiceReady: serviceContract.ready,
      providerServiceDigest: serviceContract.digest,
      providerExternalStateKey: serviceContract.externalStateKey,
      providerMissingCapabilities: serviceContract.missingCapabilities
    },
    nextAction: serviceContract.ready === false
      ? serviceContract.nextAction ?? 'resolve_provider_contract'
      : negotiation.status === 'accepted'
      ? 'handoff_to_mailchimp_provider'
      : negotiation.status === 'blocked'
        ? 'resolve_provider_contract'
        : previewSummary.nextAction ?? 'operator_review'
  };
}

function buildClientWorkflowHandoff({
  kernelCall,
  uiPreview,
  acceptanceSummary,
  providerContract,
  providerPersistence,
  clientRuntimeState,
  externalWriteReport,
  recoveryReport,
  clientRuntime
}) {
  const previewSummary = summarizeKernelCallUIPreview(uiPreview);
  const providerBlocked = providerContract?.negotiation?.status === 'blocked';
  const recoveryHandoff = recoveryReport?.externalHandoff ?? {};
  const dispatchStatus = externalWriteReport?.dispatch?.status ?? 'unknown';
  const blockers = uniqueSorted([
    ...(acceptanceSummary?.blockers ?? []),
    ...(providerContract?.negotiation?.blockers ?? []),
    ...(clientRuntimeState?.blockers ?? []),
    ...(externalWriteReport?.acceptancePacket?.blockers ?? []),
    ...(recoveryReport?.acceptanceHandoff?.blockers ?? []),
    ...(recoveryReport?.blockedReasons ?? [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : recoveryHandoff.state === 'held'
      ? 'held'
      : recoveryHandoff.state === 'scheduled'
        ? 'scheduled'
        : acceptanceSummary?.acceptEnabled && providerContract?.sync?.exportReady && clientRuntimeState?.ready !== false
          ? 'ready'
          : 'review';
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.client-workflow-handoff`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    nextAction: clientWorkflowNextAction({
      state,
      providerBlocked,
      dispatchStatus,
      previewNextAction: previewSummary.nextAction,
      acceptanceNextAction: acceptanceSummary?.nextAction,
      recoveryNextAction: recoveryReport?.nextAction
    }),
    preview: {
      readiness: previewSummary.readiness,
      acceptance: previewSummary.acceptance,
      acceptEnabled: previewSummary.acceptEnabled,
      requiredAcknowledgements: acceptanceSummary?.requiredAcknowledgements ?? [],
      missingAcknowledgements: acceptanceSummary?.missingAcknowledgements ?? []
    },
    provider: {
      status: providerContract?.negotiation?.status ?? 'unknown',
      healthStatus: providerContract?.health?.status ?? 'unknown',
      healthReady: providerContract?.health?.ready ?? false,
      healthNextAction: providerContract?.health?.nextAction ?? null,
      syncReady: providerContract?.sync?.exportReady === true && !providerBlocked,
      serviceState: providerContract?.serviceContract?.state ?? 'unknown',
      serviceReady: providerContract?.serviceContract?.ready ?? false,
      serviceDigest: providerContract?.serviceContract?.digest ?? null,
      serviceNextAction: providerContract?.serviceContract?.nextAction ?? null,
      missingCapabilities: providerContract?.serviceContract?.missingCapabilities ?? [],
      target: providerContract?.target ?? null,
      statusChannel: providerContract?.statusChannel ?? null,
      idempotencyKey: providerContract?.idempotencyKey ?? null,
      commandId: providerPersistence?.commandId ?? null,
      persistedState: providerPersistence?.status ?? 'unknown',
      replaySafe: providerPersistence?.safeToReplay ?? false,
      blockers: providerContract?.negotiation?.blockers ?? []
    },
    externalWrite: {
      required: externalWriteReport?.writeRequired === true,
      status: externalWriteReport?.status ?? 'unknown',
      dispatchStatus,
      lifecycleGate: externalWriteReport?.lifecycleGate?.state ?? 'unknown',
      releaseAction: externalWriteReport?.dispatch?.release?.nextAction ?? null,
      acceptance: {
        readinessState: externalWriteReport?.acceptancePacket?.readinessState ?? 'unknown',
        acceptanceState: externalWriteReport?.acceptancePacket?.acceptanceState ?? 'unknown',
        acceptEnabled: externalWriteReport?.acceptancePacket?.acceptEnabled ?? false,
        nextAction: externalWriteReport?.acceptancePacket?.nextAction ?? null
      }
    },
    recovery: {
      status: recoveryReport?.status ?? 'unknown',
      handoffState: recoveryHandoff.state ?? 'unknown',
      acceptanceState: recoveryReport?.acceptanceHandoff?.state ?? 'unknown',
      acceptanceReady: recoveryReport?.acceptanceHandoff?.ready ?? false,
      syncReady: recoveryReport?.sync?.ready === true,
      restartToken: recoveryReport?.sync?.restartToken ?? null,
      snapshotDigest: recoveryReport?.sync?.snapshotDigest ?? null
    },
    persistence: {
      status: providerPersistence?.status ?? 'unknown',
      commandId: providerPersistence?.commandId ?? null,
      digest: providerPersistence?.digest ?? null,
      nextAction: providerPersistence?.nextAction ?? null,
      blockers: providerPersistence?.blockers ?? []
    },
    runtimeState: {
      state: clientRuntimeState?.state ?? 'unknown',
      ready: clientRuntimeState?.ready ?? false,
      digest: clientRuntimeState?.digest ?? null,
      userVisibleStatus: clientRuntimeState?.userVisibleStatus?.current ?? null,
      nextAction: clientRuntimeState?.nextAction ?? null,
      blockers: clientRuntimeState?.blockers ?? []
    },
    client: {
      target: clientRuntime?.target ?? kernelCall?.handoff?.target ?? null,
      statusChannel: clientRuntime?.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
      pendingStatus: clientRuntime?.userVisibleWorkflow?.pendingStatus ?? null,
      completionStatus: clientRuntime?.userVisibleWorkflow?.completionStatus ?? null
    },
    blockers,
    warnings: uniqueSorted([
      ...(acceptanceSummary?.warnings ?? []),
      ...(externalWriteReport?.lifecycleGate?.warnings ?? []),
      ...(externalWriteReport?.acceptancePacket?.warnings ?? [])
    ])
  };
}

function buildWorkflowAcceptancePacket({
  kernelCall,
  acceptanceSummary,
  providerContract,
  providerPersistence,
  clientRuntimeState,
  clientWorkflow,
  externalWriteReport,
  recoveryReport,
  exportReport
}) {
  const externalPacket = externalWriteReport?.acceptancePacket ?? {};
  const recoveryAcceptance = recoveryReport?.acceptanceHandoff ?? {};
  const blockers = uniqueSorted([
    ...(acceptanceSummary?.blockers ?? []),
    ...(clientWorkflow?.blockers ?? []),
    ...(providerPersistence?.blockers ?? []),
    ...(clientRuntimeState?.blockers ?? []),
    ...(externalPacket.blockers ?? []),
    ...(recoveryAcceptance.blockers ?? [])
  ]);
  const warnings = uniqueSorted([
    ...(acceptanceSummary?.warnings ?? []),
    ...(clientWorkflow?.warnings ?? []),
    ...(externalPacket.warnings ?? [])
  ]);
  const writeRequired = externalWriteReport?.writeRequired === true;
  const state = blockers.length
    ? 'blocked'
    : clientWorkflow?.state === 'held'
      ? 'held'
      : clientWorkflow?.state === 'scheduled'
        ? 'scheduled'
        : acceptanceSummary?.acceptEnabled && providerContract?.negotiation?.status === 'accepted'
          ? 'ready'
          : acceptanceSummary?.missingAcknowledgements?.length
            ? 'pending_acknowledgement'
            : 'review';
  const ready = state === 'ready'
    && providerPersistence?.status === 'ready'
    && clientRuntimeState?.ready === true
    && (!writeRequired || recoveryAcceptance.ready === true);
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.workflow-acceptance-packet`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    ready,
    writeRequired,
    exportReady: acceptanceSummary?.exportReady === true && exportReport?.analytics?.exportReady === true,
    acceptEnabled: acceptanceSummary?.acceptEnabled === true,
    commandId: providerPersistence?.commandId
      ?? recoveryAcceptance.commandId
      ?? externalPacket.commandId
      ?? null,
    idempotencyKey: providerPersistence?.idempotencyKey
      ?? recoveryAcceptance.idempotencyKey
      ?? externalPacket.idempotencyKey
      ?? kernelCall?.handoff?.idempotencyKey
      ?? null,
    statusChannel: providerPersistence?.statusChannel
      ?? recoveryAcceptance.statusChannel
      ?? externalPacket.statusChannel
      ?? kernelCall?.handoff?.statusChannel
      ?? null,
    restartToken: providerPersistence?.restartToken
      ?? clientRuntimeState?.restartToken
      ?? recoveryAcceptance.restartToken
      ?? recoveryReport?.sync?.restartToken
      ?? null,
    snapshotDigest: providerPersistence?.snapshotDigest
      ?? recoveryAcceptance.snapshotDigest
      ?? exportReport?.history?.latest?.digest
      ?? null,
    scope: {
      tenantId: clientRuntimeState?.scope?.tenantId ?? providerPersistence?.scope?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
      workspaceId: clientRuntimeState?.scope?.workspaceId ?? providerPersistence?.scope?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
      isolationKey: clientRuntimeState?.scope?.isolationKey ?? providerPersistence?.scope?.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null
    },
    requiredAcknowledgements: acceptanceSummary?.requiredAcknowledgements ?? [],
    missingAcknowledgements: acceptanceSummary?.missingAcknowledgements ?? [],
    externalWriteAcceptance: {
      readinessState: externalPacket.readinessState ?? 'unknown',
      acceptanceState: externalPacket.acceptanceState ?? 'unknown',
      nextAction: externalPacket.nextAction ?? null
    },
    recoveryAcceptance: {
      state: recoveryAcceptance.state ?? 'unknown',
      ready: recoveryAcceptance.ready ?? false,
      nextAction: recoveryAcceptance.nextAction ?? null
    },
    providerPersistence: {
      status: providerPersistence?.status ?? 'unknown',
      safeToReplay: providerPersistence?.safeToReplay ?? false,
      nextAction: providerPersistence?.nextAction ?? null
    },
    clientRuntimeState: {
      state: clientRuntimeState?.state ?? 'unknown',
      ready: clientRuntimeState?.ready ?? false,
      digest: clientRuntimeState?.digest ?? null,
      userVisibleStatus: clientRuntimeState?.userVisibleStatus?.current ?? null,
      nextAction: clientRuntimeState?.nextAction ?? null
    },
    blockers,
    warnings,
    nextAction: workflowAcceptanceNextAction({
      state,
      ready,
      blockers,
      missingAcknowledgements: acceptanceSummary?.missingAcknowledgements ?? [],
      clientWorkflow,
      providerPersistence,
      clientRuntimeState,
      externalPacket,
      recoveryAcceptance
    }),
    digest: stableHash({
      programId: kernelCall?.programId ?? null,
      state,
      ready,
      commandId: providerPersistence?.commandId ?? null,
      snapshotDigest: exportReport?.history?.latest?.digest ?? null,
      blockers
    })
  };
}

function workflowAcceptanceNextAction({
  state,
  ready,
  blockers,
  missingAcknowledgements,
  clientWorkflow,
  providerPersistence,
  clientRuntimeState,
  externalPacket,
  recoveryAcceptance
}) {
  if (blockers.length) return nextPlanActionForBlocker(blockers[0]);
  if (state === 'held') return 'await_manual_release';
  if (state === 'scheduled') return 'wait_for_schedule_window';
  if (missingAcknowledgements.length) return 'collect_operator_acknowledgement';
  if (ready) return 'publish_workflow_acceptance_packet';
  if (clientRuntimeState?.ready === false) return clientRuntimeState.nextAction ?? 'persist_client_runtime_handoff';
  return providerPersistence?.nextAction
    ?? recoveryAcceptance?.nextAction
    ?? externalPacket?.nextAction
    ?? clientWorkflow?.nextAction
    ?? 'operator_review';
}

function buildClientRuntimeStateContract({
  kernelCall,
  providerPersistence,
  externalWriteReport,
  recoveryReport,
  clientRuntime,
  exportReport
}) {
  const writeHandoff = externalWriteReport?.clientRuntimeHandoff ?? {};
  const persisted = recoveryReport?.persistedClientState ?? {};
  const writeRequired = externalWriteReport?.writeRequired === true;
  const blockers = uniqueSorted([
    ...(writeHandoff.blockers ?? []),
    ...(persisted.blockers ?? []),
    ...(providerPersistence?.blockers ?? []),
    ...(!providerPersistence?.commandId && writeRequired ? ['missing_client_runtime_command_id'] : []),
    ...(!clientRuntime?.statusChannel && !writeHandoff.statusChannel && writeRequired ? ['missing_client_runtime_status_channel'] : [])
  ]);
  const state = blockers.length
    ? 'blocked'
    : persisted.state === 'ready' || writeHandoff.state === 'ready'
      ? 'ready'
      : ['held', 'scheduled'].includes(persisted.state)
        ? persisted.state
        : writeRequired
          ? 'waiting'
          : 'not_required';
  const digest = stableHash({
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    state,
    commandId: providerPersistence?.commandId ?? persisted.commandId ?? null,
    idempotencyKey: providerPersistence?.idempotencyKey ?? persisted.idempotencyKey ?? writeHandoff.idempotencyKey ?? null,
    statusChannel: clientRuntime?.statusChannel ?? persisted.statusChannel ?? writeHandoff.statusChannel ?? null,
    snapshotDigest: providerPersistence?.snapshotDigest ?? persisted.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null
  });
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.client-runtime-state`,
    state,
    ready: state === 'ready' || state === 'not_required',
    writeRequired,
    target: clientRuntime?.target ?? writeHandoff.target ?? kernelCall?.handoff?.target ?? null,
    statusChannel: clientRuntime?.statusChannel ?? persisted.statusChannel ?? writeHandoff.statusChannel ?? kernelCall?.handoff?.statusChannel ?? null,
    idempotencyKey: providerPersistence?.idempotencyKey ?? persisted.idempotencyKey ?? writeHandoff.idempotencyKey ?? kernelCall?.handoff?.idempotencyKey ?? null,
    commandId: providerPersistence?.commandId ?? persisted.commandId ?? writeHandoff.providerCommand?.commandId ?? null,
    restartToken: persisted.restartToken ?? writeHandoff.resume?.restartToken ?? kernelCall?.runtimeState?.profileRestartToken ?? null,
    snapshotDigest: providerPersistence?.snapshotDigest ?? persisted.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null,
    userVisibleStatus: {
      current: persisted.userVisibleStatus?.current
        ?? writeHandoff.userVisibleStatus?.pending
        ?? clientRuntimeStatus(state),
      completion: persisted.userVisibleStatus?.completion
        ?? writeHandoff.userVisibleStatus?.completion
        ?? clientRuntime?.userVisibleWorkflow?.completionStatus
        ?? 'mailchimp_write_synced',
      failure: persisted.userVisibleStatus?.failure
        ?? writeHandoff.userVisibleStatus?.failure
        ?? 'mailchimp_write_needs_review'
    },
    provider: {
      persistenceStatus: providerPersistence?.status ?? 'unknown',
      commandState: writeHandoff.providerCommand?.state ?? null,
      safeToReplay: providerPersistence?.safeToReplay === true || writeHandoff.providerCommand?.safeToReplay === true
    },
    scope: {
      tenantId: persisted.scope?.tenantId ?? providerPersistence?.scope?.tenantId ?? kernelCall?.handoff?.scope?.tenantId ?? null,
      workspaceId: persisted.scope?.workspaceId ?? providerPersistence?.scope?.workspaceId ?? kernelCall?.handoff?.scope?.workspaceId ?? null,
      isolationKey: persisted.scope?.isolationKey ?? providerPersistence?.scope?.isolationKey ?? kernelCall?.handoff?.scope?.isolationKey ?? null
    },
    blockers,
    digest,
    nextAction: state === 'blocked'
      ? nextPlanActionForBlocker(blockers[0])
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

function clientRuntimeStatus(state) {
  return {
    blocked: 'needs_attention',
    held: 'waiting_for_manual_release',
    scheduled: 'waiting_for_schedule_window',
    waiting: 'recovering_provider_state',
    ready: 'ready_for_confirmation',
    not_required: 'read_only_ready'
  }[state] ?? 'operator_review';
}

function buildProviderPersistenceContract({
  kernelCall,
  providerContract,
  exportReport,
  externalWriteReport,
  recoveryReport
}) {
  const persistedState = kernelCall?.persistedState ?? {};
  const providerCommand = externalWriteReport?.providerCommand ?? {};
  const replay = recoveryReport?.replay ?? {};
  const sync = recoveryReport?.sync ?? {};
  const commandId = persistedState.commandId
    ?? providerCommand.commandId
    ?? replay.commandId
    ?? sync.commandId
    ?? null;
  const blockers = uniqueSorted([
    ...(persistedState.blockers ?? []),
    ...(providerContract?.negotiation?.blockers ?? []),
    ...(providerContract?.serviceContract?.blockers ?? []).map((blocker) => `service_${blocker}`),
    ...(providerContract?.serviceContract?.ready === false && externalWriteReport?.writeRequired ? ['provider_service_contract_not_ready'] : []),
    ...(providerContract?.health?.blockers ?? []),
    ...(replay.blockers ?? []),
    ...(!commandId && externalWriteReport?.writeRequired ? ['missing_provider_command_id'] : [])
  ]);
  const status = blockers.length
    ? 'blocked'
    : persistedState.status === 'ready' || sync.ready === true
      ? 'ready'
      : persistedState.status === 'held'
        ? 'held'
        : persistedState.status === 'scheduled'
          ? 'scheduled'
          : externalWriteReport?.writeRequired
            ? 'waiting'
            : 'not_required';
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.provider-persistence`,
    provider: providerContract?.provider ?? persistedState.provider ?? 'mailchimp',
    service: 'mailchimp',
    status,
    commandId,
    idempotencyKey: persistedState.idempotencyKey
      ?? providerCommand.idempotencyKey
      ?? providerContract?.idempotencyKey
      ?? null,
    statusChannel: persistedState.statusChannel
      ?? providerCommand.statusChannel
      ?? providerContract?.statusChannel
      ?? null,
    restartToken: persistedState.restartToken ?? sync.restartToken ?? null,
    snapshotDigest: persistedState.snapshotDigest
      ?? sync.snapshotDigest
      ?? exportReport?.history?.latest?.digest
      ?? null,
    digest: persistedState.digest ?? stableHash({
      commandId,
      status,
      snapshotDigest: sync.snapshotDigest ?? exportReport?.history?.latest?.digest ?? null
    }),
    safeToReplay: persistedState.safeToReplay === true || replay.safeToReplay === true,
    syncReady: sync.ready === true,
    providerHealth: {
      status: providerContract?.health?.status ?? 'unknown',
      ready: providerContract?.health?.ready ?? false,
      degraded: providerContract?.health?.degraded ?? false,
      retryable: providerContract?.health?.retryable ?? true,
      retryAfterMs: providerContract?.health?.retryAfterMs ?? null,
      nextAction: providerContract?.health?.nextAction ?? null
    },
    serviceContract: {
      state: providerContract?.serviceContract?.state ?? 'unknown',
      ready: providerContract?.serviceContract?.ready ?? false,
      negotiationStatus: providerContract?.serviceContract?.negotiationStatus ?? 'unknown',
      externalStateKey: providerContract?.serviceContract?.externalStateKey ?? null,
      checkpointDigest: providerContract?.serviceContract?.checkpointDigest ?? null,
      missingCapabilities: providerContract?.serviceContract?.missingCapabilities ?? [],
      digest: providerContract?.serviceContract?.digest ?? null,
      nextAction: providerContract?.serviceContract?.nextAction ?? null
    },
    changedSincePrevious: sync.changedSincePrevious ?? exportReport?.history?.changedSincePrevious ?? false,
    scope: {
      tenantId: persistedState.scope?.tenantId ?? providerContract?.scope?.tenantId ?? null,
      workspaceId: persistedState.scope?.workspaceId ?? providerContract?.scope?.workspaceId ?? null,
      isolationKey: persistedState.scope?.isolationKey ?? providerContract?.scope?.isolationKey ?? null
    },
    blockers,
    nextAction: status === 'blocked'
      ? nextPlanActionForBlocker(blockers[0])
      : status === 'held'
        ? 'await_manual_release'
        : status === 'scheduled'
          ? 'wait_for_schedule_window'
          : status === 'ready'
            ? 'persist_mailchimp_provider_state'
            : externalWriteReport?.writeRequired
              ? 'wait_for_provider_persistence'
              : 'continue_read_only'
  };
}

function clientWorkflowNextAction({
  state,
  providerBlocked,
  dispatchStatus,
  previewNextAction,
  acceptanceNextAction,
  recoveryNextAction
}) {
  if (providerBlocked) return 'resolve_provider_contract';
  if (state === 'blocked') return recoveryNextAction ?? acceptanceNextAction ?? 'resolve_workflow_blockers';
  if (state === 'held') return 'await_manual_release';
  if (state === 'scheduled') return 'wait_for_schedule_window';
  if (dispatchStatus === 'ready') return 'publish_client_handoff';
  return acceptanceNextAction ?? previewNextAction ?? 'operator_review';
}

function negotiateProviderCapabilities({ requiredCapabilities, allowedEffects, deniedEffects, exportReady, acceptEnabled, providerHealth = {} }) {
  const missingEffects = requiredCapabilities
    .filter((capability) => capability.startsWith('mailchimp.'))
    .filter((capability) => !allowedEffects.includes(capability) && !allowedEffects.includes('mailchimp.write'));
  const blockers = uniqueSorted([
    ...(providerHealth.blockers ?? []),
    ...deniedEffects.map((effect) => `denied:${effect}`),
    ...missingEffects.map((capability) => `missing_effect:${capability}`),
    ...(providerHealth.ready === false ? ['provider_not_ready'] : []),
    ...(providerHealth.status === 'blocked' ? ['provider_blocked'] : []),
    ...(providerHealth.status === 'unavailable' ? ['provider_unavailable'] : []),
    ...(!exportReady ? ['export_not_ready'] : []),
    ...(!acceptEnabled ? ['acceptance_not_enabled'] : [])
  ]);
  const warnings = uniqueSorted([
    ...(providerHealth.warnings ?? []),
    ...(providerHealth.status === 'degraded' ? ['provider_degraded'] : [])
  ]);
  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'degraded' : 'accepted',
    requiredCapabilities: uniqueSorted(requiredCapabilities),
    allowedEffects: uniqueSorted(allowedEffects),
    deniedEffects: uniqueSorted(deniedEffects),
    missingEffects: uniqueSorted(missingEffects),
    blockers,
    warnings,
    providerHealth: {
      status: providerHealth.status ?? 'unknown',
      ready: providerHealth.ready ?? false,
      retryable: providerHealth.health?.retryable ?? true,
      retryAfterMs: providerHealth.health?.retryAfterMs ?? null
    },
    acceptedEffects: uniqueSorted(allowedEffects.filter((effect) => !deniedEffects.includes(effect)))
  };
}

function nextPlanActionForBlocker(blocker) {
  if (String(blocker).includes('boundary')) return 'repair_tenant_boundary_ticket';
  if (String(blocker).includes('provider_denied')) return 'resolve_provider_denied_effect';
  if (String(blocker).includes('provider_missing_effect')) return 'enable_provider_capability';
  if (String(blocker).includes('provider_unavailable')) return 'retry_provider_after_backoff';
  if (String(blocker).includes('provider_not_ready') || String(blocker).includes('provider_blocked')) return 'resolve_provider_health';
  if (String(blocker).includes('status_journal')) return 'persist_external_write_status_journal';
  if (String(blocker).includes('client_request')) return 'persist_client_request_snapshot';
  if (blocker.startsWith('denied:')) return 'resolve_provider_denied_effect';
  if (blocker.startsWith('missing_effect:')) return 'enable_provider_capability';
  return {
    lifecycle_not_exportable: 'repair_lifecycle_controls',
    semantic_contract_blocked: 'repair_semantic_contract',
    denied_effects_present: 'resolve_denied_effects_before_handoff',
    missing_verifier_claims: 'collect_required_verifier_claims',
    external_write_denied_effects_present: 'resolve_denied_write_effects',
    external_write_missing_required_claims: 'collect_required_claims',
    recovery_external_write_blocked: 'resolve_external_write_before_recovery',
    export_not_ready: 'wait_for_export_ready',
    acceptance_not_enabled: 'collect_operator_acknowledgement'
  }[blocker] ?? 'operator_review';
}

function buildLoweringAnalytics({
  kernelCall,
  featureState,
  continuationState,
  permissionBoundary,
  exportReport,
  acceptanceSummary,
  providerContract,
  providerPersistence,
  clientRuntimeState,
  clientWorkflow,
  statusRecoveryPacket,
  mailchimpExportHandoff,
  operatorExportBriefing,
  routeAcceptanceDecision,
  routeClientAcceptanceHandoff,
  clientRuntimeAdoptionHandoff,
  lifecycleControlPanel,
  semanticLifecycleControls,
  mailchimpAnalyticsExport
}) {
  const deniedEffects = permissionBoundary?.permissions?.deniedEffects ?? [];
  const timeline = exportReport.timeline ?? [];
  const semantic = kernelCall?.semantic ?? {};
  return {
    schemaVersion: `${LOWERING_PLAN_VERSION}.analytics`,
    programId: kernelCall?.programId ?? null,
    operation: kernelCall?.operation ?? null,
    counters: {
      kernelCallCount: 1,
      featureGeneration: Number(featureState?.generation ?? 0),
      continuationGeneration: Number(continuationState?.generation ?? 0),
      permissionDeniedEffectCount: deniedEffects.length,
      lifecycleWarningCount: kernelCall?.analytics?.counters?.lifecycleWarningCount ?? 0,
      actionableErrorCount: kernelCall?.analytics?.counters?.actionableErrorCount ?? 0,
      semanticErrorCount: kernelCall?.analytics?.counters?.semanticErrorCount ?? 0,
      externalWriteRequiredCount: semantic.externalWrite?.writeRequired ? 1 : 0,
      recoveryBlockedCount: semantic.recovery?.status === 'blocked' ? 1 : 0,
      timelineEventCount: timeline.length,
      exportSnapshotCount: exportReport.history?.snapshots?.length ?? 0,
      acceptanceBlockerCount: acceptanceSummary?.blockers?.length ?? 0,
      acceptanceWarningCount: acceptanceSummary?.warnings?.length ?? 0,
      providerContractBlockerCount: providerContract?.negotiation?.blockers?.length ?? 0,
      providerContractWarningCount: providerContract?.negotiation?.warnings?.length ?? 0,
      providerServiceReadyCount: providerContract?.serviceContract?.ready ? 1 : 0,
      providerServiceMissingCapabilityCount: providerContract?.serviceContract?.missingCapabilities?.length ?? 0,
      providerServiceCommandCount: providerContract?.serviceContract?.commandCount ?? 0,
      providerHealthReadyCount: providerContract?.health?.ready ? 1 : 0,
      providerHealthDegradedCount: providerContract?.health?.degraded ? 1 : 0,
      providerHealthBlockerCount: providerContract?.health?.blockers?.length ?? 0,
      providerPersistenceBlockerCount: providerPersistence?.blockers?.length ?? 0,
      providerPersistenceReadyCount: providerPersistence?.status === 'ready' ? 1 : 0,
      clientRuntimeStateBlockerCount: clientRuntimeState?.blockers?.length ?? 0,
      clientRuntimeStateReadyCount: clientRuntimeState?.ready ? 1 : 0,
      clientWorkflowBlockerCount: clientWorkflow?.blockers?.length ?? 0,
      clientWorkflowWarningCount: clientWorkflow?.warnings?.length ?? 0,
      workflowAcceptanceReadyCount: clientWorkflow?.state === 'ready' && acceptanceSummary?.acceptEnabled ? 1 : 0,
      externalWriteAcceptanceBlockerCount: semantic.externalWrite?.acceptancePacket?.blockers?.length ?? 0,
      recoveryAcceptanceBlockerCount: semantic.recovery?.acceptanceHandoff?.blockers?.length ?? 0,
      statusRecoveryReadyCount: statusRecoveryPacket?.ready ? 1 : 0,
      statusRecoveryBlockerCount: statusRecoveryPacket?.blockers?.length ?? 0,
      statusRecoveryTimelineEventCount: statusRecoveryPacket?.timeline?.length ?? 0,
      statusJournalReadyCount: statusRecoveryPacket?.statusJournal?.ready ? 1 : 0,
      statusJournalCommandCount: statusRecoveryPacket?.statusJournal?.commandCount ?? 0,
      externalStatusHandoffReadyCount: semantic.externalWrite?.statusHandoff?.ready ? 1 : 0,
      externalStatusHandoffBlockerCount: semantic.externalWrite?.statusHandoff?.blockers?.length ?? 0,
      recoveryStatusHandoffReadyCount: semantic.recovery?.statusHandoff?.ready ? 1 : 0,
      recoveryStatusHandoffBlockerCount: semantic.recovery?.statusHandoff?.blockers?.length ?? 0,
      clientRequestSnapshotReadyCount: statusRecoveryPacket?.clientRequestSnapshot?.ready ? 1 : 0,
      clientRequestSnapshotCommandCount: statusRecoveryPacket?.clientRequestSnapshot?.commandCount ?? 0,
      boundaryTicketReadyCount: semantic.externalWrite?.boundaryTicket?.ready ? 1 : 0,
      boundaryTicketBlockerCount: semantic.externalWrite?.boundaryTicket?.blockers?.length ?? 0,
      boundaryTicketWarningCount: semantic.externalWrite?.boundaryTicket?.warnings?.length ?? 0,
      boundaryRecoveryGuardReadyCount: semantic.externalWrite?.boundaryRecoveryGuard?.ready ? 1 : 0,
      boundaryRecoveryGuardBlockerCount: semantic.externalWrite?.boundaryRecoveryGuard?.blockers?.length ?? 0,
      boundaryRecoveryGuardWarningCount: semantic.externalWrite?.boundaryRecoveryGuard?.warnings?.length ?? 0,
      boundaryRecoveryGuardRetryableCount: semantic.externalWrite?.boundaryRecoveryGuard?.retryable ? 1 : 0,
      boundaryRecoveryGuardCommandCount: semantic.externalWrite?.boundaryRecoveryGuard?.commands?.length ?? 0,
      externalWriteExportLedgerReadyCount: semantic.externalWrite?.exportLedger?.ready ? 1 : 0,
      externalWriteExportLedgerBlockerCount: semantic.externalWrite?.exportLedger?.blockers?.length ?? 0,
      recoveryExportContinuityReadyCount: semantic.recovery?.exportContinuity?.ready ? 1 : 0,
      recoveryExportContinuityBlockerCount: semantic.recovery?.exportContinuity?.blockers?.length ?? 0,
      mailchimpExportHandoffReadyCount: mailchimpExportHandoff?.ready ? 1 : 0,
      mailchimpExportHandoffBlockerCount: mailchimpExportHandoff?.blockers?.length ?? 0,
      mailchimpExportHandoffCheckpointCount: mailchimpExportHandoff?.timeline?.length ?? 0,
      operatorExportBriefingReadyCount: operatorExportBriefing?.ready ? 1 : 0,
      operatorExportBriefingBlockerCount: operatorExportBriefing?.blockers?.length ?? 0,
      operatorExportBriefingWarningCount: operatorExportBriefing?.warnings?.length ?? 0,
      operatorExportBriefingCheckpointCount: operatorExportBriefing?.timeline?.length ?? 0,
      routeAcceptanceReadyCount: routeAcceptanceDecision?.ready ? 1 : 0,
      routeAcceptanceBlockerCount: routeAcceptanceDecision?.blockers?.length ?? 0,
      routeAcceptanceWarningCount: routeAcceptanceDecision?.warnings?.length ?? 0,
      routeAcceptanceCheckpointCount: routeAcceptanceDecision?.validationSummary?.checks?.length ?? 0,
      routeClientAcceptanceReadyCount: routeClientAcceptanceHandoff?.ready ? 1 : 0,
      routeClientAcceptanceBlockerCount: routeClientAcceptanceHandoff?.blockers?.length ?? 0,
      routeClientAcceptanceWarningCount: routeClientAcceptanceHandoff?.warnings?.length ?? 0,
      clientRuntimeAdoptionReadyCount: clientRuntimeAdoptionHandoff?.ready ? 1 : 0,
      clientRuntimeAdoptionBlockerCount: clientRuntimeAdoptionHandoff?.blockers?.length ?? 0,
      clientRuntimeAdoptionWarningCount: clientRuntimeAdoptionHandoff?.warnings?.length ?? 0,
      clientRuntimeAdoptionCheckpointCount: clientRuntimeAdoptionHandoff?.checkpoints?.length ?? 0,
      lifecycleControlReadyCount: lifecycleControlPanel?.ready ? 1 : 0,
      lifecycleControlBlockerCount: lifecycleControlPanel?.blockers?.length ?? 0,
      lifecycleControlWarningCount: lifecycleControlPanel?.warnings?.length ?? 0,
      lifecycleControlCommandCount: lifecycleControlPanel?.commandCount ?? 0,
      semanticLifecycleReadyCount: semanticLifecycleControls?.ready ? 1 : 0,
      semanticLifecycleBlockerCount: semanticLifecycleControls?.blockers?.length ?? 0,
      semanticLifecycleWarningCount: semanticLifecycleControls?.warnings?.length ?? 0,
      semanticLifecycleCommandCount: semanticLifecycleControls?.commandIds?.length ?? 0,
      mailchimpAnalyticsExportReadyCount: mailchimpAnalyticsExport?.ready ? 1 : 0,
      mailchimpAnalyticsExportBlockerCount: mailchimpAnalyticsExport?.blockers?.length ?? 0,
      mailchimpAnalyticsExportWarningCount: mailchimpAnalyticsExport?.warnings?.length ?? 0,
      mailchimpAnalyticsExportSnapshotCount: mailchimpAnalyticsExport?.historySnapshots?.length ?? 0,
      mailchimpAnalyticsExportTimelineCount: mailchimpAnalyticsExport?.timeline?.length ?? 0
    },
    status: {
      planExportReady: exportReport.analytics?.exportReady === true
        && deniedEffects.length === 0
        && semantic.externalWrite?.status !== 'blocked'
        && semantic.recovery?.status !== 'blocked'
        && acceptanceSummary?.exportReady === true
        && providerContract?.negotiation?.status === 'accepted'
        && providerContract?.serviceContract?.ready !== false,
      kernelHealth: kernelCall?.health?.status ?? 'unknown',
      featureStatus: featureState?.status ?? 'unknown',
      continuationStatus: continuationState?.status ?? 'unknown',
      lifecycleState: kernelCall?.lifecycle?.state ?? 'unknown',
      externalWriteStatus: semantic.externalWrite?.status ?? 'not_analyzed',
      recoveryStatus: semantic.recovery?.status ?? 'not_analyzed',
      acceptanceState: acceptanceSummary?.acceptanceState ?? 'unknown',
      providerStatus: providerContract?.negotiation?.status ?? 'unknown',
      providerServiceState: providerContract?.serviceContract?.state ?? 'unknown',
      providerHealthStatus: providerContract?.health?.status ?? 'unknown',
      providerPersistenceStatus: providerPersistence?.status ?? 'unknown',
      clientRuntimeState: clientRuntimeState?.state ?? 'unknown',
      clientWorkflowState: clientWorkflow?.state ?? 'unknown',
      statusRecoveryState: statusRecoveryPacket?.state ?? 'unknown',
      statusJournalState: statusRecoveryPacket?.statusJournal?.state ?? 'unknown',
      externalStatusHandoffState: semantic.externalWrite?.statusHandoff?.state ?? 'unknown',
      recoveryStatusHandoffState: semantic.recovery?.statusHandoff?.state ?? 'unknown',
      boundaryTicketState: semantic.externalWrite?.boundaryTicket?.state ?? 'unknown',
      boundaryRecoveryGuardState: semantic.externalWrite?.boundaryRecoveryGuard?.state ?? 'unknown',
      boundaryRecoveryReplayPolicy: semantic.externalWrite?.boundaryRecoveryGuard?.replayPolicy ?? null,
      externalWriteExportLedgerState: semantic.externalWrite?.exportLedger?.state ?? 'unknown',
      recoveryExportContinuityState: semantic.recovery?.exportContinuity?.state ?? 'unknown',
      mailchimpExportHandoffState: mailchimpExportHandoff?.state ?? 'unknown',
      operatorExportBriefingState: operatorExportBriefing?.state ?? 'unknown',
      routeAcceptanceState: routeAcceptanceDecision?.state ?? 'unknown',
      routeClientAcceptanceState: routeClientAcceptanceHandoff?.state ?? 'unknown',
      clientRuntimeAdoptionState: clientRuntimeAdoptionHandoff?.state ?? 'unknown',
      lifecycleControlState: lifecycleControlPanel?.state ?? 'unknown',
      semanticLifecycleState: semanticLifecycleControls?.state ?? 'unknown',
      mailchimpAnalyticsExportState: mailchimpAnalyticsExport?.state ?? 'unknown',
      nextAction: acceptanceSummary?.blockers?.length
        ? acceptanceSummary.nextAction
        : clientWorkflow?.blockers?.length
          ? clientWorkflow.nextAction
        : providerContract?.negotiation?.blockers?.length
          ? providerContract.nextAction
        : providerContract?.serviceContract?.ready === false
          ? providerContract.serviceContract.nextAction
        : clientRuntimeState?.blockers?.length
          ? clientRuntimeState.nextAction
        : providerPersistence?.blockers?.length
          ? providerPersistence.nextAction
        : statusRecoveryPacket?.blockers?.length
          ? statusRecoveryPacket.nextAction
        : mailchimpExportHandoff?.blockers?.length
          ? mailchimpExportHandoff.nextAction
        : operatorExportBriefing?.blockers?.length
          ? operatorExportBriefing.nextAction
        : routeAcceptanceDecision?.blockers?.length
          ? routeAcceptanceDecision.nextAction
        : routeClientAcceptanceHandoff?.blockers?.length
          ? routeClientAcceptanceHandoff.nextAction
        : clientRuntimeAdoptionHandoff?.blockers?.length
          ? clientRuntimeAdoptionHandoff.nextAction
        : lifecycleControlPanel?.blockers?.length
          ? lifecycleControlPanel.nextAction
        : semanticLifecycleControls?.blockers?.length
          ? semanticLifecycleControls.nextAction
        : mailchimpAnalyticsExport?.blockers?.length
          ? mailchimpAnalyticsExport.nextAction
          : semantic.recovery?.nextAction
        ?? semantic.externalWrite?.nextAction
        ?? acceptanceSummary?.nextAction
        ?? providerContract?.nextAction
        ?? kernelCall?.lifecycle?.nextAction
        ?? permissionBoundary?.nextAction
        ?? 'operator_review'
    },
    history: {
      latestDigest: exportReport.history?.latest?.digest ?? null,
      changedSincePrevious: exportReport.history?.changedSincePrevious ?? false,
      statusRecoveryDigest: statusRecoveryPacket?.digest ?? null,
      statusJournalDigest: statusRecoveryPacket?.statusJournal?.digest ?? null,
      externalStatusHandoffDigest: semantic.externalWrite?.statusHandoff?.digest ?? null,
      recoveryStatusHandoffDigest: semantic.recovery?.statusHandoff?.digest ?? null,
      recoveryStatusHandoffExternalDigest: semantic.recovery?.statusHandoff?.externalDigest ?? null,
      mailchimpExportDigest: mailchimpExportHandoff?.digest ?? null,
      operatorExportBriefingDigest: operatorExportBriefing?.digest ?? null,
      routeAcceptanceDigest: routeAcceptanceDecision?.digest ?? null,
      routeClientAcceptanceDigest: routeClientAcceptanceHandoff?.digest ?? null,
      clientRuntimeAdoptionDigest: clientRuntimeAdoptionHandoff?.digest ?? null,
      lifecycleControlDigest: lifecycleControlPanel?.digest ?? null,
      semanticLifecycleDigest: semanticLifecycleControls?.digest ?? null,
      mailchimpAnalyticsExportDigest: mailchimpAnalyticsExport?.digest ?? null,
      mailchimpAnalyticsExportLatestSnapshotId: mailchimpAnalyticsExport?.reporting?.latestSnapshotId ?? null,
      providerServiceDigest: providerContract?.serviceContract?.digest ?? null,
      externalWriteExportLedgerDigest: semantic.externalWrite?.exportLedger?.digest ?? null,
      externalWriteAnalyticsExportDigest: semantic.externalWrite?.analyticsExport?.digest ?? null,
      recoveryExportContinuityDigest: semantic.recovery?.exportContinuity?.digest ?? null,
      boundaryAuditDigest: semantic.externalWrite?.boundaryTicket?.auditDigest ?? null,
      boundaryRecoveryGuardDigest: semantic.externalWrite?.boundaryRecoveryGuard?.guardDigest ?? null
    },
    audit: {
      tenantId: permissionBoundary?.tenantId ?? null,
      workspaceId: permissionBoundary?.workspaceId ?? null,
      isolationKey: permissionBoundary?.isolationKey ?? null,
      channel: permissionBoundary?.audit?.channel ?? null,
      boundaryRecoveryGuard: {
        state: semantic.externalWrite?.boundaryRecoveryGuard?.state ?? 'unknown',
        digest: semantic.externalWrite?.boundaryRecoveryGuard?.guardDigest ?? null,
        replayPolicy: semantic.externalWrite?.boundaryRecoveryGuard?.replayPolicy ?? null,
        nextAction: semantic.externalWrite?.boundaryRecoveryGuard?.nextAction ?? null
      }
    }
  };
}

function deterministicScopeKey(tenantId, workspaceId) {
  return `scope:${stableHash({ tenantId, workspaceId })}`;
}

function optionalString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
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

function dedupeDiagnostics(diagnostics) {
  const seen = new Set();
  const result = [];
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
  }
  return result;
}

function loweringError(code, diagnostics = []) {
  return {
    ok: false,
    plan: null,
    diagnostics: [{ level: 'error', code }, ...diagnostics]
  };
}
