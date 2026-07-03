export const surfaceId = "aios_kernel-lifecycle_panic-stop_003";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "panic-stop";

const SYSTEM_TENANT = "system";
const GLOBAL_WORKSPACE = "global";
const MAX_RETRY_ATTEMPTS = 5;
const MAX_HISTORY_EVENTS = 50;
const MAX_EXPORT_TIMELINE_EVENTS = 25;
const ANALYTICS_EXPORT_FORMATS = new Set(["json", "ndjson", "csv"]);
const PROOF_MODES = new Set(["audit-log", "audit-log-and-ledger", "local-proof-only"]);
const MIN_SCHEDULE_DELAY_MS = 1000;
const MAX_SCHEDULE_DELAY_MS = 15 * 60 * 1000;
const BASE_RETRY_BACKOFF_MS = 500;
const MAX_RETRY_BACKOFF_MS = 30000;
const MAX_PROVIDER_SYNC_STALENESS_MS = 5 * 60 * 1000;
const DEFAULT_ACCEPTANCE_PREVIEW_TTL_MS = 90 * 1000;
const HIGH_RISK_ACCEPTANCE_PREVIEW_TTL_MS = 30 * 1000;
const FAST_RETRY_BACKOFF_MS = 1500;
const OPERATOR_REPAIR_BACKOFF_MS = 45000;
const PERSISTENCE_SCHEMA = "aios.kernelLifecycle.panicStop.persistedState.v1";
const PANIC_STOP_ROLES = new Set(["kernel-admin", "incident-commander", "tenant-owner"]);
const READ_ONLY_ROLES = new Set(["auditor", "observer"]);
const LIFECYCLE_COMMANDS = new Set(["arm", "commit", "schedule", "cancel-scheduled", "enable", "disable"]);
const TERMINAL_PERSISTED_STATES = new Set([
  "panic-stop-committed",
  "panic-stop-controls-enabled",
  "panic-stop-controls-disabled",
  "panic-stop-schedule-cancelled"
]);
const PROVIDER_COMPLETION_STATES = new Set(["acked", "completed", "proof-emitted", "schedule-written", "schedule-deleted"]);
const HAZARD_KINDS = new Set(["unsafe-job", "runaway-worker", "external-write-risk"]);
const HAZARD_SEVERITIES = new Set(["info", "warning", "critical"]);
const RECEIPT_TRUST_FAILURE_ACTIONS = Object.freeze({
  receipt_command_mismatch: "query_provider_by_idempotency_key",
  receipt_external_state_mismatch: "query_provider_external_state_before_finalizing",
  receipt_scope_mismatch: "quarantine_cross_scope_provider_receipt",
  receipt_proof_mismatch: "reemit_or_link_expected_audit_proof",
  receipt_ack_generation_behind: "await_provider_ack_before_finalizing",
  receipt_not_completed: "resume_or_dispatch_provider_command"
});
const REQUIRED_DEPENDENCIES = Object.freeze([
  "scheduler-gate",
  "hosted-kernel-registry",
  "tenant-incident-ledger",
  "kernel-audit-log"
]);
const PROVIDER_CONTRACTS = Object.freeze({
  "scheduler-gate": Object.freeze({
    version: "aios.provider.schedulerGate.panicStop.v1",
    requiredCapabilities: Object.freeze(["admission.close", "admission.guard", "schedule.write", "schedule.delete"]),
    handoffKind: "scheduler_admission"
  }),
  "hosted-kernel-registry": Object.freeze({
    version: "aios.provider.hostedKernelRegistry.panicStop.v1",
    requiredCapabilities: Object.freeze(["kernel.stop", "kernel.arm", "settings.write", "state.read"]),
    handoffKind: "kernel_registry"
  }),
  "tenant-incident-ledger": Object.freeze({
    version: "aios.provider.tenantIncidentLedger.panicStop.v1",
    requiredCapabilities: Object.freeze(["incident.append", "incident.linkEvidence"]),
    handoffKind: "incident_ledger"
  }),
  "kernel-audit-log": Object.freeze({
    version: "aios.provider.kernelAuditLog.panicStop.v1",
    requiredCapabilities: Object.freeze(["audit.append", "proof.emit"]),
    handoffKind: "audit_proof"
  })
});
const COMMAND_PROVIDER_CAPABILITIES = Object.freeze({
  arm: Object.freeze({
    "hosted-kernel-registry": Object.freeze(["kernel.arm", "state.read"]),
    "tenant-incident-ledger": Object.freeze(["incident.append", "incident.linkEvidence"]),
    "kernel-audit-log": Object.freeze(["audit.append", "proof.emit"])
  }),
  commit: Object.freeze({
    "scheduler-gate": Object.freeze(["admission.close"]),
    "hosted-kernel-registry": Object.freeze(["kernel.stop", "state.read"]),
    "tenant-incident-ledger": Object.freeze(["incident.append", "incident.linkEvidence"]),
    "kernel-audit-log": Object.freeze(["audit.append", "proof.emit"])
  }),
  schedule: Object.freeze({
    "scheduler-gate": Object.freeze(["schedule.write", "admission.guard"]),
    "tenant-incident-ledger": Object.freeze(["incident.append"]),
    "kernel-audit-log": Object.freeze(["audit.append", "proof.emit"])
  }),
  "cancel-scheduled": Object.freeze({
    "scheduler-gate": Object.freeze(["schedule.delete"]),
    "kernel-audit-log": Object.freeze(["audit.append", "proof.emit"])
  }),
  enable: Object.freeze({
    "hosted-kernel-registry": Object.freeze(["settings.write", "state.read"]),
    "kernel-audit-log": Object.freeze(["audit.append", "proof.emit"])
  }),
  disable: Object.freeze({
    "hosted-kernel-registry": Object.freeze(["settings.write", "state.read"]),
    "kernel-audit-log": Object.freeze(["audit.append", "proof.emit"])
  })
});
const HAZARD_PROVIDER_CAPABILITIES = Object.freeze({
  "scheduler-gate": Object.freeze({
    unsafeJobTargets: Object.freeze(["admission.guard"]),
    runawayWorkerTargets: Object.freeze(["admission.guard"]),
    externalWriteRisk: Object.freeze(["admission.close", "admission.guard"])
  }),
  "hosted-kernel-registry": Object.freeze({
    unsafeJobTargets: Object.freeze(["kernel.stop", "state.read"]),
    runawayWorkerTargets: Object.freeze(["kernel.stop", "state.read"]),
    externalWriteRisk: Object.freeze(["settings.write", "state.read"])
  }),
  "tenant-incident-ledger": Object.freeze({
    unsafeJobTargets: Object.freeze(["incident.append", "incident.linkEvidence"]),
    runawayWorkerTargets: Object.freeze(["incident.append", "incident.linkEvidence"]),
    externalWriteRisk: Object.freeze(["incident.append", "incident.linkEvidence"])
  }),
  "kernel-audit-log": Object.freeze({
    unsafeJobTargets: Object.freeze(["audit.append", "proof.emit"]),
    runawayWorkerTargets: Object.freeze(["audit.append", "proof.emit"]),
    externalWriteRisk: Object.freeze(["audit.append", "proof.emit"])
  })
});
const DEFAULT_SCOPE = Object.freeze({
  tenantId: SYSTEM_TENANT,
  workspaceId: GLOBAL_WORKSPACE
});

function cleanText(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function cleanList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => cleanText(item, "")).filter(Boolean))];
}

function cleanPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function cleanBoolean(value, fallback) {
  if (value === true || value === false) {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

function cleanTimestamp(value, fallback = null) {
  const text = cleanText(value, null);
  if (!text) {
    return fallback;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function cleanRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeLifecycleCommand(input = {}) {
  const raw = cleanText(input.lifecycleCommand ?? input.command ?? input.intent, "commit");
  const aliases = {
    "panic-stop": "commit",
    "panic_stop": "commit",
    "stop-now": "commit",
    "schedule-stop": "schedule",
    "cancel": "cancel-scheduled",
    "resume-admission": "enable",
    "pause-admission": "disable"
  };
  const command = aliases[raw] ?? raw;

  return {
    command: LIFECYCLE_COMMANDS.has(command) ? command : "unsupported",
    requestedCommand: raw,
    recognized: LIFECYCLE_COMMANDS.has(command)
  };
}

function normalizeLifecycleSettings(input = {}) {
  const source = input.lifecycleSettings && typeof input.lifecycleSettings === "object"
    ? input.lifecycleSettings
    : {};

  const proofMode = cleanText(source.proofMode ?? input.proofMode, "audit-log");

  return {
    controlsEnabled: cleanBoolean(source.controlsEnabled ?? input.controlsEnabled, true),
    panicStopEnabled: cleanBoolean(source.panicStopEnabled ?? input.panicStopEnabled, true),
    schedulingEnabled: cleanBoolean(source.schedulingEnabled ?? input.schedulingEnabled, true),
    requireDualControl: cleanBoolean(source.requireDualControl ?? input.requireDualControl, false),
    proofMode: PROOF_MODES.has(proofMode) ? proofMode : "audit-log",
    scheduleWindowMs: Math.min(
      MAX_SCHEDULE_DELAY_MS,
      Math.max(MIN_SCHEDULE_DELAY_MS, cleanPositiveInteger(source.scheduleWindowMs ?? input.scheduleWindowMs, MAX_SCHEDULE_DELAY_MS))
    )
  };
}

function normalizeLifecycleSettingsMutation({ input = {}, lifecycleCommand, lifecycleSettings, persistedState, scheduleRequest, now }) {
  const source = cleanRecord(input.settingsDelta ?? input.requestedSettingsDelta ?? input.lifecycleSettingsPatch);
  const settingsCommand = ["enable", "disable"].includes(lifecycleCommand.command);
  const requestedPatch = {};
  const rejectedFields = [];
  const activeSchedule = persistedState.scheduledStop.status === "scheduled"
    && Boolean(persistedState.scheduledStop.scheduledFor);
  const knownFields = new Set([
    "controlsEnabled",
    "panicStopEnabled",
    "schedulingEnabled",
    "requireDualControl",
    "proofMode",
    "scheduleWindowMs"
  ]);

  for (const field of Object.keys(source)) {
    if (!knownFields.has(field)) {
      rejectedFields.push({
        field: `settingsDelta.${field}`,
        code: "unknown_settings_field",
        message: "Panic-stop settings mutation contains an unsupported field."
      });
    }
  }

  if (settingsCommand) {
    const defaultPatch = lifecycleCommand.command === "enable"
      ? { controlsEnabled: true, panicStopEnabled: true }
      : { panicStopEnabled: false };

    for (const [field, value] of Object.entries({ ...defaultPatch, ...source })) {
      if (["controlsEnabled", "panicStopEnabled", "schedulingEnabled", "requireDualControl"].includes(field)) {
        const parsed = cleanBoolean(value, null);
        if (parsed === null) {
          rejectedFields.push({
            field: `settingsDelta.${field}`,
            code: "invalid_boolean_setting",
            message: "Panic-stop boolean settings must be true or false."
          });
        } else {
          requestedPatch[field] = parsed;
        }
      }

      if (field === "proofMode") {
        const proofMode = cleanText(value, null);
        if (!PROOF_MODES.has(proofMode)) {
          rejectedFields.push({
            field: "settingsDelta.proofMode",
            code: "invalid_proof_mode",
            message: "Panic-stop proof mode is not supported for hosted-kernel audit output."
          });
        } else {
          requestedPatch.proofMode = proofMode;
        }
      }

      if (field === "scheduleWindowMs") {
        const requestedWindow = cleanPositiveInteger(value, 0);
        if (requestedWindow < MIN_SCHEDULE_DELAY_MS || requestedWindow > MAX_SCHEDULE_DELAY_MS) {
          rejectedFields.push({
            field: "settingsDelta.scheduleWindowMs",
            code: "invalid_schedule_window",
            message: "Panic-stop schedule window must stay inside the hosted-kernel safety bounds."
          });
        } else {
          requestedPatch.scheduleWindowMs = requestedWindow;
        }
      }
    }
  }

  const effectiveSettings = {
    ...lifecycleSettings,
    ...requestedPatch
  };
  const parsedNow = Date.parse(now);
  const parsedScheduledFor = Date.parse(persistedState.scheduledStop.scheduledFor);
  const activeScheduleDelayMs = Number.isFinite(parsedNow) && Number.isFinite(parsedScheduledFor)
    ? Math.max(0, parsedScheduledFor - parsedNow)
    : null;
  const activeScheduleOutsideWindow = activeSchedule
    && activeScheduleDelayMs !== null
    && activeScheduleDelayMs > effectiveSettings.scheduleWindowMs;
  const disablesActiveSchedule = activeSchedule
    && (effectiveSettings.panicStopEnabled === false || effectiveSettings.schedulingEnabled === false);

  return {
    schema: "aios.kernelLifecycle.panicStop.lifecycleSettingsMutation.v1",
    command: lifecycleCommand.command,
    settingsCommand,
    requestedPatch,
    rejectedFields,
    effectiveSettings,
    activeSchedule: {
      present: activeSchedule,
      scheduleId: activeSchedule ? persistedState.scheduledStop.scheduleId : null,
      scheduledFor: activeSchedule ? persistedState.scheduledStop.scheduledFor : null,
      delayMs: activeScheduleDelayMs,
      outsideRequestedWindow: activeScheduleOutsideWindow
    },
    guardrails: {
      disablesActiveSchedule,
      scheduleRequestInsideWindow: lifecycleCommand.command !== "schedule"
        || (scheduleRequest.delayMs >= MIN_SCHEDULE_DELAY_MS && scheduleRequest.delayMs <= effectiveSettings.scheduleWindowMs),
      proofModeAllowed: PROOF_MODES.has(effectiveSettings.proofMode),
      controlsRemainReachable: effectiveSettings.controlsEnabled || requestedPatch.controlsEnabled === true
    },
    providerWrite: {
      required: settingsCommand && Object.keys(requestedPatch).length > 0,
      providerName: "hosted-kernel-registry",
      capability: "settings.write",
      expectedSchema: "aios.provider.hostedKernelRegistry.panicStop.settingsPatch.v1"
    },
    nextAction: rejectedFields.length > 0
      ? "repair_settings_patch"
      : disablesActiveSchedule
        ? "cancel_schedule_before_disabling_controls"
        : activeScheduleOutsideWindow
          ? "extend_schedule_window_or_cancel_existing_schedule"
          : settingsCommand
            ? "persist_settings_patch_with_audit_proof"
            : "no_settings_write_required"
  };
}

function normalizeScheduleRequest({ input, now }) {
  const parsedRequestedAt = Date.parse(now);
  const requestedAt = Number.isFinite(parsedRequestedAt) ? parsedRequestedAt : Date.now();
  const scheduledAtValue = cleanText(input.scheduledFor ?? input.scheduleAt ?? input.scheduledAt, null);
  const scheduledAt = scheduledAtValue ? Date.parse(scheduledAtValue) : null;
  const explicitDelayMs = input.delayMs ?? input.scheduleDelayMs;
  const delayMs = Number.isFinite(scheduledAt)
    ? scheduledAt - requestedAt
    : explicitDelayMs === undefined
      ? 0
      : cleanPositiveInteger(explicitDelayMs, 0);

  return {
    requestedAt: now,
    scheduledFor: Number.isFinite(scheduledAt)
      ? new Date(scheduledAt).toISOString()
      : delayMs > 0
        ? new Date(requestedAt + delayMs).toISOString()
        : null,
    delayMs: Number.isFinite(delayMs) ? Math.max(0, Math.floor(delayMs)) : 0
  };
}

function normalizeClientRuntimeState(input = {}) {
  const source = cleanRecord(input.clientRuntimeState ?? input.clientState ?? input.requestClient);
  const request = cleanRecord(source.request ?? input.requestContext);
  const workflow = cleanRecord(source.workflow ?? input.workflowState);
  const ui = cleanRecord(source.ui ?? input.uiState);
  const lastKnownKernel = cleanRecord(source.lastKnownKernel ?? input.lastKnownKernelState);
  const optimisticCommand = cleanRecord(workflow.optimisticCommand ?? input.optimisticCommand);

  return {
    schema: "aios.kernelLifecycle.panicStop.clientRuntimeState.v1",
    clientId: cleanText(source.clientId ?? input.clientId, "unknown-client"),
    sessionId: cleanText(source.sessionId ?? input.sessionId, null),
    requestId: cleanText(request.requestId ?? input.requestId, null),
    requestSource: cleanText(request.source ?? input.requestSource, "operator-console"),
    requestedAt: cleanTimestamp(request.requestedAt ?? input.requestedAt),
    routeHint: cleanText(request.routeHint ?? input.routeHint, null),
    workflow: {
      workflowId: cleanText(workflow.workflowId ?? input.workflowId, null),
      step: cleanText(workflow.step ?? input.workflowStep, "review"),
      mode: cleanText(workflow.mode ?? input.workflowMode, "interactive"),
      resumeToken: cleanText(workflow.resumeToken ?? input.resumeToken, null),
      optimisticCommandKey: cleanText(optimisticCommand.commandKey ?? optimisticCommand.idempotencyKey, null),
      optimisticState: cleanText(optimisticCommand.state ?? optimisticCommand.lifecycleState, null),
      lastAcknowledgedProofId: cleanText(workflow.lastAcknowledgedProofId ?? input.lastAcknowledgedProofId, null)
    },
    ui: {
      surfacePath: cleanText(ui.surfacePath ?? input.surfacePath, "/kernel-lifecycle/panic-stop"),
      panelId: cleanText(ui.panelId ?? input.panelId, "panic-stop"),
      returnTo: cleanText(ui.returnTo ?? input.returnTo, null),
      locale: cleanText(ui.locale ?? input.locale, "en-US"),
      allowOptimisticUpdate: cleanBoolean(ui.allowOptimisticUpdate ?? input.allowOptimisticUpdate, false),
      requireOperatorConfirmation: cleanBoolean(ui.requireOperatorConfirmation ?? input.requireOperatorConfirmation, true)
    },
    lastKnownKernel: {
      lifecycleState: cleanText(lastKnownKernel.lifecycleState ?? lastKnownKernel.status, null),
      schedulerAdmission: cleanText(lastKnownKernel.schedulerAdmission, null),
      writeGeneration: cleanPositiveInteger(lastKnownKernel.writeGeneration, 0),
      proofId: cleanText(lastKnownKernel.proofId ?? lastKnownKernel.auditProofId, null),
      observedAt: cleanTimestamp(lastKnownKernel.observedAt ?? lastKnownKernel.updatedAt)
    }
  };
}

function normalizePersistedPanicStopState({ input, scope }) {
  const source = cleanRecord(
    input.persistedPanicStopState
      ?? input.persistedState
      ?? input.recoveredState
      ?? input.kernelLifecycleState
  );
  const scheduledStop = cleanRecord(source.scheduledStop ?? source.schedule);
  const lastCommand = cleanRecord(source.lastCommand ?? source.command);
  const proof = cleanRecord(source.proof ?? source.auditProof);
  const providerReceiptSource = cleanRecord(source.providerReceipts ?? source.providerResults);
  const providerCursors = Object.fromEntries(
    Object.entries(cleanRecord(source.providerCursors ?? source.providerSync)).map(([name, cursor]) => {
      const raw = cleanRecord(cursor);
      return [name, {
        externalStateId: cleanText(raw.externalStateId, `${name}:${surfaceId}`),
        scopeKey: cleanText(raw.scopeKey ?? raw.boundaryKey, null),
        tenantId: cleanText(raw.tenantId, null),
        workspaceId: cleanText(raw.workspaceId, null),
        syncCursor: cleanText(raw.syncCursor ?? raw.cursor, null),
        syncGeneration: cleanPositiveInteger(raw.syncGeneration ?? raw.generation, 0),
        lastSyncedAt: cleanText(raw.lastSyncedAt, null)
      }];
    })
  );
  const providerReceipts = Object.fromEntries(
    Object.entries(providerReceiptSource).map(([name, receipt]) => {
      const raw = cleanRecord(receipt);
      return [name, {
        providerName: cleanText(raw.providerName, name),
        commandKey: cleanText(raw.commandKey ?? raw.idempotencyKey, null),
        resultState: cleanText(raw.resultState ?? raw.status, "unknown"),
        externalStateId: cleanText(raw.externalStateId, providerCursors[name]?.externalStateId ?? `${name}:${surfaceId}`),
        scopeKey: cleanText(raw.scopeKey ?? raw.boundaryKey, providerCursors[name]?.scopeKey ?? null),
        tenantId: cleanText(raw.tenantId, providerCursors[name]?.tenantId ?? null),
        workspaceId: cleanText(raw.workspaceId, providerCursors[name]?.workspaceId ?? null),
        ackGeneration: cleanPositiveInteger(raw.ackGeneration ?? raw.generation, 0),
        proofId: cleanText(raw.proofId ?? raw.auditProofId, null),
        completedAt: cleanTimestamp(raw.completedAt ?? raw.ackedAt ?? raw.updatedAt),
        errorCode: cleanText(raw.errorCode ?? raw.failureCode, null)
      }];
    })
  );
  const persistedScopeKey = cleanText(
    source.scopeKey ?? source.boundaryKey,
    `${cleanText(source.tenantId, scope.tenantId)}:${cleanText(source.workspaceId, scope.workspaceId)}`
  );

  return {
    schema: PERSISTENCE_SCHEMA,
    stateId: cleanText(source.stateId ?? source.id, `${surfaceId}:${scope.boundaryKey}`),
    scopeKey: persistedScopeKey,
    scopeMatchesRequest: persistedScopeKey === scope.boundaryKey,
    tenantId: cleanText(source.tenantId, scope.tenantId),
    workspaceId: cleanText(source.workspaceId, scope.workspaceId),
    lifecycleState: cleanText(source.lifecycleState ?? source.status, "panic-stop-uninitialized"),
    schedulerAdmission: cleanText(source.schedulerAdmission, "unknown"),
    commitMode: cleanText(source.commitMode, "unknown"),
    restartGeneration: cleanPositiveInteger(source.restartGeneration ?? source.generation, 0),
    writeGeneration: cleanPositiveInteger(source.writeGeneration, 0),
    updatedAt: cleanText(source.updatedAt ?? source.persistedAt, null),
    recoveredAt: cleanText(source.recoveredAt, null),
    dirtyShutdown: cleanBoolean(source.dirtyShutdown ?? source.recoveryRequired, false),
    providerHandoffPending: cleanBoolean(source.providerHandoffPending ?? source.pendingProviderHandoff, false),
    panicStopArmed: cleanBoolean(source.panicStopArmed ?? source.armed, false),
    stopCommitted: cleanBoolean(source.stopCommitted ?? source.stopped, false),
    admissionClosed: cleanBoolean(source.admissionClosed, false),
    scheduledStop: {
      scheduleId: cleanText(scheduledStop.scheduleId ?? scheduledStop.id, null),
      scheduledFor: cleanText(scheduledStop.scheduledFor ?? scheduledStop.at, null),
      commandKey: cleanText(scheduledStop.commandKey ?? scheduledStop.idempotencyKey, null),
      status: cleanText(scheduledStop.status, "none")
    },
    lastCommand: {
      command: cleanText(lastCommand.command, null),
      commandKey: cleanText(lastCommand.commandKey ?? lastCommand.idempotencyKey, null),
      accepted: cleanBoolean(lastCommand.accepted, false),
      completed: cleanBoolean(lastCommand.completed, false),
      dispatchedAt: cleanText(lastCommand.dispatchedAt, null),
      completedAt: cleanText(lastCommand.completedAt, null),
      proofId: cleanText(lastCommand.proofId, null)
    },
    proof: {
      proofId: cleanText(proof.proofId ?? proof.id, null),
      proofCursor: cleanText(proof.proofCursor ?? proof.cursor, null),
      lastEmittedAt: cleanText(proof.lastEmittedAt ?? proof.emittedAt, null)
    },
    providerCursors,
    providerReceipts
  };
}

function buildPanicStopCommandKey({ actor, scope, lifecycleCommand, scheduleRequest, input }) {
  const explicit = cleanText(input.commandKey ?? input.idempotencyKey ?? input.requestId, null);
  if (explicit) {
    return explicit;
  }
  const commandTarget = lifecycleCommand.command === "schedule"
    ? scheduleRequest.scheduledFor
    : lifecycleCommand.command === "cancel-scheduled"
      ? cleanText(input.scheduleId ?? input.cancelScheduleId, "active-schedule")
      : "immediate";
  return [
    surfaceId,
    scope.boundaryKey,
    lifecycleCommand.command,
    commandTarget,
    actor.actorId
  ].join(":");
}

function buildPersistenceRecoveryState({
  now,
  input,
  actor,
  scope,
  lifecycleCommand,
  scheduleRequest,
  commandPlan,
  persistedState,
  externalHandoffState
}) {
  const commandKey = buildPanicStopCommandKey({
    actor,
    scope,
    lifecycleCommand,
    scheduleRequest,
    input
  });
  const previousCommandMatches = persistedState.scopeMatchesRequest
    && persistedState.lastCommand.commandKey === commandKey
    && persistedState.lastCommand.command === lifecycleCommand.command;
  const duplicateCompletedCommand = previousCommandMatches && persistedState.lastCommand.completed;
  const duplicateInFlightCommand = previousCommandMatches && !persistedState.lastCommand.completed;
  const scheduledCommandMatches = lifecycleCommand.command === "schedule"
    && persistedState.scheduledStop.commandKey === commandKey
    && persistedState.scheduledStop.status === "scheduled";
  const terminalStateAlreadyApplied = TERMINAL_PERSISTED_STATES.has(persistedState.lifecycleState)
    && previousCommandMatches;
  const recoveryRequired = persistedState.scopeMatchesRequest
    && (persistedState.dirtyShutdown || persistedState.providerHandoffPending || duplicateInFlightCommand);
  const providerCursorPatch = Object.fromEntries(externalHandoffState.providers.map((provider) => [
    provider.providerName,
    {
      externalStateId: provider.externalStateId,
      scopeKey: provider.scopeKey,
      tenantId: provider.tenantId,
      workspaceId: provider.workspaceId,
      syncCursor: provider.syncCursor,
      syncGeneration: provider.syncGeneration,
      lastSyncedAt: provider.lastSyncedAt
    }
  ]));
  const writeIntent = commandPlan.accepted && !duplicateCompletedCommand && !scheduledCommandMatches
    ? "persist_before_dispatch"
    : duplicateCompletedCommand || scheduledCommandMatches
      ? "read_existing_result"
      : "no_write_until_request_repaired";

  return {
    schema: "aios.kernelLifecycle.panicStop.persistenceRecovery.v1",
    stateStore: {
      provider: "hosted-kernel-registry",
      key: `${surfaceId}:${scope.boundaryKey}`,
      expectedSchema: PERSISTENCE_SCHEMA,
      compareAndSwapGeneration: persistedState.scopeMatchesRequest ? persistedState.writeGeneration : 0
    },
    commandKey,
    idempotency: {
      replaySafe: true,
      previousCommandMatches,
      duplicateCompletedCommand,
      duplicateInFlightCommand,
      terminalStateAlreadyApplied,
      scheduledCommandMatches,
      dispatchMode: duplicateCompletedCommand || scheduledCommandMatches
        ? "suppress_duplicate_dispatch"
        : duplicateInFlightCommand
          ? "resume_incomplete_dispatch"
          : commandPlan.accepted
            ? "dispatch_once_after_persist"
            : "no_dispatch"
    },
    recovery: {
      required: recoveryRequired,
      reason: !persistedState.scopeMatchesRequest
        ? "state_scope_mismatch_ignored"
        : persistedState.dirtyShutdown
          ? "dirty_shutdown_replay"
          : persistedState.providerHandoffPending
            ? "provider_handoff_pending"
            : duplicateInFlightCommand
              ? "matching_command_incomplete"
              : "none",
      nextAction: recoveryRequired
        ? "reconcile_persisted_state_before_new_dispatch"
        : duplicateCompletedCommand || scheduledCommandMatches
          ? "return_persisted_command_status"
          : commandPlan.nextAction,
      resumeProviderHandoffs: recoveryRequired ? externalHandoffState.providers.map((provider) => ({
        providerName: provider.providerName,
        externalStateId: provider.externalStateId,
        syncCursor: persistedState.providerCursors[provider.providerName]?.syncCursor ?? provider.syncCursor,
        syncGeneration: Math.max(
          persistedState.providerCursors[provider.providerName]?.syncGeneration ?? 0,
          provider.syncGeneration
        )
      })) : []
    },
    nextPersistedState: {
      schema: PERSISTENCE_SCHEMA,
      stateId: `${surfaceId}:${scope.boundaryKey}`,
      scopeKey: scope.boundaryKey,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      lifecycleState: commandPlan.accepted
        ? lifecycleCommand.command === "arm"
          ? "panic-stop-armed"
          : lifecycleCommand.command === "commit"
            ? "panic-stop-committed"
            : lifecycleCommand.command === "schedule"
              ? "panic-stop-scheduled"
              : lifecycleCommand.command === "cancel-scheduled"
                ? "panic-stop-schedule-cancelled"
                : lifecycleCommand.command === "enable"
                  ? "panic-stop-controls-enabled"
                  : "panic-stop-controls-disabled"
        : persistedState.lifecycleState,
      schedulerAdmission: lifecycleCommand.command === "commit" && commandPlan.accepted ? "closing" : persistedState.schedulerAdmission,
      commitMode: commandPlan.accepted ? "pending-provider-proof" : persistedState.commitMode,
      restartGeneration: persistedState.restartGeneration + (recoveryRequired ? 1 : 0),
      writeGeneration: persistedState.writeGeneration + (writeIntent === "persist_before_dispatch" ? 1 : 0),
      updatedAt: now,
      dirtyShutdown: false,
      providerHandoffPending: commandPlan.accepted && externalHandoffState.accepted && !duplicateCompletedCommand,
      panicStopArmed: persistedState.panicStopArmed || lifecycleCommand.command === "arm",
      stopCommitted: persistedState.stopCommitted || lifecycleCommand.command === "commit",
      admissionClosed: persistedState.admissionClosed || lifecycleCommand.command === "commit",
      scheduledStop: lifecycleCommand.command === "schedule" && commandPlan.accepted
        ? {
          scheduleId: `${surfaceId}:${scope.boundaryKey}:schedule:${scheduleRequest.scheduledFor}`,
          scheduledFor: scheduleRequest.scheduledFor,
          commandKey,
          status: "scheduled"
        }
        : lifecycleCommand.command === "cancel-scheduled" && commandPlan.accepted
          ? { ...persistedState.scheduledStop, status: "cancelled" }
          : persistedState.scheduledStop,
      lastCommand: {
        command: lifecycleCommand.command,
        commandKey,
        accepted: commandPlan.accepted,
        completed: duplicateCompletedCommand,
        dispatchedAt: duplicateCompletedCommand ? persistedState.lastCommand.dispatchedAt : null,
        completedAt: duplicateCompletedCommand ? persistedState.lastCommand.completedAt : null,
        proofId: duplicateCompletedCommand ? persistedState.lastCommand.proofId : null
      },
      proof: persistedState.proof,
      providerCursors: {
        ...persistedState.providerCursors,
        ...providerCursorPatch
      }
    },
    writeIntent,
    statusSemantics: {
      restartSafeStatus: duplicateCompletedCommand || terminalStateAlreadyApplied
        ? "already_applied"
        : recoveryRequired
          ? "recovery_pending"
          : commandPlan.accepted
            ? "pending_persisted_dispatch"
            : "blocked_not_persisted",
      userVisibleStatus: duplicateCompletedCommand || terminalStateAlreadyApplied
        ? "Panic-stop command already applied for this scope."
        : scheduledCommandMatches
          ? "Panic-stop is already scheduled for this scope."
          : recoveryRequired
            ? "Panic-stop state is being recovered before new dispatch."
            : commandPlan.accepted
              ? "Panic-stop command accepted and will be persisted before provider dispatch."
              : "Panic-stop command is blocked and no lifecycle state will be written."
    }
  };
}

function buildRestartSafeCommandJournal({
  now,
  actor,
  scope,
  lifecycleCommand,
  persistedState,
  persistenceRecoveryState,
  externalHandoffState,
  providerDispatchEnvelope
}) {
  const parsedUpdatedAt = Date.parse(persistedState.updatedAt);
  const parsedNow = Date.parse(now);
  const persistedAgeMs = Number.isFinite(parsedUpdatedAt) && Number.isFinite(parsedNow)
    ? Math.max(0, parsedNow - parsedUpdatedAt)
    : null;
  const providerCheckpoints = externalHandoffState.providers.map((provider) => {
    const persistedCursor = persistedState.providerCursors[provider.providerName] ?? {};
    const dispatchCommand = providerDispatchEnvelope.providerCommands.find((command) => {
      return command.providerName === provider.providerName;
    });
    const persistedGeneration = cleanPositiveInteger(persistedCursor.syncGeneration, 0);
    const observedGeneration = cleanPositiveInteger(provider.syncGeneration, 0);
    const ackGeneration = cleanPositiveInteger(provider.ackGeneration, 0);
    const dispatchHeld = dispatchCommand?.dispatchState !== "ready";
    const ackRequired = dispatchCommand?.payload?.providerRequiresAck === true;
    const ackPending = ackRequired && ackGeneration < observedGeneration;
    const generationBehind = persistedGeneration < observedGeneration;
    const generationAhead = persistedGeneration > observedGeneration;

    return {
      providerName: provider.providerName,
      externalStateId: provider.externalStateId,
      action: dispatchCommand?.action ?? providerDispatchAction({ providerName: provider.providerName, lifecycleCommand }),
      dispatchState: dispatchCommand?.dispatchState ?? "held",
      persistedCursor: cleanText(persistedCursor.syncCursor, null),
      observedCursor: provider.syncCursor,
      persistedGeneration,
      observedGeneration,
      ackGeneration,
      ackRequired,
      ackPending,
      generationBehind,
      generationAhead,
      restartResumeMode: generationAhead
        ? "refresh_provider_before_resuming"
        : ackPending
          ? "await_provider_ack"
          : dispatchHeld
            ? "hold_until_persistence_gate_opens"
            : generationBehind
              ? "write_cursor_after_dispatch"
              : "resume_from_checkpoint"
    };
  });
  const unresolvedProviders = providerCheckpoints.filter((checkpoint) => {
    return checkpoint.ackPending || checkpoint.generationAhead || checkpoint.dispatchState === "held";
  });
  const receiptState = persistenceRecoveryState.idempotency.duplicateCompletedCommand
    ? "completed_replay"
    : persistenceRecoveryState.recovery.required
      ? "recovery_required"
      : providerDispatchEnvelope.dispatchable
        ? "persisted_dispatch_ready"
        : persistenceRecoveryState.writeIntent === "persist_before_dispatch"
          ? "persist_pending"
          : "not_persisted";

  return {
    schema: "aios.kernelLifecycle.panicStop.restartSafeCommandJournal.v1",
    generatedAt: now,
    journalKey: `${surfaceId}:${scope.boundaryKey}:journal:${persistenceRecoveryState.commandKey}`,
    commandKey: persistenceRecoveryState.commandKey,
    command: lifecycleCommand.command,
    receipt: {
      state: receiptState,
      actorId: actor.actorId,
      accepted: persistenceRecoveryState.nextPersistedState.lastCommand.accepted,
      completed: persistenceRecoveryState.nextPersistedState.lastCommand.completed,
      persistedAgeMs,
      proofId: providerDispatchEnvelope.auditProofOutput.proofId,
      userVisibleStatus: persistenceRecoveryState.statusSemantics.userVisibleStatus
    },
    localCheckpoint: {
      stateStoreKey: persistenceRecoveryState.stateStore.key,
      schema: persistenceRecoveryState.stateStore.expectedSchema,
      compareAndSwapGeneration: persistenceRecoveryState.stateStore.compareAndSwapGeneration,
      nextWriteGeneration: persistenceRecoveryState.nextPersistedState.writeGeneration,
      writeIntent: persistenceRecoveryState.writeIntent,
      restartGeneration: persistenceRecoveryState.nextPersistedState.restartGeneration,
      providerHandoffPending: persistenceRecoveryState.nextPersistedState.providerHandoffPending
    },
    recoveryDecision: {
      restartSafeStatus: persistenceRecoveryState.statusSemantics.restartSafeStatus,
      required: persistenceRecoveryState.recovery.required,
      reason: persistenceRecoveryState.recovery.reason,
      nextAction: persistenceRecoveryState.recovery.nextAction,
      dispatchMode: persistenceRecoveryState.idempotency.dispatchMode,
      duplicateCompletedCommand: persistenceRecoveryState.idempotency.duplicateCompletedCommand,
      duplicateInFlightCommand: persistenceRecoveryState.idempotency.duplicateInFlightCommand,
      terminalStateAlreadyApplied: persistenceRecoveryState.idempotency.terminalStateAlreadyApplied
    },
    providerCheckpoints,
    restartStatus: {
      stable: unresolvedProviders.length === 0
        && !persistenceRecoveryState.recovery.required
        && receiptState !== "persist_pending",
      unresolvedProviderCount: unresolvedProviders.length,
      unresolvedProviders: unresolvedProviders.map((checkpoint) => ({
        providerName: checkpoint.providerName,
        restartResumeMode: checkpoint.restartResumeMode,
        ackPending: checkpoint.ackPending,
        generationAhead: checkpoint.generationAhead,
        dispatchState: checkpoint.dispatchState
      })),
      resumeCommand: unresolvedProviders.length > 0 || persistenceRecoveryState.recovery.required
        ? "resume_from_restart_safe_journal"
        : persistenceRecoveryState.idempotency.duplicateCompletedCommand
          ? "return_completed_receipt"
          : providerDispatchEnvelope.dispatchable
            ? "dispatch_from_persisted_checkpoint"
            : "wait_for_persistence_gate"
    }
  };
}

function evaluateProviderReceiptTruth({
  scope,
  command,
  persistedReceipt,
  providerCheckpoint,
  persistenceRecoveryState,
  providerDispatchEnvelope
}) {
  const expectedProofId = providerDispatchEnvelope.auditProofOutput.proofId;
  const expectedAckGeneration = cleanPositiveInteger(command.payload.syncGeneration, 0);
  const observedAckGeneration = cleanPositiveInteger(persistedReceipt.ackGeneration, 0);
  const receiptCommandMatches = persistedReceipt.commandKey === persistenceRecoveryState.commandKey;
  const receiptExternalStateMatches = !persistedReceipt.externalStateId
    || persistedReceipt.externalStateId === command.payload.externalStateId;
  const receiptScopeKey = cleanText(persistedReceipt.scopeKey, null);
  const receiptTenantId = cleanText(persistedReceipt.tenantId, null);
  const receiptWorkspaceId = cleanText(persistedReceipt.workspaceId, null);
  const receiptScopeMatches = (!receiptScopeKey || receiptScopeKey === scope.boundaryKey)
    && (!receiptTenantId || receiptTenantId === scope.tenantId)
    && (!receiptWorkspaceId || receiptWorkspaceId === scope.workspaceId);
  const completionObserved = receiptCommandMatches
    && PROVIDER_COMPLETION_STATES.has(persistedReceipt.resultState);
  const proofMatches = !persistedReceipt.proofId || persistedReceipt.proofId === expectedProofId;
  const ackSatisfied = command.payload.providerRequiresAck !== true
    || observedAckGeneration >= expectedAckGeneration
    || providerCheckpoint.ackPending === false;
  const trustFailures = [
    receiptCommandMatches ? null : "receipt_command_mismatch",
    receiptExternalStateMatches ? null : "receipt_external_state_mismatch",
    receiptScopeMatches ? null : "receipt_scope_mismatch",
    proofMatches ? null : "receipt_proof_mismatch",
    ackSatisfied ? null : "receipt_ack_generation_behind",
    completionObserved ? null : "receipt_not_completed"
  ].filter(Boolean);
  const trustedComplete = trustFailures.length === 0;
  const firstFailure = trustFailures[0] ?? null;

  return {
    schema: "aios.kernelLifecycle.panicStop.providerReceiptTruth.v1",
    providerName: command.providerName,
    expected: {
      commandKey: persistenceRecoveryState.commandKey,
      idempotencyKey: command.idempotencyKey,
      externalStateId: command.payload.externalStateId,
      scopeKey: scope.boundaryKey,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      proofId: expectedProofId,
      ackGeneration: expectedAckGeneration
    },
    observed: {
      commandKey: cleanText(persistedReceipt.commandKey, null),
      resultState: cleanText(persistedReceipt.resultState, "missing"),
      externalStateId: cleanText(persistedReceipt.externalStateId, null),
      scopeKey: receiptScopeKey,
      tenantId: receiptTenantId,
      workspaceId: receiptWorkspaceId,
      proofId: cleanText(persistedReceipt.proofId, null),
      ackGeneration: observedAckGeneration,
      completedAt: cleanText(persistedReceipt.completedAt, null),
      errorCode: cleanText(persistedReceipt.errorCode, null)
    },
    receiptCommandMatches,
    receiptExternalStateMatches,
    receiptScopeMatches,
    proofMatches,
    ackSatisfied,
    completionObserved,
    trustedComplete,
    trustFailures,
    repairAction: firstFailure ? RECEIPT_TRUST_FAILURE_ACTIONS[firstFailure] : "record_provider_receipt_complete"
  };
}

function buildRestartRecoveryProjection({
  now,
  scope,
  lifecycleCommand,
  persistedState,
  persistenceRecoveryState,
  restartSafeCommandJournal,
  providerDispatchEnvelope
}) {
  const expectedProviderNames = new Set(providerDispatchEnvelope.providerCommands.map((command) => command.providerName));
  const expectedReceipts = providerDispatchEnvelope.providerCommands.map((command) => {
    const persistedReceipt = persistedState.providerReceipts[command.providerName] ?? {};
    const providerCheckpoint = restartSafeCommandJournal.providerCheckpoints.find((checkpoint) => {
      return checkpoint.providerName === command.providerName;
    }) ?? {};
    const receiptTruth = evaluateProviderReceiptTruth({
      scope,
      command,
      persistedReceipt,
      providerCheckpoint,
      persistenceRecoveryState,
      providerDispatchEnvelope
    });
    const restartAction = receiptTruth.trustedComplete
      ? "record_provider_receipt_complete"
      : receiptTruth.trustFailures.includes("receipt_scope_mismatch")
        || receiptTruth.trustFailures.includes("receipt_external_state_mismatch")
        ? receiptTruth.repairAction
      : !receiptTruth.receiptCommandMatches && persistenceRecoveryState.idempotency.duplicateInFlightCommand
        ? "query_provider_by_idempotency_key"
      : providerCheckpoint.restartResumeMode === "await_provider_ack"
          ? "await_provider_ack_before_finalizing"
          : command.dispatchState === "ready"
            ? "dispatch_provider_command"
            : "hold_provider_command";

    return {
      providerName: command.providerName,
      action: command.action,
      expectedIdempotencyKey: command.idempotencyKey,
      externalStateId: command.payload.externalStateId,
      expectedProofId: providerDispatchEnvelope.auditProofOutput.proofId,
      expectedAckGeneration: command.payload.syncGeneration,
      observed: receiptTruth.observed,
      receiptCommandMatches: receiptTruth.receiptCommandMatches,
      receiptExternalStateMatches: receiptTruth.receiptExternalStateMatches,
      receiptScopeMatches: receiptTruth.receiptScopeMatches,
      proofMatches: receiptTruth.proofMatches,
      ackSatisfied: receiptTruth.ackSatisfied,
      completionObserved: receiptTruth.completionObserved,
      trustedComplete: receiptTruth.trustedComplete,
      trustFailures: receiptTruth.trustFailures,
      objectiveTruth: receiptTruth,
      restartAction
    };
  });
  const orphanedReceipts = Object.entries(persistedState.providerReceipts)
    .filter(([providerName]) => !expectedProviderNames.has(providerName))
    .map(([providerName, receipt]) => ({
      providerName,
      commandKey: receipt.commandKey,
      resultState: receipt.resultState,
      proofId: receipt.proofId,
      action: "retain_for_audit_do_not_replay"
    }));
  const incompleteReceipts = expectedReceipts.filter((receipt) => !receipt.trustedComplete);
  const untrustedReceiptCount = expectedReceipts.filter((receipt) => {
    return receipt.completionObserved && !receipt.trustedComplete;
  }).length;
  const receiptTrustFailures = [...new Set(expectedReceipts.flatMap((receipt) => receipt.trustFailures))];
  const finalizable = providerDispatchEnvelope.providerCommands.length > 0
    && incompleteReceipts.length === 0
    && !persistenceRecoveryState.recovery.required
    && persistenceRecoveryState.nextPersistedState.lastCommand.accepted;
  const commandCompleted = finalizable || persistenceRecoveryState.idempotency.duplicateCompletedCommand;

  return {
    schema: "aios.kernelLifecycle.panicStop.restartRecoveryProjection.v1",
    generatedAt: now,
    scopeKey: scope.boundaryKey,
    commandKey: persistenceRecoveryState.commandKey,
    command: lifecycleCommand.command,
    recoveryMode: persistenceRecoveryState.recovery.required
      ? "reconcile_before_dispatch"
      : commandCompleted
        ? "return_completed_status"
        : incompleteReceipts.length > 0
          ? "resume_provider_receipts"
          : providerDispatchEnvelope.dispatchable
            ? "dispatch_from_persisted_state"
            : "hold_until_persistence_ready",
    expectedReceiptCount: expectedReceipts.length,
    completedReceiptCount: expectedReceipts.length - incompleteReceipts.length,
    incompleteReceiptCount: incompleteReceipts.length,
    untrustedReceiptCount,
    receiptTrustFailures,
    orphanedReceiptCount: orphanedReceipts.length,
    expectedReceipts,
    orphanedReceipts,
    objectiveTruth: {
      schema: "aios.kernelLifecycle.panicStop.restartReceiptObjectiveTruth.v1",
      trusted: receiptTrustFailures.length === 0,
      trustedReceiptCount: expectedReceipts.length - incompleteReceipts.length,
      untrustedReceiptCount,
      failureCodes: receiptTrustFailures,
      finalizeRequiresTrustedProviderReceipts: true
    },
    finalizationPatch: {
      schema: PERSISTENCE_SCHEMA,
      stateId: persistenceRecoveryState.nextPersistedState.stateId,
      writeGeneration: commandCompleted
        ? Math.max(
          persistenceRecoveryState.nextPersistedState.writeGeneration,
          persistedState.writeGeneration + (persistenceRecoveryState.idempotency.duplicateCompletedCommand ? 0 : 1)
        )
        : persistenceRecoveryState.nextPersistedState.writeGeneration,
      providerHandoffPending: !commandCompleted && persistenceRecoveryState.nextPersistedState.providerHandoffPending,
      dirtyShutdown: false,
      lastCommand: {
        ...persistenceRecoveryState.nextPersistedState.lastCommand,
        completed: commandCompleted,
        completedAt: commandCompleted
          ? cleanText(persistenceRecoveryState.nextPersistedState.lastCommand.completedAt, now)
          : null,
        proofId: commandCompleted
          ? providerDispatchEnvelope.auditProofOutput.proofId
          : persistenceRecoveryState.nextPersistedState.lastCommand.proofId
      },
      proof: commandCompleted
        ? {
          proofId: providerDispatchEnvelope.auditProofOutput.proofId,
          proofCursor: `${surfaceId}:${scope.boundaryKey}:proof-cursor:${persistenceRecoveryState.commandKey}`,
          lastEmittedAt: now
        }
        : persistenceRecoveryState.nextPersistedState.proof
    },
    restartSafeStatus: commandCompleted
      ? "completed_restart_safe"
      : persistenceRecoveryState.statusSemantics.restartSafeStatus,
    nextAction: commandCompleted
      ? "emit_completed_receipt_without_dispatch"
      : untrustedReceiptCount > 0
        ? "repair_untrusted_provider_receipts_before_finalizing"
      : incompleteReceipts.length > 0
        ? "resume_or_query_incomplete_provider_receipts"
        : restartSafeCommandJournal.restartStatus.resumeCommand
  };
}

function splitPermissionScope(rawPermission) {
  const [capability, rawScope = ""] = cleanText(rawPermission, "").split("@");
  const [tenantPart, workspacePart] = rawScope.split(/[/:]/).map((part) => cleanText(part, null));

  return {
    capability: cleanText(capability, ""),
    tenantId: tenantPart,
    workspaceId: workspacePart
  };
}

function normalizePermissionGrant(rawPermission, index = 0) {
  const scoped = splitPermissionScope(rawPermission);
  const capabilityParts = scoped.capability.split(":").filter(Boolean);
  const tenantBoundCapability = capabilityParts[0] === "tenant" && capabilityParts.length >= 3;
  const workspaceBoundCapability = capabilityParts[0] === "workspace" && capabilityParts.length >= 4;

  return {
    grantId: `permission-${index + 1}`,
    raw: cleanText(rawPermission, ""),
    capability: tenantBoundCapability
      ? capabilityParts.slice(2).join(":")
      : workspaceBoundCapability
        ? capabilityParts.slice(3).join(":")
        : scoped.capability,
    tenantId: tenantBoundCapability
      ? cleanText(capabilityParts[1], scoped.tenantId)
      : workspaceBoundCapability
        ? cleanText(capabilityParts[1], scoped.tenantId)
        : scoped.tenantId,
    workspaceId: workspaceBoundCapability
      ? cleanText(capabilityParts[2], scoped.workspaceId)
      : scoped.workspaceId,
    scoped: Boolean(scoped.tenantId || tenantBoundCapability || workspaceBoundCapability),
    source: tenantBoundCapability
      ? "tenant_bound_capability"
      : workspaceBoundCapability
        ? "workspace_bound_capability"
        : scoped.tenantId
          ? "qualified_permission"
          : "global_permission"
  };
}

function permissionCapabilityMatches(grant, requiredCapability) {
  return grant.capability === requiredCapability
    || grant.capability === "kernel:*"
    || (requiredCapability.startsWith("tenant:") && grant.capability === "tenant:*")
    || grant.capability === "*";
}

function permissionScopeMatches(grant, scope) {
  const tenantMatches = !grant.tenantId || grant.tenantId === "*" || grant.tenantId === scope.tenantId;
  const workspaceMatches = !grant.workspaceId || grant.workspaceId === "*" || grant.workspaceId === scope.workspaceId;

  return tenantMatches && workspaceMatches;
}

function buildScopedPermissionProfile({ actor, scope, lifecycleCommand }) {
  const grants = actor.permissions.map((permission, index) => normalizePermissionGrant(permission, index));
  const commandCapability = ["enable", "disable"].includes(lifecycleCommand.command)
    ? "kernel:panic-stop:settings"
    : "kernel:panic-stop";
  const matchingCommandGrants = grants.filter((grant) => {
    if (!permissionScopeMatches(grant, scope)) {
      return false;
    }
    return permissionCapabilityMatches(grant, commandCapability)
      || permissionCapabilityMatches(grant, "kernel:panic-stop");
  });
  const tenantWildcardGrants = grants.filter((grant) => permissionScopeMatches(grant, scope) && grant.capability === "tenant:*");
  const kernelWildcardGrants = grants.filter((grant) => permissionScopeMatches(grant, scope) && grant.capability === "kernel:*");
  const settingsGrants = grants.filter((grant) => {
    return permissionScopeMatches(grant, scope)
      && (permissionCapabilityMatches(grant, "kernel:panic-stop:settings") || grant.capability === "kernel:*");
  });
  const scopedMismatches = grants
    .filter((grant) => grant.scoped && !permissionScopeMatches(grant, scope))
    .map((grant) => ({
      grantId: grant.grantId,
      capability: grant.capability,
      tenantId: grant.tenantId,
      workspaceId: grant.workspaceId
    }));

  return {
    schema: "aios.kernelLifecycle.panicStop.scopedPermissionProfile.v1",
    commandCapability,
    grants,
    matchingCommandGrants,
    settingsGrants,
    scopedMismatches,
    hasScopedCommandGrant: matchingCommandGrants.length > 0,
    hasTenantWildcard: tenantWildcardGrants.length > 0,
    hasKernelWildcard: kernelWildcardGrants.length > 0,
    hasSettingsAuthority: actor.roles.includes("kernel-admin") || settingsGrants.length > 0,
    proofClaims: {
      commandGrantIds: matchingCommandGrants.map((grant) => grant.grantId),
      settingsGrantIds: settingsGrants.map((grant) => grant.grantId),
      scopedMismatchCount: scopedMismatches.length,
      tenantWildcardGrantIds: tenantWildcardGrants.map((grant) => grant.grantId),
      kernelWildcardGrantIds: kernelWildcardGrants.map((grant) => grant.grantId)
    }
  };
}

function hasSettingsAuthority(actor, scope = null) {
  if (actor.roles.includes("kernel-admin")) {
    return true;
  }
  if (!scope) {
    return actor.permissions.includes("kernel:panic-stop:settings") || actor.permissions.includes("kernel:*");
  }
  return buildScopedPermissionProfile({
    actor,
    scope,
    lifecycleCommand: { command: "enable" }
  }).hasSettingsAuthority;
}

function normalizeScope(input = {}) {
  const requested = input.requestedScope && typeof input.requestedScope === "object"
    ? input.requestedScope
    : {};
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const tenantId = cleanText(requested.tenantId ?? input.tenantId ?? actor.tenantId, DEFAULT_SCOPE.tenantId);
  const workspaceId = cleanText(
    requested.workspaceId ?? input.workspaceId ?? actor.workspaceId,
    DEFAULT_SCOPE.workspaceId
  );
  return {
    tenantId,
    workspaceId,
    boundaryKey: `${tenantId}:${workspaceId}`
  };
}

function normalizeActor(input = {}) {
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  return {
    actorId: cleanText(actor.actorId ?? actor.id ?? input.actorId, "anonymous"),
    tenantId: cleanText(actor.tenantId ?? input.actorTenantId ?? input.tenantId, DEFAULT_SCOPE.tenantId),
    workspaceId: cleanText(actor.workspaceId ?? input.actorWorkspaceId ?? input.workspaceId, DEFAULT_SCOPE.workspaceId),
    roles: cleanList(actor.roles ?? input.roles),
    permissions: cleanList(actor.permissions ?? input.permissions)
  };
}

function normalizeDependencyHealth(input = {}) {
  const source = input.dependencyHealth && typeof input.dependencyHealth === "object"
    ? input.dependencyHealth
    : {};

  return REQUIRED_DEPENDENCIES.map((name) => {
    const raw = source[name] && typeof source[name] === "object" ? source[name] : {};
    const status = cleanText(raw.status, "unknown");
    const healthy = status === "healthy" || raw.ok === true;
    const degraded = status === "degraded";
    const unavailable = status === "unavailable" || status === "failed" || raw.ok === false;

    return {
      name,
      status: healthy ? "healthy" : degraded ? "degraded" : unavailable ? "unavailable" : "unknown",
      required: true,
      lastCheckedAt: cleanText(raw.lastCheckedAt, null),
      detail: cleanText(raw.detail, "")
    };
  });
}

function normalizeIntegrationProviders(input = {}) {
  const providerSource = input.integrationProviders && typeof input.integrationProviders === "object"
    ? input.integrationProviders
    : input.providerContracts && typeof input.providerContracts === "object"
      ? input.providerContracts
      : {};

  return Object.entries(PROVIDER_CONTRACTS).map(([name, contract]) => {
    const raw = providerSource[name] && typeof providerSource[name] === "object" ? providerSource[name] : {};
    const status = cleanText(raw.status, "configured");
    const capabilities = cleanList(raw.capabilities ?? raw.supportedCapabilities ?? contract.requiredCapabilities);
    const sync = raw.sync && typeof raw.sync === "object" ? raw.sync : {};
    const service = raw.service && typeof raw.service === "object" ? raw.service : {};
    const ack = sync.ack && typeof sync.ack === "object" ? sync.ack : {};

    return {
      name,
      contractVersion: cleanText(raw.contractVersion ?? raw.version, contract.version),
      handoffKind: contract.handoffKind,
      status: ["configured", "ready", "degraded", "readonly", "unavailable"].includes(status) ? status : "configured",
      endpointId: cleanText(raw.endpointId ?? raw.endpoint ?? raw.serviceId, name),
      capabilities,
      serviceContract: {
        serviceId: cleanText(service.serviceId ?? raw.serviceId, name),
        instanceId: cleanText(service.instanceId ?? raw.instanceId, null),
        region: cleanText(service.region ?? raw.region, "local"),
        durability: cleanText(service.durability ?? raw.durability, "best-effort"),
        acceptsExternalHandoff: cleanBoolean(service.acceptsExternalHandoff ?? raw.acceptsExternalHandoff, true),
        requiresAck: cleanBoolean(service.requiresAck ?? raw.requiresAck, name !== "kernel-audit-log")
      },
      sync: {
        cursor: cleanText(sync.cursor ?? raw.syncCursor, null),
        generation: cleanPositiveInteger(sync.generation ?? raw.syncGeneration, 0),
        lastSyncedAt: cleanTimestamp(sync.lastSyncedAt ?? raw.lastSyncedAt),
        externalStateId: cleanText(sync.externalStateId ?? raw.externalStateId, `${name}:${surfaceId}`),
        scopeKey: cleanText(sync.scopeKey ?? sync.boundaryKey ?? raw.scopeKey ?? raw.boundaryKey, null),
        tenantId: cleanText(sync.tenantId ?? raw.tenantId, null),
        workspaceId: cleanText(sync.workspaceId ?? raw.workspaceId, null),
        ackCursor: cleanText(ack.cursor ?? sync.ackCursor ?? raw.ackCursor, null),
        ackGeneration: cleanPositiveInteger(ack.generation ?? sync.ackGeneration ?? raw.ackGeneration, 0),
        lastAckedAt: cleanTimestamp(ack.lastAckedAt ?? sync.lastAckedAt ?? raw.lastAckedAt),
        leaseToken: cleanText(sync.leaseToken ?? raw.leaseToken, null),
        externalRevision: cleanText(sync.externalRevision ?? raw.externalRevision, null)
      }
    };
  });
}

function buildProviderBoundaryContract({ provider, persistedCursor, scope }) {
  const observedScopeKey = cleanText(
    provider.sync?.scopeKey ?? persistedCursor?.scopeKey,
    null
  );
  const observedTenantId = cleanText(
    provider.sync?.tenantId ?? persistedCursor?.tenantId,
    null
  );
  const observedWorkspaceId = cleanText(
    provider.sync?.workspaceId ?? persistedCursor?.workspaceId,
    null
  );
  const derivedScopeKey = observedScopeKey
    ?? (observedTenantId && observedWorkspaceId ? `${observedTenantId}:${observedWorkspaceId}` : null);
  const explicitBoundary = Boolean(derivedScopeKey || observedTenantId || observedWorkspaceId);
  const tenantMatches = !observedTenantId || observedTenantId === scope.tenantId;
  const workspaceMatches = !observedWorkspaceId || observedWorkspaceId === scope.workspaceId;
  const scopeKeyMatches = !derivedScopeKey || derivedScopeKey === scope.boundaryKey;
  const boundaryMatches = tenantMatches && workspaceMatches && scopeKeyMatches;
  const violationCodes = [
    !tenantMatches ? "provider_tenant_scope_mismatch" : null,
    !workspaceMatches ? "provider_workspace_scope_mismatch" : null,
    !scopeKeyMatches ? "provider_scope_key_mismatch" : null
  ].filter(Boolean);

  return {
    schema: "aios.kernelLifecycle.panicStop.providerBoundaryContract.v1",
    providerName: provider.name,
    requestedScopeKey: scope.boundaryKey,
    requestedTenantId: scope.tenantId,
    requestedWorkspaceId: scope.workspaceId,
    observedScopeKey: derivedScopeKey,
    observedTenantId,
    observedWorkspaceId,
    explicitBoundary,
    boundaryMatches,
    violationCodes,
    handoffBoundaryMode: !explicitBoundary
      ? "inherit_request_scope"
      : boundaryMatches
        ? "provider_scope_verified"
        : "quarantine_cross_scope_provider_state",
    auditClaim: boundaryMatches
      ? "provider_state_bound_to_requested_scope"
      : "provider_state_quarantined_for_scope_mismatch"
  };
}

function buildProviderSyncContract({ now, provider, persistedCursor, scope }) {
  const parsedNow = Date.parse(now);
  const parsedLastSyncedAt = Date.parse(provider.sync?.lastSyncedAt);
  const syncAgeMs = Number.isFinite(parsedNow) && Number.isFinite(parsedLastSyncedAt)
    ? Math.max(0, parsedNow - parsedLastSyncedAt)
    : null;
  const persistedGeneration = cleanPositiveInteger(persistedCursor?.syncGeneration, 0);
  const observedGeneration = cleanPositiveInteger(provider.sync?.generation, 0);
  const ackGeneration = cleanPositiveInteger(provider.sync?.ackGeneration, 0);
  const generationRegression = persistedGeneration > observedGeneration;
  const ackBehind = provider.serviceContract.requiresAck && ackGeneration < observedGeneration;
  const stale = syncAgeMs !== null && syncAgeMs > MAX_PROVIDER_SYNC_STALENESS_MS;
  const boundaryContract = buildProviderBoundaryContract({ provider, persistedCursor, scope });

  return {
    schema: "aios.kernelLifecycle.panicStop.providerSyncContract.v1",
    externalStateId: provider.sync?.externalStateId ?? `${provider.name}:${surfaceId}`,
    boundaryContract,
    boundaryViolation: !boundaryContract.boundaryMatches,
    observedCursor: provider.sync?.cursor ?? null,
    observedGeneration,
    persistedCursor: persistedCursor?.syncCursor ?? null,
    persistedGeneration,
    ackCursor: provider.sync?.ackCursor ?? null,
    ackGeneration,
    lastSyncedAt: provider.sync?.lastSyncedAt ?? null,
    lastAckedAt: provider.sync?.lastAckedAt ?? null,
    syncAgeMs,
    stale,
    generationRegression,
    ackBehind,
    leaseTokenPresent: Boolean(provider.sync?.leaseToken),
    externalRevision: provider.sync?.externalRevision ?? null,
    handoffSyncMode: !boundaryContract.boundaryMatches
      ? "quarantine_cross_scope_provider_state"
      : generationRegression
        ? "refresh_provider_before_dispatch"
        : stale
          ? "dispatch_with_reconcile_after_local_proof"
          : ackBehind
            ? "dispatch_requires_ack_checkpoint"
            : "dispatch_current_provider_state"
  };
}

function buildProviderHazardContract({ providerName, hazardAssessment }) {
  const providerRequirements = HAZARD_PROVIDER_CAPABILITIES[providerName] ?? {};
  const targetCounts = {
    unsafeJob: hazardAssessment.stopTargets.unsafeJobIds.length,
    runawayWorker: hazardAssessment.stopTargets.runawayWorkerIds.length,
    externalWrite: hazardAssessment.stopTargets.externalWriteTargets.length
  };
  const requiredCapabilityGroups = [
    targetCounts.unsafeJob > 0 ? {
      hazardKind: "unsafe-job",
      targetCount: targetCounts.unsafeJob,
      capabilities: providerRequirements.unsafeJobTargets ?? []
    } : null,
    targetCounts.runawayWorker > 0 ? {
      hazardKind: "runaway-worker",
      targetCount: targetCounts.runawayWorker,
      capabilities: providerRequirements.runawayWorkerTargets ?? []
    } : null,
    hazardAssessment.externalWriteRisk ? {
      hazardKind: "external-write-risk",
      targetCount: targetCounts.externalWrite,
      capabilities: providerRequirements.externalWriteRisk ?? []
    } : null
  ].filter(Boolean);
  const requiredCapabilities = [...new Set(requiredCapabilityGroups.flatMap((group) => group.capabilities))];
  const providerRole = providerName === "scheduler-gate"
    ? "admission_and_external_write_barrier"
    : providerName === "hosted-kernel-registry"
      ? "runtime_stop_and_write_fence"
      : providerName === "tenant-incident-ledger"
        ? "incident_evidence_link"
        : providerName === "kernel-audit-log"
          ? "audit_proof_claim"
          : "observer";
  const failClosedRequired = hazardAssessment.externalWriteRisk
    && ["scheduler-gate", "hosted-kernel-registry"].includes(providerName);

  return {
    schema: "aios.kernelLifecycle.panicStop.providerHazardContract.v1",
    providerName,
    declared: hazardAssessment.declared,
    providerRole,
    required: hazardAssessment.declared && requiredCapabilities.length > 0,
    failClosedRequired,
    targetCounts,
    hazardKinds: requiredCapabilityGroups.map((group) => group.hazardKind),
    requiredCapabilityGroups,
    requiredCapabilities,
    completionClaims: {
      unsafeJobsStopped: providerName === "hosted-kernel-registry" && targetCounts.unsafeJob > 0,
      runawayWorkersTerminated: providerName === "hosted-kernel-registry" && targetCounts.runawayWorker > 0,
      externalWritesFenced: failClosedRequired,
      admissionGuarded: providerName === "scheduler-gate" && hazardAssessment.declared,
      incidentEvidenceLinked: providerName === "tenant-incident-ledger" && hazardAssessment.declared,
      auditProofEmitted: providerName === "kernel-audit-log" && hazardAssessment.declared
    },
    handoffMode: !hazardAssessment.declared
      ? "standard_lifecycle_handoff"
      : failClosedRequired
        ? "fail_closed_runtime_hazard_handoff"
        : "runtime_hazard_evidence_handoff"
  };
}

function negotiateProviderContracts({ now, scope, lifecycleCommand, hazardAssessment, providers, health, persistedState }) {
  const requiredByProvider = COMMAND_PROVIDER_CAPABILITIES[lifecycleCommand.command] ?? {};
  const providerByName = new Map(providers.map((provider) => [provider.name, provider]));
  const negotiations = Object.entries(requiredByProvider).map(([providerName, requiredCapabilities]) => {
    const provider = providerByName.get(providerName);
    const hazardContract = buildProviderHazardContract({ providerName, hazardAssessment });
    const allRequiredCapabilities = [...new Set([...requiredCapabilities, ...hazardContract.requiredCapabilities])];
    const capabilitySet = new Set(provider?.capabilities ?? []);
    const missingCapabilities = allRequiredCapabilities.filter((capability) => !capabilitySet.has(capability));
    const missingHazardCapabilities = hazardContract.requiredCapabilities.filter((capability) => !capabilitySet.has(capability));
    const dependency = health.dependencies.find((item) => item.name === providerName);
    const expectedContractVersion = PROVIDER_CONTRACTS[providerName]?.version ?? "unknown";
    const contractVersion = provider?.contractVersion ?? expectedContractVersion;
    const serviceContract = provider?.serviceContract ?? null;
    const syncContract = provider
      ? buildProviderSyncContract({
        now,
        provider,
        persistedCursor: persistedState?.providerCursors?.[providerName],
        scope
      })
      : null;
    const unavailable = provider?.status === "unavailable" || dependency?.status === "unavailable";
    const readonly = provider?.status === "readonly" && requiredCapabilities.some((capability) => !capability.endsWith(".read"));
    const contractMismatch = contractVersion !== expectedContractVersion;
    const serviceDeclinedHandoff = serviceContract?.acceptsExternalHandoff === false;
    const syncConflict = syncContract?.generationRegression === true;
    const boundaryViolation = syncContract?.boundaryViolation === true;

    return {
      providerName,
      contractVersion,
      expectedContractVersion,
      handoffKind: provider?.handoffKind ?? PROVIDER_CONTRACTS[providerName]?.handoffKind ?? "unknown",
      endpointId: provider?.endpointId ?? providerName,
      requiredCapabilities: allRequiredCapabilities,
      baseRequiredCapabilities: requiredCapabilities,
      hazardContract: {
        ...hazardContract,
        missingCapabilities: missingHazardCapabilities,
        negotiated: hazardContract.required ? missingHazardCapabilities.length === 0 : true
      },
      missingCapabilities,
      dependencyStatus: dependency?.status ?? "unknown",
      providerStatus: provider?.status ?? "missing",
      serviceContract,
      sync: provider?.sync ?? null,
      syncContract,
      contractMismatch,
      serviceDeclinedHandoff,
      syncConflict,
      boundaryViolation,
      negotiated: Boolean(provider)
        && !unavailable
        && !readonly
        && !contractMismatch
        && !serviceDeclinedHandoff
        && !syncConflict
        && !boundaryViolation
        && missingHazardCapabilities.length === 0
        && missingCapabilities.length === 0
    };
  });
  const rejected = negotiations.filter((item) => !item.negotiated);

  return {
    schema: "aios.kernelLifecycle.panicStop.providerNegotiation.v1",
    command: lifecycleCommand.command,
    requiredProviderCount: negotiations.length,
    negotiatedProviderCount: negotiations.length - rejected.length,
    ready: rejected.length === 0,
    degraded: health.degradedMode || negotiations.some((item) => item.dependencyStatus === "degraded" || item.providerStatus === "degraded"),
    rejectedProviders: rejected.map((item) => ({
      providerName: item.providerName,
      providerStatus: item.providerStatus,
      dependencyStatus: item.dependencyStatus,
      expectedContractVersion: item.expectedContractVersion,
      contractVersion: item.contractVersion,
      missingCapabilities: item.missingCapabilities,
      contractMismatch: item.contractMismatch,
      serviceDeclinedHandoff: item.serviceDeclinedHandoff,
      syncConflict: item.syncConflict,
      boundaryViolation: item.boundaryViolation,
      hazardContract: item.hazardContract,
      syncContract: item.syncContract
    })),
    hazardCapabilitySummary: {
      schema: "aios.kernelLifecycle.panicStop.hazardCapabilityNegotiation.v1",
      declared: hazardAssessment.declared,
      externalWriteRisk: hazardAssessment.externalWriteRisk,
      requiredProviderCount: negotiations.filter((item) => item.hazardContract.required).length,
      failClosedProviderCount: negotiations.filter((item) => item.hazardContract.failClosedRequired).length,
      missingCapabilityCount: negotiations.reduce((total, item) => {
        return total + item.hazardContract.missingCapabilities.length;
      }, 0),
      handoffModes: negotiations.map((item) => ({
        providerName: item.providerName,
        mode: item.hazardContract.handoffMode,
        required: item.hazardContract.required,
        negotiated: item.hazardContract.negotiated,
        missingCapabilities: item.hazardContract.missingCapabilities
      }))
    },
    negotiations
  };
}

function buildExternalHandoffState({ now, scope, lifecycleCommand, commandPlan, providerNegotiation }) {
  const acceptedNegotiations = providerNegotiation.negotiations.filter((item) => item.negotiated);
  const acceptedProviderContracts = acceptedNegotiations.map((item) => buildProviderHandoffContract({
    now,
    scope,
    lifecycleCommand,
    negotiation: item
  }));
  const contractByProvider = new Map(acceptedProviderContracts.map((contract) => [contract.providerName, contract]));

  return {
    schema: "aios.kernelLifecycle.panicStop.externalHandoff.v1",
    handoffId: `${surfaceId}:${scope.boundaryKey}:${lifecycleCommand.command}:${now}`,
    command: lifecycleCommand.command,
    accepted: commandPlan.accepted && providerNegotiation.ready,
    mode: providerNegotiation.ready
      ? providerNegotiation.degraded ? "degraded_provider_sync" : "coordinated_provider_sync"
      : "blocked_provider_contract",
    providers: acceptedNegotiations.map((item) => ({
      providerName: item.providerName,
      handoffKind: item.handoffKind,
      endpointId: item.endpointId,
      contractVersion: item.contractVersion,
      serviceContract: item.serviceContract,
      requiredCapabilities: item.requiredCapabilities,
      hazardContract: item.hazardContract,
      handoffContract: contractByProvider.get(item.providerName),
      externalStateId: item.sync?.externalStateId ?? `${item.providerName}:${surfaceId}`,
      scopeKey: item.syncContract?.boundaryContract?.observedScopeKey ?? scope.boundaryKey,
      tenantId: item.syncContract?.boundaryContract?.observedTenantId ?? scope.tenantId,
      workspaceId: item.syncContract?.boundaryContract?.observedWorkspaceId ?? scope.workspaceId,
      providerBoundary: item.syncContract?.boundaryContract ?? null,
      syncCursor: item.sync?.cursor ?? null,
      syncGeneration: item.sync?.generation ?? 0,
      lastSyncedAt: item.sync?.lastSyncedAt ?? null,
      ackCursor: item.syncContract?.ackCursor ?? null,
      ackGeneration: item.syncContract?.ackGeneration ?? 0,
      handoffSyncMode: item.syncContract?.handoffSyncMode ?? "dispatch_current_provider_state",
      staleSync: item.syncContract?.stale ?? false,
      syncAgeMs: item.syncContract?.syncAgeMs ?? null,
      leaseTokenPresent: item.syncContract?.leaseTokenPresent ?? false
    })),
    blockedProviders: providerNegotiation.rejectedProviders,
    serviceContractSummary: {
      schema: "aios.kernelLifecycle.panicStop.providerServiceContractSummary.v1",
      negotiatedContractCount: acceptedProviderContracts.length,
      ackRequiredProviderCount: acceptedProviderContracts.filter((contract) => contract.acknowledgement.required).length,
      staleSyncProviderCount: acceptedProviderContracts.filter((contract) => contract.externalState.stale).length,
      runtimeHazardProviderCount: acceptedProviderContracts.filter((contract) => contract.runtimeHazard.required).length,
      failClosedProviderCount: acceptedProviderContracts.filter((contract) => contract.runtimeHazard.failClosedRequired).length,
      syncBarriers: acceptedProviderContracts.map((contract) => ({
        providerName: contract.providerName,
        operation: contract.operation,
        syncBarrier: contract.syncBarrier,
        hazardHandoffMode: contract.runtimeHazard.handoffMode,
        boundaryMode: contract.boundary?.handoffBoundaryMode,
        externalStateId: contract.externalState.externalStateId,
        requiredAckGeneration: contract.acknowledgement.requiredGeneration,
        negotiated: contract.negotiated
      }))
    },
    nextProviderAction: providerNegotiation.ready
      ? commandPlan.accepted ? "dispatch_provider_handoffs" : "hold_until_command_accepted"
      : "repair_provider_contracts_before_dispatch"
  };
}

function providerDispatchAction({ providerName, lifecycleCommand }) {
  const command = lifecycleCommand.command;
  const actions = {
    "scheduler-gate": {
      commit: "close_scheduler_admission",
      schedule: "write_guarded_stop_schedule",
      "cancel-scheduled": "delete_guarded_stop_schedule"
    },
    "hosted-kernel-registry": {
      arm: "arm_hosted_kernel_panic_stop",
      commit: "stop_hosted_kernel",
      enable: "enable_panic_stop_settings",
      disable: "disable_panic_stop_settings"
    },
    "tenant-incident-ledger": {
      arm: "append_panic_stop_arm_incident",
      commit: "append_panic_stop_commit_incident",
      schedule: "append_panic_stop_schedule_incident"
    },
    "kernel-audit-log": {
      arm: "emit_panic_stop_arm_proof",
      commit: "emit_panic_stop_commit_proof",
      schedule: "emit_panic_stop_schedule_proof",
      "cancel-scheduled": "emit_panic_stop_cancel_proof",
      enable: "emit_panic_stop_enable_proof",
      disable: "emit_panic_stop_disable_proof"
    }
  };

  return actions[providerName]?.[command] ?? "observe_panic_stop_command";
}

function buildProviderHandoffContract({ now, scope, lifecycleCommand, negotiation }) {
  const providerName = negotiation.providerName;
  const action = providerDispatchAction({ providerName, lifecycleCommand });
  const syncContract = negotiation.syncContract;
  const serviceContract = negotiation.serviceContract ?? {};
  const requiresAck = serviceContract.requiresAck === true;
  const commandSchemas = {
    "scheduler-gate": {
      inputSchema: "aios.provider.schedulerGate.panicStop.command.v1",
      resultSchema: "aios.provider.schedulerGate.panicStop.result.v1",
      externalObject: lifecycleCommand.command === "schedule" ? "guarded_stop_schedule" : "scheduler_admission_gate",
      stateTransition: lifecycleCommand.command === "cancel-scheduled" ? "scheduled_stop_removed" : "admission_guard_mutated"
    },
    "hosted-kernel-registry": {
      inputSchema: "aios.provider.hostedKernelRegistry.panicStop.command.v1",
      resultSchema: "aios.provider.hostedKernelRegistry.panicStop.result.v1",
      externalObject: "hosted_kernel_lifecycle_record",
      stateTransition: ["enable", "disable"].includes(lifecycleCommand.command) ? "panic_stop_settings_mutated" : "kernel_stop_state_mutated"
    },
    "tenant-incident-ledger": {
      inputSchema: "aios.provider.tenantIncidentLedger.panicStop.command.v1",
      resultSchema: "aios.provider.tenantIncidentLedger.panicStop.result.v1",
      externalObject: "tenant_incident_timeline",
      stateTransition: "incident_evidence_linked"
    },
    "kernel-audit-log": {
      inputSchema: "aios.provider.kernelAuditLog.panicStop.command.v1",
      resultSchema: "aios.provider.kernelAuditLog.panicStop.result.v1",
      externalObject: "kernel_lifecycle_audit_proof",
      stateTransition: "proof_emitted"
    }
  };
  const schema = commandSchemas[providerName] ?? {
    inputSchema: "aios.provider.generic.panicStop.command.v1",
    resultSchema: "aios.provider.generic.panicStop.result.v1",
    externalObject: "provider_external_state",
    stateTransition: "provider_state_observed"
  };
  const preconditions = [
    {
      code: "contract_version_match",
      satisfied: !negotiation.contractMismatch,
      expected: negotiation.expectedContractVersion,
      observed: negotiation.contractVersion
    },
    {
      code: "capabilities_available",
      satisfied: negotiation.missingCapabilities.length === 0,
      requiredCapabilities: negotiation.requiredCapabilities,
      missingCapabilities: negotiation.missingCapabilities
    },
    {
      code: "external_handoff_accepted",
      satisfied: !negotiation.serviceDeclinedHandoff,
      serviceId: serviceContract.serviceId ?? providerName
    },
    {
      code: "sync_generation_not_regressed",
      satisfied: syncContract?.generationRegression !== true,
      persistedGeneration: syncContract?.persistedGeneration ?? 0,
      observedGeneration: syncContract?.observedGeneration ?? 0
    },
    {
      code: "provider_scope_matches_requested_boundary",
      satisfied: syncContract?.boundaryViolation !== true,
      requestedScopeKey: scope.boundaryKey,
      observedScopeKey: syncContract?.boundaryContract?.observedScopeKey ?? null,
      violationCodes: syncContract?.boundaryContract?.violationCodes ?? []
    },
    {
      code: "runtime_hazard_capabilities_available",
      satisfied: negotiation.hazardContract?.negotiated !== false,
      hazardKinds: negotiation.hazardContract?.hazardKinds ?? [],
      requiredCapabilities: negotiation.hazardContract?.requiredCapabilities ?? [],
      missingCapabilities: negotiation.hazardContract?.missingCapabilities ?? []
    }
  ];
  const syncBarrier = syncContract?.generationRegression
    ? "refresh_provider_before_command"
    : syncContract?.ackBehind
      ? "await_ack_checkpoint_before_completion"
      : syncContract?.stale
        ? "allow_dispatch_with_reconcile_checkpoint"
        : "current_sync_checkpoint";

  return {
    schema: "aios.kernelLifecycle.panicStop.providerServiceHandoffContract.v1",
    generatedAt: now,
    providerName,
    serviceId: serviceContract.serviceId ?? providerName,
    instanceId: serviceContract.instanceId ?? null,
    endpointId: negotiation.endpointId,
    handoffKind: negotiation.handoffKind,
    operation: action,
    command: lifecycleCommand.command,
    scopeKey: scope.boundaryKey,
    externalObject: schema.externalObject,
    stateTransition: schema.stateTransition,
    inputSchema: schema.inputSchema,
    resultSchema: schema.resultSchema,
    contractVersion: negotiation.contractVersion,
    requiredCapabilities: negotiation.requiredCapabilities,
    preconditions,
    syncBarrier,
    boundary: syncContract?.boundaryContract ?? {
      schema: "aios.kernelLifecycle.panicStop.providerBoundaryContract.v1",
      providerName,
      requestedScopeKey: scope.boundaryKey,
      observedScopeKey: null,
      explicitBoundary: false,
      boundaryMatches: true,
      violationCodes: [],
      handoffBoundaryMode: "inherit_request_scope",
      auditClaim: "provider_state_bound_to_requested_scope"
    },
    acknowledgement: {
      required: requiresAck,
      requiredGeneration: syncContract?.observedGeneration ?? 0,
      ackGeneration: syncContract?.ackGeneration ?? 0,
      ackCursor: syncContract?.ackCursor ?? null,
      completionRule: requiresAck ? "provider_ack_generation_must_reach_required_generation" : "local_proof_completion"
    },
    runtimeHazard: negotiation.hazardContract ?? {
      schema: "aios.kernelLifecycle.panicStop.providerHazardContract.v1",
      providerName,
      declared: false,
      providerRole: "observer",
      required: false,
      failClosedRequired: false,
      targetCounts: {
        unsafeJob: 0,
        runawayWorker: 0,
        externalWrite: 0
      },
      hazardKinds: [],
      requiredCapabilityGroups: [],
      requiredCapabilities: [],
      missingCapabilities: [],
      negotiated: true,
      completionClaims: {},
      handoffMode: "standard_lifecycle_handoff"
    },
    externalState: {
      externalStateId: syncContract?.externalStateId ?? `${providerName}:${surfaceId}`,
      cursor: syncContract?.observedCursor ?? null,
      generation: syncContract?.observedGeneration ?? 0,
      stale: syncContract?.stale ?? false,
      leaseTokenRequired: serviceContract.durability === "transactional",
      leaseTokenPresent: syncContract?.leaseTokenPresent ?? false,
      revision: syncContract?.externalRevision ?? null
    },
    negotiated: negotiation.negotiated && preconditions.every((item) => item.satisfied)
  };
}

function normalizeEvidenceReference(item = {}, index = 0) {
  const source = cleanRecord(item);

  return {
    evidenceId: cleanText(source.evidenceId ?? source.id ?? source.ref, `evidence-${index + 1}`),
    kind: cleanText(source.kind ?? source.type, "incident-evidence"),
    source: cleanText(source.source ?? source.system ?? source.detector, "operator"),
    approvedBy: cleanText(source.approvedBy ?? source.actorId, null),
    capturedAt: cleanText(source.capturedAt ?? source.createdAt ?? source.at, null)
  };
}

function normalizeHazardEvidenceItem(item = {}, index = 0) {
  const source = cleanRecord(item);
  const rawKind = cleanText(source.hazardKind ?? source.kind ?? source.type, "unsafe-job");
  const kindAliases = {
    unsafe_job: "unsafe-job",
    unsafeJob: "unsafe-job",
    job: "unsafe-job",
    runaway_worker: "runaway-worker",
    runawayWorker: "runaway-worker",
    worker: "runaway-worker",
    external_write_risk: "external-write-risk",
    externalWriteRisk: "external-write-risk",
    external_write: "external-write-risk"
  };
  const kind = kindAliases[rawKind] ?? rawKind;
  const targetType = cleanText(source.targetType ?? source.resourceType, null);
  const targetId = cleanText(
    source.targetId ?? source.jobId ?? source.workerId ?? source.resourceId ?? source.externalPath,
    null
  );
  const writeTarget = cleanText(source.writeTarget ?? source.externalWriteTarget ?? source.path, null);
  const severity = cleanText(source.severity ?? source.riskSeverity, "critical");

  return {
    hazardId: cleanText(source.hazardId ?? source.id ?? source.evidenceId, `hazard-${index + 1}`),
    kind: HAZARD_KINDS.has(kind) ? kind : "unsafe-job",
    targetType: targetType
      ?? (source.workerId ? "worker" : source.jobId ? "job" : writeTarget ? "external-write-target" : "unknown"),
    targetId,
    writeTarget,
    severity: HAZARD_SEVERITIES.has(severity) ? severity : "critical",
    detector: cleanText(source.detector ?? source.source ?? source.system, "operator"),
    observedAt: cleanTimestamp(source.observedAt ?? source.capturedAt ?? source.createdAt),
    stopSignal: cleanText(source.stopSignal ?? source.killSignal ?? source.action, null),
    externalWriteBlocked: cleanBoolean(source.externalWriteBlocked ?? source.writeBlocked, false)
  };
}

function normalizeExternalWriteBoundaryTarget({ target, scope, index = 0 }) {
  const rawTarget = cleanText(target, "");
  const segments = rawTarget.split(/[/:]+/).map((segment) => cleanText(segment, null)).filter(Boolean);
  const tenantIndex = segments.findIndex((segment) => segment === "tenant" || segment === "tenants");
  const workspaceIndex = segments.findIndex((segment) => segment === "workspace" || segment === "workspaces");
  const labeledTenantId = tenantIndex >= 0 ? cleanText(segments[tenantIndex + 1], null) : null;
  const labeledWorkspaceId = workspaceIndex >= 0 ? cleanText(segments[workspaceIndex + 1], null) : null;
  const prefixedTenantId = segments[0] === "tenant" || segments[0] === "tenants"
    ? cleanText(segments[1], null)
    : null;
  const prefixedWorkspaceId = segments[2] === "workspace" || segments[2] === "workspaces"
    ? cleanText(segments[3], null)
    : null;
  const compactPair = rawTarget.includes("@")
    ? cleanText(rawTarget.split("@").pop(), "").split(/[/:]/).map((part) => cleanText(part, null)).filter(Boolean)
    : [];
  const compactTenantId = compactPair.length >= 2 ? compactPair[0] : null;
  const compactWorkspaceId = compactPair.length >= 2 ? compactPair[1] : null;
  const tenantId = labeledTenantId ?? prefixedTenantId ?? compactTenantId;
  const workspaceId = labeledWorkspaceId ?? prefixedWorkspaceId ?? compactWorkspaceId;
  const boundaryKey = tenantId && workspaceId ? `${tenantId}:${workspaceId}` : null;
  const boundaryKnown = Boolean(boundaryKey);
  const tenantMatches = !tenantId || tenantId === scope.tenantId;
  const workspaceMatches = !workspaceId || workspaceId === scope.workspaceId;
  const scopeMatches = boundaryKnown && tenantMatches && workspaceMatches && boundaryKey === scope.boundaryKey;
  const violationCodes = [
    !boundaryKnown ? "external_write_target_boundary_missing" : null,
    tenantId && tenantId !== scope.tenantId ? "external_write_target_tenant_mismatch" : null,
    workspaceId && workspaceId !== scope.workspaceId ? "external_write_target_workspace_mismatch" : null,
    boundaryKey && boundaryKey !== scope.boundaryKey ? "external_write_target_scope_mismatch" : null
  ].filter(Boolean);

  return {
    targetId: `external-write-target-${index + 1}`,
    target: rawTarget,
    requestedScopeKey: scope.boundaryKey,
    requestedTenantId: scope.tenantId,
    requestedWorkspaceId: scope.workspaceId,
    tenantId,
    workspaceId,
    boundaryKey,
    boundaryKnown,
    scopeMatches,
    violationCodes,
    handoffMode: scopeMatches
      ? "external_write_target_bound_to_scope"
      : boundaryKnown
        ? "quarantine_cross_scope_external_write_target"
        : "require_explicit_external_write_boundary",
    auditClaim: scopeMatches
      ? "external_write_target_scope_verified"
      : "external_write_target_not_safe_for_provider_handoff"
  };
}

function normalizeRuntimeHazardAssessment({ input = {}, evidence = [], lifecycleCommand, scope = DEFAULT_SCOPE }) {
  const source = cleanRecord(input.runtimeHazardAssessment ?? input.hazardAssessment ?? input.stopTargets);
  const explicitHazards = [
    ...(Array.isArray(source.hazards) ? source.hazards : []),
    ...(Array.isArray(source.unsafeJobs ?? input.unsafeJobs)
      ? (source.unsafeJobs ?? input.unsafeJobs).map((item) => ({
        ...(typeof item === "string" ? { targetId: item, jobId: item } : cleanRecord(item)),
        kind: "unsafe-job"
      }))
      : []),
    ...(Array.isArray(source.runawayWorkers ?? input.runawayWorkers)
      ? (source.runawayWorkers ?? input.runawayWorkers).map((item) => ({
        ...(typeof item === "string" ? { targetId: item, workerId: item } : cleanRecord(item)),
        kind: "runaway-worker"
      }))
      : []),
    ...(Array.isArray(source.externalWriteRisks ?? input.externalWriteRisks)
      ? (source.externalWriteRisks ?? input.externalWriteRisks).map((item) => ({
        ...(typeof item === "string" ? { writeTarget: item, targetId: item } : cleanRecord(item)),
        kind: "external-write-risk"
      }))
      : [])
  ];
  const evidenceHazards = evidence
    .filter((item) => {
      const record = cleanRecord(item);
      const kind = cleanText(record.hazardKind ?? record.kind ?? record.type, "");
      return HAZARD_KINDS.has(kind) || record.jobId || record.workerId || record.externalWriteTarget || record.writeTarget;
    })
    .map((item, index) => normalizeHazardEvidenceItem(item, index));
  const hazards = [
    ...explicitHazards.map((item, index) => normalizeHazardEvidenceItem(item, index)),
    ...evidenceHazards
  ];
  const unsafeJobIds = cleanList(source.unsafeJobIds ?? input.unsafeJobIds)
    .concat(hazards.filter((hazard) => hazard.kind === "unsafe-job").map((hazard) => hazard.targetId))
    .filter(Boolean);
  const runawayWorkerIds = cleanList(source.runawayWorkerIds ?? input.runawayWorkerIds ?? input.workerIds)
    .concat(hazards.filter((hazard) => hazard.kind === "runaway-worker").map((hazard) => hazard.targetId))
    .filter(Boolean);
  const externalWriteTargets = cleanList(source.externalWriteTargets ?? input.externalWriteTargets)
    .concat(hazards.filter((hazard) => hazard.kind === "external-write-risk").map((hazard) => hazard.writeTarget ?? hazard.targetId))
    .filter(Boolean);
  const uniqueUnsafeJobIds = [...new Set(unsafeJobIds)];
  const uniqueRunawayWorkerIds = [...new Set(runawayWorkerIds)];
  const uniqueExternalWriteTargets = [...new Set(externalWriteTargets)];
  const externalWriteRisk = hazards.some((hazard) => hazard.kind === "external-write-risk")
    || uniqueExternalWriteTargets.length > 0
    || cleanBoolean(source.externalWriteRisk ?? input.externalWriteRisk, false);
  const externalWriteBoundaryTargets = uniqueExternalWriteTargets.map((target, index) => {
    return normalizeExternalWriteBoundaryTarget({ target, scope, index });
  });
  const ambiguousExternalWriteTargets = externalWriteBoundaryTargets.filter((target) => !target.boundaryKnown);
  const crossScopeExternalWriteTargets = externalWriteBoundaryTargets.filter((target) => {
    return target.boundaryKnown && !target.scopeMatches;
  });
  const externalWriteBoundaryTrusted = !externalWriteRisk
    || (externalWriteBoundaryTargets.length > 0
      && ambiguousExternalWriteTargets.length === 0
      && crossScopeExternalWriteTargets.length === 0);
  const stopTargets = {
    unsafeJobIds: uniqueUnsafeJobIds,
    runawayWorkerIds: uniqueRunawayWorkerIds,
    externalWriteTargets: uniqueExternalWriteTargets
  };
  const missingStopTargetKinds = [
    hazards.some((hazard) => hazard.kind === "unsafe-job") && uniqueUnsafeJobIds.length === 0 ? "unsafe-job" : null,
    hazards.some((hazard) => hazard.kind === "runaway-worker") && uniqueRunawayWorkerIds.length === 0 ? "runaway-worker" : null,
    externalWriteRisk && uniqueExternalWriteTargets.length === 0 ? "external-write-risk" : null
  ].filter(Boolean);
  const requiresImmediateCommit = externalWriteRisk
    || uniqueRunawayWorkerIds.length > 0
    || hazards.some((hazard) => hazard.severity === "critical");
  const containmentMode = lifecycleCommand.command === "commit"
    ? "stop_runtime_and_close_admission"
    : lifecycleCommand.command === "schedule"
      ? requiresImmediateCommit ? "schedule_rejected_immediate_commit_required" : "schedule_guarded_stop"
      : lifecycleCommand.command === "arm"
        ? "arm_with_runtime_target_watch"
      : "observe_runtime_hazard_only";
  const safetyInterrupt = buildRuntimeSafetyInterruptPlan({
    lifecycleCommand,
    hazards,
    stopTargets,
    externalWriteRisk,
    requiresImmediateCommit,
    targetCoverageComplete: missingStopTargetKinds.length === 0,
    missingStopTargetKinds,
    externalWriteBoundaryTrusted,
    ambiguousExternalWriteTargetCount: ambiguousExternalWriteTargets.length,
    crossScopeExternalWriteTargetCount: crossScopeExternalWriteTargets.length
  });

  return {
    schema: "aios.kernelLifecycle.panicStop.runtimeHazardAssessment.v1",
    declared: hazards.length > 0 || externalWriteRisk || uniqueUnsafeJobIds.length > 0 || uniqueRunawayWorkerIds.length > 0,
    command: lifecycleCommand.command,
    hazardCount: hazards.length,
    hazards,
    stopTargets,
    externalWriteRisk,
    externalWriteBoundary: {
      schema: "aios.kernelLifecycle.panicStop.externalWriteBoundary.v1",
      trusted: externalWriteBoundaryTrusted,
      failClosed: externalWriteRisk && !externalWriteBoundaryTrusted,
      requestedScopeKey: scope.boundaryKey,
      targetCount: externalWriteBoundaryTargets.length,
      verifiedTargetCount: externalWriteBoundaryTargets.filter((target) => target.scopeMatches).length,
      ambiguousTargetCount: ambiguousExternalWriteTargets.length,
      crossScopeTargetCount: crossScopeExternalWriteTargets.length,
      violationCodes: [...new Set(externalWriteBoundaryTargets.flatMap((target) => target.violationCodes))],
      targets: externalWriteBoundaryTargets,
      nextAction: externalWriteBoundaryTrusted
        ? "continue_external_write_handoff"
        : ambiguousExternalWriteTargets.length > 0
          ? "bind_external_write_targets_to_requested_scope"
          : "quarantine_cross_scope_external_write_targets"
    },
    requiresImmediateCommit,
    targetCoverageComplete: missingStopTargetKinds.length === 0,
    missingStopTargetKinds,
    containmentMode,
    safetyInterrupt,
    providerStopContract: {
      closeSchedulerAdmission: ["commit", "schedule"].includes(lifecycleCommand.command),
      stopUnsafeJobs: uniqueUnsafeJobIds.length > 0,
      stopRunawayWorkers: uniqueRunawayWorkerIds.length > 0,
      blockExternalWrites: externalWriteRisk,
      auditTargetIds: [...uniqueUnsafeJobIds, ...uniqueRunawayWorkerIds, ...uniqueExternalWriteTargets]
    }
  };
}

function buildRuntimeSafetyInterruptPlan({
  lifecycleCommand,
  hazards,
  stopTargets,
  externalWriteRisk,
  requiresImmediateCommit,
  targetCoverageComplete,
  missingStopTargetKinds,
  externalWriteBoundaryTrusted = true,
  ambiguousExternalWriteTargetCount = 0,
  crossScopeExternalWriteTargetCount = 0
}) {
  const criticalHazards = hazards.filter((hazard) => hazard.severity === "critical");
  const unresolvedExternalWriteTargets = hazards
    .filter((hazard) => hazard.kind === "external-write-risk" && hazard.externalWriteBlocked !== true)
    .map((hazard) => hazard.writeTarget ?? hazard.targetId)
    .filter(Boolean);
  const liveRuntimeTargetCount = stopTargets.unsafeJobIds.length + stopTargets.runawayWorkerIds.length;
  const declared = hazards.length > 0 || externalWriteRisk || liveRuntimeTargetCount > 0;
  const externalWriteBarrierReady = !externalWriteRisk
    || stopTargets.externalWriteTargets.length > 0
    || unresolvedExternalWriteTargets.length === 0;
  const active = declared && (
    requiresImmediateCommit
    || !targetCoverageComplete
    || !externalWriteBarrierReady
    || !externalWriteBoundaryTrusted
  );
  const blockedCommandMap = {
    arm: active && requiresImmediateCommit,
    schedule: active && (requiresImmediateCommit || !targetCoverageComplete || !externalWriteBarrierReady),
    "cancel-scheduled": active && requiresImmediateCommit,
    disable: active,
    commit: false,
    enable: false
  };
  const blockedCommands = Object.entries(blockedCommandMap)
    .filter(([, blocked]) => blocked)
    .map(([command]) => command);
  const currentCommandBlocked = blockedCommands.includes(lifecycleCommand.command);
  const interruptLevel = !active
    ? "none"
    : externalWriteRisk || unresolvedExternalWriteTargets.length > 0 || !externalWriteBoundaryTrusted
      ? "external_write_fail_closed"
      : requiresImmediateCommit
        ? "immediate_commit_required"
        : "stop_target_repair_required";
  const requiredProviderClaims = [
    liveRuntimeTargetCount > 0 ? "runtime_targets_declared_for_stop" : null,
    stopTargets.runawayWorkerIds.length > 0 ? "runaway_workers_must_be_terminated" : null,
    stopTargets.unsafeJobIds.length > 0 ? "unsafe_jobs_must_be_stopped" : null,
    externalWriteRisk ? "external_writes_must_be_fenced" : null,
    targetCoverageComplete ? "stop_target_coverage_complete" : "stop_target_coverage_missing"
  ].filter(Boolean);

  return {
    schema: "aios.kernelLifecycle.panicStop.runtimeSafetyInterrupt.v1",
    active,
    level: interruptLevel,
    currentCommandBlocked,
    blockedCommands,
    allowedCommands: [...LIFECYCLE_COMMANDS].filter((command) => !blockedCommands.includes(command)),
    reasonCodes: [
      requiresImmediateCommit ? "immediate_commit_required" : null,
      !targetCoverageComplete ? "missing_stop_targets" : null,
      externalWriteRisk ? "external_write_risk_declared" : null,
      !externalWriteBoundaryTrusted ? "external_write_boundary_untrusted" : null,
      ambiguousExternalWriteTargetCount > 0 ? "external_write_target_boundary_missing" : null,
      crossScopeExternalWriteTargetCount > 0 ? "external_write_target_cross_scope" : null,
      unresolvedExternalWriteTargets.length > 0 ? "external_write_barrier_unconfirmed" : null,
      stopTargets.runawayWorkerIds.length > 0 ? "runaway_worker_declared" : null,
      criticalHazards.length > 0 ? "critical_runtime_hazard" : null
    ].filter(Boolean),
    targetSummary: {
      unsafeJobCount: stopTargets.unsafeJobIds.length,
      runawayWorkerCount: stopTargets.runawayWorkerIds.length,
      externalWriteTargetCount: stopTargets.externalWriteTargets.length,
      missingStopTargetKinds,
      unresolvedExternalWriteTargets,
      externalWriteBoundaryTrusted,
      ambiguousExternalWriteTargetCount,
      crossScopeExternalWriteTargetCount
    },
    requiredProviderClaims,
    nextAction: currentCommandBlocked
      ? requiresImmediateCommit
        ? "commit_panic_stop_immediately"
        : "repair_runtime_hazard_targets_before_lifecycle_command"
      : active
        ? "continue_with_commit_or_enable_controls_only"
        : "continue_requested_lifecycle_command",
    auditClaim: active
      ? "runtime_safety_interrupt_enforced"
      : "runtime_safety_interrupt_not_required"
  };
}

function buildRuntimeHazardProviderAction({ providerName, lifecycleCommand, hazardAssessment }) {
  const targetCounts = {
    unsafeJobs: hazardAssessment.stopTargets.unsafeJobIds.length,
    runawayWorkers: hazardAssessment.stopTargets.runawayWorkerIds.length,
    externalWriteTargets: hazardAssessment.stopTargets.externalWriteTargets.length
  };
  const hazardKinds = [...new Set(hazardAssessment.hazards.map((hazard) => hazard.kind))];
  const criticalHazardIds = hazardAssessment.hazards
    .filter((hazard) => hazard.severity === "critical")
    .map((hazard) => hazard.hazardId);
  const providerActions = {
    "scheduler-gate": [
      lifecycleCommand.command === "commit" ? "close_scheduler_admission_immediately" : null,
      lifecycleCommand.command === "schedule" ? "write_guarded_stop_schedule" : null,
      targetCounts.unsafeJobs > 0 ? "reject_new_runs_for_unsafe_job_targets" : null,
      targetCounts.runawayWorkers > 0 ? "reject_worker_reschedule_for_runaway_targets" : null,
      hazardAssessment.externalWriteRisk ? "fail_closed_external_write_admission" : null
    ].filter(Boolean),
    "hosted-kernel-registry": [
      targetCounts.unsafeJobs > 0 ? "stop_declared_unsafe_jobs" : null,
      targetCounts.runawayWorkers > 0 ? "terminate_declared_runaway_workers" : null,
      hazardAssessment.externalWriteRisk ? "install_external_write_fence" : null,
      lifecycleCommand.command === "arm" ? "arm_runtime_target_watch" : null,
      lifecycleCommand.command === "commit" ? "mark_kernel_stop_committed" : null
    ].filter(Boolean),
    "tenant-incident-ledger": [
      "append_runtime_hazard_timeline",
      targetCounts.unsafeJobs > 0 ? "link_unsafe_job_targets" : null,
      targetCounts.runawayWorkers > 0 ? "link_runaway_worker_targets" : null,
      hazardAssessment.externalWriteRisk ? "link_external_write_risk_targets" : null
    ].filter(Boolean),
    "kernel-audit-log": [
      "emit_runtime_hazard_proof_claims",
      hazardAssessment.targetCoverageComplete ? "prove_stop_target_coverage" : "prove_missing_stop_target_blocker",
      hazardAssessment.requiresImmediateCommit ? "prove_immediate_commit_required" : "prove_deferred_stop_allowed"
    ]
  };
  const actions = hazardAssessment.declared ? providerActions[providerName] ?? [] : [];
  const actionMode = !hazardAssessment.declared
    ? "no_runtime_hazard_declared"
    : actions.length === 0
      ? "observe_runtime_hazard"
      : lifecycleCommand.command === "schedule" && hazardAssessment.requiresImmediateCommit
        ? "hold_schedule_until_commit_requested"
        : "enforce_runtime_hazard_containment";
  const required = hazardAssessment.declared
    && actions.length > 0
    && !["enable", "disable", "cancel-scheduled"].includes(lifecycleCommand.command);
  const externalWriteBarrier = hazardAssessment.externalWriteRisk ? {
    required: true,
    failClosed: true,
    targets: hazardAssessment.stopTargets.externalWriteTargets,
    providerRole: providerName === "scheduler-gate"
      ? "admission_barrier"
      : providerName === "hosted-kernel-registry"
        ? "runtime_write_fence"
        : providerName === "kernel-audit-log"
          ? "proof_claim"
          : "incident_evidence"
  } : {
    required: false,
    failClosed: false,
    targets: [],
    providerRole: "not_required"
  };

  return {
    schema: "aios.kernelLifecycle.panicStop.runtimeHazardProviderAction.v1",
    providerName,
    command: lifecycleCommand.command,
    declared: hazardAssessment.declared,
    required,
    actionMode,
    containmentMode: hazardAssessment.containmentMode,
    actions,
    hazardKinds,
    criticalHazardIds,
    targetCounts,
    targetCoverageComplete: hazardAssessment.targetCoverageComplete,
    missingStopTargetKinds: hazardAssessment.missingStopTargetKinds,
    externalWriteBarrier,
    completionClaims: {
      schedulerAdmissionClosed: providerName === "scheduler-gate" && lifecycleCommand.command === "commit",
      unsafeJobsStopped: providerName === "hosted-kernel-registry" && targetCounts.unsafeJobs > 0,
      runawayWorkersTerminated: providerName === "hosted-kernel-registry" && targetCounts.runawayWorkers > 0,
      externalWritesBlocked: externalWriteBarrier.required
        && ["scheduler-gate", "hosted-kernel-registry"].includes(providerName),
      auditProofRequired: providerName === "kernel-audit-log" || required,
      incidentEvidenceRequired: providerName === "tenant-incident-ledger" && hazardAssessment.declared
    },
    dispatchPreconditions: [
      {
        code: "runtime_hazard_targets_covered",
        satisfied: hazardAssessment.targetCoverageComplete,
        missingKinds: hazardAssessment.missingStopTargetKinds
      },
      {
        code: "deferred_stop_allowed_for_hazard",
        satisfied: lifecycleCommand.command !== "schedule" || !hazardAssessment.requiresImmediateCommit,
        requiresImmediateCommit: hazardAssessment.requiresImmediateCommit
      },
      {
        code: "external_write_barrier_bound",
        satisfied: !externalWriteBarrier.required
          || externalWriteBarrier.targets.length > 0
          || providerName === "kernel-audit-log",
        targetCount: externalWriteBarrier.targets.length
      }
    ]
  };
}

function buildProviderDispatchEnvelope({
  now,
  actor,
  scope,
  evidence,
  hazardAssessment,
  lifecycleCommand,
  lifecycleSettings,
  scheduleRequest,
  commandPlan,
  operationalResponse,
  externalHandoffState,
  persistenceRecoveryState
}) {
  const duplicateSuppressed = persistenceRecoveryState.idempotency.duplicateCompletedCommand
    || persistenceRecoveryState.idempotency.scheduledCommandMatches;
  const recoveryGate = persistenceRecoveryState.recovery.required;
  const dispatchable = commandPlan.accepted
    && externalHandoffState.accepted
    && persistenceRecoveryState.writeIntent === "persist_before_dispatch"
    && !duplicateSuppressed
    && !recoveryGate;
  const evidenceRefs = evidence.map((item, index) => normalizeEvidenceReference(item, index));
  const dispatchMode = duplicateSuppressed
    ? "suppress_duplicate_dispatch"
    : recoveryGate
      ? "reconcile_before_dispatch"
      : dispatchable
        ? "persist_then_dispatch_provider_commands"
        : "blocked_no_provider_dispatch";
  const proofId = `${surfaceId}:${scope.boundaryKey}:proof:${persistenceRecoveryState.commandKey}`;

  return {
    schema: "aios.kernelLifecycle.panicStop.providerDispatchEnvelope.v1",
    dispatchId: `${surfaceId}:${scope.boundaryKey}:dispatch:${now}`,
    commandKey: persistenceRecoveryState.commandKey,
    command: lifecycleCommand.command,
    generatedAt: now,
    dispatchable,
    dispatchMode,
    route: commandPlan.route,
    actor: {
      actorId: actor.actorId,
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId
    },
    scope,
    isolationBoundary: {
      boundaryMode: commandPlan.boundary.boundaryMode,
      actorScopeKey: commandPlan.boundary.actorScopeKey,
      requestedScopeKey: commandPlan.boundary.requestedScopeKey,
      authority: commandPlan.boundary.authority,
      scopedGrantSatisfied: commandPlan.boundary.scopedGrantSatisfied,
      scopedGrantRequired: commandPlan.boundary.scopedGrantRequired
    },
    persistenceGate: {
      writeIntent: persistenceRecoveryState.writeIntent,
      compareAndSwapGeneration: persistenceRecoveryState.stateStore.compareAndSwapGeneration,
      nextWriteGeneration: persistenceRecoveryState.nextPersistedState.writeGeneration,
      restartSafeStatus: persistenceRecoveryState.statusSemantics.restartSafeStatus,
      recoveryRequired: recoveryGate
    },
    providerCommands: externalHandoffState.providers.map((provider, index) => {
      const runtimeHazardProviderAction = buildRuntimeHazardProviderAction({
        providerName: provider.providerName,
        lifecycleCommand,
        hazardAssessment
      });

      return {
        sequence: index + 1,
        providerName: provider.providerName,
        endpointId: provider.endpointId,
        handoffKind: provider.handoffKind,
        contractVersion: provider.contractVersion,
        serviceContract: provider.serviceContract,
        hazardContract: provider.hazardContract,
        handoffContract: provider.handoffContract,
        action: providerDispatchAction({ providerName: provider.providerName, lifecycleCommand }),
        runtimeHazardActionMode: runtimeHazardProviderAction.actionMode,
        dispatchState: dispatchable ? "ready" : "held",
        idempotencyKey: `${persistenceRecoveryState.commandKey}:${provider.providerName}`,
        requiredCapabilities: provider.requiredCapabilities,
        providerSync: {
          externalStateId: provider.externalStateId,
          scopeKey: provider.scopeKey,
          tenantId: provider.tenantId,
          workspaceId: provider.workspaceId,
          providerBoundary: provider.providerBoundary,
          syncCursor: provider.syncCursor,
          syncGeneration: provider.syncGeneration,
          ackCursor: provider.ackCursor,
          ackGeneration: provider.ackGeneration,
          handoffSyncMode: provider.handoffSyncMode,
          staleSync: provider.staleSync,
          syncAgeMs: provider.syncAgeMs,
          leaseTokenPresent: provider.leaseTokenPresent
        },
        payload: {
          schema: "aios.kernelLifecycle.panicStop.providerCommandPayload.v1",
          commandKey: persistenceRecoveryState.commandKey,
          lifecycleCommand: lifecycleCommand.command,
          scheduledFor: lifecycleCommand.command === "schedule" ? scheduleRequest.scheduledFor : null,
          cancelScheduleId: lifecycleCommand.command === "cancel-scheduled"
            ? persistenceRecoveryState.nextPersistedState.scheduledStop.scheduleId
            : null,
          settingsDelta: commandPlan.settingsDelta,
          controlsEnabled: lifecycleSettings.controlsEnabled,
          failClosed: operationalResponse.failClosed,
          isolationBoundary: {
            boundaryMode: commandPlan.boundary.boundaryMode,
            requestedScopeKey: commandPlan.boundary.requestedScopeKey,
            scopedGrantSatisfied: commandPlan.boundary.scopedGrantSatisfied,
            providerBoundaryMode: provider.providerBoundary?.handoffBoundaryMode ?? "inherit_request_scope",
            providerBoundaryVerified: provider.providerBoundary?.boundaryMatches ?? true
          },
          evidenceRefs,
          runtimeHazardAssessment: hazardAssessment,
          runtimeHazardProviderAction,
          runtimeHazardProviderContract: provider.hazardContract,
          proofId,
          externalStateId: provider.externalStateId,
          syncCursor: provider.syncCursor,
          syncGeneration: provider.syncGeneration,
          ackCursor: provider.ackCursor,
          ackGeneration: provider.ackGeneration,
          handoffSyncMode: provider.handoffSyncMode,
          staleSync: provider.staleSync,
          providerServiceId: provider.serviceContract?.serviceId ?? provider.providerName,
          providerInstanceId: provider.serviceContract?.instanceId ?? null,
          providerRequiresAck: provider.serviceContract?.requiresAck ?? false,
          retryClass: operationalResponse.retry.class,
          retryCauseCodes: operationalResponse.retry.causeCodes,
          retryAfter: operationalResponse.retry.retryAfter,
          serviceHandoffContract: {
            schema: provider.handoffContract?.schema ?? "aios.kernelLifecycle.panicStop.providerServiceHandoffContract.v1",
            operation: provider.handoffContract?.operation ?? providerDispatchAction({ providerName: provider.providerName, lifecycleCommand }),
            inputSchema: provider.handoffContract?.inputSchema ?? null,
            resultSchema: provider.handoffContract?.resultSchema ?? null,
            externalObject: provider.handoffContract?.externalObject ?? null,
            stateTransition: provider.handoffContract?.stateTransition ?? null,
            syncBarrier: provider.handoffContract?.syncBarrier ?? "current_sync_checkpoint",
            preconditions: provider.handoffContract?.preconditions ?? [],
            acknowledgement: provider.handoffContract?.acknowledgement ?? {
              required: provider.serviceContract?.requiresAck ?? false,
              requiredGeneration: provider.syncGeneration,
              ackGeneration: provider.ackGeneration,
              ackCursor: provider.ackCursor,
              completionRule: "provider_ack_generation_must_reach_required_generation"
            },
            externalState: provider.handoffContract?.externalState ?? {
              externalStateId: provider.externalStateId,
              cursor: provider.syncCursor,
              generation: provider.syncGeneration,
              stale: provider.staleSync,
              leaseTokenPresent: provider.leaseTokenPresent,
              revision: null
            },
            runtimeHazard: provider.handoffContract?.runtimeHazard ?? provider.hazardContract,
            boundary: provider.handoffContract?.boundary ?? provider.providerBoundary
          }
        }
      };
    }),
    blockedProviderCommands: externalHandoffState.blockedProviders.map((provider) => ({
      providerName: provider.providerName,
      providerStatus: provider.providerStatus,
      dependencyStatus: provider.dependencyStatus,
      expectedContractVersion: provider.expectedContractVersion,
      contractVersion: provider.contractVersion,
      missingCapabilities: provider.missingCapabilities,
      hazardContract: provider.hazardContract,
      contractMismatch: provider.contractMismatch,
      serviceDeclinedHandoff: provider.serviceDeclinedHandoff,
      syncConflict: provider.syncConflict,
      boundaryViolation: provider.boundaryViolation,
      syncContract: provider.syncContract,
      heldAction: providerDispatchAction({ providerName: provider.providerName, lifecycleCommand })
    })),
    auditProofOutput: {
      proofId,
      proofSchema: "aios.kernelLifecycle.panicStop.auditProof.v1",
      auditProvider: "kernel-audit-log",
      incidentProvider: lifecycleCommand.command === "cancel-scheduled" ? null : "tenant-incident-ledger",
      evidenceCount: evidenceRefs.length,
      includeProviderCommands: true,
      includePersistenceGate: true,
      includeServiceHandoffContracts: true,
      includeRuntimeHazardAssessment: hazardAssessment.declared,
      includeRuntimeHazardProviderActions: hazardAssessment.declared,
      proofMode: lifecycleSettings.proofMode
    }
  };
}

function buildProviderMitigationPlan({ now, operationalResponse, providerDispatchEnvelope }) {
  const commandMitigations = providerDispatchEnvelope.providerCommands.flatMap((command) => {
    const providerSync = command.payload.providerSync;
    const handoff = command.payload.serviceHandoffContract;
    const ack = handoff.acknowledgement ?? {};
    const externalState = handoff.externalState ?? {};
    const transactionalLeaseMissing = command.serviceContract?.durability === "transactional"
      && externalState.leaseTokenPresent !== true;
    const ackLag = ack.required === true
      && cleanPositiveInteger(ack.ackGeneration, 0) < cleanPositiveInteger(ack.requiredGeneration, 0);
    const staleSync = providerSync.staleSync === true || externalState.stale === true;
    const held = command.dispatchState !== "ready";
    const providerMitigations = [];

    if (transactionalLeaseMissing) {
      providerMitigations.push({
        code: "transactional_provider_lease_missing",
        providerName: command.providerName,
        severity: "critical",
        dispatchState: command.dispatchState,
        operatorAction: "Acquire or renew the provider lease token before dispatching this panic-stop command.",
        retryClass: "blocked_until_provider_lease_repaired",
        proofClaim: "transactional_handoff_requires_lease_token"
      });
    }

    if (ackLag) {
      providerMitigations.push({
        code: "provider_ack_generation_lag",
        providerName: command.providerName,
        severity: held ? "warning" : "info",
        dispatchState: command.dispatchState,
        operatorAction: "Wait for provider acknowledgement to reach the required sync generation before finalizing the command.",
        retryClass: "retry_after_provider_ack",
        proofClaim: "provider_completion_requires_ack_checkpoint",
        requiredGeneration: cleanPositiveInteger(ack.requiredGeneration, 0),
        ackGeneration: cleanPositiveInteger(ack.ackGeneration, 0)
      });
    }

    if (staleSync) {
      providerMitigations.push({
        code: "provider_sync_stale",
        providerName: command.providerName,
        severity: "warning",
        dispatchState: command.dispatchState,
        operatorAction: "Refresh provider sync after local proof emission and reconcile the external state cursor.",
        retryClass: "retry_after_provider_sync_refresh",
        proofClaim: "stale_provider_sync_requires_reconcile_checkpoint",
        syncAgeMs: cleanPositiveInteger(providerSync.syncAgeMs, 0)
      });
    }

    return providerMitigations;
  });
  const blockedMitigations = providerDispatchEnvelope.blockedProviderCommands.map((provider) => ({
    code: provider.contractMismatch
      ? "provider_contract_version_blocked"
      : provider.syncConflict
        ? "provider_sync_regression_blocked"
        : provider.boundaryViolation
          ? "provider_boundary_scope_blocked"
        : provider.serviceDeclinedHandoff
          ? "provider_handoff_declined"
          : provider.hazardContract?.missingCapabilities?.length > 0
            ? "runtime_hazard_provider_capability_blocked"
          : provider.missingCapabilities.length > 0
            ? "provider_capability_blocked"
            : "provider_unavailable_blocked",
    providerName: provider.providerName,
    severity: "critical",
    dispatchState: "blocked",
    operatorAction: provider.contractMismatch
      ? `Upgrade ${provider.providerName} to ${provider.expectedContractVersion} before accepting panic-stop handoff.`
      : provider.syncConflict
        ? "Refresh the provider from persisted panic-stop state before retrying dispatch."
        : provider.boundaryViolation
          ? "Quarantine the provider cursor or reload it for the requested tenant/workspace boundary."
        : provider.serviceDeclinedHandoff
          ? "Enable external handoff on the provider service contract."
          : provider.hazardContract?.missingCapabilities?.length > 0
            ? `Enable runtime hazard capabilities: ${provider.hazardContract.missingCapabilities.join(", ")}.`
          : provider.missingCapabilities.length > 0
            ? `Enable required capabilities: ${provider.missingCapabilities.join(", ")}.`
            : "Restore provider availability before retrying panic-stop dispatch.",
    retryClass: "blocked_until_provider_contract_repaired",
    proofClaim: provider.boundaryViolation
      ? "provider_handoff_blocked_by_scope_boundary"
      : provider.hazardContract?.missingCapabilities?.length > 0
        ? "runtime_hazard_provider_capabilities_required"
      : "blocked_provider_requires_operator_repair"
  }));
  const mitigations = [...commandMitigations, ...blockedMitigations];
  const criticalCount = mitigations.filter((mitigation) => mitigation.severity === "critical").length;
  const warningCount = mitigations.filter((mitigation) => mitigation.severity === "warning").length;
  const status = criticalCount > 0
    ? "blocked"
    : warningCount > 0
      ? "degraded"
      : providerDispatchEnvelope.dispatchable
        ? "ready"
        : "held";

  return {
    schema: "aios.kernelLifecycle.panicStop.providerMitigationPlan.v1",
    generatedAt: now,
    dispatchId: providerDispatchEnvelope.dispatchId,
    commandKey: providerDispatchEnvelope.commandKey,
    status,
    dispatchAllowed: providerDispatchEnvelope.dispatchable && criticalCount === 0,
    mitigationRequired: mitigations.length > 0,
    retryAfter: operationalResponse.retry.retryAfter,
    summary: {
      total: mitigations.length,
      critical: criticalCount,
      warning: warningCount,
      blockedProviders: providerDispatchEnvelope.blockedProviderCommands.length,
      providersRequiringAck: providerDispatchEnvelope.providerCommands.filter((command) => {
        return command.payload.providerRequiresAck === true;
      }).length,
      staleSyncProviders: providerDispatchEnvelope.providerCommands.filter((command) => {
        return command.payload.providerSync.staleSync === true;
      }).length
    },
    mitigations,
    operatorRunbook: {
      nextAction: criticalCount > 0
        ? "repair_provider_blockers_before_dispatch"
        : warningCount > 0
          ? "dispatch_with_reconcile_and_ack_followup"
          : providerDispatchEnvelope.dispatchable
            ? "dispatch_provider_commands"
            : "wait_for_persistence_or_recovery_gate",
      preserveCommandKey: operationalResponse.retry.idempotencyRequirement === "reuse_command_key"
        || providerDispatchEnvelope.dispatchMode !== "persist_then_dispatch_provider_commands",
      proofClaims: mitigations.map((mitigation) => mitigation.proofClaim)
    }
  };
}

function validatePanicStopRequest({
  actor,
  scope,
  requestedAction,
  evidence,
  lifecycleCommand,
  lifecycleSettings,
  scheduleRequest,
  settingsMutation,
  hazardAssessment
}) {
  const errors = [];

  if (!actor.actorId || actor.actorId === "anonymous") {
    errors.push({
      code: "missing_actor_identity",
      field: "actor.actorId",
      message: "Panic-stop requires a traceable actor identity.",
      action: "Attach the hosted-kernel operator or automation identity before retrying."
    });
  }

  if (requestedAction !== "panic-stop") {
    errors.push({
      code: "invalid_action",
      field: "action",
      message: "Lifecycle request action is not panic-stop.",
      action: "Set action to panic-stop for this surface."
    });
  }

  if (!lifecycleCommand.recognized) {
    errors.push({
      code: "unsupported_lifecycle_command",
      field: "command",
      message: "Panic-stop lifecycle command is not supported.",
      action: "Use arm, commit, schedule, cancel-scheduled, enable, or disable."
    });
  }

  if (!lifecycleSettings.controlsEnabled && !["enable", "disable"].includes(lifecycleCommand.command)) {
    errors.push({
      code: "lifecycle_controls_disabled",
      field: "lifecycleSettings.controlsEnabled",
      message: "Hosted-kernel lifecycle controls are disabled for panic-stop execution.",
      action: "Enable lifecycle controls before arming, committing, or scheduling panic-stop."
    });
  }

  if (!lifecycleSettings.panicStopEnabled && ["arm", "commit", "schedule"].includes(lifecycleCommand.command)) {
    errors.push({
      code: "panic_stop_disabled",
      field: "lifecycleSettings.panicStopEnabled",
      message: "Panic-stop is disabled by lifecycle settings.",
      action: "Use the enable command with settings authority before requesting panic-stop."
    });
  }

  if (["enable", "disable"].includes(lifecycleCommand.command) && !hasSettingsAuthority(actor, scope)) {
    errors.push({
      code: "missing_settings_authority",
      field: "actor.permissions",
      message: "Enable and disable commands require hosted-kernel lifecycle settings authority.",
      action: "Use kernel-admin or grant kernel:panic-stop:settings for this operation."
    });
  }

  for (const rejectedField of settingsMutation.rejectedFields) {
    errors.push({
      code: rejectedField.code,
      field: rejectedField.field,
      message: rejectedField.message,
      action: "Repair the hosted-kernel panic-stop settings patch before retrying."
    });
  }

  if (settingsMutation.guardrails.disablesActiveSchedule) {
    errors.push({
      code: "settings_disable_active_schedule",
      field: "settingsDelta",
      message: "Panic-stop settings cannot disable an active scheduled stop.",
      action: "Cancel the active schedule before disabling panic-stop or scheduling controls."
    });
  }

  if (settingsMutation.activeSchedule.outsideRequestedWindow) {
    errors.push({
      code: "active_schedule_outside_requested_window",
      field: "settingsDelta.scheduleWindowMs",
      message: "The requested schedule window would strand the active scheduled panic-stop outside policy.",
      action: "Choose a schedule window that still contains the active schedule, or cancel the schedule first."
    });
  }

  if (!settingsMutation.guardrails.controlsRemainReachable) {
    errors.push({
      code: "settings_controls_unreachable",
      field: "settingsDelta.controlsEnabled",
      message: "Panic-stop settings cannot make lifecycle controls unreachable for hosted-kernel recovery.",
      action: "Keep controlsEnabled true, or use disable to turn off panic-stop without hiding recovery controls."
    });
  }

  if (lifecycleCommand.command === "schedule") {
    if (!lifecycleSettings.schedulingEnabled) {
      errors.push({
        code: "scheduling_disabled",
        field: "lifecycleSettings.schedulingEnabled",
        message: "Scheduled panic-stop is disabled for this hosted-kernel scope.",
        action: "Enable scheduling or commit panic-stop immediately."
      });
    }
    if (scheduleRequest.delayMs < MIN_SCHEDULE_DELAY_MS || scheduleRequest.delayMs > lifecycleSettings.scheduleWindowMs) {
      errors.push({
        code: "schedule_window_violation",
        field: "scheduledFor",
        message: "Scheduled panic-stop must be inside the configured hosted-kernel schedule window.",
        action: `Choose a delay between ${MIN_SCHEDULE_DELAY_MS}ms and ${lifecycleSettings.scheduleWindowMs}ms.`
      });
    }
  }

  if (["commit", "schedule"].includes(lifecycleCommand.command) && hazardAssessment.declared) {
    if (!hazardAssessment.targetCoverageComplete) {
      errors.push({
        code: "runtime_hazard_stop_targets_missing",
        field: "runtimeHazardAssessment.stopTargets",
        message: "Unsafe jobs, runaway workers, and external-write risks require explicit stop targets for panic-stop.",
        action: `Attach stop targets for: ${hazardAssessment.missingStopTargetKinds.join(", ")}.`
      });
    }
    if (lifecycleCommand.command === "schedule" && hazardAssessment.requiresImmediateCommit) {
      errors.push({
        code: "runtime_hazard_requires_immediate_commit",
        field: "command",
        message: "Critical unsafe runtime hazards cannot be deferred through a scheduled panic-stop.",
        action: "Use commit to close scheduler admission and stop unsafe runtime targets immediately."
      });
    }
    if (hazardAssessment.externalWriteRisk && !hazardAssessment.externalWriteBoundary?.trusted) {
      errors.push({
        code: "external_write_boundary_untrusted",
        field: "runtimeHazardAssessment.externalWriteTargets",
        message: "External-write panic-stop targets must be explicitly bound to the requested tenant/workspace boundary.",
        action: hazardAssessment.externalWriteBoundary?.nextAction === "quarantine_cross_scope_external_write_targets"
          ? "Remove or quarantine external-write targets from other tenant/workspace boundaries before provider handoff."
          : "Attach tenant/workspace-qualified external-write targets before committing panic-stop."
      });
    }
  }

  if (hazardAssessment.safetyInterrupt?.currentCommandBlocked) {
    errors.push({
      code: "runtime_safety_interrupt_blocks_command",
      field: "command",
      message: "The requested lifecycle command is unsafe while runtime hazard containment is active.",
      action: hazardAssessment.safetyInterrupt.nextAction === "commit_panic_stop_immediately"
        ? "Use commit to close scheduler admission and stop unsafe runtime targets immediately."
        : "Repair the runtime hazard targets or external-write barrier before retrying this command."
    });
  }

  if (lifecycleCommand.command === "disable" && hazardAssessment.safetyInterrupt?.active) {
    errors.push({
      code: "runtime_hazard_blocks_panic_stop_disable",
      field: "settingsDelta.panicStopEnabled",
      message: "Panic-stop cannot be disabled while unsafe jobs, runaway workers, or external-write risk remain active.",
      action: "Commit panic-stop or clear the runtime safety interrupt before disabling panic-stop controls."
    });
  }

  if (scope.tenantId === SYSTEM_TENANT && scope.workspaceId !== GLOBAL_WORKSPACE) {
    errors.push({
      code: "invalid_system_scope",
      field: "requestedScope",
      message: "System tenant panic-stop scope must use the global workspace.",
      action: "Use system/global for a global stop or target a tenant workspace explicitly."
    });
  }

  if (evidence.length === 0) {
    errors.push({
      code: "missing_incident_evidence",
      field: "evidence",
      message: "Panic-stop requests require incident evidence for audit replay.",
      action: "Attach at least one incident, detector, or operator evidence item."
    });
  }

  if (lifecycleSettings.requireDualControl && cleanList(evidence.map((item) => item?.approvedBy)).length < 2) {
    errors.push({
      code: "dual_control_evidence_required",
      field: "evidence.approvedBy",
      message: "This hosted-kernel scope requires two distinct approval evidence entries.",
      action: "Attach evidence from two distinct approvers before committing panic-stop."
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function evaluatePanicStopBoundary({ actor, scope, requestedAction, lifecycleCommand }) {
  const violations = [];
  const permissionProfile = buildScopedPermissionProfile({ actor, scope, lifecycleCommand });
  const hasPrivilegedRole = actor.roles.some((role) => PANIC_STOP_ROLES.has(role));
  const hasReadOnlyRole = actor.roles.some((role) => READ_ONLY_ROLES.has(role));
  const hasExplicitPermission = permissionProfile.hasScopedCommandGrant;
  const hasTenantWildcard = permissionProfile.hasTenantWildcard;
  const hasKernelWildcard = permissionProfile.hasKernelWildcard;
  const settingsCommand = ["enable", "disable"].includes(lifecycleCommand?.command);
  const settingsAuthority = settingsCommand && permissionProfile.hasSettingsAuthority;
  const sameTenant = actor.tenantId === scope.tenantId;
  const sameWorkspace = actor.workspaceId === scope.workspaceId;
  const globalStop = scope.tenantId === SYSTEM_TENANT && scope.workspaceId === GLOBAL_WORKSPACE;
  const roleOnlyCrossScope = hasPrivilegedRole && (!sameTenant || !sameWorkspace) && !hasKernelWildcard && !hasTenantWildcard;
  const scopedGrantRejected = permissionProfile.scopedMismatches.length > 0
    && !hasExplicitPermission
    && !hasKernelWildcard
    && !hasTenantWildcard
    && !globalStop;

  if (requestedAction !== "panic-stop") {
    violations.push({
      code: "unsupported_action",
      message: "Only panic-stop requests can enter this lifecycle boundary."
    });
  }

  if (!hasPrivilegedRole && !hasExplicitPermission && !hasKernelWildcard && !settingsAuthority) {
    violations.push({
      code: "missing_panic_stop_authority",
      message: "Actor lacks a role or permission that can stop hosted kernel execution."
    });
  }

  if (scopedGrantRejected) {
    violations.push({
      code: "scoped_permission_mismatch",
      message: "Actor has panic-stop permissions, but none match the requested tenant/workspace boundary."
    });
  }

  if (hasReadOnlyRole && !hasPrivilegedRole && !hasExplicitPermission && !hasKernelWildcard && !settingsAuthority) {
    violations.push({
      code: "read_only_role",
      message: "Read-only lifecycle roles may observe panic-stop state but cannot trigger it."
    });
  }

  if (!sameTenant && !hasTenantWildcard && !globalStop) {
    violations.push({
      code: "tenant_boundary_violation",
      message: "Panic-stop request cannot cross tenant boundaries without tenant wildcard authority."
    });
  }

  if (!sameWorkspace && !hasKernelWildcard && !globalStop) {
    violations.push({
      code: "workspace_boundary_violation",
      message: "Panic-stop request cannot cross workspace boundaries without kernel wildcard authority."
    });
  }

  if (roleOnlyCrossScope) {
    violations.push({
      code: "role_only_cross_scope_denied",
      message: "Privileged panic-stop roles must be paired with a scoped wildcard permission before crossing actor scope."
    });
  }

  return {
    allowed: violations.length === 0,
    sameTenant,
    sameWorkspace,
    globalStop,
    boundaryMode: globalStop
      ? "global_system_scope"
      : sameTenant && sameWorkspace
        ? "actor_workspace_scope"
        : sameTenant
          ? "tenant_cross_workspace_scope"
          : "cross_tenant_scope",
    isolationProof: {
      schema: "aios.kernelLifecycle.panicStop.boundaryProof.v1",
      actorScopeKey: `${actor.tenantId}:${actor.workspaceId}`,
      requestedScopeKey: scope.boundaryKey,
      scopedGrantRequired: !globalStop && (!sameTenant || !sameWorkspace),
      scopedGrantSatisfied: hasExplicitPermission || hasTenantWildcard || hasKernelWildcard || globalStop,
      commandGrantIds: permissionProfile.proofClaims.commandGrantIds,
      scopedMismatchCount: permissionProfile.proofClaims.scopedMismatchCount,
      roleOnlyCrossScope
    },
    permissionProfile,
    authority: hasKernelWildcard
      ? "kernel_wildcard"
      : hasTenantWildcard
        ? "tenant_wildcard"
        : hasExplicitPermission
          ? "explicit_permission"
          : settingsAuthority
            ? "settings_authority"
            : hasPrivilegedRole
              ? "privileged_role"
              : "none",
    violations
  };
}

function buildHazardIsolationHealth({ hazardAssessment, providerNegotiation }) {
  const interrupt = hazardAssessment?.safetyInterrupt ?? {};
  const externalWriteBoundary = hazardAssessment?.externalWriteBoundary ?? {};
  const providerHazardBlocks = (providerNegotiation?.rejectedProviders ?? [])
    .filter((provider) => provider.hazardContract?.required === true)
    .map((provider) => ({
      providerName: provider.providerName,
      missingCapabilities: provider.hazardContract?.missingCapabilities ?? [],
      failClosedRequired: provider.hazardContract?.failClosedRequired === true,
      requiredAction: provider.hazardContract?.missingCapabilities?.length > 0
        ? "enable_runtime_hazard_capabilities"
        : "restore_runtime_hazard_provider_contract"
    }));
  const containmentBlockers = [
    interrupt.currentCommandBlocked ? "runtime_safety_interrupt_blocks_command" : null,
    hazardAssessment?.targetCoverageComplete === false ? "runtime_hazard_stop_targets_missing" : null,
    externalWriteBoundary.failClosed ? "external_write_boundary_fail_closed" : null,
    providerHazardBlocks.some((provider) => provider.failClosedRequired)
      ? "fail_closed_provider_hazard_contract_blocked"
      : null
  ].filter(Boolean);
  const degradedReasons = [
    hazardAssessment?.declared && interrupt.active && containmentBlockers.length === 0
      ? "runtime_safety_interrupt_active"
      : null,
    hazardAssessment?.externalWriteRisk && externalWriteBoundary.trusted === true
      ? "external_write_barrier_requires_provider_ack"
      : null,
    providerHazardBlocks.length > 0 && containmentBlockers.length === 0
      ? "runtime_hazard_provider_repair_pending"
      : null
  ].filter(Boolean);
  const healthState = containmentBlockers.length > 0
    ? "blocked"
    : degradedReasons.length > 0
      ? "degraded"
      : hazardAssessment?.declared
        ? "guarded"
        : "not_required";

  return {
    schema: "aios.kernelLifecycle.panicStop.hazardIsolationHealth.v1",
    state: healthState,
    declared: hazardAssessment?.declared === true,
    failClosed: containmentBlockers.length > 0 && hazardAssessment?.externalWriteRisk === true,
    containmentBlockers,
    degradedReasons,
    providerHazardBlocks,
    targetCoverageComplete: hazardAssessment?.targetCoverageComplete ?? true,
    externalWriteBoundaryTrusted: externalWriteBoundary.trusted ?? true,
    interruptLevel: interrupt.level ?? "none",
    currentCommandBlocked: interrupt.currentCommandBlocked === true,
    retryClass: containmentBlockers.includes("external_write_boundary_fail_closed")
      || containmentBlockers.includes("runtime_hazard_stop_targets_missing")
      ? "terminal_runtime_hazard_repair"
      : providerHazardBlocks.length > 0
        ? "operator_repair_required"
        : degradedReasons.length > 0
          ? "transient_hazard_ack_or_reconcile"
          : "no_retry_needed",
    nextAction: containmentBlockers.includes("runtime_safety_interrupt_blocks_command")
      ? interrupt.nextAction ?? "commit_panic_stop_immediately"
      : containmentBlockers.includes("runtime_hazard_stop_targets_missing")
        ? "attach_runtime_hazard_stop_targets"
        : containmentBlockers.includes("external_write_boundary_fail_closed")
          ? externalWriteBoundary.nextAction ?? "bind_external_write_targets_to_requested_scope"
          : providerHazardBlocks.length > 0
            ? "repair_runtime_hazard_provider_contracts"
            : degradedReasons.length > 0
              ? "proceed_with_fail_closed_hazard_monitoring"
              : "continue_requested_lifecycle_command"
  };
}

function evaluateOperationalHealth({ dependencies, validation, providerNegotiation, hazardAssessment }) {
  const unavailable = dependencies.filter((dependency) => dependency.status === "unavailable");
  const degraded = dependencies.filter((dependency) => dependency.status === "degraded");
  const unknown = dependencies.filter((dependency) => dependency.status === "unknown");
  const hazardIsolation = buildHazardIsolationHealth({ hazardAssessment, providerNegotiation });
  const blockers = [];

  if (!validation.valid) {
    blockers.push("request_validation_failed");
  }

  if (unavailable.length > 0) {
    blockers.push("required_dependency_unavailable");
  }

  if (providerNegotiation && !providerNegotiation.ready) {
    blockers.push("provider_contract_negotiation_failed");
  }

  if (hazardIsolation.state === "blocked") {
    blockers.push("runtime_hazard_isolation_blocked");
  }

  return {
    status: blockers.length > 0 || providerNegotiation?.ready === false
      ? "unhealthy"
      : degraded.length > 0 || unknown.length > 0 || providerNegotiation?.degraded === true || hazardIsolation.state === "degraded"
        ? "degraded"
        : "healthy",
    canCommitStop: blockers.length === 0,
    degradedMode: blockers.length === 0
      && (degraded.length > 0 || unknown.length > 0 || providerNegotiation?.degraded === true || hazardIsolation.state === "degraded"),
    dependencySummary: {
      healthy: dependencies.filter((dependency) => dependency.status === "healthy").length,
      degraded: degraded.length,
      unavailable: unavailable.length,
      unknown: unknown.length
    },
    hazardIsolation,
    blockers,
    dependencies
  };
}

function providerRetryClass(provider) {
  if (provider.boundaryViolation) {
    return "terminal_provider_scope_repair";
  }
  if (provider.syncConflict || provider.syncContract?.stale || provider.syncContract?.ackBehind) {
    return "transient_provider_sync";
  }
  if (provider.providerStatus === "unavailable" || provider.dependencyStatus === "unavailable") {
    return "transient_provider_outage";
  }
  if (provider.providerStatus === "degraded" || provider.dependencyStatus === "degraded") {
    return "transient_provider_degraded";
  }
  if (provider.contractMismatch || provider.missingCapabilities.length > 0 || provider.serviceDeclinedHandoff) {
    return "operator_repair_required";
  }
  return "manual_triage_required";
}

function buildRetryCauses({ health, validation, boundary, providerNegotiation }) {
  const dependencyCauses = health.dependencies
    .filter((dependency) => ["unavailable", "unknown", "degraded"].includes(dependency.status))
    .map((dependency) => ({
      code: `dependency_${dependency.status}`,
      source: "dependency",
      target: dependency.name,
      retryClass: dependency.status === "unavailable" ? "transient_dependency_outage" : "transient_dependency_degraded",
      operatorRepairRequired: false
    }));
  const validationCauses = validation.errors.map((error) => ({
    code: error.code,
    source: "request_validation",
    target: error.field,
    retryClass: "terminal_request_repair",
    operatorRepairRequired: true
  }));
  const boundaryCauses = boundary.violations.map((violation) => ({
    code: violation.code,
    source: "boundary",
    target: "actor.permissions",
    retryClass: "terminal_authorization_repair",
    operatorRepairRequired: true
  }));
  const providerCauses = (providerNegotiation?.rejectedProviders ?? []).map((provider) => {
    const retryClass = providerRetryClass(provider);
    return {
      code: `provider_${provider.providerName}_not_negotiated`,
      source: "provider_contract",
      target: provider.providerName,
      retryClass,
      operatorRepairRequired: retryClass === "operator_repair_required" || retryClass === "manual_triage_required"
    };
  });
  const hazardCauses = (health.hazardIsolation?.containmentBlockers ?? []).map((code) => ({
    code,
    source: "runtime_hazard_isolation",
    target: "runtimeHazardAssessment",
    retryClass: health.hazardIsolation.retryClass,
    operatorRepairRequired: health.hazardIsolation.retryClass !== "transient_hazard_ack_or_reconcile"
  }));

  return [...dependencyCauses, ...validationCauses, ...boundaryCauses, ...providerCauses, ...hazardCauses];
}

function chooseRetryClass(retryCauses) {
  if (retryCauses.some((cause) => cause.retryClass.startsWith("terminal_"))) {
    return "blocked_until_request_or_authorization_repaired";
  }
  if (retryCauses.some((cause) => cause.retryClass === "operator_repair_required")) {
    return "blocked_until_provider_contract_repaired";
  }
  if (retryCauses.some((cause) => cause.retryClass === "manual_triage_required")) {
    return "blocked_until_manual_triage";
  }
  if (retryCauses.some((cause) => cause.retryClass === "transient_provider_sync")) {
    return "retry_after_provider_sync_refresh";
  }
  if (retryCauses.some((cause) => cause.retryClass === "transient_hazard_ack_or_reconcile")) {
    return "retry_after_hazard_reconcile";
  }
  if (retryCauses.some((cause) => cause.retryClass.includes("outage"))) {
    return "retry_after_dependency_recovery";
  }
  if (retryCauses.some((cause) => cause.retryClass.includes("degraded"))) {
    return "retry_after_short_health_probe";
  }
  return "no_retry_needed";
}

function retryBackoffForClass({ retryClass, attempt }) {
  if (retryClass === "retry_after_short_health_probe"
    || retryClass === "retry_after_provider_sync_refresh"
    || retryClass === "retry_after_hazard_reconcile") {
    return Math.min(MAX_RETRY_BACKOFF_MS, FAST_RETRY_BACKOFF_MS * (2 ** Math.min(attempt, 5)));
  }
  if (retryClass === "blocked_until_provider_contract_repaired" || retryClass === "blocked_until_manual_triage") {
    return OPERATOR_REPAIR_BACKOFF_MS;
  }
  if (retryClass === "retry_after_dependency_recovery") {
    return Math.min(MAX_RETRY_BACKOFF_MS, BASE_RETRY_BACKOFF_MS * (2 ** Math.min(attempt + 1, 6)));
  }
  return 0;
}

function buildRetryPolicy({ input, health, validation, boundary, lifecycleCommand, providerNegotiation }) {
  const attempt = cleanPositiveInteger(input.retryAttempt, 0);
  const remainingAttempts = Math.max(0, MAX_RETRY_ATTEMPTS - attempt);
  const retryCauses = buildRetryCauses({ health, validation, boundary, providerNegotiation });
  const retryClass = chooseRetryClass(retryCauses);
  const retryableClass = retryClass.startsWith("retry_after_");
  const retryable = retryableClass && remainingAttempts > 0;
  const backoffMs = retryable ? retryBackoffForClass({ retryClass, attempt }) : 0;
  const healthyNextAction = lifecycleCommand.command === "schedule"
    ? "write_scheduled_panic_stop"
    : lifecycleCommand.command === "cancel-scheduled"
      ? "cancel_scheduled_panic_stop"
      : lifecycleCommand.command === "enable"
        ? "enable_panic_stop_controls"
        : lifecycleCommand.command === "disable"
          ? "disable_panic_stop_controls"
          : lifecycleCommand.command === "arm"
            ? "arm_panic_stop"
            : "commit_panic_stop";

  return {
    retryable,
    attempt,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    remainingAttempts,
    backoffMs,
    class: retryClass,
    terminal: retryCauses.some((cause) => cause.retryClass.startsWith("terminal_")),
    operatorRepairRequired: retryCauses.some((cause) => cause.operatorRepairRequired),
    causeCodes: retryCauses.map((cause) => cause.code),
    causes: retryCauses,
    nextAction: retryable
      ? "retry_after_backoff"
      : health.status === "healthy"
        ? healthyNextAction
        : "escalate_to_incident_commander"
  };
}

function addMillisecondsToIso(value, milliseconds) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || milliseconds <= 0) {
    return null;
  }
  return new Date(parsed + milliseconds).toISOString();
}

function buildOperationalResponse({ now, lifecycleCommand, health, validation, boundary, retryPolicy, providerNegotiation }) {
  const validationCodes = validation.errors.map((error) => error.code);
  const boundaryCodes = boundary.violations.map((violation) => violation.code);
  const unavailableDependencies = health.dependencies.filter((dependency) => dependency.status === "unavailable");
  const degradedDependencies = health.dependencies.filter((dependency) => dependency.status === "degraded" || dependency.status === "unknown");
  const providerRepairs = (providerNegotiation?.rejectedProviders ?? []).map((provider) => ({
    providerName: provider.providerName,
    status: provider.providerStatus,
    dependencyStatus: provider.dependencyStatus,
      requiredAction: provider.contractMismatch
        ? "upgrade_provider_contract"
        : provider.syncConflict
          ? "refresh_provider_sync_cursor"
        : provider.boundaryViolation
          ? "quarantine_cross_scope_provider_cursor"
        : provider.serviceDeclinedHandoff
          ? "enable_external_handoff"
          : provider.hazardContract?.missingCapabilities?.length > 0
            ? "enable_runtime_hazard_capabilities"
          : provider.missingCapabilities.length > 0
            ? "enable_missing_capabilities"
            : provider.providerStatus === "readonly"
              ? "restore_writeable_provider"
              : "restore_provider_availability",
    missingCapabilities: provider.missingCapabilities,
    hazardContract: provider.hazardContract,
    expectedContractVersion: provider.expectedContractVersion,
    contractVersion: provider.contractVersion,
    syncContract: provider.syncContract
  }));
  const blockedReasons = [
    ...validationCodes,
    ...boundaryCodes,
    ...unavailableDependencies.map((dependency) => `${dependency.name}_unavailable`),
    ...providerRepairs.map((provider) => `${provider.providerName}_contract_blocked`),
    ...(health.hazardIsolation?.state === "blocked" ? health.hazardIsolation.containmentBlockers : [])
  ];
  const degradedReasons = [
    ...degradedDependencies.map((dependency) => `${dependency.name}_${dependency.status}`),
    ...(providerNegotiation?.degraded ? ["provider_sync_degraded"] : []),
    ...(health.hazardIsolation?.state === "degraded" ? health.hazardIsolation.degradedReasons : [])
  ];
  const settingsCommand = ["enable", "disable"].includes(lifecycleCommand.command);
  const failClosed = blockedReasons.length > 0 && !settingsCommand;
  const blockedRetryable = blockedReasons.length > 0 && retryPolicy.retryable;
  const retryAfter = blockedRetryable ? addMillisecondsToIso(now, retryPolicy.backoffMs) : null;
  const severity = blockedReasons.some((reason) => reason.endsWith("_unavailable") || reason.endsWith("_contract_blocked"))
    ? "critical"
    : blockedReasons.length > 0
      ? "error"
      : degradedReasons.length > 0
        ? "warning"
        : "normal";
  const nextAction = blockedReasons.length > 0
    ? retryPolicy.retryable
      ? "retry_after_backoff_with_same_command_key"
      : "escalate_with_actionable_errors"
    : degradedReasons.length > 0
      ? "proceed_in_degraded_mode_with_local_audit_proof"
      : retryPolicy.nextAction;

  return {
    schema: "aios.kernelLifecycle.panicStop.operationalResponse.v1",
    generatedAt: now,
    command: lifecycleCommand.command,
    status: blockedReasons.length > 0 ? "blocked" : degradedReasons.length > 0 ? "degraded" : "ready",
    severity,
    failClosed,
    retry: {
      retryable: blockedRetryable,
      attempt: retryPolicy.attempt,
      remainingAttempts: retryPolicy.remainingAttempts,
      backoffMs: blockedRetryable ? retryPolicy.backoffMs : 0,
      retryAfter,
      idempotencyRequirement: blockedRetryable ? "reuse_command_key" : "none",
      class: retryPolicy.class,
      terminal: retryPolicy.terminal,
      operatorRepairRequired: retryPolicy.operatorRepairRequired,
      causeCodes: retryPolicy.causeCodes,
      causes: retryPolicy.causes
    },
    degradedMode: {
      active: degradedReasons.length > 0 && blockedReasons.length === 0,
      reasons: degradedReasons,
      providerSyncMode: degradedReasons.length > 0 ? "local_audit_first_then_provider_reconcile" : "coordinated",
      hazardIsolationMode: health.hazardIsolation?.state === "degraded"
        ? "fail_closed_monitoring_with_reconcile"
        : "standard"
    },
    failureContainment: {
      blockedReasons,
      validationCodes,
      boundaryCodes,
      unavailableDependencies: unavailableDependencies.map((dependency) => dependency.name),
      hazardIsolation: health.hazardIsolation,
      failClosedState: health.hazardIsolation?.failClosed
        ? "external_write_and_runtime_targets_fail_closed"
        : failClosed ? "scheduler_admission_unchanged" : "not_required"
    },
    providerRepairs,
    proofRequirements: {
      auditProofRequired: true,
      incidentLedgerRequired: lifecycleCommand.command !== "cancel-scheduled",
      includeDependencySnapshot: health.status !== "healthy",
      includeProviderNegotiation: providerRepairs.length > 0 || providerNegotiation?.degraded === true
    },
    userMessage: blockedReasons.length > 0
      ? health.hazardIsolation?.state === "blocked"
        ? "Panic-stop is blocked until runtime hazard isolation is repaired or committed safely."
        : "Panic-stop is blocked until the listed lifecycle errors are repaired."
      : degradedReasons.length > 0
        ? health.hazardIsolation?.state === "degraded"
          ? "Panic-stop can proceed with fail-closed hazard monitoring and later provider reconciliation."
          : "Panic-stop can proceed in degraded mode with local audit proof and later provider reconciliation."
        : "Panic-stop dependencies and provider contracts are ready.",
    nextAction
  };
}

function buildLifecycleCommandPlan({
  now,
  actor,
  lifecycleCommand,
  lifecycleSettings,
  hazardAssessment,
  settingsMutation,
  scheduleRequest,
  boundary,
  health,
  failureState,
  providerNegotiation,
  operationalResponse
}) {
  const blocked = !boundary.allowed || !health.canCommitStop || failureState.failed;
  const route = lifecycleCommand.command === "schedule"
    ? "scheduler-gate"
    : lifecycleCommand.command === "cancel-scheduled"
      ? "scheduler-gate"
      : ["enable", "disable"].includes(lifecycleCommand.command)
        ? "hosted-kernel-registry"
        : "hosted-kernel-registry";

  return {
    schema: "aios.kernelLifecycle.panicStop.commandPlan.v1",
    command: lifecycleCommand.command,
    requestedCommand: lifecycleCommand.requestedCommand,
    accepted: lifecycleCommand.recognized && !blocked,
    route,
    generatedAt: now,
    actorId: actor.actorId,
    settingsAuthority: boundary.permissionProfile.hasSettingsAuthority,
    boundary: {
      boundaryMode: boundary.boundaryMode,
      authority: boundary.authority,
      actorScopeKey: boundary.isolationProof.actorScopeKey,
      requestedScopeKey: boundary.isolationProof.requestedScopeKey,
      scopedGrantRequired: boundary.isolationProof.scopedGrantRequired,
      scopedGrantSatisfied: boundary.isolationProof.scopedGrantSatisfied,
      commandGrantIds: boundary.isolationProof.commandGrantIds,
      scopedMismatchCount: boundary.isolationProof.scopedMismatchCount,
      roleOnlyCrossScope: boundary.isolationProof.roleOnlyCrossScope
    },
    schedule: {
      requestedAt: scheduleRequest.requestedAt,
      scheduledFor: lifecycleCommand.command === "schedule" ? scheduleRequest.scheduledFor : null,
      delayMs: lifecycleCommand.command === "schedule" ? scheduleRequest.delayMs : 0,
      windowMs: lifecycleSettings.scheduleWindowMs
    },
    runtimeHazards: {
      schema: hazardAssessment.schema,
      declared: hazardAssessment.declared,
      hazardCount: hazardAssessment.hazardCount,
      containmentMode: hazardAssessment.containmentMode,
      requiresImmediateCommit: hazardAssessment.requiresImmediateCommit,
      externalWriteBoundary: hazardAssessment.externalWriteBoundary,
      targetCoverageComplete: hazardAssessment.targetCoverageComplete,
      missingStopTargetKinds: hazardAssessment.missingStopTargetKinds,
      safetyInterrupt: hazardAssessment.safetyInterrupt,
      providerStopContract: hazardAssessment.providerStopContract
    },
    settingsDelta: settingsMutation.requestedPatch,
    settingsMutation: {
      schema: settingsMutation.schema,
      providerWriteRequired: settingsMutation.providerWrite.required,
      providerWriteSchema: settingsMutation.providerWrite.expectedSchema,
      rejectedFieldCount: settingsMutation.rejectedFields.length,
      guardrails: settingsMutation.guardrails,
      nextAction: settingsMutation.nextAction
    },
    nextAction: blocked
      ? hazardAssessment.safetyInterrupt?.currentCommandBlocked
        ? hazardAssessment.safetyInterrupt.nextAction
        : operationalResponse?.nextAction ?? (failureState.retryable ? "retry_or_escalate" : "repair_request_before_lifecycle_change")
      : lifecycleCommand.command === "schedule"
        ? "persist_scheduled_stop_and_close_scheduler_admission_at_due_time"
        : lifecycleCommand.command === "cancel-scheduled"
          ? "remove_scheduled_stop_and_emit_audit_proof"
          : lifecycleCommand.command === "enable"
            ? "enable_controls_and_record_settings_proof"
            : lifecycleCommand.command === "disable"
              ? "disable_panic_stop_and_record_settings_proof"
              : lifecycleCommand.command === "arm"
                ? "arm_stop_with_audit_proof"
                : "close_scheduler_admission_and_commit_stop",
    providerContract: {
      schema: providerNegotiation.schema,
      ready: providerNegotiation.ready,
      degraded: providerNegotiation.degraded,
      negotiatedProviderCount: providerNegotiation.negotiatedProviderCount,
      requiredProviderCount: providerNegotiation.requiredProviderCount,
      hazardCapabilitySummary: providerNegotiation.hazardCapabilitySummary,
      primaryRouteReady: providerNegotiation.negotiations.some((item) => item.providerName === route && item.negotiated)
    },
    operationalResponse: {
      status: operationalResponse?.status ?? "unknown",
      severity: operationalResponse?.severity ?? "unknown",
      failClosed: operationalResponse?.failClosed ?? blocked,
      retryAfter: operationalResponse?.retry?.retryAfter ?? null,
      retryClass: operationalResponse?.retry?.class ?? "unknown",
      retryCauseCodes: operationalResponse?.retry?.causeCodes ?? [],
      degradedProviderSync: operationalResponse?.degradedMode?.providerSyncMode ?? "unknown",
      hazardIsolationState: operationalResponse?.failureContainment?.hazardIsolation?.state ?? "unknown",
      hazardIsolationNextAction: operationalResponse?.failureContainment?.hazardIsolation?.nextAction ?? "unknown"
    },
    proofRequired: true
  };
}

function buildSafeState({ boundary, health, lifecycleCommand, commandPlan, persistenceRecoveryState }) {
  if (persistenceRecoveryState?.idempotency?.duplicateCompletedCommand) {
    return {
      lifecycleState: "panic-stop-already-applied",
      schedulerAdmission: "unchanged",
      workspaceIsolation: "preserved",
      degradedMode: health.degradedMode,
      commitMode: "idempotent-replay",
      nextAction: "return_persisted_command_status",
      auditRequired: true,
      restartSafeStatus: persistenceRecoveryState.statusSemantics.restartSafeStatus
    };
  }

  if (persistenceRecoveryState?.recovery?.required) {
    return {
      lifecycleState: "panic-stop-recovery-pending",
      schedulerAdmission: "reconcile-before-dispatch",
      workspaceIsolation: "preserved",
      degradedMode: health.degradedMode,
      commitMode: "recovery-first",
      nextAction: persistenceRecoveryState.recovery.nextAction,
      auditRequired: true,
      restartSafeStatus: persistenceRecoveryState.statusSemantics.restartSafeStatus
    };
  }

  if (!commandPlan.accepted) {
    return {
      lifecycleState: boundary.allowed ? "panic-stop-health-blocked" : "panic-stop-denied",
      schedulerAdmission: "unchanged",
      workspaceIsolation: "preserved",
      degradedMode: health.degradedMode,
      commitMode: "blocked",
      nextAction: commandPlan.nextAction,
      auditRequired: true,
      restartSafeStatus: persistenceRecoveryState?.statusSemantics?.restartSafeStatus ?? "blocked_not_persisted"
    };
  }

  const commandStates = {
    arm: {
      lifecycleState: "panic-stop-armed",
      schedulerAdmission: "guarded",
      commitMode: "armed"
    },
    commit: {
      lifecycleState: "panic-stop-committed",
      schedulerAdmission: health.degradedMode ? "closing-with-local-proof" : "closed",
      commitMode: health.degradedMode ? "local-proof-first" : "coordinated"
    },
    schedule: {
      lifecycleState: "panic-stop-scheduled",
      schedulerAdmission: "open-until-scheduled-stop",
      commitMode: "scheduled"
    },
    "cancel-scheduled": {
      lifecycleState: "panic-stop-schedule-cancelled",
      schedulerAdmission: "unchanged",
      commitMode: "cancelled"
    },
    enable: {
      lifecycleState: "panic-stop-controls-enabled",
      schedulerAdmission: "unchanged",
      commitMode: "settings-updated"
    },
    disable: {
      lifecycleState: "panic-stop-controls-disabled",
      schedulerAdmission: "unchanged",
      commitMode: "settings-updated"
    }
  };
  const state = commandStates[lifecycleCommand.command] ?? commandStates.commit;

  return {
    ...state,
    workspaceIsolation: "enforced",
    degradedMode: health.degradedMode,
    nextAction: commandPlan.nextAction,
    auditRequired: true,
    restartSafeStatus: persistenceRecoveryState?.statusSemantics?.restartSafeStatus ?? "pending_persisted_dispatch"
  };
}

function buildFailureState({ boundary, health, validation, retryPolicy, providerNegotiation }) {
  const actionableErrors = [
    ...validation.errors,
    ...boundary.violations.map((violation) => ({
      code: violation.code,
      field: "actor.permissions",
      message: violation.message,
      action: "Use an authorized panic-stop operator or narrow the requested scope."
    })),
    ...health.dependencies
      .filter((dependency) => dependency.status === "unavailable")
      .map((dependency) => ({
        code: "dependency_unavailable",
        field: `dependencyHealth.${dependency.name}`,
        message: `${dependency.name} is unavailable for panic-stop commit.`,
        action: "Restore the dependency or route the incident to manual hosted-kernel containment."
      })),
    ...(health.hazardIsolation?.containmentBlockers ?? []).map((code) => ({
      code,
      field: "runtimeHazardAssessment",
      message: "Runtime hazard isolation is not safe for panic-stop provider dispatch.",
      action: health.hazardIsolation.nextAction === "attach_runtime_hazard_stop_targets"
        ? "Attach explicit unsafe-job, runaway-worker, or external-write stop targets before retrying."
        : health.hazardIsolation.nextAction === "bind_external_write_targets_to_requested_scope"
          ? "Bind external-write targets to the requested tenant/workspace boundary before retrying."
          : health.hazardIsolation.nextAction === "repair_runtime_hazard_provider_contracts"
            ? "Repair provider hazard capabilities before dispatching panic-stop."
            : health.hazardIsolation.nextAction
    })),
    ...(providerNegotiation?.rejectedProviders ?? []).map((provider) => ({
      code: "provider_contract_not_negotiated",
      field: `integrationProviders.${provider.providerName}.capabilities`,
      message: `${provider.providerName} cannot accept the panic-stop handoff for this lifecycle command.`,
      action: provider.contractMismatch
        ? `Upgrade provider contract from ${provider.contractVersion} to ${provider.expectedContractVersion}.`
        : provider.syncConflict
          ? "Refresh the provider sync cursor because persisted panic-stop state is newer than the provider view."
          : provider.boundaryViolation
            ? "Reload or quarantine the provider cursor because it belongs to a different tenant/workspace boundary."
          : provider.serviceDeclinedHandoff
            ? "Enable external panic-stop handoff on the provider service contract."
            : provider.missingCapabilities.length > 0
              ? `Enable provider capabilities: ${provider.missingCapabilities.join(", ")}.`
              : "Restore provider availability or update its panic-stop contract before dispatch."
    }))
  ];

  return {
    failed: !boundary.allowed || !health.canCommitStop,
    failureCode: !boundary.allowed
      ? "panic_stop_boundary_denied"
      : !health.canCommitStop
        ? "panic_stop_health_blocked"
        : null,
    retryable: retryPolicy.retryable,
    actionableErrors
  };
}

function buildAuditHandoff({
  now,
  actor,
  scope,
  boundary,
  evidence,
  hazardAssessment,
  health,
  failureState,
  lifecycleCommand,
  commandPlan,
  operationalResponse,
  externalHandoffState,
  persistenceRecoveryState,
  providerDispatchEnvelope,
  providerMitigationPlan,
  restartRecoveryProjection
}) {
  return {
    auditType: "kernel_lifecycle_panic_stop_boundary_decision",
    surfaceId,
    decisionId: `${surfaceId}:${scope.boundaryKey}:${now}`,
    decisionAt: now,
    actorId: actor.actorId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    allowed: boundary.allowed,
    authority: boundary.authority,
    boundaryMode: boundary.boundaryMode,
    actorScopeKey: boundary.isolationProof.actorScopeKey,
    requestedScopeKey: boundary.isolationProof.requestedScopeKey,
    scopedGrantRequired: boundary.isolationProof.scopedGrantRequired,
    scopedGrantSatisfied: boundary.isolationProof.scopedGrantSatisfied,
    scopedPermissionGrantIds: boundary.isolationProof.commandGrantIds,
    scopedPermissionMismatchCount: boundary.isolationProof.scopedMismatchCount,
    roleOnlyCrossScope: boundary.isolationProof.roleOnlyCrossScope,
    lifecycleCommand: lifecycleCommand.command,
    commandAccepted: commandPlan.accepted,
    commandRoute: commandPlan.route,
    nextAction: commandPlan.nextAction,
    violationCodes: boundary.violations.map((violation) => violation.code),
    evidenceCount: evidence.length,
    runtimeHazardDeclared: hazardAssessment.declared,
    runtimeHazardCount: hazardAssessment.hazardCount,
    runtimeHazardContainmentMode: hazardAssessment.containmentMode,
    runtimeHazardStopTargets: hazardAssessment.stopTargets,
    runtimeHazardExternalWriteRisk: hazardAssessment.externalWriteRisk,
    runtimeHazardExternalWriteBoundaryTrusted: hazardAssessment.externalWriteBoundary?.trusted ?? true,
    runtimeHazardExternalWriteBoundaryViolations: hazardAssessment.externalWriteBoundary?.violationCodes ?? [],
    runtimeHazardRequiresImmediateCommit: hazardAssessment.requiresImmediateCommit,
    runtimeSafetyInterruptActive: hazardAssessment.safetyInterrupt?.active ?? false,
    runtimeSafetyInterruptLevel: hazardAssessment.safetyInterrupt?.level ?? "none",
    runtimeSafetyInterruptNextAction: hazardAssessment.safetyInterrupt?.nextAction ?? "continue_requested_lifecycle_command",
    runtimeHazardIsolationHealth: health.hazardIsolation,
    healthStatus: health.status,
    degradedMode: health.degradedMode,
    failureCode: failureState.failureCode,
    operationalStatus: operationalResponse.status,
    operationalSeverity: operationalResponse.severity,
    retryAfter: operationalResponse.retry.retryAfter,
    retryClass: operationalResponse.retry.class,
    retryCauseCodes: operationalResponse.retry.causeCodes,
    proofRequirements: operationalResponse.proofRequirements,
    externalHandoffId: externalHandoffState.handoffId,
    externalHandoffAccepted: externalHandoffState.accepted,
    externalHandoffMode: externalHandoffState.mode,
    providerDispatchId: providerDispatchEnvelope.dispatchId,
    providerDispatchable: providerDispatchEnvelope.dispatchable,
    providerDispatchMode: providerDispatchEnvelope.dispatchMode,
    providerMitigationStatus: providerMitigationPlan.status,
    providerMitigationRequired: providerMitigationPlan.mitigationRequired,
    providerMitigationCodes: providerMitigationPlan.mitigations.map((mitigation) => mitigation.code),
    restartRecoveryMode: restartRecoveryProjection.recoveryMode,
    completedProviderReceiptCount: restartRecoveryProjection.completedReceiptCount,
    incompleteProviderReceiptCount: restartRecoveryProjection.incompleteReceiptCount,
    restartFinalizable: restartRecoveryProjection.restartSafeStatus === "completed_restart_safe",
    commandKey: persistenceRecoveryState.commandKey,
    persistenceWriteIntent: persistenceRecoveryState.writeIntent,
    restartSafeStatus: persistenceRecoveryState.statusSemantics.restartSafeStatus,
    recoveryRequired: persistenceRecoveryState.recovery.required,
    auditProofId: providerDispatchEnvelope.auditProofOutput.proofId,
    auditProofSchema: providerDispatchEnvelope.auditProofOutput.proofSchema,
    providerContracts: externalHandoffState.providers.map((provider) => ({
      providerName: provider.providerName,
      contractVersion: provider.contractVersion,
      operation: provider.handoffContract?.operation ?? providerDispatchAction({ providerName: provider.providerName, lifecycleCommand }),
      inputSchema: provider.handoffContract?.inputSchema ?? null,
      resultSchema: provider.handoffContract?.resultSchema ?? null,
      syncBarrier: provider.handoffContract?.syncBarrier ?? "current_sync_checkpoint",
      boundaryMode: provider.handoffContract?.boundary?.handoffBoundaryMode
        ?? provider.providerBoundary?.handoffBoundaryMode
        ?? "inherit_request_scope",
      boundaryVerified: provider.handoffContract?.boundary?.boundaryMatches
        ?? provider.providerBoundary?.boundaryMatches
        ?? true,
      boundaryViolationCodes: provider.handoffContract?.boundary?.violationCodes
              ?? provider.providerBoundary?.violationCodes
              ?? [],
      runtimeHazardHandoffMode: provider.handoffContract?.runtimeHazard?.handoffMode
        ?? provider.hazardContract?.handoffMode
        ?? "standard_lifecycle_handoff",
      runtimeHazardCapabilities: provider.handoffContract?.runtimeHazard?.requiredCapabilities
        ?? provider.hazardContract?.requiredCapabilities
        ?? [],
      runtimeHazardFailClosed: provider.handoffContract?.runtimeHazard?.failClosedRequired
        ?? provider.hazardContract?.failClosedRequired
        ?? false,
      externalStateId: provider.externalStateId,
      providerScopeKey: provider.scopeKey,
      syncGeneration: provider.syncGeneration,
      ackGeneration: provider.ackGeneration,
      ackRequired: provider.handoffContract?.acknowledgement?.required ?? provider.serviceContract?.requiresAck ?? false,
      serviceId: provider.handoffContract?.serviceId ?? provider.serviceContract?.serviceId ?? provider.providerName,
      handoffSyncMode: provider.handoffSyncMode,
      staleSync: provider.staleSync,
      preconditionCodes: (provider.handoffContract?.preconditions ?? []).map((precondition) => precondition.code)
    })),
    providerDispatchActions: providerDispatchEnvelope.providerCommands.map((providerCommand) => ({
      providerName: providerCommand.providerName,
      action: providerCommand.action,
      runtimeHazardActionMode: providerCommand.runtimeHazardActionMode,
      runtimeHazardActions: providerCommand.payload.runtimeHazardProviderAction.actions,
      runtimeHazardPreconditionCodes: providerCommand.payload.runtimeHazardProviderAction.dispatchPreconditions
        .filter((precondition) => !precondition.satisfied)
        .map((precondition) => precondition.code),
      dispatchState: providerCommand.dispatchState,
      idempotencyKey: providerCommand.idempotencyKey,
      serviceContractOperation: providerCommand.handoffContract?.operation ?? providerCommand.payload.serviceHandoffContract.operation,
      serviceContractSyncBarrier: providerCommand.handoffContract?.syncBarrier ?? providerCommand.payload.serviceHandoffContract.syncBarrier,
      runtimeHazardHandoffMode: providerCommand.payload.serviceHandoffContract.runtimeHazard?.handoffMode
        ?? "standard_lifecycle_handoff",
      runtimeHazardRequiredCapabilities: providerCommand.payload.serviceHandoffContract.runtimeHazard?.requiredCapabilities ?? [],
      providerBoundaryMode: providerCommand.payload.serviceHandoffContract.boundary?.handoffBoundaryMode
        ?? "inherit_request_scope"
    })),
    providerServiceContractSummary: externalHandoffState.serviceContractSummary,
    runtimeHazardAssessment: hazardAssessment,
    providerMitigationPlan: {
      schema: providerMitigationPlan.schema,
      status: providerMitigationPlan.status,
      dispatchAllowed: providerMitigationPlan.dispatchAllowed,
      summary: providerMitigationPlan.summary,
      operatorRunbook: providerMitigationPlan.operatorRunbook
    },
    blockedProviderContracts: externalHandoffState.blockedProviders,
    boundaryProof: boundary.isolationProof,
    handoffChannels: ["kernel-audit-log", "tenant-incident-ledger"]
  };
}

function buildPreviewAcceptanceContract({
  now,
  actor,
  scope,
  lifecycleCommand,
  lifecycleSettings,
  hazardAssessment,
  scheduleRequest,
  validation,
  boundary,
  health,
  commandPlan,
  operationalResponse,
  persistenceRecoveryState,
  providerDispatchEnvelope,
  providerMitigationPlan
}) {
  const validationErrors = validation.errors.map((error) => ({
    code: error.code,
    field: error.field,
    message: error.message,
    repairAction: error.action
  }));
  const boundaryErrors = boundary.violations.map((violation) => ({
    code: violation.code,
    field: "actor.permissions",
    message: violation.message,
    repairAction: "Use an authorized panic-stop operator or adjust the hosted-kernel scope."
  }));
  const providerErrors = providerDispatchEnvelope.blockedProviderCommands.map((provider) => ({
    code: "provider_command_blocked",
    field: `integrationProviders.${provider.providerName}`,
    message: `${provider.providerName} cannot accept ${lifecycleCommand.command} for this panic-stop request.`,
    repairAction: provider.boundaryViolation
      ? "Reload the provider state for the requested tenant/workspace or quarantine the cross-scope cursor."
      : provider.missingCapabilities.length > 0
      ? `Enable capabilities: ${provider.missingCapabilities.join(", ")}.`
      : "Restore provider availability before accepting this lifecycle command."
  }));
  const providerMitigationErrors = providerMitigationPlan.mitigations
    .filter((mitigation) => mitigation.severity === "critical")
    .map((mitigation) => ({
      code: mitigation.code,
      field: `integrationProviders.${mitigation.providerName}`,
      message: `${mitigation.providerName} has a panic-stop provider mitigation that blocks dispatch.`,
      repairAction: mitigation.operatorAction
    }));
  const blockers = [...validationErrors, ...boundaryErrors, ...providerErrors, ...providerMitigationErrors];
  const duplicateReplay = persistenceRecoveryState.idempotency.duplicateCompletedCommand
    || persistenceRecoveryState.idempotency.scheduledCommandMatches;
  const readyToAccept = commandPlan.accepted
    && providerDispatchEnvelope.dispatchable
    && providerMitigationPlan.dispatchAllowed
    && !persistenceRecoveryState.recovery.required;
  const acceptanceState = duplicateReplay
    ? "accepted_replay"
    : readyToAccept
      ? "ready_for_operator_acceptance"
      : commandPlan.accepted
        ? "accepted_but_held"
        : "blocked";
  const previewHeadline = lifecycleCommand.command === "commit"
    ? "Commit hosted-kernel panic-stop"
    : lifecycleCommand.command === "schedule"
      ? "Schedule hosted-kernel panic-stop"
      : lifecycleCommand.command === "cancel-scheduled"
        ? "Cancel scheduled panic-stop"
        : lifecycleCommand.command === "arm"
          ? "Arm hosted-kernel panic-stop"
          : lifecycleCommand.command === "enable"
            ? "Enable panic-stop controls"
            : "Disable panic-stop controls";
  const impactedProviders = providerDispatchEnvelope.providerCommands.map((command) => ({
    providerName: command.providerName,
    action: command.action,
    runtimeHazardActionMode: command.runtimeHazardActionMode,
    runtimeHazardActions: command.payload.runtimeHazardProviderAction.actions,
    externalWriteBarrierRequired: command.payload.runtimeHazardProviderAction.externalWriteBarrier.required,
    runtimeHazardHandoffMode: command.payload.serviceHandoffContract.runtimeHazard?.handoffMode
      ?? "standard_lifecycle_handoff",
    runtimeHazardCapabilities: command.payload.serviceHandoffContract.runtimeHazard?.requiredCapabilities ?? [],
    runtimeHazardFailClosed: command.payload.serviceHandoffContract.runtimeHazard?.failClosedRequired ?? false,
    dispatchState: command.dispatchState,
    serviceOperation: command.handoffContract?.operation ?? command.payload.serviceHandoffContract.operation,
    syncBarrier: command.handoffContract?.syncBarrier ?? command.payload.serviceHandoffContract.syncBarrier,
    boundaryMode: command.payload.serviceHandoffContract.boundary?.handoffBoundaryMode ?? "inherit_request_scope",
    boundaryVerified: command.payload.serviceHandoffContract.boundary?.boundaryMatches ?? true,
    ackRequired: command.handoffContract?.acknowledgement?.required ?? command.payload.serviceHandoffContract.acknowledgement.required,
    proofLinked: command.providerName === "kernel-audit-log" || command.payload.evidenceRefs.length > 0
  }));
  const firstRepair = blockers[0]?.repairAction ?? null;
  const readyLabel = readyToAccept || duplicateReplay
    ? "ready"
    : operationalResponse.retry.retryable
      ? "retryable_block"
      : blockers.length > 0
        ? "blocked"
        : "held";

  return {
    schema: "aios.kernelLifecycle.panicStop.previewAcceptance.v1",
    generatedAt: now,
    preview: {
      headline: previewHeadline,
      scopeLabel: `${scope.tenantId}/${scope.workspaceId}`,
      actorLabel: actor.actorId,
      boundaryMode: boundary.boundaryMode,
      command: lifecycleCommand.command,
      commandKey: persistenceRecoveryState.commandKey,
      scheduledFor: lifecycleCommand.command === "schedule" ? scheduleRequest.scheduledFor : null,
      settingsDelta: commandPlan.settingsDelta,
      runtimeHazardLabel: hazardAssessment.declared
        ? hazardAssessment.containmentMode
        : "none",
      failClosed: operationalResponse.failClosed,
      expectedState: persistenceRecoveryState.nextPersistedState.lifecycleState,
      userMessage: operationalResponse.userMessage
    },
    acceptance: {
      state: acceptanceState,
      accepted: commandPlan.accepted,
      readyToDispatch: providerDispatchEnvelope.dispatchable,
      duplicateReplay,
      operatorConfirmationRequired: readyToAccept && lifecycleCommand.command === "commit",
      idempotencyKey: persistenceRecoveryState.commandKey,
      acceptRoute: commandPlan.route,
      proofId: providerDispatchEnvelope.auditProofOutput.proofId
    },
    boundary: {
      mode: boundary.boundaryMode,
      allowed: boundary.allowed,
      authority: boundary.authority,
      actorScopeKey: boundary.isolationProof.actorScopeKey,
      requestedScopeKey: boundary.isolationProof.requestedScopeKey,
      scopedGrantRequired: boundary.isolationProof.scopedGrantRequired,
      scopedGrantSatisfied: boundary.isolationProof.scopedGrantSatisfied,
      scopedMismatchCount: boundary.isolationProof.scopedMismatchCount,
      violationCodes: boundary.violations.map((violation) => violation.code)
    },
    readiness: {
      label: readyLabel,
      operationalStatus: operationalResponse.status,
      severity: operationalResponse.severity,
      dependencySummary: health.dependencySummary,
      hazardIsolationState: health.hazardIsolation?.state ?? "not_required",
      hazardIsolationBlockers: health.hazardIsolation?.containmentBlockers ?? [],
      hazardIsolationNextAction: health.hazardIsolation?.nextAction ?? "continue_requested_lifecycle_command",
      providerCommandCount: providerDispatchEnvelope.providerCommands.length,
      blockedProviderCommandCount: providerDispatchEnvelope.blockedProviderCommands.length,
      providerMitigationStatus: providerMitigationPlan.status,
      providerMitigationCount: providerMitigationPlan.summary.total,
      providerMitigationCriticalCount: providerMitigationPlan.summary.critical,
      persistenceWriteIntent: persistenceRecoveryState.writeIntent,
      restartSafeStatus: persistenceRecoveryState.statusSemantics.restartSafeStatus,
      recoveryRequired: persistenceRecoveryState.recovery.required,
      degradedMode: health.degradedMode,
      hazardIsolation: health.hazardIsolation,
      controlsEnabled: lifecycleSettings.controlsEnabled,
      panicStopEnabled: lifecycleSettings.panicStopEnabled,
      runtimeSafetyInterruptActive: hazardAssessment.safetyInterrupt?.active ?? false
    },
    runtimeHazards: {
      declared: hazardAssessment.declared,
      hazardCount: hazardAssessment.hazardCount,
      containmentMode: hazardAssessment.containmentMode,
      requiresImmediateCommit: hazardAssessment.requiresImmediateCommit,
      externalWriteRisk: hazardAssessment.externalWriteRisk,
      externalWriteBoundary: hazardAssessment.externalWriteBoundary,
      stopTargets: hazardAssessment.stopTargets,
      missingStopTargetKinds: hazardAssessment.missingStopTargetKinds,
      safetyInterrupt: hazardAssessment.safetyInterrupt,
      providerStopContract: hazardAssessment.providerStopContract
    },
    runtimeSafetyInterrupt: {
      active: hazardAssessment.safetyInterrupt?.active ?? false,
      level: hazardAssessment.safetyInterrupt?.level ?? "none",
      currentCommandBlocked: hazardAssessment.safetyInterrupt?.currentCommandBlocked ?? false,
      blockedCommands: hazardAssessment.safetyInterrupt?.blockedCommands ?? [],
      allowedCommands: hazardAssessment.safetyInterrupt?.allowedCommands ?? ["commit", "enable"],
      reasonCodes: hazardAssessment.safetyInterrupt?.reasonCodes ?? [],
      nextAction: hazardAssessment.safetyInterrupt?.nextAction ?? "continue_requested_lifecycle_command",
      targetSummary: hazardAssessment.safetyInterrupt?.targetSummary ?? {
        unsafeJobCount: 0,
        runawayWorkerCount: 0,
        externalWriteTargetCount: 0,
        missingStopTargetKinds: [],
        unresolvedExternalWriteTargets: [],
        externalWriteBoundaryTrusted: true,
        ambiguousExternalWriteTargetCount: 0,
        crossScopeExternalWriteTargetCount: 0
      }
    },
    validationSummary: {
      valid: validation.valid && boundary.allowed && providerErrors.length === 0,
      blockerCount: blockers.length,
      validationErrorCount: validationErrors.length,
      boundaryErrorCount: boundaryErrors.length,
      providerErrorCount: providerErrors.length,
      providerMitigationErrorCount: providerMitigationErrors.length,
      blockers,
      firstRepair
    },
    nextStep: {
      code: readyToAccept
        ? "confirm_and_persist_dispatch"
        : duplicateReplay
          ? "show_existing_result"
          : persistenceRecoveryState.recovery.required
            ? "reconcile_persisted_state"
            : operationalResponse.retry.retryable
              ? "retry_with_same_command_key"
              : hazardAssessment.safetyInterrupt?.currentCommandBlocked
                ? hazardAssessment.safetyInterrupt.nextAction
              : blockers.length > 0
                ? "repair_blockers"
                : commandPlan.nextAction,
      label: readyToAccept
        ? "Confirm panic-stop and persist before provider dispatch."
        : duplicateReplay
          ? "Show the persisted panic-stop result without dispatching again."
          : persistenceRecoveryState.recovery.required
            ? "Reconcile persisted lifecycle state before accepting a new command."
            : firstRepair ?? operationalResponse.userMessage,
      retryAfter: operationalResponse.retry.retryAfter,
      preserveCommandKey: operationalResponse.retry.idempotencyRequirement === "reuse_command_key"
        || persistenceRecoveryState.recovery.required
        || providerMitigationPlan.operatorRunbook.preserveCommandKey
    },
    impactedProviders,
    providerMitigationPlan: {
      status: providerMitigationPlan.status,
      dispatchAllowed: providerMitigationPlan.dispatchAllowed,
      summary: providerMitigationPlan.summary,
      operatorRunbook: providerMitigationPlan.operatorRunbook,
      mitigations: providerMitigationPlan.mitigations
    }
  };
}

function buildRuntimeInterruptClientWorkflow({
  scope,
  clientRuntimeState,
  lifecycleCommand,
  hazardAssessment,
  previewAcceptance,
  persistenceRecoveryState,
  providerDispatchEnvelope
}) {
  const interrupt = hazardAssessment.safetyInterrupt ?? {};
  const active = interrupt.active === true;
  const currentCommandBlocked = interrupt.currentCommandBlocked === true;
  const allowedCommands = Array.isArray(interrupt.allowedCommands) ? interrupt.allowedCommands : [];
  const commitAllowed = allowedCommands.includes("commit");
  const missingTargetKinds = interrupt.targetSummary?.missingStopTargetKinds ?? hazardAssessment.missingStopTargetKinds ?? [];
  const unresolvedExternalWriteTargets = interrupt.targetSummary?.unresolvedExternalWriteTargets ?? [];
  const externalWriteBarrierRequired = hazardAssessment.externalWriteRisk
    || unresolvedExternalWriteTargets.length > 0
    || hazardAssessment.externalWriteBoundary?.trusted === false
    || providerDispatchEnvelope.providerCommands.some((command) => {
      return command.payload.runtimeHazardProviderAction.externalWriteBarrier.required === true;
    });
  const runtimeTargetCount = hazardAssessment.stopTargets.unsafeJobIds.length
    + hazardAssessment.stopTargets.runawayWorkerIds.length;
  const preferredCommand = currentCommandBlocked && commitAllowed ? "commit" : lifecycleCommand.command;
  const preferredEndpoint = `${clientRuntimeState.ui.surfacePath}/commands/${encodeURIComponent(preferredCommand)}`;
  const externalWriteBoundaryTrusted = hazardAssessment.externalWriteBoundary?.trusted ?? true;
  const repairRequired = active && (
    missingTargetKinds.length > 0
    || unresolvedExternalWriteTargets.length > 0
    || !externalWriteBoundaryTrusted
  );
  const handoffState = !active
    ? null
    : currentCommandBlocked && hazardAssessment.requiresImmediateCommit
      ? "runtime_interrupt_commit_required"
      : currentCommandBlocked || repairRequired
        ? "runtime_interrupt_repair_required"
        : null;
  const workflowTasks = [
    runtimeTargetCount > 0 ? {
      taskId: "review-runtime-stop-targets",
      status: hazardAssessment.targetCoverageComplete ? "ready" : "blocked",
      label: "Review unsafe jobs and runaway workers selected for stop.",
      targetCount: runtimeTargetCount
    } : null,
    externalWriteBarrierRequired ? {
      taskId: "bind-external-write-barrier",
      status: unresolvedExternalWriteTargets.length === 0
        && hazardAssessment.stopTargets.externalWriteTargets.length > 0
        && externalWriteBoundaryTrusted
        ? "ready"
        : "blocked",
      label: "Bind external-write targets before accepting panic-stop.",
      targetCount: hazardAssessment.stopTargets.externalWriteTargets.length,
      unresolvedTargets: unresolvedExternalWriteTargets,
      boundaryTrusted: externalWriteBoundaryTrusted,
      boundaryViolationCodes: hazardAssessment.externalWriteBoundary?.violationCodes ?? []
    } : null,
    currentCommandBlocked ? {
      taskId: "switch-to-safe-command",
      status: commitAllowed ? "ready" : "blocked",
      label: commitAllowed
        ? "Switch this handoff to immediate commit."
        : "Repair runtime hazard blockers before continuing.",
      preferredCommand
    } : null
  ].filter(Boolean);

  return {
    schema: "aios.kernelLifecycle.panicStop.runtimeInterruptClientWorkflow.v1",
    active,
    level: interrupt.level ?? "none",
    command: lifecycleCommand.command,
    currentCommandBlocked,
    suppressOptimisticUpdate: active || currentCommandBlocked || externalWriteBarrierRequired,
    reasonCodes: interrupt.reasonCodes ?? [],
    blockedCommands: interrupt.blockedCommands ?? [],
    allowedCommands,
    preferredCommand,
    preferredEndpoint,
    routeOverride: {
      handoffState,
      nextStepCode: currentCommandBlocked && hazardAssessment.requiresImmediateCommit
        ? "switch_to_commit_handoff"
        : repairRequired
          ? "repair_runtime_interrupt_targets"
          : previewAcceptance.nextStep.code,
      primaryAction: currentCommandBlocked && hazardAssessment.requiresImmediateCommit
        ? "switch_to_commit"
        : repairRequired
          ? "repair_runtime_targets"
          : null,
      disableCurrentAcceptance: currentCommandBlocked || repairRequired,
      disabledReason: currentCommandBlocked
        ? "Runtime safety interrupt requires a safe panic-stop command before acceptance."
        : repairRequired
          ? "Runtime hazard targets or external-write barriers must be repaired before acceptance."
          : null
    },
    clientStatePatch: {
      active,
      level: interrupt.level ?? "none",
      handoffState,
      preferredCommand,
      preferredEndpoint,
      commandKey: persistenceRecoveryState.commandKey,
      targetCoverageComplete: hazardAssessment.targetCoverageComplete,
      missingStopTargetKinds: missingTargetKinds,
      unresolvedExternalWriteTargets,
      externalWriteBarrierRequired,
      externalWriteBoundaryTrusted,
      externalWriteBoundaryViolationCodes: hazardAssessment.externalWriteBoundary?.violationCodes ?? [],
      runtimeTargetCount,
      preserveCommandKey: true
    },
    userVisible: {
      banner: active
        ? hazardAssessment.requiresImmediateCommit
          ? "Runtime safety interrupt is active. Commit panic-stop immediately or repair the listed targets."
          : "Runtime safety interrupt is active. Review target coverage before continuing."
        : null,
      taskCount: workflowTasks.length,
      workflowTasks
    }
  };
}

function buildClientWorkflowHandoff({
  now,
  actor,
  scope,
  clientRuntimeState,
  clientStateConsistency,
  hazardAssessment,
  lifecycleCommand,
  commandPlan,
  operationalResponse,
  previewAcceptance,
  persistenceRecoveryState,
  providerDispatchEnvelope
}) {
  const proofId = providerDispatchEnvelope.auditProofOutput.proofId;
  const readyToConfirm = previewAcceptance.acceptance.state === "ready_for_operator_acceptance";
  const duplicateReplay = previewAcceptance.acceptance.duplicateReplay;
  const heldForRecovery = persistenceRecoveryState.recovery.required;
  const blocked = previewAcceptance.acceptance.state === "blocked";
  const staleClientState = clientStateConsistency.stale;
  const runtimeInterruptWorkflow = buildRuntimeInterruptClientWorkflow({
    scope,
    clientRuntimeState,
    lifecycleCommand,
    hazardAssessment,
    previewAcceptance,
    persistenceRecoveryState,
    providerDispatchEnvelope
  });
  const clientMayOptimisticallyUpdate = clientRuntimeState.ui.allowOptimisticUpdate
    && commandPlan.accepted
    && !blocked
    && !heldForRecovery
    && !staleClientState
    && !runtimeInterruptWorkflow.suppressOptimisticUpdate
    && lifecycleCommand.command !== "commit";
  const handoffState = duplicateReplay
    ? "show_existing_result"
    : heldForRecovery
      ? "resume_recovery"
      : staleClientState
        ? "refresh_client_state"
      : runtimeInterruptWorkflow.routeOverride.handoffState
        ? runtimeInterruptWorkflow.routeOverride.handoffState
      : readyToConfirm
        ? "await_operator_confirmation"
        : providerDispatchEnvelope.dispatchable
          ? "dispatch_ready"
          : blocked
            ? "repair_required"
            : "held_for_backend";
  const persistedPatch = persistenceRecoveryState.nextPersistedState;
  const workflowId = clientRuntimeState.workflow.workflowId
    ?? `${surfaceId}:${scope.boundaryKey}:${lifecycleCommand.command}`;

  return {
    schema: "aios.kernelLifecycle.panicStop.clientWorkflowHandoff.v1",
    generatedAt: now,
    handoffId: `${surfaceId}:${scope.boundaryKey}:client-handoff:${now}`,
    workflowId,
    client: {
      clientId: clientRuntimeState.clientId,
      sessionId: clientRuntimeState.sessionId,
      requestId: clientRuntimeState.requestId,
      requestSource: clientRuntimeState.requestSource,
      surfacePath: clientRuntimeState.ui.surfacePath,
      panelId: clientRuntimeState.ui.panelId,
      returnTo: clientRuntimeState.ui.returnTo
    },
    route: {
      commandRoute: commandPlan.route,
      routeHint: clientRuntimeState.routeHint,
      handoffState,
      nextStepCode: runtimeInterruptWorkflow.routeOverride.nextStepCode,
      nextStepLabel: runtimeInterruptWorkflow.routeOverride.disabledReason ?? previewAcceptance.nextStep.label,
      retryAfter: operationalResponse.retry.retryAfter,
      preserveCommandKey: previewAcceptance.nextStep.preserveCommandKey
        || runtimeInterruptWorkflow.clientStatePatch.preserveCommandKey
    },
    userVisibleWorkflow: {
      headline: previewAcceptance.preview.headline,
      statusLabel: previewAcceptance.readiness.label,
      message: runtimeInterruptWorkflow.userVisible.banner ?? previewAcceptance.preview.userMessage,
      severity: operationalResponse.severity,
      requireConfirmation: clientRuntimeState.ui.requireOperatorConfirmation
        && previewAcceptance.acceptance.operatorConfirmationRequired,
      disablePrimaryAction: blocked
        || heldForRecovery
        || duplicateReplay
        || staleClientState
        || runtimeInterruptWorkflow.routeOverride.disableCurrentAcceptance,
      primaryAction: staleClientState
        ? "refresh_state"
        : runtimeInterruptWorkflow.routeOverride.primaryAction
          ? runtimeInterruptWorkflow.routeOverride.primaryAction
        : readyToConfirm
        ? "confirm_panic_stop"
        : duplicateReplay
          ? "view_persisted_result"
          : heldForRecovery
            ? "resume_recovery"
            : blocked
              ? "repair_blockers"
              : "wait_for_backend_handoff",
      secondaryAction: operationalResponse.retry.retryable ? "retry_with_same_command_key" : "open_audit_proof"
    },
    clientStatePatch: {
      workflowStep: handoffState,
      commandKey: persistenceRecoveryState.commandKey,
      lifecycleCommand: lifecycleCommand.command,
      accepted: commandPlan.accepted,
      optimisticUpdateAllowed: clientMayOptimisticallyUpdate,
      optimisticLifecycleState: clientMayOptimisticallyUpdate ? persistedPatch.lifecycleState : null,
      expectedWriteGeneration: persistedPatch.writeGeneration,
      restartSafeStatus: persistenceRecoveryState.statusSemantics.restartSafeStatus,
      proofId,
      runtimeSafetyInterrupt: runtimeInterruptWorkflow.clientStatePatch,
      consistency: clientStateConsistency.clientStatePatch,
      lastKnownKernel: {
        lifecycleState: persistedPatch.lifecycleState,
        schedulerAdmission: persistedPatch.schedulerAdmission,
        writeGeneration: persistedPatch.writeGeneration,
        proofId,
        observedAt: now
      }
    },
    persistenceHandoff: {
      writeIntent: persistenceRecoveryState.writeIntent,
      stateStoreKey: persistenceRecoveryState.stateStore.key,
      compareAndSwapGeneration: persistenceRecoveryState.stateStore.compareAndSwapGeneration,
      recoveryRequired: heldForRecovery,
      resumeProviderHandoffCount: persistenceRecoveryState.recovery.resumeProviderHandoffs.length
    },
    runtimeInterruptWorkflow,
    clientStateConsistency,
    proofHandoff: {
      proofId,
      proofSchema: providerDispatchEnvelope.auditProofOutput.proofSchema,
      actorId: actor.actorId,
      scopeKey: scope.boundaryKey,
      providerDispatchId: providerDispatchEnvelope.dispatchId,
      dispatchMode: providerDispatchEnvelope.dispatchMode,
      providerCommandCount: providerDispatchEnvelope.providerCommands.length,
      blockedProviderCommandCount: providerDispatchEnvelope.blockedProviderCommands.length,
      serviceHandoffContracts: providerDispatchEnvelope.providerCommands.map((command) => ({
        providerName: command.providerName,
        operation: command.handoffContract?.operation ?? command.payload.serviceHandoffContract.operation,
        inputSchema: command.handoffContract?.inputSchema ?? command.payload.serviceHandoffContract.inputSchema,
        resultSchema: command.handoffContract?.resultSchema ?? command.payload.serviceHandoffContract.resultSchema,
        syncBarrier: command.handoffContract?.syncBarrier ?? command.payload.serviceHandoffContract.syncBarrier,
        runtimeHazardActionMode: command.runtimeHazardActionMode,
        runtimeHazardActions: command.payload.runtimeHazardProviderAction.actions,
        runtimeHazardCompletionClaims: command.payload.runtimeHazardProviderAction.completionClaims,
        runtimeHazardHandoffMode: command.payload.serviceHandoffContract.runtimeHazard?.handoffMode
          ?? "standard_lifecycle_handoff",
        runtimeHazardRequiredCapabilities: command.payload.serviceHandoffContract.runtimeHazard?.requiredCapabilities ?? [],
        runtimeHazardFailClosed: command.payload.serviceHandoffContract.runtimeHazard?.failClosedRequired ?? false,
        boundaryMode: command.payload.serviceHandoffContract.boundary?.handoffBoundaryMode ?? "inherit_request_scope",
        boundaryVerified: command.payload.serviceHandoffContract.boundary?.boundaryMatches ?? true,
        ackRequired: command.handoffContract?.acknowledgement?.required ?? command.payload.serviceHandoffContract.acknowledgement.required,
        externalStateId: command.handoffContract?.externalState?.externalStateId
          ?? command.payload.serviceHandoffContract.externalState.externalStateId
      }))
    }
  };
}

function buildClientStateConsistencyContract({
  now,
  scope,
  clientRuntimeState,
  lifecycleCommand,
  previewAcceptance,
  persistenceRecoveryState,
  providerDispatchEnvelope
}) {
  const expectedCommandKey = persistenceRecoveryState.commandKey;
  const expectedProofId = providerDispatchEnvelope.auditProofOutput.proofId;
  const expectedWriteGeneration = persistenceRecoveryState.nextPersistedState.writeGeneration;
  const lastKnown = clientRuntimeState.lastKnownKernel;
  const optimisticKey = clientRuntimeState.workflow.optimisticCommandKey;
  const staleGeneration = lastKnown.writeGeneration > 0
    && lastKnown.writeGeneration < persistenceRecoveryState.stateStore.compareAndSwapGeneration;
  const futureGeneration = lastKnown.writeGeneration > expectedWriteGeneration;
  const proofMismatch = Boolean(lastKnown.proofId)
    && lastKnown.proofId !== expectedProofId
    && clientRuntimeState.workflow.lastAcknowledgedProofId !== expectedProofId;
  const optimisticMismatch = Boolean(optimisticKey) && optimisticKey !== expectedCommandKey;
  const lifecycleMismatch = Boolean(lastKnown.lifecycleState)
    && lastKnown.lifecycleState !== persistenceRecoveryState.nextPersistedState.lifecycleState
    && previewAcceptance.acceptance.state !== "ready_for_operator_acceptance";
  const conflictReasons = [
    staleGeneration ? "client_generation_behind_persisted_state" : null,
    futureGeneration ? "client_generation_ahead_of_server_projection" : null,
    proofMismatch ? "client_acknowledged_different_proof" : null,
    optimisticMismatch ? "optimistic_command_key_mismatch" : null,
    lifecycleMismatch ? "last_known_lifecycle_state_differs" : null
  ].filter(Boolean);
  const hydrationRequired = conflictReasons.length > 0
    || persistenceRecoveryState.recovery.required
    || previewAcceptance.acceptance.duplicateReplay;
  const nextClientAction = hydrationRequired
    ? persistenceRecoveryState.recovery.required
      ? "hydrate_from_restart_safe_journal"
      : previewAcceptance.acceptance.duplicateReplay
        ? "hydrate_from_persisted_result"
        : "refresh_before_acceptance"
    : previewAcceptance.nextStep.code;

  return {
    schema: "aios.kernelLifecycle.panicStop.clientStateConsistency.v1",
    generatedAt: now,
    scopeKey: scope.boundaryKey,
    requestId: clientRuntimeState.requestId,
    workflowId: clientRuntimeState.workflow.workflowId,
    expected: {
      commandKey: expectedCommandKey,
      proofId: expectedProofId,
      writeGeneration: expectedWriteGeneration,
      lifecycleState: persistenceRecoveryState.nextPersistedState.lifecycleState,
      schedulerAdmission: persistenceRecoveryState.nextPersistedState.schedulerAdmission
    },
    observed: {
      optimisticCommandKey: optimisticKey,
      optimisticState: clientRuntimeState.workflow.optimisticState,
      lastAcknowledgedProofId: clientRuntimeState.workflow.lastAcknowledgedProofId,
      writeGeneration: lastKnown.writeGeneration,
      lifecycleState: lastKnown.lifecycleState,
      schedulerAdmission: lastKnown.schedulerAdmission,
      proofId: lastKnown.proofId,
      observedAt: lastKnown.observedAt
    },
    stale: conflictReasons.length > 0,
    hydrationRequired,
    conflictReasons,
    nextClientAction,
    clientStatePatch: {
      clearOptimisticCommand: optimisticMismatch || previewAcceptance.acceptance.duplicateReplay,
      requireFreshRead: hydrationRequired,
      authoritativeCommandKey: expectedCommandKey,
      authoritativeProofId: expectedProofId,
      authoritativeWriteGeneration: expectedWriteGeneration,
      authoritativeLifecycleState: persistenceRecoveryState.nextPersistedState.lifecycleState,
      authoritativeSchedulerAdmission: persistenceRecoveryState.nextPersistedState.schedulerAdmission,
      refreshSource: persistenceRecoveryState.recovery.required
        ? "restart_safe_command_journal"
        : previewAcceptance.acceptance.duplicateReplay
          ? "persisted_panic_stop_state"
          : "panic_stop_request_projection"
    },
    userVisibleState: {
      banner: conflictReasons.length > 0
        ? "Panic-stop state changed since this panel was loaded. Refresh before accepting the handoff."
        : hydrationRequired
          ? "Panic-stop state will be hydrated before the next workflow step."
          : null,
      disableAcceptanceUntilHydrated: hydrationRequired,
      returnFocusTarget: clientRuntimeState.ui.panelId,
      continueRoute: clientRuntimeState.ui.returnTo ?? clientRuntimeState.ui.surfacePath
    }
  };
}

function buildRoutePreviewAcceptanceHandoff({
  now,
  actor,
  scope,
  clientRuntimeState,
  lifecycleCommand,
  validation,
  boundary,
  health,
  previewAcceptance,
  clientStateConsistency,
  clientWorkflowHandoff,
  lifecycleControlPanel,
  persistenceRecoveryState,
  providerDispatchEnvelope,
  providerMitigationPlan
}) {
  const confirmationRequired = clientWorkflowHandoff.userVisibleWorkflow.requireConfirmation;
  const routeBase = clientRuntimeState.ui.surfacePath;
  const providerCommands = providerDispatchEnvelope.providerCommands.map((command) => ({
    providerName: command.providerName,
    action: command.action,
    runtimeHazardActionMode: command.runtimeHazardActionMode,
    runtimeHazardActions: command.payload.runtimeHazardProviderAction.actions,
    dispatchState: command.dispatchState,
    idempotencyKey: command.idempotencyKey,
    externalStateId: command.payload.externalStateId,
    ackRequired: command.payload.providerRequiresAck,
    serviceOperation: command.payload.serviceHandoffContract.operation,
    syncBarrier: command.payload.serviceHandoffContract.syncBarrier,
    runtimeHazardHandoffMode: command.payload.serviceHandoffContract.runtimeHazard?.handoffMode
      ?? "standard_lifecycle_handoff",
    runtimeHazardRequiredCapabilities: command.payload.serviceHandoffContract.runtimeHazard?.requiredCapabilities ?? [],
    runtimeHazardFailClosed: command.payload.serviceHandoffContract.runtimeHazard?.failClosedRequired ?? false,
    boundaryMode: command.payload.serviceHandoffContract.boundary?.handoffBoundaryMode ?? "inherit_request_scope",
    boundaryVerified: command.payload.serviceHandoffContract.boundary?.boundaryMatches ?? true
  }));
  const readinessGates = [
    {
      code: "request_validation",
      passed: validation.valid,
      status: validation.valid ? "passed" : "blocked",
      summary: validation.valid ? "Request fields are valid." : "Request fields require repair."
    },
    {
      code: "isolation_boundary",
      passed: boundary.allowed,
      status: boundary.allowed ? "passed" : "blocked",
      summary: boundary.allowed ? "Actor authority matches the requested scope." : "Actor authority does not match the requested scope."
    },
    {
      code: "operational_health",
      passed: health.canCommitStop,
      status: health.canCommitStop ? health.status : "blocked",
      summary: health.canCommitStop ? "Required dependencies can service this command." : "Required dependencies or providers block dispatch."
    },
    {
      code: "persistence_gate",
      passed: persistenceRecoveryState.writeIntent === "persist_before_dispatch"
        || persistenceRecoveryState.writeIntent === "read_existing_result",
      status: persistenceRecoveryState.writeIntent,
      summary: persistenceRecoveryState.statusSemantics.userVisibleStatus
    },
    {
      code: "provider_dispatch",
      passed: (providerDispatchEnvelope.dispatchable && providerMitigationPlan.dispatchAllowed)
        || previewAcceptance.acceptance.duplicateReplay,
      status: providerDispatchEnvelope.dispatchMode,
      summary: providerDispatchEnvelope.dispatchable
        ? providerMitigationPlan.dispatchAllowed
          ? "Provider commands are ready after the persisted checkpoint is written."
          : "Provider commands require mitigation before dispatch."
        : previewAcceptance.acceptance.duplicateReplay
          ? "No provider command will be dispatched because the result already exists."
          : "Provider commands are held until blockers are repaired."
    },
    {
      code: "provider_mitigation",
      passed: providerMitigationPlan.status !== "blocked",
      status: providerMitigationPlan.status,
      summary: providerMitigationPlan.mitigationRequired
        ? providerMitigationPlan.operatorRunbook.nextAction
        : "No provider mitigation is required for this panic-stop command."
    },
    {
      code: "client_state_consistency",
      passed: !clientStateConsistency.stale,
      status: clientStateConsistency.hydrationRequired ? "hydrate_required" : "current",
      summary: clientStateConsistency.userVisibleState.banner
        ?? "Client request state matches the panic-stop server projection."
    },
    {
      code: "runtime_safety_interrupt",
      passed: clientWorkflowHandoff.runtimeInterruptWorkflow.routeOverride.disableCurrentAcceptance !== true,
      status: clientWorkflowHandoff.runtimeInterruptWorkflow.active
        ? clientWorkflowHandoff.runtimeInterruptWorkflow.level
        : "inactive",
      summary: clientWorkflowHandoff.runtimeInterruptWorkflow.userVisible.banner
        ?? "No runtime safety interrupt changes this handoff."
    }
  ];
  const failedGateCodes = readinessGates.filter((gate) => !gate.passed).map((gate) => gate.code);
  const highRiskPreview = lifecycleCommand.command === "commit"
    || previewAcceptance.runtimeHazards.externalWriteRisk
    || previewAcceptance.runtimeSafetyInterrupt.active
    || providerDispatchEnvelope.providerCommands.some((command) => {
      return command.payload.runtimeHazardProviderAction.externalWriteBarrier.required
        || command.payload.serviceHandoffContract.runtimeHazard?.failClosedRequired === true;
    });
  const previewTtlMs = highRiskPreview
    ? HIGH_RISK_ACCEPTANCE_PREVIEW_TTL_MS
    : DEFAULT_ACCEPTANCE_PREVIEW_TTL_MS;
  const previewExpiresAt = addMillisecondsToIso(now, previewTtlMs);
  const previewNonce = [
    surfaceId,
    scope.boundaryKey,
    persistenceRecoveryState.commandKey,
    providerDispatchEnvelope.auditProofOutput.proofId,
    persistenceRecoveryState.nextPersistedState.writeGeneration,
    previewExpiresAt ?? "no-expiry"
  ].join(":");
  const acceptancePayloadFields = [
    "commandKey",
    "actorId",
    "scopeKey",
    "lifecycleCommand",
    "expectedWriteGeneration",
    "proofId",
    "previewNonce",
    "previewExpiresAt"
  ];
  const acceptancePayload = {
    commandKey: persistenceRecoveryState.commandKey,
    actorId: actor.actorId,
    scopeKey: scope.boundaryKey,
    lifecycleCommand: lifecycleCommand.command,
    expectedWriteGeneration: persistenceRecoveryState.nextPersistedState.writeGeneration,
    proofId: providerDispatchEnvelope.auditProofOutput.proofId,
    previewNonce,
    previewGeneratedAt: now,
    previewExpiresAt,
    previewTtlMs,
    previewRiskClass: highRiskPreview ? "high_risk_short_lived" : "standard",
    confirmationRequired,
    confirmationPhrase: confirmationRequired ? "CONFIRM PANIC STOP" : null
  };
  const primaryDisabledReason = clientWorkflowHandoff.userVisibleWorkflow.disablePrimaryAction
    ? clientWorkflowHandoff.route.nextStepLabel
    : confirmationRequired
      ? "Operator confirmation is required before commit."
      : null;

  return {
    schema: "aios.kernelLifecycle.panicStop.routePreviewAcceptanceHandoff.v1",
    generatedAt: now,
    routeId: `${surfaceId}:${scope.boundaryKey}:route-preview:${persistenceRecoveryState.commandKey}`,
    surfacePath: routeBase,
    routeState: clientWorkflowHandoff.route.handoffState,
    commandRoute: clientWorkflowHandoff.route.commandRoute,
    client: clientWorkflowHandoff.client,
    previewCard: {
      headline: previewAcceptance.preview.headline,
      scopeLabel: previewAcceptance.preview.scopeLabel,
      statusLabel: previewAcceptance.readiness.label,
      severity: clientWorkflowHandoff.userVisibleWorkflow.severity,
      message: clientWorkflowHandoff.userVisibleWorkflow.message,
      expectedState: previewAcceptance.preview.expectedState,
      failClosed: previewAcceptance.preview.failClosed,
      scheduledFor: previewAcceptance.preview.scheduledFor
    },
    readinessGates,
    readinessSummary: {
      ready: failedGateCodes.length === 0,
      failedGateCodes,
      dependencySummary: previewAcceptance.readiness.dependencySummary,
      providerCommandCount: providerCommands.length,
      blockedProviderCommandCount: providerDispatchEnvelope.blockedProviderCommands.length,
      providerMitigationSummary: providerMitigationPlan.summary,
      restartSafeStatus: persistenceRecoveryState.statusSemantics.restartSafeStatus,
      recoveryRequired: persistenceRecoveryState.recovery.required,
      runtimeSafetyInterrupt: {
        active: clientWorkflowHandoff.runtimeInterruptWorkflow.active,
        level: clientWorkflowHandoff.runtimeInterruptWorkflow.level,
        handoffState: clientWorkflowHandoff.runtimeInterruptWorkflow.routeOverride.handoffState,
        preferredCommand: clientWorkflowHandoff.runtimeInterruptWorkflow.preferredCommand,
        suppressOptimisticUpdate: clientWorkflowHandoff.runtimeInterruptWorkflow.suppressOptimisticUpdate,
        taskCount: clientWorkflowHandoff.runtimeInterruptWorkflow.userVisible.taskCount
      },
      previewFreshness: {
        generatedAt: now,
        expiresAt: previewExpiresAt,
        ttlMs: previewTtlMs,
        riskClass: highRiskPreview ? "high_risk_short_lived" : "standard",
        requiresFreshAcceptance: true,
        nonceBoundToCommandKey: true
      }
    },
    validationSummary: {
      valid: previewAcceptance.validationSummary.valid,
      blockerCount: previewAcceptance.validationSummary.blockerCount,
      firstRepair: previewAcceptance.validationSummary.firstRepair,
      blockers: previewAcceptance.validationSummary.blockers.map((blocker, index) => ({
        blockerId: `blocker-${index + 1}`,
        code: blocker.code,
        field: blocker.field,
        message: blocker.message,
        repairAction: blocker.repairAction
      }))
    },
    acceptanceAction: {
      enabled: !clientWorkflowHandoff.userVisibleWorkflow.disablePrimaryAction,
      primaryAction: clientWorkflowHandoff.userVisibleWorkflow.primaryAction,
      secondaryAction: clientWorkflowHandoff.userVisibleWorkflow.secondaryAction,
      disabledReason: primaryDisabledReason,
      endpoint: `${routeBase}/accept`,
      method: "POST",
      requiredFields: acceptancePayloadFields,
      payload: acceptancePayload
    },
    controlTray: lifecycleControlPanel ? {
      schema: "aios.kernelLifecycle.panicStop.routeControlTray.v1",
      state: lifecycleControlPanel.controlState,
      nextAction: lifecycleControlPanel.nextAction,
      enabledControlCount: lifecycleControlPanel.summary.enabledControlCount,
      blockedControlCount: lifecycleControlPanel.summary.blockedControlCount,
      visibleControls: lifecycleControlPanel.controls.map((control) => ({
        controlId: control.controlId,
        command: control.command,
        enabled: control.enabled,
        reason: control.reason,
        endpoint: control.endpoint,
        method: control.method
      }))
    } : null,
    nextStepContract: {
      code: clientWorkflowHandoff.route.nextStepCode,
      label: clientWorkflowHandoff.route.nextStepLabel,
      retryAfter: previewAcceptance.nextStep.retryAfter,
      preserveCommandKey: clientWorkflowHandoff.route.preserveCommandKey,
      clientWorkflowStep: clientWorkflowHandoff.clientStatePatch.workflowStep,
      routeHint: clientWorkflowHandoff.route.nextStepCode,
      runtimeSafetyInterrupt: clientWorkflowHandoff.runtimeInterruptWorkflow.clientStatePatch,
      clientHydrationRequired: clientStateConsistency.hydrationRequired,
      clientNextAction: clientStateConsistency.nextClientAction,
      auditProofRoute: `${routeBase}/proof/${encodeURIComponent(providerDispatchEnvelope.auditProofOutput.proofId)}`
    },
    providerMitigation: {
      status: providerMitigationPlan.status,
      dispatchAllowed: providerMitigationPlan.dispatchAllowed,
      retryAfter: providerMitigationPlan.retryAfter,
      nextAction: providerMitigationPlan.operatorRunbook.nextAction,
      preserveCommandKey: providerMitigationPlan.operatorRunbook.preserveCommandKey,
      mitigations: providerMitigationPlan.mitigations.map((mitigation, index) => ({
        mitigationId: `provider-mitigation-${index + 1}`,
        code: mitigation.code,
        providerName: mitigation.providerName,
        severity: mitigation.severity,
        operatorAction: mitigation.operatorAction,
        retryClass: mitigation.retryClass
      }))
    },
    clientStateConsistency: {
      stale: clientStateConsistency.stale,
      hydrationRequired: clientStateConsistency.hydrationRequired,
      conflictReasons: clientStateConsistency.conflictReasons,
      userVisibleState: clientStateConsistency.userVisibleState,
      patch: clientStateConsistency.clientStatePatch
    },
    providerImpact: providerCommands
  };
}

function buildAcceptanceSubmissionContract({
  now,
  input,
  actor,
  scope,
  clientRuntimeState,
  clientStateConsistency,
  clientWorkflowHandoff,
  routePreviewAcceptanceHandoff,
  previewAcceptance,
  persistenceRecoveryState,
  providerDispatchEnvelope
}) {
  const source = cleanRecord(input.acceptanceSubmission ?? input.acceptancePayload ?? input.acceptRequest);
  const submitted = {
    commandKey: cleanText(source.commandKey ?? source.idempotencyKey, null),
    actorId: cleanText(source.actorId ?? source.operatorId, null),
    scopeKey: cleanText(source.scopeKey ?? source.boundaryKey, null),
    lifecycleCommand: cleanText(source.lifecycleCommand ?? source.command, null),
    expectedWriteGeneration: cleanPositiveInteger(source.expectedWriteGeneration, -1),
    proofId: cleanText(source.proofId ?? source.auditProofId, null),
    previewNonce: cleanText(source.previewNonce ?? source.nonce, null),
    previewExpiresAt: cleanTimestamp(source.previewExpiresAt ?? source.expiresAt),
    confirmationPhrase: cleanText(source.confirmationPhrase ?? source.confirmation, null),
    acceptedAt: cleanTimestamp(source.acceptedAt ?? source.submittedAt, now),
    clientWorkflowId: cleanText(source.workflowId ?? source.clientWorkflowId, clientRuntimeState.workflow.workflowId),
    clientRequestId: cleanText(source.requestId ?? clientRuntimeState.requestId, null)
  };
  const expected = routePreviewAcceptanceHandoff.acceptanceAction.payload;
  const acceptedAtMs = Date.parse(submitted.acceptedAt);
  const expectedExpiryMs = Date.parse(expected.previewExpiresAt);
  const nowMs = Date.parse(now);
  const acceptedAtValid = Number.isFinite(acceptedAtMs);
  const previewExpiryValid = Number.isFinite(expectedExpiryMs);
  const previewExpiredAtSubmission = previewExpiryValid
    && acceptedAtValid
    && acceptedAtMs > expectedExpiryMs;
  const previewExpiredNow = previewExpiryValid
    && Number.isFinite(nowMs)
    && nowMs > expectedExpiryMs;
  const fieldChecks = [
    {
      field: "commandKey",
      required: true,
      expected: expected.commandKey,
      observed: submitted.commandKey,
      matched: submitted.commandKey === expected.commandKey
    },
    {
      field: "actorId",
      required: true,
      expected: expected.actorId,
      observed: submitted.actorId,
      matched: submitted.actorId === expected.actorId
    },
    {
      field: "scopeKey",
      required: true,
      expected: expected.scopeKey,
      observed: submitted.scopeKey,
      matched: submitted.scopeKey === expected.scopeKey
    },
    {
      field: "lifecycleCommand",
      required: true,
      expected: expected.lifecycleCommand,
      observed: submitted.lifecycleCommand,
      matched: submitted.lifecycleCommand === expected.lifecycleCommand
    },
    {
      field: "expectedWriteGeneration",
      required: true,
      expected: expected.expectedWriteGeneration,
      observed: submitted.expectedWriteGeneration,
      matched: submitted.expectedWriteGeneration === expected.expectedWriteGeneration
    },
    {
      field: "proofId",
      required: true,
      expected: expected.proofId,
      observed: submitted.proofId,
      matched: submitted.proofId === expected.proofId
    },
    {
      field: "previewNonce",
      required: true,
      expected: expected.previewNonce,
      observed: submitted.previewNonce,
      matched: submitted.previewNonce === expected.previewNonce
    },
    {
      field: "previewExpiresAt",
      required: true,
      expected: expected.previewExpiresAt,
      observed: submitted.previewExpiresAt,
      matched: submitted.previewExpiresAt === expected.previewExpiresAt
    },
    {
      field: "confirmationPhrase",
      required: expected.confirmationRequired,
      expected: expected.confirmationPhrase,
      observed: submitted.confirmationPhrase,
      matched: !expected.confirmationRequired || submitted.confirmationPhrase === expected.confirmationPhrase
    }
  ];
  const missingFields = fieldChecks
    .filter((check) => check.required && (check.observed === null || check.observed === "" || check.observed === -1))
    .map((check) => check.field);
  const mismatchedFields = fieldChecks
    .filter((check) => check.required && !check.matched && !missingFields.includes(check.field))
    .map((check) => check.field);
  const submissionPresent = Object.keys(source).length > 0;
  const routeAcceptEnabled = routePreviewAcceptanceHandoff.acceptanceAction.enabled;
  const hydrationBlocked = clientStateConsistency.hydrationRequired || clientStateConsistency.stale;
  const duplicateReplay = previewAcceptance.acceptance.duplicateReplay;
  const acceptanceBlockedReasons = [
    !submissionPresent ? "submission_not_present_preview_only" : null,
    !routeAcceptEnabled ? "route_acceptance_action_disabled" : null,
    hydrationBlocked ? "client_state_hydration_required" : null,
    persistenceRecoveryState.recovery.required ? "restart_recovery_required" : null,
    duplicateReplay ? "duplicate_replay_no_new_acceptance" : null,
    previewExpiryValid ? null : "preview_expiry_missing_or_invalid",
    previewExpiredAtSubmission || previewExpiredNow ? "acceptance_preview_expired" : null,
    !acceptedAtValid ? "acceptance_timestamp_invalid" : null,
    missingFields.length > 0 ? "acceptance_payload_missing_required_fields" : null,
    mismatchedFields.length > 0 ? "acceptance_payload_mismatch" : null
  ].filter(Boolean);
  const acceptedForDispatch = submissionPresent
    && acceptanceBlockedReasons.length === 0
    && providerDispatchEnvelope.dispatchable;
  const acceptancePayloadValid = submissionPresent
    && missingFields.length === 0
    && mismatchedFields.length === 0
    && previewExpiryValid
    && acceptedAtValid
    && !previewExpiredAtSubmission
    && !previewExpiredNow;

  return {
    schema: "aios.kernelLifecycle.panicStop.acceptanceSubmissionContract.v1",
    generatedAt: now,
    mode: submissionPresent ? "validate_acceptance_submission" : "preview_required_acceptance_payload",
    endpoint: routePreviewAcceptanceHandoff.acceptanceAction.endpoint,
    method: routePreviewAcceptanceHandoff.acceptanceAction.method,
    expectedPayloadSchema: {
      requiredFields: routePreviewAcceptanceHandoff.acceptanceAction.requiredFields,
      confirmationRequired: expected.confirmationRequired,
      confirmationPhrase: expected.confirmationPhrase,
      commandKey: expected.commandKey,
      proofId: expected.proofId,
      previewNonce: expected.previewNonce,
      previewGeneratedAt: expected.previewGeneratedAt,
      previewExpiresAt: expected.previewExpiresAt,
      previewTtlMs: expected.previewTtlMs,
      previewRiskClass: expected.previewRiskClass,
      compareAndSwapGeneration: persistenceRecoveryState.stateStore.compareAndSwapGeneration,
      expectedWriteGeneration: expected.expectedWriteGeneration
    },
    submitted,
    validation: {
      valid: acceptancePayloadValid,
      fieldChecks,
      missingFields,
      mismatchedFields,
      hydrationBlocked,
      routeAcceptEnabled,
      previewFresh: previewExpiryValid && acceptedAtValid && !previewExpiredAtSubmission && !previewExpiredNow,
      previewExpiredAtSubmission,
      previewExpiredNow,
      previewRiskClass: expected.previewRiskClass,
      acceptedForDispatch,
      blockedReasons: acceptanceBlockedReasons
    },
    routeConsumption: {
      routeState: routePreviewAcceptanceHandoff.routeState,
      commandRoute: routePreviewAcceptanceHandoff.commandRoute,
      clientWorkflowStep: clientWorkflowHandoff.clientStatePatch.workflowStep,
      stateStoreKey: persistenceRecoveryState.stateStore.key,
      writeIntent: persistenceRecoveryState.writeIntent,
      dispatchId: providerDispatchEnvelope.dispatchId,
      dispatchMode: providerDispatchEnvelope.dispatchMode,
      providerCommandCount: providerDispatchEnvelope.providerCommands.length,
      auditProofRoute: routePreviewAcceptanceHandoff.nextStepContract.auditProofRoute
    },
    decision: {
      state: acceptedForDispatch
        ? "accepted_for_persisted_provider_dispatch"
        : duplicateReplay
          ? "show_existing_result"
          : previewExpiredAtSubmission || previewExpiredNow
            ? "refresh_preview_before_acceptance"
          : hydrationBlocked
            ? "hydrate_client_state_before_acceptance"
            : submissionPresent
              ? "reject_acceptance_submission"
              : "await_acceptance_submission",
      nextAction: acceptedForDispatch
        ? "persist_checkpoint_then_dispatch_provider_commands"
        : duplicateReplay
          ? "return_persisted_command_status"
          : previewExpiredAtSubmission || previewExpiredNow
            ? "refresh_route_preview_acceptance_handoff"
          : hydrationBlocked
            ? clientStateConsistency.nextClientAction
            : routePreviewAcceptanceHandoff.nextStepContract.code,
      userVisibleLabel: acceptedForDispatch
        ? "Acceptance payload is valid. Persist the checkpoint before provider dispatch."
        : previewExpiredAtSubmission || previewExpiredNow
          ? "This panic-stop preview expired. Refresh the preview before accepting the handoff."
        : acceptanceBlockedReasons.length > 0
          ? routePreviewAcceptanceHandoff.acceptanceAction.disabledReason ?? previewAcceptance.nextStep.label
          : "Submit the required acceptance payload to continue."
    },
    proofBinding: {
      proofId: providerDispatchEnvelope.auditProofOutput.proofId,
      proofSchema: providerDispatchEnvelope.auditProofOutput.proofSchema,
      actorId: actor.actorId,
      scopeKey: scope.boundaryKey,
      commandKey: persistenceRecoveryState.commandKey,
      previewNonce: expected.previewNonce,
      previewExpiresAt: expected.previewExpiresAt,
      previewFresh: previewExpiryValid && acceptedAtValid && !previewExpiredAtSubmission && !previewExpiredNow,
      includeAcceptancePayload: true
    }
  };
}

function buildLifecycleControl({
  scope,
  clientRuntimeState,
  lifecycleSettings,
  hazardAssessment,
  persistedState,
  boundary,
  health,
  commandPlan,
  operationalResponse,
  persistenceRecoveryState,
  providerDispatchEnvelope,
  controlId,
  label,
  command,
  requiresSettingsAuthority = false,
  requiresPanicStopEnabled = false,
  requiresSchedulingEnabled = false,
  requiresActiveSchedule = false,
  disallowTerminalStop = false,
  method = "POST",
  payload = {}
}) {
  const routeBase = clientRuntimeState.ui.surfacePath;
  const activeSchedule = persistedState.scheduledStop.status === "scheduled"
    && Boolean(persistedState.scheduledStop.scheduleId);
  const terminalStop = persistedState.stopCommitted
    || persistenceRecoveryState.nextPersistedState.stopCommitted
    || persistenceRecoveryState.nextPersistedState.lifecycleState === "panic-stop-committed";
  const safetyInterrupt = hazardAssessment?.safetyInterrupt ?? null;
  const commandBlockedBySafetyInterrupt = safetyInterrupt?.blockedCommands?.includes(command) === true;
  const disabledReasons = [
    boundary.allowed ? null : "boundary_denied",
    health.canCommitStop ? null : "operational_health_blocked",
    health.hazardIsolation?.state === "blocked" ? "runtime_hazard_isolation_blocked" : null,
    operationalResponse.retry.operatorRepairRequired ? "operator_repair_required" : null,
    commandBlockedBySafetyInterrupt ? "runtime_safety_interrupt" : null,
    requiresSettingsAuthority && !commandPlan.settingsAuthority ? "settings_authority_required" : null,
    requiresPanicStopEnabled && !lifecycleSettings.panicStopEnabled ? "panic_stop_disabled" : null,
    requiresSchedulingEnabled && !lifecycleSettings.schedulingEnabled ? "scheduling_disabled" : null,
    requiresActiveSchedule && !activeSchedule ? "no_active_schedule" : null,
    disallowTerminalStop && terminalStop ? "panic_stop_already_committed" : null,
    providerDispatchEnvelope.blockedProviderCommands.length > 0 ? "provider_contract_blocked" : null
  ].filter(Boolean);
  const enabled = disabledReasons.length === 0;

  return {
    schema: "aios.kernelLifecycle.panicStop.lifecycleControl.v1",
    controlId,
    label,
    command,
    enabled,
    reason: enabled ? "available" : disabledReasons[0],
    disabledReasons,
    endpoint: `${routeBase}/commands/${encodeURIComponent(command)}`,
    method,
    payload: {
      action: "panic-stop",
      command,
      scopeKey: scope.boundaryKey,
      expectedWriteGeneration: persistenceRecoveryState.nextPersistedState.writeGeneration,
      commandKeyHint: `${persistenceRecoveryState.commandKey}:${controlId}`,
      ...payload
    },
    proofClaims: {
      controlId,
      command,
      authority: boundary.authority,
      settingsAuthority: commandPlan.settingsAuthority,
      blockedProviderCommandCount: providerDispatchEnvelope.blockedProviderCommands.length,
      retryClass: operationalResponse.retry.class,
      runtimeSafetyInterrupt: safetyInterrupt ? {
        active: safetyInterrupt.active,
        level: safetyInterrupt.level,
        commandBlocked: commandBlockedBySafetyInterrupt,
        reasonCodes: safetyInterrupt.reasonCodes,
        nextAction: commandBlockedBySafetyInterrupt ? safetyInterrupt.nextAction : "none"
      } : null
    }
  };
}

function buildLifecycleControlPanel({
  now,
  actor,
  scope,
  clientRuntimeState,
  lifecycleCommand,
  lifecycleSettings,
  hazardAssessment,
  settingsMutation,
  scheduleRequest,
  persistedState,
  boundary,
  health,
  commandPlan,
  operationalResponse,
  persistenceRecoveryState,
  providerDispatchEnvelope
}) {
  const controls = [
    buildLifecycleControl({
      scope,
      clientRuntimeState,
      lifecycleSettings,
      hazardAssessment,
      persistedState,
      boundary,
      health,
      commandPlan,
      operationalResponse,
      persistenceRecoveryState,
      providerDispatchEnvelope,
      controlId: "arm-panic-stop",
      label: "Arm",
      command: "arm",
      requiresPanicStopEnabled: true,
      disallowTerminalStop: true
    }),
    buildLifecycleControl({
      scope,
      clientRuntimeState,
      lifecycleSettings,
      hazardAssessment,
      persistedState,
      boundary,
      health,
      commandPlan,
      operationalResponse,
      persistenceRecoveryState,
      providerDispatchEnvelope,
      controlId: "commit-panic-stop",
      label: "Commit",
      command: "commit",
      requiresPanicStopEnabled: true,
      disallowTerminalStop: true
    }),
    buildLifecycleControl({
      scope,
      clientRuntimeState,
      lifecycleSettings,
      hazardAssessment,
      persistedState,
      boundary,
      health,
      commandPlan,
      operationalResponse,
      persistenceRecoveryState,
      providerDispatchEnvelope,
      controlId: "schedule-panic-stop",
      label: "Schedule",
      command: "schedule",
      requiresPanicStopEnabled: true,
      requiresSchedulingEnabled: true,
      disallowTerminalStop: true,
      payload: {
        scheduledFor: scheduleRequest.scheduledFor,
        scheduleWindowMs: lifecycleSettings.scheduleWindowMs
      }
    }),
    buildLifecycleControl({
      scope,
      clientRuntimeState,
      lifecycleSettings,
      hazardAssessment,
      persistedState,
      boundary,
      health,
      commandPlan,
      operationalResponse,
      persistenceRecoveryState,
      providerDispatchEnvelope,
      controlId: "cancel-scheduled-panic-stop",
      label: "Cancel schedule",
      command: "cancel-scheduled",
      requiresActiveSchedule: true,
      payload: {
        scheduleId: persistedState.scheduledStop.scheduleId
      }
    }),
    buildLifecycleControl({
      scope,
      clientRuntimeState,
      lifecycleSettings,
      hazardAssessment,
      persistedState,
      boundary,
      health,
      commandPlan,
      operationalResponse,
      persistenceRecoveryState,
      providerDispatchEnvelope,
      controlId: "enable-panic-stop-controls",
      label: "Enable controls",
      command: "enable",
      requiresSettingsAuthority: true,
      payload: {
        settingsDelta: { controlsEnabled: true, panicStopEnabled: true }
      }
    }),
    buildLifecycleControl({
      scope,
      clientRuntimeState,
      lifecycleSettings,
      hazardAssessment,
      persistedState,
      boundary,
      health,
      commandPlan,
      operationalResponse,
      persistenceRecoveryState,
      providerDispatchEnvelope,
      controlId: "disable-panic-stop-controls",
      label: "Disable panic-stop",
      command: "disable",
      requiresSettingsAuthority: true,
      payload: {
        settingsDelta: { panicStopEnabled: false }
      }
    })
  ];
  const enabledControls = controls.filter((control) => control.enabled);
  const currentControl = controls.find((control) => control.command === lifecycleCommand.command);
  const blockedCurrentCommand = currentControl && !currentControl.enabled;
  const nextEnabledControl = enabledControls.find((control) => control.command === lifecycleCommand.command)
    ?? enabledControls[0]
    ?? null;
  const settingsWarnings = [
    !lifecycleSettings.controlsEnabled ? "controls_disabled" : null,
    !lifecycleSettings.panicStopEnabled ? "panic_stop_disabled" : null,
    !lifecycleSettings.schedulingEnabled ? "scheduling_disabled" : null,
    lifecycleSettings.scheduleWindowMs < MAX_SCHEDULE_DELAY_MS ? "schedule_window_restricted" : null,
    settingsMutation.activeSchedule.outsideRequestedWindow ? "active_schedule_outside_requested_window" : null,
    settingsMutation.guardrails.disablesActiveSchedule ? "active_schedule_blocks_settings_disable" : null,
    hazardAssessment.safetyInterrupt?.active ? "runtime_safety_interrupt_active" : null
  ].filter(Boolean);

  return {
    schema: "aios.kernelLifecycle.panicStop.lifecycleControlPanel.v1",
    generatedAt: now,
    actorId: actor.actorId,
    scopeKey: scope.boundaryKey,
    command: lifecycleCommand.command,
    controlState: blockedCurrentCommand
      ? "requested_control_blocked"
      : commandPlan.accepted
        ? "requested_control_accepted"
        : enabledControls.length > 0
          ? "alternate_controls_available"
          : "all_controls_blocked",
    effectiveSettings: {
      controlsEnabled: lifecycleSettings.controlsEnabled,
      panicStopEnabled: lifecycleSettings.panicStopEnabled,
      schedulingEnabled: lifecycleSettings.schedulingEnabled,
      requireDualControl: lifecycleSettings.requireDualControl,
      proofMode: lifecycleSettings.proofMode,
      scheduleWindowMs: lifecycleSettings.scheduleWindowMs,
      projectedAfterMutation: settingsMutation.effectiveSettings,
      requestedPatch: settingsMutation.requestedPatch,
      settingsWriteRequired: settingsMutation.providerWrite.required,
      settingsWarnings
    },
    runtimeSafetyInterrupt: {
      active: hazardAssessment.safetyInterrupt?.active ?? false,
      level: hazardAssessment.safetyInterrupt?.level ?? "none",
      blockedCommands: hazardAssessment.safetyInterrupt?.blockedCommands ?? [],
      reasonCodes: hazardAssessment.safetyInterrupt?.reasonCodes ?? [],
      nextAction: hazardAssessment.safetyInterrupt?.nextAction ?? "continue_requested_lifecycle_command"
    },
    persistedControlState: {
      lifecycleState: persistedState.lifecycleState,
      panicStopArmed: persistedState.panicStopArmed,
      stopCommitted: persistedState.stopCommitted,
      activeScheduleId: persistedState.scheduledStop.status === "scheduled" ? persistedState.scheduledStop.scheduleId : null,
      activeScheduleFor: persistedState.scheduledStop.status === "scheduled" ? persistedState.scheduledStop.scheduledFor : null,
      nextWriteGeneration: persistenceRecoveryState.nextPersistedState.writeGeneration
    },
    controls,
    summary: {
      totalControlCount: controls.length,
      enabledControlCount: enabledControls.length,
      blockedControlCount: controls.length - enabledControls.length,
      settingsWarnings,
      providerBlocked: providerDispatchEnvelope.blockedProviderCommands.length > 0,
      runtimeSafetyBlocked: hazardAssessment.safetyInterrupt?.currentCommandBlocked ?? false,
      settingsMutationBlocked: settingsMutation.rejectedFields.length > 0
        || settingsMutation.guardrails.disablesActiveSchedule
        || settingsMutation.activeSchedule.outsideRequestedWindow
        || !settingsMutation.guardrails.controlsRemainReachable,
      retryable: operationalResponse.retry.retryable
    },
    nextAction: {
      code: hazardAssessment.safetyInterrupt?.currentCommandBlocked
        ? hazardAssessment.safetyInterrupt.nextAction
        : blockedCurrentCommand
          ? "choose_available_control_or_repair_current"
        : settingsMutation.nextAction !== "no_settings_write_required" && settingsMutation.nextAction !== "persist_settings_patch_with_audit_proof"
          ? settingsMutation.nextAction
        : commandPlan.accepted
          ? commandPlan.nextAction
          : nextEnabledControl
            ? `offer_${nextEnabledControl.command}_control`
            : operationalResponse.nextAction,
      preferredControlId: nextEnabledControl?.controlId ?? null,
      preferredCommand: nextEnabledControl?.command ?? null,
      retryAfter: operationalResponse.retry.retryAfter,
      preserveCommandKey: operationalResponse.retry.idempotencyRequirement === "reuse_command_key"
        || persistenceRecoveryState.recovery.required
    },
    auditProof: {
      proofId: providerDispatchEnvelope.auditProofOutput.proofId,
      proofSchema: "aios.kernelLifecycle.panicStop.lifecycleControlPanelProof.v1",
      claims: controls.map((control) => control.proofClaims)
    }
  };
}

function normalizeHistoryEvent(event = {}, index = 0) {
  const source = event && typeof event === "object" ? event : {};
  const sourceBoundary = source.boundary && typeof source.boundary === "object" ? source.boundary : {};
  const sourceDispatch = source.providerDispatchEnvelope && typeof source.providerDispatchEnvelope === "object"
    ? source.providerDispatchEnvelope
    : {};
  const sourceOperational = source.operationalResponse && typeof source.operationalResponse === "object"
    ? source.operationalResponse
    : {};
  const sourceRetry = sourceOperational.retry && typeof sourceOperational.retry === "object"
    ? sourceOperational.retry
    : {};
  const sourceHazard = source.runtimeHazardAssessment && typeof source.runtimeHazardAssessment === "object"
    ? source.runtimeHazardAssessment
    : {};
  const sourceSafetyInterrupt = sourceHazard.safetyInterrupt && typeof sourceHazard.safetyInterrupt === "object"
    ? sourceHazard.safetyInterrupt
    : source.runtimeSafetyInterrupt && typeof source.runtimeSafetyInterrupt === "object"
      ? source.runtimeSafetyInterrupt
      : {};
  const sourceExternalWriteBoundary = sourceHazard.externalWriteBoundary && typeof sourceHazard.externalWriteBoundary === "object"
    ? sourceHazard.externalWriteBoundary
    : source.externalWriteBoundary && typeof source.externalWriteBoundary === "object"
      ? source.externalWriteBoundary
      : {};
  const sourceHazardIsolation = source.runtimeHazardIsolationHealth && typeof source.runtimeHazardIsolationHealth === "object"
    ? source.runtimeHazardIsolationHealth
    : source.operationalHealth?.hazardIsolation && typeof source.operationalHealth.hazardIsolation === "object"
      ? source.operationalHealth.hazardIsolation
      : {};
  const sourceProviderMitigation = source.providerMitigationPlan && typeof source.providerMitigationPlan === "object"
    ? source.providerMitigationPlan
    : {};
  const sourceRestartRecovery = source.restartRecoveryProjection && typeof source.restartRecoveryProjection === "object"
    ? source.restartRecoveryProjection
    : {};
  const nestedViolations = Array.isArray(sourceBoundary.violations)
    ? sourceBoundary.violations.map((violation) => violation?.code)
    : [];
  const status = cleanText(
    source.status ?? source.lifecycleState ?? source.result,
    source.ok === true ? "committed" : source.ok === false ? "blocked" : "unknown"
  );
  const allowed = source.allowed === true || source.boundaryAllowed === true || status === "committed";
  const blocked = source.blocked === true || source.failed === true || status === "blocked" || status === "denied";
  const degradedMode = source.degradedMode === true || source.healthStatus === "degraded";
  const evidenceCount = cleanPositiveInteger(
    source.evidenceCount ?? (Array.isArray(source.evidence) ? source.evidence.length : undefined),
    0
  );

  return {
    eventId: cleanText(source.eventId ?? source.id, `history-${index + 1}`),
    occurredAt: cleanText(source.occurredAt ?? source.generatedAt ?? source.decisionAt ?? source.at, null),
    tenantId: cleanText(source.tenantId ?? source.scope?.tenantId, DEFAULT_SCOPE.tenantId),
    workspaceId: cleanText(source.workspaceId ?? source.scope?.workspaceId, DEFAULT_SCOPE.workspaceId),
    actorId: cleanText(source.actorId ?? source.actor?.actorId, "anonymous"),
    status: allowed && !blocked ? "committed" : blocked ? "blocked" : status,
    healthStatus: cleanText(source.healthStatus ?? source.operationalHealth?.status, "unknown"),
    operationalStatus: cleanText(source.operationalStatus ?? sourceOperational.status, "unknown"),
    operationalSeverity: cleanText(source.operationalSeverity ?? sourceOperational.severity, "unknown"),
    authority: cleanText(source.authority ?? source.boundary?.authority, "unknown"),
    failureCode: cleanText(source.failureCode ?? source.failureState?.failureCode, null),
    command: cleanText(source.command ?? source.lifecycleCommand ?? source.commandPlan?.command, "unknown"),
    commandRoute: cleanText(source.commandRoute ?? source.commandPlan?.route, "unknown"),
    commandAccepted: cleanBoolean(source.commandAccepted ?? source.commandPlan?.accepted, allowed && !blocked),
    proofId: cleanText(source.proofId ?? source.auditProofId ?? sourceDispatch.auditProofOutput?.proofId, null),
    dispatchMode: cleanText(source.dispatchMode ?? sourceDispatch.dispatchMode, "unknown"),
    providerCommandCount: cleanPositiveInteger(
      source.providerCommandCount ?? (Array.isArray(sourceDispatch.providerCommands) ? sourceDispatch.providerCommands.length : undefined),
      0
    ),
    blockedProviderCommandCount: cleanPositiveInteger(
      source.blockedProviderCommandCount
        ?? (Array.isArray(sourceDispatch.blockedProviderCommands) ? sourceDispatch.blockedProviderCommands.length : undefined),
      0
    ),
    retryClass: cleanText(source.retryClass ?? sourceRetry.class, "unknown"),
    retryAfter: cleanText(source.retryAfter ?? sourceRetry.retryAfter, null),
    degradedMode,
    evidenceCount,
    runtimeHazardDeclared: cleanBoolean(source.runtimeHazardDeclared ?? sourceHazard.declared, false),
    runtimeHazardCount: cleanPositiveInteger(source.runtimeHazardCount ?? sourceHazard.hazardCount, 0),
    externalWriteRisk: cleanBoolean(
      source.externalWriteRisk ?? source.runtimeHazardExternalWriteRisk ?? sourceHazard.externalWriteRisk,
      false
    ),
    safetyInterruptActive: cleanBoolean(
      source.safetyInterruptActive ?? source.runtimeSafetyInterruptActive ?? sourceSafetyInterrupt.active,
      false
    ),
    safetyInterruptLevel: cleanText(
      source.safetyInterruptLevel ?? source.runtimeSafetyInterruptLevel ?? sourceSafetyInterrupt.level,
      "none"
    ),
    externalWriteBoundaryTrusted: cleanBoolean(
      source.externalWriteBoundaryTrusted
        ?? source.runtimeHazardExternalWriteBoundaryTrusted
        ?? sourceExternalWriteBoundary.trusted,
      true
    ),
    runtimeHazardIsolationState: cleanText(
      source.runtimeHazardIsolationState ?? sourceHazardIsolation.state,
      "not_required"
    ),
    providerMitigationStatus: cleanText(
      source.providerMitigationStatus ?? sourceProviderMitigation.status,
      "unknown"
    ),
    restartRecoveryMode: cleanText(
      source.restartRecoveryMode ?? sourceRestartRecovery.recoveryMode,
      "unknown"
    ),
    restartFinalizable: cleanBoolean(
      source.restartFinalizable ?? sourceRestartRecovery.restartSafeStatus === "completed_restart_safe",
      false
    ),
    violationCodes: cleanList(source.violationCodes ?? sourceBoundary.violationCodes ?? nestedViolations)
  };
}

function normalizeAnalyticsExportRequest(input = {}) {
  const source = cleanRecord(input.analyticsExport ?? input.exportRequest ?? input.reporting);
  const requestedFormat = cleanText(source.format ?? input.analyticsExportFormat, "json").toLowerCase();
  const includeTimeline = cleanBoolean(source.includeTimeline ?? input.includeAnalyticsTimeline, true);
  const includeHistorySnapshots = cleanBoolean(source.includeHistorySnapshots ?? input.includeHistorySnapshots, true);
  const includeCounters = cleanBoolean(source.includeCounters ?? input.includeAnalyticsCounters, true);
  const requestedLimit = cleanPositiveInteger(source.timelineLimit ?? input.analyticsTimelineLimit, MAX_EXPORT_TIMELINE_EVENTS);

  return {
    schema: "aios.kernelLifecycle.panicStop.analyticsExportRequest.v1",
    format: ANALYTICS_EXPORT_FORMATS.has(requestedFormat) ? requestedFormat : "json",
    includeTimeline,
    includeHistorySnapshots,
    includeCounters,
    timelineLimit: Math.min(MAX_EXPORT_TIMELINE_EVENTS, Math.max(1, requestedLimit)),
    requestedBy: cleanText(source.requestedBy ?? input.analyticsRequestedBy, null),
    destination: cleanText(source.destination ?? input.analyticsExportDestination, "inline-response")
  };
}

function mostFrequentCounter(counter) {
  return Object.entries(counter).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function escapeCsvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serializeAnalyticsExportPreview({ format, summary, timeline }) {
  if (format === "csv") {
    const headers = [
      "sequence",
      "at",
      "eventId",
      "scopeKey",
      "command",
      "status",
      "operationalStatus",
      "severity",
      "safetyInterruptLevel",
      "externalWriteRisk",
      "failureCode",
      "proofId"
    ];
    const rows = timeline.map((event) => [
      event.sequence,
      event.at,
      event.eventId,
      event.scopeKey,
      event.command,
      event.status,
      event.operationalStatus,
      event.severity,
      event.safetyInterruptLevel,
      event.externalWriteRisk,
      event.failureCode,
      event.proofId
    ].map(escapeCsvCell).join(","));
    return [headers.join(","), ...rows].join("\n");
  }

  if (format === "ndjson") {
    return [
      { recordType: "summary", ...summary },
      ...timeline.map((event) => ({ recordType: "timeline", ...event }))
    ].map((record) => JSON.stringify(record)).join("\n");
  }

  return JSON.stringify({ summary, timeline }, null, 2);
}

function buildPanicStopAnalytics({
  now,
  actor,
  scope,
  boundary,
  evidence,
  health,
  failureState,
  input,
  hazardAssessment,
  lifecycleCommand,
  commandPlan,
  operationalResponse,
  providerDispatchEnvelope,
  providerMitigationPlan,
  restartRecoveryProjection,
  persistenceRecoveryState
}) {
  const historySource = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.historySnapshots)
      ? input.historySnapshots
      : Array.isArray(input.timeline)
        ? input.timeline
        : [];
  const exportRequest = normalizeAnalyticsExportRequest(input);
  const history = historySource.slice(-MAX_HISTORY_EVENTS).map((event, index) => normalizeHistoryEvent(event, index));
  const currentEvent = normalizeHistoryEvent({
    eventId: `${surfaceId}:current`,
    occurredAt: now,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorId: actor.actorId,
    status: boundary.allowed && health.canCommitStop ? "committed" : "blocked",
    healthStatus: health.status,
    operationalStatus: operationalResponse.status,
    operationalSeverity: operationalResponse.severity,
    authority: boundary.authority,
    failureCode: failureState.failureCode,
    degradedMode: health.degradedMode,
    evidenceCount: evidence.length,
    violationCodes: boundary.violations.map((violation) => violation.code),
    command: lifecycleCommand.command,
    commandRoute: commandPlan.route,
    commandAccepted: commandPlan.accepted,
    proofId: providerDispatchEnvelope.auditProofOutput.proofId,
    dispatchMode: providerDispatchEnvelope.dispatchMode,
    providerCommandCount: providerDispatchEnvelope.providerCommands.length,
    blockedProviderCommandCount: providerDispatchEnvelope.blockedProviderCommands.length,
    retryClass: operationalResponse.retry.class,
    retryAfter: operationalResponse.retry.retryAfter,
    runtimeHazardDeclared: hazardAssessment.declared,
    runtimeHazardCount: hazardAssessment.hazardCount,
    externalWriteRisk: hazardAssessment.externalWriteRisk,
    safetyInterruptActive: hazardAssessment.safetyInterrupt?.active ?? false,
    safetyInterruptLevel: hazardAssessment.safetyInterrupt?.level ?? "none",
    externalWriteBoundaryTrusted: hazardAssessment.externalWriteBoundary?.trusted ?? true,
    runtimeHazardIsolationState: health.hazardIsolation?.state ?? "not_required",
    providerMitigationStatus: providerMitigationPlan.status,
    restartRecoveryMode: restartRecoveryProjection.recoveryMode,
    restartFinalizable: restartRecoveryProjection.restartSafeStatus === "completed_restart_safe"
  }, history.length);
  const events = [...history, currentEvent];
  const counters = events.reduce((accumulator, event) => {
    accumulator.totalDecisions += 1;
    accumulator.byStatus[event.status] = (accumulator.byStatus[event.status] || 0) + 1;
    accumulator.byHealth[event.healthStatus] = (accumulator.byHealth[event.healthStatus] || 0) + 1;
    accumulator.byOperationalStatus[event.operationalStatus] = (accumulator.byOperationalStatus[event.operationalStatus] || 0) + 1;
    accumulator.byOperationalSeverity[event.operationalSeverity] = (accumulator.byOperationalSeverity[event.operationalSeverity] || 0) + 1;
    accumulator.byAuthority[event.authority] = (accumulator.byAuthority[event.authority] || 0) + 1;
    accumulator.byCommand[event.command] = (accumulator.byCommand[event.command] || 0) + 1;
    accumulator.byRoute[event.commandRoute] = (accumulator.byRoute[event.commandRoute] || 0) + 1;
    accumulator.byDispatchMode[event.dispatchMode] = (accumulator.byDispatchMode[event.dispatchMode] || 0) + 1;
    accumulator.byRetryClass[event.retryClass] = (accumulator.byRetryClass[event.retryClass] || 0) + 1;
    accumulator.bySafetyInterruptLevel[event.safetyInterruptLevel] = (accumulator.bySafetyInterruptLevel[event.safetyInterruptLevel] || 0) + 1;
    accumulator.byHazardIsolationState[event.runtimeHazardIsolationState] = (accumulator.byHazardIsolationState[event.runtimeHazardIsolationState] || 0) + 1;
    accumulator.byProviderMitigationStatus[event.providerMitigationStatus] = (accumulator.byProviderMitigationStatus[event.providerMitigationStatus] || 0) + 1;
    if (event.commandAccepted) {
      accumulator.acceptedDecisions += 1;
    }
    if (event.degradedMode) {
      accumulator.degradedModeDecisions += 1;
    }
    if (event.proofId) {
      accumulator.proofLinkedDecisions += 1;
    }
    if (event.runtimeHazardDeclared) {
      accumulator.runtimeHazardDecisions += 1;
      accumulator.runtimeHazardEvents += event.runtimeHazardCount;
    }
    if (event.externalWriteRisk) {
      accumulator.externalWriteRiskDecisions += 1;
    }
    if (event.externalWriteBoundaryTrusted === false) {
      accumulator.untrustedExternalWriteBoundaryDecisions += 1;
    }
    if (event.safetyInterruptActive) {
      accumulator.safetyInterruptDecisions += 1;
    }
    if (event.restartFinalizable) {
      accumulator.restartFinalizableDecisions += 1;
    }
    if (event.failureCode) {
      accumulator.byFailureCode[event.failureCode] = (accumulator.byFailureCode[event.failureCode] || 0) + 1;
    }
    for (const code of event.violationCodes) {
      accumulator.byViolationCode[code] = (accumulator.byViolationCode[code] || 0) + 1;
    }
    accumulator.evidenceItems += event.evidenceCount;
    accumulator.providerCommands += event.providerCommandCount;
    accumulator.blockedProviderCommands += event.blockedProviderCommandCount;
    return accumulator;
  }, {
    totalDecisions: 0,
    acceptedDecisions: 0,
    degradedModeDecisions: 0,
    proofLinkedDecisions: 0,
    runtimeHazardDecisions: 0,
    runtimeHazardEvents: 0,
    externalWriteRiskDecisions: 0,
    untrustedExternalWriteBoundaryDecisions: 0,
    safetyInterruptDecisions: 0,
    restartFinalizableDecisions: 0,
    evidenceItems: 0,
    providerCommands: 0,
    blockedProviderCommands: 0,
    byStatus: {},
    byHealth: {},
    byOperationalStatus: {},
    byOperationalSeverity: {},
    byAuthority: {},
    byCommand: {},
    byRoute: {},
    byDispatchMode: {},
    byRetryClass: {},
    bySafetyInterruptLevel: {},
    byHazardIsolationState: {},
    byProviderMitigationStatus: {},
    byFailureCode: {},
    byViolationCode: {}
  });
  const recentWindow = events.slice(-10);
  const exportTimeline = events.slice(-exportRequest.timelineLimit).map((event, index) => ({
    sequence: events.length - Math.min(events.length, exportRequest.timelineLimit) + index + 1,
    at: event.occurredAt,
    eventId: event.eventId,
    scopeKey: `${event.tenantId}:${event.workspaceId}`,
    actorId: event.actorId,
    command: event.command,
    route: event.commandRoute,
    status: event.status,
    operationalStatus: event.operationalStatus,
    severity: event.operationalSeverity,
    failureCode: event.failureCode,
    proofId: event.proofId,
    dispatchMode: event.dispatchMode,
    providerCommandCount: event.providerCommandCount,
    blockedProviderCommandCount: event.blockedProviderCommandCount,
    retryClass: event.retryClass,
    retryAfter: event.retryAfter,
    runtimeHazardDeclared: event.runtimeHazardDeclared,
    runtimeHazardCount: event.runtimeHazardCount,
    externalWriteRisk: event.externalWriteRisk,
    safetyInterruptActive: event.safetyInterruptActive,
    safetyInterruptLevel: event.safetyInterruptLevel,
    externalWriteBoundaryTrusted: event.externalWriteBoundaryTrusted,
    runtimeHazardIsolationState: event.runtimeHazardIsolationState,
    providerMitigationStatus: event.providerMitigationStatus,
    restartRecoveryMode: event.restartRecoveryMode,
    restartFinalizable: event.restartFinalizable
  }));
  const blockedRecent = recentWindow.filter((event) => event.status === "blocked").length;
  const blockedProviderRate = counters.providerCommands + counters.blockedProviderCommands === 0
    ? 0
    : Number((counters.blockedProviderCommands / (counters.providerCommands + counters.blockedProviderCommands)).toFixed(4));
  const exportSummary = {
    schema: "aios.kernelLifecycle.panicStop.analytics.v1",
    generatedAt: now,
    surfaceId,
    scopeKey: scope.boundaryKey,
    currentDecisionStatus: currentEvent.status,
    currentFailureCode: currentEvent.failureCode,
    currentLifecycleCommand: lifecycleCommand.command,
    currentNextAction: commandPlan.nextAction,
    currentOperationalStatus: operationalResponse.status,
    currentOperationalSeverity: operationalResponse.severity,
    currentRetryAfter: operationalResponse.retry.retryAfter,
    historyEventsIncluded: history.length,
    totalDecisions: counters.totalDecisions,
    acceptedDecisionRate: counters.totalDecisions === 0
      ? 0
      : Number((counters.acceptedDecisions / counters.totalDecisions).toFixed(4)),
    blockedDecisionRate: counters.totalDecisions === 0
      ? 0
      : Number(((counters.byStatus.blocked || 0) / counters.totalDecisions).toFixed(4)),
    degradedDecisionRate: counters.totalDecisions === 0
      ? 0
      : Number((counters.degradedModeDecisions / counters.totalDecisions).toFixed(4)),
    proofLinkedDecisionRate: counters.totalDecisions === 0
      ? 0
      : Number((counters.proofLinkedDecisions / counters.totalDecisions).toFixed(4)),
    runtimeHazardDecisionRate: counters.totalDecisions === 0
      ? 0
      : Number((counters.runtimeHazardDecisions / counters.totalDecisions).toFixed(4)),
    externalWriteRiskDecisionRate: counters.totalDecisions === 0
      ? 0
      : Number((counters.externalWriteRiskDecisions / counters.totalDecisions).toFixed(4)),
    safetyInterruptDecisionRate: counters.totalDecisions === 0
      ? 0
      : Number((counters.safetyInterruptDecisions / counters.totalDecisions).toFixed(4)),
    blockedProviderCommandRate: blockedProviderRate,
    runtimeHazardEvents: counters.runtimeHazardEvents,
    untrustedExternalWriteBoundaryDecisions: counters.untrustedExternalWriteBoundaryDecisions,
    restartFinalizableDecisions: counters.restartFinalizableDecisions,
    evidenceItems: counters.evidenceItems,
    providerCommands: counters.providerCommands,
    blockedProviderCommands: counters.blockedProviderCommands,
    topFailureCode: mostFrequentCounter(counters.byFailureCode),
    topViolationCode: mostFrequentCounter(counters.byViolationCode),
    topRetryClass: mostFrequentCounter(counters.byRetryClass),
    topDispatchMode: mostFrequentCounter(counters.byDispatchMode),
    topSafetyInterruptLevel: mostFrequentCounter(counters.bySafetyInterruptLevel),
    topHazardIsolationState: mostFrequentCounter(counters.byHazardIsolationState),
    topProviderMitigationStatus: mostFrequentCounter(counters.byProviderMitigationStatus)
  };
  const exportPreview = serializeAnalyticsExportPreview({
    format: exportRequest.format,
    summary: exportSummary,
    timeline: exportTimeline
  });

  return {
    schema: "aios.kernelLifecycle.panicStop.analyticsState.v1",
    generatedAt: now,
    exportRequest,
    counters,
    snapshots: {
      current: currentEvent,
      recent: recentWindow,
      retainedHistoryLimit: MAX_HISTORY_EVENTS,
      previousHistoryCount: history.length
    },
    timeline: events.map((event, index) => ({
      sequence: index + 1,
      at: event.occurredAt,
      eventId: event.eventId,
      command: event.command,
      route: event.commandRoute,
      status: event.status,
      healthStatus: event.healthStatus,
      operationalStatus: event.operationalStatus,
      severity: event.operationalSeverity,
      failureCode: event.failureCode,
      degradedMode: event.degradedMode,
      proofId: event.proofId,
      dispatchMode: event.dispatchMode,
      runtimeHazardDeclared: event.runtimeHazardDeclared,
      runtimeHazardCount: event.runtimeHazardCount,
      externalWriteRisk: event.externalWriteRisk,
      safetyInterruptActive: event.safetyInterruptActive,
      safetyInterruptLevel: event.safetyInterruptLevel,
      externalWriteBoundaryTrusted: event.externalWriteBoundaryTrusted,
      runtimeHazardIsolationState: event.runtimeHazardIsolationState,
      providerMitigationStatus: event.providerMitigationStatus,
      restartRecoveryMode: event.restartRecoveryMode,
      restartFinalizable: event.restartFinalizable
    })),
    reportingState: {
      exportReady: true,
      format: exportRequest.format,
      retention: "latest-history-window-plus-current-decision",
      timelineEventCount: exportTimeline.length,
      historySnapshotCount: history.length,
      currentProofId: currentEvent.proofId,
      currentCommandKey: persistenceRecoveryState.commandKey,
      escalationSignal: operationalResponse.severity === "critical"
        ? "critical_operational_block"
        : currentEvent.externalWriteBoundaryTrusted === false
          ? "external_write_boundary_untrusted"
        : currentEvent.safetyInterruptActive
          ? "runtime_safety_interrupt_active"
        : blockedRecent >= 3
          ? "repeated_recent_blocks"
          : health.status === "unhealthy" ? "current_health_block" : "none",
      auditCorrelationId: `${surfaceId}:${scope.boundaryKey}:${now}`,
      reportColumns: [
        "sequence",
        "at",
        "eventId",
        "scopeKey",
        "command",
        "status",
        "operationalStatus",
        "severity",
        "safetyInterruptLevel",
        "externalWriteRisk",
        "failureCode",
        "proofId"
      ]
    },
    exportPackage: {
      schema: "aios.kernelLifecycle.panicStop.analyticsExportPackage.v1",
      packageId: `${surfaceId}:${scope.boundaryKey}:analytics:${now}`,
      format: exportRequest.format,
      destination: exportRequest.destination,
      contentType: exportRequest.format === "csv"
        ? "text/csv"
        : exportRequest.format === "ndjson"
          ? "application/x-ndjson"
          : "application/json",
      previewBytes: exportPreview.length,
      preview: exportPreview,
      sections: {
        counters: exportRequest.includeCounters ? counters : null,
        summary: exportSummary,
        timeline: exportRequest.includeTimeline ? exportTimeline : [],
        historySnapshots: exportRequest.includeHistorySnapshots ? history : []
      }
    },
    exportSummary
  };
}

export function describePanicStopSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const actor = normalizeActor(input);
  const scope = normalizeScope(input);
  const clientRuntimeState = normalizeClientRuntimeState(input);
  const persistedState = normalizePersistedPanicStopState({ input, scope });
  const requestedAction = cleanText(input.action, "panic-stop");
  const lifecycleCommand = normalizeLifecycleCommand(input);
  const lifecycleSettings = normalizeLifecycleSettings(input);
  const scheduleRequest = normalizeScheduleRequest({ input, now });
  const hazardAssessment = normalizeRuntimeHazardAssessment({
    input,
    evidence,
    lifecycleCommand,
    scope
  });
  const settingsMutation = normalizeLifecycleSettingsMutation({
    input,
    lifecycleCommand,
    lifecycleSettings,
    persistedState,
    scheduleRequest,
    now
  });
  const integrationProviders = normalizeIntegrationProviders(input);
  const validation = validatePanicStopRequest({
    actor,
    scope,
    requestedAction,
    evidence,
    lifecycleCommand,
    lifecycleSettings,
    scheduleRequest,
    settingsMutation,
    hazardAssessment
  });
  const dependencies = normalizeDependencyHealth(input);
  const dependencyHealth = evaluateOperationalHealth({ dependencies, validation, hazardAssessment });
  const providerNegotiation = negotiateProviderContracts({
    now,
    scope,
    lifecycleCommand,
    hazardAssessment,
    providers: integrationProviders,
    health: dependencyHealth,
    persistedState
  });
  const health = evaluateOperationalHealth({ dependencies, validation, providerNegotiation, hazardAssessment });
  const boundary = evaluatePanicStopBoundary({ actor, scope, requestedAction, lifecycleCommand });
  const retryPolicy = buildRetryPolicy({
    input,
    health,
    validation,
    boundary,
    lifecycleCommand,
    providerNegotiation
  });
  const failureState = buildFailureState({ boundary, health, validation, retryPolicy, providerNegotiation });
  const operationalResponse = buildOperationalResponse({
    now,
    lifecycleCommand,
    health,
    validation,
    boundary,
    retryPolicy,
    providerNegotiation
  });
  const commandPlan = buildLifecycleCommandPlan({
    now,
    actor,
    lifecycleCommand,
    lifecycleSettings,
    hazardAssessment,
    settingsMutation,
    scheduleRequest,
    boundary,
    health,
    failureState,
    providerNegotiation,
    operationalResponse
  });
  const externalHandoffState = buildExternalHandoffState({
    now,
    scope,
    lifecycleCommand,
    commandPlan,
    providerNegotiation
  });
  const persistenceRecoveryState = buildPersistenceRecoveryState({
    now,
    input,
    actor,
    scope,
    lifecycleCommand,
    scheduleRequest,
    commandPlan,
    persistedState,
    externalHandoffState
  });
  const providerDispatchEnvelope = buildProviderDispatchEnvelope({
    now,
    actor,
    scope,
    evidence,
    hazardAssessment,
    lifecycleCommand,
    lifecycleSettings,
    scheduleRequest,
    commandPlan,
    operationalResponse,
    externalHandoffState,
    persistenceRecoveryState
  });
  const providerMitigationPlan = buildProviderMitigationPlan({
    now,
    operationalResponse,
    providerDispatchEnvelope
  });
  const restartSafeCommandJournal = buildRestartSafeCommandJournal({
    now,
    actor,
    scope,
    lifecycleCommand,
    persistedState,
    persistenceRecoveryState,
    externalHandoffState,
    providerDispatchEnvelope
  });
  const restartRecoveryProjection = buildRestartRecoveryProjection({
    now,
    scope,
    lifecycleCommand,
    persistedState,
    persistenceRecoveryState,
    restartSafeCommandJournal,
    providerDispatchEnvelope
  });
  const auditHandoff = buildAuditHandoff({
    now,
    actor,
    scope,
    boundary,
    evidence,
    hazardAssessment,
    health,
    failureState,
    lifecycleCommand,
    commandPlan,
    operationalResponse,
    externalHandoffState,
    persistenceRecoveryState,
    providerDispatchEnvelope,
    providerMitigationPlan,
    restartRecoveryProjection
  });
  const analytics = buildPanicStopAnalytics({
    now,
    actor,
    scope,
    boundary,
    evidence,
    health,
    failureState,
    input,
    hazardAssessment,
    lifecycleCommand,
    commandPlan,
    operationalResponse,
    providerDispatchEnvelope,
    providerMitigationPlan,
    restartRecoveryProjection,
    persistenceRecoveryState
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    now,
    actor,
    scope,
    lifecycleCommand,
    lifecycleSettings,
    hazardAssessment,
    scheduleRequest,
    validation,
    boundary,
    health,
    commandPlan,
    operationalResponse,
    persistenceRecoveryState,
    providerDispatchEnvelope,
    providerMitigationPlan
  });
  const clientStateConsistency = buildClientStateConsistencyContract({
    now,
    scope,
    clientRuntimeState,
    lifecycleCommand,
    previewAcceptance,
    persistenceRecoveryState,
    providerDispatchEnvelope
  });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    now,
    actor,
    scope,
    clientRuntimeState,
    clientStateConsistency,
    hazardAssessment,
    lifecycleCommand,
    commandPlan,
    operationalResponse,
    previewAcceptance,
    persistenceRecoveryState,
    providerDispatchEnvelope
  });
  const lifecycleControlPanel = buildLifecycleControlPanel({
    now,
    actor,
    scope,
    clientRuntimeState,
    lifecycleCommand,
    lifecycleSettings,
    hazardAssessment,
    settingsMutation,
    scheduleRequest,
    persistedState,
    boundary,
    health,
    commandPlan,
    operationalResponse,
    persistenceRecoveryState,
    providerDispatchEnvelope
  });
  const routePreviewAcceptanceHandoff = buildRoutePreviewAcceptanceHandoff({
    now,
    actor,
    scope,
    clientRuntimeState,
    lifecycleCommand,
    validation,
    boundary,
    health,
    previewAcceptance,
    clientStateConsistency,
    clientWorkflowHandoff,
    lifecycleControlPanel,
    persistenceRecoveryState,
    providerDispatchEnvelope,
    providerMitigationPlan
  });
  const acceptanceSubmissionContract = buildAcceptanceSubmissionContract({
    now,
    input,
    actor,
    scope,
    clientRuntimeState,
    clientStateConsistency,
    clientWorkflowHandoff,
    routePreviewAcceptanceHandoff,
    previewAcceptance,
    persistenceRecoveryState,
    providerDispatchEnvelope
  });

  return {
    ok: commandPlan.accepted,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel panic-stop boundary decision",
    action: requestedAction,
    lifecycleCommand,
    lifecycleSettings,
    lifecycleSettingsMutation: settingsMutation,
    runtimeHazardAssessment: hazardAssessment,
    scheduleRequest,
    clientRuntimeState,
    clientStateConsistency,
    clientWorkflowHandoff,
    lifecycleControlPanel,
    routePreviewAcceptanceHandoff,
    acceptanceSubmissionContract,
    commandPlan,
    integrationProviders,
    providerNegotiation,
    externalHandoffState,
    providerDispatchEnvelope,
    providerMitigationPlan,
    restartSafeCommandJournal,
    restartRecoveryProjection,
    persistedState,
    persistenceRecoveryState,
    scope,
    actor: {
      actorId: actor.actorId,
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      roles: actor.roles,
      permissions: actor.permissions
    },
    boundary,
    validation,
    previewAcceptance,
    operationalHealth: health,
    operationalResponse,
    retryPolicy,
    failureState,
    auditHandoff,
    analytics,
    safeState: buildSafeState({ boundary, health, lifecycleCommand, commandPlan, persistenceRecoveryState }),
    evidence
  };
}

export default describePanicStopSurface;
