import {
  createMailchimpAstExportBatchSummary,
  createMailchimpAstExportEvidence,
  createMailchimpCampaignExportQueue,
  createMailchimpClientRuntimeTargets,
  createMailchimpLaunchGateContract,
  createMailchimpTenantPermissionBoundaryContract,
  createMailchimpWorkflowState,
  createMailchimpWorkflowPreviewContract,
  getAstNodeKindContract,
  listAstNodeKindContracts,
  normalizeAstNodeKind,
} from "./ast-node-kinds.mjs";
import {
  createCatalogDiagnostic,
  createDiagnosticClientRuntimeState,
  createDiagnosticLifecycleCommandSummary,
  createDiagnosticLifecycleExportState,
  createMailchimpDiagnosticIncidentReport,
  createDiagnosticPersistedResumeState,
  createDiagnosticReleaseChecklist,
  createMailchimpLaunchGateDiagnostics,
  createMailchimpLaunchGateRuntimeState,
  createMailchimpProviderHandoffState,
  createMailchimpProviderReadinessPreview,
  createMailchimpWorkflowDiagnostics,
} from "./diagnostic-catalog.mjs";
import {
  compactSourceRange,
  createMailchimpLaunchGateSourcePreview,
  createMailchimpSourceAnchorHandoffContract,
  createRangeStatus,
  createSourceRangeExportManifest,
  createSourceRangeOperationalTimeline,
  createSourceRangeProviderExportSummary,
  createSourceRangeProviderContract,
  createSourceRangePersistenceSnapshot,
  createSourceRangeReleasePacket,
  createSourceRangeTenantBoundaryAudit,
} from "./source-ranges.mjs";

export const AIOS_FORMATTER_RULES = Object.freeze({
  Program: formatterRule({
    nodeKind: "Program",
    order: 0,
    block: "source",
    blankLineAfter: false,
    statusHandoff: "format-preview",
    preserves: ["job-order"],
  }),
  JobDeclaration: formatterRule({
    nodeKind: "JobDeclaration",
    order: 10,
    block: "job",
    blankLineAfter: true,
    statusHandoff: "descriptor-preview",
    preserves: ["declaration-order", "rollback-position"],
  }),
  CapabilityDeclaration: formatterRule({
    nodeKind: "CapabilityDeclaration",
    order: 20,
    block: "job-member",
    blankLineAfter: false,
    statusHandoff: "provider-contract-preview",
    preserves: ["boundary-annotation", "scope"],
  }),
  MemoryDeclaration: formatterRule({
    nodeKind: "MemoryDeclaration",
    order: 30,
    block: "job-member",
    blankLineAfter: false,
    statusHandoff: "memory-contract-preview",
    preserves: ["mode", "name"],
  }),
  StepDeclaration: formatterRule({
    nodeKind: "StepDeclaration",
    order: 40,
    block: "job-member",
    blankLineAfter: false,
    statusHandoff: "adapter-status-preview",
    preserves: ["adapter-operation", "read-write-lanes", "recovery"],
  }),
  VerifierDeclaration: formatterRule({
    nodeKind: "VerifierDeclaration",
    order: 50,
    block: "job-member",
    blankLineAfter: false,
    statusHandoff: "claim-preview",
    preserves: ["claim-expression"],
  }),
  TruthBoundaryDeclaration: formatterRule({
    nodeKind: "TruthBoundaryDeclaration",
    order: 60,
    block: "job-member",
    blankLineAfter: false,
    statusHandoff: "truth-boundary-preview",
    preserves: ["source", "confidence"],
  }),
  RollbackDeclaration: formatterRule({
    nodeKind: "RollbackDeclaration",
    order: 70,
    block: "job-member",
    blankLineAfter: false,
    statusHandoff: "recovery-preview",
    preserves: ["strategy", "target"],
  }),
});

export function listFormatterRules() {
  return Object.freeze(Object.values(AIOS_FORMATTER_RULES)
    .sort((left, right) => left.order - right.order || left.nodeKind.localeCompare(right.nodeKind)));
}

export function getFormatterRule(kindOrNode) {
  const kind = normalizeAstNodeKind(kindOrNode);
  return kind ? AIOS_FORMATTER_RULES[kind] ?? null : null;
}

export function validateFormatterRules(rules = listFormatterRules()) {
  const diagnostics = [];
  const seen = new Set();

  for (const rule of rules) {
    const kind = normalizeAstNodeKind(rule.nodeKind);
    if (!kind || !getAstNodeKindContract(kind)) {
      diagnostics.push(createCatalogDiagnostic("AIOS_FORMAT_RULE", {
        message: `Formatter rule targets unknown AST node kind "${rule.nodeKind}".`,
      }));
      continue;
    }
    if (seen.has(kind)) {
      diagnostics.push(createCatalogDiagnostic("AIOS_FORMAT_RULE", {
        message: `Formatter rule for "${kind}" is declared more than once.`,
      }));
    }
    seen.add(kind);
  }

  for (const contract of listAstNodeKindContracts()) {
    if (!seen.has(contract.kind)) {
      diagnostics.push(createCatalogDiagnostic("AIOS_FORMAT_RULE", {
        message: `Formatter rule for "${contract.kind}" is missing.`,
      }));
    }
  }

  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    ruleCount: rules.length,
  });
}

export function createFormatterPlanForAst(ast = {}, options = {}) {
  const items = [];
  const diagnostics = [];
  const fileName = options.fileName ?? "inline.aios";

  collectFormatterItems(ast, {
    fileName,
    path: [],
    items,
    diagnostics,
  });

  return Object.freeze({
    ok: diagnostics.length === 0,
    fileName,
    items: Object.freeze(items.sort(comparePlanItems)),
    diagnostics: Object.freeze(diagnostics),
    handoff: Object.freeze({
      status: diagnostics.length ? "review" : "ready",
      previewRanges: Object.freeze(items.map((item) => item.previewRange)),
      formatRuleCount: listFormatterRules().length,
    }),
  });
}

export function createFormatterContractSnapshot(ast = {}, options = {}) {
  const validation = validateFormatterRules();
  const plan = createFormatterPlanForAst(ast, options);
  const ruleCoverage = Object.fromEntries(listFormatterRules().map((rule) => [rule.nodeKind, 0]));

  for (const item of plan.items) {
    ruleCoverage[item.nodeKind] = (ruleCoverage[item.nodeKind] ?? 0) + 1;
  }

  return Object.freeze({
    ok: validation.ok && plan.ok,
    validation,
    plan,
    coverage: Object.freeze(Object.fromEntries(
      Object.entries(ruleCoverage).sort(([left], [right]) => left.localeCompare(right)),
    )),
  });
}

export function createFormatterPreviewContract(ast = {}, options = {}) {
  const validation = validateFormatterRules();
  const plan = createFormatterPlanForAst(ast, options);
  const mailchimpOptions = {
    ...(options.mailchimpWorkflow ?? options.mailchimp ?? {}),
    tenantPermissions: options.mailchimpTenantPermissions
      ?? options.tenantPermissions
      ?? options.mailchimpWorkflow?.tenantPermissions
      ?? options.mailchimp?.tenantPermissions,
  };
  const mailchimpWorkflow = createMailchimpWorkflowState(ast, mailchimpOptions);
  const mailchimpWorkflowPreview = createMailchimpWorkflowPreviewContract(ast, {
    ...mailchimpOptions,
    acceptedMailchimpJobNames: options.acceptedMailchimpJobNames,
    requireMailchimpWorkflowAcceptance: options.requireMailchimpWorkflowAcceptance,
    acceptedAt: options.acceptedAt,
  });
  const mailchimpRangeByJobName = createFormatterRangeByJobName(plan.items);
  const mailchimpDiagnostics = createMailchimpWorkflowDiagnostics(mailchimpWorkflow, {
    rangeByJobName: mailchimpRangeByJobName,
    previewPrefix: "Formatter Mailchimp handoff",
  });
  const mailchimpHandoff = createMailchimpProviderHandoffState(mailchimpWorkflow, mailchimpDiagnostics, {
    acceptedMailchimpOperationIds: options.acceptedMailchimpOperationIds,
    queuedMailchimpCommandIds: options.queuedMailchimpCommandIds,
    failedMailchimpCommandIds: options.failedMailchimpCommandIds,
    mailchimpRetryAfterByOperationId: options.mailchimpRetryAfterByOperationId,
    mailchimpAttemptByOperationId: options.mailchimpAttemptByOperationId,
    mailchimpMaxRetryAttempts: options.mailchimpMaxRetryAttempts,
    mailchimpRetryBaseSeconds: options.mailchimpRetryBaseSeconds,
    requireMailchimpOperationAcceptance: options.requireMailchimpOperationAcceptance,
    mailchimpDegradedMode: options.mailchimpDegradedMode,
    receivedMailchimpCommandIds: options.receivedMailchimpCommandIds,
    acknowledgedMailchimpCommandIds: options.acknowledgedMailchimpCommandIds,
    completedMailchimpCommandIds: options.completedMailchimpCommandIds,
    receiptFailedMailchimpCommandIds: options.receiptFailedMailchimpCommandIds,
    failedReceiptMailchimpCommandIds: options.failedReceiptMailchimpCommandIds,
    duplicateMailchimpCommandIds: options.duplicateMailchimpCommandIds,
    mailchimpReceiptIdByCommandId: options.mailchimpReceiptIdByCommandId,
    mailchimpProviderMessageByCommandId: options.mailchimpProviderMessageByCommandId,
    mailchimpReceiptReceivedAtByCommandId: options.mailchimpReceiptReceivedAtByCommandId,
    rangeByJobName: mailchimpRangeByJobName,
  });
  const providerDiagnostics = Object.freeze([
    ...mailchimpDiagnostics,
    ...(mailchimpHandoff.operationalHealth?.diagnostics ?? []),
  ]);
  const mailchimpTenantBoundary = createMailchimpTenantPermissionBoundaryContract(mailchimpWorkflow, {
    revision: options.revision,
    externalRunId: options.externalRunId,
  });
  const providerContract = createSourceRangeProviderContract(plan.items.map((item) => ({
    type: item.nodeKind,
    name: item.path.at(-1),
    range: item.range,
  })), {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities,
  });
  const sourcePersistence = createSourceRangePersistenceSnapshot(plan.items.map((item) => ({
    type: item.nodeKind,
    name: item.path.at(-1),
    range: item.range,
  })), {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities,
    previousAnchors: options.previousSourceAnchors,
    acceptedAnchorIds: options.acceptedSourceAnchorIds,
    requireAnchorAcceptance: options.requireSourceAnchorAcceptance,
  });
  const validationSummary = createFormatterValidationSummary(validation, plan, providerContract, providerDiagnostics);
  const previewItems = plan.items.map((item, index) => createFormatterPreviewItem(item, index, options, mailchimpHandoff));
  const readiness = createFormatterReadinessState(validationSummary, previewItems, options, mailchimpHandoff);
  const acceptance = createFormatterAcceptanceContract(readiness, previewItems, options);
  const diagnosticClientState = createDiagnosticClientRuntimeState(validationSummary.diagnostics, {
    ...(options.diagnosticLifecycle ?? {}),
    mailchimpWorkflowPreview,
  });
  const diagnosticExportState = createDiagnosticLifecycleExportState(validationSummary.diagnostics, {
    ...(options.diagnosticLifecycle ?? {}),
    mailchimpWorkflowPreview,
  });
  const persistedState = createFormatterPersistedHandoffState({
    plan,
    readiness,
    acceptance,
    providerContract,
    sourcePersistence,
    mailchimpHandoff,
    mailchimpWorkflow,
    mailchimpTenantBoundary,
    diagnosticClientState,
    mailchimpWorkflowPreview,
  }, options);
  const astExportEvidence = createMailchimpAstExportEvidence(ast, {
    ...mailchimpOptions,
    fileName: plan.fileName,
    astHistory: options.astHistory,
    astHistoryLimit: options.astHistoryLimit,
    acceptedMailchimpJobNames: options.acceptedMailchimpJobNames,
    requireMailchimpWorkflowAcceptance: options.requireMailchimpWorkflowAcceptance,
    acceptedAt: options.acceptedAt,
  });
  const sourceExportManifest = createSourceRangeExportManifest(plan.items.map((item) => ({
    type: item.nodeKind,
    name: item.path.at(-1),
    range: item.range,
  })), {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities,
    previousAnchors: options.previousSourceAnchors,
    acceptedAnchorIds: options.acceptedSourceAnchorIds,
    requireAnchorAcceptance: options.requireSourceAnchorAcceptance,
    providerContract,
    persistence: sourcePersistence,
  });
  const sourceReleasePacket = createSourceRangeReleasePacket(plan.items.map((item) => ({
    type: item.nodeKind,
    name: item.path.at(-1),
    range: item.range,
  })), {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    sourceCapabilities: options.sourceCapabilities,
    previousSourceAnchors: options.previousSourceAnchors,
    acceptedSourceAnchorIds: options.acceptedSourceAnchorIds,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
    providerContract,
    persistence: sourcePersistence,
    manifest: sourceExportManifest,
  });
  const sourceBoundaryAudit = createSourceRangeTenantBoundaryAudit(plan.items.map((item) => ({
    type: item.nodeKind,
    name: item.path.at(-1),
    range: item.range,
  })), {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    sourceCapabilities: options.sourceCapabilities,
    previousSourceAnchors: options.previousSourceAnchors,
    acceptedSourceAnchorIds: options.acceptedSourceAnchorIds,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
    tenantId: options.tenantId ?? options.mailchimpTenantPermissions?.tenantId ?? options.tenantPermissions?.tenantId,
    workspaceId: options.workspaceId ?? options.mailchimpTenantPermissions?.workspaceId ?? options.tenantPermissions?.workspaceId,
    role: options.role ?? options.permissionRole ?? options.mailchimpTenantPermissions?.role ?? options.tenantPermissions?.role,
    permission: options.permission,
    allowedSourceFileNames: options.allowedSourceFileNames,
    allowedWorkspaceIds: options.allowedWorkspaceIds ?? options.mailchimpTenantPermissions?.allowedWorkspaceIds ?? options.tenantPermissions?.allowedWorkspaceIds,
    allowedRoles: options.allowedRoles ?? options.mailchimpTenantPermissions?.allowedRoles ?? options.tenantPermissions?.allowedRoles,
    writeRoles: options.writeRoles ?? options.mailchimpTenantPermissions?.writeRoles ?? options.tenantPermissions?.writeRoles,
    requireTenantBoundary: options.requireTenantBoundary ?? options.mailchimpTenantPermissions?.requireTenantBoundary ?? options.tenantPermissions?.requireTenantBoundary,
    providerContract,
    persistence: sourcePersistence,
  });
  const mailchimpLaunchGate = createMailchimpLaunchGateContract(ast, {
    ...mailchimpOptions,
    workflowState: mailchimpWorkflow,
    workflowPreview: mailchimpWorkflowPreview,
    astEvidence: astExportEvidence,
    revision: options.revision,
    requiredLaunchGateIds: options.requiredMailchimpLaunchGateIds,
  });
  const mailchimpLaunchDiagnostics = createMailchimpLaunchGateDiagnostics(mailchimpLaunchGate, {
    rangeByJobName: mailchimpRangeByJobName,
  });
  const mailchimpLaunchRuntimeState = createMailchimpLaunchGateRuntimeState(mailchimpLaunchGate, {
    rangeByJobName: mailchimpRangeByJobName,
  });
  const mailchimpLaunchSourcePreview = createMailchimpLaunchGateSourcePreview(plan.items.map((item) => ({
    type: item.nodeKind,
    name: item.path.at(-1),
    range: item.range,
  })), mailchimpLaunchGate, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    sourceCapabilities: options.sourceCapabilities,
    previousSourceAnchors: options.previousSourceAnchors,
    acceptedSourceAnchorIds: options.acceptedSourceAnchorIds,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
    acceptedMailchimpLaunchGateIds: options.acceptedMailchimpLaunchGateIds,
    requireLaunchGateAcceptance: options.requireMailchimpLaunchGateAcceptance,
    providerContract,
    persistence: sourcePersistence,
  });
  const mailchimpLaunchHandoff = createFormatterMailchimpLaunchHandoff({
    launchGate: mailchimpLaunchGate,
    diagnostics: mailchimpLaunchDiagnostics,
    runtimeState: mailchimpLaunchRuntimeState,
    sourcePreview: mailchimpLaunchSourcePreview,
    mailchimpHandoff,
  });
  const mailchimpRuntimeTargets = createMailchimpClientRuntimeTargets(ast, {
    ...mailchimpOptions,
    workflowState: mailchimpWorkflow,
    workflowPreview: mailchimpWorkflowPreview,
    launchGate: mailchimpLaunchGate,
    revision: options.revision,
    acceptedMailchimpJobNames: options.acceptedMailchimpJobNames,
    acceptedMailchimpOperationIds: options.acceptedMailchimpOperationIds,
  });
  const sourceOperationalTimeline = createSourceRangeOperationalTimeline({
    providerContract,
    persistence: sourcePersistence,
    manifest: sourceExportManifest,
    releasePacket: sourceReleasePacket,
    boundaryAudit: sourceBoundaryAudit,
  }, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
  });
  const sourceAnchorHandoff = createMailchimpSourceAnchorHandoffContract({
    providerContract,
    persistence: sourcePersistence,
    manifest: sourceExportManifest,
    releasePacket: sourceReleasePacket,
  }, mailchimpHandoff, {
    fileName: plan.fileName,
    revision: options.revision,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
  });
  const diagnosticReleaseChecklist = createDiagnosticReleaseChecklist(validationSummary.diagnostics, {
    ...(options.diagnosticLifecycle ?? {}),
    clientState: diagnosticClientState,
    exportState: diagnosticExportState,
    mailchimpWorkflowPreview,
    releaseLanes: [
      {
        id: "source-release",
        kind: "sourceRangeRelease",
        status: sourceReleasePacket.status,
        label: "Source range release",
        detail: `${sourceReleasePacket.anchors.length} source anchors prepared for release.`,
        handoff: sourceReleasePacket.restartEnvelope.route,
        nextAction: sourceReleasePacket.restartEnvelope.nextAction,
        restartSafe: sourceReleasePacket.restartSafe,
        idempotencyKey: sourceReleasePacket.syncKey,
      },
      {
        id: "source-boundary",
        kind: "sourceRangeBoundary",
        status: sourceBoundaryAudit.status,
        label: "Source boundary audit",
        detail: `${sourceBoundaryAudit.auditEvents.length} source anchors checked against the tenant boundary.`,
        handoff: sourceBoundaryAudit.restartEnvelope.route,
        nextAction: sourceBoundaryAudit.restartEnvelope.nextAction,
        restartSafe: sourceBoundaryAudit.restartEnvelope.restartSafe,
        idempotencyKey: sourceBoundaryAudit.syncKey,
      },
      {
        id: "source-operational-timeline",
        kind: "sourceRangeOperationalTimeline",
        status: sourceOperationalTimeline.status,
        label: "Source operational timeline",
        detail: `${sourceOperationalTimeline.totals.eventCount} source operational events prepared for resume.`,
        handoff: sourceOperationalTimeline.restartEnvelope.route,
        nextAction: sourceOperationalTimeline.restartEnvelope.nextAction,
        restartSafe: sourceOperationalTimeline.restartEnvelope.restartSafe,
        idempotencyKey: sourceOperationalTimeline.restartEnvelope.idempotencyKeys.join("|") || null,
      },
      {
        id: "mailchimp-source-anchors",
        kind: "mailchimpSourceAnchor",
        status: sourceAnchorHandoff.status,
        label: "Mailchimp source anchors",
        detail: `${sourceAnchorHandoff.totals.anchoredOperationCount} of ${sourceAnchorHandoff.totals.operationCount} Mailchimp operations have source anchors.`,
        handoff: sourceAnchorHandoff.restartEnvelope.route,
        nextAction: sourceAnchorHandoff.restartEnvelope.nextAction,
        restartSafe: sourceAnchorHandoff.restartEnvelope.restartSafe,
        idempotencyKey: sourceAnchorHandoff.syncKey,
      },
      {
        id: "mailchimp-launch",
        kind: "mailchimpLaunchGate",
        status: mailchimpLaunchHandoff.status,
        label: "Mailchimp launch gates",
        detail: `${mailchimpLaunchHandoff.validationSummary.gateCount} launch gates checked.`,
        handoff: "mailchimp-launch-gate",
        nextAction: mailchimpLaunchHandoff.nextAction,
        restartSafe: mailchimpLaunchHandoff.runtime.restartSafe,
        idempotencyKey: mailchimpLaunchHandoff.syncKey,
      },
      {
        id: "mailchimp-runtime-targets",
        kind: "mailchimpRuntimeTargets",
        status: mailchimpRuntimeTargets.status,
        label: "Mailchimp runtime targets",
        detail: `${mailchimpRuntimeTargets.targets.length} client runtime targets prepared for Mailchimp handoff.`,
        handoff: mailchimpRuntimeTargets.restartEnvelope.route,
        nextAction: mailchimpRuntimeTargets.restartEnvelope.nextAction,
        restartSafe: mailchimpRuntimeTargets.restartEnvelope.restartSafe,
        idempotencyKey: mailchimpRuntimeTargets.syncKey,
      },
    ],
  });
  const diagnosticPersistedResumeState = createDiagnosticPersistedResumeState(validationSummary.diagnostics, {
    ...(options.diagnosticLifecycle ?? {}),
    fileName: plan.fileName,
    revision: options.revision,
    clientState: diagnosticClientState,
    exportState: diagnosticExportState,
    releaseChecklist: diagnosticReleaseChecklist,
    mailchimpWorkflowPreview,
    resumeCommands: options.diagnosticResumeCommands,
  });
  const mailchimpDiagnosticIncidentReport = createMailchimpDiagnosticIncidentReport(validationSummary.diagnostics, {
    ...(options.diagnosticLifecycle ?? {}),
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
    clientState: diagnosticClientState,
    exportState: diagnosticExportState,
    releaseChecklist: diagnosticReleaseChecklist,
    persistedResume: diagnosticPersistedResumeState,
    mailchimpWorkflowPreview,
    mailchimpHandoff,
    sourceOperationalTimeline,
  });
  const mailchimpProviderIncidentContract = createFormatterMailchimpProviderIncidentContract({
    incidentReport: mailchimpDiagnosticIncidentReport,
    mailchimpHandoff,
    mailchimpReleaseReadiness: null,
    sourceOperationalTimeline,
    sourceAnchorHandoff,
    persistedState,
  }, options);
  const astExportBatchSummary = createMailchimpAstExportBatchSummary(ast, {
    ...mailchimpOptions,
    fileName: plan.fileName,
    revision: options.revision,
    astEvidence: astExportEvidence,
    workflowState: mailchimpWorkflow,
    historyLimit: options.astHistoryLimit,
    timelineLimit: options.astTimelineLimit,
  });
  const mailchimpCampaignExportQueue = createMailchimpCampaignExportQueue(ast, {
    ...mailchimpOptions,
    fileName: plan.fileName,
    revision: options.revision,
    astEvidence: astExportEvidence,
    astExportBatchSummary,
    workflowState: mailchimpWorkflow,
    acceptedMailchimpExportJobNames: options.acceptedMailchimpExportJobNames ?? options.acceptedMailchimpJobNames,
    queuedMailchimpExportJobNames: options.queuedMailchimpExportJobNames,
    exportedMailchimpJobNames: options.exportedMailchimpJobNames,
    failedMailchimpExportJobNames: options.failedMailchimpExportJobNames,
    requireMailchimpCampaignExportAcceptance: options.requireMailchimpCampaignExportAcceptance,
  });
  const sourceProviderExportSummary = createSourceRangeProviderExportSummary({
    providerContract,
    persistence: sourcePersistence,
    manifest: sourceExportManifest,
    timeline: sourceOperationalTimeline,
  }, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
  });
  const mailchimpSourceAnchorHandoff = createMailchimpSourceAnchorHandoffContract({
    providerContract,
    persistence: sourcePersistence,
    manifest: sourceExportManifest,
    releasePacket: sourceReleasePacket,
    providerSummary: sourceProviderExportSummary,
  }, mailchimpHandoff, {
    fileName: plan.fileName,
    revision: options.revision,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
  });
  const diagnosticCommandSummary = createDiagnosticLifecycleCommandSummary(validationSummary.diagnostics, {
    ...(options.diagnosticLifecycle ?? {}),
    lifecycle: diagnosticClientState.lifecycle,
    exportState: diagnosticExportState,
    mailchimpWorkflowPreview,
  });
  const mailchimpScheduleWindowRuntime = createFormatterMailchimpScheduleWindowRuntime({
    mailchimpWorkflow,
    mailchimpWorkflowPreview,
    mailchimpHandoff,
    mailchimpCampaignExportQueue,
  }, options);
  const mailchimpExportDecision = createFormatterMailchimpExportDecision({
    readiness,
    acceptance,
    astExportBatchSummary,
    mailchimpCampaignExportQueue,
    sourceProviderExportSummary,
    diagnosticCommandSummary,
    mailchimpHandoff,
    mailchimpTenantBoundary,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    mailchimpSourceAnchorHandoff,
    mailchimpScheduleWindowRuntime,
    sourceOperationalTimeline,
    persistedState,
  }, options);
  const mailchimpReleaseReadiness = createFormatterMailchimpReleaseReadinessPacket({
    readiness,
    acceptance,
    validationSummary,
    sourceReleasePacket,
    sourceBoundaryAudit,
    sourceOperationalTimeline,
    mailchimpSourceAnchorHandoff,
    diagnosticReleaseChecklist,
    diagnosticPersistedResumeState,
    mailchimpWorkflowPreview,
    mailchimpHandoff,
    mailchimpTenantBoundary,
    mailchimpLaunchHandoff,
    mailchimpRuntimeTargets,
    persistedState,
    astExportEvidence,
    sourceExportManifest,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    astExportBatchSummary,
    mailchimpCampaignExportQueue,
    sourceProviderExportSummary,
    diagnosticCommandSummary,
    mailchimpExportDecision,
    mailchimpScheduleWindowRuntime,
  }, options);
  const mailchimpRuntimeResumePacket = createFormatterMailchimpRuntimeResumePacket({
    mailchimpReleaseReadiness,
    mailchimpRuntimeTargets,
    sourceBoundaryAudit,
    diagnosticPersistedResumeState,
    sourceOperationalTimeline,
    mailchimpSourceAnchorHandoff,
    persistedState,
    sourceReleasePacket,
    mailchimpLaunchHandoff,
    mailchimpHandoff,
    mailchimpTenantBoundary,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    mailchimpExportDecision,
    mailchimpScheduleWindowRuntime,
  });
  const analyticsReport = createFormatterAnalyticsReport({
    validation,
    plan,
    previewItems,
    readiness,
    acceptance,
    providerContract,
    sourcePersistence,
    sourceOperationalTimeline,
    mailchimpWorkflow,
    mailchimpWorkflowPreview,
    mailchimpHandoff,
    mailchimpTenantBoundary,
    providerDiagnostics,
    diagnosticClientState,
    diagnosticExportState,
    persistedState,
    astExportEvidence,
    sourceExportManifest,
    mailchimpSourceAnchorHandoff,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    astExportBatchSummary,
    mailchimpCampaignExportQueue,
    sourceProviderExportSummary,
    diagnosticCommandSummary,
    mailchimpExportDecision,
    mailchimpScheduleWindowRuntime,
  }, options);
  const effectiveStatus = mailchimpSourceAnchorHandoff.status === "blocked"
    ? "blocked"
    : mailchimpLaunchHandoff.status === "blocked"
    ? "blocked"
    : mailchimpScheduleWindowRuntime.status === "blocked"
    ? "blocked"
    : mailchimpCampaignExportQueue.status === "blocked"
    ? "blocked"
    : readiness.status === "ready" && mailchimpSourceAnchorHandoff.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpLaunchHandoff.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpCampaignExportQueue.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpScheduleWindowRuntime.status === "pending"
      ? "needsAcceptance"
      : readiness.status;
  const exportEvidence = createFormatterExportEvidence({
    readiness,
    acceptance,
    validationSummary,
    astExportEvidence,
    sourceExportManifest,
    diagnosticExportState,
    mailchimpHandoff,
    mailchimpTenantBoundary,
    persistedState,
    analyticsReport,
    sourceOperationalTimeline,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    mailchimpExportDecision,
    mailchimpSourceAnchorHandoff,
    mailchimpCampaignExportQueue,
    mailchimpScheduleWindowRuntime,
  });

  return Object.freeze({
    ok: readiness.status === "ready"
      && acceptance.acceptable
      && mailchimpSourceAnchorHandoff.exportAllowed
      && mailchimpLaunchHandoff.exportAllowed
      && mailchimpCampaignExportQueue.exportAllowed
      && mailchimpScheduleWindowRuntime.exportAllowed,
    fileName: plan.fileName,
    status: effectiveStatus,
    previewItems: Object.freeze(previewItems),
    validationSummary,
    readiness,
    acceptance,
    sourceProvider: providerContract,
    sourcePersistence,
    sourceReleasePacket,
    sourceBoundaryAudit,
    sourceOperationalTimeline,
    diagnosticClientState,
    diagnosticPersistedResumeState,
    diagnosticReleaseChecklist,
    mailchimpWorkflowPreview,
    mailchimpHandoff,
    mailchimpLaunchHandoff,
    mailchimpRuntimeTargets,
    mailchimpReleaseReadiness,
    mailchimpRuntimeResumePacket,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    mailchimpSourceAnchorHandoff,
    astExportBatchSummary,
    mailchimpCampaignExportQueue,
    mailchimpScheduleWindowRuntime,
    sourceProviderExportSummary,
    diagnosticCommandSummary,
    mailchimpExportDecision,
    persistedState,
    analyticsReport,
    exportEvidence,
    exportSummary: analyticsReport.exportSummary,
    nextStep: createFormatterNextStep(readiness, acceptance, validationSummary, mailchimpHandoff, {
      sourcePersistence,
      sourceOperationalTimeline,
      diagnosticClientState,
      mailchimpWorkflowPreview,
      analyticsReport,
      exportEvidence,
      mailchimpLaunchHandoff,
      mailchimpProviderIncidentContract,
      mailchimpExportDecision,
      mailchimpSourceAnchorHandoff,
      mailchimpScheduleWindowRuntime,
    }),
  });
}

function collectFormatterItems(node, state) {
  if (!node || typeof node !== "object") return;

  const rule = getFormatterRule(node);
  if (!rule) {
    state.diagnostics.push(createCatalogDiagnostic("AIOS_FORMAT_RULE", {
      message: `No formatter rule is registered for node kind "${node.type ?? "Unknown"}".`,
    }));
    return;
  }

  const rangeStatus = createRangeStatus(node.range ?? {
    fileName: state.fileName,
    start: { line: 1, column: Math.max(1, (node.start ?? 0) + 1), offset: node.start ?? 0 },
    end: { line: 1, column: Math.max(1, (node.end ?? node.start ?? 0) + 1), offset: node.end ?? node.start ?? 0 },
  }, { fileName: state.fileName });
  state.diagnostics.push(...rangeStatus.diagnostics);
  state.items.push(Object.freeze({
    nodeKind: rule.nodeKind,
    compileRole: getAstNodeKindContract(rule.nodeKind)?.compileRole ?? "unknown",
    order: rule.order,
    path: Object.freeze([...state.path, node.name ?? node.expression ?? node.strategy ?? rule.nodeKind]),
    range: rangeStatus.range,
    previewRange: compactSourceRange(rangeStatus.range),
    statusHandoff: rule.statusHandoff,
    preserves: rule.preserves,
  }));

  const contract = getAstNodeKindContract(node);
  for (const collection of contract?.childCollections ?? []) {
    for (const child of node[collection] ?? []) {
      collectFormatterItems(child, {
        ...state,
        path: [...state.path, node.name ?? node.type],
      });
    }
  }
  if (node.rollback) {
    collectFormatterItems(node.rollback, {
      ...state,
      path: [...state.path, node.name ?? node.type],
    });
  }
}

function comparePlanItems(left, right) {
  return left.path.join("/").localeCompare(right.path.join("/"))
    || left.order - right.order
    || left.nodeKind.localeCompare(right.nodeKind);
}

function formatterRule(rule) {
  return Object.freeze({
    ...rule,
    preserves: Object.freeze(rule.preserves),
  });
}

function createFormatterPreviewItem(item, index, options, mailchimpHandoff) {
  const id = `${item.nodeKind}:${index}`;
  const visibleLabel = item.path.filter(Boolean).join(" / ");
  const userAction = item.nodeKind === "Program"
    ? "review-source-layout"
    : item.nodeKind === "JobDeclaration"
      ? "review-job-block"
      : "review-declaration";
  const mailchimpJob = item.nodeKind === "JobDeclaration"
    ? findMailchimpHandoffJob(mailchimpHandoff, item.path.at(-1))
    : null;
  const mailchimpOperations = mailchimpJob
    ? mailchimpHandoff.operations.filter((operation) => operation.jobName === mailchimpJob.jobName)
    : [];

  return Object.freeze({
    id,
    index,
    nodeKind: item.nodeKind,
    label: visibleLabel || item.nodeKind,
    previewRange: item.previewRange,
    statusHandoff: item.statusHandoff,
    preserves: item.preserves,
    acceptanceState: options.acceptedPreviewIds?.includes(id) ? "accepted" : "pending",
    userVisible: Object.freeze({
      title: item.nodeKind.replace(/Declaration$/, ""),
      detail: `${item.compileRole} at ${item.previewRange}`,
      action: mailchimpJob?.nextAction ?? userAction,
      workflowStatus: mailchimpJob?.status ?? "unbound",
    }),
    workflowHandoff: mailchimpJob
      ? Object.freeze({
          providerId: mailchimpHandoff.providerId,
          status: mailchimpJob.status,
          enabled: mailchimpJob.enabled,
          scheduleMode: mailchimpJob.scheduleMode,
          audienceBound: mailchimpJob.audienceBound,
          operationIds: Object.freeze(mailchimpOperations.map((operation) => operation.id)),
          operationCount: mailchimpOperations.length,
          nextAction: mailchimpJob.nextAction,
        })
      : null,
  });
}

function createFormatterValidationSummary(validation, plan, providerContract, externalDiagnostics = []) {
  const diagnostics = [
    ...validation.diagnostics,
    ...plan.diagnostics,
    ...providerContract.diagnostics,
    ...externalDiagnostics,
  ];
  const byCode = {};
  const byStage = {};

  for (const diagnostic of diagnostics) {
    byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + 1;
    const stage = diagnostic.catalog?.stage ?? "unknown";
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }

  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnosticCount: diagnostics.length,
    byCode: freezeSortedRecord(byCode),
    byStage: freezeSortedRecord(byStage),
    ruleCount: validation.ruleCount,
    previewCount: plan.items.length,
    sourceProviderStatus: providerContract.status,
    externalDiagnosticCount: externalDiagnostics.length,
    diagnostics: Object.freeze(diagnostics),
  });
}

function createFormatterReadinessState(validationSummary, previewItems, options, mailchimpHandoff) {
  const pending = previewItems.filter((item) => item.acceptanceState !== "accepted");
  const requireAcceptance = options.requirePreviewAcceptance !== false;
  const workflowBlocked = mailchimpHandoff.detected && !mailchimpHandoff.exportAllowed;
  const tenantBoundaryStatus = mailchimpHandoff.syncMetadata?.tenantBoundaryStatus ?? "unbound";
  const tenantBoundaryBlocked = tenantBoundaryStatus === "blocked";
  const tenantBoundaryReview = tenantBoundaryStatus === "review";
  const status = !validationSummary.ok
    ? "blocked"
    : tenantBoundaryBlocked
      ? "blocked"
    : workflowBlocked
      ? "blocked"
    : tenantBoundaryReview
      ? "review"
    : requireAcceptance && pending.length
      ? "needsAcceptance"
      : "ready";

  return Object.freeze({
    status,
    exportAllowed: status === "ready",
    previewCount: previewItems.length,
    pendingAcceptanceCount: pending.length,
    acceptedCount: previewItems.length - pending.length,
    requireAcceptance,
    workflow: Object.freeze({
      providerId: mailchimpHandoff.providerId,
      detected: mailchimpHandoff.detected,
      status: mailchimpHandoff.status,
      exportAllowed: mailchimpHandoff.exportAllowed,
      tenantBoundaryStatus,
      tenantAuditEventCount: mailchimpHandoff.syncMetadata?.tenantAuditEventCount ?? 0,
      nextAction: mailchimpHandoff.nextAction,
    }),
    nextAction: status === "blocked"
      ? tenantBoundaryBlocked
        ? mailchimpHandoff.nextAction
        : workflowBlocked
        ? mailchimpHandoff.nextAction
        : "resolve-format-preview-diagnostics"
      : status === "review"
        ? mailchimpHandoff.nextAction
      : status === "needsAcceptance"
        ? "accept-format-preview"
        : "emit-formatted-source",
  });
}

function createFormatterAcceptanceContract(readiness, previewItems, options) {
  const acceptedIds = new Set(options.acceptedPreviewIds ?? []);
  const requiredIds = previewItems.map((item) => item.id);
  const acceptedMailchimpOperationIds = new Set(options.acceptedMailchimpOperationIds ?? []);
  const requiredMailchimpOperationIds = previewItems
    .flatMap((item) => item.workflowHandoff?.operationIds ?? []);
  const missingIds = readiness.requireAcceptance
    ? requiredIds.filter((id) => !acceptedIds.has(id))
    : [];
  const requireMailchimpOperationAcceptance = options.requireMailchimpOperationAcceptance === true;
  const missingMailchimpOperationIds = readiness.workflow.detected && requireMailchimpOperationAcceptance
    ? requiredMailchimpOperationIds.filter((id) => !acceptedMailchimpOperationIds.has(id))
    : [];

  return Object.freeze({
    acceptable: readiness.status !== "blocked" && missingIds.length === 0 && missingMailchimpOperationIds.length === 0,
    mode: readiness.requireAcceptance ? "explicit" : "implicit",
    acceptedIds: Object.freeze([...acceptedIds].sort()),
    requiredIds: Object.freeze(requiredIds),
    missingIds: Object.freeze(missingIds),
    mailchimpOperations: Object.freeze({
      acceptedIds: Object.freeze([...acceptedMailchimpOperationIds].sort()),
      requiredIds: Object.freeze(requiredMailchimpOperationIds.sort()),
      missingIds: Object.freeze(missingMailchimpOperationIds),
      requireAcceptance: requireMailchimpOperationAcceptance,
    }),
    acceptedAt: options.acceptedAt ?? null,
    nextAction: missingIds.length || missingMailchimpOperationIds.length
      ? "collect-preview-acceptance"
      : "record-preview-acceptance",
  });
}

function createFormatterMailchimpScheduleWindowRuntime(state, options = {}) {
  const acceptedWindowIds = new Set((Array.isArray(options.acceptedMailchimpScheduleWindowIds)
    ? options.acceptedMailchimpScheduleWindowIds
    : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
  const queueRowsByJobName = new Map((state.mailchimpCampaignExportQueue?.rows ?? [])
    .map((row) => [String(row.jobName), row]));
  const operationsByJobName = new Map();
  for (const operation of state.mailchimpHandoff?.operations ?? []) {
    const jobName = String(operation.jobName ?? "");
    if (!operationsByJobName.has(jobName)) operationsByJobName.set(jobName, []);
    operationsByJobName.get(jobName).push(operation);
  }
  const rows = (state.mailchimpWorkflowPreview?.preview?.jobs ?? [])
    .filter((job) => job.detected)
    .map((job) => createFormatterMailchimpScheduleWindowRow(job, {
      acceptedWindowIds,
      queueRow: queueRowsByJobName.get(String(job.jobName)) ?? null,
      operations: operationsByJobName.get(String(job.jobName)) ?? [],
      requireAcceptance: options.requireMailchimpScheduleWindowAcceptance !== false,
    }));
  const blocked = rows.filter((row) => row.status === "blocked");
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const ready = rows.filter((row) => row.status === "ready");
  const status = !state.mailchimpWorkflow?.detected && rows.length === 0
    ? "idle"
    : blocked.length
      ? "blocked"
      : pending.length
        ? "pending"
        : review.length
          ? "review"
          : "ready";

  return Object.freeze({
    version: "formatter-mailchimp-schedule-window-runtime.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    providerId: state.mailchimpHandoff?.providerId ?? "mailchimp",
    exportAllowed: status === "ready" || status === "idle",
    syncKey: [
      state.mailchimpHandoff?.syncMetadata?.serviceSyncKey ?? "mailchimp-service-unbound",
      state.mailchimpCampaignExportQueue?.exportSummary?.syncKey ?? "campaign-queue-unbound",
      rows.map((row) => `${row.id}:${row.status}:${row.accepted}`).join(",") || "no-schedule-windows",
    ].join("|"),
    windows: Object.freeze(rows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countFormatterItemsBy(rows, "status")),
      byMode: freezeSortedRecord(countFormatterItemsBy(rows, "mode")),
      byTimezone: freezeSortedRecord(countFormatterItemsBy(rows, "timezone")),
      byQueueStatus: freezeSortedRecord(countFormatterItemsBy(rows, "campaignQueueStatus")),
    }),
    totals: Object.freeze({
      windowCount: rows.length,
      readyWindowCount: ready.length,
      blockedWindowCount: blocked.length,
      pendingWindowCount: pending.length,
      reviewWindowCount: review.length,
      operationCount: rows.reduce((total, row) => total + row.operationCount, 0),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/schedule-window/recovery"
        : status === "pending"
          ? "mailchimp/schedule-window/acceptance"
          : status === "review"
            ? "mailchimp/schedule-window/review"
            : "mailchimp/schedule-window/summary",
      restartSafe: blocked.length === 0,
      blockedWindowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingWindowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewWindowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-schedule-window-runtime",
    }),
    userVisible: Object.freeze({
      title: "Mailchimp schedule windows",
      detail: status === "idle"
        ? "No Mailchimp schedule windows were detected."
        : `${rows.length} schedule windows prepared; ${blocked.length} blocked and ${pending.length} pending acceptance.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-schedule-window-runtime",
    }),
  });
}

function createFormatterMailchimpScheduleWindowRow(job, context) {
  const window = job.schedule?.window ?? {};
  const accepted = context.acceptedWindowIds.has(window.id);
  const requiresAcceptance = context.requireAcceptance && window.status !== "ready";
  const blocked = window.status === "blocked" || context.queueRow?.status === "blocked";
  const pending = !blocked && requiresAcceptance && !accepted;
  const review = !blocked && !pending && window.status === "review";
  const status = blocked ? "blocked" : pending ? "pending" : review ? "review" : "ready";
  const nextAction = blocked
    ? window.nextAction ?? "repair-mailchimp-send-window"
    : pending
      ? "accept-mailchimp-schedule-window"
      : review
        ? window.nextAction ?? "confirm-mailchimp-send-window"
        : "retain-mailchimp-schedule-window";

  return Object.freeze({
    id: window.id ?? `mailchimp-schedule-window:${job.jobName}`,
    jobName: job.jobName,
    status,
    accepted: accepted || !requiresAcceptance,
    mode: window.mode ?? "anytime",
    timezone: window.timezone ?? "UTC",
    start: window.start ?? null,
    end: window.end ?? null,
    scheduledAt: job.schedule?.scheduledAt ?? null,
    blackoutDates: window.blackoutDates ?? Object.freeze([]),
    campaignQueueStatus: context.queueRow?.status ?? "unbound",
    operationCount: context.operations.length,
    operationIds: Object.freeze(context.operations.map((operation) => operation.id).filter(Boolean).sort()),
    idempotencyKey: [
      job.jobName,
      window.id ?? "window-unbound",
      context.queueRow?.idempotencyKey ?? context.queueRow?.status ?? "queue-unbound",
    ].join(":"),
    restartSafe: !blocked,
    nextAction,
    userVisible: Object.freeze({
      label: `${job.jobName} schedule window`,
      detail: window.detail ?? "Mailchimp send window is ready.",
      nextAction,
    }),
  });
}

function createFormatterMailchimpExportDecision(state, options = {}) {
  const lanes = [
    formatterExportDecisionLane({
      id: "formatter-readiness",
      status: state.readiness.status,
      exportAllowed: state.readiness.exportAllowed,
      restartSafe: true,
      route: "formatter/readiness",
      count: state.readiness.previewCount,
      nextAction: state.readiness.nextAction,
      idempotencyKey: state.persistedState?.syncKey ?? null,
    }),
    formatterExportDecisionLane({
      id: "formatter-acceptance",
      status: state.acceptance.acceptable ? "ready" : "pending",
      exportAllowed: state.acceptance.acceptable,
      restartSafe: true,
      route: "formatter/acceptance",
      count: state.acceptance.missingIds.length + state.acceptance.mailchimpOperations.missingIds.length,
      nextAction: state.acceptance.nextAction,
      idempotencyKey: `${state.persistedState?.syncKey ?? "formatter"}:acceptance:${state.acceptance.acceptedAt ?? "pending"}`,
    }),
    formatterExportDecisionLane({
      id: "ast-export-batch",
      status: state.astExportBatchSummary.status,
      exportAllowed: state.astExportBatchSummary.exportAllowed,
      restartSafe: state.astExportBatchSummary.handoff.restartSafe,
      route: "ast/mailchimp-export-batch",
      count: state.astExportBatchSummary.totals.exportLaneCount,
      nextAction: state.astExportBatchSummary.handoff.nextAction,
      idempotencyKey: state.astExportBatchSummary.handoff.syncKey,
    }),
    formatterExportDecisionLane({
      id: "mailchimp-campaign-export-queue",
      status: state.mailchimpCampaignExportQueue.status,
      exportAllowed: state.mailchimpCampaignExportQueue.exportAllowed,
      restartSafe: state.mailchimpCampaignExportQueue.restartEnvelope.restartSafe,
      route: state.mailchimpCampaignExportQueue.restartEnvelope.route,
      count: state.mailchimpCampaignExportQueue.totals.queueCount,
      nextAction: state.mailchimpCampaignExportQueue.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpCampaignExportQueue.exportSummary.syncKey,
    }),
    formatterExportDecisionLane({
      id: "mailchimp-schedule-window",
      status: state.mailchimpScheduleWindowRuntime.status,
      exportAllowed: state.mailchimpScheduleWindowRuntime.exportAllowed,
      restartSafe: state.mailchimpScheduleWindowRuntime.restartEnvelope.restartSafe,
      route: state.mailchimpScheduleWindowRuntime.restartEnvelope.route,
      count: state.mailchimpScheduleWindowRuntime.totals.windowCount,
      nextAction: state.mailchimpScheduleWindowRuntime.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpScheduleWindowRuntime.syncKey,
    }),
    formatterExportDecisionLane({
      id: "source-provider-export",
      status: state.sourceProviderExportSummary.status,
      exportAllowed: state.sourceProviderExportSummary.exportAllowed,
      restartSafe: state.sourceProviderExportSummary.handoff.restartSafe,
      route: state.sourceProviderExportSummary.handoff.route,
      count: state.sourceProviderExportSummary.totals.anchorCount,
      nextAction: state.sourceProviderExportSummary.handoff.nextAction,
      idempotencyKey: state.sourceProviderExportSummary.syncKey,
    }),
    formatterExportDecisionLane({
      id: "mailchimp-source-anchor",
      status: state.mailchimpSourceAnchorHandoff.status,
      exportAllowed: state.mailchimpSourceAnchorHandoff.exportAllowed,
      restartSafe: state.mailchimpSourceAnchorHandoff.restartEnvelope.restartSafe,
      route: state.mailchimpSourceAnchorHandoff.restartEnvelope.route,
      count: state.mailchimpSourceAnchorHandoff.totals.operationCount,
      nextAction: state.mailchimpSourceAnchorHandoff.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpSourceAnchorHandoff.syncKey,
    }),
    formatterExportDecisionLane({
      id: "diagnostic-commands",
      status: state.diagnosticCommandSummary.status,
      exportAllowed: state.diagnosticCommandSummary.exportAllowed,
      restartSafe: state.diagnosticCommandSummary.status !== "blocked",
      route: "diagnostics/lifecycle-commands",
      count: state.diagnosticCommandSummary.totals.commandCount,
      nextAction: state.diagnosticCommandSummary.recovery.nextAction,
      idempotencyKey: state.diagnosticCommandSummary.exportState?.exportSummary?.route ?? null,
    }),
    formatterExportDecisionLane({
      id: "mailchimp-provider",
      status: state.mailchimpHandoff.status,
      exportAllowed: state.mailchimpHandoff.exportAllowed,
      restartSafe: state.mailchimpHandoff.commandContract?.restartSafe !== false
        && state.mailchimpHandoff.receiptContract?.restartSafe !== false,
      route: "mailchimp/provider-handoff",
      count: state.mailchimpHandoff.operations?.length ?? 0,
      nextAction: state.mailchimpHandoff.nextAction,
      idempotencyKey: state.mailchimpHandoff.syncMetadata?.serviceSyncKey ?? null,
    }),
    formatterExportDecisionLane({
      id: "mailchimp-tenant-boundary",
      status: state.mailchimpTenantBoundary.status,
      exportAllowed: state.mailchimpTenantBoundary.exportAllowed,
      restartSafe: state.mailchimpTenantBoundary.handoff?.restartSafe !== false,
      route: state.mailchimpTenantBoundary.handoff?.route ?? "mailchimp/tenant-boundary",
      count: state.mailchimpTenantBoundary.totals?.auditEventCount ?? 0,
      nextAction: state.mailchimpTenantBoundary.handoff?.nextAction ?? state.mailchimpTenantBoundary.recovery?.nextAction,
      idempotencyKey: state.mailchimpTenantBoundary.syncKey,
    }),
    formatterExportDecisionLane({
      id: "mailchimp-incidents",
      status: state.mailchimpProviderIncidentContract.status,
      exportAllowed: state.mailchimpProviderIncidentContract.exportAllowed,
      restartSafe: state.mailchimpProviderIncidentContract.restartEnvelope?.restartSafe !== false,
      route: state.mailchimpProviderIncidentContract.restartEnvelope?.route ?? "mailchimp/incidents",
      count: state.mailchimpProviderIncidentContract.totals?.incidentCount ?? 0,
      nextAction: state.mailchimpProviderIncidentContract.restartEnvelope?.nextAction
        ?? state.mailchimpProviderIncidentContract.recovery?.nextAction,
      idempotencyKey: state.mailchimpProviderIncidentContract.syncKey,
    }),
  ];
  const blocked = lanes.filter((lane) => lane.status === "blocked" || lane.exportAllowed === false || lane.restartSafe === false);
  const pending = lanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance");
  const review = lanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "formatter-mailchimp-export-decision.v1",
    status,
    ok: status === "ready",
    providerId: state.mailchimpHandoff.providerId,
    fileName: state.astExportBatchSummary.fileName ?? options.fileName ?? "inline.aios",
    revision: options.revision ?? "working",
    exportAllowed: status === "ready",
    restartSafe: blocked.length === 0 && lanes.every((lane) => lane.restartSafe),
    lanes: Object.freeze(lanes.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    counters: Object.freeze({
      laneByStatus: freezeSortedRecord(countFormatterItemsBy(lanes, "status")),
      laneByRoute: freezeSortedRecord(countFormatterItemsBy(lanes, "route")),
      astLaneByStatus: state.astExportBatchSummary.counters.exportLaneByStatus,
      campaignQueueByStatus: state.mailchimpCampaignExportQueue.counters.byStatus,
      scheduleWindowByStatus: state.mailchimpScheduleWindowRuntime.counters.byStatus,
      sourceAnchorByStatus: state.sourceProviderExportSummary.counters.anchorByStatus,
      mailchimpSourceAnchorByStatus: state.mailchimpSourceAnchorHandoff.counters.byStatus,
      diagnosticCommandByStatus: state.diagnosticCommandSummary.counters.commandByStatus,
      sourceTimelineByStatus: state.sourceOperationalTimeline?.counters?.byStatus ?? {},
      incidentByStatus: state.mailchimpDiagnosticIncidentReport?.counters?.byStatus ?? {},
    }),
    totals: Object.freeze({
      laneCount: lanes.length,
      blockedLaneCount: blocked.length,
      pendingLaneCount: pending.length,
      reviewLaneCount: review.length,
      astHistorySnapshotCount: state.astExportBatchSummary.totals.historySnapshotCount,
      mailchimpCampaignQueueCount: state.mailchimpCampaignExportQueue.totals.queueCount,
      mailchimpCampaignQueuePendingCount: state.mailchimpCampaignExportQueue.totals.pendingCount,
      mailchimpScheduleWindowCount: state.mailchimpScheduleWindowRuntime.totals.windowCount,
      sourceAnchorCount: state.sourceProviderExportSummary.totals.anchorCount,
      diagnosticCommandCount: state.diagnosticCommandSummary.totals.commandCount,
      mailchimpOperationCount: state.mailchimpHandoff.operations?.length ?? 0,
    }),
    acceptance: Object.freeze({
      formatterMissingIds: state.acceptance.missingIds,
      mailchimpOperationMissingIds: state.acceptance.mailchimpOperations.missingIds,
      sourcePendingAnchorIds: state.sourceProviderExportSummary.recovery.pendingAnchorIds,
      mailchimpPendingSourceAnchorIds: state.mailchimpSourceAnchorHandoff.acceptance.pendingAnchorIds,
      diagnosticPendingCommandIds: state.diagnosticCommandSummary.recovery.pendingCommandIds,
      mailchimpCampaignPendingJobNames: state.mailchimpCampaignExportQueue.restartEnvelope.pendingJobNames,
      mailchimpPendingScheduleWindowIds: state.mailchimpScheduleWindowRuntime.restartEnvelope.pendingWindowIds,
      acceptable: status !== "blocked" && pending.length === 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "formatter/mailchimp-export/recovery"
        : status === "pending"
          ? "formatter/mailchimp-export/acceptance"
          : status === "review"
            ? "formatter/mailchimp-export/review"
            : "formatter/mailchimp-export/publish",
      restartSafe: blocked.length === 0 && lanes.every((lane) => lane.restartSafe),
      blockedLaneIds: Object.freeze(blocked.map((lane) => lane.id).sort()),
      pendingLaneIds: Object.freeze(pending.map((lane) => lane.id).sort()),
      reviewLaneIds: Object.freeze(review.map((lane) => lane.id).sort()),
      idempotencyKeys: Object.freeze(lanes
        .map((lane) => lane.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-formatter-mailchimp-export",
    }),
    userVisible: Object.freeze({
      title: "Mailchimp export decision",
      detail: status === "ready"
        ? "Formatter preview, AST evidence, diagnostics, source ranges, and Mailchimp provider handoff are ready to export."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review lanes remain before Mailchimp export.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-formatter-mailchimp-export",
    }),
  });
}

function formatterExportDecisionLane(lane) {
  return Object.freeze({
    id: lane.id,
    status: lane.status ?? "unknown",
    exportAllowed: lane.exportAllowed !== false,
    restartSafe: lane.restartSafe !== false,
    route: lane.route,
    count: Number.isFinite(Number(lane.count)) ? Math.max(0, Math.trunc(Number(lane.count))) : 0,
    nextAction: lane.nextAction ?? "review-formatter-mailchimp-export",
    idempotencyKey: lane.idempotencyKey ?? null,
  });
}

function createFormatterNextStep(readiness, acceptance, validationSummary, mailchimpHandoff, contracts = {}) {
  if (contracts.mailchimpExportDecision?.status === "blocked") {
    return Object.freeze({
      id: "mailchimp-export-decision",
      label: "Repair Mailchimp export decision",
      status: "blocked",
      detail: `${contracts.mailchimpExportDecision.totals.blockedLaneCount} export lanes block Mailchimp handoff.`,
      handoff: contracts.mailchimpExportDecision.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpExportDecision?.status === "pending") {
    return Object.freeze({
      id: "accept-mailchimp-export-decision",
      label: "Accept Mailchimp export decision",
      status: "pending",
      detail: `${contracts.mailchimpExportDecision.totals.pendingLaneCount} export lanes need acceptance before Mailchimp handoff.`,
      handoff: contracts.mailchimpExportDecision.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpProviderIncidentContract?.status === "blocked") {
    return Object.freeze({
      id: "mailchimp-provider-incidents",
      label: "Repair Mailchimp provider incidents",
      status: "blocked",
      detail: `${contracts.mailchimpProviderIncidentContract.totals.blockedIncidentCount} provider incidents block formatter export.`,
      handoff: contracts.mailchimpProviderIncidentContract.recovery.nextAction,
    });
  }
  if (contracts.mailchimpProviderIncidentContract?.status === "pending") {
    return Object.freeze({
      id: "resume-mailchimp-provider-incidents",
      label: "Resume Mailchimp provider incidents",
      status: "pending",
      detail: `${contracts.mailchimpProviderIncidentContract.totals.pendingIncidentCount} provider incidents need runtime action.`,
      handoff: contracts.mailchimpProviderIncidentContract.recovery.nextAction,
    });
  }
  if (contracts.mailchimpSourceAnchorHandoff?.status === "blocked") {
    return Object.freeze({
      id: "mailchimp-source-anchors",
      label: "Repair Mailchimp source anchors",
      status: "blocked",
      detail: `${contracts.mailchimpSourceAnchorHandoff.totals.blockedOperationCount} Mailchimp operations are missing accepted source anchors.`,
      handoff: contracts.mailchimpSourceAnchorHandoff.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpSourceAnchorHandoff?.status === "pending") {
    return Object.freeze({
      id: "accept-mailchimp-source-anchors",
      label: "Accept Mailchimp source anchors",
      status: "pending",
      detail: `${contracts.mailchimpSourceAnchorHandoff.totals.pendingOperationCount} Mailchimp operations need source anchor acceptance.`,
      handoff: contracts.mailchimpSourceAnchorHandoff.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpLaunchHandoff?.status === "blocked") {
    return Object.freeze({
      id: "mailchimp-launch-gate",
      label: "Repair Mailchimp launch gates",
      status: "blocked",
      detail: `${contracts.mailchimpLaunchHandoff.validationSummary.blockedGateCount} launch gates block campaign handoff.`,
      handoff: contracts.mailchimpLaunchHandoff.nextAction,
    });
  }
  if (contracts.mailchimpLaunchHandoff?.status === "pending") {
    return Object.freeze({
      id: "accept-mailchimp-launch-gates",
      label: "Accept Mailchimp launch gates",
      status: "pending",
      detail: `${contracts.mailchimpLaunchHandoff.acceptance.pendingGateIds.length} launch gate source previews need acceptance.`,
      handoff: contracts.mailchimpLaunchHandoff.nextAction,
    });
  }
  if (readiness.workflow.tenantBoundaryStatus === "blocked" || readiness.workflow.tenantBoundaryStatus === "review") {
    return Object.freeze({
      id: "mailchimp-tenant-permission-boundary",
      label: "Repair Mailchimp tenant boundary",
      status: readiness.workflow.tenantBoundaryStatus,
      detail: `${readiness.workflow.tenantAuditEventCount} tenant boundary audit events require handoff before formatter export.`,
      handoff: mailchimpHandoff.nextAction,
    });
  }
  if (mailchimpHandoff.detected && !mailchimpHandoff.exportAllowed) {
    return Object.freeze({
      id: "mailchimp-workflow-handoff",
      label: "Repair Mailchimp workflow handoff",
      status: "blocked",
      detail: `${mailchimpHandoff.diagnosticCount} Mailchimp workflow diagnostics prevent formatter export.`,
      handoff: mailchimpHandoff.nextAction,
    });
  }
  if (contracts.mailchimpWorkflowPreview?.status === "needsAcceptance") {
    return Object.freeze({
      id: "accept-mailchimp-workflow-preview",
      label: "Accept Mailchimp workflow preview",
      status: "needsAcceptance",
      detail: `${contracts.mailchimpWorkflowPreview.acceptance.pendingJobNames.length} Mailchimp workflow jobs need acceptance.`,
      handoff: contracts.mailchimpWorkflowPreview.readiness.nextAction,
    });
  }
  if (contracts.sourcePersistence?.status === "blocked") {
    return Object.freeze({
      id: "repair-source-range-persistence",
      label: "Repair source range persistence",
      status: "blocked",
      detail: `${contracts.sourcePersistence.recovery.blockedAnchorIds.length} source anchors cannot be restored.`,
      handoff: contracts.sourcePersistence.recovery.nextAction,
    });
  }
  if (contracts.diagnosticClientState?.status === "pending") {
    return Object.freeze({
      id: "complete-diagnostic-runtime-actions",
      label: "Complete diagnostic runtime actions",
      status: "pending",
      detail: `${contracts.diagnosticClientState.validationSummary.pendingActionCount} runtime actions are pending.`,
      handoff: contracts.diagnosticClientState.handoff.nextAction,
    });
  }
  if (validationSummary.diagnosticCount > 0) {
    return Object.freeze({
      id: "resolve-diagnostics",
      label: "Resolve formatter diagnostics",
      status: "blocked",
      detail: `${validationSummary.diagnosticCount} diagnostics prevent formatter export.`,
    });
  }
  if (!acceptance.acceptable) {
    return Object.freeze({
      id: "accept-preview",
      label: "Accept formatter preview",
      status: readiness.status,
      detail: `${acceptance.missingIds.length} preview items still need acceptance.`,
    });
  }
  return Object.freeze({
    id: "export-formatted-source",
    label: "Export formatted source",
    status: "ready",
    detail: "Formatter preview is accepted and ready for export.",
  });
}

function createFormatterMailchimpReleaseReadinessPacket(state, options = {}) {
  const lanes = [
    formatterReleaseLane({
      id: "formatter-preview",
      label: "Formatter preview",
      status: state.readiness.status,
      exportAllowed: state.readiness.exportAllowed,
      restartSafe: state.persistedState.restartSafe,
      count: state.readiness.previewCount,
      route: "formatter/preview",
      nextAction: state.readiness.nextAction,
      idempotencyKey: state.persistedState.syncKey,
    }),
    formatterReleaseLane({
      id: "formatter-acceptance",
      label: "Formatter acceptance",
      status: state.acceptance.acceptable ? "ready" : "pending",
      exportAllowed: state.acceptance.acceptable,
      restartSafe: true,
      count: state.acceptance.missingIds.length + state.acceptance.mailchimpOperations.missingIds.length,
      route: "formatter/acceptance",
      nextAction: state.acceptance.nextAction,
      idempotencyKey: `${state.persistedState.syncKey}:acceptance:${state.acceptance.acceptedAt ?? "pending"}`,
    }),
    formatterReleaseLane({
      id: "source-ranges",
      label: "Source ranges",
      status: state.sourceReleasePacket.status,
      exportAllowed: state.sourceReleasePacket.exportAllowed,
      restartSafe: state.sourceReleasePacket.restartSafe,
      count: state.sourceReleasePacket.anchors.length,
      route: state.sourceReleasePacket.restartEnvelope.route,
      nextAction: state.sourceReleasePacket.restartEnvelope.nextAction,
      idempotencyKey: state.sourceReleasePacket.syncKey,
    }),
    formatterReleaseLane({
      id: "source-boundary",
      label: "Source boundary",
      status: state.sourceBoundaryAudit.status,
      exportAllowed: state.sourceBoundaryAudit.exportAllowed,
      restartSafe: state.sourceBoundaryAudit.restartEnvelope.restartSafe,
      count: state.sourceBoundaryAudit.auditEvents.length,
      route: state.sourceBoundaryAudit.restartEnvelope.route,
      nextAction: state.sourceBoundaryAudit.restartEnvelope.nextAction,
      idempotencyKey: state.sourceBoundaryAudit.syncKey,
    }),
    formatterReleaseLane({
      id: "source-operations",
      label: "Source operations",
      status: state.sourceOperationalTimeline.status,
      exportAllowed: state.sourceOperationalTimeline.exportAllowed,
      restartSafe: state.sourceOperationalTimeline.restartEnvelope.restartSafe,
      count: state.sourceOperationalTimeline.totals.eventCount,
      route: state.sourceOperationalTimeline.restartEnvelope.route,
      nextAction: state.sourceOperationalTimeline.restartEnvelope.nextAction,
      idempotencyKey: state.sourceOperationalTimeline.restartEnvelope.idempotencyKeys.join("|") || null,
    }),
    formatterReleaseLane({
      id: "mailchimp-source-anchor",
      label: "Mailchimp source anchors",
      status: state.mailchimpSourceAnchorHandoff.status,
      exportAllowed: state.mailchimpSourceAnchorHandoff.exportAllowed,
      restartSafe: state.mailchimpSourceAnchorHandoff.restartEnvelope.restartSafe,
      count: state.mailchimpSourceAnchorHandoff.totals.operationCount,
      route: state.mailchimpSourceAnchorHandoff.restartEnvelope.route,
      nextAction: state.mailchimpSourceAnchorHandoff.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpSourceAnchorHandoff.syncKey,
    }),
    formatterReleaseLane({
      id: "diagnostics",
      label: "Diagnostics",
      status: state.diagnosticReleaseChecklist.status,
      exportAllowed: state.diagnosticReleaseChecklist.exportAllowed,
      restartSafe: state.diagnosticReleaseChecklist.restartEnvelope.restartSafe,
      count: state.diagnosticReleaseChecklist.totals.checklistCount,
      route: state.diagnosticReleaseChecklist.route.clientRoute,
      nextAction: state.diagnosticReleaseChecklist.route.nextAction,
      idempotencyKey: state.diagnosticReleaseChecklist.restartEnvelope.idempotencyKeys.join("|") || null,
    }),
    formatterReleaseLane({
      id: "diagnostic-resume",
      label: "Diagnostic resume",
      status: state.diagnosticPersistedResumeState.status,
      exportAllowed: state.diagnosticPersistedResumeState.exportAllowed,
      restartSafe: state.diagnosticPersistedResumeState.restartEnvelope.restartSafe,
      count: state.diagnosticPersistedResumeState.persistedActions.length,
      route: state.diagnosticPersistedResumeState.restartEnvelope.route,
      nextAction: state.diagnosticPersistedResumeState.restartEnvelope.nextAction,
      idempotencyKey: state.diagnosticPersistedResumeState.syncKey,
    }),
    formatterReleaseLane({
      id: "mailchimp-provider-incidents",
      label: "Mailchimp provider incidents",
      status: state.mailchimpProviderIncidentContract.status,
      exportAllowed: state.mailchimpProviderIncidentContract.exportAllowed,
      restartSafe: state.mailchimpProviderIncidentContract.restartEnvelope.restartSafe,
      count: state.mailchimpProviderIncidentContract.totals.incidentCount,
      route: state.mailchimpProviderIncidentContract.restartEnvelope.route,
      nextAction: state.mailchimpProviderIncidentContract.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpProviderIncidentContract.syncKey,
    }),
    formatterReleaseLane({
      id: "mailchimp-workflow",
      label: "Mailchimp workflow",
      status: state.mailchimpWorkflowPreview.status,
      exportAllowed: state.mailchimpWorkflowPreview.readiness.exportAllowed,
      restartSafe: state.mailchimpHandoff.commandContract.restartSafe,
      count: state.mailchimpHandoff.operations.length,
      route: "mailchimp/workflow",
      nextAction: state.mailchimpWorkflowPreview.readiness.nextAction,
      idempotencyKey: state.mailchimpHandoff.syncMetadata.serviceSyncKey,
    }),
    formatterReleaseLane({
      id: "mailchimp-schedule-window",
      label: "Mailchimp schedule window",
      status: state.mailchimpScheduleWindowRuntime.status,
      exportAllowed: state.mailchimpScheduleWindowRuntime.exportAllowed,
      restartSafe: state.mailchimpScheduleWindowRuntime.restartEnvelope.restartSafe,
      count: state.mailchimpScheduleWindowRuntime.totals.windowCount,
      route: state.mailchimpScheduleWindowRuntime.restartEnvelope.route,
      nextAction: state.mailchimpScheduleWindowRuntime.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpScheduleWindowRuntime.syncKey,
    }),
    formatterReleaseLane({
      id: "mailchimp-tenant-boundary",
      label: "Mailchimp tenant boundary",
      status: state.mailchimpTenantBoundary.status,
      exportAllowed: state.mailchimpTenantBoundary.exportAllowed,
      restartSafe: state.mailchimpTenantBoundary.handoff.restartSafe,
      count: state.mailchimpTenantBoundary.totals.auditEventCount,
      route: state.mailchimpTenantBoundary.handoff.route,
      nextAction: state.mailchimpTenantBoundary.handoff.nextAction,
      idempotencyKey: state.mailchimpTenantBoundary.syncKey,
    }),
    formatterReleaseLane({
      id: "mailchimp-runtime",
      label: "Mailchimp runtime",
      status: state.mailchimpRuntimeTargets.status,
      exportAllowed: state.mailchimpRuntimeTargets.exportAllowed,
      restartSafe: state.mailchimpRuntimeTargets.restartEnvelope.restartSafe,
      count: state.mailchimpRuntimeTargets.targets.length,
      route: state.mailchimpRuntimeTargets.restartEnvelope.route,
      nextAction: state.mailchimpRuntimeTargets.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpRuntimeTargets.syncKey,
    }),
    formatterReleaseLane({
      id: "mailchimp-provider",
      label: "Mailchimp provider",
      status: state.mailchimpHandoff.status,
      exportAllowed: state.mailchimpHandoff.exportAllowed,
      restartSafe: state.mailchimpHandoff.commandContract.restartSafe
        && state.mailchimpHandoff.receiptContract?.restartSafe !== false,
      count: state.mailchimpHandoff.operations.length,
      route: "mailchimp/provider-handoff",
      nextAction: state.mailchimpHandoff.nextAction,
      idempotencyKey: state.mailchimpHandoff.syncMetadata.serviceSyncKey,
    }),
    formatterReleaseLane({
      id: "mailchimp-launch",
      label: "Mailchimp launch",
      status: state.mailchimpLaunchHandoff.status,
      exportAllowed: state.mailchimpLaunchHandoff.exportAllowed,
      restartSafe: state.mailchimpLaunchHandoff.runtime.restartSafe,
      count: state.mailchimpLaunchHandoff.validationSummary.gateCount,
      route: state.mailchimpLaunchHandoff.runtime.route,
      nextAction: state.mailchimpLaunchHandoff.nextAction,
      idempotencyKey: state.mailchimpLaunchHandoff.syncKey,
    }),
    formatterReleaseLane({
      id: "ast-evidence",
      label: "AST evidence",
      status: state.astExportEvidence.status,
      exportAllowed: state.astExportEvidence.exportSummary.exportAllowed,
      restartSafe: true,
      count: state.astExportEvidence.totals.astExportableCount,
      route: "ast/export-evidence",
      nextAction: state.astExportEvidence.exportSummary.nextAction,
      idempotencyKey: state.astExportEvidence.exportSummary.syncKey,
    }),
  ];
  const blocked = lanes.filter((lane) => lane.status === "blocked" || lane.exportAllowed === false || lane.restartSafe === false);
  const pending = lanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance");
  const review = lanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "formatter-mailchimp-release-readiness.v1",
    status,
    ok: status === "ready",
    providerId: state.mailchimpHandoff.providerId,
    fileName: state.sourceReleasePacket.fileName,
    revision: options.revision ?? "working",
    exportAllowed: status === "ready",
    restartSafe: blocked.length === 0 && lanes.every((lane) => lane.restartSafe),
    lanes: Object.freeze(lanes.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    counters: Object.freeze({
      laneByStatus: freezeSortedRecord(countFormatterItemsBy(lanes, "status")),
      laneByRoute: freezeSortedRecord(countFormatterItemsBy(lanes, "route")),
      sourceAnchorByStatus: state.sourceReleasePacket.counters.anchorByStatus,
      mailchimpSourceAnchorByStatus: state.mailchimpSourceAnchorHandoff.counters.byStatus,
      sourceOperationalByStatus: state.sourceOperationalTimeline.counters.byStatus,
      diagnosticChecklistByStatus: state.diagnosticReleaseChecklist.counters.byStatus,
      mailchimpLaunchByStatus: state.mailchimpLaunchHandoff.validationSummary,
    }),
    acceptance: Object.freeze({
      formatterMissingIds: state.acceptance.missingIds,
      sourcePendingAnchorIds: state.sourceReleasePacket.acceptance.pendingAnchorIds,
      mailchimpPendingSourceAnchorIds: state.mailchimpSourceAnchorHandoff.acceptance.pendingAnchorIds,
      diagnosticPendingItemIds: state.diagnosticReleaseChecklist.restartEnvelope.pendingItemIds,
      mailchimpPendingGateIds: state.mailchimpLaunchHandoff.acceptance.pendingGateIds,
      mailchimpPendingScheduleWindowIds: state.mailchimpScheduleWindowRuntime.restartEnvelope.pendingWindowIds,
      acceptable: status !== "blocked" && pending.length === 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/release/recovery"
        : status === "pending"
          ? "mailchimp/release/acceptance"
          : status === "review"
            ? "mailchimp/release/review"
            : "mailchimp/release/export",
      restartSafe: blocked.length === 0 && lanes.every((lane) => lane.restartSafe),
      blockedLaneIds: Object.freeze(blocked.map((lane) => lane.id).sort()),
      pendingLaneIds: Object.freeze(pending.map((lane) => lane.id).sort()),
      reviewLaneIds: Object.freeze(review.map((lane) => lane.id).sort()),
      idempotencyKeys: Object.freeze(lanes
        .map((lane) => lane.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-release-readiness",
    }),
    userVisible: Object.freeze({
      title: state.mailchimpHandoff.detected ? "Mailchimp release readiness" : "Formatter release readiness",
      detail: status === "ready"
        ? "Formatter, diagnostics, source anchors, and Mailchimp handoff are ready for export."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review lanes remain before export.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-release-readiness",
    }),
  });
}

function createFormatterMailchimpRuntimeResumePacket(state) {
  const lanes = [
    runtimeResumeLane({
      id: "release-readiness",
      status: state.mailchimpReleaseReadiness.status,
      route: state.mailchimpReleaseReadiness.restartEnvelope.route,
      restartSafe: state.mailchimpReleaseReadiness.restartEnvelope.restartSafe,
      nextAction: state.mailchimpReleaseReadiness.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpReleaseReadiness.restartEnvelope.idempotencyKeys.join("|") || null,
      count: state.mailchimpReleaseReadiness.lanes.length,
    }),
    runtimeResumeLane({
      id: "mailchimp-runtime-targets",
      status: state.mailchimpRuntimeTargets.status,
      route: state.mailchimpRuntimeTargets.restartEnvelope.route,
      restartSafe: state.mailchimpRuntimeTargets.restartEnvelope.restartSafe,
      nextAction: state.mailchimpRuntimeTargets.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpRuntimeTargets.syncKey,
      count: state.mailchimpRuntimeTargets.targets.length,
    }),
    runtimeResumeLane({
      id: "source-boundary",
      status: state.sourceBoundaryAudit.status,
      route: state.sourceBoundaryAudit.restartEnvelope.route,
      restartSafe: state.sourceBoundaryAudit.restartEnvelope.restartSafe,
      nextAction: state.sourceBoundaryAudit.restartEnvelope.nextAction,
      idempotencyKey: state.sourceBoundaryAudit.syncKey,
      count: state.sourceBoundaryAudit.auditEvents.length,
    }),
    runtimeResumeLane({
      id: "source-operations",
      status: state.sourceOperationalTimeline.status,
      route: state.sourceOperationalTimeline.restartEnvelope.route,
      restartSafe: state.sourceOperationalTimeline.restartEnvelope.restartSafe,
      nextAction: state.sourceOperationalTimeline.restartEnvelope.nextAction,
      idempotencyKey: state.sourceOperationalTimeline.restartEnvelope.idempotencyKeys.join("|") || null,
      count: state.sourceOperationalTimeline.totals.eventCount,
    }),
    runtimeResumeLane({
      id: "diagnostics",
      status: state.diagnosticPersistedResumeState.status,
      route: state.diagnosticPersistedResumeState.restartEnvelope.route,
      restartSafe: state.diagnosticPersistedResumeState.restartEnvelope.restartSafe,
      nextAction: state.diagnosticPersistedResumeState.restartEnvelope.nextAction,
      idempotencyKey: state.diagnosticPersistedResumeState.syncKey,
      count: state.diagnosticPersistedResumeState.persistedActions.length,
    }),
    runtimeResumeLane({
      id: "source-release",
      status: state.sourceReleasePacket.status,
      route: state.sourceReleasePacket.restartEnvelope.route,
      restartSafe: state.sourceReleasePacket.restartEnvelope.restartSafe,
      nextAction: state.sourceReleasePacket.restartEnvelope.nextAction,
      idempotencyKey: state.sourceReleasePacket.syncKey,
      count: state.sourceReleasePacket.anchors.length,
    }),
    runtimeResumeLane({
      id: "mailchimp-source-anchor",
      status: state.mailchimpSourceAnchorHandoff.status,
      route: state.mailchimpSourceAnchorHandoff.restartEnvelope.route,
      restartSafe: state.mailchimpSourceAnchorHandoff.restartEnvelope.restartSafe,
      nextAction: state.mailchimpSourceAnchorHandoff.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpSourceAnchorHandoff.syncKey,
      count: state.mailchimpSourceAnchorHandoff.totals.operationCount,
    }),
    runtimeResumeLane({
      id: "mailchimp-launch",
      status: state.mailchimpLaunchHandoff.status,
      route: state.mailchimpLaunchHandoff.runtime.route,
      restartSafe: state.mailchimpLaunchHandoff.runtime.restartSafe,
      nextAction: state.mailchimpLaunchHandoff.nextAction,
      idempotencyKey: state.mailchimpLaunchHandoff.syncKey,
      count: state.mailchimpLaunchHandoff.validationSummary.gateCount,
    }),
    runtimeResumeLane({
      id: "mailchimp-schedule-window",
      status: state.mailchimpScheduleWindowRuntime.status,
      route: state.mailchimpScheduleWindowRuntime.restartEnvelope.route,
      restartSafe: state.mailchimpScheduleWindowRuntime.restartEnvelope.restartSafe,
      nextAction: state.mailchimpScheduleWindowRuntime.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpScheduleWindowRuntime.syncKey,
      count: state.mailchimpScheduleWindowRuntime.totals.windowCount,
    }),
    runtimeResumeLane({
      id: "mailchimp-provider",
      status: state.mailchimpHandoff.status,
      route: "mailchimp/provider-handoff",
      restartSafe: state.mailchimpHandoff.commandContract.restartSafe
        && state.mailchimpHandoff.receiptContract?.restartSafe !== false,
      nextAction: state.mailchimpHandoff.nextAction,
      idempotencyKey: state.mailchimpHandoff.syncMetadata.serviceSyncKey,
      count: state.mailchimpHandoff.operations.length,
    }),
    runtimeResumeLane({
      id: "mailchimp-provider-incidents",
      status: state.mailchimpProviderIncidentContract.status,
      route: state.mailchimpProviderIncidentContract.restartEnvelope.route,
      restartSafe: state.mailchimpProviderIncidentContract.restartEnvelope.restartSafe,
      nextAction: state.mailchimpProviderIncidentContract.restartEnvelope.nextAction,
      idempotencyKey: state.mailchimpProviderIncidentContract.syncKey,
      count: state.mailchimpProviderIncidentContract.totals.incidentCount,
    }),
    runtimeResumeLane({
      id: "mailchimp-tenant-boundary",
      status: state.mailchimpTenantBoundary.status,
      route: state.mailchimpTenantBoundary.handoff.route,
      restartSafe: state.mailchimpTenantBoundary.handoff.restartSafe,
      nextAction: state.mailchimpTenantBoundary.handoff.nextAction,
      idempotencyKey: state.mailchimpTenantBoundary.syncKey,
      count: state.mailchimpTenantBoundary.totals.auditEventCount,
    }),
  ];
  const blocked = lanes.filter((lane) => lane.status === "blocked" || lane.restartSafe === false);
  const pending = lanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance");
  const review = lanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "formatter-mailchimp-runtime-resume.v1",
    status,
    ok: status === "ready",
    exportAllowed: status === "ready",
    restartSafe: blocked.length === 0 && lanes.every((lane) => lane.restartSafe),
    syncKey: lanes
      .map((lane) => lane.idempotencyKey)
      .filter(Boolean)
      .join("|"),
    lanes: Object.freeze(lanes.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countFormatterItemsBy(lanes, "status")),
      byRoute: freezeSortedRecord(countFormatterItemsBy(lanes, "route")),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "formatter/mailchimp-runtime/recovery"
        : status === "pending"
          ? "formatter/mailchimp-runtime/acceptance"
          : status === "review"
            ? "formatter/mailchimp-runtime/review"
            : "formatter/mailchimp-runtime/export",
      restartSafe: blocked.length === 0 && lanes.every((lane) => lane.restartSafe),
      blockedLaneIds: Object.freeze(blocked.map((lane) => lane.id).sort()),
      pendingLaneIds: Object.freeze(pending.map((lane) => lane.id).sort()),
      reviewLaneIds: Object.freeze(review.map((lane) => lane.id).sort()),
      idempotencyKeys: Object.freeze(lanes
        .map((lane) => lane.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-formatter-mailchimp-runtime-resume",
    }),
  });
}

function runtimeResumeLane(lane) {
  return Object.freeze({
    id: lane.id,
    status: lane.status,
    route: lane.route,
    restartSafe: lane.restartSafe !== false,
    nextAction: lane.nextAction,
    idempotencyKey: lane.idempotencyKey ?? null,
    count: lane.count ?? 0,
  });
}

function createFormatterMailchimpProviderIncidentContract(state, options = {}) {
  const report = state.incidentReport;
  const providerIncidents = (report?.incidents ?? [])
    .filter((incident) => incident.providerId === (state.mailchimpHandoff?.providerId ?? "mailchimp")
      || incident.origin === "mailchimpProvider"
      || incident.handoff?.startsWith("mailchimp"));
  const blocked = providerIncidents.filter((incident) => incident.status === "blocked" || incident.restartSafe === false);
  const pending = providerIncidents.filter((incident) => incident.status === "pending" || incident.status === "review");
  const retryable = providerIncidents.filter((incident) => (
    incident.handoff === "mailchimp-operational-health"
    || incident.handoff === "mailchimp-provider-receipt"
  ) && incident.status !== "blocked");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : state.mailchimpHandoff?.status === "review" || state.mailchimpHandoff?.status === "degraded"
        ? "review"
        : providerIncidents.length
          ? "ready"
          : "idle";
  const syncKey = [
    report?.fileName ?? options.fileName ?? "inline.aios",
    report?.revision ?? options.revision ?? "working",
    report?.recovery?.idempotencyKeys?.join(",") ?? "no-incidents",
    state.mailchimpHandoff?.syncMetadata?.serviceSyncKey ?? "mailchimp-service-unbound",
  ].join("|");

  return Object.freeze({
    version: "formatter-mailchimp-provider-incident-contract.v1",
    status,
    ok: status === "ready" || status === "idle",
    providerId: state.mailchimpHandoff?.providerId ?? "mailchimp",
    fileName: report?.fileName ?? options.fileName ?? "inline.aios",
    revision: report?.revision ?? options.revision ?? "working",
    exportAllowed: status === "ready" || status === "idle",
    restartSafe: blocked.length === 0 && report?.restartSafe !== false,
    syncKey,
    incidents: Object.freeze(providerIncidents.map((incident) => Object.freeze({
      id: incident.id,
      origin: incident.origin,
      kind: incident.kind,
      status: incident.status,
      severity: incident.severity,
      label: incident.label,
      handoff: incident.handoff,
      restartSafe: incident.restartSafe,
      idempotencyKey: incident.idempotencyKey,
      nextAction: incident.nextAction,
      jobName: incident.jobName,
    }))),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countFormatterItemsBy(providerIncidents, "status")),
      byKind: freezeSortedRecord(countFormatterItemsBy(providerIncidents, "kind")),
      byHandoff: freezeSortedRecord(countFormatterItemsBy(providerIncidents, "handoff")),
      providerCommandByStatus: state.mailchimpHandoff?.commandContract?.summary?.byStatus ?? {},
      providerReceiptByStatus: state.mailchimpHandoff?.receiptContract?.counters ?? {},
    }),
    totals: Object.freeze({
      incidentCount: providerIncidents.length,
      blockedIncidentCount: blocked.length,
      pendingIncidentCount: pending.length,
      retryableIncidentCount: retryable.length,
      providerOperationCount: state.mailchimpHandoff?.operations?.length ?? 0,
      sourceAnchorBlockedOperationCount: state.sourceAnchorHandoff?.totals?.blockedOperationCount ?? 0,
      sourceAnchorPendingOperationCount: state.sourceAnchorHandoff?.totals?.pendingOperationCount ?? 0,
      sourceOperationalActionableCount: state.sourceOperationalTimeline?.totals?.actionableEventCount ?? 0,
      persistedCommandCount: state.persistedState?.commandLedger?.length ?? 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "formatter/mailchimp-provider-incidents/recovery"
        : status === "pending"
          ? "formatter/mailchimp-provider-incidents/resume"
          : status === "review"
            ? "formatter/mailchimp-provider-incidents/review"
            : "formatter/mailchimp-provider-incidents/summary",
      restartSafe: blocked.length === 0 && report?.restartSafe !== false,
      blockedIncidentIds: Object.freeze(blocked.map((incident) => incident.id).sort()),
      pendingIncidentIds: Object.freeze(pending.map((incident) => incident.id).sort()),
      retryableIncidentIds: Object.freeze(retryable.map((incident) => incident.id).sort()),
      idempotencyKeys: Object.freeze(providerIncidents
        .map((incident) => incident.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? report?.recovery?.nextAction
        ?? "publish-mailchimp-provider-incident-contract",
    }),
    recovery: Object.freeze({
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? report?.recovery?.nextAction
        ?? "publish-mailchimp-provider-incident-contract",
      commandRecoveryStatus: state.mailchimpHandoff?.commandContract?.recoverySnapshot?.status ?? "unbound",
      receiptRecoveryStatus: state.mailchimpHandoff?.receiptContract?.status ?? "unbound",
      sourceOperationalStatus: state.sourceOperationalTimeline?.status ?? "unbound",
      sourceAnchorStatus: state.sourceAnchorHandoff?.status ?? "unbound",
    }),
    userVisible: Object.freeze({
      title: providerIncidents.length ? "Mailchimp provider incidents" : "Mailchimp provider incidents clear",
      detail: status === "ready" || status === "idle"
        ? "Mailchimp provider handoff has no blocking diagnostic incidents."
        : `${blocked.length} blocked and ${pending.length} pending Mailchimp provider incidents require action.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? "publish-mailchimp-provider-incident-contract",
    }),
    incidentReport: report,
  });
}

function formatterReleaseLane(lane) {
  return Object.freeze({
    id: lane.id,
    label: lane.label,
    status: lane.status,
    exportAllowed: lane.exportAllowed,
    restartSafe: lane.restartSafe !== false,
    count: lane.count,
    route: lane.route,
    nextAction: lane.nextAction,
    idempotencyKey: lane.idempotencyKey ?? null,
  });
}

function createFormatterMailchimpLaunchHandoff(state) {
  const blocked = state.launchGate.status === "blocked"
    || state.runtimeState.status === "blocked"
    || state.sourcePreview.status === "blocked";
  const pending = state.launchGate.status === "pending"
    || state.runtimeState.status === "pending"
    || state.sourcePreview.status === "pending";
  const review = state.launchGate.status === "review"
    || state.sourcePreview.status === "review";
  const status = blocked
    ? "blocked"
    : pending
      ? "pending"
      : review
        ? "review"
        : state.launchGate.status;
  const blockedGates = state.launchGate.recovery.blockedGateIds ?? [];
  const pendingGates = state.sourcePreview.acceptance.pendingGateIds ?? [];

  return Object.freeze({
    version: "formatter-mailchimp-launch-handoff.v1",
    status,
    ok: status === "ready" || status === "idle",
    providerId: state.launchGate.providerId,
    exportAllowed: status === "ready" || status === "idle",
    syncKey: [
      state.launchGate.handoff.syncKey,
      state.runtimeState.handoff.syncKey,
      state.sourcePreview.syncKey,
    ].join("|"),
    validationSummary: Object.freeze({
      gateCount: state.launchGate.totals.gateCount,
      blockedGateCount: state.launchGate.totals.blockedGateCount,
      pendingGateCount: state.launchGate.totals.pendingGateCount + pendingGates.length,
      reviewGateCount: state.launchGate.totals.reviewGateCount,
      diagnosticCount: state.diagnostics.length,
      runtimeActionCount: state.runtimeState.actions.length,
      sourcePreviewCount: state.sourcePreview.previews.length,
      sourcePreviewStatus: state.sourcePreview.status,
      operationalHandoffStatus: state.mailchimpHandoff.status,
    }),
    acceptance: Object.freeze({
      mode: state.sourcePreview.acceptance.mode,
      acceptable: state.sourcePreview.acceptance.acceptable && state.runtimeState.status !== "blocked",
      requiredGateIds: state.sourcePreview.acceptance.requiredGateIds,
      acceptedGateIds: state.sourcePreview.acceptance.acceptedGateIds,
      pendingGateIds: state.sourcePreview.acceptance.pendingGateIds,
    }),
    gates: Object.freeze((state.launchGate.gates ?? []).map((gate) => Object.freeze({
      id: gate.id,
      gateId: gate.gateId,
      jobName: gate.jobName,
      status: gate.status,
      handoff: gate.handoff,
      nextAction: gate.nextAction,
    }))),
    sourcePreviews: Object.freeze(state.sourcePreview.previews.map((preview) => Object.freeze({
      gateId: preview.gateId,
      jobName: preview.jobName,
      status: preview.status,
      previewAddress: preview.previewAddress,
      externalUri: preview.externalUri,
      accepted: preview.accepted,
      nextAction: preview.nextAction,
    }))),
    runtime: Object.freeze({
      status: state.runtimeState.status,
      route: state.runtimeState.restartEnvelope.route,
      restartSafe: state.runtimeState.restartEnvelope.restartSafe,
      blockedActionIds: state.runtimeState.restartEnvelope.blockedActionIds,
      pendingActionIds: state.runtimeState.restartEnvelope.pendingActionIds,
      nextAction: state.runtimeState.restartEnvelope.nextAction,
    }),
    recovery: Object.freeze({
      blockedGateIds: blockedGates,
      pendingGateIds: pendingGates,
      nextAction: state.runtimeState.restartEnvelope.nextAction
        ?? state.sourcePreview.handoff.nextAction
        ?? state.launchGate.recovery.nextAction,
    }),
    nextAction: blocked
      ? state.runtimeState.restartEnvelope.nextAction
      : pending
        ? state.sourcePreview.handoff.nextAction
        : review
          ? state.launchGate.recovery.nextAction
          : state.launchGate.handoff.nextAction,
  });
}

function createFormatterRangeByJobName(items = []) {
  return Object.freeze(Object.fromEntries(items
    .filter((item) => item.nodeKind === "JobDeclaration" && item.path.at(-1))
    .map((item) => [item.path.at(-1), item.range])
    .sort(([left], [right]) => left.localeCompare(right))));
}

function findMailchimpHandoffJob(mailchimpHandoff, jobName) {
  return mailchimpHandoff.jobs.find((job) => job.jobName === jobName) ?? null;
}

function createFormatterPersistedHandoffState(state, options = {}) {
  const mailchimpReadiness = createMailchimpProviderReadinessPreview(state.mailchimpWorkflow, [], {
    operations: state.mailchimpHandoff.operations,
    recoveryPlan: state.mailchimpHandoff.recoveryPlan,
    requireAcceptance: options.requireMailchimpOperationAcceptance === true,
    tenantBoundary: state.mailchimpWorkflow.tenantBoundary,
  });
  const commandLedger = createFormatterCommandLedger(state, mailchimpReadiness, options);
  const blockedCommands = commandLedger.filter((command) => command.status === "blocked");
  const pendingCommands = commandLedger.filter((command) => command.status === "pending");
  const receiptContract = state.mailchimpHandoff.receiptContract;
  const receiptBlocked = receiptContract?.status === "blocked" || receiptContract?.status === "failed";
  const receiptPending = receiptContract?.status === "pending";
  const sourceBlocked = state.sourcePersistence.status === "blocked";
  const diagnosticsBlocked = state.diagnosticClientState.status === "blocked";
  const tenantBoundaryBlocked = state.mailchimpTenantBoundary?.status === "blocked";
  const tenantBoundaryPending = state.mailchimpTenantBoundary?.status === "review";
  const status = blockedCommands.length
    || sourceBlocked
    || diagnosticsBlocked
    || receiptBlocked
    || tenantBoundaryBlocked
    ? "blocked"
    : pendingCommands.length
      || state.sourcePersistence.status === "pending"
      || state.diagnosticClientState.status === "pending"
      || receiptPending
      || tenantBoundaryPending
      ? "pending"
      : state.readiness.status === "ready" && state.acceptance.acceptable
        ? "ready"
        : "review";

  return Object.freeze({
    version: "formatter-mailchimp-persistence.v1",
    status,
    fileName: state.plan.fileName,
    restartSafe: blockedCommands.length === 0
      && state.sourcePersistence.restartSafe
      && state.diagnosticClientState.status !== "blocked"
      && state.mailchimpTenantBoundary?.handoff?.restartSafe !== false
      && receiptContract?.restartSafe !== false,
    syncKey: [
      state.providerContract.syncMetadata.syncKey,
      state.mailchimpHandoff.syncMetadata.serviceSyncKey ?? "mailchimp-idle",
      state.mailchimpTenantBoundary?.syncKey ?? "mailchimp-tenant-boundary-idle",
      state.sourcePersistence.syncKey,
      options.revision ?? "working",
    ].join("|"),
    sourceProviderSyncKey: state.providerContract.syncMetadata.syncKey,
    sourcePersistenceSyncKey: state.sourcePersistence.syncKey,
    mailchimpServiceSyncKey: state.mailchimpHandoff.syncMetadata.serviceSyncKey,
    mailchimpCommandStatus: state.mailchimpHandoff.commandContract.status,
    mailchimpCommandRestartSafe: state.mailchimpHandoff.commandContract.restartSafe,
    mailchimpReceiptStatus: receiptContract?.status ?? "unbound",
    mailchimpReceiptRestartSafe: receiptContract?.restartSafe ?? true,
    mailchimpTenantBoundaryStatus: state.mailchimpTenantBoundary?.status ?? "unbound",
    mailchimpTenantBoundarySyncKey: state.mailchimpTenantBoundary?.syncKey ?? null,
    diagnosticClientRoute: state.diagnosticClientState.handoff.route,
    acceptedAt: state.acceptance.acceptedAt,
    commandLedger: Object.freeze(commandLedger),
    recovery: Object.freeze({
      blockedCommandIds: Object.freeze(blockedCommands.map((command) => command.id)),
      pendingCommandIds: Object.freeze(pendingCommands.map((command) => command.id)),
      nextAction: blockedCommands[0]?.nextAction
        ?? (receiptBlocked ? receiptContract.recovery.nextAction : null)
        ?? (tenantBoundaryBlocked ? state.mailchimpTenantBoundary.handoff.nextAction : null)
        ?? (sourceBlocked ? state.sourcePersistence.recovery.nextAction : null)
        ?? (diagnosticsBlocked ? state.diagnosticClientState.handoff.nextAction : null)
        ?? pendingCommands[0]?.nextAction
        ?? (receiptPending ? receiptContract.recovery.nextAction : null)
        ?? (tenantBoundaryPending ? state.mailchimpTenantBoundary.handoff.nextAction : null)
        ?? (state.sourcePersistence.status === "pending" ? state.sourcePersistence.recovery.nextAction : null)
        ?? (state.diagnosticClientState.status === "pending" ? state.diagnosticClientState.handoff.nextAction : null)
        ?? state.readiness.nextAction,
    }),
    externalHandoff: Object.freeze({
      sourceStatus: state.providerContract.externalHandoff.status,
      sourcePersistenceStatus: state.sourcePersistence.status,
      diagnosticRuntimeStatus: state.diagnosticClientState.status,
      mailchimpWorkflowPreviewStatus: state.mailchimpWorkflowPreview.status,
      mailchimpStatus: mailchimpReadiness.status,
      mailchimpCommandStatus: state.mailchimpHandoff.commandContract.status,
      mailchimpReceiptStatus: receiptContract?.status ?? "unbound",
      mailchimpTenantBoundaryStatus: state.mailchimpTenantBoundary?.status ?? "unbound",
      exportAllowed: status === "ready",
      nextAction: status === "ready" ? "persist-and-export-formatter-handoff" : "resume-formatter-handoff-recovery",
    }),
  });
}

function createFormatterAnalyticsReport(state, options = {}) {
  const counters = {
    previewByKind: countFormatterItemsBy(state.previewItems, "nodeKind"),
    previewByStatusHandoff: countFormatterItemsBy(state.previewItems, "statusHandoff"),
    previewByAcceptance: countFormatterItemsBy(state.previewItems, "acceptanceState"),
    commandByKind: countFormatterItemsBy(state.persistedState.commandLedger, "kind"),
    commandByStatus: countFormatterItemsBy(state.persistedState.commandLedger, "status"),
    mailchimpCommandByStatus: state.mailchimpHandoff.commandContract.summary.byStatus,
    mailchimpReceiptByStatus: state.mailchimpHandoff.receiptContract?.counters ?? {},
    mailchimpProviderIncidentByStatus: state.mailchimpProviderIncidentContract.counters.byStatus,
    mailchimpProviderIncidentByHandoff: state.mailchimpProviderIncidentContract.counters.byHandoff,
    mailchimpTenantBoundaryByStatus: state.mailchimpTenantBoundary.counters.byStatus,
    mailchimpTenantBoundaryByReason: state.mailchimpTenantBoundary.counters.auditByReason,
    diagnosticByCode: state.diagnosticClientState.validationSummary.byCode,
    providerDiagnosticByCode: countFormatterItemsBy(state.providerDiagnostics, "code"),
    sourceAnchorByStatus: countFormatterItemsBy(state.sourcePersistence.anchors, "status"),
    mailchimpSourceAnchorByStatus: state.mailchimpSourceAnchorHandoff.counters.byStatus,
    mailchimpSourceAnchorByService: state.mailchimpSourceAnchorHandoff.counters.byService,
    sourceOperationalByStatus: state.sourceOperationalTimeline.counters.byStatus,
    sourceOperationalByRoute: state.sourceOperationalTimeline.counters.byRoute,
    sourceExportCapabilityByStatus: state.sourceExportManifest.counters.capabilityByStatus,
    astWorkflowJobsByStatus: state.astExportEvidence.counters.workflowJobsByStatus,
    mailchimpCampaignQueueByStatus: state.mailchimpCampaignExportQueue.counters.byStatus,
    mailchimpCampaignQueueByAcceptance: state.mailchimpCampaignExportQueue.counters.byAcceptance,
    mailchimpCampaignQueueBySchedule: state.mailchimpCampaignExportQueue.counters.byScheduleMode,
    diagnosticExportActionByStatus: state.diagnosticExportState.counters.runtimeActionByStatus,
  };
  const history = createFormatterHistorySnapshots([
    ...(Array.isArray(options.formatterHistory) ? options.formatterHistory : []),
    createFormatterHistoryPoint(state, counters, options),
  ], options);
  const timeline = createFormatterReportingTimeline(state, counters, history);
  const blocked = state.readiness.status === "blocked"
    || state.persistedState.status === "blocked"
    || state.sourceOperationalTimeline.status === "blocked"
    || state.diagnosticClientState.status === "blocked"
    || state.mailchimpCampaignExportQueue.status === "blocked";
  const pending = state.readiness.status === "needsAcceptance"
    || state.persistedState.status === "pending"
    || state.sourceOperationalTimeline.status === "pending"
    || state.sourcePersistence.status === "pending"
    || state.mailchimpCampaignExportQueue.status === "pending";
  const status = blocked ? "blocked" : pending ? "pending" : state.persistedState.status;

  return Object.freeze({
    version: "formatter-analytics-report.v1",
    status,
    ok: status === "ready",
    fileName: state.plan.fileName,
    revision: options.revision ?? "working",
    counters: Object.freeze({
      previewByKind: freezeSortedRecord(counters.previewByKind),
      previewByStatusHandoff: freezeSortedRecord(counters.previewByStatusHandoff),
      previewByAcceptance: freezeSortedRecord(counters.previewByAcceptance),
      commandByKind: freezeSortedRecord(counters.commandByKind),
      commandByStatus: freezeSortedRecord(counters.commandByStatus),
      mailchimpCommandByStatus: counters.mailchimpCommandByStatus,
      mailchimpReceiptByStatus: freezeSortedRecord(counters.mailchimpReceiptByStatus),
      mailchimpProviderIncidentByStatus: counters.mailchimpProviderIncidentByStatus,
      mailchimpProviderIncidentByHandoff: counters.mailchimpProviderIncidentByHandoff,
      mailchimpTenantBoundaryByStatus: counters.mailchimpTenantBoundaryByStatus,
      diagnosticByCode: counters.diagnosticByCode,
      providerDiagnosticByCode: freezeSortedRecord(counters.providerDiagnosticByCode),
      sourceAnchorByStatus: freezeSortedRecord(counters.sourceAnchorByStatus),
      mailchimpSourceAnchorByStatus: counters.mailchimpSourceAnchorByStatus,
      mailchimpSourceAnchorByService: counters.mailchimpSourceAnchorByService,
      sourceOperationalByStatus: counters.sourceOperationalByStatus,
      sourceOperationalByRoute: counters.sourceOperationalByRoute,
      sourceExportCapabilityByStatus: counters.sourceExportCapabilityByStatus,
      astWorkflowJobsByStatus: counters.astWorkflowJobsByStatus,
      mailchimpCampaignQueueByStatus: counters.mailchimpCampaignQueueByStatus,
      mailchimpCampaignQueueByAcceptance: counters.mailchimpCampaignQueueByAcceptance,
      mailchimpCampaignQueueBySchedule: counters.mailchimpCampaignQueueBySchedule,
      diagnosticExportActionByStatus: counters.diagnosticExportActionByStatus,
    }),
    totals: Object.freeze({
      previewCount: state.previewItems.length,
      acceptedPreviewCount: state.acceptance.acceptedIds.length,
      missingPreviewAcceptanceCount: state.acceptance.missingIds.length,
      sourceAnchorCount: state.sourcePersistence.anchors.length,
      mailchimpSourceAnchorOperationCount: state.mailchimpSourceAnchorHandoff.totals.operationCount,
      mailchimpSourceAnchorBlockedCount: state.mailchimpSourceAnchorHandoff.totals.blockedOperationCount,
      mailchimpSourceAnchorPendingCount: state.mailchimpSourceAnchorHandoff.totals.pendingOperationCount,
      sourceOperationalEventCount: state.sourceOperationalTimeline.totals.eventCount,
      sourceOperationalActionableCount: state.sourceOperationalTimeline.totals.actionableEventCount,
      sourceOperationalBlockedCount: state.sourceOperationalTimeline.totals.blockedEventCount,
      sourceOperationalPendingCount: state.sourceOperationalTimeline.totals.pendingEventCount,
      diagnosticCount: state.diagnosticClientState.diagnosticCount,
      providerDiagnosticCount: state.providerDiagnostics.length,
      operationalHealthIssueCount: state.mailchimpHandoff.operationalHealth?.issueCount ?? 0,
      runtimeActionCount: state.diagnosticClientState.validationSummary.actionCount,
      commandCount: state.persistedState.commandLedger.length,
      mailchimpOperationCount: state.mailchimpHandoff.operations.length,
      mailchimpTenantAuditEventCount: state.mailchimpWorkflow.tenantBoundary.audit.eventCount,
      mailchimpTenantBoundaryBlockedCount: state.mailchimpTenantBoundary.totals.blockedCount,
      mailchimpTenantBoundaryReviewCount: state.mailchimpTenantBoundary.totals.reviewCount,
      mailchimpReplayCount: state.mailchimpHandoff.commandContract.recoverySnapshot.replayCommandIds.length,
      mailchimpRetainCount: state.mailchimpHandoff.commandContract.recoverySnapshot.retainedCommandIds.length,
      mailchimpReceiptCount: state.mailchimpHandoff.receiptContract?.receiptCount ?? 0,
      mailchimpReceiptStatus: state.mailchimpHandoff.receiptContract?.status ?? "unbound",
      mailchimpOperationalHealthStatus: state.mailchimpHandoff.operationalHealth?.status ?? "unbound",
      mailchimpProviderIncidentCount: state.mailchimpProviderIncidentContract.totals.incidentCount,
      mailchimpProviderBlockedIncidentCount: state.mailchimpProviderIncidentContract.totals.blockedIncidentCount,
      mailchimpProviderPendingIncidentCount: state.mailchimpProviderIncidentContract.totals.pendingIncidentCount,
      mailchimpCampaignQueueCount: state.mailchimpCampaignExportQueue.totals.queueCount,
      mailchimpCampaignQueueBlockedCount: state.mailchimpCampaignExportQueue.totals.blockedCount,
      mailchimpCampaignQueuePendingCount: state.mailchimpCampaignExportQueue.totals.pendingCount,
      astExportableCount: state.astExportEvidence.totals.astExportableCount,
      sourceExportRangeCount: state.sourceExportManifest.totals.rangeCount,
      diagnosticExportRuntimeActionCount: state.diagnosticExportState.totals.runtimeActionCount,
    }),
    timeline,
    history,
    exportSummary: createFormatterExportSummary(state, status, counters, timeline, history),
  });
}

function createFormatterHistoryPoint(state, counters, options = {}) {
  return Object.freeze({
    capturedAt: options.capturedAt ?? null,
    revision: options.revision ?? "working",
    status: state.persistedState.status,
    readinessStatus: state.readiness.status,
    sourcePersistenceStatus: state.sourcePersistence.status,
    sourceOperationalStatus: state.sourceOperationalTimeline.status,
    mailchimpSourceAnchorStatus: state.mailchimpSourceAnchorHandoff.status,
    mailchimpCampaignQueueStatus: state.mailchimpCampaignExportQueue.status,
    mailchimpStatus: state.mailchimpHandoff.status,
    diagnosticStatus: state.diagnosticClientState.status,
    previewCount: state.previewItems.length,
    commandCount: state.persistedState.commandLedger.length,
    diagnosticCount: state.diagnosticClientState.diagnosticCount,
    pendingAcceptanceCount: state.acceptance.missingIds.length
      + state.acceptance.mailchimpOperations.missingIds.length
      + state.sourcePersistence.recovery.pendingAnchorIds.length
      + state.mailchimpSourceAnchorHandoff.acceptance.pendingAnchorIds.length
      + state.mailchimpCampaignExportQueue.restartEnvelope.pendingJobNames.length,
    blockedCount: (counters.commandByStatus.blocked ?? 0)
      + state.sourcePersistence.recovery.blockedAnchorIds.length
      + state.sourceOperationalTimeline.totals.blockedEventCount
      + state.diagnosticClientState.validationSummary.blockedActionCount
      + state.mailchimpSourceAnchorHandoff.totals.blockedOperationCount
      + state.mailchimpCampaignExportQueue.totals.blockedCount,
    counters: Object.freeze({
      commandByStatus: freezeSortedRecord(counters.commandByStatus),
      previewByAcceptance: freezeSortedRecord(counters.previewByAcceptance),
      sourceAnchorByStatus: freezeSortedRecord(counters.sourceAnchorByStatus),
      mailchimpSourceAnchorByStatus: counters.mailchimpSourceAnchorByStatus,
      mailchimpCampaignQueueByStatus: counters.mailchimpCampaignQueueByStatus,
      sourceOperationalByStatus: counters.sourceOperationalByStatus,
    }),
  });
}

function createFormatterHistorySnapshots(snapshots = [], options = {}) {
  const limit = Number.isFinite(Number(options.formatterHistoryLimit))
    ? Math.max(1, Math.trunc(Number(options.formatterHistoryLimit)))
    : 8;
  const normalized = snapshots
    .filter((snapshot) => snapshot && typeof snapshot === "object")
    .slice(-limit)
    .map((snapshot, index, list) => Object.freeze({
      index,
      age: list.length - index - 1,
      capturedAt: snapshot.capturedAt ?? null,
      revision: snapshot.revision ?? "working",
      status: snapshot.status ?? "unknown",
      readinessStatus: snapshot.readinessStatus ?? "unknown",
      sourcePersistenceStatus: snapshot.sourcePersistenceStatus ?? "unknown",
      sourceOperationalStatus: snapshot.sourceOperationalStatus ?? "unknown",
      mailchimpStatus: snapshot.mailchimpStatus ?? "unknown",
      diagnosticStatus: snapshot.diagnosticStatus ?? "unknown",
      previewCount: normalizeHistoryCount(snapshot.previewCount),
      commandCount: normalizeHistoryCount(snapshot.commandCount),
      diagnosticCount: normalizeHistoryCount(snapshot.diagnosticCount),
      pendingAcceptanceCount: normalizeHistoryCount(snapshot.pendingAcceptanceCount),
      blockedCount: normalizeHistoryCount(snapshot.blockedCount),
      counters: Object.freeze({
        commandByStatus: freezeSortedRecord(snapshot.counters?.commandByStatus ?? {}),
        previewByAcceptance: freezeSortedRecord(snapshot.counters?.previewByAcceptance ?? {}),
        sourceAnchorByStatus: freezeSortedRecord(snapshot.counters?.sourceAnchorByStatus ?? {}),
        mailchimpSourceAnchorByStatus: freezeSortedRecord(snapshot.counters?.mailchimpSourceAnchorByStatus ?? {}),
        sourceOperationalByStatus: freezeSortedRecord(snapshot.counters?.sourceOperationalByStatus ?? {}),
      }),
    }));
  const latest = normalized.at(-1) ?? null;
  const previous = normalized.length > 1 ? normalized.at(-2) : null;

  return Object.freeze({
    limit,
    count: normalized.length,
    latest,
    previous,
    delta: Object.freeze({
      previewCount: latest && previous ? latest.previewCount - previous.previewCount : latest?.previewCount ?? 0,
      commandCount: latest && previous ? latest.commandCount - previous.commandCount : latest?.commandCount ?? 0,
      diagnosticCount: latest && previous ? latest.diagnosticCount - previous.diagnosticCount : latest?.diagnosticCount ?? 0,
      pendingAcceptanceCount: latest && previous
        ? latest.pendingAcceptanceCount - previous.pendingAcceptanceCount
        : latest?.pendingAcceptanceCount ?? 0,
      blockedCount: latest && previous ? latest.blockedCount - previous.blockedCount : latest?.blockedCount ?? 0,
    }),
    snapshots: Object.freeze(normalized),
  });
}

function createFormatterReportingTimeline(state, counters, history) {
  const events = [];
  events.push(formatterTimelineEvent({
    phase: "plan",
    status: state.plan.ok ? "ready" : "blocked",
    label: "Formatter plan",
    detail: `${state.plan.items.length} preview items prepared for ${state.plan.fileName}.`,
    nextAction: state.plan.ok ? "build-formatter-preview" : "resolve-format-preview-diagnostics",
  }));
  events.push(formatterTimelineEvent({
    phase: "source",
    status: state.sourcePersistence.status,
    label: "Source range persistence",
    detail: `${state.sourcePersistence.anchors.length} source anchors tracked; ${state.sourcePersistence.recovery.pendingAnchorIds.length} pending acceptance.`,
    nextAction: state.sourcePersistence.recovery.nextAction,
  }));
  events.push(formatterTimelineEvent({
    phase: "source-operations",
    status: state.sourceOperationalTimeline.status,
    label: "Source operational resume",
    detail: `${state.sourceOperationalTimeline.totals.eventCount} source events; ${state.sourceOperationalTimeline.totals.actionableEventCount} require resume attention.`,
    nextAction: state.sourceOperationalTimeline.restartEnvelope.nextAction,
  }));
  events.push(formatterTimelineEvent({
    phase: "mailchimp-source-anchor",
    status: state.mailchimpSourceAnchorHandoff.status,
    label: "Mailchimp source anchor handoff",
    detail: `${state.mailchimpSourceAnchorHandoff.totals.anchoredOperationCount} of ${state.mailchimpSourceAnchorHandoff.totals.operationCount} operations anchored to source ranges.`,
    nextAction: state.mailchimpSourceAnchorHandoff.restartEnvelope.nextAction,
  }));
  events.push(formatterTimelineEvent({
    phase: "mailchimp",
    status: state.mailchimpHandoff.commandContract.recoverySnapshot.status,
    label: "Mailchimp command recovery",
    detail: `${state.mailchimpHandoff.commandContract.commandCount} commands; ${state.mailchimpHandoff.commandContract.recoverySnapshot.replayCommandIds.length} replayable.`,
    nextAction: state.mailchimpHandoff.commandContract.recoverySnapshot.nextAction,
  }));
  events.push(formatterTimelineEvent({
    phase: "mailchimp-health",
    status: state.mailchimpHandoff.operationalHealth?.status ?? "unbound",
    label: "Mailchimp operational health",
    detail: `${state.mailchimpHandoff.operationalHealth?.issueCount ?? 0} command health issues; retry after ${state.mailchimpHandoff.operationalHealth?.retryAfter ?? "not scheduled"}.`,
    nextAction: state.mailchimpHandoff.operationalHealth?.nextAction ?? "skip-mailchimp-operational-health",
  }));
  events.push(formatterTimelineEvent({
    phase: "mailchimp-receipts",
    status: state.mailchimpHandoff.receiptContract?.status ?? "unbound",
    label: "Mailchimp provider receipts",
    detail: `${state.mailchimpHandoff.receiptContract?.receiptCount ?? 0} receipts tracked; ${state.mailchimpHandoff.receiptContract?.recovery?.pendingCommandIds?.length ?? 0} pending acknowledgement.`,
    nextAction: state.mailchimpHandoff.receiptContract?.recovery?.nextAction ?? "skip-mailchimp-provider-receipts",
  }));
  events.push(formatterTimelineEvent({
    phase: "tenant-boundary",
    status: state.mailchimpTenantBoundary.status,
    label: "Mailchimp tenant boundary",
    detail: `${state.mailchimpTenantBoundary.totals.jobCount} jobs checked; ${state.mailchimpTenantBoundary.totals.auditEventCount} audit events prepared.`,
    nextAction: state.mailchimpTenantBoundary.handoff.nextAction,
  }));
  events.push(formatterTimelineEvent({
    phase: "diagnostics",
    status: state.diagnosticClientState.status,
    label: "Diagnostic runtime",
    detail: `${state.diagnosticClientState.diagnosticCount} diagnostics and ${state.diagnosticClientState.validationSummary.actionCount} runtime actions.`,
    nextAction: state.diagnosticClientState.handoff.nextAction,
  }));
  events.push(formatterTimelineEvent({
    phase: "acceptance",
    status: state.acceptance.acceptable ? "ready" : "pending",
    label: "Preview acceptance",
    detail: `${state.acceptance.missingIds.length} formatter items and ${state.acceptance.mailchimpOperations.missingIds.length} Mailchimp operations pending.`,
    nextAction: state.acceptance.nextAction,
  }));
  events.push(formatterTimelineEvent({
    phase: "export",
    status: state.persistedState.status,
    label: "Formatter export handoff",
    detail: `${counters.commandByStatus.blocked ?? 0} blocked commands; history delta ${history.delta.commandCount}.`,
    nextAction: state.persistedState.recovery.nextAction,
  }));

  return Object.freeze(events.map((event, index) => Object.freeze({ ...event, index })));
}

function createFormatterExportSummary(state, status, counters, timeline, history) {
  const blockedCommands = state.persistedState.recovery.blockedCommandIds;
  const pendingCommands = state.persistedState.recovery.pendingCommandIds;
  const mailchimpRecovery = state.mailchimpHandoff.commandContract.recoverySnapshot;

  return Object.freeze({
    version: "formatter-export-summary.v1",
    status,
    exportAllowed: status === "ready",
    restartSafe: state.persistedState.restartSafe && mailchimpRecovery.restartSafe,
    fileName: state.plan.fileName,
    syncKey: state.persistedState.syncKey,
    blockedCount: blockedCommands.length
      + state.sourcePersistence.recovery.blockedAnchorIds.length
      + state.sourceOperationalTimeline.totals.blockedEventCount
      + state.mailchimpSourceAnchorHandoff.totals.blockedOperationCount
      + state.diagnosticClientState.validationSummary.blockedActionCount,
    pendingCount: pendingCommands.length
      + state.sourcePersistence.recovery.pendingAnchorIds.length
      + state.sourceOperationalTimeline.totals.pendingEventCount
      + state.mailchimpSourceAnchorHandoff.totals.pendingOperationCount
      + state.acceptance.missingIds.length
      + state.acceptance.mailchimpOperations.missingIds.length,
    counters: Object.freeze({
      commandByStatus: freezeSortedRecord(counters.commandByStatus),
      mailchimpCommandByStatus: mailchimpRecovery.byStatus,
      mailchimpReceiptByStatus: state.mailchimpHandoff.receiptContract?.counters ?? {},
      mailchimpTenantBoundaryByStatus: state.mailchimpTenantBoundary.counters.byStatus,
      mailchimpTenantBoundaryByReason: state.mailchimpTenantBoundary.counters.auditByReason,
      sourceAnchorByStatus: freezeSortedRecord(counters.sourceAnchorByStatus),
      mailchimpSourceAnchorByStatus: counters.mailchimpSourceAnchorByStatus,
      sourceOperationalByStatus: counters.sourceOperationalByStatus,
    }),
    historyDelta: history.delta,
    timelineStatus: Object.freeze(timeline.map((event) => Object.freeze({
      phase: event.phase,
      status: event.status,
      nextAction: event.nextAction,
    }))),
    replay: Object.freeze({
      allowed: mailchimpRecovery.restartEnvelope.replayAllowed,
      replayCommandIds: mailchimpRecovery.replayCommandIds,
      retainedCommandIds: mailchimpRecovery.retainedCommandIds,
      retryCommandIds: mailchimpRecovery.retryCommandIds,
      nextAction: mailchimpRecovery.nextAction,
    }),
    receipts: Object.freeze({
      status: state.mailchimpHandoff.receiptContract?.status ?? "unbound",
      exportAllowed: state.mailchimpHandoff.receiptContract?.externalHandoff?.exportAllowed ?? true,
      receiptSyncKey: state.mailchimpHandoff.receiptContract?.syncMetadata?.receiptSyncKey ?? null,
      pendingCommandIds: state.mailchimpHandoff.receiptContract?.recovery?.pendingCommandIds ?? Object.freeze([]),
      failedCommandIds: state.mailchimpHandoff.receiptContract?.recovery?.failedCommandIds ?? Object.freeze([]),
      nextAction: state.mailchimpHandoff.receiptContract?.recovery?.nextAction ?? "skip-mailchimp-provider-receipts",
    }),
    sourceOperations: Object.freeze({
      status: state.sourceOperationalTimeline.status,
      restartSafe: state.sourceOperationalTimeline.restartEnvelope.restartSafe,
      route: state.sourceOperationalTimeline.restartEnvelope.route,
      blockedEventIds: state.sourceOperationalTimeline.restartEnvelope.blockedEventIds,
      pendingEventIds: state.sourceOperationalTimeline.restartEnvelope.pendingEventIds,
      reviewEventIds: state.sourceOperationalTimeline.restartEnvelope.reviewEventIds,
      nextAction: state.sourceOperationalTimeline.restartEnvelope.nextAction,
    }),
    mailchimpSourceAnchors: Object.freeze({
      status: state.mailchimpSourceAnchorHandoff.status,
      exportAllowed: state.mailchimpSourceAnchorHandoff.exportAllowed,
      blockedOperationIds: state.mailchimpSourceAnchorHandoff.restartEnvelope.blockedOperationIds,
      pendingOperationIds: state.mailchimpSourceAnchorHandoff.restartEnvelope.pendingOperationIds,
      pendingAnchorIds: state.mailchimpSourceAnchorHandoff.acceptance.pendingAnchorIds,
      nextAction: state.mailchimpSourceAnchorHandoff.restartEnvelope.nextAction,
    }),
    nextAction: status === "ready"
      ? "export-formatter-contract-summary"
      : state.persistedState.recovery.nextAction,
  });
}

function createFormatterExportEvidence(state) {
  const lanes = [
    formatterExportEvidenceLane({
      id: "formatter-readiness",
      label: "Formatter readiness",
      status: state.readiness.status,
      exportAllowed: state.readiness.exportAllowed,
      count: state.readiness.previewCount,
      nextAction: state.readiness.nextAction,
      handoff: "format-preview",
    }),
    formatterExportEvidenceLane({
      id: "formatter-acceptance",
      label: "Formatter acceptance",
      status: state.acceptance.acceptable ? "ready" : "pending",
      exportAllowed: state.acceptance.acceptable,
      count: state.acceptance.missingIds.length + state.acceptance.mailchimpOperations.missingIds.length,
      nextAction: state.acceptance.nextAction,
      handoff: "format-preview-acceptance",
    }),
    formatterExportEvidenceLane({
      id: "ast-export",
      label: "AST export evidence",
      status: state.astExportEvidence.status,
      exportAllowed: state.astExportEvidence.exportSummary.exportAllowed,
      count: state.astExportEvidence.totals.astExportableCount,
      nextAction: state.astExportEvidence.exportSummary.nextAction,
      handoff: "descriptor-export-summary",
    }),
    formatterExportEvidenceLane({
      id: "mailchimp-campaign-export-queue",
      label: "Mailchimp campaign export queue",
      status: state.mailchimpCampaignExportQueue.status,
      exportAllowed: state.mailchimpCampaignExportQueue.exportAllowed,
      count: state.mailchimpCampaignExportQueue.totals.queueCount,
      nextAction: state.mailchimpCampaignExportQueue.restartEnvelope.nextAction,
      handoff: state.mailchimpCampaignExportQueue.restartEnvelope.route,
    }),
    formatterExportEvidenceLane({
      id: "source-export",
      label: "Source range export",
      status: state.sourceExportManifest.status,
      exportAllowed: state.sourceExportManifest.exportSummary.exportAllowed,
      count: state.sourceExportManifest.totals.rangeCount,
      nextAction: state.sourceExportManifest.recovery.nextAction,
      handoff: "source-range-export-manifest",
    }),
    formatterExportEvidenceLane({
      id: "source-operations",
      label: "Source operational resume",
      status: state.sourceOperationalTimeline.status,
      exportAllowed: state.sourceOperationalTimeline.exportAllowed,
      count: state.sourceOperationalTimeline.totals.eventCount,
      nextAction: state.sourceOperationalTimeline.restartEnvelope.nextAction,
      handoff: state.sourceOperationalTimeline.restartEnvelope.route,
    }),
    formatterExportEvidenceLane({
      id: "diagnostic-export",
      label: "Diagnostic lifecycle export",
      status: state.diagnosticExportState.status,
      exportAllowed: state.diagnosticExportState.exportSummary.exportAllowed,
      count: state.diagnosticExportState.totals.runtimeActionCount,
      nextAction: state.diagnosticExportState.recovery.nextAction,
      handoff: state.diagnosticExportState.route.clientRoute,
    }),
    formatterExportEvidenceLane({
      id: "mailchimp-handoff",
      label: "Mailchimp handoff",
      status: state.mailchimpHandoff.status,
      exportAllowed: state.mailchimpHandoff.exportAllowed,
      count: state.mailchimpHandoff.operations.length,
      nextAction: state.mailchimpHandoff.nextAction,
      handoff: "mailchimp-provider-handoff",
    }),
    formatterExportEvidenceLane({
      id: "mailchimp-schedule-window",
      label: "Mailchimp schedule window",
      status: state.mailchimpScheduleWindowRuntime.status,
      exportAllowed: state.mailchimpScheduleWindowRuntime.exportAllowed,
      count: state.mailchimpScheduleWindowRuntime.totals.windowCount,
      nextAction: state.mailchimpScheduleWindowRuntime.restartEnvelope.nextAction,
      handoff: state.mailchimpScheduleWindowRuntime.restartEnvelope.route,
    }),
    formatterExportEvidenceLane({
      id: "mailchimp-source-anchor",
      label: "Mailchimp source anchors",
      status: state.mailchimpSourceAnchorHandoff.status,
      exportAllowed: state.mailchimpSourceAnchorHandoff.exportAllowed,
      count: state.mailchimpSourceAnchorHandoff.totals.operationCount,
      nextAction: state.mailchimpSourceAnchorHandoff.restartEnvelope.nextAction,
      handoff: state.mailchimpSourceAnchorHandoff.restartEnvelope.route,
    }),
    formatterExportEvidenceLane({
      id: "mailchimp-provider-incidents",
      label: "Mailchimp provider incidents",
      status: state.mailchimpProviderIncidentContract.status,
      exportAllowed: state.mailchimpProviderIncidentContract.exportAllowed,
      count: state.mailchimpProviderIncidentContract.totals.incidentCount,
      nextAction: state.mailchimpProviderIncidentContract.restartEnvelope.nextAction,
      handoff: state.mailchimpProviderIncidentContract.restartEnvelope.route,
    }),
    formatterExportEvidenceLane({
      id: "mailchimp-tenant-boundary",
      label: "Mailchimp tenant boundary",
      status: state.mailchimpTenantBoundary.status,
      exportAllowed: state.mailchimpTenantBoundary.exportAllowed,
      count: state.mailchimpTenantBoundary.totals.auditEventCount,
      nextAction: state.mailchimpTenantBoundary.handoff.nextAction,
      handoff: state.mailchimpTenantBoundary.handoff.route,
    }),
    formatterExportEvidenceLane({
      id: "mailchimp-receipts",
      label: "Mailchimp receipts",
      status: state.mailchimpHandoff.receiptContract?.status ?? "idle",
      exportAllowed: state.mailchimpHandoff.receiptContract?.externalHandoff?.exportAllowed ?? true,
      count: state.mailchimpHandoff.receiptContract?.receiptCount ?? 0,
      nextAction: state.mailchimpHandoff.receiptContract?.recovery?.nextAction ?? "skip-mailchimp-provider-receipts",
      handoff: "mailchimp-provider-receipt",
    }),
    formatterExportEvidenceLane({
      id: "persistence",
      label: "Formatter persistence",
      status: state.persistedState.status,
      exportAllowed: state.persistedState.externalHandoff.exportAllowed,
      count: state.persistedState.commandLedger.length,
      nextAction: state.persistedState.recovery.nextAction,
      handoff: "formatter-mailchimp-persistence",
    }),
  ];
  const blocked = lanes.filter((lane) => lane.status === "blocked" || lane.exportAllowed === false);
  const pending = lanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance");
  const review = lanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "formatter-export-evidence.v1",
    status,
    ok: status === "ready",
    exportAllowed: status === "ready",
    restartSafe: state.persistedState.restartSafe
      && state.sourceExportManifest.restartSafe
      && state.sourceOperationalTimeline.restartEnvelope.restartSafe
      && state.mailchimpSourceAnchorHandoff.restartEnvelope.restartSafe
      && state.mailchimpCampaignExportQueue.restartEnvelope.restartSafe
      && state.diagnosticExportState.exportSummary.restartSafe
      && state.mailchimpTenantBoundary.handoff.restartSafe
      && state.mailchimpHandoff.receiptContract?.restartSafe !== false,
    syncKey: [
      state.persistedState.syncKey,
      state.sourceExportManifest.syncKey,
      state.astExportEvidence.exportSummary.syncKey,
      state.mailchimpCampaignExportQueue.exportSummary.syncKey,
      state.mailchimpSourceAnchorHandoff.syncKey,
      state.mailchimpTenantBoundary.syncKey,
      state.analyticsReport.exportSummary.syncKey,
    ].join("|"),
    lanes: Object.freeze(lanes),
    counters: Object.freeze({
      laneByStatus: freezeSortedRecord(countFormatterItemsBy(lanes, "status")),
      previewByAcceptance: state.analyticsReport.counters.previewByAcceptance,
      astByStatus: state.astExportEvidence.counters.astByStatus,
      mailchimpCampaignQueueByStatus: state.mailchimpCampaignExportQueue.counters.byStatus,
      mailchimpCampaignQueueByAcceptance: state.mailchimpCampaignExportQueue.counters.byAcceptance,
      sourceAnchorByStatus: state.sourceExportManifest.counters.anchorByStatus,
      mailchimpSourceAnchorByStatus: state.mailchimpSourceAnchorHandoff.counters.byStatus,
      sourceOperationalByStatus: state.sourceOperationalTimeline.counters.byStatus,
      diagnosticActionByStatus: state.diagnosticExportState.counters.runtimeActionByStatus,
      mailchimpCommandByStatus: state.analyticsReport.counters.mailchimpCommandByStatus,
      mailchimpReceiptByStatus: state.analyticsReport.counters.mailchimpReceiptByStatus,
      mailchimpTenantBoundaryByStatus: state.mailchimpTenantBoundary.counters.byStatus,
      mailchimpTenantBoundaryByReason: state.mailchimpTenantBoundary.counters.auditByReason,
    }),
    recovery: Object.freeze({
      blockedLaneIds: Object.freeze(blocked.map((lane) => lane.id).sort()),
      pendingLaneIds: Object.freeze(pending.map((lane) => lane.id).sort()),
      reviewLaneIds: Object.freeze(review.map((lane) => lane.id).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-formatter-export-evidence",
    }),
    exportSummary: Object.freeze({
      status,
      exportAllowed: status === "ready",
      restartSafe: state.persistedState.restartSafe
        && state.sourceExportManifest.restartSafe
        && state.sourceOperationalTimeline.restartEnvelope.restartSafe
        && state.mailchimpSourceAnchorHandoff.restartEnvelope.restartSafe
        && state.mailchimpCampaignExportQueue.restartEnvelope.restartSafe
        && state.diagnosticExportState.exportSummary.restartSafe
        && state.mailchimpTenantBoundary.handoff.restartSafe
        && state.mailchimpHandoff.receiptContract?.restartSafe !== false,
      nextAction: status === "ready"
        ? "publish-formatter-export-evidence"
        : "resume-formatter-export-evidence",
    }),
  });
}

function formatterExportEvidenceLane(lane) {
  return Object.freeze({
    id: lane.id,
    label: lane.label,
    status: lane.status,
    exportAllowed: lane.exportAllowed,
    count: lane.count,
    handoff: lane.handoff,
    nextAction: lane.nextAction,
  });
}

function createFormatterCommandLedger(state, mailchimpReadiness, options = {}) {
  const acceptedPreviewIds = new Set(state.acceptance.acceptedIds);
  const acceptedOperationIds = new Set(state.acceptance.mailchimpOperations.acceptedIds);
  const previewCommands = state.plan.items.map((item, index) => {
    const id = `format-preview:${item.nodeKind}:${index}`;
    const accepted = acceptedPreviewIds.has(`${item.nodeKind}:${index}`);
    return Object.freeze({
      id,
      kind: "formatPreview",
      target: item.previewRange,
      status: state.readiness.status === "blocked"
        ? "blocked"
        : accepted || state.acceptance.mode === "implicit"
          ? "ready"
          : "pending",
      idempotencyKey: `${state.plan.fileName}:${item.previewRange}:${item.statusHandoff}`,
      restartSafe: true,
      nextAction: accepted ? "retain-preview-acceptance" : "accept-format-preview",
    });
  });
  const operationCommands = state.mailchimpHandoff.commandContract.commands.map((command) => {
    const accepted = acceptedOperationIds.has(command.operationId) || options.requireMailchimpOperationAcceptance !== true;
    return Object.freeze({
      id: `mailchimp-operation:${command.operationId}`,
      kind: "mailchimpProviderOperation",
      target: command.commandId,
      status: command.status === "blocked"
        ? "blocked"
        : command.status === "retry"
          ? "pending"
        : command.status === "queued"
          ? "ready"
        : accepted
          ? "ready"
          : "pending",
      idempotencyKey: command.idempotencyKey,
      restartSafe: command.restartSafe,
      nextAction: command.status === "blocked" || command.status === "retry"
        ? command.nextAction
        : command.status === "queued"
          ? "retain-mailchimp-provider-command"
        : accepted
          ? command.nextAction
          : "accept-mailchimp-provider-operation",
      commandState: command.status,
    });
  });
  const receiptCommands = (state.mailchimpHandoff.receiptContract?.receipts ?? []).map((receipt) => Object.freeze({
    id: `mailchimp-receipt:${receipt.commandId ?? receipt.operationId}`,
    kind: "mailchimpProviderReceipt",
    target: receipt.receiptId ?? receipt.commandId ?? receipt.operationId,
    status: receipt.status === "blocked" || receipt.status === "failed"
      ? "blocked"
      : receipt.status === "pending"
        ? "pending"
        : "ready",
    idempotencyKey: receipt.idempotencyKey
      ? `receipt:${receipt.idempotencyKey}:${receipt.receiptId ?? "pending"}`
      : null,
    restartSafe: receipt.restartSafe,
    nextAction: receipt.nextAction,
    receiptState: receipt.status,
    handoffState: receipt.handoffState,
  }));
  const tenantBoundaryCommands = state.mailchimpWorkflow.tenantBoundary.boundaries
    .filter((boundary) => boundary.status !== "idle")
    .map((boundary) => Object.freeze({
      id: `mailchimp-tenant-boundary:${boundary.jobName}`,
      kind: "mailchimpTenantBoundary",
      target: `${boundary.operationBoundary.tenantId ?? "tenant-unbound"}:${boundary.operationBoundary.workspaceId ?? "workspace-unbound"}`,
      status: boundary.status === "blocked"
        ? "blocked"
        : boundary.status === "review"
          ? "pending"
          : "ready",
      idempotencyKey: [
        state.mailchimpWorkflow.providerId,
        boundary.jobName,
        boundary.operationBoundary.tenantId ?? "tenant-unbound",
        boundary.operationBoundary.workspaceId ?? "workspace-unbound",
        boundary.operationBoundary.role ?? "role-unbound",
      ].join(":"),
      restartSafe: boundary.status !== "blocked",
      nextAction: boundary.nextAction,
    }));

  const sourceCommands = state.sourcePersistence.commands.map((command) => Object.freeze({
    ...command,
    kind: `source:${command.kind}`,
  }));
  const diagnosticCommands = state.diagnosticClientState.runtimeActions.map((action) => Object.freeze({
    id: `diagnostic-runtime:${action.id}`,
    kind: `diagnostic:${action.kind}`,
    target: action.target,
    status: action.status,
    idempotencyKey: action.idempotencyKey,
    restartSafe: action.restartSafe,
    nextAction: action.nextAction,
  }));

  return Object.freeze([...previewCommands, ...operationCommands, ...receiptCommands, ...tenantBoundaryCommands, ...sourceCommands, ...diagnosticCommands]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)));
}

function countFormatterItemsBy(items = [], field) {
  const counters = {};
  for (const item of Array.isArray(items) ? items : []) {
    const value = item?.[field] ?? "unknown";
    counters[String(value)] = (counters[String(value)] ?? 0) + 1;
  }
  return counters;
}

function normalizeHistoryCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function formatterTimelineEvent(event) {
  return Object.freeze({
    phase: event.phase,
    status: event.status,
    label: event.label,
    detail: event.detail,
    nextAction: event.nextAction,
  });
}

function freezeSortedRecord(record = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  ));
}
