export const surfaceId = "aios_scheduler_context-pack_057";
export const surfaceGroup = "scheduler";
export const surfaceName = "context-pack";

const DEFAULT_ROUTE = "L24_nexus+L27_forge+L20_simulator+L7_librarian_context_governor";
const DEFAULT_WAVE = "ai-os-wave1-hosted-kernel-boot-proof";
const CONTEXT_BUDGETS = Object.freeze({
  compact: 6,
  standard: 12,
  expanded: 20
});
const CHECKPOINT_SCHEMA_VERSION = 1;
const DEFAULT_COMMAND = "prepare_context_pack";
const DEFAULT_RETRY_BASE_MS = 15_000;
const DEFAULT_RETRY_MAX_MS = 5 * 60_000;
const DEFAULT_RETRY_ATTEMPT_LIMIT = 6;
const HISTORY_SNAPSHOT_LIMIT = 10;
const DEFAULT_COMMAND_LEASE_MS = 90_000;
const DEFAULT_PROVIDER_ID = "hosted-kernel-context-pack-provider";
const PROVIDER_CONTRACT_VERSION = 1;
const REQUIRED_PROVIDER_CAPABILITIES = Object.freeze([
  "context-pack.read",
  "context-pack.write",
  "audit.proof",
  "handoff.resume"
]);
const OPTIONAL_PROVIDER_CAPABILITIES = Object.freeze([
  "sync.cursor",
  "sync.delta",
  "analytics.export"
]);
const CLIENT_HANDOFF_CHANNELS = Object.freeze([
  "inline_preview",
  "resume_panel",
  "command_palette",
  "external_provider",
  "audit_receipt"
]);
const CLIENT_HANDOFF_MODES = Object.freeze(["guided", "compact", "silent"]);
const FINAL_STATUSES = new Set(["completed", "failed", "blocked"]);
const ACTIVE_STATUSES = new Set(["pending", "running", "recovering"]);
const RESERVED_PATH_SEGMENTS = new Set(["", ".", ".."]);
const ROLE_PERMISSIONS = Object.freeze({
  owner: ["context-pack:read", "context-pack:write", "context-pack:audit", "context-pack:handoff"],
  admin: ["context-pack:read", "context-pack:write", "context-pack:audit", "context-pack:handoff"],
  maintainer: ["context-pack:read", "context-pack:write", "context-pack:audit", "context-pack:handoff"],
  worker: ["context-pack:read", "context-pack:write", "context-pack:audit"],
  auditor: ["context-pack:read", "context-pack:audit"],
  viewer: ["context-pack:read"]
});
const WORKSPACE_ZONE_POLICIES = Object.freeze([
  {
    zone: "kernel_source",
    prefixes: ["packages/aios-kernel/"],
    mutability: "product_code",
    requiredPermissions: ["context-pack:read", "context-pack:write", "context-pack:audit"]
  },
  {
    zone: "package_source",
    prefixes: ["packages/"],
    mutability: "product_code",
    requiredPermissions: ["context-pack:read", "context-pack:write", "context-pack:audit"]
  },
  {
    zone: "application_source",
    prefixes: ["apps/"],
    mutability: "product_code",
    requiredPermissions: ["context-pack:read", "context-pack:write", "context-pack:audit"]
  },
  {
    zone: "workspace_configuration",
    prefixes: [".github/", ".codex/", ".agents/"],
    mutability: "configuration",
    requiredPermissions: ["context-pack:read", "context-pack:audit", "context-pack:handoff"]
  },
  {
    zone: "documentation",
    prefixes: ["docs/", "README"],
    mutability: "read_mostly",
    requiredPermissions: ["context-pack:read", "context-pack:audit"]
  }
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asTrimmedString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringList(value, limit = 8) {
  if (typeof value === "string") {
    const item = asTrimmedString(value);
    return item ? [item].slice(0, limit) : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asTrimmedString(item))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "enabled"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", "disabled"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizeKnownString(value, allowedValues, fallback) {
  const normalized = asTrimmedString(value, fallback).toLowerCase();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function classifyWorkspacePath(path) {
  const normalizedPath = asTrimmedString(path).replaceAll("\\", "/");
  const policy = WORKSPACE_ZONE_POLICIES.find((candidate) => (
    candidate.prefixes.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(prefix))
  ));

  return policy || {
    zone: "workspace_other",
    prefixes: [],
    mutability: "restricted",
    requiredPermissions: ["context-pack:read", "context-pack:audit", "context-pack:handoff"]
  };
}

function normalizeScopedPathCandidate(value) {
  const originalPath = asTrimmedString(value);
  if (!originalPath) {
    return {
      path: null,
      originalPath,
      rejected: false,
      rejectionReason: null
    };
  }

  const normalized = originalPath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const rejectionReason = normalized.startsWith("/")
    ? "absolute_path"
    : normalized.includes("\0")
      ? "nul_byte_path"
      : segments.some((segment) => RESERVED_PATH_SEGMENTS.has(segment))
        ? "reserved_path_segment"
        : null;

  return {
    path: rejectionReason ? null : normalized,
    originalPath,
    rejected: Boolean(rejectionReason),
    rejectionReason
  };
}

function buildWorkspaceScopePolicy(request, permissionSet) {
  const allowedSet = new Set(request.allowedFiles);
  const assignedPolicies = request.assignedFiles.map((file) => ({ file, policy: classifyWorkspacePath(file) }));
  const assignedZones = new Set(assignedPolicies.map((entry) => entry.policy.zone));
  const handoffRequired = request.handoffRequired || assignedZones.size > 1;
  const assignedEntries = assignedPolicies.map(({ file, policy }) => {
    const missingPermissions = policy.requiredPermissions.filter((permission) => !permissionSet.has(permission));
    const requiresHandoff = handoffRequired && !permissionSet.has("context-pack:handoff");
    const inAllowedScope = allowedSet.has(file);
    const writable = inAllowedScope
      && policy.mutability === "product_code"
      && missingPermissions.length === 0
      && !requiresHandoff;
    const denialReasons = [
      inAllowedScope ? null : "outside_allowed_scope",
      policy.mutability === "read_mostly" ? "read_mostly_workspace_zone" : null,
      policy.mutability === "restricted" ? "restricted_workspace_zone" : null,
      missingPermissions.length ? `missing_zone_permissions:${missingPermissions.join(",")}` : null,
      requiresHandoff ? "handoff_permission_required" : null
    ].filter(Boolean);

    return {
      path: file,
      zone: policy.zone,
      mutability: policy.mutability,
      inAllowedScope,
      writable,
      requiredPermissions: policy.requiredPermissions,
      missingPermissions,
      denialReasons
    };
  });
  const deniedEntries = assignedEntries.filter((entry) => !entry.writable);
  const zoneCounts = assignedEntries.reduce((counts, entry) => {
    counts[entry.zone] = (counts[entry.zone] || 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.workspace_scope_policy.v1",
    handoffRequired,
    assignedEntries,
    deniedEntries,
    deniedTargets: deniedEntries.map((entry) => entry.path),
    writableTargets: assignedEntries.filter((entry) => entry.writable).map((entry) => entry.path),
    zoneCounts,
    denialCodes: Array.from(new Set(deniedEntries.flatMap((entry) => entry.denialReasons))).slice(0, 12)
  };
}

function normalizeScopedFileList(value, limit = 12) {
  const rejected = [];
  const accepted = normalizeStringList(value, limit * 2)
    .map((file) => {
      const normalized = normalizeScopedPathCandidate(file);
      if (normalized.rejected) {
        rejected.push(file);
        return null;
      }
      return normalized.path;
    })
    .filter(Boolean)
    .slice(0, limit);

  return { accepted, rejected: rejected.slice(0, limit) };
}

function estimateContextTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.max(1, Math.ceil(text.length / 4));
}

function stableProofDigest(parts) {
  const payload = parts.map((part) => String(part ?? "")).join("\n");
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function addMillisecondsIso(timestamp, milliseconds) {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
  return new Date(timestampMs + milliseconds).toISOString();
}

function normalizeContextSourceEntries(input, request, contracts, now) {
  const rawSources = input.contextSources || input.retrievalManifest || asObject(input.runtime).contextSources;
  const explicitSources = Array.isArray(rawSources) ? rawSources : [];
  const explicitEntries = explicitSources.slice(0, 20).map((item, index) => {
    const source = asObject(item);
    const sourceId = asTrimmedString(source.sourceId, asTrimmedString(source.id, `source:${index + 1}`));
    const rawPath = asTrimmedString(source.path, asTrimmedString(source.file, ""));
    const normalizedPath = normalizeScopedPathCandidate(rawPath);
    const path = normalizedPath.path || "";
    const sourceType = asTrimmedString(source.sourceType, asTrimmedString(source.type, path ? "file" : "runtime"));
    const summary = asTrimmedString(source.summary, asTrimmedString(source.description, sourceId));
    const scopeBlocked = path ? contracts.scope.blockedTargets.includes(path) : false;
    const pathRejected = normalizedPath.rejected;
    return {
      sourceId,
      sourceType,
      path: path || null,
      originalPath: rawPath && rawPath !== path ? rawPath : null,
      pathRejected,
      pathRejectionReason: normalizedPath.rejectionReason,
      summary,
      provenance: asTrimmedString(source.provenance, "runtime_input"),
      observedAt: asTrimmedString(source.observedAt, asTrimmedString(source.generatedAt, now)),
      estimatedTokens: Math.max(1, Math.floor(Number(source.estimatedTokens) || estimateContextTokens(summary))),
      required: source.required !== false,
      writable: path ? contracts.scope.writableTargets.includes(path) : false,
      blocked: pathRejected || scopeBlocked,
      blockedReason: pathRejected ? `unsafe_source_path:${normalizedPath.rejectionReason}` : scopeBlocked ? "blocked_by_allowed_scope" : null
    };
  });

  const scopedEntries = request.assignedFiles.map((file, index) => ({
    sourceId: `assigned:${index + 1}`,
    sourceType: "assigned_file",
    path: file,
    summary: `Assigned scheduler context-pack target ${file}`,
    provenance: "request.assignedFiles",
    observedAt: now,
    estimatedTokens: estimateContextTokens(file) + 16,
    required: true,
    writable: contracts.scope.writableTargets.includes(file),
    blocked: contracts.scope.blockedTargets.includes(file),
    blockedReason: contracts.scope.blockedTargets.includes(file) ? "blocked_by_allowed_scope" : null,
    originalPath: null,
    pathRejected: false,
    pathRejectionReason: null
  }));

  const seen = new Set();
  return [...explicitEntries, ...scopedEntries].filter((entry) => {
    const key = `${entry.sourceType}:${entry.path || entry.sourceId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 24);
}

function buildContextSourceIntegrity(input, request, contracts, now) {
  const entries = normalizeContextSourceEntries(input, request, contracts, now);
  const assignedSet = new Set(request.assignedFiles);
  const allowedSet = new Set(request.allowedFiles);
  const rejectedPathEntries = entries.filter((entry) => entry.pathRejected);
  const blockedEntries = entries.filter((entry) => entry.blocked);
  const requiredBlockedEntries = blockedEntries.filter((entry) => entry.required);
  const supportingFileEntries = entries.filter((entry) => entry.path && !assignedSet.has(entry.path));
  const outsideAllowedEntries = supportingFileEntries.filter((entry) => entry.required && !allowedSet.has(entry.path));
  const assignedSources = request.assignedFiles.map((path) => {
    const matchingSource = entries.find((entry) => entry.path === path);
    return {
      path,
      sourceId: matchingSource?.sourceId || null,
      materialized: Boolean(matchingSource),
      writable: contracts.scope.writableTargets.includes(path),
      blocked: contracts.scope.blockedTargets.includes(path)
    };
  });

  return {
    contractType: "scheduler.context-pack.source_integrity.v1",
    evaluatedAt: now,
    totalSourceCount: entries.length,
    assignedSourceCount: assignedSources.filter((entry) => entry.materialized).length,
    missingAssignedSources: assignedSources.filter((entry) => !entry.materialized).map((entry) => entry.path),
    rejectedPathCount: rejectedPathEntries.length,
    rejectedPaths: rejectedPathEntries.map((entry) => ({
      sourceId: entry.sourceId,
      originalPath: entry.originalPath,
      reason: entry.pathRejectionReason,
      required: entry.required
    })).slice(0, 8),
    blockedSourceCount: blockedEntries.length,
    requiredBlockedSourceCount: requiredBlockedEntries.length,
    blockedSources: blockedEntries.map((entry) => ({
      sourceId: entry.sourceId,
      path: entry.path,
      originalPath: entry.originalPath,
      reason: entry.blockedReason || "blocked_by_allowed_scope",
      required: entry.required
    })).slice(0, 8),
    requiredSupportingOutsideAllowed: outsideAllowedEntries.map((entry) => entry.path).slice(0, 8),
    proofSignals: [
      `sources:${entries.length}`,
      `assignedSources:${assignedSources.filter((entry) => entry.materialized).length}/${request.assignedFiles.length}`,
      rejectedPathEntries.length ? `rejectedSourcePaths:${rejectedPathEntries.length}` : null,
      requiredBlockedEntries.length ? `requiredBlockedSources:${requiredBlockedEntries.length}` : null,
      outsideAllowedEntries.length ? `requiredSupportingOutsideAllowed:${outsideAllowedEntries.length}` : null
    ].filter(Boolean)
  };
}

function normalizeRoleList(value) {
  const roles = normalizeStringList(value, 6)
    .map((role) => role.toLowerCase())
    .filter((role) => role in ROLE_PERMISSIONS);

  return roles.length ? roles : ["worker"];
}

function derivePermissionSet(actor) {
  const permissions = new Set(normalizeStringList(actor.permissions, 12));
  for (const role of actor.roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      permissions.add(permission);
    }
  }
  return permissions;
}

function normalizeActor(input, clientState) {
  const actor = asObject(input.actor || clientState.actor);
  const roles = normalizeRoleList(actor.roles || actor.role || clientState.roles || input.roles);
  const permissions = normalizeStringList(
    actor.permissions || clientState.permissions || input.permissions,
    12
  );

  return {
    actorId: asTrimmedString(actor.actorId, asTrimmedString(clientState.clientId, "hosted-kernel-client")),
    roles,
    permissions
  };
}

function normalizeStatus(value) {
  const status = asTrimmedString(value, "pending").toLowerCase();
  if (FINAL_STATUSES.has(status) || ACTIVE_STATUSES.has(status)) {
    return status;
  }
  return "pending";
}

function stableCommandId(request, clientState, commandName = DEFAULT_COMMAND) {
  return [
    surfaceId,
    request.requestId,
    clientState.sessionId,
    asTrimmedString(commandName, DEFAULT_COMMAND)
  ].join(":");
}

function normalizeCommandLease(value, request, clientState, now) {
  const lease = asObject(value);
  const leaseMs = Math.max(15_000, Math.floor(Number(lease.leaseMs) || DEFAULT_COMMAND_LEASE_MS));
  const leasedAt = asTrimmedString(lease.leasedAt, asTrimmedString(lease.updatedAt, now));
  const leasedAtMs = Date.parse(leasedAt);
  const nowMs = Date.parse(now);
  const ageMs = Number.isFinite(leasedAtMs) && Number.isFinite(nowMs)
    ? Math.max(0, nowMs - leasedAtMs)
    : null;
  const expired = ageMs === null ? false : ageMs > leaseMs;
  const owner = asTrimmedString(lease.owner, asTrimmedString(lease.leaseOwner, clientState.clientId));
  const sessionId = asTrimmedString(lease.sessionId, asTrimmedString(lease.leaseSession, clientState.sessionId));
  const commandId = asTrimmedString(lease.commandId, stableCommandId(request, clientState));

  return {
    commandId,
    owner,
    sessionId,
    leasedAt,
    leaseMs,
    ageMs,
    expiresAt: Number.isFinite(leasedAtMs) ? new Date(leasedAtMs + leaseMs).toISOString() : null,
    expired,
    ownedByCurrentSession: owner === clientState.clientId && sessionId === clientState.sessionId
  };
}

function normalizeStatusSemantics(value) {
  const semantics = asObject(value);
  const terminal = normalizeBoolean(semantics.terminal, false);
  const replayable = normalizeBoolean(semantics.replayable, true);
  const requiresLease = normalizeBoolean(semantics.requiresLease, true);
  const persistedStatus = normalizeStatus(semantics.persistedStatus || semantics.status);

  return {
    persistedStatus,
    terminal,
    replayable,
    requiresLease,
    restartPolicy: asTrimmedString(
      semantics.restartPolicy,
      terminal ? "terminal_no_restart" : replayable ? "resume_with_idempotency_key" : "hold_for_operator_review"
    ),
    statusReason: asTrimmedString(semantics.statusReason, asTrimmedString(semantics.reason, "checkpoint_loaded"))
  };
}

function normalizeCommandLog(value, request, clientState) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(-12).map((item, index) => {
    const command = asObject(item);
    const name = asTrimmedString(command.name, DEFAULT_COMMAND);
    const status = normalizeStatus(command.status);
    return {
      id: asTrimmedString(command.id, stableCommandId(request, clientState, `${name}:${index}`)),
      name,
      status,
      target: asTrimmedString(command.target, request.targetSurface),
      attempt: Math.max(1, Math.floor(Number(command.attempt) || 1))
    };
  });
}

function normalizePersistedCheckpoint(input, request, clientState, now) {
  const persisted = asObject(input.persistedState || input.checkpoint || input.schedulerState);
  const status = normalizeStatus(persisted.status);
  const lastUpdatedAt = asTrimmedString(persisted.updatedAt, asTrimmedString(persisted.lastUpdatedAt, null));
  const commandLog = normalizeCommandLog(persisted.commandLog || persisted.commands, request, clientState);
  const completedCommandIds = new Set(
    commandLog
      .filter((command) => command.status === "completed")
      .map((command) => command.id)
  );
  const pendingCommandId = stableCommandId(request, clientState);
  const restartCount = Math.max(0, Math.floor(Number(persisted.restartCount) || 0));
  const schemaVersion = Math.max(1, Math.floor(Number(persisted.schemaVersion) || CHECKPOINT_SCHEMA_VERSION));
  const lastCommand = commandLog.length ? commandLog[commandLog.length - 1] : null;
  const checkpointId = asTrimmedString(
    persisted.checkpointId,
    `${surfaceId}:${request.requestId}:${clientState.sessionId}`
  );
  const activeLease = normalizeCommandLease(
    persisted.activeLease || persisted.commandLease || persisted.lease,
    request,
    clientState,
    now
  );
  const statusSemantics = normalizeStatusSemantics(persisted.statusSemantics || persisted.restartSemantics);

  return {
    schemaVersion,
    checkpointId,
    status,
    updatedAt: lastUpdatedAt || now,
    restartCount,
    tenantId: asTrimmedString(persisted.tenantId, request.tenantId),
    workspaceId: asTrimmedString(persisted.workspaceId, request.workspaceId),
    lifecycle: asObject(persisted.lifecycle || persisted.lifecycleState),
    activeLease,
    statusSemantics: {
      ...statusSemantics,
      persistedStatus: status,
      terminal: FINAL_STATUSES.has(status) || statusSemantics.terminal,
      replayable: !FINAL_STATUSES.has(status) && statusSemantics.replayable
    },
    lastCommandId: asTrimmedString(persisted.lastCommandId, lastCommand?.id || null),
    completedCommandIds: Array.from(completedCommandIds).slice(-12),
    commandLog,
    pendingCommand: {
      id: pendingCommandId,
      name: DEFAULT_COMMAND,
      target: request.targetSurface,
      idempotencyKey: `${checkpointId}:${pendingCommandId}`
    }
  };
}

function deriveRestartStatusSemantics(checkpoint, pendingAlreadyCompleted, restartDetected) {
  const activeLease = checkpoint.activeLease;
  const terminal = FINAL_STATUSES.has(checkpoint.status) || checkpoint.statusSemantics.terminal;
  const leaseHeldByOtherSession = checkpoint.status === "running"
    && !activeLease.expired
    && !activeLease.ownedByCurrentSession;
  const staleLeaseRecovered = restartDetected && activeLease.expired;
  const duplicateCompleted = pendingAlreadyCompleted || checkpoint.status === "completed";
  const replayable = !terminal && !duplicateCompleted && !leaseHeldByOtherSession;
  const commandLeaseAction = duplicateCompleted
    ? "skip_completed_command"
    : leaseHeldByOtherSession
      ? "hold_active_foreign_lease"
      : staleLeaseRecovered
        ? "reclaim_expired_lease"
        : activeLease.ownedByCurrentSession
          ? "renew_current_lease"
          : "create_command_lease";

  return {
    terminal,
    replayable,
    leaseHeldByOtherSession,
    staleLeaseRecovered,
    duplicateCompleted,
    commandLeaseAction,
    restartPolicy: duplicateCompleted
      ? "never_replay_completed_command"
      : leaseHeldByOtherSession
        ? "do_not_replay_while_foreign_lease_active"
        : staleLeaseRecovered
          ? "resume_after_expired_lease_reclaim"
          : "resume_with_idempotency_key",
    activeLease
  };
}

function buildRecoveryPlan(checkpoint, request, contracts) {
  const hasWritableTarget = contracts.scope.writableTargets.length > 0;
  const pendingAlreadyCompleted = checkpoint.completedCommandIds.includes(checkpoint.pendingCommand.id);
  const restartDetected = checkpoint.status === "running" || checkpoint.status === "recovering";
  const statusSemantics = deriveRestartStatusSemantics(checkpoint, pendingAlreadyCompleted, restartDetected);
  const blockedByScope = (contracts.scope.blockedTargets.length > 0 && !hasWritableTarget)
    || contracts.boundary.enforcement.blocked;
  const blockedByLifecycle = contracts.lifecycle.controls.executionBlocked;
  const nextStatus = blockedByScope
    ? "blocked"
    : blockedByLifecycle
      ? "blocked"
    : statusSemantics.leaseHeldByOtherSession
      ? "blocked"
    : pendingAlreadyCompleted
      ? "completed"
    : restartDetected
        ? "recovering"
      : "pending";
  const commandEffect = pendingAlreadyCompleted
    ? "noop_already_applied"
    : statusSemantics.leaseHeldByOtherSession
      ? "noop_active_lease"
      : statusSemantics.staleLeaseRecovered
        ? "reclaim_and_apply_once"
        : "apply_once";

  return {
    restartSafe: true,
    previousStatus: checkpoint.status,
    status: nextStatus,
    commandEffect,
    canResume: hasWritableTarget && nextStatus !== "completed" && nextStatus !== "blocked" && statusSemantics.replayable,
    resumedFromCheckpoint: restartDetected,
    checkpointId: checkpoint.checkpointId,
    commandId: checkpoint.pendingCommand.id,
    idempotencyKey: checkpoint.pendingCommand.idempotencyKey,
    statusSemantics,
    recoveryActions: [
      restartDetected ? "reconcile_inflight_context_pack" : "load_checkpoint",
      pendingAlreadyCompleted ? "skip_completed_command" : "reserve_idempotent_command",
      statusSemantics.commandLeaseAction,
      hasWritableTarget ? "resume_with_writable_target" : "hold_for_scope_update",
      contracts.lifecycle.controls.executionBlocked ? contracts.lifecycle.controls.nextLifecycleAction : "lifecycle_controls_ready",
      contracts.boundary.enforcement.blocked ? "route_to_boundary_audit" : "boundary_authorized"
    ],
    statusReason: blockedByScope
      ? contracts.boundary.enforcement.reason
      : blockedByLifecycle
        ? contracts.lifecycle.controls.blockReason
      : statusSemantics.leaseHeldByOtherSession
        ? "active_command_lease_held_by_other_session"
      : pendingAlreadyCompleted
        ? "command_previously_completed"
        : statusSemantics.staleLeaseRecovered
          ? "expired_command_lease_reclaimed"
        : restartDetected
          ? "inflight_checkpoint_recovered"
          : `ready_for:${request.targetSurface}`
  };
}

function normalizeRequest(input) {
  const request = asObject(input.request);
  const route = asTrimmedString(request.route, asTrimmedString(input.route, DEFAULT_ROUTE));
  const intent = asTrimmedString(request.intent, asTrimmedString(input.intent, "Prepare scheduler context handoff."));
  const promptMode = asTrimmedString(request.promptMode, asTrimmedString(input.promptMode, "compact"));
  const assignedScope = normalizeScopedFileList(request.assignedFiles || input.assignedFiles, 12);
  const allowedScope = normalizeScopedFileList(request.allowedFiles || input.allowedFiles, 12);
  const tenant = asObject(request.tenant || input.tenant);
  const workspace = asObject(request.workspace || input.workspace);

  return {
    requestId: asTrimmedString(request.requestId, asTrimmedString(input.requestId, `${surfaceId}:anonymous`)),
    tenantId: asTrimmedString(request.tenantId, asTrimmedString(tenant.tenantId, "local-tenant")),
    workspaceId: asTrimmedString(request.workspaceId, asTrimmedString(workspace.workspaceId, "default-workspace")),
    route,
    intent,
    promptMode,
    assignedFiles: assignedScope.accepted,
    allowedFiles: allowedScope.accepted,
    rejectedScopeFiles: [...assignedScope.rejected, ...allowedScope.rejected].slice(0, 12),
    verifierCatalog: normalizeStringList(request.verifierCatalog || input.verifierCatalog, 6),
    targetSurface: asTrimmedString(request.targetSurface, asTrimmedString(input.targetSurface, surfaceId)),
    handoffRequired: normalizeBoolean(request.handoffRequired ?? input.handoffRequired, false)
  };
}

function normalizeClientState(input) {
  const clientState = asObject(input.clientState);
  const runtime = asObject(input.runtime);
  const tokenBudget = Number(clientState.tokenBudget ?? runtime.tokenBudget ?? input.tokenBudget);
  const elapsedMs = Number(clientState.elapsedMs ?? runtime.elapsedMs ?? input.elapsedMs);
  const dirtyFiles = normalizeStringList(clientState.dirtyFiles || runtime.dirtyFiles || input.dirtyFiles, 12);
  const handoffPreferences = normalizeClientHandoffPreferences(input, clientState, runtime);

  return {
    clientId: asTrimmedString(clientState.clientId, asTrimmedString(input.clientId, "hosted-kernel-client")),
    sessionId: asTrimmedString(clientState.sessionId, asTrimmedString(input.sessionId, "local-session")),
    promptMode: asTrimmedString(clientState.promptMode, asTrimmedString(input.promptMode, "compact")),
    tokenBudget: Number.isFinite(tokenBudget) && tokenBudget > 0 ? Math.floor(tokenBudget) : null,
    elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.floor(elapsedMs) : 0,
    actor: asObject(clientState.actor || input.actor),
    roles: clientState.roles || input.roles,
    permissions: clientState.permissions || input.permissions,
    dirtyFiles,
    handoffPreferences
  };
}

function normalizeClientHandoffPreferences(input, clientState, runtime) {
  const preferences = asObject(
    clientState.handoffPreferences
      || clientState.workflowHandoff
      || runtime.handoffPreferences
      || input.handoffPreferences
  );
  const capabilityInput = preferences.capabilities
    || clientState.clientCapabilities
    || runtime.clientCapabilities
    || input.clientCapabilities;
  const requestedCapabilities = normalizeStringList(capabilityInput, 12).map((capability) => capability.toLowerCase());
  const capabilities = requestedCapabilities.length
    ? requestedCapabilities.filter((capability) => CLIENT_HANDOFF_CHANNELS.includes(capability))
    : ["inline_preview", "resume_panel", "command_palette", "audit_receipt"];
  const preferredChannel = normalizeKnownString(
    preferences.preferredChannel || preferences.channel || input.handoffChannel,
    CLIENT_HANDOFF_CHANNELS,
    capabilities[0] || "command_palette"
  );
  const displayMode = normalizeKnownString(
    preferences.displayMode || preferences.mode || input.handoffMode,
    CLIENT_HANDOFF_MODES,
    "guided"
  );

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.client_handoff_preferences.v1",
    capabilities: capabilities.length ? capabilities : ["command_palette"],
    preferredChannel: capabilities.includes(preferredChannel) ? preferredChannel : capabilities[0] || "command_palette",
    displayMode,
    requiresExplicitAcceptance: normalizeBoolean(preferences.requiresExplicitAcceptance, displayMode !== "silent"),
    persistWorkflowPatch: normalizeBoolean(preferences.persistWorkflowPatch, true),
    supportsInlinePreview: capabilities.includes("inline_preview"),
    supportsResumePanel: capabilities.includes("resume_panel"),
    supportsExternalProvider: capabilities.includes("external_provider"),
    supportsAuditReceipt: capabilities.includes("audit_receipt")
  };
}

function selectContextBudget(promptMode) {
  if (promptMode in CONTEXT_BUDGETS) {
    return CONTEXT_BUDGETS[promptMode];
  }
  return CONTEXT_BUDGETS.compact;
}

function normalizeFailureEvents(value, request, limit = 8) {
  const events = Array.isArray(value) ? value : value ? [value] : [];
  return events
    .map((item, index) => {
      const event = asObject(item);
      const code = asTrimmedString(event.code, asTrimmedString(event.reason, "context_pack_failure"));
      const message = asTrimmedString(event.message, code);
      const target = asTrimmedString(event.target, request.targetSurface);
      return {
        code,
        message,
        target,
        retryable: event.retryable !== false,
        observedAt: asTrimmedString(event.observedAt, asTrimmedString(event.timestamp, null)),
        index
      };
    })
    .filter((event) => event.code)
    .slice(-limit);
}

function collectFailureEvents(input, checkpoint, request) {
  const runtime = asObject(input.runtime);
  const persisted = asObject(input.persistedState || input.checkpoint || input.schedulerState);
  return [
    ...normalizeFailureEvents(input.failures || input.errors, request),
    ...normalizeFailureEvents(runtime.failures || runtime.errors, request),
    ...normalizeFailureEvents(persisted.failures || persisted.errors, request),
    ...checkpoint.commandLog
      .filter((command) => command.status === "failed" || command.status === "blocked")
      .map((command) => ({
        code: `command_${command.status}`,
        message: `${command.name}:${command.status}`,
        target: command.target,
        retryable: command.status === "failed",
        observedAt: null,
        index: command.attempt
      }))
  ].slice(-8);
}

function addValidationIssue(issues, severity, code, message, action, target = surfaceId) {
  issues.push({ severity, code, message, action, target });
}

function buildActionableError(issue, retryable = false) {
  return {
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    action: issue.action,
    target: issue.target,
    retryable
  };
}

function calculateRetryWindow(checkpoint, failures, now) {
  const retryableFailures = failures.filter((event) => event.retryable);
  if (!retryableFailures.length || checkpoint.status === "blocked" || checkpoint.status === "completed") {
    return {
      retryable: false,
      attempt: checkpoint.restartCount + 1,
      backoffMs: 0,
      nextRetryAt: null,
      reason: retryableFailures.length ? `status_${checkpoint.status}` : "no_retryable_failure"
    };
  }

  const attempt = Math.max(1, checkpoint.restartCount + retryableFailures.length);
  const backoffMs = Math.min(DEFAULT_RETRY_BASE_MS * (2 ** Math.min(attempt - 1, 5)), DEFAULT_RETRY_MAX_MS);
  const nowMs = Date.parse(now);
  const nextRetryAt = Number.isFinite(nowMs) ? new Date(nowMs + backoffMs).toISOString() : null;

  return {
    retryable: true,
    attempt,
    backoffMs,
    nextRetryAt,
    reason: retryableFailures[retryableFailures.length - 1].code
  };
}

function buildFailureStateTransition(checkpoint, failures, retry, contracts, recovery, now) {
  const retryableFailures = failures.filter((event) => event.retryable);
  const terminalFailures = failures.filter((event) => !event.retryable);
  const latestFailure = failures.length ? failures[failures.length - 1] : null;
  const retryAttemptLimit = Math.max(
    1,
    Math.floor(Number(asObject(checkpoint.lifecycle).retryAttemptLimit) || DEFAULT_RETRY_ATTEMPT_LIMIT)
  );
  const retryExhausted = retry.retryable && retry.attempt > retryAttemptLimit;
  const providerAvailable = contracts.providers.readyProviderIds.length > 0;
  const blockedByLease = recovery.statusSemantics.leaseHeldByOtherSession;
  const blockedByFailure = terminalFailures.length > 0 || retryExhausted;
  const failureMode = !failures.length
    ? "clear"
    : blockedByFailure
      ? "failed"
      : blockedByLease
        ? "blocked"
        : retry.retryable
          ? "retry_scheduled"
          : "observed";
  const schedulerDisposition = failureMode === "clear"
    ? "continue"
    : failureMode === "retry_scheduled"
      ? "defer_until_retry_window"
      : failureMode === "blocked"
        ? "hold_for_active_lease"
        : "hold_for_operator_repair";
  const nextCheckpointStatus = failureMode === "clear"
    ? recovery.status
    : failureMode === "retry_scheduled"
      ? "recovering"
      : "blocked";
  const writePolicy = failureMode === "retry_scheduled"
    ? "checkpoint_retry_and_preserve_idempotency"
    : failureMode === "clear"
      ? "write_normal_checkpoint"
      : "checkpoint_blocked_without_side_effect";

  return {
    contractType: "scheduler.context-pack.failure_state_transition.v1",
    evaluatedAt: now,
    mode: failureMode,
    schedulerDisposition,
    statusPatch: {
      previousStatus: checkpoint.status,
      recoveryStatus: recovery.status,
      nextCheckpointStatus,
      writePolicy,
      commandId: checkpoint.pendingCommand.id,
      idempotencyKey: checkpoint.pendingCommand.idempotencyKey
    },
    retryBudget: {
      attempt: retry.attempt,
      limit: retryAttemptLimit,
      exhausted: retryExhausted,
      retryableFailureCount: retryableFailures.length,
      terminalFailureCount: terminalFailures.length,
      nextRetryAt: retry.nextRetryAt,
      backoffMs: retry.backoffMs
    },
    latestFailure: latestFailure
      ? {
          code: latestFailure.code,
          target: latestFailure.target,
          retryable: latestFailure.retryable,
          observedAt: latestFailure.observedAt
        }
      : null,
    degradedGuards: [
      failures.length && !retryExhausted ? "emit_failure_audit_before_handoff" : null,
      retry.retryable ? "suppress_apply_until_retry_window" : null,
      contracts.providers.staleSyncProviderIds.length ? "refresh_provider_sync_before_resume" : null,
      providerAvailable ? null : "provider_contract_required_before_retry",
      blockedByLease ? "preserve_foreign_command_lease" : null
    ].filter(Boolean),
    operatorActions: [
      terminalFailures.length ? "inspect_terminal_failure_and_repair_input" : null,
      retryExhausted ? "reset_checkpoint_after_operator_review" : null,
      retry.retryable && !retryExhausted ? "resume_after_retry_backoff" : null,
      contracts.providers.staleSyncProviderIds.length ? "refresh_stale_provider_sync" : null,
      providerAvailable ? null : "register_ready_context_pack_provider"
    ].filter(Boolean)
  };
}

function buildOperationalIncidentContract(issues, failures, retry, failureTransition, contracts, recovery, request, now) {
  const domainSignals = [
    ...issues.map((issue) => ({
      domain: issue.code.startsWith("provider_") ? "provider"
        : issue.code.startsWith("lifecycle_") || issue.code.startsWith("schedule_") ? "lifecycle"
          : issue.code.includes("scope") || issue.code.includes("boundary") ? "boundary"
            : "validation",
      code: issue.code,
      severity: issue.severity,
      target: issue.target,
      retryable: issue.severity !== "error" && retry.retryable
    })),
    ...failures.map((failure) => ({
      domain: failure.code.startsWith("command_") ? "command" : "runtime",
      code: failure.code,
      severity: failure.retryable ? "warning" : "error",
      target: failure.target,
      retryable: failure.retryable
    }))
  ];
  const severityRank = { clear: 0, info: 1, warning: 2, error: 3, critical: 4 };
  const hasCritical = failureTransition.retryBudget.exhausted
    || contracts.boundary.enforcement.blocked
    || (!contracts.providers.readyProviderIds.length && failures.length > 0);
  const maxSeverity = domainSignals.reduce((highest, signal) => (
    severityRank[signal.severity] > severityRank[highest] ? signal.severity : highest
  ), "clear");
  const severity = hasCritical ? "critical" : maxSeverity;
  const impactedDomains = Array.from(new Set(domainSignals.map((signal) => signal.domain))).sort();
  const retryBlockedReasons = [
    !retry.retryable ? retry.reason : null,
    failureTransition.retryBudget.exhausted ? "retry_budget_exhausted" : null,
    recovery.statusSemantics.leaseHeldByOtherSession ? "active_foreign_lease" : null,
    contracts.boundary.enforcement.blocked ? contracts.boundary.enforcement.reason : null,
    contracts.lifecycle.controls.executionBlocked ? contracts.lifecycle.controls.blockReason : null,
    !contracts.providers.readyProviderIds.length ? "provider_not_ready" : null
  ].filter(Boolean);
  const retryAdmitted = retry.retryable
    && !failureTransition.retryBudget.exhausted
    && !recovery.statusSemantics.leaseHeldByOtherSession
    && !contracts.boundary.enforcement.blocked
    && !contracts.lifecycle.controls.executionBlocked
    && contracts.providers.readyProviderIds.length > 0;
  const degradedMode = severity === "warning"
    || retryAdmitted
    || contracts.providers.staleSyncProviderIds.length > 0
    || recovery.resumedFromCheckpoint;
  const primarySignal = domainSignals.find((signal) => signal.severity === "error")
    || domainSignals.find((signal) => signal.severity === "warning")
    || domainSignals[domainSignals.length - 1]
    || null;
  const actionPlan = [
    retryAdmitted ? {
      action: "wait_for_retry_window",
      owner: "scheduler",
      reason: failureTransition.latestFailure?.code || retry.reason,
      notBefore: retry.nextRetryAt
    } : null,
    contracts.providers.staleSyncProviderIds.length ? {
      action: "refresh_provider_sync",
      owner: "provider",
      reason: "stale_sync_cursor",
      targets: contracts.providers.staleSyncProviderIds
    } : null,
    !contracts.providers.readyProviderIds.length ? {
      action: "register_ready_provider_contract",
      owner: "operator",
      reason: "missing_required_capabilities",
      targets: contracts.providers.blockedProviderIds
    } : null,
    contracts.boundary.enforcement.blocked ? {
      action: "repair_boundary_or_scope",
      owner: "operator",
      reason: contracts.boundary.enforcement.reason,
      targets: contracts.scope.blockedTargets
    } : null,
    contracts.lifecycle.controls.executionBlocked ? {
      action: contracts.lifecycle.controls.nextLifecycleAction,
      owner: "scheduler",
      reason: contracts.lifecycle.controls.blockReason,
      targets: [request.targetSurface]
    } : null,
    failureTransition.retryBudget.exhausted ? {
      action: "operator_review_checkpoint",
      owner: "operator",
      reason: "retry_budget_exhausted",
      targets: [recovery.checkpointId]
    } : null
  ].filter(Boolean);

  return {
    contractType: "scheduler.context-pack.operational_incident.v1",
    incidentId: stableProofDigest([
      surfaceId,
      request.requestId,
      recovery.checkpointId,
      severity,
      failureTransition.mode,
      impactedDomains.join(","),
      primarySignal?.code || "clear"
    ]),
    evaluatedAt: now,
    severity,
    status: severity === "clear" ? "clear" : retryAdmitted ? "retry_admitted" : "action_required",
    primaryCode: primarySignal?.code || null,
    impactedDomains,
    signals: domainSignals.slice(0, 16),
    degradedMode: {
      active: degradedMode && severity !== "critical",
      reason: retryAdmitted ? "retry_backoff_active"
        : contracts.providers.staleSyncProviderIds.length ? "provider_sync_stale"
          : recovery.resumedFromCheckpoint ? "checkpoint_recovery"
            : severity === "warning" ? "non_blocking_validation"
              : null,
      allowedOperations: degradedMode && severity !== "critical"
        ? ["read_context", "emit_audit", "persist_checkpoint", "resume_idempotent_command"]
        : []
    },
    retryAdmission: {
      admitted: retryAdmitted,
      nextRetryAt: retryAdmitted ? retry.nextRetryAt : null,
      backoffMs: retryAdmitted ? retry.backoffMs : 0,
      attempt: retry.attempt,
      blockedReasons: retryAdmitted ? [] : retryBlockedReasons.slice(0, 8)
    },
    actionPlan: actionPlan.slice(0, 8),
    proofSignals: [
      `incidentSeverity:${severity}`,
      `incidentStatus:${severity === "clear" ? "clear" : retryAdmitted ? "retry_admitted" : "action_required"}`,
      `incidentDomains:${impactedDomains.join(",") || "none"}`,
      retryAdmitted ? `retryAt:${retry.nextRetryAt || retry.backoffMs}` : null,
      failureTransition.retryBudget.exhausted ? "retryBudget:exhausted" : null
    ].filter(Boolean)
  };
}

function buildHealthRoutingEnvelope(issues, failures, retry, failureTransition, incident, contracts, recovery, request, now) {
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  const latestFailure = failures.length ? failures[failures.length - 1] : null;
  const providerBlocked = contracts.providers.readyProviderIds.length === 0;
  const leaseBlocked = recovery.statusSemantics.leaseHeldByOtherSession;
  const boundaryBlocked = contracts.boundary.enforcement.blocked;
  const lifecycleBlocked = contracts.lifecycle.controls.executionBlocked;
  const retryAdmitted = incident.retryAdmission.admitted;
  const hardBlocked = blockingIssues.length > 0
    || failureTransition.retryBudget.exhausted
    || boundaryBlocked
    || lifecycleBlocked
    || providerBlocked
    || leaseBlocked;
  const degradedOnly = !hardBlocked && (
    warningIssues.length > 0
    || failures.length > 0
    || incident.degradedMode.active
    || recovery.resumedFromCheckpoint
  );
  const routeState = hardBlocked
    ? "blocked"
    : retryAdmitted
      ? "retry_wait"
      : degradedOnly
        ? "degraded_continue"
        : "dispatch_ready";
  const dispatchAction = routeState === "blocked"
    ? "hold_context_pack_dispatch"
    : routeState === "retry_wait"
      ? "defer_context_pack_until_retry_window"
      : routeState === "degraded_continue"
        ? "dispatch_with_health_audit"
        : "dispatch_context_pack";
  const primaryIssue = blockingIssues[0]
    || warningIssues[0]
    || (latestFailure
      ? {
          code: latestFailure.code,
          severity: latestFailure.retryable ? "warning" : "error",
          message: latestFailure.message,
          action: latestFailure.retryable
            ? "Retry after the scheduler backoff window."
            : "Escalate the failure with audit proof.",
          target: latestFailure.target
        }
      : null);
  const userFacingError = primaryIssue
    ? {
        code: primaryIssue.code,
        severity: primaryIssue.severity,
        title: primaryIssue.severity === "error"
          ? "Context-pack dispatch is blocked"
          : "Context-pack dispatch needs review",
        detail: primaryIssue.message,
        nextStep: primaryIssue.action,
        target: primaryIssue.target || request.targetSurface,
        retryable: retryAdmitted || (latestFailure?.retryable && !failureTransition.retryBudget.exhausted)
      }
    : null;
  const escalationReason = failureTransition.retryBudget.exhausted
    ? "retry_budget_exhausted"
    : boundaryBlocked
      ? contracts.boundary.enforcement.reason
      : lifecycleBlocked
        ? contracts.lifecycle.controls.blockReason
        : providerBlocked
          ? "provider_contract_unavailable"
          : leaseBlocked
            ? "active_foreign_command_lease"
            : blockingIssues[0]?.code || null;

  return {
    contractType: "scheduler.context-pack.health_routing.v1",
    evaluatedAt: now,
    routeState,
    dispatch: {
      action: dispatchAction,
      nextAction: routeState === "blocked"
        ? "resolve_context_pack_health_errors"
        : routeState === "retry_wait"
          ? "wait_for_retry_backoff"
          : routeState === "degraded_continue"
            ? "continue_in_degraded_mode"
            : "prepare_context_pack",
      allowed: routeState !== "blocked" && !failureTransition.retryBudget.exhausted,
      notBefore: retryAdmitted ? retry.nextRetryAt : null,
      checkpointStatus: failureTransition.statusPatch.nextCheckpointStatus,
      writePolicy: failureTransition.statusPatch.writePolicy
    },
    escalation: {
      required: Boolean(escalationReason),
      reason: escalationReason,
      owner: escalationReason === "provider_contract_unavailable"
        ? "provider"
        : escalationReason === "active_foreign_command_lease"
          ? "scheduler"
          : escalationReason
            ? "operator"
            : null,
      incidentId: incident.incidentId
    },
    userFacingError,
    validationSummary: {
      blockingIssueCodes: blockingIssues.map((issue) => issue.code).slice(0, 8),
      warningIssueCodes: warningIssues.map((issue) => issue.code).slice(0, 8),
      latestFailureCode: latestFailure?.code || null,
      impactedDomains: incident.impactedDomains
    },
    proofSignals: [
      `healthRoute:${routeState}`,
      `healthDispatch:${dispatchAction}`,
      escalationReason ? `healthEscalation:${escalationReason}` : null,
      retryAdmitted ? `healthRetryNotBefore:${retry.nextRetryAt || retry.backoffMs}` : null,
      userFacingError ? `healthUserError:${userFacingError.code}` : null
    ].filter(Boolean)
  };
}

function normalizeHistorySnapshots(value, request, clientState, now, limit = HISTORY_SNAPSHOT_LIMIT) {
  const snapshots = Array.isArray(value) ? value : [];
  return snapshots
    .map((item, index) => {
      const snapshot = asObject(item);
      const counters = asObject(snapshot.counters || snapshot.analytics);
      const healthMode = asTrimmedString(snapshot.healthMode, asTrimmedString(snapshot.mode, "unknown"));
      const status = normalizeStatus(snapshot.status);
      const observedAt = asTrimmedString(
        snapshot.observedAt,
        asTrimmedString(snapshot.generatedAt, asTrimmedString(snapshot.timestamp, now))
      );

      return {
        snapshotId: asTrimmedString(
          snapshot.snapshotId,
          `${surfaceId}:${request.requestId}:${clientState.sessionId}:history:${index}`
        ),
        observedAt,
        status,
        healthMode,
        route: asTrimmedString(snapshot.route, request.route),
        targetSurface: asTrimmedString(snapshot.targetSurface, request.targetSurface),
        writableTargetCount: Math.max(0, Math.floor(Number(counters.writableTargetCount) || 0)),
        blockedTargetCount: Math.max(0, Math.floor(Number(counters.blockedTargetCount) || 0)),
        validationErrorCount: Math.max(0, Math.floor(Number(counters.validationErrorCount) || 0)),
        validationWarningCount: Math.max(0, Math.floor(Number(counters.validationWarningCount) || 0)),
        failureCount: Math.max(0, Math.floor(Number(counters.failureCount) || 0)),
        retryableFailureCount: Math.max(0, Math.floor(Number(counters.retryableFailureCount) || 0))
      };
    })
    .filter((snapshot) => snapshot.snapshotId)
    .slice(-limit);
}

function counterDelta(current, previous, key) {
  return Math.floor(Number(current[key]) || 0) - Math.floor(Number(previous?.[key]) || 0);
}

function classifyCounterTrend(delta) {
  return delta > 0 ? "increased" : delta < 0 ? "decreased" : "unchanged";
}

function buildAnalyticsWindow(history, currentCounters, request, clientState, now) {
  const firstSnapshot = history[0] || null;
  const previousSnapshot = history.length > 1 ? history[history.length - 2] : null;
  const blockedDelta = counterDelta(currentCounters, previousSnapshot, "blockedTargetCount");
  const validationErrorDelta = counterDelta(currentCounters, previousSnapshot, "validationErrorCount");
  const failureDelta = counterDelta(currentCounters, previousSnapshot, "failureCount");
  const retryableDelta = counterDelta(currentCounters, previousSnapshot, "retryableFailureCount");
  const healthModes = Array.from(new Set(history.map((snapshot) => snapshot.healthMode))).filter(Boolean);
  const statuses = Array.from(new Set(history.map((snapshot) => snapshot.status))).filter(Boolean);
  const blockedObservationCount = history.filter((snapshot) => snapshot.blockedTargetCount > 0).length;
  const failedObservationCount = history.filter((snapshot) => (
    snapshot.failureCount > 0 || snapshot.validationErrorCount > 0 || snapshot.healthMode === "failed"
  )).length;

  return {
    contractType: "scheduler.context-pack.analytics_window.v1",
    generatedAt: now,
    requestId: request.requestId,
    sessionId: clientState.sessionId,
    retainedSnapshotCount: history.length,
    firstObservedAt: firstSnapshot?.observedAt || now,
    latestObservedAt: history[history.length - 1]?.observedAt || now,
    healthModes,
    statuses,
    deltas: {
      blockedTargetCount: blockedDelta,
      validationErrorCount: validationErrorDelta,
      failureCount: failureDelta,
      retryableFailureCount: retryableDelta
    },
    trends: {
      blockedTargets: classifyCounterTrend(blockedDelta),
      validationErrors: classifyCounterTrend(validationErrorDelta),
      failures: classifyCounterTrend(failureDelta),
      retryableFailures: classifyCounterTrend(retryableDelta)
    },
    stability: {
      blockedObservationCount,
      failedObservationCount,
      cleanObservationCount: Math.max(0, history.length - failedObservationCount),
      currentlyClean: currentCounters.validationErrorCount === 0
        && currentCounters.failureCount === 0
        && currentCounters.blockedTargetCount === 0
    }
  };
}

function buildAnalyticsExportReadiness(currentCounters, history, health, contracts, handoff, evidence, now) {
  const exportBlockedReasons = [
    contracts.providers.readyProviderIds.length ? null : "provider_not_ready",
    contracts.providers.acceptedExternalHandoffStateIds.length ? null : "no_accepted_provider_handoff_state",
    evidence.length ? null : "missing_audit_evidence",
    health.healthRouting.escalation.required ? `health_escalation:${health.healthRouting.escalation.reason}` : null,
    currentCounters.clientDirtyOutsideAllowedCount ? "dirty_files_outside_allowed_scope" : null
  ].filter(Boolean);
  const exportChannels = contracts.providers.providers.map((provider) => ({
    providerId: provider.providerId,
    transport: provider.transport,
    endpoint: provider.endpoint,
    ready: provider.status !== "blocked",
    exportable: provider.externalHandoff.exportable,
    stateId: provider.externalHandoff.stateId,
    acceptanceStatus: provider.externalHandoff.acceptanceStatus,
    acknowledgementRequired: provider.externalHandoff.acknowledgementRequired,
    acknowledgementId: provider.handoffAcknowledgement.acknowledgementId,
    acknowledgementRejectedBy: provider.handoffAcknowledgement.rejectionReason,
    negotiatedAnalyticsExport: provider.capabilityNegotiation.negotiatedCapabilities.includes("analytics.export")
  }));

  return {
    contractType: "scheduler.context-pack.analytics_export_readiness.v1",
    evaluatedAt: now,
    ready: exportBlockedReasons.length === 0,
    blockedReasons: exportBlockedReasons.slice(0, 8),
    exportChannels,
    dataset: {
      snapshotCount: history.length,
      counterCount: Object.keys(currentCounters).length,
      timelineEventCount: 6,
      evidenceCount: evidence.length,
      riskFlagCount: handoff.riskFlags.length,
      acceptedExternalHandoffStateCount: contracts.providers.acceptedExternalHandoffStateIds.length,
      pendingExternalHandoffProviderCount: contracts.providers.pendingExternalHandoffProviderIds.length
    },
    requiredFields: [
      "exportId",
      "surfaceId",
      "tenantId",
      "workspaceId",
      "route",
      "status",
      "healthMode",
      "proofId"
    ],
    proofSignals: [
      `analyticsExportReady:${exportBlockedReasons.length === 0}`,
      `analyticsSnapshots:${history.length}`,
      `analyticsCounters:${Object.keys(currentCounters).length}`,
      exportBlockedReasons.length ? `analyticsBlocked:${exportBlockedReasons[0]}` : "analyticsExport:ready"
    ]
  };
}

function buildAnalyticsReporting(input, request, clientState, checkpoint, contracts, recovery, health, handoff, evidence, now) {
  const previousSnapshots = normalizeHistorySnapshots(
    input.analyticsHistory || input.historySnapshots || asObject(input.persistedState).analyticsHistory,
    request,
    clientState,
    now
  );
  const failureCount = health.failureState.failures.length;
  const retryableFailureCount = health.failureState.failures.filter((failure) => failure.retryable).length;
  const currentCounters = {
    assignedFileCount: request.assignedFiles.length,
    allowedFileCount: request.allowedFiles.length,
    writableTargetCount: contracts.scope.writableTargets.length,
    blockedTargetCount: contracts.scope.blockedTargets.length,
    workspaceZoneCount: Object.keys(contracts.scope.workspaceZones).length,
    workspaceScopeDeniedCount: contracts.boundary.workspaceScope.deniedEntries.length,
    workspaceHandoffRequired: contracts.boundary.workspaceScope.handoffRequired ? 1 : 0,
    sourceManifestCount: contracts.scope.sourceIntegrity.totalSourceCount,
    assignedSourceMaterializedCount: contracts.scope.sourceIntegrity.assignedSourceCount,
    missingAssignedSourceCount: contracts.scope.sourceIntegrity.missingAssignedSources.length,
    rejectedContextSourcePathCount: contracts.scope.sourceIntegrity.rejectedPathCount,
    blockedContextSourceCount: contracts.scope.sourceIntegrity.blockedSourceCount,
    requiredBlockedContextSourceCount: contracts.scope.sourceIntegrity.requiredBlockedSourceCount,
    requiredSupportingOutsideAllowedCount: contracts.scope.sourceIntegrity.requiredSupportingOutsideAllowed.length,
    providerCount: contracts.providers.providers.length,
    readyProviderCount: contracts.providers.readyProviderIds.length,
    blockedProviderCount: contracts.providers.blockedProviderIds.length,
    staleProviderSyncCount: contracts.providers.staleSyncProviderIds.length,
    externalHandoffStateCount: contracts.providers.externalHandoffStates.length,
    acceptedExternalHandoffStateCount: contracts.providers.acceptedExternalHandoffStateIds.length,
    pendingExternalHandoffProviderCount: contracts.providers.pendingExternalHandoffProviderIds.length,
    handoffAcknowledgementCount: contracts.providers.handoffAcknowledgements.length,
    rejectedHandoffAcknowledgementCount: contracts.providers.handoffAcknowledgements
      .filter((acknowledgement) => acknowledgement.rejectionReason).length,
    negotiatedCapabilityCount: contracts.providers.providers.reduce(
      (count, provider) => count + provider.capabilityNegotiation.negotiatedCapabilities.length,
      0
    ),
    rejectedScopeFileCount: request.rejectedScopeFiles.length,
    evidenceCount: evidence.length,
    commandLogCount: checkpoint.commandLog.length,
    completedCommandCount: checkpoint.completedCommandIds.length,
    restartCount: checkpoint.restartCount,
    lifecycleEnabled: contracts.lifecycle.controls.enabled ? 1 : 0,
    lifecyclePaused: contracts.lifecycle.controls.paused ? 1 : 0,
    lifecycleExecutionBlocked: contracts.lifecycle.controls.executionBlocked ? 1 : 0,
    lifecycleSettingsIssueCount: contracts.lifecycle.settingsValidation.issueCount,
    lifecycleCommandAccepted: contracts.lifecycle.commandTransition.accepted ? 1 : 0,
    lifecycleCommandEffectCount: contracts.lifecycle.commandTransition.commandEffects.length,
    lifecycleCanDispatch: contracts.lifecycle.commandTransition.nextActionState.canDispatch ? 1 : 0,
    lifecycleCanQueue: contracts.lifecycle.commandTransition.nextActionState.canQueue ? 1 : 0,
    lifecycleActiveRunCount: contracts.lifecycle.schedule.activeRunCount,
    lifecycleMaxConcurrentRuns: contracts.lifecycle.schedule.maxConcurrentRuns,
    lifecycleDispatchBlocked: contracts.lifecycle.commandTransition.dispatchPolicy.blockedReasons.length ? 1 : 0,
    lifecycleStateRevision: contracts.lifecycle.commandTransition.stateRevision,
    scheduleDue: contracts.lifecycle.schedule.due ? 1 : 0,
    validationErrorCount: health.validation.errorCount,
    validationWarningCount: health.validation.warningCount,
    failureCount,
    retryableFailureCount,
    retryBudgetExhausted: health.failureState.transition.retryBudget.exhausted ? 1 : 0,
    failureGuardCount: health.failureState.transition.degradedGuards.length,
    failureOperatorActionCount: health.failureState.transition.operatorActions.length,
    incidentSignalCount: health.incident.signals.length,
    incidentActionCount: health.incident.actionPlan.length,
    incidentRetryAdmitted: health.incident.retryAdmission.admitted ? 1 : 0,
    incidentImpactedDomainCount: health.incident.impactedDomains.length,
    healthRouteBlocked: health.healthRouting.routeState === "blocked" ? 1 : 0,
    healthDispatchAllowed: health.healthRouting.dispatch.allowed ? 1 : 0,
    healthEscalationRequired: health.healthRouting.escalation.required ? 1 : 0,
    healthUserFacingError: health.healthRouting.userFacingError ? 1 : 0,
    actionableErrorCount: health.actionableErrors.length,
    riskFlagCount: handoff.riskFlags.length,
    clientDirtyFileCount: handoff.clientWorkflowState.dirtyScope.reportedDirtyFiles.length,
    clientDirtyOutsideAllowedCount: handoff.clientWorkflowState.dirtyScope.outsideAllowedCount,
    clientWorkflowGateFailedCount: handoff.clientWorkflowState.gates.filter((gate) => !gate.passed).length,
    clientCanApply: handoff.clientWorkflowState.state.canApplyFromClient ? 1 : 0,
    clientCanResume: handoff.clientWorkflowState.state.canResumeFromClient ? 1 : 0,
    clientHandoffAcceptanceRequired: handoff.clientWorkflowState.handoffPresentation.acceptanceRequired ? 1 : 0,
    clientHandoffVisible: handoff.clientWorkflowState.handoffPresentation.visible ? 1 : 0,
    clientHandoffProviderSelected: handoff.clientWorkflowState.handoffPresentation.provider ? 1 : 0,
    clientHandoffSupportedChannelCount: clientState.handoffPreferences.capabilities.length
  };
  const currentSnapshot = {
    snapshotId: `${surfaceId}:${request.requestId}:${clientState.sessionId}:current`,
    observedAt: now,
    status: recovery.status,
    healthMode: health.mode,
    route: request.route,
    targetSurface: request.targetSurface,
    writableTargetCount: currentCounters.writableTargetCount,
    blockedTargetCount: currentCounters.blockedTargetCount,
    workspaceScopeDeniedCount: currentCounters.workspaceScopeDeniedCount,
    validationErrorCount: currentCounters.validationErrorCount,
    validationWarningCount: currentCounters.validationWarningCount,
    failureCount: currentCounters.failureCount,
    retryableFailureCount: currentCounters.retryableFailureCount
  };
  const history = [...previousSnapshots, currentSnapshot].slice(-HISTORY_SNAPSHOT_LIMIT);
  const totals = history.reduce((accumulator, snapshot) => {
    accumulator.blockedTargetObservations += snapshot.blockedTargetCount;
    accumulator.validationErrorObservations += snapshot.validationErrorCount;
    accumulator.validationWarningObservations += snapshot.validationWarningCount;
    accumulator.failureObservations += snapshot.failureCount;
    accumulator.retryableFailureObservations += snapshot.retryableFailureCount;
    return accumulator;
  }, {
    blockedTargetObservations: 0,
    validationErrorObservations: 0,
    validationWarningObservations: 0,
    failureObservations: 0,
      retryableFailureObservations: 0
  });
  const reportingWindow = buildAnalyticsWindow(history, currentCounters, request, clientState, now);
  const exportReadiness = buildAnalyticsExportReadiness(
    currentCounters,
    history,
    health,
    contracts,
    handoff,
    evidence,
    now
  );
  const timeline = [
    { phase: "request_normalized", status: "completed", at: now, detail: `${request.assignedFiles.length}:assigned` },
    { phase: "boundary_checked", status: contracts.boundary.enforcement.blocked ? "blocked" : "completed", at: now, detail: contracts.boundary.enforcement.reason },
    { phase: "checkpoint_recovered", status: recovery.status, at: checkpoint.updatedAt, detail: recovery.statusReason },
    { phase: "health_evaluated", status: health.mode, at: health.validation.checkedAt, detail: `${health.validation.errorCount}:errors/${health.validation.warningCount}:warnings` },
    { phase: "handoff_prepared", status: handoff.nextAction, at: now, detail: handoff.idempotencyKey },
    { phase: "analytics_export_evaluated", status: exportReadiness.ready ? "ready" : "blocked", at: now, detail: exportReadiness.blockedReasons[0] || "export_ready" }
  ];
  const exportDigest = stableProofDigest([
    surfaceId,
    request.requestId,
    clientState.sessionId,
    recovery.status,
    health.mode,
    reportingWindow.retainedSnapshotCount,
    exportReadiness.ready,
    JSON.stringify(reportingWindow.deltas),
    handoff.nextAction
  ]);

  return {
    schemaVersion: 1,
    counters: currentCounters,
    history,
    totals,
    reportingWindow,
    exportReadiness,
    timeline,
    exportSummary: {
      exportId: `${surfaceId}:${request.requestId}:${clientState.sessionId}:analytics`,
      exportDigest,
      generatedAt: now,
      surfaceId,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      route: request.route,
      status: recovery.status,
      healthMode: health.mode,
      nextAction: handoff.nextAction,
      lifecycleAction: contracts.lifecycle.controls.nextLifecycleAction,
      lifecycleCommandToken: contracts.lifecycle.commandTransition.commandToken,
      lifecycleRunIntent: contracts.lifecycle.commandTransition.runIntent,
      lifecycleCommandAccepted: contracts.lifecycle.commandTransition.accepted,
      lifecycleDispatchAction: contracts.lifecycle.commandTransition.dispatchPolicy.dispatchAction,
      lifecycleDispatchBlockedReasons: contracts.lifecycle.commandTransition.dispatchPolicy.blockedReasons,
      scheduleMode: contracts.lifecycle.schedule.mode,
      blocked: handoff.riskFlags.length > 0 || health.mode === "failed" || recovery.status === "blocked",
      evidenceCount: currentCounters.evidenceCount,
      riskFlagCount: currentCounters.riskFlagCount,
      retryable: health.retry.retryable,
      nextRetryAt: health.retry.nextRetryAt,
      failureTransitionMode: health.failureState.transition.mode,
      failureDisposition: health.failureState.transition.schedulerDisposition,
      incidentId: health.incident.incidentId,
      incidentSeverity: health.incident.severity,
      incidentStatus: health.incident.status,
      incidentPrimaryCode: health.incident.primaryCode,
      incidentRetryAdmitted: health.incident.retryAdmission.admitted,
      healthRouteState: health.healthRouting.routeState,
      healthDispatchAction: health.healthRouting.dispatch.action,
      healthEscalationReason: health.healthRouting.escalation.reason,
      retryBudgetExhausted: health.failureState.transition.retryBudget.exhausted,
      proofId: contracts.proof.id,
      readyProviderCount: currentCounters.readyProviderCount,
      externalHandoffStateCount: currentCounters.externalHandoffStateCount,
      acceptedExternalHandoffStateCount: currentCounters.acceptedExternalHandoffStateCount,
      pendingExternalHandoffProviderCount: currentCounters.pendingExternalHandoffProviderCount,
      clientWorkflowLane: handoff.clientWorkflowState.state.lane,
      clientPendingAction: handoff.clientWorkflowState.state.nextAction,
      clientHandoffChannel: handoff.clientWorkflowState.handoffPresentation.channel,
      clientHandoffChannelAction: handoff.clientWorkflowState.handoffPresentation.channelAction,
      clientHandoffPresentationId: handoff.clientWorkflowState.handoffPresentation.presentationId,
      clientHandoffDisplayMode: handoff.clientWorkflowState.handoffPresentation.displayMode,
      clientHandoffAcceptanceRequired: handoff.clientWorkflowState.handoffPresentation.acceptanceRequired,
      clientDirtyOutsideAllowedCount: currentCounters.clientDirtyOutsideAllowedCount,
      retainedSnapshotCount: reportingWindow.retainedSnapshotCount,
      failureTrend: reportingWindow.trends.failures,
      validationErrorTrend: reportingWindow.trends.validationErrors,
      blockedTargetTrend: reportingWindow.trends.blockedTargets,
      analyticsExportReady: exportReadiness.ready,
      analyticsExportBlockedReasons: exportReadiness.blockedReasons
    }
  };
}

function buildOperationalHealth(input, request, clientState, checkpoint, contracts, recovery, now) {
  const issues = [];
  const failures = collectFailureEvents(input, checkpoint, request);
  const hasWritableTarget = contracts.scope.writableTargets.length > 0;
  const dirtyOutsideScope = clientState.dirtyFiles.filter((file) => !request.allowedFiles.includes(file));

  if (!request.assignedFiles.length) {
    addValidationIssue(
      issues,
      "error",
      "missing_assigned_scope",
      "No assigned files were provided for the context-pack handoff.",
      "Provide at least one assigned file for the scheduler shard."
    );
  }
  if (request.assignedFiles.length && !hasWritableTarget) {
    addValidationIssue(
      issues,
      "error",
      "no_writable_target",
      "Assigned files are not present in the allowed write scope.",
      "Update allowedFiles or narrow assignedFiles before applying product changes."
    );
  }
  if (contracts.boundary.enforcement.blocked) {
    addValidationIssue(
      issues,
      "error",
      "boundary_blocked",
      `Tenant, workspace, permission, or scope boundary blocked execution: ${contracts.boundary.enforcement.reason}.`,
      "Resolve the boundary reason and retry with a fresh checkpoint."
    );
  }
  if (contracts.boundary.workspaceScope.deniedEntries.length) {
    addValidationIssue(
      issues,
      "error",
      "workspace_scope_denied",
      "One or more assigned targets failed workspace zone, allowed scope, or role permission checks.",
      "Narrow assignedFiles to writable product-code targets or use an actor role with the required permissions.",
      contracts.boundary.workspaceScope.deniedEntries[0].path
    );
  }
  if (contracts.scope.sourceIntegrity.rejectedPathCount) {
    const requiredRejected = contracts.scope.sourceIntegrity.rejectedPaths.find((entry) => entry.required);
    addValidationIssue(
      issues,
      requiredRejected ? "error" : "warning",
      "context_source_path_rejected",
      "One or more context-pack source paths were rejected before worker launch.",
      "Provide workspace-relative source paths without absolute paths, parent traversal, or reserved path segments.",
      requiredRejected?.originalPath || contracts.scope.sourceIntegrity.rejectedPaths[0]?.originalPath || request.targetSurface
    );
  }
  if (contracts.scope.sourceIntegrity.requiredBlockedSourceCount) {
    const blockedSource = contracts.scope.sourceIntegrity.blockedSources.find((entry) => entry.required);
    addValidationIssue(
      issues,
      "error",
      "required_context_source_blocked",
      "A required context-pack source is blocked by source integrity or allowed-scope validation.",
      "Repair the source path or include the source in the allowed scheduler context-pack scope.",
      blockedSource?.path || blockedSource?.originalPath || request.targetSurface
    );
  }
  if (contracts.scope.sourceIntegrity.requiredSupportingOutsideAllowed.length) {
    addValidationIssue(
      issues,
      "warning",
      "required_supporting_source_outside_allowed_scope",
      "A required supporting context source is outside the allowed write scope.",
      "Add the supporting source to allowedFiles when it must be materialized for the worker handoff.",
      contracts.scope.sourceIntegrity.requiredSupportingOutsideAllowed[0]
    );
  }
  if (!contracts.providers.readyProviderIds.length) {
    addValidationIssue(
      issues,
      "error",
      "provider_capability_negotiation_failed",
      "No ready provider contract satisfied the required scheduler context-pack capabilities.",
      "Register a provider that supports context-pack.read, context-pack.write, audit.proof, and handoff.resume.",
      contracts.providers.blockedProviderIds[0]
    );
  }
  if (contracts.providers.staleSyncProviderIds.length) {
    addValidationIssue(
      issues,
      "warning",
      "provider_sync_stale",
      "One or more provider sync cursors are older than the accepted handoff freshness window.",
      "Refresh provider sync metadata before relying on external continuation state.",
      contracts.providers.staleSyncProviderIds[0]
    );
  }
  if (contracts.providers.pendingExternalHandoffProviderIds.length) {
    addValidationIssue(
      issues,
      "warning",
      "provider_handoff_ack_pending",
      "A provider has not accepted the external context-pack handoff state for the current idempotent command.",
      "Wait for the provider acknowledgement or refresh the handoff state before exporting analytics.",
      contracts.providers.pendingExternalHandoffProviderIds[0]
    );
  }
  for (const lifecycleIssue of contracts.lifecycle.settingsValidation.issues) {
    addValidationIssue(
      issues,
      lifecycleIssue.severity,
      lifecycleIssue.code,
      lifecycleIssue.message,
      lifecycleIssue.action
    );
  }
  if (contracts.lifecycle.controls.blockReason === "lifecycle_disabled") {
    addValidationIssue(
      issues,
      "warning",
      "lifecycle_disabled",
      "Context-pack lifecycle controls are disabled for this scheduler surface.",
      "Enable the lifecycle control before applying or scheduling product changes."
    );
  }
  if (contracts.lifecycle.controls.blockReason === "lifecycle_paused") {
    addValidationIssue(
      issues,
      "warning",
      "lifecycle_paused",
      "Context-pack lifecycle controls are paused for this scheduler surface.",
      "Resume the lifecycle control before applying or scheduling product changes."
    );
  }
  if (clientState.tokenBudget !== null && clientState.tokenBudget < contracts.contextBudget * 700) {
    addValidationIssue(
      issues,
      "warning",
      "low_token_budget",
      "The available token budget is below the selected context-pack budget.",
      "Switch to compact prompt mode or provide a larger worker budget."
    );
  }
  if (clientState.elapsedMs > 45_000 && recovery.status !== "completed") {
    addValidationIssue(
      issues,
      "warning",
      "handoff_elapsed_slow",
      "The worker has spent longer than the expected context-pack preparation window.",
      "Resume from the emitted checkpoint or retry with smaller assigned scope."
    );
  }
  if (dirtyOutsideScope.length) {
    addValidationIssue(
      issues,
      "warning",
      "dirty_files_outside_allowed_scope",
      "Runtime reports dirty files outside the allowed scheduler context-pack scope.",
      "Audit dirtyFiles before committing this context-pack handoff.",
      dirtyOutsideScope[0]
    );
  }

  const retry = calculateRetryWindow(checkpoint, failures, now);
  const failureTransition = buildFailureStateTransition(checkpoint, failures, retry, contracts, recovery, now);
  if (failureTransition.retryBudget.exhausted) {
    addValidationIssue(
      issues,
      "error",
      "retry_budget_exhausted",
      `Retry attempt ${failureTransition.retryBudget.attempt} exceeded the scheduler context-pack limit of ${failureTransition.retryBudget.limit}.`,
      "Reset or repair the checkpoint after operator review before retrying.",
      failureTransition.latestFailure?.target || request.targetSurface
    );
  }
  const incident = buildOperationalIncidentContract(
    issues,
    failures,
    retry,
    failureTransition,
    contracts,
    recovery,
    request,
    now
  );
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const degradedReasons = [
    warningCount ? "validation_warnings" : null,
    failures.length ? "recent_failures" : null,
    recovery.resumedFromCheckpoint ? "checkpoint_recovery" : null,
    retry.retryable ? "retry_backoff_active" : null,
    failureTransition.degradedGuards.length ? "failure_transition_guards" : null,
    incident.degradedMode.active ? `incident:${incident.degradedMode.reason}` : null
  ].filter(Boolean);
  const mode = incident.severity === "critical" || errorCount || failureTransition.mode === "failed"
    ? "failed"
    : degradedReasons.length
      ? "degraded"
      : "healthy";
  const healthRouting = buildHealthRoutingEnvelope(
    issues,
    failures,
    retry,
    failureTransition,
    incident,
    contracts,
    recovery,
    request,
    now
  );

  return {
    mode,
    ok: mode !== "failed",
    degraded: mode === "degraded",
    validation: {
      checkedAt: now,
      errorCount,
      warningCount,
      issues
    },
    failureState: {
      status: failures.length ? "observed" : "clear",
      transition: failureTransition,
      failures,
      lastFailureCode: failures.length ? failures[failures.length - 1].code : null
    },
    incident,
    healthRouting,
    retry,
    degradedMode: {
      active: mode === "degraded",
      reasons: degradedReasons,
      safeToProceed: mode !== "failed" && hasWritableTarget,
      operatingLimits: mode === "degraded"
        ? Array.from(new Set([
            "idempotent_commands_only",
            "audit_required_before_handoff",
            ...incident.degradedMode.allowedOperations
          ]))
        : []
    },
    actionableErrors: [
      ...issues.map((issue) => buildActionableError(issue, issue.severity !== "error" && retry.retryable)),
      ...failures.map((failure) => ({
        code: failure.code,
        severity: failure.retryable ? "warning" : "error",
        message: failure.message,
        action: failureTransition.retryBudget.exhausted
          ? "Reset or repair the checkpoint after operator review before retrying."
          : failure.retryable
            ? "Retry after the backoff window or resume from checkpoint."
            : "Escalate with audit proof.",
        target: failure.target,
        retryable: failure.retryable && !failureTransition.retryBudget.exhausted
      }))
    ].slice(0, 12)
  };
}

function buildTenantPermissionBoundary(request, clientState, checkpoint) {
  const actor = normalizeActor({ actor: clientState.actor }, clientState);
  const permissionSet = derivePermissionSet(actor);
  const workspaceScope = buildWorkspaceScopePolicy(request, permissionSet);
  const needsWrite = request.assignedFiles.length > 0;
  const requiredPermissions = Array.from(new Set([
    "context-pack:read",
    "context-pack:audit",
    needsWrite ? "context-pack:write" : null,
    request.handoffRequired ? "context-pack:handoff" : null,
    ...workspaceScope.assignedEntries.flatMap((entry) => entry.requiredPermissions)
  ].filter(Boolean))).sort();
  const missingPermissions = requiredPermissions.filter((permission) => !permissionSet.has(permission));
  const persistedTenantMismatch = checkpoint.tenantId !== request.tenantId;
  const persistedWorkspaceMismatch = checkpoint.workspaceId !== request.workspaceId;
  const rejectedScope = request.rejectedScopeFiles.length > 0;
  const workspaceScopeDenied = workspaceScope.deniedEntries.length > 0;
  const blocked = missingPermissions.length > 0
    || persistedTenantMismatch
    || persistedWorkspaceMismatch
    || rejectedScope
    || workspaceScopeDenied;

  return {
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    actor: {
      actorId: actor.actorId,
      roles: actor.roles,
      effectivePermissions: Array.from(permissionSet).sort()
    },
    requiredPermissions,
    enforcement: {
      blocked,
      reason: missingPermissions.length
        ? `missing_permissions:${missingPermissions.join(",")}`
        : persistedTenantMismatch
          ? "checkpoint_tenant_mismatch"
          : persistedWorkspaceMismatch
            ? "checkpoint_workspace_mismatch"
            : rejectedScope
              ? "unsafe_scope_path_rejected"
              : workspaceScopeDenied
                ? `workspace_scope_denied:${workspaceScope.denialCodes[0] || "target_denied"}`
              : "authorized"
    },
    isolation: {
      checkpointTenantId: checkpoint.tenantId,
      checkpointWorkspaceId: checkpoint.workspaceId,
      persistedTenantMismatch,
      persistedWorkspaceMismatch,
      rejectedScopeFiles: request.rejectedScopeFiles
    },
    workspaceScope
  };
}

function normalizeProviderEntries(input) {
  const candidate = input.integrationProviders
    || input.providerContracts
    || input.providers
    || asObject(input.runtime).integrationProviders;
  if (Array.isArray(candidate)) {
    return candidate.length ? candidate.slice(0, 6) : [{}];
  }
  if (candidate && typeof candidate === "object") {
    return [candidate];
  }
  return [{}];
}

function normalizeProviderHandoffPolicy(provider, input) {
  const policy = asObject(provider.handoffPolicy || provider.externalHandoffPolicy);
  const runtimePolicy = asObject(asObject(input.runtime).providerHandoffPolicy);
  const requiresAcknowledgement = normalizeBoolean(
    policy.requiresAcknowledgement ?? policy.requireAck ?? provider.requiresHandoffAck,
    normalizeBoolean(runtimePolicy.requiresAcknowledgement ?? runtimePolicy.requireAck, false)
  );
  const acceptedStatuses = normalizeStringList(
    policy.acceptedStatuses || runtimePolicy.acceptedStatuses,
    6
  ).map((status) => status.toLowerCase());
  const freshnessMs = Math.max(
    30_000,
    Math.floor(Number(policy.freshnessMs ?? runtimePolicy.freshnessMs) || 180_000)
  );

  return {
    requiresAcknowledgement,
    acceptedStatuses: acceptedStatuses.length ? acceptedStatuses : ["accepted", "committed", "stored"],
    freshnessMs,
    conflictPolicy: asTrimmedString(
      policy.conflictPolicy,
      asTrimmedString(runtimePolicy.conflictPolicy, "idempotent_state_id")
    )
  };
}

function normalizeProviderHandoffAcknowledgement(provider, providerId, externalStateId, checkpoint, now, policy) {
  const handoff = asObject(provider.externalHandoff || provider.handoff);
  const acknowledgement = asObject(
    provider.handoffAck
      || provider.acknowledgement
      || handoff.acknowledgement
      || handoff.ack
  );
  const status = asTrimmedString(
    acknowledgement.status,
    policy.requiresAcknowledgement ? "pending" : "accepted"
  ).toLowerCase();
  const acknowledgedAt = asTrimmedString(
    acknowledgement.acknowledgedAt,
    asTrimmedString(acknowledgement.committedAt, asTrimmedString(acknowledgement.updatedAt, now))
  );
  const acknowledgedMs = Date.parse(acknowledgedAt);
  const nowMs = Date.parse(now);
  const ageMs = Number.isFinite(acknowledgedMs) && Number.isFinite(nowMs)
    ? Math.max(0, nowMs - acknowledgedMs)
    : null;
  const stale = ageMs === null ? false : ageMs > policy.freshnessMs;
  const acknowledgedStateId = asTrimmedString(
    acknowledgement.stateId,
    asTrimmedString(handoff.stateId, externalStateId)
  );
  const acknowledgedCommandId = asTrimmedString(
    acknowledgement.commandId,
    asTrimmedString(handoff.commandId, checkpoint.pendingCommand.id)
  );
  const statusAccepted = policy.acceptedStatuses.includes(status);
  const stateMatches = acknowledgedStateId === externalStateId;
  const commandMatches = acknowledgedCommandId === checkpoint.pendingCommand.id;
  const accepted = statusAccepted && stateMatches && commandMatches && !stale;

  return {
    providerId,
    status,
    accepted,
    stateMatches,
    commandMatches,
    stale,
    acknowledgedAt,
    ageMs,
    freshnessMs: policy.freshnessMs,
    acknowledgedStateId,
    acknowledgedCommandId,
    acknowledgementId: asTrimmedString(
      acknowledgement.acknowledgementId,
      stableProofDigest([providerId, externalStateId, acknowledgedCommandId, status, acknowledgedAt])
    ),
    rejectionReason: accepted
      ? null
      : !statusAccepted
        ? `handoff_status:${status}`
        : !stateMatches
          ? "state_id_mismatch"
          : !commandMatches
            ? "command_id_mismatch"
            : stale
              ? "handoff_ack_stale"
              : "handoff_ack_pending"
  };
}

function buildProviderServiceContracts(input, request, clientState, checkpoint, now) {
  const requestedCapabilities = normalizeStringList(
    input.requiredProviderCapabilities || asObject(input.request).requiredProviderCapabilities,
    10
  );
  const requiredCapabilities = requestedCapabilities.length
    ? requestedCapabilities
    : REQUIRED_PROVIDER_CAPABILITIES;
  const optionalCapabilities = normalizeStringList(
    input.optionalProviderCapabilities || asObject(input.request).optionalProviderCapabilities,
    10
  );
  const wantedOptional = optionalCapabilities.length ? optionalCapabilities : OPTIONAL_PROVIDER_CAPABILITIES;

  const providers = normalizeProviderEntries(input).map((entry, index) => {
    const provider = asObject(entry);
    const supportedCapabilities = normalizeStringList(
      provider.capabilities || provider.supportedCapabilities,
      16
    );
    const effectiveCapabilities = supportedCapabilities.length
      ? supportedCapabilities
      : [...requiredCapabilities, "sync.cursor", "analytics.export"];
    const capabilitySet = new Set(effectiveCapabilities);
    const missingRequired = requiredCapabilities.filter((capability) => !capabilitySet.has(capability));
    const negotiatedCapabilities = [
      ...requiredCapabilities.filter((capability) => capabilitySet.has(capability)),
      ...wantedOptional.filter((capability) => capabilitySet.has(capability))
    ];
    const syncState = asObject(provider.sync || provider.syncState);
    const staleAfterMs = Math.max(30_000, Math.floor(Number(syncState.staleAfterMs) || 120_000));
    const lastSyncedAt = asTrimmedString(
      syncState.lastSyncedAt,
      asTrimmedString(syncState.syncedAt, checkpoint.updatedAt)
    );
    const lastSyncedMs = Date.parse(lastSyncedAt);
    const nowMs = Date.parse(now);
    const syncStale = Number.isFinite(lastSyncedMs) && Number.isFinite(nowMs)
      ? nowMs - lastSyncedMs > staleAfterMs
      : false;
    const providerId = asTrimmedString(
      provider.providerId,
      asTrimmedString(provider.id, index === 0 ? DEFAULT_PROVIDER_ID : `${DEFAULT_PROVIDER_ID}-${index + 1}`)
    );
    const externalStateId = asTrimmedString(
      provider.externalStateId,
      `${request.tenantId}:${request.workspaceId}:${request.requestId}:${providerId}`
    );
    const handoffPolicy = normalizeProviderHandoffPolicy(provider, input);
    const handoffAcknowledgement = normalizeProviderHandoffAcknowledgement(
      provider,
      providerId,
      externalStateId,
      checkpoint,
      now,
      handoffPolicy
    );
    const handoffAccepted = missingRequired.length === 0
      && (!handoffPolicy.requiresAcknowledgement || handoffAcknowledgement.accepted);
    const status = missingRequired.length
      ? "blocked"
      : syncStale
        ? "degraded"
        : "ready";

    return {
      providerId,
      serviceName: asTrimmedString(provider.serviceName, "scheduler-context-pack"),
      contractVersion: Math.max(1, Math.floor(Number(provider.contractVersion) || PROVIDER_CONTRACT_VERSION)),
      transport: asTrimmedString(provider.transport, "hosted-kernel"),
      endpoint: asTrimmedString(provider.endpoint, "hosted-kernel://scheduler/context-pack"),
      status,
      capabilityNegotiation: {
        requiredCapabilities,
        optionalCapabilities: wantedOptional,
        supportedCapabilities: effectiveCapabilities,
        negotiatedCapabilities,
        missingRequired
      },
      sync: {
        cursor: asTrimmedString(syncState.cursor, checkpoint.lastCommandId || checkpoint.checkpointId),
        sequence: Math.max(0, Math.floor(Number(syncState.sequence) || checkpoint.restartCount)),
        direction: asTrimmedString(syncState.direction, "kernel_to_provider"),
        lastSyncedAt,
        staleAfterMs,
        stale: syncStale
      },
      externalHandoff: {
        stateId: externalStateId,
        resumeToken: `${surfaceId}:${providerId}:${checkpoint.pendingCommand.id}`,
        exportable: handoffAccepted && !syncStale,
        acceptanceStatus: handoffAccepted
          ? "accepted"
          : missingRequired.length
            ? "blocked_missing_capabilities"
            : handoffPolicy.requiresAcknowledgement
              ? handoffAcknowledgement.rejectionReason || "handoff_ack_pending"
              : "sync_refresh_required",
        acknowledgementRequired: handoffPolicy.requiresAcknowledgement,
        claims: {
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          clientSession: clientState.sessionId,
          targetSurface: request.targetSurface,
          checkpointId: checkpoint.checkpointId,
          commandId: checkpoint.pendingCommand.id
        }
      },
      handoffPolicy,
      handoffAcknowledgement
    };
  });

  return {
    schemaVersion: 1,
    requiredCapabilities,
    providers,
    readyProviderIds: providers.filter((provider) => provider.status !== "blocked").map((provider) => provider.providerId),
    blockedProviderIds: providers.filter((provider) => provider.status === "blocked").map((provider) => provider.providerId),
    staleSyncProviderIds: providers.filter((provider) => provider.sync.stale).map((provider) => provider.providerId),
    externalHandoffStates: providers.map((provider) => provider.externalHandoff),
    acceptedExternalHandoffStateIds: providers
      .filter((provider) => provider.externalHandoff.exportable)
      .map((provider) => provider.externalHandoff.stateId),
    pendingExternalHandoffProviderIds: providers
      .filter((provider) => provider.status !== "blocked" && !provider.externalHandoff.exportable)
      .map((provider) => provider.providerId),
    handoffAcknowledgements: providers.map((provider) => provider.handoffAcknowledgement)
  };
}

function normalizeLifecycleCommand(value) {
  const command = asTrimmedString(value, "prepare").toLowerCase();
  return [
    "prepare",
    "enable",
    "disable",
    "pause",
    "resume",
    "schedule",
    "schedule_now",
    "cancel_scheduled"
  ].includes(command)
    ? command
    : "prepare";
}

function normalizeScheduleMode(value) {
  const mode = asTrimmedString(value, "manual").toLowerCase();
  return ["manual", "disabled", "interval", "at"].includes(mode) ? mode : "manual";
}

function normalizeLifecycleRunEntries(value, clientState, now, limit = 8) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const nowMs = Date.parse(now);

  return entries.map((item, index) => {
    const run = asObject(item);
    const status = asTrimmedString(run.status, "running").toLowerCase();
    const startedAt = asTrimmedString(run.startedAt, asTrimmedString(run.createdAt, now));
    const leaseMs = Math.max(30_000, Math.floor(Number(run.leaseMs) || DEFAULT_COMMAND_LEASE_MS));
    const startedAtMs = Date.parse(startedAt);
    const ageMs = Number.isFinite(startedAtMs) && Number.isFinite(nowMs)
      ? Math.max(0, nowMs - startedAtMs)
      : null;
    const expired = ageMs === null ? false : ageMs > leaseMs;
    const active = ["pending", "running", "recovering"].includes(status) && !expired;

    return {
      runId: asTrimmedString(run.runId, asTrimmedString(run.id, `${clientState.sessionId}:run:${index + 1}`)),
      commandId: asTrimmedString(run.commandId, null),
      owner: asTrimmedString(run.owner, asTrimmedString(run.clientId, clientState.clientId)),
      sessionId: asTrimmedString(run.sessionId, asTrimmedString(run.leaseSession, null)),
      status,
      startedAt,
      leaseMs,
      ageMs,
      expired,
      active
    };
  }).filter((run) => run.runId).slice(0, limit);
}

function buildLifecycleDispatchPolicy(command, lifecycle, clientState, now) {
  const nowMs = Date.parse(now);
  const notBeforeMs = Date.parse(lifecycle.notBefore);
  const activeRuns = normalizeLifecycleRunEntries(lifecycle.activeRuns, clientState, now);
  const activeRunCount = activeRuns.filter((run) => run.active).length;
  const runRequested = command === "schedule_now" || lifecycle.scheduleDue;
  const notBeforeActive = Boolean(lifecycle.notBefore)
    && Number.isFinite(notBeforeMs)
    && Number.isFinite(nowMs)
    && notBeforeMs > nowMs;
  const concurrencyAvailable = activeRunCount < lifecycle.maxConcurrentRuns;
  const blockedReasons = [
    lifecycle.commandRejectedReason,
    lifecycle.enabled ? null : "lifecycle_disabled",
    lifecycle.paused ? "lifecycle_paused" : null,
    lifecycle.scheduleMode === "disabled" ? "schedule_disabled" : null,
    runRequested && !concurrencyAvailable ? "max_concurrent_runs_reached" : null,
    runRequested && notBeforeActive ? "dispatch_not_before_window" : null
  ].filter(Boolean);
  const canDispatch = runRequested
    && blockedReasons.length === 0
    && lifecycle.enabled
    && !lifecycle.paused
    && concurrencyAvailable;
  const canQueue = !canDispatch
    && lifecycle.enabled
    && !lifecycle.paused
    && blockedReasons.every((reason) => [
      "max_concurrent_runs_reached",
      "dispatch_not_before_window",
      "schedule_disabled"
    ].includes(reason))
    && (lifecycle.scheduleMode === "interval" || lifecycle.scheduleMode === "at" || runRequested);
  const dispatchAction = canDispatch
    ? "dispatch_lifecycle_run"
    : canQueue
      ? "queue_lifecycle_run"
      : blockedReasons.length
        ? "hold_lifecycle_dispatch"
        : "await_lifecycle_trigger";

  return {
    contractType: "scheduler.context-pack.lifecycle_dispatch_policy.v1",
    evaluatedAt: now,
    dispatchAction,
    canDispatch,
    canQueue,
    blockedReasons,
    runRequested,
    notBefore: lifecycle.notBefore || null,
    concurrency: {
      activeRunCount,
      maxConcurrentRuns: lifecycle.maxConcurrentRuns,
      availableSlots: Math.max(0, lifecycle.maxConcurrentRuns - activeRunCount),
      limitReached: !concurrencyAvailable,
      activeRuns
    },
    nextActionState: {
      action: dispatchAction,
      reason: blockedReasons[0] || (canDispatch ? "dispatch_ready" : "waiting_for_trigger"),
      notBefore: notBeforeActive ? lifecycle.notBefore : null,
      selectedRunId: activeRuns.find((run) => run.active && run.sessionId === clientState.sessionId)?.runId || null
    },
    proofSignals: [
      `dispatchAction:${dispatchAction}`,
      `activeRuns:${activeRunCount}/${lifecycle.maxConcurrentRuns}`,
      blockedReasons.length ? `dispatchBlocked:${blockedReasons[0]}` : "dispatchReady"
    ]
  };
}

function buildLifecycleCommandTransition(command, lifecycle, checkpoint, clientState, now) {
  const commandRejected = Boolean(lifecycle.commandRejectedReason);
  const previousLifecycle = asObject(checkpoint.lifecycle);
  const previousRevision = Math.max(0, Math.floor(Number(previousLifecycle.revision) || 0));
  const stateRevision = previousRevision + (commandRejected ? 0 : 1);
  const dispatchPolicy = buildLifecycleDispatchPolicy(command, lifecycle, clientState, now);
  const commandToken = stableProofDigest([
    checkpoint.checkpointId,
    command,
    lifecycle.enabled,
    lifecycle.paused,
    lifecycle.scheduleMode,
    lifecycle.nextRunAt,
    lifecycle.scheduleDue,
    clientState.sessionId
  ]);
  const materializedNextRunAt = !lifecycle.enabled || command === "disable" || command === "cancel_scheduled"
    ? null
    : command === "schedule_now"
      ? dispatchPolicy.nextActionState.notBefore || now
      : lifecycle.scheduleMode === "interval" && lifecycle.intervalMs
        ? addMillisecondsIso(now, lifecycle.intervalMs)
        : lifecycle.nextRunAt;
  const runIntent = command === "schedule_now" || lifecycle.scheduleDue
    ? "run_now"
    : lifecycle.scheduleMode === "interval" || lifecycle.scheduleMode === "at"
      ? "scheduled"
      : "manual";
  const commandEffects = [
    command === "enable" ? "set_enabled_true" : null,
    command === "disable" ? "set_enabled_false" : null,
    command === "pause" ? "set_paused_true" : null,
    command === "resume" ? "set_paused_false" : null,
    command === "cancel_scheduled" ? "clear_scheduled_run" : null,
    command === "schedule_now" ? "materialize_immediate_run" : null,
    command === "schedule" && lifecycle.scheduleMode === "interval" ? "materialize_interval_schedule" : null,
    command === "schedule" && lifecycle.scheduleMode === "at" ? "materialize_one_shot_schedule" : null
  ].filter(Boolean);

  return {
    contractType: "scheduler.context-pack.lifecycle_command_transition.v1",
    command,
    commandToken,
    accepted: !commandRejected,
    blockedReason: lifecycle.commandRejectedReason,
    executionBlockedReason: lifecycle.blockedReason,
    dispatchPolicy,
    stateRevision,
    previousRevision,
    runIntent,
    materializedNextRunAt,
    commandEffects,
    nextActionState: {
      enabled: lifecycle.enabled,
      paused: lifecycle.paused,
      scheduleMode: command === "cancel_scheduled" || command === "disable" ? "manual" : lifecycle.scheduleMode,
      due: lifecycle.scheduleDue && !commandRejected,
      canDispatch: dispatchPolicy.canDispatch,
      canQueue: dispatchPolicy.canQueue,
      dispatchAction: dispatchPolicy.dispatchAction,
      dispatchBlockedReasons: dispatchPolicy.blockedReasons,
      terminalHold: !lifecycle.enabled || Boolean(lifecycle.blockedReason),
      updatedBy: clientState.clientId,
      updatedAt: now
    },
    audit: {
      previousEnabled: normalizeBoolean(previousLifecycle.enabled, true),
      previousPaused: normalizeBoolean(previousLifecycle.paused, false),
      previousScheduleMode: normalizeScheduleMode(previousLifecycle.scheduleMode || previousLifecycle.mode),
      previousNextRunAt: asTrimmedString(previousLifecycle.nextRunAt, null),
      commandRejected,
      effectCount: commandEffects.length
    }
  };
}

function buildLifecycleControls(input, request, clientState, checkpoint, now) {
  const requestSettings = asObject(asObject(input.request).lifecycleSettings || asObject(input.request).settings);
  const runtimeSettings = asObject(asObject(input.runtime).lifecycleSettings || asObject(input.runtime).settings);
  const settings = {
    ...runtimeSettings,
    ...requestSettings,
    ...asObject(input.lifecycleSettings || input.schedulerSettings || input.settings)
  };
  const schedule = asObject(settings.schedule || settings.scheduling);
  const command = normalizeLifecycleCommand(input.lifecycleCommand || settings.command || settings.requestedCommand);
  const persistedLifecycle = asObject(checkpoint.lifecycle || settings.persistedLifecycle);
  const defaultEnabled = persistedLifecycle.enabled !== undefined
    ? normalizeBoolean(persistedLifecycle.enabled, true)
    : true;
  const enabled = command === "enable"
    ? true
    : command === "disable"
      ? false
      : normalizeBoolean(settings.enabled, defaultEnabled);
  const defaultPaused = normalizeBoolean(persistedLifecycle.paused, false);
  const paused = command === "pause"
    ? true
    : command === "resume"
      ? false
      : normalizeBoolean(settings.paused, defaultPaused);
  const scheduleMode = command === "cancel_scheduled"
    ? "manual"
    : command === "schedule_now"
      ? "manual"
      : normalizeScheduleMode(schedule.mode || settings.scheduleMode);
  const rawIntervalMs = Number(schedule.intervalMs ?? settings.intervalMs);
  const intervalMs = Number.isFinite(rawIntervalMs) && rawIntervalMs > 0
    ? Math.floor(rawIntervalMs)
    : null;
  const minIntervalMs = Math.max(60_000, Math.floor(Number(schedule.minIntervalMs) || 60_000));
  const maxIntervalMs = Math.max(minIntervalMs, Math.floor(Number(schedule.maxIntervalMs) || 24 * 60 * 60_000));
  const nextRunAt = asTrimmedString(
    schedule.nextRunAt,
    asTrimmedString(settings.nextRunAt, asTrimmedString(persistedLifecycle.nextRunAt, null))
  );
  const notBefore = asTrimmedString(
    schedule.notBefore,
    asTrimmedString(settings.notBefore, asTrimmedString(persistedLifecycle.notBefore, null))
  );
  const nextRunMs = Date.parse(nextRunAt);
  const notBeforeMs = Date.parse(notBefore);
  const nowMs = Date.parse(now);
  const hasValidNextRun = Boolean(nextRunAt) && Number.isFinite(nextRunMs);
  const hasValidNotBefore = Boolean(notBefore) && Number.isFinite(notBeforeMs);
  const scheduleDue = command === "schedule_now"
    || (hasValidNextRun && Number.isFinite(nowMs) && nextRunMs <= nowMs);
  const maxConcurrentRuns = Math.max(1, Math.floor(Number(schedule.maxConcurrentRuns) || 1));
  const activeRuns = schedule.activeRuns
    || settings.activeRuns
    || asObject(input.runtime).activeContextPackRuns
    || asObject(input.runtime).activeRuns
    || persistedLifecycle.activeRuns;
  const activeRunCount = normalizeLifecycleRunEntries(activeRuns, clientState, now)
    .filter((run) => run.active).length;
  const validationIssues = [];

  if (scheduleMode === "interval" && intervalMs === null) {
    validationIssues.push({
      severity: "error",
      code: "missing_schedule_interval",
      message: "Interval scheduling requires schedule.intervalMs.",
      action: "Set intervalMs or switch schedule.mode to manual."
    });
  }
  if (intervalMs !== null && (intervalMs < minIntervalMs || intervalMs > maxIntervalMs)) {
    validationIssues.push({
      severity: "error",
      code: "schedule_interval_out_of_bounds",
      message: `Schedule interval ${intervalMs}ms is outside ${minIntervalMs}-${maxIntervalMs}ms.`,
      action: "Choose an interval inside the hosted-kernel scheduler bounds."
    });
  }
  if (scheduleMode === "at" && !hasValidNextRun) {
    validationIssues.push({
      severity: "error",
      code: "invalid_scheduled_run_at",
      message: "One-shot scheduling requires a valid schedule.nextRunAt timestamp.",
      action: "Provide an ISO timestamp for nextRunAt or cancel the schedule."
    });
  }
  if (!enabled && ["resume", "schedule", "schedule_now"].includes(command)) {
    validationIssues.push({
      severity: "error",
      code: "lifecycle_command_requires_enabled_surface",
      message: `Lifecycle command ${command} cannot execute while context-pack is disabled.`,
      action: "Enable context-pack before resuming or scheduling work."
    });
  }
  if (command === "schedule" && !["interval", "at"].includes(scheduleMode)) {
    validationIssues.push({
      severity: "error",
      code: "schedule_command_requires_schedule_mode",
      message: "Lifecycle command schedule requires schedule.mode to be interval or at.",
      action: "Choose interval scheduling with intervalMs or one-shot scheduling with nextRunAt."
    });
  }
  if (command === "disable" && scheduleMode !== "manual" && hasValidNextRun) {
    validationIssues.push({
      severity: "warning",
      code: "disable_clears_pending_schedule",
      message: "Disabling context-pack will clear the pending scheduled run.",
      action: "Re-enable and schedule again when the hosted-kernel surface should run."
    });
  }
  if (notBefore && !hasValidNotBefore) {
    validationIssues.push({
      severity: "error",
      code: "invalid_dispatch_not_before",
      message: "Lifecycle dispatch notBefore must be a valid ISO timestamp.",
      action: "Provide a valid schedule.notBefore timestamp or remove the dispatch hold."
    });
  }
  if ((command === "schedule_now" || scheduleDue) && activeRunCount >= maxConcurrentRuns) {
    validationIssues.push({
      severity: "warning",
      code: "max_concurrent_runs_reached",
      message: `Lifecycle dispatch has ${activeRunCount} active run(s), which meets the maxConcurrentRuns limit of ${maxConcurrentRuns}.`,
      action: "Wait for an active context-pack run to finish or raise maxConcurrentRuns."
    });
  }

  const commandRejectedReason = validationIssues.some((issue) => issue.severity === "error")
    ? validationIssues.find((issue) => issue.severity === "error").code
    : null;
  const blockedReason = !enabled
    ? "lifecycle_disabled"
    : paused
      ? "lifecycle_paused"
      : commandRejectedReason
        ? commandRejectedReason
        : (command === "schedule_now" || scheduleDue) && activeRunCount >= maxConcurrentRuns
          ? "max_concurrent_runs_reached"
        : scheduleMode === "disabled"
          ? "schedule_disabled"
          : null;
  const nextLifecycleAction = blockedReason === "lifecycle_disabled"
    ? "enable_context_pack"
    : blockedReason === "lifecycle_paused"
      ? "resume_context_pack"
      : blockedReason
        ? blockedReason === "max_concurrent_runs_reached" ? "wait_for_active_context_pack_run" : "repair_lifecycle_settings"
        : scheduleMode === "at" && !scheduleDue
          ? "wait_for_scheduled_context_pack"
          : command === "cancel_scheduled"
            ? "prepare_context_pack"
            : command === "schedule_now" || scheduleDue
              ? "run_scheduled_context_pack"
              : "prepare_context_pack";
  const lifecycleTransition = buildLifecycleCommandTransition(
    command,
    {
      enabled,
      paused,
      blockedReason,
      commandRejectedReason,
      scheduleMode,
      intervalMs,
      nextRunAt: hasValidNextRun ? nextRunAt : null,
      scheduleDue,
      notBefore: hasValidNotBefore ? notBefore : null,
      activeRuns,
      maxConcurrentRuns
    },
    checkpoint,
    clientState,
    now
  );

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.lifecycle_controls.v1",
    command,
    controls: {
      enabled,
      paused,
      executionBlocked: Boolean(blockedReason),
      blockReason: blockedReason,
      nextLifecycleAction,
      canRunNow: enabled && !paused && !blockedReason && (scheduleMode !== "at" || scheduleDue),
      canSchedule: enabled && !paused && scheduleMode !== "disabled"
    },
    schedule: {
      mode: scheduleMode,
      intervalMs,
      minIntervalMs,
      maxIntervalMs,
      nextRunAt: hasValidNextRun ? nextRunAt : null,
      due: scheduleDue,
      timezone: asTrimmedString(schedule.timezone, asTrimmedString(settings.timezone, "UTC")),
      maxConcurrentRuns,
      activeRunCount,
      notBefore: hasValidNotBefore ? notBefore : null,
      dispatchPolicy: lifecycleTransition.dispatchPolicy
    },
    commandTransition: lifecycleTransition,
    settingsValidation: {
      checkedAt: now,
      issueCount: validationIssues.length,
      issues: validationIssues
    },
    statePatch: {
      enabled,
      paused,
      scheduleMode: lifecycleTransition.nextActionState.scheduleMode,
      nextRunAt: lifecycleTransition.materializedNextRunAt,
      revision: lifecycleTransition.stateRevision,
      commandToken: lifecycleTransition.commandToken,
      runIntent: lifecycleTransition.runIntent,
      dispatchAction: lifecycleTransition.dispatchPolicy.dispatchAction,
      dispatchBlockedReasons: lifecycleTransition.dispatchPolicy.blockedReasons,
      activeRunCount,
      maxConcurrentRuns,
      notBefore: hasValidNotBefore ? notBefore : null,
      commandAccepted: lifecycleTransition.accepted,
      updatedBy: clientState.clientId,
      updatedAt: now,
      checkpointId: checkpoint.checkpointId
    }
  };
}

function buildRuntimeContracts(input, request, clientState, evidence, checkpoint, now) {
  const contextBudget = selectContextBudget(request.promptMode || clientState.promptMode);
  const boundary = buildTenantPermissionBoundary(request, clientState, checkpoint);
  const writableTargets = boundary.workspaceScope.writableTargets;
  const blockedTargets = boundary.workspaceScope.deniedTargets;
  const providerContracts = buildProviderServiceContracts(input, request, clientState, checkpoint, now);
  const lifecycle = buildLifecycleControls(input, request, clientState, checkpoint, now);
  const scopeContract = {
    targetSurface: request.targetSurface,
    assignedFiles: request.assignedFiles,
    allowedFiles: request.allowedFiles,
    writableTargets,
    blockedTargets,
    workspaceZones: boundary.workspaceScope.zoneCounts,
    workspaceScopeEntries: boundary.workspaceScope.assignedEntries.map((entry) => ({
      path: entry.path,
      zone: entry.zone,
      mutability: entry.mutability,
      inAllowedScope: entry.inAllowedScope,
      writable: entry.writable,
      denialReasons: entry.denialReasons
    }))
  };
  const sourceIntegrity = buildContextSourceIntegrity(input, request, { scope: scopeContract }, now);
  const proofSignals = [
    `surface:${surfaceId}`,
    `route:${request.route}`,
    `mode:${request.promptMode}`,
    `contextBudget:${contextBudget}`,
    `tenant:${boundary.tenantId}`,
    `workspace:${boundary.workspaceId}`,
    `boundary:${boundary.enforcement.reason}`,
    `workspaceZones:${Object.keys(boundary.workspaceScope.zoneCounts).sort().join(",") || "none"}`,
    `lifecycle:${lifecycle.controls.blockReason || lifecycle.controls.nextLifecycleAction}`,
    `lifecycleCommand:${lifecycle.commandTransition.command}:${lifecycle.commandTransition.accepted ? "accepted" : "blocked"}`,
    `lifecycleRunIntent:${lifecycle.commandTransition.runIntent}`,
    `lifecycleDispatch:${lifecycle.commandTransition.dispatchPolicy.dispatchAction}`,
    `schedule:${lifecycle.schedule.mode}`,
    `providers:${providerContracts.providers.length}`,
    `readyProviders:${providerContracts.readyProviderIds.length}`,
    `acceptedHandoffStates:${providerContracts.acceptedExternalHandoffStateIds.length}`,
    `pendingHandoffProviders:${providerContracts.pendingExternalHandoffProviderIds.length}`,
    ...sourceIntegrity.proofSignals
  ];

  if (writableTargets.length) {
    proofSignals.push(`writableTargets:${writableTargets.length}`);
  }
  if (blockedTargets.length) {
    proofSignals.push(`blockedTargets:${blockedTargets.length}`);
  }
  if (boundary.workspaceScope.denialCodes.length) {
    proofSignals.push(`workspaceScopeDenied:${boundary.workspaceScope.denialCodes.join(",")}`);
  }
  if (providerContracts.blockedProviderIds.length) {
    proofSignals.push(`blockedProviders:${providerContracts.blockedProviderIds.join(",")}`);
  }
  if (providerContracts.staleSyncProviderIds.length) {
    proofSignals.push(`staleProviderSync:${providerContracts.staleSyncProviderIds.join(",")}`);
  }
  if (providerContracts.pendingExternalHandoffProviderIds.length) {
    proofSignals.push(`pendingProviderHandoff:${providerContracts.pendingExternalHandoffProviderIds.join(",")}`);
  }
  if (sourceIntegrity.rejectedPathCount) {
    proofSignals.push(`sourcePathRejected:${sourceIntegrity.rejectedPaths[0]?.reason || "unsafe_source_path"}`);
  }
  if (sourceIntegrity.requiredBlockedSourceCount) {
    proofSignals.push(`sourceRequiredBlocked:${sourceIntegrity.blockedSources[0]?.reason || "source_blocked"}`);
  }

  return {
    contextBudget,
    scope: {
      ...scopeContract,
      sourceIntegrity
    },
    lifecycle,
    boundary,
    providers: providerContracts,
    proof: {
      id: `${surfaceId}:${request.requestId}`,
      generatedBy: "hosted-kernel-context-pack",
      signals: proofSignals,
      evidenceCount: evidence.length,
      clientSession: clientState.sessionId
    }
  };
}

function selectClientHandoffChannel(preferences, recovery, health, selectedProvider, canApplyFromClient) {
  const supported = new Set(preferences.capabilities);
  const preferred = preferences.preferredChannel;
  const candidates = [
    health.mode === "failed" || recovery.status === "blocked" ? "audit_receipt" : null,
    canApplyFromClient ? "inline_preview" : null,
    recovery.canResume ? "resume_panel" : null,
    selectedProvider?.externalHandoff.exportable ? "external_provider" : null,
    preferred,
    "command_palette",
    "audit_receipt"
  ].filter(Boolean);

  return candidates.find((channel) => supported.has(channel)) || "command_palette";
}

function buildClientHandoffPresentation(request, clientState, contracts, recovery, health, nextAction, firstTarget, selectedProvider, canApplyFromClient) {
  const preferences = clientState.handoffPreferences;
  const channel = selectClientHandoffChannel(preferences, recovery, health, selectedProvider, canApplyFromClient);
  const providerAccepted = Boolean(selectedProvider?.externalHandoff.exportable);
  const acceptanceRequired = preferences.requiresExplicitAcceptance
    && recovery.status !== "completed"
    && channel !== "audit_receipt";
  const channelAction = channel === "inline_preview"
    ? "open_context_pack_preview"
    : channel === "resume_panel"
      ? "open_resume_panel"
      : channel === "external_provider"
        ? "handoff_to_provider_state"
        : channel === "audit_receipt"
          ? "show_audit_receipt"
          : "open_command_palette_action";
  const channelReason = channel === "audit_receipt"
    ? health.mode === "failed" ? "health_blocked_audit_required" : recovery.status === "blocked" ? "recovery_blocked_audit_required" : "audit_requested"
    : channel === "resume_panel"
      ? "checkpoint_resume_available"
      : channel === "external_provider"
        ? providerAccepted ? "accepted_provider_handoff_state" : "provider_handoff_selected"
        : channel === "inline_preview"
          ? "client_can_apply_from_preview"
          : "fallback_command_palette";
  const buttonLabel = channel === "inline_preview"
    ? "Open preview"
    : channel === "resume_panel"
      ? "Resume"
      : channel === "external_provider"
        ? "Continue in provider"
        : channel === "audit_receipt"
          ? "View audit"
          : "Open action";
  const presentationId = stableProofDigest([
    surfaceId,
    request.requestId,
    clientState.sessionId,
    channel,
    nextAction,
    recovery.checkpointId,
    selectedProvider?.externalHandoff.stateId || "no-provider"
  ]);

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.client_handoff_presentation.v1",
    presentationId,
    generatedForClient: clientState.clientId,
    channel,
    channelAction,
    channelReason,
    displayMode: preferences.displayMode,
    visible: preferences.displayMode !== "silent" || health.mode === "failed",
    acceptanceRequired,
    buttonLabel,
    target: {
      surface: request.targetSurface,
      file: firstTarget,
      route: request.route
    },
    provider: selectedProvider
      ? {
          providerId: selectedProvider.providerId,
          transport: selectedProvider.transport,
          endpoint: selectedProvider.endpoint,
          stateId: selectedProvider.externalHandoff.stateId,
          resumeToken: selectedProvider.externalHandoff.resumeToken,
          accepted: providerAccepted,
          acceptanceStatus: selectedProvider.externalHandoff.acceptanceStatus
        }
      : null,
    routePayload: {
      requestId: request.requestId,
      checkpointId: recovery.checkpointId,
      commandId: recovery.commandId,
      idempotencyKey: recovery.idempotencyKey,
      nextAction,
      channel,
      targetFile: firstTarget,
    providerStateId: selectedProvider?.externalHandoff.stateId || null,
    resumeToken: selectedProvider?.externalHandoff.resumeToken || recovery.idempotencyKey,
    lifecycleCommandToken: contracts.lifecycle.commandTransition.commandToken,
    healthRouteState: health.healthRouting.routeState,
    retrievalPrimaryPath: firstTarget,
    retrievalExpectedAction: canApplyFromClient ? "open_preloaded_or_fetch_target" : "review_context_pack_gate"
    },
    proofSignals: [
      `clientHandoffChannel:${channel}`,
      `clientHandoffAction:${channelAction}`,
      `clientHandoffVisible:${preferences.displayMode !== "silent" || health.mode === "failed"}`,
      acceptanceRequired ? "clientHandoffAcceptance:required" : "clientHandoffAcceptance:not_required",
      providerAccepted ? `clientHandoffProvider:${selectedProvider.providerId}` : null
    ].filter(Boolean)
  };
}

function buildClientWorkflowState(request, clientState, contracts, recovery, health, nextAction, firstTarget) {
  const allowedSet = new Set(request.allowedFiles);
  const assignedSet = new Set(request.assignedFiles);
  const dirtyInsideAllowed = clientState.dirtyFiles.filter((file) => allowedSet.has(file));
  const dirtyAssignedTargets = clientState.dirtyFiles.filter((file) => assignedSet.has(file));
  const dirtyOutsideAllowed = clientState.dirtyFiles.filter((file) => !allowedSet.has(file));
  const selectedProvider = contracts.providers.providers.find((provider) => (
    provider.status === "ready" && provider.externalHandoff.exportable
  ))
    || contracts.providers.providers.find((provider) => provider.externalHandoff.exportable)
    || contracts.providers.providers.find((provider) => provider.status === "ready")
    || contracts.providers.providers.find((provider) => provider.status === "degraded")
    || null;
  const canApplyFromClient = Boolean(firstTarget)
    && health.ok
    && recovery.status !== "blocked"
    && recovery.status !== "completed"
    && !contracts.boundary.enforcement.blocked
    && !contracts.lifecycle.controls.executionBlocked
    && dirtyOutsideAllowed.length === 0;
  const handoffLane = recovery.status === "completed"
    ? "complete"
    : recovery.status === "blocked" || health.mode === "failed"
      ? "blocked"
      : dirtyOutsideAllowed.length
        ? "review_dirty_scope"
        : recovery.resumedFromCheckpoint
          ? "resume"
          : health.degraded
            ? "review_warnings"
            : canApplyFromClient
              ? "apply"
              : "prepare";
  const visibleStep = handoffLane === "apply"
    ? `Apply product delta to ${firstTarget}`
    : handoffLane === "resume"
      ? `Resume ${request.targetSurface} from checkpoint`
      : handoffLane === "review_dirty_scope"
        ? "Review dirty files outside the allowed scope"
        : handoffLane === "blocked"
          ? "Resolve blocking scheduler context-pack issue"
          : handoffLane === "complete"
            ? "Checkpoint already completed"
          : "Prepare scheduler context-pack handoff";
  const handoffPresentation = buildClientHandoffPresentation(
    request,
    clientState,
    contracts,
    recovery,
    health,
    nextAction,
    firstTarget,
    selectedProvider,
    canApplyFromClient
  );

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.client_workflow_state.v1",
    session: {
      clientId: clientState.clientId,
      sessionId: clientState.sessionId,
      promptMode: clientState.promptMode,
      elapsedMs: clientState.elapsedMs,
      tokenBudget: clientState.tokenBudget
    },
    state: {
      lane: handoffLane,
      visibleStep,
      nextAction,
      targetFile: firstTarget,
      canApplyFromClient,
      canResumeFromClient: recovery.canResume && dirtyOutsideAllowed.length === 0,
      requiresUserReview: handoffLane === "review_dirty_scope" || handoffLane === "review_warnings",
      selectedProviderId: selectedProvider?.providerId || null,
      selectedExternalStateId: selectedProvider?.externalHandoff.stateId || null,
      selectedExternalStateAccepted: selectedProvider?.externalHandoff.exportable || false,
      selectedExternalStateAcceptanceStatus: selectedProvider?.externalHandoff.acceptanceStatus || null,
      lifecycleCommandToken: contracts.lifecycle.commandTransition.commandToken,
      lifecycleRunIntent: contracts.lifecycle.commandTransition.runIntent,
      lifecycleCanDispatch: contracts.lifecycle.commandTransition.nextActionState.canDispatch,
      lifecycleCanQueue: contracts.lifecycle.commandTransition.nextActionState.canQueue,
      lifecycleDispatchAction: contracts.lifecycle.commandTransition.dispatchPolicy.dispatchAction,
      lifecycleDispatchBlockedReasons: contracts.lifecycle.commandTransition.dispatchPolicy.blockedReasons,
      handoffChannel: handoffPresentation.channel,
      handoffChannelAction: handoffPresentation.channelAction,
      handoffDisplayMode: handoffPresentation.displayMode,
      handoffAcceptanceRequired: handoffPresentation.acceptanceRequired,
      handoffPresentationId: handoffPresentation.presentationId
    },
    handoffPresentation,
    dirtyScope: {
      reportedDirtyFiles: clientState.dirtyFiles,
      insideAllowed: dirtyInsideAllowed,
      assignedTargets: dirtyAssignedTargets,
      outsideAllowed: dirtyOutsideAllowed,
      outsideAllowedCount: dirtyOutsideAllowed.length
    },
    resumeDescriptor: {
      checkpointId: recovery.checkpointId,
      commandId: recovery.commandId,
      idempotencyKey: recovery.idempotencyKey,
      resumeToken: selectedProvider?.externalHandoff.resumeToken || recovery.idempotencyKey,
      providerTransport: selectedProvider?.transport || null,
      providerEndpoint: selectedProvider?.endpoint || null
    },
    clientStatePatch: {
      requestId: request.requestId,
      route: request.route,
      targetSurface: request.targetSurface,
      workflowLane: handoffLane,
      pendingAction: nextAction,
      lifecycleCommandToken: contracts.lifecycle.commandTransition.commandToken,
      lifecycleRunIntent: contracts.lifecycle.commandTransition.runIntent,
      lifecycleDispatchAction: contracts.lifecycle.commandTransition.dispatchPolicy.dispatchAction,
      lifecycleDispatchBlockedReasons: contracts.lifecycle.commandTransition.dispatchPolicy.blockedReasons,
      lifecycleStateRevision: contracts.lifecycle.commandTransition.stateRevision,
      handoffChannel: handoffPresentation.channel,
      handoffChannelAction: handoffPresentation.channelAction,
      handoffPresentationId: handoffPresentation.presentationId,
      handoffAcceptanceRequired: handoffPresentation.acceptanceRequired,
      handoffVisible: handoffPresentation.visible,
      targetFile: firstTarget,
      checkpointId: recovery.checkpointId,
      providerStateId: selectedProvider?.externalHandoff.stateId || null,
      providerHandoffAccepted: selectedProvider?.externalHandoff.exportable || false,
      providerHandoffAcceptanceStatus: selectedProvider?.externalHandoff.acceptanceStatus || null,
      dirtyOutsideAllowedCount: dirtyOutsideAllowed.length
    },
    gates: [
      { id: "health_ok", passed: health.ok, detail: health.mode },
      { id: "boundary_authorized", passed: !contracts.boundary.enforcement.blocked, detail: contracts.boundary.enforcement.reason },
      { id: "lifecycle_runnable", passed: !contracts.lifecycle.controls.executionBlocked, detail: contracts.lifecycle.controls.blockReason || contracts.lifecycle.controls.nextLifecycleAction },
      { id: "lifecycle_command_accepted", passed: contracts.lifecycle.commandTransition.accepted, detail: contracts.lifecycle.commandTransition.blockedReason || contracts.lifecycle.commandTransition.runIntent },
      { id: "scope_clean", passed: dirtyOutsideAllowed.length === 0, detail: `${dirtyOutsideAllowed.length}:dirty_outside_allowed` },
      { id: "target_selected", passed: Boolean(firstTarget), detail: firstTarget || "no_writable_target" },
      { id: "handoff_channel_supported", passed: clientState.handoffPreferences.capabilities.includes(handoffPresentation.channel), detail: handoffPresentation.channel }
    ]
  };
}

function buildWorkflowHandoff(request, clientState, contracts, recovery, health) {
  const firstTarget = contracts.scope.writableTargets[0] || request.assignedFiles[0] || null;
  const nextAction = recovery.status === "completed"
    ? "noop_completed_checkpoint"
    : contracts.lifecycle.controls.executionBlocked
      ? contracts.lifecycle.controls.nextLifecycleAction
    : health.mode === "failed"
      ? "resolve_context_pack_health_errors"
    : contracts.boundary.enforcement.blocked
      ? "handoff_boundary_audit"
    : health.healthRouting.dispatch.nextAction === "continue_in_degraded_mode"
      ? "continue_context_pack_with_health_audit"
    : health.retry.retryable
      ? "wait_for_retry_backoff"
    : contracts.lifecycle.controls.nextLifecycleAction !== "prepare_context_pack"
      ? contracts.lifecycle.controls.nextLifecycleAction
    : firstTarget
      ? `apply_product_delta:${firstTarget}`
      : "request_scope_clarification";
  const clientWorkflowState = buildClientWorkflowState(
    request,
    clientState,
    contracts,
    recovery,
    health,
    nextAction,
    firstTarget
  );

  return {
    visibleToUser: true,
    status: recovery.status,
    statusReason: recovery.statusReason,
    nextAction,
    route: request.route,
    checklist: [
      "read_assigned_surface",
      "negotiate_provider_contract",
      "shape_runtime_contract",
      "validate_lifecycle_settings",
      "sync_external_handoff_state",
      "emit_audit_proof",
      firstTarget ? "handoff_with_target_file" : "handoff_blocked_without_target"
    ],
    restartSafe: recovery.restartSafe,
    idempotencyKey: recovery.idempotencyKey,
    verifierCommands: request.verifierCatalog,
    tenantId: contracts.boundary.tenantId,
    workspaceId: contracts.boundary.workspaceId,
    requiredPermissions: contracts.boundary.requiredPermissions,
    lifecycleControls: contracts.lifecycle,
    providerContracts: contracts.providers.providers.map((provider) => ({
      providerId: provider.providerId,
      status: provider.status,
      negotiatedCapabilities: provider.capabilityNegotiation.negotiatedCapabilities,
      missingRequired: provider.capabilityNegotiation.missingRequired,
      sync: provider.sync,
      externalStateId: provider.externalHandoff.stateId,
      exportable: provider.externalHandoff.exportable,
      acceptanceStatus: provider.externalHandoff.acceptanceStatus,
      acknowledgementRequired: provider.externalHandoff.acknowledgementRequired,
      acknowledgement: provider.handoffAcknowledgement
    })),
    externalHandoffStates: contracts.providers.externalHandoffStates,
    clientWorkflowState,
    clientHandoffPresentation: clientWorkflowState.handoffPresentation,
    healthMode: health.mode,
    retry: health.retry,
    failureTransition: health.failureState.transition,
    operationalIncident: health.incident,
    healthRouting: health.healthRouting,
    actionableErrors: health.actionableErrors,
    riskFlags: [
      ...contracts.scope.blockedTargets.map((file) => `assigned_not_allowed:${file}`),
      ...contracts.boundary.workspaceScope.denialCodes.map((code) => `workspace_scope:${code}`),
      ...contracts.scope.sourceIntegrity.rejectedPaths.map((entry) => `source_path_rejected:${entry.reason}:${entry.originalPath}`),
      ...contracts.scope.sourceIntegrity.blockedSources.map((entry) => `context_source_blocked:${entry.reason}:${entry.path || entry.originalPath}`),
      ...contracts.scope.sourceIntegrity.requiredSupportingOutsideAllowed.map((path) => `supporting_source_outside_allowed:${path}`),
      ...clientWorkflowState.dirtyScope.outsideAllowed.map((file) => `client_dirty_outside_allowed:${file}`),
      ...contracts.boundary.isolation.rejectedScopeFiles.map((file) => `unsafe_scope:${file}`),
      ...contracts.providers.blockedProviderIds.map((providerId) => `provider_blocked:${providerId}`),
      ...contracts.providers.staleSyncProviderIds.map((providerId) => `provider_sync_stale:${providerId}`),
      ...contracts.providers.pendingExternalHandoffProviderIds.map((providerId) => `provider_handoff_pending:${providerId}`),
      contracts.lifecycle.controls.blockReason ? `lifecycle:${contracts.lifecycle.controls.blockReason}` : null,
      contracts.lifecycle.schedule.due ? "schedule_due" : null,
      contracts.boundary.enforcement.blocked ? contracts.boundary.enforcement.reason : null,
      health.degraded ? "degraded_mode" : null,
      health.retry.retryable ? `retry_after:${health.retry.nextRetryAt || health.retry.backoffMs}` : null,
      health.failureState.transition.retryBudget.exhausted ? "retry_budget_exhausted" : null,
      health.failureState.transition.mode !== "clear" ? `failure_transition:${health.failureState.transition.mode}` : null,
      health.incident.severity !== "clear" ? `incident:${health.incident.severity}:${health.incident.primaryCode || "unknown"}` : null,
      health.healthRouting.routeState !== "dispatch_ready" ? `health_route:${health.healthRouting.routeState}` : null,
      health.healthRouting.escalation.required ? `health_escalation:${health.healthRouting.escalation.reason}` : null,
      ...health.incident.retryAdmission.blockedReasons.map((reason) => `retry_blocked:${reason}`),
      ...health.incident.impactedDomains.map((domain) => `incident_domain:${domain}`),
      ...health.failureState.transition.degradedGuards.map((guard) => `failure_guard:${guard}`),
      ...health.validation.issues.map((issue) => `health_${issue.severity}:${issue.code}`)
    ].filter(Boolean)
  };
}

function normalizeAcceptanceInput(input) {
  const acceptance = asObject(input.acceptance || input.previewAcceptance || input.userAcceptance);
  const rawDecision = asTrimmedString(acceptance.decision, asTrimmedString(input.acceptanceDecision, "pending"))
    .toLowerCase();
  const decision = ["pending", "accepted", "rejected", "changes_requested"].includes(rawDecision)
    ? rawDecision
    : "pending";

  return {
    decision,
    acceptedBy: asTrimmedString(acceptance.acceptedBy, asTrimmedString(acceptance.actorId, null)),
    decidedAt: asTrimmedString(acceptance.decidedAt, asTrimmedString(acceptance.acceptedAt, null)),
    note: asTrimmedString(acceptance.note, asTrimmedString(acceptance.reason, "")),
    requestedChanges: normalizeStringList(acceptance.requestedChanges || acceptance.changes, 6)
  };
}

function buildReadinessChecks(request, contracts, recovery, health, handoff) {
  return [
    {
      id: "scope_writable",
      label: "Assigned scope can be written",
      passed: contracts.scope.writableTargets.length > 0,
      detail: contracts.scope.writableTargets.length
        ? `${contracts.scope.writableTargets.length} writable target(s)`
        : "No assigned files are inside allowedFiles"
    },
    {
      id: "boundary_authorized",
      label: "Tenant, workspace, and actor boundary authorized",
      passed: !contracts.boundary.enforcement.blocked,
      detail: contracts.boundary.enforcement.reason
    },
    {
      id: "provider_ready",
      label: "Hosted-kernel provider contract ready",
      passed: contracts.providers.readyProviderIds.length > 0,
      detail: contracts.providers.readyProviderIds.length
        ? `${contracts.providers.readyProviderIds.length} ready provider(s)`
        : "No provider satisfies required capabilities"
    },
    {
      id: "validation_clean",
      label: "Validation has no blocking errors",
      passed: health.validation.errorCount === 0,
      detail: `${health.validation.errorCount} error(s), ${health.validation.warningCount} warning(s)`
    },
    {
      id: "lifecycle_runnable",
      label: "Lifecycle controls allow execution",
      passed: !contracts.lifecycle.controls.executionBlocked,
      detail: contracts.lifecycle.controls.blockReason || contracts.lifecycle.controls.nextLifecycleAction
    },
    {
      id: "handoff_actionable",
      label: "Next action can be executed or resumed",
      passed: !handoff.riskFlags.length && recovery.status !== "blocked",
      detail: handoff.nextAction
    }
  ];
}

function buildPreviewAcceptanceContract(input, request, clientState, contracts, recovery, health, handoff, now) {
  const acceptanceInput = normalizeAcceptanceInput(input);
  const checks = buildReadinessChecks(request, contracts, recovery, health, handoff);
  const blockers = [
    ...checks.filter((check) => !check.passed).map((check) => check.id),
    ...health.validation.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code)
  ].slice(0, 12);
  const warnings = health.validation.issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.code)
    .slice(0, 12);
  const canAccept = blockers.length === 0 && recovery.status !== "completed";
  const accepted = acceptanceInput.decision === "accepted" && canAccept;
  const previewStatus = recovery.status === "completed"
    ? "complete"
    : canAccept
      ? health.degraded ? "ready_with_warnings" : "ready"
      : "blocked";
  const primaryTarget = contracts.scope.writableTargets[0] || null;

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.preview_acceptance.v1",
    preview: {
      previewId: `${surfaceId}:${request.requestId}:${clientState.sessionId}:preview`,
      generatedAt: now,
      visibleToUser: true,
      title: `${surfaceName} handoff for ${request.targetSurface}`,
      status: previewStatus,
      headline: canAccept
        ? `Ready to ${handoff.nextAction}`
        : blockers.length
          ? `Blocked by ${blockers[0]}`
          : "Waiting for scheduler recovery",
      targetSurface: request.targetSurface,
      route: request.route,
      writableTargets: contracts.scope.writableTargets,
      blockedTargets: contracts.scope.blockedTargets
    },
    readiness: {
      status: previewStatus,
      ready: canAccept,
      canAccept,
      canApply: accepted && Boolean(primaryTarget),
      canResume: recovery.canResume,
      checks,
      blockers,
      warnings
    },
    validationSummary: {
      checkedAt: health.validation.checkedAt,
      errorCount: health.validation.errorCount,
      warningCount: health.validation.warningCount,
      mode: health.mode,
      topIssues: health.validation.issues.slice(0, 5).map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        action: issue.action,
        target: issue.target
      }))
    },
    acceptance: {
      state: accepted ? "accepted" : acceptanceInput.decision,
      accepted,
      acceptedBy: accepted ? acceptanceInput.acceptedBy || clientState.clientId : null,
      acceptedAt: accepted ? acceptanceInput.decidedAt || now : null,
      note: acceptanceInput.note,
      requestedChanges: acceptanceInput.decision === "changes_requested"
        ? acceptanceInput.requestedChanges
        : [],
      acceptanceToken: accepted
        ? `${recovery.idempotencyKey}:accepted:${clientState.sessionId}`
        : null,
      rejectionReason: acceptanceInput.decision === "accepted" && !canAccept
        ? blockers[0] || "not_ready"
        : null
    },
    explainableNextStep: {
      primaryAction: accepted && primaryTarget ? `apply_product_delta:${primaryTarget}` : handoff.nextAction,
      reason: accepted
        ? "user_accepted_ready_preview"
        : canAccept
          ? "awaiting_user_acceptance"
          : blockers[0] || recovery.statusReason,
      routePayload: {
        route: request.route,
        commandId: recovery.commandId,
        idempotencyKey: recovery.idempotencyKey,
        targetSurface: request.targetSurface,
        targetFile: primaryTarget,
        lifecycleAction: contracts.lifecycle.controls.nextLifecycleAction,
      scheduleMode: contracts.lifecycle.schedule.mode,
      scheduleDue: contracts.lifecycle.schedule.due,
      lifecycleCommandToken: contracts.lifecycle.commandTransition.commandToken,
      lifecycleRunIntent: contracts.lifecycle.commandTransition.runIntent,
      checkpointId: recovery.checkpointId,
        proofId: contracts.proof.id
      },
      alternatives: [
        health.retry.retryable ? "wait_for_retry_backoff" : null,
        contracts.boundary.enforcement.blocked ? "handoff_boundary_audit" : null,
        warnings.length ? "accept_with_warnings_after_review" : null,
        "view_audit_proof"
      ].filter(Boolean)
    }
  };
}

function buildPreviewRouteClientContract(
  request,
  clientState,
  contracts,
  recovery,
  health,
  handoff,
  contextPackArtifact,
  analytics,
  previewAcceptance,
  now
) {
  const failedChecks = previewAcceptance.readiness.checks.filter((check) => !check.passed);
  const warningChecks = previewAcceptance.readiness.checks.filter((check) => (
    check.passed && ["validation_clean", "handoff_actionable"].includes(check.id)
  ));
  const accepted = previewAcceptance.acceptance.accepted;
  const submitDisabledReasons = [
    previewAcceptance.readiness.canAccept ? null : previewAcceptance.readiness.blockers[0] || "preview_not_ready",
    recovery.status === "completed" ? "checkpoint_already_completed" : null,
    health.healthRouting.escalation.required ? `health_escalation:${health.healthRouting.escalation.reason}` : null
  ].filter(Boolean);
  const exportWarnings = [
    analytics.exportReadiness.ready ? null : `analytics_export:${analytics.exportReadiness.blockedReasons[0] || "blocked"}`
  ].filter(Boolean);
  const primaryRouteAction = accepted
    ? previewAcceptance.explainableNextStep.primaryAction
    : previewAcceptance.readiness.canAccept
      ? "submit_preview_acceptance"
      : "resolve_preview_blockers";
  const primaryButtonLabel = accepted
    ? "Continue"
    : previewAcceptance.readiness.canAccept
      ? health.validation.warningCount ? "Accept with warnings" : "Accept preview"
      : "Review blockers";
  const validationBanner = health.validation.errorCount
    ? "error"
    : health.validation.warningCount
      ? "warning"
      : "success";
  const routeContractId = `${previewAcceptance.preview.previewId}:route`;
  const displayDigest = stableProofDigest([
    routeContractId,
    previewAcceptance.preview.status,
    previewAcceptance.acceptance.state,
    primaryRouteAction,
    contextPackArtifact.auditProof.digest,
    analytics.exportSummary.exportDigest,
    previewAcceptance.readiness.blockers.join("|"),
    previewAcceptance.readiness.warnings.join("|")
  ]);

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.preview_route_client.v1",
    routeContractId,
    generatedAt: now,
    client: {
      clientId: clientState.clientId,
      sessionId: clientState.sessionId,
      route: request.route,
      targetSurface: request.targetSurface,
      promptMode: clientState.promptMode
    },
    previewPanel: {
      visible: true,
      status: previewAcceptance.preview.status,
      headline: previewAcceptance.preview.headline,
      subhead: `${previewAcceptance.preview.writableTargets.length} writable / ${previewAcceptance.preview.blockedTargets.length} blocked target(s)`,
      badges: [
        `health:${health.mode}`,
        `readiness:${previewAcceptance.readiness.ready ? "ready" : "blocked"}`,
        `acceptance:${previewAcceptance.acceptance.state}`,
        analytics.exportReadiness.ready ? "analytics:export_ready" : "analytics:export_blocked"
      ],
      targetRows: [
        ...previewAcceptance.preview.writableTargets.map((path) => ({
          path,
          status: "writable",
          zone: contracts.scope.workspaceScopeEntries.find((entry) => entry.path === path)?.zone || "workspace_other"
        })),
        ...previewAcceptance.preview.blockedTargets.map((path) => ({
          path,
          status: "blocked",
          zone: contracts.scope.workspaceScopeEntries.find((entry) => entry.path === path)?.zone || "workspace_other"
        }))
      ].slice(0, 12)
    },
    readinessMeter: {
      passedCount: previewAcceptance.readiness.checks.length - failedChecks.length,
      totalCount: previewAcceptance.readiness.checks.length,
      failedChecks: failedChecks.map((check) => ({ id: check.id, label: check.label, detail: check.detail })),
      warningChecks: warningChecks.map((check) => ({ id: check.id, label: check.label, detail: check.detail })),
      blockers: previewAcceptance.readiness.blockers,
      warnings: [...previewAcceptance.readiness.warnings, ...exportWarnings].slice(0, 12)
    },
    validationBanner: {
      tone: validationBanner,
      title: validationBanner === "error"
        ? "Resolve validation errors before accepting"
        : validationBanner === "warning"
          ? "Review warnings before accepting"
          : "Validation passed",
      errorCount: health.validation.errorCount,
      warningCount: health.validation.warningCount,
      issueRows: previewAcceptance.validationSummary.topIssues
    },
    acceptanceGate: {
      required: true,
      decision: previewAcceptance.acceptance.state,
      accepted,
      submitEnabled: previewAcceptance.readiness.canAccept && !accepted,
      submitDisabledReasons: accepted ? [] : submitDisabledReasons.slice(0, 8),
      acceptedBy: previewAcceptance.acceptance.acceptedBy,
      acceptedAt: previewAcceptance.acceptance.acceptedAt,
      acceptanceToken: previewAcceptance.acceptance.acceptanceToken,
      routeSubmission: {
        method: "POST",
        action: "scheduler.context-pack.accept_preview",
        payload: {
          requestId: request.requestId,
          previewId: previewAcceptance.preview.previewId,
          checkpointId: recovery.checkpointId,
          commandId: recovery.commandId,
          idempotencyKey: recovery.idempotencyKey,
          proofDigest: contextPackArtifact.auditProof.digest
        }
      }
    },
    nextStepCard: {
      primaryAction: primaryRouteAction,
      primaryButtonLabel,
      enabled: accepted || previewAcceptance.readiness.canAccept || failedChecks.length > 0,
      reason: previewAcceptance.explainableNextStep.reason,
      routePayload: {
        ...previewAcceptance.explainableNextStep.routePayload,
        contextPackId: contextPackArtifact.packId,
        analyticsExportId: analytics.exportSummary.exportId,
        displayDigest
      },
      alternatives: previewAcceptance.explainableNextStep.alternatives
    },
    retrievalHandoffPanel: {
      visible: true,
      status: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.status,
      nextClientAction: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.nextClientAction,
      queueId: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.queueId,
      summary: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.summary,
      rows: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.queueItems.map((item) => ({
        path: item.path,
        status: item.status,
        clientAction: item.clientAction,
        displayLabel: item.displayLabel,
        mountPath: item.mountPath,
        writable: item.writable,
        blockedReason: item.readiness.blockedReason
      })).slice(0, 12)
    },
    proofReceipt: {
      proofId: contracts.proof.id,
      contextPackDigest: contextPackArtifact.auditProof.digest,
      analyticsExportDigest: analytics.exportSummary.exportDigest,
      displayDigest,
      proofSignals: [
        `previewRoute:${primaryRouteAction}`,
        `previewStatus:${previewAcceptance.preview.status}`,
        `acceptance:${previewAcceptance.acceptance.state}`,
        `readiness:${previewAcceptance.readiness.ready}`,
        `validation:${validationBanner}`,
        `retrievalQueue:${contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.status}`
      ]
    }
  };
}

function buildAssignedFileRetrievalPlan(request, contracts, includedSources, omittedSources) {
  const includedByPath = new Map(
    includedSources
      .filter((source) => source.path)
      .map((source) => [source.path, source])
  );
  const omittedByPath = new Map(
    omittedSources
      .filter((source) => source.path)
      .map((source) => [source.path, source])
  );

  return request.assignedFiles.map((path, index) => {
    const source = includedByPath.get(path) || null;
    const omission = omittedByPath.get(path) || null;
    const scopeEntry = contracts.scope.workspaceScopeEntries.find((entry) => entry.path === path);
    const writable = contracts.scope.writableTargets.includes(path);
    const retrievalStatus = source
      ? "included"
      : omission
        ? "blocked"
        : "missing_source";

    return {
      retrievalId: `assigned-file:${index + 1}`,
      path,
      sourceId: source?.sourceId || omission?.sourceId || `assigned:${index + 1}`,
      status: retrievalStatus,
      required: true,
      access: writable ? "read_write" : "read_only",
      zone: scopeEntry?.zone || "workspace_other",
      mutability: scopeEntry?.mutability || "restricted",
      mountPath: `/workspace/${path}`,
      estimatedTokens: source?.estimatedTokens || omission?.estimatedTokens || estimateContextTokens(path),
      blockedReason: retrievalStatus === "blocked"
        ? omission.reason
        : retrievalStatus === "missing_source"
          ? "assigned_source_not_materialized"
          : null
    };
  });
}

function buildCompactMemoryMounts(includedSources, assignedRetrievalPlan, contracts) {
  const retrievalByPath = new Map(
    assignedRetrievalPlan.map((entry) => [entry.path, entry])
  );

  return includedSources.map((source, index) => {
    const assignedRetrieval = source.path ? retrievalByPath.get(source.path) : null;
    const mountKind = assignedRetrieval
      ? "assigned_file"
      : source.path
        ? "supporting_file"
        : source.sourceType === "runtime"
          ? "runtime_context"
          : "retrieval_context";
    const writable = Boolean(assignedRetrieval && contracts.scope.writableTargets.includes(source.path));
    const priority = assignedRetrieval
      ? "required"
      : source.required
        ? "high"
        : "supplemental";

    return {
      mountId: `memory:${index + 1}`,
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      kind: mountKind,
      path: source.path,
      mountPath: assignedRetrieval?.mountPath || (source.path ? `/readonly/${source.path}` : `/memory/${source.sourceId}`),
      priority,
      required: source.required,
      writable,
      access: writable ? "read_write" : "read_only",
      provenance: source.provenance,
      estimatedTokens: source.estimatedTokens,
      retrievalId: assignedRetrieval?.retrievalId || null,
      lifecycle: {
        load: priority === "required" ? "preload_before_worker_start" : "lazy_load_on_reference",
        persist: writable ? "persist_on_acceptance" : "discard_after_launch",
        audit: "include_in_context_pack_digest"
      }
    };
  });
}

function buildWorkerRetrievalManifest(request, contracts, assignedFileRetrieval, memoryMounts, omittedSources) {
  const writableMountIds = new Set(memoryMounts.filter((mount) => mount.writable).map((mount) => mount.mountId));
  const assignedMountsByPath = new Map(
    memoryMounts
      .filter((mount) => mount.kind === "assigned_file" && mount.path)
      .map((mount) => [mount.path, mount])
  );
  const omittedRequiredByPath = new Map(
    omittedSources
      .filter((source) => source.required && source.path)
      .map((source) => [source.path, source])
  );
  const retrievalEntries = assignedFileRetrieval.map((entry) => {
    const memoryMount = assignedMountsByPath.get(entry.path) || null;
    const omittedSource = omittedRequiredByPath.get(entry.path) || null;
    const scopeEntry = contracts.scope.workspaceScopeEntries.find((candidate) => candidate.path === entry.path);
    const preload = entry.status === "included" && Boolean(memoryMount);
    const fetchAction = preload
      ? "use_preloaded_memory_mount"
      : entry.status === "missing_source"
        ? "fetch_assigned_file_before_launch"
        : "hold_for_scope_or_integrity_repair";

    return {
      retrievalId: entry.retrievalId,
      path: entry.path,
      sourceId: entry.sourceId,
      status: entry.status,
      fetchAction,
      preload,
      required: true,
      zone: entry.zone,
      writable: entry.access === "read_write",
      mountId: memoryMount?.mountId || null,
      mountPath: memoryMount?.mountPath || entry.mountPath,
      digestInput: `${entry.path}:${entry.status}:${memoryMount?.mountId || "unmounted"}`,
      blockedReason: entry.blockedReason || omittedSource?.reason || null,
      workspacePolicy: {
        mutability: entry.mutability,
        inAllowedScope: scopeEntry?.inAllowedScope || false,
        denialReasons: scopeEntry?.denialReasons || []
      }
    };
  });
  const preloadEntries = retrievalEntries.filter((entry) => entry.preload);
  const deferredFetchEntries = retrievalEntries.filter((entry) => entry.fetchAction === "fetch_assigned_file_before_launch");
  const blockedEntries = retrievalEntries.filter((entry) => entry.fetchAction === "hold_for_scope_or_integrity_repair");
  const memoryBudget = {
    mountCount: memoryMounts.length,
    assignedMountCount: preloadEntries.length,
    writableMountCount: memoryMounts.filter((mount) => writableMountIds.has(mount.mountId)).length,
    readOnlyMountCount: memoryMounts.filter((mount) => !writableMountIds.has(mount.mountId)).length,
    estimatedTokens: memoryMounts.reduce((total, mount) => total + mount.estimatedTokens, 0)
  };

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.worker_retrieval_manifest.v1",
    manifestId: `${surfaceId}:${request.requestId}:retrieval`,
    mode: request.promptMode === "compact" ? "assigned_files_first" : "standard_priority",
    status: blockedEntries.length
      ? "blocked"
      : deferredFetchEntries.length
        ? "requires_prefetch"
        : "ready",
    retrievalEntries,
    preloadMountIds: preloadEntries.map((entry) => entry.mountId).filter(Boolean),
    deferredFetches: deferredFetchEntries.map((entry) => ({
      retrievalId: entry.retrievalId,
      path: entry.path,
      mountPath: entry.mountPath,
      reason: "assigned_file_not_preloaded"
    })),
    blockedRetrievals: blockedEntries.map((entry) => ({
      retrievalId: entry.retrievalId,
      path: entry.path,
      reason: entry.blockedReason || "retrieval_blocked",
      denialReasons: entry.workspacePolicy.denialReasons
    })),
    memoryBudget,
    proofSignals: [
      `retrievalManifest:${blockedEntries.length ? "blocked" : deferredFetchEntries.length ? "prefetch" : "ready"}`,
      `retrievalPreload:${preloadEntries.length}/${assignedFileRetrieval.length}`,
      deferredFetchEntries.length ? `retrievalDeferred:${deferredFetchEntries.length}` : null,
      blockedEntries.length ? `retrievalBlocked:${blockedEntries[0].blockedReason || "blocked"}` : null,
      `retrievalMemoryTokens:${memoryBudget.estimatedTokens}`
    ].filter(Boolean)
  };
}

function buildClientRetrievalHandoffQueue(request, clientState, retrievalManifest, memoryMounts, recovery) {
  const mountById = new Map(memoryMounts.map((mount) => [mount.mountId, mount]));
  const queueItems = retrievalManifest.retrievalEntries.map((entry, index) => {
    const mount = entry.mountId ? mountById.get(entry.mountId) : null;
    const clientAction = entry.fetchAction === "use_preloaded_memory_mount"
      ? "open_preloaded_mount"
      : entry.fetchAction === "fetch_assigned_file_before_launch"
        ? "fetch_assigned_file"
        : "repair_retrieval_blocker";
    const userVisibleState = entry.fetchAction === "hold_for_scope_or_integrity_repair"
      ? "blocked"
      : entry.preload
        ? "ready"
        : "needs_prefetch";

    return {
      queueItemId: `retrieval-handoff:${index + 1}`,
      retrievalId: entry.retrievalId,
      path: entry.path,
      mountId: entry.mountId,
      mountPath: entry.mountPath,
      status: userVisibleState,
      clientAction,
      requiredBeforeLaunch: entry.required,
      writable: entry.writable,
      displayLabel: entry.writable ? `Edit ${entry.path}` : `Read ${entry.path}`,
      routePayload: {
        requestId: request.requestId,
        sessionId: clientState.sessionId,
        checkpointId: recovery.checkpointId,
        retrievalId: entry.retrievalId,
        path: entry.path,
        mountPath: entry.mountPath,
        sourceId: entry.sourceId,
        action: clientAction
      },
      readiness: {
        preloaded: entry.preload,
        memoryMounted: Boolean(mount),
        blockedReason: entry.blockedReason,
        denialReasons: entry.workspacePolicy.denialReasons
      }
    };
  });
  const blockedItems = queueItems.filter((item) => item.status === "blocked");
  const prefetchItems = queueItems.filter((item) => item.status === "needs_prefetch");
  const readyItems = queueItems.filter((item) => item.status === "ready");
  const nextClientAction = blockedItems.length
    ? "show_retrieval_blockers"
    : prefetchItems.length
      ? "prefetch_assigned_files"
      : "open_preloaded_worker_context";

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.client_retrieval_handoff_queue.v1",
    queueId: `${retrievalManifest.manifestId}:${clientState.sessionId}:client-queue`,
    status: blockedItems.length
      ? "blocked"
      : prefetchItems.length
        ? "prefetch_required"
        : "ready",
    nextClientAction,
    queueItems,
    summary: {
      totalCount: queueItems.length,
      readyCount: readyItems.length,
      prefetchCount: prefetchItems.length,
      blockedCount: blockedItems.length,
      writableCount: queueItems.filter((item) => item.writable).length,
      primaryPath: queueItems[0]?.path || null
    },
    clientStatePatch: {
      retrievalQueueId: `${retrievalManifest.manifestId}:${clientState.sessionId}:client-queue`,
      retrievalQueueStatus: blockedItems.length ? "blocked" : prefetchItems.length ? "prefetch_required" : "ready",
      retrievalNextAction: nextClientAction,
      retrievalPrimaryPath: queueItems[0]?.path || null,
      retrievalPrefetchPaths: prefetchItems.map((item) => item.path),
      retrievalBlockedPaths: blockedItems.map((item) => item.path)
    },
    proofSignals: [
      `clientRetrievalQueue:${blockedItems.length ? "blocked" : prefetchItems.length ? "prefetch_required" : "ready"}`,
      `clientRetrievalReady:${readyItems.length}/${queueItems.length}`,
      prefetchItems.length ? `clientRetrievalPrefetch:${prefetchItems.length}` : null,
      blockedItems.length ? `clientRetrievalBlocked:${blockedItems[0].readiness.blockedReason || "blocked"}` : null
    ].filter(Boolean)
  };
}

function buildCompactWorkerSandboxEnvelope(request, clientState, contracts, assignedFileRetrieval, memoryMounts, retrievalManifest, digest, now) {
  const permissionSet = new Set(contracts.boundary.actor.effectivePermissions);
  const assignedSet = new Set(request.assignedFiles);
  const allowedSet = new Set(request.allowedFiles);
  const writeAllowed = permissionSet.has("context-pack:write");
  const auditAllowed = permissionSet.has("context-pack:audit");
  const handoffAllowed = permissionSet.has("context-pack:handoff");
  const namespaceRoot = `/tenant/${request.tenantId}/workspace/${request.workspaceId}`;
  const pathClaims = assignedFileRetrieval.map((entry) => {
    const normalized = normalizeScopedPathCandidate(entry.path);
    const retrievalEntry = retrievalManifest.retrievalEntries.find((candidate) => candidate.path === entry.path);
    const memoryMount = memoryMounts.find((mount) => mount.retrievalId === entry.retrievalId) || null;
    const inAssignedScope = assignedSet.has(entry.path);
    const inAllowedScope = allowedSet.has(entry.path);
    const writeRequested = entry.access === "read_write" || Boolean(memoryMount?.writable);
    const blockedReasons = [
      normalized.rejected ? `unsafe_retrieval_path:${normalized.rejectionReason}` : null,
      inAssignedScope ? null : "retrieval_not_assigned",
      inAllowedScope ? null : "retrieval_not_allowed",
      writeRequested && !writeAllowed ? "write_permission_missing" : null,
      writeRequested && !retrievalEntry?.writable ? "retrieval_manifest_not_writable" : null,
      writeRequested && entry.status === "included" && !memoryMount ? "writable_mount_missing" : null,
      retrievalEntry?.fetchAction === "hold_for_scope_or_integrity_repair" ? "retrieval_manifest_blocked" : null
    ].filter(Boolean);

    return {
      retrievalId: entry.retrievalId,
      path: entry.path,
      zone: entry.zone,
      access: writeRequested ? "read_write" : "read_only",
      namespacePath: `${namespaceRoot}/${entry.path}`,
      mountId: memoryMount?.mountId || retrievalEntry?.mountId || null,
      mountPath: memoryMount?.mountPath || retrievalEntry?.mountPath || entry.mountPath,
      inAssignedScope,
      inAllowedScope,
      admitted: blockedReasons.length === 0,
      blockedReasons
    };
  });
  const mountClaims = memoryMounts.map((mount) => {
    const path = mount.path || "";
    const normalized = path ? normalizeScopedPathCandidate(path) : { rejected: false, rejectionReason: null };
    const assignedPath = path && assignedSet.has(path);
    const allowedPath = path && allowedSet.has(path);
    const retrievalClaim = pathClaims.find((claim) => claim.mountId === mount.mountId) || null;
    const namespacePath = path
      ? `${namespaceRoot}/${path}`
      : `${namespaceRoot}/memory/${mount.sourceId}`;
    const blockedReasons = [
      normalized.rejected ? `unsafe_mount_path:${normalized.rejectionReason}` : null,
      mount.writable && !assignedPath ? "writable_mount_not_assigned" : null,
      mount.writable && !allowedPath ? "writable_mount_not_allowed" : null,
      mount.writable && !writeAllowed ? "write_permission_missing" : null,
      mount.writable && retrievalClaim && !retrievalClaim.admitted ? "retrieval_claim_denied" : null,
      mount.required && mount.kind === "supporting_file" && path && !allowedPath ? "required_supporting_mount_outside_allowed" : null,
      mount.access === "read_write" && mount.mountPath?.startsWith("/readonly/") ? "read_write_on_readonly_mount_path" : null
    ].filter(Boolean);

    return {
      mountId: mount.mountId,
      sourceId: mount.sourceId,
      kind: mount.kind,
      path: mount.path,
      originalMountPath: mount.mountPath,
      namespacePath,
      access: mount.writable ? "read_write" : "read_only",
      required: mount.required,
      admitted: blockedReasons.length === 0,
      blockedReasons
    };
  });
  const deniedPathClaims = pathClaims.filter((claim) => !claim.admitted);
  const deniedMountClaims = mountClaims.filter((claim) => !claim.admitted);
  const auditRequired = pathClaims.some((claim) => claim.access === "read_write")
    || deniedPathClaims.length > 0
    || deniedMountClaims.length > 0
    || contracts.boundary.workspaceScope.handoffRequired;
  const auditBlocked = auditRequired && !auditAllowed;
  const handoffBlocked = contracts.boundary.workspaceScope.handoffRequired && !handoffAllowed;
  const blockedReasons = [
    ...deniedPathClaims.flatMap((claim) => claim.blockedReasons.map((reason) => `path:${claim.path}:${reason}`)),
    ...deniedMountClaims.flatMap((claim) => claim.blockedReasons.map((reason) => `mount:${claim.mountId}:${reason}`)),
    auditBlocked ? "audit_permission_missing_for_sandbox_handoff" : null,
    handoffBlocked ? "handoff_permission_missing_for_multi_zone_scope" : null,
    contracts.boundary.enforcement.blocked ? contracts.boundary.enforcement.reason : null
  ].filter(Boolean);
  const sandboxDigest = stableProofDigest([
    digest,
    request.tenantId,
    request.workspaceId,
    clientState.sessionId,
    contracts.boundary.actor.actorId,
    pathClaims.map((claim) => `${claim.path}:${claim.access}:${claim.admitted}`).join("|"),
    mountClaims.map((claim) => `${claim.mountId}:${claim.access}:${claim.admitted}`).join("|"),
    blockedReasons.join("|")
  ]);

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.compact_worker_sandbox.v1",
    sandboxId: `${surfaceId}:${request.requestId}:${clientState.sessionId}:sandbox`,
    generatedAt: now,
    status: blockedReasons.length ? "blocked" : "ready",
    namespaceRoot,
    sandboxDigest,
    tenantIsolation: {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      checkpointTenantId: contracts.boundary.isolation.checkpointTenantId,
      checkpointWorkspaceId: contracts.boundary.isolation.checkpointWorkspaceId,
      sameTenant: !contracts.boundary.isolation.persistedTenantMismatch,
      sameWorkspace: !contracts.boundary.isolation.persistedWorkspaceMismatch
    },
    actorBoundary: {
      actorId: contracts.boundary.actor.actorId,
      roles: contracts.boundary.actor.roles,
      effectivePermissions: contracts.boundary.actor.effectivePermissions,
      writeAllowed,
      auditAllowed,
      handoffAllowed
    },
    retrievalClaims: pathClaims,
    mountClaims,
    deniedRetrievals: deniedPathClaims.map((claim) => ({
      retrievalId: claim.retrievalId,
      path: claim.path,
      reasons: claim.blockedReasons
    })),
    deniedMounts: deniedMountClaims.map((claim) => ({
      mountId: claim.mountId,
      path: claim.path,
      reasons: claim.blockedReasons
    })),
    auditHandoff: {
      required: auditRequired,
      allowed: auditRequired ? auditAllowed && !handoffBlocked : true,
      blockedReasons: [
        auditBlocked ? "audit_permission_missing" : null,
        handoffBlocked ? "handoff_permission_missing" : null
      ].filter(Boolean),
      receiptChannel: "audit_receipt"
    },
    blockedReasons: blockedReasons.slice(0, 16),
    proofSignals: [
      `sandbox:${blockedReasons.length ? "blocked" : "ready"}`,
      `sandboxNamespace:${namespaceRoot}`,
      `sandboxRetrievalClaims:${pathClaims.length}`,
      `sandboxMountClaims:${mountClaims.length}`,
      deniedPathClaims.length ? `sandboxDeniedRetrieval:${deniedPathClaims.length}` : null,
      deniedMountClaims.length ? `sandboxDeniedMount:${deniedMountClaims.length}` : null,
      auditRequired ? `sandboxAudit:${auditBlocked ? "blocked" : "required"}` : "sandboxAudit:not_required"
    ].filter(Boolean)
  };
}

function buildLaunchRecoveryProjection(request, clientState, recovery, retrievalManifest, clientRetrievalHandoffQueue, sandboxEnvelope, digest, now) {
  const commandEffect = recovery.commandEffect;
  const queuePatch = clientRetrievalHandoffQueue.clientStatePatch;
  const replayBlockedReasons = [
    recovery.status === "completed" ? "checkpoint_completed" : null,
    recovery.status === "blocked" ? recovery.statusReason : null,
    recovery.statusSemantics.leaseHeldByOtherSession ? "active_foreign_command_lease" : null,
    retrievalManifest.status === "blocked" ? "retrieval_manifest_blocked" : null,
    clientRetrievalHandoffQueue.status === "blocked" ? "client_retrieval_queue_blocked" : null,
    sandboxEnvelope.status === "blocked" ? `sandbox_blocked:${sandboxEnvelope.blockedReasons[0] || "boundary_denied"}` : null
  ].filter(Boolean);
  const retrievalCursor = stableProofDigest([
    retrievalManifest.manifestId,
    clientRetrievalHandoffQueue.queueId,
    retrievalManifest.status,
    clientRetrievalHandoffQueue.status,
    sandboxEnvelope.sandboxDigest,
    sandboxEnvelope.status,
    retrievalManifest.retrievalEntries.map((entry) => `${entry.retrievalId}:${entry.status}:${entry.fetchAction}`).join("|"),
    digest
  ]);
  const restartAction = commandEffect === "noop_already_applied"
    ? "skip_launch_already_applied"
    : replayBlockedReasons.length
      ? "hold_launch_for_recovery_repair"
      : retrievalManifest.status === "requires_prefetch"
        ? "restore_prefetch_queue_before_launch"
        : recovery.statusSemantics.staleLeaseRecovered
          ? "reclaim_lease_and_resume_launch"
          : recovery.resumedFromCheckpoint
            ? "resume_launch_from_checkpoint"
            : "start_new_launch";
  const persistedStatus = commandEffect === "noop_already_applied"
    ? "completed"
    : replayBlockedReasons.length
      ? "blocked"
      : retrievalManifest.status === "requires_prefetch"
        ? "prefetch_required"
        : "ready";

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.launch_recovery_projection.v1",
    generatedAt: now,
    launchRecoveryId: `${surfaceId}:${request.requestId}:${clientState.sessionId}:launch-recovery`,
    status: persistedStatus,
    restartAction,
    replayAdmitted: replayBlockedReasons.length === 0 && commandEffect !== "noop_already_applied",
    replayBlockedReasons: replayBlockedReasons.slice(0, 8),
    idempotency: {
      commandId: recovery.commandId,
      idempotencyKey: recovery.idempotencyKey,
      commandEffect,
      leaseAction: recovery.statusSemantics.commandLeaseAction,
      restartPolicy: recovery.statusSemantics.restartPolicy
    },
    retrievalCursor,
    persistedRetrievalState: {
      manifestId: retrievalManifest.manifestId,
      manifestStatus: retrievalManifest.status,
      queueId: clientRetrievalHandoffQueue.queueId,
      queueStatus: clientRetrievalHandoffQueue.status,
      nextClientAction: clientRetrievalHandoffQueue.nextClientAction,
      sandboxId: sandboxEnvelope.sandboxId,
      sandboxStatus: sandboxEnvelope.status,
      sandboxDigest: sandboxEnvelope.sandboxDigest,
      prefetchPaths: queuePatch.retrievalPrefetchPaths,
      blockedPaths: queuePatch.retrievalBlockedPaths,
      primaryPath: queuePatch.retrievalPrimaryPath
    },
    resumeStatePatch: {
      launchRecoveryId: `${surfaceId}:${request.requestId}:${clientState.sessionId}:launch-recovery`,
      launchRecoveryStatus: persistedStatus,
      launchRestartAction: restartAction,
      launchReplayAdmitted: replayBlockedReasons.length === 0 && commandEffect !== "noop_already_applied",
      launchReplayBlockedReasons: replayBlockedReasons.slice(0, 8),
      retrievalCursor,
      retrievalQueueId: clientRetrievalHandoffQueue.queueId,
      retrievalQueueStatus: clientRetrievalHandoffQueue.status,
      retrievalNextAction: clientRetrievalHandoffQueue.nextClientAction,
      sandboxId: sandboxEnvelope.sandboxId,
      sandboxStatus: sandboxEnvelope.status,
      sandboxDigest: sandboxEnvelope.sandboxDigest,
      sandboxBlockedReasons: sandboxEnvelope.blockedReasons.slice(0, 8),
      retrievalPrefetchPaths: queuePatch.retrievalPrefetchPaths,
      retrievalBlockedPaths: queuePatch.retrievalBlockedPaths,
      retrievalPrimaryPath: queuePatch.retrievalPrimaryPath
    },
    proofSignals: [
      `launchRecovery:${persistedStatus}`,
      `launchRestart:${restartAction}`,
      `launchReplay:${replayBlockedReasons.length === 0 && commandEffect !== "noop_already_applied"}`,
      `retrievalCursor:${retrievalCursor}`,
      `sandboxRecovery:${sandboxEnvelope.status}`,
      replayBlockedReasons.length ? `launchReplayBlocked:${replayBlockedReasons[0]}` : null
    ].filter(Boolean)
  };
}

function buildCompactWorkerLaunchContract(request, clientState, contracts, recovery, health, handoff, includedSources, omittedSources, digest, now) {
  const assignedFileRetrieval = buildAssignedFileRetrievalPlan(request, contracts, includedSources, omittedSources);
  const memoryMounts = buildCompactMemoryMounts(includedSources, assignedFileRetrieval, contracts);
  const retrievalManifest = buildWorkerRetrievalManifest(
    request,
    contracts,
    assignedFileRetrieval,
    memoryMounts,
    omittedSources
  );
  const sandboxEnvelope = buildCompactWorkerSandboxEnvelope(
    request,
    clientState,
    contracts,
    assignedFileRetrieval,
    memoryMounts,
    retrievalManifest,
    digest,
    now
  );
  const clientRetrievalHandoffQueue = buildClientRetrievalHandoffQueue(
    request,
    clientState,
    retrievalManifest,
    memoryMounts,
    recovery
  );
  const launchRecovery = buildLaunchRecoveryProjection(
    request,
    clientState,
    recovery,
    retrievalManifest,
    clientRetrievalHandoffQueue,
    sandboxEnvelope,
    digest,
    now
  );
  const blockedRetrievals = assignedFileRetrieval.filter((entry) => entry.status === "blocked");
  const deferredRetrievals = assignedFileRetrieval.filter((entry) => entry.status === "missing_source");
  const launchBlockedReasons = [
    health.mode === "failed" ? "health_failed" : null,
    recovery.status === "blocked" ? recovery.statusReason : null,
    contracts.boundary.enforcement.blocked ? contracts.boundary.enforcement.reason : null,
    contracts.lifecycle.controls.executionBlocked ? contracts.lifecycle.controls.blockReason : null,
    sandboxEnvelope.status === "blocked" ? `sandbox_blocked:${sandboxEnvelope.blockedReasons[0] || "boundary_denied"}` : null,
    retrievalManifest.blockedRetrievals.length ? `retrieval_manifest_blocked:${retrievalManifest.blockedRetrievals[0].path}` : null,
    blockedRetrievals.length ? `assigned_retrieval_blocked:${blockedRetrievals[0].path}` : null
  ].filter(Boolean);
  const workerMode = request.promptMode === "compact" || clientState.promptMode === "compact"
    ? "compact_worker"
    : "standard_worker";

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.compact_worker_launch.v1",
    launchId: `${surfaceId}:${request.requestId}:${clientState.sessionId}:launch`,
    generatedAt: now,
    workerMode,
    launchStatus: launchBlockedReasons.length ? "blocked" : "ready",
    launchAction: launchBlockedReasons.length
      ? "hold_worker_launch"
      : deferredRetrievals.length
        ? "prefetch_assigned_files_then_launch"
        : "launch_with_context_pack",
    route: request.route,
    targetSurface: request.targetSurface,
    commandId: recovery.commandId,
    idempotencyKey: recovery.idempotencyKey,
    digest,
    launchBlockedReasons: launchBlockedReasons.slice(0, 8),
    contextShape: {
      promptMode: request.promptMode,
      itemLimit: contracts.contextBudget,
      sourceCount: includedSources.length,
      memoryMountCount: memoryMounts.length,
      assignedRetrievalCount: assignedFileRetrieval.length,
      writableMountCount: memoryMounts.filter((mount) => mount.writable).length,
      deferredRetrievalCount: deferredRetrievals.length,
      deferredFetchCount: retrievalManifest.deferredFetches.length,
      blockedManifestRetrievalCount: retrievalManifest.blockedRetrievals.length,
      sandboxStatus: sandboxEnvelope.status,
      sandboxDeniedRetrievalCount: sandboxEnvelope.deniedRetrievals.length,
      sandboxDeniedMountCount: sandboxEnvelope.deniedMounts.length,
      sandboxAuditRequired: sandboxEnvelope.auditHandoff.required,
      clientRetrievalQueueStatus: clientRetrievalHandoffQueue.status,
      clientRetrievalQueueItemCount: clientRetrievalHandoffQueue.queueItems.length,
      clientRetrievalPrefetchCount: clientRetrievalHandoffQueue.summary.prefetchCount,
      clientRetrievalBlockedCount: clientRetrievalHandoffQueue.summary.blockedCount,
      launchRecoveryStatus: launchRecovery.status,
      launchReplayAdmitted: launchRecovery.replayAdmitted,
      omittedRequiredCount: omittedSources.filter((source) => source.required).length
    },
    assignedFileRetrieval,
    memoryMounts,
    sandboxEnvelope,
    retrievalManifest,
    clientRetrievalHandoffQueue,
    launchRecovery,
    workerInputs: {
      nextAction: handoff.nextAction,
      workflowLane: handoff.clientWorkflowState.state.lane,
      primaryTarget: contracts.scope.writableTargets[0] || request.assignedFiles[0] || null,
      allowedWritePaths: contracts.scope.writableTargets,
      blockedWritePaths: contracts.scope.blockedTargets,
      assignedPrefetchPaths: deferredRetrievals.map((entry) => entry.path),
      retrievalQueueId: clientRetrievalHandoffQueue.queueId,
      retrievalQueueStatus: clientRetrievalHandoffQueue.status,
      retrievalNextClientAction: clientRetrievalHandoffQueue.nextClientAction,
      retrievalCursor: launchRecovery.retrievalCursor,
      sandboxId: sandboxEnvelope.sandboxId,
      sandboxStatus: sandboxEnvelope.status,
      sandboxDigest: sandboxEnvelope.sandboxDigest,
      sandboxNamespaceRoot: sandboxEnvelope.namespaceRoot,
      sandboxBlockedReasons: sandboxEnvelope.blockedReasons.slice(0, 8),
      launchRestartAction: launchRecovery.restartAction,
      launchReplayAdmitted: launchRecovery.replayAdmitted,
      resumeToken: handoff.clientWorkflowState.resumeDescriptor.resumeToken,
      proofId: contracts.proof.id
    },
    gates: [
      { id: "health_ok", passed: health.ok, detail: health.mode },
      { id: "recovery_not_blocked", passed: recovery.status !== "blocked", detail: recovery.statusReason },
      { id: "boundary_authorized", passed: !contracts.boundary.enforcement.blocked, detail: contracts.boundary.enforcement.reason },
      { id: "lifecycle_ready", passed: !contracts.lifecycle.controls.executionBlocked, detail: contracts.lifecycle.controls.blockReason || contracts.lifecycle.controls.nextLifecycleAction },
      { id: "sandbox_ready", passed: sandboxEnvelope.status !== "blocked", detail: sandboxEnvelope.blockedReasons[0] || sandboxEnvelope.namespaceRoot },
      { id: "assigned_files_retrievable", passed: blockedRetrievals.length === 0, detail: `${assignedFileRetrieval.length - blockedRetrievals.length}/${assignedFileRetrieval.length}:retrievable` },
      { id: "assigned_prefetch_planned", passed: retrievalManifest.deferredFetches.length === deferredRetrievals.length, detail: `${retrievalManifest.deferredFetches.length}:deferred_fetches` }
    ],
    proofSignals: [
      `workerLaunch:${launchBlockedReasons.length ? "blocked" : "ready"}`,
      `workerMode:${workerMode}`,
      `memoryMounts:${memoryMounts.length}`,
      `assignedRetrieval:${assignedFileRetrieval.length}`,
      ...retrievalManifest.proofSignals,
      ...sandboxEnvelope.proofSignals,
      ...clientRetrievalHandoffQueue.proofSignals,
      ...launchRecovery.proofSignals,
      deferredRetrievals.length ? `deferredRetrieval:${deferredRetrievals.length}` : null,
      blockedRetrievals.length ? `blockedRetrieval:${blockedRetrievals[0].blockedReason}` : "assignedRetrieval:ready"
    ]
  };
}

function buildContextPackArtifact(input, request, clientState, contracts, recovery, health, handoff, now) {
  const tokenCeiling = contracts.contextBudget * 700;
  const sourceEntries = normalizeContextSourceEntries(input, request, contracts, now);
  const assignedSet = new Set(request.assignedFiles);
  const sourcePriority = (source) => {
    if (source.path && assignedSet.has(source.path)) {
      return 0;
    }
    if (source.required && source.writable) {
      return 1;
    }
    if (source.required) {
      return 2;
    }
    if (source.sourceType === "runtime") {
      return 3;
    }
    return 4;
  };
  const prioritizedSourceEntries = sourceEntries
    .map((source, index) => ({ source, index, priority: sourcePriority(source) }))
    .sort((left, right) => (
      left.priority - right.priority
      || left.source.estimatedTokens - right.source.estimatedTokens
      || left.index - right.index
    ))
    .map((entry) => entry.source);
  let usedTokens = 0;
  const includedSources = [];
  const omittedSources = [];

  for (const source of prioritizedSourceEntries) {
    const wouldExceed = usedTokens + source.estimatedTokens > tokenCeiling;
    const blocked = source.blocked || contracts.boundary.enforcement.blocked;
    if (blocked || wouldExceed) {
      omittedSources.push({
        sourceId: source.sourceId,
        path: source.path,
        originalPath: source.originalPath,
        reason: blocked
          ? source.blockedReason || (source.blocked ? "blocked_by_allowed_scope" : contracts.boundary.enforcement.reason)
          : "context_budget_exceeded",
        estimatedTokens: source.estimatedTokens,
        required: source.required,
        pathRejected: source.pathRejected,
        pathRejectionReason: source.pathRejectionReason
      });
      continue;
    }

    includedSources.push({
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      path: source.path,
      summary: source.summary,
      provenance: source.provenance,
      observedAt: source.observedAt,
      estimatedTokens: source.estimatedTokens,
      required: source.required,
      writable: source.writable,
      originalPath: source.originalPath
    });
    usedTokens += source.estimatedTokens;
  }

  const requiredOmissions = omittedSources.filter((source) => source.required);
  const digest = stableProofDigest([
    surfaceId,
    request.requestId,
    clientState.sessionId,
    contracts.proof.id,
    recovery.idempotencyKey,
    handoff.clientWorkflowState.state.lane,
    handoff.clientWorkflowState.state.nextAction,
    handoff.clientWorkflowState.handoffPresentation.presentationId,
    handoff.clientWorkflowState.handoffPresentation.channel,
    handoff.clientWorkflowState.handoffPresentation.channelAction,
    handoff.clientWorkflowState.resumeDescriptor.resumeToken,
    handoff.clientWorkflowState.dirtyScope.outsideAllowed.join("|"),
    health.incident.incidentId,
    health.incident.severity,
    health.incident.retryAdmission.admitted,
    health.healthRouting.routeState,
    health.healthRouting.dispatch.action,
    health.healthRouting.escalation.reason,
    includedSources.map((source) => `${source.sourceId}:${source.path || ""}:${source.estimatedTokens}`).join("|"),
    omittedSources.map((source) => `${source.sourceId}:${source.reason}`).join("|")
  ]);
  const compactWorkerLaunch = buildCompactWorkerLaunchContract(
    request,
    clientState,
    contracts,
    recovery,
    health,
    handoff,
    includedSources,
    omittedSources,
    digest,
    now
  );
  const packStatus = health.mode === "failed" || requiredOmissions.length
    ? "blocked"
    : health.degraded || omittedSources.length
      ? "partial"
      : "ready";

  return {
    schemaVersion: 1,
    contractType: "scheduler.context-pack.artifact.v1",
    packId: `${surfaceId}:${request.requestId}:${clientState.sessionId}:pack`,
    generatedAt: now,
    status: packStatus,
    route: request.route,
    targetSurface: request.targetSurface,
    tokenBudget: {
      mode: request.promptMode,
      itemLimit: contracts.contextBudget,
      tokenCeiling,
      usedTokens,
      remainingTokens: Math.max(0, tokenCeiling - usedTokens)
    },
    sourceManifest: {
      totalSourceCount: sourceEntries.length,
      includedCount: includedSources.length,
      omittedCount: omittedSources.length,
      requiredOmissionCount: requiredOmissions.length,
      sourceIntegrity: contracts.scope.sourceIntegrity,
      includedSources,
      omittedSources
    },
    routePayload: {
      commandId: recovery.commandId,
      checkpointId: recovery.checkpointId,
      idempotencyKey: recovery.idempotencyKey,
      nextAction: handoff.nextAction,
      lifecycleAction: contracts.lifecycle.controls.nextLifecycleAction,
      lifecycleStatePatch: contracts.lifecycle.statePatch,
      lifecycleCommandTransition: contracts.lifecycle.commandTransition,
      scheduleDue: contracts.lifecycle.schedule.due,
      providerStateIds: contracts.providers.externalHandoffStates
        .filter((state) => state.exportable)
        .map((state) => state.stateId),
      acceptedProviderStateIds: contracts.providers.acceptedExternalHandoffStateIds,
      pendingHandoffProviderIds: contracts.providers.pendingExternalHandoffProviderIds,
      compactWorkerLaunchId: compactWorkerLaunch.launchId,
      compactWorkerSandboxId: compactWorkerLaunch.sandboxEnvelope.sandboxId,
      compactWorkerSandboxStatus: compactWorkerLaunch.sandboxEnvelope.status,
      compactWorkerSandboxDigest: compactWorkerLaunch.sandboxEnvelope.sandboxDigest,
      compactWorkerSandboxNamespaceRoot: compactWorkerLaunch.sandboxEnvelope.namespaceRoot,
      compactWorkerSandboxBlockedReasons: compactWorkerLaunch.sandboxEnvelope.blockedReasons,
      workerRetrievalManifestId: compactWorkerLaunch.retrievalManifest.manifestId,
      workerRetrievalManifestStatus: compactWorkerLaunch.retrievalManifest.status,
      clientRetrievalQueueId: compactWorkerLaunch.clientRetrievalHandoffQueue.queueId,
      clientRetrievalQueueStatus: compactWorkerLaunch.clientRetrievalHandoffQueue.status,
      clientRetrievalNextAction: compactWorkerLaunch.clientRetrievalHandoffQueue.nextClientAction,
      clientRetrievalStatePatch: compactWorkerLaunch.clientRetrievalHandoffQueue.clientStatePatch,
      launchRecovery: compactWorkerLaunch.launchRecovery,
      launchRecoveryStatePatch: compactWorkerLaunch.launchRecovery.resumeStatePatch,
      retrievalCursor: compactWorkerLaunch.launchRecovery.retrievalCursor,
      assignedFileRetrieval: compactWorkerLaunch.assignedFileRetrieval,
      memoryMounts: compactWorkerLaunch.memoryMounts,
      retrievalManifest: compactWorkerLaunch.retrievalManifest,
      retrievalHandoffQueue: compactWorkerLaunch.clientRetrievalHandoffQueue,
      clientWorkflowStatePatch: handoff.clientWorkflowState.clientStatePatch,
      clientResumeDescriptor: handoff.clientWorkflowState.resumeDescriptor,
      clientHandoffPresentation: handoff.clientWorkflowState.handoffPresentation,
      proofId: contracts.proof.id,
      digest
    },
    compactWorkerLaunch,
    auditProof: {
      digest,
      digestAlgorithm: "fnv1a32",
      proofSignals: [
        ...contracts.proof.signals,
        ...compactWorkerLaunch.proofSignals
      ],
      boundaryReason: contracts.boundary.enforcement.reason,
      workspaceScope: {
        handoffRequired: contracts.boundary.workspaceScope.handoffRequired,
        zoneCounts: contracts.boundary.workspaceScope.zoneCounts,
        deniedTargets: contracts.boundary.workspaceScope.deniedTargets,
        denialCodes: contracts.boundary.workspaceScope.denialCodes
      },
      sourceIntegrity: contracts.scope.sourceIntegrity,
      restartSafe: recovery.restartSafe,
      lifecycle: {
        command: contracts.lifecycle.command,
        enabled: contracts.lifecycle.controls.enabled,
        paused: contracts.lifecycle.controls.paused,
        scheduleMode: contracts.lifecycle.schedule.mode,
        blockReason: contracts.lifecycle.controls.blockReason,
        nextLifecycleAction: contracts.lifecycle.controls.nextLifecycleAction,
        commandToken: contracts.lifecycle.commandTransition.commandToken,
        commandAccepted: contracts.lifecycle.commandTransition.accepted,
        runIntent: contracts.lifecycle.commandTransition.runIntent,
        dispatchPolicy: contracts.lifecycle.commandTransition.dispatchPolicy,
        materializedNextRunAt: contracts.lifecycle.commandTransition.materializedNextRunAt,
        commandEffects: contracts.lifecycle.commandTransition.commandEffects,
        settingsIssueCodes: contracts.lifecycle.settingsValidation.issues.map((issue) => issue.code)
      },
      healthMode: health.mode,
      healthRouting: health.healthRouting,
      operationalIncident: {
        incidentId: health.incident.incidentId,
        severity: health.incident.severity,
        status: health.incident.status,
        primaryCode: health.incident.primaryCode,
        impactedDomains: health.incident.impactedDomains,
        retryAdmission: health.incident.retryAdmission,
        actionPlan: health.incident.actionPlan,
        proofSignals: health.incident.proofSignals
      },
      failureTransition: {
        mode: health.failureState.transition.mode,
        schedulerDisposition: health.failureState.transition.schedulerDisposition,
        nextCheckpointStatus: health.failureState.transition.statusPatch.nextCheckpointStatus,
        retryAttempt: health.failureState.transition.retryBudget.attempt,
        retryLimit: health.failureState.transition.retryBudget.limit,
        retryExhausted: health.failureState.transition.retryBudget.exhausted,
        operatorActions: health.failureState.transition.operatorActions
      },
      clientWorkflow: {
        lane: handoff.clientWorkflowState.state.lane,
        nextAction: handoff.clientWorkflowState.state.nextAction,
        canApplyFromClient: handoff.clientWorkflowState.state.canApplyFromClient,
        canResumeFromClient: handoff.clientWorkflowState.state.canResumeFromClient,
        handoffChannel: handoff.clientWorkflowState.handoffPresentation.channel,
        handoffChannelAction: handoff.clientWorkflowState.handoffPresentation.channelAction,
        handoffPresentationId: handoff.clientWorkflowState.handoffPresentation.presentationId,
        handoffAcceptanceRequired: handoff.clientWorkflowState.handoffPresentation.acceptanceRequired,
        dirtyOutsideAllowedCount: handoff.clientWorkflowState.dirtyScope.outsideAllowedCount,
        selectedProviderId: handoff.clientWorkflowState.state.selectedProviderId,
        selectedExternalStateAccepted: handoff.clientWorkflowState.state.selectedExternalStateAccepted
      },
      providerHandoffAcknowledgements: contracts.providers.handoffAcknowledgements.map((acknowledgement) => ({
        providerId: acknowledgement.providerId,
        status: acknowledgement.status,
        accepted: acknowledgement.accepted,
        rejectionReason: acknowledgement.rejectionReason,
        acknowledgementId: acknowledgement.acknowledgementId
      })),
      compactWorkerLaunch: {
        launchId: compactWorkerLaunch.launchId,
        status: compactWorkerLaunch.launchStatus,
        action: compactWorkerLaunch.launchAction,
        workerMode: compactWorkerLaunch.workerMode,
        memoryMountCount: compactWorkerLaunch.contextShape.memoryMountCount,
        assignedRetrievalCount: compactWorkerLaunch.contextShape.assignedRetrievalCount,
        writableMountCount: compactWorkerLaunch.contextShape.writableMountCount,
        deferredFetchCount: compactWorkerLaunch.contextShape.deferredFetchCount,
        blockedManifestRetrievalCount: compactWorkerLaunch.contextShape.blockedManifestRetrievalCount,
        sandboxId: compactWorkerLaunch.sandboxEnvelope.sandboxId,
        sandboxStatus: compactWorkerLaunch.sandboxEnvelope.status,
        sandboxDigest: compactWorkerLaunch.sandboxEnvelope.sandboxDigest,
        sandboxDeniedRetrievalCount: compactWorkerLaunch.sandboxEnvelope.deniedRetrievals.length,
        sandboxDeniedMountCount: compactWorkerLaunch.sandboxEnvelope.deniedMounts.length,
        sandboxAuditRequired: compactWorkerLaunch.sandboxEnvelope.auditHandoff.required,
        sandboxAuditAllowed: compactWorkerLaunch.sandboxEnvelope.auditHandoff.allowed,
        clientRetrievalQueueStatus: compactWorkerLaunch.clientRetrievalHandoffQueue.status,
        clientRetrievalNextAction: compactWorkerLaunch.clientRetrievalHandoffQueue.nextClientAction,
        clientRetrievalPrefetchCount: compactWorkerLaunch.clientRetrievalHandoffQueue.summary.prefetchCount,
        clientRetrievalBlockedCount: compactWorkerLaunch.clientRetrievalHandoffQueue.summary.blockedCount,
        retrievalManifestId: compactWorkerLaunch.retrievalManifest.manifestId,
        retrievalManifestStatus: compactWorkerLaunch.retrievalManifest.status,
        launchRecoveryStatus: compactWorkerLaunch.launchRecovery.status,
        launchRestartAction: compactWorkerLaunch.launchRecovery.restartAction,
        launchReplayAdmitted: compactWorkerLaunch.launchRecovery.replayAdmitted,
        retrievalCursor: compactWorkerLaunch.launchRecovery.retrievalCursor,
        blockedReasons: compactWorkerLaunch.launchBlockedReasons
      },
      validationIssueCodes: health.validation.issues.map((issue) => issue.code),
      generatedBy: "hosted-kernel-context-pack"
    }
  };
}

function buildPersistedStateRecoveryEnvelope(request, clientState, checkpoint, contracts, recovery, health, handoff, contextPackArtifact, analytics, now) {
  const currentCommand = checkpoint.pendingCommand;
  const commandBlocked = recovery.status === "blocked" || health.mode === "failed";
  const commandAlreadyApplied = recovery.commandEffect === "noop_already_applied";
  const commandLeaseBlocked = recovery.commandEffect === "noop_active_lease";
  const failureTransition = health.failureState.transition;
  const retryScheduled = failureTransition.mode === "retry_scheduled" && !failureTransition.retryBudget.exhausted;
  const commandStatus = commandAlreadyApplied
    ? "completed"
    : commandBlocked
      ? "blocked"
      : retryScheduled || recovery.resumedFromCheckpoint
        ? "recovering"
      : "pending";
  const commandDisposition = commandAlreadyApplied
    ? "skip_duplicate"
    : commandLeaseBlocked
      ? "hold_active_lease"
    : commandBlocked
      ? "hold_without_side_effect"
      : retryScheduled
        ? "defer_until_retry_window"
      : recovery.commandEffect === "reclaim_and_apply_once"
        ? "reclaim_expired_lease_and_reserve"
      : "reserve_for_single_apply";
  const nextLease = {
    commandId: currentCommand.id,
    owner: clientState.clientId,
    sessionId: clientState.sessionId,
    leasedAt: now,
    leaseMs: checkpoint.activeLease.leaseMs,
    expiresAt: addMillisecondsIso(now, checkpoint.activeLease.leaseMs),
    previousOwner: checkpoint.activeLease.owner,
    previousSessionId: checkpoint.activeLease.sessionId,
    previousExpired: checkpoint.activeLease.expired,
    action: recovery.statusSemantics.commandLeaseAction
  };
  const existingCommandLog = checkpoint.commandLog.filter((command) => command.id !== currentCommand.id);
  const nextCommandEntry = {
    id: currentCommand.id,
    name: currentCommand.name,
    target: currentCommand.target,
    status: commandStatus,
    attempt: Math.max(1, checkpoint.restartCount + (recovery.resumedFromCheckpoint ? 1 : 0)),
    idempotencyKey: currentCommand.idempotencyKey,
    disposition: commandDisposition,
    updatedAt: now,
    proofDigest: contextPackArtifact.auditProof.digest
  };
  const nextCommandLog = [...existingCommandLog, nextCommandEntry].slice(-12);
  const completedCommandIds = Array.from(new Set([
    ...checkpoint.completedCommandIds,
    commandStatus === "completed" ? currentCommand.id : null
  ].filter(Boolean))).slice(-12);
  const nextLifecycleState = {
    ...checkpoint.lifecycle,
    ...contracts.lifecycle.statePatch,
    lastLifecycleCommand: contracts.lifecycle.command,
    lifecycleCommandTransition: contracts.lifecycle.commandTransition,
    nextLifecycleAction: contracts.lifecycle.controls.nextLifecycleAction,
    scheduleDue: contracts.lifecycle.schedule.due
  };
  const persistenceStatus = commandAlreadyApplied
    ? "completed"
    : commandBlocked
      ? "blocked"
      : retryScheduled || recovery.resumedFromCheckpoint
        ? "recovering"
        : "running";
  const recoveryCursor = stableProofDigest([
    checkpoint.checkpointId,
    currentCommand.id,
    persistenceStatus,
    contextPackArtifact.auditProof.digest,
    handoff.nextAction,
    recovery.statusSemantics.commandLeaseAction,
    nextLease.owner,
    nextLease.sessionId
  ]);
  const statusSemanticsPatch = {
    persistedStatus: persistenceStatus,
    terminal: FINAL_STATUSES.has(persistenceStatus),
    replayable: !FINAL_STATUSES.has(persistenceStatus) && !commandLeaseBlocked,
    requiresLease: true,
    restartPolicy: recovery.statusSemantics.restartPolicy,
    statusReason: recovery.statusReason,
    leaseAction: recovery.statusSemantics.commandLeaseAction,
    updatedAt: now
  };

  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    contractType: "scheduler.context-pack.persisted_state_recovery.v1",
    checkpointId: checkpoint.checkpointId,
    previous: {
      status: checkpoint.status,
      updatedAt: checkpoint.updatedAt,
      restartCount: checkpoint.restartCount,
      lastCommandId: checkpoint.lastCommandId
    },
    next: {
      checkpointId: checkpoint.checkpointId,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      status: persistenceStatus,
      updatedAt: now,
      restartCount: checkpoint.restartCount + (recovery.resumedFromCheckpoint ? 1 : 0),
      lastCommandId: currentCommand.id,
      completedCommandIds,
      commandLog: nextCommandLog,
      lifecycle: nextLifecycleState,
      activeLease: commandAlreadyApplied || commandBlocked ? checkpoint.activeLease : nextLease,
      statusSemantics: statusSemanticsPatch,
      recoveryCursor,
      route: request.route,
      targetSurface: request.targetSurface,
      clientSessionId: clientState.sessionId,
      providerStateIds: contracts.providers.externalHandoffStates
        .filter((state) => state.exportable)
        .map((state) => state.stateId),
      acceptedProviderStateIds: contracts.providers.acceptedExternalHandoffStateIds,
      pendingHandoffProviderIds: contracts.providers.pendingExternalHandoffProviderIds,
      providerHandoffAcknowledgements: contracts.providers.handoffAcknowledgements,
      failureTransition: {
        mode: failureTransition.mode,
        schedulerDisposition: failureTransition.schedulerDisposition,
        writePolicy: failureTransition.statusPatch.writePolicy,
        retryBudget: failureTransition.retryBudget,
        operatorActions: failureTransition.operatorActions,
        degradedGuards: failureTransition.degradedGuards
      },
      operationalIncident: {
        incidentId: health.incident.incidentId,
        severity: health.incident.severity,
        status: health.incident.status,
        primaryCode: health.incident.primaryCode,
        impactedDomains: health.incident.impactedDomains,
        retryAdmission: health.incident.retryAdmission,
        actionPlan: health.incident.actionPlan
      },
      healthRouting: {
        routeState: health.healthRouting.routeState,
        dispatch: health.healthRouting.dispatch,
        escalation: health.healthRouting.escalation,
        userFacingError: health.healthRouting.userFacingError
      },
      clientHandoff: {
        preferences: clientState.handoffPreferences,
        presentation: handoff.clientWorkflowState.handoffPresentation,
        statePatch: handoff.clientWorkflowState.clientStatePatch
      },
      compactWorkerLaunch: {
        launchId: contextPackArtifact.compactWorkerLaunch.launchId,
        status: contextPackArtifact.compactWorkerLaunch.launchStatus,
        action: contextPackArtifact.compactWorkerLaunch.launchAction,
        sandboxEnvelope: contextPackArtifact.compactWorkerLaunch.sandboxEnvelope,
        retrievalManifestId: contextPackArtifact.compactWorkerLaunch.retrievalManifest.manifestId,
        retrievalManifestStatus: contextPackArtifact.compactWorkerLaunch.retrievalManifest.status,
        deferredFetches: contextPackArtifact.compactWorkerLaunch.retrievalManifest.deferredFetches,
        blockedRetrievals: contextPackArtifact.compactWorkerLaunch.retrievalManifest.blockedRetrievals,
        assignedFileRetrieval: contextPackArtifact.compactWorkerLaunch.assignedFileRetrieval,
        clientRetrievalHandoffQueue: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue,
        launchRecovery: contextPackArtifact.compactWorkerLaunch.launchRecovery
      },
      analytics: {
        counters: analytics.counters,
        reportingWindow: analytics.reportingWindow,
        exportReadiness: analytics.exportReadiness,
        exportSummary: analytics.exportSummary
      },
      analyticsHistory: analytics.history,
      reportingTimeline: analytics.timeline
    },
    restartSemantics: {
      restartSafe: true,
      resumedFromCheckpoint: recovery.resumedFromCheckpoint,
      commandEffect: recovery.commandEffect,
      commandDisposition,
      statusReason: recovery.statusReason,
      replayPolicy: commandAlreadyApplied ? "never_replay_completed_command" : "replay_only_with_same_idempotency_key",
      restartPolicy: recovery.statusSemantics.restartPolicy,
      leaseAction: recovery.statusSemantics.commandLeaseAction,
      activeLeaseExpired: checkpoint.activeLease.expired,
      activeLeaseOwnedByCurrentSession: checkpoint.activeLease.ownedByCurrentSession,
      terminal: FINAL_STATUSES.has(persistenceStatus),
      canResumeAfterRestart: !commandBlocked && !commandAlreadyApplied && !commandLeaseBlocked
    },
    idempotentCommand: {
      ...currentCommand,
      status: commandStatus,
      disposition: commandDisposition,
      leaseOwner: clientState.clientId,
      leaseSession: clientState.sessionId,
      proofDigest: contextPackArtifact.auditProof.digest,
      contextPackId: contextPackArtifact.packId,
      lease: commandAlreadyApplied || commandBlocked ? checkpoint.activeLease : nextLease,
      nextAction: handoff.nextAction
    },
    storagePatch: {
      operation: "upsert_checkpoint",
      conflictKey: currentCommand.idempotencyKey,
      conflictPolicy: "return_existing_when_completed_else_merge_command_log",
      writePrecondition: {
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        checkpointId: checkpoint.checkpointId,
        notAfterStatus: commandAlreadyApplied ? "completed" : null
      },
      patch: {
        status: persistenceStatus,
        updatedAt: now,
        restartCount: checkpoint.restartCount + (recovery.resumedFromCheckpoint ? 1 : 0),
        lastCommandId: currentCommand.id,
        completedCommandIds,
        commandLog: nextCommandLog,
        lifecycle: nextLifecycleState,
        activeLease: commandAlreadyApplied || commandBlocked ? checkpoint.activeLease : nextLease,
        statusSemantics: statusSemanticsPatch,
        recoveryCursor,
        failureTransition: {
          mode: failureTransition.mode,
          nextCheckpointStatus: failureTransition.statusPatch.nextCheckpointStatus,
          schedulerDisposition: failureTransition.schedulerDisposition,
          retryBudget: failureTransition.retryBudget,
          operatorActions: failureTransition.operatorActions
        },
        operationalIncident: {
          incidentId: health.incident.incidentId,
          severity: health.incident.severity,
          status: health.incident.status,
          primaryCode: health.incident.primaryCode,
          retryAdmission: health.incident.retryAdmission,
          actionPlan: health.incident.actionPlan
        },
        healthRouting: {
          routeState: health.healthRouting.routeState,
          dispatch: health.healthRouting.dispatch,
          escalation: health.healthRouting.escalation
        },
        clientHandoff: {
          presentationId: handoff.clientWorkflowState.handoffPresentation.presentationId,
          channel: handoff.clientWorkflowState.handoffPresentation.channel,
          channelAction: handoff.clientWorkflowState.handoffPresentation.channelAction,
          acceptanceRequired: handoff.clientWorkflowState.handoffPresentation.acceptanceRequired,
          routePayload: handoff.clientWorkflowState.handoffPresentation.routePayload
        },
        analytics: {
          exportId: analytics.exportSummary.exportId,
          exportDigest: analytics.exportSummary.exportDigest,
          counters: analytics.counters,
          totals: analytics.totals,
          reportingWindow: analytics.reportingWindow,
          exportReadiness: analytics.exportReadiness,
          exportSummary: analytics.exportSummary
        },
        analyticsHistory: analytics.history,
        reportingTimeline: analytics.timeline,
        providerHandoff: {
          acceptedStateIds: contracts.providers.acceptedExternalHandoffStateIds,
          pendingProviderIds: contracts.providers.pendingExternalHandoffProviderIds,
          acknowledgements: contracts.providers.handoffAcknowledgements
        },
        compactWorkerLaunch: {
          launchId: contextPackArtifact.compactWorkerLaunch.launchId,
          status: contextPackArtifact.compactWorkerLaunch.launchStatus,
          action: contextPackArtifact.compactWorkerLaunch.launchAction,
          sandboxId: contextPackArtifact.compactWorkerLaunch.sandboxEnvelope.sandboxId,
          sandboxStatus: contextPackArtifact.compactWorkerLaunch.sandboxEnvelope.status,
          sandboxDigest: contextPackArtifact.compactWorkerLaunch.sandboxEnvelope.sandboxDigest,
          sandboxNamespaceRoot: contextPackArtifact.compactWorkerLaunch.sandboxEnvelope.namespaceRoot,
          sandboxBlockedReasons: contextPackArtifact.compactWorkerLaunch.sandboxEnvelope.blockedReasons,
          sandboxDeniedRetrievals: contextPackArtifact.compactWorkerLaunch.sandboxEnvelope.deniedRetrievals,
          sandboxDeniedMounts: contextPackArtifact.compactWorkerLaunch.sandboxEnvelope.deniedMounts,
          sandboxAuditHandoff: contextPackArtifact.compactWorkerLaunch.sandboxEnvelope.auditHandoff,
          retrievalManifestId: contextPackArtifact.compactWorkerLaunch.retrievalManifest.manifestId,
          retrievalManifestStatus: contextPackArtifact.compactWorkerLaunch.retrievalManifest.status,
          deferredFetches: contextPackArtifact.compactWorkerLaunch.retrievalManifest.deferredFetches,
          blockedRetrievals: contextPackArtifact.compactWorkerLaunch.retrievalManifest.blockedRetrievals,
          clientRetrievalQueueId: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.queueId,
          clientRetrievalQueueStatus: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.status,
          clientRetrievalNextAction: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.nextClientAction,
          clientRetrievalStatePatch: contextPackArtifact.compactWorkerLaunch.clientRetrievalHandoffQueue.clientStatePatch,
          launchRecoveryStatus: contextPackArtifact.compactWorkerLaunch.launchRecovery.status,
          launchRestartAction: contextPackArtifact.compactWorkerLaunch.launchRecovery.restartAction,
          launchReplayAdmitted: contextPackArtifact.compactWorkerLaunch.launchRecovery.replayAdmitted,
          launchReplayBlockedReasons: contextPackArtifact.compactWorkerLaunch.launchRecovery.replayBlockedReasons,
          retrievalCursor: contextPackArtifact.compactWorkerLaunch.launchRecovery.retrievalCursor,
          launchRecoveryStatePatch: contextPackArtifact.compactWorkerLaunch.launchRecovery.resumeStatePatch
        }
      }
    }
  };
}

export function describeContextPackSurface(input = {}) {
  const now = asTrimmedString(input.now, new Date().toISOString());
  const request = normalizeRequest(input);
  const clientState = normalizeClientState(input);
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const persistedState = normalizePersistedCheckpoint(input, request, clientState, now);
  const contracts = buildRuntimeContracts(input, request, clientState, evidence, persistedState, now);
  const recovery = buildRecoveryPlan(persistedState, request, contracts);
  const health = buildOperationalHealth(input, request, clientState, persistedState, contracts, recovery, now);
  const handoff = buildWorkflowHandoff(request, clientState, contracts, recovery, health);
  const contextPackArtifact = buildContextPackArtifact(
    input,
    request,
    clientState,
    contracts,
    recovery,
    health,
    handoff,
    now
  );
  const analytics = buildAnalyticsReporting(
    input,
    request,
    clientState,
    persistedState,
    contracts,
    recovery,
    health,
    handoff,
    evidence,
    now
  );
  const persistedStateRecovery = buildPersistedStateRecoveryEnvelope(
    request,
    clientState,
    persistedState,
    contracts,
    recovery,
    health,
    handoff,
    contextPackArtifact,
    analytics,
    now
  );
  const previewAcceptance = buildPreviewAcceptanceContract(
    input,
    request,
    clientState,
    contracts,
    recovery,
    health,
    handoff,
    now
  );
  const previewRouteClient = buildPreviewRouteClientContract(
    request,
    clientState,
    contracts,
    recovery,
    health,
    handoff,
    contextPackArtifact,
    analytics,
    previewAcceptance,
    now
  );

  return {
    ok: health.ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: DEFAULT_WAVE,
    contract: "hosted-kernel scheduler context-pack runtime contract",
    request,
    clientState,
    persistedState,
    recovery,
    runtimeContracts: {
      ...contracts,
      operationalHealth: health,
      analytics,
      contextPackArtifact,
      persistedStateRecovery,
      previewRouteClient
    },
    workflowHandoff: handoff,
    previewAcceptance,
    previewRouteClient,
    audit: {
      proofId: contracts.proof.id,
      evidence,
      blocked: contracts.scope.blockedTargets.length > 0 || recovery.status === "blocked" || health.mode === "failed",
      boundaryReason: contracts.boundary.enforcement.reason,
      workspaceScope: contracts.boundary.workspaceScope,
      tenantId: contracts.boundary.tenantId,
      workspaceId: contracts.boundary.workspaceId,
      restartSafe: recovery.restartSafe,
      recoveryStatus: recovery.status,
      healthMode: health.mode,
      validationIssues: health.validation.issues,
      failureState: health.failureState,
      operationalIncident: health.incident,
      healthRouting: health.healthRouting,
      retry: health.retry,
      degradedMode: health.degradedMode,
      actionableErrors: health.actionableErrors,
      lifecycleControls: {
        command: contracts.lifecycle.command,
        enabled: contracts.lifecycle.controls.enabled,
        paused: contracts.lifecycle.controls.paused,
        executionBlocked: contracts.lifecycle.controls.executionBlocked,
        blockReason: contracts.lifecycle.controls.blockReason,
        nextLifecycleAction: contracts.lifecycle.controls.nextLifecycleAction,
        schedule: contracts.lifecycle.schedule,
        commandTransition: contracts.lifecycle.commandTransition,
        dispatchPolicy: contracts.lifecycle.commandTransition.dispatchPolicy,
        settingsValidation: contracts.lifecycle.settingsValidation,
        statePatch: contracts.lifecycle.statePatch
      },
      providerContracts: contracts.providers.providers,
      externalHandoffStates: contracts.providers.externalHandoffStates,
      clientWorkflowState: handoff.clientWorkflowState,
      clientHandoffPresentation: handoff.clientWorkflowState.handoffPresentation,
      analyticsCounters: analytics.counters,
      analyticsExportSummary: analytics.exportSummary,
      reportingTimeline: analytics.timeline,
      contextPackArtifact: {
        packId: contextPackArtifact.packId,
        status: contextPackArtifact.status,
        digest: contextPackArtifact.auditProof.digest,
        includedCount: contextPackArtifact.sourceManifest.includedCount,
        omittedCount: contextPackArtifact.sourceManifest.omittedCount,
        requiredOmissionCount: contextPackArtifact.sourceManifest.requiredOmissionCount,
        usedTokens: contextPackArtifact.tokenBudget.usedTokens,
        tokenCeiling: contextPackArtifact.tokenBudget.tokenCeiling,
        compactWorkerLaunchId: contextPackArtifact.compactWorkerLaunch.launchId,
        compactWorkerLaunchStatus: contextPackArtifact.compactWorkerLaunch.launchStatus,
        compactWorkerLaunchAction: contextPackArtifact.compactWorkerLaunch.launchAction,
        workerRetrievalManifestId: contextPackArtifact.compactWorkerLaunch.retrievalManifest.manifestId,
        workerRetrievalManifestStatus: contextPackArtifact.compactWorkerLaunch.retrievalManifest.status,
        memoryMountCount: contextPackArtifact.compactWorkerLaunch.contextShape.memoryMountCount,
        assignedRetrievalCount: contextPackArtifact.compactWorkerLaunch.contextShape.assignedRetrievalCount,
        deferredFetchCount: contextPackArtifact.compactWorkerLaunch.contextShape.deferredFetchCount,
        blockedManifestRetrievalCount: contextPackArtifact.compactWorkerLaunch.contextShape.blockedManifestRetrievalCount,
        blockedLaunchReasons: contextPackArtifact.compactWorkerLaunch.launchBlockedReasons
      },
      persistedStateRecovery: {
        contractType: persistedStateRecovery.contractType,
        status: persistedStateRecovery.next.status,
        commandDisposition: persistedStateRecovery.restartSemantics.commandDisposition,
        replayPolicy: persistedStateRecovery.restartSemantics.replayPolicy,
        recoveryCursor: persistedStateRecovery.next.recoveryCursor,
        conflictKey: persistedStateRecovery.storagePatch.conflictKey,
        healthRouteState: persistedStateRecovery.next.healthRouting.routeState
      },
      previewAcceptance: {
        previewId: previewAcceptance.preview.previewId,
        status: previewAcceptance.preview.status,
        accepted: previewAcceptance.acceptance.accepted,
        canAccept: previewAcceptance.readiness.canAccept,
        blockers: previewAcceptance.readiness.blockers,
        primaryAction: previewAcceptance.explainableNextStep.primaryAction
      },
      previewRouteClient: {
        routeContractId: previewRouteClient.routeContractId,
        primaryAction: previewRouteClient.nextStepCard.primaryAction,
        primaryButtonLabel: previewRouteClient.nextStepCard.primaryButtonLabel,
        submitEnabled: previewRouteClient.acceptanceGate.submitEnabled,
        submitDisabledReasons: previewRouteClient.acceptanceGate.submitDisabledReasons,
        displayDigest: previewRouteClient.proofReceipt.displayDigest,
        validationTone: previewRouteClient.validationBanner.tone
      },
      idempotencyKey: recovery.idempotencyKey,
      generatedAt: now
    }
  };
}

export default describeContextPackSurface;
