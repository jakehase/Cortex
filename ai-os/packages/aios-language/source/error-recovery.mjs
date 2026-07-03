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
  if (diagnostic.severity === "warning") return "review_warning";
  return "hold_for_operator";
}

function recoveryPhase(action) {
  if (action.includes("literal") || action.startsWith("close_") || action.startsWith("insert_")) return "source";
  if (action.includes("comment")) return "source-comment";
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
    userVisibleWorkflow: Object.freeze({
      routeName: clientHandoff.routeName,
      preview: clientHandoff.preview,
      acceptance: clientHandoff.acceptance,
      commands: clientHandoff.commands,
      nextSteps: clientHandoff.nextStepQueue,
      nextAction: clientHandoff.nextAction,
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
    }),
  });
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
  return Object.freeze({
    ok: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    diagnostics: Object.freeze(diagnostics),
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
      && status.clientHandoff.preview.rows.length === 1,
    state: status.state,
    nextAction: status.nextAction,
    replayState: status.persistence.replayState,
    clientHandoff: status.clientHandoff.handoffId,
    diagnostics: validation.diagnostics,
  });
}
