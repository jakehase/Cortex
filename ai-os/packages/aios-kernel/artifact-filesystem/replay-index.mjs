export const surfaceId = "aios_artifact-filesystem_replay-index_038";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "replay-index";

const LIFECYCLE_COMMANDS = new Set([
  "enable",
  "disable",
  "pause",
  "resume",
  "rebuild",
  "compact"
]);

const SCHEDULE_CADENCES = new Set(["manual", "hourly", "daily", "weekly"]);
const PROOF_MODES = new Set(["summary", "strict"]);
const PROVIDER_TYPES = new Set(["kernel", "artifact-store", "replay-worker", "external"]);
const CAPABILITY_STATUS = new Set(["available", "degraded", "unavailable"]);
const HANDOFF_DELIVERY_MODES = new Set(["push", "pull", "webhook"]);
const HANDOFF_LEASE_STATES = new Set(["open", "held", "expired", "revoked"]);
const CLIENT_WORKFLOW_INTENTS = new Set(["inspect", "schedule", "publish", "rebuild", "compact", "resume"]);
const CLIENT_HANDOFF_ACKS = new Set(["accepted", "acknowledged", "ready"]);
const CLIENT_WORKFLOW_STEP_STATES = new Set(["pending", "ready", "blocked", "complete", "skipped"]);
const CLIENT_WORKFLOW_CHANNELS = new Set(["route", "panel", "modal", "toast", "api"]);
const PERSISTED_STATES = new Set(["clean", "dirty", "applying", "recovering", "blocked"]);
const PERSISTED_COMMAND_RESULTS = new Set(["pending", "applied", "blocked", "failed", "rolled-back", "already-applied"]);
const ACCESS_ROLES = new Set(["owner", "maintainer", "operator", "auditor", "viewer"]);
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HEALTH_STATES = new Set(["healthy", "degraded", "failed"]);
const FAILURE_SEVERITIES = new Set(["info", "warning", "error", "fatal"]);
const RETRY_MODES = new Set(["automatic", "manual", "disabled"]);
const REPLAY_PROOF_DIGEST_PATTERN = /^(?:[a-z0-9][a-z0-9+.-]{1,31}:)?[a-f0-9]{32,128}$/i;
const REPLAY_PROOF_SCOPES = new Set(["record", "payload", "audit", "artifact", "handoff"]);
const SCHEDULE_HOLD_REASONS = new Set([
  "operator-hold",
  "maintenance-window",
  "backpressure",
  "dependency-unavailable",
  "client-handoff",
  "manual-approval",
  "debounce-window"
]);
const SCHEDULE_RUN_MODES = new Set(["normal", "catch-up", "manual-approval"]);
const LIFECYCLE_CONTROL_STATES = new Set(["active", "disabled", "paused", "blocked"]);
const LIFECYCLE_CONTROL_REASONS = new Set([
  "operator-hold",
  "maintenance-window",
  "backpressure",
  "dependency-unavailable",
  "client-handoff",
  "settings-invalid",
  "persistence-recovery",
  "command-locked"
]);
const ROLE_PERMISSIONS = Object.freeze({
  owner: ["replay.inspect", "replay.schedule", "replay.rebuild", "replay.compact", "handoff.publish", "audit.read"],
  maintainer: ["replay.inspect", "replay.schedule", "replay.rebuild", "replay.compact", "handoff.publish", "audit.read"],
  operator: ["replay.inspect", "replay.schedule", "replay.rebuild", "replay.compact", "audit.read"],
  auditor: ["replay.inspect", "audit.read"],
  viewer: ["replay.inspect"]
});
const COMMAND_PERMISSIONS = Object.freeze({
  enable: ["replay.schedule"],
  disable: ["replay.schedule"],
  pause: ["replay.schedule"],
  resume: ["replay.schedule"],
  rebuild: ["replay.rebuild"],
  compact: ["replay.compact"]
});
const COMMAND_DESCRIPTIONS = Object.freeze({
  enable: "Enable scheduled replay-index refreshes",
  disable: "Disable scheduled replay-index refreshes",
  pause: "Hold replay-index refreshes for the current scheduler decision",
  resume: "Resume replay-index refreshes and refresh route state",
  rebuild: "Rebuild replay-index rows from retained replay records",
  compact: "Compact retained replay-index rows within retention limits"
});
const REQUIRED_CAPABILITIES = [
  "artifact.read",
  "replay.enumerate",
  "index.write"
];
const SERVICE_OPERATIONS = Object.freeze([
  {
    id: "artifact-read",
    phase: "source",
    requiredCapabilities: ["artifact.read"],
    required: true,
    description: "Read replay source artifacts from the hosted artifact store"
  },
  {
    id: "replay-enumerate",
    phase: "source",
    requiredCapabilities: ["replay.enumerate"],
    required: true,
    description: "Enumerate replay records eligible for indexing"
  },
  {
    id: "index-write",
    phase: "index",
    requiredCapabilities: ["index.write"],
    required: true,
    description: "Write replay-index rows and cursor checkpoints"
  },
  {
    id: "proof-emit",
    phase: "proof",
    requiredCapabilities: ["proof.emit"],
    required: false,
    description: "Emit digest-backed replay-index proof output"
  },
  {
    id: "handoff-publish",
    phase: "handoff",
    requiredCapabilities: ["handoff.publish"],
    required: false,
    description: "Publish replay-index state to an external handoff target"
  }
]);

const DEFAULT_SETTINGS = {
  enabled: true,
  cadence: "hourly",
  intervalMinutes: 60,
  retentionDays: 14,
  maxEntries: 5000,
  proofMode: "summary",
  replayRoot: "artifact-filesystem/replays",
  routeName: "artifact-filesystem.replay-index"
};

const CONTRACT = Object.freeze({
  settings: {
    enabled: "boolean",
    cadence: "manual | hourly | daily | weekly",
    intervalMinutes: "integer >= 5",
    retentionDays: "integer 1..365",
    maxEntries: "integer 1..250000",
    proofMode: "summary | strict",
    replayRoot: "non-empty string",
    routeName: "non-empty string"
  },
  command: "enable | disable | pause | resume | rebuild | compact",
  output: {
    lifecycle: "normalized command state and enablement controls",
    lifecycleControls: "hosted-kernel persisted lifecycle enablement, pause, command-lock, and state-token controls",
    scheduleControls: "normalized scheduler hold/due state, run window, and eligible lifecycle commands",
    nextAction: "operator-facing hosted-kernel scheduling action",
    preview: "user-visible replay-index preview cards and route payload summary",
    acceptance: "route/client acceptance verdict with explainable blockers",
    readiness: "hosted-kernel readiness score and phase-specific checks",
    validationSummary: "field-level validation status for settings, providers, capabilities, sync, and handoff",
    operationalHealth: "runtime health, retry/backoff, degraded-mode, and actionable failure-state contract",
    nextSteps: "prioritized operator actions for the next route/client transition",
    providers: "normalized hosted-kernel provider/service contract manifests",
    serviceContract: "routeable provider operation assignments and service handoff obligations",
    capabilityNegotiation: "required and optional replay-index capability availability",
    sync: "cursor and checkpoint metadata for replay index handoff",
    persistedState: "restart-safe persisted replay-index status, command journal, and recovery plan",
    replayIndex: "retention-filtered replay record manifest with job/process/claim mappings, audit/artifact bundle refs, cursor, duplicate/conflict, invalid-row, repair-plan, and export metadata",
    clientRequest: "normalized request/client workflow state and handoff acknowledgement contract",
    accessBoundary: "tenant, workspace, actor role, permission, and isolation boundary verdict",
    handoff: "external handoff readiness, publication plan, target fences, and blocking reasons",
    analytics: "counter, trend, history, timeline, and export summary state for hosted-kernel replay-index reporting",
    audit: "machine-readable validation and transition evidence",
    proof: "stable digest-backed proof summary"
  }
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toPositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function toRatio(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.min(1, Number(numberValue.toFixed(4))));
}

function normalizeSettings(rawSettings = {}) {
  const settings = asObject(rawSettings);
  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : DEFAULT_SETTINGS.enabled,
    cadence: SCHEDULE_CADENCES.has(settings.cadence) ? settings.cadence : DEFAULT_SETTINGS.cadence,
    intervalMinutes: toPositiveInteger(settings.intervalMinutes, DEFAULT_SETTINGS.intervalMinutes),
    retentionDays: toPositiveInteger(settings.retentionDays, DEFAULT_SETTINGS.retentionDays),
    maxEntries: toPositiveInteger(settings.maxEntries, DEFAULT_SETTINGS.maxEntries),
    proofMode: PROOF_MODES.has(settings.proofMode) ? settings.proofMode : DEFAULT_SETTINGS.proofMode,
    replayRoot: typeof settings.replayRoot === "string" && settings.replayRoot.trim()
      ? settings.replayRoot.trim()
      : DEFAULT_SETTINGS.replayRoot,
    routeName: typeof settings.routeName === "string" && settings.routeName.trim()
      ? settings.routeName.trim()
      : DEFAULT_SETTINGS.routeName
  };
}

function validateSettings(settings) {
  const errors = [];
  if (!SCHEDULE_CADENCES.has(settings.cadence)) errors.push("settings.cadence is not supported");
  if (!PROOF_MODES.has(settings.proofMode)) errors.push("settings.proofMode is not supported");
  if (settings.intervalMinutes < 5) errors.push("settings.intervalMinutes must be at least 5");
  if (settings.retentionDays < 1 || settings.retentionDays > 365) {
    errors.push("settings.retentionDays must be between 1 and 365");
  }
  if (settings.maxEntries < 1 || settings.maxEntries > 250000) {
    errors.push("settings.maxEntries must be between 1 and 250000");
  }
  if (settings.replayRoot.includes("..")) errors.push("settings.replayRoot must not traverse parent directories");
  if (settings.replayRoot.startsWith("/") || settings.replayRoot.startsWith("~")) {
    errors.push("settings.replayRoot must be workspace-relative");
  }
  if (!settings.routeName.includes("replay-index")) {
    errors.push("settings.routeName must identify the replay-index route");
  }
  if (settings.cadence === "manual" && settings.intervalMinutes !== DEFAULT_SETTINGS.intervalMinutes) {
    errors.push("settings.intervalMinutes must use the default when cadence is manual");
  }
  return errors;
}

function normalizeCommand(rawCommand) {
  if (typeof rawCommand !== "string") return "resume";
  const command = rawCommand.trim().toLowerCase();
  return LIFECYCLE_COMMANDS.has(command) ? command : "resume";
}

function lifecycleCommandAllowed(command, currentStatus, blocked, lifecycleControls = null) {
  if (blocked) return false;
  if (lifecycleControls?.lockedCommands?.includes(command)) return false;
  if (lifecycleControls?.allowCommands?.length > 0 && !lifecycleControls.allowCommands.includes(command)) {
    return false;
  }
  if (command === "enable") return currentStatus === "disabled" || currentStatus === "paused";
  if (command === "disable") return currentStatus === "active" || currentStatus === "paused";
  if (command === "pause") return currentStatus === "active";
  if (command === "resume") return currentStatus === "paused" || currentStatus === "disabled";
  if (command === "rebuild" || command === "compact") return currentStatus === "active";
  return false;
}

function lifecycleCommandBlockReason(command, currentStatus, blocked, validationErrors, lifecycleControls = null) {
  if (blocked) return validationErrors[0] || "settings-invalid";
  if (lifecycleControls?.lockedCommands?.includes(command)) return `lifecycle-control:locked:${command}`;
  if (lifecycleControls?.allowCommands?.length > 0 && !lifecycleControls.allowCommands.includes(command)) {
    return `lifecycle-control:not-allowed:${command}`;
  }
  if (command === "enable" && currentStatus === "active") return "already-enabled";
  if (command === "disable" && currentStatus === "disabled") return "already-disabled";
  if (command === "pause" && currentStatus !== "active") return `cannot-pause-from-${currentStatus}`;
  if (command === "resume" && currentStatus === "active") return "already-active";
  if ((command === "rebuild" || command === "compact") && currentStatus !== "active") {
    return `requires-active-lifecycle:${currentStatus}`;
  }
  return null;
}

function buildLifecycleCommandDecision(settings, command, validationErrors, lifecycleControls) {
  const blocked = validationErrors.length > 0;
  const currentStatus = blocked
    ? "blocked"
    : lifecycleControls.observedState;
  const commandRows = [...LIFECYCLE_COMMANDS].map((name) => {
    const allowed = lifecycleCommandAllowed(name, currentStatus, blocked, lifecycleControls);
    const reason = lifecycleCommandBlockReason(name, currentStatus, blocked, validationErrors, lifecycleControls);
    return {
      command: name,
      description: COMMAND_DESCRIPTIONS[name],
      allowed,
      reason,
      permission: COMMAND_PERMISSIONS[name] || ["replay.inspect"]
    };
  });
  const requested = commandRows.find((row) => row.command === command);
  const applied = requested?.allowed
    || command === "resume"
    || (command === "enable" && currentStatus === "active")
    || (command === "disable" && currentStatus === "disabled");
  const recommended = blocked
    ? "enable"
    : currentStatus === "disabled"
      ? "enable"
      : currentStatus === "paused"
        ? "resume"
        : command === "compact"
          ? "compact"
          : command === "rebuild"
            ? "rebuild"
            : "pause";
  return {
    format: "hosted-kernel.replay-index.lifecycle-commands.v1",
    currentStatus,
    requested: command,
    applied,
    rejected: !applied,
    rejectionReason: applied ? null : requested?.reason || "unsupported-command",
    recommended,
    allowedCommands: commandRows.filter((row) => row.allowed).map((row) => row.command),
    blockedCommands: commandRows
      .filter((row) => !row.allowed)
      .map((row) => ({
        command: row.command,
        reason: row.reason || "not-eligible",
        permission: row.permission
      })),
    commandRows,
    digest: stableDigest({
      currentStatus,
      command,
      blocked,
      validationErrors,
      enabled: lifecycleControls.effectiveEnabled,
      controls: lifecycleControls.digest,
      cadence: settings.cadence,
      proofMode: settings.proofMode
    })
  };
}

function normalizeLifecycleControls(input, settings, command, now) {
  const rawControls = asObject(
    input.lifecycleControls
    || input.lifecycle
    || asObject(input.controls).lifecycle
    || asObject(input.settings).lifecycleControls
  );
  const rawState = typeof rawControls.state === "string"
    ? rawControls.state.trim().toLowerCase()
    : null;
  const state = LIFECYCLE_CONTROL_STATES.has(rawState) ? rawState : null;
  const enabledOverride = typeof rawControls.enabled === "boolean"
    ? rawControls.enabled
    : typeof rawControls.enabledOverride === "boolean"
      ? rawControls.enabledOverride
      : null;
  const pausedUntil = normalizeTimestamp(rawControls.pausedUntil || rawControls.pauseUntil || rawControls.holdUntil);
  const observedPaused = rawControls.paused === true
    || state === "paused"
    || Boolean(pausedUntil && new Date(pausedUntil).getTime() > new Date(now).getTime());
  const pauseActive = command === "enable" || command === "resume"
    ? false
    : command === "pause" || observedPaused;
  const rawReason = typeof rawControls.reason === "string"
    ? rawControls.reason.trim().toLowerCase()
    : typeof rawControls.holdReason === "string"
      ? rawControls.holdReason.trim().toLowerCase()
      : null;
  const lockedCommands = normalizeStringList(rawControls.lockedCommands || rawControls.commandLocks)
    .map((name) => name.toLowerCase())
    .filter((name) => LIFECYCLE_COMMANDS.has(name));
  const allowCommands = normalizeStringList(rawControls.allowCommands || rawControls.allowedCommands)
    .map((name) => name.toLowerCase())
    .filter((name) => LIFECYCLE_COMMANDS.has(name));
  const requestedBy = typeof rawControls.requestedBy === "string" && rawControls.requestedBy.trim()
    ? rawControls.requestedBy.trim()
    : null;
  const stateToken = typeof rawControls.stateToken === "string" && rawControls.stateToken.trim()
    ? rawControls.stateToken.trim()
    : stableDigest({
        routeName: settings.routeName,
        enabled: enabledOverride ?? settings.enabled,
        state,
        pausedUntil,
        lockedCommands,
        allowCommands,
        requestedBy
      });
  const validationErrors = [];
  if (rawState && !state) validationErrors.push(`lifecycleControls.state:${rawState}:unsupported`);
  if (rawReason && !LIFECYCLE_CONTROL_REASONS.has(rawReason)) {
    validationErrors.push(`lifecycleControls.reason:${rawReason}:unsupported`);
  }
  if (lockedCommands.includes(command) && command !== "disable") {
    validationErrors.push(`lifecycleControls.lockedCommands:${command}:requested-command-locked`);
  }
  if (allowCommands.length > 0 && !allowCommands.includes(command) && command !== "resume") {
    validationErrors.push(`lifecycleControls.allowCommands:${command}:requested-command-not-allowed`);
  }
  const disabledByControl = rawControls.disabled === true || state === "disabled" || enabledOverride === false;
  const observedState = validationErrors.length > 0
    ? "blocked"
    : observedPaused
      ? "paused"
      : disabledByControl
        ? "disabled"
        : settings.enabled
          ? "active"
          : "disabled";
  const effectiveEnabled = command === "enable" || command === "resume"
    ? true
    : command === "disable"
      ? false
      : disabledByControl
        ? false
        : enabledOverride === true || settings.enabled;
  return {
    format: "hosted-kernel.replay-index.lifecycle-controls.v1",
    bound: Object.keys(rawControls).length > 0,
    observedState,
    state: validationErrors.length > 0
      ? "blocked"
      : pauseActive
        ? "paused"
        : effectiveEnabled
          ? "active"
          : "disabled",
    effectiveEnabled,
    settingsEnabled: settings.enabled,
    enabledOverride,
    disabledByControl,
    paused: pauseActive,
    pausedUntil,
    holdReason: rawReason && LIFECYCLE_CONTROL_REASONS.has(rawReason)
      ? rawReason
      : pauseActive
        ? "operator-hold"
        : null,
    lockedCommands,
    allowCommands,
    requestedBy,
    stateToken,
    validationErrors,
    digest: stableDigest({
      routeName: settings.routeName,
      state,
      observedState,
      effectiveEnabled,
      observedPaused,
      paused: pauseActive,
      pausedUntil,
      holdReason: rawReason,
      lockedCommands,
      allowCommands,
      requestedBy,
      stateToken
    })
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function normalizeScopeId(value, fallback = null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function scopeIdIssue(kind, value) {
  if (!value) return null;
  if (!SCOPE_ID_PATTERN.test(value)) return `${kind}:invalid-scope-id`;
  if (value.includes("..") || value.includes("/") || value.includes("\\") || value.startsWith("~")) {
    return `${kind}:unsafe-scope-id`;
  }
  return null;
}

function normalizeProviderHandoffContract(provider) {
  const handoff = asObject(provider.handoff || provider.handoffContract || provider.externalHandoff);
  const lease = asObject(handoff.lease || provider.handoffLease);
  const rawDeliveryMode = typeof handoff.deliveryMode === "string"
    ? handoff.deliveryMode.trim().toLowerCase()
    : typeof provider.deliveryMode === "string"
      ? provider.deliveryMode.trim().toLowerCase()
      : null;
  const rawLeaseState = typeof lease.state === "string"
    ? lease.state.trim().toLowerCase()
    : typeof handoff.leaseState === "string"
      ? handoff.leaseState.trim().toLowerCase()
      : null;
  const leaseToken = typeof lease.token === "string" && lease.token.trim()
    ? lease.token.trim()
    : typeof handoff.leaseToken === "string" && handoff.leaseToken.trim()
      ? handoff.leaseToken.trim()
      : null;
  const validationErrors = [];
  if (rawDeliveryMode && !HANDOFF_DELIVERY_MODES.has(rawDeliveryMode)) {
    validationErrors.push(`handoff.deliveryMode:${rawDeliveryMode}:unsupported`);
  }
  if (rawLeaseState && !HANDOFF_LEASE_STATES.has(rawLeaseState)) {
    validationErrors.push(`handoff.leaseState:${rawLeaseState}:unsupported`);
  }
  return {
    deliveryMode: HANDOFF_DELIVERY_MODES.has(rawDeliveryMode) ? rawDeliveryMode : "push",
    targetRef: typeof handoff.targetRef === "string" && handoff.targetRef.trim()
      ? handoff.targetRef.trim()
      : typeof handoff.ref === "string" && handoff.ref.trim()
        ? handoff.ref.trim()
        : null,
    leaseToken,
    leaseState: HANDOFF_LEASE_STATES.has(rawLeaseState) ? rawLeaseState : leaseToken ? "open" : null,
    leaseExpiresAt: normalizeTimestamp(lease.expiresAt || handoff.leaseExpiresAt || provider.handoffLeaseExpiresAt),
    expectedCursorDigest: typeof handoff.expectedCursorDigest === "string" && handoff.expectedCursorDigest.trim()
      ? handoff.expectedCursorDigest.trim()
      : null,
    externalRevision: typeof handoff.externalRevision === "string" && handoff.externalRevision.trim()
      ? handoff.externalRevision.trim()
      : null,
    requireAck: handoff.requireAck === true || handoff.requiresAck === true,
    validationErrors
  };
}

function evaluateProviderHandoffGate(provider, now) {
  const contract = provider.handoffContract || {};
  const leaseExpired = contract.leaseExpiresAt
    ? new Date(contract.leaseExpiresAt).getTime() <= new Date(now).getTime()
    : false;
  const blockers = [];
  if (!provider.handoffRef) blockers.push("handoff-ref-missing");
  if (provider.type === "external" && !contract.leaseToken) blockers.push("external-lease-token-missing");
  if (contract.leaseState === "held") blockers.push("external-lease-held");
  if (contract.leaseState === "revoked") blockers.push("external-lease-revoked");
  if (contract.leaseState === "expired" || leaseExpired) blockers.push("external-lease-expired");
  for (const error of contract.validationErrors || []) blockers.push(error);
  return {
    state: blockers.length > 0 ? "blocked" : "ready",
    blockers,
    deliveryMode: contract.deliveryMode || "push",
    leaseToken: contract.leaseToken || null,
    leaseState: leaseExpired ? "expired" : contract.leaseState,
    leaseExpiresAt: contract.leaseExpiresAt || null,
    expectedCursorDigest: contract.expectedCursorDigest || null,
    externalRevision: contract.externalRevision || null,
    requireAck: contract.requireAck === true
  };
}

function normalizeProvider(rawProvider, index) {
  const provider = asObject(rawProvider);
  const handoffContract = normalizeProviderHandoffContract(provider);
  const id = typeof provider.id === "string" && provider.id.trim()
    ? provider.id.trim()
    : `provider-${index + 1}`;
  const type = PROVIDER_TYPES.has(provider.type) ? provider.type : "external";
  const status = CAPABILITY_STATUS.has(provider.status) ? provider.status : "available";
  const capabilities = normalizeStringList(provider.capabilities);
  const syncCursor = asObject(provider.syncCursor);
  return {
    id,
    type,
    status,
    capabilities,
    routeName: typeof provider.routeName === "string" && provider.routeName.trim()
      ? provider.routeName.trim()
      : null,
    tenantId: normalizeScopeId(provider.tenantId || provider.tenant),
    workspaceId: normalizeScopeId(provider.workspaceId || provider.workspace),
    handoffRef: typeof provider.handoffRef === "string" && provider.handoffRef.trim()
      ? provider.handoffRef.trim()
      : handoffContract.targetRef,
    handoffContract,
    validationErrors: handoffContract.validationErrors,
    checkpoint: typeof syncCursor.checkpoint === "string" && syncCursor.checkpoint.trim()
      ? syncCursor.checkpoint.trim()
      : null,
    watermark: typeof syncCursor.watermark === "string" && syncCursor.watermark.trim()
      ? syncCursor.watermark.trim()
      : null
  };
}

function normalizeProviders(input = {}, settings = DEFAULT_SETTINGS) {
  const providers = Array.isArray(input.providers) ? input.providers : [];
  const normalized = providers.map((provider, index) => normalizeProvider(provider, index));
  if (normalized.length > 0) return normalized;
  return [
    {
      id: "hosted-kernel-artifact-store",
      type: "artifact-store",
      status: "available",
      capabilities: ["artifact.read", "replay.enumerate"],
      routeName: settings.routeName,
      tenantId: null,
      workspaceId: null,
      handoffRef: null,
      handoffContract: normalizeProviderHandoffContract({}),
      validationErrors: [],
      checkpoint: null,
      watermark: null
    },
    {
      id: "hosted-kernel-replay-index",
      type: "kernel",
      status: "available",
      capabilities: ["index.write", "proof.emit", "handoff.publish"],
      routeName: settings.routeName,
      tenantId: null,
      workspaceId: null,
      handoffRef: `${settings.replayRoot}/handoff.json`,
      handoffContract: normalizeProviderHandoffContract({
        handoff: {
          targetRef: `${settings.replayRoot}/handoff.json`,
          deliveryMode: "pull"
        }
      }),
      validationErrors: [],
      checkpoint: null,
      watermark: null
    }
  ];
}

function buildCapabilityNegotiation(input, providers, settings, lifecycle) {
  const requested = normalizeStringList(input.requestedCapabilities);
  const optional = normalizeStringList(input.optionalCapabilities);
  const required = normalizeStringList([...REQUIRED_CAPABILITIES, ...requested]);
  const providerRows = providers.map((provider) => ({
    providerId: provider.id,
    type: provider.type,
    status: provider.status,
    capabilities: provider.capabilities,
    handoffRef: provider.handoffRef,
    handoffDeliveryMode: provider.handoffContract.deliveryMode,
    handoffLeaseState: provider.handoffContract.leaseState,
    handoffLeaseExpiresAt: provider.handoffContract.leaseExpiresAt,
    active: provider.status === "available"
  }));
  const available = new Set(
    providerRows
      .filter((provider) => provider.active)
      .flatMap((provider) => provider.capabilities)
  );
  const missingRequired = required.filter((capability) => !available.has(capability));
  const degradedProviders = providerRows
    .filter((provider) => provider.status === "degraded")
    .map((provider) => provider.providerId);
  return {
    required,
    optional,
    available: [...available].sort(),
    missingRequired,
    degradedProviders,
    accepted: lifecycle.status !== "blocked" && missingRequired.length === 0,
    providerRows,
    decision: missingRequired.length > 0
      ? "capability-blocked"
      : degradedProviders.length > 0
        ? "capability-degraded"
        : "capability-ready",
    proofRequired: settings.proofMode === "strict" || optional.includes("proof.emit")
  };
}

function operationRequired(operation, settings, capabilityNegotiation) {
  if (operation.required) return true;
  if (operation.id === "proof-emit") return capabilityNegotiation.proofRequired;
  if (operation.id === "handoff-publish") return capabilityNegotiation.optional.includes("handoff.publish");
  return false;
}

function providerSupportsOperation(provider, operation) {
  return operation.requiredCapabilities.every((capability) => provider.capabilities.includes(capability));
}

function providerOperationGate(provider, operation, now) {
  if (!providerSupportsOperation(provider, operation)) {
    return { state: "unsupported", blockers: [`capability:${operation.requiredCapabilities.join("+")}:missing`] };
  }
  if (operation.id !== "handoff-publish") return { state: "ready", blockers: [] };
  return evaluateProviderHandoffGate(provider, now);
}

function buildServiceContract(now, settings, providers, capabilityNegotiation, lifecycle) {
  const availableProviders = providers.filter((provider) => provider.status === "available");
  const operations = SERVICE_OPERATIONS.map((operation) => {
    const candidates = providers
      .filter((provider) => providerSupportsOperation(provider, operation))
      .map((provider) => {
        const operationGate = providerOperationGate(provider, operation, now);
        return {
          providerId: provider.id,
          type: provider.type,
          status: provider.status,
          routeName: provider.routeName || settings.routeName,
          handoffRef: provider.handoffRef,
          handoffGate: operation.id === "handoff-publish" ? operationGate : null,
          checkpoint: provider.checkpoint,
          watermark: provider.watermark
        };
      });
    const assigned = candidates.find((candidate) => (
      candidate.status === "available"
      && (!candidate.handoffGate || candidate.handoffGate.state === "ready")
    )) || null;
    const required = operationRequired(operation, settings, capabilityNegotiation);
    const blockedByHandoffGate = operation.id === "handoff-publish"
      && candidates.some((candidate) => candidate.status === "available")
      && !assigned;
    const state = assigned
      ? lifecycle.enabled
        ? "assigned"
        : "held"
      : required
        ? "blocked"
        : candidates.length > 0
          ? "degraded"
          : "optional-missing";
    return {
      id: operation.id,
      phase: operation.phase,
      description: operation.description,
      required,
      requiredCapabilities: operation.requiredCapabilities,
      state,
      providerId: assigned ? assigned.providerId : null,
      providerType: assigned ? assigned.type : null,
      routeName: assigned ? assigned.routeName : settings.routeName,
      handoffRef: assigned ? assigned.handoffRef : null,
      handoffGate: assigned?.handoffGate || null,
      checkpoint: assigned ? assigned.checkpoint : null,
      watermark: assigned ? assigned.watermark : null,
      candidates,
      blockingReason: !assigned && required
        ? blockedByHandoffGate
          ? `operation:${operation.id}:handoff-gate-blocked`
          : `operation:${operation.id}:no-available-provider`
        : null
    };
  });
  const requiredOperations = operations.filter((operation) => operation.required);
  const blockedOperations = requiredOperations.filter((operation) => operation.state === "blocked");
  const heldOperations = requiredOperations.filter((operation) => operation.state === "held");
  const phaseStates = operations.reduce((states, operation) => {
    const current = states[operation.phase] || "ready";
    states[operation.phase] = current === "blocked" || operation.state === "blocked"
      ? "blocked"
      : current === "held" || operation.state === "held"
        ? "held"
        : operation.state === "degraded" || operation.state === "optional-missing"
          ? "attention"
          : "ready";
    return states;
  }, {});
  return {
    format: "hosted-kernel.replay-index.service-contract.v1",
    generatedAt: now,
    routeName: settings.routeName,
    replayRoot: settings.replayRoot,
    state: blockedOperations.length > 0
      ? "blocked"
      : heldOperations.length > 0
        ? "held"
        : "ready",
    operations,
    phaseStates,
    availableProviderIds: availableProviders.map((provider) => provider.id),
    blockedOperations: blockedOperations.map((operation) => operation.id),
    handoffOperationIds: operations
      .filter((operation) => operation.phase === "handoff" && operation.providerId)
      .map((operation) => operation.id),
    syncOperationIds: operations
      .filter((operation) => ["source", "index"].includes(operation.phase) && operation.providerId)
      .map((operation) => operation.id),
    digest: stableDigest({
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      operations: operations.map((operation) => ({
        id: operation.id,
        state: operation.state,
        providerId: operation.providerId,
        required: operation.required,
        handoffGate: operation.handoffGate
      }))
    })
  };
}

function normalizeSyncInput(rawSync = {}) {
  const sync = asObject(rawSync);
  const cursor = asObject(sync.cursor);
  return {
    cursor: {
      checkpoint: typeof cursor.checkpoint === "string" && cursor.checkpoint.trim()
        ? cursor.checkpoint.trim()
        : null,
      watermark: typeof cursor.watermark === "string" && cursor.watermark.trim()
        ? cursor.watermark.trim()
        : null,
      sequence: toPositiveInteger(cursor.sequence, 0)
    },
    lastIndexedAt: typeof sync.lastIndexedAt === "string" && sync.lastIndexedAt.trim()
      ? sync.lastIndexedAt.trim()
      : null,
    externalRevision: typeof sync.externalRevision === "string" && sync.externalRevision.trim()
      ? sync.externalRevision.trim()
      : null
  };
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePersistedCursor(rawCursor = {}) {
  const cursor = asObject(rawCursor);
  return {
    checkpoint: typeof cursor.checkpoint === "string" && cursor.checkpoint.trim()
      ? cursor.checkpoint.trim()
      : null,
    watermark: typeof cursor.watermark === "string" && cursor.watermark.trim()
      ? cursor.watermark.trim()
      : null,
    sequence: toPositiveInteger(cursor.sequence, 0),
    proofDigest: typeof cursor.proofDigest === "string" && cursor.proofDigest.trim()
      ? cursor.proofDigest.trim()
      : null
  };
}

function normalizePersistedCommandEntry(rawEntry, index) {
  const entry = asObject(rawEntry);
  const command = typeof entry.command === "string" && entry.command.trim()
    ? entry.command.trim().toLowerCase()
    : null;
  const result = typeof entry.result === "string" && entry.result.trim()
    ? entry.result.trim().toLowerCase()
    : typeof entry.status === "string" && entry.status.trim()
      ? entry.status.trim().toLowerCase()
      : "pending";
  const observedAt = normalizeTimestamp(entry.observedAt || entry.appliedAt || entry.updatedAt || entry.createdAt);
  return {
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `persisted-command-${index + 1}`,
    digest: typeof entry.digest === "string" && entry.digest.trim() ? entry.digest.trim() : null,
    command: LIFECYCLE_COMMANDS.has(command) ? command : null,
    result: PERSISTED_COMMAND_RESULTS.has(result) ? result : "pending",
    observedAt,
    appliedAt: normalizeTimestamp(entry.appliedAt),
    checkpoint: typeof entry.checkpoint === "string" && entry.checkpoint.trim() ? entry.checkpoint.trim() : null,
    watermark: typeof entry.watermark === "string" && entry.watermark.trim() ? entry.watermark.trim() : null,
    sequence: toPositiveInteger(entry.sequence, 0),
    writeFence: typeof entry.writeFence === "string" && entry.writeFence.trim() ? entry.writeFence.trim() : null
  };
}

function normalizePersistedCommandJournal(persisted, lastCommand) {
  const journalInput = Array.isArray(persisted.commandJournal)
    ? persisted.commandJournal
    : Array.isArray(persisted.journal)
      ? persisted.journal
      : [];
  const entries = journalInput.map((entry, index) => normalizePersistedCommandEntry(entry, index));
  if (lastCommand.id || lastCommand.digest) {
    const lastEntry = normalizePersistedCommandEntry(lastCommand, entries.length);
    if (!entries.some((entry) => entry.digest && entry.digest === lastEntry.digest)) entries.push(lastEntry);
  }
  return entries
    .filter((entry) => entry.command || entry.digest || entry.id)
    .sort((left, right) => {
      const leftTime = left.observedAt ? new Date(left.observedAt).getTime() : 0;
      const rightTime = right.observedAt ? new Date(right.observedAt).getTime() : 0;
      return leftTime - rightTime;
    });
}

function normalizePersistedState(rawPersistedState = {}) {
  const persisted = asObject(rawPersistedState);
  const lastCommand = asObject(persisted.lastCommand);
  const bound = Object.keys(persisted).length > 0;
  const status = typeof persisted.status === "string"
    ? persisted.status.trim().toLowerCase()
    : "clean";
  return {
    bound,
    version: toPositiveInteger(persisted.version, 1),
    status: PERSISTED_STATES.has(status) ? status : "dirty",
    cursor: normalizePersistedCursor(persisted.cursor || persisted.syncCursor),
    committedAt: normalizeTimestamp(persisted.committedAt),
    updatedAt: normalizeTimestamp(persisted.updatedAt),
    recoveredAt: normalizeTimestamp(persisted.recoveredAt),
    lastCommand: {
      id: typeof lastCommand.id === "string" && lastCommand.id.trim() ? lastCommand.id.trim() : null,
      digest: typeof lastCommand.digest === "string" && lastCommand.digest.trim() ? lastCommand.digest.trim() : null,
      command: typeof lastCommand.command === "string" && lastCommand.command.trim()
        ? lastCommand.command.trim().toLowerCase()
        : null,
      appliedAt: normalizeTimestamp(lastCommand.appliedAt),
      result: typeof lastCommand.result === "string" && lastCommand.result.trim()
        ? lastCommand.result.trim().toLowerCase()
        : null
    },
    commandJournal: normalizePersistedCommandJournal(persisted, lastCommand),
    dirtyReason: typeof persisted.dirtyReason === "string" && persisted.dirtyReason.trim()
      ? persisted.dirtyReason.trim()
      : null
  };
}

function buildCommandIdentity(input, command, settings) {
  const request = asObject(input.request);
  const id = typeof input.commandId === "string" && input.commandId.trim()
    ? input.commandId.trim()
    : typeof request.commandId === "string" && request.commandId.trim()
      ? request.commandId.trim()
      : typeof request.id === "string" && request.id.trim()
        ? `${request.id}:${command}`
        : stableDigest({ command, routeName: settings.routeName, replayRoot: settings.replayRoot });
  return {
    id,
    digest: stableDigest({
      id,
      command,
      enabled: settings.enabled,
      cadence: settings.cadence,
      retentionDays: settings.retentionDays,
      maxEntries: settings.maxEntries,
      routeName: settings.routeName,
      replayRoot: settings.replayRoot
    })
  };
}

function buildPersistedRecoveryPlan(now, persisted, identity, lifecycle, validationErrors, recoveryReasons, recoveryPath) {
  const uncommittedEntries = persisted.commandJournal.filter((entry) => (
    entry.result === "pending" || entry.result === "failed" || entry.result === "blocked"
  ));
  const duplicateEntries = persisted.commandJournal.filter((entry) => entry.digest === identity.digest);
  const latestEntry = persisted.commandJournal[persisted.commandJournal.length - 1] || null;
  const actions = [];
  if (validationErrors.length > 0) {
    actions.push({
      id: "hold-invalid-settings",
      order: actions.length + 1,
      kind: "hold",
      reason: validationErrors[0],
      restartSafe: false
    });
  }
  if (persisted.status === "applying") {
    actions.push({
      id: "complete-interrupted-command",
      order: actions.length + 1,
      kind: "resume-command",
      commandId: latestEntry?.id || persisted.lastCommand.id,
      commandDigest: latestEntry?.digest || persisted.lastCommand.digest,
      reason: "persisted write was interrupted while applying",
      restartSafe: Boolean(persisted.cursor.checkpoint || persisted.cursor.watermark)
    });
  }
  if (persisted.status === "dirty" || persisted.dirtyReason) {
    actions.push({
      id: "repair-dirty-snapshot",
      order: actions.length + 1,
      kind: "repair-snapshot",
      reason: persisted.dirtyReason || "dirty persisted replay-index snapshot",
      restartSafe: Boolean(persisted.cursor.checkpoint || persisted.cursor.watermark)
    });
  }
  if (persisted.bound && !persisted.cursor.checkpoint && !persisted.cursor.watermark && lifecycle.enabled) {
    actions.push({
      id: "rebuild-missing-cursor",
      order: actions.length + 1,
      kind: "rebuild-index",
      reason: "persisted cursor is missing",
      restartSafe: false
    });
  }
  for (const entry of uncommittedEntries) {
    actions.push({
      id: `settle-command-${entry.id}`,
      order: actions.length + 1,
      kind: entry.digest === identity.digest ? "dedupe-current-command" : "settle-command",
      commandId: entry.id,
      commandDigest: entry.digest,
      command: entry.command,
      result: entry.result,
      reason: `journal entry is ${entry.result}`,
      restartSafe: entry.result === "pending" && Boolean(entry.checkpoint || entry.watermark || persisted.cursor.checkpoint)
    });
  }
  return {
    format: "hosted-kernel.replay-index.persistence-recovery-plan.v1",
    generatedAt: now,
    path: recoveryPath,
    reasons: recoveryReasons,
    currentCommandDigest: identity.digest,
    latestJournalDigest: latestEntry?.digest || null,
    duplicateCurrentCommandCount: duplicateEntries.length,
    uncommittedCommandIds: uncommittedEntries.map((entry) => entry.id),
    actions,
    terminal: validationErrors.length > 0,
    restartSafeAfterActions: actions.length === 0
      ? persisted.status === "clean"
      : actions.every((action) => action.restartSafe)
  };
}

function buildPersistedState(now, input, settings, command, lifecycle, validationErrors) {
  const persisted = normalizePersistedState(input.persistedState || input.persistence);
  const identity = buildCommandIdentity(input, command, settings);
  const journalMatch = persisted.commandJournal.find((entry) => entry.digest === identity.digest);
  const commandAlreadyApplied = (persisted.lastCommand.digest === identity.digest
    && persisted.lastCommand.result === "applied")
    || journalMatch?.result === "applied"
    || journalMatch?.result === "already-applied";
  const interruptedWrite = persisted.status === "dirty"
    || persisted.status === "applying"
    || (persisted.status === "recovering" && !persisted.recoveredAt);
  const missingCursor = persisted.bound && !persisted.cursor.checkpoint && !persisted.cursor.watermark;
  const recoveryReasons = [];
  if (validationErrors.length > 0) recoveryReasons.push("settings-invalid");
  if (interruptedWrite) recoveryReasons.push(`persisted-status:${persisted.status}`);
  if (missingCursor && lifecycle.enabled) recoveryReasons.push("cursor-missing");
  if (persisted.lastCommand.digest && persisted.lastCommand.digest !== identity.digest && persisted.status !== "clean") {
    recoveryReasons.push("last-command-uncommitted");
  }
  const recoveryRequired = recoveryReasons.length > 0 && !commandAlreadyApplied;
  const status = validationErrors.length > 0
    ? "blocked"
    : recoveryRequired
      ? "recovering"
      : "clean";
  const recoveryPath = validationErrors.length > 0
    ? "hold-until-valid"
    : missingCursor
      ? "rebuild-from-replay-root"
      : interruptedWrite
        ? "resume-from-persisted-cursor"
        : "none";
  const recoveryPlan = buildPersistedRecoveryPlan(
    now,
    persisted,
    identity,
    lifecycle,
    validationErrors,
    recoveryReasons,
    recoveryPath
  );
  const writeFence = stableDigest({
    version: persisted.version,
    commandDigest: identity.digest,
    checkpoint: persisted.cursor.checkpoint,
    watermark: persisted.cursor.watermark,
    routeName: settings.routeName
  });
  const statusSemantics = {
    state: status,
    restartSafe: persisted.bound && status === "clean" && !interruptedWrite && !missingCursor,
    idempotentReplay: commandAlreadyApplied,
    acceptsNewCommand: status === "clean" && !commandAlreadyApplied && validationErrors.length === 0,
    mustRecoverBeforeWrite: recoveryRequired,
    commandJournalBound: persisted.commandJournal.length > 0,
    writeFence
  };
  return {
    version: persisted.version,
    bound: persisted.bound,
    status,
    previousStatus: persisted.status,
    restartSafe: persisted.bound && status === "clean" && !interruptedWrite && !missingCursor,
    recoveredFrom: recoveryRequired ? persisted.status : null,
    cursor: {
      checkpoint: persisted.cursor.checkpoint,
      watermark: persisted.cursor.watermark,
      sequence: persisted.cursor.sequence,
      proofDigest: persisted.cursor.proofDigest
    },
    command: {
      id: identity.id,
      digest: identity.digest,
      name: command,
      idempotent: commandAlreadyApplied,
      shouldApply: !commandAlreadyApplied && validationErrors.length === 0,
      previousCommandId: persisted.lastCommand.id,
      previousCommandDigest: persisted.lastCommand.digest,
      journalMatch: journalMatch
        ? {
            id: journalMatch.id,
            result: journalMatch.result,
            observedAt: journalMatch.observedAt,
            checkpoint: journalMatch.checkpoint,
            watermark: journalMatch.watermark
          }
        : null
    },
    commandJournal: persisted.commandJournal.map((entry) => ({
      id: entry.id,
      command: entry.command,
      digest: entry.digest,
      result: entry.result,
      observedAt: entry.observedAt,
      appliedAt: entry.appliedAt,
      checkpoint: entry.checkpoint,
      watermark: entry.watermark,
      sequence: entry.sequence,
      currentCommand: entry.digest === identity.digest
    })),
    journalEntry: {
      id: identity.id,
      command,
      digest: identity.digest,
      status: commandAlreadyApplied ? "already-applied" : validationErrors.length > 0 ? "blocked" : "pending",
      observedAt: now,
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      writeFence,
      previousJournalEntryId: persisted.commandJournal[persisted.commandJournal.length - 1]?.id || null
    },
    recovery: {
      required: recoveryRequired,
      path: recoveryPath,
      reasons: recoveryReasons,
      resumeCheckpoint: persisted.cursor.checkpoint,
      resumeWatermark: persisted.cursor.watermark,
      writeFence,
      plan: recoveryPlan
    },
    statusSemantics,
    commit: {
      shouldCommit: validationErrors.length === 0 && !commandAlreadyApplied,
      committedAt: persisted.committedAt,
      updatedAt: now,
      targetStatus: status === "recovering" ? "clean-after-recovery" : status,
      nextSnapshot: {
        version: persisted.version + 1,
        status: status === "recovering" ? "clean" : status,
        cursor: persisted.cursor,
        lastCommand: {
          id: identity.id,
          command,
          digest: identity.digest,
          result: commandAlreadyApplied ? "already-applied" : "applied",
          appliedAt: now,
          writeFence
        }
      }
    }
  };
}

function ageMinutes(now, timestamp) {
  if (!timestamp) return null;
  const delta = new Date(now).getTime() - new Date(timestamp).getTime();
  if (!Number.isFinite(delta) || delta < 0) return 0;
  return Math.floor(delta / 60000);
}

function normalizeHistorySnapshot(rawSnapshot, index, now) {
  const snapshot = asObject(rawSnapshot);
  const capturedAt = normalizeTimestamp(snapshot.capturedAt || snapshot.generatedAt || snapshot.at) || now;
  const counters = asObject(snapshot.counters || snapshot.metrics);
  const readinessScore = toPositiveInteger(snapshot.readinessScore ?? counters.readinessScore, 0);
  const entryCount = toPositiveInteger(snapshot.entryCount ?? counters.entryCount, 0);
  const errorCount = toPositiveInteger(snapshot.errorCount ?? counters.errorCount, 0);
  const warningCount = toPositiveInteger(snapshot.warningCount ?? counters.warningCount, 0);
  const subjectCoverageReadyRatio = toRatio(
    snapshot.subjectCoverageReadyRatio
    ?? counters.subjectCoverageReadyRatio
    ?? counters.replaySubjectCoverageReadyRatio,
    null
  );
  return {
    id: typeof snapshot.id === "string" && snapshot.id.trim()
      ? snapshot.id.trim()
      : `history-${index + 1}`,
    capturedAt,
    status: typeof snapshot.status === "string" && snapshot.status.trim()
      ? snapshot.status.trim().toLowerCase()
      : "unknown",
    command: typeof snapshot.command === "string" && snapshot.command.trim()
      ? snapshot.command.trim().toLowerCase()
      : null,
    readinessScore: Math.min(readinessScore, 100),
    entryCount,
    errorCount,
    warningCount,
    subjectCoverageReadyRatio,
    handoffState: typeof snapshot.handoffState === "string" && snapshot.handoffState.trim()
      ? snapshot.handoffState.trim().toLowerCase()
      : null,
    syncState: typeof snapshot.syncState === "string" && snapshot.syncState.trim()
      ? snapshot.syncState.trim().toLowerCase()
      : null,
    digest: typeof snapshot.digest === "string" && snapshot.digest.trim()
      ? snapshot.digest.trim()
      : stableDigest({ capturedAt, readinessScore, entryCount, errorCount, warningCount, subjectCoverageReadyRatio, index })
  };
}

function normalizeHistory(input, now) {
  const rawHistory = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.snapshots)
      ? input.snapshots
      : Array.isArray(asObject(input.analytics).history)
        ? asObject(input.analytics).history
        : [];
  return rawHistory
    .map((snapshot, index) => normalizeHistorySnapshot(snapshot, index, now))
    .sort((left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime());
}

function normalizeClientWorkflowStep(rawStep, index, intent, publishRequested, handoffAcknowledged) {
  const step = asObject(rawStep);
  const id = typeof step.id === "string" && step.id.trim()
    ? step.id.trim()
    : index === 0
      ? "inspect-replay-index"
      : `client-workflow-step-${index + 1}`;
  const stateValue = typeof step.state === "string" ? step.state.trim().toLowerCase() : null;
  const channelValue = typeof step.channel === "string" ? step.channel.trim().toLowerCase() : null;
  const derivedState = id === "acknowledge-client-handoff" && publishRequested && !handoffAcknowledged
    ? "ready"
    : id === "publish-handoff" && (!publishRequested || !handoffAcknowledged)
      ? "blocked"
      : index === 0
        ? "ready"
        : "pending";
  return {
    id,
    label: typeof step.label === "string" && step.label.trim()
      ? step.label.trim()
      : id.replaceAll("-", " "),
    state: CLIENT_WORKFLOW_STEP_STATES.has(stateValue) ? stateValue : derivedState,
    channel: CLIENT_WORKFLOW_CHANNELS.has(channelValue) ? channelValue : "route",
    routeHint: typeof step.routeHint === "string" && step.routeHint.trim()
      ? step.routeHint.trim()
      : intent === "publish"
        ? "handoff"
        : "client-request",
    required: step.required === false ? false : true,
    completedAt: normalizeTimestamp(step.completedAt || step.finishedAt),
    blocker: typeof step.blocker === "string" && step.blocker.trim()
      ? step.blocker.trim()
      : null
  };
}

function defaultClientWorkflowSteps(intent, publishRequested, handoffAcknowledged) {
  const steps = [
    {
      id: "inspect-replay-index",
      label: "Inspect replay index",
      state: intent === "inspect" ? "ready" : "complete",
      channel: "route",
      routeHint: "preview",
      required: true
    }
  ];
  if (intent === "schedule" || intent === "resume") {
    steps.push({
      id: "schedule-refresh",
      label: "Schedule refresh",
      state: "ready",
      channel: "panel",
      routeHint: "schedule",
      required: true
    });
  }
  if (intent === "rebuild" || intent === "compact") {
    steps.push({
      id: `${intent}-replay-index`,
      label: `${intent} replay index`,
      state: "ready",
      channel: "api",
      routeHint: "replay-index",
      required: true
    });
  }
  if (publishRequested) {
    steps.push({
      id: "acknowledge-client-handoff",
      label: "Acknowledge handoff",
      state: handoffAcknowledged ? "complete" : "ready",
      channel: "modal",
      routeHint: "client-handoff",
      required: true
    });
    steps.push({
      id: "publish-handoff",
      label: "Publish handoff",
      state: handoffAcknowledged ? "ready" : "blocked",
      channel: "api",
      routeHint: "handoff",
      required: true,
      blocker: handoffAcknowledged ? null : "client-handoff:ack-required"
    });
  }
  return steps;
}

function buildClientReplayHandoffQueue(settings, context, replayIndex = null) {
  const previewRows = replayIndex?.subjectBundlePreview?.rows || [];
  const queueRows = previewRows.map((row, index) => {
    const handoffState = row.state === "ready"
      ? context.publishRequested
        ? context.handoffAcknowledged
          ? "handoff-ready"
          : "awaiting-ack"
        : "preview-ready"
      : row.state === "attention"
        ? "needs-confirmation"
        : "blocked";
    return {
      id: `client-replay-handoff:${row.lookupKey}`,
      order: index + 1,
      lookupKey: row.lookupKey,
      subject: row.subject,
      state: handoffState,
      sourceState: row.state,
      acceptanceStatus: row.acceptanceStatus,
      actionId: row.clientContract.actionId,
      routeName: row.clientContract.routeName || settings.routeName,
      routeHint: row.state === "ready" ? "preview" : "replay-index",
      exportRef: row.clientContract.exportRef,
      canOpenAudit: row.clientContract.canOpenAudit,
      canOpenArtifact: row.clientContract.canOpenArtifact,
      canAccept: row.clientContract.canAccept,
      requiresAck: context.publishRequested && row.clientContract.canAccept && !context.handoffAcknowledged,
      blockers: row.validationSummary.blockers,
      warnings: row.validationSummary.warnings,
      replayRecordIds: row.preview.replayRecordIds,
      latestCursor: {
        checkpoint: row.preview.latestCheckpoint,
        watermark: row.preview.latestWatermark,
        sequence: row.preview.latestSequence
      },
      digest: stableDigest({
        lookupKey: row.lookupKey,
        state: handoffState,
        actionId: row.clientContract.actionId,
        exportRef: row.clientContract.exportRef,
        blockers: row.validationSummary.blockers,
        warnings: row.validationSummary.warnings,
        replayRecordIds: row.preview.replayRecordIds
      })
    };
  });
  const blockedRows = queueRows.filter((row) => row.state === "blocked");
  const ackRows = queueRows.filter((row) => row.requiresAck);
  const attentionRows = queueRows.filter((row) => row.state === "needs-confirmation");
  const readyRows = queueRows.filter((row) => row.state === "handoff-ready" || row.state === "preview-ready");
  const activeRow = blockedRows[0] || ackRows[0] || attentionRows[0] || readyRows[0] || null;
  return {
    format: "hosted-kernel.replay-index.client-record-handoff-queue.v1",
    bound: Boolean(replayIndex),
    routeName: context.routeName,
    expectedRouteName: settings.routeName,
    replayIndexDigest: replayIndex?.manifestDigest || null,
    subjectBundlePreviewDigest: replayIndex?.subjectBundlePreview?.digest || null,
    state: blockedRows.length > 0
      ? "blocked"
      : ackRows.length > 0
        ? "awaiting-ack"
        : attentionRows.length > 0
          ? "needs-confirmation"
          : queueRows.length > 0
            ? "ready"
            : replayIndex?.recordsBound
              ? "empty"
              : "unbound",
    totalRows: queueRows.length,
    readyRows: readyRows.length,
    ackRequiredRows: ackRows.length,
    blockedRows: blockedRows.length,
    attentionRows: attentionRows.length,
    activeRowId: activeRow?.id || null,
    activeLookupKey: activeRow?.lookupKey || null,
    nextRouteHint: activeRow?.routeHint || (context.publishRequested ? "client-handoff" : "preview"),
    rows: queueRows,
    digest: stableDigest({
      routeName: context.routeName,
      replayIndexDigest: replayIndex?.manifestDigest || null,
      publishRequested: context.publishRequested,
      handoffAcknowledged: context.handoffAcknowledged,
      rows: queueRows.map((row) => ({
        lookupKey: row.lookupKey,
        state: row.state,
        actionId: row.actionId,
        blockers: row.blockers,
        warnings: row.warnings,
        digest: row.digest
      }))
    })
  };
}

function buildClientTransitionPlan(now, settings, steps, context, handoffDigest, expectedDigest, recordHandoffQueue) {
  const requiredSteps = steps.filter((step) => step.required);
  const currentStep = steps.find((step) => step.id === context.activeStepId)
    || requiredSteps.find((step) => !["complete", "skipped"].includes(step.state))
    || steps[0]
    || null;
  const stepTransitions = steps.map((step, index) => {
    const nextStep = steps[index + 1] || null;
    const terminal = !nextStep;
    const blocked = step.state === "blocked";
    const readyToAdvance = step.required
      ? step.state === "complete" || step.state === "skipped"
      : step.state !== "blocked";
    return {
      stepId: step.id,
      order: index + 1,
      fromState: step.state,
      toStepId: readyToAdvance && nextStep ? nextStep.id : step.id,
      routeHint: step.routeHint,
      channel: step.channel,
      required: step.required,
      terminal,
      blocked,
      advanceable: !blocked && !terminal && readyToAdvance,
      handoffGate: step.id === "acknowledge-client-handoff" || step.id === "publish-handoff",
      reason: blocked
        ? step.blocker || "client-workflow:blocked"
        : terminal
          ? "client-workflow:terminal"
          : readyToAdvance
            ? `advance:${step.id}->${nextStep.id}`
            : `wait:${step.id}:${step.state}`
    };
  });
  const blockedTransition = stepTransitions.find((transition) => transition.blocked) || null;
  const waitingTransition = stepTransitions.find((transition) => transition.reason.startsWith("wait:")) || null;
  const advanceableTransition = stepTransitions.find((transition) => transition.advanceable) || null;
  const routeMismatch = !context.routeMatches;
  const hidden = !context.workflowVisible;
  const requiresAck = context.publishRequested && !context.handoffAcknowledged;
  const recordQueueBlocked = recordHandoffQueue.state === "blocked";
  const recordQueueNeedsConfirmation = recordHandoffQueue.state === "needs-confirmation";
  const primaryAction = routeMismatch
    ? "refresh-route"
    : hidden
      ? "show-workflow"
      : recordQueueBlocked
        ? "repair-record-handoff"
        : recordQueueNeedsConfirmation
          ? "confirm-record-handoff"
          : blockedTransition
            ? "resolve-workflow-blocker"
            : requiresAck
              ? "acknowledge-handoff"
              : advanceableTransition
                ? `advance-to-${advanceableTransition.toStepId}`
                : currentStep?.id === "publish-handoff"
                  ? "publish-handoff"
                  : "review-replay-index";
  const state = routeMismatch
    ? "route-mismatch"
    : hidden
      ? "hidden"
      : recordQueueBlocked
        ? "record-handoff-blocked"
        : recordQueueNeedsConfirmation
          ? "record-handoff-attention"
          : blockedTransition
            ? "blocked"
            : waitingTransition || requiresAck
              ? "waiting"
              : stepTransitions.every((transition) => transition.terminal || transition.fromState === "complete" || transition.fromState === "skipped")
                ? "complete"
                : "ready";
  return {
    format: "hosted-kernel.replay-index.client-transition-plan.v1",
    generatedAt: now,
    state,
    routeName: context.routeName,
    expectedRouteName: settings.routeName,
    requestId: context.requestId,
    clientId: context.clientId,
    intent: context.intent,
    currentStepId: currentStep?.id || null,
    primaryAction,
    primaryRouteHint: recordQueueBlocked || recordQueueNeedsConfirmation
      ? recordHandoffQueue.nextRouteHint
      : blockedTransition?.routeHint
      || waitingTransition?.routeHint
      || currentStep?.routeHint
      || (context.publishRequested ? "client-handoff" : "preview"),
    requiresAck,
    publishRequested: context.publishRequested,
    acknowledged: context.handoffAcknowledged,
    expectedDigest,
    handoffPacketDigest: handoffDigest,
    recordHandoffQueue: {
      format: recordHandoffQueue.format,
      state: recordHandoffQueue.state,
      digest: recordHandoffQueue.digest,
      totalRows: recordHandoffQueue.totalRows,
      readyRows: recordHandoffQueue.readyRows,
      ackRequiredRows: recordHandoffQueue.ackRequiredRows,
      blockedRows: recordHandoffQueue.blockedRows,
      attentionRows: recordHandoffQueue.attentionRows,
      activeRowId: recordHandoffQueue.activeRowId,
      activeLookupKey: recordHandoffQueue.activeLookupKey,
      nextRouteHint: recordHandoffQueue.nextRouteHint
    },
    transitions: stepTransitions,
    blockedTransitionIds: stepTransitions.filter((transition) => transition.blocked).map((transition) => transition.stepId),
    advanceableTransitionIds: stepTransitions.filter((transition) => transition.advanceable).map((transition) => transition.stepId),
    routeFences: {
      routeMatches: context.routeMatches,
      workflowVisible: context.workflowVisible,
      sessionId: context.sessionId,
      actorId: context.actorId
    },
    digest: stableDigest({
      routeName: context.routeName,
      expectedRouteName: settings.routeName,
      requestId: context.requestId,
      clientId: context.clientId,
      intent: context.intent,
      primaryAction,
      state,
      requiresAck,
      handoffDigest,
      expectedDigest,
      recordHandoffQueueDigest: recordHandoffQueue.digest,
      recordHandoffQueueState: recordHandoffQueue.state,
      transitions: stepTransitions.map((transition) => ({
        stepId: transition.stepId,
        fromState: transition.fromState,
        toStepId: transition.toStepId,
        blocked: transition.blocked,
        advanceable: transition.advanceable,
        reason: transition.reason
      }))
    })
  };
}

function buildClientRuntimeContract(now, settings, request, client, workflow, handoff, context, replayIndex = null) {
  const rawSteps = Array.isArray(workflow.steps)
    ? workflow.steps
    : Array.isArray(client.workflowSteps)
      ? client.workflowSteps
      : Array.isArray(request.workflowSteps)
        ? request.workflowSteps
        : defaultClientWorkflowSteps(context.intent, context.publishRequested, context.handoffAcknowledged);
  const steps = rawSteps.map((step, index) => normalizeClientWorkflowStep(
    step,
    index,
    context.intent,
    context.publishRequested,
    context.handoffAcknowledged
  ));
  const requiredSteps = steps.filter((step) => step.required);
  const blockedSteps = requiredSteps.filter((step) => step.state === "blocked");
  const incompleteSteps = requiredSteps.filter((step) => !["complete", "skipped"].includes(step.state));
  const activeStepId = typeof workflow.activeStepId === "string" && workflow.activeStepId.trim()
    ? workflow.activeStepId.trim()
    : typeof client.activeStepId === "string" && client.activeStepId.trim()
      ? client.activeStepId.trim()
      : (blockedSteps[0] || incompleteSteps[0] || steps[0] || null)?.id || null;
  const handoffDigest = stableDigest({
    requestId: context.requestId,
    clientId: context.clientId,
    routeName: context.routeName,
    intent: context.intent,
    publishRequested: context.publishRequested,
    handoffRef: context.handoffRef,
    replayRoot: settings.replayRoot
  });
  const expectedDigest = typeof handoff.expectedDigest === "string" && handoff.expectedDigest.trim()
    ? handoff.expectedDigest.trim()
    : typeof client.expectedHandoffDigest === "string" && client.expectedHandoffDigest.trim()
      ? client.expectedHandoffDigest.trim()
      : null;
  const recordHandoffQueue = buildClientReplayHandoffQueue(settings, context, replayIndex);
  const transitionPlan = buildClientTransitionPlan(
    now,
    settings,
    steps,
    { ...context, activeStepId },
    handoffDigest,
    expectedDigest,
    recordHandoffQueue
  );
  return {
    format: "hosted-kernel.replay-index.client-runtime.v1",
    generatedAt: now,
    routeName: context.routeName,
    expectedRouteName: settings.routeName,
    activeStepId,
    steps,
    blockedStepIds: blockedSteps.map((step) => step.id),
    incompleteRequiredStepIds: incompleteSteps.map((step) => step.id),
    workflowComplete: blockedSteps.length === 0 && incompleteSteps.length === 0,
    visible: context.workflowVisible,
    recordHandoffQueue,
    transitionPlan,
    handoffPacket: {
      format: "hosted-kernel.replay-index.client-handoff-packet.v1",
      requestId: context.requestId,
      clientId: context.clientId,
      sessionId: context.sessionId,
      actorId: context.actorId,
      routeName: context.routeName,
      intent: context.intent,
      publishRequested: context.publishRequested,
      acknowledged: context.handoffAcknowledged,
      handoffRef: context.handoffRef,
      expectedDigest,
      digest: handoffDigest,
      ackToken: stableDigest({
        requestId: context.requestId,
        clientId: context.clientId,
        routeName: context.routeName,
        handoffDigest
      })
    },
    state: !context.routeMatches
      ? "route-mismatch"
      : !context.workflowVisible
        ? "hidden"
        : recordHandoffQueue.state === "blocked"
          ? "blocked"
        : blockedSteps.length > 0
          ? "blocked"
          : recordHandoffQueue.state === "needs-confirmation"
            ? "active"
          : incompleteSteps.length > 0
            ? "active"
            : "complete",
    digest: stableDigest({
      routeName: context.routeName,
      intent: context.intent,
      activeStepId,
      steps: steps.map((step) => ({
        id: step.id,
        state: step.state,
        channel: step.channel,
        required: step.required,
        blocker: step.blocker
      })),
      handoffDigest,
      expectedDigest,
      transitionPlanDigest: transitionPlan.digest,
      transitionState: transitionPlan.state,
      transitionPrimaryAction: transitionPlan.primaryAction,
      recordHandoffQueueDigest: recordHandoffQueue.digest,
      recordHandoffQueueState: recordHandoffQueue.state
    })
  };
}

function normalizeFailureEvent(rawEvent, index, now) {
  const event = asObject(rawEvent);
  const severity = typeof event.severity === "string" && FAILURE_SEVERITIES.has(event.severity.trim().toLowerCase())
    ? event.severity.trim().toLowerCase()
    : event.fatal === true
      ? "fatal"
      : event.retryable === false
        ? "error"
        : "warning";
  const code = typeof event.code === "string" && event.code.trim()
    ? event.code.trim()
    : typeof event.type === "string" && event.type.trim()
      ? event.type.trim()
      : `runtime-failure-${index + 1}`;
  const occurredAt = normalizeTimestamp(event.occurredAt || event.at || event.timestamp) || now;
  return {
    id: typeof event.id === "string" && event.id.trim() ? event.id.trim() : `${code}:${index + 1}`,
    code,
    severity,
    message: typeof event.message === "string" && event.message.trim()
      ? event.message.trim()
      : code,
    source: typeof event.source === "string" && event.source.trim() ? event.source.trim() : "hosted-kernel",
    routeHint: typeof event.routeHint === "string" && event.routeHint.trim() ? event.routeHint.trim() : "operational-health",
    retryable: severity !== "fatal" && event.retryable !== false,
    attempts: toPositiveInteger(event.attempts ?? event.retryAttempts, 0),
    occurredAt,
    lastAttemptAt: normalizeTimestamp(event.lastAttemptAt || event.retryAt || event.updatedAt) || occurredAt,
    action: typeof event.action === "string" && event.action.trim()
      ? event.action.trim()
      : severity === "fatal"
        ? "Escalate replay-index failure and hold publication"
        : "Retry replay-index operation after backoff"
  };
}

function normalizeRetryPolicy(rawPolicy = {}) {
  const policy = asObject(rawPolicy);
  const mode = typeof policy.mode === "string" && RETRY_MODES.has(policy.mode.trim().toLowerCase())
    ? policy.mode.trim().toLowerCase()
    : "automatic";
  const validationErrors = [];
  if (policy.mode !== undefined && !RETRY_MODES.has(String(policy.mode).trim().toLowerCase())) {
    validationErrors.push(`retryPolicy.mode:${policy.mode}:unsupported`);
  }
  if (policy.maxAttempts !== undefined && toPositiveInteger(policy.maxAttempts, 0) === 0) {
    validationErrors.push("retryPolicy.maxAttempts must be a positive integer");
  }
  if (policy.baseDelaySeconds !== undefined && toPositiveInteger(policy.baseDelaySeconds, 0) === 0) {
    validationErrors.push("retryPolicy.baseDelaySeconds must be a positive integer");
  }
  if (policy.maxDelaySeconds !== undefined && toPositiveInteger(policy.maxDelaySeconds, 0) === 0) {
    validationErrors.push("retryPolicy.maxDelaySeconds must be a positive integer");
  }
  const maxAttempts = Math.min(toPositiveInteger(policy.maxAttempts, 5), 20);
  const baseDelaySeconds = Math.min(toPositiveInteger(policy.baseDelaySeconds, 30), 3600);
  const maxDelaySeconds = Math.min(toPositiveInteger(policy.maxDelaySeconds, 900), 21600);
  if (baseDelaySeconds > maxDelaySeconds) {
    validationErrors.push("retryPolicy.baseDelaySeconds must not exceed maxDelaySeconds");
  }
  return {
    mode,
    maxAttempts,
    baseDelaySeconds,
    maxDelaySeconds,
    cooldownUntil: normalizeTimestamp(policy.cooldownUntil || policy.pausedUntil || policy.holdUntil),
    validationErrors
  };
}

function retryDelaySeconds(failure, retryPolicy) {
  if (retryPolicy.mode === "disabled") return null;
  if (!failure.retryable || failure.attempts >= retryPolicy.maxAttempts) return null;
  const exponent = Math.max(failure.attempts, 0);
  return Math.min(retryPolicy.baseDelaySeconds * (2 ** exponent), retryPolicy.maxDelaySeconds);
}

function buildRetryExecutionPlan(now, incidents, retryPolicy, degradedMode, serviceContract, replayIndex) {
  const cooldownActive = retryPolicy.cooldownUntil
    ? new Date(retryPolicy.cooldownUntil).getTime() > new Date(now).getTime()
    : false;
  const rows = incidents.map((incident, index) => {
    const exhausted = incident.exhausted || (incident.retryable && incident.attempts >= retryPolicy.maxAttempts);
    const blockedReason = !incident.retryable
      ? "incident-not-retryable"
      : exhausted
        ? "retry-attempts-exhausted"
        : retryPolicy.mode === "disabled"
          ? "retry-policy-disabled"
          : cooldownActive
            ? "retry-cooldown-active"
            : retryPolicy.mode === "manual"
              ? "manual-operator-retry-required"
              : null;
    const due = !blockedReason
      && incident.nextRetryAt
      && new Date(incident.nextRetryAt).getTime() <= new Date(now).getTime();
    return {
      id: incident.id,
      order: index + 1,
      code: incident.code,
      severity: exhausted ? "fatal" : incident.severity,
      source: incident.source,
      routeHint: incident.routeHint,
      attempts: incident.attempts,
      maxAttempts: retryPolicy.maxAttempts,
      retryable: incident.retryable && !exhausted,
      exhausted,
      nextRetryAt: cooldownActive ? retryPolicy.cooldownUntil : incident.nextRetryAt,
      due,
      decision: blockedReason
        ? "blocked"
        : due
          ? "ready"
          : "waiting",
      blockedReason,
      action: blockedReason === "manual-operator-retry-required"
        ? "Approve manual replay-index retry"
        : incident.action
    };
  });
  const readyRows = rows.filter((row) => row.decision === "ready");
  const waitingRows = rows.filter((row) => row.decision === "waiting");
  const blockedRows = rows.filter((row) => row.decision === "blocked");
  const degradedModeGates = [
    {
      id: "service-contract",
      state: serviceContract.blockedOperations.length === 0 ? "ready" : "blocked",
      reason: serviceContract.blockedOperations.length === 0
        ? "required service operations have providers"
        : `blocked operations: ${serviceContract.blockedOperations.join(", ")}`
    },
    {
      id: "replay-index-manifest",
      state: replayIndex.invalidRows.length === 0 && replayIndex.duplicateKeys.length === 0 && replayIndex.conflictRows.length === 0 ? "ready" : "blocked",
      reason: replayIndex.invalidRows.length === 0 && replayIndex.duplicateKeys.length === 0 && replayIndex.conflictRows.length === 0
        ? "manifest rows are valid for degraded reads"
        : "manifest contains invalid, duplicate, or conflicting replay rows"
    },
    {
      id: "terminal-failures",
      state: incidents.some((incident) => incident.severity === "fatal" || incident.exhausted) ? "blocked" : "ready",
      reason: incidents.some((incident) => incident.severity === "fatal" || incident.exhausted)
        ? "fatal or exhausted incidents require operator repair"
        : "no terminal incidents reported"
    }
  ];
  const degradedModeAllowed = degradedMode && degradedModeGates.every((gate) => gate.state === "ready");
  const state = incidents.length === 0
    ? "idle"
    : retryPolicy.validationErrors.length > 0
      ? "invalid-policy"
      : readyRows.length > 0
        ? "ready"
        : blockedRows.length === rows.length
          ? "blocked"
          : waitingRows.length > 0
            ? "waiting"
            : "exhausted";
  const nextRetryAt = rows
    .map((row) => row.nextRetryAt)
    .filter(Boolean)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] || null;
  return {
    format: "hosted-kernel.replay-index.retry-execution-plan.v1",
    generatedAt: now,
    mode: retryPolicy.mode,
    state,
    cooldownUntil: retryPolicy.cooldownUntil,
    cooldownActive,
    degradedModeAllowed,
    degradedModeGates,
    nextRetryAt,
    readyIncidentIds: readyRows.map((row) => row.id),
    waitingIncidentIds: waitingRows.map((row) => row.id),
    blockedIncidentIds: blockedRows.map((row) => row.id),
    exhaustedIncidentIds: rows.filter((row) => row.exhausted).map((row) => row.id),
    rows,
    operatorActions: rows
      .filter((row) => row.decision === "ready" || row.blockedReason)
      .map((row) => ({
        id: `retry-action:${row.id}`,
        incidentId: row.id,
        action: row.action,
        routeHint: row.routeHint,
        reason: row.blockedReason || `retry due for ${row.code}`
      })),
    validationErrors: retryPolicy.validationErrors,
    digest: stableDigest({
      mode: retryPolicy.mode,
      cooldownUntil: retryPolicy.cooldownUntil,
      state,
      degradedModeAllowed,
      rows: rows.map((row) => ({
        id: row.id,
        code: row.code,
        decision: row.decision,
        blockedReason: row.blockedReason,
        nextRetryAt: row.nextRetryAt,
        exhausted: row.exhausted
      })),
      degradedModeGates
    })
  };
}

function incidentAffectsReplayRecord(incident, recordId) {
  return incident.id.includes(recordId)
    || incident.code.includes(recordId)
    || incident.message.includes(recordId)
    || incident.action.includes(recordId);
}

function buildOperationalFailureTriage(now, settings, incidents, retryExecutionPlan, serviceContract, persistedState, replayIndex) {
  const retryRowsByIncident = new Map(retryExecutionPlan.rows.map((row) => [row.id, row]));
  const invalidRecordIds = replayIndex.invalidRows.map((row) => row.id);
  const affectedRecordIds = [...new Set([
    ...invalidRecordIds,
    ...replayIndex.conflictRecordIds,
    ...replayIndex.unmappedRecords,
    ...incidents.flatMap((incident) => (
      replayIndex.rows
        .filter((row) => incidentAffectsReplayRecord(incident, row.id))
        .map((row) => row.id)
    ))
  ])].sort();
  const publicationBlockers = incidents.filter((incident) => (
    incident.severity === "fatal"
    || incident.exhausted
    || serviceContract.blockedOperations.some((operationId) => incident.code.includes(operationId))
    || incident.code === "replay-index-invalid"
  ));
  const repairActions = [
    ...replayIndex.repairPlan.actions.map((action) => ({
      id: `health:${action.id}`,
      kind: action.kind,
      replayRecordId: action.replayRecordId || null,
      replayRecordIds: action.replayRecordIds || (action.replayRecordId ? [action.replayRecordId] : []),
      reason: action.reasons?.join(", ") || action.key || action.kind,
      routeHint: "replay-index"
    })),
    ...persistedState.recovery.plan.actions.map((action) => ({
      id: `health:${action.id}`,
      kind: action.kind,
      replayRecordId: null,
      replayRecordIds: [],
      reason: action.reason,
      routeHint: "persistence"
    }))
  ];
  const lanes = {
    retryReady: retryExecutionPlan.readyIncidentIds,
    retryWaiting: retryExecutionPlan.waitingIncidentIds,
    retryBlocked: retryExecutionPlan.blockedIncidentIds,
    publicationBlocked: publicationBlockers.map((incident) => incident.id),
    operatorRepair: repairActions.map((action) => action.id),
    degradedReadEligible: retryExecutionPlan.degradedModeAllowed && publicationBlockers.length === 0
      ? incidents.map((incident) => incident.id)
      : []
  };
  const incidentRows = incidents.map((incident) => {
    const retryRow = retryRowsByIncident.get(incident.id) || null;
    const affectedRows = replayIndex.rows
      .filter((row) => incidentAffectsReplayRecord(incident, row.id))
      .map((row) => row.id);
    return {
      id: incident.id,
      code: incident.code,
      severity: incident.exhausted ? "fatal" : incident.severity,
      routeHint: incident.routeHint,
      lane: publicationBlockers.some((blocker) => blocker.id === incident.id)
        ? "publication-blocked"
        : retryRow?.decision === "ready"
          ? "retry-ready"
          : retryRow?.decision === "waiting"
            ? "retry-waiting"
            : retryRow?.decision === "blocked"
              ? "retry-blocked"
              : "observe",
      retryDecision: retryRow?.decision || "none",
      blockedReason: retryRow?.blockedReason || null,
      nextRetryAt: retryRow?.nextRetryAt || incident.nextRetryAt,
      affectedReplayRecordIds: affectedRows,
      operatorAction: incident.action
    };
  });
  const degradedReadContract = {
    format: "hosted-kernel.replay-index.degraded-read-contract.v1",
    allowed: retryExecutionPlan.degradedModeAllowed && publicationBlockers.length === 0,
    mode: retryExecutionPlan.degradedModeAllowed && publicationBlockers.length === 0 ? "read-only-lookups" : "disabled",
    reason: publicationBlockers.length > 0
      ? "publication blockers require repair before degraded reads"
      : retryExecutionPlan.degradedModeAllowed
        ? "lookup records and required service operations are safe for read-only use"
        : "degraded mode gates are not satisfied",
    exportRefs: retryExecutionPlan.degradedModeAllowed && publicationBlockers.length === 0
      ? [
          replayIndex.exportRef,
          replayIndex.lookupContract.exportRoot
        ]
      : [],
    lookupRecordCount: retryExecutionPlan.degradedModeAllowed && publicationBlockers.length === 0
      ? replayIndex.lookupRecordCount
      : 0,
    manifestDigest: replayIndex.manifestDigest
  };
  return {
    format: "hosted-kernel.replay-index.failure-triage.v1",
    generatedAt: now,
    routeName: settings.routeName,
    state: publicationBlockers.length > 0
      ? "publication-blocked"
      : retryExecutionPlan.readyIncidentIds.length > 0
        ? "retry-ready"
        : retryExecutionPlan.waitingIncidentIds.length > 0
          ? "retry-waiting"
          : repairActions.length > 0
            ? "repair-required"
            : incidents.length > 0
              ? "observe"
              : "clear",
    lanes,
    incidentRows,
    repairActions,
    affectedReplayRecordIds: affectedRecordIds,
    affectedExportRefs: [
      replayIndex.exportRef,
      ...replayIndex.lookupRecords
        .filter((row) => row.replayRecordIds.some((id) => affectedRecordIds.includes(id)))
        .map((row) => row.exportRef)
    ],
    blockedOperationIds: serviceContract.blockedOperations,
    degradedReadContract,
    digest: stableDigest({
      routeName: settings.routeName,
      state: retryExecutionPlan.state,
      lanes,
      affectedRecordIds,
      repairActions,
      degradedReadContract
    })
  };
}

function buildOperationalHealth(now, input, settings, providers, serviceContract, persistedState, replayIndex) {
  const healthInput = asObject(input.operationalHealth || input.health);
  const retryPolicy = normalizeRetryPolicy(healthInput.retryPolicy || input.retryPolicy);
  const rawFailures = Array.isArray(healthInput.failures)
    ? healthInput.failures
    : Array.isArray(healthInput.errors)
      ? healthInput.errors
      : Array.isArray(input.failures)
        ? input.failures
        : [];
  const failures = rawFailures.map((event, index) => normalizeFailureEvent(event, index, now));
  const derivedFailures = [];
  for (const provider of providers) {
    if (provider.status === "unavailable") {
      derivedFailures.push(normalizeFailureEvent({
        code: `provider-unavailable:${provider.id}`,
        severity: "error",
        source: provider.id,
        message: `Provider ${provider.id} is unavailable for replay-index operations`,
        action: "Restore provider or attach an alternate provider with required capabilities",
        routeHint: "providers",
        retryable: true
      }, derivedFailures.length, now));
    }
    if (provider.status === "degraded") {
      derivedFailures.push(normalizeFailureEvent({
        code: `provider-degraded:${provider.id}`,
        severity: "warning",
        source: provider.id,
        message: `Provider ${provider.id} is degraded`,
        action: "Run replay-index in degraded mode or replace the provider before publication",
        routeHint: "providers",
        retryable: true
      }, derivedFailures.length, now));
    }
  }
  for (const operationId of serviceContract.blockedOperations) {
    derivedFailures.push(normalizeFailureEvent({
      code: `operation-blocked:${operationId}`,
      severity: "error",
      source: "service-contract",
      message: `Replay-index operation ${operationId} has no available provider`,
      action: "Assign an available provider for the blocked service operation",
      routeHint: "service-contract",
      retryable: false
    }, derivedFailures.length, now));
  }
  if (persistedState.recovery.required) {
    derivedFailures.push(normalizeFailureEvent({
      code: `persistence-recovery:${persistedState.recovery.path}`,
      severity: "warning",
      source: "persistence",
      message: `Persisted replay-index state requires ${persistedState.recovery.path}`,
      action: "Recover persisted cursor state before the next hosted-kernel handoff",
      routeHint: "persistence",
      retryable: true
    }, derivedFailures.length, now));
  }
  if (replayIndex.invalidRows.length > 0 || replayIndex.duplicateKeys.length > 0 || replayIndex.conflictRows.length > 0) {
    derivedFailures.push(normalizeFailureEvent({
      code: "replay-index-invalid",
      severity: "error",
      source: "replay-index",
      message: "Replay-index manifest contains invalid, duplicate, or conflicting rows",
      action: "Repair replay records and rebuild the replay-index manifest",
      routeHint: "replay-index",
      retryable: false
    }, derivedFailures.length, now));
  }
  const incidents = [...failures, ...derivedFailures].map((failure) => {
    const delaySeconds = retryDelaySeconds(failure, retryPolicy);
    return {
      ...failure,
      retryDelaySeconds: delaySeconds,
      nextRetryAt: delaySeconds === null ? null : addMinutes(failure.lastAttemptAt || now, delaySeconds / 60),
      exhausted: failure.retryable && failure.attempts >= retryPolicy.maxAttempts
    };
  });
  const fatalIncidents = incidents.filter((incident) => incident.severity === "fatal" || incident.exhausted);
  const errorIncidents = incidents.filter((incident) => incident.severity === "error");
  const retryableIncidents = incidents.filter((incident) => retryPolicy.mode !== "disabled" && incident.retryable && !incident.exhausted);
  const explicitState = typeof healthInput.state === "string" && HEALTH_STATES.has(healthInput.state.trim().toLowerCase())
    ? healthInput.state.trim().toLowerCase()
    : null;
  const state = explicitState
    || (fatalIncidents.length > 0 ? "failed" : errorIncidents.length > 0 || incidents.length > 0 ? "degraded" : "healthy");
  const degradedMode = state === "degraded" && fatalIncidents.length === 0;
  const retryExecutionPlan = buildRetryExecutionPlan(
    now,
    incidents,
    retryPolicy,
    degradedMode,
    serviceContract,
    replayIndex
  );
  const failureTriage = buildOperationalFailureTriage(
    now,
    settings,
    incidents,
    retryExecutionPlan,
    serviceContract,
    persistedState,
    replayIndex
  );
  const healthEvidence = [
    {
      id: "operational-health-incidents",
      kind: "incident-digest",
      generatedAt: now,
      digest: stableDigest(incidents.map((incident) => ({
        id: incident.id,
        code: incident.code,
        severity: incident.severity,
        exhausted: incident.exhausted,
        nextRetryAt: incident.nextRetryAt
      })))
    },
    {
      id: "operational-health-retry-plan",
      kind: "retry-plan-digest",
      generatedAt: now,
      digest: retryExecutionPlan.digest
    },
    {
      id: "operational-health-failure-triage",
      kind: "failure-triage-digest",
      generatedAt: now,
      digest: failureTriage.digest
    }
  ];
  return {
    format: "hosted-kernel.replay-index.operational-health.v1",
    generatedAt: now,
    state,
    degradedMode,
    retryPolicy,
    retryExecutionPlan,
    failureTriage,
    incidents,
    actionableErrors: incidents
      .filter((incident) => incident.severity === "error" || incident.severity === "fatal" || incident.exhausted)
      .map((incident) => ({
        id: incident.id,
        code: incident.code,
        severity: incident.exhausted ? "fatal" : incident.severity,
        message: incident.message,
        action: incident.action,
        routeHint: incident.routeHint,
        retryable: incident.retryable && !incident.exhausted,
        nextRetryAt: incident.nextRetryAt,
        triageLane: failureTriage.incidentRows.find((row) => row.id === incident.id)?.lane || "observe"
      })),
    retryQueue: retryableIncidents.map((incident) => ({
      id: incident.id,
      code: incident.code,
      attempts: incident.attempts,
      nextRetryAt: incident.nextRetryAt,
      delaySeconds: incident.retryDelaySeconds,
      routeHint: incident.routeHint
    })),
    failureState: {
      terminal: state === "failed",
      degraded: degradedMode,
      exhaustedRetries: incidents.filter((incident) => incident.exhausted).map((incident) => incident.id),
      blockedOperationIds: serviceContract.blockedOperations,
      invalidReplayRows: replayIndex.invalidRows.map((row) => row.id),
      conflictingReplayRows: replayIndex.conflictRecordIds,
      triageState: failureTriage.state,
      affectedReplayRecordIds: failureTriage.affectedReplayRecordIds,
      degradedReadAllowed: failureTriage.degradedReadContract.allowed
    },
    evidence: healthEvidence,
    digest: stableDigest({
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      state,
      degradedMode,
      retryExecutionPlanDigest: retryExecutionPlan.digest,
      failureTriageDigest: failureTriage.digest,
      incidents: incidents.map((incident) => ({
        code: incident.code,
        severity: incident.severity,
        retryable: incident.retryable,
        attempts: incident.attempts,
        nextRetryAt: incident.nextRetryAt
      })),
      retryPolicy
    })
  };
}

function normalizeMailchimpReplaySettings(input, settings, accessBoundary) {
  const analytics = asObject(input.analytics);
  const source = asObject(
    input.mailchimp
    || input.mailchimpExport
    || input.marketingExport
    || analytics.mailchimp
  );
  const enabled = source.enabled === true || source.requested === true || source.syncRequested === true;
  const audienceId = normalizeScopeId(source.audienceId || source.listId || source.audienceRef);
  const segmentId = normalizeScopeId(source.segmentId || source.segmentRef);
  const route = typeof source.route === "string" && source.route.trim()
    ? source.route.trim()
    : "/integrations/mailchimp/replay-index/export";
  const tagPrefix = typeof source.tagPrefix === "string" && source.tagPrefix.trim()
    ? source.tagPrefix.trim().slice(0, 24)
    : "aios-replay";
  const includeDiagnostics = source.includeDiagnostics !== false;

  return {
    enabled,
    audienceId,
    segmentId,
    listRef: audienceId ? `mailchimp:${audienceId}` : null,
    route,
    tagPrefix,
    includeDiagnostics,
    workspaceTag: `${tagPrefix}:workspace:${accessBoundary.workspaceId || "workspace"}`.slice(0, 96),
    routeTag: `${tagPrefix}:route:${settings.routeName}`.slice(0, 96)
  };
}

function buildMailchimpReplayIndexHandoff({
  now,
  input,
  settings,
  lifecycle,
  scheduleControls,
  nextAction,
  serviceContract,
  sync,
  accessBoundary,
  handoff,
  replayIndex,
  operationalHealth,
  readiness,
  validationSummary,
  acceptance,
  exportRows,
  metricSeries,
  reportChannels
}) {
  const settingsContract = normalizeMailchimpReplaySettings(input, settings, accessBoundary);
  const blockedReasonCodes = [
    ...(!settingsContract.enabled ? ["mailchimp_export_not_requested"] : []),
    ...(settingsContract.enabled && !settingsContract.audienceId ? ["mailchimp_audience_missing"] : []),
    ...(acceptance.accepted ? [] : ["replay_index_acceptance_not_ready"]),
    ...(validationSummary.errorCount > 0 ? ["validation_errors_present"] : []),
    ...(readiness.publishable ? [] : ["route_not_publishable"]),
    ...(serviceContract.blockedOperations.length ? ["service_operations_blocked"] : []),
    ...(handoff.state === "blocked" ? ["handoff_blocked"] : []),
    ...(operationalHealth.state === "failed" ? ["operational_health_failed"] : []),
    ...(replayIndex.state === "invalid" ? ["replay_index_invalid"] : [])
  ];
  const audienceRows = exportRows.map((row, index) => {
    const rowWarnings = [
      ...(row.errorCount > 0 ? ["row_validation_errors"] : []),
      ...(row.handoffState === "blocked" ? ["row_handoff_blocked"] : []),
      ...(row.healthState === "failed" ? ["row_health_failed"] : []),
      ...(row.replayIndexState === "invalid" ? ["row_replay_invalid"] : [])
    ];
    const ready = blockedReasonCodes.length === 0 && rowWarnings.length === 0;
    const tags = [
      settingsContract.workspaceTag,
      settingsContract.routeTag,
      `${settingsContract.tagPrefix}:status:${row.status}`.slice(0, 96),
      `${settingsContract.tagPrefix}:command:${row.command}`.slice(0, 96),
      `${settingsContract.tagPrefix}:schedule:${scheduleControls.state}`.slice(0, 96),
      ...(settingsContract.includeDiagnostics ? rowWarnings.map((code) => `${settingsContract.tagPrefix}:warn:${code}`.slice(0, 96)) : [])
    ];

    return {
      rowId: `${settings.routeName}:mailchimp:${index + 1}`,
      analyticsRowId: row.rowId,
      externalId: stableDigest({
        tenantId: accessBoundary.tenantId,
        workspaceId: accessBoundary.workspaceId,
        routeName: settings.routeName,
        capturedAt: row.capturedAt,
        digest: row.digest
      }),
      status: ready ? "ready" : "blocked",
      blockedReasonCodes: ready ? [] : [...new Set([...blockedReasonCodes, ...rowWarnings])],
      tags: [...new Set(tags)],
      mergeFields: {
        ROUTE: settings.routeName.slice(0, 64),
        STATUS: String(row.status || "unknown").slice(0, 32),
        COMMAND: String(row.command || "none").slice(0, 32),
        READY: readiness.score,
        ENTRIES: row.entryCount,
        ERRORS: row.errorCount,
        WARNINGS: row.warningCount,
        SUBJECTS: row.subjectCoverageReadyRatio ?? null
      },
      capturedAt: row.capturedAt,
      digest: row.digest
    };
  });
  const readyRows = audienceRows.filter((row) => row.status === "ready");
  const state = !settingsContract.enabled
    ? "not-requested"
    : blockedReasonCodes.length
      ? "blocked"
      : readyRows.length === audienceRows.length
        ? "ready"
        : "attention";
  const exportDigest = stableDigest({
    state,
    routeName: settings.routeName,
    blockedReasonCodes,
    audienceRows,
    metricSeries,
    reportChannels: reportChannels.map((channel) => ({
      id: channel.id,
      ready: channel.ready,
      digest: channel.digest
    })),
    replayIndexDigest: replayIndex.manifestDigest,
    syncCursor: sync.cursor,
    nextAction: nextAction.type,
    lifecycleStatus: lifecycle.status
  });

  return {
    format: "hosted-kernel.replay-index.mailchimp-handoff.v1",
    generatedAt: now,
    state,
    enabled: settingsContract.enabled,
    route: settingsContract.route,
    listRef: settingsContract.listRef,
    audienceId: settingsContract.audienceId,
    segmentId: settingsContract.segmentId,
    rowCount: audienceRows.length,
    readyRowCount: readyRows.length,
    blockedRowCount: audienceRows.length - readyRows.length,
    blockedReasonCodes: [...new Set(blockedReasonCodes)],
    cursor: `${settings.routeName}:${sync.cursor.sequence}:${replayIndex.manifestDigest}`,
    exportDigest,
    rows: audienceRows
  };
}

function buildAnalytics(
  now,
  input,
  settings,
  lifecycle,
  scheduleControls,
  nextAction,
  providers,
  serviceContract,
  capabilityNegotiation,
  sync,
  clientRequest,
  accessBoundary,
  handoff,
  persistedState,
  replayIndex,
  operationalHealth,
  readiness,
  validationSummary,
  acceptance,
  nextSteps,
  evidence
) {
  const history = normalizeHistory(input, now);
  const previous = history.length > 0 ? history[history.length - 1] : null;
  const currentSnapshot = {
    id: "current",
    capturedAt: now,
    status: acceptance.status,
    command: lifecycle.command,
    scheduleState: scheduleControls.state,
    readinessScore: readiness.score,
    entryCount: sync.cursor.sequence,
    errorCount: validationSummary.errorCount,
    warningCount: validationSummary.warningCount,
    handoffState: handoff.state,
    syncState: sync.state,
    replayIndexState: replayIndex.state,
    healthState: operationalHealth.state,
    subjectCoverageReadyRatio: replayIndex.subjectCoverage.readyRatio,
    subjectCoverageBlocked: replayIndex.subjectCoverage.blockedRows.length,
    replayIndexDigest: replayIndex.manifestDigest,
    digest: stableDigest({
      now,
      status: acceptance.status,
      command: lifecycle.command,
      readinessScore: readiness.score,
      sequence: sync.cursor.sequence,
      validationSummary,
      handoffState: handoff.state,
      syncState: sync.state,
      scheduleState: scheduleControls.state,
      healthState: operationalHealth.state,
      replayIndexState: replayIndex.state,
      subjectCoverageReadyRatio: replayIndex.subjectCoverage.readyRatio,
      subjectCoverageBlocked: replayIndex.subjectCoverage.blockedRows.length,
      replayIndexDigest: replayIndex.manifestDigest
    })
  };
  const snapshots = [...history, currentSnapshot];
  const unavailableProviderCount = providers.filter((provider) => provider.status === "unavailable").length;
  const degradedProviderCount = providers.filter((provider) => provider.status === "degraded").length;
  const commandCounts = snapshots.reduce((counts, snapshot) => {
    const key = snapshot.command || "none";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const timeline = [
    ...history.map((snapshot) => ({
      at: snapshot.capturedAt,
      type: "history-snapshot",
      label: snapshot.id,
      state: snapshot.status,
      digest: snapshot.digest
    })),
    {
      at: now,
      type: "current-evaluation",
      label: lifecycle.command,
      state: acceptance.status,
      digest: currentSnapshot.digest
    },
    {
      at: nextAction.dueAt || now,
      type: "next-action",
      label: nextAction.type,
      state: readiness.publishable ? "publishable" : scheduleControls.state,
      digest: stableDigest({
        nextAction,
        readinessState: readiness.state,
        publishable: readiness.publishable,
        scheduleState: scheduleControls.state
      })
    }
  ].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
  const exportRows = snapshots.map((snapshot, index) => ({
    rowId: `${settings.routeName}:analytics:${index + 1}`,
    order: index + 1,
    capturedAt: snapshot.capturedAt,
    source: snapshot.id === "current" ? "current-evaluation" : "history",
    status: snapshot.status,
    command: snapshot.command || "none",
    readinessScore: snapshot.readinessScore,
    entryCount: snapshot.entryCount,
    errorCount: snapshot.errorCount,
    warningCount: snapshot.warningCount,
    handoffState: snapshot.handoffState || "unknown",
    syncState: snapshot.syncState || "unknown",
    healthState: snapshot.healthState || "unknown",
    replayIndexState: snapshot.replayIndexState || "unknown",
    subjectCoverageReadyRatio: snapshot.subjectCoverageReadyRatio ?? null,
    subjectCoverageBlocked: snapshot.subjectCoverageBlocked ?? null,
    digest: snapshot.digest
  }));
  const metricSeries = {
    readinessScore: exportRows.map((row) => ({ at: row.capturedAt, value: row.readinessScore })),
    entryCount: exportRows.map((row) => ({ at: row.capturedAt, value: row.entryCount })),
    validationErrors: exportRows.map((row) => ({ at: row.capturedAt, value: row.errorCount })),
    validationWarnings: exportRows.map((row) => ({ at: row.capturedAt, value: row.warningCount })),
    subjectCoverageReadyRatio: [
      ...history.map((snapshot) => ({
        at: snapshot.capturedAt,
        value: snapshot.subjectCoverageReadyRatio ?? null
      })),
      {
        at: now,
        value: replayIndex.subjectCoverage.readyRatio
      }
    ]
  };
  const retentionWindow = {
    from: addMinutes(now, -settings.retentionDays * 24 * 60),
    through: now,
    retentionDays: settings.retentionDays,
    maxEntries: settings.maxEntries,
    retainedReplayRows: replayIndex.retainedRecords,
    droppedReplayRows: replayIndex.droppedForRetention,
    saturated: replayIndex.retainedRecords >= settings.maxEntries,
    replayRoot: settings.replayRoot
  };
  const reportChannels = [
    {
      id: "route-summary",
      kind: "route",
      ref: settings.routeName,
      ready: true,
      digest: stableDigest({ routeName: settings.routeName, currentSnapshot })
    },
    {
      id: "manifest-export",
      kind: "artifact",
      ref: replayIndex.exportRef,
      ready: replayIndex.state !== "invalid",
      digest: replayIndex.manifestDigest
    },
    {
      id: "subject-coverage-export",
      kind: "artifact",
      ref: replayIndex.subjectCoverage.exportRef,
      ready: replayIndex.subjectCoverage.blockedRows.length === 0,
      digest: replayIndex.subjectCoverage.digest
    },
    {
      id: "handoff-summary",
      kind: "handoff",
      ref: handoff.targetRefs[0]?.handoffRef || null,
      ready: handoff.state === "ready",
      digest: stableDigest({ targetRefs: handoff.targetRefs, state: handoff.state, blockingReasons: handoff.blockingReasons })
    }
  ];
  const auditEvidence = [
    {
      id: "analytics-counters",
      kind: "counter-digest",
      generatedAt: now,
      digest: stableDigest({ routeName: settings.routeName, countersSeed: exportRows, serviceContractDigest: serviceContract.digest })
    },
    {
      id: "analytics-timeline",
      kind: "timeline-digest",
      generatedAt: now,
      digest: stableDigest({ timeline, nextAction, readinessState: readiness.state })
    },
    {
      id: "analytics-export",
      kind: "export-digest",
      generatedAt: now,
      digest: stableDigest({
        exportRows,
        metricSeries,
        retentionWindow,
        reportChannels,
        subjectCoverageDigest: replayIndex.subjectCoverage.digest
      })
    },
    {
      id: "analytics-subject-coverage",
      kind: "subject-coverage-digest",
      generatedAt: now,
      digest: stableDigest({
        totals: replayIndex.subjectCoverage.totals,
        byKind: replayIndex.subjectCoverage.byKind,
        blockedRows: replayIndex.subjectCoverage.blockedRows
      })
    }
  ];
  const mailchimpHandoff = buildMailchimpReplayIndexHandoff({
    now,
    input,
    settings,
    lifecycle,
    scheduleControls,
    nextAction,
    serviceContract,
    sync,
    accessBoundary,
    handoff,
    replayIndex,
    operationalHealth,
    readiness,
    validationSummary,
    acceptance,
    exportRows,
    metricSeries,
    reportChannels
  });
  const trend = previous
    ? {
        readinessDelta: readiness.score - previous.readinessScore,
        errorDelta: validationSummary.errorCount - previous.errorCount,
        warningDelta: validationSummary.warningCount - previous.warningCount,
        entryDelta: sync.cursor.sequence - previous.entryCount,
        subjectCoverageReadyRatioDelta: previous.subjectCoverageReadyRatio === null
          ? null
          : Number((replayIndex.subjectCoverage.readyRatio - previous.subjectCoverageReadyRatio).toFixed(4)),
        statusChanged: previous.status !== acceptance.status,
        handoffChanged: previous.handoffState !== handoff.state
      }
    : {
        readinessDelta: null,
        errorDelta: null,
        warningDelta: null,
        entryDelta: null,
        subjectCoverageReadyRatioDelta: null,
        statusChanged: false,
        handoffChanged: false
      };
  const counters = {
    snapshots: snapshots.length,
    historicalSnapshots: history.length,
    providers: providers.length,
    degradedProviders: degradedProviderCount,
    unavailableProviders: unavailableProviderCount,
    serviceOperations: serviceContract.operations.length,
    blockedServiceOperations: serviceContract.blockedOperations.length,
    healthIncidents: operationalHealth.incidents.length,
    healthActionableErrors: operationalHealth.actionableErrors.length,
    healthRetryQueue: operationalHealth.retryQueue.length,
    healthExhaustedRetries: operationalHealth.failureState.exhaustedRetries.length,
    healthRetryPlanState: operationalHealth.retryExecutionPlan.state,
    healthRetryReady: operationalHealth.retryExecutionPlan.readyIncidentIds.length,
    healthRetryBlocked: operationalHealth.retryExecutionPlan.blockedIncidentIds.length,
    healthDegradedModeAllowed: operationalHealth.retryExecutionPlan.degradedModeAllowed ? 1 : 0,
    availableCapabilities: capabilityNegotiation.available.length,
    missingCapabilities: capabilityNegotiation.missingRequired.length,
    readinessChecksReady: readiness.readyCount,
    readinessChecksTotal: readiness.totalCount,
    validationErrors: validationSummary.errorCount,
    validationWarnings: validationSummary.warningCount,
    nextSteps: nextSteps.length,
    handoffTargets: handoff.targetRefs.length,
    blockingReasons: handoff.blockingReasons.length,
    clientWorkflowSteps: clientRequest.runtime.steps.length,
    clientWorkflowBlockedSteps: clientRequest.blockedStepIds.length,
    clientWorkflowIncompleteSteps: clientRequest.incompleteRequiredStepIds.length,
    clientWorkflowComplete: clientRequest.workflowComplete ? 1 : 0,
    clientRecordHandoffRows: clientRequest.recordHandoffQueue.totalRows,
    clientRecordHandoffReadyRows: clientRequest.recordHandoffQueue.readyRows,
    clientRecordHandoffAckRows: clientRequest.recordHandoffQueue.ackRequiredRows,
    clientRecordHandoffBlockedRows: clientRequest.recordHandoffQueue.blockedRows,
    clientRecordHandoffAttentionRows: clientRequest.recordHandoffQueue.attentionRows,
    clientTransitionRoutes: clientRequest.transitionPlan.transitions.filter((transition) => transition.routeHint).length,
    clientTransitionBlocked: clientRequest.transitionPlan.blockedTransitionIds.length,
    clientTransitionAdvanceable: clientRequest.transitionPlan.advanceableTransitionIds.length,
    missingPermissions: accessBoundary.missingPermissions.length,
    scopeViolations: accessBoundary.scopeViolations.length,
    delegatedScopes: accessBoundary.delegatedScopes.length,
    boundaryIssues: accessBoundary.boundaryIssues.length,
    crossScopeGrants: accessBoundary.crossScopeGrants.length,
    expiredBoundaryGrants: accessBoundary.expiredGrantIds.length,
    invalidBoundaryGrants: accessBoundary.invalidGrantIds.length,
    replayRecords: replayIndex.retainedRecords,
    replayRecordsDropped: replayIndex.droppedForRetention,
    replayInvalidRows: replayIndex.invalidRows.length,
    replayDuplicateKeys: replayIndex.duplicateKeys.length,
    replayConflictRows: replayIndex.conflictRows.length,
    replayConflictRecords: replayIndex.conflictRecordIds.length,
    replaySubjectCoverageRows: replayIndex.subjectCoverage.exportRows.length,
    replaySubjectCoverageReady: replayIndex.subjectCoverage.totals.readySubjects,
    replaySubjectCoverageBlocked: replayIndex.subjectCoverage.totals.incompleteSubjects,
    replaySubjectCoverageReadyRatio: replayIndex.subjectCoverage.readyRatio,
    replaySubjectBundlePreviewRows: replayIndex.subjectBundlePreview.totalRows,
    replaySubjectBundlePreviewAccepted: replayIndex.subjectBundlePreview.acceptedRows,
    replaySubjectBundlePreviewBlocked: replayIndex.subjectBundlePreview.blockedRows.length,
    replaySubjectBundlePreviewAttention: replayIndex.subjectBundlePreview.attentionRows.length,
    replayJobSubjects: replayIndex.subjectCoverage.byKind.job.subjectCount,
    replayProcessSubjects: replayIndex.subjectCoverage.byKind.process.subjectCount,
    replayClaimSubjects: replayIndex.subjectCoverage.byKind.claim.subjectCount,
    analyticsExportRows: exportRows.length,
    analyticsTimelineEvents: timeline.length,
    analyticsReportChannels: reportChannels.length,
    analyticsReadyReportChannels: reportChannels.filter((channel) => channel.ready).length,
    mailchimpRows: mailchimpHandoff.rowCount,
    mailchimpReadyRows: mailchimpHandoff.readyRowCount,
    mailchimpBlockedRows: mailchimpHandoff.blockedRowCount,
    analyticsEvidenceRows: auditEvidence.length,
    evidence: evidence.length,
    syncSequence: sync.cursor.sequence,
    scheduleDue: scheduleControls.due ? 1 : 0,
    scheduleCatchUpRuns: scheduleControls.catchUpRuns,
    lifecycleEligibleCommands: scheduleControls.commandRows.filter((row) => row.scheduleEligible).length,
    lifecycleBlockedCommands: scheduleControls.commandRows.filter((row) => !row.scheduleEligible).length,
    commandCounts
  };
  const exportSummary = {
    format: "hosted-kernel.replay-index.analytics.v1",
    generatedAt: now,
    routeName: settings.routeName,
    replayRoot: settings.replayRoot,
    tenantId: accessBoundary.tenantId,
    workspaceId: accessBoundary.workspaceId,
    status: acceptance.status,
    accepted: acceptance.accepted,
    readinessScore: readiness.score,
    lifecycleStatus: lifecycle.status,
    scheduleState: scheduleControls.state,
    nextAction: nextAction.type,
    dueAt: nextAction.dueAt,
    proofMode: settings.proofMode,
    serviceContractState: serviceContract.state,
    serviceContractDigest: serviceContract.digest,
    operationalHealthState: operationalHealth.state,
    operationalHealthDigest: operationalHealth.digest,
    degradedMode: operationalHealth.degradedMode,
    clientTransitionState: clientRequest.transitionPlan.state,
    clientTransitionPrimaryAction: clientRequest.transitionPlan.primaryAction,
    clientTransitionDigest: clientRequest.transitionPlan.digest,
    clientRecordHandoffState: clientRequest.recordHandoffQueue.state,
    clientRecordHandoffRows: clientRequest.recordHandoffQueue.totalRows,
    clientRecordHandoffBlockedRows: clientRequest.recordHandoffQueue.blockedRows,
    clientRecordHandoffAttentionRows: clientRequest.recordHandoffQueue.attentionRows,
    clientRecordHandoffDigest: clientRequest.recordHandoffQueue.digest,
    replayIndexState: replayIndex.state,
    replayIndexDigest: replayIndex.manifestDigest,
    replayIndexRows: replayIndex.retainedRecords,
    replayIndexExportRef: replayIndex.exportRef,
    subjectCoverage: {
      exportRef: replayIndex.subjectCoverage.exportRef,
      digest: replayIndex.subjectCoverage.digest,
      readyRatio: replayIndex.subjectCoverage.readyRatio,
      totals: replayIndex.subjectCoverage.totals,
      blockedRows: replayIndex.subjectCoverage.blockedRows
    },
    subjectBundlePreview: {
      exportRef: replayIndex.subjectBundlePreview.exportRef,
      digest: replayIndex.subjectBundlePreview.digest,
      state: replayIndex.subjectBundlePreview.state,
      totalRows: replayIndex.subjectBundlePreview.totalRows,
      acceptedRows: replayIndex.subjectBundlePreview.acceptedRows,
      blockedRows: replayIndex.subjectBundlePreview.blockedRows,
      attentionRows: replayIndex.subjectBundlePreview.attentionRows,
      nextStepRows: replayIndex.subjectBundlePreview.nextStepRows
    },
    rowCount: snapshots.length,
    exportRowCount: exportRows.length,
    reportChannelCount: reportChannels.length,
    reportChannelReadyCount: reportChannels.filter((channel) => channel.ready).length,
    retentionWindow,
    exportRefs: reportChannels.map((channel) => ({
      id: channel.id,
      kind: channel.kind,
      ref: channel.ref,
      ready: channel.ready,
      digest: channel.digest
    })),
    mailchimp: {
      state: mailchimpHandoff.state,
      listRef: mailchimpHandoff.listRef,
      rowCount: mailchimpHandoff.rowCount,
      readyRowCount: mailchimpHandoff.readyRowCount,
      blockedReasonCodes: mailchimpHandoff.blockedReasonCodes,
      exportDigest: mailchimpHandoff.exportDigest
    },
    counterDigest: stableDigest(counters),
    timelineDigest: stableDigest(timeline),
    exportDigest: stableDigest({
      exportRows,
      metricSeries,
      retentionWindow,
      reportChannels,
      subjectCoverageDigest: replayIndex.subjectCoverage.digest
    })
  };
  return {
    counters,
    trend,
    currentSnapshot,
    history,
    timeline,
    exportRows,
    metricSeries,
    retentionWindow,
    reportChannels,
    mailchimpHandoff,
    auditEvidence,
    exportSummary,
    reportState: {
      state: acceptance.accepted ? "export-ready" : validationSummary.errorCount > 0 ? "blocked" : "attention",
      staleHistory: previous ? ageMinutes(now, previous.capturedAt) > settings.intervalMinutes * 2 : true,
      lastSnapshotAt: previous ? previous.capturedAt : null,
      nextReportAt: nextAction.dueAt,
      reportable: reportChannels.every((channel) => channel.ready) && validationSummary.errorCount === 0,
      blockedChannels: reportChannels.filter((channel) => !channel.ready).map((channel) => channel.id),
      digest: stableDigest({ counters, trend, exportSummary, auditEvidence })
    }
  };
}

function normalizeClientRequest(input, settings, command, now, replayIndex = null) {
  const request = asObject(input.request);
  const client = asObject(input.clientState || input.client || request.client);
  const route = asObject(client.route || request.route);
  const workflow = asObject(client.workflow || request.workflow);
  const handoff = asObject(client.handoff || request.handoff);
  const rawIntent = typeof workflow.intent === "string"
    ? workflow.intent
    : typeof client.intent === "string"
      ? client.intent
      : typeof request.intent === "string"
        ? request.intent
        : command;
  const normalizedIntent = typeof rawIntent === "string" ? rawIntent.trim().toLowerCase() : "inspect";
  const intent = CLIENT_WORKFLOW_INTENTS.has(normalizedIntent) ? normalizedIntent : "inspect";
  const lastSeenAt = normalizeTimestamp(client.lastSeenAt || request.lastSeenAt);
  const clientAgeMinutes = ageMinutes(now, lastSeenAt);
  const routeName = typeof route.name === "string" && route.name.trim()
    ? route.name.trim()
    : typeof client.routeName === "string" && client.routeName.trim()
      ? client.routeName.trim()
      : settings.routeName;
  const handoffStatus = typeof handoff.status === "string" ? handoff.status.trim().toLowerCase() : null;
  const clientHandoffStatus = typeof client.handoffStatus === "string" ? client.handoffStatus.trim().toLowerCase() : null;
  const acknowledged = handoff.acknowledged === true
    || CLIENT_HANDOFF_ACKS.has(handoffStatus)
    || CLIENT_HANDOFF_ACKS.has(clientHandoffStatus);
  const publishRequested = handoff.publishRequested === true || intent === "publish";
  const workflowVisible = workflow.visible === false ? false : true;
  const stale = clientAgeMinutes !== null && clientAgeMinutes > 30;
  const baseContext = {
    requestId: typeof request.id === "string" && request.id.trim() ? request.id.trim() : null,
    clientId: typeof client.id === "string" && client.id.trim() ? client.id.trim() : null,
    sessionId: typeof client.sessionId === "string" && client.sessionId.trim() ? client.sessionId.trim() : null,
    actorId: typeof client.actorId === "string" && client.actorId.trim() ? client.actorId.trim() : null,
    routeName,
    intent,
    publishRequested,
    workflowVisible,
    handoffAcknowledged: acknowledged,
    handoffRef: typeof handoff.ref === "string" && handoff.ref.trim() ? handoff.ref.trim() : null,
    routeMatches: routeName === settings.routeName
  };
  const runtime = buildClientRuntimeContract(now, settings, request, client, workflow, handoff, baseContext, replayIndex);
  return {
    bound: Object.keys(client).length > 0 || Object.keys(request).length > 0,
    requestId: baseContext.requestId,
    clientId: baseContext.clientId,
    sessionId: baseContext.sessionId,
    actorId: baseContext.actorId,
    tenantId: normalizeScopeId(client.tenantId || client.tenant || request.tenantId || request.tenant),
    workspaceId: normalizeScopeId(client.workspaceId || client.workspace || request.workspaceId || request.workspace),
    routeName,
    expectedRouteName: settings.routeName,
    intent,
    publishRequested,
    workflowVisible,
    handoffAcknowledged: acknowledged,
    handoffRef: baseContext.handoffRef,
    lastSeenAt,
    ageMinutes: clientAgeMinutes,
    stale,
    routeMatches: routeName === settings.routeName,
    runtime,
    workflowState: runtime.state,
    workflowComplete: runtime.workflowComplete,
    activeStepId: runtime.activeStepId,
    blockedStepIds: runtime.blockedStepIds,
    incompleteRequiredStepIds: runtime.incompleteRequiredStepIds,
    handoffPacket: runtime.handoffPacket,
    transitionPlan: runtime.transitionPlan,
    recordHandoffQueue: runtime.recordHandoffQueue,
    nextClientAction: runtime.transitionPlan.primaryAction
  };
}

function permissionsForRoles(roles) {
  const permissions = new Set();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] || []) permissions.add(permission);
  }
  return [...permissions].sort();
}

function normalizeBoundaryGrant(rawGrant, index) {
  const grant = asObject(rawGrant);
  const tenantId = normalizeScopeId(grant.tenantId || grant.tenant || grant.fromTenantId || grant.fromTenant);
  const workspaceId = normalizeScopeId(grant.workspaceId || grant.workspace || grant.fromWorkspaceId || grant.fromWorkspace);
  const providerId = normalizeScopeId(grant.providerId || grant.provider);
  const clientId = normalizeScopeId(grant.clientId || grant.client);
  const subject = typeof grant.subject === "string" && grant.subject.trim()
    ? grant.subject.trim()
    : providerId
      ? `provider:${providerId}`
      : clientId
        ? `client:${clientId}`
        : null;
  return {
    id: typeof grant.id === "string" && grant.id.trim() ? grant.id.trim() : `boundary-grant-${index + 1}`,
    tenantId,
    workspaceId,
    providerId,
    clientId,
    subject,
    reason: typeof grant.reason === "string" && grant.reason.trim() ? grant.reason.trim() : "delegated replay-index boundary",
    approvedBy: typeof grant.approvedBy === "string" && grant.approvedBy.trim() ? grant.approvedBy.trim() : null,
    expiresAt: normalizeTimestamp(grant.expiresAt || grant.validUntil),
    permissions: normalizeStringList(grant.permissions || grant.capabilities)
  };
}

function boundaryGrantCovers(grants, now, scope) {
  return grants.find((grant) => {
    if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= new Date(now).getTime()) return false;
    if (scope.tenantId && grant.tenantId && grant.tenantId !== scope.tenantId) return false;
    if (scope.workspaceId && grant.workspaceId && grant.workspaceId !== scope.workspaceId) return false;
    if (scope.providerId && grant.providerId && grant.providerId !== scope.providerId) return false;
    if (scope.clientId && grant.clientId && grant.clientId !== scope.clientId) return false;
    if (scope.subject && grant.subject && grant.subject !== scope.subject) return false;
    return grant.providerId === scope.providerId
      || grant.clientId === scope.clientId
      || grant.subject === scope.subject
      || ((grant.tenantId === scope.tenantId || grant.workspaceId === scope.workspaceId) && !grant.providerId && !grant.clientId);
  }) || null;
}

function normalizeAccessBoundary(input, command, providers, clientRequest, now) {
  const request = asObject(input.request);
  const boundary = asObject(input.accessBoundary || input.boundary || input.workspaceBoundary);
  const tenant = asObject(input.tenant);
  const workspace = asObject(input.workspace);
  const rawRoles = normalizeStringList(boundary.roles || boundary.actorRoles || input.roles)
    .map((role) => role.toLowerCase())
    .filter((role) => ACCESS_ROLES.has(role));
  const roles = rawRoles.length > 0 ? rawRoles : ["operator"];
  const rolePermissions = permissionsForRoles(roles);
  const explicitPermissions = normalizeStringList(boundary.permissions || input.permissions);
  const effectivePermissions = [...new Set([...rolePermissions, ...explicitPermissions])].sort();
  const tenantId = normalizeScopeId(
    boundary.tenantId || tenant.id || request.tenantId || clientRequest.tenantId,
    "default-tenant"
  );
  const workspaceId = normalizeScopeId(
    boundary.workspaceId || workspace.id || request.workspaceId || clientRequest.workspaceId,
    "default-workspace"
  );
  const actorId = normalizeScopeId(boundary.actorId || request.actorId || clientRequest.actorId, "system");
  const strictIsolation = boundary.strictIsolation === false ? false : true;
  const grants = (
    Array.isArray(boundary.crossScopeGrants)
      ? boundary.crossScopeGrants
      : Array.isArray(boundary.delegations)
        ? boundary.delegations
        : Array.isArray(input.crossScopeGrants)
          ? input.crossScopeGrants
          : []
  ).map((grant, index) => normalizeBoundaryGrant(grant, index));
  const requiredPermissions = [
    ...(COMMAND_PERMISSIONS[command] || ["replay.inspect"]),
    ...(clientRequest.publishRequested ? ["handoff.publish"] : [])
  ];
  const missingPermissions = requiredPermissions.filter((permission) => !effectivePermissions.includes(permission));
  const scopeIdIssues = [
    scopeIdIssue("tenant", tenantId),
    scopeIdIssue("workspace", workspaceId),
    scopeIdIssue("actor", actorId)
  ].filter(Boolean);
  const scopeViolations = [];
  const delegatedScopes = [];
  if (clientRequest.tenantId && clientRequest.tenantId !== tenantId) {
    const grant = boundaryGrantCovers(grants, now, {
      tenantId: clientRequest.tenantId,
      workspaceId: clientRequest.workspaceId,
      clientId: clientRequest.clientId,
      subject: clientRequest.clientId ? `client:${clientRequest.clientId}` : null
    });
    if (grant) delegatedScopes.push({ kind: "client-tenant", scopeId: clientRequest.tenantId, grantId: grant.id });
    else scopeViolations.push(`client-tenant:${clientRequest.tenantId}`);
  }
  if (clientRequest.workspaceId && clientRequest.workspaceId !== workspaceId) {
    const grant = boundaryGrantCovers(grants, now, {
      tenantId: clientRequest.tenantId,
      workspaceId: clientRequest.workspaceId,
      clientId: clientRequest.clientId,
      subject: clientRequest.clientId ? `client:${clientRequest.clientId}` : null
    });
    if (grant) delegatedScopes.push({ kind: "client-workspace", scopeId: clientRequest.workspaceId, grantId: grant.id });
    else scopeViolations.push(`client-workspace:${clientRequest.workspaceId}`);
  }
  for (const provider of providers) {
    if (provider.tenantId && provider.tenantId !== tenantId) {
      const grant = boundaryGrantCovers(grants, now, {
        tenantId: provider.tenantId,
        workspaceId: provider.workspaceId,
        providerId: provider.id,
        subject: `provider:${provider.id}`
      });
      if (grant) delegatedScopes.push({ kind: "provider-tenant", providerId: provider.id, scopeId: provider.tenantId, grantId: grant.id });
      else scopeViolations.push(`provider:${provider.id}:tenant`);
    }
    if (provider.workspaceId && provider.workspaceId !== workspaceId) {
      const grant = boundaryGrantCovers(grants, now, {
        tenantId: provider.tenantId,
        workspaceId: provider.workspaceId,
        providerId: provider.id,
        subject: `provider:${provider.id}`
      });
      if (grant) delegatedScopes.push({ kind: "provider-workspace", providerId: provider.id, scopeId: provider.workspaceId, grantId: grant.id });
      else scopeViolations.push(`provider:${provider.id}:workspace`);
    }
  }
  const expiredGrantIds = grants
    .filter((grant) => grant.expiresAt && new Date(grant.expiresAt).getTime() <= new Date(now).getTime())
    .map((grant) => grant.id);
  const invalidGrantIds = grants
    .filter((grant) => !grant.approvedBy || (!grant.providerId && !grant.clientId && !grant.tenantId && !grant.workspaceId))
    .map((grant) => grant.id);
  const isolationBlocked = strictIsolation && scopeViolations.length > 0;
  const grantBlocked = strictIsolation && (expiredGrantIds.length > 0 || invalidGrantIds.length > 0);
  const boundaryIssues = [...scopeIdIssues, ...scopeViolations, ...expiredGrantIds.map((id) => `grant:${id}:expired`), ...invalidGrantIds.map((id) => `grant:${id}:invalid`)];
  return {
    tenantId,
    workspaceId,
    actorId,
    roles,
    effectivePermissions,
    requiredPermissions,
    missingPermissions,
    strictIsolation,
    scopeIdIssues,
    scopeViolations,
    delegatedScopes,
    crossScopeGrants: grants.map((grant) => ({
      id: grant.id,
      tenantId: grant.tenantId,
      workspaceId: grant.workspaceId,
      providerId: grant.providerId,
      clientId: grant.clientId,
      subject: grant.subject,
      approvedBy: grant.approvedBy,
      expiresAt: grant.expiresAt,
      permissions: grant.permissions
    })),
    expiredGrantIds,
    invalidGrantIds,
    boundaryIssues,
    state: missingPermissions.length > 0 || scopeIdIssues.length > 0 || isolationBlocked || grantBlocked ? "blocked" : "ready",
    auditScope: stableDigest({ tenantId, workspaceId, actorId, roles, strictIsolation, delegatedScopes, grants })
  };
}

function buildSyncMetadata(now, input, providers, lifecycle, capabilityNegotiation, serviceContract, replayIndex) {
  const syncInput = normalizeSyncInput(input.sync);
  const cursor = replayIndex.recordsBound
    ? replayIndex.cursor
    : syncInput.cursor;
  const providerCursors = providers
    .filter((provider) => provider.checkpoint || provider.watermark)
    .map((provider) => ({
      providerId: provider.id,
      checkpoint: provider.checkpoint,
      watermark: provider.watermark
    }));
  const refreshReason = lifecycle.operations.compactRequested
    ? "compact-requested"
    : lifecycle.operations.rebuildRequested
      ? "rebuild-requested"
      : capabilityNegotiation.accepted
        ? serviceContract.state === "blocked"
          ? "service-contract-blocked"
          : "capabilities-ready"
        : "capabilities-blocked";
  return {
    state: lifecycle.enabled && capabilityNegotiation.accepted && serviceContract.state !== "blocked" ? "syncable" : "held",
    generatedAt: now,
    cursor,
    lastIndexedAt: syncInput.lastIndexedAt,
    externalRevision: syncInput.externalRevision,
    providerCursors,
    serviceOperations: serviceContract.syncOperationIds,
    serviceContractDigest: serviceContract.digest,
    replayIndexState: replayIndex.state,
    replayIndexDigest: replayIndex.manifestDigest,
    refreshReason,
    checkpointDigest: stableDigest({
      cursor,
      providerCursors,
      externalRevision: syncInput.externalRevision,
      refreshReason,
      replayIndexDigest: replayIndex.manifestDigest
    })
  };
}

function normalizeReplaySubjectRef(value, kind, record) {
  const fallback = kind === "job"
    ? record.jobId || record.job || record.jobRef
    : kind === "process"
      ? record.processId || record.process || record.processRef
      : record.claimId || record.claim || record.claimRef;
  const rawValue = asObject(value);
  const idValue = typeof value === "string" || typeof value === "number"
    ? String(value)
    : rawValue.id || rawValue[`${kind}Id`] || rawValue.ref || fallback;
  const id = typeof idValue === "string" && idValue.trim() ? idValue.trim() : null;
  if (!id) return null;
  const routeName = typeof rawValue.routeName === "string" && rawValue.routeName.trim()
    ? rawValue.routeName.trim()
    : typeof record.routeName === "string" && record.routeName.trim()
      ? record.routeName.trim()
      : null;
  return {
    kind,
    id,
    ref: typeof rawValue.ref === "string" && rawValue.ref.trim() ? rawValue.ref.trim() : `${kind}:${id}`,
    routeName,
    digest: typeof rawValue.digest === "string" && rawValue.digest.trim() ? rawValue.digest.trim() : null
  };
}

function replayRecordSubjectRefs(record) {
  const subjects = asObject(record.subjects || record.subjectRefs || record.entities);
  const refs = [
    normalizeReplaySubjectRef(subjects.job || record.jobRef || record.jobId || record.job, "job", record),
    normalizeReplaySubjectRef(subjects.process || record.processRef || record.processId || record.process, "process", record),
    normalizeReplaySubjectRef(subjects.claim || record.claimRef || record.claimId || record.claim, "claim", record)
  ].filter(Boolean);
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeReplayBundleRef(value, kind, id, settings, recordId) {
  const bundle = asObject(value);
  const inputBound = value !== undefined
    && value !== null
    && value !== ""
    && (typeof value !== "object" || Object.keys(bundle).length > 0);
  const refValue = typeof value === "string"
    ? value
    : bundle.ref || bundle.path || bundle.href || bundle.id;
  const ref = typeof refValue === "string" && refValue.trim()
    ? refValue.trim()
    : `${settings.replayRoot}/bundles/${recordId}/${kind}.json`;
  const digestValue = typeof bundle.digest === "string" && bundle.digest.trim()
    ? bundle.digest.trim()
    : typeof bundle.proofDigest === "string" && bundle.proofDigest.trim()
      ? bundle.proofDigest.trim()
      : null;
  return {
    kind,
    id,
    ref,
    digest: digestValue,
    format: typeof bundle.format === "string" && bundle.format.trim()
      ? bundle.format.trim()
      : `hosted-kernel.replay-index.${kind}-bundle.v1`,
    ready: bundle.ready === false ? false : true,
    present: inputBound,
    source: inputBound ? "input" : "derived-default",
    canonicalKey: stableDigest({ kind, id, ref, digest: digestValue, recordId })
  };
}

function replayRefBoundaryIssues(kind, ref, settings) {
  const issues = [];
  if (typeof ref !== "string" || !ref.trim()) {
    issues.push(`${kind}-ref-missing`);
    return issues;
  }
  const normalizedRef = ref.trim();
  if (normalizedRef.includes("..") || normalizedRef.startsWith("/") || normalizedRef.startsWith("~")) {
    issues.push(`${kind}-outside-workspace`);
  }
  if (normalizedRef.includes("\\") || normalizedRef.includes("//")) {
    issues.push(`${kind}-not-canonical`);
  }
  if (normalizedRef !== settings.replayRoot && !normalizedRef.startsWith(`${settings.replayRoot}/`)) {
    issues.push(`${kind}-outside-replay-root`);
  }
  return issues;
}

function buildReplayRecordIntegrity(record, settings) {
  const sourceRefIssues = replayRefBoundaryIssues("source-path", record.sourcePath, settings);
  const bundleRefIssues = record.bundles.flatMap((bundle) => (
    replayRefBoundaryIssues(`${bundle.kind}-bundle`, bundle.ref, settings).map((issue) => ({
      bundleId: bundle.id,
      kind: bundle.kind,
      issue
    }))
  ));
  const duplicateSubjectKeys = [];
  const subjectSeen = new Set();
  for (const subject of record.subjects) {
    const key = replaySubjectKey(subject);
    if (subjectSeen.has(key)) duplicateSubjectKeys.push(key);
    subjectSeen.add(key);
  }
  const bundleKinds = new Set(record.bundles.map((bundle) => bundle.kind));
  const missingBundleKinds = ["audit", "artifact"].filter((kind) => !bundleKinds.has(kind));
  const missingReadyBundleKinds = ["audit", "artifact"].filter((kind) => (
    !record.bundles.some((bundle) => bundle.kind === kind && bundle.ready)
  ));
  const cursorBound = Boolean(record.checkpoint || record.watermark);
  const blockingReasons = [
    ...sourceRefIssues,
    ...bundleRefIssues.map((row) => row.issue),
    ...missingBundleKinds.map((kind) => `${kind}-bundle-missing`),
    ...missingReadyBundleKinds.map((kind) => `${kind}-bundle-not-ready`),
    ...(cursorBound ? [] : ["cursor-missing"]),
    ...(record.subjects.length > 0 ? [] : ["subject-mapping-missing"])
  ];
  const warningReasons = [
    ...duplicateSubjectKeys.map((key) => `duplicate-subject:${key}`),
    ...record.bundles
      .filter((bundle) => bundle.source === "derived-default")
      .map((bundle) => `${bundle.kind}-bundle-derived-default-ref`),
    ...record.bundles
      .filter((bundle) => bundle.present && !bundle.digest)
      .map((bundle) => `${bundle.kind}-bundle-digest-missing`)
  ];
  return {
    format: "hosted-kernel.replay-index.row-integrity.v1",
    replayRecordId: record.id,
    state: blockingReasons.length > 0
      ? "blocked"
      : warningReasons.length > 0
        ? "attention"
        : "ready",
    cursorBound,
    requiredBundleKinds: ["audit", "artifact"],
    presentBundleKinds: [...bundleKinds].sort(),
    missingBundleKinds,
    missingReadyBundleKinds,
    sourceRefIssues,
    bundleRefIssues,
    duplicateSubjectKeys: [...new Set(duplicateSubjectKeys)].sort(),
    blockingReasons: [...new Set(blockingReasons)].sort(),
    warningReasons: [...new Set(warningReasons)].sort(),
    digest: stableDigest({
      replayRecordId: record.id,
      sourcePath: record.sourcePath,
      cursorBound,
      subjects: record.subjects.map((subject) => replaySubjectKey(subject)).sort(),
      bundles: record.bundles.map((bundle) => ({
        kind: bundle.kind,
        ref: bundle.ref,
        ready: bundle.ready,
        source: bundle.source,
        digest: bundle.digest
      })),
      blockingReasons,
      warningReasons
    })
  };
}

function replayRecordBundleRefs(record, id, settings) {
  const bundles = asObject(record.bundles || record.bundleRefs);
  const auditBundle = normalizeReplayBundleRef(
    bundles.audit || record.auditBundle || record.audit || record.auditRef,
    "audit",
    `${id}:audit`,
    settings,
    id
  );
  const artifactBundle = normalizeReplayBundleRef(
    bundles.artifact || record.artifactBundle || record.artifacts || record.artifactRef,
    "artifact",
    `${id}:artifact`,
    settings,
    id
  );
  return [auditBundle, artifactBundle];
}

function replaySubjectKey(subject) {
  return `${subject.kind}:${subject.id}`;
}

function replayArtifactIdentity(record) {
  const cursorParts = [
    record.checkpoint ? `checkpoint:${record.checkpoint}` : null,
    record.watermark ? `watermark:${record.watermark}` : null,
    `sequence:${record.sequence}`
  ].filter(Boolean);
  const subjectParts = record.subjects
    .map((subject) => replaySubjectKey(subject))
    .sort();
  return {
    sourceKey: `${record.sourcePath}#${record.sequence}`,
    cursorKey: cursorParts.join("|"),
    subjectKey: subjectParts.length > 0 ? subjectParts.join("|") : "subject:unmapped",
    artifactKey: stableDigest({
      sourcePath: record.sourcePath,
      checkpoint: record.checkpoint,
      watermark: record.watermark,
      sequence: record.sequence,
      subjects: subjectParts,
      operation: record.operation
    })
  };
}

function buildReplayConflictRows(records) {
  const indexes = {
    idSequence: new Map(),
    sourceSequence: new Map(),
    cursorSequence: new Map(),
    artifact: new Map()
  };
  for (const record of records) {
    const identity = replayArtifactIdentity(record);
    const keys = {
      idSequence: `${record.id}:${record.sequence}`,
      sourceSequence: identity.sourceKey,
      cursorSequence: identity.cursorKey,
      artifact: identity.artifactKey
    };
    for (const [kind, key] of Object.entries(keys)) {
      if (!key || key === "sequence:0") continue;
      const row = indexes[kind].get(key) || {
        kind,
        key,
        replayRecordIds: [],
        rowDigests: [],
        sourcePaths: [],
        checkpoints: [],
        watermarks: [],
        sequences: []
      };
      row.replayRecordIds.push(record.id);
      row.rowDigests.push(record.rowDigest);
      row.sourcePaths.push(record.sourcePath);
      if (record.checkpoint) row.checkpoints.push(record.checkpoint);
      if (record.watermark) row.watermarks.push(record.watermark);
      row.sequences.push(record.sequence);
      indexes[kind].set(key, row);
    }
  }
  return Object.values(indexes)
    .flatMap((index) => [...index.values()])
    .filter((row) => new Set(row.rowDigests).size > 1 || new Set(row.replayRecordIds).size > 1)
    .map((row) => ({
      kind: row.kind,
      key: row.key,
      replayRecordIds: [...new Set(row.replayRecordIds)].sort(),
      rowDigests: [...new Set(row.rowDigests)].sort(),
      sourcePaths: [...new Set(row.sourcePaths)].sort(),
      checkpoints: [...new Set(row.checkpoints)].sort(),
      watermarks: [...new Set(row.watermarks)].sort(),
      sequences: [...new Set(row.sequences)].sort((left, right) => left - right),
      repairAction: row.kind === "artifact"
        ? "dedupe-identical-replay-artifact"
        : row.kind === "cursorSequence"
          ? "repair-conflicting-replay-cursor"
          : "repair-conflicting-replay-row-key"
    }));
}

function buildReplayEntityIndex(retained) {
  const bySubject = new Map();
  for (const record of retained) {
    for (const subject of record.subjects) {
      const key = replaySubjectKey(subject);
      const current = bySubject.get(key) || {
        kind: subject.kind,
        id: subject.id,
        ref: subject.ref,
        routeName: subject.routeName,
        replayRecordIds: [],
        auditBundleRefs: [],
        artifactBundleRefs: [],
        bundlePairs: [],
        latestCursor: null
      };
      current.replayRecordIds.push(record.id);
      const auditBundle = record.bundles.find((bundle) => bundle.kind === "audit") || null;
      const artifactBundle = record.bundles.find((bundle) => bundle.kind === "artifact") || null;
      for (const bundle of record.bundles) {
        if (bundle.kind === "audit") current.auditBundleRefs.push(bundle.ref);
        if (bundle.kind === "artifact") current.artifactBundleRefs.push(bundle.ref);
      }
      current.bundlePairs.push({
        replayRecordId: record.id,
        sequence: record.sequence,
        capturedAt: record.capturedAt,
        checkpoint: record.checkpoint,
        watermark: record.watermark,
        auditBundleRef: auditBundle?.ref || null,
        auditBundleDigest: auditBundle?.digest || null,
        artifactBundleRef: artifactBundle?.ref || null,
        artifactBundleDigest: artifactBundle?.digest || null,
        complete: Boolean(auditBundle?.ready && artifactBundle?.ready)
      });
      current.latestCursor = {
        checkpoint: record.checkpoint,
        watermark: record.watermark,
        sequence: record.sequence
      };
      bySubject.set(key, current);
    }
  }
  return [...bySubject.values()].map((entry) => ({
    ...entry,
    replayRecordIds: [...new Set(entry.replayRecordIds)],
    auditBundleRefs: [...new Set(entry.auditBundleRefs)],
    artifactBundleRefs: [...new Set(entry.artifactBundleRefs)],
    recordCount: new Set(entry.replayRecordIds).size,
    completeBundleRecordIds: entry.bundlePairs
      .filter((pair) => pair.complete)
      .map((pair) => pair.replayRecordId),
    incompleteBundleRecordIds: entry.bundlePairs
      .filter((pair) => !pair.complete)
      .map((pair) => pair.replayRecordId),
    coverage: {
      auditBundles: new Set(entry.auditBundleRefs).size,
      artifactBundles: new Set(entry.artifactBundleRefs).size,
      completePairs: entry.bundlePairs.filter((pair) => pair.complete).length,
      totalPairs: entry.bundlePairs.length
    }
  }));
}

function buildReplayLookupRecords(retained, entityIndex, settings) {
  const rows = [];
  for (const entity of entityIndex) {
    const sourceRecords = retained.filter((record) => (
      record.subjects.some((subject) => subject.kind === entity.kind && subject.id === entity.id)
    ));
    const auditBundles = [];
    const artifactBundles = [];
    for (const record of sourceRecords) {
      for (const bundle of record.bundles) {
        const row = {
          replayRecordId: record.id,
          sequence: record.sequence,
          capturedAt: record.capturedAt,
          ref: bundle.ref,
          digest: bundle.digest,
          ready: bundle.ready,
          present: bundle.present,
          source: bundle.source,
          canonicalKey: bundle.canonicalKey
        };
        if (bundle.kind === "audit") auditBundles.push(row);
        if (bundle.kind === "artifact") artifactBundles.push(row);
      }
    }
    const latestRecord = sourceRecords[sourceRecords.length - 1] || null;
    const complete = sourceRecords.length > 0
      && sourceRecords.every((record) => (
        record.bundles.some((bundle) => bundle.kind === "audit" && bundle.ready)
        && record.bundles.some((bundle) => bundle.kind === "artifact" && bundle.ready)
      ));
    rows.push({
      format: "hosted-kernel.replay-index.lookup-record.v1",
      lookupKey: `${entity.kind}:${entity.id}`,
      subject: {
        kind: entity.kind,
        id: entity.id,
        ref: entity.ref,
        routeName: entity.routeName || settings.routeName
      },
      replayRecordIds: entity.replayRecordIds,
      recordCount: entity.recordCount,
      latestCursor: {
        checkpoint: latestRecord?.checkpoint || null,
        watermark: latestRecord?.watermark || null,
        sequence: latestRecord?.sequence || 0
      },
      auditBundles,
      artifactBundles,
      bundlePairs: entity.bundlePairs,
      complete,
      exportRef: `${settings.replayRoot}/lookups/${entity.kind}/${entity.id}.json`,
      digest: stableDigest({
        lookupKey: `${entity.kind}:${entity.id}`,
        replayRecordIds: entity.replayRecordIds,
        auditBundles,
        artifactBundles,
        complete
      })
    });
  }
  return rows.sort((left, right) => left.lookupKey.localeCompare(right.lookupKey));
}

function buildReplaySubjectCoverage(lookupRecords, settings) {
  const byKind = {
    job: { subjectCount: 0, recordCount: 0, readySubjects: 0, incompleteSubjects: 0, auditBundles: 0, artifactBundles: 0 },
    process: { subjectCount: 0, recordCount: 0, readySubjects: 0, incompleteSubjects: 0, auditBundles: 0, artifactBundles: 0 },
    claim: { subjectCount: 0, recordCount: 0, readySubjects: 0, incompleteSubjects: 0, auditBundles: 0, artifactBundles: 0 }
  };
  const exportRows = lookupRecords.map((row, index) => {
    const kind = row.subject.kind;
    const stats = byKind[kind] || {
      subjectCount: 0,
      recordCount: 0,
      readySubjects: 0,
      incompleteSubjects: 0,
      auditBundles: 0,
      artifactBundles: 0
    };
    stats.subjectCount += 1;
    stats.recordCount += row.recordCount;
    stats.auditBundles += row.auditBundles.length;
    stats.artifactBundles += row.artifactBundles.length;
    if (row.complete) stats.readySubjects += 1;
    else stats.incompleteSubjects += 1;
    byKind[kind] = stats;
    return {
      rowId: `${settings.routeName}:subject-coverage:${index + 1}`,
      lookupKey: row.lookupKey,
      subjectKind: kind,
      subjectId: row.subject.id,
      recordCount: row.recordCount,
      auditBundleCount: row.auditBundles.length,
      artifactBundleCount: row.artifactBundles.length,
      completeBundlePairs: row.bundlePairs.filter((pair) => pair.complete).length,
      incompleteBundlePairs: row.bundlePairs.filter((pair) => !pair.complete).length,
      latestSequence: row.latestCursor.sequence,
      latestCheckpoint: row.latestCursor.checkpoint,
      latestWatermark: row.latestCursor.watermark,
      exportRef: row.exportRef,
      ready: row.complete,
      digest: row.digest
    };
  });
  const totals = Object.values(byKind).reduce((sum, stats) => ({
    subjectCount: sum.subjectCount + stats.subjectCount,
    recordCount: sum.recordCount + stats.recordCount,
    readySubjects: sum.readySubjects + stats.readySubjects,
    incompleteSubjects: sum.incompleteSubjects + stats.incompleteSubjects,
    auditBundles: sum.auditBundles + stats.auditBundles,
    artifactBundles: sum.artifactBundles + stats.artifactBundles
  }), {
    subjectCount: 0,
    recordCount: 0,
    readySubjects: 0,
    incompleteSubjects: 0,
    auditBundles: 0,
    artifactBundles: 0
  });
  const readyRatio = totals.subjectCount === 0
    ? 1
    : Number((totals.readySubjects / totals.subjectCount).toFixed(4));
  const blockedRows = exportRows
    .filter((row) => !row.ready)
    .map((row) => ({
      lookupKey: row.lookupKey,
      subjectKind: row.subjectKind,
      reason: row.auditBundleCount === 0 || row.artifactBundleCount === 0
        ? "bundle-reference-missing"
        : "bundle-pair-incomplete",
      exportRef: row.exportRef
    }));
  return {
    format: "hosted-kernel.replay-index.subject-coverage.v1",
    exportRef: `${settings.replayRoot}/analytics/subject-coverage.json`,
    totals,
    byKind,
    readyRatio,
    blockedRows,
    exportRows,
    digest: stableDigest({ routeName: settings.routeName, totals, byKind, blockedRows, exportRows })
  };
}

function buildReplaySubjectBundlePreview(lookupRecords, retained, conflictRows, settings) {
  const invalidReasonsByRecordId = new Map(
    retained
      .filter((record) => !record.valid)
      .map((record) => [record.id, record.invalidReasons])
  );
  const conflictRecordIds = new Set(conflictRows.flatMap((row) => row.replayRecordIds));
  const rows = lookupRecords.map((row, index) => {
    const auditReadyRows = row.auditBundles.filter((bundle) => bundle.ready);
    const artifactReadyRows = row.artifactBundles.filter((bundle) => bundle.ready);
    const derivedBundleRows = [...row.auditBundles, ...row.artifactBundles]
      .filter((bundle) => bundle.source === "derived-default");
    const invalidRecordReasons = row.replayRecordIds.flatMap((recordId) => (
      (invalidReasonsByRecordId.get(recordId) || []).map((reason) => `${recordId}:${reason}`)
    ));
    const blockers = [
      row.auditBundles.length === 0 ? "audit-bundle:missing" : null,
      row.artifactBundles.length === 0 ? "artifact-bundle:missing" : null,
      auditReadyRows.length === 0 ? "audit-bundle:not-ready" : null,
      artifactReadyRows.length === 0 ? "artifact-bundle:not-ready" : null,
      ...invalidRecordReasons.map((reason) => `replay-record:${reason}`),
      ...row.replayRecordIds
        .filter((recordId) => conflictRecordIds.has(recordId))
        .map((recordId) => `replay-record:${recordId}:conflict`)
    ].filter(Boolean);
    const warnings = derivedBundleRows.map((bundle) => `${bundle.kind}-bundle:${bundle.replayRecordId}:derived-default-ref`);
    const latestPair = row.bundlePairs[row.bundlePairs.length - 1] || null;
    const firstBlocker = blockers[0] || null;
    const state = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "attention" : "ready";
    const nextStep = firstBlocker
      ? {
          id: `repair-subject-bundle:${row.lookupKey}`,
          action: "Repair replay subject bundle mapping",
          reason: firstBlocker,
          routeHint: "replay-index",
          lookupKey: row.lookupKey,
          exportRef: row.exportRef
        }
      : warnings.length > 0
        ? {
            id: `confirm-derived-bundles:${row.lookupKey}`,
            action: "Confirm derived replay bundle references",
            reason: warnings[0],
            routeHint: "replay-index",
            lookupKey: row.lookupKey,
            exportRef: row.exportRef
          }
        : {
            id: `open-subject-bundle:${row.lookupKey}`,
            action: "Open replay subject bundle",
            reason: "audit and artifact bundles are ready",
            routeHint: "preview",
            lookupKey: row.lookupKey,
            exportRef: row.exportRef
          };
    return {
      format: "hosted-kernel.replay-index.subject-bundle-preview-row.v1",
      id: `subject-bundle-preview-${index + 1}`,
      order: index + 1,
      lookupKey: row.lookupKey,
      label: `${row.subject.kind}:${row.subject.id}`,
      subject: row.subject,
      state,
      acceptanceStatus: blockers.length === 0 ? "accepted" : "needs-attention",
      preview: {
        exportRef: row.exportRef,
        latestSequence: row.latestCursor.sequence,
        latestCheckpoint: row.latestCursor.checkpoint,
        latestWatermark: row.latestCursor.watermark,
        replayRecordIds: row.replayRecordIds,
        recordCount: row.recordCount,
        completeBundlePairs: row.bundlePairs.filter((pair) => pair.complete).length,
        totalBundlePairs: row.bundlePairs.length
      },
      bundleContract: {
        requiredKinds: ["audit", "artifact"],
        audit: {
          count: row.auditBundles.length,
          readyCount: auditReadyRows.length,
          primaryRef: latestPair?.auditBundleRef || auditReadyRows[auditReadyRows.length - 1]?.ref || null,
          primaryDigest: latestPair?.auditBundleDigest || auditReadyRows[auditReadyRows.length - 1]?.digest || null
        },
        artifact: {
          count: row.artifactBundles.length,
          readyCount: artifactReadyRows.length,
          primaryRef: latestPair?.artifactBundleRef || artifactReadyRows[artifactReadyRows.length - 1]?.ref || null,
          primaryDigest: latestPair?.artifactBundleDigest || artifactReadyRows[artifactReadyRows.length - 1]?.digest || null
        },
        derivedDefaultRefs: derivedBundleRows.map((bundle) => ({
          kind: bundle.kind,
          replayRecordId: bundle.replayRecordId,
          ref: bundle.ref
        }))
      },
      validationSummary: {
        status: blockers.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
        errorCount: blockers.length,
        warningCount: warnings.length,
        blockers,
        warnings
      },
      readiness: {
        state,
        ready: blockers.length === 0,
        auditReady: auditReadyRows.length > 0,
        artifactReady: artifactReadyRows.length > 0,
        conflictFree: row.replayRecordIds.every((recordId) => !conflictRecordIds.has(recordId)),
        invalidRecordCount: invalidRecordReasons.length
      },
      nextStep,
      clientContract: {
        routeName: row.subject.routeName || settings.routeName,
        lookupKey: row.lookupKey,
        exportRef: row.exportRef,
        canOpenAudit: auditReadyRows.length > 0,
        canOpenArtifact: artifactReadyRows.length > 0,
        canAccept: blockers.length === 0,
        actionId: nextStep.id
      },
      digest: stableDigest({
        lookupKey: row.lookupKey,
        state,
        blockers,
        warnings,
        latestCursor: row.latestCursor,
        auditBundles: row.auditBundles,
        artifactBundles: row.artifactBundles
      })
    };
  });
  const blockedRows = rows.filter((row) => row.validationSummary.errorCount > 0);
  const attentionRows = rows.filter((row) => row.validationSummary.errorCount === 0 && row.validationSummary.warningCount > 0);
  return {
    format: "hosted-kernel.replay-index.subject-bundle-preview.v1",
    routeName: settings.routeName,
    exportRef: `${settings.replayRoot}/previews/subject-bundles.json`,
    state: blockedRows.length > 0 ? "blocked" : attentionRows.length > 0 ? "attention" : "ready",
    totalRows: rows.length,
    acceptedRows: rows.filter((row) => row.acceptanceStatus === "accepted").length,
    blockedRows: blockedRows.map((row) => ({
      lookupKey: row.lookupKey,
      subject: row.subject,
      blockers: row.validationSummary.blockers,
      nextStepId: row.nextStep.id,
      exportRef: row.preview.exportRef
    })),
    attentionRows: attentionRows.map((row) => ({
      lookupKey: row.lookupKey,
      subject: row.subject,
      warnings: row.validationSummary.warnings,
      nextStepId: row.nextStep.id,
      exportRef: row.preview.exportRef
    })),
    nextStepRows: rows
      .filter((row) => row.state !== "ready")
      .map((row) => row.nextStep)
      .slice(0, 8),
    rows,
    digest: stableDigest({
      routeName: settings.routeName,
      rows: rows.map((row) => ({
        lookupKey: row.lookupKey,
        state: row.state,
        blockers: row.validationSummary.blockers,
        warnings: row.validationSummary.warnings,
        digest: row.digest
      }))
    })
  };
}

function buildReplayPersistenceBinding(now, retained, lookupRecords, persistedState, settings) {
  const persistedCursor = persistedState.cursor || {};
  const sequenceFence = toPositiveInteger(persistedCursor.sequence, 0);
  const cursorBound = Boolean(persistedCursor.checkpoint || persistedCursor.watermark || sequenceFence > 0);
  const rowBindings = retained.map((record) => {
    const checkpointMatches = Boolean(persistedCursor.checkpoint && record.checkpoint === persistedCursor.checkpoint);
    const watermarkMatches = Boolean(persistedCursor.watermark && record.watermark === persistedCursor.watermark);
    const sequenceCommitted = sequenceFence > 0 && record.sequence <= sequenceFence;
    const exactCursorMatch = checkpointMatches || watermarkMatches || (sequenceFence > 0 && record.sequence === sequenceFence);
    const replayStatus = !cursorBound
      ? "unfenced"
      : exactCursorMatch
        ? "cursor-match"
        : sequenceCommitted
          ? "committed"
          : "pending-replay";
    const auditBundle = record.bundles.find((bundle) => bundle.kind === "audit") || null;
    const artifactBundle = record.bundles.find((bundle) => bundle.kind === "artifact") || null;
    return {
      replayRecordId: record.id,
      sequence: record.sequence,
      checkpoint: record.checkpoint,
      watermark: record.watermark,
      replayStatus,
      restartSafe: replayStatus !== "unfenced" && record.valid,
      subjectKeys: record.subjects.map((subject) => replaySubjectKey(subject)).sort(),
      auditBundleRef: auditBundle?.ref || null,
      auditBundleDigest: auditBundle?.digest || null,
      artifactBundleRef: artifactBundle?.ref || null,
      artifactBundleDigest: artifactBundle?.digest || null,
      rowDigest: record.rowDigest
    };
  });
  const rowBindingsById = new Map(rowBindings.map((row) => [row.replayRecordId, row]));
  const lookupBindings = lookupRecords.map((lookup) => {
    const replayRows = lookup.replayRecordIds
      .map((recordId) => rowBindingsById.get(recordId))
      .filter(Boolean);
    const pendingReplayRecordIds = replayRows
      .filter((row) => row.replayStatus === "pending-replay" || row.replayStatus === "unfenced")
      .map((row) => row.replayRecordId);
    const committedReplayRecordIds = replayRows
      .filter((row) => row.replayStatus === "committed" || row.replayStatus === "cursor-match")
      .map((row) => row.replayRecordId);
    const latestRow = replayRows[replayRows.length - 1] || null;
    const completeBundlePair = lookup.bundlePairs.find((pair) => pair.complete) || null;
    return {
      lookupKey: lookup.lookupKey,
      subject: lookup.subject,
      state: pendingReplayRecordIds.length > 0
        ? "pending-replay"
        : lookup.complete
          ? "committed"
          : "bundle-incomplete",
      committedReplayRecordIds,
      pendingReplayRecordIds,
      latestCursor: lookup.latestCursor,
      resumeFromReplayRecordId: pendingReplayRecordIds[0] || latestRow?.replayRecordId || null,
      auditBundleRef: completeBundlePair?.auditBundleRef || lookup.auditBundles[lookup.auditBundles.length - 1]?.ref || null,
      artifactBundleRef: completeBundlePair?.artifactBundleRef || lookup.artifactBundles[lookup.artifactBundles.length - 1]?.ref || null,
      exportRef: lookup.exportRef,
      digest: stableDigest({
        lookupKey: lookup.lookupKey,
        committedReplayRecordIds,
        pendingReplayRecordIds,
        latestCursor: lookup.latestCursor,
        complete: lookup.complete
      })
    };
  });
  const pendingRows = rowBindings.filter((row) => row.replayStatus === "pending-replay");
  const unfencedRows = rowBindings.filter((row) => row.replayStatus === "unfenced");
  const cursorMatchRows = rowBindings.filter((row) => row.replayStatus === "cursor-match");
  const committedRows = rowBindings.filter((row) => row.replayStatus === "committed" || row.replayStatus === "cursor-match");
  const rewound = cursorBound && sequenceFence > 0 && retained.length > 0
    ? sequenceFence > retained[retained.length - 1].sequence
    : false;
  const state = !cursorBound
    ? retained.length > 0 ? "cursor-unbound" : "empty"
    : rewound
      ? "cursor-ahead-of-index"
      : unfencedRows.length > 0
        ? "unsafe"
        : pendingRows.length > 0
          ? "recoverable"
          : "aligned";
  const actions = [];
  if (!cursorBound && retained.length > 0) {
    actions.push({
      id: "bind-persisted-cursor",
      kind: "write-cursor-fence",
      reason: "persisted cursor is missing while replay rows are retained",
      replayRecordId: retained[retained.length - 1].id
    });
  }
  if (rewound) {
    actions.push({
      id: "rebuild-ahead-cursor",
      kind: "rebuild-index",
      reason: "persisted cursor sequence is ahead of retained replay rows",
      sequenceFence
    });
  }
  if (pendingRows.length > 0) {
    actions.push({
      id: "resume-pending-replay",
      kind: "resume-from-cursor",
      reason: "retained replay rows are newer than persisted cursor",
      replayRecordId: pendingRows[0].replayRecordId,
      checkpoint: pendingRows[0].checkpoint,
      watermark: pendingRows[0].watermark
    });
  }
  return {
    format: "hosted-kernel.replay-index.persistence-binding.v1",
    generatedAt: now,
    exportRef: `${settings.replayRoot}/recovery/persistence-binding.json`,
    state,
    cursorBound,
    persistedStatus: persistedState.status,
    restartSafe: state === "aligned" || state === "recoverable",
    cursor: {
      checkpoint: persistedCursor.checkpoint,
      watermark: persistedCursor.watermark,
      sequence: sequenceFence,
      proofDigest: persistedCursor.proofDigest
    },
    counts: {
      retainedRows: retained.length,
      committedRows: committedRows.length,
      cursorMatchRows: cursorMatchRows.length,
      pendingRows: pendingRows.length,
      unfencedRows: unfencedRows.length,
      lookupRows: lookupBindings.length
    },
    resume: {
      required: pendingRows.length > 0 || state === "cursor-unbound" || rewound,
      replayRecordId: pendingRows[0]?.replayRecordId || null,
      checkpoint: pendingRows[0]?.checkpoint || null,
      watermark: pendingRows[0]?.watermark || null,
      lookupKeys: lookupBindings
        .filter((row) => row.pendingReplayRecordIds.length > 0)
        .map((row) => row.lookupKey)
    },
    actions,
    rowBindings,
    lookupBindings,
    digest: stableDigest({
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      persistedStatus: persistedState.status,
      cursor: persistedCursor,
      state,
      rowBindings: rowBindings.map((row) => ({
        replayRecordId: row.replayRecordId,
        replayStatus: row.replayStatus,
        rowDigest: row.rowDigest
      })),
      lookupBindings: lookupBindings.map((row) => ({
        lookupKey: row.lookupKey,
        state: row.state,
        digest: row.digest
      }))
    })
  };
}

function normalizeReplayScopeContext(input) {
  const request = asObject(input.request);
  const boundary = asObject(input.accessBoundary || input.boundary || input.workspaceBoundary);
  const replayIndex = asObject(input.replayIndex || input.index);
  const tenant = asObject(input.tenant);
  const workspace = asObject(input.workspace);
  const tenantId = normalizeScopeId(
    replayIndex.tenantId || replayIndex.tenant || boundary.tenantId || tenant.id || request.tenantId,
    "default-tenant"
  );
  const workspaceId = normalizeScopeId(
    replayIndex.workspaceId || replayIndex.workspace || boundary.workspaceId || workspace.id || request.workspaceId,
    "default-workspace"
  );
  const strictIsolation = replayIndex.strictIsolation === false || boundary.strictIsolation === false ? false : true;
  const rawGrants = [
    ...(Array.isArray(replayIndex.crossScopeGrants) ? replayIndex.crossScopeGrants : []),
    ...(Array.isArray(boundary.crossScopeGrants) ? boundary.crossScopeGrants : []),
    ...(Array.isArray(boundary.delegations) ? boundary.delegations : []),
    ...(Array.isArray(input.crossScopeGrants) ? input.crossScopeGrants : [])
  ];
  return {
    tenantId,
    workspaceId,
    strictIsolation,
    grants: rawGrants.map((grant, index) => normalizeBoundaryGrant(grant, index)),
    scopeIdIssues: [
      scopeIdIssue("replay-index-tenant", tenantId),
      scopeIdIssue("replay-index-workspace", workspaceId)
    ].filter(Boolean)
  };
}

function normalizeReplayRecordScope(record, id, scopeContext, now) {
  const metadata = asObject(record.metadata || record.context || record.scope);
  const tenantId = normalizeScopeId(
    record.tenantId || record.tenant || metadata.tenantId || metadata.tenant,
    scopeContext.tenantId
  );
  const workspaceId = normalizeScopeId(
    record.workspaceId || record.workspace || metadata.workspaceId || metadata.workspace,
    scopeContext.workspaceId
  );
  const sourceActorId = normalizeScopeId(record.actorId || record.actor || metadata.actorId || metadata.actor);
  const scopeIdIssues = [
    scopeIdIssue("replay-record-tenant", tenantId),
    scopeIdIssue("replay-record-workspace", workspaceId),
    scopeIdIssue("replay-record-actor", sourceActorId)
  ].filter(Boolean);
  const grant = tenantId !== scopeContext.tenantId || workspaceId !== scopeContext.workspaceId
    ? boundaryGrantCovers(scopeContext.grants, now, {
        tenantId,
        workspaceId,
        subject: `replay-record:${id}`
      })
    : null;
  const violations = [
    tenantId !== scopeContext.tenantId && !grant ? `tenant:${tenantId}` : null,
    workspaceId !== scopeContext.workspaceId && !grant ? `workspace:${workspaceId}` : null
  ].filter(Boolean);
  return {
    tenantId,
    workspaceId,
    sourceActorId,
    isolated: scopeIdIssues.length === 0 && (!scopeContext.strictIsolation || violations.length === 0),
    delegated: Boolean(grant),
    grantId: grant?.id || null,
    scopeIdIssues,
    violations,
    auditScope: stableDigest({
      tenantId,
      workspaceId,
      sourceActorId,
      replayRecordId: id,
      grantId: grant?.id || null
    })
  };
}

function normalizeReplayProofDigest(value) {
  if (typeof value !== "string" || !value.trim()) {
    return {
      value: null,
      algorithm: null,
      valid: false,
      format: "missing"
    };
  }

  const raw = value.trim().toLowerCase();
  const separatorIndex = raw.indexOf(":");
  const algorithm = separatorIndex > 0 ? raw.slice(0, separatorIndex) : "sha256";
  const digest = separatorIndex > 0 ? raw.slice(separatorIndex + 1) : raw;

  return {
    value: separatorIndex > 0 ? `${algorithm}:${digest}` : digest,
    algorithm,
    valid: REPLAY_PROOF_DIGEST_PATTERN.test(raw),
    format: separatorIndex > 0 ? "algorithm-prefixed-hex" : "sha256-hex"
  };
}

function replayProofInputRows(record, payloadDigest, rowDigest) {
  const rows = [];
  const explicitProofs = Array.isArray(record.proofs)
    ? record.proofs
    : Array.isArray(record.evidence)
      ? record.evidence
      : [];

  for (const [index, proof] of explicitProofs.entries()) {
    const source = typeof proof === "string" ? { digest: proof } : asObject(proof);
    const scopeValue = typeof source.scope === "string" && source.scope.trim()
      ? source.scope.trim().toLowerCase()
      : typeof source.kind === "string" && source.kind.trim()
        ? source.kind.trim().toLowerCase()
        : "record";
    rows.push({
      id: typeof source.id === "string" && source.id.trim() ? source.id.trim() : `proof-${index + 1}`,
      scope: REPLAY_PROOF_SCOPES.has(scopeValue) ? scopeValue : "record",
      digest: source.digest || source.sha256 || source.proofDigest || null,
      source: "explicit",
      required: source.required === true
    });
  }

  if (record.proofDigest || record.auditDigest || record.artifactDigest) {
    if (record.proofDigest) {
      rows.push({
        id: "record-proof",
        scope: "record",
        digest: record.proofDigest,
        source: "record.proofDigest",
        required: true
      });
    }
    if (record.auditDigest) {
      rows.push({
        id: "audit-proof",
        scope: "audit",
        digest: record.auditDigest,
        source: "record.auditDigest",
        required: false
      });
    }
    if (record.artifactDigest) {
      rows.push({
        id: "artifact-proof",
        scope: "artifact",
        digest: record.artifactDigest,
        source: "record.artifactDigest",
        required: false
      });
    }
  }

  rows.push({
    id: "derived-payload-proof",
    scope: "payload",
    digest: payloadDigest,
    source: "derived-payload-digest",
    required: false
  });
  rows.push({
    id: "derived-row-proof",
    scope: "record",
    digest: rowDigest,
    source: "derived-row-digest",
    required: false
  });

  return rows;
}

function buildReplayProofBinding(record, settings, payloadDigest, rowDigest) {
  const proofRows = replayProofInputRows(record, payloadDigest, rowDigest).map((proof, index) => {
    const digest = normalizeReplayProofDigest(proof.digest);
    const missingRequiredDigest = proof.required && !digest.value;
    const invalidDigest = digest.value && !digest.valid;

    return {
      ordinal: index + 1,
      id: proof.id,
      scope: proof.scope,
      source: proof.source,
      digest: digest.value,
      digestAlgorithm: digest.algorithm,
      digestValid: digest.value ? digest.valid : null,
      required: proof.required,
      weakReasons: [
        ...(missingRequiredDigest ? ["required-proof-digest-missing"] : []),
        ...(invalidDigest ? ["proof-digest-invalid"] : []),
        ...(proof.scope === "record" && proof.source !== "derived-row-digest" && digest.value !== rowDigest ? ["record-proof-digest-mismatch"] : [])
      ]
    };
  });
  const explicitRows = proofRows.filter((row) => row.source !== "derived-payload-digest" && row.source !== "derived-row-digest");
  const requiredRows = proofRows.filter((row) => row.required);
  const invalidRows = proofRows.filter((row) => row.weakReasons.includes("proof-digest-invalid"));
  const missingRequiredRows = proofRows.filter((row) => row.weakReasons.includes("required-proof-digest-missing"));
  const mismatchedRows = proofRows.filter((row) => row.weakReasons.includes("record-proof-digest-mismatch"));
  const strictMissingExplicitProof = settings.proofMode === "strict" && explicitRows.length === 0;
  const blockingReasons = [
    ...invalidRows.map((row) => `proof:${row.id}:invalid-digest`),
    ...missingRequiredRows.map((row) => `proof:${row.id}:missing-required-digest`),
    ...mismatchedRows.map((row) => `proof:${row.id}:record-digest-mismatch`),
    ...(strictMissingExplicitProof ? ["proof:strict-mode-explicit-proof-missing"] : [])
  ];
  const warningReasons = [
    ...(settings.proofMode === "summary" && explicitRows.length === 0 ? ["proof:explicit-proof-missing"] : []),
    ...(requiredRows.length === 0 ? ["proof:no-required-proof-marked"] : [])
  ];

  return {
    format: "hosted-kernel.replay-index.proof-binding.v1",
    mode: settings.proofMode,
    status: blockingReasons.length
      ? "blocked"
      : warningReasons.length
        ? "attention"
        : "ready",
    ready: blockingReasons.length === 0,
    explicitProofCount: explicitRows.length,
    derivedProofCount: proofRows.length - explicitRows.length,
    requiredProofCount: requiredRows.length,
    validDigestCount: proofRows.filter((row) => row.digest && row.digestValid === true).length,
    blockingReasons,
    warningReasons,
    rows: proofRows,
    digest: stableDigest({
      mode: settings.proofMode,
      payloadDigest,
      rowDigest,
      rows: proofRows.map((row) => ({
        id: row.id,
        scope: row.scope,
        digest: row.digest,
        weakReasons: row.weakReasons
      }))
    })
  };
}

function buildReplayScopeIsolation(records, scopeContext, settings) {
  const scopedRows = records.map((record) => ({
    replayRecordId: record.id,
    tenantId: record.scope.tenantId,
    workspaceId: record.scope.workspaceId,
    sourceActorId: record.scope.sourceActorId,
    state: record.scope.isolated ? "isolated" : "blocked",
    delegated: record.scope.delegated,
    grantId: record.scope.grantId,
    violations: record.scope.violations,
    scopeIdIssues: record.scope.scopeIdIssues,
    auditScope: record.scope.auditScope
  }));
  const blockedRows = scopedRows.filter((row) => row.state === "blocked");
  const delegatedRows = scopedRows.filter((row) => row.delegated);
  const tenantIds = [...new Set(scopedRows.map((row) => row.tenantId).filter(Boolean))].sort();
  const workspaceIds = [...new Set(scopedRows.map((row) => row.workspaceId).filter(Boolean))].sort();
  return {
    format: "hosted-kernel.replay-index.scope-isolation.v1",
    tenantId: scopeContext.tenantId,
    workspaceId: scopeContext.workspaceId,
    strictIsolation: scopeContext.strictIsolation,
    state: scopeContext.scopeIdIssues.length > 0 || blockedRows.length > 0 ? "blocked" : "ready",
    exportRef: `${settings.replayRoot}/audit/scope-isolation.json`,
    counts: {
      retainedRows: records.length,
      blockedRows: blockedRows.length,
      delegatedRows: delegatedRows.length,
      tenantCount: tenantIds.length,
      workspaceCount: workspaceIds.length
    },
    tenantIds,
    workspaceIds,
    scopeIdIssues: scopeContext.scopeIdIssues,
    blockedRows,
    delegatedRows,
    digest: stableDigest({
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      tenantId: scopeContext.tenantId,
      workspaceId: scopeContext.workspaceId,
      strictIsolation: scopeContext.strictIsolation,
      scopedRows
    })
  };
}

function normalizeReplayRecord(rawRecord, index, now, settings, scopeContext) {
  const record = asObject(rawRecord);
  const rawId = record.id || record.replayId || record.eventId || record.key;
  const id = typeof rawId === "string" && rawId.trim() ? rawId.trim() : `replay-${index + 1}`;
  const capturedAt = normalizeTimestamp(record.capturedAt || record.recordedAt || record.createdAt || record.timestamp) || now;
  const checkpoint = typeof record.checkpoint === "string" && record.checkpoint.trim()
    ? record.checkpoint.trim()
    : null;
  const watermark = typeof record.watermark === "string" && record.watermark.trim()
    ? record.watermark.trim()
    : null;
  const sequence = toPositiveInteger(record.sequence ?? record.seq ?? index + 1, index + 1);
  const sourcePath = typeof record.sourcePath === "string" && record.sourcePath.trim()
    ? record.sourcePath.trim()
    : typeof record.path === "string" && record.path.trim()
      ? record.path.trim()
      : `${settings.replayRoot}/${id}.json`;
  const operation = typeof record.operation === "string" && record.operation.trim()
    ? record.operation.trim()
    : typeof record.kind === "string" && record.kind.trim()
      ? record.kind.trim()
      : "replay";
  const subjects = replayRecordSubjectRefs(record);
  const bundles = replayRecordBundleRefs(record, id, settings);
  const scope = normalizeReplayRecordScope(record, id, scopeContext, now);
  const baseRecord = {
    id,
    sourcePath,
    operation,
    capturedAt,
    checkpoint,
    watermark,
    sequence,
    scope,
    subjects,
    bundles
  };
  const integrity = buildReplayRecordIntegrity(baseRecord, settings);
  const payloadDigest = typeof record.payloadDigest === "string" && record.payloadDigest.trim()
    ? record.payloadDigest.trim()
    : stableDigest({
        id,
        capturedAt,
        checkpoint,
        watermark,
        sequence,
        sourcePath,
        operation,
        scope,
        subjects,
        bundles,
        payload: record.payload || record.body || null
      });
  const invalidReasons = [];
  for (const reason of integrity.blockingReasons) invalidReasons.push(reason);
  for (const issue of scope.scopeIdIssues) invalidReasons.push(issue);
  if (scopeContext.strictIsolation) {
    for (const violation of scope.violations) invalidReasons.push(`record-scope-violation:${violation}`);
  }
  for (const subject of subjects) {
    const issue = scopeIdIssue(`subject:${subject.kind}`, subject.id);
    if (issue) invalidReasons.push(issue);
  }
  for (const bundle of bundles) {
    if (!bundle.ready) invalidReasons.push(`${bundle.kind}-bundle-not-ready`);
  }
  const normalizedInvalidReasons = [...new Set(invalidReasons)].sort();
  return {
    id,
    sourcePath,
    operation,
    capturedAt,
    checkpoint,
    watermark,
    sequence,
    scope,
    subjects,
    bundles,
    integrity,
    payloadDigest,
    rowDigest: stableDigest({
      id,
      sourcePath,
      operation,
      capturedAt,
      checkpoint,
      watermark,
      sequence,
      scope,
      subjects,
      bundles,
      payloadDigest
    }),
    valid: normalizedInvalidReasons.length === 0,
    invalidReasons: normalizedInvalidReasons
  };
}

function replayRecordInputs(input) {
  const replayIndex = asObject(input.replayIndex || input.index);
  if (Array.isArray(input.replayRecords)) return input.replayRecords;
  if (Array.isArray(input.records)) return input.records;
  if (Array.isArray(replayIndex.records)) return replayIndex.records;
  if (Array.isArray(replayIndex.entries)) return replayIndex.entries;
  return [];
}

function buildReplayIndexManifest(now, input, settings, lifecycle, persistedState) {
  const scopeContext = normalizeReplayScopeContext(input);
  const records = replayRecordInputs(input)
    .map((record, index) => normalizeReplayRecord(record, index, now, settings, scopeContext))
    .sort((left, right) => left.sequence - right.sequence || new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime());
  const cutoffTime = new Date(now).getTime() - settings.retentionDays * 24 * 60 * 60000;
  const retainedByAge = records.filter((record) => new Date(record.capturedAt).getTime() >= cutoffTime);
  const retained = retainedByAge.slice(-settings.maxEntries);
  const droppedForRetention = records.length - retained.length;
  const duplicateKeys = new Set();
  const seenKeys = new Set();
  for (const record of retained) {
    const key = `${record.id}:${record.sequence}`;
    if (seenKeys.has(key)) duplicateKeys.add(key);
    seenKeys.add(key);
  }
  const conflictRows = buildReplayConflictRows(retained);
  const conflictKeys = conflictRows.map((row) => `${row.kind}:${row.key}`);
  const conflictRecordIds = [...new Set(conflictRows.flatMap((row) => row.replayRecordIds))].sort();
  const artifactIdentities = retained.map((record) => ({
    replayRecordId: record.id,
    sequence: record.sequence,
    sourcePath: record.sourcePath,
    ...replayArtifactIdentity(record)
  }));
  const invalidRows = retained.filter((record) => !record.valid);
  const latest = retained[retained.length - 1] || null;
  const rowDigests = retained.map((record) => record.rowDigest);
  const entityIndex = buildReplayEntityIndex(retained);
  const lookupRecords = buildReplayLookupRecords(retained, entityIndex, settings);
  const subjectCoverage = buildReplaySubjectCoverage(lookupRecords, settings);
  const subjectBundlePreview = buildReplaySubjectBundlePreview(lookupRecords, retained, conflictRows, settings);
  const persistenceBinding = buildReplayPersistenceBinding(now, retained, lookupRecords, persistedState, settings);
  const scopeIsolation = buildReplayScopeIsolation(retained, scopeContext, settings);
  const bundleRows = retained.flatMap((record) => record.bundles.map((bundle) => ({
    replayRecordId: record.id,
    kind: bundle.kind,
    id: bundle.id,
    ref: bundle.ref,
    digest: bundle.digest,
    ready: bundle.ready,
    present: bundle.present,
    source: bundle.source,
    canonicalKey: bundle.canonicalKey
  })));
  const unmappedRecords = retained.filter((record) => record.subjects.length === 0).map((record) => record.id);
  const lookupRowsByKind = lookupRecords.reduce((counts, row) => {
    counts[row.subject.kind] = (counts[row.subject.kind] || 0) + 1;
    return counts;
  }, { job: 0, process: 0, claim: 0 });
  const incompleteLookupRecords = lookupRecords
    .filter((row) => !row.complete)
    .map((row) => row.lookupKey);
  const derivedBundleRows = bundleRows.filter((bundle) => bundle.source === "derived-default");
  const rowIntegrityRows = retained.map((record) => record.integrity);
  const rowIntegrity = {
    format: "hosted-kernel.replay-index.row-integrity-summary.v1",
    exportRef: `${settings.replayRoot}/audit/row-integrity.json`,
    state: rowIntegrityRows.some((row) => row.state === "blocked")
      ? "blocked"
      : rowIntegrityRows.some((row) => row.state === "attention")
        ? "attention"
        : "ready",
    counts: {
      retainedRows: rowIntegrityRows.length,
      readyRows: rowIntegrityRows.filter((row) => row.state === "ready").length,
      attentionRows: rowIntegrityRows.filter((row) => row.state === "attention").length,
      blockedRows: rowIntegrityRows.filter((row) => row.state === "blocked").length,
      cursorBoundRows: rowIntegrityRows.filter((row) => row.cursorBound).length,
      derivedDefaultBundleRows: derivedBundleRows.length
    },
    blockedRows: rowIntegrityRows
      .filter((row) => row.state === "blocked")
      .map((row) => ({
        replayRecordId: row.replayRecordId,
        blockingReasons: row.blockingReasons,
        missingBundleKinds: row.missingBundleKinds,
        missingReadyBundleKinds: row.missingReadyBundleKinds
      })),
    attentionRows: rowIntegrityRows
      .filter((row) => row.state === "attention")
      .map((row) => ({
        replayRecordId: row.replayRecordId,
        warningReasons: row.warningReasons,
        duplicateSubjectKeys: row.duplicateSubjectKeys
      })),
    rows: rowIntegrityRows,
    digest: stableDigest({
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      rows: rowIntegrityRows.map((row) => ({
        replayRecordId: row.replayRecordId,
        state: row.state,
        blockingReasons: row.blockingReasons,
        warningReasons: row.warningReasons,
        digest: row.digest
      }))
    })
  };
  return {
    format: "hosted-kernel.replay-index.manifest.v1",
    generatedAt: now,
    routeName: settings.routeName,
    replayRoot: settings.replayRoot,
    state: !lifecycle.enabled
      ? "held"
      : invalidRows.length > 0 || duplicateKeys.size > 0 || conflictRows.length > 0 || scopeIsolation.state === "blocked"
        ? "invalid"
        : retained.length > 0
          ? "indexed"
          : "empty",
    recordsBound: records.length > 0,
    totalRecords: records.length,
    retainedRecords: retained.length,
    droppedForRetention,
    maxEntries: settings.maxEntries,
    retentionDays: settings.retentionDays,
    mappedSubjects: entityIndex.length,
    lookupRecordCount: lookupRecords.length,
    lookupRowsByKind,
    scopeIsolation,
    rowIntegrity,
    subjectCoverage,
    subjectBundlePreview,
    persistenceBinding,
    unmappedRecords,
    bundleCoverage: {
      auditBundles: bundleRows.filter((bundle) => bundle.kind === "audit").length,
      artifactBundles: bundleRows.filter((bundle) => bundle.kind === "artifact").length,
      explicitBundles: bundleRows.filter((bundle) => bundle.present).length,
      derivedDefaultBundles: derivedBundleRows.length,
      missingReadyBundles: bundleRows.filter((bundle) => !bundle.ready).map((bundle) => bundle.id),
      incompleteLookupRecords
    },
    lookupContract: {
      format: "hosted-kernel.replay-index.lookup-contract.v1",
      keyFormat: "job:<id> | process:<id> | claim:<id>",
      recordFormat: "hosted-kernel.replay-index.lookup-record.v1",
      rows: lookupRecords.length,
      exportRoot: `${settings.replayRoot}/lookups`,
      requiredBundleKinds: ["audit", "artifact"],
      complete: incompleteLookupRecords.length === 0,
      digest: stableDigest({
        routeName: settings.routeName,
        rows: lookupRecords.map((row) => ({
          lookupKey: row.lookupKey,
          digest: row.digest,
          complete: row.complete,
          recordCount: row.recordCount
        }))
      })
    },
    duplicateKeys: [...duplicateKeys],
    conflictKeys,
    conflictRows,
    conflictRecordIds,
    invalidRows: invalidRows.map((record) => ({
      id: record.id,
      sequence: record.sequence,
      sourcePath: record.sourcePath,
      reasons: record.invalidReasons
    })),
    cursor: {
      checkpoint: latest?.checkpoint || persistedState.cursor.checkpoint,
      watermark: latest?.watermark || persistedState.cursor.watermark,
      sequence: latest?.sequence || persistedState.cursor.sequence
    },
    rows: retained.map((record) => ({
      id: record.id,
      sourcePath: record.sourcePath,
      operation: record.operation,
      capturedAt: record.capturedAt,
      checkpoint: record.checkpoint,
      watermark: record.watermark,
      sequence: record.sequence,
      scope: record.scope,
      artifactIdentity: replayArtifactIdentity(record),
      subjects: record.subjects,
      bundles: record.bundles,
      payloadDigest: record.payloadDigest,
      integrity: record.integrity,
      rowDigest: record.rowDigest
    })),
    artifactIdentities,
    entityIndex,
    lookupRecords,
    subjectCoverage,
    bundleRows,
    exportRef: `${settings.replayRoot}/replay-index.manifest.json`,
    repairPlan: {
      required: invalidRows.length > 0 || duplicateKeys.size > 0 || conflictRows.length > 0 || scopeIsolation.state === "blocked",
      actions: [
        ...rowIntegrity.blockedRows.map((row) => ({
          id: `repair-row-integrity:${row.replayRecordId}`,
          kind: "repair-row-integrity",
          replayRecordId: row.replayRecordId,
          reasons: row.blockingReasons,
          missingBundleKinds: row.missingBundleKinds,
          missingReadyBundleKinds: row.missingReadyBundleKinds
        })),
        ...scopeIsolation.scopeIdIssues.map((issue) => ({
          id: `repair-replay-scope:${issue}`,
          kind: "repair-replay-scope",
          reason: issue,
          tenantId: scopeIsolation.tenantId,
          workspaceId: scopeIsolation.workspaceId
        })),
        ...scopeIsolation.blockedRows.map((row) => ({
          id: `repair-replay-record-scope:${row.replayRecordId}`,
          kind: "repair-replay-record-scope",
          replayRecordId: row.replayRecordId,
          tenantId: row.tenantId,
          workspaceId: row.workspaceId,
          violations: row.violations,
          scopeIdIssues: row.scopeIdIssues
        })),
        ...invalidRows.map((record) => ({
          id: `repair-invalid-row:${record.id}`,
          kind: "repair-invalid-row",
          replayRecordId: record.id,
          reasons: record.invalidReasons
        })),
        ...[...duplicateKeys].map((key) => ({
          id: `repair-duplicate-key:${key}`,
          kind: "repair-duplicate-key",
          key
        })),
        ...conflictRows.map((row) => ({
          id: `repair-conflict:${row.kind}:${row.key}`,
          kind: row.repairAction,
          key: row.key,
          replayRecordIds: row.replayRecordIds
        }))
      ]
    },
    proofDigest: stableDigest({
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      rowDigests,
      artifactIdentities,
      conflictRows,
      scopeIsolation,
      rowIntegrity,
      entityIndex,
      lookupRecords,
      subjectCoverage,
      subjectBundlePreview,
      persistenceBinding,
      bundleRows
    }),
    manifestDigest: stableDigest({
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      retainedRecords: retained.length,
      droppedForRetention,
      duplicateKeys: [...duplicateKeys],
      conflictRows,
      scopeIsolation,
      rowIntegrity,
      invalidRows: invalidRows.map((record) => record.rowDigest),
      artifactIdentities,
      entityIndex,
      lookupRecords,
      subjectCoverage,
      subjectBundlePreview,
      persistenceBinding,
      bundleRows,
      rowDigests
    })
  };
}

function buildHandoffPublicationPlan(
  now,
  settings,
  handoffProviders,
  lifecycle,
  capabilityNegotiation,
  serviceContract,
  sync,
  clientRequest,
  accessBoundary,
  blockingReasons
) {
  const handoffOperation = serviceContract.operations.find((operation) => operation.id === "handoff-publish") || null;
  const handoffRequested = clientRequest.publishRequested
    || capabilityNegotiation.optional.includes("handoff.publish")
    || handoffOperation?.required === true;
  const operationAssignedProviderId = handoffOperation?.providerId || null;
  const readyToCommit = blockingReasons.length === 0
    && lifecycle.enabled
    && sync.state === "syncable"
    && accessBoundary.state === "ready";
  const targets = handoffProviders.map((provider, index) => {
    const operationAssigned = !operationAssignedProviderId || provider.id === operationAssignedProviderId;
    const handoffGate = evaluateProviderHandoffGate(provider, now);
    const targetState = !handoffRequested
      ? "standby"
      : handoffGate.state !== "ready"
        ? "blocked"
        : readyToCommit && operationAssigned
          ? "ready"
          : operationAssigned
            ? "blocked"
            : "standby";
    const payloadDigest = stableDigest({
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      providerId: provider.id,
      handoffRef: provider.handoffRef,
      cursor: sync.cursor,
      checkpointDigest: sync.checkpointDigest,
      clientPacketDigest: clientRequest.handoffPacket.digest,
      boundaryScope: accessBoundary.auditScope,
      serviceContractDigest: serviceContract.digest,
      providerHandoffLease: {
        deliveryMode: handoffGate.deliveryMode,
        leaseToken: handoffGate.leaseToken,
        leaseState: handoffGate.leaseState,
        leaseExpiresAt: handoffGate.leaseExpiresAt,
        expectedCursorDigest: handoffGate.expectedCursorDigest,
        externalRevision: handoffGate.externalRevision
      }
    });
    return {
      id: `handoff-target-${index + 1}`,
      providerId: provider.id,
      type: provider.type,
      routeName: provider.routeName || settings.routeName,
      handoffRef: provider.handoffRef,
      operationAssigned,
      handoffGate,
      state: targetState,
      cursor: {
        checkpoint: sync.cursor.checkpoint,
        watermark: sync.cursor.watermark,
        sequence: sync.cursor.sequence
      },
      externalRevision: sync.externalRevision,
      providerExternalRevision: provider.handoffContract.externalRevision,
      ackToken: clientRequest.handoffPacket.ackToken,
      payloadContract: {
        format: "hosted-kernel.replay-index.external-handoff-payload.v1",
        contentType: "application/json",
        requiredFields: [
          "routeName",
          "replayRoot",
          "cursor",
          "checkpointDigest",
          "manifestDigest",
          "serviceContractDigest",
          "clientHandoffPacketDigest",
          "boundaryAuditScope",
          "providerHandoffLease"
        ],
        payloadDigest
      },
      delivery: {
        mode: handoffGate.deliveryMode,
        requiresProviderAck: handoffGate.requireAck,
        expectedCursorDigest: handoffGate.expectedCursorDigest,
        leaseState: handoffGate.leaseState,
        leaseExpiresAt: handoffGate.leaseExpiresAt
      },
      commitFence: stableDigest({
        providerId: provider.id,
        handoffRef: provider.handoffRef,
        checkpointDigest: sync.checkpointDigest,
        payloadDigest,
        ackToken: clientRequest.handoffPacket.ackToken,
        leaseToken: handoffGate.leaseToken,
        leaseState: handoffGate.leaseState
      })
    };
  });
  const assignedTargets = operationAssignedProviderId
    ? targets.filter((target) => target.providerId === operationAssignedProviderId)
    : targets;
  const publishableTargets = assignedTargets.filter((target) => target.state === "ready");
  return {
    format: "hosted-kernel.replay-index.external-handoff-plan.v1",
    requested: handoffRequested,
    operationId: handoffOperation?.id || null,
    operationState: handoffOperation?.state || "optional-missing",
    assignedProviderId: operationAssignedProviderId,
    mode: settings.proofMode === "strict" ? "proof-gated" : "summary-gated",
    state: !handoffRequested
      ? "standby"
      : publishableTargets.length > 0
        ? "ready"
        : "blocked",
    targetCount: targets.length,
    publishableTargetCount: publishableTargets.length,
    targetRefs: targets,
    blockingReasons,
    commitSet: publishableTargets.map((target) => ({
      providerId: target.providerId,
      handoffRef: target.handoffRef,
      commitFence: target.commitFence,
      payloadDigest: target.payloadContract.payloadDigest,
      deliveryMode: target.delivery.mode,
      leaseState: target.delivery.leaseState,
      providerExternalRevision: target.providerExternalRevision
    })),
    receipt: {
      routeName: settings.routeName,
      replayRoot: settings.replayRoot,
      checkpointDigest: sync.checkpointDigest,
      serviceContractDigest: serviceContract.digest,
      clientHandoffPacketDigest: clientRequest.handoffPacket.digest,
      boundaryAuditScope: accessBoundary.auditScope
    },
    digest: stableDigest({
      handoffRequested,
      operationState: handoffOperation?.state || null,
      operationAssignedProviderId,
      targets: targets.map((target) => ({
        providerId: target.providerId,
        state: target.state,
        handoffRef: target.handoffRef,
        handoffGate: target.handoffGate,
        commitFence: target.commitFence
      })),
      blockingReasons
    })
  };
}

function buildExternalHandoff(now, settings, providers, lifecycle, capabilityNegotiation, serviceContract, sync, clientRequest, accessBoundary) {
  const handoffProviders = providers.filter((provider) => provider.handoffRef);
  const handoffOperation = serviceContract.operations.find((operation) => operation.id === "handoff-publish") || null;
  const handoffRequested = clientRequest.publishRequested
    || capabilityNegotiation.optional.includes("handoff.publish")
    || handoffOperation?.required === true;
  const blockingReasons = [
    ...capabilityNegotiation.missingRequired.map((capability) => `missing:${capability}`)
  ];
  if (handoffRequested && handoffProviders.length === 0) blockingReasons.push("handoff-target:missing");
  if (handoffRequested && handoffOperation?.state === "blocked") {
    blockingReasons.push("handoff-operation:unassigned");
  }
  for (const provider of handoffProviders) {
    const handoffGate = evaluateProviderHandoffGate(provider, now);
    for (const blocker of handoffGate.blockers) {
      blockingReasons.push(`provider:${provider.id}:${blocker}`);
    }
  }
  if (!lifecycle.enabled) blockingReasons.push(`lifecycle:${lifecycle.status}`);
  if (serviceContract.state === "blocked") blockingReasons.push(`service-contract:${serviceContract.blockedOperations.join(",")}`);
  if (sync.state !== "syncable") blockingReasons.push(`sync:${sync.state}`);
  if (!clientRequest.routeMatches) blockingReasons.push(`client-route:${clientRequest.routeName}`);
  if (clientRequest.stale) blockingReasons.push("client-state:stale");
  if (clientRequest.publishRequested && !clientRequest.handoffAcknowledged) {
    blockingReasons.push("client-handoff:ack-required");
  }
  if (clientRequest.publishRequested && !clientRequest.workflowVisible) {
    blockingReasons.push("client-workflow:hidden");
  }
  if (clientRequest.workflowState === "blocked") {
    blockingReasons.push(`client-workflow:blocked:${clientRequest.blockedStepIds.join(",")}`);
  }
  if (clientRequest.recordHandoffQueue.state === "blocked") {
    blockingReasons.push(`client-record-handoff:blocked:${clientRequest.recordHandoffQueue.activeLookupKey || "unknown"}`);
  }
  if (clientRequest.publishRequested && clientRequest.recordHandoffQueue.state === "needs-confirmation") {
    blockingReasons.push(`client-record-handoff:confirm:${clientRequest.recordHandoffQueue.activeLookupKey || "unknown"}`);
  }
  if (clientRequest.publishRequested && !clientRequest.workflowComplete) {
    blockingReasons.push(`client-workflow:incomplete:${clientRequest.incompleteRequiredStepIds.join(",")}`);
  }
  if (accessBoundary.state !== "ready") {
    blockingReasons.push(`access-boundary:${accessBoundary.state}`);
  }
  for (const permission of accessBoundary.missingPermissions) {
    blockingReasons.push(`permission:${permission}:missing`);
  }
  for (const violation of accessBoundary.scopeViolations) {
    blockingReasons.push(`scope:${violation}`);
  }
  for (const issue of accessBoundary.scopeIdIssues) {
    blockingReasons.push(`scope-id:${issue}`);
  }
  for (const grantId of accessBoundary.expiredGrantIds) {
    blockingReasons.push(`cross-scope-grant:${grantId}:expired`);
  }
  for (const grantId of accessBoundary.invalidGrantIds) {
    blockingReasons.push(`cross-scope-grant:${grantId}:invalid`);
  }
  const publicationPlan = buildHandoffPublicationPlan(
    now,
    settings,
    handoffProviders,
    lifecycle,
    capabilityNegotiation,
    serviceContract,
    sync,
    clientRequest,
    accessBoundary,
    blockingReasons
  );
  return {
    state: publicationPlan.state === "ready" ? "ready" : blockingReasons.length === 0 ? publicationPlan.state : "blocked",
    routeName: settings.routeName,
    replayRoot: settings.replayRoot,
    boundary: {
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      actorId: accessBoundary.actorId,
      state: accessBoundary.state,
      auditScope: accessBoundary.auditScope,
      delegatedScopes: accessBoundary.delegatedScopes,
      boundaryIssues: accessBoundary.boundaryIssues
    },
    client: {
      requestId: clientRequest.requestId,
      clientId: clientRequest.clientId,
      intent: clientRequest.intent,
      publishRequested: clientRequest.publishRequested,
      acknowledged: clientRequest.handoffAcknowledged,
      nextClientAction: clientRequest.nextClientAction,
      workflowState: clientRequest.workflowState,
      activeStepId: clientRequest.activeStepId,
      handoffPacketDigest: clientRequest.handoffPacket.digest
    },
    targetRefs: publicationPlan.targetRefs,
    blockingReasons,
    publicationPlan,
    publish: {
      shouldPublish: publicationPlan.state === "ready",
      mode: settings.proofMode === "strict" ? "proof-gated" : "summary-gated",
      requiredCapabilities: capabilityNegotiation.required,
      requiredOperations: serviceContract.operations
        .filter((operation) => operation.required)
        .map((operation) => operation.id),
      serviceContractDigest: serviceContract.digest,
      requiresClientAck: clientRequest.publishRequested && !clientRequest.handoffAcknowledged,
      targetCount: publicationPlan.targetCount,
      publishableTargetCount: publicationPlan.publishableTargetCount,
      commitSet: publicationPlan.commitSet,
      publicationDigest: publicationPlan.digest
    }
  };
}

function buildLifecycle(settings, command, validationErrors, lifecycleControls) {
  const commandDecision = buildLifecycleCommandDecision(settings, command, validationErrors, lifecycleControls);
  const explicitDisable = command === "disable";
  const explicitEnable = command === "enable" || command === "resume";
  const enabled = explicitDisable ? false : explicitEnable ? true : lifecycleControls.effectiveEnabled;
  const blocked = validationErrors.length > 0;
  const paused = lifecycleControls.paused || command === "pause";
  const rebuildRequested = command === "rebuild";
  const compactRequested = command === "compact";
  return {
    format: "hosted-kernel.replay-index.lifecycle.v1",
    command,
    enabled: blocked ? false : enabled && !paused,
    requestedEnabled: settings.enabled,
    status: blocked ? "blocked" : paused ? "paused" : enabled ? "active" : "disabled",
    commandDecision,
    controls: {
      format: lifecycleControls.format,
      bound: lifecycleControls.bound,
      observedState: lifecycleControls.observedState,
      state: lifecycleControls.state,
      effectiveEnabled: lifecycleControls.effectiveEnabled,
      settingsEnabled: lifecycleControls.settingsEnabled,
      enabledOverride: lifecycleControls.enabledOverride,
      disabledByControl: lifecycleControls.disabledByControl,
      paused: lifecycleControls.paused,
      pausedUntil: lifecycleControls.pausedUntil,
      holdReason: lifecycleControls.holdReason,
      lockedCommands: lifecycleControls.lockedCommands,
      allowCommands: lifecycleControls.allowCommands,
      requestedBy: lifecycleControls.requestedBy,
      stateToken: lifecycleControls.stateToken,
      validationErrors: lifecycleControls.validationErrors,
      digest: lifecycleControls.digest,
      canEnable: blocked ? false : !enabled || paused,
      canDisable: enabled && !blocked,
      canPause: enabled && !paused && !blocked,
      canResume: paused && !blocked,
      canRebuild: enabled && !blocked,
      canCompact: enabled && !blocked
    },
    operations: {
      rebuildRequested,
      compactRequested,
      shouldRefreshIndex: enabled && !blocked && commandDecision.applied
        && (rebuildRequested || compactRequested || command === "resume" || command === "enable"),
      shouldWriteProof: !blocked && settings.proofMode === "strict"
    },
    transition: {
      from: lifecycleControls.state,
      to: blocked ? "blocked" : paused ? "paused" : enabled ? "active" : "disabled",
      commandApplied: commandDecision.applied,
      stateToken: lifecycleControls.stateToken,
      controlDigest: lifecycleControls.digest,
      reason: commandDecision.rejected
        ? commandDecision.rejectionReason
        : paused
          ? lifecycleControls.holdReason || "operator-hold"
          : explicitDisable
            ? "disable-command"
            : explicitEnable
              ? "enable-command"
              : "state-preserved"
    }
  };
}

function buildRouteDecisionContract(routePayload, cards, actionContract, validationBadges, readiness, acceptance, nextSteps) {
  const visibleCards = cards.map((card, index) => ({
    id: card.id,
    order: index + 1,
    label: card.label,
    value: card.value,
    state: card.state,
    tone: previewToneForState(card.state),
    blocking: validationBadges.blockedFields.includes(card.id)
      || acceptance.blockers.some((blocker) => blocker.includes(card.id)),
    detailDigest: stableDigest({ id: card.id, detail: card.detail })
  }));
  const gateRows = readiness.checks.map((check, index) => {
    const badge = validationBadges.badges.find((candidate) => candidate.field === check.id);
    return {
      id: check.id,
      order: index + 1,
      label: check.label,
      state: check.state,
      tone: previewToneForState(check.state),
      fieldState: badge?.state || check.state,
      blocking: check.state === "blocked" || badge?.blocking === true,
      message: badge?.message || `${check.id}:${check.state}`
    };
  });
  const nextStepRows = nextSteps.slice(0, 8).map((step, index) => ({
    id: step.id,
    order: index + 1,
    priority: step.priority,
    routeHint: step.routeHint,
    action: step.action,
    reason: step.reason,
    enabled: index === 0 && acceptance.status !== "accepted",
    resolvesGateIds: gateRows
      .filter((gate) => gate.blocking && (step.reason.includes(gate.id) || step.routeHint === gate.id))
      .map((gate) => gate.id)
  }));
  const clientCommands = [
    actionContract.primary,
    ...actionContract.secondary
  ].filter((action, index, actions) => (
    action && actions.findIndex((candidate) => candidate.id === action.id) === index
  )).map((action) => ({
    id: action.id,
    label: action.label,
    routeHint: action.routeHint,
    enabled: action.enabled,
    tone: action.tone,
    reason: action.reason,
    dueAt: action.dueAt || null
  }));
  return {
    format: "hosted-kernel.replay-index.route-decision.v1",
    routeName: routePayload.routeName,
    status: routePayload.status,
    accepted: acceptance.accepted,
    canPublish: routePayload.canPublish,
    readiness: {
      state: routePayload.readinessState,
      score: routePayload.readinessScore,
      readyCount: readiness.readyCount,
      totalCount: readiness.totalCount,
      publishable: readiness.publishable,
      proofGate: readiness.proofGate
    },
    acceptance: {
      status: acceptance.status,
      summary: acceptance.summary,
      blockerCount: acceptance.blockers.length,
      warningCount: acceptance.warnings.length,
      firstBlocker: acceptance.blockers[0] || null
    },
    validation: {
      status: routePayload.validationStatus,
      errorCount: validationBadges.errorCount,
      warningCount: validationBadges.warningCount,
      blockedFields: validationBadges.blockedFields,
      attentionFields: validationBadges.attentionFields
    },
    visibleCards,
    gateRows,
    nextStepRows,
    clientCommands,
    clientTransition: actionContract.clientTransition,
    routeDigest: stableDigest({
      routePayload,
      gates: gateRows.map((gate) => ({ id: gate.id, state: gate.state, blocking: gate.blocking })),
      steps: nextStepRows.map((step) => ({ id: step.id, priority: step.priority, routeHint: step.routeHint })),
      commands: clientCommands.map((command) => ({ id: command.id, enabled: command.enabled }))
    })
  };
}

function minutesForCadence(settings) {
  if (settings.cadence === "manual") return null;
  if (settings.cadence === "hourly") return settings.intervalMinutes;
  if (settings.cadence === "daily") return 24 * 60;
  return 7 * 24 * 60;
}

function normalizeSchedulePolicy(input, now) {
  const schedule = asObject(input.schedule || input.scheduler || asObject(input.settings).schedule);
  const holdReason = typeof schedule.holdReason === "string"
    ? schedule.holdReason.trim().toLowerCase()
    : null;
  const runMode = typeof schedule.runMode === "string"
    ? schedule.runMode.trim().toLowerCase()
    : null;
  const minRunSpacingMinutes = toPositiveInteger(schedule.minRunSpacingMinutes, 0);
  const windowStartsAt = normalizeTimestamp(schedule.windowStartsAt || schedule.runWindowStart);
  const windowEndsAt = normalizeTimestamp(schedule.windowEndsAt || schedule.runWindowEnd);
  const manualApproval = asObject(schedule.manualApproval || schedule.approval);
  const manualApprovalState = typeof manualApproval.state === "string"
    ? manualApproval.state.trim().toLowerCase()
    : null;
  const approvedAt = normalizeTimestamp(manualApproval.approvedAt || manualApproval.grantedAt);
  const expiresAt = normalizeTimestamp(manualApproval.expiresAt || manualApproval.validUntil);
  const validationErrors = [];
  if (holdReason && !SCHEDULE_HOLD_REASONS.has(holdReason)) {
    validationErrors.push(`schedule.holdReason:${holdReason}:unsupported`);
  }
  if (runMode && !SCHEDULE_RUN_MODES.has(runMode)) {
    validationErrors.push(`schedule.runMode:${runMode}:unsupported`);
  }
  if (schedule.maxCatchUpRuns !== undefined && toPositiveInteger(schedule.maxCatchUpRuns, 0) === 0) {
    validationErrors.push("schedule.maxCatchUpRuns must be a positive integer");
  }
  if (schedule.minRunSpacingMinutes !== undefined && minRunSpacingMinutes === 0) {
    validationErrors.push("schedule.minRunSpacingMinutes must be a positive integer");
  }
  if (windowStartsAt && windowEndsAt && new Date(windowStartsAt).getTime() >= new Date(windowEndsAt).getTime()) {
    validationErrors.push("schedule run window start must be before window end");
  }
  if (manualApprovalState && !["approved", "pending", "rejected"].includes(manualApprovalState)) {
    validationErrors.push(`schedule.manualApproval.state:${manualApprovalState}:unsupported`);
  }
  return {
    format: "hosted-kernel.replay-index.schedule-policy.v1",
    bound: Object.keys(schedule).length > 0,
    forceRun: schedule.forceRun === true,
    hold: schedule.hold === true,
    holdReason: SCHEDULE_HOLD_REASONS.has(holdReason) ? holdReason : schedule.hold === true ? "operator-hold" : null,
    runMode: SCHEDULE_RUN_MODES.has(runMode) ? runMode : "normal",
    lastRunAt: normalizeTimestamp(schedule.lastRunAt || schedule.lastIndexedAt),
    nextRunAt: normalizeTimestamp(schedule.nextRunAt || schedule.dueAt),
    pausedUntil: normalizeTimestamp(schedule.pausedUntil || schedule.holdUntil),
    maxCatchUpRuns: Math.min(toPositiveInteger(schedule.maxCatchUpRuns, 1), 24),
    minRunSpacingMinutes: Math.min(minRunSpacingMinutes, 24 * 60),
    windowStartsAt,
    windowEndsAt,
    manualApproval: {
      required: schedule.manualApprovalRequired === true || runMode === "manual-approval" || manualApproval.required === true,
      state: ["approved", "pending", "rejected"].includes(manualApprovalState) ? manualApprovalState : "pending",
      approvedBy: typeof manualApproval.approvedBy === "string" && manualApproval.approvedBy.trim()
        ? manualApproval.approvedBy.trim()
        : null,
      approvedAt,
      expiresAt,
      valid: Boolean(
        ["approved"].includes(manualApprovalState)
        && approvedAt
        && (!expiresAt || new Date(expiresAt).getTime() > new Date(now).getTime())
      )
    },
    ownerRoute: typeof schedule.ownerRoute === "string" && schedule.ownerRoute.trim()
      ? schedule.ownerRoute.trim()
      : null,
    validationErrors
  };
}

function addMinutes(timestamp, minutes) {
  return new Date(new Date(timestamp).getTime() + minutes * 60000).toISOString();
}

function latestTimestamp(...timestamps) {
  const valid = timestamps
    .filter(Boolean)
    .map((timestamp) => normalizeTimestamp(timestamp))
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  return valid[0] || null;
}

function buildScheduleControls(now, input, settings, lifecycle, persistedState) {
  const policy = normalizeSchedulePolicy(input, now);
  const cadenceMinutes = minutesForCadence(settings);
  const calculatedDueAt = cadenceMinutes === null
    ? null
    : policy.lastRunAt
      ? addMinutes(policy.lastRunAt, cadenceMinutes)
      : addMinutes(now, cadenceMinutes);
  const dueAt = policy.forceRun
    ? now
    : policy.nextRunAt || calculatedDueAt;
  const holdUntil = latestTimestamp(policy.pausedUntil, lifecycle.controls.pausedUntil);
  const windowClosed = Boolean(policy.windowEndsAt && new Date(policy.windowEndsAt).getTime() <= new Date(now).getTime());
  const windowPending = Boolean(policy.windowStartsAt && new Date(policy.windowStartsAt).getTime() > new Date(now).getTime());
  const withinRunWindow = !windowClosed && !windowPending;
  const debounceUntil = policy.minRunSpacingMinutes > 0 && policy.lastRunAt
    ? addMinutes(policy.lastRunAt, policy.minRunSpacingMinutes)
    : null;
  const debounceActive = Boolean(debounceUntil && new Date(debounceUntil).getTime() > new Date(now).getTime());
  const approvalExpired = policy.manualApproval.required
    && policy.manualApproval.expiresAt
    && new Date(policy.manualApproval.expiresAt).getTime() <= new Date(now).getTime();
  const manualApprovalBlocked = policy.manualApproval.required
    && !policy.manualApproval.valid;
  const lifecycleHoldActive = lifecycle.controls.paused
    && lifecycle.status === "paused"
    && lifecycle.controls.holdReason !== "settings-invalid";
  const holdActive = policy.hold
    || lifecycleHoldActive
    || (holdUntil && new Date(holdUntil).getTime() > new Date(now).getTime());
  const due = Boolean(dueAt && new Date(dueAt).getTime() <= new Date(now).getTime());
  const routeOwned = !policy.ownerRoute || policy.ownerRoute === settings.routeName;
  const blockedByPersistence = persistedState.recovery.required || persistedState.status === "blocked";
  const lifecycleReady = lifecycle.enabled && lifecycle.status === "active";
  const manual = settings.cadence === "manual";
  const policyInvalid = policy.validationErrors.length > 0;
  const blockedByWindow = windowClosed || windowPending;
  const blockedByControls = policyInvalid || debounceActive || manualApprovalBlocked || blockedByWindow;
  const state = policyInvalid
    ? "policy-invalid"
    : !routeOwned
      ? "route-mismatch"
      : blockedByPersistence
        ? "recovery-held"
        : !lifecycleReady
          ? lifecycle.status
          : manualApprovalBlocked
            ? "approval-held"
            : debounceActive
              ? "debounce-held"
              : blockedByWindow
                ? "window-held"
                : manual && !policy.forceRun
                  ? "manual"
                  : holdActive
                    ? "held"
                    : due || policy.forceRun
                      ? "due"
                      : "waiting";
  const eligibleCommands = {
    enable: lifecycle.controls.canEnable,
    disable: lifecycle.controls.canDisable,
    pause: lifecycle.controls.canPause && state !== "recovery-held",
    resume: lifecycle.controls.canResume || (holdActive && !blockedByPersistence),
    rebuild: lifecycle.controls.canRebuild && !blockedByControls && (policy.forceRun || state === "due" || manual),
    compact: lifecycle.controls.canCompact && !blockedByControls && (policy.forceRun || state === "due" || manual)
  };
  const commandRows = lifecycle.commandDecision.commandRows.map((row) => {
    const scheduleEligible = eligibleCommands[row.command] === true;
    const reason = scheduleEligible
      ? "eligible"
      : !row.allowed
        ? row.reason || "lifecycle-blocked"
        : state === "recovery-held"
          ? "persistence-recovery-required"
          : state === "policy-invalid"
            ? "schedule-policy-invalid"
            : state === "route-mismatch"
              ? "scheduler-route-mismatch"
              : state === "approval-held"
                ? "manual-approval-required"
                : state === "debounce-held"
                  ? "minimum-run-spacing-active"
                  : state === "window-held"
                    ? "outside-schedule-run-window"
                    : state === "held"
                      ? "schedule-held"
                      : state === "manual" && row.command !== "rebuild" && row.command !== "compact"
                        ? "manual-cadence-awaiting-refresh-command"
                        : "not-due";
    return {
      command: row.command,
      description: row.description,
      lifecycleAllowed: row.allowed,
      scheduleEligible,
      reason,
      permission: row.permission
    };
  });
  const blockingReasons = [];
  for (const error of policy.validationErrors) blockingReasons.push(`schedule-policy:${error}`);
  if (!routeOwned) blockingReasons.push(`schedule-owner-route:${policy.ownerRoute}`);
  if (blockedByPersistence) blockingReasons.push(`persistence:${persistedState.recovery.path}`);
  if (!lifecycleReady) blockingReasons.push(`lifecycle:${lifecycle.status}`);
  if (manualApprovalBlocked) {
    blockingReasons.push(approvalExpired
      ? "schedule-approval:expired"
      : policy.manualApproval.state === "approved"
        ? "schedule-approval:approval-timestamp-missing"
        : `schedule-approval:${policy.manualApproval.state}`);
  }
  if (debounceActive) blockingReasons.push(`schedule-debounce-until:${debounceUntil}`);
  if (windowPending) blockingReasons.push(`schedule-window-pending:${policy.windowStartsAt}`);
  if (windowClosed) blockingReasons.push(`schedule-window-closed:${policy.windowEndsAt}`);
  if (manual && !policy.forceRun) blockingReasons.push("cadence:manual");
  if (holdActive) {
    blockingReasons.push(`schedule-hold:${policy.holdReason || lifecycle.controls.holdReason || "until-window"}`);
  }
  const rawCatchUpRuns = due && cadenceMinutes
    ? Math.max(Math.floor((ageMinutes(now, dueAt) || 0) / cadenceMinutes) + 1, 1)
    : 0;
  const catchUpRuns = blockedByControls ? 0 : Math.min(rawCatchUpRuns, policy.maxCatchUpRuns);
  return {
    state,
    policy,
    cadenceMinutes,
    dueAt,
    holdUntil,
    due,
    forceRun: policy.forceRun,
    routeOwned,
    runWindow: {
      startsAt: policy.windowStartsAt,
      endsAt: policy.windowEndsAt,
      state: windowClosed ? "closed" : windowPending ? "pending" : "open",
      active: withinRunWindow
    },
    debounce: {
      minRunSpacingMinutes: policy.minRunSpacingMinutes,
      active: debounceActive,
      until: debounceUntil
    },
    manualApproval: policy.manualApproval,
    lastRunAgeMinutes: ageMinutes(now, policy.lastRunAt),
    catchUpRuns,
    rawCatchUpRuns,
    catchUpLimited: rawCatchUpRuns > catchUpRuns,
    eligibleCommands,
    commandRows,
    nextEligibleCommand: commandRows.find((row) => row.scheduleEligible)?.command || lifecycle.commandDecision.recommended,
    blockingReasons,
    lifecycleControl: {
      bound: lifecycle.controls.bound,
      observedState: lifecycle.controls.observedState,
      state: lifecycle.controls.state,
      paused: lifecycle.controls.paused,
      pausedUntil: lifecycle.controls.pausedUntil,
      holdReason: lifecycle.controls.holdReason,
      lockedCommands: lifecycle.controls.lockedCommands,
      allowCommands: lifecycle.controls.allowCommands,
      stateToken: lifecycle.controls.stateToken,
      digest: lifecycle.controls.digest
    },
    schedulerDigest: stableDigest({
      routeName: settings.routeName,
      cadence: settings.cadence,
      intervalMinutes: settings.intervalMinutes,
      state,
      dueAt,
      holdUntil,
      runWindow: { windowStartsAt: policy.windowStartsAt, windowEndsAt: policy.windowEndsAt, withinRunWindow },
      debounceUntil,
      manualApproval: policy.manualApproval,
      commandRows,
      policy,
      lifecycleControlDigest: lifecycle.controls.digest
    })
  };
}

function buildNextAction(now, settings, lifecycle, persistedState, scheduleControls) {
  if (lifecycle.status === "blocked") {
    return { type: "fix-settings", dueAt: null, reason: "settings validation failed" };
  }
  if (lifecycle.commandDecision.rejected) {
    return {
      type: `command-not-eligible:${lifecycle.command}`,
      dueAt: null,
      reason: lifecycle.commandDecision.rejectionReason
    };
  }
  if (persistedState?.recovery?.required) {
    return {
      type: "recover-replay-index-state",
      dueAt: null,
      reason: persistedState.recovery.path
    };
  }
  if (persistedState?.command?.idempotent) {
    return {
      type: "observe-idempotent-command",
      dueAt: null,
      reason: `command ${persistedState.command.id} already applied`
    };
  }
  if (lifecycle.status === "disabled") {
    return { type: "enable-index", dueAt: null, reason: "replay indexing is disabled" };
  }
  if (lifecycle.status === "paused") {
    return { type: "resume-index", dueAt: null, reason: "lifecycle command paused scheduling" };
  }
  if (scheduleControls.state === "route-mismatch") {
    return {
      type: "claim-scheduler-route",
      dueAt: null,
      reason: scheduleControls.blockingReasons[0]
    };
  }
  if (scheduleControls.state === "policy-invalid") {
    return {
      type: "repair-schedule-policy",
      dueAt: null,
      reason: scheduleControls.blockingReasons[0] || "schedule policy validation failed"
    };
  }
  if (scheduleControls.state === "approval-held") {
    return {
      type: "approve-scheduled-replay-index-run",
      dueAt: scheduleControls.manualApproval.expiresAt,
      reason: scheduleControls.blockingReasons[0] || "manual approval is required"
    };
  }
  if (scheduleControls.state === "debounce-held") {
    return {
      type: "wait-for-run-spacing",
      dueAt: scheduleControls.debounce.until,
      reason: scheduleControls.blockingReasons[0] || "minimum replay-index run spacing is active"
    };
  }
  if (scheduleControls.state === "window-held") {
    return {
      type: scheduleControls.runWindow.state === "pending" ? "wait-for-run-window" : "adjust-run-window",
      dueAt: scheduleControls.runWindow.state === "pending" ? scheduleControls.runWindow.startsAt : null,
      reason: scheduleControls.blockingReasons[0] || "outside replay-index run window"
    };
  }
  if (scheduleControls.state === "held") {
    return {
      type: "release-schedule-hold",
      dueAt: scheduleControls.holdUntil,
      reason: scheduleControls.blockingReasons[0] || "schedule is held"
    };
  }
  if (settings.cadence === "manual") {
    return { type: "manual-replay-index-refresh", dueAt: null, reason: "manual cadence selected" };
  }
  if (scheduleControls.state === "waiting") {
    return {
      type: "wait-for-scheduled-refresh",
      dueAt: scheduleControls.dueAt,
      reason: `${settings.cadence} cadence is not due yet`
    };
  }
  return {
    type: lifecycle.operations.compactRequested
      ? "compact-replay-index"
      : scheduleControls.catchUpRuns > 1
        ? "catch-up-replay-index"
        : "refresh-replay-index",
    dueAt: scheduleControls.dueAt,
    reason: scheduleControls.forceRun
      ? "force-run requested for hosted-kernel replay-index"
      : `${settings.cadence} cadence for hosted-kernel replay-index`
  };
}

function buildValidationSummary(
  settings,
  validationErrors,
  scheduleControls,
  providers,
  serviceContract,
  capabilityNegotiation,
  sync,
  clientRequest,
  accessBoundary,
  handoff,
  persistedState,
  replayIndex,
  operationalHealth
) {
  const providerErrors = [];
  if (providers.length === 0) providerErrors.push("providers must include at least one replay-index source");
  for (const provider of providers) {
    if (provider.status === "unavailable") providerErrors.push(`provider:${provider.id}:unavailable`);
    if (provider.capabilities.length === 0) providerErrors.push(`provider:${provider.id}:no-capabilities`);
    for (const error of provider.validationErrors || []) {
      providerErrors.push(`provider:${provider.id}:${error}`);
    }
  }
  const capabilityErrors = capabilityNegotiation.missingRequired
    .map((capability) => `capability:${capability}:missing`);
  const serviceErrors = serviceContract.blockedOperations
    .map((operationId) => `service-operation:${operationId}:unassigned`);
  const serviceWarnings = serviceContract.operations
    .filter((operation) => operation.state === "degraded" || operation.state === "optional-missing")
    .map((operation) => `service-operation:${operation.id}:${operation.state}`);
  const syncWarnings = [];
  if (!sync.cursor.checkpoint && sync.providerCursors.length === 0) {
    syncWarnings.push("sync has no checkpoint yet");
  }
  if (!sync.cursor.watermark && sync.providerCursors.every((cursor) => !cursor.watermark)) {
    syncWarnings.push("sync has no watermark yet");
  }
  const clientWarnings = [];
  if (!clientRequest.bound) clientWarnings.push("client request is not bound");
  if (clientRequest.bound && clientRequest.stale) clientWarnings.push("client request is stale");
  if (clientRequest.bound && !clientRequest.workflowVisible) clientWarnings.push("client workflow is hidden");
  if (clientRequest.bound && clientRequest.workflowState === "blocked") {
    clientWarnings.push(`client workflow blocked at ${clientRequest.blockedStepIds.join(", ")}`);
  }
  if (clientRequest.recordHandoffQueue.state === "blocked") {
    clientWarnings.push(`client record handoff blocked at ${clientRequest.recordHandoffQueue.activeLookupKey}`);
  }
  if (clientRequest.recordHandoffQueue.state === "needs-confirmation") {
    clientWarnings.push(`client record handoff needs confirmation at ${clientRequest.recordHandoffQueue.activeLookupKey}`);
  }
  if (clientRequest.bound && clientRequest.publishRequested && !clientRequest.workflowComplete) {
    clientWarnings.push(`client publish workflow incomplete at ${clientRequest.incompleteRequiredStepIds.join(", ")}`);
  }
  const boundaryErrors = [
    ...accessBoundary.missingPermissions.map((permission) => `permission:${permission}:missing`),
    ...accessBoundary.scopeViolations.map((violation) => `scope:${violation}`),
    ...accessBoundary.scopeIdIssues.map((issue) => `scope-id:${issue}`),
    ...accessBoundary.expiredGrantIds.map((grantId) => `cross-scope-grant:${grantId}:expired`),
    ...accessBoundary.invalidGrantIds.map((grantId) => `cross-scope-grant:${grantId}:invalid`)
  ];
  const handoffErrors = handoff.blockingReasons.map((reason) => `handoff:${reason}`);
  const persistenceErrors = persistedState.status === "blocked"
    ? persistedState.recovery.reasons.map((reason) => `persistence:${reason}`)
    : [];
  const persistenceWarnings = [];
  if (!persistedState.bound) {
    persistenceWarnings.push("no persisted replay-index snapshot has been committed yet");
  }
  if (persistedState.recovery.required) {
    persistenceWarnings.push(`persistence recovery required via ${persistedState.recovery.path}`);
  }
  if (persistedState.command.idempotent) {
    persistenceWarnings.push("command was already applied and will not be replayed");
  }
  const replayErrors = [];
  const replayWarnings = [];
  if (replayIndex) {
    for (const row of replayIndex.invalidRows) {
      replayErrors.push(`replay-index:${row.id}:${row.reasons.join("+")}`);
    }
    for (const row of replayIndex.subjectBundlePreview.blockedRows) {
      replayErrors.push(`replay-index-subject:${row.lookupKey}:${row.blockers[0] || "bundle-preview-blocked"}`);
    }
    for (const duplicateKey of replayIndex.duplicateKeys) {
      replayErrors.push(`replay-index:duplicate:${duplicateKey}`);
    }
    for (const conflict of replayIndex.conflictRows) {
      replayErrors.push(`replay-index:conflict:${conflict.kind}:${conflict.key}`);
    }
    if (!replayIndex.recordsBound) replayWarnings.push("replay-index has no bound replay records");
    if (replayIndex.droppedForRetention > 0) {
      replayWarnings.push(`replay-index dropped ${replayIndex.droppedForRetention} records by retention policy`);
    }
    for (const row of replayIndex.subjectBundlePreview.attentionRows) {
      replayWarnings.push(`replay-index-subject:${row.lookupKey}:${row.warnings[0] || "bundle-preview-attention"}`);
    }
  }
  const scheduleErrors = [];
  for (const error of scheduleControls.policy.validationErrors) {
    scheduleErrors.push(`schedule:${error}`);
  }
  if (!scheduleControls.routeOwned) {
    scheduleErrors.push(`schedule:owner-route:${scheduleControls.policy.ownerRoute}:mismatch`);
  }
  if (scheduleControls.state === "recovery-held") {
    scheduleErrors.push(`schedule:persistence:${persistedState.recovery.path}`);
  }
  const scheduleWarnings = [];
  if (["approval-held", "debounce-held", "window-held"].includes(scheduleControls.state)) {
    scheduleWarnings.push(scheduleControls.blockingReasons[0] || `schedule is ${scheduleControls.state}`);
  }
  if (scheduleControls.state === "held") {
    scheduleWarnings.push(scheduleControls.blockingReasons[0] || "schedule is held");
  }
  if (scheduleControls.state === "manual") {
    scheduleWarnings.push("schedule waits for a manual replay-index command");
  }
  if (scheduleControls.commandRows.some((row) => row.command === scheduleControls.nextEligibleCommand && !row.scheduleEligible)) {
    scheduleWarnings.push(`recommended lifecycle command ${scheduleControls.nextEligibleCommand} is not currently schedulable`);
  }
  if (scheduleControls.catchUpRuns > 1) {
    scheduleWarnings.push(`schedule has ${scheduleControls.catchUpRuns} catch-up runs queued`);
  }
  if (scheduleControls.catchUpLimited) {
    scheduleWarnings.push(`schedule catch-up limited from ${scheduleControls.rawCatchUpRuns} to ${scheduleControls.catchUpRuns} runs`);
  }
  const lifecycleWarnings = [];
  if (scheduleControls.commandRows.some((row) => row.reason?.startsWith("requires-active-lifecycle"))) {
    lifecycleWarnings.push("rebuild and compact controls require an active lifecycle");
  }
  if (scheduleControls.lifecycleControl.bound) {
    if (scheduleControls.lifecycleControl.paused) {
      lifecycleWarnings.push(`lifecycle control paused replay-index scheduling: ${scheduleControls.lifecycleControl.holdReason || "operator-hold"}`);
    }
    for (const command of scheduleControls.lifecycleControl.lockedCommands) {
      lifecycleWarnings.push(`lifecycle control locks ${command}`);
    }
    if (scheduleControls.lifecycleControl.allowCommands.length > 0) {
      lifecycleWarnings.push(`lifecycle control allows only ${scheduleControls.lifecycleControl.allowCommands.join(", ")}`);
    }
  }
  const healthErrors = [
    ...operationalHealth.actionableErrors.map((error) => `health:${error.code}:${error.severity}`),
    ...operationalHealth.retryExecutionPlan.validationErrors.map((error) => `health:${error}`)
  ];
  const healthWarnings = [];
  if (operationalHealth.degradedMode) {
    healthWarnings.push("operational health is degraded; replay-index will use degraded mode");
  }
  if (operationalHealth.degradedMode && !operationalHealth.retryExecutionPlan.degradedModeAllowed) {
    healthWarnings.push("operational health degraded mode is gated by unresolved replay-index safety checks");
  }
  if (operationalHealth.retryExecutionPlan.state === "ready") {
    healthWarnings.push(`health retry plan has ${operationalHealth.retryExecutionPlan.readyIncidentIds.length} retryable incidents ready`);
  }
  if (operationalHealth.retryExecutionPlan.state === "blocked") {
    healthWarnings.push(`health retry plan blocked at ${operationalHealth.retryExecutionPlan.blockedIncidentIds.length} incidents`);
  }
  for (const retry of operationalHealth.retryQueue) {
    healthWarnings.push(`retry:${retry.code}:next-at:${retry.nextRetryAt || "pending"}`);
  }
  const errors = [
    ...validationErrors,
    ...scheduleErrors,
    ...providerErrors,
    ...serviceErrors,
    ...capabilityErrors,
    ...boundaryErrors,
    ...handoffErrors,
    ...persistenceErrors,
    ...replayErrors,
    ...healthErrors
  ];
  const warnings = [
    ...syncWarnings,
    ...clientWarnings,
    ...persistenceWarnings,
    ...replayWarnings,
    ...scheduleWarnings,
    ...lifecycleWarnings,
    ...healthWarnings,
    ...serviceWarnings,
    ...capabilityNegotiation.degradedProviders.map((providerId) => `provider:${providerId}:degraded`)
  ];
  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    fields: {
      settings: validationErrors.length === 0 ? "valid" : "invalid",
      schedule: scheduleErrors.length === 0
        ? scheduleWarnings.length === 0
          ? "ready"
          : "attention"
        : "invalid",
      lifecycleControls: scheduleControls.lifecycleControl.bound
        ? lifecycleWarnings.length === 0
          ? "ready"
          : "attention"
        : "unbound",
      providers: providerErrors.length === 0 ? "valid" : "invalid",
      serviceContract: serviceErrors.length === 0
        ? serviceContract.state === "ready"
          ? "ready"
          : "attention"
        : "invalid",
      capabilities: capabilityErrors.length === 0 ? "valid" : "invalid",
      sync: syncWarnings.length === 0 ? "ready" : "initializing",
      clientRequest: clientRequest.bound
        ? clientRequest.stale || !clientRequest.workflowVisible || clientRequest.workflowState === "blocked"
          || ["blocked", "needs-confirmation"].includes(clientRequest.recordHandoffQueue.state)
          ? "attention"
          : "ready"
        : "unbound",
      accessBoundary: accessBoundary.state,
      handoff: handoff.state,
      persistence: persistedState.status,
      replayIndex: replayIndex
        ? replayErrors.length === 0
          ? replayIndex.recordsBound
            ? "ready"
            : "empty"
          : "invalid"
        : "unbound",
      operationalHealth: operationalHealth.state
    },
    limits: {
      cadence: settings.cadence,
      intervalMinutes: settings.intervalMinutes,
      scheduleState: scheduleControls.state,
      scheduleDueAt: scheduleControls.dueAt,
      nextEligibleCommand: scheduleControls.nextEligibleCommand,
      retentionDays: settings.retentionDays,
      maxEntries: settings.maxEntries,
      proofMode: settings.proofMode
    }
  };
}

function buildReadiness(
  lifecycle,
  scheduleControls,
  serviceContract,
  capabilityNegotiation,
  sync,
  clientRequest,
  accessBoundary,
  handoff,
  persistedState,
  replayIndex,
  operationalHealth,
  validationSummary
) {
  const checks = [
    { id: "settings", label: "Settings", state: validationSummary.fields.settings === "valid" ? "ready" : "blocked" },
    { id: "lifecycle", label: "Lifecycle", state: lifecycle.enabled ? "ready" : lifecycle.status },
    {
      id: "schedule",
      label: "Schedule",
      state: scheduleControls.state === "due" || scheduleControls.state === "waiting"
        ? "ready"
        : ["held", "manual", "approval-held", "debounce-held", "window-held"].includes(scheduleControls.state)
          ? "warming"
          : "blocked"
    },
    {
      id: "persistence",
      label: "Persisted state",
      state: persistedState.status === "clean"
        ? "ready"
        : persistedState.status === "recovering"
          ? "warming"
          : "blocked"
    },
    { id: "capabilities", label: "Capabilities", state: capabilityNegotiation.accepted ? "ready" : "blocked" },
    {
      id: "service-contract",
      label: "Service contract",
      state: serviceContract.state === "ready"
        ? "ready"
        : serviceContract.state === "held"
          ? "warming"
          : "blocked"
    },
    { id: "sync", label: "Sync cursor", state: sync.state === "syncable" ? "ready" : sync.state },
    {
      id: "client-request",
      label: "Client request",
      state: clientRequest.stale
        || !clientRequest.routeMatches
        || clientRequest.workflowState === "blocked"
        || clientRequest.recordHandoffQueue.state === "blocked"
        || (clientRequest.publishRequested && !clientRequest.workflowComplete)
        ? "blocked"
        : "ready"
    },
    { id: "access-boundary", label: "Access boundary", state: accessBoundary.state },
    {
      id: "replay-index",
      label: "Replay records",
      state: validationSummary.fields.replayIndex === "invalid"
        ? "blocked"
        : replayIndex.state === "empty"
          ? "warming"
          : "ready"
    },
    {
      id: "operational-health",
      label: "Operational health",
      state: operationalHealth.state === "healthy"
        ? "ready"
        : operationalHealth.state === "degraded"
          ? "warming"
          : "blocked"
    },
    { id: "handoff", label: "External handoff", state: handoff.state }
  ];
  const readyCount = checks.filter((check) => check.state === "ready").length;
  return {
    state: readyCount === checks.length ? "ready" : checks.some((check) => check.state === "blocked") ? "blocked" : "warming",
    score: Math.round((readyCount / checks.length) * 100),
    checks,
    readyCount,
    totalCount: checks.length,
    publishable: handoff.publish.shouldPublish && lifecycle.enabled && validationSummary.errorCount === 0,
    proofGate: handoff.publish.mode
  };
}

function buildAcceptance(
  settings,
  lifecycle,
  readiness,
  validationSummary,
  serviceContract,
  capabilityNegotiation,
  clientRequest,
  accessBoundary,
  handoff,
  operationalHealth
) {
  const blockers = [
    ...validationSummary.errors,
    ...serviceContract.blockedOperations.map((operationId) => `service operation ${operationId} has no available provider`),
    ...capabilityNegotiation.missingRequired.map((capability) => `missing capability ${capability}`),
    ...handoff.blockingReasons.map((reason) => `handoff blocked by ${reason}`),
    ...operationalHealth.actionableErrors.map((error) => `${error.code}: ${error.action}`)
  ];
  if (!lifecycle.enabled) blockers.push(`lifecycle is ${lifecycle.status}`);
  if (clientRequest.stale) blockers.push("client request is stale");
  if (!clientRequest.routeMatches) blockers.push(`client route ${clientRequest.routeName} does not match ${settings.routeName}`);
  if (clientRequest.publishRequested && !clientRequest.handoffAcknowledged) {
    blockers.push("client handoff acknowledgement is required");
  }
  if (accessBoundary.state !== "ready") {
    blockers.push(`access boundary is ${accessBoundary.state}`);
  }
  if (operationalHealth.state === "failed") {
    blockers.push("operational health is failed");
  }
  const accepted = readiness.state === "ready" && blockers.length === 0;
  return {
    accepted,
    status: accepted ? "accepted" : "needs-attention",
    routeName: settings.routeName,
    summary: accepted
      ? "Replay index is ready for hosted-kernel publication."
      : "Replay index needs operator attention before publication.",
    blockers: [...new Set(blockers)],
    warnings: validationSummary.warnings,
    canPublish: accepted && readiness.publishable,
    proofMode: settings.proofMode,
    boundary: {
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      actorId: accessBoundary.actorId,
      roles: accessBoundary.roles,
      auditScope: accessBoundary.auditScope
    }
  };
}

function buildNextSteps(
  nextAction,
  lifecycle,
  scheduleControls,
  validationSummary,
  serviceContract,
  capabilityNegotiation,
  sync,
  clientRequest,
  accessBoundary,
  handoff,
  persistedState,
  operationalHealth,
  readiness
) {
  const steps = [];
  if (validationSummary.errorCount > 0) {
    steps.push({
      id: "resolve-validation",
      priority: 1,
      action: "Resolve replay-index validation blockers",
      reason: validationSummary.errors[0],
      routeHint: "settings"
    });
  }
  if (capabilityNegotiation.missingRequired.length > 0) {
    steps.push({
      id: "attach-capability-provider",
      priority: 2,
      action: "Attach providers for missing replay capabilities",
      reason: capabilityNegotiation.missingRequired.join(", "),
      routeHint: "providers"
    });
  }
  if (serviceContract.blockedOperations.length > 0) {
    steps.push({
      id: "assign-service-operation",
      priority: 2,
      action: "Assign available providers to replay-index service operations",
      reason: serviceContract.blockedOperations.join(", "),
      routeHint: "service-contract"
    });
  }
  if (!lifecycle.enabled) {
    steps.push({
      id: "enable-lifecycle",
      priority: 3,
      action: "Enable replay indexing",
      reason: `lifecycle is ${lifecycle.status}`,
      routeHint: "lifecycle"
    });
  }
  if (["held", "route-mismatch", "policy-invalid", "approval-held", "debounce-held", "window-held"].includes(scheduleControls.state)) {
    steps.push({
      id: "release-schedule-control",
      priority: 3,
      action: scheduleControls.state === "route-mismatch"
        ? "Claim replay-index scheduler route"
        : scheduleControls.state === "policy-invalid"
          ? "Repair replay-index schedule policy"
          : scheduleControls.state === "approval-held"
            ? "Approve scheduled replay-index run"
            : scheduleControls.state === "debounce-held"
              ? "Wait for replay-index run spacing"
              : scheduleControls.state === "window-held"
                ? "Wait for replay-index run window"
                : "Release replay-index schedule hold",
      reason: scheduleControls.blockingReasons[0] || scheduleControls.state,
      routeHint: "schedule"
    });
  }
  if (scheduleControls.catchUpRuns > 1) {
    steps.push({
      id: "drain-schedule-backlog",
      priority: 4,
      action: "Drain queued replay-index catch-up runs",
      reason: `${scheduleControls.catchUpRuns} catch-up runs queued`,
      routeHint: "schedule"
    });
  }
  if (persistedState.recovery.required) {
    steps.push({
      id: "recover-persisted-state",
      priority: 3,
      action: "Recover persisted replay-index state",
      reason: persistedState.recovery.reasons[0] || persistedState.recovery.path,
      routeHint: "persistence"
    });
  }
  if (persistedState.command.idempotent) {
    steps.push({
      id: "skip-applied-command",
      priority: 3,
      action: "Skip already-applied replay-index command",
      reason: persistedState.command.id,
      routeHint: "persistence"
    });
  }
  if (accessBoundary.missingPermissions.length > 0) {
    steps.push({
      id: "grant-replay-index-permission",
      priority: 4,
      action: "Grant replay-index permission or switch actor role",
      reason: accessBoundary.missingPermissions[0],
      routeHint: "access-boundary"
    });
  }
  if (accessBoundary.scopeViolations.length > 0) {
    steps.push({
      id: "repair-workspace-boundary",
      priority: 4,
      action: "Repair tenant/workspace scoping before replay handoff",
      reason: accessBoundary.scopeViolations[0],
      routeHint: "access-boundary"
    });
  }
  if (accessBoundary.boundaryIssues.length > accessBoundary.scopeViolations.length) {
    steps.push({
      id: "repair-boundary-proof",
      priority: 4,
      action: "Repair replay-index boundary proof",
      reason: accessBoundary.boundaryIssues.find((issue) => !accessBoundary.scopeViolations.includes(issue))
        || accessBoundary.boundaryIssues[0],
      routeHint: "access-boundary"
    });
  }
  if (sync.state !== "syncable") {
    steps.push({
      id: "refresh-sync",
      priority: 4,
      action: "Refresh replay cursor and checkpoint metadata",
      reason: sync.refreshReason,
      routeHint: "sync"
    });
  }
  if (clientRequest.publishRequested && !clientRequest.handoffAcknowledged) {
    steps.push({
      id: "acknowledge-client-handoff",
      priority: 5,
      action: "Acknowledge replay-index handoff in the client workflow",
      reason: "publish request is waiting for client acknowledgement",
      routeHint: "client-handoff"
    });
  }
  if (clientRequest.workflowState === "blocked") {
    steps.push({
      id: "resolve-client-workflow-step",
      priority: 5,
      action: "Resolve blocked replay-index client workflow step",
      reason: clientRequest.blockedStepIds[0] || clientRequest.activeStepId || "client workflow blocked",
      routeHint: "client-request"
    });
  }
  if (clientRequest.recordHandoffQueue.state === "blocked") {
    steps.push({
      id: "repair-client-record-handoff",
      priority: 5,
      action: "Repair replay record handoff bundle mapping",
      reason: clientRequest.recordHandoffQueue.activeLookupKey || "record handoff queue blocked",
      routeHint: clientRequest.recordHandoffQueue.nextRouteHint
    });
  }
  if (clientRequest.recordHandoffQueue.state === "needs-confirmation") {
    steps.push({
      id: "confirm-client-record-handoff",
      priority: 5,
      action: "Confirm replay record handoff bundle references",
      reason: clientRequest.recordHandoffQueue.activeLookupKey || "record handoff queue needs confirmation",
      routeHint: clientRequest.recordHandoffQueue.nextRouteHint
    });
  }
  if (clientRequest.publishRequested && clientRequest.workflowState === "active") {
    steps.push({
      id: "advance-client-workflow",
      priority: 5,
      action: "Advance replay-index client workflow",
      reason: clientRequest.incompleteRequiredStepIds[0] || clientRequest.activeStepId || "client workflow incomplete",
      routeHint: "client-request"
    });
  }
  if (clientRequest.stale || !clientRequest.routeMatches) {
    steps.push({
      id: "refresh-client-request",
      priority: 5,
      action: "Refresh request state before replay-index publication",
      reason: clientRequest.stale ? "client request is stale" : `client route is ${clientRequest.routeName}`,
      routeHint: "client-request"
    });
  }
  if (handoff.state !== "ready") {
    steps.push({
      id: "publish-handoff",
      priority: 6,
      action: "Prepare external handoff targets",
      reason: handoff.blockingReasons[0] || "handoff not ready",
      routeHint: "handoff"
    });
  }
  if (operationalHealth.actionableErrors.length > 0) {
    const error = operationalHealth.actionableErrors[0];
    steps.push({
      id: "resolve-operational-health",
      priority: error.severity === "fatal" ? 1 : 2,
      action: error.action,
      reason: error.message,
      routeHint: error.routeHint
    });
  }
  if (operationalHealth.retryExecutionPlan.validationErrors.length > 0) {
    steps.push({
      id: "repair-health-retry-policy",
      priority: 2,
      action: "Repair replay-index retry policy",
      reason: operationalHealth.retryExecutionPlan.validationErrors[0],
      routeHint: "operational-health"
    });
  }
  if (operationalHealth.retryExecutionPlan.state === "ready") {
    const action = operationalHealth.retryExecutionPlan.operatorActions[0];
    steps.push({
      id: "execute-health-retry-plan",
      priority: 3,
      action: action?.action || "Execute replay-index retry plan",
      reason: action?.reason || "health retry plan is ready",
      routeHint: action?.routeHint || "operational-health"
    });
  }
  if (operationalHealth.retryQueue.length > 0) {
    const retry = operationalHealth.retryQueue[0];
    steps.push({
      id: "retry-replay-index-operation",
      priority: 3,
      action: "Retry replay-index operation after health backoff",
      reason: retry.nextRetryAt ? `${retry.code} retry scheduled at ${retry.nextRetryAt}` : retry.code,
      routeHint: retry.routeHint
    });
  }
  if (steps.length === 0) {
    steps.push({
      id: "run-next-action",
      priority: 1,
      action: nextAction.type,
      reason: nextAction.reason,
      routeHint: readiness.publishable ? "publish" : "schedule"
    });
  }
  return steps.sort((left, right) => left.priority - right.priority);
}

function previewToneForState(state) {
  if (state === "ready" || state === "accepted" || state === "valid" || state === "healthy") return "success";
  if (state === "warming" || state === "warning" || state === "degraded" || state === "attention") return "warning";
  if (state === "blocked" || state === "invalid" || state === "failed" || state === "needs-attention") return "danger";
  return "neutral";
}

function buildPreviewActionContract(nextAction, acceptance, readiness, scheduleControls, clientRequest, handoff, nextSteps) {
  const actionQueue = nextSteps.slice(0, 5).map((step, index) => ({
    id: step.id,
    order: index + 1,
    priority: step.priority,
    label: step.action,
    reason: step.reason,
    routeHint: step.routeHint,
    enabled: index === 0,
    tone: step.priority <= 2 ? "danger" : step.priority <= 4 ? "warning" : "neutral"
  }));
  const publishAction = {
    id: "publish-handoff",
    label: "Publish handoff",
    routeHint: "handoff",
    enabled: acceptance.canPublish,
    reason: acceptance.canPublish
      ? "Replay-index acceptance and handoff gates are ready"
      : acceptance.blockers[0] || "Replay-index acceptance is not ready",
    tone: acceptance.canPublish ? "success" : "neutral"
  };
  const refreshAction = {
    id: nextAction.type,
    label: nextAction.type,
    routeHint: readiness.publishable ? "publish" : "schedule",
    enabled: readiness.state !== "blocked" && scheduleControls.state !== "route-mismatch",
    reason: nextAction.reason,
    dueAt: nextAction.dueAt,
    tone: readiness.state === "blocked" ? "danger" : previewToneForState(scheduleControls.state)
  };
  const acknowledgeAction = {
    id: "acknowledge-client-handoff",
    label: "Acknowledge handoff",
    routeHint: "client-handoff",
    enabled: clientRequest.publishRequested && !clientRequest.handoffAcknowledged,
    reason: "Client publish request requires handoff acknowledgement",
    tone: clientRequest.publishRequested && !clientRequest.handoffAcknowledged ? "warning" : "neutral"
  };
  const secondaryActions = [refreshAction, acknowledgeAction, ...actionQueue]
    .filter((action, index, actions) => action.id && actions.findIndex((candidate) => candidate.id === action.id) === index)
    .slice(0, 6);
  return {
    format: "hosted-kernel.replay-index.preview-actions.v1",
    primary: acceptance.canPublish ? publishAction : actionQueue[0] || refreshAction,
    secondary: secondaryActions,
    actionQueue,
    clientTransition: {
      requestId: clientRequest.requestId,
      clientId: clientRequest.clientId,
      intent: clientRequest.intent,
      nextClientAction: clientRequest.nextClientAction,
      publishRequested: clientRequest.publishRequested,
      handoffAcknowledged: clientRequest.handoffAcknowledged,
      workflowState: clientRequest.workflowState,
      workflowComplete: clientRequest.workflowComplete,
      activeStepId: clientRequest.activeStepId,
      blockedStepIds: clientRequest.blockedStepIds,
      recordHandoffQueue: {
        format: clientRequest.recordHandoffQueue.format,
        state: clientRequest.recordHandoffQueue.state,
        totalRows: clientRequest.recordHandoffQueue.totalRows,
        readyRows: clientRequest.recordHandoffQueue.readyRows,
        ackRequiredRows: clientRequest.recordHandoffQueue.ackRequiredRows,
        blockedRows: clientRequest.recordHandoffQueue.blockedRows,
        attentionRows: clientRequest.recordHandoffQueue.attentionRows,
        activeLookupKey: clientRequest.recordHandoffQueue.activeLookupKey,
        nextRouteHint: clientRequest.recordHandoffQueue.nextRouteHint,
        digest: clientRequest.recordHandoffQueue.digest
      },
      transitionPlan: {
        format: clientRequest.transitionPlan.format,
        state: clientRequest.transitionPlan.state,
        primaryAction: clientRequest.transitionPlan.primaryAction,
        primaryRouteHint: clientRequest.transitionPlan.primaryRouteHint,
        currentStepId: clientRequest.transitionPlan.currentStepId,
        requiresAck: clientRequest.transitionPlan.requiresAck,
        blockedTransitionIds: clientRequest.transitionPlan.blockedTransitionIds,
        advanceableTransitionIds: clientRequest.transitionPlan.advanceableTransitionIds,
        digest: clientRequest.transitionPlan.digest
      },
      handoffPacketDigest: clientRequest.handoffPacket.digest,
      handoffAckToken: clientRequest.handoffPacket.ackToken,
      handoffState: handoff.state,
      handoffTargets: handoff.targetRefs.map((target) => target.handoffRef)
    }
  };
}

function buildPreviewValidationBadges(validationSummary, readiness, acceptance) {
  const fieldEntries = Object.entries(validationSummary.fields);
  const blockedFields = fieldEntries
    .filter(([, state]) => state === "invalid" || state === "blocked" || state === "failed")
    .map(([field]) => field);
  const attentionFields = fieldEntries
    .filter(([, state]) => state === "attention" || state === "warming" || state === "initializing" || state === "unbound")
    .map(([field]) => field);
  return {
    status: validationSummary.status,
    errorCount: validationSummary.errorCount,
    warningCount: validationSummary.warningCount,
    blockedFields,
    attentionFields,
    readinessScore: readiness.score,
    acceptanceStatus: acceptance.status,
    badges: fieldEntries.map(([field, state]) => ({
      field,
      state,
      tone: previewToneForState(state),
      blocking: blockedFields.includes(field),
      message: validationSummary.errors.find((error) => error.includes(field))
        || validationSummary.warnings.find((warning) => warning.includes(field))
        || `${field}:${state}`
    }))
  };
}

function buildPreview(
  settings,
  lifecycle,
  nextAction,
  scheduleControls,
  providers,
  serviceContract,
  capabilityNegotiation,
  sync,
  clientRequest,
  accessBoundary,
  handoff,
  persistedState,
  replayIndex,
  operationalHealth,
  readiness,
  acceptance,
  validationSummary,
  nextSteps
) {
  const actionContract = buildPreviewActionContract(
    nextAction,
    acceptance,
    readiness,
    scheduleControls,
    clientRequest,
    handoff,
    nextSteps
  );
  const validationBadges = buildPreviewValidationBadges(validationSummary, readiness, acceptance);
  const routePayload = {
    format: "hosted-kernel.replay-index.preview-route-payload.v1",
    routeName: settings.routeName,
    replayRoot: settings.replayRoot,
    status: acceptance.status,
    canPublish: acceptance.canPublish,
    primaryActionId: actionContract.primary.id,
    readinessState: readiness.state,
    readinessScore: readiness.score,
    validationStatus: validationSummary.status,
    blockedFields: validationBadges.blockedFields,
    attentionFields: validationBadges.attentionFields,
    lifecycleControlState: lifecycle.controls.state,
    lifecycleControlDigest: lifecycle.controls.digest,
    nextStepIds: nextSteps.map((step) => step.id),
    handoffTargetRefs: handoff.targetRefs.map((target) => target.handoffRef),
    handoffPublicationState: handoff.publicationPlan.state,
    handoffPublicationDigest: handoff.publicationPlan.digest,
    handoffPublishableTargets: handoff.publicationPlan.publishableTargetCount,
    subjectBundlePreviewState: replayIndex.subjectBundlePreview.state,
    subjectBundlePreviewDigest: replayIndex.subjectBundlePreview.digest,
    subjectBundlePreviewAcceptedRows: replayIndex.subjectBundlePreview.acceptedRows,
    subjectBundlePreviewBlockedRows: replayIndex.subjectBundlePreview.blockedRows.length,
    subjectBundlePreviewAttentionRows: replayIndex.subjectBundlePreview.attentionRows.length,
    subjectBundlePreviewNextStepIds: replayIndex.subjectBundlePreview.nextStepRows.map((row) => row.id),
    clientWorkflowState: clientRequest.workflowState,
    clientActiveStepId: clientRequest.activeStepId,
    clientHandoffPacketDigest: clientRequest.handoffPacket.digest,
    clientTransitionState: clientRequest.transitionPlan.state,
    clientTransitionPrimaryAction: clientRequest.transitionPlan.primaryAction,
    clientTransitionRouteHint: clientRequest.transitionPlan.primaryRouteHint,
    clientTransitionDigest: clientRequest.transitionPlan.digest,
    clientRecordHandoffState: clientRequest.recordHandoffQueue.state,
    clientRecordHandoffRows: clientRequest.recordHandoffQueue.totalRows,
    clientRecordHandoffBlockedRows: clientRequest.recordHandoffQueue.blockedRows,
    clientRecordHandoffAttentionRows: clientRequest.recordHandoffQueue.attentionRows,
    clientRecordHandoffActiveLookupKey: clientRequest.recordHandoffQueue.activeLookupKey,
    clientRecordHandoffDigest: clientRequest.recordHandoffQueue.digest,
    manifestDigest: replayIndex.manifestDigest,
    serviceContractDigest: serviceContract.digest,
    healthDigest: operationalHealth.digest,
    acceptanceDigest: stableDigest({
      accepted: acceptance.accepted,
      blockers: acceptance.blockers,
      warnings: acceptance.warnings,
      readinessState: readiness.state,
      validationStatus: validationSummary.status
    })
  };
  const cards = [
      {
        id: "readiness",
        label: "Readiness",
        value: `${readiness.score}%`,
        state: readiness.state,
        detail: `${readiness.readyCount}/${readiness.totalCount} checks ready`
      },
      {
        id: "capabilities",
        label: "Capabilities",
        value: `${capabilityNegotiation.available.length}/${capabilityNegotiation.required.length}`,
        state: capabilityNegotiation.decision,
        detail: capabilityNegotiation.missingRequired.length
          ? `Missing ${capabilityNegotiation.missingRequired.join(", ")}`
          : "Required capabilities available"
      },
      {
        id: "providers",
        label: "Providers",
        value: String(providers.length),
        state: providers.some((provider) => provider.status !== "available") ? "attention" : "ready",
        detail: providers.map((provider) => `${provider.id}:${provider.status}`).join(", ")
      },
      {
        id: "service-contract",
        label: "Services",
        value: serviceContract.state,
        state: serviceContract.state,
        detail: serviceContract.blockedOperations.length
          ? `Blocked ${serviceContract.blockedOperations.join(", ")}`
          : serviceContract.operations
            .filter((operation) => operation.providerId)
            .map((operation) => `${operation.id}:${operation.providerId}`)
            .join(", ")
      },
      {
        id: "persistence",
        label: "Persistence",
        value: persistedState.status,
        state: persistedState.recovery.required ? "recovering" : persistedState.status,
        detail: persistedState.command.idempotent
          ? `Duplicate command ${persistedState.command.id}`
          : persistedState.recovery.required
            ? persistedState.recovery.path
            : persistedState.recovery.writeFence
      },
      {
        id: "schedule",
        label: "Schedule",
        value: scheduleControls.state,
        state: scheduleControls.due ? "due" : scheduleControls.state,
        detail: scheduleControls.blockingReasons[0]
          || scheduleControls.dueAt
          || "manual scheduler control"
      },
      {
        id: "lifecycle-controls",
        label: "Controls",
        value: lifecycle.controls.bound ? lifecycle.controls.state : "default",
        state: lifecycle.controls.validationErrors.length > 0
          ? "blocked"
          : lifecycle.controls.paused
            ? "attention"
            : lifecycle.controls.effectiveEnabled
              ? "ready"
              : "disabled",
        detail: lifecycle.controls.bound
          ? lifecycle.controls.lockedCommands.length
            ? `Locked ${lifecycle.controls.lockedCommands.join(", ")}`
            : lifecycle.controls.holdReason || lifecycle.controls.stateToken
          : "Settings drive lifecycle state"
      },
      {
        id: "client-request",
        label: "Client",
        value: clientRequest.bound ? clientRequest.intent : "unbound",
        state: clientRequest.stale || !clientRequest.routeMatches || clientRequest.workflowState === "blocked"
          ? "blocked"
          : clientRequest.workflowComplete
            ? "ready"
            : "attention",
        detail: clientRequest.activeStepId || clientRequest.nextClientAction
      },
      {
        id: "access-boundary",
        label: "Boundary",
        value: accessBoundary.workspaceId,
        state: accessBoundary.state,
        detail: accessBoundary.state === "ready"
          ? accessBoundary.delegatedScopes.length
            ? `${accessBoundary.tenantId}/${accessBoundary.roles.join("+")} delegated:${accessBoundary.delegatedScopes.length}`
            : `${accessBoundary.tenantId}/${accessBoundary.roles.join("+")}`
          : [...accessBoundary.missingPermissions, ...accessBoundary.boundaryIssues].join(", ")
      },
      {
        id: "replay-index",
        label: "Records",
        value: String(replayIndex.retainedRecords),
        state: replayIndex.state,
        detail: replayIndex.invalidRows.length
          ? `Invalid ${replayIndex.invalidRows.map((row) => row.id).join(", ")}`
          : replayIndex.duplicateKeys.length
            ? `Duplicate ${replayIndex.duplicateKeys.join(", ")}`
            : replayIndex.conflictRows.length
              ? `Conflicts ${replayIndex.conflictRows.map((row) => row.key).join(", ")}`
              : replayIndex.recordsBound
                ? replayIndex.exportRef
                : "No replay records bound"
      },
      {
        id: "subject-bundles",
        label: "Subject bundles",
        value: `${replayIndex.subjectBundlePreview.acceptedRows}/${replayIndex.subjectBundlePreview.totalRows}`,
        state: replayIndex.subjectBundlePreview.state,
        detail: replayIndex.subjectBundlePreview.blockedRows.length
          ? replayIndex.subjectBundlePreview.blockedRows
            .slice(0, 3)
            .map((row) => `${row.lookupKey}:${row.blockers[0]}`)
            .join(", ")
          : replayIndex.subjectBundlePreview.attentionRows.length
            ? replayIndex.subjectBundlePreview.attentionRows
              .slice(0, 3)
              .map((row) => `${row.lookupKey}:${row.warnings[0]}`)
              .join(", ")
            : replayIndex.subjectBundlePreview.exportRef
      },
      {
        id: "operational-health",
        label: "Health",
        value: operationalHealth.state,
        state: operationalHealth.state,
        detail: operationalHealth.actionableErrors.length
          ? operationalHealth.actionableErrors.map((error) => error.code).join(", ")
          : operationalHealth.retryQueue.length
            ? `Retry ${operationalHealth.retryQueue[0].code} at ${operationalHealth.retryQueue[0].nextRetryAt || "pending"}`
            : operationalHealth.degradedMode
              ? "Degraded mode active"
              : "No runtime failures reported"
      },
      {
        id: "handoff",
        label: "Handoff",
        value: handoff.state,
        state: handoff.state,
        detail: handoff.targetRefs.length
          ? handoff.targetRefs.map((target) => target.handoffRef).join(", ")
          : "No handoff targets registered"
      },
      {
        id: "sync",
        label: "Sync",
        value: sync.state,
        state: sync.state,
        detail: sync.cursor.checkpoint || sync.checkpointDigest
      }
    ];
  const routeDecision = buildRouteDecisionContract(
    routePayload,
    cards,
    actionContract,
    validationBadges,
    readiness,
    acceptance,
    nextSteps
  );
  return {
    title: "Hosted-kernel replay index",
    status: acceptance.status,
    primaryAction: actionContract.primary.id,
    routeName: settings.routeName,
    replayRoot: settings.replayRoot,
    actionContract,
    validationBadges,
    routePayload: {
      ...routePayload,
      routeDecisionDigest: routeDecision.routeDigest
    },
    routeDecision,
    cards,
    schedule: {
      nextType: nextAction.type,
      dueAt: nextAction.dueAt,
      cadence: settings.cadence,
      state: scheduleControls.state,
      due: scheduleControls.due,
      catchUpRuns: scheduleControls.catchUpRuns,
      eligibleCommands: scheduleControls.eligibleCommands,
      commandRows: scheduleControls.commandRows,
      nextEligibleCommand: scheduleControls.nextEligibleCommand,
      commandDecision: lifecycle.commandDecision,
      lifecycleControl: scheduleControls.lifecycleControl,
      lifecycleStatus: lifecycle.status,
      persistedStatus: persistedState.status,
      clientNextAction: clientRequest.nextClientAction,
      healthState: operationalHealth.state,
      retryQueue: operationalHealth.retryQueue.length
    },
    digest: stableDigest({ routePayload, actionContract, validationBadges, routeDecision })
  };
}

function stableDigest(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function describeReplayIndexSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const settings = normalizeSettings(input.settings);
  const command = normalizeCommand(input.command);
  const lifecycleControls = normalizeLifecycleControls(input, settings, command, now);
  const validationErrors = [
    ...validateSettings(settings),
    ...lifecycleControls.validationErrors
  ];
  const lifecycle = buildLifecycle(settings, command, validationErrors, lifecycleControls);
  const persistedState = buildPersistedState(now, input, settings, command, lifecycle, validationErrors);
  const scheduleControls = buildScheduleControls(now, input, settings, lifecycle, persistedState);
  const nextAction = buildNextAction(now, settings, lifecycle, persistedState, scheduleControls);
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const providers = normalizeProviders(input, settings);
  const capabilityNegotiation = buildCapabilityNegotiation(input, providers, settings, lifecycle);
  const serviceContract = buildServiceContract(now, settings, providers, capabilityNegotiation, lifecycle);
  const replayIndex = buildReplayIndexManifest(now, input, settings, lifecycle, persistedState);
  const operationalHealth = buildOperationalHealth(now, input, settings, providers, serviceContract, persistedState, replayIndex);
  const sync = buildSyncMetadata(now, input, providers, lifecycle, capabilityNegotiation, serviceContract, replayIndex);
  const clientRequest = normalizeClientRequest(input, settings, command, now, replayIndex);
  const accessBoundary = normalizeAccessBoundary(input, command, providers, clientRequest, now);
  const handoff = buildExternalHandoff(
    now,
    settings,
    providers,
    lifecycle,
    capabilityNegotiation,
    serviceContract,
    sync,
    clientRequest,
    accessBoundary
  );
  const validationSummary = buildValidationSummary(
    settings,
    validationErrors,
    scheduleControls,
    providers,
    serviceContract,
    capabilityNegotiation,
    sync,
    clientRequest,
    accessBoundary,
    handoff,
    persistedState,
    replayIndex,
    operationalHealth
  );
  const readiness = buildReadiness(
    lifecycle,
    scheduleControls,
    serviceContract,
    capabilityNegotiation,
    sync,
    clientRequest,
    accessBoundary,
    handoff,
    persistedState,
    replayIndex,
    operationalHealth,
    validationSummary
  );
  const acceptance = buildAcceptance(
    settings,
    lifecycle,
    readiness,
    validationSummary,
    serviceContract,
    capabilityNegotiation,
    clientRequest,
    accessBoundary,
    handoff,
    operationalHealth
  );
  const nextSteps = buildNextSteps(
    nextAction,
    lifecycle,
    scheduleControls,
    validationSummary,
    serviceContract,
    capabilityNegotiation,
    sync,
    clientRequest,
    accessBoundary,
    handoff,
    persistedState,
    operationalHealth,
    readiness
  );
  const preview = buildPreview(
    settings,
    lifecycle,
    nextAction,
    scheduleControls,
    providers,
    serviceContract,
    capabilityNegotiation,
    sync,
    clientRequest,
    accessBoundary,
    handoff,
    persistedState,
    replayIndex,
    operationalHealth,
    readiness,
    acceptance,
    validationSummary,
    nextSteps
  );
  const analytics = buildAnalytics(
    now,
    input,
    settings,
    lifecycle,
    scheduleControls,
    nextAction,
    providers,
    serviceContract,
    capabilityNegotiation,
    sync,
    clientRequest,
    accessBoundary,
    handoff,
    persistedState,
    replayIndex,
    operationalHealth,
    readiness,
    validationSummary,
    acceptance,
    nextSteps,
    evidence
  );
  const audit = {
    accepted: acceptance.accepted,
    generatedAt: now,
    routeName: settings.routeName,
    replayRoot: settings.replayRoot,
    validationErrors,
    validationStatus: validationSummary.status,
    scheduleState: scheduleControls.state,
    scheduleDueAt: scheduleControls.dueAt,
    scheduleDigest: scheduleControls.schedulerDigest,
    eligibleLifecycleCommands: scheduleControls.eligibleCommands,
    lifecycleControlState: lifecycleControls.state,
    lifecycleControlDigest: lifecycleControls.digest,
    lifecycleControlStateToken: lifecycleControls.stateToken,
    lifecycleControlLockedCommands: lifecycleControls.lockedCommands,
    lifecycleControlAllowedCommands: lifecycleControls.allowCommands,
    lifecycleCommandDigest: lifecycle.commandDecision.digest,
    lifecycleCommandRejected: lifecycle.commandDecision.rejected,
    lifecycleCommandRejectionReason: lifecycle.commandDecision.rejectionReason,
    nextEligibleLifecycleCommand: scheduleControls.nextEligibleCommand,
    providerCount: providers.length,
    serviceContractState: serviceContract.state,
    serviceContractDigest: serviceContract.digest,
    blockedServiceOperations: serviceContract.blockedOperations,
    missingCapabilities: capabilityNegotiation.missingRequired,
    readinessState: readiness.state,
    readinessScore: readiness.score,
    syncState: sync.state,
    replayIndexState: replayIndex.state,
    replayIndexDigest: replayIndex.manifestDigest,
    replayIndexRows: replayIndex.retainedRecords,
    replayIndexInvalidRows: replayIndex.invalidRows.length,
    replayIndexDuplicateKeys: replayIndex.duplicateKeys.length,
    replayIndexConflictRows: replayIndex.conflictRows.length,
    replayIndexConflictRecords: replayIndex.conflictRecordIds,
    replaySubjectBundlePreviewState: replayIndex.subjectBundlePreview.state,
    replaySubjectBundlePreviewDigest: replayIndex.subjectBundlePreview.digest,
    replaySubjectBundlePreviewAcceptedRows: replayIndex.subjectBundlePreview.acceptedRows,
    replaySubjectBundlePreviewBlockedRows: replayIndex.subjectBundlePreview.blockedRows.length,
    replaySubjectBundlePreviewAttentionRows: replayIndex.subjectBundlePreview.attentionRows.length,
    replaySubjectBundlePreviewNextSteps: replayIndex.subjectBundlePreview.nextStepRows.map((row) => row.id),
    operationalHealthState: operationalHealth.state,
    operationalHealthDigest: operationalHealth.digest,
    degradedMode: operationalHealth.degradedMode,
    healthRetryPlanState: operationalHealth.retryExecutionPlan.state,
    healthRetryPlanDigest: operationalHealth.retryExecutionPlan.digest,
    healthRetryPlanNextRetryAt: operationalHealth.retryExecutionPlan.nextRetryAt,
    healthRetryPlanReadyIncidents: operationalHealth.retryExecutionPlan.readyIncidentIds,
    healthRetryPlanBlockedIncidents: operationalHealth.retryExecutionPlan.blockedIncidentIds,
    healthDegradedModeAllowed: operationalHealth.retryExecutionPlan.degradedModeAllowed,
    healthIncidentCount: operationalHealth.incidents.length,
    healthActionableErrorCount: operationalHealth.actionableErrors.length,
    healthRetryQueueCount: operationalHealth.retryQueue.length,
    persistedState: persistedState.status,
    persistedRestartSafe: persistedState.restartSafe,
    persistedRecoveryPath: persistedState.recovery.path,
    commandIdempotent: persistedState.command.idempotent,
    clientRequestState: validationSummary.fields.clientRequest,
    clientRequestDigest: stableDigest(clientRequest),
    clientWorkflowState: clientRequest.workflowState,
    clientWorkflowComplete: clientRequest.workflowComplete,
    clientActiveStepId: clientRequest.activeStepId,
    clientBlockedStepIds: clientRequest.blockedStepIds,
    clientHandoffPacketDigest: clientRequest.handoffPacket.digest,
    clientTransitionState: clientRequest.transitionPlan.state,
    clientTransitionPrimaryAction: clientRequest.transitionPlan.primaryAction,
    clientTransitionRouteHint: clientRequest.transitionPlan.primaryRouteHint,
    clientTransitionDigest: clientRequest.transitionPlan.digest,
    clientTransitionBlockedIds: clientRequest.transitionPlan.blockedTransitionIds,
    clientTransitionAdvanceableIds: clientRequest.transitionPlan.advanceableTransitionIds,
    clientRecordHandoffState: clientRequest.recordHandoffQueue.state,
    clientRecordHandoffRows: clientRequest.recordHandoffQueue.totalRows,
    clientRecordHandoffReadyRows: clientRequest.recordHandoffQueue.readyRows,
    clientRecordHandoffAckRows: clientRequest.recordHandoffQueue.ackRequiredRows,
    clientRecordHandoffBlockedRows: clientRequest.recordHandoffQueue.blockedRows,
    clientRecordHandoffAttentionRows: clientRequest.recordHandoffQueue.attentionRows,
    clientRecordHandoffActiveLookupKey: clientRequest.recordHandoffQueue.activeLookupKey,
    clientRecordHandoffDigest: clientRequest.recordHandoffQueue.digest,
    accessBoundaryState: accessBoundary.state,
    tenantId: accessBoundary.tenantId,
    workspaceId: accessBoundary.workspaceId,
    actorId: accessBoundary.actorId,
    accessAuditScope: accessBoundary.auditScope,
    missingPermissions: accessBoundary.missingPermissions,
    scopeViolations: accessBoundary.scopeViolations,
    scopeIdIssues: accessBoundary.scopeIdIssues,
    delegatedScopes: accessBoundary.delegatedScopes,
    crossScopeGrantIds: accessBoundary.crossScopeGrants.map((grant) => grant.id),
    expiredBoundaryGrantIds: accessBoundary.expiredGrantIds,
    invalidBoundaryGrantIds: accessBoundary.invalidGrantIds,
    boundaryIssues: accessBoundary.boundaryIssues,
    handoffState: handoff.state,
    handoffPublicationState: handoff.publicationPlan.state,
    handoffPublicationDigest: handoff.publicationPlan.digest,
    handoffPublishableTargets: handoff.publicationPlan.publishableTargetCount,
    handoffCommitFences: handoff.publish.commitSet.map((entry) => entry.commitFence),
    analyticsState: analytics.reportState.state,
    analyticsDigest: analytics.reportState.digest,
    analyticsCounterDigest: analytics.exportSummary.counterDigest,
    analyticsTimelineDigest: analytics.exportSummary.timelineDigest,
    historySnapshotCount: analytics.counters.historicalSnapshots,
    exportRowCount: analytics.exportSummary.rowCount,
    nextStepIds: nextSteps.map((step) => step.id),
    previewDigest: stableDigest(preview),
    previewRoutePayloadDigest: stableDigest(preview.routePayload),
    previewRouteDecisionDigest: preview.routeDecision.routeDigest,
    previewPrimaryAction: preview.primaryAction,
    previewBlockedFields: preview.validationBadges.blockedFields,
    previewAttentionFields: preview.validationBadges.attentionFields,
    evidenceCount: evidence.length,
    lifecycleDigest: stableDigest({
      settings,
      lifecycleControls,
      lifecycle,
      scheduleControls,
      nextAction,
      capabilityNegotiation,
      serviceContract,
      replayIndex,
      operationalHealth,
      sync,
      persistedState,
      clientRequest,
      accessBoundary,
      handoff,
      validationSummary,
      readiness,
      acceptance,
      nextSteps,
      preview,
      analytics
    })
  };

  return {
    ok: audit.accepted,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: CONTRACT,
    settings,
    lifecycleControls,
    lifecycle,
    scheduleControls,
    nextAction,
    preview,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    providers,
    serviceContract,
    capabilityNegotiation,
    replayIndex,
    operationalHealth,
    sync,
    persistedState,
    clientRequest,
    accessBoundary,
    handoff,
    analytics,
    audit,
    proof: {
      kind: "hosted-kernel-replay-index-proof",
      mode: settings.proofMode,
      surfaceId,
      digest: stableDigest({
        surfaceId,
        settings,
        lifecycleControls,
        lifecycle,
        scheduleControls,
        nextAction,
        preview,
        acceptance,
        readiness,
        validationSummary,
        nextSteps,
        providers,
        serviceContract,
        capabilityNegotiation,
        replayIndex,
        operationalHealth,
        sync,
        persistedState,
        clientRequest,
        accessBoundary,
        handoff,
        analytics,
        evidence
      }),
      assertions: [
        "settings-normalized",
        validationSummary.fields.settings === "valid" ? "settings-valid" : "settings-blocked",
        `schedule:${scheduleControls.state}`,
        scheduleControls.due ? "schedule:due" : "schedule:not-due",
        `lifecycle-command:${lifecycle.commandDecision.requested}`,
        `lifecycle-control:${lifecycleControls.state}`,
        lifecycleControls.bound ? `lifecycle-control-token:${lifecycleControls.stateToken}` : "lifecycle-control:default",
        lifecycleControls.lockedCommands.length ? `lifecycle-locks:${lifecycleControls.lockedCommands.join("+")}` : "lifecycle-locks:none",
        lifecycle.commandDecision.rejected ? `lifecycle-command-rejected:${lifecycle.commandDecision.rejectionReason}` : "lifecycle-command-applied",
        `lifecycle-next:${scheduleControls.nextEligibleCommand}`,
        `validation:${validationSummary.status}`,
        `service-contract:${serviceContract.state}`,
        `service-operations:${serviceContract.operations.length}`,
        `replay-index:${replayIndex.state}:${replayIndex.retainedRecords}`,
        `replay-index-conflicts:${replayIndex.conflictRows.length}`,
        `replay-scope-isolation:${replayIndex.scopeIsolation.state}:${replayIndex.scopeIsolation.counts.blockedRows}`,
        `replay-persistence-binding:${replayIndex.persistenceBinding.state}:${replayIndex.persistenceBinding.counts.pendingRows}`,
        `replay-index-proof:${replayIndex.proofDigest}`,
        `operational-health:${operationalHealth.state}`,
        operationalHealth.degradedMode ? "health:degraded-mode" : "health:normal-mode",
        operationalHealth.retryExecutionPlan.degradedModeAllowed ? "health:degraded-mode-allowed" : "health:degraded-mode-gated",
        `health-retry-plan:${operationalHealth.retryExecutionPlan.state}`,
        `health-retry-queue:${operationalHealth.retryQueue.length}`,
        capabilityNegotiation.accepted ? "capabilities-accepted" : "capabilities-blocked",
        `acceptance:${acceptance.status}`,
        `readiness:${readiness.state}:${readiness.score}`,
        `client-request:${validationSummary.fields.clientRequest}`,
        `client-workflow:${clientRequest.workflowState}`,
        clientRequest.workflowComplete ? "client-workflow:complete" : `client-workflow:active:${clientRequest.activeStepId}`,
        `client-transition:${clientRequest.transitionPlan.state}:${clientRequest.transitionPlan.primaryAction}`,
        `client-record-handoff:${clientRequest.recordHandoffQueue.state}:${clientRequest.recordHandoffQueue.totalRows}`,
        `client-handoff-packet:${clientRequest.handoffPacket.digest}`,
        `access-boundary:${accessBoundary.state}`,
        `workspace:${accessBoundary.workspaceId}`,
        `boundary-delegations:${accessBoundary.delegatedScopes.length}`,
        accessBoundary.boundaryIssues.length ? `boundary-issues:${accessBoundary.boundaryIssues.length}` : "boundary-proof:clean",
        `persistence:${persistedState.status}`,
        persistedState.command.idempotent ? "command:idempotent" : "command:pending",
        `handoff:${handoff.state}`,
        `handoff-publication:${handoff.publicationPlan.state}:${handoff.publicationPlan.publishableTargetCount}`,
        `analytics:${analytics.reportState.state}`,
        `history:${analytics.counters.historicalSnapshots}`,
        `export-rows:${analytics.exportSummary.rowCount}`,
        `preview-route-decision:${preview.routeDecision.routeDigest}`,
        `sync:${sync.state}`,
        lifecycle.enabled ? "index-schedulable" : `index-${lifecycle.status}`,
        `next-action:${nextAction.type}`
      ]
    },
    integration: {
      kernelRoute: settings.routeName,
      replayRoot: settings.replayRoot,
      lifecycleCommands: [...LIFECYCLE_COMMANDS],
      lifecycleCommandDescriptions: COMMAND_DESCRIPTIONS,
      lifecycleControls: {
        format: lifecycleControls.format,
        bound: lifecycleControls.bound,
        observedState: lifecycleControls.observedState,
        state: lifecycleControls.state,
        effectiveEnabled: lifecycleControls.effectiveEnabled,
        settingsEnabled: lifecycleControls.settingsEnabled,
        enabledOverride: lifecycleControls.enabledOverride,
        disabledByControl: lifecycleControls.disabledByControl,
        paused: lifecycleControls.paused,
        pausedUntil: lifecycleControls.pausedUntil,
        holdReason: lifecycleControls.holdReason,
        lockedCommands: lifecycleControls.lockedCommands,
        allowCommands: lifecycleControls.allowCommands,
        requestedBy: lifecycleControls.requestedBy,
        stateToken: lifecycleControls.stateToken,
        validationErrors: lifecycleControls.validationErrors,
        digest: lifecycleControls.digest
      },
      lifecycleCommandDecision: lifecycle.commandDecision,
      scheduleCadences: [...SCHEDULE_CADENCES],
      scheduleControls: {
        state: scheduleControls.state,
        due: scheduleControls.due,
        dueAt: scheduleControls.dueAt,
        holdUntil: scheduleControls.holdUntil,
        cadenceMinutes: scheduleControls.cadenceMinutes,
        catchUpRuns: scheduleControls.catchUpRuns,
        eligibleCommands: scheduleControls.eligibleCommands,
        commandRows: scheduleControls.commandRows,
        nextEligibleCommand: scheduleControls.nextEligibleCommand,
        blockingReasons: scheduleControls.blockingReasons,
        lifecycleControl: scheduleControls.lifecycleControl,
        schedulerDigest: scheduleControls.schedulerDigest
      },
      providerTypes: [...PROVIDER_TYPES],
      requiredCapabilities: capabilityNegotiation.required,
      serviceContract: {
        format: serviceContract.format,
        state: serviceContract.state,
        digest: serviceContract.digest,
        phaseStates: serviceContract.phaseStates,
        blockedOperations: serviceContract.blockedOperations,
        operations: serviceContract.operations.map((operation) => ({
          id: operation.id,
          phase: operation.phase,
          state: operation.state,
          required: operation.required,
          providerId: operation.providerId,
          routeName: operation.routeName,
          handoffRef: operation.handoffRef
        }))
      },
      persistedState: {
        status: persistedState.status,
        restartSafe: persistedState.restartSafe,
        commandId: persistedState.command.id,
        commandDigest: persistedState.command.digest,
        idempotent: persistedState.command.idempotent,
        recoveryPath: persistedState.recovery.path,
        writeFence: persistedState.recovery.writeFence
      },
      replayIndex: {
        format: replayIndex.format,
        state: replayIndex.state,
        exportRef: replayIndex.exportRef,
        manifestDigest: replayIndex.manifestDigest,
        proofDigest: replayIndex.proofDigest,
        totalRecords: replayIndex.totalRecords,
        retainedRecords: replayIndex.retainedRecords,
        droppedForRetention: replayIndex.droppedForRetention,
        invalidRows: replayIndex.invalidRows,
        duplicateKeys: replayIndex.duplicateKeys,
        conflictKeys: replayIndex.conflictKeys,
        conflictRows: replayIndex.conflictRows,
        repairPlan: replayIndex.repairPlan,
        scopeIsolation: {
          format: replayIndex.scopeIsolation.format,
          state: replayIndex.scopeIsolation.state,
          exportRef: replayIndex.scopeIsolation.exportRef,
          digest: replayIndex.scopeIsolation.digest,
          tenantId: replayIndex.scopeIsolation.tenantId,
          workspaceId: replayIndex.scopeIsolation.workspaceId,
          strictIsolation: replayIndex.scopeIsolation.strictIsolation,
          counts: replayIndex.scopeIsolation.counts,
          scopeIdIssues: replayIndex.scopeIsolation.scopeIdIssues,
          blockedRows: replayIndex.scopeIsolation.blockedRows,
          delegatedRows: replayIndex.scopeIsolation.delegatedRows
        },
        persistenceBinding: {
          format: replayIndex.persistenceBinding.format,
          state: replayIndex.persistenceBinding.state,
          exportRef: replayIndex.persistenceBinding.exportRef,
          digest: replayIndex.persistenceBinding.digest,
          restartSafe: replayIndex.persistenceBinding.restartSafe,
          cursorBound: replayIndex.persistenceBinding.cursorBound,
          counts: replayIndex.persistenceBinding.counts,
          resume: replayIndex.persistenceBinding.resume,
          actions: replayIndex.persistenceBinding.actions,
          lookupBindings: replayIndex.persistenceBinding.lookupBindings.map((row) => ({
            lookupKey: row.lookupKey,
            state: row.state,
            pendingReplayRecordIds: row.pendingReplayRecordIds,
            committedReplayRecordIds: row.committedReplayRecordIds,
            resumeFromReplayRecordId: row.resumeFromReplayRecordId,
            auditBundleRef: row.auditBundleRef,
            artifactBundleRef: row.artifactBundleRef,
            exportRef: row.exportRef,
            digest: row.digest
          }))
        },
        subjectBundlePreview: {
          format: replayIndex.subjectBundlePreview.format,
          state: replayIndex.subjectBundlePreview.state,
          exportRef: replayIndex.subjectBundlePreview.exportRef,
          digest: replayIndex.subjectBundlePreview.digest,
          totalRows: replayIndex.subjectBundlePreview.totalRows,
          acceptedRows: replayIndex.subjectBundlePreview.acceptedRows,
          blockedRows: replayIndex.subjectBundlePreview.blockedRows,
          attentionRows: replayIndex.subjectBundlePreview.attentionRows,
          nextStepRows: replayIndex.subjectBundlePreview.nextStepRows,
          rows: replayIndex.subjectBundlePreview.rows.map((row) => ({
            lookupKey: row.lookupKey,
            state: row.state,
            acceptanceStatus: row.acceptanceStatus,
            exportRef: row.preview.exportRef,
            blockerCount: row.validationSummary.errorCount,
            warningCount: row.validationSummary.warningCount,
            nextStep: row.nextStep,
            clientContract: row.clientContract,
            digest: row.digest
          }))
        },
        cursor: replayIndex.cursor
      },
      operationalHealth: {
        format: operationalHealth.format,
        state: operationalHealth.state,
        degradedMode: operationalHealth.degradedMode,
        digest: operationalHealth.digest,
        retryPolicy: operationalHealth.retryPolicy,
        retryExecutionPlan: operationalHealth.retryExecutionPlan,
        retryQueue: operationalHealth.retryQueue,
        actionableErrors: operationalHealth.actionableErrors,
        failureState: operationalHealth.failureState,
        evidence: operationalHealth.evidence
      },
      handoffTargets: handoff.targetRefs,
      handoffPublication: {
        format: handoff.publicationPlan.format,
        requested: handoff.publicationPlan.requested,
        state: handoff.publicationPlan.state,
        mode: handoff.publicationPlan.mode,
        operationId: handoff.publicationPlan.operationId,
        operationState: handoff.publicationPlan.operationState,
        assignedProviderId: handoff.publicationPlan.assignedProviderId,
        targetCount: handoff.publicationPlan.targetCount,
        publishableTargetCount: handoff.publicationPlan.publishableTargetCount,
        commitSet: handoff.publicationPlan.commitSet,
        receipt: handoff.publicationPlan.receipt,
        digest: handoff.publicationPlan.digest
      },
      clientRequest: {
        bound: clientRequest.bound,
        requestId: clientRequest.requestId,
        clientId: clientRequest.clientId,
        intent: clientRequest.intent,
        routeName: clientRequest.routeName,
        nextClientAction: clientRequest.nextClientAction,
        workflowState: clientRequest.workflowState,
        workflowComplete: clientRequest.workflowComplete,
        activeStepId: clientRequest.activeStepId,
        blockedStepIds: clientRequest.blockedStepIds,
        incompleteRequiredStepIds: clientRequest.incompleteRequiredStepIds,
        transitionPlan: {
          format: clientRequest.transitionPlan.format,
          state: clientRequest.transitionPlan.state,
          primaryAction: clientRequest.transitionPlan.primaryAction,
          primaryRouteHint: clientRequest.transitionPlan.primaryRouteHint,
          currentStepId: clientRequest.transitionPlan.currentStepId,
          requiresAck: clientRequest.transitionPlan.requiresAck,
          blockedTransitionIds: clientRequest.transitionPlan.blockedTransitionIds,
          advanceableTransitionIds: clientRequest.transitionPlan.advanceableTransitionIds,
          digest: clientRequest.transitionPlan.digest
        },
        handoffPacket: clientRequest.handoffPacket
      },
      accessBoundary: {
        tenantId: accessBoundary.tenantId,
        workspaceId: accessBoundary.workspaceId,
        actorId: accessBoundary.actorId,
        roles: accessBoundary.roles,
        state: accessBoundary.state,
        missingPermissions: accessBoundary.missingPermissions,
        scopeIdIssues: accessBoundary.scopeIdIssues,
        scopeViolations: accessBoundary.scopeViolations,
        delegatedScopes: accessBoundary.delegatedScopes,
        crossScopeGrants: accessBoundary.crossScopeGrants,
        expiredGrantIds: accessBoundary.expiredGrantIds,
        invalidGrantIds: accessBoundary.invalidGrantIds,
        boundaryIssues: accessBoundary.boundaryIssues,
        auditScope: accessBoundary.auditScope
      },
      previewCards: preview.cards.map((card) => card.id),
      previewRoutePayload: {
        format: preview.routePayload.format,
        status: preview.routePayload.status,
        canPublish: preview.routePayload.canPublish,
        primaryActionId: preview.routePayload.primaryActionId,
        readinessState: preview.routePayload.readinessState,
        validationStatus: preview.routePayload.validationStatus,
        blockedFields: preview.routePayload.blockedFields,
        attentionFields: preview.routePayload.attentionFields,
        lifecycleControlState: preview.routePayload.lifecycleControlState,
        lifecycleControlDigest: preview.routePayload.lifecycleControlDigest,
        nextStepIds: preview.routePayload.nextStepIds,
        handoffTargetRefs: preview.routePayload.handoffTargetRefs,
        clientWorkflowState: preview.routePayload.clientWorkflowState,
        clientActiveStepId: preview.routePayload.clientActiveStepId,
        clientHandoffPacketDigest: preview.routePayload.clientHandoffPacketDigest,
        clientTransitionState: preview.routePayload.clientTransitionState,
        clientTransitionPrimaryAction: preview.routePayload.clientTransitionPrimaryAction,
        clientTransitionRouteHint: preview.routePayload.clientTransitionRouteHint,
        clientTransitionDigest: preview.routePayload.clientTransitionDigest,
        clientRecordHandoffState: preview.routePayload.clientRecordHandoffState,
        clientRecordHandoffRows: preview.routePayload.clientRecordHandoffRows,
        clientRecordHandoffBlockedRows: preview.routePayload.clientRecordHandoffBlockedRows,
        clientRecordHandoffAttentionRows: preview.routePayload.clientRecordHandoffAttentionRows,
        clientRecordHandoffActiveLookupKey: preview.routePayload.clientRecordHandoffActiveLookupKey,
        clientRecordHandoffDigest: preview.routePayload.clientRecordHandoffDigest,
        subjectBundlePreviewState: preview.routePayload.subjectBundlePreviewState,
        subjectBundlePreviewDigest: preview.routePayload.subjectBundlePreviewDigest,
        subjectBundlePreviewAcceptedRows: preview.routePayload.subjectBundlePreviewAcceptedRows,
        subjectBundlePreviewBlockedRows: preview.routePayload.subjectBundlePreviewBlockedRows,
        subjectBundlePreviewAttentionRows: preview.routePayload.subjectBundlePreviewAttentionRows,
        subjectBundlePreviewNextStepIds: preview.routePayload.subjectBundlePreviewNextStepIds,
        manifestDigest: preview.routePayload.manifestDigest,
        serviceContractDigest: preview.routePayload.serviceContractDigest,
        healthDigest: preview.routePayload.healthDigest,
        acceptanceDigest: preview.routePayload.acceptanceDigest,
        routeDecisionDigest: preview.routePayload.routeDecisionDigest
      },
      previewRouteDecision: {
        format: preview.routeDecision.format,
        status: preview.routeDecision.status,
        accepted: preview.routeDecision.accepted,
        canPublish: preview.routeDecision.canPublish,
        readiness: preview.routeDecision.readiness,
        acceptance: preview.routeDecision.acceptance,
        validation: preview.routeDecision.validation,
        visibleCards: preview.routeDecision.visibleCards.map((card) => ({
          id: card.id,
          order: card.order,
          state: card.state,
          tone: card.tone,
          blocking: card.blocking,
          detailDigest: card.detailDigest
        })),
        gateRows: preview.routeDecision.gateRows.map((gate) => ({
          id: gate.id,
          order: gate.order,
          state: gate.state,
          tone: gate.tone,
          blocking: gate.blocking,
          fieldState: gate.fieldState
        })),
        nextStepRows: preview.routeDecision.nextStepRows.map((step) => ({
          id: step.id,
          order: step.order,
          priority: step.priority,
          routeHint: step.routeHint,
          enabled: step.enabled,
          resolvesGateIds: step.resolvesGateIds
        })),
        clientCommands: preview.routeDecision.clientCommands.map((command) => ({
          id: command.id,
          routeHint: command.routeHint,
          enabled: command.enabled,
          tone: command.tone,
          dueAt: command.dueAt
        })),
        clientTransition: preview.routeDecision.clientTransition,
        routeDigest: preview.routeDecision.routeDigest
      },
      previewActions: {
        format: preview.actionContract.format,
        primary: preview.actionContract.primary,
        secondary: preview.actionContract.secondary.map((action) => ({
          id: action.id,
          routeHint: action.routeHint,
          enabled: action.enabled,
          tone: action.tone
        })),
        clientTransition: preview.actionContract.clientTransition
      },
      validationBadges: preview.validationBadges.badges.map((badge) => ({
        field: badge.field,
        state: badge.state,
        tone: badge.tone,
        blocking: badge.blocking
      })),
      readinessChecks: readiness.checks.map((check) => check.id),
      nextStepRoutes: nextSteps.map((step) => step.routeHint),
      analytics: {
        reportState: analytics.reportState.state,
        exportFormat: analytics.exportSummary.format,
        exportRowCount: analytics.exportSummary.rowCount,
        historySnapshotCount: analytics.counters.historicalSnapshots,
        timelineDigest: analytics.exportSummary.timelineDigest,
        counterDigest: analytics.exportSummary.counterDigest,
        nextReportAt: analytics.reportState.nextReportAt,
        replayIndexDigest: analytics.exportSummary.replayIndexDigest,
        replayIndexRows: analytics.exportSummary.replayIndexRows,
        operationalHealthState: analytics.exportSummary.operationalHealthState,
        operationalHealthDigest: analytics.exportSummary.operationalHealthDigest,
        healthRetryPlanState: operationalHealth.retryExecutionPlan.state,
        healthRetryPlanDigest: operationalHealth.retryExecutionPlan.digest
      }
    },
    evidence
  };
}

export default describeReplayIndexSurface;
