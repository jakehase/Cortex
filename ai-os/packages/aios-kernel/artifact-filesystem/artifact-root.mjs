export const surfaceId = "aios_artifact-filesystem_artifact-root_031";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "artifact-root";

const ARTIFACT_ROOT_CONTRACT_VERSION = "artifact-root.provider.v1";
const DEFAULT_PROVIDER_ID = "hosted-kernel-artifact-root";
const DEFAULT_ROOT_URI = "aios://artifact-root";
const DEFAULT_PREVIEW_LIMIT = 25;
const ARTIFACT_ROOT_BOOT_NAMESPACE = ".aios/artifact-root";
const BOOT_ARTIFACT_PATHS = Object.freeze({
  rootDescriptor: "boot/root.json",
  proofEnvelope: "boot/proof.json",
  providerRegistry: "boot/providers.json",
  commandLedger: "boot/commands.json",
  manifestIndex: "boot/manifests.json"
});

const HOSTED_KERNEL_CAPABILITIES = Object.freeze([
  "artifact.root.describe",
  "artifact.root.sync.read",
  "artifact.root.sync.write",
  "artifact.root.handoff.external",
  "artifact.root.audit.proof"
]);

const WRITABLE_MUTATIONS = new Set(["create", "update", "delete", "move"]);
const HANDOFF_STATES = new Set(["none", "pending", "exported", "acknowledged", "failed"]);
const ACCEPTANCE_DECISIONS = new Set(["accepted", "rejected", "pending"]);
const COMMAND_TYPES = new Set(["sync", "commit", "export", "recover"]);
const SERVICE_INTENTS = new Set(["read", "write", "audit", "handoff"]);
const JOURNAL_ENTRY_STATES = new Set(["pending", "applied", "failed"]);
const RESTART_STATUS = new Set(["clean", "needs-recovery", "replaying", "blocked"]);
const TENANT_ROLES = new Set(["viewer", "editor", "auditor", "owner"]);
const HEALTH_STATUSES = new Set(["healthy", "degraded", "unhealthy"]);
const FAILURE_SEVERITIES = new Set(["info", "warning", "error", "critical"]);
const RETRY_MODES = new Set(["none", "immediate", "exponential-backoff", "operator-gated"]);
const EXPORT_FORMATS = new Set(["json", "ndjson", "csv"]);
const CLIENT_PANELS = new Set(["preview", "review", "commit", "export", "recovery", "health"]);
const CLIENT_NETWORK_STATES = new Set(["online", "offline", "reconnecting"]);
const CLIENT_HANDOFF_CHANNELS = new Set(["ui", "worker", "external"]);
const CLIENT_HANDOFF_PRIORITIES = new Set(["low", "normal", "high", "blocking"]);
const CLIENT_HANDOFF_RECEIPT_STATES = new Set(["queued", "dispatched", "acknowledged", "applied", "failed"]);
const PROVIDER_SYNC_STATES = new Set(["current", "stale", "catching-up", "offline", "quarantined"]);
const PERSISTED_WRITE_STATES = new Set(["persisted", "failed", "pending"]);
const LIFECYCLE_ENABLEMENT_STATES = new Set(["enabled", "disabled", "read-only"]);
const LIFECYCLE_SCHEDULE_MODES = new Set(["manual", "interval", "cron", "paused", "maintenance"]);
const LIFECYCLE_CONTROL_ACTIONS = new Set([
  "enable-artifact-root",
  "disable-artifact-root",
  "enable-writes",
  "set-read-only",
  "pause-schedule",
  "resume-schedule",
  "set-interval-schedule",
  "set-cron-schedule",
  "run-now",
  "enter-maintenance",
  "exit-maintenance"
]);
const COMMAND_LEDGER_STATES = new Set(["new", "applied", "inflight", "replayable", "failed", "duplicate"]);
const CLIENT_ROUTE_BY_ACTION = Object.freeze({
  refresh: "/artifact-root/preview/refresh",
  accept: "/artifact-root/preview/accept",
  apply: "/artifact-root/commit",
  export: "/artifact-root/export",
  recover: "/artifact-root/recover"
});
const CLIENT_ACTIONS = new Set(Object.keys(CLIENT_ROUTE_BY_ACTION));
const TIMELINE_EVENT_TYPES = new Set([
  "snapshot",
  "checkpoint",
  "journal",
  "acceptance",
  "handoff",
  "health",
  "readiness"
]);
const ROLE_PERMISSIONS = Object.freeze({
  viewer: ["artifact.root.describe", "artifact.root.sync.read"],
  editor: ["artifact.root.describe", "artifact.root.sync.read", "artifact.root.sync.write"],
  auditor: ["artifact.root.describe", "artifact.root.sync.read", "artifact.root.audit.proof"],
  owner: [...HOSTED_KERNEL_CAPABILITIES]
});
const PATH_ACCESS_SOURCE_POLICIES = Object.freeze({
  preview: {
    read: true,
    write: false,
    handoff: false,
    label: "preview"
  },
  "sync-dirty": {
    read: true,
    write: true,
    handoff: false,
    label: "sync-dirty"
  },
  "sync-conflict": {
    read: true,
    write: true,
    handoff: false,
    label: "sync-conflict"
  },
  command: {
    read: false,
    write: true,
    handoff: false,
    label: "command"
  },
  handoff: {
    read: true,
    write: false,
    handoff: true,
    label: "handoff"
  }
});

function toIsoTimestamp(value, fallback = new Date().toISOString()) {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item) => typeof item === "string" && item.length > 0))].sort();
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizeCommandId(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeBoundaryPrefix(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().replace(/^\/+/, "");
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function decodeArtifactPath(value) {
  try {
    return {
      value: decodeURIComponent(value),
      malformed: false
    };
  } catch {
    return {
      value,
      malformed: true
    };
  }
}

function inspectArtifactPath(value, fallback = "artifact") {
  const raw = typeof value === "string" && value.length > 0 ? value : fallback;
  const reasons = [];
  let candidate = String(raw).trim();

  if (candidate.length === 0) {
    candidate = fallback;
    reasons.push("path-empty-used-fallback");
  }
  if (raw !== candidate) {
    reasons.push("path-trimmed");
  }
  if (/[\u0000-\u001F\u007F]/.test(candidate)) {
    reasons.push("path-contains-control-character");
  }

  const schemeMatch = candidate.match(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/]*)(\/?.*)$/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const host = schemeMatch[2];
    const path = schemeMatch[3] || "";
    if (scheme === "aios://" && host === "artifact-root") {
      candidate = path;
    } else {
      reasons.push("path-uses-unsupported-root-uri");
      candidate = path || host || fallback;
    }
  }

  if (candidate.includes("\\")) {
    reasons.push("path-contained-backslash");
    candidate = candidate.replace(/\\/g, "/");
  }

  const decoded = decodeArtifactPath(candidate);
  if (decoded.malformed) {
    reasons.push("path-has-malformed-encoding");
  }
  if (decoded.value !== candidate) {
    reasons.push("path-was-percent-decoded");
  }
  candidate = decoded.value;

  const segments = [];
  for (const segment of candidate.replace(/^\/+/, "").split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      reasons.push("path-traversal-segment");
      continue;
    }
    if (/[\u0000-\u001F\u007F]/.test(segment)) {
      reasons.push("path-segment-contains-control-character");
      continue;
    }
    segments.push(segment);
  }

  const normalizedPath = segments.length > 0 ? segments.join("/") : fallback;
  const securityReasons = normalizeStringList(reasons.filter((reason) => [
    "path-contains-control-character",
    "path-uses-unsupported-root-uri",
    "path-has-malformed-encoding",
    "path-traversal-segment",
    "path-segment-contains-control-character"
  ].includes(reason)));

  return {
    originalPath: raw,
    normalizedPath,
    canonicalPath: normalizedPath,
    pathChanged: raw !== normalizedPath,
    valid: securityReasons.length === 0,
    reasons: normalizeStringList(reasons),
    securityReasons
  };
}

function normalizeArtifactPath(value, fallback) {
  return inspectArtifactPath(value, fallback).normalizedPath;
}

function normalizePathSegment(value, fallback) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const safe = candidate
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe.length > 0 ? safe.slice(0, 80) : fallback;
}

function normalizeClientRoute(value, fallback = CLIENT_ROUTE_BY_ACTION.refresh) {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  return Object.values(CLIENT_ROUTE_BY_ACTION).includes(value) ? value : fallback;
}

function normalizeClientAction(value, fallback = "refresh") {
  return typeof value === "string" && CLIENT_ACTIONS.has(value) ? value : fallback;
}

function normalizeClientHandoffChannel(value) {
  return typeof value === "string" && CLIENT_HANDOFF_CHANNELS.has(value) ? value : "ui";
}

function normalizeClientHandoffPriority(value, fallback = "normal") {
  return typeof value === "string" && CLIENT_HANDOFF_PRIORITIES.has(value) ? value : fallback;
}

function normalizeClientHandoffReceipts(value, generatedAt) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((receipt) => receipt && typeof receipt === "object")
    .map((receipt, index) => {
      const state = typeof receipt.state === "string" && CLIENT_HANDOFF_RECEIPT_STATES.has(receipt.state)
        ? receipt.state
        : "queued";
      const envelopeId = typeof receipt.envelopeId === "string" && receipt.envelopeId.length > 0
        ? receipt.envelopeId
        : `client-handoff-receipt:${index + 1}`;
      const dispatchToken = typeof receipt.dispatchToken === "string" && receipt.dispatchToken.length > 0
        ? receipt.dispatchToken
        : null;

      return {
        envelopeId,
        dispatchToken,
        state,
        route: normalizeClientRoute(receipt.route),
        action: typeof receipt.action === "string" && receipt.action.length > 0 ? receipt.action : "refresh-preview",
        receivedAt: toIsoTimestamp(receipt.receivedAt || receipt.acknowledgedAt || receipt.dispatchedAt, generatedAt),
        workerId: typeof receipt.workerId === "string" && receipt.workerId.length > 0 ? receipt.workerId : null,
        reason: typeof receipt.reason === "string" && receipt.reason.length > 0 ? receipt.reason : null
      };
    })
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.envelopeId.localeCompare(b.envelopeId));
}

function buildClientHandoffReceiptState(handoffRequest, envelopeId, dispatchToken, selectedAction, handoffRoute, generatedAt) {
  const receipts = normalizeClientHandoffReceipts([
    ...(Array.isArray(handoffRequest.receipts) ? handoffRequest.receipts : []),
    ...(Array.isArray(handoffRequest.acks) ? handoffRequest.acks : []),
    ...(handoffRequest.receipt && typeof handoffRequest.receipt === "object" ? [handoffRequest.receipt] : [])
  ], generatedAt);
  const matchingReceipts = receipts.filter((receipt) => (
    receipt.envelopeId === envelopeId
    || (receipt.dispatchToken !== null && receipt.dispatchToken === dispatchToken)
  ));
  const latestReceipt = matchingReceipts.at(-1) || null;
  const terminalState = latestReceipt && ["acknowledged", "applied", "failed"].includes(latestReceipt.state);
  const acknowledged = Boolean(latestReceipt && ["acknowledged", "applied"].includes(latestReceipt.state));
  const failed = latestReceipt?.state === "failed";
  const awaitingReceipt = Boolean(latestReceipt && ["queued", "dispatched"].includes(latestReceipt.state));
  const replayToken = stableProofId([
    envelopeId,
    dispatchToken,
    selectedAction.action,
    handoffRoute,
    latestReceipt ? latestReceipt.state : "no-receipt"
  ]);

  return {
    contractVersion: "artifact-root.client-handoff-receipts.v1",
    envelopeId,
    dispatchToken,
    receiptCount: receipts.length,
    matchingReceiptCount: matchingReceipts.length,
    duplicateReceiptCount: Math.max(matchingReceipts.length - 1, 0),
    latestReceipt,
    acknowledged,
    failed,
    awaitingReceipt,
    terminalState: Boolean(terminalState),
    replayToken,
    nextClientInstruction: acknowledged
      ? "render-acknowledged-handoff"
      : failed
        ? "show-handoff-receipt-failure"
        : awaitingReceipt
          ? "await-handoff-receipt"
          : "dispatch-route",
    receipts
  };
}

function pathWithinPrefixes(path, prefixes) {
  return prefixes.includes("") || prefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

function normalizeArtifactRoot(input, now) {
  const root = input && typeof input.root === "object" && input.root !== null ? input.root : {};
  const uri = typeof root.uri === "string" && root.uri.length > 0 ? root.uri : DEFAULT_ROOT_URI;
  const owner = typeof root.owner === "string" && root.owner.length > 0 ? root.owner : "hosted-kernel";
  const namespace = typeof root.namespace === "string" && root.namespace.length > 0 ? root.namespace : "default";
  const generation = Number.isInteger(root.generation) && root.generation >= 0 ? root.generation : 0;
  const lastMutation = typeof root.lastMutation === "string" && WRITABLE_MUTATIONS.has(root.lastMutation)
    ? root.lastMutation
    : "update";

  return {
    uri,
    owner,
    namespace,
    generation,
    lastMutation,
    mountedAt: toIsoTimestamp(root.mountedAt, now)
  };
}

function buildWorkspaceScope(input, root) {
  const workspace = input && typeof input.workspace === "object" && input.workspace !== null ? input.workspace : {};
  const tenantId = typeof workspace.tenantId === "string" && workspace.tenantId.length > 0
    ? workspace.tenantId
    : root.owner;
  const workspaceId = typeof workspace.workspaceId === "string" && workspace.workspaceId.length > 0
    ? workspace.workspaceId
    : root.namespace;
  const requestedPrefixes = normalizeStringList(workspace.allowedPrefixes).map(normalizeBoundaryPrefix);
  const allowedPrefixes = requestedPrefixes.length > 0 ? requestedPrefixes : [""];
  const boundaryMode = workspace.boundaryMode === "advisory" ? "advisory" : "enforced";

  return {
    contractVersion: "artifact-root.workspace-scope.v1",
    tenantId,
    workspaceId,
    boundaryMode,
    allowedPrefixes,
    explicitBoundary: requestedPrefixes.length > 0,
    scopeKey: `${tenantId}:${workspaceId}`,
    rootNamespaceMatches: workspaceId === root.namespace
  };
}

function buildPermissionContract(input, workspaceScope) {
  const principal = input && typeof input.principal === "object" && input.principal !== null ? input.principal : {};
  const principalId = typeof principal.principalId === "string" && principal.principalId.length > 0
    ? principal.principalId
    : "hosted-kernel";
  const tenantId = typeof principal.tenantId === "string" && principal.tenantId.length > 0
    ? principal.tenantId
    : workspaceScope.tenantId;
  const roles = normalizeStringList(principal.roles).filter((role) => TENANT_ROLES.has(role));
  const effectiveRoles = roles.length > 0 ? roles : ["owner"];
  const explicitPermissions = normalizeStringList(principal.permissions)
    .filter((permission) => HOSTED_KERNEL_CAPABILITIES.includes(permission));
  const rolePermissions = effectiveRoles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const allowedPermissions = normalizeStringList([...rolePermissions, ...explicitPermissions]);
  const workspaceIds = normalizeStringList(principal.workspaceIds);
  const tenantMatches = tenantId === workspaceScope.tenantId;
  const workspaceMatches = workspaceIds.length === 0 || workspaceIds.includes(workspaceScope.workspaceId);
  const boundaryFailures = [
    ...(!tenantMatches ? [{
      code: "tenant-mismatch",
      detail: `${tenantId}:${workspaceScope.tenantId}`
    }] : []),
    ...(!workspaceMatches ? [{
      code: "workspace-not-granted",
      detail: workspaceScope.workspaceId
    }] : [])
  ];
  const scoped = boundaryFailures.length === 0;

  return {
    contractVersion: "artifact-root.permission-boundary.v1",
    principalId,
    tenantId,
    roles: effectiveRoles,
    workspaceIds,
    allowedPermissions,
    scoped,
    canDescribe: scoped && allowedPermissions.includes("artifact.root.describe"),
    canRead: scoped && allowedPermissions.includes("artifact.root.sync.read"),
    canWrite: scoped && allowedPermissions.includes("artifact.root.sync.write"),
    canHandoff: scoped && allowedPermissions.includes("artifact.root.handoff.external"),
    canAudit: scoped && allowedPermissions.includes("artifact.root.audit.proof"),
    boundaryFailures
  };
}

function normalizeProviders(input) {
  const providers = Array.isArray(input.providers) ? input.providers : [];
  const normalized = providers
    .filter((provider) => provider && typeof provider === "object")
    .map((provider, index) => {
      const providerId = typeof provider.providerId === "string" && provider.providerId.length > 0
        ? provider.providerId
        : `${DEFAULT_PROVIDER_ID}-${index + 1}`;
      const capabilities = normalizeStringList(provider.capabilities);
      const mode = provider.mode === "read-only" ? "read-only" : "read-write";
      return {
        providerId,
        mode,
        capabilities,
        acceptsExternalHandoff: Boolean(provider.acceptsExternalHandoff),
        priority: Number.isFinite(provider.priority) ? provider.priority : index + 1
      };
    })
    .sort((a, b) => a.priority - b.priority || a.providerId.localeCompare(b.providerId));

  if (normalized.length > 0) {
    return normalized;
  }

  return [{
    providerId: DEFAULT_PROVIDER_ID,
    mode: "read-write",
    capabilities: [...HOSTED_KERNEL_CAPABILITIES],
    acceptsExternalHandoff: true,
    priority: 1
  }];
}

function negotiateCapabilities(input, providers, permissionContract) {
  const requested = normalizeStringList(input.requestedCapabilities);
  const hosted = new Set(HOSTED_KERNEL_CAPABILITIES);
  const providerCapabilities = new Set(providers.flatMap((provider) => provider.capabilities));
  const required = requested.length > 0 ? requested : [...HOSTED_KERNEL_CAPABILITIES];
  const permissionCapabilities = new Set(permissionContract.allowedPermissions);
  const granted = required.filter((capability) => (
    hosted.has(capability)
    && providerCapabilities.has(capability)
    && permissionContract.scoped
    && permissionCapabilities.has(capability)
  ));
  const denied = required
    .filter((capability) => !granted.includes(capability))
    .map((capability) => ({
      capability,
      reason: !hosted.has(capability)
        ? "unsupported-by-hosted-kernel"
        : !providerCapabilities.has(capability)
          ? "no-provider-advertised-capability"
          : !permissionContract.scoped
            ? "principal-outside-workspace-boundary"
            : "principal-missing-permission"
    }));

  return {
    contractVersion: ARTIFACT_ROOT_CONTRACT_VERSION,
    requested,
    advertised: [...HOSTED_KERNEL_CAPABILITIES],
    granted,
    denied,
    principalId: permissionContract.principalId,
    workspaceScoped: permissionContract.scoped,
    writable: granted.includes("artifact.root.sync.write")
  };
}

function buildSyncMetadata(input, root, now) {
  const sync = input && typeof input.sync === "object" && input.sync !== null ? input.sync : {};
  const cursor = typeof sync.cursor === "string" && sync.cursor.length > 0
    ? sync.cursor
    : `${root.namespace}:${root.generation}`;
  const dirtyPaths = normalizeStringList(sync.dirtyPaths);
  const conflictPaths = normalizeStringList(sync.conflictPaths);

  return {
    cursor,
    rootGeneration: root.generation,
    lastSyncedAt: toIsoTimestamp(sync.lastSyncedAt, now),
    dirtyPaths,
    conflictPaths,
    clean: dirtyPaths.length === 0 && conflictPaths.length === 0,
    policy: sync.policy === "external-authoritative" ? "external-authoritative" : "hosted-kernel-authoritative"
  };
}

function normalizeJournalEntries(value, now) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const commandType = typeof entry.commandType === "string" && COMMAND_TYPES.has(entry.commandType)
        ? entry.commandType
        : "sync";
      const state = typeof entry.state === "string" && JOURNAL_ENTRY_STATES.has(entry.state)
        ? entry.state
        : "pending";
      const sequence = Number.isInteger(entry.sequence) && entry.sequence >= 0 ? entry.sequence : index + 1;
      return {
        sequence,
        commandId: normalizeCommandId(entry.commandId, `${commandType}:${sequence}`),
        commandType,
        state,
        cursor: typeof entry.cursor === "string" && entry.cursor.length > 0 ? entry.cursor : null,
        recordedAt: toIsoTimestamp(entry.recordedAt, now),
        pathCount: Array.isArray(entry.paths) ? normalizeStringList(entry.paths).length : 0
      };
    })
    .sort((a, b) => a.sequence - b.sequence || a.commandId.localeCompare(b.commandId));
}

function buildPersistedCommandLedger(persisted, journal, checkpointCursor, now) {
  const appliedCommandIds = normalizeStringList(persisted.appliedCommandIds);
  const inflightCommandIds = normalizeStringList(persisted.inflightCommandIds);
  const commandLeases = persisted.commandLeases && typeof persisted.commandLeases === "object"
    ? persisted.commandLeases
    : {};
  const ledgerByCommandId = new Map();
  const duplicateCommandIds = new Set();

  const upsertLedgerEntry = (commandId, patch) => {
    const existing = ledgerByCommandId.get(commandId);
    if (existing) {
      duplicateCommandIds.add(commandId);
      ledgerByCommandId.set(commandId, {
        ...existing,
        ...patch,
        sources: normalizeStringList([...(existing.sources || []), ...(patch.sources || [])]),
        duplicateCount: existing.duplicateCount + 1,
        state: existing.state === patch.state ? existing.state : "duplicate"
      });
      return;
    }

    ledgerByCommandId.set(commandId, {
      commandId,
      commandType: patch.commandType || "sync",
      state: COMMAND_LEDGER_STATES.has(patch.state) ? patch.state : "new",
      cursor: patch.cursor || checkpointCursor,
      sequence: Number.isInteger(patch.sequence) ? patch.sequence : null,
      recordedAt: toIsoTimestamp(patch.recordedAt, now),
      leaseExpiresAt: patch.leaseExpiresAt || null,
      sources: normalizeStringList(patch.sources || []),
      duplicateCount: 0
    });
  };

  for (const commandId of appliedCommandIds) {
    upsertLedgerEntry(commandId, {
      state: "applied",
      cursor: checkpointCursor,
      recordedAt: now,
      sources: ["appliedCommandIds"]
    });
  }

  for (const commandId of inflightCommandIds) {
    const lease = commandLeases[commandId] && typeof commandLeases[commandId] === "object"
      ? commandLeases[commandId]
      : {};
    upsertLedgerEntry(commandId, {
      state: "inflight",
      cursor: typeof lease.cursor === "string" && lease.cursor.length > 0 ? lease.cursor : checkpointCursor,
      recordedAt: lease.startedAt || now,
      leaseExpiresAt: typeof lease.expiresAt === "string" ? toIsoTimestamp(lease.expiresAt, now) : null,
      sources: ["inflightCommandIds"]
    });
  }

  for (const entry of journal) {
    upsertLedgerEntry(entry.commandId, {
      commandType: entry.commandType,
      state: entry.state === "pending" ? "replayable" : entry.state,
      cursor: entry.cursor || checkpointCursor,
      sequence: entry.sequence,
      recordedAt: entry.recordedAt,
      sources: ["journal"]
    });
  }

  const nowMs = Date.parse(now);
  const entries = [...ledgerByCommandId.values()]
    .map((entry) => {
      const leaseMs = entry.leaseExpiresAt ? Date.parse(entry.leaseExpiresAt) : null;
      const leaseExpired = entry.state === "inflight" && Number.isFinite(leaseMs) && leaseMs <= nowMs;
      return {
        ...entry,
        state: leaseExpired ? "replayable" : entry.state,
        leaseExpired,
        replayEligible: ["replayable", "duplicate"].includes(leaseExpired ? "replayable" : entry.state)
      };
    })
    .sort((a, b) => (
      (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER)
      || a.recordedAt.localeCompare(b.recordedAt)
      || a.commandId.localeCompare(b.commandId)
    ));
  const replayQueue = entries
    .filter((entry) => entry.replayEligible)
    .map((entry) => ({
      commandId: entry.commandId,
      commandType: entry.commandType,
      cursor: entry.cursor,
      sequence: entry.sequence,
      source: entry.sources.includes("journal") ? "journal" : "lease-expiry"
    }));

  return {
    contractVersion: "artifact-root.persisted-command-ledger.v1",
    entries,
    replayQueue,
    appliedCommandIds,
    inflightCommandIds,
    duplicateCommandIds: [...duplicateCommandIds].sort(),
    expiredLeaseCommandIds: entries.filter((entry) => entry.leaseExpired).map((entry) => entry.commandId),
    replayQueueCount: replayQueue.length,
    duplicateCount: duplicateCommandIds.size,
    ledgerDigest: stableProofId(entries.map((entry) => [
      entry.commandId,
      entry.state,
      entry.cursor,
      entry.sequence,
      entry.sources
    ]))
  };
}

function normalizePersistedState(input, root, syncMetadata, now) {
  const persisted = input && typeof input.persistedState === "object" && input.persistedState !== null
    ? input.persistedState
    : {};
  const appliedCommandIds = normalizeStringList(persisted.appliedCommandIds);
  const inflightCommandIds = normalizeStringList(persisted.inflightCommandIds);
  const journal = normalizeJournalEntries(persisted.journal, now);
  const checkpointCursor = typeof persisted.checkpointCursor === "string" && persisted.checkpointCursor.length > 0
    ? persisted.checkpointCursor
    : syncMetadata.cursor;
  const checkpointGeneration = Number.isInteger(persisted.checkpointGeneration) && persisted.checkpointGeneration >= 0
    ? persisted.checkpointGeneration
    : root.generation;
  const status = typeof persisted.restartStatus === "string" && RESTART_STATUS.has(persisted.restartStatus)
    ? persisted.restartStatus
    : "clean";
  const pendingJournal = journal.filter((entry) => entry.state === "pending");
  const failedJournal = journal.filter((entry) => entry.state === "failed");
  const commandLedger = buildPersistedCommandLedger(persisted, journal, checkpointCursor, now);
  const cursorMatches = checkpointCursor === syncMetadata.cursor;
  const generationMatches = checkpointGeneration === root.generation;
  const restartEpoch = normalizeNonNegativeInteger(persisted.restartEpoch, 0);
  const safeRestartStatus = failedJournal.length > 0
    ? "blocked"
    : commandLedger.replayQueueCount > 0 || pendingJournal.length > 0 || !cursorMatches || !generationMatches
      ? "needs-recovery"
      : status === "replaying"
        ? "replaying"
        : "clean";

  return {
    contractVersion: "artifact-root.persisted-state.v1",
    checkpointCursor,
    checkpointGeneration,
    lastCheckpointAt: toIsoTimestamp(persisted.lastCheckpointAt, now),
    restartStatus: status,
    safeRestartStatus,
    restartEpoch,
    appliedCommandIds: commandLedger.appliedCommandIds,
    inflightCommandIds: commandLedger.inflightCommandIds,
    journal,
    commandLedger,
    durable: cursorMatches && generationMatches && failedJournal.length === 0 && commandLedger.duplicateCount === 0,
    replayRequired: safeRestartStatus !== "clean" || commandLedger.replayQueueCount > 0,
    pendingJournalCount: pendingJournal.length,
    failedJournalCount: failedJournal.length,
    replayQueueCount: commandLedger.replayQueueCount,
    duplicateCommandCount: commandLedger.duplicateCount,
    expiredLeaseCommandCount: commandLedger.expiredLeaseCommandIds.length,
    cursorMatches,
    generationMatches
  };
}

function buildRecoveryContract(persistedState, syncMetadata, externalHandoff) {
  const recoverySteps = [];

  if (!persistedState.cursorMatches || !persistedState.generationMatches) {
    recoverySteps.push({
      action: "restore-checkpoint",
      reason: "persisted-checkpoint-diverged-from-active-root"
    });
  }
  if (persistedState.pendingJournalCount > 0 || persistedState.replayQueueCount > 0) {
    recoverySteps.push({
      action: "replay-journal",
      reason: persistedState.expiredLeaseCommandCount > 0
        ? "pending-journal-or-expired-command-leases"
        : "pending-journal-entries"
    });
  }
  if (persistedState.duplicateCommandCount > 0) {
    recoverySteps.push({
      action: "dedupe-command-ledger",
      reason: "duplicate-command-records"
    });
  }
  if (persistedState.failedJournalCount > 0) {
    recoverySteps.push({
      action: "quarantine-failed-entries",
      reason: "failed-journal-entries"
    });
  }
  if (syncMetadata.conflictPaths.length > 0) {
    recoverySteps.push({
      action: "hold-writes",
      reason: "sync-conflicts-present"
    });
  }
  if (externalHandoff.requiresAck) {
    recoverySteps.push({
      action: "reconcile-external-handoff",
      reason: `handoff-${externalHandoff.state}`
    });
  }

  const blocked = persistedState.failedJournalCount > 0 || syncMetadata.conflictPaths.length > 0;
  const restartSafeStatus = blocked
    ? "blocked"
    : persistedState.safeRestartStatus === "replaying"
      ? "replaying"
      : recoverySteps.length > 0
      ? "needs-recovery"
      : "clean";
  const replayQueue = persistedState.commandLedger.replayQueue.map((entry, index) => ({
    ...entry,
    replayOrder: index + 1,
    idempotencyKey: `${persistedState.checkpointCursor}:${entry.commandId}`
  }));

  return {
    contractVersion: "artifact-root.recovery.v1",
    restartSafeStatus,
    recoveredCursor: persistedState.checkpointCursor,
    replayableCommandIds: replayQueue.map((entry) => entry.commandId),
    replayQueue,
    recoverySteps,
    canResumeWrites: restartSafeStatus === "clean",
    nextPersistedStatePatch: {
      restartEpoch: persistedState.restartEpoch + (restartSafeStatus === "clean" ? 0 : 1),
      restartStatus: restartSafeStatus,
      checkpointCursor: persistedState.checkpointCursor,
      checkpointGeneration: persistedState.checkpointGeneration,
      inflightCommandIds: restartSafeStatus === "needs-recovery"
        ? replayQueue.map((entry) => entry.commandId)
        : persistedState.inflightCommandIds,
      commandLedgerDigest: persistedState.commandLedger.ledgerDigest
    },
    proof: {
      checkpointDurable: persistedState.durable,
      replayRequired: persistedState.replayRequired,
      syncClean: syncMetadata.clean,
      commandLedgerDigest: persistedState.commandLedger.ledgerDigest,
      duplicateCommandCount: persistedState.duplicateCommandCount,
      expiredLeaseCommandCount: persistedState.expiredLeaseCommandCount
    }
  };
}

function inspectLifecycleCronExpression(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      expression: "",
      valid: false,
      reason: "missing-cron-expression"
    };
  }

  const expression = value.trim().replace(/\s+/g, " ");
  const fields = expression.split(" ");
  const invalidCharacters = /[^A-Za-z0-9*,/?#L\-\s]/.test(expression);
  const supportedFieldCount = fields.length === 5 || fields.length === 6;

  return {
    expression,
    valid: supportedFieldCount && !invalidCharacters,
    reason: !supportedFieldCount
      ? "cron-field-count-unsupported"
      : invalidCharacters
        ? "cron-expression-contains-unsupported-character"
        : null,
    fieldCount: fields.length
  };
}

function buildLifecycleScheduleReadiness(schedule, generatedAt) {
  const generatedMs = Date.parse(generatedAt);
  const nextRunMs = schedule.nextRunAt ? Date.parse(schedule.nextRunAt) : null;
  const lastRunMs = schedule.lastRunAt ? Date.parse(schedule.lastRunAt) : null;
  const intervalElapsed = schedule.mode === "interval"
    && Number.isInteger(schedule.intervalMs)
    && Number.isFinite(lastRunMs)
    && generatedMs - lastRunMs >= schedule.intervalMs;
  const nextRunDue = Number.isFinite(nextRunMs) && nextRunMs <= generatedMs;
  const nextRunDelayMs = Number.isFinite(nextRunMs) ? Math.max(nextRunMs - generatedMs, 0) : null;
  const missingScheduleAnchor = ["interval", "cron"].includes(schedule.mode)
    && schedule.nextRunAt === null
    && schedule.lastRunAt === null;
  const dueNow = schedule.mode === "manual"
    || nextRunDue
    || intervalElapsed
    || (schedule.mode === "interval" && missingScheduleAnchor);
  const blockedReason = schedule.mode === "paused"
    ? "schedule-paused"
    : schedule.mode === "maintenance"
      ? "schedule-maintenance"
      : Number.isFinite(nextRunMs) && nextRunMs > generatedMs
        ? `scheduled-for:${schedule.nextRunAt}`
        : schedule.mode === "cron" && schedule.nextRunAt === null
          ? "cron-next-run-not-resolved"
          : null;
  const dueReason = schedule.mode === "manual"
    ? "manual"
    : nextRunDue
      ? "next-run-due"
      : intervalElapsed
        ? "interval-elapsed"
        : schedule.mode === "interval" && missingScheduleAnchor
          ? "interval-first-run"
          : null;

  return {
    ready: dueNow && blockedReason === null,
    dueNow: dueNow && blockedReason === null,
    dueReason,
    blockedReason,
    nextRunDelayMs,
    clockSkewMs: Number.isFinite(lastRunMs) && lastRunMs > generatedMs ? lastRunMs - generatedMs : 0,
    anchor: {
      evaluatedAt: generatedAt,
      lastRunAt: schedule.lastRunAt,
      nextRunAt: schedule.nextRunAt,
      intervalMs: schedule.intervalMs,
      cursor: schedule.cursor
    }
  };
}

function normalizeLifecycleControlRequest(settings, schedule, generatedAt) {
  const control = settings && typeof settings.control === "object" && settings.control !== null
    ? settings.control
    : settings && typeof settings.command === "object" && settings.command !== null
      ? settings.command
      : {};
  const action = typeof control.action === "string" && LIFECYCLE_CONTROL_ACTIONS.has(control.action)
    ? control.action
    : null;
  const minIntervalMs = normalizeNonNegativeInteger(schedule.minIntervalMs, 60_000);
  const requestedIntervalMs = Math.max(normalizeNonNegativeInteger(control.intervalMs, schedule.intervalMs || minIntervalMs), minIntervalMs);
  const requestedCronExpression = typeof control.cronExpression === "string" ? control.cronExpression.trim() : "";
  const requestedNextRunAt = typeof control.nextRunAt === "string"
    ? toIsoTimestamp(control.nextRunAt, generatedAt)
    : generatedAt;
  const resumeMode = typeof control.resumeMode === "string"
    && LIFECYCLE_SCHEDULE_MODES.has(control.resumeMode)
    && !["paused", "maintenance"].includes(control.resumeMode)
    ? control.resumeMode
    : "manual";
  const requestedBy = typeof control.requestedBy === "string" && control.requestedBy.length > 0
    ? control.requestedBy
    : "hosted-kernel";
  const patchByAction = {
    "enable-artifact-root": { enablement: "enabled", enabled: true },
    "disable-artifact-root": { enablement: "disabled", enabled: false },
    "enable-writes": { enablement: "enabled", enabled: true },
    "set-read-only": { enablement: "read-only", enabled: true },
    "pause-schedule": { schedule: { mode: "paused" } },
    "resume-schedule": { schedule: { mode: resumeMode } },
    "set-interval-schedule": { schedule: { mode: "interval", intervalMs: requestedIntervalMs, minIntervalMs } },
    "set-cron-schedule": { schedule: { mode: "cron", cronExpression: requestedCronExpression } },
    "run-now": { schedule: { mode: schedule.mode === "maintenance" ? "maintenance" : "manual", nextRunAt: generatedAt } },
    "enter-maintenance": { schedule: { mode: "maintenance" } },
    "exit-maintenance": { schedule: { mode: resumeMode, nextRunAt: requestedNextRunAt } }
  };
  const patch = action ? patchByAction[action] : null;
  const validationErrors = [
    ...(control.action && !action ? ["control-action-unsupported"] : []),
    ...(action === "set-cron-schedule" && requestedCronExpression.length === 0 ? ["control-missing-cron-expression"] : []),
    ...(action === "set-interval-schedule" && requestedIntervalMs < minIntervalMs ? ["control-interval-below-minimum"] : []),
    ...(action === "run-now" && schedule.mode === "maintenance" ? ["control-run-now-blocked-by-maintenance"] : [])
  ];

  return {
    action,
    requestedBy,
    requestedAt: typeof control.requestedAt === "string" ? toIsoTimestamp(control.requestedAt, generatedAt) : generatedAt,
    patch,
    validationErrors,
    idempotencyKey: action
      ? stableProofId([action, requestedBy, JSON.stringify(patch), schedule.cursor || generatedAt])
      : null
  };
}

function buildLifecycleSettingsControl(input, syncMetadata, permissionContract, generatedAt) {
  const settings = input && typeof input.lifecycleSettings === "object" && input.lifecycleSettings !== null
    ? input.lifecycleSettings
    : input && typeof input.lifecycle === "object" && input.lifecycle !== null
      ? input.lifecycle
      : {};
  const schedule = settings && typeof settings.schedule === "object" && settings.schedule !== null
    ? settings.schedule
    : {};
  const requestedEnablement = typeof settings.enablement === "string" && LIFECYCLE_ENABLEMENT_STATES.has(settings.enablement)
    ? settings.enablement
    : settings.enabled === false
      ? "disabled"
      : "enabled";
  const requestedMode = typeof schedule.mode === "string" && LIFECYCLE_SCHEDULE_MODES.has(schedule.mode)
    ? schedule.mode
    : "manual";
  const minIntervalMs = normalizeNonNegativeInteger(schedule.minIntervalMs, 60_000);
  const intervalMs = requestedMode === "interval"
    ? Math.max(normalizeNonNegativeInteger(schedule.intervalMs, minIntervalMs), minIntervalMs)
    : null;
  const cronExpression = requestedMode === "cron" && typeof schedule.cronExpression === "string"
    ? schedule.cronExpression.trim()
    : null;
  const cronDiagnostics = requestedMode === "cron"
    ? inspectLifecycleCronExpression(cronExpression)
    : {
      expression: cronExpression || "",
      valid: true,
      reason: null,
      fieldCount: 0
    };
  const nextRunAt = typeof schedule.nextRunAt === "string"
    ? toIsoTimestamp(schedule.nextRunAt, generatedAt)
    : null;
  const lastRunAt = typeof schedule.lastRunAt === "string"
    ? toIsoTimestamp(schedule.lastRunAt, generatedAt)
    : null;
  const generatedMs = Date.parse(generatedAt);
  const nextRunMs = nextRunAt ? Date.parse(nextRunAt) : null;
  const futureScheduled = Number.isFinite(nextRunMs) && nextRunMs > generatedMs;
  const normalizedSchedule = {
    mode: requestedMode,
    intervalMs,
    minIntervalMs,
    cronExpression: requestedMode === "cron" ? cronDiagnostics.expression : cronExpression,
    lastRunAt,
    nextRunAt,
    cursor: syncMetadata.cursor
  };
  const scheduleReadiness = buildLifecycleScheduleReadiness(normalizedSchedule, generatedAt);
  normalizedSchedule.dueNow = scheduleReadiness.dueNow;
  normalizedSchedule.ready = scheduleReadiness.ready;
  normalizedSchedule.dueReason = scheduleReadiness.dueReason;
  normalizedSchedule.nextRunDelayMs = scheduleReadiness.nextRunDelayMs;
  normalizedSchedule.blockedReason = scheduleReadiness.blockedReason;
  normalizedSchedule.clockSkewMs = scheduleReadiness.clockSkewMs;
  const controlRequest = normalizeLifecycleControlRequest(settings, normalizedSchedule, generatedAt);
  const validationErrors = [
    ...(requestedMode === "cron" && !cronExpression ? ["missing-cron-expression"] : []),
    ...(requestedMode === "cron" && cronDiagnostics.reason ? [cronDiagnostics.reason] : []),
    ...(requestedMode === "interval" && intervalMs === 0 ? ["interval-must-be-positive"] : []),
    ...(scheduleReadiness.clockSkewMs > 0 ? ["last-run-after-evaluation-time"] : []),
    ...(nextRunAt && lastRunAt && nextRunAt < lastRunAt ? ["next-run-before-last-run"] : []),
    ...(!permissionContract.canDescribe ? ["principal-cannot-describe-lifecycle"] : []),
    ...controlRequest.validationErrors
  ];
  const controlMutationBlockedReasons = [
    ...(!permissionContract.canWrite ? ["principal-cannot-mutate-lifecycle"] : []),
    ...(!permissionContract.scoped ? ["principal-outside-workspace-boundary"] : [])
  ];
  const commandGateReasons = normalizeStringList([
    ...(requestedEnablement === "disabled" ? ["lifecycle-disabled"] : []),
    ...(requestedEnablement === "read-only" ? ["lifecycle-read-only"] : []),
    ...(requestedMode === "paused" ? ["schedule-paused"] : []),
    ...(requestedMode === "maintenance" ? ["schedule-maintenance"] : []),
    ...(scheduleReadiness.blockedReason ? [scheduleReadiness.blockedReason] : []),
    ...validationErrors.map((error) => `settings-invalid:${error}`)
  ]);
  const runnableNow = commandGateReasons.length === 0;
  const nextActionState = validationErrors.length > 0
    ? {
      action: "fix-lifecycle-settings",
      route: CLIENT_ROUTE_BY_ACTION.refresh,
      executable: false,
      reason: validationErrors.join("|"),
      patch: null,
      scheduledFor: null
    }
    : requestedEnablement === "disabled"
      ? {
        action: "enable-artifact-root",
        route: CLIENT_ROUTE_BY_ACTION.refresh,
        executable: permissionContract.canWrite,
        reason: "lifecycle-disabled",
        patch: { enablement: "enabled", enabled: true },
        scheduledFor: null
      }
      : requestedEnablement === "read-only"
        ? {
          action: "enable-writes",
          route: CLIENT_ROUTE_BY_ACTION.refresh,
          executable: permissionContract.canWrite,
          reason: "lifecycle-read-only",
          patch: { enablement: "enabled", enabled: true },
          scheduledFor: null
        }
        : requestedMode === "paused" || requestedMode === "maintenance"
          ? {
            action: "resume-schedule",
            route: CLIENT_ROUTE_BY_ACTION.refresh,
            executable: permissionContract.canWrite,
            reason: requestedMode === "maintenance" ? "schedule-maintenance" : "schedule-paused",
            patch: { schedule: { mode: "manual" } },
            scheduledFor: null
          }
          : futureScheduled
            ? {
              action: "wait-for-schedule",
              route: CLIENT_ROUTE_BY_ACTION.refresh,
              executable: false,
              reason: scheduleReadiness.blockedReason,
              patch: null,
              scheduledFor: nextRunAt
            }
            : !scheduleReadiness.ready
              ? {
                action: "resolve-schedule-anchor",
                route: CLIENT_ROUTE_BY_ACTION.refresh,
                executable: permissionContract.canWrite,
                reason: scheduleReadiness.blockedReason || "schedule-not-due",
                patch: requestedMode === "cron" ? { schedule: { mode: "cron", nextRunAt: generatedAt } } : null,
                scheduledFor: null
              }
              : {
                action: "run-command",
                route: CLIENT_ROUTE_BY_ACTION.apply,
                executable: true,
                reason: scheduleReadiness.dueReason || "schedule-ready",
                patch: null,
                scheduledFor: null
              };
  const buildControlCommand = (action, patch, extraBlockedReasons = []) => {
    const blockedReasons = [
      ...controlMutationBlockedReasons,
      ...extraBlockedReasons
    ];

    return {
      action,
      route: CLIENT_ROUTE_BY_ACTION.refresh,
      enabled: blockedReasons.length === 0,
      blockedReasons,
      patch,
      idempotencyKey: stableProofId([
        action,
        permissionContract.principalId,
        syncMetadata.cursor,
        JSON.stringify(patch)
      ])
    };
  };
  const availableControls = [
    buildControlCommand("enable-artifact-root", { enablement: "enabled", enabled: true }, requestedEnablement === "enabled" ? ["already-enabled"] : []),
    buildControlCommand("disable-artifact-root", { enablement: "disabled", enabled: false }, requestedEnablement === "disabled" ? ["already-disabled"] : []),
    buildControlCommand("enable-writes", { enablement: "enabled", enabled: true }, requestedEnablement !== "read-only" ? ["not-read-only"] : []),
    buildControlCommand("set-read-only", { enablement: "read-only", enabled: true }, requestedEnablement === "read-only" ? ["already-read-only"] : []),
    buildControlCommand("pause-schedule", { schedule: { mode: "paused" } }, requestedMode === "paused" ? ["already-paused"] : []),
    buildControlCommand("resume-schedule", { schedule: { mode: "manual" } }, !["paused", "maintenance"].includes(requestedMode) ? ["schedule-already-active"] : []),
    buildControlCommand("run-now", { schedule: { mode: "manual", nextRunAt: generatedAt } }, requestedMode === "maintenance" ? ["schedule-maintenance"] : []),
    buildControlCommand("enter-maintenance", { schedule: { mode: "maintenance" } }, requestedMode === "maintenance" ? ["already-maintenance"] : [])
  ];
  const requestedControlCommand = controlRequest.action
    ? buildControlCommand(
      controlRequest.action,
      controlRequest.patch,
      controlRequest.validationErrors.map((error) => `settings-invalid:${error}`)
    )
    : null;
  const lifecycleSettingsDigest = stableProofId([
    requestedEnablement,
    requestedMode,
    intervalMs,
    cronExpression,
    nextRunAt,
    lastRunAt,
    controlRequest.action,
    controlRequest.idempotencyKey
  ]);

  return {
    contractVersion: "artifact-root.lifecycle-settings.v1",
    enablement: requestedEnablement,
    enabled: requestedEnablement === "enabled",
    writesEnabled: requestedEnablement === "enabled",
    readsEnabled: requestedEnablement !== "disabled",
    schedule: normalizedSchedule,
    validation: {
      valid: validationErrors.length === 0,
      errors: validationErrors,
      cron: cronDiagnostics,
      scheduleReady: scheduleReadiness.ready,
      scheduleBlockedReason: scheduleReadiness.blockedReason
    },
    controls: {
      requested: controlRequest,
      requestedExecutable: Boolean(requestedControlCommand && requestedControlCommand.enabled),
      requestedBlockedReasons: requestedControlCommand ? requestedControlCommand.blockedReasons : [],
      availableActions: availableControls,
      nextSettingsPatch: requestedControlCommand && requestedControlCommand.enabled ? requestedControlCommand.patch : null
    },
    commandGate: {
      runnableNow,
      blockedReasons: commandGateReasons,
      nextAction: nextActionState.action,
      nextActionState
    },
    proof: {
      scoped: permissionContract.scoped,
      canWrite: permissionContract.canWrite,
      syncCursor: syncMetadata.cursor,
      evaluatedAt: generatedAt,
      settingsDigest: lifecycleSettingsDigest,
      requestedControlIdempotencyKey: controlRequest.idempotencyKey,
      scheduleDigest: stableProofId([
        normalizedSchedule.mode,
        normalizedSchedule.dueNow,
        normalizedSchedule.dueReason,
        normalizedSchedule.blockedReason,
        normalizedSchedule.nextRunAt,
        normalizedSchedule.lastRunAt,
        normalizedSchedule.intervalMs,
        normalizedSchedule.cronExpression
      ])
    }
  };
}

function buildIdempotentCommandContract(input, persistedState, recoveryContract, capabilityContract, acceptanceContract, lifecycleSettingsControl) {
  const command = input && typeof input.command === "object" && input.command !== null ? input.command : {};
  const commandType = typeof command.type === "string" && COMMAND_TYPES.has(command.type) ? command.type : "sync";
  const commandId = normalizeCommandId(command.commandId, `${commandType}:${persistedState.checkpointCursor}`);
  const alreadyApplied = persistedState.appliedCommandIds.includes(commandId)
    || persistedState.journal.some((entry) => entry.commandId === commandId && entry.state === "applied");
  const inFlight = persistedState.inflightCommandIds.includes(commandId)
    || persistedState.journal.some((entry) => entry.commandId === commandId && entry.state === "pending");
  const writeCommand = commandType === "commit" || commandType === "sync";
  const blockedReasons = [
    ...(!capabilityContract.writable && writeCommand ? ["missing-write-capability"] : []),
    ...(recoveryContract.restartSafeStatus === "blocked" ? ["recovery-blocked"] : []),
    ...(commandType === "commit" && !acceptanceContract.readyForCommit ? ["acceptance-not-ready"] : []),
    ...(writeCommand ? lifecycleSettingsControl.commandGate.blockedReasons : [])
  ];
  const status = alreadyApplied
    ? "already-applied"
    : blockedReasons.length > 0
      ? "blocked"
      : inFlight || recoveryContract.restartSafeStatus === "needs-recovery"
        ? "resume-or-replay"
        : "ready";

  return {
    contractVersion: "artifact-root.idempotent-command.v1",
    commandId,
    commandType,
    idempotencyKey: `${persistedState.checkpointCursor}:${commandId}`,
    status,
    alreadyApplied,
    inFlight,
    canExecute: status === "ready",
    canReplay: status === "resume-or-replay",
    blockedReasons,
    lifecycleGate: {
      enablement: lifecycleSettingsControl.enablement,
      scheduleMode: lifecycleSettingsControl.schedule.mode,
      runnableNow: lifecycleSettingsControl.commandGate.runnableNow,
      nextAction: lifecycleSettingsControl.commandGate.nextAction,
      nextActionState: lifecycleSettingsControl.commandGate.nextActionState,
      dueReason: lifecycleSettingsControl.schedule.dueReason,
      nextRunDelayMs: lifecycleSettingsControl.schedule.nextRunDelayMs
    },
    resultCursor: alreadyApplied ? persistedState.checkpointCursor : null
  };
}

function normalizePersistedWriteAcks(value, now) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((ack) => ack && typeof ack === "object")
    .map((ack, index) => {
      const state = typeof ack.state === "string" && PERSISTED_WRITE_STATES.has(ack.state)
        ? ack.state
        : "pending";
      const commandId = normalizeCommandId(ack.commandId, `persisted-write:${index + 1}`);
      const idempotencyKey = typeof ack.idempotencyKey === "string" && ack.idempotencyKey.length > 0
        ? ack.idempotencyKey
        : `${commandId}:${state}`;

      return {
        commandId,
        state,
        idempotencyKey,
        persistedAt: toIsoTimestamp(ack.persistedAt, now),
        cursor: typeof ack.cursor === "string" && ack.cursor.length > 0 ? ack.cursor : null,
        reason: typeof ack.reason === "string" && ack.reason.length > 0 ? ack.reason : null
      };
    })
    .sort((a, b) => a.commandId.localeCompare(b.commandId) || a.idempotencyKey.localeCompare(b.idempotencyKey));
}

function buildRestartPersistencePlan(input, persistedState, recoveryContract, idempotentCommand, syncMetadata, now) {
  const persisted = input && typeof input.persistedState === "object" && input.persistedState !== null
    ? input.persistedState
    : {};
  const writeAcks = normalizePersistedWriteAcks(
    Array.isArray(persisted.writeAcks) ? persisted.writeAcks : persisted.persistedWrites,
    now
  );
  const ackByCommandId = new Map(writeAcks.map((ack) => [ack.commandId, ack]));
  const replayQueue = recoveryContract.replayQueue.map((entry) => {
    const ack = ackByCommandId.get(entry.commandId) || null;
    const journalState = ack
      ? ack.state === "persisted"
        ? "applied"
        : ack.state === "failed"
          ? "failed"
          : "pending"
      : "pending";

    return {
      commandId: entry.commandId,
      commandType: entry.commandType,
      replayOrder: entry.replayOrder,
      cursor: ack?.cursor || entry.cursor || persistedState.checkpointCursor,
      idempotencyKey: entry.idempotencyKey,
      persistedAckState: ack ? ack.state : "pending",
      journalState,
      blockedReason: ack && ack.state === "failed" ? ack.reason || "persisted-write-failed" : null
    };
  });
  const appliedReplayIds = replayQueue
    .filter((entry) => entry.journalState === "applied")
    .map((entry) => entry.commandId);
  const failedReplayIds = replayQueue
    .filter((entry) => entry.journalState === "failed")
    .map((entry) => entry.commandId);
  const pendingReplayIds = replayQueue
    .filter((entry) => entry.journalState === "pending")
    .map((entry) => entry.commandId);
  const appliedCommandIds = normalizeStringList([
    ...persistedState.appliedCommandIds,
    ...appliedReplayIds,
    ...(idempotentCommand.alreadyApplied ? [idempotentCommand.commandId] : [])
  ]);
  const commandPatch = idempotentCommand.alreadyApplied
    ? {
      action: "return-cached-result",
      commandId: idempotentCommand.commandId,
      idempotencyKey: idempotentCommand.idempotencyKey
    }
    : idempotentCommand.canExecute
      ? {
        action: "append-journal-entry",
        commandId: idempotentCommand.commandId,
        commandType: idempotentCommand.commandType,
        state: "pending",
        idempotencyKey: idempotentCommand.idempotencyKey
      }
      : idempotentCommand.canReplay
        ? {
          action: "resume-inflight-command",
          commandId: idempotentCommand.commandId,
          commandType: idempotentCommand.commandType,
          state: "pending",
          idempotencyKey: idempotentCommand.idempotencyKey
        }
        : null;
  const commandWillAppendPendingJournal = Boolean(commandPatch && ["append-journal-entry", "resume-inflight-command"].includes(commandPatch.action));
  const nextRestartStatus = failedReplayIds.length > 0 || recoveryContract.restartSafeStatus === "blocked"
    ? "blocked"
    : pendingReplayIds.length > 0 || commandWillAppendPendingJournal || recoveryContract.restartSafeStatus === "needs-recovery"
      ? "needs-recovery"
      : recoveryContract.restartSafeStatus === "replaying"
        ? "replaying"
        : "clean";
  const inflightCommandIds = nextRestartStatus === "needs-recovery"
    ? normalizeStringList([
      ...pendingReplayIds,
      ...(commandWillAppendPendingJournal ? [idempotentCommand.commandId] : [])
    ])
    : [];
  const blockedReasons = [
    ...failedReplayIds.map((commandId) => `replay-write-failed:${commandId}`),
    ...(idempotentCommand.status === "blocked" ? idempotentCommand.blockedReasons.map((reason) => `command:${reason}`) : []),
    ...(recoveryContract.restartSafeStatus === "blocked" ? ["recovery-blocked"] : [])
  ];
  const nextPersistedState = {
    checkpointCursor: failedReplayIds.length === 0 ? syncMetadata.cursor : persistedState.checkpointCursor,
    checkpointGeneration: failedReplayIds.length === 0 ? syncMetadata.rootGeneration : persistedState.checkpointGeneration,
    lastCheckpointAt: now,
    restartStatus: nextRestartStatus,
    restartEpoch: persistedState.restartEpoch + (nextRestartStatus === "clean" ? 0 : 1),
    appliedCommandIds,
    inflightCommandIds,
    journalTransitions: replayQueue.map((entry) => ({
      commandId: entry.commandId,
      nextState: entry.journalState,
      cursor: entry.cursor,
      idempotencyKey: entry.idempotencyKey
    }))
  };
  const writePlanId = stableProofId([
    persistedState.checkpointCursor,
    syncMetadata.cursor,
    nextRestartStatus,
    appliedCommandIds,
    inflightCommandIds,
    replayQueue.map((entry) => [entry.commandId, entry.journalState, entry.idempotencyKey]),
    commandPatch ? [commandPatch.action, commandPatch.commandId, commandPatch.idempotencyKey] : "no-command-patch"
  ]);

  return {
    contractVersion: "artifact-root.restart-persistence-plan.v1",
    writePlanId,
    restartSafeStatus: nextRestartStatus,
    sourceRestartStatus: recoveryContract.restartSafeStatus,
    idempotent: blockedReasons.length === 0 || idempotentCommand.alreadyApplied || idempotentCommand.canReplay,
    durableAfterWrite: nextRestartStatus === "clean" && blockedReasons.length === 0,
    writeMode: blockedReasons.length > 0
      ? "blocked"
      : commandPatch
        ? commandPatch.action
        : replayQueue.length > 0
          ? "apply-replay-results"
          : "no-op",
    blockedReasons,
    writeAcks,
    replayQueue,
    commandPatch,
    nextPersistedState,
    proof: {
      evaluatedAt: now,
      commandLedgerDigest: persistedState.commandLedger.ledgerDigest,
      replayQueueCount: replayQueue.length,
      persistedAckCount: writeAcks.length,
      failedReplayCount: failedReplayIds.length,
      pendingReplayCount: pendingReplayIds.length,
      writePlanId
    }
  };
}

function buildRestartClientActionContract({
  clientRuntimeState,
  recoveryContract,
  restartPersistencePlan,
  idempotentCommand,
  replayRows,
  blockedReasons,
  state,
  selectedRoute,
  instruction,
  generatedAt
}) {
  const cachedResultAvailable = idempotentCommand.alreadyApplied
    && restartPersistencePlan.commandPatch?.action === "return-cached-result";
  const replayReadyRows = replayRows.filter((row) => row.dispatchReady);
  const replayBlockedRows = replayRows.filter((row) => !row.dispatchReady);
  const selectedCommand = cachedResultAvailable
    ? {
      commandId: idempotentCommand.commandId,
      commandType: idempotentCommand.commandType,
      idempotencyKey: idempotentCommand.idempotencyKey,
      source: "cached-result"
    }
    : replayReadyRows[0]
      ? {
        commandId: replayReadyRows[0].commandId,
        commandType: replayReadyRows[0].commandType,
        idempotencyKey: replayReadyRows[0].idempotencyKey,
        source: replayReadyRows[0].source
      }
      : restartPersistencePlan.commandPatch
        ? {
          commandId: restartPersistencePlan.commandPatch.commandId,
          commandType: restartPersistencePlan.commandPatch.commandType || idempotentCommand.commandType,
          idempotencyKey: restartPersistencePlan.commandPatch.idempotencyKey,
          source: restartPersistencePlan.commandPatch.action
        }
        : null;
  const action = cachedResultAvailable
    ? "reuse-cached-result"
    : state === "blocked"
      ? "show-restart-blockers"
      : replayReadyRows.length > 0
        ? "dispatch-replay-command"
        : restartPersistencePlan.commandPatch
          ? "persist-command-patch"
          : recoveryContract.restartSafeStatus === "needs-recovery"
            ? "wait-for-recovery"
            : "render-clean-state";
  const actionState = state === "blocked"
    ? "blocked"
    : cachedResultAvailable || replayReadyRows.length > 0 || Boolean(restartPersistencePlan.commandPatch)
      ? "ready"
      : recoveryContract.restartSafeStatus === "needs-recovery"
        ? "waiting"
        : "complete";
  const idempotencyKey = selectedCommand?.idempotencyKey
    || restartPersistencePlan.writePlanId
    || `${clientRuntimeState.requestId}:${action}`;
  const routePatch = {
    contractVersion: "artifact-root.restart-client-route-patch.v1",
    route: selectedRoute,
    activePanel: selectedRoute === CLIENT_ROUTE_BY_ACTION.recover
      ? "recovery"
      : selectedRoute === CLIENT_ROUTE_BY_ACTION.export
        ? "export"
        : selectedRoute === CLIENT_ROUTE_BY_ACTION.apply
          ? "commit"
          : clientRuntimeState.activePanel,
    requestId: clientRuntimeState.requestId,
    sessionId: clientRuntimeState.sessionId,
    commandId: selectedCommand?.commandId || idempotentCommand.commandId,
    idempotencyKey,
    restartSafeStatus: recoveryContract.restartSafeStatus,
    updatedAt: generatedAt
  };

  return {
    contractVersion: "artifact-root.restart-client-action.v1",
    actionId: stableProofId([
      clientRuntimeState.sessionId,
      recoveryContract.restartSafeStatus,
      restartPersistencePlan.writePlanId,
      action,
      selectedCommand ? selectedCommand.commandId : "no-command"
    ]),
    generatedAt,
    action,
    state: actionState,
    instruction,
    route: selectedRoute,
    method: ["reuse-cached-result", "render-clean-state", "show-restart-blockers", "wait-for-recovery"].includes(action)
      ? "GET"
      : "POST",
    dispatchReady: actionState === "ready",
    selectedCommand,
    idempotencyKey,
    blockedReasons,
    replayReadiness: {
      readyReplayCommandIds: replayReadyRows.map((row) => row.commandId),
      blockedReplayCommandIds: replayBlockedRows.map((row) => row.commandId),
      replayQueueCount: replayRows.length,
      writePlanId: restartPersistencePlan.writePlanId
    },
    routePatch,
    userVisibleStatus: {
      status: actionState,
      message: actionState === "ready"
        ? action === "reuse-cached-result"
          ? "The artifact-root command already has a persisted result and can be rendered without replay."
          : `Artifact-root restart action ${action} is ready.`
        : actionState === "blocked"
          ? `Artifact-root restart action is blocked by ${blockedReasons[0] || "recovery state"}.`
          : actionState === "waiting"
            ? "Artifact-root restart is waiting for recovery state to settle."
            : "Artifact-root restart state is clean.",
      nextAction: action
    }
  };
}

function buildRuntimeRestartHandoffState({
  client,
  clientRuntimeState,
  recoveryContract,
  restartPersistencePlan,
  idempotentCommand,
  lifecycleSettingsControl,
  generatedAt
}) {
  const requestedRestartMode = typeof client.restartMode === "string" && ["observe", "replay", "recover", "block"].includes(client.restartMode)
    ? client.restartMode
    : recoveryContract.restartSafeStatus === "blocked"
      ? "block"
      : recoveryContract.replayQueue.length > 0
        ? "replay"
        : recoveryContract.restartSafeStatus === "needs-recovery"
          ? "recover"
          : "observe";
  const replayRows = recoveryContract.replayQueue.map((entry) => {
    const persistedRow = restartPersistencePlan.replayQueue.find((row) => row.commandId === entry.commandId) || null;
    const blockedReasons = normalizeStringList([
      ...(persistedRow?.blockedReason ? [persistedRow.blockedReason] : []),
      ...(restartPersistencePlan.blockedReasons || []),
      ...(lifecycleSettingsControl.commandGate.runnableNow ? [] : lifecycleSettingsControl.commandGate.blockedReasons)
    ]);

    return {
      contractVersion: "artifact-root.runtime-restart-replay-row.v1",
      replayOrder: entry.replayOrder,
      commandId: entry.commandId,
      commandType: entry.commandType,
      cursor: entry.cursor,
      idempotencyKey: entry.idempotencyKey,
      source: entry.source,
      persistedAckState: persistedRow?.persistedAckState || "pending",
      journalState: persistedRow?.journalState || "pending",
      dispatchRoute: CLIENT_ROUTE_BY_ACTION.recover,
      dispatchReady: blockedReasons.length === 0,
      blockedReasons
    };
  });
  const readyReplayRows = replayRows.filter((row) => row.dispatchReady);
  const blockedReplayRows = replayRows.filter((row) => !row.dispatchReady);
  const commandPatchReady = Boolean(restartPersistencePlan.commandPatch)
    && restartPersistencePlan.writeMode !== "blocked";
  const restartBlockedReasons = normalizeStringList([
    ...restartPersistencePlan.blockedReasons,
    ...blockedReplayRows.flatMap((row) => row.blockedReasons.map((reason) => `replay:${row.commandId}:${reason}`)),
    ...(idempotentCommand.status === "blocked" ? idempotentCommand.blockedReasons.map((reason) => `command:${reason}`) : []),
    ...(lifecycleSettingsControl.commandGate.runnableNow ? [] : lifecycleSettingsControl.commandGate.blockedReasons.map((reason) => `lifecycle:${reason}`))
  ]);
  const state = recoveryContract.restartSafeStatus === "blocked" || restartBlockedReasons.length > 0
    ? "blocked"
    : readyReplayRows.length > 0 || commandPatchReady
      ? "ready"
      : recoveryContract.restartSafeStatus === "needs-recovery"
        ? "waiting"
        : "clean";
  const selectedRoute = state === "blocked" || requestedRestartMode === "recover"
    ? CLIENT_ROUTE_BY_ACTION.recover
    : commandPatchReady && idempotentCommand.commandType === "export"
      ? CLIENT_ROUTE_BY_ACTION.export
      : readyReplayRows.length > 0
        ? CLIENT_ROUTE_BY_ACTION.recover
        : CLIENT_ROUTE_BY_ACTION.refresh;
  const instruction = state === "ready"
    ? readyReplayRows.length > 0
      ? "dispatch-replay-queue"
      : restartPersistencePlan.commandPatch?.action === "return-cached-result"
        ? "return-cached-command-result"
        : "persist-command-patch"
    : state === "blocked"
      ? "show-restart-blockers"
      : state === "waiting"
        ? "wait-for-recovery"
        : "render-clean-state";
  const handoffId = stableProofId([
    clientRuntimeState.requestId,
    clientRuntimeState.sessionId,
    recoveryContract.restartSafeStatus,
    restartPersistencePlan.writePlanId,
    replayRows.map((row) => [row.commandId, row.journalState, row.dispatchReady])
  ]);
  const clientStatePatch = {
    contractVersion: "artifact-root.runtime-restart-client-state-patch.v1",
    requestId: clientRuntimeState.requestId,
    sessionId: clientRuntimeState.sessionId,
    route: selectedRoute,
    activePanel: selectedRoute === CLIENT_ROUTE_BY_ACTION.recover ? "recovery" : clientRuntimeState.activePanel,
    restartSafeStatus: recoveryContract.restartSafeStatus,
    runtimeRestartState: state,
    runtimeRestartInstruction: instruction,
    replayCommandIds: replayRows.map((row) => row.commandId),
    readyReplayCommandIds: readyReplayRows.map((row) => row.commandId),
    blockedReasons: restartBlockedReasons,
    writePlanId: restartPersistencePlan.writePlanId,
    updatedAt: generatedAt
  };
  const clientAction = buildRestartClientActionContract({
    clientRuntimeState,
    recoveryContract,
    restartPersistencePlan,
    idempotentCommand,
    replayRows,
    blockedReasons: restartBlockedReasons,
    state,
    selectedRoute,
    instruction,
    generatedAt
  });

  return {
    contractVersion: "artifact-root.runtime-restart-handoff.v1",
    handoffId,
    generatedAt,
    requestedRestartMode,
    state,
    instruction,
    restartSafeStatus: recoveryContract.restartSafeStatus,
    replayRequired: recoveryContract.proof.replayRequired,
    route: selectedRoute,
    dispatchReady: state === "ready",
    recoverySteps: recoveryContract.recoverySteps,
    replayRows,
    readyReplayCount: readyReplayRows.length,
    blockedReplayCount: blockedReplayRows.length,
    commandPatch: restartPersistencePlan.commandPatch,
    writeMode: restartPersistencePlan.writeMode,
    writePlanId: restartPersistencePlan.writePlanId,
    blockedReasons: restartBlockedReasons,
    clientAction,
    clientStatePatch,
    persistedStatePatch: {
      contractVersion: "artifact-root.runtime-restart-persisted-state-patch.v1",
      ...restartPersistencePlan.nextPersistedState,
      writePlanId: restartPersistencePlan.writePlanId,
      replayQueueCount: restartPersistencePlan.replayQueue.length
    },
    userVisibleStatus: {
      mode: state,
      message: state === "ready"
        ? `${readyReplayRows.length || 1} artifact-root restart action${(readyReplayRows.length || 1) === 1 ? "" : "s"} can continue safely.`
        : state === "blocked"
          ? `Artifact-root restart is blocked by ${restartBlockedReasons[0] || "recovery state"}.`
          : state === "waiting"
            ? "Artifact-root restart is waiting for recovery state to settle."
            : "Artifact-root persisted state is clean.",
      nextAction: instruction
    },
    proof: {
      handoffId,
      commandLedgerDigest: recoveryContract.proof.commandLedgerDigest,
      writePlanId: restartPersistencePlan.writePlanId,
      replayQueueCount: replayRows.length,
      readyReplayCount: readyReplayRows.length,
      blockedReasonCount: restartBlockedReasons.length
    }
  };
}

function normalizePersistedBootArtifactRecords(value, requiredArtifacts, persistedState, now) {
  const records = Array.isArray(value) ? value : [];
  const byKey = new Map(records
    .filter((record) => record && typeof record === "object" && typeof record.key === "string" && record.key.length > 0)
    .map((record) => [record.key, record]));

  return requiredArtifacts.map((artifact) => {
    const record = byKey.get(artifact.key) || {};
    const state = typeof record.state === "string" && ["present", "missing", "stale", "quarantined"].includes(record.state)
      ? record.state
      : record.present === false
        ? "missing"
        : "present";
    const path = typeof record.path === "string" && record.path.length > 0 ? normalizeArtifactPath(record.path, artifact.path) : artifact.path;
    const contentAddressPath = typeof record.contentAddressPath === "string" && record.contentAddressPath.length > 0
      ? normalizeArtifactPath(record.contentAddressPath, artifact.contentAddressPath)
      : artifact.contentAddressPath;
    const checkpointCursor = typeof record.checkpointCursor === "string" && record.checkpointCursor.length > 0
      ? record.checkpointCursor
      : persistedState.checkpointCursor;
    const checkpointGeneration = normalizeNonNegativeInteger(record.checkpointGeneration, persistedState.checkpointGeneration);
    const digest = typeof record.digest === "string" && record.digest.length > 0
      ? record.digest
      : stableProofId([artifact.key, path, contentAddressPath, checkpointCursor, checkpointGeneration]);

    return {
      key: artifact.key,
      state,
      path,
      expectedPath: artifact.path,
      contentAddressPath,
      expectedContentAddressPath: artifact.contentAddressPath,
      digest,
      writable: artifact.writable,
      checkpointCursor,
      checkpointGeneration,
      writtenAt: toIsoTimestamp(record.writtenAt || record.updatedAt, now),
      pathMatches: path === artifact.path,
      contentAddressMatches: contentAddressPath === artifact.contentAddressPath,
      generationMatches: checkpointGeneration === persistedState.checkpointGeneration,
      cursorMatches: checkpointCursor === persistedState.checkpointCursor
    };
  });
}

function buildBootRecoveryManifest(input, bootArtifactRoot, persistedState, recoveryContract, restartPersistencePlan, now) {
  const persisted = input && typeof input.persistedState === "object" && input.persistedState !== null
    ? input.persistedState
    : {};
  const bootRecords = normalizePersistedBootArtifactRecords(
    Array.isArray(persisted.bootArtifacts) ? persisted.bootArtifacts : persisted.bootRecords,
    bootArtifactRoot.requiredArtifacts,
    persistedState,
    now
  );
  const workItems = bootRecords.map((record, index) => {
    const blockers = [
      ...(!record.writable ? [`boot-path-read-only:${record.expectedPath}`] : []),
      ...(record.state === "quarantined" ? [`boot-artifact-quarantined:${record.key}`] : []),
      ...(recoveryContract.restartSafeStatus === "blocked" ? ["restart-recovery-blocked"] : [])
    ];
    const driftReasons = [
      ...(record.state === "missing" ? ["boot-artifact-missing"] : []),
      ...(!record.pathMatches ? ["boot-path-drift"] : []),
      ...(!record.contentAddressMatches ? ["content-address-drift"] : []),
      ...(!record.cursorMatches ? ["checkpoint-cursor-drift"] : []),
      ...(!record.generationMatches ? ["checkpoint-generation-drift"] : [])
    ];
    const action = blockers.length > 0
      ? "quarantine"
      : driftReasons.length === 0
        ? "verify"
        : record.state === "missing"
          ? "create"
          : "rewrite";

    return {
      key: record.key,
      order: index + 1,
      action,
      state: record.state,
      path: record.expectedPath,
      previousPath: record.pathMatches ? null : record.path,
      contentAddressPath: record.expectedContentAddressPath,
      previousContentAddressPath: record.contentAddressMatches ? null : record.contentAddressPath,
      checkpointCursor: persistedState.checkpointCursor,
      checkpointGeneration: persistedState.checkpointGeneration,
      idempotencyKey: stableProofId([
        bootArtifactRoot.namespaceLayout.mountId,
        record.key,
        action,
        persistedState.checkpointCursor,
        persistedState.commandLedger.ledgerDigest
      ]),
      driftReasons,
      blockedReasons: blockers,
      recoveryPath: `${bootArtifactRoot.namespaceLayout.directories.recovery}/${record.key}.json`
    };
  });
  const blockedItems = workItems.filter((item) => item.blockedReasons.length > 0);
  const repairItems = workItems.filter((item) => ["create", "rewrite"].includes(item.action));
  const quarantineItems = workItems.filter((item) => item.action === "quarantine");
  const manifestId = stableProofId([
    bootArtifactRoot.rootFingerprint,
    persistedState.checkpointCursor,
    persistedState.checkpointGeneration,
    recoveryContract.restartSafeStatus,
    restartPersistencePlan.writePlanId,
    workItems.map((item) => [item.key, item.action, item.idempotencyKey, item.driftReasons, item.blockedReasons])
  ]);

  return {
    contractVersion: "artifact-root.boot-recovery-manifest.v1",
    manifestId,
    generatedAt: now,
    namespaceKey: bootArtifactRoot.namespaceLayout.namespaceKey,
    rootFingerprint: bootArtifactRoot.rootFingerprint,
    restartSafeStatus: recoveryContract.restartSafeStatus,
    bootConsistent: repairItems.length === 0 && blockedItems.length === 0,
    repairRequired: repairItems.length > 0,
    blocked: blockedItems.length > 0,
    workItems,
    repairPaths: repairItems.map((item) => item.path),
    quarantinePaths: quarantineItems.map((item) => item.path),
    blockedReasons: normalizeStringList(blockedItems.flatMap((item) => item.blockedReasons)),
    recoveryDirectory: bootArtifactRoot.namespaceLayout.directories.recovery,
    nextPersistedBootPatch: {
      manifestId,
      checkpointCursor: persistedState.checkpointCursor,
      checkpointGeneration: persistedState.checkpointGeneration,
      restartStatus: blockedItems.length > 0
        ? "blocked"
        : repairItems.length > 0 || restartPersistencePlan.restartSafeStatus !== "clean"
          ? "needs-recovery"
          : "clean",
      bootArtifacts: workItems
        .filter((item) => item.action !== "quarantine")
        .map((item) => ({
          key: item.key,
          path: item.path,
          contentAddressPath: item.contentAddressPath,
          checkpointCursor: item.checkpointCursor,
          checkpointGeneration: item.checkpointGeneration,
          state: item.action === "verify" ? "present" : "stale",
          idempotencyKey: item.idempotencyKey
        }))
    },
    proof: {
      initializationPlanStable: bootArtifactRoot.initializationPlan.stable,
      requiredArtifactCount: bootArtifactRoot.requiredArtifacts.length,
      repairItemCount: repairItems.length,
      blockedItemCount: blockedItems.length,
      restartWritePlanId: restartPersistencePlan.writePlanId,
      commandLedgerDigest: persistedState.commandLedger.ledgerDigest
    }
  };
}

function normalizeServiceIntents(input, commandType, externalHandoff) {
  const requested = normalizeStringList(input.serviceIntents).filter((intent) => SERVICE_INTENTS.has(intent));
  const inferred = [
    "read",
    ...(commandType === "commit" || commandType === "sync" ? ["write"] : []),
    ...(commandType === "export" ? ["audit"] : []),
    ...(externalHandoff.state !== "none" ? ["handoff"] : [])
  ];

  return normalizeStringList(requested.length > 0 ? requested : inferred);
}

function normalizeProviderEndpoint(value, providerId) {
  const endpoint = value && typeof value === "object" ? value : {};
  const route = typeof endpoint.route === "string" && endpoint.route.length > 0
    ? endpoint.route
    : `/kernel/artifact-root/providers/${providerId}`;
  const protocol = typeof endpoint.protocol === "string" && endpoint.protocol.length > 0
    ? endpoint.protocol
    : "hosted-kernel";

  return {
    route,
    protocol,
    acceptsBatch: endpoint.acceptsBatch !== false,
    maxBatchSize: normalizeNonNegativeInteger(endpoint.maxBatchSize, 100)
  };
}

function inspectProviderSyncStateRecords(providerSyncStates, providers, now) {
  const knownProviderIds = new Set(providers.map((provider) => provider.providerId));
  const acceptedByProviderId = new Map();
  const duplicateProviderIds = new Set();
  const ignoredRecords = [];
  const duplicateRecords = [];

  providerSyncStates.forEach((record, index) => {
    const recordRef = `provider-sync:${index + 1}`;

    if (!record || typeof record !== "object") {
      ignoredRecords.push({
        recordRef,
        providerId: null,
        reason: "record-not-object"
      });
      return;
    }

    const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";
    if (providerId.length === 0) {
      ignoredRecords.push({
        recordRef,
        providerId: null,
        reason: "provider-id-missing"
      });
      return;
    }

    if (!knownProviderIds.has(providerId)) {
      ignoredRecords.push({
        recordRef,
        providerId,
        reason: "provider-id-not-registered"
      });
      return;
    }

    if (acceptedByProviderId.has(providerId)) {
      const previousRecord = acceptedByProviderId.get(providerId);
      duplicateProviderIds.add(providerId);
      duplicateRecords.push({
        providerId,
        previousRecordRef: previousRecord.recordRef,
        replacementRecordRef: recordRef,
        reason: "provider-sync-state-replaced-by-later-record"
      });
    }

    acceptedByProviderId.set(providerId, {
      ...record,
      providerId,
      recordRef,
      observedAt: toIsoTimestamp(record.observedAt || record.lastSeenAt, now)
    });
  });

  const acceptedRecords = [...acceptedByProviderId.values()];

  return {
    byProviderId: acceptedByProviderId,
    acceptedRecords,
    ignoredRecords,
    duplicateRecords,
    duplicateProviderIds: [...duplicateProviderIds].sort(),
    inputRecordCount: providerSyncStates.length,
    acceptedRecordCount: acceptedRecords.length,
    ignoredRecordCount: ignoredRecords.length,
    duplicateRecordCount: duplicateRecords.length,
    clean: ignoredRecords.length === 0 && duplicateRecords.length === 0,
    digest: stableProofId([
      acceptedRecords.map((record) => [record.providerId, record.recordRef, record.cursor, record.rootGeneration]),
      ignoredRecords.map((record) => [record.recordRef, record.providerId, record.reason]),
      duplicateRecords.map((record) => [record.providerId, record.previousRecordRef, record.replacementRecordRef])
    ])
  };
}

function normalizeProviderSyncRegistry(input, providers, syncMetadata, now) {
  const providerSyncStates = Array.isArray(input.providerSyncStates)
    ? input.providerSyncStates
    : Array.isArray(input.providerSync)
      ? input.providerSync
      : [];
  const recordInspection = inspectProviderSyncStateRecords(providerSyncStates, providers, now);
  const byProviderId = recordInspection.byProviderId;
  const nowMs = Date.parse(now);
  const entries = providers.map((provider) => {
    const state = byProviderId.get(provider.providerId) || {};
    const cursor = typeof state.cursor === "string" && state.cursor.length > 0 ? state.cursor : syncMetadata.cursor;
    const acknowledgedCursor = typeof state.acknowledgedCursor === "string" && state.acknowledgedCursor.length > 0
      ? state.acknowledgedCursor
      : cursor;
    const rootGeneration = normalizeNonNegativeInteger(state.rootGeneration, syncMetadata.rootGeneration);
    const advertisedState = typeof state.syncState === "string" && PROVIDER_SYNC_STATES.has(state.syncState)
      ? state.syncState
      : "current";
    const leaseExpiresAt = typeof state.leaseExpiresAt === "string" ? toIsoTimestamp(state.leaseExpiresAt, now) : null;
    const leaseMs = leaseExpiresAt ? Date.parse(leaseExpiresAt) : null;
    const leaseExpired = Number.isFinite(leaseMs) && leaseMs <= nowMs;
    const cursorMatches = cursor === syncMetadata.cursor;
    const generationMatches = rootGeneration === syncMetadata.rootGeneration;
    const derivedState = leaseExpired
      ? "offline"
      : advertisedState === "quarantined"
        ? "quarantined"
        : cursorMatches && generationMatches
          ? "current"
          : advertisedState === "offline"
            ? "offline"
            : "stale";
    const lagGenerations = Math.max(syncMetadata.rootGeneration - rootGeneration, 0);

    return {
      providerId: provider.providerId,
      syncState: derivedState,
      cursor,
      acknowledgedCursor,
      rootGeneration,
      lagGenerations,
      cursorMatches,
      generationMatches,
      recordRef: state.recordRef || null,
      observedAt: state.observedAt || null,
      leaseExpiresAt,
      leaseExpired,
      lastSeenAt: toIsoTimestamp(state.lastSeenAt, now),
      endpoint: normalizeProviderEndpoint(state.endpoint, provider.providerId),
      writeFence: {
        token: typeof state.writeFenceToken === "string" && state.writeFenceToken.length > 0
          ? state.writeFenceToken
          : stableProofId([provider.providerId, syncMetadata.cursor, rootGeneration]),
        active: provider.mode === "read-write" && derivedState === "current" && !leaseExpired,
        reason: provider.mode !== "read-write"
          ? "provider-read-only"
          : derivedState !== "current"
            ? `provider-sync-${derivedState}`
            : leaseExpired
              ? "provider-lease-expired"
              : null
      }
    };
  });
  const blocked = entries.filter((entry) => entry.syncState === "offline" || entry.syncState === "quarantined");
  const stale = entries.filter((entry) => entry.syncState === "stale" || entry.syncState === "catching-up");

  return {
    contractVersion: "artifact-root.provider-sync-registry.v1",
    cursor: syncMetadata.cursor,
    rootGeneration: syncMetadata.rootGeneration,
    providerCount: entries.length,
    currentProviderCount: entries.filter((entry) => entry.syncState === "current").length,
    staleProviderCount: stale.length,
    blockedProviderCount: blocked.length,
    inputRecordCount: recordInspection.inputRecordCount,
    acceptedRecordCount: recordInspection.acceptedRecordCount,
    ignoredRecordCount: recordInspection.ignoredRecordCount,
    duplicateRecordCount: recordInspection.duplicateRecordCount,
    duplicateProviderIds: recordInspection.duplicateProviderIds,
    ignoredRecords: recordInspection.ignoredRecords,
    duplicateRecords: recordInspection.duplicateRecords,
    recordValidation: {
      valid: recordInspection.clean,
      acceptedRecordCount: recordInspection.acceptedRecordCount,
      ignoredRecordCount: recordInspection.ignoredRecordCount,
      duplicateRecordCount: recordInspection.duplicateRecordCount,
      digest: recordInspection.digest
    },
    entries,
    byProviderId: Object.fromEntries(entries.map((entry) => [entry.providerId, entry])),
    proof: {
      registryDigest: stableProofId(entries.map((entry) => [
        entry.providerId,
        entry.syncState,
        entry.cursor,
        entry.rootGeneration,
        entry.leaseExpiresAt,
        entry.writeFence.token,
        entry.recordRef
      ])),
      recordDigest: recordInspection.digest,
      evaluatedAt: now
    }
  };
}

function buildProviderCandidate(provider, intent, capability, providerSync) {
  const hasCapability = provider.capabilities.includes(capability);
  const syncState = providerSync ? providerSync.syncState : "unregistered";
  const writeFenceActive = Boolean(providerSync && providerSync.writeFence.active);
  const rejectionReasons = [
    ...(!hasCapability ? [`missing-capability:${capability}`] : []),
    ...(syncState === "offline" ? ["provider-offline"] : []),
    ...(syncState === "quarantined" ? ["provider-quarantined"] : []),
    ...(intent === "write" && provider.mode !== "read-write" ? ["provider-read-only"] : []),
    ...(intent === "write" && !writeFenceActive
      ? [providerSync?.writeFence.reason || "write-fence-inactive"]
      : []),
    ...(intent === "write" && providerSync && !providerSync.cursorMatches ? ["provider-cursor-stale"] : []),
    ...(intent === "write" && providerSync && !providerSync.generationMatches ? ["provider-generation-stale"] : []),
    ...(intent === "handoff" && !provider.acceptsExternalHandoff ? ["provider-rejects-external-handoff"] : [])
  ];
  const eligible = rejectionReasons.length === 0;
  const score = [
    eligible ? 0 : 1,
    syncState === "current" ? 0 : syncState === "stale" || syncState === "catching-up" ? 1 : 2,
    intent === "write" && writeFenceActive ? 0 : intent === "write" ? 1 : 0,
    provider.mode === "read-write" ? 0 : 1,
    provider.priority
  ];

  return {
    providerId: provider.providerId,
    intent,
    requiredCapability: capability,
    mode: provider.mode,
    priority: provider.priority,
    acceptsExternalHandoff: provider.acceptsExternalHandoff,
    eligible,
    rejectionReasons,
    score,
    syncState,
    cursor: providerSync ? providerSync.cursor : null,
    acknowledgedCursor: providerSync ? providerSync.acknowledgedCursor : null,
    lagGenerations: providerSync ? providerSync.lagGenerations : null,
    writeFenceActive,
    writeFenceToken: providerSync ? providerSync.writeFence.token : null,
    endpoint: providerSync ? providerSync.endpoint : normalizeProviderEndpoint(null, provider.providerId)
  };
}

function rankProviderCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    for (let index = 0; index < Math.max(a.score.length, b.score.length); index += 1) {
      const left = a.score[index] ?? 0;
      const right = b.score[index] ?? 0;
      if (left !== right) {
        return left - right;
      }
    }
    return a.providerId.localeCompare(b.providerId);
  });
}

function buildProviderServiceContract(
  input,
  providers,
  capabilityContract,
  permissionContract,
  syncMetadata,
  externalHandoff,
  previewContract,
  pathAccessManifest,
  acceptanceContract,
  recoveryContract,
  idempotentCommand,
  providerSyncRegistry
) {
  const intents = normalizeServiceIntents(input, idempotentCommand.commandType, externalHandoff);
  const providerSyncFor = (providerId) => providerSyncRegistry.byProviderId[providerId] || null;
  const routeSpecs = {
    read: {
      capability: "artifact.root.sync.read",
      providerPredicate: (provider) => {
        const syncState = providerSyncFor(provider.providerId);
        return !syncState || !["offline", "quarantined"].includes(syncState.syncState);
      },
      dynamicBlockers: []
    },
    write: {
      capability: "artifact.root.sync.write",
      providerPredicate: (provider) => {
        const syncState = providerSyncFor(provider.providerId);
        return provider.mode === "read-write" && Boolean(syncState && syncState.writeFence.active);
      },
      dynamicBlockers: [
        ...(syncMetadata.conflictPaths.length > 0 ? ["sync-conflicts-present"] : []),
        ...(previewContract.summary.boundaryViolationCount > 0 ? ["workspace-boundary-violations"] : []),
        ...(pathAccessManifest.deniedPathCount > 0 ? ["path-access-denied"] : []),
        ...(pathAccessManifest.writeBlockedPathCount > 0 ? ["path-access-write-blocked"] : [])
      ]
    },
    audit: {
      capability: "artifact.root.audit.proof",
      providerPredicate: () => true,
      dynamicBlockers: []
    },
    handoff: {
      capability: "artifact.root.handoff.external",
      providerPredicate: (provider) => provider.acceptsExternalHandoff,
      dynamicBlockers: [
        ...(externalHandoff.blockedByConflicts ? ["sync-conflicts-present"] : []),
        ...(externalHandoff.state === "failed" ? [`handoff:${externalHandoff.reason || "failed"}`] : []),
        ...(pathAccessManifest.deniedPathCount > 0 ? ["path-access-denied"] : []),
        ...(pathAccessManifest.writeBlockedPaths.some((entry) => entry.writeBlockedReasons.some((reason) => reason.includes("handoff")))
          ? ["path-access-handoff-blocked"]
          : [])
      ]
    }
  };

  const routes = intents.map((intent) => {
    const spec = routeSpecs[intent];
    const providerCandidates = rankProviderCandidates(providers
      .map((provider) => buildProviderCandidate(
        provider,
        intent,
        spec.capability,
        providerSyncFor(provider.providerId)
      )));
    const provider = providerCandidates
      .filter((candidate) => candidate.eligible)
      .find((candidate) => {
        const providerRecord = providers.find((entry) => entry.providerId === candidate.providerId);
        return providerRecord && spec.providerPredicate(providerRecord);
      }) || null;
    const providerSync = provider ? providerSyncFor(provider.providerId) : null;
    const selectedCandidate = provider
      ? providerCandidates.find((candidate) => candidate.providerId === provider.providerId) || null
      : null;
    const standbyCandidates = providerCandidates
      .filter((candidate) => candidate.eligible && candidate.providerId !== provider?.providerId)
      .map((candidate) => ({
        providerId: candidate.providerId,
        syncState: candidate.syncState,
        lagGenerations: candidate.lagGenerations,
        endpoint: candidate.endpoint,
        activationToken: stableProofId([
          intent,
          candidate.providerId,
          syncMetadata.cursor,
          candidate.writeFenceToken || "no-write-fence"
        ])
      }));
    const capabilityDenied = capabilityContract.denied.find((denial) => denial.capability === spec.capability);
    const permissionGranted = permissionContract.allowedPermissions.includes(spec.capability) && permissionContract.scoped;
    const syncBlockers = providerSync
      ? [
        ...(providerSync.syncState === "offline" ? ["provider-offline"] : []),
        ...(providerSync.syncState === "quarantined" ? ["provider-quarantined"] : []),
        ...(intent === "write" && !providerSync.writeFence.active ? [providerSync.writeFence.reason || "write-fence-inactive"] : []),
        ...(intent === "write" && !providerSync.cursorMatches ? ["provider-cursor-stale"] : []),
        ...(intent === "write" && !providerSync.generationMatches ? ["provider-generation-stale"] : [])
      ]
      : [];
    const executionBlockedReasons = intent === "write"
      ? [
        ...(!acceptanceContract.readyForCommit ? ["acceptance-not-ready"] : []),
        ...(!recoveryContract.canResumeWrites ? [`recovery:${recoveryContract.restartSafeStatus}`] : []),
        ...(idempotentCommand.status === "blocked" ? idempotentCommand.blockedReasons.map((reason) => `command:${reason}`) : [])
      ]
      : intent === "handoff" && externalHandoff.requiresAck
        ? [`handoff-awaiting-ack:${externalHandoff.state}`]
        : [];
    const blockedReasons = [
      ...(provider ? [] : [`provider-missing:${spec.capability}`]),
      ...(capabilityDenied ? [`capability-denied:${capabilityDenied.reason}`] : []),
      ...(!permissionGranted ? [`permission-missing:${spec.capability}`] : []),
      ...syncBlockers,
      ...spec.dynamicBlockers
    ];

    return {
      intent,
      providerId: provider ? provider.providerId : null,
      requiredCapability: spec.capability,
      mode: provider ? provider.mode : null,
      routable: blockedReasons.length === 0,
      blockedReasons,
      executionReady: blockedReasons.length === 0 && executionBlockedReasons.length === 0,
      executionBlockedReasons,
      selection: {
        decisionId: stableProofId([
          intent,
          spec.capability,
          syncMetadata.cursor,
          providerCandidates.map((candidate) => [
            candidate.providerId,
            candidate.eligible,
            candidate.rejectionReasons,
            candidate.score
          ])
        ]),
        selectedProviderId: provider ? provider.providerId : null,
        selectedReason: provider
          ? selectedCandidate && selectedCandidate.writeFenceActive
            ? "eligible-with-active-write-fence"
            : "first-ranked-eligible-provider"
          : "no-eligible-provider",
        failoverReady: standbyCandidates.length > 0,
        standbyProviderIds: standbyCandidates.map((candidate) => candidate.providerId),
        candidateCount: providerCandidates.length,
        eligibleCandidateCount: providerCandidates.filter((candidate) => candidate.eligible).length
      },
      providerCandidates: providerCandidates.map((candidate, index) => ({
        rank: index + 1,
        providerId: candidate.providerId,
        mode: candidate.mode,
        priority: candidate.priority,
        eligible: candidate.eligible,
        rejectionReasons: candidate.rejectionReasons,
        syncState: candidate.syncState,
        lagGenerations: candidate.lagGenerations,
        writeFenceActive: candidate.writeFenceActive,
        endpoint: candidate.endpoint
      })),
      standbyProviders: standbyCandidates,
      syncCursor: syncMetadata.cursor,
      providerSync: providerSync ? {
        syncState: providerSync.syncState,
        cursor: providerSync.cursor,
        acknowledgedCursor: providerSync.acknowledgedCursor,
        lagGenerations: providerSync.lagGenerations,
        leaseExpiresAt: providerSync.leaseExpiresAt,
        writeFenceActive: providerSync.writeFence.active,
        endpoint: providerSync.endpoint
      } : null,
      operationEnvelope: provider ? {
        operationId: `${intent}:${idempotentCommand.commandId}:${stableProofId([provider.providerId, syncMetadata.cursor, intent])}`,
        endpoint: providerSync ? providerSync.endpoint.route : null,
        protocol: providerSync ? providerSync.endpoint.protocol : "hosted-kernel",
        idempotencyKey: idempotentCommand.idempotencyKey,
        cursor: syncMetadata.cursor,
        writeFenceToken: providerSync ? providerSync.writeFence.token : null,
        providerSelectionId: selectedCandidate ? stableProofId([
          intent,
          selectedCandidate.providerId,
          selectedCandidate.score,
          selectedCandidate.writeFenceToken || "no-write-fence",
          syncMetadata.cursor
        ]) : null,
        failoverProviderIds: standbyCandidates.map((candidate) => candidate.providerId)
      } : null,
      handoffState: intent === "handoff" ? externalHandoff.state : null
    };
  });
  const activeProviderIds = normalizeStringList(routes.map((route) => route.providerId).filter(Boolean));
  const blockedRoutes = routes.filter((route) => !route.routable);
  const executionBlockedRoutes = routes.filter((route) => route.routable && !route.executionReady);
  const failoverRoutes = routes.filter((route) => route.selection.failoverReady);

  return {
    contractVersion: "artifact-root.provider-service-contract.v1",
    requestedIntents: intents,
    activeProviderIds,
    routes,
    allRoutable: blockedRoutes.length === 0,
    allExecutionReady: executionBlockedRoutes.length === 0,
    blockedRouteCount: blockedRoutes.length,
    executionBlockedRouteCount: executionBlockedRoutes.length,
    failoverRouteCount: failoverRoutes.length,
    providerSelection: {
      selectedProviderIdsByIntent: Object.fromEntries(routes.map((route) => [route.intent, route.providerId])),
      failoverProviderIdsByIntent: Object.fromEntries(routes.map((route) => [
        route.intent,
        route.standbyProviders.map((candidate) => candidate.providerId)
      ])),
      unroutableIntents: blockedRoutes.map((route) => route.intent),
      digest: stableProofId(routes.map((route) => [
        route.intent,
        route.providerId,
        route.selection.decisionId,
        route.selection.standbyProviderIds,
        route.blockedReasons
      ]))
    },
    syncAnchor: {
      cursor: syncMetadata.cursor,
      rootGeneration: syncMetadata.rootGeneration,
      policy: syncMetadata.policy
    },
    providerSync: {
      registryDigest: providerSyncRegistry.proof.registryDigest,
      currentProviderCount: providerSyncRegistry.currentProviderCount,
      staleProviderCount: providerSyncRegistry.staleProviderCount,
      blockedProviderCount: providerSyncRegistry.blockedProviderCount
    },
    externalHandoff: {
      state: externalHandoff.state,
      providerId: externalHandoff.providerId,
      requiresAck: externalHandoff.requiresAck,
      destination: externalHandoff.destination
    }
  };
}

function normalizeFailureSignals(value, now) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((failure) => failure && typeof failure === "object")
    .map((failure, index) => {
      const code = typeof failure.code === "string" && failure.code.length > 0
        ? failure.code
        : `artifact-root-failure-${index + 1}`;
      const severity = typeof failure.severity === "string" && FAILURE_SEVERITIES.has(failure.severity)
        ? failure.severity
        : "error";
      const retryable = typeof failure.retryable === "boolean" ? failure.retryable : severity !== "critical";
      return {
        code,
        severity,
        message: typeof failure.message === "string" && failure.message.length > 0
          ? failure.message
          : code,
        retryable,
        firstObservedAt: toIsoTimestamp(failure.firstObservedAt, now),
        lastObservedAt: toIsoTimestamp(failure.lastObservedAt, now),
        source: typeof failure.source === "string" && failure.source.length > 0 ? failure.source : "hosted-kernel"
      };
    })
    .sort((a, b) => a.severity.localeCompare(b.severity) || a.code.localeCompare(b.code));
}

function normalizeRetryPolicy(value) {
  const retry = value && typeof value === "object" ? value : {};
  const attempts = Number.isInteger(retry.attempts) && retry.attempts >= 0 ? retry.attempts : 0;
  const maxAttempts = Number.isInteger(retry.maxAttempts) && retry.maxAttempts >= 0 ? retry.maxAttempts : 3;
  const baseDelayMs = Number.isInteger(retry.baseDelayMs) && retry.baseDelayMs >= 0 ? retry.baseDelayMs : 250;
  const maxDelayMs = Number.isInteger(retry.maxDelayMs) && retry.maxDelayMs >= baseDelayMs ? retry.maxDelayMs : 5000;
  const mode = typeof retry.mode === "string" && RETRY_MODES.has(retry.mode) ? retry.mode : "exponential-backoff";
  const cappedAttempts = Math.min(attempts, maxAttempts);
  const exponentialDelay = Math.min(baseDelayMs * (2 ** cappedAttempts), maxDelayMs);
  const nextDelayMs = mode === "none" || mode === "operator-gated" || attempts >= maxAttempts
    ? null
    : mode === "immediate"
      ? 0
      : exponentialDelay;

  return {
    contractVersion: "artifact-root.retry-policy.v1",
    mode,
    attempts,
    maxAttempts,
    exhausted: attempts >= maxAttempts,
    nextDelayMs,
    nextRetryAt: typeof retry.nextRetryAt === "string" && nextDelayMs !== null
      ? toIsoTimestamp(retry.nextRetryAt)
      : null
  };
}

function addMillisecondsToIsoTimestamp(timestamp, delayMs) {
  const baseMs = Date.parse(timestamp);
  if (!Number.isFinite(baseMs) || !Number.isInteger(delayMs) || delayMs < 0) {
    return null;
  }
  return new Date(baseMs + delayMs).toISOString();
}

function buildFailureRunbook(failures, retryPolicy, providerServiceContract, now) {
  const firstRetryable = failures.find((failure) => failure.retryable) || null;
  const retryAt = retryPolicy.nextRetryAt || addMillisecondsToIsoTimestamp(now, retryPolicy.nextDelayMs);
  const routeFailures = providerServiceContract.routes
    .filter((route) => !route.routable || !route.executionReady)
    .map((route) => ({
      intent: route.intent,
      providerId: route.providerId,
      blockedReasons: [...route.blockedReasons, ...route.executionBlockedReasons],
      routeReady: route.routable,
      executionReady: route.executionReady
    }));
  const operatorActions = failures.map((failure) => {
    const recoverableByRetry = failure.retryable && !retryPolicy.exhausted && retryAt !== null;
    const action = recoverableByRetry
      ? "retry-provider-operation"
      : failure.code === "sync-conflict"
        ? "resolve-conflicting-artifact-path"
      : failure.code === "recovery-blocked"
        ? "run-recovery-inspection"
        : failure.code === "boot-root-metadata-missing"
          ? "write-root-metadata"
          : failure.code === "boot-root-metadata-stale"
            ? "rewrite-root-metadata"
            : failure.code === "boot-root-metadata-blocked"
              ? "inspect-boot-metadata-blocker"
        : failure.code.startsWith("provider-route-")
          ? "repair-provider-route"
          : "operator-review";

    return {
      code: failure.code,
      severity: failure.severity,
      source: failure.source,
      action,
      retryAt: recoverableByRetry ? retryAt : null,
      detail: failure.message
    };
  });
  const failureDigest = stableProofId(failures.map((failure) => [
    failure.code,
    failure.severity,
    failure.retryable,
    failure.source,
    failure.lastObservedAt
  ]));

  return {
    contractVersion: "artifact-root.failure-runbook.v1",
    failureDigest,
    retry: {
      eligible: Boolean(firstRetryable && !retryPolicy.exhausted && retryAt !== null),
      mode: retryPolicy.mode,
      attemptsRemaining: Math.max(retryPolicy.maxAttempts - retryPolicy.attempts, 0),
      nextRetryAt: retryAt,
      targetFailureCode: firstRetryable ? firstRetryable.code : null
    },
    providerRoutes: {
      blockedCount: providerServiceContract.blockedRouteCount,
      executionGatedCount: providerServiceContract.executionBlockedRouteCount,
      failures: routeFailures
    },
    operatorActions,
    proof: {
      generatedAt: now,
      routeCount: providerServiceContract.routes.length,
      failureCount: failures.length,
      retryExhausted: retryPolicy.exhausted
    }
  };
}

function buildOperationalHealth(input, syncMetadata, externalHandoff, recoveryContract, idempotentCommand, providerServiceContract, bootArtifactRoot, now) {
  const health = input && typeof input.health === "object" && input.health !== null ? input.health : {};
  const reportedStatus = typeof health.status === "string" && HEALTH_STATUSES.has(health.status)
    ? health.status
    : "healthy";
  const failureSignals = normalizeFailureSignals(health.failures, now);
  const retryPolicy = normalizeRetryPolicy(health.retryPolicy);
  const metadataValidation = bootArtifactRoot.rootMetadataValidation;
  const metadataFailureCode = metadataValidation.blocked
    ? "boot-root-metadata-blocked"
    : metadataValidation.staleReasons.includes("root-metadata-missing")
      ? "boot-root-metadata-missing"
      : metadataValidation.repairRequired
        ? "boot-root-metadata-stale"
        : null;
  const derivedFailures = [
    ...(metadataFailureCode ? [{
      code: metadataFailureCode,
      severity: metadataValidation.blocked ? "critical" : "warning",
      message: metadataValidation.blocked
        ? `Artifact root metadata blocked by ${metadataValidation.blockedReasons.join("|") || "unknown"}`
        : metadataValidation.repairRequired
          ? `Artifact root metadata requires ${metadataValidation.nextAction}: ${metadataValidation.staleReasons.join("|")}`
          : "Artifact root metadata is ready",
      retryable: metadataValidation.repairRequired && !metadataValidation.blocked,
      firstObservedAt: now,
      lastObservedAt: now,
      source: "boot-root-metadata"
    }] : []),
    ...syncMetadata.conflictPaths.map((path) => ({
      code: "sync-conflict",
      severity: "error",
      message: `Resolve conflicting artifact path ${path}`,
      retryable: false,
      firstObservedAt: now,
      lastObservedAt: now,
      source: "sync"
    })),
    ...(externalHandoff.state === "failed" ? [{
      code: "handoff-failed",
      severity: "error",
      message: externalHandoff.reason || "External handoff failed",
      retryable: Boolean(externalHandoff.providerId),
      firstObservedAt: now,
      lastObservedAt: now,
      source: "handoff"
    }] : []),
    ...(recoveryContract.restartSafeStatus === "blocked" ? [{
      code: "recovery-blocked",
      severity: "critical",
      message: "Artifact root recovery requires operator action",
      retryable: false,
      firstObservedAt: now,
      lastObservedAt: now,
      source: "recovery"
    }] : []),
    ...(idempotentCommand.status === "blocked" ? idempotentCommand.blockedReasons.map((reason) => ({
      code: `command-${reason}`,
      severity: "error",
      message: `Command ${idempotentCommand.commandId} blocked by ${reason}`,
      retryable: reason !== "acceptance-not-ready",
      firstObservedAt: now,
      lastObservedAt: now,
      source: "command"
    })) : []),
    ...providerServiceContract.routes
      .filter((route) => !route.routable)
      .map((route) => ({
        code: `provider-route-${route.intent}-blocked`,
        severity: route.intent === "read" || route.intent === "write" ? "error" : "warning",
        message: `${route.intent} provider route blocked by ${route.blockedReasons.join("|") || "unknown"}`,
        retryable: false,
        firstObservedAt: now,
        lastObservedAt: now,
        source: "provider-route"
      })),
    ...providerServiceContract.routes
      .filter((route) => route.routable && !route.executionReady)
      .map((route) => ({
        code: `provider-route-${route.intent}-execution-gated`,
        severity: route.intent === "write" ? "error" : "warning",
        message: `${route.intent} provider route gated by ${route.executionBlockedReasons.join("|") || "unknown"}`,
        retryable: false,
        firstObservedAt: now,
        lastObservedAt: now,
        source: "provider-route"
      }))
  ];
  const failures = [...failureSignals, ...derivedFailures];
  const criticalCount = failures.filter((failure) => failure.severity === "critical").length;
  const errorCount = failures.filter((failure) => failure.severity === "error").length;
  const retryableCount = failures.filter((failure) => failure.retryable).length;
  const readRoute = providerServiceContract.routes.find((route) => route.intent === "read") || null;
  const writeRoute = providerServiceContract.routes.find((route) => route.intent === "write") || null;
  const computedStatus = criticalCount > 0 || retryPolicy.exhausted
    ? "unhealthy"
    : errorCount > 0 || reportedStatus === "degraded"
      ? "degraded"
      : reportedStatus;
  const degradedMode = computedStatus !== "healthy";
  const failureRunbook = buildFailureRunbook(failures, retryPolicy, providerServiceContract, now);
  const degradedModeContract = {
    contractVersion: "artifact-root.degraded-mode.v1",
    active: degradedMode,
    readOnly: degradedMode && Boolean(readRoute && readRoute.routable),
    reasonCodes: failures.map((failure) => failure.code),
    safeOperations: [
      ...(readRoute && readRoute.routable ? ["read-preview", "refresh-preview"] : []),
      ...(metadataValidation.repairRequired && !metadataValidation.blocked ? [metadataValidation.nextAction] : []),
      "inspect-health",
      ...(recoveryContract.restartSafeStatus === "needs-recovery" ? ["run-recovery"] : []),
      ...(failureRunbook.retry.eligible ? ["retry-provider-operation"] : [])
    ],
    blockedOperations: [
      ...(!writeRoute || !writeRoute.executionReady ? ["commit-artifact-root"] : []),
      ...(metadataValidation.blocked ? ["rewrite-root-metadata"] : []),
      ...(computedStatus === "unhealthy" ? ["external-handoff", "export-audit-proof"] : [])
    ]
  };
  const actionableErrors = failures.map((failure) => ({
    code: failure.code,
    severity: failure.severity,
    action: failureRunbook.operatorActions.find((entry) => entry.code === failure.code)?.action || "operator-review",
    retryAt: failureRunbook.operatorActions.find((entry) => entry.code === failure.code)?.retryAt || null,
    detail: failure.message
  }));

  return {
    contractVersion: "artifact-root.operational-health.v1",
    status: computedStatus,
    reportedStatus,
    degradedMode,
    degradedModeContract,
    canServeReads: computedStatus !== "unhealthy" && Boolean(readRoute ? readRoute.routable : true),
    canServeWrites: computedStatus === "healthy"
      && recoveryContract.canResumeWrites
      && idempotentCommand.canExecute
      && Boolean(writeRoute ? writeRoute.executionReady : true),
    retryPolicy,
    failureCount: failures.length,
    retryableFailureCount: retryableCount,
    failures,
    actionableErrors,
    failureRunbook,
    proof: {
      bootRootMetadataStatus: metadataValidation.status,
      bootRootMetadataDigest: metadataValidation.proof.validationDigest,
      syncClean: syncMetadata.clean,
      recoveryStatus: recoveryContract.restartSafeStatus,
      commandStatus: idempotentCommand.status,
      handoffState: externalHandoff.state,
      providerRoutesRoutable: providerServiceContract.allRoutable,
      providerRoutesExecutionReady: providerServiceContract.allExecutionReady,
      failureDigest: failureRunbook.failureDigest
    }
  };
}

function normalizePreviewLimit(input) {
  const requested = input && Number.isInteger(input.previewLimit) ? input.previewLimit : DEFAULT_PREVIEW_LIMIT;
  return Math.min(Math.max(requested, 1), 100);
}

function decoratePreviewItem(item, syncMetadata, workspaceScope) {
  const inspectedPath = inspectArtifactPath(item.path, "artifact");
  const normalizedPath = inspectedPath.normalizedPath;
  const withinWorkspace = pathWithinPrefixes(normalizedPath, workspaceScope.allowedPrefixes);
  const pathSecurityBlocked = inspectedPath.securityReasons.length > 0;

  return {
    ...item,
    path: normalizedPath,
    dirty: syncMetadata.dirtyPaths.includes(item.path) || syncMetadata.dirtyPaths.includes(normalizedPath),
    conflict: syncMetadata.conflictPaths.includes(item.path) || syncMetadata.conflictPaths.includes(normalizedPath),
    withinWorkspace: withinWorkspace && !pathSecurityBlocked,
    boundaryReason: pathSecurityBlocked
      ? `unsafe-artifact-path:${inspectedPath.securityReasons.join("+")}`
      : withinWorkspace
        ? null
        : `outside-workspace:${workspaceScope.scopeKey}`,
    pathCanonical: inspectedPath.valid,
    pathDiagnostics: {
      originalPath: inspectedPath.originalPath,
      normalizedPath: inspectedPath.normalizedPath,
      canonicalPath: inspectedPath.canonicalPath,
      pathChanged: inspectedPath.pathChanged,
      reasons: inspectedPath.reasons,
      securityReasons: inspectedPath.securityReasons
    }
  };
}

function normalizePreviewItems(input, syncMetadata, limit, workspaceScope) {
  const items = Array.isArray(input.previewItems) ? input.previewItems : [];
  const normalizedItems = items
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const path = typeof item.path === "string" && item.path.length > 0 ? item.path : `artifact-${index + 1}`;
      const mutation = typeof item.mutation === "string" && WRITABLE_MUTATIONS.has(item.mutation)
        ? item.mutation
        : "update";
      const digest = typeof item.digest === "string" && item.digest.length > 0 ? item.digest : null;
      return {
        path,
        mutation,
        digest
      };
    })
    .map((item) => decoratePreviewItem(item, syncMetadata, workspaceScope))
    .slice(0, limit);

  if (normalizedItems.length > 0) {
    return normalizedItems;
  }

  return [...new Set([...syncMetadata.dirtyPaths, ...syncMetadata.conflictPaths])]
    .slice(0, limit)
    .map((path) => decoratePreviewItem({
      path: normalizeArtifactPath(path, "artifact"),
      mutation: "update",
      digest: null
    }, syncMetadata, workspaceScope));
}

function buildPathAccessManifest(input, workspaceScope, permissionContract, syncMetadata, previewContract) {
  const requestedPathRecords = [
    ...previewContract.visibleItems.map((item) => ({
      source: "preview",
      path: item.path,
      diagnostics: item.pathDiagnostics || inspectArtifactPath(item.path, "artifact")
    })),
    ...syncMetadata.dirtyPaths.map((path) => ({
      source: "sync-dirty",
      path,
      diagnostics: inspectArtifactPath(path, "artifact")
    })),
    ...syncMetadata.conflictPaths.map((path) => ({
      source: "sync-conflict",
      path,
      diagnostics: inspectArtifactPath(path, "artifact")
    })),
    ...(input.command && Array.isArray(input.command.paths) ? input.command.paths : []).map((path) => ({
      source: "command",
      path,
      diagnostics: inspectArtifactPath(path, "artifact")
    })),
    ...(input.handoff && Array.isArray(input.handoff.paths) ? input.handoff.paths : []).map((path) => ({
      source: "handoff",
      path,
      diagnostics: inspectArtifactPath(path, "artifact")
    }))
  ];
  const requestedPaths = normalizeStringList(requestedPathRecords.map((record) => record.diagnostics.normalizedPath));
  const diagnosticsByPath = requestedPathRecords.reduce((accumulator, record) => {
    const path = record.diagnostics.normalizedPath || record.diagnostics.canonicalPath || "artifact";
    const existing = accumulator.get(path) || {
      originalPaths: new Set(),
      sources: new Set(),
      reasons: new Set(),
      securityReasons: new Set(),
      changed: false
    };
    existing.originalPaths.add(record.diagnostics.originalPath);
    existing.sources.add(record.source);
    for (const reason of record.diagnostics.reasons) {
      existing.reasons.add(reason);
    }
    for (const reason of record.diagnostics.securityReasons) {
      existing.securityReasons.add(reason);
    }
    existing.changed = existing.changed || record.diagnostics.pathChanged;
    accumulator.set(path, existing);
    return accumulator;
  }, new Map());
  const pathSet = [...new Set(requestedPaths)];
  const previewByPath = new Map(previewContract.visibleItems.map((item) => [item.path, item]));
  const decisions = pathSet.map((path) => {
    const diagnostics = diagnosticsByPath.get(path) || {
      originalPaths: new Set([path]),
      sources: new Set(["unknown"]),
      reasons: new Set(),
      securityReasons: new Set(),
      changed: false
    };
    const securityReasons = [...diagnostics.securityReasons].sort();
    const sourceReasons = [...diagnostics.reasons].sort();
    const sources = [...diagnostics.sources].sort();
    const sourcePolicies = sources.map((source) => PATH_ACCESS_SOURCE_POLICIES[source] || {
      read: true,
      write: false,
      handoff: false,
      label: source
    });
    const previewItem = previewByPath.get(path) || null;
    const withinWorkspace = pathWithinPrefixes(path, workspaceScope.allowedPrefixes);
    const dirty = syncMetadata.dirtyPaths.includes(path) || Boolean(previewItem && previewItem.dirty);
    const conflict = syncMetadata.conflictPaths.includes(path) || Boolean(previewItem && previewItem.conflict);
    const writeMutation = Boolean(
      (previewItem && WRITABLE_MUTATIONS.has(previewItem.mutation))
      || dirty
      || sourcePolicies.some((policy) => policy.write)
    );
    const requiresRead = sourcePolicies.some((policy) => policy.read) || !writeMutation;
    const requiresWrite = writeMutation;
    const requiresHandoff = sourcePolicies.some((policy) => policy.handoff);
    const advisoryBoundary = workspaceScope.boundaryMode === "advisory" && !withinWorkspace;
    const enforcedBoundary = workspaceScope.boundaryMode === "enforced" && !withinWorkspace;
    const hardDeniedReasons = [
      ...securityReasons,
      ...(!permissionContract.scoped ? ["principal-outside-workspace-boundary"] : []),
      ...(requiresRead && !permissionContract.canRead ? ["missing-read-permission"] : []),
      ...(requiresWrite && !permissionContract.canWrite ? ["missing-write-permission"] : []),
      ...(requiresHandoff && !permissionContract.canHandoff ? ["missing-handoff-permission"] : []),
      ...(enforcedBoundary ? [`outside-workspace:${workspaceScope.scopeKey}`] : []),
      ...(conflict ? ["sync-conflict"] : [])
    ];
    const writeBlockedReasons = [
      ...(advisoryBoundary && requiresWrite ? [`advisory-boundary-write-block:${workspaceScope.scopeKey}`] : []),
      ...(advisoryBoundary && requiresHandoff ? [`advisory-boundary-handoff-block:${workspaceScope.scopeKey}`] : []),
      ...(requiresWrite && !permissionContract.canWrite ? ["missing-write-permission"] : []),
      ...(requiresHandoff && !permissionContract.canHandoff ? ["missing-handoff-permission"] : []),
      ...(conflict && requiresWrite ? ["sync-conflict"] : [])
    ];
    const readable = permissionContract.scoped
      && (!requiresRead || permissionContract.canRead)
      && !enforcedBoundary
      && securityReasons.length === 0;
    const writable = permissionContract.scoped
      && requiresWrite
      && permissionContract.canWrite
      && withinWorkspace
      && !conflict
      && securityReasons.length === 0;
    const decision = hardDeniedReasons.length > 0
      ? "deny"
      : writeBlockedReasons.length > 0
        ? "read-only"
        : "allow";

    return {
      path,
      normalizedPath: path,
      originalPaths: [...diagnostics.originalPaths].sort(),
      sources,
      requiredPermissions: normalizeStringList([
        ...(requiresRead ? ["artifact.root.sync.read"] : []),
        ...(requiresWrite ? ["artifact.root.sync.write"] : []),
        ...(requiresHandoff ? ["artifact.root.handoff.external"] : [])
      ]),
      pathCanonical: securityReasons.length === 0,
      pathChanged: diagnostics.changed,
      pathDiagnostics: {
        reasons: sourceReasons,
        securityReasons
      },
      mutation: previewItem ? previewItem.mutation : "update",
      digest: previewItem ? previewItem.digest : null,
      withinWorkspace: withinWorkspace && securityReasons.length === 0,
      dirty,
      conflict,
      boundaryMode: workspaceScope.boundaryMode,
      advisoryBoundary,
      readable,
      writable,
      decision,
      deniedReasons: hardDeniedReasons,
      writeBlockedReasons,
      auditRef: stableProofId([
        workspaceScope.scopeKey,
        permissionContract.principalId,
        path,
        hardDeniedReasons,
        writeBlockedReasons,
        [...diagnostics.originalPaths].sort()
      ])
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const denied = decisions.filter((decision) => decision.decision === "deny");
  const writeBlocked = decisions.filter((decision) => decision.writeBlockedReasons.length > 0);
  const writable = decisions.filter((decision) => decision.writable);
  const unsafe = decisions.filter((decision) => !decision.pathCanonical);
  const byReason = denied.reduce((accumulator, decision) => {
    for (const reason of decision.deniedReasons) {
      accumulator[reason] = (accumulator[reason] || 0) + 1;
    }
    return accumulator;
  }, {});
  const writeBlockReasonCounts = writeBlocked.reduce((accumulator, decision) => {
    for (const reason of decision.writeBlockedReasons) {
      accumulator[reason] = (accumulator[reason] || 0) + 1;
    }
    return accumulator;
  }, {});

  return {
    contractVersion: "artifact-root.path-access-manifest.v1",
    scopeKey: workspaceScope.scopeKey,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    boundaryMode: workspaceScope.boundaryMode,
    totalPathCount: decisions.length,
    allowedPathCount: decisions.length - denied.length,
    deniedPathCount: denied.length,
    writeBlockedPathCount: writeBlocked.length,
    unsafePathCount: unsafe.length,
    writablePathCount: writable.length,
    decisions,
    deniedPaths: denied.map((decision) => ({
      path: decision.path,
      originalPaths: decision.originalPaths,
      deniedReasons: decision.deniedReasons,
      auditRef: decision.auditRef
    })),
    unsafePaths: unsafe.map((decision) => ({
      path: decision.path,
      originalPaths: decision.originalPaths,
      securityReasons: decision.pathDiagnostics.securityReasons,
      auditRef: decision.auditRef
    })),
    writeBlockedPaths: writeBlocked.map((decision) => ({
      path: decision.path,
      originalPaths: decision.originalPaths,
      writeBlockedReasons: decision.writeBlockedReasons,
      auditRef: decision.auditRef
    })),
    auditHandoff: {
      required: denied.length > 0 || writeBlocked.length > 0 || unsafe.length > 0,
      reasonCounts: {
        ...byReason,
        ...Object.fromEntries(Object.entries(writeBlockReasonCounts).map(([reason, count]) => [`write:${reason}`, count]))
      },
      refs: normalizeStringList([
        ...denied.map((decision) => decision.auditRef),
        ...writeBlocked.map((decision) => decision.auditRef),
        ...unsafe.map((decision) => decision.auditRef)
      ])
    },
    safeForCommit: denied.length === 0
      && writeBlocked.length === 0
      && decisions.length > 0
      && permissionContract.canWrite
      && previewContract.summary.conflictCount === 0,
    reasonCounts: byReason,
    writeBlockReasonCounts,
    proof: {
      scoped: permissionContract.scoped,
      allowedPrefixes: workspaceScope.allowedPrefixes,
      cursor: syncMetadata.cursor,
      manifestDigest: stableProofId(decisions.map((decision) => [
        decision.path,
        decision.decision,
        decision.deniedReasons,
        decision.writeBlockedReasons,
        decision.auditRef,
        decision.originalPaths
      ]))
    }
  };
}

function buildExternalHandoff(input, providers, syncMetadata, permissionContract, now) {
  const handoff = input && typeof input.handoff === "object" && input.handoff !== null ? input.handoff : {};
  const requestedState = typeof handoff.state === "string" && HANDOFF_STATES.has(handoff.state) ? handoff.state : "none";
  const capableProvider = providers.find((provider) => provider.acceptsExternalHandoff);
  const deniedByPermission = requestedState !== "none" && !permissionContract.canHandoff;
  const state = deniedByPermission || (requestedState === "none" && !capableProvider) ? "failed" : requestedState;
  const reason = deniedByPermission
    ? "principal-missing-handoff-permission"
    : !capableProvider
      ? "no-provider-accepts-external-handoff"
      : undefined;

  return {
    state,
    providerId: capableProvider ? capableProvider.providerId : null,
    destination: typeof handoff.destination === "string" && handoff.destination.length > 0 ? handoff.destination : null,
    exportedAt: state === "exported" || state === "acknowledged" ? toIsoTimestamp(handoff.exportedAt, now) : null,
    requiresAck: state === "pending" || state === "exported",
    blockedByConflicts: syncMetadata.conflictPaths.length > 0,
    permissionScoped: permissionContract.scoped,
    reason
  };
}

function buildAuditProof(root, workspaceScope, permissionContract, capabilityContract, syncMetadata, pathAccessManifest, handoff, input) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const inputProofs = normalizeStringList(evidence);
  const status = permissionContract.canAudit
    && capabilityContract.denied.length === 0
    && pathAccessManifest.deniedPathCount === 0
    && pathAccessManifest.writeBlockedPathCount === 0
    && !handoff.blockedByConflicts
    && handoff.state !== "failed"
    ? "ready"
    : "needs-attention";

  return {
    status,
    subject: root.uri,
    proofType: "artifact-root-provider-contract",
    checks: {
      providerCapabilityMatched: capabilityContract.denied.length === 0,
      principalWithinTenantBoundary: permissionContract.scoped,
      auditPermissionGranted: permissionContract.canAudit,
      syncHasStableCursor: syncMetadata.cursor.length > 0,
      pathAccessManifestClean: pathAccessManifest.deniedPathCount === 0,
      pathAccessWritesAllowed: pathAccessManifest.writeBlockedPathCount === 0,
      externalHandoffRoutable: handoff.state === "none" || Boolean(handoff.providerId),
      noSyncConflicts: syncMetadata.conflictPaths.length === 0
    },
    evidence: [
      `contract:${ARTIFACT_ROOT_CONTRACT_VERSION}`,
      `tenant:${workspaceScope.tenantId}`,
      `workspace:${workspaceScope.workspaceId}`,
      `principal:${permissionContract.principalId}`,
      `root:${root.namespace}:${root.generation}`,
      `sync:${syncMetadata.cursor}`,
      `path-access:${pathAccessManifest.proof.manifestDigest}:${pathAccessManifest.allowedPathCount}/${pathAccessManifest.totalPathCount}`,
      `path-access-write-blocks:${pathAccessManifest.writeBlockedPathCount}:${pathAccessManifest.auditHandoff.refs.join(",") || "none"}`,
      ...inputProofs
    ]
  };
}

function buildPreviewContract(input, root, workspaceScope, syncMetadata, capabilityContract, permissionContract) {
  const limit = normalizePreviewLimit(input);
  const items = normalizePreviewItems(input, syncMetadata, limit, workspaceScope);
  const conflictCount = items.filter((item) => item.conflict).length;
  const boundaryViolationCount = items.filter((item) => !item.withinWorkspace).length;

  return {
    contractVersion: "artifact-root.preview.v1",
    rootUri: root.uri,
    scopeKey: workspaceScope.scopeKey,
    cursor: syncMetadata.cursor,
    limit,
    totalItems: items.length,
    visibleItems: items,
    summary: {
      dirtyCount: items.filter((item) => item.dirty).length,
      conflictCount,
      boundaryViolationCount,
      hiddenBecauseOfLimit: Array.isArray(input.previewItems) ? Math.max(input.previewItems.length - limit, 0) : 0
    },
    actions: {
      canApply: capabilityContract.writable && permissionContract.canWrite && conflictCount === 0 && boundaryViolationCount === 0,
      canExport: capabilityContract.granted.includes("artifact.root.handoff.external") && permissionContract.canHandoff,
      canRefresh: capabilityContract.granted.includes("artifact.root.sync.read") && permissionContract.canRead
    }
  };
}

function buildAcceptanceContract(input, previewContract, pathAccessManifest, capabilityContract, permissionContract, syncMetadata, externalHandoff) {
  const acceptance = input && typeof input.acceptance === "object" && input.acceptance !== null ? input.acceptance : {};
  const decision = typeof acceptance.decision === "string" && ACCEPTANCE_DECISIONS.has(acceptance.decision)
    ? acceptance.decision
    : "pending";
  const acceptedBy = typeof acceptance.acceptedBy === "string" && acceptance.acceptedBy.length > 0
    ? acceptance.acceptedBy
    : null;
  const blockers = [
    ...capabilityContract.denied.map((denial) => `capability:${denial.capability}`),
    ...permissionContract.boundaryFailures.map((failure) => `permission:${failure.code}`),
    ...syncMetadata.conflictPaths.map((path) => `conflict:${path}`),
    ...previewContract.visibleItems
      .filter((item) => !item.withinWorkspace)
      .map((item) => `boundary:${item.path}`),
    ...pathAccessManifest.deniedPaths.map((entry) => `path-access:${entry.path}:${entry.deniedReasons.join("+")}`),
    ...pathAccessManifest.writeBlockedPaths.map((entry) => `path-write-blocked:${entry.path}:${entry.writeBlockedReasons.join("+")}`),
    ...(externalHandoff.state === "failed" ? ["handoff:failed"] : [])
  ];

  return {
    contractVersion: "artifact-root.acceptance.v1",
    decision,
    acceptedBy,
    acceptedAt: decision === "accepted" ? toIsoTimestamp(acceptance.acceptedAt) : null,
    readyForCommit: decision === "accepted" && blockers.length === 0 && previewContract.actions.canApply && pathAccessManifest.safeForCommit,
    requiresReview: decision !== "accepted" || blockers.length > 0,
    blockers,
    proof: {
      previewCursor: previewContract.cursor,
      previewItemCount: previewContract.totalItems,
      pathAccessDigest: pathAccessManifest.proof.manifestDigest,
      workspaceScoped: permissionContract.scoped,
      writeCapabilityGranted: capabilityContract.writable
    }
  };
}

function buildValidationSummary(
  workspaceScope,
  permissionContract,
  capabilityContract,
  syncMetadata,
  externalHandoff,
  previewContract,
  pathAccessManifest,
  acceptanceContract,
  recoveryContract,
  idempotentCommand,
  lifecycleSettingsControl,
  operationalHealth,
  providerServiceContract,
  providerSyncRegistry
) {
  const failures = [
    ...(workspaceScope.rootNamespaceMatches ? [] : [{
      code: "workspace-root-diverged",
      detail: `${workspaceScope.workspaceId}:${workspaceScope.allowedPrefixes.join("|")}`
    }]),
    ...permissionContract.boundaryFailures.map((failure) => ({
      code: "permission-boundary-failed",
      detail: `${failure.code}:${failure.detail}`
    })),
    ...capabilityContract.denied.map((denial) => ({
      code: "capability-denied",
      detail: `${denial.capability}:${denial.reason}`
    })),
    ...syncMetadata.conflictPaths.map((path) => ({ code: "sync-conflict", detail: path })),
    ...previewContract.visibleItems
      .filter((item) => !item.withinWorkspace)
      .map((item) => ({ code: "workspace-boundary-violation", detail: item.path })),
    ...pathAccessManifest.deniedPaths.map((entry) => ({
      code: "path-access-denied",
      detail: `${entry.path}:${entry.deniedReasons.join("|")}`
    })),
    ...pathAccessManifest.writeBlockedPaths.map((entry) => ({
      code: "path-access-write-blocked",
      detail: `${entry.path}:${entry.writeBlockedReasons.join("|")}`
    })),
    ...(externalHandoff.state === "failed" ? [{ code: "handoff-unavailable", detail: externalHandoff.reason }] : []),
    ...(acceptanceContract.decision === "rejected" ? [{ code: "acceptance-rejected", detail: "user-rejected-preview" }] : []),
    ...(recoveryContract.restartSafeStatus === "blocked"
      ? [{ code: "restart-recovery-blocked", detail: "artifact-root-recovery-requires-operator-action" }]
      : []),
    ...(idempotentCommand.status === "blocked"
      ? idempotentCommand.blockedReasons.map((reason) => ({ code: "command-blocked", detail: reason }))
      : []),
    ...lifecycleSettingsControl.validation.errors.map((error) => ({
      code: "lifecycle-settings-invalid",
      detail: error
    })),
    ...(operationalHealth.status === "unhealthy"
      ? [{ code: "operational-health-unhealthy", detail: `${operationalHealth.failureCount}:failures` }]
      : []),
    ...providerServiceContract.routes
      .filter((route) => !route.routable && route.intent !== "audit")
      .map((route) => ({
        code: "provider-route-blocked",
        detail: `${route.intent}:${route.blockedReasons.join("|")}`
      })),
    ...providerSyncRegistry.entries
      .filter((entry) => entry.syncState === "quarantined")
      .map((entry) => ({
        code: "provider-quarantined",
        detail: `${entry.providerId}:${entry.cursor}`
      }))
  ];
  const warnings = [
    ...(previewContract.totalItems === 0 ? [{ code: "empty-preview", detail: "no-visible-artifact-changes" }] : []),
    ...(pathAccessManifest.totalPathCount === 0 ? [{ code: "empty-path-access-manifest", detail: syncMetadata.cursor }] : []),
    ...(workspaceScope.boundaryMode === "advisory"
      ? [{ code: "workspace-boundary-advisory", detail: workspaceScope.scopeKey }]
      : []),
    ...(!permissionContract.canAudit ? [{ code: "audit-proof-limited", detail: permissionContract.principalId }] : []),
    ...(externalHandoff.requiresAck ? [{ code: "handoff-awaiting-ack", detail: externalHandoff.state }] : []),
    ...(recoveryContract.restartSafeStatus === "needs-recovery"
      ? [{ code: "restart-recovery-needed", detail: recoveryContract.replayableCommandIds.join(",") || "checkpoint" }]
      : []),
    ...(idempotentCommand.alreadyApplied
      ? [{ code: "idempotent-command-reused", detail: idempotentCommand.commandId }]
      : []),
    ...(idempotentCommand.canReplay
      ? [{ code: "command-replay-available", detail: idempotentCommand.commandId }]
      : []),
    ...(!lifecycleSettingsControl.commandGate.runnableNow
      ? [{ code: "lifecycle-command-gated", detail: lifecycleSettingsControl.commandGate.blockedReasons.join("|") }]
      : []),
    ...(operationalHealth.degradedMode && operationalHealth.status !== "unhealthy"
      ? [{ code: "operational-health-degraded", detail: `${operationalHealth.retryableFailureCount}:retryable` }]
      : []),
    ...providerServiceContract.routes
      .filter((route) => !route.routable && route.intent === "audit")
      .map((route) => ({
        code: "audit-provider-route-limited",
        detail: route.blockedReasons.join("|")
      })),
    ...providerSyncRegistry.ignoredRecords.map((record) => ({
      code: "provider-sync-record-ignored",
      detail: `${record.recordRef}:${record.providerId || "missing"}:${record.reason}`
    })),
    ...providerSyncRegistry.duplicateRecords.map((record) => ({
      code: "provider-sync-record-duplicate",
      detail: `${record.providerId}:${record.previousRecordRef}->${record.replacementRecordRef}`
    })),
    ...providerServiceContract.routes
      .filter((route) => route.routable && !route.executionReady)
      .map((route) => ({
        code: "provider-route-execution-gated",
        detail: `${route.intent}:${route.executionBlockedReasons.join("|")}`
      })),
    ...(providerServiceContract.externalHandoff.requiresAck
      ? [{ code: "provider-handoff-route-awaiting-ack", detail: providerServiceContract.externalHandoff.state }]
      : []),
    ...providerSyncRegistry.entries
      .filter((entry) => entry.syncState === "stale" || entry.syncState === "catching-up")
      .map((entry) => ({
        code: "provider-sync-lag",
        detail: `${entry.providerId}:${entry.syncState}:${entry.lagGenerations}`
      })),
    ...providerSyncRegistry.entries
      .filter((entry) => entry.leaseExpired)
      .map((entry) => ({
        code: "provider-lease-expired",
        detail: `${entry.providerId}:${entry.leaseExpiresAt}`
      }))
  ];

  return {
    contractVersion: "artifact-root.validation-summary.v1",
    scopeKey: workspaceScope.scopeKey,
    valid: failures.length === 0,
    failureCount: failures.length,
    warningCount: warnings.length,
    failures,
    warnings
  };
}

function buildReadinessAndNextSteps(
  workspaceScope,
  permissionContract,
  validationSummary,
  previewContract,
  pathAccessManifest,
  acceptanceContract,
  externalHandoff,
  recoveryContract,
  idempotentCommand,
  lifecycleSettingsControl,
  operationalHealth
) {
  const ready = validationSummary.valid
    && acceptanceContract.readyForCommit
    && recoveryContract.canResumeWrites
    && (idempotentCommand.canExecute || idempotentCommand.alreadyApplied)
    && operationalHealth.canServeWrites;
  const nextSteps = [];

  if (!permissionContract.scoped) {
    nextSteps.push({ action: "switch-principal-or-workspace", reason: "principal-outside-tenant-boundary" });
  }
  if (!workspaceScope.rootNamespaceMatches) {
    nextSteps.push({ action: "remount-workspace-root", reason: "workspace-does-not-match-root-namespace" });
  }
  if (!previewContract.actions.canRefresh) {
    nextSteps.push({ action: "select-provider", reason: "sync-read-capability-required" });
  }
  if (previewContract.summary.boundaryViolationCount > 0) {
    nextSteps.push({ action: "remove-out-of-scope-paths", reason: "preview-crosses-workspace-boundary" });
  }
  if (pathAccessManifest.deniedPathCount > 0) {
    nextSteps.push({ action: "review-path-access-manifest", reason: `${pathAccessManifest.deniedPathCount}:denied-paths` });
  }
  if (pathAccessManifest.writeBlockedPathCount > 0) {
    nextSteps.push({ action: "remove-write-blocked-paths", reason: `${pathAccessManifest.writeBlockedPathCount}:write-blocked-paths` });
  }
  if (previewContract.summary.conflictCount > 0) {
    nextSteps.push({ action: "resolve-conflicts", reason: "preview-contains-conflicting-paths" });
  }
  if (acceptanceContract.decision === "pending") {
    nextSteps.push({ action: "accept-preview", reason: "operator-acceptance-required" });
  }
  if (externalHandoff.requiresAck) {
    nextSteps.push({ action: "await-external-ack", reason: `handoff-${externalHandoff.state}` });
  }
  if (recoveryContract.restartSafeStatus === "needs-recovery") {
    nextSteps.push({ action: "run-recovery", reason: "restart-state-requires-replay" });
  }
  if (recoveryContract.restartSafeStatus === "blocked") {
    nextSteps.push({ action: "inspect-recovery-blocker", reason: "restart-recovery-blocked" });
  }
  if (idempotentCommand.canReplay) {
    nextSteps.push({ action: "resume-command", reason: idempotentCommand.commandId });
  }
  if (idempotentCommand.alreadyApplied) {
    nextSteps.push({ action: "return-cached-command-result", reason: idempotentCommand.commandId });
  }
  if (lifecycleSettingsControl.controls.requested.action) {
    nextSteps.push({
      action: "apply-lifecycle-control",
      reason: lifecycleSettingsControl.controls.requestedExecutable
        ? lifecycleSettingsControl.controls.requested.action
        : lifecycleSettingsControl.controls.requestedBlockedReasons.join("|") || "lifecycle-control-blocked"
    });
  }
  if (!lifecycleSettingsControl.validation.valid) {
    nextSteps.push({
      action: "fix-lifecycle-settings",
      reason: lifecycleSettingsControl.validation.errors.join("|")
    });
  } else if (!lifecycleSettingsControl.commandGate.runnableNow) {
    nextSteps.push({
      action: lifecycleSettingsControl.commandGate.nextAction,
      reason: lifecycleSettingsControl.commandGate.blockedReasons.join("|")
    });
  }
  if (operationalHealth.status === "unhealthy") {
    nextSteps.push({ action: "inspect-operational-health", reason: "health-status-unhealthy" });
  }
  if (operationalHealth.degradedMode && operationalHealth.retryPolicy.nextDelayMs !== null) {
    nextSteps.push({ action: "retry-after-backoff", reason: `${operationalHealth.retryPolicy.nextDelayMs}ms` });
  }
  if (operationalHealth.degradedMode && operationalHealth.retryPolicy.exhausted) {
    nextSteps.push({ action: "escalate-to-operator", reason: "retry-budget-exhausted" });
  }
  if (ready) {
    nextSteps.push({ action: "commit-artifact-root", reason: "accepted-preview-valid" });
  }

  return {
    readiness: ready
      ? "ready"
      : operationalHealth.status === "unhealthy"
        ? "unhealthy"
        : operationalHealth.degradedMode
          ? "degraded"
          : recoveryContract.restartSafeStatus !== "clean"
        ? recoveryContract.restartSafeStatus
        : !lifecycleSettingsControl.commandGate.runnableNow
          ? "lifecycle-gated"
        : validationSummary.valid
          ? "awaiting-acceptance"
          : "blocked",
    ready,
    nextSteps
  };
}

function normalizeHistorySnapshot(value, fallback, now) {
  const snapshot = value && typeof value === "object" ? value : {};
  const capturedAt = toIsoTimestamp(snapshot.capturedAt, now);
  const cursor = typeof snapshot.cursor === "string" && snapshot.cursor.length > 0 ? snapshot.cursor : fallback.cursor;
  const snapshotId = typeof snapshot.snapshotId === "string" && snapshot.snapshotId.length > 0
    ? snapshot.snapshotId
    : `${cursor}:${capturedAt}`;

  return {
    snapshotId,
    capturedAt,
    cursor,
    rootGeneration: normalizeNonNegativeInteger(snapshot.rootGeneration, fallback.rootGeneration),
    dirtyCount: normalizeNonNegativeInteger(snapshot.dirtyCount, fallback.dirtyCount),
    conflictCount: normalizeNonNegativeInteger(snapshot.conflictCount, fallback.conflictCount),
    journalPendingCount: normalizeNonNegativeInteger(snapshot.journalPendingCount, fallback.journalPendingCount),
    journalFailedCount: normalizeNonNegativeInteger(snapshot.journalFailedCount, fallback.journalFailedCount),
    readiness: typeof snapshot.readiness === "string" && snapshot.readiness.length > 0
      ? snapshot.readiness
      : fallback.readiness,
    healthStatus: typeof snapshot.healthStatus === "string" && HEALTH_STATUSES.has(snapshot.healthStatus)
      ? snapshot.healthStatus
      : fallback.healthStatus
  };
}

function buildHistorySnapshots(input, root, syncMetadata, persistedState, readinessContract, operationalHealth, now) {
  const fallback = {
    cursor: syncMetadata.cursor,
    rootGeneration: root.generation,
    dirtyCount: syncMetadata.dirtyPaths.length,
    conflictCount: syncMetadata.conflictPaths.length,
    journalPendingCount: persistedState.pendingJournalCount,
    journalFailedCount: persistedState.failedJournalCount,
    readiness: readinessContract.readiness,
    healthStatus: operationalHealth.status
  };
  const supplied = Array.isArray(input.historySnapshots) ? input.historySnapshots : [];
  const current = normalizeHistorySnapshot({
    snapshotId: `current:${syncMetadata.cursor}`,
    capturedAt: now
  }, fallback, now);
  const snapshotsById = new Map([
    ...supplied.map((snapshot) => {
      const normalized = normalizeHistorySnapshot(snapshot, fallback, now);
      return [normalized.snapshotId, normalized];
    }),
    [current.snapshotId, current]
  ]);

  return [...snapshotsById.values()]
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.snapshotId.localeCompare(b.snapshotId));
}

function buildAnalyticsCounters(
  root,
  workspaceScope,
  permissionContract,
  capabilityContract,
  syncMetadata,
  previewContract,
  pathAccessManifest,
  persistedState,
  recoveryContract,
  idempotentCommand,
  lifecycleSettingsControl,
  operationalHealth,
  readinessContract,
  historySnapshots,
  providerServiceContract,
  providerSyncRegistry
) {
  const mutationCounts = Object.fromEntries([...WRITABLE_MUTATIONS].map((mutation) => [mutation, 0]));
  for (const item of previewContract.visibleItems) {
    mutationCounts[item.mutation] += 1;
  }

  return {
    contractVersion: "artifact-root.analytics-counters.v1",
    scopeKey: workspaceScope.scopeKey,
    rootGeneration: root.generation,
    counters: {
      previewItems: previewContract.totalItems,
      dirtyPaths: syncMetadata.dirtyPaths.length,
      conflictPaths: syncMetadata.conflictPaths.length,
      boundaryViolations: previewContract.summary.boundaryViolationCount,
      pathAccessDecisions: pathAccessManifest.totalPathCount,
      deniedPathAccessDecisions: pathAccessManifest.deniedPathCount,
      writeBlockedPathAccessDecisions: pathAccessManifest.writeBlockedPathCount,
      writablePathAccessDecisions: pathAccessManifest.writablePathCount,
      grantedCapabilities: capabilityContract.granted.length,
      deniedCapabilities: capabilityContract.denied.length,
      appliedJournalEntries: persistedState.journal.filter((entry) => entry.state === "applied").length,
      pendingJournalEntries: persistedState.pendingJournalCount,
      failedJournalEntries: persistedState.failedJournalCount,
      recoverySteps: recoveryContract.recoverySteps.length,
      commandBlockedReasons: idempotentCommand.blockedReasons.length,
      lifecycleBlockedReasons: lifecycleSettingsControl.commandGate.blockedReasons.length,
      lifecycleAvailableControls: lifecycleSettingsControl.controls.availableActions.length,
      lifecycleExecutableControls: lifecycleSettingsControl.controls.availableActions.filter((control) => control.enabled).length,
      lifecycleRequestedControls: lifecycleSettingsControl.controls.requested.action ? 1 : 0,
      healthFailures: operationalHealth.failureCount,
      retryableHealthFailures: operationalHealth.retryableFailureCount,
      nextSteps: readinessContract.nextSteps.length,
      historySnapshots: historySnapshots.length,
      providerRoutes: providerServiceContract.routes.length,
      blockedProviderRoutes: providerServiceContract.blockedRouteCount,
      executionGatedProviderRoutes: providerServiceContract.executionBlockedRouteCount,
      activeProviders: providerServiceContract.activeProviderIds.length,
      providerSyncInputRecords: providerSyncRegistry.inputRecordCount,
      acceptedProviderSyncRecords: providerSyncRegistry.acceptedRecordCount,
      ignoredProviderSyncRecords: providerSyncRegistry.ignoredRecordCount,
      duplicateProviderSyncRecords: providerSyncRegistry.duplicateRecordCount,
      currentProviderSyncStates: providerSyncRegistry.currentProviderCount,
      staleProviderSyncStates: providerSyncRegistry.staleProviderCount,
      blockedProviderSyncStates: providerSyncRegistry.blockedProviderCount
    },
    mutationCounts,
    permissionCounters: {
      roleCount: permissionContract.roles.length,
      explicitWorkspaceCount: permissionContract.workspaceIds.length,
      boundaryFailureCount: permissionContract.boundaryFailures.length,
      allowedPermissionCount: permissionContract.allowedPermissions.length
    },
    stateFlags: {
      scoped: permissionContract.scoped,
      cleanSync: syncMetadata.clean,
      durableCheckpoint: persistedState.durable,
      replayRequired: persistedState.replayRequired,
      commandCanExecute: idempotentCommand.canExecute,
      commandCanReplay: idempotentCommand.canReplay,
      lifecycleEnabled: lifecycleSettingsControl.enabled,
      lifecycleWritesEnabled: lifecycleSettingsControl.writesEnabled,
      lifecycleScheduleDue: lifecycleSettingsControl.schedule.dueNow,
      canServeReads: operationalHealth.canServeReads,
      canServeWrites: operationalHealth.canServeWrites,
      providerRoutesRoutable: providerServiceContract.allRoutable,
      providerRoutesExecutionReady: providerServiceContract.allExecutionReady,
      providerSyncCurrent: providerSyncRegistry.staleProviderCount === 0 && providerSyncRegistry.blockedProviderCount === 0,
      ready: readinessContract.ready
    },
    pathAccessReasonCounts: pathAccessManifest.reasonCounts,
    pathAccessWriteBlockReasonCounts: pathAccessManifest.writeBlockReasonCounts
  };
}

function buildTimelineReport(
  historySnapshots,
  persistedState,
  acceptanceContract,
  externalHandoff,
  lifecycleSettingsControl,
  operationalHealth,
  readinessContract,
  now
) {
  const entries = [
    ...historySnapshots.map((snapshot) => ({
      occurredAt: snapshot.capturedAt,
      eventType: "snapshot",
      label: `snapshot:${snapshot.snapshotId}`,
      state: snapshot.readiness,
      proofRef: snapshot.cursor
    })),
    {
      occurredAt: persistedState.lastCheckpointAt,
      eventType: "checkpoint",
      label: `checkpoint:${persistedState.checkpointCursor}`,
      state: persistedState.restartStatus,
      proofRef: `${persistedState.checkpointCursor}:${persistedState.checkpointGeneration}`
    },
    ...persistedState.journal.map((entry) => ({
      occurredAt: entry.recordedAt,
      eventType: "journal",
      label: entry.commandId,
      state: entry.state,
      proofRef: entry.cursor || entry.commandType
    })),
    ...(acceptanceContract.acceptedAt ? [{
      occurredAt: acceptanceContract.acceptedAt,
      eventType: "acceptance",
      label: acceptanceContract.acceptedBy || "accepted-preview",
      state: acceptanceContract.decision,
      proofRef: acceptanceContract.proof.previewCursor
    }] : []),
    ...(externalHandoff.exportedAt ? [{
      occurredAt: externalHandoff.exportedAt,
      eventType: "handoff",
      label: externalHandoff.providerId || "external-handoff",
      state: externalHandoff.state,
      proofRef: externalHandoff.destination || externalHandoff.state
    }] : []),
    {
      occurredAt: now,
      eventType: "health",
      label: `lifecycle:${lifecycleSettingsControl.enablement}:${lifecycleSettingsControl.schedule.mode}`,
      state: lifecycleSettingsControl.commandGate.runnableNow ? "info" : "warning",
      proofRef: lifecycleSettingsControl.commandGate.nextAction
    },
    ...operationalHealth.failures.map((failure) => ({
      occurredAt: failure.lastObservedAt,
      eventType: "health",
      label: failure.code,
      state: failure.severity,
      proofRef: failure.source
    })),
    {
      occurredAt: now,
      eventType: "readiness",
      label: "current-readiness",
      state: readinessContract.readiness,
      proofRef: readinessContract.ready ? "ready" : "not-ready"
    }
  ].filter((entry) => TIMELINE_EVENT_TYPES.has(entry.eventType));

  return {
    contractVersion: "artifact-root.timeline-report.v1",
    generatedAt: now,
    entryCount: entries.length,
    entries: entries
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventType.localeCompare(b.eventType))
      .slice(-100),
    latestState: readinessContract.readiness,
    openFailureCount: operationalHealth.failures.length
  };
}

function buildExportSummary(
  input,
  analyticsCounters,
  historySnapshots,
  timelineReport,
  auditProof,
  readinessContract,
  permissionContract,
  providerServiceContract
) {
  const exportRequest = input && typeof input.export === "object" && input.export !== null ? input.export : {};
  const requestedFormats = normalizeStringList(exportRequest.formats).filter((format) => EXPORT_FORMATS.has(format));
  const formats = requestedFormats.length > 0 ? requestedFormats : ["json"];
  const includeTimeline = exportRequest.includeTimeline !== false;
  const includeHistory = exportRequest.includeHistory !== false;
  const sections = [
    "analyticsCounters",
    ...(includeHistory ? ["historySnapshots"] : []),
    ...(includeTimeline ? ["timelineReport"] : []),
    "providerServiceContract",
    "auditProof"
  ];
  const blockedReasons = [
    ...(!permissionContract.canAudit ? ["missing-audit-permission"] : []),
    ...(auditProof.status !== "ready" ? ["audit-proof-needs-attention"] : []),
    ...(!readinessContract.ready ? [`readiness:${readinessContract.readiness}`] : []),
    ...(!providerServiceContract.allRoutable ? [`provider-routes:${providerServiceContract.blockedRouteCount}`] : [])
  ];

  return {
    contractVersion: "artifact-root.export-summary.v1",
    exportId: typeof exportRequest.exportId === "string" && exportRequest.exportId.length > 0
      ? exportRequest.exportId
      : `artifact-root-export:${analyticsCounters.scopeKey}:${timelineReport.generatedAt}`,
    formats,
    sections,
    exportable: blockedReasons.length === 0,
    blockedReasons,
    rowCounts: {
      counterRows: Object.keys(analyticsCounters.counters).length,
      mutationRows: Object.keys(analyticsCounters.mutationCounts).length,
      historyRows: includeHistory ? historySnapshots.length : 0,
      timelineRows: includeTimeline ? timelineReport.entryCount : 0,
      providerRouteRows: providerServiceContract.routes.length,
      evidenceRows: auditProof.evidence.length
    },
    summary: {
      readiness: readinessContract.readiness,
      healthFailures: analyticsCounters.counters.healthFailures,
      conflictPaths: analyticsCounters.counters.conflictPaths,
      deniedCapabilities: analyticsCounters.counters.deniedCapabilities,
      blockedProviderRoutes: providerServiceContract.blockedRouteCount,
      executionGatedProviderRoutes: providerServiceContract.executionBlockedRouteCount
    }
  };
}

function stableProofId(parts) {
  const normalized = parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map((part) => String(part ?? ""))
    .join("|");
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function normalizeBootBasePath(value) {
  const inspected = inspectArtifactPath(value, "boot");
  return inspected.valid ? inspected.normalizedPath : "boot";
}

function selectBootNamespaceBasePath(boot, workspaceScope) {
  const requestedBasePath = typeof boot.basePath === "string" && boot.basePath.trim()
    ? normalizeBootBasePath(boot.basePath)
    : "boot";
  const boundaryAnchors = workspaceScope.allowedPrefixes
    .map((prefix) => normalizeBoundaryPrefix(prefix))
    .filter((prefix) => prefix.length > 0);
  const defaultAnchor = boundaryAnchors[0] || "";
  const requestedWithinBoundary = workspaceScope.boundaryMode !== "enforced"
    || pathWithinPrefixes(requestedBasePath, workspaceScope.allowedPrefixes);
  const namespaceBasePath = requestedWithinBoundary
    ? requestedBasePath
    : normalizeArtifactPath(`${defaultAnchor}${ARTIFACT_ROOT_BOOT_NAMESPACE}`, ARTIFACT_ROOT_BOOT_NAMESPACE);

  return {
    requestedBasePath,
    namespaceBasePath,
    boundaryAnchor: defaultAnchor,
    requestedWithinBoundary,
    remappedForBoundary: requestedBasePath !== namespaceBasePath,
    remapReason: requestedWithinBoundary ? null : "boot-base-outside-workspace-boundary"
  };
}

function buildBootPathAliases(requiredArtifactSpecs, rootPrefix, namespaceBasePath) {
  return Object.fromEntries(requiredArtifactSpecs.map((artifact) => {
    const legacyPath = `${namespaceBasePath}/${artifact.relativePath}`;
    const bootRelativePath = artifact.path.startsWith(`${rootPrefix}/`)
      ? artifact.path.slice(rootPrefix.length + 1)
      : artifact.relativePath;

    return [artifact.key, {
      canonicalPath: artifact.path,
      rootRelativePath: bootRelativePath,
      legacyPath,
      contentAddressPath: artifact.contentAddressPath,
      uri: artifact.uri
    }];
  }));
}

function buildBootInitializationGuard(namespaceLayout, requiredArtifacts, workspaceScope) {
  const missingWritableArtifacts = requiredArtifacts.filter((artifact) => !artifact.writable);
  const missingWritablePaths = missingWritableArtifacts.map((artifact) => artifact.path);
  const requiredKeys = Object.keys(BOOT_ARTIFACT_PATHS);
  const presentRequiredKeys = new Set(requiredArtifacts.map((artifact) => artifact.key));
  const missingRequiredKeys = requiredKeys.filter((key) => !presentRequiredKeys.has(key));
  const duplicatePaths = requiredArtifacts
    .filter((artifact, index, artifacts) => artifacts.findIndex((candidate) => candidate.path === artifact.path) !== index)
    .map((artifact) => artifact.path);
  const blockedReasons = [
    ...missingRequiredKeys.map((key) => `missing-required-boot-artifact:${key}`),
    ...missingWritablePaths.map((path) => `boot-path-outside-boundary:${path}`),
    ...duplicatePaths.map((path) => `duplicate-boot-path:${path}`)
  ];

  return {
    contractVersion: "artifact-root.boot-initialization-guard.v1",
    initialized: blockedReasons.length === 0,
    namespaceKey: namespaceLayout.namespaceKey,
    boundaryMode: workspaceScope.boundaryMode,
    requiredKeyCount: requiredKeys.length,
    presentRequiredKeyCount: presentRequiredKeys.size,
    writableRequiredKeyCount: requiredArtifacts.length - missingWritableArtifacts.length,
    missingRequiredKeys,
    missingWritablePaths,
    duplicatePaths,
    blockedReasons
  };
}

function buildArtifactRootNamespaceLayout(root, workspaceScope, boot) {
  const basePathSelection = selectBootNamespaceBasePath(boot, workspaceScope);
  const requestedBasePath = basePathSelection.namespaceBasePath;
  const tenantSegment = normalizePathSegment(workspaceScope.tenantId, "tenant");
  const workspaceSegment = normalizePathSegment(workspaceScope.workspaceId, "workspace");
  const namespaceSegment = normalizePathSegment(root.namespace, "default");
  const generationSegment = `g${root.generation}`;
  const layoutSegments = {
    requestedBase: basePathSelection.requestedBasePath,
    base: requestedBasePath,
    boundaryAnchor: basePathSelection.boundaryAnchor,
    tenant: tenantSegment,
    workspace: workspaceSegment,
    namespace: namespaceSegment,
    generation: generationSegment
  };
  const rootPrefix = normalizeArtifactPath(
    [
      layoutSegments.base,
      layoutSegments.tenant,
      layoutSegments.workspace,
      layoutSegments.namespace,
      layoutSegments.generation
    ].join("/"),
    "boot"
  );
  const rootFingerprint = stableProofId([
    root.uri,
    root.owner,
    root.namespace,
    root.generation,
    workspaceScope.scopeKey,
    workspaceScope.allowedPrefixes
  ]);
  const contentAddressRoot = `cas/artifact-root/${rootFingerprint}`;
  const namespaceKey = [
    workspaceScope.tenantId,
    workspaceScope.workspaceId,
    root.namespace,
    generationSegment
  ].join(":");
  const directories = {
    root: rootPrefix,
    boot: `${rootPrefix}/boot`,
    proofs: `${rootPrefix}/boot/proofs`,
    providers: `${rootPrefix}/boot/providers`,
    commands: `${rootPrefix}/boot/commands`,
    manifests: `${rootPrefix}/boot/manifests`,
    metadata: `${rootPrefix}/metadata`,
    contentAddressRoot,
    exports: `${rootPrefix}/exports`,
    recovery: `${rootPrefix}/recovery`
  };
  const requiredArtifactSpecs = Object.entries(BOOT_ARTIFACT_PATHS).map(([key, relativePath]) => {
    const path = `${rootPrefix}/${relativePath}`;
    const contentAddressPath = `${contentAddressRoot}/${relativePath}`;
    const writable = workspaceScope.boundaryMode === "enforced"
      ? pathWithinPrefixes(path, workspaceScope.allowedPrefixes)
      : true;

    return {
      key,
      relativePath,
      path,
      uri: `${root.uri}/${path}`,
      contentAddressPath,
      directory: path.slice(0, path.lastIndexOf("/")),
      required: true,
      writable,
      namespaceKey,
      mountOrder: Object.keys(BOOT_ARTIFACT_PATHS).indexOf(key) + 1
    };
  });

  return {
    contractVersion: "artifact-root.namespace-layout.v1",
    namespaceKey,
    mountId: `artifact-root:${rootFingerprint}`,
    rootPrefix,
    rootFingerprint,
    contentAddressRoot,
    basePathSelection,
    segments: layoutSegments,
    directories,
    requiredArtifactSpecs,
    pathAliases: buildBootPathAliases(requiredArtifactSpecs, rootPrefix, requestedBasePath),
    bootPathCount: requiredArtifactSpecs.length,
    stablePaths: true
  };
}

function buildArtifactRootMetadata(root, workspaceScope, namespaceLayout, requiredArtifacts, generatedAt) {
  const metadataPath = `${namespaceLayout.directories.metadata}/root.json`;
  const requiredBootPaths = Object.fromEntries(
    requiredArtifacts.map((artifact) => [artifact.key, artifact.path])
  );
  const contentAddressedBootPaths = Object.fromEntries(
    requiredArtifacts.map((artifact) => [artifact.key, artifact.contentAddressPath])
  );
  const writableBootPathCount = requiredArtifacts.filter((artifact) => artifact.writable).length;
  const metadataDigest = stableProofId([
    namespaceLayout.namespaceKey,
    root.uri,
    root.owner,
    root.namespace,
    root.generation,
    root.mountedAt,
    workspaceScope.scopeKey,
    workspaceScope.boundaryMode,
    workspaceScope.allowedPrefixes,
    requiredArtifacts.map((artifact) => [artifact.key, artifact.path, artifact.writable])
  ]);

  return {
    contractVersion: "artifact-root.root-metadata.v1",
    metadataPath,
    metadataUri: `${root.uri}/${metadataPath}`,
    metadataDigest,
    generatedAt,
    root: {
      uri: root.uri,
      owner: root.owner,
      namespace: root.namespace,
      generation: root.generation,
      mountedAt: root.mountedAt,
      lastMutation: root.lastMutation,
      fingerprint: namespaceLayout.rootFingerprint
    },
    namespace: {
      namespaceKey: namespaceLayout.namespaceKey,
      mountId: namespaceLayout.mountId,
      rootPrefix: namespaceLayout.rootPrefix,
      requestedBasePath: namespaceLayout.basePathSelection.requestedBasePath,
      namespaceBasePath: namespaceLayout.basePathSelection.namespaceBasePath,
      remappedForBoundary: namespaceLayout.basePathSelection.remappedForBoundary,
      remapReason: namespaceLayout.basePathSelection.remapReason,
      directories: namespaceLayout.directories
    },
    workspace: {
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      scopeKey: workspaceScope.scopeKey,
      boundaryMode: workspaceScope.boundaryMode,
      allowedPrefixes: workspaceScope.allowedPrefixes,
      explicitBoundary: workspaceScope.explicitBoundary
    },
    boot: {
      requiredBootPaths,
      contentAddressedBootPaths,
      pathAliases: namespaceLayout.pathAliases,
      requiredBootPathCount: requiredArtifacts.length,
      writableBootPathCount,
      readOnlyBootPathCount: requiredArtifacts.length - writableBootPathCount
    },
    proof: {
      stable: true,
      digestInputs: [
        "namespace.namespaceKey",
        "root.uri",
        "root.owner",
        "root.namespace",
        "root.generation",
        "root.mountedAt",
        "workspace.scopeKey",
        "workspace.boundaryMode",
        "workspace.allowedPrefixes",
        "boot.requiredArtifacts"
      ]
    }
  };
}

function buildRootMetadataValidation(input, rootMetadata, namespaceLayout, requiredArtifacts, generatedAt) {
  const boot = input && typeof input.boot === "object" && input.boot !== null ? input.boot : {};
  const persisted = input && typeof input.persistedState === "object" && input.persistedState !== null
    ? input.persistedState
    : {};
  const supplied = boot.rootMetadata && typeof boot.rootMetadata === "object"
    ? boot.rootMetadata
    : persisted.rootMetadata && typeof persisted.rootMetadata === "object"
      ? persisted.rootMetadata
      : persisted.rootDescriptor && typeof persisted.rootDescriptor === "object"
        ? persisted.rootDescriptor
        : null;
  const observedBoot = supplied && supplied.boot && typeof supplied.boot === "object" ? supplied.boot : {};
  const observedNamespace = supplied && supplied.namespace && typeof supplied.namespace === "object" ? supplied.namespace : {};
  const observedRoot = supplied && supplied.root && typeof supplied.root === "object" ? supplied.root : {};
  const observedRequiredPaths = observedBoot.requiredBootPaths && typeof observedBoot.requiredBootPaths === "object"
    ? observedBoot.requiredBootPaths
    : {};
  const observedContentPaths = observedBoot.contentAddressedBootPaths && typeof observedBoot.contentAddressedBootPaths === "object"
    ? observedBoot.contentAddressedBootPaths
    : {};
  const missingKeys = [];
  const pathMismatches = [];
  const contentAddressMismatches = [];

  for (const artifact of requiredArtifacts) {
    if (typeof observedRequiredPaths[artifact.key] !== "string") {
      missingKeys.push(artifact.key);
    } else if (normalizeArtifactPath(observedRequiredPaths[artifact.key], artifact.path) !== artifact.path) {
      pathMismatches.push(artifact.key);
    }
    if (typeof observedContentPaths[artifact.key] === "string"
      && normalizeArtifactPath(observedContentPaths[artifact.key], artifact.contentAddressPath) !== artifact.contentAddressPath) {
      contentAddressMismatches.push(artifact.key);
    }
  }

  const suppliedMetadataPath = typeof supplied?.metadataPath === "string"
    ? normalizeArtifactPath(supplied.metadataPath, rootMetadata.metadataPath)
    : null;
  const suppliedDigest = typeof supplied?.metadataDigest === "string" && supplied.metadataDigest.length > 0
    ? supplied.metadataDigest
    : null;
  const staleReasons = [
    ...(!supplied ? ["root-metadata-missing"] : []),
    ...(suppliedMetadataPath && suppliedMetadataPath !== rootMetadata.metadataPath ? ["root-metadata-path-drift"] : []),
    ...(suppliedDigest && suppliedDigest !== rootMetadata.metadataDigest ? ["root-metadata-digest-drift"] : []),
    ...(observedNamespace.namespaceKey && observedNamespace.namespaceKey !== namespaceLayout.namespaceKey ? ["namespace-key-drift"] : []),
    ...(observedNamespace.rootPrefix && observedNamespace.rootPrefix !== namespaceLayout.rootPrefix ? ["root-prefix-drift"] : []),
    ...(observedRoot.fingerprint && observedRoot.fingerprint !== namespaceLayout.rootFingerprint ? ["root-fingerprint-drift"] : []),
    ...missingKeys.map((key) => `missing-required-path:${key}`),
    ...pathMismatches.map((key) => `required-path-drift:${key}`),
    ...contentAddressMismatches.map((key) => `content-address-drift:${key}`)
  ];
  const blockedReasons = [
    ...(requiredArtifacts.some((artifact) => !artifact.writable) ? ["required-boot-path-read-only"] : []),
    ...(pathMismatches.length > 0 ? ["metadata-points-at-unexpected-boot-path"] : [])
  ];
  const repairRequired = staleReasons.length > 0;
  const blocked = blockedReasons.length > 0;

  return {
    contractVersion: "artifact-root.root-metadata-validation.v1",
    status: blocked
      ? "blocked"
      : repairRequired
        ? "repair-required"
        : "ready",
    valid: !repairRequired && !blocked,
    repairRequired,
    blocked,
    expectedMetadataPath: rootMetadata.metadataPath,
    observedMetadataPath: suppliedMetadataPath,
    expectedMetadataDigest: rootMetadata.metadataDigest,
    observedMetadataDigest: suppliedDigest,
    expectedNamespaceKey: namespaceLayout.namespaceKey,
    observedNamespaceKey: observedNamespace.namespaceKey || null,
    missingRequiredKeys: normalizeStringList(missingKeys),
    pathMismatches: normalizeStringList(pathMismatches),
    contentAddressMismatches: normalizeStringList(contentAddressMismatches),
    staleReasons: normalizeStringList(staleReasons),
    blockedReasons: normalizeStringList(blockedReasons),
    nextAction: blocked
      ? "inspect-boot-metadata-blocker"
      : repairRequired
        ? "rewrite-root-metadata"
        : "serve-artifact-root",
    nextMetadataPatch: repairRequired && !blocked ? {
      metadataPath: rootMetadata.metadataPath,
      metadataDigest: rootMetadata.metadataDigest,
      generatedAt,
      root: rootMetadata.root,
      namespace: rootMetadata.namespace,
      workspace: rootMetadata.workspace,
      boot: rootMetadata.boot
    } : null,
    proof: {
      evaluatedAt: generatedAt,
      expectedRequiredPathCount: requiredArtifacts.length,
      observedRequiredPathCount: Object.keys(observedRequiredPaths).length,
      expectedContentPathCount: requiredArtifacts.length,
      observedContentPathCount: Object.keys(observedContentPaths).length,
      validationDigest: stableProofId([
        rootMetadata.metadataDigest,
        suppliedDigest || "missing",
        missingKeys,
        pathMismatches,
        contentAddressMismatches,
        blockedReasons
      ])
    }
  };
}

function buildBootArtifactRoot(root, workspaceScope, input, generatedAt) {
  const boot = input && typeof input.boot === "object" && input.boot !== null ? input.boot : {};
  const namespaceLayout = buildArtifactRootNamespaceLayout(root, workspaceScope, boot);
  const { rootPrefix, rootFingerprint, contentAddressRoot } = namespaceLayout;
  const requiredArtifacts = Object.entries(BOOT_ARTIFACT_PATHS).map(([key, relativePath]) => {
    const artifactSpec = namespaceLayout.requiredArtifactSpecs.find((artifact) => artifact.key === key);
    return {
      ...artifactSpec,
      relativePath
    };
  });
  const missingWritablePaths = requiredArtifacts
    .filter((artifact) => !artifact.writable)
    .map((artifact) => artifact.path);
  const rootMetadata = buildArtifactRootMetadata(root, workspaceScope, namespaceLayout, requiredArtifacts, generatedAt);
  const rootMetadataValidation = buildRootMetadataValidation(
    input,
    rootMetadata,
    namespaceLayout,
    requiredArtifacts,
    generatedAt
  );
  const initializationGuard = buildBootInitializationGuard(namespaceLayout, requiredArtifacts, workspaceScope);
  const initializationPlan = {
    contractVersion: "artifact-root.initialization-plan.v1",
    stable: initializationGuard.initialized,
    mountId: namespaceLayout.mountId,
    metadataPath: rootMetadata.metadataPath,
    createDirectories: Object.values(namespaceLayout.directories),
    writeArtifacts: requiredArtifacts.map((artifact) => ({
      key: artifact.key,
      path: artifact.path,
      contentAddressPath: artifact.contentAddressPath,
      writable: artifact.writable,
      idempotencyKey: stableProofId([
        namespaceLayout.mountId,
        artifact.key,
        artifact.path,
        rootMetadata.metadataDigest
      ])
    })),
    blockedPaths: missingWritablePaths,
    blockedReasons: initializationGuard.blockedReasons,
    rootMetadataDigest: rootMetadata.metadataDigest
  };

  return {
    contractVersion: "artifact-root.boot-artifacts.v1",
    initialized: initializationGuard.initialized,
    generatedAt,
    rootUri: root.uri,
    rootFingerprint,
    rootPrefix,
    contentAddressRoot,
    namespaceLayout,
    rootMetadata,
    rootMetadataValidation,
    initializationGuard,
    initializationPlan,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    namespace: root.namespace,
    generation: root.generation,
    requiredArtifacts,
    paths: Object.fromEntries(requiredArtifacts.map((artifact) => [artifact.key, artifact.path])),
    contentAddressedPaths: Object.fromEntries(
      requiredArtifacts.map((artifact) => [artifact.key, artifact.contentAddressPath])
    ),
    pathAliases: namespaceLayout.pathAliases,
    validation: {
      valid: initializationGuard.initialized,
      missingWritablePaths,
      missingRequiredKeys: initializationGuard.missingRequiredKeys,
      duplicatePaths: initializationGuard.duplicatePaths,
      rootMetadataStatus: rootMetadataValidation.status,
      rootMetadataStaleReasons: rootMetadataValidation.staleReasons,
      blockedReasons: initializationGuard.blockedReasons,
      boundaryMode: workspaceScope.boundaryMode,
      allowedPrefixes: workspaceScope.allowedPrefixes
    },
    proof: {
      stable: true,
      fingerprintInputs: ["root.uri", "root.owner", "root.namespace", "root.generation", "workspace.scopeKey", "workspace.allowedPrefixes"],
      artifactCount: requiredArtifacts.length
    }
  };
}

export function initializeArtifactRootForBoot(input = {}) {
  const generatedAt = toIsoTimestamp(input.generatedAt || input.now);
  const root = normalizeArtifactRoot(input, generatedAt);
  const workspaceScope = buildWorkspaceScope(input, root);
  return buildBootArtifactRoot(root, workspaceScope, input, generatedAt);
}

function normalizeExportSections(exportRequest, defaultSections) {
  const requested = normalizeStringList(exportRequest.sections);
  if (requested.length === 0) {
    return defaultSections;
  }
  const allowed = new Set(defaultSections);
  return requested.filter((section) => allowed.has(section));
}

function buildExportArtifactPackage(
  input,
  root,
  workspaceScope,
  syncMetadata,
  previewContract,
  acceptanceContract,
  providerServiceContract,
  timelineReport,
  exportSummary,
  auditProof,
  generatedAt
) {
  const exportRequest = input && typeof input.export === "object" && input.export !== null ? input.export : {};
  const selectedSections = normalizeExportSections(exportRequest, exportSummary.sections);
  const selectedSectionSet = new Set(selectedSections);
  const exportRoute = providerServiceContract.routes.find((route) => route.intent === "audit") || null;
  const handoffRoute = providerServiceContract.routes.find((route) => route.intent === "handoff") || null;
  const packageRoot = typeof exportRequest.packageRoot === "string" && exportRequest.packageRoot.length > 0
    ? normalizeArtifactPath(exportRequest.packageRoot, "exports")
    : `exports/${workspaceScope.tenantId}/${workspaceScope.workspaceId}`;
  const manifestPath = `${packageRoot}/${exportSummary.exportId.replace(/[^a-zA-Z0-9:._-]/g, "_")}/manifest.json`;
  const sectionRows = {
    analyticsCounters: exportSummary.rowCounts.counterRows + exportSummary.rowCounts.mutationRows,
    historySnapshots: exportSummary.rowCounts.historyRows,
    timelineReport: exportSummary.rowCounts.timelineRows,
    providerServiceContract: exportSummary.rowCounts.providerRouteRows,
    auditProof: exportSummary.rowCounts.evidenceRows
  };
  const artifacts = exportSummary.formats.flatMap((format) => selectedSections.map((section) => {
    const rowCount = sectionRows[section] || 0;
    const proofId = stableProofId([
      exportSummary.exportId,
      section,
      format,
      syncMetadata.cursor,
      rowCount,
      auditProof.evidence
    ]);

    return {
      artifactId: `${exportSummary.exportId}:${section}:${format}`,
      path: `${packageRoot}/${section}.${format}`,
      format,
      section,
      rowCount,
      contentType: format === "json"
        ? "application/json"
        : format === "ndjson"
          ? "application/x-ndjson"
          : "text/csv",
      proofId,
      ready: exportSummary.exportable && rowCount > 0
    };
  }));
  const blockedArtifacts = artifacts.filter((artifact) => !artifact.ready);

  return {
    contractVersion: "artifact-root.export-artifact-package.v1",
    packageId: `${exportSummary.exportId}:${stableProofId([manifestPath, generatedAt])}`,
    generatedAt,
    rootUri: root.uri,
    manifestPath,
    packageRoot,
    selectedSections,
    artifactCount: artifacts.length,
    readyArtifactCount: artifacts.length - blockedArtifacts.length,
    exportable: exportSummary.exportable && artifacts.length > 0 && blockedArtifacts.length === 0,
    blockedReasons: [
      ...exportSummary.blockedReasons,
      ...(selectedSections.length === 0 ? ["no-export-sections-selected"] : []),
      ...blockedArtifacts.map((artifact) => `artifact-not-ready:${artifact.section}:${artifact.format}`)
    ],
    artifacts,
    routing: {
      auditProviderId: exportRoute ? exportRoute.providerId : null,
      auditRouteReady: Boolean(exportRoute && exportRoute.routable),
      handoffProviderId: handoffRoute ? handoffRoute.providerId : null,
      handoffRouteReady: Boolean(handoffRoute && handoffRoute.routable && handoffRoute.executionReady),
      clientRoute: CLIENT_ROUTE_BY_ACTION.export
    },
    acceptanceProof: {
      decision: acceptanceContract.decision,
      previewCursor: previewContract.cursor,
      acceptedBy: acceptanceContract.acceptedBy,
      acceptedAt: acceptanceContract.acceptedAt
    },
    manifestProof: {
      auditStatus: auditProof.status,
      evidenceCount: auditProof.evidence.length,
      latestTimelineState: timelineReport.latestState,
      proofId: stableProofId([
        exportSummary.exportId,
        manifestPath,
        selectedSections,
        artifacts.map((artifact) => artifact.proofId)
      ])
    }
  };
}

function buildAnalyticsReportingState(
  input,
  analyticsCounters,
  historySnapshots,
  timelineReport,
  exportSummary,
  exportArtifactPackage,
  operationalHealth,
  providerServiceContract,
  pathAccessManifest,
  generatedAt
) {
  const reportRequest = input && typeof input.analyticsReport === "object" && input.analyticsReport !== null
    ? input.analyticsReport
    : {};
  const windowSize = Math.min(Math.max(normalizeNonNegativeInteger(reportRequest.windowSize, 10), 1), 50);
  const snapshotWindow = historySnapshots.slice(-windowSize);
  const latestSnapshot = snapshotWindow.length > 0 ? snapshotWindow[snapshotWindow.length - 1] : null;
  const previousSnapshot = snapshotWindow.length > 1 ? snapshotWindow.at(-2) : null;
  const deltaFromPrevious = latestSnapshot && previousSnapshot ? {
    rootGeneration: latestSnapshot.rootGeneration - previousSnapshot.rootGeneration,
    dirtyCount: latestSnapshot.dirtyCount - previousSnapshot.dirtyCount,
    conflictCount: latestSnapshot.conflictCount - previousSnapshot.conflictCount,
    journalPendingCount: latestSnapshot.journalPendingCount - previousSnapshot.journalPendingCount,
    journalFailedCount: latestSnapshot.journalFailedCount - previousSnapshot.journalFailedCount
  } : {
    rootGeneration: 0,
    dirtyCount: 0,
    conflictCount: 0,
    journalPendingCount: 0,
    journalFailedCount: 0
  };
  const readinessBuckets = snapshotWindow.reduce((accumulator, snapshot) => {
    accumulator[snapshot.readiness] = (accumulator[snapshot.readiness] || 0) + 1;
    return accumulator;
  }, {});
  const healthBuckets = snapshotWindow.reduce((accumulator, snapshot) => {
    accumulator[snapshot.healthStatus] = (accumulator[snapshot.healthStatus] || 0) + 1;
    return accumulator;
  }, {});
  const counterRows = [
    ...Object.entries(analyticsCounters.counters).map(([name, value]) => ({
      namespace: "counters",
      name,
      value
    })),
    ...Object.entries(analyticsCounters.mutationCounts).map(([name, value]) => ({
      namespace: "mutationCounts",
      name,
      value
    })),
    ...Object.entries(analyticsCounters.permissionCounters).map(([name, value]) => ({
      namespace: "permissionCounters",
      name,
      value
    })),
    ...Object.entries(analyticsCounters.pathAccessReasonCounts).map(([name, value]) => ({
      namespace: "pathAccessReasonCounts",
      name,
      value
    })),
    ...Object.entries(analyticsCounters.pathAccessWriteBlockReasonCounts).map(([name, value]) => ({
      namespace: "pathAccessWriteBlockReasonCounts",
      name,
      value
    })),
    ...Object.entries(analyticsCounters.stateFlags).map(([name, value]) => ({
      namespace: "stateFlags",
      name,
      value: value ? 1 : 0
    }))
  ].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
  const timelineRows = timelineReport.entries.map((entry, index) => ({
    rowNumber: index + 1,
    occurredAt: entry.occurredAt,
    eventType: entry.eventType,
    label: entry.label,
    state: entry.state,
    proofRef: entry.proofRef
  }));
  const exportedSectionRows = exportArtifactPackage.artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    section: artifact.section,
    format: artifact.format,
    rowCount: artifact.rowCount,
    path: artifact.path,
    ready: artifact.ready,
    proofId: artifact.proofId
  }));
  const alertThresholds = reportRequest.thresholds && typeof reportRequest.thresholds === "object"
    ? reportRequest.thresholds
    : {};
  const maxConflicts = normalizeNonNegativeInteger(alertThresholds.maxConflicts, 0);
  const maxDeniedPaths = normalizeNonNegativeInteger(alertThresholds.maxDeniedPaths, 0);
  const maxHealthFailures = normalizeNonNegativeInteger(alertThresholds.maxHealthFailures, 0);
  const alerts = [
    ...(analyticsCounters.counters.conflictPaths > maxConflicts ? [{
      code: "conflict-threshold-exceeded",
      severity: "error",
      actual: analyticsCounters.counters.conflictPaths,
      threshold: maxConflicts
    }] : []),
    ...(pathAccessManifest.deniedPathCount > maxDeniedPaths ? [{
      code: "denied-path-threshold-exceeded",
      severity: "error",
      actual: pathAccessManifest.deniedPathCount,
      threshold: maxDeniedPaths
    }] : []),
    ...(pathAccessManifest.writeBlockedPathCount > maxDeniedPaths ? [{
      code: "write-blocked-path-threshold-exceeded",
      severity: "error",
      actual: pathAccessManifest.writeBlockedPathCount,
      threshold: maxDeniedPaths
    }] : []),
    ...(operationalHealth.failureCount > maxHealthFailures ? [{
      code: "health-failure-threshold-exceeded",
      severity: operationalHealth.status === "unhealthy" ? "critical" : "warning",
      actual: operationalHealth.failureCount,
      threshold: maxHealthFailures
    }] : []),
    ...(providerServiceContract.blockedRouteCount > 0 ? [{
      code: "provider-route-blocked",
      severity: "warning",
      actual: providerServiceContract.blockedRouteCount,
      threshold: 0
    }] : []),
    ...(!exportArtifactPackage.exportable ? [{
      code: "export-package-not-ready",
      severity: "warning",
      actual: exportArtifactPackage.readyArtifactCount,
      threshold: exportArtifactPackage.artifactCount
    }] : []),
    ...(deltaFromPrevious.conflictCount > 0 ? [{
      code: "conflict-count-increased",
      severity: "warning",
      actual: deltaFromPrevious.conflictCount,
      threshold: 0
    }] : [])
  ];
  const reportDigest = stableProofId([
    generatedAt,
    exportSummary.exportId,
    latestSnapshot ? latestSnapshot.snapshotId : "no-snapshot",
    counterRows.map((row) => [row.namespace, row.name, row.value]),
    alerts.map((alert) => [alert.code, alert.severity, alert.actual, alert.threshold]),
    exportedSectionRows.map((row) => [row.artifactId, row.ready, row.proofId])
  ]);

  return {
    contractVersion: "artifact-root.analytics-reporting-state.v1",
    generatedAt,
    reportId: typeof reportRequest.reportId === "string" && reportRequest.reportId.length > 0
      ? reportRequest.reportId
      : `artifact-root-report:${analyticsCounters.scopeKey}:${reportDigest}`,
    scopeKey: analyticsCounters.scopeKey,
    window: {
      requestedSize: windowSize,
      snapshotCount: snapshotWindow.length,
      from: snapshotWindow[0]?.capturedAt || generatedAt,
      to: latestSnapshot?.capturedAt || generatedAt
    },
    currentSnapshot: latestSnapshot,
    previousSnapshotId: previousSnapshot ? previousSnapshot.snapshotId : null,
    deltaFromPrevious,
    buckets: {
      readiness: readinessBuckets,
      health: healthBuckets
    },
    rows: {
      counters: counterRows,
      timeline: timelineRows,
      exportArtifacts: exportedSectionRows
    },
    exportReadiness: {
      exportId: exportSummary.exportId,
      packageId: exportArtifactPackage.packageId,
      manifestPath: exportArtifactPackage.manifestPath,
      exportable: exportArtifactPackage.exportable,
      formats: exportSummary.formats,
      selectedSections: exportArtifactPackage.selectedSections,
      readyArtifactCount: exportArtifactPackage.readyArtifactCount,
      artifactCount: exportArtifactPackage.artifactCount,
      blockedReasons: exportArtifactPackage.blockedReasons
    },
    alerts,
    proof: {
      reportDigest,
      timelineEntryCount: timelineReport.entryCount,
      counterRowCount: counterRows.length,
      exportArtifactRowCount: exportedSectionRows.length,
      alertCount: alerts.length
    }
  };
}

function buildExportDataContract(
  input,
  analyticsCounters,
  historySnapshots,
  timelineReport,
  providerServiceContract,
  auditProof,
  exportArtifactPackage,
  generatedAt
) {
  const exportRequest = input && typeof input.export === "object" && input.export !== null ? input.export : {};
  const previewRowLimit = Math.min(Math.max(normalizeNonNegativeInteger(exportRequest.previewRows, 5), 1), 25);
  const rowsBySection = {
    analyticsCounters: [
      ...Object.entries(analyticsCounters.counters).map(([name, value]) => ({ group: "counter", name, value })),
      ...Object.entries(analyticsCounters.mutationCounts).map(([name, value]) => ({ group: "mutation", name, value }))
    ],
    historySnapshots: historySnapshots.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      cursor: snapshot.cursor,
      rootGeneration: snapshot.rootGeneration,
      readiness: snapshot.readiness,
      healthStatus: snapshot.healthStatus,
      dirtyCount: snapshot.dirtyCount,
      conflictCount: snapshot.conflictCount
    })),
    timelineReport: timelineReport.entries.map((entry, index) => ({
      rowNumber: index + 1,
      occurredAt: entry.occurredAt,
      eventType: entry.eventType,
      label: entry.label,
      state: entry.state,
      proofRef: entry.proofRef
    })),
    providerServiceContract: providerServiceContract.routes.map((route) => ({
      intent: route.intent,
      providerId: route.providerId,
      routable: route.routable,
      executionReady: route.executionReady,
      requiredCapability: route.requiredCapability,
      blockedReasons: route.blockedReasons.join("|"),
      executionBlockedReasons: route.executionBlockedReasons.join("|")
    })),
    auditProof: auditProof.evidence.map((evidence, index) => ({
      rowNumber: index + 1,
      status: auditProof.status,
      subject: auditProof.subject,
      evidence
    }))
  };
  const schemaForRows = (rows) => {
    const columnNames = normalizeStringList(rows.flatMap((row) => Object.keys(row)));
    return columnNames.map((name) => {
      const sample = rows.find((row) => row[name] !== undefined)?.[name];
      return {
        name,
        type: typeof sample === "number"
          ? "number"
          : typeof sample === "boolean"
            ? "boolean"
            : "string",
        nullable: rows.some((row) => row[name] === null || row[name] === undefined)
      };
    });
  };
  const serializePreview = (format, rows) => {
    const previewRows = rows.slice(0, previewRowLimit);
    if (format === "ndjson") {
      return previewRows.map((row) => JSON.stringify(row));
    }
    if (format === "csv") {
      const columns = schemaForRows(rows).map((column) => column.name);
      const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      return [
        columns.join(","),
        ...previewRows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","))
      ];
    }
    return previewRows;
  };
  const sections = exportArtifactPackage.selectedSections.map((section) => {
    const rows = rowsBySection[section] || [];
    const schema = schemaForRows(rows);
    return {
      section,
      rowCount: rows.length,
      columnCount: schema.length,
      schema,
      previewRows: rows.slice(0, previewRowLimit),
      digest: stableProofId([section, rows.map((row) => Object.values(row))])
    };
  });
  const sectionByName = new Map(sections.map((section) => [section.section, section]));
  const artifactPlans = exportArtifactPackage.artifacts.map((artifact) => {
    const section = sectionByName.get(artifact.section);
    const rows = rowsBySection[artifact.section] || [];
    return {
      artifactId: artifact.artifactId,
      path: artifact.path,
      section: artifact.section,
      format: artifact.format,
      contentType: artifact.contentType,
      rowCount: artifact.rowCount,
      columnCount: section ? section.columnCount : 0,
      ready: artifact.ready && Boolean(section) && rows.length === artifact.rowCount,
      blockedReasons: [
        ...(!artifact.ready ? ["export-artifact-not-ready"] : []),
        ...(!section ? ["section-not-selected"] : []),
        ...(rows.length !== artifact.rowCount ? [`row-count-drift:${rows.length}->${artifact.rowCount}`] : [])
      ],
      preview: serializePreview(artifact.format, rows),
      proofId: artifact.proofId
    };
  });
  const blockedPlans = artifactPlans.filter((plan) => !plan.ready);
  const contractDigest = stableProofId([
    generatedAt,
    exportArtifactPackage.packageId,
    sections.map((section) => [section.section, section.rowCount, section.digest]),
    artifactPlans.map((plan) => [plan.artifactId, plan.ready, plan.blockedReasons, plan.proofId])
  ]);

  return {
    contractVersion: "artifact-root.export-data-contract.v1",
    generatedAt,
    packageId: exportArtifactPackage.packageId,
    manifestPath: exportArtifactPackage.manifestPath,
    previewRowLimit,
    ready: exportArtifactPackage.exportable && blockedPlans.length === 0,
    selectedSections: exportArtifactPackage.selectedSections,
    sections,
    artifactPlans,
    blockedReasons: normalizeStringList([
      ...exportArtifactPackage.blockedReasons,
      ...blockedPlans.flatMap((plan) => plan.blockedReasons.map((reason) => `${plan.section}:${plan.format}:${reason}`))
    ]),
    proof: {
      contractDigest,
      sectionCount: sections.length,
      artifactPlanCount: artifactPlans.length,
      blockedPlanCount: blockedPlans.length
    }
  };
}

function buildClientRuntimeState(
  input,
  workspaceScope,
  syncMetadata,
  previewContract,
  idempotentCommand,
  lifecycleSettingsControl,
  recoveryContract,
  restartPersistencePlan,
  generatedAt
) {
  const client = input && typeof input.client === "object" && input.client !== null ? input.client : {};
  const route = normalizeClientRoute(client.currentRoute);
  const panel = typeof client.activePanel === "string" && CLIENT_PANELS.has(client.activePanel)
    ? client.activePanel
    : route === CLIENT_ROUTE_BY_ACTION.apply
      ? "commit"
      : route === CLIENT_ROUTE_BY_ACTION.export
        ? "export"
        : route === CLIENT_ROUTE_BY_ACTION.recover
          ? "recovery"
          : "preview";
  const networkState = typeof client.networkState === "string" && CLIENT_NETWORK_STATES.has(client.networkState)
    ? client.networkState
    : "online";
  const selectedPaths = normalizeStringList(client.selectedPaths)
    .map((path) => normalizeArtifactPath(path, "artifact"));
  const visiblePathSet = new Set(previewContract.visibleItems.map((item) => item.path));
  const optimisticCommandIds = normalizeStringList(client.optimisticCommandIds);
  const sessionId = typeof client.sessionId === "string" && client.sessionId.length > 0
    ? client.sessionId
    : `client:${workspaceScope.scopeKey}`;
  const requestId = typeof client.requestId === "string" && client.requestId.length > 0
    ? client.requestId
    : `artifact-root-request:${stableProofId([sessionId, syncMetadata.cursor, idempotentCommand.commandId])}`;
  const requestedAction = normalizeClientAction(client.requestedAction || client.action, "refresh");
  const requestedRoute = normalizeClientRoute(client.requestedRoute, CLIENT_ROUTE_BY_ACTION[requestedAction]);
  const lastSeenCursor = typeof client.lastSeenCursor === "string" && client.lastSeenCursor.length > 0
    ? client.lastSeenCursor
    : syncMetadata.cursor;
  const lastSeenCommandId = typeof client.lastSeenCommandId === "string" && client.lastSeenCommandId.length > 0
    ? client.lastSeenCommandId
    : idempotentCommand.commandId;
  const cursorDrifted = lastSeenCursor !== syncMetadata.cursor;
  const commandDrifted = lastSeenCommandId !== idempotentCommand.commandId;
  const routeDrifted = route !== requestedRoute;
  const actionPanel = requestedAction === "apply"
    ? "commit"
    : requestedAction === "export"
      ? "export"
      : requestedAction === "recover"
        ? "recovery"
        : requestedAction === "accept"
          ? "review"
          : "preview";
  const routeIntentBlockedReasons = [
    ...(cursorDrifted ? [`cursor-drift:${lastSeenCursor}->${syncMetadata.cursor}`] : []),
    ...(commandDrifted ? [`command-drift:${lastSeenCommandId}->${idempotentCommand.commandId}`] : []),
    ...(networkState === "offline" && requestedAction !== "refresh" ? ["client-offline"] : []),
    ...(requestedAction === "apply" && !idempotentCommand.canExecute && !idempotentCommand.alreadyApplied
      ? [`command-not-ready:${idempotentCommand.status}`]
      : [])
  ];
  const routeIntentId = stableProofId([
    sessionId,
    requestId,
    requestedAction,
    requestedRoute,
    syncMetadata.cursor,
    idempotentCommand.commandId,
    selectedPaths
  ]);
  const baseRuntimeState = {
    sessionId,
    requestId,
    route,
    activePanel: panel,
    networkState,
    offline: networkState === "offline",
    routeIntent: {
      routeIntentId,
      requestedAction,
      requestedRoute
    }
  };
  const runtimeRestartHandoff = buildRuntimeRestartHandoffState({
    client,
    clientRuntimeState: baseRuntimeState,
    recoveryContract,
    restartPersistencePlan,
    idempotentCommand,
    lifecycleSettingsControl,
    generatedAt
  });

  return {
    contractVersion: "artifact-root.client-runtime-state.v1",
    sessionId,
    requestId,
    route,
    activePanel: panel,
    networkState,
    offline: networkState === "offline",
    submittedAt: toIsoTimestamp(client.submittedAt, generatedAt),
    selectedPaths,
    selectedVisiblePaths: selectedPaths.filter((path) => visiblePathSet.has(path)),
    selectedOutOfViewPaths: selectedPaths.filter((path) => !visiblePathSet.has(path)),
    optimisticCommandIds,
    hasOptimisticCommand: optimisticCommandIds.includes(idempotentCommand.commandId),
    requestScope: {
      scopeKey: workspaceScope.scopeKey,
      cursor: syncMetadata.cursor,
      commandId: idempotentCommand.commandId
    },
    routeIntent: {
      contractVersion: "artifact-root.client-route-intent.v1",
      routeIntentId,
      requestedAction,
      requestedRoute,
      requestedPanel: actionPanel,
      lastSeenCursor,
      lastSeenCommandId,
      cursorDrifted,
      commandDrifted,
      routeDrifted,
      blockedReasons: routeIntentBlockedReasons,
      dispatchReady: routeIntentBlockedReasons.length === 0,
      navigationPatch: {
        route: requestedRoute,
        activePanel: actionPanel,
        requestId,
        cursor: syncMetadata.cursor,
        commandId: idempotentCommand.commandId,
        selectedPaths
      }
    },
    runtimeRestartHandoff,
    restartStatePatch: runtimeRestartHandoff.clientStatePatch,
    lifecycleControls: {
      enablement: lifecycleSettingsControl.enablement,
      scheduleMode: lifecycleSettingsControl.schedule.mode,
      nextRunAt: lifecycleSettingsControl.schedule.nextRunAt,
      dueNow: lifecycleSettingsControl.schedule.dueNow,
      dueReason: lifecycleSettingsControl.schedule.dueReason,
      nextRunDelayMs: lifecycleSettingsControl.schedule.nextRunDelayMs,
      scheduleBlockedReason: lifecycleSettingsControl.schedule.blockedReason,
      runnableNow: lifecycleSettingsControl.commandGate.runnableNow,
      nextAction: lifecycleSettingsControl.commandGate.nextAction,
      nextActionState: lifecycleSettingsControl.commandGate.nextActionState,
      blockedReasons: lifecycleSettingsControl.commandGate.blockedReasons,
      requestedControlAction: lifecycleSettingsControl.controls.requested.action,
      requestedControlExecutable: lifecycleSettingsControl.controls.requestedExecutable,
      requestedControlBlockedReasons: lifecycleSettingsControl.controls.requestedBlockedReasons,
      nextSettingsPatch: lifecycleSettingsControl.controls.nextSettingsPatch,
      availableControlActions: lifecycleSettingsControl.controls.availableActions.map((control) => ({
        action: control.action,
        enabled: control.enabled,
        blockedReasons: control.blockedReasons,
        idempotencyKey: control.idempotencyKey
      })),
      settingsDigest: lifecycleSettingsControl.proof.settingsDigest
    }
  };
}

function buildClientPreviewAcceptanceContract(
  clientRuntimeState,
  previewContract,
  pathAccessManifest,
  acceptanceContract,
  validationSummary,
  readinessContract,
  providerServiceContract,
  idempotentCommand,
  lifecycleSettingsControl,
  operationalHealth,
  exportSummary,
  exportArtifactPackage
) {
  const routeByIntent = new Map(providerServiceContract.routes.map((route) => [route.intent, route]));
  const writeRoute = routeByIntent.get("write") || null;
  const readRoute = routeByIntent.get("read") || null;
  const auditRoute = routeByIntent.get("audit") || null;
  const selectedPathSet = new Set(clientRuntimeState.selectedPaths);
  const pathAccessByPath = new Map(pathAccessManifest.decisions.map((decision) => [decision.path, decision]));
  const validationItems = [
    ...validationSummary.failures.map((failure) => ({
      severity: "error",
      code: failure.code,
      detail: failure.detail,
      userVisible: true
    })),
    ...validationSummary.warnings.map((warning) => ({
      severity: "warning",
      code: warning.code,
      detail: warning.detail,
      userVisible: true
    }))
  ];
  const checklist = [
    {
      id: "preview-has-visible-items",
      label: "Preview contains artifact changes",
      passed: previewContract.totalItems > 0,
      evidence: `${previewContract.totalItems}:items`
    },
    {
      id: "workspace-boundary-clean",
      label: "Preview stays inside workspace boundary",
      passed: previewContract.summary.boundaryViolationCount === 0,
      evidence: `${previewContract.summary.boundaryViolationCount}:violations`
    },
    {
      id: "sync-conflict-free",
      label: "Preview has no sync conflicts",
      passed: previewContract.summary.conflictCount === 0,
      evidence: `${previewContract.summary.conflictCount}:conflicts`
    },
    {
      id: "write-route-executable",
      label: "Hosted kernel write route is executable",
      passed: Boolean(writeRoute && writeRoute.routable && writeRoute.executionReady),
      evidence: writeRoute ? `${writeRoute.providerId || "none"}:${writeRoute.requiredCapability}` : "write-route-missing"
    },
    {
      id: "operator-accepted-preview",
      label: "Operator accepted preview",
      passed: acceptanceContract.decision === "accepted",
      evidence: acceptanceContract.acceptedBy || acceptanceContract.decision
    },
    {
      id: "command-ready-or-applied",
      label: "Command can run idempotently",
      passed: idempotentCommand.canExecute || idempotentCommand.alreadyApplied,
      evidence: `${idempotentCommand.commandId}:${idempotentCommand.status}`
    },
    {
      id: "lifecycle-allows-command",
      label: "Lifecycle settings allow command execution",
      passed: lifecycleSettingsControl.commandGate.runnableNow,
      evidence: `${lifecycleSettingsControl.enablement}:${lifecycleSettingsControl.schedule.mode}:${lifecycleSettingsControl.commandGate.nextAction}`
    }
  ];
  const previewRows = previewContract.visibleItems.map((item, index) => {
    const pathAccess = pathAccessByPath.get(item.path) || null;
    const blockers = [
      ...(item.conflict ? ["sync-conflict"] : []),
      ...(!item.withinWorkspace ? [item.boundaryReason] : []),
      ...(pathAccess && pathAccess.decision === "deny"
        ? pathAccess.deniedReasons.map((reason) => `path-access:${reason}`)
        : []),
      ...(pathAccess && pathAccess.writeBlockedReasons.length > 0
        ? pathAccess.writeBlockedReasons.map((reason) => `path-write-blocked:${reason}`)
        : [])
    ].filter(Boolean);

    return {
      rowId: `${previewContract.cursor}:${index + 1}:${item.path}`,
      path: item.path,
      mutation: item.mutation,
      digest: item.digest,
      selected: selectedPathSet.has(item.path),
      status: blockers.length > 0 ? "blocked" : item.dirty ? "changed" : "unchanged",
      blockers,
      pathAccess: pathAccess ? {
        decision: pathAccess.decision,
        readable: pathAccess.readable,
        writable: pathAccess.writable,
        writeBlockedReasons: pathAccess.writeBlockedReasons,
        auditRef: pathAccess.auditRef
      } : null,
      badges: [
        ...(item.dirty ? ["dirty"] : []),
        ...(item.conflict ? ["conflict"] : []),
        ...(!item.withinWorkspace ? ["outside-workspace"] : []),
        ...(pathAccess && pathAccess.decision === "deny" ? ["access-denied"] : []),
        ...(pathAccess && pathAccess.decision === "read-only" ? ["read-only"] : []),
        ...(pathAccess && pathAccess.writeBlockedReasons.length > 0 ? ["write-blocked"] : [])
      ]
    };
  });
  const selectedRows = previewRows.filter((row) => row.selected);
  const selectedBlockedRows = selectedRows.filter((row) => row.blockers.length > 0);
  const nextStepActions = readinessContract.nextSteps.map((step, index) => ({
    stepId: `${index + 1}:${step.action}`,
    action: step.action,
    reason: step.reason,
    route: step.action === "accept-preview"
      ? CLIENT_ROUTE_BY_ACTION.accept
      : step.action === "commit-artifact-root"
        ? CLIENT_ROUTE_BY_ACTION.apply
        : step.action === "run-recovery" || step.action === "inspect-recovery-blocker"
          ? CLIENT_ROUTE_BY_ACTION.recover
          : step.action === "enable-artifact-root" || step.action === "enable-writes" || step.action === "resume-schedule"
            ? CLIENT_ROUTE_BY_ACTION.refresh
          : step.action === "apply-lifecycle-control"
            ? CLIENT_ROUTE_BY_ACTION.refresh
          : step.action === "retry-after-backoff"
            ? CLIENT_ROUTE_BY_ACTION.refresh
            : null,
    enabled: step.action === "accept-preview"
      ? previewContract.actions.canApply
      : step.action === "commit-artifact-root"
        ? readinessContract.ready
        : step.action === "return-cached-command-result"
          ? idempotentCommand.alreadyApplied
          : step.action === "apply-lifecycle-control"
            ? lifecycleSettingsControl.controls.requestedExecutable
          : true
  }));
  const routeActions = {
    refreshPreview: {
      route: CLIENT_ROUTE_BY_ACTION.refresh,
      enabled: previewContract.actions.canRefresh && Boolean(readRoute && readRoute.routable),
      providerId: readRoute ? readRoute.providerId : null,
      blockedReasons: readRoute ? readRoute.blockedReasons : ["read-route-missing"]
    },
    acceptPreview: {
      route: CLIENT_ROUTE_BY_ACTION.accept,
      enabled: previewContract.actions.canApply && acceptanceContract.decision !== "rejected",
      providerId: writeRoute ? writeRoute.providerId : null,
      blockedReasons: acceptanceContract.blockers
    },
    applyAcceptedPreview: {
      route: CLIENT_ROUTE_BY_ACTION.apply,
      enabled: readinessContract.ready && Boolean(writeRoute && writeRoute.executionReady),
      providerId: writeRoute ? writeRoute.providerId : null,
      commandId: idempotentCommand.commandId,
      blockedReasons: readinessContract.ready
        ? []
        : [
          ...readinessContract.nextSteps.map((step) => step.reason),
          ...lifecycleSettingsControl.commandGate.blockedReasons
        ]
    },
    exportAuditProof: {
      route: CLIENT_ROUTE_BY_ACTION.export,
      enabled: exportArtifactPackage.exportable && Boolean(auditRoute && auditRoute.routable),
      providerId: auditRoute ? auditRoute.providerId : null,
      exportId: exportSummary.exportId,
      packageId: exportArtifactPackage.packageId,
      manifestPath: exportArtifactPackage.manifestPath,
      blockedReasons: exportArtifactPackage.blockedReasons
    }
  };
  const requestedRouteAction = Object.entries(routeActions)
    .map(([name, action]) => ({
      stepId: `requested:${name}`,
      action: name,
      reason: `client-requested:${clientRuntimeState.routeIntent.requestedAction}`,
      route: action.route,
      enabled: action.enabled && clientRuntimeState.routeIntent.dispatchReady,
      providerId: action.providerId || null
    }))
    .find((action) => action.route === clientRuntimeState.routeIntent.requestedRoute) || null;
  const requestedNextStep = nextStepActions
    .find((step) => step.enabled && step.route === clientRuntimeState.routeIntent.requestedRoute) || null;
  const primaryAction = requestedNextStep
    || (requestedRouteAction && requestedRouteAction.enabled ? requestedRouteAction : null)
    || nextStepActions.find((step) => step.enabled)
    || null;
  const handoffRoute = primaryAction?.route || clientRuntimeState.route;
  const handoffPayload = {
    requestId: clientRuntimeState.requestId,
    sessionId: clientRuntimeState.sessionId,
    cursor: previewContract.cursor,
    commandId: idempotentCommand.commandId,
    selectedPaths: selectedRows.map((row) => row.path),
    selectedBlockedCount: selectedBlockedRows.length,
    exportPackageId: exportArtifactPackage.packageId
  };

  return {
    contractVersion: "artifact-root.client-preview-acceptance.v1",
    clientRuntimeState,
    cursor: previewContract.cursor,
    readiness: readinessContract.readiness,
    ready: readinessContract.ready,
    healthStatus: operationalHealth.status,
    lifecycle: {
      enablement: lifecycleSettingsControl.enablement,
      scheduleMode: lifecycleSettingsControl.schedule.mode,
      runnableNow: lifecycleSettingsControl.commandGate.runnableNow,
      nextAction: lifecycleSettingsControl.commandGate.nextAction,
      nextActionState: lifecycleSettingsControl.commandGate.nextActionState,
      dueReason: lifecycleSettingsControl.schedule.dueReason,
      nextRunDelayMs: lifecycleSettingsControl.schedule.nextRunDelayMs,
      scheduleBlockedReason: lifecycleSettingsControl.schedule.blockedReason,
      requestedControlAction: lifecycleSettingsControl.controls.requested.action,
      requestedControlExecutable: lifecycleSettingsControl.controls.requestedExecutable,
      nextSettingsPatch: lifecycleSettingsControl.controls.nextSettingsPatch,
      settingsDigest: lifecycleSettingsControl.proof.settingsDigest
    },
    previewRows,
    selection: {
      selectedCount: selectedRows.length,
      selectedBlockedCount: selectedBlockedRows.length,
      selectedOutOfViewCount: clientRuntimeState.selectedOutOfViewPaths.length,
      selectableCount: previewRows.filter((row) => row.blockers.length === 0).length,
      canApplySelection: selectedRows.length > 0
        && selectedBlockedRows.length === 0
        && clientRuntimeState.selectedOutOfViewPaths.length === 0
        && routeActions.applyAcceptedPreview.enabled
    },
    checklist,
    validation: {
      valid: validationSummary.valid,
      failureCount: validationSummary.failureCount,
      warningCount: validationSummary.warningCount,
      items: validationItems
    },
    routeActions,
    nextStepActions,
    primaryAction,
    workflowHandoff: {
      route: handoffRoute,
      enabled: Boolean(primaryAction && primaryAction.enabled) && !clientRuntimeState.offline,
      offlineQueued: clientRuntimeState.offline && Boolean(primaryAction),
      reason: primaryAction ? primaryAction.reason : "no-client-action-available",
      payload: handoffPayload
    },
    proofRefs: {
      previewCursor: acceptanceContract.proof.previewCursor,
      pathAccessDigest: pathAccessManifest.proof.manifestDigest,
      commandId: idempotentCommand.commandId,
      exportId: exportSummary.exportId,
      exportPackageId: exportArtifactPackage.packageId,
      providerRouteCount: providerServiceContract.routes.length
    }
  };
}

function buildClientWorkflowHandoffContract(
  input,
  clientRuntimeState,
  clientPreviewAcceptance,
  readinessContract,
  providerServiceContract,
  exportArtifactPackage,
  auditProof,
  generatedAt
) {
  const handoffRequest = input && typeof input.clientHandoff === "object" && input.clientHandoff !== null
    ? input.clientHandoff
    : {};
  const requestedChannel = normalizeClientHandoffChannel(handoffRequest.channel);
  const requestedPriority = normalizeClientHandoffPriority(handoffRequest.priority);
  const selectedAction = clientPreviewAcceptance.primaryAction || {
    action: "refresh-preview",
    reason: "no-readiness-action-selected",
    route: CLIENT_ROUTE_BY_ACTION.refresh,
    enabled: clientPreviewAcceptance.routeActions.refreshPreview.enabled
  };
  const routeAction = Object.values(clientPreviewAcceptance.routeActions)
    .find((action) => action.route === selectedAction.route) || null;
  const providerRoute = providerServiceContract.routes
    .find((route) => route.providerId && route.intent !== "audit" && route.executionReady)
    || providerServiceContract.routes.find((route) => route.providerId && route.routable)
    || null;
  const handoffRoute = normalizeClientRoute(selectedAction.route, clientPreviewAcceptance.workflowHandoff.route);
  const baseBlockers = [
    ...(clientRuntimeState.offline && requestedChannel !== "worker" ? ["client-offline"] : []),
    ...clientRuntimeState.routeIntent.blockedReasons.map((reason) => `route-intent:${reason}`),
    ...(!selectedAction.enabled ? [`action-disabled:${selectedAction.action}`] : []),
    ...(routeAction ? routeAction.blockedReasons.map((reason) => `route:${reason}`) : []),
    ...(!providerServiceContract.allExecutionReady ? [`provider-execution-gated:${providerServiceContract.executionBlockedRouteCount}`] : []),
    ...(clientPreviewAcceptance.selection.selectedBlockedCount > 0
      ? [`selection-blocked:${clientPreviewAcceptance.selection.selectedBlockedCount}`]
      : []),
    ...(clientPreviewAcceptance.selection.selectedOutOfViewCount > 0
      ? [`selection-out-of-view:${clientPreviewAcceptance.selection.selectedOutOfViewCount}`]
      : [])
  ];
  const offlineQueueable = clientRuntimeState.offline
    && requestedChannel === "worker"
    && ["accept-preview", "return-cached-command-result", "refresh-preview"].includes(selectedAction.action);
  const baseDispatchable = baseBlockers.length === 0 || offlineQueueable;
  const priority = readinessContract.ready
    ? "blocking"
    : clientPreviewAcceptance.healthStatus === "unhealthy"
      ? "high"
      : requestedPriority;
  const envelopeId = typeof handoffRequest.envelopeId === "string" && handoffRequest.envelopeId.length > 0
    ? handoffRequest.envelopeId
    : `client-handoff:${stableProofId([
      clientRuntimeState.requestId,
      selectedAction.action,
      handoffRoute,
      clientPreviewAcceptance.cursor,
      exportArtifactPackage.packageId
    ])}`;
  const dispatchToken = stableProofId([
    envelopeId,
    clientRuntimeState.sessionId,
    clientRuntimeState.requestId,
    providerRoute?.providerId || "no-provider",
    auditProof.evidence
  ]);
  const receiptState = buildClientHandoffReceiptState(
    handoffRequest,
    envelopeId,
    dispatchToken,
    selectedAction,
    handoffRoute,
    generatedAt
  );
  const receiptBlockers = [
    ...(receiptState.acknowledged ? ["handoff-already-acknowledged"] : []),
    ...(receiptState.awaitingReceipt ? [`handoff-receipt-pending:${receiptState.latestReceipt.state}`] : []),
    ...(receiptState.failed ? [`handoff-receipt-failed:${receiptState.latestReceipt.reason || "unknown"}`] : [])
  ];
  const blockers = [...baseBlockers, ...receiptBlockers];
  const dispatchable = baseDispatchable && receiptBlockers.length === 0;
  const clientInstruction = receiptState.acknowledged || receiptState.awaitingReceipt || receiptState.failed
    ? receiptState.nextClientInstruction
    : dispatchable
      ? offlineQueueable
        ? "queue-for-worker-replay"
        : clientRuntimeState.routeIntent.routeDrifted
          ? "navigate-and-dispatch-route"
          : "dispatch-route"
      : blockers.length > 0
        ? "show-blockers"
        : "stay-on-current-route";

  return {
    contractVersion: "artifact-root.client-workflow-handoff.v1",
    envelopeId,
    generatedAt,
    channel: requestedChannel,
    priority,
    dispatchable,
    baseDispatchable,
    offlineQueueable,
    route: handoffRoute,
    action: selectedAction.action,
    reason: selectedAction.reason,
    provider: {
      providerId: providerRoute ? providerRoute.providerId : null,
      intent: providerRoute ? providerRoute.intent : null,
      executionReady: Boolean(providerRoute && providerRoute.executionReady),
      syncCursor: providerRoute ? providerRoute.syncCursor : clientPreviewAcceptance.cursor
    },
    request: {
      requestId: clientRuntimeState.requestId,
      sessionId: clientRuntimeState.sessionId,
      cursor: clientPreviewAcceptance.cursor,
      commandId: clientPreviewAcceptance.proofRefs.commandId,
      route: clientRuntimeState.route,
      activePanel: clientRuntimeState.activePanel,
      networkState: clientRuntimeState.networkState,
      routeIntentId: clientRuntimeState.routeIntent.routeIntentId,
      requestedRoute: clientRuntimeState.routeIntent.requestedRoute,
      requestedAction: clientRuntimeState.routeIntent.requestedAction
    },
    payload: {
      ...clientPreviewAcceptance.workflowHandoff.payload,
      exportManifestPath: exportArtifactPackage.manifestPath,
      selectedCount: clientPreviewAcceptance.selection.selectedCount,
      validationFailureCount: clientPreviewAcceptance.validation.failureCount,
      readiness: readinessContract.readiness,
      routeIntentId: clientRuntimeState.routeIntent.routeIntentId,
      requestedAction: clientRuntimeState.routeIntent.requestedAction,
      requestedRoute: clientRuntimeState.routeIntent.requestedRoute,
      navigationPatch: clientRuntimeState.routeIntent.navigationPatch,
      handoffReceipt: {
        latestState: receiptState.latestReceipt ? receiptState.latestReceipt.state : null,
        acknowledged: receiptState.acknowledged,
        replayToken: receiptState.replayToken,
        duplicateReceiptCount: receiptState.duplicateReceiptCount
      }
    },
    receiptState,
    blockers,
    clientInstruction,
    auditTrail: {
      dispatchToken,
      proofStatus: auditProof.status,
      evidence: [
        `handoff:${envelopeId}`,
        `route:${handoffRoute}`,
        `action:${selectedAction.action}`,
        `request:${clientRuntimeState.requestId}`,
        `route-intent:${clientRuntimeState.routeIntent.routeIntentId}`,
        `provider:${providerRoute?.providerId || "none"}`,
        `dispatch:${dispatchToken}`,
        `receipt:${receiptState.latestReceipt ? receiptState.latestReceipt.state : "none"}:${receiptState.replayToken}`
      ]
    }
  };
}

function buildClientRouteSubmissionContracts(
  clientRuntimeState,
  clientPreviewAcceptance,
  readinessContract,
  acceptanceContract,
  pathAccessManifest,
  recoveryContract,
  restartPersistencePlan,
  exportArtifactPackage,
  clientWorkflowHandoff,
  auditProof,
  generatedAt
) {
  const selectedPathSet = new Set(clientPreviewAcceptance.workflowHandoff.payload.selectedPaths);
  const selectedPathDecisions = pathAccessManifest.decisions
    .filter((decision) => selectedPathSet.has(decision.path));
  const selectedDenied = selectedPathDecisions.filter((decision) => decision.decision === "deny");
  const selectedWriteBlocked = selectedPathDecisions.filter((decision) => decision.writeBlockedReasons.length > 0);
  const selectionDigest = stableProofId(selectedPathDecisions.map((decision) => [
    decision.path,
    decision.decision,
    decision.writeBlockedReasons,
    decision.auditRef
  ]));
  const validationDigest = stableProofId([
    clientPreviewAcceptance.validation.items.map((item) => [item.severity, item.code, item.detail]),
    readinessContract.readiness,
    acceptanceContract.decision,
    exportArtifactPackage.packageId
  ]);
  const basePayload = {
    requestId: clientRuntimeState.requestId,
    sessionId: clientRuntimeState.sessionId,
    cursor: clientPreviewAcceptance.cursor,
    submittedAt: generatedAt,
    activePanel: clientRuntimeState.activePanel,
    networkState: clientRuntimeState.networkState
  };
  const buildSubmission = (name, route, enabled, blockedReasons, payloadPatch = {}) => {
    const normalizedBlockedReasons = normalizeStringList(blockedReasons);
    const idempotencyKey = stableProofId([
      name,
      route,
      basePayload.requestId,
      basePayload.cursor,
      selectionDigest,
      validationDigest,
      JSON.stringify(payloadPatch)
    ]);

    return {
      name,
      route,
      method: "POST",
      enabled: enabled && normalizedBlockedReasons.length === 0,
      blockedReasons: normalizedBlockedReasons,
      idempotencyKey,
      payload: {
        ...basePayload,
        ...payloadPatch,
        idempotencyKey,
        validationDigest,
        selectionDigest
      }
    };
  };
  const selectedPaths = [...selectedPathSet].sort();
  const acceptBlockedReasons = [
    ...(!clientPreviewAcceptance.routeActions.acceptPreview.enabled ? clientPreviewAcceptance.routeActions.acceptPreview.blockedReasons : []),
    ...(selectedDenied.length > 0 ? [`selection-denied:${selectedDenied.length}`] : []),
    ...(selectedWriteBlocked.length > 0 ? [`selection-write-blocked:${selectedWriteBlocked.length}`] : []),
    ...(clientPreviewAcceptance.selection.selectedOutOfViewCount > 0
      ? [`selection-out-of-view:${clientPreviewAcceptance.selection.selectedOutOfViewCount}`]
      : [])
  ];
  const commitBlockedReasons = [
    ...(!readinessContract.ready ? [`readiness:${readinessContract.readiness}`] : []),
    ...clientPreviewAcceptance.routeActions.applyAcceptedPreview.blockedReasons,
    ...(clientWorkflowHandoff.dispatchable ? [] : clientWorkflowHandoff.blockers.map((blocker) => `handoff:${blocker}`))
  ];
  const exportBlockedReasons = [
    ...clientPreviewAcceptance.routeActions.exportAuditProof.blockedReasons,
    ...(auditProof.status !== "ready" ? [`audit:${auditProof.status}`] : [])
  ];
  const recoveryBlockedReasons = recoveryContract.restartSafeStatus === "clean"
    ? ["recovery-not-required"]
    : recoveryContract.restartSafeStatus === "blocked"
      ? []
      : recoveryContract.replayQueue.length === 0
        ? ["recovery-has-empty-replay-queue"]
        : [];
  const runtimeRestartHandoff = clientRuntimeState.runtimeRestartHandoff;
  const runtimeRestartBlockedReasons = [
    ...recoveryBlockedReasons,
    ...(runtimeRestartHandoff.dispatchReady ? [] : runtimeRestartHandoff.blockedReasons.map((reason) => `runtime-restart:${reason}`))
  ];

  return {
    contractVersion: "artifact-root.client-route-submissions.v1",
    generatedAt,
    requestId: clientRuntimeState.requestId,
    validationDigest,
    selection: {
      selectedPaths,
      selectedPathCount: selectedPaths.length,
      selectedDeniedCount: selectedDenied.length,
      selectedWriteBlockedCount: selectedWriteBlocked.length,
      selectedAuditRefs: selectedPathDecisions.map((decision) => decision.auditRef),
      selectionDigest
    },
    submissions: {
      refreshPreview: buildSubmission(
        "refreshPreview",
        CLIENT_ROUTE_BY_ACTION.refresh,
        clientPreviewAcceptance.routeActions.refreshPreview.enabled,
        clientPreviewAcceptance.routeActions.refreshPreview.blockedReasons,
        { requestedPanel: "preview" }
      ),
      acceptPreview: buildSubmission(
        "acceptPreview",
        CLIENT_ROUTE_BY_ACTION.accept,
        clientPreviewAcceptance.routeActions.acceptPreview.enabled,
        acceptBlockedReasons,
        {
          decision: "accepted",
          selectedPaths,
          acceptedBy: acceptanceContract.acceptedBy || clientRuntimeState.sessionId,
          previewCursor: acceptanceContract.proof.previewCursor,
          pathAccessDigest: acceptanceContract.proof.pathAccessDigest
        }
      ),
      applyAcceptedPreview: buildSubmission(
        "applyAcceptedPreview",
        CLIENT_ROUTE_BY_ACTION.apply,
        clientPreviewAcceptance.routeActions.applyAcceptedPreview.enabled,
        commitBlockedReasons,
        {
          commandId: clientPreviewAcceptance.routeActions.applyAcceptedPreview.commandId,
          selectedPaths,
          handoffEnvelopeId: clientWorkflowHandoff.envelopeId,
          dispatchToken: clientWorkflowHandoff.auditTrail.dispatchToken
        }
      ),
      exportAuditProof: buildSubmission(
        "exportAuditProof",
        CLIENT_ROUTE_BY_ACTION.export,
        clientPreviewAcceptance.routeActions.exportAuditProof.enabled,
        exportBlockedReasons,
        {
          exportId: clientPreviewAcceptance.routeActions.exportAuditProof.exportId,
          packageId: exportArtifactPackage.packageId,
          manifestPath: exportArtifactPackage.manifestPath,
          artifactCount: exportArtifactPackage.artifactCount
        }
      ),
      recoverArtifactRoot: buildSubmission(
        "recoverArtifactRoot",
        CLIENT_ROUTE_BY_ACTION.recover,
        recoveryContract.restartSafeStatus !== "clean" && runtimeRestartHandoff.state !== "clean",
        runtimeRestartBlockedReasons,
        {
          restartSafeStatus: recoveryContract.restartSafeStatus,
          runtimeRestartState: runtimeRestartHandoff.state,
          runtimeRestartInstruction: runtimeRestartHandoff.instruction,
          runtimeRestartHandoffId: runtimeRestartHandoff.handoffId,
          replayableCommandIds: recoveryContract.replayableCommandIds,
          readyReplayCommandIds: runtimeRestartHandoff.replayRows
            .filter((row) => row.dispatchReady)
            .map((row) => row.commandId),
          replayRows: runtimeRestartHandoff.replayRows,
          nextPersistedStatePatch: recoveryContract.nextPersistedStatePatch,
          writePlanId: restartPersistencePlan.writePlanId,
          writeMode: restartPersistencePlan.writeMode,
          durableAfterWrite: restartPersistencePlan.durableAfterWrite,
          restartPersistencePatch: restartPersistencePlan.nextPersistedState,
          runtimeRestartClientStatePatch: runtimeRestartHandoff.clientStatePatch,
          runtimeRestartPersistedStatePatch: runtimeRestartHandoff.persistedStatePatch
        }
      )
    },
    proof: {
      auditStatus: auditProof.status,
      readiness: readinessContract.readiness,
      acceptanceDecision: acceptanceContract.decision,
      handoffEnvelopeId: clientWorkflowHandoff.envelopeId,
      runtimeRestartHandoffId: runtimeRestartHandoff.handoffId,
      runtimeRestartState: runtimeRestartHandoff.state,
      submissionDigest: stableProofId([
        validationDigest,
        selectionDigest,
        clientWorkflowHandoff.auditTrail.dispatchToken,
        exportArtifactPackage.manifestProof.proofId,
        runtimeRestartHandoff.handoffId,
        runtimeRestartHandoff.state
      ])
    }
  };
}

function buildClientValidationSummaryContract(
  previewContract,
  pathAccessManifest,
  acceptanceContract,
  validationSummary,
  readinessContract,
  operationalHealth,
  clientPreviewAcceptance,
  clientWorkflowHandoff,
  clientRouteSubmissions,
  generatedAt
) {
  const submissions = Object.entries(clientRouteSubmissions.submissions)
    .map(([name, submission]) => ({
      name,
      route: submission.route,
      method: submission.method,
      enabled: submission.enabled,
      blockedReasons: submission.blockedReasons,
      idempotencyKey: submission.idempotencyKey,
      payloadDigest: stableProofId([
        submission.route,
        submission.idempotencyKey,
        submission.payload.validationDigest,
        submission.payload.selectionDigest
      ])
    }));
  const enabledSubmissions = submissions.filter((submission) => submission.enabled);
  const blockedSubmissions = submissions.filter((submission) => !submission.enabled);
  const primaryBlockingItem = clientPreviewAcceptance.validation.items
    .find((item) => item.severity === "error")
    || clientPreviewAcceptance.validation.items.find((item) => item.severity === "warning")
    || null;
  const selectedDeniedPaths = pathAccessManifest.decisions
    .filter((decision) => clientRouteSubmissions.selection.selectedPaths.includes(decision.path) && decision.decision === "deny")
    .map((decision) => ({
      path: decision.path,
      deniedReasons: decision.deniedReasons,
      auditRef: decision.auditRef
    }));
  const selectedWriteBlockedPaths = pathAccessManifest.decisions
    .filter((decision) => clientRouteSubmissions.selection.selectedPaths.includes(decision.path) && decision.writeBlockedReasons.length > 0)
    .map((decision) => ({
      path: decision.path,
      writeBlockedReasons: decision.writeBlockedReasons,
      auditRef: decision.auditRef
    }));
  const routeSummary = Object.fromEntries(submissions.map((submission) => [
    submission.name,
    {
      route: submission.route,
      enabled: submission.enabled,
      blockedReasonCount: submission.blockedReasons.length,
      firstBlockedReason: submission.blockedReasons[0] || null,
      idempotencyKey: submission.idempotencyKey,
      payloadDigest: submission.payloadDigest
    }
  ]));
  const emptyState = previewContract.totalItems === 0
    ? {
      code: "preview-empty",
      message: "No artifact changes are visible for this workspace and cursor.",
      action: clientPreviewAcceptance.routeActions.refreshPreview.enabled ? "refreshPreview" : "inspectValidation"
    }
    : null;
  const validationDigest = stableProofId([
    generatedAt,
    readinessContract.readiness,
    operationalHealth.status,
    validationSummary.failures.map((failure) => [failure.code, failure.detail]),
    validationSummary.warnings.map((warning) => [warning.code, warning.detail]),
    submissions.map((submission) => [submission.name, submission.enabled, submission.blockedReasons]),
    selectedDeniedPaths.map((entry) => [entry.path, entry.auditRef])
  ]);

  return {
    contractVersion: "artifact-root.client-validation-summary.v1",
    generatedAt,
    validationDigest,
    readiness: readinessContract.readiness,
    ready: readinessContract.ready,
    healthStatus: operationalHealth.status,
    acceptanceDecision: acceptanceContract.decision,
    previewCursor: previewContract.cursor,
    primaryBlocker: primaryBlockingItem ? {
      severity: primaryBlockingItem.severity,
      code: primaryBlockingItem.code,
      detail: primaryBlockingItem.detail
    } : null,
    emptyState,
    selectedPathRisk: {
      selectedPathCount: clientRouteSubmissions.selection.selectedPathCount,
      selectedDeniedCount: selectedDeniedPaths.length,
      selectedWriteBlockedCount: selectedWriteBlockedPaths.length,
      selectedDeniedPaths,
      selectedWriteBlockedPaths,
      selectionDigest: clientRouteSubmissions.selection.selectionDigest
    },
    routeSummary,
    routeAvailability: {
      enabledSubmissionCount: enabledSubmissions.length,
      blockedSubmissionCount: blockedSubmissions.length,
      enabledSubmissionNames: enabledSubmissions.map((submission) => submission.name),
      blockedSubmissionNames: blockedSubmissions.map((submission) => submission.name),
      workflowDispatchable: clientWorkflowHandoff.dispatchable,
      clientInstruction: clientWorkflowHandoff.clientInstruction
    },
    counts: {
      previewItems: previewContract.totalItems,
      validationFailures: validationSummary.failureCount,
      validationWarnings: validationSummary.warningCount,
      deniedPaths: pathAccessManifest.deniedPathCount,
      writeBlockedPaths: pathAccessManifest.writeBlockedPathCount,
      healthFailures: operationalHealth.failureCount
    }
  };
}

export function describeArtifactRootSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const generatedAt = toIsoTimestamp(now);
  const root = normalizeArtifactRoot(input, generatedAt);
  const workspaceScope = buildWorkspaceScope(input, root);
  const bootArtifactRoot = buildBootArtifactRoot(root, workspaceScope, input, generatedAt);
  const permissionContract = buildPermissionContract(input, workspaceScope);
  const providers = normalizeProviders(input);
  const capabilityContract = negotiateCapabilities(input, providers, permissionContract);
  const syncMetadata = buildSyncMetadata(input, root, generatedAt);
  const providerSyncRegistry = normalizeProviderSyncRegistry(input, providers, syncMetadata, generatedAt);
  const externalHandoff = buildExternalHandoff(input, providers, syncMetadata, permissionContract, generatedAt);
  const previewContract = buildPreviewContract(
    input,
    root,
    workspaceScope,
    syncMetadata,
    capabilityContract,
    permissionContract
  );
  const pathAccessManifest = buildPathAccessManifest(
    input,
    workspaceScope,
    permissionContract,
    syncMetadata,
    previewContract
  );
  const auditProof = buildAuditProof(
    root,
    workspaceScope,
    permissionContract,
    capabilityContract,
    syncMetadata,
    pathAccessManifest,
    externalHandoff,
    input
  );
  const acceptanceContract = buildAcceptanceContract(
    input,
    previewContract,
    pathAccessManifest,
    capabilityContract,
    permissionContract,
    syncMetadata,
    externalHandoff
  );
  const persistedState = normalizePersistedState(input, root, syncMetadata, generatedAt);
  const recoveryContract = buildRecoveryContract(persistedState, syncMetadata, externalHandoff);
  const lifecycleSettingsControl = buildLifecycleSettingsControl(
    input,
    syncMetadata,
    permissionContract,
    generatedAt
  );
  const idempotentCommand = buildIdempotentCommandContract(
    input,
    persistedState,
    recoveryContract,
    capabilityContract,
    acceptanceContract,
    lifecycleSettingsControl
  );
  const restartPersistencePlan = buildRestartPersistencePlan(
    input,
    persistedState,
    recoveryContract,
    idempotentCommand,
    syncMetadata,
    generatedAt
  );
  const bootRecoveryManifest = buildBootRecoveryManifest(
    input,
    bootArtifactRoot,
    persistedState,
    recoveryContract,
    restartPersistencePlan,
    generatedAt
  );
  const providerServiceContract = buildProviderServiceContract(
    input,
    providers,
    capabilityContract,
    permissionContract,
    syncMetadata,
    externalHandoff,
    previewContract,
    pathAccessManifest,
    acceptanceContract,
    recoveryContract,
    idempotentCommand,
    providerSyncRegistry
  );
  const operationalHealth = buildOperationalHealth(
    input,
    syncMetadata,
    externalHandoff,
    recoveryContract,
    idempotentCommand,
    providerServiceContract,
    bootArtifactRoot,
    generatedAt
  );
  const validationSummary = buildValidationSummary(
    workspaceScope,
    permissionContract,
    capabilityContract,
    syncMetadata,
    externalHandoff,
    previewContract,
    pathAccessManifest,
    acceptanceContract,
    recoveryContract,
    idempotentCommand,
    lifecycleSettingsControl,
    operationalHealth,
    providerServiceContract,
    providerSyncRegistry
  );
  const readinessContract = buildReadinessAndNextSteps(
    workspaceScope,
    permissionContract,
    validationSummary,
    previewContract,
    pathAccessManifest,
    acceptanceContract,
    externalHandoff,
    recoveryContract,
    idempotentCommand,
    lifecycleSettingsControl,
    operationalHealth
  );
  const historySnapshots = buildHistorySnapshots(
    input,
    root,
    syncMetadata,
    persistedState,
    readinessContract,
    operationalHealth,
    generatedAt
  );
  const analyticsCounters = buildAnalyticsCounters(
    root,
    workspaceScope,
    permissionContract,
    capabilityContract,
    syncMetadata,
    previewContract,
    pathAccessManifest,
    persistedState,
    recoveryContract,
    idempotentCommand,
    lifecycleSettingsControl,
    operationalHealth,
    readinessContract,
    historySnapshots,
    providerServiceContract,
    providerSyncRegistry
  );
  const timelineReport = buildTimelineReport(
    historySnapshots,
    persistedState,
    acceptanceContract,
    externalHandoff,
    lifecycleSettingsControl,
    operationalHealth,
    readinessContract,
    generatedAt
  );
  const exportSummary = buildExportSummary(
    input,
    analyticsCounters,
    historySnapshots,
    timelineReport,
    auditProof,
    readinessContract,
    permissionContract,
    providerServiceContract
  );
  const exportArtifactPackage = buildExportArtifactPackage(
    input,
    root,
    workspaceScope,
    syncMetadata,
    previewContract,
    acceptanceContract,
    providerServiceContract,
    timelineReport,
    exportSummary,
    auditProof,
    generatedAt
  );
  const analyticsReportingState = buildAnalyticsReportingState(
    input,
    analyticsCounters,
    historySnapshots,
    timelineReport,
    exportSummary,
    exportArtifactPackage,
    operationalHealth,
    providerServiceContract,
    pathAccessManifest,
    generatedAt
  );
  const exportDataContract = buildExportDataContract(
    input,
    analyticsCounters,
    historySnapshots,
    timelineReport,
    providerServiceContract,
    auditProof,
    exportArtifactPackage,
    generatedAt
  );
  const clientRuntimeState = buildClientRuntimeState(
    input,
    workspaceScope,
    syncMetadata,
    previewContract,
    idempotentCommand,
    lifecycleSettingsControl,
    recoveryContract,
    restartPersistencePlan,
    generatedAt
  );
  const clientPreviewAcceptance = buildClientPreviewAcceptanceContract(
    clientRuntimeState,
    previewContract,
    pathAccessManifest,
    acceptanceContract,
    validationSummary,
    readinessContract,
    providerServiceContract,
    idempotentCommand,
    lifecycleSettingsControl,
    operationalHealth,
    exportSummary,
    exportArtifactPackage
  );
  const clientWorkflowHandoff = buildClientWorkflowHandoffContract(
    input,
    clientRuntimeState,
    clientPreviewAcceptance,
    readinessContract,
    providerServiceContract,
    exportArtifactPackage,
    auditProof,
    generatedAt
  );
  const clientRouteSubmissions = buildClientRouteSubmissionContracts(
    clientRuntimeState,
    clientPreviewAcceptance,
    readinessContract,
    acceptanceContract,
    pathAccessManifest,
    recoveryContract,
    restartPersistencePlan,
    exportArtifactPackage,
    clientWorkflowHandoff,
    auditProof,
    generatedAt
  );
  const clientValidationSummary = buildClientValidationSummaryContract(
    previewContract,
    pathAccessManifest,
    acceptanceContract,
    validationSummary,
    readinessContract,
    operationalHealth,
    clientPreviewAcceptance,
    clientWorkflowHandoff,
    clientRouteSubmissions,
    generatedAt
  );

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: ARTIFACT_ROOT_CONTRACT_VERSION,
    root,
    workspaceScope,
    bootArtifactRoot,
    permissionContract,
    providers,
    capabilityContract,
    syncMetadata,
    providerSyncRegistry,
    externalHandoff,
    previewContract,
    pathAccessManifest,
    acceptanceContract,
    persistedState,
    recoveryContract,
    restartPersistencePlan,
    bootRecoveryManifest,
    lifecycleSettingsControl,
    idempotentCommand,
    providerServiceContract,
    operationalHealth,
    validationSummary,
    readinessContract,
    analyticsCounters,
    historySnapshots,
    timelineReport,
    exportSummary,
    exportArtifactPackage,
    exportDataContract,
    analyticsReportingState,
    clientRuntimeState,
    clientPreviewAcceptance,
    clientWorkflowHandoff,
    clientRouteSubmissions,
    clientValidationSummary,
    auditProof,
    evidence: [
      ...auditProof.evidence,
      `analytics:${analyticsCounters.scopeKey}:${analyticsCounters.counters.previewItems}`,
      `path-access:${pathAccessManifest.proof.manifestDigest}:${pathAccessManifest.deniedPathCount}:denied`,
      `path-access-write-blocks:${pathAccessManifest.writeBlockedPathCount}:${pathAccessManifest.auditHandoff.refs.length}:audit-refs`,
      `provider-routes:${providerServiceContract.activeProviderIds.join(",") || "none"}:${providerServiceContract.blockedRouteCount}`,
      `provider-sync:${providerSyncRegistry.proof.registryDigest}:${providerSyncRegistry.currentProviderCount}/${providerSyncRegistry.providerCount}:current`,
      `provider-sync-records:${providerSyncRegistry.proof.recordDigest}:${providerSyncRegistry.acceptedRecordCount}/${providerSyncRegistry.inputRecordCount}:accepted:${providerSyncRegistry.ignoredRecordCount}:ignored:${providerSyncRegistry.duplicateRecordCount}:duplicate`,
      `boot-root:${bootArtifactRoot.rootFingerprint}:${bootArtifactRoot.initialized ? "initialized" : "blocked"}:${bootArtifactRoot.requiredArtifacts.length}`,
      `boot-root-metadata:${bootArtifactRoot.rootMetadataValidation.status}:${bootArtifactRoot.rootMetadataValidation.proof.validationDigest}:${bootArtifactRoot.rootMetadataValidation.nextAction}`,
      `boot-recovery:${bootRecoveryManifest.manifestId}:${bootRecoveryManifest.repairRequired ? "repair" : "consistent"}:${bootRecoveryManifest.proof.repairItemCount}`,
      `restart-persistence:${restartPersistencePlan.writePlanId}:${restartPersistencePlan.writeMode}:${restartPersistencePlan.restartSafeStatus}`,
      `timeline:${timelineReport.entryCount}`,
      `export:${exportSummary.exportId}:${exportSummary.exportable ? "ready" : "blocked"}`,
      `export-package:${exportArtifactPackage.packageId}:${exportArtifactPackage.readyArtifactCount}/${exportArtifactPackage.artifactCount}`,
      `export-data-contract:${exportDataContract.proof.contractDigest}:${exportDataContract.proof.blockedPlanCount}:blocked`,
      `analytics-report:${analyticsReportingState.reportId}:${analyticsReportingState.proof.alertCount}:alerts`,
      `lifecycle:${lifecycleSettingsControl.enablement}:${lifecycleSettingsControl.schedule.mode}:${lifecycleSettingsControl.commandGate.nextAction}`,
      `lifecycle-schedule:${lifecycleSettingsControl.proof.scheduleDigest}:${lifecycleSettingsControl.schedule.dueReason || "not-due"}:${lifecycleSettingsControl.schedule.blockedReason || "ready"}`,
      `lifecycle-controls:${lifecycleSettingsControl.proof.settingsDigest}:${lifecycleSettingsControl.controls.requested.action || "none"}:${lifecycleSettingsControl.controls.requestedExecutable ? "executable" : "blocked"}`,
      `client-runtime:${clientRuntimeState.requestId}:${clientRuntimeState.activePanel}:${clientRuntimeState.networkState}`,
      `client-route-intent:${clientRuntimeState.routeIntent.routeIntentId}:${clientRuntimeState.routeIntent.requestedAction}:${clientRuntimeState.routeIntent.dispatchReady ? "ready" : "blocked"}`,
      `restart-client-action:${clientRuntimeState.runtimeRestartHandoff.clientAction.actionId}:${clientRuntimeState.runtimeRestartHandoff.clientAction.action}:${clientRuntimeState.runtimeRestartHandoff.clientAction.state}`,
      `client-preview:${clientPreviewAcceptance.cursor}:${clientPreviewAcceptance.primaryAction?.action || "no-action"}`,
      `client-handoff:${clientWorkflowHandoff.envelopeId}:${clientWorkflowHandoff.clientInstruction}:${clientWorkflowHandoff.auditTrail.dispatchToken}`,
      `client-handoff-receipts:${clientWorkflowHandoff.receiptState.matchingReceiptCount}:${clientWorkflowHandoff.receiptState.latestReceipt?.state || "none"}:${clientWorkflowHandoff.receiptState.replayToken}`,
      `client-submissions:${clientRouteSubmissions.proof.submissionDigest}:${clientRouteSubmissions.selection.selectedPathCount}:selected`,
      `client-validation:${clientValidationSummary.validationDigest}:${clientValidationSummary.routeAvailability.enabledSubmissionCount}:enabled`
    ]
  };
}

export default describeArtifactRootSurface;
