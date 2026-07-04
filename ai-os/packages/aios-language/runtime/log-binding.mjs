const LOG_BINDING_GRAMMAR = Object.freeze({
  command: "log.emit",
  requiredFields: Object.freeze(["stream", "message"]),
  optionalFields: Object.freeze([
    "level",
    "subject",
    "claim",
    "redact",
    "retention",
    "clientRequest",
    "idempotencyKey",
    "cursor",
    "recovery",
    "health",
    "retry",
    "backoff",
    "degraded",
    "action",
    "tenant",
    "workspace",
    "actor",
    "roles",
    "permissions",
    "boundary",
    "auditRef",
    "policyVersion",
    "previewId",
    "acceptanceToken",
    "acceptanceStatus",
    "receipt",
  ]),
});

const LOG_BINDING_STDLIB = Object.freeze({
  command: "log.emit",
  capabilities: Object.freeze(["kernel.audit.append", "kernel.log.write"]),
  verifierClaims: Object.freeze([
    "log.local.append.only",
    "log.redaction.declared",
    "log.tenant.scope.bound",
    "log.truth.boundary.tagged",
  ]),
});

const LOG_BINDING_EXAMPLE = `log.emit stream=mailchimp-sync level=info subject=campaign-import message="queued import batch" claim=operator-observed redact=email,api_key clientRequest=req_123 idempotencyKey=batch_42 cursor=campaign:42 recovery=resume-after-commit health=healthy retry=bounded backoff=exponential action=operator.review tenant=tenant_123 workspace=aud_123 actor=op_7 roles=rollback_operator permissions=mailchimp.rollback,workspace.aud_123.rollback boundary=enforced`;

function tokenizeLogSource(source) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new TypeError("log binding source must be a non-empty string");
  }
  return source.trim().match(/[^\s="]+=(?:"(?:\\.|[^"\\])*"|[^\s]+)|[^\s]+/g) ?? [];
}

function parseLogAssignments(tokens) {
  if (tokens[0] !== LOG_BINDING_GRAMMAR.command) throw new SyntaxError("expected log.emit command");
  return tokens.slice(1).reduce((fields, token) => {
    const splitAt = token.indexOf("=");
    if (splitAt <= 0) throw new SyntaxError(`expected key=value field, received ${token}`);
    const rawValue = token.slice(splitAt + 1);
    fields[token.slice(0, splitAt)] = rawValue.startsWith("\"") && rawValue.endsWith("\"")
      ? rawValue.slice(1, -1).replace(/\\"/g, "\"")
      : rawValue;
    return fields;
  }, {});
}

function normalizeLevel(level) {
  const selected = level ?? "info";
  if (!["debug", "info", "warn", "error"].includes(selected)) {
    throw new SyntaxError(`unsupported log level ${selected}`);
  }
  return selected;
}

function normalizeList(value) {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean).sort() : [];
}

function normalizeUniqueList(value) {
  return [...new Set(normalizeList(value))];
}

function normalizeLogIdentifier(value, field, fallback) {
  const selected = value ?? fallback;
  if (!selected) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{1,191}$/.test(selected)) {
    throw new SyntaxError(`invalid log.emit ${field} ${selected}`);
  }
  return selected;
}

function normalizeScopeIdentifier(value, field, fallback = "") {
  const selected = value ?? fallback;
  if (!selected) return "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,191}$/.test(selected)) {
    throw new SyntaxError(`invalid log.emit ${field} ${selected}`);
  }
  return selected;
}

function normalizeBoundaryMode(value) {
  const selected = value ?? "declared";
  if (!["declared", "enforced", "blocked", "runtime"].includes(selected)) {
    throw new SyntaxError(`unsupported log.emit boundary ${selected}`);
  }
  return selected;
}

function permissionAllows(granted, required) {
  if (!required) return true;
  if (granted.includes("*") || granted.includes(required)) return true;
  return granted.some((permission) => {
    if (!permission.endsWith("*")) return false;
    return required.startsWith(permission.slice(0, -1));
  });
}

function normalizeRecovery(value) {
  const selected = value ?? "append-once";
  if (!["append-once", "resume-after-commit", "tombstone-on-conflict"].includes(selected)) {
    throw new SyntaxError(`unsupported log.emit recovery ${selected}`);
  }
  return selected;
}

function normalizeHealth(value, level) {
  const selected = value ?? (level === "error" ? "failed" : level === "warn" ? "degraded" : "healthy");
  if (!["healthy", "degraded", "failed", "recovering"].includes(selected)) {
    throw new SyntaxError(`unsupported log.emit health ${selected}`);
  }
  return selected;
}

function normalizeRetry(value, health) {
  const selected = value ?? (health === "failed" ? "manual" : "none");
  if (!["none", "bounded", "manual", "resume"].includes(selected)) {
    throw new SyntaxError(`unsupported log.emit retry ${selected}`);
  }
  return selected;
}

function normalizeBackoff(value, retry) {
  const selected = value ?? (retry === "bounded" ? "exponential" : "none");
  if (!["none", "linear", "exponential"].includes(selected)) {
    throw new SyntaxError(`unsupported log.emit backoff ${selected}`);
  }
  return selected;
}

function normalizeBooleanToken(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new SyntaxError(`expected boolean token true or false, received ${value}`);
}

function normalizeAcceptanceStatus(value, health) {
  const selected = value ?? (health === "healthy" ? "recorded" : "pending");
  if (!["accepted", "blocked", "pending", "recorded", "waiting"].includes(selected)) {
    throw new SyntaxError(`unsupported log.emit acceptanceStatus ${selected}`);
  }
  return selected;
}

function buildLogOperationalHealth(ast) {
  const retryable = ast.retry === "bounded" || ast.retry === "resume";
  const failureState = ast.health === "failed"
    ? "operator-action-required"
    : ast.health === "recovering"
      ? "retry-in-progress"
      : ast.health === "degraded"
        ? "preview-or-local-only"
        : "none";

  return Object.freeze({
    status: ast.health,
    degraded: ast.degraded || ast.health === "degraded" || ast.health === "failed",
    actionable: ast.health !== "healthy" || ast.level === "error",
    action: ast.action,
    failureState,
    retry: Object.freeze({
      mode: ast.retry,
      retryable,
      backoff: ast.backoff,
      resumeCursor: retryable ? ast.cursor : undefined,
    }),
  });
}

function buildScopeKey(parts) {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(":");
}

function buildAcceptanceAuditReceipt(ast, tenantBoundary, operationalHealth) {
  const acceptanceToken = ast.acceptanceToken || ast.idempotencyKey || ast.clientRequest || "";
  const receiptId = ast.receipt || buildScopeKey([
    "receipt",
    tenantBoundary.tenant || "tenant",
    tenantBoundary.workspace || ast.stream,
    ast.previewId || ast.subject,
    acceptanceToken || ast.cursor || "entry",
  ]);
  const validationRows = [
    Object.freeze({
      code: "mailchimp.log.acceptance.scope",
      status: tenantBoundary.allowed ? "pass" : "blocked",
      owner: "operator",
      nextAction: tenantBoundary.nextAction,
      detail: tenantBoundary.allowed
        ? "Acceptance audit receipt is scoped to the tenant boundary."
        : "Acceptance audit receipt is waiting on tenant boundary repair.",
    }),
    Object.freeze({
      code: "mailchimp.log.acceptance.token",
      status: acceptanceToken ? "pass" : "pending",
      owner: "runtime",
      nextAction: acceptanceToken ? "append_scoped_audit_log" : "bind_acceptance_token",
      detail: acceptanceToken
        ? "Acceptance token is available for restart-safe replay."
        : "Acceptance token is missing from the log binding.",
    }),
    Object.freeze({
      code: "mailchimp.log.acceptance.health",
      status: operationalHealth.status === "failed" ? "blocked" : operationalHealth.degraded ? "pending" : "pass",
      owner: operationalHealth.degraded ? "operator" : "runtime",
      nextAction: operationalHealth.action,
      detail: operationalHealth.degraded
        ? "Acceptance audit receipt is attached to a degraded or failed runtime signal."
        : "Acceptance audit receipt is attached to a healthy runtime signal.",
    }),
  ];
  const blocked = validationRows.filter((row) => row.status === "blocked");
  const pending = validationRows.filter((row) => row.status === "pending");
  const status = ast.acceptanceStatus === "accepted" && blocked.length === 0 && pending.length === 0
    ? "accepted"
    : blocked.length > 0
      ? "blocked"
      : pending.length > 0
        ? "waiting"
        : ast.acceptanceStatus;

  return Object.freeze({
    protocol: "aios.log-acceptance-receipt.mailchimp.v1",
    receiptId,
    previewId: ast.previewId,
    acceptanceToken,
    status,
    accepted: status === "accepted",
    auditRef: tenantBoundary.auditRef,
    scopeKey: tenantBoundary.scopeKey,
    nextAction: blocked[0]?.nextAction
      || pending[0]?.nextAction
      || (status === "accepted" ? "append_acceptance_audit_receipt" : "request_operator_acceptance"),
    validationSummary: Object.freeze({
      total: validationRows.length,
      passed: validationRows.filter((row) => row.status === "pass").length,
      blocked: blocked.length,
      pending: pending.length,
    }),
    validationRows: Object.freeze(validationRows),
    restartSemantics: Object.freeze({
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-log-acceptance-receipt",
      resumeFromAcceptanceToken: acceptanceToken,
      externalWritesPerformed: false,
    }),
  });
}

function buildAcceptanceAppendCommand(ast, tenantBoundary, operationalHealth, acceptanceReceipt) {
  const commandId = buildScopeKey([
    "logcmd",
    tenantBoundary.tenant || "tenant",
    tenantBoundary.workspace || ast.stream,
    acceptanceReceipt.receiptId,
  ]);
  const blocked = tenantBoundary.allowed !== true || acceptanceReceipt.status === "blocked";
  const waiting = !blocked && acceptanceReceipt.status === "waiting";
  const ready = !blocked && !waiting;
  const state = blocked ? "blocked" : waiting ? "waiting" : "ready";
  const idempotencyKey = ast.idempotencyKey || ast.clientRequest || acceptanceReceipt.acceptanceToken || commandId;
  const resumeCursor = buildScopeKey([
    "logcursor",
    tenantBoundary.scopeKey,
    ast.cursor || ast.subject || ast.stream,
    acceptanceReceipt.status,
  ]);
  const releaseGateRows = Object.freeze([
    Object.freeze({
      code: "mailchimp.log.command.boundary",
      status: tenantBoundary.allowed ? "pass" : "blocked",
      owner: "operator",
      nextAction: tenantBoundary.nextAction,
      detail: tenantBoundary.allowed
        ? "Tenant boundary allows local audit log append."
        : "Tenant boundary blocks local audit log append.",
    }),
    Object.freeze({
      code: "mailchimp.log.command.acceptance",
      status: acceptanceReceipt.status === "blocked"
        ? "blocked"
        : acceptanceReceipt.status === "waiting"
          ? "waiting"
          : "pass",
      owner: acceptanceReceipt.status === "waiting" ? "operator" : "runtime",
      nextAction: acceptanceReceipt.nextAction,
      detail: acceptanceReceipt.accepted
        ? "Acceptance receipt is accepted for append replay."
        : `Acceptance receipt is ${acceptanceReceipt.status}.`,
    }),
    Object.freeze({
      code: "mailchimp.log.command.health",
      status: operationalHealth.status === "failed" ? "blocked" : operationalHealth.degraded ? "waiting" : "pass",
      owner: operationalHealth.degraded ? "operator" : "runtime",
      nextAction: operationalHealth.action,
      detail: operationalHealth.degraded
        ? "Runtime health requires review before the append command is released."
        : "Runtime health permits append command release.",
    }),
  ]);

  return Object.freeze({
    protocol: "aios.log-acceptance-append-command.mailchimp.v1",
    commandId,
    state,
    ready,
    stream: ast.stream,
    level: ast.level,
    subject: ast.subject,
    idempotencyKey,
    resumeCursor,
    scopeKey: tenantBoundary.scopeKey,
    auditRef: tenantBoundary.auditRef,
    acceptanceReceiptId: acceptanceReceipt.receiptId,
    acceptanceToken: acceptanceReceipt.acceptanceToken,
    release: Object.freeze({
      allowed: ready,
      blocked,
      waiting,
      nextAction: blocked
        ? tenantBoundary.nextAction
        : waiting
          ? acceptanceReceipt.nextAction
          : "append_scoped_audit_log",
      visibleStatus: blocked ? "audit-append-blocked" : waiting ? "audit-append-waiting" : "audit-append-ready",
    }),
    validationRows: releaseGateRows,
    validationSummary: Object.freeze({
      total: releaseGateRows.length,
      blocked: releaseGateRows.filter((row) => row.status === "blocked").length,
      waiting: releaseGateRows.filter((row) => row.status === "waiting").length,
      passed: releaseGateRows.filter((row) => row.status === "pass").length,
    }),
    restartSemantics: Object.freeze({
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-log-append-command-id",
      resumeFromCommandId: commandId,
      resumeCursor,
      externalWritesPerformed: false,
    }),
  });
}

function buildBoundaryHealthEvent(descriptor) {
  const boundary = descriptor.tenantBoundary;
  const health = descriptor.operationalHealth;
  const appendCommand = descriptor.acceptanceAppendCommand;
  const failedChecks = boundary.checks.filter((check) => check.ok !== true);
  const blocked = boundary.allowed !== true || appendCommand.state === "blocked";
  const waiting = !blocked && (appendCommand.state === "waiting" || descriptor.acceptanceReceipt.status === "waiting");
  const status = blocked ? "blocked" : waiting ? "waiting" : health.status;
  const retryable = blocked === false && (waiting || health.retry.retryable === true);
  return Object.freeze({
    protocol: "aios.log-boundary-health-event.mailchimp.v1",
    eventId: buildScopeKey([
      "log-boundary-health",
      boundary.scopeKey,
      descriptor.id,
      status,
    ]),
    stream: descriptor.payload.stream,
    level: descriptor.payload.level,
    status,
    degraded: health.degraded || waiting,
    actionable: blocked || waiting || health.actionable,
    scopeKey: boundary.scopeKey,
    auditRef: boundary.auditRef,
    tenant: boundary.tenant,
    workspace: boundary.workspace,
    actor: boundary.actor,
    policyVersion: boundary.policyVersion,
    boundary: Object.freeze({
      mode: boundary.boundary,
      allowed: boundary.allowed,
      nextAction: boundary.nextAction,
      missingPermissions: boundary.permissions.missing,
      failedCheckCodes: failedChecks.map((check) => check.code),
    }),
    appendCommand: Object.freeze({
      commandId: appendCommand.commandId,
      state: appendCommand.state,
      ready: appendCommand.ready,
      resumeCursor: appendCommand.resumeCursor,
      nextAction: appendCommand.release.nextAction,
      visibleStatus: appendCommand.release.visibleStatus,
    }),
    retry: Object.freeze({
      retryable,
      mode: retryable ? health.retry.mode === "none" ? "resume" : health.retry.mode : "manual",
      backoff: retryable ? health.retry.backoff : "none",
      resumeCursor: appendCommand.resumeCursor,
    }),
    failureState: blocked
      ? "tenant-boundary-blocked"
      : waiting
        ? "tenant-boundary-waiting"
        : health.failureState,
    actionableErrors: Object.freeze(failedChecks.map((check) => Object.freeze({
      code: check.code,
      severity: check.severity === "error" ? "error" : "warning",
      action: boundary.nextAction,
      detail: check.message,
    }))),
    restartSemantics: Object.freeze({
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-log-boundary-health-event",
      resumeFromCommandId: appendCommand.commandId,
      externalWritesPerformed: false,
    }),
  });
}

function buildLogBindingAnalyticsReport(descriptor) {
  const health = descriptor.operationalHealth;
  const boundary = descriptor.tenantBoundary;
  const receipt = descriptor.acceptanceReceipt;
  const appendCommand = descriptor.acceptanceAppendCommand;
  const boundaryHealth = descriptor.boundaryHealthEvent;
  const redactions = Array.isArray(descriptor.payload?.redactions) ? descriptor.payload.redactions : [];
  const boundaryFailures = boundary.checks.filter((check) => check.ok !== true);
  const releaseRows = appendCommand.validationRows.map((row) => Object.freeze({
    code: row.code,
    status: row.status,
    owner: row.owner,
    nextAction: row.nextAction,
    actionable: row.status !== "pass",
  }));
  const receiptRows = receipt.validationRows.map((row) => Object.freeze({
    code: row.code,
    status: row.status,
    owner: row.owner,
    nextAction: row.nextAction,
    actionable: row.status !== "pass",
  }));
  const blockedRows = [...releaseRows, ...receiptRows].filter((row) => row.status === "blocked");
  const waitingRows = [...releaseRows, ...receiptRows].filter((row) => row.status === "waiting" || row.status === "pending");
  const status = blockedRows.length > 0 || boundaryHealth.status === "blocked"
    ? "blocked"
    : waitingRows.length > 0 || boundaryHealth.status === "waiting"
      ? "waiting"
      : health.status === "failed"
        ? "blocked"
        : health.degraded
          ? "degraded"
          : "ready";
  const nextAction = blockedRows[0]?.nextAction
    || waitingRows[0]?.nextAction
    || boundaryHealth.appendCommand.nextAction
    || receipt.nextAction
    || "append_scoped_audit_log";
  const historySnapshots = Object.freeze([
    Object.freeze({
      id: buildScopeKey(["loghist", boundary.scopeKey, descriptor.id, "parsed"]),
      sequence: 1,
      type: "log-binding-parsed",
      stream: descriptor.payload.stream,
      level: descriptor.payload.level,
      subject: descriptor.subject,
      health: health.status,
    }),
    Object.freeze({
      id: buildScopeKey(["loghist", boundary.scopeKey, descriptor.id, "boundary"]),
      sequence: 2,
      type: "tenant-boundary-evaluated",
      status: boundary.allowed ? "ready" : "blocked",
      auditRef: boundary.auditRef,
      missingPermissions: boundary.permissions.missing,
      nextAction: boundary.nextAction,
    }),
    Object.freeze({
      id: buildScopeKey(["loghist", boundary.scopeKey, descriptor.id, "receipt"]),
      sequence: 3,
      type: "acceptance-receipt-evaluated",
      status: receipt.status,
      receiptId: receipt.receiptId,
      acceptanceToken: receipt.acceptanceToken,
      nextAction: receipt.nextAction,
    }),
    Object.freeze({
      id: buildScopeKey(["loghist", boundary.scopeKey, descriptor.id, "append"]),
      sequence: 4,
      type: "append-command-evaluated",
      status: appendCommand.state,
      commandId: appendCommand.commandId,
      resumeCursor: appendCommand.resumeCursor,
      nextAction: appendCommand.release.nextAction,
    }),
    Object.freeze({
      id: buildScopeKey(["loghist", boundary.scopeKey, descriptor.id, "finish", status]),
      sequence: 5,
      type: "log-binding-health-finished",
      status,
      exportReady: status === "ready" || status === "degraded",
      nextAction,
    }),
  ]);
  const timeline = Object.freeze(historySnapshots.map((snapshot) => Object.freeze({
    sequence: snapshot.sequence,
    event: snapshot.type,
    status: snapshot.status ?? health.status,
    nextAction: snapshot.nextAction ?? null,
    snapshotId: snapshot.id,
  })));
  const actionableErrors = Object.freeze([
    ...boundaryFailures.map((check) => Object.freeze({
      code: check.code,
      severity: check.severity === "error" ? "error" : "warning",
      owner: "operator",
      action: boundary.nextAction,
      detail: check.message,
    })),
    ...boundaryHealth.actionableErrors,
    ...blockedRows.map((row) => Object.freeze({
      code: row.code,
      severity: "error",
      owner: row.owner,
      action: row.nextAction,
      detail: "Log binding release row is blocked.",
    })),
    ...waitingRows.map((row) => Object.freeze({
      code: row.code,
      severity: "warning",
      owner: row.owner,
      action: row.nextAction,
      detail: "Log binding release row is waiting for a deterministic prerequisite.",
    })),
  ]);

  return Object.freeze({
    protocol: "aios.log-binding-analytics-report.mailchimp.v1",
    id: buildScopeKey(["logreport", boundary.scopeKey, descriptor.id, status]),
    entryId: descriptor.id,
    stream: descriptor.payload.stream,
    status,
    exportReady: status === "ready" || status === "degraded",
    nextAction,
    scope: Object.freeze({
      scopeKey: boundary.scopeKey,
      auditRef: boundary.auditRef,
      tenant: boundary.tenant,
      workspace: boundary.workspace,
      actor: boundary.actor,
      policyVersion: boundary.policyVersion,
    }),
    counters: Object.freeze({
      validationRows: releaseRows.length + receiptRows.length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      boundaryFailures: boundaryFailures.length,
      actionableErrors: actionableErrors.length,
      historySnapshots: historySnapshots.length,
      timelineEvents: timeline.length,
      redactionFields: redactions.length,
      retryable: boundaryHealth.retry.retryable ? 1 : 0,
    }),
    health: Object.freeze({
      status: health.status,
      degraded: health.degraded,
      failureState: boundaryHealth.failureState,
      retryable: boundaryHealth.retry.retryable,
      retryMode: boundaryHealth.retry.mode,
      backoff: boundaryHealth.retry.backoff,
      resumeCursor: boundaryHealth.retry.resumeCursor,
    }),
    releaseDecision: Object.freeze({
      boundaryAllowed: boundary.allowed,
      acceptanceStatus: receipt.status,
      appendCommandState: appendCommand.state,
      appendReady: appendCommand.ready,
      localOnly: true,
      externalWritesPerformed: false,
    }),
    validationRows: Object.freeze([...releaseRows, ...receiptRows]),
    actionableErrors,
    historySnapshots,
    timeline,
    exportSummary: Object.freeze({
      format: "aios.log-binding-analytics-summary.mailchimp.v1",
      status,
      exportReady: status === "ready" || status === "degraded",
      nextAction,
      blockerCodes: actionableErrors.filter((error) => error.severity === "error").map((error) => error.code),
      warningCodes: actionableErrors.filter((error) => error.severity === "warning").map((error) => error.code),
      historySnapshotIds: historySnapshots.map((snapshot) => snapshot.id),
      externalWritesPerformed: false,
    }),
  });
}

function buildLogRollbackReadinessEvidence(descriptor) {
  const health = descriptor.operationalHealth;
  const boundary = descriptor.tenantBoundary;
  const receipt = descriptor.acceptanceReceipt;
  const appendCommand = descriptor.acceptanceAppendCommand;
  const analytics = descriptor.analyticsReport;
  const boundaryBlocked = boundary.allowed !== true || appendCommand.state === "blocked";
  const waiting = appendCommand.state === "waiting" || receipt.status === "waiting";
  const healthBlocked = health.status === "failed";
  const queueImpact = boundaryBlocked || healthBlocked
    ? "block_rollback_queue"
    : waiting
      ? "wait_for_audit_acceptance"
      : health.degraded
        ? "degraded_runtime_warning"
        : "none";
  const evidenceRows = Object.freeze([
    Object.freeze({
      code: "log.emit.rollback.boundary",
      ok: boundaryBlocked === false,
      severity: boundaryBlocked ? "error" : "info",
      detail: boundaryBlocked
        ? "Log tenant boundary or append command blocks rollback readiness evidence."
        : "Log tenant boundary is ready for scoped audit append.",
      nextAction: boundary.nextAction,
    }),
    Object.freeze({
      code: "log.emit.rollback.acceptance",
      ok: waiting === false,
      severity: waiting ? "warning" : "info",
      detail: waiting
        ? `Log acceptance receipt is ${receipt.status}.`
        : `Log acceptance receipt is ${receipt.status}.`,
      nextAction: receipt.nextAction,
    }),
    Object.freeze({
      code: "log.emit.rollback.health",
      ok: healthBlocked === false,
      severity: healthBlocked ? "error" : health.degraded ? "warning" : "info",
      detail: healthBlocked
        ? "Log binding health failed before rollback readiness aggregation."
        : health.degraded
          ? `Log binding is degraded with failure state ${health.failureState}.`
          : "Log binding health is ready for rollback readiness aggregation.",
      nextAction: health.action,
    }),
    Object.freeze({
      code: "log.emit.rollback.analytics_export",
      ok: analytics.exportReady === true,
      severity: analytics.exportReady === true ? "info" : "warning",
      detail: analytics.exportReady
        ? "Log analytics report is export-ready."
        : "Log analytics report is waiting on boundary or acceptance state.",
      nextAction: analytics.nextAction,
    }),
  ]);
  const blockers = evidenceRows.filter((row) => row.severity === "error" && row.ok !== true).map((row) => row.code);
  const warnings = evidenceRows.filter((row) => row.severity === "warning" && row.ok !== true).map((row) => row.code);
  const ready = blockers.length === 0 && analytics.exportReady === true;

  return Object.freeze({
    protocol: "aios.log-rollback-readiness.mailchimp.v1",
    component: descriptor.payload.stream,
    entryId: descriptor.id,
    scopeKey: boundary.scopeKey,
    auditRef: boundary.auditRef,
    status: ready ? warnings.length > 0 ? "waiting" : "ready" : "blocked",
    ready,
    queueImpact,
    terminal: healthBlocked || boundaryBlocked,
    retryable: descriptor.boundaryHealthEvent.retry.retryable,
    retryAfterMs: 0,
    nextAction: blockers.length > 0
      ? evidenceRows.find((row) => blockers.includes(row.code))?.nextAction || "resolve_log_tenant_boundary"
      : warnings.length > 0
        ? evidenceRows.find((row) => warnings.includes(row.code))?.nextAction || analytics.nextAction
        : analytics.nextAction,
    failureState: descriptor.boundaryHealthEvent.failureState,
    exportReportId: analytics.id,
    exportReady: analytics.exportReady,
    blockerCodes: Object.freeze(blockers),
    warningCodes: Object.freeze(warnings),
    evidenceRows,
  });
}

function buildLogProviderOperationManifest(descriptor, options = {}) {
  const runtime = options.runtime && typeof options.runtime === "object" ? options.runtime : options;
  const source = runtime.providerOperation && typeof runtime.providerOperation === "object"
    ? runtime.providerOperation
    : runtime.mailchimpProviderOperation && typeof runtime.mailchimpProviderOperation === "object"
      ? runtime.mailchimpProviderOperation
      : {};
  const analytics = descriptor.analyticsReport;
  const boundary = descriptor.tenantBoundary;
  const receipt = descriptor.acceptanceReceipt;
  const appendCommand = descriptor.acceptanceAppendCommand;
  const readiness = descriptor.rollbackReadinessEvidence;
  const requiredCapabilities = Object.freeze([
    "adapter.mailchimp",
    "kernel.audit.append",
    "mailchimp.provider.status.read",
    "mailchimp.provider.audit.bind",
  ]);
  const offeredCapabilities = Object.freeze([...new Set([
    ...(Array.isArray(source.capabilities) ? source.capabilities : []),
    ...(Array.isArray(runtime.mailchimpCapabilities) ? runtime.mailchimpCapabilities : []),
    "kernel.audit.append",
    ...(boundary.allowed ? ["mailchimp.provider.audit.bind"] : []),
  ].map((capability) => String(capability ?? "").trim()).filter(Boolean))].sort());
  const missingCapabilities = Object.freeze(requiredCapabilities.filter((capability) => !offeredCapabilities.includes(capability)));
  const syncCursor = String(source.syncCursor || source.cursor || appendCommand.resumeCursor || "").trim();
  const providerRequestId = String(source.providerRequestId || source.requestId || appendCommand.commandId || "").trim();
  const handoffState = String(source.handoffState || source.state || (appendCommand.ready ? "ready" : appendCommand.state)).trim();
  const statusRef = String(source.statusRef || analytics.id || boundary.auditRef || "").trim();
  const exportReady = analytics.exportReady === true && readiness.exportReady === true;
  const validationRows = Object.freeze([
    Object.freeze({
      code: "log.emit.provider.capabilities",
      status: missingCapabilities.length === 0 ? "pass" : "waiting",
      owner: "adapter",
      nextAction: missingCapabilities.length === 0 ? "publish_log_provider_operation" : "negotiate_mailchimp_provider_capabilities",
      detail: missingCapabilities.length === 0
        ? "Log provider operation has the capabilities needed for Mailchimp audit handoff."
        : `Log provider operation is missing capabilities: ${missingCapabilities.join(", ")}.`,
    }),
    Object.freeze({
      code: "log.emit.provider.boundary",
      status: boundary.allowed ? "pass" : "blocked",
      owner: "operator",
      nextAction: boundary.nextAction,
      detail: boundary.allowed
        ? "Log provider operation is scoped to the tenant audit boundary."
        : "Log provider operation is blocked until the tenant audit boundary is resolved.",
    }),
    Object.freeze({
      code: "log.emit.provider.acceptance",
      status: receipt.accepted || receipt.status === "recorded" ? "pass" : receipt.status === "blocked" ? "blocked" : "waiting",
      owner: receipt.status === "blocked" || receipt.status === "waiting" ? "operator" : "runtime",
      nextAction: receipt.nextAction,
      detail: receipt.accepted || receipt.status === "recorded"
        ? "Log acceptance receipt is bound for provider audit handoff."
        : `Log acceptance receipt is ${receipt.status}.`,
    }),
    Object.freeze({
      code: "log.emit.provider.append_command",
      status: appendCommand.ready ? "pass" : appendCommand.state === "blocked" ? "blocked" : "waiting",
      owner: appendCommand.state === "blocked" ? "operator" : "runtime",
      nextAction: appendCommand.release.nextAction,
      detail: appendCommand.ready
        ? "Log append command is release-ready for provider operation metadata."
        : `Log append command is ${appendCommand.state}.`,
    }),
    Object.freeze({
      code: "log.emit.provider.export",
      status: exportReady ? "pass" : "waiting",
      owner: "runtime",
      nextAction: analytics.nextAction,
      detail: exportReady
        ? "Log analytics export is ready for provider operation metadata."
        : "Log analytics export is waiting on audit binding state.",
    }),
  ]);
  const blocked = validationRows.filter((row) => row.status === "blocked");
  const waiting = validationRows.filter((row) => row.status === "waiting");
  const status = blocked.length > 0 ? "blocked" : waiting.length > 0 ? "waiting" : "ready";

  return Object.freeze({
    protocol: "aios.log-provider-operation.mailchimp.v1",
    operationId: buildScopeKey(["providerop", boundary.scopeKey, appendCommand.commandId]),
    component: descriptor.payload.stream,
    provider: "mailchimp",
    service: "marketing",
    status,
    ready: status === "ready",
    nextAction: blocked[0]?.nextAction || waiting[0]?.nextAction || "continue_rollback_readiness",
    providerRequestId,
    statusRef,
    handoffState,
    sync: Object.freeze({
      cursor: syncCursor,
      state: status === "ready" ? "ready" : status,
      analyticsReportId: analytics.id,
      acceptanceReceiptId: receipt.receiptId,
      appendCommandId: appendCommand.commandId,
    }),
    capabilityNegotiation: Object.freeze({
      required: requiredCapabilities,
      offered: offeredCapabilities,
      missing: missingCapabilities,
      satisfied: missingCapabilities.length === 0,
    }),
    health: Object.freeze({
      state: descriptor.operationalHealth.status,
      failureState: descriptor.boundaryHealthEvent.failureState,
      retryable: descriptor.boundaryHealthEvent.retry.retryable,
      retryAfterMs: 0,
      rollbackReadinessStatus: readiness.status,
      queueImpact: readiness.queueImpact,
    }),
    validationRows,
    counters: Object.freeze({
      validationRows: validationRows.length,
      blockedRows: blocked.length,
      waitingRows: waiting.length,
      missingCapabilities: missingCapabilities.length,
      boundaryFailures: boundary.checks.filter((check) => check.ok !== true).length,
      acceptanceWaiting: receipt.status === "waiting" ? 1 : 0,
    }),
    externalHandoff: Object.freeze({
      localOnly: true,
      externalWritesPerformed: false,
      requestId: providerRequestId,
      state: handoffState,
      statusRef,
      auditRef: boundary.auditRef,
    }),
  });
}

function buildLogRollbackReadinessPacket(descriptor) {
  const readiness = descriptor.rollbackReadinessEvidence;
  const analytics = descriptor.analyticsReport;
  const providerOperation = descriptor.providerOperationManifest;
  const receipt = descriptor.acceptanceReceipt;
  const appendCommand = descriptor.acceptanceAppendCommand;
  const boundary = descriptor.tenantBoundary;
  const blocked = readiness.status === "blocked" || providerOperation.status === "blocked" || appendCommand.state === "blocked";
  const waiting = blocked === false && (
    readiness.status === "waiting"
      || providerOperation.status === "waiting"
      || receipt.status === "waiting"
      || appendCommand.state === "waiting"
  );
  const status = blocked ? "blocked" : waiting ? "waiting" : "ready";
  const packetRows = Object.freeze([
    Object.freeze({
      code: "log.emit.packet.boundary",
      status: boundary.allowed ? "pass" : "blocked",
      owner: "operator",
      nextAction: boundary.nextAction,
      detail: boundary.allowed
        ? "Log tenant boundary is available for rollback readiness aggregation."
        : "Log tenant boundary blocks rollback readiness aggregation.",
    }),
    Object.freeze({
      code: "log.emit.packet.acceptance",
      status: receipt.status === "blocked" ? "blocked" : receipt.status === "waiting" ? "waiting" : "pass",
      owner: receipt.status === "waiting" || receipt.status === "blocked" ? "operator" : "runtime",
      nextAction: receipt.nextAction,
      detail: `Log acceptance receipt is ${receipt.status}.`,
    }),
    Object.freeze({
      code: "log.emit.packet.append",
      status: appendCommand.state === "blocked" ? "blocked" : appendCommand.state === "waiting" ? "waiting" : "pass",
      owner: appendCommand.state === "blocked" ? "operator" : "runtime",
      nextAction: appendCommand.release.nextAction,
      detail: `Log append command is ${appendCommand.state}.`,
    }),
    Object.freeze({
      code: "log.emit.packet.provider",
      status: providerOperation.status,
      owner: providerOperation.status === "blocked" ? "adapter" : "runtime",
      nextAction: providerOperation.nextAction,
      detail: providerOperation.ready
        ? "Log provider operation is ready for rollback aggregation."
        : `Log provider operation is ${providerOperation.status}.`,
    }),
    Object.freeze({
      code: "log.emit.packet.analytics_export",
      status: analytics.exportReady ? analytics.status : "waiting",
      owner: "runtime",
      nextAction: analytics.nextAction,
      detail: analytics.exportReady
        ? "Log analytics export is attached to the readiness packet."
        : "Log analytics export is waiting on audit binding state.",
    }),
  ]);
  const blockedRows = packetRows.filter((row) => row.status === "blocked");
  const waitingRows = packetRows.filter((row) => row.status === "waiting");

  return Object.freeze({
    protocol: "aios.runtime-rollback-readiness-packet.mailchimp.v1",
    packetId: buildScopeKey(["rrp", "log", boundary.scopeKey, descriptor.id]),
    componentType: "log_emit",
    component: descriptor.payload.stream,
    entryId: descriptor.id,
    scopeKey: boundary.scopeKey,
    auditRef: boundary.auditRef,
    status,
    ready: status === "ready",
    nextAction: blockedRows[0]?.nextAction || waitingRows[0]?.nextAction || "continue_rollback_readiness",
    queueImpact: readiness.queueImpact,
    terminal: readiness.terminal || blocked,
    retryable: readiness.retryable || descriptor.boundaryHealthEvent.retry.retryable,
    retryAfterMs: readiness.retryAfterMs,
    exportReady: analytics.exportReady,
    exportReportId: analytics.id,
    providerOperationId: providerOperation.operationId,
    owner: blockedRows[0]?.owner || waitingRows[0]?.owner || "runtime",
    failureState: readiness.failureState,
    blockerCodes: Object.freeze([
      ...readiness.blockerCodes,
      ...providerOperation.validationRows.filter((row) => row.status === "blocked").map((row) => row.code),
      ...appendCommand.validationRows.filter((row) => row.status === "blocked").map((row) => row.code),
    ]),
    warningCodes: Object.freeze([
      ...readiness.warningCodes,
      ...providerOperation.validationRows.filter((row) => row.status === "waiting").map((row) => row.code),
      ...appendCommand.validationRows.filter((row) => row.status === "waiting").map((row) => row.code),
    ]),
    readinessEvidence: readiness,
    packetRows,
    counters: Object.freeze({
      packetRows: packetRows.length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      analyticsHistorySnapshots: analytics.counters.historySnapshots,
      providerMissingCapabilities: providerOperation.counters.missingCapabilities,
      acceptanceWaiting: receipt.status === "waiting" ? 1 : 0,
    }),
  });
}

function buildLogRuntimeHandoffDigest(descriptor) {
  const packet = descriptor.rollbackReadinessPacket;
  const analytics = descriptor.analyticsReport;
  const receipt = descriptor.acceptanceReceipt;
  const appendCommand = descriptor.acceptanceAppendCommand;
  const boundary = descriptor.tenantBoundary;
  const providerOperation = descriptor.providerOperationManifest;
  const boundaryHealth = descriptor.boundaryHealthEvent;
  const blocked = packet.status === "blocked"
    || providerOperation.status === "blocked"
    || appendCommand.state === "blocked"
    || boundary.allowed !== true;
  const waiting = blocked === false && (
    packet.status === "waiting"
      || providerOperation.status === "waiting"
      || appendCommand.state === "waiting"
      || receipt.status === "waiting"
      || boundaryHealth.retry.retryable === true
  );
  const digestStatus = blocked ? "blocked" : waiting ? "waiting" : analytics.status === "degraded" ? "degraded" : "ready";
  const blockedRows = Object.freeze([
    ...packet.packetRows.filter((row) => row.status === "blocked"),
    ...analytics.validationRows.filter((row) => row.status === "blocked"),
  ]);
  const waitingRows = Object.freeze([
    ...packet.packetRows.filter((row) => row.status === "waiting"),
    ...analytics.validationRows.filter((row) => row.status === "waiting" || row.status === "pending"),
  ]);
  const nextAction = blockedRows[0]?.nextAction
    || waitingRows[0]?.nextAction
    || appendCommand.release.nextAction
    || packet.nextAction;
  const restartToken = buildScopeKey([
    boundary.scopeKey,
    appendCommand.commandId,
    receipt.receiptId,
    receipt.status,
  ]);

  return Object.freeze({
    protocol: "aios.runtime-handoff-digest.mailchimp.v1",
    componentType: "log_emit",
    component: descriptor.payload.stream,
    digestId: buildScopeKey(["rhd", "log", boundary.scopeKey, descriptor.id, digestStatus]),
    status: digestStatus,
    ready: digestStatus === "ready" || digestStatus === "degraded",
    clientVisibleStatus: appendCommand.release.visibleStatus,
    nextAction,
    owner: blockedRows[0]?.owner || waitingRows[0]?.owner || packet.owner || "runtime",
    request: Object.freeze({
      entryId: descriptor.id,
      stream: descriptor.payload.stream,
      level: descriptor.payload.level,
      clientRequest: descriptor.payload.clientRequest,
      cursor: descriptor.payload.cursor,
      auditRef: boundary.auditRef,
      scopeKey: boundary.scopeKey,
    }),
    restart: Object.freeze({
      token: restartToken,
      resumeMode: receipt.accepted ? "accepted-receipt-replay" : "scoped-audit-replay",
      resumeCursor: appendCommand.resumeCursor,
      duplicateCommandPolicy: appendCommand.restartSemantics.duplicateCommandPolicy,
      replaySafe: appendCommand.restartSemantics.replaySafe,
      externalWritesPerformed: false,
    }),
    health: Object.freeze({
      state: descriptor.operationalHealth.status,
      degraded: descriptor.operationalHealth.degraded || boundaryHealth.degraded,
      actionable: boundaryHealth.actionable,
      failureState: boundaryHealth.failureState,
      retryable: boundaryHealth.retry.retryable,
      retryMode: boundaryHealth.retry.mode,
      backoff: boundaryHealth.retry.backoff,
    }),
    readiness: Object.freeze({
      packetId: packet.packetId,
      packetStatus: packet.status,
      rollbackStatus: descriptor.rollbackReadinessEvidence.status,
      queueImpact: descriptor.rollbackReadinessEvidence.queueImpact,
      analyticsReportId: analytics.id,
      analyticsStatus: analytics.status,
      exportReady: analytics.exportReady,
      providerOperationId: providerOperation.operationId,
      providerOperationStatus: providerOperation.status,
      acceptanceReceiptId: receipt.receiptId,
      acceptanceStatus: receipt.status,
      appendCommandId: appendCommand.commandId,
      appendCommandState: appendCommand.state,
      blockerCodes: Object.freeze([...new Set([
        ...packet.blockerCodes,
        ...analytics.exportSummary.blockerCodes,
        ...blockedRows.map((row) => row.code),
      ])].sort()),
      warningCodes: Object.freeze([...new Set([
        ...packet.warningCodes,
        ...analytics.exportSummary.warningCodes,
        ...waitingRows.map((row) => row.code),
      ])].sort()),
    }),
    clientControls: Object.freeze({
      boundaryAllowed: boundary.allowed,
      accepted: receipt.accepted,
      acceptanceStatus: receipt.status,
      canAppend: appendCommand.ready,
      canReplay: appendCommand.restartSemantics.replaySafe,
      canRollback: packet.queueImpact !== "block_rollback_queue",
      canExport: analytics.exportReady,
    }),
    summary: Object.freeze({
      validationRows: blockedRows.length + waitingRows.length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      providerMissingCapabilities: providerOperation.counters.missingCapabilities,
      timelineEvents: analytics.timeline.length,
      redactionFields: analytics.counters.redactionFields,
    }),
  });
}

function buildLogOperatorReadinessHandoff(descriptor) {
  const packet = descriptor.rollbackReadinessPacket;
  const analytics = descriptor.analyticsReport;
  const receipt = descriptor.acceptanceReceipt;
  const appendCommand = descriptor.acceptanceAppendCommand;
  const boundary = descriptor.tenantBoundary;
  const providerOperation = descriptor.providerOperationManifest;
  const digest = descriptor.runtimeHandoffDigest;
  const blockedRows = Object.freeze([
    ...packet.packetRows.filter((row) => row.status === "blocked"),
    ...analytics.validationRows.filter((row) => row.status === "blocked"),
  ]);
  const waitingRows = Object.freeze([
    ...packet.packetRows.filter((row) => row.status === "waiting"),
    ...analytics.validationRows.filter((row) => row.status === "waiting" || row.status === "pending"),
  ]);
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : analytics.status === "degraded"
        ? "degraded"
        : "ready";
  const primaryRow = blockedRows[0] || waitingRows[0] || packet.packetRows.find((row) => row.status === "pass") || null;
  const nextSteps = Object.freeze([
    ...packet.packetRows,
    ...analytics.validationRows,
  ].map((row) => Object.freeze({
    code: row.code,
    status: row.status,
    owner: row.owner,
    nextAction: row.nextAction,
    clientVisible: true,
    detail: row.detail,
  })));

  return Object.freeze({
    protocol: "aios.operator-readiness-handoff.mailchimp.v1",
    componentType: "log_emit",
    component: descriptor.payload.stream,
    handoffId: buildScopeKey(["orh", "log", boundary.scopeKey, descriptor.id, status]),
    status,
    ready: status === "ready" || status === "degraded",
    owner: primaryRow?.owner || digest.owner || packet.owner || "runtime",
    nextAction: primaryRow?.nextAction || digest.nextAction || packet.nextAction,
    visibleStatus: appendCommand.release.visibleStatus,
    title: `Audit log readiness for ${descriptor.payload.stream}`,
    summary: status === "blocked"
      ? `Audit log handoff is blocked by ${blockedRows[0]?.code || "tenant boundary"}.`
      : status === "waiting"
        ? `Audit log handoff is waiting on ${waitingRows[0]?.code || receipt.nextAction}.`
        : status === "degraded"
          ? "Audit log handoff can continue with degraded runtime evidence."
          : "Audit log handoff is ready for rollback workflow aggregation.",
    scope: Object.freeze({
      scopeKey: boundary.scopeKey,
      tenant: boundary.tenant,
      workspace: boundary.workspace,
      auditRef: boundary.auditRef,
      actor: boundary.actor,
      policyVersion: boundary.policyVersion,
    }),
    readiness: Object.freeze({
      packetId: packet.packetId,
      packetStatus: packet.status,
      queueImpact: packet.queueImpact,
      analyticsReportId: analytics.id,
      exportReady: analytics.exportReady,
      providerOperationId: providerOperation.operationId,
      runtimeHandoffDigestId: digest.digestId,
      runtimeHandoffDigestStatus: digest.status,
      blockerCodes: Object.freeze([...new Set([
        ...packet.blockerCodes,
        ...analytics.exportSummary.blockerCodes,
        ...digest.readiness.blockerCodes,
      ])].sort()),
      warningCodes: Object.freeze([...new Set([
        ...packet.warningCodes,
        ...analytics.exportSummary.warningCodes,
        ...digest.readiness.warningCodes,
      ])].sort()),
    }),
    controls: Object.freeze({
      boundaryAllowed: boundary.allowed,
      acceptanceStatus: receipt.status,
      appendCommandState: appendCommand.state,
      appendReady: appendCommand.ready,
      canAppend: appendCommand.ready,
      canRollback: packet.queueImpact !== "block_rollback_queue",
      externalWritesPerformed: false,
    }),
    restart: Object.freeze({
      token: digest.restart.token,
      resumeMode: digest.restart.resumeMode,
      duplicateCommandPolicy: digest.restart.duplicateCommandPolicy,
      externalWritesPerformed: false,
    }),
    validationSummary: Object.freeze({
      total: nextSteps.length,
      passed: nextSteps.filter((row) => row.status === "pass").length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      primaryCode: primaryRow?.code || "",
    }),
    nextSteps,
  });
}

function normalizeRuntimeBoundary(runtime = {}) {
  const source = runtime.logBoundary && typeof runtime.logBoundary === "object"
    ? runtime.logBoundary
    : runtime.tenantBoundary && typeof runtime.tenantBoundary === "object"
      ? runtime.tenantBoundary
      : runtime.permissionBoundary && typeof runtime.permissionBoundary === "object"
        ? runtime.permissionBoundary
        : runtime.accessContext && typeof runtime.accessContext === "object"
          ? runtime.accessContext
          : {};
  const actor = source.actor && typeof source.actor === "object" ? source.actor : {};
  const scope = source.scope && typeof source.scope === "object" ? source.scope : {};
  const grant = source.grant && typeof source.grant === "object" ? source.grant : {};

  return Object.freeze({
    tenant: normalizeScopeIdentifier(source.tenant || source.tenantId || scope.tenant || scope.tenantId || runtime.tenant || runtime.tenantId, "tenant"),
    workspace: normalizeScopeIdentifier(source.workspace || source.workspaceId || scope.workspace || scope.workspaceId || runtime.workspace || runtime.workspaceId, "workspace"),
    actor: normalizeScopeIdentifier(source.actorId || actor.id || actor.actorId || runtime.actorId || runtime.operatorId, "actor"),
    roles: normalizeUniqueList(source.roles || actor.roles || grant.roles || runtime.roles),
    permissions: normalizeUniqueList(source.permissions || grant.permissions || runtime.permissions),
    policyVersion: normalizeScopeIdentifier(source.policyVersion || grant.policyVersion || runtime.permissionPolicyVersion, "policyVersion", "1"),
    source: normalizeScopeIdentifier(source.source || grant.source || runtime.permissionSource, "source", "runtime"),
  });
}

function buildLogTenantBoundary(ast, runtimeBoundary = {}) {
  const tenant = normalizeScopeIdentifier(ast.tenant || runtimeBoundary.tenant, "tenant");
  const workspace = normalizeScopeIdentifier(ast.workspace || runtimeBoundary.workspace, "workspace");
  const actor = normalizeScopeIdentifier(ast.actor || runtimeBoundary.actor, "actor");
  const roles = normalizeUniqueList([...(ast.roles || []), ...(runtimeBoundary.roles || [])].join(","));
  const permissions = normalizeUniqueList([...(ast.permissions || []), ...(runtimeBoundary.permissions || [])].join(","));
  const boundary = ast.boundary || "declared";
  const policyVersion = normalizeScopeIdentifier(ast.policyVersion || runtimeBoundary.policyVersion, "policyVersion", "1");
  const requiredPermissions = [
    tenant ? `tenant.${tenant}.audit` : "",
    workspace ? `workspace.${workspace}.audit` : "",
    ast.level === "error" || ast.health === "failed" ? "kernel.audit.error" : "kernel.audit.append",
  ].filter(Boolean).sort();
  const privileged = roles.some((role) => ["admin", "owner", "audit_admin", "rollback_operator"].includes(role));
  const missingPermissions = requiredPermissions.filter((permission) => !permissionAllows(permissions, permission));
  const scopeKey = buildScopeKey(["log", tenant || "unscoped-tenant", workspace || "unscoped-workspace", ast.stream]);
  const auditRef = ast.auditRef
    || buildScopeKey(["audit", tenant || "tenant", workspace || ast.stream, ast.idempotencyKey || ast.clientRequest || ast.cursor || "entry"]);
  const tenantBound = Boolean(!runtimeBoundary.tenant || !tenant || runtimeBoundary.tenant === tenant);
  const workspaceBound = Boolean(!runtimeBoundary.workspace || !workspace || runtimeBoundary.workspace === workspace);
  const allowed = boundary !== "blocked"
    && tenantBound
    && workspaceBound
    && (missingPermissions.length === 0 || privileged);

  return Object.freeze({
    protocol: "aios.log-tenant-boundary.mailchimp.v1",
    boundary,
    allowed,
    scopeKey,
    auditRef,
    policyVersion,
    source: runtimeBoundary.source || "source",
    tenant,
    workspace,
    actor,
    roles,
    permissions: Object.freeze({
      required: requiredPermissions,
      granted: permissions,
      missing: missingPermissions,
      privileged,
    }),
    checks: Object.freeze([
      Object.freeze({
        code: "mailchimp.log.boundary.tenant",
        ok: tenantBound,
        severity: tenantBound ? "info" : "error",
        message: tenantBound
          ? "Log tenant scope is compatible with runtime context."
          : "Log tenant scope differs from runtime context.",
      }),
      Object.freeze({
        code: "mailchimp.log.boundary.workspace",
        ok: workspaceBound,
        severity: workspaceBound ? "info" : "error",
        message: workspaceBound
          ? "Log workspace scope is compatible with runtime context."
          : "Log workspace scope differs from runtime context.",
      }),
      Object.freeze({
        code: "mailchimp.log.boundary.permissions",
        ok: missingPermissions.length === 0 || privileged,
        severity: missingPermissions.length === 0 || privileged ? "info" : "warning",
        message: missingPermissions.length === 0 || privileged
          ? "Log append is covered by declared audit permissions."
          : `Log append is missing audit permissions: ${missingPermissions.join(", ")}.`,
      }),
      Object.freeze({
        code: "mailchimp.log.boundary.mode",
        ok: boundary !== "blocked",
        severity: boundary !== "blocked" ? "info" : "error",
        message: boundary !== "blocked"
          ? `Log boundary mode is "${boundary}".`
          : "Log boundary mode blocks append handoff.",
      }),
    ]),
    nextAction: allowed ? "append_scoped_audit_log" : "resolve_log_tenant_boundary",
  });
}

function requireLogFields(fields) {
  for (const field of LOG_BINDING_GRAMMAR.requiredFields) {
    if (!fields[field]) throw new SyntaxError(`missing required log.emit field ${field}`);
  }
}

export function parseLogBinding(source) {
  const fields = parseLogAssignments(tokenizeLogSource(source));
  requireLogFields(fields);
  const level = normalizeLevel(fields.level);
  const health = normalizeHealth(fields.health, level);
  const retry = normalizeRetry(fields.retry, health);
  return Object.freeze({
    type: "LogBinding",
    command: LOG_BINDING_GRAMMAR.command,
    stream: fields.stream,
    level,
    subject: fields.subject ?? fields.stream,
    message: fields.message,
    claim: fields.claim ?? "runtime-reported",
    redact: normalizeList(fields.redact),
    retention: fields.retention ?? "session",
    clientRequest: normalizeLogIdentifier(fields.clientRequest, "clientRequest", undefined),
    idempotencyKey: normalizeLogIdentifier(fields.idempotencyKey, "idempotencyKey", undefined),
    cursor: normalizeLogIdentifier(fields.cursor, "cursor", undefined),
    recovery: normalizeRecovery(fields.recovery),
    health,
    retry,
    backoff: normalizeBackoff(fields.backoff, retry),
    degraded: normalizeBooleanToken(fields.degraded, health === "degraded" || health === "failed"),
    action: normalizeLogIdentifier(fields.action, "action", health === "healthy" ? "none" : "operator.review"),
    tenant: normalizeScopeIdentifier(fields.tenant, "tenant"),
    workspace: normalizeScopeIdentifier(fields.workspace, "workspace"),
    actor: normalizeScopeIdentifier(fields.actor, "actor"),
    roles: normalizeUniqueList(fields.roles),
    permissions: normalizeUniqueList(fields.permissions),
    boundary: normalizeBoundaryMode(fields.boundary),
    auditRef: normalizeScopeIdentifier(fields.auditRef, "auditRef"),
    policyVersion: normalizeScopeIdentifier(fields.policyVersion, "policyVersion", "1"),
    previewId: normalizeLogIdentifier(fields.previewId, "previewId", undefined),
    acceptanceToken: normalizeLogIdentifier(fields.acceptanceToken, "acceptanceToken", undefined),
    acceptanceStatus: normalizeAcceptanceStatus(fields.acceptanceStatus, health),
    receipt: normalizeLogIdentifier(fields.receipt, "receipt", undefined),
  });
}

export function compileLogBinding(source, options = {}) {
  const ast = typeof source === "string" ? parseLogBinding(source) : source;
  const entryId = options.entryId ?? ast.idempotencyKey ?? `log:${ast.stream}:${ast.level}`;
  const clientRequest = options.clientRequest ?? ast.clientRequest ?? entryId;
  const persistedCursor = options.cursor ?? ast.cursor ?? `${ast.stream}:${ast.subject}`;
  const operationalHealth = buildLogOperationalHealth({ ...ast, cursor: persistedCursor });
  const tenantBoundary = buildLogTenantBoundary(
    { ...ast, idempotencyKey: entryId, clientRequest, cursor: persistedCursor },
    normalizeRuntimeBoundary(options.runtime || options),
  );
  const acceptanceReceipt = buildAcceptanceAuditReceipt(
    { ...ast, idempotencyKey: entryId, clientRequest, cursor: persistedCursor },
    tenantBoundary,
    operationalHealth,
  );
  const acceptanceAppendCommand = buildAcceptanceAppendCommand(
    { ...ast, idempotencyKey: entryId, clientRequest, cursor: persistedCursor },
    tenantBoundary,
    operationalHealth,
    acceptanceReceipt,
  );
  const boundaryHealthEvent = buildBoundaryHealthEvent({
    id: entryId,
    payload: {
      stream: ast.stream,
      level: ast.level,
    },
    operationalHealth,
    tenantBoundary,
    acceptanceReceipt,
    acceptanceAppendCommand,
  });
  const analyticsReport = buildLogBindingAnalyticsReport({
    id: entryId,
    subject: ast.subject,
    payload: {
      stream: ast.stream,
      level: ast.level,
      redactions: ast.redact,
    },
    operationalHealth,
    tenantBoundary,
    acceptanceReceipt,
    acceptanceAppendCommand,
    boundaryHealthEvent,
  });
  const rollbackReadinessEvidence = buildLogRollbackReadinessEvidence({
    id: entryId,
    payload: {
      stream: ast.stream,
    },
    operationalHealth,
    tenantBoundary,
    acceptanceReceipt,
    acceptanceAppendCommand,
    boundaryHealthEvent,
    analyticsReport,
  });
  const providerOperationManifest = buildLogProviderOperationManifest({
    id: entryId,
    payload: {
      stream: ast.stream,
    },
    operationalHealth,
    tenantBoundary,
    acceptanceReceipt,
    acceptanceAppendCommand,
    boundaryHealthEvent,
    analyticsReport,
    rollbackReadinessEvidence,
  }, options);
  const rollbackReadinessPacket = buildLogRollbackReadinessPacket({
    id: entryId,
    payload: {
      stream: ast.stream,
    },
    tenantBoundary,
    acceptanceReceipt,
    acceptanceAppendCommand,
    boundaryHealthEvent,
    analyticsReport,
    rollbackReadinessEvidence,
    providerOperationManifest,
  });
  const runtimeHandoffDigest = buildLogRuntimeHandoffDigest({
    id: entryId,
    payload: {
      stream: ast.stream,
      level: ast.level,
      clientRequest,
      cursor: persistedCursor,
    },
    operationalHealth,
    tenantBoundary,
    acceptanceReceipt,
    acceptanceAppendCommand,
    boundaryHealthEvent,
    analyticsReport,
    rollbackReadinessEvidence,
    providerOperationManifest,
    rollbackReadinessPacket,
  });
  const operatorReadinessHandoff = buildLogOperatorReadinessHandoff({
    id: entryId,
    payload: {
      stream: ast.stream,
    },
    tenantBoundary,
    acceptanceReceipt,
    acceptanceAppendCommand,
    analyticsReport,
    providerOperationManifest,
    rollbackReadinessPacket,
    runtimeHandoffDigest,
  });
  const scopedStateKey = `${tenantBoundary.scopeKey}:${entryId}`;
  return Object.freeze({
    kind: "kernel.job.descriptor",
    apiVersion: "aios.runtime/v1",
    id: entryId,
    action: "log.emit",
    subject: ast.subject,
    payload: Object.freeze({
      stream: ast.stream,
      level: ast.level,
      message: ast.message,
      redactions: ast.redact,
      retention: ast.retention,
      clientRequest,
      idempotencyKey: entryId,
      cursor: persistedCursor,
      health: operationalHealth.status,
      degraded: operationalHealth.degraded,
      action: operationalHealth.action,
      tenant: tenantBoundary.tenant,
      workspace: tenantBoundary.workspace,
      actor: tenantBoundary.actor,
      boundary: tenantBoundary.boundary,
      auditRef: tenantBoundary.auditRef,
      previewId: ast.previewId,
      acceptanceToken: acceptanceReceipt.acceptanceToken,
      acceptanceStatus: acceptanceReceipt.status,
      acceptanceReceiptId: acceptanceReceipt.receiptId,
      acceptanceAppendCommandId: acceptanceAppendCommand.commandId,
      acceptanceAppendState: acceptanceAppendCommand.state,
      boundaryHealthEventId: boundaryHealthEvent.eventId,
      boundaryHealthStatus: boundaryHealthEvent.status,
      analyticsReportId: analyticsReport.id,
      analyticsStatus: analyticsReport.status,
      analyticsNextAction: analyticsReport.nextAction,
      rollbackReadinessStatus: rollbackReadinessEvidence.status,
      rollbackReadinessNextAction: rollbackReadinessEvidence.nextAction,
      providerOperationId: providerOperationManifest.operationId,
      providerOperationStatus: providerOperationManifest.status,
      providerOperationNextAction: providerOperationManifest.nextAction,
      rollbackReadinessPacketId: rollbackReadinessPacket.packetId,
      rollbackReadinessPacketStatus: rollbackReadinessPacket.status,
      rollbackReadinessPacketNextAction: rollbackReadinessPacket.nextAction,
      runtimeHandoffDigestId: runtimeHandoffDigest.digestId,
      runtimeHandoffDigestStatus: runtimeHandoffDigest.status,
      runtimeHandoffDigestNextAction: runtimeHandoffDigest.nextAction,
      operatorReadinessHandoffId: operatorReadinessHandoff.handoffId,
      operatorReadinessStatus: operatorReadinessHandoff.status,
      operatorReadinessNextAction: operatorReadinessHandoff.nextAction,
    }),
    capabilities: Object.freeze([
      ...LOG_BINDING_STDLIB.capabilities,
      ...(tenantBoundary.allowed ? ["kernel.audit.scope.bound"] : ["kernel.audit.scope.blocked"]),
    ]),
    memory: Object.freeze({
      reservationMiB: 1,
      scope: tenantBoundary.scopeKey,
      persistedStateKey: scopedStateKey,
      tenant: tenantBoundary.tenant,
      workspace: tenantBoundary.workspace,
    }),
    persistedState: Object.freeze({
      key: scopedStateKey,
      clientRequest,
      cursor: persistedCursor,
      idempotencyKey: entryId,
      restartSafeStatus: "committed-or-replayable",
      recovery: ast.recovery,
      health: operationalHealth.status,
      failureState: operationalHealth.failureState,
      retryMode: operationalHealth.retry.mode,
      tenantBoundary: Object.freeze({
        protocol: tenantBoundary.protocol,
        allowed: tenantBoundary.allowed,
        scopeKey: tenantBoundary.scopeKey,
        auditRef: tenantBoundary.auditRef,
        tenant: tenantBoundary.tenant,
        workspace: tenantBoundary.workspace,
        actor: tenantBoundary.actor,
        policyVersion: tenantBoundary.policyVersion,
        nextAction: tenantBoundary.nextAction,
      }),
      acceptanceReceipt: Object.freeze({
        receiptId: acceptanceReceipt.receiptId,
        previewId: acceptanceReceipt.previewId,
        acceptanceToken: acceptanceReceipt.acceptanceToken,
        status: acceptanceReceipt.status,
        accepted: acceptanceReceipt.accepted,
        nextAction: acceptanceReceipt.nextAction,
      }),
      acceptanceAppendCommand: Object.freeze({
        commandId: acceptanceAppendCommand.commandId,
        state: acceptanceAppendCommand.state,
        ready: acceptanceAppendCommand.ready,
        idempotencyKey: acceptanceAppendCommand.idempotencyKey,
        resumeCursor: acceptanceAppendCommand.resumeCursor,
        nextAction: acceptanceAppendCommand.release.nextAction,
        visibleStatus: acceptanceAppendCommand.release.visibleStatus,
      }),
      boundaryHealthEvent: Object.freeze({
        eventId: boundaryHealthEvent.eventId,
        status: boundaryHealthEvent.status,
        degraded: boundaryHealthEvent.degraded,
        actionable: boundaryHealthEvent.actionable,
        failureState: boundaryHealthEvent.failureState,
        nextAction: boundaryHealthEvent.boundary.nextAction,
        retryable: boundaryHealthEvent.retry.retryable,
        resumeCursor: boundaryHealthEvent.retry.resumeCursor,
      }),
      analyticsReport: Object.freeze({
        reportId: analyticsReport.id,
        status: analyticsReport.status,
        exportReady: analyticsReport.exportReady,
        nextAction: analyticsReport.nextAction,
        historySnapshotIds: analyticsReport.exportSummary.historySnapshotIds,
      }),
      rollbackReadinessEvidence: Object.freeze({
        protocol: rollbackReadinessEvidence.protocol,
        status: rollbackReadinessEvidence.status,
        queueImpact: rollbackReadinessEvidence.queueImpact,
        nextAction: rollbackReadinessEvidence.nextAction,
        blockerCodes: rollbackReadinessEvidence.blockerCodes,
        warningCodes: rollbackReadinessEvidence.warningCodes,
      }),
      providerOperationManifest: Object.freeze({
        protocol: providerOperationManifest.protocol,
        operationId: providerOperationManifest.operationId,
        status: providerOperationManifest.status,
        nextAction: providerOperationManifest.nextAction,
        syncCursor: providerOperationManifest.sync.cursor,
        providerRequestId: providerOperationManifest.providerRequestId,
      }),
      rollbackReadinessPacket: Object.freeze({
        protocol: rollbackReadinessPacket.protocol,
        packetId: rollbackReadinessPacket.packetId,
        status: rollbackReadinessPacket.status,
        ready: rollbackReadinessPacket.ready,
        nextAction: rollbackReadinessPacket.nextAction,
        queueImpact: rollbackReadinessPacket.queueImpact,
        blockerCodes: rollbackReadinessPacket.blockerCodes,
        warningCodes: rollbackReadinessPacket.warningCodes,
      }),
      runtimeHandoffDigest: Object.freeze({
        protocol: runtimeHandoffDigest.protocol,
        digestId: runtimeHandoffDigest.digestId,
        status: runtimeHandoffDigest.status,
        ready: runtimeHandoffDigest.ready,
        nextAction: runtimeHandoffDigest.nextAction,
        restartToken: runtimeHandoffDigest.restart.token,
        blockerCodes: runtimeHandoffDigest.readiness.blockerCodes,
        warningCodes: runtimeHandoffDigest.readiness.warningCodes,
      }),
      operatorReadinessHandoff: Object.freeze({
        protocol: operatorReadinessHandoff.protocol,
        handoffId: operatorReadinessHandoff.handoffId,
        status: operatorReadinessHandoff.status,
        ready: operatorReadinessHandoff.ready,
        visibleStatus: operatorReadinessHandoff.visibleStatus,
        nextAction: operatorReadinessHandoff.nextAction,
        validationSummary: operatorReadinessHandoff.validationSummary,
      }),
    }),
    verifier: Object.freeze({
      claims: LOG_BINDING_STDLIB.verifierClaims,
      evidenceClaim: ast.claim,
      truthBoundary: "message-is-declared-by-runtime-not-external-fact",
      tenantBoundaryClaims: tenantBoundary.checks.map((check) => check.code),
    }),
    recovery: Object.freeze({
      statusEvents: ["queued", "appending", "committed", "failed"],
      retry: ast.recovery === "append-once" ? "idempotent-by-entry-id" : ast.recovery,
      retryBackoff: operationalHealth.retry,
      rollback: ast.recovery === "tombstone-on-conflict" ? "append-compensating-tombstone" : "preserve-committed-entry",
      boundary: tenantBoundary.allowed ? "scoped-replay" : "hold-for-boundary",
    }),
    operationalHealth,
    tenantBoundary,
    acceptanceReceipt,
    acceptanceAppendCommand,
    boundaryHealthEvent,
    analyticsReport,
    rollbackReadinessEvidence,
    providerOperationManifest,
    rollbackReadinessPacket,
    runtimeHandoffDigest,
    operatorReadinessHandoff,
  });
}

export function createLogRuntimeHandoff(source, options = {}) {
  const descriptor = compileLogBinding(source, options);
  return Object.freeze({
    adapter: "kernel.audit-log.runtime",
    descriptor,
    localOnly: true,
    externalWrites: false,
    persistedState: descriptor.persistedState,
    expectedReceipt: Object.freeze(["entryId", "committedAt", "redactionDigest", "status"]),
    operationalHealth: descriptor.operationalHealth,
    tenantBoundary: descriptor.tenantBoundary,
    acceptanceReceipt: descriptor.acceptanceReceipt,
    acceptanceAppendCommand: descriptor.acceptanceAppendCommand,
    boundaryHealthEvent: descriptor.boundaryHealthEvent,
    analyticsReport: descriptor.analyticsReport,
    rollbackReadinessEvidence: descriptor.rollbackReadinessEvidence,
    providerOperationManifest: descriptor.providerOperationManifest,
    rollbackReadinessPacket: descriptor.rollbackReadinessPacket,
    runtimeHandoffDigest: descriptor.runtimeHandoffDigest,
    operatorReadinessHandoff: descriptor.operatorReadinessHandoff,
    auditHandoff: Object.freeze({
      protocol: "aios.log-audit-handoff.mailchimp.v1",
      auditRef: descriptor.tenantBoundary.auditRef,
      scopeKey: descriptor.tenantBoundary.scopeKey,
      boundaryAllowed: descriptor.tenantBoundary.allowed,
      acceptanceReceiptId: descriptor.acceptanceReceipt.receiptId,
      acceptanceStatus: descriptor.acceptanceReceipt.status,
      acceptanceNextAction: descriptor.acceptanceReceipt.nextAction,
      appendCommandId: descriptor.acceptanceAppendCommand.commandId,
      appendCommandState: descriptor.acceptanceAppendCommand.state,
      appendResumeCursor: descriptor.acceptanceAppendCommand.resumeCursor,
      boundaryHealthEventId: descriptor.boundaryHealthEvent.eventId,
      boundaryHealthStatus: descriptor.boundaryHealthEvent.status,
      analyticsReportId: descriptor.analyticsReport.id,
      analyticsStatus: descriptor.analyticsReport.status,
      analyticsNextAction: descriptor.analyticsReport.nextAction,
      rollbackReadinessStatus: descriptor.rollbackReadinessEvidence.status,
      rollbackReadinessNextAction: descriptor.rollbackReadinessEvidence.nextAction,
      providerOperationId: descriptor.providerOperationManifest.operationId,
      providerOperationStatus: descriptor.providerOperationManifest.status,
      providerOperationNextAction: descriptor.providerOperationManifest.nextAction,
      rollbackReadinessPacketId: descriptor.rollbackReadinessPacket.packetId,
      rollbackReadinessPacketStatus: descriptor.rollbackReadinessPacket.status,
      rollbackReadinessPacketNextAction: descriptor.rollbackReadinessPacket.nextAction,
      runtimeHandoffDigestId: descriptor.runtimeHandoffDigest.digestId,
      runtimeHandoffDigestStatus: descriptor.runtimeHandoffDigest.status,
      runtimeHandoffDigestNextAction: descriptor.runtimeHandoffDigest.nextAction,
      runtimeHandoffDigestRestartToken: descriptor.runtimeHandoffDigest.restart.token,
      operatorReadinessHandoffId: descriptor.operatorReadinessHandoff.handoffId,
      operatorReadinessStatus: descriptor.operatorReadinessHandoff.status,
      operatorReadinessNextAction: descriptor.operatorReadinessHandoff.nextAction,
      boundaryHealthNextAction: descriptor.boundaryHealthEvent.boundary.nextAction,
      expectedReceipt: Object.freeze(["entryId", "committedAt", "scopeKey", "auditRef", "status"]),
      nextAction: descriptor.acceptanceAppendCommand.release.nextAction,
    }),
  });
}

export function summarizeLogBindingHealth(source, options = {}) {
  const descriptor = compileLogBinding(source, options);
  return Object.freeze({
    kind: "aios.runtime.log_health_summary",
    id: descriptor.id,
    stream: descriptor.payload.stream,
    level: descriptor.payload.level,
    status: descriptor.operationalHealth.status,
    degraded: descriptor.operationalHealth.degraded,
    actionable: descriptor.operationalHealth.actionable,
    action: descriptor.operationalHealth.action,
    retryMode: descriptor.operationalHealth.retry.mode,
    backoff: descriptor.operationalHealth.retry.backoff,
    failureState: descriptor.operationalHealth.failureState,
    tenantBoundaryAllowed: descriptor.tenantBoundary.allowed,
    scopeKey: descriptor.tenantBoundary.scopeKey,
    auditRef: descriptor.tenantBoundary.auditRef,
    boundaryNextAction: descriptor.tenantBoundary.nextAction,
    acceptanceReceiptId: descriptor.acceptanceReceipt.receiptId,
    acceptanceStatus: descriptor.acceptanceReceipt.status,
    acceptanceAccepted: descriptor.acceptanceReceipt.accepted,
    acceptanceNextAction: descriptor.acceptanceReceipt.nextAction,
    acceptanceAppendCommandId: descriptor.acceptanceAppendCommand.commandId,
    acceptanceAppendState: descriptor.acceptanceAppendCommand.state,
    acceptanceAppendReady: descriptor.acceptanceAppendCommand.ready,
    acceptanceAppendNextAction: descriptor.acceptanceAppendCommand.release.nextAction,
    acceptanceAppendResumeCursor: descriptor.acceptanceAppendCommand.resumeCursor,
    boundaryHealthEventId: descriptor.boundaryHealthEvent.eventId,
    boundaryHealthStatus: descriptor.boundaryHealthEvent.status,
    boundaryHealthActionable: descriptor.boundaryHealthEvent.actionable,
    boundaryHealthFailureState: descriptor.boundaryHealthEvent.failureState,
    boundaryHealthRetryable: descriptor.boundaryHealthEvent.retry.retryable,
    boundaryHealthErrorCodes: descriptor.boundaryHealthEvent.actionableErrors.map((error) => error.code),
    analyticsReportId: descriptor.analyticsReport.id,
    analyticsStatus: descriptor.analyticsReport.status,
    analyticsExportReady: descriptor.analyticsReport.exportReady,
    analyticsNextAction: descriptor.analyticsReport.nextAction,
    analyticsCounters: descriptor.analyticsReport.counters,
    analyticsBlockerCodes: descriptor.analyticsReport.exportSummary.blockerCodes,
    analyticsWarningCodes: descriptor.analyticsReport.exportSummary.warningCodes,
    analyticsHistorySnapshotIds: descriptor.analyticsReport.exportSummary.historySnapshotIds,
    providerOperationStatus: descriptor.providerOperationManifest.status,
    providerOperationNextAction: descriptor.providerOperationManifest.nextAction,
    providerOperationCounters: descriptor.providerOperationManifest.counters,
    providerOperationMissingCapabilities: descriptor.providerOperationManifest.capabilityNegotiation.missing,
    rollbackReadinessStatus: descriptor.rollbackReadinessEvidence.status,
    rollbackReadinessQueueImpact: descriptor.rollbackReadinessEvidence.queueImpact,
    rollbackReadinessNextAction: descriptor.rollbackReadinessEvidence.nextAction,
    rollbackReadinessBlockers: descriptor.rollbackReadinessEvidence.blockerCodes,
    rollbackReadinessWarnings: descriptor.rollbackReadinessEvidence.warningCodes,
    rollbackReadinessPacketStatus: descriptor.rollbackReadinessPacket.status,
    rollbackReadinessPacketNextAction: descriptor.rollbackReadinessPacket.nextAction,
    rollbackReadinessPacketCounters: descriptor.rollbackReadinessPacket.counters,
    runtimeHandoffDigestId: descriptor.runtimeHandoffDigest.digestId,
    runtimeHandoffDigestStatus: descriptor.runtimeHandoffDigest.status,
    runtimeHandoffDigestNextAction: descriptor.runtimeHandoffDigest.nextAction,
    runtimeHandoffDigestRestartToken: descriptor.runtimeHandoffDigest.restart.token,
    operatorReadinessHandoffId: descriptor.operatorReadinessHandoff.handoffId,
    operatorReadinessStatus: descriptor.operatorReadinessHandoff.status,
    operatorReadinessNextAction: descriptor.operatorReadinessHandoff.nextAction,
    operatorReadinessValidationSummary: descriptor.operatorReadinessHandoff.validationSummary,
  });
}

export {
  LOG_BINDING_EXAMPLE,
  LOG_BINDING_GRAMMAR,
  LOG_BINDING_STDLIB,
  buildAcceptanceAppendCommand,
  buildBoundaryHealthEvent,
  buildLogBindingAnalyticsReport,
  buildLogProviderOperationManifest,
  buildLogRuntimeHandoffDigest,
  buildLogOperatorReadinessHandoff,
  buildLogRollbackReadinessPacket,
  buildLogRollbackReadinessEvidence,
  buildLogTenantBoundary,
};
