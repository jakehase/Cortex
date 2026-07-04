import { lex } from "./lexer.mjs";
import {
  createTokenCheckpoint,
  createTokenStream,
  createTokenStreamBoundaryReport,
  createTokenStreamBoundaryEscalationPacket,
  createTokenStreamBoundaryIncidentReport,
  createTokenStreamTenantBoundaryReadiness,
  createTokenStreamHealthReport,
  createTokenStreamAdapterStatusPacket,
  createTokenStreamProviderAcceptanceSummary,
  createTokenStreamProviderReadinessPreview,
  createTokenStreamProviderServiceContract,
  createTokenStreamCommandAuditReport,
  createTokenStreamClientHandoffPacket,
  createTokenStreamHandoffEvidencePacket,
  createTokenStreamExternalProviderStatusReceipt,
  createTokenStreamMailchimpHandoffDecision,
  createTokenStreamMailchimpWorkflowSession,
  createTokenStreamMailchimpAudienceSyncContract,
  createTokenStreamMailchimpExportLedger,
  createTokenStreamClientRuntimeAdoptionSnapshot,
  createTokenStreamNextActionQueue,
  createTokenStreamOperatorDecisionLane,
  createTokenStreamExportReadinessManifest,
  createTokenStreamOperationsPacket,
  createTokenStreamProviderLifecycleManifest,
  createTokenStreamResumptionManifest,
  createTokenStreamResumptionStatusEnvelope,
  createTokenStreamRestartStatusReconciliation,
  createTokenStreamRestartJournal,
  createTokenStreamMailchimpRecoveryEnvelope,
  createTokenStreamMailchimpOperatorGate,
  createTokenStreamMailchimpControlPlane,
  createTokenStreamMailchimpOperationalTimeline,
  createTokenStreamClientWorkflowStatusEnvelope,
  createTokenStreamRouteReadinessContract,
  describeTokenWindow,
} from "./token-stream.mjs";

function classifyRecovery(diagnostic) {
  const code = diagnostic?.code ?? "UNKNOWN";
  if (code === "LEX_UNTERMINATED_STRING" || code === "LEX_UNTERMINATED_COMMENT") {
    return Object.freeze({
      code,
      status: "waiting-for-source",
      retryable: true,
      nextAction: "resume-editing",
    });
  }

  if (code.startsWith("BOUNDARY_") || code.includes("PERMISSION")) {
    return Object.freeze({
      code,
      status: "blocked",
      retryable: false,
      nextAction: "correct-execution-boundary",
    });
  }

  return Object.freeze({
    code,
    status: "degraded",
    retryable: false,
    nextAction: "surface-diagnostic",
  });
}

function normalizeLexerOptions(options = {}) {
  return Object.freeze({
    workspace: options.workspace ?? null,
    tenant: options.tenant ?? null,
    role: options.role ?? null,
    permissions: Object.freeze(Array.from(options.permissions ?? [])),
    auditChannel: options.auditChannel ?? null,
    localOnly: options.localOnly !== false,
    sourceId: options.sourceId ?? null,
    expectedAdapter: options.expectedAdapter ?? "mailchimp",
    acceptedBy: options.acceptedBy ?? null,
    mailchimpEnabled: options.mailchimpEnabled ?? true,
    scheduledAt: options.scheduledAt ?? null,
    mailchimpAudienceId: options.mailchimpAudienceId ?? options.audienceId ?? options.listId ?? null,
    mailchimpSegmentId: options.mailchimpSegmentId ?? options.segmentId ?? null,
    mailchimpMergeFields: Object.freeze(Object.fromEntries(Object.entries(options.mailchimpMergeFields ?? options.mergeFields ?? {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [String(key).trim(), String(value).trim()])
      .filter(([key, value]) => key !== "" && value !== "")
      .sort(([left], [right]) => left.localeCompare(right)))),
    mailchimpRequiredMergeFields: Object.freeze(Array.from(options.mailchimpRequiredMergeFields ?? options.requiredMergeFields ?? ["EMAIL"])
      .map((field) => String(field ?? "").trim())
      .filter(Boolean)
      .sort()),
    mailchimpConsentField: options.mailchimpConsentField ?? options.consentField ?? null,
    mailchimpConsentRequired: options.mailchimpConsentRequired ?? options.consentRequired ?? true,
    mailchimpAudienceRevision: options.mailchimpAudienceRevision ?? options.audienceRevision ?? null,
    mailchimpSyncMode: options.mailchimpSyncMode ?? options.mode ?? "manual",
    mailchimpDryRun: options.mailchimpDryRun ?? options.dryRun ?? true,
    allowMutatingMailchimpSync: options.allowMutatingMailchimpSync ?? options.allowMutatingSync ?? false,
    idempotencyKey: options.idempotencyKey ?? null,
    externalStatusEvents: Object.freeze(Array.from(options.externalStatusEvents ?? [])),
  });
}

function retryBackoffForRecovery(recoveries) {
  if (recoveries.some((entry) => entry.status === "blocked")) {
    return Object.freeze({
      retryAfterMs: null,
      strategy: "manual-correction",
      maxAttempts: 0,
    });
  }

  if (recoveries.some((entry) => entry.status === "waiting-for-source")) {
    return Object.freeze({
      retryAfterMs: 0,
      strategy: "on-source-update",
      maxAttempts: 1,
    });
  }

  if (recoveries.length > 0) {
    return Object.freeze({
      retryAfterMs: 250,
      strategy: "bounded-parser-handoff",
      maxAttempts: 2,
    });
  }

  return Object.freeze({
    retryAfterMs: 0,
    strategy: "none",
    maxAttempts: 0,
  });
}

function boundaryValueStatus(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    return Object.freeze({
      label,
      ok: false,
      status: "missing",
      nextAction: `declare-${label}`,
    });
  }

  if (value.includes("*") || value.includes("..")) {
    return Object.freeze({
      label,
      ok: false,
      status: "unsafe",
      nextAction: `narrow-${label}`,
    });
  }

  return Object.freeze({
    label,
    ok: true,
    status: "scoped",
    nextAction: "continue",
  });
}

function createLexerBoundaryHandoff(lexed, options, mailchimp) {
  const workspace = options.workspace ?? lexed.boundary?.workspace ?? null;
  const tenant = options.tenant ?? lexed.boundary?.tenant ?? null;
  const role = options.role ?? lexed.boundary?.role ?? null;
  const checks = Object.freeze({
    workspace: boundaryValueStatus(workspace, "workspace"),
    tenant: boundaryValueStatus(tenant, "tenant"),
    role: boundaryValueStatus(role, "role"),
  });
  const permissions = Object.freeze(Array.from(options.permissions ?? []));
  const mailchimpPermissionHints = Object.freeze([
    mailchimp.detected && !permissions.includes("mailchimp.read") ? "mailchimp.read" : null,
    mailchimp.detected && mailchimp.status === "handoff-needs-recovery-status" && !permissions.includes("mailchimp.write")
      ? "mailchimp.write"
      : null,
  ].filter(Boolean));
  const blocked = Object.values(checks).some((entry) => !entry.ok);

  return Object.freeze({
    schema: "aios.lexer.boundary-handoff.v1",
    workspace,
    tenant,
    role,
    localOnly: options.localOnly,
    expectedAdapter: options.expectedAdapter,
    checks,
    permissions,
    mailchimpPermissionHints,
    audit: Object.freeze({
      channel: options.auditChannel,
      required: mailchimp.detected || blocked,
      status: options.auditChannel
        ? "audit-ready"
        : mailchimp.detected || blocked
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    status: blocked
      ? "blocked-boundary"
      : mailchimpPermissionHints.length > 0
        ? "needs-permission-review"
        : "scoped",
    nextAction: blocked
      ? "correct-lexer-boundary"
      : mailchimpPermissionHints.length > 0
        ? "review-mailchimp-role-permissions"
        : options.auditChannel || !mailchimp.detected
          ? "handoff-parser"
          : "declare-audit-channel",
  });
}

function mailchimpTokenSignals(tokens) {
  const values = Array.from(tokens ?? []).map((token) => token.value);
  const hasMailchimpName = values.some((value) => String(value).toLowerCase() === "mailchimp");
  const hasHandoff = values.includes("handoff") && values.includes("adapter");
  const hasRecovery = values.includes("recover") || values.includes("retry") || values.includes("idempotency");
  const hasStatus = values.includes("status") || values.includes("audit");

  return Object.freeze({
    schema: "aios.lexer.mailchimp.signals.v1",
    detected: hasMailchimpName || values.some((value) => String(value).startsWith("mailchimp.")),
    hasHandoff,
    hasRecovery,
    hasStatus,
    status: hasMailchimpName || hasHandoff
      ? hasRecovery && hasStatus
        ? "handoff-observable"
        : "handoff-needs-recovery-status"
      : "not-detected",
  });
}

function buildLexerResumePlan(lexed, stream, options) {
  const blocking = lexed.diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const recoveries = blocking.map(classifyRecovery);
  const checkpoint = createTokenCheckpoint(stream, "lexer-state");
  const retryable = recoveries.some((entry) => entry.retryable);
  const degraded = blocking.length > 0 && recoveries.every((entry) => entry.status !== "blocked");
  const backoff = retryBackoffForRecovery(recoveries);

  return Object.freeze({
    schema: "aios.lexer.resume.v1",
    sourceId: options.sourceId,
    status: blocking.length === 0
      ? "ready-for-parser"
      : retryable
        ? "awaiting-complete-source"
        : degraded
          ? "degraded-token-stream"
          : "blocked",
    retryable,
    degraded,
    backoff,
    checkpoint,
    tokenWindow: describeTokenWindow(stream),
    recovery: Object.freeze(recoveries),
    client: Object.freeze({
      sourceId: options.sourceId,
      workspace: options.workspace,
      tenant: options.tenant,
      role: options.role,
      restoreCommand: checkpoint.clientState.restoreCommand,
      handoff: "lexer-to-parser",
    }),
    nextAction: blocking.length === 0
      ? "parse"
      : retryable
        ? "resume-lex-after-edit"
        : degraded
          ? "parse-with-recovery"
          : "hold-parser-handoff",
  });
}

function createLexerOperationalHealth(lexed, stream, boundaryHandoff, resume, mailchimp) {
  const boundaryReport = createTokenStreamBoundaryReport(stream, {
    requiredPermissions: mailchimp.detected
      ? mailchimp.status === "handoff-needs-recovery-status"
        ? ["mailchimp.read", "mailchimp.write"]
        : ["mailchimp.read"]
      : [],
  });
  const blockingDiagnostics = lexed.diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const warnings = lexed.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const actionableErrors = Object.freeze(blockingDiagnostics.map((diagnostic) => {
    const recovery = classifyRecovery(diagnostic);
    return Object.freeze({
      code: diagnostic.code,
      message: diagnostic.message,
      line: diagnostic.line,
      column: diagnostic.column,
      severity: diagnostic.severity,
      recovery,
      nextAction: recovery.nextAction,
    });
  }));
  const degraded = resume.degraded || boundaryHandoff.status === "needs-permission-review";
  const blocked = resume.status === "blocked" || boundaryHandoff.status === "blocked-boundary" || !boundaryReport.ok;
  const status = blocked
    ? "blocked"
    : degraded
      ? "degraded"
      : warnings.length > 0
        ? "warning"
        : "healthy";

  return Object.freeze({
    schema: "aios.lexer.operational-health.v1",
    ok: status === "healthy" || status === "warning",
    status,
    degraded,
    blocked,
    tokenCount: lexed.health.tokenCount,
    diagnosticCount: lexed.diagnostics.length,
    warningCount: warnings.length,
    blockingCount: blockingDiagnostics.length,
    boundary: boundaryReport,
    audit: Object.freeze({
      channel: boundaryHandoff.audit.channel,
      required: boundaryHandoff.audit.required || boundaryReport.audit.required,
      status: boundaryHandoff.audit.status === "audit-ready" || boundaryReport.audit.status === "audit-ready"
        ? "audit-ready"
        : boundaryHandoff.audit.required || boundaryReport.audit.required
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    retry: resume.backoff,
    actionableErrors,
    nextAction: blocked
      ? boundaryReport.ok
        ? boundaryHandoff.nextAction
        : boundaryReport.nextAction
      : degraded
        ? "parse-with-recovery"
        : "handoff-parser",
  });
}

function countTokensByType(tokens) {
  const counters = {};
  for (const token of tokens ?? []) {
    const type = token?.type ?? "UNKNOWN";
    counters[type] = (counters[type] ?? 0) + 1;
  }

  return Object.freeze(Object.fromEntries(Object.entries(counters).sort(([left], [right]) => left.localeCompare(right))));
}

function countDiagnosticsByCode(diagnostics) {
  const counters = {};
  for (const diagnostic of diagnostics ?? []) {
    const code = diagnostic?.code ?? "UNKNOWN";
    counters[code] = (counters[code] ?? 0) + 1;
  }

  return Object.freeze(Object.fromEntries(Object.entries(counters).sort(([left], [right]) => left.localeCompare(right))));
}

function createLexerBoundaryIncidentSummary(state, tokenHealth, options) {
  const requiredPermissions = state.mailchimp.detected
    ? state.mailchimp.status === "handoff-needs-recovery-status"
      ? ["mailchimp.read", "mailchimp.write"]
      : ["mailchimp.read"]
    : [];
  const incident = createTokenStreamBoundaryIncidentReport(state.stream, {
    workspace: options.workspace,
    tenant: options.tenant,
    role: options.role,
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    requiredPermissions,
    expectedWorkspace: options.expectedWorkspace,
    expectedTenant: options.expectedTenant,
    expectedRole: options.expectedRole,
  });
  const lexerBlocked = state.boundaryHandoff.status !== "scoped";
  const tokenBlocked = incident.blocked || tokenHealth.boundaryIncident?.blocked === true;
  const status = lexerBlocked
    ? state.boundaryHandoff.status
    : tokenBlocked
      ? incident.status
      : "clear";

  return Object.freeze({
    schema: "aios.lexer.boundary-incident-summary.v1",
    sourceId: state.sourceId,
    status,
    blocked: lexerBlocked || tokenBlocked,
    incidentId: incident.incidentId,
    boundary: Object.freeze({
      workspace: state.boundaryHandoff.workspace,
      tenant: state.boundaryHandoff.tenant,
      role: state.boundaryHandoff.role,
      streamStatus: incident.status,
      lexerStatus: state.boundaryHandoff.status,
    }),
    counters: Object.freeze({
      missingScope: incident.missingScope.length,
      unsafeScope: incident.unsafeScope.length,
      mismatches: incident.mismatches.length,
      missingPermissions: incident.missingPermissions.length + state.boundaryHandoff.mailchimpPermissionHints.length,
      diagnostics: incident.diagnostics.length,
    }),
    audit: Object.freeze({
      channel: state.boundaryHandoff.audit.channel ?? incident.audit.channel,
      required: state.boundaryHandoff.audit.required || incident.audit.required,
      status: state.boundaryHandoff.audit.status === "audit-ready" || incident.audit.status === "audit-ready"
        ? "audit-ready"
        : state.boundaryHandoff.audit.required || incident.audit.required
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    controls: Object.freeze({
      canHandoffParser: state.boundaryHandoff.status === "scoped" && !incident.blocked,
      canExportIncident: Boolean(state.boundaryHandoff.audit.channel ?? incident.audit.channel),
      canContinueDegraded: !lexerBlocked && incident.controls.canContinueDegraded,
    }),
    incident,
    nextAction: lexerBlocked
      ? state.boundaryHandoff.nextAction
      : incident.blocked
        ? incident.nextAction
        : "continue",
  });
}

function createLexerTenantBoundaryReadiness(state, tokenHealth, options) {
  const requiredPermissions = state.mailchimp.detected
    ? state.mailchimp.status === "handoff-needs-recovery-status"
      ? ["mailchimp.read", "mailchimp.write"]
      : ["mailchimp.read"]
    : [];
  const readiness = createTokenStreamTenantBoundaryReadiness(state.stream, {
    workspace: options.workspace,
    tenant: options.tenant,
    role: options.role,
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    requiredPermissions,
    expectedWorkspace: options.expectedWorkspace,
    expectedTenant: options.expectedTenant,
    expectedRole: options.expectedRole,
  });
  const lexerScopeReady = state.boundaryHandoff.status === "scoped";
  const tokenScopeReady = tokenHealth.tenantBoundaryReadiness?.accepted ?? readiness.accepted;
  const accepted = lexerScopeReady && tokenScopeReady;
  const missing = Object.freeze([
    lexerScopeReady ? null : state.boundaryHandoff.status,
    ...readiness.validationSummary.missing,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.tenant-boundary-readiness.v1",
    sourceId: state.sourceId,
    accepted,
    status: accepted
      ? "tenant-boundary-ready"
      : !lexerScopeReady
        ? state.boundaryHandoff.status
        : readiness.status,
    boundary: Object.freeze({
      workspace: state.boundaryHandoff.workspace,
      tenant: state.boundaryHandoff.tenant,
      role: state.boundaryHandoff.role,
      isolationKey: readiness.boundary.isolationKey,
    }),
    permissions: Object.freeze({
      required: readiness.permissions.required,
      granted: readiness.permissions.granted,
      missing: Object.freeze([
        ...readiness.permissions.missing,
        ...state.boundaryHandoff.mailchimpPermissionHints,
      ].filter((value, index, values) => values.indexOf(value) === index).sort()),
    }),
    audit: Object.freeze({
      channel: state.boundaryHandoff.audit.channel ?? readiness.audit.channel,
      required: state.boundaryHandoff.audit.required || readiness.audit.required,
      status: state.boundaryHandoff.audit.status === "audit-ready" || readiness.audit.status === "audit-ready"
        ? "audit-ready"
        : state.boundaryHandoff.audit.required || readiness.audit.required
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    tokenReadiness: readiness,
    validationSummary: Object.freeze({
      lexerScopeReady,
      tokenScopeReady,
      auditReady: state.boundaryHandoff.audit.status === "audit-ready" || readiness.validationSummary.auditReady,
      permissionsReady: readiness.validationSummary.permissionsReady && state.boundaryHandoff.mailchimpPermissionHints.length === 0,
      missing,
    }),
    controls: Object.freeze({
      canHandoffParser: accepted,
      canExportAudit: Boolean(state.boundaryHandoff.audit.channel ?? readiness.audit.channel),
      canContinueDegraded: accepted && tokenHealth.degradedMode?.enabled === true,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: accepted ? "lexer-tenant-boundary-ready" : "lexer-tenant-boundary-review",
      readinessId: readiness.readinessId,
      missing,
      nextAction: accepted
        ? "handoff-parser"
        : !lexerScopeReady
          ? state.boundaryHandoff.nextAction
          : readiness.nextAction,
    }),
    nextAction: accepted
      ? "handoff-parser"
      : !lexerScopeReady
        ? state.boundaryHandoff.nextAction
        : readiness.nextAction,
  });
}

function createLexerTimelineEvent(label, state, details = {}) {
  return Object.freeze({
    schema: "aios.lexer.timeline-event.v1",
    label,
    sourceId: state.sourceId,
    status: details.status ?? state.resume.status,
    tokenCount: state.health.tokenCount,
    diagnosticCount: state.diagnostics.length,
    cursor: state.stream.cursor,
    boundaryStatus: state.boundaryHandoff.status,
    operationalStatus: state.operationalHealth.status,
    mailchimpStatus: state.mailchimp.status,
    nextAction: details.nextAction ?? state.operationalHealth.nextAction,
  });
}

function createLexerAnalyticsExport(state, tokenHealth, options) {
  const diagnostics = Object.freeze(Array.from(state.diagnostics ?? []));
  const blocking = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const boundaryIncident = createLexerBoundaryIncidentSummary(state, tokenHealth, options);
  const tenantBoundaryReadiness = state.tenantBoundaryReadiness
    ?? createLexerTenantBoundaryReadiness(state, tokenHealth, options);
  const boundaryEscalation = createTokenStreamBoundaryEscalationPacket(state.stream, {
    ...options,
    health: tokenHealth,
    boundaryIncident: boundaryIncident.incident,
    tenantBoundaryReadiness: tenantBoundaryReadiness.tokenReadiness,
    permissions: state.boundaryHandoff.permissions,
    auditChannel: state.boundaryHandoff.audit.channel,
    requiredPermissions: state.mailchimp.detected
      ? state.mailchimp.status === "handoff-needs-recovery-status"
        ? ["mailchimp.read", "mailchimp.write"]
        : ["mailchimp.read"]
      : [],
    reason: "lexer-analytics-boundary-escalation",
  });
  const checkpoint = createTokenCheckpoint(state.stream, "lexer-analytics-export");
  const restartJournal = createTokenStreamRestartJournal(state.stream, {
    reason: "lexer-analytics-export",
    permissions: state.boundaryHandoff.permissions,
    auditChannel: state.boundaryHandoff.audit.channel,
    requiredPermissions: state.mailchimp.detected
      ? state.mailchimp.status === "handoff-needs-recovery-status"
        ? ["mailchimp.read", "mailchimp.write"]
        : ["mailchimp.read"]
      : [],
    entries: [
      Object.freeze({
        kind: "lexer-resume",
        cursor: state.resume.checkpoint.cursor,
        payload: Object.freeze({
          status: state.resume.status,
          retryable: state.resume.retryable,
          nextAction: state.resume.nextAction,
        }),
        status: state.resume.retryable || state.resume.status === "ready-for-parser"
          ? "recorded"
          : state.resume.status,
        nextAction: state.resume.nextAction,
      }),
      Object.freeze({
        kind: "mailchimp-preview",
        cursor: state.stream.cursor,
        payload: Object.freeze({
          detected: state.mailchimp.detected,
          status: state.mailchimpPreview.status,
          ready: state.mailchimpPreview.ready,
        }),
        status: state.mailchimp.detected ? state.mailchimpPreview.status : "not-required",
        nextAction: state.mailchimp.detected ? state.mailchimpPreview.nextAction : "continue",
      }),
    ],
  });
  const timeline = Object.freeze([
    createLexerTimelineEvent("lex", state, {
      status: state.health.ok ? "lexed" : "diagnostics",
      nextAction: state.health.ok ? "build-token-stream" : "surface-lexer-diagnostics",
    }),
    createLexerTimelineEvent("boundary", state, {
      status: boundaryIncident.status,
      nextAction: boundaryIncident.nextAction,
    }),
    createLexerTimelineEvent("tenant-boundary", state, {
      status: tenantBoundaryReadiness.status,
      nextAction: tenantBoundaryReadiness.nextAction,
    }),
    createLexerTimelineEvent("boundary-escalation", state, {
      status: boundaryEscalation.status,
      nextAction: boundaryEscalation.nextAction,
    }),
    createLexerTimelineEvent("token-health", state, {
      status: tokenHealth.status,
      nextAction: tokenHealth.nextAction,
    }),
    createLexerTimelineEvent("resume", state, {
      status: state.resume.status,
      nextAction: state.resume.nextAction,
    }),
  ]);

  return Object.freeze({
    schema: "aios.lexer.analytics-export.v1",
    sourceId: state.sourceId,
    ok: state.operationalHealth.ok && tokenHealth.ok && !boundaryIncident.blocked && tenantBoundaryReadiness.accepted && !boundaryEscalation.blocked,
    status: boundaryEscalation.blocked
      ? boundaryEscalation.status
      : !tenantBoundaryReadiness.accepted
      ? tenantBoundaryReadiness.status
      : boundaryIncident.blocked
      ? boundaryIncident.status
      : state.operationalHealth.blocked || !tokenHealth.ok
      ? "blocked"
      : state.operationalHealth.degraded || tokenHealth.status === "degraded"
        ? "degraded"
        : "ready",
    counters: Object.freeze({
      tokens: state.health.tokenCount,
      diagnostics: diagnostics.length,
      warnings: warnings.length,
      blocking: blocking.length,
      boundaryIncidents: boundaryIncident.blocked ? 1 : 0,
      boundaryEscalations: boundaryEscalation.blocked ? 1 : 0,
      tenantBoundaryReady: tenantBoundaryReadiness.accepted ? 1 : 0,
      byTokenType: countTokensByType(state.stream.tokens),
      byDiagnosticCode: countDiagnosticsByCode(diagnostics),
      boundary: boundaryIncident.counters,
    }),
    boundaryIncident,
    boundaryEscalation,
    tenantBoundaryReadiness,
    history: Object.freeze({
      checkpointCursor: checkpoint.cursor,
      restartSafe: checkpoint.restartSafe && restartJournal.validation.restartSafe && !boundaryIncident.blocked && !boundaryEscalation.blocked,
      restoreCommand: checkpoint.clientState.restoreCommand,
      tokenWindow: describeTokenWindow(state.stream, 3),
      timeline,
      restartJournal: restartJournal.exportSummary,
    }),
    restartJournal,
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      workspace: state.boundaryHandoff.workspace,
      tenant: state.boundaryHandoff.tenant,
      role: state.boundaryHandoff.role,
      status: restartJournal.validation.restartSafe ? state.operationalHealth.status : restartJournal.exportSummary.status,
      tokenHealth: tokenHealth.status,
      boundaryIncident: boundaryIncident.status,
      boundaryEscalation: boundaryEscalation.exportSummary.status,
      tenantBoundary: tenantBoundaryReadiness.status,
      mailchimp: state.mailchimp.status,
      previewAcceptance: state.mailchimpPreview.acceptance.status,
      restartJournal: restartJournal.exportSummary.status,
      nextAction: boundaryEscalation.blocked
        ? boundaryEscalation.nextAction
        : !tenantBoundaryReadiness.accepted
        ? tenantBoundaryReadiness.nextAction
        : boundaryIncident.blocked
        ? boundaryIncident.nextAction
        : restartJournal.validation.restartSafe
        ? tokenHealth.ok ? state.operationalHealth.nextAction : tokenHealth.nextAction
        : restartJournal.nextAction,
    }),
    nextAction: boundaryEscalation.blocked
      ? boundaryEscalation.nextAction
      : !tenantBoundaryReadiness.accepted
      ? tenantBoundaryReadiness.nextAction
      : boundaryIncident.blocked
      ? boundaryIncident.nextAction
      : restartJournal.validation.restartSafe
      ? tokenHealth.ok ? state.operationalHealth.nextAction : tokenHealth.nextAction
      : restartJournal.nextAction,
  });
}

function createLexerMailchimpPreview(state, options) {
  const service = createTokenStreamProviderServiceContract(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    requestedCapabilities: state.mailchimp.status === "handoff-needs-recovery-status"
      ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
      : ["audit", "checkpoint", "external-status", "provider-read"],
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    scheduledAt: options.scheduledAt,
    reason: "lexer-mailchimp-preview",
  });
  const validationSummary = Object.freeze({
    sourceComplete: state.resume.status !== "awaiting-complete-source",
    boundaryReady: state.boundaryHandoff.status === "scoped",
    tokenStreamReady: state.tokenHealth.ok,
    providerReady: service.negotiation.accepted,
    accepted: service.acceptance.accepted,
  });
  const ready = Object.values(validationSummary).every(Boolean);

  return Object.freeze({
    schema: "aios.lexer.mailchimp-preview.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-parser-handoff"
        : !validationSummary.sourceComplete
          ? "waiting-for-source"
          : !validationSummary.boundaryReady
            ? state.boundaryHandoff.status
            : !validationSummary.providerReady
              ? service.negotiation.status
              : service.acceptance.status,
    preview: Object.freeze({
      adapter: service.service.adapter,
      operation: service.service.operation,
      tokenWindow: service.preview.tokenWindow,
      requiredPermissions: service.preview.requiredPermissions,
      missingPermissions: service.preview.missingPermissions,
      statusChannel: service.acceptance.statusChannel,
      audit: service.acceptance.audit,
      syncKey: service.sync.syncKey,
    }),
    validationSummary,
    acceptance: service.acceptance,
    controls: service.acceptance.controls,
    service,
    nextStep: Object.freeze({
      label: ready ? "Parser handoff" : service.acceptance.nextAction,
      action: ready
        ? "handoff-parser"
        : !validationSummary.sourceComplete
          ? "resume-editing"
          : !validationSummary.boundaryReady
            ? state.boundaryHandoff.nextAction
            : service.acceptance.nextAction,
      retryable: state.resume.retryable || service.acceptance.status === "awaiting-acceptance",
    }),
    nextAction: ready
      ? "handoff-parser"
      : !validationSummary.sourceComplete
        ? "resume-editing"
        : !validationSummary.boundaryReady
          ? state.boundaryHandoff.nextAction
          : service.acceptance.nextAction,
  });
}

function createLexerClientAdoptionState(state, options) {
  const readiness = createTokenStreamProviderReadinessPreview(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    requestedCapabilities: state.mailchimp.status === "handoff-needs-recovery-status"
      ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
      : ["audit", "checkpoint", "external-status", "provider-read"],
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    scheduledAt: options.scheduledAt,
    reason: "lexer-client-adoption",
  });
  const runtimeSnapshot = createTokenStreamClientRuntimeAdoptionSnapshot(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    requestedCapabilities: state.mailchimp.status === "handoff-needs-recovery-status"
      ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
      : ["audit", "checkpoint", "external-status", "provider-read"],
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    idempotencyKey: options.idempotencyKey,
    clientRoute: "lexer-mailchimp-client-adoption",
    reason: "lexer-client-runtime-adoption",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const previewReady = state.mailchimpPreview.ready;
  const adopted = state.mailchimp.detected
    && sourceReady
    && boundaryReady
    && readiness.accepted
    && previewReady
    && runtimeSnapshot.accepted;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-client-boundary",
    readiness.explanation.validationSummary.statusReady ? null : "external-status-channel",
    readiness.explanation.validationSummary.auditReady ? null : "audit-channel",
    readiness.explanation.validationSummary.capabilitiesAccepted ? null : "provider-capability-negotiation",
    readiness.explanation.validationSummary.previewAccepted ? null : "user-preview-acceptance",
    previewReady ? null : "mailchimp-preview-readiness",
    runtimeSnapshot.accepted ? null : runtimeSnapshot.exportSummary.missing[0] ?? "client-runtime-adoption",
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.client-adoption-state.v1",
    sourceId: state.sourceId,
    provider: readiness.provider,
    operation: readiness.operation,
    detected: state.mailchimp.detected,
    adopted,
    status: !state.mailchimp.detected
      ? "not-detected"
      : adopted
        ? "adopted"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-client-boundary")
            ? state.boundaryHandoff.status
            : readiness.status,
    missing,
    clientState: Object.freeze({
      sourceId: state.sourceId,
      workspace: state.boundaryHandoff.workspace,
      tenant: state.boundaryHandoff.tenant,
      role: state.boundaryHandoff.role,
      syncKey: readiness.sync.syncKey,
      routeId: runtimeSnapshot.sync.routeId,
      snapshotId: runtimeSnapshot.snapshotId,
      restoreCommand: state.resume.checkpoint.clientState.restoreCommand,
      statusChannel: readiness.sync.statusChannel,
      auditChannel: readiness.sync.auditChannel,
      executionIntentKey: runtimeSnapshot.sync.executionIntentKey,
      commandIds: runtimeSnapshot.persistedState.commandIds,
    }),
    readiness,
    runtimeSnapshot,
    runtimeHandoff: Object.freeze({
      accepted: adopted,
      status: adopted ? "ready-for-parser" : runtimeSnapshot.status,
      routeId: runtimeSnapshot.sync.routeId,
      snapshotId: runtimeSnapshot.snapshotId,
      restartSafe: runtimeSnapshot.persistedState.restartSafe,
      nextAction: adopted ? "handoff-parser" : runtimeSnapshot.nextAction,
    }),
    controls: Object.freeze({
      canPreview: state.mailchimp.detected && sourceReady,
      canAccept: readiness.serviceContract.acceptance.controls.canAccept && boundaryReady,
      canPersistRuntimeState: runtimeSnapshot.controls.canPersist,
      canReplayRuntimeAdoption: runtimeSnapshot.controls.canReplay,
      canHandoffParser: adopted,
      canResumeEditing: state.resume.retryable,
    }),
    nextAction: adopted
      ? "handoff-parser"
      : !state.mailchimp.detected
        ? "continue"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : runtimeSnapshot.accepted
              ? readiness.nextAction
              : runtimeSnapshot.nextAction,
  });
}

function createLexerPreviewAcceptanceHandoff(state, options) {
  const acceptanceSummary = createTokenStreamProviderAcceptanceSummary(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    requestedCapabilities: state.mailchimp.status === "handoff-needs-recovery-status"
      ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
      : ["audit", "checkpoint", "external-status", "provider-read"],
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    scheduledAt: options.scheduledAt,
    reason: "lexer-preview-acceptance-handoff",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const ready = state.mailchimp.detected
    && sourceReady
    && boundaryReady
    && acceptanceSummary.accepted
    && state.operationalHealth.ok;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    state.operationalHealth.ok ? null : "operational-health",
    ...acceptanceSummary.validationSummary.missing,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.preview-acceptance-handoff.v1",
    sourceId: state.sourceId,
    provider: acceptanceSummary.provider,
    operation: acceptanceSummary.operation,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : acceptanceSummary.status,
    boundary: Object.freeze({
      workspace: state.boundaryHandoff.workspace,
      tenant: state.boundaryHandoff.tenant,
      role: state.boundaryHandoff.role,
      status: state.boundaryHandoff.status,
    }),
    validationSummary: Object.freeze({
      sourceReady,
      boundaryReady,
      operationalReady: state.operationalHealth.ok,
      providerAccepted: acceptanceSummary.accepted,
      missing,
    }),
    acceptanceSummary,
    controls: Object.freeze({
      ...acceptanceSummary.controls,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable,
    }),
    nextStep: Object.freeze({
      label: ready ? "Parser handoff" : acceptanceSummary.explanation.nextStep.label,
      action: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !state.operationalHealth.ok
              ? state.operationalHealth.nextAction
              : acceptanceSummary.nextAction,
      retryable: state.resume.retryable || acceptanceSummary.explanation.nextStep.retryable,
      requiresOperator: acceptanceSummary.explanation.nextStep.requiresOperator,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !state.operationalHealth.ok
            ? state.operationalHealth.nextAction
            : acceptanceSummary.nextAction,
  });
}

function createLexerAdapterStatusHandoff(state, options) {
  const adapterStatus = createTokenStreamAdapterStatusPacket(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    requestedCapabilities: state.mailchimp.status === "handoff-needs-recovery-status"
      ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
      : ["audit", "checkpoint", "external-status", "provider-read"],
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    reason: "lexer-adapter-status-handoff",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const ready = state.mailchimp.detected
    && sourceReady
    && boundaryReady
    && adapterStatus.parserHandoff.accepted
    && state.operationalHealth.ok;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    state.operationalHealth.ok ? null : "operational-health",
    adapterStatus.parserHandoff.accepted ? null : adapterStatus.parserHandoff.blockedGate ?? "adapter-status",
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.adapter-status-handoff.v1",
    sourceId: state.sourceId,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : adapterStatus.status,
    missing,
    adapterStatus,
    parserHandoff: Object.freeze({
      accepted: ready,
      status: ready ? "ready-for-parser" : adapterStatus.parserHandoff.status,
      syncKey: adapterStatus.sync.syncKey,
      restoreCommand: adapterStatus.sync.restoreCommand,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !state.operationalHealth.ok
              ? state.operationalHealth.nextAction
              : adapterStatus.nextAction,
    }),
    controls: Object.freeze({
      canPreview: state.mailchimp.detected && sourceReady,
      canAccept: adapterStatus.acceptance.controls.canAccept && boundaryReady,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !state.operationalHealth.ok
            ? state.operationalHealth.nextAction
            : adapterStatus.nextAction,
  });
}

function createLexerRecoveryRunbook(state, options) {
  const resumeCommand = state.resume.checkpoint.clientState.restoreCommand;
  const auditReport = createTokenStreamCommandAuditReport(state.stream, [resumeCommand], {
    reason: "lexer-recovery-runbook",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    requiredPermissions: state.mailchimp.detected
      ? state.mailchimp.status === "handoff-needs-recovery-status"
        ? ["mailchimp.read", "mailchimp.write"]
        : ["mailchimp.read"]
      : [],
  });
  const sourceComplete = state.resume.status !== "awaiting-complete-source";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const healthReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const previewReady = !state.mailchimp.detected || state.mailchimpPreview.ready;
  const blockedReasons = Object.freeze([
    sourceComplete ? null : "complete-source",
    boundaryReady ? null : "scoped-boundary",
    healthReady ? null : "operational-health",
    auditReport.ok ? null : "command-audit",
    previewReady ? null : "mailchimp-preview",
  ].filter(Boolean));
  const ready = blockedReasons.length === 0;

  return Object.freeze({
    schema: "aios.lexer.recovery-runbook.v1",
    sourceId: state.sourceId,
    ready,
    status: ready
      ? "ready-for-parser"
      : blockedReasons.includes("complete-source")
        ? state.resume.status
        : blockedReasons.includes("scoped-boundary")
          ? state.boundaryHandoff.status
          : blockedReasons.includes("operational-health")
            ? state.operationalHealth.status
            : blockedReasons.includes("command-audit")
              ? auditReport.status
              : state.mailchimpPreview.status,
    blockedReasons,
    steps: Object.freeze([
      Object.freeze({
        schema: "aios.lexer.recovery-runbook.step.v1",
        label: "source",
        accepted: sourceComplete,
        status: state.resume.status,
        nextAction: sourceComplete ? "continue" : state.resume.nextAction,
      }),
      Object.freeze({
        schema: "aios.lexer.recovery-runbook.step.v1",
        label: "boundary",
        accepted: boundaryReady,
        status: state.boundaryHandoff.status,
        nextAction: boundaryReady ? "continue" : state.boundaryHandoff.nextAction,
      }),
      Object.freeze({
        schema: "aios.lexer.recovery-runbook.step.v1",
        label: "health",
        accepted: healthReady,
        status: state.operationalHealth.status,
        nextAction: healthReady ? "continue" : state.operationalHealth.nextAction,
      }),
      Object.freeze({
        schema: "aios.lexer.recovery-runbook.step.v1",
        label: "command-audit",
        accepted: auditReport.ok,
        status: auditReport.status,
        nextAction: auditReport.ok ? "continue" : auditReport.nextAction,
      }),
      Object.freeze({
        schema: "aios.lexer.recovery-runbook.step.v1",
        label: "mailchimp-preview",
        accepted: previewReady,
        status: state.mailchimpPreview.status,
        nextAction: previewReady ? "continue" : state.mailchimpPreview.nextAction,
      }),
    ]),
    checkpoint: Object.freeze({
      cursor: state.resume.checkpoint.cursor,
      restartSafe: state.resume.checkpoint.restartSafe,
      restoreCommand: resumeCommand,
    }),
    auditReport: auditReport.exportSummary,
    controls: Object.freeze({
      canResumeLexing: state.resume.retryable,
      canRestoreCursor: auditReport.controls.canApply,
      canHandoffParser: ready,
      canPreviewMailchimp: state.mailchimp.detected && sourceComplete,
    }),
    exportSummary: Object.freeze({
      status: ready ? "recovery-ready" : "recovery-review",
      blockedReasons,
      nextAction: ready
        ? "handoff-parser"
        : blockedReasons.includes("complete-source")
          ? state.resume.nextAction
          : blockedReasons.includes("scoped-boundary")
            ? state.boundaryHandoff.nextAction
            : blockedReasons.includes("command-audit")
              ? auditReport.nextAction
              : state.operationalHealth.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : blockedReasons.includes("complete-source")
        ? state.resume.nextAction
        : blockedReasons.includes("scoped-boundary")
          ? state.boundaryHandoff.nextAction
          : blockedReasons.includes("command-audit")
            ? auditReport.nextAction
            : state.operationalHealth.nextAction,
  });
}

function createLexerResumptionManifest(state, options) {
  const requestedCapabilities = state.mailchimp.status === "handoff-needs-recovery-status"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const requiredPermissions = state.mailchimp.detected
    ? state.mailchimp.status === "handoff-needs-recovery-status"
      ? ["mailchimp.read", "mailchimp.write"]
      : ["mailchimp.read"]
    : [];
  const manifest = createTokenStreamResumptionManifest(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities,
    requiredPermissions,
    clientHandoffPacket: state.clientHandoffPacket,
    reason: "lexer-resumption-manifest",
  });
  const statusEnvelope = createTokenStreamResumptionStatusEnvelope(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities,
    requiredPermissions,
    clientHandoffPacket: state.clientHandoffPacket,
    resumptionManifest: manifest,
    reason: "lexer-resumption-status",
  });
  const statusReconciliation = createTokenStreamRestartStatusReconciliation(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities,
    requiredPermissions,
    resumptionManifest: manifest,
    statusEnvelope,
    statusEvents: options.restartStatusEvents ?? [
      Object.freeze({
        channel: options.auditChannel,
        status: statusEnvelope.ready ? "resumption-status-ready" : statusEnvelope.phase,
        cursor: statusEnvelope.cursor.current,
        idempotencyKey: options.idempotencyKey,
      }),
      manifest.ready
        ? Object.freeze({
            channel: options.auditChannel,
            status: "resumption-ready",
            cursor: manifest.sync.checkpointCursor,
            idempotencyKey: options.idempotencyKey,
          })
        : null,
    ].filter(Boolean),
    reason: "lexer-restart-status-reconciliation",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const ready = sourceReady
    && boundaryReady
    && operationalReady
    && manifest.ready
    && statusEnvelope.ready
    && statusReconciliation.accepted;
  const missing = Object.freeze([
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    manifest.ready ? null : manifest.exportSummary.firstBlocked ?? "resumption-manifest",
    statusEnvelope.ready ? null : statusEnvelope.exportSummary.firstMissing ?? "resumption-status",
    statusReconciliation.accepted ? null : statusReconciliation.exportSummary.firstMissing ?? "restart-status-reconciliation",
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.resumption-manifest-state.v1",
    sourceId: state.sourceId,
    ready,
    status: ready
      ? "ready-for-parser"
      : missing.includes("parser-ready-source")
        ? state.resume.status
        : missing.includes("scoped-boundary")
          ? state.boundaryHandoff.status
          : missing.includes("operational-health")
            ? state.operationalHealth.status
            : manifest.status,
    missing,
    manifest,
    statusEnvelope,
    statusReconciliation,
    parserHandoff: Object.freeze({
      accepted: ready,
      manifestId: manifest.manifestId,
      envelopeId: statusEnvelope.envelopeId,
      reconciliationId: statusReconciliation.reconciliationId,
      restoreCommand: manifest.sync.restoreCommand,
      statusChannel: manifest.sync.statusChannel,
      auditChannel: manifest.sync.auditChannel,
      phase: statusEnvelope.phase,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : manifest.nextAction,
    }),
    controls: Object.freeze({
      canResume: manifest.controls.canResume && sourceReady && statusReconciliation.controls.canResume,
      canReplayRestore: manifest.controls.canReplayRestore && statusEnvelope.controls.canReplay && statusReconciliation.controls.canReplay,
      canExportAudit: manifest.controls.canExportAudit,
      canHandoffParser: ready,
      canEmitStatus: statusEnvelope.controls.canEmitStatus,
      canReconcileStatus: statusReconciliation.controls.canAcceptObservedStatus,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "lexer-resumption-ready" : "lexer-resumption-review",
      manifestId: manifest.manifestId,
      envelopeId: statusEnvelope.envelopeId,
      reconciliationId: statusReconciliation.reconciliationId,
      phase: statusEnvelope.phase,
      firstBlocked: manifest.exportSummary.firstBlocked,
      restartStatus: statusReconciliation.exportSummary.status,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : statusReconciliation.accepted ? manifest.nextAction : statusReconciliation.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : statusReconciliation.accepted ? manifest.nextAction : statusReconciliation.nextAction,
  });
}

function createLexerMailchimpWorkflowHandoff(state, options) {
  const workflow = createTokenStreamMailchimpWorkflowSession(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities: state.mailchimp.status === "handoff-needs-recovery-status"
      ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
      : ["audit", "checkpoint", "external-status", "provider-read"],
    reason: "lexer-mailchimp-workflow-handoff",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const ready = state.mailchimp.detected && sourceReady && boundaryReady && workflow.ready;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    workflow.ready ? null : "mailchimp-workflow-session",
    ...workflow.validationSummary.missing,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.mailchimp-workflow-handoff.v1",
    sourceId: state.sourceId,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : workflow.status,
    missing,
    workflow,
    parserHandoff: Object.freeze({
      accepted: ready,
      syncKey: workflow.sync.syncKey,
      restoreCommand: workflow.sync.restoreCommand,
      statusChannel: workflow.sync.statusChannel,
      auditChannel: workflow.sync.auditChannel,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : workflow.nextAction,
    }),
    controls: Object.freeze({
      canPreview: workflow.controls.canPreview && sourceReady,
      canAccept: workflow.controls.canAccept && boundaryReady,
      canReplayRestore: workflow.controls.canReplayRestore,
      canHandoffParser: ready,
      canHandoffClient: ready && workflow.controls.canHandoffClient,
      canResumeEditing: state.resume.retryable,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : workflow.nextAction,
  });
}

function createLexerHandoffEvidenceState(state, options) {
  const requestedCapabilities = state.mailchimp.status === "handoff-needs-recovery-status"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const evidence = createTokenStreamHandoffEvidencePacket(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities,
    reason: "lexer-handoff-evidence",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const ready = state.mailchimp.detected && sourceReady && boundaryReady && evidence.accepted;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    evidence.accepted ? null : evidence.blocker?.label ?? "handoff-evidence",
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.handoff-evidence-state.v1",
    sourceId: state.sourceId,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : evidence.status,
    missing,
    evidence,
    parserHandoff: Object.freeze({
      accepted: ready,
      evidenceId: evidence.evidenceId,
      syncKey: evidence.sync.syncKey,
      statusChannel: evidence.sync.statusChannel,
      auditChannel: evidence.sync.auditChannel,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : evidence.nextAction,
    }),
    controls: Object.freeze({
      canPublishEvidence: evidence.controls.canPublishEvidence && boundaryReady,
      canRetryFromCheckpoint: evidence.controls.canRetryFromCheckpoint,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "handoff-evidence-ready" : evidence.exportSummary.status,
      evidenceId: evidence.evidenceId,
      syncKey: evidence.sync.syncKey,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : evidence.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : evidence.nextAction,
  });
}

function createLexerMailchimpHandoffDecision(state, options) {
  const requestedCapabilities = state.mailchimp.status === "handoff-needs-recovery-status"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const decision = createTokenStreamMailchimpHandoffDecision(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities,
    workflowSession: state.mailchimpWorkflowHandoff.workflow,
    handoffEvidence: state.handoffEvidence.evidence,
    reason: "lexer-mailchimp-handoff-decision",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const ready = state.mailchimp.detected
    && sourceReady
    && boundaryReady
    && operationalReady
    && decision.accepted;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    decision.accepted ? null : decision.exportSummary.blockedGate ?? "mailchimp-handoff-decision",
    ...decision.validationSummary.missing,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.mailchimp-handoff-decision-state.v1",
    sourceId: state.sourceId,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-client-handoff"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : decision.status,
    missing,
    decision,
    parserHandoff: Object.freeze({
      accepted: ready,
      decisionId: decision.decisionId,
      evidenceId: decision.sync.evidenceId,
      syncKey: decision.sync.syncKey,
      restoreCommand: decision.sync.restoreCommand,
      statusChannel: decision.sync.statusChannel,
      auditChannel: decision.sync.auditChannel,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : decision.nextAction,
    }),
    controls: Object.freeze({
      canPreview: decision.controls.canPreview && sourceReady,
      canAccept: decision.controls.canAccept && boundaryReady,
      canPersist: decision.controls.canPersist && operationalReady,
      canReplayRestore: decision.controls.canReplayRestore,
      canPublishEvidence: decision.controls.canPublishEvidence && boundaryReady,
      canHandoffParser: ready,
      canHandoffClient: ready && decision.controls.canHandoffClient,
      canResumeEditing: state.resume.retryable,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "mailchimp-handoff-ready" : decision.exportSummary.status,
      decisionId: decision.decisionId,
      evidenceId: decision.sync.evidenceId,
      syncKey: decision.sync.syncKey,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : decision.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : decision.nextAction,
  });
}

function createLexerExternalStatusReceiptState(state, options) {
  const requestedCapabilities = state.mailchimp.status === "handoff-needs-recovery-status"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const receipt = createTokenStreamExternalProviderStatusReceipt(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" || options.allowMutatingMailchimpSync
      ? "syncAudience"
      : "fetchAudience",
    permissions: options.permissions,
    requiredPermissions: state.mailchimp.detected
      ? state.mailchimp.status === "handoff-needs-recovery-status"
        ? ["mailchimp.read", "mailchimp.write"]
        : ["mailchimp.read"]
      : [],
    requestedCapabilities,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    idempotencyKey: options.idempotencyKey,
    handoffReceipt: state.clientHandoffPacket?.handoffReceipt,
    statusEvents: options.externalStatusEvents ?? [
      state.mailchimpHandoffDecision?.ready
        ? Object.freeze({
            channel: options.auditChannel,
            status: "mailchimp-handoff-decision-ready",
            cursor: state.stream.cursor,
            idempotencyKey: options.idempotencyKey,
            payload: Object.freeze({
              decisionId: state.mailchimpHandoffDecision.parserHandoff.decisionId,
              syncKey: state.mailchimpHandoffDecision.parserHandoff.syncKey,
            }),
            observed: true,
            acknowledged: false,
          })
        : null,
    ].filter(Boolean),
    reason: "lexer-external-status-receipt",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const ready = state.mailchimp.detected
    && sourceReady
    && boundaryReady
    && operationalReady
    && receipt.accepted;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    receipt.accepted ? null : receipt.validationSummary.missing[0] ?? "external-status-receipt",
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.external-status-receipt-state.v1",
    sourceId: state.sourceId,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : receipt.status,
    missing,
    receipt,
    parserHandoff: Object.freeze({
      accepted: ready,
      receiptId: receipt.receiptId,
      providerReceiptId: receipt.providerReceiptId,
      syncKey: receipt.sync.syncKey,
      statusChannel: receipt.channels.status,
      auditChannel: receipt.channels.audit,
      restoreCommand: receipt.sync.restoreCommand,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : receipt.nextAction,
    }),
    controls: Object.freeze({
      canEmitStatus: receipt.controls.canEmitStatus && boundaryReady,
      canReplayStatus: receipt.controls.canReplayStatus && operationalReady,
      canAcknowledgeReceipt: receipt.controls.canAcknowledgeReceipt,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "external-status-receipt-ready" : receipt.exportSummary.status,
      receiptId: receipt.receiptId,
      eventCount: receipt.counters.total,
      pendingCount: receipt.counters.pending,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : receipt.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : receipt.nextAction,
  });
}

function createLexerNextActionQueue(state, options) {
  const queue = createTokenStreamNextActionQueue(state.stream, [
    Object.freeze({
      source: "lexer-resume",
      status: state.resume.status,
      ready: state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream",
      retryable: state.resume.retryable,
      nextAction: state.resume.nextAction,
      cursor: state.resume.checkpoint.cursor,
      audit: state.boundaryHandoff.audit,
    }),
    Object.freeze({
      source: "lexer-boundary-handoff",
      status: state.boundaryHandoff.status,
      ready: state.boundaryHandoff.status === "scoped",
      blocked: state.boundaryHandoff.status === "blocked-boundary",
      nextAction: state.boundaryHandoff.nextAction,
      audit: state.boundaryHandoff.audit,
    }),
    Object.freeze({
      source: "lexer-operational-health",
      status: state.operationalHealth.status,
      ok: state.operationalHealth.ok,
      blocked: state.operationalHealth.blocked,
      retryable: state.operationalHealth.retry.maxAttempts > 0,
      nextAction: state.operationalHealth.nextAction,
      audit: state.operationalHealth.audit,
    }),
    Object.freeze({
      source: "mailchimp-preview",
      status: state.mailchimpPreview.status,
      ready: state.mailchimpPreview.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpPreview.ready,
      retryable: state.mailchimpPreview.nextStep.retryable,
      nextAction: state.mailchimpPreview.nextAction,
      audit: state.mailchimpPreview.acceptance.audit,
    }),
    Object.freeze({
      source: "mailchimp-workflow-handoff",
      status: state.mailchimpWorkflowHandoff.status,
      ready: state.mailchimpWorkflowHandoff.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpWorkflowHandoff.ready,
      nextAction: state.mailchimpWorkflowHandoff.nextAction,
      audit: Object.freeze({
        channel: state.mailchimpWorkflowHandoff.parserHandoff.auditChannel,
      }),
    }),
    Object.freeze({
      source: "handoff-evidence",
      status: state.handoffEvidence.status,
      ready: state.handoffEvidence.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.handoffEvidence.ready,
      retryable: state.handoffEvidence.controls.canRetryFromCheckpoint,
      nextAction: state.handoffEvidence.nextAction,
      audit: Object.freeze({
        channel: state.handoffEvidence.parserHandoff.auditChannel,
      }),
    }),
    Object.freeze({
      source: "mailchimp-handoff-decision",
      status: state.mailchimpHandoffDecision.status,
      ready: state.mailchimpHandoffDecision.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpHandoffDecision.ready,
      retryable: state.mailchimpHandoffDecision.controls.canReplayRestore,
      nextAction: state.mailchimpHandoffDecision.nextAction,
      audit: Object.freeze({
        channel: state.mailchimpHandoffDecision.parserHandoff.auditChannel,
      }),
    }),
    Object.freeze({
      source: "client-handoff-packet",
      status: state.clientHandoffPacket.status,
      ready: state.clientHandoffPacket.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.clientHandoffPacket.ready,
      retryable: state.clientHandoffPacket.routeContract.retryable,
      nextAction: state.clientHandoffPacket.nextAction,
      audit: Object.freeze({
        channel: state.clientHandoffPacket.sync.auditChannel,
      }),
    }),
  ], {
    ...options,
    reason: "lexer-next-action-queue",
    requiredPermissions: state.mailchimp.detected
      ? state.mailchimp.status === "handoff-needs-recovery-status"
        ? ["mailchimp.read", "mailchimp.write"]
        : ["mailchimp.read"]
      : [],
  });

  return Object.freeze({
    schema: "aios.lexer.next-action-queue.v1",
    sourceId: state.sourceId,
    ready: queue.ready && state.operationalHealth.ok,
    status: queue.ready && state.operationalHealth.ok ? "ready-for-parser" : queue.status,
    queue,
    parserHandoff: Object.freeze({
      accepted: queue.ready && state.operationalHealth.ok,
      restoreCommand: queue.checkpoint.restoreCommand,
      nextAction: queue.ready && state.operationalHealth.ok ? "handoff-parser" : queue.nextAction,
    }),
    controls: Object.freeze({
      ...queue.controls,
      canHandoffParser: queue.ready && state.operationalHealth.ok,
      canResumeEditing: state.resume.retryable,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: queue.ready && state.operationalHealth.ok ? "lexer-next-action-ready" : queue.exportSummary.status,
      blockedCount: queue.counters.blocked,
      retryableCount: queue.counters.retryable,
      nextAction: queue.ready && state.operationalHealth.ok ? "handoff-parser" : queue.nextAction,
    }),
    nextAction: queue.ready && state.operationalHealth.ok ? "handoff-parser" : queue.nextAction,
  });
}

function createLexerProviderExportReadiness(state, options) {
  const requestedCapabilities = state.mailchimp.status === "handoff-needs-recovery-status"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const manifest = createTokenStreamExportReadinessManifest(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities,
    mailchimpReadinessLedger: state.mailchimpHandoffDecision.decision?.ledger ?? null,
    reason: "lexer-provider-export-readiness",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const ready = (!state.mailchimp.detected || manifest.ready)
    && sourceReady
    && boundaryReady
    && operationalReady;
  const missing = Object.freeze([
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    state.mailchimp.detected && !manifest.ready ? manifest.exportSummary.firstBlocked ?? "export-readiness" : null,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.provider-export-readiness.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-required"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : manifest.status,
    missing,
    manifest,
    parserHandoff: Object.freeze({
      accepted: ready,
      manifestId: manifest.manifestId,
      statusChannel: manifest.sync.statusChannel,
      auditChannel: manifest.sync.auditChannel,
      restartJournalId: manifest.sync.restartJournalId,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : manifest.nextAction,
    }),
    controls: Object.freeze({
      canExport: manifest.controls.canExport && sourceReady && boundaryReady,
      canReplayRestart: manifest.controls.canReplayRestart,
      canEmitStatus: manifest.controls.canEmitStatus,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "lexer-export-readiness-ready" : manifest.exportSummary.status,
      manifestId: manifest.manifestId,
      firstBlocked: manifest.exportSummary.firstBlocked,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : manifest.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : manifest.nextAction,
  });
}

function createLexerProviderLifecycleState(state, options) {
  const requestedCapabilities = state.mailchimp.status === "handoff-needs-recovery-status"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const manifest = createTokenStreamProviderLifecycleManifest(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    lifecycleEnabled: options.mailchimpEnabled ?? true,
    lifecycleSchedule: options.lifecycleSchedule ?? (options.scheduledAt ? "manual" : "immediate"),
    lifecycleMode: state.resume.status === "degraded-token-stream" ? "degraded" : "recover",
    scheduledAt: options.scheduledAt,
    requestedCapabilities,
    exportReadinessManifest: state.providerExportReadiness.manifest,
    restartJournal: state.analyticsExport.restartJournal,
    reason: "lexer-provider-lifecycle-state",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const ready = (!state.mailchimp.detected || manifest.accepted)
    && sourceReady
    && boundaryReady
    && operationalReady;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    state.mailchimp.detected && !manifest.accepted ? manifest.exportSummary.blocked ?? "provider-lifecycle" : null,
    ...manifest.validationSummary.missing,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.provider-lifecycle-state.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-required"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : manifest.status,
    missing,
    manifest,
    validationSummary: Object.freeze({
      sourceReady,
      boundaryReady,
      operationalReady,
      lifecycleAccepted: manifest.accepted,
      schedule: manifest.settings.schedule,
      missing,
    }),
    parserHandoff: Object.freeze({
      accepted: ready,
      manifestId: manifest.manifestId,
      syncKey: manifest.sync.syncKey,
      statusChannel: manifest.sync.statusChannel,
      auditChannel: manifest.sync.auditChannel,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : manifest.nextAction,
    }),
    controls: Object.freeze({
      canEnable: manifest.controls.canEnable,
      canDisable: manifest.controls.canDisable,
      canPreview: manifest.controls.canPreview && sourceReady,
      canAcceptPreview: manifest.controls.canAcceptPreview && boundaryReady,
      canRunNow: manifest.controls.canRunNow && operationalReady,
      canSchedule: manifest.controls.canSchedule,
      canResume: manifest.controls.canResume,
      canHandoffParser: ready,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "lexer-provider-lifecycle-ready" : manifest.exportSummary.status,
      manifestId: manifest.manifestId,
      schedule: manifest.settings.schedule,
      blocked: manifest.exportSummary.blocked,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : manifest.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : manifest.nextAction,
  });
}

function createLexerMailchimpExportLedgerState(state, options) {
  const operation = state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience";
  const requestedCapabilities = operation === "syncAudience"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const ledger = createTokenStreamMailchimpExportLedger(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? `mailchimp.${operation}` : options.expectedAdapter,
    provider: "mailchimp",
    operation,
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities,
    exportReadinessManifest: state.providerExportReadiness.manifest,
    reason: "lexer-mailchimp-export-ledger",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const ready = (!state.mailchimp.detected || ledger.accepted)
    && sourceReady
    && boundaryReady
    && operationalReady;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    state.mailchimp.detected && !ledger.accepted ? ledger.exportSummary.blockedGate ?? "mailchimp-export-ledger" : null,
    ...ledger.missing,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.mailchimp-export-ledger-state.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-required"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : ledger.status,
    missing,
    ledger,
    validationSummary: Object.freeze({
      sourceReady,
      boundaryReady,
      operationalReady,
      ledgerAccepted: ledger.accepted,
      statusReady: ledger.readiness.statusReady,
      auditReady: ledger.readiness.auditReady,
      missing,
    }),
    parserHandoff: Object.freeze({
      accepted: ready,
      ledgerId: ledger.ledgerId,
      syncKey: ledger.sync.syncKey,
      manifestId: ledger.sync.manifestId,
      statusChannel: ledger.sync.statusChannel,
      auditChannel: ledger.sync.auditChannel,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : ledger.nextAction,
    }),
    controls: Object.freeze({
      canPreview: ledger.controls.canPreview && sourceReady,
      canAccept: ledger.controls.canAccept && boundaryReady,
      canSchedule: ledger.controls.canSchedule,
      canExportLedger: ledger.controls.canExportLedger,
      canReplayRestart: ledger.controls.canReplayRestart,
      canHandoffParser: ready,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "lexer-mailchimp-export-ledger-ready" : ledger.exportSummary.status,
      ledgerId: ledger.ledgerId,
      manifestId: ledger.sync.manifestId,
      blockedGate: ledger.exportSummary.blockedGate,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : ledger.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : ledger.nextAction,
  });
}

function createLexerClientHandoffPacket(state, options) {
  const requestedCapabilities = state.mailchimp.status === "handoff-needs-recovery-status"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const packet = createTokenStreamClientHandoffPacket(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities,
    adapterStatus: state.adapterStatusHandoff.adapterStatus,
    handoffEvidence: state.handoffEvidence.evidence,
    mailchimpDecision: state.mailchimpHandoffDecision.decision,
    reason: "lexer-client-handoff-packet",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const ready = state.mailchimp.detected
    && sourceReady
    && boundaryReady
    && operationalReady
    && packet.ready;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    packet.ready ? null : packet.exportSummary.blockedGate ?? "client-handoff-packet",
    ...packet.validationSummary.missing,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.client-handoff-packet-state.v1",
    sourceId: state.sourceId,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : packet.status,
    missing,
    sync: packet.sync,
    routeContract: packet.routeContract,
    validationSummary: packet.validationSummary,
    packet,
    parserHandoff: Object.freeze({
      accepted: ready,
      syncKey: packet.sync.syncKey,
      evidenceId: packet.sync.evidenceId,
      decisionId: packet.sync.decisionId,
      restoreCommand: packet.sync.restoreCommand,
      statusChannel: packet.sync.statusChannel,
      auditChannel: packet.sync.auditChannel,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : packet.nextAction,
    }),
    controls: Object.freeze({
      canPreview: packet.controls.canPreview && sourceReady,
      canAccept: packet.controls.canAccept && boundaryReady,
      canPublishEvidence: packet.controls.canPublishEvidence,
      canRestoreCheckpoint: packet.controls.canRestoreCheckpoint,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "client-handoff-ready" : packet.exportSummary.status,
      syncKey: packet.sync.syncKey,
      blockedGate: packet.exportSummary.blockedGate,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : packet.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : packet.nextAction,
  });
}

function createLexerOperationalPacket(state, options) {
  const packet = createTokenStreamOperationsPacket(state.stream, [
    Object.freeze({
      source: "lexer-resume",
      status: state.resume.status,
      accepted: state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream",
      blocked: state.resume.status === "blocked" || state.resume.status === "awaiting-complete-source",
      retryable: state.resume.retryable,
      nextAction: state.resume.nextAction,
      cursor: state.resume.checkpoint.cursor,
      audit: state.boundaryHandoff.audit,
      references: Object.freeze({
        checkpointCursor: state.resume.checkpoint.cursor,
        restoreCommandId: state.resume.checkpoint.clientState.restoreCommand.id,
      }),
    }),
    Object.freeze({
      source: "lexer-boundary",
      status: state.boundaryHandoff.status,
      accepted: state.boundaryHandoff.status === "scoped",
      blocked: state.boundaryHandoff.status === "blocked-boundary",
      nextAction: state.boundaryHandoff.nextAction,
      audit: state.boundaryHandoff.audit,
      references: Object.freeze({
        workspace: state.boundaryHandoff.workspace,
        tenant: state.boundaryHandoff.tenant,
        role: state.boundaryHandoff.role,
      }),
    }),
    Object.freeze({
      source: "lexer-operational-health",
      status: state.operationalHealth.status,
      accepted: state.operationalHealth.ok,
      blocked: state.operationalHealth.blocked,
      retryable: state.operationalHealth.retry.maxAttempts > 0,
      nextAction: state.operationalHealth.nextAction,
      audit: state.operationalHealth.audit,
      references: Object.freeze({
        blockingCount: state.operationalHealth.blockingCount,
        warningCount: state.operationalHealth.warningCount,
      }),
    }),
    Object.freeze({
      source: "mailchimp-audience-sync",
      status: state.mailchimpAudienceSync.status,
      accepted: state.mailchimpAudienceSync.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpAudienceSync.ready,
      retryable: state.mailchimpAudienceSync.controls.canReplayRestore,
      nextAction: state.mailchimpAudienceSync.nextAction,
      audit: Object.freeze({
        channel: state.mailchimpAudienceSync.parserHandoff.auditChannel,
      }),
      references: Object.freeze({
        audienceId: state.mailchimpAudienceSync.audience.audienceId,
        segmentId: state.mailchimpAudienceSync.audience.segmentId,
        syncKey: state.mailchimpAudienceSync.parserHandoff.syncKey,
      }),
    }),
    Object.freeze({
      source: "mailchimp-recovery-envelope",
      status: state.mailchimpRecoveryEnvelope.status,
      accepted: state.mailchimpRecoveryEnvelope.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpRecoveryEnvelope.ready,
      retryable: state.mailchimpRecoveryEnvelope.controls.canRetryAutomatically,
      nextAction: state.mailchimpRecoveryEnvelope.nextAction,
      audit: Object.freeze({
        channel: state.mailchimpRecoveryEnvelope.parserHandoff.auditChannel,
      }),
      references: Object.freeze({
        envelopeId: state.mailchimpRecoveryEnvelope.parserHandoff.envelopeId,
        syncKey: state.mailchimpRecoveryEnvelope.parserHandoff.syncKey,
        replaySafe: state.mailchimpRecoveryEnvelope.validationSummary.replaySafe,
      }),
    }),
    Object.freeze({
      source: "provider-lifecycle",
      status: state.providerLifecycle.status,
      accepted: state.providerLifecycle.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.providerLifecycle.ready,
      nextAction: state.providerLifecycle.nextAction,
      audit: Object.freeze({
        channel: state.providerLifecycle.parserHandoff.auditChannel,
      }),
      references: Object.freeze({
        manifestId: state.providerLifecycle.parserHandoff.manifestId,
        schedule: state.providerLifecycle.validationSummary.schedule,
      }),
    }),
    Object.freeze({
      source: "mailchimp-export-ledger",
      status: state.mailchimpExportLedger.status,
      accepted: state.mailchimpExportLedger.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpExportLedger.ready,
      retryable: state.mailchimpExportLedger.controls.canReplayRestart,
      nextAction: state.mailchimpExportLedger.nextAction,
      audit: Object.freeze({
        channel: state.mailchimpExportLedger.parserHandoff.auditChannel,
      }),
      references: Object.freeze({
        ledgerId: state.mailchimpExportLedger.parserHandoff.ledgerId,
        manifestId: state.mailchimpExportLedger.parserHandoff.manifestId,
      }),
    }),
  ], {
    ...options,
    reason: "lexer-operational-packet",
    requiredPermissions: state.mailchimp.detected
      ? state.mailchimp.status === "handoff-needs-recovery-status"
        ? ["mailchimp.read", "mailchimp.write"]
        : ["mailchimp.read"]
      : [],
    health: state.tokenHealth,
    analytics: state.analyticsExport,
    restartJournal: state.analyticsExport.restartJournal,
    nextActionQueue: state.nextActionQueue.queue,
  });
  const ready = packet.ready
    && state.operationalHealth.ok
    && state.nextActionQueue.parserHandoff.accepted
    && (!state.mailchimp.detected || (state.mailchimpExportLedger.ready && state.mailchimpAudienceSync.ready && state.mailchimpRecoveryEnvelope.ready));

  return Object.freeze({
    schema: "aios.lexer.operational-packet.v1",
    sourceId: state.sourceId,
    ready,
    status: ready
      ? "lexer-operations-ready"
      : packet.status,
    packet,
    parserHandoff: Object.freeze({
      accepted: ready,
      restoreCommand: packet.recovery.restoreCommand,
      auditStatus: packet.audit.status,
      nextAction: ready ? "handoff-parser" : packet.nextAction,
    }),
    controls: Object.freeze({
      canHandoffParser: ready,
      canRetry: packet.counters.retryable > 0 && state.resume.retryable,
      canExportAudit: packet.audit.channels.length > 0,
      canContinueDegraded: state.operationalHealth.degraded && packet.counters.blocked === 0
        || state.mailchimpRecoveryEnvelope.controls.canRunDegraded,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      packetId: packet.packetId,
      status: ready ? "lexer-operations-ready" : packet.exportSummary.status,
      firstBlocked: packet.exportSummary.firstBlocked,
      blockedCount: packet.counters.blocked,
      nextAction: ready ? "handoff-parser" : packet.nextAction,
    }),
    nextAction: ready ? "handoff-parser" : packet.nextAction,
  });
}

function createLexerOperatorDecisionLane(state, options) {
  const lane = createTokenStreamOperatorDecisionLane(state.stream, [
    Object.freeze({
      source: "lexer-operational-packet",
      status: state.operationalPacket.status,
      accepted: state.operationalPacket.ready,
      blocked: !state.operationalPacket.ready,
      retryable: state.operationalPacket.controls.canRetry,
      nextAction: state.operationalPacket.nextAction,
      audit: Object.freeze({
        channel: state.operationalPacket.parserHandoff.auditStatus === "audit-ready"
          ? options.auditChannel
          : null,
      }),
    }),
    Object.freeze({
      source: "mailchimp-audience-sync",
      status: state.mailchimpAudienceSync.status,
      accepted: state.mailchimpAudienceSync.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpAudienceSync.ready,
      retryable: state.mailchimpAudienceSync.controls.canResumeEditing,
      nextAction: state.mailchimpAudienceSync.nextAction,
      audit: Object.freeze({
        channel: state.mailchimpAudienceSync.parserHandoff.auditChannel,
      }),
    }),
    Object.freeze({
      source: "mailchimp-recovery-envelope",
      status: state.mailchimpRecoveryEnvelope.status,
      accepted: state.mailchimpRecoveryEnvelope.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpRecoveryEnvelope.ready,
      retryable: state.mailchimpRecoveryEnvelope.controls.canRetryAutomatically,
      nextAction: state.mailchimpRecoveryEnvelope.nextAction,
      audit: Object.freeze({
        channel: state.mailchimpRecoveryEnvelope.parserHandoff.auditChannel,
      }),
    }),
    Object.freeze({
      source: "provider-lifecycle",
      status: state.providerLifecycle.status,
      accepted: state.providerLifecycle.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.providerLifecycle.ready,
      retryable: state.providerLifecycle.controls.canResume,
      nextAction: state.providerLifecycle.nextAction,
      audit: Object.freeze({
        channel: state.providerLifecycle.parserHandoff.auditChannel,
      }),
    }),
    Object.freeze({
      source: "mailchimp-export-ledger",
      status: state.mailchimpExportLedger.status,
      accepted: state.mailchimpExportLedger.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpExportLedger.ready,
      retryable: state.mailchimpExportLedger.controls.canReplayRestart,
      nextAction: state.mailchimpExportLedger.nextAction,
      audit: Object.freeze({
        channel: state.mailchimpExportLedger.parserHandoff.auditChannel,
      }),
    }),
    Object.freeze({
      source: "client-handoff-packet",
      status: state.clientHandoffPacket.status,
      accepted: state.clientHandoffPacket.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.clientHandoffPacket.ready,
      retryable: state.clientHandoffPacket.routeContract.retryable,
      nextAction: state.clientHandoffPacket.nextAction,
      audit: Object.freeze({
        channel: state.clientHandoffPacket.parserHandoff.auditChannel,
      }),
    }),
    state.clientWorkflowStatus
      ? Object.freeze({
          source: "client-workflow-status",
          status: state.clientWorkflowStatus.status,
          accepted: state.clientWorkflowStatus.ready || !state.mailchimp.detected,
          blocked: state.mailchimp.detected && !state.clientWorkflowStatus.ready,
          retryable: state.clientWorkflowStatus.controls.canReplayRestore,
          nextAction: state.clientWorkflowStatus.nextAction,
          audit: Object.freeze({
            channel: state.clientWorkflowStatus.parserHandoff.auditChannel,
          }),
        })
      : null,
    Object.freeze({
      source: "lexer-next-action-queue",
      status: state.nextActionQueue.status,
      accepted: state.nextActionQueue.parserHandoff.accepted,
      blocked: !state.nextActionQueue.parserHandoff.accepted,
      retryable: state.nextActionQueue.queue.counters.retryable > 0,
      nextAction: state.nextActionQueue.nextAction,
      audit: Object.freeze({
        channel: state.nextActionQueue.queue.items.find((item) => item.auditChannel)?.auditChannel ?? null,
      }),
    }),
  ].filter(Boolean), {
    ...options,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    mode: state.mailchimpAudienceSync.audienceSync?.schedule?.mode === "scheduled" ? "schedule" : "acceptance",
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    statusChannel: options.auditChannel,
    auditChannel: options.auditChannel,
    scheduledAt: options.scheduledAt,
    nextActionQueue: state.nextActionQueue.queue,
    reason: "lexer-operator-decision-lane",
  });
  const ready = state.operationalPacket.ready
    && lane.ready
    && (!state.mailchimp.detected || (state.mailchimpExportLedger.ready && state.mailchimpAudienceSync.ready && state.mailchimpRecoveryEnvelope.ready));

  return Object.freeze({
    schema: "aios.lexer.operator-decision-lane.v1",
    sourceId: state.sourceId,
    ready,
    status: ready ? "ready-for-parser" : lane.status,
    mode: lane.mode,
    lane,
    parserHandoff: Object.freeze({
      accepted: ready,
      commandId: lane.decision.commandId,
      statusChannel: lane.decision.sync.statusChannel,
      auditChannel: lane.decision.sync.auditChannel,
      nextAction: ready ? "handoff-parser" : lane.nextAction,
    }),
    controls: Object.freeze({
      ...lane.controls,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable || lane.controls.canRetry,
      canRunAudienceSync: ready && state.mailchimpAudienceSync.controls.canRunDryRun,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "lexer-operator-decision-ready" : lane.exportSummary.status,
      mode: lane.mode,
      commandId: lane.decision.commandId,
      missing: lane.decision.validationSummary.missing,
      nextAction: ready ? "handoff-parser" : lane.nextAction,
    }),
    nextAction: ready ? "handoff-parser" : lane.nextAction,
  });
}

function createLexerClientWorkflowStatus(state, options) {
  const operation = state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience";
  const requestedCapabilities = operation === "syncAudience"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const envelope = createTokenStreamClientWorkflowStatusEnvelope(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? `mailchimp.${operation}` : options.expectedAdapter,
    provider: "mailchimp",
    operation,
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    scheduledAt: options.scheduledAt,
    requestedCapabilities,
    restartJournal: state.analyticsExport.restartJournal,
    reason: "lexer-client-workflow-status",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalPacket.ready && state.operationalHealth.ok && state.tokenHealth.ok;
  const mailchimpReady = !state.mailchimp.detected || (
    state.mailchimpWorkflowHandoff.ready
    && state.clientHandoffPacket.ready
    && state.mailchimpRecoveryEnvelope.ready
  );
  const ready = sourceReady && boundaryReady && operationalReady && mailchimpReady && envelope.ready;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-packet",
    mailchimpReady ? null : "mailchimp-runtime-handoff",
    envelope.ready ? null : envelope.exportSummary.blockedStage ?? envelope.exportSummary.missing[0] ?? "client-workflow-status",
    ...envelope.validationSummary.missing,
  ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).sort());
  const firstMissing = missing[0] ?? null;

  return Object.freeze({
    schema: "aios.lexer.client-workflow-status.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-required"
      : ready
        ? "ready-for-parser"
        : firstMissing === "parser-ready-source"
          ? state.resume.status
          : firstMissing === "scoped-boundary"
            ? state.boundaryHandoff.status
            : firstMissing === "operational-packet"
              ? state.operationalPacket.status
              : firstMissing === "mailchimp-runtime-handoff"
                ? state.mailchimpWorkflowHandoff.status
                : envelope.status,
    missing,
    envelope,
    parserHandoff: Object.freeze({
      accepted: ready,
      envelopeId: envelope.envelopeId,
      manifestId: envelope.sync.manifestId,
      routeId: envelope.sync.routeId,
      restoreCommand: envelope.commands.find((command) => command.kind === "restore-client-workflow")?.command ?? null,
      statusChannel: envelope.sync.statusChannel,
      auditChannel: envelope.sync.auditChannel,
      nextAction: ready
        ? "handoff-parser"
        : firstMissing === "parser-ready-source"
          ? state.resume.nextAction
          : firstMissing === "scoped-boundary"
            ? state.boundaryHandoff.nextAction
            : firstMissing === "operational-packet"
              ? state.operationalPacket.nextAction
              : firstMissing === "mailchimp-runtime-handoff"
                ? state.mailchimpWorkflowHandoff.nextAction
                : envelope.nextAction,
    }),
    validationSummary: Object.freeze({
      sourceReady,
      boundaryReady,
      operationalReady,
      mailchimpReady,
      workflowStatusReady: envelope.ready,
      phase: envelope.phase,
      missing,
    }),
    controls: Object.freeze({
      canLaunchClientWorkflow: ready && envelope.controls.canLaunchClient,
      canEmitStatus: envelope.controls.canEmitStatus,
      canReplayRestore: envelope.controls.canReplayRestore,
      canExportAudit: envelope.controls.canExportAudit,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable,
      canContinueDegraded: envelope.controls.canContinueDegraded && state.operationalHealth.degraded,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "lexer-client-workflow-ready" : envelope.exportSummary.status,
      envelopeId: envelope.envelopeId,
      manifestId: envelope.sync.manifestId,
      phase: envelope.phase,
      blockedStage: envelope.exportSummary.blockedStage,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : firstMissing === "parser-ready-source"
          ? state.resume.nextAction
          : firstMissing === "scoped-boundary"
            ? state.boundaryHandoff.nextAction
            : firstMissing === "operational-packet"
              ? state.operationalPacket.nextAction
              : firstMissing === "mailchimp-runtime-handoff"
                ? state.mailchimpWorkflowHandoff.nextAction
                : envelope.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : firstMissing === "parser-ready-source"
        ? state.resume.nextAction
        : firstMissing === "scoped-boundary"
          ? state.boundaryHandoff.nextAction
          : firstMissing === "operational-packet"
            ? state.operationalPacket.nextAction
            : firstMissing === "mailchimp-runtime-handoff"
              ? state.mailchimpWorkflowHandoff.nextAction
              : envelope.nextAction,
  });
}

function createLexerMailchimpAudienceSyncState(state, options) {
  const requestedCapabilities = state.mailchimp.status === "handoff-needs-recovery-status" || options.allowMutatingMailchimpSync
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const audienceSync = createTokenStreamMailchimpAudienceSyncContract(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    operation: "syncAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    audienceId: options.mailchimpAudienceId,
    segmentId: options.mailchimpSegmentId,
    mergeFields: options.mailchimpMergeFields,
    requiredMergeFields: options.mailchimpRequiredMergeFields,
    consentField: options.mailchimpConsentField,
    consentRequired: options.mailchimpConsentRequired,
    audienceRevision: options.mailchimpAudienceRevision,
    mode: options.mailchimpSyncMode,
    dryRun: options.mailchimpDryRun,
    allowMutatingSync: options.allowMutatingMailchimpSync,
    idempotencyKey: options.idempotencyKey,
    scheduledAt: options.scheduledAt,
    requestedCapabilities,
    serviceContract: state.mailchimpPreview.service,
    reason: "lexer-mailchimp-audience-sync-state",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const providerReady = state.mailchimpHandoffDecision?.ready ?? state.mailchimpPreview.ready;
  const ready = state.mailchimp.detected
    && sourceReady
    && boundaryReady
    && operationalReady
    && providerReady
    && audienceSync.accepted;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    providerReady ? null : "mailchimp-provider-handoff",
    audienceSync.accepted ? null : audienceSync.exportSummary.missing[0] ?? "mailchimp-audience-sync",
    ...audienceSync.validationSummary.missing,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.mailchimp-audience-sync-state.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : missing.includes("mailchimp-provider-handoff")
                ? state.mailchimpHandoffDecision?.status ?? state.mailchimpPreview.status
                : audienceSync.status,
    missing,
    audience: audienceSync.audience,
    sync: audienceSync.sync,
    manifest: Object.freeze({
      manifestId: audienceSync.manifest.manifestId,
      status: audienceSync.manifest.status,
      accepted: audienceSync.manifest.accepted,
      payload: audienceSync.manifest.payload,
      delivery: audienceSync.manifest.delivery,
      nextAction: audienceSync.manifest.nextAction,
    }),
    command: audienceSync.command,
    validationSummary: Object.freeze({
      sourceReady,
      boundaryReady,
      operationalReady,
      providerReady,
      audienceReady: audienceSync.validationSummary.audienceReady,
      mergeFieldsReady: audienceSync.validationSummary.mergeFieldsReady,
      consentReady: audienceSync.validationSummary.consentReady,
      revisionReady: audienceSync.validationSummary.revisionReady,
      manifestReady: audienceSync.validationSummary.manifestReady,
      scheduleReady: audienceSync.validationSummary.scheduleReady,
      dryRunReady: audienceSync.validationSummary.dryRunReady,
      idempotencyReady: audienceSync.validationSummary.idempotencyReady,
      missing,
    }),
    parserHandoff: Object.freeze({
      accepted: ready,
      syncKey: audienceSync.syncKey,
      manifestId: audienceSync.manifest.manifestId,
      payloadFingerprint: audienceSync.manifest.payload.fingerprint,
      statusChannel: audienceSync.sync.statusChannel,
      auditChannel: audienceSync.sync.auditChannel,
      checkpointCursor: audienceSync.sync.checkpointCursor,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : !providerReady
                ? state.mailchimpHandoffDecision?.nextAction ?? state.mailchimpPreview.nextAction
                : audienceSync.nextAction,
    }),
    controls: Object.freeze({
      canPreviewAudienceSync: audienceSync.controls.canPreview && sourceReady,
      canAcceptAudienceSync: audienceSync.controls.canAccept && boundaryReady,
      canScheduleAudienceSync: audienceSync.controls.canSchedule,
      canRunDryRun: audienceSync.controls.canRunDryRun && operationalReady,
      canRunMutatingSync: audienceSync.controls.canRunMutatingSync && operationalReady,
      canPreviewManifest: audienceSync.manifest.controls.canPreviewPayload && sourceReady,
      canAcceptManifest: audienceSync.manifest.controls.canAcceptManifest && boundaryReady,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable,
    }),
    audienceSync,
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "mailchimp-audience-sync-ready" : audienceSync.exportSummary.status,
      syncKey: audienceSync.syncKey,
      manifestId: audienceSync.manifest.manifestId,
      audienceId: audienceSync.audience.audienceId,
      segmentId: audienceSync.audience.segmentId,
      payloadFingerprint: audienceSync.manifest.payload.fingerprint,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : !providerReady
                ? state.mailchimpHandoffDecision?.nextAction ?? state.mailchimpPreview.nextAction
                : audienceSync.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : !providerReady
              ? state.mailchimpHandoffDecision?.nextAction ?? state.mailchimpPreview.nextAction
              : audienceSync.nextAction,
  });
}

function createLexerMailchimpOperatorGateState(state, options) {
  const operation = state.mailchimp.status === "handoff-needs-recovery-status" || options.allowMutatingMailchimpSync
    ? "syncAudience"
    : "fetchAudience";
  const mode = options.mailchimpSyncMode === "preview"
    ? "preview"
    : options.mailchimpEnabled === false
      ? "disabled"
      : options.scheduledAt
        ? "scheduled"
        : options.allowMutatingMailchimpSync
          ? "manual"
          : "preview";
  const requiredPermissions = state.mailchimp.detected
    ? operation === "syncAudience"
      ? ["mailchimp.read", "mailchimp.write"]
      : ["mailchimp.read"]
    : [];
  const gate = createTokenStreamMailchimpOperatorGate(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? `mailchimp.${operation}` : options.expectedAdapter,
    provider: "mailchimp",
    operation,
    mode,
    permissions: options.permissions,
    requiredPermissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    scheduledAt: options.scheduledAt,
    dryRun: options.mailchimpDryRun,
    allowMutatingSync: options.allowMutatingMailchimpSync,
    idempotencyKey: options.idempotencyKey,
    acceptanceSummary: state.previewAcceptanceHandoff?.acceptanceSummary,
    reason: "lexer-mailchimp-operator-gate",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const audienceReady = !state.mailchimp.detected
    || state.mailchimpAudienceSync?.ready
    || gate.mode === "preview";
  const ready = state.mailchimp.detected
    && sourceReady
    && boundaryReady
    && operationalReady
    && audienceReady
    && gate.accepted;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    audienceReady ? null : "mailchimp-audience-sync",
    gate.accepted ? null : gate.validationSummary.missing[0] ?? "mailchimp-operator-gate",
    ...gate.validationSummary.missing,
  ].filter((value, index, values) => value && values.indexOf(value) === index));

  return Object.freeze({
    schema: "aios.lexer.mailchimp-operator-gate-state.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : missing.includes("mailchimp-audience-sync")
                ? state.mailchimpAudienceSync?.status ?? "audience-sync-review"
                : gate.status,
    missing,
    gate,
    validationSummary: Object.freeze({
      sourceReady,
      boundaryReady,
      operationalReady,
      audienceReady,
      operatorGateReady: gate.accepted,
      mode: gate.mode,
      scheduleReady: gate.validationSummary.scheduleReady,
      operatorAccepted: gate.validationSummary.operatorAccepted,
      idempotencyReady: gate.validationSummary.idempotencyReady,
      missing,
    }),
    parserHandoff: Object.freeze({
      accepted: ready,
      gateId: gate.gateId,
      mode: gate.mode,
      statusChannel: gate.channels.status,
      auditChannel: gate.channels.audit,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : !audienceReady
                ? state.mailchimpAudienceSync?.nextAction ?? "review-mailchimp-audience-sync"
                : gate.nextAction,
    }),
    controls: Object.freeze({
      canEnable: gate.controls.canEnable,
      canDisable: gate.controls.canDisable,
      canPreview: gate.controls.canPreview && sourceReady,
      canAccept: gate.controls.canAccept && boundaryReady,
      canSchedule: gate.controls.canSchedule && audienceReady,
      canRunNow: gate.controls.canRunNow && operationalReady,
      canHandoffParser: ready,
      canResumeEditing: state.resume.retryable,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "lexer-mailchimp-operator-gate-ready" : gate.exportSummary.status,
      gateId: gate.gateId,
      mode: gate.mode,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : !audienceReady
                ? state.mailchimpAudienceSync?.nextAction ?? "review-mailchimp-audience-sync"
                : gate.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : !audienceReady
              ? state.mailchimpAudienceSync?.nextAction ?? "review-mailchimp-audience-sync"
              : gate.nextAction,
  });
}

function createLexerMailchimpRecoveryEnvelopeState(state, options) {
  const requestedCapabilities = state.mailchimp.status === "handoff-needs-recovery-status" || options.allowMutatingMailchimpSync
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const envelope = createTokenStreamMailchimpRecoveryEnvelope(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : options.expectedAdapter,
    provider: "mailchimp",
    operation: state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience",
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    requestedCapabilities,
    idempotencyKey: options.idempotencyKey,
    health: state.tokenHealth,
    analytics: state.analyticsExport,
    restartJournal: state.analyticsExport.restartJournal,
    resumptionManifest: state.resumptionManifest.manifest,
    exportReadinessManifest: state.providerExportReadiness.manifest,
    mailchimpReadinessLedger: state.mailchimpHandoffDecision.decision?.ledger,
    reason: "lexer-mailchimp-recovery-envelope",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const audienceReady = !state.mailchimp.detected || state.mailchimpAudienceSync.ready || envelope.recovery.degradedAllowed;
  const operatorReady = !state.mailchimp.detected || state.mailchimpOperatorGate?.ready || envelope.recovery.degradedAllowed;
  const ready = state.mailchimp.detected
    && sourceReady
    && boundaryReady
    && operationalReady
    && audienceReady
    && operatorReady
    && (envelope.accepted || envelope.recovery.degradedAllowed);
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    audienceReady ? null : "mailchimp-audience-sync",
    operatorReady ? null : "mailchimp-operator-gate",
    envelope.accepted || envelope.recovery.degradedAllowed ? null : envelope.validationSummary.missing[0] ?? "mailchimp-recovery",
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.mailchimp-recovery-envelope-state.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-detected"
      : ready
        ? envelope.recovery.degradedAllowed && !envelope.accepted ? "ready-degraded" : "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : envelope.status,
    missing,
    envelope,
    validationSummary: Object.freeze({
      sourceReady,
      boundaryReady,
      operationalReady,
      audienceReady,
      operatorReady,
      envelopeReady: envelope.accepted,
      degradedAllowed: envelope.recovery.degradedAllowed,
      replaySafe: envelope.recovery.replaySafe,
      missing,
    }),
    parserHandoff: Object.freeze({
      accepted: ready,
      envelopeId: envelope.envelopeId,
      syncKey: envelope.sync.syncKey,
      statusChannel: envelope.sync.statusChannel,
      auditChannel: envelope.sync.auditChannel,
      restoreCommand: envelope.recovery.restoreCommand,
      nextAction: ready
        ? envelope.recovery.degradedAllowed && !envelope.accepted ? "handoff-parser-degraded" : "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : !operatorReady
                ? state.mailchimpOperatorGate?.nextAction ?? "review-mailchimp-operator-gate"
              : envelope.nextAction,
    }),
    controls: Object.freeze({
      canReplay: envelope.controls.canReplay && sourceReady,
      canRetryAutomatically: envelope.controls.canRetryAutomatically && state.resume.retryable,
      canRunDegraded: envelope.controls.canRunDegraded && sourceReady && boundaryReady,
      canEmitStatus: envelope.controls.canEmitStatus,
      canExportAudit: envelope.controls.canExportAudit,
      canHandoffParser: ready,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready
        ? envelope.recovery.degradedAllowed && !envelope.accepted ? "lexer-mailchimp-recovery-degraded" : "lexer-mailchimp-recovery-ready"
        : envelope.exportSummary.status,
      envelopeId: envelope.envelopeId,
      missing,
      retryAfterMs: envelope.exportSummary.retryAfterMs,
      maxAttempts: envelope.exportSummary.maxAttempts,
      nextAction: ready
        ? envelope.recovery.degradedAllowed && !envelope.accepted ? "handoff-parser-degraded" : "handoff-parser"
        : envelope.nextAction,
    }),
    nextAction: ready
      ? envelope.recovery.degradedAllowed && !envelope.accepted ? "handoff-parser-degraded" : "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : !operatorReady
              ? state.mailchimpOperatorGate?.nextAction ?? "review-mailchimp-operator-gate"
            : envelope.nextAction,
  });
}

function createLexerMailchimpOperationalTimelineState(state, options) {
  const operation = state.mailchimp.status === "handoff-needs-recovery-status" ? "syncAudience" : "fetchAudience";
  const requiredPermissions = state.mailchimp.detected
    ? operation === "syncAudience" ? ["mailchimp.read", "mailchimp.write"] : ["mailchimp.read"]
    : [];
  const timeline = createTokenStreamMailchimpOperationalTimeline(state.stream, [
    Object.freeze({
      label: "lexer-resume",
      status: state.resume.status,
      accepted: state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream",
      blocked: state.resume.status === "blocked" || state.resume.status === "awaiting-complete-source",
      retryable: state.resume.retryable,
      nextAction: state.resume.nextAction,
      audit: state.boundaryHandoff.audit,
      cursor: state.resume.checkpoint.cursor,
    }),
    Object.freeze({
      label: "lexer-boundary",
      status: state.boundaryHandoff.status,
      accepted: state.boundaryHandoff.status === "scoped",
      blocked: state.boundaryHandoff.status !== "scoped",
      nextAction: state.boundaryHandoff.nextAction,
      audit: state.boundaryHandoff.audit,
    }),
    Object.freeze({
      label: "mailchimp-preview",
      status: state.mailchimpPreview.status,
      accepted: state.mailchimpPreview.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpPreview.ready,
      retryable: state.mailchimpPreview.nextStep.retryable,
      nextAction: state.mailchimpPreview.nextAction,
      audit: state.mailchimpPreview.acceptance.audit,
    }),
    Object.freeze({
      label: "operator-gate",
      status: state.mailchimpOperatorGate.status,
      accepted: state.mailchimpOperatorGate.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpOperatorGate.ready,
      retryable: state.mailchimpOperatorGate.controls.canRetryAutomatically,
      nextAction: state.mailchimpOperatorGate.nextAction,
      audit: Object.freeze({ channel: state.mailchimpOperatorGate.parserHandoff.auditChannel }),
      gateId: state.mailchimpOperatorGate.parserHandoff.gateId,
    }),
    Object.freeze({
      label: "audience-sync",
      status: state.mailchimpAudienceSync.status,
      accepted: state.mailchimpAudienceSync.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpAudienceSync.ready,
      retryable: state.mailchimpAudienceSync.controls.canReplayRestore,
      nextAction: state.mailchimpAudienceSync.nextAction,
      audit: Object.freeze({ channel: state.mailchimpAudienceSync.parserHandoff.auditChannel }),
      syncKey: state.mailchimpAudienceSync.parserHandoff.syncKey,
    }),
    Object.freeze({
      label: "recovery-envelope",
      status: state.mailchimpRecoveryEnvelope.status,
      accepted: state.mailchimpRecoveryEnvelope.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpRecoveryEnvelope.ready,
      retryable: state.mailchimpRecoveryEnvelope.controls.canRetryAutomatically,
      nextAction: state.mailchimpRecoveryEnvelope.nextAction,
      audit: Object.freeze({ channel: state.mailchimpRecoveryEnvelope.parserHandoff.auditChannel }),
      envelopeId: state.mailchimpRecoveryEnvelope.parserHandoff.envelopeId,
    }),
    Object.freeze({
      label: "export-ledger",
      status: state.mailchimpExportLedger.status,
      accepted: state.mailchimpExportLedger.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.mailchimpExportLedger.ready,
      retryable: state.mailchimpExportLedger.controls.canReplayRestart,
      nextAction: state.mailchimpExportLedger.nextAction,
      audit: Object.freeze({ channel: state.mailchimpExportLedger.parserHandoff.auditChannel }),
      ledgerId: state.mailchimpExportLedger.parserHandoff.ledgerId,
    }),
    Object.freeze({
      label: "client-workflow-status",
      status: state.clientWorkflowStatus.status,
      accepted: state.clientWorkflowStatus.ready || !state.mailchimp.detected,
      blocked: state.mailchimp.detected && !state.clientWorkflowStatus.ready,
      retryable: state.clientWorkflowStatus.controls.canReplayRestore,
      nextAction: state.clientWorkflowStatus.nextAction,
      audit: Object.freeze({ channel: state.clientWorkflowStatus.parserHandoff.auditChannel }),
    }),
  ], {
    ...options,
    operation,
    requiredPermissions,
    permissions: state.boundaryHandoff.permissions,
    auditChannel: state.boundaryHandoff.audit.channel,
    health: state.tokenHealth,
    analytics: state.analyticsExport,
    restartJournal: state.analyticsExport.restartJournal,
    reason: "lexer-mailchimp-operational-timeline",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const ready = (!state.mailchimp.detected || timeline.ready) && sourceReady && boundaryReady && operationalReady;
  const missing = Object.freeze([
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    state.mailchimp.detected && !timeline.ready ? timeline.exportSummary.firstBlocked ?? "mailchimp-operational-timeline" : null,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.lexer.mailchimp-operational-timeline-state.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: !state.mailchimp.detected
      ? "not-required"
      : ready
        ? "ready-for-parser"
        : missing.includes("parser-ready-source")
          ? state.resume.status
          : missing.includes("scoped-boundary")
            ? state.boundaryHandoff.status
            : missing.includes("operational-health")
              ? state.operationalHealth.status
              : timeline.status,
    missing,
    timeline,
    validationSummary: Object.freeze({
      sourceReady,
      boundaryReady,
      operationalReady,
      timelineReady: timeline.ready,
      auditReady: timeline.audit.status === "audit-ready" || !timeline.audit.required,
      restartSafe: timeline.recovery.restartSafe,
      missing,
    }),
    parserHandoff: Object.freeze({
      accepted: ready,
      timelineId: timeline.timelineId,
      restoreCommand: timeline.recovery.restoreCommand,
      auditStatus: timeline.audit.status,
      nextAction: ready ? "handoff-parser" : timeline.nextAction,
    }),
    controls: Object.freeze({
      canPublishTimeline: timeline.ready && timeline.audit.status === "audit-ready",
      canReplayRestart: timeline.recovery.restartSafe,
      canRetry: timeline.counters.retryable > 0 && state.resume.retryable,
      canHandoffParser: ready,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      status: ready ? "lexer-mailchimp-operational-timeline-ready" : timeline.exportSummary.status,
      timelineId: timeline.timelineId,
      firstBlocked: timeline.exportSummary.firstBlocked,
      blockedCount: timeline.counters.blocked,
      retryableCount: timeline.counters.retryable,
      missing,
      nextAction: ready ? "handoff-parser" : timeline.nextAction,
    }),
    nextAction: ready ? "handoff-parser" : timeline.nextAction,
  });
}

function createLexerRouteReadinessState(state, options) {
  const operation = state.mailchimp.status === "handoff-needs-recovery-status" || options.allowMutatingMailchimpSync
    ? "syncAudience"
    : "fetchAudience";
  const requestedCapabilities = operation === "syncAudience"
    ? ["audit", "checkpoint", "external-status", "provider-read", "provider-write", "idempotency"]
    : ["audit", "checkpoint", "external-status", "provider-read"];
  const routeReadiness = createTokenStreamRouteReadinessContract(state.stream, {
    adapter: options.expectedAdapter === "mailchimp" ? `mailchimp.${operation}` : options.expectedAdapter,
    provider: "mailchimp",
    operation,
    permissions: options.permissions,
    requiredPermissions: state.mailchimp.detected
      ? operation === "syncAudience"
        ? ["mailchimp.read", "mailchimp.write"]
        : ["mailchimp.read"]
      : [],
    requestedCapabilities,
    auditChannel: options.auditChannel,
    statusChannel: options.auditChannel,
    acceptedBy: options.acceptedBy,
    enabled: options.mailchimpEnabled ?? true,
    idempotencyKey: options.idempotencyKey,
    clientRoute: "lexer-mailchimp-route",
    workflowStatusEnvelope: state.clientWorkflowStatus.envelope,
    acceptanceSummary: state.previewAcceptanceHandoff.acceptanceSummary,
    reason: "lexer-route-readiness",
  });
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const operationalReady = state.operationalHealth.ok && state.tokenHealth.ok;
  const mailchimpReady = !state.mailchimp.detected || state.mailchimpOperationalTimeline.ready;
  const ready = sourceReady
    && boundaryReady
    && operationalReady
    && mailchimpReady
    && routeReadiness.accepted;
  const missing = Object.freeze([
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-boundary",
    operationalReady ? null : "operational-health",
    mailchimpReady ? null : "mailchimp-operational-timeline",
    routeReadiness.accepted ? null : routeReadiness.validationSummary.blockedStage ?? "route-readiness",
    ...routeReadiness.validationSummary.missing,
  ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).sort());

  return Object.freeze({
    schema: "aios.lexer.route-readiness-state.v1",
    sourceId: state.sourceId,
    detected: state.mailchimp.detected,
    ready,
    status: ready
      ? "ready-for-client-route"
      : missing.includes("parser-ready-source")
        ? state.resume.status
        : missing.includes("scoped-boundary")
          ? state.boundaryHandoff.status
          : missing.includes("operational-health")
            ? state.operationalHealth.status
            : missing.includes("mailchimp-operational-timeline")
              ? state.mailchimpOperationalTimeline.status
              : routeReadiness.status,
    routeReadiness,
    validationSummary: Object.freeze({
      sourceReady,
      boundaryReady,
      operationalReady,
      mailchimpReady,
      routeAccepted: routeReadiness.accepted,
      blockedStage: routeReadiness.validationSummary.blockedStage,
      missing,
    }),
    parserHandoff: Object.freeze({
      accepted: ready,
      routeId: routeReadiness.routeId,
      envelopeId: routeReadiness.sync.envelopeId,
      manifestId: routeReadiness.sync.manifestId,
      statusChannel: routeReadiness.sync.statusChannel,
      auditChannel: routeReadiness.sync.auditChannel,
      checkpointCursor: routeReadiness.sync.checkpointCursor,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : !mailchimpReady
                ? state.mailchimpOperationalTimeline.nextAction
                : routeReadiness.nextAction,
    }),
    controls: Object.freeze({
      canPreviewRoute: routeReadiness.controls.canPreview && sourceReady,
      canAcceptRoute: routeReadiness.controls.canAccept && boundaryReady,
      canLaunchRoute: routeReadiness.controls.canLaunchRoute && ready,
      canEmitStatus: routeReadiness.controls.canEmitStatus,
      canReplayRestore: routeReadiness.controls.canReplayRestore && operationalReady,
      canExportAudit: routeReadiness.controls.canExportAudit,
      canHandoffParser: ready,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      routeId: routeReadiness.routeId,
      status: ready ? "lexer-route-ready" : "lexer-route-review",
      blockedStage: routeReadiness.validationSummary.blockedStage,
      missing,
      nextAction: ready
        ? "handoff-parser"
        : !sourceReady
          ? state.resume.nextAction
          : !boundaryReady
            ? state.boundaryHandoff.nextAction
            : !operationalReady
              ? state.operationalHealth.nextAction
              : !mailchimpReady
                ? state.mailchimpOperationalTimeline.nextAction
                : routeReadiness.nextAction,
    }),
    nextAction: ready
      ? "handoff-parser"
      : !sourceReady
        ? state.resume.nextAction
        : !boundaryReady
          ? state.boundaryHandoff.nextAction
          : !operationalReady
            ? state.operationalHealth.nextAction
            : !mailchimpReady
              ? state.mailchimpOperationalTimeline.nextAction
              : routeReadiness.nextAction,
  });
}

export function createLexerState(source, options = {}) {
  const normalizedOptions = normalizeLexerOptions(options);
  const lexed = lex(source, normalizedOptions);
  const stream = createTokenStream(lexed.tokens, {
    diagnostics: lexed.diagnostics,
    cursor: 0,
    sourceId: normalizedOptions.sourceId,
    workspace: normalizedOptions.workspace,
    tenant: normalizedOptions.tenant,
    role: normalizedOptions.role,
    permissions: normalizedOptions.permissions,
    auditChannel: normalizedOptions.auditChannel,
    localOnly: normalizedOptions.localOnly,
    handoff: "lexer-to-parser",
  });
  const mailchimp = mailchimpTokenSignals(lexed.tokens);
  const boundaryHandoff = createLexerBoundaryHandoff(lexed, normalizedOptions, mailchimp);
  const resume = buildLexerResumePlan(lexed, stream, normalizedOptions);
  const operationalHealth = createLexerOperationalHealth(lexed, stream, boundaryHandoff, resume, mailchimp);
  const tokenHealth = createTokenStreamHealthReport(stream, {
    reason: "lexer-state",
    requiredPermissions: mailchimp.detected
      ? mailchimp.status === "handoff-needs-recovery-status"
        ? ["mailchimp.read", "mailchimp.write"]
        : ["mailchimp.read"]
      : [],
  });
  const baseState = Object.freeze({
    schema: "aios.lexer.state.v1",
    sourceId: normalizedOptions.sourceId,
    stream,
    snapshot: lexed.snapshot,
    boundary: lexed.boundary,
    boundaryHandoff,
    health: lexed.health,
    operationalHealth,
    tokenHealth,
    mailchimp,
    resume,
    diagnostics: lexed.diagnostics,
  });
  const tenantBoundaryReadiness = createLexerTenantBoundaryReadiness(baseState, tokenHealth, normalizedOptions);
  const mailchimpPreview = createLexerMailchimpPreview(baseState, normalizedOptions);
  const stateWithPreview = Object.freeze({
    ...baseState,
    tenantBoundaryReadiness,
    mailchimpPreview,
  });
  const clientAdoption = createLexerClientAdoptionState(stateWithPreview, normalizedOptions);
  const previewAcceptanceHandoff = createLexerPreviewAcceptanceHandoff(stateWithPreview, normalizedOptions);
  const adapterStatusHandoff = createLexerAdapterStatusHandoff(stateWithPreview, normalizedOptions);
  const analyticsExport = createLexerAnalyticsExport(stateWithPreview, tokenHealth, normalizedOptions);
  const recoveryRunbook = createLexerRecoveryRunbook(stateWithPreview, normalizedOptions);
  const mailchimpWorkflowHandoff = createLexerMailchimpWorkflowHandoff(stateWithPreview, normalizedOptions);
  const handoffEvidence = createLexerHandoffEvidenceState(stateWithPreview, normalizedOptions);
  const mailchimpHandoffDecision = createLexerMailchimpHandoffDecision(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
  }), normalizedOptions);
  const clientHandoffPacket = createLexerClientHandoffPacket(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
  }), normalizedOptions);
  const resumptionManifest = createLexerResumptionManifest(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
  }), normalizedOptions);
  const nextActionQueue = createLexerNextActionQueue(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
  }), normalizedOptions);
  const providerExportReadiness = createLexerProviderExportReadiness(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
  }), normalizedOptions);
  const providerLifecycle = createLexerProviderLifecycleState(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
  }), normalizedOptions);
  const mailchimpExportLedger = createLexerMailchimpExportLedgerState(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
  }), normalizedOptions);
  const mailchimpAudienceSync = createLexerMailchimpAudienceSyncState(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
  }), normalizedOptions);
  const mailchimpOperatorGate = createLexerMailchimpOperatorGateState(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
    mailchimpAudienceSync,
  }), normalizedOptions);
  const mailchimpControlPlane = createTokenStreamMailchimpControlPlane(stream, {
    adapter: normalizedOptions.expectedAdapter === "mailchimp" ? "mailchimp.syncAudience" : normalizedOptions.expectedAdapter,
    provider: "mailchimp",
    operation: mailchimp.status === "handoff-needs-recovery-status" || normalizedOptions.allowMutatingMailchimpSync
      ? "syncAudience"
      : "fetchAudience",
    permissions: normalizedOptions.permissions,
    auditChannel: normalizedOptions.auditChannel,
    statusChannel: normalizedOptions.auditChannel,
    acceptedBy: normalizedOptions.acceptedBy,
    enabled: normalizedOptions.mailchimpEnabled,
    mailchimpEnabled: normalizedOptions.mailchimpEnabled,
    mode: normalizedOptions.mailchimpSyncMode,
    scheduledAt: normalizedOptions.scheduledAt,
    dryRun: normalizedOptions.mailchimpDryRun,
    allowMutatingSync: normalizedOptions.allowMutatingMailchimpSync,
    idempotencyKey: normalizedOptions.idempotencyKey,
    serviceContract: mailchimpPreview.service,
    lifecycleManifest: providerLifecycle,
    operatorGate: mailchimpOperatorGate.gate,
    acceptanceSummary: previewAcceptanceHandoff.acceptanceSummary,
    reason: "lexer-mailchimp-control-plane",
  });
  const externalStatusReceipt = createLexerExternalStatusReceiptState(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
    mailchimpAudienceSync,
    mailchimpOperatorGate,
    mailchimpControlPlane,
  }), normalizedOptions);
  const mailchimpRecoveryEnvelope = createLexerMailchimpRecoveryEnvelopeState(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
    mailchimpAudienceSync,
    mailchimpOperatorGate,
    mailchimpControlPlane,
    externalStatusReceipt,
  }), normalizedOptions);
  const operationalPacket = createLexerOperationalPacket(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
    mailchimpAudienceSync,
    mailchimpOperatorGate,
    mailchimpControlPlane,
    externalStatusReceipt,
    mailchimpRecoveryEnvelope,
  }), normalizedOptions);
  const clientWorkflowStatus = createLexerClientWorkflowStatus(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
    mailchimpAudienceSync,
    mailchimpOperatorGate,
    mailchimpControlPlane,
    externalStatusReceipt,
    mailchimpRecoveryEnvelope,
    operationalPacket,
  }), normalizedOptions);
  const operatorDecisionLane = createLexerOperatorDecisionLane(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
    mailchimpAudienceSync,
    mailchimpOperatorGate,
    mailchimpControlPlane,
    externalStatusReceipt,
    mailchimpRecoveryEnvelope,
    operationalPacket,
    clientWorkflowStatus,
  }), normalizedOptions);
  const mailchimpOperationalTimeline = createLexerMailchimpOperationalTimelineState(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
    mailchimpAudienceSync,
    mailchimpOperatorGate,
    mailchimpControlPlane,
    externalStatusReceipt,
    mailchimpRecoveryEnvelope,
    operationalPacket,
    clientWorkflowStatus,
    operatorDecisionLane,
  }), normalizedOptions);
  const routeReadiness = createLexerRouteReadinessState(Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
    mailchimpAudienceSync,
    mailchimpOperatorGate,
    mailchimpControlPlane,
    externalStatusReceipt,
    mailchimpRecoveryEnvelope,
    operationalPacket,
    clientWorkflowStatus,
    operatorDecisionLane,
    mailchimpOperationalTimeline,
  }), normalizedOptions);

  return Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
    handoffEvidence,
    mailchimpHandoffDecision,
    clientHandoffPacket,
    resumptionManifest,
    nextActionQueue,
    providerExportReadiness,
    providerLifecycle,
    mailchimpExportLedger,
    mailchimpAudienceSync,
    mailchimpOperatorGate,
    mailchimpControlPlane,
    externalStatusReceipt,
    mailchimpRecoveryEnvelope,
    operationalPacket,
    clientWorkflowStatus,
    operatorDecisionLane,
    mailchimpOperationalTimeline,
    routeReadiness,
  });
}

export function summarizeLexerState(source, options = {}) {
  const state = createLexerState(source, options);

  return Object.freeze({
    ok: state.health.ok,
    status: state.resume.status,
    nextAction: state.resume.nextAction,
    tokenCount: state.health.tokenCount,
    mailchimp: state.mailchimp,
    boundary: state.boundary,
    boundaryHandoff: state.boundaryHandoff,
    operationalHealth: state.operationalHealth,
    tokenHealth: state.tokenHealth,
    tenantBoundaryReadiness: state.tenantBoundaryReadiness.exportSummary,
    mailchimpPreview: Object.freeze({
      status: state.mailchimpPreview.status,
      ready: state.mailchimpPreview.ready,
      validationSummary: state.mailchimpPreview.validationSummary,
      acceptance: state.mailchimpPreview.acceptance.status,
      nextAction: state.mailchimpPreview.nextAction,
    }),
    clientAdoption: Object.freeze({
      status: state.clientAdoption.status,
      adopted: state.clientAdoption.adopted,
      missing: state.clientAdoption.missing,
      runtimeSnapshot: state.clientAdoption.runtimeSnapshot.exportSummary,
      runtimeHandoff: state.clientAdoption.runtimeHandoff,
      nextAction: state.clientAdoption.nextAction,
    }),
    previewAcceptanceHandoff: Object.freeze({
      status: state.previewAcceptanceHandoff.status,
      ready: state.previewAcceptanceHandoff.ready,
      validationSummary: state.previewAcceptanceHandoff.validationSummary,
      controls: state.previewAcceptanceHandoff.controls,
      nextAction: state.previewAcceptanceHandoff.nextAction,
    }),
    adapterStatusHandoff: Object.freeze({
      status: state.adapterStatusHandoff.status,
      ready: state.adapterStatusHandoff.ready,
      missing: state.adapterStatusHandoff.missing,
      parserHandoff: state.adapterStatusHandoff.parserHandoff,
      nextAction: state.adapterStatusHandoff.nextAction,
    }),
    analyticsExport: state.analyticsExport.exportSummary,
    boundaryIncident: Object.freeze({
      status: state.analyticsExport.boundaryIncident.status,
      blocked: state.analyticsExport.boundaryIncident.blocked,
      counters: state.analyticsExport.boundaryIncident.counters,
      nextAction: state.analyticsExport.boundaryIncident.nextAction,
    }),
    recoveryRunbook: state.recoveryRunbook.exportSummary,
    mailchimpWorkflowHandoff: Object.freeze({
      status: state.mailchimpWorkflowHandoff.status,
      ready: state.mailchimpWorkflowHandoff.ready,
      missing: state.mailchimpWorkflowHandoff.missing,
      parserHandoff: state.mailchimpWorkflowHandoff.parserHandoff,
      workflow: state.mailchimpWorkflowHandoff.workflow.exportSummary,
      nextAction: state.mailchimpWorkflowHandoff.nextAction,
    }),
    handoffEvidence: state.handoffEvidence.exportSummary,
    mailchimpHandoffDecision: state.mailchimpHandoffDecision.exportSummary,
    clientHandoffPacket: state.clientHandoffPacket.exportSummary,
    resumptionManifest: state.resumptionManifest.exportSummary,
    resumptionStatus: state.resumptionManifest.statusEnvelope.exportSummary,
    nextActionQueue: state.nextActionQueue.exportSummary,
    providerExportReadiness: state.providerExportReadiness.exportSummary,
    providerLifecycle: state.providerLifecycle.exportSummary,
    mailchimpExportLedger: Object.freeze({
      ...state.mailchimpExportLedger.exportSummary,
      validationSummary: state.mailchimpExportLedger.validationSummary,
      parserHandoff: state.mailchimpExportLedger.parserHandoff,
    }),
    mailchimpAudienceSync: Object.freeze({
      ...state.mailchimpAudienceSync.exportSummary,
      manifest: Object.freeze({
        manifestId: state.mailchimpAudienceSync.manifest.manifestId,
        status: state.mailchimpAudienceSync.manifest.status,
        accepted: state.mailchimpAudienceSync.manifest.accepted,
        payloadFingerprint: state.mailchimpAudienceSync.manifest.payload.fingerprint,
        missing: state.mailchimpAudienceSync.manifest.validationSummary.missing,
        nextAction: state.mailchimpAudienceSync.manifest.nextAction,
      }),
      validationSummary: state.mailchimpAudienceSync.validationSummary,
      parserHandoff: state.mailchimpAudienceSync.parserHandoff,
    }),
    mailchimpOperatorGate: Object.freeze({
      ...state.mailchimpOperatorGate.exportSummary,
      validationSummary: state.mailchimpOperatorGate.validationSummary,
      parserHandoff: state.mailchimpOperatorGate.parserHandoff,
      controls: state.mailchimpOperatorGate.controls,
    }),
    mailchimpControlPlane: Object.freeze({
      ...state.mailchimpControlPlane.exportSummary,
      validationSummary: state.mailchimpControlPlane.validationSummary,
      controls: state.mailchimpControlPlane.controls,
      schedule: state.mailchimpControlPlane.schedule,
    }),
    externalStatusReceipt: Object.freeze({
      ...state.externalStatusReceipt.exportSummary,
      validationSummary: state.externalStatusReceipt.receipt.validationSummary,
      parserHandoff: state.externalStatusReceipt.parserHandoff,
      controls: state.externalStatusReceipt.controls,
    }),
    mailchimpRecoveryEnvelope: state.mailchimpRecoveryEnvelope.exportSummary,
    operationalPacket: state.operationalPacket.exportSummary,
    clientWorkflowStatus: state.clientWorkflowStatus.exportSummary,
    operatorDecisionLane: state.operatorDecisionLane.exportSummary,
    mailchimpOperationalTimeline: Object.freeze({
      ...state.mailchimpOperationalTimeline.exportSummary,
      validationSummary: state.mailchimpOperationalTimeline.validationSummary,
      parserHandoff: state.mailchimpOperationalTimeline.parserHandoff,
    }),
    routeReadiness: Object.freeze({
      ...state.routeReadiness.exportSummary,
      validationSummary: state.routeReadiness.validationSummary,
      parserHandoff: state.routeReadiness.parserHandoff,
      controls: state.routeReadiness.controls,
    }),
  });
}

export function lexerStateSelfCheck() {
  const state = createLexerState("job sync { handoff adapter mailchimp.syncAudience; status emits \"mailchimp.status\"; recover from \"ledger\"; }", {
    workspace: "local",
    tenant: "demo",
    role: "operator",
    permissions: ["mailchimp.read", "mailchimp.write"],
    auditChannel: "mailchimp.audit",
    sourceId: "self-check",
    mailchimpAudienceId: "aud-123",
    mailchimpMergeFields: { EMAIL: "customer.email" },
    mailchimpConsentField: "customer.marketingConsent",
    mailchimpAudienceRevision: "rev-1",
    acceptedBy: "self-check",
    idempotencyKey: "self-check-sync",
  });

  return Object.freeze({
    ok: state.stream.tokens.length > 0
      && state.mailchimp.detected
      && state.resume.status === "ready-for-parser"
      && state.boundaryHandoff.status === "scoped"
      && state.tenantBoundaryReadiness.accepted
      && state.operationalHealth.status === "healthy"
      && state.mailchimpPreview.status !== "not-detected"
      && state.clientAdoption.status !== "not-detected"
      && state.clientAdoption.runtimeSnapshot.schema === "aios.token.stream.client-runtime-adoption.snapshot.v1"
      && state.previewAcceptanceHandoff.status !== "not-detected"
      && state.adapterStatusHandoff.status !== "not-detected"
      && state.analyticsExport.status === "ready"
      && state.analyticsExport.boundaryIncident.status === "clear"
      && state.recoveryRunbook.ready
      && state.mailchimpWorkflowHandoff.status !== "not-detected"
      && state.handoffEvidence.status !== "not-detected"
      && state.mailchimpHandoffDecision.status !== "not-detected"
      && state.clientHandoffPacket.status !== "not-detected"
      && state.resumptionManifest.status !== "not-detected"
      && state.resumptionManifest.statusEnvelope.schema === "aios.token.stream.resumption-status-envelope.v1"
      && state.nextActionQueue.status !== "not-detected"
      && Boolean(state.nextActionQueue.nextAction)
      && state.providerExportReadiness.status !== "not-detected"
      && state.providerLifecycle.status !== "not-required"
      && state.mailchimpExportLedger.status !== "not-required"
      && Boolean(state.mailchimpExportLedger.parserHandoff.nextAction)
      && state.mailchimpAudienceSync.status !== "not-detected"
      && state.mailchimpAudienceSync.manifest.accepted
      && state.mailchimpOperatorGate.status !== "not-detected"
      && Boolean(state.mailchimpOperatorGate.parserHandoff.nextAction)
      && state.mailchimpControlPlane.schema === "aios.token.stream.mailchimp-control-plane.v1"
      && Boolean(state.mailchimpControlPlane.exportSummary.nextAction)
      && state.externalStatusReceipt.schema === "aios.lexer.external-status-receipt-state.v1"
      && Boolean(state.externalStatusReceipt.parserHandoff.nextAction)
      && state.mailchimpRecoveryEnvelope.status !== "not-detected"
      && Boolean(state.mailchimpRecoveryEnvelope.parserHandoff.nextAction)
      && state.operationalPacket.packet.entries.length > 0
      && Boolean(state.operationalPacket.nextAction)
      && state.clientWorkflowStatus.status !== "not-detected"
      && Boolean(state.clientWorkflowStatus.parserHandoff.nextAction)
      && state.operatorDecisionLane.status !== "not-detected"
      && Boolean(state.operatorDecisionLane.nextAction)
      && state.mailchimpOperationalTimeline.status !== "not-required"
      && Boolean(state.mailchimpOperationalTimeline.parserHandoff.nextAction)
      && state.routeReadiness.schema === "aios.lexer.route-readiness-state.v1"
      && Boolean(state.routeReadiness.parserHandoff.nextAction),
    status: state.resume.status,
    health: state.operationalHealth.status,
    tokenHealth: state.tokenHealth.status,
    tenantBoundaryReadiness: state.tenantBoundaryReadiness.status,
    mailchimp: state.mailchimp.status,
    mailchimpPreview: state.mailchimpPreview.status,
    clientAdoption: state.clientAdoption.status,
    clientRuntimeAdoption: state.clientAdoption.runtimeSnapshot.status,
    previewAcceptanceHandoff: state.previewAcceptanceHandoff.status,
    adapterStatusHandoff: state.adapterStatusHandoff.status,
    recoveryRunbook: state.recoveryRunbook.status,
    mailchimpWorkflowHandoff: state.mailchimpWorkflowHandoff.status,
    handoffEvidence: state.handoffEvidence.status,
    mailchimpHandoffDecision: state.mailchimpHandoffDecision.status,
    clientHandoffPacket: state.clientHandoffPacket.status,
    resumptionManifest: state.resumptionManifest.status,
    resumptionStatus: state.resumptionManifest.statusEnvelope.status,
    nextActionQueue: state.nextActionQueue.status,
    providerExportReadiness: state.providerExportReadiness.status,
    providerLifecycle: state.providerLifecycle.status,
    mailchimpExportLedger: state.mailchimpExportLedger.status,
    mailchimpAudienceSync: state.mailchimpAudienceSync.status,
    mailchimpOperatorGate: state.mailchimpOperatorGate.status,
    mailchimpControlPlane: state.mailchimpControlPlane.status,
    externalStatusReceipt: state.externalStatusReceipt.status,
    mailchimpRecoveryEnvelope: state.mailchimpRecoveryEnvelope.status,
    operationalPacket: state.operationalPacket.status,
    clientWorkflowStatus: state.clientWorkflowStatus.status,
    operatorDecisionLane: state.operatorDecisionLane.status,
    mailchimpOperationalTimeline: state.mailchimpOperationalTimeline.status,
    routeReadiness: state.routeReadiness.status,
    boundary: state.boundaryHandoff.status,
    boundaryIncident: state.analyticsExport.boundaryIncident.status,
  });
}
