import { createHash } from "node:crypto";

export const surfaceId = "aios_operator-userland_cli-logs_085";
export const surfaceGroup = "operator-userland";
export const surfaceName = "cli-logs";

const KNOWN_LEVELS = new Set(["debug", "info", "warn", "error", "fatal"]);
const KNOWN_STREAMS = new Set(["stdout", "stderr", "system", "audit"]);
const AUDIT_EVENT_TYPES = ["boot", "run", "claim", "blocker", "recovery"];
const KNOWN_AUDIT_EVENT_TYPES = new Set(AUDIT_EVENT_TYPES);
const AUDIT_EVENT_ACCESS_POLICY = {
  boot: {
    sensitivity: "low",
    browsePermission: "logs:read",
    tailPermission: "logs:tail",
    exportPermission: "logs:export",
    handoffPermission: "logs:proof",
  },
  run: {
    sensitivity: "low",
    browsePermission: "logs:read",
    tailPermission: "logs:tail",
    exportPermission: "logs:export",
    handoffPermission: "logs:export",
  },
  claim: {
    sensitivity: "medium",
    browsePermission: "logs:read",
    tailPermission: "logs:tail",
    exportPermission: "logs:export",
    handoffPermission: "logs:handoff",
  },
  blocker: {
    sensitivity: "high",
    browsePermission: "logs:proof",
    tailPermission: "logs:proof",
    exportPermission: "logs:export",
    handoffPermission: "logs:handoff",
  },
  recovery: {
    sensitivity: "high",
    browsePermission: "logs:proof",
    tailPermission: "logs:proof",
    exportPermission: "logs:export",
    handoffPermission: "logs:handoff",
  },
};
const KNOWN_CAPTURE_MODES = new Set(["hosted-kernel", "operator-session", "replay", "sidecar"]);
const KNOWN_PROVIDER_KINDS = new Set(["terminal", "pty", "shell", "remote-runner", "audit-ledger", "object-store", "webhook"]);
const KNOWN_PROVIDER_STATES = new Set(["active", "ready", "paused", "offline", "degraded"]);
const KNOWN_CAPABILITIES = new Set(["capture", "tail", "export", "proof", "retention", "redaction", "handoff"]);
const CAPABILITY_CONTRACT_FLOORS = {
  capture: 1,
  tail: 1,
  redaction: 1,
  retention: 1,
  proof: 2,
  export: 2,
  handoff: 2,
};
const KNOWN_HANDOFF_STATES = new Set(["idle", "queued", "delivered", "acknowledged", "failed", "expired", "blocked"]);
const KNOWN_OPERATOR_ROLES = new Set(["viewer", "operator", "auditor", "tenant-admin"]);
const ROLE_PERMISSIONS = {
  viewer: ["logs:read", "logs:tail"],
  operator: ["logs:read", "logs:tail", "logs:rotate"],
  auditor: ["logs:read", "logs:export", "logs:proof", "logs:handoff"],
  "tenant-admin": ["logs:read", "logs:tail", "logs:rotate", "logs:purge", "logs:export", "logs:proof", "logs:handoff"],
};
const COMMAND_PERMISSIONS = {
  status: "logs:read",
  start: "logs:rotate",
  stop: "logs:rotate",
  restart: "logs:rotate",
  rotate: "logs:rotate",
  export: "logs:export",
  purge: "logs:purge",
  tail: "logs:tail",
};
const DEFAULT_EXPORT_FORMATS = ["json", "jsonl", "csv"];
const SECRET_DETECTORS = [
  {
    type: "api-token",
    pattern: /\b((?:api[_-]?key|token|secret)\s*[:=]\s*)([A-Za-z0-9._~+/=-]{12,})/gi,
    replacement: "$1[REDACTED:api-token]",
  },
  {
    type: "bearer-token",
    pattern: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/gi,
    replacement: "Bearer [REDACTED:bearer-token]",
  },
  {
    type: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED:private-key]",
  },
  {
    type: "connection-uri",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+):([^@\s]+)@/gi,
    replacement: "$1:[REDACTED:connection-uri]@",
  },
];
const DEFAULT_PROVIDER_CONTRACTS = [
  {
    providerId: "local-pty",
    kind: "pty",
    status: "active",
    capabilities: ["capture", "tail", "redaction"],
  },
  {
    providerId: "hosted-audit-ledger",
    kind: "audit-ledger",
    status: "ready",
    capabilities: ["proof", "retention"],
  },
  {
    providerId: "kernel-log-exporter",
    kind: "object-store",
    status: "ready",
    capabilities: ["export", "handoff"],
  },
];
const LIFECYCLE_COMMANDS = new Set(["status", "start", "stop", "restart", "rotate", "export", "purge", "tail"]);
const SETTINGS_CONTROL_INTENTS = new Set(["noop", "enable", "disable", "update", "pause-schedule", "resume-schedule", "reschedule"]);
const DEFAULT_LIFECYCLE_SETTINGS = {
  enabled: true,
  retentionDays: 14,
  maxBufferEvents: 5000,
  captureStdout: true,
  captureStderr: true,
  requireProofForExport: true,
  redactSecrets: true,
  schedule: {
    enabled: false,
    cadenceMinutes: 60,
  },
};
const KNOWN_PERSISTED_STATES = new Set(["active", "disabled", "recovering", "draining", "stale", "unknown"]);
const RETRYABLE_FAILURE_CODES = new Set([
  "provider-lag",
  "provider-degraded",
  "handoff-blocked",
  "restart-recovery",
  "audit-attention",
  "failed-command",
]);
const IDEMPOTENT_COMMAND_EFFECTS = {
  status: true,
  start: true,
  stop: true,
  restart: false,
  rotate: false,
  export: true,
  purge: false,
  tail: true,
};

function asFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asBooleanSetting(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "enabled"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "disabled"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeAuditEventType(raw, command, level, message) {
  const requested = String(raw.auditEventType || raw.eventType || raw.auditType || raw.kind || raw.category || "").trim().toLowerCase();
  if (KNOWN_AUDIT_EVENT_TYPES.has(requested)) return requested;

  const commandText = String(command || "").toLowerCase();
  const messageText = String(message || "").toLowerCase();
  if (commandText.includes("boot") || messageText.includes("boot") || messageText.includes("kernel started")) return "boot";
  if (commandText.includes("claim") || messageText.includes("claim") || messageText.includes("lease acquired")) return "claim";
  if (commandText.includes("recover") || messageText.includes("recovery") || messageText.includes("replay")) return "recovery";
  if (["error", "fatal", "warn"].includes(level) || messageText.includes("blocked") || messageText.includes("blocker")) return "blocker";
  return "run";
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestPayload(payload) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function normalizeLifecycleCommand(input) {
  const rawCommand = input.lifecycleCommand || input.commandAction || input.action || "status";
  const requested = String(rawCommand).trim().toLowerCase();
  const command = LIFECYCLE_COMMANDS.has(requested) ? requested : "status";

  return {
    command,
    requested,
    accepted: command === requested,
    allowedCommands: [...LIFECYCLE_COMMANDS].sort(),
  };
}

function normalizeLifecycleSettings(input, generatedAt) {
  const raw = input.settings && typeof input.settings === "object" ? input.settings : {};
  const rawSchedule = raw.schedule && typeof raw.schedule === "object" ? raw.schedule : {};
  const retentionDays = Math.trunc(asFiniteNumber(raw.retentionDays, DEFAULT_LIFECYCLE_SETTINGS.retentionDays));
  const maxBufferEvents = Math.trunc(asFiniteNumber(raw.maxBufferEvents, DEFAULT_LIFECYCLE_SETTINGS.maxBufferEvents));
  const cadenceMinutes = Math.trunc(asFiniteNumber(rawSchedule.cadenceMinutes ?? raw.scheduleCadenceMinutes, DEFAULT_LIFECYCLE_SETTINGS.schedule.cadenceMinutes));
  const validation = [];

  if (retentionDays < 1 || retentionDays > 90) validation.push("retentionDays must be between 1 and 90");
  if (maxBufferEvents < 100 || maxBufferEvents > 100000) validation.push("maxBufferEvents must be between 100 and 100000");
  if (cadenceMinutes < 5 || cadenceMinutes > 1440) validation.push("schedule.cadenceMinutes must be between 5 and 1440");

  const enabled = asBooleanSetting(raw.enabled ?? input.enabled, DEFAULT_LIFECYCLE_SETTINGS.enabled);
  const scheduleEnabled = asBooleanSetting(rawSchedule.enabled ?? raw.scheduleEnabled, DEFAULT_LIFECYCLE_SETTINGS.schedule.enabled);
  const lastRunAt = asIsoTimestamp(rawSchedule.lastRunAt ?? input.lastScheduledRunAt, null);
  const nextRunAt = asIsoTimestamp(rawSchedule.nextRunAt ?? input.nextScheduledRunAt, null);

  return {
    valid: validation.length === 0,
    validation,
    settings: {
      enabled,
      retentionDays: Math.min(90, Math.max(1, retentionDays)),
      maxBufferEvents: Math.min(100000, Math.max(100, maxBufferEvents)),
      captureStdout: asBooleanSetting(raw.captureStdout, DEFAULT_LIFECYCLE_SETTINGS.captureStdout),
      captureStderr: asBooleanSetting(raw.captureStderr, DEFAULT_LIFECYCLE_SETTINGS.captureStderr),
      requireProofForExport: asBooleanSetting(raw.requireProofForExport, DEFAULT_LIFECYCLE_SETTINGS.requireProofForExport),
      redactSecrets: asBooleanSetting(raw.redactSecrets, DEFAULT_LIFECYCLE_SETTINGS.redactSecrets),
      schedule: {
        enabled: scheduleEnabled,
        cadenceMinutes: Math.min(1440, Math.max(5, cadenceMinutes)),
        lastRunAt,
        nextRunAt,
      },
      updatedAt: asIsoTimestamp(raw.updatedAt, generatedAt),
    },
  };
}

function addMinutes(timestamp, minutes) {
  return new Date(new Date(timestamp).getTime() + minutes * 60000).toISOString();
}

function normalizeLifecycleSettingsControl(input, settingsDescriptor, commandDescriptor, tenantBoundary, generatedAt) {
  const raw =
    input.settingsControl && typeof input.settingsControl === "object"
      ? input.settingsControl
      : input.lifecycleSettingsControl && typeof input.lifecycleSettingsControl === "object"
        ? input.lifecycleSettingsControl
        : input.control && typeof input.control === "object"
          ? input.control
          : {};
  const rawPatch = raw.patch && typeof raw.patch === "object" ? raw.patch : {};
  const rawSchedule = rawPatch.schedule && typeof rawPatch.schedule === "object" ? rawPatch.schedule : {};
  const requestedIntent = String(raw.intent || raw.action || raw.settingsAction || "noop").trim().toLowerCase();
  const intent = SETTINGS_CONTROL_INTENTS.has(requestedIntent) ? requestedIntent : "noop";
  const current = settingsDescriptor.settings;
  const requestedCadence =
    rawSchedule.cadenceMinutes ?? rawPatch.scheduleCadenceMinutes ?? raw.cadenceMinutes ?? current.schedule.cadenceMinutes;
  const cadenceMinutes = Math.min(1440, Math.max(5, Math.trunc(asFiniteNumber(requestedCadence, current.schedule.cadenceMinutes))));
  const requestedNextRunAt = asIsoTimestamp(rawSchedule.nextRunAt ?? raw.nextRunAt, null);
  const permission = "logs:rotate";
  const mutating = intent !== "noop";
  const permissionGranted = !mutating || hasBoundaryPermission(tenantBoundary, permission);
  const desired = {
    enabled:
      intent === "enable"
        ? true
        : intent === "disable"
          ? false
          : asBooleanSetting(rawPatch.enabled ?? raw.enabled, current.enabled),
    retentionDays: Math.min(90, Math.max(1, Math.trunc(asFiniteNumber(rawPatch.retentionDays, current.retentionDays)))),
    maxBufferEvents: Math.min(100000, Math.max(100, Math.trunc(asFiniteNumber(rawPatch.maxBufferEvents, current.maxBufferEvents)))),
    captureStdout: asBooleanSetting(rawPatch.captureStdout, current.captureStdout),
    captureStderr: asBooleanSetting(rawPatch.captureStderr, current.captureStderr),
    requireProofForExport: asBooleanSetting(rawPatch.requireProofForExport, current.requireProofForExport),
    redactSecrets: asBooleanSetting(rawPatch.redactSecrets, current.redactSecrets),
    schedule: {
      enabled:
        intent === "pause-schedule"
          ? false
          : intent === "resume-schedule" || intent === "reschedule"
            ? true
            : asBooleanSetting(rawSchedule.enabled ?? rawPatch.scheduleEnabled ?? raw.scheduleEnabled, current.schedule.enabled),
      cadenceMinutes,
      lastRunAt: current.schedule.lastRunAt,
      nextRunAt:
        intent === "pause-schedule"
          ? null
          : requestedNextRunAt || (intent === "resume-schedule" || intent === "reschedule" ? addMinutes(generatedAt, cadenceMinutes) : current.schedule.nextRunAt),
    },
  };
  const changedFields = [
    ...(desired.enabled !== current.enabled ? ["enabled"] : []),
    ...(desired.retentionDays !== current.retentionDays ? ["retentionDays"] : []),
    ...(desired.maxBufferEvents !== current.maxBufferEvents ? ["maxBufferEvents"] : []),
    ...(desired.captureStdout !== current.captureStdout ? ["captureStdout"] : []),
    ...(desired.captureStderr !== current.captureStderr ? ["captureStderr"] : []),
    ...(desired.requireProofForExport !== current.requireProofForExport ? ["requireProofForExport"] : []),
    ...(desired.redactSecrets !== current.redactSecrets ? ["redactSecrets"] : []),
    ...(desired.schedule.enabled !== current.schedule.enabled ? ["schedule.enabled"] : []),
    ...(desired.schedule.cadenceMinutes !== current.schedule.cadenceMinutes ? ["schedule.cadenceMinutes"] : []),
    ...(desired.schedule.nextRunAt !== current.schedule.nextRunAt ? ["schedule.nextRunAt"] : []),
  ];
  const validation = [
    ...settingsDescriptor.validation,
    ...(requestedIntent === intent ? [] : [`unknown settings control intent '${requestedIntent}'`]),
    ...(desired.captureStdout || desired.captureStderr ? [] : ["at least one stdout/stderr capture stream must remain enabled"]),
    ...(desired.retentionDays < 2 && desired.requireProofForExport ? ["proof-required exports need at least 2 retention days"] : []),
    ...(desired.schedule.enabled && !desired.schedule.nextRunAt ? ["enabled schedule requires nextRunAt"] : []),
  ];
  const blockedReason =
    !permissionGranted
      ? `missing permission: ${permission}`
      : validation.length
        ? validation[0]
        : commandDescriptor.command === "export" && changedFields.includes("redactSecrets") && !desired.redactSecrets
          ? "redaction cannot be disabled while preparing export"
          : null;
  const controlSubject = {
    surfaceId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    command: commandDescriptor.command,
    intent,
    changedFields,
    desired,
  };

  return {
    schema: "aios.cliLogs.lifecycleSettingsControl.v1",
    generatedAt,
    intent,
    requestedIntent,
    accepted: intent === requestedIntent && !blockedReason,
    mutating,
    permission,
    permissionGranted,
    state: blockedReason ? "blocked" : changedFields.length ? "ready-to-apply" : "no-change",
    blockReason: blockedReason,
    validation,
    changedFields,
    current,
    desired,
    audit: {
      digest: digestPayload(controlSubject),
      subject: controlSubject,
    },
    schedulePlan: {
      enabled: desired.schedule.enabled,
      cadenceMinutes: desired.schedule.cadenceMinutes,
      nextRunAt: desired.schedule.nextRunAt,
      dueImmediately: desired.schedule.enabled && desired.schedule.nextRunAt <= generatedAt,
    },
    route: {
      method: "PATCH",
      path: "/operator-userland/cli-logs/settings",
      enabled: !blockedReason && changedFields.length > 0,
      idempotencyKey: digestPayload(controlSubject).slice(0, 32),
    },
  };
}

function normalizeOperatorRoles(input) {
  const rawRoles = Array.isArray(input.operatorRoles)
    ? input.operatorRoles
    : Array.isArray(input.roles)
      ? input.roles
      : input.operatorRole
        ? [input.operatorRole]
        : ["viewer"];
  const roles = [...new Set(rawRoles.map((role) => String(role).trim().toLowerCase()).filter((role) => KNOWN_OPERATOR_ROLES.has(role)))];
  return roles.length ? roles : ["viewer"];
}

function normalizeWorkspaceGrant(rawGrant, index, activeTenantId, activeWorkspaceId, generatedAt, source) {
  const raw = rawGrant && typeof rawGrant === "object" ? rawGrant : { workspaceId: rawGrant };
  const tenantId = String(raw.tenantId || raw.tenant || activeTenantId);
  const workspaceId = String(raw.workspaceId || raw.workspace || raw.id || (index === 0 ? activeWorkspaceId : ""));
  const rawPermissions = Array.isArray(raw.permissions) ? raw.permissions : Array.isArray(raw.scopes) ? raw.scopes : ["logs:read"];
  const permissions = [...new Set(rawPermissions.map((permission) => String(permission).trim()).filter(Boolean))].sort();
  const expiresAt = asIsoTimestamp(raw.expiresAt || raw.validUntil, null);
  const expired = Boolean(expiresAt && expiresAt <= generatedAt);
  const revoked = asBooleanSetting(raw.revoked, false);
  const grantSubject = {
    surfaceId,
    tenantId,
    workspaceId,
    source,
    permissions,
    expiresAt,
  };

  return {
    grantId: String(raw.grantId || raw.id || digestPayload(grantSubject).slice(0, 24)),
    source,
    tenantId,
    workspaceId,
    permissions,
    state: revoked ? "revoked" : expired ? "expired" : workspaceId ? "active" : "invalid",
    expiresAt,
    boundaryHash: digestPayload(grantSubject),
  };
}

function normalizeWorkspaceGrants(input, tenant, workspace, tenantId, workspaceId, generatedAt) {
  const rawObjectGrants = [
    ...(Array.isArray(input.workspaceGrants) ? input.workspaceGrants : []),
    ...(Array.isArray(input.allowedWorkspaceGrants) ? input.allowedWorkspaceGrants : []),
    ...(Array.isArray(workspace.allowedWorkspaceGrants) ? workspace.allowedWorkspaceGrants : []),
  ];
  const rawLegacyWorkspaceIds = [
    ...(Array.isArray(input.allowedWorkspaceIds) ? input.allowedWorkspaceIds : []),
    ...(Array.isArray(workspace.allowedWorkspaceIds) ? workspace.allowedWorkspaceIds : []),
  ];
  const grants = [
    normalizeWorkspaceGrant(
      {
        grantId: "active-workspace",
        tenantId,
        workspaceId,
        permissions: ["logs:read", "logs:tail", "logs:export", "logs:proof", "logs:handoff"],
      },
      0,
      tenantId,
      workspaceId,
      generatedAt,
      "active-workspace"
    ),
    ...rawLegacyWorkspaceIds.map((id, index) =>
      normalizeWorkspaceGrant({ tenantId, workspaceId: id, permissions: ["logs:read", "logs:tail"] }, index + 1, tenantId, workspaceId, generatedAt, "legacy-allowlist")
    ),
    ...rawObjectGrants.map((grant, index) => normalizeWorkspaceGrant(grant, index + 1, tenantId, workspaceId, generatedAt, "workspace-grant")),
  ];
  const grantByKey = new Map();
  for (const grant of grants) {
    const key = `${grant.tenantId}:${grant.workspaceId}:${grant.grantId}`;
    if (!grantByKey.has(key)) grantByKey.set(key, grant);
  }

  return [...grantByKey.values()].sort((left, right) => {
    if (left.tenantId !== right.tenantId) return left.tenantId.localeCompare(right.tenantId);
    if (left.workspaceId !== right.workspaceId) return left.workspaceId.localeCompare(right.workspaceId);
    return left.grantId.localeCompare(right.grantId);
  });
}

function normalizeTenantBoundary(input, generatedAt) {
  const tenant = input.tenant && typeof input.tenant === "object" ? input.tenant : {};
  const workspace = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const roles = normalizeOperatorRoles(input);
  const grantedPermissions = new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role] || []));
  const explicitPermissions = Array.isArray(input.permissions)
    ? input.permissions.map((permission) => String(permission).trim()).filter(Boolean)
    : [];
  for (const permission of explicitPermissions) grantedPermissions.add(permission);

  const tenantId = String(input.tenantId || tenant.id || tenant.tenantId || "default-tenant");
  const workspaceId = String(input.workspaceId || workspace.id || workspace.workspaceId || "default-workspace");
  const workspaceGrants = normalizeWorkspaceGrants(input, tenant, workspace, tenantId, workspaceId, generatedAt);
  const activeWorkspaceGrants = workspaceGrants.filter((grant) => grant.state === "active");
  const uniqueWorkspaceIds = [...new Set(activeWorkspaceGrants.filter((grant) => grant.tenantId === tenantId).map((grant) => grant.workspaceId).filter(Boolean))];
  const crossTenantRequested = asBooleanSetting(input.allowCrossTenantLogs, false);
  const crossWorkspaceRequested = asBooleanSetting(input.allowCrossWorkspaceLogs, false);

  return {
    schema: "aios.cliLogs.tenantBoundary.v1",
    generatedAt,
    tenantId,
    workspaceId,
    allowedWorkspaceIds: uniqueWorkspaceIds,
    workspaceGrants,
    roles,
    permissions: [...grantedPermissions].sort(),
    isolationMode: crossTenantRequested ? "advisory-with-explicit-grant" : "enforced",
    crossWorkspaceMode: crossWorkspaceRequested ? "grant-bound-workspaces" : "active-workspace-only",
    requestedBoundaryRelaxation: {
      crossTenant: crossTenantRequested,
      crossWorkspace: crossWorkspaceRequested,
    },
  };
}

function scopeLogEvent(raw, boundary) {
  const tenantId = String(raw.tenantId || raw.tenant || raw.accountId || boundary.tenantId);
  const workspaceId = String(raw.workspaceId || raw.workspace || raw.projectId || boundary.workspaceId);
  const activeGrant = boundary.workspaceGrants.find(
    (grant) =>
      grant.state === "active" &&
      grant.tenantId === tenantId &&
      grant.workspaceId === workspaceId &&
      (grant.permissions.includes("logs:read") || grant.permissions.includes("*"))
  );
  const tenantAllowed = tenantId === boundary.tenantId || (boundary.isolationMode === "advisory-with-explicit-grant" && Boolean(activeGrant));
  const workspaceAllowed =
    workspaceId === boundary.workspaceId ||
    (boundary.crossWorkspaceMode === "grant-bound-workspaces" && Boolean(activeGrant));
  const deniedReason = !tenantAllowed
    ? "tenant-mismatch"
    : !workspaceAllowed
      ? "workspace-outside-boundary"
      : null;

  return {
    tenantId,
    workspaceId,
    allowed: !deniedReason,
    deniedReason,
    grantId: activeGrant?.grantId || (workspaceId === boundary.workspaceId && tenantId === boundary.tenantId ? "active-workspace" : null),
    grantState: activeGrant?.state || (workspaceId === boundary.workspaceId && tenantId === boundary.tenantId ? "active" : "missing"),
    boundaryHash: activeGrant?.boundaryHash || null,
  };
}

function summarizeBoundaryAccess(events, boundary) {
  const denied = events.filter((event) => !event.scope.allowed);
  const permitted = events.filter((event) => event.scope.allowed);
  const deniedByReason = denied.reduce((accumulator, event) => {
    accumulator[event.scope.deniedReason] = (accumulator[event.scope.deniedReason] || 0) + 1;
    return accumulator;
  }, {});
  const permittedByGrant = permitted.reduce((accumulator, event) => {
    const grantId = event.scope.grantId || "ungranted";
    accumulator[grantId] = (accumulator[grantId] || 0) + 1;
    return accumulator;
  }, {});
  const inactiveGrantCount = boundary.workspaceGrants.filter((grant) => grant.state !== "active").length;

  return {
    ...boundary,
    eventScope: {
      totalEvents: events.length,
      permittedEvents: events.length - denied.length,
      deniedEvents: denied.length,
      deniedByReason: Object.fromEntries(Object.entries(deniedByReason).sort(([left], [right]) => left.localeCompare(right))),
      permittedByGrant: Object.fromEntries(Object.entries(permittedByGrant).sort(([left], [right]) => left.localeCompare(right))),
      inactiveGrantCount,
      scopedWorkspaceCount: new Set(permitted.map((event) => `${event.scope.tenantId}:${event.scope.workspaceId}`)).size,
    },
    safeDefaultApplied: boundary.roles.includes("viewer") && boundary.roles.length === 1,
    handoffSafe: denied.length === 0 && inactiveGrantCount === 0,
  };
}

function hasBoundaryPermission(boundary, permission) {
  return !permission || boundary.permissions.includes(permission);
}

function auditEventPolicyFor(type) {
  return AUDIT_EVENT_ACCESS_POLICY[type] || AUDIT_EVENT_ACCESS_POLICY.run;
}

function buildAuditEventAccessGate(auditEventTypes, boundary, command) {
  const types = auditEventTypes.length ? auditEventTypes : ["run"];
  const policyRows = types.map((type) => {
    const policy = auditEventPolicyFor(type);
    const commandPermission =
      command === "tail"
        ? policy.tailPermission
        : command === "export" || command === "purge"
          ? policy.exportPermission
          : command === "status"
            ? policy.browsePermission
            : policy.browsePermission;
    const handoffPermissionRequired = ["export", "purge"].includes(command) && ["medium", "high"].includes(policy.sensitivity);
    const requiredPermissions = [
      policy.browsePermission,
      commandPermission,
      ...(handoffPermissionRequired ? [policy.handoffPermission] : []),
    ].filter((permission, index, all) => permission && all.indexOf(permission) === index);
    const missingPermissions = requiredPermissions.filter((permission) => !hasBoundaryPermission(boundary, permission));

    return {
      auditEventType: type,
      sensitivity: policy.sensitivity,
      browsePermission: policy.browsePermission,
      commandPermission,
      handoffPermission: handoffPermissionRequired ? policy.handoffPermission : null,
      requiredPermissions,
      missingPermissions,
      allowed: missingPermissions.length === 0,
    };
  });
  const missingPermissions = [...new Set(policyRows.flatMap((row) => row.missingPermissions))].sort();
  const restrictedEventTypes = policyRows.filter((row) => !row.allowed).map((row) => row.auditEventType).sort();
  const sensitiveEventTypes = policyRows
    .filter((row) => ["medium", "high"].includes(row.sensitivity))
    .map((row) => row.auditEventType)
    .sort();

  return {
    schema: "aios.cliLogs.auditEventAccessGate.v1",
    command,
    state: missingPermissions.length ? "restricted" : sensitiveEventTypes.length ? "sensitive-ready" : "ready",
    allowed: missingPermissions.length === 0,
    browseAllowed: policyRows.every((row) => !row.missingPermissions.includes(row.browsePermission)),
    tailAllowed: command !== "tail" || policyRows.every((row) => !row.missingPermissions.includes(row.commandPermission)),
    exportAllowed: !["export", "purge"].includes(command) || policyRows.every((row) => row.allowed),
    requiresHandoffAudit: policyRows.some((row) => row.handoffPermission),
    sensitiveEventTypes,
    restrictedEventTypes,
    missingPermissions,
    policies: policyRows,
  };
}

function buildWorkspaceAccessManifest(events, boundary, commandDescriptor, generatedAt) {
  const requiredPermission = COMMAND_PERMISSIONS[commandDescriptor.command] || "logs:read";
  const partitionMap = new Map();
  for (const event of events) {
    const key = `${event.scope.tenantId}:${event.scope.workspaceId}`;
    const partition = partitionMap.get(key) || {
      tenantId: event.scope.tenantId,
      workspaceId: event.scope.workspaceId,
      eventIds: [],
      deniedEventIds: [],
      grantIds: new Set(),
      levels: new Set(),
      streams: new Set(),
      auditEventTypes: new Set(),
      auditEventTypeCounts: {},
      firstEventAt: event.timestamp,
      lastEventAt: event.timestamp,
      maxSequence: 0,
    };
    partition.eventIds.push(event.id);
    if (!event.scope.allowed) partition.deniedEventIds.push(event.id);
    if (event.scope.grantId) partition.grantIds.add(event.scope.grantId);
    partition.levels.add(event.level);
    partition.streams.add(event.stream);
    partition.auditEventTypes.add(event.auditEventType);
    partition.auditEventTypeCounts[event.auditEventType] = (partition.auditEventTypeCounts[event.auditEventType] || 0) + 1;
    partition.firstEventAt = partition.firstEventAt < event.timestamp ? partition.firstEventAt : event.timestamp;
    partition.lastEventAt = partition.lastEventAt > event.timestamp ? partition.lastEventAt : event.timestamp;
    partition.maxSequence = Math.max(partition.maxSequence, event.sequence);
    partitionMap.set(key, partition);
  }
  const partitions = [...partitionMap.values()]
    .map((partition) => {
      const insideActiveWorkspace = partition.tenantId === boundary.tenantId && partition.workspaceId === boundary.workspaceId;
      const grantAllowsRead = [...partition.grantIds].some((grantId) => {
        const grant = boundary.workspaceGrants.find((entry) => entry.grantId === grantId);
        return grant && grant.state === "active" && (grant.permissions.includes("logs:read") || grant.permissions.includes("*"));
      });
      const commandPermissionGranted = hasBoundaryPermission(boundary, requiredPermission);
      const auditEventAccess = buildAuditEventAccessGate([...partition.auditEventTypes].sort(), boundary, commandDescriptor.command);
      const grantReadable = insideActiveWorkspace || grantAllowsRead;
      const readable = partition.deniedEventIds.length === 0 && grantReadable && auditEventAccess.browseAllowed;
      const exportable = readable && commandPermissionGranted && hasBoundaryPermission(boundary, "logs:export") && auditEventAccess.exportAllowed;
      const tailAllowed = readable && hasBoundaryPermission(boundary, "logs:tail") && auditEventAccess.tailAllowed;
      const routeSubject = {
        surfaceId,
        tenantId: partition.tenantId,
        workspaceId: partition.workspaceId,
        command: commandDescriptor.command,
        requiredPermission,
        maxSequence: partition.maxSequence,
        eventCount: partition.eventIds.length,
        auditEventTypes: [...partition.auditEventTypes].sort(),
        auditEventAccessState: auditEventAccess.state,
      };

      return {
        tenantId: partition.tenantId,
        workspaceId: partition.workspaceId,
        eventCount: partition.eventIds.length,
        deniedEventCount: partition.deniedEventIds.length,
        deniedEventIds: partition.deniedEventIds,
        grantIds: [...partition.grantIds].sort(),
        firstEventAt: partition.firstEventAt,
        lastEventAt: partition.lastEventAt,
        maxSequence: partition.maxSequence,
        levels: [...partition.levels].sort(),
        streams: [...partition.streams].sort(),
        auditEventTypes: [...partition.auditEventTypes].sort(),
        auditEventTypeCounts: Object.fromEntries(Object.entries(partition.auditEventTypeCounts).sort(([left], [right]) => left.localeCompare(right))),
        auditEventAccess,
        access: {
          readable,
          tailAllowed,
          exportable,
          commandPermissionGranted,
          requiredPermission,
          reason:
            partition.deniedEventIds.length
              ? "partition contains tenant/workspace-denied records"
              : !grantReadable
                ? "no active workspace grant permits this partition"
                : !auditEventAccess.browseAllowed
                  ? `operator is missing audit browse permissions: ${auditEventAccess.missingPermissions.join(", ")}`
                  : !readable
                    ? "audit event access policy restricted this partition"
                    : !commandPermissionGranted
                      ? `operator is missing ${requiredPermission}`
                      : !auditEventAccess.allowed && ["export", "purge", "tail"].includes(commandDescriptor.command)
                        ? `audit event policy restricted ${auditEventAccess.restrictedEventTypes.join(", ")} events`
                        : "partition is inside active boundary",
        },
        routes: {
          tail: {
            method: "GET",
            path: "/operator-userland/cli-logs/tail",
            enabled: tailAllowed,
            query: {
              tenantId: partition.tenantId,
              workspaceId: partition.workspaceId,
              afterSequence: partition.maxSequence,
              auditEventTypes: [...partition.auditEventTypes].sort(),
            },
          },
          export: {
            method: "POST",
            path: "/operator-userland/cli-logs/export",
            enabled: exportable,
            idempotencyKey: digestPayload({ ...routeSubject, rel: "workspace-export" }).slice(0, 32),
            auditGate: {
              state: auditEventAccess.state,
              requiresHandoffAudit: auditEventAccess.requiresHandoffAudit,
              missingPermissions: auditEventAccess.missingPermissions,
            },
          },
        },
        proofDigest: digestPayload(routeSubject),
      };
    })
    .sort((left, right) => left.tenantId.localeCompare(right.tenantId) || left.workspaceId.localeCompare(right.workspaceId));
  const deniedPartitions = partitions.filter((partition) => partition.deniedEventCount > 0 || !partition.access.readable);
  const restrictedAuditPartitions = partitions.filter((partition) => partition.auditEventAccess.state === "restricted");
  const sensitiveAuditPartitions = partitions.filter((partition) => partition.auditEventAccess.sensitiveEventTypes.length > 0);
  const manifestSubject = {
    surfaceId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    command: commandDescriptor.command,
    requiredPermission,
    partitionProofs: partitions.map((partition) => partition.proofDigest),
    restrictedAuditPartitions: restrictedAuditPartitions.map((partition) => `${partition.tenantId}:${partition.workspaceId}`),
  };

  return {
    schema: "aios.cliLogs.workspaceAccessManifest.v1",
    generatedAt,
    state: deniedPartitions.length || restrictedAuditPartitions.length ? "restricted" : sensitiveAuditPartitions.length ? "sensitive-ready" : "ready",
    requiredPermission,
    commandPermissionGranted: hasBoundaryPermission(boundary, requiredPermission),
    activeTenantId: boundary.tenantId,
    activeWorkspaceId: boundary.workspaceId,
    partitionCount: partitions.length,
    readablePartitionCount: partitions.filter((partition) => partition.access.readable).length,
    deniedPartitionCount: deniedPartitions.length,
    auditEventGate: {
      restrictedPartitionCount: restrictedAuditPartitions.length,
      sensitivePartitionCount: sensitiveAuditPartitions.length,
      restrictedEventTypes: [...new Set(restrictedAuditPartitions.flatMap((partition) => partition.auditEventAccess.restrictedEventTypes))].sort(),
      sensitiveEventTypes: [...new Set(sensitiveAuditPartitions.flatMap((partition) => partition.auditEventAccess.sensitiveEventTypes))].sort(),
      missingPermissions: [...new Set(restrictedAuditPartitions.flatMap((partition) => partition.auditEventAccess.missingPermissions))].sort(),
      handoffAuditRequired: sensitiveAuditPartitions.some((partition) => partition.auditEventAccess.requiresHandoffAudit),
    },
    partitions,
    audit: {
      digest: digestPayload(manifestSubject),
      subject: manifestSubject,
    },
  };
}

function buildLifecycleState(commandDescriptor, settingsDescriptor, events, analytics, generatedAt, tenantBoundary, workspaceAccessManifest = null) {
  const settings = settingsDescriptor.settings;
  const lastEventAt = events
    .map((event) => event.timestamp)
    .sort()
    .at(-1) || null;
  const proofMissing = settings.requireProofForExport && analytics.exportableEvents > analytics.proofLinkedEvents;
  const streamsDisabled = !settings.captureStdout && !settings.captureStderr;
  const requiredPermission = COMMAND_PERMISSIONS[commandDescriptor.command] || "logs:read";
  const boundaryClean = !tenantBoundary || tenantBoundary.eventScope.deniedEvents === 0;
  const workspaceManifestClean = !workspaceAccessManifest || workspaceAccessManifest.deniedPartitionCount === 0;
  const auditEventGateClean = !workspaceAccessManifest || workspaceAccessManifest.auditEventGate.restrictedPartitionCount === 0;
  const permissionAllows = (permission) => !tenantBoundary || hasBoundaryPermission(tenantBoundary, permission);
  const blockableBoundaryCommands = ["export", "purge", "tail"];
  const commandBlockReasons = [
    ...(tenantBoundary && !hasBoundaryPermission(tenantBoundary, requiredPermission) ? [`missing permission: ${requiredPermission}`] : []),
    ...(workspaceAccessManifest && !workspaceAccessManifest.commandPermissionGranted
      ? [`workspace access manifest missing permission: ${workspaceAccessManifest.requiredPermission}`]
      : []),
    ...(workspaceAccessManifest && workspaceAccessManifest.auditEventGate.restrictedPartitionCount > 0 && blockableBoundaryCommands.includes(commandDescriptor.command)
      ? [`audit event access restricted ${workspaceAccessManifest.auditEventGate.restrictedEventTypes.join(", ")} events`]
      : []),
    ...(workspaceAccessManifest && workspaceAccessManifest.deniedPartitionCount > 0 && blockableBoundaryCommands.includes(commandDescriptor.command)
      ? ["workspace access manifest restricted one or more partitions"]
      : []),
    ...(tenantBoundary && tenantBoundary.eventScope.deniedEvents > 0 && ["export", "purge"].includes(commandDescriptor.command)
      ? ["tenant/workspace boundary denied one or more records"]
      : []),
    ...(!settings.enabled && !["status", "start"].includes(commandDescriptor.command) ? ["log capture is disabled"] : []),
    ...(streamsDisabled && ["start", "restart", "tail"].includes(commandDescriptor.command) ? ["stdout and stderr capture are both disabled"] : []),
    ...(!settingsDescriptor.valid ? ["settings validation failed"] : []),
    ...(proofMissing && commandDescriptor.command === "export" ? ["export requires proof-linked events"] : []),
  ];
  const commandBlocked = commandBlockReasons[0] || null;

  const requestedEffect = commandBlocked
    ? "blocked"
    : commandDescriptor.command === "start"
      ? "enable-capture"
      : commandDescriptor.command === "stop"
        ? "disable-capture"
        : commandDescriptor.command === "restart"
          ? "restart-capture"
          : commandDescriptor.command === "rotate"
            ? "rotate-buffer"
            : commandDescriptor.command === "export"
              ? "prepare-export"
              : commandDescriptor.command === "purge"
                ? "apply-retention"
                : commandDescriptor.command === "tail"
                  ? "stream-tail"
                  : "inspect-status";

  return {
    generatedAt,
    command: commandDescriptor,
    enabled: settings.enabled,
    requestedEffect,
    blocked: Boolean(commandBlocked),
    blockReason: commandBlocked,
    blockReasons: commandBlockReasons,
    requiredPermission,
    permissionGranted: tenantBoundary ? hasBoundaryPermission(tenantBoundary, requiredPermission) : true,
    health:
      commandBlocked || analytics.byLevel.fatal > 0
        ? "blocked"
        : analytics.failedCommands > 0 || analytics.byLevel.error > 0
          ? "degraded"
          : settings.enabled
            ? "active"
            : "disabled",
    controls: {
      canEnable: !settings.enabled && permissionAllows("logs:rotate"),
      canDisable: settings.enabled && permissionAllows("logs:rotate"),
      canExport: settings.enabled && boundaryClean && workspaceManifestClean && auditEventGateClean && permissionAllows("logs:export") && analytics.exportableEvents > 0 && !proofMissing,
      canRotate: settings.enabled && permissionAllows("logs:rotate") && events.length >= Math.floor(settings.maxBufferEvents * 0.8),
      canPurge: boundaryClean && workspaceManifestClean && auditEventGateClean && permissionAllows("logs:purge") && (settings.retentionDays < DEFAULT_LIFECYCLE_SETTINGS.retentionDays || events.length > settings.maxBufferEvents),
      canTail: settings.enabled && workspaceManifestClean && auditEventGateClean && permissionAllows("logs:tail") && (settings.captureStdout || settings.captureStderr),
    },
    workspaceAccess: workspaceAccessManifest
      ? {
          state: workspaceAccessManifest.state,
          partitionCount: workspaceAccessManifest.partitionCount,
          readablePartitionCount: workspaceAccessManifest.readablePartitionCount,
          deniedPartitionCount: workspaceAccessManifest.deniedPartitionCount,
          auditEventGate: workspaceAccessManifest.auditEventGate,
          auditDigest: workspaceAccessManifest.audit.digest,
        }
      : null,
    schedule: {
      enabled: settings.schedule.enabled,
      cadenceMinutes: settings.schedule.cadenceMinutes,
      lastRunAt: settings.schedule.lastRunAt,
      nextRunAt: settings.schedule.nextRunAt,
      state: settings.schedule.enabled
        ? settings.schedule.nextRunAt && settings.schedule.nextRunAt < generatedAt
          ? "due"
          : "scheduled"
        : "manual",
    },
    cursor: {
      lastEventAt,
      lastSequence: events.reduce((max, event) => Math.max(max, event.sequence), 0),
      bufferedEvents: events.length,
      bufferUtilization: Number((events.length / settings.maxBufferEvents).toFixed(4)),
    },
  };
}

function normalizePersistedCheckpointEntry(rawEntry, index, generatedAt, activeBootId) {
  const raw = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
  const sequence = Math.max(0, Math.trunc(asFiniteNumber(raw.sequence ?? raw.lastSequence ?? raw.watermarkSequence, 0)));
  const persistedAt = asIsoTimestamp(raw.persistedAt || raw.lastPersistedAt || raw.createdAt || raw.timestamp, null);
  const eventAt = asIsoTimestamp(raw.eventAt || raw.lastEventAt || raw.watermarkAt, null);
  const state = String(raw.state || raw.status || "committed").trim().toLowerCase();
  const normalizedState = ["committed", "prepared", "failed", "superseded"].includes(state) ? state : "committed";
  const bootId = raw.bootId || raw.activeBootId ? String(raw.bootId || raw.activeBootId) : activeBootId;
  const integrityRootHash = raw.integrityRootHash || raw.rootHash || raw.digest?.rootHash || null;

  return {
    checkpointId: String(raw.checkpointId || raw.id || digestPayload({
      surfaceId,
      index,
      sequence,
      persistedAt,
      integrityRootHash,
      bootId,
    }).slice(0, 24)),
    state: normalizedState,
    sequence,
    eventAt,
    persistedAt,
    bootId,
    integrityRootHash: integrityRootHash ? String(integrityRootHash) : null,
    durable: normalizedState === "committed" && Boolean(persistedAt),
    staleRelativeToBoot: Boolean(bootId && activeBootId && bootId !== activeBootId),
  };
}

function normalizePersistedCommandLedgerEntry(rawEntry, index, generatedAt) {
  const raw = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
  const command = String(raw.command || raw.name || "status").trim().toLowerCase();
  const state = String(raw.state || raw.status || "committed").trim().toLowerCase();
  const normalizedCommand = LIFECYCLE_COMMANDS.has(command) ? command : "status";
  const normalizedState = ["prepared", "pending", "running", "committed", "failed", "aborted"].includes(state) ? state : "committed";
  const requestedAt = asIsoTimestamp(raw.requestedAt || raw.createdAt || raw.timestamp, null);
  const completedAt = asIsoTimestamp(raw.completedAt || raw.committedAt || raw.finishedAt, null);
  const idempotencyKey = raw.idempotencyKey || raw.key || null;
  const transactionId = raw.transactionId || raw.id || digestPayload({
    surfaceId,
    index,
    command: normalizedCommand,
    state: normalizedState,
    requestedAt,
    idempotencyKey,
  }).slice(0, 24);

  return {
    transactionId: String(transactionId),
    command: normalizedCommand,
    state: normalizedState,
    idempotent: IDEMPOTENT_COMMAND_EFFECTS[normalizedCommand] === true,
    idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
    requestedAt,
    completedAt,
    sequence: Math.max(0, Math.trunc(asFiniteNumber(raw.sequence ?? raw.expectedSequence, 0))),
    restartDisposition:
      ["prepared", "pending", "running"].includes(normalizedState)
        ? IDEMPOTENT_COMMAND_EFFECTS[normalizedCommand] === true
          ? "replay-safe"
          : "operator-ack-required"
        : normalizedState === "failed"
          ? "inspect-failure"
          : "settled",
  };
}

function normalizePersistedState(input, generatedAt, settings, tenantBoundary) {
  const raw =
    input.persistedState && typeof input.persistedState === "object"
      ? input.persistedState
      : input.state && typeof input.state === "object"
        ? input.state
        : {};
  const rawCursor = raw.cursor && typeof raw.cursor === "object" ? raw.cursor : {};
  const rawLastCommand = raw.lastCommand && typeof raw.lastCommand === "object" ? raw.lastCommand : {};
  const status = String(raw.status || raw.lifecycleStatus || (settings.enabled ? "active" : "disabled")).trim().toLowerCase();
  const lastPersistedAt = asIsoTimestamp(raw.lastPersistedAt || raw.updatedAt || raw.persistedAt, null);
  const lastBootId = raw.bootId || raw.lastBootId ? String(raw.bootId || raw.lastBootId) : null;
  const activeBootId = String(input.bootId || input.ingest?.bootId || lastBootId || "boot-unknown");
  const lastSequence = Math.max(0, Math.trunc(asFiniteNumber(rawCursor.lastSequence ?? raw.lastSequence, 0)));
  const lastEventAt = asIsoTimestamp(rawCursor.lastEventAt || raw.lastEventAt, null);
  const rootHash = raw.integrityRootHash || raw.rootHash ? String(raw.integrityRootHash || raw.rootHash) : null;
  const lastCommandName = rawLastCommand.command || raw.command ? String(rawLastCommand.command || raw.command).trim().toLowerCase() : null;
  const lastCommandState = rawLastCommand.state || raw.commandState ? String(rawLastCommand.state || raw.commandState).trim().toLowerCase() : null;
  const outstandingCommand =
    lastCommandName && LIFECYCLE_COMMANDS.has(lastCommandName) && ["pending", "running", "prepared"].includes(lastCommandState)
      ? {
          command: lastCommandName,
          state: lastCommandState,
          idempotent: IDEMPOTENT_COMMAND_EFFECTS[lastCommandName] === true,
          idempotencyKey: rawLastCommand.idempotencyKey || raw.idempotencyKey || null,
          requestedAt: asIsoTimestamp(rawLastCommand.requestedAt || raw.commandRequestedAt, null),
        }
      : null;
  const rawCheckpoints = [
    ...(Array.isArray(raw.checkpoints) ? raw.checkpoints : []),
    ...(Array.isArray(raw.checkpointJournal) ? raw.checkpointJournal : []),
    ...(Array.isArray(raw.snapshots) ? raw.snapshots : []),
  ];
  const checkpointJournal = rawCheckpoints
    .map((entry, index) => normalizePersistedCheckpointEntry(entry, index, generatedAt, activeBootId))
    .filter((entry) => entry.sequence > 0 || entry.integrityRootHash || entry.persistedAt)
    .sort((left, right) => left.sequence - right.sequence || String(left.persistedAt || "").localeCompare(String(right.persistedAt || "")));
  const latestDurableCheckpoint = [...checkpointJournal]
    .filter((entry) => entry.durable)
    .sort((left, right) => right.sequence - left.sequence || String(right.persistedAt || "").localeCompare(String(left.persistedAt || "")))[0] || null;
  const commandLedgerSource = [
    ...(Array.isArray(raw.commandLedger) ? raw.commandLedger : []),
    ...(Array.isArray(raw.pendingCommands) ? raw.pendingCommands : []),
    ...(Array.isArray(raw.recentCommands) ? raw.recentCommands : []),
    ...(outstandingCommand ? [outstandingCommand] : []),
  ];
  const commandLedger = commandLedgerSource
    .map((entry, index) => normalizePersistedCommandLedgerEntry(entry, index, generatedAt))
    .sort((left, right) => String(left.requestedAt || "").localeCompare(String(right.requestedAt || "")) || left.transactionId.localeCompare(right.transactionId));
  const activeLedger = commandLedger.filter((entry) => ["prepared", "pending", "running"].includes(entry.state));
  const ledgerKeyCounts = commandLedger.reduce((accumulator, entry) => {
    if (entry.idempotencyKey) accumulator[entry.idempotencyKey] = (accumulator[entry.idempotencyKey] || 0) + 1;
    return accumulator;
  }, {});
  const duplicateIdempotencyKeys = Object.entries(ledgerKeyCounts)
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  const staleAfterMs = Math.max(60000, Math.trunc(asFiniteNumber(raw.staleAfterMs ?? input.staleAfterMs, settings.schedule.cadenceMinutes * 2 * 60000)));
  const ageMs = lastPersistedAt ? Math.max(0, new Date(generatedAt).getTime() - new Date(lastPersistedAt).getTime()) : null;
  const stale = ageMs === null || ageMs > staleAfterMs;
  const bootChanged = Boolean(lastBootId && activeBootId && lastBootId !== activeBootId);
  const checkpointAnomalies = [
    ...(latestDurableCheckpoint && latestDurableCheckpoint.sequence < lastSequence ? ["cursor-ahead-of-durable-checkpoint"] : []),
    ...(latestDurableCheckpoint && latestDurableCheckpoint.integrityRootHash && rootHash && latestDurableCheckpoint.integrityRootHash !== rootHash
      ? ["checkpoint-root-differs-from-cursor"]
      : []),
    ...checkpointJournal.filter((entry) => entry.persistedAt && entry.persistedAt > generatedAt).map((entry) => `future-checkpoint:${entry.checkpointId}`),
    ...checkpointJournal.filter((entry) => entry.staleRelativeToBoot).map((entry) => `checkpoint-from-previous-boot:${entry.checkpointId}`),
    ...duplicateIdempotencyKeys.map((key) => `duplicate-idempotency-key:${key}`),
  ];

  return {
    schema: "aios.cliLogs.persistedState.v1",
    generatedAt,
    status: KNOWN_PERSISTED_STATES.has(status) ? status : "unknown",
    tenantId: String(raw.tenantId || tenantBoundary.tenantId),
    workspaceId: String(raw.workspaceId || tenantBoundary.workspaceId),
    boot: {
      previousBootId: lastBootId,
      activeBootId,
      changed: bootChanged,
    },
    cursor: {
      lastSequence,
      lastEventAt,
      integrityRootHash: rootHash,
    },
    durability: {
      lastPersistedAt,
      ageMs,
      staleAfterMs,
      stale,
      writeAheadLogId: raw.writeAheadLogId || raw.walId || null,
      checkpointId: raw.checkpointId || null,
    },
    outstandingCommand,
    checkpointJournal,
    commandLedger: {
      entries: commandLedger,
      active: activeLedger,
      duplicateIdempotencyKeys,
      replayableActiveCount: activeLedger.filter((entry) => entry.restartDisposition === "replay-safe").length,
      operatorAckRequiredCount: activeLedger.filter((entry) => entry.restartDisposition === "operator-ack-required").length,
    },
    persistenceContract: {
      schema: "aios.cliLogs.persistenceContract.v1",
      checkpointCount: checkpointJournal.length,
      latestCheckpointId: latestDurableCheckpoint?.checkpointId || null,
      latestDurableSequence: latestDurableCheckpoint?.sequence || 0,
      latestDurableRootHash: latestDurableCheckpoint?.integrityRootHash || null,
      latestDurablePersistedAt: latestDurableCheckpoint?.persistedAt || null,
      anomalies: checkpointAnomalies,
      statusSource: KNOWN_PERSISTED_STATES.has(status) ? "persisted" : "defaulted-unknown",
      readModel: {
        status: KNOWN_PERSISTED_STATES.has(status) ? status : "unknown",
        enabled: settings.enabled,
        sequence: Math.max(lastSequence, latestDurableCheckpoint?.sequence || 0),
        rootHash: rootHash || latestDurableCheckpoint?.integrityRootHash || null,
        restartSafe: checkpointAnomalies.length === 0 && activeLedger.every((entry) => entry.restartDisposition !== "operator-ack-required"),
      },
    },
  };
}

function buildRestartRecoveryState(persistedState, lifecycle, syncMetadata, integrityChain, generatedAt) {
  const persistedSequence = persistedState.cursor.lastSequence;
  const durableSequence = persistedState.persistenceContract.latestDurableSequence || 0;
  const effectiveSequence = Math.max(persistedSequence, durableSequence);
  const observedSequence = syncMetadata.watermark.sequence;
  const sequenceGap = observedSequence - effectiveSequence;
  const cursorAhead = effectiveSequence > observedSequence;
  const stale = persistedState.durability.stale;
  const rootChanged =
    Boolean(persistedState.cursor.integrityRootHash) &&
    persistedState.cursor.integrityRootHash !== integrityChain.rootHash &&
    observedSequence >= effectiveSequence;
  const durableRootChanged =
    Boolean(persistedState.persistenceContract.latestDurableRootHash) &&
    persistedState.persistenceContract.latestDurableRootHash !== integrityChain.rootHash &&
    observedSequence >= durableSequence;
  const checkpointAnomalies = persistedState.persistenceContract.anomalies || [];
  const activeCommandBlockers = persistedState.commandLedger.active.filter((entry) => entry.restartDisposition === "operator-ack-required");
  const replayableActiveCommands = persistedState.commandLedger.active.filter((entry) => entry.restartDisposition === "replay-safe");
  const replayFromSequence = cursorAhead ? observedSequence : Math.max(0, durableSequence || persistedSequence);
  const commandNeedsReplay = persistedState.outstandingCommand && persistedState.outstandingCommand.idempotent;
  const commandNeedsOperator = (persistedState.outstandingCommand && !persistedState.outstandingCommand.idempotent) || activeCommandBlockers.length > 0;
  const actions = [
    ...(persistedState.boot.changed ? ["bind-active-boot"] : []),
    ...(stale ? ["refresh-checkpoint"] : []),
    ...(cursorAhead ? ["rewind-persisted-cursor"] : []),
    ...(sequenceGap > 0 ? ["replay-missing-events"] : []),
    ...(rootChanged || durableRootChanged ? ["rebuild-integrity-chain"] : []),
    ...(checkpointAnomalies.length ? ["inspect-checkpoint-journal"] : []),
    ...(commandNeedsReplay || replayableActiveCommands.length ? ["replay-idempotent-command"] : []),
    ...(commandNeedsOperator ? ["require-operator-command-ack"] : []),
  ];

  return {
    schema: "aios.cliLogs.restartRecovery.v1",
    generatedAt,
    state:
      lifecycle.blocked || cursorAhead || rootChanged || durableRootChanged || commandNeedsOperator || checkpointAnomalies.some((anomaly) => anomaly.startsWith("future-checkpoint"))
        ? "operator-action-required"
        : actions.length
          ? "recovering"
          : "clean",
    restartSafe: !lifecycle.blocked && !cursorAhead && !rootChanged && !durableRootChanged && !commandNeedsOperator && checkpointAnomalies.length === 0,
    replay: {
      required: sequenceGap > 0 || cursorAhead || rootChanged || durableRootChanged || commandNeedsReplay || replayableActiveCommands.length > 0,
      fromSequence: replayFromSequence,
      toSequence: observedSequence,
      missingEvents: Math.max(0, sequenceGap),
    },
    checkpointRecovery: {
      preferredCheckpointId: persistedState.persistenceContract.latestCheckpointId,
      cursorSequence: persistedSequence,
      durableSequence,
      effectiveSequence,
      cursorRootHash: persistedState.cursor.integrityRootHash,
      durableRootHash: persistedState.persistenceContract.latestDurableRootHash,
      observedRootHash: integrityChain.rootHash,
      anomalies: checkpointAnomalies,
      disposition:
        checkpointAnomalies.length
          ? "inspect-before-write"
          : durableSequence > persistedSequence
            ? "promote-durable-checkpoint"
            : sequenceGap > 0
              ? "replay-from-checkpoint"
              : "checkpoint-current",
    },
    commandReplay: persistedState.outstandingCommand
      ? {
          command: persistedState.outstandingCommand.command,
          state: persistedState.outstandingCommand.state,
          idempotent: persistedState.outstandingCommand.idempotent,
          idempotencyKey: persistedState.outstandingCommand.idempotencyKey,
          disposition: persistedState.outstandingCommand.idempotent ? "safe-to-replay" : "operator-ack-required",
        }
      : null,
    commandLedgerRecovery: {
      activeCount: persistedState.commandLedger.active.length,
      replayable: replayableActiveCommands.map((entry) => ({
        transactionId: entry.transactionId,
        command: entry.command,
        idempotencyKey: entry.idempotencyKey,
        sequence: entry.sequence,
      })),
      operatorAckRequired: activeCommandBlockers.map((entry) => ({
        transactionId: entry.transactionId,
        command: entry.command,
        state: entry.state,
        idempotencyKey: entry.idempotencyKey,
      })),
      duplicateIdempotencyKeys: persistedState.commandLedger.duplicateIdempotencyKeys,
    },
    actions,
  };
}

function projectedStatusAfterCommand(command, currentStatus, settingsEnabled) {
  if (command === "start" || command === "restart") return "active";
  if (command === "stop") return "disabled";
  if (command === "export" || command === "tail") return settingsEnabled ? "active" : "disabled";
  if (command === "purge" || command === "rotate") return settingsEnabled ? "active" : "disabled";
  return KNOWN_PERSISTED_STATES.has(currentStatus) ? currentStatus : settingsEnabled ? "active" : "unknown";
}

function buildPersistedCommandTransaction({
  lifecycle,
  lifecycleSettings,
  persistedState,
  restartRecovery,
  syncMetadata,
  auditProof,
  clientRequest,
  generatedAt,
}) {
  const command = lifecycle.command.command;
  const idempotent = IDEMPOTENT_COMMAND_EFFECTS[command] === true;
  const destructive = ["purge", "rotate", "restart", "stop"].includes(command);
  const outstanding = persistedState.outstandingCommand;
  const requestedKey = `${clientRequest.routeHints.idempotencyScope}:${syncMetadata.watermark.sequence}:${auditProof.digest.rootHash}`;
  const normalizedKey = idempotent || clientRequest.routeHints.replaySafe ? requestedKey : digestPayload({
    surfaceId,
    generatedAt,
    requestId: clientRequest.requestId,
    command,
    sequence: syncMetadata.watermark.sequence,
  }).slice(0, 32);
  const duplicateOutstanding = Boolean(outstanding?.idempotencyKey && outstanding.idempotencyKey === normalizedKey);
  const nonReplayableOutstanding = Boolean(outstanding && !outstanding.idempotent && !duplicateOutstanding);
  const recoveryBlocked = restartRecovery.state === "operator-action-required";
  const acknowledgementBlocked = clientRequest.acknowledgement.required && !clientRequest.acknowledgement.satisfied;
  const auditReviewBlocked = Boolean(
    clientRequest.auditBrowser.requiresReview &&
      !["inspect", "recover", "tail"].includes(clientRequest.workflowIntent) &&
      ["export", "purge", "rotate", "restart", "stop"].includes(command)
  );
  const blockedReason =
    lifecycle.blocked
      ? lifecycle.blockReason
      : recoveryBlocked
        ? "restart recovery must be reconciled before mutating persisted cli-log state"
        : nonReplayableOutstanding
          ? `non-idempotent ${outstanding.command} command is still ${outstanding.state}`
          : auditReviewBlocked
            ? `audit event ${clientRequest.auditBrowser.nextAuditAction.eventId} requires review before ${command}`
          : acknowledgementBlocked
            ? "client acknowledgement is required before persisting this command"
            : null;
  const admission = blockedReason
    ? "blocked"
    : duplicateOutstanding
      ? "duplicate-replay"
      : command === "status"
        ? "read-only"
        : "admitted";
  const commitRequired = admission === "admitted" && command !== "tail";
  const projectedStatus = projectedStatusAfterCommand(command, persistedState.status, lifecycleSettings.settings.enabled);
  const transactionSubject = {
    surfaceId,
    tenantId: persistedState.tenantId,
    workspaceId: persistedState.workspaceId,
    requestId: clientRequest.requestId,
    command,
    idempotencyKey: normalizedKey,
    expectedSequence: syncMetadata.watermark.sequence,
    expectedRootHash: auditProof.digest.rootHash,
    auditBrowserDigest: clientRequest.auditBrowser.digest,
    pendingAuditEventId: clientRequest.auditBrowser.nextAuditAction?.eventId || null,
  };

  return {
    schema: "aios.cliLogs.persistedCommand.v1",
    generatedAt,
    transactionId: digestPayload(transactionSubject).slice(0, 32),
    command,
    idempotent,
    destructive,
    admission,
    blocked: Boolean(blockedReason),
    blockReason: blockedReason,
    idempotencyKey: normalizedKey,
    duplicateOfOutstanding: duplicateOutstanding,
    restartSafe: !blockedReason && restartRecovery.restartSafe,
    recoveryDisposition:
      restartRecovery.state === "clean"
        ? "no-recovery-needed"
        : restartRecovery.state === "recovering" && idempotent
          ? "replay-after-recovery"
          : restartRecovery.state === "recovering"
            ? "wait-for-recovery"
            : "operator-reconciliation-required",
    auditBrowserGate: {
      required: clientRequest.auditBrowser.requiresReview,
      blocked: auditReviewBlocked,
      lifecycleQueueState: clientRequest.auditBrowser.lifecycleQueueState,
      pendingEventId: clientRequest.auditBrowser.nextAuditAction?.eventId || null,
      pendingEventType: clientRequest.auditBrowser.nextAuditAction?.auditEventType || null,
      route: clientRequest.auditBrowser.nextAuditAction?.action?.route || clientRequest.auditBrowser.route,
      cursorToken: clientRequest.routeHints.auditCursorToken,
    },
    expectedCheckpoint: {
      bootId: persistedState.boot.activeBootId,
      sequence: syncMetadata.watermark.sequence,
      eventId: syncMetadata.watermark.eventId,
      integrityRootHash: auditProof.digest.rootHash,
      previousIntegrityRootHash: persistedState.cursor.integrityRootHash,
    },
    writePlan: {
      required: commitRequired,
      mode: commitRequired ? "compare-and-swap" : "none",
      compare: {
        sequence: persistedState.cursor.lastSequence,
        integrityRootHash: persistedState.cursor.integrityRootHash,
        bootId: persistedState.boot.activeBootId,
      },
      set: commitRequired
        ? {
            status: projectedStatus,
            lastCommand: {
              command,
              state: "committed",
              idempotencyKey: normalizedKey,
              requestedAt: clientRequest.handoff.requestedAt,
              requestId: clientRequest.requestId,
            },
            cursor: {
              lastSequence: syncMetadata.watermark.sequence,
              lastEventAt: syncMetadata.watermark.timestamp,
              integrityRootHash: auditProof.digest.rootHash,
            },
            lastPersistedAt: generatedAt,
          }
        : null,
    },
    statusAfterRestart: {
      current: persistedState.status,
      projected: blockedReason ? persistedState.status : projectedStatus,
      stable: !blockedReason && (!destructive || idempotent || clientRequest.acknowledgement.satisfied),
      reason: blockedReason || (commitRequired ? "checkpoint can be restored from persisted compare-and-swap write" : "command does not mutate persisted status"),
    },
  };
}

function buildNextAction(lifecycle, analytics, auditProof, settingsControl = null, restartRecovery = null, operationalHealth = null, auditLogBrowser = null) {
  if (auditLogBrowser?.lifecycleQueues?.next?.action?.priority === "high") {
    const nextAudit = auditLogBrowser.lifecycleQueues.next;
    return {
      type: "browse-audit-event",
      reason: nextAudit.action.reason,
      command: nextAudit.auditEventType === "recovery" ? "status" : "tail",
      priority: "high",
      auditEventId: nextAudit.eventId,
      auditEventType: nextAudit.auditEventType,
      route: nextAudit.action.route,
      continuationRequired: true,
    };
  }
  if (operationalHealth?.state === "unhealthy") {
    const operatorError = operationalHealth.runtimePlan?.operatorErrors.find((error) => error.severity === "critical");
    const criticalAction = operationalHealth.actions.find((action) => action.severity === "critical");
    return {
      type: "repair-operational-health",
      reason: operatorError?.message || criticalAction?.summary || "cli-log operational health is unhealthy",
      command: criticalAction?.code === "restart-recovery" ? "status" : operationalHealth.runtimePlan?.admissionControl.allowedCommands.includes("tail") ? "tail" : "status",
      priority: "high",
      route: operatorError?.route || criticalAction?.route || { method: "GET", path: "/operator-userland/cli-logs/status" },
      retryable: criticalAction?.retryable === true,
      acknowledgementRequired: operatorError?.acknowledgementRequired === true,
    };
  }
  if (operationalHealth?.state === "degraded" && operationalHealth.retryPolicy.automaticRetryAllowed) {
    const retryAction = operationalHealth.actions.find((action) => action.retryable);
    const retryWindow = retryAction
      ? operationalHealth.runtimePlan?.retryWindows.find((window) => window.code === retryAction.code)
      : null;
    return {
      type: "retry-degraded-operation",
      reason: retryAction?.summary || "cli-log operational health is degraded but retryable",
      command: retryAction?.code === "provider-lag" ? "status" : "tail",
      priority: "medium",
      route: retryWindow?.route || retryAction?.route || { method: "GET", path: "/operator-userland/cli-logs/status" },
      retryAt: retryWindow?.nextRetryAt || operationalHealth.retryPolicy.backoff.nextRetryAt,
      idempotencyKey: retryWindow?.idempotencyKey || null,
      retryable: true,
    };
  }
  if (restartRecovery && restartRecovery.state === "operator-action-required") {
    return {
      type: "recover-state",
      reason: restartRecovery.actions[0] || "restart recovery requires operator action",
      command: "status",
      priority: "high",
    };
  }
  if (restartRecovery && restartRecovery.state === "recovering") {
    return {
      type: "complete-recovery",
      reason: restartRecovery.actions[0] || "restart recovery is in progress",
      command: restartRecovery.commandReplay?.disposition === "safe-to-replay" ? restartRecovery.commandReplay.command : "status",
      priority: "high",
    };
  }
  if (lifecycle.blocked) {
    return {
      type: "fix-settings",
      reason: lifecycle.blockReason,
      command: "status",
      priority: "high",
    };
  }
  if (settingsControl?.state === "blocked") {
    return {
      type: "fix-settings-control",
      reason: settingsControl.blockReason,
      command: "status",
      priority: "high",
      route: settingsControl.route,
    };
  }
  if (settingsControl?.state === "ready-to-apply") {
    return {
      type: "apply-settings-control",
      reason: `${settingsControl.intent} changes ${settingsControl.changedFields.join(", ")}`,
      command: "status",
      priority: settingsControl.intent === "disable" ? "high" : "medium",
      route: settingsControl.route,
      auditDigest: settingsControl.audit.digest,
    };
  }
  if (!lifecycle.enabled) {
    return { type: "enable-capture", reason: "capture is disabled", command: "start", priority: "medium" };
  }
  if (analytics.failedCommands > 0 || auditProof.status === "attention-required") {
    return { type: "inspect-failures", reason: "failed CLI commands require operator review", command: "tail", priority: "high" };
  }
  if (lifecycle.schedule.state === "due") {
    return { type: "run-scheduled-export", reason: "scheduled export is due", command: "export", priority: "medium" };
  }
  if (lifecycle.controls.canRotate) {
    return { type: "rotate-buffer", reason: "buffer is near configured capacity", command: "rotate", priority: "medium" };
  }
  return { type: "monitor", reason: "cli log lifecycle is healthy", command: "status", priority: "low" };
}

function asIsoTimestamp(value, fallback) {
  const parsed = value ? new Date(value) : null;
  if (parsed && Number.isFinite(parsed.getTime())) {
    return parsed.toISOString();
  }
  return fallback;
}

function normalizeEventSequenceValue(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null) {
    return {
      value: fallback,
      source: "synthesized-index",
      valid: true,
      reason: null,
    };
  }

  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return {
      value: fallback,
      source: "fallback-index",
      valid: false,
      reason: "sequence is missing or not numeric",
    };
  }

  const integer = Math.trunc(numeric);
  if (integer < 1) {
    return {
      value: fallback,
      source: "fallback-index",
      valid: false,
      reason: "sequence must be a positive integer",
    };
  }

  return {
    value: integer,
    source: integer === numeric ? "input" : "input-truncated",
    valid: integer === numeric,
    reason: integer === numeric ? null : "sequence contained fractional precision",
  };
}

function normalizeLogEvent(event, index, generatedAt, tenantBoundary) {
  const raw = event && typeof event === "object" ? event : { message: String(event ?? "") };
  const rawSequence = raw.sequence ?? raw.seq ?? raw.offset ?? raw.index;
  const sequenceDescriptor = normalizeEventSequenceValue(rawSequence, index + 1);
  const level = String(raw.level || raw.severity || "info").toLowerCase();
  const stream = String(raw.stream || raw.channel || (level === "error" || level === "fatal" ? "stderr" : "stdout")).toLowerCase();
  const command = String(raw.command || raw.commandId || raw.cmd || "unknown-command");
  const sessionId = String(raw.sessionId || raw.session || raw.operatorSession || "default-session");
  const message = String(raw.message || raw.summary || raw.text || "");
  const auditEventType = normalizeAuditEventType(raw, command, level, message);
  const subject = raw.subject && typeof raw.subject === "object" ? raw.subject : {};

  return {
    id: String(raw.id || raw.eventId || `cli-log-${index + 1}`),
    sequence: sequenceDescriptor.value,
    timestamp: asIsoTimestamp(raw.timestamp || raw.time || raw.createdAt, generatedAt),
    level: KNOWN_LEVELS.has(level) ? level : "info",
    stream: KNOWN_STREAMS.has(stream) ? stream : "system",
    command,
    sessionId,
    auditEventType,
    auditSubject: {
      claimId: raw.claimId || subject.claimId || null,
      blockerId: raw.blockerId || subject.blockerId || null,
      recoveryId: raw.recoveryId || subject.recoveryId || null,
      bootId: raw.bootId || subject.bootId || null,
      runId: raw.runId || subject.runId || raw.jobId || subject.jobId || null,
    },
    message,
    exitCode: Number.isFinite(raw.exitCode) ? raw.exitCode : null,
    durationMs: Number.isFinite(raw.durationMs) && raw.durationMs >= 0 ? raw.durationMs : null,
    proofId: raw.proofId ? String(raw.proofId) : null,
    exportable: raw.exportable !== false,
    redacted: raw.redacted === true || raw.containsSecret === true,
    redaction: {
      requested: raw.redacted === true || raw.containsSecret === true,
      source: raw.redacted === true ? "upstream-redacted" : raw.containsSecret === true ? "upstream-secret-signal" : "none",
      messageHash: digestPayload({ message }),
      findingTypes: [],
    },
    sequenceControl: {
      ingestionIndex: index,
      rawSequence: rawSequence === undefined || rawSequence === null ? null : String(rawSequence),
      requestedSequence: sequenceDescriptor.value,
      originalSequence: sequenceDescriptor.value,
      effectiveSequence: sequenceDescriptor.value,
      source: sequenceDescriptor.source,
      validInput: sequenceDescriptor.valid,
      normalized: false,
      reason: sequenceDescriptor.reason,
    },
    scope: scopeLogEvent(raw, tenantBoundary),
  };
}

function buildSequenceWindow(events, generatedAt) {
  const ordered = [...events].sort((left, right) => {
    const byTimestamp = left.timestamp.localeCompare(right.timestamp);
    if (byTimestamp !== 0) return byTimestamp;
    return left.sequenceControl.ingestionIndex - right.sequenceControl.ingestionIndex;
  });
  const seenRequested = new Map();
  let previousEffective = 0;
  let normalizedCount = 0;
  let duplicateCount = 0;
  let regressionCount = 0;
  let invalidInputCount = 0;
  const normalizedEvents = ordered.map((event) => {
    const requested = event.sequenceControl.requestedSequence;
    const duplicateSeen = seenRequested.has(requested);
    const regressed = requested <= previousEffective;
    const invalidInput = !event.sequenceControl.validInput;
    const effectiveSequence = regressed ? previousEffective + 1 : requested;
    const normalized = invalidInput || duplicateSeen || regressed || effectiveSequence !== event.sequence;
    if (duplicateSeen) duplicateCount += 1;
    if (regressed) regressionCount += 1;
    if (invalidInput) invalidInputCount += 1;
    if (normalized) normalizedCount += 1;
    seenRequested.set(requested, (seenRequested.get(requested) || 0) + 1);
    previousEffective = effectiveSequence;

    return {
      ...event,
      sequence: effectiveSequence,
      sequenceControl: {
        ...event.sequenceControl,
        effectiveSequence,
        normalized,
        duplicateRequestedSequence: duplicateSeen,
        regressed,
        reason:
          event.sequenceControl.reason ||
          (duplicateSeen ? "duplicate requested sequence" : regressed ? "sequence would not advance watermark" : null),
      },
    };
  });
  const byIngestionOrder = [...normalizedEvents].sort((left, right) => left.sequenceControl.ingestionIndex - right.sequenceControl.ingestionIndex);
  const subject = {
    surfaceId,
    eventIds: normalizedEvents.map((event) => event.id),
    requestedSequences: normalizedEvents.map((event) => event.sequenceControl.requestedSequence),
    effectiveSequences: normalizedEvents.map((event) => event.sequence),
    normalizedCount,
  };

  return {
    events: byIngestionOrder,
    contract: {
      schema: "aios.cliLogs.sequenceWindow.v1",
      generatedAt,
      state: normalizedCount ? "normalized" : "trusted",
      ordering: "timestamp-then-ingest-index",
      eventCount: events.length,
      normalizedCount,
      duplicateRequestedSequenceCount: duplicateCount,
      regressedSequenceCount: regressionCount,
      invalidInputSequenceCount: invalidInputCount,
      firstSequence: normalizedEvents[0]?.sequence || 0,
      lastSequence: normalizedEvents.at(-1)?.sequence || 0,
      watermarkSafe: normalizedEvents.every((event, index) => index === 0 || event.sequence > normalizedEvents[index - 1].sequence),
      normalizedEventIds: normalizedEvents.filter((event) => event.sequenceControl.normalized).map((event) => event.id),
      audit: {
        digest: digestPayload(subject),
        subject,
      },
    },
  };
}

function detectSecretFindings(message) {
  const findings = [];
  for (const detector of SECRET_DETECTORS) {
    const matches = [...String(message).matchAll(detector.pattern)];
    if (matches.length) {
      findings.push({
        type: detector.type,
        count: matches.length,
      });
    }
  }
  return findings;
}

function redactMessage(message) {
  return SECRET_DETECTORS.reduce(
    (current, detector) => current.replace(detector.pattern, detector.replacement),
    String(message)
  );
}

function applyRedactionPolicy(events, settings, generatedAt) {
  const policyEnabled = settings.redactSecrets;
  const redactedEvents = events.map((event) => {
    const detectedFindings = detectSecretFindings(event.message);
    const upstreamRequested = event.redaction.requested;
    const mustRedact = policyEnabled && (upstreamRequested || detectedFindings.length > 0);
    const sanitizedMessage = mustRedact ? redactMessage(event.message) : event.message;
    const findingTypes = [...new Set([...event.redaction.findingTypes, ...detectedFindings.map((finding) => finding.type)])].sort();

    return {
      ...event,
      message: sanitizedMessage,
      redacted: event.redacted || mustRedact,
      exportable: event.exportable && (!detectedFindings.length || policyEnabled),
      redaction: {
        schema: "aios.cliLogs.eventRedaction.v1",
        requested: upstreamRequested || detectedFindings.length > 0,
        applied: mustRedact,
        policyEnabled,
        source: upstreamRequested ? event.redaction.source : detectedFindings.length ? "hosted-kernel-detector" : "none",
        findingTypes,
        findingCount: detectedFindings.reduce((total, finding) => total + finding.count, 0),
        messageHash: event.redaction.messageHash,
        sanitizedMessageHash: digestPayload({ message: sanitizedMessage }),
      },
    };
  });
  const blockedSecretEvents = redactedEvents.filter((event) => event.redaction.requested && !event.redaction.applied);
  const detectedFindingCounts = redactedEvents.reduce((accumulator, event) => {
    for (const type of event.redaction.findingTypes) {
      accumulator[type] = (accumulator[type] || 0) + 1;
    }
    return accumulator;
  }, {});

  return {
    events: redactedEvents,
    contract: {
      schema: "aios.cliLogs.redactionContract.v1",
      generatedAt,
      enabled: policyEnabled,
      detectors: SECRET_DETECTORS.map((detector) => detector.type),
      inspectedEvents: events.length,
      requestedRedactions: redactedEvents.filter((event) => event.redaction.requested).length,
      appliedRedactions: redactedEvents.filter((event) => event.redaction.applied).length,
      blockedSecretEvents: blockedSecretEvents.length,
      detectedFindingCounts: Object.fromEntries(Object.entries(detectedFindingCounts).sort(([left], [right]) => left.localeCompare(right))),
      exportSafe: blockedSecretEvents.length === 0,
      blockedEventIds: blockedSecretEvents.map((event) => event.id),
    },
  };
}

function collectCliEvents(input, generatedAt, tenantBoundary) {
  const source = Array.isArray(input.events)
    ? input.events
    : Array.isArray(input.logs)
      ? input.logs
      : Array.isArray(input.evidence)
        ? input.evidence
        : [];
  return source.map((event, index) => normalizeLogEvent(event, index, generatedAt, tenantBoundary));
}

function buildAnalytics(events) {
  const counters = {
    totalEvents: events.length,
    exportableEvents: 0,
    redactedEvents: 0,
    proofLinkedEvents: 0,
    failedCommands: 0,
    completedCommands: 0,
    observedCommands: 0,
    exportableFailures: 0,
    byLevel: Object.fromEntries([...KNOWN_LEVELS].map((level) => [level, 0])),
    byStream: Object.fromEntries([...KNOWN_STREAMS].map((stream) => [stream, 0])),
    byStreamLevel: Object.fromEntries([...KNOWN_STREAMS].map((stream) => [stream, Object.fromEntries([...KNOWN_LEVELS].map((level) => [level, 0]))])),
    byAuditEventType: Object.fromEntries(AUDIT_EVENT_TYPES.map((type) => [type, 0])),
    byCommand: {},
    commandOutcomes: {},
    bySession: {},
  };

  let totalDurationMs = 0;
  let durationSamples = 0;
  for (const event of events) {
    const outcome = event.exitCode === null ? "observed" : event.exitCode === 0 ? "completed" : "failed";
    counters.byLevel[event.level] += 1;
    counters.byStream[event.stream] += 1;
    counters.byStreamLevel[event.stream][event.level] += 1;
    counters.byAuditEventType[event.auditEventType] += 1;
    counters.byCommand[event.command] = (counters.byCommand[event.command] || 0) + 1;
    counters.commandOutcomes[event.command] ||= { observed: 0, completed: 0, failed: 0 };
    counters.commandOutcomes[event.command][outcome] += 1;
    counters.bySession[event.sessionId] = (counters.bySession[event.sessionId] || 0) + 1;
    if (event.exportable) counters.exportableEvents += 1;
    if (event.redacted) counters.redactedEvents += 1;
    if (event.proofId) counters.proofLinkedEvents += 1;
    if (outcome === "observed") counters.observedCommands += 1;
    if (outcome === "completed") counters.completedCommands += 1;
    if (outcome === "failed") counters.failedCommands += 1;
    if (event.exportable && outcome === "failed") counters.exportableFailures += 1;
    if (event.durationMs !== null) {
      totalDurationMs += event.durationMs;
      durationSamples += 1;
    }
  }

  return {
    ...counters,
    errorRate: events.length ? Number(((counters.byLevel.error + counters.byLevel.fatal) / events.length).toFixed(4)) : 0,
    failureRate: events.length ? Number((counters.failedCommands / events.length).toFixed(4)) : 0,
    proofCoverage: counters.exportableEvents ? Number((counters.proofLinkedEvents / counters.exportableEvents).toFixed(4)) : 1,
    redactionRate: events.length ? Number((counters.redactedEvents / events.length).toFixed(4)) : 0,
    averageDurationMs: durationSamples ? Math.round(totalDurationMs / durationSamples) : null,
  };
}

function buildHistorySnapshots(events, analytics, generatedAt) {
  const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence);
  const first = ordered[0] || null;
  const last = ordered[ordered.length - 1] || null;
  const sessions = Object.keys(analytics.bySession).sort();
  const commandRuns = ordered.reduce((accumulator, event) => {
    const current = accumulator[event.command] || {
      command: event.command,
      firstEventAt: event.timestamp,
      lastEventAt: event.timestamp,
      eventCount: 0,
      failureCount: 0,
      exportableCount: 0,
      durationMsTotal: 0,
      durationSamples: 0,
    };
    current.lastEventAt = event.timestamp;
    current.eventCount += 1;
    if (event.exitCode !== null && event.exitCode !== 0) current.failureCount += 1;
    if (event.exportable) current.exportableCount += 1;
    if (event.durationMs !== null) {
      current.durationMsTotal += event.durationMs;
      current.durationSamples += 1;
    }
    accumulator[event.command] = current;
    return accumulator;
  }, {});

  return {
    schema: "aios.cliLogs.historySnapshots.v2",
    generatedAt,
    window: {
      startedAt: first ? first.timestamp : generatedAt,
      endedAt: last ? last.timestamp : generatedAt,
      eventCount: ordered.length,
    },
    latestPerCommand: Object.fromEntries(
      Object.entries(
        ordered.reduce((latest, event) => {
          latest[event.command] = {
            id: event.id,
            timestamp: event.timestamp,
            level: event.level,
            stream: event.stream,
            exitCode: event.exitCode,
          };
          return latest;
        }, {})
      ).sort(([left], [right]) => left.localeCompare(right))
    ),
    sessions: sessions.map((sessionId) => ({
      sessionId,
      eventCount: analytics.bySession[sessionId],
      lastEventAt: [...ordered].reverse().find((event) => event.sessionId === sessionId)?.timestamp || generatedAt,
    })),
    commandRuns: Object.values(commandRuns)
      .map((run) => ({
        command: run.command,
        firstEventAt: run.firstEventAt,
        lastEventAt: run.lastEventAt,
        eventCount: run.eventCount,
        failureCount: run.failureCount,
        exportableCount: run.exportableCount,
        averageDurationMs: run.durationSamples ? Math.round(run.durationMsTotal / run.durationSamples) : null,
      }))
      .sort((left, right) => right.eventCount - left.eventCount || left.command.localeCompare(right.command)),
  };
}

function buildTimeline(events) {
  return [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence)
    .map((event) => ({
      at: event.timestamp,
      id: event.id,
      command: event.command,
      auditEventType: event.auditEventType,
      level: event.level,
      stream: event.stream,
      status: event.exitCode === null ? "observed" : event.exitCode === 0 ? "completed" : "failed",
      proofId: event.proofId,
    }));
}

function buildAuditAnalyticsState(events, auditLogBrowser, exportSummary, generatedAt) {
  const chronological = sortAuditEventsForBrowser(events, "asc");
  const bucketMap = new Map();
  for (const event of chronological) {
    const bucketStartedAt = new Date(event.timestamp);
    bucketStartedAt.setUTCMinutes(0, 0, 0);
    const bucketKey = bucketStartedAt.toISOString();
    const bucket = bucketMap.get(bucketKey) || {
      startedAt: bucketKey,
      endedAt: new Date(bucketStartedAt.getTime() + 3600000).toISOString(),
      eventCount: 0,
      exportableCount: 0,
      failedCount: 0,
      blockerCount: 0,
      recoveryCount: 0,
      proofLinkedCount: 0,
      byType: Object.fromEntries(AUDIT_EVENT_TYPES.map((type) => [type, 0])),
    };
    const status = auditEventStatus(event);
    bucket.eventCount += 1;
    if (event.exportable) bucket.exportableCount += 1;
    if (event.proofId) bucket.proofLinkedCount += 1;
    if (status === "failed") bucket.failedCount += 1;
    if (event.auditEventType === "blocker") bucket.blockerCount += 1;
    if (event.auditEventType === "recovery") bucket.recoveryCount += 1;
    bucket.byType[event.auditEventType] += 1;
    bucketMap.set(bucketKey, bucket);
  }
  const byType = AUDIT_EVENT_TYPES.map((type) => {
    const typeEvents = chronological.filter((event) => event.auditEventType === type);
    const exportable = typeEvents.filter((event) => event.exportable);
    const failed = typeEvents.filter((event) => auditEventStatus(event) === "failed");
    const latest = typeEvents.at(-1) || null;
    const policy = auditEventPolicyFor(type);

    return {
      eventType: type,
      sensitivity: policy.sensitivity,
      count: typeEvents.length,
      exportableCount: exportable.length,
      failedCount: failed.length,
      proofLinkedCount: typeEvents.filter((event) => event.proofId).length,
      redactedCount: typeEvents.filter((event) => event.redacted).length,
      firstEventAt: typeEvents[0]?.timestamp || null,
      lastEventAt: latest?.timestamp || null,
      latestEventId: latest?.id || null,
      nextBrowseRoute: {
        method: "GET",
        path: "/operator-userland/cli-logs/audit",
        enabled: typeEvents.length > 0,
        query: {
          eventTypes: [type],
          afterSequence: Math.max(0, (latest?.sequence || 1) - 1),
          limit: 50,
          order: "asc",
        },
      },
    };
  });
  const blockedTypes = byType.filter((row) => row.eventType === "blocker" && row.count > 0);
  const failedTypes = byType.filter((row) => row.failedCount > 0);
  const reportSubject = {
    surfaceId,
    generatedAt,
    eventCount: chronological.length,
    exportRecordCount: exportSummary.recordCount,
    browserDigest: auditLogBrowser.audit.digest,
    typeCounts: Object.fromEntries(byType.map((row) => [row.eventType, row.count])),
    failedTypeCounts: Object.fromEntries(byType.map((row) => [row.eventType, row.failedCount])),
  };

  return {
    schema: "aios.cliLogs.auditAnalytics.v1",
    generatedAt,
    state: blockedTypes.length || failedTypes.length ? "attention-required" : exportSummary.ready ? "export-ready" : "watching",
    counters: {
      totalAuditEvents: chronological.length,
      exportableAuditEvents: chronological.filter((event) => event.exportable).length,
      failedAuditEvents: chronological.filter((event) => auditEventStatus(event) === "failed").length,
      proofLinkedAuditEvents: chronological.filter((event) => event.proofId).length,
      blockerEvents: blockedTypes.reduce((total, row) => total + row.count, 0),
      recoveryEvents: byType.find((row) => row.eventType === "recovery")?.count || 0,
      browserPolicyDeniedEvents: auditLogBrowser.counters.policyDeniedEvents,
      browserReturnedEvents: auditLogBrowser.counters.returnedEvents,
    },
    byType,
    historyBuckets: [...bucketMap.values()].slice(-24),
    exportReadySummary: {
      ready: exportSummary.ready,
      recordCount: exportSummary.recordCount,
      formats: exportSummary.formats,
      unsupportedFormats: exportSummary.unsupportedFormats,
      byType: Object.fromEntries(byType.map((row) => [row.eventType, {
        recordCount: row.exportableCount,
        failedRecordCount: row.failedCount,
        proofCoverage: row.exportableCount ? Number((row.proofLinkedCount / row.exportableCount).toFixed(4)) : 1,
      }])),
    },
    reportRoutes: {
      summary: {
        method: "GET",
        path: "/operator-userland/cli-logs/report",
        enabled: true,
        query: { view: "audit-summary", reportDigest: digestPayload(reportSubject).slice(0, 24) },
      },
      export: {
        method: "POST",
        path: "/operator-userland/cli-logs/export",
        enabled: exportSummary.ready && exportSummary.recordCount > 0,
        payload: {
          formats: exportSummary.formats,
          auditEventTypes: byType.filter((row) => row.exportableCount > 0).map((row) => row.eventType),
          reportDigest: digestPayload(reportSubject).slice(0, 24),
        },
      },
    },
    audit: {
      digest: digestPayload(reportSubject),
      subject: reportSubject,
    },
  };
}

function normalizeAuditBrowserRequest(input, generatedAt) {
  const raw =
    input.auditBrowser && typeof input.auditBrowser === "object"
      ? input.auditBrowser
      : input.logBrowser && typeof input.logBrowser === "object"
        ? input.logBrowser
        : input.browse && typeof input.browse === "object"
          ? input.browse
          : {};
  const rawTypes = Array.isArray(raw.eventTypes || raw.types)
    ? raw.eventTypes || raw.types
    : raw.eventType || raw.type
      ? [raw.eventType || raw.type]
      : AUDIT_EVENT_TYPES;
  const eventTypes = [...new Set(rawTypes.map((type) => String(type).trim().toLowerCase()).filter((type) => KNOWN_AUDIT_EVENT_TYPES.has(type)))];
  const unsupportedEventTypes = [...new Set(rawTypes.map((type) => String(type).trim().toLowerCase()).filter((type) => type && !KNOWN_AUDIT_EVENT_TYPES.has(type)))].sort();
  const limit = Math.min(200, Math.max(1, Math.trunc(asFiniteNumber(raw.limit ?? input.limit, 50))));
  const afterSequence = Math.max(0, Math.trunc(asFiniteNumber(raw.afterSequence ?? raw.cursor?.afterSequence ?? input.afterSequence, 0)));
  const rawBeforeSequence = raw.beforeSequence ?? raw.cursor?.beforeSequence ?? input.beforeSequence;
  const beforeSequence =
    rawBeforeSequence === undefined || rawBeforeSequence === null
      ? null
      : Math.max(1, Math.trunc(asFiniteNumber(rawBeforeSequence, Number.MAX_SAFE_INTEGER)));
  const since = asIsoTimestamp(raw.since || raw.from || raw.startedAt, null);
  const until = asIsoTimestamp(raw.until || raw.to || raw.endedAt, generatedAt);
  const rawCommands = Array.isArray(raw.commands || raw.command)
    ? raw.commands || raw.command
    : raw.command
      ? [raw.command]
      : [];
  const rawSessions = Array.isArray(raw.sessions || raw.sessionIds)
    ? raw.sessions || raw.sessionIds
    : raw.sessionId || raw.session
      ? [raw.sessionId || raw.session]
      : [];
  const rawStatuses = Array.isArray(raw.statuses || raw.status)
    ? raw.statuses || raw.status
    : raw.status
      ? [raw.status]
      : [];
  const statuses = [...new Set(rawStatuses.map((status) => String(status).trim().toLowerCase()).filter((status) => ["observed", "completed", "failed"].includes(status)))].sort();
  const unsupportedStatuses = [...new Set(rawStatuses.map((status) => String(status).trim().toLowerCase()).filter((status) => status && !["observed", "completed", "failed"].includes(status)))].sort();
  const requestedOrder = String(raw.order || raw.sort || input.auditOrder || "asc").trim().toLowerCase();
  const order = ["asc", "desc"].includes(requestedOrder) ? requestedOrder : "asc";
  const validation = [
    ...(unsupportedEventTypes.length ? [`unsupported audit event types: ${unsupportedEventTypes.join(", ")}`] : []),
    ...(unsupportedStatuses.length ? [`unsupported audit statuses: ${unsupportedStatuses.join(", ")}`] : []),
    ...(requestedOrder === order ? [] : [`unsupported audit order '${requestedOrder}'`]),
    ...(since && until && since > until ? ["audit browser since must be before until"] : []),
  ];

  return {
    eventTypes: eventTypes.length ? eventTypes : AUDIT_EVENT_TYPES,
    unsupportedEventTypes,
    limit,
    afterSequence,
    beforeSequence,
    since,
    until,
    commands: [...new Set(rawCommands.map((command) => String(command).trim()).filter(Boolean))].sort(),
    sessionIds: [...new Set(rawSessions.map((sessionId) => String(sessionId).trim()).filter(Boolean))].sort(),
    statuses,
    unsupportedStatuses,
    order,
    valid: validation.length === 0,
    validation,
    includeMessages: asBooleanSetting(raw.includeMessages ?? input.includeMessages, false),
  };
}

function auditEventStatus(event) {
  return event.exitCode === null ? "observed" : event.exitCode === 0 ? "completed" : "failed";
}

function eventMatchesAuditBrowser(event, request) {
  return (
    request.eventTypes.includes(event.auditEventType) &&
    event.sequence > request.afterSequence &&
    (!request.beforeSequence || event.sequence < request.beforeSequence) &&
    (!request.since || event.timestamp >= request.since) &&
    (!request.until || event.timestamp <= request.until) &&
    (!request.commands.length || request.commands.includes(event.command)) &&
    (!request.sessionIds.length || request.sessionIds.includes(event.sessionId)) &&
    (!request.statuses.length || request.statuses.includes(auditEventStatus(event)))
  );
}

function lifecycleAuditNextAction(event, generatedAt) {
  const status = auditEventStatus(event);
  const ageMs = Math.max(0, new Date(generatedAt).getTime() - new Date(event.timestamp).getTime());
  const stale = ageMs > 30 * 60000;
  const subjectId =
    event.auditSubject.blockerId ||
    event.auditSubject.recoveryId ||
    event.auditSubject.claimId ||
    event.auditSubject.bootId ||
    event.auditSubject.runId ||
    event.id;
  const route = (eventType, extraQuery = {}) => ({
    method: "GET",
    path: "/operator-userland/cli-logs/audit",
    enabled: true,
    query: {
      eventType,
      afterSequence: Math.max(0, event.sequence - 1),
      limit: 25,
      order: "asc",
      ...extraQuery,
    },
  });

  if (event.auditEventType === "blocker") {
    return {
      type: status === "failed" || event.level === "fatal" ? "resolve-blocker" : "inspect-blocker",
      priority: event.level === "fatal" || stale ? "high" : "medium",
      reason: stale ? "blocker has remained open beyond the review window" : "blocker audit event is present",
      subjectId,
      stale,
      route: route("blocker", { statuses: status === "failed" ? ["failed"] : [] }),
    };
  }
  if (event.auditEventType === "recovery") {
    return {
      type: status === "completed" ? "verify-recovery" : status === "failed" ? "repair-recovery" : "watch-recovery",
      priority: status === "failed" || stale ? "high" : "medium",
      reason: status === "completed" ? "recovery completed and should be verified against the cursor" : "recovery is not yet settled",
      subjectId,
      stale,
      route: route("recovery", { statuses: status === "completed" ? ["completed"] : ["observed", "failed"] }),
    };
  }
  if (event.auditEventType === "claim") {
    return {
      type: status === "completed" ? "confirm-claim" : status === "failed" ? "retry-claim" : "watch-claim",
      priority: status === "failed" || stale ? "medium" : "low",
      reason: status === "failed" ? "claim event failed" : "claim lifecycle event is available for review",
      subjectId,
      stale,
      route: route("claim"),
    };
  }
  if (event.auditEventType === "boot") {
    return {
      type: status === "failed" ? "inspect-boot" : "confirm-boot",
      priority: status === "failed" ? "high" : "low",
      reason: status === "failed" ? "boot event failed" : "boot provenance is available",
      subjectId,
      stale: false,
      route: route("boot"),
    };
  }
  return {
    type: status === "failed" ? "inspect-run" : "review-run",
    priority: status === "failed" ? "medium" : "low",
    reason: status === "failed" ? "run event failed" : "run event is available for audit browsing",
    subjectId,
    stale: false,
    route: route("run", { statuses: status === "failed" ? ["failed"] : [] }),
  };
}

function buildAuditLifecycleQueues(events, generatedAt) {
  const chronological = sortAuditEventsForBrowser(events, "asc");
  const actionable = chronological
    .map((event) => ({ event, action: lifecycleAuditNextAction(event, generatedAt) }))
    .filter(({ action }) => action.priority !== "low" || ["blocker", "recovery"].includes(event.auditEventType));
  const byAction = actionable.reduce((accumulator, { action }) => {
    accumulator[action.type] = (accumulator[action.type] || 0) + 1;
    return accumulator;
  }, {});
  const blockers = actionable.filter(({ event }) => event.auditEventType === "blocker");
  const recoveries = actionable.filter(({ event }) => event.auditEventType === "recovery");
  const highPriority = actionable.filter(({ action }) => action.priority === "high");
  const next = highPriority[0] || blockers[0] || recoveries[0] || actionable[0] || null;

  return {
    schema: "aios.cliLogs.auditLifecycleQueues.v1",
    generatedAt,
    state: highPriority.length ? "attention-required" : blockers.length || recoveries.length ? "watching" : "clear",
    counters: {
      actionableEvents: actionable.length,
      highPriorityEvents: highPriority.length,
      blockerEvents: blockers.length,
      staleBlockerEvents: blockers.filter(({ action }) => action.stale).length,
      recoveryEvents: recoveries.length,
      unsettledRecoveryEvents: recoveries.filter(({ action }) => ["repair-recovery", "watch-recovery"].includes(action.type)).length,
      byAction: Object.fromEntries(Object.entries(byAction).sort(([left], [right]) => left.localeCompare(right))),
    },
    next: next
      ? {
          eventId: next.event.id,
          sequence: next.event.sequence,
          auditEventType: next.event.auditEventType,
          action: next.action,
        }
      : null,
    routes: {
      blockers: {
        method: "GET",
        path: "/operator-userland/cli-logs/audit",
        enabled: blockers.length > 0,
        query: { eventTypes: ["blocker"], statuses: ["observed", "failed"], order: "asc", limit: 50 },
      },
      recoveries: {
        method: "GET",
        path: "/operator-userland/cli-logs/audit",
        enabled: recoveries.length > 0,
        query: { eventTypes: ["recovery"], statuses: ["observed", "failed"], order: "asc", limit: 50 },
      },
    },
  };
}

function buildAuditBrowseRecord(event, includeMessages, generatedAt) {
  return {
    id: event.id,
    sequence: event.sequence,
    timestamp: event.timestamp,
    auditEventType: event.auditEventType,
    command: event.command,
    sessionId: event.sessionId,
    level: event.level,
    stream: event.stream,
    status: auditEventStatus(event),
    subject: event.auditSubject,
    proofId: event.proofId,
    redacted: event.redacted,
    nextAction: lifecycleAuditNextAction(event, generatedAt),
    messagePreview: includeMessages ? (event.message.length > 220 ? `${event.message.slice(0, 217)}...` : event.message) : null,
  };
}

function buildAuditBrowserFacet(events, fieldName) {
  const counts = events.reduce((accumulator, event) => {
    const value = fieldName === "status" ? auditEventStatus(event) : event[fieldName];
    if (value) accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sortAuditEventsForBrowser(events, order) {
  return [...events].sort((left, right) => {
    const timestampCompare = left.timestamp.localeCompare(right.timestamp);
    const sequenceCompare = left.sequence - right.sequence;
    const idCompare = left.id.localeCompare(right.id);
    const result = timestampCompare || sequenceCompare || idCompare;
    return order === "desc" ? -result : result;
  });
}

function buildAuditLogBrowser(input, events, generatedAt, tenantBoundary) {
  const request = normalizeAuditBrowserRequest(input, generatedAt);
  const accessEvaluations = events.map((event) => ({
    event,
    accessGate: tenantBoundary ? buildAuditEventAccessGate([event.auditEventType], tenantBoundary, "status") : null,
  }));
  const browseDenied = accessEvaluations.filter(({ accessGate }) => accessGate && !accessGate.browseAllowed);
  const browseableEvents = accessEvaluations.filter(({ accessGate }) => !accessGate || accessGate.browseAllowed).map(({ event }) => event);
  const chronological = sortAuditEventsForBrowser(browseableEvents, "asc");
  const ordered = sortAuditEventsForBrowser(browseableEvents, request.order);
  const matching = request.valid ? ordered.filter((event) => eventMatchesAuditBrowser(event, request)) : [];
  const visible = matching.slice(0, request.limit);
  const lifecycleQueues = buildAuditLifecycleQueues(chronological, generatedAt);
  const countsByType = AUDIT_EVENT_TYPES.reduce((accumulator, type) => {
    accumulator[type] = chronological.filter((event) => event.auditEventType === type).length;
    return accumulator;
  }, {});
  const visibleCountsByType = AUDIT_EVENT_TYPES.reduce((accumulator, type) => {
    accumulator[type] = visible.filter((event) => event.auditEventType === type).length;
    return accumulator;
  }, {});
  const latestByType = Object.fromEntries(
    AUDIT_EVENT_TYPES.map((type) => {
      const latest = [...chronological].reverse().find((event) => event.auditEventType === type) || null;
      return [type, latest ? buildAuditBrowseRecord(latest, false, generatedAt) : null];
    })
  );
  const nextEvent = matching[visible.length] || null;
  const returnedLast = visible.at(-1) || null;
  const nextAfterSequence = request.order === "asc" && nextEvent ? returnedLast?.sequence || request.afterSequence : null;
  const nextBeforeSequence = request.order === "desc" && nextEvent ? returnedLast?.sequence || request.beforeSequence : null;
  const browserSubject = {
    surfaceId,
    request,
    visibleEventIds: visible.map((event) => event.id),
    nextAfterSequence,
    nextBeforeSequence,
    browseDeniedEventIds: browseDenied.map(({ event }) => event.id),
  };

  return {
    schema: "aios.cliLogs.auditLogBrowser.v1",
    generatedAt,
    request,
    state: !request.valid ? "invalid-request" : matching.length ? "ready" : "empty",
    supportedEventTypes: AUDIT_EVENT_TYPES,
    validation: {
      valid: request.valid,
      errors: request.validation,
      unsupportedEventTypes: request.unsupportedEventTypes,
      unsupportedStatuses: request.unsupportedStatuses,
    },
    counters: {
      totalEvents: events.length,
      browseableEvents: ordered.length,
      policyDeniedEvents: browseDenied.length,
      matchedEvents: matching.length,
      returnedEvents: visible.length,
      countsByType,
      returnedByType: visibleCountsByType,
    },
    accessPolicy: {
      schema: "aios.cliLogs.auditBrowserAccessPolicy.v1",
      state: browseDenied.length ? "filtered" : "ready",
      deniedEventCount: browseDenied.length,
      deniedEventIds: browseDenied.map(({ event }) => event.id),
      deniedByType: Object.fromEntries(
        AUDIT_EVENT_TYPES.map((type) => [
          type,
          browseDenied.filter(({ event }) => event.auditEventType === type).length,
        ]).filter(([, count]) => count > 0)
      ),
      missingPermissions: [...new Set(browseDenied.flatMap(({ accessGate }) => accessGate.missingPermissions))].sort(),
    },
    lifecycleQueues,
    facets: {
      commands: buildAuditBrowserFacet(chronological, "command"),
      sessions: buildAuditBrowserFacet(chronological, "sessionId"),
      statuses: buildAuditBrowserFacet(chronological, "status"),
      levels: buildAuditBrowserFacet(chronological, "level"),
    },
    cursor: {
      afterSequence: request.afterSequence,
      beforeSequence: request.beforeSequence,
      order: request.order,
      returnedFirstSequence: visible[0]?.sequence || null,
      returnedLastSequence: returnedLast?.sequence || request.afterSequence,
      nextAfterSequence,
      nextBeforeSequence,
      hasMore: Boolean(nextEvent),
    },
    windows: AUDIT_EVENT_TYPES.map((type) => {
      const typeEvents = chronological.filter((event) => event.auditEventType === type);
      const routeQuery = {
        eventType: type,
        afterSequence: typeEvents.at(-1)?.sequence || 0,
        limit: request.limit,
        order: "asc",
      };
      return {
        eventType: type,
        count: typeEvents.length,
        firstEventAt: typeEvents[0]?.timestamp || null,
        lastEventAt: typeEvents.at(-1)?.timestamp || null,
        latest: latestByType[type],
        route: {
          method: "GET",
          path: "/operator-userland/cli-logs/audit",
          enabled: request.valid,
          query: routeQuery,
        },
      };
    }),
    events: visible.map((event) => ({
      ...buildAuditBrowseRecord(event, request.includeMessages, generatedAt),
      accessPolicy: {
        browsePermission: auditEventPolicyFor(event.auditEventType).browsePermission,
        sensitivity: auditEventPolicyFor(event.auditEventType).sensitivity,
      },
    })),
    routes: {
      browse: {
        method: "GET",
        path: "/operator-userland/cli-logs/audit",
        enabled: request.valid,
        query: {
          eventTypes: request.eventTypes,
          afterSequence: request.afterSequence,
          beforeSequence: request.beforeSequence,
          limit: request.limit,
          since: request.since,
          until: request.until,
          commands: request.commands,
          sessionIds: request.sessionIds,
          statuses: request.statuses,
          order: request.order,
        },
      },
      nextAction: lifecycleQueues.next?.action.route || null,
      blockers: lifecycleQueues.routes.blockers,
      recoveries: lifecycleQueues.routes.recoveries,
    },
    audit: {
      digest: digestPayload(browserSubject),
      subject: browserSubject,
    },
  };
}

function buildHostedKernelIngestContract(input, allEvents, permittedEvents, providers, generatedAt, tenantBoundary) {
  const rawIngest = input.ingest && typeof input.ingest === "object" ? input.ingest : {};
  const requestedMode = String(rawIngest.captureMode || input.captureMode || "hosted-kernel").trim().toLowerCase();
  const captureMode = KNOWN_CAPTURE_MODES.has(requestedMode) ? requestedMode : "hosted-kernel";
  const captureProvider = providers.find((provider) => provider.capabilities.includes("capture") && ["active", "ready", "degraded"].includes(provider.status)) || null;
  const deniedEvents = allEvents.filter((event) => !event.scope.allowed);
  const rejectedByReason = deniedEvents.reduce((accumulator, event) => {
    accumulator[event.scope.deniedReason] = (accumulator[event.scope.deniedReason] || 0) + 1;
    return accumulator;
  }, {});
  const lastPermitted = [...permittedEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence).at(-1) || null;

  return {
    schema: "aios.cliLogs.hostedKernelIngest.v1",
    generatedAt,
    mode: captureMode,
    source: {
      kernelSessionId: String(rawIngest.kernelSessionId || input.kernelSessionId || "hosted-kernel-session"),
      nodeId: String(rawIngest.nodeId || input.nodeId || "local-hosted-node"),
      bootId: String(rawIngest.bootId || input.bootId || "boot-unknown"),
      streamTopic: String(rawIngest.streamTopic || input.streamTopic || `${tenantBoundary.tenantId}.${tenantBoundary.workspaceId}.cli-logs`),
    },
    intake: {
      receivedEvents: allEvents.length,
      acceptedEvents: permittedEvents.length,
      rejectedEvents: deniedEvents.length,
      rejectedByReason: Object.fromEntries(Object.entries(rejectedByReason).sort(([left], [right]) => left.localeCompare(right))),
      acceptedStreams: [...new Set(permittedEvents.map((event) => event.stream))].sort(),
      lastAcceptedEventId: lastPermitted ? lastPermitted.id : null,
      lastAcceptedSequence: lastPermitted ? lastPermitted.sequence : 0,
    },
    providerBinding: captureProvider
      ? {
          providerId: captureProvider.providerId,
          kind: captureProvider.kind,
          status: captureProvider.status,
          cursorToken: captureProvider.sync.cursorToken,
        }
      : null,
    accepted: Boolean(captureProvider) && captureMode === requestedMode && deniedEvents.length === 0,
    warnings: [
      ...(captureMode === requestedMode ? [] : [`unknown capture mode '${requestedMode}' normalized to hosted-kernel`]),
      ...(captureProvider ? [] : ["no active capture provider is available"]),
      ...(deniedEvents.length ? ["tenant/workspace boundary rejected one or more records"] : []),
    ],
  };
}

function buildIntegrityChain(events, ingestContract, generatedAt) {
  let previousHash = digestPayload({ surfaceId, generatedAt, source: ingestContract.source, seed: "cli-log-integrity-chain" });
  const entries = [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence)
    .map((event) => {
      const eventHash = digestPayload({
        id: event.id,
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: event.level,
        stream: event.stream,
        command: event.command,
        sessionId: event.sessionId,
        exitCode: event.exitCode,
        durationMs: event.durationMs,
        proofId: event.proofId,
        redacted: event.redacted,
        messageHash: event.redaction?.sanitizedMessageHash || event.redaction?.messageHash || null,
        tenantId: event.scope.tenantId,
        workspaceId: event.scope.workspaceId,
      });
      const chainHash = digestPayload({ previousHash, eventHash });
      previousHash = chainHash;
      return {
        id: event.id,
        sequence: event.sequence,
        eventHash,
        chainHash,
      };
    });

  return {
    schema: "aios.cliLogs.integrityChain.v1",
    generatedAt,
    algorithm: "sha256/stable-json/linear-chain",
    sourceTopic: ingestContract.source.streamTopic,
    rootHash: previousHash,
    eventCount: entries.length,
    firstEventHash: entries[0]?.eventHash || null,
    lastEventHash: entries.at(-1)?.eventHash || null,
    entries,
  };
}

function buildExportSummary(events, analytics, generatedAt, requestedFormats, tenantBoundary, integrityChain, redactionContract) {
  const formats = Array.isArray(requestedFormats) && requestedFormats.length
    ? requestedFormats.map((format) => String(format).toLowerCase())
    : DEFAULT_EXPORT_FORMATS;
  const safeFormats = formats.filter((format, index) => DEFAULT_EXPORT_FORMATS.includes(format) && formats.indexOf(format) === index);
  const exportable = events.filter((event) => event.exportable);
  const partitionCounts = exportable.reduce((accumulator, event) => {
    const partition = `${event.stream}/${event.level}`;
    accumulator[partition] = (accumulator[partition] || 0) + 1;
    return accumulator;
  }, {});
  const requestedButUnsupported = formats.filter((format, index) => !DEFAULT_EXPORT_FORMATS.includes(format) && formats.indexOf(format) === index);

  return {
    schema: "aios.cliLogs.exportSummary.v2",
    ready:
      exportable.length > 0 &&
      (!tenantBoundary || tenantBoundary.eventScope.deniedEvents === 0) &&
      (!redactionContract || redactionContract.exportSafe),
    generatedAt,
    formats: safeFormats.length ? safeFormats : DEFAULT_EXPORT_FORMATS,
    unsupportedFormats: requestedButUnsupported,
    recordCount: exportable.length,
    failedRecordCount: analytics.exportableFailures,
    redactionRequired: analytics.redactedEvents > 0,
    fields: [
      "id",
      "timestamp",
      "level",
      "stream",
      "command",
      "sessionId",
      "message",
      "exitCode",
      "durationMs",
      "proofId",
      "redaction.applied",
      "redaction.sanitizedMessageHash",
    ],
    sampleRecordIds: exportable.slice(0, 5).map((event) => event.id),
    partitions: Object.fromEntries(Object.entries(partitionCounts).sort(([left], [right]) => left.localeCompare(right))),
    batches: (safeFormats.length ? safeFormats : DEFAULT_EXPORT_FORMATS).map((format) => ({
      format,
      recordCount: exportable.length,
      contentType: format === "csv" ? "text/csv" : format === "jsonl" ? "application/x-ndjson" : "application/json",
      requiresRedactionPass: analytics.redactedEvents > 0,
    })),
    integrity: {
      algorithm: integrityChain.algorithm,
      rootHash: integrityChain.rootHash,
      eventCount: integrityChain.eventCount,
    },
    redaction: redactionContract
      ? {
          enabled: redactionContract.enabled,
          exportSafe: redactionContract.exportSafe,
          appliedRedactions: redactionContract.appliedRedactions,
          blockedSecretEvents: redactionContract.blockedSecretEvents,
        }
      : null,
    tenantBoundary: tenantBoundary
      ? {
          tenantId: tenantBoundary.tenantId,
          workspaceId: tenantBoundary.workspaceId,
          deniedEvents: tenantBoundary.eventScope.deniedEvents,
          safeForHandoff: tenantBoundary.eventScope.deniedEvents === 0,
          grantBound: tenantBoundary.crossWorkspaceMode === "grant-bound-workspaces",
          permittedByGrant: tenantBoundary.eventScope.permittedByGrant,
        }
      : null,
  };
}

function normalizePriorExportHistory(input, generatedAt) {
  const rawHistory = Array.isArray(input.exportHistory)
    ? input.exportHistory
    : Array.isArray(input.exports)
      ? input.exports
      : Array.isArray(input.previousExports)
        ? input.previousExports
        : Array.isArray(input.exportAttempts)
          ? input.exportAttempts
          : [];

  return rawHistory
    .map((entry, index) => {
      const raw = entry && typeof entry === "object" ? entry : {};
      const requestedState = String(raw.state || raw.status || (raw.ready === false ? "blocked" : "completed")).trim().toLowerCase();
      const state = ["completed", "queued", "blocked", "failed", "expired"].includes(requestedState) ? requestedState : "completed";
      const requestedFormats = Array.isArray(raw.formats)
        ? raw.formats
        : raw.format
          ? [raw.format]
          : DEFAULT_EXPORT_FORMATS;
      const formats = [...new Set(requestedFormats.map((format) => String(format).trim().toLowerCase()).filter((format) => DEFAULT_EXPORT_FORMATS.includes(format)))].sort();
      const recordCount = Math.max(0, Math.trunc(asFiniteNumber(raw.recordCount ?? raw.records ?? raw.eventCount, 0)));
      const failedRecordCount = Math.max(0, Math.trunc(asFiniteNumber(raw.failedRecordCount ?? raw.failedRecords, 0)));
      const generated = asIsoTimestamp(raw.generatedAt || raw.createdAt || raw.exportedAt || raw.timestamp, generatedAt);
      const rootHash = raw.integrityRootHash || raw.rootHash || raw.digest?.rootHash || null;
      const destinationProviderId = raw.destinationProviderId || raw.providerId || raw.handoffProviderId || null;
      const exportId = String(raw.exportId || raw.id || digestPayload({
        surfaceId,
        index,
        generated,
        state,
        recordCount,
        rootHash,
        destinationProviderId,
      }).slice(0, 24));

      return {
        exportId,
        generatedAt: generated,
        state,
        formats: formats.length ? formats : DEFAULT_EXPORT_FORMATS,
        recordCount,
        failedRecordCount,
        redactionRequired: asBooleanSetting(raw.redactionRequired ?? raw.requiresRedaction, false),
        proofCoverage: Number(asFiniteNumber(raw.proofCoverage, state === "completed" ? 1 : 0).toFixed(4)),
        integrityRootHash: rootHash ? String(rootHash) : null,
        destinationProviderId: destinationProviderId ? String(destinationProviderId) : null,
      };
    })
    .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt) || left.exportId.localeCompare(right.exportId));
}

function buildExportHistoryState(input, exportSummary, auditProof, externalHandoff, clientRequest, generatedAt) {
  const priorExports = normalizePriorExportHistory(input, generatedAt);
  const completed = priorExports.filter((entry) => entry.state === "completed");
  const blocked = priorExports.filter((entry) => entry.state === "blocked" || entry.state === "failed");
  const latest = priorExports.at(-1) || null;
  const currentSnapshot = {
    exportId: digestPayload({
      surfaceId,
      requestId: clientRequest.requestId,
      rootHash: auditProof.digest.rootHash,
      recordCount: exportSummary.recordCount,
      formats: exportSummary.formats,
    }).slice(0, 24),
    generatedAt,
    state: exportSummary.ready && externalHandoff.state !== "blocked" ? "queued" : "blocked",
    formats: exportSummary.formats,
    recordCount: exportSummary.recordCount,
    failedRecordCount: exportSummary.failedRecordCount,
    redactionRequired: exportSummary.redactionRequired,
    proofCoverage: auditProof.proofIds.length || exportSummary.recordCount === 0 ? 1 : 0,
    integrityRootHash: auditProof.digest.rootHash,
    destinationProviderId: externalHandoff.destinationProviderId,
  };
  const allSnapshots = [...priorExports, currentSnapshot];
  const totalRecords = allSnapshots.reduce((total, entry) => total + entry.recordCount, 0);
  const blockedRecordCount = allSnapshots
    .filter((entry) => entry.state === "blocked" || entry.state === "failed")
    .reduce((total, entry) => total + entry.recordCount, 0);
  const duplicateRoot = Boolean(latest?.integrityRootHash && latest.integrityRootHash === currentSnapshot.integrityRootHash);
  const recordDelta = latest ? currentSnapshot.recordCount - latest.recordCount : currentSnapshot.recordCount;
  const historySubject = {
    surfaceId,
    requestId: clientRequest.requestId,
    currentExportId: currentSnapshot.exportId,
    currentRootHash: currentSnapshot.integrityRootHash,
    priorExportCount: priorExports.length,
    currentState: currentSnapshot.state,
    recordDelta,
  };

  return {
    schema: "aios.cliLogs.exportHistory.v1",
    generatedAt,
    state: currentSnapshot.state,
    counters: {
      priorExports: priorExports.length,
      completedExports: completed.length,
      blockedExports: blocked.length,
      totalSnapshots: allSnapshots.length,
      totalRecords,
      blockedRecordCount,
      currentRecordCount: currentSnapshot.recordCount,
      recordDelta,
      duplicateIntegrityRoot: duplicateRoot,
    },
    trend: {
      direction: recordDelta > 0 ? "growing" : recordDelta < 0 ? "shrinking" : duplicateRoot ? "unchanged-root" : "flat",
      previousRecordCount: latest ? latest.recordCount : 0,
      currentRecordCount: currentSnapshot.recordCount,
      latestPriorExportAt: latest ? latest.generatedAt : null,
      latestPriorState: latest ? latest.state : null,
    },
    snapshots: allSnapshots.slice(-10),
    currentSnapshot,
    exportReadySummary: {
      ready: exportSummary.ready,
      formats: exportSummary.formats,
      unsupportedFormats: exportSummary.unsupportedFormats,
      destinationProviderId: externalHandoff.destinationProviderId,
      idempotencyKey: externalHandoff.idempotencyKey,
    },
    audit: {
      digest: digestPayload(historySubject),
      subject: historySubject,
    },
  };
}

function buildReportingState(analytics, history, timeline, exportSummary, auditProof, lifecycle, externalHandoff, redactionContract, exportHistory, auditLogBrowser, auditAnalytics, generatedAt) {
  const recentFailures = timeline.filter((entry) => entry.status === "failed").slice(-5);
  const reportSubject = {
    surfaceId,
    generatedAt,
    health: lifecycle.health,
    totalEvents: analytics.totalEvents,
    failedCommands: analytics.failedCommands,
    exportRecordCount: exportSummary.recordCount,
    auditStatus: auditProof.status,
    handoffState: externalHandoff.state,
    integrityRootHash: auditProof.digest.rootHash,
    exportHistoryDigest: exportHistory.audit.digest,
    auditBrowserDigest: auditLogBrowser.audit.digest,
  };

  return {
    schema: "aios.cliLogs.reportingState.v1",
    generatedAt,
    state: lifecycle.blocked || auditProof.status === "attention-required" ? "attention-required" : exportSummary.ready ? "export-ready" : "watching",
    reportId: digestPayload(reportSubject).slice(0, 24),
    reportSubject,
    counters: {
      events: analytics.totalEvents,
      failures: analytics.failedCommands,
      fatalEvents: analytics.byLevel.fatal,
      redactions: analytics.redactedEvents,
      redactionBlockedEvents: redactionContract.blockedSecretEvents,
      proofCoverage: analytics.proofCoverage,
      exportableRecords: exportSummary.recordCount,
      priorExports: exportHistory.counters.priorExports,
      blockedExports: exportHistory.counters.blockedExports,
      exportRecordDelta: exportHistory.counters.recordDelta,
      auditEventsByType: analytics.byAuditEventType,
    },
    timelineWindow: {
      startedAt: history.window.startedAt,
      endedAt: history.window.endedAt,
      entries: timeline.length,
      recentFailures,
    },
    exportReadiness: {
      ready: exportSummary.ready,
      formats: exportSummary.formats,
      unsupportedFormats: exportSummary.unsupportedFormats,
      handoffState: externalHandoff.state,
      destinationProviderId: externalHandoff.destinationProviderId,
      historyState: exportHistory.state,
      trend: exportHistory.trend.direction,
      duplicateIntegrityRoot: exportHistory.counters.duplicateIntegrityRoot,
    },
    auditBrowser: {
      state: auditLogBrowser.state,
      lifecycleQueueState: auditLogBrowser.lifecycleQueues.state,
      supportedEventTypes: auditLogBrowser.supportedEventTypes,
      requestedEventTypes: auditLogBrowser.request.eventTypes,
      returnedEvents: auditLogBrowser.counters.returnedEvents,
      matchedEvents: auditLogBrowser.counters.matchedEvents,
      policyDeniedEvents: auditLogBrowser.counters.policyDeniedEvents,
      countsByType: auditLogBrowser.counters.countsByType,
      accessPolicy: auditLogBrowser.accessPolicy,
      actionCounters: auditLogBrowser.lifecycleQueues.counters,
      nextAuditAction: auditLogBrowser.lifecycleQueues.next,
      cursor: auditLogBrowser.cursor,
      route: auditLogBrowser.routes.browse,
      nextActionRoute: auditLogBrowser.routes.nextAction,
      digest: auditLogBrowser.audit.digest,
    },
    auditAnalytics: {
      state: auditAnalytics.state,
      counters: auditAnalytics.counters,
      byType: auditAnalytics.byType,
      exportReadySummary: auditAnalytics.exportReadySummary,
      historyBucketCount: auditAnalytics.historyBuckets.length,
      latestHistoryBucket: auditAnalytics.historyBuckets.at(-1) || null,
      reportRoutes: auditAnalytics.reportRoutes,
      digest: auditAnalytics.audit.digest,
    },
    exportHistory,
  };
}

function buildAuditProof(events, analytics, generatedAt, tenantBoundary, integrityChain, ingestContract, redactionContract) {
  const proofIds = [...new Set(events.map((event) => event.proofId).filter(Boolean))].sort();
  return {
    generatedAt,
    subject: `${surfaceGroup}/${surfaceName}`,
    proofSchema: "aios.cliLogs.auditProof.v2",
    countersSigned: ["totalEvents", "exportableEvents", "redactedEvents", "proofLinkedEvents", "failedCommands"],
    proofIds,
    digest: {
      algorithm: integrityChain.algorithm,
      rootHash: integrityChain.rootHash,
      sourceTopic: ingestContract.source.streamTopic,
      acceptedEvents: ingestContract.intake.acceptedEvents,
      rejectedEvents: ingestContract.intake.rejectedEvents,
    },
    status:
      tenantBoundary && tenantBoundary.eventScope.deniedEvents > 0
        ? "attention-required"
        : redactionContract && !redactionContract.exportSafe
          ? "attention-required"
        : analytics.failedCommands > 0 || analytics.byLevel.fatal > 0
          ? "attention-required"
          : "ready",
    assertions: {
      everyEventHasTimestamp: events.every((event) => Boolean(event.timestamp)),
      everyEventHasSession: events.every((event) => Boolean(event.sessionId)),
      exportSetExcludesBlockedRows: events.every((event) => event.exportable || !event.proofId || event.redacted),
      tenantMatchesRequest: tenantBoundary ? tenantBoundary.eventScope.deniedByReason["tenant-mismatch"] === undefined : true,
      workspaceInsideBoundary: tenantBoundary ? tenantBoundary.eventScope.deniedByReason["workspace-outside-boundary"] === undefined : true,
      everyPermittedEventHasGrant: tenantBoundary ? events.every((event) => Boolean(event.scope.grantId)) : true,
      noInactiveGrantsParticipated: tenantBoundary ? tenantBoundary.eventScope.inactiveGrantCount === 0 : true,
      integrityChainComplete: integrityChain.eventCount === events.length,
      ingestAcceptedMatchesEvidence: ingestContract.intake.acceptedEvents === events.length,
      secretBearingRowsSanitized: redactionContract ? redactionContract.exportSafe : true,
      sanitizedMessageHashesPresent: events.every((event) => !event.redaction?.applied || Boolean(event.redaction.sanitizedMessageHash)),
    },
  };
}

function normalizeProviderCapabilities(rawCapabilities, kind) {
  const defaults =
    kind === "audit-ledger"
      ? ["proof", "retention"]
      : kind === "object-store"
        ? ["export", "handoff"]
        : kind === "webhook"
          ? ["handoff"]
          : ["capture", "tail"];
  const requested = Array.isArray(rawCapabilities) && rawCapabilities.length ? rawCapabilities : defaults;
  return [...new Set(requested.map((capability) => String(capability).trim().toLowerCase()).filter((capability) => KNOWN_CAPABILITIES.has(capability)))].sort();
}

function normalizeProviderContracts(input, generatedAt) {
  const rawProviders = Array.isArray(input.providers)
    ? input.providers
    : Array.isArray(input.serviceProviders)
      ? input.serviceProviders
      : DEFAULT_PROVIDER_CONTRACTS;

  return rawProviders.map((provider, index) => {
    const raw = provider && typeof provider === "object" ? provider : {};
    const rawContract = raw.contract && typeof raw.contract === "object" ? raw.contract : {};
    const rawLease = raw.lease && typeof raw.lease === "object" ? raw.lease : {};
    const kind = String(raw.kind || raw.type || raw.providerKind || DEFAULT_PROVIDER_CONTRACTS[index % DEFAULT_PROVIDER_CONTRACTS.length].kind).toLowerCase();
    const status = String(raw.status || raw.state || DEFAULT_PROVIDER_CONTRACTS[index % DEFAULT_PROVIDER_CONTRACTS.length].status).toLowerCase();
    const providerId = String(raw.providerId || raw.id || raw.name || `${kind}-provider-${index + 1}`);
    const cursor = raw.cursor && typeof raw.cursor === "object" ? raw.cursor : {};
    const capabilities = normalizeProviderCapabilities(raw.capabilities, kind);
    const contractVersion = Math.max(1, Math.trunc(asFiniteNumber(raw.contractVersion ?? rawContract.version, 1)));
    const endpointRef = raw.endpointRef || raw.endpoint || rawContract.endpointRef || null;
    const leaseExpiresAt = asIsoTimestamp(rawLease.expiresAt || raw.leaseExpiresAt || rawContract.leaseExpiresAt, null);
    const heartbeatAt = asIsoTimestamp(raw.heartbeatAt || raw.lastHeartbeatAt || cursor.lastHeartbeatAt || cursor.lastSyncedAt || raw.lastSyncedAt, null);
    const heartbeatAgeMs = heartbeatAt ? Math.max(0, new Date(generatedAt).getTime() - new Date(heartbeatAt).getTime()) : null;
    const staleAfterMs = Math.max(30000, Math.trunc(asFiniteNumber(raw.staleAfterMs ?? rawContract.staleAfterMs, 300000)));
    const minimumVersionByCapability = Object.fromEntries(capabilities.map((capability) => [capability, CAPABILITY_CONTRACT_FLOORS[capability] || 1]));
    const incompatibleCapabilities = capabilities.filter((capability) => contractVersion < (CAPABILITY_CONTRACT_FLOORS[capability] || 1));
    const requiresEndpoint = capabilities.some((capability) => ["export", "handoff"].includes(capability));
    const leaseValid = !leaseExpiresAt || leaseExpiresAt > generatedAt;
    const heartbeatFresh = heartbeatAgeMs === null || heartbeatAgeMs <= staleAfterMs;

    return {
      providerId,
      kind: KNOWN_PROVIDER_KINDS.has(kind) ? kind : "shell",
      status: KNOWN_PROVIDER_STATES.has(status) ? status : "offline",
      capabilities,
      endpointRef,
      sync: {
        cursorToken: cursor.token || raw.cursorToken || null,
        lastSyncedAt: asIsoTimestamp(cursor.lastSyncedAt || raw.lastSyncedAt, null),
        lastSequence: Math.max(0, Math.trunc(asFiniteNumber(cursor.lastSequence ?? raw.lastSequence, 0))),
      },
      contractVersion,
      serviceContract: {
        schema: "aios.cliLogs.providerServiceContract.v1",
        advertisedVersion: contractVersion,
        minimumVersionByCapability,
        compatible: incompatibleCapabilities.length === 0,
        incompatibleCapabilities,
        requiresEndpoint,
        endpointBound: !requiresEndpoint || Boolean(endpointRef),
      },
      availability: {
        leaseId: rawLease.leaseId || raw.leaseId || null,
        leaseExpiresAt,
        leaseValid,
        heartbeatAt,
        heartbeatAgeMs,
        staleAfterMs,
        heartbeatFresh,
        routable: KNOWN_PROVIDER_STATES.has(status) && ["active", "ready", "degraded"].includes(status) && leaseValid && heartbeatFresh,
      },
      registeredAt: asIsoTimestamp(raw.registeredAt, generatedAt),
    };
  });
}

function requiredCapabilitiesForLifecycle(lifecycle, settings, exportSummary) {
  const required = new Set(["capture"]);
  if (lifecycle.requestedEffect === "stream-tail") required.add("tail");
  if (lifecycle.requestedEffect === "prepare-export" || exportSummary.ready) required.add("export");
  if (settings.requireProofForExport) required.add("proof");
  if (settings.redactSecrets) required.add("redaction");
  if (lifecycle.requestedEffect === "apply-retention") required.add("retention");
  if (lifecycle.requestedEffect === "prepare-export") required.add("handoff");
  return [...required].sort();
}

function rankCapabilityProvider(provider) {
  const statusScore = provider.status === "active" ? 0 : provider.status === "ready" ? 1 : provider.status === "degraded" ? 2 : 9;
  const heartbeatScore = provider.availability.heartbeatFresh ? 0 : 4;
  const endpointScore = provider.serviceContract.endpointBound ? 0 : 5;
  return statusScore + heartbeatScore + endpointScore - provider.contractVersion / 100;
}

function negotiateProviderContract(providers, lifecycle, lifecycleSettings, exportSummary, generatedAt) {
  const requiredCapabilities = requiredCapabilitiesForLifecycle(lifecycle, lifecycleSettings.settings, exportSummary);
  const routableProviders = providers.filter(
    (provider) =>
      provider.availability.routable &&
      provider.serviceContract.compatible &&
      provider.serviceContract.endpointBound
  );
  const capabilityRoutes = Object.fromEntries(
    requiredCapabilities.map((capability) => {
      const provider = routableProviders
        .filter((candidate) => candidate.capabilities.includes(capability))
        .sort((left, right) => rankCapabilityProvider(left) - rankCapabilityProvider(right) || left.providerId.localeCompare(right.providerId))[0];
      return [
        capability,
        provider
          ? {
              providerId: provider.providerId,
              kind: provider.kind,
              status: provider.status,
              contractVersion: provider.contractVersion,
              cursorToken: provider.sync.cursorToken,
              leaseExpiresAt: provider.availability.leaseExpiresAt,
            }
          : null,
      ];
    })
  );
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilityRoutes[capability]);
  const blockedProviders = providers
    .map((provider) => {
      const reasons = [
        ...(provider.availability.leaseValid ? [] : ["lease-expired"]),
        ...(provider.availability.heartbeatFresh ? [] : ["heartbeat-stale"]),
        ...(provider.serviceContract.compatible ? [] : [`contract-version-below-floor:${provider.serviceContract.incompatibleCapabilities.join("|")}`]),
        ...(provider.serviceContract.endpointBound ? [] : ["endpoint-required"]),
        ...(["paused", "offline"].includes(provider.status) ? [`provider-${provider.status}`] : []),
      ];
      return reasons.length
        ? {
            providerId: provider.providerId,
            kind: provider.kind,
            status: provider.status,
            capabilities: provider.capabilities,
            reasons,
          }
        : null;
    })
    .filter(Boolean);
  const degradedRoutes = Object.entries(capabilityRoutes)
    .filter(([, route]) => route?.status === "degraded")
    .map(([capability, route]) => ({ capability, providerId: route.providerId }));
  const negotiationSubject = {
    surfaceId,
    generatedAt,
    command: lifecycle.command.command,
    requestedEffect: lifecycle.requestedEffect,
    requiredCapabilities,
    routedProviderIds: Object.values(capabilityRoutes).map((route) => route?.providerId || null),
    missingCapabilities,
    blockedProviderIds: blockedProviders.map((provider) => provider.providerId),
  };

  return {
    schema: "aios.cliLogs.providerContract.v2",
    generatedAt,
    mode: missingCapabilities.length ? "blocked" : degradedRoutes.length ? "degraded" : "ready",
    requiredCapabilities,
    missingCapabilities,
    capabilityRoutes,
    degradedRoutes,
    blockedProviders,
    negotiation: {
      routableProviderCount: routableProviders.length,
      selectedProviderIds: [...new Set(Object.values(capabilityRoutes).map((route) => route?.providerId).filter(Boolean))].sort(),
      proofDigest: digestPayload(negotiationSubject),
      subject: negotiationSubject,
    },
    providerCount: providers.length,
    activeProviderCount: routableProviders.length,
  };
}

function buildSyncMetadata(events, providers, lifecycle, generatedAt) {
  const lastEvent = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence).at(-1) || null;
  const lastSequence = lastEvent ? lastEvent.sequence : 0;
  const providerCursors = providers.map((provider) => {
    const lagEvents = Math.max(0, lastSequence - provider.sync.lastSequence);
    const aheadEvents = Math.max(0, provider.sync.lastSequence - lastSequence);
    const state =
      aheadEvents > 0
        ? "ahead-of-watermark"
        : !provider.availability.leaseValid
          ? "lease-expired"
          : !provider.availability.heartbeatFresh
            ? "stale"
            : lagEvents > 0
              ? "lagging"
              : "synced";
    return {
      providerId: provider.providerId,
      status: provider.status,
      lastSyncedAt: provider.sync.lastSyncedAt,
      lastSequence: provider.sync.lastSequence,
      lagEvents,
      aheadEvents,
      state,
      cursorToken: provider.sync.cursorToken,
      contractVersion: provider.contractVersion,
      leaseExpiresAt: provider.availability.leaseExpiresAt,
      heartbeatAt: provider.availability.heartbeatAt,
      heartbeatAgeMs: provider.availability.heartbeatAgeMs,
    };
  });
  return {
    schema: "aios.cliLogs.syncMetadata.v2",
    generatedAt,
    watermark: {
      eventId: lastEvent ? lastEvent.id : null,
      timestamp: lastEvent ? lastEvent.timestamp : generatedAt,
      sequence: lastSequence,
    },
    providerCursors,
    replayRequired: providerCursors.some((cursor) => cursor.aheadEvents > 0),
    syncState:
      providerCursors.some((cursor) => cursor.state === "ahead-of-watermark")
        ? "requires-replay"
        : providerCursors.some((cursor) => ["lease-expired", "stale"].includes(cursor.state))
          ? "stale"
          : providerCursors.some((cursor) => cursor.state === "lagging")
            ? "catching-up"
            : "synced",
    syncWarnings: providerCursors
      .filter((cursor) => cursor.state !== "synced")
      .map((cursor) => ({
        providerId: cursor.providerId,
        state: cursor.state,
        lagEvents: cursor.lagEvents,
        aheadEvents: cursor.aheadEvents,
      })),
    bufferUtilization: lifecycle.cursor.bufferUtilization,
  };
}

function buildProviderSyncPlan(providers, providerContract, syncMetadata, lifecycle, externalHandoff, generatedAt) {
  const selectedProviderIds = new Set(providerContract.negotiation.selectedProviderIds);
  const requiredByProvider = providers.reduce((accumulator, provider) => {
    accumulator[provider.providerId] = providerContract.requiredCapabilities.filter(
      (capability) => providerContract.capabilityRoutes[capability]?.providerId === provider.providerId
    );
    return accumulator;
  }, {});
  const cursorByProvider = new Map(syncMetadata.providerCursors.map((cursor) => [cursor.providerId, cursor]));
  const routeForCapability = (provider, capability, cursor) => ({
    method: capability === "tail" || capability === "capture" ? "GET" : "POST",
    path:
      capability === "tail"
        ? "/operator-userland/cli-logs/tail"
        : capability === "handoff"
          ? "/operator-userland/cli-logs/export"
          : capability === "proof"
            ? "/operator-userland/cli-logs/proof"
            : "/operator-userland/cli-logs/sync",
    enabled:
      provider.availability.routable &&
      provider.serviceContract.compatible &&
      provider.serviceContract.endpointBound &&
      cursor.state !== "ahead-of-watermark",
    query: capability === "tail" || capability === "capture" ? { afterSequence: cursor.lastSequence } : undefined,
    payload:
      capability === "tail" || capability === "capture"
        ? undefined
        : {
            providerId: provider.providerId,
            capability,
            cursorToken: cursor.cursorToken,
            watermark: syncMetadata.watermark,
            idempotencyKey: digestPayload({
              surfaceId,
              providerId: provider.providerId,
              capability,
              sequence: syncMetadata.watermark.sequence,
              command: lifecycle.command.command,
            }).slice(0, 32),
          },
  });
  const providerPlans = providers.map((provider) => {
    const cursor = cursorByProvider.get(provider.providerId) || {
      state: "unknown",
      lagEvents: 0,
      aheadEvents: 0,
      lastSequence: 0,
      cursorToken: null,
    };
    const requiredCapabilities = requiredByProvider[provider.providerId] || [];
    const missingSelectedCapabilities = requiredCapabilities.filter((capability) => !provider.capabilities.includes(capability));
    const blockedReasons = [
      ...(selectedProviderIds.has(provider.providerId) || requiredCapabilities.length ? [] : ["not-selected-for-current-command"]),
      ...(provider.availability.leaseValid ? [] : ["lease-expired"]),
      ...(provider.availability.heartbeatFresh ? [] : ["heartbeat-stale"]),
      ...(provider.serviceContract.compatible ? [] : [`contract-version-below-floor:${provider.serviceContract.incompatibleCapabilities.join("|")}`]),
      ...(provider.serviceContract.endpointBound ? [] : ["endpoint-required-for-service-route"]),
      ...(cursor.state === "ahead-of-watermark" ? ["provider-cursor-ahead-of-watermark"] : []),
      ...(missingSelectedCapabilities.length ? [`selected-capability-missing:${missingSelectedCapabilities.join("|")}`] : []),
    ];
    const routes = Object.fromEntries(requiredCapabilities.map((capability) => [capability, routeForCapability(provider, capability, cursor)]));

    return {
      providerId: provider.providerId,
      kind: provider.kind,
      selected: selectedProviderIds.has(provider.providerId),
      requiredCapabilities,
      state: blockedReasons.length ? "blocked" : cursor.lagEvents > 0 ? "needs-sync" : "ready",
      blockedReasons,
      cursor: {
        state: cursor.state,
        lastSequence: cursor.lastSequence,
        lagEvents: cursor.lagEvents,
        aheadEvents: cursor.aheadEvents,
        cursorToken: cursor.cursorToken,
      },
      serviceContract: {
        advertisedVersion: provider.contractVersion,
        compatible: provider.serviceContract.compatible,
        endpointBound: provider.serviceContract.endpointBound,
        leaseValid: provider.availability.leaseValid,
        heartbeatFresh: provider.availability.heartbeatFresh,
      },
      routes,
    };
  });
  const selectedPlans = providerPlans.filter((plan) => plan.selected || plan.requiredCapabilities.length > 0);
  const blockedSelected = selectedPlans.filter((plan) => plan.blockedReasons.length > 0);
  const laggingSelected = selectedPlans.filter((plan) => plan.cursor.lagEvents > 0);
  const syncSubject = {
    surfaceId,
    generatedAt,
    command: lifecycle.command.command,
    requiredCapabilities: providerContract.requiredCapabilities,
    selectedProviderIds: [...selectedProviderIds].sort(),
    watermark: syncMetadata.watermark,
    handoffState: externalHandoff.state,
    blockedProviderIds: blockedSelected.map((plan) => plan.providerId),
  };

  return {
    schema: "aios.cliLogs.providerSyncPlan.v1",
    generatedAt,
    state: blockedSelected.length ? "blocked" : laggingSelected.length ? "catching-up" : "ready",
    requiredCapabilities: providerContract.requiredCapabilities,
    watermark: syncMetadata.watermark,
    selectedProviderCount: selectedPlans.length,
    blockedSelectedProviderCount: blockedSelected.length,
    laggingSelectedProviderCount: laggingSelected.length,
    handoff: {
      state: externalHandoff.state,
      destinationProviderId: externalHandoff.destinationProviderId,
      deliveryRetryable: externalHandoff.deliveryContract.retryable,
      receiptRequired: externalHandoff.deliveryContract.receiptRequired,
    },
    providers: providerPlans,
    routePlan: Object.fromEntries(
      providerContract.requiredCapabilities.map((capability) => {
        const route = providerContract.capabilityRoutes[capability];
        const plan = route ? providerPlans.find((entry) => entry.providerId === route.providerId) : null;
        return [capability, plan?.routes[capability] || null];
      })
    ),
    audit: {
      digest: digestPayload(syncSubject),
      subject: syncSubject,
    },
  };
}

function operationalIssue(code, severity, summary, action, evidence = {}) {
  const retryable = RETRYABLE_FAILURE_CODES.has(code);
  return {
    code,
    severity,
    retryable,
    summary,
    action,
    evidence,
  };
}

function buildBackoffPlan(issueCount, generatedAt) {
  if (issueCount === 0) {
    return {
      enabled: false,
      attempt: 0,
      nextRetryAt: null,
      delayMs: 0,
      jitterMs: 0,
      maxDelayMs: 0,
    };
  }
  const attempt = Math.min(6, issueCount);
  const baseDelayMs = 1000 * 2 ** (attempt - 1);
  const delayMs = Math.min(60000, baseDelayMs);
  const jitterMs = Math.min(5000, Math.round(delayMs * 0.2));
  return {
    enabled: true,
    attempt,
    nextRetryAt: new Date(new Date(generatedAt).getTime() + delayMs + jitterMs).toISOString(),
    delayMs,
    jitterMs,
    maxDelayMs: 60000,
  };
}

function normalizeRetryAttemptHistory(input, generatedAt) {
  const raw =
    input.retryState && typeof input.retryState === "object"
      ? input.retryState
      : input.operationalRetries && typeof input.operationalRetries === "object"
        ? input.operationalRetries
        : {};
  const rawAttempts = [
    ...(Array.isArray(raw.attempts) ? raw.attempts : []),
    ...(Array.isArray(input.retryAttempts) ? input.retryAttempts : []),
    ...(Array.isArray(input.retryHistory) ? input.retryHistory : []),
  ];
  const defaultMaxAttempts = Math.min(10, Math.max(1, Math.trunc(asFiniteNumber(raw.maxAttempts ?? input.maxRetryAttempts, 5))));
  const attempts = rawAttempts
    .map((entry, index) => {
      const attempt = entry && typeof entry === "object" ? entry : {};
      const code = String(attempt.code || attempt.issueCode || attempt.failureCode || "unknown").trim().toLowerCase();
      const attemptedAt = asIsoTimestamp(attempt.attemptedAt || attempt.createdAt || attempt.timestamp, generatedAt);
      const completedAt = asIsoTimestamp(attempt.completedAt || attempt.finishedAt, null);
      const retryAfter = asIsoTimestamp(attempt.retryAfter || attempt.nextRetryAt || attempt.cooldownUntil, null);
      const state = String(attempt.state || attempt.status || (completedAt ? "failed" : "scheduled")).trim().toLowerCase();
      const normalizedState = ["scheduled", "running", "failed", "succeeded", "abandoned", "cooling-down"].includes(state) ? state : "failed";

      return {
        attemptId: String(attempt.attemptId || attempt.id || digestPayload({ surfaceId, index, code, attemptedAt }).slice(0, 24)),
        code,
        state: normalizedState,
        attemptedAt,
        completedAt,
        retryAfter,
        delayMs: Math.max(0, Math.trunc(asFiniteNumber(attempt.delayMs, 0))),
        error: attempt.error || attempt.lastError || null,
      };
    })
    .filter((attempt) => RETRYABLE_FAILURE_CODES.has(attempt.code))
    .sort((left, right) => left.attemptedAt.localeCompare(right.attemptedAt) || left.attemptId.localeCompare(right.attemptId));
  const profiles = Object.fromEntries(
    [...new Set(attempts.map((attempt) => attempt.code))].sort().map((code) => {
      const codeAttempts = attempts.filter((attempt) => attempt.code === code);
      const failedAttempts = codeAttempts.filter((attempt) => ["failed", "abandoned"].includes(attempt.state));
      const activeAttempt = [...codeAttempts].reverse().find((attempt) => ["scheduled", "running", "cooling-down"].includes(attempt.state)) || null;
      const lastAttempt = codeAttempts.at(-1) || null;
      const retryAfter = [activeAttempt?.retryAfter, lastAttempt?.retryAfter].filter(Boolean).sort().at(-1) || null;
      const coolingDown = Boolean(retryAfter && retryAfter > generatedAt);
      const exhausted = failedAttempts.length >= defaultMaxAttempts;

      return [
        code,
        {
          code,
          attemptCount: codeAttempts.length,
          failedAttemptCount: failedAttempts.length,
          maxAttempts: defaultMaxAttempts,
          exhausted,
          coolingDown,
          retryAfter,
          lastAttemptId: lastAttempt?.attemptId || null,
          lastAttemptAt: lastAttempt?.attemptedAt || null,
          lastError: lastAttempt?.error || null,
        },
      ];
    })
  );

  return {
    schema: "aios.cliLogs.retryAttemptHistory.v1",
    generatedAt,
    maxAttempts: defaultMaxAttempts,
    attemptCount: attempts.length,
    attempts: attempts.slice(-20),
    profiles,
  };
}

function retryProfileForIssue(issue, retryAttemptHistory, generatedAt) {
  const profile = retryAttemptHistory.profiles[issue.code] || {
    code: issue.code,
    attemptCount: 0,
    failedAttemptCount: 0,
    maxAttempts: retryAttemptHistory.maxAttempts,
    exhausted: false,
    coolingDown: false,
    retryAfter: null,
    lastAttemptId: null,
    lastAttemptAt: null,
    lastError: null,
  };
  const backoff = buildBackoffPlan(Math.max(1, profile.failedAttemptCount + 1), generatedAt);
  const nextRetryAt = profile.coolingDown ? profile.retryAfter : backoff.nextRetryAt;

  return {
    ...profile,
    retryableNow: issue.retryable && !profile.exhausted && !profile.coolingDown,
    nextRetryAt,
    backoff: {
      ...backoff,
      nextRetryAt,
      attempt: Math.min(profile.maxAttempts, Math.max(backoff.attempt, profile.failedAttemptCount + 1)),
    },
  };
}

function routeForOperationalIssue(code) {
  return {
    method: code === "settings-control-blocked" ? "PATCH" : code === "provider-lag" || code === "restart-recovery" ? "POST" : "GET",
    path:
      code === "provider-lag"
        ? "/operator-userland/cli-logs/sync"
        : code === "restart-recovery"
          ? "/operator-userland/cli-logs/recover"
          : code === "settings-control-blocked"
            ? "/operator-userland/cli-logs/settings"
            : code === "handoff-blocked"
              ? "/operator-userland/cli-logs/export"
              : "/operator-userland/cli-logs/status",
  };
}

function buildOperationalRuntimePlan({ issues, lifecycle, providerContract, syncMetadata, retryAttemptHistory, generatedAt }) {
  const critical = issues.filter((issue) => issue.severity === "critical");
  const retryable = issues.filter((issue) => issue.retryable);
  const retryProfiles = Object.fromEntries(retryable.map((issue) => [issue.code, retryProfileForIssue(issue, retryAttemptHistory, generatedAt)]));
  const retryBlockedCodes = Object.values(retryProfiles)
    .filter((profile) => profile.exhausted || profile.coolingDown)
    .map((profile) => profile.code)
    .sort();
  const codes = new Set(issues.map((issue) => issue.code));
  const hardBlockCodes = new Set([
    "lifecycle-blocked",
    "boundary-denied",
    "missing-provider-capability",
    "redaction-unsafe",
    "persisted-command-blocked",
    "settings-control-blocked",
  ]);
  const readOnly = critical.some((issue) => !issue.retryable || hardBlockCodes.has(issue.code) || retryProfiles[issue.code]?.exhausted);
  const disabledCapabilities = [
    ...(codes.has("boundary-denied") || codes.has("redaction-unsafe") ? ["export", "handoff"] : []),
    ...(codes.has("missing-provider-capability") ? providerContract.missingCapabilities : []),
    ...(codes.has("lifecycle-blocked") || codes.has("persisted-command-blocked") ? ["mutate-lifecycle"] : []),
    ...(codes.has("restart-recovery") ? ["persisted-write"] : []),
  ];
  const degradedCapabilities = [
    ...(codes.has("provider-degraded") ? providerContract.requiredCapabilities : []),
    ...(codes.has("provider-lag") ? ["freshness", "export"] : []),
    ...(codes.has("audit-attention") ? ["proof-handoff"] : []),
    ...(codes.has("failed-command") ? ["auto-replay"] : []),
    ...(codes.has("handoff-blocked") ? ["external-handoff"] : []),
  ].filter((capability, index, all) => all.indexOf(capability) === index && !disabledCapabilities.includes(capability));
  const safeCommands = LIFECYCLE_COMMANDS.size
    ? [...LIFECYCLE_COMMANDS].filter((command) => {
        if (readOnly) return ["status", "tail"].includes(command);
        if (command === "export" && disabledCapabilities.includes("export")) return false;
        if (["start", "stop", "restart", "rotate", "purge"].includes(command) && disabledCapabilities.includes("mutate-lifecycle")) return false;
        if (command === "purge" && disabledCapabilities.includes("persisted-write")) return false;
        return true;
      }).sort()
    : ["status"];
  const retryWindows = retryable.map((issue) => {
    const profile = retryProfiles[issue.code];
    return {
      code: issue.code,
      route: routeForOperationalIssue(issue.code),
      nextRetryAt: profile.nextRetryAt,
      delayMs: profile.backoff.delayMs,
      attempt: profile.backoff.attempt,
      retryableNow: profile.retryableNow,
      coolingDown: profile.coolingDown,
      exhausted: profile.exhausted,
      lastAttemptId: profile.lastAttemptId,
      idempotencyKey: digestPayload({
        surfaceId,
        code: issue.code,
        command: lifecycle.command.command,
        watermark: syncMetadata.watermark,
        generatedAt,
      }).slice(0, 32),
    };
  });
  const operatorErrors = issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.summary,
    remediation: issue.action,
    route: routeForOperationalIssue(issue.code),
    acknowledgementRequired: issue.severity === "critical" && (!issue.retryable || retryProfiles[issue.code]?.exhausted === true),
    retryAt: retryWindows.find((window) => window.code === issue.code)?.nextRetryAt || null,
    retryState: retryProfiles[issue.code] || null,
  }));
  const subject = {
    surfaceId,
    command: lifecycle.command.command,
    healthCodes: [...codes].sort(),
    disabledCapabilities: [...new Set(disabledCapabilities)].sort(),
    degradedCapabilities: degradedCapabilities.sort(),
    retryBlockedCodes,
    watermark: syncMetadata.watermark,
  };

  return {
    schema: "aios.cliLogs.operationalRuntimePlan.v1",
    generatedAt,
    mode: readOnly ? "read-only" : issues.length ? "degraded" : "read-write",
    admissionControl: {
      state: readOnly ? "deny-mutations" : critical.length ? "operator-gated" : issues.length ? "allow-with-retry" : "allow",
      currentCommandAllowed: safeCommands.includes(lifecycle.command.command),
      allowedCommands: safeCommands,
      blockedCommands: [...LIFECYCLE_COMMANDS].filter((command) => !safeCommands.includes(command)).sort(),
    },
    capabilityState: {
      disabled: [...new Set(disabledCapabilities)].sort(),
      degraded: degradedCapabilities,
      routed: Object.fromEntries(
        Object.entries(providerContract.capabilityRoutes).map(([capability, route]) => [
          capability,
          route ? { ...route, usable: !disabledCapabilities.includes(capability) } : null,
        ])
      ),
    },
    retryWindows,
    retryAttemptHistory: {
      attemptCount: retryAttemptHistory.attemptCount,
      maxAttempts: retryAttemptHistory.maxAttempts,
      blockedCodes: retryBlockedCodes,
      profiles: retryProfiles,
    },
    operatorErrors,
    proof: {
      digest: digestPayload(subject),
      subject,
    },
  };
}

function buildOperationalHealth({
  analytics,
  lifecycle,
  providerContract,
  syncMetadata,
  auditProof,
  restartRecovery,
  persistedCommand,
  externalHandoff,
  settingsControl,
  ingestContract,
  redactionContract,
  sequenceWindow,
  tenantBoundary,
  retryAttemptHistory,
  generatedAt,
}) {
  const laggingProviders = syncMetadata.providerCursors.filter((cursor) => cursor.lagEvents > 0);
  const degradedProviders = syncMetadata.providerCursors.filter((cursor) => cursor.status === "degraded");
  const issues = [
    ...(lifecycle.blocked
      ? [
          operationalIssue("lifecycle-blocked", "critical", lifecycle.blockReason, "Correct lifecycle settings or permissions before retrying.", {
            command: lifecycle.command.command,
            requiredPermission: lifecycle.requiredPermission,
          }),
        ]
      : []),
    ...(tenantBoundary.eventScope.deniedEvents > 0
      ? [
          operationalIssue("boundary-denied", "critical", "Tenant/workspace boundary rejected cli-log records.", "Review rejected records and retry with the active tenant/workspace boundary.", tenantBoundary.eventScope),
        ]
      : []),
    ...(providerContract.missingCapabilities.length
      ? [
          operationalIssue("missing-provider-capability", "critical", `Missing provider capabilities: ${providerContract.missingCapabilities.join(", ")}`, "Register or resume a provider that exposes the missing capabilities.", {
            requiredCapabilities: providerContract.requiredCapabilities,
            missingCapabilities: providerContract.missingCapabilities,
            blockedProviders: providerContract.blockedProviders,
            negotiationDigest: providerContract.negotiation.proofDigest,
          }),
        ]
      : []),
    ...(degradedProviders.length
      ? [
          operationalIssue("provider-degraded", "warning", "One or more routed providers are degraded.", "Continue in degraded mode while retrying provider sync.", {
            providers: degradedProviders.map((provider) => provider.providerId),
          }),
        ]
      : []),
    ...(laggingProviders.length
      ? [
          operationalIssue("provider-lag", "warning", "Provider cursors are behind the hosted-kernel watermark.", "Retry cursor synchronization before exporting fresh logs.", {
            watermark: syncMetadata.watermark,
            providers: laggingProviders.map((provider) => ({
              providerId: provider.providerId,
              lagEvents: provider.lagEvents,
              lastSequence: provider.lastSequence,
            })),
          }),
        ]
      : []),
    ...(ingestContract.warnings.length
      ? [
          operationalIssue("ingest-warning", ingestContract.intake.acceptedEvents ? "warning" : "critical", ingestContract.warnings.join("; "), "Fix hosted-kernel ingest binding and resubmit rejected evidence.", {
            intake: ingestContract.intake,
          }),
        ]
      : []),
    ...(sequenceWindow.normalizedCount > 0
      ? [
          operationalIssue("sequence-normalized", "warning", "CLI log evidence included duplicate, regressing, or invalid sequence values.", "Use the normalized sequence window for cursors and inspect source emitters before replay.", {
            normalizedCount: sequenceWindow.normalizedCount,
            duplicateRequestedSequenceCount: sequenceWindow.duplicateRequestedSequenceCount,
            regressedSequenceCount: sequenceWindow.regressedSequenceCount,
            invalidInputSequenceCount: sequenceWindow.invalidInputSequenceCount,
            normalizedEventIds: sequenceWindow.normalizedEventIds,
            auditDigest: sequenceWindow.audit.digest,
          }),
        ]
      : []),
    ...(!redactionContract.exportSafe
      ? [
          operationalIssue("redaction-unsafe", "critical", "Secret-bearing rows remain unsafe for export.", "Enable redaction or exclude blocked rows before export.", {
            blockedEventIds: redactionContract.blockedEventIds,
          }),
        ]
      : []),
    ...(auditProof.status !== "ready"
      ? [
          operationalIssue("audit-attention", "warning", "Audit proof assertions require operator attention.", "Inspect audit proof assertions before handoff.", {
            proofIds: auditProof.proofIds,
            rootHash: auditProof.digest.rootHash,
          }),
        ]
      : []),
    ...(restartRecovery.state !== "clean"
      ? [
          operationalIssue("restart-recovery", restartRecovery.restartSafe ? "warning" : "critical", "Restart recovery is not clean.", "Complete restart recovery actions before mutating persisted state.", {
            state: restartRecovery.state,
            actions: restartRecovery.actions,
          }),
        ]
      : []),
    ...(persistedCommand.blocked
      ? [
          operationalIssue("persisted-command-blocked", "critical", persistedCommand.blockReason, "Resolve persisted command admission blockers and retry with the same idempotency key when safe.", {
            admission: persistedCommand.admission,
            idempotencyKey: persistedCommand.idempotencyKey,
          }),
        ]
      : []),
    ...(settingsControl && settingsControl.state === "blocked"
      ? [
          operationalIssue("settings-control-blocked", "critical", settingsControl.blockReason, "Correct lifecycle settings control input before applying hosted-kernel settings.", {
            intent: settingsControl.intent,
            changedFields: settingsControl.changedFields,
            validation: settingsControl.validation,
          }),
        ]
      : []),
    ...(externalHandoff.state === "blocked"
      ? [
          operationalIssue("handoff-blocked", "warning", externalHandoff.reason, "Retry external handoff after acknowledgement, provider, or export readiness is corrected.", {
            destinationProviderId: externalHandoff.destinationProviderId,
            idempotencyKey: externalHandoff.idempotencyKey,
          }),
        ]
      : []),
    ...(analytics.failedCommands > 0
      ? [
          operationalIssue("failed-command", analytics.byLevel.fatal ? "critical" : "warning", "CLI command failures were observed in the active evidence window.", "Tail recent failures and retry only idempotent commands automatically.", {
            failedCommands: analytics.failedCommands,
            failureRate: analytics.failureRate,
          }),
        ]
      : []),
  ];
  const critical = issues.filter((issue) => issue.severity === "critical");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const retryableIssues = issues.filter((issue) => issue.retryable);
  const runtimePlan = buildOperationalRuntimePlan({ issues, lifecycle, providerContract, syncMetadata, retryAttemptHistory, generatedAt });
  const retryableNow = runtimePlan.retryWindows.filter((window) => window.retryableNow);
  const retrySuppressed = runtimePlan.retryWindows.filter((window) => !window.retryableNow);
  const degradedMode = critical.length
    ? "blocked"
    : warnings.length
      ? "read-only-with-retry"
      : "normal";

  return {
    schema: "aios.cliLogs.operationalHealth.v1",
    generatedAt,
    state: critical.length ? "unhealthy" : warnings.length ? "degraded" : "healthy",
    degradedMode,
    failureState: {
      active: issues.length > 0,
      criticalCount: critical.length,
      warningCount: warnings.length,
      retryableCount: retryableIssues.length,
      retryableNowCount: retryableNow.length,
      retrySuppressedCount: retrySuppressed.length,
      codes: issues.map((issue) => issue.code),
    },
    retryPolicy: {
      automaticRetryAllowed: retryableNow.length > 0 && critical.every((issue) => issue.retryable) && runtimePlan.admissionControl.state !== "deny-mutations",
      retryableCodes: retryableIssues.map((issue) => issue.code),
      retryableNowCodes: retryableNow.map((window) => window.code),
      suppressedCodes: retrySuppressed.map((window) => ({
        code: window.code,
        reason: window.exhausted ? "max-attempts-exhausted" : window.coolingDown ? "cooldown-active" : "not-retryable-now",
        nextRetryAt: window.nextRetryAt,
      })),
      backoff: retryableNow[0]
        ? {
            enabled: true,
            attempt: retryableNow[0].attempt,
            nextRetryAt: retryableNow[0].nextRetryAt,
            delayMs: retryableNow[0].delayMs,
            jitterMs: buildBackoffPlan(retryableNow[0].attempt, generatedAt).jitterMs,
            maxDelayMs: 60000,
          }
        : buildBackoffPlan(0, generatedAt),
    },
    runtimePlan,
    actions: issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      summary: issue.summary,
      action: issue.action,
      retryable: issue.retryable,
      retryState: runtimePlan.retryAttemptHistory.profiles[issue.code] || null,
      route: routeForOperationalIssue(issue.code),
      evidence: issue.evidence,
    })),
  };
}

function normalizeClientRequestState(input, lifecycle, exportSummary, auditProof, auditLogBrowser, generatedAt) {
  const raw =
    input.clientRequest && typeof input.clientRequest === "object"
      ? input.clientRequest
      : input.request && typeof input.request === "object"
        ? input.request
        : input.clientState && typeof input.clientState === "object"
          ? input.clientState
          : {};
  const rawHandoff = raw.handoff && typeof raw.handoff === "object" ? raw.handoff : {};
  const rawSelection = raw.selection && typeof raw.selection === "object" ? raw.selection : {};
  const rawAck = raw.acknowledgement && typeof raw.acknowledgement === "object" ? raw.acknowledgement : {};
  const rawAuditBrowser =
    raw.auditBrowser && typeof raw.auditBrowser === "object"
      ? raw.auditBrowser
      : raw.auditBrowse && typeof raw.auditBrowse === "object"
        ? raw.auditBrowse
        : {};
  const requestedIntent = String(raw.intent || raw.workflowIntent || input.workflowIntent || lifecycle.command.command).trim().toLowerCase();
  const workflowIntent = ["inspect", "tail", "export", "recover", "purge", "rotate"].includes(requestedIntent) ? requestedIntent : lifecycle.command.command;
  const requestedPresentation = String(raw.presentation || raw.preferredPresentation || input.presentation || "operator-console").trim().toLowerCase();
  const preferredPresentation = ["operator-console", "json-api", "handoff-card", "audit-report"].includes(requestedPresentation)
    ? requestedPresentation
    : "operator-console";
  const selectedEventIds = Array.isArray(rawSelection.eventIds || raw.selectedEventIds)
    ? [...new Set((rawSelection.eventIds || raw.selectedEventIds).map((id) => String(id)).filter(Boolean))].sort()
    : [];
  const selectedFormats = Array.isArray(rawSelection.formats || raw.exportFormats)
    ? [...new Set((rawSelection.formats || raw.exportFormats).map((format) => String(format).trim().toLowerCase()).filter((format) => DEFAULT_EXPORT_FORMATS.includes(format)))].sort()
    : exportSummary.formats;
  const requestedAuditTypes = Array.isArray(rawAuditBrowser.eventTypes || rawAuditBrowser.types || rawSelection.auditEventTypes)
    ? rawAuditBrowser.eventTypes || rawAuditBrowser.types || rawSelection.auditEventTypes
    : rawAuditBrowser.eventType || rawSelection.auditEventType
      ? [rawAuditBrowser.eventType || rawSelection.auditEventType]
      : auditLogBrowser.request.eventTypes;
  const selectedAuditEventTypes = [...new Set(
    requestedAuditTypes
      .map((type) => String(type).trim().toLowerCase())
      .filter((type) => KNOWN_AUDIT_EVENT_TYPES.has(type))
  )].sort();
  const acknowledgedProofIds = Array.isArray(rawAck.proofIds || raw.acknowledgedProofIds)
    ? [...new Set((rawAck.proofIds || raw.acknowledgedProofIds).map((id) => String(id)).filter(Boolean))].sort()
    : [];
  const acknowledgedAuditEventIds = Array.isArray(rawAck.auditEventIds || raw.acknowledgedAuditEventIds)
    ? [...new Set((rawAck.auditEventIds || raw.acknowledgedAuditEventIds).map((id) => String(id)).filter(Boolean))].sort()
    : [];
  const destructive = ["purge", "rotate", "restart", "stop"].includes(lifecycle.command.command);
  const auditAttention = auditProof.status === "attention-required";
  const nextAuditAction = auditLogBrowser.lifecycleQueues.next;
  const highPriorityAuditPending = Boolean(nextAuditAction?.action?.priority === "high");
  const auditBrowseRequested = selectedAuditEventTypes.length > 0 || workflowIntent === "inspect" || preferredPresentation === "audit-report";
  const auditReviewRequired = highPriorityAuditPending && !acknowledgedAuditEventIds.includes(nextAuditAction.eventId);
  const acknowledgementRequired = asBooleanSetting(
    rawAck.required ?? raw.requiresAcknowledgement,
    destructive || auditAttention || auditReviewRequired || lifecycle.command.command === "export"
  );
  const missingProofAcknowledgements = acknowledgementRequired
    ? auditProof.proofIds.filter((proofId) => !acknowledgedProofIds.includes(proofId))
    : [];
  const missingAuditAcknowledgements = acknowledgementRequired && auditReviewRequired ? [nextAuditAction.eventId] : [];
  const requestId = String(raw.requestId || input.requestId || digestPayload({
    surfaceId,
    generatedAt,
    command: lifecycle.command.command,
    rootHash: auditProof.digest.rootHash,
  }).slice(0, 24));

  return {
    schema: "aios.cliLogs.clientRequest.v1",
    generatedAt,
    requestId,
    clientId: String(raw.clientId || input.clientId || "operator-cli"),
    interactionId: String(raw.interactionId || input.interactionId || requestId),
    sourceSurface: String(raw.sourceSurface || input.sourceSurface || "operator-userland"),
    workflowIntent,
    preferredPresentation,
    returnTo: rawHandoff.returnTo || raw.returnTo || input.returnTo || null,
    handoff: {
      mode: String(rawHandoff.mode || raw.handoffMode || (workflowIntent === "export" ? "external" : "inline")),
      target: rawHandoff.target || raw.handoffTarget || null,
      requestedAt: asIsoTimestamp(rawHandoff.requestedAt || raw.requestedAt, generatedAt),
    },
    selection: {
      eventIds: selectedEventIds,
      formats: selectedFormats,
      auditEventTypes: selectedAuditEventTypes,
      recordCount: selectedEventIds.length || exportSummary.recordCount,
    },
    acknowledgement: {
      required: acknowledgementRequired,
      satisfied: !acknowledgementRequired || (missingProofAcknowledgements.length === 0 && missingAuditAcknowledgements.length === 0),
      acknowledgedProofIds,
      acknowledgedAuditEventIds,
      missingProofIds: missingProofAcknowledgements,
      missingAuditEventIds: missingAuditAcknowledgements,
    },
    auditBrowser: {
      requested: auditBrowseRequested,
      state: auditLogBrowser.state,
      digest: auditLogBrowser.audit.digest,
      lifecycleQueueState: auditLogBrowser.lifecycleQueues.state,
      requiresReview: auditReviewRequired,
      selectedEventTypes: selectedAuditEventTypes,
      nextAuditAction,
      cursor: auditLogBrowser.cursor,
      route: auditLogBrowser.routes.browse,
    },
    routeHints: {
      replaySafe: IDEMPOTENT_COMMAND_EFFECTS[lifecycle.command.command] === true,
      idempotencyScope: `${surfaceId}:${requestId}:${lifecycle.command.command}`,
      auditCursorToken: digestPayload({
        surfaceId,
        requestId,
        auditBrowserDigest: auditLogBrowser.audit.digest,
        cursor: auditLogBrowser.cursor,
      }).slice(0, 32),
      responseMode: preferredPresentation === "json-api" ? "contract" : preferredPresentation,
    },
  };
}

function normalizeExternalHandoffCheckpoint(input, generatedAt) {
  const raw =
    input.externalHandoff && typeof input.externalHandoff === "object"
      ? input.externalHandoff
      : input.handoffState && typeof input.handoffState === "object"
        ? input.handoffState
        : input.priorHandoff && typeof input.priorHandoff === "object"
          ? input.priorHandoff
          : {};
  const requestedState = String(raw.state || raw.status || "idle").trim().toLowerCase();
  const state = KNOWN_HANDOFF_STATES.has(requestedState) ? requestedState : "idle";
  const deliveredAt = asIsoTimestamp(raw.deliveredAt || raw.completedAt, null);
  const acknowledgedAt = asIsoTimestamp(raw.acknowledgedAt || raw.ackAt, null);
  const expiresAt = asIsoTimestamp(raw.expiresAt || raw.expireAt, null);
  const expired = Boolean(expiresAt && expiresAt <= generatedAt);

  return {
    schema: "aios.cliLogs.externalHandoffCheckpoint.v1",
    state: expired && !["acknowledged", "delivered"].includes(state) ? "expired" : state,
    handoffId: raw.handoffId || raw.id || null,
    destinationProviderId: raw.destinationProviderId || raw.providerId || null,
    idempotencyKey: raw.idempotencyKey || null,
    receiptId: raw.receiptId || raw.externalReceiptId || null,
    deliveredAt,
    acknowledgedAt,
    expiresAt,
    retryCount: Math.max(0, Math.trunc(asFiniteNumber(raw.retryCount ?? raw.attempts, 0))),
    lastError: raw.lastError || raw.error || null,
  };
}

function buildExternalHandoffState(lifecycle, exportSummary, providerContract, auditProof, syncMetadata, generatedAt, tenantBoundary, clientRequest = null, handoffCheckpoint = null) {
  const shouldHandoff = lifecycle.requestedEffect === "prepare-export" || auditProof.status === "attention-required";
  const exportRoute = providerContract.capabilityRoutes.export;
  const handoffRoute = providerContract.capabilityRoutes.handoff;
  const destinationProviderId = handoffRoute?.providerId || exportRoute?.providerId || null;
  const currentIdempotencyKey = clientRequest
    ? `${clientRequest.routeHints.idempotencyScope}:${syncMetadata.watermark.sequence}:${exportSummary.recordCount}:${auditProof.proofIds.length}`
    : `${surfaceId}:${syncMetadata.watermark.sequence}:${exportSummary.recordCount}:${auditProof.proofIds.length}`;
  const checkpointMatches =
    handoffCheckpoint &&
    handoffCheckpoint.idempotencyKey === currentIdempotencyKey &&
    (!handoffCheckpoint.destinationProviderId || handoffCheckpoint.destinationProviderId === destinationProviderId);
  const resumableCheckpoint = Boolean(
    checkpointMatches &&
      ["queued", "failed", "expired", "blocked"].includes(handoffCheckpoint.state) &&
      handoffCheckpoint.retryCount < 3
  );
  const alreadyDelivered = Boolean(checkpointMatches && ["delivered", "acknowledged"].includes(handoffCheckpoint.state));
  const blockedReason =
    shouldHandoff && providerContract.missingCapabilities.length
      ? `missing capabilities: ${providerContract.missingCapabilities.join(", ")}`
      : shouldHandoff && tenantBoundary && tenantBoundary.eventScope.deniedEvents > 0
        ? "tenant/workspace boundary denied records from external handoff"
      : shouldHandoff && clientRequest && !clientRequest.acknowledgement.satisfied
        ? "client acknowledgement is required before external handoff"
        : shouldHandoff && !exportSummary.ready
        ? "no exportable cli log records"
        : null;

  return {
    schema: "aios.cliLogs.externalHandoff.v1",
    generatedAt,
    state: !shouldHandoff ? "idle" : alreadyDelivered ? handoffCheckpoint.state : blockedReason ? "blocked" : "queued",
    reason:
      blockedReason ||
      (alreadyDelivered
        ? `handoff already ${handoffCheckpoint.state} for current idempotency key`
        : resumableCheckpoint
          ? `resume prior ${handoffCheckpoint.state} handoff attempt`
          : shouldHandoff
            ? "cli log export or audit attention requires external handoff"
            : "no external handoff requested"),
    destinationProviderId,
    idempotencyKey: currentIdempotencyKey,
    checkpoint: handoffCheckpoint
      ? {
          ...handoffCheckpoint,
          matchesCurrentRequest: Boolean(checkpointMatches),
          resumable: resumableCheckpoint,
          alreadyDelivered,
        }
      : null,
    deliveryContract: {
      schema: "aios.cliLogs.externalDeliveryContract.v1",
      providerRoute: handoffRoute || exportRoute || null,
      requiresAcknowledgement: Boolean(clientRequest?.acknowledgement.required),
      acknowledgementSatisfied: Boolean(clientRequest?.acknowledgement.satisfied),
      syncState: syncMetadata.syncState,
      retryable: !blockedReason && (resumableCheckpoint || !alreadyDelivered),
      maxAttempts: 3,
      receiptRequired: Boolean(shouldHandoff && destinationProviderId),
    },
    payload: {
      recordCount: exportSummary.recordCount,
      formats: exportSummary.formats,
      proofIds: auditProof.proofIds,
      integrityRootHash: auditProof.digest.rootHash,
      proofSchema: auditProof.proofSchema,
      watermark: syncMetadata.watermark,
      tenantBoundary: tenantBoundary
        ? {
            tenantId: tenantBoundary.tenantId,
            workspaceId: tenantBoundary.workspaceId,
            allowedWorkspaceIds: tenantBoundary.allowedWorkspaceIds,
            isolationMode: tenantBoundary.isolationMode,
            crossWorkspaceMode: tenantBoundary.crossWorkspaceMode,
            permittedByGrant: tenantBoundary.eventScope.permittedByGrant,
            deniedEvents: tenantBoundary.eventScope.deniedEvents,
            handoffSafe: tenantBoundary.handoffSafe,
            grantDigest: digestPayload({
              tenantId: tenantBoundary.tenantId,
              workspaceId: tenantBoundary.workspaceId,
              activeGrantIds: tenantBoundary.workspaceGrants
                .filter((grant) => grant.state === "active")
                .map((grant) => grant.grantId)
                .sort(),
            }),
          }
        : null,
      clientRequest: clientRequest
        ? {
            requestId: clientRequest.requestId,
            clientId: clientRequest.clientId,
            interactionId: clientRequest.interactionId,
            workflowIntent: clientRequest.workflowIntent,
            returnTo: clientRequest.returnTo,
            responseMode: clientRequest.routeHints.responseMode,
            acknowledgementRequired: clientRequest.acknowledgement.required,
            auditBrowser: {
              requested: clientRequest.auditBrowser.requested,
              lifecycleQueueState: clientRequest.auditBrowser.lifecycleQueueState,
              nextAuditEventId: clientRequest.auditBrowser.nextAuditAction?.eventId || null,
              cursorToken: clientRequest.routeHints.auditCursorToken,
            },
          }
        : null,
    },
  };
}

function buildWorkflowContinuationContract({
  lifecycle,
  clientRequest,
  persistedCommand,
  externalHandoff,
  auditProof,
  exportSummary,
  restartRecovery,
  operationalHealth,
  generatedAt,
}) {
  const acknowledgementPending = clientRequest.acknowledgement.required && !clientRequest.acknowledgement.satisfied;
  const recoveryPending = restartRecovery.state !== "clean";
  const commandBlocked = lifecycle.blocked || persistedCommand.blocked;
  const handoffQueued = externalHandoff.state === "queued";
  const auditReviewPending = Boolean(clientRequest.auditBrowser.requiresReview);
  const resumeIntent =
    acknowledgementPending
      ? "acknowledge-proof"
      : recoveryPending
        ? "recover-state"
        : auditReviewPending
          ? "review-audit-event"
          : commandBlocked
            ? "inspect-blocker"
            : handoffQueued
              ? "resume-handoff"
              : lifecycle.command.command === "tail"
                ? "resume-tail"
                : "monitor";
  const resumeRoute =
    resumeIntent === "acknowledge-proof"
      ? {
          method: "POST",
          path: "/operator-userland/cli-logs/acknowledgements",
          rel: "acknowledge-proof",
        }
      : resumeIntent === "recover-state"
        ? {
            method: "POST",
            path: "/operator-userland/cli-logs/recover",
            rel: "recover-state",
          }
        : resumeIntent === "resume-handoff"
          ? {
              method: "POST",
              path: "/operator-userland/cli-logs/export",
              rel: "export-handoff",
            }
        : resumeIntent === "review-audit-event"
          ? {
              method: "GET",
              path: "/operator-userland/cli-logs/audit",
              rel: "review-audit-event",
              query: clientRequest.auditBrowser.nextAuditAction?.action?.route?.query || clientRequest.auditBrowser.route.query,
            }
          : resumeIntent === "resume-tail"
            ? {
                method: "GET",
                path: "/operator-userland/cli-logs/tail",
                rel: "tail-preview",
              }
            : {
                method: "GET",
                path: "/operator-userland/cli-logs/status",
                rel: "inspect-status",
              };
  const continuationSubject = {
    surfaceId,
    requestId: clientRequest.requestId,
    interactionId: clientRequest.interactionId,
    command: lifecycle.command.command,
    resumeIntent,
    transactionId: persistedCommand.transactionId,
    handoffState: externalHandoff.state,
    rootHash: auditProof.digest.rootHash,
    missingProofIds: clientRequest.acknowledgement.missingProofIds,
    auditBrowserDigest: clientRequest.auditBrowser.digest,
    missingAuditEventIds: clientRequest.acknowledgement.missingAuditEventIds,
    nextAuditEventId: clientRequest.auditBrowser.nextAuditAction?.eventId || null,
  };
  const continuationToken = digestPayload(continuationSubject).slice(0, 40);
  const blockingReasons = [
    ...(lifecycle.blocked ? [lifecycle.blockReason] : []),
    ...(persistedCommand.blocked ? [persistedCommand.blockReason] : []),
    ...(acknowledgementPending
      ? [
          clientRequest.acknowledgement.missingAuditEventIds.length
            ? `acknowledge audit event ids: ${clientRequest.acknowledgement.missingAuditEventIds.join(", ")}`
            : `acknowledge proof ids: ${clientRequest.acknowledgement.missingProofIds.join(", ") || "none"}`,
        ]
      : []),
    ...(auditReviewPending && !acknowledgementPending
      ? [`review audit event: ${clientRequest.auditBrowser.nextAuditAction.eventId}`]
      : []),
    ...(recoveryPending ? [`restart recovery: ${restartRecovery.actions.join(", ") || restartRecovery.state}`] : []),
    ...(externalHandoff.state === "blocked" ? [externalHandoff.reason] : []),
    ...(operationalHealth.state === "unhealthy" ? operationalHealth.actions.filter((action) => action.severity === "critical").map((action) => action.summary) : []),
  ];

  return {
    schema: "aios.cliLogs.workflowContinuation.v1",
    generatedAt,
    state: blockingReasons.length ? "blocked" : handoffQueued ? "handoff-ready" : "continuable",
    continuationToken,
    resumeIntent,
    resumeRoute: {
      ...resumeRoute,
      enabled:
        blockingReasons.length === 0 ||
        resumeIntent === "acknowledge-proof" ||
        resumeIntent === "recover-state" ||
        resumeIntent === "review-audit-event",
      idempotencyKey:
        resumeIntent === "resume-handoff"
          ? externalHandoff.idempotencyKey
          : resumeIntent === "review-audit-event"
            ? clientRequest.routeHints.auditCursorToken
          : resumeIntent === "acknowledge-proof"
            ? digestPayload({
                continuationToken,
                proofIds: clientRequest.acknowledgement.missingProofIds,
                auditEventIds: clientRequest.acknowledgement.missingAuditEventIds,
              }).slice(0, 32)
            : persistedCommand.idempotencyKey,
    },
    clientStatePatch: {
      requestId: clientRequest.requestId,
      interactionId: clientRequest.interactionId,
      workflowIntent: clientRequest.workflowIntent,
      presentation: clientRequest.preferredPresentation,
      returnTo: clientRequest.returnTo,
      continuationToken,
      lastKnownCommand: lifecycle.command.command,
      lastKnownTransactionId: persistedCommand.transactionId,
      lastKnownRootHash: auditProof.digest.rootHash,
      acknowledgement: clientRequest.acknowledgement,
      auditBrowser: {
        digest: clientRequest.auditBrowser.digest,
        cursor: clientRequest.auditBrowser.cursor,
        route: clientRequest.auditBrowser.route,
        nextAuditAction: clientRequest.auditBrowser.nextAuditAction,
        cursorToken: clientRequest.routeHints.auditCursorToken,
      },
    },
    handoffEnvelope: {
      target: clientRequest.handoff.target,
      mode: clientRequest.handoff.mode,
      destinationProviderId: externalHandoff.destinationProviderId,
      ready: externalHandoff.state === "queued",
      payloadDigest: digestPayload(externalHandoff.payload).slice(0, 32),
      recordCount: exportSummary.recordCount,
      formats: exportSummary.formats,
      proofSchema: auditProof.proofSchema,
      proofIds: auditProof.proofIds,
    },
    operatorPrompt: {
      title:
        resumeIntent === "acknowledge-proof"
          ? clientRequest.acknowledgement.missingAuditEventIds.length
            ? "Audit acknowledgement required"
            : "Proof acknowledgement required"
          : resumeIntent === "recover-state"
            ? "State recovery required"
            : resumeIntent === "review-audit-event"
              ? "Audit event review required"
            : resumeIntent === "resume-handoff"
              ? "Export handoff ready"
              : "CLI log workflow ready",
      primaryAction: resumeRoute.rel,
      blockingReasons,
      missingProofIds: clientRequest.acknowledgement.missingProofIds,
    },
    audit: {
      digest: digestPayload(continuationSubject),
      subject: continuationSubject,
    },
  };
}

function lifecycleControlRoute(rel, method, path, enabled, reason, payload = {}) {
  return {
    rel,
    method,
    path,
    enabled,
    reason,
    payload,
  };
}

function buildHostedKernelLifecycleControls({
  lifecycle,
  settingsControl,
  persistedState,
  persistedCommand,
  restartRecovery,
  operationalHealth,
  clientRequest,
  syncMetadata,
  nextAction,
  generatedAt,
}) {
  const mutatingRequestedCommand = !["status", "tail", "export"].includes(lifecycle.command.command);
  const recoveryGate =
    restartRecovery.state === "operator-action-required"
      ? "operator recovery is required before lifecycle mutation"
      : restartRecovery.state === "recovering" && mutatingRequestedCommand
        ? "restart recovery must complete before lifecycle mutation"
        : null;
  const controlBlockedReasons = [
    ...(lifecycle.blocked ? [lifecycle.blockReason] : []),
    ...(settingsControl.state === "blocked" ? [settingsControl.blockReason] : []),
    ...(persistedCommand.blocked ? [persistedCommand.blockReason] : []),
    ...(recoveryGate ? [recoveryGate] : []),
    ...operationalHealth.actions.filter((action) => action.severity === "critical").map((action) => action.summary),
  ].filter(Boolean);
  const canMutate =
    controlBlockedReasons.length === 0 &&
    operationalHealth.runtimePlan.admissionControl.state !== "deny-mutations" &&
    lifecycle.permissionGranted;
  const effectiveSettings =
    settingsControl.state === "ready-to-apply"
      ? settingsControl.desired
      : {
          enabled: lifecycle.enabled,
          schedule: lifecycle.schedule,
        };
  const schedule = effectiveSettings.schedule || lifecycle.schedule;
  const scheduleDue = Boolean(schedule.enabled && schedule.nextRunAt && schedule.nextRunAt <= generatedAt);
  const commandRoutePayload = {
    requestId: clientRequest.requestId,
    command: lifecycle.command.command,
    idempotencyKey: persistedCommand.idempotencyKey,
    expectedCheckpoint: persistedCommand.expectedCheckpoint,
    continuation: {
      nextAction: nextAction.type,
      priority: nextAction.priority,
    },
  };
  const settingsPayload = {
    requestId: clientRequest.requestId,
    idempotencyKey: settingsControl.route.idempotencyKey,
    auditDigest: settingsControl.audit.digest,
    desired: settingsControl.desired,
  };
  const controls = {
    enableCapture: lifecycleControlRoute(
      "enable-capture",
      "PATCH",
      "/operator-userland/cli-logs/settings",
      canMutate && !effectiveSettings.enabled,
      effectiveSettings.enabled ? "capture is already enabled" : controlBlockedReasons[0] || "enable hosted-kernel cli-log capture",
      { ...settingsPayload, intent: "enable", patch: { enabled: true } }
    ),
    disableCapture: lifecycleControlRoute(
      "disable-capture",
      "PATCH",
      "/operator-userland/cli-logs/settings",
      canMutate && effectiveSettings.enabled,
      !effectiveSettings.enabled ? "capture is already disabled" : controlBlockedReasons[0] || "disable hosted-kernel cli-log capture",
      { ...settingsPayload, intent: "disable", patch: { enabled: false } }
    ),
    applySettings: lifecycleControlRoute(
      "apply-settings-control",
      "PATCH",
      "/operator-userland/cli-logs/settings",
      settingsControl.state === "ready-to-apply" && canMutate,
      settingsControl.state === "ready-to-apply"
        ? controlBlockedReasons[0] || `apply lifecycle settings: ${settingsControl.changedFields.join(", ")}`
        : "no lifecycle settings mutation is pending",
      settingsPayload
    ),
    runScheduledExport: lifecycleControlRoute(
      "run-scheduled-export",
      "POST",
      "/operator-userland/cli-logs/export",
      canMutate && scheduleDue && lifecycle.controls.canExport,
      scheduleDue ? controlBlockedReasons[0] || "scheduled export is due" : "scheduled export is not due",
      {
        requestId: clientRequest.requestId,
        idempotencyKey: digestPayload({
          surfaceId,
          requestId: clientRequest.requestId,
          scheduleNextRunAt: schedule.nextRunAt,
          watermark: syncMetadata.watermark,
        }).slice(0, 32),
        cadenceMinutes: schedule.cadenceMinutes,
        nextRunAt: schedule.nextRunAt,
      }
    ),
    invokeRequestedCommand: lifecycleControlRoute(
      "invoke-requested-lifecycle",
      "POST",
      "/operator-userland/cli-logs/lifecycle",
      canMutate && lifecycle.command.command !== "status" && persistedCommand.admission !== "read-only",
      lifecycle.command.command === "status" ? "status is read-only" : controlBlockedReasons[0] || `${lifecycle.command.command} is admitted`,
      commandRoutePayload
    ),
    recoverState: lifecycleControlRoute(
      "recover-state",
      "POST",
      "/operator-userland/cli-logs/recover",
      restartRecovery.state !== "clean",
      restartRecovery.actions[0] || "restart recovery is clean",
      {
        requestId: clientRequest.requestId,
        replay: restartRecovery.replay,
        commandReplay: restartRecovery.commandReplay,
      }
    ),
  };
  const actionQueue = [
    ...(controls.recoverState.enabled ? [{ rel: controls.recoverState.rel, priority: 10, route: controls.recoverState }] : []),
    ...(controls.applySettings.enabled ? [{ rel: controls.applySettings.rel, priority: 20, route: controls.applySettings }] : []),
    ...(controls.runScheduledExport.enabled ? [{ rel: controls.runScheduledExport.rel, priority: 30, route: controls.runScheduledExport }] : []),
    ...(controls.invokeRequestedCommand.enabled ? [{ rel: controls.invokeRequestedCommand.rel, priority: 40, route: controls.invokeRequestedCommand }] : []),
    { rel: "monitor", priority: 90, route: lifecycleControlRoute("monitor", "GET", "/operator-userland/cli-logs/status", true, "refresh lifecycle status", { requestId: clientRequest.requestId }) },
  ];
  const subject = {
    surfaceId,
    requestId: clientRequest.requestId,
    tenantId: persistedState.tenantId,
    workspaceId: persistedState.workspaceId,
    command: lifecycle.command.command,
    persistedAdmission: persistedCommand.admission,
    restartState: restartRecovery.state,
    settingsControlState: settingsControl.state,
    nextAction: nextAction.type,
    watermark: syncMetadata.watermark,
  };

  return {
    schema: "aios.cliLogs.hostedKernelLifecycleControls.v1",
    generatedAt,
    state: controlBlockedReasons.length ? "blocked" : actionQueue.some((action) => action.rel !== "monitor") ? "actionable" : "monitoring",
    canMutate,
    blockedReasons: controlBlockedReasons,
    requestedCommand: {
      command: lifecycle.command.command,
      requestedEffect: lifecycle.requestedEffect,
      admission: persistedCommand.admission,
      idempotent: persistedCommand.idempotent,
      destructive: persistedCommand.destructive,
      persistedStatusAfterRestart: persistedCommand.statusAfterRestart.projected,
    },
    enableDisable: {
      effectiveEnabled: Boolean(effectiveSettings.enabled),
      canEnable: controls.enableCapture.enabled,
      canDisable: controls.disableCapture.enabled,
      desiredEnabled: settingsControl.state === "ready-to-apply" ? settingsControl.desired.enabled : Boolean(effectiveSettings.enabled),
    },
    scheduling: {
      enabled: Boolean(schedule.enabled),
      cadenceMinutes: schedule.cadenceMinutes,
      nextRunAt: schedule.nextRunAt,
      due: scheduleDue,
      route: controls.runScheduledExport,
    },
    routes: controls,
    actionQueue: actionQueue.sort((left, right) => left.priority - right.priority),
    proof: {
      digest: digestPayload(subject),
      subject,
    },
  };
}

function acceptanceCriterion(id, label, status, detail, evidence = {}) {
  return {
    id,
    label,
    status,
    passed: status === "pass",
    detail,
    evidence,
  };
}

function acceptanceCriterionDomain(criterionId) {
  if (criterionId.includes("settings")) return "settings";
  if (criterionId.includes("tenant") || criterionId.includes("permission")) return "access";
  if (criterionId.includes("provider") || criterionId.includes("ingest") || criterionId.includes("sequence")) return "ingest";
  if (criterionId.includes("redaction") || criterionId.includes("audit-proof")) return "proof";
  if (criterionId.includes("restart") || criterionId.includes("persisted")) return "recovery";
  if (criterionId.includes("export") || criterionId.includes("handoff")) return "handoff";
  return "lifecycle";
}

function buildPreviewValidationSummary(criteria) {
  const blocked = criteria.filter((criterion) => criterion.status === "block");
  const warnings = criteria.filter((criterion) => criterion.status === "warn");
  const byDomain = criteria.reduce((accumulator, criterion) => {
    const domain = acceptanceCriterionDomain(criterion.id);
    accumulator[domain] ||= { total: 0, passed: 0, blocked: 0, warnings: 0, criteria: [] };
    accumulator[domain].total += 1;
    if (criterion.status === "pass") accumulator[domain].passed += 1;
    if (criterion.status === "block") accumulator[domain].blocked += 1;
    if (criterion.status === "warn") accumulator[domain].warnings += 1;
    accumulator[domain].criteria.push(criterion.id);
    return accumulator;
  }, {});
  const orderedDomains = Object.fromEntries(Object.entries(byDomain).sort(([left], [right]) => left.localeCompare(right)));

  return {
    valid: blocked.length === 0,
    errorCount: blocked.length,
    warningCount: warnings.length,
    errors: blocked.map((criterion) => ({
      id: criterion.id,
      domain: acceptanceCriterionDomain(criterion.id),
      message: criterion.detail,
    })),
    warnings: warnings.map((criterion) => ({
      id: criterion.id,
      domain: acceptanceCriterionDomain(criterion.id),
      message: criterion.detail,
    })),
    byDomain: orderedDomains,
    firstBlockingCriterion: blocked[0]
      ? {
          id: blocked[0].id,
          domain: acceptanceCriterionDomain(blocked[0].id),
          message: blocked[0].detail,
        }
      : null,
    firstWarningCriterion: warnings[0]
      ? {
          id: warnings[0].id,
          domain: acceptanceCriterionDomain(warnings[0].id),
          message: warnings[0].detail,
        }
      : null,
  };
}

function acceptanceRouteContract(rel, method, path, enabled, payload, prerequisiteIds, validationSummary, extra = {}) {
  const failedPrerequisites = prerequisiteIds.filter((id) => validationSummary.errors.some((error) => error.id === id));
  const warningPrerequisites = prerequisiteIds.filter((id) => validationSummary.warnings.some((warning) => warning.id === id));
  const computedDisabledReason =
    enabled && failedPrerequisites.length === 0
      ? null
      : failedPrerequisites.length
        ? `blocked by validation criteria: ${failedPrerequisites.join(", ")}`
        : extra.disabledReason || null;
  const { disabledReason: _ignoredDisabledReason, ...safeExtra } = extra;

  return {
    rel,
    method,
    path,
    enabled: enabled && failedPrerequisites.length === 0,
    disabledReason: computedDisabledReason,
    prerequisites: {
      requiredCriteria: prerequisiteIds,
      failedCriteria: failedPrerequisites,
      warningCriteria: warningPrerequisites,
    },
    payload,
    ...safeExtra,
  };
}

function buildPreviewAcceptanceContract({
  events,
  analytics,
  lifecycleSettings,
  lifecycle,
  exportSummary,
  auditProof,
  providerContract,
  providerSyncPlan,
  ingestContract,
  redactionContract,
  sequenceWindow,
  tenantBoundary,
  restartRecovery,
  persistedCommand,
  externalHandoff,
  settingsControl,
  clientRequest,
  workflowContinuation,
  nextAction,
  generatedAt,
}) {
  const command = lifecycle.command.command;
  const isExportRequest = command === "export" || lifecycle.requestedEffect === "prepare-export";
  const isDestructiveRequest = ["purge", "rotate", "restart", "stop"].includes(command);
  const previewEvents = [...events]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.sequence - a.sequence)
    .slice(0, 5)
    .map((event) => ({
      id: event.id,
      sequence: event.sequence,
      timestamp: event.timestamp,
      level: event.level,
      stream: event.stream,
      command: event.command,
      status: event.exitCode === null ? "observed" : event.exitCode === 0 ? "completed" : "failed",
      redacted: event.redacted,
      proofId: event.proofId,
      messagePreview: event.message.length > 180 ? `${event.message.slice(0, 177)}...` : event.message,
    }));
  const criteria = [
    acceptanceCriterion(
      "settings-valid",
      "Settings accepted",
      lifecycleSettings.valid ? "pass" : "block",
      lifecycleSettings.valid ? "effective lifecycle settings are within supported bounds" : "settings must be corrected before this command can run",
      { errors: lifecycleSettings.validation }
    ),
    acceptanceCriterion(
      "tenant-boundary-clean",
      "Tenant boundary clean",
      tenantBoundary.eventScope.deniedEvents === 0 ? "pass" : "block",
      tenantBoundary.eventScope.deniedEvents === 0 ? "all previewed records are inside the active boundary" : "one or more records were rejected by tenant/workspace boundary checks",
      tenantBoundary.eventScope
    ),
    acceptanceCriterion(
      "permission-granted",
      "Permission granted",
      lifecycle.permissionGranted ? "pass" : "block",
      lifecycle.permissionGranted ? `operator can run ${command}` : `operator is missing ${lifecycle.requiredPermission}`,
      { requiredPermission: lifecycle.requiredPermission }
    ),
    acceptanceCriterion(
      "lifecycle-actionable",
      "Lifecycle actionable",
      lifecycle.blocked ? "block" : "pass",
      lifecycle.blocked ? lifecycle.blockReason : `${lifecycle.requestedEffect} can be evaluated by hosted-kernel controls`,
      { requestedEffect: lifecycle.requestedEffect, health: lifecycle.health }
    ),
    acceptanceCriterion(
      "settings-control-safe",
      "Settings control safe",
      !settingsControl || settingsControl.state !== "blocked" ? "pass" : "block",
      !settingsControl || settingsControl.state !== "blocked"
        ? settingsControl?.state === "ready-to-apply"
          ? `settings control can apply ${settingsControl.changedFields.join(", ")}`
          : "no settings control mutation is pending"
        : settingsControl.blockReason,
      settingsControl
        ? {
            intent: settingsControl.intent,
            state: settingsControl.state,
            changedFields: settingsControl.changedFields,
            auditDigest: settingsControl.audit.digest,
          }
        : {}
    ),
    acceptanceCriterion(
      "provider-capabilities",
      "Provider capabilities ready",
      providerContract.missingCapabilities.length ? "block" : providerContract.mode === "degraded" ? "warn" : "pass",
      providerContract.missingCapabilities.length
        ? `missing provider capabilities: ${providerContract.missingCapabilities.join(", ")}`
        : providerContract.mode === "degraded"
          ? "all required capabilities are routed, but at least one provider is degraded"
          : "all required capabilities are routed",
      { requiredCapabilities: providerContract.requiredCapabilities, missingCapabilities: providerContract.missingCapabilities }
    ),
    acceptanceCriterion(
      "provider-sync-plan-ready",
      "Provider sync plan ready",
      providerSyncPlan.state === "blocked" ? "block" : providerSyncPlan.state === "catching-up" ? "warn" : "pass",
      providerSyncPlan.state === "blocked"
        ? "selected provider service routes are blocked by cursor, lease, endpoint, or contract state"
        : providerSyncPlan.state === "catching-up"
          ? "selected providers are routable but need cursor synchronization before fresh export or handoff"
          : "selected provider service routes are synchronized and routable",
      {
        state: providerSyncPlan.state,
        selectedProviderCount: providerSyncPlan.selectedProviderCount,
        blockedSelectedProviderCount: providerSyncPlan.blockedSelectedProviderCount,
        laggingSelectedProviderCount: providerSyncPlan.laggingSelectedProviderCount,
        auditDigest: providerSyncPlan.audit.digest,
      }
    ),
    acceptanceCriterion(
      "ingest-accepted",
      "Hosted-kernel ingest accepted",
      ingestContract.accepted ? "pass" : ingestContract.intake.acceptedEvents > 0 ? "warn" : "block",
      ingestContract.accepted ? "capture intake accepted every supplied record" : ingestContract.warnings.join("; ") || "capture intake needs attention",
      { intake: ingestContract.intake, warnings: ingestContract.warnings }
    ),
    acceptanceCriterion(
      "sequence-window-safe",
      "Sequence window safe",
      sequenceWindow.watermarkSafe ? (sequenceWindow.normalizedCount > 0 ? "warn" : "pass") : "block",
      sequenceWindow.watermarkSafe
        ? sequenceWindow.normalizedCount > 0
          ? "event sequences were normalized before cursor, proof, and export contracts were built"
          : "event sequences are monotonic for cursor and proof contracts"
        : "event sequence ordering cannot advance a safe cursor",
      {
        state: sequenceWindow.state,
        normalizedCount: sequenceWindow.normalizedCount,
        duplicateRequestedSequenceCount: sequenceWindow.duplicateRequestedSequenceCount,
        regressedSequenceCount: sequenceWindow.regressedSequenceCount,
        invalidInputSequenceCount: sequenceWindow.invalidInputSequenceCount,
        auditDigest: sequenceWindow.audit.digest,
      }
    ),
    acceptanceCriterion(
      "redaction-export-safe",
      "Redaction export safe",
      redactionContract.exportSafe ? "pass" : "block",
      redactionContract.exportSafe ? "secret-bearing rows are sanitized or excluded" : "secret-bearing rows remain unsafe for export",
      { appliedRedactions: redactionContract.appliedRedactions, blockedSecretEvents: redactionContract.blockedSecretEvents }
    ),
    acceptanceCriterion(
      "audit-proof-ready",
      "Audit proof ready",
      auditProof.status === "ready" ? "pass" : isExportRequest ? "block" : "warn",
      auditProof.status === "ready" ? "audit proof assertions are ready" : "audit proof requires operator attention",
      { status: auditProof.status, proofIds: auditProof.proofIds, rootHash: auditProof.digest.rootHash }
    ),
    acceptanceCriterion(
      "restart-recovery-safe",
      "Restart recovery safe",
      restartRecovery.restartSafe ? "pass" : "block",
      restartRecovery.restartSafe ? "persisted cursor and recovery state are safe" : "restart recovery requires state reconciliation first",
      { state: restartRecovery.state, actions: restartRecovery.actions }
    ),
    acceptanceCriterion(
      "persisted-command-safe",
      "Persisted command safe",
      persistedCommand.blocked ? "block" : persistedCommand.admission === "duplicate-replay" ? "warn" : "pass",
      persistedCommand.blocked
        ? persistedCommand.blockReason
        : persistedCommand.admission === "duplicate-replay"
          ? "matching idempotent command is already outstanding and can be replayed without another write"
          : "command has a deterministic persisted transaction and restart-safe status projection",
      {
        transactionId: persistedCommand.transactionId,
        admission: persistedCommand.admission,
        idempotencyKey: persistedCommand.idempotencyKey,
        writeRequired: persistedCommand.writePlan.required,
        statusAfterRestart: persistedCommand.statusAfterRestart,
      }
    ),
    acceptanceCriterion(
      "export-ready",
      "Export ready",
      !isExportRequest ? "pass" : exportSummary.ready ? "pass" : "block",
      !isExportRequest ? "export readiness is not required for this command" : exportSummary.ready ? "export batches can be prepared" : "export request has no safe handoff-ready batch",
      { ready: exportSummary.ready, recordCount: exportSummary.recordCount, formats: exportSummary.formats }
    ),
    acceptanceCriterion(
      "client-handoff-acknowledged",
      "Client handoff acknowledged",
      clientRequest.acknowledgement.satisfied ? "pass" : isExportRequest || isDestructiveRequest ? "block" : "warn",
      clientRequest.acknowledgement.satisfied
        ? "client request state is safe for workflow handoff"
        : clientRequest.acknowledgement.missingAuditEventIds.length
          ? "client must review pending audit events before this workflow can hand off"
          : "client must acknowledge proof ids before this workflow can hand off",
      {
        requestId: clientRequest.requestId,
        acknowledgementRequired: clientRequest.acknowledgement.required,
        missingProofIds: clientRequest.acknowledgement.missingProofIds,
        missingAuditEventIds: clientRequest.acknowledgement.missingAuditEventIds,
        auditBrowserDigest: clientRequest.auditBrowser.digest,
      }
    ),
  ];
  const blocked = criteria.filter((criterion) => criterion.status === "block");
  const warnings = criteria.filter((criterion) => criterion.status === "warn");
  const accepted = blocked.length === 0 && lifecycle.command.accepted;
  const readinessState = blocked.length ? "blocked" : warnings.length ? "needs-review" : "ready";
  const validationSummary = buildPreviewValidationSummary(criteria);
  const previewId = digestPayload({
    surfaceId,
    command,
    generatedAt,
    rootHash: auditProof.digest.rootHash,
    eventCount: events.length,
    requestedEffect: lifecycle.requestedEffect,
  }).slice(0, 24);
  const readinessReceipt = {
    schema: "aios.cliLogs.previewReadinessReceipt.v1",
    previewId,
    accepted,
    readinessState,
    validationDigest: digestPayload({
      surfaceId,
      previewId,
      accepted,
      readinessState,
      errors: validationSummary.errors,
      warnings: validationSummary.warnings,
      criteria: criteria.map((criterion) => ({ id: criterion.id, status: criterion.status })),
    }),
    rootHash: auditProof.digest.rootHash,
    watermark: persistedCommand.expectedCheckpoint,
  };
  const routeContracts = [
    acceptanceRouteContract(
      "workflow-continuation",
      workflowContinuation.resumeRoute.method,
      workflowContinuation.resumeRoute.path,
      workflowContinuation.resumeRoute.enabled,
      {
        continuationToken: workflowContinuation.continuationToken,
        resumeIntent: workflowContinuation.resumeIntent,
        requestId: clientRequest.requestId,
        idempotencyKey: workflowContinuation.resumeRoute.idempotencyKey,
        clientStatePatch: workflowContinuation.clientStatePatch,
        readinessReceipt,
      },
      workflowContinuation.resumeIntent === "acknowledge-proof"
        ? ["client-handoff-acknowledged"]
        : workflowContinuation.resumeIntent === "recover-state"
          ? ["restart-recovery-safe", "persisted-command-safe"]
          : ["lifecycle-actionable"],
      validationSummary
    ),
    acceptanceRouteContract(
      "invoke-lifecycle",
      "POST",
      "/operator-userland/cli-logs/lifecycle",
      accepted,
      {
        command,
        previewId,
        requestId: clientRequest.requestId,
        idempotencyScope: clientRequest.routeHints.idempotencyScope,
        readinessReceipt,
        persistence: {
          transactionId: persistedCommand.transactionId,
          idempotencyKey: persistedCommand.idempotencyKey,
          admission: persistedCommand.admission,
          expectedCheckpoint: persistedCommand.expectedCheckpoint,
        },
      },
      [
        "settings-valid",
        "tenant-boundary-clean",
        "permission-granted",
        "lifecycle-actionable",
        "restart-recovery-safe",
        "persisted-command-safe",
      ],
      validationSummary
    ),
    acceptanceRouteContract(
      "tail-preview",
      "GET",
      "/operator-userland/cli-logs/tail",
      lifecycle.controls.canTail,
      { afterSequence: lifecycle.cursor.lastSequence, limit: 100, requestId: clientRequest.requestId, previewId },
      ["tenant-boundary-clean", "permission-granted", "provider-sync-plan-ready"],
      validationSummary,
      { disabledReason: lifecycle.controls.canTail ? null : "tail control is not currently available" }
    ),
    acceptanceRouteContract(
      "export-handoff",
      "POST",
      "/operator-userland/cli-logs/export",
      exportSummary.ready && externalHandoff.state !== "blocked" && clientRequest.acknowledgement.satisfied,
      {
        formats: clientRequest.selection.formats,
        idempotencyKey: externalHandoff.idempotencyKey,
        requestId: clientRequest.requestId,
        returnTo: clientRequest.returnTo,
        readinessReceipt,
      },
      [
        "tenant-boundary-clean",
        "provider-capabilities",
        "provider-sync-plan-ready",
        "redaction-export-safe",
        "audit-proof-ready",
        "export-ready",
        "client-handoff-acknowledged",
      ],
      validationSummary,
      { disabledReason: externalHandoff.state === "blocked" ? externalHandoff.reason : "export handoff is not ready" }
    ),
    acceptanceRouteContract(
      "apply-settings-control",
      "PATCH",
      "/operator-userland/cli-logs/settings",
      Boolean(settingsControl && settingsControl.route.enabled),
      settingsControl
        ? {
            intent: settingsControl.intent,
            changedFields: settingsControl.changedFields,
            idempotencyKey: settingsControl.route.idempotencyKey,
            auditDigest: settingsControl.audit.digest,
            desired: settingsControl.desired,
            readinessReceipt,
          }
        : null,
      ["settings-valid", "settings-control-safe", "permission-granted"],
      validationSummary,
      { disabledReason: settingsControl?.blockReason || "no settings control route is enabled" }
    ),
  ];

  return {
    schema: "aios.cliLogs.previewAcceptance.v1",
    generatedAt,
    previewId,
    command: {
      requested: lifecycle.command.requested,
      normalized: command,
      accepted: lifecycle.command.accepted,
      requestedEffect: lifecycle.requestedEffect,
      destructive: isDestructiveRequest,
    },
    clientWorkflow: {
      requestId: clientRequest.requestId,
      clientId: clientRequest.clientId,
      interactionId: clientRequest.interactionId,
      intent: clientRequest.workflowIntent,
      presentation: clientRequest.preferredPresentation,
      returnTo: clientRequest.returnTo,
      replaySafe: clientRequest.routeHints.replaySafe,
      acknowledgement: clientRequest.acknowledgement,
      auditBrowser: {
        requested: clientRequest.auditBrowser.requested,
        lifecycleQueueState: clientRequest.auditBrowser.lifecycleQueueState,
        nextAuditAction: clientRequest.auditBrowser.nextAuditAction,
        cursorToken: clientRequest.routeHints.auditCursorToken,
      },
    },
    visiblePreview: {
      eventCount: events.length,
      shownEvents: previewEvents.length,
      events: previewEvents,
      counters: {
        failures: analytics.failedCommands,
        redactions: analytics.redactedEvents,
        proofCoverage: analytics.proofCoverage,
        exportableRecords: exportSummary.recordCount,
      },
    },
    acceptance: {
      accepted,
      state: accepted ? "accepted" : "rejected",
      criteria,
      blockedCriteria: blocked.map((criterion) => criterion.id),
      warningCriteria: warnings.map((criterion) => criterion.id),
    },
    readiness: {
      state: readinessState,
      ready: readinessState === "ready",
      score: Number(((criteria.length - blocked.length - warnings.length * 0.5) / criteria.length).toFixed(3)),
      blockers: blocked.map((criterion) => criterion.detail),
      warnings: warnings.map((criterion) => criterion.detail),
      receipt: readinessReceipt,
      domains: validationSummary.byDomain,
    },
    validationSummary,
    explainableNextStep: {
      ...nextAction,
      accepted,
      readinessReceipt,
      primaryBlocker: validationSummary.firstBlockingCriterion,
      primaryWarning: validationSummary.firstWarningCriterion,
      reasonChain: [...blocked, ...warnings].map((criterion) => `${criterion.label}: ${criterion.detail}`),
      routeContracts,
    },
  };
}

function buildOperatorConsoleDeliveryContract({
  previewAcceptance,
  workflowContinuation,
  hostedKernelLifecycleControls,
  operationalHealth,
  reportingState,
  exportSummary,
  clientRequest,
  generatedAt,
}) {
  const actionableRoutes = [
    ...previewAcceptance.explainableNextStep.routeContracts,
    ...hostedKernelLifecycleControls.actionQueue.map((action) => ({
      rel: action.rel,
      method: action.route.method,
      path: action.route.path,
      enabled: action.route.enabled,
      payload: action.route.payload,
    })),
  ];
  const uniqueRoutes = [...actionableRoutes.values()].reduce((accumulator, route) => {
    const key = `${route.rel}:${route.method}:${route.path}`;
    if (!accumulator.has(key)) accumulator.set(key, route);
    return accumulator;
  }, new Map());
  const primaryRoute =
    [...uniqueRoutes.values()].find((route) => route.enabled && route.rel === workflowContinuation.resumeRoute.rel) ||
    hostedKernelLifecycleControls.actionQueue.find((action) => action.route.enabled)?.route ||
    [...uniqueRoutes.values()].find((route) => route.enabled) ||
    workflowContinuation.resumeRoute;
  const errorCount = previewAcceptance.validationSummary.errorCount;
  const warningCount = previewAcceptance.validationSummary.warningCount;
  const bannerTone =
    errorCount > 0
      ? "critical"
      : warningCount > 0 || operationalHealth.state === "degraded"
        ? "warning"
        : previewAcceptance.acceptance.accepted
          ? "success"
          : "neutral";
  const visibleErrors = previewAcceptance.validationSummary.errors.slice(0, 4);
  const visibleWarnings = previewAcceptance.validationSummary.warnings.slice(0, 4);
  const deliverySubject = {
    surfaceId,
    requestId: clientRequest.requestId,
    previewId: previewAcceptance.previewId,
    acceptanceState: previewAcceptance.acceptance.state,
    readinessState: previewAcceptance.readiness.state,
    primaryRel: primaryRoute.rel,
    operationalState: operationalHealth.state,
    reportId: reportingState.reportId,
  };

  return {
    schema: "aios.cliLogs.operatorConsoleDelivery.v1",
    generatedAt,
    deliveryId: digestPayload(deliverySubject).slice(0, 24),
    request: {
      requestId: clientRequest.requestId,
      interactionId: clientRequest.interactionId,
      presentation: clientRequest.preferredPresentation,
      responseMode: clientRequest.routeHints.responseMode,
      returnTo: clientRequest.returnTo,
    },
    banner: {
      tone: bannerTone,
      title:
        errorCount > 0
          ? "CLI log action blocked"
          : warningCount > 0
            ? "CLI log action needs review"
            : previewAcceptance.acceptance.accepted
              ? "CLI log action accepted"
              : "CLI log status available",
      summary:
        errorCount > 0
          ? visibleErrors[0]?.message || workflowContinuation.operatorPrompt.blockingReasons[0] || "Resolve validation blockers before continuing."
          : warningCount > 0
            ? visibleWarnings[0]?.message || "Review warnings before continuing."
            : previewAcceptance.explainableNextStep.reason,
      counts: {
        errors: errorCount,
        warnings: warningCount,
        criteria: previewAcceptance.acceptance.criteria.length,
      },
    },
    previewPanel: {
      previewId: previewAcceptance.previewId,
      state: previewAcceptance.readiness.state,
      score: previewAcceptance.readiness.score,
      command: previewAcceptance.command,
      counters: previewAcceptance.visiblePreview.counters,
      events: previewAcceptance.visiblePreview.events,
      export: {
        ready: exportSummary.ready,
        recordCount: exportSummary.recordCount,
        formats: exportSummary.formats,
        unsupportedFormats: exportSummary.unsupportedFormats,
      },
    },
    validationPanel: {
      valid: previewAcceptance.validationSummary.valid,
      errors: visibleErrors,
      warnings: visibleWarnings,
      hiddenErrorCount: Math.max(0, errorCount - visibleErrors.length),
      hiddenWarningCount: Math.max(0, warningCount - visibleWarnings.length),
      blockedCriteria: previewAcceptance.acceptance.blockedCriteria,
      warningCriteria: previewAcceptance.acceptance.warningCriteria,
    },
    primaryAction: {
      rel: primaryRoute.rel,
      method: primaryRoute.method,
      path: primaryRoute.path,
      enabled: primaryRoute.enabled === true,
      idempotencyKey: primaryRoute.payload?.idempotencyKey || workflowContinuation.resumeRoute.idempotencyKey || null,
      payload: primaryRoute.payload || {
        continuationToken: workflowContinuation.continuationToken,
        requestId: clientRequest.requestId,
      },
    },
    routeBindings: [...uniqueRoutes.values()].map((route) => ({
      rel: route.rel,
      method: route.method,
      path: route.path,
      enabled: route.enabled === true,
      disabledReason: route.disabledReason || null,
      prerequisites: route.prerequisites || null,
      requiresAcknowledgement:
        route.rel === "export-handoff" || route.rel === "workflow-continuation"
          ? clientRequest.acknowledgement.required && !clientRequest.acknowledgement.satisfied
          : false,
      idempotencyKey: route.payload?.idempotencyKey || null,
    })),
    continuation: {
      token: workflowContinuation.continuationToken,
      state: workflowContinuation.state,
      resumeIntent: workflowContinuation.resumeIntent,
      clientStatePatch: workflowContinuation.clientStatePatch,
      handoffReady: workflowContinuation.handoffEnvelope.ready,
    },
    reporting: {
      reportId: reportingState.reportId,
      state: reportingState.state,
      health: operationalHealth.state,
      degradedMode: operationalHealth.degradedMode,
      recentFailures: reportingState.timelineWindow.recentFailures,
      auditBrowser: reportingState.auditBrowser,
    },
    audit: {
      digest: digestPayload(deliverySubject),
      subject: deliverySubject,
    },
  };
}

function buildRouteReadinessHandoffContract({
  previewAcceptance,
  operatorConsoleDelivery,
  workflowContinuation,
  hostedKernelLifecycleControls,
  persistedCommand,
  externalHandoff,
  clientRequest,
  operationalHealth,
  generatedAt,
}) {
  const routeBindings = operatorConsoleDelivery.routeBindings.map((binding) => {
    const previewRoute = previewAcceptance.explainableNextStep.routeContracts.find(
      (route) => route.rel === binding.rel && route.method === binding.method && route.path === binding.path
    );
    const lifecycleRoute = Object.values(hostedKernelLifecycleControls.routes).find(
      (route) => route.rel === binding.rel && route.method === binding.method && route.path === binding.path
    );
    const route = previewRoute || lifecycleRoute || binding;
    const blockedByValidation =
      !binding.enabled && previewRoute?.prerequisites?.failedCriteria?.length
        ? previewRoute.prerequisites.failedCriteria
        : !binding.enabled && previewAcceptance.validationSummary.errors.length
          ? previewAcceptance.validationSummary.errors.map((error) => error.id)
        : [];
    const blockedByAck =
      binding.requiresAcknowledgement &&
      (clientRequest.acknowledgement.missingProofIds.length || clientRequest.acknowledgement.missingAuditEventIds.length)
        ? ["client-handoff-acknowledged"]
        : [];

    return {
      rel: binding.rel,
      method: binding.method,
      path: binding.path,
      enabled: binding.enabled,
      idempotencyKey: binding.idempotencyKey || route.payload?.idempotencyKey || null,
      payloadDigest: route.payload ? digestPayload(route.payload).slice(0, 32) : null,
      blockedBy: [...new Set([...blockedByValidation, ...blockedByAck])].sort(),
      disabledReason: binding.disabledReason || route.disabledReason || null,
      prerequisites: binding.prerequisites || route.prerequisites || null,
      submitMode:
        binding.enabled
          ? persistedCommand.idempotent || clientRequest.routeHints.replaySafe
            ? "idempotent-submit"
            : "single-submit"
          : "disabled",
    };
  });
  const primaryRoute = routeBindings.find((route) => route.rel === operatorConsoleDelivery.primaryAction.rel) || routeBindings.find((route) => route.enabled) || null;
  const canSubmit = Boolean(
    primaryRoute?.enabled &&
      previewAcceptance.acceptance.accepted &&
      operationalHealth.runtimePlan.admissionControl.currentCommandAllowed &&
      (!clientRequest.acknowledgement.required || clientRequest.acknowledgement.satisfied)
  );
  const validationDigest = digestPayload({
    surfaceId,
    previewId: previewAcceptance.previewId,
    errors: previewAcceptance.validationSummary.errors,
    warnings: previewAcceptance.validationSummary.warnings,
    accepted: previewAcceptance.acceptance.accepted,
  });
  const submitSubject = {
    surfaceId,
    requestId: clientRequest.requestId,
    previewId: previewAcceptance.previewId,
    primaryRel: primaryRoute?.rel || null,
    transactionId: persistedCommand.transactionId,
    continuationToken: workflowContinuation.continuationToken,
    validationDigest,
  };

  return {
    schema: "aios.cliLogs.routeReadinessHandoff.v1",
    generatedAt,
    handoffId: digestPayload(submitSubject).slice(0, 24),
    state: canSubmit ? "submittable" : previewAcceptance.validationSummary.errorCount ? "blocked" : "review-required",
    canSubmit,
    request: {
      requestId: clientRequest.requestId,
      interactionId: clientRequest.interactionId,
      responseMode: clientRequest.routeHints.responseMode,
      idempotencyScope: clientRequest.routeHints.idempotencyScope,
    },
    validationReceipt: {
      digest: validationDigest,
      accepted: previewAcceptance.acceptance.accepted,
      readinessState: previewAcceptance.readiness.state,
      errorCount: previewAcceptance.validationSummary.errorCount,
      warningCount: previewAcceptance.validationSummary.warningCount,
      blockers: previewAcceptance.acceptance.blockedCriteria,
      warnings: previewAcceptance.acceptance.warningCriteria,
    },
    acknowledgementGate: {
      required: clientRequest.acknowledgement.required,
      satisfied: clientRequest.acknowledgement.satisfied,
      missingProofIds: clientRequest.acknowledgement.missingProofIds,
      missingAuditEventIds: clientRequest.acknowledgement.missingAuditEventIds,
      route: workflowContinuation.resumeIntent === "acknowledge-proof" ? workflowContinuation.resumeRoute : null,
    },
    primaryRoute,
    routeBindings,
    persistence: {
      transactionId: persistedCommand.transactionId,
      admission: persistedCommand.admission,
      idempotent: persistedCommand.idempotent,
      idempotencyKey: persistedCommand.idempotencyKey,
      writeRequired: persistedCommand.writePlan.required,
      expectedCheckpoint: persistedCommand.expectedCheckpoint,
    },
    handoff: {
      state: externalHandoff.state,
      destinationProviderId: externalHandoff.destinationProviderId,
      idempotencyKey: externalHandoff.idempotencyKey,
      retryable: externalHandoff.deliveryContract.retryable,
      receiptRequired: externalHandoff.deliveryContract.receiptRequired,
    },
    clientPatch: {
      ...workflowContinuation.clientStatePatch,
      routeReadinessHandoffId: digestPayload(submitSubject).slice(0, 24),
      validationDigest,
      primaryRel: primaryRoute?.rel || null,
      submitEnabled: canSubmit,
    },
    audit: {
      digest: digestPayload(submitSubject),
      subject: submitSubject,
    },
  };
}

export function describeCliLogsSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const rawTenantBoundary = normalizeTenantBoundary(input, now);
  const lifecycleSettings = normalizeLifecycleSettings(input, now);
  const rawEvents = collectCliEvents(input, now, rawTenantBoundary);
  const redactionResult = applyRedactionPolicy(rawEvents, lifecycleSettings.settings, now);
  const sequencingResult = buildSequenceWindow(redactionResult.events, now);
  const events = sequencingResult.events;
  const sequenceWindow = sequencingResult.contract;
  const redactionContract = redactionResult.contract;
  const tenantBoundary = summarizeBoundaryAccess(events, rawTenantBoundary);
  const permittedEvents = events.filter((event) => event.scope.allowed);
  const analytics = buildAnalytics(permittedEvents);
  const history = buildHistorySnapshots(permittedEvents, analytics, now);
  const timeline = buildTimeline(permittedEvents);
  const auditLogBrowser = buildAuditLogBrowser(input, permittedEvents, now, tenantBoundary);
  const providers = normalizeProviderContracts(input, now);
  const ingestContract = buildHostedKernelIngestContract(input, events, permittedEvents, providers, now, tenantBoundary);
  const integrityChain = buildIntegrityChain(permittedEvents, ingestContract, now);
  const exportSummary = buildExportSummary(permittedEvents, analytics, now, input.exportFormats, tenantBoundary, integrityChain, redactionContract);
  const auditAnalytics = buildAuditAnalyticsState(permittedEvents, auditLogBrowser, exportSummary, now);
  const auditProof = buildAuditProof(permittedEvents, analytics, now, tenantBoundary, integrityChain, ingestContract, redactionContract);
  const lifecycleCommand = normalizeLifecycleCommand(input);
  const workspaceAccessManifest = buildWorkspaceAccessManifest(events, tenantBoundary, lifecycleCommand, now);
  const settingsControl = normalizeLifecycleSettingsControl(input, lifecycleSettings, lifecycleCommand, tenantBoundary, now);
  const persistedState = normalizePersistedState(input, now, lifecycleSettings.settings, tenantBoundary);
  const lifecycle = buildLifecycleState(lifecycleCommand, lifecycleSettings, permittedEvents, analytics, now, tenantBoundary, workspaceAccessManifest);
  const clientRequest = normalizeClientRequestState(input, lifecycle, exportSummary, auditProof, auditLogBrowser, now);
  const providerContract = negotiateProviderContract(providers, lifecycle, lifecycleSettings, exportSummary, now);
  const syncMetadata = buildSyncMetadata(permittedEvents, providers, lifecycle, now);
  const restartRecovery = buildRestartRecoveryState(persistedState, lifecycle, syncMetadata, integrityChain, now);
  const persistedCommand = buildPersistedCommandTransaction({
    lifecycle,
    lifecycleSettings,
    persistedState,
    restartRecovery,
    syncMetadata,
    auditProof,
    clientRequest,
    generatedAt: now,
  });
  const handoffCheckpoint = normalizeExternalHandoffCheckpoint(input, now);
  const externalHandoff = buildExternalHandoffState(lifecycle, exportSummary, providerContract, auditProof, syncMetadata, now, tenantBoundary, clientRequest, handoffCheckpoint);
  const providerSyncPlan = buildProviderSyncPlan(providers, providerContract, syncMetadata, lifecycle, externalHandoff, now);
  const retryAttemptHistory = normalizeRetryAttemptHistory(input, now);
  const operationalHealth = buildOperationalHealth({
    analytics,
    lifecycle,
    providerContract,
    syncMetadata,
    auditProof,
    restartRecovery,
    persistedCommand,
    externalHandoff,
    settingsControl,
    ingestContract,
    sequenceWindow,
    redactionContract,
    tenantBoundary,
    retryAttemptHistory,
    generatedAt: now,
  });
  const workflowContinuation = buildWorkflowContinuationContract({
    lifecycle,
    clientRequest,
    persistedCommand,
    externalHandoff,
    auditProof,
    exportSummary,
    restartRecovery,
    operationalHealth,
    generatedAt: now,
  });
  const nextAction = buildNextAction(lifecycle, analytics, auditProof, settingsControl, restartRecovery, operationalHealth, auditLogBrowser);
  const hostedKernelLifecycleControls = buildHostedKernelLifecycleControls({
    lifecycle,
    settingsControl,
    persistedState,
    persistedCommand,
    restartRecovery,
    operationalHealth,
    clientRequest,
    syncMetadata,
    nextAction,
    generatedAt: now,
  });
  const exportHistory = buildExportHistoryState(input, exportSummary, auditProof, externalHandoff, clientRequest, now);
  const reportingState = buildReportingState(analytics, history, timeline, exportSummary, auditProof, lifecycle, externalHandoff, redactionContract, exportHistory, auditLogBrowser, auditAnalytics, now);
  const previewAcceptance = buildPreviewAcceptanceContract({
    events: permittedEvents,
    analytics,
    lifecycleSettings,
    lifecycle,
    exportSummary,
    auditProof,
    providerContract,
    providerSyncPlan,
    ingestContract,
    redactionContract,
    sequenceWindow,
    tenantBoundary,
    restartRecovery,
    persistedCommand,
    externalHandoff,
    settingsControl,
    clientRequest,
    workflowContinuation,
    nextAction,
    generatedAt: now,
  });
  const operatorConsoleDelivery = buildOperatorConsoleDeliveryContract({
    previewAcceptance,
    workflowContinuation,
    hostedKernelLifecycleControls,
    operationalHealth,
    reportingState,
    exportSummary,
    clientRequest,
    generatedAt: now,
  });
  const routeReadinessHandoff = buildRouteReadinessHandoffContract({
    previewAcceptance,
    operatorConsoleDelivery,
    workflowContinuation,
    hostedKernelLifecycleControls,
    persistedCommand,
    externalHandoff,
    clientRequest,
    operationalHealth,
    generatedAt: now,
  });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel cli log analytics, history, export, and audit proof contract',
    schemaVersion: 1,
    analytics,
    tenantBoundary,
    workspaceAccessManifest,
    history,
    timeline,
    auditLogBrowser,
    auditAnalytics,
    lifecycle,
    settingsControl,
    settingsValidation: {
      valid: lifecycleSettings.valid,
      errors: lifecycleSettings.validation,
      effectiveSettings: lifecycleSettings.settings,
    },
    ingestContract,
    sequenceWindow,
    redactionContract,
    integrityChain,
    providers,
    providerContract,
    syncMetadata,
    providerSyncPlan,
    clientRequest,
    persistedState,
    restartRecovery,
    persistedCommand,
    handoffCheckpoint,
    externalHandoff,
    retryAttemptHistory,
    workflowContinuation,
    hostedKernelLifecycleControls,
    operationalHealth,
    previewAcceptance,
    operatorConsoleDelivery,
    routeReadinessHandoff,
    reportingState,
    exportHistory,
    nextAction,
    exportSummary,
    auditProof,
    evidence: permittedEvents,
    boundaryDeniedEvidence: events
      .filter((event) => !event.scope.allowed)
      .map((event) => ({
        id: event.id,
        sequence: event.sequence,
        timestamp: event.timestamp,
        tenantId: event.scope.tenantId,
        workspaceId: event.scope.workspaceId,
        deniedReason: event.scope.deniedReason,
        grantId: event.scope.grantId,
        grantState: event.scope.grantState,
        boundaryHash: event.scope.boundaryHash,
      }))
  };
}

export default describeCliLogsSurface;
