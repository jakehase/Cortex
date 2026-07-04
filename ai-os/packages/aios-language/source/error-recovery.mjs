const RECOVERY_ACTIONS = Object.freeze({
  AIOS_LITERAL_STRING_UNTERMINATED: "close_string",
  AIOS_LITERAL_ARRAY_UNTERMINATED: "close_array",
  AIOS_LITERAL_OBJECT_UNTERMINATED: "close_object",
  AIOS_COMMENT_UNTERMINATED: "close_block_comment",
  PARSE_EXPECTED_SEMICOLON: "insert_semicolon",
  PARSE_EXPECTED_JOB_END: "close_job_block",
  PARSE_EXPECTED_JOB_BODY: "open_job_block",
  PARSE_UNKNOWN_JOB_CLAUSE: "remove_or_rename_clause",
  BOUNDARY_WORKSPACE_PATH_ESCAPE: "repair_boundary_scope",
  BOUNDARY_TENANT_REQUIRED: "bind_tenant_boundary",
  BOUNDARY_ROLE_REQUIRED: "bind_role_boundary",
  BOUNDARY_PERMISSION_DENIED: "repair_role_permission_boundary",
  BOUNDARY_TENANT_AMBIGUOUS: "select_tenant_boundary",
  AIOS_SYNC_BRIDGE_DRIFT: "reconcile_mailchimp_sync_bridge",
  AIOS_SYNC_BRIDGE_EXTERNAL_HOLD: "confirm_mailchimp_external_sync",
  AIOS_MAILCHIMP_INCIDENT_ACTIVE: "triage_mailchimp_operational_incident",
  AIOS_MAILCHIMP_INCIDENT_RETRY_PENDING: "schedule_mailchimp_incident_retry",
  AIOS_MAILCHIMP_INCIDENT_ESCALATED: "escalate_mailchimp_operational_incident",
});

function compact(value) {
  return String(value ?? "").trim();
}

function stableDiagnostic(diagnostic = {}, index = 0) {
  const code = compact(diagnostic.code || "AIOS_UNKNOWN");
  const severity = compact(diagnostic.severity || "error");
  return Object.freeze({
    index,
    code,
    severity,
    message: compact(diagnostic.message || diagnostic.reason),
    line: Number.isInteger(diagnostic.line) ? diagnostic.line : diagnostic.range?.start?.line ?? 1,
    column: Number.isInteger(diagnostic.column) ? diagnostic.column : diagnostic.range?.start?.column ?? 1,
    offset: Number.isInteger(diagnostic.offset) ? diagnostic.offset : diagnostic.range?.start?.offset ?? 0,
    recovery: compact(diagnostic.recovery || RECOVERY_ACTIONS[code] || ""),
  });
}

function actionFor(diagnostic) {
  if (diagnostic.recovery) return diagnostic.recovery;
  if (RECOVERY_ACTIONS[diagnostic.code]) return RECOVERY_ACTIONS[diagnostic.code];
  if (diagnostic.code.startsWith("AIOS_LITERAL_")) return "repair_literal";
  if (diagnostic.code.startsWith("AIOS_COMMENT_")) return "repair_comment_contract";
  if (diagnostic.code.startsWith("PARSE_")) return "repair_parse_contract";
  if (diagnostic.code.startsWith("BOUNDARY_")) return "repair_boundary_scope";
  if (diagnostic.code.startsWith("AIOS_SYNC_BRIDGE_")) return "reconcile_mailchimp_sync_bridge";
  if (diagnostic.severity === "warning") return "review_warning";
  return "hold_for_operator";
}

function recoveryPhase(action) {
  if (action.includes("literal") || action.startsWith("close_") || action.startsWith("insert_")) return "source";
  if (action.includes("comment")) return "source-comment";
  if (action.includes("sync_bridge") || action.includes("external_sync")) return "provider-sync";
  if (action.includes("boundary")) return "boundary";
  if (action.includes("parse") || action.includes("clause") || action.includes("job")) return "parser";
  return "operator";
}

function buildPatchPreview(item) {
  const edits = {
    close_string: "\"",
    close_array: "]",
    close_object: "}",
    close_block_comment: "*/",
    insert_semicolon: ";",
    close_job_block: "}",
    open_job_block: "{",
  };
  return Object.freeze({
    available: Object.hasOwn(edits, item.action),
    insertion: edits[item.action] ?? "",
    at: Object.freeze({ line: item.line, column: item.column, offset: item.offset }),
    localOnly: true,
    writesExternalSystem: false,
  });
}

function normalizeCapabilityList(value) {
  return Object.freeze(Array.from(value ?? [])
    .map((item) => compact(item))
    .filter(Boolean)
    .sort());
}

function buildRecoveryProviderContract(context = {}, recovery = null) {
  const requestedCapabilities = normalizeCapabilityList(context.requestedCapabilities ?? ["status.read", "recovery.preview"]);
  const providedCapabilities = normalizeCapabilityList(context.providedCapabilities ?? ["status.read", "recovery.preview", "recovery.patch.local"]);
  const providedSet = new Set(providedCapabilities);
  const missingCapabilities = requestedCapabilities.filter((capability) => !providedSet.has(capability));
  const adapter = compact(context.adapter || "local");
  const service = compact(context.service || context.provider || "aios-language");
  const externalWriteRequested = context.externalWriteRequested === true || context.allowExternalWrite === true;
  const externalWriteAllowed = context.allowExternalWrite === true && missingCapabilities.length === 0 && providedSet.has("recovery.write.external");
  const syncMode = compact(context.syncMode || (externalWriteAllowed ? "provider" : "local"));
  const recoverable = recovery ? recovery.recoverable : true;

  return Object.freeze({
    schema: "aios.recovery.provider-contract.v1",
    provider: Object.freeze({
      service,
      adapter,
      statusChannel: compact(context.statusChannel || "aios.source.recovery"),
      syncMode,
    }),
    capabilities: Object.freeze({
      requested: requestedCapabilities,
      provided: providedCapabilities,
      missing: Object.freeze(missingCapabilities),
      negotiated: missingCapabilities.length === 0,
    }),
    sync: Object.freeze({
      localOnly: !externalWriteAllowed,
      externalWriteRequested,
      externalWriteAllowed,
      statusHandoffReady: recoverable && missingCapabilities.length === 0,
      checkpoint: compact(context.checkpoint || `recovery:${adapter}:${syncMode}`),
    }),
    nextAction: missingCapabilities.length > 0
      ? "negotiate_recovery_capabilities"
      : externalWriteRequested && !externalWriteAllowed
        ? "downgrade_to_local_recovery"
        : recoverable ? "handoff_recovery_status" : "hold_for_operator",
  });
}

function stableCommandPart(value) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "none";
}

function stableCommandId(...parts) {
  return parts.map(stableCommandPart).join(":");
}

function buildRecoveryCommand(item, providerContract, index) {
  const checkpoint = providerContract.sync.checkpoint;
  const statusChannel = providerContract.provider.statusChannel;
  const patchAvailable = item.patchPreview?.available === true;
  const localOnly = item.patchPreview?.localOnly !== false;
  const writesExternalSystem = providerContract.sync.externalWriteAllowed === true && localOnly === false;
  const restartSafe = item.action !== "hold_for_operator"
    && Boolean(checkpoint)
    && (patchAvailable || item.severity === "warning" || item.phase === "operator");

  return Object.freeze({
    schema: "aios.recovery.command.v1",
    id: stableCommandId("recovery", checkpoint, index + 1, item.phase, item.action, item.code),
    type: patchAvailable ? "source.patch.preview" : item.severity === "warning" ? "diagnostic.review" : "operator.recovery",
    action: item.action,
    phase: item.phase,
    code: item.code,
    severity: item.severity,
    checkpoint,
    statusChannel,
    idempotencyKey: stableCommandId("idempotent", checkpoint, item.offset, item.action, item.code),
    idempotent: true,
    restartSafe,
    localOnly,
    writesExternalSystem,
    patchPreview: item.patchPreview,
    statusPatch: Object.freeze({
      state: item.severity === "warning" ? "review" : patchAvailable ? "recovering" : "blocked",
      nextAction: item.action,
      message: item.message,
    }),
  });
}

function buildStatusHandoffCommand(recovery, providerContract) {
  const checkpoint = providerContract.sync.checkpoint;
  const statusChannel = providerContract.provider.statusChannel;
  return Object.freeze({
    schema: "aios.recovery.command.v1",
    id: stableCommandId("recovery-status", checkpoint, recovery.summary.nextAction),
    type: "status.handoff",
    action: providerContract.nextAction,
    phase: "status",
    code: "AIOS_RECOVERY_STATUS_HANDOFF",
    severity: recovery.ok ? "info" : "warning",
    checkpoint,
    statusChannel,
    idempotencyKey: stableCommandId("idempotent", "status", checkpoint, statusChannel),
    idempotent: true,
    restartSafe: providerContract.sync.statusHandoffReady === true,
    localOnly: providerContract.sync.localOnly,
    writesExternalSystem: providerContract.sync.externalWriteAllowed,
    patchPreview: Object.freeze({
      available: false,
      insertion: "",
      at: Object.freeze({ line: 1, column: 1, offset: 0 }),
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed,
    }),
    statusPatch: Object.freeze({
      state: recovery.ok ? "ready" : recovery.recoverable ? "recovering" : "blocked",
      nextAction: recovery.summary.nextAction,
      message: `${recovery.summary.diagnostics} diagnostics prepared for recovery status handoff.`,
    }),
  });
}

function normalizeRecoverySettingValue(value) {
  if (value === true || value === false) return value;
  const text = compact(value).toLowerCase();
  if (["true", "yes", "on", "1", "enabled"].includes(text)) return true;
  if (["false", "no", "off", "0", "disabled"].includes(text)) return false;
  if (/^\d+$/.test(text)) return Number(text);
  return compact(value);
}

function normalizeRecoverySettings(settings = {}) {
  const entries = Object.entries(settings && typeof settings === "object" ? settings : {})
    .map(([key, value]) => [compact(key), normalizeRecoverySettingValue(value)])
    .filter(([key]) => Boolean(key))
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.freeze(Object.fromEntries(entries));
}

function validateRecoveryLifecycleSettings(settings, diagnostics) {
  const output = [];
  const retryLimit = settings.retryLimit ?? settings.maxRetries ?? 3;
  const backoffSeconds = settings.backoffSeconds ?? settings.retryBackoffSeconds ?? 30;
  const degradedMode = settings.degradedMode ?? true;
  const pauseExternalWrites = settings.pauseExternalWrites ?? true;

  if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 25) {
    output.push(Object.freeze({
      level: "error",
      code: "recovery.lifecycle.retry-limit.invalid",
      message: "Recovery lifecycle retryLimit must be an integer between 0 and 25.",
      recovery: "repair_recovery_lifecycle_settings",
    }));
  }
  if (!Number.isInteger(backoffSeconds) || backoffSeconds < 0 || backoffSeconds > 3600) {
    output.push(Object.freeze({
      level: "error",
      code: "recovery.lifecycle.backoff.invalid",
      message: "Recovery lifecycle backoffSeconds must be an integer between 0 and 3600.",
      recovery: "repair_recovery_lifecycle_settings",
    }));
  }
  if (typeof degradedMode !== "boolean") {
    output.push(Object.freeze({
      level: "warning",
      code: "recovery.lifecycle.degraded-mode.invalid",
      message: "Recovery lifecycle degradedMode should be a boolean.",
      recovery: "normalize_recovery_degraded_mode",
    }));
  }
  if (typeof pauseExternalWrites !== "boolean") {
    output.push(Object.freeze({
      level: "warning",
      code: "recovery.lifecycle.pause-external-writes.invalid",
      message: "Recovery lifecycle pauseExternalWrites should be a boolean.",
      recovery: "normalize_recovery_external_write_control",
    }));
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error") && retryLimit === 0) {
    output.push(Object.freeze({
      level: "warning",
      code: "recovery.lifecycle.retry-disabled-with-errors",
      message: "Recovery lifecycle has errors but retryLimit is disabled.",
      recovery: "enable_recovery_retry_or_escalate",
    }));
  }
  return Object.freeze(output);
}

function lifecycleCommand(idParts, command, enabled, reason, extras = {}) {
  return Object.freeze({
    schema: "aios.recovery.lifecycle-command.v1",
    id: stableCommandId("recovery-lifecycle", ...idParts),
    command,
    enabled,
    restartSafe: extras.restartSafe !== false,
    localOnly: extras.localOnly !== false,
    writesExternalSystem: extras.writesExternalSystem === true,
    checkpoint: extras.checkpoint ?? "",
    statusChannel: extras.statusChannel ?? "",
    idempotencyKey: stableCommandId("idempotent", "recovery-lifecycle", ...idParts),
    reason,
    nextAction: extras.nextAction ?? command,
  });
}

function normalizeIncidentSnapshotRows(context = {}) {
  const snapshots = [
    context.incidentSnapshot,
    context.literalIncidentSnapshot,
    context.commentIncidentAnalytics,
    ...(Array.isArray(context.incidentSnapshots) ? context.incidentSnapshots : []),
  ].filter((item) => item && typeof item === "object");
  const rows = [];
  for (const snapshot of snapshots) {
    for (const row of snapshot.rows ?? []) {
      rows.push(Object.freeze({
        schema: "aios.recovery.incident-snapshot-row.v1",
        source: compact(row.source || snapshot.schema || "incident"),
        subject: compact(row.subject || row.code || row.state),
        state: compact(row.state || snapshot.state || "unknown"),
        severity: compact(row.severity || (row.state === "blocked" || row.state === "failed" ? "major" : "minor")),
        checkpoint: compact(row.checkpoint || snapshot.handoff?.checkpoint),
        statusChannel: compact(row.statusChannel || snapshot.handoff?.statusChannel),
        restartSafe: row.restartSafe === true,
        localOnly: row.localOnly !== false,
        writesExternalSystem: row.writesExternalSystem === true,
        nextAction: compact(row.nextAction || snapshot.handoff?.nextAction || "inspect_mailchimp_incident_snapshot"),
      }));
    }
  }
  return Object.freeze(rows.sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
}

function buildRecoveryIncidentLifecycle(incidentRows, recovery, providerContract, persistence, context = {}) {
  const failedRows = incidentRows.filter((row) => row.state === "failed" || row.state === "blocked" || row.severity === "critical");
  const reviewRows = incidentRows.filter((row) => row.state === "review" || row.state === "degraded" || row.severity === "minor");
  const unsafeRows = incidentRows.filter((row) => row.restartSafe === false);
  const retryLimit = Number.isInteger(context.incidentRetryLimit) ? context.incidentRetryLimit : 2;
  const backoffSeconds = Number.isInteger(context.incidentBackoffSeconds)
    ? context.incidentBackoffSeconds
    : Math.max(15, Math.min(600, 15 * Math.max(1, failedRows.length + reviewRows.length + recovery.summary.errors)));
  const retryable = failedRows.length === 0
    && unsafeRows.length === 0
    && recovery.recoverable === true
    && persistence.resume?.available === true
    && retryLimit > 0;
  const commands = Object.freeze([
    lifecycleCommand(
      [persistence.checkpoint, "incident-publish"],
      "publish_mailchimp_incident_status",
      incidentRows.length > 0 && failedRows.length === 0,
      incidentRows.length > 0
        ? "Mailchimp incident snapshot can be published to the recovery status channel."
        : "No Mailchimp incident snapshot rows were provided.",
      {
        checkpoint: persistence.checkpoint,
        statusChannel: providerContract.provider.statusChannel,
        nextAction: failedRows.length > 0 ? failedRows[0].nextAction : "publish_mailchimp_incident_status",
      },
    ),
    lifecycleCommand(
      [persistence.checkpoint, "incident-retry"],
      "schedule_mailchimp_incident_retry",
      retryable && reviewRows.length > 0,
      retryable
        ? `Mailchimp incident retry is restart-safe after ${backoffSeconds} seconds.`
        : "Mailchimp incident retry is held until blockers and restart safety are repaired.",
      {
        checkpoint: persistence.checkpoint,
        statusChannel: providerContract.provider.statusChannel,
        nextAction: retryable ? "schedule_mailchimp_incident_retry" : failedRows[0]?.nextAction ?? "hold_mailchimp_incident_retry",
      },
    ),
    lifecycleCommand(
      [persistence.checkpoint, "incident-escalate"],
      "escalate_mailchimp_operational_incident",
      failedRows.length > 0 || unsafeRows.length > 0,
      "Mailchimp incident escalation is required when failed or unsafe incident rows remain.",
      {
        checkpoint: persistence.checkpoint,
        statusChannel: providerContract.provider.statusChannel,
        restartSafe: false,
        nextAction: failedRows[0]?.nextAction ?? unsafeRows[0]?.nextAction ?? "escalate_mailchimp_operational_incident",
      },
    ),
  ]);
  const enabledCommands = commands.filter((command) => command.enabled);
  const state = failedRows.length > 0
    ? "failed"
    : unsafeRows.length > 0
      ? "held"
      : reviewRows.length > 0 ? "review" : incidentRows.length > 0 ? "ready" : "empty";

  return Object.freeze({
    schema: "aios.recovery.incident-lifecycle.v1",
    state,
    rows: incidentRows,
    commands,
    counters: Object.freeze({
      rows: incidentRows.length,
      failed: failedRows.length,
      review: reviewRows.length,
      unsafe: unsafeRows.length,
      commands: commands.length,
      enabledCommands: enabledCommands.length,
    }),
    retry: Object.freeze({
      available: retryable,
      attemptsRemaining: retryable ? retryLimit : 0,
      backoffSeconds: retryable ? backoffSeconds : 0,
      resumeToken: persistence.ledger.resumeToken,
    }),
    handoff: Object.freeze({
      ready: failedRows.length === 0 && unsafeRows.length === 0,
      checkpoint: persistence.checkpoint,
      statusChannel: providerContract.provider.statusChannel,
      localOnly: true,
      writesExternalSystem: false,
      nextAction: enabledCommands[0]?.nextAction
        ?? (incidentRows.length > 0 ? "publish_mailchimp_incident_status" : "retain_empty_mailchimp_incident_lifecycle"),
    }),
  });
}

function buildRecoveryLifecyclePlan(recovery, providerContract, persistence, context = {}) {
  const settings = normalizeRecoverySettings(context.lifecycleSettings ?? context.recoverySettings ?? {});
  const validation = validateRecoveryLifecycleSettings(settings, recovery.items);
  const retryLimit = Number.isInteger(settings.retryLimit) ? settings.retryLimit
    : Number.isInteger(settings.maxRetries) ? settings.maxRetries : 3;
  const backoffSeconds = Number.isInteger(settings.backoffSeconds) ? settings.backoffSeconds
    : Number.isInteger(settings.retryBackoffSeconds) ? settings.retryBackoffSeconds : 30;
  const degradedMode = typeof settings.degradedMode === "boolean" ? settings.degradedMode : true;
  const pauseExternalWrites = typeof settings.pauseExternalWrites === "boolean" ? settings.pauseExternalWrites : true;
  const incidentContext = context.incidentReport ?? context.operationalIncident ?? {};
  const incidentState = compact(incidentContext.state || incidentContext.status || "");
  const failureCount = Number.isInteger(incidentContext.failureCount) ? incidentContext.failureCount : 0;
  const retryable = recovery.recoverable
    && persistence.resume?.available === true
    && retryLimit > 0
    && validation.every((item) => item.level !== "error");
  const shouldDisableExternal = pauseExternalWrites
    && (providerContract.sync.externalWriteRequested || providerContract.sync.externalWriteAllowed)
    && (recovery.summary.errors > 0 || failureCount > 0 || incidentState === "failed");
  const degradedAllowed = degradedMode
    && recovery.summary.errors === 0
    && (recovery.summary.warnings > 0 || incidentState === "degraded" || incidentState === "review");
  const commands = Object.freeze([
    lifecycleCommand(
      [persistence.checkpoint, "pause-external"],
      "pause_mailchimp_external_writes",
      shouldDisableExternal,
      shouldDisableExternal
        ? "External Mailchimp writes are paused while recovery or incident blockers are active."
        : "External writes do not need lifecycle pausing.",
      {
        checkpoint: persistence.checkpoint,
        statusChannel: providerContract.provider.statusChannel,
        nextAction: shouldDisableExternal ? "pause_mailchimp_external_writes" : "retain_mailchimp_external_write_state",
      },
    ),
    lifecycleCommand(
      [persistence.checkpoint, "retry"],
      "schedule_recovery_retry",
      retryable && recovery.summary.diagnostics > 0,
      retryable
        ? `Recovery retry can resume from ${persistence.ledger.resumeToken}.`
        : "Recovery retry is held until settings, checkpoint, or command safety is repaired.",
      {
        checkpoint: persistence.checkpoint,
        statusChannel: providerContract.provider.statusChannel,
        nextAction: retryable ? "schedule_recovery_retry" : persistence.resume?.nextAction ?? providerContract.nextAction,
      },
    ),
    lifecycleCommand(
      [persistence.checkpoint, "degraded"],
      "enable_degraded_recovery_mode",
      degradedAllowed,
      degradedAllowed
        ? "Warnings can run in degraded mode while status handoff remains restart-safe."
        : "Degraded mode is not active for this recovery state.",
      {
        checkpoint: persistence.checkpoint,
        statusChannel: providerContract.provider.statusChannel,
        nextAction: degradedAllowed ? "enable_degraded_recovery_mode" : "continue_recovery_without_degraded_mode",
      },
    ),
    lifecycleCommand(
      [persistence.checkpoint, "escalate"],
      "escalate_recovery_operator_review",
      !retryable && (recovery.summary.errors > 0 || validation.some((item) => item.level === "error")),
      "Operator review is required when retry is disabled or lifecycle settings are invalid.",
      {
        checkpoint: persistence.checkpoint,
        statusChannel: providerContract.provider.statusChannel,
        restartSafe: false,
        nextAction: validation.find((item) => item.level === "error")?.recovery ?? "hold_for_operator",
      },
    ),
  ]);
  const enabledCommands = commands.filter((command) => command.enabled);
  const state = validation.some((item) => item.level === "error")
    ? "invalid"
    : enabledCommands.some((command) => command.command === "escalate_recovery_operator_review")
      ? "escalated"
      : shouldDisableExternal ? "paused"
        : retryable && recovery.summary.diagnostics > 0 ? "retry-scheduled"
          : degradedAllowed ? "degraded" : "ready";

  return Object.freeze({
    schema: "aios.recovery.lifecycle-plan.v1",
    state,
    settings: Object.freeze({
      retryLimit,
      backoffSeconds,
      degradedMode,
      pauseExternalWrites,
    }),
    validation,
    commands,
    commandSummary: Object.freeze({
      total: commands.length,
      enabled: enabledCommands.length,
      restartSafe: commands.filter((command) => command.restartSafe).length,
      externalWrites: commands.filter((command) => command.writesExternalSystem).length,
    }),
    retry: Object.freeze({
      available: retryable,
      attemptsRemaining: retryable ? retryLimit : 0,
      backoffSeconds: retryable ? backoffSeconds * Math.max(1, recovery.summary.errors + recovery.summary.warnings) : 0,
      resumeToken: persistence.ledger.resumeToken,
    }),
    degradedMode: Object.freeze({
      enabled: degradedAllowed,
      localOnly: providerContract.sync.localOnly || shouldDisableExternal,
      reason: degradedAllowed ? "warnings_or_incident_review" : "not_needed",
    }),
    handoff: Object.freeze({
      ready: validation.every((item) => item.level !== "error")
        && !enabledCommands.some((command) => command.restartSafe === false),
      checkpoint: persistence.checkpoint,
      statusChannel: providerContract.provider.statusChannel,
      nextAction: enabledCommands[0]?.nextAction
        ?? validation[0]?.recovery
        ?? providerContract.nextAction,
    }),
  });
}

function summarizeRecoveryCommands(commands) {
  const byType = {};
  const byPhase = {};
  for (const command of commands) {
    byType[command.type] = (byType[command.type] ?? 0) + 1;
    byPhase[command.phase] = (byPhase[command.phase] ?? 0) + 1;
  }
  return Object.freeze({
    total: commands.length,
    restartSafe: commands.filter((command) => command.restartSafe).length,
    localOnly: commands.filter((command) => command.localOnly).length,
    externalWrites: commands.filter((command) => command.writesExternalSystem).length,
    byType: Object.freeze(Object.fromEntries(Object.entries(byType).sort())),
    byPhase: Object.freeze(Object.fromEntries(Object.entries(byPhase).sort())),
  });
}

function buildRecoveryClientHandoff(recovery, providerContract, persistence, context = {}) {
  const request = context.clientRequest || context.requestState || {};
  const route = context.route || context.workflowRoute || {};
  const requestId = compact(request.requestId || context.requestId || persistence.ledger.resumeToken);
  const workflowId = compact(request.workflowId || context.workflowId || "aios-source-recovery");
  const routeName = compact(route.name || route.routeName || context.routeName || "aios.source.recovery");
  const clientStateKey = compact(request.clientStateKey || context.clientStateKey || stableCommandId(
    "recovery-client-state",
    requestId,
    providerContract.sync.checkpoint,
    persistence.revision,
  ));
  const requiredKeys = Object.freeze([
    "requestId",
    "workflowId",
    "checkpoint",
    "persistenceRevision",
    ...Array.from(context.requiredClientKeys ?? request.requiredKeys ?? []),
  ].map(compact).filter(Boolean).filter((key, index, keys) => keys.indexOf(key) === index).sort());
  const observedState = Object.freeze({
    ...(typeof request.persistedState === "object" && request.persistedState ? request.persistedState : {}),
    requestId,
    workflowId,
    checkpoint: providerContract.sync.checkpoint,
    persistenceRevision: persistence.revision,
    resumeToken: persistence.ledger.resumeToken,
    statusChannel: providerContract.provider.statusChannel,
    recoveryState: persistence.replayState,
  });
  const missingKeys = Object.freeze(requiredKeys
    .filter((key) => observedState[key] == null || observedState[key] === "")
    .sort());
  const enabledCommands = persistence.commands.filter((command) => command.restartSafe);
  const heldCommands = persistence.commands.filter((command) => !command.restartSafe);
  const issueRows = Object.freeze(recovery.items.map((item, index) => Object.freeze({
    rowId: stableCommandId("recovery-row", providerContract.sync.checkpoint, index + 1, item.code, item.offset),
    code: item.code,
    severity: item.severity,
    message: item.message,
    action: item.action,
    phase: item.phase,
    displayState: item.severity === "warning"
      ? "review"
      : item.patchPreview.available
        ? "repairable"
        : recovery.recoverable
          ? "operator-action"
          : "blocked",
    patchAvailable: item.patchPreview.available,
    nextAction: item.patchPreview.available ? "preview-source-recovery-patch" : item.action,
  })));
  const blockedBy = Object.freeze([
    ...missingKeys.map((key) => `client-state:${key}`),
    ...providerContract.capabilities.missing.map((capability) => `capability:${capability}`),
    ...heldCommands.map((command) => `command:${command.id}`),
    ...(!recovery.recoverable ? ["recovery:not-recoverable"] : []),
  ].sort());
  const acceptedForRuntime = blockedBy.length === 0
    && providerContract.sync.statusHandoffReady
    && persistence.resume.available;
  const previewStatus = blockedBy.length
    ? "blocked"
    : recovery.summary.errors
      ? "repair-ready"
      : recovery.summary.warnings
        ? "review-ready"
        : "ready";
  const nextAction = missingKeys.length
    ? "hydrate-recovery-client-state"
    : providerContract.capabilities.missing.length
      ? "negotiate_recovery_capabilities"
      : heldCommands.length
        ? "hold_for_operator"
        : acceptedForRuntime
          ? "handoff-recovery-runtime-status"
          : persistence.resume.nextAction;

  return Object.freeze({
    schema: "aios.recovery.client-handoff.v1",
    handoffId: stableCommandId(
      "recovery-handoff",
      requestId,
      workflowId,
      providerContract.sync.checkpoint,
      persistence.revision,
    ),
    routeName,
    requestId,
    workflowId,
    clientStateKey,
    statusChannel: providerContract.provider.statusChannel,
    preview: Object.freeze({
      previewId: stableCommandId("recovery-preview", requestId, persistence.revision, previewStatus),
      title: "AI OS source recovery",
      status: previewStatus,
      rows: issueRows,
      counters: Object.freeze({
        diagnostics: recovery.summary.diagnostics,
        errors: recovery.summary.errors,
        warnings: recovery.summary.warnings,
        repairable: issueRows.filter((row) => row.displayState === "repairable").length,
        blocked: issueRows.filter((row) => row.displayState === "blocked").length,
      }),
    }),
    clientState: Object.freeze({
      stateKey: clientStateKey,
      requiredKeys,
      missingKeys,
      hydrated: missingKeys.length === 0,
      persistedState: observedState,
    }),
    acceptance: Object.freeze({
      required: recovery.summary.errors > 0 || providerContract.sync.externalWriteRequested,
      acceptedForRuntime,
      acceptedForExternalWrite: providerContract.sync.externalWriteAllowed,
      blockedBy,
      nextAction,
    }),
    commands: Object.freeze([
      Object.freeze({
        command: "render-recovery-preview",
        enabled: true,
        previewId: stableCommandId("recovery-preview-command", requestId, persistence.revision),
        idempotencyKey: stableCommandId("idempotent", "render-recovery-preview", requestId, persistence.revision),
      }),
      Object.freeze({
        command: "persist-recovery-client-state",
        enabled: missingKeys.length > 0 || recovery.summary.diagnostics > 0,
        stateKey: clientStateKey,
        idempotencyKey: stableCommandId("idempotent", "persist-recovery-client-state", clientStateKey),
      }),
      Object.freeze({
        command: "handoff-recovery-runtime-status",
        enabled: acceptedForRuntime,
        resumeToken: persistence.ledger.resumeToken,
        idempotencyKey: stableCommandId("idempotent", "handoff-recovery-runtime-status", persistence.ledger.resumeToken),
      }),
    ]),
    nextStepQueue: Object.freeze([
      ...missingKeys.map((key, index) => Object.freeze({
        index,
        action: "hydrate-recovery-client-state",
        subject: key,
        restartSafe: true,
      })),
      ...blockedBy
        .filter((blocker) => !blocker.startsWith("client-state:"))
        .map((blocker, index) => Object.freeze({
          index: missingKeys.length + index,
          action: blocker.startsWith("capability:") ? "negotiate_recovery_capabilities" : "hold_for_operator",
          subject: blocker,
          restartSafe: false,
        })),
      ...(acceptedForRuntime ? [Object.freeze({
        index: missingKeys.length + blockedBy.length,
        action: "handoff-recovery-runtime-status",
        subject: persistence.ledger.resumeToken,
        restartSafe: true,
      })] : []),
    ]),
    acceptedForRuntime,
    blockedBy,
    nextAction,
  });
}

function bridgeStatusRows(syncBridge = {}) {
  const rows = [];
  for (const row of syncBridge.comment?.preview?.providerRows ?? syncBridge.comment?.providerRows ?? []) {
    rows.push(Object.freeze({
      source: "comment",
      subject: `${row.field ?? "provider"}:${row.value ?? row.service ?? "mailchimp"}`,
      state: row.state ?? "unknown",
      checkpoint: row.checkpoint ?? syncBridge.comment?.handoff?.checkpoint ?? "",
      statusChannel: row.statusChannel ?? syncBridge.comment?.handoff?.statusChannel ?? "",
      restartSafe: row.restartSafe !== false,
      nextAction: row.nextAction ?? syncBridge.comment?.handoff?.nextAction ?? "inspect_comment_sync_preview",
    }));
  }
  for (const row of syncBridge.literal?.providers ?? []) {
    rows.push(Object.freeze({
      source: "literal",
      subject: `${row.key ?? "provider"}:${row.adapter ?? row.service ?? "mailchimp"}`,
      state: row.state ?? "unknown",
      checkpoint: row.checkpoint ?? syncBridge.literal?.handoff?.checkpoint ?? "",
      statusChannel: row.statusChannel ?? syncBridge.literal?.handoff?.statusChannel ?? "",
      restartSafe: row.restartSafe !== false,
      nextAction: row.nextAction ?? syncBridge.literal?.handoff?.nextAction ?? "inspect_literal_sync_bridge",
    }));
  }
  for (const row of syncBridge.commentCommit?.providerRows ?? syncBridge.comment?.providerCommitWindow?.providerRows ?? []) {
    rows.push(Object.freeze({
      source: "comment-commit",
      subject: `${row.field ?? "provider"}:${row.value ?? row.service ?? "mailchimp"}`,
      state: row.state ?? "unknown",
      checkpoint: row.checkpoint ?? syncBridge.commentCommit?.handoff?.checkpoint ?? "",
      statusChannel: row.statusChannel ?? syncBridge.commentCommit?.handoff?.statusChannel ?? "",
      restartSafe: row.restartSafe !== false,
      nextAction: row.nextAction ?? syncBridge.commentCommit?.handoff?.nextAction ?? "inspect_comment_provider_commit_window",
    }));
  }
  for (const row of syncBridge.literalCommit?.rows ?? syncBridge.literal?.providerCommitWindow?.rows ?? []) {
    rows.push(Object.freeze({
      source: "literal-commit",
      subject: `${row.sourceKey ?? "provider"}:${row.adapter ?? row.service ?? "mailchimp"}`,
      state: row.state ?? "unknown",
      checkpoint: row.checkpoint ?? syncBridge.literalCommit?.handoff?.checkpoint ?? "",
      statusChannel: row.statusChannel ?? syncBridge.literalCommit?.handoff?.statusChannel ?? "",
      restartSafe: row.restartSafe !== false,
      nextAction: row.nextAction ?? syncBridge.literalCommit?.handoff?.nextAction ?? "inspect_literal_provider_commit_window",
    }));
  }
  return Object.freeze(rows.sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
}

function buildRecoveryExternalHandoffState(recovery, providerContract, persistence, context = {}) {
  const syncBridge = context.syncBridge || {};
  const rows = bridgeStatusRows(syncBridge);
  const bridgeBlockers = Object.freeze([
    ...(syncBridge.comment?.acceptance?.blockedBy ?? []),
    ...(syncBridge.commentCommit?.acceptance?.blockedBy ?? []),
    ...(syncBridge.comment?.blockers ?? []),
    ...(syncBridge.literal?.blockers ?? []),
    ...(syncBridge.literalCommit?.blockers ?? []),
    ...(syncBridge.combined?.blockers ?? []),
  ].map(compact).filter(Boolean).sort());
  const bridgeReview = Object.freeze([
    ...(syncBridge.commentCommit?.acceptance?.review ?? []),
    ...(syncBridge.literal?.review ?? []),
    ...(syncBridge.literalCommit?.review ?? []),
    ...(syncBridge.combined?.review ?? []),
  ].map(compact).filter(Boolean).sort());
  const checkpointSet = new Set([
    providerContract.sync.checkpoint,
    syncBridge.comment?.handoff?.checkpoint,
    syncBridge.commentCommit?.handoff?.checkpoint,
    syncBridge.literal?.handoff?.checkpoint,
    syncBridge.literalCommit?.handoff?.checkpoint,
    syncBridge.combined?.handoff?.checkpoint,
    ...rows.map((row) => row.checkpoint),
  ].filter(Boolean));
  const statusChannelSet = new Set([
    providerContract.provider.statusChannel,
    syncBridge.comment?.handoff?.statusChannel,
    syncBridge.commentCommit?.handoff?.statusChannel,
    syncBridge.literal?.handoff?.statusChannel,
    syncBridge.literalCommit?.handoff?.statusChannel,
    syncBridge.combined?.handoff?.statusChannel,
    ...rows.map((row) => row.statusChannel),
  ].filter(Boolean));
  const externalRequested = providerContract.sync.externalWriteRequested === true
    || syncBridge.comment?.handoff?.writesExternalSystem === true
    || syncBridge.commentCommit?.handoff?.writesExternalSystem === true
    || syncBridge.literal?.handoff?.writesExternalSystem === true
    || syncBridge.literalCommit?.handoff?.writesExternalSystem === true
    || syncBridge.combined?.handoff?.writesExternalSystem === true;
  const externalAllowed = providerContract.sync.externalWriteAllowed === true
    && bridgeBlockers.length === 0
    && rows.every((row) => row.restartSafe)
    && syncBridge.commentCommit?.handoff?.ready !== false
    && syncBridge.literalCommit?.handoff?.ready !== false;
  const ready = recovery.recoverable
    && persistence.resume?.available === true
    && providerContract.sync.statusHandoffReady === true
    && bridgeBlockers.length === 0
    && rows.every((row) => row.restartSafe);
  const state = bridgeBlockers.length > 0
    ? "blocked"
    : bridgeReview.length > 0 || recovery.summary.warnings > 0
      ? "review"
      : ready ? "ready" : "warming";
  const nextAction = bridgeBlockers.length > 0
    ? "reconcile_mailchimp_sync_bridge"
    : externalRequested && !externalAllowed
      ? "confirm_mailchimp_external_sync"
      : ready ? "handoff-recovery-external-status" : persistence.resume?.nextAction ?? providerContract.nextAction;

  return Object.freeze({
    schema: "aios.recovery.external-handoff-state.v1",
    state,
    ready,
    rows,
    blockers: bridgeBlockers,
    review: bridgeReview,
    checkpoints: Object.freeze(Array.from(checkpointSet).sort()),
    statusChannels: Object.freeze(Array.from(statusChannelSet).sort()),
    sync: Object.freeze({
      externalWriteRequested: externalRequested,
      externalWriteAllowed: externalAllowed,
      localOnly: !externalAllowed,
    }),
    providerCommitWindow: Object.freeze({
      commentReady: syncBridge.commentCommit?.handoff?.ready !== false,
      literalReady: syncBridge.literalCommit?.handoff?.ready !== false,
      commentRows: syncBridge.commentCommit?.counters?.providers ?? 0,
      literalRows: syncBridge.literalCommit?.counters?.rows ?? 0,
      held: (syncBridge.commentCommit?.counters?.held ?? 0) + (syncBridge.literalCommit?.counters?.held ?? 0),
      review: (syncBridge.commentCommit?.counters?.review ?? 0) + (syncBridge.literalCommit?.counters?.review ?? 0),
      nextAction: syncBridge.commentCommit?.handoff?.ready === false
        ? syncBridge.commentCommit.handoff.nextAction
        : syncBridge.literalCommit?.handoff?.ready === false
          ? syncBridge.literalCommit.handoff.nextAction
          : "handoff_recovery_provider_commit_window",
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: ready,
      acceptedForExternalWrite: externalAllowed,
      blockedBy: bridgeBlockers,
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: Array.from(checkpointSet).sort()[0] || providerContract.sync.checkpoint,
      statusChannel: Array.from(statusChannelSet).sort()[0] || providerContract.provider.statusChannel,
      localOnly: !externalAllowed,
      writesExternalSystem: externalAllowed,
      nextAction,
    }),
  });
}

function buildRecoveryPersistencePlan(recovery, providerContract, context = {}) {
  const repairItems = recovery.items.filter((item) => item.severity !== "info");
  const repairCommands = repairItems.map((item, index) => buildRecoveryCommand(item, providerContract, index));
  const statusCommand = buildStatusHandoffCommand(recovery, providerContract);
  const commands = Object.freeze([
    ...repairCommands,
    ...(providerContract.sync.statusHandoffReady ? [statusCommand] : []),
  ]);
  const unsafeCommands = commands.filter((command) => !command.restartSafe);
  const replayState = unsafeCommands.length > 0
    ? "hold"
    : recovery.summary.errors > 0
      ? "repair-ready"
      : recovery.summary.warnings > 0 ? "review-ready" : "replay-ready";
  const checkpoint = compact(context.resumeCheckpoint || providerContract.sync.checkpoint);
  const revision = stableCommandId(
    "recovery",
    checkpoint,
    replayState,
    recovery.summary.diagnostics,
    recovery.summary.errors,
    recovery.summary.warnings,
    commands.length,
  );

  return Object.freeze({
    schema: "aios.recovery.persistence-plan.v1",
    revision,
    replayState,
    checkpoint,
    statusChannel: providerContract.provider.statusChannel,
    commands,
    commandSummary: summarizeRecoveryCommands(commands),
    ledger: Object.freeze({
      key: revision,
      checkpoint,
      statusChannel: providerContract.provider.statusChannel,
      state: replayState,
      restartSafe: unsafeCommands.length === 0,
      resumeToken: stableCommandId("resume", checkpoint, replayState, commands.length),
    }),
    resume: Object.freeze({
      available: unsafeCommands.length === 0 && Boolean(checkpoint),
      fromCheckpoint: checkpoint,
      nextCommandId: commands.find((command) => command.restartSafe)?.id ?? "",
      nextAction: unsafeCommands[0]?.action ?? commands[0]?.action ?? providerContract.nextAction,
    }),
    blockedCommands: Object.freeze(unsafeCommands.map((command) => command.id)),
  });
}

function normalizeRecoveryResumeManifest(manifest = null) {
  if (!manifest || typeof manifest !== "object") {
    return Object.freeze({
      schema: "aios.recovery.resume-manifest-adoption.v1",
      provided: false,
      state: "absent",
      checkpoint: "",
      statusChannel: "",
      resumeToken: "",
      rows: Object.freeze([]),
      blockers: Object.freeze([]),
      counters: Object.freeze({ rows: 0, replayable: 0, held: 0, externalWrites: 0 }),
      accepted: false,
      nextAction: "attach_literal_resume_manifest",
    });
  }
  const rows = Object.freeze(Array.from(manifest.rows ?? []).map((row, index) => Object.freeze({
    sequence: Number.isInteger(row.sequence) ? row.sequence : index + 1,
    commandId: compact(row.commandId || row.id),
    checkpoint: compact(row.checkpoint || manifest.checkpoint),
    statusChannel: compact(row.statusChannel || manifest.statusChannel),
    persistedState: compact(row.persistedState || row.state || "unknown"),
    replayState: compact(row.replayState || (row.restartSafe === true ? "replayable" : "held")),
    restartSafe: row.restartSafe === true,
    idempotent: row.idempotent !== false,
    idempotencyKey: compact(row.idempotencyKey),
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: compact(row.nextAction || "inspect_resume_manifest_row"),
  })));
  const structuralBlockers = [
    ...rows.filter((row) => !row.commandId).map((row) => `row:${row.sequence}:command-id`),
    ...rows.filter((row) => row.restartSafe !== true).map((row) => `command:${row.commandId || row.sequence}:restart-safe`),
    ...rows.filter((row) => !row.idempotencyKey).map((row) => `command:${row.commandId || row.sequence}:idempotency`),
  ];
  const blockers = Object.freeze([
    ...Array.from(manifest.blockers ?? []).map(compact).filter(Boolean),
    ...structuralBlockers,
  ].sort());
  const replayable = rows.filter((row) => row.replayState === "replayable" && row.restartSafe && row.idempotencyKey);
  const checkpoint = compact(manifest.checkpoint || manifest.handoff?.checkpoint || rows[0]?.checkpoint);
  const statusChannel = compact(manifest.statusChannel || manifest.handoff?.statusChannel || rows[0]?.statusChannel);
  const state = blockers.length > 0
    ? "blocked"
    : compact(manifest.state || (replayable.length > 0 ? "resume-ready" : "empty"));
  const accepted = Boolean(checkpoint && statusChannel)
    && blockers.length === 0
    && (state === "resume-ready" || state === "empty")
    && manifest.handoff?.ready !== false;

  return Object.freeze({
    schema: "aios.recovery.resume-manifest-adoption.v1",
    provided: true,
    state,
    checkpoint,
    statusChannel,
    resumeToken: compact(manifest.clientState?.persistedState?.literalResumeToken || manifest.replay?.resumeToken),
    rows,
    blockers,
    counters: Object.freeze({
      rows: rows.length,
      replayable: replayable.length,
      held: rows.length - replayable.length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    accepted,
    nextAction: blockers.length > 0
      ? "repair_literal_resume_manifest"
      : accepted ? "adopt_literal_resume_manifest" : "hydrate_literal_resume_manifest",
  });
}

function normalizeRecoveryRestartDigest(digest = null, resumeManifest = null) {
  if (!digest || typeof digest !== "object") {
    return Object.freeze({
      schema: "aios.recovery.restart-digest-adoption.v1",
      provided: false,
      state: "absent",
      checkpoint: "",
      statusChannel: "",
      restartToken: "",
      rows: Object.freeze([]),
      blockers: Object.freeze([]),
      counters: Object.freeze({ rows: 0, restartSafe: 0, blocked: 0, externalWrites: 0, drifted: 0 }),
      accepted: false,
      nextAction: "attach_literal_restart_digest",
    });
  }
  const fallbackCheckpoint = compact(digest.checkpoint || digest.handoff?.checkpoint || resumeManifest?.checkpoint);
  const fallbackStatusChannel = compact(digest.statusChannel || digest.handoff?.statusChannel || resumeManifest?.statusChannel);
  const rows = Object.freeze(Array.from(digest.rows ?? []).map((row, index) => {
    const expectedState = compact(row.expectedState || (row.restartSafe === true ? row.persistedState : "blocked"));
    const persistedState = compact(row.persistedState || row.state || "unknown");
    const checkpoint = compact(row.checkpoint || fallbackCheckpoint);
    const statusChannel = compact(row.statusChannel || fallbackStatusChannel);
    const idempotencyKey = compact(row.idempotencyKey);
    const drifted = Boolean(expectedState && persistedState && expectedState !== persistedState)
      || !checkpoint
      || !statusChannel
      || !idempotencyKey;
    return Object.freeze({
      sequence: Number.isInteger(row.sequence) ? row.sequence : index + 1,
      commandId: compact(row.commandId || row.id),
      checkpoint,
      statusChannel,
      expectedState,
      persistedState,
      replayState: compact(row.replayState || (row.restartSafe === true ? "replayable" : "held")),
      restartSafe: row.restartSafe === true && !drifted,
      idempotencyKey,
      writesExternalSystem: row.writesExternalSystem === true,
      drifted,
      nextAction: compact(row.nextAction || (drifted ? "rebuild_literal_restart_digest" : "adopt_literal_restart_digest_row")),
    });
  }));
  const structuralBlockers = [
    ...rows.filter((row) => !row.commandId).map((row) => `row:${row.sequence}:command-id`),
    ...rows.filter((row) => row.restartSafe !== true).map((row) => `command:${row.commandId || row.sequence}:restart-safe`),
    ...rows.filter((row) => row.drifted).map((row) => `command:${row.commandId || row.sequence}:drift`),
  ];
  const blockers = Object.freeze([
    ...Array.from(digest.blockers ?? []).map(compact).filter(Boolean),
    ...structuralBlockers,
  ].sort());
  const checkpoint = fallbackCheckpoint || rows[0]?.checkpoint || "";
  const statusChannel = fallbackStatusChannel || rows[0]?.statusChannel || "";
  const restartToken = compact(digest.persistedState?.restartDigestToken || digest.restartToken);
  const accepted = Boolean(checkpoint && statusChannel && restartToken)
    && blockers.length === 0
    && digest.handoff?.ready !== false
    && resumeManifest?.accepted !== false;

  return Object.freeze({
    schema: "aios.recovery.restart-digest-adoption.v1",
    provided: true,
    state: blockers.length > 0 ? "blocked" : compact(digest.state || (rows.length > 0 ? "restart-ready" : "empty")),
    checkpoint,
    statusChannel,
    restartToken,
    rows,
    blockers,
    counters: Object.freeze({
      rows: rows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      blocked: blockers.length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      drifted: rows.filter((row) => row.drifted).length,
    }),
    accepted,
    nextAction: blockers.length > 0
      ? "repair_literal_restart_digest"
      : accepted ? "adopt_literal_restart_digest" : "hydrate_literal_restart_digest",
  });
}

function buildRecoveryStatusLedger(recovery, providerContract, persistence, clientHandoff, externalHandoff) {
  const commandRows = Object.freeze((persistence.commands ?? []).map((command, index) => {
    const expectedState = command.statusPatch?.state ?? (command.restartSafe ? "queued" : "blocked");
    const persistedState = command.restartSafe === true ? expectedState : "blocked";
    const drifted = persistedState !== expectedState || !command.idempotencyKey;
    return Object.freeze({
      schema: "aios.recovery.status-ledger-row.v1",
      sequence: index + 1,
      rowId: stableCommandId("recovery-ledger", persistence.checkpoint, index + 1, command.phase, command.action),
      commandId: command.id,
      type: command.type,
      action: command.action,
      phase: command.phase,
      checkpoint: command.checkpoint,
      statusChannel: command.statusChannel,
      expectedState,
      persistedState,
      drifted,
      restartSafe: command.restartSafe === true && !drifted,
      idempotencyKey: command.idempotencyKey,
      localOnly: command.localOnly !== false,
      writesExternalSystem: command.writesExternalSystem === true,
      nextAction: drifted ? "rebuild_recovery_status_ledger" : command.action,
    });
  }));
  const clientRow = Object.freeze({
    schema: "aios.recovery.status-ledger-row.v1",
    sequence: commandRows.length + 1,
    rowId: stableCommandId("recovery-ledger", persistence.checkpoint, "client", clientHandoff.handoffId),
    commandId: clientHandoff.handoffId,
    type: "client.handoff",
    action: clientHandoff.nextAction,
    phase: "client",
    checkpoint: providerContract.sync.checkpoint,
    statusChannel: providerContract.provider.statusChannel,
    expectedState: clientHandoff.acceptedForRuntime ? "accepted" : "pending",
    persistedState: clientHandoff.blockedBy?.length ? "blocked" : clientHandoff.acceptedForRuntime ? "accepted" : "pending",
    drifted: clientHandoff.acceptedForRuntime === true && (clientHandoff.blockedBy?.length ?? 0) > 0,
    restartSafe: clientHandoff.clientState?.hydrated === true && (clientHandoff.blockedBy?.length ?? 0) === 0,
    idempotencyKey: stableCommandId("idempotent", "recovery-client", clientHandoff.clientStateKey),
    localOnly: clientHandoff.acceptance?.acceptedForExternalWrite !== true,
    writesExternalSystem: clientHandoff.acceptance?.acceptedForExternalWrite === true,
    nextAction: clientHandoff.nextAction,
  });
  const externalRow = Object.freeze({
    schema: "aios.recovery.status-ledger-row.v1",
    sequence: commandRows.length + 2,
    rowId: stableCommandId("recovery-ledger", persistence.checkpoint, "external", externalHandoff.state),
    commandId: stableCommandId("recovery-external", externalHandoff.handoff?.checkpoint, externalHandoff.handoff?.statusChannel),
    type: "external.handoff",
    action: externalHandoff.handoff?.nextAction ?? providerContract.nextAction,
    phase: "external",
    checkpoint: externalHandoff.handoff?.checkpoint ?? providerContract.sync.checkpoint,
    statusChannel: externalHandoff.handoff?.statusChannel ?? providerContract.provider.statusChannel,
    expectedState: externalHandoff.ready ? "accepted" : externalHandoff.state,
    persistedState: externalHandoff.blockers?.length ? "blocked" : externalHandoff.ready ? "accepted" : externalHandoff.state,
    drifted: externalHandoff.acceptance?.acceptedForRuntime === true && (externalHandoff.blockers?.length ?? 0) > 0,
    restartSafe: externalHandoff.ready === true && (externalHandoff.blockers?.length ?? 0) === 0,
    idempotencyKey: stableCommandId("idempotent", "recovery-external", externalHandoff.handoff?.checkpoint, externalHandoff.handoff?.statusChannel),
    localOnly: externalHandoff.handoff?.localOnly !== false,
    writesExternalSystem: externalHandoff.handoff?.writesExternalSystem === true,
    nextAction: externalHandoff.handoff?.nextAction ?? providerContract.nextAction,
  });
  const rows = Object.freeze([...commandRows, clientRow, externalRow]);
  const driftRows = rows.filter((row) => row.drifted || !row.restartSafe);
  const state = driftRows.length > 0
    ? "blocked"
    : recovery.summary.errors > 0 ? "repair-ready" : recovery.summary.warnings > 0 ? "review" : "ready";

  return Object.freeze({
    schema: "aios.recovery.status-ledger.v1",
    revision: stableCommandId(
      "recovery-status-ledger",
      persistence.revision,
      state,
      rows.length,
      driftRows.length,
    ),
    state,
    checkpoint: persistence.checkpoint,
    statusChannel: providerContract.provider.statusChannel,
    rows,
    blockers: Object.freeze(driftRows.map((row) => `recovery-ledger:${row.commandId}`).sort()),
    counters: Object.freeze({
      rows: rows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      drifted: driftRows.length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      diagnostics: recovery.summary.diagnostics,
    }),
    handoff: Object.freeze({
      ready: driftRows.length === 0,
      checkpoint: persistence.checkpoint,
      statusChannel: providerContract.provider.statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction: driftRows[0]?.nextAction ?? providerContract.nextAction,
    }),
  });
}

function buildRecoveryProviderHandoffReport(recovery, providerContract, persistence, externalHandoff, statusLedger, lifecyclePlan, resumeManifest) {
  const rows = Object.freeze([
    Object.freeze({
      schema: "aios.recovery.provider-handoff-row.v1",
      source: "provider-contract",
      subject: `${providerContract.provider.service}:${providerContract.provider.adapter}`,
      state: providerContract.capabilities.negotiated ? "ready" : "blocked",
      checkpoint: providerContract.sync.checkpoint,
      statusChannel: providerContract.provider.statusChannel,
      restartSafe: providerContract.capabilities.negotiated,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed,
      nextAction: providerContract.nextAction,
    }),
    Object.freeze({
      schema: "aios.recovery.provider-handoff-row.v1",
      source: "external-handoff",
      subject: externalHandoff.revision ?? providerContract.sync.checkpoint,
      state: externalHandoff.state ?? "unknown",
      checkpoint: externalHandoff.handoff?.checkpoint ?? providerContract.sync.checkpoint,
      statusChannel: externalHandoff.handoff?.statusChannel ?? providerContract.provider.statusChannel,
      restartSafe: externalHandoff.handoff?.ready === true,
      localOnly: externalHandoff.handoff?.localOnly !== false,
      writesExternalSystem: externalHandoff.handoff?.writesExternalSystem === true,
      nextAction: externalHandoff.handoff?.nextAction ?? providerContract.nextAction,
    }),
    Object.freeze({
      schema: "aios.recovery.provider-handoff-row.v1",
      source: "status-ledger",
      subject: statusLedger.revision ?? providerContract.sync.checkpoint,
      state: statusLedger.handoff?.ready === false ? "blocked" : statusLedger.state ?? "ready",
      checkpoint: statusLedger.handoff?.checkpoint ?? providerContract.sync.checkpoint,
      statusChannel: statusLedger.handoff?.statusChannel ?? providerContract.provider.statusChannel,
      restartSafe: statusLedger.handoff?.ready !== false,
      localOnly: statusLedger.handoff?.localOnly !== false,
      writesExternalSystem: statusLedger.handoff?.writesExternalSystem === true,
      nextAction: statusLedger.handoff?.nextAction ?? "publish_recovery_status_ledger",
    }),
    Object.freeze({
      schema: "aios.recovery.provider-handoff-row.v1",
      source: "lifecycle-plan",
      subject: lifecyclePlan.state,
      state: lifecyclePlan.handoff?.ready === false ? "blocked" : lifecyclePlan.state,
      checkpoint: lifecyclePlan.handoff?.checkpoint ?? providerContract.sync.checkpoint,
      statusChannel: lifecyclePlan.handoff?.statusChannel ?? providerContract.provider.statusChannel,
      restartSafe: lifecyclePlan.handoff?.ready !== false,
      localOnly: lifecyclePlan.degradedMode?.localOnly !== false,
      writesExternalSystem: lifecyclePlan.commands?.some((command) => command.writesExternalSystem) === true,
      nextAction: lifecyclePlan.handoff?.nextAction ?? "publish_recovery_lifecycle_plan",
    }),
    Object.freeze({
      schema: "aios.recovery.provider-handoff-row.v1",
      source: "resume-manifest",
      subject: resumeManifest.revision ?? persistence.ledger.resumeToken,
      state: resumeManifest.provided === false ? "absent" : resumeManifest.accepted ? "accepted" : "blocked",
      checkpoint: persistence.checkpoint,
      statusChannel: providerContract.provider.statusChannel,
      restartSafe: resumeManifest.provided === false || resumeManifest.accepted === true,
      localOnly: true,
      writesExternalSystem: false,
      nextAction: resumeManifest.provided === false
        ? "continue_without_recovery_resume_manifest"
        : resumeManifest.accepted ? "accept_recovery_resume_manifest" : resumeManifest.nextAction ?? "repair_recovery_resume_manifest",
    }),
  ]);
  const blockers = Object.freeze([
    ...rows.filter((row) => row.state === "blocked" || !row.restartSafe).map((row) => `${row.source}:${row.subject}:${row.nextAction}`),
    ...providerContract.capabilities.missing.map((capability) => `capability:${capability}:negotiate_recovery_capabilities`),
    ...(!recovery.recoverable ? ["recovery:not-recoverable:hold_for_operator"] : []),
  ].sort());
  const review = Object.freeze([
    ...(recovery.summary.warnings > 0 ? ["recovery:warnings"] : []),
    ...rows.filter((row) => row.state === "review").map((row) => `${row.source}:${row.subject}`),
  ].sort());
  const state = blockers.length > 0 ? "blocked" : review.length > 0 ? "review" : "ready";
  const nextAction = blockers[0]?.split(":").slice(2).join(":")
    || (review.length > 0 ? "review_recovery_provider_handoff" : "handoff_recovery_provider_report");

  return Object.freeze({
    schema: "aios.recovery.provider-handoff-report.v1",
    revision: stableCommandId("recovery-provider-handoff", providerContract.sync.checkpoint, persistence.revision, statusLedger.revision, state),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      blocked: blockers.length,
      review: review.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      missingCapabilities: providerContract.capabilities.missing.length,
      diagnostics: recovery.summary.diagnostics,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockers.length === 0,
      acceptedForExternalWrite: blockers.length === 0 && rows.some((row) => row.writesExternalSystem),
      blockedBy: blockers,
      review,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockers.length === 0,
      checkpoint: providerContract.sync.checkpoint,
      statusChannel: providerContract.provider.statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function normalizeControlIntentRows(controlIntent = {}) {
  const rows = [];
  for (const row of controlIntent.comment?.rows ?? []) {
    rows.push(Object.freeze({
      source: `comment:${row.source ?? "control"}`,
      subject: compact(row.subject),
      state: compact(row.state || "unknown"),
      checkpoint: compact(row.checkpoint || controlIntent.comment?.handoff?.checkpoint),
      statusChannel: compact(row.statusChannel || controlIntent.comment?.handoff?.statusChannel),
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: compact(row.idempotencyKey),
      nextAction: compact(row.nextAction || controlIntent.comment?.handoff?.nextAction || "inspect_comment_control_intent"),
    }));
  }
  for (const row of controlIntent.literal?.rows ?? []) {
    rows.push(Object.freeze({
      source: `literal:${row.source ?? "control"}`,
      subject: compact(row.subject),
      state: compact(row.state || "unknown"),
      checkpoint: compact(row.checkpoint || controlIntent.literal?.handoff?.checkpoint),
      statusChannel: compact(row.statusChannel || controlIntent.literal?.handoff?.statusChannel),
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: compact(row.idempotencyKey),
      nextAction: compact(row.nextAction || controlIntent.literal?.handoff?.nextAction || "inspect_literal_control_intent"),
    }));
  }
  return Object.freeze(rows.sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
}

function buildRecoveryControlIntentAcceptance(recovery, providerContract, lifecyclePlan, persistence, context = {}) {
  const rows = normalizeControlIntentRows(context.controlIntent ?? context.mailchimpControlIntent ?? {});
  const lifecycleCommandRows = (lifecyclePlan.commands ?? []).map((command, index) => Object.freeze({
    source: "recovery:lifecycle-command",
    subject: command.command,
    state: command.enabled ? lifecyclePlan.state : "idle",
    checkpoint: command.checkpoint || lifecyclePlan.handoff?.checkpoint || persistence.checkpoint,
    statusChannel: command.statusChannel || lifecyclePlan.handoff?.statusChannel || providerContract.provider.statusChannel,
    restartSafe: command.restartSafe !== false,
    localOnly: command.localOnly !== false,
    writesExternalSystem: command.writesExternalSystem === true,
    idempotencyKey: command.idempotencyKey || stableCommandId("idempotent", "recovery-control-intent", index + 1, command.command),
    nextAction: command.nextAction || lifecyclePlan.handoff?.nextAction || providerContract.nextAction,
  }));
  const mergedRows = Object.freeze([...rows, ...lifecycleCommandRows]
    .map((row, index) => Object.freeze({
      schema: "aios.recovery.control-intent-row.v1",
      order: index + 1,
      ...row,
    })));
  const blockedRows = mergedRows.filter((row) => row.state === "blocked" || row.state === "held" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = mergedRows.filter((row) => row.state === "review" || row.state === "degraded");
  const externalRows = mergedRows.filter((row) => row.writesExternalSystem);
  const state = blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0 || recovery.summary.warnings > 0 ? "review" : mergedRows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (mergedRows.length > 0 ? "accept_recovery_control_intent" : "attach_recovery_control_intent");

  return Object.freeze({
    schema: "aios.recovery.control-intent-acceptance.v1",
    state,
    rows: mergedRows,
    counters: Object.freeze({
      rows: mergedRows.length,
      commentRows: rows.filter((row) => row.source.startsWith("comment:")).length,
      literalRows: rows.filter((row) => row.source.startsWith("literal:")).length,
      lifecycleRows: lifecycleCommandRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: mergedRows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0 && providerContract.sync.externalWriteAllowed === true,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: mergedRows[0]?.checkpoint ?? persistence.checkpoint,
      statusChannel: mergedRows[0]?.statusChannel ?? providerContract.provider.statusChannel,
      localOnly: externalRows.length === 0 || providerContract.sync.externalWriteAllowed !== true,
      writesExternalSystem: externalRows.length > 0 && providerContract.sync.externalWriteAllowed === true,
      nextAction,
    }),
  });
}

export function classifyAiosRecovery(diagnostics = [], context = {}) {
  const normalized = Array.from(diagnostics ?? []).map(stableDiagnostic);
  const items = normalized.map((diagnostic) => {
    const action = actionFor(diagnostic);
    return Object.freeze({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      action,
      phase: recoveryPhase(action),
      line: diagnostic.line,
      column: diagnostic.column,
      offset: diagnostic.offset,
      patchPreview: buildPatchPreview({ ...diagnostic, action }),
    });
  });
  const errors = items.filter((item) => item.severity !== "warning" && item.severity !== "info");
  const sourceRepairCount = items.filter((item) => item.phase.startsWith("source") || item.phase === "parser").length;
  const restartSafe = errors.length === 0 || sourceRepairCount === errors.length || context.allowSourceRecovery === true;

  return Object.freeze({
    schema: "aios.error-recovery.v1",
    ok: errors.length === 0,
    recoverable: restartSafe && items.every((item) => item.action !== "hold_for_operator"),
    restartSafe,
    items: Object.freeze(items),
    summary: Object.freeze({
      diagnostics: normalized.length,
      errors: errors.length,
      warnings: items.filter((item) => item.severity === "warning").length,
      sourceRepairCount,
      nextAction: errors.length === 0
        ? "continue_compile"
        : items.find((item) => item.severity !== "warning")?.action ?? "review_warning",
    }),
  });
}

export function buildAiosRecoveryStatus(diagnostics = [], context = {}) {
  const recovery = classifyAiosRecovery(diagnostics, context);
  const blocked = recovery.summary.errors > 0 && !recovery.recoverable;
  const providerContract = buildRecoveryProviderContract(context, recovery);
  const persistence = buildRecoveryPersistencePlan(recovery, providerContract, context);
  const clientHandoff = buildRecoveryClientHandoff(recovery, providerContract, persistence, context);
  const externalHandoff = buildRecoveryExternalHandoffState(recovery, providerContract, persistence, context);
  const statusLedger = buildRecoveryStatusLedger(recovery, providerContract, persistence, clientHandoff, externalHandoff);
  const lifecyclePlan = buildRecoveryLifecyclePlan(recovery, providerContract, persistence, context);
  const controlIntentAcceptance = buildRecoveryControlIntentAcceptance(recovery, providerContract, lifecyclePlan, persistence, context);
  const incidentRows = normalizeIncidentSnapshotRows(context);
  const incidentLifecycle = buildRecoveryIncidentLifecycle(incidentRows, recovery, providerContract, persistence, context);
  const resumeManifest = normalizeRecoveryResumeManifest(context.literalResumeManifest ?? context.resumeManifest);
  const restartDigest = normalizeRecoveryRestartDigest(context.literalRestartDigest ?? context.restartDigest, resumeManifest);
  const providerHandoffReport = buildRecoveryProviderHandoffReport(recovery, providerContract, persistence, externalHandoff, statusLedger, lifecyclePlan, resumeManifest);
  const previewAcceptanceSummary = buildRecoveryPreviewAcceptanceSummary(
    recovery,
    clientHandoff,
    lifecyclePlan,
    resumeManifest,
    providerHandoffReport,
  );
  return Object.freeze({
    schema: "aios.recovery-status.v1",
    state: blocked ? "blocked" : recovery.summary.errors > 0 ? "recovering" : recovery.summary.warnings > 0 ? "review" : "ready",
    nextAction: blocked
      ? "hold_for_operator"
      : clientHandoff.nextAction === "handoff-recovery-runtime-status" && providerContract.nextAction === "handoff_recovery_status"
        ? recovery.summary.nextAction
        : clientHandoff.nextAction,
    restartSafe: recovery.restartSafe,
    exportReady: recovery.ok,
    localOnly: providerContract.sync.localOnly,
    writesExternalSystem: providerContract.sync.externalWriteAllowed,
    recovery,
    providerContract,
    persistence,
    clientHandoff,
    externalHandoff,
    statusLedger,
    lifecyclePlan,
    controlIntentAcceptance,
    incidentLifecycle,
    resumeManifest,
    restartDigest,
    providerHandoffReport,
    previewAcceptanceSummary,
    userVisibleWorkflow: Object.freeze({
      routeName: clientHandoff.routeName,
      preview: clientHandoff.preview,
      acceptance: clientHandoff.acceptance,
      previewAcceptanceSummary,
      externalHandoff,
      lifecyclePlan,
      controlIntentAcceptance,
      resumeManifest,
      restartDigest,
      providerHandoffReport,
      commands: clientHandoff.commands,
      nextSteps: Object.freeze([
        ...clientHandoff.nextStepQueue,
        ...lifecyclePlan.commands
          .filter((command) => command.enabled)
          .map((command, index) => Object.freeze({
            index: clientHandoff.nextStepQueue.length + index,
            action: command.nextAction,
            subject: command.command,
            restartSafe: command.restartSafe,
          })),
        ...controlIntentAcceptance.rows
          .filter((row) => row.state === "blocked" || row.state === "review")
          .map((row, index) => Object.freeze({
            index: clientHandoff.nextStepQueue.length + lifecyclePlan.commands.length + index,
            action: row.nextAction,
            subject: `${row.source}:${row.subject}`,
            restartSafe: row.restartSafe,
          })),
      ]),
      nextAction: lifecyclePlan.handoff.ready === false
        ? lifecyclePlan.handoff.nextAction
        : controlIntentAcceptance.handoff.ready === false
          ? controlIntentAcceptance.handoff.nextAction
          : externalHandoff.handoff.ready ? clientHandoff.nextAction : externalHandoff.handoff.nextAction,
    }),
    resume: persistence.resume,
    handoff: Object.freeze({
      adapter: providerContract.provider.adapter,
      service: providerContract.provider.service,
      statusChannel: providerContract.provider.statusChannel,
      recoveryMayWriteExternally: providerContract.sync.externalWriteAllowed,
      checkpoint: providerContract.sync.checkpoint,
      persistenceRevision: persistence.revision,
      resumeToken: persistence.ledger.resumeToken,
      routeName: clientHandoff.routeName,
      clientStateKey: clientHandoff.clientStateKey,
      acceptedForRuntime: clientHandoff.acceptedForRuntime,
      externalAcceptedForRuntime: externalHandoff.acceptance.acceptedForRuntime,
      statusLedgerRevision: statusLedger.revision,
      lifecycleState: lifecyclePlan.state,
      controlIntentAccepted: controlIntentAcceptance.acceptance.acceptedForRuntime,
      resumeManifestAccepted: resumeManifest.accepted,
      restartDigestAccepted: restartDigest.accepted,
      providerHandoffReportReady: providerHandoffReport.handoff.ready,
      previewAcceptanceReady: previewAcceptanceSummary.handoff.ready,
    }),
  });
}

export function buildAiosRecoveryLifecyclePlan(diagnostics = [], context = {}) {
  const recovery = classifyAiosRecovery(diagnostics, context);
  const providerContract = buildRecoveryProviderContract(context, recovery);
  const persistence = buildRecoveryPersistencePlan(recovery, providerContract, context);
  return buildRecoveryLifecyclePlan(recovery, providerContract, persistence, context);
}

export function negotiateRecoveryProviderCapabilities(context = {}) {
  return buildRecoveryProviderContract(context);
}

export function buildAiosRecoveryPersistencePlan(diagnostics = [], context = {}) {
  const recovery = classifyAiosRecovery(diagnostics, context);
  const providerContract = buildRecoveryProviderContract(context, recovery);
  return buildRecoveryPersistencePlan(recovery, providerContract, context);
}

export function buildAiosRecoveryClientHandoff(diagnostics = [], context = {}) {
  const recovery = classifyAiosRecovery(diagnostics, context);
  const providerContract = buildRecoveryProviderContract(context, recovery);
  const persistence = buildRecoveryPersistencePlan(recovery, providerContract, context);
  return buildRecoveryClientHandoff(recovery, providerContract, persistence, context);
}

export function validateAiosRecoveryStatus(status) {
  const diagnostics = [];
  if (status?.schema !== "aios.recovery-status.v1") {
    diagnostics.push(Object.freeze({ level: "error", code: "recovery.status.schema.invalid" }));
  }
  if (!status?.clientHandoff?.handoffId) {
    diagnostics.push(Object.freeze({ level: "error", code: "recovery.client-handoff.missing" }));
  }
  if (status?.clientHandoff?.acceptedForRuntime && status?.clientHandoff?.blockedBy?.length) {
    diagnostics.push(Object.freeze({ level: "error", code: "recovery.client-handoff.accepted-with-blockers" }));
  }
  if (status?.clientHandoff?.acceptedForRuntime && status?.resume?.available !== true) {
    diagnostics.push(Object.freeze({ level: "error", code: "recovery.client-handoff.accepted-without-resume" }));
  }
  if (status?.writesExternalSystem && status?.localOnly) {
    diagnostics.push(Object.freeze({ level: "error", code: "recovery.external-write.local-only-conflict" }));
  }
  if (!status?.userVisibleWorkflow?.commands?.some((command) => command.command === "render-recovery-preview")) {
    diagnostics.push(Object.freeze({ level: "warning", code: "recovery.preview-command.missing" }));
  }
  if (status?.clientHandoff?.clientState?.missingKeys?.length
    && status?.clientHandoff?.nextAction !== "hydrate-recovery-client-state") {
    diagnostics.push(Object.freeze({ level: "warning", code: "recovery.client-state-missing-without-hydration-action" }));
  }
  if (status?.externalHandoff?.handoff?.writesExternalSystem && status?.externalHandoff?.handoff?.localOnly) {
    diagnostics.push(Object.freeze({ level: "error", code: "recovery.external-handoff.write-local-conflict" }));
  }
  if (status?.externalHandoff?.acceptance?.acceptedForRuntime && status?.externalHandoff?.acceptance?.blockedBy?.length) {
    diagnostics.push(Object.freeze({ level: "error", code: "recovery.external-handoff.accepted-with-blockers" }));
  }
  if (status?.statusLedger?.handoff?.ready === false && status?.resume?.available === true) {
    diagnostics.push(Object.freeze({ level: "warning", code: "recovery.status-ledger.blocked-with-resume" }));
  }
  if (status?.statusLedger?.handoff?.writesExternalSystem && status?.statusLedger?.handoff?.localOnly) {
    diagnostics.push(Object.freeze({ level: "error", code: "recovery.status-ledger.write-local-conflict" }));
  }
  if (status?.resumeManifest?.provided === true && status.resumeManifest.accepted !== true && status?.resume?.available === true) {
    diagnostics.push(Object.freeze({
      level: "warning",
      code: "recovery.resume-manifest.not-accepted-with-resume",
      message: "Recovery resume is available but the literal resume manifest is not accepted.",
      recovery: status.resumeManifest.nextAction ?? "repair_literal_resume_manifest",
    }));
  }
  if (status?.resumeManifest?.provided === true && status.resumeManifest.checkpoint && status?.resume?.fromCheckpoint
    && status.resumeManifest.checkpoint !== status.resume.fromCheckpoint) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.resume-manifest.checkpoint-mismatch",
      message: "Literal resume manifest checkpoint must match the recovery resume checkpoint.",
      recovery: "reconcile_literal_recovery_resume_checkpoint",
    }));
  }
  return Object.freeze({
    ok: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    diagnostics: Object.freeze(diagnostics),
  });
}

function buildRecoveryPreviewAcceptanceSummary(recovery, clientHandoff, lifecyclePlan, resumeManifest, providerHandoffReport) {
  const previewRows = Object.freeze((clientHandoff.preview?.rows ?? []).map((row, index) => Object.freeze({
    schema: "aios.recovery.preview-acceptance-row.v1",
    order: index + 1,
    source: "preview",
    subject: row.code,
    state: row.displayState === "blocked" ? "blocked" : row.displayState === "review" ? "review" : "ready",
    patchAvailable: row.patchAvailable === true,
    restartSafe: row.displayState !== "blocked",
    localOnly: true,
    writesExternalSystem: false,
    nextAction: row.nextAction,
  })));
  const lifecycleRows = Object.freeze((lifecyclePlan.commands ?? []).map((command, index) => Object.freeze({
    schema: "aios.recovery.preview-acceptance-row.v1",
    order: previewRows.length + index + 1,
    source: "lifecycle",
    subject: command.command,
    state: command.enabled ? "ready" : "suppressed",
    patchAvailable: false,
    restartSafe: command.enabled ? command.restartSafe === true : true,
    localOnly: command.localOnly !== false,
    writesExternalSystem: command.writesExternalSystem === true,
    nextAction: command.nextAction,
  })));
  const manifestRow = Object.freeze({
    schema: "aios.recovery.preview-acceptance-row.v1",
    order: previewRows.length + lifecycleRows.length + 1,
    source: "resume-manifest",
    subject: resumeManifest.checkpoint || "recovery:resume",
    state: resumeManifest.provided === false ? "suppressed" : resumeManifest.accepted ? "ready" : "blocked",
    patchAvailable: false,
    restartSafe: resumeManifest.accepted !== false,
    localOnly: true,
    writesExternalSystem: false,
    nextAction: resumeManifest.nextAction ?? "review_recovery_resume_manifest",
  });
  const providerRows = Object.freeze((providerHandoffReport.rows ?? []).map((row, index) => Object.freeze({
    schema: "aios.recovery.preview-acceptance-row.v1",
    order: previewRows.length + lifecycleRows.length + index + 2,
    source: "provider",
    subject: `${row.source}:${row.subject}`,
    state: row.state,
    patchAvailable: false,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.nextAction,
  })));
  const rows = Object.freeze([...previewRows, ...lifecycleRows, manifestRow, ...providerRows]);
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const repairableRows = rows.filter((row) => row.patchAvailable);
  const state = blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0 || recovery.summary.warnings > 0 ? "review" : "ready";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (repairableRows.length > 0 ? "accept_recovery_patch_preview" : "accept_recovery_preview");

  return Object.freeze({
    schema: "aios.recovery.preview-acceptance-summary.v1",
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      preview: previewRows.length,
      lifecycle: lifecycleRows.length,
      providers: providerRows.length,
      repairable: repairableRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    validationSummary: Object.freeze({
      errors: recovery.summary.errors + blockedRows.length,
      warnings: recovery.summary.warnings + reviewRows.length,
      accepted: blockedRows.length === 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      nextAction,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0 && clientHandoff.acceptedForRuntime === true,
      acceptedForExternalWrite: blockedRows.length === 0 && rows.some((row) => row.writesExternalSystem),
      requiresOperatorAcceptance: recovery.summary.errors > 0 || repairableRows.length > 0,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: providerHandoffReport.handoff?.checkpoint ?? "",
      statusChannel: providerHandoffReport.handoff?.statusChannel ?? clientHandoff.statusChannel,
      localOnly: rows.every((row) => row.localOnly !== false),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

export function validateAiosRecoveryClientSession(session = {}) {
  const diagnostics = [];
  const schema = compact(session.schema);
  const acceptance = session.acceptance ?? {};
  const recovery = session.recovery ?? {};
  const replay = session.replay ?? {};
  const clientState = session.clientState ?? {};
  const status = session.status ?? {};
  const commandQueue = Array.from(session.commandQueue ?? []);
  const blockers = Array.from(acceptance.blockedBy ?? []).map(compact).filter(Boolean);
  const missingKeys = Array.from(clientState.missingKeys ?? []).map(compact).filter(Boolean);
  const duplicateIds = [];
  const seenIds = new Set();
  const duplicateIdempotency = [];
  const seenIdempotency = new Set();

  if (schema !== "aios.symbol-table.client-runtime-session.v1") {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.schema.invalid",
      message: "Client runtime session must use the symbol-table runtime session schema.",
      recovery: "rebuild_mailchimp_client_runtime_session",
    }));
  }
  if (!compact(session.sessionId)) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.id.missing",
      message: "Client runtime session requires a deterministic session id.",
      recovery: "persist_mailchimp_client_session_id",
    }));
  }
  if (!compact(clientState.stateKey)) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.state-key.missing",
      message: "Client runtime session requires a persisted client state key.",
      recovery: "persist_mailchimp_client_state_key",
    }));
  }
  if (!compact(status.statusChannel)) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.status-channel.missing",
      message: "Client runtime session requires a status channel for user-visible handoff.",
      recovery: "bind_mailchimp_status_channel",
    }));
  }
  if (!compact(status.checkpoint)) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.checkpoint.missing",
      message: "Client runtime session requires a checkpoint for restart-safe replay.",
      recovery: "bind_mailchimp_session_checkpoint",
    }));
  }
  if (acceptance.acceptedForRuntime === true && blockers.length > 0) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.accepted-with-blockers",
      message: "Client runtime session cannot be accepted while blockers remain.",
      recovery: acceptance.nextAction || "repair_mailchimp_client_session_blockers",
    }));
  }
  if (acceptance.acceptedForRuntime === true && missingKeys.length > 0) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.accepted-with-missing-state",
      message: "Client runtime session cannot be accepted before required client state is hydrated.",
      recovery: "hydrate_mailchimp_client_state",
    }));
  }
  if (acceptance.acceptedForExternalWrite === true && status.localOnly === true) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.external-write-local-conflict",
      message: "Client runtime session cannot accept external write while marked local-only.",
      recovery: "reconcile_mailchimp_external_write_session",
    }));
  }
  if (replay.resumeAvailable === true && !compact(replay.resumeToken)) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.resume-token.missing",
      message: "Restart-safe client runtime session requires a resume token.",
      recovery: "persist_mailchimp_resume_token",
    }));
  }
  if (commandQueue.length === 0 && acceptance.acceptedForRuntime === true) {
    diagnostics.push(Object.freeze({
      level: "warning",
      code: "recovery.client-session.queue.empty",
      message: "Accepted client runtime session has no commands to replay.",
      recovery: "review_mailchimp_client_session_queue",
    }));
  }

  for (const command of commandQueue) {
    const id = compact(command.id);
    const idempotencyKey = compact(command.idempotencyKey);
    if (!id) {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "recovery.client-session.command.id.missing",
        message: "Every queued client command needs a stable id.",
        recovery: "rebuild_mailchimp_client_command_ids",
      }));
    } else if (seenIds.has(id)) {
      duplicateIds.push(id);
    }
    seenIds.add(id);

    if (!idempotencyKey) {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "recovery.client-session.command.idempotency.missing",
        message: `Queued client command "${id || "unknown"}" is missing an idempotency key.`,
        recovery: "persist_mailchimp_command_idempotency",
      }));
    } else if (seenIdempotency.has(idempotencyKey)) {
      duplicateIdempotency.push(idempotencyKey);
    }
    seenIdempotency.add(idempotencyKey);

    if (acceptance.acceptedForRuntime === true && command.restartSafe !== true) {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "recovery.client-session.command.unsafe",
        message: `Queued client command "${id || "unknown"}" is not restart safe.`,
        recovery: command.nextAction || "hold_mailchimp_client_replay",
      }));
    }
    if (command.writesExternalSystem === true && status.writesExternalSystem !== true) {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "recovery.client-session.command.external-write-conflict",
        message: `Queued client command "${id || "unknown"}" writes externally but the session does not allow external writes.`,
        recovery: "reconcile_mailchimp_external_write_session",
      }));
    }
  }

  for (const id of Array.from(new Set(duplicateIds)).sort()) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "recovery.client-session.command.id.duplicate",
      message: `Queued client command id "${id}" is duplicated.`,
      recovery: "dedupe_mailchimp_client_commands",
    }));
  }
  for (const key of Array.from(new Set(duplicateIdempotency)).sort()) {
    diagnostics.push(Object.freeze({
      level: "warning",
      code: "recovery.client-session.command.idempotency.duplicate",
      message: `Queued client command idempotency key "${key}" is reused.`,
      recovery: "review_mailchimp_command_idempotency",
    }));
  }

  return Object.freeze({
    ok: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    diagnostics: Object.freeze(diagnostics),
    summary: Object.freeze({
      errors: diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
      warnings: diagnostics.filter((diagnostic) => diagnostic.level === "warning").length,
      blockers: blockers.length,
      missingClientState: missingKeys.length,
      queuedCommands: commandQueue.length,
      nextAction: diagnostics[0]?.recovery ?? acceptance.nextAction ?? "adopt_mailchimp_client_runtime_session",
    }),
  });
}

export function mergeRecoveryDiagnostics(...diagnosticSets) {
  const merged = diagnosticSets.flatMap((set) => Array.from(set ?? []));
  return Object.freeze(merged.map(stableDiagnostic));
}

export function errorRecoverySelfCheck() {
  const status = buildAiosRecoveryStatus([{ code: "AIOS_LITERAL_STRING_UNTERMINATED", severity: "error", line: 1, column: 5 }]);
  const validation = validateAiosRecoveryStatus(status);
  return Object.freeze({
    ok: validation.ok
      && status.state === "recovering"
      && status.nextAction === "close_string"
      && status.providerContract.capabilities.negotiated === true
      && status.persistence.commands.some((command) => command.action === "close_string")
      && status.resume.available === true
      && status.clientHandoff.preview.rows.length === 1
      && status.externalHandoff.state === "ready"
      && status.statusLedger.handoff.ready === true
      && status.providerHandoffReport.handoff.ready === true
      && status.previewAcceptanceSummary.handoff.ready === false
      && status.previewAcceptanceSummary.counters.preview === status.clientHandoff.preview.rows.length
      && status.previewAcceptanceSummary.handoff.nextAction === "attach_literal_resume_manifest"
      && status.restartDigest.provided === false
      && status.handoff.restartDigestAccepted === false
      && status.lifecyclePlan.retry.available === true
      && status.lifecyclePlan.commands.some((command) => command.command === "schedule_recovery_retry")
      && status.controlIntentAcceptance.handoff.ready === true
      && status.controlIntentAcceptance.counters.lifecycleRows === status.lifecyclePlan.commands.length
      && status.incidentLifecycle.handoff.ready === true
      && status.incidentLifecycle.state === "empty",
    state: status.state,
    nextAction: status.nextAction,
    replayState: status.persistence.replayState,
    clientHandoff: status.clientHandoff.handoffId,
    diagnostics: validation.diagnostics,
  });
}
