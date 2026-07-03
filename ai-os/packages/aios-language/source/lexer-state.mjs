import { lex } from "./lexer.mjs";
import {
  createTokenCheckpoint,
  createTokenStream,
  createTokenStreamBoundaryReport,
  createTokenStreamHealthReport,
  createTokenStreamAdapterStatusPacket,
  createTokenStreamProviderAcceptanceSummary,
  createTokenStreamProviderReadinessPreview,
  createTokenStreamProviderServiceContract,
  createTokenStreamCommandAuditReport,
  createTokenStreamMailchimpWorkflowSession,
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

function createLexerAnalyticsExport(state, tokenHealth) {
  const diagnostics = Object.freeze(Array.from(state.diagnostics ?? []));
  const blocking = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const checkpoint = createTokenCheckpoint(state.stream, "lexer-analytics-export");
  const timeline = Object.freeze([
    createLexerTimelineEvent("lex", state, {
      status: state.health.ok ? "lexed" : "diagnostics",
      nextAction: state.health.ok ? "build-token-stream" : "surface-lexer-diagnostics",
    }),
    createLexerTimelineEvent("boundary", state, {
      status: state.boundaryHandoff.status,
      nextAction: state.boundaryHandoff.nextAction,
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
    ok: state.operationalHealth.ok && tokenHealth.ok,
    status: state.operationalHealth.blocked || !tokenHealth.ok
      ? "blocked"
      : state.operationalHealth.degraded || tokenHealth.status === "degraded"
        ? "degraded"
        : "ready",
    counters: Object.freeze({
      tokens: state.health.tokenCount,
      diagnostics: diagnostics.length,
      warnings: warnings.length,
      blocking: blocking.length,
      byTokenType: countTokensByType(state.stream.tokens),
      byDiagnosticCode: countDiagnosticsByCode(diagnostics),
    }),
    history: Object.freeze({
      checkpointCursor: checkpoint.cursor,
      restartSafe: checkpoint.restartSafe,
      restoreCommand: checkpoint.clientState.restoreCommand,
      tokenWindow: describeTokenWindow(state.stream, 3),
      timeline,
    }),
    exportSummary: Object.freeze({
      sourceId: state.sourceId,
      workspace: state.boundaryHandoff.workspace,
      tenant: state.boundaryHandoff.tenant,
      role: state.boundaryHandoff.role,
      status: state.operationalHealth.status,
      tokenHealth: tokenHealth.status,
      mailchimp: state.mailchimp.status,
      previewAcceptance: state.mailchimpPreview.acceptance.status,
      nextAction: tokenHealth.ok ? state.operationalHealth.nextAction : tokenHealth.nextAction,
    }),
    nextAction: tokenHealth.ok ? state.operationalHealth.nextAction : tokenHealth.nextAction,
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
  const sourceReady = state.resume.status === "ready-for-parser" || state.resume.status === "degraded-token-stream";
  const boundaryReady = state.boundaryHandoff.status === "scoped";
  const previewReady = state.mailchimpPreview.ready;
  const adopted = state.mailchimp.detected && sourceReady && boundaryReady && readiness.accepted && previewReady;
  const missing = Object.freeze([
    state.mailchimp.detected ? null : "mailchimp-source-signal",
    sourceReady ? null : "parser-ready-source",
    boundaryReady ? null : "scoped-client-boundary",
    readiness.explanation.validationSummary.statusReady ? null : "external-status-channel",
    readiness.explanation.validationSummary.auditReady ? null : "audit-channel",
    readiness.explanation.validationSummary.capabilitiesAccepted ? null : "provider-capability-negotiation",
    readiness.explanation.validationSummary.previewAccepted ? null : "user-preview-acceptance",
    previewReady ? null : "mailchimp-preview-readiness",
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
      restoreCommand: state.resume.checkpoint.clientState.restoreCommand,
      statusChannel: readiness.sync.statusChannel,
      auditChannel: readiness.sync.auditChannel,
    }),
    readiness,
    controls: Object.freeze({
      canPreview: state.mailchimp.detected && sourceReady,
      canAccept: readiness.serviceContract.acceptance.controls.canAccept && boundaryReady,
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
            : readiness.nextAction,
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
  const mailchimpPreview = createLexerMailchimpPreview(baseState, normalizedOptions);
  const stateWithPreview = Object.freeze({
    ...baseState,
    mailchimpPreview,
  });
  const clientAdoption = createLexerClientAdoptionState(stateWithPreview, normalizedOptions);
  const previewAcceptanceHandoff = createLexerPreviewAcceptanceHandoff(stateWithPreview, normalizedOptions);
  const adapterStatusHandoff = createLexerAdapterStatusHandoff(stateWithPreview, normalizedOptions);
  const analyticsExport = createLexerAnalyticsExport(stateWithPreview, tokenHealth);
  const recoveryRunbook = createLexerRecoveryRunbook(stateWithPreview, normalizedOptions);
  const mailchimpWorkflowHandoff = createLexerMailchimpWorkflowHandoff(stateWithPreview, normalizedOptions);

  return Object.freeze({
    ...stateWithPreview,
    clientAdoption,
    previewAcceptanceHandoff,
    adapterStatusHandoff,
    analyticsExport,
    recoveryRunbook,
    mailchimpWorkflowHandoff,
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
    recoveryRunbook: state.recoveryRunbook.exportSummary,
    mailchimpWorkflowHandoff: Object.freeze({
      status: state.mailchimpWorkflowHandoff.status,
      ready: state.mailchimpWorkflowHandoff.ready,
      missing: state.mailchimpWorkflowHandoff.missing,
      parserHandoff: state.mailchimpWorkflowHandoff.parserHandoff,
      workflow: state.mailchimpWorkflowHandoff.workflow.exportSummary,
      nextAction: state.mailchimpWorkflowHandoff.nextAction,
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
  });

  return Object.freeze({
    ok: state.stream.tokens.length > 0
      && state.mailchimp.detected
      && state.resume.status === "ready-for-parser"
      && state.boundaryHandoff.status === "scoped"
      && state.operationalHealth.status === "healthy"
      && state.mailchimpPreview.status !== "not-detected"
      && state.clientAdoption.status !== "not-detected"
      && state.previewAcceptanceHandoff.status !== "not-detected"
      && state.adapterStatusHandoff.status !== "not-detected"
      && state.analyticsExport.status === "ready"
      && state.recoveryRunbook.ready
      && state.mailchimpWorkflowHandoff.status !== "not-detected",
    status: state.resume.status,
    health: state.operationalHealth.status,
    tokenHealth: state.tokenHealth.status,
    mailchimp: state.mailchimp.status,
    mailchimpPreview: state.mailchimpPreview.status,
    clientAdoption: state.clientAdoption.status,
    previewAcceptanceHandoff: state.previewAcceptanceHandoff.status,
    adapterStatusHandoff: state.adapterStatusHandoff.status,
    recoveryRunbook: state.recoveryRunbook.status,
    mailchimpWorkflowHandoff: state.mailchimpWorkflowHandoff.status,
    boundary: state.boundaryHandoff.status,
  });
}
