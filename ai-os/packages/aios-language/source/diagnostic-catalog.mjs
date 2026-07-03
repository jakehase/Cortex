import {
  AIOS_AST_NODE_KINDS,
  createMailchimpLaunchGateContract,
  createMailchimpProviderCommandContract,
  createMailchimpProviderReceiptContract,
  createMailchimpTenantPermissionBoundaryContract,
  getAstNodeKindContract,
  normalizeAstNodeKind,
} from "./ast-node-kinds.mjs";

export const AIOS_DIAGNOSTIC_CATALOG = Object.freeze({
  AIOS_AST_PROGRAM: catalogEntry({
    code: "AIOS_AST_PROGRAM",
    severity: "error",
    stage: "parse",
    nodeKind: AIOS_AST_NODE_KINDS.Program,
    message: "Expected a Program AST root.",
    recovery: "block-export",
    status: "blocked",
    handoff: "diagnostic-summary",
  }),
  AIOS_NO_JOBS: catalogEntry({
    code: "AIOS_NO_JOBS",
    severity: "warning",
    stage: "parse",
    nodeKind: AIOS_AST_NODE_KINDS.Program,
    message: "No jobs were declared in this source file.",
    recovery: "continue-empty",
    status: "review",
    handoff: "format-preview",
  }),
  AIOS_DUPLICATE_JOB: catalogEntry({
    code: "AIOS_DUPLICATE_JOB",
    severity: "error",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Job names must be unique.",
    recovery: "rename-symbol",
    status: "blocked",
    handoff: "descriptor-addressing",
  }),
  AIOS_DUPLICATE_CAPABILITY: catalogEntry({
    code: "AIOS_DUPLICATE_CAPABILITY",
    severity: "error",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.CapabilityDeclaration,
    message: "Capability names must be unique within a job.",
    recovery: "merge-or-rename-capability",
    status: "blocked",
    handoff: "provider-capability-negotiation",
  }),
  AIOS_CAPABILITY_SCOPE: catalogEntry({
    code: "AIOS_CAPABILITY_SCOPE",
    severity: "error",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.CapabilityDeclaration,
    message: "Capability declarations must include a scope.",
    recovery: "add-read-or-write-scope",
    status: "blocked",
    handoff: "provider-contract",
  }),
  AIOS_DUPLICATE_MEMORY: catalogEntry({
    code: "AIOS_DUPLICATE_MEMORY",
    severity: "error",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.MemoryDeclaration,
    message: "Memory lane names must be unique within a job.",
    recovery: "merge-or-rename-memory-lane",
    status: "blocked",
    handoff: "memory-sync-index",
  }),
  AIOS_MEMORY_MODE: catalogEntry({
    code: "AIOS_MEMORY_MODE",
    severity: "error",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.MemoryDeclaration,
    message: "Memory lanes must use a supported mode.",
    recovery: "choose-ephemeral-session-or-persistent",
    status: "blocked",
    handoff: "memory-retention-policy",
  }),
  AIOS_DUPLICATE_STEP: catalogEntry({
    code: "AIOS_DUPLICATE_STEP",
    severity: "error",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.StepDeclaration,
    message: "Step names must be unique within a job.",
    recovery: "rename-step",
    status: "blocked",
    handoff: "adapter-status-handoff",
  }),
  AIOS_STEP_ADAPTER: catalogEntry({
    code: "AIOS_STEP_ADAPTER",
    severity: "error",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.StepDeclaration,
    message: "Steps must name an adapter operation.",
    recovery: "bind-adapter-operation",
    status: "blocked",
    handoff: "provider-operation",
  }),
  AIOS_MEMORY_REFERENCE: catalogEntry({
    code: "AIOS_MEMORY_REFERENCE",
    severity: "error",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.StepDeclaration,
    message: "Step memory references must point at declared memory lanes.",
    recovery: "declare-memory-or-fix-reference",
    status: "blocked",
    handoff: "memory-read-write-index",
  }),
  AIOS_VERIFIER_EXPRESSION: catalogEntry({
    code: "AIOS_VERIFIER_EXPRESSION",
    severity: "error",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.VerifierDeclaration,
    message: "Verifier declarations must contain a claim expression.",
    recovery: "add-claim-expression",
    status: "blocked",
    handoff: "claim-contract",
  }),
  AIOS_TRUTH_BOUNDARY: catalogEntry({
    code: "AIOS_TRUTH_BOUNDARY",
    severity: "warning",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.TruthBoundaryDeclaration,
    message: "Truth boundaries should include source and confidence metadata.",
    recovery: "add-source-confidence",
    status: "review",
    handoff: "truth-audit",
  }),
  AIOS_ROLLBACK_TARGET: catalogEntry({
    code: "AIOS_ROLLBACK_TARGET",
    severity: "warning",
    stage: "validate",
    nodeKind: AIOS_AST_NODE_KINDS.RollbackDeclaration,
    message: "Compensating rollback should target a memory lane.",
    recovery: "select-rollback-memory-target",
    status: "review",
    handoff: "recovery-route",
  }),
  AIOS_SOURCE_RANGE: catalogEntry({
    code: "AIOS_SOURCE_RANGE",
    severity: "error",
    stage: "source-map",
    nodeKind: null,
    message: "Source range offsets must be ordered and finite.",
    recovery: "normalize-range-before-handoff",
    status: "blocked",
    handoff: "source-preview",
  }),
  AIOS_FORMAT_RULE: catalogEntry({
    code: "AIOS_FORMAT_RULE",
    severity: "warning",
    stage: "format",
    nodeKind: null,
    message: "Formatter rule contracts must target known AST node kinds.",
    recovery: "drop-unknown-format-rule",
    status: "review",
    handoff: "format-preview",
  }),
  AIOS_MAILCHIMP_PROVIDER_CONTRACT: catalogEntry({
    code: "AIOS_MAILCHIMP_PROVIDER_CONTRACT",
    severity: "error",
    stage: "provider",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp workflows must declare provider capabilities and audience binding before handoff.",
    recovery: "bind-mailchimp-provider-contract",
    status: "blocked",
    handoff: "mailchimp-provider-contract",
  }),
  AIOS_MAILCHIMP_CAMPAIGN_DISABLED: catalogEntry({
    code: "AIOS_MAILCHIMP_CAMPAIGN_DISABLED",
    severity: "error",
    stage: "lifecycle",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp campaign workflow is disabled while export requires an enabled lifecycle.",
    recovery: "enable-mailchimp-campaign-workflow",
    status: "blocked",
    handoff: "mailchimp-campaign-lifecycle",
  }),
  AIOS_MAILCHIMP_SCHEDULE: catalogEntry({
    code: "AIOS_MAILCHIMP_SCHEDULE",
    severity: "warning",
    stage: "lifecycle",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp campaign scheduling controls need a supported mode and next run metadata.",
    recovery: "select-mailchimp-schedule-mode",
    status: "review",
    handoff: "mailchimp-schedule-state",
  }),
  AIOS_MAILCHIMP_TENANT_PERMISSION: catalogEntry({
    code: "AIOS_MAILCHIMP_TENANT_PERMISSION",
    severity: "error",
    stage: "provider",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp workflows must stay inside the configured tenant, workspace, and role permission boundary.",
    recovery: "bind-mailchimp-tenant-permissions",
    status: "blocked",
    handoff: "mailchimp-tenant-permission-audit",
  }),
  AIOS_MAILCHIMP_OPERATIONAL_HEALTH: catalogEntry({
    code: "AIOS_MAILCHIMP_OPERATIONAL_HEALTH",
    severity: "warning",
    stage: "provider",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp provider command health requires retry, backoff, or idempotency recovery before external handoff.",
    recovery: "repair-mailchimp-operational-health",
    status: "review",
    handoff: "mailchimp-operational-health",
  }),
  AIOS_MAILCHIMP_PROVIDER_RECEIPT: catalogEntry({
    code: "AIOS_MAILCHIMP_PROVIDER_RECEIPT",
    severity: "warning",
    stage: "provider",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp provider receipts must be acknowledged or settled before export evidence is finalized.",
    recovery: "reconcile-mailchimp-provider-receipts",
    status: "review",
    handoff: "mailchimp-provider-receipt",
  }),
  AIOS_MAILCHIMP_LAUNCH_GATE: catalogEntry({
    code: "AIOS_MAILCHIMP_LAUNCH_GATE",
    severity: "error",
    stage: "lifecycle",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp launch gates must be ready or explicitly accepted before external campaign handoff.",
    recovery: "complete-mailchimp-launch-gates",
    status: "blocked",
    handoff: "mailchimp-launch-gate",
  }),
  AIOS_MAILCHIMP_SOURCE_ANCHOR: catalogEntry({
    code: "AIOS_MAILCHIMP_SOURCE_ANCHOR",
    severity: "error",
    stage: "source-map",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp provider operations require accepted source anchors before external campaign handoff.",
    recovery: "accept-mailchimp-source-anchors",
    status: "blocked",
    handoff: "mailchimp-source-anchor",
  }),
});

export const AIOS_DIAGNOSTIC_LIFECYCLE_COMMANDS = Object.freeze({
  disableCode: lifecycleCommand({
    id: "disableCode",
    label: "Disable diagnostic code",
    allowedStatuses: ["review", "ready"],
    requiresReason: true,
    nextAction: "record-disable-reason",
  }),
  enableCode: lifecycleCommand({
    id: "enableCode",
    label: "Enable diagnostic code",
    allowedStatuses: ["blocked", "review", "ready"],
    requiresReason: false,
    nextAction: "rerun-diagnostics",
  }),
  scheduleRecovery: lifecycleCommand({
    id: "scheduleRecovery",
    label: "Schedule recovery",
    allowedStatuses: ["blocked", "review"],
    requiresReason: false,
    nextAction: "open-recovery-task",
  }),
  acceptReady: lifecycleCommand({
    id: "acceptReady",
    label: "Accept ready catalog state",
    allowedStatuses: ["ready"],
    requiresReason: false,
    nextAction: "emit-export-summary",
  }),
});

export function listDiagnosticCatalogEntries(filter = {}) {
  return Object.freeze(Object.values(AIOS_DIAGNOSTIC_CATALOG)
    .filter((entry) => !filter.stage || entry.stage === filter.stage)
    .filter((entry) => !filter.severity || entry.severity === filter.severity)
    .filter((entry) => !filter.nodeKind || entry.nodeKind === normalizeAstNodeKind(filter.nodeKind))
    .sort((left, right) => left.code.localeCompare(right.code)));
}

export function explainDiagnosticCode(code) {
  return AIOS_DIAGNOSTIC_CATALOG[code] ?? catalogEntry({
    code: code ?? "AIOS_UNKNOWN",
    severity: "error",
    stage: "unknown",
    nodeKind: null,
    message: "Uncataloged AI OS diagnostic.",
    recovery: "inspect-diagnostic",
    status: "blocked",
    handoff: "diagnostic-summary",
  });
}

export function createCatalogDiagnostic(code, overrides = {}) {
  const entry = explainDiagnosticCode(code);
  return Object.freeze({
    code: entry.code,
    severity: overrides.severity ?? entry.severity,
    message: overrides.message ?? entry.message,
    range: overrides.range ?? null,
    preview: overrides.preview ?? "",
    hint: overrides.hint ?? recoveryHint(entry),
    catalog: Object.freeze({
      stage: entry.stage,
      nodeKind: entry.nodeKind,
      recovery: entry.recovery,
      status: entry.status,
      handoff: entry.handoff,
    }),
  });
}

export function createDiagnosticRecoveryPlan(diagnostics = []) {
  const actions = new Map();
  let blocked = false;

  for (const diagnostic of diagnostics) {
    const entry = explainDiagnosticCode(diagnostic.code);
    blocked = blocked || entry.status === "blocked" || diagnostic.severity === "error";
    const current = actions.get(entry.recovery) ?? {
      id: entry.recovery,
      status: entry.status,
      handoff: entry.handoff,
      count: 0,
      codes: new Set(),
    };
    current.count += 1;
    current.codes.add(entry.code);
    if (entry.status === "blocked") current.status = "blocked";
    actions.set(entry.recovery, current);
  }

  return Object.freeze({
    state: blocked ? "blocked" : actions.size > 0 ? "review" : "ready",
    exportAllowed: !blocked,
    actions: Object.freeze([...actions.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((action) => Object.freeze({
        id: action.id,
        status: action.status,
        handoff: action.handoff,
        count: action.count,
        codes: Object.freeze([...action.codes].sort()),
      }))),
  });
}

export function listDiagnosticLifecycleCommands(filter = {}) {
  return Object.freeze(Object.values(AIOS_DIAGNOSTIC_LIFECYCLE_COMMANDS)
    .filter((command) => !filter.status || command.allowedStatuses.includes(filter.status))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

export function createDiagnosticLifecycleState(diagnostics = [], settings = {}) {
  const recoveryPlan = createDiagnosticRecoveryPlan(diagnostics);
  const disabledCodes = normalizeCodeSet(settings.disabledCodes);
  const enabledCodes = normalizeCodeSet(settings.enabledCodes);
  const scheduledRecoveries = normalizeSchedule(settings.scheduledRecoveries);
  const controls = [];
  const suppressed = [];
  const activeDiagnostics = [];

  for (const diagnostic of diagnostics) {
    const entry = explainDiagnosticCode(diagnostic.code);
    const disabled = disabledCodes.has(entry.code) && entry.status !== "blocked";
    const explicitlyEnabled = enabledCodes.has(entry.code);
    const lifecycleStatus = disabled && !explicitlyEnabled ? "disabled" : entry.status;
    const schedule = scheduledRecoveries.get(entry.recovery) ?? null;
    const control = createDiagnosticControl(entry, {
      disabled,
      explicitlyEnabled,
      schedule,
      severity: diagnostic.severity ?? entry.severity,
    });
    controls.push(control);
    if (disabled && !explicitlyEnabled) {
      suppressed.push(Object.freeze({
        code: entry.code,
        recovery: entry.recovery,
        reason: settings.disableReasons?.[entry.code] ?? "disabled-by-settings",
      }));
    } else {
      activeDiagnostics.push(diagnostic);
    }
    if (lifecycleStatus === "disabled" && entry.status === "blocked") {
      controls.push(Object.freeze({
        code: entry.code,
        command: "enableCode",
        state: "required",
        reason: "blocked-diagnostics-cannot-be-suppressed",
        nextAction: "rerun-diagnostics",
      }));
    }
  }

  const activePlan = createDiagnosticRecoveryPlan(activeDiagnostics);
  const settingsValidation = validateDiagnosticLifecycleSettings(settings);
  const nextAction = selectLifecycleNextAction(activePlan, controls, settingsValidation);

  return Object.freeze({
    ok: activePlan.exportAllowed && settingsValidation.ok,
    state: settingsValidation.ok ? activePlan.state : "blocked",
    exportAllowed: activePlan.exportAllowed && settingsValidation.ok,
    nextAction,
    controls: Object.freeze(controls.sort(compareDiagnosticControls)),
    suppressed: Object.freeze(suppressed.sort((left, right) => left.code.localeCompare(right.code))),
    scheduledRecoveries: Object.freeze([...scheduledRecoveries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([recovery, schedule]) => Object.freeze({ recovery, ...schedule }))),
    recoveryPlan,
    activeRecoveryPlan: activePlan,
    settingsValidation,
  });
}

export function createMailchimpWorkflowDiagnostics(workflowState = {}, overrides = {}) {
  const issues = Array.isArray(workflowState.issues) ? workflowState.issues : [];
  return Object.freeze(issues.map((issue) => {
    const severity = issue.status === "blocked" ? "error" : "warning";
    return createCatalogDiagnostic(issue.code, {
      severity,
      message: issue.detail,
      hint: createMailchimpWorkflowHint(issue, workflowState),
      preview: createMailchimpWorkflowPreview(issue, workflowState, overrides),
      range: overrides.rangeByJobName?.[issue.jobName] ?? null,
    });
  }));
}

export function createMailchimpProviderHandoffState(workflowState = {}, diagnostics = [], settings = {}) {
  const byHandoff = {};
  const jobs = Array.isArray(workflowState.jobs) ? workflowState.jobs : [];
  const serviceContract = workflowState.providerContract ?? null;
  const actionableJobs = jobs
    .filter((job) => job.detected)
    .map((job) => Object.freeze({
      jobName: job.jobName,
      status: job.status,
      enabled: job.enabled,
      scheduleMode: job.schedule?.mode ?? "manual",
      scheduleWindowMode: job.schedule?.window?.mode ?? job.scheduleWindow?.mode ?? "anytime",
      scheduleWindowStatus: job.schedule?.window?.status ?? job.scheduleWindow?.status ?? "ready",
      scheduleWindowTimezone: job.schedule?.window?.timezone ?? job.scheduleWindow?.timezone ?? "UTC",
      audienceBound: Boolean(job.audienceBound),
      tenantBoundaryStatus: job.tenantBoundary?.status ?? "unbound",
      tenantId: job.tenantBoundary?.operationBoundary?.tenantId ?? null,
      workspaceId: job.tenantBoundary?.operationBoundary?.workspaceId ?? null,
      permissionRole: job.tenantBoundary?.operationBoundary?.role ?? null,
      mailchimpStepCount: job.mailchimpStepCount ?? 0,
      operationCount: job.serviceOperations?.length ?? 0,
      nextAction: job.tenantBoundary?.status === "blocked" || job.tenantBoundary?.status === "review"
        ? job.tenantBoundary.nextAction
        : job.handoff?.nextAction ?? "publish-mailchimp-workflow-contract",
    }));
  const operations = Array.isArray(serviceContract?.operations)
    ? serviceContract.operations.map((operation) => createMailchimpOperationPreview(operation))
    : jobs.flatMap((job) => (job.serviceOperations ?? []).map((operation) => createMailchimpOperationPreview(operation)));
  const commandContract = createMailchimpProviderCommandContract(workflowState, {
    acceptedOperationIds: settings.acceptedMailchimpOperationIds,
    queuedCommandIds: settings.queuedMailchimpCommandIds,
    failedCommandIds: settings.failedMailchimpCommandIds,
    retryAfterByOperationId: settings.mailchimpRetryAfterByOperationId,
    attemptByOperationId: settings.mailchimpAttemptByOperationId,
    requireAcceptance: settings.requireMailchimpOperationAcceptance,
    degradedMode: settings.mailchimpDegradedMode,
    maxRetryAttempts: settings.mailchimpMaxRetryAttempts,
    retryBaseSeconds: settings.mailchimpRetryBaseSeconds,
  });
  const receiptContract = createMailchimpProviderReceiptContract(commandContract, {
    receivedCommandIds: settings.receivedMailchimpCommandIds,
    acknowledgedCommandIds: settings.acknowledgedMailchimpCommandIds,
    completedCommandIds: settings.completedMailchimpCommandIds,
    failedCommandIds: settings.receiptFailedMailchimpCommandIds ?? settings.failedReceiptMailchimpCommandIds,
    duplicateCommandIds: settings.duplicateMailchimpCommandIds,
    receiptIdByCommandId: settings.mailchimpReceiptIdByCommandId,
    providerMessageByCommandId: settings.mailchimpProviderMessageByCommandId,
    receivedAtByCommandId: settings.mailchimpReceiptReceivedAtByCommandId,
  });
  const healthDiagnostics = createMailchimpOperationalHealthDiagnostics(commandContract.operationalHealth, {
    rangeByJobName: settings.rangeByJobName,
  });
  const receiptDiagnostics = createMailchimpProviderReceiptDiagnostics(receiptContract, {
    rangeByJobName: settings.rangeByJobName,
  });
  const tenantBoundaryContract = createMailchimpTenantPermissionBoundaryContract(workflowState, {
    revision: settings.revision,
    externalRunId: serviceContract?.syncMetadata?.externalRunId,
  });
  const tenantBoundaryDiagnostics = createMailchimpTenantPermissionBoundaryDiagnostics(tenantBoundaryContract, {
    rangeByJobName: settings.rangeByJobName,
  });
  const activeDiagnostics = Object.freeze([
    ...(Array.isArray(diagnostics) ? diagnostics : []),
    ...healthDiagnostics,
    ...receiptDiagnostics,
    ...tenantBoundaryDiagnostics,
  ]);
  const recoveryPlan = createDiagnosticRecoveryPlan(activeDiagnostics);

  for (const diagnostic of activeDiagnostics) {
    const handoff = diagnostic.catalog?.handoff ?? "diagnostic-summary";
    byHandoff[handoff] = (byHandoff[handoff] ?? 0) + 1;
  }

  const readinessPreview = createMailchimpProviderReadinessPreview(workflowState, activeDiagnostics, {
    operations,
    recoveryPlan,
    requireAcceptance: settings.requireMailchimpOperationAcceptance,
    tenantBoundary: workflowState.tenantBoundary,
  });

  return Object.freeze({
    ok: workflowState.ok !== false
      && recoveryPlan.exportAllowed
      && readinessPreview.status !== "blocked"
      && commandContract.status !== "blocked"
      && commandContract.operationalHealth.status !== "blocked"
      && receiptContract.status !== "blocked"
      && receiptContract.status !== "failed"
      && tenantBoundaryContract.status !== "blocked",
    status: commandContract.status === "blocked"
      || commandContract.operationalHealth.status === "blocked"
      || receiptContract.status === "blocked"
      || receiptContract.status === "failed"
      || tenantBoundaryContract.status === "blocked"
      ? "blocked"
      : commandContract.status === "degraded"
        || commandContract.operationalHealth.status === "degraded"
        || receiptContract.status === "pending"
        || tenantBoundaryContract.status === "review"
        ? "review"
        : readinessPreview.status,
    providerId: workflowState.providerId ?? "mailchimp",
    detected: Boolean(workflowState.detected),
    exportAllowed: workflowState.handoff?.exportAllowed !== false
      && recoveryPlan.exportAllowed
      && readinessPreview.acceptance.acceptable
      && commandContract.status !== "blocked"
      && commandContract.operationalHealth.status !== "blocked"
      && receiptContract.externalHandoff.exportAllowed
      && tenantBoundaryContract.exportAllowed,
    diagnosticCount: activeDiagnostics.length,
    byHandoff: freezeSortedRecord(byHandoff),
    jobs: Object.freeze(actionableJobs),
    operations: Object.freeze(operations),
    commandContract,
    receiptContract,
    operationalHealth: Object.freeze({
      ...commandContract.operationalHealth,
      diagnostics: healthDiagnostics,
    }),
    recoveryPlan,
    readinessPreview,
    syncMetadata: Object.freeze({
      providerContractVersion: serviceContract?.serviceContractVersion ?? "mailchimp-workflow-handoff.v1",
      workflowJobCount: workflowState.workflowJobCount ?? actionableJobs.length,
      requiredCapabilities: Object.freeze([...(workflowState.requiredCapabilities ?? [])].sort()),
      optionalCapabilities: Object.freeze([...(workflowState.optionalCapabilities ?? [])].sort()),
      tenantBoundaryStatus: workflowState.tenantBoundary?.status ?? "unbound",
      tenantAuditEventCount: workflowState.tenantBoundary?.audit?.eventCount ?? 0,
      serviceSyncKey: serviceContract?.syncMetadata?.syncKey ?? null,
      externalRunId: serviceContract?.syncMetadata?.externalRunId ?? null,
      operationCount: operations.length,
      operationStatus: freezeSortedRecord(countBy(operations, "status")),
      commandContractStatus: commandContract.status,
      commandCount: commandContract.commandCount,
      commandStatus: commandContract.summary.byStatus,
      receiptStatus: receiptContract.status,
      receiptCount: receiptContract.receiptCount,
      receiptCommandStatus: receiptContract.counters,
      operationalHealthStatus: commandContract.operationalHealth.status,
      operationalHealthIssueCount: commandContract.operationalHealth.issueCount,
      tenantBoundaryContractStatus: tenantBoundaryContract.status,
      tenantBoundaryBlockedCount: tenantBoundaryContract.totals.blockedCount,
      tenantBoundaryReviewCount: tenantBoundaryContract.totals.reviewCount,
    }),
    tenantPermissionBoundary: tenantBoundaryContract,
    nextAction: receiptContract.status === "blocked" || receiptContract.status === "failed" || receiptContract.status === "pending"
      ? receiptContract.recovery.nextAction
      : tenantBoundaryContract.status === "blocked" || tenantBoundaryContract.status === "review"
      ? tenantBoundaryContract.recovery.nextAction
      : commandContract.operationalHealth.status === "blocked" || commandContract.operationalHealth.status === "degraded"
      ? commandContract.operationalHealth.nextAction
      : commandContract.status === "blocked" || commandContract.status === "pending" || commandContract.status === "degraded"
      ? commandContract.recovery.nextAction
      : workflowState.tenantBoundary?.status === "blocked" || workflowState.tenantBoundary?.status === "review"
        ? workflowState.tenantBoundary.nextAction
      : readinessPreview.nextAction,
  });
}

export function createMailchimpOperationalHealthDiagnostics(operationalHealth = {}, options = {}) {
  if (!operationalHealth || operationalHealth.status === "ready" || operationalHealth.status === "idle") {
    return Object.freeze([]);
  }

  const healthItems = Array.isArray(operationalHealth.commandHealth)
    ? operationalHealth.commandHealth
    : [];
  const actionable = healthItems.filter((item) => item.status !== "ready");
  const diagnostics = actionable.map((item) => {
    const blocked = item.status === "blocked";
    const issues = item.issues?.length ? item.issues.join(", ") : item.status;
    const retryDetail = item.retryBudget?.remaining === 0
      ? "retry budget exhausted"
      : item.retryAfter
        ? `retry after ${item.retryAfter}`
        : "retry timing not set";
    return createCatalogDiagnostic("AIOS_MAILCHIMP_OPERATIONAL_HEALTH", {
      severity: blocked ? "error" : "warning",
      range: options.rangeByJobName?.[item.jobName] ?? null,
      message: `Mailchimp command "${item.commandId ?? item.id}" is ${item.status}: ${issues}.`,
      hint: `Recovery: ${item.nextAction}; ${retryDetail}; handoff: mailchimp-operational-health.`,
      preview: `Mailchimp operational health ${operationalHealth.status}: ${item.jobName ?? "unknown job"} ${item.service}.${item.operation}.`,
    });
  });

  return Object.freeze(diagnostics);
}

export function createMailchimpProviderReceiptDiagnostics(receiptContract = {}, options = {}) {
  if (!receiptContract || receiptContract.status === "acknowledged" || receiptContract.status === "idle" || receiptContract.status === "duplicate") {
    return Object.freeze([]);
  }

  const receipts = Array.isArray(receiptContract.receipts) ? receiptContract.receipts : [];
  const actionable = receipts.filter((receipt) => (
    receipt.status === "blocked"
    || receipt.status === "failed"
    || receipt.status === "pending"
  ));

  return Object.freeze(actionable.map((receipt) => createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_RECEIPT", {
    severity: receipt.status === "blocked" || receipt.status === "failed" ? "error" : "warning",
    range: options.rangeByJobName?.[receipt.jobName] ?? null,
    message: `Mailchimp provider receipt for "${receipt.commandId ?? receipt.operationId}" is ${receipt.status}.`,
    hint: `Recovery: ${receipt.nextAction}; handoff: mailchimp-provider-receipt.`,
    preview: receipt.userVisible?.detail ?? `Mailchimp receipt ${receipt.status} for ${receipt.jobName ?? "unknown job"}.`,
    receipt: Object.freeze({
      id: receipt.id,
      commandId: receipt.commandId,
      operationId: receipt.operationId,
      jobName: receipt.jobName,
      status: receipt.status,
      handoffState: receipt.handoffState,
      receiptId: receipt.receiptId,
      nextAction: receipt.nextAction,
    }),
  })));
}

export function createMailchimpTenantPermissionBoundaryDiagnostics(boundaryContract = {}, options = {}) {
  const contract = boundaryContract?.version === "mailchimp-tenant-permission-boundary.v1"
    ? boundaryContract
    : createMailchimpTenantPermissionBoundaryContract(boundaryContract, options);
  if (!contract || contract.status === "ready" || contract.status === "idle") {
    return Object.freeze([]);
  }

  const actionableRows = Array.isArray(contract.auditRows)
    ? contract.auditRows.filter((row) => row.status === "blocked" || row.status === "review")
    : [];
  const fallbackRows = actionableRows.length
    ? actionableRows
    : (contract.tenantBoundary?.boundaries ?? [])
      .filter((boundary) => boundary.status === "blocked" || boundary.status === "review")
      .map((boundary) => Object.freeze({
        id: `mailchimp-tenant-audit:${boundary.jobName}`,
        jobName: boundary.jobName,
        operationId: null,
        status: boundary.status,
        tenantId: boundary.operationBoundary?.tenantId ?? null,
        workspaceId: boundary.operationBoundary?.workspaceId ?? null,
        role: boundary.operationBoundary?.role ?? null,
        permission: boundary.operationBoundary?.permission ?? null,
        reasonCodes: Object.freeze(boundary.issues?.map((issue) => issue.target ?? issue.status) ?? []),
        detail: boundary.issues?.map((issue) => issue.detail).join("; ") ?? "Mailchimp tenant boundary needs review.",
        handoff: "mailchimp-tenant-permission-audit",
        restartSafe: boundary.status !== "blocked",
        nextAction: boundary.nextAction,
      }));

  return Object.freeze(fallbackRows.map((row) => createCatalogDiagnostic("AIOS_MAILCHIMP_TENANT_PERMISSION", {
    severity: row.status === "blocked" ? "error" : "warning",
    range: options.rangeByJobName?.[row.jobName] ?? null,
    message: `Mailchimp tenant boundary for "${row.jobName}" is ${row.status}.`,
    hint: `Recovery: ${row.nextAction}; handoff: ${row.handoff}.`,
    preview: [
      row.detail,
      `tenant=${row.tenantId ?? "unbound"}`,
      `workspace=${row.workspaceId ?? "unbound"}`,
      `role=${row.role ?? "unbound"}`,
    ].join(" "),
    tenantBoundary: Object.freeze({
      id: row.id,
      jobName: row.jobName,
      operationId: row.operationId,
      status: row.status,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      role: row.role,
      permission: row.permission,
      reasonCodes: row.reasonCodes,
      restartSafe: row.restartSafe,
      nextAction: row.nextAction,
      syncKey: contract.syncKey ?? null,
    }),
  })));
}

export function createMailchimpLaunchGateDiagnostics(astOrGate = {}, settings = {}) {
  const launchGate = astOrGate?.version === "mailchimp-launch-gate.v1"
    ? astOrGate
    : createMailchimpLaunchGateContract(astOrGate, settings);
  const rangeByJobName = settings.rangeByJobName ?? {};
  const actionableGates = (launchGate.gates ?? [])
    .filter((gate) => gate.status === "blocked" || gate.status === "review" || gate.status === "pending");

  return Object.freeze(actionableGates.map((gate) => createCatalogDiagnostic("AIOS_MAILCHIMP_LAUNCH_GATE", {
    severity: gate.status === "blocked" ? "error" : "warning",
    range: rangeByJobName[gate.jobName] ?? null,
    message: `Mailchimp launch gate "${gate.gateId}" for "${gate.jobName}" is ${gate.status}.`,
    hint: `Recovery: ${gate.nextAction}; handoff: ${gate.handoff}.`,
    preview: `${gate.jobName}: ${gate.detail}`,
    launchGate: Object.freeze({
      id: gate.id,
      gateId: gate.gateId,
      jobName: gate.jobName,
      status: gate.status,
      nextAction: gate.nextAction,
      handoff: gate.handoff,
    }),
  })));
}

export function createMailchimpLaunchGateRuntimeState(astOrGate = {}, settings = {}) {
  const launchGate = astOrGate?.version === "mailchimp-launch-gate.v1"
    ? astOrGate
    : createMailchimpLaunchGateContract(astOrGate, settings);
  const diagnostics = createMailchimpLaunchGateDiagnostics(launchGate, settings);
  const recoveryPlan = createDiagnosticRecoveryPlan(diagnostics);
  const actions = (launchGate.gates ?? [])
    .filter((gate) => gate.status !== "ready")
    .map((gate) => Object.freeze({
      id: `mailchimp-launch-gate:${gate.id}`,
      kind: "mailchimpLaunchGate",
      status: gate.status === "blocked" ? "blocked" : "pending",
      target: gate.jobName,
      gateId: gate.gateId,
      handoff: gate.handoff,
      idempotencyKey: `mailchimp-launch-gate:${gate.id}:${launchGate.handoff.syncKey}`,
      restartSafe: gate.status !== "blocked",
      nextAction: gate.nextAction,
    }));
  const blockedActions = actions.filter((action) => action.status === "blocked");
  const pendingActions = actions.filter((action) => action.status === "pending");
  const status = launchGate.status === "blocked" || blockedActions.length
    ? "blocked"
    : pendingActions.length || launchGate.status === "pending" || launchGate.status === "review"
      ? "pending"
      : launchGate.status;

  return Object.freeze({
    version: "mailchimp-launch-gate-runtime.v1",
    status,
    ok: status === "ready" || status === "idle",
    providerId: launchGate.providerId,
    exportAllowed: launchGate.exportAllowed && status !== "blocked" && pendingActions.length === 0,
    diagnostics,
    recoveryPlan,
    actions: Object.freeze(actions.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    restartEnvelope: Object.freeze({
      route: status === "blocked" ? "mailchimp/launch/recovery" : status === "pending" ? "mailchimp/launch/actions" : "mailchimp/launch/summary",
      restartSafe: blockedActions.length === 0,
      blockedActionIds: Object.freeze(blockedActions.map((action) => action.id).sort()),
      pendingActionIds: Object.freeze(pendingActions.map((action) => action.id).sort()),
      idempotencyKeys: Object.freeze(actions.map((action) => action.idempotencyKey).sort()),
      nextAction: blockedActions[0]?.nextAction
        ?? pendingActions[0]?.nextAction
        ?? launchGate.handoff.nextAction,
    }),
    validationSummary: Object.freeze({
      gateCount: launchGate.totals.gateCount,
      blockedGateCount: launchGate.totals.blockedGateCount,
      pendingGateCount: launchGate.totals.pendingGateCount,
      reviewGateCount: launchGate.totals.reviewGateCount,
      diagnosticCount: diagnostics.length,
      recoveryState: recoveryPlan.state,
      byGateStatus: launchGate.counters.byStatus,
      byGateKind: launchGate.counters.byKind,
    }),
    handoff: Object.freeze({
      channel: "mailchimp-launch-gate",
      syncKey: launchGate.handoff.syncKey,
      route: status === "blocked" ? "mailchimp/launch/recovery" : "mailchimp/launch/summary",
      nextAction: blockedActions[0]?.nextAction
        ?? pendingActions[0]?.nextAction
        ?? launchGate.handoff.nextAction,
    }),
  });
}

export function createMailchimpProviderReadinessPreview(workflowState = {}, diagnostics = [], options = {}) {
  const operations = Array.isArray(options.operations)
    ? options.operations
    : Array.isArray(workflowState.providerContract?.operations)
      ? workflowState.providerContract.operations.map((operation) => createMailchimpOperationPreview(operation))
      : [];
  const recoveryPlan = options.recoveryPlan ?? createDiagnosticRecoveryPlan(diagnostics);
  const tenantBoundary = options.tenantBoundary ?? workflowState.tenantBoundary ?? null;
  const blockedOperations = operations.filter((operation) => operation.status === "blocked");
  const reviewOperations = operations.filter((operation) => operation.status === "review");
  const pendingAcceptance = operations.filter((operation) => operation.acceptanceState !== "accepted");
  const requiresAcceptance = options.requireAcceptance !== false && operations.length > 0;
  const status = !workflowState.detected && operations.length === 0
    ? "idle"
    : tenantBoundary?.status === "blocked" || !recoveryPlan.exportAllowed || blockedOperations.length
      ? "blocked"
      : tenantBoundary?.status === "review" || reviewOperations.length
        ? "review"
        : requiresAcceptance && pendingAcceptance.length
          ? "needsAcceptance"
          : "ready";

  return Object.freeze({
    status,
    detected: Boolean(workflowState.detected) || operations.length > 0,
    exportAllowed: status === "ready" || status === "idle",
    diagnosticCount: diagnostics.length,
    operationCount: operations.length,
    blockedOperationCount: blockedOperations.length,
    reviewOperationCount: reviewOperations.length,
    preview: Object.freeze({
      title: status === "idle" ? "Mailchimp provider not detected" : "Mailchimp provider handoff",
      detail: createMailchimpReadinessDetail(status, operations, diagnostics, tenantBoundary),
      operations: Object.freeze(operations),
    }),
    tenantBoundary: tenantBoundary
      ? Object.freeze({
          status: tenantBoundary.status,
          exportAllowed: tenantBoundary.exportAllowed,
          jobCount: tenantBoundary.jobCount,
          blockedJobNames: tenantBoundary.blockedJobNames,
          reviewJobNames: tenantBoundary.reviewJobNames,
          auditEventCount: tenantBoundary.audit.eventCount,
          nextAction: tenantBoundary.nextAction,
        })
      : null,
    acceptance: Object.freeze({
      mode: requiresAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requiresAcceptance || pendingAcceptance.length === 0),
      requiredOperationIds: Object.freeze(operations.map((operation) => operation.id)),
      pendingOperationIds: Object.freeze(requiresAcceptance ? pendingAcceptance.map((operation) => operation.id) : []),
      acceptedOperationIds: Object.freeze(operations
        .filter((operation) => operation.acceptanceState === "accepted")
        .map((operation) => operation.id)),
    }),
    validationSummary: Object.freeze({
      byStatus: freezeSortedRecord(countBy(operations, "status")),
      byService: freezeSortedRecord(countBy(operations, "service")),
      recoveryState: recoveryPlan.state,
      exportAllowed: recoveryPlan.exportAllowed,
      tenantBoundaryStatus: tenantBoundary?.status ?? "unbound",
    }),
    nextAction: tenantBoundary?.status === "blocked" || tenantBoundary?.status === "review"
      ? tenantBoundary.nextAction
      : selectMailchimpReadinessNextAction(status, recoveryPlan, blockedOperations, reviewOperations, pendingAcceptance),
  });
}

export function createDiagnosticClientRuntimeState(diagnostics = [], settings = {}) {
  const activeDiagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  const lifecycle = createDiagnosticLifecycleState(activeDiagnostics, settings.lifecycle ?? settings);
  const recoveryPlan = lifecycle.activeRecoveryPlan ?? createDiagnosticRecoveryPlan(activeDiagnostics);
  const mailchimpPreview = settings.mailchimpWorkflowPreview ?? null;
  const runtimeActions = createDiagnosticRuntimeActions(lifecycle, recoveryPlan, mailchimpPreview);
  const blockedActions = runtimeActions.filter((action) => action.status === "blocked");
  const pendingActions = runtimeActions.filter((action) => action.status === "pending");
  const clientCards = createDiagnosticClientCards(activeDiagnostics, lifecycle, mailchimpPreview);
  const status = blockedActions.length
    ? "blocked"
    : pendingActions.length
      ? "pending"
      : lifecycle.state;

  return Object.freeze({
    ok: lifecycle.ok && blockedActions.length === 0,
    status,
    exportAllowed: lifecycle.exportAllowed && blockedActions.length === 0 && pendingActions.length === 0,
    clientStateVersion: "diagnostic-client-runtime.v1",
    diagnosticCount: activeDiagnostics.length,
    lifecycle,
    recoveryPlan,
    cards: Object.freeze(clientCards),
    runtimeActions: Object.freeze(runtimeActions),
    restartEnvelope: createDiagnosticRuntimeRestartEnvelope(runtimeActions, {
      state: status,
      route: selectDiagnosticClientRoute(status, lifecycle, mailchimpPreview),
      mailchimpStatus: mailchimpPreview?.status ?? "unbound",
    }),
    handoff: Object.freeze({
      status,
      route: selectDiagnosticClientRoute(status, lifecycle, mailchimpPreview),
      nextAction: blockedActions[0]?.nextAction
        ?? pendingActions[0]?.nextAction
        ?? lifecycle.nextAction,
      mailchimpStatus: mailchimpPreview?.status ?? "unbound",
    }),
    validationSummary: Object.freeze({
      byCode: freezeSortedRecord(countBy(activeDiagnostics, "code")),
      bySeverity: freezeSortedRecord(countBy(activeDiagnostics, "severity")),
      suppressedCount: lifecycle.suppressed.length,
      actionCount: runtimeActions.length,
      blockedActionCount: blockedActions.length,
      pendingActionCount: pendingActions.length,
    }),
  });
}

export function createDiagnosticLifecycleExportState(diagnostics = [], settings = {}) {
  const lifecycle = createDiagnosticLifecycleState(diagnostics, settings);
  const clientState = createDiagnosticClientRuntimeState(diagnostics, {
    lifecycle: settings,
    mailchimpWorkflowPreview: settings.mailchimpWorkflowPreview,
  });
  const actionCounters = {};
  const codeCounters = {};
  const severityCounters = {};
  const handoffCounters = {};

  for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
    const entry = explainDiagnosticCode(diagnostic.code);
    incrementDiagnosticCounter(codeCounters, entry.code);
    incrementDiagnosticCounter(severityCounters, diagnostic.severity ?? entry.severity);
    incrementDiagnosticCounter(handoffCounters, entry.handoff);
  }
  for (const action of clientState.runtimeActions) {
    incrementDiagnosticCounter(actionCounters, action.status);
    incrementDiagnosticCounter(handoffCounters, action.handoff);
  }

  const blockedActions = clientState.runtimeActions.filter((action) => action.status === "blocked");
  const pendingActions = clientState.runtimeActions.filter((action) => action.status === "pending");
  const status = !lifecycle.settingsValidation.ok || blockedActions.length
    ? "blocked"
    : pendingActions.length || lifecycle.state === "review"
      ? "pending"
      : lifecycle.state;

  return Object.freeze({
    version: "diagnostic-lifecycle-export.v1",
    status,
    ok: status === "ready",
    exportAllowed: lifecycle.exportAllowed && clientState.exportAllowed && status === "ready",
    counters: Object.freeze({
      diagnosticByCode: freezeSortedRecord(codeCounters),
      diagnosticBySeverity: freezeSortedRecord(severityCounters),
      runtimeActionByStatus: freezeSortedRecord(actionCounters),
      handoffByChannel: freezeSortedRecord(handoffCounters),
    }),
    totals: Object.freeze({
      diagnosticCount: Array.isArray(diagnostics) ? diagnostics.length : 0,
      suppressedCount: lifecycle.suppressed.length,
      scheduledRecoveryCount: lifecycle.scheduledRecoveries.length,
      runtimeActionCount: clientState.runtimeActions.length,
      blockedActionCount: blockedActions.length,
      pendingActionCount: pendingActions.length,
      settingsDiagnosticCount: lifecycle.settingsValidation.diagnostics.length,
    }),
    controls: Object.freeze(lifecycle.controls.map((control) => Object.freeze({
      code: control.code,
      status: control.status,
      enabled: control.enabled,
      recovery: control.recovery,
      handoff: control.handoff,
      commandIds: Object.freeze(control.commands
        .filter((command) => command.enabled)
        .map((command) => command.id)
        .sort()),
    }))),
    recovery: Object.freeze({
      state: lifecycle.activeRecoveryPlan.state,
      exportAllowed: lifecycle.activeRecoveryPlan.exportAllowed,
      blockedActionIds: clientState.restartEnvelope.blockedActionIds,
      pendingActionIds: clientState.restartEnvelope.pendingActionIds,
      idempotencyKeys: clientState.restartEnvelope.idempotencyKeys,
      nextAction: blockedActions[0]?.nextAction
        ?? pendingActions[0]?.nextAction
        ?? lifecycle.nextAction,
    }),
    route: Object.freeze({
      clientRoute: clientState.handoff.route,
      mailchimpStatus: clientState.handoff.mailchimpStatus,
      nextAction: clientState.handoff.nextAction,
    }),
    exportSummary: Object.freeze({
      status,
      exportAllowed: lifecycle.exportAllowed && clientState.exportAllowed && status === "ready",
      restartSafe: clientState.restartEnvelope.restartSafe,
      route: clientState.handoff.route,
      nextAction: status === "ready"
        ? "publish-diagnostic-lifecycle-export"
        : clientState.handoff.nextAction,
    }),
  });
}

export function createDiagnosticLifecycleCommandSummary(diagnostics = [], settings = {}) {
  const lifecycle = settings.lifecycle?.controls
    ? settings.lifecycle
    : createDiagnosticLifecycleState(diagnostics, settings);
  const exportState = settings.exportState?.version === "diagnostic-lifecycle-export.v1"
    ? settings.exportState
    : createDiagnosticLifecycleExportState(diagnostics, {
        ...settings,
        mailchimpWorkflowPreview: settings.mailchimpWorkflowPreview,
      });
  const commandRows = [];
  const counters = {};

  for (const control of lifecycle.controls ?? []) {
    const commands = Array.isArray(control.commands)
      ? control.commands
      : listDiagnosticLifecycleCommands({ status: control.status });
    for (const command of commands) {
      const enabled = command.enabled !== false && commandRows.every((row) => row.id !== `${control.code}:${command.id}`);
      const row = Object.freeze({
        id: `${control.code}:${command.id}`,
        code: control.code,
        commandId: command.id,
        status: control.status,
        enabled,
        scheduled: Boolean(control.schedule),
        scheduleId: control.schedule?.id ?? null,
        requiresReason: Boolean(command.requiresReason),
        handoff: control.handoff ?? explainDiagnosticCode(control.code).handoff,
        nextAction: enabled ? command.nextAction : "retain-diagnostic-control",
      });
      commandRows.push(row);
      incrementDiagnosticCounter(counters, row.status);
      incrementDiagnosticCounter(counters, `command:${row.commandId}`);
      if (row.scheduled) incrementDiagnosticCounter(counters, "scheduled");
      if (!row.enabled) incrementDiagnosticCounter(counters, "disabled");
    }
  }

  const blocked = commandRows.filter((row) => row.status === "blocked");
  const pending = commandRows.filter((row) => row.status === "review" || row.scheduled);
  const disabled = commandRows.filter((row) => !row.enabled);
  const scheduleRows = (lifecycle.scheduledRecoveries ?? []).map((schedule) => Object.freeze({
    id: `${schedule.recovery}:${schedule.runAt ?? schedule.every ?? "unscheduled"}`,
    recovery: schedule.recovery,
    status: schedule.disabled ? "disabled" : "scheduled",
    runAt: schedule.runAt ?? null,
    every: schedule.every ?? null,
    nextAction: schedule.disabled ? "enable-diagnostic-schedule" : "run-scheduled-diagnostic-recovery",
  }));
  const status = exportState.status === "blocked" || blocked.length
    ? "blocked"
    : exportState.status === "pending" || pending.length
      ? "pending"
      : disabled.length
        ? "review"
        : exportState.status;

  return Object.freeze({
    version: "diagnostic-lifecycle-command-summary.v1",
    status,
    ok: status === "ready",
    exportAllowed: status === "ready" && exportState.exportAllowed,
    counters: Object.freeze({
      commandByStatus: freezeSortedRecord(counters),
      diagnosticByCode: exportState.counters?.diagnosticByCode ?? {},
      handoffByChannel: exportState.counters?.handoffByChannel ?? {},
    }),
    totals: Object.freeze({
      commandCount: commandRows.length,
      blockedCommandCount: blocked.length,
      pendingCommandCount: pending.length,
      disabledCommandCount: disabled.length,
      scheduleCount: scheduleRows.length,
      suppressedCount: lifecycle.suppressed?.length ?? 0,
      settingsDiagnosticCount: lifecycle.settingsValidation?.diagnostics?.length ?? 0,
    }),
    commands: Object.freeze(commandRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    schedules: Object.freeze(scheduleRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    recovery: Object.freeze({
      blockedCommandIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingCommandIds: Object.freeze(pending.map((row) => row.id).sort()),
      disabledCommandIds: Object.freeze(disabled.map((row) => row.id).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? disabled[0]?.nextAction
        ?? exportState.exportSummary?.nextAction
        ?? lifecycle.nextAction,
    }),
    exportState,
  });
}

export function createDiagnosticReleaseChecklist(diagnostics = [], settings = {}) {
  const clientState = settings.clientState?.clientStateVersion === "diagnostic-client-runtime.v1"
    ? settings.clientState
    : createDiagnosticClientRuntimeState(diagnostics, settings);
  const exportState = settings.exportState?.version === "diagnostic-lifecycle-export.v1"
    ? settings.exportState
    : createDiagnosticLifecycleExportState(diagnostics, settings);
  const releaseLanes = Array.isArray(settings.releaseLanes) ? settings.releaseLanes : [];
  const checklistItems = [
    ...clientState.cards.map((card) => diagnosticChecklistItem({
      id: `card:${card.id}`,
      kind: card.kind,
      status: card.status === "blocked" ? "blocked" : card.status === "review" || card.status === "disabled" ? "pending" : "ready",
      severity: card.severity,
      label: card.title,
      detail: card.detail,
      handoff: card.handoff,
      nextAction: card.nextAction,
      restartSafe: card.status !== "blocked",
    })),
    ...clientState.runtimeActions.map((action) => diagnosticChecklistItem({
      id: `runtime:${action.id}`,
      kind: action.kind,
      status: action.status,
      severity: action.status === "blocked" ? "error" : action.status === "pending" ? "warning" : "info",
      label: action.target,
      detail: `${action.kind} handoff through ${action.handoff}.`,
      handoff: action.handoff,
      nextAction: action.nextAction,
      restartSafe: action.restartSafe,
      idempotencyKey: action.idempotencyKey,
    })),
    ...releaseLanes.map((lane, index) => diagnosticChecklistItem({
      id: `release:${lane.id ?? index}`,
      kind: lane.kind ?? "releaseLane",
      status: lane.status ?? "ready",
      severity: lane.status === "blocked" ? "error" : lane.status === "pending" || lane.status === "review" ? "warning" : "info",
      label: lane.label ?? lane.id ?? `Release lane ${index + 1}`,
      detail: lane.detail ?? lane.handoff ?? "Release lane handoff.",
      handoff: lane.handoff ?? "release-checklist",
      nextAction: lane.nextAction ?? "continue-release-checklist",
      restartSafe: lane.restartSafe !== false,
      idempotencyKey: lane.idempotencyKey ?? null,
    })),
  ].sort(compareDiagnosticChecklistItems);
  const blocked = checklistItems.filter((item) => item.status === "blocked" || item.restartSafe === false);
  const pending = checklistItems.filter((item) => item.status === "pending" || item.status === "review");
  const status = clientState.status === "blocked" || exportState.status === "blocked" || blocked.length
    ? "blocked"
    : clientState.status === "pending" || exportState.status === "pending" || pending.length
      ? "pending"
      : "ready";

  return Object.freeze({
    version: "diagnostic-release-checklist.v1",
    status,
    ok: status === "ready",
    exportAllowed: status === "ready" && clientState.exportAllowed && exportState.exportAllowed,
    route: Object.freeze({
      clientRoute: status === "ready" ? "diagnostics/release-summary" : clientState.handoff.route,
      mailchimpStatus: clientState.handoff.mailchimpStatus,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? exportState.exportSummary.nextAction,
    }),
    checklistItems: Object.freeze(checklistItems),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countBy(checklistItems, "status")),
      byKind: freezeSortedRecord(countBy(checklistItems, "kind")),
      bySeverity: freezeSortedRecord(countBy(checklistItems, "severity")),
      byHandoff: freezeSortedRecord(countBy(checklistItems, "handoff")),
    }),
    totals: Object.freeze({
      checklistCount: checklistItems.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      diagnosticCount: clientState.diagnosticCount,
      runtimeActionCount: clientState.runtimeActions.length,
      releaseLaneCount: releaseLanes.length,
    }),
    restartEnvelope: Object.freeze({
      restartSafe: clientState.restartEnvelope.restartSafe && blocked.every((item) => item.restartSafe),
      blockedItemIds: Object.freeze(blocked.map((item) => item.id).sort()),
      pendingItemIds: Object.freeze(pending.map((item) => item.id).sort()),
      idempotencyKeys: Object.freeze(checklistItems
        .map((item) => item.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? "publish-diagnostic-release-checklist",
    }),
  });
}

export function createDiagnosticPersistedResumeState(diagnostics = [], settings = {}) {
  const clientState = settings.clientState?.clientStateVersion === "diagnostic-client-runtime.v1"
    ? settings.clientState
    : createDiagnosticClientRuntimeState(diagnostics, settings);
  const exportState = settings.exportState?.version === "diagnostic-lifecycle-export.v1"
    ? settings.exportState
    : createDiagnosticLifecycleExportState(diagnostics, settings);
  const releaseChecklist = settings.releaseChecklist?.version === "diagnostic-release-checklist.v1"
    ? settings.releaseChecklist
    : createDiagnosticReleaseChecklist(diagnostics, {
      ...settings,
      clientState,
      exportState,
    });
  const persistedActions = createDiagnosticPersistedActions(clientState, releaseChecklist, settings);
  const blocked = persistedActions.filter((action) => action.status === "blocked");
  const pending = persistedActions.filter((action) => action.status === "pending");
  const review = persistedActions.filter((action) => action.status === "review");
  const status = exportState.status === "blocked" || releaseChecklist.status === "blocked" || blocked.length
    ? "blocked"
    : exportState.status === "pending" || releaseChecklist.status === "pending" || pending.length
      ? "pending"
      : review.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "diagnostic-persisted-resume.v1",
    status,
    ok: status === "ready",
    exportAllowed: status === "ready" && exportState.exportAllowed && releaseChecklist.exportAllowed,
    syncKey: [
      settings.fileName ?? "inline.aios",
      settings.revision ?? "working",
      clientState.restartEnvelope.idempotencyKeys.join(",") || "no-runtime-actions",
      releaseChecklist.restartEnvelope.idempotencyKeys.join(",") || "no-release-actions",
    ].join("|"),
    persistedActions: Object.freeze(persistedActions),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countBy(persistedActions, "status")),
      byKind: freezeSortedRecord(countBy(persistedActions, "kind")),
      byRoute: freezeSortedRecord(countBy(persistedActions, "route")),
      diagnosticByCode: clientState.validationSummary.byCode,
    }),
    recovery: Object.freeze({
      blockedActionIds: Object.freeze(blocked.map((action) => action.id).sort()),
      pendingActionIds: Object.freeze(pending.map((action) => action.id).sort()),
      reviewActionIds: Object.freeze(review.map((action) => action.id).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? releaseChecklist.route.nextAction,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "diagnostics/resume/recovery"
        : status === "pending"
          ? "diagnostics/resume/actions"
          : status === "review"
            ? "diagnostics/resume/review"
            : "diagnostics/resume/summary",
      restartSafe: blocked.every((action) => action.restartSafe)
        && clientState.restartEnvelope.restartSafe
        && releaseChecklist.restartEnvelope.restartSafe,
      idempotencyKeys: Object.freeze(persistedActions
        .map((action) => action.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-diagnostic-resume-state",
    }),
    clientState,
    exportState,
    releaseChecklist,
  });
}

export function createMailchimpDiagnosticIncidentReport(diagnostics = [], settings = {}) {
  const activeDiagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  const clientState = settings.clientState?.clientStateVersion === "diagnostic-client-runtime.v1"
    ? settings.clientState
    : createDiagnosticClientRuntimeState(activeDiagnostics, settings);
  const exportState = settings.exportState?.version === "diagnostic-lifecycle-export.v1"
    ? settings.exportState
    : createDiagnosticLifecycleExportState(activeDiagnostics, {
      ...settings,
      clientState,
    });
  const releaseChecklist = settings.releaseChecklist?.version === "diagnostic-release-checklist.v1"
    ? settings.releaseChecklist
    : createDiagnosticReleaseChecklist(activeDiagnostics, {
      ...settings,
      clientState,
      exportState,
    });
  const persistedResume = settings.persistedResume?.version === "diagnostic-persisted-resume.v1"
    ? settings.persistedResume
    : createDiagnosticPersistedResumeState(activeDiagnostics, {
      ...settings,
      clientState,
      exportState,
      releaseChecklist,
    });
  const incidentRows = [
    ...createDiagnosticIncidentRowsFromDiagnostics(activeDiagnostics, settings),
    ...createDiagnosticIncidentRowsFromRuntime(clientState),
    ...createDiagnosticIncidentRowsFromChecklist(releaseChecklist),
    ...createDiagnosticIncidentRowsFromPersistedResume(persistedResume),
    ...createDiagnosticIncidentRowsFromMailchimpProvider(settings.mailchimpHandoff),
    ...createDiagnosticIncidentRowsFromSourceTimeline(settings.sourceOperationalTimeline),
  ];
  const dedupedRows = dedupeDiagnosticIncidentRows(incidentRows);
  const blocked = dedupedRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = dedupedRows.filter((row) => row.status === "pending" || row.status === "review");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : dedupedRows.length
        ? "ready"
        : "idle";
  const timeline = createDiagnosticIncidentTimeline(dedupedRows, {
    clientState,
    exportState,
    releaseChecklist,
    persistedResume,
    mailchimpHandoff: settings.mailchimpHandoff,
    sourceOperationalTimeline: settings.sourceOperationalTimeline,
  });

  return Object.freeze({
    version: "mailchimp-diagnostic-incident-report.v1",
    status,
    ok: status === "ready" || status === "idle",
    providerId: settings.providerId ?? settings.mailchimpHandoff?.providerId ?? "mailchimp",
    fileName: settings.fileName ?? "inline.aios",
    revision: settings.revision ?? "working",
    exportAllowed: status === "ready" || status === "idle",
    restartSafe: blocked.every((row) => row.restartSafe),
    incidents: Object.freeze(dedupedRows),
    timeline,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countBy(dedupedRows, "status")),
      bySeverity: freezeSortedRecord(countBy(dedupedRows, "severity")),
      byHandoff: freezeSortedRecord(countBy(dedupedRows, "handoff")),
      byKind: freezeSortedRecord(countBy(dedupedRows, "kind")),
      byOrigin: freezeSortedRecord(countBy(dedupedRows, "origin")),
    }),
    totals: Object.freeze({
      incidentCount: dedupedRows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      diagnosticCount: activeDiagnostics.length,
      runtimeActionCount: clientState.runtimeActions.length,
      releaseChecklistCount: releaseChecklist.checklistItems.length,
      persistedActionCount: persistedResume.persistedActions.length,
      mailchimpCommandCount: settings.mailchimpHandoff?.commandContract?.commandCount ?? 0,
      mailchimpReceiptCount: settings.mailchimpHandoff?.receiptContract?.receiptCount ?? 0,
      sourceOperationalEventCount: settings.sourceOperationalTimeline?.totals?.eventCount ?? 0,
    }),
    recovery: Object.freeze({
      blockedIncidentIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingIncidentIds: Object.freeze(pending.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(dedupedRows
        .map((row) => row.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? releaseChecklist.route.nextAction
        ?? "publish-mailchimp-diagnostic-incident-report",
    }),
    exportSummary: Object.freeze({
      status,
      exportAllowed: status === "ready" || status === "idle",
      route: status === "blocked"
        ? "mailchimp/incidents/recovery"
        : status === "pending"
          ? "mailchimp/incidents/actions"
          : "mailchimp/incidents/summary",
      restartSafe: blocked.every((row) => row.restartSafe),
      nextAction: status === "ready" || status === "idle"
        ? "publish-mailchimp-diagnostic-incident-report"
        : blocked[0]?.nextAction ?? pending[0]?.nextAction,
    }),
    clientState,
    exportState,
    releaseChecklist,
    persistedResume,
  });
}

export function validateDiagnosticLifecycleSettings(settings = {}) {
  const diagnostics = [];
  const disabledCodes = normalizeCodeSet(settings.disabledCodes);
  const enabledCodes = normalizeCodeSet(settings.enabledCodes);
  const scheduledRecoveries = normalizeSchedule(settings.scheduledRecoveries);

  for (const code of disabledCodes) {
    const entry = explainDiagnosticCode(code);
    if (entry.code !== code || !AIOS_DIAGNOSTIC_CATALOG[code]) {
      diagnostics.push(`Disabled diagnostic ${code} is not cataloged.`);
    } else if (entry.status === "blocked") {
      diagnostics.push(`Blocked diagnostic ${code} cannot be disabled.`);
    }
  }

  for (const code of enabledCodes) {
    if (!AIOS_DIAGNOSTIC_CATALOG[code]) diagnostics.push(`Enabled diagnostic ${code} is not cataloged.`);
  }

  for (const [recovery, schedule] of scheduledRecoveries) {
    const knownRecovery = listDiagnosticCatalogEntries().some((entry) => entry.recovery === recovery);
    if (!knownRecovery) diagnostics.push(`Scheduled recovery ${recovery} is not cataloged.`);
    if (!["manual", "next-run", "daily", "weekly"].includes(schedule.cadence)) {
      diagnostics.push(`Scheduled recovery ${recovery} has unsupported cadence ${schedule.cadence}.`);
    }
  }

  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    disabledCount: disabledCodes.size,
    enabledCount: enabledCodes.size,
    scheduledCount: scheduledRecoveries.size,
  });
}

export function summarizeDiagnosticCatalog() {
  const byStage = {};
  const byNodeKind = {};
  const byStatus = {};

  for (const entry of listDiagnosticCatalogEntries()) {
    byStage[entry.stage] = (byStage[entry.stage] ?? 0) + 1;
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
    const nodeKind = entry.nodeKind ?? "unbound";
    byNodeKind[nodeKind] = (byNodeKind[nodeKind] ?? 0) + 1;
  }

  return Object.freeze({
    total: Object.keys(AIOS_DIAGNOSTIC_CATALOG).length,
    byStage: freezeSortedRecord(byStage),
    byNodeKind: freezeSortedRecord(byNodeKind),
    byStatus: freezeSortedRecord(byStatus),
  });
}

export function validateDiagnosticCatalogCoverage() {
  const diagnostics = [];

  for (const entry of listDiagnosticCatalogEntries()) {
    if (entry.nodeKind && !getAstNodeKindContract(entry.nodeKind)) {
      diagnostics.push(`Diagnostic ${entry.code} targets unknown node kind ${entry.nodeKind}.`);
    }
    if (!["blocked", "review", "ready"].includes(entry.status)) {
      diagnostics.push(`Diagnostic ${entry.code} has unsupported status ${entry.status}.`);
    }
  }

  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    summary: summarizeDiagnosticCatalog(),
  });
}

function catalogEntry(entry) {
  return Object.freeze(entry);
}

function createDiagnosticIncidentRowsFromDiagnostics(diagnostics = [], settings = {}) {
  return diagnostics.map((diagnostic, index) => {
    const entry = explainDiagnosticCode(diagnostic.code);
    return diagnosticIncidentRow({
      id: `diagnostic:${entry.code}:${index}`,
      origin: "diagnostic",
      kind: entry.stage,
      status: entry.status,
      severity: diagnostic.severity ?? entry.severity,
      label: entry.code,
      detail: diagnostic.message ?? entry.message,
      handoff: entry.handoff,
      restartSafe: entry.status !== "blocked",
      idempotencyKey: `diagnostic-incident:${entry.code}:${entry.recovery}`,
      nextAction: entry.recovery,
      jobName: diagnostic.mailchimp?.jobName
        ?? diagnostic.receipt?.jobName
        ?? diagnostic.tenantBoundary?.jobName
        ?? diagnostic.launchGate?.jobName
        ?? null,
      providerId: settings.providerId ?? "mailchimp",
      source: diagnostic.preview ?? diagnostic.range?.fileName ?? null,
    });
  });
}

function createDiagnosticIncidentRowsFromRuntime(clientState = {}) {
  const actions = Array.isArray(clientState.runtimeActions) ? clientState.runtimeActions : [];
  return actions
    .filter((action) => action.status === "blocked" || action.status === "pending")
    .map((action) => diagnosticIncidentRow({
      id: `runtime:${action.id}`,
      origin: "runtime",
      kind: action.kind,
      status: action.status,
      severity: action.status === "blocked" ? "error" : "warning",
      label: action.target,
      detail: `${action.kind} requires ${action.nextAction}.`,
      handoff: action.handoff,
      restartSafe: action.restartSafe,
      idempotencyKey: action.idempotencyKey,
      nextAction: action.nextAction,
    }));
}

function createDiagnosticIncidentRowsFromChecklist(releaseChecklist = {}) {
  const items = Array.isArray(releaseChecklist.checklistItems) ? releaseChecklist.checklistItems : [];
  return items
    .filter((item) => item.status === "blocked" || item.status === "pending" || item.status === "review")
    .map((item) => diagnosticIncidentRow({
      id: `checklist:${item.id}`,
      origin: "releaseChecklist",
      kind: item.kind,
      status: item.status === "review" ? "pending" : item.status,
      severity: item.severity,
      label: item.label,
      detail: item.detail,
      handoff: item.handoff,
      restartSafe: item.restartSafe,
      idempotencyKey: item.idempotencyKey,
      nextAction: item.nextAction,
    }));
}

function createDiagnosticIncidentRowsFromPersistedResume(persistedResume = {}) {
  const actions = Array.isArray(persistedResume.persistedActions) ? persistedResume.persistedActions : [];
  return actions
    .filter((action) => action.status === "blocked" || action.status === "pending" || action.status === "review")
    .map((action) => diagnosticIncidentRow({
      id: `resume:${action.id}`,
      origin: "persistedResume",
      kind: action.kind,
      status: action.status === "review" ? "pending" : action.status,
      severity: action.status === "blocked" ? "error" : "warning",
      label: action.target,
      detail: `${action.route} handoff requires ${action.nextAction}.`,
      handoff: action.handoff,
      restartSafe: action.restartSafe,
      idempotencyKey: action.idempotencyKey,
      nextAction: action.nextAction,
    }));
}

function createDiagnosticIncidentRowsFromMailchimpProvider(mailchimpHandoff = null) {
  if (!mailchimpHandoff || typeof mailchimpHandoff !== "object") return [];
  const commandRows = (mailchimpHandoff.operationalHealth?.commandHealth ?? [])
    .filter((command) => command.status !== "ready")
    .map((command) => diagnosticIncidentRow({
      id: `mailchimp-command:${command.commandId ?? command.id}`,
      origin: "mailchimpProvider",
      kind: "mailchimpCommandHealth",
      status: command.status === "blocked" ? "blocked" : "pending",
      severity: command.status === "blocked" ? "error" : "warning",
      label: command.commandId ?? command.id,
      detail: command.issues?.length ? command.issues.join("; ") : `Command is ${command.status}.`,
      handoff: "mailchimp-operational-health",
      restartSafe: command.status !== "blocked",
      idempotencyKey: command.idempotencyKey ?? command.commandId ?? command.id,
      nextAction: command.nextAction,
      jobName: command.jobName,
      providerId: mailchimpHandoff.providerId,
    }));
  const receiptRows = (mailchimpHandoff.receiptContract?.receipts ?? [])
    .filter((receipt) => receipt.status === "blocked" || receipt.status === "failed" || receipt.status === "pending")
    .map((receipt) => diagnosticIncidentRow({
      id: `mailchimp-receipt:${receipt.id}`,
      origin: "mailchimpProvider",
      kind: "mailchimpReceipt",
      status: receipt.status === "blocked" || receipt.status === "failed" ? "blocked" : "pending",
      severity: receipt.status === "blocked" || receipt.status === "failed" ? "error" : "warning",
      label: receipt.commandId ?? receipt.operationId,
      detail: receipt.userVisible?.detail ?? `Receipt is ${receipt.status}.`,
      handoff: "mailchimp-provider-receipt",
      restartSafe: receipt.restartSafe !== false && receipt.status !== "failed",
      idempotencyKey: receipt.receiptId ?? receipt.commandId ?? receipt.id,
      nextAction: receipt.nextAction,
      jobName: receipt.jobName,
      providerId: mailchimpHandoff.providerId,
    }));
  const tenantRows = (mailchimpHandoff.tenantPermissionBoundary?.auditRows ?? [])
    .filter((row) => row.status === "blocked" || row.status === "review")
    .map((row) => diagnosticIncidentRow({
      id: `mailchimp-tenant:${row.id}`,
      origin: "mailchimpProvider",
      kind: "mailchimpTenantBoundary",
      status: row.status === "blocked" ? "blocked" : "pending",
      severity: row.status === "blocked" ? "error" : "warning",
      label: row.jobName,
      detail: row.detail,
      handoff: row.handoff,
      restartSafe: row.restartSafe,
      idempotencyKey: row.id,
      nextAction: row.nextAction,
      jobName: row.jobName,
      providerId: mailchimpHandoff.providerId,
    }));

  return [...commandRows, ...receiptRows, ...tenantRows];
}

function createDiagnosticIncidentRowsFromSourceTimeline(sourceOperationalTimeline = null) {
  const events = Array.isArray(sourceOperationalTimeline?.events) ? sourceOperationalTimeline.events : [];
  return events
    .filter((event) => event.status === "blocked" || event.status === "pending" || event.status === "review")
    .map((event) => diagnosticIncidentRow({
      id: `source:${event.phase}`,
      origin: "sourceOperationalTimeline",
      kind: "sourceRangeOperational",
      status: event.status === "review" ? "pending" : event.status,
      severity: event.status === "blocked" ? "error" : "warning",
      label: event.phase,
      detail: event.detail ?? `${event.route} requires attention.`,
      handoff: event.route,
      restartSafe: event.restartSafe,
      idempotencyKey: event.idempotencyKey,
      nextAction: event.nextAction,
    }));
}

function dedupeDiagnosticIncidentRows(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    const previous = byId.get(row.id);
    if (!previous || compareIncidentStatus(row.status, previous.status) < 0) {
      byId.set(row.id, row);
    }
  }
  return Object.freeze([...byId.values()].sort((left, right) => (
    compareIncidentStatus(left.status, right.status)
    || left.origin.localeCompare(right.origin)
    || left.id.localeCompare(right.id)
  )));
}

function createDiagnosticIncidentTimeline(rows = [], state = {}) {
  const phases = [
    diagnosticIncidentTimelineEvent("diagnostics", state.clientState?.status, rows, "diagnostic"),
    diagnosticIncidentTimelineEvent("runtime", state.clientState?.restartEnvelope?.status, rows, "runtime"),
    diagnosticIncidentTimelineEvent("release", state.releaseChecklist?.status, rows, "releaseChecklist"),
    diagnosticIncidentTimelineEvent("resume", state.persistedResume?.status, rows, "persistedResume"),
    diagnosticIncidentTimelineEvent("mailchimp-provider", state.mailchimpHandoff?.status, rows, "mailchimpProvider"),
    diagnosticIncidentTimelineEvent("source-operations", state.sourceOperationalTimeline?.status, rows, "sourceOperationalTimeline"),
  ];

  return Object.freeze(phases.map((phase, index) => Object.freeze({ ...phase, index })));
}

function diagnosticIncidentTimelineEvent(phase, status, rows, origin) {
  const scoped = rows.filter((row) => row.origin === origin);
  const blocked = scoped.filter((row) => row.status === "blocked");
  const pending = scoped.filter((row) => row.status === "pending" || row.status === "review");
  return Object.freeze({
    phase,
    status: status ?? (blocked.length ? "blocked" : pending.length ? "pending" : scoped.length ? "ready" : "idle"),
    incidentCount: scoped.length,
    blockedCount: blocked.length,
    pendingCount: pending.length,
    restartSafe: blocked.every((row) => row.restartSafe),
    nextAction: blocked[0]?.nextAction
      ?? pending[0]?.nextAction
      ?? "continue-diagnostic-incident-report",
  });
}

function diagnosticIncidentRow(row) {
  return Object.freeze({
    id: String(row.id),
    origin: row.origin ?? "diagnostic",
    kind: row.kind ?? "diagnosticIncident",
    status: ["blocked", "pending", "review", "ready"].includes(row.status) ? row.status : "pending",
    severity: row.severity ?? (row.status === "blocked" ? "error" : "warning"),
    label: String(row.label ?? row.id),
    detail: String(row.detail ?? ""),
    handoff: row.handoff ?? "diagnostic-summary",
    restartSafe: row.restartSafe !== false,
    idempotencyKey: row.idempotencyKey ?? null,
    nextAction: row.nextAction ?? "review-diagnostic-incident",
    jobName: row.jobName ?? null,
    providerId: row.providerId ?? "mailchimp",
    source: row.source ?? null,
  });
}

function compareIncidentStatus(left, right) {
  const order = { blocked: 0, pending: 1, review: 2, ready: 3, idle: 4 };
  return (order[left] ?? 5) - (order[right] ?? 5);
}

function lifecycleCommand(command) {
  return Object.freeze({
    ...command,
    allowedStatuses: Object.freeze(command.allowedStatuses),
  });
}

function recoveryHint(entry) {
  return `Recovery: ${entry.recovery}; handoff: ${entry.handoff}.`;
}

function createDiagnosticControl(entry, state = {}) {
  const commands = listDiagnosticLifecycleCommands({ status: entry.status });
  return Object.freeze({
    code: entry.code,
    status: state.disabled ? "disabled" : entry.status,
    severity: state.severity,
    recovery: entry.recovery,
    handoff: entry.handoff,
    enabled: !state.disabled || state.explicitlyEnabled,
    schedule: state.schedule,
    commands: Object.freeze(commands.map((command) => Object.freeze({
      id: command.id,
      label: command.label,
      requiresReason: command.requiresReason,
      nextAction: command.nextAction,
      enabled: command.id !== "disableCode" || entry.status !== "blocked",
    }))),
  });
}

function selectLifecycleNextAction(plan, controls, settingsValidation) {
  if (!settingsValidation.ok) return "fix-diagnostic-lifecycle-settings";
  if (plan.state === "blocked") return "complete-blocking-recovery";
  if (controls.some((control) => control.status === "disabled")) return "review-disabled-diagnostics";
  if (controls.some((control) => control.schedule)) return "wait-for-scheduled-recovery";
  if (plan.state === "review") return "review-recovery-plan";
  return "emit-export-summary";
}

function createMailchimpWorkflowHint(issue, workflowState) {
  const providerId = workflowState.providerId ?? "mailchimp";
  const target = issue.target ? ` Target: ${issue.target}.` : "";
  return `Recovery: ${issue.recovery}; handoff: ${providerId}; next action: ${issue.nextAction}.${target}`;
}

function createMailchimpWorkflowPreview(issue, workflowState, overrides = {}) {
  const prefix = overrides.previewPrefix ?? "Mailchimp workflow";
  const jobLabel = issue.jobName ? ` ${issue.jobName}` : "";
  const status = workflowState.status ?? issue.status;
  return `${prefix}${jobLabel}: ${status}; ${issue.detail}`;
}

function selectMailchimpProviderNextAction(workflowState, recoveryPlan, jobs) {
  if (!workflowState.detected) return "skip-mailchimp-provider-handoff";
  if (!recoveryPlan.exportAllowed) return recoveryPlan.actions[0]?.handoff ?? "repair-mailchimp-provider-contract";
  if (jobs.some((job) => job.status === "review")) return "review-mailchimp-workflow-controls";
  return workflowState.handoff?.nextAction ?? "publish-mailchimp-provider-handoff";
}

function createMailchimpOperationPreview(operation = {}) {
  return Object.freeze({
    id: operation.id,
    jobName: operation.jobName,
    service: operation.service,
    operation: operation.operation,
    status: operation.status,
    syncChannel: operation.syncChannel,
    idempotencyScope: operation.idempotencyScope,
    tenantBoundary: operation.tenantBoundary ?? null,
    scheduleWindow: Object.freeze({
      id: operation.externalState?.scheduleWindowId ?? null,
      mode: operation.externalState?.scheduleWindowMode ?? "anytime",
      status: operation.reasons?.includes("schedule-window-blocked")
        ? "blocked"
        : operation.reasons?.includes("schedule-window-needs-approval")
          ? "review"
          : "ready",
      timezone: operation.externalState?.scheduleWindowTimezone ?? "UTC",
      nextAction: operation.externalState?.scheduleWindowNextAction ?? "retain-mailchimp-send-window",
    }),
    commandId: operation.externalState?.commandId ?? operation.id,
    restartSafe: operation.externalState?.restartSafe !== false,
    acceptanceState: operation.status === "ready" ? "accepted" : "pending",
    nextAction: operation.nextAction,
    userVisible: Object.freeze({
      label: `${operation.jobName} ${operation.service}.${operation.operation}`,
      detail: operation.reasons?.length
        ? operation.reasons.join("; ")
        : `Ready to hand off through ${operation.syncChannel}.`,
      status: operation.status,
      boundary: operation.tenantBoundary?.tenantId && operation.tenantBoundary?.workspaceId
        ? `${operation.tenantBoundary.tenantId}/${operation.tenantBoundary.workspaceId}`
        : "tenant-boundary-unbound",
      scheduleWindow: operation.externalState?.scheduleWindowMode
        ? `${operation.externalState.scheduleWindowMode}:${operation.externalState.scheduleWindowTimezone ?? "UTC"}`
        : "send-window-unbound",
    }),
  });
}

function createMailchimpReadinessDetail(status, operations, diagnostics, tenantBoundary = null) {
  if (status === "idle") return "No Mailchimp workflow operations were detected.";
  if (tenantBoundary?.status === "blocked") return `${tenantBoundary.blockedJobNames.length} Mailchimp jobs are outside the tenant permission boundary.`;
  if (tenantBoundary?.status === "review") return `${tenantBoundary.reviewJobNames.length} Mailchimp jobs need tenant permission boundary review.`;
  if (operations.some((operation) => operation.scheduleWindow?.status === "blocked")) return "Mailchimp provider operations include blocked send-window controls.";
  if (operations.some((operation) => operation.scheduleWindow?.status === "review")) return "Mailchimp provider operations need send-window confirmation before export.";
  if (status === "blocked") return `${diagnostics.length} diagnostics or blocked operations require recovery before handoff.`;
  if (status === "review") return `${operations.filter((operation) => operation.status === "review").length} operations need review before export.`;
  if (status === "needsAcceptance") return "Mailchimp provider operations are valid and need preview acceptance.";
  return `${operations.length} Mailchimp provider operations are ready for external handoff.`;
}

function selectMailchimpReadinessNextAction(status, recoveryPlan, blockedOperations, reviewOperations, pendingAcceptance) {
  if (status === "idle") return "skip-mailchimp-provider-handoff";
  if (status === "blocked") return blockedOperations[0]?.nextAction ?? recoveryPlan.actions[0]?.handoff ?? "repair-mailchimp-provider-contract";
  if (status === "review") return reviewOperations[0]?.nextAction ?? "review-mailchimp-provider-operations";
  if (status === "needsAcceptance") return pendingAcceptance[0]?.nextAction ?? "accept-mailchimp-provider-preview";
  return "publish-mailchimp-provider-handoff";
}

function createDiagnosticRuntimeActions(lifecycle, recoveryPlan, mailchimpPreview) {
  const recoveryActions = recoveryPlan.actions.map((action) => Object.freeze({
    id: `diagnostic-recovery:${action.id}`,
    kind: "diagnosticRecovery",
    status: action.status === "blocked" ? "blocked" : "pending",
    target: action.id,
    codeCount: action.count,
    codes: action.codes,
    handoff: action.handoff,
    idempotencyKey: `diagnostic:${action.id}:${action.codes.join(",")}`,
    restartSafe: action.status !== "blocked",
    nextAction: action.status === "blocked" ? action.handoff : "schedule-diagnostic-recovery",
  }));
  const controlActions = lifecycle.controls
    .filter((control) => control.status === "disabled" || control.schedule)
    .map((control) => Object.freeze({
      id: `diagnostic-control:${control.code}`,
      kind: "diagnosticControl",
      status: control.status === "disabled" ? "pending" : "ready",
      target: control.code,
      handoff: control.handoff,
      idempotencyKey: `diagnostic-control:${control.code}:${control.status}`,
      restartSafe: true,
      nextAction: control.status === "disabled" ? "review-disabled-diagnostic" : "wait-for-scheduled-recovery",
    }));
  const mailchimpActions = createMailchimpRuntimeActions(mailchimpPreview);

  return Object.freeze([...recoveryActions, ...controlActions, ...mailchimpActions]
    .sort((left, right) => left.status.localeCompare(right.status)
      || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id)));
}

function createDiagnosticPersistedActions(clientState, releaseChecklist, settings = {}) {
  const runtimeRows = clientState.runtimeActions.map((action) => diagnosticPersistedAction({
    id: `runtime:${action.id}`,
    kind: action.kind,
    status: action.status,
    route: clientState.handoff.route,
    target: action.target,
    handoff: action.handoff,
    nextAction: action.nextAction,
    restartSafe: action.restartSafe,
    idempotencyKey: action.idempotencyKey,
  }));
  const checklistRows = releaseChecklist.checklistItems.map((item) => diagnosticPersistedAction({
    id: `checklist:${item.id}`,
    kind: item.kind,
    status: item.status === "blocked"
      ? "blocked"
      : item.status === "pending" || item.status === "review"
        ? "pending"
        : "ready",
    route: releaseChecklist.route.clientRoute,
    target: item.label,
    handoff: item.handoff,
    nextAction: item.nextAction,
    restartSafe: item.restartSafe,
    idempotencyKey: item.idempotencyKey,
  }));
  const commandRows = normalizeDiagnosticResumeCommands(settings.resumeCommands).map((command) => diagnosticPersistedAction({
    id: `command:${command.id}`,
    kind: "resumeCommand",
    status: command.status,
    route: command.route,
    target: command.target,
    handoff: command.handoff,
    nextAction: command.nextAction,
    restartSafe: command.restartSafe,
    idempotencyKey: command.idempotencyKey,
  }));
  const deduped = new Map();

  for (const row of [...runtimeRows, ...checklistRows, ...commandRows]) {
    const previous = deduped.get(row.id);
    if (!previous || compareDiagnosticPersistedStatus(row.status, previous.status) < 0) {
      deduped.set(row.id, row);
    }
  }

  return [...deduped.values()].sort((left, right) => (
    compareDiagnosticPersistedStatus(left.status, right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id)
  ));
}

function diagnosticPersistedAction(action) {
  return Object.freeze({
    id: action.id,
    kind: action.kind,
    status: action.status ?? "ready",
    route: action.route ?? "diagnostics/resume/summary",
    target: action.target ?? null,
    handoff: action.handoff ?? "diagnostic-summary",
    restartSafe: action.restartSafe !== false,
    idempotencyKey: action.idempotencyKey ?? null,
    nextAction: action.nextAction ?? "resume-diagnostic-action",
  });
}

function normalizeDiagnosticResumeCommands(commands) {
  if (!Array.isArray(commands)) return Object.freeze([]);
  return Object.freeze(commands
    .filter((command) => command && typeof command === "object")
    .map((command, index) => Object.freeze({
      id: String(command.id ?? index),
      status: ["blocked", "pending", "review", "ready"].includes(command.status) ? command.status : "pending",
      route: command.route ?? "diagnostics/resume/commands",
      target: command.target ?? command.id ?? `resume-command-${index}`,
      handoff: command.handoff ?? "diagnostic-summary",
      nextAction: command.nextAction ?? "run-diagnostic-resume-command",
      restartSafe: command.restartSafe !== false,
      idempotencyKey: command.idempotencyKey ?? `diagnostic-resume:${command.id ?? index}`,
    })));
}

function compareDiagnosticPersistedStatus(left, right) {
  const order = { blocked: 0, pending: 1, review: 2, ready: 3 };
  return (order[left] ?? 4) - (order[right] ?? 4);
}

function createDiagnosticRuntimeRestartEnvelope(actions = [], context = {}) {
  const blocked = actions.filter((action) => action.status === "blocked");
  const pending = actions.filter((action) => action.status === "pending");
  const ready = actions.filter((action) => action.status === "ready");
  const restartUnsafe = actions.filter((action) => action.restartSafe === false);
  const status = blocked.length || restartUnsafe.length
    ? "blocked"
    : pending.length
      ? "pending"
      : "ready";
  const commandGroups = {};

  for (const action of actions) {
    const group = commandGroups[action.kind] ?? {
      kind: action.kind,
      count: 0,
      blocked: 0,
      pending: 0,
      ready: 0,
      restartUnsafe: 0,
      nextAction: action.nextAction,
    };
    group.count += 1;
    if (action.status === "blocked") group.blocked += 1;
    if (action.status === "pending") group.pending += 1;
    if (action.status === "ready") group.ready += 1;
    if (action.restartSafe === false) group.restartUnsafe += 1;
    if (action.status === "blocked" || (group.nextAction === "wait-for-runtime-action" && action.nextAction)) {
      group.nextAction = action.nextAction;
    }
    commandGroups[action.kind] = group;
  }

  return Object.freeze({
    version: "diagnostic-runtime-restart.v1",
    status,
    state: context.state ?? status,
    route: context.route ?? "diagnostics/summary",
    mailchimpStatus: context.mailchimpStatus ?? "unbound",
    restartSafe: restartUnsafe.length === 0 && blocked.length === 0,
    actionCount: actions.length,
    blockedActionIds: Object.freeze(blocked.map((action) => action.id).sort()),
    pendingActionIds: Object.freeze(pending.map((action) => action.id).sort()),
    readyActionIds: Object.freeze(ready.map((action) => action.id).sort()),
    restartUnsafeActionIds: Object.freeze(restartUnsafe.map((action) => action.id).sort()),
    commandGroups: Object.freeze(Object.values(commandGroups)
      .sort((left, right) => left.kind.localeCompare(right.kind))
      .map((group) => Object.freeze(group))),
    idempotencyKeys: Object.freeze(actions
      .map((action) => action.idempotencyKey)
      .filter(Boolean)
      .sort()),
    nextAction: blocked[0]?.nextAction
      ?? restartUnsafe[0]?.nextAction
      ?? pending[0]?.nextAction
      ?? "resume-diagnostic-runtime",
  });
}

function createMailchimpRuntimeActions(mailchimpPreview) {
  if (!mailchimpPreview || typeof mailchimpPreview !== "object") return [];
  const pendingJobNames = mailchimpPreview.acceptance?.pendingJobNames ?? [];
  const issueSteps = Array.isArray(mailchimpPreview.nextSteps)
    ? mailchimpPreview.nextSteps.filter((step) => step.status === "blocked" || step.status === "review")
    : [];
  const issueActions = issueSteps.map((step) => Object.freeze({
    id: `mailchimp-workflow:${step.id}`,
    kind: "mailchimpWorkflow",
    status: step.status === "blocked" ? "blocked" : "pending",
    target: step.jobName ?? mailchimpPreview.providerId ?? "mailchimp",
    handoff: step.recovery ?? mailchimpPreview.readiness?.nextAction ?? "mailchimp-workflow-handoff",
    idempotencyKey: `mailchimp-workflow:${step.id}:${mailchimpPreview.status}`,
    restartSafe: step.status !== "blocked",
    nextAction: step.label,
  }));
  const acceptanceActions = pendingJobNames.map((jobName) => Object.freeze({
    id: `mailchimp-accept:${jobName}`,
    kind: "mailchimpWorkflowAcceptance",
    status: mailchimpPreview.status === "blocked" ? "blocked" : "pending",
    target: jobName,
    handoff: "mailchimp-workflow-preview",
    idempotencyKey: `mailchimp-accept:${jobName}:${mailchimpPreview.previewVersion ?? "v1"}`,
    restartSafe: mailchimpPreview.status !== "blocked",
    nextAction: `accept-mailchimp-workflow:${jobName}`,
  }));
  const tenantBoundaryActions = mailchimpPreview.workflowState?.tenantBoundary?.boundaries
    ?.filter((boundary) => boundary.status === "blocked" || boundary.status === "review")
    .map((boundary) => Object.freeze({
      id: `mailchimp-tenant-boundary:${boundary.jobName}`,
      kind: "mailchimpTenantBoundary",
      status: boundary.status === "blocked" ? "blocked" : "pending",
      target: boundary.jobName,
      handoff: "mailchimp-tenant-permission-audit",
      idempotencyKey: [
        "mailchimp-tenant-boundary",
        boundary.jobName,
        boundary.operationBoundary.tenantId ?? "tenant-unbound",
        boundary.operationBoundary.workspaceId ?? "workspace-unbound",
      ].join(":"),
      restartSafe: boundary.status !== "blocked",
      nextAction: boundary.nextAction,
    })) ?? [];

  return [...issueActions, ...acceptanceActions, ...tenantBoundaryActions];
}

function createDiagnosticClientCards(diagnostics, lifecycle, mailchimpPreview) {
  const diagnosticCards = diagnostics.map((diagnostic, index) => {
    const entry = explainDiagnosticCode(diagnostic.code);
    return Object.freeze({
      id: `diagnostic:${entry.code}:${index}`,
      kind: "diagnostic",
      status: entry.status,
      severity: diagnostic.severity ?? entry.severity,
      title: entry.code,
      detail: diagnostic.message ?? entry.message,
      preview: diagnostic.preview ?? "",
      handoff: entry.handoff,
      nextAction: entry.recovery,
    });
  });
  const suppressedCards = lifecycle.suppressed.map((suppressed) => Object.freeze({
    id: `suppressed:${suppressed.code}`,
    kind: "suppressedDiagnostic",
    status: "disabled",
    severity: explainDiagnosticCode(suppressed.code).severity,
    title: suppressed.code,
    detail: suppressed.reason,
    preview: "",
    handoff: "diagnostic-lifecycle",
    nextAction: "review-disabled-diagnostics",
  }));
  const mailchimpCards = createMailchimpClientCards(mailchimpPreview);

  return Object.freeze([...diagnosticCards, ...suppressedCards, ...mailchimpCards]
    .sort((left, right) => left.kind.localeCompare(right.kind)
      || left.status.localeCompare(right.status)
      || left.id.localeCompare(right.id)));
}

function diagnosticChecklistItem(item) {
  return Object.freeze({
    id: item.id,
    kind: item.kind,
    status: item.status,
    severity: item.severity ?? "info",
    label: String(item.label ?? item.id),
    detail: String(item.detail ?? ""),
    handoff: item.handoff,
    nextAction: item.nextAction,
    restartSafe: item.restartSafe !== false,
    idempotencyKey: item.idempotencyKey ?? null,
  });
}

function compareDiagnosticChecklistItems(left, right) {
  return left.status.localeCompare(right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function createMailchimpClientCards(mailchimpPreview) {
  if (!mailchimpPreview?.preview?.jobs) return [];
  return mailchimpPreview.preview.jobs.map((job) => Object.freeze({
    id: `mailchimp-workflow:${job.jobName}`,
    kind: "mailchimpWorkflow",
    status: job.status,
    severity: job.status === "blocked" ? "error" : job.status === "review" ? "warning" : "info",
    title: job.userVisible.title,
    detail: job.userVisible.detail,
    preview: job.tenantBoundary?.status && job.tenantBoundary.status !== "ready"
      ? job.tenantBoundary.detail
      : job.schedule.detail,
    handoff: job.tenantBoundary?.status && job.tenantBoundary.status !== "ready"
      ? "mailchimp-tenant-permission-audit"
      : "mailchimp-workflow-preview",
    nextAction: job.tenantBoundary?.status && job.tenantBoundary.status !== "ready"
      ? job.tenantBoundary.nextAction
      : job.userVisible.nextAction,
  }));
}

function selectDiagnosticClientRoute(status, lifecycle, mailchimpPreview) {
  if (status === "blocked") return "diagnostics/recovery";
  if (mailchimpPreview?.status === "needsAcceptance") return "mailchimp/acceptance";
  if (status === "pending") return "diagnostics/actions";
  if (lifecycle.suppressed.length) return "diagnostics/settings";
  return "diagnostics/summary";
}

function countBy(items = [], field) {
  const counts = {};
  for (const item of items) {
    const key = item?.[field] ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function incrementDiagnosticCounter(record, key) {
  const safeKey = key ?? "unknown";
  record[safeKey] = (record[safeKey] ?? 0) + 1;
}

function compareDiagnosticControls(left, right) {
  return left.status.localeCompare(right.status)
    || left.recovery.localeCompare(right.recovery)
    || left.code.localeCompare(right.code);
}

function normalizeCodeSet(value) {
  return new Set((Array.isArray(value) ? value : [])
    .map((code) => String(code).trim())
    .filter(Boolean)
    .sort());
}

function normalizeSchedule(value) {
  const entries = value && typeof value === "object" ? Object.entries(value) : [];
  return new Map(entries
    .map(([recovery, schedule]) => [String(recovery), normalizeScheduleValue(schedule)])
    .filter(([recovery]) => recovery));
}

function normalizeScheduleValue(schedule = {}) {
  if (typeof schedule === "string") {
    return Object.freeze({ cadence: schedule, owner: "runtime", nextRun: null });
  }
  return Object.freeze({
    cadence: schedule.cadence ?? "manual",
    owner: schedule.owner ?? "runtime",
    nextRun: schedule.nextRun ?? null,
  });
}

function freezeSortedRecord(record = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  ));
}
