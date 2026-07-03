export const surfaceId = "aios_memory-manager_episodic-log-adapter_046";
export const surfaceGroup = "memory-manager";
export const surfaceName = "episodic-log-adapter";

const lifecycleCommands = new Set(["status", "enable", "disable", "pause", "resume", "flush"]);
const allowedScheduleModes = new Set(["manual", "interval", "idle"]);
const allowedClientSurfaces = new Set(["cli", "web", "kernel", "scheduler", "memory-manager"]);
const allowedHandoffTargets = new Set(["operator", "scheduler", "kernel"]);
const allowedActorRoles = new Set(["viewer", "operator", "maintainer", "scheduler", "kernel"]);
const allowedIsolationModes = new Set(["tenant", "workspace", "session"]);
const allowedHealthStates = new Set(["healthy", "degraded", "failing", "offline"]);
const allowedExportFormats = new Set(["json", "jsonl", "csv", "parquet"]);
const allowedPersistedPhases = new Set(["new", "previewed", "accepted", "committed", "flushed", "failed"]);
const allowedPersistedCommandStatuses = new Set(["pending", "applied", "failed", "recovered", "rolled-back"]);
const allowedEpisodeTypes = new Set(["interaction", "decision", "tool-call", "handoff", "error", "checkpoint"]);
const allowedEpisodeSeverities = new Set(["debug", "info", "notice", "warning", "error"]);
const allowedProviderKinds = new Set(["hosted-kernel", "local-cache", "external-service"]);
const allowedProviderStates = new Set(["connected", "degraded", "read-only", "offline"]);
const allowedConsistencyLevels = new Set(["eventual", "session", "strong"]);
const allowedProviderCapabilities = new Set([
  "append-episodes",
  "flush-buffer",
  "retention-policy",
  "full-capture",
  "proof-export",
  "external-handoff",
  "workspace-isolation"
]);
const allowedFailureCodes = new Set([
  "backend-unreachable",
  "buffer-corrupt",
  "quota-exceeded",
  "schema-mismatch",
  "write-denied",
  "timeout"
]);
const allowedServiceAckModes = new Set(["none", "cursor", "revision"]);
const allowedServiceTiers = new Set(["interactive", "batch", "background"]);
const allowedDeliverySemantics = new Set(["best-effort", "at-least-once", "exactly-once"]);
const allowedSyncHandoffModes = new Set(["none", "callback", "kernel-queue", "scheduler-queue"]);
const allowedClientReceiptChannels = new Set(["inline", "callback", "kernel-queue", "scheduler-queue"]);
const allowedClientReceiptAckPolicies = new Set(["none", "on-delivery", "on-commit"]);
const allowedLifecycleStates = new Set(["enabled", "disabled", "paused", "suspended"]);
const allowedWorkflowIntents = new Set(["inspect", "preview", "commit", "flush", "recover"]);
const allowedWorkflowPriorities = new Set(["low", "normal", "high", "urgent"]);
const allowedReturnModes = new Set(["inline", "callback", "deferred"]);
const allowedLifecycleReasons = new Set([
  "operator-request",
  "maintenance-window",
  "failure-backoff",
  "quota-pressure",
  "schema-migration",
  "manual-hold"
]);
const commandRoleMatrix = Object.freeze({
  status: new Set(["viewer", "operator", "maintainer", "scheduler", "kernel"]),
  enable: new Set(["operator", "maintainer", "kernel"]),
  disable: new Set(["maintainer", "kernel"]),
  pause: new Set(["operator", "maintainer", "kernel"]),
  resume: new Set(["operator", "maintainer", "kernel"]),
  flush: new Set(["operator", "maintainer", "scheduler", "kernel"])
});
const defaultSettings = Object.freeze({
  enabled: true,
  retentionDays: 30,
  maxEpisodesPerFlush: 50,
  scheduleMode: "interval",
  flushIntervalMinutes: 15,
  captureLevel: "summary"
});

function clampInteger(value, fallback, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizeSettings(inputSettings = {}) {
  const settings = {
    enabled: normalizeBoolean(inputSettings.enabled, defaultSettings.enabled),
    retentionDays: clampInteger(inputSettings.retentionDays, defaultSettings.retentionDays, { min: 1, max: 365 }),
    maxEpisodesPerFlush: clampInteger(inputSettings.maxEpisodesPerFlush, defaultSettings.maxEpisodesPerFlush, { min: 1, max: 500 }),
    scheduleMode: allowedScheduleModes.has(inputSettings.scheduleMode)
      ? inputSettings.scheduleMode
      : defaultSettings.scheduleMode,
    flushIntervalMinutes: clampInteger(inputSettings.flushIntervalMinutes, defaultSettings.flushIntervalMinutes, { min: 5, max: 1440 }),
    captureLevel: ["summary", "metadata", "full"].includes(inputSettings.captureLevel)
      ? inputSettings.captureLevel
      : defaultSettings.captureLevel
  };

  const validation = [];
  if (inputSettings.retentionDays !== undefined && settings.retentionDays !== Number(inputSettings.retentionDays)) {
    validation.push("retentionDays was normalized to the supported 1-365 day range");
  }
  if (inputSettings.maxEpisodesPerFlush !== undefined && settings.maxEpisodesPerFlush !== Number(inputSettings.maxEpisodesPerFlush)) {
    validation.push("maxEpisodesPerFlush was normalized to the supported 1-500 range");
  }
  if (inputSettings.scheduleMode !== undefined && !allowedScheduleModes.has(inputSettings.scheduleMode)) {
    validation.push("scheduleMode was reset to interval because the requested mode is unsupported");
  }
  if (inputSettings.flushIntervalMinutes !== undefined && settings.flushIntervalMinutes !== Number(inputSettings.flushIntervalMinutes)) {
    validation.push("flushIntervalMinutes was normalized to the supported 5-1440 minute range");
  }
  if (inputSettings.captureLevel !== undefined && settings.captureLevel !== inputSettings.captureLevel) {
    validation.push("captureLevel was reset to summary because the requested level is unsupported");
  }

  return { settings, validation };
}

function normalizeCommand(command) {
  const requested = typeof command === "string" ? command.trim().toLowerCase() : "status";
  return lifecycleCommands.has(requested) ? requested : "status";
}

function normalizeText(value, fallback, { maxLength = 96 } = {}) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (normalized.length === 0) return fallback;
  return normalized.slice(0, maxLength);
}

function normalizeTimestamp(value, fallback = null) {
  const normalized = normalizeText(value, null, { maxLength: 40 });
  if (!normalized) return fallback;
  return Number.isFinite(Date.parse(normalized)) ? normalized : fallback;
}

function addSecondsToTimestamp(timestamp, seconds) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + seconds * 1000).toISOString();
}

function proofTokenFor(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeMetadata(value, captureLevel) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .filter(([, entryValue]) => ["string", "number", "boolean"].includes(typeof entryValue))
    .slice(0, captureLevel === "full" ? 16 : 8);
  return Object.fromEntries(entries.map(([key, entryValue]) => [String(key).slice(0, 48), entryValue]));
}

function normalizeEpisodeRecord(entry, index, settings, tenantBoundary, now) {
  const source = entry && typeof entry === "object" ? entry : {};
  const episodeId = normalizeText(source.episodeId ?? source.id, `episode-${index + 1}`, { maxLength: 96 });
  const requestedType = typeof source.type === "string" ? source.type.trim().toLowerCase() : "interaction";
  const type = allowedEpisodeTypes.has(requestedType) ? requestedType : "interaction";
  const requestedSeverity = typeof source.severity === "string" ? source.severity.trim().toLowerCase() : "info";
  const severity = allowedEpisodeSeverities.has(requestedSeverity) ? requestedSeverity : "info";
  const occurredAt = normalizeText(source.occurredAt ?? source.at ?? source.timestamp, now, { maxLength: 40 });
  const summary = normalizeText(source.summary ?? source.title ?? source.message, null, { maxLength: 240 });
  const fullContent = normalizeText(source.content ?? source.body ?? source.transcript, null, { maxLength: 1200 });
  const metadata = normalizeMetadata(source.metadata ?? source.tags, settings.captureLevel);
  const rejectedReasons = [];
  const warnings = [];

  if (source.type !== undefined && type !== requestedType) {
    warnings.push(`episodes[${index}].type was normalized to interaction`);
  }
  if (source.severity !== undefined && severity !== requestedSeverity) {
    warnings.push(`episodes[${index}].severity was normalized to info`);
  }
  if (!summary && settings.captureLevel !== "full") {
    rejectedReasons.push("summary-required");
  }
  if (settings.captureLevel === "full" && !summary && !fullContent) {
    rejectedReasons.push("content-required");
  }

  const accepted = rejectedReasons.length === 0;
  const capture = {
    summary: summary || (settings.captureLevel === "full" ? fullContent?.slice(0, 240) || null : null),
    metadata,
    content: settings.captureLevel === "full" ? fullContent : null,
    redacted: settings.captureLevel !== "full" && Boolean(fullContent)
  };

  return {
    contract: "episodic-log.episode-record.v1",
    episodeId,
    type,
    severity,
    occurredAt,
    accepted,
    rejectedReasons,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    projectId: tenantBoundary.projectId,
    capture,
    proofToken: proofTokenFor({
      episodeId,
      type,
      severity,
      occurredAt,
      summary: capture.summary,
      metadata,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId
    }),
    warnings
  };
}

function buildDuplicateEpisodeIndex(records) {
  const occurrences = new Map();
  for (const [index, record] of records.entries()) {
    const current = occurrences.get(record.episodeId) || [];
    current.push(index);
    occurrences.set(record.episodeId, current);
  }

  return [...occurrences.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([episodeId, indexes]) => ({
      episodeId,
      firstIndex: indexes[0],
      duplicateIndexes: indexes.slice(1),
      occurrenceCount: indexes.length
    }));
}

function applyEpisodeIdentityGuards(records) {
  const duplicateEpisodeIds = buildDuplicateEpisodeIndex(records);
  const duplicateIndexes = new Map();

  for (const duplicate of duplicateEpisodeIds) {
    for (const index of duplicate.duplicateIndexes) {
      duplicateIndexes.set(index, duplicate.episodeId);
    }
  }

  if (duplicateIndexes.size === 0) {
    return {
      records,
      duplicateEpisodeIds,
      warnings: []
    };
  }

  const guardedRecords = records.map((record, index) => {
    const duplicateEpisodeId = duplicateIndexes.get(index);
    if (!duplicateEpisodeId) return record;

    const rejectedReasons = [...record.rejectedReasons];
    if (!rejectedReasons.includes("duplicate-episode-id")) {
      rejectedReasons.push("duplicate-episode-id");
    }

    return {
      ...record,
      accepted: false,
      rejectedReasons,
      identityConflict: {
        episodeId: duplicateEpisodeId,
        firstAcceptedIndex: records.findIndex((candidate) => candidate.episodeId === duplicateEpisodeId),
        duplicateIndex: index,
        disposition: "rejected-duplicate"
      },
      proofToken: proofTokenFor({
        previousProofToken: record.proofToken,
        episodeId: record.episodeId,
        duplicateIndex: index,
        rejectedReasons
      })
    };
  });

  return {
    records: guardedRecords,
    duplicateEpisodeIds,
    warnings: duplicateEpisodeIds.map((duplicate) => (
      `episodeId "${duplicate.episodeId}" appeared ${duplicate.occurrenceCount} times; duplicate records were rejected`
    ))
  };
}

function normalizeEpisodeEnvelope(input, settings, tenantBoundary, now) {
  const source = Array.isArray(input.episodes)
    ? input.episodes
    : Array.isArray(input.episodicLog?.episodes)
      ? input.episodicLog.episodes
      : Array.isArray(input.logEntries)
        ? input.logEntries
        : [];
  const warnings = [];
  const requestedCount = source.length;
  const normalizedRecords = source
    .slice(0, settings.maxEpisodesPerFlush)
    .map((entry, index) => normalizeEpisodeRecord(entry, index, settings, tenantBoundary, now));
  const identityGuard = applyEpisodeIdentityGuards(normalizedRecords);
  const records = identityGuard.records;
  const acceptedRecords = records.filter((record) => record.accepted);
  const rejectedRecords = records.filter((record) => !record.accepted);

  if (requestedCount > records.length) {
    warnings.push(`episodes were trimmed to maxEpisodesPerFlush (${settings.maxEpisodesPerFlush})`);
  }
  for (const record of records) {
    warnings.push(...record.warnings);
  }
  warnings.push(...identityGuard.warnings);

  return {
    contract: "episodic-log.ingest-envelope.v1",
    requestedCount,
    acceptedCount: acceptedRecords.length,
    rejectedCount: rejectedRecords.length,
    trimmedCount: Math.max(0, requestedCount - records.length),
    captureLevel: settings.captureLevel,
    tenantBoundary: tenantBoundary.handoffScope,
    identityGuard: {
      duplicateEpisodeIdCount: identityGuard.duplicateEpisodeIds.length,
      duplicateEpisodeIds: identityGuard.duplicateEpisodeIds,
      rejectedDuplicateCount: identityGuard.duplicateEpisodeIds.reduce((total, duplicate) => (
        total + duplicate.duplicateIndexes.length
      ), 0)
    },
    records,
    rejected: rejectedRecords.map((record) => ({
      episodeId: record.episodeId,
      reasons: record.rejectedReasons,
      identityConflict: record.identityConflict || null
    })),
    proofTokens: acceptedRecords.map((record) => record.proofToken),
    warnings
  };
}

function normalizeClientRuntime(input = {}) {
  const source = input.clientState || input.client || input.runtime || {};
  const clientSurface = allowedClientSurfaces.has(source.surface)
    ? source.surface
    : "kernel";
  const handoffTarget = allowedHandoffTargets.has(source.handoffTarget)
    ? source.handoffTarget
    : clientSurface === "scheduler"
      ? "scheduler"
      : "operator";
  const requestId = normalizeText(input.requestId ?? source.requestId, null, { maxLength: 80 });
  const sessionId = normalizeText(input.sessionId ?? source.sessionId, null, { maxLength: 80 });
  const actor = normalizeText(source.actor ?? input.actor, "hosted-kernel", { maxLength: 80 });
  const returnRoute = normalizeText(source.returnRoute ?? input.returnRoute, null, { maxLength: 160 });
  const resumeToken = normalizeText(source.resumeToken ?? input.resumeToken, null, { maxLength: 160 });
  const offline = normalizeBoolean(source.offline ?? input.offline, false);

  const warnings = [];
  if (source.surface !== undefined && !allowedClientSurfaces.has(source.surface)) {
    warnings.push(`client surface "${source.surface}" was normalized to kernel`);
  }
  if (source.handoffTarget !== undefined && !allowedHandoffTargets.has(source.handoffTarget)) {
    warnings.push(`handoff target "${source.handoffTarget}" was normalized to ${handoffTarget}`);
  }
  if ((input.requestId ?? source.requestId) !== undefined && requestId === null) {
    warnings.push("requestId was omitted because it was not a non-empty string");
  }
  if ((input.sessionId ?? source.sessionId) !== undefined && sessionId === null) {
    warnings.push("sessionId was omitted because it was not a non-empty string");
  }

  return {
    clientState: {
      clientSurface,
      handoffTarget,
      requestId,
      sessionId,
      actor,
      returnRoute,
      resumeToken,
      offline
    },
    warnings
  };
}

function normalizeRequestWorkflowState(input = {}, clientState, command, now) {
  const source = input.requestState || input.workflow || input.continuation || {};
  const requestedIntent = typeof source.intent === "string"
    ? source.intent.trim().toLowerCase()
    : typeof source.workflowIntent === "string"
      ? source.workflowIntent.trim().toLowerCase()
      : null;
  const inferredIntent = command === "flush"
    ? "flush"
    : command === "status"
      ? "inspect"
      : "preview";
  const intent = allowedWorkflowIntents.has(requestedIntent) ? requestedIntent : inferredIntent;
  const requestedPriority = typeof source.priority === "string" ? source.priority.trim().toLowerCase() : "normal";
  const priority = allowedWorkflowPriorities.has(requestedPriority) ? requestedPriority : "normal";
  const requestedReturnMode = typeof source.returnMode === "string"
    ? source.returnMode.trim().toLowerCase()
    : clientState.returnRoute || clientState.handoffTarget !== "operator"
      ? "callback"
      : "inline";
  const returnMode = allowedReturnModes.has(requestedReturnMode) ? requestedReturnMode : "inline";
  const correlationId = normalizeText(source.correlationId ?? source.traceId ?? input.correlationId, clientState.requestId, { maxLength: 120 });
  const parentRequestId = normalizeText(source.parentRequestId ?? source.parentId, null, { maxLength: 120 });
  const expectedRevision = source.expectedRevision === undefined && source.revisionPrecondition === undefined
    ? null
    : clampInteger(source.expectedRevision ?? source.revisionPrecondition, -1, { min: -1, max: 1000000000 });
  const expectedCursor = normalizeText(source.expectedCursor ?? source.cursorPrecondition, null, { maxLength: 180 });
  const clientCheckpoint = normalizeText(source.clientCheckpoint ?? source.checkpoint, null, { maxLength: 160 });
  const workflowDeadlineAt = normalizeText(source.deadlineAt ?? source.expiresAt, null, { maxLength: 40 });
  const userVisibleLabel = normalizeText(source.userVisibleLabel ?? source.label, null, { maxLength: 120 });
  const warnings = [];

  if ((source.intent ?? source.workflowIntent) !== undefined && !allowedWorkflowIntents.has(requestedIntent)) {
    warnings.push(`workflow intent "${source.intent ?? source.workflowIntent}" was normalized to ${intent}`);
  }
  if (source.priority !== undefined && priority !== requestedPriority) {
    warnings.push(`workflow priority "${source.priority}" was normalized to normal`);
  }
  if (source.returnMode !== undefined && returnMode !== requestedReturnMode) {
    warnings.push(`workflow returnMode "${source.returnMode}" was normalized to inline`);
  }
  if ((source.expectedRevision ?? source.revisionPrecondition) !== undefined && expectedRevision === -1) {
    warnings.push("workflow expectedRevision was omitted because it was not a supported non-negative revision");
  }
  if ((source.expectedCursor ?? source.cursorPrecondition) !== undefined && expectedCursor === null) {
    warnings.push("workflow expectedCursor was omitted because it was not a non-empty string");
  }

  const continuationKey = [
    surfaceId,
    clientState.sessionId || "session",
    correlationId || clientState.requestId || "request",
    intent
  ].join(":");

  return {
    contract: "episodic-log.request-workflow-state.v1",
    intent,
    priority,
    returnMode,
    correlationId,
    parentRequestId,
    continuationKey,
    clientCheckpoint,
    workflowDeadlineAt,
    userVisibleLabel,
    preconditions: {
      expectedRevision: expectedRevision === -1 ? null : expectedRevision,
      expectedCursor
    },
    proofToken: proofTokenFor({
      continuationKey,
      intent,
      priority,
      returnMode,
      expectedRevision,
      expectedCursor,
      clientCheckpoint,
      generatedAt: now
    }),
    warnings
  };
}

function hasSettingsMutation(input = {}) {
  return Object.keys(input.settings || {}).length > 0;
}

function normalizeActorRole(value, clientSurface) {
  if (allowedActorRoles.has(value)) return value;
  if (clientSurface === "scheduler") return "scheduler";
  if (clientSurface === "kernel") return "kernel";
  return "viewer";
}

function buildTenantBoundary(input, command, settings, clientState) {
  const source = input.workspace || input.scope || input.tenant || {};
  const requestedRole = source.actorRole ?? source.role ?? input.actorRole ?? input.role;
  const actorRole = normalizeActorRole(requestedRole, clientState.clientSurface);
  const tenantId = normalizeText(source.tenantId ?? input.tenantId, null, { maxLength: 96 });
  const workspaceId = normalizeText(source.workspaceId ?? input.workspaceId, null, { maxLength: 96 });
  const projectId = normalizeText(source.projectId ?? input.projectId, null, { maxLength: 96 });
  const isolationMode = allowedIsolationModes.has(source.isolationMode)
    ? source.isolationMode
    : workspaceId
      ? "workspace"
      : tenantId
        ? "tenant"
        : "session";
  const crossTenantRequested = normalizeBoolean(source.crossTenant ?? input.crossTenant, false);
  const mutationRequested = command !== "status" || hasSettingsMutation(input);
  const allowedRoles = commandRoleMatrix[command] || commandRoleMatrix.status;
  const blockers = [];
  const warnings = [];

  if (requestedRole !== undefined && actorRole !== requestedRole) {
    warnings.push(`actor role "${requestedRole}" was normalized to ${actorRole}`);
  }
  if ((source.tenantId ?? input.tenantId) !== undefined && tenantId === null) {
    warnings.push("tenantId was omitted because it was not a non-empty string");
  }
  if ((source.workspaceId ?? input.workspaceId) !== undefined && workspaceId === null) {
    warnings.push("workspaceId was omitted because it was not a non-empty string");
  }
  if (source.isolationMode !== undefined && !allowedIsolationModes.has(source.isolationMode)) {
    warnings.push("isolationMode was normalized to the safest available scope");
  }
  if (crossTenantRequested) {
    blockers.push("cross-tenant-boundary-denied");
  }
  if (mutationRequested && !tenantId) {
    blockers.push("tenant-id-required");
  }
  if (mutationRequested && isolationMode === "workspace" && !workspaceId) {
    blockers.push("workspace-id-required");
  }
  if (mutationRequested && !allowedRoles.has(actorRole)) {
    blockers.push(`role-${actorRole}-cannot-${command}`);
  }
  if (mutationRequested && settings.captureLevel === "full" && !["maintainer", "kernel"].includes(actorRole)) {
    blockers.push("full-capture-requires-maintainer");
  }

  return {
    contract: "episodic-log.tenant-boundary.v1",
    tenantId,
    workspaceId,
    projectId,
    isolationMode,
    actorRole,
    mutationRequested,
    crossTenantRequested,
    permission: {
      command,
      allowed: blockers.length === 0,
      allowedRoles: [...allowedRoles],
      deniedReasons: blockers
    },
    handoffScope: {
      tenantId,
      workspaceId,
      projectId,
      isolationMode,
      actorRole
    },
    warnings,
    blockers
  };
}

function applyLifecycleCommand(command, settings) {
  if (command === "enable" || command === "resume") {
    return { ...settings, enabled: true };
  }
  if (command === "disable" || command === "pause") {
    return { ...settings, enabled: false };
  }
  return settings;
}

function normalizeLifecycleControls(input = {}, command, settings, failureState, now) {
  const rawSource = input.lifecycleControls || input.controls || input.lifecycle || {};
  const source = rawSource && typeof rawSource === "object" && !Array.isArray(rawSource) ? rawSource : {};
  const requestedState = typeof source.state === "string" ? source.state.trim().toLowerCase() : null;
  const commandState = command === "disable"
    ? "disabled"
    : command === "pause"
      ? "paused"
      : command === "enable" || command === "resume"
        ? "enabled"
        : null;
  const state = commandState || (allowedLifecycleStates.has(requestedState)
    ? requestedState
    : settings.enabled
      ? "enabled"
      : "disabled");
  const requestedReason = typeof source.reason === "string"
    ? source.reason.trim().toLowerCase()
    : typeof source.pauseReason === "string"
      ? source.pauseReason.trim().toLowerCase()
      : null;
  const reason = allowedLifecycleReasons.has(requestedReason)
    ? requestedReason
    : state === "paused" || state === "suspended"
      ? failureState.status === "healthy"
        ? "operator-request"
        : "failure-backoff"
      : null;
  const automaticFlushAllowed = normalizeBoolean(source.automaticFlushAllowed ?? source.allowAutomaticFlush, true);
  const manualFlushAllowed = normalizeBoolean(source.manualFlushAllowed ?? source.allowManualFlush, true);
  const scheduleSuspended = normalizeBoolean(source.scheduleSuspended ?? source.suspendSchedule, state === "suspended");
  const manualFlushToken = normalizeText(source.manualFlushToken ?? source.flushToken, null, { maxLength: 120 });
  const maintenanceStartsAt = normalizeTimestamp(source.maintenanceStartsAt ?? source.windowStart);
  const maintenanceEndsAt = normalizeTimestamp(source.maintenanceEndsAt ?? source.windowEnd);
  const resumeAt = normalizeTimestamp(source.resumeAt);
  const requestedNextFlushAt = source.nextFlushAt ?? source.nextScheduledFlushAt ?? source.scheduledFlushAt;
  const nextScheduledFlushAt = normalizeTimestamp(requestedNextFlushAt);
  const minFlushLeadSeconds = clampInteger(source.minFlushLeadSeconds ?? source.flushLeadSeconds, 0, { min: 0, max: 86400 });
  const scheduleDriftGraceMinutes = clampInteger(source.scheduleDriftGraceMinutes ?? source.driftGraceMinutes, 5, { min: 0, max: 1440 });
  const allowEarlyFlush = normalizeBoolean(source.allowEarlyFlush, true);
  const nowMs = Date.parse(now);
  const nextFlushMs = nextScheduledFlushAt ? Date.parse(nextScheduledFlushAt) : null;
  const earliestFlushAt = nextScheduledFlushAt && minFlushLeadSeconds > 0
    ? addSecondsToTimestamp(nextScheduledFlushAt, -minFlushLeadSeconds)
    : nextScheduledFlushAt;
  const earliestFlushMs = earliestFlushAt ? Date.parse(earliestFlushAt) : null;
  const scheduleHealth = scheduleSuspended || state === "suspended"
    ? "suspended"
    : settings.scheduleMode === "manual"
      ? manualFlushToken
        ? "manual-ready"
        : "manual-awaiting-token"
      : settings.scheduleMode === "idle"
        ? "idle-awaiting-host"
        : nextFlushMs === null
          ? "interval-unplanned"
          : nextFlushMs <= nowMs
            ? "due-now"
            : nextFlushMs - nowMs > (settings.flushIntervalMinutes + scheduleDriftGraceMinutes) * 60 * 1000
              ? "deferred-beyond-interval"
              : "scheduled";
  const blockers = [];
  const warnings = [];

  if (source.state !== undefined && !allowedLifecycleStates.has(requestedState)) {
    warnings.push(`lifecycle state "${source.state}" was normalized to ${state}`);
  }
  if ((source.reason ?? source.pauseReason) !== undefined && reason !== requestedReason) {
    warnings.push(`lifecycle reason "${source.reason ?? source.pauseReason}" was normalized to ${reason || "none"}`);
  }
  if (requestedNextFlushAt !== undefined && !nextScheduledFlushAt) {
    warnings.push("next scheduled flush timestamp was omitted because it was not parseable");
  }
  if ((source.minFlushLeadSeconds ?? source.flushLeadSeconds) !== undefined && minFlushLeadSeconds !== Number(source.minFlushLeadSeconds ?? source.flushLeadSeconds)) {
    warnings.push("minFlushLeadSeconds was normalized to the supported 0-86400 second range");
  }
  if ((source.scheduleDriftGraceMinutes ?? source.driftGraceMinutes) !== undefined && scheduleDriftGraceMinutes !== Number(source.scheduleDriftGraceMinutes ?? source.driftGraceMinutes)) {
    warnings.push("scheduleDriftGraceMinutes was normalized to the supported 0-1440 minute range");
  }
  if (state === "disabled" && !["enable", "resume", "status", "disable"].includes(command)) {
    blockers.push("lifecycle-disabled");
  }
  if (state === "paused" && !["enable", "resume", "status", "pause"].includes(command)) {
    blockers.push("lifecycle-paused");
  }
  if (scheduleSuspended && command !== "flush") {
    blockers.push("schedule-suspended");
  }
  if (!manualFlushAllowed && command === "flush") {
    blockers.push("manual-flush-disabled");
  }
  if (!automaticFlushAllowed && settings.scheduleMode !== "manual" && command !== "flush") {
    blockers.push("automatic-flush-disabled");
  }
  if (settings.scheduleMode === "manual" && command !== "flush" && !manualFlushToken) {
    warnings.push("manual scheduling is active without a manualFlushToken");
  }
  if (settings.scheduleMode === "interval" && scheduleHealth === "interval-unplanned" && command !== "flush") {
    warnings.push("interval scheduling is active without a nextScheduledFlushAt control");
  }
  if (settings.scheduleMode === "interval" && scheduleHealth === "deferred-beyond-interval") {
    warnings.push("next scheduled flush is beyond the configured interval plus drift grace");
  }
  if (command === "flush" && !allowEarlyFlush && earliestFlushMs !== null && nowMs < earliestFlushMs) {
    blockers.push("flush-before-scheduled-window");
  }
  if (reason === "maintenance-window" && !maintenanceStartsAt && !maintenanceEndsAt) {
    warnings.push("maintenance lifecycle reason was provided without a maintenance window");
  }

  return {
    contract: "episodic-log.lifecycle-controls.v1",
    state,
    commandEffect: {
      command,
      requestedState: requestedState || null,
      appliedState: state,
      settingsEnabled: settings.enabled
    },
    flushPermissions: {
      automaticAllowed: automaticFlushAllowed,
      manualAllowed: manualFlushAllowed,
      canRunFlush: settings.enabled && state === "enabled" && manualFlushAllowed
    },
    scheduleControls: {
      mode: settings.scheduleMode,
      suspended: scheduleSuspended,
      automaticAllowed: automaticFlushAllowed,
      intervalMinutes: settings.scheduleMode === "interval" ? settings.flushIntervalMinutes : null,
      manualFlushToken,
      resumeAt,
      nextScheduledFlushAt,
      earliestFlushAt,
      minFlushLeadSeconds,
      scheduleDriftGraceMinutes,
      allowEarlyFlush,
      scheduleHealth
    },
    maintenanceWindow: {
      startsAt: maintenanceStartsAt,
      endsAt: maintenanceEndsAt
    },
    reason,
    nextControlRoute: `${surfaceGroup}/${surfaceName}/lifecycle/${state}`,
    proofToken: proofTokenFor({
      state,
      command,
      reason,
      automaticFlushAllowed,
      manualFlushAllowed,
      scheduleSuspended,
      manualFlushToken,
      nextScheduledFlushAt,
      earliestFlushAt,
      scheduleHealth,
      resumeAt,
      generatedAt: now
    }),
    blockers,
    warnings
  };
}

function buildNextAction(command, settings, now, lifecycleControls) {
  if (lifecycleControls.blockers.includes("flush-before-scheduled-window")) {
    return {
      state: "blocked",
      action: "await-scheduled-flush-window",
      dueAt: lifecycleControls.scheduleControls.earliestFlushAt,
      reason: "early flush is disabled until the configured scheduling lead window opens"
    };
  }
  if (lifecycleControls.state === "paused") {
    return {
      state: "paused",
      action: "await-resume",
      dueAt: lifecycleControls.scheduleControls.resumeAt,
      reason: `episodic log lifecycle is paused for ${lifecycleControls.reason || "operator review"}`
    };
  }
  if (lifecycleControls.state === "suspended" || lifecycleControls.scheduleControls.suspended) {
    return {
      state: "suspended",
      action: "await-schedule-resume",
      dueAt: lifecycleControls.scheduleControls.resumeAt,
      reason: "episodic log scheduling is suspended"
    };
  }
  if (!settings.enabled) {
    return {
      state: "disabled",
      action: "await-enable",
      dueAt: null,
      reason: `${surfaceName} lifecycle is disabled`
    };
  }
  if (!lifecycleControls.flushPermissions.manualAllowed && command === "flush") {
    return {
      state: "blocked",
      action: "enable-manual-flush",
      dueAt: null,
      reason: "manual flush is disabled by lifecycle controls"
    };
  }
  if (command === "flush") {
    return {
      state: "ready",
      action: "flush-episodic-buffer",
      dueAt: now,
      reason: "operator requested an immediate episodic log flush"
    };
  }
  if (!lifecycleControls.flushPermissions.automaticAllowed) {
    return {
      state: "armed",
      action: "await-manual-flush",
      dueAt: null,
      reason: "automatic flushing is disabled by lifecycle controls"
    };
  }
  if (settings.scheduleMode === "manual") {
    return {
      state: "armed",
      action: "await-manual-flush",
      dueAt: null,
      reason: lifecycleControls.scheduleControls.manualFlushToken
        ? "manual scheduling is armed with an operator flush token"
        : "manual scheduling is active"
    };
  }
  if (settings.scheduleMode === "idle") {
    return {
      state: "armed",
      action: "flush-on-host-idle",
      dueAt: null,
      reason: "idle scheduling is active"
    };
  }

  if (lifecycleControls.scheduleControls.scheduleHealth === "due-now") {
    return {
      state: "ready",
      action: "flush-episodic-buffer",
      dueAt: now,
      reason: "scheduled episodic flush is due"
    };
  }

  const dueAt = lifecycleControls.scheduleControls.nextScheduledFlushAt
    || new Date(Date.parse(now) + settings.flushIntervalMinutes * 60 * 1000).toISOString();
  return {
    state: "scheduled",
    action: "flush-episodic-buffer",
    dueAt,
    reason: `interval scheduling is active every ${settings.flushIntervalMinutes} minutes`
  };
}

function buildLifecycleCommandPlan(input = {}, command, baseSettings, effectiveSettings, lifecycleControls, nextAction, now) {
  const rawSource = input.lifecycleCommandPlan || input.commandPlan || input.scheduler || input.scheduleControls || {};
  const source = rawSource && typeof rawSource === "object" && !Array.isArray(rawSource) ? rawSource : {};
  const explicitDesiredEnabled = source.desiredEnabled ?? source.targetEnabled ?? source.enabled;
  const desiredEnabled = normalizeBoolean(explicitDesiredEnabled, effectiveSettings.enabled);
  const explicitDrain = source.drainBeforeDisable ?? source.drainBuffer;
  const drainBeforeDisable = normalizeBoolean(explicitDrain, command === "disable");
  const flushBeforeHold = normalizeBoolean(source.flushBeforePause ?? source.flushBeforeDisable ?? source.flushBeforeHold, false);
  const requireManualFlushToken = normalizeBoolean(source.requireManualFlushToken, false);
  const allowPendingDrop = normalizeBoolean(source.allowPendingDrop ?? source.allowDrop, false);
  const pendingEpisodes = clampInteger(source.pendingEpisodes ?? source.pendingFlushCount, 0, { min: 0, max: 1000000 });
  const maxDeferredFlushes = clampInteger(source.maxDeferredFlushes, 3, { min: 0, max: 20 });
  const requestedControlMode = typeof source.controlMode === "string" ? source.controlMode.trim().toLowerCase() : "operator";
  const controlMode = ["operator", "automatic", "maintenance", "recovery"].includes(requestedControlMode)
    ? requestedControlMode
    : "operator";
  const blockers = [];
  const warnings = [];

  if (explicitDesiredEnabled !== undefined && desiredEnabled !== effectiveSettings.enabled) {
    warnings.push("lifecycle command plan desiredEnabled differs from the command-adjusted setting");
  }
  if (source.controlMode !== undefined && controlMode !== requestedControlMode) {
    warnings.push(`lifecycle command plan controlMode "${source.controlMode}" was normalized to operator`);
  }
  if ((source.pendingEpisodes ?? source.pendingFlushCount) !== undefined && pendingEpisodes !== Number(source.pendingEpisodes ?? source.pendingFlushCount)) {
    warnings.push("lifecycle command plan pendingEpisodes was normalized to the supported non-negative range");
  }
  if (source.maxDeferredFlushes !== undefined && maxDeferredFlushes !== Number(source.maxDeferredFlushes)) {
    warnings.push("lifecycle command plan maxDeferredFlushes was normalized to the supported 0-20 range");
  }

  if (command === "disable" && drainBeforeDisable && pendingEpisodes > 0 && !allowPendingDrop) {
    blockers.push("disable-drain-requires-flush");
  }
  if (["disable", "pause"].includes(command) && flushBeforeHold && !lifecycleControls.flushPermissions.manualAllowed) {
    blockers.push("hold-flush-requested-but-manual-flush-disabled");
  }
  if (requireManualFlushToken && effectiveSettings.scheduleMode === "manual" && !lifecycleControls.scheduleControls.manualFlushToken) {
    blockers.push("manual-schedule-token-required");
  }
  if (effectiveSettings.scheduleMode === "interval" && lifecycleControls.scheduleControls.scheduleHealth === "interval-unplanned" && controlMode === "automatic") {
    blockers.push("automatic-interval-control-requires-next-flush");
  }
  if (effectiveSettings.scheduleMode === "interval" && lifecycleControls.scheduleControls.scheduleHealth === "deferred-beyond-interval" && !allowPendingDrop) {
    blockers.push("interval-schedule-outside-drift-budget");
  }
  if (controlMode === "automatic" && !lifecycleControls.flushPermissions.automaticAllowed && command !== "flush") {
    blockers.push("automatic-control-requires-automatic-flush");
  }
  if (controlMode === "maintenance" && lifecycleControls.reason !== "maintenance-window") {
    blockers.push("maintenance-control-requires-maintenance-reason");
  }
  if (pendingEpisodes > effectiveSettings.maxEpisodesPerFlush * Math.max(1, maxDeferredFlushes) && command !== "flush") {
    warnings.push("pending lifecycle backlog exceeds the configured deferred flush budget");
  }

  const fromState = baseSettings.enabled ? "enabled" : "disabled";
  const toState = lifecycleControls.state;
  const transition = fromState === toState
    ? "no-op"
    : `${fromState}-to-${toState}`;
  const commandDisposition = blockers.length > 0
    ? "blocked"
    : command === "status"
      ? "observe"
      : command === "flush"
        ? "execute-flush"
        : command === "disable" && drainBeforeDisable && pendingEpisodes > 0
          ? "flush-then-disable"
          : command === "pause" && flushBeforeHold
            ? "flush-then-pause"
            : "apply-lifecycle-command";
  const scheduleGate = blockers.length > 0
    ? "blocked"
    : lifecycleControls.scheduleControls.suspended
      ? "suspended"
      : nextAction.state === "scheduled"
        ? "scheduled"
        : nextAction.action === "await-manual-flush"
          ? "manual"
          : nextAction.action === "flush-on-host-idle"
            ? "idle"
            : "open";

  return {
    contract: "episodic-log.lifecycle-command-plan.v1",
    generatedAt: now,
    command,
    controlMode,
    transition,
    disposition: commandDisposition,
    desiredEnabled,
    previousSettings: {
      enabled: baseSettings.enabled,
      scheduleMode: baseSettings.scheduleMode,
      flushIntervalMinutes: baseSettings.flushIntervalMinutes,
      captureLevel: baseSettings.captureLevel
    },
    targetSettings: {
      enabled: effectiveSettings.enabled,
      scheduleMode: effectiveSettings.scheduleMode,
      flushIntervalMinutes: effectiveSettings.flushIntervalMinutes,
      captureLevel: effectiveSettings.captureLevel
    },
    safeguards: {
      drainBeforeDisable,
      flushBeforeHold,
      requireManualFlushToken,
      allowPendingDrop,
      pendingEpisodes,
      maxDeferredFlushes
    },
    scheduleGate: {
      status: scheduleGate,
      mode: effectiveSettings.scheduleMode,
      dueAt: nextAction.dueAt,
      nextScheduledFlushAt: lifecycleControls.scheduleControls.nextScheduledFlushAt,
      earliestFlushAt: lifecycleControls.scheduleControls.earliestFlushAt,
      scheduleHealth: lifecycleControls.scheduleControls.scheduleHealth,
      driftGraceMinutes: lifecycleControls.scheduleControls.scheduleDriftGraceMinutes,
      earlyFlushAllowed: lifecycleControls.scheduleControls.allowEarlyFlush,
      manualFlushToken: lifecycleControls.scheduleControls.manualFlushToken,
      automaticAllowed: lifecycleControls.flushPermissions.automaticAllowed,
      manualAllowed: lifecycleControls.flushPermissions.manualAllowed
    },
    route: `${surfaceGroup}/${surfaceName}/lifecycle/${commandDisposition}`,
    proofToken: proofTokenFor({
      command,
      controlMode,
      transition,
      commandDisposition,
      desiredEnabled,
      pendingEpisodes,
      scheduleGate,
      scheduleHealth: lifecycleControls.scheduleControls.scheduleHealth,
      nextScheduledFlushAt: lifecycleControls.scheduleControls.nextScheduledFlushAt,
      generatedAt: now
    }),
    blockers,
    warnings
  };
}

function normalizeFailureCode(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowedFailureCodes.has(normalized) ? normalized : "backend-unreachable";
}

function normalizeFailureState(input = {}, clientState) {
  const source = input.failureState || input.failure || input.health || {};
  const requestedStatus = typeof source.status === "string" ? source.status.trim().toLowerCase() : null;
  const status = allowedHealthStates.has(requestedStatus)
    ? requestedStatus
    : clientState.offline
      ? "offline"
      : "healthy";
  const retryAfterSeconds = clampInteger(source.retryAfterSeconds, 0, { min: 0, max: 3600 });
  const consecutiveFailures = clampInteger(source.consecutiveFailures, 0, { min: 0, max: 50 });
  const queueDepth = clampInteger(source.queueDepth, 0, { min: 0, max: 100000 });
  const lastFailureAt = normalizeText(source.lastFailureAt, null, { maxLength: 40 });
  const lastSuccessAt = normalizeText(source.lastSuccessAt, null, { maxLength: 40 });
  const failureCode = status === "healthy" ? null : normalizeFailureCode(source.code || source.failureCode);
  const message = normalizeText(source.message, null, { maxLength: 180 });
  const warnings = [];

  if (source.status !== undefined && !allowedHealthStates.has(requestedStatus)) {
    warnings.push(`health status "${source.status}" was normalized to ${status}`);
  }
  if (source.code !== undefined && failureCode !== source.code) {
    warnings.push(`failure code "${source.code}" was normalized to ${failureCode}`);
  }
  if (source.retryAfterSeconds !== undefined && retryAfterSeconds !== Number(source.retryAfterSeconds)) {
    warnings.push("retryAfterSeconds was normalized to the supported 0-3600 second range");
  }
  if (source.consecutiveFailures !== undefined && consecutiveFailures !== Number(source.consecutiveFailures)) {
    warnings.push("consecutiveFailures was normalized to the supported 0-50 range");
  }
  if (source.queueDepth !== undefined && queueDepth !== Number(source.queueDepth)) {
    warnings.push("queueDepth was normalized to the supported 0-100000 range");
  }

  return {
    status,
    failureCode,
    message,
    retryAfterSeconds,
    consecutiveFailures,
    queueDepth,
    lastFailureAt,
    lastSuccessAt,
    warnings
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry, index, all) => entry && all.indexOf(entry) === index);
}

function normalizeScopeAllowList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeText(entry, null, { maxLength: 96 }))
    .filter((entry, index, all) => entry && all.indexOf(entry) === index);
}

function normalizeProviderContract(input = {}, settings, clientState) {
  const source = input.provider || input.serviceProvider || input.storageProvider || {};
  const requestedKind = typeof source.kind === "string" ? source.kind.trim().toLowerCase() : "hosted-kernel";
  const kind = allowedProviderKinds.has(requestedKind) ? requestedKind : "hosted-kernel";
  const requestedState = typeof source.state === "string" ? source.state.trim().toLowerCase() : null;
  const state = allowedProviderStates.has(requestedState)
    ? requestedState
    : clientState.offline
      ? "offline"
      : "connected";
  const requestedConsistency = typeof source.consistencyLevel === "string"
    ? source.consistencyLevel.trim().toLowerCase()
    : "session";
  const consistencyLevel = allowedConsistencyLevels.has(requestedConsistency)
    ? requestedConsistency
    : "session";
  const providerId = normalizeText(source.providerId ?? source.id, `${kind}:default`, { maxLength: 120 });
  const endpoint = normalizeText(source.endpoint ?? source.route, `${surfaceGroup}/${surfaceName}/provider`, { maxLength: 180 });
  const syncCursor = normalizeText(source.syncCursor ?? source.cursor, null, { maxLength: 180 });
  const acknowledgedCursor = normalizeText(source.acknowledgedCursor ?? source.ackedCursor, null, { maxLength: 180 });
  const reportedCapabilities = normalizeStringList(source.capabilities);
  const capabilities = reportedCapabilities.length > 0
    ? reportedCapabilities.filter((capability) => allowedProviderCapabilities.has(capability))
    : [
        "append-episodes",
        "flush-buffer",
        "retention-policy",
        "proof-export",
        "workspace-isolation",
        ...(settings.captureLevel === "full" ? ["full-capture"] : []),
        ...(clientState.handoffTarget !== "operator" || clientState.returnRoute ? ["external-handoff"] : [])
      ];
  const warnings = [];

  if (source.kind !== undefined && kind !== requestedKind) {
    warnings.push(`provider kind "${source.kind}" was normalized to hosted-kernel`);
  }
  if (source.state !== undefined && state !== requestedState) {
    warnings.push(`provider state "${source.state}" was normalized to ${state}`);
  }
  if (source.consistencyLevel !== undefined && consistencyLevel !== requestedConsistency) {
    warnings.push(`provider consistencyLevel "${source.consistencyLevel}" was normalized to session`);
  }
  if (reportedCapabilities.some((capability) => !allowedProviderCapabilities.has(capability))) {
    warnings.push("unsupported provider capabilities were ignored during negotiation");
  }

  return {
    contract: "episodic-log.provider-contract.v1",
    providerId,
    kind,
    state,
    endpoint,
    consistencyLevel,
    capabilities,
    sync: {
      cursor: syncCursor,
      acknowledgedCursor,
      pendingAcknowledgement: Boolean(syncCursor && syncCursor !== acknowledgedCursor)
    },
    warnings
  };
}

function normalizePersistedState(input = {}, command, settings, tenantBoundary, clientState, providerContract, now) {
  const source = input.persistedState || input.durableState || input.state || {};
  const recoverySource = input.recovery || input.recoveryState || source.recovery || {};
  const workflowSource = input.requestState || input.workflow || input.continuation || {};
  const requestedCommandKey = input.idempotencyKey ?? source.idempotencyKey ?? source.lastCommandKey ?? clientState.requestId;
  const commandKey = normalizeText(requestedCommandKey, null, { maxLength: 160 });
  const lastCommandKey = normalizeText(source.lastCommandKey ?? source.commandKey, null, { maxLength: 160 });
  const lastAppliedCommand = normalizeCommand(source.lastAppliedCommand ?? source.command);
  const requestedCommandStatus = typeof source.lastCommandStatus === "string"
    ? source.lastCommandStatus.trim().toLowerCase()
    : typeof source.commandStatus === "string"
      ? source.commandStatus.trim().toLowerCase()
      : null;
  const lastCommandStatus = allowedPersistedCommandStatuses.has(requestedCommandStatus)
    ? requestedCommandStatus
    : source.failed === true
      ? "failed"
      : source.applied === true || ["committed", "flushed"].includes(source.phase)
        ? "applied"
        : "pending";
  const requestedPhase = typeof source.phase === "string" ? source.phase.trim().toLowerCase() : "new";
  const phase = allowedPersistedPhases.has(requestedPhase) ? requestedPhase : "new";
  const revision = clampInteger(source.revision, 0, { min: 0, max: 1000000000 });
  const recoveryEpoch = clampInteger(recoverySource.epoch ?? source.recoveryEpoch, 0, { min: 0, max: 1000000 });
  const lastRecoveredRevision = clampInteger(recoverySource.lastRecoveredRevision, -1, { min: -1, max: 1000000000 });
  const lastCommittedAt = normalizeText(source.lastCommittedAt ?? source.committedAt, null, { maxLength: 40 });
  const lastFlushedAt = normalizeText(source.lastFlushedAt ?? source.flushedAt, null, { maxLength: 40 });
  const recoveredAt = normalizeText(recoverySource.recoveredAt ?? source.recoveredAt, null, { maxLength: 40 });
  const pendingFlushCount = clampInteger(source.pendingFlushCount ?? source.pendingEpisodes, 0, { min: 0, max: 1000000 });
  const pendingAckCursor = normalizeText(source.pendingAckCursor ?? source.pendingAcknowledgementCursor, null, { maxLength: 180 });
  const committedCursor = normalizeText(source.committedCursor ?? source.cursor, providerContract.sync.acknowledgedCursor, { maxLength: 180 });
  const dirty = normalizeBoolean(source.dirty ?? source.needsRecovery, false);
  const recoveryRequested = normalizeBoolean(recoverySource.requested, false)
    || ["recover", "recovery"].includes(typeof workflowSource.intent === "string" ? workflowSource.intent.trim().toLowerCase() : "")
    || ["recover", "recovery"].includes(typeof workflowSource.workflowIntent === "string" ? workflowSource.workflowIntent.trim().toLowerCase() : "");
  const mutationCommand = command !== "status" || hasSettingsMutation(input);
  const sameCommandKey = Boolean(commandKey && lastCommandKey && commandKey === lastCommandKey);
  const duplicateCommand = sameCommandKey && command === lastAppliedCommand && lastCommandStatus === "applied";
  const commandKeyConflict = sameCommandKey && command !== lastAppliedCommand && lastCommandStatus !== "rolled-back";
  const shouldRecover = dirty
    || phase === "failed"
    || lastCommandStatus === "failed"
    || Boolean(pendingAckCursor && pendingAckCursor !== committedCursor);
  const restartSafeStatus = shouldRecover
    ? recoveryRequested
      ? "recovery-ready"
      : "recovery-required"
    : commandKeyConflict
      ? "idempotency-key-conflict"
    : duplicateCommand
      ? "idempotent-replay"
    : mutationCommand
      ? "ready-to-persist"
      : "status-only";
  const canApplyCommand = mutationCommand && !duplicateCommand && !commandKeyConflict && !shouldRecover && tenantBoundary.permission.allowed;
  const nextRevision = canApplyCommand ? revision + 1 : revision;
  const recoveryActions = [];
  if (dirty) {
    recoveryActions.push({
      id: "quarantine-dirty-write-intent",
      label: "Quarantine dirty write intent",
      route: `${surfaceGroup}/${surfaceName}/recovery/quarantine`,
      cursor: pendingAckCursor || committedCursor,
      requiredBeforeApply: true
    });
  }
  if (phase === "failed" || lastCommandStatus === "failed") {
    recoveryActions.push({
      id: "replay-or-rollback-last-command",
      label: "Replay or roll back last command",
      route: `${surfaceGroup}/${surfaceName}/recovery/replay`,
      command: lastAppliedCommand,
      commandKey: lastCommandKey,
      requiredBeforeApply: true
    });
  }
  if (pendingAckCursor && pendingAckCursor !== committedCursor) {
    recoveryActions.push({
      id: "acknowledge-pending-provider-cursor",
      label: "Acknowledge pending provider cursor",
      route: `${surfaceGroup}/${surfaceName}/recovery/ack`,
      cursor: pendingAckCursor,
      committedCursor,
      requiredBeforeApply: true
    });
  }
  if (recoveryRequested && recoveryActions.length === 0) {
    recoveryActions.push({
      id: "return-restart-safe-state",
      label: "Return restart-safe state",
      route: `${surfaceGroup}/${surfaceName}/status`,
      cursor: committedCursor || providerContract.sync.cursor,
      requiredBeforeApply: false
    });
  }
  const stableSnapshot = {
    revision: nextRevision,
    phase: canApplyCommand
      ? command === "flush"
        ? "flushed"
        : "accepted"
      : phase,
    command,
    commandKey,
    providerId: providerContract.providerId,
    cursor: pendingAckCursor || committedCursor || providerContract.sync.cursor,
    tenantBoundary: tenantBoundary.handoffScope,
    persistedAt: canApplyCommand ? now : null
  };
  const storageKey = [
    surfaceId,
    tenantBoundary.tenantId || "session",
    tenantBoundary.workspaceId || tenantBoundary.isolationMode,
    tenantBoundary.projectId || "default"
  ].join(":");
  const warnings = [];

  if (source.phase !== undefined && !allowedPersistedPhases.has(requestedPhase)) {
    warnings.push(`persisted phase "${source.phase}" was normalized to new`);
  }
  if ((source.lastCommandStatus ?? source.commandStatus) !== undefined && !allowedPersistedCommandStatuses.has(requestedCommandStatus)) {
    warnings.push("persisted command status was normalized to pending");
  }
  if (source.revision !== undefined && revision !== Number(source.revision)) {
    warnings.push("persisted revision was normalized to the supported non-negative range");
  }
  if ((recoverySource.epoch ?? source.recoveryEpoch) !== undefined && recoveryEpoch !== Number(recoverySource.epoch ?? source.recoveryEpoch)) {
    warnings.push("recovery epoch was normalized to the supported non-negative range");
  }
  if (recoverySource.lastRecoveredRevision !== undefined && lastRecoveredRevision === -1) {
    warnings.push("lastRecoveredRevision was omitted because it was not a supported non-negative revision");
  }
  if (requestedCommandKey !== undefined && commandKey === null) {
    warnings.push("idempotencyKey was omitted because it was not a non-empty string");
  }
  if (commandKeyConflict) {
    warnings.push("idempotencyKey matches a different persisted command and was treated as a conflict");
  }
  if ((source.pendingFlushCount ?? source.pendingEpisodes) !== undefined && pendingFlushCount !== Number(source.pendingFlushCount ?? source.pendingEpisodes)) {
    warnings.push("pendingFlushCount was normalized to the supported non-negative range");
  }

  return {
    contract: "episodic-log.persisted-state.v1",
    storageKey,
    commandKey,
    duplicateCommand,
    commandKeyConflict,
    lastCommandKey,
    lastAppliedCommand,
    lastCommandStatus,
    phase,
    revision,
    nextRevision,
    restartSafeStatus,
    canApplyCommand,
    recovery: {
      required: shouldRecover,
      reason: shouldRecover
        ? dirty
          ? "persisted-state-dirty"
          : phase === "failed" || lastCommandStatus === "failed"
            ? "last-command-failed"
            : "provider-acknowledgement-pending"
        : null,
      recoveredAt,
      recoveryEpoch,
      lastRecoveredRevision: lastRecoveredRevision === -1 ? null : lastRecoveredRevision,
      resumeCursor: pendingAckCursor || committedCursor || providerContract.sync.cursor,
      route: `${surfaceGroup}/${surfaceName}/recovery`,
      actions: recoveryActions,
      canResume: shouldRecover && providerContract.state !== "offline" && recoveryActions.length > 0,
      requested: recoveryRequested
    },
    pending: {
      flushCount: pendingFlushCount,
      ackCursor: pendingAckCursor,
      committedCursor,
      hasUncommittedCursor: Boolean(pendingAckCursor && pendingAckCursor !== committedCursor)
    },
    stableSnapshot,
    writeIntent: canApplyCommand
      ? {
          command,
          phase: command === "flush" ? "flushed" : "accepted",
          enabled: settings.enabled,
          providerId: providerContract.providerId,
          tenantBoundary: tenantBoundary.handoffScope,
          requestedAt: now,
          stableSnapshotProofToken: proofTokenFor(stableSnapshot)
        }
      : null,
    lastCommittedAt,
    lastFlushedAt,
    proofToken: proofTokenFor({
      storageKey,
      commandKey,
      lastCommandKey,
      phase,
      lastCommandStatus,
      revision,
      nextRevision,
      pendingAckCursor,
      committedCursor,
      commandKeyConflict,
      recoveryEpoch
    }),
    warnings
  };
}

function buildProviderNegotiation(providerContract, settings, command, episodeEnvelope, tenantBoundary, clientState, now) {
  const requiredCapabilities = new Set(["append-episodes", "retention-policy"]);
  if (command === "flush" || episodeEnvelope.acceptedCount > 0) {
    requiredCapabilities.add("flush-buffer");
  }
  if (settings.captureLevel === "full") {
    requiredCapabilities.add("full-capture");
  }
  if (clientState.handoffTarget !== "operator" || clientState.returnRoute) {
    requiredCapabilities.add("external-handoff");
  }
  if (tenantBoundary.isolationMode === "workspace") {
    requiredCapabilities.add("workspace-isolation");
  }

  const missingCapabilities = [...requiredCapabilities].filter((capability) => !providerContract.capabilities.includes(capability));
  const blockers = [];
  if (providerContract.state === "offline") {
    blockers.push("provider-offline");
  }
  if (providerContract.state === "read-only" && (command !== "status" || episodeEnvelope.acceptedCount > 0)) {
    blockers.push("provider-read-only");
  }
  blockers.push(...missingCapabilities.map((capability) => `provider-missing-${capability}`));

  const syncStatus = providerContract.sync.pendingAcknowledgement
    ? "pending-acknowledgement"
    : providerContract.sync.cursor
      ? "synced"
      : "not-started";

  return {
    contract: "episodic-log.provider-negotiation.v1",
    generatedAt: now,
    providerId: providerContract.providerId,
    state: providerContract.state,
    consistencyLevel: providerContract.consistencyLevel,
    requiredCapabilities: [...requiredCapabilities],
    grantedCapabilities: providerContract.capabilities,
    missingCapabilities,
    canCommit: blockers.length === 0,
    syncStatus,
    externalHandoff: {
      required: requiredCapabilities.has("external-handoff"),
      target: clientState.handoffTarget,
      route: clientState.returnRoute || providerContract.endpoint,
      cursor: providerContract.sync.cursor,
      pendingAcknowledgement: providerContract.sync.pendingAcknowledgement
    },
    proofToken: proofTokenFor({
      providerId: providerContract.providerId,
      state: providerContract.state,
      consistencyLevel: providerContract.consistencyLevel,
      requiredCapabilities: [...requiredCapabilities],
      grantedCapabilities: providerContract.capabilities,
      syncStatus
    }),
    blockers
  };
}

function normalizeProviderServiceContract(input = {}, command, providerContract, providerNegotiation, persistedState, episodeEnvelope, tenantBoundary, clientState, now) {
  const source = input.providerService || input.serviceContract || input.provider?.service || input.serviceProvider?.service || {};
  const requestedAckMode = typeof source.ackMode === "string" ? source.ackMode.trim().toLowerCase() : "cursor";
  const ackMode = allowedServiceAckModes.has(requestedAckMode) ? requestedAckMode : "cursor";
  const requestedTier = typeof source.tier === "string" ? source.tier.trim().toLowerCase() : "interactive";
  const tier = allowedServiceTiers.has(requestedTier) ? requestedTier : "interactive";
  const serviceId = normalizeText(source.serviceId ?? source.id, `${providerContract.providerId}:episodic-service`, { maxLength: 140 });
  const contractVersion = normalizeText(source.contractVersion ?? source.version, "2026-07-episodic-log-v1", { maxLength: 80 });
  const leaseId = normalizeText(source.leaseId ?? source.capabilityLeaseId, null, { maxLength: 120 });
  const leaseExpiresAt = normalizeText(source.leaseExpiresAt ?? source.capabilityLeaseExpiresAt, null, { maxLength: 40 });
  const appendRoute = normalizeText(source.appendRoute, `${providerContract.endpoint}/episodes`, { maxLength: 220 });
  const flushRoute = normalizeText(source.flushRoute, `${providerContract.endpoint}/flush`, { maxLength: 220 });
  const ackRoute = normalizeText(source.ackRoute, `${providerContract.endpoint}/ack`, { maxLength: 220 });
  const proofRoute = normalizeText(source.proofRoute, `${providerContract.endpoint}/proof`, { maxLength: 220 });
  const handoffRoute = normalizeText(source.handoffRoute ?? source.callbackRoute, clientState.returnRoute || providerNegotiation.externalHandoff.route, { maxLength: 220 });
  const minAckRevision = clampInteger(source.minAckRevision ?? source.requiredRevision, persistedState.nextRevision, { min: 0, max: 1000000000 });
  const pendingAckCount = clampInteger(source.pendingAckCount ?? source.unackedBatches, persistedState.pending.hasUncommittedCursor ? 1 : 0, { min: 0, max: 1000000 });
  const remoteWatermark = normalizeText(source.remoteWatermark ?? source.remoteCursor, providerContract.sync.acknowledgedCursor, { maxLength: 180 });
  const localWatermark = normalizeText(source.localWatermark ?? source.localCursor, providerContract.sync.cursor || persistedState.pending.ackCursor, { maxLength: 180 });
  const generatedCursor = proofTokenFor({
    storageKey: persistedState.storageKey,
    command,
    revision: persistedState.nextRevision,
    acceptedCount: episodeEnvelope.acceptedCount,
    generatedAt: now
  });
  const nextCursor = localWatermark || `episodic:${persistedState.nextRevision}:${generatedCursor}`;
  const externalRequired = providerNegotiation.externalHandoff.required;
  const handoffStatus = externalRequired
    ? providerNegotiation.canCommit && Boolean(handoffRoute)
      ? "ready"
      : "blocked"
    : "not-required";
  const blockers = [];
  const warnings = [];

  if (source.ackMode !== undefined && ackMode !== requestedAckMode) {
    warnings.push(`provider service ackMode "${source.ackMode}" was normalized to cursor`);
  }
  if (source.tier !== undefined && tier !== requestedTier) {
    warnings.push(`provider service tier "${source.tier}" was normalized to interactive`);
  }
  if (providerContract.kind === "hosted-kernel" && providerContract.state === "connected" && !providerNegotiation.grantedCapabilities.includes("proof-export")) {
    blockers.push("hosted-kernel-proof-export-required");
  }
  if (ackMode === "revision" && minAckRevision > persistedState.nextRevision) {
    blockers.push("provider-service-awaiting-revision-ack");
  }
  if (ackMode === "cursor" && providerContract.sync.pendingAcknowledgement && pendingAckCount > 0) {
    blockers.push("provider-service-cursor-ack-pending");
  }
  if (externalRequired && !handoffRoute) {
    blockers.push("provider-service-handoff-route-required");
  }

  return {
    contract: "episodic-log.hosted-provider-service-contract.v1",
    serviceId,
    contractVersion,
    providerId: providerContract.providerId,
    providerKind: providerContract.kind,
    tier,
    ackMode,
    routes: {
      append: appendRoute,
      flush: flushRoute,
      acknowledge: ackRoute,
      proof: proofRoute,
      externalHandoff: handoffRoute
    },
    capabilityLease: {
      leaseId,
      expiresAt: leaseExpiresAt,
      leasedCapabilities: providerNegotiation.grantedCapabilities,
      missingCapabilities: providerNegotiation.missingCapabilities,
      valid: providerNegotiation.canCommit && blockers.length === 0
    },
    syncMetadata: {
      localWatermark,
      remoteWatermark,
      nextCursor,
      pendingAckCount,
      minAckRevision,
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      ackRequired: ackMode !== "none" && (episodeEnvelope.acceptedCount > 0 || command === "flush" || persistedState.pending.hasUncommittedCursor),
      staleRemote: Boolean(localWatermark && remoteWatermark && localWatermark !== remoteWatermark)
    },
    externalHandoffState: {
      required: externalRequired,
      status: handoffStatus,
      target: clientState.handoffTarget,
      route: handoffRoute,
      resumeToken: clientState.resumeToken,
      payloadCursor: nextCursor,
      permissionScope: tenantBoundary.handoffScope
    },
    proofToken: proofTokenFor({
      serviceId,
      contractVersion,
      providerId: providerContract.providerId,
      tier,
      ackMode,
      nextCursor,
      minAckRevision,
      handoffStatus
    }),
    blockers,
    warnings
  };
}

function buildHostedKernelSyncHandoffContract(input = {}, command, providerContract, providerNegotiation, providerServiceContract, persistedState, episodeEnvelope, requestWorkflowState, clientState, now) {
  const source = input.providerSync || input.syncMetadata || input.handoffState || input.provider?.syncPolicy || {};
  const mutationCommand = command !== "status" || episodeEnvelope.acceptedCount > 0;
  const requestedDeliverySemantic = typeof source.deliverySemantic === "string"
    ? source.deliverySemantic.trim().toLowerCase()
    : providerContract.consistencyLevel === "strong"
      ? "exactly-once"
      : providerContract.consistencyLevel === "session"
        ? "at-least-once"
        : "best-effort";
  const deliverySemantic = allowedDeliverySemantics.has(requestedDeliverySemantic)
    ? requestedDeliverySemantic
    : "at-least-once";
  const requestedHandoffMode = typeof source.handoffMode === "string"
    ? source.handoffMode.trim().toLowerCase()
    : providerServiceContract.externalHandoffState.required
      ? clientState.handoffTarget === "scheduler"
        ? "scheduler-queue"
        : "callback"
      : "none";
  const handoffMode = allowedSyncHandoffModes.has(requestedHandoffMode)
    ? requestedHandoffMode
    : "none";
  const batchId = normalizeText(source.batchId ?? source.handoffBatchId, `${persistedState.storageKey}:${persistedState.nextRevision}`, { maxLength: 220 });
  const lastDeliveredCursor = normalizeText(source.lastDeliveredCursor ?? source.deliveredCursor, null, { maxLength: 180 });
  const deliveryAttempt = clampInteger(source.deliveryAttempt ?? source.attempt, 1, { min: 1, max: 50 });
  const ackDeadlineAt = normalizeText(source.ackDeadlineAt ?? source.deadlineAt, null, { maxLength: 40 });
  const requiresRemoteAck = normalizeBoolean(
    source.requiresRemoteAck,
    deliverySemantic !== "best-effort" && providerServiceContract.syncMetadata.ackRequired
  );
  const proofBundleRoute = normalizeText(source.proofBundleRoute, providerServiceContract.routes.proof, { maxLength: 220 });
  const handoffPayloadRoute = normalizeText(
    source.handoffPayloadRoute,
    providerServiceContract.routes.externalHandoff || clientState.returnRoute || `${surfaceGroup}/${surfaceName}/handoff`,
    { maxLength: 220 }
  );
  const warnings = [];
  const blockers = [];

  if (source.deliverySemantic !== undefined && deliverySemantic !== requestedDeliverySemantic) {
    warnings.push(`provider sync deliverySemantic "${source.deliverySemantic}" was normalized to at-least-once`);
  }
  if (source.handoffMode !== undefined && handoffMode !== requestedHandoffMode) {
    warnings.push(`provider sync handoffMode "${source.handoffMode}" was normalized to none`);
  }
  if ((source.deliveryAttempt ?? source.attempt) !== undefined && deliveryAttempt !== Number(source.deliveryAttempt ?? source.attempt)) {
    warnings.push("provider sync deliveryAttempt was normalized to the supported 1-50 range");
  }
  if (deliverySemantic === "exactly-once" && providerServiceContract.ackMode === "none") {
    blockers.push("exactly-once-sync-requires-ack-mode");
  }
  if (requiresRemoteAck && providerServiceContract.syncMetadata.staleRemote && mutationCommand) {
    blockers.push("remote-watermark-stale-before-mutation");
  }
  if (lastDeliveredCursor && lastDeliveredCursor === providerServiceContract.syncMetadata.nextCursor && mutationCommand) {
    blockers.push("handoff-cursor-already-delivered");
  }
  if (handoffMode !== "none" && providerServiceContract.externalHandoffState.required && !handoffPayloadRoute) {
    blockers.push("sync-handoff-payload-route-required");
  }
  if (handoffMode === "callback" && !clientState.returnRoute && !providerServiceContract.routes.externalHandoff) {
    blockers.push("callback-handoff-route-required");
  }
  if (providerNegotiation.missingCapabilities.includes("external-handoff") && handoffMode !== "none") {
    blockers.push("sync-handoff-capability-missing");
  }

  const disposition = blockers.length > 0
    ? "blocked"
    : !mutationCommand
      ? "observe"
      : requiresRemoteAck
        ? "deliver-and-await-ack"
        : "deliver-without-ack";

  return {
    contract: "episodic-log.hosted-kernel-sync-handoff.v1",
    generatedAt: now,
    batchId,
    deliverySemantic,
    disposition,
    providerId: providerContract.providerId,
    serviceId: providerServiceContract.serviceId,
    handoffMode,
    deliveryAttempt,
    routes: {
      handoffPayload: handoffPayloadRoute,
      acknowledgement: providerServiceContract.routes.acknowledge,
      proofBundle: proofBundleRoute
    },
    cursorState: {
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      localWatermark: providerServiceContract.syncMetadata.localWatermark,
      remoteWatermark: providerServiceContract.syncMetadata.remoteWatermark,
      lastDeliveredCursor,
      staleRemote: providerServiceContract.syncMetadata.staleRemote,
      requiresRemoteAck,
      ackDeadlineAt
    },
    payload: {
      command,
      workflowIntent: requestWorkflowState.intent,
      continuationKey: requestWorkflowState.continuationKey,
      acceptedEpisodes: episodeEnvelope.acceptedCount,
      persistedRevision: persistedState.revision,
      nextPersistedRevision: persistedState.nextRevision,
      storageKey: persistedState.storageKey
    },
    proofToken: proofTokenFor({
      batchId,
      providerId: providerContract.providerId,
      serviceId: providerServiceContract.serviceId,
      deliverySemantic,
      handoffMode,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      lastDeliveredCursor,
      disposition,
      generatedAt: now
    }),
    blockers,
    warnings
  };
}

function buildProviderCommitPlan(input = {}, command, providerNegotiation, providerServiceContract, providerSyncHandoffContract, persistedState, episodeEnvelope, requestWorkflowState, tenantBoundary, now) {
  const rawSource = input.providerCommitPlan || input.commitPlan || input.provider?.commitPlan || input.serviceContract?.commitPlan || {};
  const source = rawSource && typeof rawSource === "object" && !Array.isArray(rawSource) ? rawSource : {};
  const mutationCommand = command !== "status" || episodeEnvelope.acceptedCount > 0;
  const requestedMode = typeof source.mode === "string" ? source.mode.trim().toLowerCase() : "auto";
  const mode = ["auto", "append-only", "flush-only", "append-and-flush"].includes(requestedMode)
    ? requestedMode
    : "auto";
  const requestedConflictPolicy = typeof source.conflictPolicy === "string"
    ? source.conflictPolicy.trim().toLowerCase()
    : "hold";
  const conflictPolicy = ["hold", "overwrite", "idempotent-replay"].includes(requestedConflictPolicy)
    ? requestedConflictPolicy
    : "hold";
  const maxCommitAttempts = clampInteger(source.maxCommitAttempts, 3, { min: 1, max: 10 });
  const commitDeadlineAt = normalizeTimestamp(source.commitDeadlineAt ?? source.deadlineAt);
  const commitRoute = normalizeText(source.commitRoute, `${providerServiceContract.routes.append}/commit`, { maxLength: 240 });
  const rollbackRoute = normalizeText(source.rollbackRoute, `${providerServiceContract.routes.append}/rollback`, { maxLength: 240 });
  const proofBundleRequired = mutationCommand && normalizeBoolean(source.proofBundleRequired, providerNegotiation.grantedCapabilities.includes("proof-export"));
  const appendRequired = mode === "append-only" || mode === "append-and-flush" || (mode === "auto" && episodeEnvelope.acceptedCount > 0);
  const flushRequired = mode === "flush-only" || mode === "append-and-flush" || (mode === "auto" && command === "flush");
  const handoffRequired = providerServiceContract.externalHandoffState.required || providerSyncHandoffContract.handoffMode !== "none";
  const ackRequired = providerServiceContract.syncMetadata.ackRequired || providerSyncHandoffContract.cursorState.requiresRemoteAck;
  const sequence = [];
  const blockers = [];
  const warnings = [];

  if (source.mode !== undefined && mode !== requestedMode) {
    warnings.push(`provider commit plan mode "${source.mode}" was normalized to auto`);
  }
  if (source.conflictPolicy !== undefined && conflictPolicy !== requestedConflictPolicy) {
    warnings.push(`provider commit plan conflictPolicy "${source.conflictPolicy}" was normalized to hold`);
  }
  if (source.maxCommitAttempts !== undefined && maxCommitAttempts !== Number(source.maxCommitAttempts)) {
    warnings.push("provider commit plan maxCommitAttempts was normalized to the supported 1-10 range");
  }
  if ((source.commitDeadlineAt ?? source.deadlineAt) !== undefined && !commitDeadlineAt) {
    warnings.push("provider commit plan deadline was omitted because it was not parseable");
  }

  if (appendRequired) {
    sequence.push({
      step: "append-episodes",
      route: providerServiceContract.routes.append,
      count: episodeEnvelope.acceptedCount,
      requiredCapability: "append-episodes"
    });
  }
  if (flushRequired) {
    sequence.push({
      step: "flush-buffer",
      route: providerServiceContract.routes.flush,
      count: episodeEnvelope.acceptedCount,
      requiredCapability: "flush-buffer"
    });
  }
  if (proofBundleRequired) {
    sequence.push({
      step: "export-proof-bundle",
      route: providerServiceContract.routes.proof,
      count: Math.max(1, episodeEnvelope.proofTokens.length),
      requiredCapability: "proof-export"
    });
  }
  if (handoffRequired) {
    sequence.push({
      step: "deliver-external-handoff",
      route: providerSyncHandoffContract.routes.handoffPayload,
      count: 1,
      requiredCapability: "external-handoff"
    });
  }
  if (ackRequired) {
    sequence.push({
      step: "acknowledge-provider-cursor",
      route: providerServiceContract.routes.acknowledge,
      count: 1,
      requiredCapability: null
    });
  }

  if (mutationCommand && !persistedState.canApplyCommand && !persistedState.duplicateCommand) {
    blockers.push("commit-plan-persisted-state-not-writable");
  }
  if (persistedState.commandKeyConflict && conflictPolicy !== "overwrite") {
    blockers.push("commit-plan-idempotency-conflict-held");
  }
  if (persistedState.duplicateCommand && conflictPolicy !== "idempotent-replay") {
    warnings.push("provider commit plan is returning an idempotent replay without adding another write step");
  }
  if (!providerServiceContract.capabilityLease.valid) {
    blockers.push("commit-plan-capability-lease-invalid");
  }
  if (providerSyncHandoffContract.disposition === "blocked") {
    blockers.push("commit-plan-sync-handoff-blocked");
  }
  if (appendRequired && episodeEnvelope.acceptedCount === 0) {
    blockers.push("commit-plan-append-has-no-accepted-episodes");
  }
  if (proofBundleRequired && !providerNegotiation.grantedCapabilities.includes("proof-export")) {
    blockers.push("commit-plan-proof-export-capability-missing");
  }
  if (handoffRequired && !providerSyncHandoffContract.routes.handoffPayload) {
    blockers.push("commit-plan-handoff-route-required");
  }
  if (ackRequired && !providerServiceContract.routes.acknowledge) {
    blockers.push("commit-plan-ack-route-required");
  }

  const disposition = blockers.length > 0
    ? "blocked"
    : !mutationCommand
      ? "observe"
      : persistedState.duplicateCommand
        ? "idempotent-replay"
        : handoffRequired
          ? "commit-and-handoff"
          : "commit";

  return {
    contract: "episodic-log.provider-commit-plan.v1",
    generatedAt: now,
    mode,
    disposition,
    conflictPolicy,
    commitRoute,
    rollbackRoute,
    commitDeadlineAt,
    maxCommitAttempts,
    operationFlags: {
      mutationCommand,
      appendRequired,
      flushRequired,
      proofBundleRequired,
      handoffRequired,
      ackRequired
    },
    cursorCommit: {
      commandKey: persistedState.commandKey,
      storageKey: persistedState.storageKey,
      expectedRevision: persistedState.revision,
      commitRevision: persistedState.nextRevision,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      batchId: providerSyncHandoffContract.batchId,
      workflowContinuationKey: requestWorkflowState.continuationKey,
      tenantBoundary: tenantBoundary.handoffScope
    },
    sequence,
    blockers,
    warnings,
    proofToken: proofTokenFor({
      mode,
      disposition,
      conflictPolicy,
      commandKey: persistedState.commandKey,
      nextRevision: persistedState.nextRevision,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      batchId: providerSyncHandoffContract.batchId,
      sequence: sequence.map((step) => step.step),
      generatedAt: now
    })
  };
}

function buildBoundaryAuditHandoff(input = {}, command, settings, tenantBoundary, clientState, requestWorkflowState, providerServiceContract, providerSyncHandoffContract, persistedState, episodeEnvelope, now) {
  const source = input.boundaryAudit || input.auditHandoff || input.audit?.handoff || {};
  const externalHandoff = providerServiceContract.externalHandoffState.required || clientState.handoffTarget !== "operator";
  const allowedTenantIds = normalizeScopeAllowList(source.allowedTenantIds ?? source.tenants);
  const allowedWorkspaceIds = normalizeScopeAllowList(source.allowedWorkspaceIds ?? source.workspaces);
  const includeScopeProof = normalizeBoolean(source.includeScopeProof, true);
  const requireWorkspaceForExternal = normalizeBoolean(source.requireWorkspaceForExternal, externalHandoff);
  const requestedDisposition = typeof source.disposition === "string" ? source.disposition.trim().toLowerCase() : null;
  const blockers = [];
  const warnings = [];

  if (source.allowedTenantIds !== undefined && allowedTenantIds.length === 0) {
    warnings.push("boundary audit tenant allow-list was ignored because no valid tenant ids were supplied");
  }
  if (source.allowedWorkspaceIds !== undefined && allowedWorkspaceIds.length === 0) {
    warnings.push("boundary audit workspace allow-list was ignored because no valid workspace ids were supplied");
  }
  if (requestedDisposition !== null && !["allow", "hold", "deny"].includes(requestedDisposition)) {
    warnings.push(`boundary audit disposition "${source.disposition}" was normalized from policy inputs`);
  }
  if (requestedDisposition === "deny") {
    blockers.push("audit-policy-denied-handoff");
  }
  if (requestedDisposition === "hold") {
    blockers.push("audit-policy-held-handoff");
  }
  if (tenantBoundary.crossTenantRequested) {
    blockers.push("audit-cross-tenant-handoff-denied");
  }
  if (externalHandoff && !tenantBoundary.tenantId) {
    blockers.push("audit-external-handoff-requires-tenant-scope");
  }
  if (externalHandoff && requireWorkspaceForExternal && !tenantBoundary.workspaceId) {
    blockers.push("audit-external-handoff-requires-workspace-scope");
  }
  if (allowedTenantIds.length > 0 && (!tenantBoundary.tenantId || !allowedTenantIds.includes(tenantBoundary.tenantId))) {
    blockers.push("audit-tenant-not-in-allowed-set");
  }
  if (allowedWorkspaceIds.length > 0 && (!tenantBoundary.workspaceId || !allowedWorkspaceIds.includes(tenantBoundary.workspaceId))) {
    blockers.push("audit-workspace-not-in-allowed-set");
  }
  if (tenantBoundary.mutationRequested && !tenantBoundary.permission.allowed) {
    blockers.push("audit-permission-denied-for-mutating-handoff");
  }
  if (externalHandoff && settings.captureLevel === "full" && !["maintainer", "kernel"].includes(tenantBoundary.actorRole)) {
    blockers.push("audit-full-capture-external-handoff-denied");
  }
  if (providerSyncHandoffContract.disposition === "blocked") {
    blockers.push("audit-sync-handoff-blocked");
  }

  const denialBlockers = blockers.filter((blocker) => blocker !== "audit-policy-held-handoff");
  const effectiveDisposition = denialBlockers.length > 0
    ? "deny"
    : requestedDisposition === "hold"
      ? "hold"
      : "allow";
  const scopeSubject = [
    tenantBoundary.tenantId || "session",
    tenantBoundary.workspaceId || tenantBoundary.isolationMode,
    tenantBoundary.projectId || "default"
  ].join("/");

  return {
    contract: "episodic-log.boundary-audit-handoff.v1",
    generatedAt: now,
    disposition: effectiveDisposition,
    externalHandoff,
    scopeSubject,
    command,
    actorRole: tenantBoundary.actorRole,
    clientSurface: clientState.clientSurface,
    handoffTarget: clientState.handoffTarget,
    route: `${surfaceGroup}/${surfaceName}/audit/boundary`,
    tenantBoundary: tenantBoundary.handoffScope,
    allowedScope: {
      tenantIds: allowedTenantIds,
      workspaceIds: allowedWorkspaceIds,
      requireWorkspaceForExternal
    },
    exposure: {
      captureLevel: settings.captureLevel,
      acceptedEpisodes: episodeEnvelope.acceptedCount,
      rejectedEpisodes: episodeEnvelope.rejectedCount,
      durableRevision: persistedState.nextRevision,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      syncDisposition: providerSyncHandoffContract.disposition
    },
    continuation: {
      continuationKey: requestWorkflowState.continuationKey,
      correlationId: requestWorkflowState.correlationId,
      intent: requestWorkflowState.intent,
      returnMode: requestWorkflowState.returnMode
    },
    scopeProof: includeScopeProof
      ? {
          storageKey: persistedState.storageKey,
          commandKey: persistedState.commandKey,
          proofToken: proofTokenFor({
            scopeSubject,
            command,
            actorRole: tenantBoundary.actorRole,
            target: clientState.handoffTarget,
            nextRevision: persistedState.nextRevision,
            nextCursor: providerServiceContract.syncMetadata.nextCursor
          })
        }
      : null,
    blockers,
    warnings,
    proofToken: proofTokenFor({
      scopeSubject,
      disposition: effectiveDisposition,
      externalHandoff,
      blockers,
      acceptedCount: episodeEnvelope.acceptedCount,
      continuationKey: requestWorkflowState.continuationKey,
      generatedAt: now
    })
  };
}

function buildRequestContinuationContract(requestWorkflowState, persistedState, providerServiceContract, episodeEnvelope, nextAction, now) {
  const blockers = [];
  const expectedRevision = requestWorkflowState.preconditions.expectedRevision;
  const expectedCursor = requestWorkflowState.preconditions.expectedCursor;
  const observedCursor = providerServiceContract.syncMetadata.localWatermark
    || providerServiceContract.syncMetadata.remoteWatermark
    || persistedState.pending.committedCursor;

  if (expectedRevision !== null && expectedRevision !== persistedState.revision) {
    blockers.push("workflow-revision-precondition-failed");
  }
  if (expectedCursor && expectedCursor !== observedCursor) {
    blockers.push("workflow-cursor-precondition-failed");
  }
  if (requestWorkflowState.intent === "commit" && persistedState.recovery.required) {
    blockers.push("workflow-recovery-required-before-commit");
  }
  if (requestWorkflowState.intent === "flush" && nextAction.action !== "flush-episodic-buffer") {
    blockers.push("workflow-flush-not-ready");
  }
  if (requestWorkflowState.intent === "recover" && !persistedState.recovery.required) {
    blockers.push("workflow-recovery-not-required");
  }

  const handoffKind = requestWorkflowState.returnMode === "callback"
    ? "callback"
    : requestWorkflowState.returnMode === "deferred"
      ? "deferred-resume"
      : "inline-response";
  const shouldWakeClient = blockers.length === 0 && (
    requestWorkflowState.priority === "urgent"
    || requestWorkflowState.intent === "flush"
    || episodeEnvelope.acceptedCount > 0
  );
  const status = blockers.length > 0
    ? "blocked"
    : requestWorkflowState.intent === "inspect"
      ? "observable"
      : "continuable";

  return {
    contract: "episodic-log.request-continuation.v1",
    status,
    handoffKind,
    continuationKey: requestWorkflowState.continuationKey,
    correlationId: requestWorkflowState.correlationId,
    parentRequestId: requestWorkflowState.parentRequestId,
    intent: requestWorkflowState.intent,
    priority: requestWorkflowState.priority,
    returnMode: requestWorkflowState.returnMode,
    clientCheckpoint: requestWorkflowState.clientCheckpoint,
    workflowDeadlineAt: requestWorkflowState.workflowDeadlineAt,
    userVisibleLabel: requestWorkflowState.userVisibleLabel,
    shouldWakeClient,
    observedState: {
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      cursor: observedCursor,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      acceptedEpisodes: episodeEnvelope.acceptedCount
    },
    preconditions: {
      expectedRevision,
      expectedCursor,
      revisionSatisfied: expectedRevision === null || expectedRevision === persistedState.revision,
      cursorSatisfied: !expectedCursor || expectedCursor === observedCursor
    },
    nextClientAction: blockers.length > 0
      ? "refresh-request-state"
      : requestWorkflowState.intent === "inspect"
        ? "render-status"
        : requestWorkflowState.intent === "recover"
          ? "resume-recovery"
          : nextAction.action,
    proofToken: proofTokenFor({
      continuationKey: requestWorkflowState.continuationKey,
      status,
      intent: requestWorkflowState.intent,
      priority: requestWorkflowState.priority,
      observedRevision: persistedState.revision,
      observedCursor,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      blockers,
      generatedAt: now
    }),
    blockers
  };
}

function buildOperationalHealth(failureState, settings, nextAction, now) {
  const failureActive = failureState.status !== "healthy";
  const retryableFailureCodes = new Set(["backend-unreachable", "timeout"]);
  const operatorRecoverableFailureCodes = new Set(["schema-mismatch", "write-denied", "buffer-corrupt"]);
  const quotaPressure = failureState.failureCode === "quota-exceeded" || failureState.queueDepth > settings.maxEpisodesPerFlush * 2;
  const retryable = failureActive && (
    failureState.status === "degraded"
    || retryableFailureCodes.has(failureState.failureCode)
    || (failureState.status === "offline" && failureState.consecutiveFailures < 3)
  );
  const circuitOpen = failureActive && (
    failureState.consecutiveFailures >= 5
    || operatorRecoverableFailureCodes.has(failureState.failureCode)
    || quotaPressure
  );
  const retryJitterSeconds = retryable
    ? Number.parseInt(proofTokenFor({
        status: failureState.status,
        code: failureState.failureCode,
        consecutiveFailures: failureState.consecutiveFailures,
        queueDepth: failureState.queueDepth
      }).slice(0, 2), 16) % 30
    : 0;
  const retryBaseSeconds = failureState.retryAfterSeconds || Math.min(900, 30 * (2 ** Math.min(failureState.consecutiveFailures, 5)));
  const retryBackoffSeconds = failureActive && retryable && !circuitOpen
    ? retryBaseSeconds + retryJitterSeconds
    : 0;
  const retryAt = failureActive && retryBackoffSeconds > 0
    ? new Date(Date.parse(now) + retryBackoffSeconds * 1000).toISOString()
    : null;
  const degradedMode = failureState.status === "degraded" || (failureActive && failureState.queueDepth > settings.maxEpisodesPerFlush);
  const writeDisposition = !failureActive
    ? "accept-writes"
    : circuitOpen
      ? "hold-writes"
      : degradedMode
        ? "buffer-metadata-only"
        : "buffer-locally";
  const captureDisposition = writeDisposition === "buffer-metadata-only" && settings.captureLevel === "full"
    ? "downgrade-to-summary-until-healthy"
    : writeDisposition === "hold-writes"
      ? "reject-new-episode-captures"
      : "preserve-requested-capture-level";
  const blockers = [];
  const actionableErrors = [];
  const runbook = [];

  if (failureState.status === "offline") {
    blockers.push("episodic-log-backend-offline");
    actionableErrors.push({
      code: "backend-offline",
      message: "Episodic log storage is offline; keep buffered episodes local and retry after connectivity returns.",
      route: `${surfaceGroup}/${surfaceName}/health`
    });
    runbook.push({
      id: "verify-provider-connectivity",
      label: "Verify provider connectivity",
      route: `${surfaceGroup}/${surfaceName}/provider`,
      requiredBeforeRetry: circuitOpen
    });
  }
  if (failureState.status === "failing") {
    blockers.push(`episodic-log-${failureState.failureCode}`);
    actionableErrors.push({
      code: failureState.failureCode,
      message: `Episodic log backend reported ${failureState.failureCode}; automatic flush is paused until the failure clears.`,
      route: `${surfaceGroup}/${surfaceName}/health`
    });
  }
  if (failureState.failureCode === "schema-mismatch") {
    actionableErrors.push({
      code: "schema-mismatch",
      message: "Run the hosted-kernel episodic log schema migration before accepting new full captures.",
      route: `${surfaceGroup}/${surfaceName}/migrations`
    });
    runbook.push({
      id: "run-schema-migration",
      label: "Run schema migration",
      route: `${surfaceGroup}/${surfaceName}/migrations`,
      requiredBeforeRetry: true
    });
  }
  if (failureState.failureCode === "quota-exceeded") {
    actionableErrors.push({
      code: "quota-exceeded",
      message: "Reduce retention or flush batch size, then retry the episodic log commit.",
      route: `${surfaceGroup}/${surfaceName}/settings`
    });
    runbook.push({
      id: "reduce-retention-or-batch-size",
      label: "Reduce retention or batch size",
      route: `${surfaceGroup}/${surfaceName}/settings`,
      requiredBeforeRetry: true
    });
  }
  if (failureState.failureCode === "write-denied") {
    runbook.push({
      id: "refresh-provider-write-lease",
      label: "Refresh provider write lease",
      route: `${surfaceGroup}/${surfaceName}/provider`,
      requiredBeforeRetry: true
    });
  }
  if (failureState.failureCode === "buffer-corrupt") {
    runbook.push({
      id: "quarantine-corrupt-buffer",
      label: "Quarantine corrupt buffer",
      route: `${surfaceGroup}/${surfaceName}/recovery`,
      requiredBeforeRetry: true
    });
  }
  if (failureActive && retryable && !circuitOpen) {
    runbook.push({
      id: "retry-with-backoff",
      label: "Retry with backoff",
      route: `${surfaceGroup}/${surfaceName}/health`,
      requiredBeforeRetry: false
    });
  }

  return {
    contract: "episodic-log.operational-health.v1",
    status: failureState.status,
    degradedMode,
    canAttemptFlush: settings.enabled && !circuitOpen && (!failureActive || retryable) && !["offline", "failing"].includes(failureState.status),
    writeDisposition,
    captureDisposition,
    circuitBreaker: {
      open: circuitOpen,
      reason: circuitOpen
        ? quotaPressure
          ? "quota-or-backlog-pressure"
          : operatorRecoverableFailureCodes.has(failureState.failureCode)
            ? "operator-recovery-required"
            : "too-many-consecutive-failures"
        : null,
      consecutiveFailures: failureState.consecutiveFailures,
      resetRoute: `${surfaceGroup}/${surfaceName}/health/reset`
    },
    retry: {
      scheduled: Boolean(retryAt),
      attempt: failureState.consecutiveFailures + (failureActive ? 1 : 0),
      backoffSeconds: retryBackoffSeconds,
      jitterSeconds: retryJitterSeconds,
      retryAt,
      retryable,
      reason: failureActive
        ? circuitOpen
          ? "retry is held until the circuit breaker is reset by the required operator action"
          : retryable
            ? `retry delayed after ${failureState.consecutiveFailures} consecutive failure${failureState.consecutiveFailures === 1 ? "" : "s"}`
            : "failure requires operator action before retry"
        : null
    },
    buffer: {
      queuedEpisodes: failureState.queueDepth,
      flushLimit: settings.maxEpisodesPerFlush,
      overflowRisk: failureState.queueDepth > settings.maxEpisodesPerFlush,
      pressure: failureState.queueDepth > settings.maxEpisodesPerFlush * 2
        ? "critical"
        : failureState.queueDepth > settings.maxEpisodesPerFlush
          ? "elevated"
          : "normal",
      overflowAction: quotaPressure
        ? "stop-new-captures-until-buffer-drains"
        : failureState.queueDepth > settings.maxEpisodesPerFlush
          ? "prefer-flush-before-new-captures"
          : "none"
    },
    failureState: {
      code: failureState.failureCode,
      message: failureState.message,
      lastFailureAt: failureState.lastFailureAt,
      lastSuccessAt: failureState.lastSuccessAt
    },
    nextHealthAction: failureActive
      ? {
          action: "retry-episodic-health-check",
          dueAt: retryAt,
          route: `${surfaceGroup}/${surfaceName}/health`,
          reason: failureState.message || `health is ${failureState.status}`
        }
      : {
          action: nextAction.action,
          dueAt: nextAction.dueAt,
          route: `${surfaceGroup}/${surfaceName}/lifecycle`,
          reason: nextAction.reason
        },
    blockers,
    actionableErrors,
    runbook,
    proofToken: proofTokenFor({
      status: failureState.status,
      code: failureState.failureCode,
      retryAt,
      writeDisposition,
      captureDisposition,
      circuitOpen,
      queueDepth: failureState.queueDepth
    })
  };
}

function buildValidationSummary(validation) {
  const warningCount = validation.length;
  return {
    status: warningCount === 0 ? "clean" : "normalized",
    warningCount,
    warnings: validation,
    userMessage: warningCount === 0
      ? "Episodic log adapter settings are valid."
      : `${warningCount} episodic log adapter setting${warningCount === 1 ? "" : "s"} were normalized before scheduling.`
  };
}

function buildReadinessContract(command, settings, lifecycleControls, lifecycleCommandPlan, nextAction, validationSummary, boundary, boundaryAuditHandoff, operationalHealth, episodeEnvelope, providerNegotiation, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, requestContinuation) {
  const blockers = [...boundary.blockers, ...lifecycleControls.blockers, ...lifecycleCommandPlan.blockers];
  if (!settings.enabled && !["disable", "pause", "status"].includes(command)) {
    blockers.push("adapter-disabled");
  }
  if (nextAction.state === "armed" && nextAction.dueAt === null) {
    blockers.push(`waiting-for-${nextAction.action}`);
  }
  blockers.push(...operationalHealth.blockers);
  blockers.push(...providerNegotiation.blockers);
  blockers.push(...providerServiceContract.blockers);
  blockers.push(...providerSyncHandoffContract.blockers);
  blockers.push(...providerCommitPlan.blockers);
  blockers.push(...boundaryAuditHandoff.blockers);
  blockers.push(...requestContinuation.blockers);
  if (persistedState.commandKeyConflict) {
    blockers.push("persisted-state-idempotency-key-conflict");
  }
  if (persistedState.recovery.required) {
    blockers.push(`persisted-state-${persistedState.recovery.reason}`);
  }
  if (episodeEnvelope?.rejectedCount > 0) {
    blockers.push("episode-envelope-has-rejections");
  }

  return {
    status: blockers.length === 0 ? "ready" : "attention-required",
    canFlushNow: lifecycleControls.flushPermissions.canRunFlush && !persistedState.recovery.required && !persistedState.commandKeyConflict && operationalHealth.canAttemptFlush && providerNegotiation.canCommit && ["flush-episodic-buffer", "flush-on-host-idle"].includes(nextAction.action),
    canAcceptPreview: (settings.enabled || ["disable", "pause", "status"].includes(command)) && !persistedState.recovery.required && !persistedState.commandKeyConflict && validationSummary.status !== "invalid" && boundary.permission.allowed && providerNegotiation.canCommit,
    healthStatus: operationalHealth.status,
    lifecycleState: lifecycleControls.state,
    lifecycleReason: lifecycleControls.reason,
    lifecycleCommandDisposition: lifecycleCommandPlan.disposition,
    lifecycleScheduleGate: lifecycleCommandPlan.scheduleGate.status,
    lifecycleScheduleHealth: lifecycleControls.scheduleControls.scheduleHealth,
    nextScheduledFlushAt: lifecycleControls.scheduleControls.nextScheduledFlushAt,
    earliestFlushAt: lifecycleControls.scheduleControls.earliestFlushAt,
    earlyFlushAllowed: lifecycleControls.scheduleControls.allowEarlyFlush,
    scheduleSuspended: lifecycleControls.scheduleControls.suspended,
    automaticFlushAllowed: lifecycleControls.flushPermissions.automaticAllowed,
    manualFlushAllowed: lifecycleControls.flushPermissions.manualAllowed,
    degradedMode: operationalHealth.degradedMode,
    healthWriteDisposition: operationalHealth.writeDisposition,
    healthCaptureDisposition: operationalHealth.captureDisposition,
    healthCircuitOpen: operationalHealth.circuitBreaker.open,
    providerState: providerNegotiation.state,
    providerSyncStatus: providerNegotiation.syncStatus,
    providerServiceTier: providerServiceContract.tier,
    providerServiceAckMode: providerServiceContract.ackMode,
    providerServiceLeaseValid: providerServiceContract.capabilityLease.valid,
    providerServiceHandoffStatus: providerServiceContract.externalHandoffState.status,
    providerServiceNextCursor: providerServiceContract.syncMetadata.nextCursor,
    providerSyncDisposition: providerSyncHandoffContract.disposition,
    providerSyncDeliverySemantic: providerSyncHandoffContract.deliverySemantic,
    providerSyncHandoffMode: providerSyncHandoffContract.handoffMode,
    providerSyncBatchId: providerSyncHandoffContract.batchId,
    providerCommitDisposition: providerCommitPlan.disposition,
    providerCommitStepCount: providerCommitPlan.sequence.length,
    providerCommitProofToken: providerCommitPlan.proofToken,
    boundaryAuditDisposition: boundaryAuditHandoff.disposition,
    boundaryAuditExternalHandoff: boundaryAuditHandoff.externalHandoff,
    boundaryAuditScopeSubject: boundaryAuditHandoff.scopeSubject,
    requestContinuationStatus: requestContinuation.status,
    requestContinuationKey: requestContinuation.continuationKey,
    requestContinuationIntent: requestContinuation.intent,
    requestContinuationHandoffKind: requestContinuation.handoffKind,
    requestContinuationWakeClient: requestContinuation.shouldWakeClient,
    restartSafeStatus: persistedState.restartSafeStatus,
    idempotentReplay: persistedState.duplicateCommand,
    commandKeyConflict: persistedState.commandKeyConflict,
    persistedRevision: persistedState.revision,
    nextPersistedRevision: persistedState.nextRevision,
    tenantScoped: Boolean(boundary.tenantId),
    workspaceScoped: Boolean(boundary.workspaceId),
    acceptedEpisodeCount: episodeEnvelope?.acceptedCount || 0,
    rejectedEpisodeCount: episodeEnvelope?.rejectedCount || 0,
    actorRole: boundary.actorRole,
    blockers,
    normalizedWarnings: validationSummary.warningCount,
    readinessLabel: blockers.length === 0
      ? "Ready for hosted-kernel episodic capture"
      : "Needs operator attention before automatic capture"
  };
}

function buildPreviewContract(command, settings, lifecycleControls, lifecycleCommandPlan, nextAction, validationSummary, boundary, boundaryAuditHandoff, operationalHealth, episodeEnvelope, providerNegotiation, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, requestContinuation) {
  const retentionWindow = `${settings.retentionDays} day${settings.retentionDays === 1 ? "" : "s"}`;
  return {
    title: "Episodic log adapter preview",
    mode: settings.enabled ? "enabled" : "disabled",
    retentionWindow,
    captureLevel: settings.captureLevel,
    schedule: {
      mode: settings.scheduleMode,
      intervalMinutes: settings.scheduleMode === "interval" ? settings.flushIntervalMinutes : null,
      nextDueAt: nextAction.dueAt,
      nextScheduledFlushAt: lifecycleControls.scheduleControls.nextScheduledFlushAt,
      earliestFlushAt: lifecycleControls.scheduleControls.earliestFlushAt,
      scheduleHealth: lifecycleControls.scheduleControls.scheduleHealth,
      scheduleDriftGraceMinutes: lifecycleControls.scheduleControls.scheduleDriftGraceMinutes,
      allowEarlyFlush: lifecycleControls.scheduleControls.allowEarlyFlush,
      suspended: lifecycleControls.scheduleControls.suspended,
      automaticFlushAllowed: lifecycleControls.flushPermissions.automaticAllowed,
      manualFlushAllowed: lifecycleControls.flushPermissions.manualAllowed,
      manualFlushToken: lifecycleControls.scheduleControls.manualFlushToken
    },
    lifecycleControls: {
      state: lifecycleControls.state,
      reason: lifecycleControls.reason,
      commandEffect: lifecycleControls.commandEffect,
      maintenanceWindow: lifecycleControls.maintenanceWindow,
      nextControlRoute: lifecycleControls.nextControlRoute,
      blockers: lifecycleControls.blockers
    },
    lifecycleCommandPlan: {
      disposition: lifecycleCommandPlan.disposition,
      transition: lifecycleCommandPlan.transition,
      controlMode: lifecycleCommandPlan.controlMode,
      scheduleGate: lifecycleCommandPlan.scheduleGate,
      safeguards: lifecycleCommandPlan.safeguards,
      route: lifecycleCommandPlan.route,
      blockers: lifecycleCommandPlan.blockers,
      proofToken: lifecycleCommandPlan.proofToken
    },
    impact: [
      `${settings.maxEpisodesPerFlush} episode${settings.maxEpisodesPerFlush === 1 ? "" : "s"} maximum per flush`,
      `${settings.captureLevel} capture level`,
      `${retentionWindow} retention window`
    ],
    confirmationText: command === "flush"
      ? "Accept to flush the current episodic buffer now."
      : "Accept to apply these episodic adapter settings.",
    validationStatus: validationSummary.status,
    operationalHealth: {
      status: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode,
      retryAt: operationalHealth.retry.retryAt,
      writeDisposition: operationalHealth.writeDisposition,
      captureDisposition: operationalHealth.captureDisposition,
      circuitOpen: operationalHealth.circuitBreaker.open,
      queuedEpisodes: operationalHealth.buffer.queuedEpisodes,
      actionableErrorCount: operationalHealth.actionableErrors.length
    },
    provider: {
      providerId: providerNegotiation.providerId,
      state: providerNegotiation.state,
      consistencyLevel: providerNegotiation.consistencyLevel,
      requiredCapabilities: providerNegotiation.requiredCapabilities,
      missingCapabilities: providerNegotiation.missingCapabilities,
      syncStatus: providerNegotiation.syncStatus,
      externalHandoffRequired: providerNegotiation.externalHandoff.required,
      serviceContract: {
        serviceId: providerServiceContract.serviceId,
        tier: providerServiceContract.tier,
        ackMode: providerServiceContract.ackMode,
        leaseValid: providerServiceContract.capabilityLease.valid,
        nextCursor: providerServiceContract.syncMetadata.nextCursor,
        handoffStatus: providerServiceContract.externalHandoffState.status
      },
      syncHandoff: {
        batchId: providerSyncHandoffContract.batchId,
        deliverySemantic: providerSyncHandoffContract.deliverySemantic,
        disposition: providerSyncHandoffContract.disposition,
        handoffMode: providerSyncHandoffContract.handoffMode,
        requiresRemoteAck: providerSyncHandoffContract.cursorState.requiresRemoteAck,
        staleRemote: providerSyncHandoffContract.cursorState.staleRemote,
        proofToken: providerSyncHandoffContract.proofToken,
        blockers: providerSyncHandoffContract.blockers
      },
      commitPlan: {
        mode: providerCommitPlan.mode,
        disposition: providerCommitPlan.disposition,
        commitRoute: providerCommitPlan.commitRoute,
        nextCursor: providerCommitPlan.cursorCommit.nextCursor,
        sequence: providerCommitPlan.sequence,
        blockers: providerCommitPlan.blockers,
        proofToken: providerCommitPlan.proofToken
      }
    },
    persistence: {
      storageKey: persistedState.storageKey,
      restartSafeStatus: persistedState.restartSafeStatus,
      duplicateCommand: persistedState.duplicateCommand,
      commandKeyConflict: persistedState.commandKeyConflict,
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      recoveryRequired: persistedState.recovery.required,
      recoveryRoute: persistedState.recovery.route,
      recoveryActions: persistedState.recovery.actions.slice(0, 3),
      stableSnapshot: persistedState.stableSnapshot
    },
    requestContinuation: {
      status: requestContinuation.status,
      intent: requestContinuation.intent,
      priority: requestContinuation.priority,
      returnMode: requestContinuation.returnMode,
      handoffKind: requestContinuation.handoffKind,
      continuationKey: requestContinuation.continuationKey,
      nextClientAction: requestContinuation.nextClientAction,
      shouldWakeClient: requestContinuation.shouldWakeClient,
      blockers: requestContinuation.blockers
    },
    ingest: {
      requestedEpisodes: episodeEnvelope.requestedCount,
      acceptedEpisodes: episodeEnvelope.acceptedCount,
      rejectedEpisodes: episodeEnvelope.rejectedCount,
      trimmedEpisodes: episodeEnvelope.trimmedCount,
      captureLevel: episodeEnvelope.captureLevel
    },
    tenantBoundary: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      isolationMode: boundary.isolationMode,
      actorRole: boundary.actorRole,
      permissionAllowed: boundary.permission.allowed,
      deniedReasons: boundary.permission.deniedReasons
    },
    boundaryAuditHandoff: {
      disposition: boundaryAuditHandoff.disposition,
      externalHandoff: boundaryAuditHandoff.externalHandoff,
      scopeSubject: boundaryAuditHandoff.scopeSubject,
      route: boundaryAuditHandoff.route,
      exposure: boundaryAuditHandoff.exposure,
      blockers: boundaryAuditHandoff.blockers,
      proofToken: boundaryAuditHandoff.proofToken
    }
  };
}

function buildAcceptanceContract(input, command, settings, lifecycleControls, lifecycleCommandPlan, readiness, persistedState, providerServiceContract, providerSyncHandoffContract, providerCommitPlan) {
  const requestedDecision = typeof input.acceptance === "string"
    ? input.acceptance.trim().toLowerCase()
    : null;
  const decision = ["accepted", "rejected", "preview"].includes(requestedDecision)
    ? requestedDecision
    : "preview";
  const accepted = decision === "accepted" && readiness.canAcceptPreview;
  const replayed = accepted && persistedState.duplicateCommand;

  return {
    decision,
    accepted,
    replayed,
    requiresConfirmation: command !== "status" || Object.keys(input.settings || {}).length > 0,
    acceptedAt: accepted ? (input.now || new Date().toISOString()) : null,
    rejectionReason: decision === "rejected"
      ? "operator rejected episodic adapter changes"
      : accepted
        ? null
        : readiness.blockers[0] || null,
    routeHint: accepted ? `${surfaceGroup}/${surfaceName}/accept` : `${surfaceGroup}/${surfaceName}/preview`,
    commitIntent: accepted
      ? {
          command,
          mode: replayed ? "idempotent-replay" : "write",
          commandKey: persistedState.commandKey,
          enabled: settings.enabled,
          lifecycleState: lifecycleControls.state,
          lifecycleReason: lifecycleControls.reason,
          lifecycleControlsProofToken: lifecycleControls.proofToken,
          lifecycleCommandDisposition: lifecycleCommandPlan.disposition,
          lifecycleCommandRoute: lifecycleCommandPlan.route,
          lifecycleCommandPlanProofToken: lifecycleCommandPlan.proofToken,
          lifecycleScheduleGate: lifecycleCommandPlan.scheduleGate.status,
          lifecycleScheduleHealth: lifecycleControls.scheduleControls.scheduleHealth,
          nextScheduledFlushAt: lifecycleControls.scheduleControls.nextScheduledFlushAt,
          earliestFlushAt: lifecycleControls.scheduleControls.earliestFlushAt,
          earlyFlushAllowed: lifecycleControls.scheduleControls.allowEarlyFlush,
          scheduleSuspended: lifecycleControls.scheduleControls.suspended,
          automaticFlushAllowed: lifecycleControls.flushPermissions.automaticAllowed,
          manualFlushAllowed: lifecycleControls.flushPermissions.manualAllowed,
          scheduleMode: settings.scheduleMode,
          captureLevel: settings.captureLevel,
          providerState: readiness.providerState,
          providerSyncStatus: readiness.providerSyncStatus,
          providerServiceId: providerServiceContract.serviceId,
          providerServiceTier: providerServiceContract.tier,
          providerServiceAckMode: providerServiceContract.ackMode,
          providerServiceProofToken: providerServiceContract.proofToken,
          providerServiceNextCursor: providerServiceContract.syncMetadata.nextCursor,
          providerServiceAckRoute: providerServiceContract.routes.acknowledge,
          providerSyncBatchId: providerSyncHandoffContract.batchId,
          providerSyncDisposition: providerSyncHandoffContract.disposition,
          providerSyncDeliverySemantic: providerSyncHandoffContract.deliverySemantic,
          providerSyncProofToken: providerSyncHandoffContract.proofToken,
          providerCommitDisposition: providerCommitPlan.disposition,
          providerCommitRoute: providerCommitPlan.commitRoute,
          providerCommitSequence: providerCommitPlan.sequence.map((step) => step.step),
          providerCommitProofToken: providerCommitPlan.proofToken,
          persistedRevision: persistedState.revision,
          nextPersistedRevision: persistedState.nextRevision,
          persistedCommandKeyConflict: persistedState.commandKeyConflict,
          persistedStableSnapshot: persistedState.stableSnapshot,
          persistedStateProofToken: persistedState.proofToken
        }
      : null
  };
}

function buildWorkflowHandoff(command, clientState, requestWorkflowState, requestContinuation, acceptance, readiness, lifecycleControls, lifecycleCommandPlan, nextAction, boundary, boundaryAuditHandoff, providerNegotiation, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, operationalHealth, now) {
  const routeBase = `${surfaceGroup}/${surfaceName}`;
  const terminalRoute = acceptance.accepted
    ? `${routeBase}/${command === "flush" ? "flush" : "commit"}`
    : acceptance.routeHint;
  const userVisibleStatus = acceptance.accepted
    ? command === "flush"
      ? "Ready to flush episodic memory into the hosted kernel."
      : "Ready to apply episodic log adapter settings."
    : readiness.status === "attention-required"
      ? "Action is waiting for operator attention."
      : "Preview is ready for review.";

  return {
    contract: "episodic-log.workflow-handoff.v1",
    target: clientState.handoffTarget,
    clientSurface: clientState.clientSurface,
    requestId: clientState.requestId,
    sessionId: clientState.sessionId,
    correlationId: requestWorkflowState.correlationId,
    continuationKey: requestContinuation.continuationKey,
    actor: clientState.actor,
    offline: clientState.offline,
    createdAt: now,
    resume: {
      route: clientState.returnRoute || terminalRoute,
      token: clientState.resumeToken,
      method: acceptance.accepted ? "POST" : "GET",
      requiredDecision: acceptance.accepted ? "commit" : "accept-or-reject",
      returnMode: requestContinuation.returnMode,
      handoffKind: requestContinuation.handoffKind
    },
    payload: {
      command,
      workflowIntent: requestContinuation.intent,
      workflowPriority: requestContinuation.priority,
      continuationStatus: requestContinuation.status,
      nextClientAction: requestContinuation.nextClientAction,
      shouldWakeClient: requestContinuation.shouldWakeClient,
      lifecycleState: lifecycleControls.state,
      lifecycleReason: lifecycleControls.reason,
      nextAction: nextAction.action,
      dueAt: nextAction.dueAt,
      operationalHealth: {
        status: operationalHealth.status,
        writeDisposition: operationalHealth.writeDisposition,
        captureDisposition: operationalHealth.captureDisposition,
        circuitOpen: operationalHealth.circuitBreaker.open,
        retryAt: operationalHealth.retry.retryAt,
        proofToken: operationalHealth.proofToken
      },
      schedule: lifecycleControls.scheduleControls,
      flushPermissions: lifecycleControls.flushPermissions,
      lifecycleCommandPlan: {
        disposition: lifecycleCommandPlan.disposition,
        transition: lifecycleCommandPlan.transition,
        scheduleGate: lifecycleCommandPlan.scheduleGate.status,
        scheduleHealth: lifecycleCommandPlan.scheduleGate.scheduleHealth,
        nextScheduledFlushAt: lifecycleCommandPlan.scheduleGate.nextScheduledFlushAt,
        earliestFlushAt: lifecycleCommandPlan.scheduleGate.earliestFlushAt,
        route: lifecycleCommandPlan.route,
        proofToken: lifecycleCommandPlan.proofToken,
        blockers: lifecycleCommandPlan.blockers
      },
      readiness: readiness.status,
      accepted: acceptance.accepted,
      canFlushNow: readiness.canFlushNow,
      tenantBoundary: boundary.handoffScope,
      permissionAllowed: boundary.permission.allowed,
      boundaryAuditHandoff: {
        disposition: boundaryAuditHandoff.disposition,
        externalHandoff: boundaryAuditHandoff.externalHandoff,
        scopeSubject: boundaryAuditHandoff.scopeSubject,
        route: boundaryAuditHandoff.route,
        blockers: boundaryAuditHandoff.blockers,
        proofToken: boundaryAuditHandoff.proofToken
      },
      provider: {
        providerId: providerNegotiation.providerId,
        state: providerNegotiation.state,
        syncStatus: providerNegotiation.syncStatus,
        proofToken: providerNegotiation.proofToken
      },
      providerService: {
        serviceId: providerServiceContract.serviceId,
        contractVersion: providerServiceContract.contractVersion,
        routes: providerServiceContract.routes,
        leaseValid: providerServiceContract.capabilityLease.valid,
        ackMode: providerServiceContract.ackMode,
        ackRequired: providerServiceContract.syncMetadata.ackRequired,
        nextCursor: providerServiceContract.syncMetadata.nextCursor,
        proofToken: providerServiceContract.proofToken,
        blockers: providerServiceContract.blockers
      },
      providerSyncHandoff: {
        contract: providerSyncHandoffContract.contract,
        batchId: providerSyncHandoffContract.batchId,
        disposition: providerSyncHandoffContract.disposition,
        deliverySemantic: providerSyncHandoffContract.deliverySemantic,
        handoffMode: providerSyncHandoffContract.handoffMode,
        deliveryAttempt: providerSyncHandoffContract.deliveryAttempt,
        routes: providerSyncHandoffContract.routes,
        cursorState: providerSyncHandoffContract.cursorState,
        proofToken: providerSyncHandoffContract.proofToken,
        blockers: providerSyncHandoffContract.blockers
      },
      providerCommitPlan: {
        contract: providerCommitPlan.contract,
        disposition: providerCommitPlan.disposition,
        mode: providerCommitPlan.mode,
        commitRoute: providerCommitPlan.commitRoute,
        rollbackRoute: providerCommitPlan.rollbackRoute,
        operationFlags: providerCommitPlan.operationFlags,
        cursorCommit: providerCommitPlan.cursorCommit,
        sequence: providerCommitPlan.sequence,
        proofToken: providerCommitPlan.proofToken,
        blockers: providerCommitPlan.blockers
      },
      persistence: {
        storageKey: persistedState.storageKey,
        commandKey: persistedState.commandKey,
        restartSafeStatus: persistedState.restartSafeStatus,
        duplicateCommand: persistedState.duplicateCommand,
        revision: persistedState.revision,
        nextRevision: persistedState.nextRevision,
        recoveryRequired: persistedState.recovery.required,
        recoveryCursor: persistedState.recovery.resumeCursor
      },
      externalHandoff: providerServiceContract.externalHandoffState
    },
    clientWorkflow: {
      contract: requestContinuation.contract,
      status: requestContinuation.status,
      intent: requestContinuation.intent,
      priority: requestContinuation.priority,
      returnMode: requestContinuation.returnMode,
      handoffKind: requestContinuation.handoffKind,
      continuationKey: requestContinuation.continuationKey,
      correlationId: requestContinuation.correlationId,
      parentRequestId: requestContinuation.parentRequestId,
      clientCheckpoint: requestContinuation.clientCheckpoint,
      workflowDeadlineAt: requestContinuation.workflowDeadlineAt,
      userVisibleLabel: requestContinuation.userVisibleLabel,
      observedState: requestContinuation.observedState,
      preconditions: requestContinuation.preconditions,
      proofToken: requestContinuation.proofToken,
      blockers: requestContinuation.blockers
    },
    userVisibleStatus
  };
}

function buildExplainableNextSteps(readiness, acceptance, lifecycleControls, nextAction, handoff, operationalHealth, providerNegotiation, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, requestContinuation) {
  if (persistedState.commandKeyConflict) {
    return [{
      id: "resolve-idempotency-key-conflict",
      label: "Resolve idempotency key conflict",
      reason: "the supplied idempotency key is already bound to a different persisted episodic command",
      route: `${surfaceGroup}/${surfaceName}/recovery/idempotency`
    }];
  }
  if (persistedState.recovery.required) {
    return [{
      id: "recover-persisted-state",
      label: "Recover persisted state",
      reason: `restart recovery is required because ${persistedState.recovery.reason}`,
      route: persistedState.recovery.route
    }];
  }
  if (persistedState.duplicateCommand) {
    return [{
      id: "return-idempotent-status",
      label: "Return replay status",
      reason: "this idempotency key was already applied, so the adapter should return the persisted result without another write",
      route: handoff.resume.route
    }];
  }
  if (operationalHealth.actionableErrors.length > 0) {
    return operationalHealth.actionableErrors.map((error) => ({
      id: error.code,
      label: error.code.replaceAll("-", " "),
      reason: error.message,
      route: error.route
    }));
  }
  if (operationalHealth.circuitBreaker.open) {
    const requiredRunbookStep = operationalHealth.runbook.find((step) => step.requiredBeforeRetry) || operationalHealth.runbook[0];
    return [{
      id: requiredRunbookStep?.id || "reset-health-circuit",
      label: requiredRunbookStep?.label || "Reset health circuit",
      reason: `episodic log retries are held because ${operationalHealth.circuitBreaker.reason}`,
      route: requiredRunbookStep?.route || operationalHealth.circuitBreaker.resetRoute
    }];
  }
  if (operationalHealth.retry.scheduled) {
    return [{ id: "retry-health-check", label: "Retry health check", reason: operationalHealth.retry.reason, route: operationalHealth.nextHealthAction.route }];
  }
  if (requestContinuation.blockers.includes("workflow-revision-precondition-failed")) {
    return [{
      id: "refresh-workflow-revision",
      label: "Refresh request state",
      reason: "the client continuation expected a different persisted revision than the hosted-kernel state currently exposes",
      route: handoff.resume.route
    }];
  }
  if (requestContinuation.blockers.includes("workflow-cursor-precondition-failed")) {
    return [{
      id: "refresh-workflow-cursor",
      label: "Refresh request cursor",
      reason: "the client continuation expected a different episodic cursor than the provider service returned",
      route: handoff.resume.route
    }];
  }
  if (requestContinuation.blockers.includes("workflow-flush-not-ready")) {
    return [{
      id: "wait-for-flush-readiness",
      label: "Wait for flush readiness",
      reason: "the client requested a flush continuation before the lifecycle schedule was ready to flush",
      route: `${surfaceGroup}/${surfaceName}/lifecycle`
    }];
  }
  if (requestContinuation.blockers.includes("workflow-recovery-not-required")) {
    return [{
      id: "return-current-status",
      label: "Return current status",
      reason: "the client requested recovery, but the persisted episodic state is already restart-safe",
      route: handoff.resume.route
    }];
  }
  if (lifecycleControls.blockers.includes("lifecycle-paused")) {
    return [{ id: "resume-lifecycle", label: "Resume lifecycle", reason: `episodic capture is paused for ${lifecycleControls.reason || "operator review"}`, route: lifecycleControls.nextControlRoute }];
  }
  if (lifecycleControls.blockers.includes("schedule-suspended")) {
    return [{ id: "resume-schedule", label: "Resume schedule", reason: "scheduled episodic flushes are suspended by lifecycle controls", route: lifecycleControls.nextControlRoute }];
  }
  if (lifecycleControls.blockers.includes("manual-flush-disabled")) {
    return [{ id: "enable-manual-flush", label: "Enable manual flush", reason: "the flush command cannot run while manual flush is disabled", route: lifecycleControls.nextControlRoute }];
  }
  if (lifecycleControls.blockers.includes("automatic-flush-disabled")) {
    return [{ id: "run-manual-flush", label: "Run manual flush", reason: "automatic flushing is disabled, so the adapter is waiting for an explicit flush command", route: `${surfaceGroup}/${surfaceName}/flush` }];
  }
  if (readiness.blockers.includes("disable-drain-requires-flush")) {
    return [{ id: "flush-before-disable", label: "Flush before disable", reason: "the disable command requested a drain-first lifecycle transition while pending episodes remain", route: `${surfaceGroup}/${surfaceName}/flush` }];
  }
  if (readiness.blockers.includes("hold-flush-requested-but-manual-flush-disabled")) {
    return [{ id: "enable-manual-flush-for-hold", label: "Enable manual flush", reason: "the lifecycle hold requested a flush first, but manual flush is disabled", route: lifecycleControls.nextControlRoute }];
  }
  if (readiness.blockers.includes("manual-schedule-token-required")) {
    return [{ id: "add-manual-flush-token", label: "Add manual flush token", reason: "manual scheduling requires an explicit flush token for this lifecycle command plan", route: lifecycleControls.nextControlRoute }];
  }
  if (readiness.blockers.includes("automatic-control-requires-automatic-flush")) {
    return [{ id: "enable-automatic-flush", label: "Enable automatic flush", reason: "automatic lifecycle control cannot proceed while automatic flushing is disabled", route: lifecycleControls.nextControlRoute }];
  }
  if (readiness.blockers.includes("maintenance-control-requires-maintenance-reason")) {
    return [{ id: "set-maintenance-reason", label: "Set maintenance reason", reason: "maintenance lifecycle control requires the maintenance-window reason", route: lifecycleControls.nextControlRoute }];
  }
  if (readiness.blockers.includes("flush-before-scheduled-window")) {
    return [{
      id: "wait-for-scheduled-flush-window",
      label: "Wait for flush window",
      reason: "early flush is disabled until the configured schedule lead window opens",
      route: lifecycleControls.nextControlRoute
    }];
  }
  if (readiness.blockers.includes("automatic-interval-control-requires-next-flush")) {
    return [{
      id: "set-next-scheduled-flush",
      label: "Set next flush time",
      reason: "automatic interval lifecycle control requires a parseable nextScheduledFlushAt value",
      route: lifecycleControls.nextControlRoute
    }];
  }
  if (readiness.blockers.includes("interval-schedule-outside-drift-budget")) {
    return [{
      id: "adjust-flush-schedule",
      label: "Adjust flush schedule",
      reason: "the next scheduled flush is outside the configured interval and drift grace budget",
      route: lifecycleControls.nextControlRoute
    }];
  }
  if (providerNegotiation.blockers.includes("provider-offline")) {
    return [{ id: "reconnect-provider", label: "Reconnect provider", reason: "episodic log provider is offline and cannot accept hosted-kernel commits", route: `${surfaceGroup}/${surfaceName}/provider` }];
  }
  if (providerNegotiation.blockers.includes("provider-read-only")) {
    return [{ id: "select-writable-provider", label: "Select writable provider", reason: "the negotiated provider is read-only for mutating episodic log commands", route: `${surfaceGroup}/${surfaceName}/provider` }];
  }
  const missingProviderCapability = providerNegotiation.missingCapabilities[0];
  if (missingProviderCapability) {
    return [{ id: "renegotiate-provider-capability", label: "Renegotiate provider", reason: `provider must grant ${missingProviderCapability} before this adapter can commit`, route: `${surfaceGroup}/${surfaceName}/provider` }];
  }
  if (providerServiceContract.blockers.includes("hosted-kernel-proof-export-required")) {
    return [{ id: "grant-proof-export", label: "Grant proof export", reason: "hosted-kernel episodic commits require proof-export so audit records can be replayed after handoff", route: providerServiceContract.routes.proof }];
  }
  if (providerServiceContract.blockers.includes("provider-service-awaiting-revision-ack")) {
    return [{ id: "ack-provider-revision", label: "Acknowledge revision", reason: "the provider service is waiting for the required durable revision before accepting the next command", route: providerServiceContract.routes.acknowledge }];
  }
  if (providerServiceContract.blockers.includes("provider-service-cursor-ack-pending")) {
    return [{ id: "ack-provider-cursor", label: "Acknowledge cursor", reason: "the previous episodic log cursor must be acknowledged before another hosted-kernel commit", route: providerServiceContract.routes.acknowledge }];
  }
  if (providerServiceContract.blockers.includes("provider-service-handoff-route-required")) {
    return [{ id: "add-handoff-route", label: "Add handoff route", reason: "external handoff is required but no return route or provider handoff route was supplied", route: `${surfaceGroup}/${surfaceName}/handoff` }];
  }
  if (providerSyncHandoffContract.blockers.includes("exactly-once-sync-requires-ack-mode")) {
    return [{ id: "enable-provider-ack", label: "Enable provider ack", reason: "exactly-once hosted-kernel sync requires cursor or revision acknowledgements", route: providerSyncHandoffContract.routes.acknowledgement }];
  }
  if (providerSyncHandoffContract.blockers.includes("remote-watermark-stale-before-mutation")) {
    return [{ id: "refresh-provider-watermark", label: "Refresh provider watermark", reason: "the remote episodic watermark is stale and must be acknowledged before another mutation", route: providerSyncHandoffContract.routes.acknowledgement }];
  }
  if (providerSyncHandoffContract.blockers.includes("handoff-cursor-already-delivered")) {
    return [{ id: "return-delivered-handoff", label: "Return delivered handoff", reason: "the next episodic cursor has already been delivered for this hosted-kernel handoff batch", route: handoff.resume.route }];
  }
  if (providerSyncHandoffContract.blockers.includes("sync-handoff-payload-route-required") || providerSyncHandoffContract.blockers.includes("callback-handoff-route-required")) {
    return [{ id: "add-sync-handoff-route", label: "Add handoff route", reason: "the hosted-kernel sync handoff needs a callback or queue route before payload delivery", route: `${surfaceGroup}/${surfaceName}/handoff` }];
  }
  if (providerSyncHandoffContract.blockers.includes("sync-handoff-capability-missing")) {
    return [{ id: "grant-sync-handoff-capability", label: "Grant handoff capability", reason: "the provider must grant external-handoff before queued sync payloads can be delivered", route: `${surfaceGroup}/${surfaceName}/provider` }];
  }
  if (providerCommitPlan.blockers.includes("commit-plan-persisted-state-not-writable")) {
    return [{ id: "refresh-commit-state", label: "Refresh commit state", reason: "the provider commit plan cannot write until the persisted episodic state is writable", route: `${surfaceGroup}/${surfaceName}/state` }];
  }
  if (providerCommitPlan.blockers.includes("commit-plan-idempotency-conflict-held")) {
    return [{ id: "resolve-commit-idempotency", label: "Resolve idempotency", reason: "the provider commit plan is holding the write because the command key conflicts with existing durable state", route: `${surfaceGroup}/${surfaceName}/recovery/idempotency` }];
  }
  if (providerCommitPlan.blockers.includes("commit-plan-capability-lease-invalid")) {
    return [{ id: "refresh-provider-lease", label: "Refresh provider lease", reason: "the provider capability lease must be valid before the commit sequence can run", route: `${surfaceGroup}/${surfaceName}/provider` }];
  }
  if (providerCommitPlan.blockers.includes("commit-plan-sync-handoff-blocked")) {
    return [{ id: "resolve-commit-sync-handoff", label: "Resolve sync handoff", reason: "the provider commit plan is blocked until sync handoff delivery is unblocked", route: `${surfaceGroup}/${surfaceName}/handoff` }];
  }
  if (providerCommitPlan.blockers.includes("commit-plan-proof-export-capability-missing")) {
    return [{ id: "grant-commit-proof-export", label: "Grant proof export", reason: "the provider commit plan requires proof export for the durable commit bundle", route: providerServiceContract.routes.proof }];
  }
  if (readiness.blockers.includes("audit-external-handoff-requires-tenant-scope")) {
    return [{ id: "add-audit-tenant-scope", label: "Add tenant scope", reason: "external episodic handoffs require an auditable tenant boundary", route: `${surfaceGroup}/${surfaceName}/audit/boundary` }];
  }
  if (readiness.blockers.includes("audit-external-handoff-requires-workspace-scope")) {
    return [{ id: "add-audit-workspace-scope", label: "Add workspace scope", reason: "external episodic handoffs require workspace scope for this audit policy", route: `${surfaceGroup}/${surfaceName}/audit/boundary` }];
  }
  if (readiness.blockers.includes("audit-tenant-not-in-allowed-set") || readiness.blockers.includes("audit-workspace-not-in-allowed-set")) {
    return [{ id: "update-audit-allow-list", label: "Update audit allow list", reason: "the requested tenant or workspace is outside the handoff audit allow-list", route: `${surfaceGroup}/${surfaceName}/audit/boundary` }];
  }
  if (readiness.blockers.includes("audit-full-capture-external-handoff-denied")) {
    return [{ id: "use-maintainer-for-full-capture-handoff", label: "Use permitted role", reason: "full capture external handoff requires a maintainer or kernel role in the boundary audit", route: `${surfaceGroup}/${surfaceName}/permissions` }];
  }
  if (readiness.blockers.includes("audit-sync-handoff-blocked")) {
    return [{ id: "resolve-sync-before-audit-handoff", label: "Resolve sync handoff", reason: "boundary audit is holding delivery until the provider sync handoff is unblocked", route: `${surfaceGroup}/${surfaceName}/handoff` }];
  }
  if (readiness.blockers.includes("audit-policy-denied-handoff") || readiness.blockers.includes("audit-policy-held-handoff")) {
    return [{ id: "review-boundary-audit-policy", label: "Review audit policy", reason: "the boundary audit policy explicitly denied or held this episodic handoff", route: `${surfaceGroup}/${surfaceName}/audit/boundary` }];
  }
  if (acceptance.accepted && nextAction.action === "flush-episodic-buffer") {
    return [{ id: "flush-now", label: "Flush episodic buffer", reason: nextAction.reason, route: handoff.resume.route }];
  }
  if (readiness.blockers.includes("tenant-id-required")) {
    return [{ id: "add-tenant-scope", label: "Add tenant scope", reason: "mutating episodic log operations require an explicit tenant boundary", route: `${surfaceGroup}/${surfaceName}/scope` }];
  }
  if (readiness.blockers.includes("workspace-id-required")) {
    return [{ id: "add-workspace-scope", label: "Add workspace scope", reason: "workspace isolation requires an explicit workspace id", route: `${surfaceGroup}/${surfaceName}/scope` }];
  }
  if (readiness.blockers.includes("cross-tenant-boundary-denied")) {
    return [{ id: "remove-cross-tenant-request", label: "Use one tenant boundary", reason: "episodic log handoff cannot cross tenant boundaries", route: `${surfaceGroup}/${surfaceName}/scope` }];
  }
  const roleBlocker = readiness.blockers.find((blocker) => blocker.startsWith("role-") || blocker === "full-capture-requires-maintainer");
  if (roleBlocker) {
    return [{ id: "request-elevated-role", label: "Use permitted actor role", reason: "the requested command is outside the actor role permission boundary", route: `${surfaceGroup}/${surfaceName}/permissions` }];
  }
  if (acceptance.decision === "preview") {
    return [{ id: "review-preview", label: "Review and accept preview", reason: "changes are staged for operator confirmation", route: handoff.resume.route }];
  }
  if (readiness.blockers.includes("adapter-disabled")) {
    return [{ id: "enable-adapter", label: "Enable adapter", reason: "disabled adapters do not flush hosted-kernel episodes", route: `${surfaceGroup}/${surfaceName}/lifecycle` }];
  }
  return [{ id: nextAction.action, label: nextAction.action.replaceAll("-", " "), reason: nextAction.reason, route: `${surfaceGroup}/${surfaceName}/lifecycle` }];
}

function buildOperatorDecisionPacket(command, preview, readiness, validationSummary, acceptance, nextSteps, workflowHandoff, requestContinuation, boundaryAuditHandoff, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, episodeEnvelope, now) {
  const confirmationRequired = acceptance.requiresConfirmation && !acceptance.accepted;
  const primaryNextStep = nextSteps[0] || {
    id: "render-preview",
    label: "Render preview",
    reason: "the adapter preview is available for operator review",
    route: workflowHandoff.resume.route
  };
  const blockingAcknowledgements = readiness.blockers.slice(0, 8).map((blocker) => ({
    id: blocker,
    label: blocker.replaceAll("-", " "),
    required: true,
    reason: "resolve this blocker before accepting the episodic log preview"
  }));
  const rejectedAcknowledgements = episodeEnvelope.rejected.slice(0, 8).map((rejection) => ({
    id: `episode-${rejection.episodeId}`,
    label: `Rejected episode ${rejection.episodeId}`,
    required: true,
    reason: rejection.reasons.join(", ") || "episode failed adapter validation"
  }));
  const auditAcknowledgements = boundaryAuditHandoff.blockers.slice(0, 6).map((blocker) => ({
    id: `boundary-${blocker}`,
    label: blocker.replaceAll("-", " "),
    required: true,
    reason: "resolve this boundary audit blocker before handoff delivery"
  }));
  const actions = [
    {
      id: "accept-preview",
      label: command === "flush" ? "Accept and flush" : "Accept changes",
      method: "POST",
      route: `${surfaceGroup}/${surfaceName}/accept`,
      enabled: readiness.canAcceptPreview && confirmationRequired,
      payload: {
        acceptance: "accepted",
        command,
        continuationKey: requestContinuation.continuationKey,
        commandKey: persistedState.commandKey,
        expectedRevision: persistedState.revision,
        expectedCursor: providerServiceContract.syncMetadata.localWatermark,
        nextCursor: providerServiceContract.syncMetadata.nextCursor,
        providerSyncBatchId: providerSyncHandoffContract.batchId,
        providerCommitProofToken: providerCommitPlan.proofToken,
        boundaryAuditProofToken: boundaryAuditHandoff.proofToken
      },
      disabledReason: readiness.canAcceptPreview
        ? null
        : readiness.blockers[0] || "preview-not-acceptable"
    },
    {
      id: "reject-preview",
      label: "Reject",
      method: "POST",
      route: `${surfaceGroup}/${surfaceName}/preview`,
      enabled: confirmationRequired,
      payload: {
        acceptance: "rejected",
        command,
        continuationKey: requestContinuation.continuationKey,
        commandKey: persistedState.commandKey
      },
      disabledReason: confirmationRequired ? null : "no-confirmation-required"
    },
    {
      id: primaryNextStep.id,
      label: primaryNextStep.label,
      method: "GET",
      route: primaryNextStep.route,
      enabled: true,
      payload: {
        reason: primaryNextStep.reason,
        continuationKey: requestContinuation.continuationKey
      },
      disabledReason: null
    }
  ];

  return {
    contract: "episodic-log.operator-decision-packet.v1",
    generatedAt: now,
    title: preview.title,
    status: acceptance.accepted
      ? "accepted"
      : readiness.status === "ready"
        ? "awaiting-operator"
        : "blocked",
    confirmationRequired,
    decision: acceptance.decision,
    accepted: acceptance.accepted,
    routeHint: acceptance.routeHint,
    submitRoute: workflowHandoff.resume.route,
    userMessage: acceptance.accepted
      ? workflowHandoff.userVisibleStatus
      : readiness.status === "ready"
        ? preview.confirmationText
        : "Resolve the listed blockers before accepting this episodic log preview.",
    validation: {
      status: validationSummary.status,
      warningCount: validationSummary.warningCount,
      warningPreview: validationSummary.warnings.slice(0, 6)
    },
    readiness: {
      status: readiness.status,
      canAcceptPreview: readiness.canAcceptPreview,
      canFlushNow: readiness.canFlushNow,
      lifecycleState: readiness.lifecycleState,
      lifecycleScheduleHealth: readiness.lifecycleScheduleHealth,
      nextScheduledFlushAt: readiness.nextScheduledFlushAt,
      earliestFlushAt: readiness.earliestFlushAt,
      providerState: readiness.providerState,
      requestContinuationStatus: readiness.requestContinuationStatus
    },
    acknowledgementChecklist: [
      ...blockingAcknowledgements,
      ...rejectedAcknowledgements,
      ...auditAcknowledgements
    ],
    nextStepPreview: nextSteps.slice(0, 5).map((step) => ({
      id: step.id,
      label: step.label,
      reason: step.reason,
      route: step.route
    })),
    actions,
    durablePreview: {
      storageKey: persistedState.storageKey,
      commandKey: persistedState.commandKey,
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      providerSyncBatchId: providerSyncHandoffContract.batchId,
      providerCommitDisposition: providerCommitPlan.disposition,
      providerCommitRoute: providerCommitPlan.commitRoute,
      providerCommitSequence: providerCommitPlan.sequence.map((step) => step.step),
      providerCommitProofToken: providerCommitPlan.proofToken,
      boundaryAuditDisposition: boundaryAuditHandoff.disposition,
      boundaryAuditScopeSubject: boundaryAuditHandoff.scopeSubject,
      boundaryAuditProofToken: boundaryAuditHandoff.proofToken,
      acceptedEpisodes: episodeEnvelope.acceptedCount,
      rejectedEpisodes: episodeEnvelope.rejectedCount
    },
    proofToken: proofTokenFor({
      command,
      decision: acceptance.decision,
      readiness: readiness.status,
      continuationKey: requestContinuation.continuationKey,
      commandKey: persistedState.commandKey,
      nextRevision: persistedState.nextRevision,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      providerSyncBatchId: providerSyncHandoffContract.batchId,
      providerCommitProofToken: providerCommitPlan.proofToken,
      boundaryAuditDisposition: boundaryAuditHandoff.disposition,
      boundaryAuditProofToken: boundaryAuditHandoff.proofToken,
      generatedAt: now
    })
  };
}

function buildClientHandoffReceipt(input = {}, clientState, requestContinuation, workflowHandoff, operatorDecisionPacket, acceptance, readiness, providerServiceContract, providerSyncHandoffContract, persistedState, episodeEnvelope, now) {
  const source = input.handoffReceipt
    || input.clientState?.handoffReceipt
    || input.client?.handoffReceipt
    || input.runtime?.handoffReceipt
    || input.workflow?.handoffReceipt
    || {};
  const requestedChannel = typeof source.channel === "string"
    ? source.channel.trim().toLowerCase()
    : requestContinuation.returnMode === "inline"
      ? "inline"
      : clientState.handoffTarget === "scheduler"
        ? "scheduler-queue"
        : clientState.handoffTarget === "kernel"
          ? "kernel-queue"
          : "callback";
  const channel = allowedClientReceiptChannels.has(requestedChannel) ? requestedChannel : "inline";
  const requestedAckPolicy = typeof source.ackPolicy === "string"
    ? source.ackPolicy.trim().toLowerCase()
    : acceptance.accepted || providerServiceContract.syncMetadata.ackRequired
      ? "on-commit"
      : requestContinuation.returnMode === "inline"
        ? "none"
        : "on-delivery";
  const ackPolicy = allowedClientReceiptAckPolicies.has(requestedAckPolicy) ? requestedAckPolicy : "on-delivery";
  const receiptId = normalizeText(
    source.receiptId,
    `${requestContinuation.continuationKey}:receipt:${persistedState.nextRevision}`,
    { maxLength: 220 }
  );
  const ackRoute = normalizeText(
    source.ackRoute ?? source.acknowledgementRoute,
    providerServiceContract.routes.acknowledge,
    { maxLength: 220 }
  );
  const deliverRoute = normalizeText(
    source.deliverRoute ?? source.deliveryRoute,
    workflowHandoff.resume.route,
    { maxLength: 220 }
  );
  const ackDeadlineAt = normalizeText(source.ackDeadlineAt ?? source.deadlineAt, null, { maxLength: 40 });
  const includeOperatorDecision = normalizeBoolean(source.includeOperatorDecision, true);
  const includeDurableCursor = normalizeBoolean(source.includeDurableCursor, true);
  const warnings = [];
  const blockers = [];

  if (source.channel !== undefined && channel !== requestedChannel) {
    warnings.push(`handoff receipt channel "${source.channel}" was normalized to inline`);
  }
  if (source.ackPolicy !== undefined && ackPolicy !== requestedAckPolicy) {
    warnings.push(`handoff receipt ackPolicy "${source.ackPolicy}" was normalized to on-delivery`);
  }
  if (channel === "callback" && !deliverRoute) {
    blockers.push("client-receipt-callback-route-required");
  }
  if (ackPolicy !== "none" && !ackRoute) {
    blockers.push("client-receipt-ack-route-required");
  }
  if (ackPolicy === "on-commit" && !acceptance.accepted && readiness.status !== "ready") {
    blockers.push("client-receipt-commit-ack-waiting-on-readiness");
  }

  const status = blockers.length > 0
    ? "blocked"
    : ackPolicy === "none"
      ? "deliverable"
      : acceptance.accepted
        ? "awaiting-ack"
        : "staged";

  return {
    contract: "episodic-log.client-handoff-receipt.v1",
    generatedAt: now,
    receiptId,
    status,
    channel,
    ackPolicy,
    clientSurface: clientState.clientSurface,
    handoffTarget: clientState.handoffTarget,
    requestId: clientState.requestId,
    sessionId: clientState.sessionId,
    continuationKey: requestContinuation.continuationKey,
    correlationId: requestContinuation.correlationId,
    routes: {
      deliver: deliverRoute,
      acknowledge: ackRoute,
      resume: workflowHandoff.resume.route
    },
    acknowledgement: {
      required: ackPolicy !== "none",
      policy: ackPolicy,
      deadlineAt: ackDeadlineAt,
      providerAckRequired: providerServiceContract.syncMetadata.ackRequired,
      providerSyncDisposition: providerSyncHandoffContract.disposition,
      nextCursor: includeDurableCursor ? providerServiceContract.syncMetadata.nextCursor : null,
      batchId: providerSyncHandoffContract.batchId
    },
    visiblePayload: {
      includeOperatorDecision,
      operatorDecisionStatus: includeOperatorDecision ? operatorDecisionPacket.status : null,
      primaryActionId: operatorDecisionPacket.actions.find((action) => action.enabled)?.id || null,
      userMessage: operatorDecisionPacket.userMessage,
      acceptedEpisodes: episodeEnvelope.acceptedCount,
      rejectedEpisodes: episodeEnvelope.rejectedCount,
      readiness: readiness.status,
      accepted: acceptance.accepted
    },
    blockers,
    warnings,
    proofToken: proofTokenFor({
      receiptId,
      status,
      channel,
      ackPolicy,
      continuationKey: requestContinuation.continuationKey,
      commandKey: persistedState.commandKey,
      nextRevision: persistedState.nextRevision,
      nextCursor: includeDurableCursor ? providerServiceContract.syncMetadata.nextCursor : null,
      batchId: providerSyncHandoffContract.batchId,
      generatedAt: now
    })
  };
}

function normalizeCounterSource(input = {}) {
  const source = input.analytics || input.counters || input.metrics || {};
  const acceptedEpisodes = clampInteger(source.acceptedEpisodes ?? source.accepted ?? source.ingested, 0, { min: 0, max: 10000000 });
  const flushedEpisodes = clampInteger(source.flushedEpisodes ?? source.flushed, 0, { min: 0, max: 10000000 });
  const rejectedEpisodes = clampInteger(source.rejectedEpisodes ?? source.rejected, 0, { min: 0, max: 10000000 });
  const droppedEpisodes = clampInteger(source.droppedEpisodes ?? source.dropped, 0, { min: 0, max: 10000000 });
  const exportRequests = clampInteger(source.exportRequests ?? source.exports, 0, { min: 0, max: 1000000 });
  const exportFailures = clampInteger(source.exportFailures ?? source.failedExports, 0, { min: 0, max: 1000000 });
  const averageFlushMs = clampInteger(source.averageFlushMs ?? source.flushLatencyMs, 0, { min: 0, max: 600000 });
  const lastExportAt = normalizeText(source.lastExportAt, null, { maxLength: 40 });
  const warnings = [];

  for (const [field, value] of Object.entries({
    acceptedEpisodes: source.acceptedEpisodes ?? source.accepted ?? source.ingested,
    flushedEpisodes: source.flushedEpisodes ?? source.flushed,
    rejectedEpisodes: source.rejectedEpisodes ?? source.rejected,
    droppedEpisodes: source.droppedEpisodes ?? source.dropped,
    exportRequests: source.exportRequests ?? source.exports,
    exportFailures: source.exportFailures ?? source.failedExports,
    averageFlushMs: source.averageFlushMs ?? source.flushLatencyMs
  })) {
    if (value !== undefined && Number(value) !== {
      acceptedEpisodes,
      flushedEpisodes,
      rejectedEpisodes,
      droppedEpisodes,
      exportRequests,
      exportFailures,
      averageFlushMs
    }[field]) {
      warnings.push(`${field} was normalized to a supported non-negative counter range`);
    }
  }

  return {
    counters: {
      acceptedEpisodes,
      flushedEpisodes,
      rejectedEpisodes,
      droppedEpisodes,
      pendingEpisodes: Math.max(0, acceptedEpisodes - flushedEpisodes - droppedEpisodes),
      exportRequests,
      exportFailures,
      successfulExports: Math.max(0, exportRequests - exportFailures),
      averageFlushMs,
      lastExportAt
    },
    warnings
  };
}

function normalizeHistorySnapshots(input = {}, now) {
  const source = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.snapshots)
      ? input.snapshots
      : Array.isArray(input.analytics?.history)
        ? input.analytics.history
        : [];
  const warnings = [];
  const snapshots = source.slice(-12).map((entry, index) => {
    const snapshotAt = normalizeText(entry?.at ?? entry?.snapshotAt, null, { maxLength: 40 }) || now;
    const acceptedEpisodes = clampInteger(entry?.acceptedEpisodes ?? entry?.accepted, 0, { min: 0, max: 10000000 });
    const flushedEpisodes = clampInteger(entry?.flushedEpisodes ?? entry?.flushed, 0, { min: 0, max: 10000000 });
    const queuedEpisodes = clampInteger(entry?.queuedEpisodes ?? entry?.queued, 0, { min: 0, max: 1000000 });
    const healthStatus = allowedHealthStates.has(entry?.healthStatus) ? entry.healthStatus : "healthy";
    const note = normalizeText(entry?.note, null, { maxLength: 120 });

    if (entry?.healthStatus !== undefined && healthStatus !== entry.healthStatus) {
      warnings.push(`history[${index}].healthStatus was normalized to healthy`);
    }

    return {
      contract: "episodic-log.history-snapshot.v1",
      snapshotAt,
      acceptedEpisodes,
      flushedEpisodes,
      queuedEpisodes,
      healthStatus,
      note
    };
  });

  if (source.length > snapshots.length) {
    warnings.push("history was trimmed to the latest 12 snapshots for adapter reporting");
  }

  return { snapshots, warnings };
}

function buildAnalyticsState(counters, history, settings, operationalHealth, readiness, nextAction, episodeEnvelope, now) {
  const latestHistory = history.snapshots.length > 0
    ? history.snapshots[history.snapshots.length - 1]
    : null;
  const acceptedEpisodes = counters.acceptedEpisodes + episodeEnvelope.acceptedCount;
  const rejectedEpisodes = counters.rejectedEpisodes + episodeEnvelope.rejectedCount;
  const pendingEpisodes = Math.max(counters.pendingEpisodes + episodeEnvelope.acceptedCount, operationalHealth.buffer.queuedEpisodes);
  const flushCapacityRemaining = Math.max(0, settings.maxEpisodesPerFlush - pendingEpisodes);
  const exportReliability = counters.exportRequests === 0
    ? 1
    : Number((counters.successfulExports / counters.exportRequests).toFixed(4));
  const captureEfficiency = acceptedEpisodes === 0
    ? 1
    : Number((counters.flushedEpisodes / acceptedEpisodes).toFixed(4));

  return {
    contract: "episodic-log.analytics-state.v1",
    generatedAt: now,
    counters: {
      ...counters,
      acceptedEpisodes,
      rejectedEpisodes,
      pendingEpisodes,
      flushCapacityRemaining
    },
    healthRollup: {
      currentStatus: operationalHealth.status,
      latestHistoryStatus: latestHistory?.healthStatus || null,
      degradedMode: operationalHealth.degradedMode,
      readiness: readiness.status
    },
    ratios: {
      exportReliability,
      captureEfficiency,
      backlogPressure: settings.maxEpisodesPerFlush === 0
        ? 0
        : Number(Math.min(1, pendingEpisodes / settings.maxEpisodesPerFlush).toFixed(4))
    },
    thresholds: {
      maxEpisodesPerFlush: settings.maxEpisodesPerFlush,
      retentionDays: settings.retentionDays,
      nextActionDueAt: nextAction.dueAt
    },
    history: history.snapshots
  };
}

function buildExportSummary(input, analyticsState, tenantBoundary, workflowHandoff, episodeEnvelope, now) {
  const source = input.export || input.exportRequest || {};
  const requestedFormat = typeof source.format === "string" ? source.format.trim().toLowerCase() : "json";
  const format = allowedExportFormats.has(requestedFormat) ? requestedFormat : "json";
  const includeHistory = normalizeBoolean(source.includeHistory, true);
  const includeProof = normalizeBoolean(source.includeProof, true);
  const destination = normalizeText(source.destination, "hosted-kernel-reporting", { maxLength: 120 });
  const exportId = normalizeText(source.exportId, `${surfaceId}:${tenantBoundary.tenantId || "session"}:${Date.parse(now)}`, { maxLength: 180 });
  const warnings = [];

  if (source.format !== undefined && format !== requestedFormat) {
    warnings.push(`export format "${source.format}" was normalized to json`);
  }

  return {
    contract: "episodic-log.export-summary.v1",
    exportId,
    format,
    destination,
    ready: tenantBoundary.permission.allowed,
    includeHistory,
    includeProof,
    route: `${surfaceGroup}/${surfaceName}/exports/${format}`,
    handoffRoute: workflowHandoff.resume.route,
    tenantBoundary: tenantBoundary.handoffScope,
    recordCounts: {
      counters: Object.keys(analyticsState.counters).length,
      historySnapshots: includeHistory ? analyticsState.history.length : 0,
      proofRecords: includeProof ? 1 + episodeEnvelope.proofTokens.length : 0,
      episodeRecords: episodeEnvelope.records.length
    },
    summary: {
      acceptedEpisodes: analyticsState.counters.acceptedEpisodes,
      flushedEpisodes: analyticsState.counters.flushedEpisodes,
      pendingEpisodes: analyticsState.counters.pendingEpisodes,
      exportReliability: analyticsState.ratios.exportReliability,
      healthStatus: analyticsState.healthRollup.currentStatus
    },
    episodeProof: includeProof
      ? {
          contract: "episodic-log.episode-proof.v1",
          acceptedCount: episodeEnvelope.acceptedCount,
          rejectedCount: episodeEnvelope.rejectedCount,
          proofTokens: episodeEnvelope.proofTokens
        }
      : null,
    warnings
  };
}

function buildTimelineReport(analyticsState, exportSummary, nextAction, operationalHealth, now) {
  const historyEvents = analyticsState.history.map((snapshot) => ({
    at: snapshot.snapshotAt,
    type: "history-snapshot",
    label: snapshot.healthStatus,
    queuedEpisodes: snapshot.queuedEpisodes,
    acceptedEpisodes: snapshot.acceptedEpisodes,
    flushedEpisodes: snapshot.flushedEpisodes
  }));

  return {
    contract: "episodic-log.timeline-report.v1",
    generatedAt: now,
    status: operationalHealth.status,
    events: [
      ...historyEvents,
      {
        at: now,
        type: "analytics-rollup",
        label: analyticsState.healthRollup.readiness,
        queuedEpisodes: analyticsState.counters.pendingEpisodes,
        acceptedEpisodes: analyticsState.counters.acceptedEpisodes,
        flushedEpisodes: analyticsState.counters.flushedEpisodes
      },
      {
        at: nextAction.dueAt || now,
        type: "next-action",
        label: nextAction.action,
        route: `${surfaceGroup}/${surfaceName}/lifecycle`,
        exportReady: exportSummary.ready
      }
    ].sort((left, right) => String(left.at).localeCompare(String(right.at))),
    reportState: {
      exportReady: exportSummary.ready,
      exportFormat: exportSummary.format,
      backlogPressure: analyticsState.ratios.backlogPressure,
      retryScheduled: operationalHealth.retry.scheduled,
      retryAt: operationalHealth.retry.retryAt
    }
  };
}

function incrementCounter(counter, key, amount = 1) {
  const normalizedKey = normalizeText(key, "unknown", { maxLength: 80 });
  counter[normalizedKey] = (counter[normalizedKey] || 0) + amount;
}

function buildAnalyticsReportingSnapshot(analyticsState, exportSummary, timelineReport, episodeEnvelope, durableRunEventJournal, providerServiceContract, providerSyncHandoffContract, boundaryAuditHandoff, now) {
  const acceptedRecords = episodeEnvelope.records.filter((record) => record.accepted);
  const rejectedRecords = episodeEnvelope.records.filter((record) => !record.accepted);
  const episodeTypeCounts = {};
  const severityCounts = {};
  const rejectionReasonCounts = {};
  const redactionCounts = {
    redacted: 0,
    storedContent: 0,
    metadataOnly: 0
  };

  for (const record of acceptedRecords) {
    incrementCounter(episodeTypeCounts, record.type);
    incrementCounter(severityCounts, record.severity);
    if (record.capture.content) {
      redactionCounts.storedContent += 1;
    } else if (record.capture.redacted) {
      redactionCounts.redacted += 1;
    } else {
      redactionCounts.metadataOnly += 1;
    }
  }
  for (const record of rejectedRecords) {
    for (const reason of record.rejectedReasons) {
      incrementCounter(rejectionReasonCounts, reason);
    }
  }

  const committedEventCount = durableRunEventJournal.appendDisposition === "append"
    ? durableRunEventJournal.appendRecords.length
    : 0;
  const heldEventCount = durableRunEventJournal.appendDisposition === "hold"
    ? durableRunEventJournal.appendRecords.length + durableRunEventJournal.rejectedRecords.length
    : 0;
  const latestTimelineEvent = timelineReport.events[timelineReport.events.length - 1] || null;
  const partitionDate = String(now).slice(0, 10);
  const partitionScope = [
    exportSummary.tenantBoundary.tenantId || "session",
    exportSummary.tenantBoundary.workspaceId || exportSummary.tenantBoundary.isolationMode,
    exportSummary.tenantBoundary.projectId || "default"
  ].join("/");
  const exportWatermark = providerServiceContract.syncMetadata.nextCursor
    || providerSyncHandoffContract.cursorState.nextCursor
    || `${exportSummary.exportId}:no-cursor`;
  const reportCompleteness = exportSummary.ready && timelineReport.reportState.exportReady
    ? rejectedRecords.length === 0 && durableRunEventJournal.appendBlocked === false
      ? "complete"
      : "partial"
    : "blocked";

  return {
    contract: "episodic-log.analytics-reporting-snapshot.v1",
    generatedAt: now,
    exportId: exportSummary.exportId,
    reportCompleteness,
    counters: {
      episodeTypeCounts,
      severityCounts,
      rejectionReasonCounts,
      redactionCounts,
      acceptedThisRequest: acceptedRecords.length,
      rejectedThisRequest: rejectedRecords.length,
      committedEventCount,
      heldEventCount,
      timelineEventCount: timelineReport.events.length,
      historySnapshotCount: analyticsState.history.length
    },
    exportManifest: {
      format: exportSummary.format,
      destination: exportSummary.destination,
      route: exportSummary.route,
      partitionKey: `${partitionDate}/${partitionScope}`,
      partitionDate,
      partitionScope,
      watermark: exportWatermark,
      includeHistory: exportSummary.includeHistory,
      includeProof: exportSummary.includeProof,
      recordCounts: exportSummary.recordCounts
    },
    handoffReporting: {
      boundaryDisposition: boundaryAuditHandoff.disposition,
      externalHandoff: boundaryAuditHandoff.externalHandoff,
      syncDisposition: providerSyncHandoffContract.disposition,
      deliverySemantic: providerSyncHandoffContract.deliverySemantic,
      ackRequired: providerServiceContract.syncMetadata.ackRequired,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      batchId: providerSyncHandoffContract.batchId
    },
    timelineState: {
      latestEventAt: latestTimelineEvent?.at || now,
      latestEventType: latestTimelineEvent?.type || "none",
      backlogPressure: timelineReport.reportState.backlogPressure,
      retryScheduled: timelineReport.reportState.retryScheduled,
      retryAt: timelineReport.reportState.retryAt
    },
    proofToken: proofTokenFor({
      exportId: exportSummary.exportId,
      reportCompleteness,
      episodeTypeCounts,
      severityCounts,
      rejectionReasonCounts,
      partitionScope,
      exportWatermark,
      batchId: providerSyncHandoffContract.batchId,
      generatedAt: now
    })
  };
}

function buildOperatorVisibleSummary(command, readiness, episodeEnvelope, workflowHandoff, nextSteps, persistedState, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, boundaryAuditHandoff, operationalHealth, requestContinuation, timelineReport, now) {
  const acceptedRecords = episodeEnvelope.records.filter((record) => record.accepted);
  const rejectedRecords = episodeEnvelope.records.filter((record) => !record.accepted);
  const severityRank = { debug: 0, info: 1, notice: 2, warning: 3, error: 4 };
  const highestSeverity = acceptedRecords.reduce((current, record) => (
    severityRank[record.severity] > severityRank[current] ? record.severity : current
  ), "info");
  const hasBlockingAttention = readiness.blockers.length > 0
    || operationalHealth.actionableErrors.length > 0
    || providerSyncHandoffContract.blockers.length > 0
    || requestContinuation.blockers.length > 0;
  const summaryStatus = hasBlockingAttention
    ? "attention-required"
    : readiness.canFlushNow
      ? "flush-ready"
      : episodeEnvelope.acceptedCount > 0
        ? "captured"
        : "observing";
  const headline = summaryStatus === "attention-required"
    ? "Episodic log needs operator attention before durable commit."
    : summaryStatus === "flush-ready"
      ? "Episodic log is ready to flush durable run events."
      : summaryStatus === "captured"
        ? "Episodic run events were captured for durable handoff."
        : "Episodic log is observing run state.";
  const durableRunEvents = acceptedRecords.slice(0, 8).map((record) => ({
    episodeId: record.episodeId,
    type: record.type,
    severity: record.severity,
    occurredAt: record.occurredAt,
    summary: record.capture.summary,
    proofToken: record.proofToken
  }));
  const rejectionDigest = rejectedRecords.slice(0, 5).map((record) => ({
    episodeId: record.episodeId,
    reasons: record.rejectedReasons
  }));
  const attentionItems = [
    ...operationalHealth.actionableErrors.map((error) => ({
      source: "operational-health",
      id: error.code,
      label: error.code.replaceAll("-", " "),
      reason: error.message,
      route: error.route
    })),
    ...readiness.blockers.slice(0, 6).map((blocker) => ({
      source: "readiness",
      id: blocker,
      label: blocker.replaceAll("-", " "),
      reason: "adapter readiness blocker",
      route: `${surfaceGroup}/${surfaceName}/preview`
    })),
    ...nextSteps.slice(0, 3).map((step) => ({
      source: "next-step",
      id: step.id,
      label: step.label,
      reason: step.reason,
      route: step.route
    }))
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id && candidate.route === item.route) === index);
  const latestTimelineEvent = timelineReport.events.length > 0
    ? timelineReport.events[timelineReport.events.length - 1]
    : null;

  return {
    contract: "episodic-log.operator-summary.v1",
    generatedAt: now,
    status: summaryStatus,
    headline,
    command,
    highestSeverity,
    runEventDigest: {
      acceptedCount: episodeEnvelope.acceptedCount,
      rejectedCount: episodeEnvelope.rejectedCount,
      trimmedCount: episodeEnvelope.trimmedCount,
      captureLevel: episodeEnvelope.captureLevel,
      durableRunEvents,
      rejected: rejectionDigest,
      proofTokens: episodeEnvelope.proofTokens
    },
    durableState: {
      storageKey: persistedState.storageKey,
      restartSafeStatus: persistedState.restartSafeStatus,
      commandKeyConflict: persistedState.commandKeyConflict,
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      recoveryRequired: persistedState.recovery.required,
      recoveryCursor: persistedState.recovery.resumeCursor,
      recoveryActions: persistedState.recovery.actions.slice(0, 3),
      stableSnapshot: persistedState.stableSnapshot,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      ackRequired: providerServiceContract.syncMetadata.ackRequired,
      providerSyncDisposition: providerSyncHandoffContract.disposition,
      providerCommitDisposition: providerCommitPlan.disposition,
      providerCommitProofToken: providerCommitPlan.proofToken
    },
    handoff: {
      target: workflowHandoff.target,
      route: workflowHandoff.resume.route,
      requiredDecision: workflowHandoff.resume.requiredDecision,
      continuationKey: requestContinuation.continuationKey,
      returnMode: requestContinuation.returnMode,
      shouldWakeClient: requestContinuation.shouldWakeClient,
      payloadCursor: providerServiceContract.externalHandoffState.payloadCursor,
      batchId: providerSyncHandoffContract.batchId,
      commitRoute: providerCommitPlan.commitRoute,
      commitDisposition: providerCommitPlan.disposition,
      commitSequence: providerCommitPlan.sequence.map((step) => step.step),
      boundaryAudit: {
        disposition: boundaryAuditHandoff.disposition,
        externalHandoff: boundaryAuditHandoff.externalHandoff,
        scopeSubject: boundaryAuditHandoff.scopeSubject,
        route: boundaryAuditHandoff.route,
        blockers: boundaryAuditHandoff.blockers,
        proofToken: boundaryAuditHandoff.proofToken
      }
    },
    operatorAttention: {
      required: attentionItems.length > 0,
      itemCount: attentionItems.length,
      items: attentionItems.slice(0, 8)
    },
    timeline: {
      latestEventAt: latestTimelineEvent?.at || now,
      eventCount: timelineReport.events.length,
      retryScheduled: timelineReport.reportState.retryScheduled,
      retryAt: timelineReport.reportState.retryAt,
      backlogPressure: timelineReport.reportState.backlogPressure
    },
    proofToken: proofTokenFor({
      command,
      summaryStatus,
      acceptedCount: episodeEnvelope.acceptedCount,
      rejectedCount: episodeEnvelope.rejectedCount,
      storageKey: persistedState.storageKey,
      nextRevision: persistedState.nextRevision,
      nextCursor: providerServiceContract.syncMetadata.nextCursor,
      providerCommitDisposition: providerCommitPlan.disposition,
      providerCommitProofToken: providerCommitPlan.proofToken,
      handoffRoute: workflowHandoff.resume.route,
      boundaryAuditDisposition: boundaryAuditHandoff.disposition,
      boundaryAuditProofToken: boundaryAuditHandoff.proofToken,
      generatedAt: now
    })
  };
}

function buildDurableRunEventJournal(command, episodeEnvelope, workflowHandoff, operatorSummary, persistedState, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, boundaryAuditHandoff, tenantBoundary, readiness, now) {
  const acceptedRecords = episodeEnvelope.records.filter((record) => record.accepted);
  const rejectedRecords = episodeEnvelope.records.filter((record) => !record.accepted);
  const baseSequence = persistedState.nextRevision * 1000;
  const eventScope = {
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    projectId: tenantBoundary.projectId,
    isolationMode: tenantBoundary.isolationMode
  };
  const appendRecords = acceptedRecords.map((record, index) => {
    const sequence = baseSequence + index + 1;
    const eventId = `${persistedState.storageKey}:event:${sequence}`;

    return {
      contract: "episodic-log.durable-run-event.v1",
      eventId,
      sequence,
      episodeId: record.episodeId,
      type: record.type,
      severity: record.severity,
      occurredAt: record.occurredAt,
      receivedAt: now,
      summary: record.capture.summary,
      metadata: record.capture.metadata,
      contentStored: Boolean(record.capture.content),
      contentRedacted: record.capture.redacted,
      tenantBoundary: eventScope,
      sourceProofToken: record.proofToken,
      appendProofToken: proofTokenFor({
        eventId,
        sequence,
        episodeId: record.episodeId,
        storageKey: persistedState.storageKey,
        nextRevision: persistedState.nextRevision,
        sourceProofToken: record.proofToken
      })
    };
  });
  const handoffEvent = {
    contract: "episodic-log.durable-handoff-event.v1",
    eventId: `${persistedState.storageKey}:handoff:${persistedState.nextRevision}`,
    sequence: baseSequence + appendRecords.length + 1,
    type: "handoff",
    target: workflowHandoff.target,
    route: workflowHandoff.resume.route,
    requiredDecision: workflowHandoff.resume.requiredDecision,
    continuationKey: workflowHandoff.continuationKey,
    batchId: providerSyncHandoffContract.batchId,
    payloadCursor: providerServiceContract.externalHandoffState.payloadCursor,
    deliveryDisposition: providerSyncHandoffContract.disposition,
    commitDisposition: providerCommitPlan.disposition,
    commitRoute: providerCommitPlan.commitRoute,
    commitProofToken: providerCommitPlan.proofToken,
    boundaryAuditDisposition: boundaryAuditHandoff.disposition,
    boundaryAuditProofToken: boundaryAuditHandoff.proofToken,
    ackRequired: providerServiceContract.syncMetadata.ackRequired,
    tenantBoundary: eventScope,
    proofToken: proofTokenFor({
      storageKey: persistedState.storageKey,
      target: workflowHandoff.target,
      route: workflowHandoff.resume.route,
      batchId: providerSyncHandoffContract.batchId,
      payloadCursor: providerServiceContract.externalHandoffState.payloadCursor,
      commitDisposition: providerCommitPlan.disposition,
      commitProofToken: providerCommitPlan.proofToken,
      boundaryAuditDisposition: boundaryAuditHandoff.disposition,
      boundaryAuditProofToken: boundaryAuditHandoff.proofToken
    })
  };
  const summaryEvent = {
    contract: "episodic-log.operator-summary-event.v1",
    eventId: `${persistedState.storageKey}:summary:${persistedState.nextRevision}`,
    sequence: handoffEvent.sequence + 1,
    type: "operator-summary",
    status: operatorSummary.status,
    headline: operatorSummary.headline,
    attentionRequired: operatorSummary.operatorAttention.required,
    acceptedCount: operatorSummary.runEventDigest.acceptedCount,
    rejectedCount: operatorSummary.runEventDigest.rejectedCount,
    highestSeverity: operatorSummary.highestSeverity,
    proofToken: operatorSummary.proofToken
  };
  const appendBlocked = readiness.status !== "ready" || persistedState.recovery.required || providerSyncHandoffContract.blockers.length > 0 || providerCommitPlan.blockers.length > 0;

  return {
    contract: "episodic-log.durable-run-event-journal.v1",
    generatedAt: now,
    command,
    storageKey: persistedState.storageKey,
    revision: persistedState.revision,
    nextRevision: persistedState.nextRevision,
    appendDisposition: appendBlocked
      ? "hold"
      : appendRecords.length > 0 || command === "flush"
        ? "append"
        : "observe",
    appendBlocked,
    holdReasons: appendBlocked
      ? [
          ...readiness.blockers,
          ...(persistedState.recovery.required ? [`recovery-${persistedState.recovery.reason}`] : []),
          ...providerSyncHandoffContract.blockers,
          ...providerCommitPlan.blockers,
          ...boundaryAuditHandoff.blockers
        ].filter((reason, index, all) => reason && all.indexOf(reason) === index)
      : [],
    sequenceRange: {
      first: appendRecords[0]?.sequence || null,
      last: summaryEvent.sequence,
      eventCount: appendRecords.length + 2
    },
    appendRecords,
    rejectedRecords: rejectedRecords.map((record) => ({
      episodeId: record.episodeId,
      rejectedReasons: record.rejectedReasons,
      identityConflict: record.identityConflict || null
    })),
    handoffEvent,
    summaryEvent,
    proofToken: proofTokenFor({
      storageKey: persistedState.storageKey,
      nextRevision: persistedState.nextRevision,
      appendDisposition: appendBlocked ? "hold" : "append",
      eventProofTokens: appendRecords.map((record) => record.appendProofToken),
      handoffProofToken: handoffEvent.proofToken,
      commitProofToken: providerCommitPlan.proofToken,
      summaryProofToken: summaryEvent.proofToken
    })
  };
}

export function describeEpisodicLogAdapterSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const requestedCommand = input.command || input.lifecycleCommand;
  const command = normalizeCommand(requestedCommand);
  const commandWarnings = [];
  if (requestedCommand !== undefined && command !== String(requestedCommand).trim().toLowerCase()) {
    commandWarnings.push(`unsupported lifecycle command "${requestedCommand}" was treated as status`);
  }

  const normalized = normalizeSettings(input.settings || {});
  const effectiveSettings = applyLifecycleCommand(command, normalized.settings);
  const runtime = normalizeClientRuntime(input);
  const requestWorkflowState = normalizeRequestWorkflowState(input, runtime.clientState, command, now);
  const failureState = normalizeFailureState(input, runtime.clientState);
  const lifecycleControls = normalizeLifecycleControls(input, command, effectiveSettings, failureState, now);
  const nextAction = buildNextAction(command, effectiveSettings, now, lifecycleControls);
  const lifecycleCommandPlan = buildLifecycleCommandPlan(input, command, normalized.settings, effectiveSettings, lifecycleControls, nextAction, now);
  const operationalHealth = buildOperationalHealth(failureState, effectiveSettings, nextAction, now);
  const tenantBoundary = buildTenantBoundary(input, command, effectiveSettings, runtime.clientState);
  const episodeEnvelope = normalizeEpisodeEnvelope(input, effectiveSettings, tenantBoundary, now);
  const providerContract = normalizeProviderContract(input, effectiveSettings, runtime.clientState);
  const persistedState = normalizePersistedState(input, command, effectiveSettings, tenantBoundary, runtime.clientState, providerContract, now);
  const providerNegotiation = buildProviderNegotiation(providerContract, effectiveSettings, command, episodeEnvelope, tenantBoundary, runtime.clientState, now);
  const providerServiceContract = normalizeProviderServiceContract(input, command, providerContract, providerNegotiation, persistedState, episodeEnvelope, tenantBoundary, runtime.clientState, now);
  const providerSyncHandoffContract = buildHostedKernelSyncHandoffContract(input, command, providerContract, providerNegotiation, providerServiceContract, persistedState, episodeEnvelope, requestWorkflowState, runtime.clientState, now);
  const providerCommitPlan = buildProviderCommitPlan(input, command, providerNegotiation, providerServiceContract, providerSyncHandoffContract, persistedState, episodeEnvelope, requestWorkflowState, tenantBoundary, now);
  const boundaryAuditHandoff = buildBoundaryAuditHandoff(input, command, effectiveSettings, tenantBoundary, runtime.clientState, requestWorkflowState, providerServiceContract, providerSyncHandoffContract, persistedState, episodeEnvelope, now);
  const requestContinuation = buildRequestContinuationContract(requestWorkflowState, persistedState, providerServiceContract, episodeEnvelope, nextAction, now);
  const validation = [
    ...commandWarnings,
    ...normalized.validation,
    ...lifecycleControls.warnings,
    ...lifecycleCommandPlan.warnings,
    ...runtime.warnings,
    ...requestWorkflowState.warnings,
    ...tenantBoundary.warnings,
    ...failureState.warnings,
    ...episodeEnvelope.warnings,
    ...providerContract.warnings,
    ...providerServiceContract.warnings,
    ...providerSyncHandoffContract.warnings,
    ...providerCommitPlan.warnings,
    ...boundaryAuditHandoff.warnings,
    ...persistedState.warnings
  ];
  const validationSummary = buildValidationSummary(validation);
  const readiness = buildReadinessContract(command, effectiveSettings, lifecycleControls, lifecycleCommandPlan, nextAction, validationSummary, tenantBoundary, boundaryAuditHandoff, operationalHealth, episodeEnvelope, providerNegotiation, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, requestContinuation);
  const preview = buildPreviewContract(command, effectiveSettings, lifecycleControls, lifecycleCommandPlan, nextAction, validationSummary, tenantBoundary, boundaryAuditHandoff, operationalHealth, episodeEnvelope, providerNegotiation, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, requestContinuation);
  const acceptance = buildAcceptanceContract(input, command, effectiveSettings, lifecycleControls, lifecycleCommandPlan, readiness, persistedState, providerServiceContract, providerSyncHandoffContract, providerCommitPlan);
  const workflowHandoff = buildWorkflowHandoff(command, runtime.clientState, requestWorkflowState, requestContinuation, acceptance, readiness, lifecycleControls, lifecycleCommandPlan, nextAction, tenantBoundary, boundaryAuditHandoff, providerNegotiation, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, operationalHealth, now);
  const nextSteps = buildExplainableNextSteps(readiness, acceptance, lifecycleControls, nextAction, workflowHandoff, operationalHealth, providerNegotiation, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, requestContinuation);
  const operatorDecisionPacket = buildOperatorDecisionPacket(command, preview, readiness, validationSummary, acceptance, nextSteps, workflowHandoff, requestContinuation, boundaryAuditHandoff, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, persistedState, episodeEnvelope, now);
  const clientHandoffReceipt = buildClientHandoffReceipt(input, runtime.clientState, requestContinuation, workflowHandoff, operatorDecisionPacket, acceptance, readiness, providerServiceContract, providerSyncHandoffContract, persistedState, episodeEnvelope, now);
  const counterState = normalizeCounterSource(input);
  const historyState = normalizeHistorySnapshots(input, now);
  const analyticsState = buildAnalyticsState(counterState.counters, historyState, effectiveSettings, operationalHealth, readiness, nextAction, episodeEnvelope, now);
  const exportSummary = buildExportSummary(input, analyticsState, tenantBoundary, workflowHandoff, episodeEnvelope, now);
  const timelineReport = buildTimelineReport(analyticsState, exportSummary, nextAction, operationalHealth, now);
  const operatorSummary = buildOperatorVisibleSummary(command, readiness, episodeEnvelope, workflowHandoff, nextSteps, persistedState, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, boundaryAuditHandoff, operationalHealth, requestContinuation, timelineReport, now);
  const durableRunEventJournal = buildDurableRunEventJournal(command, episodeEnvelope, workflowHandoff, operatorSummary, persistedState, providerServiceContract, providerSyncHandoffContract, providerCommitPlan, boundaryAuditHandoff, tenantBoundary, readiness, now);
  const analyticsReportingSnapshot = buildAnalyticsReportingSnapshot(analyticsState, exportSummary, timelineReport, episodeEnvelope, durableRunEventJournal, providerServiceContract, providerSyncHandoffContract, boundaryAuditHandoff, now);
  const analyticsWarnings = [...counterState.warnings, ...historyState.warnings, ...exportSummary.warnings];
  const proof = {
    surfaceId,
    generatedAt: now,
    requestId: runtime.clientState.requestId,
    clientSurface: runtime.clientState.clientSurface,
    handoffTarget: runtime.clientState.handoffTarget,
    correlationId: requestWorkflowState.correlationId,
    continuationKey: requestContinuation.continuationKey,
    requestWorkflowIntent: requestContinuation.intent,
    requestWorkflowStatus: requestContinuation.status,
    requestWorkflowPriority: requestContinuation.priority,
    requestWorkflowReturnMode: requestContinuation.returnMode,
    requestWorkflowHandoffKind: requestContinuation.handoffKind,
    requestWorkflowWakeClient: requestContinuation.shouldWakeClient,
    requestWorkflowProofToken: requestContinuation.proofToken,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    isolationMode: tenantBoundary.isolationMode,
    actorRole: tenantBoundary.actorRole,
    boundaryAllowed: tenantBoundary.permission.allowed,
    boundaryBlockers: tenantBoundary.blockers,
    command,
    enabled: effectiveSettings.enabled,
    lifecycleState: lifecycleControls.state,
    lifecycleReason: lifecycleControls.reason,
    lifecycleControlsProofToken: lifecycleControls.proofToken,
    lifecycleCommandDisposition: lifecycleCommandPlan.disposition,
    lifecycleCommandPlanProofToken: lifecycleCommandPlan.proofToken,
    lifecycleScheduleGate: lifecycleCommandPlan.scheduleGate.status,
    automaticFlushAllowed: lifecycleControls.flushPermissions.automaticAllowed,
    manualFlushAllowed: lifecycleControls.flushPermissions.manualAllowed,
    scheduleSuspended: lifecycleControls.scheduleControls.suspended,
    scheduleMode: effectiveSettings.scheduleMode,
    nextAction: nextAction.action,
    dueAt: nextAction.dueAt,
    retentionDays: effectiveSettings.retentionDays,
    healthStatus: operationalHealth.status,
    degradedMode: operationalHealth.degradedMode,
    retryAt: operationalHealth.retry.retryAt,
    healthWriteDisposition: operationalHealth.writeDisposition,
    healthCaptureDisposition: operationalHealth.captureDisposition,
    healthCircuitOpen: operationalHealth.circuitBreaker.open,
    healthProofToken: operationalHealth.proofToken,
    actionableErrorCount: operationalHealth.actionableErrors.length,
    providerId: providerNegotiation.providerId,
    providerState: providerNegotiation.state,
    providerConsistencyLevel: providerNegotiation.consistencyLevel,
    providerSyncStatus: providerNegotiation.syncStatus,
    providerCanCommit: providerNegotiation.canCommit,
    providerProofToken: providerNegotiation.proofToken,
    providerServiceId: providerServiceContract.serviceId,
    providerServiceTier: providerServiceContract.tier,
    providerServiceAckMode: providerServiceContract.ackMode,
    providerServiceLeaseValid: providerServiceContract.capabilityLease.valid,
    providerServiceHandoffStatus: providerServiceContract.externalHandoffState.status,
    providerServiceNextCursor: providerServiceContract.syncMetadata.nextCursor,
    providerServiceProofToken: providerServiceContract.proofToken,
    providerSyncBatchId: providerSyncHandoffContract.batchId,
    providerSyncDisposition: providerSyncHandoffContract.disposition,
    providerSyncDeliverySemantic: providerSyncHandoffContract.deliverySemantic,
    providerSyncHandoffMode: providerSyncHandoffContract.handoffMode,
    providerSyncProofToken: providerSyncHandoffContract.proofToken,
    providerCommitDisposition: providerCommitPlan.disposition,
    providerCommitMode: providerCommitPlan.mode,
    providerCommitStepCount: providerCommitPlan.sequence.length,
    providerCommitProofToken: providerCommitPlan.proofToken,
    boundaryAuditDisposition: boundaryAuditHandoff.disposition,
    boundaryAuditExternalHandoff: boundaryAuditHandoff.externalHandoff,
    boundaryAuditScopeSubject: boundaryAuditHandoff.scopeSubject,
    boundaryAuditBlockers: boundaryAuditHandoff.blockers,
    boundaryAuditProofToken: boundaryAuditHandoff.proofToken,
    requestContinuationBlockers: requestContinuation.blockers,
    persistedStorageKey: persistedState.storageKey,
    persistedRevision: persistedState.revision,
    nextPersistedRevision: persistedState.nextRevision,
    restartSafeStatus: persistedState.restartSafeStatus,
    idempotentReplay: persistedState.duplicateCommand,
    commandKeyConflict: persistedState.commandKeyConflict,
    recoveryRequired: persistedState.recovery.required,
    recoveryActionCount: persistedState.recovery.actions.length,
    recoveryCanResume: persistedState.recovery.canResume,
    persistedStateProofToken: persistedState.proofToken,
    pendingEpisodes: analyticsState.counters.pendingEpisodes,
    acceptedEpisodeCount: episodeEnvelope.acceptedCount,
    rejectedEpisodeCount: episodeEnvelope.rejectedCount,
    episodeProofCount: episodeEnvelope.proofTokens.length,
    exportReady: exportSummary.ready,
    exportFormat: exportSummary.format,
    analyticsReportCompleteness: analyticsReportingSnapshot.reportCompleteness,
    analyticsReportPartitionKey: analyticsReportingSnapshot.exportManifest.partitionKey,
    analyticsReportProofToken: analyticsReportingSnapshot.proofToken,
    operatorSummaryStatus: operatorSummary.status,
    operatorSummaryProofToken: operatorSummary.proofToken,
    operatorDecisionStatus: operatorDecisionPacket.status,
    operatorDecisionProofToken: operatorDecisionPacket.proofToken,
    clientHandoffReceiptStatus: clientHandoffReceipt.status,
    clientHandoffReceiptChannel: clientHandoffReceipt.channel,
    clientHandoffReceiptAckPolicy: clientHandoffReceipt.ackPolicy,
    clientHandoffReceiptProofToken: clientHandoffReceipt.proofToken,
    durableJournalDisposition: durableRunEventJournal.appendDisposition,
    durableJournalEventCount: durableRunEventJournal.sequenceRange.eventCount,
    durableJournalProofToken: durableRunEventJournal.proofToken,
    historySnapshotCount: analyticsState.history.length,
    backlogPressure: analyticsState.ratios.backlogPressure,
    readiness: readiness.status,
    acceptance: acceptance.decision
  };

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel episodic log lifecycle adapter v1',
    lifecycle: {
      command,
      requestedCommand: requestedCommand ?? "status",
      supportedCommands: [...lifecycleCommands],
      enabled: effectiveSettings.enabled,
      state: lifecycleControls.state,
      reason: lifecycleControls.reason,
      controls: lifecycleControls,
      commandPlan: lifecycleCommandPlan
    },
    settings: effectiveSettings,
    validation,
    validationSummary,
    lifecycleControls,
    lifecycleCommandPlan,
    preview,
    acceptance,
    readiness,
    operationalHealth,
    providerContract,
    providerNegotiation,
    providerServiceContract,
    providerSyncHandoffContract,
    providerCommitPlan,
    boundaryAuditHandoff,
    requestWorkflowState,
    requestContinuation,
    persistedState,
    analyticsState,
    analyticsReportingSnapshot,
    operatorDecisionPacket,
    clientHandoffReceipt,
    episodeEnvelope,
    exportSummary,
    timelineReport,
    operatorSummary,
    durableRunEventJournal,
    tenantBoundary,
    nextAction,
    nextSteps,
    clientState: runtime.clientState,
    workflowHandoff,
    integration: {
      accepts: ["settings", "command", "lifecycleCommand", "lifecycleControls", "controls", "lifecycle", "lifecycleCommandPlan", "commandPlan", "scheduler", "scheduleControls", "acceptance", "evidence", "clientState", "client", "runtime", "handoffReceipt", "requestState", "workflow", "continuation", "correlationId", "requestId", "sessionId", "idempotencyKey", "persistedState", "durableState", "state", "tenantId", "workspaceId", "actorRole", "scope", "workspace", "failureState", "failure", "health", "analytics", "counters", "metrics", "history", "snapshots", "episodes", "episodicLog", "logEntries", "export", "exportRequest", "provider", "serviceProvider", "storageProvider", "providerService", "serviceContract", "providerSync", "syncMetadata", "handoffState", "providerCommitPlan", "commitPlan", "boundaryAudit", "auditHandoff"],
      emits: ["lifecycle", "lifecycleControls", "lifecycleCommandPlan", "settings", "validation", "validationSummary", "preview", "acceptance", "readiness", "operationalHealth", "providerContract", "providerNegotiation", "providerServiceContract", "providerSyncHandoffContract", "providerCommitPlan", "boundaryAuditHandoff", "requestWorkflowState", "requestContinuation", "persistedState", "operatorDecisionPacket", "clientHandoffReceipt", "episodeEnvelope", "analyticsState", "analyticsReportingSnapshot", "exportSummary", "timelineReport", "operatorSummary", "durableRunEventJournal", "tenantBoundary", "nextAction", "nextSteps", "clientState", "workflowHandoff", "audit", "proof"],
      kernelRoute: `${surfaceGroup}/${surfaceName}/lifecycle`,
      providerRoute: providerContract.endpoint,
      providerServiceRoutes: providerServiceContract.routes,
      providerSyncRoutes: providerSyncHandoffContract.routes,
      recoveryRoute: persistedState.recovery.route,
      providerCapabilities: [...allowedProviderCapabilities]
    },
    audit: [
      {
        type: "episodic-log.client-state-normalized",
        at: now,
        requestId: runtime.clientState.requestId,
        sessionId: runtime.clientState.sessionId,
        clientSurface: runtime.clientState.clientSurface,
        handoffTarget: runtime.clientState.handoffTarget,
        offline: runtime.clientState.offline
      },
      {
        type: "episodic-log.request-continuation-shaped",
        at: now,
        continuationKey: requestContinuation.continuationKey,
        correlationId: requestContinuation.correlationId,
        parentRequestId: requestContinuation.parentRequestId,
        intent: requestContinuation.intent,
        priority: requestContinuation.priority,
        returnMode: requestContinuation.returnMode,
        handoffKind: requestContinuation.handoffKind,
        status: requestContinuation.status,
        nextClientAction: requestContinuation.nextClientAction,
        shouldWakeClient: requestContinuation.shouldWakeClient,
        observedState: requestContinuation.observedState,
        preconditions: requestContinuation.preconditions,
        proofToken: requestContinuation.proofToken,
        blockers: requestContinuation.blockers
      },
      {
        type: "episodic-log.tenant-boundary-evaluated",
        at: now,
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        projectId: tenantBoundary.projectId,
        isolationMode: tenantBoundary.isolationMode,
        actorRole: tenantBoundary.actorRole,
        mutationRequested: tenantBoundary.mutationRequested,
        permissionAllowed: tenantBoundary.permission.allowed,
        deniedReasons: tenantBoundary.permission.deniedReasons
      },
      {
        type: "episodic-log.boundary-audit-handoff-evaluated",
        at: now,
        disposition: boundaryAuditHandoff.disposition,
        externalHandoff: boundaryAuditHandoff.externalHandoff,
        scopeSubject: boundaryAuditHandoff.scopeSubject,
        actorRole: boundaryAuditHandoff.actorRole,
        handoffTarget: boundaryAuditHandoff.handoffTarget,
        route: boundaryAuditHandoff.route,
        allowedScope: boundaryAuditHandoff.allowedScope,
        exposure: boundaryAuditHandoff.exposure,
        continuation: boundaryAuditHandoff.continuation,
        scopeProofToken: boundaryAuditHandoff.scopeProof?.proofToken || null,
        proofToken: boundaryAuditHandoff.proofToken,
        blockers: boundaryAuditHandoff.blockers,
        warnings: boundaryAuditHandoff.warnings
      },
      {
        type: "episodic-log.lifecycle-evaluated",
        at: now,
        command,
        enabled: effectiveSettings.enabled,
        lifecycleState: lifecycleControls.state,
        lifecycleReason: lifecycleControls.reason,
        scheduleSuspended: lifecycleControls.scheduleControls.suspended,
        automaticFlushAllowed: lifecycleControls.flushPermissions.automaticAllowed,
        manualFlushAllowed: lifecycleControls.flushPermissions.manualAllowed,
        controlBlockers: lifecycleControls.blockers,
        proofToken: lifecycleControls.proofToken,
        nextAction: nextAction.action,
        readiness: readiness.status,
        acceptance: acceptance.decision
      },
      {
        type: "episodic-log.lifecycle-command-plan-shaped",
        at: now,
        command,
        controlMode: lifecycleCommandPlan.controlMode,
        disposition: lifecycleCommandPlan.disposition,
        transition: lifecycleCommandPlan.transition,
        desiredEnabled: lifecycleCommandPlan.desiredEnabled,
        scheduleGate: lifecycleCommandPlan.scheduleGate.status,
        scheduleHealth: lifecycleCommandPlan.scheduleGate.scheduleHealth,
        nextScheduledFlushAt: lifecycleCommandPlan.scheduleGate.nextScheduledFlushAt,
        earliestFlushAt: lifecycleCommandPlan.scheduleGate.earliestFlushAt,
        safeguards: lifecycleCommandPlan.safeguards,
        route: lifecycleCommandPlan.route,
        proofToken: lifecycleCommandPlan.proofToken,
        blockers: lifecycleCommandPlan.blockers
      },
      {
        type: "episodic-log.provider-negotiated",
        at: now,
        providerId: providerNegotiation.providerId,
        providerState: providerNegotiation.state,
        consistencyLevel: providerNegotiation.consistencyLevel,
        requiredCapabilities: providerNegotiation.requiredCapabilities,
        missingCapabilities: providerNegotiation.missingCapabilities,
        syncStatus: providerNegotiation.syncStatus,
        externalHandoff: providerNegotiation.externalHandoff,
        proofToken: providerNegotiation.proofToken,
        blockers: providerNegotiation.blockers
      },
      {
        type: "episodic-log.provider-service-contract-shaped",
        at: now,
        serviceId: providerServiceContract.serviceId,
        contractVersion: providerServiceContract.contractVersion,
        tier: providerServiceContract.tier,
        ackMode: providerServiceContract.ackMode,
        leaseValid: providerServiceContract.capabilityLease.valid,
        leasedCapabilities: providerServiceContract.capabilityLease.leasedCapabilities,
        nextCursor: providerServiceContract.syncMetadata.nextCursor,
        ackRequired: providerServiceContract.syncMetadata.ackRequired,
        externalHandoffStatus: providerServiceContract.externalHandoffState.status,
        externalHandoffRoute: providerServiceContract.externalHandoffState.route,
        proofToken: providerServiceContract.proofToken,
        blockers: providerServiceContract.blockers
      },
      {
        type: "episodic-log.provider-sync-handoff-shaped",
        at: now,
        batchId: providerSyncHandoffContract.batchId,
        providerId: providerSyncHandoffContract.providerId,
        serviceId: providerSyncHandoffContract.serviceId,
        deliverySemantic: providerSyncHandoffContract.deliverySemantic,
        disposition: providerSyncHandoffContract.disposition,
        handoffMode: providerSyncHandoffContract.handoffMode,
        deliveryAttempt: providerSyncHandoffContract.deliveryAttempt,
        nextCursor: providerSyncHandoffContract.cursorState.nextCursor,
        remoteWatermark: providerSyncHandoffContract.cursorState.remoteWatermark,
        requiresRemoteAck: providerSyncHandoffContract.cursorState.requiresRemoteAck,
        routes: providerSyncHandoffContract.routes,
        proofToken: providerSyncHandoffContract.proofToken,
        blockers: providerSyncHandoffContract.blockers
      },
      {
        type: "episodic-log.provider-commit-plan-shaped",
        at: now,
        mode: providerCommitPlan.mode,
        disposition: providerCommitPlan.disposition,
        conflictPolicy: providerCommitPlan.conflictPolicy,
        commitRoute: providerCommitPlan.commitRoute,
        rollbackRoute: providerCommitPlan.rollbackRoute,
        operationFlags: providerCommitPlan.operationFlags,
        commitRevision: providerCommitPlan.cursorCommit.commitRevision,
        nextCursor: providerCommitPlan.cursorCommit.nextCursor,
        batchId: providerCommitPlan.cursorCommit.batchId,
        sequence: providerCommitPlan.sequence.map((step) => step.step),
        proofToken: providerCommitPlan.proofToken,
        blockers: providerCommitPlan.blockers,
        warnings: providerCommitPlan.warnings
      },
      {
        type: "episodic-log.persisted-state-shaped",
        at: now,
        storageKey: persistedState.storageKey,
        commandKey: persistedState.commandKey,
        duplicateCommand: persistedState.duplicateCommand,
        commandKeyConflict: persistedState.commandKeyConflict,
        lastCommandStatus: persistedState.lastCommandStatus,
        phase: persistedState.phase,
        revision: persistedState.revision,
        nextRevision: persistedState.nextRevision,
        restartSafeStatus: persistedState.restartSafeStatus,
        recoveryRequired: persistedState.recovery.required,
        recoveryReason: persistedState.recovery.reason,
        recoveryActionIds: persistedState.recovery.actions.map((action) => action.id),
        recoveryCanResume: persistedState.recovery.canResume,
        proofToken: persistedState.proofToken
      },
      {
        type: "episodic-log.episode-envelope-shaped",
        at: now,
        requestedEpisodes: episodeEnvelope.requestedCount,
        acceptedEpisodes: episodeEnvelope.acceptedCount,
        rejectedEpisodes: episodeEnvelope.rejectedCount,
        trimmedEpisodes: episodeEnvelope.trimmedCount,
        proofTokens: episodeEnvelope.proofTokens
      },
      {
        type: "episodic-log.operational-health-evaluated",
        at: now,
        status: operationalHealth.status,
        degradedMode: operationalHealth.degradedMode,
        canAttemptFlush: operationalHealth.canAttemptFlush,
        retryAt: operationalHealth.retry.retryAt,
        backoffSeconds: operationalHealth.retry.backoffSeconds,
        jitterSeconds: operationalHealth.retry.jitterSeconds,
        writeDisposition: operationalHealth.writeDisposition,
        captureDisposition: operationalHealth.captureDisposition,
        circuitOpen: operationalHealth.circuitBreaker.open,
        circuitReason: operationalHealth.circuitBreaker.reason,
        queuedEpisodes: operationalHealth.buffer.queuedEpisodes,
        bufferPressure: operationalHealth.buffer.pressure,
        blockers: operationalHealth.blockers,
        actionableErrors: operationalHealth.actionableErrors.map((error) => error.code),
        runbookStepIds: operationalHealth.runbook.map((step) => step.id),
        proofToken: operationalHealth.proofToken
      },
      {
        type: "episodic-log.preview-shaped",
        at: now,
        validationStatus: validationSummary.status,
        canAcceptPreview: readiness.canAcceptPreview,
        routeHint: acceptance.routeHint
      },
      {
        type: "episodic-log.workflow-handoff-shaped",
        at: now,
        target: workflowHandoff.target,
        route: workflowHandoff.resume.route,
        requiredDecision: workflowHandoff.resume.requiredDecision,
        tenantBoundary: tenantBoundary.handoffScope,
        userVisibleStatus: workflowHandoff.userVisibleStatus
      },
      {
        type: "episodic-log.operator-decision-packet-shaped",
        at: now,
        status: operatorDecisionPacket.status,
        confirmationRequired: operatorDecisionPacket.confirmationRequired,
        actionIds: operatorDecisionPacket.actions.map((action) => action.id),
        enabledActionIds: operatorDecisionPacket.actions
          .filter((action) => action.enabled)
          .map((action) => action.id),
        acknowledgementCount: operatorDecisionPacket.acknowledgementChecklist.length,
        submitRoute: operatorDecisionPacket.submitRoute,
        proofToken: operatorDecisionPacket.proofToken
      },
      {
        type: "episodic-log.client-handoff-receipt-shaped",
        at: now,
        receiptId: clientHandoffReceipt.receiptId,
        status: clientHandoffReceipt.status,
        channel: clientHandoffReceipt.channel,
        ackPolicy: clientHandoffReceipt.ackPolicy,
        acknowledgementRequired: clientHandoffReceipt.acknowledgement.required,
        deliverRoute: clientHandoffReceipt.routes.deliver,
        ackRoute: clientHandoffReceipt.routes.acknowledge,
        continuationKey: clientHandoffReceipt.continuationKey,
        nextCursor: clientHandoffReceipt.acknowledgement.nextCursor,
        providerSyncBatchId: clientHandoffReceipt.acknowledgement.batchId,
        blockers: clientHandoffReceipt.blockers,
        warnings: clientHandoffReceipt.warnings,
        proofToken: clientHandoffReceipt.proofToken
      },
      {
        type: "episodic-log.analytics-export-shaped",
        at: now,
        pendingEpisodes: analyticsState.counters.pendingEpisodes,
        historySnapshotCount: analyticsState.history.length,
        exportId: exportSummary.exportId,
        exportFormat: exportSummary.format,
        exportReady: exportSummary.ready,
        reportCompleteness: analyticsReportingSnapshot.reportCompleteness,
        partitionKey: analyticsReportingSnapshot.exportManifest.partitionKey,
        watermark: analyticsReportingSnapshot.exportManifest.watermark,
        episodeTypeCounts: analyticsReportingSnapshot.counters.episodeTypeCounts,
        severityCounts: analyticsReportingSnapshot.counters.severityCounts,
        rejectionReasonCounts: analyticsReportingSnapshot.counters.rejectionReasonCounts,
        timelineEventCount: timelineReport.events.length,
        proofToken: analyticsReportingSnapshot.proofToken,
        warnings: analyticsWarnings
      },
      {
        type: "episodic-log.operator-summary-shaped",
        at: now,
        status: operatorSummary.status,
        headline: operatorSummary.headline,
        acceptedRunEvents: operatorSummary.runEventDigest.acceptedCount,
        rejectedRunEvents: operatorSummary.runEventDigest.rejectedCount,
        handoffTarget: operatorSummary.handoff.target,
        handoffRoute: operatorSummary.handoff.route,
        durableState: operatorSummary.durableState.restartSafeStatus,
        attentionRequired: operatorSummary.operatorAttention.required,
        attentionItemCount: operatorSummary.operatorAttention.itemCount,
        proofToken: operatorSummary.proofToken
      },
      {
        type: "episodic-log.durable-run-event-journal-shaped",
        at: now,
        storageKey: durableRunEventJournal.storageKey,
        appendDisposition: durableRunEventJournal.appendDisposition,
        appendBlocked: durableRunEventJournal.appendBlocked,
        holdReasons: durableRunEventJournal.holdReasons,
        sequenceRange: durableRunEventJournal.sequenceRange,
        appendRecordCount: durableRunEventJournal.appendRecords.length,
        rejectedRecordCount: durableRunEventJournal.rejectedRecords.length,
        handoffEventId: durableRunEventJournal.handoffEvent.eventId,
        summaryEventId: durableRunEventJournal.summaryEvent.eventId,
        proofToken: durableRunEventJournal.proofToken
      },
      ...(
        Array.isArray(input.evidence)
          ? input.evidence.map((entry, index) => ({
              type: "episodic-log.external-evidence",
              at: now,
              index,
              value: entry
            }))
          : []
      )
    ],
    proof,
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeEpisodicLogAdapterSurface;
