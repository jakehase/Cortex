import {
  createMailchimpAstExportBatchSummary,
  createMailchimpAstAnalyticsExportBundle,
  createMailchimpAstExportCheckpointReport,
  createMailchimpAstExportEvidence,
  createMailchimpAstExportResumeLedger,
  createMailchimpCampaignControlPlaneContract,
  createMailchimpCampaignReleaseContract,
  createMailchimpCampaignExportQueue,
  createMailchimpClientRuntimeRequestContract,
  createMailchimpClientRuntimeHandoffCheckpoint,
  createMailchimpClientRuntimeTargets,
  createMailchimpLaunchGateContract,
  createMailchimpLifecycleCommandState,
  createMailchimpPersistedCommandEnvelope,
  createMailchimpProviderServiceReadinessMatrix,
  createMailchimpProviderServiceHandoffContract,
  createMailchimpProviderServiceHandoffExportDeck,
  createMailchimpWorkflowHandoffReadinessPacket,
  createMailchimpProviderServiceSyncCheckpoint,
  createMailchimpTenantPermissionBoundaryContract,
  createMailchimpTenantPermissionDecision,
  createMailchimpWorkflowState,
  createMailchimpWorkflowPreviewContract,
  getAstNodeKindContract,
  listAstNodeKindContracts,
  normalizeAstNodeKind,
} from "./ast-node-kinds.mjs";
import {
  createCatalogDiagnostic,
  createDiagnosticClientRuntimeAdoptionState,
  createDiagnosticClientRuntimeState,
  createDiagnosticHandoffAcceptanceGate,
  createDiagnosticLifecycleCommandSummary,
  createDiagnosticLifecycleExportState,
  createFormatterAnalyticsExportDiagnostics,
  createFormatterProductSliceReadinessDiagnostics,
  createMailchimpAstAnalyticsExportDiagnostics,
  createMailchimpCampaignControlPlaneDiagnostics,
  createMailchimpDiagnosticCheckpointControls,
  createMailchimpPreviewActionStripDiagnostics,
  createMailchimpClientRuntimeAdoptionDiagnostics,
  createMailchimpDiagnosticIncidentReport,
  createMailchimpCampaignReleaseDiagnostics,
  createDiagnosticProviderActionDeck,
  createDiagnosticReviewBoardLanes,
  createDiagnosticPersistedResumeState,
  createDiagnosticReleaseChecklist,
  createSourceRangeClientRouteHandoffDiagnostics,
  createSourceRangeFailureRecoveryDiagnostics,
  createSourceRangeRecoveryCommandExportDiagnostics,
  createSourceRangeRuntimeResumeDiagnostics,
  createMailchimpLaunchGateDiagnostics,
  createMailchimpLifecycleCommandDiagnostics,
  createMailchimpLaunchGateRuntimeState,
  createMailchimpWorkflowHandoffReadinessDiagnostics,
  createMailchimpProviderHandoffState,
  createMailchimpProviderReadinessPreview,
  createMailchimpProviderServiceHandoffExportDiagnostics,
  createMailchimpProviderServiceHandoffDiagnostics,
  createMailchimpProviderServiceReadinessDiagnostics,
  createMailchimpProviderSourceDeploymentDiagnostics,
  createMailchimpProviderServiceSyncCheckpointDiagnostics,
  createMailchimpWorkflowDiagnostics,
} from "./diagnostic-catalog.mjs";
import {
  compactSourceRange,
  createMailchimpLaunchGateSourcePreview,
  createMailchimpProviderSourceDeploymentPacket,
  createMailchimpSourceAnchorHandoffContract,
  createRangeStatus,
  createSourceRangeClientActionDeck,
  createSourceRangeClientAcceptanceSummary,
  createSourceRangeClientCommandPacket,
  createSourceRangeClientRouteHandoffPacket,
  createSourceRangeFailureRecoveryState,
  createSourceRangeClientWorkflowHandoffQueue,
  createSourceRangeExportManifest,
  createMailchimpPreviewActionStrip,
  createSourceRangeOperationalTimeline,
  createSourceRangeProviderExportSummary,
  createSourceRangeProviderContract,
  createSourceRangePersistenceSnapshot,
  createSourceRangeReleasePacket,
  createSourceRangeRecoveryCommandExport,
  createSourceRangeRecoveryReadinessDigest,
  createSourceRangeRuntimeResumePacket,
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

export const AIOS_FORMATTER_LIFECYCLE_COMMANDS = Object.freeze({
  enableFormatter: formatterLifecycleCommand({
    id: "enableFormatter",
    label: "Enable formatter export",
    allowedStatuses: ["disabled", "blocked", "pending", "review"],
    nextAction: "enable-formatter-export",
  }),
  disableFormatter: formatterLifecycleCommand({
    id: "disableFormatter",
    label: "Disable formatter export",
    allowedStatuses: ["ready", "pending", "review"],
    requiresReason: true,
    nextAction: "record-formatter-disable-reason",
  }),
  setDryRun: formatterLifecycleCommand({
    id: "setDryRun",
    label: "Set dry-run mode",
    allowedStatuses: ["ready", "pending", "review"],
    nextAction: "preview-formatter-export-dry-run",
  }),
  scheduleFormatter: formatterLifecycleCommand({
    id: "scheduleFormatter",
    label: "Schedule formatter export",
    allowedStatuses: ["ready", "pending", "review"],
    nextAction: "schedule-formatter-export",
  }),
  clearSchedule: formatterLifecycleCommand({
    id: "clearSchedule",
    label: "Clear formatter schedule",
    allowedStatuses: ["pending", "review", "ready"],
    nextAction: "clear-formatter-export-schedule",
  }),
  requestExport: formatterLifecycleCommand({
    id: "requestExport",
    label: "Request formatter export",
    allowedStatuses: ["ready"],
    nextAction: "request-formatter-export",
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

export function listFormatterLifecycleCommands(filter = {}) {
  return Object.freeze(Object.values(AIOS_FORMATTER_LIFECYCLE_COMMANDS)
    .filter((command) => !filter.status || command.allowedStatuses.includes(filter.status))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

export function createFormatterLifecycleState(plan = {}, options = {}) {
  const settings = normalizeFormatterLifecycleSettings(options.formatterLifecycle ?? options.lifecycle ?? options);
  const diagnostics = [];
  const commandRows = [];
  const schedule = settings.schedule;
  const requestedCommands = new Set(settings.requestedCommandIds);
  const completedCommands = new Set(settings.completedCommandIds);
  const failedCommands = new Set(settings.failedCommandIds);

  if (settings.invalidReasons.length) {
    diagnostics.push(...settings.invalidReasons.map((reason) => createCatalogDiagnostic("AIOS_FORMATTER_LIFECYCLE", {
      severity: "error",
      message: reason,
      hint: "Recovery: repair-formatter-lifecycle-settings; handoff: formatter-lifecycle-controls.",
      preview: `Formatter lifecycle setting rejected: ${reason}`,
    })));
  }

  if (settings.enabled === false && (plan.items?.length ?? 0) > 0) {
    diagnostics.push(createCatalogDiagnostic("AIOS_FORMATTER_LIFECYCLE", {
      severity: "warning",
      message: "Formatter export is disabled while preview items are available.",
      hint: "Recovery: enable-formatter-export; handoff: formatter-lifecycle-controls.",
      preview: "Formatter lifecycle is disabled for this preview.",
    }));
  }

  const baseStatus = settings.invalidReasons.length
    ? "blocked"
    : settings.enabled === false
      ? "disabled"
      : settings.mode === "dryRun"
        ? "review"
        : schedule.status === "pending"
          ? "pending"
          : "ready";

  for (const command of listFormatterLifecycleCommands({ status: baseStatus })) {
    const id = `formatter-lifecycle:${command.id}`;
    const failed = failedCommands.has(command.id) || failedCommands.has(id);
    const completed = completedCommands.has(command.id) || completedCommands.has(id);
    const requested = requestedCommands.has(command.id) || requestedCommands.has(id);
    commandRows.push(Object.freeze({
      id,
      commandId: command.id,
      status: failed ? "blocked" : completed ? "ready" : requested ? "pending" : baseStatus,
      enabled: !completed,
      requiresReason: command.requiresReason,
      scheduleId: command.id === "scheduleFormatter" ? schedule.id : null,
      nextAction: failed
        ? "retry-formatter-lifecycle-command"
        : completed
          ? "retain-formatter-lifecycle-command"
          : command.nextAction,
    }));
  }

  const blockedCommands = commandRows.filter((command) => command.status === "blocked");
  const pendingCommands = commandRows.filter((command) => command.status === "pending");
  const status = settings.invalidReasons.length || blockedCommands.length
    ? "blocked"
    : settings.enabled === false
      ? "disabled"
      : pendingCommands.length || schedule.status === "pending"
        ? "pending"
        : settings.mode === "dryRun"
          ? "review"
          : "ready";

  return Object.freeze({
    version: "formatter-lifecycle-state.v1",
    status,
    ok: status === "ready" || status === "review",
    exportAllowed: status === "ready",
    fileName: plan.fileName ?? options.fileName ?? "inline.aios",
    settings: Object.freeze({
      enabled: settings.enabled,
      mode: settings.mode,
      dryRun: settings.mode === "dryRun",
      requireScheduleAcceptance: settings.requireScheduleAcceptance,
      disableReason: settings.disableReason,
    }),
    schedule,
    diagnostics: Object.freeze(diagnostics),
    commands: Object.freeze(commandRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    counters: Object.freeze({
      byCommandStatus: freezeSortedRecord(countFormatterItemsBy(commandRows, "status")),
      byCommandId: freezeSortedRecord(countFormatterItemsBy(commandRows, "commandId")),
    }),
    totals: Object.freeze({
      commandCount: commandRows.length,
      blockedCommandCount: blockedCommands.length,
      pendingCommandCount: pendingCommands.length,
      diagnosticCount: diagnostics.length,
      previewCount: plan.items?.length ?? 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "formatter/lifecycle/recovery"
        : status === "disabled"
          ? "formatter/lifecycle/enable"
          : status === "pending"
            ? "formatter/lifecycle/commands"
            : status === "review"
              ? "formatter/lifecycle/review"
              : "formatter/lifecycle/summary",
      restartSafe: status !== "blocked",
      blockedCommandIds: Object.freeze(blockedCommands.map((command) => command.id).sort()),
      pendingCommandIds: Object.freeze(pendingCommands.map((command) => command.id).sort()),
      idempotencyKeys: Object.freeze(commandRows.map((command) => [
        plan.fileName ?? options.fileName ?? "inline.aios",
        settings.mode,
        schedule.id,
        command.id,
        command.status,
      ].join(":")).sort()),
      nextAction: blockedCommands[0]?.nextAction
        ?? (status === "disabled" ? "enable-formatter-export" : null)
        ?? pendingCommands[0]?.nextAction
        ?? (status === "review" ? "review-formatter-lifecycle-dry-run" : null)
        ?? "publish-formatter-lifecycle-state",
    }),
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
    requireServiceSyncWindowAcceptance: options.requireMailchimpServiceSyncWindowAcceptance
      ?? options.requireServiceSyncWindowAcceptance
      ?? options.mailchimpWorkflow?.requireServiceSyncWindowAcceptance
      ?? options.mailchimp?.requireServiceSyncWindowAcceptance,
    acceptedServiceSyncWindowIds: options.acceptedMailchimpServiceSyncWindowIds
      ?? options.acceptedServiceSyncWindowIds
      ?? options.mailchimpWorkflow?.acceptedServiceSyncWindowIds
      ?? options.mailchimp?.acceptedServiceSyncWindowIds,
  };
  const mailchimpWorkflow = createMailchimpWorkflowState(ast, mailchimpOptions);
  const mailchimpLifecycleCommandState = createMailchimpLifecycleCommandState(mailchimpWorkflow, {
    ...mailchimpOptions,
    ...options,
  });
  const mailchimpPersistedCommandEnvelope = createMailchimpPersistedCommandEnvelope(mailchimpWorkflow, {
    ...options,
    lifecycleCommandState: mailchimpLifecycleCommandState,
    acceptedMailchimpPersistedCommandIds: options.acceptedMailchimpPersistedCommandIds,
    completedMailchimpPersistedCommandIds: options.completedMailchimpPersistedCommandIds,
    failedMailchimpPersistedCommandIds: options.failedMailchimpPersistedCommandIds,
    requireMailchimpPersistedCommandAcceptance: options.requireMailchimpPersistedCommandAcceptance,
    allowReviewMailchimpPersistedCommands: options.allowReviewMailchimpPersistedCommands,
  });
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
  const mailchimpLifecycleCommandDiagnostics = createMailchimpLifecycleCommandDiagnostics(mailchimpLifecycleCommandState, {
    rangeByJobName: mailchimpRangeByJobName,
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
    requireServiceSyncWindowAcceptance: mailchimpOptions.requireServiceSyncWindowAcceptance,
    acceptedServiceSyncWindowIds: mailchimpOptions.acceptedServiceSyncWindowIds,
    acceptedMailchimpTenantAuditRowIds: options.acceptedMailchimpTenantAuditRowIds,
    acceptedMailchimpTenantJobNames: options.acceptedMailchimpTenantJobNames,
    requiredMailchimpTenantOperationIds: options.requiredMailchimpTenantOperationIds,
    requireMailchimpTenantPermissionAcceptance: options.requireMailchimpTenantPermissionAcceptance,
    allowReviewTenantPermissionHandoff: options.allowReviewTenantPermissionHandoff,
    rangeByJobName: mailchimpRangeByJobName,
  });
  const mailchimpServiceSyncCheckpoint = createMailchimpProviderServiceSyncCheckpoint(mailchimpWorkflow.providerContract, {
    revision: options.revision,
    externalRunId: options.externalRunId,
    requireServiceSyncWindowAcceptance: mailchimpOptions.requireServiceSyncWindowAcceptance,
    acceptedServiceSyncWindowIds: mailchimpOptions.acceptedServiceSyncWindowIds,
    requiredServiceSyncWindowIds: options.requiredMailchimpServiceSyncWindowIds ?? options.requiredServiceSyncWindowIds,
    completedServiceSyncWindowIds: options.completedMailchimpServiceSyncWindowIds ?? options.completedServiceSyncWindowIds,
    failedServiceSyncWindowIds: options.failedMailchimpServiceSyncWindowIds ?? options.failedServiceSyncWindowIds,
    allowReviewServiceSyncCheckpoint: options.allowReviewMailchimpServiceSyncCheckpoint,
  });
  const mailchimpProviderServiceReadinessMatrix = createMailchimpProviderServiceReadinessMatrix(mailchimpWorkflow.providerContract, {
    revision: options.revision,
    externalRunId: options.externalRunId,
    requireServiceSyncWindowAcceptance: mailchimpOptions.requireServiceSyncWindowAcceptance,
    acceptedServiceSyncWindowIds: mailchimpOptions.acceptedServiceSyncWindowIds,
    requiredServiceSyncWindowIds: options.requiredMailchimpServiceSyncWindowIds ?? options.requiredServiceSyncWindowIds,
    completedServiceSyncWindowIds: options.completedMailchimpServiceSyncWindowIds ?? options.completedServiceSyncWindowIds,
    failedServiceSyncWindowIds: options.failedMailchimpServiceSyncWindowIds ?? options.failedServiceSyncWindowIds,
    allowReviewServiceSyncCheckpoint: options.allowReviewMailchimpServiceSyncCheckpoint,
    allowDegradedOptionalServices: options.allowDegradedMailchimpProviderServices,
    serviceSyncCheckpoint: mailchimpServiceSyncCheckpoint,
  });
  const mailchimpProviderServiceHandoff = createMailchimpProviderServiceHandoffContract(mailchimpWorkflow.providerContract, {
    revision: options.revision,
    externalRunId: options.externalRunId,
    serviceSyncCheckpoint: mailchimpServiceSyncCheckpoint,
    providerServiceReadiness: mailchimpProviderServiceReadinessMatrix,
    providerCommandContract: mailchimpHandoff.commandContract,
    providerReceiptContract: mailchimpHandoff.receiptContract,
    allowReviewProviderServiceHandoff: options.allowReviewMailchimpProviderServiceHandoff,
  });
  const mailchimpProviderServiceHandoffExportDeck = createMailchimpProviderServiceHandoffExportDeck(mailchimpProviderServiceHandoff, {
    fileName: plan.fileName,
    revision: options.revision,
    acceptedMailchimpProviderServiceHandoffExportIds: options.acceptedMailchimpProviderServiceHandoffExportIds,
    completedMailchimpProviderServiceHandoffExportIds: options.completedMailchimpProviderServiceHandoffExportIds,
    failedMailchimpProviderServiceHandoffExportIds: options.failedMailchimpProviderServiceHandoffExportIds,
    requireMailchimpProviderServiceHandoffExportAcceptance: options.requireMailchimpProviderServiceHandoffExportAcceptance,
    allowReviewMailchimpProviderServiceHandoffExport: options.allowReviewMailchimpProviderServiceHandoffExport,
  });
  const mailchimpOperationalHealthReport = mailchimpHandoff.operationalHealth?.report ?? null;
  const serviceSyncCheckpointDiagnostics = createMailchimpProviderServiceSyncCheckpointDiagnostics(mailchimpServiceSyncCheckpoint, {
    rangeByJobName: mailchimpRangeByJobName,
  });
  const serviceReadinessDiagnostics = createMailchimpProviderServiceReadinessDiagnostics(mailchimpProviderServiceReadinessMatrix, {
    rangeByServiceReadinessRowId: options.rangeByMailchimpServiceReadinessRowId,
    rangeByService: options.rangeByMailchimpProviderService,
  });
  const providerServiceHandoffDiagnostics = createMailchimpProviderServiceHandoffDiagnostics(mailchimpProviderServiceHandoff, {
    rangeByProviderServiceHandoffLaneId: options.rangeByMailchimpProviderServiceHandoffLaneId,
    rangeByLaneId: options.rangeByMailchimpProviderLaneId,
  });
  const providerServiceHandoffExportDiagnostics = createMailchimpProviderServiceHandoffExportDiagnostics(
    mailchimpProviderServiceHandoffExportDeck,
    {
      rangeByProviderServiceHandoffExportRowId: options.rangeByMailchimpProviderServiceHandoffExportRowId,
      rangeByProviderServiceHandoffLaneId: options.rangeByMailchimpProviderServiceHandoffLaneId,
      rangeByLaneId: options.rangeByMailchimpProviderLaneId,
    },
  );
  const providerDiagnostics = Object.freeze([
    ...mailchimpDiagnostics,
    ...mailchimpLifecycleCommandDiagnostics,
    ...serviceSyncCheckpointDiagnostics,
    ...serviceReadinessDiagnostics,
    ...providerServiceHandoffDiagnostics,
    ...providerServiceHandoffExportDiagnostics,
    ...(mailchimpHandoff.operationalHealth?.diagnostics ?? []),
    ...(mailchimpOperationalHealthReport?.diagnostics ?? []),
  ]);
  const formatterLifecycle = createFormatterLifecycleState(plan, {
    ...options,
    formatterLifecycle: options.formatterLifecycle ?? options.lifecycle,
  });
  const mailchimpTenantBoundary = createMailchimpTenantPermissionBoundaryContract(mailchimpWorkflow, {
    revision: options.revision,
    externalRunId: options.externalRunId,
  });
  const mailchimpTenantPermissionDecision = createMailchimpTenantPermissionDecision(mailchimpTenantBoundary, {
    acceptedMailchimpTenantAuditRowIds: options.acceptedMailchimpTenantAuditRowIds,
    acceptedMailchimpTenantJobNames: options.acceptedMailchimpTenantJobNames,
    requiredMailchimpTenantOperationIds: options.requiredMailchimpTenantOperationIds,
    requireMailchimpTenantPermissionAcceptance: options.requireMailchimpTenantPermissionAcceptance,
    allowReviewTenantPermissionHandoff: options.allowReviewTenantPermissionHandoff,
  });
  const mailchimpCampaignControlPlane = createMailchimpCampaignControlPlaneContract({
    workflowState: mailchimpWorkflow,
    lifecycleCommandState: mailchimpLifecycleCommandState,
    providerServiceReadiness: mailchimpProviderServiceReadinessMatrix,
    tenantPermissionDecision: mailchimpTenantPermissionDecision,
    formatterLifecycle,
  }, {
    fileName: plan.fileName,
    revision: options.revision,
    allowReviewMailchimpControlPlane: options.allowReviewMailchimpControlPlane,
  });
  const mailchimpCampaignControlPlaneDiagnostics = createMailchimpCampaignControlPlaneDiagnostics(
    mailchimpCampaignControlPlane,
    {
      rangeByControlPlaneRowId: options.rangeByMailchimpControlPlaneRowId,
      rangeByJobName: mailchimpRangeByJobName,
    },
  );
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
  const validationSummary = createFormatterValidationSummary(validation, plan, providerContract, [
    ...providerDiagnostics,
    ...formatterLifecycle.diagnostics,
    ...mailchimpCampaignControlPlaneDiagnostics,
  ]);
  const previewItems = plan.items.map((item, index) => createFormatterPreviewItem(item, index, options, mailchimpHandoff));
  const readiness = createFormatterReadinessState(
    validationSummary,
    previewItems,
    options,
    mailchimpHandoff,
    formatterLifecycle,
    mailchimpServiceSyncCheckpoint,
  );
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
    mailchimpServiceSyncCheckpoint,
    mailchimpLifecycleCommandState,
    mailchimpWorkflow,
    mailchimpTenantBoundary,
    formatterLifecycle,
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
  const mailchimpAstAnalyticsExportBundle = createMailchimpAstAnalyticsExportBundle(ast, {
    ...mailchimpOptions,
    fileName: plan.fileName,
    revision: options.revision,
    astHistory: options.astHistory,
    astHistoryLimit: options.astHistoryLimit,
    acceptedMailchimpAstAnalyticsRowIds: options.acceptedMailchimpAstAnalyticsRowIds,
    completedMailchimpAstAnalyticsRowIds: options.completedMailchimpAstAnalyticsRowIds,
    failedMailchimpAstAnalyticsRowIds: options.failedMailchimpAstAnalyticsRowIds,
    previousMailchimpAstAnalyticsRows: options.previousMailchimpAstAnalyticsRows,
    requireMailchimpAstAnalyticsAcceptance: options.requireMailchimpAstAnalyticsAcceptance,
    allowReviewMailchimpAstAnalyticsExport: options.allowReviewMailchimpAstAnalyticsExport,
  });
  const mailchimpAstAnalyticsExportDiagnostics = createMailchimpAstAnalyticsExportDiagnostics(
    mailchimpAstAnalyticsExportBundle,
    {
      rangeByAstAnalyticsRowId: options.rangeByMailchimpAstAnalyticsRowId,
    },
  );
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
    tenantPermissionDecision: mailchimpTenantPermissionDecision,
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
  const mailchimpRuntimeRequest = createMailchimpClientRuntimeRequestContract(mailchimpRuntimeTargets, {
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
    mailchimpRuntimeRequest: options.mailchimpRuntimeRequest,
    clientRequest: options.clientRequest,
    clientRequestId: options.clientRequestId,
    sessionId: options.sessionId,
    workspaceId: options.workspaceId ?? options.mailchimpTenantPermissions?.workspaceId ?? options.tenantPermissions?.workspaceId,
    tenantId: options.tenantId ?? options.mailchimpTenantPermissions?.tenantId ?? options.tenantPermissions?.tenantId,
    route: options.clientRoute ?? options.mailchimpClientRoute,
    role: options.role ?? options.permissionRole,
    acceptedMailchimpRuntimeRequestTargetIds: options.acceptedMailchimpRuntimeRequestTargetIds,
    completedMailchimpRuntimeRequestTargetIds: options.completedMailchimpRuntimeRequestTargetIds,
    failedMailchimpRuntimeRequestTargetIds: options.failedMailchimpRuntimeRequestTargetIds,
    requireMailchimpRuntimeRequestAcceptance: options.requireMailchimpRuntimeRequestAcceptance,
    allowReviewMailchimpRuntimeRequest: options.allowReviewMailchimpRuntimeRequest,
  });
  const mailchimpRuntimeRequestDiagnostics = createMailchimpClientRuntimeAdoptionDiagnostics(
    mailchimpRuntimeRequest,
    {
      rangeByRuntimeRowId: options.rangeByMailchimpRuntimeRequestRowId,
      rangeByRuntimeRequestId: options.rangeByMailchimpRuntimeRequestId,
    },
  );
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
      {
        id: "mailchimp-runtime-request",
        kind: "mailchimpRuntimeRequest",
        status: mailchimpRuntimeRequest.status,
        label: "Mailchimp runtime request",
        detail: `${mailchimpRuntimeRequest.totals.rowCount} runtime request rows bound to the client session.`,
        handoff: mailchimpRuntimeRequest.restartEnvelope.route,
        nextAction: mailchimpRuntimeRequest.restartEnvelope.nextAction,
        restartSafe: mailchimpRuntimeRequest.restartEnvelope.restartSafe,
        idempotencyKey: mailchimpRuntimeRequest.syncKey,
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
  const mailchimpAstExportResumeLedger = createMailchimpAstExportResumeLedger(ast, {
    ...mailchimpOptions,
    fileName: plan.fileName,
    revision: options.revision,
    astEvidence: astExportEvidence,
    astExportBatchSummary,
    acceptedMailchimpAstExportLaneIds: options.acceptedMailchimpAstExportLaneIds,
    completedMailchimpAstExportLaneIds: options.completedMailchimpAstExportLaneIds,
    retryMailchimpAstExportLaneIds: options.retryMailchimpAstExportLaneIds,
    requireMailchimpAstExportLaneAcceptance: options.requireMailchimpAstExportLaneAcceptance,
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
  const mailchimpAstExportCheckpointReport = createMailchimpAstExportCheckpointReport(ast, {
    ...mailchimpOptions,
    fileName: plan.fileName,
    revision: options.revision,
    astEvidence: astExportEvidence,
    astExportBatchSummary,
    astExportResumeLedger: mailchimpAstExportResumeLedger,
    campaignExportQueue: mailchimpCampaignExportQueue,
    acceptedMailchimpAstCheckpointIds: options.acceptedMailchimpAstCheckpointIds,
    completedMailchimpAstCheckpointIds: options.completedMailchimpAstCheckpointIds,
    requireMailchimpAstCheckpointAcceptance: options.requireMailchimpAstCheckpointAcceptance,
    requireMailchimpAstCheckpointCompletion: options.requireMailchimpAstCheckpointCompletion,
    allowReviewCheckpointExport: options.allowReviewCheckpointExport,
  });
  const sourceProviderExportSummary = createSourceRangeProviderExportSummary({
    providerContract,
    persistence: sourcePersistence,
    manifest: sourceExportManifest,
    boundaryAudit: sourceBoundaryAudit,
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
  const mailchimpProviderSourceDeployment = createMailchimpProviderSourceDeploymentPacket({
    mailchimpSourceAnchorHandoff,
    mailchimpProviderServiceReadinessMatrix,
    mailchimpProviderServiceHandoff,
    mailchimpProviderServiceHandoffExportDeck,
    sourceProviderExportSummary,
  }, {
    fileName: plan.fileName,
    providerId: mailchimpHandoff.providerId,
    revision: options.revision,
    acceptedMailchimpProviderSourceDeploymentIds: options.acceptedMailchimpProviderSourceDeploymentIds,
    completedMailchimpProviderSourceDeploymentIds: options.completedMailchimpProviderSourceDeploymentIds,
    failedMailchimpProviderSourceDeploymentIds: options.failedMailchimpProviderSourceDeploymentIds,
    requireMailchimpProviderSourceDeploymentAcceptance: options.requireMailchimpProviderSourceDeploymentAcceptance,
    allowReviewMailchimpProviderSourceDeployment: options.allowReviewMailchimpProviderSourceDeployment,
  });
  const mailchimpProviderSourceDeploymentDiagnostics = createMailchimpProviderSourceDeploymentDiagnostics(
    mailchimpProviderSourceDeployment,
    {
      rangeByProviderSourceDeploymentRowId: options.rangeByMailchimpProviderSourceDeploymentRowId,
      rangeByProviderServiceHandoffLaneId: options.rangeByMailchimpProviderServiceHandoffLaneId,
      rangeByService: options.rangeByMailchimpProviderService,
    },
  );
  const sourceClientAcceptanceSummary = createSourceRangeClientAcceptanceSummary({
    providerContract,
    persistence: sourcePersistence,
    manifest: sourceExportManifest,
    releasePacket: sourceReleasePacket,
    providerSummary: sourceProviderExportSummary,
    timeline: sourceOperationalTimeline,
    mailchimpSourceAnchorHandoff,
  }, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
  });
  const sourceRangeClientCommandPacket = createSourceRangeClientCommandPacket(sourceClientAcceptanceSummary, {
    revision: options.revision,
    requestedSourceCommandIds: options.requestedSourceCommandIds,
    completedSourceCommandIds: options.completedSourceCommandIds,
    failedSourceCommandIds: options.failedSourceCommandIds,
  });
  const sourceRangeClientActionDeck = createSourceRangeClientActionDeck({
    clientSummary: sourceClientAcceptanceSummary,
    commandPacket: sourceRangeClientCommandPacket,
    releasePacket: sourceReleasePacket,
    providerSummary: sourceProviderExportSummary,
  }, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
  });
  const sourceRuntimeResumePacket = createSourceRangeRuntimeResumePacket({
    clientSummary: sourceClientAcceptanceSummary,
    commandPacket: sourceRangeClientCommandPacket,
    actionDeck: sourceRangeClientActionDeck,
    boundaryAudit: sourceBoundaryAudit,
    providerSummary: sourceProviderExportSummary,
  }, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
  });
  const sourceRuntimeResumeDiagnostics = createSourceRangeRuntimeResumeDiagnostics(sourceRuntimeResumePacket, {
    rangeBySourceId: createFormatterRangeBySourceId(plan.items),
  });
  const sourceRangeFailureRecoveryState = createSourceRangeFailureRecoveryState({
    providerContract,
    persistence: sourcePersistence,
    manifest: sourceExportManifest,
    releasePacket: sourceReleasePacket,
    boundaryAudit: sourceBoundaryAudit,
    timeline: sourceOperationalTimeline,
    sourceAnchorHandoff: mailchimpSourceAnchorHandoff,
  }, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    requireSourceAnchorAcceptance: options.requireSourceAnchorAcceptance,
    sourceRangeDegradedMode: options.sourceRangeDegradedMode,
    sourceRangeRecoveryCommands: options.sourceRangeRecoveryCommands,
    queuedSourceRangeRecoveryIds: options.queuedSourceRangeRecoveryIds,
    completedSourceRangeRecoveryIds: options.completedSourceRangeRecoveryIds,
    failedSourceRangeRecoveryIds: options.failedSourceRangeRecoveryIds,
    sourceRangeAttemptByRecoveryId: options.sourceRangeAttemptByRecoveryId,
    sourceRangeMaxRetryAttempts: options.sourceRangeMaxRetryAttempts,
    sourceRangeRetryBaseSeconds: options.sourceRangeRetryBaseSeconds,
  });
  const sourceRangeFailureRecoveryDiagnostics = createSourceRangeFailureRecoveryDiagnostics(sourceRangeFailureRecoveryState, {
    rangeByRecoveryRowId: options.rangeBySourceRangeRecoveryRowId,
    rangeBySourceId: createFormatterRangeBySourceId(plan.items),
  });
  const sourceRangeRecoveryCommandExport = createSourceRangeRecoveryCommandExport(sourceRangeFailureRecoveryState, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    requestedSourceRangeRecoveryCommandIds: options.requestedSourceRangeRecoveryCommandIds
      ?? options.queuedSourceRangeRecoveryIds,
    acceptedSourceRangeRecoveryCommandIds: options.acceptedSourceRangeRecoveryCommandIds,
    completedSourceRangeRecoveryCommandIds: options.completedSourceRangeRecoveryCommandIds
      ?? options.completedSourceRangeRecoveryIds,
    failedSourceRangeRecoveryCommandIds: options.failedSourceRangeRecoveryCommandIds
      ?? options.failedSourceRangeRecoveryIds,
    requireSourceRangeRecoveryCommandAcceptance: options.requireSourceRangeRecoveryCommandAcceptance,
    allowReviewSourceRangeRecoveryCommands: options.allowReviewSourceRangeRecoveryCommands,
  });
  const sourceRangeRecoveryCommandExportDiagnostics = createSourceRangeRecoveryCommandExportDiagnostics(
    sourceRangeRecoveryCommandExport,
    {
      rangeByRecoveryCommandId: options.rangeBySourceRangeRecoveryCommandId,
      rangeByRecoveryRowId: options.rangeBySourceRangeRecoveryRowId,
      rangeBySourceId: createFormatterRangeBySourceId(plan.items),
    },
  );
  const sourceRangeRecoveryReadinessDigest = createSourceRangeRecoveryReadinessDigest({
    recoveryState: sourceRangeFailureRecoveryState,
    commandExport: sourceRangeRecoveryCommandExport,
  }, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    acknowledgedSourceRangeRecoveryDigestIds: options.acknowledgedSourceRangeRecoveryDigestIds
      ?? options.acceptedSourceRangeRecoveryDigestIds,
    requireSourceRangeRecoveryDigestAcknowledgement: options.requireSourceRangeRecoveryDigestAcknowledgement,
    allowReviewSourceRangeRecoveryDigest: options.allowReviewSourceRangeRecoveryDigest,
  });
  const sourceClientWorkflowHandoffQueue = createSourceRangeClientWorkflowHandoffQueue({
    clientSummary: sourceClientAcceptanceSummary,
    commandPacket: sourceRangeClientCommandPacket,
    actionDeck: sourceRangeClientActionDeck,
    runtimeResume: sourceRuntimeResumePacket,
  }, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    requireSourceWorkflowQueueAcceptance: options.requireSourceWorkflowQueueAcceptance,
    acceptedSourceWorkflowQueueIds: options.acceptedSourceWorkflowQueueIds,
    completedSourceWorkflowQueueIds: options.completedSourceWorkflowQueueIds,
    failedSourceWorkflowQueueIds: options.failedSourceWorkflowQueueIds,
    retrySourceWorkflowQueueIds: options.retrySourceWorkflowQueueIds,
  });
  const sourceClientRouteHandoffPacket = createSourceRangeClientRouteHandoffPacket({
    clientSummary: sourceClientAcceptanceSummary,
    commandPacket: sourceRangeClientCommandPacket,
    actionDeck: sourceRangeClientActionDeck,
    runtimeResume: sourceRuntimeResumePacket,
    workflowQueue: sourceClientWorkflowHandoffQueue,
  }, {
    fileName: plan.fileName,
    providerId: options.providerId ?? "aios-formatter-preview",
    revision: options.revision,
    requireSourceClientRouteAcceptance: options.requireSourceClientRouteAcceptance,
    acceptedSourceClientRouteIds: options.acceptedSourceClientRouteIds,
    completedSourceClientRouteIds: options.completedSourceClientRouteIds,
    failedSourceClientRouteIds: options.failedSourceClientRouteIds,
    allowReviewSourceClientRouteHandoff: options.allowReviewSourceClientRouteHandoff,
  });
  const sourceClientRouteHandoffDiagnostics = createSourceRangeClientRouteHandoffDiagnostics(
    sourceClientRouteHandoffPacket,
    {
      rangeByRouteId: options.rangeBySourceClientRouteId,
      rangeBySourceId: createFormatterRangeBySourceId(plan.items),
    },
  );
  const mailchimpPreviewActionStrip = createMailchimpPreviewActionStrip({
    routePacket: sourceClientRouteHandoffPacket,
    actionDeck: sourceRangeClientActionDeck,
    workflowQueue: sourceClientWorkflowHandoffQueue,
  }, {
    fileName: plan.fileName,
    providerId: mailchimpHandoff.providerId,
    revision: options.revision,
    mailchimpLifecycleCommandState,
    mailchimpCampaignControlPlane,
    acceptedMailchimpPreviewActionIds: options.acceptedMailchimpPreviewActionIds,
    completedMailchimpPreviewActionIds: options.completedMailchimpPreviewActionIds,
    failedMailchimpPreviewActionIds: options.failedMailchimpPreviewActionIds,
    requireMailchimpPreviewActionAcceptance: options.requireMailchimpPreviewActionAcceptance,
    allowReviewMailchimpPreviewActionStrip: options.allowReviewMailchimpPreviewActionStrip,
  });
  const mailchimpPreviewActionStripDiagnostics = createMailchimpPreviewActionStripDiagnostics(
    mailchimpPreviewActionStrip,
    {
      rangeByActionId: options.rangeByMailchimpPreviewActionId,
      rangeByJobName: mailchimpRangeByJobName,
      rangeBySourceId: createFormatterRangeBySourceId(plan.items),
    },
  );
  const diagnosticCommandSummary = createDiagnosticLifecycleCommandSummary(validationSummary.diagnostics, {
    ...(options.diagnosticLifecycle ?? {}),
    lifecycle: diagnosticClientState.lifecycle,
    exportState: diagnosticExportState,
    mailchimpWorkflowPreview,
  });
  const mailchimpDiagnosticCheckpointControls = createMailchimpDiagnosticCheckpointControls(
    validationSummary.diagnostics,
    mailchimpAstExportCheckpointReport,
    {
      ...(options.diagnosticLifecycle ?? {}),
      fileName: plan.fileName,
      revision: options.revision,
      lifecycle: diagnosticClientState.lifecycle,
      requestedCheckpointCommandIds: options.requestedMailchimpCheckpointCommandIds,
      completedCheckpointCommandIds: options.completedMailchimpCheckpointCommandIds,
      failedCheckpointCommandIds: options.failedMailchimpCheckpointCommandIds,
      allowReviewCheckpointExport: options.allowReviewCheckpointExport,
    },
  );
  const diagnosticClientRuntimeAdoption = createDiagnosticClientRuntimeAdoptionState(validationSummary.diagnostics, {
    ...(options.diagnosticLifecycle ?? {}),
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
    clientState: diagnosticClientState,
    exportState: diagnosticExportState,
    persistedResume: diagnosticPersistedResumeState,
    sourceCommandPacket: sourceRangeClientCommandPacket,
    mailchimpWorkflowPreview,
  });
  const diagnosticProviderActionDeck = createDiagnosticProviderActionDeck({
    diagnostics: [
      ...validationSummary.diagnostics,
      ...mailchimpRuntimeRequestDiagnostics,
      ...sourceRuntimeResumeDiagnostics,
      ...sourceRangeFailureRecoveryDiagnostics,
      ...sourceRangeRecoveryCommandExportDiagnostics,
      ...sourceClientRouteHandoffDiagnostics,
      ...mailchimpPreviewActionStripDiagnostics,
      ...mailchimpProviderSourceDeploymentDiagnostics,
    ],
    clientState: diagnosticClientState,
    commandSummary: diagnosticCommandSummary,
    releaseChecklist: diagnosticReleaseChecklist,
    adoptionState: diagnosticClientRuntimeAdoption,
    providerHandoff: mailchimpHandoff,
  }, {
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
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
    mailchimpServiceSyncCheckpoint,
    mailchimpTenantBoundary,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    mailchimpSourceAnchorHandoff,
    sourceClientAcceptanceSummary,
    sourceRangeClientCommandPacket,
    sourceRuntimeResumePacket,
    diagnosticClientRuntimeAdoption,
    mailchimpAstExportCheckpointReport,
    mailchimpDiagnosticCheckpointControls,
    mailchimpScheduleWindowRuntime,
    sourceOperationalTimeline,
    formatterLifecycle,
    persistedState,
    mailchimpRuntimeRequest,
  }, options);
  const mailchimpCampaignReleaseContract = createMailchimpCampaignReleaseContract({
    workflowPreview: mailchimpWorkflowPreview,
    handoff: mailchimpHandoff,
    launchGate: mailchimpLaunchGate,
    launchHandoff: mailchimpLaunchHandoff,
    runtimeTargets: mailchimpRuntimeTargets,
    runtimeRequest: mailchimpRuntimeRequest,
    astBatch: astExportBatchSummary,
    astResume: mailchimpAstExportResumeLedger,
    campaignQueue: mailchimpCampaignExportQueue,
    sourceAnchors: mailchimpSourceAnchorHandoff,
    sourceProvider: sourceProviderExportSummary,
    sourceClientAcceptance: sourceClientAcceptanceSummary,
    sourceCommands: sourceRangeClientCommandPacket,
    diagnostics: diagnosticCommandSummary,
    diagnosticClientRuntimeAdoption,
    scheduleWindow: mailchimpScheduleWindowRuntime,
    exportDecision: mailchimpExportDecision,
    formatterLifecycle,
    providerIncident: mailchimpProviderIncidentContract,
  }, {
    revision: options.revision,
    externalRunId: options.externalRunId,
    releaseId: options.mailchimpReleaseId,
    acceptedMailchimpReleaseLaneIds: options.acceptedMailchimpReleaseLaneIds,
    requiredMailchimpReleaseLaneIds: options.requiredMailchimpReleaseLaneIds,
    requireMailchimpReleaseAcceptance: options.requireMailchimpReleaseAcceptance,
  });
  const mailchimpCampaignReleaseDiagnostics = createMailchimpCampaignReleaseDiagnostics(mailchimpCampaignReleaseContract);
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
    mailchimpServiceSyncCheckpoint,
    mailchimpTenantBoundary,
    mailchimpLaunchHandoff,
    mailchimpRuntimeTargets,
    mailchimpRuntimeRequest,
    persistedState,
    astExportEvidence,
    sourceExportManifest,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    astExportBatchSummary,
    mailchimpAstExportResumeLedger,
    mailchimpCampaignExportQueue,
    sourceProviderExportSummary,
    diagnosticCommandSummary,
    mailchimpExportDecision,
    mailchimpScheduleWindowRuntime,
    sourceClientAcceptanceSummary,
    sourceRangeClientActionDeck,
    sourceRangeClientCommandPacket,
    sourceRuntimeResumePacket,
    sourceRangeFailureRecoveryState,
    sourceRangeRecoveryCommandExport,
    sourceClientWorkflowHandoffQueue,
    diagnosticClientRuntimeAdoption,
    diagnosticProviderActionDeck,
    formatterLifecycle,
    mailchimpAstExportCheckpointReport,
    mailchimpDiagnosticCheckpointControls,
    mailchimpCampaignReleaseContract,
    mailchimpCampaignReleaseDiagnostics,
  }, options);
  const mailchimpRuntimeResumePacket = createFormatterMailchimpRuntimeResumePacket({
    mailchimpReleaseReadiness,
    mailchimpRuntimeTargets,
    mailchimpRuntimeRequest,
    sourceBoundaryAudit,
    diagnosticPersistedResumeState,
    sourceOperationalTimeline,
    mailchimpSourceAnchorHandoff,
    persistedState,
    sourceReleasePacket,
    mailchimpLaunchHandoff,
    mailchimpHandoff,
    mailchimpServiceSyncCheckpoint,
    mailchimpTenantBoundary,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    mailchimpExportDecision,
    mailchimpScheduleWindowRuntime,
    sourceClientAcceptanceSummary,
    mailchimpCampaignReleaseContract,
    mailchimpRuntimeRequest,
  });
  const mailchimpReviewBoard = createFormatterMailchimpReviewBoardContract({
    validationSummary,
    diagnosticClientState,
    diagnosticCommandSummary,
    diagnosticReleaseChecklist,
    mailchimpWorkflowPreview,
    mailchimpHandoff,
    mailchimpServiceSyncCheckpoint,
    mailchimpReleaseReadiness,
    mailchimpRuntimeResumePacket,
    mailchimpExportDecision,
    mailchimpCampaignExportQueue,
    mailchimpScheduleWindowRuntime,
    mailchimpSourceAnchorHandoff,
    mailchimpCampaignReleaseContract,
    mailchimpRuntimeRequest,
    sourceClientAcceptanceSummary,
    sourceRangeClientCommandPacket,
    sourceRangeClientActionDeck,
    sourceRuntimeResumePacket,
    diagnosticClientRuntimeAdoption,
    diagnosticProviderActionDeck,
    sourceProviderExportSummary,
    sourceOperationalTimeline,
    persistedState,
  }, options);
  const diagnosticHandoffGate = createDiagnosticHandoffAcceptanceGate({
    reviewBoard: mailchimpReviewBoard.diagnosticRows,
    providerActionDeck: diagnosticProviderActionDeck,
    releaseChecklist: diagnosticReleaseChecklist,
    persistedResume: diagnosticPersistedResumeState,
    commandSummary: diagnosticCommandSummary,
    adoptionState: diagnosticClientRuntimeAdoption,
  }, {
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
    acceptedDiagnosticHandoffGateIds: options.acceptedDiagnosticHandoffGateIds,
    completedDiagnosticHandoffGateIds: options.completedDiagnosticHandoffGateIds,
    requireDiagnosticHandoffAcceptance: options.requireDiagnosticHandoffAcceptance,
    allowReviewDiagnosticHandoff: options.allowReviewDiagnosticHandoff,
  });
  const formatterClientRuntimeWorkflow = createFormatterClientRuntimeWorkflow({
    readiness,
    acceptance,
    formatterLifecycle,
    sourceRangeClientActionDeck,
    diagnosticProviderActionDeck,
    diagnosticHandoffGate,
    sourceRuntimeResumePacket,
    sourceClientWorkflowHandoffQueue,
    mailchimpReviewBoard,
    mailchimpCampaignReleaseContract,
    mailchimpLifecycleCommandState,
    mailchimpExportDecision,
    mailchimpScheduleWindowRuntime,
    mailchimpServiceSyncCheckpoint,
    mailchimpSourceAnchorHandoff,
    mailchimpRuntimeResumePacket,
    mailchimpCampaignControlPlane,
    mailchimpRuntimeRequest,
  }, {
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
  });
  const mailchimpClientRuntimeAdoption = createFormatterMailchimpClientRuntimeAdoptionPacket({
    formatterClientRuntimeWorkflow,
    diagnosticClientRuntimeAdoption,
    sourceClientWorkflowHandoffQueue,
    sourceRangeClientActionDeck,
    sourceRuntimeResumePacket,
    mailchimpCampaignReleaseContract,
    mailchimpRuntimeResumePacket,
    mailchimpScheduleWindowRuntime,
    mailchimpLifecycleCommandState,
    formatterLifecycle,
    readiness,
    acceptance,
    mailchimpRuntimeRequest,
  }, {
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
    acceptedMailchimpClientRuntimeAdoptionRowIds: options.acceptedMailchimpClientRuntimeAdoptionRowIds,
    completedMailchimpClientRuntimeAdoptionRowIds: options.completedMailchimpClientRuntimeAdoptionRowIds,
    failedMailchimpClientRuntimeAdoptionRowIds: options.failedMailchimpClientRuntimeAdoptionRowIds,
    requireMailchimpClientRuntimeAdoptionAcceptance: options.requireMailchimpClientRuntimeAdoptionAcceptance,
  });
  const mailchimpClientRuntimeAdoptionDiagnostics = createMailchimpClientRuntimeAdoptionDiagnostics(
    mailchimpClientRuntimeAdoption,
    {
      rangeByRuntimeRowId: options.rangeByMailchimpClientRuntimeAdoptionRowId,
      rangeByLaneId: options.rangeByMailchimpClientRuntimeLaneId,
    },
  );
  const mailchimpClientRuntimeCheckpoint = createMailchimpClientRuntimeHandoffCheckpoint({
    mailchimpRuntimeRequest,
    mailchimpClientRuntimeAdoption,
    formatterClientRuntimeWorkflow,
  }, {
    fileName: plan.fileName,
    revision: options.revision,
    acceptedMailchimpClientRuntimeCheckpointIds: options.acceptedMailchimpClientRuntimeCheckpointIds,
    completedMailchimpClientRuntimeCheckpointIds: options.completedMailchimpClientRuntimeCheckpointIds,
    failedMailchimpClientRuntimeCheckpointIds: options.failedMailchimpClientRuntimeCheckpointIds,
    requireMailchimpClientRuntimeCheckpointAcceptance: options.requireMailchimpClientRuntimeCheckpointAcceptance,
    allowReviewMailchimpClientRuntimeCheckpoint: options.allowReviewMailchimpClientRuntimeCheckpoint,
  });
  const mailchimpClientRuntimeCheckpointDiagnostics = createMailchimpClientRuntimeAdoptionDiagnostics(
    mailchimpClientRuntimeCheckpoint,
    {
      rangeByRuntimeRowId: options.rangeByMailchimpClientRuntimeCheckpointRowId,
      rangeByLaneId: options.rangeByMailchimpClientRuntimeCheckpointLaneId,
    },
  );
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
    mailchimpPersistedCommandEnvelope,
    mailchimpProviderServiceReadinessMatrix,
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
    mailchimpAstExportResumeLedger,
    mailchimpCampaignExportQueue,
    sourceProviderExportSummary,
    sourceRangeRecoveryCommandExport,
    sourceRangeRecoveryReadinessDigest,
    diagnosticCommandSummary,
    mailchimpExportDecision,
    mailchimpScheduleWindowRuntime,
    sourceClientAcceptanceSummary,
    sourceRangeClientCommandPacket,
    sourceRuntimeResumePacket,
    sourceClientWorkflowHandoffQueue,
    diagnosticClientRuntimeAdoption,
    diagnosticHandoffGate,
    formatterLifecycle,
    mailchimpReviewBoard,
    mailchimpCampaignReleaseContract,
    mailchimpAstExportCheckpointReport,
    mailchimpDiagnosticCheckpointControls,
    mailchimpClientRuntimeAdoption,
    mailchimpAstAnalyticsExportBundle,
  }, options);
  const analyticsExportReport = createFormatterAnalyticsExportReport(analyticsReport, {
    readiness,
    acceptance,
    formatterLifecycle,
    persistedState,
    exportEvidence: null,
    sourceOperationalTimeline,
    sourceProviderExportSummary,
    sourceRangeRecoveryReadinessDigest,
    diagnosticCommandSummary,
    diagnosticHandoffGate,
    mailchimpReviewBoard,
    mailchimpCampaignReleaseContract,
    mailchimpDiagnosticCheckpointControls,
    mailchimpAstAnalyticsExportBundle,
    mailchimpHandoff,
    mailchimpPersistedCommandEnvelope,
  }, options);
  const analyticsExportDiagnostics = createFormatterAnalyticsExportDiagnostics(analyticsExportReport);
  const mailchimpWorkflowHandoffReadiness = createMailchimpWorkflowHandoffReadinessPacket({
    workflowPreview: mailchimpWorkflowPreview,
    providerHandoff: mailchimpHandoff,
    sourceAnchors: mailchimpSourceAnchorHandoff,
    launchGate: mailchimpLaunchHandoff,
    runtimeTargets: mailchimpRuntimeTargets,
    runtimeRequest: mailchimpRuntimeRequest,
    diagnosticHandoffGate,
    tenantBoundary: mailchimpTenantBoundary,
    campaignRelease: mailchimpCampaignReleaseContract,
  }, {
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
    acceptedMailchimpHandoffReadinessLaneIds: options.acceptedMailchimpHandoffReadinessLaneIds,
    requireMailchimpHandoffReadinessAcceptance: options.requireMailchimpHandoffReadinessAcceptance,
  });
  const mailchimpWorkflowHandoffReadinessDiagnostics = createMailchimpWorkflowHandoffReadinessDiagnostics(
    mailchimpWorkflowHandoffReadiness,
    {
      rangeByLaneId: options.rangeByMailchimpHandoffReadinessLaneId,
    },
  );
  const preliminaryFormatterProductSliceReadiness = createFormatterProductSliceReadinessPacket({
    analyticsExportReport,
    sourceProviderExportSummary,
    sourceOperationalTimeline,
    sourceReleasePacket,
    sourceRangeRecoveryReadinessDigest,
    diagnosticHandoffGate,
    diagnosticClientRuntimeAdoption,
    formatterLifecycle,
    mailchimpProviderServiceHandoff,
    mailchimpProviderServiceHandoffExportDeck,
    mailchimpProviderSourceDeployment,
    mailchimpCampaignControlPlane,
    mailchimpPersistedCommandEnvelope,
    mailchimpWorkflowHandoffReadiness,
    mailchimpClientRuntimeAdoption,
    mailchimpClientRuntimeCheckpoint,
    mailchimpRuntimeRequest,
    mailchimpCampaignReleaseContract,
    mailchimpAstAnalyticsExportBundle,
    exportEvidence: null,
  }, {
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
    acceptedFormatterProductSliceReadinessRowIds: options.acceptedFormatterProductSliceReadinessRowIds,
    completedFormatterProductSliceReadinessRowIds: options.completedFormatterProductSliceReadinessRowIds,
    failedFormatterProductSliceReadinessRowIds: options.failedFormatterProductSliceReadinessRowIds,
    requireFormatterProductSliceReadinessAcceptance: options.requireFormatterProductSliceReadinessAcceptance,
    allowReviewFormatterProductSliceReadiness: options.allowReviewFormatterProductSliceReadiness,
  });
  const effectiveStatus = mailchimpSourceAnchorHandoff.status === "blocked"
    ? "blocked"
    : mailchimpProviderSourceDeployment.status === "blocked"
      ? "blocked"
    : mailchimpServiceSyncCheckpoint.status === "blocked"
      ? "blocked"
    : mailchimpProviderServiceReadinessMatrix.status === "blocked"
      ? "blocked"
    : mailchimpProviderServiceHandoff.status === "blocked"
      ? "blocked"
    : mailchimpTenantPermissionDecision.status === "blocked"
      ? "blocked"
    : formatterLifecycle.status === "blocked" || formatterLifecycle.status === "disabled"
      ? "blocked"
    : analyticsExportReport.status === "blocked"
      ? "blocked"
    : mailchimpAstAnalyticsExportBundle.status === "blocked"
      ? "blocked"
    : mailchimpCampaignControlPlane.status === "blocked"
      ? "blocked"
    : mailchimpPersistedCommandEnvelope.status === "blocked"
      ? "blocked"
    : mailchimpWorkflowHandoffReadiness.status === "blocked"
      ? "blocked"
    : preliminaryFormatterProductSliceReadiness.status === "blocked"
      ? "blocked"
    : sourceClientAcceptanceSummary.status === "blocked"
      ? "blocked"
    : sourceRangeClientCommandPacket.status === "blocked"
      ? "blocked"
    : sourceRangeClientActionDeck.status === "blocked"
      ? "blocked"
    : sourceRuntimeResumePacket.status === "blocked"
      ? "blocked"
    : sourceRangeFailureRecoveryState.status === "blocked"
      ? "blocked"
    : sourceRangeRecoveryCommandExport.status === "blocked"
      ? "blocked"
    : sourceRangeRecoveryReadinessDigest.status === "blocked"
      ? "blocked"
    : sourceClientWorkflowHandoffQueue.status === "blocked"
      ? "blocked"
    : sourceClientRouteHandoffPacket.status === "blocked"
      ? "blocked"
    : diagnosticClientRuntimeAdoption.status === "blocked"
      ? "blocked"
    : diagnosticProviderActionDeck.status === "blocked"
      ? "blocked"
    : diagnosticHandoffGate.status === "blocked"
      ? "blocked"
    : formatterClientRuntimeWorkflow.status === "blocked"
      ? "blocked"
    : mailchimpClientRuntimeAdoption.status === "blocked"
      ? "blocked"
    : mailchimpClientRuntimeCheckpoint.status === "blocked"
      ? "blocked"
    : mailchimpRuntimeRequest.status === "blocked"
      ? "blocked"
    : mailchimpAstExportCheckpointReport.status === "blocked"
      ? "blocked"
    : mailchimpDiagnosticCheckpointControls.status === "blocked"
      ? "blocked"
    : mailchimpExportDecision.status === "blocked"
      ? "blocked"
    : mailchimpCampaignReleaseContract.status === "blocked"
      ? "blocked"
    : mailchimpLaunchHandoff.status === "blocked"
      ? "blocked"
    : mailchimpScheduleWindowRuntime.status === "blocked"
      ? "blocked"
    : mailchimpCampaignExportQueue.status === "blocked"
      ? "blocked"
    : mailchimpAstExportResumeLedger.status === "blocked"
      ? "blocked"
    : readiness.status === "ready" && mailchimpSourceAnchorHandoff.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpProviderSourceDeployment.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpServiceSyncCheckpoint.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpProviderServiceReadinessMatrix.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpTenantPermissionDecision.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpLaunchHandoff.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpCampaignExportQueue.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpAstExportResumeLedger.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpScheduleWindowRuntime.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && sourceClientAcceptanceSummary.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && sourceRangeClientCommandPacket.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && sourceRangeClientActionDeck.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && sourceRuntimeResumePacket.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && sourceRangeFailureRecoveryState.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && sourceRangeRecoveryCommandExport.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && sourceRangeRecoveryReadinessDigest.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && sourceClientWorkflowHandoffQueue.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && sourceClientRouteHandoffPacket.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && diagnosticClientRuntimeAdoption.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && diagnosticProviderActionDeck.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && diagnosticHandoffGate.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && formatterClientRuntimeWorkflow.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpClientRuntimeAdoption.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpClientRuntimeCheckpoint.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpRuntimeRequest.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpAstExportCheckpointReport.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpDiagnosticCheckpointControls.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpExportDecision.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpCampaignReleaseContract.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && formatterLifecycle.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && analyticsExportReport.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpAstAnalyticsExportBundle.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpCampaignControlPlane.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpPersistedCommandEnvelope.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpWorkflowHandoffReadiness.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpProviderServiceHandoff.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpProviderSourceDeployment.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpWorkflowHandoffReadiness.status === "needsAcceptance"
      ? "needsAcceptance"
    : readiness.status === "ready" && preliminaryFormatterProductSliceReadiness.status === "pending"
      ? "needsAcceptance"
    : readiness.status === "ready" && mailchimpCampaignReleaseContract.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpServiceSyncCheckpoint.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpTenantPermissionDecision.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpAstExportCheckpointReport.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpDiagnosticCheckpointControls.status === "review"
      ? "review"
    : readiness.status === "ready" && sourceRangeClientActionDeck.status === "review"
      ? "review"
    : readiness.status === "ready" && sourceRuntimeResumePacket.status === "review"
      ? "review"
    : readiness.status === "ready" && (
      sourceRangeFailureRecoveryState.status === "review"
      || sourceRangeFailureRecoveryState.status === "degraded"
    )
      ? "review"
    : readiness.status === "ready" && sourceRangeRecoveryCommandExport.status === "review"
      ? "review"
    : readiness.status === "ready" && sourceRangeRecoveryReadinessDigest.status === "review"
      ? "review"
    : readiness.status === "ready" && sourceClientWorkflowHandoffQueue.status === "review"
      ? "review"
    : readiness.status === "ready" && sourceClientRouteHandoffPacket.status === "review"
      ? "review"
    : readiness.status === "ready" && diagnosticProviderActionDeck.status === "review"
      ? "review"
    : readiness.status === "ready" && diagnosticHandoffGate.status === "review"
      ? "review"
    : readiness.status === "ready" && formatterClientRuntimeWorkflow.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpClientRuntimeAdoption.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpClientRuntimeCheckpoint.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpRuntimeRequest.status === "review"
      ? "review"
    : readiness.status === "ready" && formatterLifecycle.status === "review"
      ? "review"
    : readiness.status === "ready" && analyticsExportReport.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpAstAnalyticsExportBundle.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpCampaignControlPlane.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpPersistedCommandEnvelope.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpProviderServiceHandoff.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpProviderSourceDeployment.status === "review"
      ? "review"
    : readiness.status === "ready" && mailchimpWorkflowHandoffReadiness.status === "review"
      ? "review"
    : readiness.status === "ready" && preliminaryFormatterProductSliceReadiness.status === "review"
      ? "review"
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
    mailchimpAstExportResumeLedger,
    mailchimpCampaignExportQueue,
    mailchimpScheduleWindowRuntime,
    sourceClientAcceptanceSummary,
    sourceRangeClientCommandPacket,
    sourceRuntimeResumePacket,
    sourceRangeRecoveryCommandExport,
    diagnosticClientRuntimeAdoption,
    mailchimpRuntimeRequest,
    mailchimpClientRuntimeCheckpoint,
    diagnosticHandoffGate,
    formatterLifecycle,
    mailchimpCampaignReleaseContract,
  });
  const finalFormatterProductSliceReadiness = createFormatterProductSliceReadinessPacket({
    analyticsExportReport,
    sourceProviderExportSummary,
    sourceOperationalTimeline,
    sourceReleasePacket,
    sourceRangeRecoveryCommandExport,
    sourceRangeRecoveryReadinessDigest,
    diagnosticHandoffGate,
    diagnosticClientRuntimeAdoption,
    formatterLifecycle,
    mailchimpCampaignControlPlane,
    mailchimpProviderServiceHandoff,
    mailchimpProviderServiceHandoffExportDeck,
    mailchimpProviderSourceDeployment,
    mailchimpWorkflowHandoffReadiness,
    mailchimpClientRuntimeAdoption,
    mailchimpClientRuntimeCheckpoint,
    mailchimpRuntimeRequest,
    mailchimpCampaignReleaseContract,
    exportEvidence,
    mailchimpAstAnalyticsExportBundle,
  }, {
    fileName: plan.fileName,
    revision: options.revision,
    providerId: mailchimpHandoff.providerId,
    acceptedFormatterProductSliceReadinessRowIds: options.acceptedFormatterProductSliceReadinessRowIds,
    completedFormatterProductSliceReadinessRowIds: options.completedFormatterProductSliceReadinessRowIds,
    failedFormatterProductSliceReadinessRowIds: options.failedFormatterProductSliceReadinessRowIds,
    requireFormatterProductSliceReadinessAcceptance: options.requireFormatterProductSliceReadinessAcceptance,
    allowReviewFormatterProductSliceReadiness: options.allowReviewFormatterProductSliceReadiness,
  });
  const formatterProductSliceReadinessDiagnostics = createFormatterProductSliceReadinessDiagnostics(
    finalFormatterProductSliceReadiness,
    {
      rangeByReadinessRowId: options.rangeByFormatterProductSliceReadinessRowId,
      rangeByLaneId: options.rangeByFormatterProductSliceLaneId,
    },
  );

  return Object.freeze({
    ok: readiness.status === "ready"
      && acceptance.acceptable
      && mailchimpSourceAnchorHandoff.exportAllowed
      && mailchimpServiceSyncCheckpoint.exportAllowed
      && mailchimpProviderServiceReadinessMatrix.exportAllowed
      && mailchimpProviderServiceHandoff.exportAllowed
      && mailchimpProviderServiceHandoffExportDeck.exportAllowed
      && mailchimpProviderSourceDeployment.exportAllowed
      && sourceClientAcceptanceSummary.exportAllowed
      && sourceRangeClientCommandPacket.exportAllowed
      && sourceRangeClientActionDeck.exportAllowed
      && sourceRuntimeResumePacket.exportAllowed
      && sourceRangeFailureRecoveryState.exportAllowed
      && sourceRangeRecoveryCommandExport.exportAllowed
      && sourceRangeRecoveryReadinessDigest.exportAllowed
      && sourceClientWorkflowHandoffQueue.exportAllowed
      && sourceClientRouteHandoffPacket.exportAllowed
      && mailchimpPreviewActionStrip.exportAllowed
      && diagnosticClientRuntimeAdoption.exportAllowed
      && diagnosticProviderActionDeck.exportAllowed
      && diagnosticHandoffGate.exportAllowed
      && formatterClientRuntimeWorkflow.exportAllowed
      && mailchimpClientRuntimeAdoption.exportAllowed
      && mailchimpClientRuntimeCheckpoint.exportAllowed
      && mailchimpRuntimeRequest.exportAllowed
      && mailchimpLifecycleCommandState.exportAllowed
      && mailchimpPersistedCommandEnvelope.exportAllowed
      && mailchimpTenantPermissionDecision.exportAllowed
      && mailchimpAstExportCheckpointReport.exportAllowed
      && mailchimpDiagnosticCheckpointControls.exportAllowed
      && formatterLifecycle.exportAllowed
      && mailchimpLaunchHandoff.exportAllowed
      && mailchimpAstExportResumeLedger.exportAllowed
      && mailchimpCampaignExportQueue.exportAllowed
      && mailchimpScheduleWindowRuntime.exportAllowed
      && mailchimpExportDecision.exportAllowed
      && mailchimpCampaignReleaseContract.exportAllowed
      && analyticsExportReport.exportAllowed
      && mailchimpAstAnalyticsExportBundle.exportAllowed
      && mailchimpCampaignControlPlane.exportAllowed
      && mailchimpWorkflowHandoffReadiness.exportAllowed
      && mailchimpProviderServiceHandoffExportDeck.exportAllowed
      && finalFormatterProductSliceReadiness.exportAllowed,
    fileName: plan.fileName,
    status: effectiveStatus,
    previewItems: Object.freeze(previewItems),
    validationSummary,
    formatterLifecycle,
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
    mailchimpServiceSyncWindows: mailchimpWorkflow.providerContract?.serviceSyncWindows ?? null,
    mailchimpServiceSyncCheckpoint,
    mailchimpProviderServiceReadinessMatrix,
    mailchimpProviderServiceHandoff,
    mailchimpProviderServiceHandoffExportDeck,
    mailchimpProviderSourceDeployment,
    mailchimpProviderSourceDeploymentDiagnostics,
    mailchimpProviderServiceHandoffDiagnostics: providerServiceHandoffDiagnostics,
    mailchimpProviderServiceHandoffExportDiagnostics: providerServiceHandoffExportDiagnostics,
    mailchimpHandoff,
    mailchimpLifecycleCommandState,
    mailchimpPersistedCommandEnvelope,
    mailchimpOperationalHealthReport,
    mailchimpLaunchHandoff,
    mailchimpTenantPermissionDecision,
    mailchimpRuntimeTargets,
    mailchimpRuntimeRequest,
    mailchimpRuntimeRequestDiagnostics,
    mailchimpReleaseReadiness,
    mailchimpRuntimeResumePacket,
    mailchimpReviewBoard,
    mailchimpDiagnosticIncidentReport,
    mailchimpProviderIncidentContract,
    mailchimpSourceAnchorHandoff,
    sourceClientAcceptanceSummary,
    sourceRangeClientCommandPacket,
    sourceRangeClientActionDeck,
    sourceRuntimeResumePacket,
    sourceRangeFailureRecoveryState,
    sourceRangeFailureRecoveryDiagnostics,
    sourceRangeRecoveryCommandExport,
    sourceRangeRecoveryCommandExportDiagnostics,
    sourceRangeRecoveryReadinessDigest,
    sourceClientWorkflowHandoffQueue,
    sourceClientRouteHandoffPacket,
    sourceClientRouteHandoffDiagnostics,
    mailchimpPreviewActionStrip,
    mailchimpPreviewActionStripDiagnostics,
    sourceRuntimeResumeDiagnostics,
    astExportBatchSummary,
    mailchimpAstAnalyticsExportBundle,
    mailchimpAstAnalyticsExportDiagnostics,
    mailchimpAstExportResumeLedger,
    mailchimpAstExportCheckpointReport,
    mailchimpDiagnosticCheckpointControls,
    mailchimpCampaignExportQueue,
    mailchimpScheduleWindowRuntime,
    mailchimpCampaignControlPlane,
    mailchimpCampaignControlPlaneDiagnostics,
    mailchimpCampaignReleaseContract,
    mailchimpCampaignReleaseDiagnostics,
    mailchimpWorkflowHandoffReadiness,
    mailchimpWorkflowHandoffReadinessDiagnostics,
    formatterProductSliceReadiness: finalFormatterProductSliceReadiness,
    formatterProductSliceReadinessDiagnostics,
    sourceProviderExportSummary,
    diagnosticCommandSummary,
    diagnosticClientRuntimeAdoption,
    diagnosticProviderActionDeck,
    diagnosticHandoffGate,
    mailchimpExportDecision,
    formatterClientRuntimeWorkflow,
    mailchimpClientRuntimeAdoption,
    mailchimpClientRuntimeAdoptionDiagnostics,
    mailchimpClientRuntimeCheckpoint,
    mailchimpClientRuntimeCheckpointDiagnostics,
    persistedState,
    analyticsReport,
    analyticsExportReport,
    analyticsExportDiagnostics,
    exportEvidence,
    exportSummary: analyticsReport.exportSummary,
    nextStep: createFormatterNextStep(readiness, acceptance, validationSummary, mailchimpHandoff, {
      sourcePersistence,
      sourceOperationalTimeline,
      sourceClientAcceptanceSummary,
      sourceRangeClientCommandPacket,
      sourceRangeClientActionDeck,
      sourceRuntimeResumePacket,
      sourceRangeFailureRecoveryState,
      sourceRangeRecoveryCommandExport,
      sourceRangeRecoveryReadinessDigest,
      sourceClientWorkflowHandoffQueue,
      sourceClientRouteHandoffPacket,
      diagnosticClientRuntimeAdoption,
      diagnosticProviderActionDeck,
      diagnosticHandoffGate,
      mailchimpAstExportCheckpointReport,
      mailchimpDiagnosticCheckpointControls,
      diagnosticClientState,
      mailchimpWorkflowPreview,
      analyticsReport,
      exportEvidence,
      mailchimpLaunchHandoff,
      mailchimpProviderIncidentContract,
      mailchimpExportDecision,
      mailchimpSourceAnchorHandoff,
      mailchimpServiceSyncCheckpoint,
      mailchimpProviderServiceHandoff,
      mailchimpProviderSourceDeployment,
      mailchimpScheduleWindowRuntime,
      mailchimpCampaignControlPlane,
      mailchimpPersistedCommandEnvelope,
      formatterLifecycle,
      mailchimpCampaignReleaseContract,
      mailchimpWorkflowHandoffReadiness,
      formatterProductSliceReadiness: finalFormatterProductSliceReadiness,
      mailchimpLifecycleCommandState,
      formatterClientRuntimeWorkflow,
      mailchimpClientRuntimeAdoption,
      mailchimpClientRuntimeCheckpoint,
      mailchimpRuntimeRequest,
    }),
  });
}

export function createFormatterProductSliceReadinessPacket(state = {}, options = {}) {
  const accepted = new Set(normalizeFormatterLifecycleIdList(options.acceptedFormatterProductSliceReadinessRowIds));
  const completed = new Set(normalizeFormatterLifecycleIdList(options.completedFormatterProductSliceReadinessRowIds));
  const failed = new Set(normalizeFormatterLifecycleIdList(options.failedFormatterProductSliceReadinessRowIds));
  const requireAcceptance = options.requireFormatterProductSliceReadinessAcceptance !== false;
  const baseRows = [
    formatterProductSliceReadinessRow("analytics-export", {
      label: "Formatter analytics export",
      contract: state.analyticsExportReport,
      count: state.analyticsExportReport?.totals?.rowCount ?? 0,
      route: state.analyticsExportReport?.restartEnvelope?.route ?? "formatter/analytics/export/summary",
      handoff: "formatter-analytics-export",
      nextAction: state.analyticsExportReport?.restartEnvelope?.nextAction,
      idempotencyKey: state.analyticsExportReport?.syncKey,
    }),
    formatterProductSliceReadinessRow("mailchimp-ast-analytics", {
      label: "Mailchimp AST analytics export",
      contract: state.mailchimpAstAnalyticsExportBundle,
      count: state.mailchimpAstAnalyticsExportBundle?.totals?.rowCount ?? 0,
      route: state.mailchimpAstAnalyticsExportBundle?.restartEnvelope?.route ?? "mailchimp/ast-analytics/export",
      handoff: "mailchimp-ast-analytics-export",
      nextAction: state.mailchimpAstAnalyticsExportBundle?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpAstAnalyticsExportBundle?.syncKey,
    }),
    formatterProductSliceReadinessRow("source-provider", {
      label: "Source range provider export",
      contract: state.sourceProviderExportSummary,
      count: state.sourceProviderExportSummary?.totals?.rangeCount ?? state.sourceReleasePacket?.anchors?.length ?? 0,
      route: state.sourceProviderExportSummary?.restartEnvelope?.route ?? state.sourceReleasePacket?.restartEnvelope?.route ?? "source-ranges/provider/export",
      handoff: "source-range-provider-export",
      nextAction: state.sourceProviderExportSummary?.restartEnvelope?.nextAction ?? state.sourceReleasePacket?.restartEnvelope?.nextAction,
      idempotencyKey: state.sourceProviderExportSummary?.syncKey ?? state.sourceReleasePacket?.syncKey,
    }),
    formatterProductSliceReadinessRow("source-timeline", {
      label: "Source range operational timeline",
      contract: state.sourceOperationalTimeline,
      count: state.sourceOperationalTimeline?.totals?.eventCount ?? 0,
      route: state.sourceOperationalTimeline?.restartEnvelope?.route ?? "source-ranges/operational-timeline",
      handoff: "source-range-operational-timeline",
      nextAction: state.sourceOperationalTimeline?.restartEnvelope?.nextAction,
      idempotencyKey: state.sourceOperationalTimeline?.syncKey
        ?? state.sourceOperationalTimeline?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
    formatterProductSliceReadinessRow("source-recovery-commands", {
      label: "Source range recovery commands",
      contract: state.sourceRangeRecoveryCommandExport,
      count: state.sourceRangeRecoveryCommandExport?.totals?.commandCount ?? 0,
      route: state.sourceRangeRecoveryCommandExport?.restartEnvelope?.route ?? "source-ranges/recovery-commands/export",
      handoff: "source-range-recovery-command-export",
      nextAction: state.sourceRangeRecoveryCommandExport?.restartEnvelope?.nextAction,
      idempotencyKey: state.sourceRangeRecoveryCommandExport?.syncKey
        ?? state.sourceRangeRecoveryCommandExport?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
    formatterProductSliceReadinessRow("source-recovery-readiness", {
      label: "Source range recovery readiness",
      contract: state.sourceRangeRecoveryReadinessDigest,
      status: state.sourceRangeRecoveryReadinessDigest?.status ?? "idle",
      exportAllowed: state.sourceRangeRecoveryReadinessDigest ? undefined : true,
      restartSafe: state.sourceRangeRecoveryReadinessDigest ? undefined : true,
      count: state.sourceRangeRecoveryReadinessDigest?.totals?.rowCount ?? 0,
      route: state.sourceRangeRecoveryReadinessDigest?.restartEnvelope?.route ?? "source-ranges/recovery-readiness/export",
      handoff: "source-range-recovery-readiness",
      nextAction: state.sourceRangeRecoveryReadinessDigest?.restartEnvelope?.nextAction,
      idempotencyKey: state.sourceRangeRecoveryReadinessDigest?.syncKey
        ?? state.sourceRangeRecoveryReadinessDigest?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
    formatterProductSliceReadinessRow("diagnostic-handoff", {
      label: "Diagnostic handoff gate",
      contract: state.diagnosticHandoffGate,
      count: state.diagnosticHandoffGate?.totals?.rowCount ?? state.diagnosticHandoffGate?.totals?.gateCount ?? 0,
      route: state.diagnosticHandoffGate?.restartEnvelope?.route ?? "diagnostics/handoff",
      handoff: "diagnostic-handoff-gate",
      nextAction: state.diagnosticHandoffGate?.restartEnvelope?.nextAction,
      idempotencyKey: state.diagnosticHandoffGate?.syncKey
        ?? state.diagnosticHandoffGate?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
    formatterProductSliceReadinessRow("diagnostic-adoption", {
      label: "Diagnostic client runtime adoption",
      contract: state.diagnosticClientRuntimeAdoption,
      count: state.diagnosticClientRuntimeAdoption?.totals?.rowCount ?? 0,
      route: state.diagnosticClientRuntimeAdoption?.restartEnvelope?.route ?? "diagnostics/client-adoption",
      handoff: "diagnostic-client-runtime-adoption",
      nextAction: state.diagnosticClientRuntimeAdoption?.restartEnvelope?.nextAction,
      idempotencyKey: state.diagnosticClientRuntimeAdoption?.syncKey,
    }),
    formatterProductSliceReadinessRow("formatter-lifecycle", {
      label: "Formatter lifecycle controls",
      contract: state.formatterLifecycle,
      count: state.formatterLifecycle?.totals?.commandCount ?? 0,
      route: state.formatterLifecycle?.restartEnvelope?.route ?? "formatter/lifecycle/summary",
      handoff: "formatter-lifecycle-controls",
      nextAction: state.formatterLifecycle?.restartEnvelope?.nextAction,
      idempotencyKey: state.formatterLifecycle?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
    formatterProductSliceReadinessRow("mailchimp-control-plane", {
      label: "Mailchimp campaign control plane",
      contract: state.mailchimpCampaignControlPlane,
      count: state.mailchimpCampaignControlPlane?.totals?.rowCount ?? state.mailchimpCampaignControlPlane?.rows?.length ?? 0,
      route: state.mailchimpCampaignControlPlane?.restartEnvelope?.route ?? "mailchimp/control-plane/summary",
      handoff: "mailchimp-control-plane",
      nextAction: state.mailchimpCampaignControlPlane?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpCampaignControlPlane?.restartEnvelope?.idempotencyKeys?.join(".")
        ?? state.mailchimpCampaignControlPlane?.syncKey,
    }),
    formatterProductSliceReadinessRow("mailchimp-persisted-commands", {
      label: "Mailchimp persisted commands",
      contract: state.mailchimpPersistedCommandEnvelope,
      count: state.mailchimpPersistedCommandEnvelope?.totals?.commandCount ?? 0,
      route: state.mailchimpPersistedCommandEnvelope?.restartEnvelope?.route ?? "mailchimp/persisted-commands/export",
      handoff: "mailchimp-persisted-command-envelope",
      nextAction: state.mailchimpPersistedCommandEnvelope?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpPersistedCommandEnvelope?.syncKey
        ?? state.mailchimpPersistedCommandEnvelope?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
    formatterProductSliceReadinessRow("mailchimp-provider-service-handoff", {
      label: "Mailchimp provider service handoff",
      contract: state.mailchimpProviderServiceHandoff,
      count: state.mailchimpProviderServiceHandoff?.totals?.laneCount ?? state.mailchimpProviderServiceHandoff?.lanes?.length ?? 0,
      route: state.mailchimpProviderServiceHandoff?.restartEnvelope?.route ?? "mailchimp/provider-service-handoff/summary",
      handoff: "mailchimp-provider-service-handoff",
      nextAction: state.mailchimpProviderServiceHandoff?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpProviderServiceHandoff?.syncKey
        ?? state.mailchimpProviderServiceHandoff?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
    formatterProductSliceReadinessRow("mailchimp-provider-service-handoff-export", {
      label: "Mailchimp provider service handoff export",
      contract: state.mailchimpProviderServiceHandoffExportDeck,
      count: state.mailchimpProviderServiceHandoffExportDeck?.totals?.rowCount ?? state.mailchimpProviderServiceHandoffExportDeck?.rows?.length ?? 0,
      route: state.mailchimpProviderServiceHandoffExportDeck?.restartEnvelope?.route ?? "mailchimp/provider-service-handoff/export/summary",
      handoff: "mailchimp-provider-service-handoff",
      nextAction: state.mailchimpProviderServiceHandoffExportDeck?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpProviderServiceHandoffExportDeck?.syncKey
        ?? state.mailchimpProviderServiceHandoffExportDeck?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
    formatterProductSliceReadinessRow("mailchimp-provider-source-deployment", {
      label: "Mailchimp provider source deployment",
      contract: state.mailchimpProviderSourceDeployment,
      count: state.mailchimpProviderSourceDeployment?.totals?.rowCount ?? state.mailchimpProviderSourceDeployment?.rows?.length ?? 0,
      route: state.mailchimpProviderSourceDeployment?.restartEnvelope?.route ?? "mailchimp/provider-source-deployment/export",
      handoff: "mailchimp-provider-source-deployment",
      nextAction: state.mailchimpProviderSourceDeployment?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpProviderSourceDeployment?.syncKey
        ?? state.mailchimpProviderSourceDeployment?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
    formatterProductSliceReadinessRow("mailchimp-handoff", {
      label: "Mailchimp workflow handoff readiness",
      contract: state.mailchimpWorkflowHandoffReadiness,
      count: state.mailchimpWorkflowHandoffReadiness?.totals?.laneCount ?? state.mailchimpWorkflowHandoffReadiness?.lanes?.length ?? 0,
      route: state.mailchimpWorkflowHandoffReadiness?.restartEnvelope?.route ?? "mailchimp/workflow-handoff/readiness",
      handoff: "mailchimp-workflow-handoff-readiness",
      nextAction: state.mailchimpWorkflowHandoffReadiness?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpWorkflowHandoffReadiness?.syncKey,
    }),
    formatterProductSliceReadinessRow("mailchimp-client-adoption", {
      label: "Mailchimp client runtime adoption",
      contract: state.mailchimpClientRuntimeAdoption,
      count: state.mailchimpClientRuntimeAdoption?.totals?.rowCount ?? 0,
      route: state.mailchimpClientRuntimeAdoption?.restartEnvelope?.route ?? "mailchimp/client-runtime-adoption",
      handoff: "mailchimp-client-runtime-adoption",
      nextAction: state.mailchimpClientRuntimeAdoption?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpClientRuntimeAdoption?.syncKey,
    }),
    formatterProductSliceReadinessRow("mailchimp-runtime-request", {
      label: "Mailchimp runtime request",
      contract: state.mailchimpRuntimeRequest,
      count: state.mailchimpRuntimeRequest?.totals?.rowCount ?? 0,
      route: state.mailchimpRuntimeRequest?.restartEnvelope?.route ?? "mailchimp/runtime-request/summary",
      handoff: "mailchimp-client-runtime-request",
      nextAction: state.mailchimpRuntimeRequest?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpRuntimeRequest?.syncKey,
    }),
    formatterProductSliceReadinessRow("mailchimp-campaign-release", {
      label: "Mailchimp campaign release",
      contract: state.mailchimpCampaignReleaseContract,
      count: state.mailchimpCampaignReleaseContract?.totals?.laneCount ?? state.mailchimpCampaignReleaseContract?.lanes?.length ?? 0,
      route: state.mailchimpCampaignReleaseContract?.restartEnvelope?.route ?? "mailchimp/campaign-release",
      handoff: "mailchimp-campaign-release",
      nextAction: state.mailchimpCampaignReleaseContract?.restartEnvelope?.nextAction,
      idempotencyKey: state.mailchimpCampaignReleaseContract?.syncKey,
    }),
    formatterProductSliceReadinessRow("formatter-export-evidence", {
      label: "Formatter export evidence",
      contract: state.exportEvidence,
      count: state.exportEvidence?.totals?.laneCount ?? state.exportEvidence?.lanes?.length ?? 0,
      route: state.exportEvidence?.restartEnvelope?.route ?? "formatter/export-evidence",
      handoff: "formatter-export-evidence",
      nextAction: state.exportEvidence?.recovery?.nextAction ?? state.exportEvidence?.exportSummary?.nextAction,
      idempotencyKey: state.exportEvidence?.syncKey,
    }),
  ];
  const rows = Object.freeze(baseRows
    .map((row) => finalizeFormatterProductSliceReadinessRow(row, {
      accepted,
      completed,
      failed,
      requireAcceptance,
    }))
    .sort(compareFormatterProductSliceReadinessRows));
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false || row.exportAllowed === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : rows.length
          ? "ready"
          : "idle";
  const reviewExportAllowed = options.allowReviewFormatterProductSliceReadiness === true;

  return Object.freeze({
    version: "formatter-product-slice-readiness.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && reviewExportAllowed),
    providerId: options.providerId ?? "mailchimp",
    fileName: options.fileName ?? "inline.aios",
    revision: options.revision ?? "working",
    syncKey: [
      options.fileName ?? "inline.aios",
      options.revision ?? "working",
      rows.map((row) => row.idempotencyKey).filter(Boolean).join(".") || "product-slice-readiness-empty",
    ].join("|"),
    requireAcceptance,
    rows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countFormatterItemsBy(rows, "status")),
      byHandoff: freezeSortedRecord(countFormatterItemsBy(rows, "handoff")),
      byRoute: freezeSortedRecord(countFormatterItemsBy(rows, "route")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptedCount: rows.filter((row) => row.accepted).length,
      completedCount: rows.filter((row) => row.completed).length,
      restartSafeCount: rows.filter((row) => row.restartSafe).length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredRowIds: Object.freeze(rows.map((row) => row.id).sort()),
      acceptedRowIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(requireAcceptance ? pending.map((row) => row.id).sort() : []),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "formatter/product-slice/recovery"
        : status === "pending"
          ? "formatter/product-slice/acceptance"
          : status === "review"
            ? "formatter/product-slice/review"
            : "formatter/product-slice/export",
      restartSafe: blocked.length === 0,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-formatter-product-slice-readiness",
    }),
    userVisible: Object.freeze({
      title: "Formatter Mailchimp product readiness",
      detail: status === "ready" || status === "idle"
        ? "Formatter analytics, source ranges, diagnostics, lifecycle controls, and Mailchimp handoff are ready for client export."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review product-slice readiness rows remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-formatter-product-slice-readiness",
    }),
  });
}

function formatterProductSliceReadinessRow(id, row = {}) {
  const contract = row.contract ?? null;
  const status = normalizeFormatterProductSliceStatus(contract?.status ?? row.status ?? "idle");
  const exportAllowed = row.exportAllowed
    ?? contract?.exportAllowed
    ?? contract?.exportSummary?.exportAllowed
    ?? status === "ready"
    ?? false;
  const restartSafe = row.restartSafe
    ?? contract?.restartEnvelope?.restartSafe
    ?? contract?.restartSafe
    ?? contract?.exportSummary?.restartSafe
    ?? status !== "blocked";

  return Object.freeze({
    id,
    laneId: row.laneId ?? id,
    label: row.label ?? id,
    status: exportAllowed === false && status === "ready" ? "blocked" : status,
    handoff: row.handoff ?? contract?.handoff ?? "formatter-product-slice-readiness",
    route: row.route ?? contract?.restartEnvelope?.route ?? "formatter/product-slice",
    detail: row.detail
      ?? contract?.userVisible?.detail
      ?? contract?.exportSummary?.nextAction
      ?? `${row.label ?? id} is ${status}.`,
    count: Number.isFinite(Number(row.count)) ? Math.max(0, Math.trunc(Number(row.count))) : 0,
    exportAllowed: exportAllowed !== false,
    restartSafe: restartSafe !== false,
    idempotencyKey: row.idempotencyKey
      ?? contract?.syncKey
      ?? contract?.restartEnvelope?.idempotencyKeys?.join(".")
      ?? `${id}:${status}`,
    nextAction: row.nextAction
      ?? contract?.restartEnvelope?.nextAction
      ?? contract?.recovery?.nextAction
      ?? contract?.exportSummary?.nextAction
      ?? selectFormatterProductSliceNextAction(id, status),
  });
}

function finalizeFormatterProductSliceReadinessRow(row, state) {
  const failed = state.failed.has(row.id);
  const completed = state.completed.has(row.id);
  const accepted = state.accepted.has(row.id) || state.requireAcceptance === false;
  const blocked = failed || row.status === "blocked" || row.restartSafe === false || row.exportAllowed === false;
  const status = blocked
    ? "blocked"
    : completed
      ? "ready"
      : state.requireAcceptance && !accepted
        ? "pending"
        : row.status === "pending" || row.status === "needsAcceptance"
          ? "pending"
          : row.status === "review" || row.status === "degraded"
            ? "review"
            : "ready";

  return Object.freeze({
    ...row,
    status,
    accepted,
    completed,
    failed,
    restartSafe: row.restartSafe !== false && !failed,
    nextAction: blocked
      ? row.nextAction ?? "repair-formatter-product-slice-readiness"
      : completed
        ? "retain-formatter-product-slice-readiness-row"
        : state.requireAcceptance && !accepted
          ? "accept-formatter-product-slice-readiness-row"
          : status === "review"
            ? "review-formatter-product-slice-readiness-row"
            : row.nextAction ?? "publish-formatter-product-slice-readiness-row",
  });
}

function normalizeFormatterProductSliceStatus(status) {
  if (status === "ready" || status === "idle" || status === "empty") return status;
  if (status === "pending" || status === "needsAcceptance" || status === "queued") return "pending";
  if (status === "blocked" || status === "failed" || status === "disabled" || status === "required") return "blocked";
  if (status === "review" || status === "degraded" || status === "unbound") return "review";
  return status ? "review" : "idle";
}

function selectFormatterProductSliceNextAction(id, status) {
  if (status === "blocked") return `repair-formatter-product-slice:${id}`;
  if (status === "pending") return `accept-formatter-product-slice:${id}`;
  if (status === "review") return `review-formatter-product-slice:${id}`;
  if (status === "idle") return `skip-formatter-product-slice:${id}`;
  return `publish-formatter-product-slice:${id}`;
}

function compareFormatterProductSliceReadinessRows(left, right) {
  return formatterProductSliceStatusOrder(left.status) - formatterProductSliceStatusOrder(right.status)
    || left.handoff.localeCompare(right.handoff)
    || left.id.localeCompare(right.id);
}

function formatterProductSliceStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    needsAcceptance: 1,
    review: 2,
    degraded: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function createFormatterMailchimpClientRuntimeAdoptionPacket(state = {}, options = {}) {
  const accepted = new Set(normalizeFormatterLifecycleIdList(options.acceptedMailchimpClientRuntimeAdoptionRowIds));
  const completed = new Set(normalizeFormatterLifecycleIdList(options.completedMailchimpClientRuntimeAdoptionRowIds));
  const failed = new Set(normalizeFormatterLifecycleIdList(options.failedMailchimpClientRuntimeAdoptionRowIds));
  const requireAcceptance = options.requireMailchimpClientRuntimeAdoptionAcceptance !== false;
  const rows = [
    ...createMailchimpClientAdoptionRowsFromFormatterLanes(state.formatterClientRuntimeWorkflow, {
      accepted,
      completed,
      failed,
      requireAcceptance,
      fileName: options.fileName,
      revision: options.revision,
    }),
    ...createMailchimpClientAdoptionRowsFromPacket("diagnostics", state.diagnosticClientRuntimeAdoption, {
      label: "Diagnostic runtime adoption",
      route: state.diagnosticClientRuntimeAdoption?.restartEnvelope?.route ?? "diagnostics/client-adoption/summary",
      accepted,
      completed,
      failed,
      requireAcceptance,
    }),
    ...createMailchimpClientAdoptionRowsFromPacket("source-workflow", state.sourceClientWorkflowHandoffQueue, {
      label: "Source workflow handoff",
      route: state.sourceClientWorkflowHandoffQueue?.restartEnvelope?.route ?? "source-ranges/client-workflow/handoff",
      accepted,
      completed,
      failed,
      requireAcceptance,
    }),
    ...createMailchimpClientAdoptionRowsFromPacket("campaign-release", state.mailchimpCampaignReleaseContract, {
      label: "Mailchimp campaign release",
      route: state.mailchimpCampaignReleaseContract?.restartEnvelope?.route ?? "mailchimp/campaign-release/export",
      accepted,
      completed,
      failed,
      requireAcceptance,
    }),
    ...createMailchimpClientAdoptionRowsFromPacket("runtime-resume", state.mailchimpRuntimeResumePacket, {
      label: "Mailchimp runtime resume",
      route: state.mailchimpRuntimeResumePacket?.restartEnvelope?.route ?? "formatter/mailchimp-runtime/resume",
      accepted,
      completed,
      failed,
      requireAcceptance,
    }),
    ...createMailchimpClientAdoptionRowsFromPacket("runtime-request", state.mailchimpRuntimeRequest, {
      label: "Mailchimp runtime request",
      route: state.mailchimpRuntimeRequest?.restartEnvelope?.route ?? "mailchimp/runtime-request/summary",
      accepted,
      completed,
      failed,
      requireAcceptance,
    }),
  ].sort(compareFormatterMailchimpClientAdoptionRows);
  const dedupedRows = Object.freeze(dedupeFormatterMailchimpClientAdoptionRows(rows));
  const blocked = dedupedRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = dedupedRows.filter((row) => row.status === "pending");
  const review = dedupedRows.filter((row) => row.status === "review" || row.status === "degraded");
  const status = blocked.length
    || state.formatterClientRuntimeWorkflow?.status === "blocked"
    || state.diagnosticClientRuntimeAdoption?.status === "blocked"
    ? "blocked"
    : pending.length
      || state.formatterClientRuntimeWorkflow?.status === "pending"
      || state.diagnosticClientRuntimeAdoption?.status === "pending"
      ? "pending"
      : review.length
        || state.formatterClientRuntimeWorkflow?.status === "review"
        || state.diagnosticClientRuntimeAdoption?.status === "review"
        ? "review"
        : dedupedRows.length
          ? "ready"
          : "idle";
  const syncKey = [
    options.fileName ?? "inline.aios",
    options.revision ?? "working",
    state.formatterClientRuntimeWorkflow?.restartEnvelope?.idempotencyKeys?.join(".") ?? "formatter-runtime-unbound",
    state.diagnosticClientRuntimeAdoption?.syncKey ?? "diagnostic-adoption-unbound",
    state.mailchimpCampaignReleaseContract?.syncKey ?? "mailchimp-release-unbound",
  ].join("|");

  return Object.freeze({
    version: "mailchimp-client-runtime-adoption.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    providerId: options.providerId ?? "mailchimp",
    fileName: options.fileName ?? "inline.aios",
    revision: options.revision ?? "working",
    syncKey,
    requireAcceptance,
    rows: dedupedRows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countFormatterItemsBy(dedupedRows, "status")),
      byOrigin: freezeSortedRecord(countFormatterItemsBy(dedupedRows, "origin")),
      byRoute: freezeSortedRecord(countFormatterItemsBy(dedupedRows, "route")),
    }),
    totals: Object.freeze({
      rowCount: dedupedRows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptedCount: dedupedRows.filter((row) => row.accepted).length,
      completedCount: dedupedRows.filter((row) => row.completed).length,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/client-runtime-adoption/recovery"
        : status === "pending"
          ? "mailchimp/client-runtime-adoption/acceptance"
          : status === "review"
            ? "mailchimp/client-runtime-adoption/review"
            : "mailchimp/client-runtime-adoption/export",
      restartSafe: blocked.length === 0
        && state.formatterClientRuntimeWorkflow?.restartEnvelope?.restartSafe !== false
        && state.diagnosticClientRuntimeAdoption?.restartEnvelope?.restartSafe !== false,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(dedupedRows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? state.formatterClientRuntimeWorkflow?.restartEnvelope?.nextAction
        ?? "publish-mailchimp-client-runtime-adoption",
    }),
    userVisible: Object.freeze({
      title: "Mailchimp client runtime adoption",
      detail: status === "ready" || status === "idle"
        ? "Mailchimp runtime, diagnostics, source, and release actions are ready for client adoption."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review client adoption rows remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-client-runtime-adoption",
    }),
  });
}

function createMailchimpClientAdoptionRowsFromFormatterLanes(workflow = {}, context = {}) {
  return (Array.isArray(workflow.lanes) ? workflow.lanes : []).map((lane) => {
    const rowId = `mailchimp-client-runtime:${lane.id}`;
    return createFormatterMailchimpClientAdoptionRow({
      id: rowId,
      laneId: lane.id,
      origin: lane.source,
      kind: lane.kind,
      sourceStatus: lane.status,
      label: lane.label,
      detail: lane.detail,
      route: lane.route,
      restartSafe: lane.restartSafe,
      exportAllowed: lane.exportAllowed,
      blockedIds: lane.blockedIds,
      pendingIds: lane.pendingIds,
      reviewIds: lane.reviewIds,
      idempotencyKey: lane.idempotencyKey ?? `${context.fileName ?? "inline.aios"}:${context.revision ?? "working"}:${lane.id}`,
      nextAction: lane.nextAction,
    }, context);
  });
}

function createMailchimpClientAdoptionRowsFromPacket(origin, packet = {}, context = {}) {
  if (!packet || typeof packet !== "object") return [];
  const rowId = `mailchimp-client-runtime:${origin}`;
  return [createFormatterMailchimpClientAdoptionRow({
    id: rowId,
    laneId: origin,
    origin,
    kind: packet.version ?? "runtimePacket",
    sourceStatus: packet.status ?? "idle",
    label: context.label,
    detail: packet.userVisible?.detail ?? `${context.label} is ${packet.status ?? "idle"}.`,
    route: packet.restartEnvelope?.route ?? context.route,
    restartSafe: packet.restartEnvelope?.restartSafe ?? packet.restartSafe,
    exportAllowed: packet.exportAllowed,
    blockedIds: packet.restartEnvelope?.blockedRowIds
      ?? packet.restartEnvelope?.blockedLaneIds
      ?? packet.restartEnvelope?.blockedQueueIds
      ?? [],
    pendingIds: packet.restartEnvelope?.pendingRowIds
      ?? packet.restartEnvelope?.pendingLaneIds
      ?? packet.restartEnvelope?.pendingQueueIds
      ?? [],
    reviewIds: packet.restartEnvelope?.reviewRowIds
      ?? packet.restartEnvelope?.reviewLaneIds
      ?? packet.restartEnvelope?.reviewQueueIds
      ?? [],
    idempotencyKey: packet.syncKey ?? packet.restartEnvelope?.idempotencyKeys?.join("|") ?? rowId,
    nextAction: packet.restartEnvelope?.nextAction ?? packet.userVisible?.nextAction,
  }, context)];
}

function createFormatterMailchimpClientAdoptionRow(row, context = {}) {
  const failed = context.failed?.has(row.id) || context.failed?.has(row.laneId);
  const completed = context.completed?.has(row.id) || context.completed?.has(row.laneId);
  const accepted = completed
    || context.accepted?.has(row.id)
    || context.accepted?.has(row.laneId)
    || context.requireAcceptance === false;
  const sourceStatus = normalizeFormatterClientRuntimeStatus(row.sourceStatus);
  const hasBlockedIds = (row.blockedIds ?? []).length > 0;
  const hasPendingIds = (row.pendingIds ?? []).length > 0;
  const hasReviewIds = (row.reviewIds ?? []).length > 0;
  const status = failed || row.restartSafe === false || row.exportAllowed === false || sourceStatus === "blocked" || hasBlockedIds
    ? "blocked"
    : completed
      ? "ready"
      : context.requireAcceptance !== false && !accepted
        ? "pending"
        : sourceStatus === "pending" || hasPendingIds
          ? "pending"
          : sourceStatus === "review" || hasReviewIds
            ? "review"
            : "ready";

  return Object.freeze({
    id: row.id,
    laneId: row.laneId,
    origin: row.origin,
    kind: row.kind,
    status,
    sourceStatus,
    label: row.label,
    detail: row.detail,
    route: row.route,
    accepted,
    completed,
    failed,
    restartSafe: row.restartSafe !== false && !failed,
    exportAllowed: row.exportAllowed !== false,
    blockedIds: Object.freeze([...(row.blockedIds ?? [])].sort()),
    pendingIds: Object.freeze([...(row.pendingIds ?? [])].sort()),
    reviewIds: Object.freeze([...(row.reviewIds ?? [])].sort()),
    idempotencyKey: row.idempotencyKey ?? row.id,
    nextAction: failed || status === "blocked"
      ? row.nextAction ?? "repair-mailchimp-client-runtime-adoption"
      : status === "pending"
        ? row.nextAction ?? "accept-mailchimp-client-runtime-adoption"
        : status === "review"
          ? row.nextAction ?? "review-mailchimp-client-runtime-adoption"
          : row.nextAction ?? "retain-mailchimp-client-runtime-adoption",
  });
}

function dedupeFormatterMailchimpClientAdoptionRows(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    const current = byId.get(row.id);
    if (!current || formatterMailchimpClientAdoptionStatusOrder(row.status) < formatterMailchimpClientAdoptionStatusOrder(current.status)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort(compareFormatterMailchimpClientAdoptionRows);
}

function compareFormatterMailchimpClientAdoptionRows(left, right) {
  return formatterMailchimpClientAdoptionStatusOrder(left.status) - formatterMailchimpClientAdoptionStatusOrder(right.status)
    || left.origin.localeCompare(right.origin)
    || left.id.localeCompare(right.id);
}

function formatterMailchimpClientAdoptionStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    degraded: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function createFormatterClientRuntimeWorkflow(state = {}, options = {}) {
  const lanes = [
    formatterClientRuntimeLane({
      id: "formatter-readiness",
      source: "formatter",
      kind: "readiness",
      status: normalizeFormatterClientRuntimeStatus(state.readiness?.status),
      label: "Formatter readiness",
      detail: `${state.readiness?.previewCount ?? 0} formatter preview items prepared.`,
      route: "formatter/readiness",
      exportAllowed: state.readiness?.exportAllowed !== false,
      restartSafe: true,
      count: state.readiness?.previewCount ?? 0,
      nextAction: state.readiness?.nextAction ?? "review-formatter-readiness",
      idempotencyKey: `${options.fileName ?? "inline.aios"}:formatter-readiness:${state.readiness?.status ?? "unbound"}`,
    }),
    formatterClientRuntimeLane({
      id: "formatter-acceptance",
      source: "formatter",
      kind: "acceptance",
      status: state.acceptance?.acceptable === false ? "pending" : "ready",
      label: "Formatter preview acceptance",
      detail: `${state.acceptance?.missingIds?.length ?? 0} formatter preview acceptances remain.`,
      route: "formatter/acceptance",
      exportAllowed: state.acceptance?.acceptable !== false,
      restartSafe: true,
      count: state.acceptance?.requiredIds?.length ?? 0,
      pendingIds: state.acceptance?.missingIds ?? [],
      nextAction: state.acceptance?.nextAction ?? "record-preview-acceptance",
      idempotencyKey: `${options.fileName ?? "inline.aios"}:formatter-acceptance:${state.acceptance?.acceptedAt ?? "pending"}`,
    }),
    formatterClientRuntimeLane({
      id: "formatter-lifecycle",
      source: "formatter",
      kind: "lifecycle",
      status: normalizeFormatterClientRuntimeStatus(state.formatterLifecycle?.status),
      label: "Formatter lifecycle",
      detail: `${state.formatterLifecycle?.totals?.commandCount ?? 0} formatter lifecycle commands available.`,
      route: state.formatterLifecycle?.restartEnvelope?.route ?? "formatter/lifecycle/summary",
      exportAllowed: state.formatterLifecycle?.exportAllowed !== false,
      restartSafe: state.formatterLifecycle?.restartEnvelope?.restartSafe !== false,
      count: state.formatterLifecycle?.totals?.commandCount ?? 0,
      blockedIds: state.formatterLifecycle?.restartEnvelope?.blockedCommandIds ?? [],
      pendingIds: state.formatterLifecycle?.restartEnvelope?.pendingCommandIds ?? [],
      nextAction: state.formatterLifecycle?.restartEnvelope?.nextAction ?? "publish-formatter-lifecycle-state",
      idempotencyKey: state.formatterLifecycle?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
    }),
    formatterClientRuntimeLane({
      id: "mailchimp-lifecycle-commands",
      source: "mailchimp",
      kind: "lifecycleCommands",
      status: normalizeFormatterClientRuntimeStatus(state.mailchimpLifecycleCommandState?.status),
      label: "Mailchimp lifecycle commands",
      detail: `${state.mailchimpLifecycleCommandState?.totals?.rowCount ?? 0} Mailchimp lifecycle command rows prepared.`,
      route: state.mailchimpLifecycleCommandState?.restartEnvelope?.route ?? "mailchimp/lifecycle-commands/summary",
      exportAllowed: state.mailchimpLifecycleCommandState?.exportAllowed !== false,
      restartSafe: state.mailchimpLifecycleCommandState?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpLifecycleCommandState?.totals?.rowCount ?? 0,
      blockedIds: state.mailchimpLifecycleCommandState?.restartEnvelope?.blockedCommandIds ?? [],
      pendingIds: state.mailchimpLifecycleCommandState?.restartEnvelope?.pendingCommandIds ?? [],
      reviewIds: state.mailchimpLifecycleCommandState?.restartEnvelope?.reviewCommandIds ?? [],
      nextAction: state.mailchimpLifecycleCommandState?.restartEnvelope?.nextAction ?? "publish-mailchimp-lifecycle-command-state",
      idempotencyKey: state.mailchimpLifecycleCommandState?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
    }),
    formatterClientRuntimeLane({
      id: "mailchimp-control-plane",
      source: "mailchimp",
      kind: "campaignControlPlane",
      status: normalizeFormatterClientRuntimeStatus(state.mailchimpCampaignControlPlane?.status),
      label: "Mailchimp campaign controls",
      detail: `${state.mailchimpCampaignControlPlane?.totals?.rowCount ?? 0} Mailchimp control-plane rows prepared.`,
      route: state.mailchimpCampaignControlPlane?.restartEnvelope?.route ?? "mailchimp/control-plane/summary",
      exportAllowed: state.mailchimpCampaignControlPlane?.exportAllowed !== false,
      restartSafe: state.mailchimpCampaignControlPlane?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpCampaignControlPlane?.totals?.rowCount ?? 0,
      blockedIds: state.mailchimpCampaignControlPlane?.restartEnvelope?.blockedRowIds ?? [],
      pendingIds: state.mailchimpCampaignControlPlane?.restartEnvelope?.pendingRowIds ?? [],
      reviewIds: state.mailchimpCampaignControlPlane?.restartEnvelope?.reviewRowIds ?? [],
      nextAction: state.mailchimpCampaignControlPlane?.restartEnvelope?.nextAction ?? "publish-mailchimp-control-plane",
      idempotencyKey: state.mailchimpCampaignControlPlane?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
    }),
    formatterClientRuntimeLane({
      id: "mailchimp-runtime-request",
      source: "mailchimp",
      kind: "runtimeRequest",
      status: normalizeFormatterClientRuntimeStatus(state.mailchimpRuntimeRequest?.status),
      label: "Mailchimp runtime request",
      detail: state.mailchimpRuntimeRequest?.userVisible?.detail ?? "Mailchimp runtime request is not bound.",
      route: state.mailchimpRuntimeRequest?.restartEnvelope?.route ?? "mailchimp/runtime-request/summary",
      exportAllowed: state.mailchimpRuntimeRequest?.exportAllowed !== false,
      restartSafe: state.mailchimpRuntimeRequest?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpRuntimeRequest?.totals?.rowCount ?? 0,
      blockedIds: state.mailchimpRuntimeRequest?.restartEnvelope?.blockedRowIds ?? [],
      pendingIds: state.mailchimpRuntimeRequest?.restartEnvelope?.pendingRowIds ?? [],
      reviewIds: state.mailchimpRuntimeRequest?.restartEnvelope?.reviewRowIds ?? [],
      nextAction: state.mailchimpRuntimeRequest?.restartEnvelope?.nextAction ?? "publish-mailchimp-runtime-request",
      idempotencyKey: state.mailchimpRuntimeRequest?.syncKey ?? null,
    }),
    formatterClientRuntimeLane({
      id: "source-actions",
      source: "sourceRange",
      kind: "clientActionDeck",
      status: normalizeFormatterClientRuntimeStatus(state.sourceRangeClientActionDeck?.status),
      label: "Source client actions",
      detail: `${state.sourceRangeClientActionDeck?.totals?.rowCount ?? 0} source actions prepared for client handoff.`,
      route: state.sourceRangeClientActionDeck?.restartEnvelope?.route ?? "source-ranges/client-actions/summary",
      exportAllowed: state.sourceRangeClientActionDeck?.exportAllowed !== false,
      restartSafe: state.sourceRangeClientActionDeck?.restartEnvelope?.restartSafe !== false,
      count: state.sourceRangeClientActionDeck?.totals?.rowCount ?? 0,
      blockedIds: state.sourceRangeClientActionDeck?.restartEnvelope?.blockedRowIds ?? [],
      pendingIds: state.sourceRangeClientActionDeck?.restartEnvelope?.pendingRowIds ?? [],
      reviewIds: state.sourceRangeClientActionDeck?.restartEnvelope?.reviewRowIds ?? [],
      nextAction: state.sourceRangeClientActionDeck?.restartEnvelope?.nextAction ?? "publish-source-range-client-actions",
      idempotencyKey: state.sourceRangeClientActionDeck?.syncKey ?? null,
    }),
    formatterClientRuntimeLane({
      id: "source-runtime-resume",
      source: "sourceRange",
      kind: "runtimeResume",
      status: normalizeFormatterClientRuntimeStatus(state.sourceRuntimeResumePacket?.status),
      label: "Source runtime resume",
      detail: `${state.sourceRuntimeResumePacket?.totals?.rowCount ?? 0} source resume rows prepared for runtime handoff.`,
      route: state.sourceRuntimeResumePacket?.restartEnvelope?.route ?? "source-ranges/runtime-resume/summary",
      exportAllowed: state.sourceRuntimeResumePacket?.exportAllowed !== false,
      restartSafe: state.sourceRuntimeResumePacket?.restartEnvelope?.restartSafe !== false,
      count: state.sourceRuntimeResumePacket?.totals?.rowCount ?? 0,
      blockedIds: state.sourceRuntimeResumePacket?.restartEnvelope?.blockedRowIds ?? [],
      pendingIds: state.sourceRuntimeResumePacket?.restartEnvelope?.pendingRowIds ?? [],
      reviewIds: state.sourceRuntimeResumePacket?.restartEnvelope?.reviewRowIds ?? [],
      nextAction: state.sourceRuntimeResumePacket?.restartEnvelope?.nextAction ?? "publish-source-range-runtime-resume",
      idempotencyKey: state.sourceRuntimeResumePacket?.syncKey ?? null,
    }),
    formatterClientRuntimeLane({
      id: "source-workflow-handoff",
      source: "sourceRange",
      kind: "workflowHandoffQueue",
      status: normalizeFormatterClientRuntimeStatus(state.sourceClientWorkflowHandoffQueue?.status),
      label: "Source workflow handoff queue",
      detail: `${state.sourceClientWorkflowHandoffQueue?.totals?.rowCount ?? 0} source workflow rows queued for client handoff.`,
      route: state.sourceClientWorkflowHandoffQueue?.restartEnvelope?.route ?? "source-ranges/client-workflow/handoff",
      exportAllowed: state.sourceClientWorkflowHandoffQueue?.exportAllowed !== false,
      restartSafe: state.sourceClientWorkflowHandoffQueue?.restartEnvelope?.restartSafe !== false,
      count: state.sourceClientWorkflowHandoffQueue?.totals?.rowCount ?? 0,
      blockedIds: state.sourceClientWorkflowHandoffQueue?.restartEnvelope?.blockedQueueIds ?? [],
      pendingIds: state.sourceClientWorkflowHandoffQueue?.restartEnvelope?.pendingQueueIds ?? [],
      reviewIds: state.sourceClientWorkflowHandoffQueue?.restartEnvelope?.reviewQueueIds ?? [],
      nextAction: state.sourceClientWorkflowHandoffQueue?.restartEnvelope?.nextAction ?? "publish-source-workflow-handoff-queue",
      idempotencyKey: state.sourceClientWorkflowHandoffQueue?.syncKey ?? null,
    }),
    formatterClientRuntimeLane({
      id: "diagnostic-provider-actions",
      source: "diagnostics",
      kind: "providerActionDeck",
      status: normalizeFormatterClientRuntimeStatus(state.diagnosticProviderActionDeck?.status),
      label: "Diagnostic provider actions",
      detail: `${state.diagnosticProviderActionDeck?.totals?.cardCount ?? 0} diagnostic provider actions prepared.`,
      route: state.diagnosticProviderActionDeck?.restartEnvelope?.route ?? "diagnostics/provider-actions/summary",
      exportAllowed: state.diagnosticProviderActionDeck?.exportAllowed !== false,
      restartSafe: state.diagnosticProviderActionDeck?.restartEnvelope?.restartSafe !== false,
      count: state.diagnosticProviderActionDeck?.totals?.cardCount ?? 0,
      blockedIds: state.diagnosticProviderActionDeck?.restartEnvelope?.blockedCardIds ?? [],
      pendingIds: state.diagnosticProviderActionDeck?.restartEnvelope?.pendingCardIds ?? [],
      reviewIds: state.diagnosticProviderActionDeck?.restartEnvelope?.reviewCardIds ?? [],
      nextAction: state.diagnosticProviderActionDeck?.restartEnvelope?.nextAction ?? "publish-diagnostic-provider-actions",
      idempotencyKey: state.diagnosticProviderActionDeck?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
    }),
    formatterClientRuntimeLane({
      id: "diagnostic-handoff-gate",
      source: "diagnostics",
      kind: "handoffAcceptanceGate",
      status: normalizeFormatterClientRuntimeStatus(state.diagnosticHandoffGate?.status),
      label: "Diagnostic handoff gate",
      detail: `${state.diagnosticHandoffGate?.totals?.gateCount ?? 0} diagnostic handoff gates evaluated.`,
      route: state.diagnosticHandoffGate?.restartEnvelope?.route ?? "diagnostics/handoff-gate/summary",
      exportAllowed: state.diagnosticHandoffGate?.exportAllowed !== false,
      restartSafe: state.diagnosticHandoffGate?.restartEnvelope?.restartSafe !== false,
      count: state.diagnosticHandoffGate?.totals?.gateCount ?? 0,
      blockedIds: state.diagnosticHandoffGate?.restartEnvelope?.blockedGateIds ?? [],
      pendingIds: state.diagnosticHandoffGate?.restartEnvelope?.pendingGateIds ?? [],
      reviewIds: state.diagnosticHandoffGate?.restartEnvelope?.reviewGateIds ?? [],
      nextAction: state.diagnosticHandoffGate?.restartEnvelope?.nextAction ?? "publish-diagnostic-handoff-gate",
      idempotencyKey: state.diagnosticHandoffGate?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
    }),
    formatterClientRuntimeLane({
      id: "mailchimp-release",
      source: "mailchimp",
      kind: "campaignRelease",
      status: normalizeFormatterClientRuntimeStatus(state.mailchimpCampaignReleaseContract?.status),
      label: "Mailchimp campaign release",
      detail: `${state.mailchimpCampaignReleaseContract?.totals?.laneCount ?? 0} Mailchimp release lanes prepared.`,
      route: state.mailchimpCampaignReleaseContract?.restartEnvelope?.route ?? "mailchimp/campaign-release/export",
      exportAllowed: state.mailchimpCampaignReleaseContract?.exportAllowed !== false,
      restartSafe: state.mailchimpCampaignReleaseContract?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpCampaignReleaseContract?.totals?.laneCount ?? 0,
      blockedIds: state.mailchimpCampaignReleaseContract?.restartEnvelope?.blockedLaneIds ?? [],
      pendingIds: state.mailchimpCampaignReleaseContract?.restartEnvelope?.pendingLaneIds ?? [],
      reviewIds: state.mailchimpCampaignReleaseContract?.restartEnvelope?.reviewLaneIds ?? [],
      nextAction: state.mailchimpCampaignReleaseContract?.restartEnvelope?.nextAction ?? "publish-mailchimp-campaign-release",
      idempotencyKey: state.mailchimpCampaignReleaseContract?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
    }),
    formatterClientRuntimeLane({
      id: "mailchimp-export-decision",
      source: "mailchimp",
      kind: "exportDecision",
      status: normalizeFormatterClientRuntimeStatus(state.mailchimpExportDecision?.status),
      label: "Mailchimp export decision",
      detail: `${state.mailchimpExportDecision?.totals?.laneCount ?? 0} export decision lanes evaluated.`,
      route: state.mailchimpExportDecision?.restartEnvelope?.route ?? "formatter/mailchimp-export/publish",
      exportAllowed: state.mailchimpExportDecision?.exportAllowed !== false,
      restartSafe: state.mailchimpExportDecision?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpExportDecision?.totals?.laneCount ?? 0,
      blockedIds: state.mailchimpExportDecision?.restartEnvelope?.blockedLaneIds ?? [],
      pendingIds: state.mailchimpExportDecision?.restartEnvelope?.pendingLaneIds ?? [],
      reviewIds: state.mailchimpExportDecision?.restartEnvelope?.reviewLaneIds ?? [],
      nextAction: state.mailchimpExportDecision?.restartEnvelope?.nextAction ?? "publish-formatter-mailchimp-export",
      idempotencyKey: state.mailchimpExportDecision?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
    }),
    formatterClientRuntimeLane({
      id: "mailchimp-schedule-window",
      source: "mailchimp",
      kind: "scheduleWindow",
      status: normalizeFormatterClientRuntimeStatus(state.mailchimpScheduleWindowRuntime?.status),
      label: "Mailchimp schedule window",
      detail: `${state.mailchimpScheduleWindowRuntime?.totals?.windowCount ?? 0} schedule windows prepared.`,
      route: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.route ?? "mailchimp/schedule-window/summary",
      exportAllowed: state.mailchimpScheduleWindowRuntime?.exportAllowed !== false,
      restartSafe: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpScheduleWindowRuntime?.totals?.windowCount ?? 0,
      blockedIds: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.blockedWindowIds ?? [],
      pendingIds: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.pendingWindowIds ?? [],
      reviewIds: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.reviewWindowIds ?? [],
      nextAction: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.nextAction ?? "publish-mailchimp-schedule-window-runtime",
      idempotencyKey: state.mailchimpScheduleWindowRuntime?.syncKey ?? null,
    }),
    formatterClientRuntimeLane({
      id: "mailchimp-service-sync-checkpoint",
      source: "mailchimp",
      kind: "serviceSyncCheckpoint",
      status: normalizeFormatterClientRuntimeStatus(state.mailchimpServiceSyncCheckpoint?.status),
      label: "Mailchimp service sync",
      detail: `${state.mailchimpServiceSyncCheckpoint?.totals?.rowCount ?? 0} service sync checkpoint rows prepared.`,
      route: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.route ?? "mailchimp/service-sync-checkpoint/summary",
      exportAllowed: state.mailchimpServiceSyncCheckpoint?.exportAllowed !== false,
      restartSafe: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpServiceSyncCheckpoint?.totals?.rowCount ?? 0,
      blockedIds: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.blockedRowIds ?? [],
      pendingIds: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.pendingRowIds ?? [],
      reviewIds: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.reviewRowIds ?? [],
      nextAction: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.nextAction ?? "publish-mailchimp-service-sync-checkpoint",
      idempotencyKey: state.mailchimpServiceSyncCheckpoint?.syncKey ?? null,
    }),
  ];
  const blocked = lanes.filter((lane) => lane.status === "blocked" || lane.exportAllowed === false || lane.restartSafe === false);
  const pending = lanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance");
  const review = lanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const sortedLanes = Object.freeze(lanes.sort(compareFormatterClientRuntimeLanes));
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "formatter-client-runtime-workflow.v1",
    status,
    ok: status === "ready" || status === "review",
    exportAllowed: status === "ready" || status === "review",
    fileName: options.fileName ?? "inline.aios",
    providerId: options.providerId ?? "mailchimp",
    revision: options.revision ?? "working",
    lanes: sortedLanes,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countFormatterItemsBy(sortedLanes, "status")),
      bySource: freezeSortedRecord(countFormatterItemsBy(sortedLanes, "source")),
      byRoute: freezeSortedRecord(countFormatterItemsBy(sortedLanes, "route")),
    }),
    totals: Object.freeze({
      laneCount: sortedLanes.length,
      blockedLaneCount: blocked.length,
      pendingLaneCount: pending.length,
      reviewLaneCount: review.length,
      blockedIdCount: sortedLanes.reduce((total, lane) => total + lane.blockedIds.length, 0),
      pendingIdCount: sortedLanes.reduce((total, lane) => total + lane.pendingIds.length, 0),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "formatter/client-runtime/recovery"
        : status === "pending"
          ? "formatter/client-runtime/acceptance"
          : status === "review"
            ? "formatter/client-runtime/review"
            : "formatter/client-runtime/export",
      restartSafe: blocked.length === 0,
      blockedLaneIds: Object.freeze(blocked.map((lane) => lane.id).sort()),
      pendingLaneIds: Object.freeze(pending.map((lane) => lane.id).sort()),
      reviewLaneIds: Object.freeze(review.map((lane) => lane.id).sort()),
      idempotencyKeys: Object.freeze(sortedLanes.map((lane) => lane.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-formatter-client-runtime-workflow",
    }),
    userVisible: Object.freeze({
      title: "Formatter client runtime workflow",
      detail: status === "ready"
        ? "Formatter, source, diagnostic, and Mailchimp release actions are ready for client handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review workflow lanes remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-formatter-client-runtime-workflow",
    }),
  });
}

function formatterClientRuntimeLane(lane) {
  return Object.freeze({
    id: lane.id,
    source: lane.source,
    kind: lane.kind,
    status: lane.status,
    label: lane.label,
    detail: lane.detail,
    route: lane.route,
    exportAllowed: lane.exportAllowed !== false,
    restartSafe: lane.restartSafe !== false,
    count: lane.count ?? 0,
    blockedIds: Object.freeze([...(lane.blockedIds ?? [])].sort()),
    pendingIds: Object.freeze([...(lane.pendingIds ?? [])].sort()),
    reviewIds: Object.freeze([...(lane.reviewIds ?? [])].sort()),
    idempotencyKey: lane.idempotencyKey ?? null,
    nextAction: lane.nextAction,
  });
}

function normalizeFormatterClientRuntimeStatus(status) {
  if (status === "blocked" || status === "failed" || status === "disabled") return "blocked";
  if (status === "pending" || status === "needsAcceptance") return "pending";
  if (status === "review" || status === "degraded") return "review";
  if (status === "idle") return "ready";
  return "ready";
}

function compareFormatterClientRuntimeLanes(left, right) {
  return left.status.localeCompare(right.status)
    || left.source.localeCompare(right.source)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
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

function formatterLifecycleCommand(command) {
  return Object.freeze({
    ...command,
    allowedStatuses: Object.freeze(command.allowedStatuses),
    requiresReason: Boolean(command.requiresReason),
  });
}

function normalizeFormatterLifecycleSettings(settings = {}) {
  const invalidReasons = [];
  const mode = normalizeFormatterLifecycleMode(settings.mode ?? (settings.dryRun ? "dryRun" : "write"), invalidReasons);
  const enabled = settings.enabled !== false && settings.disabled !== true;
  const schedule = normalizeFormatterLifecycleSchedule(settings.schedule ?? settings.formatterSchedule, {
    requireAcceptance: settings.requireScheduleAcceptance ?? settings.requireFormatterScheduleAcceptance,
    acceptedScheduleIds: settings.acceptedScheduleIds ?? settings.acceptedFormatterScheduleIds,
    invalidReasons,
  });
  const disableReason = settings.disableReason ?? settings.disabledReason ?? null;

  if (!enabled && !disableReason && settings.requireDisableReason === true) {
    invalidReasons.push("Formatter lifecycle disableReason is required when formatter export is disabled.");
  }

  return Object.freeze({
    enabled,
    mode,
    schedule,
    disableReason,
    requireScheduleAcceptance: schedule.requireAcceptance,
    requestedCommandIds: normalizeFormatterLifecycleIdList(settings.requestedCommandIds ?? settings.requestedFormatterCommandIds),
    completedCommandIds: normalizeFormatterLifecycleIdList(settings.completedCommandIds ?? settings.completedFormatterCommandIds),
    failedCommandIds: normalizeFormatterLifecycleIdList(settings.failedCommandIds ?? settings.failedFormatterCommandIds),
    invalidReasons: Object.freeze(invalidReasons),
  });
}

function normalizeFormatterLifecycleMode(mode, invalidReasons) {
  const normalized = String(mode ?? "write").trim();
  if (["write", "preview", "dryRun"].includes(normalized)) return normalized;
  invalidReasons.push(`Formatter lifecycle mode "${normalized || "unbound"}" is not supported.`);
  return "write";
}

function normalizeFormatterLifecycleSchedule(schedule = {}, context = {}) {
  const acceptedIds = new Set(normalizeFormatterLifecycleIdList(context.acceptedScheduleIds));
  const cadence = String(schedule.cadence ?? schedule.mode ?? "manual").trim();
  const supportedCadences = ["manual", "next-run", "daily", "weekly"];
  const id = String(schedule.id ?? `formatter-schedule:${cadence || "manual"}`).trim();
  const requireAcceptance = context.requireAcceptance !== false && cadence !== "manual";
  const accepted = !requireAcceptance || acceptedIds.has(id);

  if (!supportedCadences.includes(cadence)) {
    context.invalidReasons.push(`Formatter lifecycle schedule cadence "${cadence || "unbound"}" is not supported.`);
  }
  if ((cadence === "next-run" || cadence === "daily" || cadence === "weekly") && !schedule.runAt && !schedule.nextRunAt) {
    context.invalidReasons.push(`Formatter lifecycle schedule "${id}" requires runAt or nextRunAt metadata.`);
  }

  return Object.freeze({
    id,
    cadence: supportedCadences.includes(cadence) ? cadence : "manual",
    runAt: schedule.runAt ?? schedule.nextRunAt ?? null,
    timezone: schedule.timezone ?? "UTC",
    window: Object.freeze({
      mode: schedule.window?.mode ?? schedule.windowMode ?? "anytime",
      start: schedule.window?.start ?? schedule.windowStart ?? null,
      end: schedule.window?.end ?? schedule.windowEnd ?? null,
    }),
    requireAcceptance,
    accepted,
    status: context.invalidReasons.length
      ? "blocked"
      : requireAcceptance && !accepted
        ? "pending"
        : "ready",
    nextAction: requireAcceptance && !accepted
      ? "accept-formatter-lifecycle-schedule"
      : "retain-formatter-lifecycle-schedule",
  });
}

function normalizeFormatterLifecycleIdList(value) {
  return Object.freeze((Array.isArray(value) ? value : [])
    .map((id) => String(id).trim())
    .filter(Boolean)
    .sort());
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

function createFormatterReadinessState(
  validationSummary,
  previewItems,
  options,
  mailchimpHandoff,
  formatterLifecycle = null,
  serviceSyncCheckpoint = null,
) {
  const pending = previewItems.filter((item) => item.acceptanceState !== "accepted");
  const requireAcceptance = options.requirePreviewAcceptance !== false;
  const workflowBlocked = mailchimpHandoff.detected && !mailchimpHandoff.exportAllowed;
  const lifecycleStatus = formatterLifecycle?.status ?? "ready";
  const lifecycleBlocked = lifecycleStatus === "blocked" || lifecycleStatus === "disabled";
  const lifecyclePending = lifecycleStatus === "pending";
  const lifecycleReview = lifecycleStatus === "review";
  const tenantBoundaryStatus = mailchimpHandoff.syncMetadata?.tenantBoundaryStatus ?? "unbound";
  const tenantBoundaryBlocked = tenantBoundaryStatus === "blocked";
  const tenantBoundaryReview = tenantBoundaryStatus === "review";
  const operationalHealthReport = mailchimpHandoff.operationalHealth?.report ?? null;
  const operationalHealthStatus = operationalHealthReport?.status
    ?? mailchimpHandoff.operationalHealth?.status
    ?? "idle";
  const operationalHealthBlocked = operationalHealthStatus === "blocked";
  const operationalHealthReview = operationalHealthStatus === "review" || operationalHealthStatus === "degraded";
  const operationalHealthPending = operationalHealthStatus === "pending";
  const serviceSyncStatus = serviceSyncCheckpoint?.status ?? mailchimpHandoff.syncMetadata?.serviceSyncWindowStatus ?? "idle";
  const serviceSyncBlocked = serviceSyncStatus === "blocked";
  const serviceSyncPending = serviceSyncStatus === "pending";
  const serviceSyncReview = serviceSyncStatus === "review";
  const status = !validationSummary.ok
    ? "blocked"
    : lifecycleBlocked
      ? "blocked"
    : serviceSyncBlocked
      ? "blocked"
    : operationalHealthBlocked
      ? "blocked"
    : tenantBoundaryBlocked
      ? "blocked"
    : workflowBlocked
      ? "blocked"
    : lifecyclePending
      ? "needsAcceptance"
    : serviceSyncPending
      ? "needsAcceptance"
    : operationalHealthPending
      ? "needsAcceptance"
    : lifecycleReview
      ? "review"
    : serviceSyncReview
      ? "review"
    : operationalHealthReview
      ? "review"
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
      operationalHealthStatus,
      operationalHealthRoute: operationalHealthReport?.route ?? mailchimpHandoff.operationalHealth?.exportDigest?.route ?? null,
      operationalHealthActionableCount: operationalHealthReport?.totals?.actionableCount ?? 0,
      operationalHealthRetryScheduleCount: operationalHealthReport?.totals?.retryScheduleCount ?? 0,
      operationalHealthRestartSafe: operationalHealthReport?.restartSafe ?? mailchimpHandoff.operationalHealth?.restartSafe ?? true,
      serviceSyncCheckpointStatus: serviceSyncStatus,
      serviceSyncCheckpointRoute: serviceSyncCheckpoint?.restartEnvelope?.route ?? "mailchimp/service-sync-checkpoint/summary",
      serviceSyncCheckpointCount: serviceSyncCheckpoint?.totals?.rowCount ?? mailchimpHandoff.syncMetadata?.serviceSyncWindowCount ?? 0,
      serviceSyncCheckpointRestartSafe: serviceSyncCheckpoint?.restartSafe ?? true,
      nextAction: mailchimpHandoff.nextAction,
    }),
    lifecycle: Object.freeze({
      status: lifecycleStatus,
      exportAllowed: formatterLifecycle?.exportAllowed !== false,
      mode: formatterLifecycle?.settings?.mode ?? "write",
      enabled: formatterLifecycle?.settings?.enabled !== false,
      scheduleStatus: formatterLifecycle?.schedule?.status ?? "ready",
      commandCount: formatterLifecycle?.totals?.commandCount ?? 0,
      nextAction: formatterLifecycle?.restartEnvelope?.nextAction ?? "publish-formatter-lifecycle-state",
    }),
    nextAction: selectFormatterReadinessNextAction({
      status,
      lifecycleBlocked,
      lifecyclePending,
      lifecycleReview,
      serviceSyncBlocked,
      serviceSyncPending,
      serviceSyncReview,
      tenantBoundaryBlocked,
      operationalHealthBlocked,
      operationalHealthPending,
      operationalHealthReview,
      workflowBlocked,
      formatterLifecycle,
      serviceSyncCheckpoint,
      mailchimpHandoff,
      operationalHealthReport,
    }),
  });
}

function selectFormatterReadinessNextAction(state) {
  if (state.status === "blocked") {
    if (state.lifecycleBlocked) {
      return state.formatterLifecycle?.restartEnvelope?.nextAction ?? "repair-formatter-lifecycle-settings";
    }
    if (state.serviceSyncBlocked) {
      return state.serviceSyncCheckpoint?.restartEnvelope?.nextAction ?? "repair-mailchimp-service-sync-checkpoint";
    }
    if (state.operationalHealthBlocked) {
      return state.operationalHealthReport?.nextAction ?? state.mailchimpHandoff.operationalHealth?.nextAction ?? "repair-mailchimp-operational-health";
    }
    if (state.tenantBoundaryBlocked || state.workflowBlocked) return state.mailchimpHandoff.nextAction;
    return "resolve-format-preview-diagnostics";
  }
  if (state.operationalHealthPending) {
    return state.operationalHealthReport?.nextAction ?? "accept-mailchimp-provider-operation";
  }
  if (state.lifecyclePending) {
    return state.formatterLifecycle?.restartEnvelope?.nextAction ?? "accept-formatter-lifecycle-schedule";
  }
  if (state.serviceSyncPending) {
    return state.serviceSyncCheckpoint?.restartEnvelope?.nextAction ?? "accept-mailchimp-service-sync-window";
  }
  if (state.status === "review") {
    if (state.serviceSyncReview) {
      return state.serviceSyncCheckpoint?.restartEnvelope?.nextAction ?? "review-mailchimp-service-sync-window";
    }
    if (state.operationalHealthReview) {
      return state.operationalHealthReport?.nextAction ?? state.mailchimpHandoff.operationalHealth?.nextAction ?? "review-mailchimp-operational-health";
    }
    return state.lifecycleReview
      ? state.formatterLifecycle?.restartEnvelope?.nextAction ?? "review-formatter-lifecycle-dry-run"
      : state.mailchimpHandoff.nextAction;
  }
  if (state.status === "needsAcceptance") return "accept-format-preview";
  return "emit-formatted-source";
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
      id: "formatter-lifecycle",
      status: state.formatterLifecycle?.status ?? "ready",
      exportAllowed: state.formatterLifecycle?.exportAllowed !== false,
      restartSafe: state.formatterLifecycle?.restartEnvelope?.restartSafe !== false,
      route: state.formatterLifecycle?.restartEnvelope?.route ?? "formatter/lifecycle/summary",
      count: state.formatterLifecycle?.totals?.commandCount ?? 0,
      nextAction: state.formatterLifecycle?.restartEnvelope?.nextAction ?? "publish-formatter-lifecycle-state",
      idempotencyKey: state.formatterLifecycle?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
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
      id: "source-client-acceptance",
      status: state.sourceClientAcceptanceSummary.status,
      exportAllowed: state.sourceClientAcceptanceSummary.exportAllowed,
      restartSafe: state.sourceClientAcceptanceSummary.restartEnvelope.restartSafe,
      route: state.sourceClientAcceptanceSummary.restartEnvelope.route,
      count: state.sourceClientAcceptanceSummary.totals.rowCount,
      nextAction: state.sourceClientAcceptanceSummary.restartEnvelope.nextAction,
      idempotencyKey: state.sourceClientAcceptanceSummary.syncKey,
    }),
    formatterExportDecisionLane({
      id: "source-client-commands",
      status: state.sourceRangeClientCommandPacket.status,
      exportAllowed: state.sourceRangeClientCommandPacket.exportAllowed,
      restartSafe: state.sourceRangeClientCommandPacket.restartEnvelope.restartSafe,
      route: state.sourceRangeClientCommandPacket.restartEnvelope.route,
      count: state.sourceRangeClientCommandPacket.totals.commandCount,
      nextAction: state.sourceRangeClientCommandPacket.restartEnvelope.nextAction,
      idempotencyKey: state.sourceRangeClientCommandPacket.syncKey,
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
      id: "diagnostic-client-adoption",
      status: state.diagnosticClientRuntimeAdoption.status,
      exportAllowed: state.diagnosticClientRuntimeAdoption.exportAllowed,
      restartSafe: state.diagnosticClientRuntimeAdoption.restartEnvelope.restartSafe,
      route: state.diagnosticClientRuntimeAdoption.restartEnvelope.route,
      count: state.diagnosticClientRuntimeAdoption.totals.rowCount,
      nextAction: state.diagnosticClientRuntimeAdoption.restartEnvelope.nextAction,
      idempotencyKey: state.diagnosticClientRuntimeAdoption.syncKey,
    }),
    formatterExportDecisionLane({
      id: "mailchimp-runtime-request",
      status: state.mailchimpRuntimeRequest?.status ?? "idle",
      exportAllowed: state.mailchimpRuntimeRequest?.exportAllowed !== false,
      restartSafe: state.mailchimpRuntimeRequest?.restartEnvelope?.restartSafe !== false,
      route: state.mailchimpRuntimeRequest?.restartEnvelope?.route ?? "mailchimp/runtime-request/summary",
      count: state.mailchimpRuntimeRequest?.totals?.rowCount ?? 0,
      nextAction: state.mailchimpRuntimeRequest?.restartEnvelope?.nextAction ?? "publish-mailchimp-runtime-request",
      idempotencyKey: state.mailchimpRuntimeRequest?.syncKey ?? null,
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
      id: "mailchimp-service-sync-window",
      status: state.mailchimpHandoff.commandContract?.status === "blocked"
        ? "blocked"
        : state.mailchimpServiceSyncCheckpoint?.status ?? state.mailchimpHandoff.syncMetadata?.serviceSyncWindowStatus ?? "idle",
      exportAllowed: state.mailchimpServiceSyncCheckpoint?.exportAllowed
        ?? ((state.mailchimpHandoff.syncMetadata?.serviceSyncWindowStatus ?? "idle") !== "blocked"),
      restartSafe: state.mailchimpServiceSyncCheckpoint?.restartSafe
        ?? ((state.mailchimpHandoff.syncMetadata?.serviceSyncWindowByStatus?.blocked ?? 0) === 0),
      route: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.route ?? "mailchimp/service-sync-window",
      count: state.mailchimpServiceSyncCheckpoint?.totals?.rowCount ?? state.mailchimpHandoff.syncMetadata?.serviceSyncWindowCount ?? 0,
      nextAction: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.nextAction
        ?? (state.mailchimpHandoff.syncMetadata?.serviceSyncWindowStatus === "pending"
        ? "accept-mailchimp-service-sync-window"
        : state.mailchimpHandoff.syncMetadata?.serviceSyncWindowStatus === "review"
          ? "review-mailchimp-service-sync-window"
          : state.mailchimpHandoff.syncMetadata?.serviceSyncWindowStatus === "blocked"
            ? "repair-mailchimp-service-sync-window"
            : "publish-mailchimp-service-sync-window"),
      idempotencyKey: state.mailchimpServiceSyncCheckpoint?.syncKey ?? [
        state.mailchimpHandoff.syncMetadata?.serviceSyncKey ?? "mailchimp-service-unbound",
        state.mailchimpHandoff.syncMetadata?.serviceSyncWindowStatus ?? "idle",
      ].join(":"),
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
      sourceClientAcceptanceByStatus: state.sourceClientAcceptanceSummary.counters.byStatus,
      sourceClientCommandByStatus: state.sourceRangeClientCommandPacket.counters.byStatus,
      diagnosticCommandByStatus: state.diagnosticCommandSummary.counters.commandByStatus,
      diagnosticAdoptionByStatus: state.diagnosticClientRuntimeAdoption.counters.byStatus,
      sourceTimelineByStatus: state.sourceOperationalTimeline?.counters?.byStatus ?? {},
      incidentByStatus: state.mailchimpDiagnosticIncidentReport?.counters?.byStatus ?? {},
      serviceSyncWindowByStatus: state.mailchimpHandoff.syncMetadata?.serviceSyncWindowByStatus ?? {},
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
      sourceClientAcceptanceCount: state.sourceClientAcceptanceSummary.totals.rowCount,
      sourceClientAcceptancePendingCount: state.sourceClientAcceptanceSummary.totals.pendingCount,
      sourceClientCommandCount: state.sourceRangeClientCommandPacket.totals.commandCount,
      diagnosticCommandCount: state.diagnosticCommandSummary.totals.commandCount,
      diagnosticAdoptionRowCount: state.diagnosticClientRuntimeAdoption.totals.rowCount,
      mailchimpOperationCount: state.mailchimpHandoff.operations?.length ?? 0,
      mailchimpServiceSyncWindowCount: state.mailchimpHandoff.syncMetadata?.serviceSyncWindowCount ?? 0,
    }),
    acceptance: Object.freeze({
      formatterMissingIds: state.acceptance.missingIds,
      mailchimpOperationMissingIds: state.acceptance.mailchimpOperations.missingIds,
      sourcePendingAnchorIds: state.sourceProviderExportSummary.recovery.pendingAnchorIds,
      sourceClientPendingIds: state.sourceClientAcceptanceSummary.acceptance.pendingIds,
      sourceClientPendingCommandIds: state.sourceRangeClientCommandPacket.restartEnvelope.pendingCommandIds,
      mailchimpPendingSourceAnchorIds: state.mailchimpSourceAnchorHandoff.acceptance.pendingAnchorIds,
      diagnosticPendingCommandIds: state.diagnosticCommandSummary.recovery.pendingCommandIds,
      diagnosticPendingAdoptionIds: state.diagnosticClientRuntimeAdoption.restartEnvelope.pendingRowIds,
      mailchimpCampaignPendingJobNames: state.mailchimpCampaignExportQueue.restartEnvelope.pendingJobNames,
      mailchimpPendingScheduleWindowIds: state.mailchimpScheduleWindowRuntime.restartEnvelope.pendingWindowIds,
      mailchimpPendingServiceSyncWindowIds: state.mailchimpServiceSyncCheckpoint?.acceptance?.pendingWindowIds ?? Object.freeze([]),
      mailchimpServiceSyncWindowStatus: state.mailchimpHandoff.syncMetadata?.serviceSyncWindowStatus ?? "idle",
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

function createFormatterMailchimpReviewBoardContract(state = {}, options = {}) {
  const extraLanes = [
    formatterReviewBoardLane({
      id: "mailchimp-export-decision",
      source: "mailchimpExportDecision",
      kind: "exportDecision",
      status: state.mailchimpExportDecision?.status,
      label: "Mailchimp export decision",
      detail: state.mailchimpExportDecision?.userVisible?.detail,
      handoff: "formatter-mailchimp-export",
      route: state.mailchimpExportDecision?.restartEnvelope?.route,
      count: state.mailchimpExportDecision?.totals?.laneCount,
      restartSafe: state.mailchimpExportDecision?.restartEnvelope?.restartSafe,
      idempotencyKey: state.mailchimpExportDecision?.syncKey,
      nextAction: state.mailchimpExportDecision?.restartEnvelope?.nextAction,
    }),
    formatterReviewBoardLane({
      id: "mailchimp-campaign-export",
      source: "mailchimpCampaignExportQueue",
      kind: "campaignExportQueue",
      status: state.mailchimpCampaignExportQueue?.status,
      label: "Campaign export queue",
      detail: `${state.mailchimpCampaignExportQueue?.totals?.queueCount ?? 0} campaign exports queued.`,
      handoff: "mailchimp-campaign-export-queue",
      route: state.mailchimpCampaignExportQueue?.restartEnvelope?.route,
      count: state.mailchimpCampaignExportQueue?.totals?.queueCount,
      restartSafe: state.mailchimpCampaignExportQueue?.restartEnvelope?.restartSafe,
      idempotencyKey: state.mailchimpCampaignExportQueue?.exportSummary?.syncKey,
      nextAction: state.mailchimpCampaignExportQueue?.restartEnvelope?.nextAction,
    }),
    formatterReviewBoardLane({
      id: "mailchimp-schedule-window",
      source: "mailchimpScheduleWindowRuntime",
      kind: "scheduleWindow",
      status: state.mailchimpScheduleWindowRuntime?.status,
      label: "Schedule windows",
      detail: state.mailchimpScheduleWindowRuntime?.userVisible?.detail,
      handoff: "mailchimp-schedule-window",
      route: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.route,
      count: state.mailchimpScheduleWindowRuntime?.totals?.windowCount,
      restartSafe: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.restartSafe,
      idempotencyKey: state.mailchimpScheduleWindowRuntime?.syncKey,
      nextAction: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.nextAction,
    }),
    formatterReviewBoardLane({
      id: "mailchimp-source-anchor",
      source: "mailchimpSourceAnchorHandoff",
      kind: "sourceAnchor",
      status: state.mailchimpSourceAnchorHandoff?.status,
      label: "Mailchimp source anchors",
      detail: `${state.mailchimpSourceAnchorHandoff?.totals?.anchoredOperationCount ?? 0} anchored operations prepared.`,
      handoff: "mailchimp-source-anchor",
      route: state.mailchimpSourceAnchorHandoff?.restartEnvelope?.route,
      count: state.mailchimpSourceAnchorHandoff?.totals?.operationCount,
      restartSafe: state.mailchimpSourceAnchorHandoff?.restartEnvelope?.restartSafe,
      idempotencyKey: state.mailchimpSourceAnchorHandoff?.syncKey,
      nextAction: state.mailchimpSourceAnchorHandoff?.restartEnvelope?.nextAction,
    }),
    formatterReviewBoardLane({
      id: "source-client-acceptance",
      source: "sourceClientAcceptanceSummary",
      kind: "sourceAcceptance",
      status: state.sourceClientAcceptanceSummary?.status,
      label: "Source acceptance",
      detail: state.sourceClientAcceptanceSummary?.userVisible?.detail,
      handoff: "source-range-client-acceptance",
      route: state.sourceClientAcceptanceSummary?.restartEnvelope?.route,
      count: state.sourceClientAcceptanceSummary?.totals?.rowCount,
      restartSafe: state.sourceClientAcceptanceSummary?.restartEnvelope?.restartSafe,
      idempotencyKey: state.sourceClientAcceptanceSummary?.syncKey,
      nextAction: state.sourceClientAcceptanceSummary?.restartEnvelope?.nextAction,
    }),
    formatterReviewBoardLane({
      id: "source-client-commands",
      source: "sourceRangeClientCommandPacket",
      kind: "sourceCommand",
      status: state.sourceRangeClientCommandPacket?.status,
      label: "Source client commands",
      detail: state.sourceRangeClientCommandPacket?.userVisible?.detail,
      handoff: "source-range-client-command",
      route: state.sourceRangeClientCommandPacket?.restartEnvelope?.route,
      count: state.sourceRangeClientCommandPacket?.totals?.commandCount,
      restartSafe: state.sourceRangeClientCommandPacket?.restartEnvelope?.restartSafe,
      idempotencyKey: state.sourceRangeClientCommandPacket?.syncKey,
      nextAction: state.sourceRangeClientCommandPacket?.restartEnvelope?.nextAction,
    }),
    formatterReviewBoardLane({
      id: "diagnostic-client-adoption",
      source: "diagnosticClientRuntimeAdoption",
      kind: "runtimeAdoption",
      status: state.diagnosticClientRuntimeAdoption?.status,
      label: "Diagnostic client adoption",
      detail: state.diagnosticClientRuntimeAdoption?.userVisible?.detail,
      handoff: "diagnostic-client-adoption",
      route: state.diagnosticClientRuntimeAdoption?.restartEnvelope?.route,
      count: state.diagnosticClientRuntimeAdoption?.totals?.rowCount,
      restartSafe: state.diagnosticClientRuntimeAdoption?.restartEnvelope?.restartSafe,
      idempotencyKey: state.diagnosticClientRuntimeAdoption?.syncKey,
      nextAction: state.diagnosticClientRuntimeAdoption?.restartEnvelope?.nextAction,
    }),
    formatterReviewBoardLane({
      id: "mailchimp-runtime-request",
      source: "mailchimpRuntimeRequest",
      kind: "runtimeRequest",
      status: state.mailchimpRuntimeRequest?.status,
      label: "Mailchimp runtime request",
      detail: state.mailchimpRuntimeRequest?.userVisible?.detail,
      handoff: "mailchimp-client-runtime-request",
      route: state.mailchimpRuntimeRequest?.restartEnvelope?.route,
      count: state.mailchimpRuntimeRequest?.totals?.rowCount,
      restartSafe: state.mailchimpRuntimeRequest?.restartEnvelope?.restartSafe,
      idempotencyKey: state.mailchimpRuntimeRequest?.syncKey,
      nextAction: state.mailchimpRuntimeRequest?.restartEnvelope?.nextAction,
    }),
    formatterReviewBoardLane({
      id: "source-provider-export",
      source: "sourceProviderExportSummary",
      kind: "sourceProviderExport",
      status: state.sourceProviderExportSummary?.status,
      label: "Source provider export",
      detail: `${state.sourceProviderExportSummary?.totals?.anchorCount ?? 0} source anchors in provider export.`,
      handoff: "source-range-provider-export",
      route: state.sourceProviderExportSummary?.handoff?.route,
      count: state.sourceProviderExportSummary?.totals?.anchorCount,
      restartSafe: state.sourceProviderExportSummary?.handoff?.restartSafe,
      idempotencyKey: state.sourceProviderExportSummary?.syncKey,
      nextAction: state.sourceProviderExportSummary?.handoff?.nextAction,
    }),
    formatterReviewBoardLane({
      id: "runtime-resume",
      source: "mailchimpRuntimeResumePacket",
      kind: "runtimeResume",
      status: state.mailchimpRuntimeResumePacket?.status,
      label: "Runtime resume",
      detail: state.mailchimpRuntimeResumePacket?.userVisible?.detail,
      handoff: "mailchimp-runtime-resume",
      route: state.mailchimpRuntimeResumePacket?.restartEnvelope?.route,
      count: state.mailchimpRuntimeResumePacket?.totals?.resumeActionCount,
      restartSafe: state.mailchimpRuntimeResumePacket?.restartEnvelope?.restartSafe,
      idempotencyKey: state.mailchimpRuntimeResumePacket?.syncKey,
      nextAction: state.mailchimpRuntimeResumePacket?.restartEnvelope?.nextAction,
    }),
  ];
  const diagnosticRows = createDiagnosticReviewBoardLanes(state.validationSummary?.diagnostics ?? [], {
    ...(options.diagnosticLifecycle ?? {}),
    clientState: state.diagnosticClientState,
    commandSummary: state.diagnosticCommandSummary,
    releaseChecklist: state.diagnosticReleaseChecklist,
    mailchimpWorkflowPreview: state.mailchimpWorkflowPreview,
    extraLanes,
  });
  const rows = diagnosticRows.rows;
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review" || row.status === "disabled");
  const status = state.mailchimpReleaseReadiness?.status === "blocked" || blocked.length
    ? "blocked"
    : state.mailchimpReleaseReadiness?.status === "pending" || pending.length
      ? "pending"
      : state.mailchimpReleaseReadiness?.status === "review" || review.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "formatter-mailchimp-review-board.v1",
    status,
    ok: status === "ready" || status === "review",
    exportAllowed: status === "ready" || status === "review",
    providerId: state.mailchimpHandoff?.providerId ?? "mailchimp",
    fileName: options.fileName ?? state.sourceClientAcceptanceSummary?.fileName ?? "inline.aios",
    syncKey: [
      state.persistedState?.syncKey ?? "formatter-state",
      state.mailchimpReleaseReadiness?.syncKey ?? "release-unbound",
      diagnosticRows.restartEnvelope.idempotencyKeys.join(",") || "no-review-rows",
      options.revision ?? "working",
    ].join("|"),
    rows,
    sections: diagnosticRows.sections,
    counters: Object.freeze({
      byStatus: diagnosticRows.counters.byStatus,
      bySource: diagnosticRows.counters.bySource,
      byHandoff: diagnosticRows.counters.byHandoff,
      byRoute: diagnosticRows.counters.byRoute,
      exportDecisionByStatus: state.mailchimpExportDecision?.counters?.laneByStatus ?? {},
      sourceAcceptanceByStatus: state.sourceClientAcceptanceSummary?.counters?.byStatus ?? {},
      scheduleWindowByStatus: state.mailchimpScheduleWindowRuntime?.counters?.byStatus ?? {},
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      sectionCount: diagnosticRows.sections.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      diagnosticCount: diagnosticRows.totals.diagnosticCount,
      campaignQueueCount: state.mailchimpCampaignExportQueue?.totals?.queueCount ?? 0,
      scheduleWindowCount: state.mailchimpScheduleWindowRuntime?.totals?.windowCount ?? 0,
      sourceAcceptanceCount: state.sourceClientAcceptanceSummary?.totals?.rowCount ?? 0,
      releaseLaneCount: state.mailchimpReleaseReadiness?.totals?.laneCount ?? 0,
    }),
    acceptance: Object.freeze({
      mode: "route",
      acceptable: status !== "blocked" && pending.length === 0,
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      sourcePendingIds: state.sourceClientAcceptanceSummary?.acceptance?.pendingIds ?? Object.freeze([]),
      campaignPendingJobNames: state.mailchimpCampaignExportQueue?.restartEnvelope?.pendingJobNames ?? Object.freeze([]),
      schedulePendingWindowIds: state.mailchimpScheduleWindowRuntime?.restartEnvelope?.pendingWindowIds ?? Object.freeze([]),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "formatter/mailchimp-review-board/recovery"
        : status === "pending"
          ? "formatter/mailchimp-review-board/acceptance"
          : status === "review"
            ? "formatter/mailchimp-review-board/review"
            : "formatter/mailchimp-review-board/summary",
      restartSafe: blocked.length === 0 && diagnosticRows.restartEnvelope.restartSafe,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: diagnosticRows.restartEnvelope.idempotencyKeys,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? state.mailchimpReleaseReadiness?.restartEnvelope?.nextAction
        ?? "publish-formatter-mailchimp-review-board",
    }),
    userVisible: Object.freeze({
      title: "Mailchimp review board",
      detail: status === "ready"
        ? "Mailchimp diagnostics, source anchors, schedule windows, and export decisions are ready for handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review rows remain before Mailchimp handoff.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-formatter-mailchimp-review-board",
    }),
    diagnosticRows,
  });
}

function formatterReviewBoardLane(lane = {}) {
  return Object.freeze({
    id: lane.id,
    source: lane.source,
    kind: lane.kind,
    status: lane.status ?? "idle",
    severity: lane.status === "blocked" ? "error" : lane.status === "pending" || lane.status === "review" ? "warning" : "info",
    label: lane.label,
    detail: lane.detail ?? `${lane.count ?? 0} items prepared for ${lane.handoff ?? "handoff"}.`,
    handoff: lane.handoff,
    route: lane.route,
    targetId: lane.id,
    restartSafe: lane.restartSafe !== false,
    idempotencyKey: lane.idempotencyKey ?? null,
    nextAction: lane.nextAction,
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
  if (contracts.mailchimpCampaignControlPlane?.status === "blocked") {
    return Object.freeze({
      id: "mailchimp-control-plane",
      label: "Repair Mailchimp campaign controls",
      status: "blocked",
      detail: `${contracts.mailchimpCampaignControlPlane.totals.blockedCount} campaign control rows block client handoff.`,
      handoff: contracts.mailchimpCampaignControlPlane.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpCampaignControlPlane?.status === "pending") {
    return Object.freeze({
      id: "accept-mailchimp-control-plane",
      label: "Accept Mailchimp campaign controls",
      status: "pending",
      detail: `${contracts.mailchimpCampaignControlPlane.totals.pendingCount} campaign control rows need runtime action.`,
      handoff: contracts.mailchimpCampaignControlPlane.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpCampaignControlPlane?.status === "review") {
    return Object.freeze({
      id: "review-mailchimp-control-plane",
      label: "Review Mailchimp campaign controls",
      status: "review",
      detail: `${contracts.mailchimpCampaignControlPlane.totals.reviewCount} campaign control rows need review before export.`,
      handoff: contracts.mailchimpCampaignControlPlane.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpPersistedCommandEnvelope?.status === "blocked") {
    return Object.freeze({
      id: "mailchimp-persisted-commands",
      label: "Repair Mailchimp persisted commands",
      status: "blocked",
      detail: `${contracts.mailchimpPersistedCommandEnvelope.totals.blockedCommandCount} persisted command(s) block client handoff.`,
      handoff: contracts.mailchimpPersistedCommandEnvelope.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpPersistedCommandEnvelope?.status === "pending") {
    return Object.freeze({
      id: "accept-mailchimp-persisted-commands",
      label: "Accept Mailchimp persisted commands",
      status: "pending",
      detail: `${contracts.mailchimpPersistedCommandEnvelope.totals.pendingCommandCount} persisted command(s) need acceptance or settlement.`,
      handoff: contracts.mailchimpPersistedCommandEnvelope.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpPersistedCommandEnvelope?.status === "review") {
    return Object.freeze({
      id: "review-mailchimp-persisted-commands",
      label: "Review Mailchimp persisted commands",
      status: "review",
      detail: `${contracts.mailchimpPersistedCommandEnvelope.totals.reviewCommandCount} persisted command(s) need review before export.`,
      handoff: contracts.mailchimpPersistedCommandEnvelope.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpServiceSyncCheckpoint?.status === "blocked") {
    return Object.freeze({
      id: "mailchimp-service-sync-checkpoint",
      label: "Repair Mailchimp service sync",
      status: "blocked",
      detail: `${contracts.mailchimpServiceSyncCheckpoint.totals.blockedCount} service sync checkpoint rows block Mailchimp handoff.`,
      handoff: contracts.mailchimpServiceSyncCheckpoint.restartEnvelope.nextAction,
    });
  }
  if (contracts.mailchimpServiceSyncCheckpoint?.status === "pending") {
    return Object.freeze({
      id: "accept-mailchimp-service-sync",
      label: "Accept Mailchimp service sync",
      status: "pending",
      detail: `${contracts.mailchimpServiceSyncCheckpoint.totals.pendingCount} service sync windows need acceptance or completion.`,
      handoff: contracts.mailchimpServiceSyncCheckpoint.restartEnvelope.nextAction,
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
  if (contracts.diagnosticHandoffGate?.status === "blocked") {
    return Object.freeze({
      id: "diagnostic-handoff-gate",
      label: "Repair diagnostic handoff gate",
      status: "blocked",
      detail: `${contracts.diagnosticHandoffGate.totals.blockedGateCount} diagnostic handoff gates block formatter export.`,
      handoff: contracts.diagnosticHandoffGate.restartEnvelope.nextAction,
    });
  }
  if (contracts.diagnosticHandoffGate?.status === "pending") {
    return Object.freeze({
      id: "accept-diagnostic-handoff-gate",
      label: "Accept diagnostic handoff gate",
      status: "pending",
      detail: `${contracts.diagnosticHandoffGate.totals.pendingGateCount} diagnostic handoff gates need acceptance or completion.`,
      handoff: contracts.diagnosticHandoffGate.restartEnvelope.nextAction,
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
  if (contracts.sourceClientWorkflowHandoffQueue?.status === "blocked") {
    return Object.freeze({
      id: "source-workflow-handoff-queue",
      label: "Repair source workflow queue",
      status: "blocked",
      detail: `${contracts.sourceClientWorkflowHandoffQueue.totals.blockedCount} source workflow queue rows block client handoff.`,
      handoff: contracts.sourceClientWorkflowHandoffQueue.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceRangeRecoveryCommandExport?.status === "blocked") {
    return Object.freeze({
      id: "source-recovery-commands",
      label: "Repair source recovery commands",
      status: "blocked",
      detail: `${contracts.sourceRangeRecoveryCommandExport.totals.blockedCommandCount} source recovery command(s) block formatter handoff.`,
      handoff: contracts.sourceRangeRecoveryCommandExport.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceClientRouteHandoffPacket?.status === "blocked") {
    return Object.freeze({
      id: "source-client-route-handoff",
      label: "Repair source client routes",
      status: "blocked",
      detail: `${contracts.sourceClientRouteHandoffPacket.totals.blockedCount} source client route rows block preview handoff.`,
      handoff: contracts.sourceClientRouteHandoffPacket.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceClientAcceptanceSummary?.status === "blocked") {
    return Object.freeze({
      id: "source-client-acceptance",
      label: "Repair source client acceptance",
      status: "blocked",
      detail: `${contracts.sourceClientAcceptanceSummary.totals.blockedCount} source acceptance rows block client handoff.`,
      handoff: contracts.sourceClientAcceptanceSummary.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceClientAcceptanceSummary?.status === "pending") {
    return Object.freeze({
      id: "accept-source-client-handoff",
      label: "Accept source client handoff",
      status: "pending",
      detail: `${contracts.sourceClientAcceptanceSummary.totals.pendingCount} source acceptance rows need explicit acceptance.`,
      handoff: contracts.sourceClientAcceptanceSummary.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceClientWorkflowHandoffQueue?.status === "pending") {
    return Object.freeze({
      id: "accept-source-workflow-handoff-queue",
      label: "Accept source workflow queue",
      status: "pending",
      detail: `${contracts.sourceClientWorkflowHandoffQueue.totals.pendingCount} source workflow queue rows need acceptance or retry.`,
      handoff: contracts.sourceClientWorkflowHandoffQueue.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceRangeRecoveryCommandExport?.status === "pending") {
    return Object.freeze({
      id: "accept-source-recovery-commands",
      label: "Accept source recovery commands",
      status: "pending",
      detail: `${contracts.sourceRangeRecoveryCommandExport.totals.pendingCommandCount} source recovery command(s) need acceptance or retry settlement.`,
      handoff: contracts.sourceRangeRecoveryCommandExport.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceClientRouteHandoffPacket?.status === "pending") {
    return Object.freeze({
      id: "accept-source-client-route-handoff",
      label: "Accept source client routes",
      status: "pending",
      detail: `${contracts.sourceClientRouteHandoffPacket.totals.pendingCount} source client route rows need acceptance or completion.`,
      handoff: contracts.sourceClientRouteHandoffPacket.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceClientWorkflowHandoffQueue?.status === "review") {
    return Object.freeze({
      id: "review-source-workflow-handoff-queue",
      label: "Review source workflow queue",
      status: "review",
      detail: `${contracts.sourceClientWorkflowHandoffQueue.totals.reviewCount} source workflow queue rows need review before export.`,
      handoff: contracts.sourceClientWorkflowHandoffQueue.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceRangeRecoveryCommandExport?.status === "review") {
    return Object.freeze({
      id: "review-source-recovery-commands",
      label: "Review source recovery commands",
      status: "review",
      detail: `${contracts.sourceRangeRecoveryCommandExport.totals.reviewCommandCount} source recovery command(s) need review before export.`,
      handoff: contracts.sourceRangeRecoveryCommandExport.restartEnvelope.nextAction,
    });
  }
  if (contracts.sourceClientRouteHandoffPacket?.status === "review") {
    return Object.freeze({
      id: "review-source-client-route-handoff",
      label: "Review source client routes",
      status: "review",
      detail: `${contracts.sourceClientRouteHandoffPacket.totals.reviewCount} source client route rows need review before export.`,
      handoff: contracts.sourceClientRouteHandoffPacket.restartEnvelope.nextAction,
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
      id: "formatter-lifecycle",
      label: "Formatter lifecycle",
      status: state.formatterLifecycle?.status ?? "ready",
      exportAllowed: state.formatterLifecycle?.exportAllowed !== false,
      restartSafe: state.formatterLifecycle?.restartEnvelope?.restartSafe !== false,
      count: state.formatterLifecycle?.totals?.commandCount ?? 0,
      route: state.formatterLifecycle?.restartEnvelope?.route ?? "formatter/lifecycle/summary",
      nextAction: state.formatterLifecycle?.restartEnvelope?.nextAction ?? "publish-formatter-lifecycle-state",
      idempotencyKey: state.formatterLifecycle?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
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
      id: "source-client-acceptance",
      label: "Source client acceptance",
      status: state.sourceClientAcceptanceSummary.status,
      exportAllowed: state.sourceClientAcceptanceSummary.exportAllowed,
      restartSafe: state.sourceClientAcceptanceSummary.restartEnvelope.restartSafe,
      count: state.sourceClientAcceptanceSummary.totals.rowCount,
      route: state.sourceClientAcceptanceSummary.restartEnvelope.route,
      nextAction: state.sourceClientAcceptanceSummary.restartEnvelope.nextAction,
      idempotencyKey: state.sourceClientAcceptanceSummary.syncKey,
    }),
    formatterReleaseLane({
      id: "source-client-commands",
      label: "Source client commands",
      status: state.sourceRangeClientCommandPacket.status,
      exportAllowed: state.sourceRangeClientCommandPacket.exportAllowed,
      restartSafe: state.sourceRangeClientCommandPacket.restartEnvelope.restartSafe,
      count: state.sourceRangeClientCommandPacket.totals.commandCount,
      route: state.sourceRangeClientCommandPacket.restartEnvelope.route,
      nextAction: state.sourceRangeClientCommandPacket.restartEnvelope.nextAction,
      idempotencyKey: state.sourceRangeClientCommandPacket.syncKey,
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
      id: "diagnostic-client-adoption",
      label: "Diagnostic client adoption",
      status: state.diagnosticClientRuntimeAdoption.status,
      exportAllowed: state.diagnosticClientRuntimeAdoption.exportAllowed,
      restartSafe: state.diagnosticClientRuntimeAdoption.restartEnvelope.restartSafe,
      count: state.diagnosticClientRuntimeAdoption.totals.rowCount,
      route: state.diagnosticClientRuntimeAdoption.restartEnvelope.route,
      nextAction: state.diagnosticClientRuntimeAdoption.restartEnvelope.nextAction,
      idempotencyKey: state.diagnosticClientRuntimeAdoption.syncKey,
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
      id: "mailchimp-campaign-release",
      label: "Mailchimp campaign release",
      status: state.mailchimpCampaignReleaseContract?.status ?? "idle",
      exportAllowed: state.mailchimpCampaignReleaseContract?.exportAllowed !== false,
      restartSafe: state.mailchimpCampaignReleaseContract?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpCampaignReleaseContract?.totals?.laneCount ?? 0,
      route: state.mailchimpCampaignReleaseContract?.restartEnvelope?.route ?? "mailchimp/campaign-release/export",
      nextAction: state.mailchimpCampaignReleaseContract?.restartEnvelope?.nextAction ?? "publish-mailchimp-campaign-release",
      idempotencyKey: state.mailchimpCampaignReleaseContract?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
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
      id: "mailchimp-runtime-request",
      label: "Mailchimp runtime request",
      status: state.mailchimpRuntimeRequest?.status ?? "idle",
      exportAllowed: state.mailchimpRuntimeRequest?.exportAllowed !== false,
      restartSafe: state.mailchimpRuntimeRequest?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpRuntimeRequest?.totals?.rowCount ?? 0,
      route: state.mailchimpRuntimeRequest?.restartEnvelope?.route ?? "mailchimp/runtime-request/summary",
      nextAction: state.mailchimpRuntimeRequest?.restartEnvelope?.nextAction ?? "publish-mailchimp-runtime-request",
      idempotencyKey: state.mailchimpRuntimeRequest?.syncKey ?? null,
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
      id: "mailchimp-service-sync-checkpoint",
      label: "Mailchimp service sync",
      status: state.mailchimpServiceSyncCheckpoint?.status ?? "idle",
      exportAllowed: state.mailchimpServiceSyncCheckpoint?.exportAllowed !== false,
      restartSafe: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.restartSafe !== false,
      count: state.mailchimpServiceSyncCheckpoint?.totals?.rowCount ?? 0,
      route: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.route ?? "mailchimp/service-sync-checkpoint/summary",
      nextAction: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.nextAction ?? "publish-mailchimp-service-sync-checkpoint",
      idempotencyKey: state.mailchimpServiceSyncCheckpoint?.syncKey ?? null,
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
      sourceClientAcceptanceByStatus: state.sourceClientAcceptanceSummary.counters.byStatus,
      sourceOperationalByStatus: state.sourceOperationalTimeline.counters.byStatus,
      diagnosticChecklistByStatus: state.diagnosticReleaseChecklist.counters.byStatus,
      mailchimpLaunchByStatus: state.mailchimpLaunchHandoff.validationSummary,
      mailchimpCampaignReleaseByStatus: state.mailchimpCampaignReleaseContract?.counters?.byStatus ?? {},
      mailchimpCampaignReleaseByAcceptance: state.mailchimpCampaignReleaseContract?.counters?.byAcceptance ?? {},
    }),
    acceptance: Object.freeze({
      formatterMissingIds: state.acceptance.missingIds,
      sourcePendingAnchorIds: state.sourceReleasePacket.acceptance.pendingAnchorIds,
      sourceClientPendingIds: state.sourceClientAcceptanceSummary.acceptance.pendingIds,
      mailchimpPendingSourceAnchorIds: state.mailchimpSourceAnchorHandoff.acceptance.pendingAnchorIds,
      diagnosticPendingItemIds: state.diagnosticReleaseChecklist.restartEnvelope.pendingItemIds,
      mailchimpPendingGateIds: state.mailchimpLaunchHandoff.acceptance.pendingGateIds,
      mailchimpPendingReleaseLaneIds: state.mailchimpCampaignReleaseContract?.acceptance?.pendingLaneIds ?? Object.freeze([]),
      mailchimpPendingScheduleWindowIds: state.mailchimpScheduleWindowRuntime.restartEnvelope.pendingWindowIds,
      mailchimpPendingServiceSyncWindowIds: state.mailchimpServiceSyncCheckpoint?.acceptance?.pendingWindowIds ?? Object.freeze([]),
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
      id: "mailchimp-runtime-request",
      status: state.mailchimpRuntimeRequest?.status ?? "idle",
      route: state.mailchimpRuntimeRequest?.restartEnvelope?.route ?? "mailchimp/runtime-request/summary",
      restartSafe: state.mailchimpRuntimeRequest?.restartEnvelope?.restartSafe !== false,
      nextAction: state.mailchimpRuntimeRequest?.restartEnvelope?.nextAction ?? "publish-mailchimp-runtime-request",
      idempotencyKey: state.mailchimpRuntimeRequest?.syncKey ?? null,
      count: state.mailchimpRuntimeRequest?.totals?.rowCount ?? 0,
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
      id: "source-client-acceptance",
      status: state.sourceClientAcceptanceSummary.status,
      route: state.sourceClientAcceptanceSummary.restartEnvelope.route,
      restartSafe: state.sourceClientAcceptanceSummary.restartEnvelope.restartSafe,
      nextAction: state.sourceClientAcceptanceSummary.restartEnvelope.nextAction,
      idempotencyKey: state.sourceClientAcceptanceSummary.syncKey,
      count: state.sourceClientAcceptanceSummary.totals.rowCount,
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
      id: "mailchimp-service-sync-checkpoint",
      status: state.mailchimpServiceSyncCheckpoint?.status ?? "idle",
      route: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.route ?? "mailchimp/service-sync-checkpoint/summary",
      restartSafe: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.restartSafe !== false,
      nextAction: state.mailchimpServiceSyncCheckpoint?.restartEnvelope?.nextAction ?? "publish-mailchimp-service-sync-checkpoint",
      idempotencyKey: state.mailchimpServiceSyncCheckpoint?.syncKey ?? null,
      count: state.mailchimpServiceSyncCheckpoint?.totals?.rowCount ?? 0,
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

function createFormatterRangeBySourceId(items = []) {
  const entries = [];
  for (const item of items) {
    const sourceId = item.path.at(-1) ?? item.nodeKind;
    if (!sourceId) continue;
    entries.push([String(sourceId), item.range]);
    entries.push([`${item.nodeKind}:${sourceId}`, item.range]);
    entries.push([`source-anchor:${item.nodeKind}:${sourceId}`, item.range]);
  }
  return Object.freeze(Object.fromEntries(entries
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
  const serviceSyncWindowStatus = state.mailchimpWorkflow.providerContract?.serviceSyncWindows?.status ?? "idle";
  const serviceSyncCheckpointStatus = state.mailchimpServiceSyncCheckpoint?.status ?? serviceSyncWindowStatus;
  const serviceSyncWindowBlocked = serviceSyncWindowStatus === "blocked";
  const serviceSyncWindowPending = serviceSyncWindowStatus === "pending" || serviceSyncWindowStatus === "review";
  const serviceSyncCheckpointBlocked = serviceSyncCheckpointStatus === "blocked";
  const serviceSyncCheckpointPending = serviceSyncCheckpointStatus === "pending" || serviceSyncCheckpointStatus === "review";
  const lifecycleStatus = state.formatterLifecycle?.status ?? "ready";
  const lifecycleBlocked = lifecycleStatus === "blocked" || lifecycleStatus === "disabled";
  const lifecyclePending = lifecycleStatus === "pending" || lifecycleStatus === "review";
  const status = blockedCommands.length
    || sourceBlocked
    || diagnosticsBlocked
    || receiptBlocked
    || tenantBoundaryBlocked
    || serviceSyncWindowBlocked
    || serviceSyncCheckpointBlocked
    || lifecycleBlocked
    ? "blocked"
    : pendingCommands.length
      || state.sourcePersistence.status === "pending"
      || state.diagnosticClientState.status === "pending"
      || receiptPending
      || tenantBoundaryPending
      || serviceSyncWindowPending
      || serviceSyncCheckpointPending
      || lifecyclePending
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
      && !serviceSyncWindowBlocked
      && !serviceSyncCheckpointBlocked
      && !lifecycleBlocked
      && state.mailchimpTenantBoundary?.handoff?.restartSafe !== false
      && receiptContract?.restartSafe !== false,
    syncKey: [
      state.providerContract.syncMetadata.syncKey,
      state.mailchimpHandoff.syncMetadata.serviceSyncKey ?? "mailchimp-idle",
      serviceSyncWindowStatus,
      state.mailchimpServiceSyncCheckpoint?.syncKey ?? "mailchimp-service-checkpoint-unbound",
      state.mailchimpTenantBoundary?.syncKey ?? "mailchimp-tenant-boundary-idle",
      state.formatterLifecycle?.restartEnvelope?.idempotencyKeys?.join(",") ?? "formatter-lifecycle-ready",
      state.sourcePersistence.syncKey,
      options.revision ?? "working",
    ].join("|"),
    sourceProviderSyncKey: state.providerContract.syncMetadata.syncKey,
    sourcePersistenceSyncKey: state.sourcePersistence.syncKey,
    mailchimpServiceSyncKey: state.mailchimpHandoff.syncMetadata.serviceSyncKey,
    mailchimpServiceSyncWindowStatus: serviceSyncWindowStatus,
    mailchimpServiceSyncCheckpointStatus: serviceSyncCheckpointStatus,
    mailchimpServiceSyncCheckpointSyncKey: state.mailchimpServiceSyncCheckpoint?.syncKey ?? null,
    mailchimpServiceSyncWindowCount: state.mailchimpWorkflow.providerContract?.serviceSyncWindows?.windowCount ?? 0,
    mailchimpServiceSyncCheckpointCount: state.mailchimpServiceSyncCheckpoint?.totals?.rowCount ?? 0,
    mailchimpServiceSyncWindowByStatus: state.mailchimpWorkflow.providerContract?.serviceSyncWindows?.counters?.byStatus ?? {},
    mailchimpCommandStatus: state.mailchimpHandoff.commandContract.status,
    mailchimpCommandRestartSafe: state.mailchimpHandoff.commandContract.restartSafe,
    mailchimpReceiptStatus: receiptContract?.status ?? "unbound",
    mailchimpReceiptRestartSafe: receiptContract?.restartSafe ?? true,
    mailchimpTenantBoundaryStatus: state.mailchimpTenantBoundary?.status ?? "unbound",
    mailchimpTenantBoundarySyncKey: state.mailchimpTenantBoundary?.syncKey ?? null,
    formatterLifecycleStatus: lifecycleStatus,
    formatterLifecycleRoute: state.formatterLifecycle?.restartEnvelope?.route ?? "formatter/lifecycle/summary",
    diagnosticClientRoute: state.diagnosticClientState.handoff.route,
    acceptedAt: state.acceptance.acceptedAt,
    commandLedger: Object.freeze(commandLedger),
    recovery: Object.freeze({
      blockedCommandIds: Object.freeze(blockedCommands.map((command) => command.id)),
      pendingCommandIds: Object.freeze(pendingCommands.map((command) => command.id)),
      nextAction: blockedCommands[0]?.nextAction
        ?? (receiptBlocked ? receiptContract.recovery.nextAction : null)
        ?? (serviceSyncCheckpointBlocked ? state.mailchimpServiceSyncCheckpoint.restartEnvelope.nextAction : null)
        ?? (serviceSyncWindowBlocked ? state.mailchimpWorkflow.providerContract.serviceSyncWindows.nextAction : null)
        ?? (lifecycleBlocked ? state.formatterLifecycle?.restartEnvelope?.nextAction : null)
        ?? (tenantBoundaryBlocked ? state.mailchimpTenantBoundary.handoff.nextAction : null)
        ?? (sourceBlocked ? state.sourcePersistence.recovery.nextAction : null)
        ?? (diagnosticsBlocked ? state.diagnosticClientState.handoff.nextAction : null)
        ?? pendingCommands[0]?.nextAction
        ?? (receiptPending ? receiptContract.recovery.nextAction : null)
        ?? (serviceSyncCheckpointPending ? state.mailchimpServiceSyncCheckpoint.restartEnvelope.nextAction : null)
        ?? (serviceSyncWindowPending ? state.mailchimpWorkflow.providerContract.serviceSyncWindows.nextAction : null)
        ?? (lifecyclePending ? state.formatterLifecycle?.restartEnvelope?.nextAction : null)
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
      mailchimpServiceSyncCheckpointStatus: serviceSyncCheckpointStatus,
      mailchimpTenantBoundaryStatus: state.mailchimpTenantBoundary?.status ?? "unbound",
      formatterLifecycleStatus: lifecycleStatus,
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
    formatterLifecycleByStatus: countFormatterItemsBy([state.formatterLifecycle].filter(Boolean), "status"),
    formatterLifecycleCommandByStatus: countFormatterItemsBy(state.formatterLifecycle?.commands ?? [], "status"),
    commandByKind: countFormatterItemsBy(state.persistedState.commandLedger, "kind"),
    commandByStatus: countFormatterItemsBy(state.persistedState.commandLedger, "status"),
    mailchimpCommandByStatus: state.mailchimpHandoff.commandContract.summary.byStatus,
    mailchimpPersistedCommandByStatus: state.mailchimpPersistedCommandEnvelope?.counters?.byStatus ?? {},
    mailchimpPersistedCommandByCommandId: state.mailchimpPersistedCommandEnvelope?.counters?.byCommandId ?? {},
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
    sourceRecoveryCommandByStatus: state.sourceRangeRecoveryCommandExport?.counters?.byStatus ?? {},
    sourceRecoveryCommandByIntent: state.sourceRangeRecoveryCommandExport?.counters?.byIntent ?? {},
    sourceRecoveryReadinessByStatus: state.sourceRangeRecoveryReadinessDigest?.counters?.byStatus ?? {},
    sourceRecoveryReadinessByKind: state.sourceRangeRecoveryReadinessDigest?.counters?.byKind ?? {},
    sourceExportCapabilityByStatus: state.sourceExportManifest.counters.capabilityByStatus,
    astWorkflowJobsByStatus: state.astExportEvidence.counters.workflowJobsByStatus,
    mailchimpAstResumeByStatus: state.mailchimpAstExportResumeLedger.counters,
    mailchimpCampaignQueueByStatus: state.mailchimpCampaignExportQueue.counters.byStatus,
    mailchimpCampaignQueueByAcceptance: state.mailchimpCampaignExportQueue.counters.byAcceptance,
    mailchimpCampaignQueueBySchedule: state.mailchimpCampaignExportQueue.counters.byScheduleMode,
    mailchimpServiceSyncCheckpointByStatus: state.mailchimpServiceSyncCheckpoint?.counters?.byStatus ?? {},
    diagnosticExportActionByStatus: state.diagnosticExportState.counters.runtimeActionByStatus,
  };
  const history = createFormatterHistorySnapshots([
    ...(Array.isArray(options.formatterHistory) ? options.formatterHistory : []),
    createFormatterHistoryPoint(state, counters, options),
  ], options);
  const timeline = createFormatterReportingTimeline(state, counters, history);
  const blocked = state.readiness.status === "blocked"
    || state.persistedState.status === "blocked"
    || state.formatterLifecycle?.status === "blocked"
    || state.formatterLifecycle?.status === "disabled"
    || state.sourceOperationalTimeline.status === "blocked"
    || state.sourceRangeRecoveryCommandExport?.status === "blocked"
    || state.sourceRangeRecoveryReadinessDigest?.status === "blocked"
    || state.diagnosticClientState.status === "blocked"
    || state.mailchimpAstExportResumeLedger.status === "blocked"
    || state.mailchimpCampaignExportQueue.status === "blocked";
  const pending = state.readiness.status === "needsAcceptance"
    || state.persistedState.status === "pending"
    || state.formatterLifecycle?.status === "pending"
    || state.sourceOperationalTimeline.status === "pending"
    || state.sourceRangeRecoveryCommandExport?.status === "pending"
    || state.sourceRangeRecoveryReadinessDigest?.status === "pending"
    || state.sourcePersistence.status === "pending"
    || state.mailchimpAstExportResumeLedger.status === "pending"
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
      formatterLifecycleByStatus: freezeSortedRecord(counters.formatterLifecycleByStatus),
      formatterLifecycleCommandByStatus: freezeSortedRecord(counters.formatterLifecycleCommandByStatus),
      commandByKind: freezeSortedRecord(counters.commandByKind),
      commandByStatus: freezeSortedRecord(counters.commandByStatus),
      mailchimpCommandByStatus: counters.mailchimpCommandByStatus,
      mailchimpPersistedCommandByStatus: counters.mailchimpPersistedCommandByStatus,
      mailchimpPersistedCommandByCommandId: counters.mailchimpPersistedCommandByCommandId,
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
      sourceRecoveryCommandByStatus: counters.sourceRecoveryCommandByStatus,
      sourceRecoveryCommandByIntent: counters.sourceRecoveryCommandByIntent,
      sourceRecoveryReadinessByStatus: counters.sourceRecoveryReadinessByStatus,
      sourceRecoveryReadinessByKind: counters.sourceRecoveryReadinessByKind,
      sourceExportCapabilityByStatus: counters.sourceExportCapabilityByStatus,
      astWorkflowJobsByStatus: counters.astWorkflowJobsByStatus,
      mailchimpAstResumeByStatus: counters.mailchimpAstResumeByStatus,
      mailchimpCampaignQueueByStatus: counters.mailchimpCampaignQueueByStatus,
      mailchimpCampaignQueueByAcceptance: counters.mailchimpCampaignQueueByAcceptance,
      mailchimpCampaignQueueBySchedule: counters.mailchimpCampaignQueueBySchedule,
      mailchimpServiceSyncCheckpointByStatus: counters.mailchimpServiceSyncCheckpointByStatus,
      diagnosticExportActionByStatus: counters.diagnosticExportActionByStatus,
    }),
    totals: Object.freeze({
      previewCount: state.previewItems.length,
      acceptedPreviewCount: state.acceptance.acceptedIds.length,
      missingPreviewAcceptanceCount: state.acceptance.missingIds.length,
      formatterLifecycleCommandCount: state.formatterLifecycle?.totals?.commandCount ?? 0,
      formatterLifecycleDiagnosticCount: state.formatterLifecycle?.totals?.diagnosticCount ?? 0,
      sourceAnchorCount: state.sourcePersistence.anchors.length,
      mailchimpSourceAnchorOperationCount: state.mailchimpSourceAnchorHandoff.totals.operationCount,
      mailchimpSourceAnchorBlockedCount: state.mailchimpSourceAnchorHandoff.totals.blockedOperationCount,
      mailchimpSourceAnchorPendingCount: state.mailchimpSourceAnchorHandoff.totals.pendingOperationCount,
      sourceOperationalEventCount: state.sourceOperationalTimeline.totals.eventCount,
      sourceOperationalActionableCount: state.sourceOperationalTimeline.totals.actionableEventCount,
      sourceOperationalBlockedCount: state.sourceOperationalTimeline.totals.blockedEventCount,
      sourceOperationalPendingCount: state.sourceOperationalTimeline.totals.pendingEventCount,
      sourceRecoveryCommandCount: state.sourceRangeRecoveryCommandExport?.totals?.commandCount ?? 0,
      sourceRecoveryCommandBlockedCount: state.sourceRangeRecoveryCommandExport?.totals?.blockedCommandCount ?? 0,
      sourceRecoveryCommandPendingCount: state.sourceRangeRecoveryCommandExport?.totals?.pendingCommandCount ?? 0,
      sourceRecoveryCommandReviewCount: state.sourceRangeRecoveryCommandExport?.totals?.reviewCommandCount ?? 0,
      sourceRecoveryReadinessRowCount: state.sourceRangeRecoveryReadinessDigest?.totals?.rowCount ?? 0,
      sourceRecoveryReadinessBlockedCount: state.sourceRangeRecoveryReadinessDigest?.totals?.blockedCount ?? 0,
      sourceRecoveryReadinessPendingCount: state.sourceRangeRecoveryReadinessDigest?.totals?.pendingCount ?? 0,
      sourceRecoveryReadinessReviewCount: state.sourceRangeRecoveryReadinessDigest?.totals?.reviewCount ?? 0,
      diagnosticCount: state.diagnosticClientState.diagnosticCount,
      providerDiagnosticCount: state.providerDiagnostics.length,
      operationalHealthIssueCount: state.mailchimpHandoff.operationalHealth?.issueCount ?? 0,
      runtimeActionCount: state.diagnosticClientState.validationSummary.actionCount,
      commandCount: state.persistedState.commandLedger.length,
      mailchimpOperationCount: state.mailchimpHandoff.operations.length,
      mailchimpPersistedCommandCount: state.mailchimpPersistedCommandEnvelope?.totals?.commandCount ?? 0,
      mailchimpPersistedCommandPendingCount: state.mailchimpPersistedCommandEnvelope?.totals?.pendingCommandCount ?? 0,
      mailchimpPersistedCommandBlockedCount: state.mailchimpPersistedCommandEnvelope?.totals?.blockedCommandCount ?? 0,
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
      mailchimpAstResumeCommandCount: state.mailchimpAstExportResumeLedger.totals.commandCount,
      mailchimpAstResumeBlockedCount: state.mailchimpAstExportResumeLedger.totals.blockedCommandCount,
      mailchimpAstResumePendingCount: state.mailchimpAstExportResumeLedger.totals.pendingCommandCount,
      mailchimpCampaignQueueBlockedCount: state.mailchimpCampaignExportQueue.totals.blockedCount,
      mailchimpCampaignQueuePendingCount: state.mailchimpCampaignExportQueue.totals.pendingCount,
      mailchimpServiceSyncCheckpointCount: state.mailchimpServiceSyncCheckpoint?.totals?.rowCount ?? 0,
      mailchimpServiceSyncCheckpointPendingCount: state.mailchimpServiceSyncCheckpoint?.totals?.pendingCount ?? 0,
      mailchimpServiceSyncCheckpointBlockedCount: state.mailchimpServiceSyncCheckpoint?.totals?.blockedCount ?? 0,
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
    formatterLifecycleStatus: state.formatterLifecycle?.status ?? "ready",
    formatterLifecycleMode: state.formatterLifecycle?.settings?.mode ?? "write",
    sourcePersistenceStatus: state.sourcePersistence.status,
    sourceOperationalStatus: state.sourceOperationalTimeline.status,
    sourceRecoveryCommandStatus: state.sourceRangeRecoveryCommandExport?.status ?? "unbound",
    sourceRecoveryReadinessStatus: state.sourceRangeRecoveryReadinessDigest?.status ?? "unbound",
    mailchimpSourceAnchorStatus: state.mailchimpSourceAnchorHandoff.status,
    mailchimpAstResumeStatus: state.mailchimpAstExportResumeLedger.status,
    mailchimpCampaignQueueStatus: state.mailchimpCampaignExportQueue.status,
    mailchimpStatus: state.mailchimpHandoff.status,
    mailchimpPersistedCommandStatus: state.mailchimpPersistedCommandEnvelope?.status ?? "unbound",
    diagnosticStatus: state.diagnosticClientState.status,
    previewCount: state.previewItems.length,
    commandCount: state.persistedState.commandLedger.length,
    diagnosticCount: state.diagnosticClientState.diagnosticCount,
    pendingAcceptanceCount: state.acceptance.missingIds.length
      + state.acceptance.mailchimpOperations.missingIds.length
      + state.sourcePersistence.recovery.pendingAnchorIds.length
      + (state.sourceRangeRecoveryCommandExport?.restartEnvelope?.pendingCommandIds?.length ?? 0)
      + (state.sourceRangeRecoveryReadinessDigest?.restartEnvelope?.pendingRowIds?.length ?? 0)
      + state.mailchimpSourceAnchorHandoff.acceptance.pendingAnchorIds.length
      + (state.mailchimpPersistedCommandEnvelope?.restartEnvelope?.pendingCommandIds?.length ?? 0)
      + state.mailchimpAstExportResumeLedger.restartEnvelope.pendingCommandIds.length
      + state.mailchimpCampaignExportQueue.restartEnvelope.pendingJobNames.length,
    blockedCount: (counters.commandByStatus.blocked ?? 0)
      + state.sourcePersistence.recovery.blockedAnchorIds.length
      + state.sourceOperationalTimeline.totals.blockedEventCount
      + (state.sourceRangeRecoveryCommandExport?.totals?.blockedCommandCount ?? 0)
      + (state.sourceRangeRecoveryReadinessDigest?.totals?.blockedCount ?? 0)
      + state.diagnosticClientState.validationSummary.blockedActionCount
      + state.mailchimpSourceAnchorHandoff.totals.blockedOperationCount
      + (state.mailchimpPersistedCommandEnvelope?.totals?.blockedCommandCount ?? 0)
      + state.mailchimpAstExportResumeLedger.totals.blockedCommandCount
      + state.mailchimpCampaignExportQueue.totals.blockedCount,
    counters: Object.freeze({
      commandByStatus: freezeSortedRecord(counters.commandByStatus),
      formatterLifecycleByStatus: freezeSortedRecord(counters.formatterLifecycleByStatus),
      formatterLifecycleCommandByStatus: freezeSortedRecord(counters.formatterLifecycleCommandByStatus),
      previewByAcceptance: freezeSortedRecord(counters.previewByAcceptance),
      sourceAnchorByStatus: freezeSortedRecord(counters.sourceAnchorByStatus),
      mailchimpSourceAnchorByStatus: counters.mailchimpSourceAnchorByStatus,
      mailchimpPersistedCommandByStatus: counters.mailchimpPersistedCommandByStatus,
      mailchimpAstResumeByStatus: counters.mailchimpAstResumeByStatus,
      mailchimpCampaignQueueByStatus: counters.mailchimpCampaignQueueByStatus,
      sourceOperationalByStatus: counters.sourceOperationalByStatus,
      sourceRecoveryCommandByStatus: counters.sourceRecoveryCommandByStatus,
      sourceRecoveryCommandByIntent: counters.sourceRecoveryCommandByIntent,
      sourceRecoveryReadinessByStatus: counters.sourceRecoveryReadinessByStatus,
      sourceRecoveryReadinessByKind: counters.sourceRecoveryReadinessByKind,
    }),
  });
}

function createFormatterAnalyticsExportReport(analyticsReport = {}, state = {}, options = {}) {
  const acceptedIds = normalizeFormatterReportIdSet(options.acceptedFormatterAnalyticsReportIds);
  const completedIds = normalizeFormatterReportIdSet(options.completedFormatterAnalyticsReportIds);
  const failedIds = normalizeFormatterReportIdSet(options.failedFormatterAnalyticsReportIds);
  const previousRows = normalizeFormatterReportPreviousRows(options.previousFormatterAnalyticsReportRows);
  const requireAcceptance = options.requireFormatterAnalyticsReportAcceptance !== false;
  const baseRows = [
    formatterAnalyticsReportRow({
      id: "formatter-analytics:counters",
      kind: "analyticsCounters",
      status: analyticsReport.status,
      label: "Formatter analytics counters",
      detail: `${analyticsReport.totals?.previewCount ?? 0} preview item(s), ${analyticsReport.totals?.commandCount ?? 0} command(s), ${analyticsReport.totals?.diagnosticCount ?? 0} diagnostic(s).`,
      count: Object.keys(analyticsReport.counters ?? {}).length,
      restartSafe: true,
      idempotencyKey: `${analyticsReport.fileName ?? "inline.aios"}:${analyticsReport.revision ?? "working"}:formatter-analytics:counters`,
      nextAction: analyticsReport.status === "blocked" ? "repair-formatter-analytics-counters" : "publish-formatter-analytics-counters",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:timeline",
      kind: "analyticsTimeline",
      status: normalizeFormatterReportStatus(analyticsReport.timeline?.length ? analyticsReport.status : "review"),
      label: "Formatter analytics timeline",
      detail: `${analyticsReport.timeline?.length ?? 0} formatter analytics timeline event(s) prepared for export.`,
      count: analyticsReport.timeline?.length ?? 0,
      restartSafe: true,
      idempotencyKey: `${analyticsReport.fileName ?? "inline.aios"}:${analyticsReport.revision ?? "working"}:formatter-analytics:timeline:${analyticsReport.timeline?.length ?? 0}`,
      nextAction: analyticsReport.timeline?.length ? "publish-formatter-analytics-timeline" : "rebuild-formatter-analytics-timeline",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:history",
      kind: "analyticsHistory",
      status: analyticsReport.history?.delta?.status === "changed" ? "review" : analyticsReport.history?.snapshots?.length ? "ready" : "review",
      label: "Formatter analytics history",
      detail: `${analyticsReport.history?.snapshots?.length ?? 0} formatter history snapshot(s); delta is ${analyticsReport.history?.delta?.status ?? "unbound"}.`,
      count: analyticsReport.history?.snapshots?.length ?? 0,
      restartSafe: true,
      idempotencyKey: `${analyticsReport.fileName ?? "inline.aios"}:${analyticsReport.revision ?? "working"}:formatter-analytics:history:${analyticsReport.history?.delta?.status ?? "unbound"}`,
      nextAction: analyticsReport.history?.snapshots?.length ? "publish-formatter-analytics-history" : "seed-formatter-analytics-history",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:lifecycle",
      kind: "formatterLifecycle",
      status: state.formatterLifecycle?.status ?? "unbound",
      label: "Formatter lifecycle report",
      detail: `${state.formatterLifecycle?.totals?.commandCount ?? 0} lifecycle command(s), ${state.formatterLifecycle?.totals?.diagnosticCount ?? 0} lifecycle diagnostic(s).`,
      count: state.formatterLifecycle?.totals?.commandCount ?? 0,
      restartSafe: state.formatterLifecycle?.restartEnvelope?.restartSafe !== false,
      idempotencyKey: state.formatterLifecycle?.restartEnvelope?.idempotencyKeys?.join(".") ?? null,
      nextAction: state.formatterLifecycle?.restartEnvelope?.nextAction ?? "publish-formatter-lifecycle-report",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:source",
      kind: "sourceOperationalReport",
      status: state.sourceOperationalTimeline?.status ?? state.sourceProviderExportSummary?.status ?? "unbound",
      label: "Source range analytics report",
      detail: `${state.sourceOperationalTimeline?.totals?.eventCount ?? 0} source operational event(s), ${state.sourceProviderExportSummary?.totals?.rangeCount ?? 0} range(s).`,
      count: state.sourceOperationalTimeline?.totals?.eventCount ?? 0,
      restartSafe: state.sourceOperationalTimeline?.restartEnvelope?.restartSafe !== false
        && state.sourceProviderExportSummary?.restartEnvelope?.restartSafe !== false,
      idempotencyKey: state.sourceOperationalTimeline?.restartEnvelope?.idempotencyKeys?.join(".") ?? state.sourceProviderExportSummary?.syncKey ?? null,
      nextAction: state.sourceOperationalTimeline?.restartEnvelope?.nextAction
        ?? state.sourceProviderExportSummary?.restartEnvelope?.nextAction
        ?? "publish-source-range-analytics-report",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:source-recovery-commands",
      kind: "sourceRecoveryCommandReport",
      status: state.sourceRangeRecoveryCommandExport?.status ?? "unbound",
      label: "Source range recovery commands",
      detail: `${state.sourceRangeRecoveryCommandExport?.totals?.commandCount ?? 0} recovery command(s), ${state.sourceRangeRecoveryCommandExport?.totals?.pendingCommandCount ?? 0} pending settlement.`,
      count: state.sourceRangeRecoveryCommandExport?.totals?.commandCount ?? 0,
      restartSafe: state.sourceRangeRecoveryCommandExport?.restartEnvelope?.restartSafe !== false,
      idempotencyKey: state.sourceRangeRecoveryCommandExport?.syncKey ?? null,
      nextAction: state.sourceRangeRecoveryCommandExport?.restartEnvelope?.nextAction
        ?? "publish-source-range-recovery-command-report",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:source-recovery-readiness",
      kind: "sourceRecoveryReadinessReport",
      status: state.sourceRangeRecoveryReadinessDigest?.status ?? "unbound",
      label: "Source range recovery readiness",
      detail: `${state.sourceRangeRecoveryReadinessDigest?.totals?.rowCount ?? 0} recovery readiness row(s), ${state.sourceRangeRecoveryReadinessDigest?.totals?.pendingCount ?? 0} pending acknowledgement.`,
      count: state.sourceRangeRecoveryReadinessDigest?.totals?.rowCount ?? 0,
      restartSafe: state.sourceRangeRecoveryReadinessDigest?.restartEnvelope?.restartSafe !== false,
      idempotencyKey: state.sourceRangeRecoveryReadinessDigest?.syncKey ?? null,
      nextAction: state.sourceRangeRecoveryReadinessDigest?.restartEnvelope?.nextAction
        ?? "publish-source-range-recovery-readiness-report",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:diagnostics",
      kind: "diagnosticReport",
      status: state.diagnosticHandoffGate?.status ?? state.diagnosticCommandSummary?.status ?? "unbound",
      label: "Diagnostic analytics report",
      detail: `${state.diagnosticCommandSummary?.totals?.commandCount ?? 0} diagnostic command(s), ${state.diagnosticHandoffGate?.totals?.gateCount ?? 0} handoff gate(s).`,
      count: state.diagnosticCommandSummary?.totals?.commandCount ?? 0,
      restartSafe: state.diagnosticHandoffGate?.restartEnvelope?.restartSafe !== false,
      idempotencyKey: state.diagnosticHandoffGate?.restartEnvelope?.idempotencyKeys?.join(".") ?? null,
      nextAction: state.diagnosticHandoffGate?.restartEnvelope?.nextAction
        ?? state.diagnosticCommandSummary?.restartEnvelope?.nextAction
        ?? "publish-diagnostic-analytics-report",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:mailchimp",
      kind: "mailchimpReport",
      status: state.mailchimpCampaignReleaseContract?.status ?? state.mailchimpReviewBoard?.status ?? state.mailchimpHandoff?.status ?? "unbound",
      label: "Mailchimp analytics report",
      detail: `${state.mailchimpHandoff?.operations?.length ?? 0} provider operation(s), ${state.mailchimpCampaignReleaseContract?.lanes?.length ?? 0} release lane(s).`,
      count: state.mailchimpHandoff?.operations?.length ?? 0,
      restartSafe: state.mailchimpCampaignReleaseContract?.restartEnvelope?.restartSafe !== false
        && state.mailchimpHandoff?.receiptContract?.restartSafe !== false,
      idempotencyKey: state.mailchimpCampaignReleaseContract?.syncKey ?? state.mailchimpHandoff?.syncMetadata?.syncKey ?? null,
      nextAction: state.mailchimpCampaignReleaseContract?.restartEnvelope?.nextAction
        ?? state.mailchimpReviewBoard?.restartEnvelope?.nextAction
        ?? state.mailchimpHandoff?.nextAction
        ?? "publish-mailchimp-analytics-report",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:mailchimp-ast",
      kind: "mailchimpAstAnalyticsReport",
      status: state.mailchimpAstAnalyticsExportBundle?.status ?? "unbound",
      label: "Mailchimp AST analytics report",
      detail: `${state.mailchimpAstAnalyticsExportBundle?.totals?.visitedNodeCount ?? 0} AST node(s), ${state.mailchimpAstAnalyticsExportBundle?.totals?.exportableNodeCount ?? 0} exportable contract row(s).`,
      count: state.mailchimpAstAnalyticsExportBundle?.totals?.rowCount ?? 0,
      restartSafe: state.mailchimpAstAnalyticsExportBundle?.restartEnvelope?.restartSafe !== false,
      idempotencyKey: state.mailchimpAstAnalyticsExportBundle?.syncKey ?? null,
      nextAction: state.mailchimpAstAnalyticsExportBundle?.restartEnvelope?.nextAction
        ?? "publish-mailchimp-ast-analytics-report",
    }),
    formatterAnalyticsReportRow({
      id: "formatter-analytics:mailchimp-persisted-commands",
      kind: "mailchimpPersistedCommandReport",
      status: state.mailchimpPersistedCommandEnvelope?.status ?? "unbound",
      label: "Mailchimp persisted command report",
      detail: `${state.mailchimpPersistedCommandEnvelope?.totals?.commandCount ?? 0} persisted command(s), ${state.mailchimpPersistedCommandEnvelope?.totals?.pendingCommandCount ?? 0} pending acceptance.`,
      count: state.mailchimpPersistedCommandEnvelope?.totals?.commandCount ?? 0,
      restartSafe: state.mailchimpPersistedCommandEnvelope?.restartEnvelope?.restartSafe !== false,
      idempotencyKey: state.mailchimpPersistedCommandEnvelope?.syncKey ?? null,
      nextAction: state.mailchimpPersistedCommandEnvelope?.restartEnvelope?.nextAction
        ?? "publish-mailchimp-persisted-command-report",
    }),
  ];
  const rows = baseRows.map((row) => finalizeFormatterAnalyticsReportRow(row, {
    acceptedIds,
    completedIds,
    failedIds,
    previousRows,
    requireAcceptance,
  }));
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const changed = rows.filter((row) => row.changeStatus === "changed" || row.changeStatus === "new");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length || changed.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "formatter-analytics-export-report.v1",
    status,
    ok: status === "ready" || status === "review",
    exportAllowed: status === "ready" || (status === "review" && options.allowReviewFormatterAnalyticsExport === true),
    fileName: analyticsReport.fileName ?? options.fileName ?? "inline.aios",
    revision: analyticsReport.revision ?? options.revision ?? "working",
    syncKey: [
      analyticsReport.exportSummary?.syncKey ?? "formatter-analytics-unbound",
      analyticsReport.history?.delta?.status ?? "history-unbound",
      rows.map((row) => row.idempotencyKey).filter(Boolean).join(".") || "report-rows-empty",
    ].join("|"),
    rows: Object.freeze(rows.sort((left, right) => formatterReportStatusOrder(left.status) - formatterReportStatusOrder(right.status) || left.id.localeCompare(right.id))),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countFormatterItemsBy(rows, "status")),
      byKind: freezeSortedRecord(countFormatterItemsBy(rows, "kind")),
      byChangeStatus: freezeSortedRecord(countFormatterItemsBy(rows, "changeStatus")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedRowCount: blocked.length,
      pendingRowCount: pending.length,
      reviewRowCount: review.length,
      changedRowCount: changed.length,
      acceptedRowCount: rows.filter((row) => row.accepted).length,
      completedRowCount: rows.filter((row) => row.completed).length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredRowIds: Object.freeze(rows.map((row) => row.id).sort()),
      acceptedRowIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(requireAcceptance ? pending.map((row) => row.id).sort() : []),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "formatter/analytics/export/recovery"
        : status === "pending"
          ? "formatter/analytics/export/acceptance"
          : status === "review"
            ? "formatter/analytics/export/review"
            : "formatter/analytics/export/summary",
      restartSafe: blocked.length === 0,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? changed[0]?.nextAction
        ?? "publish-formatter-analytics-export-report",
    }),
    exportSummary: Object.freeze({
      status,
      exportAllowed: status === "ready" || (status === "review" && options.allowReviewFormatterAnalyticsExport === true),
      restartSafe: blocked.length === 0,
      nextAction: status === "ready"
        ? "publish-formatter-analytics-export-report"
        : "resume-formatter-analytics-export-report",
    }),
    analyticsReport,
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
      mailchimpAstResumeStatus: snapshot.mailchimpAstResumeStatus ?? "unknown",
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
        mailchimpAstResumeByStatus: freezeSortedRecord(snapshot.counters?.mailchimpAstResumeByStatus ?? {}),
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
    phase: "mailchimp-ast-resume",
    status: state.mailchimpAstExportResumeLedger.status,
    label: "Mailchimp AST export resume",
    detail: `${state.mailchimpAstExportResumeLedger.totals.commandCount} AST export commands; ${state.mailchimpAstExportResumeLedger.totals.pendingCommandCount} pending resume.`,
    nextAction: state.mailchimpAstExportResumeLedger.restartEnvelope.nextAction,
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
    restartSafe: state.persistedState.restartSafe
      && mailchimpRecovery.restartSafe
      && state.mailchimpAstExportResumeLedger.restartSafe,
    fileName: state.plan.fileName,
    syncKey: [
      state.persistedState.syncKey,
      state.mailchimpAstExportResumeLedger.restartEnvelope.idempotencyKeys.join(".") || "mailchimp-ast-resume-empty",
    ].join("|"),
    blockedCount: blockedCommands.length
      + state.sourcePersistence.recovery.blockedAnchorIds.length
      + state.sourceOperationalTimeline.totals.blockedEventCount
      + state.mailchimpSourceAnchorHandoff.totals.blockedOperationCount
      + state.mailchimpAstExportResumeLedger.totals.blockedCommandCount
      + state.diagnosticClientState.validationSummary.blockedActionCount,
    pendingCount: pendingCommands.length
      + state.sourcePersistence.recovery.pendingAnchorIds.length
      + state.sourceOperationalTimeline.totals.pendingEventCount
      + state.mailchimpSourceAnchorHandoff.totals.pendingOperationCount
      + state.mailchimpAstExportResumeLedger.totals.pendingCommandCount
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
    mailchimpAstResume: Object.freeze({
      status: state.mailchimpAstExportResumeLedger.status,
      exportAllowed: state.mailchimpAstExportResumeLedger.exportAllowed,
      restartSafe: state.mailchimpAstExportResumeLedger.restartSafe,
      blockedCommandIds: state.mailchimpAstExportResumeLedger.restartEnvelope.blockedCommandIds,
      pendingCommandIds: state.mailchimpAstExportResumeLedger.restartEnvelope.pendingCommandIds,
      reviewCommandIds: state.mailchimpAstExportResumeLedger.restartEnvelope.reviewCommandIds,
      nextAction: state.mailchimpAstExportResumeLedger.restartEnvelope.nextAction,
    }),
    nextAction: status === "ready"
      ? "export-formatter-contract-summary"
      : state.mailchimpAstExportResumeLedger.status === "blocked" || state.mailchimpAstExportResumeLedger.status === "pending"
        ? state.mailchimpAstExportResumeLedger.restartEnvelope.nextAction
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
      id: "formatter-lifecycle",
      label: "Formatter lifecycle",
      status: state.formatterLifecycle?.status ?? "ready",
      exportAllowed: state.formatterLifecycle?.exportAllowed !== false,
      count: state.formatterLifecycle?.totals?.commandCount ?? 0,
      nextAction: state.formatterLifecycle?.restartEnvelope?.nextAction ?? "publish-formatter-lifecycle-state",
      handoff: state.formatterLifecycle?.restartEnvelope?.route ?? "formatter/lifecycle/summary",
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
      id: "mailchimp-ast-export-resume",
      label: "Mailchimp AST export resume",
      status: state.mailchimpAstExportResumeLedger.status,
      exportAllowed: state.mailchimpAstExportResumeLedger.exportAllowed,
      count: state.mailchimpAstExportResumeLedger.totals.commandCount,
      nextAction: state.mailchimpAstExportResumeLedger.restartEnvelope.nextAction,
      handoff: state.mailchimpAstExportResumeLedger.restartEnvelope.route,
    }),
    formatterExportEvidenceLane({
      id: "mailchimp-ast-analytics",
      label: "Mailchimp AST analytics",
      status: state.mailchimpAstAnalyticsExportBundle?.status ?? "idle",
      exportAllowed: state.mailchimpAstAnalyticsExportBundle?.exportAllowed !== false,
      count: state.mailchimpAstAnalyticsExportBundle?.totals?.rowCount ?? 0,
      nextAction: state.mailchimpAstAnalyticsExportBundle?.restartEnvelope?.nextAction ?? "publish-mailchimp-ast-analytics-export-bundle",
      handoff: state.mailchimpAstAnalyticsExportBundle?.restartEnvelope?.route ?? "mailchimp/ast-analytics/export",
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
      id: "source-recovery-commands",
      label: "Source recovery commands",
      status: state.sourceRangeRecoveryCommandExport?.status ?? "idle",
      exportAllowed: state.sourceRangeRecoveryCommandExport?.exportAllowed !== false,
      count: state.sourceRangeRecoveryCommandExport?.totals?.commandCount ?? 0,
      nextAction: state.sourceRangeRecoveryCommandExport?.restartEnvelope?.nextAction ?? "publish-source-range-recovery-command-export",
      handoff: state.sourceRangeRecoveryCommandExport?.restartEnvelope?.route ?? "source-ranges/recovery-commands/export",
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
      id: "diagnostic-handoff-gate",
      label: "Diagnostic handoff gate",
      status: state.diagnosticHandoffGate?.status ?? "idle",
      exportAllowed: state.diagnosticHandoffGate?.exportAllowed !== false,
      count: state.diagnosticHandoffGate?.totals?.gateCount ?? 0,
      nextAction: state.diagnosticHandoffGate?.restartEnvelope?.nextAction ?? "publish-diagnostic-handoff-gate",
      handoff: state.diagnosticHandoffGate?.restartEnvelope?.route ?? "diagnostics/handoff-gate/summary",
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
      id: "mailchimp-persisted-commands",
      label: "Mailchimp persisted commands",
      status: state.mailchimpPersistedCommandEnvelope?.status ?? "idle",
      exportAllowed: state.mailchimpPersistedCommandEnvelope?.exportAllowed !== false,
      count: state.mailchimpPersistedCommandEnvelope?.totals?.commandCount ?? 0,
      nextAction: state.mailchimpPersistedCommandEnvelope?.restartEnvelope?.nextAction ?? "publish-mailchimp-persisted-command-envelope",
      handoff: state.mailchimpPersistedCommandEnvelope?.restartEnvelope?.route ?? "mailchimp/persisted-commands/export",
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
      id: "mailchimp-runtime-request",
      label: "Mailchimp runtime request",
      status: state.mailchimpRuntimeRequest?.status ?? "idle",
      exportAllowed: state.mailchimpRuntimeRequest?.exportAllowed !== false,
      count: state.mailchimpRuntimeRequest?.totals?.rowCount ?? 0,
      nextAction: state.mailchimpRuntimeRequest?.restartEnvelope?.nextAction ?? "publish-mailchimp-runtime-request",
      handoff: state.mailchimpRuntimeRequest?.restartEnvelope?.route ?? "mailchimp/runtime-request/summary",
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
      && state.formatterLifecycle?.restartEnvelope?.restartSafe !== false
      && state.mailchimpSourceAnchorHandoff.restartEnvelope.restartSafe
      && state.mailchimpAstExportResumeLedger.restartSafe
      && state.mailchimpAstAnalyticsExportBundle?.restartEnvelope?.restartSafe !== false
      && state.mailchimpCampaignExportQueue.restartEnvelope.restartSafe
      && state.diagnosticExportState.exportSummary.restartSafe
      && state.diagnosticHandoffGate?.restartEnvelope?.restartSafe !== false
      && state.mailchimpRuntimeRequest?.restartEnvelope?.restartSafe !== false
      && state.mailchimpTenantBoundary.handoff.restartSafe
      && state.mailchimpHandoff.receiptContract?.restartSafe !== false,
    syncKey: [
      state.persistedState.syncKey,
      state.sourceExportManifest.syncKey,
      state.astExportEvidence.exportSummary.syncKey,
      state.mailchimpAstExportResumeLedger.restartEnvelope.idempotencyKeys.join(".") || "mailchimp-ast-resume-empty",
      state.mailchimpAstAnalyticsExportBundle?.syncKey ?? "mailchimp-ast-analytics-unbound",
      state.mailchimpCampaignExportQueue.exportSummary.syncKey,
      state.mailchimpSourceAnchorHandoff.syncKey,
      state.mailchimpRuntimeRequest?.syncKey ?? "mailchimp-runtime-request-unbound",
      state.mailchimpTenantBoundary.syncKey,
      state.diagnosticHandoffGate?.restartEnvelope?.idempotencyKeys?.join(".") || "diagnostic-handoff-gate-empty",
      state.analyticsReport.exportSummary.syncKey,
    ].join("|"),
    lanes: Object.freeze(lanes),
    counters: Object.freeze({
      laneByStatus: freezeSortedRecord(countFormatterItemsBy(lanes, "status")),
      previewByAcceptance: state.analyticsReport.counters.previewByAcceptance,
      astByStatus: state.astExportEvidence.counters.astByStatus,
      mailchimpAstResumeByStatus: state.mailchimpAstExportResumeLedger.counters,
      mailchimpAstAnalyticsByStatus: state.mailchimpAstAnalyticsExportBundle?.counters?.byStatus ?? Object.freeze({}),
      mailchimpCampaignQueueByStatus: state.mailchimpCampaignExportQueue.counters.byStatus,
      mailchimpCampaignQueueByAcceptance: state.mailchimpCampaignExportQueue.counters.byAcceptance,
      sourceAnchorByStatus: state.sourceExportManifest.counters.anchorByStatus,
      mailchimpSourceAnchorByStatus: state.mailchimpSourceAnchorHandoff.counters.byStatus,
      sourceOperationalByStatus: state.sourceOperationalTimeline.counters.byStatus,
      diagnosticActionByStatus: state.diagnosticExportState.counters.runtimeActionByStatus,
      diagnosticHandoffGateByStatus: state.diagnosticHandoffGate?.counters?.byStatus ?? {},
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
        && state.mailchimpAstExportResumeLedger.restartSafe
        && state.mailchimpCampaignExportQueue.restartEnvelope.restartSafe
        && state.diagnosticExportState.exportSummary.restartSafe
        && state.diagnosticHandoffGate?.restartEnvelope?.restartSafe !== false
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
  const serviceSyncWindowCommands = (state.mailchimpWorkflow.providerContract?.serviceSyncWindows?.windows ?? [])
    .map((window) => Object.freeze({
      id: `mailchimp-service-sync-window:${window.id}`,
      kind: "mailchimpServiceSyncWindow",
      target: window.channel,
      status: window.status === "blocked"
        ? "blocked"
        : window.status === "pending" || window.status === "review"
          ? "pending"
          : "ready",
      idempotencyKey: window.idempotencyKey,
      restartSafe: window.restartSafe !== false,
      nextAction: window.nextAction,
      windowState: window.status,
    }));
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

  return Object.freeze([...previewCommands, ...operationCommands, ...serviceSyncWindowCommands, ...receiptCommands, ...tenantBoundaryCommands, ...sourceCommands, ...diagnosticCommands]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)));
}

function formatterAnalyticsReportRow(row) {
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    status: normalizeFormatterReportStatus(row.status),
    label: row.label,
    detail: row.detail,
    count: Number.isFinite(Number(row.count)) ? Math.max(0, Math.trunc(Number(row.count))) : 0,
    restartSafe: row.restartSafe !== false,
    idempotencyKey: row.idempotencyKey ?? null,
    nextAction: row.nextAction,
  });
}

function finalizeFormatterAnalyticsReportRow(row, state) {
  const previous = state.previousRows.get(row.id) ?? null;
  const completed = state.completedIds.has(row.id);
  const failed = state.failedIds.has(row.id);
  const accepted = state.acceptedIds.has(row.id) || state.requireAcceptance === false;
  const changed = previous
    ? previous.idempotencyKey !== row.idempotencyKey || previous.status !== row.status || previous.count !== row.count
    : true;
  const blocked = failed || row.status === "blocked" || row.restartSafe === false;
  const status = blocked
    ? "blocked"
    : completed
      ? "ready"
      : state.requireAcceptance && !accepted
        ? "pending"
        : row.status === "pending"
          ? "pending"
          : row.status === "review" || changed
            ? "review"
            : "ready";

  return Object.freeze({
    ...row,
    status,
    accepted,
    completed,
    failed,
    changeStatus: previous ? changed ? "changed" : "unchanged" : "new",
    previousStatus: previous?.status ?? null,
    previousIdempotencyKey: previous?.idempotencyKey ?? null,
    restartSafe: row.restartSafe !== false && !failed,
    nextAction: blocked
      ? row.nextAction ?? "repair-formatter-analytics-export-report"
      : completed
        ? "retain-formatter-analytics-export-row"
        : state.requireAcceptance && !accepted
          ? "accept-formatter-analytics-export-row"
          : changed
            ? "review-formatter-analytics-export-row"
            : row.nextAction ?? "publish-formatter-analytics-export-row",
  });
}

function normalizeFormatterReportStatus(status) {
  if (status === "ready" || status === "idle" || status === "empty") return "ready";
  if (status === "pending" || status === "needsAcceptance") return "pending";
  if (status === "blocked" || status === "failed" || status === "disabled") return "blocked";
  if (status === "review" || status === "degraded" || status === "unbound") return "review";
  return status ? "review" : "review";
}

function normalizeFormatterReportIdSet(value) {
  return new Set((Array.isArray(value) ? value : [])
    .map((id) => String(id).trim())
    .filter(Boolean)
    .sort());
}

function normalizeFormatterReportPreviousRows(value) {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  return new Map(rows
    .filter((row) => row && typeof row === "object" && row.id)
    .map((row) => [String(row.id), Object.freeze({
      id: String(row.id),
      status: normalizeFormatterReportStatus(row.status),
      count: Number.isFinite(Number(row.count)) ? Math.max(0, Math.trunc(Number(row.count))) : 0,
      idempotencyKey: row.idempotencyKey ?? null,
    })]));
}

function formatterReportStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
  }[status] ?? 4;
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
