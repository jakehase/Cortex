export const surfaceId = "aios_package-sdk_memory-pack_096";
export const surfaceGroup = "package-sdk";
export const surfaceName = "memory-pack";

export const memoryPackContractVersion = "2026-07-01.preview-acceptance.v1";

const REQUIRED_MEMORY_FIELDS = ["id", "title", "summary", "source"];
const ALLOWED_ACTIONS = new Set([
  "accept",
  "reject",
  "request_changes",
  "open_source",
  "merge",
  "enable_pack",
  "disable_pack",
  "configure_lifecycle",
  "run_scheduled_sync",
  "wait_for_schedule"
]);
const STATE_SCHEMA_VERSION = "memory-pack-state.v1";
const REVIEW_ACTIONS = new Set(["accept", "reject", "request_changes"]);
const IDEMPOTENT_STATEFUL_ACTIONS = new Set([
  "enable_pack",
  "disable_pack",
  "configure_lifecycle",
  "run_scheduled_sync",
  "wait_for_schedule"
]);
const LIFECYCLE_SETTINGS_SCHEMA_VERSION = "memory-pack-lifecycle-settings.v1";
const ALLOWED_REVIEW_MODES = new Set(["manual", "assisted", "auto_accept", "auto_merge"]);
const ALLOWED_SYNC_MODES = new Set(["manual", "interval", "event"]);
const MAX_RETRY_DELAY_MS = 60_000;
const DEFAULT_RETRY_BUDGET_WINDOW_MS = 300_000;
const DEFAULT_SYNC_STALE_AFTER_MS = 900_000;
const MIN_SCHEDULE_INTERVAL_MS = 60_000;
const DEFAULT_SCHEDULE_INTERVAL_MS = 900_000;
const REVIEW_DECISION_ACTIONS = new Set(["accept", "reject", "request_changes"]);
const REQUIRED_PROVIDER_CAPABILITIES = ["memory_pack.preview", "memory_pack.audit_proof", "memory_pack.state_replay"];
const MERGE_PROVIDER_CAPABILITY = "memory_pack.merge";
const ACTION_REQUIRED_ROLES = {
  accept: ["reviewer", "maintainer", "admin"],
  reject: ["reviewer", "maintainer", "admin"],
  request_changes: ["reviewer", "maintainer", "admin"],
  open_source: ["viewer", "reviewer", "maintainer", "admin"],
  merge: ["maintainer", "admin"],
  enable_pack: ["maintainer", "admin"],
  disable_pack: ["maintainer", "admin"],
  configure_lifecycle: ["maintainer", "admin"],
  run_scheduled_sync: ["maintainer", "admin"],
  wait_for_schedule: ["viewer", "reviewer", "maintainer", "admin"]
};
const RETRYABLE_FAILURE_CODES = new Set([
  "audit_evidence_missing",
  "circuit_breaker_open",
  "command_targets_unknown",
  "hosted_kernel_unavailable",
  "merge_blocked_after_restart",
  "memory_validation_blockers",
  "persisted_review_conflict_resolved",
  "review_incomplete",
  "stale_provider_sync",
  "state_restart_token_uncommitted"
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asNonEmptyString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map((value) => asNonEmptyString(value)).filter(Boolean))];
}

function boundedNumber(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function boundedInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function boundedPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function timestampMs(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function millisecondsUntil(value, now) {
  const target = timestampMs(value);
  const current = timestampMs(now);
  if (target === null || current === null) return 0;
  return Math.max(0, target - current);
}

function millisecondsSince(value, now) {
  const target = timestampMs(value);
  const current = timestampMs(now);
  if (target === null || current === null) return null;
  return Math.max(0, current - target);
}

function normalizeLifecycleSettings(input = {}, pack = {}, now = "") {
  const raw =
    input.lifecycleSettings ||
    input.lifecycle ||
    input.settings?.lifecycle ||
    pack.lifecycleSettings ||
    pack.lifecycle ||
    pack.settings?.lifecycle ||
    {};
  const rawSchedule = raw.schedule || raw.syncSchedule || input.schedule || pack.schedule || {};
  const rawControls = raw.controls || input.lifecycleControls || pack.lifecycleControls || {};
  const status = asNonEmptyString(raw.status || raw.state, raw.enabled === false ? "disabled" : "enabled");
  const reviewMode = asNonEmptyString(raw.reviewMode || raw.mode, "assisted");
  const syncMode = asNonEmptyString(rawSchedule.mode || rawSchedule.syncMode, rawSchedule.enabled === false ? "manual" : "interval");
  const intervalMs = boundedPositiveInteger(rawSchedule.intervalMs ?? rawSchedule.everyMs, DEFAULT_SCHEDULE_INTERVAL_MS);
  const pausedUntil = asNonEmptyString(rawSchedule.pausedUntil || raw.pauseUntil);
  const nextRunAt = asNonEmptyString(rawSchedule.nextRunAt || rawSchedule.nextSyncAt || raw.nextScheduledAt);
  const nowMs = timestampMs(now);
  const nextRunMs = timestampMs(nextRunAt);
  const pausedUntilMs = timestampMs(pausedUntil);
  const enabled = rawControls.enabled === false || status === "disabled" || status === "paused" ? false : true;
  const scheduleEnabled = rawSchedule.enabled === false || syncMode === "manual" ? false : true;
  const settingsIssues = uniqueStrings(
    []
      .concat(ALLOWED_REVIEW_MODES.has(reviewMode) ? [] : ["invalid_review_mode"])
      .concat(ALLOWED_SYNC_MODES.has(syncMode) ? [] : ["invalid_sync_mode"])
      .concat(scheduleEnabled && intervalMs < MIN_SCHEDULE_INTERVAL_MS ? ["schedule_interval_too_short"] : [])
      .concat(reviewMode === "auto_merge" && raw.requireAuditProof === false ? ["auto_merge_requires_audit_proof"] : [])
      .concat(reviewMode === "auto_merge" && raw.requireSourceEvidence === false ? ["auto_merge_requires_source_evidence"] : [])
  );
  return {
    schemaVersion: LIFECYCLE_SETTINGS_SCHEMA_VERSION,
    enabled,
    status: enabled ? "enabled" : "disabled",
    reviewMode: ALLOWED_REVIEW_MODES.has(reviewMode) ? reviewMode : "assisted",
    requestedReviewMode: reviewMode,
    allowDisable: rawControls.allowDisable !== false,
    allowManualMerge: rawControls.allowManualMerge !== false,
    requireAuditProof: raw.requireAuditProof !== false,
    requireSourceEvidence: raw.requireSourceEvidence !== false,
    autoMerge: {
      enabled: reviewMode === "auto_merge" || raw.autoMerge === true,
      requiresNoWarnings: raw.autoMerge?.requiresNoWarnings !== false,
      requestedBy: asNonEmptyString(raw.autoMerge?.requestedBy || raw.requestedBy)
    },
    schedule: {
      enabled: scheduleEnabled,
      syncMode: ALLOWED_SYNC_MODES.has(syncMode) ? syncMode : "interval",
      requestedSyncMode: syncMode,
      intervalMs,
      minIntervalMs: MIN_SCHEDULE_INTERVAL_MS,
      nextRunAt: nextRunAt || null,
      pausedUntil: pausedUntil || null,
      dueNow: scheduleEnabled && (!nextRunMs || !nowMs || nextRunMs <= nowMs),
      paused: Boolean(pausedUntilMs && nowMs && pausedUntilMs > nowMs),
      pauseRemainingMs: pausedUntilMs && nowMs ? Math.max(0, pausedUntilMs - nowMs) : 0
    },
    validation: {
      status: settingsIssues.length === 0 ? "valid" : "invalid",
      issueCodes: settingsIssues
    }
  };
}

function commandTargets(command) {
  return uniqueStrings(command?.targetIds || command?.memoryIds || command?.ids || [command?.targetId || command?.memoryId]);
}

function stableCommandId(command, index) {
  const action = asNonEmptyString(command?.action, "unknown");
  const actor = asNonEmptyString(command?.actorId || command?.reviewer, "system");
  const targets = commandTargets(command).join(",");
  const at = asNonEmptyString(command?.at || command?.createdAt || command?.generatedAt, "no-time");
  return `${action}:${actor}:${targets || "no-target"}:${at}:${index + 1}`;
}

function normalizeEvidence(evidence = []) {
  return asArray(evidence).map((item, index) => ({
    evidenceId: asNonEmptyString(item?.evidenceId || item?.id, `evidence-${index + 1}`),
    kind: asNonEmptyString(item?.kind || item?.type, "source"),
    label: asNonEmptyString(item?.label || item?.title || item?.uri, "Untitled evidence"),
    uri: asNonEmptyString(item?.uri || item?.href),
    hash: asNonEmptyString(item?.hash || item?.sha256),
    targetIds: commandTargets(item),
    capturedAt: asNonEmptyString(item?.capturedAt || item?.generatedAt)
  }));
}

function normalizeMemories(input = {}) {
  const memories = asArray(input.memories || input.items || input.entries);
  return memories.map((memory, index) => {
    const source = asNonEmptyString(memory?.source || memory?.sourceUri || memory?.origin);
    const confidence = Number.isFinite(memory?.confidence) ? Math.max(0, Math.min(1, memory.confidence)) : null;
    return {
      memoryId: asNonEmptyString(memory?.memoryId || memory?.id, `memory-${index + 1}`),
      title: asNonEmptyString(memory?.title || memory?.name, `Memory ${index + 1}`),
      summary: asNonEmptyString(memory?.summary || memory?.description),
      source,
      tenantId: asNonEmptyString(memory?.tenantId || memory?.tenant || input.tenantId || input.orgId),
      workspaceId: asNonEmptyString(memory?.workspaceId || memory?.workspace || input.workspaceId || input.projectId),
      kind: asNonEmptyString(memory?.kind || memory?.type, "fact"),
      tags: uniqueStrings(memory?.tags),
      confidence,
      updatedAt: asNonEmptyString(memory?.updatedAt || memory?.createdAt),
      missingFields: REQUIRED_MEMORY_FIELDS.filter((field) => {
        if (field === "id") return !asNonEmptyString(memory?.memoryId || memory?.id);
        if (field === "source") return !source;
        return !asNonEmptyString(memory?.[field]);
      })
    };
  });
}

function roleAllowsAction(roles, permissions, action) {
  if (permissions.includes("memory_pack:*") || permissions.includes(`memory_pack:${action}`)) return true;
  return (ACTION_REQUIRED_ROLES[action] || []).some((role) => roles.includes(role));
}

function commandScope(command = {}) {
  return {
    tenantId: asNonEmptyString(command.tenantId || command.tenant || command.orgId),
    workspaceId: asNonEmptyString(command.workspaceId || command.workspace || command.projectId),
    actorId: asNonEmptyString(command.actorId || command.reviewer)
  };
}

function normalizeGrantActions(grant = {}) {
  const rawActions = uniqueStrings(
    []
      .concat(grant.actions || [])
      .concat(grant.action || [])
      .concat(grant.permissions || [])
      .concat(grant.permission || [])
  );
  return rawActions.map((action) => (action.startsWith("memory_pack:") ? action.slice("memory_pack:".length) : action));
}

function normalizeBoundaryGrant(grant = {}, index, boundaryTenantId, boundaryWorkspaceId, now = "") {
  const tenantId = asNonEmptyString(grant.tenantId || grant.tenant || grant.orgId, boundaryTenantId);
  const workspaceId = asNonEmptyString(grant.workspaceId || grant.workspace || grant.projectId, boundaryWorkspaceId);
  const actions = normalizeGrantActions(grant);
  const memoryIds = uniqueStrings(grant.memoryIds || grant.targetIds || grant.scopedMemoryIds);
  const expiresAt = asNonEmptyString(grant.expiresAt || grant.validUntil);
  const expiresInMs = expiresAt ? millisecondsUntil(expiresAt, now) : null;
  const revoked = grant.revoked === true || grant.status === "revoked";
  const tenantMatched = tenantId === boundaryTenantId;
  const workspaceMatched = workspaceId === boundaryWorkspaceId;
  const expired = expiresAt ? expiresInMs === 0 : false;
  const inactiveReasons = uniqueStrings(
    []
      .concat(revoked ? ["grant_revoked"] : [])
      .concat(expired ? ["grant_expired"] : [])
      .concat(tenantMatched ? [] : ["grant_tenant_mismatch"])
      .concat(workspaceMatched ? [] : ["grant_workspace_mismatch"])
  );
  return {
    grantId: asNonEmptyString(grant.grantId || grant.id, `grant-${index + 1}`),
    tenantId,
    workspaceId,
    actorId: asNonEmptyString(grant.actorId || grant.subjectId || grant.principalId),
    role: asNonEmptyString(grant.role || grant.grantedRole),
    actions,
    memoryIds,
    allowsAllMemories: memoryIds.length === 0,
    issuedBy: asNonEmptyString(grant.issuedBy || grant.grantedBy),
    issuedAt: asNonEmptyString(grant.issuedAt || grant.createdAt),
    expiresAt: expiresAt || null,
    expiresInMs,
    status: inactiveReasons.length === 0 ? "active" : "inactive",
    inactiveReasons
  };
}

function normalizeBoundaryGrants(rawBoundary = {}, input = {}, pack = {}, tenantId, workspaceId, now = "") {
  const rawGrantInput =
    rawBoundary.permissionGrants ||
      rawBoundary.workspaceGrants ||
      rawBoundary.grants ||
      input.permissionGrants ||
      input.workspaceGrants ||
      pack.permissionGrants ||
      pack.workspaceGrants;
  const rawGrants = Array.isArray(rawGrantInput) ? rawGrantInput : rawGrantInput ? [rawGrantInput] : [];
  return rawGrants.map((grant, index) => normalizeBoundaryGrant(grant, index, tenantId, workspaceId, now));
}

function grantAllowsAction(grant, action, targetIds = [], actorId = "") {
  if (grant.status !== "active") return false;
  if (grant.actorId && actorId && grant.actorId !== actorId) return false;
  const actionAllowed = grant.actions.includes("*") || grant.actions.includes(action) || grant.actions.includes(`memory_pack:${action}`);
  if (!actionAllowed) return false;
  if (grant.allowsAllMemories || targetIds.length === 0) return true;
  return targetIds.every((targetId) => grant.memoryIds.includes(targetId));
}

function reviewActionForDecision(decision) {
  if (decision === "accepted") return "accept";
  if (decision === "rejected") return "reject";
  if (decision === "changes_requested") return "request_changes";
  return "";
}

function commandSemanticKey(action, targetIds, actorId = "") {
  return [action, uniqueStrings(targetIds).sort().join(","), actorId || "unknown"].join(":");
}

function commandReplayKey(action, targetIds, actorId = "", payload = {}) {
  const lifecycleRevision = asNonEmptyString(payload.lifecycleRevision || payload.settingsRevision || payload.revision);
  const scheduleCursor = asNonEmptyString(payload.scheduleCursor || payload.syncCursor || payload.cursor);
  const nextRunAt = asNonEmptyString(payload.nextRunAt || payload.nextSyncAt);
  return [commandSemanticKey(action, targetIds, actorId), lifecycleRevision, scheduleCursor, nextRunAt].filter(Boolean).join(":");
}

function normalizeLifecycleState(rawState = {}) {
  const rawLifecycle = rawState.lifecycleState || rawState.lifecycle || {};
  return {
    schemaVersion: "memory-pack-persisted-lifecycle-state.v1",
    status: asNonEmptyString(rawLifecycle.status || rawState.lifecycleStatus, "enabled"),
    settingsRevision: asNonEmptyString(rawLifecycle.settingsRevision || rawState.lifecycleSettingsRevision),
    configuredAt: asNonEmptyString(rawLifecycle.configuredAt || rawState.lifecycleConfiguredAt),
    enabledAt: asNonEmptyString(rawLifecycle.enabledAt || rawState.lifecycleEnabledAt),
    disabledAt: asNonEmptyString(rawLifecycle.disabledAt || rawState.lifecycleDisabledAt),
    lastCommandId: asNonEmptyString(rawLifecycle.lastCommandId || rawState.lifecycleLastCommandId)
  };
}

function normalizeSyncState(rawState = {}) {
  const rawSync = rawState.syncState || rawState.scheduledSync || rawState.sync || {};
  return {
    schemaVersion: "memory-pack-persisted-sync-state.v1",
    status: asNonEmptyString(rawSync.status, "idle"),
    scheduleCursor: asNonEmptyString(rawSync.scheduleCursor || rawSync.cursor || rawState.scheduleCursor),
    lastRequestedAt: asNonEmptyString(rawSync.lastRequestedAt || rawSync.requestedAt || rawState.lastScheduledSyncAt),
    lastCompletedAt: asNonEmptyString(rawSync.lastCompletedAt || rawSync.completedAt),
    nextRunAt: asNonEmptyString(rawSync.nextRunAt || rawSync.nextSyncAt || rawState.nextRunAt),
    requestCount: boundedInteger(rawSync.requestCount ?? rawState.syncRequestCount),
    lastCommandId: asNonEmptyString(rawSync.lastCommandId || rawState.syncLastCommandId)
  };
}

function commandEffectForLogEntry(entry = {}) {
  const rawEffect = entry.effect || entry.stateEffect || {};
  return {
    lifecycleStatus: asNonEmptyString(rawEffect.lifecycleStatus || entry.lifecycleStatus),
    settingsRevision: asNonEmptyString(rawEffect.settingsRevision || entry.settingsRevision),
    syncStatus: asNonEmptyString(rawEffect.syncStatus || entry.syncStatus),
    scheduleCursor: asNonEmptyString(rawEffect.scheduleCursor || entry.scheduleCursor),
    nextRunAt: asNonEmptyString(rawEffect.nextRunAt || entry.nextRunAt),
    replayKey: asNonEmptyString(rawEffect.replayKey || entry.replayKey || entry.semanticKey)
  };
}

function resolveReviewDecisionSets({ acceptedIds = [], rejectedIds = [], changeRequestedIds = [], commandLog = [], knownIds = [] }) {
  const knownIdSet = new Set(knownIds);
  const decisions = new Map();
  const conflicts = new Map();
  const applyDecision = (memoryId, decision, source) => {
    if (!knownIdSet.has(memoryId)) return;
    const previous = decisions.get(memoryId);
    if (previous && previous.decision !== decision) {
      const existing = conflicts.get(memoryId) || {
        memoryId,
        decisions: [],
        resolvedDecision: decision,
        resolvedBy: source
      };
      existing.decisions.push(previous.decision, decision);
      existing.resolvedDecision = decision;
      existing.resolvedBy = source;
      conflicts.set(memoryId, existing);
    }
    decisions.set(memoryId, { decision, source });
  };

  uniqueStrings(acceptedIds).forEach((id) => applyDecision(id, "accepted", "persisted.acceptedIds"));
  uniqueStrings(rejectedIds).forEach((id) => applyDecision(id, "rejected", "persisted.rejectedIds"));
  uniqueStrings(changeRequestedIds).forEach((id) => applyDecision(id, "changes_requested", "persisted.changeRequestedIds"));
  asArray(commandLog).forEach((entry) => {
    const action = asNonEmptyString(entry?.action);
    const decision = action === "accept" ? "accepted" : action === "reject" ? "rejected" : action === "request_changes" ? "changes_requested" : "";
    if (!decision) return;
    uniqueStrings(entry?.targetIds || entry?.memoryIds).forEach((id) => applyDecision(id, decision, `command:${entry.commandId || entry.id || action}`));
  });

  const resolved = { acceptedIds: [], rejectedIds: [], changeRequestedIds: [] };
  for (const [memoryId, entry] of decisions.entries()) {
    if (entry.decision === "accepted") resolved.acceptedIds.push(memoryId);
    if (entry.decision === "rejected") resolved.rejectedIds.push(memoryId);
    if (entry.decision === "changes_requested") resolved.changeRequestedIds.push(memoryId);
  }
  return {
    acceptedIds: uniqueStrings(resolved.acceptedIds),
    rejectedIds: uniqueStrings(resolved.rejectedIds),
    changeRequestedIds: uniqueStrings(resolved.changeRequestedIds),
    conflictCount: conflicts.size,
    conflicts: [...conflicts.values()].map((conflict) => ({
      ...conflict,
      decisions: uniqueStrings(conflict.decisions)
    }))
  };
}

function normalizeBoundaryContext(input = {}, pack = {}, memories = [], now = "") {
  const raw = input.boundary || input.accessBoundary || input.tenantBoundary || pack.boundary || pack.accessBoundary || {};
  const actor = raw.actor || input.actor || input.clientRequest?.actor || {};
  const tenantId = asNonEmptyString(raw.tenantId || input.tenantId || input.orgId || pack.tenantId || pack.orgId, "tenant:default");
  const workspaceId = asNonEmptyString(
    raw.workspaceId || input.workspaceId || input.projectId || pack.workspaceId || pack.projectId,
    "workspace:default"
  );
  const actorId = asNonEmptyString(actor.actorId || actor.id || raw.actorId || input.actorId || input.reviewer, "unassigned");
  const roles = uniqueStrings(actor.roles || raw.roles || input.actorRoles || input.roles);
  const permissions = uniqueStrings(actor.permissions || raw.permissions || input.permissions);
  const permissionGrants = normalizeBoundaryGrants(raw, input, pack, tenantId, workspaceId, now);
  const activeGrantMemoryIds = uniqueStrings(
    permissionGrants
      .filter((grant) => grant.status === "active" && !grant.allowsAllMemories)
      .flatMap((grant) => grant.memoryIds)
  );
  const broadActiveGrant = permissionGrants.some((grant) => grant.status === "active" && grant.allowsAllMemories);
  const explicitAllowedMemoryIds = uniqueStrings(raw.allowedMemoryIds || raw.memoryIds || input.allowedMemoryIds || input.scopedMemoryIds);
  const allowedMemoryIds =
    explicitAllowedMemoryIds.length > 0
      ? explicitAllowedMemoryIds
      : activeGrantMemoryIds.length > 0 && !broadActiveGrant
        ? activeGrantMemoryIds
        : memories.map((memory) => memory.memoryId);
  const memoryScopes = memories.map((memory) => {
    const effectiveTenantId = memory.tenantId || tenantId;
    const effectiveWorkspaceId = memory.workspaceId || workspaceId;
    return {
      memoryId: memory.memoryId,
      tenantId: effectiveTenantId,
      workspaceId: effectiveWorkspaceId,
      inTenant: effectiveTenantId === tenantId,
      inWorkspace: effectiveWorkspaceId === workspaceId,
      allowed: allowedMemoryIds.includes(memory.memoryId)
    };
  });
  const outOfBoundaryMemoryIds = memoryScopes
    .filter((scope) => !scope.inTenant || !scope.inWorkspace || !scope.allowed)
    .map((scope) => scope.memoryId);
  return {
    schemaVersion: "memory-pack-boundary-context.v1",
    tenantId,
    workspaceId,
    actorId,
    roles,
    permissions,
    permissionGrants,
    allowedMemoryIds,
    defaultDeny: roles.length === 0 && permissions.length === 0 && permissionGrants.filter((grant) => grant.status === "active").length === 0,
    memoryScopes,
    outOfBoundaryMemoryIds
  };
}

function buildBoundaryAuditHandoff(boundary, boundaryResults) {
  const blockedResults = boundaryResults.filter((result) => result.status === "blocked_by_boundary");
  const authorizedResults = boundaryResults.filter((result) => result.status === "authorized");
  const inactiveGrantIds = boundary.permissionGrants
    .filter((grant) => grant.status !== "active")
    .map((grant) => grant.grantId);
  const activeGrantIds = boundary.permissionGrants
    .filter((grant) => grant.status === "active")
    .map((grant) => grant.grantId);
  return {
    schemaVersion: "memory-pack-boundary-audit-handoff.v1",
    status: blockedResults.length > 0 || boundary.outOfBoundaryMemoryIds.length > 0 ? "quarantine_required" : "ready_for_handoff",
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    actorId: boundary.actorId,
    activeGrantIds,
    inactiveGrantIds,
    redactionPolicy: {
      hideOutOfBoundaryMemoryContent: true,
      exposeBlockedCommandReasons: true,
      exposeGrantIds: activeGrantIds.length > 0
    },
    scopedExport: {
      allowedMemoryIds: boundary.allowedMemoryIds,
      outOfBoundaryMemoryIds: boundary.outOfBoundaryMemoryIds,
      authorizedCommandIds: authorizedResults.map((result) => result.commandId),
      quarantinedCommandIds: blockedResults.map((result) => result.commandId)
    },
    handoffRequiredBefore: blockedResults.length > 0 ? "state_replay" : boundary.outOfBoundaryMemoryIds.length > 0 ? "preview" : "none",
    proofCodes: uniqueStrings(
      blockedResults.flatMap((result) => result.rejectedBy).concat(boundary.outOfBoundaryMemoryIds.length > 0 ? ["memory_scope_out_of_boundary"] : [])
    )
  };
}

function authorizeMemoryPackCommands(commands = [], boundary, memories = []) {
  const knownIds = new Set(memories.map((memory) => memory.memoryId));
  const memoryScopeById = new Map(boundary.memoryScopes.map((scope) => [scope.memoryId, scope]));
  const authorizedCommands = [];
  const boundaryResults = [];

  asArray(commands).forEach((command, index) => {
    const action = asNonEmptyString(command?.action);
    const commandId = asNonEmptyString(command?.commandId || command?.id, stableCommandId(command, index));
    const targetIds = commandTargets(command);
    const knownTargetIds = targetIds.filter((id) => knownIds.has(id));
    const scope = commandScope(command);
    const scopeMismatches = [];
    if (scope.tenantId && scope.tenantId !== boundary.tenantId) scopeMismatches.push("tenant_mismatch");
    if (scope.workspaceId && scope.workspaceId !== boundary.workspaceId) scopeMismatches.push("workspace_mismatch");
    const boundaryTargetIds = knownTargetIds.filter((id) => {
      const memoryScope = memoryScopeById.get(id);
      return !memoryScope || !memoryScope.inTenant || !memoryScope.inWorkspace || !memoryScope.allowed;
    });
    const actorMismatch = scope.actorId && boundary.actorId !== "unassigned" && scope.actorId !== boundary.actorId;
    const roleAllowed = roleAllowsAction(boundary.roles, boundary.permissions, action);
    const matchingGrantIds = boundary.permissionGrants
      .filter((grant) => grantAllowsAction(grant, action, knownTargetIds, scope.actorId || boundary.actorId))
      .map((grant) => grant.grantId);
    const grantAllowed = matchingGrantIds.length > 0;
    const rejectedBy = uniqueStrings(
      []
        .concat(boundary.defaultDeny ? ["actor_role_required"] : [])
        .concat(roleAllowed || grantAllowed ? [] : [`permission_required:${action || "missing_action"}`])
        .concat(scopeMismatches)
        .concat(actorMismatch ? ["actor_mismatch"] : [])
        .concat(boundaryTargetIds.length > 0 ? ["target_out_of_workspace_scope"] : [])
    );

    if (rejectedBy.length === 0) {
      authorizedCommands.push(command);
    }
    boundaryResults.push({
      commandId,
      action: action || "missing",
      targetIds,
      knownTargetIds,
      boundaryTargetIds,
      status: rejectedBy.length === 0 ? "authorized" : "blocked_by_boundary",
      authorizationSource: rejectedBy.length === 0 ? (roleAllowed ? "role_or_permission" : "workspace_grant") : "none",
      matchingGrantIds,
      rejectedBy
    });
  });

  const blockedCommandResults = boundaryResults.filter((result) => result.status === "blocked_by_boundary");
  const auditHandoff = buildBoundaryAuditHandoff(boundary, boundaryResults);
  return {
    schemaVersion: "memory-pack-boundary-proof.v1",
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    actorId: boundary.actorId,
    roles: boundary.roles,
    permissions: boundary.permissions,
    permissionGrants: boundary.permissionGrants,
    scopedMemoryCount: boundary.memoryScopes.filter((scope) => scope.inTenant && scope.inWorkspace && scope.allowed).length,
    outOfBoundaryMemoryIds: boundary.outOfBoundaryMemoryIds,
    authorizedCommandCount: boundaryResults.filter((result) => result.status.startsWith("authorized")).length,
    blockedCommandCount: blockedCommandResults.length,
    commandResults: boundaryResults,
    authorizedCommands,
    auditHandoff,
    blockers: uniqueStrings(
      []
        .concat(boundary.outOfBoundaryMemoryIds.length > 0 ? ["memory_scope_out_of_boundary"] : [])
        .concat(blockedCommandResults.flatMap((result) => result.rejectedBy))
        .concat(auditHandoff.status === "quarantine_required" ? ["boundary_audit_handoff_required"] : [])
    )
  };
}

function normalizePersistedState(input = {}, pack = {}, memories = []) {
  const rawState = input.persistedState || input.state || pack.persistedState || pack.state || {};
  const knownIds = new Set(memories.map((memory) => memory.memoryId));
  const unknownPersistedIds = uniqueStrings(
    []
      .concat(rawState.acceptedIds || rawState.acceptedMemoryIds || [])
      .concat(rawState.rejectedIds || rawState.rejectedMemoryIds || [])
      .concat(rawState.changeRequestedIds || rawState.requestedChangeIds || [])
  ).filter((id) => !knownIds.has(id));
  const commandLog = asArray(rawState.commandLog || rawState.appliedCommands).map((entry, index) => ({
    commandId: asNonEmptyString(entry?.commandId || entry?.id, `persisted-command-${index + 1}`),
    action: asNonEmptyString(entry?.action, "unknown"),
    targetIds: uniqueStrings(entry?.targetIds || entry?.memoryIds),
    actorId: asNonEmptyString(entry?.actorId || entry?.reviewer, "unknown"),
    appliedAt: asNonEmptyString(entry?.appliedAt || entry?.at),
    effect: commandEffectForLogEntry(entry)
  }));
  const resolvedDecisions = resolveReviewDecisionSets({
    acceptedIds: rawState.acceptedIds || rawState.acceptedMemoryIds,
    rejectedIds: rawState.rejectedIds || rawState.rejectedMemoryIds,
    changeRequestedIds: rawState.changeRequestedIds || rawState.requestedChangeIds,
    commandLog,
    knownIds: memories.map((memory) => memory.memoryId)
  });
  return {
    schemaVersion: asNonEmptyString(rawState.schemaVersion, STATE_SCHEMA_VERSION),
    stateId: asNonEmptyString(rawState.stateId || rawState.id, `${asNonEmptyString(pack.packId || pack.id, "memory-pack")}:state`),
    restartToken: asNonEmptyString(rawState.restartToken || rawState.etag || rawState.revision, "uncommitted"),
    reviewVersion: boundedNumber(rawState.reviewVersion || rawState.version),
    acceptedIds: resolvedDecisions.acceptedIds,
    rejectedIds: resolvedDecisions.rejectedIds,
    changeRequestedIds: resolvedDecisions.changeRequestedIds,
    commandLog,
    lifecycleState: normalizeLifecycleState(rawState),
    syncState: normalizeSyncState(rawState),
    unknownPersistedIds,
    decisionConflictCount: resolvedDecisions.conflictCount,
    decisionConflicts: resolvedDecisions.conflicts,
    mergeRequestedAt: asNonEmptyString(rawState.mergeRequestedAt),
    mergedAt: asNonEmptyString(rawState.mergedAt),
    recoveredAt: asNonEmptyString(rawState.recoveredAt || input.recoveredAt)
  };
}

function applyMemoryPackCommands(baseState, commands = [], memories = [], now = "") {
  const knownIds = new Set(memories.map((memory) => memory.memoryId));
  const state = {
    ...baseState,
    acceptedIds: [...baseState.acceptedIds],
    rejectedIds: [...baseState.rejectedIds],
    changeRequestedIds: [...baseState.changeRequestedIds],
    commandLog: [...baseState.commandLog],
    lifecycleState: { ...baseState.lifecycleState },
    syncState: { ...baseState.syncState }
  };
  const appliedCommandIds = new Set(state.commandLog.map((entry) => entry.commandId));
  const appliedSemanticKeys = new Set(
    state.commandLog
      .filter((entry) => REVIEW_DECISION_ACTIONS.has(entry.action))
      .map((entry) => commandSemanticKey(entry.action, entry.targetIds, entry.actorId))
  );
  const appliedReplayKeys = new Set(
    state.commandLog
      .filter((entry) => IDEMPOTENT_STATEFUL_ACTIONS.has(entry.action))
      .map((entry) => entry.effect?.replayKey || commandReplayKey(entry.action, entry.targetIds, entry.actorId, entry.effect))
      .filter(Boolean)
  );
  const commandResults = [];

  asArray(commands).forEach((command, index) => {
    const action = asNonEmptyString(command?.action);
    const commandId = asNonEmptyString(command?.commandId || command?.id, stableCommandId(command, index));
    const targetIds = commandTargets(command);
    const knownTargetIds = targetIds.filter((id) => knownIds.has(id));
    const unknownTargetIds = targetIds.filter((id) => !knownIds.has(id));
    const actorId = asNonEmptyString(command?.actorId || command?.reviewer, "unknown");
    const semanticKey = commandSemanticKey(action, knownTargetIds, actorId);
    const replayKey = commandReplayKey(action, knownTargetIds, actorId, command);
    if (appliedCommandIds.has(commandId)) {
      commandResults.push({
        commandId,
        action,
        status: "skipped_duplicate",
        duplicateOf: commandId,
        targetIds: knownTargetIds,
        unknownTargetIds
      });
      return;
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      commandResults.push({ commandId, action: action || "missing", status: "rejected_unknown_action", targetIds, unknownTargetIds });
      return;
    }
    if (REVIEW_ACTIONS.has(action) && knownTargetIds.length === 0) {
      commandResults.push({ commandId, action, status: "rejected_no_known_targets", targetIds, unknownTargetIds });
      return;
    }
    if (REVIEW_ACTIONS.has(action) && appliedSemanticKeys.has(semanticKey)) {
      commandResults.push({
        commandId,
        action,
        status: "skipped_idempotent_replay",
        duplicateOf: semanticKey,
        targetIds: knownTargetIds,
        unknownTargetIds
      });
      appliedCommandIds.add(commandId);
      return;
    }
    if (IDEMPOTENT_STATEFUL_ACTIONS.has(action) && appliedReplayKeys.has(replayKey)) {
      commandResults.push({
        commandId,
        action,
        status: "skipped_idempotent_state_replay",
        duplicateOf: replayKey,
        targetIds: knownTargetIds,
        unknownTargetIds
      });
      appliedCommandIds.add(commandId);
      return;
    }

    const appliedAt = asNonEmptyString(command?.at || command?.createdAt, now);
    const effect = {
      lifecycleStatus: "",
      settingsRevision: "",
      syncStatus: "",
      scheduleCursor: "",
      nextRunAt: "",
      replayKey
    };
    if (action === "accept") {
      state.acceptedIds = uniqueStrings(state.acceptedIds.concat(knownTargetIds));
      state.rejectedIds = state.rejectedIds.filter((id) => !knownTargetIds.includes(id));
      state.changeRequestedIds = state.changeRequestedIds.filter((id) => !knownTargetIds.includes(id));
    } else if (action === "reject") {
      state.rejectedIds = uniqueStrings(state.rejectedIds.concat(knownTargetIds));
      state.acceptedIds = state.acceptedIds.filter((id) => !knownTargetIds.includes(id));
      state.changeRequestedIds = state.changeRequestedIds.filter((id) => !knownTargetIds.includes(id));
    } else if (action === "request_changes") {
      state.changeRequestedIds = uniqueStrings(state.changeRequestedIds.concat(knownTargetIds));
      state.acceptedIds = state.acceptedIds.filter((id) => !knownTargetIds.includes(id));
      state.rejectedIds = state.rejectedIds.filter((id) => !knownTargetIds.includes(id));
    } else if (action === "merge") {
      state.mergeRequestedAt = appliedAt;
    } else if (action === "enable_pack") {
      state.lifecycleState = {
        ...state.lifecycleState,
        status: "enabled",
        enabledAt: appliedAt,
        lastCommandId: commandId
      };
      effect.lifecycleStatus = "enabled";
    } else if (action === "disable_pack") {
      state.lifecycleState = {
        ...state.lifecycleState,
        status: "disabled",
        disabledAt: appliedAt,
        lastCommandId: commandId
      };
      effect.lifecycleStatus = "disabled";
    } else if (action === "configure_lifecycle") {
      const settingsRevision = asNonEmptyString(command?.lifecycleRevision || command?.settingsRevision || command?.revision, `rev-${state.reviewVersion + 1}`);
      state.lifecycleState = {
        ...state.lifecycleState,
        status: asNonEmptyString(command?.lifecycleStatus || command?.status, state.lifecycleState.status),
        settingsRevision,
        configuredAt: appliedAt,
        lastCommandId: commandId
      };
      effect.lifecycleStatus = state.lifecycleState.status;
      effect.settingsRevision = settingsRevision;
    } else if (action === "run_scheduled_sync") {
      const scheduleCursor = asNonEmptyString(command?.scheduleCursor || command?.syncCursor || command?.cursor, state.syncState.scheduleCursor);
      state.syncState = {
        ...state.syncState,
        status: "requested",
        scheduleCursor,
        lastRequestedAt: appliedAt,
        nextRunAt: asNonEmptyString(command?.nextRunAt || command?.nextSyncAt, state.syncState.nextRunAt),
        requestCount: state.syncState.requestCount + 1,
        lastCommandId: commandId
      };
      effect.syncStatus = "requested";
      effect.scheduleCursor = scheduleCursor;
      effect.nextRunAt = state.syncState.nextRunAt;
    } else if (action === "wait_for_schedule") {
      state.syncState = {
        ...state.syncState,
        status: "waiting",
        nextRunAt: asNonEmptyString(command?.nextRunAt || command?.nextSyncAt, state.syncState.nextRunAt),
        lastCommandId: commandId
      };
      effect.syncStatus = "waiting";
      effect.nextRunAt = state.syncState.nextRunAt;
    }

    appliedCommandIds.add(commandId);
    if (REVIEW_ACTIONS.has(action)) appliedSemanticKeys.add(semanticKey);
    if (IDEMPOTENT_STATEFUL_ACTIONS.has(action)) appliedReplayKeys.add(replayKey);
    state.reviewVersion += 1;
    state.commandLog.push({
      commandId,
      action,
      targetIds: knownTargetIds,
      actorId,
      appliedAt,
      effect
    });
    commandResults.push({
      commandId,
      action,
      status: unknownTargetIds.length > 0 ? "applied_with_unknown_targets" : "applied",
      targetIds: knownTargetIds,
      unknownTargetIds
    });
  });

  const resolvedDecisions = resolveReviewDecisionSets({
    acceptedIds: state.acceptedIds,
    rejectedIds: state.rejectedIds,
    changeRequestedIds: state.changeRequestedIds,
    commandLog: state.commandLog,
    knownIds: memories.map((memory) => memory.memoryId)
  });
  state.acceptedIds = resolvedDecisions.acceptedIds;
  state.rejectedIds = resolvedDecisions.rejectedIds;
  state.changeRequestedIds = resolvedDecisions.changeRequestedIds;
  state.decisionConflictCount = resolvedDecisions.conflictCount;
  state.decisionConflicts = resolvedDecisions.conflicts;

  return { state, commandResults };
}

function latestAppliedLifecycleCommand(commandResults = [], actions = []) {
  const actionSet = new Set(actions);
  return asArray(commandResults)
    .filter((result) => result.status.startsWith("applied") && actionSet.has(result.action))
    .slice(-1)[0] || null;
}

function buildEffectiveLifecycleSettings(requestedSettings, replayState, commandResults = [], now = "") {
  const lifecycleCommand = latestAppliedLifecycleCommand(commandResults, [
    "enable_pack",
    "disable_pack",
    "configure_lifecycle"
  ]);
  const scheduleCommand = latestAppliedLifecycleCommand(commandResults, ["run_scheduled_sync", "wait_for_schedule"]);
  const durableStatus = asNonEmptyString(replayState.lifecycleState?.status, requestedSettings.status);
  const commandForcedEnabled =
    lifecycleCommand?.action === "enable_pack" ? true : lifecycleCommand?.action === "disable_pack" ? false : null;
  const effectiveEnabled =
    commandForcedEnabled !== null
      ? commandForcedEnabled
      : requestedSettings.enabled && durableStatus !== "disabled";
  const scheduleNextRunAt = asNonEmptyString(replayState.syncState?.nextRunAt, requestedSettings.schedule.nextRunAt);
  const syncRequested = replayState.syncState?.status === "requested" && !replayState.syncState?.lastCompletedAt;
  const scheduleEnabled = requestedSettings.schedule.enabled && effectiveEnabled;
  const nextRunMs = timestampMs(scheduleNextRunAt);
  const nowMs = timestampMs(now);
  const pausedUntilMs = timestampMs(requestedSettings.schedule.pausedUntil);
  const schedulePaused = Boolean(pausedUntilMs && nowMs && pausedUntilMs > nowMs);
  const runtimeIssueCodes = uniqueStrings(
    []
      .concat(requestedSettings.enabled && durableStatus === "disabled" && commandForcedEnabled === null ? ["durable_lifecycle_disabled"] : [])
      .concat(!effectiveEnabled && requestedSettings.schedule.enabled ? ["schedule_requires_enabled_lifecycle"] : [])
      .concat(syncRequested && !scheduleEnabled ? ["sync_requested_while_schedule_disabled"] : [])
      .concat(syncRequested && !replayState.syncState?.scheduleCursor ? ["scheduled_sync_cursor_missing"] : [])
      .concat(scheduleEnabled && scheduleCommand?.action === "run_scheduled_sync" && !scheduleNextRunAt ? ["scheduled_sync_next_run_missing"] : [])
  );
  const validationIssueCodes = uniqueStrings(requestedSettings.validation.issueCodes.concat(runtimeIssueCodes));
  const scheduleControlStatus =
    !scheduleEnabled
      ? "disabled"
      : schedulePaused
        ? "paused"
        : syncRequested
          ? "sync_ack_pending"
          : nextRunMs && nowMs && nextRunMs > nowMs
            ? "waiting"
            : "due";
  const nextActionState =
    !effectiveEnabled
      ? "enable_required"
      : validationIssueCodes.length > 0
        ? "settings_repair_required"
        : syncRequested
          ? "await_sync_ack"
          : scheduleControlStatus === "due"
            ? "scheduled_sync_ready"
            : "review_or_merge";
  return {
    ...requestedSettings,
    enabled: effectiveEnabled,
    status: effectiveEnabled ? "enabled" : "disabled",
    schedule: {
      ...requestedSettings.schedule,
      enabled: scheduleEnabled,
      nextRunAt: scheduleNextRunAt || null,
      dueNow: scheduleEnabled && !schedulePaused && (!nextRunMs || !nowMs || nextRunMs <= nowMs),
      paused: schedulePaused,
      pauseRemainingMs: pausedUntilMs && nowMs ? Math.max(0, pausedUntilMs - nowMs) : 0,
      controlStatus: scheduleControlStatus,
      pendingAck: syncRequested,
      lastRequestedAt: replayState.syncState?.lastRequestedAt || null,
      scheduleCursor: replayState.syncState?.scheduleCursor || null,
      requestCount: replayState.syncState?.requestCount || 0
    },
    validation: {
      status: validationIssueCodes.length === 0 ? "valid" : "invalid",
      issueCodes: validationIssueCodes,
      requestedIssueCodes: requestedSettings.validation.issueCodes,
      runtimeIssueCodes
    },
    runtimeState: {
      schemaVersion: "memory-pack-lifecycle-runtime-state.v1",
      durableLifecycleStatus: durableStatus,
      durableSettingsRevision: replayState.lifecycleState?.settingsRevision || null,
      durableSyncStatus: replayState.syncState?.status || "idle",
      durableSyncCursor: replayState.syncState?.scheduleCursor || null,
      lastLifecycleCommandId: replayState.lifecycleState?.lastCommandId || lifecycleCommand?.commandId || null,
      lastScheduleCommandId: replayState.syncState?.lastCommandId || scheduleCommand?.commandId || null,
      commandForcedEnabled,
      effectiveDisabledBy: effectiveEnabled
        ? null
        : commandForcedEnabled === false
          ? "disable_pack_command"
          : requestedSettings.enabled === false
            ? "requested_settings"
            : "durable_lifecycle_state",
      scheduleControlStatus,
      nextActionState
    }
  };
}

function buildPreview(memories, previewLimit) {
  const limit = Number.isInteger(previewLimit) && previewLimit > 0 ? previewLimit : 5;
  return memories.slice(0, limit).map((memory, index) => ({
    row: index + 1,
    memoryId: memory.memoryId,
    title: memory.title,
    summary: memory.summary || "No summary supplied.",
    sourceLabel: memory.source || "Source required before acceptance",
    badges: [
      memory.kind,
      memory.confidence === null ? "confidence:unscored" : `confidence:${Math.round(memory.confidence * 100)}`
    ].concat(memory.tags.slice(0, 3)),
    blockingIssues: memory.missingFields.map((field) => `missing_${field}`)
  }));
}

function buildValidationSummary(memories, evidence) {
  const missingSourceIds = memories.filter((memory) => !memory.source).map((memory) => memory.memoryId);
  const missingSummaryIds = memories.filter((memory) => !memory.summary).map((memory) => memory.memoryId);
  const lowConfidenceIds = memories
    .filter((memory) => memory.confidence !== null && memory.confidence < 0.6)
    .map((memory) => memory.memoryId);
  const evidenceWithHashes = evidence.filter((item) => item.hash).length;
  const blockingIssueCount = missingSourceIds.length + missingSummaryIds.length;
  return {
    status: blockingIssueCount === 0 ? "pass" : "needs_input",
    checkedMemoryCount: memories.length,
    blockingIssueCount,
    warningCount: lowConfidenceIds.length,
    sourceCoverage: memories.length === 0 ? 0 : Number(((memories.length - missingSourceIds.length) / memories.length).toFixed(2)),
    proofCoverage: evidence.length === 0 ? 0 : Number((evidenceWithHashes / evidence.length).toFixed(2)),
    missingSourceIds,
    missingSummaryIds,
    lowConfidenceIds
  };
}

function sourceKey(value) {
  return asNonEmptyString(value).toLowerCase();
}

function evidenceMatchesMemory(evidence, memory) {
  const memorySource = sourceKey(memory.source);
  const evidenceUri = sourceKey(evidence.uri);
  return evidence.targetIds.includes(memory.memoryId) || (memorySource && evidenceUri === memorySource);
}

function buildSourceLineageProof(memories, evidence, acceptance) {
  const acceptedIdSet = new Set(acceptance.acceptedIds);
  const evidenceByMemory = memories.map((memory) => {
    const linkedEvidence = evidence.filter((item) => evidenceMatchesMemory(item, memory));
    const proofHashes = uniqueStrings(linkedEvidence.map((item) => item.hash));
    const linkedEvidenceIds = linkedEvidence.map((item) => item.evidenceId);
    const sourceBacked = Boolean(memory.source && linkedEvidence.length > 0);
    const issues = [];
    if (!memory.source) issues.push("missing_source");
    if (memory.source && linkedEvidence.length === 0) issues.push("source_evidence_unlinked");
    if (linkedEvidence.length > 0 && proofHashes.length === 0) issues.push("evidence_hash_missing");
    return {
      memoryId: memory.memoryId,
      accepted: acceptedIdSet.has(memory.memoryId),
      sourceUri: memory.source || null,
      sourceBacked,
      linkedEvidenceIds,
      proofHashes,
      issues
    };
  });
  const acceptedProofs = evidenceByMemory.filter((entry) => entry.accepted);
  const acceptedUnprovenIds = acceptedProofs.filter((entry) => !entry.sourceBacked).map((entry) => entry.memoryId);
  const acceptedWithHashIds = acceptedProofs
    .filter((entry) => entry.sourceBacked && entry.proofHashes.length > 0)
    .map((entry) => entry.memoryId);
  const unlinkedEvidenceIds = evidence
    .filter((item) => !memories.some((memory) => evidenceMatchesMemory(item, memory)))
    .map((item) => item.evidenceId);
  return {
    schemaVersion: "memory-pack-source-lineage-proof.v1",
    status: acceptedUnprovenIds.length === 0 ? "verified" : "blocked",
    acceptedMemoryCount: acceptance.acceptedIds.length,
    sourceBackedAcceptedCount: acceptedProofs.length - acceptedUnprovenIds.length,
    hashedAcceptedProofCount: acceptedWithHashIds.length,
    acceptedUnprovenIds,
    unlinkedEvidenceIds,
    evidenceByMemory
  };
}

function buildReviewQueue({ memories, preview, validationSummary, acceptance, sourceLineageProof, nextSteps }) {
  const proofByMemory = new Map(sourceLineageProof.evidenceByMemory.map((entry) => [entry.memoryId, entry]));
  const nextStepsByMemory = new Map();
  nextSteps.forEach((step) => {
    step.targetIds.forEach((memoryId) => {
      const existing = nextStepsByMemory.get(memoryId) || [];
      existing.push({ action: step.action, reason: step.reason });
      nextStepsByMemory.set(memoryId, existing);
    });
  });
  const previewRowsByMemory = new Map(preview.map((row) => [row.memoryId, row]));
  const queueItems = memories.map((memory, index) => {
    const proof = proofByMemory.get(memory.memoryId) || {};
    const decision = reviewDecisionForMemory(memory.memoryId, acceptance);
    const blockingIssues = uniqueStrings(
      memory.missingFields
        .map((field) => `missing_${field}`)
        .concat(proof.issues || [])
        .concat(validationSummary.lowConfidenceIds.includes(memory.memoryId) ? ["low_confidence"] : [])
    );
    const enabledActions = [];
    if (decision !== "accepted" && blockingIssues.length === 0) enabledActions.push("accept");
    if (decision !== "rejected") enabledActions.push("reject");
    if (decision !== "changes_requested" && blockingIssues.length > 0) enabledActions.push("request_changes");
    if (memory.source) enabledActions.push("open_source");
    return {
      queueIndex: index + 1,
      memoryId: memory.memoryId,
      title: memory.title,
      decision,
      visibleInPreview: previewRowsByMemory.has(memory.memoryId),
      sourceUri: memory.source || null,
      sourceBacked: proof.sourceBacked === true,
      linkedEvidenceIds: proof.linkedEvidenceIds || [],
      proofHashCount: (proof.proofHashes || []).length,
      confidence: memory.confidence,
      validationState: blockingIssues.length === 0 ? "actionable" : "needs_input",
      blockingIssues,
      enabledActions,
      recommendedNextSteps: nextStepsByMemory.get(memory.memoryId) || []
    };
  });
  const blockedItems = queueItems.filter((item) => item.blockingIssues.length > 0);
  const pendingItems = queueItems.filter((item) => item.decision === "pending");
  const readyToAcceptItems = queueItems.filter((item) => item.enabledActions.includes("accept"));
  return {
    schemaVersion: "memory-pack-review-queue.v1",
    status: blockedItems.length > 0 ? "needs_input" : pendingItems.length > 0 ? "review_pending" : "review_complete",
    previewedCount: preview.length,
    totalCount: queueItems.length,
    pendingCount: pendingItems.length,
    blockedCount: blockedItems.length,
    readyToAcceptCount: readyToAcceptItems.length,
    nextCursor: queueItems.length > preview.length ? queueItems[preview.length]?.memoryId || null : null,
    focusMemoryId:
      blockedItems[0]?.memoryId || pendingItems[0]?.memoryId || readyToAcceptItems[0]?.memoryId || queueItems[0]?.memoryId || null,
    bulkActions: {
      acceptableIds: readyToAcceptItems.map((item) => item.memoryId),
      changeRequiredIds: blockedItems.map((item) => item.memoryId),
      pendingIds: pendingItems.map((item) => item.memoryId)
    },
    items: queueItems
  };
}

function buildAcceptanceState(input, memories, validationSummary, persistedState) {
  const knownIds = new Set(memories.map((memory) => memory.memoryId));
  const acceptedIds = uniqueStrings((input.acceptedMemoryIds || input.acceptedIds || []).concat(persistedState.acceptedIds));
  const rejectedIds = uniqueStrings((input.rejectedMemoryIds || input.rejectedIds || []).concat(persistedState.rejectedIds));
  const changeRequestedIds = uniqueStrings(
    (input.changeRequestedIds || input.requestedChangeIds || []).concat(persistedState.changeRequestedIds)
  );
  const resolvedDecisions = resolveReviewDecisionSets({
    acceptedIds,
    rejectedIds,
    changeRequestedIds,
    commandLog: persistedState.commandLog,
    knownIds: memories.map((memory) => memory.memoryId)
  });
  const acceptedKnownIds = resolvedDecisions.acceptedIds.filter((id) => knownIds.has(id));
  const rejectedKnownIds = resolvedDecisions.rejectedIds.filter((id) => knownIds.has(id));
  const changeRequestedKnownIds = resolvedDecisions.changeRequestedIds.filter((id) => knownIds.has(id));
  const pendingIds = memories
    .map((memory) => memory.memoryId)
    .filter((id) => !acceptedKnownIds.includes(id) && !rejectedKnownIds.includes(id) && !changeRequestedKnownIds.includes(id));
  const decision =
    changeRequestedKnownIds.length > 0
      ? "awaiting_changes"
      : rejectedKnownIds.length > 0
        ? "rejected"
        : validationSummary.status === "pass" && pendingIds.length === 0
          ? "accepted"
          : "awaiting_review";
  return {
    decision,
    reviewer: asNonEmptyString(input.reviewer || input.actorId, "unassigned"),
    reviewVersion: persistedState.reviewVersion,
    acceptedIds: acceptedKnownIds,
    rejectedIds: rejectedKnownIds,
    changeRequestedIds: changeRequestedKnownIds,
    pendingIds,
    decisionConflictCount: (persistedState.decisionConflictCount || 0) + resolvedDecisions.conflictCount,
    decisionConflicts: persistedState.decisionConflicts.concat(resolvedDecisions.conflicts),
    unknownSubmittedIds: acceptedIds.concat(rejectedIds, changeRequestedIds, persistedState.unknownPersistedIds).filter((id) => !knownIds.has(id))
  };
}

function buildReadiness(
  validationSummary,
  acceptanceState,
  evidence,
  sourceLineageProof = null,
  boundaryProof = null,
  lifecycleSettings = null
) {
  const blockers = [];
  if ((acceptanceState.decisionConflictCount || 0) > 0) blockers.push("persisted_review_conflict_resolved");
  if (lifecycleSettings?.enabled === false) blockers.push("memory_pack_disabled");
  if (lifecycleSettings?.validation?.status === "invalid") blockers.push("lifecycle_settings_invalid");
  if (lifecycleSettings?.requireAuditProof !== false && evidence.length === 0) blockers.push("audit_evidence_missing");
  if (
    lifecycleSettings?.requireSourceEvidence !== false &&
    (sourceLineageProof?.acceptedUnprovenIds || []).length > 0
  ) {
    blockers.push("accepted_memory_evidence_unlinked");
  }
  if (validationSummary.blockingIssueCount > 0) blockers.push("memory_validation_blockers");
  if (acceptanceState.pendingIds.length > 0) blockers.push("acceptance_pending");
  if ((boundaryProof?.outOfBoundaryMemoryIds || []).length > 0) blockers.push("memory_scope_out_of_boundary");
  if ((boundaryProof?.blockedCommandCount || 0) > 0) blockers.push("command_blocked_by_boundary");
  return {
    status: blockers.length === 0 ? "ready" : "not_ready",
    canMerge: blockers.length === 0 && acceptanceState.decision === "accepted",
    blockers,
    requiredBeforeMerge: blockers.map((blocker) => {
      if (blocker === "memory_validation_blockers") return "Resolve missing source or summary fields.";
      if (blocker === "acceptance_pending") return "Accept, reject, or request changes for every previewed memory.";
      if (blocker === "accepted_memory_evidence_unlinked") return "Link accepted memories to source evidence before merge.";
      if (blocker === "memory_pack_disabled") return "Enable lifecycle controls before hosted-kernel commands can run.";
      if (blocker === "lifecycle_settings_invalid") return "Correct lifecycle mode, schedule, or auto-merge settings.";
      if (blocker === "memory_scope_out_of_boundary") return "Remove memories outside the active tenant workspace boundary.";
      if (blocker === "command_blocked_by_boundary") return "Replay only commands authorized for this actor and workspace.";
      if (blocker === "persisted_review_conflict_resolved") return "Inspect resolved persisted review conflicts before merge.";
      return "Attach at least one source-backed evidence record.";
    })
  };
}

function buildNextSteps(readiness, validationSummary, acceptanceState, sourceLineageProof = null, lifecycleSettings = null) {
  const steps = [];
  if (lifecycleSettings?.enabled === false) {
    steps.push({ action: "enable_pack", targetIds: [], reason: "lifecycle_disabled" });
  }
  if (lifecycleSettings?.validation?.status === "invalid") {
    steps.push({
      action: "configure_lifecycle",
      targetIds: [],
      reason: lifecycleSettings.validation.issueCodes[0] || "settings_invalid"
    });
  }
  if (validationSummary.missingSourceIds.length > 0) {
    steps.push({ action: "open_source", targetIds: validationSummary.missingSourceIds, reason: "source_required" });
  }
  if ((sourceLineageProof?.acceptedUnprovenIds || []).length > 0) {
    steps.push({ action: "open_source", targetIds: sourceLineageProof.acceptedUnprovenIds, reason: "evidence_link_required" });
  }
  if (validationSummary.missingSummaryIds.length > 0) {
    steps.push({ action: "request_changes", targetIds: validationSummary.missingSummaryIds, reason: "summary_required" });
  }
  if (acceptanceState.pendingIds.length > 0) {
    steps.push({ action: "accept", targetIds: acceptanceState.pendingIds, reason: "review_pending" });
  }
  if (readiness.canMerge) {
    steps.push({ action: "merge", targetIds: acceptanceState.acceptedIds, reason: "ready_for_hosted_kernel_merge" });
  }
  if (lifecycleSettings?.schedule?.enabled && lifecycleSettings.schedule.paused) {
    steps.push({ action: "wait_for_schedule", targetIds: [], reason: "schedule_paused" });
  } else if (lifecycleSettings?.schedule?.enabled && lifecycleSettings.schedule.dueNow) {
    steps.push({ action: "run_scheduled_sync", targetIds: acceptanceState.acceptedIds, reason: "scheduled_sync_due" });
  }
  return steps.filter((step) => ALLOWED_ACTIONS.has(step.action));
}

function buildRecoveryState(persistedState, commandResults, acceptanceState, readiness) {
  const rejectedCommands = commandResults.filter((result) => result.status.startsWith("rejected"));
  const duplicateCommands = commandResults.filter(
    (result) =>
      result.status === "skipped_duplicate" ||
      result.status === "skipped_idempotent_replay" ||
      result.status === "skipped_idempotent_state_replay"
  );
  const stateReplayDuplicates = commandResults.filter((result) => result.status === "skipped_idempotent_state_replay");
  const unknownTargetCommands = commandResults.filter((result) => result.unknownTargetIds.length > 0);
  const canonicalRestartToken = `${persistedState.stateId}@${persistedState.reviewVersion}`;
  const restartTokenCommitted = persistedState.restartToken !== "uncommitted";
  const pendingScheduledSync = persistedState.syncState.status === "requested" && !persistedState.syncState.lastCompletedAt;
  const lifecycleDisabled = persistedState.lifecycleState.status === "disabled";
  const checkpointStatus =
    rejectedCommands.length > 0
      ? "blocked"
      : pendingScheduledSync
        ? "sync_ack_pending"
      : (acceptanceState.decisionConflictCount || 0) > 0
        ? "conflict_resolved_requires_ack"
        : restartTokenCommitted
          ? "committed"
          : "needs_checkpoint";
  const status =
    persistedState.mergedAt || (persistedState.mergeRequestedAt && readiness.canMerge)
      ? "merged"
      : lifecycleDisabled
        ? "paused_after_recovery"
      : pendingScheduledSync
        ? "sync_pending_after_recovery"
      : persistedState.mergeRequestedAt && !readiness.canMerge
        ? "merge_blocked_after_restart"
        : readiness.canMerge
          ? "ready_after_recovery"
          : "recoverable_review";
  return {
    schemaVersion: persistedState.schemaVersion,
    stateId: persistedState.stateId,
    status,
    restartSafe: rejectedCommands.length === 0 && (acceptanceState.decisionConflictCount || 0) === 0,
    restartToken: canonicalRestartToken,
    recoveredAt: persistedState.recoveredAt || null,
    replayCheckpoint: {
      schemaVersion: "memory-pack-replay-checkpoint.v1",
      status: checkpointStatus,
      checkpointId: `${persistedState.stateId}:checkpoint:${persistedState.reviewVersion}`,
      persistedRestartToken: persistedState.restartToken,
      canonicalRestartToken,
      requiresWriteBack: !restartTokenCommitted || persistedState.restartToken !== canonicalRestartToken,
      requiresOperatorAck: (acceptanceState.decisionConflictCount || 0) > 0,
      replayedCommandCount: commandResults.length,
      appliedReviewVersion: persistedState.reviewVersion,
      lastAppliedCommandId: persistedState.commandLog[persistedState.commandLog.length - 1]?.commandId || null,
      conflictCount: acceptanceState.decisionConflictCount || 0,
      conflictMemoryIds: uniqueStrings((acceptanceState.decisionConflicts || []).map((conflict) => conflict.memoryId)),
      pendingScheduledSync,
      lifecycleDisabled
    },
    idempotency: {
      appliedCommandCount: commandResults.filter((result) => result.status.startsWith("applied")).length,
      duplicateCommandCount: duplicateCommands.length,
      semanticDuplicateCommandCount: commandResults.filter((result) => result.status === "skipped_idempotent_replay").length,
      stateReplayDuplicateCommandCount: stateReplayDuplicates.length,
      rejectedCommandCount: rejectedCommands.length,
      unknownTargetCommandCount: unknownTargetCommands.length
    },
    durableLifecycle: {
      status: persistedState.lifecycleState.status,
      settingsRevision: persistedState.lifecycleState.settingsRevision || null,
      configuredAt: persistedState.lifecycleState.configuredAt || null,
      enabledAt: persistedState.lifecycleState.enabledAt || null,
      disabledAt: persistedState.lifecycleState.disabledAt || null,
      lastCommandId: persistedState.lifecycleState.lastCommandId || null
    },
    durableSync: {
      status: persistedState.syncState.status,
      scheduleCursor: persistedState.syncState.scheduleCursor || null,
      lastRequestedAt: persistedState.syncState.lastRequestedAt || null,
      lastCompletedAt: persistedState.syncState.lastCompletedAt || null,
      nextRunAt: persistedState.syncState.nextRunAt || null,
      requestCount: persistedState.syncState.requestCount,
      lastCommandId: persistedState.syncState.lastCommandId || null,
      pendingAck: pendingScheduledSync
    },
    durableReview: {
      acceptedCount: acceptanceState.acceptedIds.length,
      rejectedCount: acceptanceState.rejectedIds.length,
      changeRequestedCount: acceptanceState.changeRequestedIds.length,
      pendingCount: acceptanceState.pendingIds.length
    }
  };
}

function normalizeHostedKernelHealth(input = {}, pack = {}) {
  const raw = input.hostedKernel || input.kernel || pack.hostedKernel || pack.kernel || {};
  const retry = raw.retry || input.retry || {};
  const retryBudget = raw.retryBudget || retry.budget || input.retryBudget || {};
  const circuitBreaker = raw.circuitBreaker || raw.circuit || input.circuitBreaker || {};
  const lastError = raw.lastError || input.lastError || {};
  const mode = asNonEmptyString(raw.mode || raw.status || input.kernelStatus, "online");
  const degradedReasons = uniqueStrings(raw.degradedReasons || raw.degradationReasons || input.degradedReasons);
  const outageReason = asNonEmptyString(raw.outageReason || raw.reason || input.outageReason);
  const retryAttempt = boundedInteger(retry.attempt ?? retry.retryAttempt ?? input.retryAttempt);
  const maxAttempts = boundedPositiveInteger(retryBudget.maxAttempts ?? retry.maxAttempts ?? input.maxRetryAttempts, 5);
  return {
    mode,
    online: raw.online === false || mode === "offline" || mode === "unavailable" ? false : true,
    degraded: raw.degraded === true || mode === "degraded" || degradedReasons.length > 0,
    degradedReasons,
    outageReason,
    routeTraceId: asNonEmptyString(raw.routeTraceId || raw.traceId || input.routeTraceId),
    retryAttempt,
    consecutiveFailures: boundedInteger(raw.consecutiveFailures ?? retry.consecutiveFailures ?? input.consecutiveFailures),
    lastSuccessfulAt: asNonEmptyString(raw.lastSuccessfulAt || raw.lastHealthyAt || input.lastSuccessfulAt),
    retryBudget: {
      maxAttempts,
      remainingAttempts: Math.max(0, maxAttempts - retryAttempt),
      windowMs: boundedPositiveInteger(retryBudget.windowMs ?? retry.windowMs ?? input.retryWindowMs, DEFAULT_RETRY_BUDGET_WINDOW_MS),
      resetAt: asNonEmptyString(retryBudget.resetAt || retry.resetAt || input.retryBudgetResetAt)
    },
    circuitBreaker: {
      open: circuitBreaker.open === true || mode === "circuit_open",
      openUntil: asNonEmptyString(circuitBreaker.openUntil || circuitBreaker.resetAt || raw.circuitOpenUntil),
      reason: asNonEmptyString(circuitBreaker.reason || circuitBreaker.lastTripReason)
    },
    retryAfterMs: boundedInteger(retry.retryAfterMs ?? raw.retryAfterMs ?? input.retryAfterMs),
    lastError: {
      code: asNonEmptyString(lastError.code || lastError.name),
      message: asNonEmptyString(lastError.message || lastError.reason),
      occurredAt: asNonEmptyString(lastError.occurredAt || lastError.at)
    }
  };
}

function normalizeProviderContracts(input = {}, pack = {}) {
  const rawProviderInput = input.providerContracts || input.providers || pack.providerContracts || pack.providers || pack.serviceContracts;
  const rawProviders = Array.isArray(rawProviderInput) ? rawProviderInput : rawProviderInput ? [rawProviderInput] : [];
  const providers =
    rawProviders.length > 0
      ? rawProviders
      : [
          {
            providerId: "hosted-kernel-memory-store",
            service: "memory-pack",
            capabilities: REQUIRED_PROVIDER_CAPABILITIES.concat(MERGE_PROVIDER_CAPABILITY),
            requiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
            sync: pack.sync || input.sync,
            handoff: pack.handoff || input.handoff
          }
        ];
  return providers.map((provider, index) => {
    const sync = provider?.sync || provider?.syncMetadata || {};
    const handoff = provider?.handoff || provider?.externalHandoff || {};
    const capabilities = uniqueStrings(provider?.capabilities || provider?.providedCapabilities);
    return {
      providerId: asNonEmptyString(provider?.providerId || provider?.id, `memory-provider-${index + 1}`),
      service: asNonEmptyString(provider?.service || provider?.serviceName, "memory-pack"),
      contractVersion: asNonEmptyString(provider?.contractVersion || provider?.version, memoryPackContractVersion),
      endpointRef: asNonEmptyString(provider?.endpointRef || provider?.endpoint || provider?.route),
      authMode: asNonEmptyString(provider?.authMode || provider?.auth?.mode, "hosted-kernel-session"),
      capabilities,
      requiredCapabilities: uniqueStrings(provider?.requiredCapabilities || REQUIRED_PROVIDER_CAPABILITIES),
      optionalCapabilities: uniqueStrings(provider?.optionalCapabilities || [MERGE_PROVIDER_CAPABILITY]),
      syncMetadata: {
        cursor: asNonEmptyString(sync.cursor || sync.syncCursor || sync.revision),
        lastSyncedAt: asNonEmptyString(sync.lastSyncedAt || sync.syncedAt),
        sourceRevision: asNonEmptyString(sync.sourceRevision || sync.etag || sync.version),
        dirty: sync.dirty === true
      },
      handoffState: {
        handoffId: asNonEmptyString(handoff.handoffId || handoff.id, `${surfaceName}:handoff:${index + 1}`),
        owner: asNonEmptyString(handoff.owner || handoff.ownerService || provider?.owner, "hosted-kernel"),
        externalStateId: asNonEmptyString(handoff.externalStateId || handoff.stateId),
        status: asNonEmptyString(handoff.status, "draft")
      }
    };
  });
}

function negotiateProviderCapabilities(providerContracts, readiness, operationalHealth) {
  const requiredCapabilities = REQUIRED_PROVIDER_CAPABILITIES.concat(readiness.canMerge ? [MERGE_PROVIDER_CAPABILITY] : []);
  const providers = providerContracts.map((provider) => {
    const missingRequiredCapabilities = requiredCapabilities.filter((capability) => !provider.capabilities.includes(capability));
    const availableOptionalCapabilities = provider.optionalCapabilities.filter((capability) => provider.capabilities.includes(capability));
    return {
      providerId: provider.providerId,
      service: provider.service,
      endpointRef: provider.endpointRef,
      authMode: provider.authMode,
      supported: missingRequiredCapabilities.length === 0,
      requiredCapabilities,
      missingRequiredCapabilities,
      availableOptionalCapabilities,
      syncRequired: provider.syncMetadata.dirty || !provider.syncMetadata.cursor,
      handoffRequired: readiness.canMerge || operationalHealth.retryPolicy.shouldRetry
    };
  });
  const selectedProvider = providers.find((provider) => provider.supported) || providers[0] || null;
  return {
    schemaVersion: "memory-pack-provider-negotiation.v1",
    status: selectedProvider?.supported ? "matched" : "blocked",
    selectedProviderId: selectedProvider?.providerId || null,
    requiredCapabilities,
    providers,
    blockers: uniqueStrings(providers.flatMap((provider) => provider.missingRequiredCapabilities))
  };
}

function buildExternalHandoffState({
  providerContracts,
  capabilityNegotiation,
  readiness,
  recovery,
  operationalHealth,
  acceptance,
  sourceLineageProof,
  boundaryProof,
  now
}) {
  const selectedProvider =
    providerContracts.find((provider) => provider.providerId === capabilityNegotiation.selectedProviderId) || providerContracts[0] || null;
  const selectedNegotiation = capabilityNegotiation.providers.find(
    (provider) => provider.providerId === capabilityNegotiation.selectedProviderId
  );
  const blocked =
    capabilityNegotiation.status === "blocked" ||
    operationalHealth.status === "failed" ||
    (readiness.canMerge && (selectedNegotiation?.missingRequiredCapabilities || []).includes(MERGE_PROVIDER_CAPABILITY));
  const scheduledSyncPendingAck = recovery.durableSync?.pendingAck === true;
  const status = blocked ? "blocked" : readiness.canMerge ? "ready_for_external_commit" : "review_sync_pending";
  return {
    schemaVersion: "memory-pack-external-handoff.v1",
    status,
    providerId: selectedProvider?.providerId || null,
    handoffId: selectedProvider?.handoffState.handoffId || `${surfaceName}:handoff:unassigned`,
    owner: selectedProvider?.handoffState.owner || "hosted-kernel",
    externalStateId: selectedProvider?.handoffState.externalStateId || recovery.stateId,
    generatedAt: now,
    syncMetadata: {
      cursor: selectedProvider?.syncMetadata.cursor || recovery.restartToken,
      sourceRevision: selectedProvider?.syncMetadata.sourceRevision || recovery.restartToken,
      lastSyncedAt: selectedProvider?.syncMetadata.lastSyncedAt || null,
      dirty:
        selectedProvider?.syncMetadata.dirty ||
        scheduledSyncPendingAck ||
        recovery.replayCheckpoint.requiresWriteBack ||
        acceptance.pendingIds.length > 0 ||
        operationalHealth.retryPolicy.shouldRetry,
      nextSyncReason: readiness.canMerge
        ? "commit_accepted_memory_pack"
        : scheduledSyncPendingAck
          ? "ack_scheduled_sync_request"
        : recovery.replayCheckpoint.requiresWriteBack
          ? "write_replay_checkpoint"
        : acceptance.pendingIds.length > 0
          ? "review_decisions_pending"
          : operationalHealth.retryPolicy.shouldRetry
            ? "retry_after_hosted_kernel_error"
            : "provider_state_checkpoint"
    },
    commitEnvelope: {
      contractVersion: memoryPackContractVersion,
      stateId: recovery.stateId,
      restartToken: recovery.restartToken,
      boundary: {
        tenantId: boundaryProof?.tenantId || null,
        workspaceId: boundaryProof?.workspaceId || null,
        actorId: boundaryProof?.actorId || null,
        status: (boundaryProof?.blockers || []).length > 0 ? "blocked" : "scoped"
      },
      acceptedIds: acceptance.acceptedIds,
      rejectedIds: acceptance.rejectedIds,
      changeRequestedIds: acceptance.changeRequestedIds,
      proofManifest: {
        lineageStatus: sourceLineageProof.status,
        sourceBackedAcceptedCount: sourceLineageProof.sourceBackedAcceptedCount,
        hashedAcceptedProofCount: sourceLineageProof.hashedAcceptedProofCount,
        acceptedUnprovenIds: sourceLineageProof.acceptedUnprovenIds
      },
      canCommit: status === "ready_for_external_commit"
    },
    blockers: blocked ? capabilityNegotiation.blockers.concat(operationalHealth.failureState.codes) : []
  };
}

function buildBoundaryExecutionLease({ boundaryProof, externalHandoff, recovery, now }) {
  const scopedExport = boundaryProof?.auditHandoff?.scopedExport || {};
  const allowedMemoryIds = uniqueStrings(scopedExport.allowedMemoryIds || []);
  const quarantinedMemoryIds = uniqueStrings(boundaryProof?.outOfBoundaryMemoryIds || []);
  const quarantinedCommandIds = uniqueStrings(scopedExport.quarantinedCommandIds || []);
  const authorizedCommandIds = uniqueStrings(scopedExport.authorizedCommandIds || []);
  const boundaryBlockers = uniqueStrings(boundaryProof?.blockers || []);
  const handoffBlocked =
    externalHandoff.status === "blocked" ||
    externalHandoff.commitEnvelope.boundary.status === "blocked" ||
    boundaryProof?.auditHandoff?.status === "quarantine_required";
  const blockedBy = uniqueStrings(
    []
      .concat(boundaryBlockers)
      .concat(handoffBlocked ? ["boundary_audit_handoff_not_clear"] : [])
      .concat(quarantinedMemoryIds.length > 0 ? ["memory_scope_quarantined"] : [])
      .concat(quarantinedCommandIds.length > 0 ? ["command_scope_quarantined"] : [])
  );
  const status = blockedBy.length === 0 ? "active" : "quarantined";
  return {
    schemaVersion: "memory-pack-boundary-execution-lease.v1",
    leaseId: [
      externalHandoff.handoffId,
      boundaryProof?.tenantId || "tenant:unknown",
      boundaryProof?.workspaceId || "workspace:unknown",
      recovery.restartToken
    ].join(":"),
    generatedAt: now,
    status,
    tenantId: boundaryProof?.tenantId || null,
    workspaceId: boundaryProof?.workspaceId || null,
    actorId: boundaryProof?.actorId || null,
    handoffId: externalHandoff.handoffId,
    externalStateId: externalHandoff.externalStateId,
    restartToken: recovery.restartToken,
    activeGrantIds: boundaryProof?.auditHandoff?.activeGrantIds || [],
    scopedMemoryIds: allowedMemoryIds,
    quarantinedMemoryIds,
    authorizedCommandIds,
    quarantinedCommandIds,
    redactionPolicy: boundaryProof?.auditHandoff?.redactionPolicy || {
      hideOutOfBoundaryMemoryContent: true,
      exposeBlockedCommandReasons: true,
      exposeGrantIds: false
    },
    submitPolicy: {
      requireTenantWorkspaceMatch: true,
      requireRestartTokenMatch: true,
      requireLeaseIdOnWrite: true,
      allowReadOnlyPreview: status === "active" || quarantinedCommandIds.length === 0,
      allowedWriteActions: status === "active" ? ["replay_review_state", "checkpoint_provider_sync", "commit_memory_pack"] : []
    },
    blockedBy
  };
}

function buildProviderServiceContractState({
  providerContracts,
  capabilityNegotiation,
  readiness,
  operationalHealth,
  externalHandoff,
  lifecycleSettings,
  boundaryExecutionLease,
  now
}) {
  const selectedProvider =
    providerContracts.find((provider) => provider.providerId === capabilityNegotiation.selectedProviderId) || providerContracts[0] || null;
  const selectedNegotiation =
    capabilityNegotiation.providers.find((provider) => provider.providerId === capabilityNegotiation.selectedProviderId) || null;
  const operationTemplates = [
    {
      operation: "preview",
      capability: "memory_pack.preview",
      action: "describe_memory_pack",
      routeSuffix: "preview",
      method: "read",
      requiresCommitReady: false,
      requiresSyncAck: false
    },
    {
      operation: "audit_proof",
      capability: "memory_pack.audit_proof",
      action: "export_audit_proof",
      routeSuffix: "audit-proof",
      method: "read",
      requiresCommitReady: false,
      requiresSyncAck: false
    },
    {
      operation: "state_replay",
      capability: "memory_pack.state_replay",
      action: "replay_review_state",
      routeSuffix: "state-replay",
      method: "write",
      requiresCommitReady: false,
      requiresSyncAck: true
    },
    {
      operation: "sync_checkpoint",
      capability: "memory_pack.state_replay",
      action: "checkpoint_provider_sync",
      routeSuffix: "sync-checkpoint",
      method: "write",
      requiresCommitReady: false,
      requiresSyncAck: true
    },
    {
      operation: "merge",
      capability: MERGE_PROVIDER_CAPABILITY,
      action: "commit_memory_pack",
      routeSuffix: "merge",
      method: "write",
      requiresCommitReady: true,
      requiresSyncAck: true
    }
  ];
  const providerRouteBase = selectedProvider?.endpointRef
    ? selectedProvider.endpointRef
    : selectedProvider
      ? `hosted-kernel.memory-pack.${selectedProvider.providerId}`
      : "hosted-kernel.memory-pack";
  const syncAgeMs = selectedProvider ? providerSyncAge(selectedProvider, now) : null;
  const syncStale = syncAgeMs !== null && syncAgeMs > DEFAULT_SYNC_STALE_AFTER_MS;
  const syncRequired =
    externalHandoff.syncMetadata.dirty ||
    syncStale ||
    !selectedProvider?.syncMetadata.cursor ||
    operationalHealth.retryPolicy.shouldRetry;
  const providerBlockedBy = uniqueStrings(
    []
      .concat(selectedProvider ? [] : ["provider_contract_missing"])
      .concat(selectedProvider?.endpointRef ? [] : ["provider_endpoint_missing"])
      .concat(capabilityNegotiation.status === "blocked" ? capabilityNegotiation.blockers : [])
      .concat(operationalHealth.routeGuard.routeAllowed ? [] : ["hosted_kernel_route_blocked"])
      .concat(lifecycleSettings.enabled ? [] : ["memory_pack_disabled"])
  );
  const operations = operationTemplates.map((template) => {
    const missingCapability = selectedProvider && !selectedProvider.capabilities.includes(template.capability);
    const leaseBlocksOperation =
      boundaryExecutionLease.status !== "active" &&
      (template.method === "write" || boundaryExecutionLease.submitPolicy.allowReadOnlyPreview !== true);
    const operationBlockedBy = uniqueStrings(
      []
        .concat(providerBlockedBy)
        .concat(leaseBlocksOperation ? ["boundary_execution_lease_blocked"] : [])
        .concat(missingCapability ? [`missing_capability:${template.capability}`] : [])
        .concat(template.requiresCommitReady && !externalHandoff.commitEnvelope.canCommit ? ["commit_not_ready"] : [])
        .concat(template.operation === "sync_checkpoint" && !syncRequired ? ["sync_checkpoint_not_required"] : [])
    );
    const enabled =
      operationBlockedBy.length === 0 &&
      (template.operation !== "merge" || readiness.canMerge) &&
      (template.operation !== "sync_checkpoint" || syncRequired);
    return {
      operation: template.operation,
      action: template.action,
      method: template.method,
      route: `${providerRouteBase}.${template.routeSuffix}`,
      requiredCapability: template.capability,
      enabled,
      blockedBy: operationBlockedBy,
      idempotencyScope: `${externalHandoff.handoffId}:${template.operation}:${externalHandoff.commitEnvelope.restartToken}`,
      requestContract: {
        contractVersion: memoryPackContractVersion,
        stateId: externalHandoff.externalStateId,
        restartToken: externalHandoff.commitEnvelope.restartToken,
        tenantId: externalHandoff.commitEnvelope.boundary.tenantId,
        workspaceId: externalHandoff.commitEnvelope.boundary.workspaceId,
        boundaryLease: {
          leaseId: boundaryExecutionLease.leaseId,
          status: boundaryExecutionLease.status,
          tenantId: boundaryExecutionLease.tenantId,
          workspaceId: boundaryExecutionLease.workspaceId,
          actorId: boundaryExecutionLease.actorId,
          scopedMemoryIds: boundaryExecutionLease.scopedMemoryIds,
          restartToken: boundaryExecutionLease.restartToken,
          redactionPolicy: boundaryExecutionLease.redactionPolicy
        },
        acceptedIds: template.requiresCommitReady ? externalHandoff.commitEnvelope.acceptedIds : [],
        proofManifestRequired: template.operation === "merge" || template.operation === "audit_proof"
      },
      responseContract: {
        requiresSyncAck: template.requiresSyncAck,
        expectedAckState:
          template.requiresSyncAck || template.operation === "merge"
            ? {
                externalStateId: externalHandoff.externalStateId,
                syncCursor: externalHandoff.syncMetadata.cursor,
                sourceRevision: externalHandoff.syncMetadata.sourceRevision
              }
            : null
      }
    };
  });
  const enabledWriteOperations = operations.filter((operation) => operation.enabled && operation.method === "write");
  return {
    schemaVersion: "memory-pack-provider-service-contract.v1",
    generatedAt: now,
    status:
      providerBlockedBy.length > 0
        ? "blocked"
        : externalHandoff.commitEnvelope.canCommit
          ? "commit_contract_ready"
          : syncRequired
            ? "sync_contract_pending"
            : "preview_contract_ready",
    selectedProviderId: selectedProvider?.providerId || null,
    service: selectedProvider?.service || "memory-pack",
    contractVersion: selectedProvider?.contractVersion || memoryPackContractVersion,
    providerRouteBase,
    selectedProviderSupported: selectedNegotiation?.supported === true,
    syncContract: {
      cursor: externalHandoff.syncMetadata.cursor,
      sourceRevision: externalHandoff.syncMetadata.sourceRevision,
      lastSyncedAt: selectedProvider?.syncMetadata.lastSyncedAt || null,
      syncAgeMs,
      staleAfterMs: DEFAULT_SYNC_STALE_AFTER_MS,
      stale: syncStale,
      dirty: externalHandoff.syncMetadata.dirty,
      syncRequired,
      nextSyncReason: externalHandoff.syncMetadata.nextSyncReason
    },
    handoffContract: {
      handoffId: externalHandoff.handoffId,
      externalStateId: externalHandoff.externalStateId,
      owner: externalHandoff.owner,
      commitAllowed: externalHandoff.commitEnvelope.canCommit,
      commitRequiresAck: externalHandoff.commitEnvelope.canCommit,
      boundaryLeaseId: boundaryExecutionLease.leaseId,
      boundaryLeaseStatus: boundaryExecutionLease.status,
      scopedMemoryIds: boundaryExecutionLease.scopedMemoryIds,
      blockedBy: providerBlockedBy
    },
    operations,
    enabledWriteOperations: enabledWriteOperations.map((operation) => operation.operation),
    nextServiceAction:
      operations.find((operation) => operation.enabled && operation.operation === "merge")?.action ||
      operations.find((operation) => operation.enabled && operation.operation === "sync_checkpoint")?.action ||
      operations.find((operation) => operation.enabled)?.action ||
      "repair_provider_contract"
  };
}

function providerOperationName(value) {
  const raw = asNonEmptyString(value, "unknown");
  if (raw === "commit_memory_pack") return "merge";
  if (raw === "checkpoint_provider_sync") return "sync_checkpoint";
  if (raw === "replay_review_state") return "state_replay";
  if (raw === "export_audit_proof") return "audit_proof";
  if (raw === "describe_memory_pack") return "preview";
  return raw;
}

function normalizeProviderServiceAcks(input = {}, pack = {}) {
  const rawAcks = asArray(
    input.providerServiceAcks ||
      input.providerAcks ||
      input.providerResponses ||
      pack.providerServiceAcks ||
      pack.providerAcks ||
      pack.providerResponses
  );
  return rawAcks.map((ack, index) => {
    const sync = ack?.syncMetadata || ack?.sync || {};
    const accepted = ack?.acceptedState || ack?.state || {};
    const operation = providerOperationName(ack?.operation || ack?.action || ack?.serviceOperation);
    const status = asNonEmptyString(ack?.status || ack?.result, "pending");
    return {
      ackId: asNonEmptyString(ack?.ackId || ack?.id, `provider-ack-${index + 1}`),
      providerId: asNonEmptyString(ack?.providerId || ack?.provider),
      operation,
      status,
      acceptedState: {
        stateId: asNonEmptyString(accepted.stateId || ack?.stateId || ack?.externalStateId),
        restartToken: asNonEmptyString(accepted.restartToken || ack?.restartToken || ack?.etag),
        reviewVersion: boundedNumber(accepted.reviewVersion ?? ack?.reviewVersion)
      },
      syncMetadata: {
        cursor: asNonEmptyString(sync.cursor || sync.syncCursor || ack?.syncCursor),
        sourceRevision: asNonEmptyString(sync.sourceRevision || sync.etag || ack?.sourceRevision),
        committedAt: asNonEmptyString(sync.committedAt || ack?.committedAt || ack?.receivedAt),
        writeApplied: sync.writeApplied === true || ack?.writeApplied === true || status === "applied" || status === "committed"
      },
      idempotencyScope: asNonEmptyString(ack?.idempotencyScope || ack?.idempotencyKey),
      boundaryLeaseId: asNonEmptyString(ack?.boundaryLeaseId || ack?.leaseId || ack?.boundaryLease?.leaseId),
      retryAfterMs: boundedInteger(ack?.retryAfterMs),
      errorCode: asNonEmptyString(ack?.errorCode || ack?.code),
      message: asNonEmptyString(ack?.message || ack?.reason),
      receivedAt: asNonEmptyString(ack?.receivedAt || ack?.at)
    };
  });
}

function latestAckByOperation(providerServiceAcks, selectedProviderId) {
  const selectedAcks = providerServiceAcks.filter((ack) => !selectedProviderId || !ack.providerId || ack.providerId === selectedProviderId);
  return selectedAcks.reduce((acksByOperation, ack) => {
    const previous = acksByOperation.get(ack.operation);
    const previousTime = timestampMs(previous?.receivedAt) || 0;
    const nextTime = timestampMs(ack.receivedAt) || previousTime + 1;
    if (!previous || nextTime >= previousTime) acksByOperation.set(ack.operation, ack);
    return acksByOperation;
  }, new Map());
}

function reconcileAckForOperation(operation, ack, expectedState) {
  const terminalFailure = ack && ["failed", "rejected", "conflict"].includes(ack.status);
  const blockers = uniqueStrings(
    []
      .concat(ack ? [] : ["provider_ack_missing"])
      .concat(terminalFailure ? [`provider_ack_${ack.status}`] : [])
      .concat(ack?.acceptedState.stateId && ack.acceptedState.stateId !== expectedState.externalStateId ? ["ack_state_id_mismatch"] : [])
      .concat(ack?.acceptedState.restartToken && ack.acceptedState.restartToken !== expectedState.restartToken ? ["ack_restart_token_mismatch"] : [])
      .concat(expectedState.boundaryLeaseId && ack && ack.boundaryLeaseId && ack.boundaryLeaseId !== expectedState.boundaryLeaseId ? ["ack_boundary_lease_mismatch"] : [])
      .concat(expectedState.boundaryLeaseRequired && ack && !ack.boundaryLeaseId ? ["ack_boundary_lease_missing"] : [])
      .concat(ack && !ack.syncMetadata.cursor ? ["ack_sync_cursor_missing"] : [])
      .concat(ack && !ack.syncMetadata.sourceRevision ? ["ack_source_revision_missing"] : [])
      .concat(ack && !ack.syncMetadata.writeApplied ? ["ack_write_not_applied"] : [])
  );
  return {
    operation: operation.operation,
    action: operation.action,
    route: operation.route,
    requiredAck: operation.responseContract.requiresSyncAck,
    ackId: ack?.ackId || null,
    ackStatus: ack?.status || "missing",
    acknowledged: blockers.length === 0,
    acceptedState: ack?.acceptedState || null,
    syncMetadata: ack?.syncMetadata || null,
    boundaryLeaseId: ack?.boundaryLeaseId || null,
    retryAfterMs: ack?.retryAfterMs || 0,
    errorCode: ack?.errorCode || null,
    blockedBy: blockers
  };
}

function buildProviderAckReconciliation({ providerServiceContract, providerServiceAcks, externalHandoff, boundaryExecutionLease, now }) {
  const expectedState = {
    externalStateId: externalHandoff.externalStateId,
    restartToken: externalHandoff.commitEnvelope.restartToken,
    boundaryLeaseId: boundaryExecutionLease?.leaseId || null,
    boundaryLeaseRequired: boundaryExecutionLease?.submitPolicy?.requireLeaseIdOnWrite === true
  };
  const ackByOperation = latestAckByOperation(providerServiceAcks, providerServiceContract.selectedProviderId);
  const requiredAckOperations = providerServiceContract.operations.filter(
    (operation) => operation.enabled && operation.responseContract.requiresSyncAck
  );
  const operationAcks = requiredAckOperations.map((operation) =>
    reconcileAckForOperation(operation, ackByOperation.get(operation.operation), expectedState)
  );
  const acknowledgedOperations = operationAcks.filter((operation) => operation.acknowledged).map((operation) => operation.operation);
  const failedOperations = operationAcks.filter((operation) => operation.blockedBy.length > 0);
  const latestAppliedAck = operationAcks
    .filter((operation) => operation.acknowledged && operation.syncMetadata)
    .slice(-1)[0];
  const mergeAck = operationAcks.find((operation) => operation.operation === "merge");
  const syncCheckpointAck = operationAcks.find((operation) => operation.operation === "sync_checkpoint");
  return {
    schemaVersion: "memory-pack-provider-ack-reconciliation.v1",
    generatedAt: now,
    selectedProviderId: providerServiceContract.selectedProviderId,
    expectedState,
    status:
      requiredAckOperations.length === 0
        ? "no_ack_required"
        : failedOperations.length === 0
          ? "acknowledged"
          : acknowledgedOperations.length > 0
            ? "partially_acknowledged"
            : "waiting_for_provider_ack",
    requiredAckOperations: requiredAckOperations.map((operation) => operation.operation),
    acknowledgedOperations,
    missingAckOperations: failedOperations
      .filter((operation) => operation.blockedBy.includes("provider_ack_missing"))
      .map((operation) => operation.operation),
    retryableAckOperations: failedOperations
      .filter((operation) => operation.retryAfterMs > 0 || operation.errorCode)
      .map((operation) => operation.operation),
    committed:
      externalHandoff.commitEnvelope.canCommit && mergeAck?.acknowledged === true,
    checkpointed:
      syncCheckpointAck?.acknowledged === true ||
      operationAcks.some((operation) => operation.operation === "state_replay" && operation.acknowledged),
    providerCursor: latestAppliedAck?.syncMetadata?.cursor || externalHandoff.syncMetadata.cursor,
    providerSourceRevision: latestAppliedAck?.syncMetadata?.sourceRevision || externalHandoff.syncMetadata.sourceRevision,
    handoffLedger: {
      handoffId: externalHandoff.handoffId,
      externalStateId: externalHandoff.externalStateId,
      owner: externalHandoff.owner,
      pendingAckCount: failedOperations.length,
      lastAckId: latestAppliedAck?.ackId || null,
      lastAcknowledgedOperation: latestAppliedAck?.operation || null
    },
    operationAcks,
    blockers: uniqueStrings(failedOperations.flatMap((operation) => operation.blockedBy)),
    nextProviderAction:
      failedOperations.find((operation) => operation.blockedBy.includes("provider_ack_missing"))?.action ||
      failedOperations.find((operation) => operation.retryAfterMs > 0)?.action ||
      providerServiceContract.nextServiceAction
  };
}

function buildLifecycleControlState({ lifecycleSettings, readiness, operationalHealth, externalHandoff, acceptance, now }) {
  const scheduleBlockedBy = uniqueStrings(
    []
      .concat(lifecycleSettings.enabled ? [] : ["memory_pack_disabled"])
      .concat(lifecycleSettings.validation.issueCodes)
      .concat(lifecycleSettings.schedule.paused ? ["schedule_paused"] : [])
      .concat(operationalHealth.routeGuard.routeAllowed ? [] : ["hosted_kernel_route_blocked"])
  );
  const canRunScheduledSync =
    lifecycleSettings.schedule.enabled &&
    lifecycleSettings.schedule.dueNow &&
    scheduleBlockedBy.length === 0 &&
    operationalHealth.status !== "failed";
  const canAutoMerge =
    lifecycleSettings.autoMerge.enabled &&
    lifecycleSettings.enabled &&
    lifecycleSettings.validation.status === "valid" &&
    lifecycleSettings.allowManualMerge &&
    externalHandoff.commitEnvelope.canCommit &&
    (!lifecycleSettings.autoMerge.requiresNoWarnings || operationalHealth.failureState.warningCount === 0);
  const primaryLifecycleAction =
    lifecycleSettings.enabled === false
      ? "enable_pack"
      : lifecycleSettings.validation.status === "invalid"
        ? "configure_lifecycle"
        : canAutoMerge
          ? "merge"
          : canRunScheduledSync
            ? "run_scheduled_sync"
            : lifecycleSettings.schedule.paused
              ? "wait_for_schedule"
              : readiness.canMerge
                ? "merge"
                : "continue_review";
  return {
    schemaVersion: "memory-pack-lifecycle-control-state.v1",
    generatedAt: now,
    lifecycleStatus: lifecycleSettings.status,
    primaryLifecycleAction,
    canEnable: lifecycleSettings.enabled === false,
    canDisable: lifecycleSettings.enabled && lifecycleSettings.allowDisable,
    canConfigure: true,
    canRunScheduledSync,
    canAutoMerge,
    scheduleGate: {
      enabled: lifecycleSettings.schedule.enabled,
      syncMode: lifecycleSettings.schedule.syncMode,
      dueNow: lifecycleSettings.schedule.dueNow,
      paused: lifecycleSettings.schedule.paused,
      nextRunAt: lifecycleSettings.schedule.nextRunAt,
      pausedUntil: lifecycleSettings.schedule.pausedUntil,
      blockedBy: scheduleBlockedBy
    },
    commandTemplates: {
      enable: {
        action: "enable_pack",
        enabled: lifecycleSettings.enabled === false,
        targetIds: []
      },
      disable: {
        action: "disable_pack",
        enabled: lifecycleSettings.enabled && lifecycleSettings.allowDisable,
        targetIds: []
      },
      scheduledSync: {
        action: "run_scheduled_sync",
        enabled: canRunScheduledSync,
        targetIds: acceptance.acceptedIds,
        blockedBy: scheduleBlockedBy
      },
      autoMerge: {
        action: "merge",
        enabled: canAutoMerge,
        targetIds: acceptance.acceptedIds,
        blockedBy: canAutoMerge ? [] : readiness.blockers.concat(operationalHealth.failureState.codes)
      }
    }
  };
}

function normalizeClientRequest(input = {}, pack = {}) {
  const raw = input.clientRequest || input.request || input.client || pack.clientRequest || pack.request || {};
  return {
    requestId: asNonEmptyString(raw.requestId || raw.id || input.requestId, `${surfaceName}:request`),
    sessionId: asNonEmptyString(raw.sessionId || raw.clientSessionId || input.sessionId),
    actorId: asNonEmptyString(raw.actorId || raw.reviewer || input.actorId || input.reviewer, "unassigned"),
    entrypoint: asNonEmptyString(raw.entrypoint || raw.surface || input.entrypoint, "memory_pack_review"),
    requestedAction: asNonEmptyString(raw.requestedAction || raw.action || input.requestedAction, "preview"),
    returnUrl: asNonEmptyString(raw.returnUrl || raw.workflowReturnUrl || raw.redirectUri),
    clientCapabilities: uniqueStrings(raw.capabilities || raw.clientCapabilities || input.clientCapabilities),
    visibleMemoryIds: uniqueStrings(raw.visibleMemoryIds || raw.selectedMemoryIds || input.visibleMemoryIds),
    pinnedMemoryIds: uniqueStrings(raw.pinnedMemoryIds || input.pinnedMemoryIds),
    lastKnownStateId: asNonEmptyString(raw.lastKnownStateId || raw.stateId),
    lastKnownRestartToken: asNonEmptyString(raw.lastKnownRestartToken || raw.restartToken),
    optimisticCommandIds: uniqueStrings(raw.optimisticCommandIds || raw.pendingCommandIds)
  };
}

function clientPanelForState(readiness, reviewQueue, operationalHealth, externalHandoff) {
  if (operationalHealth.status === "failed") return "hosted_kernel_recovery";
  if (externalHandoff.status === "ready_for_external_commit") return "commit_handoff";
  if (reviewQueue.blockedCount > 0 || readiness.blockers.length > 0) return "resolve_review_blockers";
  if (reviewQueue.pendingCount > 0) return "review_queue";
  return "review_summary";
}

function primaryClientAction({ readiness, reviewQueue, operationalHealth, externalHandoff, nextSteps }) {
  if (operationalHealth.retryPolicy.shouldRetry) return "retry_hosted_kernel_route";
  if (externalHandoff.commitEnvelope.canCommit) return "commit_to_hosted_kernel";
  if (reviewQueue.bulkActions.changeRequiredIds.length > 0) return "request_changes";
  if (reviewQueue.bulkActions.acceptableIds.length > 0) return "accept_visible_ready_memories";
  return nextSteps[0]?.action || (readiness.canMerge ? "merge" : "continue_review");
}

function commandTargetIdsForClientAction(action, visibleMemoryIds, reviewQueue, acceptance, nextSteps) {
  if (action === "accept_visible_ready_memories") {
    return reviewQueue.bulkActions.acceptableIds.filter((id) => visibleMemoryIds.includes(id));
  }
  if (action === "request_changes") {
    return reviewQueue.bulkActions.changeRequiredIds.filter((id) => visibleMemoryIds.includes(id));
  }
  if (action === "commit_to_hosted_kernel" || action === "merge") {
    return acceptance.acceptedIds;
  }
  const matchingStep = nextSteps.find((step) => step.action === action);
  return matchingStep?.targetIds || [];
}

function hostedKernelCommandAction(action) {
  if (action === "accept_visible_ready_memories") return "accept";
  if (action === "commit_to_hosted_kernel") return "merge";
  if (action === "retry_hosted_kernel_route") return "retry";
  if (ALLOWED_ACTIONS.has(action)) return action;
  return "continue_review";
}

function buildClientCommandEnvelope({
  request,
  primaryAction,
  primaryActionEnabled,
  disabledReason,
  visibleMemoryIds,
  pinnedMemoryIds,
  unknownVisibleMemoryIds,
  reviewQueue,
  acceptance,
  externalHandoff,
  operationalHealth,
  capabilityNegotiation,
  boundaryProof,
  boundaryExecutionLease,
  nextSteps,
  now
}) {
  const action = hostedKernelCommandAction(primaryAction);
  const targetIds = uniqueStrings(
    commandTargetIdsForClientAction(primaryAction, visibleMemoryIds, reviewQueue, acceptance, nextSteps).concat(pinnedMemoryIds)
  );
  const staleClientState =
    Boolean(request.lastKnownRestartToken) && request.lastKnownRestartToken !== externalHandoff.commitEnvelope.restartToken;
  const targetBoundaryBlockedIds = targetIds.filter((id) => (boundaryProof?.outOfBoundaryMemoryIds || []).includes(id));
  const actionAllowed =
    action === "retry" || roleAllowsAction(boundaryProof?.roles || [], boundaryProof?.permissions || [], action);
  const routeBlockedBy = uniqueStrings(
    []
      .concat(primaryActionEnabled ? [] : [disabledReason || "primary_action_disabled"])
      .concat(staleClientState ? ["client_state_stale"] : [])
      .concat(unknownVisibleMemoryIds.length > 0 ? ["client_visible_ids_unknown"] : [])
      .concat(actionAllowed ? [] : [`permission_required:${action}`])
      .concat(targetBoundaryBlockedIds.length > 0 ? ["target_out_of_workspace_scope"] : [])
      .concat(boundaryExecutionLease?.status === "active" || action === "retry" ? [] : ["boundary_execution_lease_blocked"])
      .concat(capabilityNegotiation.status === "blocked" ? capabilityNegotiation.blockers : [])
      .concat(operationalHealth.status === "failed" && primaryAction !== "retry_hosted_kernel_route" ? operationalHealth.failureState.codes : [])
  );
  const commandIdSeed = [
    request.requestId,
    request.sessionId || "no-session",
    action,
    targetIds.join(",") || "no-targets",
    externalHandoff.commitEnvelope.restartToken
  ].join(":");
  return {
    schemaVersion: "memory-pack-client-command-envelope.v1",
    generatedAt: now,
    requestId: request.requestId,
    actorId: request.actorId,
    submitRoute: externalHandoff.providerId
      ? `hosted-kernel.memory-pack.${externalHandoff.providerId}.commands`
      : "hosted-kernel.memory-pack.commands",
    handoffId: externalHandoff.handoffId,
    providerId: externalHandoff.providerId,
    idempotencyKey: `memory-pack:${commandIdSeed}`,
    expectedState: {
      stateId: externalHandoff.externalStateId,
      restartToken: externalHandoff.commitEnvelope.restartToken,
      clientLastKnownRestartToken: request.lastKnownRestartToken || null,
      staleClientState,
      boundaryLeaseId: boundaryExecutionLease?.leaseId || null,
      boundaryLeaseStatus: boundaryExecutionLease?.status || "missing"
    },
    command: {
      commandId: request.optimisticCommandIds[0] || `client:${commandIdSeed}`,
      action,
      requestedAction: primaryAction,
      targetIds,
      tenantId: boundaryProof?.tenantId || null,
      workspaceId: boundaryProof?.workspaceId || null,
      boundaryLeaseId: boundaryExecutionLease?.leaseId || null,
      createdAt: now,
      actorId: request.actorId,
      enabled: routeBlockedBy.length === 0 || action === "retry",
      blockedBy: routeBlockedBy
    },
    conflictPolicy: {
      onStaleRestartToken: staleClientState ? "refresh_before_apply" : "apply_if_match",
      onUnknownTargets: unknownVisibleMemoryIds.length > 0 ? "drop_unknown_targets_and_refresh" : "apply_known_targets",
      onBoundaryViolation: targetBoundaryBlockedIds.length > 0 ? "reject_and_refetch_workspace_scope" : "apply_scoped_targets",
      onBoundaryLeaseBlocked:
        boundaryExecutionLease?.status === "active" ? "apply_scoped_targets" : "quarantine_and_request_boundary_handoff",
      onDuplicateCommand: "return_existing_result"
    },
    optimisticStatePatch: {
      acceptedIds: action === "accept" ? uniqueStrings(acceptance.acceptedIds.concat(targetIds)) : acceptance.acceptedIds,
      rejectedIds: action === "reject" ? uniqueStrings(acceptance.rejectedIds.concat(targetIds)) : acceptance.rejectedIds,
      changeRequestedIds:
        action === "request_changes" ? uniqueStrings(acceptance.changeRequestedIds.concat(targetIds)) : acceptance.changeRequestedIds,
      pendingIds:
        action === "accept" || action === "reject" || action === "request_changes"
          ? acceptance.pendingIds.filter((id) => !targetIds.includes(id))
          : acceptance.pendingIds
    }
  };
}

function buildPreviewAcceptancePanel({
  request,
  memories,
  visibleMemoryIds,
  reviewQueue,
  acceptance,
  readiness,
  validationSummary,
  sourceLineageProof,
  providerServiceContract,
  externalHandoff,
  nextSteps,
  primaryAction,
  primaryActionEnabled,
  disabledReason,
  now
}) {
  const memoryById = new Map(memories.map((memory) => [memory.memoryId, memory]));
  const queueById = new Map(reviewQueue.items.map((item) => [item.memoryId, item]));
  const proofById = new Map(sourceLineageProof.evidenceByMemory.map((proof) => [proof.memoryId, proof]));
  const nextStepByMemory = new Map();
  nextSteps.forEach((step) => {
    step.targetIds.forEach((memoryId) => {
      const steps = nextStepByMemory.get(memoryId) || [];
      steps.push({ action: step.action, reason: step.reason });
      nextStepByMemory.set(memoryId, steps);
    });
  });
  const visibleRows = visibleMemoryIds.map((memoryId, index) => {
    const memory = memoryById.get(memoryId);
    const queueItem = queueById.get(memoryId);
    const proof = proofById.get(memoryId) || {};
    const decision = queueItem?.decision || reviewDecisionForMemory(memoryId, acceptance);
    const proofIssues = proof.issues || [];
    const blockingIssues = uniqueStrings((queueItem?.blockingIssues || []).concat(proofIssues));
    const missingRequiredFields = memory?.missingFields || [];
    const canAccept = decision !== "accepted" && blockingIssues.length === 0;
    const canRequestChanges = decision !== "changes_requested" && blockingIssues.length > 0;
    return {
      row: index + 1,
      memoryId,
      title: memory?.title || queueItem?.title || "Unknown memory",
      decision,
      acceptanceState: canAccept ? "ready_to_accept" : canRequestChanges ? "needs_changes" : decision,
      sourceUri: memory?.source || queueItem?.sourceUri || null,
      sourceRequired: missingRequiredFields.includes("source"),
      summaryRequired: missingRequiredFields.includes("summary"),
      sourceBacked: proof.sourceBacked === true,
      linkedEvidenceIds: proof.linkedEvidenceIds || [],
      proofHashCount: (proof.proofHashes || []).length,
      blockingIssues,
      enabledActions: uniqueStrings(queueItem?.enabledActions || []).filter((action) => action !== "merge"),
      nextSteps: nextStepByMemory.get(memoryId) || []
    };
  });
  const mergeOperation = providerServiceContract.operations.find((operation) => operation.operation === "merge");
  const auditOperation = providerServiceContract.operations.find((operation) => operation.operation === "audit_proof");
  const visibleReadyIds = visibleRows.filter((row) => row.acceptanceState === "ready_to_accept").map((row) => row.memoryId);
  const visibleNeedsChangesIds = visibleRows.filter((row) => row.acceptanceState === "needs_changes").map((row) => row.memoryId);
  const visibleAcceptedIds = visibleRows.filter((row) => row.decision === "accepted").map((row) => row.memoryId);
  const visibleUnprovenAcceptedIds = visibleRows
    .filter((row) => row.decision === "accepted" && !row.sourceBacked)
    .map((row) => row.memoryId);
  const readinessBlockersByCode = readiness.blockers.map((code) => ({
    code,
    visibleTargetIds:
      code === "memory_validation_blockers"
        ? uniqueStrings(validationSummary.missingSourceIds.concat(validationSummary.missingSummaryIds)).filter((id) =>
            visibleMemoryIds.includes(id)
          )
        : code === "accepted_memory_evidence_unlinked"
          ? sourceLineageProof.acceptedUnprovenIds.filter((id) => visibleMemoryIds.includes(id))
          : []
  }));
  return {
    schemaVersion: "memory-pack-preview-acceptance-panel.v1",
    generatedAt: now,
    requestId: request.requestId,
    sessionId: request.sessionId || null,
    status:
      readiness.canMerge && externalHandoff.commitEnvelope.canCommit
        ? "ready_for_commit"
        : visibleNeedsChangesIds.length > 0
          ? "visible_changes_required"
          : visibleReadyIds.length > 0
            ? "visible_acceptance_ready"
            : acceptance.pendingIds.length > 0
              ? "review_pending"
              : "review_complete",
    primaryAction: {
      action: primaryAction,
      enabled: primaryActionEnabled,
      disabledReason: disabledReason || null,
      targetIds:
        primaryAction === "accept_visible_ready_memories"
          ? visibleReadyIds
          : primaryAction === "request_changes"
            ? visibleNeedsChangesIds
            : primaryAction === "commit_to_hosted_kernel" || primaryAction === "merge"
              ? acceptance.acceptedIds
              : []
    },
    visibleSummary: {
      visibleCount: visibleRows.length,
      readyToAcceptCount: visibleReadyIds.length,
      changesRequiredCount: visibleNeedsChangesIds.length,
      acceptedCount: visibleAcceptedIds.length,
      unprovenAcceptedCount: visibleUnprovenAcceptedIds.length,
      sourceCoverage: validationSummary.sourceCoverage,
      proofCoverage: validationSummary.proofCoverage
    },
    acceptanceGate: {
      decision: acceptance.decision,
      acceptedIds: acceptance.acceptedIds,
      rejectedIds: acceptance.rejectedIds,
      changeRequestedIds: acceptance.changeRequestedIds,
      pendingIds: acceptance.pendingIds,
      visibleReadyIds,
      visibleNeedsChangesIds,
      visibleUnprovenAcceptedIds
    },
    proofGate: {
      lineageStatus: sourceLineageProof.status,
      acceptedMemoryCount: sourceLineageProof.acceptedMemoryCount,
      sourceBackedAcceptedCount: sourceLineageProof.sourceBackedAcceptedCount,
      hashedAcceptedProofCount: sourceLineageProof.hashedAcceptedProofCount,
      acceptedUnprovenIds: sourceLineageProof.acceptedUnprovenIds,
      auditProofRoute: auditOperation?.route || null,
      auditProofEnabled: auditOperation?.enabled === true
    },
    mergeGate: {
      readinessStatus: readiness.status,
      canMerge: readiness.canMerge,
      handoffStatus: externalHandoff.status,
      commitAllowed: externalHandoff.commitEnvelope.canCommit,
      mergeRoute: mergeOperation?.route || null,
      mergeEnabled: mergeOperation?.enabled === true,
      blockers: readinessBlockersByCode
    },
    rows: visibleRows
  };
}

function buildClientWorkflowHandoff({
  input,
  pack,
  memories,
  acceptance,
  reviewQueue,
  readiness,
  validationSummary,
  sourceLineageProof,
  operationalHealth,
  capabilityNegotiation,
  providerServiceContract,
  externalHandoff,
  lifecycleControlState,
  boundaryProof,
  boundaryExecutionLease,
  nextSteps,
  now
}) {
  const request = normalizeClientRequest(input, pack);
  const knownIds = new Set(memories.map((memory) => memory.memoryId));
  const visibleMemoryIds = request.visibleMemoryIds.length > 0 ? request.visibleMemoryIds.filter((id) => knownIds.has(id)) : reviewQueue.items
    .filter((item) => item.visibleInPreview)
    .map((item) => item.memoryId);
  const unknownVisibleMemoryIds = request.visibleMemoryIds.filter((id) => !knownIds.has(id));
  const pinnedMemoryIds = request.pinnedMemoryIds.filter((id) => knownIds.has(id));
  const currentPanel = clientPanelForState(readiness, reviewQueue, operationalHealth, externalHandoff);
  const workflowPrimaryAction = primaryClientAction({ readiness, reviewQueue, operationalHealth, externalHandoff, nextSteps });
  const primaryAction =
    lifecycleControlState.primaryLifecycleAction === "enable_pack" ||
    lifecycleControlState.primaryLifecycleAction === "configure_lifecycle" ||
    lifecycleControlState.primaryLifecycleAction === "run_scheduled_sync"
      ? lifecycleControlState.primaryLifecycleAction
      : workflowPrimaryAction;
  const blockingCodes = uniqueStrings(
    readiness.blockers.concat(operationalHealth.failureState.codes).concat(capabilityNegotiation.blockers).concat(boundaryProof?.blockers || [])
  );
  const disabledReason = (() => {
    if ((boundaryProof?.blockers || []).length > 0) return boundaryProof.blockers[0];
    if (operationalHealth.status === "failed") return "hosted_kernel_failed";
    if (lifecycleControlState.lifecycleStatus === "disabled" && primaryAction !== "enable_pack") return "memory_pack_disabled";
    if (lifecycleControlState.scheduleGate.blockedBy.length > 0 && primaryAction === "run_scheduled_sync") {
      return lifecycleControlState.scheduleGate.blockedBy[0];
    }
    if (capabilityNegotiation.status === "blocked") return "provider_capability_blocked";
    if (readiness.canMerge || reviewQueue.readyToAcceptCount > 0 || primaryAction === "configure_lifecycle") return "";
    return blockingCodes[0] || "review_pending";
  })();
  const primaryActionEnabled =
    !disabledReason ||
    primaryAction === "retry_hosted_kernel_route" ||
    primaryAction === "enable_pack" ||
    primaryAction === "configure_lifecycle";
  const clientCommandEnvelope = buildClientCommandEnvelope({
    request,
    primaryAction,
    primaryActionEnabled,
    disabledReason,
    visibleMemoryIds,
    pinnedMemoryIds,
    unknownVisibleMemoryIds,
    reviewQueue,
    acceptance,
    externalHandoff,
    operationalHealth,
    capabilityNegotiation,
    boundaryProof,
    boundaryExecutionLease,
    nextSteps,
    now
  });
  const previewAcceptancePanel = buildPreviewAcceptancePanel({
    request,
    memories,
    visibleMemoryIds,
    reviewQueue,
    acceptance,
    readiness,
    validationSummary,
    sourceLineageProof,
    providerServiceContract,
    externalHandoff,
    nextSteps,
    primaryAction,
    primaryActionEnabled,
    disabledReason,
    now
  });
  return {
    schemaVersion: "memory-pack-client-workflow.v1",
    generatedAt: now,
    request,
    stateBinding: {
      stateId: externalHandoff.externalStateId,
      restartToken: externalHandoff.commitEnvelope.restartToken,
      lastKnownStateId: request.lastKnownStateId || null,
      lastKnownRestartToken: request.lastKnownRestartToken || null,
      staleClientState:
        Boolean(request.lastKnownRestartToken) && request.lastKnownRestartToken !== externalHandoff.commitEnvelope.restartToken
    },
    workflow: {
      currentPanel,
      focusMemoryId: reviewQueue.focusMemoryId,
      visibleMemoryIds,
      pinnedMemoryIds,
      unknownVisibleMemoryIds,
      primaryAction,
      primaryActionEnabled,
      disabledReason: disabledReason || null,
      lifecyclePrimaryAction: lifecycleControlState.primaryLifecycleAction,
      banner:
        operationalHealth.status === "failed"
          ? "hosted_kernel_unavailable"
          : lifecycleControlState.lifecycleStatus === "disabled"
            ? "memory_pack_disabled"
          : externalHandoff.commitEnvelope.canCommit
            ? "ready_for_commit"
            : reviewQueue.blockedCount > 0
              ? "review_needs_input"
              : reviewQueue.pendingCount > 0
                ? "review_pending"
                : "review_synced"
    },
    commandDrafts: {
      acceptVisibleReady: reviewQueue.bulkActions.acceptableIds.filter((id) => visibleMemoryIds.includes(id)),
      requestChangesVisible: reviewQueue.bulkActions.changeRequiredIds.filter((id) => visibleMemoryIds.includes(id)),
      retryableActions: operationalHealth.retryPolicy.retryableCodes,
      lifecycleActions: lifecycleControlState.commandTemplates,
      optimisticCommandIds: request.optimisticCommandIds
    },
    handoff: {
      providerId: externalHandoff.providerId,
      handoffId: externalHandoff.handoffId,
      status: externalHandoff.status,
      returnUrl: request.returnUrl || null,
      commitAllowed: externalHandoff.commitEnvelope.canCommit,
      syncDirty: externalHandoff.syncMetadata.dirty,
      nextSyncReason: externalHandoff.syncMetadata.nextSyncReason
    },
    previewAcceptancePanel,
    lifecycleControls: lifecycleControlState,
    boundary: {
      schemaVersion: boundaryProof?.schemaVersion || "memory-pack-boundary-proof.v1",
      tenantId: boundaryProof?.tenantId || null,
      workspaceId: boundaryProof?.workspaceId || null,
      actorId: boundaryProof?.actorId || request.actorId,
      scopedMemoryCount: boundaryProof?.scopedMemoryCount || 0,
      blockedCommandCount: boundaryProof?.blockedCommandCount || 0,
      outOfBoundaryMemoryIds: boundaryProof?.outOfBoundaryMemoryIds || [],
      executionLeaseId: boundaryExecutionLease?.leaseId || null,
      executionLeaseStatus: boundaryExecutionLease?.status || "missing",
      blockers: boundaryProof?.blockers || []
    },
    clientCommandEnvelope,
    clientStatePatch: {
      reviewQueueStatus: reviewQueue.status,
      readinessStatus: readiness.status,
      healthStatus: operationalHealth.status,
      selectedProviderId: capabilityNegotiation.selectedProviderId,
      acceptedIds: acceptance.acceptedIds,
      rejectedIds: acceptance.rejectedIds,
      changeRequestedIds: acceptance.changeRequestedIds,
      pendingIds: acceptance.pendingIds,
      previewAcceptanceStatus: previewAcceptancePanel.status,
      visibleReadyToAcceptIds: previewAcceptancePanel.acceptanceGate.visibleReadyIds,
      visibleChangesRequiredIds: previewAcceptancePanel.acceptanceGate.visibleNeedsChangesIds,
      visibleUnprovenAcceptedIds: previewAcceptancePanel.acceptanceGate.visibleUnprovenAcceptedIds,
      blockerCodes: blockingCodes
    }
  };
}

function buildActionableError(code, severity, message, retryable, action, targetIds = [], detail = {}) {
  return {
    code,
    severity,
    message,
    retryable,
    action,
    targetIds: uniqueStrings(targetIds),
    detail
  };
}

function retryDelayMs(attempt) {
  const safeAttempt = Math.min(boundedInteger(attempt), 6);
  return Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** safeAttempt);
}

function buildRetryPolicy(actionableErrors, hostedKernelHealth, routeGuard = null) {
  const retryableErrors = actionableErrors.filter((error) => error.retryable);
  const terminalErrors = actionableErrors.filter((error) => !error.retryable && error.severity === "critical");
  const retryBudgetExhausted = hostedKernelHealth.retryBudget.remainingAttempts === 0;
  const circuitOpen = routeGuard?.circuitBreaker.active ?? hostedKernelHealth.circuitBreaker.open;
  const shouldRetry = retryableErrors.length > 0 && terminalErrors.length === 0 && !retryBudgetExhausted && !circuitOpen;
  const attempt = hostedKernelHealth.retryAttempt;
  const backoffDelayMs = hostedKernelHealth.retryAfterMs || retryDelayMs(attempt);
  return {
    strategy: shouldRetry ? "exponential_backoff_with_operator_action" : "none",
    shouldRetry,
    attempt,
    remainingAttempts: hostedKernelHealth.retryBudget.remainingAttempts,
    budgetWindowMs: hostedKernelHealth.retryBudget.windowMs,
    retryBudgetResetAt: hostedKernelHealth.retryBudget.resetAt || null,
    circuitOpen,
    circuitOpenUntil: hostedKernelHealth.circuitBreaker.openUntil || null,
    nextDelayMs: shouldRetry ? backoffDelayMs : 0,
    maxDelayMs: MAX_RETRY_DELAY_MS,
    retryableCodes: retryableErrors.map((error) => error.code),
    terminalCodes: terminalErrors.map((error) => error.code)
  };
}

function remediationOwnerForError(error) {
  if (error.code.startsWith("memory_") || error.code === "review_incomplete") return "reviewer";
  if (error.code.includes("evidence") || error.code === "audit_evidence_missing") return "librarian";
  if (error.code.includes("provider") || error.code.includes("kernel") || error.code === "circuit_breaker_open") return "hosted_kernel";
  if (error.code.includes("boundary") || error.code === "retry_budget_exhausted") return "operator";
  if (error.code.includes("command") || error.code.includes("state_")) return "client";
  return "operator";
}

function buildOperationalRepairPlan({ actionableErrors, retryPolicy, routeGuard, readiness, recovery, hostedKernelHealth }) {
  const errorsByCode = new Map(actionableErrors.map((error) => [error.code, error]));
  const repairItems = actionableErrors.map((error, index) => {
    const blockedByRetryBudget = error.retryable && retryPolicy.remainingAttempts === 0;
    const blockedByCircuit = error.retryable && retryPolicy.circuitOpen;
    const canRunNow = !blockedByRetryBudget && !blockedByCircuit && error.severity !== "critical";
    return {
      repairId: `repair:${index + 1}:${error.code}`,
      code: error.code,
      owner: remediationOwnerForError(error),
      action: error.action,
      priority:
        error.severity === "critical"
          ? "p0"
          : error.severity === "error"
            ? "p1"
            : retryPolicy.retryableCodes.includes(error.code)
              ? "p2"
              : "p3",
      canRunNow,
      blockedBy: uniqueStrings(
        []
          .concat(blockedByRetryBudget ? ["retry_budget_exhausted"] : [])
          .concat(blockedByCircuit ? ["circuit_breaker_open"] : [])
          .concat(error.severity === "critical" ? ["critical_failure_requires_operator"] : [])
      ),
      retryable: error.retryable,
      targetIds: error.targetIds,
      evidenceRequired:
        error.code === "audit_evidence_missing" ||
        error.code === "accepted_memory_evidence_unlinked" ||
        error.code === "memory_validation_blockers",
      message: error.message
    };
  });
  const ownerQueues = ["reviewer", "librarian", "hosted_kernel", "client", "operator"].map((owner) => ({
    owner,
    openCount: repairItems.filter((item) => item.owner === owner).length,
    readyCount: repairItems.filter((item) => item.owner === owner && item.canRunNow).length,
    blockedCount: repairItems.filter((item) => item.owner === owner && !item.canRunNow).length,
    actions: uniqueStrings(repairItems.filter((item) => item.owner === owner).map((item) => item.action))
  }));
  const degradedReadPolicy = {
    previewFromPersistedState: recovery.restartSafe && recovery.durableReview.pendingCount >= 0,
    allowSourceOpen: !errorsByCode.has("memory_scope_out_of_boundary"),
    allowReviewDecisions:
      !errorsByCode.has("memory_scope_out_of_boundary") &&
      !errorsByCode.has("command_blocked_by_boundary") &&
      !errorsByCode.has("commands_rejected"),
    allowHostedKernelCommit:
      readiness.canMerge &&
      routeGuard.routeAllowed &&
      !errorsByCode.has("retry_budget_exhausted") &&
      !errorsByCode.has("provider_endpoint_missing"),
    staleProviderSyncAccepted: routeGuard.degradedSyncAllowed && errorsByCode.has("stale_provider_sync")
  };
  const nextOperatorAction =
    repairItems.find((item) => item.canRunNow && item.priority === "p0") ||
    repairItems.find((item) => item.canRunNow && item.priority === "p1") ||
    repairItems.find((item) => item.canRunNow) ||
    repairItems[0] ||
    null;
  return {
    schemaVersion: "memory-pack-operational-repair-plan.v1",
    status: repairItems.length === 0 ? "clear" : nextOperatorAction?.canRunNow ? "action_required" : "blocked",
    nextOperatorAction: nextOperatorAction
      ? {
          repairId: nextOperatorAction.repairId,
          owner: nextOperatorAction.owner,
          action: nextOperatorAction.action,
          code: nextOperatorAction.code,
          canRunNow: nextOperatorAction.canRunNow,
          blockedBy: nextOperatorAction.blockedBy
        }
      : null,
    retryGate: {
      shouldRetry: retryPolicy.shouldRetry,
      nextDelayMs: retryPolicy.nextDelayMs,
      retryableCodes: retryPolicy.retryableCodes,
      blockedByCircuit: retryPolicy.circuitOpen,
      blockedByBudget: retryPolicy.remainingAttempts === 0,
      hostedKernelMode: hostedKernelHealth.mode
    },
    degradedReadPolicy,
    ownerQueues,
    repairItems
  };
}

function providerSyncAge(provider, now) {
  return millisecondsSince(provider.syncMetadata.lastSyncedAt, now);
}

function buildRouteGuard(providerContracts, hostedKernelHealth, now) {
  const circuitResetInMs = millisecondsUntil(hostedKernelHealth.circuitBreaker.openUntil, now);
  const circuitOpenActive =
    hostedKernelHealth.circuitBreaker.open && (!hostedKernelHealth.circuitBreaker.openUntil || circuitResetInMs > 0);
  const providersMissingEndpoint = providerContracts
    .filter((provider) => !provider.endpointRef)
    .map((provider) => provider.providerId);
  const staleProviderSync = providerContracts
    .map((provider) => ({
      providerId: provider.providerId,
      ageMs: providerSyncAge(provider, now),
      staleAfterMs: DEFAULT_SYNC_STALE_AFTER_MS,
      cursor: provider.syncMetadata.cursor
    }))
    .filter((entry) => entry.ageMs !== null && entry.ageMs > entry.staleAfterMs);
  const routeAllowed =
    hostedKernelHealth.online &&
    providersMissingEndpoint.length === 0 &&
    !circuitOpenActive;
  return {
    schemaVersion: "memory-pack-route-guard.v1",
    routeAllowed,
    routeTraceId: hostedKernelHealth.routeTraceId || null,
    circuitBreaker: {
      open: hostedKernelHealth.circuitBreaker.open,
      active: circuitOpenActive,
      openUntil: hostedKernelHealth.circuitBreaker.openUntil || null,
      resetInMs: circuitResetInMs,
      reason: hostedKernelHealth.circuitBreaker.reason || null
    },
    retryBudget: hostedKernelHealth.retryBudget,
    providersMissingEndpoint,
    staleProviderSync,
    degradedSyncAllowed: staleProviderSync.length > 0 && providersMissingEndpoint.length === 0
  };
}

function buildProviderContractDiagnostics(providerContracts, readiness, recovery) {
  const requiredCapabilities = REQUIRED_PROVIDER_CAPABILITIES.concat(readiness.canMerge ? [MERGE_PROVIDER_CAPABILITY] : []);
  const providerIdCounts = providerContracts.reduce((counts, provider) => {
    counts.set(provider.providerId, (counts.get(provider.providerId) || 0) + 1);
    return counts;
  }, new Map());
  const duplicateProviderIds = [...providerIdCounts.entries()].filter(([, count]) => count > 1).map(([providerId]) => providerId);
  const providerReports = providerContracts.map((provider) => {
    const missingRequiredCapabilities = requiredCapabilities.filter((capability) => !provider.capabilities.includes(capability));
    const missingBaseCapabilities = REQUIRED_PROVIDER_CAPABILITIES.filter((capability) => !provider.capabilities.includes(capability));
    const syncCursorMissing = !provider.syncMetadata.cursor;
    const dirtyWithoutCursor = provider.syncMetadata.dirty && syncCursorMissing;
    const handoffUnbound = readiness.canMerge && !provider.handoffState.externalStateId;
    const status =
      missingRequiredCapabilities.length > 0 || dirtyWithoutCursor || handoffUnbound
        ? "invalid"
        : syncCursorMissing
          ? "needs_checkpoint"
          : "valid";
    return {
      providerId: provider.providerId,
      status,
      requiredCapabilities,
      missingRequiredCapabilities,
      missingBaseCapabilities,
      duplicateProviderId: duplicateProviderIds.includes(provider.providerId),
      endpointBound: Boolean(provider.endpointRef),
      syncCursorMissing,
      dirtyWithoutCursor,
      handoffUnbound,
      handoffStatus: provider.handoffState.status,
      repairActions: uniqueStrings(
        []
          .concat(missingRequiredCapabilities.length > 0 ? ["upgrade_provider_capabilities"] : [])
          .concat(syncCursorMissing ? ["checkpoint_provider_sync"] : [])
          .concat(dirtyWithoutCursor ? ["repair_sync_cursor"] : [])
          .concat(handoffUnbound ? ["bind_external_handoff_state"] : [])
      )
    };
  });
  const capabilityGaps = providerReports
    .filter((report) => report.missingRequiredCapabilities.length > 0)
    .map((report) => ({
      providerId: report.providerId,
      missingRequiredCapabilities: report.missingRequiredCapabilities
    }));
  const syncCursorMissingProviderIds = providerReports.filter((report) => report.syncCursorMissing).map((report) => report.providerId);
  const dirtyWithoutCursorProviderIds = providerReports.filter((report) => report.dirtyWithoutCursor).map((report) => report.providerId);
  const handoffUnboundProviderIds = providerReports.filter((report) => report.handoffUnbound).map((report) => report.providerId);
  return {
    schemaVersion: "memory-pack-provider-contract-diagnostics.v1",
    status:
      providerReports.length === 0
        ? "missing"
        : capabilityGaps.length > 0 || dirtyWithoutCursorProviderIds.length > 0 || handoffUnboundProviderIds.length > 0
          ? "invalid"
          : syncCursorMissingProviderIds.length > 0 || duplicateProviderIds.length > 0
            ? "degraded"
            : "valid",
    requiredCapabilities,
    providerCount: providerReports.length,
    supportedProviderCount: providerReports.filter((report) => report.missingRequiredCapabilities.length === 0).length,
    duplicateProviderIds,
    capabilityGaps,
    syncCursorMissingProviderIds,
    dirtyWithoutCursorProviderIds,
    handoffUnboundProviderIds,
    restartToken: recovery.restartToken,
    reports: providerReports
  };
}

function writeGuardForOperationalMode({ readiness, routeGuard, providerDiagnostics, retryPolicy, actionableErrors }) {
  const errorCodes = new Set(actionableErrors.map((error) => error.code));
  const capabilityBlocked = providerDiagnostics.capabilityGaps.length > 0;
  const syncCheckpointRequired =
    providerDiagnostics.syncCursorMissingProviderIds.length > 0 || providerDiagnostics.dirtyWithoutCursorProviderIds.length > 0;
  const commitBlockedBy = uniqueStrings(
    []
      .concat(readiness.canMerge ? [] : readiness.blockers)
      .concat(routeGuard.routeAllowed ? [] : ["hosted_kernel_route_blocked"])
      .concat(capabilityBlocked ? ["provider_capability_missing"] : [])
      .concat(providerDiagnostics.handoffUnboundProviderIds.length > 0 ? ["provider_handoff_unbound"] : [])
      .concat(retryPolicy.circuitOpen ? ["circuit_breaker_open"] : [])
      .concat(retryPolicy.remainingAttempts === 0 ? ["retry_budget_exhausted"] : [])
      .concat(errorCodes.has("memory_scope_out_of_boundary") ? ["memory_scope_out_of_boundary"] : [])
      .concat(errorCodes.has("command_blocked_by_boundary") ? ["command_blocked_by_boundary"] : [])
  );
  const replayBlockedBy = uniqueStrings(
    []
      .concat(errorCodes.has("commands_rejected") ? ["commands_rejected"] : [])
      .concat(errorCodes.has("command_blocked_by_boundary") ? ["command_blocked_by_boundary"] : [])
      .concat(errorCodes.has("memory_scope_out_of_boundary") ? ["memory_scope_out_of_boundary"] : [])
  );
  return {
    schemaVersion: "memory-pack-operational-write-guard.v1",
    mode: commitBlockedBy.length > 0 ? "read_only_or_checkpoint" : syncCheckpointRequired ? "checkpoint_before_commit" : "write_enabled",
    allowsPreview: !errorCodes.has("memory_pack_empty"),
    allowsSourceOpen: !errorCodes.has("memory_scope_out_of_boundary"),
    allowsReviewCommands: replayBlockedBy.length === 0,
    allowsStateReplay: replayBlockedBy.length === 0 && routeGuard.routeAllowed,
    allowsSyncCheckpoint: syncCheckpointRequired && routeGuard.routeAllowed && !retryPolicy.circuitOpen,
    allowsMerge: commitBlockedBy.length === 0,
    syncCheckpointRequired,
    blockedOperations: {
      reviewCommands: replayBlockedBy,
      stateReplay: routeGuard.routeAllowed ? replayBlockedBy : uniqueStrings(replayBlockedBy.concat("hosted_kernel_route_blocked")),
      syncCheckpoint: syncCheckpointRequired
        ? uniqueStrings(
            []
              .concat(routeGuard.routeAllowed ? [] : ["hosted_kernel_route_blocked"])
              .concat(retryPolicy.circuitOpen ? ["circuit_breaker_open"] : [])
          )
        : ["sync_checkpoint_not_required"],
      merge: commitBlockedBy
    },
    nextWritableAction:
      commitBlockedBy.length === 0
        ? "commit_memory_pack"
        : syncCheckpointRequired && routeGuard.routeAllowed
          ? "checkpoint_provider_sync"
          : retryPolicy.shouldRetry
            ? "retry_hosted_kernel_route"
            : "repair_operational_blockers"
  };
}

function buildOperationalHealth({
  memories,
  evidence,
  validationSummary,
  acceptance,
  readiness,
  recovery,
  sourceLineageProof,
  boundaryProof,
  commandResults,
  persistedState,
  hostedKernelHealth,
  providerContracts,
  lifecycleSettings,
  now
}) {
  const actionableErrors = [];
  const routeGuard = buildRouteGuard(providerContracts, hostedKernelHealth, now);
  const providerDiagnostics = buildProviderContractDiagnostics(providerContracts, readiness, recovery);
  if (memories.length === 0) {
    actionableErrors.push(
      buildActionableError(
        "memory_pack_empty",
        "critical",
        "Memory pack contains no memories for hosted-kernel review.",
        false,
        "supply_memories"
      )
    );
  }
  if (!hostedKernelHealth.online) {
    actionableErrors.push(
      buildActionableError(
        "hosted_kernel_unavailable",
        "critical",
        hostedKernelHealth.outageReason || "Hosted kernel is unavailable for memory-pack operations.",
        true,
        "retry_hosted_kernel_route",
        [],
        { mode: hostedKernelHealth.mode, lastError: hostedKernelHealth.lastError }
      )
    );
  }
  if (lifecycleSettings?.enabled === false) {
    actionableErrors.push(
      buildActionableError(
        "memory_pack_disabled",
        "error",
        "Lifecycle controls have disabled hosted-kernel memory-pack commands.",
        false,
        "enable_pack"
      )
    );
  }
  if (lifecycleSettings?.validation?.status === "invalid") {
    actionableErrors.push(
      buildActionableError(
        "lifecycle_settings_invalid",
        "error",
        "Lifecycle settings contain invalid review, proof, or scheduling controls.",
        false,
        "configure_lifecycle",
        [],
        {
          issueCodes: lifecycleSettings.validation.issueCodes,
          requestedReviewMode: lifecycleSettings.requestedReviewMode,
          requestedSyncMode: lifecycleSettings.schedule.requestedSyncMode
        }
      )
    );
  }
  if (routeGuard.providersMissingEndpoint.length > 0) {
    actionableErrors.push(
      buildActionableError(
        "provider_endpoint_missing",
        "error",
        "Hosted-kernel memory provider is missing an endpoint reference.",
        false,
        "configure_provider_endpoint",
        [],
        { providerIds: routeGuard.providersMissingEndpoint }
      )
    );
  }
  if (providerDiagnostics.capabilityGaps.length > 0) {
    actionableErrors.push(
      buildActionableError(
        "provider_capability_missing",
        "error",
        "Hosted-kernel memory provider does not satisfy required memory-pack capabilities.",
        false,
        "upgrade_provider_capabilities",
        [],
        {
          requiredCapabilities: providerDiagnostics.requiredCapabilities,
          capabilityGaps: providerDiagnostics.capabilityGaps
        }
      )
    );
  }
  if (providerDiagnostics.duplicateProviderIds.length > 0) {
    actionableErrors.push(
      buildActionableError(
        "provider_contract_duplicate",
        "warning",
        "Provider contract list contains duplicate provider identifiers.",
        false,
        "dedupe_provider_contracts",
        [],
        { providerIds: providerDiagnostics.duplicateProviderIds }
      )
    );
  }
  if (providerDiagnostics.dirtyWithoutCursorProviderIds.length > 0) {
    actionableErrors.push(
      buildActionableError(
        "provider_sync_cursor_missing",
        "error",
        "Dirty provider sync state is missing a cursor for hosted-kernel replay.",
        true,
        "checkpoint_provider_sync",
        [],
        { providerIds: providerDiagnostics.dirtyWithoutCursorProviderIds, restartToken: recovery.restartToken }
      )
    );
  }
  if (providerDiagnostics.handoffUnboundProviderIds.length > 0) {
    actionableErrors.push(
      buildActionableError(
        "provider_handoff_unbound",
        "error",
        "Commit-ready memory pack requires a bound external handoff state.",
        false,
        "bind_external_handoff_state",
        [],
        { providerIds: providerDiagnostics.handoffUnboundProviderIds, restartToken: recovery.restartToken }
      )
    );
  }
  if (routeGuard.circuitBreaker.active) {
    actionableErrors.push(
      buildActionableError(
        "circuit_breaker_open",
        "warning",
        "Hosted-kernel memory route is temporarily circuit-open.",
        true,
        "wait_for_circuit_reset",
        [],
        routeGuard.circuitBreaker
      )
    );
  }
  if (hostedKernelHealth.retryBudget.remainingAttempts === 0) {
    actionableErrors.push(
      buildActionableError(
        "retry_budget_exhausted",
        "critical",
        "Hosted-kernel retry budget is exhausted for this memory-pack route.",
        false,
        "operator_intervention",
        [],
        hostedKernelHealth.retryBudget
      )
    );
  }
  if (routeGuard.staleProviderSync.length > 0) {
    actionableErrors.push(
      buildActionableError(
        "stale_provider_sync",
        "warning",
        "Provider sync metadata is stale for the hosted-kernel memory route.",
        true,
        "refresh_provider_sync",
        [],
        { providers: routeGuard.staleProviderSync }
      )
    );
  }
  hostedKernelHealth.degradedReasons.forEach((reason) => {
    actionableErrors.push(
      buildActionableError("hosted_kernel_degraded", "warning", reason, false, "continue_in_degraded_mode", [], {
        mode: hostedKernelHealth.mode
      })
    );
  });
  if (validationSummary.blockingIssueCount > 0) {
    actionableErrors.push(
      buildActionableError(
        "memory_validation_blockers",
        "error",
        "Memory pack has required field gaps before merge.",
        true,
        "request_changes",
        validationSummary.missingSourceIds.concat(validationSummary.missingSummaryIds),
        { missingSourceIds: validationSummary.missingSourceIds, missingSummaryIds: validationSummary.missingSummaryIds }
      )
    );
  }
  if (acceptance.pendingIds.length > 0) {
    actionableErrors.push(
      buildActionableError("review_incomplete", "warning", "Memory review is still pending.", true, "complete_review", acceptance.pendingIds)
    );
  }
  if ((acceptance.decisionConflictCount || 0) > 0) {
    actionableErrors.push(
      buildActionableError(
        "persisted_review_conflict_resolved",
        "warning",
        "Persisted review state contained conflicting decisions that were resolved from command replay order.",
        true,
        "persist_review_state",
        uniqueStrings((acceptance.decisionConflicts || []).map((conflict) => conflict.memoryId)),
        {
          conflictCount: acceptance.decisionConflictCount,
          conflicts: acceptance.decisionConflicts,
          replayCheckpoint: recovery.replayCheckpoint
        }
      )
    );
  }
  if (evidence.length === 0) {
    actionableErrors.push(
      buildActionableError("audit_evidence_missing", "error", "Audit proof requires at least one evidence record.", true, "attach_evidence")
    );
  }
  if ((sourceLineageProof?.acceptedUnprovenIds || []).length > 0) {
    actionableErrors.push(
      buildActionableError(
        "accepted_memory_evidence_unlinked",
        "error",
        "Accepted memories must be linked to source evidence before hosted-kernel merge.",
        true,
        "link_evidence",
        sourceLineageProof.acceptedUnprovenIds,
        {
          sourceBackedAcceptedCount: sourceLineageProof.sourceBackedAcceptedCount,
          acceptedMemoryCount: sourceLineageProof.acceptedMemoryCount
        }
      )
    );
  }
  if ((boundaryProof?.outOfBoundaryMemoryIds || []).length > 0) {
    actionableErrors.push(
      buildActionableError(
        "memory_scope_out_of_boundary",
        "critical",
        "Memory pack contains memories outside the active tenant workspace boundary.",
        false,
        "remove_out_of_scope_memories",
        boundaryProof.outOfBoundaryMemoryIds,
        {
          tenantId: boundaryProof.tenantId,
          workspaceId: boundaryProof.workspaceId
        }
      )
    );
  }
  if ((boundaryProof?.blockedCommandCount || 0) > 0) {
    actionableErrors.push(
      buildActionableError(
        "command_blocked_by_boundary",
        "error",
        "One or more memory-pack commands were blocked by tenant, workspace, or role policy.",
        false,
        "correct_command_boundary",
        boundaryProof.commandResults.flatMap((result) => result.boundaryTargetIds),
        {
          actorId: boundaryProof.actorId,
          blockedCommandIds: boundaryProof.commandResults
            .filter((result) => result.status === "blocked_by_boundary")
            .map((result) => result.commandId),
          blockers: boundaryProof.blockers
        }
      )
    );
  }
  if (persistedState.restartToken === "uncommitted") {
    actionableErrors.push(
      buildActionableError(
        "state_restart_token_uncommitted",
        "warning",
        "Persisted state does not expose a durable restart token.",
        true,
        "persist_review_state",
        [],
        { stateId: persistedState.stateId }
      )
    );
  }
  const rejectedCommandResults = commandResults.filter((result) => result.status.startsWith("rejected"));
  if (rejectedCommandResults.length > 0) {
    actionableErrors.push(
      buildActionableError(
        "commands_rejected",
        "error",
        "One or more memory-pack commands were rejected.",
        false,
        "correct_commands",
        rejectedCommandResults.flatMap((result) => result.targetIds),
        { commandIds: rejectedCommandResults.map((result) => result.commandId) }
      )
    );
  }
  const unknownTargetResults = commandResults.filter((result) => result.unknownTargetIds.length > 0);
  if (unknownTargetResults.length > 0 || acceptance.unknownSubmittedIds.length > 0) {
    actionableErrors.push(
      buildActionableError(
        "command_targets_unknown",
        "warning",
        "Submitted review state references memory ids that are not present in the pack.",
        true,
        "refresh_memory_pack",
        unknownTargetResults.flatMap((result) => result.unknownTargetIds).concat(acceptance.unknownSubmittedIds),
        { commandIds: unknownTargetResults.map((result) => result.commandId) }
      )
    );
  }
  if (recovery.status === "merge_blocked_after_restart") {
    actionableErrors.push(
      buildActionableError(
        "merge_blocked_after_restart",
        "error",
        "A merge was requested before restart, but current readiness blocks it.",
        true,
        "resolve_readiness_blockers",
        readiness.blockers,
        { restartToken: recovery.restartToken }
      )
    );
  }

  const retryPolicy = buildRetryPolicy(actionableErrors, hostedKernelHealth, routeGuard);
  const writeGuard = writeGuardForOperationalMode({
    readiness,
    routeGuard,
    providerDiagnostics,
    retryPolicy,
    actionableErrors
  });
  const repairPlan = buildOperationalRepairPlan({
    actionableErrors,
    retryPolicy,
    routeGuard,
    readiness,
    recovery,
    hostedKernelHealth
  });
  const criticalCount = actionableErrors.filter((error) => error.severity === "critical").length;
  const errorCount = actionableErrors.filter((error) => error.severity === "error").length;
  const degraded =
    hostedKernelHealth.degraded ||
    !routeGuard.routeAllowed ||
    routeGuard.staleProviderSync.length > 0 ||
    readiness.status !== "ready" ||
    recovery.status === "merge_blocked_after_restart" ||
    recovery.replayCheckpoint.status !== "committed" ||
    providerDiagnostics.status !== "valid" ||
    actionableErrors.some((error) => RETRYABLE_FAILURE_CODES.has(error.code));
  const status = criticalCount > 0 ? "failed" : degraded ? "degraded" : errorCount > 0 ? "attention_required" : "healthy";
  return {
    schemaVersion: "memory-pack-operational-health.v1",
    checkedAt: now,
    status,
    degradedMode: degraded
      ? {
          enabled: true,
          reasonCodes: uniqueStrings(actionableErrors.map((error) => error.code).concat(readiness.blockers)),
          allowsPreview: memories.length > 0,
          allowsCommandReplay: writeGuard.allowsStateReplay,
          allowsMerge: writeGuard.allowsMerge && criticalCount === 0,
          writeGuard
        }
      : {
          enabled: false,
          reasonCodes: [],
          allowsPreview: true,
          allowsCommandReplay: true,
          allowsMerge: readiness.canMerge,
          writeGuard
        },
    failureState: {
      failed: status === "failed",
      criticalCount,
      errorCount,
      warningCount: actionableErrors.filter((error) => error.severity === "warning").length,
      codes: actionableErrors.map((error) => error.code)
    },
    routeGuard,
    providerDiagnostics,
    writeGuard,
    retryPolicy,
    repairPlan,
    actionableErrors
  };
}

function normalizeHistorySnapshots(input = {}, pack = {}) {
  const rawSnapshots = asArray(
    input.historySnapshots || input.analyticsHistory || input.history || pack.historySnapshots || pack.analyticsHistory || pack.history
  );
  return rawSnapshots
    .map((snapshot, index) => ({
      snapshotId: asNonEmptyString(snapshot?.snapshotId || snapshot?.id, `history-${index + 1}`),
      capturedAt: asNonEmptyString(snapshot?.capturedAt || snapshot?.generatedAt || snapshot?.at),
      memoryCount: boundedInteger(snapshot?.memoryCount ?? snapshot?.counters?.memoryCount),
      acceptedCount: boundedInteger(snapshot?.acceptedCount ?? snapshot?.counters?.acceptedCount),
      rejectedCount: boundedInteger(snapshot?.rejectedCount ?? snapshot?.counters?.rejectedCount),
      changeRequestedCount: boundedInteger(snapshot?.changeRequestedCount ?? snapshot?.counters?.changeRequestedCount),
      pendingCount: boundedInteger(snapshot?.pendingCount ?? snapshot?.counters?.pendingCount),
      readinessStatus: asNonEmptyString(snapshot?.readinessStatus || snapshot?.readiness?.status),
      healthStatus: asNonEmptyString(snapshot?.healthStatus || snapshot?.operationalHealth?.status),
      sourceCoverage: boundedNumber(snapshot?.sourceCoverage ?? snapshot?.validation?.sourceCoverage),
      proofCoverage: boundedNumber(snapshot?.proofCoverage ?? snapshot?.validation?.proofCoverage),
      routeAllowed: snapshot?.routeAllowed === true,
      canMerge: snapshot?.canMerge === true,
      blockerCount: boundedInteger(snapshot?.blockerCount ?? snapshot?.readiness?.blockers?.length),
      retryableFailureCount: boundedInteger(snapshot?.retryableFailureCount ?? snapshot?.retry?.retryableCodes?.length)
    }))
    .filter((snapshot) => snapshot.capturedAt || snapshot.memoryCount > 0);
}

function reviewDecisionForMemory(memoryId, acceptance) {
  if (acceptance.acceptedIds.includes(memoryId)) return "accepted";
  if (acceptance.rejectedIds.includes(memoryId)) return "rejected";
  if (acceptance.changeRequestedIds.includes(memoryId)) return "changes_requested";
  return "pending";
}

function buildTimelineEvents({ now, commandResults, operationalHealth, readiness, recovery, externalHandoff }) {
  const commandEvents = commandResults.map((result) => ({
    eventId: `command:${result.commandId}`,
    at: now,
    kind: "command_replay",
    status: result.status,
    action: result.action,
    targetIds: result.targetIds,
    unknownTargetIds: result.unknownTargetIds
  }));
  const errorEvents = operationalHealth.actionableErrors.map((error, index) => ({
    eventId: `health:${error.code}:${index + 1}`,
    at: now,
    kind: "health_signal",
    status: error.severity,
    action: error.action,
    code: error.code,
    targetIds: error.targetIds,
    retryable: error.retryable
  }));
  return [
    {
      eventId: "report:generated",
      at: now,
      kind: "analytics_snapshot",
      status: operationalHealth.status,
      action: "describe_memory_pack"
    },
    ...commandEvents,
    ...errorEvents,
    {
      eventId: "readiness:evaluated",
      at: now,
      kind: "readiness",
      status: readiness.status,
      action: readiness.canMerge ? "merge_available" : "resolve_blockers",
      blockers: readiness.blockers
    },
    {
      eventId: "handoff:evaluated",
      at: now,
      kind: "external_handoff",
      status: externalHandoff.status,
      action: externalHandoff.commitEnvelope.canCommit ? "commit_ready" : "sync_pending",
      providerId: externalHandoff.providerId
    },
    {
      eventId: "recovery:evaluated",
      at: now,
      kind: "recovery",
      status: recovery.status,
      action: recovery.restartSafe ? "resume_safe" : "inspect_rejected_commands",
      restartToken: recovery.restartToken
    }
  ];
}

function countBy(values) {
  return asArray(values).reduce((counts, value) => {
    const key = asNonEmptyString(value, "unknown");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function normalizeAnalyticsExportRequest(input = {}, pack = {}, boundaryProof = null) {
  const raw = input.exportRequest || input.analyticsExport || pack.exportRequest || pack.analyticsExport || {};
  const requestedFormats = uniqueStrings(raw.formats || raw.format || input.exportFormats);
  const formats = requestedFormats.length > 0 ? requestedFormats : ["json"];
  const audience = asNonEmptyString(raw.audience || raw.targetAudience, "operator");
  const includeMemoryRows = raw.includeMemoryRows !== false;
  const includeTimeline = raw.includeTimeline !== false;
  const includeProofHashes = raw.includeProofHashes !== false && audience !== "external";
  const includeSourceUris = raw.includeSourceUris !== false && audience !== "external";
  const redactSources = raw.redactSources === true || audience === "external";
  const actorId = asNonEmptyString(raw.actorId || input.actorId || boundaryProof?.actorId, "unassigned");
  return {
    schemaVersion: "memory-pack-analytics-export-request.v1",
    requestId: asNonEmptyString(raw.requestId || raw.id || input.exportRequestId, `${surfaceName}:analytics-export`),
    audience,
    actorId,
    formats,
    includeMemoryRows,
    includeTimeline,
    includeProofHashes,
    includeSourceUris,
    redactSources,
    maxMemoryRows: boundedPositiveInteger(raw.maxMemoryRows ?? input.exportMemoryRowLimit, 250)
  };
}

function buildMemoryExportRows(memoryRows, exportRequest) {
  if (!exportRequest.includeMemoryRows) return [];
  return memoryRows.slice(0, exportRequest.maxMemoryRows).map((row) => ({
    memoryId: row.memoryId,
    title: row.title,
    kind: row.kind,
    decision: row.decision,
    sourceUri: exportRequest.includeSourceUris && !exportRequest.redactSources ? row.sourceUri : null,
    sourceBacked: row.sourceBacked,
    proofHashes: exportRequest.includeProofHashes ? row.proofHashes : [],
    linkedEvidenceCount: row.linkedEvidenceIds.length,
    blockingIssues: row.blockingIssues
  }));
}

function buildAnalyticsSegments(memories, memoryRows) {
  const decisionByMemory = new Map(memoryRows.map((row) => [row.memoryId, row.decision]));
  return {
    schemaVersion: "memory-pack-analytics-segments.v1",
    byKind: countBy(memories.map((memory) => memory.kind)),
    byDecision: countBy(memoryRows.map((row) => row.decision)),
    byTag: countBy(memories.flatMap((memory) => memory.tags)),
    sourceBackedByDecision: ["accepted", "rejected", "changes_requested", "pending"].map((decision) => {
      const rows = memoryRows.filter((row) => row.decision === decision);
      const sourceBackedCount = rows.filter((row) => row.sourceBacked).length;
      return {
        decision,
        total: rows.length,
        sourceBacked: sourceBackedCount,
        unproven: rows.length - sourceBackedCount
      };
    }),
    tagDecisionMatrix: uniqueStrings(memories.flatMap((memory) => memory.tags)).map((tag) => {
      const taggedMemories = memories.filter((memory) => memory.tags.includes(tag));
      return {
        tag,
        total: taggedMemories.length,
        decisions: countBy(taggedMemories.map((memory) => decisionByMemory.get(memory.memoryId) || "pending"))
      };
    })
  };
}

function buildHistoryTrendState(previousSnapshots, currentSnapshot) {
  const snapshots = previousSnapshots.concat(currentSnapshot);
  const first = snapshots[0] || currentSnapshot;
  const previous = snapshots[snapshots.length - 2] || null;
  const acceptedDelta = previous ? currentSnapshot.acceptedCount - previous.acceptedCount : currentSnapshot.acceptedCount;
  const pendingDelta = previous ? currentSnapshot.pendingCount - previous.pendingCount : currentSnapshot.pendingCount;
  const blockerDelta = previous ? currentSnapshot.blockerCount - previous.blockerCount : currentSnapshot.blockerCount;
  const proofCoverageDelta = previous ? Number((currentSnapshot.proofCoverage - previous.proofCoverage).toFixed(2)) : currentSnapshot.proofCoverage;
  return {
    schemaVersion: "memory-pack-history-trend.v1",
    sampleCount: snapshots.length,
    baselineSnapshotId: first.snapshotId,
    currentSnapshotId: currentSnapshot.snapshotId,
    acceptedDelta,
    pendingDelta,
    blockerDelta,
    proofCoverageDelta,
    direction:
      blockerDelta < 0 || acceptedDelta > 0 || proofCoverageDelta > 0
        ? "improving"
        : blockerDelta > 0 || pendingDelta > 0
          ? "regressing"
          : "stable",
    stalled:
      snapshots.length > 1 &&
      acceptedDelta === 0 &&
      pendingDelta === 0 &&
      blockerDelta === 0 &&
      proofCoverageDelta === 0
  };
}

function buildReportManifest({
  exportRequest,
  currentSnapshot,
  trendState,
  timeline,
  memoryExportRows,
  readiness,
  operationalHealth,
  externalHandoff,
  capabilityNegotiation,
  reviewQueue
}) {
  const redactionNotes = uniqueStrings(
    []
      .concat(exportRequest.redactSources ? ["source_uris_redacted"] : [])
      .concat(exportRequest.includeProofHashes ? [] : ["proof_hashes_omitted"])
      .concat(memoryExportRows.length < reviewQueue.totalCount ? ["memory_rows_truncated"] : [])
  );
  const reportSections = [
    { section: "summary", included: true, rowCount: 1 },
    { section: "counters", included: true, rowCount: Object.keys(currentSnapshot).length },
    { section: "history", included: true, rowCount: trendState.sampleCount },
    { section: "timeline", included: exportRequest.includeTimeline, rowCount: exportRequest.includeTimeline ? timeline.length : 0 },
    { section: "memory_rows", included: exportRequest.includeMemoryRows, rowCount: memoryExportRows.length }
  ];
  return {
    schemaVersion: "memory-pack-report-manifest.v1",
    requestId: exportRequest.requestId,
    audience: exportRequest.audience,
    actorId: exportRequest.actorId,
    formats: exportRequest.formats,
    status:
      operationalHealth.status === "failed"
        ? "blocked"
        : readiness.canMerge
          ? "commit_summary_ready"
          : reviewQueue.pendingCount > 0 || reviewQueue.blockedCount > 0
            ? "progress_report_ready"
            : "snapshot_ready",
    selectedProviderId: capabilityNegotiation.selectedProviderId,
    handoffStatus: externalHandoff.status,
    currentSnapshotId: currentSnapshot.snapshotId,
    trendDirection: trendState.direction,
    timelineIncluded: exportRequest.includeTimeline,
    redactionNotes,
    reportSections,
    routeHints: exportRequest.formats.map((format) => ({
      format,
      route: `hosted-kernel.memory-pack.analytics.export.${format}`,
      idempotencyKey: `memory-pack-report:${exportRequest.requestId}:${currentSnapshot.snapshotId}:${format}`
    }))
  };
}

function buildAnalyticsExports({
  input,
  pack,
  memories,
  evidence,
  validationSummary,
  acceptance,
  readiness,
  recovery,
  sourceLineageProof,
  commandReplay,
  providerContracts,
  capabilityNegotiation,
  externalHandoff,
  boundaryProof,
  operationalHealth,
  reviewQueue,
  nextSteps,
  now
}) {
  const previousSnapshots = normalizeHistorySnapshots(input, pack);
  const evidenceByMemory = new Map(sourceLineageProof.evidenceByMemory.map((entry) => [entry.memoryId, entry]));
  const appliedCommands = commandReplay.commandResults.filter((result) => result.status.startsWith("applied"));
  const rejectedCommands = commandReplay.commandResults.filter((result) => result.status.startsWith("rejected"));
  const duplicateCommands = commandReplay.commandResults.filter(
    (result) =>
      result.status === "skipped_duplicate" ||
      result.status === "skipped_idempotent_replay" ||
      result.status === "skipped_idempotent_state_replay"
  );
  const unknownTargetCommands = commandReplay.commandResults.filter((result) => result.unknownTargetIds.length > 0);
  const providerNegotiations = capabilityNegotiation.providers || [];
  const currentSnapshot = {
    snapshotId: `${commandReplay.state.stateId}@${commandReplay.state.reviewVersion}`,
    capturedAt: now,
    memoryCount: memories.length,
    acceptedCount: acceptance.acceptedIds.length,
    rejectedCount: acceptance.rejectedIds.length,
    changeRequestedCount: acceptance.changeRequestedIds.length,
    pendingCount: acceptance.pendingIds.length,
    readinessStatus: readiness.status,
    healthStatus: operationalHealth.status,
    sourceCoverage: validationSummary.sourceCoverage,
    proofCoverage: validationSummary.proofCoverage,
    routeAllowed: operationalHealth.routeGuard.routeAllowed,
    canMerge: readiness.canMerge,
    blockerCount: readiness.blockers.length,
    retryableFailureCount: operationalHealth.retryPolicy.retryableCodes.length
  };
  const previousSnapshot = previousSnapshots[previousSnapshots.length - 1] || null;
  const timeline = buildTimelineEvents({
    now,
    commandResults: commandReplay.commandResults,
    operationalHealth,
    readiness,
    recovery,
    externalHandoff
  });
  const memoryRows = memories.map((memory) => {
    const proof = evidenceByMemory.get(memory.memoryId) || {};
    return {
      memoryId: memory.memoryId,
      title: memory.title,
      kind: memory.kind,
      decision: reviewDecisionForMemory(memory.memoryId, acceptance),
      sourceUri: memory.source || null,
      sourceBacked: proof.sourceBacked === true,
      proofHashes: proof.proofHashes || [],
      linkedEvidenceIds: proof.linkedEvidenceIds || [],
      blockingIssues: memory.missingFields.map((field) => `missing_${field}`).concat(proof.issues || [])
    };
  });
  const exportRequest = normalizeAnalyticsExportRequest(input, pack, boundaryProof);
  const memoryExportRows = buildMemoryExportRows(memoryRows, exportRequest);
  const segments = buildAnalyticsSegments(memories, memoryRows);
  const trendState = buildHistoryTrendState(previousSnapshots, currentSnapshot);
  const reportManifest = buildReportManifest({
    exportRequest,
    currentSnapshot,
    trendState,
    timeline,
    memoryExportRows,
    readiness,
    operationalHealth,
    externalHandoff,
    capabilityNegotiation,
    reviewQueue
  });
  return {
    schemaVersion: "memory-pack-analytics-export.v1",
    generatedAt: now,
    exportRequest,
    counters: {
      memories: {
        total: memories.length,
        accepted: acceptance.acceptedIds.length,
        rejected: acceptance.rejectedIds.length,
        changesRequested: acceptance.changeRequestedIds.length,
        pending: acceptance.pendingIds.length,
        missingSource: validationSummary.missingSourceIds.length,
        missingSummary: validationSummary.missingSummaryIds.length,
        lowConfidence: validationSummary.lowConfidenceIds.length,
        sourceBackedAccepted: sourceLineageProof.sourceBackedAcceptedCount,
        acceptedUnproven: sourceLineageProof.acceptedUnprovenIds.length
      },
      evidence: {
        total: evidence.length,
        hashed: evidence.filter((item) => item.hash).length,
        unlinked: sourceLineageProof.unlinkedEvidenceIds.length,
        sourceCoverage: validationSummary.sourceCoverage,
        proofCoverage: validationSummary.proofCoverage
      },
      commands: {
        total: commandReplay.commandResults.length,
        applied: appliedCommands.length,
        duplicate: duplicateCommands.length,
        rejected: rejectedCommands.length,
        unknownTarget: unknownTargetCommands.length
      },
      boundary: {
        scopedMemory: boundaryProof.scopedMemoryCount,
        outOfBoundaryMemory: boundaryProof.outOfBoundaryMemoryIds.length,
        authorizedCommand: boundaryProof.authorizedCommandCount,
        blockedCommand: boundaryProof.blockedCommandCount,
        blockerCount: boundaryProof.blockers.length
      },
      providers: {
        total: providerContracts.length,
        supported: providerNegotiations.filter((provider) => provider.supported).length,
        blocked: providerNegotiations.filter((provider) => !provider.supported).length,
        missingCapability: capabilityNegotiation.blockers.length,
        staleSync: operationalHealth.routeGuard.staleProviderSync.length
      },
      health: {
        critical: operationalHealth.failureState.criticalCount,
        errors: operationalHealth.failureState.errorCount,
        warnings: operationalHealth.failureState.warningCount,
        retryable: operationalHealth.retryPolicy.retryableCodes.length,
        blockers: readiness.blockers.length
      },
      reviewQueue: {
        total: reviewQueue.totalCount,
        previewed: reviewQueue.previewedCount,
        pending: reviewQueue.pendingCount,
        blocked: reviewQueue.blockedCount,
        readyToAccept: reviewQueue.readyToAcceptCount
      }
    },
    segments,
    history: {
      snapshots: previousSnapshots.concat(currentSnapshot).slice(-12),
      trendState,
      deltaFromPrevious: previousSnapshot
        ? {
            memoryCount: currentSnapshot.memoryCount - previousSnapshot.memoryCount,
            acceptedCount: currentSnapshot.acceptedCount - previousSnapshot.acceptedCount,
            pendingCount: currentSnapshot.pendingCount - previousSnapshot.pendingCount,
            blockerCount: currentSnapshot.blockerCount - previousSnapshot.blockerCount,
            proofCoverage: Number((currentSnapshot.proofCoverage - previousSnapshot.proofCoverage).toFixed(2)),
            sourceCoverage: Number((currentSnapshot.sourceCoverage - previousSnapshot.sourceCoverage).toFixed(2))
          }
        : null
    },
    timelineReportingState: {
      timeline: exportRequest.includeTimeline ? timeline : [],
      suppressedTimelineEventCount: exportRequest.includeTimeline ? 0 : timeline.length,
      latestEventId: timeline[timeline.length - 1]?.eventId || null,
      nextReportAction: readiness.canMerge
        ? "export_commit_summary"
        : operationalHealth.retryPolicy.shouldRetry
          ? "export_retry_report"
          : "export_review_progress",
      milestoneState: {
        previewReady: memories.length > 0,
        validationPassed: validationSummary.status === "pass",
        proofVerified: sourceLineageProof.status === "verified",
        providerMatched: capabilityNegotiation.status === "matched",
        handoffReady: externalHandoff.status === "ready_for_external_commit"
      }
    },
    reportManifest,
    exportSummary: {
      packId: asNonEmptyString(pack.packId || pack.id, "memory-pack-draft"),
      title: asNonEmptyString(pack.title || pack.name, "Memory Pack Draft"),
      contractVersion: memoryPackContractVersion,
      route: asNonEmptyString(input.route, "hosted-kernel.memory-pack.preview"),
      generatedAt: now,
      status: operationalHealth.status,
      readinessStatus: readiness.status,
      canMerge: readiness.canMerge,
      selectedProviderId: capabilityNegotiation.selectedProviderId,
      restartToken: recovery.restartToken,
      blockers: readiness.blockers,
      failureCodes: operationalHealth.failureState.codes,
      boundaryStatus: boundaryProof.blockers.length > 0 ? "blocked" : "scoped",
      tenantId: boundaryProof.tenantId,
      workspaceId: boundaryProof.workspaceId,
      actorId: boundaryProof.actorId,
      boundaryBlockers: boundaryProof.blockers,
      nextStepActions: nextSteps.map((step) => step.action),
      memoryRows: memoryExportRows,
      sourceRowsRedacted: exportRequest.redactSources,
      totalMemoryRowsAvailable: memoryRows.length,
      exportedMemoryRowCount: memoryExportRows.length,
      decisionSegments: segments.byDecision,
      kindSegments: segments.byKind,
      trendDirection: trendState.direction,
      reportStatus: reportManifest.status,
      reportRoutes: reportManifest.routeHints,
      reviewQueueStatus: reviewQueue.status,
      reviewFocusMemoryId: reviewQueue.focusMemoryId,
      bulkAcceptableIds: reviewQueue.bulkActions.acceptableIds,
      bulkChangeRequiredIds: reviewQueue.bulkActions.changeRequiredIds
    }
  };
}

export function describeMemoryPackSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const pack = input.memoryPack || input.pack || input;
  const evidence = normalizeEvidence(input.evidence || pack.evidence);
  const memories = normalizeMemories(pack);
  const boundaryContext = normalizeBoundaryContext(input, pack, memories, now);
  const boundaryProof = authorizeMemoryPackCommands(input.commands || pack.commands, boundaryContext, memories);
  const persistedState = normalizePersistedState(input, pack, memories);
  const hostedKernelHealth = normalizeHostedKernelHealth(input, pack);
  const requestedLifecycleSettings = normalizeLifecycleSettings(input, pack, now);
  const providerContracts = normalizeProviderContracts(input, pack);
  const commandReplay = applyMemoryPackCommands(persistedState, boundaryProof.authorizedCommands, memories, now);
  const lifecycleSettings = buildEffectiveLifecycleSettings(
    requestedLifecycleSettings,
    commandReplay.state,
    commandReplay.commandResults,
    now
  );
  const preview = buildPreview(memories, input.previewLimit);
  const validationSummary = buildValidationSummary(memories, evidence);
  const acceptance = buildAcceptanceState(input.acceptance || input, memories, validationSummary, commandReplay.state);
  const sourceLineageProof = buildSourceLineageProof(memories, evidence, acceptance);
  const readiness = buildReadiness(validationSummary, acceptance, evidence, sourceLineageProof, boundaryProof, lifecycleSettings);
  const recovery = buildRecoveryState(commandReplay.state, commandReplay.commandResults, acceptance, readiness);
  const operationalHealth = buildOperationalHealth({
    memories,
    evidence,
    validationSummary,
    acceptance,
    readiness,
    recovery,
    sourceLineageProof,
    boundaryProof,
    commandResults: commandReplay.commandResults,
    persistedState: commandReplay.state,
    hostedKernelHealth,
    providerContracts,
    lifecycleSettings,
    now
  });
  const capabilityNegotiation = negotiateProviderCapabilities(providerContracts, readiness, operationalHealth);
  const externalHandoff = buildExternalHandoffState({
    providerContracts,
    capabilityNegotiation,
    readiness,
    recovery,
    operationalHealth,
    acceptance,
    sourceLineageProof,
    boundaryProof,
    now
  });
  const boundaryExecutionLease = buildBoundaryExecutionLease({
    boundaryProof,
    externalHandoff,
    recovery,
    now
  });
  const providerServiceContract = buildProviderServiceContractState({
    providerContracts,
    capabilityNegotiation,
    readiness,
    operationalHealth,
    externalHandoff,
    lifecycleSettings,
    boundaryExecutionLease,
    now
  });
  const providerServiceAcks = normalizeProviderServiceAcks(input, pack);
  const providerAckReconciliation = buildProviderAckReconciliation({
    providerServiceContract,
    providerServiceAcks,
    externalHandoff,
    boundaryExecutionLease,
    now
  });
  const lifecycleControlState = buildLifecycleControlState({
    lifecycleSettings,
    readiness,
    operationalHealth,
    externalHandoff,
    acceptance,
    now
  });
  const nextSteps = buildNextSteps(readiness, validationSummary, acceptance, sourceLineageProof, lifecycleSettings);
  const reviewQueue = buildReviewQueue({ memories, preview, validationSummary, acceptance, sourceLineageProof, nextSteps });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    input,
    pack,
    memories,
    acceptance,
    reviewQueue,
    readiness,
    validationSummary,
    sourceLineageProof,
    operationalHealth,
    capabilityNegotiation,
    providerServiceContract,
    externalHandoff,
    lifecycleControlState,
    boundaryProof,
    boundaryExecutionLease,
    nextSteps,
    now
  });
  const analyticsExports = buildAnalyticsExports({
    input,
    pack,
    memories,
    evidence,
    validationSummary,
    acceptance,
    readiness,
    recovery,
    sourceLineageProof,
    commandReplay,
    providerContracts,
    capabilityNegotiation,
    externalHandoff,
    clientWorkflowHandoff,
    boundaryProof,
    operationalHealth,
    reviewQueue,
    nextSteps,
    now
  });
  return {
    ok: operationalHealth.status !== "failed" && (readiness.status === "ready" || validationSummary.status === "pass"),
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: "ai-os-wave1-hosted-kernel-boot-proof",
    contract: memoryPackContractVersion,
    pack: {
      packId: asNonEmptyString(pack.packId || pack.id, "memory-pack-draft"),
      title: asNonEmptyString(pack.title || pack.name, "Memory Pack Draft"),
      memoryCount: memories.length
    },
    preview,
    acceptance,
    reviewQueue,
    readiness,
    lifecycleSettings,
    requestedLifecycleSettings,
    lifecycleControlState,
    recovery,
    providerContracts,
    capabilityNegotiation,
    providerServiceContract,
    providerServiceAcks,
    providerAckReconciliation,
    boundaryProof,
    boundaryExecutionLease,
    externalHandoff,
    clientWorkflowHandoff,
    operationalHealth,
    validationSummary,
    sourceLineageProof,
    analyticsExports,
    nextSteps,
    routePayload: {
      route: asNonEmptyString(input.route, "hosted-kernel.memory-pack.preview"),
      contractVersion: memoryPackContractVersion,
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      healthSchemaVersion: operationalHealth.schemaVersion,
      healthStatus: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode.enabled,
      providerId: capabilityNegotiation.selectedProviderId,
      providerNegotiationStatus: capabilityNegotiation.status,
      missingProviderCapabilities: capabilityNegotiation.blockers,
      providerServiceContractStatus: providerServiceContract.status,
      providerServiceContractSchemaVersion: providerServiceContract.schemaVersion,
      providerServiceRouteBase: providerServiceContract.providerRouteBase,
      providerServiceNextAction: providerServiceContract.nextServiceAction,
      providerServiceEnabledWrites: providerServiceContract.enabledWriteOperations,
      providerServiceSyncRequired: providerServiceContract.syncContract.syncRequired,
      providerServiceSyncStale: providerServiceContract.syncContract.stale,
      providerServiceOperations: providerServiceContract.operations.map((operation) => ({
        operation: operation.operation,
        action: operation.action,
        route: operation.route,
        enabled: operation.enabled,
        blockedBy: operation.blockedBy
      })),
      providerAckSchemaVersion: providerAckReconciliation.schemaVersion,
      providerAckStatus: providerAckReconciliation.status,
      providerAckRequiredOperations: providerAckReconciliation.requiredAckOperations,
      providerAckAcknowledgedOperations: providerAckReconciliation.acknowledgedOperations,
      providerAckMissingOperations: providerAckReconciliation.missingAckOperations,
      providerAckCommitted: providerAckReconciliation.committed,
      providerAckCheckpointed: providerAckReconciliation.checkpointed,
      providerAckBlockers: providerAckReconciliation.blockers,
      providerAckNextAction: providerAckReconciliation.nextProviderAction,
      providerHandoffLedger: providerAckReconciliation.handoffLedger,
      routeAllowed: operationalHealth.routeGuard.routeAllowed,
      routeTraceId: operationalHealth.routeGuard.routeTraceId,
      routeGuardBlockers: uniqueStrings(
        []
          .concat(operationalHealth.routeGuard.providersMissingEndpoint.map((providerId) => `missing_endpoint:${providerId}`))
          .concat(operationalHealth.routeGuard.circuitBreaker.active ? ["circuit_breaker_open"] : [])
          .concat(operationalHealth.routeGuard.staleProviderSync.map((entry) => `stale_sync:${entry.providerId}`))
      ),
      repairPlanSchemaVersion: operationalHealth.repairPlan.schemaVersion,
      repairPlanStatus: operationalHealth.repairPlan.status,
      repairNextAction: operationalHealth.repairPlan.nextOperatorAction,
      repairOwnerQueues: operationalHealth.repairPlan.ownerQueues,
      degradedReadPolicy: operationalHealth.repairPlan.degradedReadPolicy,
      operationalWriteGuard: operationalHealth.writeGuard,
      providerDiagnosticsSchemaVersion: operationalHealth.providerDiagnostics.schemaVersion,
      providerDiagnosticsStatus: operationalHealth.providerDiagnostics.status,
      providerDiagnosticsCapabilityGaps: operationalHealth.providerDiagnostics.capabilityGaps,
      providerDiagnosticsSyncCursorMissingProviderIds: operationalHealth.providerDiagnostics.syncCursorMissingProviderIds,
      providerDiagnosticsHandoffUnboundProviderIds: operationalHealth.providerDiagnostics.handoffUnboundProviderIds,
      restartToken: recovery.restartToken,
      recoveryStatus: recovery.status,
      recoveryRestartSafe: recovery.restartSafe,
      replayCheckpointStatus: recovery.replayCheckpoint.status,
      replayCheckpointRequiresWriteBack: recovery.replayCheckpoint.requiresWriteBack,
      replayCheckpointRequiresOperatorAck: recovery.replayCheckpoint.requiresOperatorAck,
      replayCheckpointConflictMemoryIds: recovery.replayCheckpoint.conflictMemoryIds,
      semanticDuplicateCommandCount: recovery.idempotency.semanticDuplicateCommandCount,
      stateReplayDuplicateCommandCount: recovery.idempotency.stateReplayDuplicateCommandCount,
      durableLifecycleStatus: recovery.durableLifecycle.status,
      durableLifecycleSettingsRevision: recovery.durableLifecycle.settingsRevision,
      durableLifecycleLastCommandId: recovery.durableLifecycle.lastCommandId,
      durableSyncStatus: recovery.durableSync.status,
      durableSyncPendingAck: recovery.durableSync.pendingAck,
      durableSyncScheduleCursor: recovery.durableSync.scheduleCursor,
      durableSyncRequestCount: recovery.durableSync.requestCount,
      externalHandoffStatus: externalHandoff.status,
      externalHandoffId: externalHandoff.handoffId,
      lineageProofStatus: sourceLineageProof.status,
      acceptedUnprovenIds: sourceLineageProof.acceptedUnprovenIds,
      sourceBackedAcceptedCount: sourceLineageProof.sourceBackedAcceptedCount,
      boundarySchemaVersion: boundaryProof.schemaVersion,
      boundaryTenantId: boundaryProof.tenantId,
      boundaryWorkspaceId: boundaryProof.workspaceId,
      boundaryActorId: boundaryProof.actorId,
      boundaryScopedMemoryCount: boundaryProof.scopedMemoryCount,
      boundaryOutOfScopeMemoryIds: boundaryProof.outOfBoundaryMemoryIds,
      boundaryBlockedCommandCount: boundaryProof.blockedCommandCount,
      boundaryBlockers: boundaryProof.blockers,
      boundaryActiveGrantIds: boundaryProof.auditHandoff.activeGrantIds,
      boundaryInactiveGrantIds: boundaryProof.auditHandoff.inactiveGrantIds,
      boundaryAuditHandoffStatus: boundaryProof.auditHandoff.status,
      boundaryExecutionLeaseId: boundaryExecutionLease.leaseId,
      boundaryExecutionLeaseStatus: boundaryExecutionLease.status,
      boundaryExecutionLeaseBlockers: boundaryExecutionLease.blockedBy,
      boundaryExecutionLeaseScopedMemoryIds: boundaryExecutionLease.scopedMemoryIds,
      boundaryQuarantinedCommandIds: boundaryProof.auditHandoff.scopedExport.quarantinedCommandIds,
      boundaryAuthorizedCommandIds: boundaryProof.auditHandoff.scopedExport.authorizedCommandIds,
      boundaryRedactionPolicy: boundaryProof.auditHandoff.redactionPolicy,
      analyticsSchemaVersion: analyticsExports.schemaVersion,
      analyticsSnapshotId: analyticsExports.history.snapshots[analyticsExports.history.snapshots.length - 1]?.snapshotId || null,
      analyticsCounters: analyticsExports.counters,
      exportSummaryStatus: analyticsExports.exportSummary.status,
      timelineEventCount: analyticsExports.timelineReportingState.timeline.length,
      syncCursor: externalHandoff.syncMetadata.cursor,
      syncDirty: externalHandoff.syncMetadata.dirty,
      previewIds: preview.map((item) => item.memoryId),
      reviewQueueStatus: reviewQueue.status,
      reviewFocusMemoryId: reviewQueue.focusMemoryId,
      reviewQueueCursor: reviewQueue.nextCursor,
      reviewBulkActions: reviewQueue.bulkActions,
      clientWorkflowSchemaVersion: clientWorkflowHandoff.schemaVersion,
      clientRequestId: clientWorkflowHandoff.request.requestId,
      clientEntrypoint: clientWorkflowHandoff.request.entrypoint,
      clientCurrentPanel: clientWorkflowHandoff.workflow.currentPanel,
      clientPrimaryAction: clientWorkflowHandoff.workflow.primaryAction,
      clientPrimaryActionEnabled: clientWorkflowHandoff.workflow.primaryActionEnabled,
      clientStateStale: clientWorkflowHandoff.stateBinding.staleClientState,
      clientVisibleMemoryIds: clientWorkflowHandoff.workflow.visibleMemoryIds,
      clientUnknownVisibleMemoryIds: clientWorkflowHandoff.workflow.unknownVisibleMemoryIds,
      clientBanner: clientWorkflowHandoff.workflow.banner,
      clientCommandSchemaVersion: clientWorkflowHandoff.clientCommandEnvelope.schemaVersion,
      clientCommandSubmitRoute: clientWorkflowHandoff.clientCommandEnvelope.submitRoute,
      clientCommandIdempotencyKey: clientWorkflowHandoff.clientCommandEnvelope.idempotencyKey,
      clientCommandBoundaryLeaseId: clientWorkflowHandoff.clientCommandEnvelope.command.boundaryLeaseId,
      clientCommandAction: clientWorkflowHandoff.clientCommandEnvelope.command.action,
      clientCommandTargetIds: clientWorkflowHandoff.clientCommandEnvelope.command.targetIds,
      clientCommandEnabled: clientWorkflowHandoff.clientCommandEnvelope.command.enabled,
      clientCommandBlockedBy: clientWorkflowHandoff.clientCommandEnvelope.command.blockedBy,
      previewAcceptancePanelSchemaVersion: clientWorkflowHandoff.previewAcceptancePanel.schemaVersion,
      previewAcceptancePanelStatus: clientWorkflowHandoff.previewAcceptancePanel.status,
      previewAcceptancePrimaryAction: clientWorkflowHandoff.previewAcceptancePanel.primaryAction,
      previewAcceptanceVisibleSummary: clientWorkflowHandoff.previewAcceptancePanel.visibleSummary,
      previewAcceptanceGate: clientWorkflowHandoff.previewAcceptancePanel.acceptanceGate,
      previewAcceptanceProofGate: clientWorkflowHandoff.previewAcceptancePanel.proofGate,
      previewAcceptanceMergeGate: clientWorkflowHandoff.previewAcceptancePanel.mergeGate,
      lifecycleSettingsSchemaVersion: lifecycleSettings.schemaVersion,
      lifecycleRuntimeSchemaVersion: lifecycleSettings.runtimeState.schemaVersion,
      lifecycleSettingsStatus: lifecycleSettings.status,
      requestedLifecycleSettingsStatus: requestedLifecycleSettings.status,
      lifecycleReviewMode: lifecycleSettings.reviewMode,
      lifecycleValidationStatus: lifecycleSettings.validation.status,
      lifecycleValidationIssues: lifecycleSettings.validation.issueCodes,
      lifecycleRuntimeIssues: lifecycleSettings.validation.runtimeIssueCodes,
      lifecycleRuntimeState: lifecycleSettings.runtimeState,
      lifecyclePrimaryAction: lifecycleControlState.primaryLifecycleAction,
      lifecycleCanEnable: lifecycleControlState.canEnable,
      lifecycleCanDisable: lifecycleControlState.canDisable,
      lifecycleCanRunScheduledSync: lifecycleControlState.canRunScheduledSync,
      lifecycleCanAutoMerge: lifecycleControlState.canAutoMerge,
      lifecycleScheduleGate: lifecycleControlState.scheduleGate,
      nextStepActions: nextSteps.map((step) => step.action),
      retry: operationalHealth.retryPolicy.shouldRetry
        ? {
            strategy: operationalHealth.retryPolicy.strategy,
            attempt: operationalHealth.retryPolicy.attempt,
            nextDelayMs: operationalHealth.retryPolicy.nextDelayMs,
            codes: operationalHealth.retryPolicy.retryableCodes
          }
        : null
    },
    auditProof: {
      generatedAt: now,
      evidenceCount: evidence.length,
      sourceUris: uniqueStrings(evidence.map((item) => item.uri).concat(memories.map((memory) => memory.source))),
      evidence,
      stateProof: {
        stateId: commandReplay.state.stateId,
        reviewVersion: commandReplay.state.reviewVersion,
        restartToken: recovery.restartToken,
        replayCheckpoint: recovery.replayCheckpoint,
        durableLifecycle: recovery.durableLifecycle,
        durableSync: recovery.durableSync,
        decisionConflicts: commandReplay.state.decisionConflicts || [],
        commandLog: commandReplay.state.commandLog,
        commandResults: commandReplay.commandResults
      },
      boundaryProof,
      boundaryAuditHandoff: boundaryProof.auditHandoff,
      boundaryExecutionLease,
      lineageProof: sourceLineageProof,
      operationalProof: {
        status: operationalHealth.status,
        degradedMode: operationalHealth.degradedMode,
        failureState: operationalHealth.failureState,
        routeGuard: operationalHealth.routeGuard,
        providerDiagnostics: operationalHealth.providerDiagnostics,
        writeGuard: operationalHealth.writeGuard,
        retryPolicy: operationalHealth.retryPolicy,
        repairPlan: operationalHealth.repairPlan,
        actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
      },
      providerProof: {
        negotiationStatus: capabilityNegotiation.status,
        selectedProviderId: capabilityNegotiation.selectedProviderId,
        serviceContractStatus: providerServiceContract.status,
        serviceContractOperations: providerServiceContract.operations.map((operation) => ({
          operation: operation.operation,
          route: operation.route,
          requiredCapability: operation.requiredCapability,
          enabled: operation.enabled,
          blockedBy: operation.blockedBy,
          idempotencyScope: operation.idempotencyScope,
          requestContract: operation.requestContract,
          responseContract: operation.responseContract
        })),
        syncContract: providerServiceContract.syncContract,
        handoffContract: providerServiceContract.handoffContract,
        boundaryExecutionLease,
        ackReconciliation: providerAckReconciliation,
        serviceAcks: providerServiceAcks,
        requiredCapabilities: capabilityNegotiation.requiredCapabilities,
        blockers: capabilityNegotiation.blockers,
        providerContracts: providerContracts.map((provider) => ({
          providerId: provider.providerId,
          service: provider.service,
          contractVersion: provider.contractVersion,
          endpointRef: provider.endpointRef,
          capabilities: provider.capabilities,
          syncCursor: provider.syncMetadata.cursor,
          handoffId: provider.handoffState.handoffId
        }))
      },
      handoffProof: {
        status: externalHandoff.status,
        providerId: externalHandoff.providerId,
        externalStateId: externalHandoff.externalStateId,
        syncMetadata: externalHandoff.syncMetadata,
        commitEnvelope: externalHandoff.commitEnvelope,
        blockers: externalHandoff.blockers
      },
      clientWorkflowProof: {
        schemaVersion: clientWorkflowHandoff.schemaVersion,
        requestId: clientWorkflowHandoff.request.requestId,
        sessionId: clientWorkflowHandoff.request.sessionId,
        currentPanel: clientWorkflowHandoff.workflow.currentPanel,
        primaryAction: clientWorkflowHandoff.workflow.primaryAction,
        primaryActionEnabled: clientWorkflowHandoff.workflow.primaryActionEnabled,
        disabledReason: clientWorkflowHandoff.workflow.disabledReason,
        visibleMemoryIds: clientWorkflowHandoff.workflow.visibleMemoryIds,
        unknownVisibleMemoryIds: clientWorkflowHandoff.workflow.unknownVisibleMemoryIds,
        staleClientState: clientWorkflowHandoff.stateBinding.staleClientState,
        previewAcceptancePanel: clientWorkflowHandoff.previewAcceptancePanel,
        commandEnvelope: clientWorkflowHandoff.clientCommandEnvelope,
        clientStatePatch: clientWorkflowHandoff.clientStatePatch
      },
      lifecycleProof: {
        requestedSettings: requestedLifecycleSettings,
        settings: lifecycleSettings,
        runtimeState: lifecycleSettings.runtimeState,
        controlState: lifecycleControlState,
        readinessBlockers: readiness.blockers.filter((blocker) =>
          ["memory_pack_disabled", "lifecycle_settings_invalid"].includes(blocker)
        ),
        healthCodes: operationalHealth.actionableErrors
          .filter((error) => error.code === "memory_pack_disabled" || error.code === "lifecycle_settings_invalid")
          .map((error) => error.code)
      }
    }
  };
}

export default describeMemoryPackSurface;
