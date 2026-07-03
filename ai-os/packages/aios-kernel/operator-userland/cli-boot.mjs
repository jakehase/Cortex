export const surfaceId = "aios_operator-userland_cli-boot_081";
export const surfaceGroup = "operator-userland";
export const surfaceName = "cli-boot";

const DEFAULT_BOOT_ROUTE = "operator-userland.cli-boot";
const KNOWN_HANDOFFS = new Set(["resume", "plan", "execute", "audit"]);
const KNOWN_COMMANDS = new Set(["status", "resume", "plan", "execute", "audit", "recover"]);
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "failed"]);
const RECOVERABLE_STATUSES = new Set(["booting", "interrupted", "recovering"]);
const WRITABLE_COMMANDS = new Set(["resume", "recover", "plan", "execute"]);
const KNOWN_LIFECYCLE_MODES = new Set(["active", "paused", "maintenance", "disabled"]);
const KNOWN_SCHEDULE_MODES = new Set(["immediate", "queued", "maintenance-window"]);
const DEFAULT_TENANT_ID = "local-tenant";
const DEFAULT_WORKSPACE_ID = "default-workspace";
const DEFAULT_ARTIFACT_ROOT = ".aios/boot-artifacts";
const HEALTH_SEVERITY_RANK = { ok: 0, warn: 1, degraded: 2, failed: 3 };
const KNOWN_WRITE_STATUSES = new Set(["pending", "committed", "failed"]);
const KNOWN_WRITE_KINDS = new Set(["checkpoint", "command-result", "handoff", "audit-proof"]);
const KNOWN_WRITE_ACK_STATUSES = new Set(["accepted", "committed", "rejected"]);
const KNOWN_COMMAND_RESULT_STATUSES = new Set(["pending", "succeeded", "failed", "cancelled"]);
const KNOWN_CLIENT_CHANNELS = new Set(["terminal", "json-rpc", "websocket", "agent"]);
const KNOWN_HANDOFF_DELIVERY_MODES = new Set(["inline", "callback", "queued", "manual"]);
const KNOWN_CLIENT_RUNTIME_ACK_TRANSPORTS = new Set(["stdio", "http", "websocket", "event-log"]);
const KNOWN_PROVIDER_SYNC_MODES = new Set(["push", "pull", "bidirectional", "manual"]);
const KNOWN_HANDOFF_RECEIPT_STATUSES = new Set(["accepted", "delivered", "pending", "failed", "timed-out", "skipped"]);
const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000
};
const COMMAND_ACK_DEADLINES_MS = {
  status: 500,
  audit: 1000,
  resume: 2500,
  recover: 5000,
  plan: 7500,
  execute: 15000
};
const HANDOFF_ACK_POLICIES = {
  resume: "session-accepted",
  plan: "plan-opened",
  execute: "runtime-dispatched",
  audit: "proof-rendered"
};
const HANDOFF_TARGET_PROVIDERS = {
  resume: "hosted-kernel",
  plan: "plan-service",
  execute: "runtime-dispatcher",
  audit: "audit-ledger"
};
const COMMAND_PREFERRED_HANDOFFS = {
  status: "audit",
  audit: "audit",
  resume: "resume",
  recover: "resume",
  plan: "plan",
  execute: "execute"
};
const COMMAND_CAPABILITIES = {
  status: ["workspace:read"],
  audit: ["workspace:read", "audit:read"],
  resume: ["workspace:read", "session:resume"],
  recover: ["workspace:read", "session:recover"],
  plan: ["workspace:read", "plan:write"],
  execute: ["workspace:read", "runtime:execute"]
};
const DEFAULT_PROVIDER_SERVICES = {
  "hosted-kernel": {
    status: "available",
    version: "local",
    capabilities: ["kernel:read", "kernel:heartbeat", "handoff:receive"],
    syncCursor: "kernel:local",
    handoffUri: "aios://hosted-kernel/cli-boot"
  },
  "session-store": {
    status: "available",
    version: "local",
    capabilities: ["session:read", "session:write", "session:resume", "session:recover"],
    syncCursor: "session:local",
    handoffUri: "aios://session-store/cli-boot"
  },
  "audit-ledger": {
    status: "available",
    version: "local",
    capabilities: ["audit:append", "audit:read", "proof:emit"],
    syncCursor: "audit:local",
    handoffUri: "aios://audit-ledger/cli-boot"
  },
  "plan-service": {
    status: "available",
    version: "local",
    capabilities: ["plan:open", "plan:write", "handoff:receive"],
    syncCursor: "plan:local",
    handoffUri: "aios://plan-service/cli-boot"
  },
  "runtime-dispatcher": {
    status: "available",
    version: "local",
    capabilities: ["runtime:dispatch", "runtime:observe", "handoff:receive"],
    syncCursor: "runtime:local",
    handoffUri: "aios://runtime-dispatcher/cli-boot"
  }
};
const COMMAND_PROVIDER_REQUIREMENTS = {
  status: {
    "hosted-kernel": ["kernel:read"],
    "session-store": ["session:read"]
  },
  audit: {
    "audit-ledger": ["audit:read", "proof:emit"]
  },
  resume: {
    "hosted-kernel": ["handoff:receive"],
    "session-store": ["session:resume"]
  },
  recover: {
    "hosted-kernel": ["handoff:receive"],
    "session-store": ["session:recover", "session:write"],
    "audit-ledger": ["audit:append"]
  },
  plan: {
    "hosted-kernel": ["handoff:receive"],
    "plan-service": ["plan:open", "plan:write"]
  },
  execute: {
    "hosted-kernel": ["handoff:receive"],
    "runtime-dispatcher": ["runtime:dispatch", "runtime:observe"],
    "audit-ledger": ["audit:append"]
  }
};
const COMMAND_SYNC_REQUIREMENTS = {
  status: { maxPendingOperations: 100, requireProviderAck: false, handoffClaimRequired: false },
  audit: { maxPendingOperations: 20, requireProviderAck: true, handoffClaimRequired: false },
  resume: { maxPendingOperations: 5, requireProviderAck: true, handoffClaimRequired: true },
  recover: { maxPendingOperations: 0, requireProviderAck: true, handoffClaimRequired: true },
  plan: { maxPendingOperations: 10, requireProviderAck: true, handoffClaimRequired: true },
  execute: { maxPendingOperations: 0, requireProviderAck: true, handoffClaimRequired: true }
};
const ROLE_CAPABILITIES = {
  owner: ["workspace:read", "audit:read", "session:resume", "session:recover", "plan:write", "runtime:execute"],
  operator: ["workspace:read", "audit:read", "session:resume", "session:recover", "plan:write", "runtime:execute"],
  maintainer: ["workspace:read", "audit:read", "session:resume", "session:recover", "plan:write"],
  auditor: ["workspace:read", "audit:read"],
  viewer: ["workspace:read"]
};

function readString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeArgs(argv) {
  if (!Array.isArray(argv)) return [];
  return argv
    .filter((arg) => typeof arg === "string")
    .map((arg) => arg.trim())
    .filter(Boolean);
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => readString(item, "")).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(",").map((item) => readString(item, "")).filter(Boolean);
  }

  return [];
}

function readNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeArtifactPathSegment(value, fallback) {
  const segment = readString(value, fallback)
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("-");

  return segment || fallback;
}

function joinArtifactPath(...parts) {
  const normalizedParts = parts
    .map((part, index) => {
      const normalized = readString(part, "").replaceAll("\\", "/");
      return index === 0 ? normalized.replace(/\/+$/g, "") : normalized.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean)
    .join("/");

  return normalizedParts || DEFAULT_ARTIFACT_ROOT;
}

function pathIsBelow(basePath, candidatePath) {
  const base = readString(basePath, "").replaceAll("\\", "/").replace(/\/+$/g, "");
  const candidate = readString(candidatePath, "").replaceAll("\\", "/").replace(/\/+$/g, "");
  return Boolean(base && candidate && candidate !== base && candidate.startsWith(`${base}/`));
}

function expectedArtifactExtension(contentType) {
  if (contentType === "application/jsonl") return ".jsonl";
  if (contentType === "application/json") return ".json";
  return "";
}

function buildArtifactInitializationPlan(artifacts, artifactFiles, status, now) {
  const requiredFiles = artifactFiles.filter((artifact) => artifact.required);
  const optionalFiles = artifactFiles.filter((artifact) => !artifact.required);
  const writableFiles = artifactFiles.filter((artifact) => artifact.status === "ready" || artifact.status === "optional");
  const directoryPlan = [
    {
      kind: "artifact-root",
      path: artifacts.root,
      required: true,
      existsExpected: true
    },
    {
      kind: "artifact-base",
      path: artifacts.basePath,
      required: true,
      existsExpected: true
    }
  ];

  return {
    version: "cli-boot.artifact-initialization-plan.v1",
    status: status === "blocked" ? "blocked" : "ready",
    root: artifacts.root,
    basePath: artifacts.basePath,
    retentionKey: artifacts.retentionKey,
    directoryPlan,
    filePlan: artifactFiles.map((artifact) => ({
      kind: artifact.kind,
      path: artifact.path,
      contentType: artifact.contentType,
      required: artifact.required,
      status: artifact.status,
      writeId: artifact.writeId,
      writeMode: artifact.required ? "write-atomically" : "write-if-present",
      verifierRole: artifact.kind === "boot-proof"
        ? "primary-proof"
        : artifact.kind === "handoff-manifest"
          ? "handoff-contract"
          : "append-only-audit-ledger",
      handoffField: artifact.handoffField,
      sequence: artifact.sequence
    })),
    counts: {
      required: requiredFiles.length,
      optional: optionalFiles.length,
      writable: writableFiles.length
    },
    initializedAt: now
  };
}

function parseCliFlags(argv) {
  const flags = {};
  const passthrough = [];

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      passthrough.push(arg);
      continue;
    }

    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    flags[key] = rawValue.length ? rawValue.join("=") : true;
  }

  return { flags, passthrough };
}

function normalizeBootCommand(input, parsed) {
  const positionalCommand = parsed.passthrough[0] && !parsed.passthrough[0].startsWith("-");
  const requestedCommand = readString(input.command || parsed.flags.command || positionalCommand, "status");
  return KNOWN_COMMANDS.has(requestedCommand) ? requestedCommand : "status";
}

function normalizeWorkspaceScope(input, parsed) {
  const tenantId = readString(input.tenantId || parsed.flags.tenant || parsed.flags.tenantId, DEFAULT_TENANT_ID);
  const workspaceId = readString(
    input.workspaceId || parsed.flags.workspace || parsed.flags.workspaceId,
    DEFAULT_WORKSPACE_ID
  );
  const workspaceRoot = readString(input.workspaceRoot || parsed.flags.workspaceRoot, "");
  const allowedTenants = normalizeStringList(input.allowedTenants || parsed.flags.allowedTenants);
  const allowedWorkspaces = normalizeStringList(input.allowedWorkspaces || parsed.flags.allowedWorkspaces);
  const workspaceKey = `${tenantId}/${workspaceId}`;

  return {
    tenantId,
    workspaceId,
    workspaceRoot,
    workspaceKey,
    allowedTenants,
    allowedWorkspaces,
    tenantAllowed: allowedTenants.length === 0 || allowedTenants.includes(tenantId),
    workspaceAllowed: allowedWorkspaces.length === 0
      || allowedWorkspaces.includes(workspaceId)
      || allowedWorkspaces.includes(workspaceKey)
  };
}

function normalizeOperatorRoles(input, parsed) {
  const roles = normalizeStringList(input.roles || parsed.flags.roles);
  return roles.length ? roles : ["viewer"];
}

function resolveGrantedCapabilities(input, parsed, roles) {
  const explicitPermissions = normalizeStringList(input.permissions || parsed.flags.permissions);
  const granted = new Set(explicitPermissions);

  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role] || []) {
      granted.add(capability);
    }
  }

  return Array.from(granted).sort();
}

function normalizeProviderRecord(name, source = {}, now) {
  const defaults = DEFAULT_PROVIDER_SERVICES[name] || {};
  const rawStatus = readString(source.status, defaults.status || "unavailable");
  const status = ["available", "degraded", "unavailable"].includes(rawStatus) ? rawStatus : "unavailable";
  const rawSyncMode = readString(source.syncMode || source.sync?.mode, "bidirectional");
  const syncMode = KNOWN_PROVIDER_SYNC_MODES.has(rawSyncMode) ? rawSyncMode : "manual";
  const syncCursor = readString(source.syncCursor || source.cursor || source.sync?.cursor, defaults.syncCursor || `${name}:unsynced`);
  const ackCursor = readString(source.ackCursor || source.sync?.ackCursor, syncCursor);
  const capabilities = normalizeStringList(source.capabilities).length
    ? normalizeStringList(source.capabilities)
    : normalizeStringList(defaults.capabilities);

  return {
    name,
    status,
    version: readString(source.version, defaults.version || "unknown"),
    endpoint: readString(source.endpoint, ""),
    handoffUri: readString(source.handoffUri, defaults.handoffUri || ""),
    capabilities: Array.from(new Set(capabilities)).sort(),
    sync: {
      mode: syncMode,
      cursor: syncCursor,
      ackCursor,
      lastSyncedAt: readString(source.lastSyncedAt || source.sync?.lastSyncedAt, now),
      lastAckedAt: readString(source.lastAckedAt || source.sync?.lastAckedAt, ackCursor ? now : ""),
      pendingOperations: Math.max(0, Math.floor(readNumber(source.pendingOperations ?? source.sync?.pendingOperations, 0))),
      leaseId: readString(source.leaseId || source.sync?.leaseId, ""),
      externallyManaged: readBoolean(source.externallyManaged ?? source.sync?.externallyManaged, false)
    }
  };
}

function normalizeProviderServices(input, parsed, now) {
  const providerInput = input.providerServices && typeof input.providerServices === "object" ? input.providerServices : {};
  const requestedProviders = new Set([
    ...Object.keys(DEFAULT_PROVIDER_SERVICES),
    ...Object.keys(providerInput),
    ...normalizeStringList(input.providers || parsed.flags.providers)
  ]);

  return Array.from(requestedProviders)
    .sort()
    .map((name) => normalizeProviderRecord(name, providerInput[name], now));
}

function negotiateProviderContract(command, providers, now) {
  const byName = new Map(providers.map((provider) => [provider.name, provider]));
  const requirements = COMMAND_PROVIDER_REQUIREMENTS[command] || COMMAND_PROVIDER_REQUIREMENTS.status;
  const requiredProviderNames = Object.keys(requirements);
  const negotiations = requiredProviderNames.map((name) => {
    const provider = byName.get(name) || normalizeProviderRecord(name, { status: "unavailable" }, now);
    const requiredCapabilities = requirements[name];
    const missingCapabilities = requiredCapabilities.filter((capability) => !provider.capabilities.includes(capability));
    const available = provider.status !== "unavailable" && missingCapabilities.length === 0;

    return {
      provider: name,
      status: provider.status,
      available,
      version: provider.version,
      handoffUri: provider.handoffUri,
      requiredCapabilities,
      grantedCapabilities: provider.capabilities,
      missingCapabilities,
      sync: provider.sync
    };
  });
  const unavailableProviders = negotiations
    .filter((item) => !item.available)
    .map((item) => item.provider);
  const degradedProviders = negotiations
    .filter((item) => item.available && item.status === "degraded")
    .map((item) => item.provider);

  return {
    version: "cli-boot.provider-contract.v1",
    status: unavailableProviders.length ? "blocked" : degradedProviders.length ? "degraded" : "ready",
    command,
    requiredProviders: requiredProviderNames,
    unavailableProviders,
    degradedProviders,
    negotiations,
    syncWatermark: stableStateFingerprint(negotiations.map((item) => item.sync.cursor)),
    negotiatedAt: now
  };
}

function buildProviderServiceSyncContract(command, providerContract, scope, requestId, now) {
  const requirement = COMMAND_SYNC_REQUIREMENTS[command] || COMMAND_SYNC_REQUIREMENTS.status;
  const claims = providerContract.negotiations.map((negotiation) => {
    const pendingWithinLimit = negotiation.sync.pendingOperations <= requirement.maxPendingOperations;
    const ackSatisfied = !requirement.requireProviderAck || Boolean(negotiation.sync.ackCursor);
    const claimable = negotiation.available && pendingWithinLimit && ackSatisfied;
    const handoffClaimRequired = requirement.handoffClaimRequired && negotiation.requiredCapabilities.includes("handoff:receive");
    const action = !negotiation.available
      ? "wait-provider"
      : !ackSatisfied
        ? "wait-provider-ack-cursor"
        : !pendingWithinLimit
          ? "apply-sync-backpressure"
          : handoffClaimRequired
            ? "claim-external-handoff"
            : "continue";
    const claimToken = claimable
      ? `sync-claim:${stableStateFingerprint([
        requestId,
        scope.workspaceKey,
        command,
        negotiation.provider,
        negotiation.sync.cursor,
        negotiation.sync.ackCursor,
        negotiation.sync.pendingOperations
      ])}`
      : "";

    return {
      provider: negotiation.provider,
      status: negotiation.status,
      available: negotiation.available,
      syncMode: negotiation.sync.mode,
      cursor: negotiation.sync.cursor,
      ackCursor: negotiation.sync.ackCursor,
      lastSyncedAt: negotiation.sync.lastSyncedAt,
      lastAckedAt: negotiation.sync.lastAckedAt,
      pendingOperations: negotiation.sync.pendingOperations,
      leaseId: negotiation.sync.leaseId,
      externallyManaged: negotiation.sync.externallyManaged,
      maxPendingOperations: requirement.maxPendingOperations,
      requireProviderAck: requirement.requireProviderAck,
      handoffClaimRequired,
      inSync: claimable,
      action,
      claimToken
    };
  });
  const unavailableClaims = claims.filter((claim) => !claim.available);
  const missingAckClaims = claims.filter((claim) => claim.available && requirement.requireProviderAck && !claim.ackCursor);
  const backpressureClaims = claims.filter((claim) => claim.available && claim.pendingOperations > claim.maxPendingOperations);
  const claimableProviders = claims.filter((claim) => claim.claimToken).map((claim) => claim.provider);

  return {
    version: "cli-boot.provider-service-sync.v1",
    status: unavailableClaims.length || missingAckClaims.length
      ? "blocked"
      : backpressureClaims.length
        ? "backpressure"
        : "in-sync",
    command,
    workspaceKey: scope.workspaceKey,
    requirement,
    claimableProviders,
    blockedProviders: unavailableClaims.map((claim) => claim.provider),
    backpressureProviders: backpressureClaims.map((claim) => claim.provider),
    missingAckProviders: missingAckClaims.map((claim) => claim.provider),
    pendingOperations: claims.reduce((total, claim) => total + claim.pendingOperations, 0),
    syncFingerprint: stableStateFingerprint(claims.map((claim) => [
      claim.provider,
      claim.cursor,
      claim.ackCursor,
      claim.pendingOperations,
      claim.action
    ].join(":"))),
    claims,
    negotiatedAt: now
  };
}

function buildProviderHandoffClaimState(state, now) {
  const targetProvider = HANDOFF_TARGET_PROVIDERS[state.handoff] || "hosted-kernel";
  const targetNegotiation = resolveProviderNegotiation(state, targetProvider);
  const requiredClaims = state.providerSyncContract.claims.filter((claim) => claim.handoffClaimRequired);
  const claimRecords = state.providerSyncContract.claims.map((claim) => {
    const requiresExternalLease = claim.handoffClaimRequired && claim.externallyManaged && !claim.leaseId;
    const readyForClaim = claim.available
      && claim.inSync
      && (!claim.handoffClaimRequired || Boolean(claim.claimToken))
      && !requiresExternalLease;
    const claimStatus = !claim.available
      ? "provider-unavailable"
      : requiresExternalLease
        ? "external-lease-required"
        : claim.pendingOperations > claim.maxPendingOperations
          ? "waiting-sync-drain"
          : claim.requireProviderAck && !claim.ackCursor
            ? "waiting-provider-ack"
            : claim.handoffClaimRequired && claim.claimToken
              ? "claimed"
              : claim.handoffClaimRequired
                ? "claim-required"
                : "not-required";

    return {
      provider: claim.provider,
      status: claimStatus,
      required: claim.handoffClaimRequired,
      available: claim.available,
      readyForHandoff: readyForClaim,
      action: claim.action,
      claimToken: claim.claimToken,
      cursor: claim.cursor,
      ackCursor: claim.ackCursor,
      syncMode: claim.syncMode,
      pendingOperations: claim.pendingOperations,
      maxPendingOperations: claim.maxPendingOperations,
      leaseId: claim.leaseId,
      externallyManaged: claim.externallyManaged,
      receiptPolicy: HANDOFF_ACK_POLICIES[state.handoff] || "handoff-observed"
    };
  });
  const requiredProviderNames = requiredClaims.map((claim) => claim.provider);
  const claimedProviderNames = claimRecords
    .filter((claim) => claim.required && claim.claimToken)
    .map((claim) => claim.provider);
  const missingLeaseProviders = claimRecords
    .filter((claim) => claim.status === "external-lease-required")
    .map((claim) => claim.provider);
  const waitingProviders = claimRecords
    .filter((claim) => claim.required && !claim.readyForHandoff && claim.status !== "external-lease-required")
    .map((claim) => claim.provider);
  const targetReady = targetNegotiation.available && Boolean(targetNegotiation.handoffUri);
  const status = !targetReady || missingLeaseProviders.length || state.providerSyncContract.status === "blocked"
    ? "blocked"
    : state.providerSyncContract.status === "backpressure" || waitingProviders.length
      ? "waiting"
      : requiredProviderNames.length && claimedProviderNames.length < requiredProviderNames.length
        ? "claim-required"
        : "ready";
  const claimFingerprint = stableStateFingerprint([
    state.requestId,
    state.scope.workspaceKey,
    state.command,
    state.handoff,
    targetProvider,
    state.providerSyncContract.syncFingerprint,
    ...claimRecords.map((claim) => [
      claim.provider,
      claim.status,
      claim.claimToken,
      claim.cursor,
      claim.ackCursor,
      claim.leaseId
    ].join(":"))
  ]);

  return {
    version: "cli-boot.provider-handoff-claim.v1",
    status,
    targetProvider,
    targetHandoffUri: targetNegotiation.handoffUri,
    targetProviderStatus: targetNegotiation.status,
    targetReady,
    requiredProviderNames,
    claimedProviderNames,
    waitingProviders,
    missingLeaseProviders,
    claimRecords,
    claimFingerprint,
    nextAction: status === "ready"
      ? "attach-provider-handoff-claims"
      : status === "waiting"
        ? "wait-provider-handoff-claim"
        : status === "claim-required"
          ? "issue-provider-handoff-claim"
          : "block-provider-handoff-claim",
    negotiatedAt: now
  };
}

function resolveBoundaryDecision(command, handoff, scope, roles, capabilities) {
  const requiredCapabilities = COMMAND_CAPABILITIES[command] || ["workspace:read"];
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  const violations = [];

  if (!scope.tenantAllowed) violations.push("tenant-not-allowed");
  if (!scope.workspaceAllowed) violations.push("workspace-not-allowed");
  if (missingCapabilities.length) violations.push("capability-missing");

  const readOnly = command === "status" || command === "audit" || handoff === "audit";
  const denied = violations.length > 0;

  return {
    status: denied ? "denied" : "granted",
    enforcement: denied ? (readOnly ? "read-only-redacted" : "blocked") : "scoped",
    readOnly,
    roles,
    requiredCapabilities,
    grantedCapabilities: capabilities,
    missingCapabilities,
    violations,
    auditHandoffRequired: denied || handoff === "audit" || command === "audit"
  };
}

function stableStateFingerprint(parts) {
  return parts
    .map((part) => readString(part, "-").replaceAll("|", "%7C"))
    .join("|");
}

function normalizeRecoveryCursor(value, fallbackSequence, fallbackCheckpointAt) {
  const source = value && typeof value === "object" ? value : {};
  const sequence = Math.max(0, Math.floor(readNumber(source.sequence, fallbackSequence)));
  const providerWatermark = readString(source.providerWatermark || source.syncWatermark, "");
  const checkpointAt = readString(source.checkpointAt || source.at, fallbackCheckpointAt);

  return {
    sequence,
    checkpointAt,
    providerWatermark,
    checkpointFingerprint: readString(source.checkpointFingerprint || source.fingerprint, ""),
    lastAppliedWriteId: readString(source.lastAppliedWriteId, ""),
    valid: sequence >= 0 && Boolean(checkpointAt)
  };
}

function normalizePersistedWrite(value, index, now) {
  const source = value && typeof value === "object" ? value : {};
  const rawKind = readString(source.kind, "checkpoint");
  const rawStatus = readString(source.status, "pending");
  const sequence = Math.max(0, Math.floor(readNumber(source.sequence, index)));
  const kind = KNOWN_WRITE_KINDS.has(rawKind) ? rawKind : "checkpoint";
  const status = KNOWN_WRITE_STATUSES.has(rawStatus) ? rawStatus : "pending";
  const id = readString(source.id || source.writeId, `write:${sequence}:${kind}`);

  return {
    id,
    kind,
    status,
    sequence,
    provider: readString(source.provider, "session-store"),
    digest: readString(source.digest || source.resultDigest, ""),
    createdAt: readString(source.createdAt, now),
    committedAt: status === "committed" ? readString(source.committedAt, now) : readString(source.committedAt, "")
  };
}

function normalizePersistedWrites(value, now) {
  if (!Array.isArray(value)) return [];
  const byId = new Map();

  value
    .map((item, index) => normalizePersistedWrite(item, index, now))
    .filter((write) => write.id)
    .forEach((write) => {
      const current = byId.get(write.id);
      if (!current || write.sequence >= current.sequence) {
        byId.set(write.id, write);
      }
    });

  return Array.from(byId.values()).sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
}

function normalizePersistedWriteAcknowledgement(value, index, now) {
  const source = value && typeof value === "object" ? value : {};
  const rawStatus = readString(source.status, "accepted");
  const writeId = readString(source.writeId || source.id, "");
  const status = KNOWN_WRITE_ACK_STATUSES.has(rawStatus) ? rawStatus : "accepted";

  return {
    id: readString(source.id, writeId || `ack:${index}`),
    writeId,
    status,
    provider: readString(source.provider, "session-store"),
    sequence: Math.max(0, Math.floor(readNumber(source.sequence, index))),
    cursor: readString(source.cursor || source.syncCursor, ""),
    acknowledgedAt: readString(source.acknowledgedAt || source.committedAt || source.at, now),
    rejectionCode: status === "rejected" ? readString(source.rejectionCode || source.code, "write-rejected") : ""
  };
}

function normalizePersistedWriteAcknowledgements(value, now) {
  if (!Array.isArray(value)) return [];
  const byWriteId = new Map();

  value
    .map((item, index) => normalizePersistedWriteAcknowledgement(item, index, now))
    .filter((ack) => ack.writeId)
    .forEach((ack) => {
      const current = byWriteId.get(ack.writeId);
      if (!current || ack.sequence >= current.sequence) {
        byWriteId.set(ack.writeId, ack);
      }
    });

  return Array.from(byWriteId.values()).sort((left, right) => left.sequence - right.sequence || left.writeId.localeCompare(right.writeId));
}

function normalizePersistedCommandResult(value, index, command, commandFingerprint, now) {
  const source = value && typeof value === "object" ? value : {};
  const rawCommand = readString(source.command, command);
  const rawStatus = readString(source.status || source.resultStatus, "succeeded");
  const sequence = Math.max(0, Math.floor(readNumber(source.sequence, index)));
  const resultCommand = KNOWN_COMMANDS.has(rawCommand) ? rawCommand : command;
  const status = KNOWN_COMMAND_RESULT_STATUSES.has(rawStatus) ? rawStatus : "pending";
  const fingerprint = readString(source.commandFingerprint || source.fingerprint, commandFingerprint);
  const idempotencyKey = readString(source.idempotencyKey || source.persistenceKey, "");
  const digest = readString(source.digest || source.resultDigest, "");

  return {
    id: readString(source.id || source.resultId, `result:${resultCommand}:${sequence}`),
    command: resultCommand,
    status,
    sequence,
    idempotencyKey,
    commandFingerprint: fingerprint,
    digest,
    proofDigest: readString(source.proofDigest || source.auditProofDigest, ""),
    provider: readString(source.provider, resultCommand === "audit" ? "audit-ledger" : "session-store"),
    completedAt: status === "succeeded" || status === "failed" || status === "cancelled"
      ? readString(source.completedAt || source.at, now)
      : "",
    replaySafe: status === "succeeded" && Boolean(digest)
  };
}

function normalizePersistedCommandResults(value, command, commandFingerprint, now) {
  if (!Array.isArray(value)) return [];
  const byReplayKey = new Map();

  value
    .map((item, index) => normalizePersistedCommandResult(item, index, command, commandFingerprint, now))
    .filter((result) => result.id && result.command === command)
    .forEach((result) => {
      const replayKey = result.idempotencyKey || result.commandFingerprint || result.id;
      const current = byReplayKey.get(replayKey);
      if (!current || result.sequence >= current.sequence) {
        byReplayKey.set(replayKey, result);
      }
    });

  return Array.from(byReplayKey.values())
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
}

function findPersistedCommandResult(persistedState, command, persistenceKey) {
  const candidates = persistedState.commandResults.filter((result) => (
    result.command === command
    && (
      result.idempotencyKey === persistenceKey
      || result.commandFingerprint === persistedState.commandFingerprint
      || result.sequence === persistedState.sequence
    )
  ));

  return candidates[candidates.length - 1] || null;
}

function normalizePersistedState(input, parsed, command, identity, now) {
  const source = input.persistedState && typeof input.persistedState === "object" ? input.persistedState : {};
  const storedStatus = readString(source.status || parsed.flags.persistedStatus, "new");
  const status = TERMINAL_STATUSES.has(storedStatus) || RECOVERABLE_STATUSES.has(storedStatus)
    ? storedStatus
    : "new";
  const bootId = readString(source.bootId || parsed.flags.bootId, "");
  const sequence = Number.isFinite(Number(source.sequence)) ? Math.max(0, Math.floor(Number(source.sequence))) : 0;
  const retryAttempt = Math.max(1, Math.floor(readNumber(source.retryAttempt || parsed.flags.retryAttempt, 1)));
  const completedCommands = Array.isArray(source.completedCommands)
    ? source.completedCommands.filter((item) => KNOWN_COMMANDS.has(item))
    : [];
  const commandFingerprint = stableStateFingerprint([
    identity.requestId,
    identity.operatorId,
    identity.tenantId,
    identity.workspaceKey,
    identity.route,
    command
  ]);
  const pendingWrites = normalizePersistedWrites(source.pendingWrites, now);
  const committedWrites = normalizePersistedWrites(source.committedWrites, now)
    .filter((write) => write.status === "committed");
  const writeAcknowledgements = normalizePersistedWriteAcknowledgements(
    source.writeAcknowledgements || source.acknowledgedWrites,
    now
  );
  const checkpointAt = readString(source.checkpointAt, now);
  const recoveryCursor = normalizeRecoveryCursor(source.recoveryCursor, sequence, checkpointAt);
  const commandResults = normalizePersistedCommandResults(
    source.commandResults || source.completedResults || source.resultLedger,
    command,
    commandFingerprint,
    now
  );
  const replayableResults = commandResults.filter((result) => result.replaySafe);

  return {
    bootId: bootId || `boot:${commandFingerprint}`,
    status,
    sequence,
    completedCommands,
    retryAttempt,
    lastCommand: readString(source.lastCommand, ""),
    lastHeartbeatAt: readString(source.lastHeartbeatAt, ""),
    checkpointAt,
    commandFingerprint,
    resultDigest: readString(source.resultDigest || parsed.flags.resultDigest, ""),
    recoveryCursor,
    pendingWrites,
    committedWrites,
    writeAcknowledgements,
    commandResults,
    pendingWriteCount: pendingWrites.filter((write) => write.status === "pending").length,
    committedWriteIds: committedWrites.map((write) => write.id),
    replayableCommandResultIds: replayableResults.map((result) => result.id),
    acknowledgedWriteIds: writeAcknowledgements
      .filter((ack) => ack.status === "accepted" || ack.status === "committed")
      .map((ack) => ack.writeId)
  };
}

function buildRecoveryPlan(command, persistedState, now) {
  if (TERMINAL_STATUSES.has(persistedState.status)) {
    return {
      mode: "observe",
      restartSafeStatus: "settled",
      reason: "persisted-session-terminal",
      resumeFromCheckpoint: false,
      nextPersistedStatus: persistedState.status
    };
  }

  if (command === "recover" || RECOVERABLE_STATUSES.has(persistedState.status)) {
    return {
      mode: "recover",
      restartSafeStatus: "recoverable",
      reason: persistedState.lastHeartbeatAt ? "resume-from-heartbeat" : "resume-from-checkpoint",
      resumeFromCheckpoint: true,
      checkpointAt: persistedState.checkpointAt || now,
      nextPersistedStatus: "recovering"
    };
  }

  if (command === "status" || command === "audit") {
    return {
      mode: "inspect",
      restartSafeStatus: "observable",
      reason: "read-only-command",
      resumeFromCheckpoint: false,
      nextPersistedStatus: persistedState.status
    };
  }

  return {
    mode: "start",
    restartSafeStatus: "active",
    reason: "new-command",
    resumeFromCheckpoint: false,
    nextPersistedStatus: "booting"
  };
}

function resolveLifecycleControls(state, parsed, now) {
  const source = state.input.lifecycleSettings && typeof state.input.lifecycleSettings === "object"
    ? state.input.lifecycleSettings
    : {};
  const rawEnabled = source.enabled ?? parsed.flags.lifecycleEnabled ?? parsed.flags.enabled;
  const enabled = readBoolean(rawEnabled, true);
  const requestedMode = readString(source.mode || parsed.flags.lifecycleMode, enabled ? "active" : "disabled");
  const mode = KNOWN_LIFECYCLE_MODES.has(requestedMode) ? requestedMode : enabled ? "active" : "disabled";
  const requestedScheduleMode = readString(source.scheduleMode || parsed.flags.scheduleMode, "immediate");
  const scheduleMode = KNOWN_SCHEDULE_MODES.has(requestedScheduleMode) ? requestedScheduleMode : "immediate";
  const disabledCommands = normalizeStringList(source.disabledCommands || parsed.flags.disabledCommands)
    .filter((command) => KNOWN_COMMANDS.has(command));
  const maxConcurrentCommands = Math.max(1, Math.min(16, Math.floor(readNumber(
    source.maxConcurrentCommands || parsed.flags.maxConcurrentCommands,
    1
  ))));
  const pendingLifecycleRuns = Math.max(0, Math.floor(readNumber(
    source.pendingLifecycleRuns || parsed.flags.pendingLifecycleRuns,
    state.persisted.pendingWriteCount
  )));
  const maintenanceWindow = source.maintenanceWindow && typeof source.maintenanceWindow === "object"
    ? source.maintenanceWindow
    : {};
  const windowStartsAt = readString(maintenanceWindow.startsAt || parsed.flags.maintenanceStartsAt, "");
  const windowEndsAt = readString(maintenanceWindow.endsAt || parsed.flags.maintenanceEndsAt, "");
  const windowOpen = readBoolean(maintenanceWindow.open ?? parsed.flags.maintenanceOpen, false);
  const commandWritable = WRITABLE_COMMANDS.has(state.command);
  const validationFindings = [];

  if (!KNOWN_LIFECYCLE_MODES.has(requestedMode)) {
    validationFindings.push({
      code: "lifecycle-mode-invalid",
      severity: "failed",
      field: "lifecycleSettings.mode",
      message: `Lifecycle mode must be one of: ${Array.from(KNOWN_LIFECYCLE_MODES).join(", ")}.`
    });
  }

  if (!KNOWN_SCHEDULE_MODES.has(requestedScheduleMode)) {
    validationFindings.push({
      code: "lifecycle-schedule-mode-invalid",
      severity: "failed",
      field: "lifecycleSettings.scheduleMode",
      message: `Lifecycle schedule mode must be one of: ${Array.from(KNOWN_SCHEDULE_MODES).join(", ")}.`
    });
  }

  if (disabledCommands.includes(state.command)) {
    validationFindings.push({
      code: "lifecycle-command-disabled",
      severity: commandWritable ? "failed" : "warn",
      field: "lifecycleSettings.disabledCommands",
      message: `The ${state.command} command is disabled by lifecycle settings.`
    });
  }

  if ((!enabled || mode === "disabled") && commandWritable) {
    validationFindings.push({
      code: "lifecycle-disabled",
      severity: "failed",
      field: "lifecycleSettings.enabled",
      message: "Writable CLI boot commands are disabled by lifecycle settings."
    });
  }

  if (mode === "paused" && commandWritable && state.command !== "recover") {
    validationFindings.push({
      code: "lifecycle-paused",
      severity: "degraded",
      field: "lifecycleSettings.mode",
      message: "Writable CLI boot commands are paused; only recovery and read-only commands may continue."
    });
  }

  if (mode === "maintenance" && state.command === "execute" && !windowOpen) {
    validationFindings.push({
      code: "maintenance-window-closed",
      severity: "degraded",
      field: "lifecycleSettings.maintenanceWindow",
      message: "Execute is queued until the hosted-kernel maintenance window opens."
    });
  }

  if (scheduleMode === "maintenance-window" && (!windowStartsAt || !windowEndsAt)) {
    validationFindings.push({
      code: "maintenance-window-incomplete",
      severity: "failed",
      field: "lifecycleSettings.maintenanceWindow",
      message: "Maintenance-window scheduling requires startsAt and endsAt values."
    });
  }

  if (pendingLifecycleRuns >= maxConcurrentCommands && commandWritable) {
    validationFindings.push({
      code: "lifecycle-concurrency-limit",
      severity: "degraded",
      field: "lifecycleSettings.maxConcurrentCommands",
      message: "The lifecycle concurrency limit has been reached for writable CLI boot commands."
    });
  }

  const blocked = validationFindings.some((finding) => finding.severity === "failed");
  const scheduled = !blocked && (
    validationFindings.some((finding) => finding.severity === "degraded")
    || (scheduleMode !== "immediate" && commandWritable)
  );
  const controlFingerprint = stableStateFingerprint([
    state.scope.workspaceKey,
    state.command,
    enabled ? "enabled" : "disabled",
    mode,
    scheduleMode,
    disabledCommands.join(","),
    `${pendingLifecycleRuns}/${maxConcurrentCommands}`,
    windowOpen ? "window-open" : "window-closed",
    windowStartsAt,
    windowEndsAt
  ]);

  return {
    version: "cli-boot.lifecycle-controls.v1",
    status: blocked ? "blocked" : scheduled ? "scheduled" : "ready",
    enabled,
    mode,
    commandWritable,
    commandAllowed: !blocked,
    disabledCommands,
    schedule: {
      mode: scheduleMode,
      nextRunAt: readString(source.nextRunAt || parsed.flags.nextRunAt, windowOpen ? now : windowStartsAt),
      pendingLifecycleRuns,
      maxConcurrentCommands,
      queueReason: scheduled ? validationFindings[0]?.code || scheduleMode : ""
    },
    maintenanceWindow: {
      open: windowOpen,
      startsAt: windowStartsAt,
      endsAt: windowEndsAt,
      label: readString(maintenanceWindow.label || parsed.flags.maintenanceLabel, "")
    },
    validationFindings,
    controlFingerprint,
    evaluatedAt: now
  };
}

function buildStateTransition(state, now) {
  const alreadyCompleted = state.persisted.completedCommands.includes(state.command);
  const lastCommandReplay = state.persisted.lastCommand === state.command;
  const expectedSequence = alreadyCompleted || lastCommandReplay ? state.persisted.sequence : state.persisted.sequence + 1;
  const persistenceKey = stableStateFingerprint([
    state.persisted.bootId,
    state.scope.workspaceKey,
    state.command,
    expectedSequence
  ]);
  const persistedResult = findPersistedCommandResult(state.persisted, state.command, persistenceKey);
  const resultReplayable = Boolean(persistedResult?.replaySafe);
  const idempotentReplay = alreadyCompleted || lastCommandReplay || resultReplayable;
  const sequence = idempotentReplay ? (persistedResult?.sequence ?? state.persisted.sequence) : expectedSequence;
  const commandResultDigest = persistedResult?.digest
    || state.persisted.resultDigest
    || `pending:${persistenceKey}`;
  const resultConflict = Boolean(
    persistedResult
    && state.persisted.resultDigest
    && persistedResult.digest
    && persistedResult.digest !== state.persisted.resultDigest
  );

  return {
    idempotent: idempotentReplay,
    idempotencyReason: resultReplayable
      ? "persisted-command-result"
      : alreadyCompleted
        ? "completed-command-ledger"
        : lastCommandReplay
          ? "last-command-replay"
          : "new-command",
    resultReplayable,
    resultConflict,
    persistedResult: persistedResult ? {
      id: persistedResult.id,
      status: persistedResult.status,
      sequence: persistedResult.sequence,
      idempotencyKey: persistedResult.idempotencyKey,
      digest: persistedResult.digest,
      proofDigest: persistedResult.proofDigest,
      completedAt: persistedResult.completedAt,
      provider: persistedResult.provider
    } : null,
    command: state.command,
    previousStatus: state.persisted.status,
    nextStatus: state.recovery.nextPersistedStatus,
    sequence,
    bootId: state.persisted.bootId,
    persistenceKey,
    commandResultDigest,
    checkpoint: {
      at: now,
      fingerprint: state.persisted.commandFingerprint,
      persistenceKey,
      route: state.route,
      handoff: state.handoff,
      tenantId: state.scope.tenantId,
      workspaceKey: state.scope.workspaceKey
    }
  };
}

function initializeArtifactRoot(state, parsed, now) {
  const source = state.input.artifacts && typeof state.input.artifacts === "object" ? state.input.artifacts : {};
  const requestedRoot = readString(
    source.root || source.artifactRoot || parsed.flags.artifactRoot || parsed.flags.artifactsRoot,
    ""
  );
  const rawRoot = requestedRoot || DEFAULT_ARTIFACT_ROOT;
  const root = rawRoot.replaceAll("\\", "/").replace(/\/+$/g, "") || DEFAULT_ARTIFACT_ROOT;
  const scopeSegment = normalizeArtifactPathSegment(state.scope.workspaceKey, "workspace");
  const bootSegment = normalizeArtifactPathSegment(state.persisted.bootId, "boot");
  const commandSegment = normalizeArtifactPathSegment(state.command, "command");
  const proofFileName = normalizeArtifactPathSegment(source.proofFileName || parsed.flags.proofFileName, "boot-proof.json");
  const manifestFileName = normalizeArtifactPathSegment(
    source.handoffManifestFileName || parsed.flags.handoffManifestFileName,
    "handoff-manifest.json"
  );
  const ledgerFileName = normalizeArtifactPathSegment(source.ledgerFileName || parsed.flags.ledgerFileName, "audit-ledger.jsonl");
  const basePath = joinArtifactPath(root, scopeSegment, bootSegment, commandSegment);
  const proofPath = joinArtifactPath(basePath, proofFileName);
  const manifestPath = joinArtifactPath(basePath, manifestFileName);
  const ledgerPath = joinArtifactPath(basePath, ledgerFileName);
  const writableCommand = WRITABLE_COMMANDS.has(state.command) || state.command === "audit";
  const validationFindings = [];
  const artifactFiles = [
    {
      kind: "boot-proof",
      path: proofPath,
      fileName: proofFileName,
      contentType: "application/json",
      required: true,
      handoffField: "proofPath"
    },
    {
      kind: "handoff-manifest",
      path: manifestPath,
      fileName: manifestFileName,
      contentType: "application/json",
      required: true,
      handoffField: "manifestPath"
    },
    {
      kind: "audit-ledger",
      path: ledgerPath,
      fileName: ledgerFileName,
      contentType: "application/jsonl",
      required: writableCommand,
      handoffField: "ledgerPath"
    }
  ];

  if (!requestedRoot && source.root === "") {
    validationFindings.push({
      code: "artifact-root-missing",
      severity: writableCommand ? "failed" : "warn",
      field: "artifacts.root",
      message: "Hosted boot proof artifacts require an artifact root."
    });
  }

  if (root.includes("\0")) {
    validationFindings.push({
      code: "artifact-root-invalid",
      severity: "failed",
      field: "artifacts.root",
      message: "Artifact root contains an invalid path character."
    });
  }

  if (root === "/" || root === "." || root === ".." || root.startsWith("../") || root.includes("/../") || root.endsWith("/..")) {
    validationFindings.push({
      code: "artifact-root-unsafe",
      severity: "failed",
      field: "artifacts.root",
      message: "Artifact root must resolve to a scoped boot artifact directory."
    });
  }

  const artifactPaths = new Set();
  for (const artifact of artifactFiles) {
    const extension = expectedArtifactExtension(artifact.contentType);
    if (artifact.path === root || artifact.path === basePath || artifact.fileName.includes("\0")) {
      validationFindings.push({
        code: "artifact-file-path-invalid",
        severity: "failed",
        field: `artifacts.${artifact.kind}`,
        message: `Artifact file path for ${artifact.kind} must resolve below the boot artifact base path.`
      });
    }

    if (!pathIsBelow(basePath, artifact.path)) {
      validationFindings.push({
        code: "artifact-file-outside-base",
        severity: "failed",
        field: `artifacts.${artifact.kind}`,
        message: `Artifact file path for ${artifact.kind} must remain under the boot artifact base path.`
      });
    }

    if (artifactPaths.has(artifact.path)) {
      validationFindings.push({
        code: "artifact-file-path-duplicate",
        severity: "failed",
        field: `artifacts.${artifact.kind}`,
        message: `Artifact file path for ${artifact.kind} must not overlap another boot artifact.`
      });
    }

    if (extension && !artifact.fileName.endsWith(extension)) {
      validationFindings.push({
        code: "artifact-file-extension-mismatch",
        severity: "failed",
        field: `artifacts.${artifact.kind}`,
        message: `Artifact file for ${artifact.kind} must use the ${extension} extension.`
      });
    }

    artifactPaths.add(artifact.path);
  }

  const status = validationFindings.some((finding) => finding.severity === "failed") ? "blocked" : "initialized";
  const retentionKey = stableStateFingerprint([
    state.scope.workspaceKey,
    state.persisted.bootId,
    state.command,
    state.stateTransition.persistenceKey
  ]);
  const shapedArtifactFiles = artifactFiles.map((artifact, index) => ({
    ...artifact,
    sequence: state.stateTransition.sequence,
    writeId: `artifact:${artifact.kind}:${retentionKey}`,
    status: status === "blocked" ? "blocked" : artifact.required ? "ready" : "optional",
    order: index + 1
  }));
  const artifacts = {
    version: "cli-boot.artifact-root.v1",
    status,
    requestedRoot,
    root,
    basePath,
    proofPath,
    manifestPath,
    ledgerPath,
    scopeSegment,
    bootSegment,
    commandSegment,
    retentionKey,
    rootSource: requestedRoot ? "request" : "default",
    artifactFiles: shapedArtifactFiles,
    validationFindings,
    initializedAt: now
  };

  return {
    ...artifacts,
    initializationPlan: buildArtifactInitializationPlan(artifacts, shapedArtifactFiles, status, now)
  };
}

function normalizePriorBootProofScope(state, parsed, now) {
  const source = state.input.priorBootProof && typeof state.input.priorBootProof === "object"
    ? state.input.priorBootProof
    : state.input.persistedState?.priorBootProof && typeof state.input.persistedState.priorBootProof === "object"
      ? state.input.persistedState.priorBootProof
      : {};
  const proofDigest = readString(source.proofDigest || source.digest || parsed.flags.priorProofDigest, "");
  const manifestDigest = readString(source.manifestDigest || parsed.flags.priorManifestDigest, "");
  const proofTenantId = readString(source.tenantId || parsed.flags.priorTenantId, "");
  const proofWorkspaceId = readString(source.workspaceId || parsed.flags.priorWorkspaceId, "");
  const proofWorkspaceKey = readString(source.workspaceKey || parsed.flags.priorWorkspaceKey, (
    proofTenantId && proofWorkspaceId ? `${proofTenantId}/${proofWorkspaceId}` : ""
  ));
  const proofBootId = readString(source.bootId || parsed.flags.priorBootId, "");
  const proofCommand = readString(source.command || parsed.flags.priorCommand, "");
  const proofArtifactRoot = readString(source.artifactRoot || source.root || parsed.flags.priorArtifactRoot, "");
  const proofArtifactBasePath = readString(source.artifactBasePath || source.basePath || parsed.flags.priorArtifactBasePath, "");
  const proofRetentionKey = readString(source.retentionKey || parsed.flags.priorRetentionKey, "");
  const proofIssuedAt = readString(source.issuedAt || source.generatedAt || parsed.flags.priorProofIssuedAt, "");
  const supplied = Boolean(
    proofDigest
    || manifestDigest
    || proofTenantId
    || proofWorkspaceId
    || proofWorkspaceKey
    || proofBootId
    || proofArtifactRoot
    || proofArtifactBasePath
    || proofRetentionKey
  );
  const required = state.command === "recover"
    || (state.recovery.resumeFromCheckpoint && state.command !== "status")
    || state.persisted.recoveryCursor.sequence > 0;
  const validationFindings = [];

  if (required && !supplied) {
    validationFindings.push({
      code: "prior-boot-proof-missing",
      severity: state.command === "recover" ? "degraded" : "warn",
      field: "priorBootProof",
      message: "Recovery or checkpoint replay does not include a prior boot proof scope binding."
    });
  }

  if (supplied && !proofDigest && !manifestDigest) {
    validationFindings.push({
      code: "prior-boot-proof-digest-missing",
      severity: "failed",
      field: "priorBootProof.proofDigest",
      message: "A supplied prior boot proof must include a proofDigest or manifestDigest."
    });
  }

  if (proofTenantId && proofTenantId !== state.scope.tenantId) {
    validationFindings.push({
      code: "prior-boot-proof-tenant-mismatch",
      severity: "failed",
      field: "priorBootProof.tenantId",
      message: "Prior boot proof tenant does not match the requested tenant scope."
    });
  }

  if (proofWorkspaceId && proofWorkspaceId !== state.scope.workspaceId) {
    validationFindings.push({
      code: "prior-boot-proof-workspace-mismatch",
      severity: "failed",
      field: "priorBootProof.workspaceId",
      message: "Prior boot proof workspace does not match the requested workspace scope."
    });
  }

  if (proofWorkspaceKey && proofWorkspaceKey !== state.scope.workspaceKey) {
    validationFindings.push({
      code: "prior-boot-proof-workspace-key-mismatch",
      severity: "failed",
      field: "priorBootProof.workspaceKey",
      message: "Prior boot proof workspace key does not match the requested tenant/workspace boundary."
    });
  }

  if (proofBootId && proofBootId !== state.persisted.bootId && state.command !== "recover") {
    validationFindings.push({
      code: "prior-boot-proof-boot-id-mismatch",
      severity: "failed",
      field: "priorBootProof.bootId",
      message: "Prior boot proof boot id does not match the active boot session."
    });
  }

  if (proofCommand && KNOWN_COMMANDS.has(proofCommand) && proofCommand !== state.command && state.command !== "recover") {
    validationFindings.push({
      code: "prior-boot-proof-command-mismatch",
      severity: "warn",
      field: "priorBootProof.command",
      message: "Prior boot proof command differs from the requested command."
    });
  }

  if (proofArtifactRoot) {
    const normalizedProofRoot = proofArtifactRoot.replaceAll("\\", "/").replace(/\/+$/g, "");
    if (normalizedProofRoot !== state.artifacts.root) {
      validationFindings.push({
        code: "prior-boot-proof-artifact-root-mismatch",
        severity: "failed",
        field: "priorBootProof.artifactRoot",
        message: "Prior boot proof artifact root is outside the requested scoped artifact root."
      });
    }
  }

  if (proofArtifactBasePath && !pathIsBelow(state.artifacts.root, proofArtifactBasePath)) {
    validationFindings.push({
      code: "prior-boot-proof-artifact-base-outside-root",
      severity: "failed",
      field: "priorBootProof.artifactBasePath",
      message: "Prior boot proof artifact base path must remain under the scoped artifact root."
    });
  }

  if (proofRetentionKey && proofRetentionKey === state.artifacts.retentionKey && state.command !== "recover") {
    validationFindings.push({
      code: "prior-boot-proof-retention-key-reused",
      severity: "failed",
      field: "priorBootProof.retentionKey",
      message: "Prior boot proof retention key must not be reused for a new non-recovery handoff."
    });
  }

  const failed = validationFindings.some((finding) => finding.severity === "failed");
  const status = failed ? "blocked" : supplied ? "verified" : required ? "missing" : "not-required";
  const scopeBindingFingerprint = supplied
    ? `scope-proof:${stableStateFingerprint([
      proofDigest,
      manifestDigest,
      proofWorkspaceKey || state.scope.workspaceKey,
      proofBootId || state.persisted.bootId,
      proofRetentionKey,
      state.artifacts.root
    ])}`
    : "";

  return {
    version: "cli-boot.scope-proof.v1",
    status,
    required,
    supplied,
    proofDigest,
    manifestDigest,
    tenantId: proofTenantId,
    workspaceId: proofWorkspaceId,
    workspaceKey: proofWorkspaceKey,
    bootId: proofBootId,
    command: proofCommand,
    artifactRoot: proofArtifactRoot,
    artifactBasePath: proofArtifactBasePath,
    retentionKey: proofRetentionKey,
    issuedAt: proofIssuedAt,
    scopeBindingFingerprint,
    validationFindings,
    evaluatedAt: now
  };
}

function buildPersistenceEnvelope(state, now) {
  const readOnlyObservation = state.command === "status";
  const shouldPersist = !readOnlyObservation
    && !state.health.failureState.blocked
    && state.scopeProof.status !== "blocked"
    && state.lifecycle.status !== "blocked"
    && state.boundary.enforcement !== "blocked"
    && state.providerContract.status !== "blocked";
  const existingPendingIds = new Set(state.persisted.pendingWrites.map((write) => write.id));
  const checkpointWriteId = `checkpoint:${state.stateTransition.persistenceKey}`;
  const resultWriteId = `result:${state.stateTransition.persistenceKey}`;
  const newWrites = shouldPersist && !state.stateTransition.idempotent
    ? [
      {
        id: checkpointWriteId,
        kind: "checkpoint",
        status: "pending",
        sequence: state.stateTransition.sequence,
        provider: "session-store",
        digest: state.persisted.commandFingerprint,
        createdAt: now
      },
      {
        id: resultWriteId,
        kind: state.command === "audit" ? "audit-proof" : "command-result",
        status: "pending",
        sequence: state.stateTransition.sequence,
        provider: state.command === "audit" ? "audit-ledger" : "session-store",
        digest: state.stateTransition.commandResultDigest,
        createdAt: now
      }
    ].filter((write) => !existingPendingIds.has(write.id))
    : [];
  const pendingWrites = [...state.persisted.pendingWrites, ...newWrites]
    .filter((write) => write.status === "pending");
  const shapedRecoveryCursor = {
    sequence: state.stateTransition.sequence,
    checkpointAt: state.stateTransition.checkpoint.at,
    providerWatermark: state.providerContract.syncWatermark,
    checkpointFingerprint: state.stateTransition.checkpoint.fingerprint,
    lastAppliedWriteId: state.persisted.recoveryCursor.lastAppliedWriteId || "",
    valid: shouldPersist
  };
  const nextRecoveryCursor = readOnlyObservation ? state.persisted.recoveryCursor : shapedRecoveryCursor;

  return {
    version: "cli-boot.persistence.v1",
    status: readOnlyObservation ? "observed" : shouldPersist ? "ready-to-commit" : "blocked",
    idempotencyKey: state.stateTransition.persistenceKey,
    bootId: state.persisted.bootId,
    expectedPreviousSequence: state.persisted.sequence,
    nextSequence: state.stateTransition.sequence,
    restartSafeStatus: state.recovery.restartSafeStatus,
    previousRecoveryCursor: state.persisted.recoveryCursor,
    nextRecoveryCursor,
    pendingWrites,
    committedWriteIds: state.persisted.committedWriteIds,
    writePlan: {
      mode: readOnlyObservation || state.stateTransition.idempotent
        ? "read-existing"
        : shouldPersist
          ? "append-if-absent"
          : "do-not-write",
      requiredAckProviders: Array.from(new Set(pendingWrites.map((write) => write.provider))).sort(),
      newWriteIds: newWrites.map((write) => write.id),
      pendingWriteCount: pendingWrites.length
    },
    conflict: {
      detected: state.persisted.recoveryCursor.sequence > state.persisted.sequence
        || state.stateTransition.resultConflict,
      reason: state.stateTransition.resultConflict
        ? "persisted-command-result-digest-conflict"
        : state.persisted.recoveryCursor.sequence > state.persisted.sequence
        ? "recovery-cursor-ahead-of-session-sequence"
        : ""
    },
    commandResultReplay: {
      available: state.stateTransition.resultReplayable,
      reason: state.stateTransition.idempotencyReason,
      result: state.stateTransition.persistedResult,
      digest: state.stateTransition.commandResultDigest,
      conflict: state.stateTransition.resultConflict
    }
  };
}

function resolveWriteProviderRecoveryState(state, providerName) {
  const negotiated = state.providerContract.negotiations.find((item) => item.provider === providerName);
  if (negotiated) return negotiated;

  const provider = state.providerServices.find((item) => item.name === providerName);
  if (provider) {
    return {
      provider: provider.name,
      status: provider.status,
      available: provider.status !== "unavailable",
      version: provider.version,
      handoffUri: provider.handoffUri,
      requiredCapabilities: [],
      grantedCapabilities: provider.capabilities,
      missingCapabilities: [],
      sync: provider.sync
    };
  }

  return resolveProviderNegotiation(state, providerName);
}

function buildRestartRecoveryLedger(state, now) {
  const committedWriteIds = new Set(state.persisted.committedWriteIds);
  const acknowledgementsByWriteId = new Map(state.persisted.writeAcknowledgements.map((ack) => [ack.writeId, ack]));
  const pendingWrites = state.persistenceEnvelope.pendingWrites;
  const records = pendingWrites.map((write) => {
    const ack = acknowledgementsByWriteId.get(write.id);
    const provider = resolveWriteProviderRecoveryState(state, write.provider);
    const committed = committedWriteIds.has(write.id) || ack?.status === "committed";
    const rejected = ack?.status === "rejected";
    const acknowledged = committed || ack?.status === "accepted";
    const providerReady = provider.available && provider.status !== "unavailable";
    const action = committed
      ? "drop-committed"
      : rejected
        ? "halt-rejected-write"
        : acknowledged
          ? "wait-provider-commit"
          : providerReady
            ? "replay-write"
            : "wait-provider";

    return {
      writeId: write.id,
      kind: write.kind,
      provider: write.provider,
      sequence: write.sequence,
      digest: write.digest,
      providerStatus: provider.status,
      providerCursor: provider.sync.cursor,
      acknowledged,
      committed,
      rejected,
      acknowledgedAt: ack?.acknowledgedAt || "",
      rejectionCode: ack?.rejectionCode || "",
      action,
      restartSafe: action === "drop-committed" || action === "replay-write" || action === "wait-provider-commit",
      replayToken: `replay:${stableStateFingerprint([
        state.persisted.bootId,
        write.id,
        write.sequence,
        write.provider,
        provider.sync.cursor,
        state.providerContract.syncWatermark
      ])}`
    };
  });
  const rejectedWrites = records.filter((record) => record.rejected);
  const replayWrites = records.filter((record) => record.action === "replay-write");
  const waitWrites = records.filter((record) => record.action === "wait-provider" || record.action === "wait-provider-commit");
  const dropWrites = records.filter((record) => record.action === "drop-committed");
  const status = rejectedWrites.length
    ? "blocked"
    : replayWrites.length
      ? "replay-required"
      : waitWrites.length
        ? "waiting-for-ack"
        : "clean";

  return {
    version: "cli-boot.restart-recovery-ledger.v1",
    status,
    restartSafeStatus: status === "blocked" ? "unsafe" : status === "clean" ? "settled" : "recoverable",
    evaluatedAt: now,
    bootId: state.persisted.bootId,
    idempotencyKey: state.persistenceEnvelope.idempotencyKey,
    sequence: state.persistenceEnvelope.nextSequence,
    recoveryCursor: state.persistenceEnvelope.nextRecoveryCursor,
    counts: {
      pending: records.length,
      replay: replayWrites.length,
      waiting: waitWrites.length,
      committed: dropWrites.length,
      rejected: rejectedWrites.length
    },
    replayWriteIds: replayWrites.map((record) => record.writeId),
    waitingWriteIds: waitWrites.map((record) => record.writeId),
    committedWriteIds: dropWrites.map((record) => record.writeId),
    rejectedWriteIds: rejectedWrites.map((record) => record.writeId),
    nextRecoveryAction: rejectedWrites.length
      ? "operator-resolve-rejected-write"
      : replayWrites.length
        ? "replay-pending-writes-before-handoff"
        : waitWrites.length
          ? "wait-for-provider-acknowledgement"
          : "continue",
    records
  };
}

function buildRestartSafeCommandSemantics(state, now) {
  const expectedWriteIds = [
    `checkpoint:${state.stateTransition.persistenceKey}`,
    `result:${state.stateTransition.persistenceKey}`
  ];
  const pendingById = new Map(state.persistenceEnvelope.pendingWrites.map((write) => [write.id, write]));
  const committedIds = new Set(state.persisted.committedWriteIds);
  const acknowledgementsByWriteId = new Map(state.persisted.writeAcknowledgements.map((ack) => [ack.writeId, ack]));
  const ledgerRecordsByWriteId = new Map(state.restartRecoveryLedger.records.map((record) => [record.writeId, record]));
  const writeIntents = expectedWriteIds.map((writeId) => {
    const write = pendingById.get(writeId);
    const ack = acknowledgementsByWriteId.get(writeId);
    const recoveryRecord = ledgerRecordsByWriteId.get(writeId);
    const committed = committedIds.has(writeId) || ack?.status === "committed" || recoveryRecord?.committed || false;
    const accepted = committed || ack?.status === "accepted" || recoveryRecord?.acknowledged || false;
    const rejected = ack?.status === "rejected" || recoveryRecord?.rejected || false;
    const missing = !write && !committed && !accepted && !rejected;
    const intentStatus = rejected
      ? "rejected"
      : committed
        ? "committed"
        : accepted
          ? "accepted"
          : write
            ? "pending"
            : "missing";
    const recoveryAction = recoveryRecord?.action || (
      rejected
        ? "halt-rejected-write"
        : committed
          ? "drop-committed"
          : accepted
            ? "wait-provider-commit"
            : missing
              ? "append-if-absent"
              : "replay-write"
    );

    return {
      writeId,
      kind: writeId.startsWith("checkpoint:") ? "checkpoint" : state.command === "audit" ? "audit-proof" : "command-result",
      provider: write?.provider || (writeId.startsWith("result:") && state.command === "audit" ? "audit-ledger" : "session-store"),
      sequence: write?.sequence ?? state.stateTransition.sequence,
      digest: write?.digest || (writeId.startsWith("checkpoint:")
        ? state.persisted.commandFingerprint
        : state.stateTransition.commandResultDigest),
      status: intentStatus,
      recoveryAction,
      acknowledgedAt: ack?.acknowledgedAt || recoveryRecord?.acknowledgedAt || "",
      rejectionCode: ack?.rejectionCode || recoveryRecord?.rejectionCode || "",
      restartSafe: !rejected && !missing,
      replayToken: recoveryRecord?.replayToken || `replay:${stableStateFingerprint([
        state.persisted.bootId,
        writeId,
        state.stateTransition.sequence,
        state.providerContract.syncWatermark
      ])}`
    };
  });
  const rejectedIntents = writeIntents.filter((intent) => intent.status === "rejected");
  const missingIntents = writeIntents.filter((intent) => intent.status === "missing");
  const pendingIntents = writeIntents.filter((intent) => intent.status === "pending");
  const acceptedIntents = writeIntents.filter((intent) => intent.status === "accepted");
  const committedIntents = writeIntents.filter((intent) => intent.status === "committed");
  const resultIntent = writeIntents.find((intent) => intent.kind === "command-result" || intent.kind === "audit-proof");
  const replaySettled = state.stateTransition.resultReplayable
    || state.stateTransition.idempotent
    || (Boolean(resultIntent) && (resultIntent.status === "committed" || resultIntent.status === "accepted"));
  const safeToHandoff = rejectedIntents.length === 0
    && state.persistenceEnvelope.status !== "blocked"
    && (state.command === "status" || missingIntents.length === 0 || state.persistenceEnvelope.writePlan.mode === "append-if-absent");
  const commandStatus = rejectedIntents.length
    ? "blocked"
    : replaySettled && pendingIntents.length === 0
      ? "settled-replay"
      : acceptedIntents.length || pendingIntents.length
        ? "recovering-writes"
        : missingIntents.length
          ? "ready-to-append"
          : "ready";

  return {
    version: "cli-boot.restart-safe-command.v1",
    status: commandStatus,
    restartSafeStatus: rejectedIntents.length
      ? "unsafe"
      : replaySettled && pendingIntents.length === 0
        ? "settled"
        : pendingIntents.length || acceptedIntents.length
          ? "recoverable"
          : "active",
    evaluatedAt: now,
    command: state.command,
    bootId: state.persisted.bootId,
    idempotencyKey: state.stateTransition.persistenceKey,
    sequence: state.stateTransition.sequence,
    replaySettled,
    safeToHandoff,
    handoffRequired: !(state.command === "status" || replaySettled),
    writeIntents,
    expectedWriteIds,
    committedWriteIds: committedIntents.map((intent) => intent.writeId),
    pendingWriteIds: pendingIntents.map((intent) => intent.writeId),
    acceptedWriteIds: acceptedIntents.map((intent) => intent.writeId),
    missingWriteIds: missingIntents.map((intent) => intent.writeId),
    rejectedWriteIds: rejectedIntents.map((intent) => intent.writeId),
    nextRestartAction: rejectedIntents.length
      ? "operator-resolve-rejected-command-write"
      : replaySettled
        ? "reuse-persisted-command-result"
        : pendingIntents.length
          ? "replay-or-await-command-writes"
          : missingIntents.length
            ? "append-command-state-if-absent"
            : "dispatch-command",
    commandResult: {
      digest: state.stateTransition.commandResultDigest,
      replayable: state.stateTransition.resultReplayable,
      replayReason: state.stateTransition.idempotencyReason,
      persistedResult: state.stateTransition.persistedResult
    }
  };
}

function resolveProviderNegotiation(state, providerName) {
  return state.providerContract.negotiations.find((item) => item.provider === providerName) || {
    provider: providerName,
    status: "unavailable",
    available: false,
    version: "unknown",
    handoffUri: "",
    requiredCapabilities: [],
    grantedCapabilities: [],
    missingCapabilities: [],
    sync: {
      cursor: `${providerName}:missing`,
      lastSyncedAt: "",
      pendingOperations: 0
    }
  };
}

function buildHostedKernelHandoffManifest(state, now) {
  const targetProvider = HANDOFF_TARGET_PROVIDERS[state.handoff] || "hosted-kernel";
  const provider = resolveProviderNegotiation(state, targetProvider);
  const preferredHandoff = COMMAND_PREFERRED_HANDOFFS[state.command] || "resume";
  const payloadSchema = [
    "requestId",
    "bootId",
    "command",
    "route",
    "tenantId",
    "workspaceKey",
    "persistenceKey",
    "recoveryCursor",
    "providerSyncWatermark",
    "providerServiceSyncFingerprint",
    "providerSyncClaims",
    "providerHandoffClaim",
    "artifactRoot",
    "artifactBasePath",
    "proofPath",
    "manifestPath",
    "ledgerPath",
    "artifactRetentionKey",
    "scopeProofStatus",
    "scopeProofFingerprint",
    "lifecycleControlFingerprint",
    "restartCommandState"
  ];
  const validationErrors = [];

  if (!provider.available) validationErrors.push("target-provider-unavailable");
  if (!provider.handoffUri) validationErrors.push("target-handoff-uri-missing");
  if (state.handoff !== preferredHandoff && state.command !== "status") {
    validationErrors.push("handoff-target-not-preferred-for-command");
  }
  if (state.persistenceEnvelope.conflict.detected) validationErrors.push("persistence-sequence-conflict");
  if (state.stateTransition.resultConflict) validationErrors.push("command-result-digest-conflict");
  if (state.persistenceEnvelope.status === "blocked") validationErrors.push("persistence-envelope-blocked");
  if (state.restartRecoveryLedger.status === "blocked") validationErrors.push("restart-recovery-ledger-blocked");
  if (state.commandRestartSemantics.restartSafeStatus === "unsafe") validationErrors.push("command-restart-state-unsafe");
  if (state.lifecycle.status === "blocked") validationErrors.push("lifecycle-controls-blocked");
  if (state.providerSyncContract.status === "blocked") validationErrors.push("provider-service-sync-blocked");
  if (state.providerHandoffClaim.status === "blocked") validationErrors.push("provider-handoff-claim-blocked");
  if (state.artifacts.status === "blocked") validationErrors.push("artifact-root-blocked");
  if (state.scopeProof.status === "blocked") validationErrors.push("scope-proof-blocked");

  const manifestSeed = [
    state.requestId,
    state.persisted.bootId,
    state.command,
    state.handoff,
    targetProvider,
    state.stateTransition.persistenceKey,
    state.providerContract.syncWatermark,
    state.providerSyncContract.syncFingerprint,
    state.providerHandoffClaim.claimFingerprint,
    state.lifecycle.controlFingerprint,
    state.artifacts.retentionKey,
    state.scopeProof.scopeBindingFingerprint,
    state.artifacts.proofPath,
    state.persistenceEnvelope.nextRecoveryCursor.sequence
  ];
  const proofDigest = `cli-boot-proof:${stableStateFingerprint(manifestSeed)}`;
  const dispatchable = validationErrors.length === 0
    && state.boundary.enforcement !== "blocked"
    && !state.health.failureState.blocked
    && state.providerContract.status !== "blocked"
    && state.providerHandoffClaim.status === "ready"
    && state.restartRecoveryLedger.status !== "blocked"
    && state.lifecycle.status !== "scheduled";
  const manifestStatus = validationErrors.length > 0
    ? "blocked"
    : state.lifecycle.status === "scheduled" || state.providerHandoffClaim.status !== "ready"
      ? "scheduled"
      : dispatchable
        ? "dispatchable"
        : "blocked";

  return {
    version: "cli-boot.handoff-manifest.v1",
    status: manifestStatus,
    target: state.handoff,
    preferredHandoff,
    targetProvider,
    providerHandoffUri: provider.handoffUri,
    providerVersion: provider.version,
    requiredAckProvider: targetProvider,
    requiresAuditAck: state.boundary.auditHandoffRequired || state.command === "execute",
    replayProtection: {
      idempotencyKey: state.persistenceEnvelope.idempotencyKey,
      bootId: state.persisted.bootId,
      sequence: state.stateTransition.sequence,
      commandResultDigest: state.stateTransition.commandResultDigest,
      commandResultReplayAvailable: state.stateTransition.resultReplayable,
      idempotencyReason: state.stateTransition.idempotencyReason,
      restartSafeStatus: state.commandRestartSemantics.restartSafeStatus,
      replaySettled: state.commandRestartSemantics.replaySettled,
      nextRestartAction: state.commandRestartSemantics.nextRestartAction
    },
    payloadSchema,
    payload: {
      requestId: state.requestId,
      bootId: state.persisted.bootId,
      command: state.command,
      route: state.route,
      tenantId: state.scope.tenantId,
      workspaceKey: state.scope.workspaceKey,
      persistenceKey: state.stateTransition.persistenceKey,
      recoveryCursor: state.persistenceEnvelope.nextRecoveryCursor,
      providerSyncWatermark: state.providerContract.syncWatermark,
      providerServiceSyncFingerprint: state.providerSyncContract.syncFingerprint,
      providerSyncClaims: state.providerSyncContract.claims.map((claim) => ({
        provider: claim.provider,
        action: claim.action,
        claimToken: claim.claimToken,
        cursor: claim.cursor,
        ackCursor: claim.ackCursor,
        pendingOperations: claim.pendingOperations
      })),
      providerHandoffClaim: {
        status: state.providerHandoffClaim.status,
        targetProvider: state.providerHandoffClaim.targetProvider,
        targetHandoffUri: state.providerHandoffClaim.targetHandoffUri,
        requiredProviderNames: state.providerHandoffClaim.requiredProviderNames,
        claimedProviderNames: state.providerHandoffClaim.claimedProviderNames,
        waitingProviders: state.providerHandoffClaim.waitingProviders,
        missingLeaseProviders: state.providerHandoffClaim.missingLeaseProviders,
        claimFingerprint: state.providerHandoffClaim.claimFingerprint
      },
      artifactRoot: state.artifacts.root,
      artifactBasePath: state.artifacts.basePath,
      proofPath: state.artifacts.proofPath,
      manifestPath: state.artifacts.manifestPath,
      ledgerPath: state.artifacts.ledgerPath,
      artifactRetentionKey: state.artifacts.retentionKey,
      scopeProofStatus: state.scopeProof.status,
      scopeProofFingerprint: state.scopeProof.scopeBindingFingerprint,
      lifecycleControlFingerprint: state.lifecycle.controlFingerprint
    },
    restartCommandState: {
      status: state.commandRestartSemantics.status,
      restartSafeStatus: state.commandRestartSemantics.restartSafeStatus,
      safeToHandoff: state.commandRestartSemantics.safeToHandoff,
      replaySettled: state.commandRestartSemantics.replaySettled,
      handoffRequired: state.commandRestartSemantics.handoffRequired,
      nextRestartAction: state.commandRestartSemantics.nextRestartAction,
      pendingWriteIds: state.commandRestartSemantics.pendingWriteIds,
      acceptedWriteIds: state.commandRestartSemantics.acceptedWriteIds,
      missingWriteIds: state.commandRestartSemantics.missingWriteIds,
      rejectedWriteIds: state.commandRestartSemantics.rejectedWriteIds
    },
    validationErrors,
    proofDigest,
    issuedAt: now
  };
}

function resolveNextAction(state) {
  if (state.lifecycle.status === "blocked") return "block-lifecycle-controls";
  if (state.lifecycle.status === "scheduled" && state.command === "execute") return "queue-execute-until-lifecycle-ready";
  if (state.lifecycle.status === "scheduled") return "queue-command-until-lifecycle-ready";
  if (state.stateTransition.resultConflict) return "block-command-result-digest-conflict";
  if (state.handoffManifest && state.handoffManifest.status === "blocked") return "block-handoff-manifest-invalid";
  if (state.providerSyncContract.status === "blocked") return "block-provider-sync-contract";
  if (state.providerHandoffClaim.status === "blocked") return "block-provider-handoff-claim";
  if (state.providerSyncContract.status === "backpressure" && state.command === "execute") return "queue-execute-until-provider-sync-ready";
  if (state.providerHandoffClaim.status !== "ready") return "wait-for-provider-handoff-claim";
  if (state.boundary.enforcement === "blocked") return "block-tenant-boundary-violation";
  if (state.providerContract.status === "blocked") return "block-provider-contract-unavailable";
  if (state.health.failureState.blocked) return "block-unhealthy-hosted-kernel";
  if (state.health.degradedMode.enabled && state.command === "execute") return "queue-runtime-command-until-healthy";
  if (state.health.degradedMode.enabled && state.command === "plan") return "open-plan-workflow-readonly";
  if (state.boundary.enforcement === "read-only-redacted") return "render-redacted-boundary-status";
  if (state.command === "recover") return "recover-hosted-kernel-session";
  if (state.command === "status") return "render-restart-safe-status";
  if (state.commandRestartSemantics?.replaySettled) return "reuse-persisted-command-result";
  if (state.stateTransition.idempotent) return "reuse-persisted-command-result";
  if (state.handoff === "plan") return "open-plan-workflow";
  if (state.handoff === "execute") return "dispatch-runtime-command";
  if (state.handoff === "audit") return "render-boot-proof";
  return "resume-hosted-kernel-session";
}

function normalizeHealthSignal(input, parsed, now) {
  const source = input.kernelHealth && typeof input.kernelHealth === "object" ? input.kernelHealth : {};
  const flagStatus = parsed.flags.kernelStatus || parsed.flags.healthStatus;
  const rawStatus = readString(source.status || flagStatus, "ok");
  const status = Object.prototype.hasOwnProperty.call(HEALTH_SEVERITY_RANK, rawStatus) ? rawStatus : "warn";
  const checkSource = readString(source.source || parsed.flags.healthSource, "hosted-kernel");
  const heartbeatAgeMs = Math.max(0, readNumber(source.heartbeatAgeMs || parsed.flags.heartbeatAgeMs, 0));
  const queueDepth = Math.max(0, readNumber(source.queueDepth || parsed.flags.queueDepth, 0));
  const activeWorkers = Math.max(0, readNumber(source.activeWorkers || parsed.flags.activeWorkers, 1));
  const lastErrorCode = readString(source.lastErrorCode || parsed.flags.lastErrorCode, "");
  const lastErrorMessage = readString(source.lastErrorMessage || parsed.flags.lastErrorMessage, "");
  const checks = [
    {
      name: "kernel-status",
      status,
      source: checkSource,
      observedAt: readString(source.observedAt || parsed.flags.healthObservedAt, now)
    },
    {
      name: "heartbeat-age",
      status: heartbeatAgeMs > 30000 ? "degraded" : heartbeatAgeMs > 10000 ? "warn" : "ok",
      valueMs: heartbeatAgeMs,
      thresholdMs: 30000
    },
    {
      name: "runtime-workers",
      status: activeWorkers < 1 ? "failed" : "ok",
      activeWorkers
    },
    {
      name: "handoff-queue-depth",
      status: queueDepth > 50 ? "degraded" : queueDepth > 20 ? "warn" : "ok",
      queueDepth
    }
  ];

  if (lastErrorCode || lastErrorMessage) {
    checks.push({
      name: "last-kernel-error",
      status: status === "failed" ? "failed" : "warn",
      code: lastErrorCode || "kernel-error",
      message: lastErrorMessage || "hosted kernel reported an error"
    });
  }

  return {
    source: checkSource,
    status,
    heartbeatAgeMs,
    queueDepth,
    activeWorkers,
    lastErrorCode,
    lastErrorMessage,
    checks
  };
}

function validateBootReadiness(state, healthSignal) {
  const findings = [];

  if (!state.scope.workspaceRoot && (state.command === "execute" || state.command === "plan")) {
    findings.push({
      code: "workspace-root-missing",
      severity: "warn",
      field: "workspaceRoot",
      message: "Workspace root is required for writable CLI boot commands."
    });
  }

  if (state.command === "execute" && !state.interactive && state.handoff !== "execute") {
    findings.push({
      code: "execute-handoff-mismatch",
      severity: "degraded",
      field: "handoff",
      message: "Non-interactive execute requests must target the execute handoff."
    });
  }

  if (state.persisted.status === "failed" && state.command !== "recover" && state.command !== "status") {
    findings.push({
      code: "failed-session-requires-recover",
      severity: "failed",
      field: "command",
      message: "The persisted boot session failed and must be recovered before new writable work."
    });
  }

  if (state.command === "recover" && !state.persisted.recoveryCursor.valid) {
    findings.push({
      code: "recovery-cursor-missing",
      severity: "degraded",
      field: "persistedState.recoveryCursor",
      message: "Recover requested without a valid recovery cursor; falling back to the latest checkpoint."
    });
  }

  if (state.persisted.recoveryCursor.sequence > state.persisted.sequence) {
    findings.push({
      code: "recovery-cursor-sequence-conflict",
      severity: "failed",
      field: "persistedState.recoveryCursor.sequence",
      message: "Recovery cursor sequence is ahead of the persisted boot session sequence."
    });
  }

  if (state.stateTransition?.resultConflict) {
    findings.push({
      code: "command-result-digest-conflict",
      severity: "failed",
      field: "persistedState.commandResults",
      message: "A persisted command result exists for this idempotency key but its digest conflicts with the requested result digest."
    });
  }

  if (state.persisted.pendingWriteCount > 0 && state.command !== "status" && state.command !== "recover") {
    findings.push({
      code: "pending-state-writes",
      severity: "warn",
      field: "persistedState.pendingWrites",
      message: "Pending persisted state writes must be acknowledged before starting a new writable command."
    });
  }

  if (state.providerContract.status === "blocked") {
    findings.push({
      code: "provider-contract-unavailable",
      severity: "failed",
      field: "providerServices",
      message: `Required CLI boot providers are unavailable: ${state.providerContract.unavailableProviders.join(", ")}.`
    });
  } else if (state.providerContract.status === "degraded") {
    findings.push({
      code: "provider-contract-degraded",
      severity: "warn",
      field: "providerServices",
      message: `Required CLI boot providers are degraded: ${state.providerContract.degradedProviders.join(", ")}.`
    });
  }

  if (state.providerSyncContract.status === "blocked") {
    findings.push({
      code: "provider-sync-contract-blocked",
      severity: "failed",
      field: "providerServices.sync",
      message: `Required CLI boot provider sync claims are blocked: ${state.providerSyncContract.blockedProviders.concat(state.providerSyncContract.missingAckProviders).join(", ")}.`
    });
  } else if (state.providerSyncContract.status === "backpressure") {
    findings.push({
      code: "provider-sync-backpressure",
      severity: "degraded",
      field: "providerServices.sync.pendingOperations",
      message: `Provider sync backpressure is active for: ${state.providerSyncContract.backpressureProviders.join(", ")}.`
    });
  }

  if (state.providerHandoffClaim.status === "blocked") {
    findings.push({
      code: "provider-handoff-claim-blocked",
      severity: "failed",
      field: "providerServices.sync.leaseId",
      message: `Provider handoff claim is blocked for: ${state.providerHandoffClaim.missingLeaseProviders.join(", ") || state.providerHandoffClaim.targetProvider}.`
    });
  } else if (state.providerHandoffClaim.status !== "ready") {
    findings.push({
      code: "provider-handoff-claim-pending",
      severity: "degraded",
      field: "providerServices.sync.claimToken",
      message: `Provider handoff claim is pending for: ${state.providerHandoffClaim.waitingProviders.join(", ") || state.providerHandoffClaim.targetProvider}.`
    });
  }

  for (const finding of state.lifecycle.validationFindings) {
    findings.push(finding);
  }

  for (const finding of state.artifacts.validationFindings) {
    findings.push(finding);
  }

  for (const finding of state.scopeProof.validationFindings) {
    findings.push(finding);
  }

  for (const finding of state.clientRequest.validationFindings) {
    findings.push(finding);
  }

  for (const finding of state.clientRuntime.validationFindings) {
    findings.push(finding);
  }

  for (const check of healthSignal.checks) {
    if (check.status !== "ok") {
      findings.push({
        code: `health-${check.name}`,
        severity: check.status,
        field: check.name,
        message: `${check.name} reported ${check.status}`
      });
    }
  }

  return findings;
}

function resolveRetryBackoff(state, findings, parsed) {
  const maxAttempts = Math.max(1, Math.floor(readNumber(parsed.flags.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts)));
  const baseDelayMs = Math.max(100, Math.floor(readNumber(parsed.flags.retryBaseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs)));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(readNumber(parsed.flags.retryMaxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs)));
  const attempt = Math.max(1, Math.floor(readNumber(state.persisted.retryAttempt || parsed.flags.retryAttempt, 1)));
  const retryable = findings.some((finding) => finding.severity === "warn" || finding.severity === "degraded")
    && !findings.some((finding) => finding.severity === "failed")
    && state.boundary.enforcement !== "blocked";
  const nextDelayMs = retryable && attempt < maxAttempts
    ? Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)))
    : 0;

  return {
    retryable,
    attempt,
    maxAttempts,
    exhausted: retryable ? attempt >= maxAttempts : false,
    nextDelayMs,
    strategy: retryable ? "exponential-backoff" : "none"
  };
}

function normalizeClientRequestEnvelope(input, parsed, command, handoff, now) {
  const source = input.clientRequest && typeof input.clientRequest === "object" ? input.clientRequest : {};
  const requestedChannel = readString(source.channel || parsed.flags.clientChannel, "terminal");
  const channel = KNOWN_CLIENT_CHANNELS.has(requestedChannel) ? requestedChannel : "terminal";
  const requestedDeliveryMode = readString(source.deliveryMode || parsed.flags.deliveryMode, "");
  const callbackUri = readString(source.callbackUri || parsed.flags.callbackUri, "");
  const continuationToken = readString(source.continuationToken || parsed.flags.continuationToken, "");
  const deadlineMs = Math.max(100, Math.floor(readNumber(
    source.deadlineMs || parsed.flags.deadlineMs,
    COMMAND_ACK_DEADLINES_MS[command] || 2500
  )));
  const wantsStreaming = readBoolean(source.streaming ?? parsed.flags.streaming, command === "execute");
  const acceptsQueuedHandoff = readBoolean(source.acceptsQueuedHandoff ?? parsed.flags.acceptsQueuedHandoff, true);
  const deliveryMode = KNOWN_HANDOFF_DELIVERY_MODES.has(requestedDeliveryMode)
    ? requestedDeliveryMode
    : callbackUri
      ? "callback"
      : channel === "terminal"
        ? "inline"
        : "queued";
  const validationFindings = [];

  if (!KNOWN_CLIENT_CHANNELS.has(requestedChannel)) {
    validationFindings.push({
      code: "client-channel-invalid",
      severity: "warn",
      field: "clientRequest.channel",
      message: `Client channel must be one of: ${Array.from(KNOWN_CLIENT_CHANNELS).join(", ")}.`
    });
  }

  if (requestedDeliveryMode && !KNOWN_HANDOFF_DELIVERY_MODES.has(requestedDeliveryMode)) {
    validationFindings.push({
      code: "handoff-delivery-mode-invalid",
      severity: "warn",
      field: "clientRequest.deliveryMode",
      message: `Handoff delivery mode must be one of: ${Array.from(KNOWN_HANDOFF_DELIVERY_MODES).join(", ")}.`
    });
  }

  if (deliveryMode === "callback" && !callbackUri) {
    validationFindings.push({
      code: "handoff-callback-uri-missing",
      severity: "failed",
      field: "clientRequest.callbackUri",
      message: "Callback handoff delivery requires a callbackUri."
    });
  }

  if (channel !== "terminal" && deliveryMode === "inline" && handoff === "execute") {
    validationFindings.push({
      code: "inline-execute-handoff-unsupported",
      severity: "degraded",
      field: "clientRequest.deliveryMode",
      message: "Non-terminal execute handoffs should use callback or queued delivery."
    });
  }

  return {
    version: "cli-boot.client-request.v1",
    channel,
    deliveryMode,
    callbackUri,
    continuationToken,
    wantsStreaming,
    acceptsQueuedHandoff,
    deadlineMs,
    ackPolicy: HANDOFF_ACK_POLICIES[handoff] || "handoff-observed",
    requestedAt: readString(source.requestedAt || parsed.flags.clientRequestedAt, now),
    validationFindings,
    clientFingerprint: stableStateFingerprint([
      channel,
      deliveryMode,
      callbackUri,
      continuationToken,
      wantsStreaming ? "stream" : "single",
      acceptsQueuedHandoff ? "queue-ok" : "queue-denied",
      deadlineMs
    ])
  };
}

function normalizeClientRuntimeCapabilities(input, parsed, state, now) {
  const source = input.clientRuntime && typeof input.clientRuntime === "object" ? input.clientRuntime : {};
  const ackTransport = readString(source.ackTransport || parsed.flags.ackTransport, state.clientRequest.channel === "terminal" ? "stdio" : state.clientRequest.channel);
  const normalizedAckTransport = KNOWN_CLIENT_RUNTIME_ACK_TRANSPORTS.has(ackTransport) ? ackTransport : "event-log";
  const supportedDeliveryModes = normalizeStringList(source.supportedDeliveryModes || parsed.flags.supportedDeliveryModes)
    .filter((mode) => KNOWN_HANDOFF_DELIVERY_MODES.has(mode));
  const deliveryModes = supportedDeliveryModes.length
    ? supportedDeliveryModes
    : state.clientRequest.channel === "terminal"
      ? ["inline", "manual"]
      : ["callback", "queued"];
  const supportsStreaming = readBoolean(source.supportsStreaming ?? parsed.flags.supportsStreaming, state.clientRequest.channel === "websocket");
  const supportsCallbacks = readBoolean(source.supportsCallbacks ?? parsed.flags.supportsCallbacks, state.clientRequest.channel !== "terminal");
  const supportsQueueClaims = readBoolean(source.supportsQueueClaims ?? parsed.flags.supportsQueueClaims, state.clientRequest.channel !== "terminal");
  const maxInlinePayloadBytes = Math.max(256, Math.floor(readNumber(source.maxInlinePayloadBytes || parsed.flags.maxInlinePayloadBytes, 16384)));
  const maxAckLatencyMs = Math.max(100, Math.floor(readNumber(source.maxAckLatencyMs || parsed.flags.maxAckLatencyMs, state.clientRequest.deadlineMs)));
  const deliveryModeSupported = deliveryModes.includes(state.clientRequest.deliveryMode);
  const validationFindings = [];

  if (!KNOWN_CLIENT_RUNTIME_ACK_TRANSPORTS.has(ackTransport)) {
    validationFindings.push({
      code: "client-runtime-ack-transport-invalid",
      severity: "warn",
      field: "clientRuntime.ackTransport",
      message: `Client runtime acknowledgement transport must be one of: ${Array.from(KNOWN_CLIENT_RUNTIME_ACK_TRANSPORTS).join(", ")}.`
    });
  }

  if (!deliveryModeSupported) {
    validationFindings.push({
      code: "client-runtime-delivery-unsupported",
      severity: state.clientRequest.acceptsQueuedHandoff && deliveryModes.includes("queued") ? "degraded" : "failed",
      field: "clientRuntime.supportedDeliveryModes",
      message: `Client runtime does not support ${state.clientRequest.deliveryMode} delivery for ${state.command}.`
    });
  }

  if (state.clientRequest.deliveryMode === "callback" && !supportsCallbacks) {
    validationFindings.push({
      code: "client-runtime-callback-unsupported",
      severity: "failed",
      field: "clientRuntime.supportsCallbacks",
      message: "Callback delivery was requested but the client runtime cannot receive callback handoffs."
    });
  }

  if (state.clientRequest.deliveryMode === "queued" && (!supportsQueueClaims || !state.clientRequest.acceptsQueuedHandoff)) {
    validationFindings.push({
      code: "client-runtime-queue-claim-unsupported",
      severity: "failed",
      field: "clientRuntime.supportsQueueClaims",
      message: "Queued delivery requires a client runtime that can claim queued hosted-kernel handoffs."
    });
  }

  if (state.clientRequest.wantsStreaming && state.command === "execute" && !supportsStreaming) {
    validationFindings.push({
      code: "client-runtime-streaming-unsupported",
      severity: "degraded",
      field: "clientRuntime.supportsStreaming",
      message: "Execute requested streaming output, but the client runtime only supports single-response handoffs."
    });
  }

  if (state.clientRequest.deadlineMs > maxAckLatencyMs) {
    validationFindings.push({
      code: "client-runtime-ack-deadline-exceeds-capability",
      severity: "warn",
      field: "clientRuntime.maxAckLatencyMs",
      message: "Client acknowledgement deadline exceeds the runtime transport capability."
    });
  }

  return {
    version: "cli-boot.client-runtime.v1",
    channel: state.clientRequest.channel,
    supportedDeliveryModes: deliveryModes,
    ackTransport: normalizedAckTransport,
    supportsStreaming,
    supportsCallbacks,
    supportsQueueClaims,
    maxInlinePayloadBytes,
    maxAckLatencyMs,
    dispatchCapability: validationFindings.some((finding) => finding.severity === "failed")
      ? "blocked"
      : validationFindings.some((finding) => finding.severity === "degraded")
        ? "degraded"
        : "ready",
    validationFindings,
    runtimeFingerprint: stableStateFingerprint([
      state.clientRequest.channel,
      deliveryModes.join(","),
      normalizedAckTransport,
      supportsStreaming ? "stream" : "single",
      supportsCallbacks ? "callbacks" : "no-callbacks",
      supportsQueueClaims ? "queue-claims" : "no-queue-claims",
      maxInlinePayloadBytes,
      maxAckLatencyMs
    ]),
    observedAt: now
  };
}

function buildWorkflowHandoffToken(state) {
  return `handoff:${stableStateFingerprint([
    state.requestId,
    state.persisted.bootId,
    state.command,
    state.handoffManifest.targetProvider,
    state.stateTransition.persistenceKey,
    state.clientRequest.clientFingerprint,
    state.clientRuntime.runtimeFingerprint
  ])}`;
}

function normalizeClientHandoffReceipt(input, parsed, state, now) {
  const requestReceipt = input.clientRequest?.handoffReceipt && typeof input.clientRequest.handoffReceipt === "object"
    ? input.clientRequest.handoffReceipt
    : {};
  const runtimeReceipt = input.clientRuntime?.handoffReceipt && typeof input.clientRuntime.handoffReceipt === "object"
    ? input.clientRuntime.handoffReceipt
    : {};
  const source = { ...requestReceipt, ...runtimeReceipt };
  const rawStatus = readString(source.status || parsed.flags.handoffReceiptStatus, "");
  const status = KNOWN_HANDOFF_RECEIPT_STATUSES.has(rawStatus)
    ? rawStatus
    : rawStatus
      ? "failed"
      : "pending";
  const expectedHandoffToken = buildWorkflowHandoffToken(state);
  const expectedContinuationToken = state.clientRequest.continuationToken || expectedHandoffToken;
  const token = readString(source.continuationToken || source.handoffToken || parsed.flags.handoffReceiptToken, "");
  const proofDigest = readString(source.proofDigest || parsed.flags.handoffReceiptProofDigest, "");
  const ackPolicy = readString(source.ackPolicy || parsed.flags.handoffReceiptPolicy, state.clientRequest.ackPolicy);
  const receivedAt = readString(source.receivedAt || source.acknowledgedAt || parsed.flags.handoffReceiptAt, "");
  const latencyMs = Math.max(0, Math.floor(readNumber(
    source.latencyMs || parsed.flags.handoffReceiptLatencyMs,
    receivedAt ? 0 : state.clientRequest.deadlineMs
  )));
  const terminalReceipt = status === "accepted" || status === "delivered" || status === "failed" || status === "timed-out";
  const acknowledgementRequired = state.handoffManifest.status !== "blocked"
    && state.commandRestartSemantics.handoffRequired;
  const validationFindings = [];

  if (rawStatus && !KNOWN_HANDOFF_RECEIPT_STATUSES.has(rawStatus)) {
    validationFindings.push({
      code: "handoff-receipt-status-invalid",
      severity: "warn",
      field: "clientRuntime.handoffReceipt.status",
      message: `Handoff receipt status must be one of: ${Array.from(KNOWN_HANDOFF_RECEIPT_STATUSES).join(", ")}.`
    });
  }

  if (token && token !== expectedContinuationToken && token !== expectedHandoffToken) {
    validationFindings.push({
      code: "handoff-receipt-token-mismatch",
      severity: "failed",
      field: "clientRuntime.handoffReceipt.continuationToken",
      message: "Client handoff receipt token does not match the issued workflow continuation token."
    });
  }

  if (proofDigest && proofDigest !== state.handoffManifest.proofDigest) {
    validationFindings.push({
      code: "handoff-receipt-proof-mismatch",
      severity: "failed",
      field: "clientRuntime.handoffReceipt.proofDigest",
      message: "Client handoff receipt proof digest does not match the hosted-kernel handoff manifest."
    });
  }

  if (ackPolicy && ackPolicy !== state.clientRequest.ackPolicy) {
    validationFindings.push({
      code: "handoff-receipt-policy-mismatch",
      severity: "warn",
      field: "clientRuntime.handoffReceipt.ackPolicy",
      message: "Client handoff receipt acknowledgement policy differs from the negotiated workflow policy."
    });
  }

  if (acknowledgementRequired && status === "timed-out") {
    validationFindings.push({
      code: "handoff-receipt-timeout",
      severity: "degraded",
      field: "clientRuntime.handoffReceipt.status",
      message: "Client runtime did not acknowledge the hosted-kernel handoff before the deadline."
    });
  }

  const receiptAccepted = status === "accepted" || status === "delivered";
  const receiptFailed = status === "failed" || status === "timed-out"
    || validationFindings.some((finding) => finding.severity === "failed");
  const receiptStatus = !acknowledgementRequired
    ? "not-required"
    : receiptFailed
      ? "rejected"
      : receiptAccepted
        ? "acknowledged"
        : terminalReceipt
          ? "observed"
          : "pending";

  return {
    version: "cli-boot.client-handoff-receipt.v1",
    status: receiptStatus,
    required: acknowledgementRequired,
    expectedContinuationToken,
    expectedProofDigest: state.handoffManifest.proofDigest,
    expectedAckPolicy: state.clientRequest.ackPolicy,
    received: {
      status,
      continuationToken: token,
      proofDigest,
      ackPolicy,
      transport: state.clientRuntime.ackTransport,
      receivedAt,
      latencyMs
    },
    satisfied: acknowledgementRequired ? receiptStatus === "acknowledged" : true,
    validationFindings,
    receiptFingerprint: stableStateFingerprint([
      state.requestId,
      expectedContinuationToken,
      state.handoffManifest.proofDigest,
      status,
      token,
      proofDigest,
      ackPolicy,
      receivedAt
    ]),
    observedAt: receivedAt || now
  };
}

function buildHostedBootCommandOrchestration(state, now) {
  const receiptRequired = state.clientHandoffReceipt.required;
  const receiptSatisfied = state.clientHandoffReceipt.satisfied;
  const preflightBlocks = [
    state.boundary.enforcement === "blocked" ? "permission-boundary-blocked" : "",
    state.health.failureState.blocked ? "health-failure-blocked" : "",
    state.providerContract.status === "blocked" ? "provider-contract-blocked" : "",
    state.providerSyncContract.status === "blocked" ? "provider-sync-blocked" : "",
    state.providerHandoffClaim.status === "blocked" ? "provider-handoff-claim-blocked" : "",
    state.lifecycle.status === "blocked" ? "lifecycle-blocked" : "",
    state.artifacts.status === "blocked" ? "artifact-root-blocked" : "",
    state.scopeProof.status === "blocked" ? "scope-proof-blocked" : "",
    state.persistenceEnvelope.status === "blocked" ? "persistence-blocked" : "",
    state.restartRecoveryLedger.status === "blocked" ? "restart-recovery-blocked" : "",
    state.commandRestartSemantics.restartSafeStatus === "unsafe" ? "command-restart-state-unsafe" : "",
    state.handoffManifest.status === "blocked" ? "handoff-manifest-blocked" : "",
    state.clientRuntime.dispatchCapability === "blocked" ? "client-runtime-blocked" : "",
    state.clientHandoffReceipt.status === "rejected" ? "handoff-receipt-rejected" : ""
  ].filter(Boolean);
  const queueReasons = [
    state.lifecycle.status === "scheduled" ? "lifecycle-scheduled" : "",
    state.providerSyncContract.status === "backpressure" ? "provider-sync-backpressure" : "",
    state.providerHandoffClaim.status === "waiting" ? "provider-handoff-claim-waiting" : "",
    state.providerHandoffClaim.status === "claim-required" ? "provider-handoff-claim-required" : "",
    state.commandRestartSemantics.status === "recovering-writes" ? "command-state-recovery" : "",
    state.handoffManifest.status === "scheduled" ? "handoff-manifest-scheduled" : ""
  ].filter(Boolean);
  const acknowledgementPending = receiptRequired && !receiptSatisfied && preflightBlocks.length === 0;
  const canDispatch = preflightBlocks.length === 0 && queueReasons.length === 0 && !acknowledgementPending;
  const status = preflightBlocks.length
    ? "blocked"
    : queueReasons.length
      ? "queued"
      : acknowledgementPending
        ? "awaiting-ack"
        : "dispatchable";
  const phaseStatus = (blockedReasons, pendingReasons = []) => (
    blockedReasons.length ? "blocked" : pendingReasons.length ? "pending" : "ready"
  );
  const artifactWritePlan = state.artifacts.initializationPlan.filePlan.map((file) => ({
    kind: file.kind,
    path: file.path,
    writeId: file.writeId,
    writeMode: file.writeMode,
    required: file.required,
    status: file.status,
    handoffField: file.handoffField
  }));
  const phases = [
    {
      name: "preflight",
      status: phaseStatus(preflightBlocks.filter((reason) => reason !== "handoff-receipt-rejected"), queueReasons),
      required: true,
      gates: {
        permission: state.boundary.enforcement,
        health: state.health.status,
        providerContract: state.providerContract.status,
        providerSync: state.providerSyncContract.status,
        lifecycle: state.lifecycle.status,
        scopeProof: state.scopeProof.status,
        restartRecovery: state.restartRecoveryLedger.restartSafeStatus,
        commandRestart: state.commandRestartSemantics.restartSafeStatus
      }
    },
    {
      name: "command-state-recovery",
      status: state.commandRestartSemantics.restartSafeStatus === "unsafe"
        ? "blocked"
        : state.commandRestartSemantics.status === "recovering-writes"
          ? "pending"
          : "ready",
      required: state.command !== "status",
      restartSafeStatus: state.commandRestartSemantics.restartSafeStatus,
      nextRestartAction: state.commandRestartSemantics.nextRestartAction,
      replaySettled: state.commandRestartSemantics.replaySettled,
      writeIntents: state.commandRestartSemantics.writeIntents
    },
    {
      name: "artifact-root-initialization",
      status: state.artifacts.status === "blocked" ? "blocked" : "ready",
      required: true,
      root: state.artifacts.root,
      basePath: state.artifacts.basePath,
      directoryPlan: state.artifacts.initializationPlan.directoryPlan,
      writePlan: artifactWritePlan
    },
    {
      name: "persistence-commit",
      status: state.persistenceEnvelope.status === "blocked" ? "blocked" : "ready",
      required: state.persistenceEnvelope.writePlan.mode === "append-if-absent",
      idempotencyKey: state.persistenceEnvelope.idempotencyKey,
      writePlanMode: state.persistenceEnvelope.writePlan.mode,
      pendingWriteCount: state.persistenceEnvelope.writePlan.pendingWriteCount,
      recoveryCursor: state.persistenceEnvelope.nextRecoveryCursor
    },
    {
      name: "provider-handoff-claim",
      status: state.providerHandoffClaim.status === "blocked"
        ? "blocked"
        : state.providerHandoffClaim.status === "ready"
          ? "ready"
          : "pending",
      required: state.providerHandoffClaim.requiredProviderNames.length > 0,
      targetProvider: state.providerHandoffClaim.targetProvider,
      targetHandoffUri: state.providerHandoffClaim.targetHandoffUri,
      requiredProviderNames: state.providerHandoffClaim.requiredProviderNames,
      claimedProviderNames: state.providerHandoffClaim.claimedProviderNames,
      waitingProviders: state.providerHandoffClaim.waitingProviders,
      missingLeaseProviders: state.providerHandoffClaim.missingLeaseProviders,
      claimFingerprint: state.providerHandoffClaim.claimFingerprint
    },
    {
      name: "boot-proof-handoff",
      status: state.handoffManifest.status === "blocked"
        ? "blocked"
        : acknowledgementPending
          ? "pending"
          : state.handoffManifest.status === "scheduled"
            ? "pending"
            : "ready",
      required: true,
      targetProvider: state.handoffManifest.targetProvider,
      providerHandoffUri: state.handoffManifest.providerHandoffUri,
      proofDigest: state.handoffManifest.proofDigest,
      acknowledgementPolicy: state.clientRequest.ackPolicy,
      acknowledgementRequired: receiptRequired,
      acknowledgementSatisfied: receiptSatisfied
    }
  ];
  const orchestrationId = `hosted-boot:${stableStateFingerprint([
    state.requestId,
    state.persisted.bootId,
    state.command,
    state.stateTransition.persistenceKey,
    status,
    state.providerSyncContract.syncFingerprint,
    state.providerHandoffClaim.claimFingerprint,
    state.artifacts.retentionKey,
    state.handoffManifest.proofDigest,
    state.clientHandoffReceipt.receiptFingerprint
  ])}`;

  return {
    version: "cli-boot.hosted-command-orchestration.v1",
    status,
    orchestrationId,
    command: state.command,
    route: state.route,
    bootId: state.persisted.bootId,
    requestId: state.requestId,
    canDispatch,
    nextAction: canDispatch
      ? "dispatch-hosted-command"
      : status === "queued"
        ? "wait-for-orchestration-queue"
        : status === "awaiting-ack"
          ? "wait-for-client-handoff-ack"
          : "block-hosted-command",
    dispatchTarget: {
      handoff: state.handoff,
      provider: state.handoffManifest.targetProvider,
      uri: state.handoffManifest.providerHandoffUri,
      deliveryMode: state.clientRequest.deliveryMode,
      ackTransport: state.clientRuntime.ackTransport
    },
    artifactRootInitialization: {
      status: state.artifacts.initializationPlan.status,
      root: state.artifacts.root,
      basePath: state.artifacts.basePath,
      retentionKey: state.artifacts.retentionKey,
      writePlan: artifactWritePlan
    },
    scopeProof: {
      status: state.scopeProof.status,
      required: state.scopeProof.required,
      supplied: state.scopeProof.supplied,
      scopeBindingFingerprint: state.scopeProof.scopeBindingFingerprint,
      validationCodes: state.scopeProof.validationFindings.map((finding) => finding.code)
    },
    bootProofHandoff: {
      status: state.handoffManifest.status,
      proofDigest: state.handoffManifest.proofDigest,
      manifestPath: state.artifacts.manifestPath,
      proofPath: state.artifacts.proofPath,
      ledgerPath: state.artifacts.ledgerPath,
      acknowledgementRequired: receiptRequired,
      acknowledgementSatisfied: receiptSatisfied,
      receiptStatus: state.clientHandoffReceipt.status
    },
    providerHandoffClaim: {
      status: state.providerHandoffClaim.status,
      targetProvider: state.providerHandoffClaim.targetProvider,
      targetHandoffUri: state.providerHandoffClaim.targetHandoffUri,
      nextAction: state.providerHandoffClaim.nextAction,
      requiredProviderNames: state.providerHandoffClaim.requiredProviderNames,
      claimedProviderNames: state.providerHandoffClaim.claimedProviderNames,
      waitingProviders: state.providerHandoffClaim.waitingProviders,
      missingLeaseProviders: state.providerHandoffClaim.missingLeaseProviders,
      claimFingerprint: state.providerHandoffClaim.claimFingerprint
    },
    restartCommandState: {
      status: state.commandRestartSemantics.status,
      restartSafeStatus: state.commandRestartSemantics.restartSafeStatus,
      nextRestartAction: state.commandRestartSemantics.nextRestartAction,
      replaySettled: state.commandRestartSemantics.replaySettled,
      handoffRequired: state.commandRestartSemantics.handoffRequired,
      safeToHandoff: state.commandRestartSemantics.safeToHandoff,
      pendingWriteIds: state.commandRestartSemantics.pendingWriteIds,
      acceptedWriteIds: state.commandRestartSemantics.acceptedWriteIds,
      missingWriteIds: state.commandRestartSemantics.missingWriteIds,
      rejectedWriteIds: state.commandRestartSemantics.rejectedWriteIds
    },
    preflightBlocks,
    queueReasons,
    acknowledgementPending,
    phases,
    issuedAt: now
  };
}

function summarizeValidationFindings(findings) {
  const counts = { ok: 0, warn: 0, degraded: 0, failed: 0 };
  const fields = {};

  for (const finding of findings) {
    const severity = Object.prototype.hasOwnProperty.call(counts, finding.severity) ? finding.severity : "warn";
    counts[severity] += 1;
    fields[finding.field || "unknown"] = (fields[finding.field || "unknown"] || 0) + 1;
  }

  return {
    total: findings.length,
    counts,
    failedCodes: findings.filter((finding) => finding.severity === "failed").map((finding) => finding.code),
    degradedCodes: findings.filter((finding) => finding.severity === "degraded").map((finding) => finding.code),
    warningCodes: findings.filter((finding) => finding.severity === "warn").map((finding) => finding.code),
    fields
  };
}

function buildPreviewAcceptanceReadinessContract(state, now) {
  const workflow = state.commandOrchestration;
  const directiveStatus = state.handoffManifest.status === "blocked"
    ? "blocked"
    : workflow.status === "dispatchable"
      ? "ready"
      : workflow.status;
  const validationFindings = [
    ...state.health.findings,
    ...state.handoffManifest.validationErrors.map((code) => ({
      code,
      severity: "failed",
      field: "handoff.manifest",
      message: `Hosted boot handoff manifest validation failed: ${code}.`
    })),
    ...state.clientHandoffReceipt.validationFindings
  ];
  const validationSummary = summarizeValidationFindings(validationFindings);
  const readyChecklist = workflow.phases.map((phase) => ({
    name: phase.name,
    status: phase.status,
    required: phase.required,
    blocksAcceptance: phase.required && phase.status === "blocked",
    blocksDispatch: phase.status === "blocked" || phase.status === "pending",
    nextStep: phase.status === "ready"
      ? "continue"
      : phase.name === "artifact-root-initialization"
        ? "initialize-artifact-root"
        : phase.name === "provider-handoff-claim"
          ? state.providerHandoffClaim.nextAction
          : phase.name === "boot-proof-handoff"
            ? workflow.acknowledgementPending ? "acknowledge-boot-proof-handoff" : "repair-boot-proof-handoff"
            : workflow.nextAction
  }));
  const blockingChecklist = readyChecklist.filter((item) => item.blocksDispatch);
  const previewToken = `preview:${stableStateFingerprint([
    state.requestId,
    state.persisted.bootId,
    state.command,
    workflow.orchestrationId,
    state.handoffManifest.proofDigest,
    state.clientRequest.clientFingerprint
  ])}`;
  const acceptanceToken = `accept:${stableStateFingerprint([
    previewToken,
    state.persistenceEnvelope.idempotencyKey,
    state.providerHandoffClaim.claimFingerprint,
    state.artifacts.retentionKey,
    state.clientHandoffReceipt.expectedContinuationToken
  ])}`;
  const requiresOperatorAcceptance = state.command !== "status"
    && workflow.status !== "blocked"
    && !state.commandRestartSemantics.replaySettled;
  const acceptanceSatisfied = !requiresOperatorAcceptance
    || state.clientHandoffReceipt.satisfied
    || workflow.canDispatch;
  const nextStepReasons = [
    ...workflow.preflightBlocks,
    ...workflow.queueReasons,
    workflow.acknowledgementPending ? "client-acknowledgement-pending" : "",
    state.health.remediationPlan.primaryAction !== "continue" ? state.health.remediationPlan.primaryAction : ""
  ].filter(Boolean);

  return {
    version: "cli-boot.preview-acceptance-readiness.v1",
    status: directiveStatus === "ready" && acceptanceSatisfied
      ? "accepted"
      : directiveStatus === "blocked"
        ? "blocked"
        : requiresOperatorAcceptance
          ? "acceptance-required"
          : directiveStatus,
    preview: {
      token: previewToken,
      title: `Preview ${state.command} boot handoff for ${state.scope.workspaceKey}`,
      command: state.command,
      route: state.route,
      handoff: state.handoff,
      deliveryMode: state.clientRequest.deliveryMode,
      targetProvider: state.handoffManifest.targetProvider,
      proofDigest: state.handoffManifest.proofDigest,
      proofPath: state.artifacts.proofPath,
      manifestPath: state.artifacts.manifestPath,
      ledgerPath: state.artifacts.ledgerPath,
      continuationToken: state.clientHandoffReceipt.expectedContinuationToken
    },
    acceptance: {
      required: requiresOperatorAcceptance,
      satisfied: acceptanceSatisfied,
      token: acceptanceToken,
      requiredAckPolicy: state.clientRequest.ackPolicy,
      receiptStatus: state.clientHandoffReceipt.status,
      receiptSatisfied: state.clientHandoffReceipt.satisfied,
      deadlineMs: state.clientRequest.deadlineMs,
      manualContinuationRequired: workflow.status === "blocked" || state.clientRequest.deliveryMode === "manual"
    },
    readiness: {
      status: workflow.status,
      canDispatch: workflow.canDispatch && acceptanceSatisfied,
      nextAction: acceptanceSatisfied ? workflow.nextAction : "wait-for-preview-acceptance",
      nextStepReasons,
      blockingPhaseNames: blockingChecklist.map((item) => item.name),
      queueReasons: workflow.queueReasons,
      preflightBlocks: workflow.preflightBlocks,
      acknowledgementPending: workflow.acknowledgementPending,
      checklist: readyChecklist
    },
    validationSummary,
    explainableNextStep: {
      action: acceptanceSatisfied ? workflow.nextAction : "collect-preview-acceptance",
      reason: nextStepReasons[0] || (requiresOperatorAcceptance && !acceptanceSatisfied
        ? "operator-acceptance-required"
        : "all-readiness-gates-clear"),
      message: validationSummary.counts.failed > 0
        ? state.health.remediationPlan.primaryMessage
        : requiresOperatorAcceptance && !acceptanceSatisfied
          ? "Review the hosted boot proof preview and accept the handoff before dispatch."
          : workflow.canDispatch
            ? "Hosted boot command is ready to dispatch."
            : "Hosted boot command is waiting for readiness gates to settle."
    },
    issuedAt: now
  };
}

function buildWorkflowHandoffDirective(state, contractStatus, now) {
  const client = state.clientRequest;
  const clientRuntime = state.clientRuntime;
  const receipt = state.clientHandoffReceipt;
  const manifest = state.handoffManifest;
  const blocked = contractStatus === "blocked"
    || manifest.status === "blocked"
    || state.providerHandoffClaim.status === "blocked"
    || client.validationFindings.some((finding) => finding.severity === "failed")
    || clientRuntime.validationFindings.some((finding) => finding.severity === "failed")
    || receipt.validationFindings.some((finding) => finding.severity === "failed");
  const queued = !blocked && (
    state.lifecycle.status === "scheduled"
    || state.providerSyncContract.status === "backpressure"
    || state.providerHandoffClaim.status === "waiting"
    || state.providerHandoffClaim.status === "claim-required"
    || manifest.status === "scheduled"
    || (client.deliveryMode === "queued" && client.acceptsQueuedHandoff)
    || (!clientRuntime.supportedDeliveryModes.includes(client.deliveryMode)
      && clientRuntime.supportedDeliveryModes.includes("queued")
      && client.acceptsQueuedHandoff)
  );
  const deliveryMode = blocked
    ? "manual"
    : queued
      ? "queued"
      : client.deliveryMode;
  const handoffToken = buildWorkflowHandoffToken(state);

  return {
    version: "cli-boot.workflow-handoff.v1",
    status: blocked ? "blocked" : queued ? "queued" : "ready",
    route: state.route,
    command: state.command,
    target: state.handoff,
    targetProvider: manifest.targetProvider,
    nextAction: resolveNextAction(state),
    delivery: {
      mode: deliveryMode,
      channel: client.channel,
      callbackUri: deliveryMode === "callback" ? client.callbackUri : "",
      streaming: client.wantsStreaming && state.command === "execute",
      continuationToken: client.continuationToken || handoffToken,
      queuedUntil: queued ? state.lifecycle.schedule.nextRunAt : "",
      ackTransport: clientRuntime.ackTransport,
      maxInlinePayloadBytes: clientRuntime.maxInlinePayloadBytes
    },
    acknowledgement: {
      required: manifest.status !== "blocked" && state.command !== "status",
      policy: client.ackPolicy,
      requiredProvider: manifest.requiredAckProvider,
      deadlineMs: client.deadlineMs,
      runtimeMaxLatencyMs: clientRuntime.maxAckLatencyMs,
      proofDigest: manifest.proofDigest,
      receiptStatus: receipt.status,
      receiptSatisfied: receipt.satisfied,
      receiptFingerprint: receipt.receiptFingerprint
    },
    runtime: {
      version: clientRuntime.version,
      dispatchCapability: clientRuntime.dispatchCapability,
      supportedDeliveryModes: clientRuntime.supportedDeliveryModes,
      supportsStreaming: clientRuntime.supportsStreaming,
      supportsCallbacks: clientRuntime.supportsCallbacks,
      supportsQueueClaims: clientRuntime.supportsQueueClaims,
      runtimeFingerprint: clientRuntime.runtimeFingerprint
    },
    userVisible: {
      label: `CLI boot: ${resolveNextAction(state)}`,
      message: blocked
        ? state.health.remediationPlan.primaryMessage
        : queued
          ? "The hosted-kernel handoff is queued until lifecycle controls allow it."
          : state.providerHandoffClaim.status !== "ready"
            ? "The hosted-kernel handoff is waiting for provider handoff claims."
          : receipt.required && !receipt.satisfied
            ? "The hosted-kernel handoff is ready and waiting for the client runtime acknowledgement."
          : "The hosted-kernel handoff is ready for the client runtime.",
      manualContinuationRequired: blocked || deliveryMode === "manual",
      acknowledgementPending: receipt.required && !receipt.satisfied && !blocked,
      remediationStatus: state.health.remediationPlan.status,
      primaryRemediationAction: state.health.remediationPlan.primaryAction,
      retryAfterMs: state.health.remediationPlan.retry.nextDelayMs,
      degradedFallbackCommand: state.health.remediationPlan.degradedFallback.command
    },
    validationFindings: [...client.validationFindings, ...clientRuntime.validationFindings, ...receipt.validationFindings],
    handoffToken,
    issuedAt: now
  };
}

function buildClientWorkflowCommandPacket(state, workflowDirective, now) {
  const continuationToken = workflowDirective.delivery.continuationToken;
  const receiptRequired = workflowDirective.acknowledgement.required;
  const receiptSatisfied = workflowDirective.acknowledgement.receiptSatisfied;
  const blocked = workflowDirective.status === "blocked";
  const queued = workflowDirective.status === "queued";
  const waitingForAck = receiptRequired && !receiptSatisfied && !blocked;
  const pendingPhaseNames = state.commandOrchestration.phases
    .filter((phase) => phase.status !== "ready")
    .map((phase) => phase.name);
  const nextClientAction = blocked
    ? "show-blocking-remediation"
    : queued
      ? "persist-queued-handoff-token"
      : waitingForAck
        ? "emit-handoff-receipt"
        : "invoke-hosted-provider";
  const baseArgs = [
    state.command,
    `--route=${state.route}`,
    `--handoff=${state.handoff}`,
    `--request-id=${state.requestId}`,
    `--tenant=${state.scope.tenantId}`,
    `--workspace=${state.scope.workspaceId}`,
    `--boot-id=${state.persisted.bootId}`,
    `--artifact-root=${state.artifacts.root}`,
    `--continuation-token=${continuationToken}`
  ];
  const receiptArgs = [
    state.command,
    `--request-id=${state.requestId}`,
    `--handoff-receipt-status=accepted`,
    `--handoff-receipt-token=${continuationToken}`,
    `--handoff-receipt-proof-digest=${state.handoffManifest.proofDigest}`,
    `--handoff-receipt-policy=${state.clientRequest.ackPolicy}`
  ];
  const dispatchArgs = [
    ...baseArgs,
    `--provider=${state.handoffManifest.targetProvider}`,
    `--provider-uri=${state.handoffManifest.providerHandoffUri}`,
    `--proof-path=${state.artifacts.proofPath}`,
    `--manifest-path=${state.artifacts.manifestPath}`,
    `--ledger-path=${state.artifacts.ledgerPath}`
  ];
  const queueArgs = [
    ...baseArgs,
    "--delivery-mode=queued",
    `--queued-until=${workflowDirective.delivery.queuedUntil || state.lifecycle.schedule.nextRunAt}`,
    `--queue-reasons=${state.commandOrchestration.queueReasons.join(",")}`
  ];
  const manualArgs = blocked ? baseArgs : queued ? queueArgs : waitingForAck ? receiptArgs : dispatchArgs;
  const acknowledgementReceiptTemplate = {
    status: receiptSatisfied ? workflowDirective.acknowledgement.receiptStatus : "accepted",
    continuationToken,
    proofDigest: state.handoffManifest.proofDigest,
    ackPolicy: state.clientRequest.ackPolicy,
    transport: state.clientRuntime.ackTransport,
    deadlineMs: state.clientRequest.deadlineMs
  };
  const proofHandoffFields = state.artifacts.artifactFiles.reduce((fields, artifact) => ({
    ...fields,
    [artifact.handoffField]: artifact.path
  }), {});
  const packetFingerprint = stableStateFingerprint([
    state.requestId,
    state.persisted.bootId,
    state.command,
    workflowDirective.status,
    workflowDirective.delivery.mode,
    continuationToken,
    state.handoffManifest.proofDigest,
    state.commandOrchestration.orchestrationId,
    state.clientHandoffReceipt.receiptFingerprint,
    pendingPhaseNames.join(",")
  ]);

  return {
    version: "cli-boot.client-workflow-command.v1",
    status: blocked
      ? "blocked"
      : queued
        ? "queued"
        : waitingForAck
          ? "acknowledgement-required"
          : "dispatch-ready",
    packetId: `client-workflow:${packetFingerprint}`,
    nextClientAction,
    command: state.command,
    route: state.route,
    handoff: state.handoff,
    targetProvider: state.handoffManifest.targetProvider,
    providerHandoffUri: state.handoffManifest.providerHandoffUri,
    deliveryMode: workflowDirective.delivery.mode,
    ackTransport: state.clientRuntime.ackTransport,
    continuationToken,
    pendingPhaseNames,
    manualCommand: {
      executable: "aios boot",
      argv: manualArgs,
      reason: nextClientAction,
      safeToCopy: !blocked
    },
    dispatchCommand: {
      executable: "aios boot",
      argv: dispatchArgs,
      enabled: !blocked && !queued && !waitingForAck,
      provider: state.handoffManifest.targetProvider,
      providerHandoffUri: state.handoffManifest.providerHandoffUri
    },
    acknowledgementCommand: {
      executable: "aios boot",
      argv: receiptArgs,
      required: waitingForAck,
      satisfied: receiptSatisfied,
      receiptTemplate: acknowledgementReceiptTemplate
    },
    queuedCommand: {
      executable: "aios boot",
      argv: queueArgs,
      required: queued,
      queuedUntil: workflowDirective.delivery.queuedUntil || state.lifecycle.schedule.nextRunAt,
      queueReasons: state.commandOrchestration.queueReasons
    },
    handoffPayload: {
      requestId: state.requestId,
      bootId: state.persisted.bootId,
      workspaceKey: state.scope.workspaceKey,
      persistenceKey: state.persistenceEnvelope.idempotencyKey,
      recoveryCursor: state.persistenceEnvelope.nextRecoveryCursor,
      providerHandoffClaim: state.providerHandoffClaim.claimFingerprint,
      proofDigest: state.handoffManifest.proofDigest,
      proofHandoffFields,
      artifactRetentionKey: state.artifacts.retentionKey
    },
    userVisible: {
      title: `Continue ${state.command} handoff for ${state.scope.workspaceKey}`,
      primaryAction: nextClientAction,
      message: blocked
        ? state.health.remediationPlan.primaryMessage
        : queued
          ? "Save the continuation token and retry after the queued handoff becomes ready."
          : waitingForAck
            ? "Acknowledge the boot proof handoff with the receipt token before dispatch continues."
            : "Dispatch the hosted boot command with the provided proof and artifact paths.",
      proofPath: state.artifacts.proofPath,
      manifestPath: state.artifacts.manifestPath,
      providerHandoffUri: state.handoffManifest.providerHandoffUri
    },
    packetFingerprint,
    issuedAt: now
  };
}

function buildActionableErrors(state, findings, retryPolicy) {
  return findings
    .filter((finding) => finding.severity === "degraded" || finding.severity === "failed")
    .map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      action: finding.code === "failed-session-requires-recover"
        ? "Run the recover command for this boot id before executing new work."
        : finding.code.startsWith("lifecycle-") || finding.code.startsWith("maintenance-window")
          ? "Update lifecycle settings or wait for the scheduled lifecycle window before continuing."
        : finding.code === "provider-contract-unavailable"
          ? "Restore the unavailable provider service contract or choose a read-only command."
        : finding.code === "provider-sync-contract-blocked"
          ? "Restore provider sync acknowledgement cursors before dispatching the hosted-kernel handoff."
        : finding.code === "provider-sync-backpressure"
          ? "Wait for provider sync queues to drain or choose a read-only command."
        : finding.code.startsWith("provider-handoff-claim")
          ? "Provide required provider handoff claim leases or wait for provider handoff claims to settle."
        : finding.code === "command-result-digest-conflict"
          ? "Inspect the persisted command result ledger before replaying this boot command."
        : finding.code.startsWith("prior-boot-proof-")
          ? "Provide a prior boot proof that matches the requested tenant, workspace, boot session, and artifact root."
        : finding.code === "execute-handoff-mismatch"
          ? "Set --handoff=execute or run the command interactively."
        : finding.code.startsWith("client-") || finding.code.startsWith("handoff-callback")
          ? "Update the client request handoff delivery contract before continuing."
        : retryPolicy.retryable
            ? `Retry after ${retryPolicy.nextDelayMs}ms or inspect hosted-kernel health.`
            : "Inspect hosted-kernel health before continuing.",
      bootId: state.persisted.bootId
    }));
}

function buildOperationalRemediationPlan(state, findings, retryPolicy, now) {
  const relevantFindings = findings
    .filter((finding) => finding.severity === "warn" || finding.severity === "degraded" || finding.severity === "failed")
    .sort((left, right) => (
      HEALTH_SEVERITY_RANK[right.severity] - HEALTH_SEVERITY_RANK[left.severity]
      || left.code.localeCompare(right.code)
    ));
  const providerBlockers = new Set([
    ...state.providerContract.unavailableProviders,
    ...state.providerSyncContract.blockedProviders,
    ...state.providerSyncContract.missingAckProviders,
    ...state.providerSyncContract.backpressureProviders,
    ...state.providerHandoffClaim.waitingProviders,
    ...state.providerHandoffClaim.missingLeaseProviders
  ]);
  const failedFindings = relevantFindings.filter((finding) => finding.severity === "failed");
  const degradedFindings = relevantFindings.filter((finding) => finding.severity === "degraded");
  const blocksDispatch = failedFindings.length > 0
    || state.boundary.enforcement === "blocked"
    || state.lifecycle.status === "blocked"
    || state.artifacts.status === "blocked"
    || state.scopeProof.status === "blocked"
    || state.providerSyncContract.status === "blocked";
  const canDegradeToReadOnly = !blocksDispatch
    && state.command !== "status"
    && (degradedFindings.length > 0 || state.providerContract.status === "degraded");
  const retryEligibleCodes = new Set([
    "provider-sync-backpressure",
    "provider-handoff-claim-pending",
    "health-heartbeat-age",
    "health-handoff-queue-depth",
    "health-last-kernel-error",
    "client-runtime-streaming-unsupported",
    "recovery-cursor-missing",
    "pending-state-writes"
  ]);
  const steps = relevantFindings.slice(0, 8).map((finding, index) => {
    const providerNames = finding.code.startsWith("provider-sync") || finding.code.startsWith("provider-handoff-claim")
      ? Array.from(providerBlockers)
      : finding.code === "provider-contract-unavailable"
        ? state.providerContract.unavailableProviders
        : finding.code === "provider-contract-degraded"
          ? state.providerContract.degradedProviders
          : [];
    const retryable = retryPolicy.retryable && retryEligibleCodes.has(finding.code);
    const operatorAction = finding.code === "failed-session-requires-recover"
      ? "run-recover-command"
      : finding.code === "provider-contract-unavailable"
        ? "restore-required-provider-service"
        : finding.code === "provider-sync-contract-blocked"
          ? "restore-provider-sync-acknowledgement"
          : finding.code === "provider-sync-backpressure"
            ? "wait-for-provider-sync-drain"
            : finding.code === "provider-handoff-claim-blocked"
              ? "restore-provider-handoff-lease"
              : finding.code === "provider-handoff-claim-pending"
                ? "wait-provider-handoff-claim"
                : finding.code.startsWith("artifact-")
                  ? "repair-artifact-root-configuration"
                  : finding.code.startsWith("prior-boot-proof-")
                    ? "supply-matching-prior-boot-proof"
                    : finding.code.startsWith("client-runtime") || finding.code.startsWith("client-channel")
                      ? "negotiate-supported-client-handoff"
                      : finding.code.startsWith("lifecycle-") || finding.code.startsWith("maintenance-window")
                        ? "adjust-lifecycle-controls"
                        : retryable
                          ? "retry-after-backoff"
                          : "inspect-hosted-kernel-health";

    return {
      order: index + 1,
      code: finding.code,
      severity: finding.severity,
      field: finding.field,
      blocksDispatch: finding.severity === "failed",
      retryable,
      retryAfterMs: retryable ? retryPolicy.nextDelayMs : 0,
      operatorAction,
      suggestedCommand: finding.code === "failed-session-requires-recover"
        ? "recover"
        : canDegradeToReadOnly && (state.command === "execute" || state.command === "plan")
          ? "status"
          : state.command,
      affectedProviders: providerNames,
      message: finding.message
    };
  });
  const primaryStep = steps[0] || null;
  const status = blocksDispatch
    ? "operator-action-required"
    : retryPolicy.retryable
      ? "retryable"
      : canDegradeToReadOnly
        ? "degraded-readonly-available"
        : relevantFindings.length
          ? "watch"
          : "clear";

  return {
    version: "cli-boot.operational-remediation.v1",
    status,
    generatedAt: now,
    blocksDispatch,
    retry: {
      eligible: retryPolicy.retryable,
      exhausted: retryPolicy.exhausted,
      attempt: retryPolicy.attempt,
      maxAttempts: retryPolicy.maxAttempts,
      nextDelayMs: retryPolicy.nextDelayMs,
      nextRetryToken: retryPolicy.retryable && retryPolicy.nextDelayMs > 0
        ? `retry:${stableStateFingerprint([
          state.persisted.bootId,
          state.command,
          retryPolicy.attempt,
          retryPolicy.nextDelayMs,
          state.providerSyncContract.syncFingerprint
        ])}`
        : ""
    },
    degradedFallback: {
      available: canDegradeToReadOnly,
      mode: canDegradeToReadOnly ? "read-only-status" : "",
      command: canDegradeToReadOnly ? "status" : "",
      reason: canDegradeToReadOnly ? "writable-command-degraded-but-observable" : ""
    },
    failureState: {
      failedFindingCodes: failedFindings.map((finding) => finding.code),
      degradedFindingCodes: degradedFindings.map((finding) => finding.code),
      affectedProviders: Array.from(providerBlockers).sort(),
      artifactRootStatus: state.artifacts.status,
      lifecycleStatus: state.lifecycle.status,
      scopeProofStatus: state.scopeProof.status,
      providerSyncStatus: state.providerSyncContract.status,
      providerHandoffClaimStatus: state.providerHandoffClaim.status
    },
    primaryAction: primaryStep ? primaryStep.operatorAction : "continue",
    primaryMessage: primaryStep ? primaryStep.message : "CLI boot health checks are clear.",
    steps
  };
}

function resolveOperationalHealth(state, parsed, now) {
  const signal = normalizeHealthSignal(state.input, parsed, now);
  const findings = validateBootReadiness(state, signal);
  const worstSeverity = findings.reduce((worst, finding) => (
    HEALTH_SEVERITY_RANK[finding.severity] > HEALTH_SEVERITY_RANK[worst] ? finding.severity : worst
  ), signal.status);
  const retryPolicy = resolveRetryBackoff(state, findings, parsed);
  const failureState = {
    blocked: worstSeverity === "failed" || retryPolicy.exhausted,
    reason: worstSeverity === "failed"
      ? "non-recoverable-health-finding"
      : retryPolicy.exhausted
        ? "retry-budget-exhausted"
        : ""
  };
  const degradedMode = {
    enabled: worstSeverity === "warn" || worstSeverity === "degraded",
    reason: worstSeverity === "degraded" ? "hosted-kernel-degraded" : worstSeverity === "warn" ? "hosted-kernel-warning" : "",
    writableCommandsAllowed: worstSeverity === "warn",
    readOnlyCommandsAllowed: true
  };
  const remediationPlan = buildOperationalRemediationPlan(state, findings, retryPolicy, now);

  return {
    status: failureState.blocked ? "failed" : degradedMode.enabled ? "degraded" : "healthy",
    severity: worstSeverity,
    signal,
    findings,
    retryPolicy,
    degradedMode,
    failureState,
    remediationPlan,
    actionableErrors: buildActionableErrors(state, findings, retryPolicy)
  };
}

function normalizeClientState(input, parsed, now) {
  const requestedHandoff = readString(input.handoff || parsed.flags.handoff, "resume");
  const handoff = KNOWN_HANDOFFS.has(requestedHandoff) ? requestedHandoff : "resume";
  const requestId = readString(input.requestId || parsed.flags.requestId, `cli-boot:${handoff}`);
  const operatorId = readString(input.operatorId || parsed.flags.operatorId, "local-operator");
  const route = readString(input.route || parsed.flags.route, DEFAULT_BOOT_ROUTE);
  const command = normalizeBootCommand(input, parsed);
  const scope = normalizeWorkspaceScope(input, parsed);
  const roles = normalizeOperatorRoles(input, parsed);
  const capabilities = resolveGrantedCapabilities(input, parsed, roles);
  const boundary = resolveBoundaryDecision(command, handoff, scope, roles, capabilities);
  const providerServices = normalizeProviderServices(input, parsed, now);
  const providerContract = negotiateProviderContract(command, providerServices, now);
  const providerSyncContract = buildProviderServiceSyncContract(command, providerContract, scope, requestId, now);
  const persisted = normalizePersistedState(input, parsed, command, {
    requestId,
    operatorId,
    tenantId: scope.tenantId,
    workspaceKey: scope.workspaceKey,
    route
  }, now);
  const recovery = buildRecoveryPlan(command, persisted, now);

  const state = {
    requestId,
    operatorId,
    route,
    handoff,
    command,
    scope,
    boundary,
    providerServices,
    providerContract,
    providerSyncContract,
    persisted,
    recovery,
    interactive: input.interactive === false || parsed.flags.noInteractive ? false : true,
    argv: parsed.passthrough,
    flags: parsed.flags,
    input
  };

  state.clientRequest = normalizeClientRequestEnvelope(input, parsed, command, handoff, now);
  state.clientRuntime = normalizeClientRuntimeCapabilities(input, parsed, state, now);
  state.lifecycle = resolveLifecycleControls(state, parsed, now);
  state.providerHandoffClaim = buildProviderHandoffClaimState(state, now);
  state.stateTransition = buildStateTransition(state, now);
  state.artifacts = initializeArtifactRoot(state, parsed, now);
  state.scopeProof = normalizePriorBootProofScope(state, parsed, now);
  state.health = resolveOperationalHealth(state, parsed, now);
  state.persistenceEnvelope = buildPersistenceEnvelope(state, now);
  state.restartRecoveryLedger = buildRestartRecoveryLedger(state, now);
  state.commandRestartSemantics = buildRestartSafeCommandSemantics(state, now);
  state.handoffManifest = buildHostedKernelHandoffManifest(state, now);
  state.clientHandoffReceipt = normalizeClientHandoffReceipt(input, parsed, state, now);
  state.commandOrchestration = buildHostedBootCommandOrchestration(state, now);
  state.previewAcceptanceReadiness = buildPreviewAcceptanceReadinessContract(state, now);

  return state;
}

function buildRuntimeContract(state, evidence, now) {
  const requiredInputs = ["requestId", "operatorId", "route", "handoff"];
  const missing = requiredInputs.filter((key) => !state[key]);
  const blocked = missing.length > 0
    || state.boundary.enforcement === "blocked"
    || state.health.failureState.blocked
    || state.handoffManifest.status === "blocked"
    || state.providerSyncContract.status === "blocked"
    || state.providerHandoffClaim.status === "blocked"
    || state.artifacts.status === "blocked"
    || state.scopeProof.status === "blocked"
    || state.commandRestartSemantics.restartSafeStatus === "unsafe"
    || state.clientRequest.validationFindings.some((finding) => finding.severity === "failed")
    || state.clientRuntime.validationFindings.some((finding) => finding.severity === "failed")
    || state.clientHandoffReceipt.validationFindings.some((finding) => finding.severity === "failed");
  const workflowDirective = buildWorkflowHandoffDirective(state, blocked ? "blocked" : "ready", now);
  const workflowCommandPacket = buildClientWorkflowCommandPacket(state, workflowDirective, now);

  return {
    version: "cli-boot.runtime.v2",
    status: blocked ? "blocked" : "ready",
    missing,
    request: {
      id: state.requestId,
      operatorId: state.operatorId,
      route: state.route,
      interactive: state.interactive,
      client: {
        version: state.clientRequest.version,
        channel: state.clientRequest.channel,
        deliveryMode: state.clientRequest.deliveryMode,
        callbackUri: state.clientRequest.callbackUri,
        wantsStreaming: state.clientRequest.wantsStreaming,
        acceptsQueuedHandoff: state.clientRequest.acceptsQueuedHandoff,
        deadlineMs: state.clientRequest.deadlineMs,
        ackPolicy: state.clientRequest.ackPolicy,
        requestedAt: state.clientRequest.requestedAt,
        validationFindings: state.clientRequest.validationFindings,
        clientFingerprint: state.clientRequest.clientFingerprint
      },
      runtime: {
        version: state.clientRuntime.version,
        channel: state.clientRuntime.channel,
        supportedDeliveryModes: state.clientRuntime.supportedDeliveryModes,
        ackTransport: state.clientRuntime.ackTransport,
        supportsStreaming: state.clientRuntime.supportsStreaming,
        supportsCallbacks: state.clientRuntime.supportsCallbacks,
        supportsQueueClaims: state.clientRuntime.supportsQueueClaims,
        maxInlinePayloadBytes: state.clientRuntime.maxInlinePayloadBytes,
        maxAckLatencyMs: state.clientRuntime.maxAckLatencyMs,
        dispatchCapability: state.clientRuntime.dispatchCapability,
        validationFindings: state.clientRuntime.validationFindings,
        runtimeFingerprint: state.clientRuntime.runtimeFingerprint
      },
      handoffReceipt: {
        version: state.clientHandoffReceipt.version,
        status: state.clientHandoffReceipt.status,
        required: state.clientHandoffReceipt.required,
        satisfied: state.clientHandoffReceipt.satisfied,
        expectedContinuationToken: state.clientHandoffReceipt.expectedContinuationToken,
        expectedProofDigest: state.clientHandoffReceipt.expectedProofDigest,
        expectedAckPolicy: state.clientHandoffReceipt.expectedAckPolicy,
        received: state.clientHandoffReceipt.received,
        validationFindings: state.clientHandoffReceipt.validationFindings,
        receiptFingerprint: state.clientHandoffReceipt.receiptFingerprint,
        observedAt: state.clientHandoffReceipt.observedAt
      }
    },
    scope: {
      tenantId: state.scope.tenantId,
      workspaceId: state.scope.workspaceId,
      workspaceKey: state.scope.workspaceKey,
      workspaceRoot: state.scope.workspaceRoot,
      tenantAllowed: state.scope.tenantAllowed,
      workspaceAllowed: state.scope.workspaceAllowed
    },
    permissions: {
      status: state.boundary.status,
      enforcement: state.boundary.enforcement,
      roles: state.boundary.roles,
      requiredCapabilities: state.boundary.requiredCapabilities,
      grantedCapabilities: state.boundary.grantedCapabilities,
      missingCapabilities: state.boundary.missingCapabilities,
      violations: state.boundary.violations
    },
    providers: {
      status: state.providerContract.status,
      version: state.providerContract.version,
      command: state.providerContract.command,
      requiredProviders: state.providerContract.requiredProviders,
      unavailableProviders: state.providerContract.unavailableProviders,
      degradedProviders: state.providerContract.degradedProviders,
      negotiations: state.providerContract.negotiations,
      syncWatermark: state.providerContract.syncWatermark,
      negotiatedAt: state.providerContract.negotiatedAt,
      serviceSync: {
        version: state.providerSyncContract.version,
        status: state.providerSyncContract.status,
        requirement: state.providerSyncContract.requirement,
        claimableProviders: state.providerSyncContract.claimableProviders,
        blockedProviders: state.providerSyncContract.blockedProviders,
        backpressureProviders: state.providerSyncContract.backpressureProviders,
        missingAckProviders: state.providerSyncContract.missingAckProviders,
        pendingOperations: state.providerSyncContract.pendingOperations,
        syncFingerprint: state.providerSyncContract.syncFingerprint,
        claims: state.providerSyncContract.claims,
        negotiatedAt: state.providerSyncContract.negotiatedAt
      },
      handoffClaim: {
        version: state.providerHandoffClaim.version,
        status: state.providerHandoffClaim.status,
        targetProvider: state.providerHandoffClaim.targetProvider,
        targetHandoffUri: state.providerHandoffClaim.targetHandoffUri,
        targetReady: state.providerHandoffClaim.targetReady,
        requiredProviderNames: state.providerHandoffClaim.requiredProviderNames,
        claimedProviderNames: state.providerHandoffClaim.claimedProviderNames,
        waitingProviders: state.providerHandoffClaim.waitingProviders,
        missingLeaseProviders: state.providerHandoffClaim.missingLeaseProviders,
        claimFingerprint: state.providerHandoffClaim.claimFingerprint,
        nextAction: state.providerHandoffClaim.nextAction,
        claimRecords: state.providerHandoffClaim.claimRecords,
        negotiatedAt: state.providerHandoffClaim.negotiatedAt
      }
    },
    handoff: {
      target: state.handoff,
      nextAction: resolveNextAction(state),
      auditHandoffRequired: state.boundary.auditHandoffRequired,
      manifest: state.handoffManifest,
      manifestIssuedAt: now,
      workflow: workflowDirective,
      workflowCommandPacket,
      commandOrchestration: state.commandOrchestration,
      previewAcceptanceReadiness: state.previewAcceptanceReadiness
    },
    hostedBootCommand: {
      version: state.commandOrchestration.version,
      status: state.commandOrchestration.status,
      orchestrationId: state.commandOrchestration.orchestrationId,
      canDispatch: state.commandOrchestration.canDispatch,
      nextAction: state.commandOrchestration.nextAction,
      dispatchTarget: state.commandOrchestration.dispatchTarget,
      artifactRootInitialization: state.commandOrchestration.artifactRootInitialization,
      scopeProof: state.commandOrchestration.scopeProof,
      bootProofHandoff: state.commandOrchestration.bootProofHandoff,
      providerHandoffClaim: state.commandOrchestration.providerHandoffClaim,
      restartCommandState: state.commandOrchestration.restartCommandState,
      preflightBlocks: state.commandOrchestration.preflightBlocks,
      queueReasons: state.commandOrchestration.queueReasons,
      acknowledgementPending: state.commandOrchestration.acknowledgementPending,
      phases: state.commandOrchestration.phases,
      previewAcceptanceReadiness: state.previewAcceptanceReadiness,
      workflowCommandPacket,
      issuedAt: state.commandOrchestration.issuedAt
    },
    lifecycle: {
      version: state.lifecycle.version,
      status: state.lifecycle.status,
      enabled: state.lifecycle.enabled,
      mode: state.lifecycle.mode,
      commandWritable: state.lifecycle.commandWritable,
      commandAllowed: state.lifecycle.commandAllowed,
      disabledCommands: state.lifecycle.disabledCommands,
      schedule: state.lifecycle.schedule,
      maintenanceWindow: state.lifecycle.maintenanceWindow,
      validationFindings: state.lifecycle.validationFindings,
      controlFingerprint: state.lifecycle.controlFingerprint,
      evaluatedAt: state.lifecycle.evaluatedAt
    },
    artifacts: {
      version: state.artifacts.version,
      status: state.artifacts.status,
      requestedRoot: state.artifacts.requestedRoot,
      root: state.artifacts.root,
      basePath: state.artifacts.basePath,
      proofPath: state.artifacts.proofPath,
      manifestPath: state.artifacts.manifestPath,
      ledgerPath: state.artifacts.ledgerPath,
      retentionKey: state.artifacts.retentionKey,
      rootSource: state.artifacts.rootSource,
      artifactFiles: state.artifacts.artifactFiles,
      initializationPlan: state.artifacts.initializationPlan,
      validationFindings: state.artifacts.validationFindings,
      initializedAt: state.artifacts.initializedAt
    },
    scopeProof: {
      version: state.scopeProof.version,
      status: state.scopeProof.status,
      required: state.scopeProof.required,
      supplied: state.scopeProof.supplied,
      proofDigest: state.scopeProof.proofDigest,
      manifestDigest: state.scopeProof.manifestDigest,
      tenantId: state.scopeProof.tenantId,
      workspaceId: state.scopeProof.workspaceId,
      workspaceKey: state.scopeProof.workspaceKey,
      bootId: state.scopeProof.bootId,
      command: state.scopeProof.command,
      artifactRoot: state.scopeProof.artifactRoot,
      artifactBasePath: state.scopeProof.artifactBasePath,
      retentionKey: state.scopeProof.retentionKey,
      scopeBindingFingerprint: state.scopeProof.scopeBindingFingerprint,
      validationFindings: state.scopeProof.validationFindings,
      evaluatedAt: state.scopeProof.evaluatedAt
    },
    health: {
      status: state.health.status,
      severity: state.health.severity,
      source: state.health.signal.source,
      checks: state.health.signal.checks,
      findings: state.health.findings,
      retryPolicy: state.health.retryPolicy,
      degradedMode: state.health.degradedMode,
      failureState: state.health.failureState,
      remediationPlan: state.health.remediationPlan,
      actionableErrors: state.health.actionableErrors
    },
    state: {
      bootId: state.persisted.bootId,
      command: state.command,
      idempotent: state.stateTransition.idempotent,
      idempotencyReason: state.stateTransition.idempotencyReason,
      commandResultReplayable: state.stateTransition.resultReplayable,
      commandResultConflict: state.stateTransition.resultConflict,
      persistedCommandResult: state.stateTransition.persistedResult,
      previousStatus: state.stateTransition.previousStatus,
      nextStatus: state.stateTransition.nextStatus,
      restartSafeStatus: state.recovery.restartSafeStatus,
      commandRestartSafeStatus: state.commandRestartSemantics.restartSafeStatus,
      commandRestartStatus: state.commandRestartSemantics.status,
      commandRestartNextAction: state.commandRestartSemantics.nextRestartAction,
      commandReplaySettled: state.commandRestartSemantics.replaySettled,
      recoveryMode: state.recovery.mode,
      sequence: state.stateTransition.sequence,
      persistenceKey: state.stateTransition.persistenceKey,
      commandResultDigest: state.stateTransition.commandResultDigest,
      pendingWriteCount: state.persistenceEnvelope.writePlan.pendingWriteCount
    },
    persistence: state.persistenceEnvelope,
    restartRecovery: state.restartRecoveryLedger,
    externalHandoffState: {
      providerStatus: state.providerContract.status,
      handoffUris: state.providerContract.negotiations
        .filter((item) => item.available && item.handoffUri)
        .map((item) => item.handoffUri),
      syncWatermark: state.providerContract.syncWatermark,
      serviceSyncStatus: state.providerSyncContract.status,
      serviceSyncFingerprint: state.providerSyncContract.syncFingerprint,
      providerHandoffClaimStatus: state.providerHandoffClaim.status,
      providerHandoffClaimFingerprint: state.providerHandoffClaim.claimFingerprint,
      providerHandoffClaimNextAction: state.providerHandoffClaim.nextAction,
      providerHandoffClaimRecords: state.providerHandoffClaim.claimRecords,
      providerSyncClaims: state.providerSyncContract.claims.map((claim) => ({
        provider: claim.provider,
        action: claim.action,
        claimToken: claim.claimToken,
        syncMode: claim.syncMode,
        cursor: claim.cursor,
        ackCursor: claim.ackCursor,
        pendingOperations: claim.pendingOperations,
        leaseId: claim.leaseId,
        externallyManaged: claim.externallyManaged
      })),
      pendingSyncOperations: state.providerContract.negotiations
        .reduce((total, item) => total + item.sync.pendingOperations, 0),
      checkpoint: state.stateTransition.checkpoint,
      recoveryCursor: state.persistenceEnvelope.nextRecoveryCursor,
      persistenceWritePlan: state.persistenceEnvelope.writePlan,
      commandResultReplay: state.persistenceEnvelope.commandResultReplay,
      commandRestartSemantics: {
        version: state.commandRestartSemantics.version,
        status: state.commandRestartSemantics.status,
        restartSafeStatus: state.commandRestartSemantics.restartSafeStatus,
        nextRestartAction: state.commandRestartSemantics.nextRestartAction,
        replaySettled: state.commandRestartSemantics.replaySettled,
        safeToHandoff: state.commandRestartSemantics.safeToHandoff,
        handoffRequired: state.commandRestartSemantics.handoffRequired,
        expectedWriteIds: state.commandRestartSemantics.expectedWriteIds,
        committedWriteIds: state.commandRestartSemantics.committedWriteIds,
        pendingWriteIds: state.commandRestartSemantics.pendingWriteIds,
        acceptedWriteIds: state.commandRestartSemantics.acceptedWriteIds,
        missingWriteIds: state.commandRestartSemantics.missingWriteIds,
        rejectedWriteIds: state.commandRestartSemantics.rejectedWriteIds,
        writeIntents: state.commandRestartSemantics.writeIntents
      },
      restartRecovery: {
        status: state.restartRecoveryLedger.status,
        restartSafeStatus: state.restartRecoveryLedger.restartSafeStatus,
        nextRecoveryAction: state.restartRecoveryLedger.nextRecoveryAction,
        replayWriteIds: state.restartRecoveryLedger.replayWriteIds,
        waitingWriteIds: state.restartRecoveryLedger.waitingWriteIds,
        rejectedWriteIds: state.restartRecoveryLedger.rejectedWriteIds
      },
      handoffManifest: {
        status: state.handoffManifest.status,
        targetProvider: state.handoffManifest.targetProvider,
        providerHandoffUri: state.handoffManifest.providerHandoffUri,
        requiredAckProvider: state.handoffManifest.requiredAckProvider,
        proofDigest: state.handoffManifest.proofDigest,
        validationErrors: state.handoffManifest.validationErrors
      },
      artifactRoot: {
        status: state.artifacts.status,
        rootSource: state.artifacts.rootSource,
        root: state.artifacts.root,
        basePath: state.artifacts.basePath,
        proofPath: state.artifacts.proofPath,
        manifestPath: state.artifacts.manifestPath,
        ledgerPath: state.artifacts.ledgerPath,
        retentionKey: state.artifacts.retentionKey,
        artifactFiles: state.artifacts.artifactFiles,
        initializationPlan: state.artifacts.initializationPlan
      },
      workflowHandoff: {
        status: workflowDirective.status,
        deliveryMode: workflowDirective.delivery.mode,
        channel: workflowDirective.delivery.channel,
        continuationToken: workflowDirective.delivery.continuationToken,
        acknowledgementPolicy: workflowDirective.acknowledgement.policy,
        acknowledgementDeadlineMs: workflowDirective.acknowledgement.deadlineMs,
        acknowledgementTransport: workflowDirective.delivery.ackTransport,
        acknowledgementReceiptStatus: workflowDirective.acknowledgement.receiptStatus,
        acknowledgementReceiptSatisfied: workflowDirective.acknowledgement.receiptSatisfied,
        acknowledgementReceiptFingerprint: workflowDirective.acknowledgement.receiptFingerprint,
        runtimeDispatchCapability: workflowDirective.runtime.dispatchCapability,
        runtimeFingerprint: workflowDirective.runtime.runtimeFingerprint,
        manualContinuationRequired: workflowDirective.userVisible.manualContinuationRequired,
        acknowledgementPending: workflowDirective.userVisible.acknowledgementPending,
        remediationStatus: workflowDirective.userVisible.remediationStatus,
        primaryRemediationAction: workflowDirective.userVisible.primaryRemediationAction,
        retryAfterMs: workflowDirective.userVisible.retryAfterMs,
        degradedFallbackCommand: workflowDirective.userVisible.degradedFallbackCommand,
        handoffToken: workflowDirective.handoffToken
      },
      workflowCommandPacket: {
        status: workflowCommandPacket.status,
        packetId: workflowCommandPacket.packetId,
        nextClientAction: workflowCommandPacket.nextClientAction,
        manualCommandArgv: workflowCommandPacket.manualCommand.argv,
        dispatchEnabled: workflowCommandPacket.dispatchCommand.enabled,
        acknowledgementRequired: workflowCommandPacket.acknowledgementCommand.required,
        acknowledgementSatisfied: workflowCommandPacket.acknowledgementCommand.satisfied,
        queuedRequired: workflowCommandPacket.queuedCommand.required,
        pendingPhaseNames: workflowCommandPacket.pendingPhaseNames,
        continuationToken: workflowCommandPacket.continuationToken,
        proofDigest: workflowCommandPacket.handoffPayload.proofDigest,
        packetFingerprint: workflowCommandPacket.packetFingerprint
      },
      hostedBootCommand: {
        status: state.commandOrchestration.status,
        orchestrationId: state.commandOrchestration.orchestrationId,
        canDispatch: state.commandOrchestration.canDispatch,
        nextAction: state.commandOrchestration.nextAction,
        preflightBlocks: state.commandOrchestration.preflightBlocks,
        queueReasons: state.commandOrchestration.queueReasons,
        acknowledgementPending: state.commandOrchestration.acknowledgementPending,
        scopeProofStatus: state.commandOrchestration.scopeProof.status,
        scopeProofFingerprint: state.commandOrchestration.scopeProof.scopeBindingFingerprint,
        artifactRootInitializationStatus: state.commandOrchestration.artifactRootInitialization.status,
        bootProofHandoffStatus: state.commandOrchestration.bootProofHandoff.status,
        commandRestartStatus: state.commandOrchestration.restartCommandState.status,
        commandRestartNextAction: state.commandOrchestration.restartCommandState.nextRestartAction,
        previewStatus: state.previewAcceptanceReadiness.status,
        previewToken: state.previewAcceptanceReadiness.preview.token,
        acceptanceRequired: state.previewAcceptanceReadiness.acceptance.required,
        acceptanceSatisfied: state.previewAcceptanceReadiness.acceptance.satisfied,
        readinessNextAction: state.previewAcceptanceReadiness.readiness.nextAction,
        readinessReason: state.previewAcceptanceReadiness.explainableNextStep.reason,
        validationFailedCount: state.previewAcceptanceReadiness.validationSummary.counts.failed,
        validationDegradedCount: state.previewAcceptanceReadiness.validationSummary.counts.degraded
      },
      providerHandoffClaim: {
        status: state.providerHandoffClaim.status,
        targetProvider: state.providerHandoffClaim.targetProvider,
        targetHandoffUri: state.providerHandoffClaim.targetHandoffUri,
        nextAction: state.providerHandoffClaim.nextAction,
        requiredProviderNames: state.providerHandoffClaim.requiredProviderNames,
        claimedProviderNames: state.providerHandoffClaim.claimedProviderNames,
        waitingProviders: state.providerHandoffClaim.waitingProviders,
        missingLeaseProviders: state.providerHandoffClaim.missingLeaseProviders,
        claimFingerprint: state.providerHandoffClaim.claimFingerprint
      },
      lifecycleControls: {
        status: state.lifecycle.status,
        mode: state.lifecycle.mode,
        scheduleMode: state.lifecycle.schedule.mode,
        nextRunAt: state.lifecycle.schedule.nextRunAt,
        controlFingerprint: state.lifecycle.controlFingerprint
      },
      operationalRemediation: {
        status: state.health.remediationPlan.status,
        blocksDispatch: state.health.remediationPlan.blocksDispatch,
        primaryAction: state.health.remediationPlan.primaryAction,
        primaryMessage: state.health.remediationPlan.primaryMessage,
        retry: state.health.remediationPlan.retry,
        degradedFallback: state.health.remediationPlan.degradedFallback,
        failureState: state.health.remediationPlan.failureState,
        stepCodes: state.health.remediationPlan.steps.map((step) => step.code)
      }
    },
    evidenceCount: evidence.length
  };
}

function buildAuditTrail(state, contract, now, evidence) {
  return [
    {
      at: now,
      type: "cli_boot_request_normalized",
      requestId: state.requestId,
      route: state.route,
      tenantId: state.scope.tenantId,
      workspaceKey: state.scope.workspaceKey,
      argvCount: state.argv.length
    },
    {
      at: now,
      type: "cli_boot_workspace_scope_resolved",
      requestId: state.requestId,
      tenantId: state.scope.tenantId,
      workspaceId: state.scope.workspaceId,
      tenantAllowed: state.scope.tenantAllowed,
      workspaceAllowed: state.scope.workspaceAllowed
    },
    {
      at: now,
      type: "cli_boot_permission_boundary_evaluated",
      requestId: state.requestId,
      command: state.command,
      enforcement: state.boundary.enforcement,
      requiredCapabilities: state.boundary.requiredCapabilities,
      missingCapabilities: state.boundary.missingCapabilities,
      violations: state.boundary.violations
    },
    {
      at: now,
      type: "cli_boot_handoff_selected",
      requestId: state.requestId,
      handoff: contract.handoff.target,
      nextAction: contract.handoff.nextAction,
      auditHandoffRequired: contract.handoff.auditHandoffRequired
    },
    {
      at: now,
      type: "cli_boot_handoff_manifest_shaped",
      requestId: state.requestId,
      handoff: contract.handoff.target,
      targetProvider: contract.handoff.manifest.targetProvider,
      status: contract.handoff.manifest.status,
      requiredAckProvider: contract.handoff.manifest.requiredAckProvider,
      proofDigest: contract.handoff.manifest.proofDigest,
      validationErrors: contract.handoff.manifest.validationErrors
    },
    {
      at: now,
      type: "cli_boot_artifact_root_initialized",
      requestId: state.requestId,
      bootId: contract.state.bootId,
      status: contract.artifacts.status,
      root: contract.artifacts.root,
      proofPath: contract.artifacts.proofPath,
      manifestPath: contract.artifacts.manifestPath,
      ledgerPath: contract.artifacts.ledgerPath,
      retentionKey: contract.artifacts.retentionKey,
      initializationPlanStatus: contract.artifacts.initializationPlan.status,
      initializationDirectoryCount: contract.artifacts.initializationPlan.directoryPlan.length,
      initializationFileCount: contract.artifacts.initializationPlan.filePlan.length,
      validationCodes: contract.artifacts.validationFindings.map((finding) => finding.code)
    },
    {
      at: now,
      type: "cli_boot_prior_scope_proof_evaluated",
      requestId: state.requestId,
      bootId: contract.state.bootId,
      status: contract.scopeProof.status,
      required: contract.scopeProof.required,
      supplied: contract.scopeProof.supplied,
      tenantId: contract.scopeProof.tenantId,
      workspaceKey: contract.scopeProof.workspaceKey,
      priorBootId: contract.scopeProof.bootId,
      proofDigest: contract.scopeProof.proofDigest,
      manifestDigest: contract.scopeProof.manifestDigest,
      scopeBindingFingerprint: contract.scopeProof.scopeBindingFingerprint,
      validationCodes: contract.scopeProof.validationFindings.map((finding) => finding.code)
    },
    {
      at: now,
      type: "cli_boot_workflow_handoff_directive_shaped",
      requestId: state.requestId,
      handoff: contract.handoff.target,
      status: contract.handoff.workflow.status,
      deliveryMode: contract.handoff.workflow.delivery.mode,
      clientChannel: contract.handoff.workflow.delivery.channel,
      ackTransport: contract.handoff.workflow.delivery.ackTransport,
      runtimeDispatchCapability: contract.handoff.workflow.runtime.dispatchCapability,
      acknowledgementPolicy: contract.handoff.workflow.acknowledgement.policy,
      acknowledgementDeadlineMs: contract.handoff.workflow.acknowledgement.deadlineMs,
      runtimeMaxAckLatencyMs: contract.handoff.workflow.acknowledgement.runtimeMaxLatencyMs,
      acknowledgementReceiptStatus: contract.handoff.workflow.acknowledgement.receiptStatus,
      acknowledgementReceiptSatisfied: contract.handoff.workflow.acknowledgement.receiptSatisfied,
      continuationToken: contract.handoff.workflow.delivery.continuationToken,
      manualContinuationRequired: contract.handoff.workflow.userVisible.manualContinuationRequired,
      acknowledgementPending: contract.handoff.workflow.userVisible.acknowledgementPending,
      validationCodes: contract.handoff.workflow.validationFindings.map((finding) => finding.code)
    },
    {
      at: now,
      type: "cli_boot_client_workflow_command_packet_shaped",
      requestId: state.requestId,
      handoff: contract.handoff.target,
      status: contract.handoff.workflowCommandPacket.status,
      packetId: contract.handoff.workflowCommandPacket.packetId,
      nextClientAction: contract.handoff.workflowCommandPacket.nextClientAction,
      deliveryMode: contract.handoff.workflowCommandPacket.deliveryMode,
      targetProvider: contract.handoff.workflowCommandPacket.targetProvider,
      acknowledgementRequired: contract.handoff.workflowCommandPacket.acknowledgementCommand.required,
      acknowledgementSatisfied: contract.handoff.workflowCommandPacket.acknowledgementCommand.satisfied,
      queuedRequired: contract.handoff.workflowCommandPacket.queuedCommand.required,
      dispatchEnabled: contract.handoff.workflowCommandPacket.dispatchCommand.enabled,
      pendingPhaseNames: contract.handoff.workflowCommandPacket.pendingPhaseNames,
      continuationToken: contract.handoff.workflowCommandPacket.continuationToken,
      proofDigest: contract.handoff.workflowCommandPacket.handoffPayload.proofDigest,
      packetFingerprint: contract.handoff.workflowCommandPacket.packetFingerprint
    },
    {
      at: now,
      type: "cli_boot_hosted_command_orchestration_shaped",
      requestId: state.requestId,
      command: state.command,
      status: contract.hostedBootCommand.status,
      orchestrationId: contract.hostedBootCommand.orchestrationId,
      canDispatch: contract.hostedBootCommand.canDispatch,
      nextAction: contract.hostedBootCommand.nextAction,
      dispatchProvider: contract.hostedBootCommand.dispatchTarget.provider,
      artifactInitializationStatus: contract.hostedBootCommand.artifactRootInitialization.status,
      bootProofHandoffStatus: contract.hostedBootCommand.bootProofHandoff.status,
      commandRestartStatus: contract.hostedBootCommand.restartCommandState.status,
      commandRestartSafeStatus: contract.hostedBootCommand.restartCommandState.restartSafeStatus,
      commandRestartNextAction: contract.hostedBootCommand.restartCommandState.nextRestartAction,
      acknowledgementPending: contract.hostedBootCommand.acknowledgementPending,
      preflightBlocks: contract.hostedBootCommand.preflightBlocks,
      queueReasons: contract.hostedBootCommand.queueReasons,
      phaseStatuses: contract.hostedBootCommand.phases.map((phase) => `${phase.name}:${phase.status}`)
    },
    {
      at: now,
      type: "cli_boot_preview_acceptance_readiness_shaped",
      requestId: state.requestId,
      command: state.command,
      status: contract.hostedBootCommand.previewAcceptanceReadiness.status,
      previewToken: contract.hostedBootCommand.previewAcceptanceReadiness.preview.token,
      acceptanceRequired: contract.hostedBootCommand.previewAcceptanceReadiness.acceptance.required,
      acceptanceSatisfied: contract.hostedBootCommand.previewAcceptanceReadiness.acceptance.satisfied,
      readinessStatus: contract.hostedBootCommand.previewAcceptanceReadiness.readiness.status,
      readinessNextAction: contract.hostedBootCommand.previewAcceptanceReadiness.readiness.nextAction,
      readinessReasons: contract.hostedBootCommand.previewAcceptanceReadiness.readiness.nextStepReasons,
      validationFailedCount: contract.hostedBootCommand.previewAcceptanceReadiness.validationSummary.counts.failed,
      validationDegradedCount: contract.hostedBootCommand.previewAcceptanceReadiness.validationSummary.counts.degraded,
      blockingPhaseNames: contract.hostedBootCommand.previewAcceptanceReadiness.readiness.blockingPhaseNames
    },
    {
      at: now,
      type: "cli_boot_client_handoff_receipt_reconciled",
      requestId: state.requestId,
      handoff: contract.handoff.target,
      status: contract.request.handoffReceipt.status,
      required: contract.request.handoffReceipt.required,
      satisfied: contract.request.handoffReceipt.satisfied,
      ackTransport: contract.request.handoffReceipt.received.transport,
      receiptStatus: contract.request.handoffReceipt.received.status,
      receivedAt: contract.request.handoffReceipt.received.receivedAt,
      latencyMs: contract.request.handoffReceipt.received.latencyMs,
      receiptFingerprint: contract.request.handoffReceipt.receiptFingerprint,
      validationCodes: contract.request.handoffReceipt.validationFindings.map((finding) => finding.code)
    },
    {
      at: now,
      type: "cli_boot_lifecycle_controls_evaluated",
      requestId: state.requestId,
      command: state.command,
      lifecycleStatus: contract.lifecycle.status,
      lifecycleMode: contract.lifecycle.mode,
      commandAllowed: contract.lifecycle.commandAllowed,
      scheduleMode: contract.lifecycle.schedule.mode,
      nextRunAt: contract.lifecycle.schedule.nextRunAt,
      controlFingerprint: contract.lifecycle.controlFingerprint,
      validationCodes: contract.lifecycle.validationFindings.map((finding) => finding.code)
    },
    {
      at: now,
      type: "cli_boot_provider_contract_negotiated",
      requestId: state.requestId,
      command: state.command,
      providerStatus: contract.providers.status,
      requiredProviders: contract.providers.requiredProviders,
      unavailableProviders: contract.providers.unavailableProviders,
      degradedProviders: contract.providers.degradedProviders,
      syncWatermark: contract.providers.syncWatermark,
      serviceSyncStatus: contract.providers.serviceSync.status,
      serviceSyncFingerprint: contract.providers.serviceSync.syncFingerprint,
      providerSyncActions: contract.providers.serviceSync.claims.map((claim) => `${claim.provider}:${claim.action}`)
    },
    {
      at: now,
      type: "cli_boot_provider_service_sync_negotiated",
      requestId: state.requestId,
      command: state.command,
      status: contract.providers.serviceSync.status,
      syncFingerprint: contract.providers.serviceSync.syncFingerprint,
      claimableProviders: contract.providers.serviceSync.claimableProviders,
      backpressureProviders: contract.providers.serviceSync.backpressureProviders,
      missingAckProviders: contract.providers.serviceSync.missingAckProviders,
      pendingOperations: contract.providers.serviceSync.pendingOperations,
      claimTokens: contract.providers.serviceSync.claims
        .filter((claim) => claim.claimToken)
        .map((claim) => claim.claimToken)
    },
    {
      at: now,
      type: "cli_boot_provider_handoff_claim_reconciled",
      requestId: state.requestId,
      command: state.command,
      status: contract.providers.handoffClaim.status,
      targetProvider: contract.providers.handoffClaim.targetProvider,
      targetReady: contract.providers.handoffClaim.targetReady,
      nextAction: contract.providers.handoffClaim.nextAction,
      requiredProviderNames: contract.providers.handoffClaim.requiredProviderNames,
      claimedProviderNames: contract.providers.handoffClaim.claimedProviderNames,
      waitingProviders: contract.providers.handoffClaim.waitingProviders,
      missingLeaseProviders: contract.providers.handoffClaim.missingLeaseProviders,
      claimFingerprint: contract.providers.handoffClaim.claimFingerprint
    },
    {
      at: now,
      type: "cli_boot_state_transition_shaped",
      requestId: state.requestId,
      bootId: state.stateTransition.bootId,
      command: state.command,
      idempotent: state.stateTransition.idempotent,
      idempotencyReason: state.stateTransition.idempotencyReason,
      commandResultReplayable: state.stateTransition.resultReplayable,
      commandResultConflict: state.stateTransition.resultConflict,
      persistedCommandResultId: state.stateTransition.persistedResult?.id || "",
      previousStatus: state.stateTransition.previousStatus,
      nextStatus: state.stateTransition.nextStatus,
      sequence: state.stateTransition.sequence,
      persistenceKey: state.stateTransition.persistenceKey,
      pendingWriteCount: state.persistenceEnvelope.writePlan.pendingWriteCount,
      writePlanMode: state.persistenceEnvelope.writePlan.mode
    },
    {
      at: now,
      type: "cli_boot_command_restart_semantics_reconciled",
      requestId: state.requestId,
      bootId: state.persisted.bootId,
      command: state.command,
      status: state.commandRestartSemantics.status,
      restartSafeStatus: state.commandRestartSemantics.restartSafeStatus,
      nextRestartAction: state.commandRestartSemantics.nextRestartAction,
      replaySettled: state.commandRestartSemantics.replaySettled,
      handoffRequired: state.commandRestartSemantics.handoffRequired,
      safeToHandoff: state.commandRestartSemantics.safeToHandoff,
      expectedWriteIds: state.commandRestartSemantics.expectedWriteIds,
      pendingWriteIds: state.commandRestartSemantics.pendingWriteIds,
      acceptedWriteIds: state.commandRestartSemantics.acceptedWriteIds,
      missingWriteIds: state.commandRestartSemantics.missingWriteIds,
      rejectedWriteIds: state.commandRestartSemantics.rejectedWriteIds
    },
    {
      at: now,
      type: "cli_boot_persistence_envelope_shaped",
      requestId: state.requestId,
      bootId: state.persisted.bootId,
      idempotencyKey: state.persistenceEnvelope.idempotencyKey,
      status: state.persistenceEnvelope.status,
      nextSequence: state.persistenceEnvelope.nextSequence,
      writePlanMode: state.persistenceEnvelope.writePlan.mode,
      commandResultReplayAvailable: state.persistenceEnvelope.commandResultReplay.available,
      commandResultReplayReason: state.persistenceEnvelope.commandResultReplay.reason,
      commandResultReplayDigest: state.persistenceEnvelope.commandResultReplay.digest,
      newWriteIds: state.persistenceEnvelope.writePlan.newWriteIds,
      recoveryCursorValid: state.persistenceEnvelope.nextRecoveryCursor.valid,
      conflictDetected: state.persistenceEnvelope.conflict.detected
    },
    {
      at: now,
      type: "cli_boot_restart_recovery_ledger_reconciled",
      requestId: state.requestId,
      bootId: state.persisted.bootId,
      status: state.restartRecoveryLedger.status,
      restartSafeStatus: state.restartRecoveryLedger.restartSafeStatus,
      nextRecoveryAction: state.restartRecoveryLedger.nextRecoveryAction,
      replayWriteIds: state.restartRecoveryLedger.replayWriteIds,
      waitingWriteIds: state.restartRecoveryLedger.waitingWriteIds,
      rejectedWriteIds: state.restartRecoveryLedger.rejectedWriteIds,
      pendingWriteCount: state.restartRecoveryLedger.counts.pending
    },
    {
      at: now,
      type: "cli_boot_recovery_semantics_resolved",
      requestId: state.requestId,
      recoveryMode: state.recovery.mode,
      restartSafeStatus: state.recovery.restartSafeStatus,
      reason: state.recovery.reason,
      resumeFromCheckpoint: state.recovery.resumeFromCheckpoint
    },
    {
      at: now,
      type: "cli_boot_evidence_attached",
      requestId: state.requestId,
      evidenceCount: evidence.length
    },
    {
      at: now,
      type: "cli_boot_operational_health_evaluated",
      requestId: state.requestId,
      healthStatus: state.health.status,
      severity: state.health.severity,
      retryable: state.health.retryPolicy.retryable,
      degradedMode: state.health.degradedMode.enabled,
      failureBlocked: state.health.failureState.blocked,
      remediationStatus: state.health.remediationPlan.status,
      remediationPrimaryAction: state.health.remediationPlan.primaryAction,
      remediationBlocksDispatch: state.health.remediationPlan.blocksDispatch,
      remediationStepCodes: state.health.remediationPlan.steps.map((step) => step.code),
      degradedFallbackCommand: state.health.remediationPlan.degradedFallback.command,
      actionableErrorCodes: state.health.actionableErrors.map((error) => error.code)
    }
  ];
}

function normalizeAnalyticsHistory(input, now) {
  const source = Array.isArray(input.analyticsHistory)
    ? input.analyticsHistory
    : Array.isArray(input.persistedState?.analyticsHistory)
      ? input.persistedState.analyticsHistory
      : [];

  return source
    .map((item, index) => {
      const snapshot = item && typeof item === "object" ? item : {};
      const command = readString(snapshot.command, "");
      const status = readString(snapshot.status || snapshot.runtimeStatus, "unknown");
      const sequence = Math.max(0, Math.floor(readNumber(snapshot.sequence, index)));

      return {
        at: readString(snapshot.at || snapshot.generatedAt || snapshot.observedAt, now),
        requestId: readString(snapshot.requestId, `history:${index}`),
        bootId: readString(snapshot.bootId, ""),
        command: KNOWN_COMMANDS.has(command) ? command : "status",
        status,
        sequence,
        providerStatus: readString(snapshot.providerStatus, "unknown"),
        healthStatus: readString(snapshot.healthStatus, "unknown"),
        persistenceStatus: readString(snapshot.persistenceStatus, "unknown"),
        handoffStatus: readString(snapshot.handoffStatus || snapshot.handoffManifestStatus, "unknown"),
        lifecycleStatus: readString(snapshot.lifecycleStatus, "unknown"),
        admissionStatus: readString(snapshot.admissionStatus || snapshot.objectiveTruthStatus, "unknown"),
        reportState: readString(snapshot.reportState || snapshot.analyticsReportState, "unknown"),
        nextAction: readString(snapshot.nextAction || snapshot.operatorDisposition, ""),
        exportReady: readBoolean(snapshot.exportReady, false),
        ackPending: readBoolean(snapshot.ackPending || snapshot.acknowledgementPending, false),
        queueReasonCount: Math.max(0, Math.floor(readNumber(snapshot.queueReasonCount, 0))),
        blockerCount: Math.max(0, Math.floor(readNumber(snapshot.blockerCount || snapshot.blockingSignalCount, 0))),
        proofReady: readBoolean(snapshot.proofReady || snapshot.bootProofReady, false),
        proofDigest: readString(snapshot.proofDigest || snapshot.handoffProofDigest, ""),
        analyticsExportId: readString(snapshot.analyticsExportId || snapshot.exportId, ""),
        pendingWriteCount: Math.max(0, Math.floor(readNumber(snapshot.pendingWriteCount, 0))),
        degraded: Boolean(snapshot.degraded),
        blocked: Boolean(snapshot.blocked)
      };
    })
    .sort((left, right) => left.sequence - right.sequence || left.at.localeCompare(right.at));
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = readString(selector(item), "unknown");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function countTransitions(snapshots, selector) {
  return snapshots.reduce((counts, snapshot, index) => {
    if (index === 0) return counts;
    const previous = readString(selector(snapshots[index - 1]), "unknown");
    const current = readString(selector(snapshot), "unknown");
    const key = `${previous}->${current}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildAnalyticsReportingState(contract, currentSnapshot, snapshots, auditTrail, evidence) {
  const exportBlockingReasons = [
    contract.artifacts.status === "blocked" ? "artifact-root-blocked" : "",
    contract.scopeProof.status === "blocked" ? "scope-proof-blocked" : "",
    contract.handoff.manifest.status === "blocked" ? "handoff-manifest-blocked" : "",
    contract.hostedBootCommand.status === "blocked" ? "hosted-command-orchestration-blocked" : "",
    contract.request.handoffReceipt.required && !contract.request.handoffReceipt.satisfied
      ? "handoff-receipt-pending"
      : ""
  ].filter(Boolean);
  const phaseRows = contract.hostedBootCommand.phases.map((phase, index) => ({
    order: index + 1,
    name: phase.name,
    status: phase.status,
    required: phase.required,
    reportBucket: phase.status === "blocked"
      ? "blocked"
      : phase.status === "pending"
        ? "waiting"
        : "ready"
  }));
  const readyPhaseCount = phaseRows.filter((phase) => phase.reportBucket === "ready").length;
  const blockedPhaseCount = phaseRows.filter((phase) => phase.reportBucket === "blocked").length;
  const waitingPhaseCount = phaseRows.filter((phase) => phase.reportBucket === "waiting").length;
  const evidenceReady = evidence.length > 0 || auditTrail.length > 0;
  const exportReady = exportBlockingReasons.length === 0
    && currentSnapshot.reportState === "export-ready"
    && evidenceReady;

  return {
    version: "cli-boot.analytics-reporting.v1",
    status: exportReady
      ? "export-ready"
      : exportBlockingReasons.length
        ? "export-blocked"
        : "evidence-pending",
    exportReady,
    evidenceReady,
    exportBlockingReasons,
    currentReportState: currentSnapshot.reportState,
    currentAdmissionStatus: currentSnapshot.admissionStatus,
    currentNextAction: currentSnapshot.nextAction,
    proofReady: currentSnapshot.proofReady,
    proofDigest: currentSnapshot.proofDigest,
    handoffReceiptPending: currentSnapshot.ackPending,
    pendingWriteCount: currentSnapshot.pendingWriteCount,
    phaseCounts: {
      total: phaseRows.length,
      ready: readyPhaseCount,
      waiting: waitingPhaseCount,
      blocked: blockedPhaseCount
    },
    phaseRows,
    retainedHistoryCount: snapshots.length,
    latestHistoryExportIds: snapshots
      .map((snapshot) => snapshot.analyticsExportId)
      .filter(Boolean)
      .slice(-5)
  };
}

function buildAnalyticsSnapshot(state, contract, auditTrail, evidence, history, now) {
  const currentSnapshot = {
    at: now,
    requestId: state.requestId,
    bootId: contract.state.bootId,
    command: contract.state.command,
    status: contract.status,
    sequence: contract.state.sequence,
    providerStatus: contract.providers.status,
    healthStatus: contract.health.status,
    persistenceStatus: contract.persistence.status,
    handoffStatus: contract.handoff.manifest.status,
    lifecycleStatus: contract.lifecycle.status,
    admissionStatus: contract.hostedBootCommand.status === "dispatchable"
      ? "admitted"
      : contract.hostedBootCommand.status === "awaiting-ack"
        ? "awaiting-ack"
        : contract.hostedBootCommand.status === "queued"
          ? "queued"
          : contract.hostedBootCommand.status === "blocked"
            ? "blocked"
            : "unknown",
    reportState: contract.hostedBootCommand.status === "blocked" || contract.status === "blocked"
      ? "operator-action-required"
      : contract.hostedBootCommand.status === "queued"
        ? "queued"
        : contract.hostedBootCommand.acknowledgementPending
          ? "awaiting-ack"
          : "export-ready",
    nextAction: contract.handoff.nextAction,
    exportReady: contract.status !== "blocked"
      && contract.hostedBootCommand.status === "dispatchable"
      && !contract.hostedBootCommand.acknowledgementPending,
    ackPending: contract.hostedBootCommand.acknowledgementPending,
    queueReasonCount: contract.hostedBootCommand.queueReasons.length,
    blockerCount: contract.hostedBootCommand.preflightBlocks.length,
    proofReady: contract.handoff.manifest.status !== "blocked" && contract.artifacts.status === "initialized",
    proofDigest: contract.handoff.manifest.proofDigest,
    analyticsExportId: "",
    pendingWriteCount: contract.persistence.writePlan.pendingWriteCount,
    degraded: contract.health.degradedMode.enabled
      || contract.providers.status === "degraded"
      || contract.lifecycle.status === "scheduled",
    blocked: contract.status === "blocked"
      || contract.handoff.manifest.status === "blocked"
      || contract.lifecycle.status === "blocked"
  };
  const snapshots = [...history, currentSnapshot].slice(-25);
  const blockedSnapshots = snapshots.filter((snapshot) => snapshot.blocked);
  const degradedSnapshots = snapshots.filter((snapshot) => snapshot.degraded);
  const writePlanMode = contract.persistence.writePlan.mode;
  const pendingSyncOperations = contract.externalHandoffState.pendingSyncOperations;
  const providerSyncClaims = contract.externalHandoffState.providerSyncClaims;
  const providerHandoffClaim = contract.providers.handoffClaim;
  const recoveryCounts = contract.restartRecovery.counts;
  const auditEventTypes = auditTrail.map((event) => event.type);
  const evidenceTypes = evidence.map((item, index) => {
    const source = item && typeof item === "object" ? item : {};
    return readString(source.type || source.kind, `evidence:${index}`);
  });
  const exportId = `cli-boot-export:${stableStateFingerprint([
    state.scope.workspaceKey,
    state.persisted.bootId,
    contract.state.sequence,
    contract.providers.syncWatermark,
    contract.lifecycle.controlFingerprint,
    contract.persistence.idempotencyKey
  ])}`;
  currentSnapshot.analyticsExportId = exportId;
  const reporting = buildAnalyticsReportingState(contract, currentSnapshot, snapshots, auditTrail, evidence);

  return {
    version: "cli-boot.analytics.v1",
    generatedAt: now,
    retentionLimit: 25,
    counters: {
      totalSnapshots: snapshots.length,
      historicalSnapshots: history.length,
      commandRuns: countBy(snapshots, (snapshot) => snapshot.command),
      runtimeStatuses: countBy(snapshots, (snapshot) => snapshot.status),
      providerStatuses: countBy(snapshots, (snapshot) => snapshot.providerStatus),
      healthStatuses: countBy(snapshots, (snapshot) => snapshot.healthStatus),
      persistenceStatuses: countBy(snapshots, (snapshot) => snapshot.persistenceStatus),
      handoffStatuses: countBy(snapshots, (snapshot) => snapshot.handoffStatus),
      lifecycleStatuses: countBy(snapshots, (snapshot) => snapshot.lifecycleStatus),
      auditEvents: auditTrail.length,
      evidenceItems: evidence.length,
      pendingWrites: contract.persistence.writePlan.pendingWriteCount,
      recoveryReplayWrites: recoveryCounts.replay,
      recoveryWaitingWrites: recoveryCounts.waiting,
      recoveryRejectedWrites: recoveryCounts.rejected,
      pendingSyncOperations,
      providerSyncClaimTokens: providerSyncClaims.filter((claim) => claim.claimToken).length,
      providerSyncBackpressureProviders: contract.providers.serviceSync.backpressureProviders.length,
      providerSyncMissingAckProviders: contract.providers.serviceSync.missingAckProviders.length,
      providerHandoffClaimReady: providerHandoffClaim.status === "ready" ? 1 : 0,
      providerHandoffClaimWaitingProviders: providerHandoffClaim.waitingProviders.length,
      providerHandoffClaimMissingLeases: providerHandoffClaim.missingLeaseProviders.length,
      blockedSnapshots: blockedSnapshots.length,
      degradedSnapshots: degradedSnapshots.length,
      actionableErrors: contract.health.actionableErrors.length,
      remediationSteps: contract.health.remediationPlan.steps.length,
      remediationBlocksDispatch: contract.health.remediationPlan.blocksDispatch ? 1 : 0,
      degradedFallbackAvailable: contract.health.remediationPlan.degradedFallback.available ? 1 : 0,
      boundaryViolations: contract.permissions.violations.length,
      scopeProofBlocked: contract.scopeProof.status === "blocked" ? 1 : 0,
      scopeProofValidationFindings: contract.scopeProof.validationFindings.length,
      unavailableProviders: contract.providers.unavailableProviders.length,
      degradedProviders: contract.providers.degradedProviders.length,
      admittedSnapshots: snapshots.filter((snapshot) => snapshot.admissionStatus === "admitted").length,
      queuedSnapshots: snapshots.filter((snapshot) => snapshot.admissionStatus === "queued").length,
      awaitingAckSnapshots: snapshots.filter((snapshot) => snapshot.admissionStatus === "awaiting-ack").length,
      exportReadySnapshots: snapshots.filter((snapshot) => snapshot.exportReady).length,
      ackPendingSnapshots: snapshots.filter((snapshot) => snapshot.ackPending).length,
      proofReadySnapshots: snapshots.filter((snapshot) => snapshot.proofReady).length,
      blockedPhaseCount: reporting.phaseCounts.blocked,
      waitingPhaseCount: reporting.phaseCounts.waiting,
      readyPhaseCount: reporting.phaseCounts.ready
    },
    latest: currentSnapshot,
    history: {
      snapshots,
      firstObservedAt: snapshots[0]?.at || now,
      lastObservedAt: snapshots[snapshots.length - 1]?.at || now,
      lastBlockedAt: blockedSnapshots[blockedSnapshots.length - 1]?.at || "",
      lastDegradedAt: degradedSnapshots[degradedSnapshots.length - 1]?.at || "",
      sequenceWindow: {
        min: snapshots[0]?.sequence || 0,
        max: snapshots[snapshots.length - 1]?.sequence || 0
      },
      transitions: {
        runtimeStatuses: countTransitions(snapshots, (snapshot) => snapshot.status),
        admissionStatuses: countTransitions(snapshots, (snapshot) => snapshot.admissionStatus),
        reportStates: countTransitions(snapshots, (snapshot) => snapshot.reportState),
        handoffStatuses: countTransitions(snapshots, (snapshot) => snapshot.handoffStatus)
      },
      pendingWriteHighWatermark: snapshots.reduce((max, snapshot) => Math.max(max, snapshot.pendingWriteCount), 0),
      queueReasonHighWatermark: snapshots.reduce((max, snapshot) => Math.max(max, snapshot.queueReasonCount), 0),
      blockerHighWatermark: snapshots.reduce((max, snapshot) => Math.max(max, snapshot.blockerCount), 0)
    },
    reporting,
    exportSummary: {
      schema: "cli_boot_analytics_export_v1",
      exportId,
      exportReady: reporting.exportReady,
      exportStatus: reporting.status,
      exportBlockingReasons: reporting.exportBlockingReasons,
      workspaceKey: state.scope.workspaceKey,
      bootId: contract.state.bootId,
      command: contract.state.command,
      route: state.route,
      status: contract.status,
      reportState: currentSnapshot.reportState,
      admissionStatus: currentSnapshot.admissionStatus,
      nextAction: currentSnapshot.nextAction,
      writePlanMode,
      providerSyncWatermark: contract.providers.syncWatermark,
      providerServiceSyncStatus: contract.providers.serviceSync.status,
      providerServiceSyncFingerprint: contract.providers.serviceSync.syncFingerprint,
      providerHandoffClaimStatus: providerHandoffClaim.status,
      providerHandoffClaimFingerprint: providerHandoffClaim.claimFingerprint,
      providerHandoffClaimNextAction: providerHandoffClaim.nextAction,
      providerHandoffClaimWaitingProviders: providerHandoffClaim.waitingProviders,
      providerHandoffClaimMissingLeaseProviders: providerHandoffClaim.missingLeaseProviders,
      providerSyncClaimProviders: providerSyncClaims
        .filter((claim) => claim.claimToken)
        .map((claim) => claim.provider),
      providerSyncBackpressureProviders: contract.providers.serviceSync.backpressureProviders,
      handoffProofDigest: contract.handoff.manifest.proofDigest,
      lifecycleStatus: contract.lifecycle.status,
      lifecycleMode: contract.lifecycle.mode,
      lifecycleControlFingerprint: contract.lifecycle.controlFingerprint,
      lifecycleNextRunAt: contract.lifecycle.schedule.nextRunAt,
      restartRecoveryStatus: contract.restartRecovery.status,
      restartRecoveryAction: contract.restartRecovery.nextRecoveryAction,
      restartRecoveryReplayWriteIds: contract.restartRecovery.replayWriteIds,
      restartRecoveryRejectedWriteIds: contract.restartRecovery.rejectedWriteIds,
      auditEventTypes,
      evidenceTypes,
      columns: [
        "at",
        "requestId",
        "bootId",
        "command",
        "status",
        "providerStatus",
        "healthStatus",
        "persistenceStatus",
        "handoffStatus",
        "lifecycleStatus",
        "admissionStatus",
        "reportState",
        "nextAction",
        "ackPending",
        "queueReasonCount",
        "blockerCount",
        "proofReady",
        "pendingWriteCount",
        "blocked",
        "degraded"
      ],
      rows: snapshots.map((snapshot) => ({
        at: snapshot.at,
        requestId: snapshot.requestId,
        bootId: snapshot.bootId,
        command: snapshot.command,
        status: snapshot.status,
        providerStatus: snapshot.providerStatus,
        healthStatus: snapshot.healthStatus,
        persistenceStatus: snapshot.persistenceStatus,
        handoffStatus: snapshot.handoffStatus,
        lifecycleStatus: snapshot.lifecycleStatus,
        admissionStatus: snapshot.admissionStatus,
        reportState: snapshot.reportState,
        nextAction: snapshot.nextAction,
        ackPending: snapshot.ackPending,
        queueReasonCount: snapshot.queueReasonCount,
        blockerCount: snapshot.blockerCount,
        proofReady: snapshot.proofReady,
        pendingWriteCount: snapshot.pendingWriteCount,
        blocked: snapshot.blocked,
        degraded: snapshot.degraded
      }))
    },
    timeline: {
      status: currentSnapshot.blocked ? "blocked" : currentSnapshot.degraded ? "needs-attention" : "nominal",
      nextAction: contract.handoff.nextAction,
      reportState: currentSnapshot.reportState,
      exportReady: reporting.exportReady,
      exportBlockingReasons: reporting.exportBlockingReasons,
      phaseRows: reporting.phaseRows,
      events: auditTrail.map((event, index) => ({
        at: event.at,
        order: index + 1,
        type: event.type,
        requestId: event.requestId,
        summary: readString(
          event.nextAction
            || event.status
            || event.lifecycleStatus
            || event.healthStatus
            || event.providerStatus
            || event.recoveryMode,
          "recorded"
        )
      }))
    }
  };
}

function buildBootProofHandoff(state, contract, auditTrail, analytics, now) {
  const artifactFiles = contract.artifacts.artifactFiles.map((artifact) => ({
    kind: artifact.kind,
    path: artifact.path,
    contentType: artifact.contentType,
    required: artifact.required,
    status: artifact.status,
    writeId: artifact.writeId,
    order: artifact.order,
    handoffField: artifact.handoffField
  }));
  const requiredArtifactsReady = artifactFiles
    .filter((artifact) => artifact.required)
    .every((artifact) => artifact.status === "ready");
  const acknowledgementReady = !contract.request.handoffReceipt.required
    || contract.request.handoffReceipt.satisfied
    || contract.handoff.workflow.status === "queued";
  const blockedReasons = [
    contract.status === "blocked" ? "runtime-contract-blocked" : "",
    contract.hostedBootCommand.status === "blocked" ? "hosted-command-orchestration-blocked" : "",
    contract.artifacts.status === "blocked" ? "artifact-root-blocked" : "",
    contract.scopeProof.status === "blocked" ? "scope-proof-blocked" : "",
    contract.handoff.manifest.status === "blocked" ? "handoff-manifest-blocked" : "",
    contract.providers.handoffClaim.status === "blocked" ? "provider-handoff-claim-blocked" : "",
    requiredArtifactsReady ? "" : "required-artifact-not-ready",
    acknowledgementReady ? "" : "handoff-acknowledgement-pending"
  ].filter(Boolean);
  const proofInputs = [
    state.requestId,
    contract.state.bootId,
    contract.state.command,
    contract.state.persistenceKey,
    contract.handoff.manifest.proofDigest,
    contract.artifacts.retentionKey,
    contract.providers.serviceSync.syncFingerprint,
    contract.providers.handoffClaim.claimFingerprint,
    contract.lifecycle.controlFingerprint,
    contract.hostedBootCommand.orchestrationId,
    contract.scopeProof.scopeBindingFingerprint,
    contract.request.handoffReceipt.receiptFingerprint,
    analytics.exportSummary.exportId
  ];
  const handoffProofId = `boot-proof-handoff:${stableStateFingerprint(proofInputs)}`;
  const verifierArtifactWrites = contract.artifacts.initializationPlan.filePlan.map((file) => ({
    kind: file.kind,
    path: file.path,
    writeId: file.writeId,
    writeMode: file.writeMode,
    contentType: file.contentType,
    verifierRole: file.verifierRole,
    required: file.required,
    status: file.status
  }));

  return {
    version: "cli-boot.boot-proof-handoff.v1",
    status: blockedReasons.length
      ? "blocked"
      : contract.handoff.workflow.status === "queued" || contract.hostedBootCommand.status === "queued"
        ? "queued"
        : "ready",
    handoffProofId,
    requestId: state.requestId,
    bootId: contract.state.bootId,
    command: contract.state.command,
    route: state.route,
    workspaceKey: contract.scope.workspaceKey,
    artifactRoot: contract.artifacts.root,
    artifactBasePath: contract.artifacts.basePath,
    artifactRootSource: contract.artifacts.rootSource,
    requiredArtifactsReady,
    artifacts: artifactFiles,
    artifactInitialization: {
      version: contract.artifacts.initializationPlan.version,
      status: contract.artifacts.initializationPlan.status,
      directoryPlan: contract.artifacts.initializationPlan.directoryPlan,
      filePlan: contract.artifacts.initializationPlan.filePlan,
      counts: contract.artifacts.initializationPlan.counts
    },
    manifest: {
      status: contract.handoff.manifest.status,
      target: contract.handoff.target,
      targetProvider: contract.handoff.manifest.targetProvider,
      providerHandoffUri: contract.handoff.manifest.providerHandoffUri,
      proofDigest: contract.handoff.manifest.proofDigest,
      validationErrors: contract.handoff.manifest.validationErrors,
      providerHandoffClaim: {
        status: contract.providers.handoffClaim.status,
        targetProvider: contract.providers.handoffClaim.targetProvider,
        nextAction: contract.providers.handoffClaim.nextAction,
        claimFingerprint: contract.providers.handoffClaim.claimFingerprint
      }
    },
    workflow: {
      status: contract.handoff.workflow.status,
      nextAction: contract.handoff.nextAction,
      deliveryMode: contract.handoff.workflow.delivery.mode,
      continuationToken: contract.handoff.workflow.delivery.continuationToken,
      acknowledgementPolicy: contract.handoff.workflow.acknowledgement.policy,
      acknowledgementRequired: contract.handoff.workflow.acknowledgement.required,
      acknowledgementSatisfied: contract.handoff.workflow.acknowledgement.receiptSatisfied,
      acknowledgementReceiptFingerprint: contract.handoff.workflow.acknowledgement.receiptFingerprint,
      commandPacket: contract.handoff.workflowCommandPacket
    },
    orchestration: {
      status: contract.hostedBootCommand.status,
      orchestrationId: contract.hostedBootCommand.orchestrationId,
      canDispatch: contract.hostedBootCommand.canDispatch,
      nextAction: contract.hostedBootCommand.nextAction,
      preflightBlocks: contract.hostedBootCommand.preflightBlocks,
      queueReasons: contract.hostedBootCommand.queueReasons,
      acknowledgementPending: contract.hostedBootCommand.acknowledgementPending,
      artifactRootInitialization: contract.hostedBootCommand.artifactRootInitialization,
      scopeProof: contract.hostedBootCommand.scopeProof,
      bootProofHandoff: contract.hostedBootCommand.bootProofHandoff,
      restartCommandState: contract.hostedBootCommand.restartCommandState
    },
    verifier: {
      proofPath: contract.artifacts.proofPath,
      manifestPath: contract.artifacts.manifestPath,
      ledgerPath: contract.artifacts.ledgerPath,
      analyticsExportId: analytics.exportSummary.exportId,
      auditEventCount: auditTrail.length,
      blockedReasons,
      artifactInitializationStatus: contract.artifacts.initializationPlan.status,
      scopeProofStatus: contract.scopeProof.status,
      scopeProofFingerprint: contract.scopeProof.scopeBindingFingerprint,
      workflowCommandPacketId: contract.handoff.workflowCommandPacket.packetId,
      workflowCommandPacketStatus: contract.handoff.workflowCommandPacket.status,
      workflowCommandPacketFingerprint: contract.handoff.workflowCommandPacket.packetFingerprint,
      expectedArtifactWrites: verifierArtifactWrites,
      proofInputsFingerprint: stableStateFingerprint(proofInputs)
    },
    issuedAt: now
  };
}

function buildObjectiveTruthSurfaceDecision(state, contract, bootProofHandoff, analytics, now) {
  const receiptRequired = contract.request.handoffReceipt.required;
  const receiptSatisfied = contract.request.handoffReceipt.satisfied;
  const blockingSignals = [
    contract.status === "blocked" ? "runtime-contract-blocked" : "",
    contract.permissions.enforcement === "blocked" ? "permission-boundary-blocked" : "",
    contract.providers.status === "blocked" ? "provider-contract-blocked" : "",
    contract.providers.serviceSync.status === "blocked" ? "provider-sync-blocked" : "",
    contract.providers.handoffClaim.status === "blocked" ? "provider-handoff-claim-blocked" : "",
    contract.lifecycle.status === "blocked" ? "lifecycle-blocked" : "",
    contract.artifacts.status === "blocked" ? "artifact-root-blocked" : "",
    contract.scopeProof.status === "blocked" ? "scope-proof-blocked" : "",
    contract.handoff.manifest.status === "blocked" ? "handoff-manifest-blocked" : "",
    contract.hostedBootCommand.status === "blocked" ? "hosted-command-orchestration-blocked" : "",
    contract.restartRecovery.status === "blocked" ? "restart-recovery-blocked" : "",
    contract.state.commandRestartSafeStatus === "unsafe" ? "command-restart-state-unsafe" : "",
    contract.health.failureState.blocked ? "health-failure-blocked" : "",
    bootProofHandoff.status === "blocked" && !(receiptRequired && !receiptSatisfied)
      ? "boot-proof-blocked"
      : ""
  ].filter(Boolean);
  const queueSignals = [
    contract.lifecycle.status === "scheduled" ? "lifecycle-scheduled" : "",
    contract.providers.serviceSync.status === "backpressure" ? "provider-sync-backpressure" : "",
    contract.providers.handoffClaim.status === "waiting" ? "provider-handoff-claim-waiting" : "",
    contract.providers.handoffClaim.status === "claim-required" ? "provider-handoff-claim-required" : "",
    contract.hostedBootCommand.status === "queued" ? "hosted-command-orchestration-queued" : "",
    contract.handoff.workflow.status === "queued" ? "workflow-handoff-queued" : "",
    bootProofHandoff.status === "queued" ? "boot-proof-queued" : ""
  ].filter(Boolean);
  const pendingSignals = [
    receiptRequired && !receiptSatisfied ? "client-handoff-acknowledgement-pending" : "",
    contract.hostedBootCommand.status === "awaiting-ack" ? "hosted-command-orchestration-awaiting-ack" : "",
    contract.persistence.status === "ready-to-commit" && contract.persistence.writePlan.pendingWriteCount > 0
      ? "persistence-commit-pending"
      : "",
    contract.restartRecovery.status === "waiting-for-ack" ? "restart-recovery-waiting-for-ack" : "",
    contract.state.commandRestartStatus === "recovering-writes" ? "command-state-recovery-pending" : ""
  ].filter(Boolean);
  const contradictorySignals = [
    contract.status === "ready"
      && bootProofHandoff.status === "blocked"
      && !(receiptRequired && !receiptSatisfied)
      ? "runtime-ready-while-boot-proof-blocked"
      : "",
    contract.handoff.manifest.status === "dispatchable" && contract.handoff.workflow.status === "blocked"
      ? "manifest-dispatchable-while-workflow-blocked"
      : "",
    contract.persistence.status === "blocked" && contract.state.nextStatus === "booting"
      ? "persistence-blocked-while-state-would-boot"
      : ""
  ].filter(Boolean);
  const commandAdmitted = blockingSignals.length === 0
    && queueSignals.length === 0
    && pendingSignals.length === 0
    && contradictorySignals.length === 0;
  const status = blockingSignals.length || contradictorySignals.length
    ? "blocked"
    : queueSignals.length
      ? "queued"
      : pendingSignals.length
        ? "awaiting-ack"
        : "admitted";
  const operatorDisposition = status === "admitted"
    ? "dispatch"
    : status === "queued"
      ? "wait-for-scheduled-handoff"
      : status === "awaiting-ack"
        ? "wait-for-client-acknowledgement"
        : "block-before-dispatch";
  const proofInputs = [
    state.requestId,
    contract.state.bootId,
    contract.state.command,
    contract.status,
    contract.handoff.manifest.status,
    contract.handoff.workflow.status,
    contract.hostedBootCommand.orchestrationId,
    bootProofHandoff.status,
    contract.providers.serviceSync.syncFingerprint,
    contract.providers.handoffClaim.claimFingerprint,
    contract.lifecycle.controlFingerprint,
    contract.request.handoffReceipt.receiptFingerprint,
    contract.scopeProof.scopeBindingFingerprint,
    analytics.exportSummary.exportId,
    status
  ];

  return {
    version: "cli-boot.objective-truth.v1",
    status,
    admitted: commandAdmitted,
    operatorDisposition,
    command: contract.state.command,
    route: state.route,
    workspaceKey: contract.scope.workspaceKey,
    bootId: contract.state.bootId,
    requestId: state.requestId,
    decisiveReasons: [...blockingSignals, ...contradictorySignals, ...queueSignals, ...pendingSignals],
    blockingSignals,
    contradictorySignals,
    queueSignals,
    pendingSignals,
    externallyVisibleStatus: {
      runtime: contract.status,
      manifest: contract.handoff.manifest.status,
      workflow: contract.handoff.workflow.status,
      orchestration: contract.hostedBootCommand.status,
      bootProof: bootProofHandoff.status,
      scopeProof: contract.scopeProof.status,
      health: contract.health.status,
      lifecycle: contract.lifecycle.status,
      providerSync: contract.providers.serviceSync.status,
      providerHandoffClaim: contract.providers.handoffClaim.status,
      persistence: contract.persistence.status,
      restartRecovery: contract.restartRecovery.status,
      commandRestart: contract.state.commandRestartStatus,
      acknowledgement: contract.request.handoffReceipt.status
    },
    admissionRequirements: {
      providerSyncReady: contract.providers.serviceSync.status === "in-sync",
      providerHandoffClaimReady: contract.providers.handoffClaim.status === "ready",
      lifecycleReady: contract.lifecycle.status === "ready",
      artifactRootReady: contract.artifacts.status === "initialized",
      scopeProofReady: contract.scopeProof.status !== "blocked",
      manifestDispatchable: contract.handoff.manifest.status === "dispatchable",
      workflowReady: contract.handoff.workflow.status === "ready",
      hostedCommandDispatchable: contract.hostedBootCommand.status === "dispatchable",
      receiptSatisfied: !receiptRequired || receiptSatisfied,
      bootProofReady: bootProofHandoff.status === "ready",
      persistenceWritable: contract.persistence.status !== "blocked",
      restartRecoverySafe: contract.restartRecovery.restartSafeStatus !== "unsafe",
      commandRestartSafe: contract.state.commandRestartSafeStatus !== "unsafe",
      commandStateSettledOrWritable: contract.state.commandReplaySettled
        || contract.state.commandRestartStatus === "ready-to-append"
        || contract.state.commandRestartStatus === "ready"
    },
    verifier: {
      proofDigest: `objective-truth:${stableStateFingerprint(proofInputs)}`,
      bootProofHandoffId: bootProofHandoff.handoffProofId,
      analyticsExportId: analytics.exportSummary.exportId,
      receiptFingerprint: contract.request.handoffReceipt.receiptFingerprint,
      workflowHandoffToken: contract.handoff.workflow.handoffToken,
      hostedCommandOrchestrationId: contract.hostedBootCommand.orchestrationId,
      proofInputsFingerprint: stableStateFingerprint(proofInputs)
    },
    evaluatedAt: now
  };
}

export function describeCliBootSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const parsed = parseCliFlags(normalizeArgs(input.argv));
  const clientState = normalizeClientState(input, parsed, now);
  const runtimeContract = buildRuntimeContract(clientState, evidence, now);
  const auditTrail = buildAuditTrail(clientState, runtimeContract, now, evidence);
  const analyticsHistory = normalizeAnalyticsHistory(input, now);
  const analytics = buildAnalyticsSnapshot(clientState, runtimeContract, auditTrail, evidence, analyticsHistory, now);
  const bootProofHandoff = buildBootProofHandoff(clientState, runtimeContract, auditTrail, analytics, now);
  const objectiveTruth = buildObjectiveTruthSurfaceDecision(clientState, runtimeContract, bootProofHandoff, analytics, now);

  return {
    ok: objectiveTruth.status !== "blocked",
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    objectiveTruth,
    contract: runtimeContract,
    clientState,
    workflowHandoff: {
      route: clientState.route,
      target: runtimeContract.handoff.target,
      nextAction: runtimeContract.handoff.nextAction,
      status: runtimeContract.handoff.workflow.status,
      deliveryMode: runtimeContract.handoff.workflow.delivery.mode,
      deliveryChannel: runtimeContract.handoff.workflow.delivery.channel,
      continuationToken: runtimeContract.handoff.workflow.delivery.continuationToken,
      acknowledgementPolicy: runtimeContract.handoff.workflow.acknowledgement.policy,
      acknowledgementDeadlineMs: runtimeContract.handoff.workflow.acknowledgement.deadlineMs,
      acknowledgementTransport: runtimeContract.handoff.workflow.delivery.ackTransport,
      acknowledgementReceiptStatus: runtimeContract.handoff.workflow.acknowledgement.receiptStatus,
      acknowledgementReceiptSatisfied: runtimeContract.handoff.workflow.acknowledgement.receiptSatisfied,
      acknowledgementPending: runtimeContract.handoff.workflow.userVisible.acknowledgementPending,
      runtimeDispatchCapability: runtimeContract.handoff.workflow.runtime.dispatchCapability,
      tenantId: runtimeContract.scope.tenantId,
      workspaceKey: runtimeContract.scope.workspaceKey,
      permissionEnforcement: runtimeContract.permissions.enforcement,
      providerHandoffClaimStatus: runtimeContract.providers.handoffClaim.status,
      providerHandoffClaimNextAction: runtimeContract.providers.handoffClaim.nextAction,
      providerHandoffClaimFingerprint: runtimeContract.providers.handoffClaim.claimFingerprint,
      lifecycleStatus: runtimeContract.lifecycle.status,
      lifecycleNextRunAt: runtimeContract.lifecycle.schedule.nextRunAt,
      artifactRootStatus: runtimeContract.artifacts.status,
      artifactProofPath: runtimeContract.artifacts.proofPath,
      artifactManifestPath: runtimeContract.artifacts.manifestPath,
      scopeProofStatus: runtimeContract.scopeProof.status,
      scopeProofFingerprint: runtimeContract.scopeProof.scopeBindingFingerprint,
      auditHandoffRequired: runtimeContract.handoff.auditHandoffRequired,
      manualContinuationRequired: runtimeContract.handoff.workflow.userVisible.manualContinuationRequired,
      remediationStatus: runtimeContract.health.remediationPlan.status,
      remediationPrimaryAction: runtimeContract.health.remediationPlan.primaryAction,
      remediationRetryAfterMs: runtimeContract.health.remediationPlan.retry.nextDelayMs,
      remediationFallbackCommand: runtimeContract.health.remediationPlan.degradedFallback.command,
      userVisibleLabel: runtimeContract.handoff.workflow.userVisible.label,
      userVisibleMessage: objectiveTruth.status === "awaiting-ack"
        ? "The hosted-kernel handoff is waiting for client acknowledgement before it is admitted."
        : objectiveTruth.status === "queued"
          ? "The hosted-kernel handoff is queued and not admitted for dispatch yet."
          : objectiveTruth.status === "blocked"
            ? "The hosted-kernel handoff is blocked by objective-truth admission checks."
            : runtimeContract.handoff.workflow.userVisible.message,
      commandPacketStatus: runtimeContract.handoff.workflowCommandPacket.status,
      commandPacketId: runtimeContract.handoff.workflowCommandPacket.packetId,
      commandPacketNextClientAction: runtimeContract.handoff.workflowCommandPacket.nextClientAction,
      commandPacketManualArgv: runtimeContract.handoff.workflowCommandPacket.manualCommand.argv,
      commandPacketDispatchEnabled: runtimeContract.handoff.workflowCommandPacket.dispatchCommand.enabled,
      commandPacketAckRequired: runtimeContract.handoff.workflowCommandPacket.acknowledgementCommand.required,
      commandPacketAckTemplate: runtimeContract.handoff.workflowCommandPacket.acknowledgementCommand.receiptTemplate,
      commandPacketPendingPhases: runtimeContract.handoff.workflowCommandPacket.pendingPhaseNames,
      objectiveTruthStatus: objectiveTruth.status,
      objectiveTruthDisposition: objectiveTruth.operatorDisposition,
      objectiveTruthReasons: objectiveTruth.decisiveReasons
    },
    bootProofHandoff,
    proof: {
      generatedAt: now,
      surfaceId,
      requestId: clientState.requestId,
      status: objectiveTruth.status,
      runtimeContractStatus: runtimeContract.status,
      objectiveTruthStatus: objectiveTruth.status,
      objectiveTruthAdmitted: objectiveTruth.admitted,
      objectiveTruthDisposition: objectiveTruth.operatorDisposition,
      objectiveTruthReasons: objectiveTruth.decisiveReasons,
      objectiveTruthProofDigest: objectiveTruth.verifier.proofDigest,
      objectiveTruthVisibleStatus: objectiveTruth.externallyVisibleStatus,
      bootId: runtimeContract.state.bootId,
      command: runtimeContract.state.command,
      tenantId: runtimeContract.scope.tenantId,
      workspaceKey: runtimeContract.scope.workspaceKey,
      permissionStatus: runtimeContract.permissions.status,
      permissionEnforcement: runtimeContract.permissions.enforcement,
      boundaryViolations: runtimeContract.permissions.violations,
      providerStatus: runtimeContract.providers.status,
      requiredProviders: runtimeContract.providers.requiredProviders,
      unavailableProviders: runtimeContract.providers.unavailableProviders,
      providerSyncWatermark: runtimeContract.providers.syncWatermark,
      providerServiceSyncStatus: runtimeContract.providers.serviceSync.status,
      providerServiceSyncFingerprint: runtimeContract.providers.serviceSync.syncFingerprint,
      providerHandoffClaimStatus: runtimeContract.providers.handoffClaim.status,
      providerHandoffClaimNextAction: runtimeContract.providers.handoffClaim.nextAction,
      providerHandoffClaimFingerprint: runtimeContract.providers.handoffClaim.claimFingerprint,
      providerSyncClaimableProviders: runtimeContract.providers.serviceSync.claimableProviders,
      providerSyncBackpressureProviders: runtimeContract.providers.serviceSync.backpressureProviders,
      providerSyncMissingAckProviders: runtimeContract.providers.serviceSync.missingAckProviders,
      providerSyncClaimTokens: runtimeContract.externalHandoffState.providerSyncClaims
        .filter((claim) => claim.claimToken)
        .map((claim) => claim.claimToken),
      externalHandoffUris: runtimeContract.externalHandoffState.handoffUris,
      externalHandoffClaimRecords: runtimeContract.providers.handoffClaim.claimRecords,
      handoffManifestStatus: runtimeContract.handoff.manifest.status,
      handoffTargetProvider: runtimeContract.handoff.manifest.targetProvider,
      handoffRequiredAckProvider: runtimeContract.handoff.manifest.requiredAckProvider,
      handoffProofDigest: runtimeContract.handoff.manifest.proofDigest,
      handoffValidationErrors: runtimeContract.handoff.manifest.validationErrors,
      artifactRootStatus: runtimeContract.artifacts.status,
      artifactRoot: runtimeContract.artifacts.root,
      artifactBasePath: runtimeContract.artifacts.basePath,
      artifactProofPath: runtimeContract.artifacts.proofPath,
      artifactManifestPath: runtimeContract.artifacts.manifestPath,
      artifactLedgerPath: runtimeContract.artifacts.ledgerPath,
      artifactRetentionKey: runtimeContract.artifacts.retentionKey,
      artifactRootSource: runtimeContract.artifacts.rootSource,
      artifactFiles: runtimeContract.artifacts.artifactFiles,
      artifactInitializationPlan: runtimeContract.artifacts.initializationPlan,
      artifactValidationCodes: runtimeContract.artifacts.validationFindings.map((finding) => finding.code),
      scopeProofStatus: runtimeContract.scopeProof.status,
      scopeProofRequired: runtimeContract.scopeProof.required,
      scopeProofSupplied: runtimeContract.scopeProof.supplied,
      scopeProofDigest: runtimeContract.scopeProof.proofDigest,
      scopeProofManifestDigest: runtimeContract.scopeProof.manifestDigest,
      scopeProofFingerprint: runtimeContract.scopeProof.scopeBindingFingerprint,
      scopeProofValidationCodes: runtimeContract.scopeProof.validationFindings.map((finding) => finding.code),
      bootProofHandoffStatus: bootProofHandoff.status,
      bootProofHandoffId: bootProofHandoff.handoffProofId,
      bootProofHandoffBlockedReasons: bootProofHandoff.verifier.blockedReasons,
      bootProofRequiredArtifactsReady: bootProofHandoff.requiredArtifactsReady,
      bootProofExpectedArtifactWrites: bootProofHandoff.verifier.expectedArtifactWrites,
      bootProofVerifierFingerprint: bootProofHandoff.verifier.proofInputsFingerprint,
      hostedBootCommandStatus: runtimeContract.hostedBootCommand.status,
      hostedBootCommandOrchestrationId: runtimeContract.hostedBootCommand.orchestrationId,
      hostedBootCommandCanDispatch: runtimeContract.hostedBootCommand.canDispatch,
      hostedBootCommandNextAction: runtimeContract.hostedBootCommand.nextAction,
      hostedBootCommandPreflightBlocks: runtimeContract.hostedBootCommand.preflightBlocks,
      hostedBootCommandQueueReasons: runtimeContract.hostedBootCommand.queueReasons,
      hostedBootCommandAckPending: runtimeContract.hostedBootCommand.acknowledgementPending,
      hostedBootCommandArtifactInitializationStatus: runtimeContract.hostedBootCommand.artifactRootInitialization.status,
      hostedBootCommandBootProofHandoffStatus: runtimeContract.hostedBootCommand.bootProofHandoff.status,
      hostedBootCommandProviderHandoffClaim: runtimeContract.hostedBootCommand.providerHandoffClaim,
      hostedBootCommandRestartState: runtimeContract.hostedBootCommand.restartCommandState,
      hostedBootCommandPhaseStatuses: runtimeContract.hostedBootCommand.phases.map((phase) => `${phase.name}:${phase.status}`),
      workflowHandoffStatus: runtimeContract.handoff.workflow.status,
      workflowCommandPacketStatus: runtimeContract.handoff.workflowCommandPacket.status,
      workflowCommandPacketId: runtimeContract.handoff.workflowCommandPacket.packetId,
      workflowCommandPacketNextClientAction: runtimeContract.handoff.workflowCommandPacket.nextClientAction,
      workflowCommandPacketManualArgv: runtimeContract.handoff.workflowCommandPacket.manualCommand.argv,
      workflowCommandPacketPendingPhases: runtimeContract.handoff.workflowCommandPacket.pendingPhaseNames,
      workflowHandoffDeliveryMode: runtimeContract.handoff.workflow.delivery.mode,
      workflowHandoffChannel: runtimeContract.handoff.workflow.delivery.channel,
      workflowAckTransport: runtimeContract.handoff.workflow.delivery.ackTransport,
      workflowContinuationToken: runtimeContract.handoff.workflow.delivery.continuationToken,
      workflowAckPolicy: runtimeContract.handoff.workflow.acknowledgement.policy,
      workflowAckDeadlineMs: runtimeContract.handoff.workflow.acknowledgement.deadlineMs,
      workflowRuntimeMaxAckLatencyMs: runtimeContract.handoff.workflow.acknowledgement.runtimeMaxLatencyMs,
      workflowAckReceiptStatus: runtimeContract.handoff.workflow.acknowledgement.receiptStatus,
      workflowAckReceiptSatisfied: runtimeContract.handoff.workflow.acknowledgement.receiptSatisfied,
      workflowAckReceiptFingerprint: runtimeContract.handoff.workflow.acknowledgement.receiptFingerprint,
      workflowAckPending: runtimeContract.handoff.workflow.userVisible.acknowledgementPending,
      workflowRuntimeDispatchCapability: runtimeContract.handoff.workflow.runtime.dispatchCapability,
      workflowManualContinuationRequired: runtimeContract.handoff.workflow.userVisible.manualContinuationRequired,
      clientRequestFingerprint: runtimeContract.request.client.clientFingerprint,
      clientRequestValidationCodes: runtimeContract.request.client.validationFindings.map((finding) => finding.code),
      clientRuntimeFingerprint: runtimeContract.request.runtime.runtimeFingerprint,
      clientRuntimeAckTransport: runtimeContract.request.runtime.ackTransport,
      clientRuntimeSupportedDeliveryModes: runtimeContract.request.runtime.supportedDeliveryModes,
      clientRuntimeValidationCodes: runtimeContract.request.runtime.validationFindings.map((finding) => finding.code),
      clientHandoffReceiptStatus: runtimeContract.request.handoffReceipt.status,
      clientHandoffReceiptRequired: runtimeContract.request.handoffReceipt.required,
      clientHandoffReceiptSatisfied: runtimeContract.request.handoffReceipt.satisfied,
      clientHandoffReceiptExpectedContinuationToken: runtimeContract.request.handoffReceipt.expectedContinuationToken,
      clientHandoffReceiptExpectedProofDigest: runtimeContract.request.handoffReceipt.expectedProofDigest,
      clientHandoffReceiptReceivedStatus: runtimeContract.request.handoffReceipt.received.status,
      clientHandoffReceiptValidationCodes: runtimeContract.request.handoffReceipt.validationFindings.map((finding) => finding.code),
      lifecycleStatus: runtimeContract.lifecycle.status,
      lifecycleMode: runtimeContract.lifecycle.mode,
      lifecycleEnabled: runtimeContract.lifecycle.enabled,
      lifecycleCommandAllowed: runtimeContract.lifecycle.commandAllowed,
      lifecycleScheduleMode: runtimeContract.lifecycle.schedule.mode,
      lifecycleNextRunAt: runtimeContract.lifecycle.schedule.nextRunAt,
      lifecycleControlFingerprint: runtimeContract.lifecycle.controlFingerprint,
      lifecycleValidationCodes: runtimeContract.lifecycle.validationFindings.map((finding) => finding.code),
      restartSafeStatus: runtimeContract.state.restartSafeStatus,
      commandRestartSafeStatus: runtimeContract.state.commandRestartSafeStatus,
      commandRestartStatus: runtimeContract.state.commandRestartStatus,
      commandRestartNextAction: runtimeContract.state.commandRestartNextAction,
      commandReplaySettled: runtimeContract.state.commandReplaySettled,
      recoveryMode: runtimeContract.state.recoveryMode,
      persistenceStatus: runtimeContract.persistence.status,
      persistenceKey: runtimeContract.persistence.idempotencyKey,
      persistenceWritePlanMode: runtimeContract.persistence.writePlan.mode,
      pendingPersistenceWriteCount: runtimeContract.persistence.writePlan.pendingWriteCount,
      commandResultReplayAvailable: runtimeContract.persistence.commandResultReplay.available,
      commandResultReplayReason: runtimeContract.persistence.commandResultReplay.reason,
      commandResultReplayDigest: runtimeContract.persistence.commandResultReplay.digest,
      commandResultReplayConflict: runtimeContract.persistence.commandResultReplay.conflict,
      persistedCommandResult: runtimeContract.state.persistedCommandResult,
      recoveryCursor: runtimeContract.persistence.nextRecoveryCursor,
      restartRecoveryStatus: runtimeContract.restartRecovery.status,
      restartRecoverySafeStatus: runtimeContract.restartRecovery.restartSafeStatus,
      restartRecoveryNextAction: runtimeContract.restartRecovery.nextRecoveryAction,
      restartRecoveryReplayWriteIds: runtimeContract.restartRecovery.replayWriteIds,
      restartRecoveryWaitingWriteIds: runtimeContract.restartRecovery.waitingWriteIds,
      restartRecoveryRejectedWriteIds: runtimeContract.restartRecovery.rejectedWriteIds,
      commandRestartExpectedWriteIds: runtimeContract.externalHandoffState.commandRestartSemantics.expectedWriteIds,
      commandRestartPendingWriteIds: runtimeContract.externalHandoffState.commandRestartSemantics.pendingWriteIds,
      commandRestartAcceptedWriteIds: runtimeContract.externalHandoffState.commandRestartSemantics.acceptedWriteIds,
      commandRestartMissingWriteIds: runtimeContract.externalHandoffState.commandRestartSemantics.missingWriteIds,
      commandRestartRejectedWriteIds: runtimeContract.externalHandoffState.commandRestartSemantics.rejectedWriteIds,
      healthStatus: runtimeContract.health.status,
      healthSeverity: runtimeContract.health.severity,
      retryable: runtimeContract.health.retryPolicy.retryable,
      nextRetryDelayMs: runtimeContract.health.retryPolicy.nextDelayMs,
      degradedMode: runtimeContract.health.degradedMode.enabled,
      failureBlocked: runtimeContract.health.failureState.blocked,
      operationalRemediationStatus: runtimeContract.health.remediationPlan.status,
      operationalRemediationPrimaryAction: runtimeContract.health.remediationPlan.primaryAction,
      operationalRemediationPrimaryMessage: runtimeContract.health.remediationPlan.primaryMessage,
      operationalRemediationBlocksDispatch: runtimeContract.health.remediationPlan.blocksDispatch,
      operationalRemediationRetry: runtimeContract.health.remediationPlan.retry,
      operationalRemediationDegradedFallback: runtimeContract.health.remediationPlan.degradedFallback,
      operationalRemediationStepCodes: runtimeContract.health.remediationPlan.steps.map((step) => step.code),
      actionableErrorCodes: runtimeContract.health.actionableErrors.map((error) => error.code),
      analyticsExportId: analytics.exportSummary.exportId,
      analyticsExportReady: analytics.exportSummary.exportReady,
      analyticsExportStatus: analytics.exportSummary.exportStatus,
      analyticsExportBlockingReasons: analytics.exportSummary.exportBlockingReasons,
      analyticsSnapshotCount: analytics.counters.totalSnapshots,
      analyticsReportState: analytics.timeline.reportState,
      analyticsAdmissionStatus: analytics.latest.admissionStatus,
      analyticsAckPendingSnapshots: analytics.counters.ackPendingSnapshots,
      analyticsExportReadySnapshots: analytics.counters.exportReadySnapshots,
      analyticsPendingWriteHighWatermark: analytics.history.pendingWriteHighWatermark,
      analyticsQueueReasonHighWatermark: analytics.history.queueReasonHighWatermark,
      analyticsBlockerHighWatermark: analytics.history.blockerHighWatermark,
      analyticsPhaseCounts: analytics.reporting.phaseCounts,
      idempotent: runtimeContract.state.idempotent,
      nextPersistedStatus: runtimeContract.state.nextStatus,
      auditEventTypes: auditTrail.map((event) => event.type)
    },
    auditTrail,
    analytics,
    evidence
  };
}

export default describeCliBootSurface;
