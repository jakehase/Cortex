import {
  AIOS_AST_NODE_KINDS,
  createMailchimpAstPreviewAcceptanceContract,
  createMailchimpCampaignControlPlaneContract,
  createMailchimpLaunchGateContract,
  createMailchimpLifecycleCommandState,
  createMailchimpOperationalHealthExportDigest,
  createMailchimpOperationalHealthIncidentLedger,
  createMailchimpProviderCommandContract,
  createMailchimpProviderReceiptContract,
  createMailchimpProviderServiceHandoffExportDeck,
  createMailchimpProviderServiceHandoffContract,
  createMailchimpProviderServiceReadinessMatrix,
  createMailchimpTenantPermissionAuditLedger,
  createMailchimpTenantPermissionBoundaryContract,
  createMailchimpTenantPermissionDecision,
  createMailchimpTenantSourceAnchorCorrelations,
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
  AIOS_FORMATTER_LIFECYCLE: catalogEntry({
    code: "AIOS_FORMATTER_LIFECYCLE",
    severity: "warning",
    stage: "format",
    nodeKind: null,
    message: "Formatter lifecycle settings must allow a safe preview and export handoff.",
    recovery: "repair-formatter-lifecycle-settings",
    status: "review",
    handoff: "formatter-lifecycle-controls",
  }),
  AIOS_FORMATTER_ANALYTICS_EXPORT: catalogEntry({
    code: "AIOS_FORMATTER_ANALYTICS_EXPORT",
    severity: "warning",
    stage: "format",
    nodeKind: null,
    message: "Formatter analytics export reports must be restart-safe, accepted, and actionable before handoff.",
    recovery: "repair-formatter-analytics-export-report",
    status: "review",
    handoff: "formatter-analytics-export",
  }),
  AIOS_MAILCHIMP_AST_ANALYTICS_EXPORT: catalogEntry({
    code: "AIOS_MAILCHIMP_AST_ANALYTICS_EXPORT",
    severity: "warning",
    stage: "release",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp AST analytics export rows must be accepted, restart-safe, and export-ready before campaign handoff.",
    recovery: "repair-mailchimp-ast-analytics-export-bundle",
    status: "review",
    handoff: "mailchimp-ast-analytics-export",
  }),
  AIOS_MAILCHIMP_AST_PREVIEW_ACCEPTANCE: catalogEntry({
    code: "AIOS_MAILCHIMP_AST_PREVIEW_ACCEPTANCE",
    severity: "error",
    stage: "release",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp AST preview acceptance rows must be accepted, restart-safe, and actionable before client preview handoff.",
    recovery: "complete-mailchimp-ast-preview-acceptance",
    status: "blocked",
    handoff: "mailchimp-ast-preview-acceptance",
  }),
  AIOS_FORMATTER_PRODUCT_SLICE_READINESS: catalogEntry({
    code: "AIOS_FORMATTER_PRODUCT_SLICE_READINESS",
    severity: "error",
    stage: "release",
    nodeKind: null,
    message: "Formatter Mailchimp product-slice readiness rows must be accepted, restart-safe, and exportable before client handoff.",
    recovery: "complete-formatter-product-slice-readiness",
    status: "blocked",
    handoff: "formatter-product-slice-readiness",
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
  AIOS_MAILCHIMP_SERVICE_SYNC_WINDOW: catalogEntry({
    code: "AIOS_MAILCHIMP_SERVICE_SYNC_WINDOW",
    severity: "warning",
    stage: "provider",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp provider service sync windows must be ready or accepted before external handoff.",
    recovery: "accept-mailchimp-service-sync-window",
    status: "review",
    handoff: "mailchimp-service-sync-window",
  }),
  AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF: catalogEntry({
    code: "AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF",
    severity: "error",
    stage: "provider",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp provider service handoff lanes must be settled, restart-safe, and exportable before external handoff.",
    recovery: "complete-mailchimp-provider-service-handoff",
    status: "blocked",
    handoff: "mailchimp-provider-service-handoff",
  }),
  AIOS_MAILCHIMP_PROVIDER_SOURCE_DEPLOYMENT: catalogEntry({
    code: "AIOS_MAILCHIMP_PROVIDER_SOURCE_DEPLOYMENT",
    severity: "error",
    stage: "provider",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp provider service deployment rows must be paired with accepted source anchors before external handoff.",
    recovery: "complete-mailchimp-provider-source-deployment",
    status: "blocked",
    handoff: "mailchimp-provider-source-deployment",
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
  AIOS_MAILCHIMP_RELEASE_CONTRACT: catalogEntry({
    code: "AIOS_MAILCHIMP_RELEASE_CONTRACT",
    severity: "error",
    stage: "release",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp campaign release lanes must be ready, restart-safe, and accepted before export.",
    recovery: "complete-mailchimp-campaign-release-contract",
    status: "blocked",
    handoff: "mailchimp-campaign-release",
  }),
  AIOS_MAILCHIMP_LIFECYCLE_COMMAND: catalogEntry({
    code: "AIOS_MAILCHIMP_LIFECYCLE_COMMAND",
    severity: "warning",
    stage: "lifecycle",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp lifecycle commands must be valid, restart-safe, and settled before provider handoff.",
    recovery: "repair-mailchimp-lifecycle-command",
    status: "review",
    handoff: "mailchimp-lifecycle-command-queue",
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
  AIOS_MAILCHIMP_HANDOFF_READINESS: catalogEntry({
    code: "AIOS_MAILCHIMP_HANDOFF_READINESS",
    severity: "error",
    stage: "release",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp workflow handoff readiness lanes must be restart-safe, accepted, and exportable before campaign release.",
    recovery: "complete-mailchimp-workflow-handoff-readiness",
    status: "blocked",
    handoff: "mailchimp-workflow-handoff-readiness",
  }),
  AIOS_MAILCHIMP_CLIENT_RUNTIME_ADOPTION: catalogEntry({
    code: "AIOS_MAILCHIMP_CLIENT_RUNTIME_ADOPTION",
    severity: "error",
    stage: "release",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp client runtime adoption rows must be restart-safe, accepted, and actionable before release handoff.",
    recovery: "complete-mailchimp-client-runtime-adoption",
    status: "blocked",
    handoff: "mailchimp-client-runtime-adoption",
  }),
  AIOS_MAILCHIMP_CLIENT_RUNTIME_REQUEST: catalogEntry({
    code: "AIOS_MAILCHIMP_CLIENT_RUNTIME_REQUEST",
    severity: "error",
    stage: "release",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp client runtime requests must bind request, session, workspace, and route state before handoff.",
    recovery: "bind-mailchimp-runtime-request",
    status: "blocked",
    handoff: "mailchimp-client-runtime-request",
  }),
  AIOS_MAILCHIMP_CLIENT_RUNTIME_CHECKPOINT: catalogEntry({
    code: "AIOS_MAILCHIMP_CLIENT_RUNTIME_CHECKPOINT",
    severity: "error",
    stage: "release",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp client runtime checkpoint rows must settle request binding, workflow lanes, and adoption state before handoff.",
    recovery: "complete-mailchimp-client-runtime-checkpoint",
    status: "blocked",
    handoff: "mailchimp-client-runtime-checkpoint",
  }),
  AIOS_MAILCHIMP_CONTROL_PLANE: catalogEntry({
    code: "AIOS_MAILCHIMP_CONTROL_PLANE",
    severity: "error",
    stage: "lifecycle",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp campaign control-plane rows must be enabled, scheduled, restart-safe, and exportable before client handoff.",
    recovery: "repair-mailchimp-campaign-control-plane",
    status: "blocked",
    handoff: "mailchimp-control-plane",
  }),
  AIOS_SOURCE_RANGE_RUNTIME_RESUME: catalogEntry({
    code: "AIOS_SOURCE_RANGE_RUNTIME_RESUME",
    severity: "warning",
    stage: "source-map",
    nodeKind: null,
    message: "Source range runtime resume rows must be restart-safe and accepted before client handoff.",
    recovery: "repair-source-range-runtime-resume",
    status: "review",
    handoff: "source-range-runtime-resume",
  }),
  AIOS_SOURCE_RANGE_FAILURE_RECOVERY: catalogEntry({
    code: "AIOS_SOURCE_RANGE_FAILURE_RECOVERY",
    severity: "error",
    stage: "source-map",
    nodeKind: null,
    message: "Source range failure recovery rows must be retryable, restart-safe, or explicitly degraded before handoff.",
    recovery: "repair-source-range-failure-recovery",
    status: "blocked",
    handoff: "source-range-failure-recovery",
  }),
  AIOS_SOURCE_RANGE_RECOVERY_COMMAND_EXPORT: catalogEntry({
    code: "AIOS_SOURCE_RANGE_RECOVERY_COMMAND_EXPORT",
    severity: "error",
    stage: "source-map",
    nodeKind: null,
    message: "Source range recovery command exports must be accepted, restart-safe, and idempotent before formatter handoff.",
    recovery: "repair-source-range-recovery-command-export",
    status: "blocked",
    handoff: "source-range-recovery-command-export",
  }),
  AIOS_SOURCE_RANGE_CLIENT_ROUTE_HANDOFF: catalogEntry({
    code: "AIOS_SOURCE_RANGE_CLIENT_ROUTE_HANDOFF",
    severity: "error",
    stage: "source-map",
    nodeKind: null,
    message: "Source range client route handoff rows must be accepted, restart-safe, and actionable before client preview handoff.",
    recovery: "complete-source-range-client-route-handoff",
    status: "blocked",
    handoff: "source-range-client-route-handoff",
  }),
  AIOS_MAILCHIMP_PREVIEW_ACTION_STRIP: catalogEntry({
    code: "AIOS_MAILCHIMP_PREVIEW_ACTION_STRIP",
    severity: "error",
    stage: "source-map",
    nodeKind: AIOS_AST_NODE_KINDS.JobDeclaration,
    message: "Mailchimp preview action strip rows must be accepted, actionable, and restart-safe before campaign preview handoff.",
    recovery: "complete-mailchimp-preview-action-strip",
    status: "blocked",
    handoff: "mailchimp-preview-action-strip",
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

export function createMailchimpDiagnosticCheckpointControls(diagnostics = [], checkpointReport = {}, settings = {}) {
  const lifecycle = settings.lifecycle?.state
    ? settings.lifecycle
    : createDiagnosticLifecycleState(diagnostics, settings);
  const checkpoints = Array.isArray(checkpointReport.checkpoints) ? checkpointReport.checkpoints : [];
  const requested = normalizeCodeSet(settings.requestedCheckpointCommandIds);
  const completed = normalizeCodeSet(settings.completedCheckpointCommandIds);
  const failed = normalizeCodeSet(settings.failedCheckpointCommandIds);
  const controls = checkpoints.map((checkpoint) => createMailchimpDiagnosticCheckpointControl(checkpoint, {
    requested,
    completed,
    failed,
    checkpointReport,
    lifecycle,
  }));
  const diagnosticRows = (lifecycle.controls ?? []).map((control) => Object.freeze({
    id: `diagnostic:${control.code}:${control.command}`,
    kind: "diagnosticLifecycle",
    status: normalizeDiagnosticCheckpointStatus(control.status ?? control.state),
    label: `${control.command} ${control.code}`,
    detail: control.reason ?? control.recovery,
    handoff: explainDiagnosticCode(control.code).handoff,
    restartSafe: control.status !== "blocked" && control.state !== "required",
    idempotencyKey: `${control.code}:${control.command}:${control.status ?? control.state}`,
    nextAction: control.nextAction,
  }));
  const rows = Object.freeze([...controls, ...diagnosticRows]
    .sort(compareMailchimpDiagnosticCheckpointControls));
  const blocked = rows.filter((row) => row.status === "blocked");
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const status = lifecycle.state === "blocked" || checkpointReport.status === "blocked" || blocked.length
    ? "blocked"
    : pending.length || checkpointReport.status === "pending"
      ? "pending"
      : review.length || checkpointReport.status === "review"
        ? "review"
        : rows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-diagnostic-checkpoint-controls.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || (status === "review" && settings.allowReviewCheckpointExport === true),
    providerId: checkpointReport.providerId ?? "mailchimp",
    fileName: checkpointReport.fileName ?? settings.fileName ?? "inline.aios",
    revision: checkpointReport.revision ?? settings.revision ?? "working",
    controls: rows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countBy(rows, "status")),
      byKind: freezeSortedRecord(countBy(rows, "kind")),
      byHandoff: freezeSortedRecord(countBy(rows, "handoff")),
    }),
    totals: Object.freeze({
      controlCount: rows.length,
      checkpointControlCount: controls.length,
      diagnosticControlCount: diagnosticRows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      suppressedDiagnosticCount: lifecycle.suppressed?.length ?? 0,
    }),
    lifecycle: Object.freeze({
      state: lifecycle.state,
      exportAllowed: lifecycle.exportAllowed,
      nextAction: lifecycle.nextAction,
      suppressedCount: lifecycle.suppressed?.length ?? 0,
      scheduledRecoveryCount: lifecycle.scheduledRecoveries?.length ?? 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "diagnostics/mailchimp-checkpoints/recovery"
        : status === "pending"
          ? "diagnostics/mailchimp-checkpoints/actions"
          : status === "review"
            ? "diagnostics/mailchimp-checkpoints/review"
            : "diagnostics/mailchimp-checkpoints/summary",
      restartSafe: blocked.length === 0,
      blockedControlIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingControlIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewControlIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? lifecycle.nextAction
        ?? "publish-mailchimp-diagnostic-checkpoint-controls",
    }),
    checkpointReport,
  });
}

export function createFormatterAnalyticsExportDiagnostics(report = {}, options = {}) {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const diagnostics = [];
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pendingRows = rows.filter((row) => row.status === "pending");
  const reviewRows = rows.filter((row) => row.status === "review");

  for (const row of blockedRows) {
    diagnostics.push(createCatalogDiagnostic("AIOS_FORMATTER_ANALYTICS_EXPORT", {
      severity: "error",
      message: `Formatter analytics export row "${row.id}" is blocked or not restart-safe.`,
      hint: `Recovery: ${row.nextAction ?? "repair-formatter-analytics-export-report"}; handoff: formatter-analytics-export.`,
      preview: row.detail ?? row.label ?? row.id,
      range: options.rangeByReportRowId?.[row.id] ?? null,
    }));
  }

  if (!blockedRows.length && pendingRows.length && report.acceptance?.mode === "explicit") {
    diagnostics.push(createCatalogDiagnostic("AIOS_FORMATTER_ANALYTICS_EXPORT", {
      severity: "warning",
      message: `${pendingRows.length} formatter analytics export row(s) still need acceptance before report handoff.`,
      hint: "Recovery: accept-formatter-analytics-export-report; handoff: formatter-analytics-export.",
      preview: pendingRows.map((row) => row.id).sort().join(", "),
    }));
  }

  if (!blockedRows.length && !pendingRows.length && reviewRows.length && report.exportSummary?.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_FORMATTER_ANALYTICS_EXPORT", {
      severity: "warning",
      message: `${reviewRows.length} formatter analytics export row(s) require review before export evidence is finalized.`,
      hint: "Recovery: review-formatter-analytics-export-report; handoff: formatter-analytics-export.",
      preview: reviewRows.map((row) => row.id).sort().join(", "),
    }));
  }

  if (report.restartEnvelope?.restartSafe === false && !blockedRows.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_FORMATTER_ANALYTICS_EXPORT", {
      severity: "error",
      message: "Formatter analytics export report is not restart-safe.",
      hint: `Recovery: ${report.restartEnvelope.nextAction ?? "repair-formatter-analytics-export-report"}; handoff: formatter-analytics-export.`,
      preview: report.restartEnvelope.route ?? "formatter/analytics/export/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createMailchimpAstAnalyticsExportDiagnostics(bundle = {}, options = {}) {
  if (!bundle || bundle.version !== "mailchimp-ast-analytics-export-bundle.v1") {
    return Object.freeze([createCatalogDiagnostic("AIOS_MAILCHIMP_AST_ANALYTICS_EXPORT", {
      severity: "error",
      message: "Mailchimp AST analytics export bundle is missing or uses an unsupported version.",
      hint: "Recovery: rebuild-mailchimp-ast-analytics-export-bundle; handoff: mailchimp-ast-analytics-export.",
      preview: "mailchimp-ast-analytics-export-bundle.v1",
    })]);
  }

  const rows = Array.isArray(bundle.rows) ? bundle.rows : [];
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pendingRows = rows.filter((row) => row.status === "pending");
  const reviewRows = rows.filter((row) => row.status === "review");
  const diagnostics = [];

  for (const row of blockedRows) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_AST_ANALYTICS_EXPORT", {
      severity: "error",
      message: `Mailchimp AST analytics row "${row.id}" is blocked or not restart-safe.`,
      hint: `Recovery: ${row.nextAction ?? "repair-mailchimp-ast-analytics-export-bundle"}; handoff: mailchimp-ast-analytics-export.`,
      preview: row.detail ?? row.label ?? row.id,
      range: options.rangeByAstAnalyticsRowId?.[row.id] ?? null,
    }));
  }

  if (!blockedRows.length && pendingRows.length && bundle.acceptance?.mode === "explicit") {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_AST_ANALYTICS_EXPORT", {
      severity: "warning",
      message: `${pendingRows.length} Mailchimp AST analytics row(s) need acceptance before export.`,
      hint: "Recovery: accept-mailchimp-ast-analytics-export-bundle; handoff: mailchimp-ast-analytics-export.",
      preview: pendingRows.map((row) => row.id).sort().join(", "),
    }));
  }

  if (!blockedRows.length && !pendingRows.length && reviewRows.length && bundle.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_AST_ANALYTICS_EXPORT", {
      severity: "warning",
      message: `${reviewRows.length} Mailchimp AST analytics row(s) need review before export.`,
      hint: "Recovery: review-mailchimp-ast-analytics-export-bundle; handoff: mailchimp-ast-analytics-export.",
      preview: reviewRows.map((row) => row.id).sort().join(", "),
    }));
  }

  if (bundle.restartEnvelope?.restartSafe === false && !blockedRows.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_AST_ANALYTICS_EXPORT", {
      severity: "error",
      message: "Mailchimp AST analytics export bundle is not restart-safe.",
      hint: `Recovery: ${bundle.restartEnvelope.nextAction ?? "repair-mailchimp-ast-analytics-export-bundle"}; handoff: mailchimp-ast-analytics-export.`,
      preview: bundle.restartEnvelope.route ?? "mailchimp/ast-analytics/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createMailchimpAstPreviewAcceptanceDiagnostics(packetOrAst = {}, options = {}) {
  const packet = packetOrAst?.version === "mailchimp-ast-preview-acceptance.v1"
    ? packetOrAst
    : createMailchimpAstPreviewAcceptanceContract(packetOrAst, options);
  if (packet.status === "ready" || packet.status === "idle") {
    return Object.freeze([]);
  }

  const rows = Array.isArray(packet.rows) ? packet.rows : [];
  const diagnostics = [];
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review" || row.status === "changed");

  for (const row of blocked) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_AST_PREVIEW_ACCEPTANCE", {
      severity: "error",
      message: `Mailchimp AST preview row "${row.id}" is blocked before client preview handoff.`,
      hint: `Recovery: ${row.nextAction ?? packet.restartEnvelope?.nextAction ?? "complete-mailchimp-ast-preview-acceptance"}; handoff: mailchimp-ast-preview-acceptance.`,
      preview: row.detail ?? row.label ?? row.id,
      range: options.rangeByPreviewRowId?.[row.id]
        ?? options.rangeByAstPreviewRowId?.[row.id]
        ?? options.rangeByNodeKind?.[row.nodeKind]
        ?? null,
      mailchimpAstPreview: Object.freeze({
        id: row.id,
        kind: row.kind,
        nodeKind: row.nodeKind,
        status: row.status,
        sourceStatus: row.sourceStatus,
        route: row.route,
        restartSafe: row.restartSafe,
        accepted: row.accepted,
        completed: row.completed,
        nextAction: row.nextAction,
      }),
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_AST_PREVIEW_ACCEPTANCE", {
      severity: "warning",
      message: packet.acceptance?.mode === "explicit"
        ? `${pending.length} Mailchimp AST preview row(s) need acceptance before client preview handoff.`
        : `${pending.length} Mailchimp AST preview row(s) need runtime settlement before client preview handoff.`,
      hint: `Recovery: ${pending[0]?.nextAction ?? packet.restartEnvelope?.nextAction ?? "accept-mailchimp-ast-preview-acceptance"}; handoff: mailchimp-ast-preview-acceptance.`,
      preview: pending.map((row) => row.id).sort().join(", "),
      mailchimpAstPreview: Object.freeze({
        status: packet.status,
        pendingPreviewIds: packet.acceptance?.pendingPreviewIds ?? Object.freeze([]),
        route: packet.restartEnvelope?.route ?? "mailchimp/ast-preview/acceptance",
        nextAction: packet.restartEnvelope?.nextAction ?? pending[0]?.nextAction,
      }),
    }));
  }

  if (!blocked.length && !pending.length && review.length && packet.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_AST_PREVIEW_ACCEPTANCE", {
      severity: "warning",
      message: `${review.length} Mailchimp AST preview row(s) require review before client preview handoff.`,
      hint: `Recovery: ${review[0]?.nextAction ?? packet.restartEnvelope?.nextAction ?? "review-mailchimp-ast-preview-acceptance"}; handoff: mailchimp-ast-preview-acceptance.`,
      preview: review.map((row) => row.id).sort().join(", "),
      mailchimpAstPreview: Object.freeze({
        status: packet.status,
        reviewPreviewIds: packet.restartEnvelope?.reviewPreviewIds ?? Object.freeze([]),
        route: packet.restartEnvelope?.route ?? "mailchimp/ast-preview/review",
        nextAction: packet.restartEnvelope?.nextAction ?? review[0]?.nextAction,
      }),
    }));
  }

  if (packet.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_AST_PREVIEW_ACCEPTANCE", {
      severity: "error",
      message: "Mailchimp AST preview acceptance restart envelope is not restart-safe.",
      hint: `Recovery: ${packet.restartEnvelope.nextAction ?? "repair-mailchimp-ast-preview-acceptance"}; handoff: mailchimp-ast-preview-acceptance.`,
      preview: packet.restartEnvelope.route ?? "mailchimp/ast-preview/recovery",
    }));
  }

  if (!diagnostics.length && packet.validationSummary?.readyForPreview === false) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_AST_PREVIEW_ACCEPTANCE", {
      severity: "warning",
      message: "Mailchimp AST preview validation summary is not ready for preview handoff.",
      hint: `Recovery: ${packet.restartEnvelope?.nextAction ?? "complete-mailchimp-ast-preview-acceptance"}; handoff: mailchimp-ast-preview-acceptance.`,
      preview: packet.validationSummary.exportSummaryStatus ?? packet.status,
    }));
  }

  return Object.freeze(diagnostics);
}

export function createFormatterProductSliceReadinessDiagnostics(packet = {}, options = {}) {
  if (!packet
    || packet.version !== "formatter-product-slice-readiness.v1"
    || packet.status === "ready"
    || packet.status === "idle") {
    return Object.freeze([]);
  }

  const rows = Array.isArray(packet.rows) ? packet.rows : [];
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false || row.exportAllowed === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const diagnostics = [];

  for (const row of blocked) {
    diagnostics.push(createCatalogDiagnostic("AIOS_FORMATTER_PRODUCT_SLICE_READINESS", {
      severity: "error",
      message: `Formatter product-slice readiness row "${row.id}" is blocked before client handoff.`,
      hint: `Recovery: ${row.nextAction ?? packet.restartEnvelope?.nextAction ?? "complete-formatter-product-slice-readiness"}; handoff: formatter-product-slice-readiness.`,
      preview: row.detail ?? row.label ?? row.id,
      range: options.rangeByReadinessRowId?.[row.id] ?? options.rangeByLaneId?.[row.laneId] ?? null,
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_FORMATTER_PRODUCT_SLICE_READINESS", {
      severity: "warning",
      message: `${pending.length} formatter product-slice readiness row(s) need acceptance or runtime settlement.`,
      hint: `Recovery: ${pending[0]?.nextAction ?? packet.restartEnvelope?.nextAction ?? "accept-formatter-product-slice-readiness"}; handoff: formatter-product-slice-readiness.`,
      preview: pending.map((row) => row.id).sort().join(", "),
    }));
  }

  if (!blocked.length && !pending.length && review.length && packet.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_FORMATTER_PRODUCT_SLICE_READINESS", {
      severity: "warning",
      message: `${review.length} formatter product-slice readiness row(s) require review before client handoff.`,
      hint: `Recovery: ${review[0]?.nextAction ?? packet.restartEnvelope?.nextAction ?? "review-formatter-product-slice-readiness"}; handoff: formatter-product-slice-readiness.`,
      preview: review.map((row) => row.id).sort().join(", "),
    }));
  }

  if (packet.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_FORMATTER_PRODUCT_SLICE_READINESS", {
      severity: "error",
      message: "Formatter product-slice readiness packet is not restart-safe.",
      hint: `Recovery: ${packet.restartEnvelope.nextAction ?? "repair-formatter-product-slice-readiness"}; handoff: formatter-product-slice-readiness.`,
      preview: packet.restartEnvelope.route ?? "formatter/product-slice/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createMailchimpCampaignControlPlaneDiagnostics(controlPlaneOrState = {}, options = {}) {
  const controlPlane = controlPlaneOrState?.version === "mailchimp-campaign-control-plane.v1"
    ? controlPlaneOrState
    : createMailchimpCampaignControlPlaneContract(controlPlaneOrState, options);
  if (controlPlane.status === "ready" || controlPlane.status === "idle") {
    return Object.freeze([]);
  }

  const rows = Array.isArray(controlPlane.rows) ? controlPlane.rows : [];
  const actionableRows = rows.filter((row) => (
    row.status === "blocked"
    || row.status === "pending"
    || row.restartSafe === false
    || row.exportAllowed === false
  ));
  const reviewRows = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const diagnostics = [];

  for (const row of actionableRows) {
    const severity = row.status === "blocked" || row.restartSafe === false || row.exportAllowed === false
      ? "error"
      : "warning";
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_CONTROL_PLANE", {
      severity,
      message: `Mailchimp campaign control-plane row "${row.id}" is ${row.status} before client handoff.`,
      hint: `Recovery: ${row.nextAction ?? controlPlane.restartEnvelope?.nextAction ?? "repair-mailchimp-campaign-control-plane"}; handoff: ${row.handoff ?? "mailchimp-control-plane"}.`,
      preview: row.detail ?? row.label ?? row.id,
      range: options.rangeByControlPlaneRowId?.[row.id]
        ?? options.rangeByJobName?.[row.jobName]
        ?? null,
      mailchimpControlPlane: Object.freeze({
        id: row.id,
        kind: row.kind,
        jobName: row.jobName,
        commandId: row.commandId,
        status: row.status,
        route: row.route,
        handoff: row.handoff,
        restartSafe: row.restartSafe,
        exportAllowed: row.exportAllowed,
        nextAction: row.nextAction,
      }),
    }));
  }

  if (!diagnostics.length && reviewRows.length && controlPlane.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_CONTROL_PLANE", {
      severity: "warning",
      message: `${reviewRows.length} Mailchimp campaign control-plane row(s) require review before client handoff.`,
      hint: `Recovery: ${reviewRows[0]?.nextAction ?? controlPlane.restartEnvelope?.nextAction ?? "review-mailchimp-campaign-control-plane"}; handoff: mailchimp-control-plane.`,
      preview: reviewRows.map((row) => row.id).sort().join(", "),
    }));
  }

  if (controlPlane.restartEnvelope?.restartSafe === false && !diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_CONTROL_PLANE", {
      severity: "error",
      message: "Mailchimp campaign control-plane restart envelope is not restart-safe.",
      hint: `Recovery: ${controlPlane.restartEnvelope.nextAction ?? "repair-mailchimp-campaign-control-plane"}; handoff: mailchimp-control-plane.`,
      preview: controlPlane.restartEnvelope.route ?? "mailchimp/control-plane/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createSourceRangeFailureRecoveryDiagnostics(recoveryState = {}, options = {}) {
  const rows = Array.isArray(recoveryState.rows) ? recoveryState.rows : [];
  const diagnostics = [];
  const actionableRows = rows.filter((row) => (
    row.status === "blocked"
    || row.status === "pending"
    || row.status === "degraded"
    || row.exhausted === true
    || row.restartSafe === false
  ));

  for (const row of actionableRows) {
    const severity = row.status === "blocked" || row.restartSafe === false || row.exhausted === true
      ? "error"
      : "warning";
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_FAILURE_RECOVERY", {
      severity,
      message: createSourceRangeFailureRecoveryDiagnosticMessage(row),
      hint: `Recovery: ${row.nextAction ?? recoveryState.restartEnvelope?.nextAction ?? "repair-source-range-failure-recovery"}; handoff: source-range-failure-recovery.`,
      preview: row.previewAddress ?? row.label ?? row.id,
      range: options.rangeByRecoveryRowId?.[row.id]
        ?? options.rangeBySourceId?.[row.targetId]
        ?? null,
      sourceRangeRecovery: Object.freeze({
        id: row.id,
        kind: row.kind,
        targetId: row.targetId,
        status: row.status,
        sourceStatus: row.sourceStatus,
        restartSafe: row.restartSafe,
        retryable: row.retryable,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        exhausted: row.exhausted,
        degradedAllowed: row.degradedAllowed,
        retryAfterSeconds: row.retryAfterSeconds,
        route: row.route,
        nextAction: row.nextAction,
      }),
    }));
  }

  if (!diagnostics.length && recoveryState.status === "degraded") {
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_FAILURE_RECOVERY", {
      severity: "warning",
      message: "Source range handoff is running in degraded mode.",
      hint: `Recovery: ${recoveryState.restartEnvelope?.nextAction ?? "review-source-range-failure-recovery"}; handoff: source-range-failure-recovery.`,
      preview: recoveryState.userVisible?.detail ?? recoveryState.syncKey ?? "source-range-degraded-mode",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createSourceRangeRecoveryCommandExportDiagnostics(commandExport = {}, options = {}) {
  if (!commandExport || commandExport.version !== "source-range-recovery-command-export.v1") {
    return Object.freeze([]);
  }

  const commands = Array.isArray(commandExport.commands) ? commandExport.commands : [];
  const diagnostics = [];
  const blocked = commands.filter((command) => command.status === "blocked" || command.restartSafe === false);
  const pending = commands.filter((command) => command.status === "pending" || command.status === "needsAcceptance");
  const review = commands.filter((command) => command.status === "review");

  for (const command of blocked) {
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_RECOVERY_COMMAND_EXPORT", {
      severity: "error",
      message: `Source range recovery command "${command.commandId}" is blocked before formatter handoff.`,
      hint: `Recovery: ${command.nextAction ?? commandExport.restartEnvelope?.nextAction ?? "repair-source-range-recovery-command-export"}; handoff: source-range-recovery-command-export.`,
      preview: command.previewAddress ?? command.targetId ?? command.commandId,
      range: options.rangeByRecoveryCommandId?.[command.commandId]
        ?? options.rangeByRecoveryRowId?.[command.recoveryRowId]
        ?? options.rangeBySourceId?.[command.targetId]
        ?? null,
      sourceRangeRecoveryCommand: Object.freeze({
        commandId: command.commandId,
        recoveryRowId: command.recoveryRowId,
        targetId: command.targetId,
        status: command.status,
        intent: command.intent,
        restartSafe: command.restartSafe,
        retryable: command.retryable,
        attempts: command.attempts,
        maxAttempts: command.maxAttempts,
        retryAfterSeconds: command.retryAfterSeconds,
        route: command.route,
        nextAction: command.nextAction,
      }),
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_RECOVERY_COMMAND_EXPORT", {
      severity: "warning",
      message: `${pending.length} source range recovery command(s) need acceptance or retry settlement.`,
      hint: `Recovery: ${pending[0]?.nextAction ?? commandExport.restartEnvelope?.nextAction ?? "accept-source-range-recovery-command-export"}; handoff: source-range-recovery-command-export.`,
      preview: pending.map((command) => command.commandId).sort().join(", "),
    }));
  }

  if (!blocked.length && !pending.length && review.length && commandExport.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_RECOVERY_COMMAND_EXPORT", {
      severity: "warning",
      message: `${review.length} source range recovery command(s) require review before formatter handoff.`,
      hint: `Recovery: ${review[0]?.nextAction ?? commandExport.restartEnvelope?.nextAction ?? "review-source-range-recovery-command-export"}; handoff: source-range-recovery-command-export.`,
      preview: review.map((command) => command.commandId).sort().join(", "),
    }));
  }

  if (commandExport.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_RECOVERY_COMMAND_EXPORT", {
      severity: "error",
      message: "Source range recovery command export restart envelope is not restart-safe.",
      hint: `Recovery: ${commandExport.restartEnvelope.nextAction ?? "repair-source-range-recovery-command-export"}; handoff: source-range-recovery-command-export.`,
      preview: commandExport.restartEnvelope.route ?? "source-ranges/recovery-commands/repair",
    }));
  }

  return Object.freeze(diagnostics);
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

export function createMailchimpLifecycleCommandDiagnostics(commandState = {}, options = {}) {
  const state = commandState?.version === "mailchimp-lifecycle-command-state.v1"
    ? commandState
    : createMailchimpLifecycleCommandState(commandState, options);
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const actionable = rows.filter((row) => (
    row.status === "blocked"
    || row.status === "pending"
    || row.status === "review"
  ));

  return Object.freeze(actionable.map((row) => createCatalogDiagnostic("AIOS_MAILCHIMP_LIFECYCLE_COMMAND", {
    severity: row.status === "blocked" ? "error" : "warning",
    range: options.rangeByJobName?.[row.jobName] ?? null,
    message: `Mailchimp lifecycle command "${row.commandId}" for "${row.jobName}" is ${row.status}.`,
    hint: `Recovery: ${row.nextAction}; handoff: mailchimp-lifecycle-command-queue.`,
    preview: row.detail,
    lifecycleCommand: Object.freeze({
      id: row.id,
      commandId: row.commandId,
      jobName: row.jobName,
      status: row.status,
      jobStatus: row.jobStatus,
      requested: row.requested,
      completed: row.completed,
      failed: row.failed,
      restartSafe: state.restartEnvelope?.restartSafe !== false && row.status !== "blocked",
      idempotencyKey: row.idempotencyKey,
      nextAction: row.nextAction,
    }),
  })));
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
  const operationalHealthReport = createMailchimpOperationalHealthReport(commandContract.operationalHealth, {
    rangeByJobName: settings.rangeByJobName,
  });
  const receiptDiagnostics = createMailchimpProviderReceiptDiagnostics(receiptContract, {
    rangeByJobName: settings.rangeByJobName,
  });
  const lifecycleCommandState = workflowState.lifecycleCommandState?.version === "mailchimp-lifecycle-command-state.v1"
    ? workflowState.lifecycleCommandState
    : createMailchimpLifecycleCommandState(workflowState, settings);
  const lifecycleCommandDiagnostics = createMailchimpLifecycleCommandDiagnostics(lifecycleCommandState, {
    rangeByJobName: settings.rangeByJobName,
  });
  const serviceSyncWindowDiagnostics = createMailchimpProviderServiceSyncWindowDiagnostics(serviceContract?.serviceSyncWindows, {
    rangeByJobName: settings.rangeByJobName,
  });
  const tenantBoundaryContract = createMailchimpTenantPermissionBoundaryContract(workflowState, {
    revision: settings.revision,
    externalRunId: serviceContract?.syncMetadata?.externalRunId,
  });
  const tenantBoundaryDiagnostics = createMailchimpTenantPermissionBoundaryDiagnostics(tenantBoundaryContract, {
    rangeByJobName: settings.rangeByJobName,
    acceptedMailchimpTenantAuditRowIds: settings.acceptedMailchimpTenantAuditRowIds,
    acceptedMailchimpTenantJobNames: settings.acceptedMailchimpTenantJobNames,
    requiredMailchimpTenantOperationIds: settings.requiredMailchimpTenantOperationIds,
    requireMailchimpTenantPermissionAcceptance: settings.requireMailchimpTenantPermissionAcceptance,
    allowReviewTenantPermissionHandoff: settings.allowReviewTenantPermissionHandoff,
  });
  const activeDiagnostics = Object.freeze([
    ...(Array.isArray(diagnostics) ? diagnostics : []),
    ...healthDiagnostics,
    ...operationalHealthReport.diagnostics,
    ...receiptDiagnostics,
    ...lifecycleCommandDiagnostics,
    ...serviceSyncWindowDiagnostics,
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
      && lifecycleCommandState.status !== "blocked"
      && commandContract.status !== "blocked"
      && commandContract.operationalHealth.status !== "blocked"
      && receiptContract.status !== "blocked"
      && receiptContract.status !== "failed"
      && tenantBoundaryContract.status !== "blocked",
    status: commandContract.status === "blocked"
      || commandContract.operationalHealth.status === "blocked"
      || receiptContract.status === "blocked"
      || receiptContract.status === "failed"
      || lifecycleCommandState.status === "blocked"
      || tenantBoundaryContract.status === "blocked"
      ? "blocked"
      : commandContract.status === "degraded"
        || commandContract.operationalHealth.status === "degraded"
        || receiptContract.status === "pending"
        || lifecycleCommandState.status === "pending"
        || tenantBoundaryContract.status === "review"
        ? "review"
        : readinessPreview.status,
    providerId: workflowState.providerId ?? "mailchimp",
    detected: Boolean(workflowState.detected),
    exportAllowed: workflowState.handoff?.exportAllowed !== false
      && recoveryPlan.exportAllowed
      && readinessPreview.acceptance.acceptable
      && lifecycleCommandState.exportAllowed
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
      report: operationalHealthReport,
      exportDigest: operationalHealthReport.exportDigest,
    }),
    lifecycleCommands: lifecycleCommandState,
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
      serviceSyncWindowStatus: serviceContract?.serviceSyncWindows?.status ?? "unbound",
      serviceSyncWindowCount: serviceContract?.serviceSyncWindows?.windowCount ?? 0,
      serviceSyncWindowByStatus: serviceContract?.serviceSyncWindows?.counters?.byStatus ?? {},
      lifecycleCommandStatus: lifecycleCommandState.status,
      lifecycleCommandCount: lifecycleCommandState.totals?.rowCount ?? 0,
      lifecycleCommandByStatus: lifecycleCommandState.counters?.byStatus ?? {},
      operationalHealthStatus: commandContract.operationalHealth.status,
      operationalHealthIssueCount: commandContract.operationalHealth.issueCount,
      operationalHealthActionableCount: operationalHealthReport.totals.actionableCount,
      operationalHealthRetryScheduleCount: operationalHealthReport.totals.retryScheduleCount,
      tenantBoundaryContractStatus: tenantBoundaryContract.status,
      tenantBoundaryBlockedCount: tenantBoundaryContract.totals.blockedCount,
      tenantBoundaryReviewCount: tenantBoundaryContract.totals.reviewCount,
    }),
    tenantPermissionBoundary: tenantBoundaryContract,
    nextAction: receiptContract.status === "blocked" || receiptContract.status === "failed" || receiptContract.status === "pending"
      ? receiptContract.recovery.nextAction
      : lifecycleCommandState.status === "blocked" || lifecycleCommandState.status === "pending"
      ? lifecycleCommandState.nextAction
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

export function createMailchimpOperationalHealthReport(operationalHealth = {}, options = {}) {
  const exportDigest = operationalHealth.exportDigest?.version === "mailchimp-operational-health-export-digest.v1"
    ? operationalHealth.exportDigest
    : createMailchimpOperationalHealthExportDigest(operationalHealth, options);
  const incidentLedger = operationalHealth.incidentLedger?.version === "mailchimp-operational-health-incident-ledger.v1"
    ? operationalHealth.incidentLedger
    : createMailchimpOperationalHealthIncidentLedger(exportDigest, {
      ...options,
      commandHealth: operationalHealth.commandHealth,
      recoverySnapshot: operationalHealth.recoverySnapshot,
      degradedMode: operationalHealth.degradedMode,
    });
  const diagnostics = Object.freeze([
    ...createMailchimpOperationalHealthDigestDiagnostics(exportDigest, options),
    ...createMailchimpOperationalHealthIncidentDiagnostics(incidentLedger, options),
  ]);
  const recoveryPlan = options.recoveryPlan?.actions
    ? options.recoveryPlan
    : createDiagnosticRecoveryPlan(diagnostics);
  const rows = Array.isArray(exportDigest.actionableRows) ? exportDigest.actionableRows : [];
  const incidents = Array.isArray(incidentLedger.rows) ? incidentLedger.rows : [];
  const retryRows = Array.isArray(exportDigest.retrySchedule) ? exportDigest.retrySchedule : [];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const degradedRows = rows.filter((row) => row.status === "degraded");
  const errorIncidents = incidents.filter((row) => row.severity === "error");
  const warningIncidents = incidents.filter((row) => row.severity === "warning");
  const status = exportDigest.status === "blocked" || blockedRows.length
    ? "blocked"
    : incidentLedger.status === "blocked" || errorIncidents.length
      ? "blocked"
    : exportDigest.status === "degraded" || degradedRows.length
      ? "review"
      : incidentLedger.status === "degraded" || warningIncidents.length
        ? "review"
      : exportDigest.status === "pending" || pendingRows.length
        ? "pending"
        : incidentLedger.status === "pending"
          ? "pending"
        : exportDigest.status ?? "idle";

  return Object.freeze({
    version: "mailchimp-operational-health-report.v1",
    status,
    ok: status === "ready" || status === "idle",
    providerId: exportDigest.providerId,
    revision: exportDigest.revision,
    externalRunId: exportDigest.externalRunId,
    exportAllowed: exportDigest.handoff?.exportAllowed === true
      && incidentLedger.handoff?.exportAllowed !== false
      && recoveryPlan.exportAllowed,
    restartSafe: exportDigest.restartSafe
      && exportDigest.handoff?.restartSafe !== false
      && incidentLedger.restartSafe !== false
      && incidentLedger.handoff?.restartSafe !== false,
    route: exportDigest.route,
    syncKey: exportDigest.syncKey,
    counters: Object.freeze({
      byStatus: exportDigest.counters?.byStatus ?? {},
      byIssue: exportDigest.counters?.byIssue ?? {},
      byJob: exportDigest.counters?.byJob ?? {},
      byIncidentSeverity: incidentLedger.counters?.bySeverity ?? {},
      byIncidentAction: incidentLedger.counters?.byAction ?? {},
      recoveryByAction: freezeSortedRecord(countBy(recoveryPlan.actions ?? [], "id")),
    }),
    totals: Object.freeze({
      commandCount: exportDigest.totals?.commandCount ?? 0,
      actionableCount: rows.length,
      blockedCount: blockedRows.length,
      degradedCount: degradedRows.length,
      pendingCount: pendingRows.length,
      incidentCount: incidents.length,
      incidentErrorCount: errorIncidents.length,
      incidentWarningCount: warningIncidents.length,
      retryBudgetExhaustedIncidentCount: incidentLedger.totals?.retryBudgetExhaustedCount ?? 0,
      retryScheduleCount: retryRows.length,
      diagnosticCount: recoveryPlan.actions?.reduce((sum, action) => sum + (action.count ?? 0), 0) ?? 0,
    }),
    timeline: Object.freeze(rows.map((row, index) => Object.freeze({
      index,
      id: row.id,
      commandId: row.commandId,
      jobName: row.jobName,
      status: row.status,
      route: row.route ?? exportDigest.route,
      retryAfter: row.retryAfter,
      restartSafe: row.restartSafe,
      nextAction: row.nextAction,
    }))),
    retrySchedule: Object.freeze(retryRows),
    incidentLedger,
    diagnostics,
    recoveryPlan,
    exportDigest,
    handoff: Object.freeze({
      ...exportDigest.handoff,
      exportAllowed: exportDigest.handoff?.exportAllowed === true
        && incidentLedger.handoff?.exportAllowed !== false
        && recoveryPlan.exportAllowed,
      restartSafe: exportDigest.handoff?.restartSafe !== false
        && incidentLedger.restartSafe !== false
        && incidentLedger.handoff?.restartSafe !== false,
      nextAction: blockedRows[0]?.nextAction
        ?? errorIncidents[0]?.nextAction
        ?? degradedRows[0]?.nextAction
        ?? warningIncidents[0]?.nextAction
        ?? pendingRows[0]?.nextAction
        ?? recoveryPlan.actions?.[0]?.id
        ?? incidentLedger.handoff?.nextAction
        ?? exportDigest.nextAction,
    }),
    nextAction: blockedRows[0]?.nextAction
      ?? errorIncidents[0]?.nextAction
      ?? degradedRows[0]?.nextAction
      ?? warningIncidents[0]?.nextAction
      ?? pendingRows[0]?.nextAction
      ?? incidentLedger.recovery?.nextAction
      ?? exportDigest.nextAction,
  });
}

export function createMailchimpOperationalHealthDigestDiagnostics(exportDigest = {}, options = {}) {
  if (!exportDigest || exportDigest.status === "ready" || exportDigest.status === "idle") {
    return Object.freeze([]);
  }

  const rows = Array.isArray(exportDigest.actionableRows) ? exportDigest.actionableRows : [];
  const diagnostics = rows.map((row) => createCatalogDiagnostic("AIOS_MAILCHIMP_OPERATIONAL_HEALTH", {
    severity: row.status === "blocked" ? "error" : "warning",
    range: options.rangeByJobName?.[row.jobName] ?? null,
    message: `Mailchimp operational health export row "${row.id}" is ${row.status}.`,
    hint: `Recovery: ${row.nextAction}; route: ${row.route ?? exportDigest.route}; handoff: mailchimp-operational-health.`,
    preview: row.detail,
  }));

  if (!rows.length && exportDigest.restartSafe === false) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_OPERATIONAL_HEALTH", {
      severity: "error",
      message: "Mailchimp operational health digest is not restart-safe.",
      hint: `Recovery: ${exportDigest.nextAction ?? "repair-mailchimp-operational-health"}; handoff: mailchimp-operational-health.`,
      preview: exportDigest.route ?? "mailchimp/operational-health/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createMailchimpOperationalHealthIncidentDiagnostics(incidentLedger = {}, options = {}) {
  if (!incidentLedger
    || incidentLedger.version !== "mailchimp-operational-health-incident-ledger.v1"
    || incidentLedger.status === "ready"
    || incidentLedger.status === "idle") {
    return Object.freeze([]);
  }

  const rows = Array.isArray(incidentLedger.rows) ? incidentLedger.rows : [];
  const actionable = rows.filter((row) => (
    row.severity === "error"
    || row.severity === "warning"
    || row.retryBudgetStatus === "exhausted"
    || row.restartSafe === false
    || row.status === "pending"
  ));
  const diagnostics = actionable.map((row) => createCatalogDiagnostic("AIOS_MAILCHIMP_OPERATIONAL_HEALTH", {
    severity: row.severity === "error" || row.retryBudgetStatus === "exhausted" || row.restartSafe === false
      ? "error"
      : "warning",
    range: options.rangeByJobName?.[row.jobName]
      ?? options.rangeByCommandId?.[row.commandId]
      ?? null,
    message: `Mailchimp operational incident "${row.commandId ?? row.id}" is ${row.status}.`,
    hint: [
      `Recovery: ${row.nextAction ?? incidentLedger.recovery?.nextAction ?? "repair-mailchimp-operational-health"}`,
      `route: ${row.route ?? incidentLedger.handoff?.route ?? "mailchimp/operational-health/incidents"}`,
      `handoff: ${incidentLedger.handoff?.channel ?? "mailchimp-operational-health-incidents"}.`,
      row.retryAfter ? `retryAfter=${row.retryAfter}.` : null,
      row.retryBudgetStatus === "exhausted" ? "retryBudget=exhausted." : null,
      row.restartSafe === false ? "restartSafe=false." : null,
    ].filter(Boolean).join("; "),
    preview: row.detail ?? `${row.jobName ?? "unbound job"} ${row.service ?? "unknown"}.${row.operation ?? "unknown"}`,
    operationalIncident: Object.freeze({
      id: row.id,
      commandId: row.commandId,
      operationId: row.operationId,
      jobName: row.jobName,
      severity: row.severity,
      status: row.status,
      issueCodes: row.issueCodes ?? Object.freeze([]),
      retryable: row.retryable,
      retryAfter: row.retryAfter,
      retryBudgetStatus: row.retryBudgetStatus,
      remainingAttempts: row.remainingAttempts,
      restartSafe: row.restartSafe,
      route: row.route,
      nextAction: row.nextAction,
      ledgerSyncKey: incidentLedger.syncKey ?? null,
    }),
  }));

  if (!diagnostics.length && incidentLedger.handoff?.restartSafe === false) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_OPERATIONAL_HEALTH", {
      severity: "error",
      message: "Mailchimp operational incident ledger is not restart-safe.",
      hint: `Recovery: ${incidentLedger.handoff.nextAction ?? "repair-mailchimp-operational-health-incidents"}; handoff: ${incidentLedger.handoff.channel ?? "mailchimp-operational-health-incidents"}.`,
      preview: incidentLedger.handoff.route ?? "mailchimp/operational-health/incidents/recovery",
    }));
  }

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

export function createMailchimpProviderServiceSyncWindowDiagnostics(serviceSyncWindows = {}, options = {}) {
  if (!serviceSyncWindows
    || serviceSyncWindows.status === "ready"
    || serviceSyncWindows.status === "idle") {
    return Object.freeze([]);
  }

  const windows = Array.isArray(serviceSyncWindows.windows) ? serviceSyncWindows.windows : [];
  const actionable = windows.filter((window) => (
    window.status === "blocked"
    || window.status === "pending"
    || window.status === "review"
  ));

  return Object.freeze(actionable.map((window) => {
    const jobName = inferMailchimpWindowJobName(window);
    const severity = window.status === "blocked" ? "error" : "warning";
    return createCatalogDiagnostic("AIOS_MAILCHIMP_SERVICE_SYNC_WINDOW", {
      severity,
      range: jobName ? options.rangeByJobName?.[jobName] ?? null : null,
      message: `Mailchimp service sync window "${window.channel}" is ${window.status}.`,
      hint: `Recovery: ${window.nextAction}; handoff: mailchimp-service-sync-window.`,
      preview: [
        `${window.operationCount ?? 0} provider operations share ${window.channel}.`,
        `services=${(window.services ?? []).join(",") || "unbound"}`,
        `tenants=${(window.tenants ?? []).join(",") || "unbound"}`,
      ].join(" "),
      serviceSyncWindow: Object.freeze({
        id: window.id,
        channel: window.channel,
        status: window.status,
        accepted: Boolean(window.accepted),
        requireAcceptance: Boolean(window.requireAcceptance),
        operationIds: window.operationIds ?? Object.freeze([]),
        operationCount: window.operationCount ?? 0,
        services: window.services ?? Object.freeze([]),
        tenants: window.tenants ?? Object.freeze([]),
        workspaces: window.workspaces ?? Object.freeze([]),
        restartSafe: window.restartSafe !== false,
        idempotencyKey: window.idempotencyKey ?? null,
        nextAction: window.nextAction,
      }),
    });
  }));
}

export function createMailchimpProviderServiceSyncCheckpointDiagnostics(checkpoint = {}, options = {}) {
  if (!checkpoint
    || checkpoint.status === "ready"
    || checkpoint.status === "idle") {
    return Object.freeze([]);
  }

  const rows = Array.isArray(checkpoint.rows) ? checkpoint.rows : [];
  const actionable = rows.filter((row) => (
    row.status === "blocked"
    || row.status === "pending"
    || row.status === "review"
    || row.restartSafe === false
  ));

  if (!actionable.length && checkpoint.restartEnvelope?.restartSafe === false) {
    return Object.freeze([createCatalogDiagnostic("AIOS_MAILCHIMP_SERVICE_SYNC_WINDOW", {
      severity: "error",
      message: "Mailchimp service sync checkpoint is not restart-safe.",
      hint: `Recovery: ${checkpoint.restartEnvelope.nextAction ?? "repair-mailchimp-service-sync-checkpoint"}; handoff: mailchimp-service-sync-window.`,
      preview: checkpoint.restartEnvelope.route ?? "mailchimp/service-sync-checkpoint/recovery",
      serviceSyncCheckpoint: Object.freeze({
        status: checkpoint.status,
        route: checkpoint.restartEnvelope.route ?? null,
        restartSafe: false,
        syncKey: checkpoint.syncKey ?? null,
        nextAction: checkpoint.restartEnvelope.nextAction ?? "repair-mailchimp-service-sync-checkpoint",
      }),
    })]);
  }

  return Object.freeze(actionable.map((row) => {
    const jobName = inferMailchimpWindowJobName(row);
    const severity = row.status === "blocked" || row.restartSafe === false ? "error" : "warning";
    const pendingReason = row.status === "pending"
      ? row.accepted
        ? "completion is pending"
        : "acceptance is pending"
      : row.status;
    return createCatalogDiagnostic("AIOS_MAILCHIMP_SERVICE_SYNC_WINDOW", {
      severity,
      range: jobName ? options.rangeByJobName?.[jobName] ?? null : null,
      message: `Mailchimp service sync checkpoint "${row.channel}" is ${row.status}.`,
      hint: `Recovery: ${row.nextAction}; handoff: mailchimp-service-sync-window.`,
      preview: [
        `${row.operationCount ?? 0} provider operations are in checkpoint ${row.windowId}.`,
        `state=${pendingReason}`,
        `services=${(row.services ?? []).join(",") || "unbound"}`,
      ].join(" "),
      serviceSyncCheckpoint: Object.freeze({
        id: row.id,
        windowId: row.windowId,
        channel: row.channel,
        status: row.status,
        sourceStatus: row.sourceStatus,
        accepted: Boolean(row.accepted),
        completed: Boolean(row.completed),
        required: Boolean(row.required),
        restartSafe: row.restartSafe !== false,
        operationIds: row.operationIds ?? Object.freeze([]),
        idempotencyKey: row.idempotencyKey ?? null,
        route: checkpoint.restartEnvelope?.route ?? "mailchimp/service-sync-checkpoint/summary",
        syncKey: checkpoint.syncKey ?? null,
        nextAction: row.nextAction,
      }),
    });
  }));
}

export function createMailchimpProviderServiceReadinessDiagnostics(matrixOrServiceContract = {}, options = {}) {
  const matrix = matrixOrServiceContract?.version === "mailchimp-provider-service-readiness-matrix.v1"
    ? matrixOrServiceContract
    : createMailchimpProviderServiceReadinessMatrix(matrixOrServiceContract, options);
  if (!matrix
    || matrix.status === "ready"
    || matrix.status === "idle"
    || (matrix.status === "degraded" && matrix.exportAllowed === true)) {
    return Object.freeze([]);
  }

  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const actionable = rows.filter((row) => (
    row.status === "blocked"
    || row.status === "pending"
    || row.status === "review"
    || row.status === "degraded"
    || row.restartSafe === false
  ));

  if (!actionable.length && matrix.restartEnvelope?.restartSafe === false) {
    return Object.freeze([createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_CONTRACT", {
      severity: "error",
      message: "Mailchimp provider service readiness matrix is not restart-safe.",
      hint: `Recovery: ${matrix.restartEnvelope.nextAction ?? "repair-mailchimp-provider-service-readiness"}; handoff: mailchimp-provider-service-readiness.`,
      preview: matrix.restartEnvelope.route ?? "mailchimp/provider-service-readiness/recovery",
    })]);
  }

  return Object.freeze(actionable.map((row) => {
    const severity = row.status === "blocked" || row.restartSafe === false ? "error" : "warning";
    const missing = (row.missingCapabilities ?? []).join(", ");
    const serviceLabel = `${row.service}.${row.operation}`;
    return createCatalogDiagnostic(row.status === "degraded"
      ? "AIOS_MAILCHIMP_SERVICE_SYNC_WINDOW"
      : "AIOS_MAILCHIMP_PROVIDER_CONTRACT", {
      severity,
      range: options.rangeByServiceReadinessRowId?.[row.id]
        ?? options.rangeByService?.[row.service]
        ?? null,
      message: `Mailchimp provider service "${serviceLabel}" is ${row.status}.`,
      hint: `Recovery: ${row.nextAction}; handoff: mailchimp-provider-service-readiness.`,
      preview: [
        `operations=${row.operationCount ?? 0}`,
        `capability=${row.capabilityStatus ?? "unknown"}`,
        `checkpoint=${row.checkpointStatus ?? "unknown"}`,
        missing ? `missing=${missing}` : null,
      ].filter(Boolean).join(" "),
    });
  }));
}

export function createMailchimpProviderServiceHandoffDiagnostics(handoffOrServiceContract = {}, options = {}) {
  const handoff = handoffOrServiceContract?.version === "mailchimp-provider-service-handoff.v1"
    ? handoffOrServiceContract
    : createMailchimpProviderServiceHandoffContract(handoffOrServiceContract, options);
  if (!handoff
    || handoff.status === "ready"
    || handoff.status === "idle"
    || (handoff.status === "review" && handoff.exportAllowed === true)) {
    return Object.freeze([]);
  }

  const lanes = Array.isArray(handoff.lanes) ? handoff.lanes : [];
  const blocked = lanes.filter((lane) => lane.status === "blocked" || lane.restartSafe === false || lane.exportAllowed === false);
  const pending = lanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance");
  const review = lanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const diagnostics = [];

  for (const lane of blocked) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF", {
      severity: "error",
      message: `Mailchimp provider service handoff lane "${lane.id}" is blocked before external handoff.`,
      hint: `Recovery: ${lane.nextAction ?? handoff.restartEnvelope?.nextAction ?? "complete-mailchimp-provider-service-handoff"}; handoff: ${lane.handoff ?? "mailchimp-provider-service-handoff"}.`,
      preview: lane.detail ?? lane.label ?? lane.id,
      range: options.rangeByProviderServiceHandoffLaneId?.[lane.id]
        ?? options.rangeByLaneId?.[lane.id]
        ?? null,
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF", {
      severity: "warning",
      message: `${pending.length} Mailchimp provider service handoff lane(s) need runtime settlement or acceptance.`,
      hint: `Recovery: ${pending[0]?.nextAction ?? handoff.restartEnvelope?.nextAction ?? "settle-mailchimp-provider-service-handoff"}; handoff: mailchimp-provider-service-handoff.`,
      preview: pending.map((lane) => lane.id).sort().join(", "),
    }));
  }

  if (!blocked.length && !pending.length && review.length && handoff.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF", {
      severity: "warning",
      message: `${review.length} Mailchimp provider service handoff lane(s) require review before external handoff.`,
      hint: `Recovery: ${review[0]?.nextAction ?? handoff.restartEnvelope?.nextAction ?? "review-mailchimp-provider-service-handoff"}; handoff: mailchimp-provider-service-handoff.`,
      preview: review.map((lane) => lane.id).sort().join(", "),
    }));
  }

  if (handoff.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF", {
      severity: "error",
      message: "Mailchimp provider service handoff contract is not restart-safe.",
      hint: `Recovery: ${handoff.restartEnvelope.nextAction ?? "repair-mailchimp-provider-service-handoff"}; handoff: mailchimp-provider-service-handoff.`,
      preview: handoff.restartEnvelope.route ?? "mailchimp/provider-service-handoff/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createMailchimpProviderServiceHandoffExportDiagnostics(deckOrHandoff = {}, options = {}) {
  const deck = deckOrHandoff?.version === "mailchimp-provider-service-handoff-export-deck.v1"
    ? deckOrHandoff
    : createMailchimpProviderServiceHandoffExportDeck(deckOrHandoff, options);
  if (!deck
    || deck.status === "ready"
    || deck.status === "idle"
    || (deck.status === "review" && deck.exportAllowed === true)) {
    return Object.freeze([]);
  }

  const rows = Array.isArray(deck.rows) ? deck.rows : [];
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false || row.exportAllowed === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const diagnostics = [];

  for (const row of blocked) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF", {
      severity: "error",
      message: `Mailchimp provider service handoff export row "${row.id}" is blocked before product health export.`,
      hint: `Recovery: ${row.nextAction ?? deck.restartEnvelope?.nextAction ?? "repair-mailchimp-provider-service-handoff-export"}; handoff: mailchimp-provider-service-handoff.`,
      preview: row.detail ?? row.label ?? row.id,
      range: options.rangeByProviderServiceHandoffExportRowId?.[row.id]
        ?? options.rangeByProviderServiceHandoffLaneId?.[row.laneId]
        ?? options.rangeByLaneId?.[row.laneId]
        ?? null,
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF", {
      severity: "warning",
      message: `${pending.length} Mailchimp provider service handoff export row(s) need acceptance before product health export.`,
      hint: `Recovery: ${pending[0]?.nextAction ?? deck.restartEnvelope?.nextAction ?? "accept-mailchimp-provider-service-handoff-export"}; handoff: mailchimp-provider-service-handoff.`,
      preview: pending.map((row) => row.id).sort().join(", "),
    }));
  }

  if (!blocked.length && !pending.length && review.length && deck.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF", {
      severity: "warning",
      message: `${review.length} Mailchimp provider service handoff export row(s) need review before product health export.`,
      hint: `Recovery: ${review[0]?.nextAction ?? deck.restartEnvelope?.nextAction ?? "review-mailchimp-provider-service-handoff-export"}; handoff: mailchimp-provider-service-handoff.`,
      preview: review.map((row) => row.id).sort().join(", "),
    }));
  }

  if (deck.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SERVICE_HANDOFF", {
      severity: "error",
      message: "Mailchimp provider service handoff export deck is not restart-safe.",
      hint: `Recovery: ${deck.restartEnvelope.nextAction ?? "repair-mailchimp-provider-service-handoff-export"}; handoff: mailchimp-provider-service-handoff.`,
      preview: deck.restartEnvelope.route ?? "mailchimp/provider-service-handoff/export/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createMailchimpProviderSourceDeploymentDiagnostics(packet = {}, options = {}) {
  if (!packet
    || packet.version !== "mailchimp-provider-source-deployment.v1"
    || packet.status === "ready"
    || packet.status === "idle"
    || (packet.status === "review" && packet.exportAllowed === true)) {
    return Object.freeze([]);
  }

  const rows = Array.isArray(packet.rows) ? packet.rows : [];
  const diagnostics = [];
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false || row.exportAllowed === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");

  for (const row of blocked) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SOURCE_DEPLOYMENT", {
      severity: "error",
      message: `Mailchimp provider source deployment row "${row.id}" is blocked before external handoff.`,
      hint: `Recovery: ${row.nextAction ?? packet.restartEnvelope?.nextAction ?? "complete-mailchimp-provider-source-deployment"}; handoff: mailchimp-provider-source-deployment.`,
      preview: row.detail ?? row.label ?? row.id,
      range: options.rangeByProviderSourceDeploymentRowId?.[row.id]
        ?? options.rangeByProviderServiceHandoffLaneId?.[row.laneId]
        ?? options.rangeByService?.[row.service]
        ?? null,
      providerSourceDeployment: Object.freeze({
        id: row.id,
        laneId: row.laneId,
        service: row.service,
        status: row.status,
        providerLaneStatus: row.providerLaneStatus,
        providerExportStatus: row.providerExportStatus,
        sourceStatus: row.sourceStatus,
        anchoredOperationCount: row.anchoredOperationCount,
        sourceOperationCount: row.sourceOperationCount,
        blockedSourceOperationIds: row.blockedSourceOperationIds,
        pendingSourceOperationIds: row.pendingSourceOperationIds,
        restartSafe: row.restartSafe,
        exportAllowed: row.exportAllowed,
        nextAction: row.nextAction,
      }),
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SOURCE_DEPLOYMENT", {
      severity: "warning",
      message: `${pending.length} Mailchimp provider source deployment row(s) need acceptance before external handoff.`,
      hint: `Recovery: ${pending[0]?.nextAction ?? packet.restartEnvelope?.nextAction ?? "accept-mailchimp-provider-source-deployment"}; handoff: mailchimp-provider-source-deployment.`,
      preview: pending.map((row) => row.id).sort().join(", "),
    }));
  }

  if (!blocked.length && !pending.length && review.length && packet.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SOURCE_DEPLOYMENT", {
      severity: "warning",
      message: `${review.length} Mailchimp provider source deployment row(s) require review before external handoff.`,
      hint: `Recovery: ${review[0]?.nextAction ?? packet.restartEnvelope?.nextAction ?? "review-mailchimp-provider-source-deployment"}; handoff: mailchimp-provider-source-deployment.`,
      preview: review.map((row) => row.id).sort().join(", "),
    }));
  }

  if (packet.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PROVIDER_SOURCE_DEPLOYMENT", {
      severity: "error",
      message: "Mailchimp provider source deployment restart envelope is not restart-safe.",
      hint: `Recovery: ${packet.restartEnvelope.nextAction ?? "repair-mailchimp-provider-source-deployment"}; handoff: mailchimp-provider-source-deployment.`,
      preview: packet.restartEnvelope.route ?? "mailchimp/provider-source-deployment/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createMailchimpTenantPermissionBoundaryDiagnostics(boundaryContract = {}, options = {}) {
  const contract = boundaryContract?.version === "mailchimp-tenant-permission-boundary.v1"
    ? boundaryContract
    : createMailchimpTenantPermissionBoundaryContract(boundaryContract, options);
  const decision = options.tenantPermissionDecision?.version === "mailchimp-tenant-permission-decision.v1"
    ? options.tenantPermissionDecision
    : createMailchimpTenantPermissionDecision(contract, {
        acceptedMailchimpTenantAuditRowIds: options.acceptedMailchimpTenantAuditRowIds,
        acceptedMailchimpTenantJobNames: options.acceptedMailchimpTenantJobNames,
        requiredMailchimpTenantOperationIds: options.requiredMailchimpTenantOperationIds,
        requireMailchimpTenantPermissionAcceptance: options.requireMailchimpTenantPermissionAcceptance,
        allowReviewTenantPermissionHandoff: options.allowReviewTenantPermissionHandoff,
        allowTenantBoundaryDegradedMode: options.allowTenantBoundaryDegradedMode,
        retryAfterSecondsByReason: options.retryAfterSecondsByReason,
        retryAfterSecondsByRowId: options.retryAfterSecondsByRowId,
        mailchimpTenantBoundaryMaxRetryAttempts: options.mailchimpTenantBoundaryMaxRetryAttempts,
        mailchimpTenantBoundaryAttemptByRowId: options.mailchimpTenantBoundaryAttemptByRowId,
      });
  if (!contract || contract.status === "ready" || contract.status === "idle") {
    if (!decision || decision.status === "ready" || decision.status === "idle") {
      return Object.freeze([]);
    }
  }

  const auditLedger = decision.auditLedger?.version === "mailchimp-tenant-permission-audit-ledger.v1"
    ? decision.auditLedger
    : contract.auditLedger?.version === "mailchimp-tenant-permission-audit-ledger.v1"
      ? contract.auditLedger
      : createMailchimpTenantPermissionAuditLedger(decision, {
        revision: options.revision,
        externalRunId: options.externalRunId,
        allowTenantBoundaryDegradedMode: options.allowTenantBoundaryDegradedMode,
        retryAfterSecondsByReason: options.retryAfterSecondsByReason,
        retryAfterSecondsByRowId: options.retryAfterSecondsByRowId,
        mailchimpTenantBoundaryMaxRetryAttempts: options.mailchimpTenantBoundaryMaxRetryAttempts,
        mailchimpTenantBoundaryAttemptByRowId: options.mailchimpTenantBoundaryAttemptByRowId,
      });
  const ledgerByAuditRowId = new Map((auditLedger.rows ?? [])
    .map((row) => [row.auditRowId ?? row.id, row]));
  const ledgerByDecisionId = new Map((auditLedger.rows ?? [])
    .map((row) => [row.id, row]));
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
  const decisionRows = Array.isArray(decision.rows)
    ? decision.rows.filter((row) => row.status === "blocked" || row.status === "pending" || row.status === "review")
    : [];
  const decisionDiagnostics = decisionRows.map((row) => createCatalogDiagnostic("AIOS_MAILCHIMP_TENANT_PERMISSION", {
    severity: row.status === "blocked" || ledgerByAuditRowId.get(row.auditRowId)?.retryBudget?.status === "exhausted" ? "error" : "warning",
    range: options.rangeByJobName?.[row.jobName] ?? null,
    message: `Mailchimp tenant permission decision for "${row.jobName ?? "workflow"}" is ${row.status}.`,
    hint: createMailchimpTenantPermissionDiagnosticHint(
      ledgerByAuditRowId.get(row.auditRowId) ?? ledgerByDecisionId.get(row.id),
      row.nextAction,
      decision.handoff?.channel ?? "mailchimp-tenant-permission-decision",
    ),
    preview: [
      row.detail,
      `tenant=${row.tenantId ?? "unbound"}`,
      `workspace=${row.workspaceId ?? "unbound"}`,
      `accepted=${row.accepted ? "yes" : "no"}`,
      createMailchimpTenantPermissionPreviewSuffix(ledgerByAuditRowId.get(row.auditRowId) ?? ledgerByDecisionId.get(row.id)),
    ].join(" "),
    tenantPermissionDecision: Object.freeze({
      id: row.id,
      auditRowId: row.auditRowId,
      jobName: row.jobName,
      operationId: row.operationId,
      status: row.status,
      accepted: row.accepted,
      requiresAcceptance: row.requiresAcceptance,
      restartSafe: row.restartSafe,
      nextAction: row.nextAction,
      syncKey: decision.boundaryContract?.syncKey ?? contract.syncKey ?? null,
      auditLedger: createMailchimpTenantPermissionDiagnosticLedgerSummary(
        ledgerByAuditRowId.get(row.auditRowId) ?? ledgerByDecisionId.get(row.id),
        auditLedger,
      ),
    }),
  }));

  const boundaryDiagnostics = fallbackRows.map((row) => createCatalogDiagnostic("AIOS_MAILCHIMP_TENANT_PERMISSION", {
    severity: row.status === "blocked" || ledgerByAuditRowId.get(row.id)?.retryBudget?.status === "exhausted" ? "error" : "warning",
    range: options.rangeByJobName?.[row.jobName] ?? null,
    message: `Mailchimp tenant boundary for "${row.jobName}" is ${row.status}.`,
    hint: createMailchimpTenantPermissionDiagnosticHint(
      ledgerByAuditRowId.get(row.id),
      row.nextAction,
      row.handoff,
    ),
    preview: [
      row.detail,
      `tenant=${row.tenantId ?? "unbound"}`,
      `workspace=${row.workspaceId ?? "unbound"}`,
      `role=${row.role ?? "unbound"}`,
      createMailchimpTenantPermissionPreviewSuffix(ledgerByAuditRowId.get(row.id)),
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
      auditLedger: createMailchimpTenantPermissionDiagnosticLedgerSummary(ledgerByAuditRowId.get(row.id), auditLedger),
    }),
  }));
  const ledgerDiagnostics = createMailchimpTenantPermissionAuditLedgerDiagnostics(auditLedger, options);

  return Object.freeze([...boundaryDiagnostics, ...decisionDiagnostics, ...ledgerDiagnostics]
    .sort((left, right) => left.severity.localeCompare(right.severity) || left.message.localeCompare(right.message)));
}

export function createMailchimpTenantPermissionAuditLedgerDiagnostics(auditLedger = {}, options = {}) {
  const ledger = auditLedger?.version === "mailchimp-tenant-permission-audit-ledger.v1"
    ? auditLedger
    : createMailchimpTenantPermissionAuditLedger(auditLedger, options);
  const rows = Array.isArray(ledger.rows) ? ledger.rows : [];
  const actionableRows = rows.filter((row) => row.status === "blocked"
    || row.status === "pending"
    || row.status === "review"
    || row.retryBudget?.status === "exhausted");
  const diagnostics = actionableRows.map((row) => createCatalogDiagnostic("AIOS_MAILCHIMP_OPERATIONAL_HEALTH", {
    severity: row.status === "blocked" || row.retryBudget?.status === "exhausted" ? "error" : "warning",
    range: options.rangeByJobName?.[row.jobName] ?? null,
    message: `Mailchimp tenant permission ledger row "${row.auditRowId ?? row.id}" is ${row.status}.`,
    hint: createMailchimpTenantPermissionDiagnosticHint(row, row.nextAction, ledger.handoff?.channel),
    preview: [
      row.detail,
      `retryClass=${row.retryClass}`,
      `retryable=${row.retryable ? "yes" : "no"}`,
      `degradedMode=${row.degradedMode}`,
      `remainingRetries=${row.retryBudget?.remaining ?? 0}`,
    ].join(" "),
    tenantPermissionAuditLedger: Object.freeze({
      id: row.id,
      auditRowId: row.auditRowId,
      jobName: row.jobName,
      operationId: row.operationId,
      status: row.status,
      retryClass: row.retryClass,
      retryable: row.retryable,
      retryAfterSeconds: row.retryPolicy?.retryAfterSeconds ?? null,
      retryBudgetStatus: row.retryBudget?.status ?? "unknown",
      degradedModeAllowed: row.degradedModeAllowed,
      route: row.handoff?.route ?? ledger.handoff?.route ?? null,
      nextAction: row.nextAction,
      ledgerSyncKey: ledger.syncKey ?? null,
    }),
  }));

  if (ledger.status === "ready" || ledger.status === "idle") return Object.freeze(diagnostics);

  return Object.freeze([
    ...diagnostics,
    createCatalogDiagnostic("AIOS_MAILCHIMP_OPERATIONAL_HEALTH", {
      severity: ledger.status === "blocked" ? "error" : "warning",
      message: `Mailchimp tenant permission audit ledger is ${ledger.status}.`,
      hint: `Recovery: ${ledger.health?.nextAction ?? ledger.handoff?.nextAction ?? "repair-mailchimp-tenant-permission-ledger"}; handoff: ${ledger.handoff?.channel ?? "mailchimp-tenant-permission-audit-ledger"}.`,
      preview: [
        `health=${ledger.health?.state ?? "unknown"}`,
        `retryable=${ledger.health?.retryable ? "yes" : "no"}`,
        `degradedAllowed=${ledger.health?.degradedModeAllowed ? "yes" : "no"}`,
        `nextRetryAfterSeconds=${ledger.health?.nextRetryAfterSeconds ?? "none"}`,
      ].join(" "),
      tenantPermissionAuditLedger: Object.freeze({
        status: ledger.status,
        healthState: ledger.health?.state ?? "unknown",
        retryableCount: ledger.totals?.retryableCount ?? 0,
        retryExhaustedCount: ledger.totals?.retryExhaustedCount ?? 0,
        degradedAllowedCount: ledger.totals?.degradedAllowedCount ?? 0,
        route: ledger.handoff?.route ?? null,
        nextAction: ledger.health?.nextAction ?? ledger.handoff?.nextAction ?? null,
        syncKey: ledger.syncKey ?? null,
      }),
    }),
  ]);
}

function createMailchimpTenantPermissionDiagnosticHint(ledgerRow = null, fallbackNextAction = null, handoff = null) {
  if (!ledgerRow) {
    return `Recovery: ${fallbackNextAction ?? "bind-mailchimp-tenant-permissions"}; handoff: ${handoff ?? "mailchimp-tenant-permission-audit"}.`;
  }

  const retryHint = ledgerRow.retryable
    ? ` retryAfterSeconds=${ledgerRow.retryPolicy?.retryAfterSeconds ?? 0}; remainingRetries=${ledgerRow.retryBudget?.remaining ?? 0}.`
    : ledgerRow.retryBudget?.status === "exhausted"
      ? " retryBudget=exhausted."
      : "";
  const degradedHint = ledgerRow.degradedModeAllowed
    ? " degradedMode=allowed."
    : ledgerRow.degradedMode === "requires-acceptance"
      ? " degradedMode=requires-acceptance."
      : "";

  return [
    `Recovery: ${ledgerRow.nextAction ?? fallbackNextAction ?? "bind-mailchimp-tenant-permissions"};`,
    `handoff: ${ledgerRow.handoff?.channel ?? handoff ?? "mailchimp-tenant-permission-audit-ledger"}.`,
    `retryClass=${ledgerRow.retryClass ?? "unknown"}.`,
    retryHint,
    degradedHint,
  ].join(" ").replace(/\s+/g, " ").trim();
}

function createMailchimpTenantPermissionPreviewSuffix(ledgerRow = null) {
  if (!ledgerRow) return "ledger=unbound";
  return [
    `retryClass=${ledgerRow.retryClass ?? "unknown"}`,
    `retryable=${ledgerRow.retryable ? "yes" : "no"}`,
    `degradedMode=${ledgerRow.degradedMode ?? "unknown"}`,
    `retryBudget=${ledgerRow.retryBudget?.status ?? "unknown"}`,
  ].join(" ");
}

function createMailchimpTenantPermissionDiagnosticLedgerSummary(ledgerRow = null, ledger = {}) {
  return Object.freeze({
    ledgerStatus: ledger.status ?? "unbound",
    ledgerHealth: ledger.health?.state ?? "unknown",
    ledgerRoute: ledger.handoff?.route ?? null,
    retryableCount: ledger.totals?.retryableCount ?? 0,
    retryExhaustedCount: ledger.totals?.retryExhaustedCount ?? 0,
    row: ledgerRow
      ? Object.freeze({
        id: ledgerRow.id,
        auditRowId: ledgerRow.auditRowId,
        retryClass: ledgerRow.retryClass,
        retryable: ledgerRow.retryable,
        retryAfterSeconds: ledgerRow.retryPolicy?.retryAfterSeconds ?? null,
        retryBudgetStatus: ledgerRow.retryBudget?.status ?? "unknown",
        degradedMode: ledgerRow.degradedMode,
        degradedModeAllowed: ledgerRow.degradedModeAllowed,
        handoffRoute: ledgerRow.handoff?.route ?? null,
      })
      : null,
  });
}

export function createMailchimpTenantSourceAnchorDiagnostics(sourceBoundaryAudit = {}, options = {}) {
  const correlation = sourceBoundaryAudit.mailchimpTenantCorrelations?.version === "mailchimp-tenant-source-anchor-correlations.v1"
    ? sourceBoundaryAudit.mailchimpTenantCorrelations
    : options.mailchimpTenantSourceAnchorCorrelations?.version === "mailchimp-tenant-source-anchor-correlations.v1"
      ? options.mailchimpTenantSourceAnchorCorrelations
      : options.tenantPermissionDecision || options.mailchimpTenantPermissionDecision
        ? createMailchimpTenantSourceAnchorCorrelations(
            options.tenantPermissionDecision ?? options.mailchimpTenantPermissionDecision,
            sourceBoundaryAudit.persistence?.anchors ?? options.sourceAnchors ?? [],
            options,
          )
        : null;
  const auditRows = Array.isArray(sourceBoundaryAudit.auditEvents) ? sourceBoundaryAudit.auditEvents : [];
  const correlatedRows = correlation?.rows ?? [];
  const rows = correlatedRows.length
    ? correlatedRows.filter((row) => row.status === "blocked" || row.status === "pending" || row.status === "review")
    : auditRows
      .filter((row) => row.mailchimpTenantStatus && row.mailchimpTenantStatus !== "unbound" && row.mailchimpTenantStatus !== "ready")
      .map((row) => Object.freeze({
        id: row.mailchimpTenantDecisionId ?? row.id,
        anchorId: row.anchorId,
        anchorType: "source",
        previewAddress: row.previewAddress,
        jobName: null,
        operationId: null,
        auditRowId: row.mailchimpAuditRowId,
        status: row.mailchimpTenantStatus,
        accepted: row.accepted,
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
        role: row.role,
        reasonCodes: Object.freeze([row.reason].filter(Boolean)),
        detail: row.reason,
        restartSafe: row.restartSafe,
        nextAction: row.nextAction,
      }));

  return Object.freeze(rows.map((row) => createCatalogDiagnostic("AIOS_MAILCHIMP_TENANT_PERMISSION", {
    severity: row.status === "blocked" || row.restartSafe === false ? "error" : "warning",
    range: options.rangeBySourceAnchorId?.[row.anchorId]
      ?? options.rangeByMailchimpTenantAuditRowId?.[row.auditRowId]
      ?? null,
    message: row.anchorId
      ? `Mailchimp tenant permission source anchor "${row.anchorId}" is ${row.status}.`
      : `Mailchimp tenant permission decision "${row.auditRowId ?? row.id}" has no source anchor.`,
    hint: `Recovery: ${row.nextAction ?? correlation?.recovery?.nextAction ?? "bind-mailchimp-tenant-source-anchor"}; handoff: mailchimp-tenant-source-anchor-boundary.`,
    preview: [
      row.previewAddress ?? row.detail ?? row.id,
      `tenant=${row.tenantId ?? "unbound"}`,
      `workspace=${row.workspaceId ?? "unbound"}`,
      `accepted=${row.accepted ? "yes" : "no"}`,
    ].join(" "),
    tenantSourceAnchor: Object.freeze({
      id: row.id,
      anchorId: row.anchorId,
      anchorType: row.anchorType,
      auditRowId: row.auditRowId,
      jobName: row.jobName,
      operationId: row.operationId,
      status: row.status,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      role: row.role,
      restartSafe: row.restartSafe,
      reasonCodes: row.reasonCodes,
      syncKey: correlation?.syncKey ?? sourceBoundaryAudit.syncKey ?? null,
      nextAction: row.nextAction,
    }),
  })).sort((left, right) => left.severity.localeCompare(right.severity) || left.message.localeCompare(right.message)));
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

export function createMailchimpCampaignReleaseDiagnostics(releaseContract = {}, options = {}) {
  if (!releaseContract
    || releaseContract.status === "ready"
    || releaseContract.status === "idle") {
    return Object.freeze([]);
  }

  const lanes = Array.isArray(releaseContract.lanes) ? releaseContract.lanes : [];
  const actionableLanes = lanes.filter((lane) => (
    lane.status === "blocked"
    || lane.status === "pending"
    || lane.status === "needsAcceptance"
    || lane.status === "review"
    || lane.status === "degraded"
    || lane.exportAllowed === false
    || lane.restartSafe === false
    || lane.acceptanceState === "pending"
    || lane.acceptanceState === "notReady"
  ));

  return Object.freeze(actionableLanes.map((lane) => {
    const blocked = lane.status === "blocked" || lane.exportAllowed === false || lane.restartSafe === false;
    const acceptance = lane.acceptanceState === "pending"
      ? " release acceptance is pending."
      : lane.acceptanceState === "notReady"
        ? " release acceptance is waiting for lane readiness."
        : "";
    return createCatalogDiagnostic("AIOS_MAILCHIMP_RELEASE_CONTRACT", {
      severity: blocked ? "error" : "warning",
      range: options.rangeByLaneId?.[lane.id] ?? null,
      message: `Mailchimp campaign release lane "${lane.id}" is ${lane.status}.`,
      hint: `Recovery: ${lane.nextAction}; handoff: mailchimp-campaign-release.`,
      preview: `${lane.label ?? lane.id}: route=${lane.route ?? "mailchimp/campaign-release"} count=${lane.count ?? 0}.${acceptance}`,
      releaseLane: Object.freeze({
        id: lane.id,
        label: lane.label,
        status: lane.status,
        route: lane.route,
        exportAllowed: lane.exportAllowed !== false,
        restartSafe: lane.restartSafe !== false,
        accepted: Boolean(lane.accepted),
        acceptanceState: lane.acceptanceState ?? "unbound",
        count: lane.count ?? 0,
        nextAction: lane.nextAction,
        releaseId: releaseContract.releaseId ?? null,
        syncKey: releaseContract.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
      }),
    });
  }));
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

export function createDiagnosticProviderActionDeck(state = {}, options = {}) {
  const clientState = state.clientState?.clientStateVersion === "diagnostic-client-runtime.v1"
    ? state.clientState
    : createDiagnosticClientRuntimeState(state.diagnostics ?? [], options);
  const commandSummary = state.commandSummary?.version === "diagnostic-lifecycle-command-summary.v1"
    ? state.commandSummary
    : createDiagnosticLifecycleCommandSummary(state.diagnostics ?? [], {
        ...options,
        lifecycle: clientState.lifecycle,
      });
  const providerHandoff = state.providerHandoff ?? state.mailchimpHandoff ?? null;
  const releaseChecklist = state.releaseChecklist ?? state.diagnosticReleaseChecklist ?? null;
  const adoptionState = state.adoptionState ?? state.diagnosticClientRuntimeAdoption ?? null;
  const cards = [
    ...createDiagnosticDeckRowsFromClient(clientState),
    ...createDiagnosticDeckRowsFromCommands(commandSummary),
    ...createDiagnosticDeckRowsFromProvider(providerHandoff),
    ...createDiagnosticDeckRowsFromRelease(releaseChecklist),
    ...createDiagnosticDeckRowsFromAdoption(adoptionState),
  ].sort(compareDiagnosticProviderActionRows);
  const blocked = cards.filter((card) => card.status === "blocked" || card.restartSafe === false);
  const pending = cards.filter((card) => card.status === "pending" || card.status === "needsAcceptance");
  const review = cards.filter((card) => card.status === "review" || card.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : cards.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "diagnostic-provider-action-deck.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    providerId: providerHandoff?.providerId ?? options.providerId ?? "mailchimp",
    fileName: options.fileName ?? releaseChecklist?.fileName ?? adoptionState?.fileName ?? "inline.aios",
    revision: options.revision ?? releaseChecklist?.revision ?? "working",
    cards: Object.freeze(cards),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countBy(cards, "status")),
      byKind: freezeSortedRecord(countBy(cards, "kind")),
      byRoute: freezeSortedRecord(countBy(cards, "route")),
      bySource: freezeSortedRecord(countBy(cards, "source")),
    }),
    totals: Object.freeze({
      cardCount: cards.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      diagnosticActionCount: cards.filter((card) => card.source === "diagnostic").length,
      providerActionCount: cards.filter((card) => card.source === "provider").length,
      releaseActionCount: cards.filter((card) => card.source === "release").length,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "diagnostics/provider-actions/recovery"
        : status === "pending"
          ? "diagnostics/provider-actions/acceptance"
          : status === "review"
            ? "diagnostics/provider-actions/review"
            : "diagnostics/provider-actions/summary",
      restartSafe: blocked.length === 0,
      blockedCardIds: Object.freeze(blocked.map((card) => card.id).sort()),
      pendingCardIds: Object.freeze(pending.map((card) => card.id).sort()),
      reviewCardIds: Object.freeze(review.map((card) => card.id).sort()),
      idempotencyKeys: Object.freeze(cards.map((card) => card.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? adoptionState?.restartEnvelope?.nextAction
        ?? commandSummary.recovery?.nextAction
        ?? clientState.handoff?.nextAction
        ?? "publish-diagnostic-provider-action-deck",
    }),
    userVisible: Object.freeze({
      title: "Diagnostic provider actions",
      detail: status === "ready" || status === "idle"
        ? "Diagnostic and provider handoff actions are ready for client adoption."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review diagnostic provider actions remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-diagnostic-provider-action-deck",
    }),
  });
}

export function createDiagnosticHandoffAcceptanceGate(state = {}, options = {}) {
  const reviewBoard = state.reviewBoard?.version === "diagnostic-review-board-lanes.v1"
    ? state.reviewBoard
    : null;
  const providerActionDeck = state.providerActionDeck?.version === "diagnostic-provider-action-deck.v1"
    ? state.providerActionDeck
    : null;
  const releaseChecklist = state.releaseChecklist?.version === "diagnostic-release-checklist.v1"
    ? state.releaseChecklist
    : null;
  const persistedResume = state.persistedResume?.version === "diagnostic-persisted-resume.v1"
    ? state.persistedResume
    : null;
  const commandSummary = state.commandSummary?.version === "diagnostic-lifecycle-command-summary.v1"
    ? state.commandSummary
    : null;
  const adoptionState = state.adoptionState?.version === "diagnostic-client-runtime-adoption.v1"
    ? state.adoptionState
    : null;
  const acceptedGateIds = normalizeCodeSet(options.acceptedDiagnosticHandoffGateIds);
  const completedGateIds = normalizeCodeSet(options.completedDiagnosticHandoffGateIds);
  const requireAcceptance = options.requireDiagnosticHandoffAcceptance !== false;
  const rows = [
    ...createDiagnosticGateRowsFromReviewBoard(reviewBoard),
    ...createDiagnosticGateRowsFromProviderDeck(providerActionDeck),
    ...createDiagnosticGateRowsFromReleaseChecklist(releaseChecklist),
    ...createDiagnosticGateRowsFromPersistedResume(persistedResume),
    ...createDiagnosticGateRowsFromCommandSummary(commandSummary),
    ...createDiagnosticGateRowsFromAdoption(adoptionState),
  ].map((row) => normalizeDiagnosticHandoffGateRow(row, {
    acceptedGateIds,
    completedGateIds,
    requireAcceptance,
    fileName: options.fileName,
    revision: options.revision,
  })).sort(compareDiagnosticHandoffGateRows);
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const incomplete = rows.filter((row) => !row.completed && row.completionRequired);
  const status = blocked.length
    ? "blocked"
    : pending.length || incomplete.length
      ? "pending"
      : review.length
        ? "review"
        : rows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "diagnostic-handoff-acceptance-gate.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && options.allowReviewDiagnosticHandoff === true),
    fileName: options.fileName ?? releaseChecklist?.fileName ?? providerActionDeck?.fileName ?? "inline.aios",
    revision: options.revision ?? providerActionDeck?.revision ?? "working",
    providerId: options.providerId ?? providerActionDeck?.providerId ?? "mailchimp",
    gates: Object.freeze(rows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countBy(rows, "status")),
      bySource: freezeSortedRecord(countBy(rows, "source")),
      byRoute: freezeSortedRecord(countBy(rows, "route")),
      byHandoff: freezeSortedRecord(countBy(rows, "handoff")),
      byAcceptance: freezeSortedRecord(countBy(rows, "acceptanceState")),
    }),
    totals: Object.freeze({
      gateCount: rows.length,
      blockedGateCount: blocked.length,
      pendingGateCount: pending.length,
      reviewGateCount: review.length,
      completedGateCount: rows.filter((row) => row.completed).length,
      acceptedGateCount: rows.filter((row) => row.accepted).length,
      incompleteGateCount: incomplete.length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0) && incomplete.length === 0,
      requiredGateIds: Object.freeze(rows.map((row) => row.id).sort()),
      acceptedGateIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.id).sort()),
      pendingGateIds: Object.freeze(requireAcceptance ? pending.map((row) => row.id).sort() : []),
      completedGateIds: Object.freeze(rows.filter((row) => row.completed).map((row) => row.id).sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "diagnostics/handoff-gate/recovery"
        : status === "pending"
          ? "diagnostics/handoff-gate/acceptance"
          : status === "review"
            ? "diagnostics/handoff-gate/review"
            : "diagnostics/handoff-gate/summary",
      restartSafe: blocked.length === 0,
      blockedGateIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingGateIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewGateIds: Object.freeze(review.map((row) => row.id).sort()),
      incompleteGateIds: Object.freeze(incomplete.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? incomplete[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-diagnostic-handoff-gate",
    }),
    userVisible: Object.freeze({
      title: "Diagnostic handoff gate",
      detail: status === "ready" || status === "idle"
        ? "Diagnostic review, provider actions, release checklist, and resume state are accepted for handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review diagnostic gates remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? incomplete[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-diagnostic-handoff-gate",
    }),
  });
}

function createDiagnosticDeckRowsFromClient(clientState = {}) {
  const actions = Array.isArray(clientState.runtimeActions) ? clientState.runtimeActions : [];
  return actions.map((action) => Object.freeze({
    id: `diagnostic-action:${action.id}`,
    source: "diagnostic",
    kind: action.kind ?? "runtimeAction",
    status: normalizeDiagnosticActionDeckStatus(action.status),
    label: action.target ?? action.kind ?? action.id,
    detail: `${action.kind ?? "Diagnostic action"} routes through ${action.handoff ?? "diagnostic-summary"}.`,
    route: action.route ?? clientState.handoff?.route ?? "diagnostics/runtime",
    handoff: action.handoff ?? "diagnostic-summary",
    targetId: action.target ?? null,
    restartSafe: action.restartSafe !== false,
    idempotencyKey: action.idempotencyKey ?? action.id,
    nextAction: action.nextAction ?? clientState.handoff?.nextAction ?? "review-diagnostic-action",
  }));
}

function createDiagnosticDeckRowsFromCommands(commandSummary = {}) {
  const commands = Array.isArray(commandSummary.commands) ? commandSummary.commands : [];
  return commands
    .filter((command) => command.enabled !== false || command.status !== "ready")
    .map((command) => Object.freeze({
      id: `diagnostic-command:${command.id}`,
      source: "diagnostic",
      kind: command.commandId ?? "lifecycleCommand",
      status: command.enabled === false ? "review" : normalizeDiagnosticActionDeckStatus(command.status),
      label: `${command.code} ${command.commandId}`,
      detail: command.scheduled
        ? `Diagnostic command is scheduled for ${command.code}.`
        : `Diagnostic command ${command.commandId} is available for ${command.code}.`,
      route: "diagnostics/lifecycle-commands",
      handoff: command.handoff ?? explainDiagnosticCode(command.code).handoff,
      targetId: command.code,
      restartSafe: command.status !== "blocked",
      idempotencyKey: command.scheduleId ? `${command.id}:${command.scheduleId}` : command.id,
      nextAction: command.enabled === false
        ? "enable-diagnostic-command"
        : command.nextAction ?? commandSummary.recovery?.nextAction ?? "review-diagnostic-command",
    }));
}

function createDiagnosticDeckRowsFromProvider(providerHandoff = {}) {
  const operations = Array.isArray(providerHandoff?.operations) ? providerHandoff.operations : [];
  const jobs = Array.isArray(providerHandoff?.jobs) ? providerHandoff.jobs : [];
  const operationRows = operations
    .filter((operation) => operation.status !== "ready" || operation.acceptanceState !== "accepted")
    .map((operation) => Object.freeze({
      id: `provider-operation:${operation.id ?? operation.operationId ?? operation.jobName}`,
      source: "provider",
      kind: `${operation.service ?? "mailchimp"}:${operation.operation ?? "handoff"}`,
      status: normalizeDiagnosticActionDeckStatus(operation.status === "ready" && operation.acceptanceState !== "accepted"
        ? "pending"
        : operation.status),
      label: operation.jobName ?? operation.id ?? "Mailchimp operation",
      detail: `${operation.service ?? "mailchimp"} ${operation.operation ?? "operation"} provider handoff.`,
      route: "mailchimp/provider-handoff",
      handoff: operation.handoff ?? "mailchimp-provider-contract",
      targetId: operation.id ?? operation.operationId ?? null,
      restartSafe: operation.restartSafe !== false,
      idempotencyKey: operation.idempotencyKey ?? operation.id ?? null,
      nextAction: operation.nextAction ?? providerHandoff.nextAction ?? "review-mailchimp-provider-operation",
    }));
  const jobRows = jobs
    .filter((job) => job.status === "blocked" || job.status === "review" || job.tenantBoundaryStatus === "blocked" || job.tenantBoundaryStatus === "review")
    .map((job) => Object.freeze({
      id: `provider-job:${job.jobName}`,
      source: "provider",
      kind: "mailchimpJob",
      status: job.status === "blocked" || job.tenantBoundaryStatus === "blocked" ? "blocked" : "review",
      label: job.jobName,
      detail: `Mailchimp job uses ${job.operationCount ?? 0} provider operations.`,
      route: "mailchimp/provider-jobs",
      handoff: "mailchimp-provider-contract",
      targetId: job.jobName,
      restartSafe: job.status !== "blocked" && job.tenantBoundaryStatus !== "blocked",
      idempotencyKey: `${job.jobName}:${job.scheduleMode ?? "manual"}:${job.tenantBoundaryStatus ?? "unbound"}`,
      nextAction: job.nextAction ?? providerHandoff.nextAction ?? "review-mailchimp-provider-job",
    }));

  return [...operationRows, ...jobRows];
}

function createDiagnosticDeckRowsFromRelease(releaseChecklist = {}) {
  const items = Array.isArray(releaseChecklist?.checklistItems) ? releaseChecklist.checklistItems : [];
  return items
    .filter((item) => item.status !== "ready")
    .map((item) => Object.freeze({
      id: `release-checklist:${item.id}`,
      source: "release",
      kind: item.kind ?? "releaseChecklist",
      status: normalizeDiagnosticActionDeckStatus(item.status),
      label: item.label ?? item.id,
      detail: item.detail ?? "Release checklist item needs action.",
      route: releaseChecklist.route?.clientRoute ?? "diagnostics/release-summary",
      handoff: item.handoff ?? "diagnostic-release-checklist",
      targetId: item.id,
      restartSafe: item.restartSafe !== false,
      idempotencyKey: item.idempotencyKey ?? item.id,
      nextAction: item.nextAction ?? releaseChecklist.restartEnvelope?.nextAction ?? "review-diagnostic-release-item",
    }));
}

function createDiagnosticDeckRowsFromAdoption(adoptionState = {}) {
  const rows = Array.isArray(adoptionState?.rows) ? adoptionState.rows : [];
  return rows
    .filter((row) => row.status !== "ready")
    .map((row) => Object.freeze({
      id: `runtime-adoption:${row.id}`,
      source: "runtimeAdoption",
      kind: row.kind ?? "clientRuntimeAdoption",
      status: normalizeDiagnosticActionDeckStatus(row.status),
      label: row.label ?? row.id,
      detail: row.detail ?? "Diagnostic client runtime adoption item needs action.",
      route: row.route ?? adoptionState.restartEnvelope?.route ?? "diagnostics/client-runtime-adoption",
      handoff: row.handoff ?? "diagnostic-client-runtime-adoption",
      targetId: row.targetId ?? row.id,
      restartSafe: row.restartSafe !== false,
      idempotencyKey: row.idempotencyKey ?? row.id,
      nextAction: row.nextAction ?? adoptionState.restartEnvelope?.nextAction ?? "review-diagnostic-runtime-adoption",
    }));
}

function normalizeDiagnosticActionDeckStatus(status) {
  if (status === "blocked" || status === "failed") return "blocked";
  if (status === "pending" || status === "needsAcceptance" || status === "scheduled") return "pending";
  if (status === "review" || status === "degraded" || status === "disabled") return "review";
  if (status === "idle") return "idle";
  return "ready";
}

function compareDiagnosticProviderActionRows(left, right) {
  return left.status.localeCompare(right.status)
    || left.source.localeCompare(right.source)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function createDiagnosticGateRowsFromReviewBoard(reviewBoard = {}) {
  return (reviewBoard?.rows ?? [])
    .filter((row) => row.status !== "ready" || row.restartSafe === false)
    .map((row) => diagnosticHandoffGateRow({
      id: `review:${row.id}`,
      source: "reviewBoard",
      kind: row.kind,
      status: row.status,
      label: row.label,
      detail: row.detail,
      route: row.route,
      handoff: row.handoff,
      restartSafe: row.restartSafe,
      completionRequired: row.status === "blocked",
      idempotencyKey: row.idempotencyKey,
      nextAction: row.nextAction,
    }));
}

function createDiagnosticGateRowsFromProviderDeck(providerActionDeck = {}) {
  return (providerActionDeck?.cards ?? [])
    .filter((card) => card.status !== "ready" || card.restartSafe === false)
    .map((card) => diagnosticHandoffGateRow({
      id: `provider-action:${card.id}`,
      source: card.source ?? "providerActionDeck",
      kind: card.kind,
      status: card.status,
      label: card.label,
      detail: card.detail,
      route: card.route,
      handoff: card.handoff,
      restartSafe: card.restartSafe,
      completionRequired: card.status === "blocked",
      idempotencyKey: card.idempotencyKey,
      nextAction: card.nextAction,
    }));
}

function createDiagnosticGateRowsFromReleaseChecklist(releaseChecklist = {}) {
  return (releaseChecklist?.checklistItems ?? [])
    .filter((item) => item.status !== "ready" || item.restartSafe === false)
    .map((item) => diagnosticHandoffGateRow({
      id: `release:${item.id}`,
      source: "releaseChecklist",
      kind: item.kind,
      status: item.status,
      label: item.label,
      detail: item.detail,
      route: releaseChecklist.route?.clientRoute ?? "diagnostics/release-summary",
      handoff: item.handoff,
      restartSafe: item.restartSafe,
      completionRequired: item.status === "blocked",
      idempotencyKey: item.idempotencyKey,
      nextAction: item.nextAction ?? releaseChecklist.route?.nextAction,
    }));
}

function createDiagnosticGateRowsFromPersistedResume(persistedResume = {}) {
  return (persistedResume?.persistedActions ?? [])
    .filter((action) => action.status !== "ready" || action.restartSafe === false)
    .map((action) => diagnosticHandoffGateRow({
      id: `resume:${action.id}`,
      source: "persistedResume",
      kind: action.kind,
      status: action.status,
      label: action.target ?? action.id,
      detail: `Persisted diagnostic action routes through ${action.route ?? "diagnostics/resume"}.`,
      route: action.route,
      handoff: action.handoff ?? "diagnostic-persisted-resume",
      restartSafe: action.restartSafe,
      completionRequired: action.status === "blocked",
      idempotencyKey: action.idempotencyKey,
      nextAction: action.nextAction ?? persistedResume.restartEnvelope?.nextAction,
    }));
}

function createDiagnosticGateRowsFromCommandSummary(commandSummary = {}) {
  return (commandSummary?.commands ?? [])
    .filter((command) => command.status !== "ready" || command.enabled === false)
    .map((command) => diagnosticHandoffGateRow({
      id: `command:${command.id}`,
      source: "lifecycleCommand",
      kind: command.commandId,
      status: command.enabled === false ? "review" : command.status,
      label: `${command.code} ${command.commandId}`,
      detail: command.scheduled
        ? `Diagnostic lifecycle command is scheduled for ${command.code}.`
        : `Diagnostic lifecycle command is available for ${command.code}.`,
      route: "diagnostics/lifecycle-commands",
      handoff: command.handoff,
      restartSafe: command.status !== "blocked",
      completionRequired: command.status === "blocked",
      idempotencyKey: command.scheduleId ? `${command.id}:${command.scheduleId}` : command.id,
      nextAction: command.nextAction ?? commandSummary.recovery?.nextAction,
    }));
}

function createDiagnosticGateRowsFromAdoption(adoptionState = {}) {
  return (adoptionState?.rows ?? [])
    .filter((row) => row.status !== "ready" || row.restartSafe === false)
    .map((row) => diagnosticHandoffGateRow({
      id: `adoption:${row.id}`,
      source: "clientRuntimeAdoption",
      kind: row.kind,
      status: row.status,
      label: row.label,
      detail: row.detail,
      route: row.route,
      handoff: row.handoff,
      restartSafe: row.restartSafe,
      completionRequired: row.status === "blocked",
      idempotencyKey: row.idempotencyKey,
      nextAction: row.nextAction ?? adoptionState.restartEnvelope?.nextAction,
    }));
}

function diagnosticHandoffGateRow(row = {}) {
  return Object.freeze({
    id: row.id,
    source: row.source ?? "diagnostic",
    kind: row.kind ?? "handoff",
    status: normalizeDiagnosticActionDeckStatus(row.status),
    label: row.label ?? row.id,
    detail: row.detail ?? "Diagnostic handoff gate requires attention.",
    route: row.route ?? "diagnostics/handoff-gate",
    handoff: row.handoff ?? "diagnostic-handoff-gate",
    restartSafe: row.restartSafe !== false,
    completionRequired: Boolean(row.completionRequired),
    idempotencyKey: row.idempotencyKey ?? row.id ?? null,
    nextAction: row.nextAction ?? "review-diagnostic-handoff-gate",
  });
}

function normalizeDiagnosticHandoffGateRow(row, context) {
  const accepted = !context.requireAcceptance || context.acceptedGateIds.has(row.id);
  const completed = !row.completionRequired || context.completedGateIds.has(row.id);
  const needsAcceptance = context.requireAcceptance && !accepted && row.status !== "blocked";
  const status = row.status === "blocked" || row.restartSafe === false
    ? "blocked"
    : !completed
      ? "pending"
      : needsAcceptance
        ? "pending"
        : row.status;

  return Object.freeze({
    ...row,
    status,
    accepted,
    completed,
    acceptanceState: accepted ? "accepted" : "pending",
    idempotencyKey: [
      context.fileName ?? "inline.aios",
      context.revision ?? "working",
      row.idempotencyKey ?? row.id,
      status,
    ].join(":"),
    nextAction: status === "blocked"
      ? row.nextAction
      : !completed
        ? `complete-diagnostic-handoff-gate:${row.id}`
        : needsAcceptance
          ? `accept-diagnostic-handoff-gate:${row.id}`
          : row.nextAction,
  });
}

function compareDiagnosticHandoffGateRows(left, right) {
  return diagnosticCheckpointStatusOrder(left.status) - diagnosticCheckpointStatusOrder(right.status)
    || left.source.localeCompare(right.source)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

export function createDiagnosticReviewBoardLanes(diagnostics = [], settings = {}) {
  const activeDiagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  const clientState = settings.clientState?.clientStateVersion === "diagnostic-client-runtime.v1"
    ? settings.clientState
    : createDiagnosticClientRuntimeState(activeDiagnostics, settings);
  const commandSummary = settings.commandSummary?.version === "diagnostic-lifecycle-command-summary.v1"
    ? settings.commandSummary
    : createDiagnosticLifecycleCommandSummary(activeDiagnostics, {
        ...settings,
        lifecycle: clientState.lifecycle,
      });
  const releaseChecklist = settings.releaseChecklist?.version === "diagnostic-release-checklist.v1"
    ? settings.releaseChecklist
    : null;
  const extraLanes = Array.isArray(settings.extraLanes) ? settings.extraLanes : [];
  const rows = [
    ...activeDiagnostics.map((diagnostic, index) => createDiagnosticReviewBoardRow({
      id: `diagnostic:${diagnostic.code}:${index}`,
      source: "diagnostic",
      kind: diagnostic.catalog?.stage ?? "diagnostic",
      status: diagnostic.severity === "error" || diagnostic.catalog?.status === "blocked" ? "blocked" : diagnostic.catalog?.status ?? "review",
      severity: diagnostic.severity,
      label: diagnostic.code,
      detail: diagnostic.message,
      handoff: diagnostic.catalog?.handoff ?? "diagnostic-summary",
      route: selectDiagnosticReviewRoute(diagnostic.catalog?.handoff, clientState.handoff.route),
      targetId: diagnostic.code,
      restartSafe: diagnostic.severity !== "error" && diagnostic.catalog?.status !== "blocked",
      idempotencyKey: `${diagnostic.code}:${diagnostic.catalog?.handoff ?? "diagnostic-summary"}:${index}`,
      nextAction: diagnostic.catalog?.recovery ?? "inspect-diagnostic",
    })),
    ...(clientState.runtimeActions ?? []).map((action) => createDiagnosticReviewBoardRow({
      id: `runtime:${action.id}`,
      source: "runtimeAction",
      kind: action.kind,
      status: action.status,
      severity: action.status === "blocked" ? "error" : action.status === "pending" ? "warning" : "info",
      label: action.target,
      detail: `${action.kind} will hand off through ${action.handoff}.`,
      handoff: action.handoff,
      route: action.route ?? clientState.handoff.route,
      targetId: action.target,
      restartSafe: action.restartSafe,
      idempotencyKey: action.idempotencyKey,
      nextAction: action.nextAction,
    })),
    ...(commandSummary.commands ?? []).map((command) => createDiagnosticReviewBoardRow({
      id: `command:${command.id}`,
      source: "lifecycleCommand",
      kind: command.commandId,
      status: command.enabled ? command.status : "disabled",
      severity: command.status === "blocked" ? "error" : command.status === "review" ? "warning" : "info",
      label: `${command.code} ${command.commandId}`,
      detail: command.scheduled
        ? `Diagnostic command ${command.commandId} is scheduled for ${command.code}.`
        : `Diagnostic command ${command.commandId} is available for ${command.code}.`,
      handoff: command.handoff,
      route: "diagnostics/lifecycle-commands",
      targetId: command.code,
      restartSafe: command.status !== "blocked",
      idempotencyKey: command.scheduleId ? `${command.id}:${command.scheduleId}` : command.id,
      nextAction: command.nextAction,
    })),
    ...((releaseChecklist?.checklistItems ?? []).map((item) => createDiagnosticReviewBoardRow({
      id: `release:${item.id}`,
      source: "releaseChecklist",
      kind: item.kind,
      status: item.status,
      severity: item.severity,
      label: item.label,
      detail: item.detail,
      handoff: item.handoff,
      route: releaseChecklist.route?.clientRoute ?? "diagnostics/release-summary",
      targetId: item.id,
      restartSafe: item.restartSafe,
      idempotencyKey: item.idempotencyKey,
      nextAction: item.nextAction,
    }))),
    ...extraLanes.map((lane, index) => createDiagnosticReviewBoardRow({
      id: `external:${lane.id ?? index}`,
      source: lane.source ?? "externalLane",
      kind: lane.kind ?? "handoff",
      status: lane.status ?? "ready",
      severity: lane.severity ?? (lane.status === "blocked" ? "error" : lane.status === "pending" || lane.status === "review" ? "warning" : "info"),
      label: lane.label ?? lane.id ?? `External lane ${index + 1}`,
      detail: lane.detail ?? lane.handoff ?? "External diagnostic handoff.",
      handoff: lane.handoff ?? "diagnostic-review-board",
      route: lane.route ?? "diagnostics/review-board",
      targetId: lane.targetId ?? lane.id ?? null,
      restartSafe: lane.restartSafe !== false,
      idempotencyKey: lane.idempotencyKey ?? null,
      nextAction: lane.nextAction ?? "review-diagnostic-lane",
    })),
  ].sort(compareDiagnosticReviewBoardRows);
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "review");
  const disabled = rows.filter((row) => row.status === "disabled");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : disabled.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "diagnostic-review-board-lanes.v1",
    status,
    ok: status === "ready" || status === "review",
    exportAllowed: status === "ready" || status === "review",
    rows: Object.freeze(rows),
    sections: Object.freeze(createDiagnosticReviewSections(rows)),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countBy(rows, "status")),
      bySource: freezeSortedRecord(countBy(rows, "source")),
      byHandoff: freezeSortedRecord(countBy(rows, "handoff")),
      byRoute: freezeSortedRecord(countBy(rows, "route")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      disabledCount: disabled.length,
      diagnosticCount: activeDiagnostics.length,
      commandCount: commandSummary.totals?.commandCount ?? 0,
      releaseChecklistCount: releaseChecklist?.totals?.checklistCount ?? 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "diagnostics/review-board/recovery"
        : status === "pending"
          ? "diagnostics/review-board/actions"
          : "diagnostics/review-board/summary",
      restartSafe: blocked.length === 0,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? commandSummary.recovery?.nextAction
        ?? clientState.handoff.nextAction,
    }),
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

export function createDiagnosticClientRuntimeAdoptionState(diagnostics = [], settings = {}) {
  const clientState = settings.clientState?.clientStateVersion === "diagnostic-client-runtime.v1"
    ? settings.clientState
    : createDiagnosticClientRuntimeState(diagnostics, settings);
  const exportState = settings.exportState?.version === "diagnostic-lifecycle-export.v1"
    ? settings.exportState
    : createDiagnosticLifecycleExportState(diagnostics, {
        ...settings,
        clientState,
      });
  const persistedResume = settings.persistedResume?.version === "diagnostic-persisted-resume.v1"
    ? settings.persistedResume
    : createDiagnosticPersistedResumeState(diagnostics, {
        ...settings,
        clientState,
        exportState,
      });
  const sourceCommandPacket = settings.sourceCommandPacket?.version === "source-range-client-command-packet.v1"
    ? settings.sourceCommandPacket
    : settings.clientCommandPacket?.version === "source-range-client-command-packet.v1"
      ? settings.clientCommandPacket
      : null;
  const adoptionRows = [
    ...createDiagnosticAdoptionRowsFromRuntime(clientState, persistedResume),
    ...createDiagnosticAdoptionRowsFromSourceCommands(sourceCommandPacket),
    ...createDiagnosticAdoptionRowsFromExportState(exportState),
  ].sort(compareDiagnosticAdoptionRows);
  const dedupedRows = dedupeDiagnosticAdoptionRows(adoptionRows);
  const blocked = dedupedRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = dedupedRows.filter((row) => row.status === "pending");
  const review = dedupedRows.filter((row) => row.status === "review");
  const status = clientState.status === "blocked"
    || exportState.status === "blocked"
    || persistedResume.status === "blocked"
    || sourceCommandPacket?.status === "blocked"
    || blocked.length
    ? "blocked"
    : clientState.status === "pending"
      || exportState.status === "pending"
      || persistedResume.status === "pending"
      || sourceCommandPacket?.status === "pending"
      || pending.length
      ? "pending"
      : review.length || persistedResume.status === "review" || sourceCommandPacket?.status === "review"
        ? "review"
        : dedupedRows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "diagnostic-client-runtime-adoption.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    providerId: settings.providerId ?? "aios-diagnostics",
    fileName: settings.fileName ?? "inline.aios",
    revision: settings.revision ?? "working",
    syncKey: [
      settings.fileName ?? "inline.aios",
      settings.revision ?? "working",
      persistedResume.syncKey,
      sourceCommandPacket?.syncKey ?? "source-commands-unbound",
    ].join("|"),
    rows: Object.freeze(dedupedRows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countBy(dedupedRows, "status")),
      byKind: freezeSortedRecord(countBy(dedupedRows, "kind")),
      byRoute: freezeSortedRecord(countBy(dedupedRows, "route")),
      byOrigin: freezeSortedRecord(countBy(dedupedRows, "origin")),
    }),
    totals: Object.freeze({
      rowCount: dedupedRows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      runtimeActionCount: clientState.runtimeActions.length,
      persistedActionCount: persistedResume.persistedActions.length,
      sourceCommandCount: sourceCommandPacket?.totals?.commandCount ?? 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "diagnostics/client-adoption/recovery"
        : status === "pending"
          ? "diagnostics/client-adoption/actions"
          : status === "review"
            ? "diagnostics/client-adoption/review"
            : "diagnostics/client-adoption/summary",
      restartSafe: blocked.length === 0
        && clientState.restartEnvelope.restartSafe
        && persistedResume.restartEnvelope.restartSafe
        && sourceCommandPacket?.restartEnvelope?.restartSafe !== false,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(dedupedRows
        .map((row) => row.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? sourceCommandPacket?.restartEnvelope?.nextAction
        ?? persistedResume.restartEnvelope.nextAction,
    }),
    userVisible: Object.freeze({
      title: "Diagnostic client adoption",
      detail: status === "ready" || status === "idle"
        ? "Diagnostic and source client commands are persisted for runtime adoption."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review runtime adoption rows remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? persistedResume.restartEnvelope.nextAction,
    }),
    clientState,
    exportState,
    persistedResume,
    sourceCommandPacket,
  });
}

export function createMailchimpWorkflowHandoffReadinessDiagnostics(packet = {}, options = {}) {
  if (!packet
    || packet.version !== "mailchimp-workflow-handoff-readiness.v1"
    || packet.status === "ready"
    || packet.status === "idle") {
    return Object.freeze([]);
  }

  const diagnostics = [];
  const lanes = Array.isArray(packet.lanes) ? packet.lanes : [];
  const blocked = lanes.filter((lane) => lane.status === "blocked" || lane.restartSafe === false || lane.exportAllowed === false);
  const pending = lanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance");
  const review = lanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const rangeByLaneId = options.rangeByLaneId ?? {};

  for (const lane of blocked) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_HANDOFF_READINESS", {
      severity: "error",
      message: `Mailchimp workflow handoff lane "${lane.id}" is blocked before campaign release.`,
      hint: `Recovery: ${lane.nextAction ?? packet.restartEnvelope?.nextAction ?? "complete-mailchimp-workflow-handoff-readiness"}; handoff: mailchimp-workflow-handoff-readiness.`,
      preview: lane.detail ?? lane.label ?? lane.id,
      range: rangeByLaneId[lane.id] ?? null,
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_HANDOFF_READINESS", {
      severity: "warning",
      message: `${pending.length} Mailchimp workflow handoff readiness lane(s) need acceptance or runtime action.`,
      hint: `Recovery: ${pending[0]?.nextAction ?? packet.restartEnvelope?.nextAction ?? "accept-mailchimp-workflow-handoff-readiness"}; handoff: mailchimp-workflow-handoff-readiness.`,
      preview: pending.map((lane) => lane.id).sort().join(", "),
    }));
  }

  if (!blocked.length && !pending.length && review.length && packet.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_HANDOFF_READINESS", {
      severity: "warning",
      message: `${review.length} Mailchimp workflow handoff readiness lane(s) require review before release.`,
      hint: `Recovery: ${review[0]?.nextAction ?? packet.restartEnvelope?.nextAction ?? "review-mailchimp-workflow-handoff-readiness"}; handoff: mailchimp-workflow-handoff-readiness.`,
      preview: review.map((lane) => lane.id).sort().join(", "),
    }));
  }

  if (packet.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_HANDOFF_READINESS", {
      severity: "error",
      message: "Mailchimp workflow handoff readiness packet is not restart-safe.",
      hint: `Recovery: ${packet.restartEnvelope.nextAction ?? "repair-mailchimp-workflow-handoff-readiness"}; handoff: mailchimp-workflow-handoff-readiness.`,
      preview: packet.restartEnvelope.route ?? "mailchimp/workflow-handoff/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createMailchimpClientRuntimeAdoptionDiagnostics(packet = {}, options = {}) {
  const requestPacket = packet?.version === "mailchimp-client-runtime-request.v1";
  const checkpointPacket = packet?.version === "mailchimp-client-runtime-handoff-checkpoint.v1";
  if (!packet
    || (packet.version !== "mailchimp-client-runtime-adoption.v1" && !requestPacket && !checkpointPacket)
    || packet.status === "ready"
    || packet.status === "idle") {
    return Object.freeze([]);
  }

  const rows = Array.isArray(packet.rows) ? packet.rows : [];
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const diagnostics = [];
  const diagnosticCode = requestPacket
    ? "AIOS_MAILCHIMP_CLIENT_RUNTIME_REQUEST"
    : checkpointPacket
      ? "AIOS_MAILCHIMP_CLIENT_RUNTIME_CHECKPOINT"
    : "AIOS_MAILCHIMP_CLIENT_RUNTIME_ADOPTION";
  const handoff = requestPacket
    ? "mailchimp-client-runtime-request"
    : checkpointPacket
      ? "mailchimp-client-runtime-checkpoint"
    : "mailchimp-client-runtime-adoption";

  if (requestPacket && packet.totals?.missingRequestFieldCount > 0) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_CLIENT_RUNTIME_REQUEST", {
      severity: "error",
      message: "Mailchimp client runtime request is missing request, session, workspace, or route state.",
      hint: `Recovery: ${packet.restartEnvelope?.nextAction ?? "bind-mailchimp-runtime-request"}; handoff: mailchimp-client-runtime-request.`,
      preview: packet.userVisible?.detail ?? packet.restartEnvelope?.route ?? "mailchimp/runtime-request/recovery",
      range: options.rangeByRuntimeRequestId?.[packet.request?.clientRequestId] ?? null,
    }));
  }

  for (const row of blocked) {
    diagnostics.push(createCatalogDiagnostic(diagnosticCode, {
      severity: "error",
      message: requestPacket
        ? `Mailchimp runtime request row "${row.id}" is blocked or not restart-safe.`
        : checkpointPacket
          ? `Mailchimp client runtime checkpoint row "${row.id}" is blocked, unexportable, or not restart-safe.`
        : `Mailchimp client adoption row "${row.id}" is blocked or not restart-safe.`,
      hint: `Recovery: ${row.nextAction ?? packet.restartEnvelope?.nextAction ?? "complete-mailchimp-client-runtime-adoption"}; handoff: ${handoff}.`,
      preview: row.detail ?? row.label ?? row.id,
      range: options.rangeByRuntimeRowId?.[row.id] ?? options.rangeByLaneId?.[row.laneId] ?? null,
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic(diagnosticCode, {
      severity: "warning",
      message: requestPacket
        ? `${pending.length} Mailchimp runtime request row(s) need acceptance or command settlement before release handoff.`
        : checkpointPacket
          ? `${pending.length} Mailchimp client runtime checkpoint row(s) need acceptance before release handoff.`
        : `${pending.length} Mailchimp client adoption row(s) need acceptance or command settlement before release handoff.`,
      hint: `Recovery: ${packet.restartEnvelope?.nextAction ?? "accept-mailchimp-client-runtime-adoption"}; handoff: ${handoff}.`,
      preview: pending.map((row) => row.id).sort().join(", "),
    }));
  }

  if (!blocked.length && !pending.length && review.length && packet.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic(diagnosticCode, {
      severity: "warning",
      message: requestPacket
        ? `${review.length} Mailchimp runtime request row(s) require review before client handoff can be exported.`
        : checkpointPacket
          ? `${review.length} Mailchimp client runtime checkpoint row(s) require review before client handoff can be exported.`
        : `${review.length} Mailchimp client adoption row(s) require review before client handoff can be exported.`,
      hint: `Recovery: ${packet.restartEnvelope?.nextAction ?? "review-mailchimp-client-runtime-adoption"}; handoff: ${handoff}.`,
      preview: review.map((row) => row.id).sort().join(", "),
    }));
  }

  if (packet.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic(diagnosticCode, {
      severity: "error",
      message: requestPacket
        ? "Mailchimp client runtime request packet is not restart-safe."
        : checkpointPacket
          ? "Mailchimp client runtime checkpoint packet is not restart-safe."
        : "Mailchimp client runtime adoption packet is not restart-safe.",
      hint: `Recovery: ${packet.restartEnvelope.nextAction ?? "complete-mailchimp-client-runtime-adoption"}; handoff: ${handoff}.`,
      preview: packet.restartEnvelope.route ?? "mailchimp/client-runtime-adoption/recovery",
    }));
  }

  if (checkpointPacket && packet.acceptance?.acceptable === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_CLIENT_RUNTIME_CHECKPOINT", {
      severity: "warning",
      message: "Mailchimp client runtime checkpoint acceptance is incomplete.",
      hint: `Recovery: ${packet.restartEnvelope?.nextAction ?? "accept-mailchimp-client-runtime-checkpoint"}; handoff: mailchimp-client-runtime-checkpoint.`,
      preview: packet.acceptance.pendingCheckpointIds?.join(", ") ?? packet.restartEnvelope?.route ?? "mailchimp/client-runtime-checkpoint/acceptance",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createSourceRangeRuntimeResumeDiagnostics(resumePacket = {}, options = {}) {
  if (!resumePacket
    || resumePacket.status === "ready"
    || resumePacket.status === "idle") {
    return Object.freeze([]);
  }

  const rows = Array.isArray(resumePacket.rows) ? resumePacket.rows : [];
  const actionableRows = rows.filter((row) => (
    row.status === "blocked"
    || row.status === "pending"
    || row.status === "review"
    || row.restartSafe === false
  ));
  const fallbackRows = actionableRows.length
    ? actionableRows
    : createSourceRuntimeResumeFallbackRows(resumePacket);

  return Object.freeze(fallbackRows.map((row) => {
    const blocked = row.status === "blocked" || row.restartSafe === false;
    return createCatalogDiagnostic("AIOS_SOURCE_RANGE_RUNTIME_RESUME", {
      severity: blocked ? "error" : "warning",
      range: options.rangeBySourceId?.[row.targetId] ?? options.rangeByResumeRowId?.[row.id] ?? null,
      message: `Source range resume row "${row.id}" is ${row.status}.`,
      hint: `Recovery: ${row.nextAction}; handoff: source-range-runtime-resume.`,
      preview: row.previewAddress
        ? `${row.label ?? row.id} resumes from ${row.previewAddress}.`
        : row.detail ?? `${row.label ?? row.id} needs source runtime resume review.`,
      sourceRuntimeResume: Object.freeze({
        id: row.id,
        origin: row.origin ?? "sourceRange",
        kind: row.kind ?? "resume",
        status: row.status,
        route: row.route ?? resumePacket.restartEnvelope?.route ?? "source-ranges/runtime-resume/summary",
        targetId: row.targetId ?? null,
        accepted: Boolean(row.accepted),
        restartSafe: row.restartSafe !== false,
        previewAddress: row.previewAddress ?? null,
        externalUri: row.externalUri ?? null,
        idempotencyKey: row.idempotencyKey ?? null,
        packetSyncKey: resumePacket.syncKey ?? null,
        nextAction: row.nextAction
          ?? resumePacket.restartEnvelope?.nextAction
          ?? "review-source-range-runtime-resume",
      }),
    });
  }));
}

export function createSourceRangeClientRouteHandoffDiagnostics(packet = {}, options = {}) {
  if (!packet
    || packet.version !== "source-range-client-route-handoff.v1"
    || packet.status === "ready"
    || packet.status === "idle") {
    return Object.freeze([]);
  }

  const routes = Array.isArray(packet.routes) ? packet.routes : [];
  const blocked = routes.filter((route) => route.status === "blocked" || route.restartSafe === false || route.exportAllowed === false);
  const pending = routes.filter((route) => route.status === "pending");
  const review = routes.filter((route) => route.status === "review" || route.status === "degraded");
  const diagnostics = [];

  for (const route of blocked) {
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_CLIENT_ROUTE_HANDOFF", {
      severity: "error",
      range: options.rangeByRouteId?.[route.id] ?? options.rangeBySourceId?.[route.targetId] ?? null,
      message: `Source range client route "${route.id}" is blocked before preview handoff.`,
      hint: `Recovery: ${route.nextAction ?? packet.restartEnvelope?.nextAction ?? "complete-source-range-client-route-handoff"}; handoff: source-range-client-route-handoff.`,
      preview: route.userVisible?.detail ?? route.detail ?? route.route,
      sourceClientRouteHandoff: Object.freeze({
        id: route.id,
        kind: route.kind,
        status: route.status,
        route: route.route,
        targetId: route.targetId ?? null,
        accepted: Boolean(route.accepted),
        restartSafe: route.restartSafe !== false,
        exportAllowed: route.exportAllowed !== false,
        idempotencyKey: route.idempotencyKey ?? null,
        nextAction: route.nextAction ?? packet.restartEnvelope?.nextAction ?? "complete-source-range-client-route-handoff",
      }),
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_CLIENT_ROUTE_HANDOFF", {
      severity: "warning",
      message: `${pending.length} source range client route handoff row(s) need acceptance or runtime settlement.`,
      hint: `Recovery: ${packet.restartEnvelope?.nextAction ?? "accept-source-range-client-route-handoff"}; handoff: source-range-client-route-handoff.`,
      preview: pending.map((route) => route.id).sort().join(", "),
    }));
  }

  if (!blocked.length && !pending.length && review.length && packet.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_CLIENT_ROUTE_HANDOFF", {
      severity: "warning",
      message: `${review.length} source range client route handoff row(s) require review before preview handoff.`,
      hint: `Recovery: ${packet.restartEnvelope?.nextAction ?? "review-source-range-client-route-handoff"}; handoff: source-range-client-route-handoff.`,
      preview: review.map((route) => route.id).sort().join(", "),
    }));
  }

  if (packet.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_SOURCE_RANGE_CLIENT_ROUTE_HANDOFF", {
      severity: "error",
      message: "Source range client route handoff packet is not restart-safe.",
      hint: `Recovery: ${packet.restartEnvelope.nextAction ?? "repair-source-range-client-route-handoff"}; handoff: source-range-client-route-handoff.`,
      preview: packet.restartEnvelope.route ?? "source-ranges/client-route-handoff/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

export function createMailchimpPreviewActionStripDiagnostics(actionStrip = {}, options = {}) {
  if (!actionStrip
    || actionStrip.version !== "mailchimp-preview-action-strip.v1"
    || actionStrip.status === "ready"
    || actionStrip.status === "idle") {
    return Object.freeze([]);
  }

  const actions = Array.isArray(actionStrip.actions) ? actionStrip.actions : [];
  const blocked = actions.filter((action) => action.status === "blocked" || action.restartSafe === false);
  const pending = actions.filter((action) => action.status === "pending" || action.acceptanceState === "pending");
  const review = actions.filter((action) => action.status === "review");
  const diagnostics = [];

  for (const action of blocked) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PREVIEW_ACTION_STRIP", {
      severity: "error",
      range: options.rangeByActionId?.[action.id]
        ?? options.rangeByJobName?.[action.jobName]
        ?? options.rangeBySourceId?.[action.sourceAnchorId]
        ?? null,
      message: `Mailchimp preview action "${action.id}" is blocked before campaign preview handoff.`,
      hint: `Recovery: ${action.nextAction ?? actionStrip.restartEnvelope?.nextAction ?? "complete-mailchimp-preview-action-strip"}; handoff: mailchimp-preview-action-strip.`,
      preview: action.userVisible?.detail ?? action.detail ?? action.route,
      mailchimpPreviewActionStrip: Object.freeze({
        id: action.id,
        kind: action.kind,
        status: action.status,
        route: action.route,
        jobName: action.jobName ?? null,
        sourceAnchorId: action.sourceAnchorId ?? null,
        accepted: Boolean(action.accepted),
        restartSafe: action.restartSafe !== false,
        idempotencyKey: action.idempotencyKey ?? null,
        nextAction: action.nextAction ?? actionStrip.restartEnvelope?.nextAction ?? "complete-mailchimp-preview-action-strip",
      }),
    }));
  }

  if (!blocked.length && pending.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PREVIEW_ACTION_STRIP", {
      severity: "warning",
      message: `${pending.length} Mailchimp preview action strip row(s) need acceptance before campaign preview handoff.`,
      hint: `Recovery: ${actionStrip.restartEnvelope?.nextAction ?? "accept-mailchimp-preview-action-strip"}; handoff: mailchimp-preview-action-strip.`,
      preview: pending.map((action) => action.id).sort().join(", "),
    }));
  }

  if (!blocked.length && !pending.length && review.length && actionStrip.exportAllowed !== true) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PREVIEW_ACTION_STRIP", {
      severity: "warning",
      message: `${review.length} Mailchimp preview action strip row(s) require review before handoff.`,
      hint: `Recovery: ${actionStrip.restartEnvelope?.nextAction ?? "review-mailchimp-preview-action-strip"}; handoff: mailchimp-preview-action-strip.`,
      preview: review.map((action) => action.id).sort().join(", "),
    }));
  }

  if (actionStrip.restartEnvelope?.restartSafe === false && !blocked.length) {
    diagnostics.push(createCatalogDiagnostic("AIOS_MAILCHIMP_PREVIEW_ACTION_STRIP", {
      severity: "error",
      message: "Mailchimp preview action strip is not restart-safe.",
      hint: `Recovery: ${actionStrip.restartEnvelope.nextAction ?? "repair-mailchimp-preview-action-strip"}; handoff: mailchimp-preview-action-strip.`,
      preview: actionStrip.restartEnvelope.route ?? "mailchimp/preview-actions/recovery",
    }));
  }

  return Object.freeze(diagnostics);
}

function createDiagnosticAdoptionRowsFromRuntime(clientState, persistedResume) {
  const persistedByActionId = new Map((persistedResume.persistedActions ?? [])
    .map((action) => [String(action.sourceActionId ?? action.id), action]));

  return (clientState.runtimeActions ?? []).map((action) => {
    const persisted = persistedByActionId.get(String(action.id)) ?? null;
    const blocked = action.status === "blocked" || action.restartSafe === false || persisted?.status === "blocked";
    const pending = !blocked && (action.status === "pending" || persisted?.status === "pending");
    const review = !blocked && !pending && persisted?.status === "review";
    const status = blocked ? "blocked" : pending ? "pending" : review ? "review" : "ready";

    return diagnosticAdoptionRow({
      id: `runtime:${action.id}`,
      origin: "diagnosticRuntime",
      kind: action.kind,
      status,
      route: action.route ?? clientState.handoff.route,
      targetId: action.target,
      label: action.target,
      detail: `${action.kind} diagnostic runtime action for ${action.handoff}.`,
      restartSafe: action.restartSafe !== false && persisted?.restartSafe !== false,
      idempotencyKey: persisted?.idempotencyKey ?? action.idempotencyKey,
      nextAction: persisted?.nextAction ?? action.nextAction,
    });
  });
}

function createDiagnosticAdoptionRowsFromSourceCommands(sourceCommandPacket) {
  if (!sourceCommandPacket) return [];

  return (sourceCommandPacket.commands ?? []).map((command) => diagnosticAdoptionRow({
    id: `source-command:${command.id}`,
    origin: "sourceRangeCommand",
    kind: command.kind,
    status: command.status,
    route: command.route,
    targetId: command.sourceRowId,
    label: command.label,
    detail: `${command.intent} source range command for ${command.handoff}.`,
    restartSafe: command.restartSafe,
    idempotencyKey: command.idempotencyKey,
    nextAction: command.nextAction,
  }));
}

function createDiagnosticAdoptionRowsFromExportState(exportState) {
  const blockedActionIds = new Set(exportState.recovery?.blockedActionIds ?? []);
  const pendingActionIds = new Set(exportState.recovery?.pendingActionIds ?? []);

  return (exportState.controls ?? [])
    .filter((control) => control.status === "blocked" || control.status === "review" || control.enabled === false)
    .map((control) => {
      const blocked = control.status === "blocked" || [...blockedActionIds].some((id) => String(id).startsWith(control.code));
      const pending = !blocked && (control.status === "review" || [...pendingActionIds].some((id) => String(id).startsWith(control.code)));
      return diagnosticAdoptionRow({
        id: `control:${control.code}`,
        origin: "diagnosticControl",
        kind: "lifecycleControl",
        status: blocked ? "blocked" : pending ? "pending" : control.enabled === false ? "review" : "ready",
        route: exportState.route?.clientRoute ?? "diagnostics/lifecycle",
        targetId: control.code,
        label: control.code,
        detail: `Diagnostic lifecycle control is ${control.status}.`,
        restartSafe: !blocked,
        idempotencyKey: `${control.code}:${control.handoff}:${control.status}`,
        nextAction: control.enabled === false ? "enable-diagnostic-control" : control.recovery,
      });
    });
}

function diagnosticAdoptionRow(row) {
  return Object.freeze({
    id: row.id,
    origin: row.origin,
    kind: row.kind ?? "runtimeAdoption",
    status: row.status ?? "ready",
    route: row.route ?? "diagnostics/client-adoption",
    targetId: row.targetId ?? null,
    label: row.label ?? row.id,
    detail: row.detail ?? "Runtime adoption row.",
    restartSafe: row.restartSafe !== false,
    idempotencyKey: row.idempotencyKey ?? null,
    nextAction: row.nextAction ?? "review-diagnostic-client-adoption",
  });
}

function dedupeDiagnosticAdoptionRows(rows) {
  const deduped = new Map();
  for (const row of rows) {
    const current = deduped.get(row.id);
    if (!current || rankDiagnosticAdoptionStatus(row.status) > rankDiagnosticAdoptionStatus(current.status)) {
      deduped.set(row.id, row);
    }
  }
  return [...deduped.values()].sort(compareDiagnosticAdoptionRows);
}

function rankDiagnosticAdoptionStatus(status) {
  return status === "blocked" ? 4 : status === "pending" ? 3 : status === "review" ? 2 : status === "ready" ? 1 : 0;
}

function compareDiagnosticAdoptionRows(left, right) {
  return rankDiagnosticAdoptionStatus(right.status) - rankDiagnosticAdoptionStatus(left.status)
    || left.origin.localeCompare(right.origin)
    || left.id.localeCompare(right.id);
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

function createDiagnosticReviewBoardRow(row = {}) {
  return Object.freeze({
    id: String(row.id ?? "diagnostic-review-row"),
    source: String(row.source ?? "diagnostic"),
    kind: String(row.kind ?? "diagnostic"),
    status: normalizeDiagnosticReviewStatus(row.status),
    severity: row.severity ?? "info",
    label: String(row.label ?? row.id ?? "Diagnostic review"),
    detail: String(row.detail ?? ""),
    handoff: String(row.handoff ?? "diagnostic-review-board"),
    route: String(row.route ?? "diagnostics/review-board"),
    targetId: row.targetId ?? null,
    restartSafe: row.restartSafe !== false,
    idempotencyKey: row.idempotencyKey ? String(row.idempotencyKey) : null,
    nextAction: String(row.nextAction ?? "review-diagnostic-lane"),
  });
}

function normalizeDiagnosticReviewStatus(status) {
  if (status === "blocked" || status === "pending" || status === "review" || status === "disabled" || status === "ready") {
    return status;
  }
  if (status === "needsAcceptance") return "pending";
  if (status === "error" || status === "failed") return "blocked";
  return "ready";
}

function compareDiagnosticReviewBoardRows(left, right) {
  return diagnosticReviewStatusOrder(left.status) - diagnosticReviewStatusOrder(right.status)
    || left.source.localeCompare(right.source)
    || left.handoff.localeCompare(right.handoff)
    || left.id.localeCompare(right.id);
}

function diagnosticReviewStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    disabled: 3,
    ready: 4,
  }[status] ?? 5;
}

function createDiagnosticReviewSections(rows = []) {
  const sections = new Map();

  for (const row of rows) {
    const sectionId = row.handoff;
    const section = sections.get(sectionId) ?? {
      id: sectionId,
      route: row.route,
      status: "ready",
      rowIds: [],
      blockedCount: 0,
      pendingCount: 0,
      reviewCount: 0,
      disabledCount: 0,
      restartSafe: true,
      nextAction: row.nextAction,
    };
    section.rowIds.push(row.id);
    section.status = selectDiagnosticReviewSectionStatus(section.status, row.status);
    section.blockedCount += row.status === "blocked" ? 1 : 0;
    section.pendingCount += row.status === "pending" ? 1 : 0;
    section.reviewCount += row.status === "review" ? 1 : 0;
    section.disabledCount += row.status === "disabled" ? 1 : 0;
    section.restartSafe = section.restartSafe && row.restartSafe;
    if (diagnosticReviewStatusOrder(row.status) < diagnosticReviewStatusOrder(section.status)) {
      section.nextAction = row.nextAction;
    }
    sections.set(sectionId, section);
  }

  return [...sections.values()]
    .sort((left, right) => diagnosticReviewStatusOrder(left.status) - diagnosticReviewStatusOrder(right.status)
      || left.id.localeCompare(right.id))
    .map((section) => Object.freeze({
      id: section.id,
      route: section.route,
      status: section.status,
      rowIds: Object.freeze(section.rowIds.sort()),
      blockedCount: section.blockedCount,
      pendingCount: section.pendingCount,
      reviewCount: section.reviewCount,
      disabledCount: section.disabledCount,
      restartSafe: section.restartSafe,
      nextAction: section.nextAction,
    }));
}

function selectDiagnosticReviewSectionStatus(current, next) {
  return diagnosticReviewStatusOrder(next) < diagnosticReviewStatusOrder(current) ? next : current;
}

function selectDiagnosticReviewRoute(handoff, fallbackRoute) {
  if (handoff === "mailchimp-tenant-permission-audit") return "mailchimp/tenant-boundary";
  if (handoff === "mailchimp-source-anchor") return "mailchimp/source-anchor/review";
  if (handoff === "mailchimp-launch-gate") return "mailchimp/launch/actions";
  if (handoff === "mailchimp-provider-receipt") return "mailchimp/provider-receipts";
  if (handoff === "mailchimp-service-sync-window") return "mailchimp/service-sync-window";
  if (handoff === "mailchimp-operational-health") return "mailchimp/operational-health";
  return fallbackRoute ?? "diagnostics/review-board";
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

function createSourceRuntimeResumeFallbackRows(resumePacket = {}) {
  const envelope = resumePacket.restartEnvelope ?? {};
  const blockedRows = (envelope.blockedRowIds ?? []).map((id) => sourceRuntimeResumeFallbackRow(id, {
    status: "blocked",
    resumePacket,
    nextAction: envelope.nextAction ?? "repair-source-range-runtime-resume",
  }));
  const pendingRows = (envelope.pendingRowIds ?? []).map((id) => sourceRuntimeResumeFallbackRow(id, {
    status: "pending",
    resumePacket,
    nextAction: envelope.nextAction ?? "accept-source-range-runtime-resume",
  }));
  const reviewRows = (envelope.reviewRowIds ?? []).map((id) => sourceRuntimeResumeFallbackRow(id, {
    status: "review",
    resumePacket,
    nextAction: envelope.nextAction ?? "review-source-range-runtime-resume",
  }));

  if (blockedRows.length || pendingRows.length || reviewRows.length) {
    return Object.freeze([...blockedRows, ...pendingRows, ...reviewRows]);
  }

  return Object.freeze([sourceRuntimeResumeFallbackRow("source-range-runtime-resume", {
    status: resumePacket.status ?? "review",
    resumePacket,
    nextAction: envelope.nextAction ?? "review-source-range-runtime-resume",
  })]);
}

function sourceRuntimeResumeFallbackRow(id, context) {
  return Object.freeze({
    id: String(id),
    origin: "sourceRange",
    kind: "runtimeResume",
    status: context.status,
    label: String(id),
    detail: context.resumePacket.userVisible?.detail ?? "Source range runtime resume needs review.",
    route: context.resumePacket.restartEnvelope?.route ?? "source-ranges/runtime-resume/summary",
    targetId: String(id),
    accepted: false,
    restartSafe: context.status !== "blocked" && context.resumePacket.restartEnvelope?.restartSafe !== false,
    previewAddress: null,
    externalUri: null,
    idempotencyKey: context.resumePacket.syncKey ?? null,
    nextAction: context.nextAction,
  });
}

function createSourceRangeFailureRecoveryDiagnosticMessage(row = {}) {
  if (row.exhausted) {
    return `Source range recovery row "${row.id}" exhausted ${row.attempts} retry attempt(s).`;
  }
  if (row.restartSafe === false) {
    return `Source range recovery row "${row.id}" is not restart-safe.`;
  }
  if (row.status === "blocked") {
    return `Source range recovery row "${row.id}" is blocked.`;
  }
  if (row.status === "pending") {
    return `Source range recovery row "${row.id}" is pending retry or acceptance.`;
  }
  if (row.status === "degraded") {
    return `Source range recovery row "${row.id}" is using degraded-mode handoff.`;
  }
  return `Source range recovery row "${row.id}" needs review.`;
}

function inferMailchimpWindowJobName(window = {}) {
  const operationId = Array.isArray(window.operationIds)
    ? window.operationIds.find(Boolean)
    : null;
  if (!operationId) return null;
  const [jobName] = String(operationId).split(":");
  return jobName || null;
}

function incrementDiagnosticCounter(record, key) {
  const safeKey = key ?? "unknown";
  record[safeKey] = (record[safeKey] ?? 0) + 1;
}

function createMailchimpDiagnosticCheckpointControl(checkpoint = {}, state = {}) {
  const requested = state.requested.has(checkpoint.id);
  const completed = state.completed.has(checkpoint.id) || checkpoint.completed === true;
  const failed = state.failed.has(checkpoint.id);
  const sourceStatus = normalizeDiagnosticCheckpointStatus(checkpoint.status);
  const status = failed || sourceStatus === "blocked"
    ? "blocked"
    : completed
      ? "ready"
      : requested || sourceStatus === "pending"
        ? "pending"
        : sourceStatus;

  return Object.freeze({
    id: `checkpoint:${checkpoint.id}`,
    checkpointId: checkpoint.id,
    kind: "mailchimpAstCheckpoint",
    status,
    sourceStatus,
    label: checkpoint.label ?? checkpoint.id,
    detail: checkpoint.detail ?? "",
    handoff: checkpoint.handoff ?? "mailchimp-ast-checkpoint",
    requested,
    completed,
    failed,
    restartSafe: status !== "blocked",
    idempotencyKey: [
      state.checkpointReport.fileName ?? "inline.aios",
      state.checkpointReport.revision ?? "working",
      checkpoint.id,
      checkpoint.sourceStatus ?? checkpoint.status ?? "unknown",
    ].join(":"),
    nextAction: status === "blocked"
      ? checkpoint.nextAction ?? "repair-mailchimp-ast-checkpoint"
      : completed
        ? "retain-mailchimp-diagnostic-checkpoint"
        : requested || status === "pending"
          ? checkpoint.nextAction ?? `run-mailchimp-diagnostic-checkpoint:${checkpoint.id}`
          : checkpoint.nextAction ?? "review-mailchimp-diagnostic-checkpoint",
  });
}

function normalizeDiagnosticCheckpointStatus(status) {
  if (status === "ready" || status === "idle" || status === "empty") return "ready";
  if (status === "pending" || status === "needsAcceptance") return "pending";
  if (status === "blocked" || status === "failed" || status === "disabled" || status === "required") return "blocked";
  return "review";
}

function compareMailchimpDiagnosticCheckpointControls(left, right) {
  return diagnosticCheckpointStatusOrder(left.status) - diagnosticCheckpointStatusOrder(right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function diagnosticCheckpointStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
  }[status] ?? 4;
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
