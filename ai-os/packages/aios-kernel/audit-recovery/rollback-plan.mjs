export const surfaceId = "aios_audit-recovery_rollback-plan_074";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "rollback-plan";

const ACTIVE_STATUSES = new Set(["draft", "prepared", "executing", "recovering"]);
const TERMINAL_STATUSES = new Set(["recovered", "rolled_back", "failed"]);
const KNOWN_STATUSES = new Set([...ACTIVE_STATUSES, ...TERMINAL_STATUSES, "needs_recovery"]);
const VALID_COMMANDS = new Set([
  "shape",
  "create",
  "checkpoint",
  "update_settings",
  "enable",
  "disable",
  "schedule",
  "prepare",
  "execute",
  "recover",
  "mark_recovered",
  "fail"
]);
const ROLE_PERMISSIONS = {
  system: new Set(VALID_COMMANDS),
  owner: new Set(VALID_COMMANDS),
  maintainer: new Set(["shape", "create", "checkpoint", "update_settings", "enable", "disable", "schedule", "prepare", "execute", "recover", "mark_recovered"]),
  recovery_operator: new Set(["shape", "checkpoint", "enable", "disable", "schedule", "prepare", "execute", "recover", "mark_recovered"]),
  auditor: new Set(["shape"]),
  viewer: new Set(["shape"])
};
const DEFAULT_TENANT_ID = "tenant:hosted-kernel";
const DEFAULT_WORKSPACE_ID = "workspace:default";
const MAX_HISTORY_SNAPSHOTS = 12;
const MAX_TIMELINE_EVENTS = 40;
const MAX_RECOVERY_JOURNAL_ATTEMPTS = 8;
const MAX_EXTERNAL_HANDOFF_ITEMS = 6;
const MAX_IDEMPOTENCY_LEDGER_ENTRIES = 32;
const CHECKPOINT_SAFETY_COMMANDS = new Set(["prepare", "execute", "recover", "mark_recovered"]);
const MUTATING_RECOVERY_COMMANDS = new Set(["checkpoint", "prepare", "execute", "recover", "mark_recovered"]);
const BOUNDARY_ENFORCED_COMMANDS = new Set([...VALID_COMMANDS].filter((command) => command !== "shape"));
const VALID_SCHEDULE_CADENCES = new Set(["manual", "hourly", "daily", "weekly"]);
const VALID_EXTERNAL_HANDOFF_STATES = new Set(["pending", "claimed", "delivered", "failed"]);
const VALID_CLIENT_PREVIEW_MODES = new Set(["interactive", "read_only", "auto_claim"]);
const VALID_FAILURE_ESCALATION_STRATEGIES = new Set(["manual_review", "operator_approval", "degraded_retry", "auto_recover"]);
const LIFECYCLE_OPERATOR_COMMANDS = ["update_settings", "enable", "disable", "schedule", "checkpoint", "prepare", "execute", "recover", "mark_recovered"];
const LIFECYCLE_NEXT_ACTION_COMMANDS = {
  enable_rollback_plan: "enable",
  fix_lifecycle_settings: "update_settings",
  record_checkpoint: "checkpoint",
  verify_checkpoint: "checkpoint",
  select_safe_checkpoint: "checkpoint",
  prepare_rollback: "prepare",
  wait_for_schedule_or_execute: "schedule",
  execute_rollback: "execute",
  recover_from_checkpoint: "recover",
  mark_recovered_after_validation: "mark_recovered",
  resolve_operational_errors: "shape",
  monitor: "shape",
  none: "shape"
};
const PROVIDER_SERVICE_DEFAULTS = {
  auditHandoff: {
    providerId: "provider:hosted-kernel.audit-log",
    requiredCapabilities: ["audit.append", "audit.proof"]
  },
  checkpointStore: {
    providerId: "provider:hosted-kernel.checkpoint-store",
    requiredCapabilities: ["checkpoint.read", "checkpoint.write", "checkpoint.verify"]
  },
  recoveryExecutor: {
    providerId: "provider:hosted-kernel.recovery-executor",
    requiredCapabilities: ["recovery.execute", "recovery.resume", "recovery.verify"]
  },
  syncCoordinator: {
    providerId: "provider:hosted-kernel.sync-coordinator",
    requiredCapabilities: ["sync.pull", "sync.push", "handoff.claim"]
  }
};
const COMMAND_REQUIRED_CAPABILITIES = {
  checkpoint: ["checkpoint.write", "checkpoint.verify", "audit.append"],
  prepare: ["checkpoint.read", "checkpoint.verify", "audit.append"],
  execute: ["checkpoint.read", "recovery.execute", "audit.append"],
  recover: ["checkpoint.read", "recovery.resume", "audit.append"],
  mark_recovered: ["recovery.verify", "audit.append", "sync.push"],
  fail: ["audit.append", "sync.push"],
  update_settings: ["sync.push"],
  enable: ["sync.push"],
  disable: ["sync.push"],
  schedule: ["sync.push"]
};
const COMMAND_REQUIRED_SERVICES = {
  checkpoint: ["checkpointStore", "auditHandoff"],
  prepare: ["checkpointStore", "auditHandoff"],
  execute: ["checkpointStore", "recoveryExecutor", "auditHandoff"],
  recover: ["checkpointStore", "recoveryExecutor", "auditHandoff"],
  mark_recovered: ["recoveryExecutor", "auditHandoff", "syncCoordinator"],
  fail: ["auditHandoff", "syncCoordinator"],
  update_settings: ["syncCoordinator"],
  enable: ["syncCoordinator"],
  disable: ["syncCoordinator"],
  schedule: ["syncCoordinator"]
};
const PROVIDER_REMEDIATION_ACTIONS = {
  auditHandoff: "Restore audit append/proof delivery or route rollback evidence to a compliant audit provider.",
  checkpointStore: "Restore checkpoint read/write/verify access before advancing rollback state.",
  recoveryExecutor: "Restore recovery executor capacity before executing or resuming rollback.",
  syncCoordinator: "Restore sync push and handoff claim support before completing cross-route handoff."
};

function asIsoTimestamp(value, fallback) {
  if (typeof value !== "string" || value.length === 0) return fallback;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? fallback : timestamp.toISOString();
}

function asNonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => asNonEmptyString(entry, null)).filter(Boolean))];
}

function normalizeBoundaryMode(value) {
  return value === "tenant" ? "tenant" : "same_workspace";
}

function normalizeSchedule(input = {}, now) {
  const rawSchedule = input && typeof input === "object" ? input : {};
  const cadence = VALID_SCHEDULE_CADENCES.has(rawSchedule.cadence) ? rawSchedule.cadence : "manual";
  const enabled = rawSchedule.enabled === true && cadence !== "manual";
  const nextRunAt = enabled ? asIsoTimestamp(rawSchedule.nextRunAt, null) : null;
  const validationErrors = [];

  if (rawSchedule.enabled === true && cadence === "manual") validationErrors.push("schedule_enabled_requires_non_manual_cadence");
  if (enabled && !nextRunAt) validationErrors.push("schedule_next_run_at_required");
  if (enabled && nextRunAt && new Date(nextRunAt).getTime() <= new Date(now).getTime()) {
    validationErrors.push("schedule_next_run_at_must_be_future");
  }

  return {
    enabled,
    cadence,
    nextRunAt,
    timezone: asNonEmptyString(rawSchedule.timezone, "UTC"),
    validationErrors
  };
}

function normalizeLifecycleSettings(input = {}, now) {
  const rawSettings = input && typeof input === "object" ? input : {};
  const schedule = normalizeSchedule(rawSettings.schedule, now);
  const validationErrors = [...schedule.validationErrors];
  const maxRollbackAgeHours = Number.isInteger(rawSettings.maxRollbackAgeHours)
    ? Math.max(1, Math.min(rawSettings.maxRollbackAgeHours, 720))
    : 168;

  if (rawSettings.allowUnverifiedExecution === true && rawSettings.requireOperatorApproval !== true) {
    validationErrors.push("unverified_execution_requires_operator_approval");
  }

  return {
    enabled: rawSettings.enabled !== false,
    requireVerifiedCheckpoint: rawSettings.requireVerifiedCheckpoint !== false,
    requireAuditHandoff: rawSettings.requireAuditHandoff !== false,
    requireOperatorApproval: rawSettings.requireOperatorApproval === true,
    allowUnverifiedExecution: rawSettings.allowUnverifiedExecution === true,
    maxRollbackAgeHours,
    schedule,
    validationErrors
  };
}

function normalizeCheckpoint(checkpoint, index, now, defaults = {}) {
  const raw = checkpoint && typeof checkpoint === "object" ? checkpoint : {};
  const checkpointId = asNonEmptyString(raw.checkpointId || raw.id, `checkpoint-${index + 1}`);
  return {
    checkpointId,
    label: asNonEmptyString(raw.label, checkpointId),
    stateRef: asNonEmptyString(raw.stateRef || raw.snapshotRef, "unbound"),
    createdAt: asIsoTimestamp(raw.createdAt, now),
    tenantId: asNonEmptyString(raw.tenantId, defaults.tenantId || DEFAULT_TENANT_ID),
    workspaceId: asNonEmptyString(raw.workspaceId, defaults.workspaceId || DEFAULT_WORKSPACE_ID),
    reversible: raw.reversible !== false,
    verified: raw.verified === true
  };
}

function normalizeHistorySnapshot(snapshot, index, now, defaults = {}) {
  const raw = snapshot && typeof snapshot === "object" ? snapshot : {};
  const generation = Number.isInteger(raw.generation) && raw.generation >= 0 ? raw.generation : defaults.generation || 0;
  const status = KNOWN_STATUSES.has(raw.status) ? raw.status : defaults.status || "draft";
  const checkpointCount = Number.isInteger(raw.checkpointCount) && raw.checkpointCount >= 0
    ? raw.checkpointCount
    : defaults.checkpointCount || 0;
  const commandCount = Number.isInteger(raw.commandCount) && raw.commandCount >= 0
    ? raw.commandCount
    : defaults.commandCount || 0;
  return {
    snapshotId: asNonEmptyString(raw.snapshotId || raw.id, `history-${generation}-${index + 1}`),
    capturedAt: asIsoTimestamp(raw.capturedAt || raw.at, now),
    generation,
    status,
    healthState: asNonEmptyString(raw.healthState, defaults.healthState || "unknown"),
    recoveryStatus: asNonEmptyString(raw.recoveryStatus, defaults.recoveryStatus || status),
    checkpointCount,
    verifiedCheckpointCount: Math.min(
      Math.max(Number.isInteger(raw.verifiedCheckpointCount) ? raw.verifiedCheckpointCount : defaults.verifiedCheckpointCount || 0, 0),
      checkpointCount
    ),
    commandCount,
    auditEventCount: Math.max(0, Number.isInteger(raw.auditEventCount) ? raw.auditEventCount : defaults.auditEventCount || 0)
  };
}

function normalizeRecoveryJournalAttempt(attempt, index, now, defaults = {}) {
  const raw = attempt && typeof attempt === "object" ? attempt : {};
  return {
    attemptId: asNonEmptyString(raw.attemptId || raw.id, `attempt-${index + 1}`),
    commandId: asNonEmptyString(raw.commandId, defaults.commandId || null),
    semanticKey: asNonEmptyString(raw.semanticKey, defaults.semanticKey || null),
    command: asNonEmptyString(raw.command, defaults.command || "recover"),
    startedAt: asIsoTimestamp(raw.startedAt || raw.at, defaults.startedAt || now),
    completedAt: asIsoTimestamp(raw.completedAt, null),
    status: ["started", "completed", "interrupted", "replayed"].includes(raw.status) ? raw.status : "started",
    checkpointId: asNonEmptyString(raw.checkpointId, defaults.checkpointId || null),
    rollbackCursor: Number.isInteger(raw.rollbackCursor) ? raw.rollbackCursor : defaults.rollbackCursor ?? -1,
    generation: Number.isInteger(raw.generation) && raw.generation >= 0 ? raw.generation : defaults.generation || 0
  };
}

function normalizeRecoveryJournal(input = {}, now, defaults = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const pendingOperation = raw.pendingOperation && typeof raw.pendingOperation === "object" ? raw.pendingOperation : null;
  const attempts = Array.isArray(raw.attempts)
    ? raw.attempts
        .map((attempt, index) => normalizeRecoveryJournalAttempt(attempt, index, now, defaults))
        .slice(-MAX_RECOVERY_JOURNAL_ATTEMPTS)
    : [];

  return {
    contractType: "rollback-plan.recovery-journal.v1",
    lastStableGeneration: Number.isInteger(raw.lastStableGeneration) && raw.lastStableGeneration >= 0
      ? raw.lastStableGeneration
      : defaults.generation || 0,
    lastStableStatus: KNOWN_STATUSES.has(raw.lastStableStatus) ? raw.lastStableStatus : defaults.status || "draft",
    pendingOperation: pendingOperation
      ? {
          command: asNonEmptyString(pendingOperation.command, "recover"),
          commandId: asNonEmptyString(pendingOperation.commandId, null),
          semanticKey: asNonEmptyString(pendingOperation.semanticKey, null),
          startedAt: asIsoTimestamp(pendingOperation.startedAt, now),
          checkpointId: asNonEmptyString(pendingOperation.checkpointId, defaults.checkpointId || null),
          rollbackCursor: Number.isInteger(pendingOperation.rollbackCursor)
            ? pendingOperation.rollbackCursor
            : defaults.rollbackCursor ?? -1,
          generation: Number.isInteger(pendingOperation.generation) && pendingOperation.generation >= 0
            ? pendingOperation.generation
            : defaults.generation || 0
        }
      : null,
    attempts
  };
}

function normalizeIdempotencyLedgerEntry(entry, index, now, defaults = {}) {
  const raw = entry && typeof entry === "object" ? entry : {};
  const command = VALID_COMMANDS.has(raw.command) ? raw.command : asNonEmptyString(raw.command, defaults.command || "shape");
  const commandId = asNonEmptyString(raw.commandId || raw.id, defaults.commandId || `${command}:${index + 1}`);
  const semanticKey = asNonEmptyString(raw.semanticKey, defaults.semanticKey || commandId);
  const generation = Number.isInteger(raw.generation) && raw.generation >= 0
    ? raw.generation
    : defaults.generation || 0;

  return {
    ledgerEntryId: asNonEmptyString(raw.ledgerEntryId || raw.entryId, `${commandId}:${generation}`),
    commandId,
    semanticKey,
    command,
    acceptedAt: asIsoTimestamp(raw.acceptedAt || raw.appliedAt, defaults.acceptedAt || now),
    generation,
    statusAfter: KNOWN_STATUSES.has(raw.statusAfter) ? raw.statusAfter : defaults.statusAfter || "draft",
    actorId: asNonEmptyString(raw.actorId, defaults.actorId || null),
    actorRole: asNonEmptyString(raw.actorRole, defaults.actorRole || null),
    tenantId: asNonEmptyString(raw.tenantId, defaults.tenantId || DEFAULT_TENANT_ID),
    workspaceId: asNonEmptyString(raw.workspaceId, defaults.workspaceId || DEFAULT_WORKSPACE_ID),
    recoveryPending: raw.recoveryPending === true,
    completed: raw.completed !== false,
    replayCount: Number.isInteger(raw.replayCount) && raw.replayCount >= 0 ? raw.replayCount : 0,
    lastReplayAt: asIsoTimestamp(raw.lastReplayAt, null)
  };
}

function normalizeIdempotencyLedger(input = [], commandLog = [], now, defaults = {}) {
  const explicitEntries = Array.isArray(input) ? input : [];
  const sourceEntries = explicitEntries.length > 0
    ? explicitEntries
    : commandLog.map((entry) => ({
        ...entry,
        acceptedAt: entry.appliedAt,
        completed: true
      }));
  const normalized = sourceEntries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => normalizeIdempotencyLedgerEntry(entry, index, now, defaults))
    .filter((entry) => entry.commandId || entry.semanticKey)
    .slice(-MAX_IDEMPOTENCY_LEDGER_ENTRIES);
  const seen = new Set();
  const deduped = [];

  for (const entry of normalized) {
    const key = `${entry.commandId}|${entry.semanticKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function normalizePersistedState(input = {}, now) {
  const state = input && typeof input === "object" ? input : {};
  const tenantId = asNonEmptyString(state.tenantId, DEFAULT_TENANT_ID);
  const workspaceId = asNonEmptyString(state.workspaceId, DEFAULT_WORKSPACE_ID);
  const generation = Number.isInteger(state.generation) && state.generation >= 0 ? state.generation : 0;
  const status = KNOWN_STATUSES.has(state.status) ? state.status : "draft";
  const checkpoints = Array.isArray(state.checkpoints)
    ? state.checkpoints.map((checkpoint, index) => normalizeCheckpoint(checkpoint, index, now, { tenantId, workspaceId }))
    : [];
  const commandLog = Array.isArray(state.commandLog)
    ? state.commandLog
        .filter((entry) => entry && typeof entry === "object" && typeof entry.commandId === "string")
        .map((entry) => ({
          commandId: entry.commandId,
          command: asNonEmptyString(entry.command, "unknown"),
          semanticKey: asNonEmptyString(entry.semanticKey, null),
          appliedAt: asIsoTimestamp(entry.appliedAt, now),
          generation: Number.isInteger(entry.generation) ? entry.generation : generation,
          statusAfter: KNOWN_STATUSES.has(entry.statusAfter) ? entry.statusAfter : null,
          recoveryPending: entry.recoveryPending === true,
          actorId: asNonEmptyString(entry.actorId, null),
          actorRole: asNonEmptyString(entry.actorRole, null),
          tenantId: asNonEmptyString(entry.tenantId, tenantId),
          workspaceId: asNonEmptyString(entry.workspaceId, workspaceId)
        }))
    : [];
  const lifecycleSettings = normalizeLifecycleSettings(state.lifecycleSettings, now);
  const historySnapshots = Array.isArray(state.historySnapshots)
    ? state.historySnapshots
        .map((snapshot, index) => normalizeHistorySnapshot(snapshot, index, now, {
          generation,
          status,
          checkpointCount: checkpoints.length,
          verifiedCheckpointCount: checkpoints.filter((checkpoint) => checkpoint.verified).length,
          commandCount: commandLog.length
        }))
        .slice(-MAX_HISTORY_SNAPSHOTS)
    : [];
  const rollbackCursor = Math.min(
    Math.max(Number.isInteger(state.rollbackCursor) ? state.rollbackCursor : checkpoints.length - 1, -1),
    checkpoints.length - 1
  );
  const selectedCheckpoint = rollbackCursor >= 0 ? checkpoints[rollbackCursor] : null;

  return {
    planId: asNonEmptyString(state.planId, `rollback-plan:${surfaceId}`),
    tenantId,
    workspaceId,
    status,
    generation,
    createdAt: asIsoTimestamp(state.createdAt, now),
    updatedAt: asIsoTimestamp(state.updatedAt, state.createdAt || now),
    rollbackCursor,
    checkpoints,
    commandLog,
    idempotencyLedger: normalizeIdempotencyLedger(state.idempotencyLedger, commandLog, now, { tenantId, workspaceId, generation, status }),
    lifecycleSettings,
    historySnapshots,
    recoveryJournal: normalizeRecoveryJournal(state.recoveryJournal, now, {
      generation,
      status,
      rollbackCursor,
      checkpointId: selectedCheckpoint?.checkpointId || null
    }),
    lastError: typeof state.lastError === "string" ? state.lastError : null
  };
}

function normalizeActor(input = {}, state = {}) {
  const rawActor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const requestedRole = asNonEmptyString(rawActor.role || input.role, "system");
  const role = ROLE_PERMISSIONS[requestedRole] ? requestedRole : "viewer";
  return {
    actorId: asNonEmptyString(rawActor.actorId || rawActor.id || input.actorId, "system:rollback-plan"),
    role,
    tenantId: asNonEmptyString(rawActor.tenantId || input.tenantId, state.tenantId || DEFAULT_TENANT_ID),
    workspaceId: asNonEmptyString(rawActor.workspaceId || input.workspaceId, state.workspaceId || DEFAULT_WORKSPACE_ID),
    delegatedPermissions: asStringList(rawActor.permissions || input.permissions)
  };
}

function normalizeWorkspaceScope(input = {}, state = {}) {
  const rawScope = input.scope && typeof input.scope === "object" ? input.scope : {};
  const tenantId = asNonEmptyString(rawScope.tenantId || input.tenantId, state.tenantId || DEFAULT_TENANT_ID);
  const workspaceId = asNonEmptyString(rawScope.workspaceId || input.workspaceId, state.workspaceId || DEFAULT_WORKSPACE_ID);
  const allowedWorkspaceIds = asStringList(rawScope.allowedWorkspaceIds || input.allowedWorkspaceIds);
  const allowedTenants = asStringList(rawScope.allowedTenantIds || input.allowedTenantIds);
  return {
    tenantId,
    workspaceId,
    boundaryMode: normalizeBoundaryMode(rawScope.boundaryMode || input.boundaryMode),
    allowedWorkspaceIds: allowedWorkspaceIds.length > 0 ? allowedWorkspaceIds : [workspaceId],
    allowedTenantIds: allowedTenants.length > 0 ? allowedTenants : [tenantId]
  };
}

function commandAllowedForActor(actor, command) {
  return deriveActorPermissionDecision(actor, command).accepted;
}

function deriveActorPermissionDecision(actor, command) {
  const rolePermissions = ROLE_PERMISSIONS[actor.role] || ROLE_PERMISSIONS.viewer;
  const delegatedCommands = actor.delegatedPermissions.filter((permission) => VALID_COMMANDS.has(permission));
  const invalidDelegatedPermissions = actor.delegatedPermissions.filter((permission) => !VALID_COMMANDS.has(permission));
  const source = rolePermissions.has(command)
    ? "role"
    : delegatedCommands.includes(command)
      ? "delegated"
      : "none";

  return {
    contractType: "rollback-plan.actor-permission-decision.v1",
    actorId: actor.actorId,
    role: actor.role,
    command,
    accepted: source !== "none",
    source,
    rolePermissions: [...rolePermissions].sort(),
    delegatedCommands,
    invalidDelegatedPermissions
  };
}

function isTenantAllowed(tenantId, scope) {
  return scope.allowedTenantIds.includes(tenantId);
}

function isWorkspaceAllowed(tenantId, workspaceId, scope) {
  if (!isTenantAllowed(tenantId, scope)) return false;
  if (scope.boundaryMode === "tenant") return true;
  return workspaceId === scope.workspaceId && scope.allowedWorkspaceIds.includes(workspaceId);
}

function normalizeScopedResourceRef(resource, defaults = {}) {
  const raw = resource && typeof resource === "object" ? resource : {};
  return {
    resourceType: asNonEmptyString(raw.resourceType || defaults.resourceType, "checkpoint"),
    resourceId: asNonEmptyString(raw.resourceId || raw.checkpointId || raw.id, defaults.resourceId || "pending"),
    tenantId: asNonEmptyString(raw.tenantId, defaults.tenantId || DEFAULT_TENANT_ID),
    workspaceId: asNonEmptyString(raw.workspaceId, defaults.workspaceId || DEFAULT_WORKSPACE_ID),
    source: asNonEmptyString(defaults.source, "command_payload")
  };
}

function deriveCommandPayloadScopeReport(command, commandInput = {}, actor = {}, scope = {}) {
  const resources = [];
  const checkpointInput = commandInput.checkpoint && typeof commandInput.checkpoint === "object"
    ? commandInput.checkpoint
    : null;
  const checkpointTenantExplicit = checkpointInput && typeof checkpointInput.tenantId === "string";
  const checkpointWorkspaceExplicit = checkpointInput && typeof checkpointInput.workspaceId === "string";

  if (command === "checkpoint" && checkpointInput && (checkpointTenantExplicit || checkpointWorkspaceExplicit)) {
    resources.push(normalizeScopedResourceRef(checkpointInput, {
      resourceType: "checkpoint",
      resourceId: checkpointInput.checkpointId || checkpointInput.id || commandInput.commandId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      source: "checkpoint_payload"
    }));
  }

  const selectedCheckpointRef = commandInput.selectedCheckpoint && typeof commandInput.selectedCheckpoint === "object"
    ? commandInput.selectedCheckpoint
    : null;
  if (selectedCheckpointRef) {
    resources.push(normalizeScopedResourceRef(selectedCheckpointRef, {
      resourceType: "selected_checkpoint_ref",
      resourceId: selectedCheckpointRef.checkpointId || selectedCheckpointRef.id || "selected",
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      source: "selected_checkpoint_payload"
    }));
  }

  const findings = resources.map((resource) => ({
    ...resource,
    allowed: isWorkspaceAllowed(resource.tenantId, resource.workspaceId, scope)
  }));
  const violations = [];

  if (findings.some((finding) => !isTenantAllowed(finding.tenantId, scope))) {
    violations.push("payload_tenant_not_allowed");
  }
  if (findings.some((finding) => !finding.allowed)) {
    violations.push("payload_workspace_not_allowed");
  }
  if (command === "checkpoint" && checkpointInput && checkpointTenantExplicit && checkpointInput.tenantId !== scope.tenantId) {
    violations.push("checkpoint_payload_tenant_mismatch");
  }
  if (
    command === "checkpoint"
    && checkpointInput
    && checkpointWorkspaceExplicit
    && scope.boundaryMode !== "tenant"
    && checkpointInput.workspaceId !== scope.workspaceId
  ) {
    violations.push("checkpoint_payload_workspace_mismatch");
  }

  return {
    contractType: "rollback-plan.command-payload-scope-report.v1",
    command,
    actorId: actor.actorId,
    actorRole: actor.role,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    boundaryMode: scope.boundaryMode,
    resourceCount: findings.length,
    scopedResources: findings,
    violations: [...new Set(violations)],
    clean: violations.length === 0
  };
}

function deriveWorkspaceIsolationReport(state, actor, scope) {
  const checkpointFindings = state.checkpoints
    .map((checkpoint, index) => ({
      index,
      checkpointId: checkpoint.checkpointId,
      tenantId: checkpoint.tenantId,
      workspaceId: checkpoint.workspaceId,
      selected: index === state.rollbackCursor,
      allowed: isWorkspaceAllowed(checkpoint.tenantId, checkpoint.workspaceId, scope)
    }))
    .filter((finding) => !finding.allowed || finding.selected);
  const commandLogFindings = state.commandLog
    .map((entry, index) => ({
      index,
      commandId: entry.commandId,
      command: entry.command,
      generation: entry.generation,
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      allowed: isWorkspaceAllowed(entry.tenantId, entry.workspaceId, scope)
    }))
    .filter((finding) => !finding.allowed);
  const pendingOperation = state.recoveryJournal?.pendingOperation || null;
  const selectedCheckpoint = state.rollbackCursor >= 0 ? state.checkpoints[state.rollbackCursor] : null;
  const selectedCheckpointAllowed = selectedCheckpoint
    ? isWorkspaceAllowed(selectedCheckpoint.tenantId, selectedCheckpoint.workspaceId, scope)
    : true;
  const pendingCheckpoint = pendingOperation?.checkpointId
    ? state.checkpoints.find((checkpoint) => checkpoint.checkpointId === pendingOperation.checkpointId) || null
    : null;
  const pendingOperationAllowed = !pendingOperation
    || !pendingCheckpoint
    || isWorkspaceAllowed(pendingCheckpoint.tenantId, pendingCheckpoint.workspaceId, scope);
  const violations = [];

  if (!isTenantAllowed(state.tenantId, scope)) violations.push("state_tenant_not_allowed");
  if (!isTenantAllowed(actor.tenantId, scope)) violations.push("actor_tenant_not_allowed");
  if (checkpointFindings.some((finding) => !finding.allowed)) violations.push("checkpoint_outside_workspace_boundary");
  if (commandLogFindings.length > 0) violations.push("command_log_outside_workspace_boundary");
  if (!selectedCheckpointAllowed) violations.push("selected_checkpoint_outside_workspace_boundary");
  if (!pendingOperationAllowed) violations.push("pending_operation_checkpoint_outside_workspace_boundary");

  return {
    contractType: "rollback-plan.workspace-isolation-report.v1",
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    boundaryMode: scope.boundaryMode,
    allowedTenantIds: scope.allowedTenantIds,
    allowedWorkspaceIds: scope.allowedWorkspaceIds,
    actorTenantId: actor.tenantId,
    actorWorkspaceId: actor.workspaceId,
    stateTenantId: state.tenantId,
    stateWorkspaceId: state.workspaceId,
    selectedCheckpointId: selectedCheckpoint?.checkpointId || null,
    selectedCheckpointAllowed,
    pendingOperationAllowed,
    foreignCheckpointCount: checkpointFindings.filter((finding) => !finding.allowed).length,
    foreignCommandLogCount: commandLogFindings.length,
    checkpointFindings,
    commandLogFindings,
    violations,
    clean: violations.length === 0
  };
}

function validateCommandBoundary(state, command, actor, scope) {
  const violations = [];
  const targetTenantId = scope.tenantId;
  const targetWorkspaceId = scope.workspaceId;
  const permissionDecision = deriveActorPermissionDecision(actor, command);
  const isolationReport = deriveWorkspaceIsolationReport(state, actor, scope);

  if (state.tenantId !== targetTenantId) violations.push("state_tenant_mismatch");
  if (actor.tenantId !== targetTenantId) violations.push("actor_tenant_mismatch");
  if (!scope.allowedTenantIds.includes(targetTenantId)) violations.push("tenant_not_in_scope");
  if (scope.boundaryMode !== "tenant" && state.workspaceId !== targetWorkspaceId) {
    violations.push("state_workspace_mismatch");
  }
  if (scope.boundaryMode !== "tenant" && actor.workspaceId !== targetWorkspaceId) {
    violations.push("actor_workspace_mismatch");
  }
  if (scope.boundaryMode === "same_workspace" && !scope.allowedWorkspaceIds.includes(targetWorkspaceId)) {
    violations.push("workspace_not_in_scope");
  }
  if (!permissionDecision.accepted) violations.push("role_permission_denied");
  if (permissionDecision.invalidDelegatedPermissions.length > 0) violations.push("invalid_delegated_permissions");
  if (BOUNDARY_ENFORCED_COMMANDS.has(command) && !isolationReport.clean) {
    violations.push("workspace_isolation_failed");
  }

  return {
    accepted: violations.length === 0,
    violations,
    tenantId: targetTenantId,
    workspaceId: targetWorkspaceId,
    actorRole: actor.role,
    permissionDecision,
    isolationReport
  };
}

function normalizeAuditHandoff(input = {}, state = {}, boundary = {}) {
  const rawHandoff = input.auditHandoff && typeof input.auditHandoff === "object" ? input.auditHandoff : {};
  const target = asNonEmptyString(rawHandoff.target || input.auditTarget, "hosted-kernel.audit-log");
  return {
    target,
    mode: asNonEmptyString(rawHandoff.mode, "append_only"),
    tenantId: boundary.tenantId || state.tenantId,
    workspaceId: boundary.workspaceId || state.workspaceId,
    correlationId: asNonEmptyString(rawHandoff.correlationId || input.correlationId, `${state.planId}:${state.generation + 1}`),
    required: rawHandoff.required !== false
  };
}

function normalizeRetryPolicy(input = {}) {
  const rawPolicy = input.retryPolicy && typeof input.retryPolicy === "object" ? input.retryPolicy : {};
  const attempts = Number.isInteger(rawPolicy.attempts ?? input.retryAttempts) ? rawPolicy.attempts ?? input.retryAttempts : 0;
  const maxAttempts = Number.isInteger(rawPolicy.maxAttempts) ? rawPolicy.maxAttempts : 3;
  const baseDelayMs = Number.isInteger(rawPolicy.baseDelayMs) ? rawPolicy.baseDelayMs : 1000;
  const cappedAttempts = Math.max(0, attempts);
  return {
    attempts: cappedAttempts,
    maxAttempts: Math.max(1, maxAttempts),
    baseDelayMs: Math.max(250, baseDelayMs),
    strategy: asNonEmptyString(rawPolicy.strategy, "exponential_backoff")
  };
}

function normalizeFailurePolicy(input = {}) {
  const rawPolicy = input.failurePolicy && typeof input.failurePolicy === "object" ? input.failurePolicy : {};
  const maxConsecutiveFailures = Number.isInteger(rawPolicy.maxConsecutiveFailures)
    ? Math.max(1, Math.min(rawPolicy.maxConsecutiveFailures, 10))
    : 3;
  const staleFailureMinutes = Number.isInteger(rawPolicy.staleFailureMinutes)
    ? Math.max(1, Math.min(rawPolicy.staleFailureMinutes, 1440))
    : 30;
  const escalationStrategy = VALID_FAILURE_ESCALATION_STRATEGIES.has(rawPolicy.escalationStrategy)
    ? rawPolicy.escalationStrategy
    : "manual_review";

  return {
    contractType: "rollback-plan.failure-policy.v1",
    maxConsecutiveFailures,
    staleFailureMinutes,
    escalationStrategy,
    allowDegradedRetry: rawPolicy.allowDegradedRetry === true,
    requireFreshCheckpointAfterFailure: rawPolicy.requireFreshCheckpointAfterFailure !== false
  };
}

function normalizeIntegrationHealth(input = {}) {
  const rawHealth = input.integrationHealth && typeof input.integrationHealth === "object" ? input.integrationHealth : {};
  const auditHandoff = rawHealth.auditHandoff && typeof rawHealth.auditHandoff === "object" ? rawHealth.auditHandoff : {};
  const checkpointStore = rawHealth.checkpointStore && typeof rawHealth.checkpointStore === "object" ? rawHealth.checkpointStore : {};
  const recoveryExecutor = rawHealth.recoveryExecutor && typeof rawHealth.recoveryExecutor === "object" ? rawHealth.recoveryExecutor : {};
  return {
    auditHandoffAvailable: auditHandoff.available !== false,
    checkpointStoreAvailable: checkpointStore.available !== false,
    recoveryExecutorAvailable: recoveryExecutor.available !== false,
    degradedReason: asNonEmptyString(rawHealth.degradedReason, null)
  };
}

function normalizeSyncMetadata(rawSync = {}, now) {
  const cursor = asNonEmptyString(rawSync.cursor || rawSync.syncCursor, null);
  const upstreamRevision = Number.isInteger(rawSync.upstreamRevision) && rawSync.upstreamRevision >= 0
    ? rawSync.upstreamRevision
    : null;
  const localRevision = Number.isInteger(rawSync.localRevision) && rawSync.localRevision >= 0
    ? rawSync.localRevision
    : null;
  return {
    cursor,
    upstreamRevision,
    localRevision,
    lastSyncedAt: asIsoTimestamp(rawSync.lastSyncedAt, null),
    dirty: rawSync.dirty === true || (localRevision !== null && upstreamRevision !== null && localRevision > upstreamRevision),
    pendingPush: rawSync.pendingPush === true,
    leaseExpiresAt: asIsoTimestamp(rawSync.leaseExpiresAt, null),
    observedAt: asIsoTimestamp(rawSync.observedAt, now)
  };
}

function normalizeProviderServiceContract(serviceName, input = {}, now) {
  const defaults = PROVIDER_SERVICE_DEFAULTS[serviceName] || {
    providerId: `provider:hosted-kernel.${serviceName}`,
    requiredCapabilities: []
  };
  const explicitCapabilities = asStringList(input.capabilities || input.advertisedCapabilities);
  const advertisedCapabilities = explicitCapabilities.length > 0 ? explicitCapabilities : defaults.requiredCapabilities;
  const requiredCapabilities = asStringList(input.requiredCapabilities).length > 0
    ? asStringList(input.requiredCapabilities)
    : defaults.requiredCapabilities;
  const available = input.available !== false && input.status !== "offline";
  const missingCapabilities = requiredCapabilities.filter((capability) => !advertisedCapabilities.includes(capability));

  return {
    serviceName,
    providerId: asNonEmptyString(input.providerId || input.id, defaults.providerId),
    contractVersion: asNonEmptyString(input.contractVersion || input.version, "hosted-kernel.provider-contract.v1"),
    endpointRef: asNonEmptyString(input.endpointRef || input.endpoint, `${defaults.providerId}:local`),
    available,
    status: available && missingCapabilities.length === 0 ? "ready" : available ? "capability_gap" : "offline",
    capabilities: advertisedCapabilities,
    requiredCapabilities,
    missingCapabilities,
    sync: normalizeSyncMetadata(input.sync || input.syncMetadata, now)
  };
}

function normalizeExternalHandoffItem(item, index, state = {}, auditHandoff = {}, now) {
  const raw = item && typeof item === "object" ? item : {};
  const handoffState = VALID_EXTERNAL_HANDOFF_STATES.has(raw.state) ? raw.state : "pending";
  const command = VALID_COMMANDS.has(raw.command) ? raw.command : "shape";
  return {
    handoffItemId: asNonEmptyString(raw.handoffItemId || raw.id, `handoff-item-${index + 1}`),
    target: asNonEmptyString(raw.target, auditHandoff.target || "hosted-kernel.audit-log"),
    command,
    state: handoffState,
    correlationId: asNonEmptyString(raw.correlationId, auditHandoff.correlationId || `${state.planId}:${state.generation}`),
    claimRef: asNonEmptyString(raw.claimRef, null),
    providerId: asNonEmptyString(raw.providerId, null),
    createdAt: asIsoTimestamp(raw.createdAt, now),
    updatedAt: asIsoTimestamp(raw.updatedAt, raw.createdAt || now),
    retryAfterAt: asIsoTimestamp(raw.retryAfterAt, null),
    requiredCapabilities: asStringList(raw.requiredCapabilities).length > 0
      ? asStringList(raw.requiredCapabilities)
      : ["handoff.claim", "sync.push"],
    errorCode: handoffState === "failed" ? asNonEmptyString(raw.errorCode, "handoff_delivery_failed") : null
  };
}

function normalizeExternalHandoffState(input = {}, state = {}, auditHandoff = {}, services = {}, now) {
  const handoffInput = input.externalHandoff && typeof input.externalHandoff === "object" ? input.externalHandoff : {};
  const syncCoordinator = services.syncCoordinator || normalizeProviderServiceContract("syncCoordinator", {}, now);
  const handoffRequired = auditHandoff.required || handoffInput.required === true;
  const explicitQueue = Array.isArray(handoffInput.queue)
    ? handoffInput.queue
    : Array.isArray(handoffInput.items)
      ? handoffInput.items
      : [];
  const currentItem = handoffRequired && explicitQueue.length === 0
    ? [{
        id: `${state.planId}:${state.generation}:external-handoff`,
        target: handoffInput.target || auditHandoff.target,
        command: input.command,
        correlationId: handoffInput.correlationId || auditHandoff.correlationId,
        claimRef: handoffInput.claimRef,
        state: handoffInput.state
      }]
    : [];
  const queue = [...explicitQueue, ...currentItem]
    .map((item, index) => normalizeExternalHandoffItem(item, index, state, auditHandoff, now))
    .slice(-MAX_EXTERNAL_HANDOFF_ITEMS);
  const handoffClaimable = syncCoordinator.available && syncCoordinator.capabilities.includes("handoff.claim");
  const syncPushAvailable = syncCoordinator.available && syncCoordinator.capabilities.includes("sync.push");
  const failedItems = queue.filter((item) => item.state === "failed");
  const pendingItems = queue.filter((item) => item.state === "pending");
  const claimableItems = queue.filter((item) => item.state === "pending" && !item.claimRef);
  const blockedReasons = [];

  if (handoffRequired && !handoffClaimable) blockedReasons.push("sync_coordinator_handoff_claim_missing");
  if (handoffRequired && !syncPushAvailable) blockedReasons.push("sync_coordinator_sync_push_missing");
  if (failedItems.length > 0) blockedReasons.push("external_handoff_delivery_failed");

  return {
    contractType: "rollback-plan.external-handoff-state.v1",
    target: asNonEmptyString(handoffInput.target, auditHandoff.target || "hosted-kernel.audit-log"),
    correlationId: asNonEmptyString(handoffInput.correlationId, auditHandoff.correlationId),
    required: handoffRequired,
    state: !handoffRequired && queue.length === 0
      ? "not_required"
      : blockedReasons.length > 0
        ? "blocked"
        : pendingItems.length > 0
          ? "pending"
          : "ready",
    claimRef: asNonEmptyString(handoffInput.claimRef, queue.find((item) => item.claimRef)?.claimRef || null),
    blockedReason: blockedReasons[0] || null,
    blockedReasons,
    claimable: handoffClaimable && blockedReasons.length === 0,
    syncPushAvailable,
    queueDepth: queue.length,
    pendingCount: pendingItems.length,
    failedCount: failedItems.length,
    deliveredCount: queue.filter((item) => item.state === "delivered").length,
    claimableItemIds: claimableItems.map((item) => item.handoffItemId),
    items: queue
  };
}

function normalizeProviderContracts(input = {}, state = {}, auditHandoff = {}, now) {
  const rawContracts = input.providerContracts && typeof input.providerContracts === "object" ? input.providerContracts : {};
  const rawProviders = input.integrationProviders && typeof input.integrationProviders === "object" ? input.integrationProviders : {};
  const services = {};

  for (const serviceName of Object.keys(PROVIDER_SERVICE_DEFAULTS)) {
    const rawService = rawContracts[serviceName] || rawProviders[serviceName] || {};
    services[serviceName] = normalizeProviderServiceContract(serviceName, rawService, now);
  }

  const syncDirty = Object.values(services).some((service) => service.sync.dirty || service.sync.pendingPush);
  const externalHandoff = normalizeExternalHandoffState(input, state, auditHandoff, services, now);

  return {
    contractType: "rollback-plan.provider-contracts.v1",
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    services,
    syncMetadata: {
      dirty: syncDirty,
      providerCount: Object.keys(services).length,
      pendingPushServices: Object.values(services)
        .filter((service) => service.sync.pendingPush || service.sync.dirty)
        .map((service) => service.serviceName),
      externalHandoffPending: externalHandoff.pendingCount > 0,
      externalHandoffQueueDepth: externalHandoff.queueDepth,
      observedAt: now
    },
    externalHandoff
  };
}

function negotiateProviderCapabilities(providerContracts, command) {
  const services = providerContracts.services || {};
  const advertised = new Set();
  const offlineServices = [];
  const required = COMMAND_REQUIRED_CAPABILITIES[command] || ["audit.append"];

  for (const service of Object.values(services)) {
    if (!service.available) {
      const serviceCapabilities = new Set([...service.capabilities, ...service.requiredCapabilities]);
      if (required.some((capability) => serviceCapabilities.has(capability))) {
        offlineServices.push(service.serviceName);
      }
      continue;
    }
    for (const capability of service.capabilities) advertised.add(capability);
  }

  const missingCapabilities = required.filter((capability) => !advertised.has(capability));
  const serviceGaps = Object.values(services)
    .filter((service) => service.available && service.missingCapabilities.length > 0)
    .map((service) => ({
      serviceName: service.serviceName,
      providerId: service.providerId,
      missingCapabilities: service.missingCapabilities
    }));

  return {
    contractType: "rollback-plan.capability-negotiation.v1",
    command,
    accepted: missingCapabilities.length === 0 && offlineServices.length === 0,
    requiredCapabilities: required,
    advertisedCapabilities: [...advertised].sort(),
    missingCapabilities,
    offlineServices,
    serviceGaps,
    externalHandoffState: providerContracts.externalHandoff.state,
    externalHandoffClaimable: providerContracts.externalHandoff.claimable,
    externalHandoffPendingCount: providerContracts.externalHandoff.pendingCount,
    externalHandoffFailedCount: providerContracts.externalHandoff.failedCount,
    syncDirty: providerContracts.syncMetadata.dirty
  };
}

function deriveProviderOperationalReadiness(providerContracts, command, now) {
  const requiredServices = COMMAND_REQUIRED_SERVICES[command] || [];
  const nowMs = new Date(now).getTime();
  const serviceFindings = requiredServices.map((serviceName) => {
    const service = providerContracts.services?.[serviceName] || normalizeProviderServiceContract(serviceName, {}, now);
    const leaseExpiresAtMs = service.sync.leaseExpiresAt ? new Date(service.sync.leaseExpiresAt).getTime() : null;
    const leaseExpired = typeof leaseExpiresAtMs === "number"
      && !Number.isNaN(leaseExpiresAtMs)
      && !Number.isNaN(nowMs)
      && leaseExpiresAtMs <= nowMs;
    const blockingReasons = [];
    const warningReasons = [];

    if (!service.available) blockingReasons.push("provider_offline");
    if (service.missingCapabilities.length > 0) blockingReasons.push("provider_capability_gap");
    if (leaseExpired && ["syncCoordinator", "recoveryExecutor"].includes(serviceName)) {
      blockingReasons.push("provider_lease_expired");
    } else if (leaseExpired) {
      warningReasons.push("provider_lease_expired");
    }
    if (service.sync.pendingPush || service.sync.dirty) warningReasons.push("provider_sync_dirty");

    return {
      serviceName,
      providerId: service.providerId,
      status: service.status,
      ready: blockingReasons.length === 0,
      degraded: warningReasons.length > 0 || service.status === "capability_gap",
      requiredCapabilities: service.requiredCapabilities,
      missingCapabilities: service.missingCapabilities,
      blockingReasons,
      warningReasons,
      action: PROVIDER_REMEDIATION_ACTIONS[serviceName] || "Restore the required hosted-kernel provider before retrying.",
      sync: service.sync
    };
  });
  const blockingServices = serviceFindings.filter((finding) => !finding.ready);
  const degradedServices = serviceFindings.filter((finding) => finding.ready && finding.degraded);
  const handoffBlocked = providerContracts.externalHandoff.required && providerContracts.externalHandoff.state === "blocked";
  const handoffPending = providerContracts.externalHandoff.pendingCount > 0;
  const runnableInDegradedMode = blockingServices.length === 0 && (degradedServices.length > 0 || providerContracts.syncMetadata.dirty);

  return {
    contractType: "rollback-plan.provider-operational-readiness.v1",
    command,
    evaluatedAt: now,
    state: blockingServices.length > 0 || handoffBlocked
      ? "blocked"
      : runnableInDegradedMode
        ? "degraded"
        : "ready",
    requiredServices,
    blockingServices: blockingServices.map((finding) => finding.serviceName),
    degradedServices: degradedServices.map((finding) => finding.serviceName),
    handoffBlocked,
    handoffPending,
    handoffBlockedReasons: providerContracts.externalHandoff.blockedReasons,
    runnableInDegradedMode: runnableInDegradedMode || handoffPending,
    retryable: blockingServices.length > 0 || degradedServices.length > 0 || handoffBlocked || handoffPending,
    action: blockingServices[0]?.action
      || (handoffBlocked ? PROVIDER_REMEDIATION_ACTIONS.syncCoordinator : degradedServices[0]?.action)
      || (handoffPending ? "Claim and deliver pending external handoff items before marking rollback complete." : null)
      || "Continue rollback monitoring.",
    findings: serviceFindings
  };
}

function buildActionableError(code, message, action, details = {}) {
  return {
    code,
    message,
    action,
    retryable: details.retryable === true,
    severity: asNonEmptyString(details.severity, "error"),
    details: details.details || {}
  };
}

function deriveRetryBackoff(retryPolicy, now, retryable) {
  const exhausted = retryPolicy.attempts >= retryPolicy.maxAttempts;
  const delayMs = retryable && !exhausted
    ? retryPolicy.baseDelayMs * 2 ** Math.max(0, retryPolicy.attempts)
    : 0;
  const nowMs = new Date(now).getTime();
  const retryBaseMs = Number.isNaN(nowMs) ? Date.now() : nowMs;
  const nextRetryAt = delayMs > 0 ? new Date(retryBaseMs + delayMs).toISOString() : null;
  return {
    retryable: retryable && !exhausted,
    attempts: retryPolicy.attempts,
    maxAttempts: retryPolicy.maxAttempts,
    strategy: retryPolicy.strategy,
    nextDelayMs: delayMs,
    nextRetryAt,
    exhausted
  };
}

function minutesBetween(startIso, endIso) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  return Math.floor((endMs - startMs) / 60_000);
}

function deriveFailureStateEnvelope({ state, commandResult, providerReadiness, failurePolicy, retryPolicy, errors, warnings, now }) {
  const journalAttempts = state.recoveryJournal?.attempts || [];
  const recentFailureAttempts = journalAttempts
    .filter((attempt) => ["started", "interrupted"].includes(attempt.status))
    .slice(-failurePolicy.maxConsecutiveFailures);
  const latestAttempt = journalAttempts[journalAttempts.length - 1] || null;
  const latestAttemptAgeMinutes = latestAttempt ? minutesBetween(latestAttempt.startedAt, now) : null;
  const latestCommand = state.commandLog[state.commandLog.length - 1] || null;
  const retryableFindingCount = [...errors, ...warnings].filter((entry) => entry.retryable).length;
  const hardErrorCodes = errors.filter((entry) => entry.severity === "critical").map((entry) => entry.code);
  const retry = deriveRetryBackoff(retryPolicy, now, retryableFindingCount > 0);
  const stalePendingOperation = state.recoveryJournal?.pendingOperation !== null
    && typeof latestAttemptAgeMinutes === "number"
    && latestAttemptAgeMinutes >= failurePolicy.staleFailureMinutes;
  const consecutiveFailureLimitReached = recentFailureAttempts.length >= failurePolicy.maxConsecutiveFailures;
  const retryBudgetExhausted = retry.exhausted && retryableFindingCount > 0;
  const providerBlocked = providerReadiness.state === "blocked";
  const persistedFailure = Boolean(state.lastError || state.status === "failed");
  const rejectedCommand = commandResult.rejected === true;
  const degradedRetryAllowed = failurePolicy.allowDegradedRetry
    && providerReadiness.runnableInDegradedMode
    && !retryBudgetExhausted
    && !consecutiveFailureLimitReached
    && !persistedFailure;
  const escalationReasons = [
    ...(persistedFailure ? ["persisted_failure_state"] : []),
    ...(stalePendingOperation ? ["pending_operation_stale"] : []),
    ...(consecutiveFailureLimitReached ? ["consecutive_failure_limit_reached"] : []),
    ...(retryBudgetExhausted ? ["retry_budget_exhausted"] : []),
    ...(providerBlocked ? ["provider_readiness_blocked"] : []),
    ...(hardErrorCodes.length > 0 ? ["critical_health_error"] : [])
  ];
  const stateName = escalationReasons.length > 0
    ? "escalated"
    : degradedRetryAllowed
      ? "degraded_retry"
      : retry.retryable
        ? "retry_wait"
        : rejectedCommand
          ? "command_rejected"
          : "clear";
  const nextCommand = stateName === "escalated"
    ? (state.rollbackCursor >= 0 ? "recover" : "checkpoint")
    : stateName === "degraded_retry"
      ? commandResult.command
      : retry.retryable
        ? "shape"
        : "shape";

  return {
    contractType: "rollback-plan.failure-state.v1",
    evaluatedAt: now,
    state: stateName,
    strategy: failurePolicy.escalationStrategy,
    retryable: retry.retryable && stateName !== "escalated",
    retryBudgetExhausted,
    consecutiveFailureLimitReached,
    stalePendingOperation,
    degradedRetryAllowed,
    persistedFailure,
    providerBlocked,
    rejectedCommand,
    retryAfterAt: retry.nextRetryAt,
    retryDelayMs: retry.nextDelayMs,
    retryAttempts: retry.attempts,
    retryMaxAttempts: retry.maxAttempts,
    maxConsecutiveFailures: failurePolicy.maxConsecutiveFailures,
    staleFailureMinutes: failurePolicy.staleFailureMinutes,
    latestAttemptId: latestAttempt?.attemptId || null,
    latestAttemptAgeMinutes,
    latestCommandId: latestCommand?.commandId || null,
    latestCommand: latestCommand?.command || commandResult.command,
    activeErrorCodes: errors.map((entry) => entry.code),
    activeWarningCodes: warnings.map((entry) => entry.code),
    criticalErrorCodes: hardErrorCodes,
    escalationReasons,
    nextCommand,
    operatorAction: escalationReasons.length > 0
      ? "Stop automatic rollback progression, preserve audit evidence, and run the recommended recovery command after provider and checkpoint health are restored."
      : degradedRetryAllowed
        ? "Retry the command in degraded mode while keeping audit handoff pending and monitoring provider readiness."
        : retry.retryable
          ? "Wait until retryAfterAt before replaying the rollback command with the same idempotency key."
          : "Continue normal rollback monitoring."
  };
}

function hoursBetween(startIso, endIso) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return Math.max(0, Math.round(((endMs - startMs) / 36_000) / 10));
}

function expiresAtForCheckpoint(checkpoint, maxRollbackAgeHours) {
  const createdAtMs = new Date(checkpoint.createdAt).getTime();
  if (Number.isNaN(createdAtMs)) return null;
  return new Date(createdAtMs + maxRollbackAgeHours * 60 * 60 * 1000).toISOString();
}

function deriveCheckpointSafetyWindow(state, now) {
  const settings = state.lifecycleSettings || normalizeLifecycleSettings({}, now);
  const selectedCheckpoint = state.rollbackCursor >= 0 ? state.checkpoints[state.rollbackCursor] : null;
  const maxRollbackAgeHours = settings.maxRollbackAgeHours;
  const findings = state.checkpoints.map((checkpoint, index) => {
    const ageHours = hoursBetween(checkpoint.createdAt, now);
    const expiresAt = expiresAtForCheckpoint(checkpoint, maxRollbackAgeHours);
    const expired = typeof ageHours === "number" && ageHours > maxRollbackAgeHours;
    const planScoped = checkpoint.tenantId === state.tenantId && checkpoint.workspaceId === state.workspaceId;
    return {
      index,
      checkpointId: checkpoint.checkpointId,
      stateRef: checkpoint.stateRef,
      tenantId: checkpoint.tenantId,
      workspaceId: checkpoint.workspaceId,
      selected: index === state.rollbackCursor,
      verified: checkpoint.verified === true,
      reversible: checkpoint.reversible !== false,
      planScoped,
      createdAt: checkpoint.createdAt,
      ageHours,
      expiresAt,
      expired,
      eligible: checkpoint.reversible !== false
        && !expired
        && planScoped
        && (checkpoint.verified === true || settings.requireVerifiedCheckpoint !== true)
    };
  });
  const selectedFinding = selectedCheckpoint
    ? findings.find((finding) => finding.index === state.rollbackCursor) || null
    : null;
  const blockingReasons = [];

  if (!selectedCheckpoint) blockingReasons.push("checkpoint_required");
  if (selectedFinding && selectedFinding.reversible !== true) blockingReasons.push("checkpoint_not_reversible");
  if (selectedFinding && selectedFinding.expired) blockingReasons.push("checkpoint_safety_window_expired");
  if (selectedFinding && selectedFinding.planScoped !== true) blockingReasons.push("checkpoint_scope_mismatch");
  if (selectedFinding && settings.requireVerifiedCheckpoint === true && selectedFinding.verified !== true) {
    blockingReasons.push("checkpoint_verification_required");
  }

  return {
    contractType: "rollback-plan.checkpoint-safety-window.v1",
    evaluatedAt: now,
    maxRollbackAgeHours,
    requireVerifiedCheckpoint: settings.requireVerifiedCheckpoint === true,
    selectedCheckpointId: selectedCheckpoint?.checkpointId || null,
    selectedCheckpointIndex: state.rollbackCursor,
    selectedCheckpointAgeHours: selectedFinding?.ageHours ?? null,
    selectedCheckpointExpiresAt: selectedFinding?.expiresAt || null,
    selectedCheckpointExpired: selectedFinding?.expired === true,
    selectedCheckpointVerified: selectedFinding?.verified === true,
    selectedCheckpointReversible: selectedFinding?.reversible === true,
    selectedCheckpointPlanScoped: selectedFinding?.planScoped !== false,
    eligible: blockingReasons.length === 0,
    blockingReasons,
    eligibleCheckpointIds: findings.filter((finding) => finding.eligible).map((finding) => finding.checkpointId),
    expiredCheckpointIds: findings.filter((finding) => finding.expired).map((finding) => finding.checkpointId),
    findings
  };
}

function deriveOperationalHealth({ state, commandResult, restartSafeStatus, auditHandoff, integrationHealth, providerNegotiation, providerReadiness, retryPolicy, failurePolicy, checkpointSafety, now }) {
  const errors = [];
  const warnings = [];
  const latestCheckpoint = state.rollbackCursor >= 0 ? state.checkpoints[state.rollbackCursor] : null;

  if (commandResult.rejected) {
    const lifecycleViolations = commandResult.lifecycleValidation?.violations || [];
    const boundaryViolations = commandResult.boundary?.violations || [];
    const payloadScopeViolations = commandResult.payloadScope?.violations || [];
    const rejectedByLifecycle = commandResult.rejectionKind === "lifecycle";
    const rejectedByPayloadScope = commandResult.rejectionKind === "payload_scope";
    const rejectedByIdempotency = commandResult.rejectionKind === "idempotency_conflict";
    errors.push(
      buildActionableError(
        "rollback_plan.command_rejected",
        rejectedByLifecycle
          ? "Rollback command was rejected by lifecycle settings validation."
          : rejectedByPayloadScope
            ? "Rollback command payload referenced resources outside the hosted-kernel scope."
            : rejectedByIdempotency
              ? "Rollback command reused an idempotency key for a different persisted operation."
              : "Rollback command was rejected by workspace or role boundary validation.",
        rejectedByLifecycle
          ? "Enable the plan, fix lifecycle settings, verify checkpoint state, or wait until the schedule is due before retrying."
          : rejectedByPayloadScope
            ? "Use checkpoint and handoff references that belong to the active tenant and workspace before retrying."
            : rejectedByIdempotency
              ? "Retry with the original command payload for replay, or allocate a new commandId and idempotencyKey for a distinct rollback operation."
              : "Fix actor credentials, tenant/workspace scope, or delegated permissions before retrying.",
        {
          retryable: rejectedByLifecycle || rejectedByIdempotency,
          severity: "error",
          details: {
            violations: rejectedByLifecycle
              ? lifecycleViolations
              : rejectedByPayloadScope
                ? payloadScopeViolations
                : rejectedByIdempotency
                  ? commandResult.idempotencyDecision?.conflictReasons || []
                  : boundaryViolations
          }
        }
      )
    );
  }

  if ((state.status === "prepared" || state.status === "executing" || state.status === "recovering") && !latestCheckpoint) {
    errors.push(
      buildActionableError(
        "rollback_plan.checkpoint_missing",
        "Rollback cannot continue because no checkpoint is bound to the active cursor.",
        "Record or restore a verified checkpoint before executing recovery.",
        { retryable: false, severity: "critical", details: { rollbackCursor: state.rollbackCursor } }
      )
    );
  } else if (latestCheckpoint && latestCheckpoint.verified !== true) {
    warnings.push(
      buildActionableError(
        "rollback_plan.checkpoint_unverified",
        "The selected rollback checkpoint has not been verified.",
        "Verify checkpoint integrity before marking recovery complete.",
        { retryable: true, severity: "warning", details: { checkpointId: latestCheckpoint.checkpointId } }
      )
    );
  }

  if (checkpointSafety && checkpointSafety.eligible !== true && CHECKPOINT_SAFETY_COMMANDS.has(commandResult.command)) {
    errors.push(
      buildActionableError(
        "rollback_plan.checkpoint_safety_window_blocked",
        "The selected rollback checkpoint is not eligible for hosted-kernel recovery.",
        "Select a reversible, in-scope checkpoint inside the configured rollback age window, then retry the rollback command.",
        {
          retryable: true,
          severity: "critical",
          details: {
            selectedCheckpointId: checkpointSafety.selectedCheckpointId,
            maxRollbackAgeHours: checkpointSafety.maxRollbackAgeHours,
            expiresAt: checkpointSafety.selectedCheckpointExpiresAt,
            blockingReasons: checkpointSafety.blockingReasons
          }
        }
      )
    );
  } else if (checkpointSafety?.selectedCheckpointExpired === true) {
    warnings.push(
      buildActionableError(
        "rollback_plan.checkpoint_safety_window_expired",
        "The selected checkpoint is older than the configured rollback safety window.",
        "Record a fresh checkpoint or increase maxRollbackAgeHours before executing rollback.",
        {
          retryable: true,
          severity: "warning",
          details: {
            selectedCheckpointId: checkpointSafety.selectedCheckpointId,
            maxRollbackAgeHours: checkpointSafety.maxRollbackAgeHours,
            ageHours: checkpointSafety.selectedCheckpointAgeHours
          }
        }
      )
    );
  }

  if (auditHandoff.required && !integrationHealth.auditHandoffAvailable) {
    errors.push(
      buildActionableError(
        "rollback_plan.audit_handoff_unavailable",
        "Audit handoff is required but the audit integration is unavailable.",
        "Keep the plan in degraded mode and retry audit handoff before completing rollback.",
        { retryable: true, severity: "error", details: { target: auditHandoff.target } }
      )
    );
  }

  if (providerNegotiation.missingCapabilities.length > 0 || providerNegotiation.offlineServices.length > 0) {
    errors.push(
      buildActionableError(
        "rollback_plan.provider_capability_gap",
        "Provider contracts do not satisfy the rollback command capability requirements.",
        "Negotiate a provider with the missing capabilities or route the command to a healthy recovery service before retrying.",
        {
          retryable: true,
          severity: MUTATING_RECOVERY_COMMANDS.has(commandResult.command) ? "critical" : "error",
          details: {
            command: providerNegotiation.command,
            missingCapabilities: providerNegotiation.missingCapabilities,
            offlineServices: providerNegotiation.offlineServices
          }
        }
      )
    );
  }

  if (providerReadiness.state === "blocked") {
    errors.push(
      buildActionableError(
        "rollback_plan.provider_operational_blocked",
        "Required hosted-kernel providers are not operational for this rollback command.",
        providerReadiness.action,
        {
          retryable: providerReadiness.retryable,
          severity: MUTATING_RECOVERY_COMMANDS.has(commandResult.command) ? "critical" : "error",
          details: {
            command: providerReadiness.command,
            blockingServices: providerReadiness.blockingServices,
            handoffBlocked: providerReadiness.handoffBlocked,
            findings: providerReadiness.findings
              .filter((finding) => finding.blockingReasons.length > 0)
              .map((finding) => ({
                serviceName: finding.serviceName,
                providerId: finding.providerId,
                blockingReasons: finding.blockingReasons,
                missingCapabilities: finding.missingCapabilities,
                leaseExpiresAt: finding.sync.leaseExpiresAt
              }))
          }
        }
      )
    );
  } else if (providerReadiness.state === "degraded") {
    warnings.push(
      buildActionableError(
        "rollback_plan.provider_operational_degraded",
        "Required hosted-kernel providers are available but reporting degraded operational state.",
        providerReadiness.action,
        {
          retryable: providerReadiness.retryable,
          severity: "warning",
          details: {
            command: providerReadiness.command,
            degradedServices: providerReadiness.degradedServices,
            runnableInDegradedMode: providerReadiness.runnableInDegradedMode,
            findings: providerReadiness.findings
              .filter((finding) => finding.warningReasons.length > 0)
              .map((finding) => ({
                serviceName: finding.serviceName,
                providerId: finding.providerId,
                warningReasons: finding.warningReasons,
                dirty: finding.sync.dirty,
                pendingPush: finding.sync.pendingPush
              }))
          }
        }
      )
    );
  }

  if (auditHandoff.required && providerNegotiation.externalHandoffState === "blocked") {
    errors.push(
      buildActionableError(
        "rollback_plan.external_handoff_blocked",
        "External handoff is required but no sync coordinator can claim the handoff.",
        "Restore the sync coordinator or provide a handoff-capable provider contract before completing rollback.",
        { retryable: true, severity: "error", details: { target: auditHandoff.target } }
      )
    );
  }

  if (providerNegotiation.externalHandoffFailedCount > 0) {
    errors.push(
      buildActionableError(
        "rollback_plan.external_handoff_failed",
        "One or more external handoff items failed delivery.",
        "Inspect the failed handoff item, restore sync delivery, and retry the external handoff before completing rollback.",
        {
          retryable: true,
          severity: "error",
          details: {
            failedCount: providerNegotiation.externalHandoffFailedCount,
            pendingCount: providerNegotiation.externalHandoffPendingCount
          }
        }
      )
    );
  } else if (providerNegotiation.externalHandoffPendingCount > 0) {
    warnings.push(
      buildActionableError(
        "rollback_plan.external_handoff_pending",
        "External handoff items are waiting to be claimed or delivered.",
        "Keep the rollback plan in guarded mode until pending handoff work is claimed by the sync coordinator.",
        {
          retryable: true,
          severity: "warning",
          details: {
            pendingCount: providerNegotiation.externalHandoffPendingCount,
            claimable: providerNegotiation.externalHandoffClaimable
          }
        }
      )
    );
  }

  if (!integrationHealth.checkpointStoreAvailable) {
    errors.push(
      buildActionableError(
        "rollback_plan.checkpoint_store_unavailable",
        "Checkpoint storage is unavailable for rollback recovery.",
        "Pause execution until checkpoint storage is reachable or escalate for manual recovery.",
        { retryable: true, severity: "critical" }
      )
    );
  }

  if (!integrationHealth.recoveryExecutorAvailable && ["executing", "recovering", "needs_recovery"].includes(state.status)) {
    errors.push(
      buildActionableError(
        "rollback_plan.recovery_executor_unavailable",
        "Recovery executor is unavailable while the plan requires recovery work.",
        "Retry after executor health is restored; do not mark recovery complete.",
        { retryable: true, severity: "critical" }
      )
    );
  }

  if (state.lastError) {
    errors.push(
      buildActionableError(
        "rollback_plan.last_failure_state",
        "Persisted rollback plan contains a failure state.",
        "Inspect the stored failure reason and run recover with a verified checkpoint.",
        { retryable: state.rollbackCursor >= 0, severity: "error", details: { reason: state.lastError } }
      )
    );
  }

  if (state.lifecycleSettings.validationErrors.length > 0) {
    errors.push(
      buildActionableError(
        "rollback_plan.lifecycle_settings_invalid",
        "Lifecycle settings contain validation errors.",
        "Update lifecycle settings before preparing or executing rollback.",
        { retryable: true, severity: "error", details: { validationErrors: state.lifecycleSettings.validationErrors } }
      )
    );
  }

  if (!state.lifecycleSettings.enabled) {
    warnings.push(
      buildActionableError(
        "rollback_plan.lifecycle_disabled",
        "Rollback lifecycle controls are disabled.",
        "Enable the rollback plan before running mutating recovery commands.",
        { retryable: true, severity: "warning" }
      )
    );
  }

  if (state.lifecycleSettings.schedule.enabled && state.lifecycleSettings.schedule.nextRunAt) {
    warnings.push(
      buildActionableError(
        "rollback_plan.scheduled_execution_pending",
        "Rollback execution is scheduled and may not be due yet.",
        "Wait until the scheduled nextRunAt time or update the schedule.",
        { retryable: true, severity: "warning", details: { nextRunAt: state.lifecycleSettings.schedule.nextRunAt } }
      )
    );
  }

  if (integrationHealth.degradedReason) warnings.push(buildActionableError(
    "rollback_plan.integration_degraded",
    "One or more rollback integrations reported degraded service.",
    "Continue only with recovery-safe commands and preserve audit evidence.",
    { retryable: true, severity: "warning", details: { reason: integrationHealth.degradedReason } }
  ));

  let failureState = deriveFailureStateEnvelope({
    state,
    commandResult,
    providerReadiness,
    failurePolicy,
    retryPolicy,
    errors,
    warnings,
    now
  });

  if (failureState.state === "escalated") {
    errors.push(
      buildActionableError(
        "rollback_plan.failure_state_escalated",
        "Rollback failure policy requires operator escalation before automatic recovery can continue.",
        failureState.operatorAction,
        {
          retryable: false,
          severity: "critical",
          details: {
            strategy: failureState.strategy,
            escalationReasons: failureState.escalationReasons,
            latestAttemptId: failureState.latestAttemptId,
            latestAttemptAgeMinutes: failureState.latestAttemptAgeMinutes,
            nextCommand: failureState.nextCommand
          }
        }
      )
    );
    failureState = {
      ...failureState,
      activeErrorCodes: [...failureState.activeErrorCodes, "rollback_plan.failure_state_escalated"],
      criticalErrorCodes: [...failureState.criticalErrorCodes, "rollback_plan.failure_state_escalated"]
    };
  } else if (failureState.state === "degraded_retry") {
    warnings.push(
      buildActionableError(
        "rollback_plan.failure_state_degraded_retry",
        "Failure policy allows a guarded degraded-mode retry for this rollback command.",
        failureState.operatorAction,
        {
          retryable: true,
          severity: "warning",
          details: {
            retryAfterAt: failureState.retryAfterAt,
            retryDelayMs: failureState.retryDelayMs,
            nextCommand: failureState.nextCommand
          }
        }
      )
    );
    failureState = {
      ...failureState,
      activeWarningCodes: [...failureState.activeWarningCodes, "rollback_plan.failure_state_degraded_retry"]
    };
  }

  const retryable = [...errors, ...warnings].some((entry) => entry.retryable);
  const retry = deriveRetryBackoff(retryPolicy, now, retryable);
  const degraded = errors.length > 0 || warnings.length > 0 || restartSafeStatus.status === "needs_recovery";

  return {
    state: errors.length > 0 ? "unhealthy" : warnings.length > 0 || degraded ? "degraded" : "healthy",
    degraded,
    mode: degraded ? "guarded_recovery" : "normal",
    canExecute: errors.length === 0 && state.status !== "failed" && state.lifecycleSettings.enabled && checkpointSafety?.eligible !== false,
    canMarkRecovered: errors.length === 0 && state.lifecycleSettings.enabled && latestCheckpoint?.verified === true && checkpointSafety?.eligible !== false,
    errors,
    warnings,
    retry,
    failureState,
    nextAction: errors[0]?.action || warnings[0]?.action || restartSafeStatus.recoveryAction
  };
}

function deriveScheduleControlState(settings, now) {
  const nextRunAtMs = settings.schedule.nextRunAt ? new Date(settings.schedule.nextRunAt).getTime() : null;
  const nowMs = new Date(now).getTime();
  const due = settings.schedule.enabled
    && typeof nextRunAtMs === "number"
    && !Number.isNaN(nextRunAtMs)
    && !Number.isNaN(nowMs)
    && nowMs >= nextRunAtMs;
  const scheduled = settings.schedule.enabled && Boolean(settings.schedule.nextRunAt);
  const blockedReasons = [];

  if (settings.schedule.validationErrors?.length > 0) blockedReasons.push(...settings.schedule.validationErrors);
  if (settings.validationErrors.includes("schedule_enabled_requires_non_manual_cadence")) {
    blockedReasons.push("schedule_enabled_requires_non_manual_cadence");
  }
  if (settings.validationErrors.includes("schedule_next_run_at_required")) {
    blockedReasons.push("schedule_next_run_at_required");
  }
  if (settings.validationErrors.includes("schedule_next_run_at_must_be_future")) {
    blockedReasons.push("schedule_next_run_at_must_be_future");
  }
  if (settings.schedule.enabled && settings.schedule.nextRunAt && !due) blockedReasons.push("scheduled_execution_not_due");

  return {
    contractType: "rollback-plan.schedule-control-state.v1",
    ...settings.schedule,
    scheduled,
    due,
    overdue: due,
    now,
    blockedReasons: [...new Set(blockedReasons)]
  };
}

function lifecycleCommandBlockedReasons(command, { state, settings, operationalHealth, checkpointSafety, scheduleControl }) {
  const reasons = [];
  const terminal = TERMINAL_STATUSES.has(state.status);
  const selectedCheckpoint = state.rollbackCursor >= 0 ? state.checkpoints[state.rollbackCursor] : null;
  const settingsInvalid = settings.validationErrors.length > 0;
  const operationalBlocked = operationalHealth.errors.length > 0;

  if (command === "enable" && settings.enabled) reasons.push("rollback_plan_already_enabled");
  if (command === "disable" && (!settings.enabled || terminal)) {
    if (!settings.enabled) reasons.push("rollback_plan_already_disabled");
    if (terminal) reasons.push("terminal_state_cannot_disable");
  }
  if (command === "schedule") {
    if (!settings.enabled) reasons.push("rollback_plan_disabled");
    if (settingsInvalid) reasons.push("lifecycle_settings_invalid");
  }
  if (["checkpoint", "prepare", "execute", "recover", "mark_recovered"].includes(command) && !settings.enabled) {
    reasons.push("rollback_plan_disabled");
  }
  if (["prepare", "execute", "recover", "mark_recovered"].includes(command) && !selectedCheckpoint) {
    reasons.push("checkpoint_required");
  }
  if (["prepare", "execute", "recover"].includes(command) && settingsInvalid) {
    reasons.push("lifecycle_settings_invalid");
  }
  if (["prepare", "execute", "recover", "mark_recovered"].includes(command) && checkpointSafety.eligible !== true) {
    reasons.push(...checkpointSafety.blockingReasons);
  }
  if (command === "execute" && scheduleControl.enabled && !scheduleControl.due) {
    reasons.push("scheduled_execution_not_due");
  }
  if (command === "execute" && operationalBlocked) reasons.push("operational_health_blocked");
  if (command === "mark_recovered") {
    if (operationalBlocked) reasons.push("operational_health_blocked");
    if (selectedCheckpoint?.verified !== true) reasons.push("verified_checkpoint_required");
    if (!["recovering", "executing", "needs_recovery"].includes(state.status)) reasons.push("recovery_not_active");
  }

  return [...new Set(reasons)];
}

function deriveLifecycleCommandMatrix({ state, operationalHealth, checkpointSafety, scheduleControl }) {
  const settings = state.lifecycleSettings;
  return Object.fromEntries(LIFECYCLE_OPERATOR_COMMANDS.map((command) => {
    const blockedReasons = lifecycleCommandBlockedReasons(command, {
      state,
      settings,
      operationalHealth,
      checkpointSafety,
      scheduleControl
    });
    return [command, {
      command,
      enabled: blockedReasons.length === 0,
      blockedReasons,
      destructive: ["execute", "recover", "mark_recovered", "disable"].includes(command),
      requiresCheckpoint: ["prepare", "execute", "recover", "mark_recovered"].includes(command),
      requiresScheduleDue: command === "execute" && scheduleControl.enabled,
      requiresOperatorApproval: settings.requireOperatorApproval === true && ["execute", "recover", "mark_recovered"].includes(command)
    }];
  }));
}

function deriveLifecycleControls({ state, operationalHealth, checkpointSafety, now }) {
  const settings = state.lifecycleSettings;
  const scheduleControl = deriveScheduleControlState(settings, now);
  const commandMatrix = deriveLifecycleCommandMatrix({
    state,
    operationalHealth,
    checkpointSafety,
    scheduleControl
  });
  const nextAction = deriveLifecycleNextAction(state, operationalHealth, checkpointSafety);
  const nextCommand = LIFECYCLE_NEXT_ACTION_COMMANDS[nextAction] || "shape";
  const nextCommandAvailability = commandMatrix[nextCommand] || {
    command: nextCommand,
    enabled: nextCommand === "shape",
    blockedReasons: [],
    destructive: false,
    requiresCheckpoint: false,
    requiresScheduleDue: false,
    requiresOperatorApproval: false
  };

  return {
    contractType: "rollback-plan.lifecycle-controls.v1",
    enabled: settings.enabled,
    settingsValid: settings.validationErrors.length === 0,
    validationErrors: settings.validationErrors,
    schedule: scheduleControl,
    commandAvailability: {
      canEnable: commandMatrix.enable.enabled,
      canDisable: commandMatrix.disable.enabled,
      canUpdateSettings: commandMatrix.update_settings.enabled,
      canSchedule: commandMatrix.schedule.enabled,
      canCheckpoint: commandMatrix.checkpoint.enabled,
      canPrepare: commandMatrix.prepare.enabled,
      canExecute: commandMatrix.execute.enabled,
      canRecover: commandMatrix.recover.enabled,
      canMarkRecovered: commandMatrix.mark_recovered.enabled
    },
    commandMatrix,
    nextAction,
    nextCommand,
    nextCommandReady: nextCommandAvailability.enabled,
    nextCommandBlockedReasons: nextCommandAvailability.blockedReasons,
    operatorApprovalRequired: nextCommandAvailability.requiresOperatorApproval,
    controlState: !settings.enabled
      ? "disabled"
      : settings.validationErrors.length > 0
        ? "invalid"
        : operationalHealth.errors.length > 0
          ? "blocked"
          : scheduleControl.enabled && !scheduleControl.due && state.status === "prepared"
            ? "scheduled"
            : "ready"
  };
}

function deriveRestartSafeStatus(state) {
  const pendingOperation = state.recoveryJournal?.pendingOperation || null;
  const pendingCheckpointId = pendingOperation?.checkpointId || state.checkpoints[state.rollbackCursor]?.checkpointId || null;

  if (state.status === "executing") {
    return {
      status: "needs_recovery",
      reason: pendingOperation ? "execution_pending_operation_after_restart" : "execution_was_interrupted",
      recoveryAction: state.rollbackCursor >= 0 ? "resume_from_checkpoint" : "manual_review_required",
      pendingOperation,
      checkpointId: pendingCheckpointId
    };
  }
  if (state.status === "recovering") {
    return {
      status: "needs_recovery",
      reason: pendingOperation ? "recovery_pending_operation_after_restart" : "recovery_was_interrupted",
      recoveryAction: state.rollbackCursor >= 0 ? "continue_recovery" : "manual_review_required",
      pendingOperation,
      checkpointId: pendingCheckpointId
    };
  }
  if (state.status === "needs_recovery" && pendingOperation) {
    return {
      status: "needs_recovery",
      reason: "pending_operation_requires_reconciliation",
      recoveryAction: state.rollbackCursor >= 0 ? "reconcile_pending_operation" : "manual_review_required",
      pendingOperation,
      checkpointId: pendingCheckpointId
    };
  }
  return {
    status: state.status,
    reason: TERMINAL_STATUSES.has(state.status) ? "terminal_state" : "stable_active_state",
    recoveryAction: state.status === "needs_recovery" ? "inspect_last_command" : "none",
    pendingOperation: null,
    checkpointId: pendingCheckpointId
  };
}

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = asNonEmptyString(keyFn(value), null);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function millisecondsBetween(startIso, endIso) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  return endMs - startMs;
}

function deriveCommandTransitionReport(state, commandResult, now) {
  const orderedCommands = [...state.commandLog].sort((left, right) => {
    const leftMs = new Date(left.appliedAt).getTime();
    const rightMs = new Date(right.appliedAt).getTime();
    return (Number.isNaN(leftMs) ? 0 : leftMs) - (Number.isNaN(rightMs) ? 0 : rightMs);
  });
  const transitions = [];

  for (let index = 1; index < orderedCommands.length; index += 1) {
    const previous = orderedCommands[index - 1];
    const current = orderedCommands[index];
    transitions.push({
      fromCommand: previous.command,
      toCommand: current.command,
      fromStatus: previous.statusAfter,
      toStatus: current.statusAfter,
      elapsedMs: millisecondsBetween(previous.appliedAt, current.appliedAt),
      recoveryPending: current.recoveryPending === true
    });
  }

  const transitionElapsedMs = transitions
    .map((transition) => transition.elapsedMs)
    .filter((elapsedMs) => typeof elapsedMs === "number");
  const latestCommand = orderedCommands[orderedCommands.length - 1] || null;
  const latestCommandAgeMs = latestCommand ? millisecondsBetween(latestCommand.appliedAt, now) : null;

  return {
    contractType: "rollback-plan.command-transition-report.v1",
    generatedAt: now,
    commandCount: orderedCommands.length,
    transitionCount: transitions.length,
    commandStatusCounts: countBy(orderedCommands, (entry) => entry.statusAfter || "unknown"),
    transitionCounts: countBy(transitions, (transition) => `${transition.fromCommand}->${transition.toCommand}`),
    recoveryPendingTransitionCount: transitions.filter((transition) => transition.recoveryPending).length,
    averageTransitionElapsedMs: transitionElapsedMs.length > 0
      ? Math.round(transitionElapsedMs.reduce((total, elapsedMs) => total + elapsedMs, 0) / transitionElapsedMs.length)
      : null,
    latestCommandId: latestCommand?.commandId || null,
    latestCommandName: latestCommand?.command || null,
    latestCommandAgeMs,
    latestCommandAccepted: commandResult.rejected !== true,
    latestCommandRejected: commandResult.rejected === true,
    latestCommandIdempotent: commandResult.idempotent === true,
    recentTransitions: transitions.slice(-6)
  };
}

function deriveHistoryTrendReport(historySnapshots, now) {
  const orderedSnapshots = [...historySnapshots].sort((left, right) => {
    const leftMs = new Date(left.capturedAt).getTime();
    const rightMs = new Date(right.capturedAt).getTime();
    return (Number.isNaN(leftMs) ? 0 : leftMs) - (Number.isNaN(rightMs) ? 0 : rightMs);
  });
  const latest = orderedSnapshots[orderedSnapshots.length - 1] || null;
  const previous = orderedSnapshots.length > 1 ? orderedSnapshots[orderedSnapshots.length - 2] : null;
  const first = orderedSnapshots[0] || null;
  const deltaFromPrevious = latest && previous
    ? {
        generations: latest.generation - previous.generation,
        checkpoints: latest.checkpointCount - previous.checkpointCount,
        verifiedCheckpoints: latest.verifiedCheckpointCount - previous.verifiedCheckpointCount,
        commands: latest.commandCount - previous.commandCount,
        auditEvents: latest.auditEventCount - previous.auditEventCount,
        healthChanged: latest.healthState !== previous.healthState,
        statusChanged: latest.status !== previous.status,
        recoveryStatusChanged: latest.recoveryStatus !== previous.recoveryStatus
      }
    : null;

  return {
    contractType: "rollback-plan.history-trend-report.v1",
    generatedAt: now,
    snapshotCount: orderedSnapshots.length,
    firstSnapshotId: first?.snapshotId || null,
    latestSnapshotId: latest?.snapshotId || null,
    firstCapturedAt: first?.capturedAt || null,
    latestCapturedAt: latest?.capturedAt || null,
    latestHealthState: latest?.healthState || null,
    latestRecoveryStatus: latest?.recoveryStatus || null,
    statusCounts: countBy(orderedSnapshots, (snapshot) => snapshot.status),
    healthStateCounts: countBy(orderedSnapshots, (snapshot) => snapshot.healthState),
    recoveryStatusCounts: countBy(orderedSnapshots, (snapshot) => snapshot.recoveryStatus),
    deltaFromPrevious,
    elapsedMsSinceLatestSnapshot: latest ? millisecondsBetween(latest.capturedAt, now) : null
  };
}

function deriveTimelineReportState(timeline, restartSafeStatus, operationalHealth) {
  const eventTypeCounts = countBy(timeline, (event) => event.type);
  const eventFamilyCounts = countBy(timeline, (event) => event.type?.split(".")[0]);
  const latestEvent = timeline[timeline.length - 1] || null;
  const commandEvents = timeline.filter((event) => event.type?.startsWith("command."));
  const auditEvents = timeline.filter((event) => event.type?.startsWith("audit."));
  const checkpointEvents = timeline.filter((event) => event.type?.startsWith("checkpoint."));

  return {
    contractType: "rollback-plan.timeline-report-state.v1",
    eventCount: timeline.length,
    commandEventCount: commandEvents.length,
    auditEventCount: auditEvents.length,
    checkpointEventCount: checkpointEvents.length,
    historyEventCount: timeline.filter((event) => event.type === "history.snapshot").length,
    eventTypeCounts,
    eventFamilyCounts,
    latestEventType: latestEvent?.type || null,
    latestEventAt: latestEvent?.at || null,
    recoveryRequired: restartSafeStatus.status === "needs_recovery",
    healthState: operationalHealth.state,
    reportable: timeline.length > 0,
    timelineTruncated: timeline.length >= MAX_TIMELINE_EVENTS
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function fingerprintReportValue(value) {
  const source = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function makeExportDatasetDescriptor({ datasetId, schemaVersion, rows, required = true, blockedReasons = [] }) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const ready = normalizedRows.length > 0 && blockedReasons.length === 0;
  return {
    datasetId,
    schemaVersion,
    required,
    ready: required ? ready : blockedReasons.length === 0,
    recordCount: normalizedRows.length,
    exportFormats: ["jsonl", "csv"],
    contentFingerprint: fingerprintReportValue(normalizedRows),
    blockedReasons,
    previewRows: normalizedRows.slice(0, 3)
  };
}

function deriveReportingRetentionState({ historySnapshots, timeline, commandLog, now }) {
  const oldestHistory = historySnapshots[0] || null;
  const newestHistory = historySnapshots[historySnapshots.length - 1] || null;
  const oldestTimeline = timeline[0] || null;
  const newestTimeline = timeline[timeline.length - 1] || null;
  return {
    contractType: "rollback-plan.reporting-retention-state.v1",
    evaluatedAt: now,
    history: {
      retainedCount: historySnapshots.length,
      maxRetained: MAX_HISTORY_SNAPSHOTS,
      truncated: historySnapshots.length >= MAX_HISTORY_SNAPSHOTS,
      oldestCapturedAt: oldestHistory?.capturedAt || null,
      newestCapturedAt: newestHistory?.capturedAt || null
    },
    timeline: {
      retainedCount: timeline.length,
      maxRetained: MAX_TIMELINE_EVENTS,
      truncated: timeline.length >= MAX_TIMELINE_EVENTS,
      oldestEventAt: oldestTimeline?.at || null,
      newestEventAt: newestTimeline?.at || null
    },
    commands: {
      retainedCount: commandLog.length,
      oldestAppliedAt: commandLog[0]?.appliedAt || null,
      newestAppliedAt: commandLog[commandLog.length - 1]?.appliedAt || null
    },
    exportWarningCodes: [
      ...(historySnapshots.length >= MAX_HISTORY_SNAPSHOTS ? ["history_retention_limit_reached"] : []),
      ...(timeline.length >= MAX_TIMELINE_EVENTS ? ["timeline_retention_limit_reached"] : [])
    ]
  };
}

function deriveReportDatasetCatalog({
  state,
  analytics,
  historySnapshots,
  timeline,
  commandTransitionReport,
  idempotencyLedgerReport,
  operationalHealth,
  providerReadiness,
  reportingRetentionState,
  now
}) {
  const commandRows = state.commandLog.map((entry) => ({
    commandId: entry.commandId,
    command: entry.command,
    generation: entry.generation,
    statusAfter: entry.statusAfter,
    appliedAt: entry.appliedAt,
    recoveryPending: entry.recoveryPending,
    actorRole: entry.actorRole,
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId
  }));
  const checkpointRows = state.checkpoints.map((checkpoint, index) => ({
    index,
    checkpointId: checkpoint.checkpointId,
    label: checkpoint.label,
    stateRef: checkpoint.stateRef,
    createdAt: checkpoint.createdAt,
    verified: checkpoint.verified,
    reversible: checkpoint.reversible,
    selected: index === state.rollbackCursor,
    tenantId: checkpoint.tenantId,
    workspaceId: checkpoint.workspaceId
  }));
  const healthRows = [
    ...operationalHealth.errors.map((entry) => ({
      level: "error",
      code: entry.code,
      severity: entry.severity,
      retryable: entry.retryable,
      action: entry.action
    })),
    ...operationalHealth.warnings.map((entry) => ({
      level: "warning",
      code: entry.code,
      severity: entry.severity,
      retryable: entry.retryable,
      action: entry.action
    }))
  ];
  const providerRows = providerReadiness.findings.map((finding) => ({
    serviceName: finding.serviceName,
    providerId: finding.providerId,
    status: finding.status,
    ready: finding.ready,
    degraded: finding.degraded,
    blockingReasons: finding.blockingReasons,
    warningReasons: finding.warningReasons,
    missingCapabilities: finding.missingCapabilities
  }));
  const datasets = [
    makeExportDatasetDescriptor({
      datasetId: "analytics.summary",
      schemaVersion: "rollback-plan.analytics-summary-row.v1",
      rows: [{
        planId: state.planId,
        generation: state.generation,
        status: state.status,
        healthState: operationalHealth.state,
        commandsTotal: analytics.commandsTotal,
        checkpointsTotal: analytics.checkpointsTotal,
        verifiedCheckpoints: analytics.verifiedCheckpoints,
        activeErrors: analytics.activeErrors,
        activeWarnings: analytics.activeWarnings
      }]
    }),
    makeExportDatasetDescriptor({
      datasetId: "history.snapshots",
      schemaVersion: "rollback-plan.history-snapshot.v1",
      rows: historySnapshots,
      blockedReasons: historySnapshots.length === 0 ? ["history_snapshot_required"] : []
    }),
    makeExportDatasetDescriptor({
      datasetId: "timeline.events",
      schemaVersion: "rollback-plan.timeline-event.v1",
      rows: timeline,
      blockedReasons: timeline.length === 0 ? ["timeline_event_required"] : []
    }),
    makeExportDatasetDescriptor({
      datasetId: "commands.log",
      schemaVersion: "rollback-plan.command-log-row.v1",
      rows: commandRows,
      blockedReasons: commandRows.length === 0 ? ["command_log_empty"] : []
    }),
    makeExportDatasetDescriptor({
      datasetId: "checkpoints.inventory",
      schemaVersion: "rollback-plan.checkpoint-inventory-row.v1",
      rows: checkpointRows,
      required: false
    }),
    makeExportDatasetDescriptor({
      datasetId: "health.findings",
      schemaVersion: "rollback-plan.health-finding-row.v1",
      rows: healthRows,
      required: false
    }),
    makeExportDatasetDescriptor({
      datasetId: "health.failure_state",
      schemaVersion: "rollback-plan.failure-state.v1",
      rows: [{
        state: operationalHealth.failureState.state,
        strategy: operationalHealth.failureState.strategy,
        retryable: operationalHealth.failureState.retryable,
        retryBudgetExhausted: operationalHealth.failureState.retryBudgetExhausted,
        consecutiveFailureLimitReached: operationalHealth.failureState.consecutiveFailureLimitReached,
        stalePendingOperation: operationalHealth.failureState.stalePendingOperation,
        degradedRetryAllowed: operationalHealth.failureState.degradedRetryAllowed,
        escalationReasons: operationalHealth.failureState.escalationReasons,
        retryAfterAt: operationalHealth.failureState.retryAfterAt,
        nextCommand: operationalHealth.failureState.nextCommand,
        operatorAction: operationalHealth.failureState.operatorAction
      }],
      required: false
    }),
    makeExportDatasetDescriptor({
      datasetId: "providers.readiness",
      schemaVersion: "rollback-plan.provider-readiness-row.v1",
      rows: providerRows
    }),
    makeExportDatasetDescriptor({
      datasetId: "idempotency.ledger",
      schemaVersion: "rollback-plan.idempotency-ledger-row.v1",
      rows: [
        ...idempotencyLedgerReport.pendingEntries.map((entry) => ({ state: "pending", ...entry })),
        ...idempotencyLedgerReport.replayedEntries.map((entry) => ({ state: "replayed", ...entry }))
      ],
      required: false
    })
  ];
  const requiredDatasets = datasets.filter((dataset) => dataset.required);
  const blockedDatasets = datasets.filter((dataset) => !dataset.ready);

  return {
    contractType: "rollback-plan.report-dataset-catalog.v1",
    generatedAt: now,
    datasetCount: datasets.length,
    requiredDatasetCount: requiredDatasets.length,
    readyDatasetCount: datasets.filter((dataset) => dataset.ready).length,
    blockedDatasetIds: blockedDatasets.map((dataset) => dataset.datasetId),
    catalogFingerprint: fingerprintReportValue(datasets.map((dataset) => ({
      datasetId: dataset.datasetId,
      recordCount: dataset.recordCount,
      contentFingerprint: dataset.contentFingerprint
    }))),
    commandTransitionFingerprint: fingerprintReportValue(commandTransitionReport.recentTransitions),
    retentionWarnings: reportingRetentionState.exportWarningCodes,
    datasets
  };
}

function makeReportingSnapshot({ state, now, operationalHealth, restartSafeStatus, auditEventCount }) {
  return normalizeHistorySnapshot({
    snapshotId: `history-${state.generation}-${state.status}`,
    capturedAt: now,
    generation: state.generation,
    status: state.status,
    healthState: operationalHealth.state,
    recoveryStatus: restartSafeStatus.status,
    checkpointCount: state.checkpoints.length,
    verifiedCheckpointCount: state.checkpoints.filter((checkpoint) => checkpoint.verified).length,
    commandCount: state.commandLog.length,
    auditEventCount
  }, 0, now);
}

function deriveHistorySnapshots({ state, now, commandResult, operationalHealth, restartSafeStatus, auditEventCount }) {
  const previous = Array.isArray(state.historySnapshots) ? state.historySnapshots : [];
  const shouldCapture = previous.length === 0 || (commandResult.rejected !== true && commandResult.idempotent !== true);
  if (!shouldCapture) return previous.slice(-MAX_HISTORY_SNAPSHOTS);

  const snapshot = makeReportingSnapshot({ state, now, operationalHealth, restartSafeStatus, auditEventCount });
  const withoutDuplicateGeneration = previous.filter((entry) => entry.generation !== snapshot.generation);
  return [...withoutDuplicateGeneration, snapshot].slice(-MAX_HISTORY_SNAPSHOTS);
}

function deriveAnalyticsCounters({ state, commandResult, operationalHealth, checkpointSafety, evidence, commandTransitionReport, historyTrendReport }) {
  const checkpoints = state.checkpoints;
  const commandCounts = countBy(state.commandLog, (entry) => entry.command);
  const idempotencyLedger = Array.isArray(state.idempotencyLedger) ? state.idempotencyLedger : [];
  const verifiedCheckpointCount = checkpoints.filter((checkpoint) => checkpoint.verified).length;
  const reversibleCheckpointCount = checkpoints.filter((checkpoint) => checkpoint.reversible).length;
  const latestCheckpoint = state.rollbackCursor >= 0 ? checkpoints[state.rollbackCursor] : null;
  return {
    generations: state.generation,
    commandsTotal: state.commandLog.length,
    commandsByName: commandCounts,
    rejectedCommands: commandResult.rejected ? 1 : 0,
    idempotentReplays: commandResult.idempotent ? 1 : 0,
    checkpointsTotal: checkpoints.length,
    verifiedCheckpoints: verifiedCheckpointCount,
    unverifiedCheckpoints: Math.max(0, checkpoints.length - verifiedCheckpointCount),
    reversibleCheckpoints: reversibleCheckpointCount,
    nonReversibleCheckpoints: Math.max(0, checkpoints.length - reversibleCheckpointCount),
    evidenceItems: evidence.length,
    activeErrors: operationalHealth.errors.length,
    activeWarnings: operationalHealth.warnings.length,
    retryableFindings: [...operationalHealth.errors, ...operationalHealth.warnings].filter((entry) => entry.retryable).length,
    failureState: operationalHealth.failureState.state,
    failureEscalationReasons: operationalHealth.failureState.escalationReasons,
    failureRetryBudgetExhausted: operationalHealth.failureState.retryBudgetExhausted,
    failureConsecutiveLimitReached: operationalHealth.failureState.consecutiveFailureLimitReached,
    failureStalePendingOperation: operationalHealth.failureState.stalePendingOperation,
    failureDegradedRetryAllowed: operationalHealth.failureState.degradedRetryAllowed,
    latestCheckpointId: latestCheckpoint?.checkpointId || null,
    checkpointSafetyEligible: checkpointSafety.eligible,
    checkpointSafetyBlockingReasons: checkpointSafety.blockingReasons,
    expiredCheckpointCount: checkpointSafety.expiredCheckpointIds.length,
    eligibleCheckpointCount: checkpointSafety.eligibleCheckpointIds.length,
    selectedCheckpointAgeHours: checkpointSafety.selectedCheckpointAgeHours,
    lifecycleEnabled: state.lifecycleSettings.enabled,
    lifecycleSettingsValid: state.lifecycleSettings.validationErrors.length === 0,
    scheduleEnabled: state.lifecycleSettings.schedule.enabled,
    recoveryJournalAttempts: state.recoveryJournal.attempts.length,
    recoveryOperationPending: state.recoveryJournal.pendingOperation !== null,
    recoveryLastStableGeneration: state.recoveryJournal.lastStableGeneration,
    idempotencyLedgerEntries: idempotencyLedger.length,
    idempotencyPendingEntries: idempotencyLedger.filter((entry) => entry.completed !== true || entry.recoveryPending === true).length,
    idempotencyReplayCount: idempotencyLedger.reduce((total, entry) => total + entry.replayCount, 0),
    idempotencyConflicts: commandResult.rejectionKind === "idempotency_conflict" ? 1 : 0,
    commandTransitionsTotal: commandTransitionReport.transitionCount,
    commandStatusCounts: commandTransitionReport.commandStatusCounts,
    commandTransitionCounts: commandTransitionReport.transitionCounts,
    averageCommandTransitionElapsedMs: commandTransitionReport.averageTransitionElapsedMs,
    latestCommandAgeMs: commandTransitionReport.latestCommandAgeMs,
    historySnapshotCount: historyTrendReport.snapshotCount,
    historyStatusCounts: historyTrendReport.statusCounts,
    historyHealthStateCounts: historyTrendReport.healthStateCounts,
    historyRecoveryStatusCounts: historyTrendReport.recoveryStatusCounts,
    historyDeltaFromPrevious: historyTrendReport.deltaFromPrevious,
    terminal: TERMINAL_STATUSES.has(state.status)
  };
}

function deriveTimelineEvents({ state, audit, historySnapshots, restartSafeStatus }) {
  const events = [
    {
      at: state.createdAt,
      type: "plan.created_at",
      label: "Plan created",
      generation: 0,
      status: "draft"
    },
    ...state.commandLog.map((entry) => ({
      at: entry.appliedAt,
      type: `command.${entry.command}`,
      label: entry.command,
      generation: entry.generation,
      actorRole: entry.actorRole,
      commandId: entry.commandId
    })),
    ...state.checkpoints.map((checkpoint) => ({
      at: checkpoint.createdAt,
      type: checkpoint.verified ? "checkpoint.verified" : "checkpoint.recorded",
      label: checkpoint.label,
      checkpointId: checkpoint.checkpointId,
      verified: checkpoint.verified
    })),
    ...historySnapshots.map((snapshot) => ({
      at: snapshot.capturedAt,
      type: "history.snapshot",
      label: snapshot.status,
      generation: snapshot.generation,
      healthState: snapshot.healthState
    })),
    ...audit.map((entry) => ({
      at: entry.at,
      type: `audit.${entry.type}`,
      label: entry.type,
      generation: state.generation
    }))
  ];

  return events
    .filter((event) => typeof event.at === "string")
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
    .slice(-MAX_TIMELINE_EVENTS)
    .map((event, index) => ({
      sequence: index + 1,
      recoveryRequired: restartSafeStatus.status === "needs_recovery",
      ...event
    }));
}

function deriveExportSummary({
  state,
  generatedAt,
  analytics,
  historySnapshots,
  historyTrendReport,
  timeline,
  timelineReportState,
  commandTransitionReport,
  operationalHealth,
  auditHandoff,
  providerNegotiation,
  providerReadiness,
  checkpointSafety,
  reportDatasetCatalog,
  reportingRetentionState
}) {
  const firstTimelineEvent = timeline[0] || null;
  const lastTimelineEvent = timeline[timeline.length - 1] || null;
  const exportSections = [
    {
      sectionId: "summary",
      label: "Rollback summary",
      recordCount: 1,
      ready: true
    },
    {
      sectionId: "history",
      label: "History snapshots",
      recordCount: historyTrendReport.snapshotCount,
      ready: historyTrendReport.snapshotCount > 0
    },
    {
      sectionId: "timeline",
      label: "Timeline events",
      recordCount: timelineReportState.eventCount,
      ready: timelineReportState.reportable
    },
    {
      sectionId: "commands",
      label: "Command transitions",
      recordCount: commandTransitionReport.transitionCount,
      ready: commandTransitionReport.commandCount > 0
    },
    {
      sectionId: "providers",
      label: "Provider readiness",
      recordCount: providerReadiness.findings.length,
      ready: providerNegotiation.accepted && providerReadiness.state !== "blocked"
    },
    {
      sectionId: "datasets",
      label: "Export datasets",
      recordCount: reportDatasetCatalog.datasetCount,
      ready: reportDatasetCatalog.blockedDatasetIds.length === 0
    }
  ];
  return {
    exportType: "rollback-plan.analytics-export.v1",
    generatedAt,
    planId: state.planId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    status: state.status,
    generation: state.generation,
    healthState: operationalHealth.state,
    degradedMode: operationalHealth.degraded,
    failureState: {
      state: operationalHealth.failureState.state,
      strategy: operationalHealth.failureState.strategy,
      retryable: operationalHealth.failureState.retryable,
      retryBudgetExhausted: operationalHealth.failureState.retryBudgetExhausted,
      consecutiveFailureLimitReached: operationalHealth.failureState.consecutiveFailureLimitReached,
      stalePendingOperation: operationalHealth.failureState.stalePendingOperation,
      escalationReasons: operationalHealth.failureState.escalationReasons,
      retryAfterAt: operationalHealth.failureState.retryAfterAt,
      nextCommand: operationalHealth.failureState.nextCommand,
      operatorAction: operationalHealth.failureState.operatorAction
    },
    latestSnapshotId: historySnapshots[historySnapshots.length - 1]?.snapshotId || null,
    timelineRange: {
      from: firstTimelineEvent?.at || null,
      to: lastTimelineEvent?.at || null,
      eventCount: timeline.length
    },
    exportReadiness: {
      ready: exportSections.every((section) => section.ready) && reportDatasetCatalog.blockedDatasetIds.length === 0,
      blockedSections: exportSections.filter((section) => !section.ready).map((section) => section.sectionId),
      blockedDatasetIds: reportDatasetCatalog.blockedDatasetIds,
      sectionCount: exportSections.length,
      sections: exportSections
    },
    reportDatasetCatalog: {
      contractType: reportDatasetCatalog.contractType,
      datasetCount: reportDatasetCatalog.datasetCount,
      requiredDatasetCount: reportDatasetCatalog.requiredDatasetCount,
      readyDatasetCount: reportDatasetCatalog.readyDatasetCount,
      blockedDatasetIds: reportDatasetCatalog.blockedDatasetIds,
      catalogFingerprint: reportDatasetCatalog.catalogFingerprint,
      commandTransitionFingerprint: reportDatasetCatalog.commandTransitionFingerprint,
      retentionWarnings: reportDatasetCatalog.retentionWarnings,
      datasets: reportDatasetCatalog.datasets.map((dataset) => ({
        datasetId: dataset.datasetId,
        schemaVersion: dataset.schemaVersion,
        required: dataset.required,
        ready: dataset.ready,
        recordCount: dataset.recordCount,
        exportFormats: dataset.exportFormats,
        contentFingerprint: dataset.contentFingerprint,
        blockedReasons: dataset.blockedReasons
      }))
    },
    reportingRetention: reportingRetentionState,
    counters: analytics,
    commandTransitions: {
      commandCount: commandTransitionReport.commandCount,
      transitionCount: commandTransitionReport.transitionCount,
      averageTransitionElapsedMs: commandTransitionReport.averageTransitionElapsedMs,
      latestCommandId: commandTransitionReport.latestCommandId,
      latestCommandName: commandTransitionReport.latestCommandName,
      latestCommandAgeMs: commandTransitionReport.latestCommandAgeMs,
      recentTransitions: commandTransitionReport.recentTransitions
    },
    historyTrend: {
      snapshotCount: historyTrendReport.snapshotCount,
      latestSnapshotId: historyTrendReport.latestSnapshotId,
      latestHealthState: historyTrendReport.latestHealthState,
      latestRecoveryStatus: historyTrendReport.latestRecoveryStatus,
      deltaFromPrevious: historyTrendReport.deltaFromPrevious
    },
    timelineReport: {
      eventCount: timelineReportState.eventCount,
      commandEventCount: timelineReportState.commandEventCount,
      auditEventCount: timelineReportState.auditEventCount,
      checkpointEventCount: timelineReportState.checkpointEventCount,
      latestEventType: timelineReportState.latestEventType,
      latestEventAt: timelineReportState.latestEventAt,
      timelineTruncated: timelineReportState.timelineTruncated
    },
    handoff: {
      target: auditHandoff.target,
      correlationId: auditHandoff.correlationId,
      required: auditHandoff.required,
      externalHandoffState: providerNegotiation.externalHandoffState,
      pendingCount: providerNegotiation.externalHandoffPendingCount,
      failedCount: providerNegotiation.externalHandoffFailedCount,
      claimable: providerNegotiation.externalHandoffClaimable
    },
    checkpointSafety: {
      eligible: checkpointSafety.eligible,
      selectedCheckpointId: checkpointSafety.selectedCheckpointId,
      selectedCheckpointAgeHours: checkpointSafety.selectedCheckpointAgeHours,
      selectedCheckpointExpiresAt: checkpointSafety.selectedCheckpointExpiresAt,
      maxRollbackAgeHours: checkpointSafety.maxRollbackAgeHours,
      blockingReasons: checkpointSafety.blockingReasons,
      eligibleCheckpointIds: checkpointSafety.eligibleCheckpointIds,
      expiredCheckpointIds: checkpointSafety.expiredCheckpointIds
    },
    providerNegotiation: {
      accepted: providerNegotiation.accepted,
      command: providerNegotiation.command,
      missingCapabilities: providerNegotiation.missingCapabilities,
      offlineServices: providerNegotiation.offlineServices,
      syncDirty: providerNegotiation.syncDirty,
      externalHandoffState: providerNegotiation.externalHandoffState,
      externalHandoffPendingCount: providerNegotiation.externalHandoffPendingCount,
      externalHandoffFailedCount: providerNegotiation.externalHandoffFailedCount
    },
    providerReadiness: {
      state: providerReadiness.state,
      command: providerReadiness.command,
      requiredServices: providerReadiness.requiredServices,
      blockingServices: providerReadiness.blockingServices,
      degradedServices: providerReadiness.degradedServices,
      handoffBlocked: providerReadiness.handoffBlocked,
      handoffPending: providerReadiness.handoffPending,
      handoffBlockedReasons: providerReadiness.handoffBlockedReasons,
      runnableInDegradedMode: providerReadiness.runnableInDegradedMode,
      action: providerReadiness.action
    }
  };
}

function normalizeClientRuntimeState(input = {}, state = {}, actor = {}, scope = {}, now) {
  const rawClientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const rawRequest = input.request && typeof input.request === "object" ? input.request : {};
  const rawClientHandoff = rawClientState.workflowHandoff && typeof rawClientState.workflowHandoff === "object"
    ? rawClientState.workflowHandoff
    : {};
  const rawRequestHandoff = rawRequest.workflowHandoff && typeof rawRequest.workflowHandoff === "object"
    ? rawRequest.workflowHandoff
    : {};
  const requestedHandoffCommand = asNonEmptyString(
    rawClientHandoff.targetCommand
      || rawRequestHandoff.targetCommand
      || rawClientState.requestedHandoffCommand
      || rawRequest.targetCommand,
    null
  );
  const targetCommand = VALID_COMMANDS.has(requestedHandoffCommand) ? requestedHandoffCommand : null;
  const previewModeCandidate = asNonEmptyString(
    rawClientHandoff.previewMode || rawRequestHandoff.previewMode || rawClientState.previewMode,
    "interactive"
  );
  const previewMode = VALID_CLIENT_PREVIEW_MODES.has(previewModeCandidate) ? previewModeCandidate : "interactive";
  const acknowledgedRiskCodes = asStringList(
    rawClientHandoff.acknowledgedRiskCodes
      || rawClientHandoff.acknowledgements
      || rawClientState.acknowledgedRiskCodes
  );
  const requiredAcknowledgementIds = asStringList(
    rawClientHandoff.requiredAcknowledgementIds
      || rawRequestHandoff.requiredAcknowledgementIds
      || rawRequest.requiredAcknowledgementIds
  );
  const missingAcknowledgementIds = requiredAcknowledgementIds.filter((id) => !acknowledgedRiskCodes.includes(id));
  const optimisticGeneration = Number.isInteger(rawClientState.optimisticGeneration)
    ? Math.max(0, rawClientState.optimisticGeneration)
    : null;
  const knownGeneration = Number.isInteger(rawClientState.knownGeneration)
    ? Math.max(0, rawClientState.knownGeneration)
    : optimisticGeneration;
  const stale = knownGeneration !== null && knownGeneration < state.generation;

  return {
    contractType: "rollback-plan.client-runtime-state.v1",
    requestId: asNonEmptyString(rawRequest.requestId || input.requestId, `rollback-request:${state.generation + 1}`),
    clientId: asNonEmptyString(rawClientState.clientId || input.clientId, "hosted-kernel.client"),
    sessionId: asNonEmptyString(rawClientState.sessionId || input.sessionId, null),
    routeId: asNonEmptyString(rawClientState.routeId || rawRequest.routeId, "audit-recovery.rollback-plan"),
    observedAt: asIsoTimestamp(rawClientState.observedAt || rawRequest.observedAt, now),
    actorRole: actor.role,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    knownGeneration,
    currentGeneration: state.generation,
    stale,
    requestedCommand: asNonEmptyString(input.command, "shape"),
    preferredHandoffTarget: asNonEmptyString(rawClientState.preferredHandoffTarget, null),
    supportsWorkflowHandoff: rawClientState.supportsWorkflowHandoff !== false,
    pendingClientAction: asNonEmptyString(rawClientState.pendingAction, null),
    handoffIntent: {
      contractType: "rollback-plan.client-handoff-intent.v1",
      targetRouteId: asNonEmptyString(
        rawClientHandoff.targetRouteId || rawRequestHandoff.targetRouteId || rawClientState.preferredHandoffTarget,
        null
      ),
      requestedCommand: requestedHandoffCommand,
      targetCommand,
      validTargetCommand: !requestedHandoffCommand || targetCommand !== null,
      previewMode,
      autoClaimRequested: previewMode === "auto_claim" || rawClientHandoff.autoClaim === true,
      readOnly: previewMode === "read_only",
      requiresAcknowledgement: requiredAcknowledgementIds.length > 0,
      requiredAcknowledgementIds,
      acknowledgedRiskCodes,
      missingAcknowledgementIds,
      claimLabel: asNonEmptyString(rawClientHandoff.claimLabel || rawRequestHandoff.claimLabel, null)
    }
  };
}

function deriveWorkflowCommand(lifecycleControls, restartSafeStatus, operationalHealth, clientRuntime = {}) {
  if (restartSafeStatus.status === "needs_recovery") return "recover";
  if (operationalHealth.failureState?.state === "escalated") return operationalHealth.failureState.nextCommand || "recover";
  if (clientRuntime.handoffIntent?.targetCommand) return clientRuntime.handoffIntent.targetCommand;
  if (operationalHealth.errors.length > 0) return "shape";
  return lifecycleControls.nextCommand || LIFECYCLE_NEXT_ACTION_COMMANDS[lifecycleControls.nextAction] || "shape";
}

function deriveWorkflowHandoff({
  state,
  actor,
  clientRuntime,
  lifecycleControls,
  restartSafeStatus,
  operationalHealth,
  checkpointSafety,
  auditHandoff,
  providerContracts,
  providerNegotiation,
  now
}) {
  const targetCommand = deriveWorkflowCommand(lifecycleControls, restartSafeStatus, operationalHealth, clientRuntime);
  const commandPermitted = commandAllowedForActor(actor, targetCommand);
  const providerReady = providerNegotiation.accepted && providerContracts.externalHandoff.state !== "blocked";
  const handoffIntent = clientRuntime.handoffIntent || {};
  const commandAvailability = lifecycleControls.commandMatrix?.[targetCommand] || null;
  const clientCanAccept = clientRuntime.supportsWorkflowHandoff && !clientRuntime.stale;
  const blockedReasons = [];

  if (!clientRuntime.supportsWorkflowHandoff) blockedReasons.push("client_handoff_not_supported");
  if (clientRuntime.stale) blockedReasons.push("client_generation_stale");
  if (handoffIntent.validTargetCommand === false) blockedReasons.push("client_requested_unknown_handoff_command");
  if (handoffIntent.readOnly) blockedReasons.push("client_handoff_preview_read_only");
  if (handoffIntent.missingAcknowledgementIds?.length > 0) blockedReasons.push("client_handoff_acknowledgement_required");
  if (commandAvailability && commandAvailability.enabled !== true) {
    blockedReasons.push(...commandAvailability.blockedReasons.map((reason) => `target_command:${reason}`));
  }
  if (!commandPermitted) blockedReasons.push("actor_cannot_claim_target_command");
  if (!providerNegotiation.accepted) blockedReasons.push("provider_capability_negotiation_failed");
  if (providerContracts.externalHandoff.state === "blocked") blockedReasons.push("external_handoff_blocked");
  if (operationalHealth.errors.length > 0 && targetCommand !== "shape") blockedReasons.push("operational_errors_present");

  const claimable = clientCanAccept && commandPermitted && providerReady && blockedReasons.length === 0;
  const checkpoint = state.rollbackCursor >= 0 ? state.checkpoints[state.rollbackCursor] : null;

  return {
    contractType: "rollback-plan.workflow-handoff.v1",
    handoffId: `${state.planId}:${state.generation}:${clientRuntime.requestId}`,
    generatedAt: now,
    state: restartSafeStatus.status === "recovered"
      ? "complete"
      : claimable
        ? "claimable"
        : blockedReasons.length > 0
          ? "blocked"
          : "not_required",
    sourceRouteId: clientRuntime.routeId,
    targetRouteId: handoffIntent.targetRouteId || clientRuntime.preferredHandoffTarget || "audit-recovery.rollback-workbench",
    targetCommand,
    requiredActorRole: actor.role,
    claim: {
      claimable,
      claimRef: providerContracts.externalHandoff.claimRef || `${auditHandoff.correlationId}:claim`,
      correlationId: auditHandoff.correlationId,
      target: providerContracts.externalHandoff.target,
      expiresAt: null,
      blockedReasons
    },
    userVisibleNextStep: {
      action: lifecycleControls.nextAction,
      command: targetCommand,
      disabled: !claimable,
      disabledReasons: blockedReasons,
      label: handoffIntent.claimLabel || lifecycleControls.nextAction
    },
    clientIntent: {
      targetCommandRequested: handoffIntent.requestedCommand || null,
      targetCommandValid: handoffIntent.validTargetCommand !== false,
      targetCommandAccepted: handoffIntent.validTargetCommand !== false,
      targetCommandRouted: !handoffIntent.targetCommand || handoffIntent.targetCommand === targetCommand,
      previewMode: handoffIntent.previewMode || "interactive",
      autoClaimRequested: handoffIntent.autoClaimRequested === true,
      readOnly: handoffIntent.readOnly === true,
      requiredAcknowledgementIds: handoffIntent.requiredAcknowledgementIds || [],
      acknowledgedRiskCodes: handoffIntent.acknowledgedRiskCodes || [],
      missingAcknowledgementIds: handoffIntent.missingAcknowledgementIds || []
    },
    recoveryContext: {
      required: restartSafeStatus.status === "needs_recovery",
      status: restartSafeStatus.status,
      reason: restartSafeStatus.reason,
      checkpointId: checkpoint?.checkpointId || null,
      checkpointVerified: checkpoint?.verified === true,
      checkpointSafetyEligible: checkpointSafety.eligible,
      checkpointSafetyBlockingReasons: checkpointSafety.blockingReasons
    }
  };
}

function normalizePreviewAcceptance(input = {}, state = {}, actor = {}, clientRuntime = {}, now) {
  const rawAcceptance = input.previewAcceptance && typeof input.previewAcceptance === "object"
    ? input.previewAcceptance
    : {};
  const accepted = rawAcceptance.accepted === true || input.acceptPreview === true;
  const acceptedGeneration = Number.isInteger(rawAcceptance.generation ?? rawAcceptance.acceptedGeneration)
    ? Math.max(0, rawAcceptance.generation ?? rawAcceptance.acceptedGeneration)
    : null;
  const acknowledgementIds = asStringList(rawAcceptance.acknowledgementIds || rawAcceptance.acknowledgements);

  return {
    contractType: "rollback-plan.preview-acceptance.v1",
    acceptanceId: asNonEmptyString(rawAcceptance.acceptanceId || rawAcceptance.id, `${clientRuntime.requestId}:preview-acceptance`),
    accepted,
    acceptedAt: accepted ? asIsoTimestamp(rawAcceptance.acceptedAt, now) : null,
    acceptedBy: accepted ? asNonEmptyString(rawAcceptance.acceptedBy || rawAcceptance.actorId, actor.actorId) : null,
    actorRole: actor.role,
    acceptedGeneration,
    currentGeneration: state.generation,
    generationMatches: acceptedGeneration === null || acceptedGeneration === state.generation,
    acknowledgementIds,
    rejectedReason: accepted ? null : asNonEmptyString(rawAcceptance.rejectedReason || rawAcceptance.reason, null)
  };
}

function deriveClientValidationSummary({
  state,
  commandResult,
  clientRuntime,
  lifecycleControls,
  restartSafeStatus,
  operationalHealth,
  checkpointSafety,
  providerNegotiation,
  providerReadiness,
  workflowHandoff,
  previewAcceptance
}) {
  const validations = [
    {
      id: "workspace-boundary",
      label: "Workspace boundary",
      state: commandResult.boundary.accepted ? "passed" : "blocked",
      blocking: commandResult.boundary.accepted !== true,
      reasonCodes: commandResult.boundary.violations,
      routeField: "workspaceBoundary"
    },
    {
      id: "payload-scope",
      label: "Payload scope",
      state: commandResult.payloadScope?.clean !== false ? "passed" : "blocked",
      blocking: commandResult.payloadScope?.clean === false,
      reasonCodes: commandResult.payloadScope?.violations || [],
      routeField: "workspaceBoundary.payloadScope"
    },
    {
      id: "lifecycle-controls",
      label: "Lifecycle controls",
      state: lifecycleControls.settingsValid && lifecycleControls.enabled ? "passed" : "needs_input",
      blocking: lifecycleControls.settingsValid !== true || lifecycleControls.enabled !== true,
      reasonCodes: lifecycleControls.validationErrors.length > 0
        ? lifecycleControls.validationErrors
        : lifecycleControls.enabled ? [] : ["rollback_plan_disabled"],
      routeField: "lifecycle.controls"
    },
    {
      id: "checkpoint-safety",
      label: "Checkpoint safety",
      state: checkpointSafety.eligible ? "passed" : "blocked",
      blocking: checkpointSafety.eligible !== true,
      reasonCodes: checkpointSafety.blockingReasons,
      routeField: "lifecycle.checkpointSafety"
    },
    {
      id: "provider-readiness",
      label: "Provider readiness",
      state: providerNegotiation.accepted && providerReadiness.state !== "blocked"
        ? providerReadiness.state === "degraded" ? "warning" : "passed"
        : "blocked",
      blocking: providerNegotiation.accepted !== true || providerReadiness.state === "blocked",
      reasonCodes: [
        ...providerNegotiation.missingCapabilities.map((capability) => `missing:${capability}`),
        ...providerNegotiation.offlineServices.map((serviceName) => `offline:${serviceName}`),
        ...providerReadiness.blockingServices.map((serviceName) => `blocked:${serviceName}`),
        ...providerReadiness.degradedServices.map((serviceName) => `degraded:${serviceName}`),
        ...(providerReadiness.handoffBlocked ? ["handoff:blocked"] : [])
      ],
      routeField: "integration.capabilityNegotiation"
    },
    {
      id: "failure-state",
      label: "Failure state",
      state: operationalHealth.failureState.state === "clear"
        ? "passed"
        : operationalHealth.failureState.state === "escalated"
          ? "blocked"
          : "warning",
      blocking: operationalHealth.failureState.state === "escalated",
      reasonCodes: operationalHealth.failureState.escalationReasons,
      routeField: "operationalHealth.failureState"
    },
    {
      id: "client-freshness",
      label: "Client generation",
      state: clientRuntime.stale ? "needs_refresh" : "passed",
      blocking: clientRuntime.stale === true,
      reasonCodes: clientRuntime.stale ? ["client_generation_stale"] : [],
      routeField: "clientRuntime"
    },
    {
      id: "client-handoff-intent",
      label: "Client handoff intent",
      state: workflowHandoff.clientIntent.targetCommandValid && workflowHandoff.clientIntent.missingAcknowledgementIds.length === 0
        ? workflowHandoff.clientIntent.readOnly ? "preview_only" : "passed"
        : "needs_input",
      blocking: workflowHandoff.clientIntent.targetCommandValid !== true
        || workflowHandoff.clientIntent.missingAcknowledgementIds.length > 0,
      reasonCodes: [
        ...(workflowHandoff.clientIntent.targetCommandValid ? [] : ["client_requested_unknown_handoff_command"]),
        ...workflowHandoff.clientIntent.missingAcknowledgementIds.map((id) => `acknowledgement:${id}`)
      ],
      routeField: "clientRuntime.handoffIntent"
    },
    {
      id: "preview-acceptance",
      label: "Preview acceptance",
      state: previewAcceptance.accepted
        ? previewAcceptance.generationMatches ? "accepted" : "needs_refresh"
        : "waiting",
      blocking: previewAcceptance.accepted === true && previewAcceptance.generationMatches !== true,
      reasonCodes: previewAcceptance.accepted && !previewAcceptance.generationMatches
        ? ["accepted_generation_mismatch"]
        : [],
      routeField: "preview.acceptance"
    }
  ];
  const restartBlocking = restartSafeStatus.status === "needs_recovery" && workflowHandoff.targetCommand !== "recover";
  if (restartBlocking) {
    validations.push({
      id: "restart-recovery",
      label: "Restart recovery",
      state: "blocked",
      blocking: true,
      reasonCodes: [restartSafeStatus.reason],
      routeField: "recovery.restartAction"
    });
  }

  const blockingValidations = validations.filter((validation) => validation.blocking);
  const warningCodes = operationalHealth.warnings.map((warning) => warning.code);
  const errorCodes = operationalHealth.errors.map((error) => error.code);

  return {
    contractType: "rollback-plan.validation-summary.v1",
    status: blockingValidations.length > 0 || errorCodes.length > 0 ? "blocked" : warningCodes.length > 0 ? "warning" : "passed",
    passedCount: validations.filter((validation) => !validation.blocking).length,
    blockedCount: blockingValidations.length,
    warningCount: warningCodes.length,
    errorCount: errorCodes.length,
    validations,
    blockingReasonCodes: [...new Set([...blockingValidations.flatMap((validation) => validation.reasonCodes), ...errorCodes])],
    warningCodes
  };
}

function deriveClientPreviewContract({
  state,
  commandResult,
  actor,
  clientRuntime,
  lifecycleControls,
  restartSafeStatus,
  operationalHealth,
  checkpointSafety,
  providerNegotiation,
  providerReadiness,
  workflowHandoff,
  input,
  now
}) {
  const checkpoint = state.rollbackCursor >= 0 ? state.checkpoints[state.rollbackCursor] : null;
  const previewAcceptance = normalizePreviewAcceptance(input, state, actor, clientRuntime, now);
  const validationSummary = deriveClientValidationSummary({
    state,
    commandResult,
    clientRuntime,
    lifecycleControls,
    restartSafeStatus,
    operationalHealth,
    checkpointSafety,
    providerNegotiation,
    providerReadiness,
    workflowHandoff,
    previewAcceptance
  });
  const commandAccepted = commandResult.rejected !== true;
  const acceptanceRequired = state.lifecycleSettings.requireOperatorApproval === true
    || ["execute", "recover", "mark_recovered"].includes(workflowHandoff.targetCommand);
  const acceptanceSatisfied = !acceptanceRequired
    || (previewAcceptance.accepted === true && previewAcceptance.generationMatches === true);
  const routeBlockedReasons = [
    ...validationSummary.blockingReasonCodes,
    ...workflowHandoff.claim.blockedReasons,
    ...(acceptanceRequired && !acceptanceSatisfied ? ["operator_preview_acceptance_required"] : [])
  ];
  const ready = commandAccepted
    && validationSummary.status !== "blocked"
    && workflowHandoff.claim.claimable
    && acceptanceSatisfied
    && operationalHealth.errors.length === 0;

  return {
    contractType: "rollback-plan.client-preview.v1",
    previewId: `${state.planId}:${state.generation}:${clientRuntime.requestId}:preview`,
    generatedAt: now,
    routeId: clientRuntime.routeId,
    title: checkpoint
      ? `Rollback to ${checkpoint.label}`
      : "Rollback checkpoint required",
    summary: {
      status: state.status,
      generation: state.generation,
      command: workflowHandoff.targetCommand,
      nextAction: lifecycleControls.nextAction,
      healthState: operationalHealth.state,
      recoveryRequired: restartSafeStatus.status === "needs_recovery",
      checkpointId: checkpoint?.checkpointId || null,
      checkpointLabel: checkpoint?.label || null
    },
    readiness: {
      contractType: "rollback-plan.client-readiness.v1",
      state: ready ? "ready" : validationSummary.status === "blocked" ? "blocked" : "needs_input",
      ready,
      canSubmitTargetCommand: ready,
      canAcceptPreview: commandAccepted && !clientRuntime.stale && validationSummary.status !== "blocked",
      acceptanceRequired,
      acceptanceSatisfied,
      routeBlockedReasons: [...new Set(routeBlockedReasons)]
    },
    acceptance: previewAcceptance,
    validationSummary,
    nextStep: {
      contractType: "rollback-plan.explainable-next-step.v1",
      action: lifecycleControls.nextAction,
      command: workflowHandoff.targetCommand,
      routeId: workflowHandoff.targetRouteId,
      label: workflowHandoff.userVisibleNextStep.action,
      disabled: !ready,
      disabledReasons: [...new Set(routeBlockedReasons)],
      explanation: operationalHealth.nextAction || restartSafeStatus.recoveryAction || lifecycleControls.nextAction,
      handoffId: workflowHandoff.handoffId,
      claimRef: workflowHandoff.claim.claimable ? workflowHandoff.claim.claimRef : null,
      clientIntent: workflowHandoff.clientIntent
    }
  };
}

function deriveClientPreviewRouteContract({
  state,
  actor,
  clientRuntime,
  clientPreview,
  workflowHandoff,
  auditHandoff,
  providerReadiness,
  now
}) {
  const readiness = clientPreview.readiness;
  const acceptance = clientPreview.acceptance;
  const validationSummary = clientPreview.validationSummary;
  const nextStep = clientPreview.nextStep;
  const targetCommand = nextStep.command;
  const routeBlockedReasons = [...new Set(readiness.routeBlockedReasons || nextStep.disabledReasons || [])];
  const acceptanceBlockedReasons = [
    ...(readiness.acceptanceRequired && !readiness.acceptanceSatisfied ? ["operator_preview_acceptance_required"] : []),
    ...(acceptance.accepted && !acceptance.generationMatches ? ["accepted_generation_mismatch"] : [])
  ];
  const validationCards = validationSummary.validations.map((validation) => ({
    validationId: validation.id,
    label: validation.label,
    state: validation.state,
    blocking: validation.blocking,
    routeField: validation.routeField,
    reasonCodes: validation.reasonCodes,
    userVisible: validation.blocking || validation.state !== "passed"
  }));
  const submitPayload = {
    contractType: "rollback-plan.route-submit-payload.v1",
    command: targetCommand,
    commandId: `${targetCommand}:${state.generation + 1}:client-preview`,
    requestId: clientRuntime.requestId,
    previewId: clientPreview.previewId,
    acceptanceId: acceptance.acceptanceId,
    acceptedGeneration: acceptance.acceptedGeneration,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    auditCorrelationId: auditHandoff.correlationId,
    claimRef: workflowHandoff.claim.claimable ? workflowHandoff.claim.claimRef : null
  };
  const acceptancePayload = {
    contractType: "rollback-plan.route-preview-acceptance-payload.v1",
    previewId: clientPreview.previewId,
    acceptanceId: acceptance.acceptanceId,
    generation: state.generation,
    actorId: actor.actorId,
    actorRole: actor.role,
    acknowledgementIds: [
      ...new Set([
        ...workflowHandoff.clientIntent.requiredAcknowledgementIds,
        ...validationSummary.blockingReasonCodes.filter((code) => code.startsWith("rollback_plan."))
      ])
    ],
    routeBlockedReasons: [...new Set([...routeBlockedReasons, ...acceptanceBlockedReasons])]
  };
  const actions = [
    {
      actionId: "accept-preview",
      label: "Accept preview",
      command: "accept_preview",
      primary: readiness.acceptanceRequired,
      enabled: readiness.canAcceptPreview && !readiness.acceptanceSatisfied,
      disabledReasons: readiness.acceptanceSatisfied
        ? ["preview_already_accepted"]
        : [...new Set([...routeBlockedReasons.filter((reason) => reason !== "operator_preview_acceptance_required"), ...acceptanceBlockedReasons])]
    },
    {
      actionId: "submit-next-step",
      label: nextStep.label,
      command: targetCommand,
      primary: !readiness.acceptanceRequired || readiness.acceptanceSatisfied,
      enabled: readiness.canSubmitTargetCommand,
      disabledReasons: routeBlockedReasons
    },
    {
      actionId: "refresh-preview",
      label: "Refresh preview",
      command: "shape",
      primary: false,
      enabled: clientRuntime.stale || validationSummary.status === "blocked" || providerReadiness.retryable,
      disabledReasons: clientRuntime.stale ? [] : ["preview_refresh_not_required"]
    }
  ];

  return {
    contractType: "rollback-plan.client-preview-route-contract.v1",
    generatedAt: now,
    routeId: clientRuntime.routeId,
    targetRouteId: nextStep.routeId,
    previewId: clientPreview.previewId,
    planId: state.planId,
    generation: state.generation,
    readinessState: readiness.state,
    ready: readiness.ready,
    acceptanceRequired: readiness.acceptanceRequired,
    acceptanceSatisfied: readiness.acceptanceSatisfied,
    validationStatus: validationSummary.status,
    blockedReasonCodes: routeBlockedReasons,
    validationCards,
    actions,
    submitPayload,
    acceptancePayload,
    fingerprints: {
      preview: fingerprintReportValue({
        previewId: clientPreview.previewId,
        readinessState: readiness.state,
        acceptanceSatisfied: readiness.acceptanceSatisfied,
        validationStatus: validationSummary.status,
        nextStepCommand: targetCommand,
        blockedReasonCodes: routeBlockedReasons
      }),
      submitPayload: fingerprintReportValue(submitPayload),
      acceptancePayload: fingerprintReportValue(acceptancePayload)
    }
  };
}

function makeAuditEntry(type, now, details = {}) {
  return {
    type,
    at: now,
    surfaceId,
    ...details
  };
}

function commandSemanticKey(command, commandInput = {}, state = {}) {
  const explicitKey = asNonEmptyString(commandInput.idempotencyKey || commandInput.operationKey, null);
  if (explicitKey) return `operator:${state.planId}:${explicitKey}`;

  const pendingOperation = state.recoveryJournal?.pendingOperation || null;
  if (pendingOperation?.command === command && pendingOperation.semanticKey) return pendingOperation.semanticKey;

  const checkpointInput = commandInput.checkpoint && typeof commandInput.checkpoint === "object" ? commandInput.checkpoint : {};
  const settingsInput = commandInput.settings && typeof commandInput.settings === "object" ? commandInput.settings : {};
  const scheduleInput = commandInput.schedule && typeof commandInput.schedule === "object" ? commandInput.schedule : {};
  const checkpointId = asNonEmptyString(checkpointInput.checkpointId || checkpointInput.id, null);
  const stateRef = asNonEmptyString(checkpointInput.stateRef || checkpointInput.snapshotRef, null);
  const selectedCheckpoint = state.rollbackCursor >= 0 ? state.checkpoints[state.rollbackCursor] : null;

  if (command === "checkpoint") {
    return `checkpoint:${checkpointId || stateRef || state.checkpoints.length}:${state.planId}`;
  }
  if (command === "update_settings") {
    return `settings:${state.planId}:${JSON.stringify({
      enabled: settingsInput.enabled,
      requireVerifiedCheckpoint: settingsInput.requireVerifiedCheckpoint,
      requireAuditHandoff: settingsInput.requireAuditHandoff,
      requireOperatorApproval: settingsInput.requireOperatorApproval,
      allowUnverifiedExecution: settingsInput.allowUnverifiedExecution,
      maxRollbackAgeHours: settingsInput.maxRollbackAgeHours
    })}`;
  }
  if (command === "schedule") {
    return `schedule:${state.planId}:${JSON.stringify({
      enabled: scheduleInput.enabled,
      cadence: scheduleInput.cadence,
      nextRunAt: scheduleInput.nextRunAt,
      timezone: scheduleInput.timezone
    })}`;
  }
  if (["prepare", "execute", "recover", "mark_recovered"].includes(command)) {
    return `${command}:${state.planId}:${selectedCheckpoint?.checkpointId || "no-checkpoint"}:${state.generation}`;
  }
  if (command === "fail") {
    return `fail:${state.planId}:${asNonEmptyString(commandInput.reason, "rollback_plan_failed")}`;
  }
  return `${command}:${state.planId}:${state.generation}`;
}

function commandAlreadyApplied(state, commandId, semanticKey) {
  return state.commandLog.find((entry) => (
    Boolean(commandId && entry.commandId === commandId)
    || Boolean(semanticKey && entry.semanticKey === semanticKey)
  )) || null;
}

function deriveIdempotencyDecision(state, command, commandId, semanticKey, now) {
  const ledger = Array.isArray(state.idempotencyLedger) ? state.idempotencyLedger : [];
  const commandIdMatch = ledger.find((entry) => commandId && entry.commandId === commandId) || null;
  const semanticKeyMatch = ledger.find((entry) => semanticKey && entry.semanticKey === semanticKey) || null;
  const matchedEntry = commandIdMatch || semanticKeyMatch || commandAlreadyApplied(state, commandId, semanticKey);
  const conflictReasons = [];

  if (commandIdMatch && commandIdMatch.command !== command) conflictReasons.push("command_id_reused_for_different_command");
  if (semanticKeyMatch && semanticKeyMatch.command !== command) conflictReasons.push("semantic_key_reused_for_different_command");
  if (commandIdMatch && semanticKeyMatch && commandIdMatch.commandId !== semanticKeyMatch.commandId) {
    conflictReasons.push("command_id_and_semantic_key_match_different_operations");
  }
  if (commandIdMatch && semanticKeyMatch && commandIdMatch.generation !== semanticKeyMatch.generation) {
    conflictReasons.push("idempotency_keys_point_to_different_generations");
  }

  if (conflictReasons.length > 0) {
    return {
      contractType: "rollback-plan.idempotency-decision.v1",
      state: "conflict",
      accepted: false,
      replay: false,
      command,
      commandId,
      semanticKey,
      matchedCommandId: commandIdMatch?.commandId || semanticKeyMatch?.commandId || null,
      matchedSemanticKey: commandIdMatch?.semanticKey || semanticKeyMatch?.semanticKey || null,
      matchedGeneration: commandIdMatch?.generation ?? semanticKeyMatch?.generation ?? null,
      matchedStatusAfter: commandIdMatch?.statusAfter || semanticKeyMatch?.statusAfter || null,
      conflictReasons: [...new Set(conflictReasons)],
      evaluatedAt: now
    };
  }

  if (matchedEntry) {
    return {
      contractType: "rollback-plan.idempotency-decision.v1",
      state: "replay",
      accepted: true,
      replay: true,
      command,
      commandId,
      semanticKey,
      matchedCommandId: matchedEntry.commandId,
      matchedSemanticKey: matchedEntry.semanticKey,
      matchedGeneration: matchedEntry.generation,
      matchedStatusAfter: matchedEntry.statusAfter,
      conflictReasons: [],
      evaluatedAt: now
    };
  }

  return {
    contractType: "rollback-plan.idempotency-decision.v1",
    state: "new_operation",
    accepted: true,
    replay: false,
    command,
    commandId,
    semanticKey,
    matchedCommandId: null,
    matchedSemanticKey: null,
    matchedGeneration: null,
    matchedStatusAfter: null,
    conflictReasons: [],
    evaluatedAt: now
  };
}

function recordIdempotencyLedgerEntry(next, { command, commandId, semanticKey, now, actor, boundary }) {
  const previous = Array.isArray(next.idempotencyLedger) ? next.idempotencyLedger : [];
  const withoutDuplicate = previous.filter((entry) => entry.commandId !== commandId && entry.semanticKey !== semanticKey);
  next.idempotencyLedger = [
    ...withoutDuplicate,
    normalizeIdempotencyLedgerEntry({
      ledgerEntryId: `${commandId}:${next.generation}`,
      commandId,
      semanticKey,
      command,
      acceptedAt: now,
      generation: next.generation,
      statusAfter: next.status,
      actorId: actor.actorId,
      actorRole: actor.role,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      recoveryPending: next.recoveryJournal.pendingOperation !== null,
      completed: next.recoveryJournal.pendingOperation === null,
      replayCount: 0
    }, previous.length, now)
  ].slice(-MAX_IDEMPOTENCY_LEDGER_ENTRIES);
}

function markIdempotentReplay(state, idempotencyDecision, now) {
  const ledger = Array.isArray(state.idempotencyLedger) ? state.idempotencyLedger : [];
  if (!idempotencyDecision.replay) return ledger;
  return ledger.map((entry) => {
    const matched = entry.commandId === idempotencyDecision.matchedCommandId
      || entry.semanticKey === idempotencyDecision.matchedSemanticKey;
    return matched
      ? {
          ...entry,
          replayCount: entry.replayCount + 1,
          lastReplayAt: now
        }
      : entry;
  });
}

function deriveIdempotencyLedgerReport(state, commandResult, now) {
  const ledger = Array.isArray(state.idempotencyLedger) ? state.idempotencyLedger : [];
  const pendingEntries = ledger.filter((entry) => entry.completed !== true || entry.recoveryPending === true);
  const replayedEntries = ledger.filter((entry) => entry.replayCount > 0);

  return {
    contractType: "rollback-plan.idempotency-ledger-report.v1",
    generatedAt: now,
    ledgerSize: ledger.length,
    latestEntryId: ledger[ledger.length - 1]?.ledgerEntryId || null,
    pendingEntryCount: pendingEntries.length,
    replayedEntryCount: replayedEntries.length,
    commandIdReuseGuarded: true,
    semanticKeyReuseGuarded: true,
    currentDecision: commandResult.idempotencyDecision || null,
    pendingEntries: pendingEntries.map((entry) => ({
      ledgerEntryId: entry.ledgerEntryId,
      commandId: entry.commandId,
      semanticKey: entry.semanticKey,
      command: entry.command,
      generation: entry.generation,
      statusAfter: entry.statusAfter,
      acceptedAt: entry.acceptedAt,
      recoveryPending: entry.recoveryPending
    })),
    replayedEntries: replayedEntries.map((entry) => ({
      ledgerEntryId: entry.ledgerEntryId,
      commandId: entry.commandId,
      semanticKey: entry.semanticKey,
      command: entry.command,
      replayCount: entry.replayCount,
      lastReplayAt: entry.lastReplayAt
    }))
  };
}

function appendRecoveryJournalAttempt(journal, attempt) {
  return {
    ...journal,
    attempts: [...journal.attempts, attempt].slice(-MAX_RECOVERY_JOURNAL_ATTEMPTS)
  };
}

function applyRecoveryJournalForCommand(next, command, commandId, semanticKey, now) {
  const selectedCheckpoint = next.rollbackCursor >= 0 ? next.checkpoints[next.rollbackCursor] : null;
  const pendingOperation = ["execute", "recover"].includes(command)
    ? {
        command,
        commandId,
        semanticKey,
        startedAt: now,
        checkpointId: selectedCheckpoint?.checkpointId || null,
        rollbackCursor: next.rollbackCursor,
        generation: next.generation
      }
    : null;
  const attempt = ["execute", "recover"].includes(command)
    ? normalizeRecoveryJournalAttempt({
        attemptId: `${command}:${next.generation}`,
        commandId,
        semanticKey,
        command,
        startedAt: now,
        status: "started",
        checkpointId: selectedCheckpoint?.checkpointId || null,
        rollbackCursor: next.rollbackCursor,
        generation: next.generation
      }, next.recoveryJournal.attempts.length, now)
    : null;

  if (pendingOperation) {
    next.recoveryJournal = appendRecoveryJournalAttempt({
      ...next.recoveryJournal,
      pendingOperation,
      lastStableGeneration: Math.max(0, next.generation - 1),
      lastStableStatus: "prepared"
    }, attempt);
  } else if (command === "mark_recovered") {
    next.recoveryJournal = appendRecoveryJournalAttempt({
      ...next.recoveryJournal,
      pendingOperation: null,
      lastStableGeneration: next.generation,
      lastStableStatus: next.status
    }, normalizeRecoveryJournalAttempt({
      attemptId: `completed:${next.generation}`,
      commandId,
      semanticKey,
      command,
      startedAt: now,
      completedAt: now,
      status: "completed",
      checkpointId: selectedCheckpoint?.checkpointId || null,
      rollbackCursor: next.rollbackCursor,
      generation: next.generation
    }, next.recoveryJournal.attempts.length, now));
  } else if (command === "fail") {
    next.recoveryJournal = {
      ...next.recoveryJournal,
      pendingOperation: null,
      lastStableGeneration: next.generation,
      lastStableStatus: "failed"
    };
  } else if (!["shape"].includes(command)) {
    next.recoveryJournal = {
      ...next.recoveryJournal,
      lastStableGeneration: next.generation,
      lastStableStatus: next.status
    };
  }
}

function validateLifecycleCommand(state, command, now) {
  const settings = state.lifecycleSettings || normalizeLifecycleSettings({}, now);
  const checkpointSafety = deriveCheckpointSafetyWindow(state, now);
  const violations = [];

  if (!settings.enabled && MUTATING_RECOVERY_COMMANDS.has(command)) violations.push("rollback_plan_disabled");
  if (settings.validationErrors.length > 0 && ["prepare", "execute", "recover"].includes(command)) {
    violations.push("lifecycle_settings_invalid");
  }
  if (settings.requireVerifiedCheckpoint && ["execute", "mark_recovered"].includes(command)) {
    const checkpoint = state.rollbackCursor >= 0 ? state.checkpoints[state.rollbackCursor] : null;
    if (!checkpoint || checkpoint.verified !== true) violations.push("verified_checkpoint_required");
  }
  if (settings.schedule.enabled && settings.schedule.nextRunAt && command === "execute") {
    const dueAt = new Date(settings.schedule.nextRunAt).getTime();
    const nowMs = new Date(now).getTime();
    if (!Number.isNaN(dueAt) && !Number.isNaN(nowMs) && nowMs < dueAt) violations.push("scheduled_execution_not_due");
  }
  if (CHECKPOINT_SAFETY_COMMANDS.has(command) && checkpointSafety.eligible !== true) {
    violations.push(...checkpointSafety.blockingReasons);
  }

  return {
    accepted: violations.length === 0,
    violations: [...new Set(violations)],
    settingsVersion: "rollback-plan.lifecycle-settings.v1",
    checkpointSafety
  };
}

function deriveLifecycleNextAction(state, operationalHealth, checkpointSafety = null) {
  const settings = state.lifecycleSettings;
  const latestCheckpoint = state.rollbackCursor >= 0 ? state.checkpoints[state.rollbackCursor] : null;

  if (!settings.enabled) return "enable_rollback_plan";
  if (settings.validationErrors.length > 0) return "fix_lifecycle_settings";
  if (!latestCheckpoint) return "record_checkpoint";
  if (settings.requireVerifiedCheckpoint && latestCheckpoint.verified !== true) return "verify_checkpoint";
  if (checkpointSafety && checkpointSafety.eligible !== true) return "select_safe_checkpoint";
  if (state.status === "draft") return "prepare_rollback";
  if (state.status === "prepared") return settings.schedule.enabled ? "wait_for_schedule_or_execute" : "execute_rollback";
  if (state.status === "executing") return "recover_from_checkpoint";
  if (state.status === "recovering") return "mark_recovered_after_validation";
  if (state.status === "needs_recovery") return "recover_from_checkpoint";
  if (operationalHealth.failureState?.state === "escalated") return "recover_from_checkpoint";
  if (operationalHealth.errors.length > 0) return "resolve_operational_errors";
  return TERMINAL_STATUSES.has(state.status) ? "none" : "monitor";
}

function applyCommand(state, commandInput, now, boundaryContext) {
  const requestedCommand = asNonEmptyString(commandInput.command, "shape");
  const command = VALID_COMMANDS.has(requestedCommand) ? requestedCommand : "shape";
  const commandId = asNonEmptyString(commandInput.commandId, `${command}:${state.generation + 1}`);
  const semanticKey = commandSemanticKey(command, commandInput, state);
  const audit = [];
  const actor = boundaryContext.actor;
  const scope = boundaryContext.scope;
  const boundary = validateCommandBoundary(state, command, actor, scope);

  if (!boundary.accepted) {
    return {
      state,
      command,
      commandId,
      idempotent: false,
      rejected: true,
      boundary,
      payloadScope: deriveCommandPayloadScopeReport(command, commandInput, actor, scope),
      audit: [
        makeAuditEntry("boundary.command_rejected", now, {
          command,
          commandId,
          semanticKey,
          actorId: actor.actorId,
          actorRole: actor.role,
          tenantId: boundary.tenantId,
          workspaceId: boundary.workspaceId,
          violations: boundary.violations
        })
      ]
    };
  }

  const payloadScope = deriveCommandPayloadScopeReport(command, commandInput, actor, scope);
  if (!payloadScope.clean) {
    return {
      state,
      command,
      commandId,
      idempotent: false,
      rejected: true,
      rejectionKind: "payload_scope",
      boundary,
      payloadScope,
      audit: [
        makeAuditEntry("boundary.payload_scope_rejected", now, {
          command,
          commandId,
          semanticKey,
          actorId: actor.actorId,
          actorRole: actor.role,
          tenantId: payloadScope.tenantId,
          workspaceId: payloadScope.workspaceId,
          boundaryMode: payloadScope.boundaryMode,
          violations: payloadScope.violations,
          scopedResources: payloadScope.scopedResources
        })
      ]
    };
  }

  const idempotencyDecision = deriveIdempotencyDecision(state, command, commandId, semanticKey, now);
  if (idempotencyDecision.state === "conflict") {
    return {
      state,
      command,
      commandId,
      idempotent: false,
      semanticKey,
      rejected: true,
      rejectionKind: "idempotency_conflict",
      boundary,
      payloadScope,
      idempotencyDecision,
      audit: [
        makeAuditEntry("command.idempotency_conflict", now, {
          command,
          commandId,
          semanticKey,
          matchedCommandId: idempotencyDecision.matchedCommandId,
          matchedSemanticKey: idempotencyDecision.matchedSemanticKey,
          matchedGeneration: idempotencyDecision.matchedGeneration,
          conflictReasons: idempotencyDecision.conflictReasons
        })
      ]
    };
  }

  if (idempotencyDecision.replay) {
    const replayState = {
      ...state,
      idempotencyLedger: markIdempotentReplay(state, idempotencyDecision, now)
    };
    return {
      state: replayState,
      command,
      commandId,
      idempotent: true,
      originalGeneration: idempotencyDecision.matchedGeneration,
      originalCommandId: idempotencyDecision.matchedCommandId,
      semanticKey,
      rejected: false,
      boundary,
      payloadScope,
      idempotencyDecision,
      audit: [makeAuditEntry("command.idempotent_replay", now, {
        command,
        commandId,
        semanticKey,
        originalCommandId: idempotencyDecision.matchedCommandId,
        originalGeneration: idempotencyDecision.matchedGeneration,
        originalStatusAfter: idempotencyDecision.matchedStatusAfter
      })]
    };
  }

  const lifecycleValidation = validateLifecycleCommand(state, command, now);
  if (!lifecycleValidation.accepted) {
    return {
      state,
      command,
      commandId,
      idempotent: false,
      rejected: true,
      rejectionKind: "lifecycle",
      boundary,
      lifecycleValidation,
      payloadScope,
      idempotencyDecision,
      audit: [
        makeAuditEntry("lifecycle.command_rejected", now, {
          command,
          commandId,
          semanticKey,
          violations: lifecycleValidation.violations,
          settingsVersion: lifecycleValidation.settingsVersion
        })
      ]
    };
  }

  const next = {
    ...state,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    commandLog: [...state.commandLog],
    checkpoints: [...state.checkpoints],
    lifecycleSettings: {
      ...state.lifecycleSettings,
      schedule: { ...state.lifecycleSettings.schedule },
      validationErrors: [...state.lifecycleSettings.validationErrors]
    },
    historySnapshots: [...state.historySnapshots],
    idempotencyLedger: [...state.idempotencyLedger],
    recoveryJournal: {
      ...state.recoveryJournal,
      pendingOperation: state.recoveryJournal.pendingOperation ? { ...state.recoveryJournal.pendingOperation } : null,
      attempts: [...state.recoveryJournal.attempts]
    },
    generation: state.generation + 1,
    updatedAt: now
  };

  if (command === "create") {
    next.status = "draft";
    next.lastError = null;
    audit.push(makeAuditEntry("plan.created", now, { planId: next.planId }));
  } else if (command === "checkpoint") {
    const rawCheckpoint = commandInput.checkpoint && typeof commandInput.checkpoint === "object"
      ? {
          ...commandInput.checkpoint,
          tenantId: boundary.tenantId,
          workspaceId: boundary.workspaceId
        }
      : commandInput.checkpoint;
    const checkpoint = normalizeCheckpoint(rawCheckpoint, next.checkpoints.length, now, {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId
    });
    next.checkpoints.push(checkpoint);
    next.rollbackCursor = next.checkpoints.length - 1;
    next.status = next.status === "needs_recovery" ? "recovering" : next.status;
    audit.push(makeAuditEntry("checkpoint.recorded", now, { checkpointId: checkpoint.checkpointId }));
  } else if (command === "update_settings") {
    next.lifecycleSettings = normalizeLifecycleSettings({
      ...next.lifecycleSettings,
      ...(commandInput.settings && typeof commandInput.settings === "object" ? commandInput.settings : {})
    }, now);
    audit.push(makeAuditEntry("lifecycle.settings_updated", now, {
      enabled: next.lifecycleSettings.enabled,
      validationErrors: next.lifecycleSettings.validationErrors
    }));
  } else if (command === "enable") {
    next.lifecycleSettings = normalizeLifecycleSettings({ ...next.lifecycleSettings, enabled: true }, now);
    audit.push(makeAuditEntry("lifecycle.enabled", now, { scheduleEnabled: next.lifecycleSettings.schedule.enabled }));
  } else if (command === "disable") {
    next.lifecycleSettings = normalizeLifecycleSettings({ ...next.lifecycleSettings, enabled: false }, now);
    audit.push(makeAuditEntry("lifecycle.disabled", now, { status: next.status }));
  } else if (command === "schedule") {
    next.lifecycleSettings = normalizeLifecycleSettings({
      ...next.lifecycleSettings,
      schedule: {
        ...next.lifecycleSettings.schedule,
        ...(commandInput.schedule && typeof commandInput.schedule === "object" ? commandInput.schedule : {})
      }
    }, now);
    audit.push(makeAuditEntry("lifecycle.schedule_updated", now, {
      enabled: next.lifecycleSettings.schedule.enabled,
      cadence: next.lifecycleSettings.schedule.cadence,
      nextRunAt: next.lifecycleSettings.schedule.nextRunAt,
      validationErrors: next.lifecycleSettings.validationErrors
    }));
  } else if (command === "prepare") {
    next.status = next.checkpoints.length > 0 ? "prepared" : "needs_recovery";
    audit.push(makeAuditEntry("plan.prepared", now, { checkpointCount: next.checkpoints.length }));
  } else if (command === "execute") {
    next.status = next.checkpoints.length > 0 ? "executing" : "needs_recovery";
    audit.push(makeAuditEntry("rollback.execution_started", now, { rollbackCursor: next.rollbackCursor }));
  } else if (command === "recover") {
    next.status = next.rollbackCursor >= 0 ? "recovering" : "needs_recovery";
    audit.push(makeAuditEntry("recovery.path_selected", now, { rollbackCursor: next.rollbackCursor }));
  } else if (command === "mark_recovered") {
    next.status = "recovered";
    next.lastError = null;
    audit.push(makeAuditEntry("recovery.completed", now, { checkpointCount: next.checkpoints.length }));
  } else if (command === "fail") {
    next.status = "failed";
    next.lastError = asNonEmptyString(commandInput.reason, "rollback_plan_failed");
    audit.push(makeAuditEntry("plan.failed", now, { reason: next.lastError }));
  } else {
    audit.push(makeAuditEntry("state.shaped", now, { status: next.status }));
  }

  applyRecoveryJournalForCommand(next, command, commandId, semanticKey, now);
  recordIdempotencyLedgerEntry(next, { command, commandId, semanticKey, now, actor, boundary });

  next.commandLog.push({
    commandId,
    command,
    semanticKey,
    appliedAt: now,
    generation: next.generation,
    statusAfter: next.status,
    recoveryPending: next.recoveryJournal.pendingOperation !== null,
    actorId: actor.actorId,
    actorRole: actor.role,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId
  });

  return {
    state: next,
    command,
    commandId,
    idempotent: false,
    semanticKey,
    rejected: false,
    boundary,
    payloadScope,
    idempotencyDecision,
    audit
  };
}

export function describeRollbackPlanSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const persistedState = normalizePersistedState(input.persistedState, now);
  const actor = normalizeActor(input, persistedState);
  const scope = normalizeWorkspaceScope(input, persistedState);
  const commandResult = applyCommand(persistedState, input, now, { actor, scope });
  const restartSafeStatus = deriveRestartSafeStatus(commandResult.state);
  const checkpointSafety = commandResult.lifecycleValidation?.checkpointSafety
    || deriveCheckpointSafetyWindow(commandResult.state, now);
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const auditHandoff = normalizeAuditHandoff(input, commandResult.state, commandResult.boundary);
  const providerContracts = normalizeProviderContracts(input, commandResult.state, auditHandoff, now);
  const providerNegotiation = negotiateProviderCapabilities(providerContracts, commandResult.command);
  const providerReadiness = deriveProviderOperationalReadiness(providerContracts, commandResult.command, now);
  const retryPolicy = normalizeRetryPolicy(input);
  const failurePolicy = normalizeFailurePolicy(input);
  const integrationHealth = normalizeIntegrationHealth(input);
  const operationalHealth = deriveOperationalHealth({
    state: commandResult.state,
    commandResult,
    restartSafeStatus,
    auditHandoff,
    integrationHealth,
    providerNegotiation,
    providerReadiness,
    retryPolicy,
    failurePolicy,
    checkpointSafety,
    now
  });
  const lifecycleControls = deriveLifecycleControls({
    state: commandResult.state,
    operationalHealth,
    checkpointSafety,
    now
  });
  const clientRuntime = normalizeClientRuntimeState(input, commandResult.state, actor, scope, now);
  const workflowHandoff = deriveWorkflowHandoff({
    state: commandResult.state,
    actor,
    clientRuntime,
    lifecycleControls,
    restartSafeStatus,
    operationalHealth,
    checkpointSafety,
    auditHandoff,
    providerContracts,
    providerNegotiation,
    now
  });
  const clientPreview = deriveClientPreviewContract({
    state: commandResult.state,
    commandResult,
    actor,
    clientRuntime,
    lifecycleControls,
    restartSafeStatus,
    operationalHealth,
    checkpointSafety,
    providerNegotiation,
    providerReadiness,
    workflowHandoff,
    input,
    now
  });
  const clientPreviewRouteContract = deriveClientPreviewRouteContract({
    state: commandResult.state,
    actor,
    clientRuntime,
    clientPreview,
    workflowHandoff,
    auditHandoff,
    providerReadiness,
    now
  });
  const audit = [
    ...commandResult.audit,
    makeAuditEntry("rollback_plan.actor_permission_evaluated", now, {
      actorId: actor.actorId,
      actorRole: actor.role,
      command: commandResult.command,
      accepted: commandResult.boundary.permissionDecision.accepted,
      source: commandResult.boundary.permissionDecision.source,
      delegatedCommands: commandResult.boundary.permissionDecision.delegatedCommands,
      invalidDelegatedPermissions: commandResult.boundary.permissionDecision.invalidDelegatedPermissions
    }),
    makeAuditEntry("rollback_plan.workspace_isolation_evaluated", now, {
      tenantId: commandResult.boundary.isolationReport.tenantId,
      workspaceId: commandResult.boundary.isolationReport.workspaceId,
      boundaryMode: commandResult.boundary.isolationReport.boundaryMode,
      clean: commandResult.boundary.isolationReport.clean,
      violations: commandResult.boundary.isolationReport.violations,
      selectedCheckpointId: commandResult.boundary.isolationReport.selectedCheckpointId,
      selectedCheckpointAllowed: commandResult.boundary.isolationReport.selectedCheckpointAllowed,
      pendingOperationAllowed: commandResult.boundary.isolationReport.pendingOperationAllowed,
      foreignCheckpointCount: commandResult.boundary.isolationReport.foreignCheckpointCount,
      foreignCommandLogCount: commandResult.boundary.isolationReport.foreignCommandLogCount
    }),
    makeAuditEntry("rollback_plan.command_payload_scope_evaluated", now, {
      command: commandResult.command,
      tenantId: commandResult.payloadScope?.tenantId || commandResult.boundary.tenantId,
      workspaceId: commandResult.payloadScope?.workspaceId || commandResult.boundary.workspaceId,
      boundaryMode: commandResult.payloadScope?.boundaryMode || scope.boundaryMode,
      clean: commandResult.payloadScope?.clean !== false,
      violations: commandResult.payloadScope?.violations || [],
      resourceCount: commandResult.payloadScope?.resourceCount || 0,
      scopedResources: commandResult.payloadScope?.scopedResources || []
    }),
    makeAuditEntry("rollback_plan.idempotency_evaluated", now, {
      command: commandResult.command,
      commandId: commandResult.commandId,
      semanticKey: commandResult.semanticKey || null,
      decision: commandResult.idempotencyDecision?.state || "not_evaluated",
      replay: commandResult.idempotent === true,
      conflict: commandResult.rejectionKind === "idempotency_conflict",
      matchedCommandId: commandResult.idempotencyDecision?.matchedCommandId || null,
      matchedGeneration: commandResult.idempotencyDecision?.matchedGeneration ?? null,
      conflictReasons: commandResult.idempotencyDecision?.conflictReasons || []
    }),
    makeAuditEntry("rollback_plan.lifecycle_controls_evaluated", now, {
      enabled: lifecycleControls.enabled,
      controlState: lifecycleControls.controlState,
      settingsValid: lifecycleControls.settingsValid,
      scheduleEnabled: lifecycleControls.schedule.enabled,
      scheduleDue: lifecycleControls.schedule.due,
      scheduleBlockedReasons: lifecycleControls.schedule.blockedReasons,
      nextAction: lifecycleControls.nextAction,
      nextCommand: lifecycleControls.nextCommand,
      nextCommandReady: lifecycleControls.nextCommandReady,
      nextCommandBlockedReasons: lifecycleControls.nextCommandBlockedReasons,
      commandAvailability: lifecycleControls.commandAvailability
    }),
    makeAuditEntry("rollback_plan.checkpoint_safety_window_evaluated", now, {
      eligible: checkpointSafety.eligible,
      selectedCheckpointId: checkpointSafety.selectedCheckpointId,
      selectedCheckpointAgeHours: checkpointSafety.selectedCheckpointAgeHours,
      selectedCheckpointExpiresAt: checkpointSafety.selectedCheckpointExpiresAt,
      maxRollbackAgeHours: checkpointSafety.maxRollbackAgeHours,
      blockingReasons: checkpointSafety.blockingReasons,
      eligibleCheckpointCount: checkpointSafety.eligibleCheckpointIds.length,
      expiredCheckpointCount: checkpointSafety.expiredCheckpointIds.length
    }),
    makeAuditEntry("rollback_plan.operational_health_evaluated", now, {
      healthState: operationalHealth.state,
      mode: operationalHealth.mode,
      errorCount: operationalHealth.errors.length,
      warningCount: operationalHealth.warnings.length,
      retryable: operationalHealth.retry.retryable,
      failureState: operationalHealth.failureState.state,
      failureEscalationReasons: operationalHealth.failureState.escalationReasons,
      failureNextCommand: operationalHealth.failureState.nextCommand
    }),
    makeAuditEntry("rollback_plan.failure_state_evaluated", now, {
      state: operationalHealth.failureState.state,
      strategy: operationalHealth.failureState.strategy,
      retryBudgetExhausted: operationalHealth.failureState.retryBudgetExhausted,
      consecutiveFailureLimitReached: operationalHealth.failureState.consecutiveFailureLimitReached,
      stalePendingOperation: operationalHealth.failureState.stalePendingOperation,
      degradedRetryAllowed: operationalHealth.failureState.degradedRetryAllowed,
      retryAfterAt: operationalHealth.failureState.retryAfterAt,
      latestAttemptId: operationalHealth.failureState.latestAttemptId,
      latestAttemptAgeMinutes: operationalHealth.failureState.latestAttemptAgeMinutes,
      escalationReasons: operationalHealth.failureState.escalationReasons,
      operatorAction: operationalHealth.failureState.operatorAction
    }),
    makeAuditEntry("rollback_plan.provider_capabilities_negotiated", now, {
      command: providerNegotiation.command,
      accepted: providerNegotiation.accepted,
      missingCapabilities: providerNegotiation.missingCapabilities,
      offlineServices: providerNegotiation.offlineServices,
      externalHandoffState: providerNegotiation.externalHandoffState,
      externalHandoffClaimable: providerNegotiation.externalHandoffClaimable,
      externalHandoffPendingCount: providerNegotiation.externalHandoffPendingCount,
      externalHandoffFailedCount: providerNegotiation.externalHandoffFailedCount,
      syncDirty: providerNegotiation.syncDirty
    }),
    makeAuditEntry("rollback_plan.provider_operational_readiness_evaluated", now, {
      command: providerReadiness.command,
      state: providerReadiness.state,
      requiredServices: providerReadiness.requiredServices,
      blockingServices: providerReadiness.blockingServices,
      degradedServices: providerReadiness.degradedServices,
      handoffBlocked: providerReadiness.handoffBlocked,
      handoffPending: providerReadiness.handoffPending,
      handoffBlockedReasons: providerReadiness.handoffBlockedReasons,
      runnableInDegradedMode: providerReadiness.runnableInDegradedMode,
      retryable: providerReadiness.retryable,
      action: providerReadiness.action
    }),
    makeAuditEntry("rollback_plan.workflow_handoff_evaluated", now, {
      handoffId: workflowHandoff.handoffId,
      handoffState: workflowHandoff.state,
      targetRouteId: workflowHandoff.targetRouteId,
      targetCommand: workflowHandoff.targetCommand,
      claimable: workflowHandoff.claim.claimable,
      blockedReasons: workflowHandoff.claim.blockedReasons,
      clientRequestId: clientRuntime.requestId,
      clientGenerationStale: clientRuntime.stale,
      clientRequestedCommand: workflowHandoff.clientIntent.targetCommandRequested,
      clientPreviewMode: workflowHandoff.clientIntent.previewMode,
      clientMissingAcknowledgementIds: workflowHandoff.clientIntent.missingAcknowledgementIds,
      clientIntentAccepted: workflowHandoff.clientIntent.targetCommandAccepted
    }),
    makeAuditEntry("rollback_plan.client_preview_evaluated", now, {
      previewId: clientPreview.previewId,
      routeId: clientPreview.routeId,
      readinessState: clientPreview.readiness.state,
      ready: clientPreview.readiness.ready,
      acceptanceRequired: clientPreview.readiness.acceptanceRequired,
      acceptanceSatisfied: clientPreview.readiness.acceptanceSatisfied,
      acceptedGeneration: clientPreview.acceptance.acceptedGeneration,
      validationStatus: clientPreview.validationSummary.status,
      blockedCount: clientPreview.validationSummary.blockedCount,
      blockingReasonCodes: clientPreview.validationSummary.blockingReasonCodes,
      nextStepCommand: clientPreview.nextStep.command,
      nextStepRouteId: clientPreview.nextStep.routeId
    }),
    makeAuditEntry("rollback_plan.client_preview_route_contract_prepared", now, {
      previewId: clientPreviewRouteContract.previewId,
      routeId: clientPreviewRouteContract.routeId,
      targetRouteId: clientPreviewRouteContract.targetRouteId,
      readinessState: clientPreviewRouteContract.readinessState,
      ready: clientPreviewRouteContract.ready,
      acceptanceRequired: clientPreviewRouteContract.acceptanceRequired,
      acceptanceSatisfied: clientPreviewRouteContract.acceptanceSatisfied,
      validationStatus: clientPreviewRouteContract.validationStatus,
      actionCount: clientPreviewRouteContract.actions.length,
      enabledActionIds: clientPreviewRouteContract.actions
        .filter((action) => action.enabled)
        .map((action) => action.actionId),
      blockedReasonCodes: clientPreviewRouteContract.blockedReasonCodes,
      previewFingerprint: clientPreviewRouteContract.fingerprints.preview,
      submitPayloadFingerprint: clientPreviewRouteContract.fingerprints.submitPayload,
      acceptancePayloadFingerprint: clientPreviewRouteContract.fingerprints.acceptancePayload
    }),
    makeAuditEntry("rollback_plan.recovery_journal_evaluated", now, {
      lastStableGeneration: commandResult.state.recoveryJournal.lastStableGeneration,
      lastStableStatus: commandResult.state.recoveryJournal.lastStableStatus,
      pendingOperation: commandResult.state.recoveryJournal.pendingOperation?.command || null,
      pendingCheckpointId: commandResult.state.recoveryJournal.pendingOperation?.checkpointId || null,
      attemptCount: commandResult.state.recoveryJournal.attempts.length,
      restartAction: restartSafeStatus.recoveryAction
    })
  ];
  const historySnapshots = deriveHistorySnapshots({
    state: commandResult.state,
    now,
    commandResult,
    operationalHealth,
    restartSafeStatus,
    auditEventCount: audit.length + evidence.length
  });
  const reportingState = {
    ...commandResult.state,
    historySnapshots
  };
  const commandTransitionReport = deriveCommandTransitionReport(reportingState, commandResult, now);
  const idempotencyLedgerReport = deriveIdempotencyLedgerReport(reportingState, commandResult, now);
  const historyTrendReport = deriveHistoryTrendReport(historySnapshots, now);
  const analytics = deriveAnalyticsCounters({
    state: reportingState,
    commandResult,
    operationalHealth,
    checkpointSafety,
    evidence,
    commandTransitionReport,
    historyTrendReport
  });
  const timeline = deriveTimelineEvents({
    state: reportingState,
    audit,
    historySnapshots,
    restartSafeStatus
  });
  const timelineReportState = deriveTimelineReportState(timeline, restartSafeStatus, operationalHealth);
  const reportingRetentionState = deriveReportingRetentionState({
    historySnapshots,
    timeline,
    commandLog: reportingState.commandLog,
    now
  });
  const reportDatasetCatalog = deriveReportDatasetCatalog({
    state: reportingState,
    analytics,
    historySnapshots,
    timeline,
    commandTransitionReport,
    idempotencyLedgerReport,
    operationalHealth,
    providerReadiness,
    reportingRetentionState,
    now
  });
  const exportSummary = {
    ...deriveExportSummary({
      state: reportingState,
      generatedAt: now,
      analytics,
      historySnapshots,
      historyTrendReport,
      timeline,
      timelineReportState,
      commandTransitionReport,
      operationalHealth,
      auditHandoff,
      providerNegotiation,
      providerReadiness,
      checkpointSafety,
      reportDatasetCatalog,
      reportingRetentionState
    }),
    clientRuntime: {
      requestId: clientRuntime.requestId,
      clientId: clientRuntime.clientId,
      routeId: clientRuntime.routeId,
      stale: clientRuntime.stale,
      knownGeneration: clientRuntime.knownGeneration,
      currentGeneration: clientRuntime.currentGeneration,
      handoffIntent: clientRuntime.handoffIntent
    },
    workflowHandoff: {
      handoffId: workflowHandoff.handoffId,
      state: workflowHandoff.state,
      targetRouteId: workflowHandoff.targetRouteId,
      targetCommand: workflowHandoff.targetCommand,
      claimable: workflowHandoff.claim.claimable,
      blockedReasons: workflowHandoff.claim.blockedReasons,
      clientIntent: workflowHandoff.clientIntent
    },
    clientPreview: {
      previewId: clientPreview.previewId,
      readinessState: clientPreview.readiness.state,
      ready: clientPreview.readiness.ready,
      acceptanceRequired: clientPreview.readiness.acceptanceRequired,
      acceptanceSatisfied: clientPreview.readiness.acceptanceSatisfied,
      validationStatus: clientPreview.validationSummary.status,
      blockingReasonCodes: clientPreview.validationSummary.blockingReasonCodes,
      nextStepCommand: clientPreview.nextStep.command,
      nextStepRouteId: clientPreview.nextStep.routeId,
      routeContract: {
        contractType: clientPreviewRouteContract.contractType,
        readinessState: clientPreviewRouteContract.readinessState,
        enabledActionIds: clientPreviewRouteContract.actions
          .filter((action) => action.enabled)
          .map((action) => action.actionId),
        blockedReasonCodes: clientPreviewRouteContract.blockedReasonCodes,
        previewFingerprint: clientPreviewRouteContract.fingerprints.preview
      }
    },
    idempotency: {
      ledgerSize: idempotencyLedgerReport.ledgerSize,
      pendingEntryCount: idempotencyLedgerReport.pendingEntryCount,
      replayedEntryCount: idempotencyLedgerReport.replayedEntryCount,
      currentDecision: idempotencyLedgerReport.currentDecision
    }
  };

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      version: 1,
      command: "rollback-plan.command.v1",
      persistedState: "rollback-plan.persisted-state.v1",
      proof: "rollback-plan.audit-proof.v1",
      workspaceBoundary: "rollback-plan.workspace-boundary.v1",
      commandPayloadScopeReport: "rollback-plan.command-payload-scope-report.v1",
      auditHandoff: "rollback-plan.audit-handoff.v1",
      operationalHealth: "rollback-plan.operational-health.v1",
      failurePolicy: "rollback-plan.failure-policy.v1",
      failureState: "rollback-plan.failure-state.v1",
      lifecycleSettings: "rollback-plan.lifecycle-settings.v1",
      lifecycleControls: "rollback-plan.lifecycle-controls.v1",
      scheduleControlState: "rollback-plan.schedule-control-state.v1",
      lifecycleCommandMatrix: "rollback-plan.lifecycle-command-matrix.v1",
      recoveryJournal: "rollback-plan.recovery-journal.v1",
      checkpointSafetyWindow: "rollback-plan.checkpoint-safety-window.v1",
      actionableError: "rollback-plan.actionable-error.v1",
      actorPermissionDecision: "rollback-plan.actor-permission-decision.v1",
      workspaceIsolationReport: "rollback-plan.workspace-isolation-report.v1",
      analytics: "rollback-plan.analytics.v1",
      historySnapshot: "rollback-plan.history-snapshot.v1",
      historyTrendReport: "rollback-plan.history-trend-report.v1",
      timeline: "rollback-plan.timeline.v1",
      timelineReportState: "rollback-plan.timeline-report-state.v1",
      commandTransitionReport: "rollback-plan.command-transition-report.v1",
      exportSummary: "rollback-plan.analytics-export.v1",
      reportDatasetCatalog: "rollback-plan.report-dataset-catalog.v1",
      reportingRetentionState: "rollback-plan.reporting-retention-state.v1",
      providerContracts: "rollback-plan.provider-contracts.v1",
      externalHandoffState: "rollback-plan.external-handoff-state.v1",
      capabilityNegotiation: "rollback-plan.capability-negotiation.v1",
      providerOperationalReadiness: "rollback-plan.provider-operational-readiness.v1",
      clientRuntimeState: "rollback-plan.client-runtime-state.v1",
      workflowHandoff: "rollback-plan.workflow-handoff.v1",
      clientHandoffIntent: "rollback-plan.client-handoff-intent.v1",
      clientPreview: "rollback-plan.client-preview.v1",
      clientReadiness: "rollback-plan.client-readiness.v1",
      clientPreviewRouteContract: "rollback-plan.client-preview-route-contract.v1",
      routeSubmitPayload: "rollback-plan.route-submit-payload.v1",
      routePreviewAcceptancePayload: "rollback-plan.route-preview-acceptance-payload.v1",
      previewAcceptance: "rollback-plan.preview-acceptance.v1",
      validationSummary: "rollback-plan.validation-summary.v1",
      explainableNextStep: "rollback-plan.explainable-next-step.v1",
      idempotencyLedger: "rollback-plan.idempotency-ledger.v1",
      idempotencyDecision: "rollback-plan.idempotency-decision.v1",
      idempotencyLedgerReport: "rollback-plan.idempotency-ledger-report.v1"
    },
    command: {
      commandId: commandResult.commandId,
      name: commandResult.command,
      semanticKey: commandResult.semanticKey || null,
      idempotent: commandResult.idempotent,
      idempotencyDecision: commandResult.idempotencyDecision || null,
      originalCommandId: commandResult.originalCommandId || null,
      originalGeneration: commandResult.originalGeneration ?? null,
      accepted: commandResult.rejected !== true
    },
    actor,
    workspaceBoundary: {
      ...commandResult.boundary,
      boundaryMode: scope.boundaryMode,
      allowedTenantIds: scope.allowedTenantIds,
      allowedWorkspaceIds: scope.allowedWorkspaceIds,
      enforcedForCommand: BOUNDARY_ENFORCED_COMMANDS.has(commandResult.command),
      payloadScope: commandResult.payloadScope
    },
    persistedState: {
      ...reportingState,
      restartSafeStatus
    },
    lifecycle: {
      settings: reportingState.lifecycleSettings,
      controls: lifecycleControls,
      checkpointSafety
    },
    recovery: {
      required: restartSafeStatus.status === "needs_recovery",
      status: restartSafeStatus.status,
      reason: restartSafeStatus.reason,
      restartAction: restartSafeStatus.recoveryAction,
      action: lifecycleControls.nextAction,
      checkpoint:
        commandResult.state.rollbackCursor >= 0
          ? commandResult.state.checkpoints[commandResult.state.rollbackCursor]
          : null,
      checkpointSafety,
      journal: reportingState.recoveryJournal,
      pendingOperation: restartSafeStatus.pendingOperation
    },
    operationalHealth,
    failurePolicy,
    integration: {
      providerContracts,
      capabilityNegotiation: providerNegotiation,
      providerReadiness,
      syncMetadata: providerContracts.syncMetadata,
      externalHandoff: providerContracts.externalHandoff,
      workflowHandoff
    },
    clientRuntime,
    preview: {
      ...clientPreview,
      routeContract: clientPreviewRouteContract
    },
    reporting: {
      analytics,
      historySnapshots,
      historyTrendReport,
      timeline,
      timelineReportState,
      commandTransitionReport,
      idempotencyLedgerReport,
      reportDatasetCatalog,
      reportingRetentionState,
      exportSummary
    },
    proof: {
      surfaceId,
      planId: commandResult.state.planId,
      generation: commandResult.state.generation,
      status: commandResult.state.status,
      restartSafeStatus: restartSafeStatus.status,
      healthState: operationalHealth.state,
      degradedMode: operationalHealth.degraded,
      failureState: operationalHealth.failureState.state,
      failureStrategy: operationalHealth.failureState.strategy,
      failureRetryBudgetExhausted: operationalHealth.failureState.retryBudgetExhausted,
      failureConsecutiveLimitReached: operationalHealth.failureState.consecutiveFailureLimitReached,
      failureStalePendingOperation: operationalHealth.failureState.stalePendingOperation,
      failureDegradedRetryAllowed: operationalHealth.failureState.degradedRetryAllowed,
      failureEscalationReasons: operationalHealth.failureState.escalationReasons,
      failureRetryAfterAt: operationalHealth.failureState.retryAfterAt,
      failureNextCommand: operationalHealth.failureState.nextCommand,
      lifecycleEnabled: lifecycleControls.enabled,
      lifecycleSettingsValid: lifecycleControls.settingsValid,
      lifecycleControlState: lifecycleControls.controlState,
      lifecycleNextAction: lifecycleControls.nextAction,
      lifecycleNextCommand: lifecycleControls.nextCommand,
      lifecycleNextCommandReady: lifecycleControls.nextCommandReady,
      lifecycleNextCommandBlockedReasons: lifecycleControls.nextCommandBlockedReasons,
      lifecycleOperatorApprovalRequired: lifecycleControls.operatorApprovalRequired,
      scheduleDue: lifecycleControls.schedule.due,
      scheduleBlockedReasons: lifecycleControls.schedule.blockedReasons,
      checkpointSafetyEligible: checkpointSafety.eligible,
      checkpointSafetyBlockingReasons: checkpointSafety.blockingReasons,
      selectedCheckpointAgeHours: checkpointSafety.selectedCheckpointAgeHours,
      selectedCheckpointExpiresAt: checkpointSafety.selectedCheckpointExpiresAt,
      expiredCheckpointCount: checkpointSafety.expiredCheckpointIds.length,
      eligibleCheckpointCount: checkpointSafety.eligibleCheckpointIds.length,
      retryable: operationalHealth.retry.retryable,
      auditEventCount: audit.length + evidence.length,
      historySnapshotCount: historySnapshots.length,
      historyLatestSnapshotId: historyTrendReport.latestSnapshotId,
      historyLatestHealthState: historyTrendReport.latestHealthState,
      historyDeltaFromPrevious: historyTrendReport.deltaFromPrevious,
      timelineEventCount: timeline.length,
      timelineCommandEventCount: timelineReportState.commandEventCount,
      timelineAuditEventCount: timelineReportState.auditEventCount,
      timelineTruncated: timelineReportState.timelineTruncated,
      commandTransitionCount: commandTransitionReport.transitionCount,
      latestCommandAgeMs: commandTransitionReport.latestCommandAgeMs,
      exportType: exportSummary.exportType,
      exportReady: exportSummary.exportReadiness.ready,
      exportBlockedSections: exportSummary.exportReadiness.blockedSections,
      exportBlockedDatasetIds: exportSummary.exportReadiness.blockedDatasetIds,
      reportDatasetCount: reportDatasetCatalog.datasetCount,
      reportReadyDatasetCount: reportDatasetCatalog.readyDatasetCount,
      reportCatalogFingerprint: reportDatasetCatalog.catalogFingerprint,
      reportRetentionWarnings: reportingRetentionState.exportWarningCodes,
      historyRetentionTruncated: reportingRetentionState.history.truncated,
      timelineRetentionTruncated: reportingRetentionState.timeline.truncated,
      providerNegotiationAccepted: providerNegotiation.accepted,
      missingProviderCapabilities: providerNegotiation.missingCapabilities,
      offlineProviderServices: providerNegotiation.offlineServices,
      providerReadinessState: providerReadiness.state,
      providerReadinessBlockingServices: providerReadiness.blockingServices,
      providerReadinessDegradedServices: providerReadiness.degradedServices,
      providerReadinessAction: providerReadiness.action,
      externalHandoffState: providerNegotiation.externalHandoffState,
      externalHandoffClaimable: providerNegotiation.externalHandoffClaimable,
      externalHandoffPendingCount: providerNegotiation.externalHandoffPendingCount,
      externalHandoffFailedCount: providerNegotiation.externalHandoffFailedCount,
      externalHandoffQueueDepth: providerContracts.externalHandoff.queueDepth,
      workflowHandoffState: workflowHandoff.state,
      workflowHandoffClaimable: workflowHandoff.claim.claimable,
      workflowHandoffTargetRouteId: workflowHandoff.targetRouteId,
      workflowHandoffClientIntentValid: workflowHandoff.clientIntent.targetCommandValid,
      workflowHandoffClientIntentAccepted: workflowHandoff.clientIntent.targetCommandAccepted,
      workflowHandoffClientPreviewMode: workflowHandoff.clientIntent.previewMode,
      workflowHandoffClientMissingAcknowledgementIds: workflowHandoff.clientIntent.missingAcknowledgementIds,
      clientPreviewId: clientPreview.previewId,
      clientPreviewReadinessState: clientPreview.readiness.state,
      clientPreviewReady: clientPreview.readiness.ready,
      clientPreviewAcceptanceRequired: clientPreview.readiness.acceptanceRequired,
      clientPreviewAcceptanceSatisfied: clientPreview.readiness.acceptanceSatisfied,
      clientPreviewValidationStatus: clientPreview.validationSummary.status,
      clientPreviewBlockingReasons: clientPreview.validationSummary.blockingReasonCodes,
      clientPreviewNextStepCommand: clientPreview.nextStep.command,
      clientPreviewNextStepRouteId: clientPreview.nextStep.routeId,
      clientPreviewRouteReadinessState: clientPreviewRouteContract.readinessState,
      clientPreviewRouteEnabledActionIds: clientPreviewRouteContract.actions
        .filter((action) => action.enabled)
        .map((action) => action.actionId),
      clientPreviewRouteBlockedReasons: clientPreviewRouteContract.blockedReasonCodes,
      clientPreviewRouteFingerprint: clientPreviewRouteContract.fingerprints.preview,
      clientPreviewSubmitPayloadFingerprint: clientPreviewRouteContract.fingerprints.submitPayload,
      clientPreviewAcceptancePayloadFingerprint: clientPreviewRouteContract.fingerprints.acceptancePayload,
      clientRuntimeStale: clientRuntime.stale,
      clientRequestId: clientRuntime.requestId,
      actorPermissionSource: commandResult.boundary.permissionDecision.source,
      invalidDelegatedPermissions: commandResult.boundary.permissionDecision.invalidDelegatedPermissions,
      workspaceIsolationClean: commandResult.boundary.isolationReport.clean,
      workspaceIsolationViolations: commandResult.boundary.isolationReport.violations,
      commandPayloadScopeClean: commandResult.payloadScope?.clean !== false,
      commandPayloadScopeViolations: commandResult.payloadScope?.violations || [],
      commandPayloadScopedResourceCount: commandResult.payloadScope?.resourceCount || 0,
      foreignCheckpointCount: commandResult.boundary.isolationReport.foreignCheckpointCount,
      foreignCommandLogCount: commandResult.boundary.isolationReport.foreignCommandLogCount,
      selectedCheckpointBoundarySafe: commandResult.boundary.isolationReport.selectedCheckpointAllowed,
      pendingOperationBoundarySafe: commandResult.boundary.isolationReport.pendingOperationAllowed,
      recoveryJournalPending: reportingState.recoveryJournal.pendingOperation !== null,
      recoveryJournalAttempts: reportingState.recoveryJournal.attempts.length,
      recoveryLastStableGeneration: reportingState.recoveryJournal.lastStableGeneration,
      idempotencyLedgerEntries: idempotencyLedgerReport.ledgerSize,
      idempotencyPendingEntries: idempotencyLedgerReport.pendingEntryCount,
      idempotencyReplayedEntries: idempotencyLedgerReport.replayedEntryCount,
      idempotencyDecision: commandResult.idempotencyDecision?.state || null,
      idempotencyConflictReasons: commandResult.idempotencyDecision?.conflictReasons || [],
      restartCheckpointId: restartSafeStatus.checkpointId,
      syncDirty: providerNegotiation.syncDirty,
      idempotent: commandResult.idempotent,
      accepted: commandResult.rejected !== true,
      tenantId: commandResult.state.tenantId,
      workspaceId: commandResult.state.workspaceId,
      auditHandoffTarget: auditHandoff.target
    },
    auditHandoff,
    audit,
    evidence
  };
}

export default describeRollbackPlanSurface;
