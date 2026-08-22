const PROCESS_BOOT_GRAMMAR = Object.freeze({
  command: "process.boot",
  requiredFields: Object.freeze(["process", "image"]),
  optionalFields: Object.freeze([
    "args",
    "env",
    "cwd",
    "restart",
    "memory",
    "approval",
    "clientRequest",
    "workflow",
    "resume",
    "statusChannel",
    "stateKey",
    "attempt",
    "lastStatus",
    "receipt",
  ]),
});

const PROCESS_BOOT_STDLIB = Object.freeze({
  command: "process.boot",
  capabilities: Object.freeze(["kernel.process.spawn", "kernel.memory.allocate", "kernel.audit.append"]),
  verifierClaims: Object.freeze(["boot.image.bound", "boot.env.local", "boot.rollback.available"]),
});

const PROCESS_BOOT_EXAMPLE = `process.boot process=mailchimp-sync image=internal/mailchimp-sync:v1 args="--mode poll" memory=256Mi restart=on-failure workflow=mailchimp-import clientRequest=req_123 resume=last-status statusChannel=mailchimp-sync stateKey=mailchimp-sync:boot attempt=2 lastStatus=spawning receipt=boot_receipt_42`;

function tokenizeRuntimeSource(source) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new TypeError("process boot source must be a non-empty string");
  }
  return source.trim().match(/[^\s="]+=(?:"(?:\\.|[^"\\])*"|[^\s]+)|[^\s]+/g) ?? [];
}

function parseAssignments(tokens, command) {
  if (tokens[0] !== command) {
    throw new SyntaxError(`expected ${command} command`);
  }
  const fields = {};
  for (const token of tokens.slice(1)) {
    const splitAt = token.indexOf("=");
    if (splitAt <= 0) {
      throw new SyntaxError(`expected key=value field, received ${token}`);
    }
    const key = token.slice(0, splitAt);
    const rawValue = token.slice(splitAt + 1);
    const value = rawValue.startsWith("\"") && rawValue.endsWith("\"")
      ? rawValue.slice(1, -1).replace(/\\"/g, "\"")
      : rawValue;
    fields[key] = value;
  }
  return fields;
}

function normalizeMiB(value, fallback) {
  if (value === undefined) return fallback;
  const match = /^(\d+)(Mi|MiB|M|MB)?$/i.exec(String(value));
  if (!match) throw new SyntaxError(`invalid memory value ${value}`);
  return Number(match[1]);
}

function normalizeIdentifier(value, field, fallback) {
  const selected = value ?? fallback;
  if (!selected) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{1,127}$/.test(selected)) {
    throw new SyntaxError(`invalid process.boot ${field} ${selected}`);
  }
  return selected;
}

function normalizeResumeMode(value) {
  const selected = value ?? "fresh";
  if (!["fresh", "last-status", "receipt"].includes(selected)) {
    throw new SyntaxError(`unsupported process.boot resume mode ${selected}`);
  }
  return selected;
}

function normalizeAttempt(value) {
  const selected = value ?? "1";
  if (!/^\d+$/.test(String(selected))) {
    throw new SyntaxError(`invalid process.boot attempt ${selected}`);
  }
  const attempt = Number(selected);
  if (attempt < 1 || attempt > 1000) {
    throw new SyntaxError(`process.boot attempt must be between 1 and 1000, received ${selected}`);
  }
  return attempt;
}

function normalizeBootStatus(value) {
  if (value === undefined) return undefined;
  const selected = String(value);
  if (!["queued", "allocating-memory", "spawning", "ready", "failed", "rolled-back"].includes(selected)) {
    throw new SyntaxError(`unsupported process.boot lastStatus ${selected}`);
  }
  return selected;
}

function normalizeBootStateKey(value, astLike) {
  const selected = value ?? `${astLike.workflow}:${astLike.process}:boot`;
  return normalizeIdentifier(selected, "stateKey", undefined);
}

function assertRequired(fields) {
  for (const field of PROCESS_BOOT_GRAMMAR.requiredFields) {
    if (!fields[field]) throw new SyntaxError(`missing required process.boot field ${field}`);
  }
}

function deriveBootCommandId(ast, clientRequest) {
  return [
    "process.boot",
    ast.workflow,
    ast.process,
    ast.image,
    clientRequest,
  ].join(":");
}

function deriveBootResumeCursor(ast, stateKey) {
  if (ast.resume === "fresh") {
    return Object.freeze({
      mode: "fresh",
      stateKey,
      receipt: undefined,
      lastStatus: undefined,
      recoverable: false,
    });
  }
  if (ast.resume === "receipt") {
    if (!ast.receipt) {
      throw new SyntaxError("process.boot resume=receipt requires receipt field");
    }
    return Object.freeze({
      mode: "receipt",
      stateKey,
      receipt: ast.receipt,
      lastStatus: ast.lastStatus,
      recoverable: true,
    });
  }
  return Object.freeze({
    mode: "last-status",
    stateKey,
    receipt: ast.receipt,
    lastStatus: ast.lastStatus ?? "queued",
    recoverable: true,
  });
}

function deriveRestartSafeStatus(ast) {
  if (ast.resume === "fresh") return "new-command";
  if (ast.lastStatus === "ready") return "already-ready";
  if (ast.lastStatus === "failed" && ast.restart === "on-failure") return "retryable-failure";
  if (ast.lastStatus === "failed") return "terminal-failure";
  if (ast.lastStatus === "rolled-back") return "rolled-back";
  return "resume-in-progress";
}

function deriveBootRecoveryPlan(ast, commandId, stateKey) {
  const restartSafeStatus = deriveRestartSafeStatus(ast);
  const canRetry = restartSafeStatus === "retryable-failure" || (
    ast.restart === "on-failure" && ["queued", "allocating-memory", "spawning"].includes(ast.lastStatus)
  );
  return Object.freeze({
    commandId,
    stateKey,
    restartSafeStatus,
    idempotencyScope: `process:${ast.process}:image:${ast.image}`,
    nextCommand: restartSafeStatus === "already-ready"
      ? "report-ready-receipt"
      : canRetry
        ? "replay-boot-command"
        : "start-boot-command",
    replayAllowed: ast.resume !== "fresh" && restartSafeStatus !== "terminal-failure",
    rollbackOnFailure: `terminate:${ast.process};release-memory:${ast.process};mark-state:${stateKey}:rolled-back`,
  });
}

function deriveBootBackoff(attempt, restartSafeStatus) {
  const retryable = restartSafeStatus === "retryable-failure" || restartSafeStatus === "resume-in-progress";
  const baseMs = 1000;
  const maxMs = 30000;
  return Object.freeze({
    retryable,
    attempt,
    baseMs,
    maxMs,
    backoffMs: retryable ? Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1))) : 0,
    strategy: retryable ? "exponential-boot-replay" : "none",
  });
}

function deriveBootFailureState(ast, recoveryPlan) {
  if (recoveryPlan.restartSafeStatus === "already-ready") return "none";
  if (recoveryPlan.restartSafeStatus === "retryable-failure") return "spawn-failed-retryable";
  if (recoveryPlan.restartSafeStatus === "terminal-failure") return "spawn-failed-terminal";
  if (recoveryPlan.restartSafeStatus === "rolled-back") return "rollback-complete";
  if (ast.resume !== "fresh") return "resume-checkpoint-open";
  return "boot-not-started";
}

function buildBootOperationalHealth(ast, commandId, stateKey, recoveryPlan) {
  const backoff = deriveBootBackoff(ast.attempt, recoveryPlan.restartSafeStatus);
  const terminal = ["already-ready", "terminal-failure", "rolled-back"].includes(recoveryPlan.restartSafeStatus);
  const blocked = recoveryPlan.restartSafeStatus === "terminal-failure";
  const degraded = backoff.retryable || recoveryPlan.restartSafeStatus === "resume-in-progress";
  const failureState = deriveBootFailureState(ast, recoveryPlan);
  const nextAction = blocked
    ? "inspect_process_boot_failure"
    : recoveryPlan.nextCommand === "replay-boot-command"
      ? "replay_process_boot_command"
      : recoveryPlan.nextCommand === "report-ready-receipt"
        ? "report_process_ready_receipt"
        : "start_process_boot_command";

  return Object.freeze({
    protocol: "aios.process-boot-operational-health.mailchimp.v1",
    process: ast.process,
    image: ast.image,
    commandId,
    stateKey,
    status: blocked ? "failed" : degraded ? "degraded" : "healthy",
    restartSafeStatus: recoveryPlan.restartSafeStatus,
    failureState,
    degraded,
    terminal,
    retryable: backoff.retryable && !blocked,
    backoff,
    nextAction,
    actionableError: blocked
      ? `process.boot ${ast.process} failed without an automatic restart path`
      : degraded
        ? `process.boot ${ast.process} should resume from ${stateKey}`
      : "",
  });
}

function buildBootExportReport(ast, context) {
  const {
    jobId,
    clientRequest,
    workflow,
    commandId,
    stateKey,
    resumeCursor,
    recoveryPlan,
    operationalHealth,
  } = context;
  const transitionRows = Object.entries(context.expectedTransitions).map(([from, to]) => Object.freeze({
    from,
    to: Object.freeze([...to]),
    terminal: to.length === 0,
  }));
  const blocked = operationalHealth.status === "failed";
  const waiting = operationalHealth.degraded || operationalHealth.retryable;
  const exportReady = blocked === false;
  const nextAction = operationalHealth.nextAction;
  const historySnapshots = Object.freeze([
    Object.freeze({
      id: `boothist:${stateKey}:${commandId}:parsed`,
      sequence: 1,
      type: "process-boot-parsed",
      status: "parsed",
      process: ast.process,
      image: ast.image,
      workflow,
      clientRequest,
    }),
    Object.freeze({
      id: `boothist:${stateKey}:${commandId}:resume`,
      sequence: 2,
      type: "process-boot-resume-bound",
      status: resumeCursor.mode,
      stateKey,
      receipt: resumeCursor.receipt,
      lastStatus: resumeCursor.lastStatus,
      recoverable: resumeCursor.recoverable,
    }),
    Object.freeze({
      id: `boothist:${stateKey}:${commandId}:recovery`,
      sequence: 3,
      type: "process-boot-recovery-planned",
      status: recoveryPlan.restartSafeStatus,
      nextCommand: recoveryPlan.nextCommand,
      replayAllowed: recoveryPlan.replayAllowed,
      rollbackOnFailure: recoveryPlan.rollbackOnFailure,
    }),
    Object.freeze({
      id: `boothist:${stateKey}:${commandId}:health`,
      sequence: 4,
      type: "process-boot-health-evaluated",
      status: operationalHealth.status,
      failureState: operationalHealth.failureState,
      retryable: operationalHealth.retryable,
      retryAfterMs: operationalHealth.backoff.backoffMs,
      nextAction,
    }),
    Object.freeze({
      id: `boothist:${stateKey}:${commandId}:export:${exportReady ? "ready" : "blocked"}`,
      sequence: 5,
      type: "process-boot-export-shaped",
      status: exportReady ? waiting ? "waiting" : "ready" : "blocked",
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
    ...(operationalHealth.actionableError ? [Object.freeze({
      code: `process.boot.${operationalHealth.failureState}`,
      severity: blocked ? "error" : "warning",
      owner: blocked ? "operator" : "runtime",
      action: nextAction,
      message: operationalHealth.actionableError,
      retryable: operationalHealth.retryable,
    })] : []),
    ...(resumeCursor.mode === "receipt" && !resumeCursor.receipt ? [Object.freeze({
      code: "process.boot.receipt_missing",
      severity: "error",
      owner: "runtime",
      action: "bind_process_boot_receipt",
      message: "process.boot resume=receipt requires a persisted receipt before export.",
      retryable: false,
    })] : []),
  ]);

  return Object.freeze({
    protocol: "aios.process-boot-export-report.mailchimp.v1",
    id: `bootreport:${stateKey}:${commandId}`,
    jobId,
    process: ast.process,
    image: ast.image,
    workflow,
    commandId,
    clientRequest,
    stateKey,
    status: exportReady ? waiting ? "waiting" : "ready" : "blocked",
    exportReady,
    nextAction,
    counters: Object.freeze({
      attempts: ast.attempt,
      historySnapshots: historySnapshots.length,
      timelineEvents: timeline.length,
      transitionRows: transitionRows.length,
      terminalStates: transitionRows.filter((row) => row.terminal).length,
      actionableErrors: actionableErrors.length,
      replayAllowed: recoveryPlan.replayAllowed ? 1 : 0,
      retryable: operationalHealth.retryable ? 1 : 0,
    }),
    restartSemantics: Object.freeze({
      restartSafeStatus: recoveryPlan.restartSafeStatus,
      resumeMode: resumeCursor.mode,
      replayAllowed: recoveryPlan.replayAllowed,
      duplicateCommandPolicy: "dedupe-by-process-boot-command-id",
      idempotencyScope: recoveryPlan.idempotencyScope,
      externalWritesPerformed: false,
    }),
    health: Object.freeze({
      status: operationalHealth.status,
      degraded: operationalHealth.degraded,
      terminal: operationalHealth.terminal,
      retryable: operationalHealth.retryable,
      failureState: operationalHealth.failureState,
      retryAfterMs: operationalHealth.backoff.backoffMs,
    }),
    transitionRows: Object.freeze(transitionRows),
    actionableErrors,
    historySnapshots,
    timeline,
    exportSummary: Object.freeze({
      format: "aios.process-boot-export-summary.mailchimp.v1",
      exportReady,
      status: exportReady ? waiting ? "waiting" : "ready" : "blocked",
      nextAction,
      blockerCodes: actionableErrors.filter((error) => error.severity === "error").map((error) => error.code),
      warningCodes: actionableErrors.filter((error) => error.severity === "warning").map((error) => error.code),
      historySnapshotIds: historySnapshots.map((snapshot) => snapshot.id),
      timelineEventCount: timeline.length,
      externalWritesPerformed: false,
    }),
  });
}

function buildBootRollbackReadinessEvidence(descriptor, exportReport) {
  const health = descriptor.operationalHealth;
  const resumeCursor = descriptor.persistedState.resumeCursor;
  const terminalFailure = health.failureState === "spawn-failed-terminal";
  const waitingForReplay = health.retryable === true || exportReport.status === "waiting";
  const ready = terminalFailure === false && exportReport.exportReady === true;
  const queueImpact = terminalFailure
    ? "block_rollback_queue"
    : waitingForReplay
      ? "wait_for_process_boot_replay"
      : health.degraded
        ? "degraded_runtime_warning"
        : "none";
  const evidenceRows = Object.freeze([
    Object.freeze({
      code: "process.boot.rollback.state",
      ok: terminalFailure === false,
      severity: terminalFailure ? "error" : "info",
      detail: terminalFailure
        ? "Process boot reached a terminal failure before rollback handoff."
        : `Process boot restart-safe status is ${health.restartSafeStatus}.`,
      nextAction: terminalFailure ? "inspect_process_boot_failure" : health.nextAction,
    }),
    Object.freeze({
      code: "process.boot.rollback.resume_cursor",
      ok: resumeCursor.mode === "fresh" || resumeCursor.recoverable === true,
      severity: resumeCursor.mode === "fresh" || resumeCursor.recoverable === true ? "info" : "warning",
      detail: resumeCursor.mode === "fresh"
        ? "No resume cursor is required for this boot command."
        : `Boot can resume from ${resumeCursor.mode}.`,
      nextAction: resumeCursor.mode === "receipt" ? "report_process_ready_receipt" : health.nextAction,
    }),
    Object.freeze({
      code: "process.boot.rollback.export",
      ok: exportReport.exportReady === true,
      severity: exportReport.exportReady === true ? "info" : "warning",
      detail: exportReport.exportReady
        ? "Process boot export report is ready for rollback readiness aggregation."
        : "Process boot export report is waiting on runtime recovery.",
      nextAction: exportReport.nextAction,
    }),
  ]);
  const blockers = evidenceRows.filter((row) => row.severity === "error" && row.ok !== true).map((row) => row.code);
  const warnings = evidenceRows.filter((row) => row.severity === "warning" && row.ok !== true).map((row) => row.code);

  return Object.freeze({
    protocol: "aios.process-boot-rollback-readiness.mailchimp.v1",
    component: descriptor.subject,
    commandId: descriptor.payload.commandId,
    stateKey: descriptor.payload.stateKey,
    status: ready ? waitingForReplay ? "waiting" : "ready" : "blocked",
    ready,
    queueImpact,
    terminal: health.terminal,
    retryable: health.retryable,
    retryAfterMs: health.backoff.backoffMs,
    nextAction: blockers.length > 0
      ? evidenceRows.find((row) => blockers.includes(row.code))?.nextAction || "inspect_process_boot_failure"
      : warnings.length > 0
        ? evidenceRows.find((row) => warnings.includes(row.code))?.nextAction || health.nextAction
        : health.nextAction,
    failureState: health.failureState,
    exportReportId: exportReport.id,
    exportReady: exportReport.exportReady,
    blockerCodes: Object.freeze(blockers),
    warningCodes: Object.freeze(warnings),
    evidenceRows,
  });
}

function buildProcessBootProviderOperationManifest(descriptor, exportReport, options = {}) {
  const runtime = options.runtime && typeof options.runtime === "object" ? options.runtime : options;
  const source = runtime.providerOperation && typeof runtime.providerOperation === "object"
    ? runtime.providerOperation
    : runtime.mailchimpProviderOperation && typeof runtime.mailchimpProviderOperation === "object"
      ? runtime.mailchimpProviderOperation
      : {};
  const health = descriptor.operationalHealth;
  const requiredCapabilities = Object.freeze([
    "adapter.mailchimp",
    "kernel.process.spawn",
    "kernel.audit.append",
    "mailchimp.provider.status.read",
  ]);
  const offeredCapabilities = Object.freeze([...new Set([
    ...(Array.isArray(source.capabilities) ? source.capabilities : []),
    ...(Array.isArray(runtime.mailchimpCapabilities) ? runtime.mailchimpCapabilities : []),
    "kernel.process.spawn",
    "kernel.audit.append",
  ].map((capability) => String(capability ?? "").trim()).filter(Boolean))].sort());
  const missingCapabilities = Object.freeze(requiredCapabilities.filter((capability) => !offeredCapabilities.includes(capability)));
  const syncCursor = String(source.syncCursor || source.cursor || descriptor.persistedState.key || "").trim();
  const providerRequestId = String(source.providerRequestId || source.requestId || descriptor.payload.commandId || "").trim();
  const handoffState = String(source.handoffState || source.state || (health.retryable ? "retry_pending" : "ready")).trim();
  const statusRef = String(source.statusRef || descriptor.payload.statusChannel || "").trim();
  const validationRows = Object.freeze([
    Object.freeze({
      code: "process.boot.provider.capabilities",
      status: missingCapabilities.length === 0 ? "pass" : "waiting",
      owner: "adapter",
      nextAction: missingCapabilities.length === 0 ? "publish_process_boot_provider_manifest" : "negotiate_mailchimp_provider_capabilities",
      detail: missingCapabilities.length === 0
        ? "Process boot provider operation has the capabilities needed for Mailchimp status handoff."
        : `Process boot provider operation is missing capabilities: ${missingCapabilities.join(", ")}.`,
    }),
    Object.freeze({
      code: "process.boot.provider.sync_cursor",
      status: syncCursor ? "pass" : "waiting",
      owner: "runtime",
      nextAction: syncCursor ? "publish_process_boot_provider_manifest" : "bind_process_boot_sync_cursor",
      detail: syncCursor
        ? "Process boot state key is available as provider sync metadata."
        : "Process boot provider operation needs a sync cursor before rollback aggregation.",
    }),
    Object.freeze({
      code: "process.boot.provider.health",
      status: health.status === "failed" ? "blocked" : health.retryable ? "waiting" : "pass",
      owner: health.status === "failed" ? "operator" : "runtime",
      nextAction: health.nextAction,
      detail: health.status === "failed"
        ? "Process boot provider operation is blocked by terminal boot health."
        : health.retryable
          ? "Process boot provider operation is waiting on boot replay."
          : "Process boot provider operation is healthy for rollback status handoff.",
    }),
    Object.freeze({
      code: "process.boot.provider.export",
      status: exportReport.exportReady ? "pass" : "waiting",
      owner: "runtime",
      nextAction: exportReport.nextAction,
      detail: exportReport.exportReady
        ? "Process boot export report is ready to attach to provider operation metadata."
        : "Process boot export report is not ready for provider operation metadata.",
    }),
  ]);
  const blocked = validationRows.filter((row) => row.status === "blocked");
  const waiting = validationRows.filter((row) => row.status === "waiting");
  const status = blocked.length > 0 ? "blocked" : waiting.length > 0 ? "waiting" : "ready";

  return Object.freeze({
    protocol: "aios.process-boot-provider-operation.mailchimp.v1",
    operationId: `providerop:${descriptor.persistedState.key}:${descriptor.payload.commandId}`,
    component: descriptor.subject,
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
      exportReportId: exportReport.id,
      restartSafeStatus: descriptor.persistedState.restartSafeStatus,
      lastStatus: descriptor.persistedState.resumeCursor.lastStatus || "queued",
    }),
    capabilityNegotiation: Object.freeze({
      required: requiredCapabilities,
      offered: offeredCapabilities,
      missing: missingCapabilities,
      satisfied: missingCapabilities.length === 0,
    }),
    health: Object.freeze({
      state: health.status,
      failureState: health.failureState,
      retryable: health.retryable,
      retryAfterMs: health.backoff.backoffMs,
      rollbackReadinessStatus: descriptor.rollbackReadinessEvidence.status,
      queueImpact: descriptor.rollbackReadinessEvidence.queueImpact,
    }),
    validationRows,
    counters: Object.freeze({
      validationRows: validationRows.length,
      blockedRows: blocked.length,
      waitingRows: waiting.length,
      missingCapabilities: missingCapabilities.length,
      retryable: health.retryable ? 1 : 0,
    }),
    externalHandoff: Object.freeze({
      localOnly: true,
      externalWritesPerformed: false,
      requestId: providerRequestId,
      state: handoffState,
      statusRef,
    }),
  });
}

function buildProcessBootRollbackReadinessPacket(descriptor) {
  const readiness = descriptor.rollbackReadinessEvidence;
  const exportReport = descriptor.exportReport;
  const providerOperation = descriptor.providerOperationManifest;
  const health = descriptor.operationalHealth;
  const blocked = readiness.status === "blocked" || providerOperation.status === "blocked";
  const waiting = blocked === false && (
    readiness.status === "waiting"
      || providerOperation.status === "waiting"
      || health.retryable === true
  );
  const status = blocked ? "blocked" : waiting ? "waiting" : "ready";
  const packetRows = Object.freeze([
    Object.freeze({
      code: "process.boot.packet.readiness",
      status: readiness.ready ? readiness.status : "blocked",
      owner: readiness.terminal ? "operator" : "runtime",
      nextAction: readiness.nextAction,
      detail: `Process boot rollback readiness is ${readiness.status}.`,
    }),
    Object.freeze({
      code: "process.boot.packet.export",
      status: exportReport.exportReady ? exportReport.status : "waiting",
      owner: "runtime",
      nextAction: exportReport.nextAction,
      detail: exportReport.exportReady
        ? "Process boot export report is attached to the readiness packet."
        : "Process boot export report is waiting before rollback aggregation.",
    }),
    Object.freeze({
      code: "process.boot.packet.provider",
      status: providerOperation.status,
      owner: providerOperation.status === "blocked" ? "adapter" : "runtime",
      nextAction: providerOperation.nextAction,
      detail: providerOperation.ready
        ? "Process boot provider operation is ready for rollback aggregation."
        : `Process boot provider operation is ${providerOperation.status}.`,
    }),
  ]);
  const blockedRows = packetRows.filter((row) => row.status === "blocked");
  const waitingRows = packetRows.filter((row) => row.status === "waiting");

  return Object.freeze({
    protocol: "aios.runtime-rollback-readiness-packet.mailchimp.v1",
    packetId: `rrp:process-boot:${descriptor.persistedState.key}:${descriptor.payload.commandId}`,
    componentType: "process_boot",
    component: descriptor.subject,
    commandId: descriptor.payload.commandId,
    stateKey: descriptor.persistedState.key,
    status,
    ready: status === "ready",
    nextAction: blockedRows[0]?.nextAction || waitingRows[0]?.nextAction || "continue_rollback_readiness",
    queueImpact: readiness.queueImpact,
    terminal: readiness.terminal || health.terminal,
    retryable: readiness.retryable || health.retryable,
    retryAfterMs: health.backoff.backoffMs,
    exportReady: exportReport.exportReady,
    exportReportId: exportReport.id,
    providerOperationId: providerOperation.operationId,
    owner: blockedRows.length > 0 ? blockedRows[0].owner : waitingRows[0]?.owner || "runtime",
    failureState: readiness.failureState,
    blockerCodes: Object.freeze([
      ...readiness.blockerCodes,
      ...providerOperation.validationRows.filter((row) => row.status === "blocked").map((row) => row.code),
    ]),
    warningCodes: Object.freeze([
      ...readiness.warningCodes,
      ...providerOperation.validationRows.filter((row) => row.status === "waiting").map((row) => row.code),
    ]),
    readinessEvidence: readiness,
    packetRows,
    counters: Object.freeze({
      packetRows: packetRows.length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      exportHistorySnapshots: exportReport.counters.historySnapshots,
      providerMissingCapabilities: providerOperation.counters.missingCapabilities,
      retryable: health.retryable ? 1 : 0,
    }),
  });
}

function buildProcessBootClientWorkflowReceipt(descriptor) {
  const health = descriptor.operationalHealth;
  const exportReport = descriptor.exportReport;
  const readiness = descriptor.rollbackReadinessEvidence;
  const providerOperation = descriptor.providerOperationManifest;
  const packet = descriptor.rollbackReadinessPacket;
  const resumeCursor = descriptor.persistedState.resumeCursor;
  const blocked = packet.status === "blocked" || health.status === "failed";
  const waiting = blocked === false && (packet.status === "waiting" || health.retryable === true);
  const accepted = descriptor.verifier.requiresApproval === false && blocked === false;
  const visibleStatus = blocked
    ? "boot-handoff-blocked"
    : waiting
      ? "boot-handoff-waiting"
      : health.terminal
        ? "boot-handoff-complete"
        : "boot-handoff-ready";
  const primaryAction = blocked
    ? packet.nextAction
    : waiting
      ? health.nextAction
      : resumeCursor.mode === "fresh"
        ? "start_process_boot_command"
        : "replay_process_boot_command";
  const validationRows = Object.freeze([
    Object.freeze({
      code: "process.boot.client.runtime_health",
      status: health.status === "failed" ? "blocked" : health.retryable ? "waiting" : "pass",
      owner: health.status === "failed" ? "operator" : "runtime",
      nextAction: health.nextAction,
      detail: health.actionableError || `Process boot health is ${health.status}.`,
    }),
    Object.freeze({
      code: "process.boot.client.export_report",
      status: exportReport.exportReady ? exportReport.status === "waiting" ? "waiting" : "pass" : "blocked",
      owner: "runtime",
      nextAction: exportReport.nextAction,
      detail: exportReport.exportReady
        ? `Process boot export report is ${exportReport.status}.`
        : "Process boot export report is not ready for client handoff.",
    }),
    Object.freeze({
      code: "process.boot.client.provider_operation",
      status: providerOperation.status === "ready" ? "pass" : providerOperation.status,
      owner: providerOperation.status === "blocked" ? "adapter" : "runtime",
      nextAction: providerOperation.nextAction,
      detail: providerOperation.ready
        ? "Provider operation metadata is ready for Mailchimp status handoff."
        : `Provider operation metadata is ${providerOperation.status}.`,
    }),
    Object.freeze({
      code: "process.boot.client.rollback_packet",
      status: packet.ready ? "pass" : packet.status,
      owner: packet.owner,
      nextAction: packet.nextAction,
      detail: packet.ready
        ? "Rollback readiness packet is ready for workflow aggregation."
        : `Rollback readiness packet is ${packet.status}.`,
    }),
  ]);
  const blockedRows = validationRows.filter((row) => row.status === "blocked");
  const waitingRows = validationRows.filter((row) => row.status === "waiting");

  return Object.freeze({
    protocol: "aios.process-boot-client-workflow-receipt.mailchimp.v1",
    receiptId: `bootreceipt:${descriptor.persistedState.key}:${descriptor.payload.commandId}:${visibleStatus}`,
    process: descriptor.subject,
    image: descriptor.payload.image,
    clientRequest: descriptor.payload.clientRequest,
    workflow: descriptor.payload.workflow,
    statusChannel: descriptor.payload.statusChannel,
    visibleStatus,
    status: blocked ? "blocked" : waiting ? "waiting" : "ready",
    accepted,
    acceptance: Object.freeze({
      required: descriptor.verifier.requiresApproval,
      status: descriptor.verifier.requiresApproval
        ? "operator_required"
        : accepted
          ? "accepted_by_system_policy"
          : "waiting",
      token: descriptor.payload.commandId,
      nextAction: descriptor.verifier.requiresApproval ? "request_process_boot_approval" : primaryAction,
    }),
    controls: Object.freeze({
      canStart: blocked === false && resumeCursor.mode === "fresh",
      canReplay: blocked === false && descriptor.recovery.plan.replayAllowed === true,
      canRollback: readiness.queueImpact !== "block_rollback_queue",
      canExport: exportReport.exportReady === true,
      nextAction: blockedRows[0]?.nextAction || waitingRows[0]?.nextAction || primaryAction,
    }),
    resume: Object.freeze({
      mode: resumeCursor.mode,
      stateKey: resumeCursor.stateKey,
      receipt: resumeCursor.receipt,
      lastStatus: resumeCursor.lastStatus,
      restartSafeStatus: descriptor.persistedState.restartSafeStatus,
      replayAllowed: descriptor.recovery.plan.replayAllowed,
    }),
    handoff: Object.freeze({
      providerOperationId: providerOperation.operationId,
      providerRequestId: providerOperation.providerRequestId,
      rollbackReadinessPacketId: packet.packetId,
      exportReportId: exportReport.id,
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
    timeline: Object.freeze(exportReport.timeline.map((event) => Object.freeze({
      ...event,
      clientVisible: true,
    }))),
  });
}

function buildProcessBootRuntimeHandoffDigest(descriptor) {
  const receipt = descriptor.clientWorkflowReceipt;
  const packet = descriptor.rollbackReadinessPacket;
  const providerOperation = descriptor.providerOperationManifest;
  const exportReport = descriptor.exportReport;
  const health = descriptor.operationalHealth;
  const resumeCursor = descriptor.persistedState.resumeCursor;
  const blocked = receipt.status === "blocked" || packet.status === "blocked";
  const waiting = blocked === false && (
    receipt.status === "waiting"
      || packet.status === "waiting"
      || providerOperation.status === "waiting"
      || health.retryable === true
  );
  const digestStatus = blocked ? "blocked" : waiting ? "waiting" : "ready";
  const restartToken = [
    descriptor.persistedState.key,
    descriptor.payload.commandId,
    resumeCursor.mode,
    resumeCursor.receipt || resumeCursor.lastStatus || "fresh",
  ].join(":");
  const blockedRows = receipt.validationRows.filter((row) => row.status === "blocked");
  const waitingRows = receipt.validationRows.filter((row) => row.status === "waiting");
  const nextAction = blockedRows[0]?.nextAction
    || waitingRows[0]?.nextAction
    || packet.nextAction
    || receipt.controls.nextAction;

  return Object.freeze({
    protocol: "aios.runtime-handoff-digest.mailchimp.v1",
    componentType: "process_boot",
    component: descriptor.subject,
    digestId: `rhd:process-boot:${descriptor.persistedState.key}:${descriptor.payload.commandId}:${digestStatus}`,
    status: digestStatus,
    ready: digestStatus === "ready",
    clientVisibleStatus: receipt.visibleStatus,
    nextAction,
    owner: blockedRows[0]?.owner || waitingRows[0]?.owner || packet.owner || "runtime",
    request: Object.freeze({
      clientRequest: descriptor.payload.clientRequest,
      workflow: descriptor.payload.workflow,
      statusChannel: descriptor.payload.statusChannel,
      commandId: descriptor.payload.commandId,
      stateKey: descriptor.persistedState.key,
    }),
    restart: Object.freeze({
      token: restartToken,
      restartSafeStatus: descriptor.persistedState.restartSafeStatus,
      resumeMode: resumeCursor.mode,
      replayAllowed: descriptor.recovery.plan.replayAllowed,
      duplicateCommandPolicy: exportReport.restartSemantics.duplicateCommandPolicy,
      externalWritesPerformed: false,
    }),
    health: Object.freeze({
      state: health.status,
      failureState: health.failureState,
      terminal: health.terminal,
      retryable: health.retryable,
      retryAfterMs: health.backoff.backoffMs,
      degraded: health.degraded,
    }),
    readiness: Object.freeze({
      packetId: packet.packetId,
      packetStatus: packet.status,
      rollbackStatus: descriptor.rollbackReadinessEvidence.status,
      queueImpact: descriptor.rollbackReadinessEvidence.queueImpact,
      providerOperationId: providerOperation.operationId,
      providerOperationStatus: providerOperation.status,
      exportReportId: exportReport.id,
      exportReady: exportReport.exportReady,
      blockerCodes: Object.freeze([
        ...packet.blockerCodes,
        ...receipt.validationSummary.blockerCodes,
      ]),
      warningCodes: Object.freeze([
        ...packet.warningCodes,
        ...receipt.validationSummary.warningCodes,
      ]),
    }),
    clientControls: Object.freeze({
      canStart: receipt.controls.canStart,
      canReplay: receipt.controls.canReplay,
      canRollback: receipt.controls.canRollback,
      canExport: receipt.controls.canExport,
      accepted: receipt.accepted,
      acceptanceStatus: receipt.acceptance.status,
    }),
    summary: Object.freeze({
      validationRows: receipt.validationSummary.total,
      blockedRows: receipt.validationSummary.blocked,
      waitingRows: receipt.validationSummary.waiting,
      providerMissingCapabilities: providerOperation.counters.missingCapabilities,
      timelineEvents: receipt.timeline.length,
    }),
  });
}

function buildProcessBootOperatorReadinessHandoff(descriptor) {
  const receipt = descriptor.clientWorkflowReceipt;
  const packet = descriptor.rollbackReadinessPacket;
  const digest = descriptor.runtimeHandoffDigest;
  const exportReport = descriptor.exportReport;
  const blockedRows = receipt.validationRows.filter((row) => row.status === "blocked");
  const waitingRows = receipt.validationRows.filter((row) => row.status === "waiting");
  const activeRows = blockedRows.length > 0 ? blockedRows : waitingRows;
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0 || digest.status === "waiting"
      ? "waiting"
      : digest.status === "degraded"
        ? "degraded"
        : "ready";
  const primaryRow = activeRows[0] || receipt.validationRows.find((row) => row.status === "pass") || null;
  const nextStepRows = Object.freeze(receipt.validationRows.map((row) => Object.freeze({
    code: row.code,
    status: row.status,
    owner: row.owner,
    nextAction: row.nextAction,
    clientVisible: true,
    detail: row.detail,
  })));

  return Object.freeze({
    protocol: "aios.operator-readiness-handoff.mailchimp.v1",
    componentType: "process_boot",
    component: descriptor.subject,
    handoffId: `orh:process-boot:${descriptor.persistedState.key}:${descriptor.payload.commandId}:${status}`,
    status,
    ready: status === "ready" || status === "degraded",
    owner: primaryRow?.owner || digest.owner || "runtime",
    nextAction: primaryRow?.nextAction || digest.nextAction,
    visibleStatus: receipt.visibleStatus,
    title: `Process boot readiness for ${descriptor.subject}`,
    summary: status === "blocked"
      ? `Process boot is blocked by ${blockedRows[0]?.code || "runtime health"}.`
      : status === "waiting"
        ? `Process boot is waiting on ${waitingRows[0]?.code || digest.nextAction}.`
        : status === "degraded"
          ? "Process boot can continue with degraded runtime evidence."
          : "Process boot is ready for rollback workflow aggregation.",
    request: Object.freeze({
      clientRequest: descriptor.payload.clientRequest,
      workflow: descriptor.payload.workflow,
      commandId: descriptor.payload.commandId,
      stateKey: descriptor.persistedState.key,
      statusChannel: descriptor.payload.statusChannel,
    }),
    readiness: Object.freeze({
      packetId: packet.packetId,
      packetStatus: packet.status,
      queueImpact: packet.queueImpact,
      exportReportId: exportReport.id,
      exportReady: exportReport.exportReady,
      providerOperationId: descriptor.providerOperationManifest.operationId,
      blockerCodes: Object.freeze([...new Set([
        ...packet.blockerCodes,
        ...receipt.validationSummary.blockerCodes,
      ])].sort()),
      warningCodes: Object.freeze([...new Set([
        ...packet.warningCodes,
        ...receipt.validationSummary.warningCodes,
      ])].sort()),
    }),
    restart: Object.freeze({
      token: digest.restart.token,
      resumeMode: digest.restart.resumeMode,
      replayAllowed: receipt.resume.replayAllowed,
      duplicateCommandPolicy: digest.restart.duplicateCommandPolicy,
      externalWritesPerformed: false,
    }),
    controls: Object.freeze({
      canStart: receipt.controls.canStart,
      canReplay: receipt.controls.canReplay,
      canRollback: receipt.controls.canRollback,
      canExport: receipt.controls.canExport,
      accepted: receipt.accepted,
      acceptanceStatus: receipt.acceptance.status,
    }),
    validationSummary: Object.freeze({
      total: nextStepRows.length,
      passed: nextStepRows.filter((row) => row.status === "pass").length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      primaryCode: primaryRow?.code || "",
    }),
    nextSteps: nextStepRows,
  });
}

export function parseProcessBootBinding(source) {
  const fields = parseAssignments(tokenizeRuntimeSource(source), PROCESS_BOOT_GRAMMAR.command);
  assertRequired(fields);
  return Object.freeze({
    type: "ProcessBootBinding",
    command: PROCESS_BOOT_GRAMMAR.command,
    process: fields.process,
    image: fields.image,
    args: fields.args ? fields.args.split(/\s+/).filter(Boolean) : [],
    env: fields.env ? fields.env.split(",").filter(Boolean).sort() : [],
    cwd: fields.cwd ?? "/workspace",
    restart: fields.restart ?? "never",
    memoryMiB: normalizeMiB(fields.memory, 128),
    approval: fields.approval ?? "system",
    clientRequest: normalizeIdentifier(fields.clientRequest, "clientRequest", undefined),
    workflow: normalizeIdentifier(fields.workflow, "workflow", "mailchimp-runtime"),
    resume: normalizeResumeMode(fields.resume),
    statusChannel: normalizeIdentifier(fields.statusChannel, "statusChannel", fields.process),
    stateKey: normalizeBootStateKey(fields.stateKey, {
      process: fields.process,
      workflow: normalizeIdentifier(fields.workflow, "workflow", "mailchimp-runtime"),
    }),
    attempt: normalizeAttempt(fields.attempt),
    lastStatus: normalizeBootStatus(fields.lastStatus),
    receipt: normalizeIdentifier(fields.receipt, "receipt", undefined),
  });
}

export function compileProcessBootBinding(source, options = {}) {
  const ast = typeof source === "string" ? parseProcessBootBinding(source) : source;
  const jobId = options.jobId ?? `boot:${ast.process}`;
  const clientRequest = options.clientRequest ?? ast.clientRequest ?? jobId;
  const workflow = options.workflow ?? ast.workflow;
  const commandId = options.commandId ?? deriveBootCommandId(ast, clientRequest);
  const stateKey = options.stateKey ?? ast.stateKey;
  const resumeCursor = deriveBootResumeCursor(ast, stateKey);
  const recoveryPlan = deriveBootRecoveryPlan(ast, commandId, stateKey);
  const operationalHealth = buildBootOperationalHealth(ast, commandId, stateKey, recoveryPlan);
  const expectedTransitions = Object.freeze({
    queued: Object.freeze(["allocating-memory", "failed"]),
    "allocating-memory": Object.freeze(["spawning", "failed", "rolled-back"]),
    spawning: Object.freeze(["ready", "failed", "rolled-back"]),
    ready: Object.freeze([]),
    failed: ast.restart === "on-failure" ? Object.freeze(["queued", "rolled-back"]) : Object.freeze(["rolled-back"]),
    "rolled-back": Object.freeze([]),
  });
  const exportReport = buildBootExportReport(ast, {
    jobId,
    clientRequest,
    workflow,
    commandId,
    stateKey,
    resumeCursor,
    recoveryPlan,
    operationalHealth,
    expectedTransitions,
  });
  const descriptorDraft = {
    kind: "kernel.job.descriptor",
    apiVersion: "aios.runtime/v1",
    id: jobId,
    action: "process.boot",
    subject: ast.process,
    payload: Object.freeze({
      image: ast.image,
      argv: ast.args,
      cwd: ast.cwd,
      env: ast.env,
      restartPolicy: ast.restart,
      clientRequest,
      workflow,
      resume: ast.resume,
      statusChannel: ast.statusChannel,
      stateKey,
      attempt: ast.attempt,
      commandId,
    }),
    capabilities: PROCESS_BOOT_STDLIB.capabilities,
    memory: Object.freeze({ reservationMiB: ast.memoryMiB, scope: `process:${ast.process}` }),
    clientRuntime: Object.freeze({
      requestId: clientRequest,
      workflow,
      handoff: "mailchimp-process-boot",
      statusChannel: ast.statusChannel,
      resumeFrom: ast.resume === "fresh" ? "none" : ast.resume,
      visibleStates: Object.freeze(["queued", "allocating-memory", "spawning", "ready", "failed", "rolled-back"]),
      restartSafeStatus: recoveryPlan.restartSafeStatus,
      operationalHealth,
    }),
    persistedState: Object.freeze({
      key: stateKey,
      commandId,
      clientRequest,
      workflow,
      process: ast.process,
      image: ast.image,
      attempt: ast.attempt,
      resumeCursor,
      restartSafeStatus: recoveryPlan.restartSafeStatus,
      expectedTransitions,
      exportReport: Object.freeze({
        reportId: exportReport.id,
        status: exportReport.status,
        exportReady: exportReport.exportReady,
        nextAction: exportReport.nextAction,
        historySnapshotIds: exportReport.exportSummary.historySnapshotIds,
      }),
    }),
    verifier: Object.freeze({
      claims: PROCESS_BOOT_STDLIB.verifierClaims,
      requiresApproval: ast.approval !== "system",
      truthBoundary: "runtime-adapter-observed-after-spawn",
    }),
    recovery: Object.freeze({
      statusEvents: ["queued", "allocating-memory", "spawning", "ready", "failed", "rolled-back"],
      retry: ast.restart === "on-failure" ? "idempotent-replay-with-same-image-digest" : "none",
      rollback: recoveryPlan.rollbackOnFailure,
      plan: recoveryPlan,
    }),
    operationalHealth,
    exportReport,
  };
  const rollbackReadinessEvidence = buildBootRollbackReadinessEvidence(descriptorDraft, exportReport);
  const providerOperationManifest = buildProcessBootProviderOperationManifest(
    { ...descriptorDraft, rollbackReadinessEvidence },
    exportReport,
    options,
  );
  const rollbackReadinessPacket = buildProcessBootRollbackReadinessPacket({
    ...descriptorDraft,
    rollbackReadinessEvidence,
    providerOperationManifest,
  });
  const clientWorkflowReceipt = buildProcessBootClientWorkflowReceipt({
    ...descriptorDraft,
    rollbackReadinessEvidence,
    providerOperationManifest,
    rollbackReadinessPacket,
  });
  const runtimeHandoffDigest = buildProcessBootRuntimeHandoffDigest({
    ...descriptorDraft,
    rollbackReadinessEvidence,
    providerOperationManifest,
    rollbackReadinessPacket,
    clientWorkflowReceipt,
  });
  const operatorReadinessHandoff = buildProcessBootOperatorReadinessHandoff({
    ...descriptorDraft,
    rollbackReadinessEvidence,
    providerOperationManifest,
    rollbackReadinessPacket,
    clientWorkflowReceipt,
    runtimeHandoffDigest,
  });
  return Object.freeze({
    ...descriptorDraft,
    payload: Object.freeze({
      ...descriptorDraft.payload,
      rollbackReadinessStatus: rollbackReadinessEvidence.status,
      rollbackReadinessNextAction: rollbackReadinessEvidence.nextAction,
      providerOperationId: providerOperationManifest.operationId,
      providerOperationStatus: providerOperationManifest.status,
      providerOperationNextAction: providerOperationManifest.nextAction,
      rollbackReadinessPacketId: rollbackReadinessPacket.packetId,
      rollbackReadinessPacketStatus: rollbackReadinessPacket.status,
      rollbackReadinessPacketNextAction: rollbackReadinessPacket.nextAction,
      clientWorkflowReceiptId: clientWorkflowReceipt.receiptId,
      clientWorkflowVisibleStatus: clientWorkflowReceipt.visibleStatus,
      clientWorkflowNextAction: clientWorkflowReceipt.controls.nextAction,
      runtimeHandoffDigestId: runtimeHandoffDigest.digestId,
      runtimeHandoffDigestStatus: runtimeHandoffDigest.status,
      runtimeHandoffDigestNextAction: runtimeHandoffDigest.nextAction,
      operatorReadinessHandoffId: operatorReadinessHandoff.handoffId,
      operatorReadinessStatus: operatorReadinessHandoff.status,
      operatorReadinessNextAction: operatorReadinessHandoff.nextAction,
    }),
    clientRuntime: Object.freeze({
      ...descriptorDraft.clientRuntime,
      visibleStatus: clientWorkflowReceipt.visibleStatus,
      nextAction: clientWorkflowReceipt.controls.nextAction,
      workflowReceiptId: clientWorkflowReceipt.receiptId,
      validationSummary: clientWorkflowReceipt.validationSummary,
      handoffDigest: Object.freeze({
        digestId: runtimeHandoffDigest.digestId,
        status: runtimeHandoffDigest.status,
        nextAction: runtimeHandoffDigest.nextAction,
        restartToken: runtimeHandoffDigest.restart.token,
      }),
    }),
    persistedState: Object.freeze({
      ...descriptorDraft.persistedState,
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
      clientWorkflowReceipt: Object.freeze({
        protocol: clientWorkflowReceipt.protocol,
        receiptId: clientWorkflowReceipt.receiptId,
        status: clientWorkflowReceipt.status,
        visibleStatus: clientWorkflowReceipt.visibleStatus,
        accepted: clientWorkflowReceipt.accepted,
        nextAction: clientWorkflowReceipt.controls.nextAction,
        validationSummary: clientWorkflowReceipt.validationSummary,
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
    providerOperationManifest,
    rollbackReadinessPacket,
    clientWorkflowReceipt,
    runtimeHandoffDigest,
    operatorReadinessHandoff,
  });
}

export function createProcessBootRuntimeHandoff(source, options = {}) {
  const descriptor = compileProcessBootBinding(source, options);
  return Object.freeze({
    adapter: "kernel.process.runtime",
    descriptor,
    localOnly: true,
    externalWrites: false,
    clientRuntime: descriptor.clientRuntime,
    persistedState: descriptor.persistedState,
    restartSafeStatus: descriptor.persistedState.restartSafeStatus,
    operationalHealth: descriptor.operationalHealth,
    exportReport: descriptor.exportReport,
    rollbackReadinessEvidence: descriptor.rollbackReadinessEvidence,
    providerOperationManifest: descriptor.providerOperationManifest,
    rollbackReadinessPacket: descriptor.rollbackReadinessPacket,
    clientWorkflowReceipt: descriptor.clientWorkflowReceipt,
    runtimeHandoffDigest: descriptor.runtimeHandoffDigest,
    operatorReadinessHandoff: descriptor.operatorReadinessHandoff,
    expectedReceipt: Object.freeze(["pid", "startedAt", "imageDigest", "status"]),
  });
}

export function shapeProcessBootRecoveryState(source, options = {}) {
  const descriptor = compileProcessBootBinding(source, options);
  return Object.freeze({
    key: descriptor.persistedState.key,
    commandId: descriptor.persistedState.commandId,
    restartSafeStatus: descriptor.persistedState.restartSafeStatus,
    replayAllowed: descriptor.recovery.plan.replayAllowed,
    nextCommand: descriptor.recovery.plan.nextCommand,
    receiptRequired: descriptor.persistedState.resumeCursor.mode === "receipt",
    statusChannel: descriptor.payload.statusChannel,
    transitions: descriptor.persistedState.expectedTransitions,
    truthBoundary: descriptor.verifier.truthBoundary,
    operationalHealth: descriptor.operationalHealth,
    exportReport: descriptor.exportReport,
    rollbackReadinessEvidence: descriptor.rollbackReadinessEvidence,
    providerOperationManifest: descriptor.providerOperationManifest,
    rollbackReadinessPacket: descriptor.rollbackReadinessPacket,
    clientWorkflowReceipt: descriptor.clientWorkflowReceipt,
    runtimeHandoffDigest: descriptor.runtimeHandoffDigest,
    operatorReadinessHandoff: descriptor.operatorReadinessHandoff,
  });
}

export function createProcessBootHealthReport(source, options = {}) {
  const descriptor = compileProcessBootBinding(source, options);
  return Object.freeze({
    kind: "aios.runtime.process_boot_health",
    process: descriptor.subject,
    image: descriptor.payload.image,
    commandId: descriptor.payload.commandId,
    stateKey: descriptor.payload.stateKey,
    statusChannel: descriptor.payload.statusChannel,
    state: descriptor.operationalHealth.status,
    restartSafeStatus: descriptor.operationalHealth.restartSafeStatus,
    degraded: descriptor.operationalHealth.degraded,
    terminal: descriptor.operationalHealth.terminal,
    retryable: descriptor.operationalHealth.retryable,
    retryAfterMs: descriptor.operationalHealth.backoff.backoffMs,
    nextRetryAttempt: descriptor.payload.attempt + (descriptor.operationalHealth.retryable ? 1 : 0),
    failureState: descriptor.operationalHealth.failureState,
    actionableError: descriptor.operationalHealth.actionableError,
    nextAction: descriptor.operationalHealth.nextAction,
    truthBoundary: descriptor.verifier.truthBoundary,
    exportReportId: descriptor.exportReport.id,
    exportReady: descriptor.exportReport.exportReady,
    exportStatus: descriptor.exportReport.status,
    exportCounters: descriptor.exportReport.counters,
    exportHistorySnapshotIds: descriptor.exportReport.exportSummary.historySnapshotIds,
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
    clientWorkflowReceiptId: descriptor.clientWorkflowReceipt.receiptId,
    clientWorkflowVisibleStatus: descriptor.clientWorkflowReceipt.visibleStatus,
    clientWorkflowNextAction: descriptor.clientWorkflowReceipt.controls.nextAction,
    clientWorkflowValidationSummary: descriptor.clientWorkflowReceipt.validationSummary,
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

export function createProcessBootExportSummary(source, options = {}) {
  const descriptor = compileProcessBootBinding(source, options);
  return Object.freeze({
    kind: "aios.runtime.process_boot_export_summary",
    reportId: descriptor.exportReport.id,
    process: descriptor.subject,
    image: descriptor.payload.image,
    commandId: descriptor.payload.commandId,
    stateKey: descriptor.payload.stateKey,
    status: descriptor.exportReport.status,
    exportReady: descriptor.exportReport.exportReady,
    nextAction: descriptor.exportReport.nextAction,
    counters: descriptor.exportReport.counters,
    restartSemantics: descriptor.exportReport.restartSemantics,
    blockerCodes: descriptor.exportReport.exportSummary.blockerCodes,
    warningCodes: descriptor.exportReport.exportSummary.warningCodes,
    historySnapshotIds: descriptor.exportReport.exportSummary.historySnapshotIds,
    timeline: descriptor.exportReport.timeline,
    providerOperationManifest: descriptor.providerOperationManifest,
    rollbackReadinessEvidence: descriptor.rollbackReadinessEvidence,
    rollbackReadinessPacket: descriptor.rollbackReadinessPacket,
    clientWorkflowReceipt: descriptor.clientWorkflowReceipt,
    runtimeHandoffDigest: descriptor.runtimeHandoffDigest,
    operatorReadinessHandoff: descriptor.operatorReadinessHandoff,
  });
}

export {
  PROCESS_BOOT_EXAMPLE,
  PROCESS_BOOT_GRAMMAR,
  PROCESS_BOOT_STDLIB,
  buildBootRollbackReadinessEvidence,
  buildProcessBootClientWorkflowReceipt,
  buildProcessBootProviderOperationManifest,
  buildProcessBootRollbackReadinessPacket,
  buildProcessBootRuntimeHandoffDigest,
  buildProcessBootOperatorReadinessHandoff,
};
