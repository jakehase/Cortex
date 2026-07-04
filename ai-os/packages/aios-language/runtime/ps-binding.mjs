const PS_BINDING_GRAMMAR = Object.freeze({
  command: "process.snapshot",
  requiredFields: Object.freeze(["scope"]),
  optionalFields: Object.freeze([
    "filter",
    "columns",
    "includeMemory",
    "claim",
    "tenant",
    "workspace",
    "role",
    "audit",
    "health",
    "lastError",
    "retryCount",
    "retryAfter",
    "degraded",
  ]),
});

const PS_BINDING_STDLIB = Object.freeze({
  command: "process.snapshot",
  capabilities: Object.freeze(["kernel.process.inspect", "kernel.memory.read-summary", "kernel.audit.append"]),
  verifierClaims: Object.freeze(["ps.snapshot.local", "ps.memory.summary.only", "ps.no-process-mutation"]),
});

const PS_BINDING_EXAMPLE = `process.snapshot scope=mailchimp-sync filter=status:running columns=pid,name,status,memory includeMemory=true claim=kernel-observed tenant=mailchimp workspace=primary role=operator audit=req_123 health=degraded lastError=process-table-stale retryCount=1 retryAfter=15s degraded=true`;

function tokenizePsSource(source) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new TypeError("process snapshot source must be a non-empty string");
  }
  return source.trim().match(/[^\s="]+=(?:"(?:\\.|[^"\\])*"|[^\s]+)|[^\s]+/g) ?? [];
}

function parsePsAssignments(tokens) {
  if (tokens[0] !== PS_BINDING_GRAMMAR.command) throw new SyntaxError("expected process.snapshot command");
  const fields = {};
  for (const token of tokens.slice(1)) {
    const splitAt = token.indexOf("=");
    if (splitAt <= 0) throw new SyntaxError(`expected key=value field, received ${token}`);
    const rawValue = token.slice(splitAt + 1);
    fields[token.slice(0, splitAt)] = rawValue.startsWith("\"") && rawValue.endsWith("\"")
      ? rawValue.slice(1, -1).replace(/\\"/g, "\"")
      : rawValue;
  }
  return fields;
}

function normalizeColumns(value) {
  const columns = value ? value.split(",").filter(Boolean) : ["pid", "name", "status"];
  const allowed = new Set(["pid", "name", "status", "uptime", "memory", "image", "restart"]);
  for (const column of columns) {
    if (!allowed.has(column)) throw new SyntaxError(`unsupported process snapshot column ${column}`);
  }
  return Object.freeze([...new Set(columns)]);
}

function normalizeBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new SyntaxError(`expected boolean value, received ${value}`);
}

function normalizeScopeIdentifier(value, field, fallback) {
  const selected = value ?? fallback;
  if (!selected) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{1,127}$/.test(selected)) {
    throw new SyntaxError(`invalid process.snapshot ${field} ${selected}`);
  }
  return selected;
}

function normalizeRole(value) {
  const selected = value ?? "observer";
  if (!["observer", "operator", "admin"].includes(selected)) {
    throw new SyntaxError(`unsupported process.snapshot role ${selected}`);
  }
  return selected;
}

function normalizeHealth(value) {
  const selected = value ?? "healthy";
  if (!["healthy", "degraded", "unavailable"].includes(selected)) {
    throw new SyntaxError(`unsupported process.snapshot health ${selected}`);
  }
  return selected;
}

function normalizeRetryCount(value) {
  const selected = value ?? "0";
  if (!/^\d+$/.test(String(selected))) {
    throw new SyntaxError(`invalid process.snapshot retryCount ${selected}`);
  }
  const retryCount = Number(selected);
  if (retryCount > 25) {
    throw new SyntaxError(`process.snapshot retryCount must be 25 or lower, received ${selected}`);
  }
  return retryCount;
}

function normalizeRetryAfter(value, health, retryCount) {
  const selected = value ?? (health === "healthy" ? "0s" : `${Math.min(60, Math.max(5, retryCount * 10 || 10))}s`);
  if (!/^\d+[smh]$/.test(selected)) {
    throw new SyntaxError(`invalid process.snapshot retryAfter ${selected}`);
  }
  return selected;
}

function normalizeOperationalError(value, health) {
  const selected = value ?? (health === "healthy" ? undefined : "snapshot-runtime-degraded");
  if (!selected) return undefined;
  return normalizeScopeIdentifier(selected, "lastError", undefined);
}

function derivePermission(columns, includeMemory, role) {
  const wantsSensitiveRuntime = includeMemory || columns.includes("image") || columns.includes("restart");
  if (wantsSensitiveRuntime && role === "observer") {
    throw new SyntaxError("process.snapshot observer role cannot request memory, image, or restart columns");
  }
  return wantsSensitiveRuntime ? "runtime-detail" : "runtime-summary";
}

function deriveHealthMode(ast) {
  if (ast.health === "unavailable") return "failed-open-with-empty-report";
  if (ast.degraded || ast.health === "degraded") return "degraded-report-with-stale-marker";
  if (ast.retryCount > 0) return "healthy-after-retry";
  return "healthy";
}

function deriveSnapshotBackoff(ast) {
  if (ast.health === "healthy") {
    return Object.freeze({
      retryable: false,
      retryAfter: ast.retryAfter,
      retryCount: ast.retryCount,
      nextRetryCount: ast.retryCount,
      strategy: "none",
    });
  }
  return Object.freeze({
    retryable: ast.retryCount < 5,
    retryAfter: ast.retryAfter,
    retryCount: ast.retryCount,
    nextRetryCount: Math.min(25, ast.retryCount + 1),
    strategy: ast.health === "unavailable" ? "exponential-read-backoff" : "linear-read-backoff",
  });
}

function retryAfterToMs(value) {
  const match = /^(\d+)([smh])$/.exec(String(value));
  if (!match) return 0;
  const amount = Number(match[1]);
  if (match[2] === "h") return amount * 60 * 60 * 1000;
  if (match[2] === "m") return amount * 60 * 1000;
  return amount * 1000;
}

function deriveActionableSnapshotError(ast) {
  if (ast.health === "healthy" && !ast.lastError) return undefined;
  const mode = deriveHealthMode(ast);
  const cause = ast.lastError ?? "unknown";
  if (ast.health === "unavailable") {
    return `snapshot unavailable for ${ast.scope}; ${cause}; retry after ${ast.retryAfter}`;
  }
  return `snapshot ${mode} for ${ast.scope}; ${cause}; report may omit volatile process fields`;
}

function deriveSnapshotFailureState(ast, healthMode) {
  if (ast.health === "healthy" && ast.retryCount > 0) return "recovered-after-retry";
  if (ast.health === "healthy") return "none";
  if (ast.health === "degraded") return ast.includeMemory ? "memory-summary-degraded" : "process-table-stale";
  if (ast.health === "unavailable") return "process-inspector-unavailable";
  return healthMode;
}

function deriveSnapshotNextAction(ast, backoff) {
  if (ast.health === "healthy") return "publish_process_snapshot";
  if (backoff.retryable) return "retry_process_snapshot";
  if (ast.health === "unavailable") return "escalate_process_inspector_unavailable";
  return "publish_degraded_process_snapshot";
}

function buildSnapshotOperationalHealth(ast, snapshotId, auditId, backoff, healthMode, actionableError) {
  const failureState = deriveSnapshotFailureState(ast, healthMode);
  const retryAfterMs = retryAfterToMs(ast.retryAfter);
  const nextAction = deriveSnapshotNextAction(ast, backoff);
  return Object.freeze({
    protocol: "aios.process-snapshot-operational-health.mailchimp.v1",
    snapshotId,
    auditId,
    scope: ast.scope,
    tenant: ast.tenant,
    workspace: ast.workspace,
    state: ast.health,
    mode: healthMode,
    degraded: ast.degraded,
    reportCompleteness: ast.health === "healthy"
      ? "complete"
      : ast.health === "degraded"
        ? "partial"
        : "empty",
    failureState,
    retryable: backoff.retryable,
    retryAfter: ast.retryAfter,
    retryAfterMs,
    retryCount: ast.retryCount,
    nextRetryCount: backoff.nextRetryCount,
    backoff,
    actionableError,
    nextAction,
  });
}

function buildSnapshotExportReport(ast, context) {
  const {
    snapshotId,
    auditId,
    backoff,
    healthMode,
    actionableError,
    operationalHealth,
  } = context;
  const blocked = ast.health === "unavailable" && backoff.retryable === false;
  const waiting = ast.health !== "healthy" && backoff.retryable === true;
  const exportReady = blocked === false;
  const status = blocked ? "blocked" : waiting ? "waiting" : ast.health === "degraded" ? "degraded" : "ready";
  const nextAction = operationalHealth.nextAction;
  const columnRows = Object.freeze(ast.columns.map((column) => Object.freeze({
    column,
    sensitivity: ["memory", "image", "restart"].includes(column) || (column === "memory" && ast.includeMemory)
      ? "runtime-detail"
      : "runtime-summary",
    included: true,
  })));
  const historySnapshots = Object.freeze([
    Object.freeze({
      id: `pshist:${ast.tenant}:${ast.workspace}:${snapshotId}:parsed`,
      sequence: 1,
      type: "process-snapshot-parsed",
      status: "parsed",
      scope: ast.scope,
      filter: ast.filter,
      columns: ast.columns,
      includeMemory: ast.includeMemory,
    }),
    Object.freeze({
      id: `pshist:${ast.tenant}:${ast.workspace}:${snapshotId}:isolation`,
      sequence: 2,
      type: "process-snapshot-isolation-bound",
      status: ast.permission,
      tenant: ast.tenant,
      workspace: ast.workspace,
      role: ast.role,
      auditId,
    }),
    Object.freeze({
      id: `pshist:${ast.tenant}:${ast.workspace}:${snapshotId}:health`,
      sequence: 3,
      type: "process-snapshot-health-evaluated",
      status: ast.health,
      mode: healthMode,
      failureState: operationalHealth.failureState,
      retryable: backoff.retryable,
      retryAfter: ast.retryAfter,
      nextAction,
    }),
    Object.freeze({
      id: `pshist:${ast.tenant}:${ast.workspace}:${snapshotId}:report`,
      sequence: 4,
      type: "process-snapshot-report-shaped",
      status: operationalHealth.reportCompleteness,
      reportCompleteness: operationalHealth.reportCompleteness,
      degraded: operationalHealth.degraded,
      actionableError,
    }),
    Object.freeze({
      id: `pshist:${ast.tenant}:${ast.workspace}:${snapshotId}:export:${status}`,
      sequence: 5,
      type: "process-snapshot-export-shaped",
      status,
      exportReady,
      nextAction,
    }),
  ]);
  const timeline = Object.freeze(historySnapshots.map((snapshot) => Object.freeze({
    sequence: snapshot.sequence,
    event: snapshot.type,
    status: snapshot.status,
    snapshotId: snapshot.id,
    nextAction: snapshot.nextAction ?? null,
  })));
  const actionableErrors = Object.freeze([
    ...(actionableError ? [Object.freeze({
      code: `process.snapshot.${operationalHealth.failureState}`,
      severity: ast.health === "unavailable" ? "error" : "warning",
      owner: ast.health === "unavailable" ? "operator" : "runtime",
      action: nextAction,
      message: actionableError,
      retryable: backoff.retryable,
    })] : []),
    ...(ast.includeMemory && ast.permission !== "runtime-detail" ? [Object.freeze({
      code: "process.snapshot.memory_permission_mismatch",
      severity: "error",
      owner: "runtime",
      action: "bind_runtime_detail_permission",
      message: "Snapshot includes memory data without runtime-detail permission.",
      retryable: false,
    })] : []),
  ]);

  return Object.freeze({
    protocol: "aios.process-snapshot-export-report.mailchimp.v1",
    id: `psreport:${ast.tenant}:${ast.workspace}:${snapshotId}`,
    snapshotId,
    auditId,
    scope: ast.scope,
    tenant: ast.tenant,
    workspace: ast.workspace,
    role: ast.role,
    status,
    exportReady,
    nextAction,
    counters: Object.freeze({
      columns: ast.columns.length,
      detailColumns: columnRows.filter((row) => row.sensitivity === "runtime-detail").length,
      historySnapshots: historySnapshots.length,
      timelineEvents: timeline.length,
      actionableErrors: actionableErrors.length,
      retryCount: ast.retryCount,
      nextRetryCount: backoff.nextRetryCount,
      retryable: backoff.retryable ? 1 : 0,
      degraded: operationalHealth.degraded ? 1 : 0,
    }),
    boundary: Object.freeze({
      tenant: ast.tenant,
      workspace: ast.workspace,
      role: ast.role,
      permission: ast.permission,
      auditId,
      localOnly: true,
      externalWritesPerformed: false,
    }),
    health: Object.freeze({
      state: operationalHealth.state,
      mode: operationalHealth.mode,
      reportCompleteness: operationalHealth.reportCompleteness,
      failureState: operationalHealth.failureState,
      retryAfter: operationalHealth.retryAfter,
      retryAfterMs: operationalHealth.retryAfterMs,
      retryable: operationalHealth.retryable,
    }),
    columnRows,
    actionableErrors,
    historySnapshots,
    timeline,
    exportSummary: Object.freeze({
      format: "aios.process-snapshot-export-summary.mailchimp.v1",
      exportReady,
      status,
      nextAction,
      blockerCodes: actionableErrors.filter((error) => error.severity === "error").map((error) => error.code),
      warningCodes: actionableErrors.filter((error) => error.severity === "warning").map((error) => error.code),
      historySnapshotIds: historySnapshots.map((snapshot) => snapshot.id),
      timelineEventCount: timeline.length,
      reportCompleteness: operationalHealth.reportCompleteness,
      externalWritesPerformed: false,
    }),
  });
}

function buildSnapshotRollbackReadinessEvidence(descriptor, exportReport) {
  const health = descriptor.operationalHealth;
  const inspectorUnavailable = health.state === "unavailable";
  const degradedDetail = health.state === "degraded" || health.degraded === true;
  const blocked = inspectorUnavailable && health.retryable === false;
  const waiting = inspectorUnavailable && health.retryable === true;
  const queueImpact = blocked
    ? "block_rollback_queue"
    : waiting
      ? "wait_for_process_snapshot_retry"
      : degradedDetail
        ? "degraded_runtime_warning"
        : "none";
  const evidenceRows = Object.freeze([
    Object.freeze({
      code: "process.snapshot.rollback.inspector",
      ok: blocked === false,
      severity: blocked ? "error" : waiting ? "warning" : "info",
      detail: blocked
        ? "Process inspector is unavailable and retry budget is exhausted."
        : waiting
          ? `Process inspector is unavailable until retry after ${health.retryAfter}.`
          : `Process inspector report completeness is ${health.reportCompleteness}.`,
      nextAction: blocked ? "escalate_process_inspector_unavailable" : health.nextAction,
    }),
    Object.freeze({
      code: "process.snapshot.rollback.boundary",
      ok: descriptor.isolation.permission === "runtime-summary" || descriptor.isolation.role !== "observer",
      severity: descriptor.isolation.permission === "runtime-summary" || descriptor.isolation.role !== "observer" ? "info" : "error",
      detail: descriptor.isolation.permission === "runtime-summary" || descriptor.isolation.role !== "observer"
        ? "Snapshot isolation is compatible with its requested process detail level."
        : "Observer snapshot requested runtime-detail process fields.",
      nextAction: "bind_runtime_detail_permission",
    }),
    Object.freeze({
      code: "process.snapshot.rollback.export",
      ok: exportReport.exportReady === true,
      severity: exportReport.exportReady === true ? "info" : "warning",
      detail: exportReport.exportReady
        ? "Process snapshot export report is ready for rollback readiness aggregation."
        : "Process snapshot export report is waiting on inspector recovery.",
      nextAction: exportReport.nextAction,
    }),
  ]);
  const blockers = evidenceRows.filter((row) => row.severity === "error" && row.ok !== true).map((row) => row.code);
  const warnings = evidenceRows.filter((row) => row.severity === "warning" && row.ok !== true).map((row) => row.code);
  const ready = blockers.length === 0 && exportReport.exportReady === true;

  return Object.freeze({
    protocol: "aios.process-snapshot-rollback-readiness.mailchimp.v1",
    component: descriptor.subject,
    snapshotId: descriptor.id,
    auditId: descriptor.isolation.audit,
    status: ready ? warnings.length > 0 ? "waiting" : "ready" : "blocked",
    ready,
    queueImpact,
    terminal: blocked,
    retryable: health.retryable,
    retryAfterMs: health.retryAfterMs,
    nextAction: blockers.length > 0
      ? evidenceRows.find((row) => blockers.includes(row.code))?.nextAction || "escalate_process_inspector_unavailable"
      : warnings.length > 0
        ? evidenceRows.find((row) => warnings.includes(row.code))?.nextAction || health.nextAction
        : health.nextAction,
    failureState: health.failureState,
    reportCompleteness: health.reportCompleteness,
    exportReportId: exportReport.id,
    exportReady: exportReport.exportReady,
    blockerCodes: Object.freeze(blockers),
    warningCodes: Object.freeze(warnings),
    evidenceRows,
  });
}

function buildSnapshotRollbackReadinessPacket(descriptor) {
  const readiness = descriptor.rollbackReadinessEvidence;
  const exportReport = descriptor.exportReport;
  const health = descriptor.operationalHealth;
  const blocked = readiness.status === "blocked";
  const waiting = blocked === false && (readiness.status === "waiting" || health.retryable === true);
  const status = blocked ? "blocked" : waiting ? "waiting" : "ready";
  const packetRows = Object.freeze([
    Object.freeze({
      code: "process.snapshot.packet.inspector",
      status: health.state === "unavailable" && health.retryable === false ? "blocked" : health.retryable ? "waiting" : "pass",
      owner: health.state === "unavailable" ? "operator" : "runtime",
      nextAction: health.nextAction,
      detail: `Process snapshot inspector state is ${health.state}.`,
    }),
    Object.freeze({
      code: "process.snapshot.packet.isolation",
      status: descriptor.isolation.permission === "runtime-detail" || descriptor.isolation.role !== "observer" ? "pass" : "blocked",
      owner: "runtime",
      nextAction: "bind_runtime_detail_permission",
      detail: `Process snapshot isolation permission is ${descriptor.isolation.permission}.`,
    }),
    Object.freeze({
      code: "process.snapshot.packet.export",
      status: exportReport.exportReady ? exportReport.status : "waiting",
      owner: "runtime",
      nextAction: exportReport.nextAction,
      detail: exportReport.exportReady
        ? "Process snapshot export report is attached to the readiness packet."
        : "Process snapshot export report is waiting on inspector recovery.",
    }),
  ]);
  const blockedRows = packetRows.filter((row) => row.status === "blocked");
  const waitingRows = packetRows.filter((row) => row.status === "waiting");

  return Object.freeze({
    protocol: "aios.runtime-rollback-readiness-packet.mailchimp.v1",
    packetId: `rrp:process-snapshot:${descriptor.isolation.tenant}:${descriptor.isolation.workspace}:${descriptor.id}`,
    componentType: "process_snapshot",
    component: descriptor.subject,
    snapshotId: descriptor.id,
    auditRef: descriptor.isolation.audit,
    status,
    ready: status === "ready",
    nextAction: blockedRows[0]?.nextAction || waitingRows[0]?.nextAction || "continue_rollback_readiness",
    queueImpact: readiness.queueImpact,
    terminal: readiness.terminal,
    retryable: readiness.retryable,
    retryAfterMs: readiness.retryAfterMs,
    exportReady: exportReport.exportReady,
    exportReportId: exportReport.id,
    owner: blockedRows[0]?.owner || waitingRows[0]?.owner || "runtime",
    failureState: readiness.failureState,
    blockerCodes: Object.freeze([
      ...readiness.blockerCodes,
      ...packetRows.filter((row) => row.status === "blocked").map((row) => row.code),
    ]),
    warningCodes: Object.freeze([
      ...readiness.warningCodes,
      ...packetRows.filter((row) => row.status === "waiting").map((row) => row.code),
    ]),
    readinessEvidence: readiness,
    packetRows,
    counters: Object.freeze({
      packetRows: packetRows.length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      exportHistorySnapshots: exportReport.counters.historySnapshots,
      retryable: health.retryable ? 1 : 0,
      reportCompleteness: health.reportCompleteness,
    }),
  });
}

function buildSnapshotPreviewAcceptanceContract(descriptor) {
  const exportReport = descriptor.exportReport;
  const health = descriptor.operationalHealth;
  const readiness = descriptor.rollbackReadinessEvidence;
  const packet = descriptor.rollbackReadinessPacket;
  const blocked = packet.status === "blocked" || exportReport.exportReady === false;
  const waiting = blocked === false && (packet.status === "waiting" || health.retryable === true);
  const detailColumns = descriptor.payload.columns.filter((column) => ["memory", "image", "restart"].includes(column));
  const memoryDetailRequested = descriptor.payload.includeMemory || detailColumns.length > 0;
  const acceptanceRequired = memoryDetailRequested || health.degraded === true || packet.status !== "ready";
  const previewStatus = blocked ? "blocked" : waiting ? "waiting" : health.degraded ? "degraded" : "ready";
  const validationRows = Object.freeze([
    Object.freeze({
      code: "process.snapshot.preview.report",
      status: exportReport.exportReady ? exportReport.status === "waiting" ? "waiting" : "pass" : "blocked",
      owner: "runtime",
      nextAction: exportReport.nextAction,
      detail: exportReport.exportReady
        ? `Snapshot export report is ${exportReport.status}.`
        : "Snapshot export report is not ready for preview.",
    }),
    Object.freeze({
      code: "process.snapshot.preview.health",
      status: health.state === "unavailable" ? health.retryable ? "waiting" : "blocked" : health.degraded ? "waiting" : "pass",
      owner: health.state === "unavailable" ? "operator" : "runtime",
      nextAction: health.nextAction,
      detail: health.actionableError || `Snapshot health is ${health.state}.`,
    }),
    Object.freeze({
      code: "process.snapshot.preview.isolation",
      status: descriptor.isolation.permission === "runtime-detail" || descriptor.isolation.role !== "observer" ? "pass" : "blocked",
      owner: "runtime",
      nextAction: "bind_runtime_detail_permission",
      detail: `Snapshot isolation permission is ${descriptor.isolation.permission}.`,
    }),
    Object.freeze({
      code: "process.snapshot.preview.rollback_packet",
      status: packet.ready ? "pass" : packet.status,
      owner: packet.owner,
      nextAction: packet.nextAction,
      detail: packet.ready
        ? "Rollback readiness packet is available for snapshot preview."
        : `Rollback readiness packet is ${packet.status}.`,
    }),
  ]);
  const blockedRows = validationRows.filter((row) => row.status === "blocked");
  const waitingRows = validationRows.filter((row) => row.status === "waiting");
  const nextAction = blockedRows[0]?.nextAction
    || waitingRows[0]?.nextAction
    || (acceptanceRequired ? "request_snapshot_preview_acceptance" : "publish_process_snapshot");
  const columnPreviewRows = Object.freeze(descriptor.payload.columns.map((column) => Object.freeze({
    column,
    visible: true,
    sensitivity: ["memory", "image", "restart"].includes(column) || (column === "memory" && descriptor.payload.includeMemory)
      ? "runtime-detail"
      : "runtime-summary",
    acceptanceRequired: ["memory", "image", "restart"].includes(column),
  })));

  return Object.freeze({
    protocol: "aios.process-snapshot-preview-acceptance.mailchimp.v1",
    previewId: `pspreview:${descriptor.isolation.tenant}:${descriptor.isolation.workspace}:${descriptor.id}:${previewStatus}`,
    snapshotId: descriptor.id,
    subject: descriptor.subject,
    tenant: descriptor.isolation.tenant,
    workspace: descriptor.isolation.workspace,
    role: descriptor.isolation.role,
    permission: descriptor.isolation.permission,
    status: previewStatus,
    ready: blocked === false,
    accepted: blocked === false && acceptanceRequired === false,
    title: `Process snapshot preview for ${descriptor.subject}`,
    nextAction,
    userVisible: Object.freeze({
      statusLabel: previewStatus,
      reportCompleteness: health.reportCompleteness,
      degraded: health.degraded,
      retryAfter: health.retryAfter,
      retryAfterMs: health.retryAfterMs,
      columns: columnPreviewRows,
    }),
    acceptance: Object.freeze({
      required: acceptanceRequired,
      reason: memoryDetailRequested
        ? "runtime-detail-columns"
        : health.degraded
          ? "degraded-snapshot"
          : packet.status !== "ready"
            ? "rollback-readiness-not-ready"
            : "not-required",
      status: blocked
        ? "blocked"
        : acceptanceRequired
          ? "waiting"
          : "accepted_by_runtime_policy",
      token: `accept:${descriptor.id}:${exportReport.id}`,
      nextAction: acceptanceRequired ? "request_snapshot_preview_acceptance" : "publish_process_snapshot",
    }),
    readiness: Object.freeze({
      rollbackStatus: readiness.status,
      rollbackPacketStatus: packet.status,
      queueImpact: readiness.queueImpact,
      exportReady: exportReport.exportReady,
      reportCompleteness: health.reportCompleteness,
      blockerCodes: Object.freeze([
        ...readiness.blockerCodes,
        ...blockedRows.map((row) => row.code),
      ]),
      warningCodes: Object.freeze([
        ...readiness.warningCodes,
        ...waitingRows.map((row) => row.code),
      ]),
    }),
    handoff: Object.freeze({
      auditRef: descriptor.isolation.audit,
      exportReportId: exportReport.id,
      rollbackReadinessPacketId: packet.packetId,
      localOnly: true,
      externalWritesPerformed: false,
    }),
    validationSummary: Object.freeze({
      total: validationRows.length,
      passed: validationRows.filter((row) => row.status === "pass").length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      blockerCodes: blockedRows.map((row) => row.code),
      warningCodes: waitingRows.map((row) => row.code),
    }),
    validationRows,
  });
}

function buildSnapshotRuntimeHandoffDigest(descriptor) {
  const preview = descriptor.previewAcceptance;
  const packet = descriptor.rollbackReadinessPacket;
  const exportReport = descriptor.exportReport;
  const health = descriptor.operationalHealth;
  const blocked = preview.status === "blocked" || packet.status === "blocked" || exportReport.exportReady === false;
  const waiting = blocked === false && (
    preview.status === "waiting"
      || packet.status === "waiting"
      || health.retryable === true
  );
  const digestStatus = blocked ? "blocked" : waiting ? "waiting" : health.degraded ? "degraded" : "ready";
  const blockedRows = preview.validationRows.filter((row) => row.status === "blocked");
  const waitingRows = preview.validationRows.filter((row) => row.status === "waiting");
  const nextAction = blockedRows[0]?.nextAction
    || waitingRows[0]?.nextAction
    || preview.nextAction
    || packet.nextAction;
  const restartToken = [
    descriptor.isolation.tenant,
    descriptor.isolation.workspace,
    descriptor.id,
    health.retryAfter || "0s",
    health.nextRetryCount,
  ].join(":");
  const detailColumns = preview.userVisible.columns.filter((column) => column.sensitivity === "runtime-detail");

  return Object.freeze({
    protocol: "aios.runtime-handoff-digest.mailchimp.v1",
    componentType: "process_snapshot",
    component: descriptor.subject,
    digestId: `rhd:process-snapshot:${descriptor.isolation.tenant}:${descriptor.isolation.workspace}:${descriptor.id}:${digestStatus}`,
    status: digestStatus,
    ready: digestStatus === "ready" || digestStatus === "degraded",
    clientVisibleStatus: preview.userVisible.statusLabel,
    nextAction,
    owner: blockedRows[0]?.owner || waitingRows[0]?.owner || packet.owner || "runtime",
    request: Object.freeze({
      snapshotId: descriptor.id,
      auditRef: descriptor.isolation.audit,
      tenant: descriptor.isolation.tenant,
      workspace: descriptor.isolation.workspace,
      scope: descriptor.subject,
      filter: descriptor.payload.filter,
    }),
    restart: Object.freeze({
      token: restartToken,
      resumeMode: health.retryable ? "retry-after" : "snapshot-complete",
      retryAfter: health.retryAfter,
      retryAfterMs: health.retryAfterMs,
      nextRetryCount: health.nextRetryCount,
      duplicateCommandPolicy: "dedupe-by-process-snapshot-digest",
      externalWritesPerformed: false,
    }),
    health: Object.freeze({
      state: health.state,
      mode: health.mode,
      failureState: health.failureState,
      reportCompleteness: health.reportCompleteness,
      terminal: packet.terminal,
      retryable: health.retryable,
      degraded: health.degraded,
    }),
    readiness: Object.freeze({
      packetId: packet.packetId,
      packetStatus: packet.status,
      rollbackStatus: descriptor.rollbackReadinessEvidence.status,
      queueImpact: descriptor.rollbackReadinessEvidence.queueImpact,
      exportReportId: exportReport.id,
      exportReady: exportReport.exportReady,
      previewId: preview.previewId,
      previewStatus: preview.status,
      blockerCodes: Object.freeze([
        ...packet.blockerCodes,
        ...preview.validationSummary.blockerCodes,
      ]),
      warningCodes: Object.freeze([
        ...packet.warningCodes,
        ...preview.validationSummary.warningCodes,
      ]),
    }),
    clientControls: Object.freeze({
      accepted: preview.accepted,
      acceptanceRequired: preview.acceptance.required,
      acceptanceStatus: preview.acceptance.status,
      canPublish: blocked === false && waiting === false,
      canRetry: health.retryable,
      canRollback: packet.queueImpact !== "block_rollback_queue",
    }),
    preview: Object.freeze({
      title: preview.title,
      reportCompleteness: preview.userVisible.reportCompleteness,
      visibleColumnCount: preview.userVisible.columns.length,
      runtimeDetailColumnCount: detailColumns.length,
      memoryDetailRequested: descriptor.payload.includeMemory,
    }),
    summary: Object.freeze({
      validationRows: preview.validationSummary.total,
      blockedRows: preview.validationSummary.blocked,
      waitingRows: preview.validationSummary.waiting,
      exportHistorySnapshots: exportReport.counters.historySnapshots,
      timelineEvents: exportReport.timeline.length,
    }),
  });
}

function buildSnapshotOperatorReadinessHandoff(descriptor) {
  const preview = descriptor.previewAcceptance;
  const packet = descriptor.rollbackReadinessPacket;
  const digest = descriptor.runtimeHandoffDigest;
  const exportReport = descriptor.exportReport;
  const blockedRows = preview.validationRows.filter((row) => row.status === "blocked");
  const waitingRows = preview.validationRows.filter((row) => row.status === "waiting");
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0 || digest.status === "waiting"
      ? "waiting"
      : digest.status === "degraded"
        ? "degraded"
        : "ready";
  const primaryRow = blockedRows[0] || waitingRows[0] || preview.validationRows.find((row) => row.status === "pass") || null;
  const visibleColumns = preview.userVisible.columns.map((column) => Object.freeze({
    column: column.column,
    sensitivity: column.sensitivity,
    visible: column.visible,
    acceptanceRequired: column.acceptanceRequired,
  }));

  return Object.freeze({
    protocol: "aios.operator-readiness-handoff.mailchimp.v1",
    componentType: "process_snapshot",
    component: descriptor.subject,
    handoffId: `orh:process-snapshot:${descriptor.isolation.tenant}:${descriptor.isolation.workspace}:${descriptor.id}:${status}`,
    status,
    ready: status === "ready" || status === "degraded",
    owner: primaryRow?.owner || digest.owner || "runtime",
    nextAction: primaryRow?.nextAction || digest.nextAction,
    visibleStatus: preview.userVisible.statusLabel,
    title: `Process snapshot readiness for ${descriptor.subject}`,
    summary: status === "blocked"
      ? `Process snapshot is blocked by ${blockedRows[0]?.code || "inspector readiness"}.`
      : status === "waiting"
        ? `Process snapshot is waiting on ${waitingRows[0]?.code || preview.nextAction}.`
        : status === "degraded"
          ? "Process snapshot can continue with degraded runtime evidence."
          : "Process snapshot is ready for rollback workflow aggregation.",
    scope: Object.freeze({
      tenant: descriptor.isolation.tenant,
      workspace: descriptor.isolation.workspace,
      role: descriptor.isolation.role,
      permission: descriptor.isolation.permission,
      auditRef: descriptor.isolation.audit,
    }),
    readiness: Object.freeze({
      packetId: packet.packetId,
      packetStatus: packet.status,
      queueImpact: packet.queueImpact,
      exportReportId: exportReport.id,
      exportReady: exportReport.exportReady,
      reportCompleteness: descriptor.operationalHealth.reportCompleteness,
      previewId: preview.previewId,
      previewStatus: preview.status,
      blockerCodes: Object.freeze([...new Set([
        ...packet.blockerCodes,
        ...preview.validationSummary.blockerCodes,
      ])].sort()),
      warningCodes: Object.freeze([...new Set([
        ...packet.warningCodes,
        ...preview.validationSummary.warningCodes,
      ])].sort()),
    }),
    controls: Object.freeze({
      accepted: preview.accepted,
      acceptanceRequired: preview.acceptance.required,
      acceptanceStatus: preview.acceptance.status,
      canPublish: status !== "blocked" && status !== "waiting",
      canRetry: descriptor.operationalHealth.retryable,
      canRollback: packet.queueImpact !== "block_rollback_queue",
      externalWritesPerformed: false,
    }),
    restart: Object.freeze({
      token: digest.restart.token,
      resumeMode: digest.restart.resumeMode,
      retryAfter: digest.restart.retryAfter,
      retryAfterMs: digest.restart.retryAfterMs,
      duplicateCommandPolicy: digest.restart.duplicateCommandPolicy,
      externalWritesPerformed: false,
    }),
    preview: Object.freeze({
      visibleColumns: Object.freeze(visibleColumns),
      runtimeDetailColumnCount: visibleColumns.filter((column) => column.sensitivity === "runtime-detail").length,
      memoryDetailRequested: descriptor.payload.includeMemory,
    }),
    validationSummary: Object.freeze({
      total: preview.validationRows.length,
      passed: preview.validationRows.filter((row) => row.status === "pass").length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      primaryCode: primaryRow?.code || "",
    }),
    nextSteps: Object.freeze(preview.validationRows.map((row) => Object.freeze({
      code: row.code,
      status: row.status,
      owner: row.owner,
      nextAction: row.nextAction,
      clientVisible: true,
      detail: row.detail,
    }))),
  });
}

export function parseProcessSnapshotBinding(source) {
  const fields = parsePsAssignments(tokenizePsSource(source));
  if (!fields.scope) throw new SyntaxError("missing required process.snapshot field scope");
  const columns = normalizeColumns(fields.columns);
  const includeMemory = normalizeBoolean(fields.includeMemory, false);
  const role = normalizeRole(fields.role);
  const health = normalizeHealth(fields.health);
  const retryCount = normalizeRetryCount(fields.retryCount);
  const degraded = normalizeBoolean(fields.degraded, health !== "healthy");
  return Object.freeze({
    type: "ProcessSnapshotBinding",
    command: PS_BINDING_GRAMMAR.command,
    scope: fields.scope,
    filter: fields.filter ?? "all",
    columns,
    includeMemory,
    claim: fields.claim ?? "kernel-observed",
    tenant: normalizeScopeIdentifier(fields.tenant, "tenant", "local"),
    workspace: normalizeScopeIdentifier(fields.workspace, "workspace", "default"),
    role,
    audit: normalizeScopeIdentifier(fields.audit, "audit", undefined),
    permission: derivePermission(columns, includeMemory, role),
    health,
    lastError: normalizeOperationalError(fields.lastError, health),
    retryCount,
    retryAfter: normalizeRetryAfter(fields.retryAfter, health, retryCount),
    degraded,
  });
}

export function compileProcessSnapshotBinding(source, options = {}) {
  const ast = typeof source === "string" ? parseProcessSnapshotBinding(source) : source;
  const snapshotId = options.snapshotId ?? `ps:${ast.scope}:${ast.filter}`;
  const auditId = options.audit ?? ast.audit ?? snapshotId;
  const backoff = deriveSnapshotBackoff(ast);
  const healthMode = deriveHealthMode(ast);
  const actionableError = deriveActionableSnapshotError(ast);
  const operationalHealth = buildSnapshotOperationalHealth(ast, snapshotId, auditId, backoff, healthMode, actionableError);
  const exportReport = buildSnapshotExportReport(ast, {
    snapshotId,
    auditId,
    backoff,
    healthMode,
    actionableError,
    operationalHealth,
  });
  const descriptorDraft = {
    kind: "kernel.job.descriptor",
    apiVersion: "aios.runtime/v1",
    id: snapshotId,
    action: "process.snapshot",
    subject: ast.scope,
    payload: Object.freeze({
      filter: ast.filter,
      columns: ast.columns,
      includeMemory: ast.includeMemory,
      tenant: ast.tenant,
      workspace: ast.workspace,
      role: ast.role,
      audit: auditId,
      health: ast.health,
      degraded: ast.degraded,
      operationalHealth,
      exportReportId: exportReport.id,
      exportStatus: exportReport.status,
      exportReady: exportReport.exportReady,
    }),
    capabilities: ast.includeMemory
      ? PS_BINDING_STDLIB.capabilities
      : Object.freeze(["kernel.process.inspect", "kernel.audit.append"]),
    memory: Object.freeze({ reservationMiB: 4, scope: `snapshot:${ast.tenant}:${ast.workspace}:${ast.scope}` }),
    isolation: Object.freeze({
      tenant: ast.tenant,
      workspace: ast.workspace,
      role: ast.role,
      permission: ast.permission,
      audit: auditId,
      boundary: "tenant-workspace-process-scope",
    }),
    health: Object.freeze({
      ...operationalHealth,
      lastError: ast.lastError,
    }),
    verifier: Object.freeze({
      claims: PS_BINDING_STDLIB.verifierClaims,
      evidenceClaim: ast.claim,
      truthBoundary: "kernel-process-table-at-snapshot-time",
    }),
    recovery: Object.freeze({
      statusEvents: ast.health === "unavailable"
        ? ["queued", "scanning", "degraded", "retry-scheduled", "failed"]
        : ["queued", "scanning", "reported", "degraded", "failed"],
      retry: backoff.retryable ? `${backoff.strategy}:${backoff.retryAfter}` : "safe-read-retry",
      rollback: "discard-uncommitted-snapshot",
      degradedMode: healthMode,
      actionableError,
      operationalHealth,
      exportReport: Object.freeze({
        reportId: exportReport.id,
        status: exportReport.status,
        exportReady: exportReport.exportReady,
        nextAction: exportReport.nextAction,
        historySnapshotIds: exportReport.exportSummary.historySnapshotIds,
      }),
    }),
    operationalHealth,
    exportReport,
  };
  const rollbackReadinessEvidence = buildSnapshotRollbackReadinessEvidence(descriptorDraft, exportReport);
  const rollbackReadinessPacket = buildSnapshotRollbackReadinessPacket({
    ...descriptorDraft,
    rollbackReadinessEvidence,
  });
  const previewAcceptance = buildSnapshotPreviewAcceptanceContract({
    ...descriptorDraft,
    rollbackReadinessEvidence,
    rollbackReadinessPacket,
  });
  const runtimeHandoffDigest = buildSnapshotRuntimeHandoffDigest({
    ...descriptorDraft,
    rollbackReadinessEvidence,
    rollbackReadinessPacket,
    previewAcceptance,
  });
  const operatorReadinessHandoff = buildSnapshotOperatorReadinessHandoff({
    ...descriptorDraft,
    rollbackReadinessEvidence,
    rollbackReadinessPacket,
    previewAcceptance,
    runtimeHandoffDigest,
  });
  return Object.freeze({
    ...descriptorDraft,
    payload: Object.freeze({
      ...descriptorDraft.payload,
      rollbackReadinessStatus: rollbackReadinessEvidence.status,
      rollbackReadinessNextAction: rollbackReadinessEvidence.nextAction,
      rollbackReadinessPacketId: rollbackReadinessPacket.packetId,
      rollbackReadinessPacketStatus: rollbackReadinessPacket.status,
      rollbackReadinessPacketNextAction: rollbackReadinessPacket.nextAction,
      previewAcceptanceId: previewAcceptance.previewId,
      previewAcceptanceStatus: previewAcceptance.status,
      previewAcceptanceNextAction: previewAcceptance.nextAction,
      runtimeHandoffDigestId: runtimeHandoffDigest.digestId,
      runtimeHandoffDigestStatus: runtimeHandoffDigest.status,
      runtimeHandoffDigestNextAction: runtimeHandoffDigest.nextAction,
      operatorReadinessHandoffId: operatorReadinessHandoff.handoffId,
      operatorReadinessStatus: operatorReadinessHandoff.status,
      operatorReadinessNextAction: operatorReadinessHandoff.nextAction,
    }),
    recovery: Object.freeze({
      ...descriptorDraft.recovery,
      rollbackReadinessEvidence: Object.freeze({
        protocol: rollbackReadinessEvidence.protocol,
        status: rollbackReadinessEvidence.status,
        queueImpact: rollbackReadinessEvidence.queueImpact,
        nextAction: rollbackReadinessEvidence.nextAction,
        blockerCodes: rollbackReadinessEvidence.blockerCodes,
        warningCodes: rollbackReadinessEvidence.warningCodes,
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
      previewAcceptance: Object.freeze({
        protocol: previewAcceptance.protocol,
        previewId: previewAcceptance.previewId,
        status: previewAcceptance.status,
        accepted: previewAcceptance.accepted,
        nextAction: previewAcceptance.nextAction,
        validationSummary: previewAcceptance.validationSummary,
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
    rollbackReadinessEvidence,
    rollbackReadinessPacket,
    previewAcceptance,
    runtimeHandoffDigest,
    operatorReadinessHandoff,
  });
}

export function createProcessSnapshotRuntimeHandoff(source, options = {}) {
  const descriptor = compileProcessSnapshotBinding(source, options);
  return Object.freeze({
    adapter: "kernel.process-inspector.runtime",
    descriptor,
    localOnly: true,
    externalWrites: false,
    isolation: descriptor.isolation,
    health: descriptor.health,
    operationalHealth: descriptor.operationalHealth,
    exportReport: descriptor.exportReport,
    rollbackReadinessEvidence: descriptor.rollbackReadinessEvidence,
    rollbackReadinessPacket: descriptor.rollbackReadinessPacket,
    previewAcceptance: descriptor.previewAcceptance,
    runtimeHandoffDigest: descriptor.runtimeHandoffDigest,
    operatorReadinessHandoff: descriptor.operatorReadinessHandoff,
    expectedReceipt: Object.freeze(["snapshotId", "capturedAt", "processCount", "status"]),
  });
}

export function createProcessSnapshotHealthReport(source, options = {}) {
  const descriptor = compileProcessSnapshotBinding(source, options);
  return Object.freeze({
    snapshotId: descriptor.id,
    subject: descriptor.subject,
    tenant: descriptor.isolation.tenant,
    workspace: descriptor.isolation.workspace,
    state: descriptor.operationalHealth.state,
    mode: descriptor.operationalHealth.mode,
    degraded: descriptor.operationalHealth.degraded,
    reportCompleteness: descriptor.operationalHealth.reportCompleteness,
    failureState: descriptor.operationalHealth.failureState,
    retryable: descriptor.operationalHealth.retryable,
    retryAfter: descriptor.operationalHealth.retryAfter,
    retryAfterMs: descriptor.operationalHealth.retryAfterMs,
    nextRetryCount: descriptor.operationalHealth.nextRetryCount,
    actionableError: descriptor.operationalHealth.actionableError,
    nextAction: descriptor.operationalHealth.nextAction,
    truthBoundary: descriptor.verifier.truthBoundary,
    exportReportId: descriptor.exportReport.id,
    exportReady: descriptor.exportReport.exportReady,
    exportStatus: descriptor.exportReport.status,
    exportCounters: descriptor.exportReport.counters,
    exportHistorySnapshotIds: descriptor.exportReport.exportSummary.historySnapshotIds,
    rollbackReadinessStatus: descriptor.rollbackReadinessEvidence.status,
    rollbackReadinessQueueImpact: descriptor.rollbackReadinessEvidence.queueImpact,
    rollbackReadinessNextAction: descriptor.rollbackReadinessEvidence.nextAction,
    rollbackReadinessBlockers: descriptor.rollbackReadinessEvidence.blockerCodes,
    rollbackReadinessWarnings: descriptor.rollbackReadinessEvidence.warningCodes,
    rollbackReadinessPacketStatus: descriptor.rollbackReadinessPacket.status,
    rollbackReadinessPacketNextAction: descriptor.rollbackReadinessPacket.nextAction,
    rollbackReadinessPacketCounters: descriptor.rollbackReadinessPacket.counters,
    previewAcceptanceId: descriptor.previewAcceptance.previewId,
    previewAcceptanceStatus: descriptor.previewAcceptance.status,
    previewAcceptanceNextAction: descriptor.previewAcceptance.nextAction,
    previewAcceptanceValidationSummary: descriptor.previewAcceptance.validationSummary,
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

export function createProcessSnapshotExportSummary(source, options = {}) {
  const descriptor = compileProcessSnapshotBinding(source, options);
  return Object.freeze({
    kind: "aios.runtime.process_snapshot_export_summary",
    reportId: descriptor.exportReport.id,
    snapshotId: descriptor.id,
    subject: descriptor.subject,
    tenant: descriptor.isolation.tenant,
    workspace: descriptor.isolation.workspace,
    role: descriptor.isolation.role,
    permission: descriptor.isolation.permission,
    status: descriptor.exportReport.status,
    exportReady: descriptor.exportReport.exportReady,
    nextAction: descriptor.exportReport.nextAction,
    reportCompleteness: descriptor.exportReport.health.reportCompleteness,
    counters: descriptor.exportReport.counters,
    blockerCodes: descriptor.exportReport.exportSummary.blockerCodes,
    warningCodes: descriptor.exportReport.exportSummary.warningCodes,
    historySnapshotIds: descriptor.exportReport.exportSummary.historySnapshotIds,
    timeline: descriptor.exportReport.timeline,
    rollbackReadinessEvidence: descriptor.rollbackReadinessEvidence,
    rollbackReadinessPacket: descriptor.rollbackReadinessPacket,
    previewAcceptance: descriptor.previewAcceptance,
    runtimeHandoffDigest: descriptor.runtimeHandoffDigest,
    operatorReadinessHandoff: descriptor.operatorReadinessHandoff,
  });
}

export {
  PS_BINDING_EXAMPLE,
  PS_BINDING_GRAMMAR,
  PS_BINDING_STDLIB,
  buildSnapshotPreviewAcceptanceContract,
  buildSnapshotRollbackReadinessPacket,
  buildSnapshotRollbackReadinessEvidence,
  buildSnapshotOperatorReadinessHandoff,
  buildSnapshotRuntimeHandoffDigest,
};
