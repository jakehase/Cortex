import { createHash } from "node:crypto";

export const surfaceId = "aios_audit-recovery_recovery-checkpoint_077";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "recovery-checkpoint";

const RECOVERY_STATUSES = new Set([
  "captured",
  "validated",
  "restored",
  "failed",
  "skipped"
]);

const DEFAULT_STATUS = "captured";
const LIFECYCLE_COMMANDS = new Set([
  "enable",
  "disable",
  "validate",
  "schedule",
  "run-now",
  "pause"
]);

const DEFAULT_LIFECYCLE_SETTINGS = {
  enabled: true,
  validationRequired: true,
  proofRequired: true,
  exportOnRestore: true,
  scheduleMode: "manual",
  intervalMinutes: 0,
  minIntervalMinutes: 5,
  maxIntervalMinutes: 1440,
  maxRetention: 25
};

const RECOVERY_PROVIDER_CAPABILITIES = new Set([
  "capture-checkpoint",
  "validate-checkpoint",
  "restore-checkpoint",
  "export-proof",
  "sync-metadata",
  "external-handoff",
  "mailchimp-audience-sync",
  "mailchimp-campaign-replay"
]);

const PROVIDER_SYNC_MODES = new Set(["none", "cursor", "watermark", "event-log"]);
const PROVIDER_HANDOFF_MODES = new Set(["none", "manifest", "signed-envelope", "callback"]);
const MAILCHIMP_HANDOFF_TARGETS = new Set(["audience", "campaign", "automation", "journey"]);
const MAILCHIMP_EXPORT_MODES = new Set(["preview-only", "members", "campaign-events", "replay"]);
const MAILCHIMP_DEFAULT_EXPORT_FIELDS = ["email_address", "status", "merge_fields", "tags"];
const ANALYTICS_EXPORT_FORMATS = new Set(["summary-json", "jsonl", "csv"]);
const ANALYTICS_GROUPINGS = new Set(["status", "source", "hour", "day"]);
const PROOF_ARTIFACT_ALGORITHMS = new Set(["sha256", "hosted-reference"]);
const MAX_ACCEPTANCE_EXPORT_RECORDS = 25;
const MAX_CLIENT_PENDING_MUTATIONS = 12;
const MAX_CLIENT_ACKNOWLEDGEMENTS = 16;
const SHA256_HEX_DIGEST = /^[a-f0-9]{64}$/i;
const RECOVERY_REPLAY_EVENT_TYPES = new Set([
  "boot",
  "run",
  "claim",
  "checkpoint",
  "validation",
  "restore",
  "handoff"
]);
const CLIENT_ROUTE_ACTIONS = new Set([
  "inspect-recovery-checkpoint",
  "preview-recovery-checkpoints",
  "accept-recovery-preview",
  "dispatch-recovery-checkpoint",
  "run-checkpoint-cycle",
  "handoff-export-manifest",
  "wait-for-schedule",
  "resolve-recovery-blockers",
  "collect-preview-acceptance",
  "resume-command",
  "return-cached-result",
  "persist-and-dispatch-command",
  "refresh-persisted-cursors",
  "inspect-health",
  "export-audit-evidence",
  "refresh-provider-sync"
]);

const ROLE_PERMISSION_GRANTS = {
  owner: ["read", "capture", "validate", "restore", "export", "handoff", "admin"],
  admin: ["read", "capture", "validate", "restore", "export", "handoff", "admin"],
  operator: ["read", "capture", "validate", "restore", "export", "handoff"],
  auditor: ["read", "export"],
  observer: ["read"],
  service: ["read", "capture", "validate", "export"]
};

const ROUTE_ACTION_PERMISSION_REQUIREMENTS = {
  "inspect-recovery-checkpoint": ["read"],
  "preview-recovery-checkpoints": ["read"],
  "accept-recovery-preview": ["read", "restore"],
  "dispatch-recovery-checkpoint": ["read", "capture", "validate"],
  "run-checkpoint-cycle": ["read", "capture", "validate"],
  "handoff-export-manifest": ["read", "export", "handoff"],
  "wait-for-schedule": ["read"],
  "resolve-recovery-blockers": ["read"],
  "collect-preview-acceptance": ["read", "restore"],
  "resume-command": ["read"],
  "return-cached-result": ["read"],
  "persist-and-dispatch-command": ["read", "capture"],
  "refresh-persisted-cursors": ["read"],
  "inspect-health": ["read"],
  "export-audit-evidence": ["read", "export"],
  "refresh-provider-sync": ["read"]
};

function normalizeStatus(value) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  return RECOVERY_STATUSES.has(status) ? status : DEFAULT_STATUS;
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "enabled"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "disabled"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback;
}

function normalizeLifecycleCommand(value) {
  const command = typeof value === "string" ? value.trim().toLowerCase() : "";
  return LIFECYCLE_COMMANDS.has(command) ? command : null;
}

function normalizeClientRouteAction(value, fallback = "inspect-recovery-checkpoint") {
  const action = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CLIENT_ROUTE_ACTIONS.has(action) ? action : fallback;
}

function normalizeStringList(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return raw
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter((entry, index, list) => entry && list.indexOf(entry) === index)
    .sort();
}

function normalizeScheduleMode(value, intervalMinutes) {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (mode === "disabled" || mode === "manual" || mode === "interval") return mode;
  return intervalMinutes > 0 ? "interval" : "manual";
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = value.trim();
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function normalizeReplayEventType(record, status) {
  const rawType = typeof record.eventType === "string" && record.eventType.trim()
    ? record.eventType
    : typeof record.type === "string" && record.type.trim()
      ? record.type
      : typeof record.kind === "string" && record.kind.trim()
        ? record.kind
        : typeof record.action === "string" && record.action.trim()
          ? record.action
          : "";
  const normalized = rawType
    .trim()
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .replace(/\s+/g, "-");

  if (RECOVERY_REPLAY_EVENT_TYPES.has(normalized)) return normalized;
  if (normalized.includes("boot")) return "boot";
  if (normalized.includes("claim")) return "claim";
  if (normalized.includes("run") || normalized.includes("cycle")) return "run";
  if (normalized.includes("validat")) return "validation";
  if (normalized.includes("restore") || status === "restored") return "restore";
  if (normalized.includes("handoff")) return "handoff";
  return "checkpoint";
}

function stableRecoveryValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableRecoveryValue(entry));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((record, key) => {
        if (value[key] !== undefined) record[key] = stableRecoveryValue(value[key]);
        return record;
      }, {});
  }
  return value;
}

function buildRecoveryDigest(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableRecoveryValue(value)))
    .digest("hex");
}

function normalizeProofArtifactDigest(record = {}) {
  const rawDigest = typeof record.digest === "string" && record.digest.trim()
    ? record.digest.trim()
    : typeof record.sha256 === "string" && record.sha256.trim()
      ? record.sha256.trim()
      : null;
  const rawAlgorithm = typeof record.algorithm === "string" && record.algorithm.trim()
    ? record.algorithm.trim().toLowerCase().replaceAll("_", "-")
    : rawDigest ? "sha256" : "hosted-reference";
  const algorithm = PROOF_ARTIFACT_ALGORITHMS.has(rawAlgorithm)
    ? rawAlgorithm
    : rawDigest ? "sha256" : "hosted-reference";
  const issues = [];

  if (rawAlgorithm && !PROOF_ARTIFACT_ALGORITHMS.has(rawAlgorithm)) {
    issues.push({
      code: "proof_artifact_algorithm_unsupported",
      severity: "error",
      actual: rawAlgorithm,
      message: "Proof artifact algorithm must be sha256 or hosted-reference."
    });
  }
  if (algorithm === "sha256" && !rawDigest) {
    issues.push({
      code: "proof_artifact_digest_missing",
      severity: "error",
      message: "sha256 proof artifacts require a digest."
    });
  }
  if (algorithm === "sha256" && rawDigest && !SHA256_HEX_DIGEST.test(rawDigest)) {
    issues.push({
      code: "proof_artifact_digest_invalid",
      severity: "error",
      actualLength: rawDigest.length,
      message: "sha256 proof artifact digests must be 64 hexadecimal characters."
    });
  }
  if (algorithm === "hosted-reference" && rawDigest) {
    issues.push({
      code: "proof_artifact_hosted_reference_digest_ignored",
      severity: "warning",
      message: "hosted-reference proof artifacts should not provide a digest."
    });
  }

  return {
    algorithm,
    digest: rawDigest,
    digestValid: !issues.some((issue) => issue.severity === "error"),
    trustState: issues.some((issue) => issue.severity === "error")
      ? "invalid"
      : issues.length > 0
        ? "trusted-with-warnings"
        : "trusted",
    issues
  };
}

function addMinutes(timestamp, minutes) {
  const baseMs = Date.parse(timestamp);
  if (!Number.isFinite(baseMs)) return null;
  return new Date(baseMs + minutes * 60 * 1000).toISOString();
}

function addMilliseconds(timestamp, milliseconds) {
  const baseMs = Date.parse(timestamp);
  if (!Number.isFinite(baseMs)) return null;
  return new Date(baseMs + milliseconds).toISOString();
}

function normalizeResumeGuard(input = {}, checkpoints = [], scope = {}, now) {
  const source = input && typeof input === "object" ? input : {};
  const rawGuard = source.resumeGuard && typeof source.resumeGuard === "object"
    ? source.resumeGuard
    : source.resumeClaim && typeof source.resumeClaim === "object"
      ? source.resumeClaim
      : source.resumeToken && typeof source.resumeToken === "object"
        ? source.resumeToken
        : {};
  const requested = rawGuard.required === true
    || rawGuard.enabled === true
    || typeof rawGuard.token === "string"
    || typeof rawGuard.checkpointId === "string"
    || typeof rawGuard.resumeToken === "string";
  const checkpointId = readScopedString(rawGuard, "checkpointId", "checkpoint")
    || (checkpoints.length === 1 ? checkpoints[0].checkpointId : null);
  const token = typeof rawGuard.token === "string" && rawGuard.token.trim()
    ? rawGuard.token.trim()
    : typeof rawGuard.resumeToken === "string" && rawGuard.resumeToken.trim()
      ? rawGuard.resumeToken.trim()
      : null;
  const issuedAt = normalizeTimestamp(rawGuard.issuedAt) || normalizeTimestamp(rawGuard.createdAt);
  const expiresAt = normalizeTimestamp(rawGuard.expiresAt) || normalizeTimestamp(rawGuard.validUntil);
  const nowMs = Date.parse(now);
  const issuedAtMs = issuedAt ? Date.parse(issuedAt) : NaN;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const matchedCheckpoint = checkpointId
    ? checkpoints.find((checkpoint) => checkpoint.checkpointId === checkpointId) || null
    : null;
  const tenantId = readScopedString(rawGuard, "tenantId", "tenant") || matchedCheckpoint?.tenantId || scope.tenantId;
  const workspaceId = readScopedString(rawGuard, "workspaceId", "workspace") || matchedCheckpoint?.workspaceId || scope.workspaceId;
  const blockers = [];
  const warnings = [];

  if (requested && !token) blockers.push("resume_guard_token_missing");
  if (requested && !checkpointId) blockers.push("resume_guard_checkpoint_missing");
  if (checkpointId && !matchedCheckpoint) blockers.push("resume_guard_checkpoint_not_in_scope");
  if (tenantId !== scope.tenantId) blockers.push("resume_guard_tenant_mismatch");
  if (workspaceId !== scope.workspaceId) blockers.push("resume_guard_workspace_mismatch");
  if (issuedAt && Number.isFinite(issuedAtMs) && Number.isFinite(nowMs) && issuedAtMs > nowMs) {
    blockers.push("resume_guard_issued_at_in_future");
  }
  if (expiresAt && Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs) {
    blockers.push("resume_guard_expired");
  }
  if (requested && !issuedAt) warnings.push("resume_guard_issued_at_missing");
  if (requested && !expiresAt) warnings.push("resume_guard_expiry_missing");
  if (matchedCheckpoint && matchedCheckpoint.status !== "validated" && matchedCheckpoint.status !== "restored") {
    warnings.push("resume_guard_checkpoint_not_validated");
  }

  const digest = buildRecoveryDigest({
    schema: "aios.auditRecovery.recoveryCheckpoint.resumeGuard.v1",
    checkpointId,
    token,
    tenantId,
    workspaceId,
    issuedAt,
    expiresAt,
    blockers,
    warnings
  });

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.resumeGuard.v1",
    requested,
    ready: !requested || blockers.length === 0,
    state: !requested ? "not-requested" : blockers.length > 0 ? "blocked" : warnings.length > 0 ? "ready-with-warnings" : "ready",
    token,
    checkpointId,
    tenantId,
    workspaceId,
    issuedAt,
    expiresAt,
    matchedCheckpointStatus: matchedCheckpoint?.status || null,
    blockers,
    warnings,
    proof: {
      algorithm: "sha256",
      digest,
      covers: ["token", "checkpointId", "tenantId", "workspaceId", "issuedAt", "expiresAt", "blockers"]
    }
  };
}

function normalizeCapabilityList(value, fallback = []) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : fallback;
  const capabilities = [];

  for (const entry of raw) {
    const capability = typeof entry === "string" ? entry.trim().toLowerCase() : "";
    if (RECOVERY_PROVIDER_CAPABILITIES.has(capability) && !capabilities.includes(capability)) {
      capabilities.push(capability);
    }
  }

  return capabilities;
}

function normalizePermissionList(value, roles) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const permissions = new Set();

  for (const role of roles) {
    for (const grant of ROLE_PERMISSION_GRANTS[role] || []) {
      permissions.add(grant);
    }
  }
  for (const entry of raw) {
    const permission = typeof entry === "string" ? entry.trim().toLowerCase() : "";
    if (permission) permissions.add(permission);
  }

  return Array.from(permissions).sort();
}

function normalizeTenantScope(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawScope = source.accessScope && typeof source.accessScope === "object"
    ? source.accessScope
    : source.scope && typeof source.scope === "object"
      ? source.scope
      : {};
  const tenantId = typeof rawScope.tenantId === "string" && rawScope.tenantId.trim()
    ? rawScope.tenantId.trim()
    : typeof source.tenantId === "string" && source.tenantId.trim()
      ? source.tenantId.trim()
      : "default-tenant";
  const workspaceId = typeof rawScope.workspaceId === "string" && rawScope.workspaceId.trim()
    ? rawScope.workspaceId.trim()
    : typeof source.workspaceId === "string" && source.workspaceId.trim()
      ? source.workspaceId.trim()
      : "default-workspace";
  const rawRoles = Array.isArray(rawScope.roles)
    ? rawScope.roles
    : Array.isArray(source.roles)
      ? source.roles
      : typeof rawScope.role === "string"
        ? [rawScope.role]
        : typeof source.role === "string"
          ? [source.role]
          : ["operator"];
  const roles = rawRoles
    .map((role) => typeof role === "string" ? role.trim().toLowerCase() : "")
    .filter((role, index, list) => ROLE_PERMISSION_GRANTS[role] && list.indexOf(role) === index);
  const resolvedRoles = roles.length ? roles : ["observer"];
  const permissions = normalizePermissionList(rawScope.permissions || source.permissions, resolvedRoles);

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.accessScope.v1",
    tenantId,
    workspaceId,
    roles: resolvedRoles,
    permissions,
    canRead: permissions.includes("read") || permissions.includes("admin"),
    canCapture: permissions.includes("capture") || permissions.includes("admin"),
    canValidate: permissions.includes("validate") || permissions.includes("admin"),
    canRestore: permissions.includes("restore") || permissions.includes("admin"),
    canExport: permissions.includes("export") || permissions.includes("admin"),
    canHandoff: permissions.includes("handoff") || permissions.includes("admin")
  };
}

function readScopedString(record, primary, fallback) {
  const value = record && typeof record[primary] === "string" && record[primary].trim()
    ? record[primary].trim()
    : record && typeof record[fallback] === "string" && record[fallback].trim()
      ? record[fallback].trim()
      : null;
  return value;
}

function normalizeProviderContracts(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawProviders = Array.isArray(source.providerContracts)
    ? source.providerContracts
    : Array.isArray(source.providers)
      ? source.providers
      : [];

  const scope = normalizeTenantScope(input);

  return rawProviders.map((provider, index) => {
    const record = provider && typeof provider === "object" ? provider : {};
    const providerId = typeof record.providerId === "string" && record.providerId.trim()
      ? record.providerId.trim()
      : typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `recovery-provider-${index + 1}`;
    const service = typeof record.service === "string" && record.service.trim()
      ? record.service.trim()
      : "checkpoint-store";
    const endpointRef = typeof record.endpointRef === "string" && record.endpointRef.trim()
      ? record.endpointRef.trim()
      : typeof record.endpoint === "string" && record.endpoint.trim()
        ? record.endpoint.trim()
        : null;
    const syncCursor = typeof record.syncCursor === "string" && record.syncCursor.trim()
      ? record.syncCursor.trim()
      : typeof record.cursor === "string" && record.cursor.trim()
        ? record.cursor.trim()
        : null;
    const capabilities = normalizeCapabilityList(record.capabilities, [
      "capture-checkpoint",
      "validate-checkpoint",
      "restore-checkpoint"
    ]);
    const state = typeof record.state === "string" && record.state.trim()
      ? record.state.trim().toLowerCase()
      : endpointRef ? "connected" : "declared";
    const syncMode = typeof record.syncMode === "string" && PROVIDER_SYNC_MODES.has(record.syncMode.trim().toLowerCase())
      ? record.syncMode.trim().toLowerCase()
      : capabilities.includes("sync-metadata") ? "cursor" : "none";
    const handoffMode = typeof record.handoffMode === "string" && PROVIDER_HANDOFF_MODES.has(record.handoffMode.trim().toLowerCase())
      ? record.handoffMode.trim().toLowerCase()
      : capabilities.includes("external-handoff") ? "manifest" : "none";
    const requiredCapabilities = normalizeCapabilityList(record.requiredCapabilities, []);

    return {
      providerId,
      service,
      contractRef: typeof record.contractRef === "string" && record.contractRef.trim()
        ? record.contractRef.trim()
        : `${service}:${providerId}`,
      apiVersion: typeof record.apiVersion === "string" && record.apiVersion.trim()
        ? record.apiVersion.trim()
        : "v1",
      endpointRef,
      tenantId: readScopedString(record, "tenantId", "tenant") || scope.tenantId,
      workspaceId: readScopedString(record, "workspaceId", "workspace") || scope.workspaceId,
      state,
      capabilities,
      requiredCapabilities,
      syncCursor,
      syncMode,
      handoffMode,
      lastSyncedAt: normalizeTimestamp(record.lastSyncedAt) || normalizeTimestamp(record.syncedAt),
      staleAfterMinutes: Math.max(1, normalizePositiveInteger(record.staleAfterMinutes, 60)),
      maxBatchSize: Math.max(1, normalizePositiveInteger(record.maxBatchSize, 100)),
      requiresProofExport: normalizeBoolean(record.requiresProofExport, capabilities.includes("export-proof")),
      acceptsExternalHandoff: normalizeBoolean(record.acceptsExternalHandoff, capabilities.includes("external-handoff")),
      mailchimp: normalizeMailchimpProviderContract(record, {
        providerId,
        service,
        endpointRef,
        capabilities,
        syncCursor
      })
    };
  });
}

function normalizeMailchimpTargetType(value) {
  const targetType = typeof value === "string"
    ? value.trim().toLowerCase().replaceAll("_", "-")
    : "";
  return MAILCHIMP_HANDOFF_TARGETS.has(targetType) ? targetType : "audience";
}

function normalizeMailchimpExportMode(value, capabilities = []) {
  const exportMode = typeof value === "string"
    ? value.trim().toLowerCase().replaceAll("_", "-")
    : "";
  if (MAILCHIMP_EXPORT_MODES.has(exportMode)) return exportMode;
  return capabilities.includes("mailchimp-campaign-replay") ? "replay" : "preview-only";
}

function normalizeMailchimpProviderContract(record = {}, defaults = {}) {
  const source = record.mailchimp && typeof record.mailchimp === "object"
    ? record.mailchimp
    : record.mailchimpHandoff && typeof record.mailchimpHandoff === "object"
      ? record.mailchimpHandoff
      : {};
  const serviceText = `${defaults.service || ""} ${record.kind || ""} ${record.type || ""}`.toLowerCase();
  const explicit = normalizeBoolean(source.enabled, false)
    || typeof source.audienceId === "string"
    || typeof source.campaignId === "string"
    || serviceText.includes("mailchimp")
    || defaults.capabilities.includes("mailchimp-audience-sync")
    || defaults.capabilities.includes("mailchimp-campaign-replay");
  const targetType = normalizeMailchimpTargetType(source.targetType || source.target);
  const exportMode = normalizeMailchimpExportMode(source.exportMode || source.mode, defaults.capabilities);
  const audienceId = readScopedString(source, "audienceId", "listId");
  const campaignId = readScopedString(source, "campaignId", "campaign");
  const automationId = readScopedString(source, "automationId", "journeyId");
  const dataCenter = typeof source.dataCenter === "string" && source.dataCenter.trim()
    ? source.dataCenter.trim().toLowerCase()
    : typeof source.dc === "string" && source.dc.trim()
      ? source.dc.trim().toLowerCase()
      : null;
  const exportFields = normalizeStringList(source.exportFields || source.fields);
  const mergeFieldMap = source.mergeFieldMap && typeof source.mergeFieldMap === "object"
    ? Object.keys(source.mergeFieldMap)
        .sort()
        .reduce((mapped, key) => {
          const value = source.mergeFieldMap[key];
          if (typeof value === "string" && value.trim()) mapped[key] = value.trim();
          return mapped;
        }, {})
    : {};
  const requiredCapabilities = [
    "external-handoff",
    "export-proof",
    targetType === "campaign" || exportMode === "replay"
      ? "mailchimp-campaign-replay"
      : "mailchimp-audience-sync"
  ];
  const missingCapabilities = explicit
    ? requiredCapabilities.filter((capability) => !defaults.capabilities.includes(capability))
    : [];
  const blockers = [];

  if (explicit && targetType === "audience" && !audienceId) blockers.push("mailchimp_audience_id_missing");
  if (explicit && targetType === "campaign" && !campaignId) blockers.push("mailchimp_campaign_id_missing");
  if (explicit && targetType === "automation" && !automationId) blockers.push("mailchimp_automation_id_missing");
  if (explicit && exportMode === "members" && !audienceId) blockers.push("mailchimp_member_export_requires_audience");
  if (explicit && exportMode === "campaign-events" && !campaignId) blockers.push("mailchimp_campaign_event_export_requires_campaign");
  if (explicit && missingCapabilities.length > 0) blockers.push("mailchimp_capability_missing");

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.mailchimpProviderContract.v1",
    enabled: explicit,
    providerId: defaults.providerId,
    endpointRef: defaults.endpointRef,
    targetType,
    exportMode,
    audienceId,
    campaignId,
    automationId,
    dataCenter,
    syncCursor: typeof source.syncCursor === "string" && source.syncCursor.trim()
      ? source.syncCursor.trim()
      : defaults.syncCursor,
    exportFields: exportFields.length > 0 ? exportFields : MAILCHIMP_DEFAULT_EXPORT_FIELDS,
    mergeFieldMap,
    consentBoundary: {
      requiresMarketingConsent: normalizeBoolean(source.requiresMarketingConsent, true),
      suppressUnsubscribed: normalizeBoolean(source.suppressUnsubscribed, true),
      doubleOptIn: normalizeBoolean(source.doubleOptIn, false)
    },
    requiredCapabilities,
    missingCapabilities,
    blockers,
    ready: explicit && blockers.length === 0
  };
}

function negotiateProviderCapabilities(providers, input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const requested = normalizeCapabilityList(source.requestedCapabilities, [
    "capture-checkpoint",
    "validate-checkpoint",
    "restore-checkpoint",
    "export-proof"
  ]);
  const offered = new Set();

  for (const provider of providers) {
    for (const capability of provider.capabilities) {
      offered.add(capability);
    }
  }

  const granted = requested.filter((capability) => offered.has(capability));
  const missing = requested.filter((capability) => !offered.has(capability));

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.capabilityNegotiation.v1",
    requested,
    granted,
    missing,
    providerCount: providers.length,
    ready: providers.length > 0 && missing.length === 0,
    degraded: providers.length === 0 || missing.length > 0
  };
}

function normalizeLifecycleSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawSettings = source.lifecycleSettings && typeof source.lifecycleSettings === "object"
    ? source.lifecycleSettings
    : source.settings && typeof source.settings === "object"
      ? source.settings
      : {};
  const command = normalizeLifecycleCommand(source.command || rawSettings.command);
  const intervalMinutes = normalizePositiveInteger(
    rawSettings.intervalMinutes ?? rawSettings.scheduleIntervalMinutes ?? source.intervalMinutes ?? source.scheduleIntervalMinutes,
    DEFAULT_LIFECYCLE_SETTINGS.intervalMinutes
  );
  const minIntervalMinutes = normalizePositiveInteger(
    rawSettings.minIntervalMinutes ?? source.minIntervalMinutes,
    DEFAULT_LIFECYCLE_SETTINGS.minIntervalMinutes
  );
  const maxIntervalMinutes = normalizePositiveInteger(
    rawSettings.maxIntervalMinutes ?? source.maxIntervalMinutes,
    DEFAULT_LIFECYCLE_SETTINGS.maxIntervalMinutes
  );
  const maxRetention = normalizePositiveInteger(rawSettings.maxRetention ?? source.maxRetention, DEFAULT_LIFECYCLE_SETTINGS.maxRetention);
  const requestedRunAtRaw = rawSettings.requestedRunAt ?? source.requestedRunAt;
  const lastRunAtRaw = rawSettings.lastRunAt ?? source.lastRunAt;
  const pausedUntilRaw = rawSettings.pausedUntil ?? source.pausedUntil;
  const scheduleMode = normalizeScheduleMode(rawSettings.scheduleMode ?? source.scheduleMode, intervalMinutes);
  const enabledFallback = scheduleMode !== "disabled" && DEFAULT_LIFECYCLE_SETTINGS.enabled;
  const enabled = command === "enable"
    ? true
    : command === "disable" || command === "pause"
      ? false
      : normalizeBoolean(rawSettings.enabled ?? source.enabled, enabledFallback);

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.lifecycleSettings.v1",
    command,
    enabled,
    validationRequired: normalizeBoolean(rawSettings.validationRequired ?? source.validationRequired, DEFAULT_LIFECYCLE_SETTINGS.validationRequired),
    proofRequired: normalizeBoolean(rawSettings.proofRequired ?? source.proofRequired, DEFAULT_LIFECYCLE_SETTINGS.proofRequired),
    exportOnRestore: normalizeBoolean(rawSettings.exportOnRestore ?? source.exportOnRestore, DEFAULT_LIFECYCLE_SETTINGS.exportOnRestore),
    scheduleMode: enabled ? scheduleMode : "disabled",
    intervalMinutes: enabled && scheduleMode === "interval" ? intervalMinutes : 0,
    minIntervalMinutes: Math.max(1, minIntervalMinutes),
    maxIntervalMinutes: Math.max(Math.max(1, minIntervalMinutes), maxIntervalMinutes),
    maxRetention: Math.max(1, maxRetention),
    requestedRunAt: normalizeTimestamp(requestedRunAtRaw),
    requestedRunAtRaw: typeof requestedRunAtRaw === "string" && requestedRunAtRaw.trim()
      ? requestedRunAtRaw.trim()
      : null,
    lastRunAt: normalizeTimestamp(lastRunAtRaw),
    lastRunAtRaw: typeof lastRunAtRaw === "string" && lastRunAtRaw.trim()
      ? lastRunAtRaw.trim()
      : null,
    pausedUntil: normalizeTimestamp(pausedUntilRaw),
    pausedUntilRaw: typeof pausedUntilRaw === "string" && pausedUntilRaw.trim()
      ? pausedUntilRaw.trim()
      : null
  };
}

function normalizeCheckpointEvent(event, index, now, scope) {
  const record = event && typeof event === "object" ? event : {};
  const id = typeof record.id === "string" && record.id.trim()
    ? record.id.trim()
    : `checkpoint-event-${index + 1}`;
  const source = typeof record.source === "string" && record.source.trim()
    ? record.source.trim()
    : "kernel";
  const checkpointId = typeof record.checkpointId === "string" && record.checkpointId.trim()
    ? record.checkpointId.trim()
    : `${source}:${id}`;
  const timestamp = typeof record.timestamp === "string" && record.timestamp.trim()
    ? record.timestamp.trim()
    : now;
  const proofRef = typeof record.proofRef === "string" && record.proofRef.trim()
    ? record.proofRef.trim()
    : null;
  const status = normalizeStatus(record.status);
  const durationMs = Number.isFinite(record.durationMs) && record.durationMs >= 0
    ? Math.round(record.durationMs)
    : 0;
  const sizeBytes = Number.isFinite(record.sizeBytes) && record.sizeBytes >= 0
    ? Math.round(record.sizeBytes)
    : 0;
  const eventType = normalizeReplayEventType(record, status);

  return {
    id,
    checkpointId,
    eventType,
    source,
    tenantId: readScopedString(record, "tenantId", "tenant") || scope.tenantId,
    workspaceId: readScopedString(record, "workspaceId", "workspace") || scope.workspaceId,
    status,
    timestamp,
    timestampValid: normalizeTimestamp(timestamp) !== null,
    bootId: readScopedString(record, "bootId", "boot"),
    runId: readScopedString(record, "runId", "run"),
    claimId: readScopedString(record, "claimId", "claim"),
    writerId: readScopedString(record, "writerId", "writer"),
    replayDigest: typeof record.replayDigest === "string" && record.replayDigest.trim()
      ? record.replayDigest.trim()
      : typeof record.digest === "string" && record.digest.trim()
        ? record.digest.trim()
        : null,
    previousReplayDigest: typeof record.previousReplayDigest === "string" && record.previousReplayDigest.trim()
      ? record.previousReplayDigest.trim()
      : typeof record.previousDigest === "string" && record.previousDigest.trim()
        ? record.previousDigest.trim()
        : null,
    proofRef,
    durationMs,
    sizeBytes,
    exportable: status === "validated" || status === "restored"
  };
}

function normalizeProofArtifacts(input = {}, scope, now) {
  const source = input && typeof input === "object" ? input : {};
  const rawArtifacts = Array.isArray(source.proofArtifacts)
    ? source.proofArtifacts
    : Array.isArray(source.proofs)
      ? source.proofs
      : [];

  return rawArtifacts.map((artifact, index) => {
    const record = artifact && typeof artifact === "object" ? artifact : {};
    const proofRef = typeof record.proofRef === "string" && record.proofRef.trim()
      ? record.proofRef.trim()
      : typeof record.ref === "string" && record.ref.trim()
        ? record.ref.trim()
        : `proof-artifact-${index + 1}`;
    const checkpointId = typeof record.checkpointId === "string" && record.checkpointId.trim()
      ? record.checkpointId.trim()
      : null;
    const providerId = typeof record.providerId === "string" && record.providerId.trim()
      ? record.providerId.trim()
      : typeof record.provider === "string" && record.provider.trim()
        ? record.provider.trim()
        : null;
    const proofDigest = normalizeProofArtifactDigest(record);

    return {
      schema: "aios.auditRecovery.recoveryCheckpoint.proofArtifact.v1",
      proofRef,
      checkpointId,
      tenantId: readScopedString(record, "tenantId", "tenant") || scope.tenantId,
      workspaceId: readScopedString(record, "workspaceId", "workspace") || scope.workspaceId,
      providerId,
      evidenceType: typeof record.evidenceType === "string" && record.evidenceType.trim()
        ? record.evidenceType.trim()
        : "checkpoint-proof",
      algorithm: proofDigest.algorithm,
      digest: proofDigest.digest,
      digestValid: proofDigest.digestValid,
      trustState: proofDigest.trustState,
      validationIssues: proofDigest.issues,
      capturedAt: normalizeTimestamp(record.capturedAt) || normalizeTimestamp(record.timestamp) || now,
      exportedAt: normalizeTimestamp(record.exportedAt),
      externalRef: typeof record.externalRef === "string" && record.externalRef.trim()
        ? record.externalRef.trim()
        : typeof record.url === "string" && record.url.trim()
          ? record.url.trim()
          : null
    };
  });
}

function applyProofArtifactBoundary(rawArtifacts, scope, now) {
  const artifacts = [];
  const excludedArtifacts = [];

  for (const artifact of rawArtifacts) {
    const tenantMatch = artifact.tenantId === scope.tenantId;
    const workspaceMatch = artifact.workspaceId === scope.workspaceId;
    if (scope.canRead && tenantMatch && workspaceMatch) {
      artifacts.push(artifact);
    } else {
      excludedArtifacts.push({
        proofRef: artifact.proofRef,
        checkpointId: artifact.checkpointId,
        tenantId: artifact.tenantId,
        workspaceId: artifact.workspaceId,
        trustState: artifact.trustState,
        reason: !scope.canRead ? "read_permission_missing" : tenantMatch ? "workspace_boundary_mismatch" : "tenant_boundary_mismatch"
      });
    }
  }

  return {
    artifacts,
    audit: {
      generatedAt: now,
      schema: "aios.auditRecovery.recoveryCheckpoint.proofArtifactBoundaryAudit.v1",
      scopedProofArtifactCount: artifacts.length,
      excludedProofArtifactCount: excludedArtifacts.length,
      invalidScopedProofArtifactCount: artifacts.filter((artifact) => artifact.digestValid === false).length,
      invalidExcludedProofArtifactCount: excludedArtifacts.filter((artifact) => artifact.trustState === "invalid").length,
      safeBoundary: excludedArtifacts.length === 0 && scope.canRead,
      excludedArtifacts
    }
  };
}

function applyTenantBoundary(rawCheckpoints, rawProviders, scope, now) {
  const scopedCheckpoints = [];
  const excludedCheckpoints = [];
  const scopedProviders = [];
  const excludedProviders = [];

  for (const checkpoint of rawCheckpoints) {
    const tenantMatch = checkpoint.tenantId === scope.tenantId;
    const workspaceMatch = checkpoint.workspaceId === scope.workspaceId;
    if (scope.canRead && tenantMatch && workspaceMatch) {
      scopedCheckpoints.push(checkpoint);
    } else {
      excludedCheckpoints.push({
        checkpointId: checkpoint.checkpointId,
        tenantId: checkpoint.tenantId,
        workspaceId: checkpoint.workspaceId,
        reason: !scope.canRead ? "read_permission_missing" : tenantMatch ? "workspace_boundary_mismatch" : "tenant_boundary_mismatch"
      });
    }
  }

  for (const provider of rawProviders) {
    const tenantMatch = provider.tenantId === scope.tenantId;
    const workspaceMatch = provider.workspaceId === scope.workspaceId;
    if (tenantMatch && workspaceMatch) {
      scopedProviders.push(provider);
    } else {
      excludedProviders.push({
        providerId: provider.providerId,
        tenantId: provider.tenantId,
        workspaceId: provider.workspaceId,
        reason: tenantMatch ? "workspace_boundary_mismatch" : "tenant_boundary_mismatch"
      });
    }
  }

  return {
    scope,
    checkpoints: scopedCheckpoints,
    providers: scopedProviders,
    audit: {
      generatedAt: now,
      schema: "aios.auditRecovery.recoveryCheckpoint.tenantBoundaryAudit.v1",
      activeTenantId: scope.tenantId,
      activeWorkspaceId: scope.workspaceId,
      roles: scope.roles,
      permissions: scope.permissions,
      scopedCheckpointCount: scopedCheckpoints.length,
      excludedCheckpointCount: excludedCheckpoints.length,
      scopedProviderCount: scopedProviders.length,
      excludedProviderCount: excludedProviders.length,
      safeBoundary: excludedCheckpoints.length === 0 && excludedProviders.length === 0 && scope.canRead,
      excludedCheckpoints,
      excludedProviders
    }
  };
}

function buildLifecycleValidation(settings, analytics) {
  const issues = [];
  if (settings.requestedRunAtRaw && !settings.requestedRunAt) {
    issues.push({
      code: "requested_run_at_invalid",
      severity: "error",
      message: "requestedRunAt must be an ISO-compatible timestamp."
    });
  }
  if (settings.lastRunAtRaw && !settings.lastRunAt) {
    issues.push({
      code: "last_run_at_invalid",
      severity: "error",
      message: "lastRunAt must be an ISO-compatible timestamp."
    });
  }
  if (settings.pausedUntilRaw && !settings.pausedUntil) {
    issues.push({
      code: "paused_until_invalid",
      severity: "error",
      message: "pausedUntil must be an ISO-compatible timestamp."
    });
  }
  if (settings.scheduleMode === "interval" && settings.intervalMinutes < settings.minIntervalMinutes) {
    issues.push({
      code: "schedule_interval_too_short",
      severity: "error",
      message: `Interval checkpoint schedules must be at least ${settings.minIntervalMinutes} minutes.`
    });
  }
  if (settings.scheduleMode === "interval" && settings.intervalMinutes > settings.maxIntervalMinutes) {
    issues.push({
      code: "schedule_interval_too_long",
      severity: "error",
      message: `Interval checkpoint schedules must be no more than ${settings.maxIntervalMinutes} minutes.`
    });
  }
  if (settings.command === "schedule" && settings.scheduleMode === "manual" && !settings.requestedRunAt) {
    issues.push({
      code: "schedule_command_missing_trigger",
      severity: "error",
      message: "Schedule command requires interval mode or a requestedRunAt timestamp."
    });
  }
  if (settings.command === "run-now" && !settings.enabled) {
    issues.push({
      code: "run_now_requires_enabled_lifecycle",
      severity: "error",
      message: "run-now cannot execute while the recovery checkpoint lifecycle is disabled."
    });
  }
  if (settings.proofRequired && analytics.counters.total > 0 && analytics.counters.proofBacked === 0) {
    issues.push({
      code: "proof_required_missing",
      severity: "error",
      message: "Proof-backed recovery is required but no checkpoint events include proofRef."
    });
  }
  if (settings.validationRequired && analytics.counters.captured > 0 && analytics.counters.validated === 0) {
    issues.push({
      code: "validation_pending",
      severity: "warning",
      message: "Captured checkpoints are waiting for validation before restore/export."
    });
  }
  if (settings.maxRetention < analytics.counters.total) {
    issues.push({
      code: "retention_exceeded",
      severity: "warning",
      message: "Checkpoint event count exceeds configured lifecycle retention."
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issueCount: issues.length,
    issues
  };
}

function buildLifecycleScheduleControl(settings, validation, now) {
  const nowMs = Date.parse(now);
  const requestedMs = settings.requestedRunAt ? Date.parse(settings.requestedRunAt) : NaN;
  const pausedUntilMs = settings.pausedUntil ? Date.parse(settings.pausedUntil) : NaN;
  const lastRunAt = settings.lastRunAt || null;
  const intervalNextRunAt = settings.scheduleMode === "interval"
    ? lastRunAt
      ? addMinutes(lastRunAt, settings.intervalMinutes)
      : now
    : null;
  const requestedDue = settings.requestedRunAt
    ? Number.isFinite(requestedMs) && Number.isFinite(nowMs) && requestedMs <= nowMs
    : false;
  const intervalDue = intervalNextRunAt
    ? Number.isFinite(Date.parse(intervalNextRunAt)) && Number.isFinite(nowMs) && Date.parse(intervalNextRunAt) <= nowMs
    : false;
  const pauseActive = settings.pausedUntil
    ? Number.isFinite(pausedUntilMs) && Number.isFinite(nowMs) && pausedUntilMs > nowMs
    : false;
  const runNowRequested = settings.command === "run-now";
  const manualTriggerRequested = settings.command === "validate" || runNowRequested;
  const scheduleRequested = settings.command === "schedule" || settings.scheduleMode === "interval" || settings.requestedRunAt !== null;
  const blockedReasons = [];

  if (!settings.enabled) blockedReasons.push("lifecycle_disabled");
  if (!validation.valid) blockedReasons.push("lifecycle_validation_failed");
  if (pauseActive) blockedReasons.push("pause_window_active");
  if (settings.scheduleMode === "disabled") blockedReasons.push("schedule_disabled");

  const due = settings.enabled && validation.valid && !pauseActive && (
    runNowRequested || requestedDue || intervalDue
  );
  const nextRunAt = runNowRequested
    ? now
    : settings.requestedRunAt && !requestedDue
      ? settings.requestedRunAt
      : intervalNextRunAt;
  const cadence = settings.scheduleMode === "interval"
    ? `every-${settings.intervalMinutes}-minutes`
    : settings.requestedRunAt
      ? "one-shot"
      : "manual";

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.lifecycleScheduleControl.v1",
    generatedAt: now,
    command: settings.command,
    cadence,
    enabled: settings.enabled,
    mode: settings.scheduleMode,
    intervalMinutes: settings.intervalMinutes,
    minIntervalMinutes: settings.minIntervalMinutes,
    maxIntervalMinutes: settings.maxIntervalMinutes,
    lastRunAt,
    requestedRunAt: settings.requestedRunAt,
    pausedUntil: settings.pausedUntil,
    pauseActive,
    due,
    overdue: due && !runNowRequested && nextRunAt !== null && Date.parse(nextRunAt) < nowMs,
    nextRunAt,
    trigger: runNowRequested
      ? "command:run-now"
      : requestedDue
        ? "requestedRunAt"
        : intervalDue
          ? "interval"
          : manualTriggerRequested
            ? `command:${settings.command}`
            : scheduleRequested
              ? "scheduled"
              : "manual",
    blockedReasons,
    commandAccepted: settings.command === null
      ? true
      : settings.command === "pause"
        ? settings.pausedUntil !== null || !settings.enabled
        : blockedReasons.length === 0 || settings.command === "enable" || settings.command === "disable",
    state: !settings.enabled
      ? "disabled"
      : pauseActive
        ? "paused"
        : blockedReasons.length > 0
          ? "blocked"
          : due
            ? "due"
            : scheduleRequested
              ? "scheduled"
              : "idle"
  };
}

function buildPermissionValidation(scope, settings, analytics) {
  const issues = [];

  if (!scope.canRead) {
    issues.push({ code: "read_permission_missing", permission: "read", action: "inspect-checkpoints" });
  }
  if (settings.enabled && analytics.counters.total === 0 && !scope.canCapture) {
    issues.push({ code: "capture_permission_missing", permission: "capture", action: "capture-checkpoint" });
  }
  if (settings.validationRequired && analytics.counters.captured > 0 && !scope.canValidate) {
    issues.push({ code: "validate_permission_missing", permission: "validate", action: "validate-checkpoints" });
  }
  if (analytics.counters.validated > analytics.counters.restored && !scope.canRestore) {
    issues.push({ code: "restore_permission_missing", permission: "restore", action: "restore-validated-checkpoints" });
  }
  if (settings.exportOnRestore && analytics.counters.restored > 0 && !scope.canExport) {
    issues.push({ code: "export_permission_missing", permission: "export", action: "export-recovery-proof" });
  }

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.permissionValidation.v1",
    valid: issues.length === 0,
    issueCount: issues.length,
    issues
  };
}

function buildLifecycleCommandControl(settings, validation, permissionValidation, scheduleControl, accessScope, analytics, now) {
  const command = settings.command;
  const commandPermissions = {
    enable: ["admin"],
    disable: ["admin"],
    pause: ["admin"],
    validate: ["validate"],
    schedule: ["capture"],
    "run-now": ["capture", "validate"]
  };
  const routeByCommand = {
    enable: "inspect-recovery-checkpoint",
    disable: "inspect-recovery-checkpoint",
    pause: "wait-for-schedule",
    validate: "dispatch-recovery-checkpoint",
    schedule: "wait-for-schedule",
    "run-now": "run-checkpoint-cycle"
  };
  const requiredPermissions = command ? commandPermissions[command] || ["read"] : [];
  const missingPermissions = requiredPermissions.filter((permission) => (
    !accessScope.permissions.includes(permission) && !accessScope.permissions.includes("admin")
  ));
  const blockedReasons = [];

  if (!command) blockedReasons.push("command_not_requested");
  if (missingPermissions.length > 0) blockedReasons.push(...missingPermissions.map((permission) => `${permission}_permission_missing`));
  if (command !== "enable" && command !== "disable" && command !== "pause" && !settings.enabled) {
    blockedReasons.push("lifecycle_disabled");
  }
  if (command && !validation.valid && command !== "disable" && command !== "pause") {
    blockedReasons.push("lifecycle_validation_failed");
  }
  if (command === "validate" && analytics.counters.captured === 0) blockedReasons.push("no_captured_checkpoints_to_validate");
  if (command === "run-now" && permissionValidation.valid === false) blockedReasons.push("permission_validation_failed");
  if (command === "schedule" && scheduleControl.nextRunAt === null) blockedReasons.push("schedule_trigger_missing");
  if (command === "pause" && !settings.pausedUntil) blockedReasons.push("pause_until_missing");

  const effectiveBlockedReasons = Array.from(new Set(blockedReasons.filter((reason) => reason !== "command_not_requested")));
  const settingsPatch = command
    ? {
        enabled: command === "enable"
          ? true
          : command === "disable" || command === "pause"
            ? false
            : settings.enabled,
        scheduleMode: command === "disable"
          ? "disabled"
          : command === "schedule"
            ? settings.scheduleMode
            : settings.scheduleMode,
        intervalMinutes: settings.intervalMinutes,
        requestedRunAt: settings.requestedRunAt,
        pausedUntil: command === "pause" ? settings.pausedUntil : null,
        lastCommand: command,
        commandAppliedAt: now
      }
    : null;
  const commandDigest = buildRecoveryDigest({
    command,
    enabled: settings.enabled,
    scheduleMode: settings.scheduleMode,
    nextRunAt: scheduleControl.nextRunAt,
    requiredPermissions,
    missingPermissions,
    settingsPatch
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.lifecycleCommandControl.v1",
    requested: command !== null,
    command,
    accepted: command !== null && effectiveBlockedReasons.length === 0,
    blockedReasons: effectiveBlockedReasons,
    requiredPermissions,
    missingPermissions,
    routeAction: command ? routeByCommand[command] || "inspect-recovery-checkpoint" : "inspect-recovery-checkpoint",
    stateTransition: {
      from: settings.enabled ? "enabled" : "disabled",
      to: command === "enable"
        ? "enabled"
        : command === "disable"
          ? "disabled"
          : command === "pause"
            ? "paused"
            : scheduleControl.state,
      scheduleState: scheduleControl.state,
      nextRunAt: scheduleControl.nextRunAt
    },
    persistence: {
      writeRequired: command !== null && effectiveBlockedReasons.length === 0,
      patch: settingsPatch,
      commandDigest
    },
    audit: {
      schema: "aios.auditRecovery.recoveryCheckpoint.lifecycleCommandControlAudit.v1",
      generatedAt: now,
      commandDigest,
      commandAccepted: command !== null && effectiveBlockedReasons.length === 0,
      scheduleDue: scheduleControl.due,
      lifecycleIssueCount: validation.issueCount,
      permissionIssueCount: permissionValidation.issueCount
    }
  };
}

function buildOperatorBoundaryActionPlan({ accessScope, boundaryAudit, proofArtifactBoundaryAudit, lifecycle, commandControl, scheduleControl, permissionValidation, capabilityNegotiation, resumeGuard, externalHandoff, now }) {
  const blockedReasons = [
    ...commandControl.blockedReasons,
    ...scheduleControl.blockedReasons,
    ...permissionValidation.issues.map((issue) => issue.code),
    ...(boundaryAudit.safeBoundary ? [] : ["tenant_boundary_not_safe"]),
    ...(proofArtifactBoundaryAudit.safeBoundary ? [] : ["proof_artifact_boundary_not_safe"]),
    ...(capabilityNegotiation.ready ? [] : capabilityNegotiation.missing.map((capability) => `capability_missing:${capability}`)),
    ...(resumeGuard.ready ? [] : resumeGuard.blockers),
    ...(externalHandoff.ready ? [] : externalHandoff.blockedReasons)
  ];
  const uniqueReasons = [...new Set(blockedReasons)];
  const nextAction = uniqueReasons.includes("read_permission_missing")
    ? "request-read-permission"
    : uniqueReasons.some((reason) => reason.includes("permission_missing"))
      ? "request-required-permissions"
      : uniqueReasons.some((reason) => reason.includes("tenant_boundary") || reason.includes("workspace_boundary"))
        ? "switch-to-scoped-tenant-workspace"
        : uniqueReasons.some((reason) => reason.startsWith("capability_missing:"))
          ? "negotiate-provider-capabilities"
          : uniqueReasons.includes("resume_guard_expired")
            ? "rotate-resume-token"
            : uniqueReasons.includes("proof_required_missing")
              ? "attach-checkpoint-proof"
              : uniqueReasons.includes("lifecycle_validation_failed")
                ? "fix-lifecycle-settings"
                : lifecycle.nextAction.action;
  const canProceed = uniqueReasons.length === 0
    && lifecycle.gates.settingsValid
    && lifecycle.gates.permissionsValid
    && accessScope.canRead;

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.operatorBoundaryActionPlan.v1",
    generatedAt: now,
    state: canProceed
      ? "ready"
      : uniqueReasons.some((reason) => reason.includes("tenant_boundary") || reason.includes("workspace_boundary"))
        ? "boundary-blocked"
        : "needs-operator-action",
    canProceed,
    nextAction,
    routeAction: normalizeClientRouteAction(commandControl.routeAction || lifecycle.nextAction.routeAction),
    blockedReasons: uniqueReasons,
    permissions: {
      roles: accessScope.roles,
      granted: accessScope.permissions,
      missing: commandControl.missingPermissions,
      permissionIssueCodes: permissionValidation.issues.map((issue) => issue.code)
    },
    boundary: {
      tenantId: accessScope.tenantId,
      workspaceId: accessScope.workspaceId,
      safeBoundary: boundaryAudit.safeBoundary && proofArtifactBoundaryAudit.safeBoundary,
      excludedCheckpointCount: boundaryAudit.excludedCheckpointCount,
      excludedProviderCount: boundaryAudit.excludedProviderCount,
      excludedProofArtifactCount: proofArtifactBoundaryAudit.excludedProofArtifactCount
    },
    provider: {
      capabilityReady: capabilityNegotiation.ready,
      missingCapabilities: capabilityNegotiation.missing,
      handoffReady: externalHandoff.ready
    },
    resumeGuard: {
      requested: resumeGuard.requested,
      ready: resumeGuard.ready,
      state: resumeGuard.state,
      checkpointId: resumeGuard.checkpointId,
      blockers: resumeGuard.blockers
    },
    auditSubjects: [
      `tenant:${accessScope.tenantId}`,
      `workspace:${accessScope.workspaceId}`,
      `route-action:${commandControl.routeAction}`,
      `next-action:${nextAction}`
    ]
  };
}

function buildRecoveryReadinessEnvelope({
  accessScope,
  analytics,
  lifecycle,
  lifecycleValidation,
  permissionValidation,
  capabilityNegotiation,
  providerSync,
  integrationProviderContracts,
  proofLedger,
  replayLedger,
  resumeGuard,
  externalHandoff,
  operationalHealth,
  operatorBoundaryActionPlan,
  now
}) {
  const blockers = [];
  const warnings = [];
  const appendFinding = (target, code, domain, action, detail = {}) => {
    target.push({
      code,
      domain,
      action,
      detail
    });
  };

  if (!accessScope.canRead) {
    appendFinding(blockers, "read_permission_missing", "authorization", "request-read-permission");
  }
  if (!lifecycleValidation.valid) {
    for (const issue of lifecycleValidation.issues.filter((entry) => entry.severity === "error")) {
      appendFinding(blockers, issue.code, "lifecycle", "fix-lifecycle-settings", {
        message: issue.message
      });
    }
  }
  for (const issue of permissionValidation.issues) {
    appendFinding(blockers, issue.code, "authorization", "request-required-permissions", {
      permission: issue.permission,
      operation: issue.action
    });
  }
  if (!capabilityNegotiation.ready) {
    for (const capability of capabilityNegotiation.missing) {
      appendFinding(blockers, `capability_missing:${capability}`, "provider", "negotiate-provider-capabilities", {
        capability
      });
    }
  }
  if (!integrationProviderContracts.ready) {
    for (const contract of integrationProviderContracts.contracts.filter((entry) => !entry.ready)) {
      appendFinding(blockers, `provider_contract_blocked:${contract.providerId}`, "provider-contract", "repair-provider-contract", {
        providerId: contract.providerId,
        service: contract.service,
        blockedReasons: contract.blockedReasons,
        missingCapabilities: contract.capabilities.missingFromRequested,
        stale: contract.sync.stale
      });
    }
  }
  if (!proofLedger.ready) {
    appendFinding(blockers, "proof_ledger_not_ready", "proof", "attach-checkpoint-proof", {
      invalidArtifactCount: proofLedger.invalidArtifactCount,
      missingProofCount: proofLedger.missingProofCount
    });
  }
  if (!replayLedger.valid) {
    appendFinding(blockers, "replay_ledger_invalid", "replay", "repair-replay-chain", {
      issueCount: replayLedger.issues.length,
      latestDigest: replayLedger.latestDigest
    });
  }
  if (!resumeGuard.ready) {
    for (const blocker of resumeGuard.blockers) {
      appendFinding(blockers, blocker, "resume-guard", "repair-resume-guard", {
        checkpointId: resumeGuard.checkpointId
      });
    }
  }
  if (!externalHandoff.ready) {
    for (const blocker of externalHandoff.blockedReasons) {
      appendFinding(blockers, blocker, "external-handoff", "repair-external-handoff", {
        targetProviderId: externalHandoff.targetProviderId
      });
    }
  }
  if (operationalHealth.status === "failed" || operationalHealth.status === "blocked") {
    appendFinding(blockers, "operational_health_blocked", "operational-health", "resolve-operational-health", {
      status: operationalHealth.status,
      primaryError: operationalHealth.failureState.profiles.primaryFailure
    });
  }
  const staleProviderIds = integrationProviderContracts.syncWatermark.staleProviderIds;

  if (staleProviderIds.length > 0) {
    appendFinding(warnings, "provider_sync_stale", "provider-sync", "refresh-provider-sync", {
      staleProviderIds
    });
  }
  if (lifecycle.schedule.due && lifecycle.nextAction.blocked) {
    appendFinding(warnings, "scheduled_checkpoint_blocked", "lifecycle", lifecycle.nextAction.action, {
      nextRunAt: lifecycle.schedule.nextRunAt,
      reason: lifecycle.nextAction.reason
    });
  }
  if (analytics.counters.failed > 0) {
    appendFinding(warnings, "failed_checkpoint_events_present", "checkpoint-events", "inspect-failed-checkpoints", {
      failedCount: analytics.counters.failed
    });
  }
  if (resumeGuard.warnings.length > 0) {
    for (const warning of resumeGuard.warnings) {
      appendFinding(warnings, warning, "resume-guard", "review-resume-guard", {
        checkpointId: resumeGuard.checkpointId
      });
    }
  }

  const uniqueBlockers = [...new Map(blockers.map((finding) => [finding.code, finding])).values()];
  const uniqueWarnings = [...new Map(warnings.map((finding) => [finding.code, finding])).values()];
  const state = uniqueBlockers.length > 0
    ? "blocked"
    : uniqueWarnings.length > 0 || operationalHealth.status === "degraded"
      ? "degraded"
      : "ready";
  const primaryAction = uniqueBlockers[0]?.action
    || uniqueWarnings[0]?.action
    || operatorBoundaryActionPlan.nextAction
    || lifecycle.nextAction.action;
  const digest = buildRecoveryDigest({
    schema: "aios.auditRecovery.recoveryCheckpoint.readinessEnvelope.v1",
    state,
    primaryAction,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    providerSync: {
      syncableProviderCount: providerSync.syncableProviderCount,
      lastCheckpointAt: providerSync.lastCheckpointAt,
      cursorCount: providerSync.cursors.length
    },
    integrationSyncWatermark: integrationProviderContracts.syncWatermark,
    operatorBoundaryState: operatorBoundaryActionPlan.state,
    generatedAt: now
  });

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.readinessEnvelope.v1",
    generatedAt: now,
    state,
    ready: state === "ready",
    degraded: state === "degraded",
    primaryAction,
    routeAction: normalizeClientRouteAction(
      primaryAction === "refresh-provider-sync"
        ? "refresh-provider-sync"
        : operatorBoundaryActionPlan.routeAction
    ),
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    counts: {
      blockerCount: uniqueBlockers.length,
      warningCount: uniqueWarnings.length,
      failedCheckpointCount: analytics.counters.failed,
      staleProviderCount: staleProviderIds.length,
      missingCapabilityCount: capabilityNegotiation.missing.length
    },
    provider: {
      capabilityReady: capabilityNegotiation.ready,
      grantedCapabilities: capabilityNegotiation.granted,
      missingCapabilities: capabilityNegotiation.missing,
      providerSyncableCount: providerSync.syncableProviderCount,
      staleProviderIds,
      blockedContractCount: integrationProviderContracts.blockedContractCount
    },
    proof: {
      proofLedgerReady: proofLedger.ready,
      proofLedgerDigest: proofLedger.ledgerDigest,
      replayLedgerReady: replayLedger.valid,
      replayLedgerDigest: replayLedger.ledgerDigest
    },
    resume: {
      guardState: resumeGuard.state,
      checkpointId: resumeGuard.checkpointId,
      externalHandoffState: externalHandoff.state,
      externalHandoffReady: externalHandoff.ready
    },
    audit: {
      algorithm: "sha256",
      digest,
      covers: ["state", "primaryAction", "blockers", "warnings", "provider", "proof", "resume"]
    }
  };
}

function buildLifecycleState(settings, analytics, validation, permissionValidation, scheduleControl, commandControl, now) {
  const disabledReason = settings.enabled ? null : (
    settings.command === "pause" ? "paused_by_command" : "disabled_by_settings"
  );
  const shouldValidate = settings.validationRequired && analytics.counters.captured > 0;
  const shouldRestore = validation.valid && analytics.counters.validated > analytics.counters.restored;
  const shouldExport = settings.exportOnRestore && analytics.counters.restored > 0;
  const action = !settings.enabled
    ? "enable"
    : !validation.valid
      ? "repair-settings"
      : !permissionValidation.valid
        ? "request-permission"
        : scheduleControl.pauseActive
          ? "wait-for-pause-window"
          : scheduleControl.due
            ? "run-checkpoint-cycle"
            : shouldValidate
              ? "validate-checkpoints"
              : shouldRestore
                ? "restore-validated-checkpoints"
                : shouldExport
                  ? "export-recovery-proof"
                  : settings.scheduleMode === "interval" || settings.requestedRunAt
                    ? "wait-for-schedule"
                    : "capture-checkpoint";

  return {
    generatedAt: now,
    enabled: settings.enabled,
    disabledReason,
    command: settings.command,
    schedule: {
      mode: settings.scheduleMode,
      intervalMinutes: settings.intervalMinutes,
      minIntervalMinutes: settings.minIntervalMinutes,
      maxIntervalMinutes: settings.maxIntervalMinutes,
      requestedRunAt: settings.requestedRunAt,
      lastRunAt: settings.lastRunAt,
      pausedUntil: settings.pausedUntil,
      nextRunAt: scheduleControl.nextRunAt,
      due: scheduleControl.due,
      active: settings.enabled && (settings.scheduleMode === "interval" || settings.command === "schedule" || settings.requestedRunAt !== null)
    },
    scheduleControl,
    commandControl,
    gates: {
      validationRequired: settings.validationRequired,
      proofRequired: settings.proofRequired,
      exportOnRestore: settings.exportOnRestore,
      settingsValid: validation.valid,
      permissionsValid: permissionValidation.valid
    },
    nextAction: {
      action,
      routeAction: commandControl.accepted ? commandControl.routeAction : normalizeClientRouteAction(action),
      commandAccepted: commandControl.accepted,
      commandBlockedReasons: commandControl.blockedReasons,
      blocked: !settings.enabled || !validation.valid || !permissionValidation.valid || scheduleControl.pauseActive,
      reason: !settings.enabled
        ? disabledReason
        : !validation.valid
          ? "lifecycle_validation_failed"
          : !permissionValidation.valid
            ? permissionValidation.issues[0].code
            : scheduleControl.pauseActive
              ? "pause_window_active"
            : null
    }
  };
}

function buildAnalytics(events) {
  const counters = {
    total: events.length,
    captured: 0,
    validated: 0,
    restored: 0,
    failed: 0,
    skipped: 0,
    exportable: 0,
    proofBacked: 0,
    totalDurationMs: 0,
    totalSizeBytes: 0
  };
  const bySource = {};
  const terminalStatuses = new Set(["restored", "failed", "skipped"]);

  for (const event of events) {
    counters[event.status] += 1;
    counters.totalDurationMs += event.durationMs;
    counters.totalSizeBytes += event.sizeBytes;
    if (event.exportable) counters.exportable += 1;
    if (event.proofRef) counters.proofBacked += 1;
    const sourceCounters = bySource[event.source] || {
      total: 0,
      captured: 0,
      validated: 0,
      restored: 0,
      failed: 0,
      skipped: 0,
      exportable: 0,
      proofBacked: 0,
      terminal: 0,
      totalDurationMs: 0,
      totalSizeBytes: 0,
      firstSeenAt: event.timestamp,
      latestSeenAt: event.timestamp
    };
    sourceCounters.total += 1;
    sourceCounters[event.status] += 1;
    sourceCounters.totalDurationMs += event.durationMs;
    sourceCounters.totalSizeBytes += event.sizeBytes;
    if (event.exportable) sourceCounters.exportable += 1;
    if (event.proofRef) sourceCounters.proofBacked += 1;
    if (terminalStatuses.has(event.status)) sourceCounters.terminal += 1;
    if (event.timestamp.localeCompare(sourceCounters.firstSeenAt) < 0) sourceCounters.firstSeenAt = event.timestamp;
    if (event.timestamp.localeCompare(sourceCounters.latestSeenAt) > 0) sourceCounters.latestSeenAt = event.timestamp;
    bySource[event.source] = sourceCounters;
  }

  return {
    counters,
    bySource,
    terminalRate: counters.total === 0
      ? 0
      : Number(((counters.restored + counters.failed + counters.skipped) / counters.total).toFixed(4)),
    averageDurationMs: counters.total === 0 ? 0 : Math.round(counters.totalDurationMs / counters.total),
    averageSizeBytes: counters.total === 0 ? 0 : Math.round(counters.totalSizeBytes / counters.total),
    recoveryRate: counters.total === 0 ? 0 : Number((counters.restored / counters.total).toFixed(4)),
    validationRate: counters.total === 0 ? 0 : Number((counters.validated / counters.total).toFixed(4)),
    failureRate: counters.total === 0 ? 0 : Number((counters.failed / counters.total).toFixed(4)),
    proofCoverage: counters.total === 0 ? 0 : Number((counters.proofBacked / counters.total).toFixed(4))
  };
}

function compareCheckpointEvents(left, right) {
  const timestampOrder = left.timestamp.localeCompare(right.timestamp);
  return timestampOrder === 0 ? left.id.localeCompare(right.id) : timestampOrder;
}

function buildHistorySnapshots(events, now) {
  const byCheckpoint = new Map();

  for (const event of events.slice().sort(compareCheckpointEvents)) {
    const existing = byCheckpoint.get(event.checkpointId) || {
      checkpointId: event.checkpointId,
      source: event.source,
      firstSeenAt: event.timestamp,
      lastSeenAt: event.timestamp,
      latestStatus: event.status,
      eventCount: 0,
      proofRefs: [],
      statusCounts: {
        captured: 0,
        validated: 0,
        restored: 0,
        failed: 0,
        skipped: 0
      },
      transitions: []
    };

    const previousStatus = existing.latestStatus;
    existing.lastSeenAt = event.timestamp;
    existing.latestStatus = event.status;
    existing.eventCount += 1;
    existing.statusCounts[event.status] += 1;
    if (existing.eventCount === 1 || previousStatus !== event.status) {
      existing.transitions.push({
        from: existing.eventCount === 1 ? null : previousStatus,
        to: event.status,
        at: event.timestamp,
        proofRef: event.proofRef
      });
    }
    if (event.proofRef && !existing.proofRefs.includes(event.proofRef)) {
      existing.proofRefs.push(event.proofRef);
    }
    byCheckpoint.set(event.checkpointId, existing);
  }

  const snapshots = Array.from(byCheckpoint.values());

  return {
    generatedAt: now,
    snapshotCount: byCheckpoint.size,
    restoredSnapshotCount: snapshots.filter((snapshot) => snapshot.latestStatus === "restored").length,
    failedSnapshotCount: snapshots.filter((snapshot) => snapshot.latestStatus === "failed").length,
    snapshots
  };
}

function buildTimeline(events) {
  let previous = null;
  return events
    .slice()
    .sort(compareCheckpointEvents)
    .map((event, index) => {
      const previousTime = previous ? Date.parse(previous.timestamp) : NaN;
      const currentTime = Date.parse(event.timestamp);
      const elapsedMs = Number.isFinite(previousTime) && Number.isFinite(currentTime)
        ? Math.max(0, currentTime - previousTime)
        : null;
      const entry = {
        sequence: index + 1,
        at: event.timestamp,
        checkpointId: event.checkpointId,
        source: event.source,
        status: event.status,
        proofRef: event.proofRef,
        elapsedSincePreviousMs: elapsedMs,
        previousStatus: previous && previous.checkpointId === event.checkpointId ? previous.status : null
      };
      previous = event;
      return entry;
    });
}

function buildReplayLedger(events, now, persistedState) {
  const orderedEvents = events.slice().sort(compareCheckpointEvents);
  const seenEventIds = new Set();
  const issues = [];
  const counters = {
    total: orderedEvents.length,
    boot: 0,
    run: 0,
    claim: 0,
    checkpoint: 0,
    validation: 0,
    restore: 0,
    handoff: 0
  };
  let previousDigest = persistedState.replayCursor || null;

  const entries = orderedEvents.map((event, index) => {
    const duplicate = seenEventIds.has(event.id);
    seenEventIds.add(event.id);
    counters[event.eventType] += 1;

    if (duplicate) {
      issues.push({
        code: "duplicate_replay_event_id",
        severity: "error",
        eventId: event.id,
        sequence: index + 1,
        message: "Recovery replay event ids must be unique for deterministic hosted-kernel replay."
      });
    }
    if (!event.timestampValid) {
      issues.push({
        code: "invalid_replay_event_timestamp",
        severity: "error",
        eventId: event.id,
        sequence: index + 1,
        actual: event.timestamp,
        message: "Recovery replay events require ISO-compatible timestamps."
      });
    }
    if (event.previousReplayDigest && previousDigest && event.previousReplayDigest !== previousDigest) {
      issues.push({
        code: "replay_previous_digest_mismatch",
        severity: "error",
        eventId: event.id,
        sequence: index + 1,
        expected: previousDigest,
        actual: event.previousReplayDigest,
        message: "Recovery replay event previous digest does not match the preceding ledger digest."
      });
    }

    const computedDigest = buildRecoveryDigest({
      previousDigest,
      eventId: event.id,
      eventType: event.eventType,
      checkpointId: event.checkpointId,
      source: event.source,
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      status: event.status,
      timestamp: event.timestamp,
      bootId: event.bootId,
      runId: event.runId,
      claimId: event.claimId,
      writerId: event.writerId,
      proofRef: event.proofRef,
      sizeBytes: event.sizeBytes
    });
    const digest = event.replayDigest || computedDigest;

    if (event.replayDigest && event.replayDigest !== computedDigest) {
      issues.push({
        code: "replay_digest_mismatch",
        severity: "error",
        eventId: event.id,
        sequence: index + 1,
        expected: computedDigest,
        actual: event.replayDigest,
        message: "Recovery replay event digest does not match the hosted-kernel replay payload."
      });
    }

    const entry = {
      schema: "aios.auditRecovery.recoveryCheckpoint.replayEntry.v1",
      sequence: index + 1,
      eventId: event.id,
      eventType: event.eventType,
      checkpointId: event.checkpointId,
      source: event.source,
      status: event.status,
      timestamp: event.timestamp,
      bootId: event.bootId,
      runId: event.runId,
      claimId: event.claimId,
      writerId: event.writerId,
      previousDigest,
      digest,
      computedDigest,
      digestTrusted: digest === computedDigest,
      proofRef: event.proofRef
    };
    previousDigest = digest;
    return entry;
  });
  const latestEntry = entries[entries.length - 1] || null;
  const ledgerDigest = buildRecoveryDigest({
    generatedAt: now,
    seedDigest: persistedState.replayCursor,
    latestDigest: latestEntry ? latestEntry.digest : persistedState.replayCursor || null,
    entries: entries.map((entry) => ({
      sequence: entry.sequence,
      eventId: entry.eventId,
      eventType: entry.eventType,
      digest: entry.digest
    }))
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.replayLedger.v1",
    valid: !issues.some((issue) => issue.severity === "error"),
    ledgerDigest,
    seedDigest: persistedState.replayCursor || null,
    latestDigest: latestEntry ? latestEntry.digest : persistedState.replayCursor || null,
    entryCount: entries.length,
    counters,
    bootEventCount: counters.boot,
    runEventCount: counters.run,
    claimEventCount: counters.claim,
    issues,
    entries
  };
}

function normalizeAnalyticsExportOptions(input = {}, now) {
  const source = input && typeof input === "object" ? input : {};
  const rawOptions = source.analyticsExport && typeof source.analyticsExport === "object"
    ? source.analyticsExport
    : source.reportOptions && typeof source.reportOptions === "object"
      ? source.reportOptions
      : source.reporting && typeof source.reporting === "object"
        ? source.reporting
        : {};
  const formats = normalizeStringList(rawOptions.formats || rawOptions.format)
    .filter((format) => ANALYTICS_EXPORT_FORMATS.has(format));
  const groupBy = normalizeStringList(rawOptions.groupBy || rawOptions.groupings)
    .filter((grouping) => ANALYTICS_GROUPINGS.has(grouping));
  const since = normalizeTimestamp(rawOptions.since || rawOptions.windowStart);
  const until = normalizeTimestamp(rawOptions.until || rawOptions.windowEnd) || now;
  const includeTimeline = normalizeBoolean(rawOptions.includeTimeline, true);
  const includeHistory = normalizeBoolean(rawOptions.includeHistory, true);
  const maxTimelineRows = Math.max(1, Math.min(500, normalizePositiveInteger(rawOptions.maxTimelineRows, 100)));
  const trendPeriodMinutes = Math.max(1, Math.min(10080, normalizePositiveInteger(rawOptions.trendPeriodMinutes, 1440)));

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.analyticsExportOptions.v1",
    generatedAt: now,
    requested: Boolean(source.analyticsExport || source.reportOptions || source.reporting),
    formats: formats.length ? formats : ["summary-json"],
    groupBy: groupBy.length ? groupBy : ["status", "source", "day"],
    since,
    until,
    includeTimeline,
    includeHistory,
    maxTimelineRows,
    trendPeriodMinutes
  };
}

function buildStatusCounter(events) {
  return events.reduce((counter, event) => {
    counter[event.status] = (counter[event.status] || 0) + 1;
    return counter;
  }, {
    captured: 0,
    validated: 0,
    restored: 0,
    failed: 0,
    skipped: 0
  });
}

function bucketTimestamp(timestamp, grouping) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  if (grouping === "hour") return date.toISOString().slice(0, 13) + ":00:00.000Z";
  if (grouping === "day") return date.toISOString().slice(0, 10);
  return null;
}

function buildGroupedAnalyticsRows(events, groupBy) {
  const rows = [];

  for (const grouping of groupBy) {
    const buckets = new Map();
    for (const event of events) {
      const key = grouping === "status"
        ? event.status
        : grouping === "source"
          ? event.source
          : bucketTimestamp(event.timestamp, grouping);
      if (!key) continue;
      const bucket = buckets.get(key) || {
        grouping,
        key,
        total: 0,
        restored: 0,
        failed: 0,
        exportable: 0,
        proofBacked: 0,
        sizeBytes: 0,
        durationMs: 0
      };
      bucket.total += 1;
      bucket.restored += event.status === "restored" ? 1 : 0;
      bucket.failed += event.status === "failed" ? 1 : 0;
      bucket.exportable += event.exportable ? 1 : 0;
      bucket.proofBacked += event.proofRef ? 1 : 0;
      bucket.sizeBytes += event.sizeBytes;
      bucket.durationMs += event.durationMs;
      buckets.set(key, bucket);
    }
    rows.push(...Array.from(buckets.values()).sort((left, right) => left.key.localeCompare(right.key)));
  }

  return rows.map((row) => ({
    ...row,
    recoveryRate: row.total === 0 ? 0 : Number((row.restored / row.total).toFixed(4)),
    failureRate: row.total === 0 ? 0 : Number((row.failed / row.total).toFixed(4)),
    proofCoverage: row.total === 0 ? 0 : Number((row.proofBacked / row.total).toFixed(4))
  }));
}

function buildAnalyticsExportState(events, analytics, history, timeline, exportSummary, validationSummary, options, accessScope, now) {
  const sinceMs = options.since ? Date.parse(options.since) : -Infinity;
  const untilMs = options.until ? Date.parse(options.until) : Date.parse(now);
  const scopedWindowEvents = events.filter((event) => {
    const eventMs = Date.parse(event.timestamp);
    return Number.isFinite(eventMs) && eventMs >= sinceMs && eventMs <= untilMs;
  });
  const trendEndMs = Number.isFinite(untilMs) ? untilMs : Date.parse(now);
  const periodMs = options.trendPeriodMinutes * 60 * 1000;
  const currentPeriodStartMs = trendEndMs - periodMs;
  const previousPeriodStartMs = trendEndMs - (periodMs * 2);
  const currentPeriodEvents = scopedWindowEvents.filter((event) => {
    const eventMs = Date.parse(event.timestamp);
    return eventMs > currentPeriodStartMs && eventMs <= trendEndMs;
  });
  const previousPeriodEvents = scopedWindowEvents.filter((event) => {
    const eventMs = Date.parse(event.timestamp);
    return eventMs > previousPeriodStartMs && eventMs <= currentPeriodStartMs;
  });
  const currentCounters = buildStatusCounter(currentPeriodEvents);
  const previousCounters = buildStatusCounter(previousPeriodEvents);
  const groupedRows = buildGroupedAnalyticsRows(scopedWindowEvents, options.groupBy);
  const timelineRows = options.includeTimeline
    ? timeline
        .filter((entry) => {
          const entryMs = Date.parse(entry.at);
          return Number.isFinite(entryMs) && entryMs >= sinceMs && entryMs <= untilMs;
        })
        .slice(-options.maxTimelineRows)
    : [];
  const historyRows = options.includeHistory
    ? history.snapshots.filter((snapshot) => scopedWindowEvents.some((event) => event.checkpointId === snapshot.checkpointId))
    : [];
  const exportDigest = buildRecoveryDigest({
    tenantId: accessScope.tenantId,
    workspaceId: accessScope.workspaceId,
    formats: options.formats,
    groupBy: options.groupBy,
    since: options.since,
    until: options.until,
    groupedRows,
    timelineRows,
    historyCheckpointIds: historyRows.map((row) => row.checkpointId),
    exportManifestId: exportSummary.manifest.manifestId,
    validationReady: validationSummary.valid
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.analyticsExport.v1",
    requested: options.requested,
    ready: validationSummary.valid && scopedWindowEvents.length > 0,
    blockedReason: validationSummary.valid
      ? scopedWindowEvents.length > 0 ? null : "analytics_window_empty"
      : "validation_summary_blocked",
    exportId: `${accessScope.tenantId}:${accessScope.workspaceId}:analytics:${exportDigest.slice(0, 20)}`,
    formats: options.formats,
    window: {
      since: options.since,
      until: options.until,
      eventCount: scopedWindowEvents.length,
      timelineRows: timelineRows.length,
      historySnapshots: historyRows.length
    },
    counters: {
      allScopedEvents: analytics.counters,
      windowStatusCounts: buildStatusCounter(scopedWindowEvents),
      exportableInWindow: scopedWindowEvents.filter((event) => event.exportable).length,
      proofBackedInWindow: scopedWindowEvents.filter((event) => event.proofRef).length
    },
    trend: {
      periodMinutes: options.trendPeriodMinutes,
      currentPeriod: currentCounters,
      previousPeriod: previousCounters,
      restoredDelta: currentCounters.restored - previousCounters.restored,
      failedDelta: currentCounters.failed - previousCounters.failed,
      exportableDelta: currentPeriodEvents.filter((event) => event.exportable).length
        - previousPeriodEvents.filter((event) => event.exportable).length
    },
    groupedRows,
    timelineRows,
    historyRows,
    digest: exportDigest
  };
}

function buildProofLedger(checkpoints, proofArtifacts, settings, now) {
  const artifactByProofRef = new Map();
  const artifactByCheckpointId = new Map();

  for (const artifact of proofArtifacts) {
    artifactByProofRef.set(artifact.proofRef, artifact);
    if (artifact.checkpointId) artifactByCheckpointId.set(artifact.checkpointId, artifact);
  }

  const records = checkpoints.map((checkpoint) => {
    const checkpointDigest = buildRecoveryDigest({
      checkpointId: checkpoint.checkpointId,
      source: checkpoint.source,
      tenantId: checkpoint.tenantId,
      workspaceId: checkpoint.workspaceId,
      status: checkpoint.status,
      timestamp: checkpoint.timestamp,
      proofRef: checkpoint.proofRef,
      sizeBytes: checkpoint.sizeBytes
    });
    const artifact = checkpoint.proofRef
      ? artifactByProofRef.get(checkpoint.proofRef) || artifactByCheckpointId.get(checkpoint.checkpointId) || null
      : artifactByCheckpointId.get(checkpoint.checkpointId) || null;
    const artifactValid = artifact ? artifact.digestValid !== false : false;
    const artifactDigest = artifact
      ? artifact.digest || buildRecoveryDigest({
          proofRef: artifact.proofRef,
          checkpointId: artifact.checkpointId,
          providerId: artifact.providerId,
          capturedAt: artifact.capturedAt,
          externalRef: artifact.externalRef
        })
      : null;
    const proofState = artifact
      ? !artifactValid
        ? "artifact-invalid"
        : checkpoint.proofRef ? "artifact-confirmed" : "artifact-without-checkpoint-ref"
      : checkpoint.proofRef ? "reference-only" : "missing";
    const proofIssues = artifact
      ? artifact.validationIssues.map((issue) => ({
          ...issue,
          proofRef: artifact.proofRef,
          checkpointId: checkpoint.checkpointId
        }))
      : [];

    return {
      schema: "aios.auditRecovery.recoveryCheckpoint.proofLedgerRecord.v1",
      checkpointId: checkpoint.checkpointId,
      source: checkpoint.source,
      status: checkpoint.status,
      proofRef: checkpoint.proofRef,
      proofState,
      checkpointDigest,
      artifactDigest,
      artifactProviderId: artifact ? artifact.providerId : null,
      artifactEvidenceType: artifact ? artifact.evidenceType : null,
      artifactCapturedAt: artifact ? artifact.capturedAt : null,
      artifactAlgorithm: artifact ? artifact.algorithm : null,
      artifactTrustState: artifact ? artifact.trustState : null,
      artifactDigestValid: artifact ? artifact.digestValid : null,
      proofIssues,
      exportable: checkpoint.exportable,
      auditable: proofState === "artifact-confirmed" || proofState === "reference-only"
    };
  });
  const missingProof = records.filter((record) => record.proofState === "missing");
  const referenceOnly = records.filter((record) => record.proofState === "reference-only");
  const invalidProof = records.filter((record) => record.proofState === "artifact-invalid");
  const orphanArtifacts = proofArtifacts.filter((artifact) => (
    !records.some((record) => (
      record.proofRef === artifact.proofRef || record.checkpointId === artifact.checkpointId
    ))
  ));
  const invalidOrphanArtifacts = orphanArtifacts.filter((artifact) => artifact.digestValid === false);
  const artifactIssueCounts = proofArtifacts.reduce((counts, artifact) => {
    for (const issue of artifact.validationIssues) {
      counts[issue.code] = (counts[issue.code] || 0) + 1;
    }
    return counts;
  }, {});
  const ledgerDigest = buildRecoveryDigest({
    generatedAt: now,
    proofRequired: settings.proofRequired,
    records: records.map((record) => ({
      checkpointId: record.checkpointId,
      proofRef: record.proofRef,
      proofState: record.proofState,
      checkpointDigest: record.checkpointDigest,
      artifactDigest: record.artifactDigest,
      artifactDigestValid: record.artifactDigestValid
    })),
    orphanProofRefs: orphanArtifacts.map((artifact) => artifact.proofRef).sort(),
    artifactIssueCounts
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.proofLedger.v1",
    ledgerDigest,
    proofRequired: settings.proofRequired,
    ready: !settings.proofRequired || (missingProof.length === 0 && invalidProof.length === 0 && invalidOrphanArtifacts.length === 0),
    artifactBackedCount: records.filter((record) => record.proofState === "artifact-confirmed").length,
    referenceOnlyCount: referenceOnly.length,
    missingProofCount: missingProof.length,
    invalidProofCount: invalidProof.length,
    orphanArtifactCount: orphanArtifacts.length,
    invalidOrphanArtifactCount: invalidOrphanArtifacts.length,
    artifactIssueCounts,
    records,
    orphanArtifacts: orphanArtifacts.map((artifact) => ({
      proofRef: artifact.proofRef,
      checkpointId: artifact.checkpointId,
      providerId: artifact.providerId,
      capturedAt: artifact.capturedAt,
      trustState: artifact.trustState,
      digestValid: artifact.digestValid,
      validationIssues: artifact.validationIssues
    }))
  };
}

function buildExportManifest(records, now, accessScope, proofLedger) {
  const totalSizeBytes = records.reduce((total, record) => total + record.sizeBytes, 0);
  const proofRefs = records
    .map((record) => record.proofRef)
    .filter((proofRef, index, list) => proofRef && list.indexOf(proofRef) === index);
  const exportedProofDigests = proofLedger
    ? proofLedger.records
        .filter((record) => proofRefs.includes(record.proofRef))
        .map((record) => ({
          checkpointId: record.checkpointId,
          proofRef: record.proofRef,
          checkpointDigest: record.checkpointDigest,
          artifactDigest: record.artifactDigest,
          proofState: record.proofState,
          artifactTrustState: record.artifactTrustState,
          artifactDigestValid: record.artifactDigestValid
        }))
    : [];

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.exportManifest.v1",
    generatedAt: now,
    tenantId: accessScope.tenantId,
    workspaceId: accessScope.workspaceId,
    manifestId: `${accessScope.tenantId}:${accessScope.workspaceId}:recovery-export:${records.length}:${totalSizeBytes}`,
    recordCount: records.length,
    totalSizeBytes,
    proofRefCount: proofRefs.length,
    proofRefs,
    checkpointIds: records.map((record) => record.checkpointId),
    proofLedgerDigest: proofLedger ? proofLedger.ledgerDigest : null,
    exportedProofDigests
  };
}

function buildExportSummary(events, analytics, now, lifecycle, accessScope, proofLedger) {
  const exportableEvents = lifecycle.gates.exportOnRestore
    ? events.filter((event) => event.exportable && accessScope.canExport)
    : [];
  const summary = {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.exportSummary.v1",
    ready: lifecycle.enabled && lifecycle.gates.settingsValid && exportableEvents.length > 0,
    recordCount: exportableEvents.length,
    blockedCount: events.length - exportableEvents.length,
    blockedReason: lifecycle.enabled
      ? accessScope.canExport
        ? lifecycle.gates.settingsValid ? null : "lifecycle_validation_failed"
        : "export_permission_missing"
      : lifecycle.disabledReason,
    counters: analytics.counters,
    proof: {
      required: lifecycle.gates.proofRequired,
      coverage: analytics.proofCoverage,
      backedRecords: analytics.counters.proofBacked,
      ledgerReady: proofLedger ? proofLedger.ready : null,
      invalidProofCount: proofLedger ? proofLedger.invalidProofCount : 0,
      referenceOnlyCount: proofLedger ? proofLedger.referenceOnlyCount : 0
    },
    records: exportableEvents.map((event) => ({
      checkpointId: event.checkpointId,
      source: event.source,
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      status: event.status,
      timestamp: event.timestamp,
      proofRef: event.proofRef,
      sizeBytes: event.sizeBytes
    }))
  };

  return {
    ...summary,
    manifest: buildExportManifest(summary.records, now, accessScope, proofLedger)
  };
}

function buildProviderSyncMetadata(providers, checkpoints, now) {
  const checkpointSources = new Set(checkpoints.map((event) => event.source));
  const providerStates = providers.reduce((states, provider) => {
    states[provider.state] = (states[provider.state] || 0) + 1;
    return states;
  }, {});
  const syncableProviders = providers.filter((provider) => (
    provider.endpointRef && provider.capabilities.includes("sync-metadata")
  ));

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.providerSync.v1",
    sourceCount: checkpointSources.size,
    providerStates,
    syncableProviderCount: syncableProviders.length,
    cursors: syncableProviders.map((provider) => ({
      providerId: provider.providerId,
      service: provider.service,
      endpointRef: provider.endpointRef,
      cursor: provider.syncCursor,
      checkpointSources: Array.from(checkpointSources)
    })),
    lastCheckpointAt: checkpoints.length
      ? checkpoints
          .map((event) => event.timestamp)
          .sort((left, right) => right.localeCompare(left))[0]
      : null
  };
}

function buildExternalHandoffState(providers, exportSummary, negotiation, lifecycle, accessScope, now, input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawHandoff = source.externalHandoff && typeof source.externalHandoff === "object"
    ? source.externalHandoff
    : source.handoff && typeof source.handoff === "object"
      ? source.handoff
      : {};
  const requested = normalizeBoolean(rawHandoff.requested, negotiation.granted.includes("external-handoff"));
  const targetProviderId = typeof rawHandoff.targetProviderId === "string" && rawHandoff.targetProviderId.trim()
    ? rawHandoff.targetProviderId.trim()
    : typeof rawHandoff.providerId === "string" && rawHandoff.providerId.trim()
      ? rawHandoff.providerId.trim()
      : null;
  const candidates = providers.filter((provider) => (
    provider.acceptsExternalHandoff && (!targetProviderId || provider.providerId === targetProviderId)
  ));
  const selectedProvider = candidates[0] || null;
  const blockedReasons = [];

  if (!requested) blockedReasons.push("handoff_not_requested");
  if (!accessScope.canHandoff) blockedReasons.push("handoff_permission_missing");
  if (!lifecycle.enabled) blockedReasons.push(lifecycle.disabledReason || "lifecycle_disabled");
  if (!lifecycle.gates.settingsValid) blockedReasons.push("lifecycle_validation_failed");
  if (!exportSummary.ready) blockedReasons.push(exportSummary.blockedReason || "no_exportable_checkpoint_records");
  if (requested && !selectedProvider) blockedReasons.push("no_handoff_provider_available");
  if (targetProviderId && !providers.some((provider) => provider.providerId === targetProviderId)) {
    blockedReasons.push("target_provider_unknown");
  }

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.externalHandoff.v1",
    requested,
    ready: requested && blockedReasons.length === 0,
    targetProviderId,
    selectedProviderId: selectedProvider ? selectedProvider.providerId : null,
    state: requested
      ? blockedReasons.length === 0 ? "ready" : "blocked"
      : "idle",
    blockedReasons,
    payload: selectedProvider && requested && blockedReasons.length === 0
      ? {
          providerId: selectedProvider.providerId,
          service: selectedProvider.service,
          endpointRef: selectedProvider.endpointRef,
          tenantId: selectedProvider.tenantId,
          workspaceId: selectedProvider.workspaceId,
          recordCount: exportSummary.recordCount,
          proofRequired: exportSummary.proof.required,
          proofCoverage: exportSummary.proof.coverage
        }
      : null
  };
}

function buildMailchimpExternalHandoffProjection(providers, exportSummary, externalHandoff, accessScope, now, input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const handoffInput = source.externalHandoff && typeof source.externalHandoff === "object"
    ? source.externalHandoff
    : source.handoff && typeof source.handoff === "object"
      ? source.handoff
      : {};
  const mailchimpInput = handoffInput.mailchimp && typeof handoffInput.mailchimp === "object"
    ? handoffInput.mailchimp
    : source.mailchimp && typeof source.mailchimp === "object"
      ? source.mailchimp
      : {};
  const requested = normalizeBoolean(
    mailchimpInput.requested ?? mailchimpInput.enabled,
    providers.some((provider) => provider.mailchimp.enabled)
  );
  const candidates = providers.filter((provider) => provider.mailchimp.enabled);
  const selectedProvider = candidates.find((provider) => provider.providerId === externalHandoff.selectedProviderId)
    || candidates.find((provider) => provider.mailchimp.ready)
    || candidates[0]
    || null;
  const selectedContract = selectedProvider?.mailchimp || null;
  const selectedCheckpointIds = exportSummary.records
    .filter((record) => record.exportable)
    .map((record) => record.checkpointId);
  const blockers = [];
  const warnings = [];

  if (!requested) blockers.push("mailchimp_handoff_not_requested");
  if (!accessScope.canHandoff) blockers.push("mailchimp_handoff_permission_missing");
  if (!externalHandoff.ready) blockers.push(...externalHandoff.blockedReasons.map((reason) => `external_handoff_${reason}`));
  if (!selectedProvider || !selectedContract) blockers.push("mailchimp_provider_not_configured");
  if (selectedContract && selectedContract.blockers.length > 0) blockers.push(...selectedContract.blockers);
  if (selectedContract && selectedContract.consentBoundary.requiresMarketingConsent && selectedContract.exportMode !== "preview-only") {
    warnings.push("mailchimp_marketing_consent_boundary_required");
  }
  if (selectedContract && selectedContract.consentBoundary.suppressUnsubscribed === false) {
    warnings.push("mailchimp_unsubscribed_suppression_disabled");
  }
  if (selectedContract && selectedContract.targetType === "audience" && selectedContract.exportFields.length === 0) {
    blockers.push("mailchimp_export_fields_missing");
  }

  const accepted = requested && blockers.length === 0;
  const projectionId = buildRecoveryDigest({
    schema: "aios.auditRecovery.recoveryCheckpoint.mailchimpExternalHandoffProjection.v1",
    providerId: selectedProvider?.providerId || null,
    targetType: selectedContract?.targetType || null,
    audienceId: selectedContract?.audienceId || null,
    campaignId: selectedContract?.campaignId || null,
    exportMode: selectedContract?.exportMode || null,
    selectedCheckpointIds,
    generatedAt: now
  }).slice(0, 24);

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.mailchimpExternalHandoffProjection.v1",
    projectionId: `mailchimp-handoff:${projectionId}`,
    generatedAt: now,
    requested,
    ready: accepted,
    state: !requested
      ? "not-requested"
      : accepted
        ? warnings.length > 0 ? "ready-with-warnings" : "ready"
        : "blocked",
    providerId: selectedProvider?.providerId || null,
    target: selectedContract
      ? {
          type: selectedContract.targetType,
          audienceId: selectedContract.audienceId,
          campaignId: selectedContract.campaignId,
          automationId: selectedContract.automationId,
          dataCenter: selectedContract.dataCenter
        }
      : null,
    export: {
      mode: selectedContract?.exportMode || "preview-only",
      recordCount: exportSummary.recordCount,
      selectedCheckpointIds,
      fields: selectedContract?.exportFields || MAILCHIMP_DEFAULT_EXPORT_FIELDS,
      mergeFieldMap: selectedContract?.mergeFieldMap || {},
      proofRequired: exportSummary.proof.required,
      proofCoverage: exportSummary.proof.coverage
    },
    consentBoundary: selectedContract?.consentBoundary || {
      requiresMarketingConsent: true,
      suppressUnsubscribed: true,
      doubleOptIn: false
    },
    sync: {
      cursor: selectedContract?.syncCursor || null,
      externalHandoffState: externalHandoff.state,
      selectedProviderId: externalHandoff.selectedProviderId
    },
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    nextAction: accepted
      ? "dispatch_mailchimp_handoff_manifest"
      : requested
        ? "repair_mailchimp_handoff_contract"
        : "retain_kernel_export_manifest",
    proof: {
      algorithm: "sha256",
      digest: buildRecoveryDigest({
        projectionId,
        requested,
        state: accepted ? "ready" : "blocked",
        providerId: selectedProvider?.providerId || null,
        target: selectedContract
          ? [selectedContract.targetType, selectedContract.audienceId, selectedContract.campaignId, selectedContract.automationId]
          : [],
        selectedCheckpointIds,
        blockers,
        warnings
      }),
      covers: ["provider", "mailchimp-target", "export-records", "consent-boundary", "blockers"]
    }
  };
}

function buildIntegrationProviderContracts(providers, checkpoints, proofArtifacts, capabilityNegotiation, providerSync, externalHandoff, now) {
  const latestCheckpointAt = checkpoints.length
    ? checkpoints
        .map((event) => event.timestamp)
        .sort((left, right) => right.localeCompare(left))[0]
    : null;
  const nowMs = Date.parse(now);
  const requestedCapabilities = capabilityNegotiation.requested;
  const proofRefsByProvider = proofArtifacts.reduce((index, artifact) => {
    if (!artifact.providerId) return index;
    const refs = index[artifact.providerId] || [];
    refs.push(artifact.proofRef);
    index[artifact.providerId] = refs;
    return index;
  }, {});
  const syncCursorByProvider = providerSync.cursors.reduce((index, cursor) => {
    index[cursor.providerId] = cursor;
    return index;
  }, {});
  const contracts = providers.map((provider) => {
    const providerMissing = requestedCapabilities.filter((capability) => !provider.capabilities.includes(capability));
    const requiredMissing = provider.requiredCapabilities.filter((capability) => !provider.capabilities.includes(capability));
    const syncCursor = syncCursorByProvider[provider.providerId] || null;
    const lastSyncedMs = provider.lastSyncedAt ? Date.parse(provider.lastSyncedAt) : NaN;
    const syncAgeMinutes = Number.isFinite(nowMs) && Number.isFinite(lastSyncedMs)
      ? Math.max(0, Math.round((nowMs - lastSyncedMs) / 60000))
      : null;
    const syncStale = provider.syncMode !== "none" && (
      syncAgeMinutes === null
      || syncAgeMinutes > provider.staleAfterMinutes
      || (latestCheckpointAt && provider.lastSyncedAt && latestCheckpointAt.localeCompare(provider.lastSyncedAt) > 0)
    );
    const endpointReady = provider.endpointRef !== null || provider.syncMode === "none";
    const stateReady = ["connected", "ready", "healthy", "active"].includes(provider.state);
    const handoffSelected = externalHandoff.selectedProviderId === provider.providerId;
    const blockedReasons = [];

    if (!stateReady) blockedReasons.push("provider_state_not_ready");
    if (!endpointReady) blockedReasons.push("provider_endpoint_missing");
    if (requiredMissing.length > 0) blockedReasons.push("provider_required_capability_missing");
    if (provider.requiresProofExport && !provider.capabilities.includes("export-proof")) blockedReasons.push("proof_export_capability_missing");
    if (provider.acceptsExternalHandoff && !provider.capabilities.includes("external-handoff")) blockedReasons.push("handoff_capability_missing");
    if (syncStale) blockedReasons.push("provider_sync_stale");
    if (handoffSelected && externalHandoff.ready && provider.handoffMode === "none") blockedReasons.push("handoff_mode_missing");

    const proofRefs = proofRefsByProvider[provider.providerId] || [];
    const serviceDigest = buildRecoveryDigest({
      providerId: provider.providerId,
      contractRef: provider.contractRef,
      service: provider.service,
      apiVersion: provider.apiVersion,
      endpointRef: provider.endpointRef,
      capabilities: provider.capabilities,
      syncCursor: provider.syncCursor,
      lastSyncedAt: provider.lastSyncedAt,
      proofRefs
    });

    return {
      schema: "aios.auditRecovery.recoveryCheckpoint.integrationProviderContract.v1",
      providerId: provider.providerId,
      contractRef: provider.contractRef,
      service: provider.service,
      apiVersion: provider.apiVersion,
      endpointRef: provider.endpointRef,
      state: provider.state,
      ready: blockedReasons.length === 0,
      blockedReasons,
      capabilities: {
        offered: provider.capabilities,
        requested: requestedCapabilities,
        missingFromRequested: providerMissing,
        requiredByProvider: provider.requiredCapabilities,
        missingRequired: requiredMissing
      },
      sync: {
        mode: provider.syncMode,
        cursor: provider.syncCursor,
        cursorExported: Boolean(syncCursor),
        lastSyncedAt: provider.lastSyncedAt,
        syncAgeMinutes,
        staleAfterMinutes: provider.staleAfterMinutes,
        stale: syncStale,
        latestCheckpointAt,
        checkpointSourceCount: syncCursor ? syncCursor.checkpointSources.length : 0
      },
      handoff: {
        mode: provider.handoffMode,
        acceptsExternalHandoff: provider.acceptsExternalHandoff,
        selected: handoffSelected,
        payloadReady: handoffSelected && externalHandoff.ready,
        endpointRef: provider.endpointRef
      },
      mailchimp: provider.mailchimp.enabled
        ? {
            targetType: provider.mailchimp.targetType,
            exportMode: provider.mailchimp.exportMode,
            ready: provider.mailchimp.ready,
            audienceId: provider.mailchimp.audienceId,
            campaignId: provider.mailchimp.campaignId,
            dataCenter: provider.mailchimp.dataCenter,
            requiredCapabilities: provider.mailchimp.requiredCapabilities,
            missingCapabilities: provider.mailchimp.missingCapabilities,
            blockers: provider.mailchimp.blockers,
            syncCursor: provider.mailchimp.syncCursor,
            consentBoundary: provider.mailchimp.consentBoundary
          }
        : null,
      batching: {
        maxBatchSize: provider.maxBatchSize,
        checkpointCount: checkpoints.length,
        expectedBatchCount: checkpoints.length === 0 ? 0 : Math.ceil(checkpoints.length / provider.maxBatchSize)
      },
      proofBinding: {
        requiresProofExport: provider.requiresProofExport,
        proofArtifactCount: proofRefs.length,
        proofRefs
      },
      serviceDigest
    };
  });
  const readyContracts = contracts.filter((contract) => contract.ready);
  const handoffContracts = contracts.filter((contract) => contract.handoff.acceptsExternalHandoff);

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.integrationProviderContracts.v1",
    ready: contracts.length > 0 && readyContracts.length === contracts.length,
    contractCount: contracts.length,
    readyContractCount: readyContracts.length,
    blockedContractCount: contracts.length - readyContracts.length,
    handoffContractCount: handoffContracts.length,
    selectedHandoffProviderId: externalHandoff.selectedProviderId,
    syncWatermark: {
      latestCheckpointAt,
      syncableProviderCount: providerSync.syncableProviderCount,
      staleProviderIds: contracts
        .filter((contract) => contract.sync.stale)
        .map((contract) => contract.providerId)
    },
    contracts,
    digest: buildRecoveryDigest({
      generatedAt: now,
      providerIds: contracts.map((contract) => contract.providerId),
      serviceDigests: contracts.map((contract) => contract.serviceDigest),
      selectedHandoffProviderId: externalHandoff.selectedProviderId
    })
  };
}

function normalizeClientRuntimeContext(input = {}, accessScope, now) {
  const source = input && typeof input === "object" ? input : {};
  const rawClient = source.clientRuntime && typeof source.clientRuntime === "object"
    ? source.clientRuntime
    : source.client && typeof source.client === "object"
      ? source.client
      : {};
  const rawRequest = source.request && typeof source.request === "object" ? source.request : {};
  const readString = (...values) => {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  const clientId = readString(rawClient.clientId, rawClient.id, source.clientId) || "hosted-kernel-client";
  const sessionId = readString(rawClient.sessionId, rawRequest.sessionId, source.sessionId);
  const requestId = readString(rawRequest.requestId, rawRequest.id, source.requestId)
    || buildRecoveryDigest({
      surfaceId,
      tenantId: accessScope.tenantId,
      workspaceId: accessScope.workspaceId,
      clientId,
      sessionId,
      generatedAt: now
    }).slice(0, 24);
  const route = readString(rawRequest.route, rawClient.route, source.route) || `/${surfaceGroup}/${surfaceName}`;
  const workflowId = readString(rawRequest.workflowId, rawClient.workflowId, source.workflowId)
    || `${accessScope.tenantId}:${accessScope.workspaceId}:${surfaceName}`;
  const requestedAction = normalizeClientRouteAction(
    readString(rawRequest.routeAction, rawRequest.action, rawClient.routeAction, rawClient.action, source.routeAction, source.action),
    "inspect-recovery-checkpoint"
  );
  const rawPendingMutations = Array.isArray(rawClient.pendingMutations)
    ? rawClient.pendingMutations
    : Array.isArray(rawRequest.pendingMutations)
      ? rawRequest.pendingMutations
      : Array.isArray(source.pendingMutations)
        ? source.pendingMutations
        : [];
  const pendingMutations = rawPendingMutations
    .filter((mutation) => mutation && typeof mutation === "object")
    .slice(0, MAX_CLIENT_PENDING_MUTATIONS)
    .map((mutation, index) => {
      const checkpointId = readString(mutation.checkpointId, mutation.checkpoint, mutation.targetCheckpointId);
      const mutationId = readString(mutation.id, mutation.mutationId, mutation.key)
        || `client-mutation-${index + 1}`;
      const durable = normalizeBoolean(mutation.durable ?? mutation.persisted ?? mutation.flushed, false);
      const blocking = normalizeBoolean(mutation.blocking ?? mutation.requiresFlush, !durable);
      return {
        mutationId,
        checkpointId,
        kind: readString(mutation.kind, mutation.type) || "runtime-state",
        durable,
        blocking,
        reason: readString(mutation.reason, mutation.reasonCode),
        stateRef: readString(mutation.stateRef, mutation.cursor, mutation.ref)
      };
    });
  const rawAcknowledgements = normalizeStringList(
    rawClient.acknowledgements
      || rawClient.acknowledgedRiskCodes
      || rawRequest.acknowledgements
      || source.acknowledgements
  ).slice(0, MAX_CLIENT_ACKNOWLEDGEMENTS);
  const rawRequiredAcknowledgements = normalizeStringList(
    rawClient.requiredAcknowledgements
      || rawClient.requiredAcknowledgementIds
      || rawRequest.requiredAcknowledgements
      || source.requiredAcknowledgements
  ).slice(0, MAX_CLIENT_ACKNOWLEDGEMENTS);
  const acknowledgedSet = new Set(rawAcknowledgements);
  const missingAcknowledgements = rawRequiredAcknowledgements.filter((id) => !acknowledgedSet.has(id));
  const unflushedBlockingMutations = pendingMutations.filter((mutation) => mutation.blocking && !mutation.durable);
  const clientReleaseBlockers = [
    normalizeBoolean(rawClient.offline ?? rawRequest.offline ?? source.offline, false) ? "client_runtime_offline" : "",
    unflushedBlockingMutations.length > 0 ? "client_runtime_pending_mutations" : "",
    missingAcknowledgements.length > 0 ? "client_runtime_acknowledgement_required" : ""
  ].filter(Boolean);
  const method = (readString(rawRequest.method, rawClient.method, source.method) || "GET").toUpperCase();
  const requestFingerprint = buildRecoveryDigest({
    surfaceId,
    tenantId: accessScope.tenantId,
    workspaceId: accessScope.workspaceId,
    clientId,
    sessionId,
    workflowId,
    route,
    requestedAction,
    method,
    idempotencyKey: readString(rawRequest.idempotencyKey, rawClient.idempotencyKey, source.idempotencyKey),
    pendingMutationIds: pendingMutations.map((mutation) => mutation.mutationId),
    missingAcknowledgements
  });

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.clientRuntime.v1",
    generatedAt: now,
    clientId,
    sessionId,
    requestId,
    workflowId,
    route,
    requestedAction,
    method,
    requestFingerprint,
    locale: readString(rawClient.locale, rawRequest.locale, source.locale),
    timezone: readString(rawClient.timezone, rawRequest.timezone, source.timezone),
    correlationId: readString(rawRequest.correlationId, rawClient.correlationId, source.correlationId) || requestId,
    idempotencyKey: readString(rawRequest.idempotencyKey, rawClient.idempotencyKey, source.idempotencyKey),
    userVisible: normalizeBoolean(rawClient.userVisible ?? rawRequest.userVisible ?? source.userVisible, true),
    offline: normalizeBoolean(rawClient.offline ?? rawRequest.offline ?? source.offline, false),
    pendingMutations,
    acknowledgements: {
      accepted: rawAcknowledgements,
      required: rawRequiredAcknowledgements,
      missing: missingAcknowledgements
    },
    releaseState: {
      releasable: clientReleaseBlockers.length === 0,
      blockerCodes: clientReleaseBlockers,
      unflushedMutationIds: unflushedBlockingMutations.map((mutation) => mutation.mutationId),
      nextAction: clientReleaseBlockers.includes("client_runtime_pending_mutations")
        ? "flush-client-runtime-state"
        : clientReleaseBlockers.includes("client_runtime_acknowledgement_required")
          ? "collect-client-acknowledgement"
          : clientReleaseBlockers.includes("client_runtime_offline")
            ? "restore-client-runtime-session"
            : "release-client-workflow"
    }
  };
}

function buildOperationAuthorization(input, accessScope, clientRuntime, checkpoints, providers, externalHandoff, now) {
  const source = input && typeof input === "object" ? input : {};
  const rawOperation = source.operation && typeof source.operation === "object"
    ? source.operation
    : source.operationRequest && typeof source.operationRequest === "object"
      ? source.operationRequest
      : {};
  const rawTarget = rawOperation.target && typeof rawOperation.target === "object"
    ? rawOperation.target
    : source.target && typeof source.target === "object"
      ? source.target
      : {};
  const readString = (...values) => {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  const requestedAction = normalizeClientRouteAction(
    readString(rawOperation.action, rawOperation.routeAction, rawTarget.action),
    clientRuntime.requestedAction
  );
  const requiredPermissions = ROUTE_ACTION_PERMISSION_REQUIREMENTS[requestedAction] || ["read"];
  const targetTenantId = readString(rawTarget.tenantId, rawTarget.tenant, rawOperation.tenantId, rawOperation.tenant)
    || accessScope.tenantId;
  const targetWorkspaceId = readString(rawTarget.workspaceId, rawTarget.workspace, rawOperation.workspaceId, rawOperation.workspace)
    || accessScope.workspaceId;
  const checkpointIds = normalizeStringList(
    rawTarget.checkpointIds
      || rawOperation.checkpointIds
      || rawTarget.checkpointId
      || rawOperation.checkpointId
  );
  const providerId = readString(
    rawTarget.providerId,
    rawOperation.providerId,
    rawTarget.handoffProviderId,
    rawOperation.handoffProviderId
  ) || externalHandoff.selectedProviderId;
  const actorId = readString(
    rawOperation.actorId,
    rawOperation.userId,
    source.actorId,
    source.userId,
    clientRuntime.clientId
  );
  const checkpointIdSet = new Set(checkpoints.map((checkpoint) => checkpoint.checkpointId));
  const providerIdSet = new Set(providers.map((provider) => provider.providerId));
  const knownCheckpointIds = checkpointIds.filter((checkpointId) => checkpointIdSet.has(checkpointId));
  const unknownCheckpointIds = checkpointIds.filter((checkpointId) => !checkpointIdSet.has(checkpointId));
  const missingPermissions = requiredPermissions.filter((permission) => (
    !accessScope.permissions.includes(permission) && !accessScope.permissions.includes("admin")
  ));
  const blockedReasons = [];

  if (targetTenantId !== accessScope.tenantId) blockedReasons.push("operation_tenant_scope_mismatch");
  if (targetWorkspaceId !== accessScope.workspaceId) blockedReasons.push("operation_workspace_scope_mismatch");
  for (const permission of missingPermissions) {
    blockedReasons.push(`${permission}_permission_missing`);
  }
  if (unknownCheckpointIds.length > 0) blockedReasons.push("operation_checkpoint_target_unknown");
  if (providerId && !providerIdSet.has(providerId)) blockedReasons.push("operation_provider_target_unknown");
  if (requestedAction === "handoff-export-manifest" && !externalHandoff.ready) {
    blockedReasons.push("operation_handoff_not_ready");
  }
  if (requestedAction === "dispatch-recovery-checkpoint" && checkpointIds.length > 0 && knownCheckpointIds.length === 0) {
    blockedReasons.push("operation_dispatch_target_empty");
  }

  const authorizationDigest = buildRecoveryDigest({
    requestedAction,
    tenantId: accessScope.tenantId,
    workspaceId: accessScope.workspaceId,
    targetTenantId,
    targetWorkspaceId,
    requiredPermissions,
    grantedPermissions: accessScope.permissions,
    checkpointIds,
    providerId,
    requestFingerprint: clientRuntime.requestFingerprint
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.operationAuthorization.v1",
    requestedAction,
    authorized: blockedReasons.length === 0,
    blockedReasons: Array.from(new Set(blockedReasons)),
    authorizationDigest,
    actor: {
      actorId,
      clientId: clientRuntime.clientId,
      sessionId: clientRuntime.sessionId,
      roles: accessScope.roles,
      permissions: accessScope.permissions
    },
    requiredPermissions,
    missingPermissions,
    target: {
      tenantId: targetTenantId,
      workspaceId: targetWorkspaceId,
      tenantMatched: targetTenantId === accessScope.tenantId,
      workspaceMatched: targetWorkspaceId === accessScope.workspaceId,
      checkpointIds,
      knownCheckpointIds,
      unknownCheckpointIds,
      providerId,
      providerKnown: providerId ? providerIdSet.has(providerId) : null
    },
    handoffReady: externalHandoff.ready,
    audit: {
      schema: "aios.auditRecovery.recoveryCheckpoint.operationAuthorizationAudit.v1",
      generatedAt: now,
      requestId: clientRuntime.requestId,
      workflowId: clientRuntime.workflowId,
      scopedCheckpointCount: checkpoints.length,
      scopedProviderCount: providers.length,
      blockedReasonCount: blockedReasons.length,
      safeBoundary: targetTenantId === accessScope.tenantId && targetWorkspaceId === accessScope.workspaceId,
      authorizationDigest
    }
  };
}

function buildClientWorkflowHandoff(runtime, lifecycle, validationSummary, previewAcceptance, externalHandoff, exportSummary, providerSync, now, mailchimpRuntimeGate = null) {
  const blockingReasons = Array.from(new Set([
    ...validationSummary.blockingCodes,
    ...previewAcceptance.acceptance.blockedReasons,
    ...externalHandoff.blockedReasons,
    ...(mailchimpRuntimeGate?.requested && !mailchimpRuntimeGate.ready ? mailchimpRuntimeGate.blockers : []),
    ...runtime.releaseState.blockerCodes
  ].filter(Boolean)));
  let requiredAction = lifecycle.nextAction.action;

  if (blockingReasons.length > 0) {
    if (mailchimpRuntimeGate?.requested && !mailchimpRuntimeGate.ready) {
      requiredAction = normalizeClientRouteAction(mailchimpRuntimeGate.nextAction, "resolve-recovery-blockers");
    } else if (runtime.releaseState.blockerCodes.includes("client_runtime_pending_mutations")) {
      requiredAction = "persist-and-dispatch-command";
    } else if (runtime.releaseState.blockerCodes.includes("client_runtime_acknowledgement_required")) {
      requiredAction = "collect-preview-acceptance";
    } else if (runtime.releaseState.blockerCodes.includes("client_runtime_offline")) {
      requiredAction = "resolve-recovery-blockers";
    } else if (previewAcceptance.acceptance.blockedReasons.includes("operator_acceptance_required")) {
      requiredAction = "collect-preview-acceptance";
    } else {
      requiredAction = "resolve-recovery-blockers";
    }
  } else if (externalHandoff.ready) {
    requiredAction = "handoff-export-manifest";
  } else if (lifecycle.schedule.due) {
    requiredAction = "run-checkpoint-cycle";
  } else if (lifecycle.schedule.active) {
    requiredAction = "wait-for-schedule";
  }
  const resumeToken = buildRecoveryDigest({
    requestId: runtime.requestId,
    workflowId: runtime.workflowId,
    lifecycleAction: lifecycle.nextAction.action,
    exportManifestId: exportSummary.manifest.manifestId,
    externalHandoffState: externalHandoff.state,
    previewAccepted: previewAcceptance.acceptance.accepted,
    providerCursorCount: providerSync.cursors.length
  });
  const state = blockingReasons.length > 0
    ? "blocked"
    : externalHandoff.ready
      ? "handoff-ready"
      : lifecycle.schedule.due
        ? "run-ready"
        : lifecycle.schedule.active
          ? "scheduled"
          : "interactive";

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.clientWorkflowHandoff.v1",
    state,
    ready: blockingReasons.length === 0,
    userVisible: runtime.userVisible,
    request: {
      clientId: runtime.clientId,
      sessionId: runtime.sessionId,
      requestId: runtime.requestId,
      workflowId: runtime.workflowId,
      route: runtime.route,
      correlationId: runtime.correlationId,
      idempotencyKey: runtime.idempotencyKey
    },
    resume: {
      token: resumeToken,
      cursorCount: providerSync.cursors.length,
      nextRunAt: lifecycle.schedule.nextRunAt,
      manifestId: exportSummary.manifest.manifestId,
      selectedProviderId: externalHandoff.selectedProviderId
    },
    requiredAction,
    displayState: {
      title: "Recovery checkpoint",
      primaryStatus: state,
      primaryBlockedReason: blockingReasons[0] || null,
      recordCount: exportSummary.recordCount,
      previewSelectedCount: previewAcceptance.preview.selectedCount,
      handoffProviderId: externalHandoff.selectedProviderId,
      mailchimpState: mailchimpRuntimeGate?.state || "not-requested",
      mailchimpProviderId: mailchimpRuntimeGate?.providerId || null,
      mailchimpTargetType: mailchimpRuntimeGate?.target?.type || null,
      offlineMode: runtime.offline,
      clientReleaseState: runtime.releaseState.releasable ? "released" : "held",
      unflushedMutationCount: runtime.releaseState.unflushedMutationIds.length,
      missingAcknowledgementCount: runtime.acknowledgements.missing.length
    },
    mailchimpRuntimeGate: mailchimpRuntimeGate
      ? {
          schema: mailchimpRuntimeGate.schema,
          requested: mailchimpRuntimeGate.requested,
          ready: mailchimpRuntimeGate.ready,
          state: mailchimpRuntimeGate.state,
          nextAction: mailchimpRuntimeGate.nextAction,
          providerId: mailchimpRuntimeGate.providerId,
          projectionId: mailchimpRuntimeGate.projectionId,
          checkpointIds: mailchimpRuntimeGate.checkpointIds,
          blockers: mailchimpRuntimeGate.blockers,
          warnings: mailchimpRuntimeGate.warnings,
          proofDigest: mailchimpRuntimeGate.proof.digest
        }
      : null,
    runtimeRelease: {
      releasable: runtime.releaseState.releasable,
      nextAction: runtime.releaseState.nextAction,
      blockerCodes: runtime.releaseState.blockerCodes,
      pendingMutations: runtime.pendingMutations,
      acknowledgements: runtime.acknowledgements
    },
    audit: {
      schema: "aios.auditRecovery.recoveryCheckpoint.clientWorkflowHandoffAudit.v1",
      generatedAt: now,
      deterministicToken: resumeToken,
      blockingReasonCount: blockingReasons.length,
      blockingReasons,
      acceptedPreview: previewAcceptance.acceptance.accepted,
      externalHandoffReady: externalHandoff.ready,
      mailchimpRuntimeState: mailchimpRuntimeGate?.state || "not-requested",
      mailchimpRuntimeReady: mailchimpRuntimeGate?.ready || false,
      clientRuntimeReleasable: runtime.releaseState.releasable
    }
  };
}

function buildValidationSummary(
  lifecycleValidation,
  permissionValidation,
  capabilityNegotiation,
  exportSummary,
  externalHandoff,
  boundaryAudit,
  proofLedger,
  proofArtifactAudit,
  operationAuthorization,
  replayLedger,
  resumeGuard
) {
  const blockingCodes = [];
  const warningCodes = [];

  for (const issue of lifecycleValidation.issues) {
    if (issue.severity === "error") {
      blockingCodes.push(issue.code);
    } else {
      warningCodes.push(issue.code);
    }
  }
  for (const issue of permissionValidation.issues) {
    if (!blockingCodes.includes(issue.code)) blockingCodes.push(issue.code);
  }
  for (const capability of capabilityNegotiation.missing) {
    blockingCodes.push(`missing_capability:${capability}`);
  }
  if (!exportSummary.ready) {
    blockingCodes.push(exportSummary.blockedReason || "no_exportable_checkpoint_records");
  }
  if (!boundaryAudit.safeBoundary) {
    if (!boundaryAudit.permissions.includes("read")) blockingCodes.push("read_permission_missing");
    if (boundaryAudit.excludedCheckpointCount > 0) blockingCodes.push("checkpoint_boundary_exclusions_present");
    if (boundaryAudit.excludedProviderCount > 0) blockingCodes.push("provider_boundary_exclusions_present");
  }
  if (proofLedger.proofRequired && proofLedger.missingProofCount > 0) {
    blockingCodes.push("checkpoint_proof_ledger_incomplete");
  }
  if (proofLedger.proofRequired && proofLedger.invalidProofCount > 0) {
    blockingCodes.push("checkpoint_proof_artifact_invalid");
  }
  if (proofLedger.proofRequired && proofLedger.invalidOrphanArtifactCount > 0) {
    blockingCodes.push("orphan_proof_artifact_invalid");
  }
  if (proofArtifactAudit.excludedProofArtifactCount > 0) {
    blockingCodes.push("proof_artifact_boundary_exclusions_present");
  }
  if (proofArtifactAudit.invalidScopedProofArtifactCount > 0 && !blockingCodes.includes("proof_artifact_digest_invalid")) {
    blockingCodes.push("proof_artifact_digest_invalid");
  }
  if (proofLedger.referenceOnlyCount > 0) {
    warningCodes.push("proof_artifacts_reference_only");
  }
  if (proofLedger.orphanArtifactCount > 0) {
    warningCodes.push("orphan_proof_artifacts_present");
  }
  for (const [issueCode, issueCount] of Object.entries(proofLedger.artifactIssueCounts)) {
    const targetCodes = issueCode.endsWith("_ignored") ? warningCodes : blockingCodes;
    if (issueCount > 0 && !targetCodes.includes(issueCode)) targetCodes.push(issueCode);
  }
  for (const reason of operationAuthorization.blockedReasons) {
    if (!blockingCodes.includes(reason)) blockingCodes.push(reason);
  }
  for (const issue of replayLedger.issues) {
    if (issue.severity === "error" && !blockingCodes.includes(issue.code)) {
      blockingCodes.push(issue.code);
    } else if (issue.severity !== "error" && !warningCodes.includes(issue.code)) {
      warningCodes.push(issue.code);
    }
  }
  for (const reason of externalHandoff.blockedReasons) {
    if (externalHandoff.requested && !blockingCodes.includes(reason)) {
      blockingCodes.push(reason);
    }
  }
  for (const reason of resumeGuard.blockers) {
    if (!blockingCodes.includes(reason)) blockingCodes.push(reason);
  }
  for (const reason of resumeGuard.warnings) {
    if (!warningCodes.includes(reason)) warningCodes.push(reason);
  }

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.validationSummary.v1",
    valid: blockingCodes.length === 0,
    blockingCodes,
    warningCodes,
    lifecycleIssueCount: lifecycleValidation.issueCount,
    permissionIssueCount: permissionValidation.issueCount,
    missingCapabilities: capabilityNegotiation.missing,
    exportReady: exportSummary.ready,
    handoffReady: externalHandoff.ready,
    boundaryReady: boundaryAudit.safeBoundary && proofArtifactAudit.safeBoundary,
    operationAuthorized: operationAuthorization.authorized,
    requestedAction: operationAuthorization.requestedAction,
    operationAuthorizationDigest: operationAuthorization.authorizationDigest,
    proofLedgerReady: proofLedger.ready,
    proofLedgerDigest: proofLedger.ledgerDigest,
    proofLedgerInvalidProofCount: proofLedger.invalidProofCount,
    proofLedgerInvalidOrphanArtifactCount: proofLedger.invalidOrphanArtifactCount,
    proofArtifactIssueCounts: proofLedger.artifactIssueCounts,
    replayLedgerReady: replayLedger.valid,
    replayLedgerDigest: replayLedger.ledgerDigest,
    replayLatestDigest: replayLedger.latestDigest,
    resumeGuardReady: resumeGuard.ready,
    resumeGuardState: resumeGuard.state,
    resumeGuardDigest: resumeGuard.proof.digest
  };
}

function buildRecoveryPreviewContract(checkpoints, lifecycle, exportSummary, providerContracts, validationSummary, now, input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawAcceptance = source.acceptance && typeof source.acceptance === "object"
    ? source.acceptance
    : source.previewAcceptance && typeof source.previewAcceptance === "object"
      ? source.previewAcceptance
      : {};
  const acceptedBy = typeof rawAcceptance.acceptedBy === "string" && rawAcceptance.acceptedBy.trim()
    ? rawAcceptance.acceptedBy.trim()
    : null;
  const acceptedAt = typeof rawAcceptance.acceptedAt === "string" && rawAcceptance.acceptedAt.trim()
    ? rawAcceptance.acceptedAt.trim()
    : acceptedBy ? now : null;
  const acceptedCheckpointIds = Array.isArray(rawAcceptance.checkpointIds)
    ? rawAcceptance.checkpointIds
        .filter((checkpointId) => typeof checkpointId === "string" && checkpointId.trim())
        .map((checkpointId) => checkpointId.trim())
    : [];
  const acceptedCheckpointSet = new Set(acceptedCheckpointIds);
  const validPreviewIds = new Set(exportSummary.records.map((record) => record.checkpointId));
  const unknownAcceptedCheckpointIds = acceptedCheckpointIds.filter((checkpointId) => !validPreviewIds.has(checkpointId));
  const previewRecords = exportSummary.records.map((record) => {
    const event = checkpoints.find((checkpoint) => checkpoint.checkpointId === record.checkpointId);
    const selected = acceptedCheckpointIds.length === 0 || acceptedCheckpointSet.has(record.checkpointId);
    const rowIssues = [];
    if (!record.proofRef && lifecycle.gates.proofRequired) rowIssues.push("proof_required_missing");
    if (!record.proofRef) rowIssues.push("proof_preview_reference_missing");
    if (event && event.status === "failed") rowIssues.push("failed_checkpoint_not_restorable");
    if (event && event.status === "skipped") rowIssues.push("skipped_checkpoint_not_restorable");
    return {
      checkpointId: record.checkpointId,
      source: record.source,
      status: record.status,
      timestamp: record.timestamp,
      proofRef: record.proofRef,
      sizeBytes: record.sizeBytes,
      selected,
      selectable: rowIssues.length === 0 || rowIssues.every((issue) => issue === "proof_preview_reference_missing"),
      restoreImpact: event && event.status === "restored" ? "already-restored" : "ready-to-restore",
      proofState: record.proofRef ? "proof-attached" : "proof-missing",
      validationState: rowIssues.length === 0 ? "ready" : "needs-attention",
      rowIssues
    };
  });
  const selectedRecords = previewRecords.filter((record) => record.selected);
  const requiresAcceptance = selectedRecords.length > 0 && lifecycle.enabled;
  const acceptanceBlockedReasons = [];

  if (!lifecycle.enabled) acceptanceBlockedReasons.push(lifecycle.disabledReason || "lifecycle_disabled");
  if (!validationSummary.valid) acceptanceBlockedReasons.push(...validationSummary.blockingCodes);
  if (requiresAcceptance && !acceptedBy) acceptanceBlockedReasons.push("operator_acceptance_required");
  if (unknownAcceptedCheckpointIds.length > 0) {
    acceptanceBlockedReasons.push("accepted_checkpoint_not_in_preview");
  }
  if (selectedRecords.length === 0 && exportSummary.recordCount > 0) acceptanceBlockedReasons.push("no_preview_records_selected");

  const uniqueAcceptanceBlockedReasons = Array.from(new Set(acceptanceBlockedReasons));
  const accepted = requiresAcceptance && acceptedBy !== null && uniqueAcceptanceBlockedReasons.length === 0;
  const proofCoverage = previewRecords.length === 0
    ? 0
    : Number((previewRecords.filter((record) => record.proofRef).length / previewRecords.length).toFixed(4));
  const selectedSizeBytes = selectedRecords.reduce((total, record) => total + record.sizeBytes, 0);
  const acceptanceDigest = buildRecoveryDigest({
    surfaceId,
    generatedAt: now,
    accepted,
    acceptedBy,
    acceptedAt,
    selectedCheckpointIds: selectedRecords.map((record) => record.checkpointId).sort(),
    validationBlockingCodes: validationSummary.blockingCodes,
    exportManifestId: exportSummary.manifest.manifestId
  });
  const routeActions = [
    {
      action: "preview-recovery-checkpoints",
      label: "Review checkpoint preview",
      enabled: previewRecords.length > 0,
      reason: previewRecords.length > 0 ? "preview_records_available" : "no_exportable_checkpoint_records"
    },
    {
      action: "accept-recovery-preview",
      label: "Accept selected checkpoints",
      enabled: requiresAcceptance && acceptedBy === null && uniqueAcceptanceBlockedReasons.every((reason) => reason === "operator_acceptance_required"),
      reason: requiresAcceptance ? "operator_acceptance_required" : "acceptance_not_required"
    },
    {
      action: "dispatch-recovery-checkpoint",
      label: "Run recovery checkpoint",
      enabled: accepted || (!requiresAcceptance && validationSummary.valid && lifecycle.enabled),
      reason: accepted ? "operator_acceptance_verified" : validationSummary.valid ? "acceptance_not_required" : "validation_blocked"
    }
  ];

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.previewAcceptance.v1",
    preview: {
      recordCount: previewRecords.length,
      selectedCount: selectedRecords.length,
      providerCount: providerContracts.length,
      selectedSizeBytes,
      proofCoverage,
      manifestId: exportSummary.manifest.manifestId,
      unknownAcceptedCheckpointIds,
      records: previewRecords
    },
    acceptance: {
      required: requiresAcceptance,
      accepted,
      acceptedBy,
      acceptedAt,
      acceptedCheckpointIds,
      blockedReasons: uniqueAcceptanceBlockedReasons,
      acceptanceDigest,
      proof: {
        schema: "aios.auditRecovery.recoveryCheckpoint.acceptanceProof.v1",
        digest: acceptanceDigest,
        checkpointCount: selectedRecords.length,
        manifestId: exportSummary.manifest.manifestId,
        validationDigest: buildRecoveryDigest({
          blockingCodes: validationSummary.blockingCodes,
          warningCodes: validationSummary.warningCodes,
          proofLedgerDigest: validationSummary.proofLedgerDigest
        })
      }
    },
    readiness: {
      ready: lifecycle.enabled && validationSummary.valid && (!requiresAcceptance || accepted),
      lifecycleReady: lifecycle.enabled && lifecycle.gates.settingsValid,
      validationReady: validationSummary.valid,
      exportReady: exportSummary.ready,
      previewReady: previewRecords.length > 0 && selectedRecords.length > 0,
      acceptanceReady: !requiresAcceptance || accepted,
      routeDispatchReady: lifecycle.enabled && validationSummary.valid && exportSummary.ready && (!requiresAcceptance || accepted),
      blockedReasons: uniqueAcceptanceBlockedReasons,
      nextAction: lifecycle.nextAction.action
    },
    validation: {
      schema: "aios.auditRecovery.recoveryCheckpoint.previewValidationSummary.v1",
      valid: validationSummary.valid,
      blockingCodes: validationSummary.blockingCodes,
      warningCodes: validationSummary.warningCodes,
      proofLedgerReady: validationSummary.proofLedgerReady,
      boundaryReady: validationSummary.boundaryReady,
      missingCapabilities: validationSummary.missingCapabilities
    },
    routeActions,
    display: {
      title: "Recovery checkpoint preview",
      state: accepted
        ? "accepted"
        : uniqueAcceptanceBlockedReasons.length > 0
          ? "blocked"
          : requiresAcceptance
            ? "awaiting-acceptance"
            : "ready",
      primaryReason: uniqueAcceptanceBlockedReasons[0] || "preview_ready",
      primaryAction: routeActions.find((action) => action.enabled)?.action || "inspect-recovery-checkpoint"
    }
  };
}

function buildPreviewAcceptanceExportManifest(previewAcceptance, analyticsExport, exportSummary, validationSummary, accessScope, now) {
  const selectedRecords = previewAcceptance.preview.records
    .filter((record) => record.selected)
    .slice(0, MAX_ACCEPTANCE_EXPORT_RECORDS);
  const blockingReasons = [
    ...previewAcceptance.acceptance.blockedReasons,
    ...(analyticsExport.ready ? [] : [analyticsExport.blockedReason || "analytics_export_not_ready"]),
    ...(exportSummary.ready ? [] : [exportSummary.blockedReason || "export_summary_not_ready"])
  ].filter(Boolean);
  const selectedStatusCounts = selectedRecords.reduce((counts, record) => {
    counts[record.status] = (counts[record.status] || 0) + 1;
    return counts;
  }, {
    captured: 0,
    validated: 0,
    restored: 0,
    failed: 0,
    skipped: 0
  });
  const selectedProofCoverage = selectedRecords.length === 0
    ? 0
    : Number((selectedRecords.filter((record) => record.proofRef).length / selectedRecords.length).toFixed(4));
  const dispatchable = previewAcceptance.readiness.routeDispatchReady
    && analyticsExport.ready
    && blockingReasons.length === 0;
  const manifestDigest = buildRecoveryDigest({
    schema: "aios.auditRecovery.recoveryCheckpoint.previewAcceptanceExportManifest.v1",
    tenantId: accessScope.tenantId,
    workspaceId: accessScope.workspaceId,
    generatedAt: now,
    accepted: previewAcceptance.acceptance.accepted,
    acceptanceDigest: previewAcceptance.acceptance.acceptanceDigest,
    analyticsExportId: analyticsExport.exportId,
    analyticsExportDigest: analyticsExport.digest,
    exportManifestId: exportSummary.manifest.manifestId,
    validationBlockingCodes: validationSummary.blockingCodes,
    selectedCheckpointIds: selectedRecords.map((record) => record.checkpointId).sort(),
    selectedStatusCounts,
    selectedProofCoverage,
    blockingReasons
  });
  const exportRows = selectedRecords.map((record, index) => ({
    row: index + 1,
    checkpointId: record.checkpointId,
    source: record.source,
    status: record.status,
    timestamp: record.timestamp,
    proofRef: record.proofRef,
    selected: record.selected,
    selectable: record.selectable,
    restoreImpact: record.restoreImpact,
    validationState: record.validationState,
    rowIssues: record.rowIssues,
    exportManifestId: exportSummary.manifest.manifestId,
    analyticsExportId: analyticsExport.exportId
  }));

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.previewAcceptanceExportManifest.v1",
    manifestId: `${accessScope.tenantId}:${accessScope.workspaceId}:preview-acceptance:${manifestDigest.slice(0, 20)}`,
    state: dispatchable
      ? "ready"
      : previewAcceptance.acceptance.accepted
        ? "accepted-blocked"
        : previewAcceptance.acceptance.required
          ? "awaiting-acceptance"
          : "blocked",
    ready: dispatchable,
    dispatchable,
    tenantId: accessScope.tenantId,
    workspaceId: accessScope.workspaceId,
    selectedCheckpointCount: selectedRecords.length,
    selectedStatusCounts,
    selectedProofCoverage,
    truncated: previewAcceptance.preview.records.filter((record) => record.selected).length > selectedRecords.length,
    blockingReasons: Array.from(new Set(blockingReasons)),
    validation: {
      valid: validationSummary.valid,
      blockingCodes: validationSummary.blockingCodes,
      warningCodes: validationSummary.warningCodes,
      proofLedgerReady: validationSummary.proofLedgerReady,
      boundaryReady: validationSummary.boundaryReady
    },
    analytics: {
      exportId: analyticsExport.exportId,
      digest: analyticsExport.digest,
      ready: analyticsExport.ready,
      formats: analyticsExport.formats,
      window: analyticsExport.window,
      groupedRowCount: analyticsExport.groupedRows.length,
      timelineRowCount: analyticsExport.timelineRows.length,
      restoredTrendDelta: analyticsExport.trend.restoredDelta,
      failedTrendDelta: analyticsExport.trend.failedDelta
    },
    exportSummary: {
      manifestId: exportSummary.manifest.manifestId,
      ready: exportSummary.ready,
      recordCount: exportSummary.recordCount,
      blockedReason: exportSummary.blockedReason || null
    },
    routeHandoff: {
      routeAction: dispatchable
        ? "dispatch-recovery-checkpoint"
        : previewAcceptance.acceptance.required && !previewAcceptance.acceptance.accepted
          ? "accept-recovery-preview"
          : "resolve-recovery-blockers",
      continuationAction: dispatchable ? "dispatch" : "review",
      acceptedBy: previewAcceptance.acceptance.acceptedBy,
      acceptedAt: previewAcceptance.acceptance.acceptedAt,
      acceptanceDigest: previewAcceptance.acceptance.acceptanceDigest
    },
    rows: exportRows,
    proof: {
      algorithm: "sha256",
      digest: manifestDigest,
      covers: ["acceptance", "analyticsExport", "exportSummary", "validation", "selectedCheckpointIds"]
    }
  };
}

function buildPreviewResumeTokenHandoff(previewAcceptance, previewAcceptanceExportManifest, clientRuntime, accessScope, externalHandoff, mailchimpHandoff, now) {
  const selectedCheckpointIds = previewAcceptanceExportManifest.rows.map((row) => row.checkpointId);
  const primaryCheckpointId = selectedCheckpointIds[0] || null;
  const handoffAccepted = previewAcceptance.acceptance.accepted
    && previewAcceptanceExportManifest.ready
    && selectedCheckpointIds.length > 0;
  const targetProviderId = externalHandoff.selectedProviderId || mailchimpHandoff.providerId || null;
  const requestedRouteAction = previewAcceptanceExportManifest.routeHandoff.routeAction;
  const blockers = [
    ...(previewAcceptanceExportManifest.ready ? [] : previewAcceptanceExportManifest.blockingReasons),
    ...(previewAcceptance.acceptance.accepted ? [] : ["preview_acceptance_not_accepted"]),
    ...(selectedCheckpointIds.length > 0 ? [] : ["preview_handoff_checkpoint_missing"]),
    ...(clientRuntime.releaseState.releasable ? [] : clientRuntime.releaseState.blockerCodes)
  ];
  const handoffId = `${accessScope.tenantId}:${accessScope.workspaceId}:resume-token-handoff:${previewAcceptanceExportManifest.proof.digest.slice(0, 20)}`;
  const resumeTokenId = handoffAccepted
    ? buildRecoveryDigest({
        schema: "aios.auditRecovery.recoveryCheckpoint.previewResumeTokenHandoff.token.v1",
        handoffId,
        manifestId: previewAcceptanceExportManifest.manifestId,
        acceptanceDigest: previewAcceptance.acceptance.acceptanceDigest,
        primaryCheckpointId,
        tenantId: accessScope.tenantId,
        workspaceId: accessScope.workspaceId,
        clientRequestId: clientRuntime.requestId
      }).slice(0, 32)
    : null;
  const proofDigest = buildRecoveryDigest({
    schema: "aios.auditRecovery.recoveryCheckpoint.previewResumeTokenHandoff.v1",
    handoffId,
    state: handoffAccepted ? "accepted" : "blocked",
    manifestId: previewAcceptanceExportManifest.manifestId,
    acceptanceDigest: previewAcceptance.acceptance.acceptanceDigest,
    selectedCheckpointIds,
    targetProviderId,
    requestedRouteAction,
    clientRequestId: clientRuntime.requestId,
    blockers
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.previewResumeTokenHandoff.v1",
    handoffId,
    state: handoffAccepted
      ? "accepted"
      : previewAcceptance.acceptance.required && !previewAcceptance.acceptance.accepted
        ? "awaiting-acceptance"
        : "blocked",
    accepted: handoffAccepted,
    tenantId: accessScope.tenantId,
    workspaceId: accessScope.workspaceId,
    checkpointId: primaryCheckpointId,
    checkpointIds: selectedCheckpointIds,
    manifest: {
      manifestId: previewAcceptanceExportManifest.manifestId,
      state: previewAcceptanceExportManifest.state,
      ready: previewAcceptanceExportManifest.ready,
      digest: previewAcceptanceExportManifest.proof.digest,
      selectedCheckpointCount: previewAcceptanceExportManifest.selectedCheckpointCount,
      selectedProofCoverage: previewAcceptanceExportManifest.selectedProofCoverage
    },
    acceptance: {
      accepted: previewAcceptance.acceptance.accepted,
      acceptedBy: previewAcceptance.acceptance.acceptedBy,
      acceptedAt: previewAcceptance.acceptance.acceptedAt,
      digest: previewAcceptance.acceptance.acceptanceDigest,
      acceptedCheckpointIds: previewAcceptance.acceptance.acceptedCheckpointIds
    },
    resumeToken: {
      tokenId: resumeTokenId,
      scope: "audit-recovery",
      checkpointId: primaryCheckpointId,
      issuedAt: handoffAccepted ? now : null,
      issuer: surfaceName,
      sourceManifestId: previewAcceptanceExportManifest.manifestId,
      sourceAcceptanceDigest: previewAcceptance.acceptance.acceptanceDigest
    },
    routeContract: {
      sourceRoute: clientRuntime.route,
      acceptRouteAction: "accept-recovery-preview",
      resumeRouteAction: requestedRouteAction,
      continuationAction: previewAcceptanceExportManifest.routeHandoff.continuationAction,
      requestId: clientRuntime.requestId,
      workflowId: clientRuntime.workflowId,
      correlationId: clientRuntime.correlationId,
      idempotencyKey: clientRuntime.idempotencyKey,
      targetProviderId,
      destination: mailchimpHandoff.ready
        ? "mailchimp"
        : externalHandoff.ready
          ? "external-provider"
          : "hosted-kernel"
    },
    clientStateAdoption: {
      canAdopt: handoffAccepted && clientRuntime.releaseState.releasable,
      viewStateKey: `${accessScope.tenantId}:${accessScope.workspaceId}:${clientRuntime.workflowId}`,
      requiredStateExportTargets: ["browser", "hosted-kernel"],
      pendingMutationIds: clientRuntime.releaseState.unflushedMutationIds,
      missingAcknowledgements: clientRuntime.acknowledgements.missing,
      nextAction: handoffAccepted
        ? clientRuntime.releaseState.releasable
          ? "adopt-preview-acceptance-handoff"
          : clientRuntime.releaseState.nextAction
        : previewAcceptance.acceptance.required && !previewAcceptance.acceptance.accepted
          ? "collect-preview-acceptance"
          : "resolve-recovery-blockers"
    },
    blockers: Array.from(new Set(blockers)),
    proof: {
      algorithm: "sha256",
      digest: proofDigest,
      covers: ["manifest", "acceptance", "checkpointIds", "routeContract", "clientStateAdoption"]
    }
  };
}

function buildMailchimpRuntimeHandoffGate(
  mailchimpHandoff,
  previewAcceptance,
  previewAcceptanceExportManifest,
  previewResumeTokenHandoff,
  clientRuntime,
  accessScope,
  now
) {
  const requested = mailchimpHandoff.requested === true
    || previewResumeTokenHandoff.routeContract.destination === "mailchimp";
  const requiresAcceptance = requested && mailchimpHandoff.export.mode !== "preview-only";
  const clientAckMissing = clientRuntime.acknowledgements.missing.length > 0;
  const blockers = [
    requested && !mailchimpHandoff.ready ? "mailchimp_handoff_not_ready" : "",
    requested && !previewAcceptance.acceptance.accepted ? "mailchimp_preview_acceptance_missing" : "",
    requested && !previewAcceptanceExportManifest.ready ? "mailchimp_preview_export_manifest_not_ready" : "",
    requested && !previewResumeTokenHandoff.accepted ? "mailchimp_resume_token_handoff_not_accepted" : "",
    requested && clientAckMissing ? "mailchimp_client_acknowledgement_missing" : "",
    requested && !clientRuntime.releaseState.releasable ? "mailchimp_client_runtime_not_releasable" : ""
  ].filter(Boolean);
  const warnings = [
    ...(mailchimpHandoff.warnings || []),
    requested && mailchimpHandoff.consentBoundary.requiresMarketingConsent && mailchimpHandoff.export.mode !== "preview-only"
      ? "mailchimp_marketing_consent_boundary_required"
      : "",
    requested && mailchimpHandoff.consentBoundary.suppressUnsubscribed === false
      ? "mailchimp_unsubscribed_suppression_disabled"
      : ""
  ].filter(Boolean);
  const state = !requested
    ? "not-requested"
    : blockers.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "ready-with-warnings"
        : "ready";
  const dispatchPayload = requested && blockers.length === 0
    ? {
        providerId: mailchimpHandoff.providerId,
        projectionId: mailchimpHandoff.projectionId,
        manifestId: previewAcceptanceExportManifest.manifestId,
        previewResumeHandoffId: previewResumeTokenHandoff.handoffId,
        resumeTokenId: previewResumeTokenHandoff.resumeToken.tokenId,
        checkpointIds: previewResumeTokenHandoff.checkpointIds,
        target: mailchimpHandoff.target,
        export: mailchimpHandoff.export,
        consentBoundary: mailchimpHandoff.consentBoundary,
        clientRequestId: clientRuntime.requestId,
        workflowId: clientRuntime.workflowId
      }
    : null;
  const gateDigest = buildRecoveryDigest({
    schema: "aios.auditRecovery.recoveryCheckpoint.mailchimpRuntimeHandoffGate.v1",
    requested,
    state,
    tenantId: accessScope.tenantId,
    workspaceId: accessScope.workspaceId,
    providerId: mailchimpHandoff.providerId,
    projectionId: mailchimpHandoff.projectionId,
    manifestId: previewAcceptanceExportManifest.manifestId,
    resumeTokenId: previewResumeTokenHandoff.resumeToken.tokenId,
    checkpointIds: previewResumeTokenHandoff.checkpointIds,
    blockers,
    warnings,
    clientRequestId: clientRuntime.requestId
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.mailchimpRuntimeHandoffGate.v1",
    requested,
    ready: requested && blockers.length === 0,
    state,
    tenantId: accessScope.tenantId,
    workspaceId: accessScope.workspaceId,
    providerId: mailchimpHandoff.providerId,
    projectionId: mailchimpHandoff.projectionId,
    checkpointId: previewResumeTokenHandoff.checkpointId,
    checkpointIds: previewResumeTokenHandoff.checkpointIds,
    requiresAcceptance,
    acceptance: {
      accepted: previewAcceptance.acceptance.accepted,
      acceptedBy: previewAcceptance.acceptance.acceptedBy,
      acceptedAt: previewAcceptance.acceptance.acceptedAt,
      digest: previewAcceptance.acceptance.acceptanceDigest,
      manifestReady: previewAcceptanceExportManifest.ready,
      resumeHandoffAccepted: previewResumeTokenHandoff.accepted
    },
    clientRuntime: {
      releasable: clientRuntime.releaseState.releasable,
      requestId: clientRuntime.requestId,
      workflowId: clientRuntime.workflowId,
      missingAcknowledgements: clientRuntime.acknowledgements.missing,
      unflushedMutationIds: clientRuntime.releaseState.unflushedMutationIds
    },
    target: mailchimpHandoff.target,
    export: mailchimpHandoff.export,
    consentBoundary: mailchimpHandoff.consentBoundary,
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    dispatchPayload,
    nextAction: !requested
      ? "retain_kernel_export_manifest"
      : blockers.includes("mailchimp_preview_acceptance_missing")
        ? "collect-preview-acceptance"
        : blockers.includes("mailchimp_client_acknowledgement_missing")
          ? "collect-client-acknowledgement"
          : blockers.includes("mailchimp_client_runtime_not_releasable")
            ? clientRuntime.releaseState.nextAction
            : blockers.length > 0
              ? "repair-mailchimp-handoff"
              : "dispatch-mailchimp-handoff",
    proof: {
      algorithm: "sha256",
      digest: gateDigest,
      covers: ["provider", "manifest", "resumeToken", "clientRuntime", "consentBoundary", "blockers"]
    }
  };
}

function buildExplainableNextSteps(lifecycle, validationSummary, previewAcceptance, externalHandoff, capabilityNegotiation, now) {
  const steps = [];
  const pushStep = ({ action, reason, blocking, label, owner = "operator", priority = "normal", routeAction = action }) => {
    steps.push({
      id: buildRecoveryDigest({
        action,
        reason,
        blocking,
        priority,
        sequence: steps.length + 1
      }).slice(0, 16),
      action,
      routeAction,
      label,
      reason,
      blocking,
      owner,
      priority
    });
  };

  if (!lifecycle.enabled) {
    pushStep({
      action: "enable-lifecycle",
      label: "Enable recovery checkpoint lifecycle",
      reason: lifecycle.disabledReason || "lifecycle_disabled",
      blocking: true,
      priority: "high"
    });
  }
  if (lifecycle.scheduleControl.pauseActive) {
    pushStep({
      action: "wait-for-pause-window",
      label: "Wait for pause window to end",
      reason: "pause_window_active",
      blocking: true,
      priority: "normal"
    });
  }
  for (const code of validationSummary.blockingCodes) {
    pushStep({
      action: "resolve-validation-blocker",
      label: "Resolve recovery validation blocker",
      reason: code,
      blocking: true,
      owner: code.includes("permission") ? "administrator" : "operator",
      priority: code.includes("permission") || code.includes("proof") ? "high" : "normal"
    });
  }
  if (capabilityNegotiation.missing.length > 0) {
    pushStep({
      action: "attach-provider-capability",
      label: "Attach missing recovery provider capability",
      reason: capabilityNegotiation.missing.join(","),
      blocking: true,
      owner: "administrator",
      priority: "high"
    });
  }
  if (previewAcceptance.acceptance.required && !previewAcceptance.acceptance.accepted) {
    pushStep({
      action: "accept-recovery-preview",
      label: "Accept selected recovery checkpoints",
      reason: "operator_acceptance_required",
      blocking: true,
      priority: "high"
    });
  }
  if (externalHandoff.requested && !externalHandoff.ready) {
    pushStep({
      action: "prepare-external-handoff",
      label: "Prepare external handoff",
      reason: externalHandoff.blockedReasons.join(",") || "handoff_blocked",
      blocking: true,
      priority: "normal"
    });
  }
  if (steps.length === 0) {
    pushStep({
      action: lifecycle.nextAction.action,
      label: "Continue recovery checkpoint workflow",
      reason: "all_recovery_readiness_gates_passed",
      blocking: false,
      priority: lifecycle.schedule.due ? "high" : "normal"
    });
  }
  const blockingSteps = steps.filter((step) => step.blocking);
  const primaryStep = blockingSteps[0] || steps[0];

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.nextSteps.v1",
    generatedAt: now,
    readyForClientAction: blockingSteps.length === 0,
    blockingStepCount: blockingSteps.length,
    primaryStepId: primaryStep ? primaryStep.id : null,
    disabledRouteActions: previewAcceptance.routeActions
      .filter((action) => !action.enabled)
      .map((action) => ({
        action: action.action,
        reason: action.reason
      })),
    routeActions: previewAcceptance.routeActions,
    steps,
    audit: {
      schema: "aios.auditRecovery.recoveryCheckpoint.nextStepsAudit.v1",
      generatedAt: now,
      lifecycleState: lifecycle.scheduleControl.state,
      previewState: previewAcceptance.display.state,
      validationBlockingCount: validationSummary.blockingCodes.length,
      missingCapabilities: capabilityNegotiation.missing,
      handoffState: externalHandoff.state
    }
  };
}

function buildReportingState(analytics, history, timeline, exportSummary, validationSummary, providerSync, analyticsExport, now) {
  const latest = timeline.length ? timeline[timeline.length - 1] : null;
  const sourceSummaries = Object.entries(analytics.bySource).map(([source, counters]) => ({
    source,
    total: counters.total,
    latestSeenAt: counters.latestSeenAt,
    recoveryRate: counters.total === 0 ? 0 : Number((counters.restored / counters.total).toFixed(4)),
    proofCoverage: counters.total === 0 ? 0 : Number((counters.proofBacked / counters.total).toFixed(4)),
    failureCount: counters.failed
  }));
  const attentionSources = sourceSummaries
    .filter((source) => source.failureCount > 0 || source.proofCoverage < 1)
    .map((source) => source.source);
  const exportState = exportSummary.ready
    ? "ready"
    : exportSummary.recordCount > 0
      ? "blocked"
      : "empty";

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.reportingState.v1",
    freshness: {
      latestCheckpointAt: latest ? latest.at : null,
      timelineCount: timeline.length,
      historySnapshotCount: history.snapshotCount,
      providerCursorCount: providerSync.cursors.length
    },
    exportState,
    analyticsExportState: analyticsExport.ready
      ? "ready"
      : analyticsExport.blockedReason
        ? "blocked"
        : "idle",
    analyticsExportId: analyticsExport.exportId,
    analyticsWindowEventCount: analyticsExport.window.eventCount,
    analyticsTrend: analyticsExport.trend,
    attentionSources,
    sourceSummaries,
    operationalPosture: validationSummary.valid && exportSummary.ready
      ? "export-ready"
      : validationSummary.valid
        ? "monitoring"
        : "attention-required"
  };
}

function normalizePersistedRecoveryState(input = {}, accessScope, now) {
  const source = input && typeof input === "object" ? input : {};
  const rawState = source.persistedState && typeof source.persistedState === "object"
    ? source.persistedState
    : source.recoveryState && typeof source.recoveryState === "object"
      ? source.recoveryState
      : source.state && typeof source.state === "object"
        ? source.state
        : {};
  const readString = (...values) => {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  const normalizeStringList = (value) => {
    const raw = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    return raw
      .map((entry) => typeof entry === "string" ? entry.trim() : "")
      .filter((entry, index, list) => entry && list.indexOf(entry) === index)
      .sort();
  };
  const rawProviderCursors = rawState.providerCursors && typeof rawState.providerCursors === "object"
    ? rawState.providerCursors
    : {};
  const providerCursors = Object.keys(rawProviderCursors)
    .sort()
    .reduce((cursors, providerId) => {
      const cursor = readString(rawProviderCursors[providerId]);
      if (cursor) cursors[providerId] = cursor;
      return cursors;
    }, {});
  const status = readString(rawState.status, rawState.restartStatus) || "not-persisted";
  const checkpointDigests = rawState.checkpointDigests && typeof rawState.checkpointDigests === "object"
    ? Object.keys(rawState.checkpointDigests)
        .sort()
        .reduce((digests, checkpointId) => {
          const digest = readString(rawState.checkpointDigests[checkpointId]);
          if (digest) digests[checkpointId] = digest;
          return digests;
        }, {})
    : {};

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.persistedState.v1",
    generatedAt: now,
    stateId: readString(rawState.stateId, rawState.id)
      || `${accessScope.tenantId}:${accessScope.workspaceId}:recovery-checkpoint-state`,
    tenantId: readString(rawState.tenantId, rawState.tenant) || accessScope.tenantId,
    workspaceId: readString(rawState.workspaceId, rawState.workspace) || accessScope.workspaceId,
    status,
    restartEpoch: normalizePositiveInteger(rawState.restartEpoch, 0),
    restoredAt: normalizeTimestamp(rawState.restoredAt) || null,
    persistedAt: normalizeTimestamp(rawState.persistedAt) || null,
    lastHydratedAt: normalizeTimestamp(rawState.lastHydratedAt) || null,
    lastCommandKey: readString(rawState.lastCommandKey, rawState.lastIdempotencyKey),
    lastCommandResult: readString(rawState.lastCommandResult, rawState.commandResult),
    completedCommandKeys: normalizeStringList(rawState.completedCommandKeys || rawState.completedIdempotencyKeys),
    inFlightCommandKey: readString(rawState.inFlightCommandKey, rawState.pendingCommandKey),
    inFlightCommand: readString(rawState.inFlightCommand, rawState.pendingCommand),
    validationCursor: readString(rawState.validationCursor),
    replayCursor: readString(rawState.replayCursor),
    exportCursor: readString(rawState.exportCursor),
    handoffCursor: readString(rawState.handoffCursor),
    providerCursors,
    knownCheckpointIds: normalizeStringList(rawState.knownCheckpointIds),
    restoredCheckpointIds: normalizeStringList(rawState.restoredCheckpointIds),
    checkpointDigests
  };
}

function buildRestartSafeCommandState(
  persistedState,
  accessScope,
  clientRuntime,
  lifecycle,
  validationSummary,
  previewAcceptance,
  exportSummary,
  proofLedger,
  providerSync,
  now
) {
  const commandName = lifecycle.command || (
    lifecycle.schedule.due
      ? "run-scheduled-checkpoint-cycle"
      : lifecycle.nextAction.action
  );
  const commandKey = clientRuntime.idempotencyKey || buildRecoveryDigest({
    tenantId: persistedState.tenantId,
    workspaceId: persistedState.workspaceId,
    workflowId: clientRuntime.workflowId,
    commandName,
    nextRunAt: lifecycle.schedule.nextRunAt,
    exportManifestId: exportSummary.manifest.manifestId,
    proofLedgerDigest: proofLedger.ledgerDigest,
    selectedCheckpointIds: previewAcceptance.acceptance.acceptedCheckpointIds
  }).slice(0, 32);
  const completedKeys = new Set([
    ...persistedState.completedCommandKeys,
    persistedState.lastCommandKey
  ].filter(Boolean));
  const duplicateCompleted = completedKeys.has(commandKey);
  const duplicateInFlight = persistedState.inFlightCommandKey === commandKey;
  const restartDetected = persistedState.status !== "not-persisted" && (
    persistedState.restoredAt !== null || persistedState.lastHydratedAt !== null || persistedState.restartEpoch > 0
  );
  const staleProviderCursorIds = providerSync.cursors
    .filter((cursor) => (
      persistedState.providerCursors[cursor.providerId]
      && persistedState.providerCursors[cursor.providerId] !== cursor.cursor
    ))
    .map((cursor) => cursor.providerId);
  const missingKnownCheckpoints = exportSummary.records
    .filter((record) => !persistedState.knownCheckpointIds.includes(record.checkpointId))
    .map((record) => record.checkpointId);
  const blockedReasons = [];

  if (!validationSummary.valid) blockedReasons.push("validation_summary_blocked");
  if (duplicateCompleted) blockedReasons.push("idempotency_key_already_completed");
  if (duplicateInFlight) blockedReasons.push("idempotency_key_in_flight");
  if (persistedState.tenantId !== accessScope.tenantId || persistedState.workspaceId !== accessScope.workspaceId) {
    blockedReasons.push("persisted_state_scope_mismatch");
  }

  const commandStatus = duplicateCompleted
    ? "already-applied"
    : duplicateInFlight
      ? "resume-in-flight"
      : blockedReasons.some((reason) => reason !== "idempotency_key_in_flight")
        ? "blocked"
        : lifecycle.schedule.due || lifecycle.nextAction.action !== "wait-for-schedule"
          ? "ready"
          : "waiting";
  const recoveryPaths = [];

  if (duplicateInFlight) {
    recoveryPaths.push({
      action: "resume-command",
      commandKey,
      reason: "matching_in_flight_command"
    });
  }
  if (duplicateCompleted) {
    recoveryPaths.push({
      action: "return-cached-result",
      commandKey,
      reason: persistedState.lastCommandResult || "completed_idempotent_command"
    });
  }
  if (!duplicateCompleted && !duplicateInFlight && validationSummary.valid) {
    recoveryPaths.push({
      action: "persist-and-dispatch-command",
      commandKey,
      reason: lifecycle.schedule.due ? "checkpoint_cycle_due" : lifecycle.nextAction.action
    });
  }
  if (staleProviderCursorIds.length > 0 || missingKnownCheckpoints.length > 0) {
    recoveryPaths.push({
      action: "refresh-persisted-cursors",
      commandKey,
      reason: "persisted_projection_lagging_runtime_state"
    });
  }

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.restartSafeCommand.v1",
    commandName,
    commandKey,
    idempotent: true,
    commandStatus,
    restartDetected,
    accepted: commandStatus === "ready" || commandStatus === "resume-in-flight",
    blockedReasons: Array.from(new Set(blockedReasons)),
    replay: {
      duplicateCompleted,
      duplicateInFlight,
      lastCommandKey: persistedState.lastCommandKey,
      inFlightCommandKey: persistedState.inFlightCommandKey
    },
    persistedProjection: {
      stateId: persistedState.stateId,
      status: persistedState.status,
      persistedAt: persistedState.persistedAt,
      restoredAt: persistedState.restoredAt,
      restartEpoch: persistedState.restartEpoch,
      knownCheckpointCount: persistedState.knownCheckpointIds.length,
      restoredCheckpointCount: persistedState.restoredCheckpointIds.length,
      providerCursorCount: Object.keys(persistedState.providerCursors).length,
      staleProviderCursorIds,
      missingKnownCheckpoints
    },
    recoveryPaths
  };
}

function buildPersistedRecoveryProjection(
  persistedState,
  checkpoints,
  providerSync,
  restartSafeCommand,
  lifecycle,
  exportSummary,
  proofLedger,
  replayLedger,
  clientRuntime,
  now
) {
  const nextProviderCursors = { ...persistedState.providerCursors };
  for (const cursor of providerSync.cursors) {
    if (cursor.cursor) nextProviderCursors[cursor.providerId] = cursor.cursor;
  }

  const checkpointDigests = checkpoints
    .slice()
    .sort((left, right) => left.checkpointId.localeCompare(right.checkpointId))
    .reduce((digests, checkpoint) => {
      digests[checkpoint.checkpointId] = buildRecoveryDigest({
        checkpointId: checkpoint.checkpointId,
        status: checkpoint.status,
        timestamp: checkpoint.timestamp,
        proofRef: checkpoint.proofRef,
        sizeBytes: checkpoint.sizeBytes
      });
      return digests;
    }, {});
  const knownCheckpointIds = Array.from(new Set([
    ...persistedState.knownCheckpointIds,
    ...checkpoints.map((checkpoint) => checkpoint.checkpointId)
  ])).sort();
  const restoredCheckpointIds = Array.from(new Set([
    ...persistedState.restoredCheckpointIds,
    ...checkpoints
      .filter((checkpoint) => checkpoint.status === "restored")
      .map((checkpoint) => checkpoint.checkpointId)
  ])).sort();
  const completedCommandKeys = Array.from(new Set([
    ...persistedState.completedCommandKeys,
    restartSafeCommand.commandStatus === "already-applied" ? restartSafeCommand.commandKey : null
  ].filter(Boolean))).sort();
  const shouldMarkInFlight = restartSafeCommand.commandStatus === "ready"
    || restartSafeCommand.commandStatus === "resume-in-flight";
  const projectedStatus = restartSafeCommand.commandStatus === "already-applied"
    ? "command-completed"
    : shouldMarkInFlight
      ? "command-in-flight"
      : restartSafeCommand.commandStatus === "waiting"
        ? "waiting-for-schedule"
        : "blocked";
  const writeIntent = restartSafeCommand.commandStatus === "ready"
    ? "upsert-in-flight-command"
    : restartSafeCommand.commandStatus === "resume-in-flight"
      ? "preserve-in-flight-command"
      : restartSafeCommand.commandStatus === "already-applied"
        ? "read-cached-command-result"
        : restartSafeCommand.commandStatus === "waiting"
          ? "persist-watermarks-only"
          : "block-persisted-dispatch";
  const previousProjectionDigest = buildRecoveryDigest({
    stateId: persistedState.stateId,
    status: persistedState.status,
    persistedAt: persistedState.persistedAt,
    restartEpoch: persistedState.restartEpoch,
    completedCommandKeys: persistedState.completedCommandKeys,
    inFlightCommandKey: persistedState.inFlightCommandKey,
    providerCursors: persistedState.providerCursors,
    knownCheckpointIds: persistedState.knownCheckpointIds,
    replayCursor: persistedState.replayCursor,
    checkpointDigests: persistedState.checkpointDigests
  });
  const nextState = {
    schema: "aios.auditRecovery.recoveryCheckpoint.persistedState.v1",
    stateId: persistedState.stateId,
    tenantId: persistedState.tenantId,
    workspaceId: persistedState.workspaceId,
    status: projectedStatus,
    restartEpoch: persistedState.restartEpoch,
    persistedAt: now,
    lastHydratedAt: persistedState.lastHydratedAt,
    restoredAt: persistedState.restoredAt,
    lastCommandKey: restartSafeCommand.commandStatus === "already-applied"
      ? persistedState.lastCommandKey || restartSafeCommand.commandKey
      : persistedState.lastCommandKey,
    lastCommandResult: restartSafeCommand.commandStatus === "already-applied"
      ? persistedState.lastCommandResult || "cached-result-returned"
      : persistedState.lastCommandResult,
    completedCommandKeys,
    inFlightCommandKey: shouldMarkInFlight ? restartSafeCommand.commandKey : null,
    inFlightCommand: shouldMarkInFlight ? restartSafeCommand.commandName : null,
    validationCursor: proofLedger.ledgerDigest,
    replayCursor: replayLedger.latestDigest,
    exportCursor: exportSummary.manifest.manifestId,
    handoffCursor: clientRuntime.requestFingerprint,
    providerCursors: nextProviderCursors,
    knownCheckpointIds,
    restoredCheckpointIds,
    checkpointDigests
  };
  const nextProjectionDigest = buildRecoveryDigest(nextState);

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.persistedProjection.v1",
    stateId: persistedState.stateId,
    writeIntent,
    restartSafeStatus: projectedStatus,
    restartSafe: restartSafeCommand.accepted || restartSafeCommand.commandStatus === "already-applied",
    compareAndSwap: {
      required: writeIntent === "upsert-in-flight-command" || writeIntent === "persist-watermarks-only",
      previousProjectionDigest,
      nextProjectionDigest
    },
    commandLedger: {
      commandKey: restartSafeCommand.commandKey,
      commandName: restartSafeCommand.commandName,
      commandStatus: restartSafeCommand.commandStatus,
      idempotencyKey: clientRuntime.idempotencyKey,
      completedCommandKeys,
      inFlightCommandKey: nextState.inFlightCommandKey,
      replaySafe: restartSafeCommand.commandStatus !== "blocked",
      recoveryPathActions: restartSafeCommand.recoveryPaths.map((path) => path.action)
    },
    watermarks: {
      validationCursor: nextState.validationCursor,
      replayCursor: nextState.replayCursor,
      exportCursor: nextState.exportCursor,
      handoffCursor: nextState.handoffCursor,
      providerCursorCount: Object.keys(nextProviderCursors).length,
      checkpointDigestCount: Object.keys(checkpointDigests).length,
      knownCheckpointCount: knownCheckpointIds.length,
      restoredCheckpointCount: restoredCheckpointIds.length
    },
    nextState
  };
}

function buildRestartCommandExportEnvelope(
  persistedProjection,
  restartSafeCommand,
  analyticsExport,
  exportSummary,
  externalHandoff,
  operationalHealth,
  now
) {
  const commandReplayReady = restartSafeCommand.commandStatus === "ready"
    || restartSafeCommand.commandStatus === "resume-in-flight"
    || restartSafeCommand.commandStatus === "already-applied";
  const persistedWriteSafe = persistedProjection.compareAndSwap.required
    ? Boolean(persistedProjection.compareAndSwap.previousProjectionDigest && persistedProjection.compareAndSwap.nextProjectionDigest)
    : true;
  const exportReady = exportSummary.ready && analyticsExport.ready;
  const handoffReady = !externalHandoff.requested || externalHandoff.ready;
  const blockers = [
    commandReplayReady ? "" : "restart_command_not_replayable",
    persistedProjection.restartSafe ? "" : "persisted_projection_not_restart_safe",
    persistedWriteSafe ? "" : "persisted_projection_compare_and_swap_missing",
    exportReady ? "" : analyticsExport.blockedReason || exportSummary.blockedReason || "export_not_ready",
    handoffReady ? "" : "external_handoff_not_ready",
    operationalHealth.status === "critical" ? "operational_health_critical" : ""
  ].filter(Boolean);
  const warnings = [
    restartSafeCommand.restartDetected ? "restart_detected" : "",
    persistedProjection.writeIntent === "persist-watermarks-only" ? "watermark_only_persistence" : "",
    operationalHealth.degraded ? "operational_health_degraded" : "",
    externalHandoff.requested && externalHandoff.ready ? "external_handoff_ready" : ""
  ].filter(Boolean);
  const state = blockers.length > 0
    ? "blocked"
    : restartSafeCommand.commandStatus === "already-applied"
      ? "replay-cached-result"
      : externalHandoff.ready
        ? "handoff-ready"
        : "restart-dispatch-ready";
  const persistedPatch = {
    writeIntent: persistedProjection.writeIntent,
    stateId: persistedProjection.stateId,
    restartSafeStatus: persistedProjection.restartSafeStatus,
    commandKey: restartSafeCommand.commandKey,
    commandName: restartSafeCommand.commandName,
    inFlightCommandKey: persistedProjection.nextState.inFlightCommandKey,
    validationCursor: persistedProjection.nextState.validationCursor,
    replayCursor: persistedProjection.nextState.replayCursor,
    exportCursor: persistedProjection.nextState.exportCursor,
    handoffCursor: persistedProjection.nextState.handoffCursor,
    providerCursors: persistedProjection.nextState.providerCursors,
    knownCheckpointIds: persistedProjection.nextState.knownCheckpointIds,
    restoredCheckpointIds: persistedProjection.nextState.restoredCheckpointIds
  };
  const digest = buildRecoveryDigest({
    state,
    blockers,
    warnings,
    persistedPatch,
    analyticsExportId: analyticsExport.exportId,
    manifestId: exportSummary.manifest.manifestId,
    commandKey: restartSafeCommand.commandKey,
    nextProjectionDigest: persistedProjection.compareAndSwap.nextProjectionDigest,
    externalHandoffState: externalHandoff.state,
    healthStatus: operationalHealth.status
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.restartCommandExportEnvelope.v1",
    state,
    ready: blockers.length === 0,
    idempotent: true,
    command: {
      commandKey: restartSafeCommand.commandKey,
      commandName: restartSafeCommand.commandName,
      status: restartSafeCommand.commandStatus,
      accepted: restartSafeCommand.accepted,
      recoveryPathActions: restartSafeCommand.recoveryPaths.map((path) => path.action),
      duplicateCompleted: restartSafeCommand.replay.duplicateCompleted,
      duplicateInFlight: restartSafeCommand.replay.duplicateInFlight
    },
    persistence: {
      writeIntent: persistedProjection.writeIntent,
      restartSafe: persistedProjection.restartSafe,
      compareAndSwap: persistedProjection.compareAndSwap,
      patch: persistedPatch
    },
    export: {
      ready: exportReady,
      analyticsExportId: analyticsExport.exportId,
      manifestId: exportSummary.manifest.manifestId,
      recordCount: exportSummary.recordCount,
      windowEventCount: analyticsExport.window.eventCount,
      digest: analyticsExport.digest
    },
    handoff: {
      requested: externalHandoff.requested,
      ready: externalHandoff.ready,
      state: externalHandoff.state,
      selectedProviderId: externalHandoff.selectedProviderId
    },
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    proof: {
      algorithm: "sha256",
      digest,
      covers: ["state", "command", "persistence.patch", "export", "handoff", "blockers"]
    }
  };
}

function normalizeOperationalRetryPolicy(input = {}, persistedState = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawHealth = source.operationalHealth && typeof source.operationalHealth === "object"
    ? source.operationalHealth
    : {};
  const rawPolicy = rawHealth.retryPolicy && typeof rawHealth.retryPolicy === "object"
    ? rawHealth.retryPolicy
    : source.retryPolicy && typeof source.retryPolicy === "object"
      ? source.retryPolicy
      : {};
  const currentAttempt = normalizePositiveInteger(
    rawPolicy.currentAttempt ?? rawPolicy.attempt ?? rawHealth.retryAttempt ?? persistedState.restartEpoch,
    0
  );
  const maxAttempts = Math.max(1, normalizePositiveInteger(rawPolicy.maxAttempts, 4));
  const baseDelayMs = Math.max(1000, normalizePositiveInteger(rawPolicy.baseDelayMs, 30000));
  const maxDelayMs = Math.max(baseDelayMs, normalizePositiveInteger(rawPolicy.maxDelayMs, 600000));
  const jitterMs = Math.max(0, normalizePositiveInteger(rawPolicy.jitterMs, 0));
  const normalizedAttempt = Math.min(currentAttempt, maxAttempts);
  const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** normalizedAttempt)) + jitterMs;

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.retryPolicy.v1",
    currentAttempt,
    maxAttempts,
    attemptsRemaining: Math.max(0, maxAttempts - currentAttempt),
    baseDelayMs,
    maxDelayMs,
    jitterMs,
    nextDelayMs: delayMs,
    exhausted: currentAttempt >= maxAttempts
  };
}

function buildFailureStateProfiles(checkpoints, providerContracts, retryPolicy, now) {
  const failedCheckpoints = checkpoints
    .filter((checkpoint) => checkpoint.status === "failed")
    .map((checkpoint) => ({
      checkpointId: checkpoint.checkpointId,
      source: checkpoint.source,
      failedAt: checkpoint.timestamp,
      proofRef: checkpoint.proofRef,
      retryable: Boolean(checkpoint.proofRef),
      reason: checkpoint.proofRef ? "failed_checkpoint_has_proof" : "failed_checkpoint_missing_proof",
      action: checkpoint.proofRef ? "retry-validated-checkpoint" : "recapture-checkpoint-proof"
    }));
  const unhealthyProviders = providerContracts
    .filter((provider) => ["error", "failed", "disconnected", "unhealthy"].includes(provider.state))
    .map((provider) => ({
      providerId: provider.providerId,
      service: provider.service,
      state: provider.state,
      endpointRef: provider.endpointRef,
      retryable: provider.endpointRef !== null,
      action: provider.endpointRef ? "retry-provider-sync" : "reattach-provider-endpoint"
    }));
  const staleProviders = providerContracts
    .filter((provider) => provider.sync && provider.sync.stale)
    .map((provider) => ({
      providerId: provider.providerId,
      service: provider.service,
      staleAfterMinutes: provider.sync.staleAfterMinutes,
      syncAgeMinutes: provider.sync.syncAgeMinutes,
      cursorExported: provider.sync.cursorExported,
      action: provider.sync.cursorExported ? "refresh-provider-sync" : "export-provider-cursor"
    }));
  const retryableCheckpointCount = failedCheckpoints.filter((checkpoint) => checkpoint.retryable).length;
  const retryableProviderCount = unhealthyProviders.filter((provider) => provider.retryable).length;
  const retryableFailureCount = retryableCheckpointCount + retryableProviderCount + staleProviders.length;
  const terminalFailureCount = (failedCheckpoints.length - retryableCheckpointCount)
    + (unhealthyProviders.length - retryableProviderCount);
  const nextRetryAt = retryableFailureCount > 0 && !retryPolicy.exhausted
    ? addMilliseconds(now, retryPolicy.nextDelayMs)
    : null;

  return {
    schema: "aios.auditRecovery.recoveryCheckpoint.failureStateProfiles.v1",
    generatedAt: now,
    failedCheckpointCount: failedCheckpoints.length,
    unhealthyProviderCount: unhealthyProviders.length,
    staleProviderCount: staleProviders.length,
    retryableFailureCount,
    terminalFailureCount,
    retryable: retryableFailureCount > 0 && !retryPolicy.exhausted,
    nextRetryAt,
    failedCheckpoints,
    unhealthyProviders,
    staleProviders,
    primaryFailure: failedCheckpoints[0]?.reason
      || unhealthyProviders[0]?.state
      || (staleProviders.length > 0 ? "provider_sync_stale" : null),
    remediationActions: Array.from(new Set([
      ...failedCheckpoints.map((checkpoint) => checkpoint.action),
      ...unhealthyProviders.map((provider) => provider.action),
      ...staleProviders.map((provider) => provider.action)
    ]))
  };
}

function normalizeHostedKernelHealthSignals(input = {}, accessScope, now) {
  const source = input && typeof input === "object" ? input : {};
  const activeTenantId = accessScope.tenantId || accessScope.activeTenantId || "default-tenant";
  const activeWorkspaceId = accessScope.workspaceId || accessScope.activeWorkspaceId || "default-workspace";
  const rawHealth = source.operationalHealth && typeof source.operationalHealth === "object"
    ? source.operationalHealth
    : {};
  const rawSignals = Array.isArray(rawHealth.signals)
    ? rawHealth.signals
    : Array.isArray(rawHealth.probes)
      ? rawHealth.probes
      : Array.isArray(source.healthSignals)
        ? source.healthSignals
        : [];
  const rawErrors = Array.isArray(rawHealth.errors)
    ? rawHealth.errors
    : Array.isArray(source.operationalErrors)
      ? source.operationalErrors
      : [];
  const records = [];
  const pushRecord = (record, index, kind) => {
    const entry = record && typeof record === "object" ? record : {};
    const code = typeof entry.code === "string" && entry.code.trim()
      ? entry.code.trim().toLowerCase().replaceAll(" ", "_")
      : `${kind}_${index + 1}`;
    const severityRaw = typeof entry.severity === "string" ? entry.severity.trim().toLowerCase() : "";
    const severity = ["error", "warning", "info"].includes(severityRaw)
      ? severityRaw
      : kind === "error" ? "error" : "warning";
    const category = typeof entry.category === "string" && entry.category.trim()
      ? entry.category.trim().toLowerCase()
      : kind === "error" ? "hosted-kernel" : "probe";
    const status = typeof entry.status === "string" && entry.status.trim()
      ? entry.status.trim().toLowerCase()
      : severity === "error" ? "failed" : severity === "warning" ? "degraded" : "ok";
    const observedAt = normalizeTimestamp(entry.observedAt)
      || normalizeTimestamp(entry.timestamp)
      || normalizeTimestamp(entry.at)
      || now;
    const tenantId = readScopedString(entry, "tenantId", "tenant") || activeTenantId;
    const workspaceId = readScopedString(entry, "workspaceId", "workspace") || activeWorkspaceId;
    const scoped = tenantId === activeTenantId && workspaceId === activeWorkspaceId;
    const action = normalizeClientRouteAction(
      entry.routeAction || entry.action,
      severity === "error" ? "inspect-health" : "export-audit-evidence"
    );

    records.push({
      schema: "aios.auditRecovery.recoveryCheckpoint.hostedKernelHealthSignal.v1",
      signalId: typeof entry.signalId === "string" && entry.signalId.trim()
        ? entry.signalId.trim()
        : `${kind}:${code}:${index + 1}`,
      kind,
      code,
      severity,
      category,
      status,
      observedAt,
      tenantId,
      workspaceId,
      scoped,
      retryable: normalizeBoolean(entry.retryable, severity === "error" && category !== "permission"),
      action,
      message: typeof entry.message === "string" && entry.message.trim()
        ? entry.message.trim()
        : `Hosted recovery checkpoint ${kind} reported ${code}.`,
      evidenceRef: typeof entry.evidenceRef === "string" && entry.evidenceRef.trim()
        ? entry.evidenceRef.trim()
        : null
    });
  };

  rawSignals.forEach((record, index) => pushRecord(record, index, "signal"));
  rawErrors.forEach((record, index) => pushRecord(record, index, "error"));

  const scopedRecords = records.filter((record) => record.scoped);
  const excludedRecords = records.filter((record) => !record.scoped);
  const activeRecords = scopedRecords.filter((record) => record.status !== "ok" || record.severity !== "info");
  const errorRecords = activeRecords.filter((record) => record.severity === "error");
  const warningRecords = activeRecords.filter((record) => record.severity === "warning");

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.hostedKernelHealthSignals.v1",
    signalCount: scopedRecords.length,
    activeSignalCount: activeRecords.length,
    errorSignalCount: errorRecords.length,
    warningSignalCount: warningRecords.length,
    excludedSignalCount: excludedRecords.length,
    scoped: excludedRecords.length === 0,
    retryableSignalCount: activeRecords.filter((record) => record.retryable).length,
    primarySignalCode: errorRecords[0]?.code || warningRecords[0]?.code || null,
    activeRecords,
    excludedRecords: excludedRecords.map((record) => ({
      signalId: record.signalId,
      code: record.code,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      reason: record.tenantId === activeTenantId ? "workspace_boundary_mismatch" : "tenant_boundary_mismatch"
    }))
  };
}

function buildOperationalHealthState(
  input,
  checkpoints,
  analytics,
  lifecycle,
  validationSummary,
  capabilityNegotiation,
  providerContracts,
  providerSync,
  proofLedger,
  externalHandoff,
  clientRuntime,
  restartSafeCommand,
  boundaryAudit,
  proofArtifactAudit,
  persistedState,
  now
) {
  const retryPolicy = normalizeOperationalRetryPolicy(input, persistedState);
  const failureProfiles = buildFailureStateProfiles(checkpoints, providerContracts, retryPolicy, now);
  const healthSignals = normalizeHostedKernelHealthSignals(input, boundaryAudit, now);
  const errors = [];
  const addError = (code, severity, category, message, action, retryable, details = {}) => {
    errors.push({
      code,
      severity,
      category,
      message,
      action,
      retryable,
      owner: category === "permission" ? "administrator" : "operator",
      details
    });
  };

  for (const code of validationSummary.blockingCodes) {
    const category = code.includes("permission")
      ? "permission"
      : code.includes("capability") || code.includes("provider")
        ? "provider"
        : code.includes("proof")
          ? "proof"
          : "validation";
    addError(
      code,
      "error",
      category,
      `Recovery checkpoint is blocked by ${code}.`,
      category === "provider" ? "repair-provider-contract" : "resolve-validation-blocker",
      category === "provider",
      { blockingCode: code }
    );
  }
  for (const code of validationSummary.warningCodes) {
    addError(
      code,
      "warning",
      code.includes("proof") ? "proof" : "validation",
      `Recovery checkpoint reported ${code}.`,
      "review-recovery-warning",
      false,
      { warningCode: code }
    );
  }
  if (analytics.counters.failed > 0) {
    addError("checkpoint_failures_present", "error", "checkpoint", "One or more checkpoint events failed.", "inspect-failed-checkpoints", true, {
      failedCount: analytics.counters.failed,
      retryableFailedCheckpointCount: failureProfiles.failedCheckpoints.filter((checkpoint) => checkpoint.retryable).length
    });
  }
  if (providerContracts.length === 0) {
    addError("no_recovery_provider_available", "error", "provider", "No scoped recovery provider contract is available.", "attach-recovery-provider", true);
  }
  if (providerContracts.some((provider) => ["error", "failed", "disconnected", "unhealthy"].includes(provider.state))) {
    addError("provider_unhealthy_state", "error", "provider", "A recovery provider is reporting an unhealthy state.", "repair-provider-health", true, {
      providerIds: providerContracts
        .filter((provider) => ["error", "failed", "disconnected", "unhealthy"].includes(provider.state))
        .map((provider) => provider.providerId)
    });
  }
  if (restartSafeCommand.blockedReasons.length > 0) {
    addError("restart_safe_command_blocked", "error", "restart-safety", "Restart-safe command dispatch is blocked.", "resolve-command-replay-state", false, {
      blockedReasons: restartSafeCommand.blockedReasons
    });
  }
  if (clientRuntime.offline && externalHandoff.requested) {
    addError("offline_handoff_blocked", "warning", "client-runtime", "External handoff cannot complete while the hosted client is offline.", "resume-when-online", true);
  }
  if (boundaryAudit.excludedCheckpointCount > 0 || boundaryAudit.excludedProviderCount > 0 || proofArtifactAudit.excludedProofArtifactCount > 0) {
    addError("scoped_boundary_exclusions_present", "error", "tenant-boundary", "Some recovery records were excluded by tenant or workspace boundaries.", "verify-access-scope", false, {
      excludedCheckpointCount: boundaryAudit.excludedCheckpointCount,
      excludedProviderCount: boundaryAudit.excludedProviderCount,
      excludedProofArtifactCount: proofArtifactAudit.excludedProofArtifactCount
    });
  }
  if (!healthSignals.scoped) {
    addError("health_signal_boundary_exclusions_present", "error", "tenant-boundary", "Some hosted kernel health signals were excluded by tenant or workspace boundaries.", "verify-access-scope", false, {
      excludedSignalCount: healthSignals.excludedSignalCount,
      excludedSignals: healthSignals.excludedRecords
    });
  }
  for (const signal of healthSignals.activeRecords) {
    addError(
      `hosted_kernel_${signal.kind}:${signal.code}`,
      signal.severity,
      signal.category,
      signal.message,
      signal.action,
      signal.retryable,
      {
        signalId: signal.signalId,
        status: signal.status,
        observedAt: signal.observedAt,
        evidenceRef: signal.evidenceRef
      }
    );
  }
  for (const checkpoint of failureProfiles.failedCheckpoints) {
    addError(
      `failed_checkpoint:${checkpoint.checkpointId}`,
      checkpoint.retryable ? "warning" : "error",
      "checkpoint",
      `Checkpoint ${checkpoint.checkpointId} failed and requires ${checkpoint.action}.`,
      checkpoint.action,
      checkpoint.retryable,
      checkpoint
    );
  }
  for (const provider of failureProfiles.staleProviders) {
    addError(
      `stale_provider_sync:${provider.providerId}`,
      "warning",
      "provider",
      `Provider ${provider.providerId} sync metadata is stale.`,
      provider.action,
      true,
      provider
    );
  }

  const retryableErrors = errors.filter((error) => error.retryable);
  const blockingErrors = errors.filter((error) => error.severity === "error");
  const degradedReasons = Array.from(new Set([
    capabilityNegotiation.degraded ? "capability_negotiation_degraded" : null,
    proofLedger.referenceOnlyCount > 0 ? "proof_reference_only" : null,
    providerSync.syncableProviderCount === 0 && providerContracts.length > 0 ? "metadata_sync_unavailable" : null,
    failureProfiles.staleProviderCount > 0 ? "provider_sync_stale" : null,
    failureProfiles.retryableFailureCount > 0 ? "retryable_failure_profile_present" : null,
    healthSignals.errorSignalCount > 0 ? "hosted_kernel_error_signal" : null,
    healthSignals.warningSignalCount > 0 ? "hosted_kernel_warning_signal" : null,
    clientRuntime.offline ? "client_offline" : null,
    ...errors.filter((error) => error.severity === "warning").map((error) => error.code)
  ].filter(Boolean)));
  const retryAllowed = (retryableErrors.length > 0 || failureProfiles.retryable) && !retryPolicy.exhausted && lifecycle.enabled;
  const healthStatus = blockingErrors.length > 0
    ? retryAllowed ? "degraded-retryable" : "critical"
    : degradedReasons.length > 0
      ? "degraded"
      : "healthy";

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.operationalHealth.v1",
    status: healthStatus,
    healthy: healthStatus === "healthy",
    degraded: healthStatus !== "healthy",
    retryPolicy,
    retry: {
      allowed: retryAllowed,
      exhausted: retryPolicy.exhausted,
      nextRetryAt: retryAllowed ? failureProfiles.nextRetryAt || addMilliseconds(now, retryPolicy.nextDelayMs) : null,
      retryableErrorCodes: Array.from(new Set(retryableErrors.map((error) => error.code))),
      retryableFailureCount: failureProfiles.retryableFailureCount,
      remediationActions: failureProfiles.remediationActions
    },
    degradedMode: {
      enabled: healthStatus !== "healthy",
      reasons: degradedReasons,
      allowedActions: healthStatus === "critical"
        ? ["inspect-health", "export-audit-evidence"]
        : ["inspect-health", "validate-checkpoints", "export-audit-evidence", "refresh-provider-sync"],
      disabledActions: healthStatus === "critical"
        ? ["restore-checkpoint", "external-handoff", "run-checkpoint-cycle"]
        : retryPolicy.exhausted
          ? ["external-handoff"]
          : []
    },
    failureState: {
      failedCheckpointCount: analytics.counters.failed,
      providerErrorCount: errors.filter((error) => error.category === "provider" && error.severity === "error").length,
      proofIncomplete: proofLedger.proofRequired && !proofLedger.ready,
      commandDispatchable: restartSafeCommand.accepted,
      externalHandoffReady: externalHandoff.ready,
      hostedKernelSignalCount: healthSignals.activeSignalCount,
      hostedKernelPrimarySignal: healthSignals.primarySignalCode,
      profiles: failureProfiles
    },
    hostedKernelSignals: healthSignals,
    actionableErrors: errors,
    audit: {
      schema: "aios.auditRecovery.recoveryCheckpoint.operationalHealthAudit.v1",
      generatedAt: now,
      errorCount: errors.length,
      blockingErrorCount: blockingErrors.length,
      retryableErrorCount: retryableErrors.length,
      retryableFailureCount: failureProfiles.retryableFailureCount,
      hostedKernelSignalCount: healthSignals.activeSignalCount,
      hostedKernelErrorSignalCount: healthSignals.errorSignalCount,
      hostedKernelWarningSignalCount: healthSignals.warningSignalCount,
      missingCapabilities: capabilityNegotiation.missing,
      proofLedgerDigest: proofLedger.ledgerDigest,
      restartSafeCommandKey: restartSafeCommand.commandKey
    }
  };
}

function buildHostedClientActionEnvelope(
  clientRuntime,
  clientWorkflowHandoff,
  nextSteps,
  restartSafeCommand,
  operationalHealth,
  externalHandoff,
  exportSummary,
  now
) {
  const actionsByName = new Map();
  const putAction = (action) => {
    const existing = actionsByName.get(action.action);
    if (!existing) {
      actionsByName.set(action.action, {
        action: action.action,
        enabled: Boolean(action.enabled),
        reason: action.reason || null,
        label: action.label || action.action,
        source: action.source,
        blocking: Boolean(action.blocking),
        priority: action.priority || "normal"
      });
      return;
    }
    existing.enabled = existing.enabled || Boolean(action.enabled);
    existing.blocking = existing.blocking || Boolean(action.blocking);
    existing.reason = existing.enabled ? existing.reason || action.reason || null : action.reason || existing.reason;
    existing.priority = existing.priority === "high" || action.priority !== "high" ? existing.priority : "high";
  };

  for (const routeAction of nextSteps.routeActions) {
    putAction({
      action: routeAction.action,
      label: routeAction.label,
      enabled: routeAction.enabled,
      reason: routeAction.reason,
      source: "preview-route"
    });
  }
  for (const step of nextSteps.steps) {
    putAction({
      action: normalizeClientRouteAction(step.routeAction, step.action),
      label: step.label,
      enabled: !step.blocking || step.action === clientWorkflowHandoff.requiredAction,
      reason: step.reason,
      source: "next-step",
      blocking: step.blocking,
      priority: step.priority
    });
  }
  for (const recoveryPath of restartSafeCommand.recoveryPaths) {
    putAction({
      action: normalizeClientRouteAction(recoveryPath.action, "inspect-recovery-checkpoint"),
      label: recoveryPath.action.replaceAll("-", " "),
      enabled: restartSafeCommand.accepted || recoveryPath.action === "return-cached-result",
      reason: recoveryPath.reason,
      source: "restart-safe-command",
      priority: restartSafeCommand.commandStatus === "ready" ? "high" : "normal"
    });
  }
  for (const action of operationalHealth.degradedMode.allowedActions) {
    putAction({
      action: normalizeClientRouteAction(action, "inspect-health"),
      enabled: true,
      reason: operationalHealth.status,
      source: "operational-health"
    });
  }

  const disabledByHealth = new Set(operationalHealth.degradedMode.disabledActions);
  const actions = Array.from(actionsByName.values())
    .map((action) => ({
      ...action,
      enabled: action.enabled && !disabledByHealth.has(action.action),
      disabledReason: disabledByHealth.has(action.action) ? "disabled_by_operational_health" : action.enabled ? null : action.reason
    }))
    .sort((left, right) => {
      if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
      if (left.priority !== right.priority) return left.priority === "high" ? -1 : 1;
      return left.action.localeCompare(right.action);
    });
  const requestedAction = actions.find((action) => action.action === clientRuntime.requestedAction) || null;
  const requiredAction = actions.find((action) => action.action === clientWorkflowHandoff.requiredAction) || null;
  const primaryAction = requestedAction && requestedAction.enabled
    ? requestedAction
    : requiredAction && requiredAction.enabled
      ? requiredAction
      : actions.find((action) => action.enabled)
        || {
          action: "inspect-recovery-checkpoint",
          enabled: true,
          reason: "fallback_inspection_available",
          label: "Inspect recovery checkpoint",
          source: "fallback",
          blocking: false,
          priority: "normal",
          disabledReason: null
        };
  const continuationUrl = `${clientRuntime.route}?workflowId=${encodeURIComponent(clientRuntime.workflowId)}&requestId=${encodeURIComponent(clientRuntime.requestId)}&action=${encodeURIComponent(primaryAction.action)}`;
  const envelopeDigest = buildRecoveryDigest({
    requestFingerprint: clientRuntime.requestFingerprint,
    requiredAction: clientWorkflowHandoff.requiredAction,
    primaryAction: primaryAction.action,
    commandKey: restartSafeCommand.commandKey,
    healthStatus: operationalHealth.status,
    exportManifestId: exportSummary.manifest.manifestId,
    handoffState: externalHandoff.state
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.hostedClientActionEnvelope.v1",
    ready: primaryAction.enabled && clientWorkflowHandoff.ready && restartSafeCommand.accepted && operationalHealth.status !== "critical",
    state: clientWorkflowHandoff.state,
    requestedAction: clientRuntime.requestedAction,
    primaryAction,
    continuation: {
      url: continuationUrl,
      resumeToken: clientWorkflowHandoff.resume.token,
      requestFingerprint: clientRuntime.requestFingerprint,
      commandKey: restartSafeCommand.commandKey,
      retryAt: operationalHealth.retry.nextRetryAt,
      handoffProviderId: externalHandoff.selectedProviderId,
      manifestId: exportSummary.manifest.manifestId
    },
    actions,
    disabledActions: actions
      .filter((action) => !action.enabled)
      .map((action) => ({ action: action.action, reason: action.disabledReason || action.reason })),
    userVisibleWorkflow: {
      title: clientWorkflowHandoff.displayState.title,
      status: clientWorkflowHandoff.displayState.primaryStatus,
      primaryBlockedReason: clientWorkflowHandoff.displayState.primaryBlockedReason,
      recordCount: clientWorkflowHandoff.displayState.recordCount,
      offlineMode: clientWorkflowHandoff.displayState.offlineMode,
      healthStatus: operationalHealth.status
    },
    audit: {
      schema: "aios.auditRecovery.recoveryCheckpoint.hostedClientActionEnvelopeAudit.v1",
      generatedAt: now,
      envelopeDigest,
      actionCount: actions.length,
      disabledActionCount: actions.filter((action) => !action.enabled).length,
      requestedActionEnabled: requestedAction ? requestedAction.enabled : false,
      restartSafeCommandStatus: restartSafeCommand.commandStatus,
      externalHandoffState: externalHandoff.state
    }
  };
}

function buildHostedPreviewAcceptancePanel(
  clientRuntime,
  previewAcceptance,
  validationSummary,
  nextSteps,
  hostedClientActionEnvelope,
  operationAuthorization,
  lifecycle,
  exportSummary,
  operationalHealth,
  now
) {
  const visibleActions = hostedClientActionEnvelope.actions
    .filter((action) => action.enabled || action.blocking || action.action === clientRuntime.requestedAction)
    .map((action) => ({
      action: action.action,
      label: action.label,
      enabled: action.enabled,
      disabledReason: action.disabledReason,
      priority: action.priority,
      requested: action.action === clientRuntime.requestedAction,
      primary: action.action === hostedClientActionEnvelope.primaryAction.action
    }));
  const readinessGates = [
    {
      gate: "lifecycle",
      ready: previewAcceptance.readiness.lifecycleReady,
      reason: previewAcceptance.readiness.lifecycleReady ? "lifecycle_ready" : lifecycle.disabledReason || "lifecycle_not_ready"
    },
    {
      gate: "validation",
      ready: previewAcceptance.readiness.validationReady,
      reason: previewAcceptance.readiness.validationReady ? "validation_ready" : validationSummary.blockingCodes[0] || "validation_blocked"
    },
    {
      gate: "export",
      ready: previewAcceptance.readiness.exportReady,
      reason: previewAcceptance.readiness.exportReady ? "export_ready" : exportSummary.blockedReason || "export_not_ready"
    },
    {
      gate: "acceptance",
      ready: previewAcceptance.readiness.acceptanceReady,
      reason: previewAcceptance.readiness.acceptanceReady
        ? "acceptance_ready"
        : previewAcceptance.acceptance.blockedReasons[0] || "acceptance_required"
    },
    {
      gate: "authorization",
      ready: operationAuthorization.authorized,
      reason: operationAuthorization.authorized
        ? "operation_authorized"
        : operationAuthorization.blockedReasons[0] || "operation_authorization_blocked"
    },
    {
      gate: "health",
      ready: operationalHealth.status !== "critical",
      reason: operationalHealth.status
    }
  ];
  const primaryStep = nextSteps.steps.find((step) => step.id === nextSteps.primaryStepId) || nextSteps.steps[0] || null;
  const blockingGates = readinessGates.filter((gate) => !gate.ready);
  const selectedCheckpointIds = previewAcceptance.preview.records
    .filter((record) => record.selected)
    .map((record) => record.checkpointId);
  const routePayloadDigest = buildRecoveryDigest({
    requestFingerprint: clientRuntime.requestFingerprint,
    previewState: previewAcceptance.display.state,
    selectedCheckpointIds,
    acceptanceDigest: previewAcceptance.acceptance.acceptanceDigest,
    validationBlockingCodes: validationSummary.blockingCodes,
    primaryAction: hostedClientActionEnvelope.primaryAction.action,
    primaryStepId: nextSteps.primaryStepId,
    authorizationDigest: operationAuthorization.authorizationDigest,
    healthStatus: operationalHealth.status
  });

  return {
    generatedAt: now,
    schema: "aios.auditRecovery.recoveryCheckpoint.hostedPreviewAcceptancePanel.v1",
    routeContract: {
      route: clientRuntime.route,
      requestedAction: clientRuntime.requestedAction,
      continuationUrl: hostedClientActionEnvelope.continuation.url,
      requestId: clientRuntime.requestId,
      workflowId: clientRuntime.workflowId,
      correlationId: clientRuntime.correlationId,
      userVisible: clientRuntime.userVisible,
      offline: clientRuntime.offline
    },
    summary: {
      state: previewAcceptance.display.state,
      title: previewAcceptance.display.title,
      primaryReason: previewAcceptance.display.primaryReason,
      checkpointCount: previewAcceptance.preview.recordCount,
      selectedCheckpointCount: previewAcceptance.preview.selectedCount,
      selectedSizeBytes: previewAcceptance.preview.selectedSizeBytes,
      proofCoverage: previewAcceptance.preview.proofCoverage,
      manifestId: previewAcceptance.preview.manifestId,
      blockingGateCount: blockingGates.length
    },
    acceptanceControl: {
      required: previewAcceptance.acceptance.required,
      accepted: previewAcceptance.acceptance.accepted,
      acceptedBy: previewAcceptance.acceptance.acceptedBy,
      acceptedAt: previewAcceptance.acceptance.acceptedAt,
      acceptedCheckpointIds: previewAcceptance.acceptance.acceptedCheckpointIds,
      selectedCheckpointIds,
      blockedReasons: previewAcceptance.acceptance.blockedReasons,
      proof: previewAcceptance.acceptance.proof
    },
    readiness: {
      ready: previewAcceptance.readiness.ready
        && operationAuthorization.authorized
        && operationalHealth.status !== "critical",
      dispatchReady: previewAcceptance.readiness.routeDispatchReady
        && operationAuthorization.authorized
        && operationalHealth.status !== "critical",
      gates: readinessGates,
      blockingGates,
      routeDisabledReasons: hostedClientActionEnvelope.disabledActions
    },
    validation: {
      valid: validationSummary.valid,
      blockingCodes: validationSummary.blockingCodes,
      warningCodes: validationSummary.warningCodes,
      proofLedgerReady: validationSummary.proofLedgerReady,
      proofLedgerDigest: validationSummary.proofLedgerDigest,
      boundaryReady: validationSummary.boundaryReady,
      operationAuthorized: operationAuthorization.authorized,
      operationAuthorizationDigest: operationAuthorization.authorizationDigest
    },
    nextStep: primaryStep
      ? {
          id: primaryStep.id,
          action: primaryStep.action,
          routeAction: normalizeClientRouteAction(primaryStep.routeAction, hostedClientActionEnvelope.primaryAction.action),
          label: primaryStep.label,
          reason: primaryStep.reason,
          blocking: primaryStep.blocking,
          owner: primaryStep.owner,
          priority: primaryStep.priority
        }
      : null,
    routeActions: visibleActions,
    previewRows: previewAcceptance.preview.records.map((record) => ({
      checkpointId: record.checkpointId,
      source: record.source,
      status: record.status,
      timestamp: record.timestamp,
      selected: record.selected,
      selectable: record.selectable,
      restoreImpact: record.restoreImpact,
      proofState: record.proofState,
      validationState: record.validationState,
      rowIssues: record.rowIssues
    })),
    audit: {
      schema: "aios.auditRecovery.recoveryCheckpoint.hostedPreviewAcceptancePanelAudit.v1",
      generatedAt: now,
      routePayloadDigest,
      primaryAction: hostedClientActionEnvelope.primaryAction.action,
      blockingGateCount: blockingGates.length,
      selectedCheckpointCount: selectedCheckpointIds.length,
      validationBlockingCount: validationSummary.blockingCodes.length,
      operationAuthorized: operationAuthorization.authorized,
      healthStatus: operationalHealth.status
    }
  };
}

export function describeRecoveryCheckpointSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const accessScope = normalizeTenantScope(input);
  const rawEvents = Array.isArray(input.checkpoints)
    ? input.checkpoints
    : Array.isArray(input.evidence)
      ? input.evidence
      : [];
  const rawCheckpoints = rawEvents.map((event, index) => normalizeCheckpointEvent(event, index, now, accessScope));
  const rawProviderContracts = normalizeProviderContracts(input);
  const rawProofArtifacts = normalizeProofArtifacts(input, accessScope, now);
  const clientRuntime = normalizeClientRuntimeContext(input, accessScope, now);
  const persistedState = normalizePersistedRecoveryState(input, accessScope, now);
  const boundary = applyTenantBoundary(rawCheckpoints, rawProviderContracts, accessScope, now);
  const proofArtifactBoundary = applyProofArtifactBoundary(rawProofArtifacts, accessScope, now);
  const checkpoints = boundary.checkpoints;
  const providerContracts = boundary.providers;
  const proofArtifacts = proofArtifactBoundary.artifacts;
  const analytics = buildAnalytics(checkpoints);
  const lifecycleSettings = normalizeLifecycleSettings(input);
  const lifecycleValidation = buildLifecycleValidation(lifecycleSettings, analytics);
  const permissionValidation = buildPermissionValidation(accessScope, lifecycleSettings, analytics);
  const lifecycleScheduleControl = buildLifecycleScheduleControl(lifecycleSettings, lifecycleValidation, now);
  const lifecycleCommandControl = buildLifecycleCommandControl(
    lifecycleSettings,
    lifecycleValidation,
    permissionValidation,
    lifecycleScheduleControl,
    accessScope,
    analytics,
    now
  );
  const lifecycle = buildLifecycleState(
    lifecycleSettings,
    analytics,
    lifecycleValidation,
    permissionValidation,
    lifecycleScheduleControl,
    lifecycleCommandControl,
    now
  );
  const history = buildHistorySnapshots(checkpoints, now);
  const timeline = buildTimeline(checkpoints);
  const replayLedger = buildReplayLedger(checkpoints, now, persistedState);
  const analyticsExportOptions = normalizeAnalyticsExportOptions(input, now);
  const proofLedger = buildProofLedger(checkpoints, proofArtifacts, lifecycleSettings, now);
  const exportSummary = buildExportSummary(checkpoints, analytics, now, lifecycle, accessScope, proofLedger);
  const capabilityNegotiation = negotiateProviderCapabilities(providerContracts, input);
  const providerSync = buildProviderSyncMetadata(providerContracts, checkpoints, now);
  const resumeGuard = normalizeResumeGuard(input, checkpoints, accessScope, now);
  const externalHandoff = buildExternalHandoffState(
    providerContracts,
    exportSummary,
    capabilityNegotiation,
    lifecycle,
    accessScope,
    now,
    input
  );
  const mailchimpHandoff = buildMailchimpExternalHandoffProjection(
    providerContracts,
    exportSummary,
    externalHandoff,
    accessScope,
    now,
    input
  );
  const integrationProviderContracts = buildIntegrationProviderContracts(
    providerContracts,
    checkpoints,
    proofArtifacts,
    capabilityNegotiation,
    providerSync,
    externalHandoff,
    now
  );
  const operationAuthorization = buildOperationAuthorization(
    input,
    accessScope,
    clientRuntime,
    checkpoints,
    providerContracts,
    externalHandoff,
    now
  );
  const validationSummary = buildValidationSummary(
    lifecycleValidation,
    permissionValidation,
    capabilityNegotiation,
    exportSummary,
    externalHandoff,
    boundary.audit,
    proofLedger,
    proofArtifactBoundary.audit,
    operationAuthorization,
    replayLedger,
    resumeGuard
  );
  const analyticsExport = buildAnalyticsExportState(
    checkpoints,
    analytics,
    history,
    timeline,
    exportSummary,
    validationSummary,
    analyticsExportOptions,
    accessScope,
    now
  );
  const previewAcceptance = buildRecoveryPreviewContract(
    checkpoints,
    lifecycle,
    exportSummary,
    providerContracts,
    validationSummary,
    now,
    input
  );
  const previewAcceptanceExportManifest = buildPreviewAcceptanceExportManifest(
    previewAcceptance,
    analyticsExport,
    exportSummary,
    validationSummary,
    accessScope,
    now
  );
  const previewResumeTokenHandoff = buildPreviewResumeTokenHandoff(
    previewAcceptance,
    previewAcceptanceExportManifest,
    clientRuntime,
    accessScope,
    externalHandoff,
    mailchimpHandoff,
    now
  );
  const mailchimpRuntimeHandoffGate = buildMailchimpRuntimeHandoffGate(
    mailchimpHandoff,
    previewAcceptance,
    previewAcceptanceExportManifest,
    previewResumeTokenHandoff,
    clientRuntime,
    accessScope,
    now
  );
  const clientWorkflowHandoff = buildClientWorkflowHandoff(
    clientRuntime,
    lifecycle,
    validationSummary,
    previewAcceptance,
    externalHandoff,
    exportSummary,
    providerSync,
    now,
    mailchimpRuntimeHandoffGate
  );
  const nextSteps = buildExplainableNextSteps(
    lifecycle,
    validationSummary,
    previewAcceptance,
    externalHandoff,
    capabilityNegotiation,
    now
  );
  const reportingState = buildReportingState(
    analytics,
    history,
    timeline,
    exportSummary,
    validationSummary,
    providerSync,
    analyticsExport,
    now
  );
  const restartSafeCommand = buildRestartSafeCommandState(
    persistedState,
    accessScope,
    clientRuntime,
    lifecycle,
    validationSummary,
    previewAcceptance,
    exportSummary,
    proofLedger,
    providerSync,
    now
  );
  const persistedProjection = buildPersistedRecoveryProjection(
    persistedState,
    checkpoints,
    providerSync,
    restartSafeCommand,
    lifecycle,
    exportSummary,
    proofLedger,
    replayLedger,
    clientRuntime,
    now
  );
  const operationalHealth = buildOperationalHealthState(
    input,
    checkpoints,
    analytics,
    lifecycle,
    validationSummary,
    capabilityNegotiation,
    integrationProviderContracts.contracts,
    providerSync,
    proofLedger,
    externalHandoff,
    clientRuntime,
    restartSafeCommand,
    boundary.audit,
    proofArtifactBoundary.audit,
    persistedState,
    now
  );
  const restartCommandExportEnvelope = buildRestartCommandExportEnvelope(
    persistedProjection,
    restartSafeCommand,
    analyticsExport,
    exportSummary,
    externalHandoff,
    operationalHealth,
    now
  );
  const hostedClientActionEnvelope = buildHostedClientActionEnvelope(
    clientRuntime,
    clientWorkflowHandoff,
    nextSteps,
    restartSafeCommand,
    operationalHealth,
    externalHandoff,
    exportSummary,
    now
  );
  const hostedPreviewAcceptancePanel = buildHostedPreviewAcceptancePanel(
    clientRuntime,
    previewAcceptance,
    validationSummary,
    nextSteps,
    hostedClientActionEnvelope,
    operationAuthorization,
    lifecycle,
    exportSummary,
    operationalHealth,
    now
  );
  const operatorBoundaryActionPlan = buildOperatorBoundaryActionPlan({
    accessScope,
    boundaryAudit: boundary.audit,
    proofArtifactBoundaryAudit: proofArtifactBoundary.audit,
    lifecycle,
    commandControl: lifecycleCommandControl,
    scheduleControl: lifecycleScheduleControl,
    permissionValidation,
    capabilityNegotiation,
    resumeGuard,
    externalHandoff,
    now
  });
  const recoveryReadiness = buildRecoveryReadinessEnvelope({
    accessScope,
    analytics,
    lifecycle,
    lifecycleValidation,
    permissionValidation,
    capabilityNegotiation,
    providerSync,
    integrationProviderContracts,
    proofLedger,
    replayLedger,
    resumeGuard,
    externalHandoff,
    operationalHealth,
    operatorBoundaryActionPlan,
    now
  });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "aios.auditRecovery.recoveryCheckpoint.v1",
    acceptedInputs: {
      checkpoints: "array of checkpoint recovery events",
      evidence: "legacy alias accepted when checkpoints is absent",
      lifecycleSettings: "enable/disable, validation, proof, export, retention, and schedule controls",
      settings: "legacy lifecycleSettings alias",
      command: "optional lifecycle command: enable, disable, validate, schedule, run-now, or pause",
      requestedRunAt: "lifecycleSettings timestamp for one-shot scheduling",
      lastRunAt: "lifecycleSettings timestamp used to compute interval due state",
      pausedUntil: "lifecycleSettings timestamp that blocks due runs during a pause window",
      providerContracts: "array of recovery provider service contracts with capabilities, endpoint refs, sync metadata, service versions, batching, and handoff terms",
      providers: "legacy providerContracts alias",
      accessScope: "tenant/workspace access scope with roles and permissions",
      scope: "legacy accessScope alias",
      requestedCapabilities: "capability negotiation request for hosted recovery services",
      proofArtifacts: "array of hosted proof artifact contracts keyed by proofRef or checkpointId",
      proofs: "legacy proofArtifacts alias",
      externalHandoff: "optional external handoff target and requested state",
      acceptance: "optional operator acceptance contract with acceptedBy, acceptedAt, and checkpointIds",
      previewAcceptance: "legacy acceptance alias accepted when acceptance is absent",
      clientRuntime: "hosted client context with clientId, sessionId, locale, timezone, route, and offline/userVisible state",
      client: "legacy clientRuntime alias",
      request: "request context with requestId, workflowId, route, method, routeAction/action, correlationId, and idempotencyKey",
      operation: "optional requested operation contract with action, actor, target tenant/workspace, checkpointIds, and providerId for scoped authorization",
      operationRequest: "legacy operation alias accepted when operation is absent",
      persistedState: "restart-safe persisted recovery state with checkpoint ids, command keys, cursors, and hydration timestamps",
      recoveryState: "legacy persistedState alias",
      state: "legacy persistedState alias",
      operationalHealth: "optional hosted-kernel health contract including retryPolicy, retryAttempt, health signals/probes, and operational errors",
      healthSignals: "legacy operationalHealth.signals alias for hosted-kernel health probes",
      operationalErrors: "legacy operationalHealth.errors alias for actionable hosted-kernel errors",
      retryPolicy: "legacy operationalHealth.retryPolicy alias",
      analyticsExport: "optional analytics export contract with formats, groupBy, since/until, timeline/history inclusion, and trend period controls",
      reportOptions: "legacy analyticsExport alias",
      reporting: "legacy analyticsExport alias",
      previewAcceptanceExportManifest: "derived digest-backed export manifest for accepted recovery checkpoint preview rows and dispatch handoff state",
      previewResumeTokenHandoff: "derived route/client handoff packet that lets resume-token adopt an accepted checkpoint preview without rebuilding acceptance state",
      mailchimpRuntimeHandoffGate: "derived Mailchimp runtime gate binding preview acceptance, export manifest, resume-token handoff, client acknowledgements, and consent boundaries before dispatch",
      replayDigest: "optional per-checkpoint replay digest used to verify append-only boot/run/claim recovery chains",
      previousReplayDigest: "optional previous digest for validating replay continuity across checkpoint events",
      eventType: "optional checkpoint event type: boot, run, claim, checkpoint, validation, restore, or handoff",
      mailchimp: "optional Mailchimp handoff contract with audienceId/listId, campaignId, automationId/journeyId, dataCenter, exportMode, mergeFieldMap, and consent boundary controls",
      "externalHandoff.mailchimp": "Mailchimp-specific external handoff request overriding provider-level Mailchimp defaults"
    },
    analytics,
    analyticsExportOptions,
    analyticsExport,
    accessScope,
    clientRuntime,
    persistedState,
    persistedProjection,
    restartSafeCommand,
    restartCommandExportEnvelope,
    operationalHealth,
    operationAuthorization,
    boundaryAudit: boundary.audit,
    proofArtifactBoundaryAudit: proofArtifactBoundary.audit,
    lifecycle,
    lifecycleScheduleControl,
    lifecycleCommandControl,
    lifecycleValidation,
    permissionValidation,
    providerContracts,
    capabilityNegotiation,
    providerSync,
    integrationProviderContracts,
    mailchimpHandoff,
    proofArtifacts,
    proofLedger,
    replayLedger,
    externalHandoff,
    validationSummary,
    previewAcceptance,
    previewAcceptanceExportManifest,
    previewResumeTokenHandoff,
    mailchimpRuntimeHandoffGate,
    clientWorkflowHandoff,
    hostedClientActionEnvelope,
    hostedPreviewAcceptancePanel,
    nextSteps,
    history,
    timeline,
    reportingState,
    operatorBoundaryActionPlan,
    recoveryReadiness,
    report: {
      checkpointCount: checkpoints.length,
      recoveredCount: analytics.counters.restored,
      exportReadyCount: exportSummary.recordCount,
      exportManifestId: exportSummary.manifest.manifestId,
      proofLedgerDigest: proofLedger.ledgerDigest,
      replayLedgerDigest: replayLedger.ledgerDigest,
      replayLedgerReady: replayLedger.valid,
      resumeGuardReady: resumeGuard.ready,
      resumeGuardState: resumeGuard.state,
      resumeGuardBlockerCount: resumeGuard.blockers.length,
      resumeGuardDigest: resumeGuard.proof.digest,
      replayLatestDigest: replayLedger.latestDigest,
      replayEventCount: replayLedger.entryCount,
      replayBootEventCount: replayLedger.bootEventCount,
      replayRunEventCount: replayLedger.runEventCount,
      replayClaimEventCount: replayLedger.claimEventCount,
      replayIssueCount: replayLedger.issues.length,
      proofArtifactBackedCount: proofLedger.artifactBackedCount,
      proofLedgerReady: proofLedger.ready,
      providerCount: providerContracts.length,
      integrationProviderContractReady: integrationProviderContracts.ready,
      integrationProviderContractDigest: integrationProviderContracts.digest,
      blockedIntegrationProviderContractCount: integrationProviderContracts.blockedContractCount,
      staleProviderSyncIds: integrationProviderContracts.syncWatermark.staleProviderIds,
      mailchimpHandoffReady: mailchimpHandoff.ready,
      mailchimpHandoffState: mailchimpHandoff.state,
      mailchimpHandoffProjectionId: mailchimpHandoff.projectionId,
      mailchimpHandoffProviderId: mailchimpHandoff.providerId,
      mailchimpHandoffTargetType: mailchimpHandoff.target?.type || null,
      mailchimpHandoffAudienceId: mailchimpHandoff.target?.audienceId || null,
      mailchimpHandoffCampaignId: mailchimpHandoff.target?.campaignId || null,
      mailchimpHandoffExportMode: mailchimpHandoff.export.mode,
      mailchimpHandoffBlockerCount: mailchimpHandoff.blockers.length,
      mailchimpHandoffWarningCount: mailchimpHandoff.warnings.length,
      mailchimpRuntimeGateReady: mailchimpRuntimeHandoffGate.ready,
      mailchimpRuntimeGateState: mailchimpRuntimeHandoffGate.state,
      mailchimpRuntimeGateNextAction: mailchimpRuntimeHandoffGate.nextAction,
      mailchimpRuntimeGateDigest: mailchimpRuntimeHandoffGate.proof.digest,
      mailchimpRuntimeGateBlockerCount: mailchimpRuntimeHandoffGate.blockers.length,
      mailchimpRuntimeGateDispatchable: Boolean(mailchimpRuntimeHandoffGate.dispatchPayload),
      boundaryExcludedCount: boundary.audit.excludedCheckpointCount
        + boundary.audit.excludedProviderCount
        + proofArtifactBoundary.audit.excludedProofArtifactCount,
      handoffReady: externalHandoff.ready,
      clientWorkflowState: clientWorkflowHandoff.state,
      clientRequiredAction: clientWorkflowHandoff.requiredAction,
      clientResumeToken: clientWorkflowHandoff.resume.token,
      clientPrimaryAction: hostedClientActionEnvelope.primaryAction.action,
      clientContinuationUrl: hostedClientActionEnvelope.continuation.url,
      clientActionEnvelopeDigest: hostedClientActionEnvelope.audit.envelopeDigest,
      clientRequestedActionEnabled: hostedClientActionEnvelope.audit.requestedActionEnabled,
      hostedPreviewPanelDigest: hostedPreviewAcceptancePanel.audit.routePayloadDigest,
      hostedPreviewPanelReady: hostedPreviewAcceptancePanel.readiness.ready,
      hostedPreviewPanelDispatchReady: hostedPreviewAcceptancePanel.readiness.dispatchReady,
      hostedPreviewPanelBlockingGateCount: hostedPreviewAcceptancePanel.summary.blockingGateCount,
      restartSafeCommandKey: restartSafeCommand.commandKey,
      restartSafeCommandStatus: restartSafeCommand.commandStatus,
      restartDetected: restartSafeCommand.restartDetected,
      restartCommandExportState: restartCommandExportEnvelope.state,
      restartCommandExportReady: restartCommandExportEnvelope.ready,
      restartCommandExportDigest: restartCommandExportEnvelope.proof.digest,
      restartCommandExportBlockerCount: restartCommandExportEnvelope.blockers.length,
      persistedProjectionDigest: persistedProjection.compareAndSwap.nextProjectionDigest,
      persistedProjectionWriteIntent: persistedProjection.writeIntent,
      persistedProjectionStatus: persistedProjection.restartSafeStatus,
      persistedProjectionCasRequired: persistedProjection.compareAndSwap.required,
      operationalHealthStatus: operationalHealth.status,
      operationalHealthHealthy: operationalHealth.healthy,
      operationalHealthRetryAllowed: operationalHealth.retry.allowed,
      operationalHealthNextRetryAt: operationalHealth.retry.nextRetryAt,
      operationalHealthErrorCount: operationalHealth.actionableErrors.length,
      operationalHealthHostedKernelSignalCount: operationalHealth.hostedKernelSignals.activeSignalCount,
      operationalHealthHostedKernelPrimarySignal: operationalHealth.hostedKernelSignals.primarySignalCode,
      operationalHealthHostedKernelExcludedSignalCount: operationalHealth.hostedKernelSignals.excludedSignalCount,
      operationalHealthRetryableFailureCount: operationalHealth.failureState.profiles.retryableFailureCount,
      operationalHealthTerminalFailureCount: operationalHealth.failureState.profiles.terminalFailureCount,
      operationalHealthPrimaryFailure: operationalHealth.failureState.profiles.primaryFailure,
      operationalHealthRemediationActions: operationalHealth.retry.remediationActions,
      operationAuthorized: operationAuthorization.authorized,
      operationRequestedAction: operationAuthorization.requestedAction,
      operationAuthorizationDigest: operationAuthorization.authorizationDigest,
      operationBlockedReasonCount: operationAuthorization.blockedReasons.length,
      previewReady: previewAcceptance.readiness.ready,
      previewAcceptanceExportReady: previewAcceptanceExportManifest.ready,
      previewAcceptanceExportState: previewAcceptanceExportManifest.state,
      previewAcceptanceExportManifestId: previewAcceptanceExportManifest.manifestId,
      previewAcceptanceExportDigest: previewAcceptanceExportManifest.proof.digest,
      previewAcceptanceExportSelectedCount: previewAcceptanceExportManifest.selectedCheckpointCount,
      previewAcceptanceExportBlockerCount: previewAcceptanceExportManifest.blockingReasons.length,
      previewResumeTokenHandoffState: previewResumeTokenHandoff.state,
      previewResumeTokenHandoffAccepted: previewResumeTokenHandoff.accepted,
      previewResumeTokenHandoffId: previewResumeTokenHandoff.handoffId,
      previewResumeTokenId: previewResumeTokenHandoff.resumeToken.tokenId,
      previewResumeTokenCheckpointId: previewResumeTokenHandoff.resumeToken.checkpointId,
      previewResumeTokenAdoptable: previewResumeTokenHandoff.clientStateAdoption.canAdopt,
      previewResumeTokenHandoffDigest: previewResumeTokenHandoff.proof.digest,
      previewResumeTokenHandoffBlockerCount: previewResumeTokenHandoff.blockers.length,
      previewResumeTokenMailchimpGateState: mailchimpRuntimeHandoffGate.state,
      validationReady: validationSummary.valid,
      operationalPosture: reportingState.operationalPosture,
      analyticsExportReady: analyticsExport.ready,
      analyticsExportId: analyticsExport.exportId,
      analyticsExportDigest: analyticsExport.digest,
      analyticsExportBlockedReason: analyticsExport.blockedReason,
      analyticsExportWindowEventCount: analyticsExport.window.eventCount,
      analyticsExportGroupedRowCount: analyticsExport.groupedRows.length,
      analyticsExportTimelineRowCount: analyticsExport.timelineRows.length,
      analyticsRestoredTrendDelta: analyticsExport.trend.restoredDelta,
      analyticsFailedTrendDelta: analyticsExport.trend.failedDelta,
      lifecycleCommand: lifecycle.command,
      lifecycleScheduleState: lifecycleScheduleControl.state,
      lifecycleScheduleDue: lifecycleScheduleControl.due,
      lifecycleNextRunAt: lifecycleScheduleControl.nextRunAt,
      lifecycleCommandAccepted: lifecycleCommandControl.accepted,
      lifecycleCommandRouteAction: lifecycleCommandControl.routeAction,
      lifecycleCommandWriteRequired: lifecycleCommandControl.persistence.writeRequired,
      lifecycleCommandBlockedReasonCount: lifecycleCommandControl.blockedReasons.length,
      operatorBoundaryActionState: operatorBoundaryActionPlan.state,
      operatorBoundaryNextAction: operatorBoundaryActionPlan.nextAction,
      operatorBoundaryBlockedReasonCount: operatorBoundaryActionPlan.blockedReasons.length,
      operatorBoundarySafe: operatorBoundaryActionPlan.boundary.safeBoundary,
      recoveryReadinessState: recoveryReadiness.state,
      recoveryReadinessReady: recoveryReadiness.ready,
      recoveryReadinessPrimaryAction: recoveryReadiness.primaryAction,
      recoveryReadinessRouteAction: recoveryReadiness.routeAction,
      recoveryReadinessBlockerCount: recoveryReadiness.counts.blockerCount,
      recoveryReadinessWarningCount: recoveryReadiness.counts.warningCount,
      recoveryReadinessDigest: recoveryReadiness.audit.digest,
      attentionSources: reportingState.attentionSources,
      attentionRequired: recoveryReadiness.ready === false || analytics.counters.failed > 0 || !validationSummary.valid || capabilityNegotiation.degraded,
      latestStatus: timeline.length ? timeline[timeline.length - 1].status : "empty"
    },
    exportSummary,
    evidence: checkpoints
  };
}

export default describeRecoveryCheckpointSurface;
