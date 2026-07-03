export const surfaceId = "aios_memory-manager_freshness-gate_049";
export const surfaceGroup = "memory-manager";
export const surfaceName = "freshness-gate";

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MIN_TTL_MS = 30 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETRY_BASE_MS = 250;
const MAX_RETRY_BACKOFF_MS = 30 * 1000;
const MAX_RETRY_ATTEMPTS = 5;
const DEFAULT_DEGRADED_STALE_BUDGET_MS = 5 * 60 * 1000;
const MAX_DEGRADED_STALE_BUDGET_MS = 60 * 60 * 1000;
const MAX_DEPENDENCY_FAILURES = 25;
const PERSISTED_SCHEMA_VERSION = 1;
const MAX_ANALYTICS_HISTORY = 25;
const MAX_COMMAND_LEDGER_HISTORY = 40;
const MAX_CLIENT_WORKFLOW_ACKS = 20;
const MIN_SCHEDULE_INTERVAL_MS = 60 * 1000;
const MAX_SCHEDULE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SOURCE_CLOCK_SKEW_MS = 2 * 60 * 1000;
const DEFAULT_VOLATILE_CLAIM_TTL_MS = 5 * 60 * 1000;
const MAX_VOLATILE_CLAIMS = 20;
const TERMINAL_COMMAND_STATUSES = new Set(["completed", "acked", "applied", "skipped", "cancelled"]);
const PROVIDER_ACK_STATUSES = new Set(["missing", "pending", "accepted", "committed", "rejected", "expired"]);
const CLIENT_RUNTIME_TARGETS = new Set(["web", "desktop", "mobile", "cli", "agent", "api"]);
const CLIENT_WORKFLOW_MODES = new Set(["auto", "manual", "defer", "observe"]);
const CLIENT_WORKFLOW_MODE_ALIASES = new Map([
  ["auto-commit", "auto"],
  ["autocommit", "auto"],
  ["background", "auto"],
  ["confirm", "manual"],
  ["confirmation", "manual"],
  ["require-confirmation", "manual"],
  ["user-confirmation", "manual"],
  ["manual-confirmation", "manual"],
  ["later", "defer"],
  ["snooze", "defer"],
  ["postpone", "defer"],
  ["preview", "observe"],
  ["read-only", "observe"],
  ["readonly", "observe"]
]);
const OPERATIONAL_ERROR_ROUTES = new Map([
  ["MEMORY_BOUNDARY_INVALID", "memory-manager/boundary-audit"],
  ["MEMORY_LIFECYCLE_SETTINGS_INVALID", "memory-manager/freshness-gate/lifecycle-audit"],
  ["MEMORY_SOURCE_PROOF_INVALID", "memory-manager/freshness-gate/source-proof"],
  ["MEMORY_DEPENDENCY_UNHEALTHY", "memory-manager/freshness-gate/dependencies"],
  ["MEMORY_DEPENDENCY_QUORUM_UNMET", "memory-manager/freshness-gate/dependencies"],
  ["MEMORY_REFRESH_CIRCUIT_OPEN", "memory-manager/freshness-gate/circuit-breaker"],
  ["MEMORY_DEGRADED_STALE_BUDGET_EXCEEDED", "memory-manager/hydrate-context"],
  ["MEMORY_REFRESH_RETRY_COOLDOWN_ACTIVE", "memory-manager/hydrate-context/retry"],
  ["MEMORY_REFRESH_RETRY_EXHAUSTED", "memory-manager/freshness-failure"],
  ["MEMORY_PERSISTED_FRESHNESS_UNSAFE", "memory-manager/hydrate-context/recovery"],
  ["MEMORY_VOLATILE_CLAIM_UNVERIFIED", "memory-manager/freshness-gate/current-state-claims"]
]);
const LIFECYCLE_COMMANDS = new Set(["enable", "disable", "pause", "resume", "schedule-now"]);
const LIFECYCLE_COMMAND_ALIASES = new Map([
  ["on", "enable"],
  ["start", "enable"],
  ["activate", "enable"],
  ["off", "disable"],
  ["stop", "disable"],
  ["deactivate", "disable"],
  ["suspend", "pause"],
  ["unpause", "resume"],
  ["restart", "resume"],
  ["schedule_now", "schedule-now"],
  ["schedule now", "schedule-now"],
  ["run-now", "schedule-now"],
  ["run now", "schedule-now"],
  ["refresh-now", "schedule-now"],
  ["refresh now", "schedule-now"]
]);
const LIFECYCLE_MODES = new Set(["enforce", "observe", "disabled"]);
const MEMORY_READ_PERMISSIONS = new Set([
  "memory:read",
  "memory.read",
  "aios.memory.read",
  "workspace.memory.read"
]);
const MEMORY_WRITE_PERMISSIONS = new Set([
  "memory:write",
  "memory.write",
  "aios.memory.write",
  "workspace.memory.write"
]);
const MEMORY_ADMIN_ROLES = new Set([
  "owner",
  "admin",
  "workspace-admin",
  "memory-admin"
]);
const WORKSPACE_ACCESS_GRANT_SOURCES = new Set([
  "request",
  "principal",
  "session",
  "tenant-policy",
  "workspace-policy",
  "hosted-kernel"
]);
const PROVIDER_CAPABILITY_ALIASES = new Map([
  ["read", "memory.read"],
  ["memory:read", "memory.read"],
  ["memory-read", "memory.read"],
  ["write", "memory.write"],
  ["memory:write", "memory.write"],
  ["memory-write", "memory.write"],
  ["proof", "source-proof"],
  ["sourceproof", "source-proof"],
  ["signed-proof", "source-proof"],
  ["delta", "delta-sync"],
  ["incremental-sync", "delta-sync"],
  ["cursor", "cursor-sync"],
  ["cursor-sync", "cursor-sync"],
  ["watermark", "watermark-sync"],
  ["watermark-sync", "watermark-sync"],
  ["external-handoff", "external-handoff"],
  ["handoff", "external-handoff"]
]);
const PROVIDER_SYNC_MODE_ALIASES = new Map([
  ["full", "snapshot"],
  ["snapshot-sync", "snapshot"],
  ["replace", "snapshot"],
  ["delta", "delta"],
  ["delta-sync", "delta"],
  ["incremental", "delta"],
  ["incremental-sync", "delta"],
  ["cursor", "cursor"],
  ["cursor-sync", "cursor"],
  ["watermark", "watermark"],
  ["watermark-sync", "watermark"],
  ["observe", "observe"],
  ["readonly", "observe"],
  ["read-only", "observe"]
]);
const PROVIDER_SYNC_MODES = new Set(["snapshot", "delta", "cursor", "watermark", "observe"]);

function toIsoTimestamp(value, fallback) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
  }

  return fallback;
}

function clampTtlMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_TTL_MS;
  }

  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.round(numeric)));
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringList(value) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return [...new Set(source.map((item) => normalizeString(item)).filter(Boolean))];
}

function normalizeProviderCapability(value) {
  const normalized = normalizeString(value)?.toLowerCase().replace(/_/g, "-") || null;
  return normalized ? PROVIDER_CAPABILITY_ALIASES.get(normalized) || normalized : null;
}

function normalizeProviderCapabilities(value) {
  return [...new Set(normalizeStringList(value).map((item) => normalizeProviderCapability(item)).filter(Boolean))];
}

function normalizeProviderSyncMode(value) {
  const normalized = normalizeString(value)?.toLowerCase().replace(/_/g, "-") || "snapshot";
  return PROVIDER_SYNC_MODE_ALIASES.get(normalized) || (PROVIDER_SYNC_MODES.has(normalized) ? normalized : "snapshot");
}

function normalizeBoolean(value, fallback) {
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

function normalizeLifecycleCommand(value) {
  const normalized = normalizeString(value)?.toLowerCase().replace(/_/g, "-") || null;
  if (!normalized) {
    return null;
  }

  return LIFECYCLE_COMMAND_ALIASES.get(normalized) || (LIFECYCLE_COMMANDS.has(normalized) ? normalized : null);
}

function firstString(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence)) {
    return [];
  }

  return evidence
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `evidence-${index + 1}`,
      kind: typeof item.kind === "string" && item.kind.trim() ? item.kind.trim() : "runtime",
      sourceId: normalizeString(item.sourceId || item.source || item.producer) || "memory-runtime",
      producer: normalizeString(item.producer || item.service || item.writer),
      observedAt: toIsoTimestamp(item.observedAt || item.timestamp || item.generatedAt, null),
      checksum: normalizeString(item.checksum || item.digest || item.etag),
      confidence:
        typeof item.confidence === "number" && Number.isFinite(item.confidence)
          ? Math.min(1, Math.max(0, item.confidence))
          : null,
      summary: typeof item.summary === "string" ? item.summary.trim() : ""
    }));
}

function normalizeInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function stableKeyPart(value, fallback) {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function normalizeDependencyHealth(input) {
  const health = input.health && typeof input.health === "object" ? input.health : {};
  const dependencies = health.dependencies || input.dependencies || {};
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    return [];
  }

  return Object.entries(dependencies).map(([name, value]) => {
    const detail = value && typeof value === "object" ? value : { status: value };
    const status = normalizeString(detail.status) || (detail.ok === false ? "down" : "ok");
    return {
      name: stableKeyPart(name, "dependency"),
      status,
      required: detail.required !== false,
      checkedAt: toIsoTimestamp(detail.checkedAt || detail.observedAt || input.now, null),
      message: normalizeString(detail.message || detail.error || detail.reason)
    };
  });
}

function normalizeSourceProof(input) {
  const memoryState = input.memoryState && typeof input.memoryState === "object" ? input.memoryState : {};
  const runtimeMemory = memoryState.memory && typeof memoryState.memory === "object" ? memoryState.memory : memoryState;
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const requestedMemory = request.memory && typeof request.memory === "object" ? request.memory : {};
  const proof =
    (input.sourceProof && typeof input.sourceProof === "object" && input.sourceProof) ||
    (input.hydrationProof && typeof input.hydrationProof === "object" && input.hydrationProof) ||
    (runtimeMemory.sourceProof && typeof runtimeMemory.sourceProof === "object" && runtimeMemory.sourceProof) ||
    (requestedMemory.sourceProof && typeof requestedMemory.sourceProof === "object" && requestedMemory.sourceProof) ||
    {};
  const source =
    (proof.source && typeof proof.source === "object" && proof.source) ||
    (input.hydrationSource && typeof input.hydrationSource === "object" && input.hydrationSource) ||
    (runtimeMemory.source && typeof runtimeMemory.source === "object" && runtimeMemory.source) ||
    {};

  return {
    sourceId: normalizeString(proof.sourceId || source.id || source.sourceId) || "memory-runtime",
    sourceType: normalizeString(proof.sourceType || source.type || source.kind) || "hosted-kernel",
    producer: normalizeString(proof.producer || source.producer || source.service) || "memory-manager",
    version: normalizeString(proof.version || source.version || source.revision),
    checksum: normalizeString(proof.checksum || proof.digest || source.checksum || source.etag),
    observedAt: toIsoTimestamp(proof.observedAt || source.observedAt || source.timestamp, null),
    issuedAt: toIsoTimestamp(proof.issuedAt || proof.generatedAt || source.issuedAt, null),
    signed: normalizeBoolean(proof.signed ?? source.signed, false),
    trustLevel: normalizeString(proof.trustLevel || source.trustLevel) || "runtime"
  };
}

function evaluateSourceProof(input, state, evidence, generatedAt) {
  const nowMs = Date.parse(generatedAt);
  const hydrationMs = state.lastHydratedAt ? Date.parse(state.lastHydratedAt) : NaN;
  const proof = normalizeSourceProof(input);
  const proofObservedMs = proof.observedAt ? Date.parse(proof.observedAt) : NaN;
  const hydrationViolations = [];

  if (!Number.isFinite(hydrationMs)) {
    hydrationViolations.push("missing-hydration-timestamp");
  } else if (hydrationMs > nowMs + MAX_SOURCE_CLOCK_SKEW_MS) {
    hydrationViolations.push("hydration-timestamp-from-future");
  }

  if (proof.observedAt && Number.isFinite(proofObservedMs) && proofObservedMs > nowMs + MAX_SOURCE_CLOCK_SKEW_MS) {
    hydrationViolations.push("source-proof-from-future");
  }

  const evidenceProofs = evidence.map((item) => {
    const observedMs = item.observedAt ? Date.parse(item.observedAt) : NaN;
    const violations = [];

    if (!item.observedAt || !Number.isFinite(observedMs)) {
      violations.push("missing-evidence-timestamp");
    } else if (observedMs > nowMs + MAX_SOURCE_CLOCK_SKEW_MS) {
      violations.push("evidence-timestamp-from-future");
    }

    if (item.confidence !== null && item.confidence < 0.2) {
      violations.push("low-confidence-evidence");
    }

    return {
      id: item.id,
      kind: item.kind,
      sourceId: item.sourceId,
      observedAt: item.observedAt,
      checksum: item.checksum,
      confidence: item.confidence,
      accepted: violations.length === 0,
      violations
    };
  });
  const rejectedEvidence = evidenceProofs.filter((item) => !item.accepted);
  const acceptedEvidenceIds = evidenceProofs.filter((item) => item.accepted).map((item) => item.id);

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.source-proof.v1",
    generatedAt,
    clockSkewAllowanceMs: MAX_SOURCE_CLOCK_SKEW_MS,
    hydration: {
      ...proof,
      lastHydratedAt: state.lastHydratedAt,
      accepted: hydrationViolations.every((violation) => violation === "missing-hydration-timestamp"),
      violations: hydrationViolations
    },
    evidence: evidenceProofs,
    acceptedEvidenceIds,
    rejectedEvidenceCount: rejectedEvidence.length,
    valid:
      !hydrationViolations.includes("hydration-timestamp-from-future") &&
      !hydrationViolations.includes("source-proof-from-future") &&
      rejectedEvidence.length === 0,
    auditDisposition:
      hydrationViolations.length === 0 && rejectedEvidence.length === 0
        ? "source-proof-accepted"
        : rejectedEvidence.length > 0
          ? "source-proof-partially-rejected"
          : "source-proof-hydration-warning"
  };
}

function normalizeRetryState(input, generatedAt) {
  const retry =
    (input.retry && typeof input.retry === "object" && input.retry) ||
    (input.health && typeof input.health === "object" && input.health.retry) ||
    {};
  const attempts = normalizeInteger(retry.attempts || retry.attempt || input.retryAttempts, 0, 0, MAX_RETRY_ATTEMPTS);
  const baseDelayMs = normalizeInteger(retry.baseDelayMs || input.retryBaseDelayMs, DEFAULT_RETRY_BASE_MS, 50, 5000);
  const previousDelayMs = normalizeInteger(retry.previousDelayMs, 0, 0, MAX_RETRY_BACKOFF_MS);
  const retryAfterInput = retry.retryAfter || retry.retryAfterAt || input.retryAfter;
  const retryAfterAt = toIsoTimestamp(retryAfterInput, null);
  const generatedMs = Date.parse(generatedAt);
  const explicitRetryAfterMs = retryAfterAt ? Date.parse(retryAfterAt) : NaN;
  const exponentialDelayMs = Math.min(MAX_RETRY_BACKOFF_MS, baseDelayMs * 2 ** attempts);
  const delayMs = Math.max(previousDelayMs, exponentialDelayMs);
  const nextRetryAt =
    Number.isFinite(explicitRetryAfterMs) && explicitRetryAfterMs > generatedMs
      ? retryAfterAt
      : new Date(generatedMs + delayMs).toISOString();

  return {
    attempts,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    baseDelayMs,
    previousDelayMs,
    delayMs,
    nextRetryAt,
    cooldownActive: Number.isFinite(explicitRetryAfterMs) && explicitRetryAfterMs > generatedMs,
    exhausted: attempts >= MAX_RETRY_ATTEMPTS,
    reason: normalizeString(retry.reason || input.retryReason)
  };
}

function normalizeOperationalPolicy(input, generatedAt) {
  const health = input.health && typeof input.health === "object" ? input.health : {};
  const policy =
    (input.operationalPolicy && typeof input.operationalPolicy === "object" && input.operationalPolicy) ||
    (health.policy && typeof health.policy === "object" && health.policy) ||
    {};
  const degradedMode =
    (policy.degradedMode && typeof policy.degradedMode === "object" && policy.degradedMode) ||
    (health.degradedMode && typeof health.degradedMode === "object" && health.degradedMode) ||
    {};
  const circuitBreaker =
    (policy.circuitBreaker && typeof policy.circuitBreaker === "object" && policy.circuitBreaker) ||
    (health.circuitBreaker && typeof health.circuitBreaker === "object" && health.circuitBreaker) ||
    {};
  const generatedMs = Date.parse(generatedAt);
  const openUntil = toIsoTimestamp(circuitBreaker.openUntil || circuitBreaker.until || health.circuitOpenUntil, null);
  const openUntilMs = openUntil ? Date.parse(openUntil) : NaN;
  const forcedOpen = normalizeBoolean(circuitBreaker.open ?? circuitBreaker.tripped ?? health.circuitOpen, false);
  const consecutiveFailures = normalizeInteger(
    circuitBreaker.consecutiveFailures || health.consecutiveFailures,
    0,
    0,
    MAX_DEPENDENCY_FAILURES
  );
  const failureThreshold = normalizeInteger(
    circuitBreaker.failureThreshold || policy.failureThreshold,
    3,
    1,
    MAX_DEPENDENCY_FAILURES
  );
  const staleBudgetMs = normalizeInteger(
    degradedMode.maxStaleMs || degradedMode.staleBudgetMs || policy.maxStaleWhileDegradedMs,
    DEFAULT_DEGRADED_STALE_BUDGET_MS,
    MIN_TTL_MS,
    MAX_DEGRADED_STALE_BUDGET_MS
  );
  const failClosed = normalizeBoolean(policy.failClosed ?? degradedMode.failClosed, false);

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.operational-policy.v1",
    failClosed,
    minHealthyRequiredDependencies: normalizeInteger(
      policy.minHealthyRequiredDependencies || health.minHealthyRequiredDependencies,
      0,
      0,
      MAX_DEPENDENCY_FAILURES
    ),
    degradedMode: {
      enabled: normalizeBoolean(degradedMode.enabled ?? policy.allowDegradedMode, true),
      allowStaleRead: normalizeBoolean(degradedMode.allowStaleRead ?? policy.allowStaleWhileDegraded, true),
      staleBudgetMs,
      userVisible: normalizeBoolean(degradedMode.userVisible, true)
    },
    circuitBreaker: {
      state:
        forcedOpen || consecutiveFailures >= failureThreshold
          ? "open"
          : consecutiveFailures > 0
            ? "half-open"
            : "closed",
      forcedOpen,
      consecutiveFailures,
      failureThreshold,
      openUntil,
      open: forcedOpen || consecutiveFailures >= failureThreshold || (Number.isFinite(openUntilMs) && openUntilMs > generatedMs),
      retryAfter: Number.isFinite(openUntilMs) && openUntilMs > generatedMs ? openUntil : null,
      reason: normalizeString(circuitBreaker.reason || health.circuitReason)
    }
  };
}

function buildPersistenceKey(state) {
  return [
    "memory-freshness",
    stableKeyPart(state.tenantId, "no-tenant"),
    stableKeyPart(state.workspaceId, "no-workspace"),
    stableKeyPart(state.clientId, "anonymous-client"),
    stableKeyPart(state.conversationId, "no-conversation"),
    stableKeyPart(state.requestId, "anonymous-request")
  ].join(":");
}

function normalizePersistedFreshness(input, generatedAt) {
  const persisted =
    (input.persistedState && typeof input.persistedState === "object" && input.persistedState) ||
    (input.recoveredState && typeof input.recoveredState === "object" && input.recoveredState) ||
    {};
  const memoryFreshness =
    persisted.memoryFreshness && typeof persisted.memoryFreshness === "object"
      ? persisted.memoryFreshness
      : persisted;
  const status = typeof memoryFreshness.status === "string" ? memoryFreshness.status.trim() : "";
  const checkedAt = toIsoTimestamp(memoryFreshness.checkedAt, null);
  const expiresAt = toIsoTimestamp(memoryFreshness.expiresAt, null);
  const hydratedAt = toIsoTimestamp(memoryFreshness.lastHydratedAt, null);
  const hydratedAtMs = hydratedAt ? Date.parse(hydratedAt) : NaN;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const generatedAtMs = Date.parse(generatedAt);
  const schemaAccepted = Number(memoryFreshness.schemaVersion) === PERSISTED_SCHEMA_VERSION;
  const restartSafe =
    schemaAccepted &&
    status === "fresh" &&
    Number.isFinite(expiresAtMs) &&
    Number.isFinite(generatedAtMs) &&
    expiresAtMs >= generatedAtMs;

  return {
    schemaVersion:
      Number(memoryFreshness.schemaVersion) === PERSISTED_SCHEMA_VERSION
        ? PERSISTED_SCHEMA_VERSION
        : PERSISTED_SCHEMA_VERSION,
    originalSchemaVersion: Number.isFinite(Number(memoryFreshness.schemaVersion))
      ? Number(memoryFreshness.schemaVersion)
      : null,
    schemaAccepted,
    status: status || "unknown",
    checkedAt,
    expiresAt,
    lastHydratedAt: hydratedAt,
    reason: typeof memoryFreshness.reason === "string" ? memoryFreshness.reason.trim() : null,
    recoveryCursor:
      typeof memoryFreshness.recoveryCursor === "string" && memoryFreshness.recoveryCursor.trim()
        ? memoryFreshness.recoveryCursor.trim()
        : null,
    tenantId: normalizeString(memoryFreshness.tenantId || persisted.tenantId),
    workspaceId: normalizeString(memoryFreshness.workspaceId || persisted.workspaceId),
    restartSafe,
    recoveredAgeMs:
      Number.isFinite(hydratedAtMs) && Number.isFinite(generatedAtMs)
        ? Math.max(0, generatedAtMs - hydratedAtMs)
        : null
  };
}

function normalizeCommandStatus(value) {
  const status = normalizeString(value)?.toLowerCase() || "unknown";
  if (TERMINAL_COMMAND_STATUSES.has(status)) {
    return status;
  }
  if (["pending", "queued", "dispatching", "retrying", "failed", "unknown"].includes(status)) {
    return status;
  }

  return "unknown";
}

function commandLedgerRecoveryState(entry) {
  if (entry.fromFuture) {
    return "quarantine-clock-skew";
  }
  if (entry.terminal) {
    return "already-applied";
  }
  if (entry.status === "failed" && entry.attempts >= MAX_RETRY_ATTEMPTS) {
    return "manual-recovery-required";
  }
  if (entry.status === "failed") {
    return "retry-failed-command";
  }
  if (["pending", "queued", "dispatching", "retrying", "unknown"].includes(entry.status)) {
    return "resume-dispatch";
  }

  return "resume-dispatch";
}

function commandLedgerEntryRank(entry) {
  if (entry.fromFuture) {
    return -1000 + entry.sequence;
  }
  if (entry.terminal) {
    return 100000 + entry.sequence;
  }
  if (entry.status === "failed" && entry.attempts >= MAX_RETRY_ATTEMPTS) {
    return 50000 + entry.sequence;
  }
  if (entry.status === "failed") {
    return 25000 + entry.sequence;
  }

  return entry.sequence;
}

function normalizePersistedCommandLedger(input, generatedAt) {
  const persisted =
    (input.persistedState && typeof input.persistedState === "object" && input.persistedState) ||
    (input.recoveredState && typeof input.recoveredState === "object" && input.recoveredState) ||
    {};
  const source =
    (persisted.memoryFreshnessCommandLedger &&
      typeof persisted.memoryFreshnessCommandLedger === "object" &&
      persisted.memoryFreshnessCommandLedger) ||
    (persisted.commandLedger && typeof persisted.commandLedger === "object" && persisted.commandLedger) ||
    {};
  const rawEntries = Array.isArray(source.entries)
    ? source.entries
    : Array.isArray(source.commands)
      ? source.commands
      : [];
  const generatedMs = Date.parse(generatedAt);
  const entries = rawEntries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const lastDispatchedAt = toIsoTimestamp(entry.lastDispatchedAt || entry.dispatchedAt || entry.createdAt, null);
      const completedAt = toIsoTimestamp(entry.completedAt || entry.ackedAt || entry.appliedAt, null);
      const lastDispatchedMs = lastDispatchedAt ? Date.parse(lastDispatchedAt) : NaN;
      const completedMs = completedAt ? Date.parse(completedAt) : NaN;
      const status = normalizeCommandStatus(entry.status || (completedAt ? "completed" : "unknown"));

      return {
        sequence: normalizeInteger(entry.sequence || index + 1, index + 1, 1, Number.MAX_SAFE_INTEGER),
        commandId: normalizeString(entry.commandId || entry.id) || `recovered-command-${index + 1}`,
        type: normalizeString(entry.type) || "memory.freshness.unknown",
        topic: normalizeString(entry.topic) || commandTopicFor(entry.type),
        idempotencyKey: normalizeString(entry.idempotencyKey || entry.key),
        status,
        terminal: TERMINAL_COMMAND_STATUSES.has(status),
        attempts: normalizeInteger(entry.attempts || entry.dispatchAttempts, 0, 0, MAX_RETRY_ATTEMPTS),
        lastDispatchedAt,
        completedAt,
        error: normalizeString(entry.error || entry.reason),
        fromFuture:
          (Number.isFinite(lastDispatchedMs) && lastDispatchedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS) ||
          (Number.isFinite(completedMs) && completedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS)
      };
    })
    .filter((entry) => entry.idempotencyKey);
  const byIdempotencyKey = entries.reduce((index, entry) => {
    const current = index[entry.idempotencyKey];
    if (!current || commandLedgerEntryRank(entry) >= commandLedgerEntryRank(current)) {
      index[entry.idempotencyKey] = entry;
    }
    return index;
  }, {});
  const dedupedEntries = Object.values(byIdempotencyKey)
    .sort((left, right) => left.sequence - right.sequence)
    .map((entry) => ({
      ...entry,
      restartRecoveryState: commandLedgerRecoveryState(entry),
      dispatchableAfterRestart:
        !entry.fromFuture &&
        !entry.terminal &&
        !(entry.status === "failed" && entry.attempts >= MAX_RETRY_ATTEMPTS),
      supersededDuplicateCount: entries.filter(
        (candidate) =>
          candidate.idempotencyKey === entry.idempotencyKey &&
          (candidate.sequence !== entry.sequence || candidate.commandId !== entry.commandId)
      ).length
    }));
  const shapedEntries = dedupedEntries.slice(-MAX_COMMAND_LEDGER_HISTORY);
  const shapedByIdempotencyKey = shapedEntries.reduce((index, entry) => {
    index[entry.idempotencyKey] = entry;
    return index;
  }, {});

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.command-ledger.v1",
    generatedAt,
    retainedEntries: shapedEntries.length,
    maxEntries: MAX_COMMAND_LEDGER_HISTORY,
    duplicateEntriesCollapsed: Math.max(0, entries.length - dedupedEntries.length),
    truncatedEntries: Math.max(0, dedupedEntries.length - shapedEntries.length),
    restartRecovery: {
      resumableEntries: shapedEntries.filter((entry) => entry.restartRecoveryState === "resume-dispatch").length,
      retryableFailedEntries: shapedEntries.filter((entry) => entry.restartRecoveryState === "retry-failed-command").length,
      terminalEntries: shapedEntries.filter((entry) => entry.restartRecoveryState === "already-applied").length,
      manualRecoveryEntries: shapedEntries.filter((entry) => entry.restartRecoveryState === "manual-recovery-required").length,
      quarantinedEntries: shapedEntries.filter((entry) => entry.restartRecoveryState === "quarantine-clock-skew").length
    },
    entries: shapedEntries,
    byIdempotencyKey: shapedByIdempotencyKey
  };
}

function evaluateRecoveredFreshnessState(state, recovered, commandLedger, boundary, generatedAt) {
  const violations = [];
  const generatedMs = Date.parse(generatedAt);
  const checkedMs = recovered.checkedAt ? Date.parse(recovered.checkedAt) : NaN;

  if (!recovered.schemaAccepted && recovered.originalSchemaVersion !== null) {
    violations.push("persisted-schema-version-mismatch");
  }
  if (recovered.status === "unknown") {
    violations.push("persisted-status-missing");
  }
  if (Number.isFinite(checkedMs) && checkedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS) {
    violations.push("persisted-check-from-future");
  }
  if (recovered.tenantId && state.tenantId && recovered.tenantId !== state.tenantId) {
    violations.push("persisted-tenant-mismatch");
  }
  if (recovered.workspaceId && state.workspaceId && recovered.workspaceId !== state.workspaceId) {
    violations.push("persisted-workspace-mismatch");
  }
  if (commandLedger.entries.some((entry) => entry.fromFuture)) {
    violations.push("persisted-command-ledger-from-future");
  }

  const accepted = boundary.allowed && recovered.restartSafe && violations.length === 0;
  const staleButReusable =
    boundary.allowed &&
    !accepted &&
    recovered.status === "fresh" &&
    recovered.expiresAt &&
    !violations.some((violation) => violation.includes("mismatch") || violation.endsWith("from-future"));

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.recovery-status.v1",
    generatedAt,
    accepted,
    status: accepted
      ? "accepted-persisted-freshness"
      : staleButReusable
        ? "persisted-freshness-requires-revalidation"
        : recovered.status === "unknown"
          ? "no-persisted-freshness"
          : "persisted-freshness-rejected",
    restartSafe: accepted,
    reason: accepted
      ? "recovered-freshness-within-ttl"
      : violations[0] || (recovered.restartSafe ? "boundary-not-accepted" : "persisted-freshness-not-restart-safe"),
    violations,
    recoveredStatus: recovered.status,
    recoveredCheckedAt: recovered.checkedAt,
    recoveredExpiresAt: recovered.expiresAt,
    recoveredAgeMs: recovered.recoveredAgeMs,
    commandLedger: {
      retainedEntries: commandLedger.retainedEntries,
      duplicateEntriesCollapsed: commandLedger.duplicateEntriesCollapsed,
      truncatedEntries: commandLedger.truncatedEntries,
      restartRecovery: commandLedger.restartRecovery,
      terminalEntries: commandLedger.entries.filter((entry) => entry.terminal).length,
      pendingEntries: commandLedger.entries.filter((entry) => !entry.terminal).length
    }
  };
}

function normalizePrincipal(input) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const principal =
    (request.principal && typeof request.principal === "object" && request.principal) ||
    (input.principal && typeof input.principal === "object" && input.principal) ||
    (clientState.principal && typeof clientState.principal === "object" && clientState.principal) ||
    (input.auth && typeof input.auth === "object" && input.auth) ||
    {};
  const roles = normalizeStringList(principal.roles || principal.role || clientState.roles || input.roles);
  const permissions = normalizeStringList(
    principal.permissions ||
      principal.permission ||
      principal.scopes ||
      request.permissions ||
      clientState.permissions ||
      input.permissions
  );
  const permissionSet = new Set(permissions.map((permission) => permission.toLowerCase()));
  const roleSet = new Set(roles.map((role) => role.toLowerCase()));
  const admin = [...roleSet].some((role) => MEMORY_ADMIN_ROLES.has(role));

  return {
    subjectId: firstString(principal.subjectId, principal.userId, principal.id, input.subjectId),
    roles,
    permissions,
    isMemoryAdmin: admin,
    canReadMemory: admin || [...permissionSet].some((permission) => MEMORY_READ_PERMISSIONS.has(permission)),
    canWriteMemory: admin || [...permissionSet].some((permission) => MEMORY_WRITE_PERMISSIONS.has(permission)),
    boundarySource: normalizeString(principal.source || input.authSource) || "request"
  };
}

function normalizeWorkspaceAccess(input, principal, tenantId, workspaceId, generatedAt) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const policy =
    (input.workspaceAccess && typeof input.workspaceAccess === "object" && input.workspaceAccess) ||
    (request.workspaceAccess && typeof request.workspaceAccess === "object" && request.workspaceAccess) ||
    (request.boundary && typeof request.boundary === "object" && request.boundary.workspaceAccess) ||
    (principal.workspaceAccess && typeof principal.workspaceAccess === "object" && principal.workspaceAccess) ||
    (clientState.workspaceAccess && typeof clientState.workspaceAccess === "object" && clientState.workspaceAccess) ||
    {};
  const source = normalizeString(policy.source || policy.grantSource || policy.issuer) || "request";
  const grantSource = WORKSPACE_ACCESS_GRANT_SOURCES.has(source) ? source : "request";
  const allowedTenants = normalizeStringList(
    policy.allowedTenants || policy.tenantIds || policy.tenants || policy.tenantId
  );
  const allowedWorkspaces = normalizeStringList(
    policy.allowedWorkspaces || policy.workspaceIds || policy.workspaces || policy.workspaceId
  );
  const deniedWorkspaces = normalizeStringList(
    policy.deniedWorkspaces || policy.blockedWorkspaces || policy.denyWorkspaceIds
  );
  const expiresAt = toIsoTimestamp(policy.expiresAt || policy.validUntil || policy.leaseExpiresAt, null);
  const issuedAt = toIsoTimestamp(policy.issuedAt || policy.createdAt || policy.grantedAt, null);
  const generatedMs = Date.parse(generatedAt);
  const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const issuedMs = issuedAt ? Date.parse(issuedAt) : NaN;
  const violations = [];

  if (tenantId && allowedTenants.length > 0 && !allowedTenants.includes(tenantId)) {
    violations.push("workspace-access-tenant-not-granted");
  }
  if (workspaceId && allowedWorkspaces.length > 0 && !allowedWorkspaces.includes(workspaceId)) {
    violations.push("workspace-access-workspace-not-granted");
  }
  if (workspaceId && deniedWorkspaces.includes(workspaceId)) {
    violations.push("workspace-access-workspace-denied");
  }
  if (expiresAt && Number.isFinite(expiresMs) && expiresMs <= generatedMs) {
    violations.push("workspace-access-grant-expired");
  }
  if (issuedAt && Number.isFinite(issuedMs) && issuedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS) {
    violations.push("workspace-access-grant-from-future");
  }

  const constrained = allowedTenants.length > 0 || allowedWorkspaces.length > 0 || deniedWorkspaces.length > 0;
  const granted = principal.isMemoryAdmin || !constrained || violations.length === 0;

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.workspace-access.v1",
    source: grantSource,
    constrained,
    tenantId,
    workspaceId,
    subjectId: principal.subjectId,
    allowedTenants,
    allowedWorkspaces,
    deniedWorkspaces,
    issuedAt,
    expiresAt,
    granted,
    bypassedByAdmin: principal.isMemoryAdmin && violations.length > 0,
    violations: principal.isMemoryAdmin ? [] : violations,
    deniedViolations: violations,
    auditDisposition: granted ? "workspace-access-grant-accepted" : "workspace-access-grant-denied"
  };
}

function normalizeLifecycleMode(value, fallback = "enforce") {
  const normalized = normalizeString(value)?.toLowerCase() || null;
  return normalized && LIFECYCLE_MODES.has(normalized) ? normalized : fallback;
}

function normalizePreviousLifecycleState(input, generatedAt) {
  const persisted =
    (input.persistedState && typeof input.persistedState === "object" && input.persistedState) ||
    (input.recoveredState && typeof input.recoveredState === "object" && input.recoveredState) ||
    {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const memoryFreshness =
    persisted.memoryFreshness && typeof persisted.memoryFreshness === "object"
      ? persisted.memoryFreshness
      : {};
  const source =
    (persisted.memoryFreshnessLifecycle && typeof persisted.memoryFreshnessLifecycle === "object" && persisted.memoryFreshnessLifecycle) ||
    (persisted.lifecycle && typeof persisted.lifecycle === "object" && persisted.lifecycle) ||
    (memoryFreshness.lifecycle && typeof memoryFreshness.lifecycle === "object" && memoryFreshness.lifecycle) ||
    (clientState.memoryFreshnessLifecycle && typeof clientState.memoryFreshnessLifecycle === "object" && clientState.memoryFreshnessLifecycle) ||
    {};
  const effective = source.effective && typeof source.effective === "object" ? source.effective : source;
  const schedule = source.schedule && typeof source.schedule === "object" ? source.schedule : source;
  const enabled = normalizeBoolean(effective.enabled ?? source.enabled, true);
  const mode = enabled ? normalizeLifecycleMode(effective.mode || source.mode, "enforce") : "disabled";
  const pauseUntil = toIsoTimestamp(schedule.pauseUntil || source.pauseUntil, null);
  const nextRunAt = toIsoTimestamp(schedule.nextRunAt || source.nextRunAt, null);
  const generatedMs = Date.parse(generatedAt);
  const pauseUntilMs = pauseUntil ? Date.parse(pauseUntil) : NaN;
  const paused =
    enabled &&
    (normalizeBoolean(effective.paused ?? source.paused, false) ||
      (Number.isFinite(pauseUntilMs) && pauseUntilMs > generatedMs));

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.previous-lifecycle-state.v1",
    known: Object.keys(source).length > 0,
    enabled,
    mode,
    paused,
    pauseUntil: paused ? pauseUntil : null,
    nextRunAt,
    lastCommand: normalizeLifecycleCommand(source.lastCommand),
    updatedAt: toIsoTimestamp(source.updatedAt || source.generatedAt, null),
    source: source === persisted.memoryFreshnessLifecycle
      ? "persisted.memoryFreshnessLifecycle"
      : source === persisted.lifecycle
        ? "persisted.lifecycle"
        : source === memoryFreshness.lifecycle
          ? "persisted.memoryFreshness.lifecycle"
          : source === clientState.memoryFreshnessLifecycle
            ? "clientState.memoryFreshnessLifecycle"
            : "defaults"
  };
}

function buildLifecycleTransition(command, previous, desiredEnabled, desiredMode, paused, scheduleEnabled, nextRunAt) {
  const effectivePaused = desiredEnabled && paused;
  const targetMode = desiredEnabled ? desiredMode : "disabled";
  const targetState = {
    enabled: desiredEnabled,
    mode: targetMode,
    paused: effectivePaused,
    scheduleEnabled,
    nextRunAt: desiredEnabled && scheduleEnabled ? nextRunAt : null
  };
  const noOp =
    previous.known &&
    previous.enabled === targetState.enabled &&
    previous.mode === targetState.mode &&
    previous.paused === targetState.paused &&
    command !== "schedule-now";
  const type =
    command === "schedule-now"
      ? "manual-refresh"
      : !previous.enabled && targetState.enabled
        ? "enable"
        : previous.enabled && !targetState.enabled
          ? "disable"
          : !previous.paused && targetState.paused
            ? "pause"
            : previous.paused && !targetState.paused
              ? "resume"
              : previous.mode !== targetState.mode
                ? "mode-change"
                : noOp
                  ? "no-op"
                  : "settings-update";

  return {
    contract: "memory-freshness-gate.lifecycle-transition.v1",
    command,
    type,
    noOp,
    previous: {
      known: previous.known,
      enabled: previous.enabled,
      mode: previous.mode,
      paused: previous.paused,
      pauseUntil: previous.pauseUntil,
      nextRunAt: previous.nextRunAt
    },
    target: targetState,
    requiresSchedulerWrite: ["pause", "resume", "schedule-now", "manual-refresh"].includes(type),
    requiresEnablementWrite: ["enable", "disable"].includes(type),
    stateChanged: !noOp
  };
}

function normalizeLifecycleSettings(input, principal, generatedAt) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const requestedMemory = request.memory && typeof request.memory === "object" ? request.memory : {};
  const settings = input.settings && typeof input.settings === "object" ? input.settings : {};
  const source =
    (input.lifecycleSettings && typeof input.lifecycleSettings === "object" && input.lifecycleSettings) ||
    (settings.memoryFreshnessGate && typeof settings.memoryFreshnessGate === "object" && settings.memoryFreshnessGate) ||
    (requestedMemory.freshnessGate && typeof requestedMemory.freshnessGate === "object" && requestedMemory.freshnessGate) ||
    {};
  const scheduleSource = source.schedule && typeof source.schedule === "object" ? source.schedule : {};
  const rawCommand = normalizeString(input.lifecycleCommand || source.command || request.lifecycleCommand);
  const command = normalizeLifecycleCommand(rawCommand);
  const previous = normalizePreviousLifecycleState(input, generatedAt);
  const modeInput = normalizeString(source.mode)?.toLowerCase() || null;
  const explicitEnabled = normalizeBoolean(source.enabled ?? source.enforcementEnabled, null);
  const desiredMode =
    command === "disable"
      ? "disabled"
      : command === "enable" || command === "resume" || command === "schedule-now"
        ? "enforce"
        : explicitEnabled === false
          ? "disabled"
          : explicitEnabled === true
            ? "enforce"
            : LIFECYCLE_MODES.has(modeInput)
              ? modeInput
              : "enforce";
  const desiredEnabled = desiredMode !== "disabled" && command !== "disable";
  const scheduleEnabled = normalizeBoolean(scheduleSource.enabled ?? source.schedulingEnabled, true);
  const intervalMs = normalizeInteger(
    scheduleSource.intervalMs || source.scheduleIntervalMs,
    DEFAULT_TTL_MS,
    MIN_SCHEDULE_INTERVAL_MS,
    MAX_SCHEDULE_INTERVAL_MS
  );
  const pauseUntil = toIsoTimestamp(scheduleSource.pauseUntil || source.pauseUntil, null);
  const explicitNextRunAt = toIsoTimestamp(scheduleSource.nextRunAt || source.nextRunAt, null);
  const generatedMs = Date.parse(generatedAt);
  const pauseUntilMs = pauseUntil ? Date.parse(pauseUntil) : NaN;
  const nextRunMs = explicitNextRunAt ? Date.parse(explicitNextRunAt) : NaN;
  const rawPauseUntil = normalizeString(scheduleSource.pauseUntil || source.pauseUntil);
  const rawNextRunAt = normalizeString(scheduleSource.nextRunAt || source.nextRunAt);
  const rawIntervalMs = scheduleSource.intervalMs ?? source.scheduleIntervalMs;
  const paused = command === "pause" || (Number.isFinite(pauseUntilMs) && pauseUntilMs > generatedMs);
  const nextRunAt =
    command === "schedule-now"
      ? generatedAt
      : paused && Number.isFinite(pauseUntilMs)
        ? pauseUntil
        : Number.isFinite(nextRunMs) && nextRunMs > generatedMs
          ? explicitNextRunAt
          : new Date(generatedMs + intervalMs).toISOString();
  const validation = [];
  const transition = buildLifecycleTransition(
    command,
    previous,
    desiredEnabled,
    desiredMode,
    paused,
    scheduleEnabled,
    nextRunAt
  );

  if (rawCommand && !command) {
    validation.push({ code: "UNSUPPORTED_LIFECYCLE_COMMAND", value: rawCommand });
  }
  if (modeInput && !LIFECYCLE_MODES.has(modeInput)) {
    validation.push({ code: "UNSUPPORTED_LIFECYCLE_MODE", value: modeInput });
  }
  if (rawPauseUntil && !pauseUntil) {
    validation.push({ code: "INVALID_PAUSE_UNTIL", value: rawPauseUntil });
  }
  if (rawNextRunAt && !explicitNextRunAt) {
    validation.push({ code: "INVALID_NEXT_RUN_AT", value: rawNextRunAt });
  }
  if (rawIntervalMs !== undefined && intervalMs !== Math.round(Number(rawIntervalMs))) {
    validation.push({
      code: "SCHEDULE_INTERVAL_CLAMPED",
      requestedMs: Number.isFinite(Number(rawIntervalMs)) ? Math.round(Number(rawIntervalMs)) : null,
      effectiveMs: intervalMs
    });
  }
  if (command === "pause" && !pauseUntil) {
    validation.push({ code: "PAUSE_REQUIRES_PAUSE_UNTIL", command });
  }
  if (command === "pause" && previous.known && previous.enabled === false) {
    validation.push({ code: "PAUSE_REQUIRES_ENABLED_GATE", previousMode: previous.mode });
  }
  if (command === "pause" && scheduleEnabled === false) {
    validation.push({ code: "PAUSE_REQUIRES_SCHEDULING_ENABLED", command });
  }
  if (command === "resume" && previous.known && !previous.paused && !pauseUntil) {
    validation.push({ code: "RESUME_REQUIRES_PAUSED_GATE", previousMode: previous.mode });
  }
  if (command === "resume" && desiredEnabled === false) {
    validation.push({ code: "RESUME_REQUIRES_ENABLED_TARGET", previousMode: previous.mode });
  }
  if (command === "resume" && Number.isFinite(nextRunMs) && nextRunMs <= generatedMs) {
    validation.push({ code: "RESUME_NEXT_RUN_MUST_BE_FUTURE", value: explicitNextRunAt });
  }
  if (scheduleEnabled && desiredEnabled && explicitNextRunAt && Number.isFinite(nextRunMs) && nextRunMs <= generatedMs && command !== "schedule-now") {
    validation.push({ code: "NEXT_RUN_MUST_BE_FUTURE", value: explicitNextRunAt });
  }
  if (command === "schedule-now" && scheduleEnabled === false) {
    validation.push({ code: "SCHEDULE_NOW_REQUIRES_SCHEDULING_ENABLED", command });
  }
  if (command === "schedule-now" && previous.known && previous.enabled === false) {
    validation.push({ code: "SCHEDULE_NOW_REQUIRES_ENABLED_GATE", previousMode: previous.mode });
  }
  if ((command || desiredMode === "disabled" || source.enabled === false) && !principal.canWriteMemory) {
    validation.push({ code: "LIFECYCLE_CONTROL_REQUIRES_MEMORY_WRITE", command: command || desiredMode });
  }
  if ((command === "disable" || desiredMode === "disabled") && !principal.isMemoryAdmin) {
    validation.push({ code: "DISABLE_REQUIRES_MEMORY_ADMIN", command: command || "disable" });
  }

  const accepted = validation.length === 0;
  const effectiveEnabled = accepted ? desiredEnabled : true;
  const effectiveMode = accepted ? (effectiveEnabled ? desiredMode : "disabled") : "enforce";
  const effectivePaused = accepted && paused;
  const effectiveTransition = accepted
    ? transition
    : {
        ...transition,
        noOp: false,
        stateChanged: false,
        rejected: true,
        target: {
          enabled: effectiveEnabled,
          mode: effectiveMode,
          paused: effectivePaused,
          scheduleEnabled,
          nextRunAt: null
        }
      };
  const actor = {
    subjectId: principal.subjectId,
    admin: principal.isMemoryAdmin,
    canWriteMemory: principal.canWriteMemory,
    source: principal.boundarySource
  };
  const controlId = [
    "memory-freshness-lifecycle",
    stableKeyPart(principal.subjectId, "anonymous-subject"),
    stableKeyPart(command || desiredMode, "settings"),
    stableKeyPart(nextRunAt || generatedAt, "no-schedule")
  ].join(":");
  const nextActionState = !accepted
    ? {
        action: "repair-lifecycle-settings",
        route: "memory-manager/freshness-gate/lifecycle-audit",
        runAt: null,
        blocking: true,
        reason: validation[0]?.code || "lifecycle-settings-rejected"
      }
    : !effectiveEnabled
    ? {
        action: "gate-disabled",
        route: "memory-manager/freshness-gate/lifecycle",
        runAt: null,
        blocking: false,
        reason: command === "disable" || explicitEnabled === false ? "disabled-by-control" : "disabled-by-mode"
      }
    : accepted && effectiveTransition.noOp
      ? {
          action: "retain-current-lifecycle-state",
          route: "memory-manager/freshness-gate/lifecycle",
          runAt: scheduleEnabled ? nextRunAt : null,
          blocking: false,
          reason: "lifecycle-command-idempotent"
        }
    : effectivePaused
      ? {
          action: "wait-for-schedule-resume",
          route: "memory-manager/freshness-gate/scheduler",
          runAt: pauseUntil || nextRunAt,
          blocking: false,
          reason: command === "pause" ? "pause-command-accepted" : "pause-window-active"
        }
      : command === "schedule-now"
        ? {
            action: "run-hydration-now",
            route: "memory-manager/hydrate-context",
            runAt: generatedAt,
            blocking: true,
            reason: "schedule-now-command-accepted"
          }
        : scheduleEnabled
          ? {
              action: desiredMode === "observe" ? "observe-next-freshness-check" : "evaluate-freshness",
              route: "memory-manager/freshness-gate",
              runAt: nextRunAt,
              blocking: desiredMode === "enforce",
              reason: desiredMode === "observe" ? "observe-mode-active" : "enforcement-active"
            }
          : {
              action: "evaluate-freshness",
              route: "memory-manager/freshness-gate",
              runAt: null,
              blocking: desiredMode === "enforce",
              reason: "scheduling-disabled"
            };

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.lifecycle-settings.v1",
    controlId,
    command,
    rawCommand,
    previous,
    transition: effectiveTransition,
    requestedMode: desiredMode,
    accepted,
    validation,
    actor,
    effective: {
      enabled: effectiveEnabled,
      mode: effectiveMode,
      paused: effectivePaused,
      transitionType: effectiveTransition.type,
      transitionChanged: effectiveTransition.stateChanged,
      nextAction: nextActionState.action,
      nextActionState
    },
    schedule: {
      enabled: scheduleEnabled,
      intervalMs,
      pauseUntil: effectivePaused ? pauseUntil : null,
      nextRunAt: accepted && scheduleEnabled && effectiveEnabled ? nextRunAt : null,
      immediateRunRequested: accepted && command === "schedule-now",
      scheduleMutation: accepted && effectiveTransition.requiresSchedulerWrite
    },
    settingsPatch: {
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      enabled: effectiveEnabled,
      mode: effectiveMode,
      previousMode: previous.mode,
      previousEnabled: previous.enabled,
      scheduleEnabled,
      intervalMs,
      pauseUntil: effectivePaused ? pauseUntil : null,
      nextRunAt: accepted && scheduleEnabled && effectiveEnabled ? nextRunAt : null,
      transitionType: effectiveTransition.type,
      transitionChanged: effectiveTransition.stateChanged,
      immediateRunRequested: accepted && command === "schedule-now",
      lastCommand: command,
      updatedAt: accepted ? generatedAt : null,
      updatedBy: accepted ? principal.subjectId : null
    },
    auditProof: {
      generatedAt,
      disposition: accepted ? "lifecycle-settings-accepted" : "lifecycle-settings-rejected",
      requestedCommand: rawCommand,
      normalizedCommand: command,
      requestedEnabled: explicitEnabled,
      requestedMode: modeInput,
      effectiveMode,
      previousMode: previous.mode,
      previousEnabled: previous.enabled,
      previousPaused: previous.paused,
      transitionType: effectiveTransition.type,
      transitionChanged: effectiveTransition.stateChanged,
      validationCodes: validation.map((item) => item.code),
      scheduleChanged: Boolean(
        effectiveTransition.requiresSchedulerWrite ||
          rawIntervalMs !== undefined ||
          rawNextRunAt ||
          rawPauseUntil
      ),
      enablementChanged: Boolean(
        effectiveTransition.requiresEnablementWrite ||
          explicitEnabled !== null ||
          modeInput
      )
    },
    auditDisposition: accepted ? "lifecycle-settings-accepted" : "lifecycle-settings-rejected"
  };
}

function normalizeRequest(input, generatedAt) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const memoryState = input.memoryState && typeof input.memoryState === "object" ? input.memoryState : {};
  const requestedMemory = request.memory && typeof request.memory === "object" ? request.memory : {};
  const clientMemory = clientState.memory && typeof clientState.memory === "object" ? clientState.memory : {};
  const runtimeMemory = memoryState.memory && typeof memoryState.memory === "object" ? memoryState.memory : memoryState;
  const lastHydratedAt =
    requestedMemory.lastHydratedAt ||
    clientMemory.lastHydratedAt ||
    runtimeMemory.lastHydratedAt ||
    input.lastHydratedAt;
  const ttlMs =
    requestedMemory.ttlMs ||
    clientMemory.ttlMs ||
    runtimeMemory.ttlMs ||
    input.ttlMs;
  const principal = normalizePrincipal(input);
  const tenantId = firstString(
    request.tenantId,
    requestedMemory.tenantId,
    clientState.tenantId,
    runtimeMemory.tenantId,
    input.tenantId
  );
  const workspaceId = firstString(
    request.workspaceId,
    requestedMemory.workspaceId,
    clientState.workspaceId,
    runtimeMemory.workspaceId,
    input.workspaceId
  );
  const workspaceAccess = normalizeWorkspaceAccess(input, principal, tenantId, workspaceId, generatedAt);
  const lifecycle = normalizeLifecycleSettings(input, principal, generatedAt);

  return {
    requestId:
      (typeof request.id === "string" && request.id.trim()) ||
      (typeof input.requestId === "string" && input.requestId.trim()) ||
      "anonymous-request",
    clientId:
      (typeof clientState.clientId === "string" && clientState.clientId.trim()) ||
      (typeof input.clientId === "string" && input.clientId.trim()) ||
      "anonymous-client",
    conversationId:
      (typeof request.conversationId === "string" && request.conversationId.trim()) ||
      (typeof clientState.conversationId === "string" && clientState.conversationId.trim()) ||
      null,
    route:
      (typeof request.route === "string" && request.route.trim()) ||
      (typeof input.route === "string" && input.route.trim()) ||
      "memory-manager/freshness-gate",
    tenantId,
    workspaceId,
    principal,
    workspaceAccess,
    lifecycle,
    lastHydratedAt: toIsoTimestamp(lastHydratedAt, null),
    ttlMs: clampTtlMs(ttlMs),
    generatedAt
  };
}

function normalizeScopeClaim(source, value, generatedAt) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const tenantId = firstString(value.tenantId, value.tenant, value.accountId);
  const workspaceId = firstString(value.workspaceId, value.workspace, value.projectId);
  if (!tenantId && !workspaceId) {
    return null;
  }

  const issuedAt = toIsoTimestamp(value.issuedAt || value.createdAt || value.grantedAt, null);
  const expiresAt = toIsoTimestamp(value.expiresAt || value.validUntil || value.leaseExpiresAt, null);
  const generatedMs = Date.parse(generatedAt);
  const issuedMs = issuedAt ? Date.parse(issuedAt) : NaN;
  const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const violations = [];

  if (issuedAt && Number.isFinite(issuedMs) && issuedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS) {
    violations.push("scope-claim-from-future");
  }
  if (expiresAt && Number.isFinite(expiresMs) && expiresMs <= generatedMs) {
    violations.push("scope-claim-expired");
  }

  return {
    source,
    tenantId,
    workspaceId,
    authority: normalizeString(value.authority || value.issuer || value.source) || source,
    boundaryRef: normalizeString(value.boundaryRef || value.scopeRef || value.id),
    issuedAt,
    expiresAt,
    violations
  };
}

function collectScopeClaims(input, recovered, generatedAt) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const memoryState = input.memoryState && typeof input.memoryState === "object" ? input.memoryState : {};
  const requestedMemory = request.memory && typeof request.memory === "object" ? request.memory : {};
  const clientMemory = clientState.memory && typeof clientState.memory === "object" ? clientState.memory : {};
  const runtimeMemory = memoryState.memory && typeof memoryState.memory === "object" ? memoryState.memory : memoryState;
  const services = input.services && typeof input.services === "object" ? input.services : {};
  const provider =
    (input.providerService && typeof input.providerService === "object" && input.providerService) ||
    (input.memoryProvider && typeof input.memoryProvider === "object" && input.memoryProvider) ||
    (services.memory && typeof services.memory === "object" && services.memory) ||
    (services.memoryProvider && typeof services.memoryProvider === "object" && services.memoryProvider) ||
    {};
  const candidates = [
    ["request", request],
    ["request.memory", requestedMemory],
    ["client-state", clientState],
    ["client-state.memory", clientMemory],
    ["runtime-memory", runtimeMemory],
    ["recovered-freshness", recovered],
    ["provider-service", provider]
  ];

  return candidates
    .map(([source, value]) => normalizeScopeClaim(source, value, generatedAt))
    .filter(Boolean);
}

function evaluateTenantWorkspaceScope(input, state, recovered, generatedAt) {
  const claims = collectScopeClaims(input, recovered, generatedAt);
  const tenantClaims = claims.filter((claim) => claim.tenantId);
  const workspaceClaims = claims.filter((claim) => claim.workspaceId);
  const tenantValues = [...new Set(tenantClaims.map((claim) => claim.tenantId))];
  const workspaceValues = [...new Set(workspaceClaims.map((claim) => claim.workspaceId))];
  const claimViolations = claims.flatMap((claim) =>
    claim.violations.map((violation) => ({
      source: claim.source,
      code: violation,
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId
    }))
  );
  const mismatchViolations = [];

  for (const claim of claims) {
    if (claim.tenantId && state.tenantId && claim.tenantId !== state.tenantId) {
      mismatchViolations.push({
        source: claim.source,
        code: "scope-tenant-mismatch",
        expected: state.tenantId,
        actual: claim.tenantId
      });
    }
    if (claim.workspaceId && state.workspaceId && claim.workspaceId !== state.workspaceId) {
      mismatchViolations.push({
        source: claim.source,
        code: "scope-workspace-mismatch",
        expected: state.workspaceId,
        actual: claim.workspaceId
      });
    }
  }
  if (tenantValues.length > 1) {
    mismatchViolations.push({ source: "scope-proof", code: "scope-tenant-split-brain", values: tenantValues });
  }
  if (workspaceValues.length > 1) {
    mismatchViolations.push({ source: "scope-proof", code: "scope-workspace-split-brain", values: workspaceValues });
  }

  const violations = [...claimViolations, ...mismatchViolations];

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.tenant-workspace-scope.v1",
    generatedAt,
    canonical: {
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      subjectId: state.principal.subjectId,
      persistenceKey: buildPersistenceKey(state)
    },
    claims,
    claimCounts: {
      total: claims.length,
      tenant: tenantClaims.length,
      workspace: workspaceClaims.length,
      mismatched: mismatchViolations.length,
      invalidLease: claimViolations.length
    },
    accepted: violations.length === 0,
    violations,
    violationCodes: [...new Set(violations.map((violation) => violation.code))],
    auditDisposition: violations.length === 0 ? "tenant-workspace-scope-accepted" : "tenant-workspace-scope-denied"
  };
}

function evaluateBoundary(state, recovered, scopeProof = null) {
  const violations = [];
  if (!state.tenantId) {
    violations.push("missing-tenant");
  }
  if (!state.workspaceId) {
    violations.push("missing-workspace");
  }
  if (!state.principal.subjectId) {
    violations.push("missing-principal");
  }
  if (!state.principal.canReadMemory) {
    violations.push("missing-memory-read-permission");
  }
  if (!state.workspaceAccess.granted) {
    violations.push(...state.workspaceAccess.violations);
  }
  if (recovered.tenantId && state.tenantId && recovered.tenantId !== state.tenantId) {
    violations.push("persisted-tenant-mismatch");
  }
  if (recovered.workspaceId && state.workspaceId && recovered.workspaceId !== state.workspaceId) {
    violations.push("persisted-workspace-mismatch");
  }
  if (scopeProof && !scopeProof.accepted) {
    violations.push(...scopeProof.violationCodes);
  }

  const allowed = violations.length === 0;
  return {
    allowed,
    scope: {
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      subjectId: state.principal.subjectId
    },
    permissions: {
      canReadMemory: state.principal.canReadMemory,
      canWriteMemory: state.principal.canWriteMemory,
      isMemoryAdmin: state.principal.isMemoryAdmin,
      roles: state.principal.roles,
      permissions: state.principal.permissions,
      boundarySource: state.principal.boundarySource
    },
    workspaceAccess: state.workspaceAccess,
    scopeProof,
    violations,
    auditDisposition: allowed ? "tenant-workspace-boundary-accepted" : "tenant-workspace-boundary-denied"
  };
}

function normalizeClaimMode(value) {
  const normalized = normalizeString(value)?.toLowerCase().replace(/_/g, "-") || null;
  if (["block", "blocking", "enforce", "required"].includes(normalized)) {
    return "block";
  }
  if (["degrade", "degraded", "warn", "warning"].includes(normalized)) {
    return "degrade";
  }
  if (["allow", "observe", "optional"].includes(normalized)) {
    return "observe";
  }

  return "block";
}

function normalizeClaimProofRequirement(value) {
  const normalized = normalizeString(value)?.toLowerCase().replace(/_/g, "-") || null;
  if (["accepted-evidence", "evidence", "evidence-only", "proof-id", "proof-ids"].includes(normalized)) {
    return "accepted-evidence";
  }
  if (["source-proof", "hydration-proof", "source", "signed-source"].includes(normalized)) {
    return "source-proof";
  }
  if (["evidence-or-source-proof", "source-or-evidence", "any-proof", "fresh-proof"].includes(normalized)) {
    return "evidence-or-source-proof";
  }

  return "evidence-or-source-proof";
}

function buildSourceProofClaimSupport(claim, sourceProof, generatedAt) {
  const generatedMs = Date.parse(generatedAt);
  const proof = sourceProof && typeof sourceProof === "object" ? sourceProof : {};
  const hydration = proof.hydration && typeof proof.hydration === "object" ? proof.hydration : {};
  const observedMs = hydration.observedAt ? Date.parse(hydration.observedAt) : NaN;
  const issuedMs = hydration.issuedAt ? Date.parse(hydration.issuedAt) : NaN;
  const proofMs = Number.isFinite(observedMs) ? observedMs : issuedMs;
  const hydrationViolations = Array.isArray(hydration.violations) ? hydration.violations : [];
  const ageMs = Number.isFinite(proofMs) ? Math.max(0, generatedMs - proofMs) : null;
  const sourceMatches =
    !claim.sourceId ||
    claim.sourceId === "memory-runtime" ||
    !hydration.sourceId ||
    hydration.sourceId === "memory-runtime" ||
    hydration.sourceId === claim.sourceId;
  const hasProofTimestamp = Number.isFinite(proofMs);
  const violations = [];

  if (!proof.valid) {
    violations.push("current-state-claim-source-proof-invalid");
  }
  if (!hasProofTimestamp) {
    violations.push("current-state-claim-source-proof-timestamp-missing");
  }
  if (!sourceMatches) {
    violations.push("current-state-claim-source-proof-source-mismatch");
  }
  if (hydrationViolations.some((violation) => typeof violation === "string" && violation.endsWith("from-future"))) {
    violations.push("current-state-claim-source-proof-from-future");
  }
  if (ageMs !== null && ageMs > claim.ttlMs) {
    violations.push("current-state-claim-source-proof-stale");
  }

  return {
    sourceId: hydration.sourceId || null,
    observedAt: hydration.observedAt || hydration.issuedAt || null,
    ageMs,
    accepted: violations.length === 0,
    violations
  };
}

function buildCurrentStateClaimOperationalGuard(claim, policy, sourceProofSupport, proofAccepted, ageMs) {
  const degradedPolicy = policy?.degradedMode && typeof policy.degradedMode === "object" ? policy.degradedMode : {};
  const circuitBreaker = policy?.circuitBreaker && typeof policy.circuitBreaker === "object" ? policy.circuitBreaker : {};
  const sourceProofViolations = Array.isArray(sourceProofSupport?.violations) ? sourceProofSupport.violations : [];
  const sourceClockSkew = sourceProofViolations.some((violation) => violation.endsWith("from-future"));
  const scopeBlocking =
    !claim.scope.accepted || claim.scope.violations.some((violation) => violation.endsWith("-mismatch"));
  const staleBudgetMs = normalizeInteger(
    degradedPolicy.staleBudgetMs,
    DEFAULT_DEGRADED_STALE_BUDGET_MS,
    MIN_TTL_MS,
    MAX_DEGRADED_STALE_BUDGET_MS
  );
  const staleBudgetRemainingMs = ageMs === null ? null : Math.max(0, staleBudgetMs - ageMs);
  const fatalReasons = [];
  const degradedReasons = [];

  if (scopeBlocking) {
    fatalReasons.push("current-state-claim-scope-blocks-degraded-mode");
  }
  if (sourceClockSkew) {
    fatalReasons.push("current-state-claim-proof-clock-skew-blocks-degraded-mode");
  }
  if (policy?.failClosed) {
    fatalReasons.push("current-state-claim-policy-fail-closed");
  }
  if (!claim.allowStaleWithDegradedMode) {
    degradedReasons.push("current-state-claim-stale-degraded-mode-not-authorized");
  }
  if (degradedPolicy.enabled !== true) {
    degradedReasons.push("current-state-claim-degraded-mode-disabled");
  }
  if (degradedPolicy.allowStaleRead !== true) {
    degradedReasons.push("current-state-claim-stale-read-disabled");
  }
  if (circuitBreaker.open && !circuitBreaker.retryAfter) {
    degradedReasons.push("current-state-claim-refresh-circuit-open-without-retry-window");
  }
  if (ageMs === null) {
    degradedReasons.push("current-state-claim-age-unknown");
  } else if (ageMs > staleBudgetMs) {
    degradedReasons.push("current-state-claim-degraded-stale-budget-exceeded");
  }
  if (!proofAccepted) {
    degradedReasons.push("current-state-claim-fresh-proof-required");
  }
  if (!proofAccepted && claim.proofRequirement === "accepted-evidence") {
    degradedReasons.push("current-state-claim-accepted-evidence-still-required");
  }

  const allowDegradedExposure =
    fatalReasons.length === 0 &&
    degradedReasons.length === 0 &&
    claim.allowStaleWithDegradedMode &&
    ageMs !== null &&
    ageMs > claim.ttlMs;
  const action = allowDegradedExposure
    ? "serve-current-state-claim-with-degraded-warning"
    : fatalReasons.length > 0
      ? "block-current-state-claim-until-remediated"
      : "refresh-current-state-claim-proof";

  return {
    contract: "memory-freshness-gate.current-state-claim-operational-guard.v1",
    policy: {
      degradedModeEnabled: degradedPolicy.enabled === true,
      allowStaleRead: degradedPolicy.allowStaleRead === true,
      failClosed: policy?.failClosed === true,
      staleBudgetMs,
      staleBudgetRemainingMs,
      circuitOpen: circuitBreaker.open === true,
      circuitRetryAfter: circuitBreaker.retryAfter || null
    },
    allowDegradedExposure,
    action,
    route: allowDegradedExposure
      ? "memory-manager/hydrate-context/retry"
      : fatalReasons.length > 0
        ? "memory-manager/freshness-gate/current-state-claims"
        : "memory-manager/hydrate-context",
    retryable: fatalReasons.length === 0,
    retryAfter: circuitBreaker.retryAfter || null,
    fatalReasons,
    degradedReasons,
    blockingReasons: [...fatalReasons, ...(allowDegradedExposure ? [] : degradedReasons)]
  };
}

function buildCurrentStateClaimProofRequest(
  claim,
  supportingEvidence,
  acceptedSupport,
  sourceProofSupport,
  proofAccepted,
  blocking,
  violations,
  operationalGuard
) {
  const supportingEvidenceIds = new Set(supportingEvidence.map((item) => item.id));
  const acceptedEvidenceIdSet = new Set(acceptedSupport.map((item) => item.id));
  const missingEvidenceIds = claim.evidenceIds.filter((id) => !supportingEvidenceIds.has(id));
  const unacceptedEvidenceIds = supportingEvidence
    .filter((item) => !acceptedEvidenceIdSet.has(item.id))
    .map((item) => item.id);
  const sourceProofMissing =
    claim.proofRequirement !== "accepted-evidence" &&
    (!sourceProofSupport.accepted || sourceProofSupport.violations.length > 0);
  const acceptedEvidenceMissing =
    claim.proofRequirement !== "source-proof" &&
    (claim.evidenceIds.length === 0 || acceptedSupport.length === 0);
  const primaryMissing = sourceProofMissing
    ? "source-proof"
    : acceptedEvidenceMissing
      ? "accepted-evidence"
      : missingEvidenceIds.length > 0
        ? "evidence-reference"
        : "none";

  return {
    contract: "memory-freshness-gate.current-state-claim-proof-request.v1",
    claimId: claim.id,
    topic: claim.topic,
    sourceId: claim.sourceId,
    statementPreview: claim.statement || null,
    route: operationalGuard.route,
    action: operationalGuard.action,
    required: blocking,
    retryable: operationalGuard.retryable,
    retryAfter: operationalGuard.retryAfter,
    proofRequirement: claim.proofRequirement,
    missing: {
      primary: primaryMissing,
      sourceProof: sourceProofMissing
        ? {
            sourceId: claim.sourceId,
            maxAgeMs: claim.ttlMs,
            reason: sourceProofSupport.violations[0] || "current-state-claim-source-proof-required"
          }
        : null,
      acceptedEvidence:
        acceptedEvidenceMissing || missingEvidenceIds.length > 0 || unacceptedEvidenceIds.length > 0
          ? {
              requiredIds: claim.evidenceIds,
              missingIds: missingEvidenceIds,
              unacceptedIds: unacceptedEvidenceIds,
              acceptedIds: acceptedSupport.map((item) => item.id)
            }
          : null,
      observedAt: claim.observedAt ? null : "current-state-claim-missing-observed-at"
    },
    validationSummary: {
      accepted: violations.length === 0,
      proofAccepted,
      scopeAccepted: claim.scope.accepted,
      blocking,
      violationCodes: violations
    },
    acceptance: {
      canPreview: !blocking,
      canAccept: violations.length === 0,
      disposition:
        violations.length === 0
          ? "proof-request-satisfied"
          : blocking
            ? "proof-required-before-current-state-display"
            : "proof-refresh-recommended"
    },
    nextStep: {
      id: `collect-current-state-proof:${stableKeyPart(claim.id, "claim")}`,
      route: operationalGuard.route,
      required: blocking,
      reason: violations[0] || operationalGuard.action,
      action: operationalGuard.action
    }
  };
}

function normalizeClaimScope(value, state) {
  const scope =
    (value.scope && typeof value.scope === "object" && value.scope) ||
    (value.boundary && typeof value.boundary === "object" && value.boundary) ||
    {};
  const tenantId = firstString(value.tenantId, scope.tenantId, scope.tenant, value.accountId);
  const workspaceId = firstString(value.workspaceId, scope.workspaceId, scope.workspace, value.projectId);
  const principalId = firstString(value.principalId, value.subjectId, scope.principalId, scope.subjectId);
  const violations = [];

  if (!tenantId) {
    violations.push("current-state-claim-tenant-missing");
  } else if (state.tenantId && tenantId !== state.tenantId) {
    violations.push("current-state-claim-tenant-mismatch");
  }
  if (!workspaceId) {
    violations.push("current-state-claim-workspace-missing");
  } else if (state.workspaceId && workspaceId !== state.workspaceId) {
    violations.push("current-state-claim-workspace-mismatch");
  }
  if (principalId && state.principal.subjectId && principalId !== state.principal.subjectId) {
    violations.push("current-state-claim-principal-mismatch");
  }

  return {
    tenantId,
    workspaceId,
    principalId,
    canonicalTenantId: state.tenantId,
    canonicalWorkspaceId: state.workspaceId,
    canonicalPrincipalId: state.principal.subjectId,
    accepted: violations.length === 0,
    violations
  };
}

function normalizeCurrentStateClaim(value, index, generatedAt, state) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const statement = normalizeString(value.statement || value.text || value.claim || value.fact);
  const topic = normalizeString(value.topic || value.kind || value.domain) || "current-state";
  const observedAt = toIsoTimestamp(value.observedAt || value.timestamp || value.assertedAt || value.checkedAt, null);
  const ttlMs = normalizeInteger(
    value.ttlMs || value.maxAgeMs || value.freshnessTtlMs,
    Math.min(state.ttlMs, DEFAULT_VOLATILE_CLAIM_TTL_MS),
    MIN_TTL_MS,
    Math.min(MAX_TTL_MS, state.ttlMs)
  );
  const volatility = normalizeString(value.volatility || value.freshnessClass || value.stability)?.toLowerCase() || "volatile";
  const currentState =
    normalizeBoolean(value.currentState ?? value.isCurrentState ?? value.requiresFreshnessGate, null) ??
    ["volatile", "current", "realtime", "real-time", "latest", "live", "dynamic"].includes(volatility);

  if (!currentState && volatility !== "volatile") {
    return null;
  }

  return {
    id: normalizeString(value.id || value.claimId || value.key) || `current-state-claim-${index + 1}`,
    topic,
    statement,
    volatility,
    mode: normalizeClaimMode(value.mode || value.enforcement || value.required),
    proofRequirement: normalizeClaimProofRequirement(
      value.proofRequirement || value.proofPolicy || value.verification || value.freshnessProof
    ),
    scope: normalizeClaimScope(value, state),
    observedAt,
    ttlMs,
    sourceId: normalizeString(value.sourceId || value.source || value.provider) || "memory-runtime",
    evidenceIds: normalizeStringList(value.evidenceIds || value.evidenceId || value.proofIds || value.proofId),
    allowStaleWithDegradedMode: normalizeBoolean(value.allowStaleWithDegradedMode ?? value.allowStale, false)
  };
}

function collectCurrentStateClaims(input, state, generatedAt) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const requestedMemory = request.memory && typeof request.memory === "object" ? request.memory : {};
  const memoryState = input.memoryState && typeof input.memoryState === "object" ? input.memoryState : {};
  const runtimeMemory = memoryState.memory && typeof memoryState.memory === "object" ? memoryState.memory : memoryState;
  const candidates = [
    input.currentStateClaims,
    input.volatileClaims,
    input.volatileFacts,
    request.currentStateClaims,
    request.volatileClaims,
    requestedMemory.currentStateClaims,
    requestedMemory.volatileClaims,
    runtimeMemory.currentStateClaims,
    runtimeMemory.volatileClaims
  ];
  const rawClaims = candidates.flatMap((candidate) =>
    Array.isArray(candidate) ? candidate : candidate && typeof candidate === "object" ? [candidate] : []
  );

  return rawClaims
    .map((claim, index) => normalizeCurrentStateClaim(claim, index, generatedAt, state))
    .filter(Boolean)
    .slice(0, MAX_VOLATILE_CLAIMS);
}

function evaluateCurrentStateClaimGate(claims, sourceProof, evidence, generatedAt, policy = null) {
  const generatedMs = Date.parse(generatedAt);
  const effectivePolicy = policy || normalizeOperationalPolicy({}, generatedAt);
  const acceptedEvidenceIds = new Set(sourceProof.acceptedEvidenceIds);
  const evidenceById = evidence.reduce((index, item) => {
    index[item.id] = item;
    return index;
  }, {});
  const decisions = claims.map((claim) => {
    const claimObservedMs = claim.observedAt ? Date.parse(claim.observedAt) : NaN;
    const sourceProofSupport = buildSourceProofClaimSupport(claim, sourceProof, generatedAt);
    const supportingEvidence = claim.evidenceIds.map((id) => evidenceById[id]).filter(Boolean);
    const acceptedSupport = supportingEvidence.filter((item) => acceptedEvidenceIds.has(item.id));
    const latestSupportMs = acceptedSupport.reduce((latest, item) => {
      const observedMs = item.observedAt ? Date.parse(item.observedAt) : NaN;
      return Number.isFinite(observedMs) ? Math.max(latest, observedMs) : latest;
    }, Number.NEGATIVE_INFINITY);
    const sourceProofMs = sourceProofSupport.observedAt ? Date.parse(sourceProofSupport.observedAt) : NaN;
    const proofMs = Number.isFinite(latestSupportMs)
      ? latestSupportMs
      : Number.isFinite(sourceProofMs)
        ? sourceProofMs
        : claimObservedMs;
    const ageMs = Number.isFinite(proofMs) ? Math.max(0, generatedMs - proofMs) : null;
    const evidenceProofAccepted = acceptedSupport.length > 0;
    const sourceProofAccepted = sourceProofSupport.accepted;
    const proofAccepted =
      claim.proofRequirement === "accepted-evidence"
        ? evidenceProofAccepted
        : claim.proofRequirement === "source-proof"
          ? sourceProofAccepted
          : evidenceProofAccepted || sourceProofAccepted;
    const proofViolations =
      claim.proofRequirement === "accepted-evidence"
        ? evidenceProofAccepted
          ? []
          : ["current-state-claim-accepted-evidence-required"]
        : claim.proofRequirement === "source-proof"
          ? sourceProofAccepted
            ? []
            : sourceProofSupport.violations.length > 0
              ? sourceProofSupport.violations
              : ["current-state-claim-source-proof-required"]
          : proofAccepted
            ? []
            : [
                "current-state-claim-fresh-proof-required",
                ...sourceProofSupport.violations.filter(
                  (violation) => violation !== "current-state-claim-source-proof-invalid"
                )
              ];
    const violations = [];

    if (!claim.observedAt || !Number.isFinite(claimObservedMs)) {
      violations.push("current-state-claim-missing-observed-at");
    } else if (claimObservedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS) {
      violations.push("current-state-claim-from-future");
    }
    if (supportingEvidence.length < claim.evidenceIds.length) {
      violations.push("current-state-claim-evidence-missing");
    }
    if (claim.evidenceIds.length > 0 && acceptedSupport.length === 0) {
      violations.push("current-state-claim-evidence-unaccepted");
    }
    violations.push(...claim.scope.violations);
    violations.push(...proofViolations);
    if (ageMs !== null && ageMs > claim.ttlMs) {
      violations.push("current-state-claim-stale");
    }

    const accepted = violations.length === 0;
    const scopeAccepted = claim.scope.accepted;
    const scopeBlocking = !scopeAccepted || claim.scope.violations.some((violation) => violation.endsWith("-mismatch"));
    const operationalGuard = buildCurrentStateClaimOperationalGuard(
      claim,
      effectivePolicy,
      sourceProofSupport,
      proofAccepted,
      ageMs
    );
    const blocking =
      !accepted &&
      (scopeBlocking || (claim.mode === "block" && !operationalGuard.allowDegradedExposure));
    const normalizedViolations = [...new Set([...violations, ...(blocking ? operationalGuard.blockingReasons : [])])];
    const proofRequest = buildCurrentStateClaimProofRequest(
      claim,
      supportingEvidence,
      acceptedSupport,
      sourceProofSupport,
      proofAccepted,
      blocking,
      normalizedViolations,
      operationalGuard
    );

    return {
      ...claim,
      ageMs,
      expiresAt: Number.isFinite(proofMs) ? new Date(proofMs + claim.ttlMs).toISOString() : null,
      acceptedEvidenceIds: acceptedSupport.map((item) => item.id),
      proofRequirement: claim.proofRequirement,
      proofAccepted,
      operationalGuard,
      proofSources: {
        acceptedEvidence: acceptedSupport.map((item) => ({
          id: item.id,
          sourceId: item.sourceId,
          observedAt: item.observedAt,
          checksum: item.checksum,
          confidence: item.confidence
        })),
        sourceProof: sourceProofSupport
      },
      preview: {
        contract: "memory-freshness-gate.current-state-claim-preview.v1",
        claimId: claim.id,
        topic: claim.topic,
        displayState: accepted ? "visible" : blocking ? "hidden-until-proof" : "visible-with-warning",
        statement: accepted || !blocking ? claim.statement : null,
        redacted: blocking,
        proofRequest
      },
      proofRequest,
      validationSummary: proofRequest.validationSummary,
      scopeAccepted,
      accepted,
      blocking,
      violations: normalizedViolations,
      disposition: accepted
        ? "current-state-claim-fresh"
        : blocking
          ? "current-state-claim-blocked"
          : "current-state-claim-degraded"
    };
  });
  const blockingDecisions = decisions.filter((decision) => decision.blocking);
  const degradedDecisions = decisions.filter((decision) => !decision.accepted && !decision.blocking);
  const scopeDeniedDecisions = decisions.filter((decision) => !decision.scopeAccepted);
  const exposure = buildCurrentStateClaimExposure(decisions, generatedAt);

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.current-state-claims.v1",
    generatedAt,
    retainedClaims: decisions.length,
    maxClaims: MAX_VOLATILE_CLAIMS,
    acceptedClaims: decisions.filter((decision) => decision.accepted).length,
    degradedClaims: degradedDecisions.length,
    blockingClaims: blockingDecisions.length,
    scopeDeniedClaims: scopeDeniedDecisions.length,
    decisions,
    exposure,
    blocking: blockingDecisions.length > 0,
    degraded: degradedDecisions.length > 0,
    violationCodes: [...new Set(decisions.flatMap((decision) => decision.violations))],
    auditDisposition:
      blockingDecisions.length > 0
        ? "current-state-claim-gate-blocked"
        : degradedDecisions.length > 0
          ? "current-state-claim-gate-degraded"
          : decisions.length > 0
            ? "current-state-claim-gate-accepted"
            : "current-state-claim-gate-not-requested"
  };
}

function buildCurrentStateClaimExposure(decisions, generatedAt) {
  const items = decisions.map((decision) => {
    const freshnessStatus = decision.accepted
      ? "fresh"
      : decision.blocking
        ? "unavailable"
        : "stale-warning";
    const exposeStatement = decision.accepted || !decision.blocking;

    return {
      id: decision.id,
      topic: decision.topic,
      sourceId: decision.sourceId,
      scope: {
        tenantId: decision.scope.tenantId,
        workspaceId: decision.scope.workspaceId,
        principalId: decision.scope.principalId,
        accepted: decision.scopeAccepted,
        violations: decision.scope.violations
      },
      freshnessStatus,
      exposure:
        freshnessStatus === "fresh"
          ? "usable"
          : freshnessStatus === "stale-warning"
            ? "usable-with-warning"
            : "redacted",
      statement: exposeStatement ? decision.statement : null,
      redacted: !exposeStatement,
      redactionReason: exposeStatement ? null : decision.violations[0] || "current-state-claim-unverified",
      preview: decision.preview,
      proofRequest: decision.proofRequest,
      validationSummary: decision.validationSummary,
      warning:
        freshnessStatus === "stale-warning"
          ? {
              code: "CURRENT_STATE_CLAIM_STALE_OR_UNVERIFIED",
              violations: decision.violations,
              action: decision.operationalGuard.action,
              route: decision.operationalGuard.route,
              retryAfter: decision.operationalGuard.retryAfter,
              ageMs: decision.ageMs,
              ttlMs: decision.ttlMs,
              expiresAt: decision.expiresAt
            }
          : null,
      proof: {
        requirement: decision.proofRequirement,
        accepted: decision.proofAccepted,
        observedAt: decision.observedAt,
        ageMs: decision.ageMs,
        ttlMs: decision.ttlMs,
        expiresAt: decision.expiresAt,
        scopeAccepted: decision.scopeAccepted,
        operationalGuard: decision.operationalGuard,
        acceptedEvidenceIds: decision.acceptedEvidenceIds,
        acceptedEvidence: decision.proofSources.acceptedEvidence,
        sourceProof: decision.proofSources.sourceProof,
        proofRequest: decision.proofRequest,
        violations: decision.violations
      }
    };
  });
  const redactedIds = items.filter((item) => item.redacted).map((item) => item.id);
  const warningIds = items.filter((item) => item.exposure === "usable-with-warning").map((item) => item.id);

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.current-state-claim-exposure.v1",
    generatedAt,
    policy: "redact-blocking-current-state-claims",
    usable: items.filter((item) => item.exposure === "usable").length,
    usableWithWarning: warningIds.length,
    redacted: redactedIds.length,
    redactedIds,
    warningIds,
    items,
    auditDisposition:
      redactedIds.length > 0
        ? "current-state-claim-exposure-redacted"
        : warningIds.length > 0
          ? "current-state-claim-exposure-warning"
          : items.length > 0
            ? "current-state-claim-exposure-usable"
            : "current-state-claim-exposure-empty"
  };
}

function buildCurrentStateClaimClientHandoff(exposure, runtime, health, generatedAt) {
  const items = Array.isArray(exposure?.items) ? exposure.items : [];
  const redactedItems = items.filter((item) => item.redacted);
  const warningItems = items.filter((item) => item.exposure === "usable-with-warning");
  const actionableItems = [...redactedItems, ...warningItems];
  const status =
    redactedItems.length > 0
      ? "blocked"
      : warningItems.length > 0
        ? "warning"
        : items.length > 0
          ? "clear"
          : "not-requested";
  const route =
    redactedItems.length > 0
      ? "memory-manager/freshness-gate/current-state-claims"
      : warningItems.length > 0
        ? "memory-manager/hydrate-context/retry"
        : runtime.preferredRoute || "memory-manager/freshness-gate";
  const requiredAction =
    redactedItems.length > 0
      ? "verify-current-state-claims"
      : warningItems.length > 0
        ? "refresh-current-state-claims-in-background"
        : "none";
  const claimActions = actionableItems.map((item) => {
    const proof = item.proof && typeof item.proof === "object" ? item.proof : {};
    const guard =
      proof.operationalGuard && typeof proof.operationalGuard === "object"
        ? proof.operationalGuard
        : {};
    const primaryViolation = item.redactionReason || proof.violations?.[0] || "current-state-claim-warning";
    const claimRoute =
      normalizeString(guard.route) ||
      (item.redacted
        ? "memory-manager/freshness-gate/current-state-claims"
        : "memory-manager/hydrate-context/retry");

    return {
      id: `current-state-claim:${stableKeyPart(item.id, "claim")}`,
      claimId: item.id,
      topic: item.topic,
      sourceId: item.sourceId,
      route: claimRoute,
      required: item.redacted,
      action:
        normalizeString(guard.action) ||
        (item.redacted ? "collect-fresh-proof-before-display" : "schedule-background-proof-refresh"),
      status: item.redacted ? "pending-proof" : guard.allowDegradedExposure ? "degraded-serving" : "warning",
      reason: primaryViolation,
      blockingReasons: guard.blockingReasons || [],
      proofRequirement: proof.requirement || null,
      proofRequest: item.proofRequest || proof.proofRequest || null,
      acceptedEvidenceIds: proof.acceptedEvidenceIds || [],
      retryAfter: guard.retryAfter || (item.redacted ? null : health.retry.nextRetryAt),
      expiresAt: proof.expiresAt || null
    };
  });

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.current-state-claim-client-handoff.v1",
    generatedAt,
    status,
    route,
    requiredAction,
    blocking: redactedItems.length > 0 && runtime.acceptsBlockingHandoff,
    notificationLevel:
      redactedItems.length > 0
        ? "blocking"
        : warningItems.length > 0 && runtime.supportsUserNotification
          ? "inline"
          : "silent",
    summary: {
      observedClaims: items.length,
      redactedClaims: redactedItems.length,
      warningClaims: warningItems.length,
      usableClaims: items.filter((item) => item.exposure === "usable").length,
      redactedIds: redactedItems.map((item) => item.id),
      warningIds: warningItems.map((item) => item.id)
    },
    statePatch: {
      exposureContract: exposure?.contract || "memory-freshness-gate.current-state-claim-exposure.v1",
      policy: exposure?.policy || "redact-blocking-current-state-claims",
      status,
      route,
      requiredAction,
      redactedIds: redactedItems.map((item) => item.id),
      warningIds: warningItems.map((item) => item.id),
      claimActions
    },
    claimActions,
    auditDisposition:
      redactedItems.length > 0
        ? "current-state-claim-client-handoff-blocking"
        : warningItems.length > 0
          ? "current-state-claim-client-handoff-warning"
          : items.length > 0
            ? "current-state-claim-client-handoff-clear"
            : "current-state-claim-client-handoff-empty"
  };
}

function buildCurrentStateClaimReadinessSteps(freshness, handoff) {
  const exposure = freshness.currentStateClaimGate.exposure;
  const actions = Array.isArray(exposure?.items)
    ? exposure.items.filter((item) => item.redacted || item.exposure === "usable-with-warning")
    : [];

  return actions.map((item) => {
    const redacted = item.redacted === true;
    const proof = item.proof && typeof item.proof === "object" ? item.proof : {};

    return {
      id: `verify-current-state-claim:${stableKeyPart(item.id, "claim")}`,
      label: redacted ? "Verify current-state claim" : "Refresh current-state proof",
      route:
        proof.operationalGuard?.route ||
        (redacted ? "memory-manager/freshness-gate/current-state-claims" : handoff.nextRoute),
      reason: redacted
        ? item.redactionReason || "current-state-claim-unverified"
        : item.warning?.code || "CURRENT_STATE_CLAIM_STALE_OR_UNVERIFIED",
      required: redacted,
      blockedBy: proof.operationalGuard?.blockingReasons || proof.violations || [],
      claimId: item.id,
      topic: item.topic,
      sourceId: item.sourceId,
      proofRequest: item.proofRequest || proof.proofRequest || null,
      retryAfter: proof.operationalGuard?.retryAfter || (redacted ? null : proof.expiresAt || null)
    };
  });
}

function evaluateFreshness(state, evidence, sourceProof, generatedAt, currentStateClaims = [], operationalPolicy = null) {
  const nowMs = Date.parse(generatedAt);
  const lastHydratedMs = state.lastHydratedAt ? Date.parse(state.lastHydratedAt) : NaN;
  const acceptedEvidenceIdSet = new Set(sourceProof.acceptedEvidenceIds);
  const acceptedEvidence = evidence.filter((item) => acceptedEvidenceIdSet.has(item.id));
  const currentStateClaimGate = evaluateCurrentStateClaimGate(
    currentStateClaims,
    sourceProof,
    evidence,
    generatedAt,
    operationalPolicy
  );
  const latestEvidenceMs = acceptedEvidence.reduce((latest, item) => {
    const observedMs = item.observedAt ? Date.parse(item.observedAt) : NaN;
    return Number.isFinite(observedMs) ? Math.max(latest, observedMs) : latest;
  }, Number.NEGATIVE_INFINITY);
  const hydrationFromFuture = sourceProof.hydration.violations.includes("hydration-timestamp-from-future");
  const hasHydration = Number.isFinite(lastHydratedMs) && !hydrationFromFuture;
  const hasEvidenceTimestamp = Number.isFinite(latestEvidenceMs);
  const sourceMs = hasEvidenceTimestamp
    ? Math.max(hasHydration ? lastHydratedMs : 0, latestEvidenceMs)
    : lastHydratedMs;
  const ageMs = Number.isFinite(sourceMs) && !hydrationFromFuture ? Math.max(0, nowMs - sourceMs) : null;
  const baseFresh = sourceProof.valid && ageMs !== null && ageMs <= state.ttlMs;
  const fresh = baseFresh && !currentStateClaimGate.blocking;
  const reason = fresh
    ? (hasHydration ? "within-ttl" : "evidence-within-ttl")
    : currentStateClaimGate.blocking
      ? "volatile-current-state-claim-unverified"
    : !sourceProof.valid
      ? "source-proof-invalid"
      : hasHydration
      ? "ttl-expired"
      : "missing-hydration";

  return {
    fresh,
    reason,
    ageMs,
    expiresAt: Number.isFinite(sourceMs) ? new Date(sourceMs + state.ttlMs).toISOString() : null,
    evidenceCount: evidence.length,
    acceptedEvidenceCount: acceptedEvidence.length,
    rejectedEvidenceCount: sourceProof.rejectedEvidenceCount,
    latestEvidenceAt: Number.isFinite(latestEvidenceMs) ? new Date(latestEvidenceMs).toISOString() : null,
    currentStateClaimGate
  };
}

function severityRank(severity) {
  return severity === "fatal" ? 3 : severity === "degraded" ? 2 : severity === "warning" ? 1 : 0;
}

function buildOperationalResolutionPlan(state, freshness, retry, policy, dependencies, errors, generatedAt) {
  const persistenceKey = buildPersistenceKey(state);
  const generatedMs = Date.parse(generatedAt);
  const dependencyFindings = dependencies.map((dependency) => {
    const checkedMs = dependency.checkedAt ? Date.parse(dependency.checkedAt) : NaN;
    const status = dependency.status.toLowerCase();
    const healthy = ["ok", "ready", "healthy"].includes(status);
    const fromFuture = Number.isFinite(checkedMs) && checkedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS;
    const staleHealthCheck =
      Number.isFinite(checkedMs) && !fromFuture && generatedMs - checkedMs > Math.max(state.ttlMs, MIN_SCHEDULE_INTERVAL_MS);

    return {
      name: dependency.name,
      required: dependency.required,
      status: dependency.status,
      healthy,
      checkedAt: dependency.checkedAt,
      staleHealthCheck,
      fromFuture,
      message: dependency.message,
      finding: fromFuture
        ? "dependency-health-clock-skew"
        : !dependency.checkedAt
          ? "dependency-health-check-missing"
          : staleHealthCheck
            ? "dependency-health-check-stale"
            : healthy
              ? "dependency-ready"
              : "dependency-unhealthy"
    };
  });
  const validationFindings = dependencyFindings
    .filter((finding) => finding.required && (finding.fromFuture || finding.staleHealthCheck || !finding.checkedAt))
    .map((finding) => ({
      code: finding.finding.toUpperCase().replace(/-/g, "_"),
      severity: finding.fromFuture ? "fatal" : "degraded",
      target: finding.name,
      route: "memory-manager/freshness-gate/dependencies",
      message:
        finding.fromFuture
          ? "Required memory dependency health timestamp is beyond the hosted-kernel clock-skew allowance."
          : finding.staleHealthCheck
            ? "Required memory dependency health check is older than the freshness gate validation window."
            : "Required memory dependency did not report a health-check timestamp."
    }));
  const orderedErrors = [...errors].sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
  const primaryError = orderedErrors[0] || null;
  const retryBlocked =
    retry.exhausted ||
    errors.some((error) => error.retryable === false && error.severity === "fatal") ||
    validationFindings.some((finding) => finding.severity === "fatal");
  const retryEligible = !retryBlocked && errors.some((error) => error.retryable);
  const retryPlan = {
    state: retryBlocked ? "blocked" : retryEligible ? "scheduled" : freshness.fresh ? "not-needed" : "ready",
    route: retryEligible ? "memory-manager/hydrate-context/retry" : "memory-manager/hydrate-context",
    nextRetryAt: retryEligible ? retry.nextRetryAt : null,
    delayMs: retryEligible ? retry.delayMs : 0,
    attempts: retry.attempts,
    maxAttempts: retry.maxAttempts,
    exhausted: retry.exhausted,
    reason: primaryError?.code || retry.reason || freshness.reason
  };
  const operatorActions = orderedErrors.map((error, index) => ({
    id: `${persistenceKey}:op:${index + 1}:${stableKeyPart(error.code, "error")}`,
    code: error.code,
    severity: error.severity,
    route: OPERATIONAL_ERROR_ROUTES.get(error.code) || "memory-manager/freshness-failure",
    action: error.action,
    retryable: error.retryable,
    required: error.severity === "fatal",
    message: error.message
  }));
  const degradedServing = {
    eligible:
      policy.degradedMode.enabled &&
      policy.degradedMode.allowStaleRead &&
      !policy.failClosed &&
      !retry.exhausted &&
      freshness.ageMs !== null &&
      freshness.ageMs <= policy.degradedMode.staleBudgetMs &&
      !validationFindings.some((finding) => finding.severity === "fatal"),
    staleBudgetMs: policy.degradedMode.staleBudgetMs,
    staleBudgetRemainingMs:
      freshness.ageMs === null ? null : Math.max(0, policy.degradedMode.staleBudgetMs - freshness.ageMs),
    userVisible: policy.degradedMode.userVisible,
    reason: primaryError?.code || (freshness.fresh ? "fresh-memory-available" : freshness.reason)
  };

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.operational-resolution.v1",
    generatedAt,
    incidentId: `${persistenceKey}:incident:${stableKeyPart(primaryError?.code || "healthy", "status")}:${generatedAt}`,
    status: primaryError ? (primaryError.severity === "fatal" ? "action-required" : "watch") : "clear",
    primaryErrorCode: primaryError?.code || null,
    primaryRoute: primaryError ? OPERATIONAL_ERROR_ROUTES.get(primaryError.code) || "memory-manager/freshness-failure" : state.route,
    validationFindings,
    dependencyFindings,
    retryPlan,
    degradedServing,
    operatorActions,
    clientMessage:
      primaryError?.message ||
      (freshness.fresh ? "Memory freshness gate is healthy." : "Memory context needs refresh before continuing."),
    auditDisposition: primaryError
      ? primaryError.severity === "fatal"
        ? "operational-resolution-blocking"
        : "operational-resolution-degraded"
      : "operational-resolution-clear"
  };
}

function evaluateOperationalHealth(input, state, freshness, boundary, recovered, sourceProof, generatedAt) {
  const dependencies = normalizeDependencyHealth(input);
  const retry = normalizeRetryState(input, generatedAt);
  const policy = normalizeOperationalPolicy(input, generatedAt);
  const persistedCheckedMs = recovered.checkedAt ? Date.parse(recovered.checkedAt) : NaN;
  const generatedMs = Date.parse(generatedAt);
  const recoveredSnapshotAgeMs =
    Number.isFinite(persistedCheckedMs) && Number.isFinite(generatedMs)
      ? Math.max(0, generatedMs - persistedCheckedMs)
      : null;
  const failedDependencies = dependencies.filter(
    (dependency) => dependency.required && !["ok", "ready", "healthy"].includes(dependency.status.toLowerCase())
  );
  const requiredDependencies = dependencies.filter((dependency) => dependency.required);
  const healthyRequiredDependencies = requiredDependencies.filter((dependency) =>
    ["ok", "ready", "healthy"].includes(dependency.status.toLowerCase())
  );
  const dependencyQuorumMet =
    policy.minHealthyRequiredDependencies === 0 ||
    healthyRequiredDependencies.length >= policy.minHealthyRequiredDependencies;
  const staleBudgetRemainingMs =
    freshness.ageMs === null ? null : Math.max(0, policy.degradedMode.staleBudgetMs - freshness.ageMs);
  const staleBudgetExceeded =
    !freshness.fresh &&
    freshness.ageMs !== null &&
    freshness.ageMs > policy.degradedMode.staleBudgetMs;
  const errors = [];

  if (boundary.violations.length > 0) {
    errors.push({
      code: "MEMORY_BOUNDARY_INVALID",
      severity: "fatal",
      retryable: false,
      message: "Memory freshness cannot be evaluated until tenant, workspace, principal, and read permission are valid.",
      action: "repair-request-boundary",
      details: { violations: boundary.violations }
    });
  }

  if (!state.lifecycle.accepted) {
    errors.push({
      code: "MEMORY_LIFECYCLE_SETTINGS_INVALID",
      severity: "fatal",
      retryable: false,
      message: "Memory freshness lifecycle settings were rejected by hosted-kernel validation.",
      action: "repair-lifecycle-settings",
      details: {
        disposition: state.lifecycle.auditDisposition,
        validation: state.lifecycle.validation
      }
    });
  }

  if (!sourceProof.valid) {
    errors.push({
      code: "MEMORY_SOURCE_PROOF_INVALID",
      severity: sourceProof.hydration.violations.some((violation) => violation.endsWith("from-future")) ? "fatal" : "degraded",
      retryable: true,
      message: "Memory freshness source proof failed hosted-kernel validation.",
      action: "rehydrate-with-valid-source-proof",
      details: {
        disposition: sourceProof.auditDisposition,
        hydrationViolations: sourceProof.hydration.violations,
        rejectedEvidenceCount: sourceProof.rejectedEvidenceCount
      }
    });
  }

  if (failedDependencies.length > 0) {
    errors.push({
      code: "MEMORY_DEPENDENCY_UNHEALTHY",
      severity: policy.failClosed ? "fatal" : "degraded",
      retryable: true,
      message: "One or more required memory dependencies are not healthy.",
      action: retry.exhausted ? "escalate-memory-runtime" : "retry-after-backoff",
      details: {
        dependencies: failedDependencies.map((dependency) => ({
          name: dependency.name,
          status: dependency.status,
          checkedAt: dependency.checkedAt,
          message: dependency.message
        }))
      }
    });
  }

  if (!dependencyQuorumMet) {
    errors.push({
      code: "MEMORY_DEPENDENCY_QUORUM_UNMET",
      severity: policy.failClosed ? "fatal" : "degraded",
      retryable: true,
      message: "Required memory dependency quorum is below the hosted-kernel policy threshold.",
      action: "restore-memory-dependency-quorum",
      details: {
        minHealthyRequiredDependencies: policy.minHealthyRequiredDependencies,
        healthyRequiredDependencies: healthyRequiredDependencies.length,
        requiredDependencies: requiredDependencies.length
      }
    });
  }

  if (policy.circuitBreaker.open) {
    errors.push({
      code: "MEMORY_REFRESH_CIRCUIT_OPEN",
      severity: policy.failClosed ? "fatal" : "degraded",
      retryable: !retry.exhausted,
      message: "Memory refresh circuit breaker is open for this hosted-kernel surface.",
      action: policy.circuitBreaker.retryAfter ? "wait-for-circuit-retry-window" : "reset-memory-refresh-circuit",
      details: {
        state: policy.circuitBreaker.state,
        consecutiveFailures: policy.circuitBreaker.consecutiveFailures,
        failureThreshold: policy.circuitBreaker.failureThreshold,
        retryAfter: policy.circuitBreaker.retryAfter,
        reason: policy.circuitBreaker.reason
      }
    });
  }

  if (staleBudgetExceeded) {
    errors.push({
      code: "MEMORY_DEGRADED_STALE_BUDGET_EXCEEDED",
      severity: "fatal",
      retryable: !retry.exhausted,
      message: "Memory context is older than the degraded-mode stale-read budget.",
      action: "force-memory-rehydration-before-response",
      details: {
        ageMs: freshness.ageMs,
        staleBudgetMs: policy.degradedMode.staleBudgetMs,
        staleSince: freshness.expiresAt
      }
    });
  }

  if (!freshness.fresh && retry.cooldownActive) {
    errors.push({
      code: "MEMORY_REFRESH_RETRY_COOLDOWN_ACTIVE",
      severity: "degraded",
      retryable: true,
      message: "Memory refresh is waiting for an explicit retry-after window.",
      action: "wait-for-retry-window",
      details: {
        nextRetryAt: retry.nextRetryAt,
        attempts: retry.attempts,
        reason: retry.reason
      }
    });
  }

  if (!freshness.fresh && retry.exhausted) {
    errors.push({
      code: "MEMORY_REFRESH_RETRY_EXHAUSTED",
      severity: "fatal",
      retryable: false,
      message: "Memory context is stale and refresh retry attempts are exhausted.",
      action: "surface-actionable-refresh-failure",
      details: {
        attempts: retry.attempts,
        maxAttempts: retry.maxAttempts,
        reason: freshness.reason,
        staleSince: freshness.expiresAt
      }
    });
  }

  if (recovered.status === "fresh" && !recovered.restartSafe) {
    errors.push({
      code: "MEMORY_PERSISTED_FRESHNESS_UNSAFE",
      severity: "degraded",
      retryable: true,
      message: "Recovered freshness state is not safe to trust after restart.",
      action: "rehydrate-before-response",
      details: {
        recoveredStatus: recovered.status,
        recoveredSnapshotAgeMs,
        recoveredReason: recovered.reason
      }
    });
  }

  if (freshness.currentStateClaimGate.blocking || freshness.currentStateClaimGate.degraded) {
    errors.push({
      code: "MEMORY_VOLATILE_CLAIM_UNVERIFIED",
      severity: freshness.currentStateClaimGate.blocking || policy.failClosed ? "fatal" : "degraded",
      retryable: true,
      message: "A volatile current-state memory claim requires fresher source proof before it can be used.",
      action: freshness.currentStateClaimGate.blocking
        ? "refresh-current-state-claim-before-response"
        : "refresh-current-state-claim-in-background",
      details: {
        auditDisposition: freshness.currentStateClaimGate.auditDisposition,
        retainedClaims: freshness.currentStateClaimGate.retainedClaims,
        blockingClaims: freshness.currentStateClaimGate.blockingClaims,
        degradedClaims: freshness.currentStateClaimGate.degradedClaims,
        violationCodes: freshness.currentStateClaimGate.violationCodes
      }
    });
  }

  const operationalResolution = buildOperationalResolutionPlan(
    state,
    freshness,
    retry,
    policy,
    dependencies,
    errors,
    generatedAt
  );
  const fatal =
    errors.some((error) => error.severity === "fatal") ||
    operationalResolution.validationFindings.some((finding) => finding.severity === "fatal");
  const degraded =
    !fatal &&
    (errors.length > 0 ||
      failedDependencies.length > 0 ||
      operationalResolution.validationFindings.some((finding) => finding.severity === "degraded"));
  const degradedModeActive =
    degraded &&
    policy.degradedMode.enabled &&
    policy.degradedMode.allowStaleRead &&
    !staleBudgetExceeded &&
    boundary.allowed &&
    state.lifecycle.accepted &&
    state.lifecycle.effective.enabled &&
    !sourceProof.hydration.violations.some((violation) => violation.endsWith("from-future"));

  return {
    status: fatal ? "failed" : degraded ? "degraded" : "healthy",
    degraded,
    retryable: !fatal && (failedDependencies.length > 0 || !freshness.fresh || policy.circuitBreaker.open),
    policy,
    degradedMode: {
      active: degradedModeActive,
      allowStaleRead: degradedModeActive,
      reason: degradedModeActive
        ? policy.circuitBreaker.open
          ? "refresh-circuit-open"
          : failedDependencies.length > 0 || !dependencyQuorumMet
            ? "dependency-health-degraded"
            : retry.cooldownActive
              ? "retry-cooldown-active"
              : "freshness-revalidation-degraded"
        : fatal
          ? "failure-state-blocks-degraded-mode"
          : policy.degradedMode.enabled
            ? "not-needed"
            : "disabled-by-policy",
      staleBudgetMs: policy.degradedMode.staleBudgetMs,
      staleBudgetRemainingMs,
      userVisible: policy.degradedMode.userVisible,
      circuitBreaker: policy.circuitBreaker
    },
    dependencies,
    retry,
    recoveredSnapshotAgeMs,
    operationalResolution,
    failureState: {
      failed: fatal,
      codes: [
        ...errors.map((error) => error.code),
        ...operationalResolution.validationFindings.map((finding) => finding.code)
      ],
      primaryAction:
        operationalResolution.operatorActions[0]?.action ||
        errors[0]?.action ||
        (freshness.fresh ? "continue" : "refresh-memory-before-response"),
      primaryRoute: operationalResolution.primaryRoute,
      incidentId: operationalResolution.incidentId
    },
    actionableErrors: errors
  };
}

function normalizeAnalyticsCounter(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function normalizeAnalyticsDuration(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
}

function incrementCounterMap(map, key, amount = 1) {
  const normalizedKey = normalizeString(key) || "unknown";
  map[normalizedKey] = normalizeAnalyticsCounter(map[normalizedKey]) + normalizeAnalyticsCounter(amount || 1);
  return map;
}

function csvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeAnalyticsHistory(input) {
  const analytics =
    (input.analytics && typeof input.analytics === "object" && input.analytics) ||
    (input.metrics && typeof input.metrics === "object" && input.metrics) ||
    {};
  const freshnessAnalytics =
    (analytics.freshnessGate && typeof analytics.freshnessGate === "object" && analytics.freshnessGate) ||
    (analytics.memoryFreshness && typeof analytics.memoryFreshness === "object" && analytics.memoryFreshness) ||
    analytics;
  const history = Array.isArray(freshnessAnalytics.history)
    ? freshnessAnalytics.history
    : Array.isArray(input.freshnessHistory)
      ? input.freshnessHistory
      : [];

  return {
    counters: freshnessAnalytics.counters && typeof freshnessAnalytics.counters === "object"
      ? freshnessAnalytics.counters
      : {},
    history: history
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        sequence: normalizeAnalyticsCounter(item.sequence || index + 1),
        checkedAt: toIsoTimestamp(item.checkedAt || item.generatedAt || item.timestamp, null),
        requestId: normalizeString(item.requestId),
        route: normalizeString(item.route) || "memory-manager/freshness-gate",
        status: normalizeString(item.status) || "unknown",
        reason: normalizeString(item.reason),
        ageMs: normalizeAnalyticsDuration(item.ageMs),
        ttlMs: normalizeAnalyticsDuration(item.ttlMs),
        expiresAt: toIsoTimestamp(item.expiresAt, null),
        retryable: item.retryable === true,
        degradedModeActive: item.degradedModeActive === true,
        degradedModeReason: normalizeString(item.degradedModeReason),
        staleBudgetRemainingMs: normalizeAnalyticsDuration(item.staleBudgetRemainingMs),
        failureCodes: normalizeStringList(item.failureCodes)
      }))
      .filter((item) => item.checkedAt)
      .slice(-MAX_ANALYTICS_HISTORY)
  };
}

function buildAnalyticsReportingState(history, counters, generatedAt) {
  const statusCounts = {};
  const reasonCounts = {};
  const routeCounts = {};
  const failureCodeCounts = {};
  const actionableRoutes = {};
  const ageSamples = [];
  let retryableSnapshots = 0;
  let degradedSnapshots = 0;
  let latestFailureAt = null;
  let latestStaleAt = null;

  for (const snapshot of history) {
    incrementCounterMap(statusCounts, snapshot.status);
    incrementCounterMap(reasonCounts, snapshot.reason);
    incrementCounterMap(routeCounts, snapshot.route);

    if (snapshot.retryable) {
      retryableSnapshots += 1;
    }
    if (snapshot.degradedModeActive) {
      degradedSnapshots += 1;
    }
    if (snapshot.status === "failed" || snapshot.status === "blocked") {
      latestFailureAt = snapshot.checkedAt;
    }
    if (snapshot.status === "stale") {
      latestStaleAt = snapshot.checkedAt;
    }
    if (snapshot.operationalRoute) {
      incrementCounterMap(actionableRoutes, snapshot.operationalRoute);
    }
    for (const code of snapshot.failureCodes || []) {
      incrementCounterMap(failureCodeCounts, code);
    }
    if (snapshot.ageMs !== null && snapshot.ageMs !== undefined) {
      ageSamples.push(snapshot.ageMs);
    }
  }

  const totalSnapshots = history.length;
  const freshSnapshots = normalizeAnalyticsCounter(statusCounts.fresh);
  const staleSnapshots = normalizeAnalyticsCounter(statusCounts.stale);
  const failedSnapshots = normalizeAnalyticsCounter(statusCounts.failed);
  const blockedSnapshots = normalizeAnalyticsCounter(statusCounts.blocked);
  const ageTotalMs = ageSamples.reduce((total, ageMs) => total + ageMs, 0);
  const oldestAgeMs = ageSamples.length > 0 ? Math.max(...ageSamples) : null;
  const averageAgeMs = ageSamples.length > 0 ? Math.round(ageTotalMs / ageSamples.length) : null;
  const unhealthySnapshots = failedSnapshots + blockedSnapshots;
  const dominantStatus = Object.entries(statusCounts).sort((left, right) => right[1] - left[1])[0]?.[0] || "unknown";
  const dominantFailureCode =
    Object.entries(failureCodeCounts).sort((left, right) => right[1] - left[1])[0]?.[0] || null;

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.analytics-reporting.v1",
    generatedAt,
    window: {
      retainedSnapshots: totalSnapshots,
      firstSnapshotAt: history[0]?.checkedAt || generatedAt,
      lastSnapshotAt: history[totalSnapshots - 1]?.checkedAt || generatedAt,
      maxSnapshots: MAX_ANALYTICS_HISTORY
    },
    rollups: {
      statusCounts,
      reasonCounts,
      routeCounts,
      failureCodeCounts,
      actionableRoutes,
      retryableSnapshots,
      degradedSnapshots,
      averageAgeMs,
      oldestAgeMs,
      freshRatio: totalSnapshots > 0 ? freshSnapshots / totalSnapshots : 0,
      staleRatio: totalSnapshots > 0 ? staleSnapshots / totalSnapshots : 0,
      unhealthyRatio: totalSnapshots > 0 ? unhealthySnapshots / totalSnapshots : 0
    },
    trend: {
      dominantStatus,
      dominantFailureCode,
      latestFailureAt,
      latestStaleAt,
      totalDecisions: counters.totalDecisions,
      freshnessDebt:
        staleSnapshots + failedSnapshots + blockedSnapshots > freshSnapshots
          ? "accumulating"
          : staleSnapshots > 0 || failedSnapshots > 0 || blockedSnapshots > 0
            ? "intermittent"
            : "clear"
    },
    exportRows: history.map((snapshot) => ({
      checkedAt: snapshot.checkedAt,
      requestId: snapshot.requestId,
      clientId: snapshot.clientId,
      conversationId: snapshot.conversationId,
      route: snapshot.route,
      status: snapshot.status,
      reason: snapshot.reason,
      ageMs: snapshot.ageMs,
      ttlMs: snapshot.ttlMs,
      expiresAt: snapshot.expiresAt,
      retryable: snapshot.retryable,
      degradedModeActive: snapshot.degradedModeActive,
      failureCodes: snapshot.failureCodes,
      operationalRoute: snapshot.operationalRoute,
      operationalIncidentId: snapshot.operationalIncidentId
    }))
  };
}

function buildFreshnessAnalytics(input, state, freshness, boundary, health, recovered, evidence, sourceProof, generatedAt) {
  const prior = normalizeAnalyticsHistory(input);
  const status = !boundary.allowed
    ? "blocked"
    : health.status === "failed"
      ? "failed"
      : freshness.fresh
        ? "fresh"
        : "stale";
  const outcomeKey = `${status}Decisions`;
  const stale = !freshness.fresh && boundary.allowed;
  const dependencyFailures = health.dependencies.filter(
    (dependency) => dependency.required && !["ok", "ready", "healthy"].includes(dependency.status.toLowerCase())
  );
  const counters = {
    totalDecisions: normalizeAnalyticsCounter(prior.counters.totalDecisions) + 1,
    freshDecisions: normalizeAnalyticsCounter(prior.counters.freshDecisions) + (status === "fresh" ? 1 : 0),
    staleDecisions: normalizeAnalyticsCounter(prior.counters.staleDecisions) + (stale ? 1 : 0),
    blockedDecisions: normalizeAnalyticsCounter(prior.counters.blockedDecisions) + (status === "blocked" ? 1 : 0),
    failedDecisions: normalizeAnalyticsCounter(prior.counters.failedDecisions) + (status === "failed" ? 1 : 0),
    degradedDecisions: normalizeAnalyticsCounter(prior.counters.degradedDecisions) + (health.degraded ? 1 : 0),
    degradedModeContinuations:
      normalizeAnalyticsCounter(prior.counters.degradedModeContinuations) + (health.degradedMode.active ? 1 : 0),
    retryScheduled: normalizeAnalyticsCounter(prior.counters.retryScheduled) + (health.retryable ? 1 : 0),
    boundaryViolations: normalizeAnalyticsCounter(prior.counters.boundaryViolations) + boundary.violations.length,
    dependencyFailures: normalizeAnalyticsCounter(prior.counters.dependencyFailures) + dependencyFailures.length,
    evidenceObserved: normalizeAnalyticsCounter(prior.counters.evidenceObserved) + evidence.length,
    evidenceAccepted: normalizeAnalyticsCounter(prior.counters.evidenceAccepted) + freshness.acceptedEvidenceCount,
    evidenceRejected: normalizeAnalyticsCounter(prior.counters.evidenceRejected) + freshness.rejectedEvidenceCount,
    currentStateClaimsObserved:
      normalizeAnalyticsCounter(prior.counters.currentStateClaimsObserved) +
      freshness.currentStateClaimGate.retainedClaims,
    currentStateClaimsBlocked:
      normalizeAnalyticsCounter(prior.counters.currentStateClaimsBlocked) +
      freshness.currentStateClaimGate.blockingClaims,
    currentStateClaimsDegraded:
      normalizeAnalyticsCounter(prior.counters.currentStateClaimsDegraded) +
      freshness.currentStateClaimGate.degradedClaims,
    currentStateClaimsRedacted:
      normalizeAnalyticsCounter(prior.counters.currentStateClaimsRedacted) +
      freshness.currentStateClaimGate.exposure.redacted,
    currentStateClaimsUsableWithWarning:
      normalizeAnalyticsCounter(prior.counters.currentStateClaimsUsableWithWarning) +
      freshness.currentStateClaimGate.exposure.usableWithWarning,
    sourceProofWarnings:
      normalizeAnalyticsCounter(prior.counters.sourceProofWarnings) +
      (sourceProof.auditDisposition === "source-proof-accepted" ? 0 : 1)
  };
  counters[outcomeKey] = Math.max(normalizeAnalyticsCounter(prior.counters[outcomeKey]), counters[outcomeKey]);

  const currentSnapshot = {
    sequence: counters.totalDecisions,
    checkedAt: generatedAt,
    requestId: state.requestId,
    clientId: state.clientId,
    conversationId: state.conversationId,
    route: state.route,
    status,
    reason: freshness.reason,
    ageMs: freshness.ageMs,
    ttlMs: state.ttlMs,
    expiresAt: freshness.expiresAt,
    retryable: health.retryable,
    nextRetryAt: health.retry.nextRetryAt,
    degradedModeActive: health.degradedMode.active,
    degradedModeReason: health.degradedMode.active ? health.degradedMode.reason : null,
    staleBudgetRemainingMs: health.degradedMode.active ? health.degradedMode.staleBudgetRemainingMs : null,
    failureCodes: health.failureState.codes,
    operationalIncidentId: health.operationalResolution.incidentId,
    operationalRoute: health.operationalResolution.primaryRoute,
    operationalResolution: health.operationalResolution.auditDisposition,
    boundaryViolations: boundary.violations,
    evidenceCount: evidence.length,
    acceptedEvidenceCount: freshness.acceptedEvidenceCount,
    rejectedEvidenceCount: freshness.rejectedEvidenceCount,
    currentStateClaimGate: {
      disposition: freshness.currentStateClaimGate.auditDisposition,
      exposureDisposition: freshness.currentStateClaimGate.exposure.auditDisposition,
      retainedClaims: freshness.currentStateClaimGate.retainedClaims,
      blockingClaims: freshness.currentStateClaimGate.blockingClaims,
      degradedClaims: freshness.currentStateClaimGate.degradedClaims,
      redactedClaims: freshness.currentStateClaimGate.exposure.redacted,
      usableWithWarningClaims: freshness.currentStateClaimGate.exposure.usableWithWarning,
      violationCodes: freshness.currentStateClaimGate.violationCodes
    },
    sourceProofDisposition: sourceProof.auditDisposition
  };
  const history = [...prior.history, currentSnapshot].slice(-MAX_ANALYTICS_HISTORY);
  const reporting = buildAnalyticsReportingState(history, counters, generatedAt);
  const timeline = [
    {
      at: generatedAt,
      type: "boundary",
      status: boundary.allowed ? "accepted" : "denied",
      detail: boundary.auditDisposition,
      violations: boundary.violations
    },
    {
      at: freshness.latestEvidenceAt || state.lastHydratedAt || generatedAt,
      type: "freshness",
      status,
      detail: freshness.reason,
      ageMs: freshness.ageMs,
      ttlMs: state.ttlMs,
      sourceProofDisposition: sourceProof.auditDisposition
    },
    {
      at: generatedAt,
      type: "operational-health",
      status: health.status,
      detail: health.failureState.primaryAction,
      failureCodes: health.failureState.codes,
      incidentId: health.operationalResolution.incidentId,
      route: health.operationalResolution.primaryRoute,
      resolution: health.operationalResolution.auditDisposition,
      degradedModeActive: health.degradedMode.active
    }
  ];

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.analytics.v1",
    generatedAt,
    window: {
      retainedSnapshots: history.length,
      maxSnapshots: MAX_ANALYTICS_HISTORY,
      firstSnapshotAt: history[0]?.checkedAt || generatedAt,
      lastSnapshotAt: currentSnapshot.checkedAt
    },
    counters,
    currentSnapshot,
    history,
    timeline,
    reporting,
    exportSummary: {
      format: "memory-freshness-gate.summary.v1",
      reportId: `${buildPersistenceKey(state)}:${currentSnapshot.sequence}`,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      status,
      reason: freshness.reason,
      healthStatus: health.status,
      operationalIncidentId: health.operationalResolution.incidentId,
      operationalRoute: health.operationalResolution.primaryRoute,
      operationalResolution: health.operationalResolution.auditDisposition,
      recoveredStatus: recovered.restartSafe ? "restart-state-accepted" : "runtime-state-computed",
      reportingState: reporting.trend.freshnessDebt,
      dominantStatus: reporting.trend.dominantStatus,
      dominantFailureCode: reporting.trend.dominantFailureCode,
      retainedSnapshots: reporting.window.retainedSnapshots,
      csvHeader: "checkedAt,requestId,route,status,reason,ageMs,ttlMs,retryable,failureCodes",
      csvColumns: ["checkedAt", "requestId", "route", "status", "reason", "ageMs", "ttlMs", "retryable", "failureCodes"],
      csvRowValues: [
        currentSnapshot.checkedAt,
        currentSnapshot.requestId,
        currentSnapshot.route,
        currentSnapshot.status,
        currentSnapshot.reason,
        currentSnapshot.ageMs ?? "",
        currentSnapshot.ttlMs,
        currentSnapshot.retryable,
        currentSnapshot.failureCodes
      ],
      csvRow: [
        currentSnapshot.checkedAt,
        currentSnapshot.requestId,
        currentSnapshot.route,
        currentSnapshot.status,
        currentSnapshot.reason,
        currentSnapshot.ageMs ?? "",
        currentSnapshot.ttlMs,
        currentSnapshot.retryable,
        currentSnapshot.failureCodes
      ].map(csvCell).join(","),
      jsonlRow: JSON.stringify(reporting.exportRows[reporting.exportRows.length - 1] || currentSnapshot)
    }
  };
}

function buildWorkflowHandoff(state, decision, boundary, health, analytics, sourceProof) {
  const lifecycleDisabled = boundary.allowed && state.lifecycle.accepted && !state.lifecycle.effective.enabled;
  const lifecyclePaused = boundary.allowed && state.lifecycle.accepted && state.lifecycle.effective.paused;
  const action = !boundary.allowed
    ? "deny-memory-boundary"
    : lifecycleDisabled
      ? "continue-without-memory-freshness-gate"
      : lifecyclePaused
        ? "wait-for-scheduled-memory-refresh"
        : health.status === "failed"
          ? "fail-memory-freshness-gate"
          : decision.fresh
            ? "continue-with-memory"
            : health.degradedMode.active
              ? "continue-with-stale-memory-degraded"
            : health.status === "degraded"
              ? "retry-memory-refresh"
              : "refresh-memory-before-response";
  const persistenceKey = buildPersistenceKey(state);

  return {
    action,
    userVisibleStatus: !boundary.allowed
      ? "Memory context is unavailable for this tenant/workspace boundary."
      : lifecycleDisabled
        ? "Memory freshness enforcement is disabled by lifecycle settings for this request."
        : lifecyclePaused
          ? `Memory freshness refresh is paused until ${state.lifecycle.schedule.nextRunAt}.`
            : health.status === "failed"
              ? "Memory context could not be refreshed. Review the actionable error and retry after remediation."
              : decision.fresh
                ? "Memory is fresh enough to continue."
                : health.degradedMode.active
                  ? `Memory refresh is degraded; continuing with bounded stale memory and retrying after ${health.retry.nextRetryAt}.`
                : health.status === "degraded"
                  ? `Memory refresh is temporarily degraded. Retry after ${health.retry.nextRetryAt}.`
                  : "Memory context needs refresh before this request continues.",
    nextRoute: !boundary.allowed
      ? "memory-manager/boundary-audit"
      : lifecycleDisabled
        ? state.route
        : lifecyclePaused
          ? "memory-manager/freshness-gate/scheduler"
            : health.status === "failed"
              ? "memory-manager/freshness-failure"
              : decision.fresh
                ? state.route
                : health.degradedMode.active
                  ? state.route
                : health.status === "degraded"
                  ? "memory-manager/hydrate-context/retry"
                  : "memory-manager/hydrate-context",
    requestStatePatch: {
      requestId: state.requestId,
      clientId: state.clientId,
      conversationId: state.conversationId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      memoryBoundary: {
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        allowed: boundary.allowed,
        disposition: boundary.auditDisposition,
        violations: boundary.violations,
        scope: boundary.scope,
        scopeProof: boundary.scopeProof,
        workspaceAccess: boundary.workspaceAccess
      },
      memoryFreshness: {
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        persistenceKey,
        status: !boundary.allowed ? "blocked" : decision.fresh ? "fresh" : "stale",
        reason: decision.reason,
        checkedAt: state.generatedAt,
        expiresAt: decision.expiresAt,
        lastHydratedAt: state.lastHydratedAt,
        degradedMode: health.degradedMode.active
          ? {
              active: true,
              reason: health.degradedMode.reason,
              staleBudgetRemainingMs: health.degradedMode.staleBudgetRemainingMs,
              retryAfter: health.retry.nextRetryAt
            }
          : null,
        currentStateClaimGate: decision.currentStateClaimGate,
        currentStateClaimExposure: decision.currentStateClaimGate.exposure,
        currentStateClaimClientHandoff: null,
        sourceProofDisposition: sourceProof.auditDisposition,
        recoveryCursor: `${persistenceKey}:${decision.expiresAt || "unhydrated"}`
      },
      memoryFreshnessSourceProof: sourceProof,
      memoryFreshnessLifecycle: state.lifecycle,
      memoryFreshnessLifecyclePatch: state.lifecycle.settingsPatch,
      memoryOperationalHealth: {
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        status: health.status,
        degraded: health.degraded,
        retryable: health.retryable,
        nextRetryAt: health.retry.nextRetryAt,
        degradedMode: health.degradedMode,
        operationalResolution: health.operationalResolution,
        failureCodes: health.failureState.codes,
        primaryAction: health.failureState.primaryAction,
        primaryRoute: health.failureState.primaryRoute,
        incidentId: health.failureState.incidentId
      },
      memoryFreshnessAnalytics: {
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        counters: analytics.counters,
        currentSnapshot: analytics.currentSnapshot,
        reporting: analytics.reporting,
        exportSummary: analytics.exportSummary
      }
    }
  };
}

function normalizeClientRuntime(input, state) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const requestRuntime =
    (request.clientRuntime && typeof request.clientRuntime === "object" && request.clientRuntime) ||
    (request.runtime && typeof request.runtime === "object" && request.runtime) ||
    {};
  const clientRuntime =
    (clientState.runtime && typeof clientState.runtime === "object" && clientState.runtime) ||
    (input.clientRuntime && typeof input.clientRuntime === "object" && input.clientRuntime) ||
    {};
  const source = { ...clientRuntime, ...requestRuntime };
  const requestedTarget = normalizeString(source.target || source.surface || source.platform)?.toLowerCase() || null;
  const target = requestedTarget && CLIENT_RUNTIME_TARGETS.has(requestedTarget) ? requestedTarget : "web";
  const capabilities = normalizeStringList(source.capabilities || clientState.capabilities || request.capabilities);
  const capabilitySet = new Set(capabilities.map((capability) => capability.toLowerCase()));
  const localCacheKey = firstString(
    source.localCacheKey,
    clientState.memoryFreshness?.persistenceKey,
    `${state.clientId}:${state.conversationId || state.requestId}:memory-freshness`
  );

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.client-runtime-input.v1",
    target,
    requestedTarget,
    capabilities,
    localCacheKey,
    localCacheEtag: normalizeString(source.localCacheEtag || source.etag),
    visibleSurface: normalizeString(source.visibleSurface || source.panel || request.visibleSurface) || "memory-status",
    handoffChannel: normalizeString(source.handoffChannel || source.channel) || "request-state",
    preferredRoute: normalizeString(source.preferredRoute || source.nextRoute),
    supportsBackgroundRefresh:
      normalizeBoolean(source.supportsBackgroundRefresh, capabilitySet.has("background-refresh")) ||
      capabilitySet.has("memory-refresh-background"),
    supportsUserNotification:
      normalizeBoolean(source.supportsUserNotification, capabilitySet.has("user-notification")) ||
      capabilitySet.has("toast") ||
      capabilitySet.has("banner"),
    acceptsStatePatch:
      normalizeBoolean(source.acceptsStatePatch, true) && !capabilitySet.has("no-state-patch"),
    acceptsBlockingHandoff:
      normalizeBoolean(source.acceptsBlockingHandoff, true) && !capabilitySet.has("non-blocking-only")
  };
}

function buildClientRuntimeContract(input, state, freshness, boundary, health, handoff, sourceProof) {
  const runtime = normalizeClientRuntime(input, state);
  const currentStateClaimHandoff = buildCurrentStateClaimClientHandoff(
    freshness.currentStateClaimGate.exposure,
    runtime,
    health,
    state.generatedAt
  );
  const status = !boundary.allowed ? "blocked" : freshness.fresh ? "fresh" : "stale";
  const mustBlock =
    !boundary.allowed ||
    health.status === "failed" ||
    currentStateClaimHandoff.blocking ||
    (state.lifecycle.accepted &&
      state.lifecycle.effective.enabled &&
      !freshness.fresh &&
      health.status !== "degraded" &&
      !health.degradedMode.active);
  const canBackgroundRefresh =
    runtime.supportsBackgroundRefresh &&
    boundary.allowed &&
    state.lifecycle.accepted &&
    state.lifecycle.effective.enabled &&
    !freshness.fresh &&
    health.status !== "failed";
  const cacheDirective =
    !runtime.acceptsStatePatch || !boundary.allowed
      ? "do-not-write"
      : freshness.fresh
        ? "write-through"
        : health.degradedMode.active
          ? "stale-while-degraded"
        : health.status === "failed"
          ? "invalidate"
          : "stale-while-refresh";
  const notificationLevel =
    !runtime.supportsUserNotification
      ? "silent"
      : currentStateClaimHandoff.notificationLevel === "blocking"
        ? "blocking"
        : health.status === "failed" || !boundary.allowed
        ? "blocking"
        : canBackgroundRefresh
          ? "passive"
          : currentStateClaimHandoff.notificationLevel === "inline"
            ? "inline"
            : "inline";
  const nextRoute =
    currentStateClaimHandoff.blocking
      ? currentStateClaimHandoff.route
      : runtime.preferredRoute && !mustBlock
        ? runtime.preferredRoute
        : handoff.nextRoute;
  const notificationMessage =
    currentStateClaimHandoff.blocking
      ? "A current-state memory claim is hidden until fresh proof is collected."
      : currentStateClaimHandoff.status === "warning"
        ? "Some current-state memory claims are available with stale-proof warnings."
        : handoff.userVisibleStatus;
  const clientPatch = {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.client-runtime.v1",
    generatedAt: state.generatedAt,
    target: runtime.target,
    localCacheKey: runtime.localCacheKey,
    localCacheEtag: runtime.localCacheEtag,
    status,
    reason: freshness.reason,
    action: handoff.action,
    nextRoute,
    cacheDirective,
    degradedMode: health.degradedMode.active
      ? {
          reason: health.degradedMode.reason,
          staleBudgetRemainingMs: health.degradedMode.staleBudgetRemainingMs,
          retryAfter: health.retry.nextRetryAt
        }
      : null,
    sourceProofDisposition: sourceProof.auditDisposition,
    expiresAt: freshness.expiresAt,
    retryAfter: health.retryable ? health.retry.nextRetryAt : null,
    currentStateClaimHandoff,
    backgroundRefresh: canBackgroundRefresh
      ? {
          route: health.status === "degraded" ? "memory-manager/hydrate-context/retry" : "memory-manager/hydrate-context",
          retryAfter: health.status === "degraded" ? health.retry.nextRetryAt : null,
          reason: freshness.reason
        }
      : null,
    notification: {
      level: notificationLevel,
      surface: runtime.visibleSurface,
      message: notificationMessage
    }
  };

  return {
    ...clientPatch,
    input: runtime,
    blocking: mustBlock && runtime.acceptsBlockingHandoff,
    handoff: {
      channel: runtime.handoffChannel,
      route: nextRoute,
      visibleSurface: runtime.visibleSurface,
      userVisibleStatus: notificationMessage,
      acceptsStatePatch: runtime.acceptsStatePatch
    },
    statePatch: runtime.acceptsStatePatch ? clientPatch : null,
    auditDisposition:
      cacheDirective === "write-through"
        ? "client-runtime-cache-write"
        : cacheDirective === "stale-while-degraded"
          ? "client-runtime-stale-degraded"
        : cacheDirective === "stale-while-refresh"
          ? "client-runtime-stale-refresh"
          : cacheDirective === "invalidate"
            ? "client-runtime-cache-invalidated"
            : "client-runtime-state-patch-skipped"
  };
}

function buildClientReadinessContract(state, freshness, boundary, health, analytics, handoff, sourceProof) {
  const lifecycleValidation = state.lifecycle.validation.map((item) => ({
    source: "lifecycle",
    code: item.code,
    severity: "fatal",
    message: `Lifecycle setting rejected: ${item.code}.`,
    value: item.value ?? item.command ?? null
  }));
  const boundaryValidation = boundary.violations.map((violation) => ({
    source: "boundary",
    code: violation.toUpperCase().replace(/-/g, "_"),
    severity: "fatal",
    message: `Memory boundary validation failed: ${violation}.`,
    value: violation
  }));
  const healthValidation = health.actionableErrors.map((error) => ({
    source: "operational-health",
    code: error.code,
    severity: error.severity,
    message: error.message,
    action: error.action,
    retryable: error.retryable
  }));
  const operationalValidation = health.operationalResolution.validationFindings.map((finding) => ({
    source: "operational-resolution",
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    action: "repair-memory-dependency-health",
    route: finding.route,
    retryable: finding.severity !== "fatal",
    value: finding.target
  }));
  const sourceProofValidation = [
    ...sourceProof.hydration.violations.map((violation) => ({
      source: "source-proof",
      code: violation.toUpperCase().replace(/-/g, "_"),
      severity: violation.endsWith("from-future") ? "fatal" : "degraded",
      message: `Memory freshness source proof warning: ${violation}.`,
      value: sourceProof.hydration.sourceId,
      retryable: true
    })),
    ...sourceProof.evidence
      .filter((item) => !item.accepted)
      .map((item) => ({
        source: "source-proof",
        code: "EVIDENCE_REJECTED",
        severity: item.violations.some((violation) => violation.endsWith("from-future")) ? "fatal" : "degraded",
        message: `Memory evidence rejected: ${item.violations.join(", ")}.`,
        value: item.id,
        retryable: true
      }))
  ];
  const currentStateClaimValidation = freshness.currentStateClaimGate.decisions
    .filter((decision) => !decision.accepted)
    .map((decision) => ({
      source: "current-state-claim",
      code: "VOLATILE_CURRENT_STATE_CLAIM_UNVERIFIED",
      severity: decision.blocking ? "fatal" : "degraded",
      message: `Current-state claim requires fresher proof: ${decision.violations.join(", ")}.`,
      value: decision.id,
      route: decision.blocking
        ? "memory-manager/freshness-gate/current-state-claims"
        : "memory-manager/hydrate-context/retry",
      retryable: true
    }));
  const validationItems = [
    ...boundaryValidation,
    ...lifecycleValidation,
    ...sourceProofValidation,
    ...currentStateClaimValidation,
    ...healthValidation,
    ...operationalValidation
  ];
  const fatalCount = validationItems.filter((item) => item.severity === "fatal").length;
  const degradedCount = validationItems.filter((item) => item.severity === "degraded").length;
  const accepted =
    boundary.allowed &&
    state.lifecycle.accepted &&
    health.status !== "failed" &&
    (state.lifecycle.effective.enabled ? freshness.fresh || health.degradedMode.active : true);
  const readyState = !boundary.allowed
    ? "blocked"
    : !state.lifecycle.accepted
      ? "invalid"
      : !state.lifecycle.effective.enabled
        ? "accepted-without-enforcement"
        : state.lifecycle.effective.paused
          ? "waiting"
          : health.status === "failed"
            ? "failed"
            : freshness.fresh
              ? "ready"
              : health.degradedMode.active
                ? "ready-degraded"
              : health.status === "degraded"
                ? "retrying"
                : "needs-refresh";
  const nextSteps = [];
  const currentStateClaimSteps = buildCurrentStateClaimReadinessSteps(freshness, handoff);

  if (!boundary.allowed) {
    nextSteps.push({
      id: "repair-memory-boundary",
      label: "Repair memory boundary",
      route: "memory-manager/boundary-audit",
      reason: "Tenant, workspace, principal, or read permission is missing or mismatched.",
      required: true,
      blockedBy: boundary.violations
    });
  }

  if (!state.lifecycle.accepted) {
    nextSteps.push({
      id: "repair-lifecycle-settings",
      label: "Repair lifecycle settings",
      route: "memory-manager/freshness-gate/lifecycle-audit",
      reason: "Hosted-kernel lifecycle validation rejected the requested gate controls.",
      required: true,
      blockedBy: state.lifecycle.validation.map((item) => item.code)
    });
  }

  if (state.lifecycle.effective.paused && state.lifecycle.schedule.nextRunAt) {
    nextSteps.push({
      id: "wait-for-schedule",
      label: "Wait for scheduled refresh",
      route: "memory-manager/freshness-gate/scheduler",
      reason: "Freshness enforcement is paused by lifecycle schedule.",
      required: false,
      readyAt: state.lifecycle.schedule.nextRunAt
    });
  }

  for (const step of currentStateClaimSteps) {
    nextSteps.push(step);
  }

  if (health.status === "failed") {
    nextSteps.push({
      id: "resolve-memory-failure",
      label: "Resolve memory failure",
      route: health.failureState.primaryRoute || "memory-manager/freshness-failure",
      reason: health.failureState.primaryAction,
      required: true,
      blockedBy: health.failureState.codes,
      incidentId: health.failureState.incidentId
    });
  } else if (health.operationalResolution.validationFindings.length > 0) {
    nextSteps.push({
      id: "repair-operational-health",
      label: "Repair operational health",
      route: health.operationalResolution.primaryRoute,
      reason: health.operationalResolution.auditDisposition,
      required: false,
      blockedBy: health.operationalResolution.validationFindings.map((finding) => finding.code),
      retryAfter: health.operationalResolution.retryPlan.nextRetryAt
    });
  } else if (!freshness.fresh && boundary.allowed && state.lifecycle.accepted && state.lifecycle.effective.enabled) {
    nextSteps.push({
      id: health.degradedMode.active
        ? "continue-with-degraded-memory"
        : health.status === "degraded"
          ? "retry-memory-refresh"
          : "hydrate-memory-context",
      label: health.degradedMode.active
        ? "Continue with degraded memory"
        : health.status === "degraded"
          ? "Retry memory refresh"
          : "Hydrate memory context",
      route: handoff.nextRoute,
      reason: health.degradedMode.active ? health.degradedMode.reason : freshness.reason,
      required: !health.degradedMode.active,
      retryAfter: health.status === "degraded" || health.degradedMode.active ? health.retry.nextRetryAt : null,
      staleBudgetRemainingMs: health.degradedMode.active ? health.degradedMode.staleBudgetRemainingMs : null
    });
  }

  if (nextSteps.length === 0) {
    nextSteps.push({
      id: accepted ? "continue-request" : "continue-without-enforcement",
      label: accepted ? "Continue request" : "Continue without enforcement",
      route: handoff.nextRoute,
      reason: accepted ? "Memory freshness contract is accepted." : state.lifecycle.effective.nextAction,
      required: false
    });
  }

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.client-readiness.v1",
    generatedAt: state.generatedAt,
    preview: {
      title: "Memory freshness gate",
      status: handoff.userVisibleStatus,
      decision: handoff.action,
      route: handoff.nextRoute,
      freshness: {
        status: !boundary.allowed ? "blocked" : freshness.fresh ? "fresh" : "stale",
        reason: freshness.reason,
        ageMs: freshness.ageMs,
        ttlMs: state.ttlMs,
        expiresAt: freshness.expiresAt,
        latestEvidenceAt: freshness.latestEvidenceAt,
        currentStateClaimGate: freshness.currentStateClaimGate,
        currentStateClaimExposure: freshness.currentStateClaimGate.exposure,
        sourceProofDisposition: sourceProof.auditDisposition
      }
    },
    acceptance: {
      accepted,
      disposition: accepted ? "client-contract-accepted" : "client-contract-requires-action",
      requiresUserAction: nextSteps.some((step) => step.required),
      canContinue: boundary.allowed && (accepted || !state.lifecycle.effective.enabled),
      proof: {
        persistenceKey: buildPersistenceKey(state),
        boundaryDisposition: boundary.auditDisposition,
        sourceProofDisposition: sourceProof.auditDisposition,
        lifecycleDisposition: state.lifecycle.auditDisposition,
        lifecycleControlId: state.lifecycle.controlId,
        healthStatus: health.status,
        analyticsReportId: analytics.exportSummary.reportId
      }
    },
    readiness: {
      state: readyState,
      ready: readyState === "ready" || readyState === "ready-degraded" || readyState === "accepted-without-enforcement",
      retryable: health.retryable,
      nextRetryAt: health.retryable ? health.retry.nextRetryAt : null,
      nextRoute: handoff.nextRoute,
      nextAction: handoff.action,
      degradedMode: health.degradedMode.active
        ? {
            reason: health.degradedMode.reason,
            staleBudgetRemainingMs: health.degradedMode.staleBudgetRemainingMs,
            retryAfter: health.retry.nextRetryAt
          }
        : null
    },
    validationSummary: {
      valid: validationItems.length === 0,
      total: validationItems.length,
      fatalCount,
      degradedCount,
      retryableCount: validationItems.filter((item) => item.retryable).length,
      items: validationItems
    },
    nextSteps
  };
}

function normalizeProviderService(input) {
  const services = input.services && typeof input.services === "object" ? input.services : {};
  const provider =
    (input.providerService && typeof input.providerService === "object" && input.providerService) ||
    (input.memoryProvider && typeof input.memoryProvider === "object" && input.memoryProvider) ||
    (services.memory && typeof services.memory === "object" && services.memory) ||
    (services.memoryProvider && typeof services.memoryProvider === "object" && services.memoryProvider) ||
    {};
  const sync = provider.sync && typeof provider.sync === "object" ? provider.sync : {};
  const handoff = provider.handoff && typeof provider.handoff === "object" ? provider.handoff : {};
  const ack = provider.ack && typeof provider.ack === "object" ? provider.ack : {};
  const capabilities = normalizeProviderCapabilities(
    provider.capabilities || provider.capability || sync.capabilities || input.providerCapabilities
  );
  const protocolVersion = normalizeString(provider.protocolVersion || provider.contractVersion || provider.version) || "v1";
  const ackStatus = normalizeString(ack.status || provider.ackStatus)?.toLowerCase() || "missing";

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.provider-service-input.v1",
    providerId: normalizeString(provider.id || provider.providerId || provider.name) || "memory-provider",
    serviceType: normalizeString(provider.serviceType || provider.type || provider.kind) || "hosted-kernel-memory",
    protocolVersion,
    endpointRef: normalizeString(provider.endpointRef || provider.endpoint || provider.route),
    capabilities,
    healthStatus: normalizeString(provider.healthStatus || provider.status || provider.health?.status) || "unknown",
    sync: {
      mode: normalizeProviderSyncMode(sync.mode || provider.syncMode),
      requestedMode: normalizeString(sync.mode || provider.syncMode) || null,
      operation: normalizeString(sync.operation || provider.syncOperation || provider.operation),
      cursor: normalizeString(sync.cursor || provider.cursor || provider.syncCursor),
      watermark: toIsoTimestamp(sync.watermark || sync.watermarkAt || provider.watermarkAt, null),
      lastSyncedAt: toIsoTimestamp(sync.lastSyncedAt || provider.lastSyncedAt || provider.updatedAt, null),
      leaseId: normalizeString(sync.leaseId || provider.leaseId),
      leaseExpiresAt: toIsoTimestamp(sync.leaseExpiresAt || provider.leaseExpiresAt, null),
      etag: normalizeString(sync.etag || provider.etag || provider.checksum)
    },
    ack: {
      status: PROVIDER_ACK_STATUSES.has(ackStatus) ? ackStatus : "pending",
      token: normalizeString(ack.token || ack.commitToken || provider.ackToken || provider.commitToken),
      cursor: normalizeString(ack.cursor || ack.syncCursor || provider.ackCursor),
      watermark: toIsoTimestamp(ack.watermark || ack.watermarkAt || provider.ackWatermarkAt, null),
      receivedAt: toIsoTimestamp(ack.receivedAt || ack.ackedAt || ack.committedAt || provider.ackReceivedAt, null),
      expiresAt: toIsoTimestamp(ack.expiresAt || ack.validUntil || provider.ackExpiresAt, null),
      reason: normalizeString(ack.reason || ack.error || provider.ackReason)
    },
    handoff: {
      channel: normalizeString(handoff.channel || provider.handoffChannel) || "hosted-kernel-command",
      route: normalizeString(handoff.route || provider.handoffRoute) || "memory-manager/provider-sync",
      externalRef: normalizeString(handoff.externalRef || provider.externalRef),
      acceptsBlocking: normalizeBoolean(handoff.acceptsBlocking ?? provider.acceptsBlockingHandoff, true)
    }
  };
}

function buildProviderExternalOperation(provider, state, freshness, health, sourceProof, negotiation) {
  const persistenceKey = buildPersistenceKey(state);
  const requestedOperation = normalizeString(provider.sync.operation)?.toLowerCase().replace(/_/g, "-") || null;
  const modeOperation =
    provider.sync.mode === "observe"
      ? "observe"
      : provider.sync.mode === "delta"
        ? "sync-delta"
        : provider.sync.mode === "cursor"
          ? "sync-cursor"
          : provider.sync.mode === "watermark"
            ? "sync-watermark"
            : "sync-snapshot";
  const operation =
    negotiation.handoffState === "capability-negotiation-required"
      ? "negotiate-capabilities"
      : negotiation.handoffPhase === "commit"
        ? "await-provider-commit"
        : freshness.fresh && !negotiation.commitRequired
          ? "observe"
          : requestedOperation || modeOperation;
  const modeCapabilities = {
    "sync-delta": ["memory.read", "memory.write", "delta-sync"],
    "sync-cursor": ["memory.read", "memory.write", "cursor-sync"],
    "sync-watermark": ["memory.read", "memory.write", "watermark-sync"],
    "sync-snapshot": ["memory.read", "memory.write", "source-proof"],
    observe: ["memory.read", "source-proof"],
    "await-provider-commit": ["memory.write"],
    "negotiate-capabilities": negotiation.requiredCapabilities
  };
  const requiredCapabilities = [
    ...new Set(modeCapabilities[operation] || negotiation.requiredCapabilities)
  ];
  const statePatch = {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.provider-external-operation-state.v1",
    persistenceKey,
    providerId: provider.providerId,
    operation,
    syncMode: provider.sync.mode,
    cursor: provider.sync.cursor,
    watermark: provider.sync.watermark,
    lastSyncedAt: provider.sync.lastSyncedAt,
    sourceProofDisposition: sourceProof.auditDisposition,
    freshnessReason: freshness.reason,
    healthStatus: health.status,
    commitRequired: negotiation.commitRequired,
    commitAccepted: negotiation.commitAccepted,
    missingCapabilities: negotiation.missingCapabilities,
    ackViolations: negotiation.ackViolations
  };

  return {
    contract: "memory-freshness-gate.provider-external-operation.v1",
    operationId: `${persistenceKey}:provider:${stableKeyPart(provider.providerId, "provider")}:${operation}`,
    operation,
    requestedOperation,
    route: provider.handoff.route,
    requiredCapabilities,
    canExecute:
      negotiation.missingCapabilities.length === 0 &&
      negotiation.syncViolations.length === 0 &&
      !["blocked", "negotiate", "validate"].includes(negotiation.handoffPhase) &&
      (operation !== "await-provider-commit" ||
        (negotiation.handoffState === "awaiting-provider-ack" && !negotiation.commitAccepted)),
    statePatch,
    commitExpectation: {
      required: negotiation.commitRequired,
      token: provider.ack.token,
      expectedCursor: provider.sync.cursor,
      expectedWatermark: provider.sync.watermark,
      ackStatus: provider.ack.status,
      ackExpiresAt: provider.ack.expiresAt
    },
    auditDisposition:
      negotiation.syncViolations.length > 0
        ? "provider-operation-contract-invalid"
        : negotiation.missingCapabilities.length > 0
        ? "provider-operation-needs-capability-negotiation"
        : operation === "await-provider-commit"
          ? "provider-operation-awaiting-commit"
          : operation === "observe"
            ? "provider-operation-observe"
            : "provider-operation-ready"
  };
}

function buildProviderSyncContract(input, state, freshness, boundary, health, sourceProof) {
  const provider = normalizeProviderService(input);
  const capabilitySet = new Set(provider.capabilities);
  const requiredCapabilities = ["memory.read", "source-proof"];
  const requestedModeKey = normalizeString(provider.sync.requestedMode)?.toLowerCase().replace(/_/g, "-") || null;
  const unsupportedSyncMode =
    Boolean(requestedModeKey) &&
    !PROVIDER_SYNC_MODE_ALIASES.has(requestedModeKey) &&
    !PROVIDER_SYNC_MODES.has(requestedModeKey);
  const syncViolations = [];
  const needsMutation =
    boundary.allowed &&
    state.lifecycle.accepted &&
    state.lifecycle.effective.enabled &&
    provider.sync.mode !== "observe" &&
    (!freshness.fresh || health.retryable);

  if (needsMutation) {
    requiredCapabilities.push("memory.write");
  }
  if (provider.sync.mode === "delta") {
    requiredCapabilities.push("delta-sync");
  }
  if (provider.sync.mode === "cursor" || provider.sync.cursor) {
    requiredCapabilities.push("cursor-sync");
  }
  if (provider.sync.mode === "watermark" || provider.sync.watermark) {
    requiredCapabilities.push("watermark-sync");
  }
  if (provider.handoff.externalRef) {
    requiredCapabilities.push("external-handoff");
  }
  if (unsupportedSyncMode) {
    syncViolations.push("provider-sync-mode-unsupported");
  }
  if (provider.sync.mode === "delta" && !provider.sync.cursor && !provider.sync.watermark) {
    syncViolations.push("provider-delta-sync-cursor-or-watermark-required");
  }
  if (provider.sync.mode === "cursor" && !provider.sync.cursor) {
    syncViolations.push("provider-cursor-sync-cursor-required");
  }
  if (provider.sync.mode === "watermark" && !provider.sync.watermark) {
    syncViolations.push("provider-watermark-sync-watermark-required");
  }

  const missingCapabilities = [...new Set(requiredCapabilities)].filter(
    (capability) => !capabilitySet.has(capability)
  );
  const providerHealthy = ["ok", "ready", "healthy"].includes(provider.healthStatus.toLowerCase());
  const leaseExpiresMs = provider.sync.leaseExpiresAt ? Date.parse(provider.sync.leaseExpiresAt) : NaN;
  const generatedMs = Date.parse(state.generatedAt);
  const leaseValid = !provider.sync.leaseId || (Number.isFinite(leaseExpiresMs) && leaseExpiresMs > generatedMs);
  const ackReceivedMs = provider.ack.receivedAt ? Date.parse(provider.ack.receivedAt) : NaN;
  const ackExpiresMs = provider.ack.expiresAt ? Date.parse(provider.ack.expiresAt) : NaN;
  const ackFromFuture = Number.isFinite(ackReceivedMs) && ackReceivedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS;
  const ackExpired = provider.ack.expiresAt ? Number.isFinite(ackExpiresMs) && ackExpiresMs <= generatedMs : false;
  const commitRequired = provider.sync.mode !== "observe" && (needsMutation || health.status === "degraded" || !freshness.fresh);
  const ackTerminal = ["accepted", "committed", "rejected", "expired"].includes(provider.ack.status);
  const commitAccepted = provider.ack.status === "accepted" || provider.ack.status === "committed";
  const commitRejected = provider.ack.status === "rejected" || provider.ack.status === "expired" || ackExpired;
  const cursorCommitted =
    !provider.sync.cursor ||
    !provider.ack.cursor ||
    provider.ack.cursor === provider.sync.cursor ||
    provider.ack.status === "committed";
  const watermarkCommitted =
    !provider.sync.watermark ||
    !provider.ack.watermark ||
    Date.parse(provider.ack.watermark) >= Date.parse(provider.sync.watermark) ||
    provider.ack.status === "committed";
  const ackViolations = [];

  if (ackFromFuture) {
    ackViolations.push("provider-ack-from-future");
  }
  if (ackExpired) {
    ackViolations.push("provider-ack-expired");
  }
  if (commitRequired && !provider.ack.token) {
    ackViolations.push("provider-ack-token-missing");
  }
  if (commitRequired && provider.ack.status === "missing") {
    ackViolations.push("provider-ack-missing");
  }
  if (commitRejected) {
    ackViolations.push("provider-ack-rejected");
  }
  if (commitRequired && !cursorCommitted) {
    ackViolations.push("provider-ack-cursor-behind");
  }
  if (commitRequired && !watermarkCommitted) {
    ackViolations.push("provider-ack-watermark-behind");
  }

  const ackValid =
    ackViolations.length === 0 &&
    (!commitRequired || (commitAccepted && provider.ack.token && cursorCommitted && watermarkCommitted));
  const canSync =
    boundary.allowed &&
    state.lifecycle.accepted &&
    providerHealthy &&
    leaseValid &&
    syncViolations.length === 0 &&
    missingCapabilities.length === 0 &&
    (ackValid || !commitRequired);
  const handoffState = !boundary.allowed
    ? "blocked-by-boundary"
    : !state.lifecycle.accepted
      ? "blocked-by-lifecycle"
      : !providerHealthy
      ? "provider-unhealthy"
      : !leaseValid
        ? "provider-lease-expired"
        : syncViolations.length > 0
          ? "provider-sync-contract-invalid"
          : missingCapabilities.length > 0
            ? "capability-negotiation-required"
            : ackFromFuture
              ? "provider-ack-clock-skew"
              : commitRejected
                ? "provider-ack-rejected"
                : commitRequired && !ackTerminal
                  ? "awaiting-provider-ack"
                  : commitRequired && !ackValid
                    ? "provider-commit-not-safe"
            : freshness.fresh
              ? "provider-observe"
              : health.status === "degraded"
                ? "provider-retry-sync"
                : "provider-refresh-required";
  const handoffPhase =
    handoffState.startsWith("blocked")
      ? "blocked"
      : handoffState === "capability-negotiation-required"
        ? "negotiate"
        : handoffState === "provider-sync-contract-invalid"
          ? "validate"
        : handoffState.startsWith("provider-ack") || handoffState === "awaiting-provider-ack" || handoffState === "provider-commit-not-safe"
          ? "commit"
          : handoffState === "provider-observe"
            ? "observe"
            : "sync";
  const providerNegotiation = {
    requiredCapabilities: [...new Set(requiredCapabilities)],
    advertisedCapabilities: provider.capabilities,
    missingCapabilities,
    compatible: missingCapabilities.length === 0 && syncViolations.length === 0,
    protocolVersion: provider.protocolVersion,
    requestedSyncMode: provider.sync.requestedMode,
    effectiveSyncMode: provider.sync.mode,
    syncViolations,
    commitRequired,
    commitAccepted: ackValid,
    ackViolations,
    handoffState,
    handoffPhase
  };
  const externalOperation = buildProviderExternalOperation(
    provider,
    state,
    freshness,
    health,
    sourceProof,
    providerNegotiation
  );

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.provider-sync.v1",
    generatedAt: state.generatedAt,
    provider,
    negotiation: providerNegotiation,
    syncMetadata: {
      persistenceKey: buildPersistenceKey(state),
      mode: provider.sync.mode,
      requestedMode: provider.sync.requestedMode,
      requestedOperation: provider.sync.operation,
      cursor: provider.sync.cursor,
      watermark: provider.sync.watermark,
      lastSyncedAt: provider.sync.lastSyncedAt,
      leaseId: provider.sync.leaseId,
      leaseExpiresAt: provider.sync.leaseExpiresAt,
      leaseValid,
      etag: provider.sync.etag,
      sourceProofDisposition: sourceProof.auditDisposition,
      ack: {
        status: provider.ack.status,
        token: provider.ack.token,
        cursor: provider.ack.cursor,
        watermark: provider.ack.watermark,
        receivedAt: provider.ack.receivedAt,
        expiresAt: provider.ack.expiresAt,
        valid: ackValid,
        violations: ackViolations
      },
      syncWindow: {
        openedAt: provider.sync.lastSyncedAt || state.lastHydratedAt || state.generatedAt,
        closesAt: provider.sync.leaseExpiresAt || health.retry.nextRetryAt || null,
        cursorCommitted,
        watermarkCommitted
      },
      externalOperation
    },
    externalHandoff: {
      state: handoffState,
      phase: handoffPhase,
      channel: provider.handoff.channel,
      route: provider.handoff.route,
      externalRef: provider.handoff.externalRef,
      blocking:
        provider.handoff.acceptsBlocking &&
        [
          "provider-refresh-required",
          "provider-unhealthy",
          "provider-sync-contract-invalid",
          "provider-commit-not-safe",
          "provider-ack-rejected"
        ].includes(handoffState),
      retryAfter: handoffState === "awaiting-provider-ack" ? provider.ack.expiresAt || health.retry.nextRetryAt : health.retryable ? health.retry.nextRetryAt : null,
      commitToken: provider.ack.token,
      commitRequired,
      operationId: externalOperation.operationId,
      operation: externalOperation.operation,
      operationStatePatch: externalOperation.statePatch,
      auditReason: syncViolations[0] || ackViolations[0] || missingCapabilities[0] || handoffState
    },
    externalOperation,
    accepted:
      canSync ||
      (freshness.fresh &&
        !commitRequired &&
        providerHealthy &&
        leaseValid &&
        syncViolations.length === 0 &&
        missingCapabilities.length === 0),
    auditDisposition:
      syncViolations.length > 0
        ? "provider-sync-contract-rejected"
        : missingCapabilities.length > 0
        ? "provider-capability-negotiation-required"
        : !providerHealthy
          ? "provider-health-blocked"
          : !leaseValid
            ? "provider-lease-rejected"
            : ackViolations.length > 0
              ? "provider-ack-rejected"
              : commitRequired && !ackValid
                ? "provider-commit-pending"
            : "provider-contract-accepted"
  };
}

function buildPersistedState(
  state,
  freshness,
  recovered,
  recoveryStatus,
  commandLedger,
  boundary,
  health,
  analytics,
  sourceProof,
  clientReadiness = null,
  clientAcceptance = null,
  clientRuntime = null,
  providerSync = null
) {
  const persistenceKey = buildPersistenceKey(state);
  const status = !boundary.allowed ? "blocked" : freshness.fresh ? "fresh" : "stale";

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    persistenceKey,
    requestId: state.requestId,
    clientId: state.clientId,
    conversationId: state.conversationId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    route: state.route,
      memoryBoundary: {
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      allowed: boundary.allowed,
      disposition: boundary.auditDisposition,
      violations: boundary.violations,
      scope: boundary.scope,
      permissions: boundary.permissions,
      scopeProof: boundary.scopeProof,
      workspaceAccess: boundary.workspaceAccess
    },
    memoryFreshness: {
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      status,
      reason: freshness.reason,
      checkedAt: state.generatedAt,
      expiresAt: freshness.expiresAt,
      lastHydratedAt: state.lastHydratedAt,
      ttlMs: state.ttlMs,
      evidenceCount: freshness.evidenceCount,
      acceptedEvidenceCount: freshness.acceptedEvidenceCount,
      rejectedEvidenceCount: freshness.rejectedEvidenceCount,
      latestEvidenceAt: freshness.latestEvidenceAt,
      currentStateClaimGate: freshness.currentStateClaimGate,
      currentStateClaimExposure: freshness.currentStateClaimGate.exposure,
      currentStateClaimClientHandoff: clientRuntime?.currentStateClaimHandoff || null,
      sourceProofDisposition: sourceProof.auditDisposition,
      recoveryCursor: `${persistenceKey}:${freshness.expiresAt || "unhydrated"}`,
      restartSafe: boundary.allowed && freshness.fresh && Boolean(freshness.expiresAt),
      recoveredFromRestart: recovered.restartSafe
    },
    memoryFreshnessRecovery: recoveryStatus,
    memoryFreshnessSourceProof: sourceProof,
    memoryFreshnessLifecycle: state.lifecycle,
    memoryOperationalHealth: {
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      status: health.status,
      degraded: health.degraded,
      retryable: health.retryable,
      policy: health.policy,
      degradedMode: health.degradedMode,
      dependencies: health.dependencies,
      retry: health.retry,
      operationalResolution: health.operationalResolution,
      failureState: health.failureState,
      actionableErrors: health.actionableErrors
    },
    memoryFreshnessAnalytics: {
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      generatedAt: analytics.generatedAt,
      window: analytics.window,
      counters: analytics.counters,
      currentSnapshot: analytics.currentSnapshot,
      history: analytics.history,
      timeline: analytics.timeline,
      reporting: analytics.reporting,
      exportSummary: analytics.exportSummary
    },
    memoryFreshnessCommandLedger: {
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      contract: commandLedger.contract,
      generatedAt: state.generatedAt,
      maxEntries: commandLedger.maxEntries,
      entries: commandLedger.entries
    },
    memoryFreshnessClient: clientReadiness,
    memoryFreshnessClientAcceptance: clientAcceptance,
    memoryFreshnessRuntime: clientRuntime,
    memoryFreshnessProvider: providerSync
  };
}

function buildRecoveryPlan(
  state,
  freshness,
  recovered,
  recoveryStatus,
  commandLedger,
  persistedState,
  boundary,
  health,
  analytics,
  sourceProof,
  clientReadiness = null,
  clientAcceptance = null,
  clientRuntime = null,
  providerSync = null
) {
  const persistenceKey = persistedState.persistenceKey;
  const commandBase = {
    persistenceKey,
    requestId: state.requestId,
    clientId: state.clientId,
    conversationId: state.conversationId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    workspaceAccess: {
      contract: state.workspaceAccess.contract,
      source: state.workspaceAccess.source,
      constrained: state.workspaceAccess.constrained,
      granted: state.workspaceAccess.granted,
      bypassedByAdmin: state.workspaceAccess.bypassedByAdmin,
      violations: state.workspaceAccess.violations,
      auditDisposition: state.workspaceAccess.auditDisposition
    }
  };
  const commands = [
    {
      id: `persist:${persistenceKey}`,
      type: "memory.freshness.persist",
      idempotencyKey: `${persistenceKey}:${persistedState.memoryFreshness.checkedAt}`,
      payload: persistedState
    }
  ];

  commands.push({
    id: `analytics:${persistenceKey}:${analytics.currentSnapshot.sequence}`,
    type: "memory.freshness.analytics.export",
    idempotencyKey: `${persistenceKey}:analytics:${analytics.currentSnapshot.sequence}:${state.generatedAt}`,
    payload: {
      ...commandBase,
      route: "memory-manager/freshness-gate/analytics",
      summary: analytics.exportSummary,
      counters: analytics.counters,
      reporting: analytics.reporting,
      timeline: analytics.timeline,
      historyWindow: analytics.window,
      sourceProofDisposition: sourceProof.auditDisposition
    }
  });

  if (sourceProof.auditDisposition !== "source-proof-accepted") {
    commands.push({
      id: `source-proof:${persistenceKey}:${analytics.currentSnapshot.sequence}`,
      type: "memory.freshness.source-proof.audit",
      idempotencyKey: `${persistenceKey}:source-proof:${analytics.currentSnapshot.sequence}:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: "memory-manager/freshness-gate/source-proof",
        disposition: sourceProof.auditDisposition,
        hydration: sourceProof.hydration,
        rejectedEvidence: sourceProof.evidence.filter((item) => !item.accepted),
        clockSkewAllowanceMs: sourceProof.clockSkewAllowanceMs
      }
    });
  }

  if (clientReadiness) {
    commands.push({
      id: `client-readiness:${persistenceKey}:${analytics.currentSnapshot.sequence}`,
      type: "memory.freshness.client-readiness.publish",
      idempotencyKey: `${persistenceKey}:client-readiness:${analytics.currentSnapshot.sequence}:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: "memory-manager/freshness-gate/client-readiness",
        preview: clientReadiness.preview,
        acceptance: clientReadiness.acceptance,
        readiness: clientReadiness.readiness,
        validationSummary: clientReadiness.validationSummary,
        nextSteps: clientReadiness.nextSteps
      }
    });
  }

  if (clientAcceptance) {
    commands.push({
      id: `client-acceptance:${persistenceKey}:${analytics.currentSnapshot.sequence}`,
      type: "memory.freshness.client-acceptance.receipt",
      idempotencyKey: `${persistenceKey}:client-acceptance:${clientAcceptance.receipt.receiptId}:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: clientAcceptance.route,
        acceptanceRequired: clientAcceptance.acceptanceRequired,
        accepted: clientAcceptance.accepted,
        state: clientAcceptance.state,
        workflowPreference: clientAcceptance.workflowPreference,
        receipt: clientAcceptance.receipt,
        coverage: clientAcceptance.coverage,
        validationSummary: clientAcceptance.validationSummary,
        nextStep: clientAcceptance.nextStep,
        auditDisposition: clientAcceptance.auditDisposition
      }
    });
  }

  if (clientRuntime) {
    commands.push({
      id: `client-runtime:${persistenceKey}:${analytics.currentSnapshot.sequence}`,
      type: "memory.freshness.client-runtime.handoff",
      idempotencyKey: `${persistenceKey}:client-runtime:${analytics.currentSnapshot.sequence}:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: "memory-manager/freshness-gate/client-runtime",
        target: clientRuntime.target,
        localCacheKey: clientRuntime.localCacheKey,
        cacheDirective: clientRuntime.cacheDirective,
        blocking: clientRuntime.blocking,
        handoff: clientRuntime.handoff,
        currentStateClaimHandoff: clientRuntime.currentStateClaimHandoff,
        statePatch: clientRuntime.statePatch,
        backgroundRefresh: clientRuntime.backgroundRefresh,
        notification: clientRuntime.notification,
        auditDisposition: clientRuntime.auditDisposition
      }
    });
  }

  if (providerSync) {
    commands.push({
      id: `provider-sync:${persistenceKey}:${analytics.currentSnapshot.sequence}`,
      type: "memory.freshness.provider-sync.handoff",
      idempotencyKey: `${persistenceKey}:provider-sync:${analytics.currentSnapshot.sequence}:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: providerSync.externalHandoff.route,
        providerId: providerSync.provider.providerId,
        serviceType: providerSync.provider.serviceType,
        endpointRef: providerSync.provider.endpointRef,
        negotiation: providerSync.negotiation,
        syncMetadata: providerSync.syncMetadata,
        externalHandoff: providerSync.externalHandoff,
        externalOperation: providerSync.externalOperation,
        accepted: providerSync.accepted,
        auditDisposition: providerSync.auditDisposition
      }
    });
  }

  if (state.lifecycle.command || state.lifecycle.auditDisposition === "lifecycle-settings-rejected") {
    const lifecycleIdempotencyBasis = [
      persistenceKey,
      "lifecycle",
      state.lifecycle.command || "rejected",
      state.lifecycle.effective.mode,
      state.lifecycle.schedule.nextRunAt || "no-next-run"
    ].join(":");

    commands.push({
      id: `lifecycle:${persistenceKey}:${state.lifecycle.command || "rejected"}`,
      type: "memory.freshness.lifecycle.control",
      idempotencyKey: lifecycleIdempotencyBasis,
      payload: {
        ...commandBase,
        route: "memory-manager/freshness-gate/lifecycle",
        command: state.lifecycle.command,
        accepted: state.lifecycle.accepted,
        validation: state.lifecycle.validation,
        effective: state.lifecycle.effective,
        schedule: state.lifecycle.schedule,
        settingsPatch: state.lifecycle.settingsPatch,
        auditProof: state.lifecycle.auditProof,
        disposition: state.lifecycle.auditDisposition
      }
    });
  }

  if (!boundary.allowed) {
    commands.push({
      id: `audit-boundary:${persistenceKey}`,
      type: "memory.boundary.audit",
      idempotencyKey: `${persistenceKey}:boundary:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: "memory-manager/boundary-audit",
        disposition: boundary.auditDisposition,
        violations: boundary.violations,
        scope: boundary.scope,
        scopeProof: boundary.scopeProof,
        permissions: boundary.permissions,
        workspaceAccess: boundary.workspaceAccess
      }
    });
  } else if (!state.lifecycle.accepted) {
    commands.push({
      id: `lifecycle-audit:${persistenceKey}`,
      type: "memory.freshness.lifecycle.audit",
      idempotencyKey: `${persistenceKey}:lifecycle-audit:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: "memory-manager/freshness-gate/lifecycle-audit",
        validation: state.lifecycle.validation,
        settingsPatch: state.lifecycle.settingsPatch,
        auditProof: state.lifecycle.auditProof,
        disposition: state.lifecycle.auditDisposition
      }
    });
  } else if (!state.lifecycle.effective.enabled) {
    commands.push({
      id: `disable-enforcement:${persistenceKey}`,
      type: "memory.freshness.enforcement.disabled",
      idempotencyKey: `${persistenceKey}:disabled:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: state.route,
        nextAction: state.lifecycle.effective.nextAction,
        nextActionState: state.lifecycle.effective.nextActionState,
        schedule: state.lifecycle.schedule,
        settingsPatch: state.lifecycle.settingsPatch,
        auditProof: state.lifecycle.auditProof
      }
    });
  } else if (state.lifecycle.effective.paused) {
    commands.push({
      id: `paused-schedule:${persistenceKey}`,
      type: "memory.freshness.schedule.paused",
      idempotencyKey: `${persistenceKey}:paused:${state.lifecycle.schedule.nextRunAt || state.generatedAt}`,
      payload: {
        ...commandBase,
        route: "memory-manager/freshness-gate/scheduler",
        pausedUntil: state.lifecycle.schedule.nextRunAt,
        intervalMs: state.lifecycle.schedule.intervalMs,
        nextAction: state.lifecycle.effective.nextAction,
        nextActionState: state.lifecycle.effective.nextActionState,
        settingsPatch: state.lifecycle.settingsPatch,
        auditProof: state.lifecycle.auditProof
      }
    });
  } else if (health.status === "failed") {
    commands.push({
      id: `failure:${persistenceKey}`,
      type: "memory.freshness.failure",
      idempotencyKey: `${persistenceKey}:failure:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: health.failureState.primaryRoute || "memory-manager/freshness-failure",
        failureState: health.failureState,
        actionableErrors: health.actionableErrors,
        operationalResolution: health.operationalResolution,
        retry: health.retry
      }
    });
  } else if (!freshness.fresh) {
    commands.push({
      id: `${health.degradedMode.active ? "degraded-hydrate" : health.status === "degraded" ? "retry-hydrate" : "hydrate"}:${persistenceKey}`,
      type: health.degradedMode.active
        ? "memory.hydration.degraded-retry"
        : health.status === "degraded"
          ? "memory.hydration.retry"
          : "memory.hydration.request",
      idempotencyKey: `${persistenceKey}:${freshness.reason}:${health.retry.attempts}:${state.generatedAt}`,
      payload: {
        ...commandBase,
        route: health.status === "degraded" ? "memory-manager/hydrate-context/retry" : "memory-manager/hydrate-context",
        reason: freshness.reason,
        ttlMs: state.ttlMs,
        staleSince: freshness.expiresAt,
        sourceProofDisposition: sourceProof.auditDisposition,
        acceptedEvidenceCount: freshness.acceptedEvidenceCount,
        rejectedEvidenceCount: freshness.rejectedEvidenceCount,
        currentStateClaimGate: freshness.currentStateClaimGate,
        currentStateClaimExposure: freshness.currentStateClaimGate.exposure,
        currentStateClaimClientHandoff: clientRuntime?.currentStateClaimHandoff || null,
        operationalResolution: {
          incidentId: health.operationalResolution.incidentId,
          status: health.operationalResolution.status,
          retryPlan: health.operationalResolution.retryPlan,
          degradedServing: health.operationalResolution.degradedServing,
          validationFindings: health.operationalResolution.validationFindings
        },
        degradedMode: health.degradedMode.active
          ? {
              active: true,
              reason: health.degradedMode.reason,
              staleBudgetMs: health.degradedMode.staleBudgetMs,
              staleBudgetRemainingMs: health.degradedMode.staleBudgetRemainingMs,
              circuitBreaker: health.degradedMode.circuitBreaker
            }
          : null,
        retryAfter: health.status === "degraded" ? health.retry.nextRetryAt : null,
        retryAttempt: health.retry.attempts
      }
    });
  } else if (state.lifecycle.schedule.enabled && state.lifecycle.schedule.nextRunAt) {
    commands.push({
      id: `schedule:${persistenceKey}`,
      type: "memory.freshness.schedule.next-check",
      idempotencyKey: `${persistenceKey}:schedule:${state.lifecycle.schedule.nextRunAt}`,
      payload: {
        ...commandBase,
        route: "memory-manager/freshness-gate/scheduler",
        nextRunAt: state.lifecycle.schedule.nextRunAt,
        intervalMs: state.lifecycle.schedule.intervalMs,
        nextAction: state.lifecycle.effective.nextAction,
        nextActionState: state.lifecycle.effective.nextActionState,
        settingsPatch: state.lifecycle.settingsPatch,
        auditProof: state.lifecycle.auditProof
      }
    });
  }

  const shapedCommands = commands.map((command) => {
    const prior = commandLedger.byIdempotencyKey[command.idempotencyKey] || null;
    const replayState = !prior
      ? "new-command"
      : prior.restartRecoveryState === "quarantine-clock-skew"
        ? "quarantined-recovered-command"
        : prior.terminal || prior.restartRecoveryState === "already-applied"
        ? "already-applied"
        : prior.status === "failed" && prior.attempts >= MAX_RETRY_ATTEMPTS
          ? "manual-recovery-required"
          : prior.status === "failed" || prior.restartRecoveryState === "retry-failed-command"
            ? "retry-failed-command"
            : "retry-pending-command";

    return {
      ...command,
      replay: {
        state: replayState,
        recoveredState: prior?.restartRecoveryState || null,
        priorStatus: prior?.status || null,
        priorCommandId: prior?.commandId || null,
        priorAttempts: prior?.attempts || 0,
        lastDispatchedAt: prior?.lastDispatchedAt || null,
        completedAt: prior?.completedAt || null,
        dispatchable:
          replayState !== "already-applied" &&
          replayState !== "manual-recovery-required" &&
          replayState !== "quarantined-recovered-command"
      }
    };
  });
  const nextLedgerEntries = [
    ...commandLedger.entries,
    ...shapedCommands.map((command, index) => ({
      sequence: commandLedger.entries.length + index + 1,
      commandId: command.id,
      type: command.type,
      topic: commandTopicFor(command.type),
      idempotencyKey: command.idempotencyKey,
      status: command.replay.dispatchable ? "queued" : command.replay.priorStatus || "skipped",
      terminal: command.replay.state === "already-applied",
      attempts: command.replay.priorAttempts,
      lastDispatchedAt: command.replay.lastDispatchedAt,
      completedAt: command.replay.completedAt,
      error: command.replay.state === "manual-recovery-required" ? "retry-attempts-exhausted-before-restart" : null,
      fromFuture: false
    }))
  ].slice(-MAX_COMMAND_LEDGER_HISTORY);

  return {
    status: !boundary.allowed
      ? "blocked-by-boundary"
      : !state.lifecycle.accepted
        ? "lifecycle-settings-rejected"
        : !state.lifecycle.effective.enabled
          ? "enforcement-disabled"
          : state.lifecycle.effective.paused
            ? "scheduled-refresh-paused"
            : health.status === "failed"
              ? "failed"
              : freshness.fresh
                ? "ready"
                : health.status === "degraded"
                  ? "degraded-retry-scheduled"
                  : "requires-rehydration",
    restartSafe:
      boundary.allowed &&
      state.lifecycle.accepted &&
      state.lifecycle.effective.enabled &&
      freshness.fresh &&
      Boolean(freshness.expiresAt) &&
      health.status !== "failed",
    recoveredStatus: recoveryStatus.status,
    recoveredSnapshot: recovered,
    recoveryStatus,
    commandReplay: {
      contract: "memory-freshness-gate.command-replay.v1",
      priorLedgerEntries: commandLedger.retainedEntries,
      duplicateEntriesCollapsed: commandLedger.duplicateEntriesCollapsed,
      truncatedEntries: commandLedger.truncatedEntries,
      restartRecovery: commandLedger.restartRecovery,
      dispatchableCommands: shapedCommands.filter((command) => command.replay.dispatchable).length,
      alreadyAppliedCommands: shapedCommands.filter((command) => command.replay.state === "already-applied").length,
      retryFailedCommands: shapedCommands.filter((command) => command.replay.state === "retry-failed-command").length,
      manualRecoveryCommands: shapedCommands.filter((command) => command.replay.state === "manual-recovery-required").length,
      quarantinedCommands: shapedCommands.filter((command) => command.replay.state === "quarantined-recovered-command").length
    },
    nextCommandLedger: {
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      contract: commandLedger.contract,
      generatedAt: state.generatedAt,
      retainedEntries: nextLedgerEntries.length,
      maxEntries: MAX_COMMAND_LEDGER_HISTORY,
      entries: nextLedgerEntries
    },
    commands: shapedCommands
  };
}

function commandTopicFor(type) {
  if (typeof type !== "string" || !type.trim()) {
    return "memory.freshness.unknown";
  }
  if (type.startsWith("memory.hydration.")) {
    return "memory.hydration";
  }
  if (type.startsWith("memory.boundary.")) {
    return "memory.boundary";
  }
  if (type.includes(".analytics.")) {
    return "memory.freshness.analytics";
  }
  if (type.includes(".client-")) {
    return "memory.freshness.client";
  }
  if (type.includes(".lifecycle.")) {
    return "memory.freshness.lifecycle";
  }
  if (type.includes(".schedule.")) {
    return "memory.freshness.scheduler";
  }
  if (type.includes(".source-proof.")) {
    return "memory.freshness.source-proof";
  }
  if (type.includes(".provider-sync.")) {
    return "memory.freshness.provider";
  }
  if (type.includes(".failure")) {
    return "memory.freshness.failure";
  }

  return "memory.freshness.state";
}

function deliveryPolicyFor(command, health, recovery) {
  const type = normalizeString(command.type) || "memory.freshness.unknown";
  const payload = command.payload && typeof command.payload === "object" ? command.payload : {};
  const retryAfter = toIsoTimestamp(payload.retryAfter || health.retry.nextRetryAt, null);
  if (command.replay && command.replay.dispatchable === false) {
    return {
      mode: "suppressed",
      retryable: command.replay.state === "manual-recovery-required",
      retryAfter: null,
      maxAttempts: health.retry.maxAttempts,
      priority: 0
    };
  }

  const urgent =
    recovery.status === "failed" ||
    type === "memory.boundary.audit" ||
    type === "memory.freshness.failure" ||
    type === "memory.hydration.request";
  const blocking =
    type === "memory.boundary.audit" ||
    type === "memory.freshness.failure" ||
    type === "memory.hydration.request" ||
    type === "memory.freshness.lifecycle.audit";

  return {
    mode: blocking ? "blocking" : urgent ? "expedited" : "eventual",
    retryable: payload.retryAfter ? true : health.retryable,
    retryAfter,
    maxAttempts: health.retry.maxAttempts,
    priority: blocking ? 100 : urgent ? 75 : type.includes(".analytics.") ? 25 : 50
  };
}

function buildHostedKernelDispatch(state, scopeProof, boundary, freshness, health, analytics, sourceProof, recovery) {
  const persistenceKey = buildPersistenceKey(state);
  const commandValidation = recovery.commands.map((command, index) => {
    const violations = [];
    if (!normalizeString(command.id)) {
      violations.push("missing-command-id");
    }
    if (!normalizeString(command.type)) {
      violations.push("missing-command-type");
    }
    if (!normalizeString(command.idempotencyKey)) {
      violations.push("missing-idempotency-key");
    }
    if (!command.payload || typeof command.payload !== "object" || Array.isArray(command.payload)) {
      violations.push("missing-command-payload");
    }

    return {
      index,
      commandId: normalizeString(command.id) || `command-${index + 1}`,
      type: normalizeString(command.type) || "memory.freshness.unknown",
      valid: violations.length === 0,
      violations
    };
  });
  const invalidCommands = commandValidation.filter((item) => !item.valid);
  const envelopes = recovery.commands.map((command, index) => {
    const commandId = normalizeString(command.id) || `command-${index + 1}`;
    const type = normalizeString(command.type) || "memory.freshness.unknown";
    const payload = command.payload && typeof command.payload === "object" ? command.payload : {};

    return {
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      contract: "memory-freshness-gate.hosted-kernel-command.v1",
      sequence: index + 1,
      envelopeId: `${persistenceKey}:dispatch:${index + 1}:${stableKeyPart(type, "command")}`,
      commandId,
      type,
      topic: commandTopicFor(type),
      route: normalizeString(payload.route) || state.route,
      idempotencyKey: normalizeString(command.idempotencyKey) || `${persistenceKey}:command:${index + 1}`,
      causality: {
        persistenceKey,
        requestId: state.requestId,
        clientId: state.clientId,
        conversationId: state.conversationId,
        tenantId: state.tenantId,
        workspaceId: state.workspaceId,
        generatedAt: state.generatedAt,
        analyticsSequence: analytics.currentSnapshot.sequence,
        recoveryStatus: recovery.status
      },
      delivery: deliveryPolicyFor(command, health, recovery),
      proofRef: {
        boundaryDisposition: boundary.auditDisposition,
        scopeProofDisposition: scopeProof.auditDisposition,
        scopeProofViolationCodes: scopeProof.violationCodes,
        workspaceAccessDisposition: boundary.workspaceAccess.auditDisposition,
        sourceProofDisposition: sourceProof.auditDisposition,
        freshnessStatus: freshness.fresh ? "fresh" : "stale",
        freshnessReason: freshness.reason,
        healthStatus: health.status,
        operationalIncidentId: health.operationalResolution.incidentId,
        operationalRoute: health.operationalResolution.primaryRoute,
        operationalDisposition: health.operationalResolution.auditDisposition,
        auditReportId: analytics.exportSummary.reportId
      },
      payload,
      replay: command.replay || {
        state: "new-command",
        priorStatus: null,
        priorCommandId: null,
        priorAttempts: 0,
        lastDispatchedAt: null,
        completedAt: null,
        dispatchable: true
      }
    };
  });
  const blockingEnvelopeIds = envelopes
    .filter((envelope) => envelope.delivery.mode === "blocking")
    .map((envelope) => envelope.envelopeId);
  const topicCounts = envelopes.reduce((counts, envelope) => {
    counts[envelope.topic] = (counts[envelope.topic] || 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.hosted-kernel-dispatch.v1",
    generatedAt: state.generatedAt,
    dispatcher: {
      route: "memory-manager/freshness-gate/dispatch",
      persistenceKey,
      commandCount: envelopes.length,
      blockingEnvelopeIds,
      topics: Object.keys(topicCounts).sort(),
      topicCounts,
      scopeProofDisposition: scopeProof.auditDisposition
    },
    validation: {
      valid: invalidCommands.length === 0,
      invalidCount: invalidCommands.length,
      commands: commandValidation
    },
    deliverySummary: {
      blocking: blockingEnvelopeIds.length,
      expedited: envelopes.filter((envelope) => envelope.delivery.mode === "expedited").length,
      eventual: envelopes.filter((envelope) => envelope.delivery.mode === "eventual").length,
      suppressed: envelopes.filter((envelope) => envelope.delivery.mode === "suppressed").length,
      retryable: envelopes.filter((envelope) => envelope.delivery.retryable).length
    },
    envelopes,
    auditDisposition: invalidCommands.length === 0 ? "hosted-kernel-dispatch-ready" : "hosted-kernel-dispatch-invalid"
  };
}

function normalizeClientWorkflowAcks(input, generatedAt) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const workflow =
    (request.memoryWorkflow && typeof request.memoryWorkflow === "object" && request.memoryWorkflow) ||
    (clientState.memoryWorkflow && typeof clientState.memoryWorkflow === "object" && clientState.memoryWorkflow) ||
    (input.memoryWorkflow && typeof input.memoryWorkflow === "object" && input.memoryWorkflow) ||
    {};
  const rawAcks = Array.isArray(workflow.acks)
    ? workflow.acks
    : Array.isArray(workflow.acknowledgements)
      ? workflow.acknowledgements
      : [];
  const generatedMs = Date.parse(generatedAt);

  return rawAcks
    .filter((ack) => ack && typeof ack === "object")
    .map((ack, index) => {
      const acknowledgedAt = toIsoTimestamp(ack.acknowledgedAt || ack.ackedAt || ack.completedAt, null);
      const acknowledgedMs = acknowledgedAt ? Date.parse(acknowledgedAt) : NaN;
      return {
        id: normalizeString(ack.id || ack.stepId || ack.commandId) || `client-workflow-ack-${index + 1}`,
        stepId: normalizeString(ack.stepId || ack.id || ack.commandId),
        commandId: normalizeString(ack.commandId),
        status: normalizeCommandStatus(ack.status || (acknowledgedAt ? "acked" : "pending")),
        acknowledgedAt,
        reason: normalizeString(ack.reason || ack.error),
        fromFuture: Number.isFinite(acknowledgedMs) && acknowledgedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS
      };
    })
    .slice(-MAX_CLIENT_WORKFLOW_ACKS);
}

function normalizeClientWorkflowPreference(input, generatedAt) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const workflow =
    (request.memoryWorkflow && typeof request.memoryWorkflow === "object" && request.memoryWorkflow) ||
    (clientState.memoryWorkflow && typeof clientState.memoryWorkflow === "object" && clientState.memoryWorkflow) ||
    (input.memoryWorkflow && typeof input.memoryWorkflow === "object" && input.memoryWorkflow) ||
    {};
  const rawMode = normalizeString(
    workflow.mode ||
      workflow.intent ||
      workflow.commitMode ||
      request.memoryWorkflowMode ||
      clientState.memoryWorkflowMode ||
      input.memoryWorkflowMode
  );
  const normalizedMode = rawMode?.toLowerCase().replace(/_/g, "-") || null;
  const supportedMode =
    normalizedMode && (CLIENT_WORKFLOW_MODE_ALIASES.has(normalizedMode) || CLIENT_WORKFLOW_MODES.has(normalizedMode));
  const mode = normalizedMode
    ? CLIENT_WORKFLOW_MODE_ALIASES.get(normalizedMode) ||
      (CLIENT_WORKFLOW_MODES.has(normalizedMode) ? normalizedMode : null)
    : null;
  const rawDeferUntil = normalizeString(workflow.deferUntil || workflow.deferredUntil || workflow.snoozeUntil);
  const deferUntil = toIsoTimestamp(rawDeferUntil, null);
  const generatedMs = Date.parse(generatedAt);
  const deferUntilMs = deferUntil ? Date.parse(deferUntil) : NaN;
  const explicitConfirmation = normalizeBoolean(
    workflow.requiresConfirmation ?? workflow.requireConfirmation ?? workflow.confirmBeforeCommit,
    null
  );
  const explicitStatePatch = normalizeBoolean(
    workflow.acceptsStatePatch ?? workflow.statePatchAccepted ?? workflow.patchAccepted,
    null
  );
  const maxDeferrals = normalizeInteger(workflow.maxDeferrals, 3, 0, 25);
  const deferralCount = normalizeInteger(
    workflow.deferralCount || workflow.deferredCount || clientState.memoryWorkflowDeferralCount,
    0,
    0,
    25
  );
  const targetRoute = normalizeString(workflow.route || workflow.nextRoute || workflow.commitRoute);
  const requestedStepIds = normalizeStringList(workflow.requestedStepIds || workflow.steps || workflow.stepIds);
  const requiredAckStepIds = normalizeStringList(
    workflow.requiredAckStepIds || workflow.requiredSteps || workflow.requiredAcknowledgements
  );
  const violations = [];

  if (rawMode && !supportedMode) {
    violations.push("client-workflow-mode-unsupported");
  }
  if (rawDeferUntil && !deferUntil) {
    violations.push("client-workflow-defer-until-invalid");
  }
  if (deferUntil && Number.isFinite(deferUntilMs) && deferUntilMs <= generatedMs) {
    violations.push("client-workflow-defer-until-expired");
  }
  if ((mode === "defer" || deferUntil) && deferralCount >= maxDeferrals) {
    violations.push("client-workflow-deferral-limit-reached");
  }

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.client-workflow-preference.v1",
    generatedAt,
    mode: mode || "auto",
    rawMode,
    requiresConfirmation: explicitConfirmation,
    acceptsStatePatch: explicitStatePatch,
    targetRoute,
    requestedStepIds,
    requiredAckStepIds,
    deferral: {
      requested: mode === "defer" || Boolean(deferUntil),
      deferUntil,
      deferralCount,
      maxDeferrals,
      remainingDeferrals: Math.max(0, maxDeferrals - deferralCount),
      valid:
        Boolean(deferUntil) &&
        Number.isFinite(deferUntilMs) &&
        deferUntilMs > generatedMs &&
        deferralCount < maxDeferrals
    },
    validation: {
      valid: violations.length === 0,
      violations
    },
    auditDisposition:
      violations.length > 0
        ? "client-workflow-preference-rejected"
        : mode === "defer" || deferUntil
          ? "client-workflow-preference-defer"
          : mode === "manual" || explicitConfirmation === true
            ? "client-workflow-preference-manual"
            : mode === "observe"
              ? "client-workflow-preference-observe"
              : "client-workflow-preference-auto"
  };
}

function normalizeClientAcceptance(input, generatedAt) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const workflow =
    (request.memoryWorkflow && typeof request.memoryWorkflow === "object" && request.memoryWorkflow) ||
    (clientState.memoryWorkflow && typeof clientState.memoryWorkflow === "object" && clientState.memoryWorkflow) ||
    (input.memoryWorkflow && typeof input.memoryWorkflow === "object" && input.memoryWorkflow) ||
    {};
  const acceptance =
    (request.memoryAcceptance && typeof request.memoryAcceptance === "object" && request.memoryAcceptance) ||
    (clientState.memoryAcceptance && typeof clientState.memoryAcceptance === "object" && clientState.memoryAcceptance) ||
    (workflow.acceptance && typeof workflow.acceptance === "object" && workflow.acceptance) ||
    (input.memoryAcceptance && typeof input.memoryAcceptance === "object" && input.memoryAcceptance) ||
    {};
  const acceptedAt = toIsoTimestamp(acceptance.acceptedAt || acceptance.acknowledgedAt || acceptance.committedAt, null);
  const acceptedMs = acceptedAt ? Date.parse(acceptedAt) : NaN;
  const generatedMs = Date.parse(generatedAt);
  const rawAccepted = acceptance.accepted ?? acceptance.previewAccepted ?? acceptance.confirmed ?? acceptance.commit;

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.client-acceptance-input.v1",
    receiptId: normalizeString(acceptance.receiptId || acceptance.id || acceptance.token),
    previewId: normalizeString(acceptance.previewId || acceptance.previewRef || acceptance.readinessId),
    accepted: normalizeBoolean(rawAccepted, null),
    decision: normalizeString(acceptance.decision || acceptance.action || acceptance.status),
    acceptedAt,
    actorId: normalizeString(acceptance.actorId || acceptance.subjectId || acceptance.userId),
    channel: normalizeString(acceptance.channel || workflow.channel),
    acceptedStepIds: normalizeStringList(acceptance.acceptedStepIds || acceptance.stepIds || acceptance.steps),
    acceptedValidationCodes: normalizeStringList(
      acceptance.acceptedValidationCodes || acceptance.validationCodes || acceptance.codes
    ),
    note: normalizeString(acceptance.note || acceptance.reason || acceptance.message),
    fromFuture: Number.isFinite(acceptedMs) && acceptedMs > generatedMs + MAX_SOURCE_CLOCK_SKEW_MS
  };
}

function buildClientAcceptanceContract(input, state, clientRuntime, clientReadiness) {
  const acceptance = normalizeClientAcceptance(input, state.generatedAt);
  const workflowPreference = normalizeClientWorkflowPreference(input, state.generatedAt);
  const requiredStepIds = clientReadiness.nextSteps.filter((step) => step.required).map((step) => step.id);
  const requiredValidationCodes = clientReadiness.validationSummary.items
    .filter((item) => item.severity === "fatal")
    .map((item) => item.code);
  const acceptanceRequired =
    clientRuntime.blocking ||
    clientReadiness.acceptance.requiresUserAction ||
    clientReadiness.validationSummary.fatalCount > 0 ||
    workflowPreference.mode === "manual" ||
    workflowPreference.requiresConfirmation === true;
  const missingStepIds = requiredStepIds.filter((stepId) => !acceptance.acceptedStepIds.includes(stepId));
  const missingValidationCodes = requiredValidationCodes.filter(
    (code) => !acceptance.acceptedValidationCodes.includes(code)
  );
  const validation = [];

  if (acceptanceRequired && acceptance.accepted !== true && !workflowPreference.deferral.valid) {
    validation.push({
      code: "CLIENT_ACCEPTANCE_REQUIRED",
      severity: "fatal",
      message: "Client must accept the memory freshness preview before the hosted-kernel handoff can commit.",
      route: clientRuntime.nextRoute
    });
  }
  for (const violation of workflowPreference.validation.violations) {
    validation.push({
      code: violation.toUpperCase().replace(/-/g, "_"),
      severity: violation === "client-workflow-deferral-limit-reached" ? "degraded" : "fatal",
      message: `Client workflow preference rejected: ${violation}.`,
      route: "memory-manager/freshness-gate/client-workflow"
    });
  }
  if (workflowPreference.mode === "observe" && clientRuntime.blocking) {
    validation.push({
      code: "CLIENT_WORKFLOW_OBSERVE_BLOCKED_BY_RUNTIME",
      severity: "fatal",
      message: "Client requested observe-only workflow, but the freshness handoff requires a blocking runtime action.",
      route: clientRuntime.nextRoute
    });
  }
  if (acceptance.accepted === true && acceptance.fromFuture) {
    validation.push({
      code: "CLIENT_ACCEPTANCE_FROM_FUTURE",
      severity: "fatal",
      message: "Client acceptance timestamp is beyond the hosted-kernel clock-skew allowance.",
      route: "memory-manager/freshness-gate/client-workflow"
    });
  }
  if (acceptance.accepted === true && acceptanceRequired && !acceptance.receiptId) {
    validation.push({
      code: "CLIENT_ACCEPTANCE_RECEIPT_MISSING",
      severity: "degraded",
      message: "Client accepted the preview without a durable receipt id.",
      route: "memory-manager/freshness-gate/client-workflow"
    });
  }
  if (acceptance.accepted === true && missingStepIds.length > 0) {
    validation.push({
      code: "CLIENT_ACCEPTANCE_STEP_COVERAGE_INCOMPLETE",
      severity: "degraded",
      message: "Client acceptance did not enumerate every required readiness step.",
      route: "memory-manager/freshness-gate/client-readiness",
      missing: missingStepIds
    });
  }
  if (acceptance.accepted === true && missingValidationCodes.length > 0) {
    validation.push({
      code: "CLIENT_ACCEPTANCE_VALIDATION_COVERAGE_INCOMPLETE",
      severity: "degraded",
      message: "Client acceptance did not acknowledge every fatal validation code.",
      route: "memory-manager/freshness-gate/client-readiness",
      missing: missingValidationCodes
    });
  }

  const fatal = validation.some((item) => item.severity === "fatal");
  const deferred =
    !fatal &&
    workflowPreference.deferral.requested &&
    workflowPreference.deferral.valid &&
    acceptance.accepted !== false;
  const accepted = !fatal && (deferred || !acceptanceRequired || acceptance.accepted === true);

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.client-acceptance.v1",
    generatedAt: state.generatedAt,
    workflowPreference,
    acceptanceRequired,
    accepted,
    state: accepted
      ? deferred
        ? "deferred"
        : acceptanceRequired
        ? "accepted"
        : "not-required"
      : acceptance.accepted === false
        ? "declined"
        : "pending",
    route: "memory-manager/freshness-gate/client-workflow",
    receipt: {
      receiptId:
        acceptance.receiptId ||
        `${buildPersistenceKey(state)}:client-acceptance:${stableKeyPart(clientReadiness.readiness.state, "state")}`,
      previewId: acceptance.previewId || clientReadiness.acceptance.proof.analyticsReportId,
      actorId: acceptance.actorId || state.principal.subjectId,
      channel: acceptance.channel || clientRuntime.handoff.channel,
      acceptedAt: acceptance.acceptedAt,
      decision:
        acceptance.decision ||
        (deferred
          ? "defer"
          : acceptance.accepted === true
            ? "accept"
            : acceptance.accepted === false
              ? "decline"
              : "pending"),
      note: acceptance.note
    },
    coverage: {
      requiredStepIds,
      acceptedStepIds: acceptance.acceptedStepIds,
      missingStepIds,
      requiredValidationCodes,
      acceptedValidationCodes: acceptance.acceptedValidationCodes,
      missingValidationCodes
    },
    validationSummary: {
      valid: validation.length === 0,
      fatalCount: validation.filter((item) => item.severity === "fatal").length,
      degradedCount: validation.filter((item) => item.severity === "degraded").length,
      items: validation
    },
    nextStep: accepted
      ? {
          id: deferred ? "defer-client-memory-workflow" : "commit-client-memory-workflow",
          route: deferred ? "memory-manager/freshness-gate/client-workflow" : clientRuntime.handoff.route,
          required: false,
          reason: deferred
            ? "client-workflow-deferral-accepted"
            : acceptanceRequired
              ? "client-acceptance-receipt-valid"
              : "client-acceptance-not-required",
          readyAt: deferred ? workflowPreference.deferral.deferUntil : null
        }
      : {
          id: "collect-client-acceptance",
          route: "memory-manager/freshness-gate/client-workflow",
          required: true,
          reason: validation[0]?.code || "client-acceptance-pending"
        },
    auditDisposition: accepted
      ? deferred
        ? "client-acceptance-deferred"
        : "client-acceptance-accepted"
      : "client-acceptance-pending"
  };
}

function buildClientWorkflowHandoff(input, state, handoff, clientRuntime, clientReadiness, clientAcceptance, providerSync, kernelDispatch) {
  const acks = normalizeClientWorkflowAcks(input, state.generatedAt);
  const workflowPreference = clientAcceptance.workflowPreference || normalizeClientWorkflowPreference(input, state.generatedAt);
  const ackIndex = acks.reduce((index, ack) => {
    if (ack.stepId) {
      index[ack.stepId] = ack;
    }
    if (ack.commandId) {
      index[ack.commandId] = ack;
    }
    return index;
  }, {});
  const blockingEnvelopes = kernelDispatch.envelopes.filter((envelope) => envelope.delivery.mode === "blocking");
  const explicitRequiredStepIds = new Set(workflowPreference.requiredAckStepIds);
  const requestedStepIds = new Set(workflowPreference.requestedStepIds);
  const manualConfirmation = workflowPreference.mode === "manual" || workflowPreference.requiresConfirmation === true;
  const observeOnly = workflowPreference.mode === "observe";
  const deferred = clientAcceptance.state === "deferred";
  const statePatchAccepted =
    clientRuntime.statePatch !== null &&
    workflowPreference.acceptsStatePatch !== false &&
    !observeOnly &&
    !deferred;
  const runtimeStep = {
    id: `runtime:${clientRuntime.action}`,
    kind: "client-runtime",
    route: workflowPreference.targetRoute || clientRuntime.nextRoute,
    required: clientRuntime.blocking || explicitRequiredStepIds.has(`runtime:${clientRuntime.action}`),
    status:
      deferred
        ? "deferred"
        : clientRuntime.blocking || explicitRequiredStepIds.has(`runtime:${clientRuntime.action}`)
          ? "pending"
          : "ready",
    label: clientRuntime.notification.message,
    action: clientRuntime.action,
    cacheDirective: clientRuntime.cacheDirective,
    retryAfter: clientRuntime.retryAfter,
    selected: requestedStepIds.size === 0 || requestedStepIds.has(`runtime:${clientRuntime.action}`),
    ack: ackIndex[`runtime:${clientRuntime.action}`] || null
  };
  const readinessSteps = clientReadiness.nextSteps.map((step) => {
    const ack = ackIndex[step.id] || ackIndex[step.route] || null;
    const required = step.required || explicitRequiredStepIds.has(step.id);
    return {
      id: step.id,
      kind: "client-readiness",
      route: step.route,
      required,
      status:
        ack?.status === "acked" || ack?.status === "completed"
          ? "acknowledged"
          : deferred && required
            ? "deferred"
            : required
              ? "pending"
              : "ready",
      label: step.label,
      reason: step.reason,
      retryAfter: step.retryAfter || step.readyAt || null,
      blockedBy: step.blockedBy || [],
      selected: requestedStepIds.size === 0 || requestedStepIds.has(step.id),
      ack
    };
  });
  const dispatchSteps = blockingEnvelopes.map((envelope) => {
    const ack = ackIndex[envelope.commandId] || ackIndex[envelope.envelopeId] || null;
    return {
      id: envelope.envelopeId,
      kind: "hosted-kernel-command",
      route: envelope.route,
      required: true,
      status:
        ack?.status === "acked" || ack?.status === "completed"
          ? "acknowledged"
          : deferred
            ? "deferred"
            : "pending",
      label: envelope.type,
      reason: envelope.proofRef.freshnessReason,
      retryAfter: envelope.delivery.retryAfter,
      commandId: envelope.commandId,
      topic: envelope.topic,
      selected: requestedStepIds.size === 0 || requestedStepIds.has(envelope.commandId) || requestedStepIds.has(envelope.envelopeId),
      ack
    };
  });
  const providerStep =
    providerSync.externalHandoff.blocking || providerSync.auditDisposition !== "provider-contract-accepted"
      ? [
          {
            id: `provider:${providerSync.provider.providerId}:${providerSync.externalHandoff.state}`,
            kind: "provider-handoff",
            route: providerSync.externalHandoff.route,
            required: providerSync.externalHandoff.blocking,
            status: providerSync.accepted ? "ready" : deferred ? "deferred" : "pending",
            label: providerSync.externalHandoff.state,
            reason: providerSync.externalHandoff.auditReason,
            retryAfter: providerSync.externalHandoff.retryAfter,
            operation: providerSync.externalOperation.operation,
            operationId: providerSync.externalOperation.operationId,
            blockedBy: [
              ...providerSync.negotiation.syncViolations,
              ...providerSync.negotiation.missingCapabilities,
              ...providerSync.negotiation.ackViolations
            ],
            selected:
              requestedStepIds.size === 0 ||
              requestedStepIds.has(`provider:${providerSync.provider.providerId}`) ||
              requestedStepIds.has(providerSync.externalHandoff.state),
            ack: ackIndex[`provider:${providerSync.provider.providerId}`] || null
          }
        ]
      : [];
  const steps = [runtimeStep, ...readinessSteps, ...dispatchSteps, ...providerStep];
  if (clientAcceptance.acceptanceRequired || clientAcceptance.validationSummary.items.length > 0) {
    steps.push({
      id: clientAcceptance.nextStep.id,
      kind: "client-acceptance",
      route: clientAcceptance.nextStep.route,
      required: clientAcceptance.nextStep.required || manualConfirmation,
      status: clientAcceptance.accepted ? "acknowledged" : "pending",
      label: clientAcceptance.receipt.decision,
      reason: clientAcceptance.nextStep.reason,
      retryAfter: clientAcceptance.nextStep.readyAt || null,
      blockedBy: clientAcceptance.validationSummary.items.map((item) => item.code),
      selected: true,
      ack: clientAcceptance.receipt
    });
  }
  const staleAcks = acks.filter((ack) => ack.fromFuture || !steps.some((step) => step.id === ack.stepId || step.commandId === ack.commandId));
  const pendingRequired = steps.filter((step) => step.required && step.status !== "acknowledged");
  const workflowState = deferred
    ? "client-workflow-deferred"
    : observeOnly && pendingRequired.length === 0
      ? "client-workflow-observe"
      : pendingRequired.length === 0
    ? "ready-for-client-commit"
    : clientRuntime.blocking
      ? "client-blocking-handoff"
      : "client-workflow-action-required";
  const commitStrategy =
    deferred
      ? "defer"
      : observeOnly
        ? "observe"
        : manualConfirmation
          ? "manual-confirm"
          : statePatchAccepted && pendingRequired.length === 0
            ? "auto-state-patch"
            : "await-acknowledgement";

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    contract: "memory-freshness-gate.client-workflow-handoff.v1",
    generatedAt: state.generatedAt,
    workflowId: `${buildPersistenceKey(state)}:workflow:${stableKeyPart(handoff.action, "action")}`,
    channel: clientRuntime.handoff.channel,
    route: workflowPreference.targetRoute || handoff.nextRoute,
    state: workflowState,
    preference: workflowPreference,
    commit: {
      required: !observeOnly && (pendingRequired.length > 0 || statePatchAccepted),
      strategy: commitStrategy,
      route: workflowPreference.targetRoute || clientRuntime.handoff.route,
      statePatchAccepted,
      clientAcceptanceAccepted: clientAcceptance.accepted,
      clientAcceptanceReceiptId: clientAcceptance.receipt.receiptId,
      blockingStepIds: pendingRequired.map((step) => step.id),
      staleAckIds: staleAcks.map((ack) => ack.id),
      deferredUntil: deferred ? workflowPreference.deferral.deferUntil : null
    },
    acceptance: clientAcceptance,
    steps,
    acknowledgements: {
      retained: acks.length,
      maxRetained: MAX_CLIENT_WORKFLOW_ACKS,
      accepted: acks.filter((ack) => !ack.fromFuture).length,
      rejected: staleAcks.length,
      items: acks
    },
    auditDisposition:
      workflowPreference.auditDisposition === "client-workflow-preference-rejected"
        ? "client-workflow-preference-rejected"
        : staleAcks.length > 0
        ? "client-workflow-ack-rejected"
        : deferred
          ? "client-workflow-handoff-deferred"
          : observeOnly
            ? "client-workflow-handoff-observe"
        : pendingRequired.length > 0
          ? "client-workflow-handoff-pending"
          : "client-workflow-handoff-ready"
  };
}

export function describeFreshnessGateSurface(input = {}) {
  const now = toIsoTimestamp(input.now, new Date().toISOString());
  const evidence = normalizeEvidence(input.evidence);
  const recovered = normalizePersistedFreshness(input, now);
  const commandLedger = normalizePersistedCommandLedger(input, now);
  const requestState = normalizeRequest(input, now);
  const scopeProof = evaluateTenantWorkspaceScope(input, requestState, recovered, now);
  const boundary = evaluateBoundary(requestState, recovered, scopeProof);
  const recoveryStatus = evaluateRecoveredFreshnessState(requestState, recovered, commandLedger, boundary, now);
  const sourceProof = evaluateSourceProof(input, requestState, evidence, now);
  const currentStateClaims = collectCurrentStateClaims(input, requestState, now);
  const operationalPolicy = normalizeOperationalPolicy(input, now);
  const freshness = evaluateFreshness(
    requestState,
    evidence,
    sourceProof,
    now,
    currentStateClaims,
    operationalPolicy
  );
  const operationalHealth = evaluateOperationalHealth(input, requestState, freshness, boundary, recovered, sourceProof, now);
  const analytics = buildFreshnessAnalytics(
    input,
    requestState,
    freshness,
    boundary,
    operationalHealth,
    recovered,
    evidence,
    sourceProof,
    now
  );
  const workflowHandoff = buildWorkflowHandoff(requestState, freshness, boundary, operationalHealth, analytics, sourceProof);
  const clientRuntime = buildClientRuntimeContract(
    input,
    requestState,
    freshness,
    boundary,
    operationalHealth,
    workflowHandoff,
    sourceProof
  );
  const clientReadiness = buildClientReadinessContract(
    requestState,
    freshness,
    boundary,
    operationalHealth,
    analytics,
    workflowHandoff,
    sourceProof
  );
  const clientAcceptance = buildClientAcceptanceContract(input, requestState, clientRuntime, clientReadiness);
  const providerSync = buildProviderSyncContract(input, requestState, freshness, boundary, operationalHealth, sourceProof);
  const handoff = {
    ...workflowHandoff,
    clientReadiness,
    clientAcceptance,
    clientRuntime,
    providerSync,
    requestStatePatch: {
      ...workflowHandoff.requestStatePatch,
      memoryFreshnessClient: clientReadiness,
      memoryFreshnessClientAcceptance: clientAcceptance,
      memoryFreshnessRuntime: clientRuntime.statePatch,
      memoryFreshnessProvider: providerSync,
      memoryFreshnessRecovery: recoveryStatus
    }
  };
  const persistedState = buildPersistedState(
    requestState,
    freshness,
    recovered,
    recoveryStatus,
    commandLedger,
    boundary,
    operationalHealth,
    analytics,
    sourceProof,
    clientReadiness,
    clientAcceptance,
    clientRuntime,
    providerSync
  );
  const recovery = buildRecoveryPlan(
    requestState,
    freshness,
    recovered,
    recoveryStatus,
    commandLedger,
    persistedState,
    boundary,
    operationalHealth,
    analytics,
    sourceProof,
    clientReadiness,
    clientAcceptance,
    clientRuntime,
    providerSync
  );
  persistedState.memoryFreshnessCommandLedger = recovery.nextCommandLedger;
  const kernelDispatch = buildHostedKernelDispatch(
    requestState,
    scopeProof,
    boundary,
    freshness,
    operationalHealth,
    analytics,
    sourceProof,
    recovery
  );
  const clientWorkflow = buildClientWorkflowHandoff(
    input,
    requestState,
    handoff,
    clientRuntime,
    clientReadiness,
    clientAcceptance,
    providerSync,
    kernelDispatch
  );
  handoff.clientWorkflow = clientWorkflow;
  handoff.requestStatePatch.memoryFreshness.currentStateClaimClientHandoff = clientRuntime.currentStateClaimHandoff;
  handoff.requestStatePatch.memoryFreshnessWorkflow = clientWorkflow;
  persistedState.memoryFreshnessWorkflow = clientWorkflow;

  return {
    ok:
      boundary.allowed &&
      requestState.lifecycle.accepted &&
      (requestState.lifecycle.effective.enabled ? freshness.fresh || operationalHealth.degradedMode.active : true) &&
      operationalHealth.status !== "failed",
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: "ai-os-wave1-hosted-kernel-boot-proof",
    contract: "hosted-kernel memory freshness gate v1",
    requestState,
    scopeProof,
    boundary,
    freshness,
    sourceProof,
    operationalHealth,
    analytics,
    clientReadiness,
    clientAcceptance,
    clientRuntime,
    clientWorkflow,
    providerSync,
    handoff,
    persistedState,
    recovery,
    kernelDispatch,
    audit: {
      decision: handoff.action,
      proof: {
        persistenceKey: persistedState.persistenceKey,
        tenantId: requestState.tenantId,
        workspaceId: requestState.workspaceId,
        boundaryDisposition: boundary.auditDisposition,
        boundaryViolations: boundary.violations,
        scopeProofDisposition: scopeProof.auditDisposition,
        scopeProofClaimCounts: scopeProof.claimCounts,
        scopeProofViolations: scopeProof.violations,
        workspaceAccessDisposition: boundary.workspaceAccess.auditDisposition,
        workspaceAccessConstrained: boundary.workspaceAccess.constrained,
        workspaceAccessSource: boundary.workspaceAccess.source,
        workspaceAccessViolations: boundary.workspaceAccess.deniedViolations,
        ttlMs: requestState.ttlMs,
        lastHydratedAt: requestState.lastHydratedAt,
        latestEvidenceAt: freshness.latestEvidenceAt,
        currentStateClaimGateDisposition: freshness.currentStateClaimGate.auditDisposition,
        currentStateClaimExposureDisposition: freshness.currentStateClaimGate.exposure.auditDisposition,
        currentStateClaimsObserved: freshness.currentStateClaimGate.retainedClaims,
        currentStateClaimsBlocked: freshness.currentStateClaimGate.blockingClaims,
        currentStateClaimsDegraded: freshness.currentStateClaimGate.degradedClaims,
        currentStateClaimsRedacted: freshness.currentStateClaimGate.exposure.redacted,
        currentStateClaimsUsableWithWarning: freshness.currentStateClaimGate.exposure.usableWithWarning,
        currentStateClaimRedactedIds: freshness.currentStateClaimGate.exposure.redactedIds,
        currentStateClaimWarningIds: freshness.currentStateClaimGate.exposure.warningIds,
        currentStateClaimViolations: freshness.currentStateClaimGate.violationCodes,
        sourceProofDisposition: sourceProof.auditDisposition,
        sourceProofValid: sourceProof.valid,
        rejectedEvidenceCount: sourceProof.rejectedEvidenceCount,
        ageMs: freshness.ageMs,
        reason: freshness.reason,
        healthStatus: operationalHealth.status,
        healthFailureCodes: operationalHealth.failureState.codes,
        operationalIncidentId: operationalHealth.operationalResolution.incidentId,
        operationalRoute: operationalHealth.operationalResolution.primaryRoute,
        operationalResolutionDisposition: operationalHealth.operationalResolution.auditDisposition,
        operationalRetryPlan: operationalHealth.operationalResolution.retryPlan,
        operationalValidationFindings: operationalHealth.operationalResolution.validationFindings,
        degradedModeActive: operationalHealth.degradedMode.active,
        degradedModeReason: operationalHealth.degradedMode.reason,
        degradedStaleBudgetRemainingMs: operationalHealth.degradedMode.staleBudgetRemainingMs,
        refreshCircuitState: operationalHealth.degradedMode.circuitBreaker.state,
        retryable: operationalHealth.retryable,
        nextRetryAt: operationalHealth.retry.nextRetryAt,
        lifecycle: requestState.lifecycle,
        restartSafe: recovery.restartSafe,
        recoveredStatus: recovery.recoveredStatus,
        recoveredStateAccepted: recoveryStatus.accepted,
        recoveredStateReason: recoveryStatus.reason,
        recoveredStateViolations: recoveryStatus.violations,
        commandReplay: recovery.commandReplay,
        nextCommandLedgerEntries: recovery.nextCommandLedger.retainedEntries,
        commandCount: recovery.commands.length,
        kernelDispatchDisposition: kernelDispatch.auditDisposition,
        kernelDispatchTopics: kernelDispatch.dispatcher.topics,
        blockingDispatchCount: kernelDispatch.deliverySummary.blocking,
        analyticsReportId: analytics.exportSummary.reportId,
        analyticsSequence: analytics.currentSnapshot.sequence,
        analyticsCounters: analytics.counters,
        analyticsReportingState: analytics.reporting.trend.freshnessDebt,
        analyticsDominantStatus: analytics.reporting.trend.dominantStatus,
        analyticsDominantFailureCode: analytics.reporting.trend.dominantFailureCode,
        analyticsRetainedSnapshots: analytics.reporting.window.retainedSnapshots,
        clientRuntimeDisposition: clientRuntime.auditDisposition,
        clientRuntimeCacheDirective: clientRuntime.cacheDirective,
        clientAcceptanceDisposition: clientAcceptance.auditDisposition,
        clientAcceptanceRequired: clientAcceptance.acceptanceRequired,
        clientAcceptanceState: clientAcceptance.state,
        clientAcceptanceReceiptId: clientAcceptance.receipt.receiptId,
        clientWorkflowDisposition: clientWorkflow.auditDisposition,
        clientWorkflowState: clientWorkflow.state,
        clientWorkflowMode: clientWorkflow.preference.mode,
        clientWorkflowCommitStrategy: clientWorkflow.commit.strategy,
        clientWorkflowDeferredUntil: clientWorkflow.commit.deferredUntil,
        clientWorkflowBlockingSteps: clientWorkflow.commit.blockingStepIds,
        providerSyncDisposition: providerSync.auditDisposition,
        providerHandoffState: providerSync.externalHandoff.state,
        providerHandoffPhase: providerSync.externalHandoff.phase,
        providerExternalOperation: providerSync.externalOperation.operation,
        providerExternalOperationId: providerSync.externalOperation.operationId,
        providerExternalOperationCanExecute: providerSync.externalOperation.canExecute,
        providerSyncMode: providerSync.syncMetadata.mode,
        providerRequestedSyncMode: providerSync.syncMetadata.requestedMode,
        providerSyncViolations: providerSync.negotiation.syncViolations,
        providerMissingCapabilities: providerSync.negotiation.missingCapabilities,
        providerSyncCursor: providerSync.syncMetadata.cursor,
        providerSyncWatermark: providerSync.syncMetadata.watermark
      }
    },
    evidence
  };
}

export default describeFreshnessGateSurface;
