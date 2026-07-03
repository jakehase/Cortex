export const surfaceId = "aios_artifact-filesystem_claim-evidence-link_034";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "claim-evidence-link";

const stateVersion = 1;
const terminalStatuses = new Set(["linked", "rejected"]);
const permittedLinkRoles = new Set(["owner", "maintainer", "artifact-curator", "claim-reviewer", "kernel-admin"]);
const retryBaseDelayMs = 750;
const retryMaxDelayMs = 12000;
const historyLimit = 24;
const timelineLimit = 80;
const commandLedgerLimit = 120;
const lifecycleManagerRoles = new Set(["maintainer", "artifact-curator", "kernel-admin"]);
const handoffExporterRoles = new Set(["maintainer", "artifact-curator", "claim-reviewer", "kernel-admin"]);
const tenantBoundaryBypassRoles = new Set(["kernel-admin"]);
const scheduleModes = new Set(["manual", "interval"]);
const lifecycleCommandActions = new Set(["enable", "disable", "schedule", "configure", "pause-schedule", "resume-schedule", "refresh-proofs"]);
const clientWorkflowModes = new Set(["review", "link", "handoff", "audit", "lifecycle"]);
const clientHandoffIntents = new Set(["stay", "resume", "export-audit", "open-link", "repair-proof"]);
const providerRuntimeStatuses = new Set(["ok", "degraded", "outage", "unknown"]);
const providerSyncModes = new Set(["push", "pull", "hybrid"]);
const supportedProviderCapabilities = new Set([
  "claim-link.write",
  "evidence.read",
  "audit-handoff.export",
  "proof.verify",
  "sync.cursor",
  "lifecycle.observe"
]);
const requiredProviderCapabilities = ["claim-link.write", "audit-handoff.export", "proof.verify"];
const defaultProviderName = "hosted-kernel-artifact-filesystem";
const requiredProviderServiceContracts = Object.freeze({
  claimWriteEndpoint: "claim-link.write",
  proofVerificationEndpoint: "proof.verify",
  auditHandoffEndpoint: "audit-handoff.export"
});
const defaultProviderServiceContract = Object.freeze({
  syncMode: "push",
  requiresCursorAck: true,
  cursorAckRoute: "/artifact-filesystem/claim-evidence-link/integration/cursor-ack",
  endpoints: {
    claimWriteEndpoint: {
      method: "POST",
      route: "/artifact-filesystem/claim-evidence-link/commands",
      capability: "claim-link.write",
      enabled: true
    },
    proofVerificationEndpoint: {
      method: "POST",
      route: "/artifact-filesystem/claim-evidence-link/proofs/verify",
      capability: "proof.verify",
      enabled: true
    },
    auditHandoffEndpoint: {
      method: "POST",
      route: "/artifact-filesystem/claim-evidence-link/handoff",
      capability: "audit-handoff.export",
      enabled: true
    }
  }
});
const defaultLifecycleSettings = Object.freeze({
  enabled: true,
  maxEvidenceItems: 50,
  requireEvidenceDigest: false,
  schedule: {
    mode: "manual",
    intervalMinutes: null,
    nextRunAt: null
  }
});

function asIso(value, fallback = new Date().toISOString()) {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function stableString(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableString).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(",")}}`;
}

function proofHash(payload) {
  let hash = 2166136261;
  const text = stableString(payload);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function retryDelayMs(attempt = 0) {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.min(Math.floor(attempt), 8) : 0;
  return Math.min(retryMaxDelayMs, retryBaseDelayMs * (2 ** safeAttempt));
}

function normalizeText(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function normalizeOptionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRoute(value, fallback) {
  const route = normalizeOptionalText(value);
  if (!route) return fallback;
  return route.startsWith("/") ? route : fallback;
}

function normalizeCapabilityList(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort();
}

function normalizeProviderIdentity(value = {}) {
  const provider = value && typeof value === "object" ? value : {};
  const providerName = normalizeOptionalText(provider.providerName || provider.name) || defaultProviderName;
  const providerInstanceId = normalizeOptionalText(provider.providerInstanceId || provider.instanceId)
    || `${providerName}:default`;
  return {
    providerName,
    providerInstanceId,
    contractVersion: normalizeOptionalText(provider.contractVersion) || "aios.claim-evidence-link.provider.v1"
  };
}

function normalizeAttempt(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function firstText(...values) {
  for (const value of values) {
    const normalized = normalizeOptionalText(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeEndpointDescriptor(value, key, capability, acceptedCapabilities) {
  const source = value && typeof value === "object" ? value : {};
  const route = normalizeRoute(source.route || source.path, null);
  const method = normalizeOptionalText(source.method)?.toUpperCase() || "POST";
  const declaredCapability = normalizeOptionalText(source.capability) || capability;
  const enabled = normalizeBoolean(source.enabled, Boolean(route));
  const reasons = [
    !enabled ? "endpoint-disabled" : null,
    !route ? "endpoint-route-missing" : null,
    !acceptedCapabilities.includes(capability) ? "capability-not-accepted" : null,
    declaredCapability !== capability ? "endpoint-capability-mismatch" : null
  ].filter(Boolean);
  return {
    key,
    capability,
    declaredCapability,
    method,
    route,
    enabled,
    ready: reasons.length === 0,
    reasons
  };
}

function normalizeProviderServiceContract(input = {}, persistedIntegration = {}, acceptedCapabilities = [], now) {
  const source = input.serviceContract
    || input.providerServiceContract
    || input.services
    || persistedIntegration.serviceContract
    || persistedIntegration.providerContract?.serviceContract
    || defaultProviderServiceContract;
  const endpointSource = source.endpoints && typeof source.endpoints === "object" ? source.endpoints : source;
  const syncModeCandidate = normalizeOptionalText(source.syncMode || source.mode) || "push";
  const syncMode = providerSyncModes.has(syncModeCandidate) ? syncModeCandidate : "push";
  const endpoints = Object.fromEntries(Object.entries(requiredProviderServiceContracts).map(([key, capability]) => [
    key,
    normalizeEndpointDescriptor(endpointSource[key], key, capability, acceptedCapabilities)
  ]));
  const missingServiceRequirements = Object.values(endpoints)
    .filter((endpoint) => !endpoint.ready)
    .map((endpoint) => ({
      key: endpoint.key,
      capability: endpoint.capability,
      reasons: endpoint.reasons
    }));
  const cursorAckRoute = normalizeRoute(source.cursorAckRoute || endpointSource.cursorAck?.route, null);
  const handoffSink = {
    route: normalizeRoute(source.handoffSinkRoute || source.handoffSink?.route, endpoints.auditHandoffEndpoint.route),
    method: normalizeOptionalText(source.handoffSinkMethod || source.handoffSink?.method)?.toUpperCase()
      || endpoints.auditHandoffEndpoint.method,
    requiresCursorAck: normalizeBoolean(source.requiresCursorAck, true)
  };
  const cursorAckReady = !handoffSink.requiresCursorAck || (Boolean(cursorAckRoute) && acceptedCapabilities.includes("sync.cursor"));
  const payload = {
    surfaceId,
    syncMode,
    endpoints,
    handoffSink,
    cursorAckRoute,
    cursorAckReady,
    missingServiceRequirements
  };
  return {
    contractVersion: "aios.claim-evidence-link.provider-service-contract.v1",
    negotiatedAt: now,
    syncMode,
    endpoints,
    handoffSink,
    cursorAck: {
      route: cursorAckRoute,
      required: handoffSink.requiresCursorAck,
      ready: cursorAckReady,
      capability: "sync.cursor"
    },
    ready: missingServiceRequirements.length === 0 && cursorAckReady,
    missingServiceRequirements: [
      ...missingServiceRequirements,
      handoffSink.requiresCursorAck && !cursorAckRoute
        ? { key: "cursorAck", capability: "sync.cursor", reasons: ["cursor-ack-route-missing"] }
        : null,
      handoffSink.requiresCursorAck && cursorAckRoute && !acceptedCapabilities.includes("sync.cursor")
        ? { key: "cursorAck", capability: "sync.cursor", reasons: ["capability-not-accepted"] }
        : null
    ].filter(Boolean),
    proof: proofHash(payload)
  };
}

function normalizeIntegerSetting(value, fallback, min, max, field, errors) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isFinite(value) || Math.floor(value) !== value || value < min || value > max) {
    errors.push(`${field} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

function scheduleNextRunAt(intervalMinutes, now) {
  return asIso(new Date(Date.parse(now) + intervalMinutes * 60000).toISOString(), now);
}

function validateIsoSetting(value, field, errors) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${field} must be a valid ISO timestamp`);
    return null;
  }
  return new Date(Date.parse(value)).toISOString();
}

function buildLifecycleControls(settings, now) {
  const schedule = settings?.schedule || defaultLifecycleSettings.schedule;
  const scheduleDue = schedule.mode === "interval" && schedule.nextRunAt
    ? Date.parse(schedule.nextRunAt) <= Date.parse(now)
    : false;
  const disabledReasons = [
    settings?.enabled === false ? "lifecycle-disabled" : null,
    schedule.mode === "manual" ? "schedule-manual" : null
  ].filter(Boolean);
  return {
    canEnable: settings?.enabled === false,
    canDisable: settings?.enabled !== false,
    canSchedule: settings?.enabled !== false,
    canPauseSchedule: settings?.enabled !== false && schedule.mode === "interval",
    canResumeSchedule: settings?.enabled !== false && schedule.mode === "manual",
    canRefreshProofs: settings?.enabled !== false,
    scheduleMode: schedule.mode,
    scheduleDue,
    nextRunAt: schedule.nextRunAt || null,
    disabledReasons
  };
}

function buildLifecycleNextAction(settings, controls, validation, now) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  if (errors.length > 0) {
    return {
      contractVersion: "aios.claim-evidence-link.lifecycle-next-action.v1",
      type: "repair-lifecycle-settings",
      status: "blocked",
      priority: "blocked",
      command: "claim-evidence-link.lifecycle.configure",
      route: "/artifact-filesystem/claim-evidence-link/lifecycle",
      dueAt: now,
      dueInMs: 0,
      disabledReasons: ["lifecycle-settings-invalid"],
      reasons: errors,
      payloadHint: {
        action: "configure",
        settingsPath: "settings"
      },
      proof: proofHash({ surfaceId, now, type: "repair-lifecycle-settings", errors })
    };
  }

  if (settings?.enabled === false) {
    return {
      contractVersion: "aios.claim-evidence-link.lifecycle-next-action.v1",
      type: "enable-lifecycle",
      status: "blocked",
      priority: "blocked",
      command: "claim-evidence-link.lifecycle.enable",
      route: "/artifact-filesystem/claim-evidence-link/lifecycle",
      dueAt: now,
      dueInMs: 0,
      disabledReasons: controls?.disabledReasons || ["lifecycle-disabled"],
      reasons: ["lifecycle controls disabled new claim-evidence link writes and handoff exports"],
      payloadHint: {
        action: "enable"
      },
      proof: proofHash({ surfaceId, now, type: "enable-lifecycle", enabled: settings?.enabled })
    };
  }

  const schedule = settings?.schedule || defaultLifecycleSettings.schedule;
  if (schedule.mode === "interval") {
    const nextRunAt = schedule.nextRunAt || scheduleNextRunAt(schedule.intervalMinutes || 60, now);
    const dueInMs = Math.max(0, Date.parse(nextRunAt) - Date.parse(now));
    const due = dueInMs === 0;
    return {
      contractVersion: "aios.claim-evidence-link.lifecycle-next-action.v1",
      type: due ? "refresh-proofs" : "wait-for-scheduled-refresh",
      status: due ? "due" : "scheduled",
      priority: due ? "due" : "normal",
      command: due
        ? "claim-evidence-link.lifecycle.refresh-proofs"
        : "claim-evidence-link.lifecycle.schedule",
      route: "/artifact-filesystem/claim-evidence-link/lifecycle",
      dueAt: nextRunAt,
      dueInMs,
      disabledReasons: controls?.disabledReasons || [],
      reasons: [due ? "scheduled proof refresh is due" : "next scheduled proof refresh has not reached its due time"],
      schedule: {
        mode: "interval",
        intervalMinutes: schedule.intervalMinutes,
        nextRunAt,
        due
      },
      payloadHint: {
        action: due ? "refresh-proofs" : "schedule",
        schedule: due ? null : {
          mode: "interval",
          intervalMinutes: schedule.intervalMinutes,
          nextRunAt
        }
      },
      proof: proofHash({ surfaceId, now, type: "scheduled-lifecycle", nextRunAt, intervalMinutes: schedule.intervalMinutes, due })
    };
  }

  return {
    contractVersion: "aios.claim-evidence-link.lifecycle-next-action.v1",
    type: "manual-refresh-available",
    status: "idle",
    priority: "normal",
    command: "claim-evidence-link.lifecycle.refresh-proofs",
    route: "/artifact-filesystem/claim-evidence-link/lifecycle",
    dueAt: null,
    dueInMs: null,
    disabledReasons: controls?.disabledReasons || [],
    reasons: ["lifecycle is enabled with manual proof refresh scheduling"],
    schedule: {
      mode: "manual",
      intervalMinutes: null,
      nextRunAt: null,
      due: false
    },
    payloadHint: {
      action: "refresh-proofs"
    },
    proof: proofHash({ surfaceId, now, type: "manual-refresh-available", enabled: settings?.enabled !== false })
  };
}

function normalizeScope(value = {}, errors = []) {
  const tenantId = normalizeText(value.tenantId, "scope.tenantId", errors);
  const workspaceId = normalizeText(value.workspaceId, "scope.workspaceId", errors);
  return tenantId && workspaceId
    ? { tenantId, workspaceId, scopeKey: `${tenantId}/${workspaceId}` }
    : null;
}

function normalizeActor(value = {}, errors = []) {
  const actorId = normalizeText(value.actorId || value.id, "actor.actorId", errors);
  const roles = Array.isArray(value.roles)
    ? [...new Set(value.roles.filter((role) => typeof role === "string").map((role) => role.trim()).filter(Boolean))]
    : [];
  if (roles.length === 0) errors.push("actor.roles must include at least one role");
  return {
    actorId,
    roles,
    hasLinkPermission: roles.some((role) => permittedLinkRoles.has(role))
  };
}

function normalizeActorIdentity(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const actorId = normalizeOptionalText(source.actorId || source.id);
  const roles = Array.isArray(source.roles)
    ? [...new Set(source.roles.filter((role) => typeof role === "string").map((role) => role.trim()).filter(Boolean))]
    : [];
  return {
    actorId,
    roles,
    canBypassTenantBoundary: roles.some((role) => tenantBoundaryBypassRoles.has(role))
  };
}

function actorCanManageLifecycle(actor) {
  return Array.isArray(actor?.roles) && actor.roles.some((role) => lifecycleManagerRoles.has(role));
}

function actorCanExportHandoff(actor) {
  return Array.isArray(actor?.roles) && actor.roles.some((role) => handoffExporterRoles.has(role));
}

function sameScope(left, right) {
  return Boolean(left && right && left.tenantId === right.tenantId && left.workspaceId === right.workspaceId);
}

function normalizeAccessScope(input = {}) {
  const explicitScope = input.scope && typeof input.scope === "object" ? input.scope : {};
  const tenantId = normalizeOptionalText(explicitScope.tenantId || input.tenantId);
  const workspaceId = normalizeOptionalText(explicitScope.workspaceId || input.workspaceId);
  return tenantId && workspaceId ? { tenantId, workspaceId, scopeKey: `${tenantId}/${workspaceId}` } : null;
}

function normalizeAccessBoundary(input = {}, state = {}) {
  const command = input.command && typeof input.command === "object" ? input.command : {};
  const actor = normalizeActorIdentity(input.actor || command.actor || input.requestActor || input.clientRequest?.actor || {});
  const requestedScope = normalizeAccessScope({
    ...input,
    scope: input.scope || command.scope,
    tenantId: input.tenantId || command.tenantId,
    workspaceId: input.workspaceId || command.workspaceId
  });
  const links = Object.values(state.links || {});
  const quarantinedLinks = links.filter((link) => link.scopeIntegrity?.status === "quarantined");
  const quarantinedLinkIds = new Set(quarantinedLinks.map((link) => link.linkId));
  const scopedLinks = requestedScope
    ? links.filter((link) => sameScope(link.scope, requestedScope))
    : links;
  const visibleLinks = actor.canBypassTenantBoundary
    ? links
    : scopedLinks.filter((link) => !quarantinedLinkIds.has(link.linkId));
  const hiddenLinks = actor.canBypassTenantBoundary
    ? []
    : links.filter((link) => {
      if (quarantinedLinkIds.has(link.linkId)) return true;
      return requestedScope ? !sameScope(link.scope, requestedScope) : false;
    });
  const visibleScopeKeys = [...new Set(visibleLinks.map((link) => link.scope?.scopeKey || "unscoped"))].sort();
  const hiddenScopeKeys = [...new Set(hiddenLinks.map((link) => link.scope?.scopeKey || "unscoped"))].sort();
  const payload = {
    surfaceId,
    requestedScope,
    actorId: actor.actorId,
    roles: actor.roles,
    visibleLinkIds: visibleLinks.map((link) => link.linkId).sort(),
    hiddenLinkIds: hiddenLinks.map((link) => link.linkId).sort()
  };
  return {
    contractVersion: "aios.claim-evidence-link.access-boundary.v1",
    requestedScope,
    actor,
    mode: requestedScope ? actor.canBypassTenantBoundary ? "cross-scope-admin" : "scoped-workspace" : "unscoped-hosted-kernel",
    isolation: {
      enforced: Boolean(requestedScope && !actor.canBypassTenantBoundary),
      bypassRoles: [...tenantBoundaryBypassRoles],
      visibleScopeKeys,
      hiddenScopeKeys,
      hiddenLinkCount: hiddenLinks.length,
      quarantinedLinkCount: quarantinedLinks.length,
      visibleQuarantinedLinkCount: visibleLinks.filter((link) => quarantinedLinkIds.has(link.linkId)).length
    },
    scopeIntegrity: state.scopeIntegrity || null,
    visibleLinkIds: visibleLinks.map((link) => link.linkId).sort(),
    hiddenLinkIds: hiddenLinks.map((link) => link.linkId).sort(),
    proof: proofHash(payload)
  };
}

function linksForAccess(state, boundary) {
  const links = Object.values(state.links || {});
  if (!boundary || boundary.actor?.canBypassTenantBoundary) return links;
  const visible = new Set(boundary.visibleLinkIds || []);
  return links.filter((link) => visible.has(link.linkId));
}

function commandLedgerForAccess(state, boundary) {
  const entries = Object.values(state.commandLedger || {});
  if (!boundary || boundary.actor?.canBypassTenantBoundary) return entries;
  const visible = new Set(boundary.visibleLinkIds || []);
  return entries.filter((entry) => {
    if (entry.linkId) return visible.has(entry.linkId);
    return boundary.requestedScope ? entry.scopeKey === boundary.requestedScope.scopeKey : true;
  });
}

function auditLogForAccess(state, boundary) {
  const audits = Array.isArray(state.auditLog) ? state.auditLog : [];
  if (!boundary || boundary.actor?.canBypassTenantBoundary) return audits;
  const visible = new Set(boundary.visibleLinkIds || []);
  return audits.filter((audit) => {
    if (audit.linkId) return visible.has(audit.linkId);
    if (!boundary.requestedScope) return true;
    return sameScope(audit.scope, boundary.requestedScope);
  });
}

function normalizeLifecycleSettings(value = {}, now, errors = [], previous = defaultLifecycleSettings) {
  const source = value && typeof value === "object" ? value : {};
  const previousSchedule = previous?.schedule && typeof previous.schedule === "object" ? previous.schedule : defaultLifecycleSettings.schedule;
  const scheduleSource = source.schedule && typeof source.schedule === "object" ? source.schedule : {};
  const mode = scheduleSource.mode === undefined ? previousSchedule.mode : scheduleSource.mode;
  const scheduleMode = scheduleModes.has(mode) ? mode : previousSchedule.mode;
  if (mode !== undefined && !scheduleModes.has(mode)) errors.push("settings.schedule.mode must be manual or interval");
  const intervalMinutes = scheduleMode === "interval"
    ? normalizeIntegerSetting(scheduleSource.intervalMinutes, previousSchedule.intervalMinutes || 60, 5, 10080, "settings.schedule.intervalMinutes", errors)
    : null;
  const requestedNextRunAt = validateIsoSetting(scheduleSource.nextRunAt, "settings.schedule.nextRunAt", errors);
  const nextRunAt = scheduleMode === "interval"
    ? requestedNextRunAt || asIso(previousSchedule.nextRunAt || scheduleNextRunAt(intervalMinutes, now), now)
    : null;
  return {
    enabled: normalizeBoolean(source.enabled, normalizeBoolean(previous.enabled, defaultLifecycleSettings.enabled)),
    maxEvidenceItems: normalizeIntegerSetting(source.maxEvidenceItems, previous.maxEvidenceItems || defaultLifecycleSettings.maxEvidenceItems, 1, 250, "settings.maxEvidenceItems", errors),
    requireEvidenceDigest: normalizeBoolean(source.requireEvidenceDigest, normalizeBoolean(previous.requireEvidenceDigest, defaultLifecycleSettings.requireEvidenceDigest)),
    schedule: {
      mode: scheduleMode,
      intervalMinutes,
      nextRunAt
    }
  };
}

function buildLifecycleState(persisted, now) {
  const errors = [];
  const persistedLifecycle = persisted?.lifecycle && typeof persisted.lifecycle === "object" ? persisted.lifecycle : {};
  const settings = normalizeLifecycleSettings(
    persistedLifecycle.settings || persisted?.settings || defaultLifecycleSettings,
    now,
    errors,
    defaultLifecycleSettings
  );
  const controls = buildLifecycleControls(settings, now);
  const validation = {
    valid: errors.length === 0,
    errors
  };
  const nextAction = buildLifecycleNextAction(settings, controls, validation, now);
  return {
    enabled: settings.enabled,
    settings,
    controls,
    validation,
    nextAction,
    updatedAt: asIso(persistedLifecycle.updatedAt, now),
    updatedBy: normalizeOptionalText(persistedLifecycle.updatedBy),
    proof: persistedLifecycle.proof || proofHash({ surfaceId, lifecycle: settings, lifecycleNextActionProof: nextAction.proof })
  };
}

function scopedCommandId(scope, commandId) {
  return scope && commandId ? `${scope.scopeKey}::${commandId}` : commandId;
}

function scopedLinkId(scope, linkId) {
  return scope && linkId ? `${scope.scopeKey}::${linkId}` : linkId;
}

function readPersistedScope(link) {
  const tenantId = normalizeOptionalText(link?.scope?.tenantId || link?.tenantId);
  const workspaceId = normalizeOptionalText(link?.scope?.workspaceId || link?.workspaceId);
  return tenantId && workspaceId ? { tenantId, workspaceId, scopeKey: `${tenantId}/${workspaceId}` } : null;
}

function parseScopeFromScopedId(value) {
  const scopedId = normalizeOptionalText(value);
  if (!scopedId || !scopedId.includes("::")) return null;
  const [scopeKey] = scopedId.split("::");
  const separator = scopeKey.indexOf("/");
  if (separator <= 0 || separator === scopeKey.length - 1) return null;
  const tenantId = scopeKey.slice(0, separator).trim();
  const workspaceId = scopeKey.slice(separator + 1).trim();
  return tenantId && workspaceId ? { tenantId, workspaceId, scopeKey: `${tenantId}/${workspaceId}` } : null;
}

function scopeMismatchReason(left, right, reason) {
  if (!left || !right) return null;
  return left.tenantId !== right.tenantId || left.workspaceId !== right.workspaceId ? reason : null;
}

function buildPersistedLinkScopeIntegrity({ recordKey, link, normalizedScope, now }) {
  const keyScope = parseScopeFromScopedId(recordKey);
  const embeddedLinkScope = parseScopeFromScopedId(link?.linkId);
  const rawLinkScope = parseScopeFromScopedId(link?.rawLinkId);
  const topLevelScope = normalizeOptionalText(link?.tenantId) && normalizeOptionalText(link?.workspaceId)
    ? {
      tenantId: normalizeOptionalText(link.tenantId),
      workspaceId: normalizeOptionalText(link.workspaceId),
      scopeKey: `${normalizeOptionalText(link.tenantId)}/${normalizeOptionalText(link.workspaceId)}`
    }
    : null;
  const reasons = [
    !normalizedScope ? "persisted-link-scope-missing" : null,
    !keyScope ? "persisted-key-scope-missing" : null,
    rawLinkScope ? "raw-link-id-must-not-include-tenant-workspace-prefix" : null,
    scopeMismatchReason(keyScope, normalizedScope, "persisted-key-scope-conflicts-with-record-scope"),
    scopeMismatchReason(embeddedLinkScope, normalizedScope, "embedded-link-id-scope-conflicts-with-record-scope"),
    scopeMismatchReason(topLevelScope, normalizedScope, "top-level-tenant-workspace-conflicts-with-record-scope"),
    keyScope && embeddedLinkScope ? scopeMismatchReason(keyScope, embeddedLinkScope, "persisted-key-scope-conflicts-with-embedded-link-id") : null
  ].filter(Boolean);
  const status = reasons.length > 0 ? "quarantined" : "valid";
  const payload = {
    surfaceId,
    recordKey,
    linkId: normalizeOptionalText(link?.linkId) || recordKey,
    rawLinkId: normalizeOptionalText(link?.rawLinkId),
    normalizedScope,
    keyScope,
    embeddedLinkScope,
    topLevelScope,
    reasons
  };
  return {
    contractVersion: "aios.claim-evidence-link.scope-integrity.v1",
    checkedAt: now,
    status,
    quarantined: status === "quarantined",
    reasons,
    recordKey,
    normalizedScope,
    keyScope,
    embeddedLinkScope,
    topLevelScope,
    remediation: status === "quarantined"
      ? "Repair the persisted link so its map key, embedded linkId, tenantId/workspaceId fields, and nested scope all resolve to the same tenant/workspace before handoff export."
      : null,
    proof: proofHash(payload)
  };
}

function summarizeScopeIntegrity(links, now) {
  const entries = Object.values(links || {}).map((link) => link.scopeIntegrity).filter(Boolean);
  const quarantined = entries.filter((entry) => entry.status === "quarantined");
  const reasonCounts = {};
  for (const entry of quarantined) {
    for (const reason of entry.reasons || []) incrementCounter(reasonCounts, reason);
  }
  const payload = {
    surfaceId,
    checkedAt: now,
    linkCount: entries.length,
    quarantinedLinkIds: quarantined.map((entry) => entry.recordKey).sort(),
    reasonCounts
  };
  return {
    contractVersion: "aios.claim-evidence-link.scope-integrity-summary.v1",
    checkedAt: now,
    status: quarantined.length > 0 ? "quarantine-required" : "valid",
    linkCount: entries.length,
    validLinkCount: entries.length - quarantined.length,
    quarantinedLinkCount: quarantined.length,
    quarantinedLinkIds: quarantined.map((entry) => entry.recordKey).sort(),
    reasonCounts,
    proof: proofHash(payload)
  };
}

function normalizeCommandLedgerEntry(entry, commandKey, links, now) {
  const source = entry && typeof entry === "object" ? entry : {};
  const linkId = normalizeOptionalText(source.linkId) || null;
  const linkedRecord = linkId ? links[linkId] || null : null;
  const status = source.status === "rejected"
    ? "rejected"
    : linkId && linkedRecord?.status === "linked"
      ? "linked"
      : linkId
        ? "recovering"
        : "unknown";
  return {
    commandKey,
    commandId: normalizeOptionalText(source.commandId) || commandKey.split("::").pop() || commandKey,
    scopedCommandId: normalizeOptionalText(source.scopedCommandId) || commandKey,
    linkId,
    scopeKey: normalizeOptionalText(source.scopeKey || linkedRecord?.scope?.scopeKey),
    actorId: normalizeOptionalText(source.actorId || linkedRecord?.actor?.actorId),
    status,
    firstSeenAt: asIso(source.firstSeenAt || source.acceptedAt || source.rejectedAt || linkedRecord?.createdAt, now),
    lastSeenAt: asIso(source.lastSeenAt || source.acceptedAt || source.rejectedAt || linkedRecord?.updatedAt, now),
    replayCount: normalizeAttempt(source.replayCount),
    failureId: normalizeOptionalText(source.failureId),
    resultProof: normalizeOptionalText(source.resultProof || linkedRecord?.proof),
    recovery: status === "recovering"
      ? {
        required: true,
        reason: linkedRecord ? "linked command points at a non-terminal link" : "command ledger points at a missing link",
        retryAfterMs: retryDelayMs(0)
      }
      : { required: false, reason: null, retryAfterMs: null }
  };
}

function buildCommandLedger(persisted, links, now) {
  const persistedLedger = persisted?.commandLedger && typeof persisted.commandLedger === "object" ? persisted.commandLedger : {};
  const legacyIndex = persisted?.commandIndex && typeof persisted.commandIndex === "object" ? persisted.commandIndex : {};
  const ledgerEntries = new Map();
  for (const [commandKey, entry] of Object.entries(persistedLedger)) {
    ledgerEntries.set(commandKey, normalizeCommandLedgerEntry(entry, commandKey, links, now));
  }
  for (const [commandKey, linkId] of Object.entries(legacyIndex)) {
    if (!ledgerEntries.has(commandKey)) {
      ledgerEntries.set(commandKey, normalizeCommandLedgerEntry({ linkId, status: "linked" }, commandKey, links, now));
    }
  }
  return Object.fromEntries([...ledgerEntries.values()]
    .sort((left, right) => Date.parse(left.lastSeenAt) - Date.parse(right.lastSeenAt) || left.commandKey.localeCompare(right.commandKey))
    .slice(-commandLedgerLimit)
    .map((entry) => [entry.commandKey, entry]));
}

function buildCommandStatus(entry, link, now) {
  if (!entry) {
    return {
      status: "new",
      restartSafe: true,
      replay: false,
      recoveryRequired: false,
      checkedAt: now
    };
  }
  const recoveryRequired = entry.status === "recovering" || (entry.linkId && !link);
  return {
    status: recoveryRequired ? "recovery-required" : entry.status,
    restartSafe: !recoveryRequired,
    replay: entry.status === "linked" && Boolean(link),
    recoveryRequired,
    commandKey: entry.commandKey,
    linkId: entry.linkId,
    replayCount: entry.replayCount,
    firstSeenAt: entry.firstSeenAt,
    lastSeenAt: entry.lastSeenAt,
    resultProof: entry.resultProof || link?.proof || null,
    remediation: recoveryRequired
      ? "Rebuild the missing linked record from the original scoped command before treating this replay as complete."
      : null,
    checkedAt: now
  };
}

function recoveryTaskId(parts) {
  return proofHash({ surfaceId, recoveryTask: parts });
}

function buildRecoveryPlan(state, now) {
  const links = linksForAccess(state, state.accessBoundary);
  const commandLedger = commandLedgerForAccess(state, state.accessBoundary);
  const tasks = [];
  for (const link of links) {
    if (link.scopeIntegrity?.status === "quarantined") {
      tasks.push({
        taskId: recoveryTaskId({
          type: "repair-scope-integrity",
          linkId: link.linkId,
          scopeIntegrityProof: link.scopeIntegrity.proof
        }),
        type: "repair-scope-integrity",
        status: "pending",
        priority: "high",
        linkId: link.linkId,
        scopeKey: link.scope?.scopeKey || null,
        commandId: link.commandId || null,
        route: `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(link.linkId)}/scope-integrity/repair`,
        reason: "persisted link has tenant/workspace scope metadata that is missing or internally inconsistent",
        restartSafe: false,
        scopeIntegrity: link.scopeIntegrity,
        idempotentReplay: link.commandId
          ? {
            commandId: link.commandId,
            scopedCommandId: link.scopedCommandId || scopedCommandId(link.scope, link.commandId),
            route: "/artifact-filesystem/claim-evidence-link/commands",
            expectedOutcome: "rebuild-link-with-consistent-scope"
          }
          : null,
        retry: {
          retryAfterMs: retryDelayMs(0),
          nextRetryAt: asIso(new Date(Date.parse(now) + retryDelayMs(0)).toISOString(), now)
        }
      });
    }
    if (link.status === "recovering") {
      tasks.push({
        taskId: recoveryTaskId({ type: "rehydrate-link", linkId: link.linkId, updatedAt: link.updatedAt }),
        type: "rehydrate-link",
        status: "pending",
        priority: "high",
        linkId: link.linkId,
        scopeKey: link.scope?.scopeKey || null,
        commandId: link.commandId || null,
        route: `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(link.linkId)}/repair`,
        reason: "persisted link is not in a terminal status after restart",
        restartSafe: false,
        idempotentReplay: link.commandId
          ? {
            commandId: link.commandId,
            scopedCommandId: link.scopedCommandId || scopedCommandId(link.scope, link.commandId),
            route: "/artifact-filesystem/claim-evidence-link/commands",
            expectedOutcome: "rebuild-link-record"
          }
          : null,
        retry: {
          retryAfterMs: retryDelayMs(0),
          nextRetryAt: asIso(new Date(Date.parse(now) + retryDelayMs(0)).toISOString(), now)
        }
      });
    }
    if (link.status === "linked" && !link.proof) {
      tasks.push({
        taskId: recoveryTaskId({ type: "reverify-proof", linkId: link.linkId, updatedAt: link.updatedAt }),
        type: "reverify-proof",
        status: "pending",
        priority: "normal",
        linkId: link.linkId,
        scopeKey: link.scope?.scopeKey || null,
        commandId: link.commandId || null,
        route: `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(link.linkId)}/proofs/verify`,
        reason: "linked record is missing the proof required for audit handoff",
        restartSafe: true,
        idempotentReplay: link.commandId
          ? {
            commandId: link.commandId,
            scopedCommandId: link.scopedCommandId || scopedCommandId(link.scope, link.commandId),
            route: "/artifact-filesystem/claim-evidence-link/commands",
            expectedOutcome: "restore-proof"
          }
          : null,
        retry: {
          retryAfterMs: retryDelayMs(1),
          nextRetryAt: asIso(new Date(Date.parse(now) + retryDelayMs(1)).toISOString(), now)
        }
      });
    }
    if (link.status === "linked" && evidenceManifestForLink(link).status !== "complete") {
      const manifest = evidenceManifestForLink(link);
      tasks.push({
        taskId: recoveryTaskId({ type: "repair-claim-evidence-manifest", linkId: link.linkId, updatedAt: link.updatedAt, manifestProof: manifest.proof }),
        type: "repair-claim-evidence-manifest",
        status: "pending",
        priority: "normal",
        linkId: link.linkId,
        scopeKey: link.scope?.scopeKey || null,
        commandId: link.commandId || null,
        route: `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(link.linkId)}/claim-evidence-manifest/repair`,
        reason: "linked record does not expose a complete per-claim proof artifact manifest",
        restartSafe: true,
        missingClaimIds: manifest.missingClaimIds || [],
        evidenceTraceProof: manifest.evidenceTraceProof || null,
        manifestValidation: manifest.validation || null,
        manifestValidationReasons: manifest.validation?.reasons || [],
        manifestProof: manifest.proof,
        idempotentReplay: link.commandId
          ? {
            commandId: link.commandId,
            scopedCommandId: link.scopedCommandId || scopedCommandId(link.scope, link.commandId),
            route: "/artifact-filesystem/claim-evidence-link/commands",
            expectedOutcome: "restore-claim-evidence-manifest"
          }
          : null,
        retry: {
          retryAfterMs: retryDelayMs(1),
          nextRetryAt: asIso(new Date(Date.parse(now) + retryDelayMs(1)).toISOString(), now)
        }
      });
    }
    if (link.status === "linked" && artifactClaimEvidenceLinksForState(state, link).status !== "complete") {
      const artifactClaimEvidenceLinks = artifactClaimEvidenceLinksForState(state, link);
      tasks.push({
        taskId: recoveryTaskId({
          type: "repair-artifact-claim-evidence-links",
          linkId: link.linkId,
          updatedAt: link.updatedAt,
          artifactClaimEvidenceLinksProof: artifactClaimEvidenceLinks.proof
        }),
        type: "repair-artifact-claim-evidence-links",
        status: "pending",
        priority: "normal",
        linkId: link.linkId,
        scopeKey: link.scope?.scopeKey || null,
        commandId: link.commandId || null,
        route: `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(link.linkId)}/artifact-claim-evidence-links/repair`,
        reason: "linked record has claim/evidence references that are unresolved or missing required locator metadata",
        restartSafe: true,
        unresolvedClaimIds: artifactClaimEvidenceLinks.unresolvedClaimIds || [],
        unresolvedEvidenceIds: artifactClaimEvidenceLinks.unresolvedEvidenceIds || [],
        nonCompliantEvidenceIds: artifactClaimEvidenceLinks.nonCompliantEvidenceIds || [],
        missingDigestEvidenceIds: artifactClaimEvidenceLinks.missingDigestEvidenceIds || [],
        missingLocatorEvidenceIds: artifactClaimEvidenceLinks.missingLocatorEvidenceIds || [],
        evidenceReferencePolicyReasons: artifactClaimEvidenceLinks.evidenceReferencePolicyReasons || [],
        artifactClaimEvidenceLinksProof: artifactClaimEvidenceLinks.proof,
        idempotentReplay: link.commandId
          ? {
            commandId: link.commandId,
            scopedCommandId: link.scopedCommandId || scopedCommandId(link.scope, link.commandId),
            route: "/artifact-filesystem/claim-evidence-link/commands",
            expectedOutcome: "restore-artifact-claim-evidence-links"
          }
          : null,
        retry: {
          retryAfterMs: retryDelayMs(1),
          nextRetryAt: asIso(new Date(Date.parse(now) + retryDelayMs(1)).toISOString(), now)
        }
      });
    }
    if (link.status === "linked" && buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinksForState(state, link)).status !== "complete") {
      const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinksForState(state, link));
      tasks.push({
        taskId: recoveryTaskId({
          type: "repair-claim-evidence-trace-matrix",
          linkId: link.linkId,
          updatedAt: link.updatedAt,
          claimEvidenceTraceMatrixProof: claimEvidenceTraceMatrix.proof
        }),
        type: "repair-claim-evidence-trace-matrix",
        status: "pending",
        priority: "normal",
        linkId: link.linkId,
        scopeKey: link.scope?.scopeKey || null,
        commandId: link.commandId || null,
        route: `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(link.linkId)}/claim-evidence-trace-matrix/repair`,
        reason: "linked record does not expose a complete per-claim evidence edge matrix",
        restartSafe: true,
        incompleteClaimIds: claimEvidenceTraceMatrix.incompleteClaimIds || [],
        unresolvedEvidenceIds: claimEvidenceTraceMatrix.unresolvedEvidenceIds || [],
        nonCompliantEvidenceIds: claimEvidenceTraceMatrix.nonCompliantEvidenceIds || [],
        missingClaimIds: claimEvidenceTraceMatrix.missingClaimIds || [],
        claimEvidenceTraceMatrixProof: claimEvidenceTraceMatrix.proof,
        artifactClaimEvidenceLinksProof: claimEvidenceTraceMatrix.artifactClaimEvidenceLinksProof || null,
        idempotentReplay: link.commandId
          ? {
            commandId: link.commandId,
            scopedCommandId: link.scopedCommandId || scopedCommandId(link.scope, link.commandId),
            route: "/artifact-filesystem/claim-evidence-link/commands",
            expectedOutcome: "restore-claim-evidence-trace-matrix"
          }
          : null,
        retry: {
          retryAfterMs: retryDelayMs(1),
          nextRetryAt: asIso(new Date(Date.parse(now) + retryDelayMs(1)).toISOString(), now)
        }
      });
    }
  }
  for (const entry of commandLedger) {
    if (entry.recovery?.required === true) {
      tasks.push({
        taskId: recoveryTaskId({ type: "repair-command-ledger", commandKey: entry.commandKey, linkId: entry.linkId }),
        type: "repair-command-ledger",
        status: "pending",
        priority: "high",
        commandKey: entry.commandKey,
        commandId: entry.commandId,
        scopedCommandId: entry.scopedCommandId,
        linkId: entry.linkId,
        scopeKey: entry.scopeKey || null,
        route: "/artifact-filesystem/claim-evidence-link/commands",
        reason: entry.recovery.reason || "persisted command ledger is not restart-safe",
        restartSafe: false,
        idempotentReplay: {
          commandId: entry.commandId,
          scopedCommandId: entry.scopedCommandId,
          route: "/artifact-filesystem/claim-evidence-link/commands",
          expectedOutcome: "reconcile-ledger-and-link"
        },
        retry: {
          retryAfterMs: entry.recovery.retryAfterMs || retryDelayMs(0),
          nextRetryAt: asIso(new Date(Date.parse(now) + (entry.recovery.retryAfterMs || retryDelayMs(0))).toISOString(), now)
        }
      });
    }
  }
  const uniqueTasks = [...new Map(tasks.map((task) => [task.taskId, task])).values()]
    .sort((left, right) => {
      const priority = { high: 0, normal: 1 };
      return (priority[left.priority] ?? 2) - (priority[right.priority] ?? 2)
        || (left.linkId || left.commandKey || "").localeCompare(right.linkId || right.commandKey || "");
    });
  const blockingTasks = uniqueTasks.filter((task) => task.restartSafe === false);
  const payload = {
    surfaceId,
    generatedAt: now,
    taskIds: uniqueTasks.map((task) => task.taskId),
    blockingTaskIds: blockingTasks.map((task) => task.taskId),
    accessBoundaryProof: state.accessBoundary?.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.recovery-plan.v1",
    generatedAt: now,
    status: blockingTasks.length > 0 ? "blocked" : uniqueTasks.length > 0 ? "action-required" : "clear",
    restartSafe: blockingTasks.length === 0,
    taskCount: uniqueTasks.length,
    blockingTaskCount: blockingTasks.length,
    tasks: uniqueTasks,
    nextTask: uniqueTasks[0] || null,
    proof: proofHash(payload)
  };
}

function findBoundaryConflict(state, scope, linkId) {
  const existing = state.links[linkId] || state.links[scopedLinkId(scope, linkId)];
  if (!existing || !existing.scope || !scope) return null;
  if (existing.scope.tenantId === scope.tenantId && existing.scope.workspaceId === scope.workspaceId) return null;
  return {
    existingScope: existing.scope,
    requestedScope: scope,
    reason: "linkId is already owned by another tenant/workspace scope"
  };
}

function normalizeEvidence(value, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("evidence must include at least one evidence item");
    return [];
  }
  return value.map((item, index) => {
    if (typeof item === "string") {
      return { evidenceId: item.trim(), uri: null, digest: null, claimIds: [] };
    }
    if (!item || typeof item !== "object") {
      errors.push(`evidence[${index}] must be a string or object`);
      return null;
    }
    const evidenceId = normalizeText(item.evidenceId || item.id, `evidence[${index}].evidenceId`, errors);
    const claimRefs = Array.isArray(item.claimIds)
      ? item.claimIds
      : Array.isArray(item.claims)
        ? item.claims
        : item.claimId
          ? [item.claimId]
          : [];
    return {
      evidenceId,
      uri: typeof item.uri === "string" && item.uri.trim() ? item.uri.trim() : null,
      digest: typeof item.digest === "string" && item.digest.trim() ? item.digest.trim() : null,
      claimIds: [...new Set(claimRefs.filter((claimId) => typeof claimId === "string").map((claimId) => claimId.trim()).filter(Boolean))].sort()
    };
  }).filter((item) => item && item.evidenceId);
}

function normalizeClaimSet(commandClaimId, command = {}, errors = []) {
  const source = [
    commandClaimId,
    ...(Array.isArray(command.claimIds) ? command.claimIds : []),
    ...(Array.isArray(command.claims) ? command.claims.map((claim) => typeof claim === "string" ? claim : claim?.claimId || claim?.id) : [])
  ];
  const claimIds = [...new Set(source.filter((claimId) => typeof claimId === "string").map((claimId) => claimId.trim()).filter(Boolean))].sort();
  if (claimIds.length === 0) errors.push("claimId must resolve at least one claim");
  return claimIds;
}

function normalizePersistedEvidenceTrace(link) {
  const trace = link?.evidenceTrace && typeof link.evidenceTrace === "object" ? link.evidenceTrace : null;
  if (!trace) return null;
  const claims = Array.isArray(trace.claims)
    ? trace.claims.map((claim) => ({
      claimId: normalizeOptionalText(claim.claimId),
      requiredProofArtifactIds: Array.isArray(claim.requiredProofArtifactIds)
        ? claim.requiredProofArtifactIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()).sort()
        : [],
      proofArtifacts: normalizeProofArtifactRefs(claim.proofArtifacts || claim.requiredProofArtifacts),
      proofArtifactCount: normalizeNonNegativeInteger(claim.proofArtifactCount, 0),
      digestCoverage: Number.isFinite(claim.digestCoverage) ? claim.digestCoverage : 0,
      uriCoverage: Number.isFinite(claim.uriCoverage) ? claim.uriCoverage : 0,
      status: normalizeOptionalText(claim.status) || "unknown"
    })).filter((claim) => claim.claimId)
    : [];
  return {
    contractVersion: normalizeOptionalText(trace.contractVersion) || "aios.claim-evidence-link.evidence-trace.v1",
    status: normalizeOptionalText(trace.status) || "unknown",
    claimCount: normalizeNonNegativeInteger(trace.claimCount, claims.length),
    proofArtifactCount: normalizeNonNegativeInteger(trace.proofArtifactCount, 0),
    unassignedProofArtifactIds: Array.isArray(trace.unassignedProofArtifactIds)
      ? trace.unassignedProofArtifactIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()).sort()
      : [],
    missingClaimIds: Array.isArray(trace.missingClaimIds)
      ? trace.missingClaimIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()).sort()
      : [],
    proofArtifacts: normalizeProofArtifactRefs(trace.proofArtifacts || trace.requiredProofArtifacts),
    claims,
    proof: normalizeOptionalText(trace.proof)
  };
}

function normalizeIdList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))].sort()
    : [];
}

function normalizeProofArtifactRefs(value) {
  return Array.isArray(value)
    ? value.map((item) => {
      const source = item && typeof item === "object" ? item : {};
      const proofArtifactId = normalizeOptionalText(source.proofArtifactId || source.evidenceId || source.id);
      if (!proofArtifactId) return null;
      return {
        proofArtifactId,
        evidenceId: normalizeOptionalText(source.evidenceId) || proofArtifactId,
        uri: normalizeOptionalText(source.uri),
        digest: normalizeOptionalText(source.digest),
        status: normalizeOptionalText(source.status) || "linked",
        claimIds: normalizeIdList(source.claimIds)
      };
    }).filter(Boolean).sort((left, right) => left.proofArtifactId.localeCompare(right.proofArtifactId))
    : [];
}

function buildProofArtifactReferenceIndex(evidence = []) {
  const refs = new Map();
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const evidenceId = normalizeOptionalText(item?.evidenceId || item?.id || (typeof item === "string" ? item : null));
    if (!evidenceId || refs.has(evidenceId)) continue;
    refs.set(evidenceId, {
      proofArtifactId: evidenceId,
      evidenceId,
      uri: normalizeOptionalText(item?.uri),
      digest: normalizeOptionalText(item?.digest),
      status: "linked",
      claimIds: normalizeIdList(item?.claimIds)
    });
  }
  return refs;
}

function proofArtifactRefsForIds(requiredProofArtifactIds, referenceIndex) {
  return normalizeIdList(requiredProofArtifactIds).map((proofArtifactId) => {
    const ref = referenceIndex?.get(proofArtifactId);
    return ref || {
      proofArtifactId,
      evidenceId: proofArtifactId,
      uri: null,
      digest: null,
      status: "unresolved",
      claimIds: []
    };
  });
}

function normalizeEvidenceReferencePolicy(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    contractVersion: "aios.claim-evidence-link.evidence-reference-policy.v1",
    requireDigest: source.requireDigest === true || source.requireEvidenceDigest === true,
    requireLocator: source.requireLocator !== false,
    locatorFields: ["uri", "digest"]
  };
}

function evaluateEvidenceReference(ref, policy = {}) {
  const evidenceId = normalizeOptionalText(ref?.evidenceId || ref?.proofArtifactId);
  const uri = normalizeOptionalText(ref?.uri);
  const digest = normalizeOptionalText(ref?.digest);
  const normalizedPolicy = normalizeEvidenceReferencePolicy(policy);
  const reasons = [
    normalizedPolicy.requireLocator && !uri && !digest ? "evidence-reference-locator-missing" : null,
    normalizedPolicy.requireDigest && !digest ? "evidence-reference-digest-missing" : null,
    ref?.resolved === false ? "evidence-reference-unresolved" : null
  ].filter(Boolean);
  return {
    evidenceId,
    proofArtifactId: normalizeOptionalText(ref?.proofArtifactId) || evidenceId,
    hasUri: Boolean(uri),
    hasDigest: Boolean(digest),
    locatorFieldsPresent: [
      uri ? "uri" : null,
      digest ? "digest" : null
    ].filter(Boolean),
    policy: normalizedPolicy,
    compliant: reasons.length === 0,
    reasons
  };
}

function sameIdList(left, right) {
  const normalizedLeft = normalizeIdList(left);
  const normalizedRight = normalizeIdList(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

function buildClaimProofArtifactCoverage(link, manifest, trace = null) {
  const manifestClaims = Array.isArray(manifest?.claims) ? manifest.claims : [];
  const traceClaims = new Map((Array.isArray(trace?.claims) ? trace.claims : [])
    .filter((claim) => normalizeOptionalText(claim?.claimId))
    .map((claim) => [normalizeOptionalText(claim.claimId), claim]));
  const claimCoverage = manifestClaims
    .filter((claim) => normalizeOptionalText(claim?.claimId))
    .map((claim) => {
      const claimId = normalizeOptionalText(claim.claimId);
      const requiredProofArtifactIds = normalizeIdList(claim.requiredProofArtifactIds);
      const proofArtifacts = normalizeProofArtifactRefs(claim.proofArtifacts || claim.requiredProofArtifacts);
      const resolvedIds = normalizeIdList(proofArtifacts
        .filter((ref) => ref.status !== "unresolved")
        .map((ref) => ref.proofArtifactId));
      const unresolvedIds = requiredProofArtifactIds
        .filter((id) => !resolvedIds.includes(id) || proofArtifacts.some((ref) => ref.proofArtifactId === id && ref.status === "unresolved"))
        .sort();
      const traceClaim = traceClaims.get(claimId);
      const traceRequiredIds = normalizeIdList(traceClaim?.requiredProofArtifactIds);
      const staleRequiredIds = traceRequiredIds.length > 0 && !sameIdList(requiredProofArtifactIds, traceRequiredIds)
        ? requiredProofArtifactIds.filter((id) => !traceRequiredIds.includes(id)).sort()
        : [];
      const missingFromManifestIds = traceRequiredIds.filter((id) => !requiredProofArtifactIds.includes(id)).sort();
      const artifactIdsWithDigest = normalizeIdList(proofArtifacts.filter((ref) => ref.digest).map((ref) => ref.proofArtifactId));
      const artifactIdsWithUri = normalizeIdList(proofArtifacts.filter((ref) => ref.uri).map((ref) => ref.proofArtifactId));
      const reasons = [
        requiredProofArtifactIds.length === 0 ? "required-proof-artifacts-empty" : null,
        unresolvedIds.length > 0 ? "required-proof-artifacts-unresolved" : null,
        missingFromManifestIds.length > 0 ? "trace-required-artifacts-missing-from-manifest" : null,
        staleRequiredIds.length > 0 ? "manifest-required-artifacts-not-in-trace" : null,
        !traceClaim ? "claim-not-in-evidence-trace" : null
      ].filter(Boolean);
      return {
        claimId,
        artifactId: normalizeOptionalText(claim.artifactId || link?.artifactId),
        status: reasons.length === 0 ? "traceable" : "incomplete",
        requiredProofArtifactIds,
        resolvedProofArtifactIds: resolvedIds,
        unresolvedProofArtifactIds: [...new Set([...unresolvedIds, ...missingFromManifestIds])].sort(),
        staleProofArtifactIds: staleRequiredIds,
        proofArtifactCount: requiredProofArtifactIds.length,
        resolvedProofArtifactCount: resolvedIds.length,
        unresolvedProofArtifactCount: [...new Set([...unresolvedIds, ...missingFromManifestIds])].length,
        digestCoverage: requiredProofArtifactIds.length === 0 ? 0 : Number((artifactIdsWithDigest.length / requiredProofArtifactIds.length).toFixed(4)),
        uriCoverage: requiredProofArtifactIds.length === 0 ? 0 : Number((artifactIdsWithUri.length / requiredProofArtifactIds.length).toFixed(4)),
        evidenceTraceProof: trace?.proof || null,
        reasons
      };
    });
  const unresolvedClaimIds = claimCoverage.filter((claim) => claim.status !== "traceable").map((claim) => claim.claimId).sort();
  const unresolvedProofArtifactIds = normalizeIdList(claimCoverage.flatMap((claim) => claim.unresolvedProofArtifactIds));
  const staleProofArtifactIds = normalizeIdList(claimCoverage.flatMap((claim) => claim.staleProofArtifactIds));
  const payload = {
    surfaceId,
    linkId: link?.linkId || null,
    scopeKey: link?.scope?.scopeKey || null,
    manifestProof: manifest?.proof || null,
    traceProof: trace?.proof || null,
    claimCoverage
  };
  return {
    contractVersion: "aios.claim-evidence-link.claim-proof-artifact-coverage.v1",
    status: unresolvedClaimIds.length === 0 && claimCoverage.length > 0 ? "complete" : "incomplete",
    claimCount: claimCoverage.length,
    traceableClaimCount: claimCoverage.filter((claim) => claim.status === "traceable").length,
    unresolvedClaimIds,
    unresolvedProofArtifactIds,
    staleProofArtifactIds,
    claims: claimCoverage,
    proof: proofHash(payload)
  };
}

function buildClaimProofRepairActions({ link, claimId, reasons, unresolvedProofArtifactIds }) {
  const routeBase = `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(link?.linkId || "unresolved-link")}`;
  const actionByReason = {
    "required-proof-artifacts-empty": {
      type: "attach-claim-proof-artifact",
      route: `${routeBase}/claims/${encodeURIComponent(claimId)}/proof-artifacts`,
      command: "claim-evidence-link.claim.attach-proof-artifact",
      field: "evidence.claimIds",
      remediation: "Attach at least one evidence item to this claim so audit handoff can prove the claim-to-artifact assertion."
    },
    "required-proof-artifacts-unresolved": {
      type: "resolve-claim-proof-artifact",
      route: `${routeBase}/proof-artifacts/resolve`,
      command: "claim-evidence-link.proof-artifacts.resolve",
      field: "claimEvidenceManifest.claims.proofArtifacts",
      remediation: "Resolve each required proof artifact id to an evidence record with locator metadata before handoff export."
    },
    "claim-not-in-evidence-trace": {
      type: "refresh-evidence-trace",
      route: `${routeBase}/evidence-trace/refresh`,
      command: "claim-evidence-link.evidence-trace.refresh",
      field: "evidenceTrace.claims",
      remediation: "Regenerate evidenceTrace so this claim appears in the persisted claim-to-proof trace."
    },
    "claim-not-in-trace-validation": {
      type: "reconcile-manifest-claim",
      route: `${routeBase}/claim-evidence-manifest/reconcile`,
      command: "claim-evidence-link.claim-evidence-manifest.reconcile",
      field: "claimEvidenceManifest.claims",
      remediation: "Remove stale manifest claim rows or rebuild the manifest from the current evidence trace."
    }
  };
  return [...new Set(reasons)].map((reason) => {
    const template = actionByReason[reason] || {
      type: "repair-claim-proof-index",
      route: `${routeBase}/claim-proof-index/repair`,
      command: "claim-evidence-link.claim-proof-index.repair",
      field: "claimProofIndex",
      remediation: "Repair this claim proof index entry before treating the claim as handoff-ready."
    };
    return {
      ...template,
      reason,
      claimId,
      linkId: link?.linkId || null,
      unresolvedProofArtifactIds: normalizeIdList(unresolvedProofArtifactIds)
    };
  });
}

function buildClaimProofFailureState({ link, claimId, reasons, unresolvedProofArtifactIds, retryAttempt = 1 }) {
  const uniqueReasons = [...new Set(reasons || [])].sort();
  const blockedReasons = new Set([
    "required-proof-artifacts-empty",
    "claim-not-in-evidence-trace",
    "claim-not-in-trace-validation"
  ]);
  const blocked = uniqueReasons.some((reason) => blockedReasons.has(reason));
  const retryAfterMs = uniqueReasons.length > 0 ? retryDelayMs(retryAttempt) : null;
  const repairActions = buildClaimProofRepairActions({ link, claimId, reasons: uniqueReasons, unresolvedProofArtifactIds });
  const payload = {
    surfaceId,
    linkId: link?.linkId || null,
    scopeKey: link?.scope?.scopeKey || null,
    claimId,
    reasons: uniqueReasons,
    unresolvedProofArtifactIds: normalizeIdList(unresolvedProofArtifactIds),
    retryAttempt,
    blocked
  };
  return {
    contractVersion: "aios.claim-evidence-link.claim-proof-failure-state.v1",
    status: uniqueReasons.length === 0 ? "ready" : blocked ? "blocked" : "degraded",
    retryable: uniqueReasons.length > 0,
    blocked,
    degradedMode: uniqueReasons.length === 0
      ? "none"
      : blocked
        ? "handoff-blocked"
        : "local-review-only",
    retryAttempt: uniqueReasons.length > 0 ? retryAttempt : 0,
    retryAfterMs,
    actionableError: uniqueReasons.length > 0
      ? {
        code: blocked ? "AFS_CEL_CLAIM_PROOF_BLOCKED" : "AFS_CEL_CLAIM_PROOF_DEGRADED",
        path: `claimProofIndex.byClaimId.${claimId}`,
        message: blocked
          ? "Claim proof artifacts are missing from the required trace path"
          : "Claim proof artifacts need repair before audit handoff",
        retryable: true,
        remediation: repairActions[0]?.remediation || "Repair claim proof artifacts before handoff export."
      }
      : null,
    repairActions,
    proof: proofHash(payload)
  };
}

function buildClaimProofIndex(link, manifest, trace = null) {
  const normalizedManifest = manifest && typeof manifest === "object" ? manifest : null;
  const normalizedTrace = trace && typeof trace === "object" ? trace : null;
  const traceClaims = new Map((Array.isArray(normalizedTrace?.claims) ? normalizedTrace.claims : [])
    .filter((claim) => normalizeOptionalText(claim?.claimId))
    .map((claim) => [normalizeOptionalText(claim.claimId), claim]));
  const coverage = normalizedManifest?.coverage || buildClaimProofArtifactCoverage(link, normalizedManifest, normalizedTrace);
  const manifestClaims = Array.isArray(normalizedManifest?.claims) ? normalizedManifest.claims : [];
  const claims = manifestClaims
    .filter((claim) => normalizeOptionalText(claim?.claimId))
    .map((claim) => {
      const claimId = normalizeOptionalText(claim.claimId);
      const traceClaim = traceClaims.get(claimId);
      const requiredProofArtifactIds = normalizeIdList(claim.requiredProofArtifactIds);
      const proofArtifacts = normalizeProofArtifactRefs(claim.proofArtifacts || claim.requiredProofArtifacts);
      const resolvedProofArtifacts = proofArtifacts.filter((ref) => ref.status !== "unresolved");
      const resolvedProofArtifactIds = normalizeIdList(resolvedProofArtifacts.map((ref) => ref.proofArtifactId));
      const unresolvedProofArtifactIds = requiredProofArtifactIds
        .filter((id) => !resolvedProofArtifactIds.includes(id) || proofArtifacts.some((ref) => ref.proofArtifactId === id && ref.status === "unresolved"))
        .sort();
      const digestProofArtifactIds = normalizeIdList(proofArtifacts.filter((ref) => ref.digest).map((ref) => ref.proofArtifactId));
      const uriProofArtifactIds = normalizeIdList(proofArtifacts.filter((ref) => ref.uri).map((ref) => ref.proofArtifactId));
      const reasons = [
        requiredProofArtifactIds.length === 0 ? "required-proof-artifacts-empty" : null,
        unresolvedProofArtifactIds.length > 0 ? "required-proof-artifacts-unresolved" : null,
        !traceClaim ? "claim-not-in-evidence-trace" : null,
        normalizedManifest?.validation?.unknownClaimIds?.includes(claimId) ? "claim-not-in-trace-validation" : null
      ].filter(Boolean);
      const failureState = buildClaimProofFailureState({
        link,
        claimId,
        reasons,
        unresolvedProofArtifactIds,
        retryAttempt: reasons.includes("required-proof-artifacts-empty") ? 0 : 1
      });
      const entry = {
        claimId,
        artifactId: normalizeOptionalText(claim.artifactId || link?.artifactId),
        status: reasons.length === 0 ? "traceable" : "incomplete",
        requiredProofArtifactIds,
        resolvedProofArtifactIds,
        unresolvedProofArtifactIds,
        primaryProofArtifactId: resolvedProofArtifactIds[0] || null,
        proofArtifacts,
        proofArtifactCount: requiredProofArtifactIds.length,
        resolvedProofArtifactCount: resolvedProofArtifactIds.length,
        unresolvedProofArtifactCount: unresolvedProofArtifactIds.length,
        digestProofArtifactIds,
        uriProofArtifactIds,
        digestCoverage: requiredProofArtifactIds.length === 0 ? 0 : Number((digestProofArtifactIds.length / requiredProofArtifactIds.length).toFixed(4)),
        uriCoverage: requiredProofArtifactIds.length === 0 ? 0 : Number((uriProofArtifactIds.length / requiredProofArtifactIds.length).toFixed(4)),
        evidenceTraceProof: normalizedTrace?.proof || null,
        claimEvidenceManifestProof: normalizedManifest?.proof || null,
        failureState,
        reasons
      };
      return {
        ...entry,
        proof: proofHash({ surfaceId, linkId: link?.linkId || null, scopeKey: link?.scope?.scopeKey || null, entry })
      };
    });
  const byClaimId = Object.fromEntries(claims.map((claim) => [claim.claimId, {
    status: claim.status,
    requiredProofArtifactIds: claim.requiredProofArtifactIds,
    resolvedProofArtifactIds: claim.resolvedProofArtifactIds,
    unresolvedProofArtifactIds: claim.unresolvedProofArtifactIds,
    proof: claim.proof
  }]));
  const unresolvedClaimIds = normalizeIdList([
    ...claims.filter((claim) => claim.status !== "traceable").map((claim) => claim.claimId),
    ...(coverage?.unresolvedClaimIds || []),
    ...(normalizedManifest?.missingClaimIds || [])
  ]);
  const resolvedProofArtifactIds = normalizeIdList(claims.flatMap((claim) => claim.resolvedProofArtifactIds));
  const unresolvedProofArtifactIds = normalizeIdList([
    ...claims.flatMap((claim) => claim.unresolvedProofArtifactIds),
    ...(coverage?.unresolvedProofArtifactIds || [])
  ]);
  const failureStates = claims.map((claim) => claim.failureState).filter((failureState) => failureState?.status !== "ready");
  const blockedFailureStates = failureStates.filter((failureState) => failureState.blocked);
  const claimProofReadiness = {
    contractVersion: "aios.claim-evidence-link.claim-proof-readiness.v1",
    status: failureStates.length === 0 ? "ready" : blockedFailureStates.length > 0 ? "blocked" : "degraded",
    ready: failureStates.length === 0,
    degradedMode: failureStates.length === 0 ? "none" : blockedFailureStates.length > 0 ? "handoff-blocked" : "local-review-only",
    blockedClaimIds: blockedFailureStates.map((failureState) => failureState.actionableError?.path?.split(".").pop()).filter(Boolean).sort(),
    retryableClaimIds: failureStates.map((failureState) => failureState.actionableError?.path?.split(".").pop()).filter(Boolean).sort(),
    actionableErrors: failureStates.map((failureState) => failureState.actionableError).filter(Boolean),
    repairActions: failureStates.flatMap((failureState) => failureState.repairActions || []),
    nextRetryAfterMs: failureStates.length > 0 ? Math.min(...failureStates.map((failureState) => failureState.retryAfterMs || retryDelayMs(1))) : null,
    proof: proofHash({
      surfaceId,
      linkId: link?.linkId || null,
      failureProofs: failureStates.map((failureState) => failureState.proof)
    })
  };
  const payload = {
    surfaceId,
    linkId: link?.linkId || null,
    scopeKey: link?.scope?.scopeKey || null,
    claimIds: claims.map((claim) => claim.claimId),
    resolvedProofArtifactIds,
    unresolvedClaimIds,
    unresolvedProofArtifactIds,
    manifestProof: normalizedManifest?.proof || null,
    traceProof: normalizedTrace?.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.claim-proof-index.v1",
    status: claims.length > 0 && unresolvedClaimIds.length === 0 && unresolvedProofArtifactIds.length === 0 ? "complete" : "incomplete",
    claimCount: claims.length,
    traceableClaimCount: claims.filter((claim) => claim.status === "traceable").length,
    proofArtifactCount: normalizeIdList(claims.flatMap((claim) => claim.requiredProofArtifactIds)).length,
    resolvedProofArtifactCount: resolvedProofArtifactIds.length,
    unresolvedClaimIds,
    unresolvedProofArtifactIds,
    byClaimId,
    claims,
    readiness: claimProofReadiness,
    evidenceTraceProof: normalizedTrace?.proof || null,
    claimEvidenceManifestProof: normalizedManifest?.proof || null,
    coverageProof: coverage?.proof || null,
    proof: proofHash(payload)
  };
}

function buildArtifactClaimEvidenceLinks(link, manifest, trace = null, policy = {}) {
  const normalizedManifest = manifest && typeof manifest === "object" ? manifest : evidenceManifestForLink(link);
  const normalizedTrace = trace && typeof trace === "object" ? trace : link?.evidenceTrace || null;
  const evidenceReferencePolicy = normalizeEvidenceReferencePolicy(policy);
  const claimProofIndex = buildClaimProofIndex(link, normalizedManifest, normalizedTrace);
  const evidenceById = new Map((Array.isArray(link?.evidence) ? link.evidence : [])
    .filter((item) => normalizeOptionalText(item?.evidenceId || item?.id || (typeof item === "string" ? item : null)))
    .map((item) => {
      const evidenceId = normalizeOptionalText(item?.evidenceId || item?.id || (typeof item === "string" ? item : null));
      return [evidenceId, {
        evidenceId,
        uri: normalizeOptionalText(item?.uri),
        digest: normalizeOptionalText(item?.digest),
        claimIds: normalizeIdList(item?.claimIds)
      }];
    }));
  const claims = Array.isArray(claimProofIndex.claims) ? claimProofIndex.claims : [];
  const entries = claims.map((claim) => {
    const requiredProofArtifactIds = normalizeIdList(claim.requiredProofArtifactIds);
    const resolvedProofArtifactIds = normalizeIdList(claim.resolvedProofArtifactIds);
    const unresolvedProofArtifactIds = normalizeIdList(claim.unresolvedProofArtifactIds);
    const evidenceRefs = requiredProofArtifactIds.map((proofArtifactId) => {
      const evidence = evidenceById.get(proofArtifactId);
      const proofArtifact = normalizeProofArtifactRefs(claim.proofArtifacts)
        .find((ref) => ref.proofArtifactId === proofArtifactId);
      return {
        proofArtifactId,
        evidenceId: evidence?.evidenceId || proofArtifact?.evidenceId || proofArtifactId,
        uri: evidence?.uri || proofArtifact?.uri || null,
        digest: evidence?.digest || proofArtifact?.digest || null,
        resolved: resolvedProofArtifactIds.includes(proofArtifactId) && !unresolvedProofArtifactIds.includes(proofArtifactId),
        proofArtifactStatus: proofArtifact?.status || (evidence ? "linked" : "unresolved")
      };
    });
    const evidenceReferenceChecks = evidenceRefs.map((ref) => evaluateEvidenceReference(ref, evidenceReferencePolicy));
    const unresolvedEvidenceIds = evidenceRefs
      .filter((ref) => !ref.resolved)
      .map((ref) => ref.evidenceId)
      .sort();
    const nonCompliantEvidenceIds = evidenceReferenceChecks
      .filter((check) => !check.compliant)
      .map((check) => check.evidenceId)
      .filter(Boolean)
      .sort();
    const missingDigestEvidenceIds = evidenceReferenceChecks
      .filter((check) => check.reasons.includes("evidence-reference-digest-missing"))
      .map((check) => check.evidenceId)
      .filter(Boolean)
      .sort();
    const missingLocatorEvidenceIds = evidenceReferenceChecks
      .filter((check) => check.reasons.includes("evidence-reference-locator-missing"))
      .map((check) => check.evidenceId)
      .filter(Boolean)
      .sort();
    const policyReasons = [...new Set(evidenceReferenceChecks.flatMap((check) => check.reasons))].sort();
    const entry = {
      claimId: claim.claimId,
      artifactId: claim.artifactId || link?.artifactId || null,
      linkId: link?.linkId || null,
      status: claim.status === "traceable" && unresolvedEvidenceIds.length === 0 && nonCompliantEvidenceIds.length === 0 ? "linked" : "incomplete",
      requiredEvidenceIds: requiredProofArtifactIds,
      linkedEvidenceIds: evidenceRefs.filter((ref) => ref.resolved).map((ref) => ref.evidenceId).sort(),
      unresolvedEvidenceIds,
      nonCompliantEvidenceIds,
      missingDigestEvidenceIds,
      missingLocatorEvidenceIds,
      evidenceRefs,
      evidenceReferenceChecks,
      evidenceCount: evidenceRefs.length,
      linkedEvidenceCount: evidenceRefs.filter((ref) => ref.resolved).length,
      evidenceReferencePolicy,
      evidenceReferencePolicyStatus: policyReasons.length === 0 ? "satisfied" : "violated",
      evidenceReferencePolicyReasons: policyReasons,
      digestCoverage: claim.digestCoverage || 0,
      uriCoverage: claim.uriCoverage || 0,
      claimProofIndexEntryProof: claim.proof || null,
      reasons: [...new Set([...(claim.reasons || []), ...policyReasons])].sort()
    };
    return {
      ...entry,
      proof: proofHash({
        surfaceId,
        linkId: entry.linkId,
        artifactId: entry.artifactId,
        claimId: entry.claimId,
        evidenceRefs,
        indexProof: claim.proof || null
      })
    };
  });
  const incompleteEntries = entries.filter((entry) => entry.status !== "linked");
  const payload = {
    surfaceId,
    linkId: link?.linkId || null,
    artifactId: link?.artifactId || null,
    evidenceReferencePolicy,
    manifestProof: normalizedManifest?.proof || null,
    claimProofIndexProof: claimProofIndex.proof,
    entries: entries.map((entry) => ({
      claimId: entry.claimId,
      status: entry.status,
      requiredEvidenceIds: entry.requiredEvidenceIds,
      linkedEvidenceIds: entry.linkedEvidenceIds,
      unresolvedEvidenceIds: entry.unresolvedEvidenceIds,
      nonCompliantEvidenceIds: entry.nonCompliantEvidenceIds,
      proof: entry.proof
    }))
  };
  return {
    contractVersion: "aios.claim-evidence-link.artifact-claim-evidence-links.v1",
    status: entries.length > 0 && incompleteEntries.length === 0 ? "complete" : "incomplete",
    linkId: link?.linkId || null,
    artifactId: link?.artifactId || null,
    evidenceReferencePolicy,
    claimCount: entries.length,
    linkedClaimCount: entries.length - incompleteEntries.length,
    evidenceCount: normalizeIdList(entries.flatMap((entry) => entry.requiredEvidenceIds)).length,
    unresolvedClaimIds: incompleteEntries.map((entry) => entry.claimId).sort(),
    unresolvedEvidenceIds: normalizeIdList(incompleteEntries.flatMap((entry) => entry.unresolvedEvidenceIds)),
    nonCompliantEvidenceIds: normalizeIdList(incompleteEntries.flatMap((entry) => entry.nonCompliantEvidenceIds)),
    missingDigestEvidenceIds: normalizeIdList(incompleteEntries.flatMap((entry) => entry.missingDigestEvidenceIds)),
    missingLocatorEvidenceIds: normalizeIdList(incompleteEntries.flatMap((entry) => entry.missingLocatorEvidenceIds)),
    evidenceReferencePolicyReasons: [...new Set(incompleteEntries.flatMap((entry) => entry.evidenceReferencePolicyReasons))].sort(),
    entries,
    manifestProof: normalizedManifest?.proof || null,
    claimProofIndexProof: claimProofIndex.proof,
    proof: proofHash(payload)
  };
}

function buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks = null) {
  const sourceLinks = artifactClaimEvidenceLinks && typeof artifactClaimEvidenceLinks === "object"
    ? artifactClaimEvidenceLinks
    : artifactClaimEvidenceLinksForState({ lifecycle: defaultLifecycleSettings }, link);
  const traceClaimIds = Array.isArray(link?.evidenceTrace?.claims)
    ? link.evidenceTrace.claims.map((claim) => claim?.claimId)
    : [];
  const declaredClaimIds = normalizeIdList([link?.claimId, ...traceClaimIds]);
  const entries = Array.isArray(sourceLinks.entries) ? sourceLinks.entries : [];
  const claimRows = entries
    .filter((entry) => normalizeOptionalText(entry?.claimId))
    .map((entry) => {
      const evidenceRefs = Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs : [];
      const linkedEvidenceIds = normalizeIdList(entry.linkedEvidenceIds);
      const unresolvedEvidenceIds = normalizeIdList(entry.unresolvedEvidenceIds);
      const nonCompliantEvidenceIds = normalizeIdList(entry.nonCompliantEvidenceIds);
      const proofArtifactEdges = evidenceRefs.map((ref) => {
        const evidenceId = normalizeOptionalText(ref.evidenceId || ref.proofArtifactId);
        const proofArtifactId = normalizeOptionalText(ref.proofArtifactId) || evidenceId;
        const hasLocator = Boolean(normalizeOptionalText(ref.uri) || normalizeOptionalText(ref.digest));
        const edgeReasons = [
          ref.resolved === false ? "evidence-reference-unresolved" : null,
          !hasLocator ? "evidence-reference-locator-missing" : null,
          nonCompliantEvidenceIds.includes(evidenceId) ? "evidence-reference-policy-violated" : null
        ].filter(Boolean);
        return {
          edgeId: proofHash({
            surfaceId,
            linkId: link?.linkId || null,
            claimId: entry.claimId,
            evidenceId,
            proofArtifactId
          }),
          claimId: entry.claimId,
          artifactId: entry.artifactId || link?.artifactId || null,
          evidenceId,
          proofArtifactId,
          resolved: ref.resolved === true,
          hasUri: Boolean(normalizeOptionalText(ref.uri)),
          hasDigest: Boolean(normalizeOptionalText(ref.digest)),
          hasLocator,
          proofArtifactStatus: normalizeOptionalText(ref.proofArtifactStatus) || "unknown",
          status: edgeReasons.length === 0 ? "linked" : "incomplete",
          reasons: edgeReasons
        };
      });
      const edgeReasons = [...new Set([
        ...(entry.reasons || []),
        ...proofArtifactEdges.flatMap((edge) => edge.reasons)
      ])].sort();
      return {
        claimId: entry.claimId,
        artifactId: entry.artifactId || link?.artifactId || null,
        status: entry.status === "linked" && edgeReasons.length === 0 ? "linked" : "incomplete",
        requiredEvidenceIds: normalizeIdList(entry.requiredEvidenceIds),
        linkedEvidenceIds,
        unresolvedEvidenceIds,
        nonCompliantEvidenceIds,
        missingDigestEvidenceIds: normalizeIdList(entry.missingDigestEvidenceIds),
        missingLocatorEvidenceIds: normalizeIdList(entry.missingLocatorEvidenceIds),
        proofArtifactEdges,
        edgeCount: proofArtifactEdges.length,
        linkedEdgeCount: proofArtifactEdges.filter((edge) => edge.status === "linked").length,
        reasons: edgeReasons,
        artifactClaimEvidenceLinkProof: entry.proof || null,
        proof: proofHash({
          surfaceId,
          linkId: link?.linkId || null,
          scopeKey: link?.scope?.scopeKey || null,
          claimId: entry.claimId,
          proofArtifactEdges,
          artifactClaimEvidenceLinkProof: entry.proof || null
        })
      };
    });
  const representedClaimIds = normalizeIdList(claimRows.map((row) => row.claimId));
  const missingClaimIds = declaredClaimIds.filter((claimId) => !representedClaimIds.includes(claimId)).sort();
  const incompleteClaimIds = normalizeIdList([
    ...missingClaimIds,
    ...claimRows.filter((row) => row.status !== "linked").map((row) => row.claimId),
    ...(sourceLinks.unresolvedClaimIds || [])
  ]);
  const unresolvedEvidenceIds = normalizeIdList([
    ...claimRows.flatMap((row) => row.unresolvedEvidenceIds),
    ...(sourceLinks.unresolvedEvidenceIds || [])
  ]);
  const nonCompliantEvidenceIds = normalizeIdList([
    ...claimRows.flatMap((row) => row.nonCompliantEvidenceIds),
    ...(sourceLinks.nonCompliantEvidenceIds || [])
  ]);
  const payload = {
    surfaceId,
    linkId: link?.linkId || null,
    artifactId: link?.artifactId || null,
    scopeKey: link?.scope?.scopeKey || null,
    declaredClaimIds,
    incompleteClaimIds,
    unresolvedEvidenceIds,
    nonCompliantEvidenceIds,
    artifactClaimEvidenceLinksProof: sourceLinks.proof || null,
    rowProofs: claimRows.map((row) => row.proof)
  };
  return {
    contractVersion: "aios.claim-evidence-link.claim-evidence-trace-matrix.v1",
    status: declaredClaimIds.length > 0
      && claimRows.length > 0
      && incompleteClaimIds.length === 0
      && unresolvedEvidenceIds.length === 0
      && nonCompliantEvidenceIds.length === 0
      && sourceLinks.status === "complete"
      ? "complete"
      : "incomplete",
    linkId: link?.linkId || null,
    artifactId: link?.artifactId || null,
    declaredClaimIds,
    representedClaimIds,
    missingClaimIds,
    claimCount: declaredClaimIds.length,
    linkedClaimCount: claimRows.filter((row) => row.status === "linked").length,
    edgeCount: claimRows.reduce((total, row) => total + row.edgeCount, 0),
    linkedEdgeCount: claimRows.reduce((total, row) => total + row.linkedEdgeCount, 0),
    incompleteClaimIds,
    unresolvedEvidenceIds,
    nonCompliantEvidenceIds,
    missingDigestEvidenceIds: normalizeIdList(claimRows.flatMap((row) => row.missingDigestEvidenceIds)),
    missingLocatorEvidenceIds: normalizeIdList(claimRows.flatMap((row) => row.missingLocatorEvidenceIds)),
    rows: claimRows,
    artifactClaimEvidenceLinksProof: sourceLinks.proof || null,
    proof: proofHash(payload)
  };
}

function validateClaimEvidenceManifest(link, manifest, trace = link?.evidenceTrace || null) {
  const normalizedTrace = trace && typeof trace === "object" ? trace : null;
  const traceClaims = new Map((Array.isArray(normalizedTrace?.claims) ? normalizedTrace.claims : [])
    .filter((claim) => normalizeOptionalText(claim?.claimId))
    .map((claim) => [normalizeOptionalText(claim.claimId), {
      artifactId: normalizeOptionalText(claim.artifactId || link?.artifactId),
      requiredProofArtifactIds: normalizeIdList(claim.requiredProofArtifactIds),
      proofArtifacts: normalizeProofArtifactRefs(claim.proofArtifacts || claim.requiredProofArtifacts)
    }]));
  const manifestClaims = new Map((Array.isArray(manifest?.claims) ? manifest.claims : [])
    .filter((claim) => normalizeOptionalText(claim?.claimId))
    .map((claim) => [normalizeOptionalText(claim.claimId), {
      artifactId: normalizeOptionalText(claim.artifactId || link?.artifactId),
      requiredProofArtifactIds: normalizeIdList(claim.requiredProofArtifactIds),
      proofArtifacts: normalizeProofArtifactRefs(claim.proofArtifacts || claim.requiredProofArtifacts),
      status: normalizeOptionalText(claim.status) || "unknown"
    }]));
  const missingClaimIds = [];
  const staleClaimIds = [];
  const untraceableClaimIds = [];
  const artifactMismatchClaimIds = [];
  const unresolvedArtifactClaimIds = [];

  for (const [claimId, traceClaim] of traceClaims) {
    const manifestClaim = manifestClaims.get(claimId);
    if (!manifestClaim) {
      missingClaimIds.push(claimId);
      continue;
    }
    if (manifestClaim.requiredProofArtifactIds.length === 0 || manifestClaim.status !== "traceable") {
      untraceableClaimIds.push(claimId);
    }
    if (!sameIdList(manifestClaim.requiredProofArtifactIds, traceClaim.requiredProofArtifactIds)) {
      staleClaimIds.push(claimId);
    }
    const manifestRefIds = manifestClaim.proofArtifacts.map((ref) => ref.proofArtifactId);
    const traceRefIds = traceClaim.proofArtifacts.length > 0
      ? traceClaim.proofArtifacts.map((ref) => ref.proofArtifactId)
      : traceClaim.requiredProofArtifactIds;
    if (!sameIdList(manifestRefIds, traceRefIds) || manifestClaim.proofArtifacts.some((ref) => ref.status === "unresolved")) {
      unresolvedArtifactClaimIds.push(claimId);
    }
    if (traceClaim.artifactId && manifestClaim.artifactId && traceClaim.artifactId !== manifestClaim.artifactId) {
      artifactMismatchClaimIds.push(claimId);
    }
  }

  const coverage = buildClaimProofArtifactCoverage(link, manifest, normalizedTrace);
  const unknownClaimIds = [...manifestClaims.keys()].filter((claimId) => !traceClaims.has(claimId)).sort();
  const traceMissingClaimIds = normalizeIdList(normalizedTrace?.missingClaimIds);
  const reasons = [
    !normalizedTrace ? "evidence-trace-missing" : null,
    normalizedTrace?.status && normalizedTrace.status !== "complete" ? "evidence-trace-incomplete" : null,
    traceClaims.size === 0 ? "evidence-trace-claims-missing" : null,
    missingClaimIds.length > 0 ? "manifest-claim-missing" : null,
    unknownClaimIds.length > 0 ? "manifest-claim-not-in-trace" : null,
    staleClaimIds.length > 0 ? "manifest-proof-artifacts-stale" : null,
    untraceableClaimIds.length > 0 ? "manifest-proof-artifacts-missing" : null,
    unresolvedArtifactClaimIds.length > 0 ? "manifest-proof-artifact-refs-unresolved" : null,
    coverage.status !== "complete" ? "claim-proof-artifact-coverage-incomplete" : null,
    artifactMismatchClaimIds.length > 0 ? "manifest-artifact-mismatch" : null,
    traceMissingClaimIds.length > 0 ? "trace-claim-proof-missing" : null,
    !manifest?.proof ? "manifest-proof-missing" : null
  ].filter(Boolean);
  return {
    contractVersion: "aios.claim-evidence-link.claim-evidence-manifest-validation.v1",
    status: reasons.length === 0 ? "complete" : "incomplete",
    complete: reasons.length === 0,
    reasons,
    missingClaimIds: [...new Set([...missingClaimIds, ...traceMissingClaimIds])].sort(),
    unknownClaimIds,
    staleClaimIds: [...new Set(staleClaimIds)].sort(),
    untraceableClaimIds: [...new Set(untraceableClaimIds)].sort(),
    unresolvedArtifactClaimIds: [...new Set(unresolvedArtifactClaimIds)].sort(),
    artifactMismatchClaimIds: [...new Set(artifactMismatchClaimIds)].sort(),
    traceClaimCount: traceClaims.size,
    manifestClaimCount: manifestClaims.size,
    coverage,
    proof: proofHash({
      surfaceId,
      linkId: link?.linkId || null,
      traceProof: normalizedTrace?.proof || null,
      manifestProof: manifest?.proof || null,
      reasons,
      missingClaimIds,
      unknownClaimIds,
      staleClaimIds,
      untraceableClaimIds,
      unresolvedArtifactClaimIds,
      artifactMismatchClaimIds
    })
  };
}

function normalizePersistedClaimEvidenceManifest(link) {
  const manifest = link?.claimEvidenceManifest && typeof link.claimEvidenceManifest === "object"
    ? link.claimEvidenceManifest
    : null;
  if (!manifest) return null;
  const claims = Array.isArray(manifest.claims)
    ? manifest.claims.map((claim) => ({
      claimId: normalizeOptionalText(claim.claimId),
      artifactId: normalizeOptionalText(claim.artifactId || link?.artifactId),
      requiredProofArtifactIds: normalizeIdList(claim.requiredProofArtifactIds),
      proofArtifacts: normalizeProofArtifactRefs(claim.proofArtifacts || claim.requiredProofArtifacts),
      proofArtifactCount: normalizeNonNegativeInteger(claim.proofArtifactCount, 0),
      evidenceTraceProof: normalizeOptionalText(claim.evidenceTraceProof || manifest.evidenceTraceProof),
      status: normalizeOptionalText(claim.status) || "unknown"
    })).filter((claim) => claim.claimId)
    : [];
  const normalized = {
    contractVersion: normalizeOptionalText(manifest.contractVersion) || "aios.claim-evidence-link.claim-evidence-manifest.v1",
    status: normalizeOptionalText(manifest.status) || "unknown",
    claimCount: normalizeNonNegativeInteger(manifest.claimCount, claims.length),
    proofArtifactCount: normalizeNonNegativeInteger(manifest.proofArtifactCount, 0),
    completeClaimCount: normalizeNonNegativeInteger(manifest.completeClaimCount, claims.filter((claim) => claim.status === "traceable").length),
    missingClaimIds: normalizeIdList(manifest.missingClaimIds),
    unassignedProofArtifactIds: normalizeIdList(manifest.unassignedProofArtifactIds),
    evidenceTraceProof: normalizeOptionalText(manifest.evidenceTraceProof),
    proofArtifacts: normalizeProofArtifactRefs(manifest.proofArtifacts || manifest.requiredProofArtifacts),
    claims,
    proof: normalizeOptionalText(manifest.proof)
  };
  const validation = validateClaimEvidenceManifest(link, normalized, normalizePersistedEvidenceTrace(link));
  const coverage = buildClaimProofArtifactCoverage(link, normalized, normalizePersistedEvidenceTrace(link));
  return {
    ...normalized,
    status: validation.complete && normalized.status === "complete" ? "complete" : "incomplete",
    missingClaimIds: [...new Set([...normalized.missingClaimIds, ...validation.missingClaimIds])].sort(),
    completeClaimCount: validation.complete ? normalized.completeClaimCount : claims.filter((claim) => claim.status === "traceable").length,
    coverage,
    validation
  };
}

function buildEvidenceTrace({ claimIds, artifactId, evidence, scope, linkId, errors = [] }) {
  const scopedClaims = [...new Set((claimIds || []).filter((claimId) => typeof claimId === "string" && claimId.trim()).map((claimId) => claimId.trim()))].sort();
  const claimSet = new Set(scopedClaims);
  const unknownClaimRefs = [];
  const claimEvidence = new Map(scopedClaims.map((claimId) => [claimId, []]));
  const unassignedProofArtifactIds = [];
  const proofArtifactIndex = buildProofArtifactReferenceIndex(evidence);
  for (const item of evidence || []) {
    const itemClaims = Array.isArray(item.claimIds) && item.claimIds.length > 0 ? item.claimIds : scopedClaims;
    if (!Array.isArray(item.claimIds) || item.claimIds.length === 0) unassignedProofArtifactIds.push(item.evidenceId);
    for (const claimId of itemClaims) {
      if (!claimSet.has(claimId)) {
        unknownClaimRefs.push({ claimId, evidenceId: item.evidenceId });
        continue;
      }
      claimEvidence.get(claimId).push(item);
    }
  }
  for (const ref of unknownClaimRefs) {
    errors.push(`evidence ${ref.evidenceId} references unknown claim ${ref.claimId}`);
  }
  const claims = scopedClaims.map((claimId) => {
    const items = claimEvidence.get(claimId) || [];
    const requiredProofArtifactIds = [...new Set(items.map((item) => item.evidenceId))].sort();
    const proofArtifacts = proofArtifactRefsForIds(requiredProofArtifactIds, proofArtifactIndex)
      .map((ref) => ({ ...ref, claimIds: [claimId] }));
    return {
      claimId,
      artifactId,
      requiredProofArtifactIds,
      proofArtifacts,
      proofArtifactCount: requiredProofArtifactIds.length,
      digestCoverage: items.length === 0 ? 0 : Number((items.filter((item) => item.digest).length / items.length).toFixed(4)),
      uriCoverage: items.length === 0 ? 0 : Number((items.filter((item) => item.uri).length / items.length).toFixed(4)),
      status: requiredProofArtifactIds.length > 0 ? "traceable" : "missing-proof-artifact"
    };
  });
  const missingClaimIds = claims.filter((claim) => claim.proofArtifactCount === 0).map((claim) => claim.claimId);
  for (const claimId of missingClaimIds) errors.push(`claim ${claimId} has no linked proof artifact`);
  const payload = {
    surfaceId,
    linkId,
    scopeKey: scope?.scopeKey || null,
    artifactId,
    claims,
    proofArtifacts: [...proofArtifactIndex.values()],
    unassignedProofArtifactIds: [...new Set(unassignedProofArtifactIds)].sort(),
    unknownClaimRefs
  };
  return {
    contractVersion: "aios.claim-evidence-link.evidence-trace.v1",
    status: missingClaimIds.length > 0 || unknownClaimRefs.length > 0 ? "incomplete" : "complete",
    claimCount: claims.length,
    proofArtifactCount: evidence.length,
    proofArtifacts: [...proofArtifactIndex.values()],
    unassignedProofArtifactIds: [...new Set(unassignedProofArtifactIds)].sort(),
    missingClaimIds,
    claims,
    proof: proofHash(payload)
  };
}

function buildClaimEvidenceManifest(link, evidenceTrace = link?.evidenceTrace || null) {
  const trace = evidenceTrace && typeof evidenceTrace === "object" ? evidenceTrace : null;
  const fallbackProofArtifactIndex = buildProofArtifactReferenceIndex(link?.evidence || []);
  const claims = Array.isArray(trace?.claims)
    ? trace.claims.map((claim) => {
      const requiredProofArtifactIds = Array.isArray(claim.requiredProofArtifactIds)
        ? [...new Set(claim.requiredProofArtifactIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))].sort()
        : [];
      const traceProofArtifacts = normalizeProofArtifactRefs(claim.proofArtifacts || claim.requiredProofArtifacts);
      const proofArtifacts = traceProofArtifacts.length > 0
        ? traceProofArtifacts
        : proofArtifactRefsForIds(requiredProofArtifactIds, fallbackProofArtifactIndex);
      return {
        claimId: normalizeOptionalText(claim.claimId),
        artifactId: normalizeOptionalText(claim.artifactId || link?.artifactId),
        requiredProofArtifactIds,
        proofArtifacts,
        proofArtifactCount: requiredProofArtifactIds.length,
        evidenceTraceProof: trace?.proof || null,
        status: requiredProofArtifactIds.length > 0 ? "traceable" : "missing-proof-artifact"
      };
    }).filter((claim) => claim.claimId)
    : [];
  const proofArtifacts = normalizeProofArtifactRefs(trace?.proofArtifacts || trace?.requiredProofArtifacts);
  const manifestProofArtifacts = proofArtifacts.length > 0
    ? proofArtifacts
    : [...fallbackProofArtifactIndex.values()].filter((ref) => claims.some((claim) => claim.requiredProofArtifactIds.includes(ref.proofArtifactId)));
  const missingClaimIds = [...new Set([
    ...(Array.isArray(trace?.missingClaimIds) ? trace.missingClaimIds : []),
    ...claims.filter((claim) => claim.proofArtifactCount === 0).map((claim) => claim.claimId)
  ].filter((claimId) => typeof claimId === "string" && claimId.trim()).map((claimId) => claimId.trim()))].sort();
  const unassignedProofArtifactIds = Array.isArray(trace?.unassignedProofArtifactIds)
    ? [...new Set(trace.unassignedProofArtifactIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))].sort()
    : [];
  const baseStatus = trace?.status === "complete" && claims.length > 0 && missingClaimIds.length === 0
    ? "complete"
    : "incomplete";
  const payload = {
    surfaceId,
    linkId: link?.linkId || null,
    scopeKey: link?.scope?.scopeKey || null,
    artifactId: link?.artifactId || null,
    traceProof: trace?.proof || null,
    claims,
    proofArtifacts: manifestProofArtifacts,
    missingClaimIds,
    unassignedProofArtifactIds
  };
  const manifest = {
    contractVersion: "aios.claim-evidence-link.claim-evidence-manifest.v1",
    status: baseStatus,
    claimCount: claims.length,
    proofArtifactCount: claims.reduce((total, claim) => total + claim.proofArtifactCount, 0),
    completeClaimCount: claims.filter((claim) => claim.status === "traceable").length,
    missingClaimIds,
    unassignedProofArtifactIds,
    evidenceTraceProof: trace?.proof || null,
    proofArtifacts: manifestProofArtifacts,
    claims,
    proof: proofHash(payload)
  };
  const coverage = buildClaimProofArtifactCoverage(link, manifest, trace);
  const validation = validateClaimEvidenceManifest(link, manifest, trace);
  return {
    ...manifest,
    status: validation.complete ? "complete" : "incomplete",
    missingClaimIds: [...new Set([...manifest.missingClaimIds, ...validation.missingClaimIds])].sort(),
    completeClaimCount: coverage.traceableClaimCount,
    coverage,
    validation
  };
}

function evidenceManifestForLink(link) {
  const normalized = normalizePersistedClaimEvidenceManifest(link);
  if (normalized?.proof && normalized.validation?.complete === true) return normalized;
  return buildClaimEvidenceManifest(link, link?.evidenceTrace || null);
}

function evidenceReferencePolicyForState(state = {}) {
  return normalizeEvidenceReferencePolicy({
    requireDigest: state.lifecycle?.settings?.requireEvidenceDigest === true,
    requireLocator: true
  });
}

function artifactClaimEvidenceLinksForState(state, link, manifest = evidenceManifestForLink(link)) {
  return buildArtifactClaimEvidenceLinks(link, manifest, link?.evidenceTrace || null, evidenceReferencePolicyForState(state));
}

function linkReadyForHandoff(state, link) {
  if (link?.status !== "linked" || !link.proof) return false;
  if (link.scopeIntegrity?.status === "quarantined") return false;
  const manifest = evidenceManifestForLink(link);
  if (manifest.status !== "complete") return false;
  const artifactClaimEvidenceLinks = artifactClaimEvidenceLinksForState(state, link, manifest);
  if (artifactClaimEvidenceLinks.status !== "complete") return false;
  return buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks).status === "complete";
}

function buildLinkAcceptancePreview({ state, link, now, manifest = null, artifactClaimEvidenceLinks = null, claimEvidenceTraceMatrix = null, claimProofIndex = null }) {
  const claimEvidenceManifest = manifest || evidenceManifestForLink(link);
  const claimProof = claimProofIndex || link?.claimProofIndex || buildClaimProofIndex(link, claimEvidenceManifest, link?.evidenceTrace || null);
  const artifactLinks = artifactClaimEvidenceLinks || artifactClaimEvidenceLinksForState(state, link, claimEvidenceManifest);
  const traceMatrix = claimEvidenceTraceMatrix || buildClaimEvidenceTraceMatrix(link, artifactLinks);
  const exported = Boolean(link?.auditHandoff?.exportedAt);
  const localBlockers = [
    link?.status !== "linked" ? "link-not-accepted" : null,
    !link?.proof ? "link-proof-missing" : null,
    link?.scopeIntegrity?.status === "quarantined" ? "scope-integrity-quarantined" : null,
    claimEvidenceManifest.status !== "complete" ? "claim-evidence-manifest-incomplete" : null,
    claimProof.readiness?.ready === false ? "claim-proof-index-not-ready" : null,
    artifactLinks.status !== "complete" ? "artifact-claim-evidence-links-incomplete" : null,
    traceMatrix.status !== "complete" ? "claim-evidence-trace-matrix-incomplete" : null
  ].filter(Boolean);
  const providerBlockers = [
    state.lifecycle?.enabled === false ? "lifecycle-disabled" : null,
    state.integration?.providerContract?.ready !== true ? "provider-contract-not-ready" : null,
    state.integration?.providerRuntime?.readyForHandoff === false ? "provider-runtime-not-ready" : null
  ].filter(Boolean);
  const claimRows = (Array.isArray(traceMatrix.rows) ? traceMatrix.rows : [])
    .map((row) => ({
      claimId: row.claimId,
      artifactId: row.artifactId || link?.artifactId || null,
      status: row.status === "linked" ? "accepted" : "needs-evidence",
      requiredEvidenceIds: normalizeIdList(row.requiredEvidenceIds),
      linkedEvidenceIds: normalizeIdList(row.linkedEvidenceIds),
      unresolvedEvidenceIds: normalizeIdList(row.unresolvedEvidenceIds),
      nonCompliantEvidenceIds: normalizeIdList(row.nonCompliantEvidenceIds),
      missingDigestEvidenceIds: normalizeIdList(row.missingDigestEvidenceIds),
      missingLocatorEvidenceIds: normalizeIdList(row.missingLocatorEvidenceIds),
      reasons: row.reasons || [],
      proof: row.proof || null
    }));
  const missingClaimRows = normalizeIdList([
    ...(claimEvidenceManifest.missingClaimIds || []),
    ...(claimProof.unresolvedClaimIds || []),
    ...(traceMatrix.missingClaimIds || [])
  ])
    .filter((claimId) => !claimRows.some((row) => row.claimId === claimId))
    .map((claimId) => ({
      claimId,
      artifactId: link?.artifactId || null,
      status: "missing-proof",
      requiredEvidenceIds: claimProof.byClaimId?.[claimId]?.requiredProofArtifactIds || [],
      linkedEvidenceIds: claimProof.byClaimId?.[claimId]?.resolvedProofArtifactIds || [],
      unresolvedEvidenceIds: claimProof.byClaimId?.[claimId]?.unresolvedProofArtifactIds || [],
      nonCompliantEvidenceIds: [],
      missingDigestEvidenceIds: [],
      missingLocatorEvidenceIds: [],
      reasons: ["claim-missing-from-acceptance-preview"],
      proof: claimProof.byClaimId?.[claimId]?.proof || claimProof.proof || null
    }));
  const previewRows = [...claimRows, ...missingClaimRows]
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  const accepted = localBlockers.length === 0;
  const readyForHandoff = accepted && providerBlockers.length === 0 && !exported;
  const firstBlocker = localBlockers[0] || providerBlockers[0] || null;
  const routeBase = link?.linkId
    ? `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(link.linkId)}`
    : "/artifact-filesystem/claim-evidence-link/commands";
  const nextStepByBlocker = {
    "link-not-accepted": {
      type: "submit-link-command",
      command: "link-claim-evidence",
      route: "/artifact-filesystem/claim-evidence-link/commands"
    },
    "link-proof-missing": {
      type: "verify-link-proof",
      command: "claim-evidence-link.proofs.verify",
      route: `${routeBase}/proofs/verify`
    },
    "scope-integrity-quarantined": {
      type: "repair-scope-integrity",
      command: "claim-evidence-link.scope-integrity.repair",
      route: `${routeBase}/scope-integrity/repair`
    },
    "claim-evidence-manifest-incomplete": {
      type: "repair-claim-evidence-manifest",
      command: "claim-evidence-link.claim-evidence-manifest.reconcile",
      route: `${routeBase}/claim-evidence-manifest/repair`
    },
    "claim-proof-index-not-ready": {
      type: "repair-claim-proof-index",
      command: "claim-evidence-link.claim-proof-index.repair",
      route: `${routeBase}/claim-proof-index/repair`
    },
    "artifact-claim-evidence-links-incomplete": {
      type: "repair-artifact-claim-evidence-links",
      command: "claim-evidence-link.artifact-claim-evidence-links.repair",
      route: `${routeBase}/artifact-claim-evidence-links/repair`
    },
    "claim-evidence-trace-matrix-incomplete": {
      type: "repair-claim-evidence-trace-matrix",
      command: "claim-evidence-link.claim-evidence-trace-matrix.repair",
      route: `${routeBase}/claim-evidence-trace-matrix/repair`
    },
    "lifecycle-disabled": {
      type: "enable-lifecycle",
      command: "claim-evidence-link.lifecycle.enable",
      route: "/artifact-filesystem/claim-evidence-link/lifecycle"
    },
    "provider-contract-not-ready": {
      type: "negotiate-provider-contract",
      command: "claim-evidence-link.provider.negotiate",
      route: "/artifact-filesystem/claim-evidence-link/integration"
    },
    "provider-runtime-not-ready": {
      type: "retry-provider-health-check",
      command: "claim-evidence-link.provider.health-check",
      route: "/artifact-filesystem/claim-evidence-link/integration"
    }
  };
  const nextStep = firstBlocker
    ? {
      ...nextStepByBlocker[firstBlocker],
      status: providerBlockers.includes(firstBlocker) ? "waiting-provider" : "repair-required",
      reason: firstBlocker,
      method: "POST",
      linkId: link?.linkId || null,
      claimIds: previewRows.filter((row) => row.status !== "accepted").map((row) => row.claimId).sort()
    }
    : exported
      ? {
        type: "review-exported-handoff",
        status: "complete",
        command: "claim-evidence-link.handoff.review",
        method: "GET",
        route: `${routeBase}/handoff`,
        reason: "handoff already exported",
        linkId: link?.linkId || null,
        claimIds: []
      }
      : {
        type: "export-handoff",
        status: "ready",
        command: "claim-evidence-link.handoff.export",
        method: "POST",
        route: "/artifact-filesystem/claim-evidence-link/handoff",
        reason: "claim evidence accepted and provider handoff is ready",
        linkId: link?.linkId || null,
        claimIds: previewRows.map((row) => row.claimId).sort()
      };
  const payload = {
    surfaceId,
    generatedAt: now,
    linkId: link?.linkId || null,
    accepted,
    readyForHandoff,
    exported,
    localBlockers,
    providerBlockers,
    claimRowProofs: previewRows.map((row) => row.proof),
    manifestProof: claimEvidenceManifest.proof || null,
    claimProofIndexProof: claimProof.proof || null,
    artifactClaimEvidenceLinksProof: artifactLinks.proof || null,
    claimEvidenceTraceMatrixProof: traceMatrix.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.link-acceptance-preview.v1",
    generatedAt: now,
    linkId: link?.linkId || null,
    rawLinkId: link?.rawLinkId || null,
    claimId: link?.claimId || null,
    artifactId: link?.artifactId || null,
    scopeKey: link?.scope?.scopeKey || null,
    status: exported
      ? "exported"
      : readyForHandoff
        ? "handoff-ready"
        : accepted
          ? "accepted-provider-pending"
          : "needs-repair",
    accepted,
    readyForHandoff,
    exported,
    validationSummary: {
      valid: accepted,
      severity: localBlockers.length > 0 ? "blocker" : providerBlockers.length > 0 ? "warning" : "clear",
      localBlockers,
      providerBlockers,
      incompleteClaimIds: previewRows.filter((row) => row.status !== "accepted").map((row) => row.claimId).sort(),
      unresolvedEvidenceIds: normalizeIdList(previewRows.flatMap((row) => row.unresolvedEvidenceIds)),
      nonCompliantEvidenceIds: normalizeIdList(previewRows.flatMap((row) => row.nonCompliantEvidenceIds)),
      missingDigestEvidenceIds: normalizeIdList(previewRows.flatMap((row) => row.missingDigestEvidenceIds)),
      missingLocatorEvidenceIds: normalizeIdList(previewRows.flatMap((row) => row.missingLocatorEvidenceIds))
    },
    readiness: {
      claimEvidenceManifest: claimEvidenceManifest.status,
      claimProofIndex: claimProof.readiness?.status || claimProof.status,
      artifactClaimEvidenceLinks: artifactLinks.status,
      claimEvidenceTraceMatrix: traceMatrix.status,
      providerHandoff: providerBlockers.length === 0 ? "ready" : "blocked",
      proofStatus: link?.proof ? "verified" : "missing"
    },
    claims: previewRows,
    nextStep,
    proofs: {
      link: link?.proof || null,
      evidenceTrace: link?.evidenceTrace?.proof || null,
      claimEvidenceManifest: claimEvidenceManifest.proof || null,
      claimProofIndex: claimProof.proof || null,
      artifactClaimEvidenceLinks: artifactLinks.proof || null,
      claimEvidenceTraceMatrix: traceMatrix.proof || null
    },
    proof: proofHash(payload)
  };
}

function actionableError(message, boundaryConflict = null) {
  if (message === "surface is disabled by lifecycle controls") {
    return {
      code: "AFS_CEL_LIFECYCLE_DISABLED",
      path: "lifecycle.enabled",
      message,
      retryable: false,
      remediation: "Enable claim-evidence linking through a lifecycle command before submitting link commands."
    };
  }
  if (message.includes("not permitted to manage claim evidence lifecycle")) {
    return {
      code: "AFS_CEL_LIFECYCLE_PERMISSION_DENIED",
      path: "actor.roles",
      message,
      retryable: false,
      remediation: "Retry with a maintainer, artifact-curator, or kernel-admin role for lifecycle changes."
    };
  }
  if (message === "reason must be provided when disabling lifecycle controls") {
    return {
      code: "AFS_CEL_LIFECYCLE_DISABLE_REASON_REQUIRED",
      path: "reason",
      message,
      retryable: false,
      remediation: "Provide an operator reason so the lifecycle pause is auditable."
    };
  }
  if (message === "action must be enable, disable, schedule, configure, pause-schedule, resume-schedule, or refresh-proofs") {
    return {
      code: "AFS_CEL_LIFECYCLE_ACTION_INVALID",
      path: "action",
      message,
      retryable: false,
      remediation: "Use one supported lifecycle action and resubmit with a stable commandId."
    };
  }
  if (message.includes("below current linked evidence batch size")) {
    return {
      code: "AFS_CEL_LIFECYCLE_EVIDENCE_LIMIT_UNSAFE",
      path: "settings.maxEvidenceItems",
      message,
      retryable: false,
      remediation: "Choose a maxEvidenceItems value that can still represent every current linked evidence batch."
    };
  }
  if (message.startsWith("settings.")) {
    return {
      code: "AFS_CEL_LIFECYCLE_SETTINGS_INVALID",
      path: message.split(" ")[0],
      message,
      retryable: false,
      remediation: "Correct the lifecycle settings payload before applying the hosted-kernel control change."
    };
  }
  if (message.includes("exceeds lifecycle maxEvidenceItems")) {
    return {
      code: "AFS_CEL_EVIDENCE_LIMIT_EXCEEDED",
      path: "evidence",
      message,
      retryable: false,
      remediation: "Reduce the evidence batch size or update lifecycle.settings.maxEvidenceItems with an authorized lifecycle command."
    };
  }
  if (message === "evidence digest is required by lifecycle settings") {
    return {
      code: "AFS_CEL_EVIDENCE_DIGEST_REQUIRED",
      path: "evidence.digest",
      message,
      retryable: false,
      remediation: "Attach a digest to every evidence item or relax lifecycle.settings.requireEvidenceDigest with an authorized lifecycle command."
    };
  }
  if (message === "linkId could not be derived") {
    return {
      code: "AFS_CEL_LINK_ID_UNDERIVED",
      path: "linkId",
      message,
      retryable: false,
      remediation: "Provide linkId or both claimId and artifactId so the hosted kernel can derive a stable scoped link id."
    };
  }
  if (message.includes("not permitted to link claim evidence")) {
    return {
      code: "AFS_CEL_PERMISSION_DENIED",
      path: "actor.roles",
      message,
      retryable: false,
      remediation: "Retry with an actor role permitted for claim-evidence linking or route the command through an authorized maintainer."
    };
  }
  if (message === "linkId is already owned by another tenant/workspace scope") {
    return {
      code: "AFS_CEL_SCOPE_BOUNDARY_CONFLICT",
      path: "linkId",
      message,
      retryable: false,
      remediation: "Use a tenant/workspace scoped link id for this command; do not reuse a raw link id already owned by another scope.",
      boundaryConflict
    };
  }
  if (message.startsWith("scope.")) {
    return {
      code: "AFS_CEL_SCOPE_REQUIRED",
      path: message.split(" ")[0],
      message,
      retryable: false,
      remediation: "Attach both scope.tenantId and scope.workspaceId before submitting the command."
    };
  }
  if (message.startsWith("actor.")) {
    return {
      code: "AFS_CEL_ACTOR_REQUIRED",
      path: message.split(" ")[0],
      message,
      retryable: false,
      remediation: "Attach actor.actorId and at least one actor role before submitting the command."
    };
  }
  if (message.includes("not permitted to export claim evidence handoff")) {
    return {
      code: "AFS_CEL_HANDOFF_PERMISSION_DENIED",
      path: "actor.roles",
      message,
      retryable: false,
      remediation: "Retry with a maintainer, artifact-curator, claim-reviewer, or kernel-admin role for audit handoff export."
    };
  }
  if (message === "provider contract is not ready for audit handoff export") {
    return {
      code: "AFS_CEL_HANDOFF_PROVIDER_NOT_READY",
      path: "integration.providerContract",
      message,
      retryable: true,
      remediation: "Negotiate a provider contract with claim-link.write, audit-handoff.export, and proof.verify before exporting handoff data."
    };
  }
  if (message === "provider runtime is not ready for claim evidence writes") {
    return {
      code: "AFS_CEL_PROVIDER_WRITE_UNAVAILABLE",
      path: "integration.providerRuntime",
      message,
      retryable: true,
      remediation: "Retry provider health-check or capability negotiation before accepting hosted-kernel claim-evidence writes."
    };
  }
  if (message === "provider runtime is not ready for audit handoff export") {
    return {
      code: "AFS_CEL_HANDOFF_PROVIDER_DEGRADED",
      path: "integration.providerRuntime",
      message,
      retryable: true,
      remediation: "Retry provider health-check before exporting claim-evidence handoff envelopes."
    };
  }
  if (message === "no pending linked proof is available for audit handoff export") {
    return {
      code: "AFS_CEL_HANDOFF_QUEUE_EMPTY",
      path: "integration.externalHandoff.queueDepth",
      message,
      retryable: false,
      remediation: "Create or repair a linked claim-evidence record with a verified proof before requesting an audit handoff export."
    };
  }
  if (message === "requested handoff link is not pending or visible in the current scope") {
    return {
      code: "AFS_CEL_HANDOFF_LINK_UNAVAILABLE",
      path: "linkId",
      message,
      retryable: false,
      remediation: "Select a visible linked record that has proof and has not already been exported."
    };
  }
  if (message === "handoff export would cross tenant/workspace boundary") {
    return {
      code: "AFS_CEL_HANDOFF_SCOPE_BOUNDARY",
      path: "scope",
      message,
      retryable: false,
      remediation: "Submit the handoff command with the link's tenant/workspace scope or use a kernel-admin actor for explicit cross-scope export."
    };
  }
  if (message === "surface lifecycle blocks audit handoff export") {
    return {
      code: "AFS_CEL_HANDOFF_LIFECYCLE_DISABLED",
      path: "lifecycle.enabled",
      message,
      retryable: false,
      remediation: "Enable lifecycle controls before exporting claim-evidence handoff data."
    };
  }
  if (message.startsWith("evidence ") && message.includes("references unknown claim")) {
    return {
      code: "AFS_CEL_EVIDENCE_UNKNOWN_CLAIM_REF",
      path: "evidence.claimIds",
      message,
      retryable: false,
      remediation: "Remove the unknown claim reference or include that claim in command.claimIds before submitting the link command."
    };
  }
  if (message.startsWith("evidence")) {
    return {
      code: "AFS_CEL_EVIDENCE_REQUIRED",
      path: message.split(" ")[0],
      message,
      retryable: false,
      remediation: "Attach at least one evidence item with a stable evidenceId; include uri or digest when available."
    };
  }
  if (message.startsWith("claim ") && message.includes("has no linked proof artifact")) {
    return {
      code: "AFS_CEL_CLAIM_PROOF_ARTIFACT_MISSING",
      path: "evidenceTrace.claims",
      message,
      retryable: false,
      remediation: "Attach at least one evidence item to every claim, or omit claim-specific evidence refs so the proof artifact applies to all claims."
    };
  }
  return {
    code: "AFS_CEL_INVALID_COMMAND",
    path: message.split(" ")[0],
    message,
    retryable: false,
    remediation: "Correct the command payload and resubmit with a new commandId unless this was an idempotent replay."
  };
}

function buildFailureEnvelope({ now, commandId, scopedCommandId, scope, actor, errors, boundaryConflict, retryAttempt }) {
  const actionableErrors = errors.map((message) => actionableError(message, boundaryConflict));
  const retryable = actionableErrors.some((error) => error.retryable);
  const retryAfterMs = retryable ? retryDelayMs(retryAttempt) : null;
  const failure = {
    failureId: proofHash({
      surfaceId,
      commandId,
      scopedCommandId,
      scope,
      actorId: actor?.actorId || null,
      errors,
      boundaryConflict
    }),
    failedAt: now,
    retryable,
    retryAttempt,
    retryAfterMs,
    actionableErrors
  };
  return retryAfterMs
    ? { ...failure, nextRetryAt: asIso(new Date(Date.parse(now) + retryAfterMs).toISOString(), now) }
    : failure;
}

function buildRetryAction({ now, type, command, route, reason, retryAttempt = 0, blocked = false, metadata = {} }) {
  const delayMs = retryDelayMs(retryAttempt);
  return {
    type,
    command,
    route,
    reason,
    priority: blocked ? "blocked" : retryAttempt > 1 ? "high" : "normal",
    retryAttempt,
    retryAfterMs: delayMs,
    nextRetryAt: asIso(new Date(Date.parse(now) + delayMs).toISOString(), now),
    metadata
  };
}

function normalizeProviderRuntimeHealth(input = {}, persistedIntegration = {}, contract, now) {
  const integrationInput = input.integration && typeof input.integration === "object" ? input.integration : {};
  const source = integrationInput.providerHealth
    || input.providerHealth
    || input.providerRuntime
    || persistedIntegration.providerRuntime
    || persistedIntegration.providerHealth
    || {};
  const candidateStatus = normalizeOptionalText(source.status || source.mode) || "ok";
  const status = providerRuntimeStatuses.has(candidateStatus) ? candidateStatus : "unknown";
  const failureCount = normalizeNonNegativeInteger(source.failureCount || source.failures, 0);
  const retryAttempt = normalizeAttempt(source.retryAttempt ?? source.attempt ?? failureCount);
  const observedAt = asIso(source.observedAt || source.checkedAt || source.updatedAt, now);
  const missingCapabilities = Array.isArray(contract?.missingRequiredCapabilities)
    ? contract.missingRequiredCapabilities
    : [];
  const missingServiceRequirements = Array.isArray(contract?.serviceContract?.missingServiceRequirements)
    ? contract.serviceContract.missingServiceRequirements
    : [];
  const providerUnavailable = status === "outage" || status === "unknown";
  const providerDegraded = providerUnavailable || status === "degraded" || contract?.ready !== true;
  const degradedReason = contract?.ready !== true
    ? missingCapabilities.length > 0
      ? "provider contract is missing required hosted-kernel capabilities"
      : "provider service contract is missing required hosted-kernel endpoints"
    : providerUnavailable
      ? "provider runtime is unavailable for proof verification or audit handoff"
      : status === "degraded"
        ? "provider runtime reported degraded hosted-kernel service"
        : null;
  const nextRetry = providerDegraded
    ? buildRetryAction({
      now,
      type: contract?.ready === true ? "retry-provider-health-check" : "renegotiate-provider-contract",
      command: contract?.ready === true ? "claim-evidence-link.provider.health-check" : "claim-evidence-link.provider.negotiate",
      route: "/artifact-filesystem/claim-evidence-link/integration",
      reason: degradedReason,
      retryAttempt,
      blocked: providerUnavailable || contract?.ready !== true,
      metadata: {
        providerInstanceId: contract?.provider?.providerInstanceId || null,
        missingRequiredCapabilities: missingCapabilities,
        missingServiceRequirements
      }
    })
    : null;
  const payload = {
    surfaceId,
    providerInstanceId: contract?.provider?.providerInstanceId || null,
    status,
    failureCount,
    retryAttempt,
    observedAt,
    missingCapabilities,
    missingServiceRequirements,
    degradedReason
  };
  return {
    contractVersion: "aios.claim-evidence-link.provider-runtime-health.v1",
    status,
    observedAt,
    code: normalizeOptionalText(source.code) || (providerDegraded ? "AFS_CEL_PROVIDER_DEGRADED" : null),
    message: normalizeOptionalText(source.message) || degradedReason,
    failureCount,
    retryAttempt,
    missingServiceRequirements,
    degraded: providerDegraded,
    readyForWrites: contract?.ready === true && !providerUnavailable,
    readyForHandoff: contract?.ready === true && status === "ok",
    degradedReason,
    lastFailureAt: source.lastFailureAt ? asIso(source.lastFailureAt, observedAt) : providerDegraded ? observedAt : null,
    nextRetry,
    proof: proofHash(payload)
  };
}

function buildOperationalHealth(state, now) {
  const links = linksForAccess(state, state.accessBoundary);
  const commandLedger = commandLedgerForAccess(state, state.accessBoundary);
  const recoveryPlan = state.recoveryPlan || buildRecoveryPlan(state, now);
  const quarantinedScopeLinks = links.filter((link) => link.scopeIntegrity?.status === "quarantined");
  const recoveringLinks = links.filter((link) => link.status === "recovering");
  const missingProofLinks = links.filter((link) => link.status === "linked" && !link.proof);
  const incompleteManifestLinks = links.filter((link) => (
    link.status === "linked"
    && evidenceManifestForLink(link).status !== "complete"
  ));
  const incompleteClaimProofIndexLinks = links.filter((link) => (
    link.status === "linked"
    && (link.claimProofIndex || buildClaimProofIndex(link, evidenceManifestForLink(link), link.evidenceTrace || null)).readiness?.ready === false
  ));
  const incompleteArtifactClaimEvidenceLinks = links.filter((link) => (
    link.status === "linked"
    && artifactClaimEvidenceLinksForState(state, link).status !== "complete"
  ));
  const incompleteClaimEvidenceTraceMatrices = links.filter((link) => (
    link.status === "linked"
    && buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinksForState(state, link)).status !== "complete"
  ));
  const recoveringCommands = commandLedger.filter((entry) => entry.recovery?.required === true);
  const providerRuntime = state.integration?.providerRuntime || null;
  const handoffState = state.integration?.externalHandoff || null;
  const syncState = state.integration?.sync || null;
  const pendingHandoffBlocked = handoffState?.status === "blocked" && (handoffState?.queueDepth || 0) > 0;
  const errors = [
    ...quarantinedScopeLinks.map((link) => ({
      code: "AFS_CEL_SCOPE_INTEGRITY_QUARANTINED",
      linkId: link.linkId,
      retryable: true,
      retryAfterMs: retryDelayMs(0),
      remediation: link.scopeIntegrity?.remediation || "Repair persisted tenant/workspace scope metadata before exposing this link to scoped callers or audit handoff.",
      scopeIntegrity: link.scopeIntegrity
    })),
    ...recoveringLinks.map((link) => ({
      code: "AFS_CEL_LINK_RECOVERY_REQUIRED",
      linkId: link.linkId,
      retryable: true,
      retryAfterMs: retryDelayMs(0),
      remediation: "Replay the original link command or rebuild this link from claim, artifact, evidence, scope, and actor data."
    })),
    ...missingProofLinks.map((link) => ({
      code: "AFS_CEL_PROOF_MISSING",
      linkId: link.linkId,
      retryable: true,
      retryAfterMs: retryDelayMs(1),
      remediation: "Regenerate the claim-evidence link proof before exporting audit handoff data."
    })),
    ...incompleteManifestLinks.map((link) => {
      const manifest = evidenceManifestForLink(link);
      return {
        code: "AFS_CEL_CLAIM_EVIDENCE_MANIFEST_INCOMPLETE",
        linkId: link.linkId,
        retryable: true,
        retryAfterMs: retryDelayMs(1),
        remediation: "Replay or repair the link with a claimEvidenceManifest that maps every claim to at least one required proof artifact.",
        missingClaimIds: manifest.missingClaimIds || [],
        evidenceTraceProof: manifest.evidenceTraceProof || null,
        manifestValidation: manifest.validation || null,
        manifestValidationReasons: manifest.validation?.reasons || [],
        manifestProof: manifest.proof
      };
    }),
    ...incompleteClaimProofIndexLinks.map((link) => {
      const claimProofIndex = link.claimProofIndex || buildClaimProofIndex(link, evidenceManifestForLink(link), link.evidenceTrace || null);
      const readiness = claimProofIndex.readiness || {};
      const retryAfterMs = readiness.nextRetryAfterMs || retryDelayMs(1);
      return {
        code: readiness.status === "blocked" ? "AFS_CEL_CLAIM_PROOF_INDEX_BLOCKED" : "AFS_CEL_CLAIM_PROOF_INDEX_DEGRADED",
        linkId: link.linkId,
        retryable: true,
        retryAfterMs,
        nextRetryAt: asIso(new Date(Date.parse(now) + retryAfterMs).toISOString(), now),
        remediation: readiness.status === "blocked"
          ? "Attach or rebuild required proof artifacts for every blocked claim before audit handoff export."
          : "Resolve degraded claim proof artifacts before promoting this link to handoff-ready.",
        degradedMode: readiness.degradedMode || "local-review-only",
        blockedClaimIds: readiness.blockedClaimIds || [],
        retryableClaimIds: readiness.retryableClaimIds || [],
        actionableErrors: readiness.actionableErrors || [],
        repairActions: readiness.repairActions || [],
        claimProofIndexProof: claimProofIndex.proof,
        claimProofReadinessProof: readiness.proof || null
      };
    }),
    ...incompleteArtifactClaimEvidenceLinks.map((link) => {
      const artifactClaimEvidenceLinks = artifactClaimEvidenceLinksForState(state, link);
      return {
        code: "AFS_CEL_ARTIFACT_CLAIM_EVIDENCE_LINK_INCOMPLETE",
        linkId: link.linkId,
        retryable: true,
        retryAfterMs: retryDelayMs(1),
        remediation: "Repair artifactClaimEvidenceLinks so every claim points to resolved evidence with required locator metadata before audit handoff.",
        unresolvedClaimIds: artifactClaimEvidenceLinks.unresolvedClaimIds || [],
        unresolvedEvidenceIds: artifactClaimEvidenceLinks.unresolvedEvidenceIds || [],
        nonCompliantEvidenceIds: artifactClaimEvidenceLinks.nonCompliantEvidenceIds || [],
        missingDigestEvidenceIds: artifactClaimEvidenceLinks.missingDigestEvidenceIds || [],
        missingLocatorEvidenceIds: artifactClaimEvidenceLinks.missingLocatorEvidenceIds || [],
        evidenceReferencePolicyReasons: artifactClaimEvidenceLinks.evidenceReferencePolicyReasons || [],
        artifactClaimEvidenceLinksProof: artifactClaimEvidenceLinks.proof
      };
    }),
    ...incompleteClaimEvidenceTraceMatrices.map((link) => {
      const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinksForState(state, link));
      return {
        code: "AFS_CEL_CLAIM_EVIDENCE_TRACE_MATRIX_INCOMPLETE",
        linkId: link.linkId,
        retryable: true,
        retryAfterMs: retryDelayMs(1),
        remediation: "Repair claimEvidenceTraceMatrix so every declared claim has linked evidence edges with required locator metadata before audit handoff.",
        incompleteClaimIds: claimEvidenceTraceMatrix.incompleteClaimIds || [],
        unresolvedEvidenceIds: claimEvidenceTraceMatrix.unresolvedEvidenceIds || [],
        nonCompliantEvidenceIds: claimEvidenceTraceMatrix.nonCompliantEvidenceIds || [],
        missingClaimIds: claimEvidenceTraceMatrix.missingClaimIds || [],
        claimEvidenceTraceMatrixProof: claimEvidenceTraceMatrix.proof
      };
    }),
    ...recoveringCommands.map((entry) => ({
      code: "AFS_CEL_COMMAND_LEDGER_RECOVERY_REQUIRED",
      commandKey: entry.commandKey,
      linkId: entry.linkId,
      retryable: true,
      retryAfterMs: entry.recovery.retryAfterMs,
      remediation: entry.recovery.reason === "command ledger points at a missing link"
        ? "Rehydrate the missing link record or reject the command ledger entry with an explicit recovery audit."
        : "Replay the original scoped command so the ledger and linked record return to a terminal state."
    })),
    ...(providerRuntime?.degraded ? [{
      code: providerRuntime.readyForWrites ? "AFS_CEL_PROVIDER_DEGRADED" : "AFS_CEL_PROVIDER_UNAVAILABLE",
      retryable: true,
      retryAfterMs: providerRuntime.nextRetry?.retryAfterMs || retryDelayMs(providerRuntime.retryAttempt),
      nextRetryAt: providerRuntime.nextRetry?.nextRetryAt || null,
      remediation: providerRuntime.readyForWrites
        ? "Keep accepting scoped link commands locally, but retry provider health before audit handoff export."
        : "Retry provider negotiation or health-check before relying on hosted proof verification and handoff export.",
      provider: {
        status: providerRuntime.status,
        code: providerRuntime.code,
        message: providerRuntime.message,
        proof: providerRuntime.proof
      }
    }] : []),
    ...(pendingHandoffBlocked ? [{
      code: "AFS_CEL_HANDOFF_BACKLOG_BLOCKED",
      retryable: true,
      retryAfterMs: providerRuntime?.nextRetry?.retryAfterMs || retryDelayMs(1),
      nextRetryAt: providerRuntime?.nextRetry?.nextRetryAt || null,
      remediation: "Resolve provider readiness before exporting the pending claim-evidence handoff queue.",
      queueDepth: handoffState.queueDepth
    }] : []),
    ...(syncState?.status === "blocked" ? [{
      code: "AFS_CEL_SYNC_BLOCKED",
      retryable: true,
      retryAfterMs: providerRuntime?.nextRetry?.retryAfterMs || retryDelayMs(1),
      nextRetryAt: providerRuntime?.nextRetry?.nextRetryAt || null,
      remediation: "Restore provider capability readiness so hosted-kernel sync cursors can advance.",
      cursor: syncState.cursor || null
    }] : [])
  ];
  const lifecycleDisabled = state.lifecycle?.enabled === false;
  const hardBlocked = lifecycleDisabled || providerRuntime?.readyForWrites === false;
  const mode = lifecycleDisabled ? "paused" : errors.length > 0 ? "degraded" : "normal";
  const retryActions = errors
    .filter((error) => error.retryable)
    .map((error, index) => buildRetryAction({
      now,
      type: error.code === "AFS_CEL_PROVIDER_UNAVAILABLE" ? "restore-provider" : "repair-operational-error",
      command: error.code === "AFS_CEL_PROVIDER_UNAVAILABLE"
        ? "claim-evidence-link.provider.health-check"
        : "claim-evidence-link.repair",
      route: error.linkId
        ? `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(error.linkId)}/repair`
        : "/artifact-filesystem/claim-evidence-link/operations",
      reason: error.remediation,
      retryAttempt: index,
      blocked: hardBlocked,
      metadata: {
        code: error.code,
        linkId: error.linkId || null,
        commandKey: error.commandKey || null,
        queueDepth: error.queueDepth || null
      }
    }));
  const degradedReasons = [
    lifecycleDisabled ? "lifecycle controls have disabled new claim-evidence links" : null,
    providerRuntime?.degradedReason || null,
    quarantinedScopeLinks.length > 0 ? "tenant/workspace scope integrity quarantine requires repair" : null,
    errors.some((error) => error.code?.includes("RECOVERY") || error.code === "AFS_CEL_PROOF_MISSING")
      ? "recoverable link integrity issues detected"
      : null,
    incompleteManifestLinks.length > 0 ? "claim-to-proof artifact manifest is incomplete" : null,
    incompleteClaimProofIndexLinks.length > 0 ? "claim proof index has blocked or degraded proof artifacts" : null,
    incompleteArtifactClaimEvidenceLinks.length > 0 ? "artifact claim evidence links are incomplete" : null,
    incompleteClaimEvidenceTraceMatrices.length > 0 ? "claim evidence trace matrix is incomplete" : null,
    pendingHandoffBlocked ? "pending audit handoff queue is blocked by provider readiness" : null
  ].filter(Boolean);
  return {
    checkedAt: now,
    mode,
    status: mode === "normal" ? "healthy" : lifecycleDisabled ? "paused" : hardBlocked ? "blocked" : "action-required",
    canAcceptCommands: !lifecycleDisabled && providerRuntime?.readyForWrites !== false,
    canExportHandoff: state.lifecycle?.enabled !== false && state.integration?.providerContract?.ready === true && providerRuntime?.readyForHandoff !== false,
    degradedReason: degradedReasons[0] || null,
    degradedReasons,
    counts: {
      links: links.length,
      linked: links.filter((link) => link.status === "linked").length,
      scopeQuarantined: quarantinedScopeLinks.length,
      recovering: recoveringLinks.length,
      missingProof: missingProofLinks.length,
      incompleteClaimEvidenceManifest: incompleteManifestLinks.length,
      incompleteClaimProofIndex: incompleteClaimProofIndexLinks.length,
      incompleteArtifactClaimEvidenceLinks: incompleteArtifactClaimEvidenceLinks.length,
      incompleteClaimEvidenceTraceMatrices: incompleteClaimEvidenceTraceMatrices.length,
      recoveringCommands: recoveringCommands.length,
      commandLedger: commandLedger.length,
      auditLog: auditLogForAccess(state, state.accessBoundary).length,
      handoffQueueDepth: handoffState?.queueDepth || 0,
      recoveryTasks: recoveryPlan.taskCount || 0,
      blockingRecoveryTasks: recoveryPlan.blockingTaskCount || 0,
      retryActions: retryActions.length
    },
    providerRuntime,
    recoveryPlan: {
      status: recoveryPlan.status,
      restartSafe: recoveryPlan.restartSafe,
      taskCount: recoveryPlan.taskCount,
      blockingTaskCount: recoveryPlan.blockingTaskCount,
      nextTask: recoveryPlan.nextTask,
      proof: recoveryPlan.proof
    },
    retryPolicy: {
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
      algorithm: "exponential-backoff"
    },
    retryActions,
    proof: proofHash({
      surfaceId,
      checkedAt: now,
      mode,
      status: mode === "normal" ? "healthy" : lifecycleDisabled ? "paused" : hardBlocked ? "blocked" : "action-required",
      errorCodes: errors.map((error) => error.code),
      providerRuntimeProof: providerRuntime?.proof || null,
      accessBoundaryProof: state.accessBoundary?.proof || null,
      recoveryPlanProof: recoveryPlan.proof
    }),
    errors
  };
}

function buildNextAction(state, now) {
  if (state.lifecycle?.enabled === false) {
    return {
      type: "enable-lifecycle",
      dueAt: null,
      priority: "blocked",
      command: "claim-evidence-link.lifecycle.enable",
      reason: "new link commands are paused until lifecycle controls are enabled"
    };
  }
  const providerRuntime = state.integration?.providerRuntime || null;
  if (providerRuntime?.readyForWrites === false) {
    return {
      type: "restore-provider",
      dueAt: providerRuntime.nextRetry?.nextRetryAt || now,
      priority: "blocked",
      command: providerRuntime.nextRetry?.command || "claim-evidence-link.provider.health-check",
      reason: providerRuntime.degradedReason || "provider runtime must recover before hosted-kernel writes continue",
      retryAfterMs: providerRuntime.nextRetry?.retryAfterMs || retryDelayMs(providerRuntime.retryAttempt),
      routeHint: providerRuntime.nextRetry?.route || "/artifact-filesystem/claim-evidence-link/integration"
    };
  }
  if (state.recoveryPlan?.nextTask) {
    const task = state.recoveryPlan.nextTask;
    return {
      type: task.type,
      dueAt: task.retry?.nextRetryAt || now,
      priority: task.priority,
      command: task.type === "reverify-proof"
        ? "claim-evidence-link.proofs.verify"
        : "link-claim-evidence",
      reason: task.reason,
      linkId: task.linkId || null,
      commandKey: task.commandKey || null,
      routeHint: task.route,
      restartSafe: task.restartSafe,
      recoveryTaskId: task.taskId
    };
  }
  const recovering = linksForAccess(state, state.accessBoundary).find((link) => link.status === "recovering" || !link.proof);
  if (recovering) {
    return {
      type: "repair-link-proof",
      dueAt: now,
      priority: "high",
      linkId: recovering.linkId,
      command: "link-claim-evidence",
      reason: "a persisted link needs proof recovery before the next audit export"
    };
  }
  const recoveringCommand = commandLedgerForAccess(state, state.accessBoundary).find((entry) => entry.recovery?.required === true);
  if (recoveringCommand) {
    return {
      type: "repair-command-ledger",
      dueAt: now,
      priority: "high",
      commandKey: recoveringCommand.commandKey,
      linkId: recoveringCommand.linkId,
      command: "link-claim-evidence",
      reason: "a persisted command ledger entry references a link that is missing or not terminal"
    };
  }
  const schedule = state.lifecycle?.settings?.schedule;
  if (schedule?.mode === "interval" && schedule.nextRunAt) {
    const due = Date.parse(schedule.nextRunAt) <= Date.parse(now);
    return {
      type: "scheduled-proof-refresh",
      dueAt: schedule.nextRunAt,
      priority: due ? "due" : "normal",
      command: "claim-evidence-link.lifecycle.refresh-proofs",
      reason: due ? "scheduled proof refresh is due" : "waiting for the next scheduled proof refresh",
      routeHint: "/artifact-filesystem/claim-evidence-link/lifecycle",
      schedule: {
        mode: schedule.mode,
        intervalMinutes: schedule.intervalMinutes,
        nextRunAt: schedule.nextRunAt,
        due
      }
    };
  }
  return {
    type: "accept-link-command",
    dueAt: null,
    priority: "normal",
    command: "link-claim-evidence",
    reason: "surface is ready to accept scoped claim-evidence link commands"
  };
}

function incrementCounter(target, key, amount = 1) {
  if (!key) return;
  target[key] = (target[key] || 0) + amount;
}

function summarizeEvidence(link) {
  const evidence = Array.isArray(link.evidence) ? link.evidence : [];
  const trace = link.evidenceTrace && typeof link.evidenceTrace === "object" ? link.evidenceTrace : null;
  const manifest = evidenceManifestForLink(link);
  const coverage = manifest.coverage || buildClaimProofArtifactCoverage(link, manifest, trace);
  const claimProofIndex = buildClaimProofIndex(link, manifest, trace);
  const artifactClaimEvidenceLinks = buildArtifactClaimEvidenceLinks(link, manifest, trace);
  const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks);
  return {
    count: evidence.length,
    withUri: evidence.filter((item) => Boolean(item?.uri)).length,
    withDigest: evidence.filter((item) => Boolean(item?.digest)).length,
    traceStatus: trace?.status || null,
    claimCount: trace?.claimCount || 0,
    missingClaimCount: Array.isArray(trace?.missingClaimIds) ? trace.missingClaimIds.length : 0,
    manifestStatus: manifest.status,
    manifestClaimCount: manifest.claimCount,
    manifestCompleteClaimCount: manifest.completeClaimCount,
    manifestMissingClaimCount: manifest.missingClaimIds.length,
    manifestProofArtifactRefCount: Array.isArray(manifest.proofArtifacts) ? manifest.proofArtifacts.length : 0,
    manifestUnresolvedProofArtifactRefCount: Array.isArray(manifest.claims)
      ? manifest.claims.reduce((total, claim) => total + normalizeProofArtifactRefs(claim.proofArtifacts).filter((ref) => ref.status === "unresolved").length, 0)
      : 0,
    coverageStatus: coverage.status,
    coverageTraceableClaimCount: coverage.traceableClaimCount,
    coverageUnresolvedClaimCount: coverage.unresolvedClaimIds.length,
    coverageUnresolvedProofArtifactCount: coverage.unresolvedProofArtifactIds.length,
    coverageProof: coverage.proof,
    claimProofIndexStatus: claimProofIndex.status,
    claimProofIndexTraceableClaimCount: claimProofIndex.traceableClaimCount,
    claimProofIndexUnresolvedClaimCount: claimProofIndex.unresolvedClaimIds.length,
    claimProofIndexUnresolvedProofArtifactCount: claimProofIndex.unresolvedProofArtifactIds.length,
    claimProofIndexProof: claimProofIndex.proof,
    artifactClaimEvidenceLinkStatus: artifactClaimEvidenceLinks.status,
    artifactClaimEvidenceLinkedClaimCount: artifactClaimEvidenceLinks.linkedClaimCount,
    artifactClaimEvidenceUnresolvedClaimCount: artifactClaimEvidenceLinks.unresolvedClaimIds.length,
    artifactClaimEvidenceUnresolvedEvidenceCount: artifactClaimEvidenceLinks.unresolvedEvidenceIds.length,
    artifactClaimEvidenceLinkProof: artifactClaimEvidenceLinks.proof,
    claimEvidenceTraceMatrixStatus: claimEvidenceTraceMatrix.status,
    claimEvidenceTraceMatrixLinkedClaimCount: claimEvidenceTraceMatrix.linkedClaimCount,
    claimEvidenceTraceMatrixIncompleteClaimCount: claimEvidenceTraceMatrix.incompleteClaimIds.length,
    claimEvidenceTraceMatrixUnresolvedEvidenceCount: claimEvidenceTraceMatrix.unresolvedEvidenceIds.length,
    claimEvidenceTraceMatrixNonCompliantEvidenceCount: claimEvidenceTraceMatrix.nonCompliantEvidenceIds.length,
    claimEvidenceTraceMatrixEdgeCount: claimEvidenceTraceMatrix.edgeCount,
    claimEvidenceTraceMatrixLinkedEdgeCount: claimEvidenceTraceMatrix.linkedEdgeCount,
    claimEvidenceTraceMatrixProof: claimEvidenceTraceMatrix.proof,
    manifestValidationStatus: manifest.validation?.status || manifest.status,
    manifestValidationReasons: manifest.validation?.reasons || [],
    manifestProof: manifest.proof
  };
}

function handoffStatusForLink(link, providerReady, state = {}) {
  if (link.status !== "linked") return "not-linked";
  if (!link.proof) return "proof-missing";
  const manifest = evidenceManifestForLink(link);
  if (manifest.status !== "complete") return "claim-evidence-manifest-incomplete";
  const artifactClaimEvidenceLinks = artifactClaimEvidenceLinksForState(state, link, manifest);
  if (artifactClaimEvidenceLinks.status !== "complete") return "artifact-claim-evidence-link-incomplete";
  if (buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks).status !== "complete") return "claim-evidence-trace-matrix-incomplete";
  if (link.auditHandoff?.exportedAt) return "exported";
  return providerReady ? "export-ready" : "provider-blocked";
}

function evidenceDensityBand(count) {
  if (count === 0) return "empty";
  if (count === 1) return "single";
  if (count <= 5) return "small";
  if (count <= 20) return "medium";
  return "large";
}

function timelineEventBand(event) {
  const type = event?.type || "unknown";
  if (type.includes(".rejected")) return "rejection";
  if (type.includes(".handoff.exported")) return "handoff-export";
  if (type.includes(".lifecycle.")) return "lifecycle";
  if (type.includes("recovered") || type.includes("replay")) return "recovery";
  if (type === "link-created" || type === "link-updated" || type === "claim-evidence-link.linked") return "linking";
  return "audit";
}

function buildCounterDigest({
  state,
  links,
  auditLog,
  commandLedger,
  byStatus,
  byScope,
  byActor,
  byAction,
  byCommandStatus
}) {
  const providerReady = state.integration?.providerContract?.ready === true
    && state.integration?.providerRuntime?.readyForHandoff !== false;
  const byHandoffStatus = {};
  const byProofStatus = {};
  const byEvidenceDensity = {};
  const byExportActor = {};
  const byFailureCode = {};
  const byProviderState = {};
  let exported = 0;
  let pendingExport = 0;
  let failedAuditEvents = 0;

  for (const link of links) {
    const evidenceStats = summarizeEvidence(link);
    const handoffStatus = handoffStatusForLink(link, providerReady, state);
    incrementCounter(byHandoffStatus, handoffStatus);
    incrementCounter(byProofStatus, link.proof ? "verified" : "missing");
    incrementCounter(byEvidenceDensity, evidenceDensityBand(evidenceStats.count));
    if (handoffStatus === "exported") {
      exported += 1;
      incrementCounter(byExportActor, link.auditHandoff?.exportedBy || "unknown");
    }
    if (handoffStatus === "export-ready" || handoffStatus === "provider-blocked") pendingExport += 1;
  }

  for (const audit of auditLog) {
    const errors = Array.isArray(audit.actionableErrors) ? audit.actionableErrors : [];
    if (errors.length > 0 || audit.failureId) failedAuditEvents += 1;
    for (const error of errors) incrementCounter(byFailureCode, error.code || "unknown");
  }

  const providerRuntimeStatus = state.integration?.providerRuntime?.status || "unknown";
  incrementCounter(byProviderState, providerRuntimeStatus);
  if (state.integration?.providerContract?.ready === true) {
    incrementCounter(byProviderState, "contract-ready");
  } else {
    incrementCounter(byProviderState, "contract-blocked");
  }

  return {
    contractVersion: "aios.claim-evidence-link.analytics-counters.v1",
    linkCounters: {
      byStatus,
      byScope,
      byActor,
      byProofStatus,
      byEvidenceDensity,
      byHandoffStatus
    },
    commandCounters: {
      byCommandStatus,
      recovering: byCommandStatus.recovering || 0,
      rejected: byCommandStatus.rejected || 0,
      restartSafe: commandLedger.filter((entry) => entry.recovery?.required !== true).length
    },
    auditCounters: {
      byAction,
      byFailureCode,
      failedAuditEvents,
      rejectedCommands: byAction["claim-evidence-link.rejected"] || 0,
      rejectedHandoffs: byAction["claim-evidence-link.handoff.rejected"] || 0,
      exportedHandoffs: byAction["claim-evidence-link.handoff.exported"] || 0
    },
    handoffCounters: {
      exported,
      pendingExport,
      queueDepth: state.integration?.externalHandoff?.queueDepth || 0,
      byExportActor
    },
    providerCounters: {
      byProviderState,
      readyForWrites: state.integration?.providerRuntime?.readyForWrites === true ? 1 : 0,
      readyForHandoff: state.integration?.providerRuntime?.readyForHandoff === true ? 1 : 0
    }
  };
}

function buildClaimEvidenceGapReport(state, links, now) {
  const rows = [];
  const byReason = {};
  const byScope = {};
  const bySeverity = {};
  const byLinkStatus = {};
  const linkedEvidencePolicy = evidenceReferencePolicyForState(state);
  for (const link of links) {
    const manifest = evidenceManifestForLink(link);
    const claimProofIndex = link.claimProofIndex || buildClaimProofIndex(link, manifest, link.evidenceTrace || null);
    const artifactClaimEvidenceLinks = link.artifactClaimEvidenceLinks
      || buildArtifactClaimEvidenceLinks(link, manifest, link.evidenceTrace || null, linkedEvidencePolicy);
    const traceMatrix = link.claimEvidenceTraceMatrix || buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks);
    const indexClaims = new Map((Array.isArray(claimProofIndex.claims) ? claimProofIndex.claims : [])
      .filter((claim) => normalizeOptionalText(claim?.claimId))
      .map((claim) => [claim.claimId, claim]));
    const matrixRows = Array.isArray(traceMatrix.rows) ? traceMatrix.rows : [];
    const matrixClaimIds = new Set(matrixRows.map((row) => row.claimId));
    const missingMatrixClaimIds = normalizeIdList([
      ...(traceMatrix.missingClaimIds || []),
      ...(claimProofIndex.unresolvedClaimIds || []).filter((claimId) => !matrixClaimIds.has(claimId))
    ]);
    const candidateRows = [
      ...matrixRows.filter((row) => row.status !== "linked" || (row.reasons || []).length > 0),
      ...missingMatrixClaimIds.map((claimId) => ({
        claimId,
        artifactId: link.artifactId || null,
        status: "missing",
        requiredEvidenceIds: indexClaims.get(claimId)?.requiredProofArtifactIds || [],
        linkedEvidenceIds: indexClaims.get(claimId)?.resolvedProofArtifactIds || [],
        unresolvedEvidenceIds: indexClaims.get(claimId)?.unresolvedProofArtifactIds || [],
        nonCompliantEvidenceIds: [],
        missingDigestEvidenceIds: [],
        missingLocatorEvidenceIds: [],
        edgeCount: 0,
        linkedEdgeCount: 0,
        reasons: ["claim-missing-from-trace-matrix"],
        proof: indexClaims.get(claimId)?.proof || null
      }))
    ];
    for (const row of candidateRows) {
      const reasons = [...new Set(row.reasons || [])].sort();
      const severity = reasons.includes("claim-missing-from-trace-matrix")
        || normalizeIdList(row.unresolvedEvidenceIds).length > 0
        || row.status === "missing"
        ? "blocker"
        : normalizeIdList(row.nonCompliantEvidenceIds).length > 0
          || normalizeIdList(row.missingDigestEvidenceIds).length > 0
          || normalizeIdList(row.missingLocatorEvidenceIds).length > 0
          ? "attention"
          : "review";
      const gapRow = {
        rowId: proofHash({
          surfaceId,
          linkId: link.linkId,
          claimId: row.claimId,
          reasons,
          matrixProof: row.proof || null
        }),
        linkId: link.linkId,
        rawLinkId: link.rawLinkId || null,
        claimId: row.claimId,
        artifactId: row.artifactId || link.artifactId || null,
        scopeKey: link.scope?.scopeKey || null,
        actorId: link.actor?.actorId || null,
        linkStatus: link.status,
        severity,
        status: row.status || "incomplete",
        requiredEvidenceIds: normalizeIdList(row.requiredEvidenceIds),
        linkedEvidenceIds: normalizeIdList(row.linkedEvidenceIds),
        unresolvedEvidenceIds: normalizeIdList(row.unresolvedEvidenceIds),
        nonCompliantEvidenceIds: normalizeIdList(row.nonCompliantEvidenceIds),
        missingDigestEvidenceIds: normalizeIdList(row.missingDigestEvidenceIds),
        missingLocatorEvidenceIds: normalizeIdList(row.missingLocatorEvidenceIds),
        edgeCount: normalizeNonNegativeInteger(row.edgeCount, 0),
        linkedEdgeCount: normalizeNonNegativeInteger(row.linkedEdgeCount, 0),
        reasons,
        claimProofIndexProof: indexClaims.get(row.claimId)?.proof || claimProofIndex.proof || null,
        artifactClaimEvidenceLinksProof: artifactClaimEvidenceLinks.proof || null,
        claimEvidenceTraceMatrixProof: row.proof || traceMatrix.proof || null,
        updatedAt: link.updatedAt || link.createdAt || now
      };
      rows.push(gapRow);
      incrementCounter(byScope, gapRow.scopeKey || "unscoped");
      incrementCounter(bySeverity, severity);
      incrementCounter(byLinkStatus, gapRow.linkStatus || "unknown");
      for (const reason of reasons) incrementCounter(byReason, reason);
    }
  }
  const uniqueRows = [...new Map(rows.map((row) => [row.rowId, row])).values()]
    .sort((left, right) => {
      const severityRank = { blocker: 0, attention: 1, review: 2 };
      return (severityRank[left.severity] ?? 3) - (severityRank[right.severity] ?? 3)
        || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
        || left.linkId.localeCompare(right.linkId)
        || left.claimId.localeCompare(right.claimId);
    });
  const affectedLinkIds = normalizeIdList(uniqueRows.map((row) => row.linkId));
  const affectedClaimIds = normalizeIdList(uniqueRows.map((row) => row.claimId));
  const payload = {
    surfaceId,
    generatedAt: now,
    affectedLinkIds,
    affectedClaimIds,
    byReason,
    bySeverity,
    rowProofs: uniqueRows.map((row) => row.rowId)
  };
  return {
    contractVersion: "aios.claim-evidence-link.claim-evidence-gap-report.v1",
    generatedAt: now,
    status: uniqueRows.length === 0 ? "clear" : (bySeverity.blocker || 0) > 0 ? "blocked" : "attention",
    rowCount: uniqueRows.length,
    affectedLinkCount: affectedLinkIds.length,
    affectedClaimCount: affectedClaimIds.length,
    unresolvedEvidenceCount: normalizeIdList(uniqueRows.flatMap((row) => row.unresolvedEvidenceIds)).length,
    nonCompliantEvidenceCount: normalizeIdList(uniqueRows.flatMap((row) => row.nonCompliantEvidenceIds)).length,
    missingDigestEvidenceCount: normalizeIdList(uniqueRows.flatMap((row) => row.missingDigestEvidenceIds)).length,
    missingLocatorEvidenceCount: normalizeIdList(uniqueRows.flatMap((row) => row.missingLocatorEvidenceIds)).length,
    blockerCount: bySeverity.blocker || 0,
    attentionCount: bySeverity.attention || 0,
    byReason,
    byScope,
    bySeverity,
    byLinkStatus,
    rows: uniqueRows.slice(0, 50),
    exportRows: uniqueRows.map((row) => ({
      rowId: row.rowId,
      linkId: row.linkId,
      claimId: row.claimId,
      artifactId: row.artifactId,
      scopeKey: row.scopeKey,
      severity: row.severity,
      reasons: row.reasons,
      unresolvedEvidenceIds: row.unresolvedEvidenceIds,
      nonCompliantEvidenceIds: row.nonCompliantEvidenceIds,
      claimEvidenceTraceMatrixProof: row.claimEvidenceTraceMatrixProof
    })),
    proof: proofHash(payload)
  };
}

function negotiateProviderContract(input = {}, persistedIntegration = {}, now) {
  const provider = normalizeProviderIdentity(input.provider || persistedIntegration.provider);
  const requestedCapabilities = normalizeCapabilityList(
    input.requestedCapabilities
      || input.capabilities
      || persistedIntegration.requestedCapabilities
      || [...supportedProviderCapabilities]
  );
  const acceptedCapabilities = requestedCapabilities.filter((capability) => supportedProviderCapabilities.has(capability));
  const rejectedCapabilities = requestedCapabilities
    .filter((capability) => !supportedProviderCapabilities.has(capability))
    .map((capability) => ({
      capability,
      reason: "unsupported by artifact-filesystem claim-evidence-link hosted-kernel contract"
    }));
  const missingRequiredCapabilities = requiredProviderCapabilities.filter((capability) => !acceptedCapabilities.includes(capability));
  const serviceContract = normalizeProviderServiceContract(input, persistedIntegration, acceptedCapabilities, now);
  const ready = missingRequiredCapabilities.length === 0 && serviceContract.ready;
  const payload = {
    surfaceId,
    provider,
    requestedCapabilities,
    acceptedCapabilities,
    missingRequiredCapabilities,
    rejectedCapabilities,
    serviceContractProof: serviceContract.proof,
    missingServiceRequirements: serviceContract.missingServiceRequirements
  };
  return {
    provider,
    requestedCapabilities,
    acceptedCapabilities,
    rejectedCapabilities,
    requiredCapabilities: requiredProviderCapabilities,
    missingRequiredCapabilities,
    serviceContract,
    ready,
    negotiatedAt: now,
    proof: proofHash(payload)
  };
}

function buildSyncMetadata(state, contract, now, persistedIntegration = {}) {
  const links = linksForAccess(state, state.accessBoundary);
  const auditLog = auditLogForAccess(state, state.accessBoundary);
  const latestLinkUpdate = links
    .map((link) => link.updatedAt)
    .filter((value) => typeof value === "string")
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
  const latestAuditAt = auditLog
    .map((audit) => audit.at)
    .filter((value) => typeof value === "string")
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
  const previousCursor = normalizeOptionalText(persistedIntegration.sync?.cursor);
  const previousAckCursor = normalizeOptionalText(persistedIntegration.sync?.acknowledgedCursor || persistedIntegration.sync?.ackedCursor);
  const cursorPayload = {
    surfaceId,
    providerInstanceId: contract.provider.providerInstanceId,
    serviceContractProof: contract.serviceContract?.proof || null,
    stateVersion: state.stateVersion,
    latestLinkUpdate,
    latestAuditAt,
    linkCount: links.length,
    auditCount: auditLog.length
  };
  const cursor = proofHash(cursorPayload);
  const syncBlocked = contract.ready !== true;
  return {
    status: syncBlocked ? "blocked" : previousAckCursor === cursor ? "acknowledged" : "ready",
    cursor,
    previousCursor,
    acknowledgedCursor: previousAckCursor,
    acknowledged: Boolean(previousAckCursor && previousAckCursor === cursor),
    changed: previousCursor ? previousCursor !== cursor : links.length > 0 || auditLog.length > 0,
    lastSyncedAt: asIso(persistedIntegration.sync?.lastSyncedAt, now),
    mode: contract.serviceContract?.syncMode || "push",
    cursorAck: contract.serviceContract?.cursorAck || null,
    blockedReason: syncBlocked
      ? "provider service contract must be ready before hosted-kernel sync cursors can advance"
      : null,
    target: {
      providerInstanceId: contract.provider.providerInstanceId,
      serviceContractProof: contract.serviceContract?.proof || null
    },
    sourceWatermarks: {
      latestLinkUpdate,
      latestAuditAt,
      linkCount: links.length,
      auditCount: auditLog.length
    }
  };
}

function buildHandoffBoundaryManifest(state, pendingLinks, now) {
  const allPendingLinks = Object.values(state.links || {})
    .filter((link) => linkReadyForHandoff(state, link) && !link.auditHandoff?.exportedAt);
  const visiblePendingIds = new Set(pendingLinks.map((link) => link.linkId));
  const hiddenPendingLinks = allPendingLinks.filter((link) => !visiblePendingIds.has(link.linkId));
  const scopeKeyCounts = {};
  for (const link of pendingLinks) incrementCounter(scopeKeyCounts, link.scope?.scopeKey || "unscoped");
  const payload = {
    surfaceId,
    generatedAt: now,
    accessBoundaryProof: state.accessBoundary?.proof || null,
    requestedScope: state.accessBoundary?.requestedScope || null,
    mode: state.accessBoundary?.mode || "unscoped-hosted-kernel",
    visiblePendingLinkIds: pendingLinks.map((link) => link.linkId).sort(),
    hiddenPendingLinkIds: hiddenPendingLinks.map((link) => link.linkId).sort()
  };
  return {
    contractVersion: "aios.claim-evidence-link.handoff-boundary.v1",
    generatedAt: now,
    mode: state.accessBoundary?.mode || "unscoped-hosted-kernel",
    requestedScope: state.accessBoundary?.requestedScope || null,
    actor: state.accessBoundary?.actor
      ? {
        actorId: state.accessBoundary.actor.actorId || null,
        roles: state.accessBoundary.actor.roles || [],
        canBypassTenantBoundary: state.accessBoundary.actor.canBypassTenantBoundary === true
      }
      : null,
    isolationEnforced: state.accessBoundary?.isolation?.enforced === true,
    visiblePendingLinkIds: pendingLinks.map((link) => link.linkId).sort(),
    hiddenPendingCount: hiddenPendingLinks.length,
    hiddenPendingScopeKeys: [...new Set(hiddenPendingLinks.map((link) => link.scope?.scopeKey || "unscoped"))].sort(),
    visiblePendingScopeKeys: Object.keys(scopeKeyCounts).sort(),
    visiblePendingByScope: scopeKeyCounts,
    exportRequiresScopedCommand: state.accessBoundary?.actor?.canBypassTenantBoundary !== true,
    proof: proofHash(payload)
  };
}

function buildProviderHandoffBatch(state, contract, sync, now, providerRuntime = null) {
  const serviceContract = contract.serviceContract || {};
  const providerReady = contract.ready === true
    && providerRuntime?.readyForHandoff !== false
    && state.lifecycle?.enabled !== false;
  const visibleCandidates = linksForAccess(state, state.accessBoundary)
    .filter((link) => link.status === "linked" && !link.auditHandoff?.exportedAt)
    .sort((left, right) => Date.parse(left.updatedAt || left.createdAt) - Date.parse(right.updatedAt || right.createdAt));
  const rows = visibleCandidates.map((link) => {
      const manifest = evidenceManifestForLink(link);
      const claimProofIndex = link.claimProofIndex || buildClaimProofIndex(link, manifest, link.evidenceTrace || null);
      const artifactClaimEvidenceLinks = artifactClaimEvidenceLinksForState(state, link, manifest);
      const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks);
      const acceptancePreview = buildLinkAcceptancePreview({
        state: {
          ...state,
          integration: {
            ...(state.integration || {}),
            providerContract: contract,
            providerRuntime
          }
        },
        link,
        now,
        manifest,
        claimProofIndex,
        artifactClaimEvidenceLinks,
        claimEvidenceTraceMatrix
      });
      const localBlockers = [
        !link.proof ? "link-proof-missing" : null,
        link.scopeIntegrity?.status === "quarantined" ? "scope-integrity-quarantined" : null,
        manifest.status !== "complete" ? "claim-evidence-manifest-incomplete" : null,
      claimProofIndex.readiness?.ready === false ? "claim-proof-index-not-ready" : null,
      artifactClaimEvidenceLinks.status !== "complete" ? "artifact-claim-evidence-links-incomplete" : null,
      claimEvidenceTraceMatrix.status !== "complete" ? "claim-evidence-trace-matrix-incomplete" : null
    ].filter(Boolean);
    const providerBlockers = [
      state.lifecycle?.enabled === false ? "lifecycle-disabled" : null,
      contract.ready !== true ? "provider-contract-not-ready" : null,
      providerRuntime?.readyForHandoff === false ? "provider-runtime-not-ready" : null
    ].filter(Boolean);
    const status = localBlockers.length > 0
      ? "blocked"
      : providerBlockers.length > 0
        ? "degraded"
        : "exportable";
    const rowPayload = {
      surfaceId,
      linkId: link.linkId,
      scopeKey: link.scope?.scopeKey || null,
      syncCursor: sync.cursor || null,
      status,
      localBlockers,
      providerBlockers,
      linkProof: link.proof || null,
      manifestProof: manifest.proof || null,
      claimProofIndexProof: claimProofIndex.proof || null,
      artifactClaimEvidenceLinksProof: artifactClaimEvidenceLinks.proof || null,
      claimEvidenceTraceMatrixProof: claimEvidenceTraceMatrix.proof || null
    };
    return {
      rowId: proofHash(rowPayload),
      linkId: link.linkId,
      rawLinkId: link.rawLinkId || null,
      claimId: link.claimId,
      artifactId: link.artifactId,
      scopeKey: link.scope?.scopeKey || null,
      status,
      exportable: status === "exportable",
      degraded: status === "degraded",
      blocked: status === "blocked",
      localBlockers,
      providerBlockers,
      claimIds: claimProofIndex.claims?.map((claim) => claim.claimId).sort() || [],
      proofArtifactIds: normalizeIdList(claimProofIndex.claims?.flatMap((claim) => claim.requiredProofArtifactIds) || []),
      acceptancePreview: {
        contractVersion: acceptancePreview.contractVersion,
        status: acceptancePreview.status,
        accepted: acceptancePreview.accepted,
        readyForHandoff: acceptancePreview.readyForHandoff,
        validationSummary: acceptancePreview.validationSummary,
        nextStep: acceptancePreview.nextStep,
        proof: acceptancePreview.proof
      },
      unresolvedClaimIds: normalizeIdList([
        ...(manifest.missingClaimIds || []),
        ...(claimProofIndex.unresolvedClaimIds || []),
        ...(artifactClaimEvidenceLinks.unresolvedClaimIds || []),
        ...(claimEvidenceTraceMatrix.incompleteClaimIds || [])
      ]),
      unresolvedEvidenceIds: normalizeIdList([
        ...(artifactClaimEvidenceLinks.unresolvedEvidenceIds || []),
        ...(claimEvidenceTraceMatrix.unresolvedEvidenceIds || [])
      ]),
      nonCompliantEvidenceIds: normalizeIdList([
        ...(artifactClaimEvidenceLinks.nonCompliantEvidenceIds || []),
        ...(claimEvidenceTraceMatrix.nonCompliantEvidenceIds || [])
      ]),
      locatorPolicyReasons: artifactClaimEvidenceLinks.evidenceReferencePolicyReasons || [],
      evidenceTraceProof: link.evidenceTrace?.proof || null,
      claimEvidenceManifestProof: manifest.proof || null,
      claimProofIndexProof: claimProofIndex.proof || null,
      artifactClaimEvidenceLinksProof: artifactClaimEvidenceLinks.proof || null,
      claimEvidenceTraceMatrixProof: claimEvidenceTraceMatrix.proof || null,
      linkProof: link.proof || null,
      handoffRoute: serviceContract.handoffSink?.route || null,
      cursor: sync.cursor || null,
      cursorAckRequired: serviceContract.cursorAck?.required === true,
      cursorAckRoute: serviceContract.cursorAck?.route || null,
      updatedAt: link.updatedAt || link.createdAt || now,
      proof: proofHash(rowPayload)
    };
  });
  const counts = rows.reduce((accumulator, row) => {
    accumulator[row.status] = (accumulator[row.status] || 0) + 1;
    return accumulator;
  }, { exportable: 0, degraded: 0, blocked: 0 });
  const payload = {
    surfaceId,
    generatedAt: now,
    providerInstanceId: contract.provider.providerInstanceId,
    syncCursor: sync.cursor || null,
    providerReady,
    counts,
    rowProofs: rows.map((row) => row.proof),
    accessBoundaryProof: state.accessBoundary?.proof || null,
    serviceContractProof: serviceContract.proof || null,
    providerRuntimeProof: providerRuntime?.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.provider-handoff-batch.v1",
    generatedAt: now,
    status: counts.exportable > 0 && providerReady
      ? "ready"
      : counts.blocked > 0
        ? "blocked"
        : counts.degraded > 0
          ? "degraded"
          : "idle",
    providerReady,
    cursor: sync.cursor || null,
    syncMode: sync.mode || serviceContract.syncMode || "push",
    target: {
      providerName: contract.provider.providerName,
      providerInstanceId: contract.provider.providerInstanceId,
      handoffSink: serviceContract.handoffSink || null,
      cursorAck: serviceContract.cursorAck || null
    },
    counts,
    nextExportableLinkId: rows.find((row) => row.exportable)?.linkId || null,
    rows,
    proof: proofHash(payload)
  };
}

function buildExternalHandoffState(state, contract, sync, now, providerRuntime = null) {
  const readyLinks = linksForAccess(state, state.accessBoundary).filter((link) => linkReadyForHandoff(state, link));
  const pendingLinks = readyLinks.filter((link) => !link.auditHandoff?.exportedAt);
  const boundaryManifest = buildHandoffBoundaryManifest(state, pendingLinks, now);
  const providerHandoffBatch = buildProviderHandoffBatch(state, contract, sync, now, providerRuntime);
  const nextManifest = pendingLinks[0] ? evidenceManifestForLink(pendingLinks[0]) : null;
  const nextClaimProofIndex = pendingLinks[0]
    ? buildClaimProofIndex(pendingLinks[0], nextManifest, pendingLinks[0].evidenceTrace || null)
    : null;
  const nextArtifactClaimEvidenceLinks = pendingLinks[0]
    ? artifactClaimEvidenceLinksForState(state, pendingLinks[0], nextManifest)
    : null;
  const nextClaimEvidenceTraceMatrix = pendingLinks[0]
    ? buildClaimEvidenceTraceMatrix(pendingLinks[0], nextArtifactClaimEvidenceLinks)
    : null;
  const blockedReason = !contract.ready
    ? contract.missingRequiredCapabilities?.length > 0
      ? "provider capability negotiation is missing required handoff capabilities"
      : "provider service contract is missing required handoff endpoint metadata"
    : providerRuntime?.readyForHandoff === false
      ? providerRuntime.degradedReason || "provider runtime is not ready for claim-evidence handoff export"
      : state.lifecycle?.enabled === false
        ? "lifecycle controls have disabled new claim-evidence handoff exports"
        : null;
  const leasePayload = pendingLinks[0]
    ? {
      surfaceId,
      linkId: pendingLinks[0].linkId,
      scopeKey: pendingLinks[0].scope?.scopeKey || null,
      syncCursor: sync.cursor,
      providerInstanceId: contract.provider.providerInstanceId,
      serviceContractProof: contract.serviceContract?.proof || null
    }
    : null;
  const payload = {
    surfaceId,
    providerInstanceId: contract.provider.providerInstanceId,
    syncCursor: sync.cursor,
    pendingLinkIds: pendingLinks.map((link) => link.linkId),
    blockedReason,
    accessBoundaryProof: state.accessBoundary?.proof || null,
    handoffBoundaryProof: boundaryManifest.proof,
    providerRuntimeProof: providerRuntime?.proof || null,
    serviceContractProof: contract.serviceContract?.proof || null,
    providerHandoffBatchProof: providerHandoffBatch.proof,
    nextClaimEvidenceManifestProof: nextManifest?.proof || null,
    nextClaimProofIndexProof: nextClaimProofIndex?.proof || null,
    nextArtifactClaimEvidenceLinksProof: nextArtifactClaimEvidenceLinks?.proof || null,
    nextClaimEvidenceTraceMatrixProof: nextClaimEvidenceTraceMatrix?.proof || null
  };
  return {
    status: blockedReason ? "blocked" : pendingLinks.length > 0 ? "pending" : "idle",
    blockedReason,
    queueDepth: pendingLinks.length,
    target: {
      providerName: contract.provider.providerName,
      providerInstanceId: contract.provider.providerInstanceId,
      contractVersion: contract.provider.contractVersion,
      serviceContractVersion: contract.serviceContract?.contractVersion || null,
      handoffSink: contract.serviceContract?.handoffSink || null
    },
    providerHandoffBatch,
    boundary: boundaryManifest,
    nextEnvelope: pendingLinks[0]
      ? {
        envelopeType: "aios.claim-evidence-link.handoff.v1",
        linkId: pendingLinks[0].linkId,
        scopeKey: pendingLinks[0].scope?.scopeKey || null,
        proof: pendingLinks[0].proof,
        evidenceTraceProof: pendingLinks[0].evidenceTrace?.proof || null,
        claimEvidenceManifest: nextManifest,
        claimEvidenceManifestProof: nextManifest?.proof || null,
        claimProofArtifactCoverage: nextManifest?.coverage || null,
        claimProofArtifactCoverageProof: nextManifest?.coverage?.proof || null,
        claimProofIndex: nextClaimProofIndex,
        claimProofIndexProof: nextClaimProofIndex?.proof || null,
        artifactClaimEvidenceLinks: nextArtifactClaimEvidenceLinks,
        artifactClaimEvidenceLinksProof: nextArtifactClaimEvidenceLinks?.proof || null,
        claimEvidenceTraceMatrix: nextClaimEvidenceTraceMatrix,
        claimEvidenceTraceMatrixProof: nextClaimEvidenceTraceMatrix?.proof || null,
        claimEvidenceManifestProofArtifactRefCount: Array.isArray(nextManifest?.proofArtifacts)
          ? nextManifest.proofArtifacts.length
          : 0,
        cursor: sync.cursor,
        cursorAck: sync.cursorAck || null,
        syncMode: sync.mode || "push",
        handoffLease: {
          token: proofHash(leasePayload),
          issuedAt: now,
          expiresAt: asIso(new Date(Date.parse(now) + 10 * 60000).toISOString(), now),
          targetRoute: contract.serviceContract?.handoffSink?.route || null
        },
        boundary: {
          contractVersion: boundaryManifest.contractVersion,
          mode: boundaryManifest.mode,
          requestedScope: boundaryManifest.requestedScope,
          hiddenPendingCount: boundaryManifest.hiddenPendingCount,
          proof: boundaryManifest.proof
        },
        accessBoundaryProof: state.accessBoundary?.proof || null,
        providerRuntimeProof: providerRuntime?.proof || null,
        serviceContractProof: contract.serviceContract?.proof || null,
        providerHandoffBatchProof: providerHandoffBatch.proof,
        preparedAt: now,
        envelopeProof: proofHash({
          surfaceId,
          linkId: pendingLinks[0].linkId,
          syncCursor: sync.cursor,
          claimEvidenceManifestProof: nextManifest?.proof || null,
          claimProofIndexProof: nextClaimProofIndex?.proof || null,
          artifactClaimEvidenceLinksProof: nextArtifactClaimEvidenceLinks?.proof || null,
          claimEvidenceTraceMatrixProof: nextClaimEvidenceTraceMatrix?.proof || null,
          providerHandoffBatchProof: providerHandoffBatch.proof
        })
      }
      : null,
    retry: blockedReason && providerRuntime?.nextRetry ? providerRuntime.nextRetry : null,
    proof: proofHash(payload)
  };
}

function attachIntegrationState(state, now, input = {}) {
  const persistedIntegration = state.integration && typeof state.integration === "object" ? state.integration : {};
  const providerContract = negotiateProviderContract(input.integration || input.providerContract || input.provider || {}, persistedIntegration, now);
  const providerRuntime = normalizeProviderRuntimeHealth(input, persistedIntegration, providerContract, now);
  const sync = buildSyncMetadata(state, providerContract, now, persistedIntegration);
  const externalHandoff = buildExternalHandoffState(state, providerContract, sync, now, providerRuntime);
  return {
    ...state,
    integration: {
      providerContract,
      providerRuntime,
      sync,
      externalHandoff
    }
  };
}

function buildAnalyticsSnapshot(state, now) {
  const links = linksForAccess(state, state.accessBoundary);
  const auditLog = auditLogForAccess(state, state.accessBoundary);
  const commandLedger = commandLedgerForAccess(state, state.accessBoundary);
  const byStatus = {};
  const byCommandStatus = {};
  const byScope = {};
  const byActor = {};
  const byAction = {};
  let evidenceTotal = 0;
  let linksWithDigest = 0;
  let linksWithUri = 0;
  let linksWithCompleteTrace = 0;
  let evidenceTraceMissingClaims = 0;
  let linksWithCompleteManifest = 0;
  let manifestMissingClaims = 0;
  let linksWithCompleteProofArtifactCoverage = 0;
  let proofArtifactCoverageUnresolvedClaims = 0;
  let proofArtifactCoverageUnresolvedArtifacts = 0;
  let linksWithReadyClaimProofIndex = 0;
  let claimProofIndexBlockedClaims = 0;
  let claimProofIndexRetryableClaims = 0;
  let linksWithCompleteArtifactClaimEvidenceLinks = 0;
  let artifactClaimEvidenceLinkUnresolvedClaims = 0;
  let artifactClaimEvidenceLinkUnresolvedEvidence = 0;
  let artifactClaimEvidenceLinkNonCompliantEvidence = 0;
  let artifactClaimEvidenceLinkMissingDigest = 0;
  let artifactClaimEvidenceLinkMissingLocator = 0;
  let linksWithCompleteClaimEvidenceTraceMatrix = 0;
  let claimEvidenceTraceMatrixIncompleteClaims = 0;
  let claimEvidenceTraceMatrixUnresolvedEvidence = 0;
  let claimEvidenceTraceMatrixNonCompliantEvidence = 0;

  for (const link of links) {
    incrementCounter(byStatus, link.status || "unknown");
    incrementCounter(byScope, link.scope?.scopeKey || "unscoped");
    incrementCounter(byActor, link.actor?.actorId || "unknown");
    const evidenceStats = summarizeEvidence(link);
    evidenceTotal += evidenceStats.count;
    if (evidenceStats.withDigest > 0) linksWithDigest += 1;
    if (evidenceStats.withUri > 0) linksWithUri += 1;
    if (link.evidenceTrace?.status === "complete") linksWithCompleteTrace += 1;
    evidenceTraceMissingClaims += Array.isArray(link.evidenceTrace?.missingClaimIds) ? link.evidenceTrace.missingClaimIds.length : 0;
    const manifest = evidenceManifestForLink(link);
    if (manifest.status === "complete") linksWithCompleteManifest += 1;
    manifestMissingClaims += manifest.missingClaimIds.length;
    const coverage = manifest.coverage || buildClaimProofArtifactCoverage(link, manifest, link.evidenceTrace || null);
    if (coverage.status === "complete") linksWithCompleteProofArtifactCoverage += 1;
    proofArtifactCoverageUnresolvedClaims += coverage.unresolvedClaimIds.length;
    proofArtifactCoverageUnresolvedArtifacts += coverage.unresolvedProofArtifactIds.length;
    const claimProofIndex = link.claimProofIndex || buildClaimProofIndex(link, manifest, link.evidenceTrace || null);
    if (claimProofIndex.readiness?.ready === true) linksWithReadyClaimProofIndex += 1;
    claimProofIndexBlockedClaims += claimProofIndex.readiness?.blockedClaimIds?.length || 0;
    claimProofIndexRetryableClaims += claimProofIndex.readiness?.retryableClaimIds?.length || 0;
    const artifactClaimEvidenceLinks = artifactClaimEvidenceLinksForState(state, link, manifest);
    if (artifactClaimEvidenceLinks.status === "complete") linksWithCompleteArtifactClaimEvidenceLinks += 1;
    artifactClaimEvidenceLinkUnresolvedClaims += artifactClaimEvidenceLinks.unresolvedClaimIds.length;
    artifactClaimEvidenceLinkUnresolvedEvidence += artifactClaimEvidenceLinks.unresolvedEvidenceIds.length;
    artifactClaimEvidenceLinkNonCompliantEvidence += artifactClaimEvidenceLinks.nonCompliantEvidenceIds.length;
    artifactClaimEvidenceLinkMissingDigest += artifactClaimEvidenceLinks.missingDigestEvidenceIds.length;
    artifactClaimEvidenceLinkMissingLocator += artifactClaimEvidenceLinks.missingLocatorEvidenceIds.length;
    const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks);
    if (claimEvidenceTraceMatrix.status === "complete") linksWithCompleteClaimEvidenceTraceMatrix += 1;
    claimEvidenceTraceMatrixIncompleteClaims += claimEvidenceTraceMatrix.incompleteClaimIds.length;
    claimEvidenceTraceMatrixUnresolvedEvidence += claimEvidenceTraceMatrix.unresolvedEvidenceIds.length;
    claimEvidenceTraceMatrixNonCompliantEvidence += claimEvidenceTraceMatrix.nonCompliantEvidenceIds.length;
  }
  for (const audit of auditLog) {
    incrementCounter(byAction, audit.action || "unknown");
  }
  for (const entry of commandLedger) {
    incrementCounter(byCommandStatus, entry.status || "unknown");
  }
  const counterDigest = buildCounterDigest({
    state,
    links,
    auditLog,
    commandLedger,
    byStatus,
    byScope,
    byActor,
    byAction,
    byCommandStatus
  });
  const claimEvidenceGapReport = buildClaimEvidenceGapReport(state, links, now);

  return {
    generatedAt: now,
    totals: {
      links: links.length,
      linked: byStatus.linked || 0,
      rejected: byAction["claim-evidence-link.rejected"] || 0,
      replayed: byAction["claim-evidence-link.replayed"] || 0,
      recovering: byStatus.recovering || 0,
      evidence: evidenceTotal,
      auditEvents: auditLog.length,
      commands: commandLedger.length,
      commandRecoveries: byCommandStatus.recovering || 0,
      recoveryTasks: state.recoveryPlan?.taskCount || 0,
      blockingRecoveryTasks: state.recoveryPlan?.blockingTaskCount || 0,
      proofMissing: counterDigest.linkCounters.byProofStatus.missing || 0,
      proofVerified: counterDigest.linkCounters.byProofStatus.verified || 0,
      handoffReady: counterDigest.linkCounters.byHandoffStatus["export-ready"] || 0,
      handoffProviderBlocked: counterDigest.linkCounters.byHandoffStatus["provider-blocked"] || 0,
      handoffRejected: counterDigest.auditCounters.rejectedHandoffs || 0,
      handoffExported: counterDigest.auditCounters.exportedHandoffs || 0,
      failedAuditEvents: counterDigest.auditCounters.failedAuditEvents || 0,
      evidenceTraceComplete: linksWithCompleteTrace,
      evidenceTraceIncomplete: links.length - linksWithCompleteTrace,
      evidenceTraceMissingClaims,
      claimEvidenceManifestComplete: linksWithCompleteManifest,
      claimEvidenceManifestIncomplete: links.length - linksWithCompleteManifest,
      claimEvidenceManifestMissingClaims: manifestMissingClaims,
      proofArtifactCoverageComplete: linksWithCompleteProofArtifactCoverage,
      proofArtifactCoverageIncomplete: links.length - linksWithCompleteProofArtifactCoverage,
      proofArtifactCoverageUnresolvedClaims,
      proofArtifactCoverageUnresolvedArtifacts,
      claimProofIndexReady: linksWithReadyClaimProofIndex,
      claimProofIndexDegraded: links.length - linksWithReadyClaimProofIndex,
      claimProofIndexBlockedClaims,
      claimProofIndexRetryableClaims,
      artifactClaimEvidenceLinkComplete: linksWithCompleteArtifactClaimEvidenceLinks,
      artifactClaimEvidenceLinkIncomplete: links.length - linksWithCompleteArtifactClaimEvidenceLinks,
      artifactClaimEvidenceLinkUnresolvedClaims,
      artifactClaimEvidenceLinkUnresolvedEvidence,
      artifactClaimEvidenceLinkNonCompliantEvidence,
      artifactClaimEvidenceLinkMissingDigest,
      artifactClaimEvidenceLinkMissingLocator,
      claimEvidenceTraceMatrixComplete: linksWithCompleteClaimEvidenceTraceMatrix,
      claimEvidenceTraceMatrixIncomplete: links.length - linksWithCompleteClaimEvidenceTraceMatrix,
      claimEvidenceTraceMatrixIncompleteClaims,
      claimEvidenceTraceMatrixUnresolvedEvidence,
      claimEvidenceTraceMatrixNonCompliantEvidence,
      claimEvidenceGapRows: claimEvidenceGapReport.rowCount,
      claimEvidenceGapLinks: claimEvidenceGapReport.affectedLinkCount,
      claimEvidenceGapClaims: claimEvidenceGapReport.affectedClaimCount,
      claimEvidenceGapBlockers: claimEvidenceGapReport.blockerCount,
      claimEvidenceGapAttention: claimEvidenceGapReport.attentionCount,
      claimEvidenceGapUnresolvedEvidence: claimEvidenceGapReport.unresolvedEvidenceCount,
      claimEvidenceGapNonCompliantEvidence: claimEvidenceGapReport.nonCompliantEvidenceCount,
      claimEvidenceGapMissingDigestEvidence: claimEvidenceGapReport.missingDigestEvidenceCount,
      claimEvidenceGapMissingLocatorEvidence: claimEvidenceGapReport.missingLocatorEvidenceCount,
      scopes: Object.keys(byScope).length,
      actors: Object.keys(byActor).length
    },
    accessBoundary: state.accessBoundary
      ? {
        mode: state.accessBoundary.mode,
        requestedScope: state.accessBoundary.requestedScope,
        visibleLinks: state.accessBoundary.visibleLinkIds.length,
        hiddenLinks: state.accessBoundary.hiddenLinkIds.length,
        proof: state.accessBoundary.proof
      }
      : null,
    byStatus,
    byCommandStatus,
    byScope,
    byActor,
    byAction,
    counters: counterDigest,
    claimEvidenceGapReport,
    evidenceCompleteness: {
      linksWithDigest,
      linksWithUri,
      digestCoverage: links.length === 0 ? 0 : Number((linksWithDigest / links.length).toFixed(4)),
      uriCoverage: links.length === 0 ? 0 : Number((linksWithUri / links.length).toFixed(4)),
      traceCoverage: links.length === 0 ? 0 : Number((linksWithCompleteTrace / links.length).toFixed(4)),
      manifestCoverage: links.length === 0 ? 0 : Number((linksWithCompleteManifest / links.length).toFixed(4)),
      proofArtifactCoverage: links.length === 0 ? 0 : Number((linksWithCompleteProofArtifactCoverage / links.length).toFixed(4)),
      claimProofIndexReadiness: links.length === 0 ? 0 : Number((linksWithReadyClaimProofIndex / links.length).toFixed(4)),
      claimProofIndexBlockedClaims,
      claimProofIndexRetryableClaims,
      artifactClaimEvidenceLinkCoverage: links.length === 0 ? 0 : Number((linksWithCompleteArtifactClaimEvidenceLinks / links.length).toFixed(4)),
      missingClaimReferences: evidenceTraceMissingClaims,
      manifestMissingClaimReferences: manifestMissingClaims,
      unresolvedProofArtifactClaims: proofArtifactCoverageUnresolvedClaims,
      unresolvedProofArtifacts: proofArtifactCoverageUnresolvedArtifacts,
      artifactClaimEvidenceLinkUnresolvedClaims,
      artifactClaimEvidenceLinkUnresolvedEvidence,
      artifactClaimEvidenceLinkNonCompliantEvidence,
      artifactClaimEvidenceLinkMissingDigest,
      artifactClaimEvidenceLinkMissingLocator,
      claimEvidenceTraceMatrixCoverage: links.length === 0 ? 0 : Number((linksWithCompleteClaimEvidenceTraceMatrix / links.length).toFixed(4)),
      claimEvidenceTraceMatrixIncompleteClaims,
      claimEvidenceTraceMatrixUnresolvedEvidence,
      claimEvidenceTraceMatrixNonCompliantEvidence,
      claimEvidenceGapStatus: claimEvidenceGapReport.status,
      claimEvidenceGapCoverage: links.length === 0 ? 1 : Number(((links.length - claimEvidenceGapReport.affectedLinkCount) / links.length).toFixed(4)),
      claimEvidenceGapRows: claimEvidenceGapReport.rowCount,
      claimEvidenceGapLinks: claimEvidenceGapReport.affectedLinkCount,
      claimEvidenceGapClaims: claimEvidenceGapReport.affectedClaimCount,
      claimEvidenceGapBlockers: claimEvidenceGapReport.blockerCount,
      claimEvidenceGapAttention: claimEvidenceGapReport.attentionCount,
      claimEvidenceGapProof: claimEvidenceGapReport.proof
    }
  };
}

function buildTimeline(state) {
  const visibleLinkIds = new Set(linksForAccess(state, state.accessBoundary).map((link) => link.linkId));
  const scoped = state.accessBoundary?.requestedScope && !state.accessBoundary?.actor?.canBypassTenantBoundary;
  const linkEvents = Object.values(state.links || {})
    .filter((link) => !scoped || visibleLinkIds.has(link.linkId))
    .flatMap((link) => {
    const base = {
      linkId: link.linkId,
      claimId: link.claimId,
      artifactId: link.artifactId,
      scopeKey: link.scope?.scopeKey || null,
      actorId: link.actor?.actorId || null,
      proof: link.proof || null
    };
    return [
      { at: link.createdAt, type: "link-created", ...base },
      link.updatedAt && link.updatedAt !== link.createdAt ? { at: link.updatedAt, type: "link-updated", ...base } : null,
      link.recoveredAt ? { at: link.recoveredAt, type: "link-recovered", ...base } : null
    ].filter(Boolean);
  });
  const auditEvents = (Array.isArray(state.auditLog) ? state.auditLog : [])
    .filter((audit) => {
      if (!scoped) return true;
      if (audit.linkId) return visibleLinkIds.has(audit.linkId);
      return sameScope(audit.scope, state.accessBoundary.requestedScope);
    })
    .map((audit) => ({
      at: audit.at,
      type: audit.action || "audit-event",
      commandId: audit.commandId || null,
      scopedCommandId: audit.scopedCommandId || null,
      linkId: audit.linkId || null,
      scopeKey: audit.scope?.scopeKey || null,
      actorId: audit.actor?.actorId || null,
      failureId: audit.failureId || null,
      proof: audit.proof || null
    }));
  return [...linkEvents, ...auditEvents]
    .filter((event) => typeof event.at === "string")
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.type.localeCompare(right.type))
    .slice(-timelineLimit);
}

function buildExportSummary(state, analytics, timeline, now) {
  const links = linksForAccess(state, state.accessBoundary);
  const commandLedger = commandLedgerForAccess(state, state.accessBoundary);
  const exportLinks = links.map((link) => {
    const claimEvidenceManifest = evidenceManifestForLink(link);
    const claimProofIndex = buildClaimProofIndex(link, claimEvidenceManifest, link.evidenceTrace || null);
    const artifactClaimEvidenceLinks = artifactClaimEvidenceLinksForState(state, link, claimEvidenceManifest);
    const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks);
    return {
      linkId: link.linkId,
      rawLinkId: link.rawLinkId || null,
      claimId: link.claimId,
      artifactId: link.artifactId,
      status: link.status,
      scope: link.scope,
      scopeIntegrity: link.scopeIntegrity || null,
      actorId: link.actor?.actorId || null,
      evidence: summarizeEvidence(link),
      evidenceTrace: link.evidenceTrace
        ? {
          status: link.evidenceTrace.status,
          claimCount: link.evidenceTrace.claimCount,
          proofArtifactCount: link.evidenceTrace.proofArtifactCount,
          missingClaimIds: link.evidenceTrace.missingClaimIds || [],
          proof: link.evidenceTrace.proof || null
        }
        : null,
      claimEvidenceManifest,
      claimProofIndex,
      artifactClaimEvidenceLinks,
      claimEvidenceTraceMatrix,
      acceptancePreview: buildLinkAcceptancePreview({
        state,
        link,
        now,
        manifest: claimEvidenceManifest,
        claimProofIndex,
        artifactClaimEvidenceLinks,
        claimEvidenceTraceMatrix
      }),
      proof: link.proof || null,
      auditHandoff: link.auditHandoff || null,
      updatedAt: link.updatedAt
    };
  });
  const payload = {
    surfaceId,
    generatedAt: now,
    stateVersion: state.stateVersion,
    status: state.status,
    analytics: analytics.totals,
    accessBoundary: state.accessBoundary
      ? {
        contractVersion: state.accessBoundary.contractVersion,
        mode: state.accessBoundary.mode,
        requestedScope: state.accessBoundary.requestedScope,
        hiddenLinkCount: state.accessBoundary.hiddenLinkIds.length,
        proof: state.accessBoundary.proof
      }
      : null,
    links: exportLinks,
    commandLedger: commandLedger.map((entry) => ({
      commandKey: entry.commandKey,
      linkId: entry.linkId,
      status: entry.status,
      restartSafe: entry.recovery?.required !== true,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      resultProof: entry.resultProof || null
    })),
    recoveryPlan: state.recoveryPlan
      ? {
        status: state.recoveryPlan.status,
        restartSafe: state.recoveryPlan.restartSafe,
        taskCount: state.recoveryPlan.taskCount,
        blockingTaskCount: state.recoveryPlan.blockingTaskCount,
        nextTask: state.recoveryPlan.nextTask,
        proof: state.recoveryPlan.proof
      }
      : null,
    claimEvidenceGapReport: analytics.claimEvidenceGapReport
      ? {
        contractVersion: analytics.claimEvidenceGapReport.contractVersion,
        status: analytics.claimEvidenceGapReport.status,
        rowCount: analytics.claimEvidenceGapReport.rowCount,
        affectedLinkCount: analytics.claimEvidenceGapReport.affectedLinkCount,
        affectedClaimCount: analytics.claimEvidenceGapReport.affectedClaimCount,
        byReason: analytics.claimEvidenceGapReport.byReason,
        bySeverity: analytics.claimEvidenceGapReport.bySeverity,
        exportRows: analytics.claimEvidenceGapReport.exportRows,
        proof: analytics.claimEvidenceGapReport.proof
      }
      : null,
    latestTimeline: timeline.slice(-10)
  };
  return {
    format: "aios.claim-evidence-link.export.v1",
    generatedAt: now,
    recordCount: exportLinks.length,
    commandCount: commandLedger.length,
    auditEventCount: analytics.totals.auditEvents,
    scopeCount: analytics.totals.scopes,
    accessBoundary: state.accessBoundary || null,
    claimEvidenceGapReport: analytics.claimEvidenceGapReport || null,
    proof: proofHash(payload),
    payload
  };
}

function normalizeHistorySnapshot(snapshot, fallbackAt = null) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const totals = source.totals && typeof source.totals === "object" ? source.totals : {};
  const at = asIso(source.at || source.generatedAt || fallbackAt, fallbackAt || new Date().toISOString());
  return {
    at,
    status: normalizeOptionalText(source.status) || "unknown",
    totals: {
      links: normalizeNonNegativeInteger(totals.links, 0),
      linked: normalizeNonNegativeInteger(totals.linked, 0),
      rejected: normalizeNonNegativeInteger(totals.rejected, 0),
      replayed: normalizeNonNegativeInteger(totals.replayed, 0),
      recovering: normalizeNonNegativeInteger(totals.recovering, 0),
      evidence: normalizeNonNegativeInteger(totals.evidence, 0),
      auditEvents: normalizeNonNegativeInteger(totals.auditEvents, 0),
      commands: normalizeNonNegativeInteger(totals.commands, 0),
      commandRecoveries: normalizeNonNegativeInteger(totals.commandRecoveries, 0),
      recoveryTasks: normalizeNonNegativeInteger(totals.recoveryTasks, 0),
      blockingRecoveryTasks: normalizeNonNegativeInteger(totals.blockingRecoveryTasks, 0),
      proofMissing: normalizeNonNegativeInteger(totals.proofMissing, 0),
      proofVerified: normalizeNonNegativeInteger(totals.proofVerified, 0),
      handoffReady: normalizeNonNegativeInteger(totals.handoffReady, 0),
      handoffProviderBlocked: normalizeNonNegativeInteger(totals.handoffProviderBlocked, 0),
      handoffRejected: normalizeNonNegativeInteger(totals.handoffRejected, 0),
      handoffExported: normalizeNonNegativeInteger(totals.handoffExported, 0),
      failedAuditEvents: normalizeNonNegativeInteger(totals.failedAuditEvents, 0),
      evidenceTraceComplete: normalizeNonNegativeInteger(totals.evidenceTraceComplete, 0),
      evidenceTraceIncomplete: normalizeNonNegativeInteger(totals.evidenceTraceIncomplete, 0),
      evidenceTraceMissingClaims: normalizeNonNegativeInteger(totals.evidenceTraceMissingClaims, 0),
      claimEvidenceManifestComplete: normalizeNonNegativeInteger(totals.claimEvidenceManifestComplete, 0),
      claimEvidenceManifestIncomplete: normalizeNonNegativeInteger(totals.claimEvidenceManifestIncomplete, 0),
      claimEvidenceManifestMissingClaims: normalizeNonNegativeInteger(totals.claimEvidenceManifestMissingClaims, 0),
      claimProofIndexReady: normalizeNonNegativeInteger(totals.claimProofIndexReady, 0),
      claimProofIndexDegraded: normalizeNonNegativeInteger(totals.claimProofIndexDegraded, 0),
      claimProofIndexBlockedClaims: normalizeNonNegativeInteger(totals.claimProofIndexBlockedClaims, 0),
      claimProofIndexRetryableClaims: normalizeNonNegativeInteger(totals.claimProofIndexRetryableClaims, 0),
      artifactClaimEvidenceLinkComplete: normalizeNonNegativeInteger(totals.artifactClaimEvidenceLinkComplete, 0),
      artifactClaimEvidenceLinkIncomplete: normalizeNonNegativeInteger(totals.artifactClaimEvidenceLinkIncomplete, 0),
      artifactClaimEvidenceLinkUnresolvedClaims: normalizeNonNegativeInteger(totals.artifactClaimEvidenceLinkUnresolvedClaims, 0),
      artifactClaimEvidenceLinkUnresolvedEvidence: normalizeNonNegativeInteger(totals.artifactClaimEvidenceLinkUnresolvedEvidence, 0),
      artifactClaimEvidenceLinkNonCompliantEvidence: normalizeNonNegativeInteger(totals.artifactClaimEvidenceLinkNonCompliantEvidence, 0),
      artifactClaimEvidenceLinkMissingDigest: normalizeNonNegativeInteger(totals.artifactClaimEvidenceLinkMissingDigest, 0),
      artifactClaimEvidenceLinkMissingLocator: normalizeNonNegativeInteger(totals.artifactClaimEvidenceLinkMissingLocator, 0),
      claimEvidenceTraceMatrixComplete: normalizeNonNegativeInteger(totals.claimEvidenceTraceMatrixComplete, 0),
      claimEvidenceTraceMatrixIncomplete: normalizeNonNegativeInteger(totals.claimEvidenceTraceMatrixIncomplete, 0),
      claimEvidenceTraceMatrixIncompleteClaims: normalizeNonNegativeInteger(totals.claimEvidenceTraceMatrixIncompleteClaims, 0),
      claimEvidenceTraceMatrixUnresolvedEvidence: normalizeNonNegativeInteger(totals.claimEvidenceTraceMatrixUnresolvedEvidence, 0),
      claimEvidenceTraceMatrixNonCompliantEvidence: normalizeNonNegativeInteger(totals.claimEvidenceTraceMatrixNonCompliantEvidence, 0),
      claimEvidenceGapRows: normalizeNonNegativeInteger(totals.claimEvidenceGapRows, 0),
      claimEvidenceGapLinks: normalizeNonNegativeInteger(totals.claimEvidenceGapLinks, 0),
      claimEvidenceGapClaims: normalizeNonNegativeInteger(totals.claimEvidenceGapClaims, 0),
      claimEvidenceGapBlockers: normalizeNonNegativeInteger(totals.claimEvidenceGapBlockers, 0),
      claimEvidenceGapAttention: normalizeNonNegativeInteger(totals.claimEvidenceGapAttention, 0),
      claimEvidenceGapUnresolvedEvidence: normalizeNonNegativeInteger(totals.claimEvidenceGapUnresolvedEvidence, 0),
      claimEvidenceGapNonCompliantEvidence: normalizeNonNegativeInteger(totals.claimEvidenceGapNonCompliantEvidence, 0),
      claimEvidenceGapMissingDigestEvidence: normalizeNonNegativeInteger(totals.claimEvidenceGapMissingDigestEvidence, 0),
      claimEvidenceGapMissingLocatorEvidence: normalizeNonNegativeInteger(totals.claimEvidenceGapMissingLocatorEvidence, 0),
      scopes: normalizeNonNegativeInteger(totals.scopes, 0),
      actors: normalizeNonNegativeInteger(totals.actors, 0),
      handoffQueueDepth: normalizeNonNegativeInteger(totals.handoffQueueDepth, 0),
      exported: normalizeNonNegativeInteger(totals.exported, 0)
    },
    proof: normalizeOptionalText(source.proof)
  };
}

function deltaTotals(current, previous = {}) {
  const keys = [
    "links",
    "linked",
    "rejected",
    "replayed",
    "recovering",
    "evidence",
    "auditEvents",
    "commands",
    "commandRecoveries",
    "recoveryTasks",
    "blockingRecoveryTasks",
    "proofMissing",
    "proofVerified",
    "handoffReady",
    "handoffProviderBlocked",
    "handoffRejected",
    "handoffExported",
    "failedAuditEvents",
    "evidenceTraceComplete",
    "evidenceTraceIncomplete",
    "evidenceTraceMissingClaims",
    "claimEvidenceManifestComplete",
    "claimEvidenceManifestIncomplete",
    "claimEvidenceManifestMissingClaims",
    "claimProofIndexReady",
    "claimProofIndexDegraded",
    "claimProofIndexBlockedClaims",
    "claimProofIndexRetryableClaims",
    "artifactClaimEvidenceLinkComplete",
    "artifactClaimEvidenceLinkIncomplete",
    "artifactClaimEvidenceLinkUnresolvedClaims",
    "artifactClaimEvidenceLinkUnresolvedEvidence",
    "artifactClaimEvidenceLinkNonCompliantEvidence",
    "artifactClaimEvidenceLinkMissingDigest",
    "artifactClaimEvidenceLinkMissingLocator",
    "claimEvidenceTraceMatrixComplete",
    "claimEvidenceTraceMatrixIncomplete",
    "claimEvidenceTraceMatrixIncompleteClaims",
    "claimEvidenceTraceMatrixUnresolvedEvidence",
    "claimEvidenceTraceMatrixNonCompliantEvidence",
    "claimEvidenceGapRows",
    "claimEvidenceGapLinks",
    "claimEvidenceGapClaims",
    "claimEvidenceGapBlockers",
    "claimEvidenceGapAttention",
    "claimEvidenceGapUnresolvedEvidence",
    "claimEvidenceGapNonCompliantEvidence",
    "claimEvidenceGapMissingDigestEvidence",
    "claimEvidenceGapMissingLocatorEvidence",
    "scopes",
    "actors",
    "handoffQueueDepth",
    "exported"
  ];
  return Object.fromEntries(keys.map((key) => [key, normalizeNonNegativeInteger(current?.[key], 0) - normalizeNonNegativeInteger(previous?.[key], 0)]));
}

function buildAnalyticsHistoryState(state, analytics, exportSummary, now) {
  const prior = (Array.isArray(state.historySnapshots) ? state.historySnapshots : [])
    .map((item) => normalizeHistorySnapshot(item, now))
    .filter((item) => typeof item.at === "string")
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const exported = linksForAccess(state, state.accessBoundary)
    .filter((link) => Boolean(link.auditHandoff?.exportedAt)).length;
  const handoffQueueDepth = state.integration?.externalHandoff?.queueDepth || 0;
  const current = normalizeHistorySnapshot({
    at: now,
    status: state.status,
    totals: {
      ...analytics.totals,
      handoffQueueDepth,
      exported,
      recoveryTasks: state.recoveryPlan?.taskCount || analytics.totals.recoveryTasks || 0,
      blockingRecoveryTasks: state.recoveryPlan?.blockingTaskCount || analytics.totals.blockingRecoveryTasks || 0
    },
    proof: exportSummary.proof
  }, now);
  const previous = prior.length > 0 ? prior[prior.length - 1] : null;
  const first = prior.length > 0 ? prior[0] : current;
  const window = [...prior.filter((item) => item.at !== current.at), current].slice(-historyLimit);
  const statusCounts = {};
  for (const item of window) incrementCounter(statusCounts, item.status || "unknown");
  const deltas = {
    sincePrevious: deltaTotals(current.totals, previous?.totals),
    sinceWindowStart: deltaTotals(current.totals, first?.totals)
  };
  const payload = {
    surfaceId,
    generatedAt: now,
    current,
    previous,
    windowStart: first,
    deltas,
    statusCounts,
    exportProof: exportSummary.proof,
    accessBoundaryProof: state.accessBoundary?.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.analytics-history.v1",
    generatedAt: now,
    current,
    previous,
    window,
    windowSize: window.length,
    windowLimit: historyLimit,
    deltas,
    statusCounts,
    proof: proofHash(payload)
  };
}

function buildTimelineReportState(state, timeline, analyticsHistory, now) {
  const recent = Array.isArray(timeline) ? timeline.slice(-12) : [];
  const latestByLink = new Map();
  for (const event of recent) {
    if (event.linkId) latestByLink.set(event.linkId, event);
  }
  const eventCounts = {};
  const eventBands = {};
  const eventsByScope = {};
  const failureEvents = [];
  const handoffEvents = [];
  for (const event of timeline || []) {
    incrementCounter(eventCounts, event.type || "unknown");
    incrementCounter(eventBands, timelineEventBand(event));
    incrementCounter(eventsByScope, event.scopeKey || "unscoped");
    if (event.failureId) failureEvents.push(event);
    if ((event.type || "").includes("handoff")) handoffEvents.push(event);
  }
  const report = {
    contractVersion: "aios.claim-evidence-link.timeline-report.v1",
    generatedAt: now,
    eventCount: Array.isArray(timeline) ? timeline.length : 0,
    earliestAt: timeline?.[0]?.at || null,
    latestAt: timeline?.[timeline.length - 1]?.at || null,
    recent,
    eventCounts,
    eventBands,
    eventsByScope,
    failureEvents: failureEvents.slice(-8).map((event) => ({
      at: event.at,
      type: event.type,
      commandId: event.commandId || null,
      linkId: event.linkId || null,
      failureId: event.failureId || null
    })),
    handoffEvents: handoffEvents.slice(-8).map((event) => ({
      at: event.at,
      type: event.type,
      linkId: event.linkId || null,
      commandId: event.commandId || null,
      proof: event.proof || null
    })),
    latestByLink: [...latestByLink.values()].map((event) => ({
      linkId: event.linkId,
      type: event.type,
      at: event.at,
      proof: event.proof || null
    })),
    historyProof: analyticsHistory.proof,
    accessBoundaryProof: state.accessBoundary?.proof || null
  };
  return {
    ...report,
    proof: proofHash(report)
  };
}

function buildAnalyticsExportManifest(state, analytics, analyticsHistory, timelineReport, exportReadiness, now) {
  const providerContract = state.integration?.providerContract || {};
  const providerRuntime = state.integration?.providerRuntime || {};
  const externalHandoff = state.integration?.externalHandoff || {};
  const providerHandoffBatch = externalHandoff.providerHandoffBatch || {};
  const sections = [
    {
      key: "links",
      contractVersion: "aios.claim-evidence-link.export.links.v1",
      recordCount: analytics.totals.links,
      proof: proofHash({ surfaceId, key: "links", totals: analytics.totals, byStatus: analytics.byStatus })
    },
    {
      key: "commands",
      contractVersion: "aios.claim-evidence-link.export.commands.v1",
      recordCount: analytics.totals.commands,
      proof: proofHash({ surfaceId, key: "commands", counters: analytics.counters?.commandCounters })
    },
    {
      key: "timeline",
      contractVersion: timelineReport.contractVersion,
      recordCount: timelineReport.eventCount,
      proof: timelineReport.proof
    },
    {
      key: "history",
      contractVersion: analyticsHistory.contractVersion,
      recordCount: analyticsHistory.windowSize,
      proof: analyticsHistory.proof
    },
    {
      key: "claimEvidenceGaps",
      contractVersion: analytics.claimEvidenceGapReport?.contractVersion || "aios.claim-evidence-link.claim-evidence-gap-report.v1",
      recordCount: analytics.claimEvidenceGapReport?.rowCount || 0,
      proof: analytics.claimEvidenceGapReport?.proof || null
    },
    {
      key: "handoff",
      contractVersion: "aios.claim-evidence-link.export.handoff.v1",
      recordCount: analytics.counters?.handoffCounters?.pendingExport || 0,
      proof: externalHandoff.proof || null
    },
    {
      key: "providerHandoffBatch",
      contractVersion: providerHandoffBatch.contractVersion || "aios.claim-evidence-link.provider-handoff-batch.v1",
      recordCount: providerHandoffBatch.rows?.length || 0,
      proof: providerHandoffBatch.proof || null
    }
  ];
  const payload = {
    surfaceId,
    generatedAt: now,
    sections: sections.map((section) => ({
      key: section.key,
      recordCount: section.recordCount,
      proof: section.proof
    })),
    readinessStatus: exportReadiness.status,
    accessBoundaryProof: state.accessBoundary?.proof || null,
    providerContractProof: providerContract.proof || null,
    providerRuntimeProof: providerRuntime.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.analytics-export-manifest.v1",
    generatedAt: now,
    status: exportReadiness.status,
    ready: exportReadiness.ready,
    sections,
    counters: {
      links: analytics.totals.links,
      commands: analytics.totals.commands,
      timelineEvents: timelineReport.eventCount,
      historySnapshots: analyticsHistory.windowSize,
      claimEvidenceGapRows: analytics.claimEvidenceGapReport?.rowCount || 0,
      claimEvidenceGapLinks: analytics.claimEvidenceGapReport?.affectedLinkCount || 0,
      claimEvidenceGapClaims: analytics.claimEvidenceGapReport?.affectedClaimCount || 0,
      handoffPending: analytics.counters?.handoffCounters?.pendingExport || 0,
      providerHandoffExportable: providerHandoffBatch.counts?.exportable || 0,
      providerHandoffDegraded: providerHandoffBatch.counts?.degraded || 0,
      providerHandoffBlocked: providerHandoffBatch.counts?.blocked || 0,
      handoffExported: analytics.counters?.handoffCounters?.exported || 0,
      failureEvents: timelineReport.failureEvents.length
    },
    routes: {
      export: "/artifact-filesystem/claim-evidence-link/export",
      timeline: "/artifact-filesystem/claim-evidence-link/timeline",
      handoff: "/artifact-filesystem/claim-evidence-link/handoff"
    },
    blockers: exportReadiness.blockers,
    proof: proofHash(payload)
  };
}

function buildExportReadinessSummary(state, analyticsHistory, timelineReport, now) {
  const handoff = state.integration?.externalHandoff || {};
  const providerHandoffBatch = handoff.providerHandoffBatch || {};
  const providerRuntime = state.integration?.providerRuntime || {};
  const blockers = [
    state.lifecycle?.enabled === false ? "lifecycle-disabled" : null,
    state.integration?.providerContract?.ready !== true ? "provider-contract-not-ready" : null,
    providerRuntime.readyForHandoff === false ? "provider-runtime-not-ready" : null,
    handoff.status === "blocked" ? "handoff-blocked" : null,
    providerHandoffBatch.status === "blocked" ? "provider-handoff-batch-blocked" : null,
    state.recoveryPlan?.blockingTaskCount > 0 ? "restart-recovery-required" : null,
    state.scopeIntegrity?.quarantinedLinkCount > 0 ? "scope-integrity-quarantine" : null,
    (analyticsHistory.current.totals.claimEvidenceManifestIncomplete || 0) > 0 ? "claim-evidence-manifest-incomplete" : null,
    (analyticsHistory.current.totals.claimProofIndexDegraded || 0) > 0 ? "claim-proof-index-degraded" : null,
    (analyticsHistory.current.totals.claimProofIndexBlockedClaims || 0) > 0 ? "claim-proof-index-blocked" : null,
    (analyticsHistory.current.totals.artifactClaimEvidenceLinkIncomplete || 0) > 0 ? "artifact-claim-evidence-link-incomplete" : null,
    (analyticsHistory.current.totals.claimEvidenceTraceMatrixIncomplete || 0) > 0 ? "claim-evidence-trace-matrix-incomplete" : null,
    (analyticsHistory.current.totals.claimEvidenceGapBlockers || 0) > 0 ? "claim-evidence-gap-blockers" : null,
    (analyticsHistory.current.totals.linked || 0) === 0 ? "no-linked-records" : null
  ].filter(Boolean);
  const payload = {
    surfaceId,
    generatedAt: now,
    blockers,
    queueDepth: handoff.queueDepth || 0,
    exported: analyticsHistory.current.totals.exported || 0,
    timelineProof: timelineReport.proof,
    historyProof: analyticsHistory.proof,
    providerRuntimeProof: providerRuntime.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.export-readiness.v1",
    generatedAt: now,
    ready: blockers.length === 0,
    status: blockers.length === 0
      ? "ready"
      : blockers.includes("provider-runtime-not-ready")
        || blockers.includes("provider-contract-not-ready")
        || blockers.includes("restart-recovery-required")
        || blockers.includes("claim-evidence-gap-blockers")
        ? "blocked"
        : "attention",
    blockers,
    counters: {
      pendingHandoff: handoff.queueDepth || 0,
      providerHandoffExportable: providerHandoffBatch.counts?.exportable || 0,
      providerHandoffDegraded: providerHandoffBatch.counts?.degraded || 0,
      providerHandoffBlocked: providerHandoffBatch.counts?.blocked || 0,
      exported: analyticsHistory.current.totals.exported || 0,
      linked: analyticsHistory.current.totals.linked || 0,
      claimEvidenceManifestIncomplete: analyticsHistory.current.totals.claimEvidenceManifestIncomplete || 0,
      claimProofIndexDegraded: analyticsHistory.current.totals.claimProofIndexDegraded || 0,
      claimProofIndexBlockedClaims: analyticsHistory.current.totals.claimProofIndexBlockedClaims || 0,
      claimProofIndexRetryableClaims: analyticsHistory.current.totals.claimProofIndexRetryableClaims || 0,
      artifactClaimEvidenceLinkIncomplete: analyticsHistory.current.totals.artifactClaimEvidenceLinkIncomplete || 0,
      artifactClaimEvidenceLinkNonCompliantEvidence: analyticsHistory.current.totals.artifactClaimEvidenceLinkNonCompliantEvidence || 0,
      claimEvidenceTraceMatrixIncomplete: analyticsHistory.current.totals.claimEvidenceTraceMatrixIncomplete || 0,
      claimEvidenceTraceMatrixIncompleteClaims: analyticsHistory.current.totals.claimEvidenceTraceMatrixIncompleteClaims || 0,
      claimEvidenceTraceMatrixUnresolvedEvidence: analyticsHistory.current.totals.claimEvidenceTraceMatrixUnresolvedEvidence || 0,
      claimEvidenceGapRows: analyticsHistory.current.totals.claimEvidenceGapRows || 0,
      claimEvidenceGapClaims: analyticsHistory.current.totals.claimEvidenceGapClaims || 0,
      claimEvidenceGapBlockers: analyticsHistory.current.totals.claimEvidenceGapBlockers || 0,
      timelineEvents: timelineReport.eventCount,
      historyWindow: analyticsHistory.windowSize
    },
    nextEnvelope: handoff.nextEnvelope || null,
    providerHandoffBatch: {
      status: providerHandoffBatch.status || "idle",
      providerReady: providerHandoffBatch.providerReady === true,
      nextExportableLinkId: providerHandoffBatch.nextExportableLinkId || null,
      counts: providerHandoffBatch.counts || { exportable: 0, degraded: 0, blocked: 0 },
      proof: providerHandoffBatch.proof || null
    },
    proof: proofHash(payload)
  };
}

function buildClientPreviewRows(state, now) {
  return linksForAccess(state, state.accessBoundary)
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt))
    .slice(0, 12)
    .map((link) => {
      const evidenceStats = summarizeEvidence(link);
      const claimEvidenceManifest = evidenceManifestForLink(link);
      const claimProofIndex = buildClaimProofIndex(link, claimEvidenceManifest, link.evidenceTrace || null);
      const artifactClaimEvidenceLinks = artifactClaimEvidenceLinksForState(state, link, claimEvidenceManifest);
      const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks);
      const acceptancePreview = buildLinkAcceptancePreview({
        state,
        link,
        now,
        manifest: claimEvidenceManifest,
        claimProofIndex,
        artifactClaimEvidenceLinks,
        claimEvidenceTraceMatrix
      });
      const handoffReady = link.status === "linked"
        && Boolean(link.proof)
        && claimEvidenceManifest.status === "complete"
        && artifactClaimEvidenceLinks.status === "complete"
        && claimEvidenceTraceMatrix.status === "complete"
        && state.integration?.providerContract?.ready === true;
      return {
        key: link.linkId,
        label: `${link.claimId || "unknown-claim"} -> ${link.artifactId || "unknown-artifact"}`,
        status: link.status,
        scopeKey: link.scope?.scopeKey || null,
        scopeIntegrity: link.scopeIntegrity
          ? {
            status: link.scopeIntegrity.status,
            quarantined: link.scopeIntegrity.quarantined === true,
            reasons: link.scopeIntegrity.reasons || [],
            proof: link.scopeIntegrity.proof
          }
          : null,
        actorId: link.actor?.actorId || null,
        evidence: evidenceStats,
        evidenceTrace: link.evidenceTrace
          ? {
            status: link.evidenceTrace.status,
            claimCount: link.evidenceTrace.claimCount,
            proofArtifactCount: link.evidenceTrace.proofArtifactCount,
            missingClaimCount: Array.isArray(link.evidenceTrace.missingClaimIds) ? link.evidenceTrace.missingClaimIds.length : 0,
            proof: link.evidenceTrace.proof || null
          }
          : null,
        claimEvidenceManifest: {
          status: claimEvidenceManifest.status,
          claimCount: claimEvidenceManifest.claimCount,
          completeClaimCount: claimEvidenceManifest.completeClaimCount,
          missingClaimCount: claimEvidenceManifest.missingClaimIds.length,
          proofArtifactCoverageStatus: claimEvidenceManifest.coverage?.status || "unknown",
          unresolvedProofArtifactCount: claimEvidenceManifest.coverage?.unresolvedProofArtifactIds?.length || 0,
          coverageProof: claimEvidenceManifest.coverage?.proof || null,
          claimProofIndex,
          artifactClaimEvidenceLinks,
          claimEvidenceTraceMatrix,
          proof: claimEvidenceManifest.proof
        },
        acceptancePreview,
        proofStatus: link.proof ? "verified" : "missing",
        handoffStatus: handoffReady
          ? link.auditHandoff?.exportedAt ? "exported" : "ready"
          : "blocked",
        updatedAt: link.updatedAt || link.createdAt
      };
    });
}

function buildClientValidationSummary(state, analytics, now) {
  const visibleLinkIds = new Set(linksForAccess(state, state.accessBoundary).map((link) => link.linkId));
  const scoped = state.accessBoundary?.requestedScope && !state.accessBoundary?.actor?.canBypassTenantBoundary;
  const operationalErrors = (Array.isArray(state.operationalHealth?.errors) ? state.operationalHealth.errors : [])
    .filter((error) => !scoped || !error.linkId || visibleLinkIds.has(error.linkId));
  const rejectedAudits = auditLogForAccess(state, state.accessBoundary)
    .filter((audit) => audit.action === "claim-evidence-link.rejected" || audit.action === "claim-evidence-link.lifecycle.rejected")
    .slice(-5);
  const blockers = [
    ...(state.lifecycle?.enabled === false ? [{
      code: "AFS_CEL_LIFECYCLE_DISABLED",
      path: "lifecycle.enabled",
      message: "Lifecycle controls are disabled",
      remediation: "Enable lifecycle controls before accepting new claim-evidence links."
    }] : []),
    ...(state.recoveryPlan?.blockingTaskCount > 0 ? [{
      code: "AFS_CEL_RESTART_RECOVERY_REQUIRED",
      path: "recoveryPlan",
      message: "Restart recovery tasks must be resolved before this surface is restart-safe",
      remediation: state.recoveryPlan.nextTask?.reason || "Replay the original scoped command or repair the persisted link/ledger record."
    }] : []),
    ...operationalErrors.map((error) => ({
      code: error.code,
      path: error.linkId ? `links.${error.linkId}` : "operationalHealth",
      message: error.remediation || "Operational health requires attention",
      remediation: error.remediation || "Review the operational health error and repair the affected link."
    })),
    ...rejectedAudits.flatMap((audit) => Array.isArray(audit.actionableErrors) ? audit.actionableErrors : [])
  ];
  const warnings = [];
  if (state.integration?.providerContract?.ready === false) {
    const missingServiceRequirements = state.integration.providerContract.serviceContract?.missingServiceRequirements || [];
    warnings.push({
      code: "AFS_CEL_PROVIDER_NOT_READY",
      path: "integration.providerContract",
      message: missingServiceRequirements.length > 0
        ? "Provider service contract is missing required endpoint metadata"
        : "Provider contract is missing required capabilities",
      remediation: missingServiceRequirements.length > 0
        ? "Negotiate claim-write, proof-verification, audit-handoff, and cursor-ack routes before accepting external handoff."
        : "Negotiate a provider contract with claim-link.write, audit-handoff.export, and proof.verify.",
      missingRequiredCapabilities: state.integration.providerContract.missingRequiredCapabilities || [],
      missingServiceRequirements
    });
  }
  if (state.integration?.providerRuntime?.degraded) {
    const runtime = state.integration.providerRuntime;
    warnings.push({
      code: runtime.readyForWrites ? "AFS_CEL_PROVIDER_DEGRADED" : "AFS_CEL_PROVIDER_UNAVAILABLE",
      path: "integration.providerRuntime",
      message: runtime.message || "Provider runtime is degraded",
      remediation: runtime.readyForWrites
        ? "Retry provider health before exporting claim-evidence handoff data."
        : "Restore provider runtime health before accepting hosted-kernel write or handoff commands.",
      retry: runtime.nextRetry || null,
      proof: runtime.proof
    });
  }
  if (state.scopeIntegrity?.quarantinedLinkCount > 0) {
    warnings.push({
      code: "AFS_CEL_SCOPE_INTEGRITY_QUARANTINE",
      path: "links.scopeIntegrity",
      message: "Some persisted links have tenant/workspace scope metadata that is missing or internally inconsistent",
      remediation: "Repair quarantined link records before exposing them to scoped callers or audit handoff export.",
      quarantinedLinkCount: state.scopeIntegrity.quarantinedLinkCount,
      reasonCounts: state.scopeIntegrity.reasonCounts || {},
      proof: state.scopeIntegrity.proof
    });
  }
  if ((analytics?.evidenceCompleteness?.digestCoverage || 0) < 1) {
    warnings.push({
      code: "AFS_CEL_PARTIAL_DIGEST_COVERAGE",
      path: "links.evidence.digest",
      message: "Some linked evidence does not include digests",
      remediation: "Attach digests to evidence before enabling strict digest lifecycle policy."
    });
  }
  if ((analytics?.evidenceCompleteness?.traceCoverage || 0) < 1 && (analytics?.totals?.links || 0) > 0) {
    warnings.push({
      code: "AFS_CEL_PARTIAL_EVIDENCE_TRACE_COVERAGE",
      path: "links.evidenceTrace",
      message: "Some linked claims do not have a complete claim-to-proof-artifact trace",
      remediation: "Replay or repair affected links so each claim lists at least one required proof artifact.",
      missingClaimReferences: analytics?.evidenceCompleteness?.missingClaimReferences || 0
    });
  }
  if ((analytics?.evidenceCompleteness?.manifestCoverage || 0) < 1 && (analytics?.totals?.links || 0) > 0) {
    warnings.push({
      code: "AFS_CEL_PARTIAL_CLAIM_EVIDENCE_MANIFEST_COVERAGE",
      path: "links.claimEvidenceManifest",
      message: "Some linked claims do not expose a complete per-claim proof artifact manifest",
      remediation: "Replay or repair affected links so handoff exports include claimEvidenceManifest.claims with requiredProofArtifactIds.",
      missingClaimReferences: analytics?.evidenceCompleteness?.manifestMissingClaimReferences || 0
    });
  }
  if ((analytics?.evidenceCompleteness?.proofArtifactCoverage || 0) < 1 && (analytics?.totals?.links || 0) > 0) {
    warnings.push({
      code: "AFS_CEL_PARTIAL_CLAIM_PROOF_ARTIFACT_COVERAGE",
      path: "links.claimEvidenceManifest.coverage",
      message: "Some linked claims cannot trace every required proof artifact to a resolved evidence reference",
      remediation: "Repair claimEvidenceManifest.coverage so every claim lists resolvedProofArtifactIds for all requiredProofArtifactIds before handoff export.",
      unresolvedClaimReferences: analytics?.evidenceCompleteness?.unresolvedProofArtifactClaims || 0,
      unresolvedProofArtifacts: analytics?.evidenceCompleteness?.unresolvedProofArtifacts || 0
    });
  }
  if ((analytics?.evidenceCompleteness?.artifactClaimEvidenceLinkCoverage || 0) < 1 && (analytics?.totals?.links || 0) > 0) {
    warnings.push({
      code: "AFS_CEL_PARTIAL_ARTIFACT_CLAIM_EVIDENCE_LINK_COVERAGE",
      path: "links.artifactClaimEvidenceLinks",
      message: "Some artifact claim evidence links are unresolved or missing required evidence locator metadata",
      remediation: "Repair artifactClaimEvidenceLinks so every required evidence ref has a URI or digest, and a digest when strict lifecycle policy requires one.",
      unresolvedClaimReferences: analytics?.evidenceCompleteness?.artifactClaimEvidenceLinkUnresolvedClaims || 0,
      unresolvedEvidenceReferences: analytics?.evidenceCompleteness?.artifactClaimEvidenceLinkUnresolvedEvidence || 0,
      nonCompliantEvidenceReferences: analytics?.evidenceCompleteness?.artifactClaimEvidenceLinkNonCompliantEvidence || 0,
      missingDigestReferences: analytics?.evidenceCompleteness?.artifactClaimEvidenceLinkMissingDigest || 0,
      missingLocatorReferences: analytics?.evidenceCompleteness?.artifactClaimEvidenceLinkMissingLocator || 0
    });
  }
  if ((analytics?.evidenceCompleteness?.claimEvidenceTraceMatrixCoverage || 0) < 1 && (analytics?.totals?.links || 0) > 0) {
    warnings.push({
      code: "AFS_CEL_PARTIAL_CLAIM_EVIDENCE_TRACE_MATRIX_COVERAGE",
      path: "links.claimEvidenceTraceMatrix",
      message: "Some claims do not have complete claim-to-evidence trace matrix edges",
      remediation: "Repair claimEvidenceTraceMatrix rows so every declared claim has linked evidence edges with required locator metadata.",
      incompleteClaimReferences: analytics?.evidenceCompleteness?.claimEvidenceTraceMatrixIncompleteClaims || 0,
      unresolvedEvidenceReferences: analytics?.evidenceCompleteness?.claimEvidenceTraceMatrixUnresolvedEvidence || 0,
      nonCompliantEvidenceReferences: analytics?.evidenceCompleteness?.claimEvidenceTraceMatrixNonCompliantEvidence || 0
    });
  }
  if ((analytics?.claimEvidenceGapReport?.rowCount || 0) > 0) {
    warnings.push({
      code: analytics.claimEvidenceGapReport.status === "blocked"
        ? "AFS_CEL_CLAIM_EVIDENCE_GAPS_BLOCK_HANDOFF"
        : "AFS_CEL_CLAIM_EVIDENCE_GAPS_NEED_REVIEW",
      path: "analytics.claimEvidenceGapReport",
      message: "Some claims have unresolved proof artifact or evidence locator gaps",
      remediation: "Use claimEvidenceGapReport.exportRows to repair each affected claim before relying on audit handoff completeness.",
      status: analytics.claimEvidenceGapReport.status,
      affectedLinkCount: analytics.claimEvidenceGapReport.affectedLinkCount,
      affectedClaimCount: analytics.claimEvidenceGapReport.affectedClaimCount,
      blockerCount: analytics.claimEvidenceGapReport.blockerCount,
      attentionCount: analytics.claimEvidenceGapReport.attentionCount,
      byReason: analytics.claimEvidenceGapReport.byReason,
      proof: analytics.claimEvidenceGapReport.proof
    });
  }
  if (state.accessBoundary?.isolation?.hiddenLinkCount > 0) {
    warnings.push({
      code: "AFS_CEL_SCOPE_FILTERED",
      path: "accessBoundary",
      message: "Tenant/workspace boundary filtering is hiding links outside the requested scope",
      remediation: "Use a kernel-admin actor only for explicit cross-scope audit exports."
    });
  }
  return {
    checkedAt: now,
    valid: blockers.length === 0,
    severity: blockers.length > 0 ? "blocker" : warnings.length > 0 ? "warning" : "clear",
    counts: {
      blockers: blockers.length,
      warnings: warnings.length,
      linked: analytics?.totals?.linked || 0,
      rejected: analytics?.totals?.rejected || 0,
      evidence: analytics?.totals?.evidence || 0
    },
    blockers,
    warnings
  };
}

function previewClaimEvidenceAcceptance(state, command = {}, now, input = {}) {
  const errors = [];
  const commandId = normalizeText(command.commandId || command.id, "commandId", errors);
  const claimId = normalizeText(command.claimId, "claimId", errors);
  const artifactId = normalizeText(command.artifactId, "artifactId", errors);
  const scope = normalizeScope(command.scope || {
    tenantId: command.tenantId || input.tenantId,
    workspaceId: command.workspaceId || input.workspaceId
  }, errors);
  const actor = normalizeActor(command.actor || input.actor || {}, errors);
  const evidence = normalizeEvidence(command.evidence, errors);
  const claimIds = normalizeClaimSet(claimId, command, errors);
  const rawLinkId = command.linkId || (claimId && artifactId ? `${claimId}::${artifactId}` : null);
  const linkId = scopedLinkId(scope, rawLinkId);
  const evidenceTrace = buildEvidenceTrace({ claimIds, artifactId, evidence, scope, linkId, errors });
  const claimEvidenceManifest = buildClaimEvidenceManifest({ linkId, artifactId, scope, evidenceTrace }, evidenceTrace);
  const claimProofIndex = buildClaimProofIndex({ linkId, artifactId, scope, evidence, evidenceTrace }, claimEvidenceManifest, evidenceTrace);
  const artifactClaimEvidenceLinks = buildArtifactClaimEvidenceLinks({
    linkId,
    artifactId,
    evidence,
    scope,
    evidenceTrace
  }, claimEvidenceManifest, evidenceTrace, evidenceReferencePolicyForState(state));
  const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix({
    linkId,
    claimId,
    artifactId,
    evidence,
    scope,
    evidenceTrace
  }, artifactClaimEvidenceLinks);
  const commandKey = scopedCommandId(scope, commandId);
  const existingLedger = commandKey ? state.commandLedger?.[commandKey] : null;
  const existingLink = existingLedger?.linkId ? state.links?.[existingLedger.linkId] || null : linkId ? state.links?.[linkId] || null : null;
  const boundaryConflict = rawLinkId ? findBoundaryConflict(state, scope, rawLinkId) : null;

  if (!linkId) errors.push("linkId could not be derived");
  if (state.lifecycle?.enabled === false) errors.push("surface is disabled by lifecycle controls");
  if (state.integration?.providerRuntime?.readyForWrites === false) {
    errors.push("provider runtime is not ready for claim evidence writes");
  }
  if (evidence.length > (state.lifecycle?.settings?.maxEvidenceItems || defaultLifecycleSettings.maxEvidenceItems)) {
    errors.push(`evidence count ${evidence.length} exceeds lifecycle maxEvidenceItems ${state.lifecycle.settings.maxEvidenceItems}`);
  }
  if (state.lifecycle?.settings?.requireEvidenceDigest && evidence.some((item) => !item.digest)) {
    errors.push("evidence digest is required by lifecycle settings");
  }
  if (actor.actorId && !actor.hasLinkPermission) {
    errors.push(`actor ${actor.actorId} is not permitted to link claim evidence`);
  }
  if (boundaryConflict) errors.push(boundaryConflict.reason);

  const failure = errors.length > 0
    ? buildFailureEnvelope({
      now,
      commandId,
      scopedCommandId: commandKey,
      scope,
      actor,
      errors,
      boundaryConflict,
      retryAttempt: normalizeAttempt(command.retryAttempt ?? input.retryAttempt)
    })
    : null;
  const projectedLink = linkId && errors.length === 0
    ? {
      linkId,
      rawLinkId,
      claimId,
      artifactId,
      scope,
      actorId: actor.actorId,
      evidence: summarizeEvidence({ evidence }),
      evidenceTrace: {
        status: evidenceTrace.status,
        claimCount: evidenceTrace.claimCount,
        proofArtifactCount: evidenceTrace.proofArtifactCount,
        missingClaimIds: evidenceTrace.missingClaimIds,
        proof: evidenceTrace.proof
      },
      claimEvidenceManifest,
      claimProofIndex,
      artifactClaimEvidenceLinks,
      claimEvidenceTraceMatrix,
      proofPreview: proofHash({ surfaceId, linkId, claimId, artifactId, evidence, evidenceTrace, claimEvidenceManifest, claimProofIndex, artifactClaimEvidenceLinks, claimEvidenceTraceMatrix, scope, actorId: actor.actorId }),
      handoffEligible: state.integration?.providerContract?.ready === true
    }
    : null;
  return {
    contractVersion: "aios.claim-evidence-link.acceptance-preview.v1",
    checkedAt: now,
    mode: existingLedger ? "idempotent-replay" : existingLink ? "replace-visible-link" : "new-link",
    accepted: errors.length === 0,
    commandKey: commandKey || null,
    linkId: linkId || null,
    projectedLink,
    existing: existingLink
      ? {
        linkId: existingLink.linkId,
        status: existingLink.status,
        proof: existingLink.proof || null,
        updatedAt: existingLink.updatedAt || null
      }
      : null,
    validation: {
      valid: errors.length === 0,
      errors,
      actionableErrors: failure?.actionableErrors || []
    },
    route: {
      method: "POST",
      path: "/artifact-filesystem/claim-evidence-link/commands",
      payloadContract: "aios.claim-evidence-link.command.v1"
    },
    proof: proofHash({
      surfaceId,
      checkedAt: now,
      commandKey: commandKey || null,
      linkId: linkId || null,
      accepted: errors.length === 0,
      errorCodes: failure?.actionableErrors?.map((error) => error.code) || [],
      projectedProof: projectedLink?.proofPreview || null
    })
  };
}

function buildClientAcceptanceContract(state, validationSummary, now, input = {}) {
  const hasCommandDraft = input.command && typeof input.command === "object";
  const commandPreview = hasCommandDraft
    ? previewClaimEvidenceAcceptance(state, input.command, now, input)
    : null;
  const providerRuntime = state.integration?.providerRuntime || {};
  const disabledReasons = [
    validationSummary.valid ? null : "validation-blockers-present",
    state.lifecycle?.enabled === false ? "lifecycle-disabled" : null,
    providerRuntime.readyForWrites === false ? "provider-runtime-not-ready" : null
  ].filter(Boolean);
  const ready = disabledReasons.length === 0;
  return {
    contractVersion: "aios.claim-evidence-link.client-acceptance.v1",
    generatedAt: now,
    ready,
    status: ready ? "accepting" : "blocked",
    disabledReasons,
    commandDraft: commandPreview,
    requirements: {
      commandId: "stable per tenant/workspace for idempotent replay",
      scope: ["scope.tenantId", "scope.workspaceId"],
      actor: ["actor.actorId", "actor.roles"],
      evidence: {
        minItems: 1,
        maxItems: state.lifecycle?.settings?.maxEvidenceItems || defaultLifecycleSettings.maxEvidenceItems,
        digestRequired: state.lifecycle?.settings?.requireEvidenceDigest === true,
        claimTrace: "each claim must resolve to at least one evidence item; evidence.claimIds can target specific claims and omitted claimIds apply the artifact to all command claims"
      },
      permittedRoles: [...permittedLinkRoles]
    },
    postAccept: {
      route: "/artifact-filesystem/claim-evidence-link/commands",
      creates: "state.links[scopedLinkId]",
      auditAction: "claim-evidence-link.linked",
      proofContract: "fnv1a32 stable proof over surface, link, claim, artifact, evidence, scope, and actor",
      nextReadableContracts: [
        "state.clientReview.preview",
        "state.clientWorkflow.resume",
        "state.integration.externalHandoff.nextEnvelope",
        "state.exportSummary.readiness"
      ]
    },
    proof: proofHash({
      surfaceId,
      generatedAt: now,
      ready,
      disabledReasons,
      commandPreviewProof: commandPreview?.proof || null,
      validationCounts: validationSummary.counts
    })
  };
}

function normalizeClientRequestContext(input = {}, state = {}) {
  const source = input.clientRequest || input.requestContext || input.client || {};
  const command = input.command && typeof input.command === "object" ? input.command : {};
  const requestId = firstText(source.requestId, input.requestId, command.requestId, command.commandId, command.id)
    || proofHash({ surfaceId, at: state.updatedAt || state.recoveredAt || null, cursor: state.integration?.sync?.cursor || null });
  const selectedLinkId = firstText(source.selectedLinkId, command.linkId, input.selectedLinkId);
  const workflowMode = clientWorkflowModes.has(source.workflowMode) ? source.workflowMode : "review";
  const handoffIntent = clientHandoffIntents.has(source.handoffIntent) ? source.handoffIntent : "resume";
  return {
    contractVersion: "aios.claim-evidence-link.client-request.v1",
    requestId,
    sessionId: firstText(source.sessionId, input.sessionId),
    workflowId: firstText(source.workflowId, input.workflowId) || `${surfaceName}:${requestId}`,
    workflowMode,
    handoffIntent,
    selectedLinkId,
    originRoute: normalizeRoute(source.originRoute || input.originRoute, "/artifact-filesystem/claim-evidence-link"),
    returnRoute: normalizeRoute(source.returnRoute || source.returnTo || input.returnRoute, "/artifact-filesystem/claim-evidence-link"),
    submittedCommandId: firstText(command.commandId, command.id),
    clientStateKey: proofHash({
      surfaceId,
      requestId,
      sessionId: firstText(source.sessionId, input.sessionId),
      workflowMode,
      handoffIntent,
      selectedLinkId
    })
  };
}

function resolveClientWorkflowLink(state, selectedLinkId) {
  const visibleLinks = linksForAccess(state, state.accessBoundary)
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt));
  const requested = normalizeOptionalText(selectedLinkId);
  const scopedRequested = requested && state.accessBoundary?.requestedScope
    ? scopedLinkId(state.accessBoundary.requestedScope, requested)
    : requested;
  const selectedLink = requested
    ? visibleLinks.find((link) => (
      link.linkId === requested
      || link.rawLinkId === requested
      || link.linkId === scopedRequested
    )) || null
    : null;
  const latestLinked = visibleLinks.find((link) => link.status === "linked") || null;
  const focusLink = selectedLink || latestLinked || visibleLinks[0] || null;
  return {
    visibleLinks,
    selectedLink,
    focusLink,
    resolution: {
      requestedLinkId: requested,
      scopedRequestedLinkId: scopedRequested || null,
      matched: Boolean(selectedLink),
      matchType: selectedLink
        ? selectedLink.linkId === requested
          ? "scoped-link-id"
          : selectedLink.rawLinkId === requested
            ? "raw-link-id"
            : "scope-derived-link-id"
        : requested
          ? "not-visible"
          : "latest-visible-link",
      visibleLinkCount: visibleLinks.length
    }
  };
}

function buildClientWorkflowDecision({ state, request, validationSummary, acceptance, nextStep, now }) {
  const externalHandoff = state.integration?.externalHandoff || {};
  const providerRuntime = state.integration?.providerRuntime || {};
  const providerReady = state.integration?.providerContract?.ready === true;
  const { selectedLink, focusLink, resolution } = resolveClientWorkflowLink(state, request.selectedLinkId);
  const pendingLinkId = externalHandoff.nextEnvelope?.linkId || null;
  const selectedManifest = selectedLink ? evidenceManifestForLink(selectedLink) : null;
  const selectedArtifactClaimEvidenceLinks = selectedLink && selectedManifest
    ? artifactClaimEvidenceLinksForState(state, selectedLink, selectedManifest)
    : null;
  const selectedClaimEvidenceTraceMatrix = selectedLink && selectedArtifactClaimEvidenceLinks
    ? buildClaimEvidenceTraceMatrix(selectedLink, selectedArtifactClaimEvidenceLinks)
    : null;
  const selectedPending = selectedLink
    && linkReadyForHandoff(state, selectedLink)
    && !selectedLink.auditHandoff?.exportedAt
    ? selectedLink
    : null;
  const handoffLinkId = selectedPending?.linkId || pendingLinkId;
  const blockers = [
    validationSummary.valid ? null : "validation-blockers-present",
    state.lifecycle?.enabled === false ? "lifecycle-disabled" : null,
    providerReady ? null : "provider-contract-not-ready",
    providerRuntime.readyForHandoff === false ? "provider-runtime-not-ready" : null,
    request.handoffIntent === "export-audit" && !handoffLinkId ? "no-pending-handoff-link" : null,
    request.handoffIntent === "export-audit" && selectedLink && selectedManifest?.status !== "complete"
      ? "selected-link-claim-proof-artifact-coverage-incomplete"
      : null,
    request.handoffIntent === "export-audit" && selectedLink && selectedArtifactClaimEvidenceLinks?.status !== "complete"
      ? "selected-link-artifact-claim-evidence-link-incomplete"
      : null,
    request.handoffIntent === "export-audit" && selectedLink && selectedClaimEvidenceTraceMatrix?.status !== "complete"
      ? "selected-link-claim-evidence-trace-matrix-incomplete"
      : null,
    request.selectedLinkId && !resolution.matched ? "selected-link-not-visible" : null
  ].filter(Boolean);
  const canExport = blockers.length === 0 && externalHandoff.status === "pending" && Boolean(handoffLinkId);
  const commandDraft = canExport
    ? {
      commandId: `${request.requestId}:handoff`,
      linkId: handoffLinkId,
      scope: state.accessBoundary?.requestedScope || focusLink?.scope || null,
      payloadContract: "aios.claim-evidence-link.handoff-command.v1",
      route: "/artifact-filesystem/claim-evidence-link/handoff",
      method: "POST"
    }
    : acceptance.commandDraft?.accepted
      ? {
        ...acceptance.commandDraft.projectedLink,
        commandKey: acceptance.commandDraft.commandKey,
        payloadContract: "aios.claim-evidence-link.command.v1",
        route: "/artifact-filesystem/claim-evidence-link/commands",
        method: "POST"
      }
      : null;
  const routeByIntent = {
    stay: request.returnRoute,
    resume: "/artifact-filesystem/claim-evidence-link",
    "export-audit": "/artifact-filesystem/claim-evidence-link/handoff",
    "open-link": focusLink?.linkId
      ? `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(focusLink.linkId)}`
      : "/artifact-filesystem/claim-evidence-link",
    "repair-proof": focusLink?.linkId
      ? `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(focusLink.linkId)}/repair`
      : "/artifact-filesystem/claim-evidence-link/operations"
  };
  const status = blockers.length > 0
    ? "blocked"
    : canExport
      ? "handoff-ready"
      : nextStep.type === "repair-link-proof"
        ? "repair-ready"
        : "awaiting-command";
  const decisionPayload = {
    surfaceId,
    requestId: request.requestId,
    workflowId: request.workflowId,
    handoffIntent: request.handoffIntent,
    selectedLinkResolution: resolution,
    focusLinkId: focusLink?.linkId || null,
    handoffLinkId,
    status,
    blockers,
    selectedClaimEvidenceManifestProof: selectedManifest?.proof || null,
    selectedClaimProofArtifactCoverageProof: selectedManifest?.coverage?.proof || null,
    selectedClaimEvidenceTraceMatrixProof: selectedClaimEvidenceTraceMatrix?.proof || null,
    syncCursor: state.integration?.sync?.cursor || null,
    providerRuntimeProof: providerRuntime.proof || null,
    externalHandoffProof: externalHandoff.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.client-workflow-decision.v1",
    status,
    intent: request.handoffIntent,
    targetRoute: routeByIntent[request.handoffIntent] || routeByIntent.resume,
    focusLink,
    handoffLinkId,
    canExport,
    blockers,
    selectedClaimProofArtifactCoverage: selectedManifest?.coverage || null,
    selectedClaimEvidenceTraceMatrix,
    selectedLinkResolution: resolution,
    commandDraft,
    clientStatePatch: {
      clientStateKey: request.clientStateKey,
      workflowId: request.workflowId,
      selectedLinkId: focusLink?.linkId || null,
      handoffIntent: request.handoffIntent,
      syncCursor: state.integration?.sync?.cursor || null,
      lastDecisionAt: now
    },
    proof: proofHash(decisionPayload)
  };
}

function normalizeClientRuntimeState(input = {}, request) {
  const source = input.clientRuntimeState
    || input.runtimeState
    || input.clientState
    || input.clientRequest?.runtimeState
    || {};
  const acknowledgedEnvelopeProofs = Array.isArray(source.acknowledgedEnvelopeProofs)
    ? [...new Set(source.acknowledgedEnvelopeProofs.filter((proof) => typeof proof === "string" && proof.trim()).map((proof) => proof.trim()))]
    : [];
  return {
    contractVersion: "aios.claim-evidence-link.client-runtime-state.v1",
    clientStateKey: normalizeOptionalText(source.clientStateKey) || request.clientStateKey,
    workflowId: normalizeOptionalText(source.workflowId) || request.workflowId,
    selectedLinkId: normalizeOptionalText(source.selectedLinkId || source.focusLinkId),
    handoffIntent: clientHandoffIntents.has(source.handoffIntent) ? source.handoffIntent : request.handoffIntent,
    lastSyncCursor: normalizeOptionalText(source.lastSyncCursor || source.syncCursor),
    lastEnvelopeProof: normalizeOptionalText(source.lastEnvelopeProof || source.envelopeProof),
    acknowledgedEnvelopeProofs,
    resumedAt: source.resumedAt ? asIso(source.resumedAt) : null
  };
}

function buildClientProofHandoffQueue({ state, analytics, request, decision, now }) {
  const gapReport = analytics?.claimEvidenceGapReport || {};
  const selectedLinkId = normalizeOptionalText(decision.clientStatePatch?.selectedLinkId || request.selectedLinkId);
  const gapRows = Array.isArray(gapReport.exportRows) ? gapReport.exportRows : [];
  const rows = gapRows.map((row) => {
    const linkId = normalizeOptionalText(row.linkId);
    const claimId = normalizeOptionalText(row.claimId);
    const routeBase = linkId
      ? `/artifact-filesystem/claim-evidence-link/links/${encodeURIComponent(linkId)}`
      : "/artifact-filesystem/claim-evidence-link/operations";
    const reasons = [...new Set(Array.isArray(row.reasons) ? row.reasons : [])].sort();
    const unresolvedEvidenceIds = normalizeIdList(row.unresolvedEvidenceIds);
    const nonCompliantEvidenceIds = normalizeIdList(row.nonCompliantEvidenceIds);
    const severity = row.severity === "blocker" || row.severity === "attention" ? row.severity : "review";
    return {
      queueRowId: normalizeOptionalText(row.rowId) || proofHash({ surfaceId, linkId, claimId, reasons }),
      linkId,
      claimId,
      artifactId: normalizeOptionalText(row.artifactId),
      scopeKey: normalizeOptionalText(row.scopeKey),
      severity,
      reasons,
      unresolvedEvidenceIds,
      nonCompliantEvidenceIds,
      claimEvidenceTraceMatrixProof: normalizeOptionalText(row.claimEvidenceTraceMatrixProof),
      selected: Boolean(selectedLinkId && linkId === selectedLinkId),
      repair: {
        method: "POST",
        route: claimId
          ? `${routeBase}/claims/${encodeURIComponent(claimId)}/proof-artifacts`
          : `${routeBase}/claim-proof-index/repair`,
        command: unresolvedEvidenceIds.length > 0
          ? "claim-evidence-link.proof-artifacts.resolve"
          : "claim-evidence-link.claim-proof-index.repair",
        payloadContract: "aios.claim-evidence-link.claim-proof-repair-command.v1"
      }
    };
  }).sort((left, right) => {
    const severityRank = { blocker: 0, attention: 1, review: 2 };
    const selectedRank = Number(right.selected) - Number(left.selected);
    return selectedRank
      || (severityRank[left.severity] ?? 3) - (severityRank[right.severity] ?? 3)
      || (left.linkId || "").localeCompare(right.linkId || "")
      || (left.claimId || "").localeCompare(right.claimId || "");
  });
  const nextRepair = rows[0] || null;
  const status = rows.some((row) => row.severity === "blocker")
    ? "blocked"
    : rows.length > 0
      ? "attention"
      : decision.canExport
        ? "handoff-ready"
        : "clear";
  const payload = {
    surfaceId,
    requestId: request.requestId,
    workflowId: request.workflowId,
    selectedLinkId,
    status,
    gapReportProof: gapReport.proof || null,
    rowProofs: rows.map((row) => row.queueRowId),
    decisionProof: decision.proof,
    accessBoundaryProof: state.accessBoundary?.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.client-proof-handoff-queue.v1",
    generatedAt: now,
    status,
    queueDepth: rows.length,
    blockerCount: rows.filter((row) => row.severity === "blocker").length,
    attentionCount: rows.filter((row) => row.severity === "attention").length,
    selectedLinkId,
    nextRepair,
    rows: rows.slice(0, 20),
    source: {
      contractVersion: gapReport.contractVersion || "aios.claim-evidence-link.claim-evidence-gap-report.v1",
      status: gapReport.status || "clear",
      proof: gapReport.proof || null
    },
    clientStatePatch: {
      clientStateKey: request.clientStateKey,
      workflowId: request.workflowId,
      proofQueueStatus: status,
      proofQueueDepth: rows.length,
      nextProofRepairRoute: nextRepair?.repair?.route || null,
      claimEvidenceGapReportProof: gapReport.proof || null,
      updatedAt: now
    },
    proof: proofHash(payload)
  };
}

function buildClientRuntimeHandoffContract({ state, request, decision, acceptance, validationSummary, proofQueue, now, input = {} }) {
  const runtimeState = normalizeClientRuntimeState(input, request);
  const sync = state.integration?.sync || {};
  const externalHandoff = state.integration?.externalHandoff || {};
  const nextEnvelope = externalHandoff.nextEnvelope || null;
  const envelopeProof = nextEnvelope?.envelopeProof || nextEnvelope?.proof || null;
  const alreadyAcknowledged = Boolean(envelopeProof && runtimeState.acknowledgedEnvelopeProofs.includes(envelopeProof));
  const proofQueueBlocked = proofQueue?.status === "blocked";
  const staleReasons = [
    runtimeState.workflowId !== request.workflowId ? "workflow-id-changed" : null,
    runtimeState.clientStateKey !== request.clientStateKey ? "client-state-key-changed" : null,
    runtimeState.lastSyncCursor && runtimeState.lastSyncCursor !== sync.cursor ? "sync-cursor-advanced" : null,
    runtimeState.lastEnvelopeProof && envelopeProof && runtimeState.lastEnvelopeProof !== envelopeProof ? "handoff-envelope-rotated" : null,
    request.selectedLinkId && decision.selectedLinkResolution?.matched === false ? "selected-link-not-visible" : null
  ].filter(Boolean);
  const commitEnabled = decision.canExport && Boolean(nextEnvelope) && !alreadyAcknowledged && !proofQueueBlocked && staleReasons.length === 0;
  const commitCommand = commitEnabled
    ? {
      commandId: `${request.requestId}:handoff:commit`,
      linkId: decision.handoffLinkId,
      scope: state.accessBoundary?.requestedScope || nextEnvelope?.boundary?.requestedScope || null,
      actor: state.accessBoundary?.actor
        ? {
          actorId: state.accessBoundary.actor.actorId,
          roles: state.accessBoundary.actor.roles
        }
        : null,
      expectedEnvelopeProof: envelopeProof,
      expectedSyncCursor: sync.cursor || null,
      expectedLeaseToken: nextEnvelope.handoffLease?.token || null
    }
    : null;
  const optimisticPatch = {
    clientStateKey: request.clientStateKey,
    workflowId: request.workflowId,
    selectedLinkId: decision.clientStatePatch.selectedLinkId,
    handoffIntent: request.handoffIntent,
    syncCursor: sync.cursor || null,
    pendingEnvelopeProof: envelopeProof,
    proofQueueStatus: proofQueue?.status || "clear",
    nextProofRepairRoute: proofQueue?.nextRepair?.repair?.route || null,
    proofQueueProof: proofQueue?.proof || null,
    lastDecisionProof: decision.proof,
    updatedAt: now
  };
  const ackRequirements = nextEnvelope
    ? {
      required: nextEnvelope.cursorAck?.required === true,
      route: nextEnvelope.cursorAck?.route || state.integration?.providerContract?.serviceContract?.cursorAck?.route || null,
      cursor: sync.cursor || null,
      leaseToken: nextEnvelope.handoffLease?.token || null,
      envelopeProof,
      expiresAt: nextEnvelope.handoffLease?.expiresAt || null
    }
    : {
      required: false,
      route: null,
      cursor: sync.cursor || null,
      leaseToken: null,
      envelopeProof: null,
      expiresAt: null
    };
  const auditTrail = {
    requestId: request.requestId,
    workflowId: request.workflowId,
    actorId: state.accessBoundary?.actor?.actorId || null,
    accessBoundaryProof: state.accessBoundary?.proof || null,
    providerRuntimeProof: state.integration?.providerRuntime?.proof || null,
    externalHandoffProof: externalHandoff.proof || null,
    proofQueueProof: proofQueue?.proof || null,
    acceptanceProof: acceptance.proof,
    validationSeverity: validationSummary.severity
  };
  const payload = {
    surfaceId,
    requestId: request.requestId,
    workflowId: request.workflowId,
    commitEnabled,
    staleReasons,
    alreadyAcknowledged,
    proofQueueStatus: proofQueue?.status || "clear",
    proofQueueProof: proofQueue?.proof || null,
    envelopeProof,
    syncCursor: sync.cursor || null,
    decisionProof: decision.proof,
    runtimeClientStateKey: runtimeState.clientStateKey
  };
  return {
    contractVersion: "aios.claim-evidence-link.client-runtime-handoff.v1",
    generatedAt: now,
    status: commitEnabled
      ? "commit-ready"
      : alreadyAcknowledged
        ? "already-acknowledged"
        : staleReasons.length > 0
          ? "refresh-required"
          : decision.status === "blocked"
            ? "blocked"
            : "waiting",
    commit: {
      enabled: commitEnabled,
      method: "POST",
      route: "/artifact-filesystem/claim-evidence-link/handoff",
      payloadContract: "aios.claim-evidence-link.handoff-command.v1",
      command: commitCommand,
      disabledReasons: commitEnabled
        ? []
        : [
          ...decision.blockers,
          ...staleReasons,
          proofQueueBlocked ? "claim-proof-queue-blocked" : null,
          alreadyAcknowledged ? "handoff-envelope-already-acknowledged" : null,
          !nextEnvelope ? "handoff-envelope-missing" : null
        ].filter(Boolean)
    },
    runtimeState,
    optimisticClientStatePatch: optimisticPatch,
    proofQueue,
    ackRequirements,
    auditTrail,
    refresh: {
      required: staleReasons.length > 0,
      route: request.originRoute,
      method: "GET",
      reasons: staleReasons
    },
    proof: proofHash(payload)
  };
}

function buildClientWorkflowHandoff(state, analytics, timeline, now, input = {}) {
  const request = normalizeClientRequestContext(input, state);
  const validationSummary = buildClientValidationSummary(state, analytics, now);
  const acceptance = buildClientAcceptanceContract(state, validationSummary, now, input);
  const nextStep = buildNextAction(state, now);
  const externalHandoff = state.integration?.externalHandoff || {};
  const decision = buildClientWorkflowDecision({ state, request, validationSummary, acceptance, nextStep, now });
  const proofQueue = buildClientProofHandoffQueue({ state, analytics, request, decision, now });
  const runtimeHandoff = buildClientRuntimeHandoffContract({
    state,
    request,
    decision,
    acceptance,
    validationSummary,
    proofQueue,
    now,
    input
  });
  const focusLink = decision.focusLink;
  const blocked = decision.status === "blocked";
  const canStartHandoff = decision.canExport;
  const primaryRoute = nextStep.type === "enable-lifecycle"
    ? "/artifact-filesystem/claim-evidence-link/lifecycle"
    : blocked && proofQueue.nextRepair?.repair?.route
      ? proofQueue.nextRepair.repair.route
      : canStartHandoff
      ? "/artifact-filesystem/claim-evidence-link/handoff"
      : "/artifact-filesystem/claim-evidence-link/commands";
  const primaryAction = blocked
    ? proofQueue.nextRepair ? "repair-claim-proof" : "resolve-blockers"
    : canStartHandoff
      ? "export-handoff"
      : nextStep.type === "repair-link-proof"
        ? "repair-proof"
        : "submit-link-command";
  const resumePayload = {
    surfaceId,
    requestId: request.requestId,
    workflowId: request.workflowId,
    cursor: state.integration?.sync?.cursor || null,
    nextActionType: nextStep.type,
    focusLinkId: focusLink?.linkId || null,
    pendingHandoffLinkId: decision.handoffLinkId || null,
    validationSeverity: validationSummary.severity,
    workflowDecisionProof: decision.proof
  };
  return {
    contractVersion: "aios.claim-evidence-link.client-workflow.v1",
    generatedAt: now,
    request,
    status: decision.status,
    decision: {
      contractVersion: decision.contractVersion,
      intent: decision.intent,
      targetRoute: decision.targetRoute,
      handoffLinkId: decision.handoffLinkId,
      canExport: decision.canExport,
      blockers: decision.blockers,
      selectedLinkResolution: decision.selectedLinkResolution,
      commandDraft: decision.commandDraft,
      clientStatePatch: decision.clientStatePatch,
      proof: decision.proof
    },
    proofQueue,
    runtimeHandoff,
    focus: {
      linkId: focusLink?.linkId || null,
      claimId: focusLink?.claimId || null,
      artifactId: focusLink?.artifactId || null,
      proofStatus: focusLink?.proof ? "verified" : focusLink ? "missing" : "none",
      handoffStatus: focusLink?.auditHandoff?.exportedAt ? "exported" : focusLink ? externalHandoff.status || "idle" : "none"
    },
    accessBoundary: state.accessBoundary
      ? {
        mode: state.accessBoundary.mode,
        requestedScope: state.accessBoundary.requestedScope,
        visibleLinks: state.accessBoundary.visibleLinkIds.length,
        hiddenLinks: state.accessBoundary.hiddenLinkIds.length,
        proof: state.accessBoundary.proof
      }
      : null,
    primaryAction: {
      type: primaryAction,
      method: "POST",
      route: primaryRoute,
      enabled: primaryAction === "repair-claim-proof" ? Boolean(proofQueue.nextRepair) : !blocked,
      disabledReason: blocked && primaryAction !== "repair-claim-proof"
        ? validationSummary.blockers[0]?.remediation || "Resolve validation blockers before continuing."
        : null,
      targetRoute: decision.targetRoute,
      commandDraft: runtimeHandoff.commit.enabled
        ? runtimeHandoff.commit.command
        : primaryAction === "repair-claim-proof" && proofQueue.nextRepair
          ? {
            command: proofQueue.nextRepair.repair.command,
            method: proofQueue.nextRepair.repair.method,
            route: proofQueue.nextRepair.repair.route,
            payloadContract: proofQueue.nextRepair.repair.payloadContract,
            linkId: proofQueue.nextRepair.linkId,
            claimId: proofQueue.nextRepair.claimId,
            unresolvedEvidenceIds: proofQueue.nextRepair.unresolvedEvidenceIds,
            nonCompliantEvidenceIds: proofQueue.nextRepair.nonCompliantEvidenceIds,
            expectedGapReportProof: proofQueue.source.proof,
            expectedQueueRowId: proofQueue.nextRepair.queueRowId
          }
          : decision.commandDraft,
      payloadContract: primaryAction === "export-handoff"
        ? "aios.claim-evidence-link.handoff.v1"
        : primaryAction === "repair-claim-proof"
          ? proofQueue.nextRepair?.repair?.payloadContract || "aios.claim-evidence-link.claim-proof-repair-command.v1"
        : primaryAction === "resolve-blockers"
          ? "aios.claim-evidence-link.lifecycle-command.v1"
          : "aios.claim-evidence-link.command.v1"
    },
    acceptance,
    resume: {
      token: proofHash(resumePayload),
      returnRoute: request.returnRoute,
      expiresAt: asIso(new Date(Date.parse(now) + 30 * 60000).toISOString(), now),
      payload: resumePayload
    },
    secondaryActions: [
      {
        type: "repair-next-claim-proof",
        method: "POST",
        route: proofQueue.nextRepair?.repair?.route || "/artifact-filesystem/claim-evidence-link/operations",
        enabled: Boolean(proofQueue.nextRepair),
        payloadContract: proofQueue.nextRepair?.repair?.payloadContract || "aios.claim-evidence-link.claim-proof-repair-command.v1",
        command: proofQueue.nextRepair?.repair?.command || "claim-evidence-link.claim-proof-index.repair",
        proofQueueRowId: proofQueue.nextRepair?.queueRowId || null
      },
      {
        type: "download-audit-export",
        method: "GET",
        route: "/artifact-filesystem/claim-evidence-link/export",
        enabled: (analytics?.totals?.links || 0) > 0,
        payloadContract: "aios.claim-evidence-link.export.v1"
      },
      {
        type: "review-timeline",
        method: "GET",
        route: "/artifact-filesystem/claim-evidence-link/timeline",
        enabled: Array.isArray(timeline) && timeline.length > 0,
        payloadContract: "aios.claim-evidence-link.timeline.v1"
      }
    ],
    proof: proofHash({ ...resumePayload, status: decision.status, decisionProof: decision.proof, runtimeHandoffProof: runtimeHandoff.proof, proofQueueProof: proofQueue.proof })
  };
}

function buildClientReviewContract(state, analytics, timeline, now, input = {}) {
  const validationSummary = buildClientValidationSummary(state, analytics, now);
  const acceptanceContract = buildClientAcceptanceContract(state, validationSummary, now, input);
  const providerReady = state.integration?.providerContract?.ready === true;
  const canAcceptLink = validationSummary.valid && state.lifecycle?.enabled !== false;
  const nextStep = buildNextAction(state, now);
  return {
    contractVersion: "aios.claim-evidence-link.client-review.v1",
    generatedAt: now,
    preview: {
      title: "Claim evidence links",
      emptyState: "No claim-evidence links have been accepted for this scoped workspace.",
      rows: buildClientPreviewRows(state, now),
      recentTimeline: timeline.slice(-6)
    },
    readiness: {
      status: canAcceptLink && providerReady ? "ready" : canAcceptLink ? "provider-warning" : "blocked",
      canAcceptLink,
      canExportHandoff: providerReady && state.integration?.externalHandoff?.status !== "blocked",
      providerReady,
      lifecycleEnabled: state.lifecycle?.enabled !== false
    },
    acceptance: {
      command: "link-claim-evidence",
      requiredFields: ["commandId", "claimId", "artifactId", "scope.tenantId", "scope.workspaceId", "actor.actorId", "actor.roles", "evidence"],
      permittedRoles: [...permittedLinkRoles],
      idempotencyScope: "tenant/workspace scoped commandId",
      proofRequiredForExport: true,
      contract: acceptanceContract,
      accessBoundary: state.accessBoundary
        ? {
          mode: state.accessBoundary.mode,
          visibleLinks: state.accessBoundary.visibleLinkIds.length,
          hiddenLinks: state.accessBoundary.hiddenLinkIds.length,
          proof: state.accessBoundary.proof
        }
        : null
    },
    validationSummary,
    nextStep: {
      ...nextStep,
      explanation: nextStep.reason,
      routeHint: nextStep.type === "enable-lifecycle"
        ? "POST /artifact-filesystem/claim-evidence-link/lifecycle"
        : "POST /artifact-filesystem/claim-evidence-link/commands"
    },
    proof: proofHash({
      surfaceId,
      status: state.status,
      readiness: { canAcceptLink, providerReady },
      validationCounts: validationSummary.counts,
      nextStep,
      acceptanceProof: acceptanceContract.proof
    })
  };
}

function attachReportingState(state, now, input = {}) {
  const accessBoundary = normalizeAccessBoundary(input, state);
  const stateWithBoundary = { ...state, accessBoundary };
  const integratedBase = attachIntegrationState(stateWithBoundary, now, input);
  const recoveryPlan = buildRecoveryPlan(integratedBase, now);
  const integratedState = {
    ...integratedBase,
    recoveryPlan,
    operationalHealth: buildOperationalHealth({ ...integratedBase, recoveryPlan }, now)
  };
  const analytics = buildAnalyticsSnapshot(integratedState, now);
  const timeline = buildTimeline(integratedState);
  const exportSummary = buildExportSummary(integratedState, analytics, timeline, now);
  const analyticsHistory = buildAnalyticsHistoryState(integratedState, analytics, exportSummary, now);
  const timelineReport = buildTimelineReportState(integratedState, timeline, analyticsHistory, now);
  const exportReadiness = buildExportReadinessSummary(integratedState, analyticsHistory, timelineReport, now);
  const analyticsExportManifest = buildAnalyticsExportManifest(
    integratedState,
    analytics,
    analyticsHistory,
    timelineReport,
    exportReadiness,
    now
  );
  const clientReview = buildClientReviewContract(integratedState, analytics, timeline, now, input);
  const clientWorkflow = buildClientWorkflowHandoff(integratedState, analytics, timeline, now, input);
  return {
    ...integratedState,
    analytics: {
      ...analytics,
      history: analyticsHistory,
      counters: {
        ...analytics.totals,
        handoffQueueDepth: analyticsHistory.current.totals.handoffQueueDepth,
        exported: analyticsHistory.current.totals.exported,
        historyWindow: analyticsHistory.windowSize,
        timelineEvents: timelineReport.eventCount,
        proofMissing: analyticsHistory.current.totals.proofMissing,
        proofVerified: analyticsHistory.current.totals.proofVerified,
        handoffReady: analyticsHistory.current.totals.handoffReady,
        handoffProviderBlocked: analyticsHistory.current.totals.handoffProviderBlocked,
        handoffRejected: analyticsHistory.current.totals.handoffRejected,
        handoffExported: analyticsHistory.current.totals.handoffExported,
        failedAuditEvents: analyticsHistory.current.totals.failedAuditEvents,
        claimEvidenceGapRows: analyticsHistory.current.totals.claimEvidenceGapRows,
        claimEvidenceGapLinks: analyticsHistory.current.totals.claimEvidenceGapLinks,
        claimEvidenceGapClaims: analyticsHistory.current.totals.claimEvidenceGapClaims,
        claimEvidenceGapBlockers: analyticsHistory.current.totals.claimEvidenceGapBlockers,
        claimEvidenceGapAttention: analyticsHistory.current.totals.claimEvidenceGapAttention
      },
      deltas: analyticsHistory.deltas,
      exportManifest: analyticsExportManifest,
      proof: analyticsHistory.proof
    },
    timeline,
    timelineReport,
    exportSummary: {
      ...exportSummary,
      providerContract: integratedState.integration.providerContract,
      sync: integratedState.integration.sync,
      externalHandoff: integratedState.integration.externalHandoff,
      readiness: exportReadiness,
      history: {
        contractVersion: analyticsHistory.contractVersion,
        proof: analyticsHistory.proof,
        windowSize: analyticsHistory.windowSize,
        deltas: analyticsHistory.deltas
      },
      timelineReport: {
        contractVersion: timelineReport.contractVersion,
        proof: timelineReport.proof,
        eventCount: timelineReport.eventCount,
        latestAt: timelineReport.latestAt
      },
      analyticsExportManifest
    },
    nextAction: clientReview.nextStep,
    clientReview: {
      ...clientReview,
      workflowHandoff: clientWorkflow,
      reporting: {
        exportReadiness,
        timelineReport,
        analyticsHistory,
        analyticsExportManifest,
        claimEvidenceGapReport: analytics.claimEvidenceGapReport
      }
    },
    clientWorkflow: {
      ...clientWorkflow,
      reporting: {
        exportReadiness,
        analyticsHistoryProof: analyticsHistory.proof,
        timelineReportProof: timelineReport.proof,
        analyticsExportManifestProof: analyticsExportManifest.proof,
        claimEvidenceGapReportProof: analytics.claimEvidenceGapReport?.proof || null
      }
    },
    exportReadiness,
    analyticsExportManifest,
    historySnapshots: analyticsHistory.window
  };
}

export function shapeClaimEvidenceLinkState(persisted = {}, input = {}) {
  const now = asIso(input.now);
  const lifecycle = buildLifecycleState(persisted, now);
  const persistedPolicyState = { lifecycle };
  const previousLinks = persisted && typeof persisted === "object" && persisted.links && typeof persisted.links === "object"
    ? persisted.links
    : {};
  const links = Object.fromEntries(Object.entries(previousLinks).map(([linkId, link]) => {
    const status = terminalStatuses.has(link?.status) ? link.status : "recovering";
    const evidenceTrace = normalizePersistedEvidenceTrace(link);
    const scope = readPersistedScope(link);
    const scopeIntegrity = buildPersistedLinkScopeIntegrity({
      recordKey: linkId,
      link,
      normalizedScope: scope,
      now
    });
    const persistedClaimEvidenceManifest = normalizePersistedClaimEvidenceManifest(link);
    const repairedClaimEvidenceManifest = buildClaimEvidenceManifest({
        linkId,
        artifactId: typeof link?.artifactId === "string" ? link.artifactId : null,
        evidence: Array.isArray(link?.evidence) ? link.evidence : [],
        scope,
        evidenceTrace
      }, evidenceTrace);
    const claimEvidenceManifest = persistedClaimEvidenceManifest?.validation?.complete === true
      ? persistedClaimEvidenceManifest
      : repairedClaimEvidenceManifest;
    const claimProofIndex = buildClaimProofIndex({
      linkId,
      artifactId: typeof link?.artifactId === "string" ? link.artifactId : null,
      evidence: Array.isArray(link?.evidence) ? link.evidence : [],
      scope,
      evidenceTrace
    }, claimEvidenceManifest, evidenceTrace);
    const artifactClaimEvidenceLinks = buildArtifactClaimEvidenceLinks({
      linkId,
      artifactId: typeof link?.artifactId === "string" ? link.artifactId : null,
      evidence: Array.isArray(link?.evidence) ? link.evidence : [],
      scope,
      evidenceTrace
    }, claimEvidenceManifest, evidenceTrace, evidenceReferencePolicyForState(persistedPolicyState));
    const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix({
      linkId,
      claimId: typeof link?.claimId === "string" ? link.claimId : null,
      artifactId: typeof link?.artifactId === "string" ? link.artifactId : null,
      evidence: Array.isArray(link?.evidence) ? link.evidence : [],
      scope,
      evidenceTrace
    }, artifactClaimEvidenceLinks);
    return [linkId, {
      linkId,
      rawLinkId: typeof link?.rawLinkId === "string" ? link.rawLinkId : null,
      claimId: typeof link?.claimId === "string" ? link.claimId : null,
      artifactId: typeof link?.artifactId === "string" ? link.artifactId : null,
      evidence: Array.isArray(link?.evidence) ? link.evidence : [],
      evidenceTrace,
      claimEvidenceManifest,
      claimProofIndex,
      artifactClaimEvidenceLinks,
      claimEvidenceTraceMatrix,
      commandId: typeof link?.commandId === "string" ? link.commandId : null,
      scope,
      scopeIntegrity,
      actor: link?.actor && typeof link.actor === "object"
        ? {
          actorId: normalizeOptionalText(link.actor.actorId || link.actor.id),
          roles: Array.isArray(link.actor.roles) ? link.actor.roles.filter((role) => typeof role === "string") : []
        }
        : null,
      status,
      createdAt: asIso(link?.createdAt, now),
      updatedAt: asIso(link?.updatedAt, now),
      recoveredAt: status === "recovering" ? now : link?.recoveredAt || null,
      proof: link?.proof || null,
      auditHandoff: link?.auditHandoff && typeof link.auditHandoff === "object" ? link.auditHandoff : null
    }];
  }));
  const commandIndex = persisted && typeof persisted === "object" && persisted.commandIndex && typeof persisted.commandIndex === "object"
    ? { ...persisted.commandIndex }
    : {};
  const commandLedger = buildCommandLedger(persisted, links, now);
  const scopeIntegrity = summarizeScopeIntegrity(links, now);
  const hasRecovery = Object.values(links).some((link) => link.status === "recovering")
    || Object.values(commandLedger).some((entry) => entry.recovery?.required === true)
    || scopeIntegrity.quarantinedLinkCount > 0;

  const shapedState = {
    stateVersion,
    status: hasRecovery ? "recovery-required" : "ready",
    links,
    scopeIntegrity,
    commandIndex,
    commandLedger,
    lifecycle,
    integration: persisted?.integration && typeof persisted.integration === "object" ? persisted.integration : {},
    auditLog: Array.isArray(persisted?.auditLog) ? persisted.auditLog.slice(-100) : [],
    historySnapshots: Array.isArray(persisted?.historySnapshots) ? persisted.historySnapshots.slice(-historyLimit) : [],
    recoveredAt: hasRecovery ? now : null
  };
  return attachReportingState({
    ...shapedState,
    operationalHealth: buildOperationalHealth(shapedState, now)
  }, now, input);
}

export function applyClaimEvidenceLinkCommand(command = {}, persisted = {}, input = {}) {
  const now = asIso(input.now);
  const state = shapeClaimEvidenceLinkState(persisted, {
    ...input,
    now,
    integration: command.integration || command.providerContract || command.provider || input.integration
  });
  const errors = [];
  const commandId = normalizeText(command.commandId || command.id, "commandId", errors);
  const claimId = normalizeText(command.claimId, "claimId", errors);
  const artifactId = normalizeText(command.artifactId, "artifactId", errors);
  const scope = normalizeScope(command.scope || {
    tenantId: command.tenantId || input.tenantId,
    workspaceId: command.workspaceId || input.workspaceId
  }, errors);
  const actor = normalizeActor(command.actor || input.actor || {}, errors);
  const evidence = normalizeEvidence(command.evidence, errors);
  const claimIds = normalizeClaimSet(claimId, command, errors);
  const retryAttempt = normalizeAttempt(command.retryAttempt ?? command.attempt ?? input.retryAttempt);
  const rawLinkId = command.linkId || (claimId && artifactId ? `${claimId}::${artifactId}` : null);
  const linkId = scopedLinkId(scope, rawLinkId);
  const evidenceTrace = buildEvidenceTrace({ claimIds, artifactId, evidence, scope, linkId, errors });
  const claimEvidenceManifest = buildClaimEvidenceManifest({ linkId, artifactId, scope, evidenceTrace }, evidenceTrace);
  const claimProofIndex = buildClaimProofIndex({ linkId, artifactId, scope, evidence, evidenceTrace }, claimEvidenceManifest, evidenceTrace);
  const artifactClaimEvidenceLinks = buildArtifactClaimEvidenceLinks({
    linkId,
    artifactId,
    evidence,
    scope,
    evidenceTrace
  }, claimEvidenceManifest, evidenceTrace, evidenceReferencePolicyForState(state));
  const commandIndexId = scopedCommandId(scope, commandId);
  const boundaryConflict = rawLinkId && findBoundaryConflict(state, scope, rawLinkId);

  if (!linkId) errors.push("linkId could not be derived");
  if (state.lifecycle?.enabled === false) errors.push("surface is disabled by lifecycle controls");
  if (state.integration?.providerRuntime?.readyForWrites === false) {
    errors.push("provider runtime is not ready for claim evidence writes");
  }
  if (evidence.length > (state.lifecycle?.settings?.maxEvidenceItems || defaultLifecycleSettings.maxEvidenceItems)) {
    errors.push(`evidence count ${evidence.length} exceeds lifecycle maxEvidenceItems ${state.lifecycle.settings.maxEvidenceItems}`);
  }
  if (state.lifecycle?.settings?.requireEvidenceDigest && evidence.some((item) => !item.digest)) {
    errors.push("evidence digest is required by lifecycle settings");
  }
  if (actor.actorId && !actor.hasLinkPermission) {
    errors.push(`actor ${actor.actorId} is not permitted to link claim evidence`);
  }
  if (boundaryConflict) {
    errors.push(boundaryConflict.reason);
  }
  if (errors.length > 0) {
    const failure = buildFailureEnvelope({
      now,
      commandId,
      scopedCommandId: commandIndexId,
      scope,
      actor,
      errors,
      boundaryConflict,
      retryAttempt
    });
    const audit = {
      at: now,
      action: "claim-evidence-link.rejected",
      commandId,
      scopedCommandId: commandIndexId,
      scope,
      actor: actor.actorId ? { actorId: actor.actorId, roles: actor.roles } : null,
      errors,
      actionableErrors: failure.actionableErrors,
      boundaryConflict,
      failureId: failure.failureId
    };
    const rejectedLedgerEntry = {
      commandKey: commandIndexId,
      commandId,
      scopedCommandId: commandIndexId,
      linkId: null,
      scopeKey: scope?.scopeKey || null,
      actorId: actor.actorId || null,
      status: "rejected",
      firstSeenAt: state.commandLedger[commandIndexId]?.firstSeenAt || now,
      lastSeenAt: now,
      replayCount: state.commandLedger[commandIndexId]?.replayCount || 0,
      failureId: failure.failureId,
      resultProof: failure.failureId,
      recovery: { required: false, reason: null, retryAfterMs: null }
    };
    const rejectedState = {
      ...state,
      commandLedger: { ...state.commandLedger, [commandIndexId]: rejectedLedgerEntry },
      auditLog: [...state.auditLog, audit].slice(-100)
    };
    rejectedState.operationalHealth = buildOperationalHealth(rejectedState, now);
    const reportedState = attachReportingState(rejectedState, now, { ...input, command });
    return {
      ok: false,
      status: "rejected",
      errors,
      actionableErrors: failure.actionableErrors,
      failure,
      commandStatus: buildCommandStatus(rejectedLedgerEntry, null, now),
      state: reportedState,
      audit
    };
  }

  if (state.commandIndex[commandIndexId] || state.commandLedger[commandIndexId]) {
    const ledgerEntry = state.commandLedger[commandIndexId] || normalizeCommandLedgerEntry({
      linkId: state.commandIndex[commandIndexId],
      status: "linked"
    }, commandIndexId, state.links, now);
    const existingLinkId = ledgerEntry.linkId || state.commandIndex[commandIndexId];
    const existingLink = existingLinkId ? state.links[existingLinkId] || null : null;
    const commandStatus = buildCommandStatus(ledgerEntry, existingLink, now);
    if (commandStatus.recoveryRequired) {
      const repairedLinkId = existingLinkId || linkId;
      const repairedEvidenceTrace = buildEvidenceTrace({ claimIds, artifactId, evidence, scope, linkId: repairedLinkId, errors: [] });
      const repairedClaimEvidenceManifest = buildClaimEvidenceManifest({
        linkId: repairedLinkId,
        artifactId,
        evidence,
        scope,
        evidenceTrace: repairedEvidenceTrace
      }, repairedEvidenceTrace);
      const repairedClaimProofIndex = buildClaimProofIndex({
        linkId: repairedLinkId,
        artifactId,
        evidence,
        scope,
        evidenceTrace: repairedEvidenceTrace
      }, repairedClaimEvidenceManifest, repairedEvidenceTrace);
      const repairedArtifactClaimEvidenceLinks = buildArtifactClaimEvidenceLinks({
        linkId: repairedLinkId,
        artifactId,
        evidence,
        scope,
        evidenceTrace: repairedEvidenceTrace
      }, repairedClaimEvidenceManifest, repairedEvidenceTrace, evidenceReferencePolicyForState(state));
      const repairedClaimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix({
        linkId: repairedLinkId,
        claimId,
        artifactId,
        evidence,
        scope,
        evidenceTrace: repairedEvidenceTrace
      }, repairedArtifactClaimEvidenceLinks);
      const repairedAuditHandoff = {
        surfaceId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        actorId: actor.actorId,
        commandId,
        scopedCommandId: commandIndexId,
        evidenceCount: evidence.length,
        acceptedAt: existingLink?.createdAt || ledgerEntry.firstSeenAt || now,
        recoveredAt: now,
        provider: state.integration?.externalHandoff?.target || null,
        syncCursor: state.integration?.sync?.cursor || null,
        syncMode: state.integration?.sync?.mode || "push",
        cursorAck: state.integration?.sync?.cursorAck || null,
        contractProof: state.integration?.providerContract?.proof || null,
        serviceContractProof: state.integration?.providerContract?.serviceContract?.proof || null,
        evidenceTraceProof: repairedEvidenceTrace.proof,
        claimEvidenceManifestProof: repairedClaimEvidenceManifest.proof,
        claimProofIndexProof: repairedClaimProofIndex.proof,
        claimProofIndexStatus: repairedClaimProofIndex.status,
        artifactClaimEvidenceLinksProof: repairedArtifactClaimEvidenceLinks.proof,
        artifactClaimEvidenceLinksStatus: repairedArtifactClaimEvidenceLinks.status,
        claimEvidenceTraceMatrixProof: repairedClaimEvidenceTraceMatrix.proof,
        claimEvidenceTraceMatrixStatus: repairedClaimEvidenceTraceMatrix.status,
        claimEvidenceManifestProofArtifactRefCount: Array.isArray(repairedClaimEvidenceManifest.proofArtifacts)
          ? repairedClaimEvidenceManifest.proofArtifacts.length
          : 0
      };
      const repairedLink = {
        linkId: repairedLinkId,
        rawLinkId,
        claimId,
        artifactId,
        evidence,
        evidenceTrace: repairedEvidenceTrace,
        claimEvidenceManifest: repairedClaimEvidenceManifest,
        claimProofIndex: repairedClaimProofIndex,
        artifactClaimEvidenceLinks: repairedArtifactClaimEvidenceLinks,
        claimEvidenceTraceMatrix: repairedClaimEvidenceTraceMatrix,
        commandId,
        scopedCommandId: commandIndexId,
        scope,
        scopeIntegrity: buildPersistedLinkScopeIntegrity({
          recordKey: repairedLinkId,
          link: {
            linkId: repairedLinkId,
            rawLinkId,
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            scope
          },
          normalizedScope: scope,
          now
        }),
        actor: { actorId: actor.actorId, roles: actor.roles },
        status: "linked",
        createdAt: existingLink?.createdAt || ledgerEntry.firstSeenAt || now,
        updatedAt: now,
        recoveredAt: now,
        proof: proofHash({ surfaceId, linkId: repairedLinkId, claimId, artifactId, evidence, evidenceTrace: repairedEvidenceTrace, claimEvidenceManifest: repairedClaimEvidenceManifest, claimProofIndex: repairedClaimProofIndex, artifactClaimEvidenceLinks: repairedArtifactClaimEvidenceLinks, claimEvidenceTraceMatrix: repairedClaimEvidenceTraceMatrix, scope, actorId: actor.actorId }),
        auditHandoff: repairedAuditHandoff
      };
      const repairedLedgerEntry = {
        commandKey: commandIndexId,
        commandId,
        scopedCommandId: commandIndexId,
        linkId: repairedLinkId,
        scopeKey: scope.scopeKey,
        actorId: actor.actorId,
        status: "linked",
        firstSeenAt: ledgerEntry.firstSeenAt || now,
        lastSeenAt: now,
        replayCount: ledgerEntry.replayCount + 1,
        failureId: null,
        resultProof: repairedLink.proof,
        recovery: { required: false, reason: null, retryAfterMs: null }
      };
      const recoveryTask = state.recoveryPlan?.tasks?.find((task) => (
        task.commandKey === commandIndexId
        || task.scopedCommandId === commandIndexId
        || task.linkId === repairedLinkId
      )) || null;
      const recoveryAudit = {
        at: now,
        action: "claim-evidence-link.replay-recovered",
        commandId,
        scopedCommandId: commandIndexId,
        linkId: repairedLinkId,
        scope,
        actor: { actorId: actor.actorId, roles: actor.roles },
        recoveryTaskId: recoveryTask?.taskId || null,
        previousCommandStatus: commandStatus,
        evidenceTrace: repairedEvidenceTrace,
        claimEvidenceManifest: repairedClaimEvidenceManifest,
        claimProofIndex: repairedClaimProofIndex,
        artifactClaimEvidenceLinks: repairedArtifactClaimEvidenceLinks,
        claimEvidenceTraceMatrix: repairedClaimEvidenceTraceMatrix,
        proof: repairedLink.proof
      };
      const recoveredState = {
        ...state,
        links: { ...state.links, [repairedLinkId]: repairedLink },
        commandIndex: { ...state.commandIndex, [commandIndexId]: repairedLinkId },
        commandLedger: { ...state.commandLedger, [commandIndexId]: repairedLedgerEntry },
        auditLog: [...state.auditLog, recoveryAudit].slice(-100),
        recoveredAt: now
      };
      recoveredState.scopeIntegrity = summarizeScopeIntegrity(recoveredState.links, now);
      recoveredState.status = Object.values(recoveredState.links).some((candidate) => candidate.status === "recovering")
        || Object.values(recoveredState.commandLedger).some((entry) => entry.recovery?.required === true)
        || recoveredState.scopeIntegrity.quarantinedLinkCount > 0
        ? "recovery-required"
        : "ready";
      recoveredState.operationalHealth = buildOperationalHealth(recoveredState, now);
      const reportedRecoveredState = attachReportingState(recoveredState, now, { ...input, command });
      return {
        ok: true,
        status: "recovered",
        commandStatus: buildCommandStatus(repairedLedgerEntry, repairedLink, now),
        recoveryTask,
        link: repairedLink,
        state: reportedRecoveredState,
        audit: recoveryAudit
      };
    }
    return {
      ok: true,
      status: "idempotent-replay",
      commandStatus,
      link: existingLink,
      state: attachReportingState(state, now, { ...input, command }),
      audit: {
        at: now,
        action: "claim-evidence-link.replayed",
        commandId,
        scopedCommandId: commandIndexId,
        linkId: existingLinkId,
        scope,
        actor: { actorId: actor.actorId, roles: actor.roles }
      }
    };
  }

  const auditHandoff = {
    surfaceId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorId: actor.actorId,
    commandId,
    scopedCommandId: commandIndexId,
    evidenceCount: evidence.length,
    acceptedAt: now,
    provider: state.integration?.externalHandoff?.target || null,
    syncCursor: state.integration?.sync?.cursor || null,
    syncMode: state.integration?.sync?.mode || "push",
    cursorAck: state.integration?.sync?.cursorAck || null,
    contractProof: state.integration?.providerContract?.proof || null,
    serviceContractProof: state.integration?.providerContract?.serviceContract?.proof || null,
    evidenceTraceProof: evidenceTrace.proof,
    claimEvidenceManifestProof: claimEvidenceManifest.proof,
    claimProofIndexProof: claimProofIndex.proof,
    claimProofIndexStatus: claimProofIndex.status,
    artifactClaimEvidenceLinksProof: artifactClaimEvidenceLinks.proof,
    artifactClaimEvidenceLinksStatus: artifactClaimEvidenceLinks.status,
    claimEvidenceTraceMatrixProof: claimEvidenceTraceMatrix.proof,
    claimEvidenceTraceMatrixStatus: claimEvidenceTraceMatrix.status,
    claimEvidenceManifestProofArtifactRefCount: Array.isArray(claimEvidenceManifest.proofArtifacts)
      ? claimEvidenceManifest.proofArtifacts.length
      : 0
  };
  const link = {
    linkId,
    rawLinkId,
    claimId,
    artifactId,
    evidence,
    evidenceTrace,
    claimEvidenceManifest,
    claimProofIndex,
    artifactClaimEvidenceLinks,
    claimEvidenceTraceMatrix,
    commandId,
    scopedCommandId: commandIndexId,
    scope,
    scopeIntegrity: buildPersistedLinkScopeIntegrity({
      recordKey: linkId,
      link: {
        linkId,
        rawLinkId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        scope
      },
      normalizedScope: scope,
      now
    }),
    actor: { actorId: actor.actorId, roles: actor.roles },
    status: "linked",
    createdAt: state.links[linkId]?.createdAt || now,
    updatedAt: now,
    recoveredAt: state.links[linkId]?.status === "recovering" ? now : state.links[linkId]?.recoveredAt || null,
    proof: proofHash({ surfaceId, linkId, claimId, artifactId, evidence, evidenceTrace, claimEvidenceManifest, claimProofIndex, artifactClaimEvidenceLinks, claimEvidenceTraceMatrix, scope, actorId: actor.actorId }),
    auditHandoff
  };
  const audit = {
    at: now,
    action: "claim-evidence-link.linked",
    commandId,
    scopedCommandId: commandIndexId,
    linkId,
    scope,
    actor: { actorId: actor.actorId, roles: actor.roles },
    evidenceTrace,
    claimEvidenceManifest,
    claimProofIndex,
    artifactClaimEvidenceLinks,
    claimEvidenceTraceMatrix,
    proof: link.proof,
    handoff: auditHandoff
  };
  const commandLedgerEntry = {
    commandKey: commandIndexId,
    commandId,
    scopedCommandId: commandIndexId,
    linkId,
    scopeKey: scope.scopeKey,
    actorId: actor.actorId,
    status: "linked",
    firstSeenAt: state.commandLedger[commandIndexId]?.firstSeenAt || now,
    lastSeenAt: now,
    replayCount: state.commandLedger[commandIndexId]?.replayCount || 0,
    failureId: null,
    resultProof: link.proof,
    recovery: { required: false, reason: null, retryAfterMs: null }
  };
  const nextState = {
    ...state,
    links: { ...state.links, [linkId]: link },
    commandIndex: { ...state.commandIndex, [commandIndexId]: linkId },
    commandLedger: { ...state.commandLedger, [commandIndexId]: commandLedgerEntry },
    auditLog: [...state.auditLog, audit].slice(-100),
    recoveredAt: state.recoveredAt
  };
  nextState.scopeIntegrity = summarizeScopeIntegrity(nextState.links, now);
  nextState.status = Object.values(nextState.links).some((candidate) => candidate.status === "recovering")
    || Object.values(nextState.commandLedger).some((entry) => entry.recovery?.required === true)
    || nextState.scopeIntegrity.quarantinedLinkCount > 0
    ? "recovery-required"
    : "ready";
  nextState.operationalHealth = buildOperationalHealth(nextState, now);
  const reportedNextState = attachReportingState(nextState, now, { ...input, command });

  return { ok: true, status: "linked", commandStatus: buildCommandStatus(commandLedgerEntry, link, now), link, state: reportedNextState, audit };
}

export function applyClaimEvidenceLinkLifecycleCommand(command = {}, persisted = {}, input = {}) {
  const now = asIso(input.now);
  const state = shapeClaimEvidenceLinkState(persisted, {
    ...input,
    now,
    integration: command.integration || command.providerContract || command.provider || input.integration
  });
  const errors = [];
  const commandId = normalizeText(command.commandId || command.id, "commandId", errors);
  const action = normalizeText(command.action || command.type, "action", errors);
  const scope = normalizeScope(command.scope || {
    tenantId: command.tenantId || input.tenantId,
    workspaceId: command.workspaceId || input.workspaceId
  }, errors);
  const actor = normalizeActor(command.actor || input.actor || {}, errors);
  if (actor.actorId && !actorCanManageLifecycle(actor)) {
    errors.push(`actor ${actor.actorId} is not permitted to manage claim evidence lifecycle`);
  }

  const patch = {};
  if (action === "enable") patch.enabled = true;
  if (action === "disable") patch.enabled = false;
  if (action === "schedule") patch.schedule = command.schedule || command.settings?.schedule || {};
  if (action === "pause-schedule") patch.schedule = { mode: "manual" };
  if (action === "resume-schedule") {
    const priorInterval = state.lifecycle?.settings?.schedule?.intervalMinutes || defaultLifecycleSettings.schedule.intervalMinutes || 60;
    const requestedInterval = command.schedule?.intervalMinutes || command.settings?.schedule?.intervalMinutes || priorInterval;
    patch.schedule = {
      mode: "interval",
      intervalMinutes: requestedInterval,
      nextRunAt: command.schedule?.nextRunAt || command.settings?.schedule?.nextRunAt || scheduleNextRunAt(requestedInterval, now)
    };
  }
  if (action === "refresh-proofs") {
    const intervalMinutes = state.lifecycle?.settings?.schedule?.intervalMinutes || defaultLifecycleSettings.schedule.intervalMinutes || 60;
    patch.schedule = state.lifecycle?.settings?.schedule?.mode === "interval"
      ? { ...state.lifecycle.settings.schedule, nextRunAt: scheduleNextRunAt(intervalMinutes, now) }
      : state.lifecycle.settings.schedule;
  }
  if (action === "configure") Object.assign(patch, command.settings || {});
  if (!lifecycleCommandActions.has(action)) {
    errors.push("action must be enable, disable, schedule, configure, pause-schedule, resume-schedule, or refresh-proofs");
  }
  if (action === "disable" && !normalizeOptionalText(command.reason)) {
    errors.push("reason must be provided when disabling lifecycle controls");
  }
  if (action === "schedule" && !command.schedule && !command.settings?.schedule) {
    errors.push("settings.schedule must be provided for schedule lifecycle commands");
  }
  if (action === "pause-schedule" && state.lifecycle?.settings?.schedule?.mode !== "interval") {
    errors.push("settings.schedule.mode must be interval before pause-schedule");
  }
  if (action === "resume-schedule" && state.lifecycle?.settings?.schedule?.mode === "interval") {
    errors.push("settings.schedule.mode must be manual before resume-schedule");
  }
  if (action === "refresh-proofs" && state.lifecycle?.enabled === false) {
    errors.push("surface is disabled by lifecycle controls");
  }

  const nextSettings = normalizeLifecycleSettings(
    { ...state.lifecycle.settings, ...patch },
    now,
    errors,
    state.lifecycle.settings
  );
  const largestCurrentEvidenceBatch = Math.max(
    0,
    ...linksForAccess(state, state.accessBoundary).map((link) => Array.isArray(link.evidence) ? link.evidence.length : 0)
  );
  if (nextSettings.maxEvidenceItems < largestCurrentEvidenceBatch) {
    errors.push(`settings.maxEvidenceItems ${nextSettings.maxEvidenceItems} is below current linked evidence batch size ${largestCurrentEvidenceBatch}`);
  }
  const scopedLifecycleCommandId = scopedCommandId(scope, commandId);
  if (errors.length > 0) {
    const failure = buildFailureEnvelope({
      now,
      commandId,
      scopedCommandId: scopedLifecycleCommandId,
      scope,
      actor,
      errors,
      boundaryConflict: null,
      retryAttempt: normalizeAttempt(command.retryAttempt ?? input.retryAttempt)
    });
    const audit = {
      at: now,
      action: "claim-evidence-link.lifecycle.rejected",
      commandId,
      scopedCommandId: scopedLifecycleCommandId,
      scope,
      actor: actor.actorId ? { actorId: actor.actorId, roles: actor.roles } : null,
      errors,
      actionableErrors: failure.actionableErrors,
      failureId: failure.failureId
    };
    const rejectedState = attachReportingState({
      ...state,
      auditLog: [...state.auditLog, audit].slice(-100)
    }, now, { ...input, command });
    return { ok: false, status: "rejected", errors, actionableErrors: failure.actionableErrors, failure, state: rejectedState, audit };
  }

  const lifecycleControls = buildLifecycleControls(nextSettings, now);
  const lifecycleValidation = { valid: true, errors: [] };
  const lifecycleNextAction = buildLifecycleNextAction(nextSettings, lifecycleControls, lifecycleValidation, now);
  const lifecycle = {
    enabled: nextSettings.enabled,
    settings: nextSettings,
    controls: lifecycleControls,
    validation: lifecycleValidation,
    nextAction: lifecycleNextAction,
    updatedAt: now,
    updatedBy: actor.actorId,
    reason: normalizeOptionalText(command.reason),
    command: {
      commandId,
      scopedCommandId: scopedLifecycleCommandId,
      action,
      acceptedAt: now,
      nextActionType: lifecycleNextAction.type,
      nextActionProof: lifecycleNextAction.proof,
      proofRefreshRequested: action === "refresh-proofs",
      scheduleMutation: ["schedule", "pause-schedule", "resume-schedule", "refresh-proofs"].includes(action)
    },
    proof: proofHash({ surfaceId, action, settings: nextSettings, scope, actorId: actor.actorId, commandId, lifecycleNextActionProof: lifecycleNextAction.proof })
  };
  const audit = {
    at: now,
    action: `claim-evidence-link.lifecycle.${action}`,
    commandId,
    scopedCommandId: scopedLifecycleCommandId,
    scope,
    actor: { actorId: actor.actorId, roles: actor.roles },
    lifecycle: {
      enabled: lifecycle.enabled,
      settings: lifecycle.settings,
      controls: lifecycle.controls,
      nextAction: lifecycle.nextAction,
      command: lifecycle.command,
      proof: lifecycle.proof
    }
  };
  const nextState = {
    ...state,
    lifecycle,
    auditLog: [...state.auditLog, audit].slice(-100)
  };
  nextState.operationalHealth = buildOperationalHealth(nextState, now);
  const reportedState = attachReportingState(nextState, now, { ...input, command });
  return {
    ok: true,
    status: action,
    lifecycle,
    lifecycleNextAction: lifecycle.nextAction,
    nextAction: reportedState.nextAction,
    commandStatus: {
      status: "accepted",
      restartSafe: true,
      commandKey: scopedLifecycleCommandId,
      checkedAt: now,
      resultProof: lifecycle.proof
    },
    state: reportedState,
    audit
  };
}

function pendingHandoffLinksForState(state) {
  return linksForAccess(state, state.accessBoundary)
    .filter((link) => linkReadyForHandoff(state, link) && !link.auditHandoff?.exportedAt)
    .sort((left, right) => Date.parse(left.updatedAt || left.createdAt) - Date.parse(right.updatedAt || right.createdAt));
}

function resolvePendingHandoffLink(state, scope, requestedLinkId) {
  const pending = pendingHandoffLinksForState(state);
  if (!requestedLinkId) return { link: pending[0] || null, pending };
  const scopedRequestedId = scopedLinkId(scope, requestedLinkId);
  return {
    link: pending.find((link) => (
      link.linkId === requestedLinkId
      || link.rawLinkId === requestedLinkId
      || link.linkId === scopedRequestedId
    )) || null,
    pending
  };
}

function buildHandoffExportPolicy({ state, link, commandId, scopedHandoffCommandId, scope, actor, requestedLinkId, pending, now }) {
  const actorBypasses = Array.isArray(actor?.roles) && actor.roles.some((role) => tenantBoundaryBypassRoles.has(role));
  const linkScope = link?.scope || null;
  const scopeMatches = sameScope(scope, linkScope);
  const requestedRawOrScopedMatch = Boolean(link && requestedLinkId && (
    link.linkId === requestedLinkId
    || link.rawLinkId === requestedLinkId
    || link.linkId === scopedLinkId(scope, requestedLinkId)
  ));
  const allowed = Boolean(link) && (actorBypasses || scopeMatches);
  const visiblePendingIds = pending.map((candidate) => candidate.linkId).sort();
  const allPendingIds = Object.values(state.links || {})
    .filter((candidate) => linkReadyForHandoff(state, candidate) && !candidate.auditHandoff?.exportedAt)
    .map((candidate) => candidate.linkId)
    .sort();
  const hiddenPendingIds = allPendingIds.filter((linkId) => !visiblePendingIds.includes(linkId));
  const violations = [
    !link ? "handoff-link-missing" : null,
    link && !scopeMatches && !actorBypasses ? "scope-mismatch" : null,
    link && requestedLinkId && !requestedRawOrScopedMatch ? "requested-link-mismatch" : null
  ].filter(Boolean);
  const payload = {
    surfaceId,
    commandId,
    scopedHandoffCommandId,
    requestedLinkId: requestedLinkId || null,
    selectedLinkId: link?.linkId || null,
    requestedScope: scope || null,
    linkScope,
    actorId: actor?.actorId || null,
    roles: actor?.roles || [],
    actorBypasses,
    violations,
    visiblePendingIds,
    hiddenPendingIds,
    accessBoundaryProof: state.accessBoundary?.proof || null,
    queueBoundaryProof: state.integration?.externalHandoff?.boundary?.proof || null
  };
  return {
    contractVersion: "aios.claim-evidence-link.handoff-export-policy.v1",
    evaluatedAt: now,
    allowed,
    mode: actorBypasses ? "cross-scope-admin" : "scoped-workspace",
    requestedScope: scope || null,
    linkScope,
    selectedLinkId: link?.linkId || null,
    requestedLinkId: requestedLinkId || null,
    scopeMatches,
    actorCanBypassTenantBoundary: actorBypasses,
    visiblePendingCount: visiblePendingIds.length,
    hiddenPendingCount: hiddenPendingIds.length,
    violations,
    accessBoundaryProof: state.accessBoundary?.proof || null,
    queueBoundaryProof: state.integration?.externalHandoff?.boundary?.proof || null,
    proof: proofHash(payload)
  };
}

function buildHandoffExportEnvelope({ state, link, commandId, scopedHandoffCommandId, scope, actor, now, exportPolicy }) {
  const providerContract = state.integration?.providerContract || {};
  const sync = state.integration?.sync || {};
  const target = state.integration?.externalHandoff?.target || {
    providerName: providerContract.provider?.providerName || defaultProviderName,
    providerInstanceId: providerContract.provider?.providerInstanceId || `${defaultProviderName}:default`,
    contractVersion: providerContract.provider?.contractVersion || "aios.claim-evidence-link.provider.v1",
    serviceContractVersion: providerContract.serviceContract?.contractVersion || null,
    handoffSink: providerContract.serviceContract?.handoffSink || null
  };
  const serviceContract = providerContract.serviceContract || {};
  const claimEvidenceManifest = evidenceManifestForLink(link);
  const claimProofIndex = buildClaimProofIndex(link, claimEvidenceManifest, link?.evidenceTrace || null);
  const artifactClaimEvidenceLinks = artifactClaimEvidenceLinksForState(state, link, claimEvidenceManifest);
  const claimEvidenceTraceMatrix = buildClaimEvidenceTraceMatrix(link, artifactClaimEvidenceLinks);
  const body = {
    surfaceId,
    envelopeType: "aios.claim-evidence-link.handoff.v1",
    commandId,
    scopedCommandId: scopedHandoffCommandId,
    exportedAt: now,
    target,
    syncCursor: sync.cursor || null,
    syncMode: sync.mode || serviceContract.syncMode || "push",
    cursorAck: sync.cursorAck || serviceContract.cursorAck || null,
    serviceContractProof: serviceContract.proof || null,
    accessBoundaryProof: state.accessBoundary?.proof || null,
    externalHandoffProof: state.integration?.externalHandoff?.proof || null,
    handoffBoundaryProof: state.integration?.externalHandoff?.boundary?.proof || null,
    exportPolicy,
    link: {
      linkId: link.linkId,
      rawLinkId: link.rawLinkId || null,
      claimId: link.claimId,
      artifactId: link.artifactId,
      scope: link.scope,
      scopeIntegrity: link.scopeIntegrity || null,
      actorId: link.actor?.actorId || null,
      evidence: link.evidence,
      evidenceSummary: summarizeEvidence(link),
      evidenceTrace: link.evidenceTrace || null,
      claimEvidenceManifest,
      claimProofArtifactCoverage: claimEvidenceManifest.coverage || null,
      claimProofIndex,
      artifactClaimEvidenceLinks,
      claimEvidenceTraceMatrix,
      proof: link.proof,
      acceptedAt: link.createdAt,
      updatedAt: link.updatedAt
    },
    exporter: {
      actorId: actor.actorId,
      roles: actor.roles,
      scope
    }
  };
  return {
    ...body,
    proof: proofHash(body)
  };
}

export function applyClaimEvidenceLinkHandoffCommand(command = {}, persisted = {}, input = {}) {
  const now = asIso(input.now);
  const state = shapeClaimEvidenceLinkState(persisted, {
    ...input,
    now,
    command,
    integration: command.integration || command.providerContract || command.provider || input.integration
  });
  const errors = [];
  const commandId = normalizeText(command.commandId || command.id, "commandId", errors);
  const scope = normalizeScope(command.scope || {
    tenantId: command.tenantId || input.tenantId,
    workspaceId: command.workspaceId || input.workspaceId
  }, errors);
  const actor = normalizeActor(command.actor || input.actor || {}, errors);
  const requestedLinkId = normalizeOptionalText(command.linkId || command.rawLinkId || input.linkId);
  const scopedHandoffCommandId = scopedCommandId(scope, commandId);
  const { link: handoffLink, pending } = resolvePendingHandoffLink(state, scope, requestedLinkId);
  const exportPolicy = buildHandoffExportPolicy({
    state,
    link: handoffLink,
    commandId,
    scopedHandoffCommandId,
    scope,
    actor,
    requestedLinkId,
    pending,
    now
  });

  if (actor.actorId && !actorCanExportHandoff(actor)) {
    errors.push(`actor ${actor.actorId} is not permitted to export claim evidence handoff`);
  }
  if (state.lifecycle?.enabled === false) {
    errors.push("surface lifecycle blocks audit handoff export");
  }
  if (state.integration?.providerContract?.ready !== true) {
    errors.push("provider contract is not ready for audit handoff export");
  }
  if (state.integration?.providerRuntime?.readyForHandoff === false) {
    errors.push("provider runtime is not ready for audit handoff export");
  }
  if (requestedLinkId && !handoffLink) {
    errors.push("requested handoff link is not pending or visible in the current scope");
  }
  if (!requestedLinkId && !handoffLink && pending.length === 0) {
    errors.push("no pending linked proof is available for audit handoff export");
  }
  if (handoffLink && exportPolicy.allowed === false && exportPolicy.violations.includes("scope-mismatch")) {
    errors.push("handoff export would cross tenant/workspace boundary");
  }

  if (errors.length > 0) {
    const failure = buildFailureEnvelope({
      now,
      commandId,
      scopedCommandId: scopedHandoffCommandId,
      scope,
      actor,
      errors,
      boundaryConflict: null,
      retryAttempt: normalizeAttempt(command.retryAttempt ?? input.retryAttempt)
    });
    const audit = {
      at: now,
      action: "claim-evidence-link.handoff.rejected",
      commandId,
      scopedCommandId: scopedHandoffCommandId,
      linkId: requestedLinkId || null,
      scope,
      actor: actor.actorId ? { actorId: actor.actorId, roles: actor.roles } : null,
      errors,
      actionableErrors: failure.actionableErrors,
      exportPolicy,
      failureId: failure.failureId
    };
    const rejectedState = attachReportingState({
      ...state,
      auditLog: [...state.auditLog, audit].slice(-100)
    }, now, { ...input, command });
    return { ok: false, status: "rejected", errors, actionableErrors: failure.actionableErrors, failure, state: rejectedState, audit };
  }

  const envelope = buildHandoffExportEnvelope({
    state,
    link: handoffLink,
    commandId,
    scopedHandoffCommandId,
    scope,
    actor,
    now,
    exportPolicy
  });
  const exportedLink = {
    ...handoffLink,
    updatedAt: now,
    auditHandoff: {
      ...(handoffLink.auditHandoff || {}),
      exportedAt: now,
      exportedBy: actor.actorId,
      exportCommandId: commandId,
      scopedExportCommandId: scopedHandoffCommandId,
      provider: envelope.target,
      syncCursor: envelope.syncCursor,
      syncMode: envelope.syncMode,
      cursorAck: envelope.cursorAck,
      serviceContractProof: envelope.serviceContractProof,
      handoffBoundaryProof: envelope.handoffBoundaryProof,
      exportPolicyProof: exportPolicy.proof,
      claimEvidenceManifestProof: envelope.link.claimEvidenceManifest?.proof || null,
      claimProofIndexProof: envelope.link.claimProofIndex?.proof || null,
      claimProofIndexStatus: envelope.link.claimProofIndex?.status || null,
      artifactClaimEvidenceLinksProof: envelope.link.artifactClaimEvidenceLinks?.proof || null,
      artifactClaimEvidenceLinksStatus: envelope.link.artifactClaimEvidenceLinks?.status || null,
      claimEvidenceTraceMatrixProof: envelope.link.claimEvidenceTraceMatrix?.proof || null,
      claimEvidenceTraceMatrixStatus: envelope.link.claimEvidenceTraceMatrix?.status || null,
      claimEvidenceManifestProofArtifactRefCount: Array.isArray(envelope.link.claimEvidenceManifest?.proofArtifacts)
        ? envelope.link.claimEvidenceManifest.proofArtifacts.length
        : 0,
      envelopeProof: envelope.proof
    }
  };
  const audit = {
    at: now,
    action: "claim-evidence-link.handoff.exported",
    commandId,
    scopedCommandId: scopedHandoffCommandId,
    linkId: exportedLink.linkId,
    scope,
    actor: { actorId: actor.actorId, roles: actor.roles },
    envelopeProof: envelope.proof,
    evidenceTraceProof: exportedLink.evidenceTrace?.proof || null,
    claimEvidenceManifestProof: envelope.link.claimEvidenceManifest?.proof || null,
    claimProofIndexProof: envelope.link.claimProofIndex?.proof || null,
    claimProofIndexStatus: envelope.link.claimProofIndex?.status || null,
    artifactClaimEvidenceLinksProof: envelope.link.artifactClaimEvidenceLinks?.proof || null,
    artifactClaimEvidenceLinksStatus: envelope.link.artifactClaimEvidenceLinks?.status || null,
    claimEvidenceTraceMatrixProof: envelope.link.claimEvidenceTraceMatrix?.proof || null,
    claimEvidenceTraceMatrixStatus: envelope.link.claimEvidenceTraceMatrix?.status || null,
    claimEvidenceManifestProofArtifactRefCount: Array.isArray(envelope.link.claimEvidenceManifest?.proofArtifacts)
      ? envelope.link.claimEvidenceManifest.proofArtifacts.length
      : 0,
    exportPolicy,
    target: envelope.target
  };
  const nextState = {
    ...state,
    links: { ...state.links, [exportedLink.linkId]: exportedLink },
    auditLog: [...state.auditLog, audit].slice(-100)
  };
  nextState.operationalHealth = buildOperationalHealth(nextState, now);
  const reportedState = attachReportingState(nextState, now, { ...input, command });
  return {
    ok: true,
    status: "exported",
    link: exportedLink,
    envelope,
    state: reportedState,
    audit
  };
}

export function describeClaimEvidenceLinkSurface(input = {}) {
  const now = asIso(input.now);
  const state = shapeClaimEvidenceLinkState(input.persistedState, {
    ...input,
    now,
    integration: input.integration || input.providerContract || input.provider
  });
  const lifecycleResult = input.lifecycleCommand
    ? applyClaimEvidenceLinkLifecycleCommand(input.lifecycleCommand, state, { now })
    : null;
  const commandResult = input.command
    ? applyClaimEvidenceLinkCommand(input.command, lifecycleResult?.state || state, { now })
    : null;
  const handoffResult = input.handoffCommand
    ? applyClaimEvidenceLinkHandoffCommand(input.handoffCommand, commandResult?.state || lifecycleResult?.state || state, { now })
    : null;
  const effectiveState = handoffResult?.state || commandResult?.state || lifecycleResult?.state || state;
  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      stateVersion,
      commands: [
        "link-claim-evidence",
        "claim-evidence-link.handoff.export",
        ...[...lifecycleCommandActions].map((action) => `claim-evidence-link.lifecycle.${action}`)
      ],
      idempotency: "commandId replays return the persisted link without mutating state unless the ledger is recovery-required, where a valid replay rebuilds the linked record and clears the recovery task",
      scope: {
        required: ["tenantId", "workspaceId"],
        commandIndex: "tenant/workspace scoped command ids isolate idempotency between tenants",
        linkIds: "claim/artifact links are persisted with a tenant/workspace scope prefix",
        accessBoundary: "state.accessBoundary exposes a proof-backed scoped view; non-admin tenant/workspace requests filter analytics, timeline, export, handoff, command ledger, and health outputs to visible links",
        scopeIntegrity: "persisted links are quarantined from scoped callers and handoff export when map key, embedded link id, top-level tenant/workspace fields, or nested scope disagree"
      },
      permissions: {
        requiredActorRoles: [...permittedLinkRoles],
        boundaryBypassRoles: [...tenantBoundaryBypassRoles],
        deniedCommands: "commands from actors without a permitted role are rejected before link mutation while preserving rejection audit reporting"
      },
      auditHandoff: "linked commands include tenant, workspace, actor, command, proof, and evidence count handoff data; handoff export commands validate provider readiness and mark one pending linked proof as exported with a proof-backed envelope",
      evidenceTrace: "accepted links persist a proof-backed evidenceTrace that maps every command claim to required proof artifact ids and resolvable proof artifact references; commands with claim-specific evidence refs are rejected if any claim lacks proof coverage",
      claimEvidenceManifest: "state links, exports, and handoff envelopes expose claimEvidenceManifest.claims[].proofArtifacts with evidence id, uri, digest, and unresolved-reference validation so required proof artifacts are directly traceable",
      claimProofIndex: "accepted and repaired links derive a proof-backed claimProofIndex keyed by claim id, listing required, resolved, and unresolved proof artifact ids for direct claim-to-evidence navigation",
      artifactClaimEvidenceLinks: "state links, previews, exports, and handoff envelopes expose policy-checked artifactClaimEvidenceLinks; handoff readiness requires each claim evidence ref to resolve and include URI or digest locator metadata, plus digest when lifecycle policy requires it",
      claimEvidenceTraceMatrix: "state links, previews, exports, and handoff envelopes expose claimEvidenceTraceMatrix rows and edge proofs so every declared claim can trace required evidence refs before audit handoff",
      restartSafeStatus: effectiveState.status,
      health: {
        degradedMode: "recovering links and provider runtime failures expose proof-backed degraded health, retry actions, and handoff blocking while preserving scoped visibility",
        actionableErrors: "rejected commands return stable error codes, remediation text, retryability, and failure proof ids",
        retryPolicy: effectiveState.operationalHealth?.retryPolicy || null
      },
      reporting: {
        analytics: "state.analytics exposes counters by status, scope, actor, action, evidence completeness, handoff queue depth, exported records, and history/timeline deltas",
        historySnapshots: "state.historySnapshots keeps normalized bounded export-proof snapshots, while state.analytics.history exposes previous/window deltas and status counts",
        exportSummary: "state.exportSummary is an export-ready audit payload with record counts, latest timeline, proof hash, export readiness, history proof, and timeline report metadata",
        timeline: "state.timeline merges link lifecycle and audit events; state.timelineReport exposes event counters, latest events per link, and proof-backed report metadata",
        claimEvidenceGapReport: "state.analytics.claimEvidenceGapReport exposes per-claim export rows for unresolved proof artifacts, non-compliant evidence locators, severity counts, and proof-backed repair targeting",
        clientReview: "state.clientReview exposes route-ready preview rows, readiness flags, acceptance requirements, validation summaries, and explainable next-step hints",
        clientWorkflow: "state.clientWorkflow binds client request/session context to primary actions, resume tokens, focused links, and handoff/export route contracts"
      },
      persistence: {
        commandLedger: "state.commandLedger normalizes legacy commandIndex data into restart-safe command status records with replay counts, result proofs, and recovery instructions",
        recoveryPlan: "state.recoveryPlan emits proof-backed rehydrate-link, reverify-proof, and repair-command-ledger tasks from persisted state after restart",
        recovery: "orphaned command ledger entries keep the surface in recovery-required status until the original scoped command is replayed or the persisted link/ledger is repaired"
      },
      integration: {
        providerContract: "state.integration.providerContract negotiates hosted-kernel provider identity, accepted capabilities, service endpoint contracts, and provider readiness proof",
        serviceContract: "state.integration.providerContract.serviceContract validates claim-write, proof-verification, audit-handoff, and cursor-ack routes before sync or external handoff can advance",
        providerRuntime: "state.integration.providerRuntime captures provider health, degraded/outage state, retry backoff, and a proof used by operational health and handoff blocking",
        requiredCapabilities: requiredProviderCapabilities,
        supportedCapabilities: [...supportedProviderCapabilities],
        syncModes: [...providerSyncModes],
        sync: "state.integration.sync exposes a proof-backed cursor, acknowledgement state, source watermarks, and service-contract target metadata for incremental provider sync",
        externalHandoff: "state.integration.externalHandoff exposes pending handoff queue state, target provider, next envelope metadata, service route, and short-lived handoff lease"
      },
      lifecycle: {
        enabled: effectiveState.lifecycle?.enabled,
        settings: effectiveState.lifecycle?.settings,
        controls: "lifecycle commands validate enable/disable, safe evidence-limit changes, digest requirements, schedule/pause/resume controls, and proof refresh scheduling",
        controlState: effectiveState.lifecycle?.controls,
        nextAction: effectiveState.nextAction
      }
    },
    state: effectiveState,
    result: commandResult,
    handoffResult,
    lifecycleResult,
    proof: {
      surfaceId,
      stateHash: proofHash({
        stateVersion: effectiveState.stateVersion,
        status: effectiveState.status,
        links: effectiveState.links,
        commandIndex: effectiveState.commandIndex
      }),
      generatedAt: now
    },
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeClaimEvidenceLinkSurface;
