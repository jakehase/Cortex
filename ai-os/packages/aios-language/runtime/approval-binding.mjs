const APPROVAL_BINDING_GRAMMAR = Object.freeze({
  command: "approval.request",
  requiredFields: Object.freeze(["action", "reason"]),
  optionalFields: Object.freeze([
    "subject",
    "risk",
    "ttl",
    "rollback",
    "claim",
    "clientRequest",
    "health",
    "retryAfter",
    "degraded",
    "errorCode",
    "decision",
    "operator",
    "decidedAt",
    "history",
    "exportFormat",
    "adapterStatus",
    "receiptStatus",
    "receiptOperator",
    "receiptDecidedAt",
    "receiptError",
    "attempt",
    "maxAttempts",
    "reportedAt",
    "reportWindow",
    "exportLabel",
  ]),
});

const APPROVAL_BINDING_STDLIB = Object.freeze({
  command: "approval.request",
  capabilities: Object.freeze(["kernel.approval.request", "kernel.audit.append"]),
  verifierClaims: Object.freeze([
    "approval.operator.bound",
    "approval.ttl.bound",
    "approval.rollback.declared",
    "approval.status.handoff.bound",
    "approval.recovery.plan.bound",
  ]),
  adapterStatuses: Object.freeze(["queued", "awaiting-operator", "accepted", "rejected", "expired", "cancelled", "degraded", "retry-scheduled", "failed"]),
  receiptStatuses: Object.freeze(["pending", "approved", "denied", "expired", "cancelled", "retrying", "failed"]),
  historyStatuses: Object.freeze(["queued", "awaiting-operator", "approved", "denied", "expired", "cancelled", "degraded", "retry-scheduled"]),
  terminalStatuses: Object.freeze(["approved", "denied", "expired", "cancelled"]),
  reportSections: Object.freeze(["summary", "analytics", "timeline", "statusContract", "recovery", "verifier"]),
});

const APPROVAL_BINDING_EXAMPLE = `approval.request action=process.boot subject=mailchimp-sync risk=medium ttl=15m reason="start sync worker" rollback=terminate:mailchimp-sync clientRequest=req_123 health=healthy retryAfter=30s degraded=false decision=pending operator=ops_lead decidedAt=2026-07-03T12:00:00Z history=queued@2026-07-03T11:58:00Z,awaiting-operator@2026-07-03T11:58:01Z exportFormat=json`;

function tokenizeApprovalSource(source) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new TypeError("approval source must be a non-empty string");
  }
  return source.trim().match(/[^\s="]+=(?:"(?:\\.|[^"\\])*"|[^\s]+)|[^\s]+/g) ?? [];
}

function parseApprovalAssignments(tokens) {
  if (tokens[0] !== APPROVAL_BINDING_GRAMMAR.command) throw new SyntaxError("expected approval.request command");
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

function validateKnownApprovalFields(fields) {
  const allowed = new Set([
    ...APPROVAL_BINDING_GRAMMAR.requiredFields,
    ...APPROVAL_BINDING_GRAMMAR.optionalFields,
  ]);
  const unknown = Object.keys(fields).filter((field) => !allowed.has(field)).sort();
  if (unknown.length > 0) {
    throw new SyntaxError(`unsupported approval.request field ${unknown.join(",")}`);
  }
}

function normalizeRisk(value) {
  const risk = value ?? "low";
  if (!["low", "medium", "high"].includes(risk)) throw new SyntaxError(`unsupported approval risk ${risk}`);
  return risk;
}

function normalizeTtl(value) {
  const ttl = value ?? "10m";
  if (!/^\d+[smh]$/.test(ttl)) throw new SyntaxError(`invalid approval ttl ${ttl}`);
  return ttl;
}

function normalizeApprovalIdentifier(value, field, fallback) {
  const selected = value ?? fallback;
  if (!selected) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{1,127}$/.test(selected)) {
    throw new SyntaxError(`invalid approval.request ${field} ${selected}`);
  }
  return selected;
}

function normalizeHealth(value) {
  const selected = value ?? "healthy";
  if (!["healthy", "degraded", "unavailable"].includes(selected)) {
    throw new SyntaxError(`unsupported approval health ${selected}`);
  }
  return selected;
}

function normalizeBoolean(value, field, fallback) {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new SyntaxError(`expected boolean ${field}, received ${value}`);
}

function normalizeRetryAfter(value, health) {
  const selected = value ?? (health === "healthy" ? "0s" : "30s");
  if (!/^\d+[smh]$/.test(selected)) throw new SyntaxError(`invalid approval retryAfter ${selected}`);
  return selected;
}

function normalizeReportWindow(value, ttl) {
  const selected = value ?? ttl;
  if (!/^\d+[smh]$/.test(selected)) throw new SyntaxError(`invalid approval reportWindow ${selected}`);
  return selected;
}

function parseDurationSeconds(value, field) {
  if (!/^\d+[smh]$/.test(value)) throw new SyntaxError(`invalid approval ${field} ${value}`);
  const amount = Number(value.slice(0, -1));
  const unit = value.slice(-1);
  if (unit === "s") return amount;
  if (unit === "m") return amount * 60;
  return amount * 60 * 60;
}

function normalizeDecision(value) {
  const selected = value ?? "pending";
  if (!["pending", "approved", "denied", "expired", "cancelled"].includes(selected)) {
    throw new SyntaxError(`unsupported approval decision ${selected}`);
  }
  return selected;
}

function normalizeTimestamp(value, field) {
  if (value === undefined) return undefined;
  const selected = String(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(selected)) {
    throw new SyntaxError(`invalid approval.request ${field} ${selected}`);
  }
  return selected;
}

function normalizeAdapterStatus(value, health, decision) {
  if (value !== undefined) {
    if (!APPROVAL_BINDING_STDLIB.adapterStatuses.includes(value)) {
      throw new SyntaxError(`unsupported approval adapterStatus ${value}`);
    }
    return value;
  }
  if (health === "unavailable") return "failed";
  if (health === "degraded") return "retry-scheduled";
  if (decision === "approved") return "accepted";
  if (decision === "denied") return "rejected";
  if (decision === "expired") return "expired";
  if (decision === "cancelled") return "cancelled";
  return "awaiting-operator";
}

function normalizeReceiptStatus(value, decision, adapterStatus) {
  if (value !== undefined) {
    if (!APPROVAL_BINDING_STDLIB.receiptStatuses.includes(value)) {
      throw new SyntaxError(`unsupported approval receiptStatus ${value}`);
    }
    return value;
  }
  if (adapterStatus === "failed") return "failed";
  if (adapterStatus === "retry-scheduled" || adapterStatus === "degraded") return "retrying";
  return decision;
}

function normalizeAttempt(value, field, fallback) {
  const selected = value ?? String(fallback);
  if (!/^\d+$/.test(selected)) throw new SyntaxError(`invalid approval.request ${field} ${selected}`);
  const parsed = Number(selected);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SyntaxError(`invalid approval.request ${field} ${selected}`);
  }
  return parsed;
}

function validateAdapterStatusHandoff(ast) {
  const terminalDecisions = new Set(["approved", "denied", "expired", "cancelled"]);
  if (ast.decision === "approved" && ast.adapterStatus !== "accepted") {
    throw new SyntaxError("approved approval.request must hand off adapterStatus=accepted");
  }
  if (ast.decision === "denied" && ast.adapterStatus !== "rejected") {
    throw new SyntaxError("denied approval.request must hand off adapterStatus=rejected");
  }
  if (terminalDecisions.has(ast.decision) && ast.receipt.status !== ast.decision) {
    throw new SyntaxError(`terminal approval.request decision ${ast.decision} must match receiptStatus`);
  }
  if (ast.receipt.status === "approved" || ast.receipt.status === "denied") {
    if (!ast.receipt.operator) throw new SyntaxError(`receiptStatus=${ast.receipt.status} requires receiptOperator or operator`);
    if (!ast.receipt.decidedAt) throw new SyntaxError(`receiptStatus=${ast.receipt.status} requires receiptDecidedAt or decidedAt`);
  }
  if (ast.attempt > ast.maxAttempts) {
    throw new SyntaxError(`approval.request attempt ${ast.attempt} exceeds maxAttempts ${ast.maxAttempts}`);
  }
}

function normalizeExportFormat(value) {
  const selected = value ?? "json";
  if (!["json", "summary", "audit"].includes(selected)) {
    throw new SyntaxError(`unsupported approval exportFormat ${selected}`);
  }
  return selected;
}

function normalizeHistorySnapshot(value, decision, decidedAt) {
  const entries = value
    ? value.split(",").filter(Boolean)
    : [`queued@pending`, `awaiting-operator@pending`];
  const parsed = entries.map((entry, index) => {
    const splitAt = entry.indexOf("@");
    if (splitAt <= 0) {
      throw new SyntaxError(`invalid approval history entry ${entry}`);
    }
    const status = entry.slice(0, splitAt);
    const at = entry.slice(splitAt + 1);
    if (!APPROVAL_BINDING_STDLIB.historyStatuses.includes(status)) {
      throw new SyntaxError(`unsupported approval history status ${status}`);
    }
    if (at !== "pending") normalizeTimestamp(at, "history timestamp");
    return Object.freeze({ index, status, at });
  });
  if (decision !== "pending" && !parsed.some((entry) => entry.status === decision)) {
    parsed.push(Object.freeze({
      index: parsed.length,
      status: decision,
      at: decidedAt ?? "pending",
    }));
  }
  return Object.freeze(parsed);
}

function parseHistoryInstant(entry) {
  if (!entry || entry.at === "pending") return undefined;
  return Date.parse(entry.at) / 1000;
}

function createHistoryDigest(history) {
  return history.map((entry) => `${entry.index}:${entry.status}@${entry.at}`).join("|");
}

function validateHistoryTimeline(ast) {
  const terminalStatuses = new Set(APPROVAL_BINDING_STDLIB.terminalStatuses);
  const terminalIndex = ast.history.findIndex((entry) => terminalStatuses.has(entry.status));
  if (terminalIndex >= 0) {
    const terminalStatus = ast.history[terminalIndex].status;
    if (ast.decision !== terminalStatus) {
      throw new SyntaxError(`approval history terminal ${terminalStatus} must match decision ${ast.decision}`);
    }
    const trailingMismatch = ast.history.slice(terminalIndex + 1).find((entry) => entry.status !== terminalStatus);
    if (trailingMismatch) {
      throw new SyntaxError(`approval history cannot move from terminal ${terminalStatus} to ${trailingMismatch.status}`);
    }
  }
  if (ast.decision !== "pending") {
    const last = ast.history[ast.history.length - 1];
    if (last.status !== ast.decision) {
      throw new SyntaxError(`approval history must end with terminal decision ${ast.decision}`);
    }
  }
  let previousSeconds;
  for (const entry of ast.history) {
    const currentSeconds = parseHistoryInstant(entry);
    if (currentSeconds !== undefined && previousSeconds !== undefined && currentSeconds < previousSeconds) {
      throw new SyntaxError(`approval history timestamp regressed at ${entry.status}`);
    }
    if (currentSeconds !== undefined) previousSeconds = currentSeconds;
  }
}

function createTransitionKey(previous, entry) {
  return `${previous?.status ?? "start"}>${entry.status}`;
}

function createApprovalHistorySnapshots(ast, approvalId) {
  let previous;
  return Object.freeze(ast.history.map((entry) => {
    const previousSeconds = parseHistoryInstant(previous);
    const currentSeconds = parseHistoryInstant(entry);
    const elapsedSincePreviousSeconds = previousSeconds !== undefined && currentSeconds !== undefined
      ? Math.max(currentSeconds - previousSeconds, 0)
      : undefined;
    const transition = createTransitionKey(previous, entry);
    previous = entry;
    return Object.freeze({
      approvalId,
      index: entry.index,
      status: entry.status,
      at: entry.at,
      transition,
      elapsedSincePreviousSeconds,
      terminal: APPROVAL_BINDING_STDLIB.terminalStatuses.includes(entry.status),
      recoverable: ["degraded", "retry-scheduled"].includes(entry.status) && ast.attempt < ast.maxAttempts,
      exportable: entry.status === ast.decision || entry.status === "awaiting-operator",
    });
  }));
}

function createTransitionCounters(snapshots) {
  const counters = {};
  for (const snapshot of snapshots) {
    counters[snapshot.transition] = (counters[snapshot.transition] ?? 0) + 1;
  }
  return Object.freeze(Object.fromEntries(Object.entries(counters).sort(([left], [right]) => left.localeCompare(right))));
}

function createApprovalHistoryMetrics(ast, snapshots) {
  const firstInstant = ast.history.map(parseHistoryInstant).find((value) => value !== undefined);
  const lastInstant = [...ast.history].reverse().map(parseHistoryInstant).find((value) => value !== undefined);
  const elapsedSeconds = firstInstant !== undefined && lastInstant !== undefined
    ? Math.max(lastInstant - firstInstant, 0)
    : undefined;
  const ttlSeconds = parseDurationSeconds(ast.ttl, "ttl");
  const reportWindowSeconds = parseDurationSeconds(ast.reportWindow, "reportWindow");
  const retrySnapshots = snapshots.filter((snapshot) => snapshot.status === "retry-scheduled");
  return Object.freeze({
    ttlSeconds,
    reportWindowSeconds,
    elapsedSeconds,
    elapsedKnown: elapsedSeconds !== undefined,
    retryTransitions: retrySnapshots.length,
    terminalSnapshots: snapshots.filter((snapshot) => snapshot.terminal).length,
    recoverableSnapshots: snapshots.filter((snapshot) => snapshot.recoverable).length,
    breachedTtl: elapsedSeconds !== undefined && elapsedSeconds > ttlSeconds,
    breachedReportWindow: elapsedSeconds !== undefined && elapsedSeconds > reportWindowSeconds,
  });
}

function createApprovalStatusContract(ast, approvalId, clientRequest) {
  const ttlSeconds = parseDurationSeconds(ast.ttl, "ttl");
  const retryAfterSeconds = parseDurationSeconds(ast.retryAfter, "retryAfter");
  const terminal = APPROVAL_BINDING_STDLIB.terminalStatuses.includes(ast.decision);
  const awaitingOperator = ast.decision === "pending" && ast.health === "healthy";
  const recoverable = !terminal && ast.health !== "healthy" && ast.attempt < ast.maxAttempts;
  return Object.freeze({
    approvalId,
    clientRequest,
    adapter: Object.freeze({
      name: "kernel.approval.runtime",
      status: ast.adapterStatus,
      health: ast.health,
      degraded: ast.degraded,
      attempt: ast.attempt,
      maxAttempts: ast.maxAttempts,
    }),
    receipt: ast.receipt,
    timers: Object.freeze({
      ttl: ast.ttl,
      ttlSeconds,
      retryAfter: ast.retryAfter,
      retryAfterSeconds,
      reportWindow: ast.reportWindow,
      reportWindowSeconds: parseDurationSeconds(ast.reportWindow, "reportWindow"),
    }),
    state: Object.freeze({
      decision: ast.decision,
      terminal,
      awaitingOperator,
      recoverable,
      exportable: terminal || awaitingOperator,
    }),
  });
}

function createApprovalRecoveryPlan(ast, approvalId, statusContract, historyMetrics) {
  const terminal = statusContract.state.terminal;
  const events = ast.health === "unavailable"
    ? ["queued", "degraded", "retry-scheduled", "failed"]
    : ast.health === "degraded"
      ? ["queued", "degraded", "retry-scheduled", "awaiting-operator"]
      : ["queued", "awaiting-operator", "approved", "denied", "expired"];
  const retry = terminal
    ? "none:terminal-decision"
    : ast.health === "healthy"
      ? "renew-request-after-expiry"
      : statusContract.state.recoverable
        ? `backoff:${ast.retryAfter}`
        : "none:max-attempts-exhausted";
  const nextAction = terminal
    ? "export-receipt"
    : ast.health === "healthy"
      ? "await-operator"
      : statusContract.state.recoverable
        ? "schedule-adapter-retry"
        : "surface-actionable-error";
  return Object.freeze({
    approvalId,
    statusEvents: Object.freeze(events),
    retry,
    nextAction,
    rollback: ast.rollback,
    receiptRequired: terminal,
    retryBudget: Object.freeze({
      attempt: ast.attempt,
      maxAttempts: ast.maxAttempts,
      remainingAttempts: Math.max(ast.maxAttempts - ast.attempt, 0),
      retryAfter: ast.retryAfter,
    }),
    reporting: Object.freeze({
      window: ast.reportWindow,
      elapsedKnown: historyMetrics.elapsedKnown,
      breachedWindow: historyMetrics.breachedReportWindow,
      breachedTtl: historyMetrics.breachedTtl,
      nextReportAction: historyMetrics.breachedReportWindow && !terminal
        ? "escalate-stale-approval"
        : "append-history-snapshot",
    }),
    handoff: Object.freeze({
      adapterStatus: ast.adapterStatus,
      receiptStatus: ast.receipt.status,
      expectedReceipt: Object.freeze(["approvalId", "decidedAt", "operatorId", "status"]),
    }),
  });
}

function createApprovalAnalytics(ast, approvalId, snapshots = createApprovalHistorySnapshots(ast, approvalId)) {
  const terminal = APPROVAL_BINDING_STDLIB.terminalStatuses.includes(ast.decision);
  const counters = ast.history.reduce((summary, entry) => {
    summary[entry.status] = (summary[entry.status] ?? 0) + 1;
    return summary;
  }, {
    queued: 0,
    "awaiting-operator": 0,
    approved: 0,
    denied: 0,
    expired: 0,
    cancelled: 0,
    degraded: 0,
    "retry-scheduled": 0,
  });
  const metrics = createApprovalHistoryMetrics(ast, snapshots);
  return Object.freeze({
    approvalId,
    decision: ast.decision,
    terminal,
    risk: ast.risk,
    health: ast.health,
    counters: Object.freeze(counters),
    transitionCounters: createTransitionCounters(snapshots),
    metrics,
    historyDigest: createHistoryDigest(ast.history),
    snapshotCount: ast.history.length,
    lastSnapshot: ast.history[ast.history.length - 1],
    exportReady: terminal || ast.decision === "pending",
    exportBlockers: Object.freeze([
      ...(metrics.breachedReportWindow && !terminal ? ["report-window-breached"] : []),
      ...(ast.health === "unavailable" && ast.attempt >= ast.maxAttempts ? ["adapter-retry-budget-exhausted"] : []),
      ...(ast.receipt.status === "failed" ? ["receipt-failed"] : []),
    ]),
  });
}

function createApprovalTimeline(ast, approvalId, snapshots = createApprovalHistorySnapshots(ast, approvalId)) {
  return Object.freeze(snapshots.map((entry) => Object.freeze({
    approvalId,
    sequence: entry.index,
    status: entry.status,
    at: entry.at,
    transition: entry.transition,
    elapsedSincePreviousSeconds: entry.elapsedSincePreviousSeconds,
    terminal: entry.terminal,
    recoverable: entry.recoverable,
    operator: ast.operator,
    decision: ast.decision,
    health: ast.health,
  })));
}

function createApprovalExportSummary(ast, approvalId, clientRequest, analytics = createApprovalAnalytics(ast, approvalId)) {
  return Object.freeze({
    format: ast.exportFormat,
    label: ast.exportLabel,
    approvalId,
    clientRequest,
    action: ast.action,
    subject: ast.subject,
    decision: ast.decision,
    operator: ast.operator,
    decidedAt: ast.decidedAt,
    risk: ast.risk,
    terminal: analytics.terminal,
    counters: analytics.counters,
    transitionCounters: analytics.transitionCounters,
    timelineLength: analytics.snapshotCount,
    historyDigest: analytics.historyDigest,
    metrics: analytics.metrics,
    blockers: analytics.exportBlockers,
    health: ast.health,
    degraded: ast.degraded,
    reportedAt: ast.reportedAt,
  });
}

function createApprovalReportingState(ast, approvalId, clientRequest, analytics, timeline, statusContract, recoveryPlan) {
  const exportReady = analytics.exportReady && analytics.exportBlockers.length === 0;
  const sectionCount = APPROVAL_BINDING_STDLIB.reportSections.length;
  return Object.freeze({
    reportId: `approval-report:${approvalId}:${analytics.historyDigest}`,
    approvalId,
    clientRequest,
    generatedAt: ast.reportedAt,
    format: ast.exportFormat,
    label: ast.exportLabel,
    exportReady,
    exportBlockers: analytics.exportBlockers,
    sectionCount,
    sections: APPROVAL_BINDING_STDLIB.reportSections,
    timelineRange: Object.freeze({
      first: timeline[0]?.at ?? "pending",
      last: timeline[timeline.length - 1]?.at ?? "pending",
      snapshots: timeline.length,
    }),
    handoff: Object.freeze({
      adapterStatus: statusContract.adapter.status,
      receiptStatus: statusContract.receipt.status,
      nextAction: recoveryPlan.nextAction,
      nextReportAction: recoveryPlan.reporting.nextReportAction,
    }),
  });
}

function createApprovalClientResumeCheckpoint(ast, approvalId, clientRequest, analytics, statusContract, recoveryPlan, reporting) {
  const terminal = statusContract.state.terminal;
  const approvalPending = statusContract.state.awaitingOperator;
  const retryable = statusContract.state.recoverable && recoveryPlan.retryBudget.remainingAttempts > 0;
  const blockedReasons = Object.freeze([
    ...analytics.exportBlockers,
    ...(ast.health === "unavailable" ? ["approval-runtime-unavailable"] : []),
    ...(ast.receipt.status === "failed" ? ["approval-receipt-failed"] : []),
    ...(analytics.metrics.breachedTtl && !terminal ? ["approval-ttl-breached"] : []),
  ]);
  const resumeStatus = terminal
    ? "terminal"
    : blockedReasons.length
      ? "blocked"
      : approvalPending
        ? "awaiting_operator"
        : retryable
          ? "retry_ready"
          : "review_required";
  const nextClientAction = terminal
    ? "show-approval-receipt"
    : blockedReasons.length
      ? "show-approval-recovery"
      : approvalPending
        ? "collect-approval-decision"
        : retryable
          ? "retry-approval-runtime"
          : recoveryPlan.nextAction;
  const checkpointKey = [
    "approval",
    compactApprovalToken(ast.action, "action"),
    compactApprovalToken(ast.subject, "subject"),
    compactApprovalToken(clientRequest, "client-request"),
    analytics.historyDigest.replace(/[^a-zA-Z0-9:_-]/g, "-"),
  ].join(":");
  const checkpointBody = Object.freeze({
    approvalId,
    clientRequest,
    action: ast.action,
    subject: ast.subject,
    decision: ast.decision,
    adapterStatus: statusContract.adapter.status,
    receiptStatus: statusContract.receipt.status,
    terminal,
    awaitingOperator: approvalPending,
    recoverable: retryable,
    historyDigest: analytics.historyDigest,
    reportId: reporting.reportId,
    nextClientAction,
    blockedReasons,
  });
  const checksum = createHistoryDigest([
    { index: 0, status: statusContract.adapter.status, at: ast.reportedAt },
    { index: 1, status: statusContract.receipt.status, at: statusContract.receipt.decidedAt ?? "pending" },
    { index: 2, status: ast.decision, at: ast.decidedAt ?? "pending" },
  ]);
  const persistCommandId = `approval.resume.persist:${compactApprovalToken(approvalId, "approval")}:${compactApprovalToken(checksum, "checksum")}`;
  const resumeCommandId = `approval.resume.continue:${compactApprovalToken(approvalId, "approval")}:${compactApprovalToken(nextClientAction, "action")}`;
  const replayManifest = Object.freeze({
    kind: "approval.client_resume_replay_manifest",
    version: "aios.approval.client-resume-replay.v1",
    manifestId: `approval-replay:${compactApprovalToken(approvalId, "approval")}:${compactApprovalToken(checksum, "checksum")}`,
    checkpointKey,
    checksum,
    restartSafe: true,
    localOnly: true,
    status: blockedReasons.length ? "repair_required" : "replay_ready",
    persistedStateShape: Object.freeze({
      requiredKeys: Object.freeze([
        "approvalId",
        "clientRequest",
        "decision",
        "adapterStatus",
        "receiptStatus",
        "historyDigest",
        "reportId",
        "nextClientAction",
      ]),
      identityKeys: Object.freeze(["approvalId", "clientRequest", "historyDigest"]),
      mutableKeys: Object.freeze(["decision", "adapterStatus", "receiptStatus", "nextClientAction"]),
      checksumKeys: Object.freeze(["adapterStatus", "receiptStatus", "decision"]),
    }),
    replayGuards: Object.freeze({
      terminal,
      awaitingOperator: approvalPending,
      retryable,
      exportReady: reporting.exportReady,
      blockedReasons,
      expectedReceiptStatus: statusContract.receipt.status,
      expectedAdapterStatus: statusContract.adapter.status,
    }),
    commands: Object.freeze({
      persist: Object.freeze({
        id: persistCommandId,
        idempotencyKey: persistCommandId,
        precondition: "local-checkpoint-write",
        successStatus: "checkpoint_persisted",
      }),
      resume: Object.freeze({
        id: resumeCommandId,
        idempotencyKey: resumeCommandId,
        precondition: blockedReasons.length ? "repair-blocking-reasons" : "checkpoint-present",
        successStatus: terminal ? "receipt_visible" : "approval_runtime_resumed",
      }),
    }),
    replaySteps: Object.freeze([
      Object.freeze({
        step: "load-checkpoint",
        required: true,
        expectedChecksum: checksum,
        onMissing: "surface-approval-recovery",
      }),
      Object.freeze({
        step: "verify-status-contract",
        required: true,
        expectedAdapterStatus: statusContract.adapter.status,
        expectedReceiptStatus: statusContract.receipt.status,
      }),
      Object.freeze({
        step: "restore-client-visible-state",
        required: true,
        nextClientAction,
        reportId: reporting.reportId,
      }),
      Object.freeze({
        step: "continue-or-export",
        required: blockedReasons.length === 0,
        action: terminal ? "show-approval-receipt" : nextClientAction,
      }),
    ]),
  });

  return Object.freeze({
    kind: "approval.client_resume_checkpoint",
    version: "aios.approval.client-resume.v1",
    checkpointKey,
    approvalId,
    clientRequest,
    status: resumeStatus,
    restartSafe: true,
    localOnly: true,
    checksum,
    body: checkpointBody,
    replayManifest,
    commands: Object.freeze({
      persist: Object.freeze({
        id: persistCommandId,
        type: "persist-approval-client-checkpoint",
        idempotencyKey: persistCommandId,
        status: "ready",
        externalWrites: false,
      }),
      resume: Object.freeze({
        id: resumeCommandId,
        type: "resume-approval-client-checkpoint",
        idempotencyKey: resumeCommandId,
        status: blockedReasons.length ? "blocked" : "ready",
        externalWrites: false,
      }),
    }),
    clientStatus: Object.freeze({
      visibleState: terminal
        ? "approval-complete"
        : approvalPending
          ? "approval-awaiting-operator"
          : retryable
            ? "approval-retry-available"
            : "approval-review-required",
      nextClientAction,
      reportId: reporting.reportId,
      exportReady: reporting.exportReady,
      receiptRequired: recoveryPlan.receiptRequired,
      retryAfter: retryable ? recoveryPlan.retryBudget.retryAfter : "0s",
    }),
    recovery: Object.freeze({
      retry: recoveryPlan.retry,
      rollback: recoveryPlan.rollback,
      remainingAttempts: recoveryPlan.retryBudget.remainingAttempts,
      blockedReasons,
      replayManifestId: replayManifest.manifestId,
      replayStatus: replayManifest.status,
      statusOnFailure: blockedReasons.length ? "approval_checkpoint_repair_required" : "approval_checkpoint_replay_available",
    }),
  });
}

function createApprovalOperatorReadinessHandoff(descriptor) {
  const statusContract = descriptor.statusContract;
  const checkpoint = descriptor.clientResumeCheckpoint;
  const reporting = descriptor.reporting;
  const recovery = descriptor.recovery;
  const analytics = descriptor.analytics;
  const terminal = statusContract.state.terminal;
  const retryable = statusContract.state.recoverable && recovery.retryBudget.remainingAttempts > 0;
  const reportBlocked = reporting.exportReady !== true;
  const checkpointBlocked = checkpoint.commands.resume.status === "blocked";
  const runtimeUnavailable = descriptor.health.state === "unavailable";
  const waitingForOperator = statusContract.state.awaitingOperator;
  const blockedReasons = Object.freeze([...new Set([
    ...analytics.exportBlockers,
    ...checkpoint.recovery.blockedReasons,
    ...(runtimeUnavailable && retryable === false ? ["approval-runtime-unavailable"] : []),
    ...(reportBlocked ? ["approval-report-not-export-ready"] : []),
    ...(checkpointBlocked ? ["approval-checkpoint-resume-blocked"] : []),
  ])].sort());
  const status = blockedReasons.length > 0
    ? "blocked"
    : terminal
      ? "ready"
      : waitingForOperator
        ? "waiting"
        : retryable
          ? "retryable"
          : descriptor.health.degraded
            ? "degraded"
            : "ready";
  const nextAction = blockedReasons.length > 0
    ? "show-approval-recovery"
    : terminal
      ? "export-approval-receipt"
      : waitingForOperator
        ? "collect-approval-decision"
        : retryable
          ? "retry-approval-runtime"
          : recovery.nextAction;
  const validationRows = Object.freeze([
    Object.freeze({
      code: "approval.operator.status_contract",
      status: statusContract.state.exportable ? "pass" : waitingForOperator ? "waiting" : "blocked",
      owner: waitingForOperator ? "operator" : "runtime",
      nextAction: waitingForOperator ? "collect-approval-decision" : recovery.nextAction,
      detail: statusContract.state.exportable
        ? "Approval status contract can be shown to the operator workflow."
        : `Approval status contract is ${statusContract.state.decision}.`,
    }),
    Object.freeze({
      code: "approval.operator.runtime_health",
      status: runtimeUnavailable && retryable === false ? "blocked" : descriptor.health.degraded ? "waiting" : "pass",
      owner: runtimeUnavailable ? "operator" : "runtime",
      nextAction: runtimeUnavailable && retryable === false ? "surface-actionable-error" : recovery.nextAction,
      detail: descriptor.health.actionableError || `Approval runtime health is ${descriptor.health.state}.`,
    }),
    Object.freeze({
      code: "approval.operator.report",
      status: reporting.exportReady ? "pass" : "blocked",
      owner: "runtime",
      nextAction: reporting.handoff.nextReportAction,
      detail: reporting.exportReady
        ? "Approval report is export-ready for operator handoff."
        : `Approval report has blockers: ${reporting.exportBlockers.join(", ") || "unknown"}.`,
    }),
    Object.freeze({
      code: "approval.operator.checkpoint",
      status: checkpointBlocked ? "blocked" : checkpoint.status === "blocked" ? "blocked" : checkpoint.status === "retry_ready" ? "waiting" : "pass",
      owner: checkpointBlocked ? "runtime" : "operator",
      nextAction: checkpoint.clientStatus.nextClientAction,
      detail: checkpointBlocked
        ? "Approval client resume checkpoint requires repair before replay."
        : `Approval checkpoint status is ${checkpoint.status}.`,
    }),
    Object.freeze({
      code: "approval.operator.receipt",
      status: recovery.receiptRequired && statusContract.receipt.status === "pending" ? "waiting" : statusContract.receipt.status === "failed" ? "blocked" : "pass",
      owner: recovery.receiptRequired ? "operator" : "runtime",
      nextAction: recovery.receiptRequired ? "export-approval-receipt" : nextAction,
      detail: recovery.receiptRequired
        ? `Approval receipt status is ${statusContract.receipt.status}.`
        : "Approval receipt is not required yet.",
    }),
  ]);
  const blockedRows = validationRows.filter((row) => row.status === "blocked");
  const waitingRows = validationRows.filter((row) => row.status === "waiting");
  const visibleStatus = status === "blocked"
    ? "approval-handoff-blocked"
    : status === "waiting"
      ? "approval-awaiting-operator"
      : status === "retryable"
        ? "approval-runtime-retry-ready"
        : terminal
          ? "approval-receipt-ready"
          : "approval-handoff-ready";
  const restartToken = [
    descriptor.id,
    statusContract.adapter.status,
    statusContract.receipt.status,
    analytics.historyDigest.replace(/[^a-zA-Z0-9:_-]/g, "-"),
  ].join(":");

  return Object.freeze({
    protocol: "aios.operator-readiness-handoff.mailchimp.v1",
    componentType: "approval_request",
    component: descriptor.subject,
    handoffId: `orh:approval:${compactApprovalToken(descriptor.id, "approval")}:${status}`,
    status,
    ready: status === "ready" || status === "degraded",
    owner: blockedRows[0]?.owner || waitingRows[0]?.owner || (waitingForOperator ? "operator" : "runtime"),
    nextAction: blockedRows[0]?.nextAction || waitingRows[0]?.nextAction || nextAction,
    visibleStatus,
    title: `Approval readiness for ${descriptor.subject}`,
    summary: blockedRows.length > 0
      ? `Approval handoff is blocked by ${blockedRows[0].code}.`
      : waitingRows.length > 0
        ? `Approval handoff is waiting on ${waitingRows[0].code}.`
        : terminal
          ? "Approval receipt is ready for workflow handoff."
          : "Approval request is ready for operator workflow handoff.",
    request: Object.freeze({
      approvalId: descriptor.id,
      action: descriptor.payload.requestedAction,
      subject: descriptor.subject,
      clientRequest: descriptor.payload.clientRequest,
      risk: descriptor.payload.risk,
      ttl: descriptor.payload.ttl,
    }),
    readiness: Object.freeze({
      reportId: reporting.reportId,
      exportReady: reporting.exportReady,
      checkpointKey: checkpoint.checkpointKey,
      replayManifestId: checkpoint.replayManifest.manifestId,
      adapterStatus: statusContract.adapter.status,
      receiptStatus: statusContract.receipt.status,
      decision: statusContract.state.decision,
      terminal,
      retryable,
      blockerCodes: Object.freeze([...new Set([
        ...blockedReasons,
        ...blockedRows.map((row) => row.code),
      ])].sort()),
      warningCodes: Object.freeze([...new Set([
        ...waitingRows.map((row) => row.code),
        ...(analytics.metrics.breachedReportWindow && !terminal ? ["approval-report-window-warning"] : []),
      ])].sort()),
    }),
    restart: Object.freeze({
      token: restartToken,
      resumeMode: terminal ? "receipt-visible" : retryable ? "runtime-retry" : "operator-decision",
      retryAfter: retryable ? recovery.retryBudget.retryAfter : "0s",
      remainingAttempts: recovery.retryBudget.remainingAttempts,
      duplicateCommandPolicy: "dedupe-by-approval-operator-handoff",
      externalWritesPerformed: false,
    }),
    controls: Object.freeze({
      canApprove: waitingForOperator && blockedRows.length === 0,
      canDeny: waitingForOperator && blockedRows.length === 0,
      canRetry: retryable && blockedRows.length === 0,
      canExportReceipt: terminal && reporting.exportReady,
      canResumeClient: checkpoint.commands.resume.status === "ready",
    }),
    validationSummary: Object.freeze({
      total: validationRows.length,
      passed: validationRows.filter((row) => row.status === "pass").length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      primaryCode: blockedRows[0]?.code || waitingRows[0]?.code || "",
    }),
    nextSteps: Object.freeze(validationRows.map((row) => Object.freeze({
      code: row.code,
      status: row.status,
      owner: row.owner,
      nextAction: row.nextAction,
      clientVisible: true,
      detail: row.detail,
    }))),
  });
}

function createApprovalExportPackage(descriptor) {
  return Object.freeze({
    apiVersion: descriptor.apiVersion,
    kind: "approval.export.package",
    report: descriptor.reporting,
    summary: descriptor.exportSummary,
    analytics: descriptor.analytics,
    timeline: descriptor.timeline,
    statusContract: descriptor.statusContract,
    clientResumeCheckpoint: descriptor.clientResumeCheckpoint,
    operatorReadinessHandoff: descriptor.operatorReadinessHandoff,
    recovery: descriptor.recovery,
    verifier: Object.freeze({
      claims: descriptor.verifier.claims,
      truthBoundary: descriptor.verifier.truthBoundary,
      statusHandoff: descriptor.verifier.statusHandoff,
    }),
  });
}

function quoteApprovalValue(value) {
  const text = String(value ?? "");
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function compactApprovalToken(value, fallback) {
  return String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || fallback;
}

function selectApprovalRisk(input = {}) {
  const explicit = String(input.risk ?? "").toLowerCase();
  if (["low", "medium", "high"].includes(explicit)) return explicit;
  const issueCodes = Array.isArray(input.blockingIssueCodes) ? input.blockingIssueCodes : [];
  const warningCodes = Array.isArray(input.warningIssueCodes) ? input.warningIssueCodes : [];
  if (issueCodes.some((code) => String(code).includes("auth") || String(code).includes("external_write"))) return "high";
  if (issueCodes.length > 0 || warningCodes.length > 2) return "medium";
  return "low";
}

function selectApprovalHealth(input = {}) {
  const health = String(input.health ?? input.healthStatus ?? "").toLowerCase().replaceAll("_", "-");
  if (["healthy", "degraded", "unavailable"].includes(health)) return health;
  if (Array.isArray(input.blockingIssueCodes) && input.blockingIssueCodes.length > 0) return "unavailable";
  if (Array.isArray(input.warningIssueCodes) && input.warningIssueCodes.length > 0) return "degraded";
  return "healthy";
}

function selectApprovalDecision(input = {}) {
  const decision = String(input.decision ?? "").toLowerCase();
  if (["pending", "approved", "denied", "expired", "cancelled"].includes(decision)) return decision;
  if (input.accepted === true) return "approved";
  if (input.accepted === false) return "denied";
  return "pending";
}

function createPreviewApprovalSource(input = {}) {
  const action = compactApprovalToken(input.action, "preview.accept");
  const subject = compactApprovalToken(input.subject, "mailchimp-preview");
  const decision = selectApprovalDecision(input);
  const health = selectApprovalHealth(input);
  const operator = compactApprovalToken(input.operator, "");
  const fields = [
    APPROVAL_BINDING_GRAMMAR.command,
    `action=${action}`,
    `subject=${subject}`,
    `risk=${selectApprovalRisk(input)}`,
    `ttl=${input.ttl ?? "15m"}`,
    `reason=${quoteApprovalValue(input.reason ?? "Accept Mailchimp preview before adapter-mediated commit.")}`,
    `rollback=${compactApprovalToken(input.rollback, `deny:${action}`)}`,
    `clientRequest=${compactApprovalToken(input.clientRequest, `approval:${subject}`)}`,
    `health=${health}`,
    `retryAfter=${input.retryAfter ?? (health === "healthy" ? "0s" : "30s")}`,
    `degraded=${health === "healthy" ? "false" : "true"}`,
    `decision=${decision}`,
    `exportFormat=${input.exportFormat ?? "summary"}`,
    `reportWindow=${input.reportWindow ?? input.ttl ?? "15m"}`,
    `exportLabel=${compactApprovalToken(input.exportLabel, `${subject}:${decision}`)}`,
  ];
  if (operator) fields.push(`operator=${operator}`);
  if (input.decidedAt) fields.push(`decidedAt=${input.decidedAt}`);
  if (input.reportedAt) fields.push(`reportedAt=${input.reportedAt}`);
  if (input.history) fields.push(`history=${input.history}`);
  return fields.join(" ");
}

export function createApprovalPreviewAcceptanceContract(input = {}) {
  const source = createPreviewApprovalSource(input);
  const descriptor = compileApprovalBinding(source, {
    approvalId: input.approvalId,
    clientRequest: input.clientRequest,
  });
  const issueCodes = [
    ...(Array.isArray(input.blockingIssueCodes) ? input.blockingIssueCodes : []),
    ...(Array.isArray(input.warningIssueCodes) ? input.warningIssueCodes : []),
  ];
  const awaitingAcceptance = descriptor.statusContract.state.awaitingOperator
    && descriptor.statusContract.state.terminal === false;
  const blocked = descriptor.health.state === "unavailable"
    || issueCodes.some((code) => String(code).includes("missing") || String(code).includes("blocked"));

  return Object.freeze({
    kind: "approval.preview_acceptance_contract",
    version: "mailchimp.preview-approval.v1",
    approvalId: descriptor.id,
    source,
    status: blocked
      ? "blocked"
      : awaitingAcceptance
        ? "awaiting_operator"
        : descriptor.statusContract.state.terminal
          ? descriptor.statusContract.state.decision
          : "ready",
    userVisible: input.userVisible !== false,
    request: Object.freeze({
      action: descriptor.payload.requestedAction,
      subject: descriptor.subject,
      reason: descriptor.payload.reason,
      clientRequest: descriptor.payload.clientRequest,
      risk: descriptor.payload.risk,
      ttl: descriptor.payload.ttl,
    }),
    readiness: Object.freeze({
      approvalRequired: input.approvalRequired !== false,
      awaitingAcceptance,
      terminal: descriptor.statusContract.state.terminal,
      exportReady: descriptor.reporting.exportReady,
      blocked,
      issueCodes: Object.freeze(issueCodes),
    }),
    nextStep: Object.freeze({
      id: blocked
        ? "settings.fix"
        : awaitingAcceptance
          ? "preview.accept"
          : descriptor.recovery.nextAction,
      label: blocked
        ? "Fix provider settings"
        : awaitingAcceptance
          ? "Accept preview"
          : "Export approval receipt",
      enabled: blocked === false,
      receiptRequired: descriptor.recovery.receiptRequired,
    }),
    descriptor,
    reporting: descriptor.reporting,
    statusContract: descriptor.statusContract,
    recovery: descriptor.recovery,
  });
}

function requireApprovalFields(fields) {
  for (const field of APPROVAL_BINDING_GRAMMAR.requiredFields) {
    if (!fields[field]) throw new SyntaxError(`missing required approval.request field ${field}`);
  }
}

export function parseApprovalBinding(source) {
  const fields = parseApprovalAssignments(tokenizeApprovalSource(source));
  validateKnownApprovalFields(fields);
  requireApprovalFields(fields);
  const health = normalizeHealth(fields.health);
  const decision = normalizeDecision(fields.decision);
  const decidedAt = normalizeTimestamp(fields.decidedAt, "decidedAt");
  const adapterStatus = normalizeAdapterStatus(fields.adapterStatus, health, decision);
  const receiptStatus = normalizeReceiptStatus(fields.receiptStatus, decision, adapterStatus);
  const operator = normalizeApprovalIdentifier(fields.operator, "operator", undefined);
  const receiptOperator = normalizeApprovalIdentifier(fields.receiptOperator, "receiptOperator", operator);
  const receiptDecidedAt = normalizeTimestamp(fields.receiptDecidedAt, "receiptDecidedAt") ?? decidedAt;
  const reportedAt = normalizeTimestamp(fields.reportedAt, "reportedAt") ?? receiptDecidedAt ?? decidedAt ?? "pending";
  const attempt = normalizeAttempt(fields.attempt, "attempt", health === "healthy" ? 0 : 1);
  const maxAttempts = normalizeAttempt(fields.maxAttempts, "maxAttempts", 3);
  const ttl = normalizeTtl(fields.ttl);
  const ast = Object.freeze({
    type: "ApprovalBinding",
    command: APPROVAL_BINDING_GRAMMAR.command,
    action: fields.action,
    subject: fields.subject ?? fields.action,
    reason: fields.reason,
    risk: normalizeRisk(fields.risk),
    ttl,
    rollback: fields.rollback ?? `deny:${fields.action}`,
    claim: fields.claim ?? "operator-attested",
    clientRequest: normalizeApprovalIdentifier(fields.clientRequest, "clientRequest", undefined),
    health,
    retryAfter: normalizeRetryAfter(fields.retryAfter, health),
    degraded: normalizeBoolean(fields.degraded, "degraded", health !== "healthy"),
    errorCode: normalizeApprovalIdentifier(fields.errorCode, "errorCode", health === "healthy" ? undefined : "approval-runtime-degraded"),
    decision,
    adapterStatus,
    operator,
    decidedAt,
    receipt: Object.freeze({
      status: receiptStatus,
      operator: receiptOperator,
      decidedAt: receiptDecidedAt,
      error: normalizeApprovalIdentifier(fields.receiptError, "receiptError", undefined),
    }),
    attempt,
    maxAttempts,
    history: normalizeHistorySnapshot(fields.history, decision, decidedAt),
    exportFormat: normalizeExportFormat(fields.exportFormat),
    exportLabel: normalizeApprovalIdentifier(fields.exportLabel, "exportLabel", `${fields.action}:${decision}`),
    reportedAt,
    reportWindow: normalizeReportWindow(fields.reportWindow, ttl),
  });
  validateAdapterStatusHandoff(ast);
  validateHistoryTimeline(ast);
  return ast;
}

export function compileApprovalBinding(source, options = {}) {
  const ast = typeof source === "string" ? parseApprovalBinding(source) : source;
  const approvalId = options.approvalId ?? `approval:${ast.action}:${ast.subject}`;
  const clientRequest = options.clientRequest ?? ast.clientRequest ?? approvalId;
  const historySnapshots = createApprovalHistorySnapshots(ast, approvalId);
  const analytics = createApprovalAnalytics(ast, approvalId, historySnapshots);
  const timeline = createApprovalTimeline(ast, approvalId, historySnapshots);
  const exportSummary = createApprovalExportSummary(ast, approvalId, clientRequest, analytics);
  const statusContract = createApprovalStatusContract(ast, approvalId, clientRequest);
  const recoveryPlan = createApprovalRecoveryPlan(ast, approvalId, statusContract, analytics.metrics);
  const reporting = createApprovalReportingState(ast, approvalId, clientRequest, analytics, timeline, statusContract, recoveryPlan);
  const clientResumeCheckpoint = createApprovalClientResumeCheckpoint(
    ast,
    approvalId,
    clientRequest,
    analytics,
    statusContract,
    recoveryPlan,
    reporting,
  );
  const descriptorDraft = {
    id: approvalId,
    subject: ast.subject,
    payload: Object.freeze({
      requestedAction: ast.action,
      reason: ast.reason,
      risk: ast.risk,
      ttl: ast.ttl,
      rollback: ast.rollback,
      clientRequest,
      health: ast.health,
      decision: ast.decision,
      adapterStatus: ast.adapterStatus,
      receipt: ast.receipt,
      attempt: ast.attempt,
      maxAttempts: ast.maxAttempts,
      reportWindow: ast.reportWindow,
      exportLabel: ast.exportLabel,
      reportedAt: ast.reportedAt,
      operator: ast.operator,
      decidedAt: ast.decidedAt,
    }),
    health: Object.freeze({
      state: ast.health,
      degraded: ast.degraded,
      retryAfter: ast.retryAfter,
      errorCode: ast.errorCode,
      actionableError: ast.health === "healthy"
        ? undefined
        : `approval runtime ${ast.health}; retry after ${ast.retryAfter}`,
    }),
    analytics,
    timeline,
    exportSummary,
    reporting,
    statusContract,
    clientResumeCheckpoint,
    recovery: recoveryPlan,
  };
  const operatorReadinessHandoff = createApprovalOperatorReadinessHandoff(descriptorDraft);
  return Object.freeze({
    kind: "kernel.job.descriptor",
    apiVersion: "aios.runtime/v1",
    id: approvalId,
    action: "approval.request",
    subject: ast.subject,
    payload: Object.freeze({
      requestedAction: ast.action,
      reason: ast.reason,
      risk: ast.risk,
      ttl: ast.ttl,
      rollback: ast.rollback,
      clientRequest,
      health: ast.health,
      decision: ast.decision,
      adapterStatus: ast.adapterStatus,
      receipt: ast.receipt,
      attempt: ast.attempt,
      maxAttempts: ast.maxAttempts,
      reportWindow: ast.reportWindow,
      exportLabel: ast.exportLabel,
      reportedAt: ast.reportedAt,
      operator: ast.operator,
      decidedAt: ast.decidedAt,
      operatorReadinessHandoffId: operatorReadinessHandoff.handoffId,
      operatorReadinessStatus: operatorReadinessHandoff.status,
      operatorReadinessNextAction: operatorReadinessHandoff.nextAction,
    }),
    capabilities: APPROVAL_BINDING_STDLIB.capabilities,
    memory: Object.freeze({ reservationMiB: 1, scope: `approval:${ast.subject}` }),
    health: Object.freeze({
      state: ast.health,
      degraded: ast.degraded,
      retryAfter: ast.retryAfter,
      errorCode: ast.errorCode,
      actionableError: ast.health === "healthy"
        ? undefined
        : `approval runtime ${ast.health}; retry after ${ast.retryAfter}`,
    }),
    analytics,
    timeline,
    exportSummary,
    reporting,
    statusContract,
    clientResumeCheckpoint,
    operatorReadinessHandoff,
    verifier: Object.freeze({
      claims: APPROVAL_BINDING_STDLIB.verifierClaims,
      evidenceClaim: ast.claim,
      truthBoundary: "operator-decision-required-before-runtime-action",
      statusHandoff: Object.freeze({
        adapterStatus: ast.adapterStatus,
        receiptStatus: ast.receipt.status,
        receiptBound: ast.receipt.status === ast.decision || ast.receipt.status === "retrying" || ast.receipt.status === "failed",
      }),
    }),
    recovery: recoveryPlan,
  });
}

export function createApprovalRuntimeHandoff(source, options = {}) {
  const descriptor = compileApprovalBinding(source, options);
  return Object.freeze({
    adapter: "kernel.approval.runtime",
    descriptor,
    localOnly: true,
    externalWrites: false,
    health: descriptor.health,
    statusContract: descriptor.statusContract,
    recovery: descriptor.recovery,
    analytics: descriptor.analytics,
    exportSummary: descriptor.exportSummary,
    reporting: descriptor.reporting,
    expectedReceipt: descriptor.recovery.handoff.expectedReceipt,
    clientResumeCheckpoint: descriptor.clientResumeCheckpoint,
    operatorReadinessHandoff: descriptor.operatorReadinessHandoff,
  });
}

export function createApprovalExportReport(source, options = {}) {
  const descriptor = compileApprovalBinding(source, options);
  return Object.freeze({
    summary: descriptor.exportSummary,
    analytics: descriptor.analytics,
    timeline: descriptor.timeline,
    reporting: descriptor.reporting,
    statusContract: descriptor.statusContract,
    clientResumeCheckpoint: descriptor.clientResumeCheckpoint,
    operatorReadinessHandoff: descriptor.operatorReadinessHandoff,
    recovery: descriptor.recovery,
    truthBoundary: descriptor.verifier.truthBoundary,
  });
}

export function createApprovalExportPackageReport(source, options = {}) {
  return createApprovalExportPackage(compileApprovalBinding(source, options));
}

export function selfCheckApprovalBinding(source = APPROVAL_BINDING_EXAMPLE) {
  const descriptor = compileApprovalBinding(source);
  const requiredCapabilitiesPresent = APPROVAL_BINDING_STDLIB.capabilities.every((capability) => (
    descriptor.capabilities.includes(capability)
  ));
  const requiredClaimsPresent = APPROVAL_BINDING_STDLIB.verifierClaims.every((claim) => (
    descriptor.verifier.claims.includes(claim)
  ));
  const statusBound = descriptor.statusContract.approvalId === descriptor.id
    && descriptor.recovery.handoff.adapterStatus === descriptor.statusContract.adapter.status
    && descriptor.recovery.handoff.receiptStatus === descriptor.statusContract.receipt.status;
  const reportBound = descriptor.reporting.approvalId === descriptor.id
    && descriptor.reporting.timelineRange.snapshots === descriptor.timeline.length
    && descriptor.exportSummary.historyDigest === descriptor.analytics.historyDigest;
  const checkpointBound = descriptor.clientResumeCheckpoint.approvalId === descriptor.id
    && descriptor.clientResumeCheckpoint.body.reportId === descriptor.reporting.reportId
    && descriptor.clientResumeCheckpoint.commands.persist.externalWrites === false;
  const replayManifestBound = descriptor.clientResumeCheckpoint.replayManifest.checkpointKey === descriptor.clientResumeCheckpoint.checkpointKey
    && descriptor.clientResumeCheckpoint.replayManifest.checksum === descriptor.clientResumeCheckpoint.checksum
    && descriptor.clientResumeCheckpoint.replayManifest.commands.persist.id === descriptor.clientResumeCheckpoint.commands.persist.id
    && descriptor.clientResumeCheckpoint.replayManifest.commands.resume.id === descriptor.clientResumeCheckpoint.commands.resume.id;
  const operatorHandoffBound = descriptor.operatorReadinessHandoff.request.approvalId === descriptor.id
    && descriptor.operatorReadinessHandoff.readiness.reportId === descriptor.reporting.reportId
    && descriptor.operatorReadinessHandoff.readiness.checkpointKey === descriptor.clientResumeCheckpoint.checkpointKey
    && descriptor.operatorReadinessHandoff.restart.externalWritesPerformed === false;
  return Object.freeze({
    ok: requiredCapabilitiesPresent && requiredClaimsPresent && statusBound && reportBound && checkpointBound && replayManifestBound && operatorHandoffBound,
    descriptorId: descriptor.id,
    requiredCapabilitiesPresent,
    requiredClaimsPresent,
    statusBound,
    reportBound,
    checkpointBound,
    replayManifestBound,
    operatorHandoffBound,
    reportId: descriptor.reporting.reportId,
    checkpointKey: descriptor.clientResumeCheckpoint.checkpointKey,
    operatorReadinessHandoffId: descriptor.operatorReadinessHandoff.handoffId,
    replayManifestId: descriptor.clientResumeCheckpoint.replayManifest.manifestId,
    nextAction: descriptor.recovery.nextAction,
  });
}

export {
  APPROVAL_BINDING_EXAMPLE,
  APPROVAL_BINDING_GRAMMAR,
  APPROVAL_BINDING_STDLIB,
  createApprovalOperatorReadinessHandoff,
};
