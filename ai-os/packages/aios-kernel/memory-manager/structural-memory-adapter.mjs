export const surfaceId = "aios_memory-manager_structural-memory-adapter_045";
export const surfaceGroup = "memory-manager";
export const surfaceName = "structural-memory-adapter";

const schemaVersion = "structural-memory-adapter.analytics.v1";
const defaultRoute = "memory-manager/structural-memory-adapter";
const historyLimit = 8;
const timelineLimit = 24;
const commandLedgerLimit = 48;
const failureEventLimit = 12;
const actionableErrorLimit = 8;
const previewOperationLimit = 8;
const defaultRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 30000,
  maxDelayMs: 900000
};
const supportedLifecycleCommands = new Set([
  "enable",
  "disable",
  "pause",
  "resume",
  "schedule",
  "compact",
  "reindex",
  "validate",
  "export"
]);
const allowedScheduleCadences = new Set(["manual", "hourly", "daily", "weekly"]);
const cadenceMinimumLeadMs = {
  manual: 0,
  hourly: 60000,
  daily: 300000,
  weekly: 900000
};
const requiredHostedCapabilities = ["read", "write", "delta-sync"];
const optionalHostedCapabilities = ["snapshot-export", "tombstone-compaction", "proof-stream", "external-handoff"];
const commandPermissionRequirements = {
  enable: "write",
  disable: "write",
  pause: "write",
  resume: "write",
  schedule: "write",
  compact: "delta-sync",
  reindex: "delta-sync",
  validate: "read",
  export: "read"
};
const rolePermissionGrants = {
  "kernel-service": ["read", "write", "delta-sync", "external-handoff", "snapshot-export", "proof-stream"],
  "tenant-admin": ["read", "write", "delta-sync", "external-handoff", "snapshot-export"],
  "structural-memory-admin": ["read", "write", "delta-sync", "external-handoff", "snapshot-export"],
  "memory-operator": ["read", "write", "delta-sync"],
  auditor: ["read", "snapshot-export"],
  observer: ["read"]
};
const namespacePermissionRequirements = {
  tombstoned: "write",
  active: "write",
  archived: "write"
};
const defaultProviderContract = {
  providerId: "hosted-kernel-structural-memory",
  service: "structural-memory",
  route: defaultRoute,
  transport: "in-process",
  capabilities: [...requiredHostedCapabilities, "snapshot-export", "proof-stream"],
  syncMode: "delta"
};
const supportedProviderProtocols = new Set(["in-process", "kernel-rpc", "event-stream", "http"]);
const supportedConsistencyModels = new Set(["strong", "bounded-staleness", "eventual"]);
const supportedAckModes = new Set(["sync", "async", "proof-required"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toIso(value, fallback) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function countInto(target, key) {
  const bucket = key || "unspecified";
  target[bucket] = (target[bucket] || 0) + 1;
}

function stableProofId(parts) {
  const text = parts.filter(Boolean).join("|");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `sma-proof-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function toBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "enabled", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "disabled", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function boundedNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeHealthSeverity(value) {
  const severity = String(value || "").trim().toLowerCase();
  if (["fatal", "error", "warning", "info"].includes(severity)) return severity;
  return "error";
}

function addMilliseconds(dateIso, milliseconds) {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  date.setTime(date.getTime() + milliseconds);
  return date.toISOString();
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map((value) => String(value).trim()).filter(Boolean))];
}

function uniqueStringList(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
}

function normalizeWorkspaceGrant(grant, index, boundaryTenantId, boundaryWorkspaceId) {
  const source = grant && typeof grant === "object" ? grant : { workspaceId: grant };
  const tenantId = String(source.tenantId || source.tenant || boundaryTenantId || "*").trim() || "*";
  const workspaceId = String(source.workspaceId || source.workspace || source.id || boundaryWorkspaceId || "*").trim() || "*";
  const principalIds = uniqueStringList(source.principalIds || source.principals || source.principalId);
  const roles = uniqueStringList(source.roles || source.role).map((role) => role.toLowerCase());
  const permissions = uniqueStringList(source.permissions || source.grants || source.capabilities)
    .map((permission) => permission.toLowerCase());
  const namespaces = uniqueStringList(source.namespaces || source.allowedNamespaces || source.namespace);
  const deniedNamespaces = uniqueStringList(source.deniedNamespaces || source.blockedNamespaces);
  return {
    grantId: String(source.grantId || source.id || stableProofId([
      surfaceId,
      "workspace-grant",
      tenantId,
      workspaceId,
      index
    ])).trim(),
    tenantId,
    workspaceId,
    principalIds,
    roles,
    permissions,
    namespaces,
    deniedNamespaces,
    sourceIndex: index
  };
}

function grantMatchesBoundary(grant, boundary) {
  const roleSet = new Set(boundary.roles.map((role) => role.toLowerCase()));
  const tenantMatches = grant.tenantId === "*" || grant.tenantId === boundary.tenantId;
  const workspaceMatches = grant.workspaceId === "*" || grant.workspaceId === boundary.workspaceId;
  const principalMatches = grant.principalIds.length === 0 || grant.principalIds.includes(boundary.principalId);
  const roleMatches = grant.roles.length === 0 || grant.roles.some((role) => roleSet.has(role));
  return tenantMatches && workspaceMatches && principalMatches && roleMatches;
}

function normalizeBoundaryContext(input) {
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const workspace = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const boundary = input.boundary && typeof input.boundary === "object" ? input.boundary : {};
  const tenantId = String(input.tenantId || workspace.tenantId || boundary.tenantId || "kernel").trim() || "kernel";
  const workspaceId = String(input.workspaceId || workspace.id || workspace.workspaceId || boundary.workspaceId || "default").trim()
    || "default";
  const principalId = String(input.principalId || actor.id || actor.principalId || actor.name || "kernel-service").trim()
    || "kernel-service";
  const roles = uniqueStringList(actor.roles || input.roles || boundary.roles).map((role) => role.toLowerCase());
  const explicitPermissions = uniqueStringList(
    actor.permissions || input.permissions || boundary.permissions || ["read", "write", "delta-sync"]
  ).map((permission) => permission.toLowerCase());
  const roleGrantedPermissions = uniqueStrings(roles.flatMap((role) => rolePermissionGrants[role] || []));
  const workspaceAllowList = uniqueStringList(boundary.allowedWorkspaces || input.allowedWorkspaces || [workspaceId]);
  const rawWorkspaceGrants = [
    ...asArray(boundary.workspaceGrants || input.workspaceGrants),
    ...asArray(workspace.grants || workspace.permissions)
  ];
  const normalizedGrantBoundary = { tenantId, workspaceId, principalId, roles };
  const workspaceGrants = rawWorkspaceGrants
    .map((grant, index) => normalizeWorkspaceGrant(grant, index, tenantId, workspaceId));
  const matchedWorkspaceGrants = workspaceGrants.filter((grant) => grantMatchesBoundary(grant, normalizedGrantBoundary));
  const grantPermissions = uniqueStrings(matchedWorkspaceGrants.flatMap((grant) => grant.permissions));
  const permissions = uniqueStrings([...explicitPermissions, ...roleGrantedPermissions, ...grantPermissions])
    .map((permission) => permission.toLowerCase());
  const baseAllowedNamespaces = uniqueStringList(boundary.allowedNamespaces || input.allowedNamespaces);
  const grantAllowedNamespaces = uniqueStrings(matchedWorkspaceGrants.flatMap((grant) => grant.namespaces));
  const allowedNamespaces = baseAllowedNamespaces.length > 0
    ? uniqueStrings([...baseAllowedNamespaces, ...grantAllowedNamespaces])
    : grantAllowedNamespaces;
  const deniedNamespaces = uniqueStrings([
    ...uniqueStringList(boundary.deniedNamespaces || input.deniedNamespaces),
    ...matchedWorkspaceGrants.flatMap((grant) => grant.deniedNamespaces)
  ]);
  const strictTenant = toBoolean(boundary.strictTenant ?? input.strictTenant, true);
  const strictWorkspace = toBoolean(boundary.strictWorkspace ?? input.strictWorkspace, true);
  const workspaceAllowed = workspaceAllowList.length === 0 || workspaceAllowList.includes(workspaceId);
  const missingPermissions = requiredHostedCapabilities.filter((permission) => !permissions.includes(permission));
  const workspaceTenantId = String(workspace.tenantId || workspace.tenant || "").trim();
  const issues = [];

  if (strictTenant && workspaceTenantId && workspaceTenantId !== tenantId) {
    issues.push({
      field: "workspace.tenantId",
      severity: "error",
      message: `workspace tenant ${workspaceTenantId} does not match active tenant ${tenantId}`
    });
  }
  if (!workspaceAllowed) {
    issues.push({
      field: "workspaceId",
      severity: "error",
      message: `workspace ${workspaceId} is not in the allowed workspace scope`
    });
  }
  if (missingPermissions.length > 0) {
    issues.push({
      field: "permissions",
      severity: "warning",
      message: `principal is missing hosted-kernel permissions: ${missingPermissions.join(", ")}`
    });
  }
  if (allowedNamespaces.some((namespace) => deniedNamespaces.includes(namespace))) {
    issues.push({
      field: "allowedNamespaces",
      severity: "error",
      message: "namespace boundary contains the same namespace in allowed and denied scopes"
    });
  }

  const auditSubject = stableProofId([surfaceId, "boundary", tenantId, workspaceId, principalId]);
  const permissionSources = {
    explicit: explicitPermissions,
    roles: roles.map((role) => ({
      role,
      permissions: rolePermissionGrants[role] || []
    })),
    workspaceGrantIds: matchedWorkspaceGrants.map((grant) => grant.grantId)
  };
  const manifestProofId = stableProofId([
    auditSubject,
    permissions.join(","),
    allowedNamespaces.join(","),
    deniedNamespaces.join(","),
    matchedWorkspaceGrants.map((grant) => grant.grantId).join(",")
  ]);

  return {
    schemaVersion: "structural-memory-adapter.boundary.v1",
    tenantId,
    workspaceId,
    principalId,
    roles,
    permissions,
    allowedNamespaces,
    deniedNamespaces,
    workspaceAllowList,
    workspaceGrants,
    matchedWorkspaceGrantIds: matchedWorkspaceGrants.map((grant) => grant.grantId),
    permissionSources,
    permissionManifest: {
      schemaVersion: "structural-memory-adapter.permission-manifest.v1",
      manifestId: manifestProofId,
      tenantId,
      workspaceId,
      principalId,
      effectivePermissions: permissions,
      allowedNamespaces,
      deniedNamespaces,
      matchedGrantCount: matchedWorkspaceGrants.length,
      strictTenant,
      strictWorkspace,
      decision: issues.some((issue) => issue.severity === "error") ? "deny" : "allow"
    },
    strictTenant,
    strictWorkspace,
    ready: !issues.some((issue) => issue.severity === "error"),
    issues,
    auditSubject,
    boundaryProofId: manifestProofId
  };
}

function hasPermission(boundaryContext, permission) {
  return boundaryContext.permissions.includes(permission);
}

function authorizeNamespace(boundaryContext, namespace) {
  if (boundaryContext.deniedNamespaces.includes(namespace)) {
    return `namespace ${namespace} is explicitly denied for this tenant boundary`;
  }
  if (boundaryContext.allowedNamespaces.length > 0 && !boundaryContext.allowedNamespaces.includes(namespace)) {
    return `namespace ${namespace} is outside the allowed namespace scope`;
  }
  return null;
}

function normalizeRecoveredPendingCommand(entry, index, generatedAt) {
  const source = entry && typeof entry === "object" ? entry : { commandId: entry };
  const commandId = String(source.commandId || source.id || source.key || "").trim();
  const type = String(source.type || source.command || source.action || "unknown").trim().toLowerCase();
  const status = String(source.status || source.state || source.phase || "pending").trim().toLowerCase();
  const issuedAt = toIso(source.issuedAt || source.createdAt || source.at, generatedAt);
  const lastAttemptAt = source.lastAttemptAt || source.attemptedAt
    ? toIso(source.lastAttemptAt || source.attemptedAt, generatedAt)
    : null;
  const attemptCount = boundedNumber(source.attemptCount || source.attempts, 0, 0, 99);
  const requiresOperatorReview = toBoolean(source.requiresOperatorReview ?? source.operatorReviewRequired, false);
  const leaseExpiresAt = source.leaseExpiresAt || source.lockExpiresAt
    ? toIso(source.leaseExpiresAt || source.lockExpiresAt, generatedAt)
    : null;
  const leaseExpired = leaseExpiresAt ? !isFutureIso(leaseExpiresAt, generatedAt) : false;
  const replayableStatus = ["pending", "accepted", "in-flight", "retrying", "leased"].includes(status);
  const replayable = Boolean(commandId && replayableStatus && !requiresOperatorReview && (status !== "leased" || leaseExpired));
  const holdReason = !commandId
    ? "missing-command-id"
    : requiresOperatorReview
      ? "operator-review-required"
      : status === "leased" && !leaseExpired
        ? "lease-still-active"
        : replayableStatus
          ? null
          : `unsupported-pending-status:${status}`;

  return {
    commandId: commandId || stableProofId([surfaceId, "recovered-pending-command", index, type, issuedAt]),
    type,
    status,
    issuedAt,
    lastAttemptAt,
    attemptCount,
    leaseExpiresAt,
    leaseExpired,
    replayable,
    holdReason,
    sourceIndex: index,
    proofId: stableProofId([
      surfaceId,
      "pending-command",
      commandId,
      type,
      status,
      issuedAt,
      leaseExpiresAt,
      holdReason
    ])
  };
}

function extractPendingCommandInputs(state) {
  return [
    ...asArray(state?.pendingCommands),
    ...asArray(state?.inFlightCommands),
    ...asArray(state?.scheduler?.pendingCommands),
    ...asArray(state?.scheduler?.inFlightCommands),
    ...asArray(state?.replayQueue)
  ];
}

function normalizePersistedState(input, generatedAt) {
  const stateInput = input.persistedState || input.stateCheckpoint || input.checkpoint || input.recoveredState;
  const state = stateInput && typeof stateInput === "object" ? stateInput : null;
  const rawLedger = asArray(state?.commandLedger || state?.executedCommands || state?.appliedCommandIds);
  const commandLedger = rawLedger
    .map((entry, index) => {
      if (entry && typeof entry === "object") {
        const commandId = String(entry.commandId || entry.id || "").trim();
        return commandId
          ? {
              commandId,
              type: String(entry.type || entry.command || "unknown"),
              appliedAt: toIso(entry.appliedAt || entry.issuedAt || entry.at, generatedAt),
              source: String(entry.source || "persisted-ledger")
            }
          : null;
      }
      const commandId = String(entry || "").trim();
      return commandId
        ? {
            commandId,
            type: "unknown",
            appliedAt: generatedAt,
            source: `persisted-ledger[${index}]`
          }
        : null;
    })
    .filter(Boolean)
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.commandId === entry.commandId) === index)
    .slice(-commandLedgerLimit);
  const appliedCommandIds = new Set(commandLedger.map((entry) => entry.commandId));
  const pendingCommands = extractPendingCommandInputs(state)
    .map((entry, index) => normalizeRecoveredPendingCommand(entry, index, generatedAt))
    .filter((entry, index, all) => (
      !appliedCommandIds.has(entry.commandId)
      && all.findIndex((candidate) => candidate.commandId === entry.commandId) === index
    ))
    .slice(-commandLedgerLimit);
  const replayablePendingCommands = pendingCommands.filter((entry) => entry.replayable);
  const heldPendingCommands = pendingCommands.filter((entry) => !entry.replayable);
  const status = String(state?.status || state?.state || "").trim().toLowerCase();
  const supportedStatus = ["ready", "blocked", "paused", "disabled", "degraded", "running", "standby"];
  const checkpointId = String(state?.checkpointId || state?.snapshotId || state?.id || "").trim();
  const previousGeneratedAt = state
    ? toIso(state.generatedAt || state.capturedAt || state.updatedAt || state.createdAt, generatedAt)
    : null;
  const recoveryIssues = [];
  if (state && status && !supportedStatus.includes(status)) {
    recoveryIssues.push({
      field: "persistedState.status",
      severity: "warning",
      message: `unknown persisted status: ${status}`
    });
  }
  if (state && state.commandLedger !== undefined && !Array.isArray(state.commandLedger)) {
    recoveryIssues.push({
      field: "persistedState.commandLedger",
      severity: "warning",
      message: "commandLedger should be an array; usable entries were recovered from compatible fields"
    });
  }
  if (heldPendingCommands.length > 0) {
    recoveryIssues.push({
      field: "persistedState.pendingCommands",
      severity: "warning",
      message: "one or more recovered pending commands require operator review before replay"
    });
  }

  return {
    schemaVersion: "structural-memory-adapter.persisted-state.v1",
    recovered: Boolean(state),
    recoveryStatus: !state ? "cold-start" : recoveryIssues.some((issue) => issue.severity === "error") ? "degraded" : "restored",
    checkpointId: checkpointId || null,
    previousGeneratedAt,
    restoredAt: generatedAt,
    previousStatus: supportedStatus.includes(status) ? status : null,
    previousCursor: state?.syncCursor || state?.cursor || state?.sync?.cursor || null,
    previousHighWatermark: state?.syncHighWatermark || state?.highWatermark || state?.sync?.highWatermark || null,
    previousNextRunAt: state?.nextRunAt || state?.scheduler?.nextRunAt || null,
    previousLastCommandId: state?.lastCommandId || state?.scheduler?.lastCommandId || null,
    previousExternalHandoff: state?.externalHandoff || state?.externalHandoffGate || state?.handoffState || null,
    commandLedger,
    recoveredCommandCount: commandLedger.length,
    pendingCommands,
    replayablePendingCommands,
    heldPendingCommands,
    pendingCommandCount: pendingCommands.length,
    replayablePendingCommandCount: replayablePendingCommands.length,
    heldPendingCommandCount: heldPendingCommands.length,
    restartReplayStatus: heldPendingCommands.length > 0
      ? "operator-review-required"
      : replayablePendingCommands.length > 0
        ? "replayable"
        : "clear",
    issues: recoveryIssues
  };
}

function applyCommandIdempotency(commandResults, persistedState, generatedAt) {
  const persistedIds = new Set(persistedState.commandLedger.map((entry) => entry.commandId));
  const seenInBatch = new Set();
  const acceptedCommands = [];
  const idempotentCommands = [];

  for (const result of commandResults) {
    if (!result.ok) continue;
    const { command } = result;
    if (persistedIds.has(command.commandId)) {
      const ledgerEntry = persistedState.commandLedger.find((entry) => entry.commandId === command.commandId);
      idempotentCommands.push({
        commandId: command.commandId,
        type: command.type,
        route: command.route,
        issuedAt: command.issuedAt,
        status: "already-applied",
        firstAppliedAt: ledgerEntry?.appliedAt || null,
        reason: "command id was present in recovered persisted ledger"
      });
      continue;
    }
    if (seenInBatch.has(command.commandId)) {
      idempotentCommands.push({
        commandId: command.commandId,
        type: command.type,
        route: command.route,
        issuedAt: command.issuedAt,
        status: "duplicate-in-batch",
        firstAppliedAt: generatedAt,
        reason: "command id was already accepted earlier in this adapter invocation"
      });
      continue;
    }
    seenInBatch.add(command.commandId);
    acceptedCommands.push(command);
  }

  const commandLedger = [
    ...persistedState.commandLedger,
    ...acceptedCommands.map((command) => ({
      commandId: command.commandId,
      type: command.type,
      appliedAt: generatedAt,
      source: "current-invocation"
    }))
  ].slice(-commandLedgerLimit);

  return {
    acceptedCommands,
    idempotentCommands,
    commandLedger,
    idempotentCommandCount: idempotentCommands.length,
    appliedCommandCount: acceptedCommands.length
  };
}

function normalizeProviderServiceContract(contract, capabilities) {
  const serviceContractInput = contract.serviceContract && typeof contract.serviceContract === "object"
    ? contract.serviceContract
    : contract.contract && typeof contract.contract === "object"
      ? contract.contract
      : {};
  const externalHandoffInput = contract.externalHandoff && typeof contract.externalHandoff === "object"
    ? contract.externalHandoff
    : contract.handoff && typeof contract.handoff === "object"
      ? contract.handoff
      : {};
  const protocol = String(
    serviceContractInput.protocol || serviceContractInput.transportProtocol || contract.protocol || contract.transport
      || defaultProviderContract.transport
  ).trim().toLowerCase();
  const consistency = String(serviceContractInput.consistency || serviceContractInput.consistencyModel || "strong")
    .trim()
    .toLowerCase();
  const ackMode = String(serviceContractInput.ackMode || serviceContractInput.acknowledgement || "proof-required")
    .trim()
    .toLowerCase();
  const maxBatchOperations = boundedNumber(serviceContractInput.maxBatchOperations, 500, 1, 5000);
  const maxPayloadBytes = boundedNumber(serviceContractInput.maxPayloadBytes, 10485760, 65536, 104857600);
  const requiresProof = toBoolean(
    serviceContractInput.requiresProof ?? serviceContractInput.proofRequired,
    ackMode === "proof-required"
  );
  const requiresExternalHandoff = toBoolean(
    externalHandoffInput.required ?? serviceContractInput.requiresExternalHandoff,
    false
  );
  const resumeWindowSeconds = boundedNumber(
    externalHandoffInput.resumeWindowSeconds || serviceContractInput.resumeWindowSeconds,
    900,
    0,
    86400
  );
  const issues = [];

  if (!supportedProviderProtocols.has(protocol)) {
    issues.push({
      field: "serviceContract.protocol",
      severity: "error",
      message: `unsupported provider protocol: ${protocol || "unspecified"}`
    });
  }
  if (!supportedConsistencyModels.has(consistency)) {
    issues.push({
      field: "serviceContract.consistency",
      severity: "error",
      message: `unsupported consistency model: ${consistency || "unspecified"}`
    });
  }
  if (!supportedAckModes.has(ackMode)) {
    issues.push({
      field: "serviceContract.ackMode",
      severity: "error",
      message: `unsupported acknowledgement mode: ${ackMode || "unspecified"}`
    });
  }
  if (requiresProof && !capabilities.includes("proof-stream")) {
    issues.push({
      field: "serviceContract.requiresProof",
      severity: "error",
      message: "proof-required service contracts must advertise proof-stream"
    });
  }
  if (requiresExternalHandoff && !capabilities.includes("external-handoff")) {
    issues.push({
      field: "externalHandoff.required",
      severity: "error",
      message: "required external handoff must be advertised by provider capabilities"
    });
  }

  return {
    schemaVersion: "structural-memory-adapter.provider-service-contract.v1",
    contractId: String(serviceContractInput.contractId || serviceContractInput.id || "").trim() || null,
    protocol: supportedProviderProtocols.has(protocol) ? protocol : defaultProviderContract.transport,
    consistency: supportedConsistencyModels.has(consistency) ? consistency : "strong",
    ackMode: supportedAckModes.has(ackMode) ? ackMode : "proof-required",
    limits: {
      maxBatchOperations,
      maxPayloadBytes,
      recordPayloadEnvelope: "metadata-only"
    },
    proof: {
      required: requiresProof,
      streamCapabilityAdvertised: capabilities.includes("proof-stream")
    },
    resume: {
      supported: capabilities.includes("external-handoff") && resumeWindowSeconds > 0,
      resumeWindowSeconds,
      tokenBinding: "tenant-workspace-cursor"
    },
    externalHandoffRequired: requiresExternalHandoff,
    issues,
    ready: !issues.some((issue) => issue.severity === "error")
  };
}

function normalizeProviderContract(contractInput, index) {
  const contract = contractInput && typeof contractInput === "object" ? contractInput : {};
  const providerId = String(
    contract.providerId || contract.id || contract.name || `${defaultProviderContract.providerId}-${index + 1}`
  ).trim();
  const capabilities = uniqueStrings(contract.capabilities || contract.provides || defaultProviderContract.capabilities)
    .map((capability) => capability.toLowerCase());
  const supportedRequired = requiredHostedCapabilities.filter((capability) => capabilities.includes(capability));
  const missingRequired = requiredHostedCapabilities.filter((capability) => !capabilities.includes(capability));
  const acceptedOptional = optionalHostedCapabilities.filter((capability) => capabilities.includes(capability));
  const route = String(contract.route || contract.endpoint || defaultRoute).trim() || defaultRoute;
  const service = String(contract.service || contract.kind || defaultProviderContract.service).trim()
    || defaultProviderContract.service;
  const syncMode = String(contract.syncMode || contract.mode || defaultProviderContract.syncMode).trim().toLowerCase();
  const serviceContract = normalizeProviderServiceContract(contract, capabilities);

  return {
    providerId,
    service,
    route,
    transport: String(contract.transport || defaultProviderContract.transport).trim() || defaultProviderContract.transport,
    syncMode: ["full", "delta", "append-only"].includes(syncMode) ? syncMode : defaultProviderContract.syncMode,
    serviceContract,
    capabilities,
    negotiation: {
      ready: missingRequired.length === 0 && serviceContract.ready,
      required: requiredHostedCapabilities.map((capability) => ({
        capability,
        status: supportedRequired.includes(capability) ? "accepted" : "missing"
      })),
      optional: optionalHostedCapabilities.map((capability) => ({
        capability,
        status: acceptedOptional.includes(capability) ? "accepted" : "not-advertised"
      })),
      missingRequired,
      acceptedOptional,
      serviceContractReady: serviceContract.ready,
      serviceContractIssues: serviceContract.issues
    },
    externalHandoff: {
      allowed: capabilities.includes("external-handoff"),
      required: serviceContract.externalHandoffRequired,
      state: missingRequired.length === 0 && serviceContract.ready ? "ready" : "blocked",
      route,
      providerId,
      resumeSupported: serviceContract.resume.supported,
      resumeWindowSeconds: serviceContract.resume.resumeWindowSeconds
    }
  };
}

function buildProviderRegistry(input) {
  const rawContracts = asArray(input.providerContracts || input.providers || input.services);
  const contracts = rawContracts.length
    ? rawContracts.map((contract, index) => normalizeProviderContract(contract, index))
    : [normalizeProviderContract(defaultProviderContract, 0)];
  const primaryProviderId = String(input.primaryProviderId || input.providerId || contracts[0]?.providerId || "").trim();
  const primaryProvider = contracts.find((contract) => contract.providerId === primaryProviderId) || contracts[0];
  const readyProviders = contracts.filter((contract) => contract.negotiation.ready);

  return {
    schemaVersion: "structural-memory-adapter.providers.v1",
    primaryProviderId: primaryProvider?.providerId || null,
    ready: Boolean(primaryProvider?.negotiation.ready),
    providers: contracts,
    readyProviderIds: readyProviders.map((contract) => contract.providerId),
    rejectedProviderIds: contracts
      .filter((contract) => !contract.negotiation.ready)
      .map((contract) => ({
        providerId: contract.providerId,
        missingRequired: contract.negotiation.missingRequired,
        serviceContractIssues: contract.negotiation.serviceContractIssues
      }))
  };
}

function buildSyncMetadata({
  input,
  generatedAt,
  acceptedRecords,
  analytics,
  providerRegistry,
  scheduler,
  persistedState,
  boundaryContext
}) {
  const syncInput = input.sync && typeof input.sync === "object" ? input.sync : {};
  const cursorSeed = [
    providerRegistry.primaryProviderId,
    generatedAt,
    acceptedRecords.map((record) => `${record.namespace}:${record.id}:${record.version}:${record.updatedAt}`).join(",")
  ];
  const highWatermark = acceptedRecords.reduce((latest, record) => (
    record.updatedAt > latest ? record.updatedAt : latest
  ), toIso(syncInput.highWatermark || syncInput.lastSyncedAt || persistedState.previousHighWatermark, generatedAt));
  const pendingTombstones = acceptedRecords
    .filter((record) => record.status === "tombstoned")
    .map((record) => ({ id: record.id, namespace: record.namespace, updatedAt: record.updatedAt }));
  const restoredHighWatermark = persistedState.previousHighWatermark
    ? toIso(persistedState.previousHighWatermark, generatedAt)
    : null;

  return {
    schemaVersion: "structural-memory-adapter.sync.v1",
    providerId: providerRegistry.primaryProviderId,
    mode: providerRegistry.providers.find((contract) => contract.providerId === providerRegistry.primaryProviderId)?.syncMode
      || defaultProviderContract.syncMode,
    cursor: String(syncInput.cursor || persistedState.previousCursor || stableProofId(cursorSeed)),
    highWatermark,
    restoredHighWatermark,
    pendingRecordCount: analytics.activeRecords,
    pendingTombstoneCount: pendingTombstones.length,
    pendingTombstones,
    lastAttemptAt: syncInput.lastAttemptAt ? toIso(syncInput.lastAttemptAt, generatedAt) : null,
    nextAttemptAt: scheduler.due ? generatedAt : scheduler.nextRunAt,
    blocked: !providerRegistry.ready || !boundaryContext.ready,
    blockedReason: !providerRegistry.ready
      ? "primary provider does not satisfy hosted-kernel provider contract"
      : !boundaryContext.ready
        ? "tenant or workspace boundary is not ready for hosted-kernel sync"
        : null,
    boundary: {
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      principalId: boundaryContext.principalId,
      ready: boundaryContext.ready,
      auditSubject: boundaryContext.auditSubject
    }
  };
}

function normalizeFailureEvent(event, index, generatedAt, providerRegistry) {
  const source = event && typeof event === "object" ? event : { message: event };
  const providerId = String(source.providerId || source.provider || providerRegistry.primaryProviderId || "unknown").trim()
    || "unknown";
  const code = String(source.code || source.errorCode || source.reason || "STRUCTURAL_MEMORY_FAILURE").trim()
    || "STRUCTURAL_MEMORY_FAILURE";
  const message = String(source.message || source.detail || source.error || code).trim() || code;
  const severity = normalizeHealthSeverity(source.severity || source.level);
  const retryable = toBoolean(
    source.retryable,
    !["VALIDATION_FAILED", "BOUNDARY_DENIED", "PERMISSION_DENIED", "CAPABILITY_MISSING"].includes(code)
      && severity !== "fatal"
  );
  const attempt = boundedNumber(source.attempt || source.retryAttempt || source.count, 1, 1, 99);

  return {
    id: String(source.id || stableProofId([surfaceId, "failure", providerId, code, message, index])).trim(),
    providerId,
    code,
    message,
    severity,
    retryable,
    attempt,
    firstSeenAt: toIso(source.firstSeenAt || source.createdAt || source.at, generatedAt),
    lastSeenAt: toIso(source.lastSeenAt || source.updatedAt || source.at, generatedAt),
    route: String(source.route || defaultRoute).trim() || defaultRoute,
    sourceIndex: index
  };
}

function classifyFailureForOperator(failure) {
  const code = String(failure.code || "").toUpperCase();
  if (code === "CAPABILITY_MISSING") {
    return {
      domain: "provider-contract",
      impact: "commit-path-blocked",
      action: "repair-provider-contract",
      owner: "kernel-provider-operator",
      runbook: `${defaultRoute}/health/runbooks/provider-contract`
    };
  }
  if (code === "BOUNDARY_DENIED" || code === "PERMISSION_DENIED") {
    return {
      domain: "tenant-boundary",
      impact: "tenant-workspace-isolation-blocked",
      action: "repair-tenant-boundary",
      owner: "tenant-admin",
      runbook: `${defaultRoute}/health/runbooks/tenant-boundary`
    };
  }
  if (code === "VALIDATION_FAILED") {
    return {
      domain: "input-validation",
      impact: "commit-preview-blocked",
      action: "repair-input-and-resubmit",
      owner: "structural-memory-admin",
      runbook: `${defaultRoute}/health/runbooks/input-validation`
    };
  }
  if (code.includes("TIMEOUT") || code.includes("THROTTLE") || code.includes("RATE_LIMIT")) {
    return {
      domain: "provider-transient",
      impact: "commit-path-delayed",
      action: "wait-for-retry-or-run-manual-validation",
      owner: "kernel-service",
      runbook: `${defaultRoute}/health/runbooks/retry-backoff`
    };
  }
  if (failure.retryable) {
    return {
      domain: "provider-transient",
      impact: "commit-path-delayed",
      action: "wait-for-retry-or-run-manual-validation",
      owner: "kernel-service",
      runbook: `${defaultRoute}/health/runbooks/retry-backoff`
    };
  }
  return {
    domain: "operator-repair",
    impact: failure.severity === "fatal" ? "adapter-failed" : "commit-path-blocked",
    action: "repair-input-and-resubmit",
    owner: "structural-memory-admin",
    runbook: `${defaultRoute}/health/runbooks/operator-repair`
  };
}

function buildHealthIncident({ failure, generatedAt, retryPolicy, retryExhausted, primaryProvider, boundaryContext }) {
  const classification = classifyFailureForOperator(failure);
  const failureAttempt = boundedNumber(failure.attempt, 1, 1, 99);
  const retryDelayMs = failure.retryable
    ? Math.min(retryPolicy.maxDelayMs, retryPolicy.baseDelayMs * (2 ** Math.max(0, failureAttempt - 1)))
    : 0;
  const retryAfter = failure.retryable && !retryExhausted
    ? addMilliseconds(failure.lastSeenAt || generatedAt, retryDelayMs)
    : null;
  const remainingAttempts = failure.retryable ? Math.max(0, retryPolicy.maxAttempts - failureAttempt) : 0;
  const boundaryScoped = {
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    principalId: boundaryContext.principalId,
    boundaryProofId: boundaryContext.boundaryProofId
  };
  const providerScoped = {
    providerId: failure.providerId,
    route: failure.route || primaryProvider?.route || defaultRoute,
    transport: primaryProvider?.transport || defaultProviderContract.transport,
    service: primaryProvider?.service || defaultProviderContract.service
  };
  const state = failure.retryable && !retryExhausted
    ? "retry-scheduled"
    : failure.retryable && retryExhausted
      ? "retry-exhausted"
      : ["fatal", "error"].includes(failure.severity)
        ? "repair-required"
        : "observe";

  return {
    incidentId: stableProofId([
      surfaceId,
      "health-incident",
      failure.id,
      failure.code,
      failureAttempt,
      boundaryContext.auditSubject
    ]),
    state,
    severity: failure.severity,
    code: failure.code,
    message: failure.message,
    domain: classification.domain,
    impact: classification.impact,
    owner: classification.owner,
    action: classification.action,
    runbook: classification.runbook,
    provider: providerScoped,
    boundary: boundaryScoped,
    firstSeenAt: failure.firstSeenAt,
    lastSeenAt: failure.lastSeenAt,
    retryPlan: {
      retryable: failure.retryable,
      attempt: failureAttempt,
      maxAttempts: retryPolicy.maxAttempts,
      remainingAttempts,
      exhausted: failure.retryable ? retryExhausted || remainingAttempts === 0 : false,
      backoffDelayMs: retryDelayMs,
      nextRetryAt: retryAfter
    },
    degradedModeEligible: classification.domain !== "tenant-boundary" && failure.severity !== "fatal",
    proofId: stableProofId([
      failure.id,
      state,
      classification.action,
      retryAfter,
      providerScoped.route,
      boundaryScoped.boundaryProofId
    ])
  };
}

function buildOperationalHealth({
  input,
  generatedAt,
  providerRegistry,
  syncMetadata,
  boundaryContext,
  lifecycle,
  rejectedRecords,
  rejectedCommands
}) {
  const healthInput = input.operationalHealth && typeof input.operationalHealth === "object"
    ? input.operationalHealth
    : input.health && typeof input.health === "object"
      ? input.health
      : {};
  const retryInput = healthInput.retryPolicy || input.retryPolicy || {};
  const retryPolicy = {
    maxAttempts: boundedNumber(retryInput.maxAttempts, defaultRetryPolicy.maxAttempts, 1, 25),
    baseDelayMs: boundedNumber(retryInput.baseDelayMs || retryInput.baseDelay, defaultRetryPolicy.baseDelayMs, 1000, 3600000),
    maxDelayMs: boundedNumber(retryInput.maxDelayMs || retryInput.maxDelay, defaultRetryPolicy.maxDelayMs, 1000, 86400000)
  };
  const rawFailures = [
    ...asArray(healthInput.failures || healthInput.failureEvents || input.failures),
    ...asArray(healthInput.errors || input.errors)
  ];
  const reportedFailures = rawFailures
    .map((event, index) => normalizeFailureEvent(event, index, generatedAt, providerRegistry))
    .slice(-failureEventLimit);
  const primaryProvider = providerRegistry.providers.find(
    (contract) => contract.providerId === providerRegistry.primaryProviderId
  );
  const syntheticFailures = [];
  if (!providerRegistry.ready) {
    syntheticFailures.push({
      id: stableProofId([surfaceId, "failure", providerRegistry.primaryProviderId, "CAPABILITY_MISSING"]),
      providerId: providerRegistry.primaryProviderId,
      code: "CAPABILITY_MISSING",
      message: "primary provider does not satisfy hosted-kernel provider contract",
      severity: "error",
      retryable: false,
      attempt: 1,
      firstSeenAt: generatedAt,
      lastSeenAt: generatedAt,
      route: primaryProvider?.route || defaultRoute,
      sourceIndex: -1
    });
  }
  if (!boundaryContext.ready) {
    syntheticFailures.push({
      id: stableProofId([surfaceId, "failure", boundaryContext.auditSubject, "BOUNDARY_DENIED"]),
      providerId: providerRegistry.primaryProviderId,
      code: "BOUNDARY_DENIED",
      message: "tenant or workspace boundary is not ready for hosted-kernel sync",
      severity: "fatal",
      retryable: false,
      attempt: 1,
      firstSeenAt: generatedAt,
      lastSeenAt: generatedAt,
      route: primaryProvider?.route || defaultRoute,
      sourceIndex: -1
    });
  }
  if (!lifecycle.valid || rejectedRecords.length > 0) {
    syntheticFailures.push({
      id: stableProofId([surfaceId, "failure", "validation", rejectedRecords.length, rejectedCommands.length]),
      providerId: providerRegistry.primaryProviderId,
      code: "VALIDATION_FAILED",
      message: "structural memory input has validation errors that must be repaired before commit",
      severity: "error",
      retryable: false,
      attempt: 1,
      firstSeenAt: generatedAt,
      lastSeenAt: generatedAt,
      route: defaultRoute,
      sourceIndex: -1
    });
  }

  const failures = [...reportedFailures, ...syntheticFailures].slice(-failureEventLimit);
  const retryableFailures = failures.filter((failure) => failure.retryable);
  const terminalFailures = failures.filter((failure) => !failure.retryable && ["fatal", "error"].includes(failure.severity));
  const latestRetryable = retryableFailures[retryableFailures.length - 1];
  const currentAttempt = boundedNumber(
    healthInput.currentAttempt || healthInput.retryAttempt || latestRetryable?.attempt,
    latestRetryable?.attempt || 0,
    0,
    99
  );
  const backoffDelayMs = currentAttempt > 0
    ? Math.min(retryPolicy.maxDelayMs, retryPolicy.baseDelayMs * (2 ** Math.max(0, currentAttempt - 1)))
    : 0;
  const retryBudgetRemaining = Math.max(0, retryPolicy.maxAttempts - currentAttempt);
  const retryExhausted = retryableFailures.length > 0 && retryBudgetRemaining === 0;
  const nextRetryAt = latestRetryable && !retryExhausted
    ? toIso(healthInput.nextRetryAt || latestRetryable.nextRetryAt, addMilliseconds(generatedAt, backoffDelayMs))
    : null;
  const incidents = failures.map((failure) => buildHealthIncident({
    failure,
    generatedAt,
    retryPolicy,
    retryExhausted,
    primaryProvider,
    boundaryContext
  }));
  const incidentDomains = incidents.reduce((domains, incident) => {
    countInto(domains, incident.domain);
    return domains;
  }, {});
  const highestSeverity = failures.some((failure) => failure.severity === "fatal")
    ? "fatal"
    : failures.some((failure) => failure.severity === "error")
      ? "error"
      : failures.some((failure) => failure.severity === "warning")
        ? "warning"
        : "info";
  const degradedInput = healthInput.degradedMode || input.degradedMode || {};
  const canReadOnly = Boolean(primaryProvider?.capabilities.includes("read")) && boundaryContext.ready;
  const degradedAllowed = toBoolean(degradedInput.allowed ?? degradedInput.enabled, true);
  const degradedMode = {
    enabled: degradedAllowed && canReadOnly && (terminalFailures.length > 0 || retryExhausted || syncMetadata.blocked),
    reason: degradedAllowed && canReadOnly
      ? "read-only structural memory inspection remains available while commit path is unhealthy"
      : "degraded mode requires read capability and a ready tenant boundary",
    allowedOperations: degradedAllowed && canReadOnly ? ["read", "validate", "export-preview"] : [],
    blockedOperations: ["write", "delta-sync", "external-handoff"].filter(
      (operation) => !primaryProvider?.capabilities.includes(operation) || terminalFailures.length > 0 || retryExhausted
    )
  };
  const state = terminalFailures.length > 0 || retryExhausted
    ? degradedMode.enabled ? "degraded" : "failed"
    : retryableFailures.length > 0
      ? "retrying"
      : syncMetadata.blocked
        ? "blocked"
        : "healthy";
  const actionableErrors = incidents
    .filter((incident) => ["fatal", "error", "warning"].includes(incident.severity))
    .slice(-actionableErrorLimit)
    .map((incident) => ({
      incidentId: incident.incidentId,
      code: incident.code,
      providerId: incident.provider.providerId,
      severity: incident.severity,
      domain: incident.domain,
      impact: incident.impact,
      owner: incident.owner,
      message: incident.message,
      action: incident.action,
      runbook: incident.runbook,
      retryable: incident.retryPlan.retryable,
      retryAfter: incident.retryPlan.nextRetryAt || (incident.retryPlan.retryable && !retryExhausted ? nextRetryAt : null),
      proofId: incident.proofId
    }));
  const healthValidationGate = {
    schemaVersion: "structural-memory-adapter.health-validation-gate.v1",
    state: state === "healthy" ? "passed" : state === "retrying" ? "waiting" : "blocked",
    highestSeverity,
    retryable: retryableFailures.length > 0,
    retryExhausted,
    readOnlyFallbackAvailable: degradedMode.enabled,
    providerReady: providerRegistry.ready,
    boundaryReady: boundaryContext.ready,
    lifecycleValid: lifecycle.valid,
    acceptedForCommit: state === "healthy",
    blockingIncidentIds: incidents
      .filter((incident) => ["repair-required", "retry-exhausted"].includes(incident.state))
      .map((incident) => incident.incidentId),
    waitingIncidentIds: incidents
      .filter((incident) => incident.state === "retry-scheduled")
      .map((incident) => incident.incidentId),
    proofId: stableProofId([
      surfaceId,
      "health-validation-gate",
      state,
      highestSeverity,
      incidents.map((incident) => `${incident.incidentId}:${incident.state}`).join(",")
    ])
  };

  return {
    schemaVersion: "structural-memory-adapter.operational-health.v1",
    state,
    generatedAt,
    providerId: providerRegistry.primaryProviderId,
    route: primaryProvider?.route || defaultRoute,
    healthy: state === "healthy",
    degraded: state === "degraded",
    retrying: state === "retrying",
    failed: state === "failed",
    retryPolicy,
    retry: {
      currentAttempt,
      retryBudgetRemaining,
      retryExhausted,
      backoffDelayMs,
      nextRetryAt,
      retryableFailureCount: retryableFailures.length
    },
    degradedMode,
    failureState: {
      failureCount: failures.length,
      terminalFailureCount: terminalFailures.length,
      retryableFailureCount: retryableFailures.length,
      highestSeverity,
      byDomain: incidentDomains,
      failures,
      incidents
    },
    validationGate: healthValidationGate,
    actionableErrors,
    proofId: stableProofId([
      surfaceId,
      "operational-health",
      providerRegistry.primaryProviderId,
      state,
      failures.map((failure) => `${failure.code}:${failure.attempt}`).join(","),
      nextRetryAt,
      healthValidationGate.proofId
    ])
  };
}

function addInterval(dateIso, cadence) {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  if (cadence === "hourly") date.setUTCHours(date.getUTCHours() + 1);
  if (cadence === "daily") date.setUTCDate(date.getUTCDate() + 1);
  if (cadence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString();
}

function isFutureIso(value, generatedAt) {
  const valueTime = value ? new Date(value).getTime() : NaN;
  const nowTime = new Date(generatedAt).getTime();
  return Number.isFinite(valueTime) && Number.isFinite(nowTime) && valueTime > nowTime;
}

function normalizeLifecyclePolicy(settings, generatedAt) {
  const controls = settings.controls && typeof settings.controls === "object"
    ? settings.controls
    : settings.controlPlane && typeof settings.controlPlane === "object"
      ? settings.controlPlane
      : {};
  const disableRequiresReason = toBoolean(controls.disableRequiresReason, true);
  const allowDisable = toBoolean(controls.allowDisable, true);
  const allowPause = toBoolean(controls.allowPause, true);
  const allowScheduleMutation = toBoolean(controls.allowScheduleMutation, true);
  const allowImmediateRun = toBoolean(controls.allowImmediateRun, false);
  const maxPauseHours = boundedNumber(controls.maxPauseHours, 168, 1, 720);
  const minScheduleLeadMinutes = boundedNumber(controls.minScheduleLeadMinutes, 5, 0, 1440);
  const protectedUntil = controls.protectedUntil ? toIso(controls.protectedUntil, generatedAt) : null;
  const protectedActive = protectedUntil ? isFutureIso(protectedUntil, generatedAt) : false;

  return {
    schemaVersion: "structural-memory-adapter.lifecycle-policy.v1",
    allowDisable,
    allowPause,
    allowScheduleMutation,
    allowImmediateRun,
    disableRequiresReason,
    maxPauseHours,
    minScheduleLeadMinutes,
    protectedUntil,
    protectedActive,
    enforcement: protectedActive ? "protected-window" : "standard"
  };
}

function validateNextRunAtCandidate(candidate, cadence, generatedAt, policy, validation, field) {
  if (!candidate) return null;
  const nextRunAt = toIso(candidate, generatedAt);
  const nextRunTime = new Date(nextRunAt).getTime();
  const generatedTime = new Date(generatedAt).getTime();
  const minimumLeadMs = Math.max(
    cadenceMinimumLeadMs[cadence] || 0,
    policy.minScheduleLeadMinutes * 60000
  );
  if (!policy.allowImmediateRun && Number.isFinite(nextRunTime) && Number.isFinite(generatedTime)) {
    const leadMs = nextRunTime - generatedTime;
    if (leadMs < minimumLeadMs) {
      validation.push({
        field,
        severity: "error",
        message: `nextRunAt must be at least ${Math.ceil(minimumLeadMs / 60000)} minute(s) in the future`
      });
    }
  }
  return nextRunAt;
}

function buildLifecycleControlState({
  settings,
  disabledReason,
  commandEffects,
  validation,
  generatedAt
}) {
  const schedule = settings.schedule || {};
  const paused = Boolean(schedule.pausedUntil && isFutureIso(schedule.pausedUntil, generatedAt));
  const blockedCommandEffects = commandEffects.filter((effect) => effect.status === "blocked");
  const heldCommandEffects = commandEffects.filter((effect) => effect.status === "held-after-restart");
  const awaitingReplayEffects = commandEffects.filter((effect) => effect.status === "awaiting-replay");
  const appliedCommandEffects = commandEffects.filter((effect) => effect.status === "applied");
  const lifecycleErrors = validation.filter((entry) => entry.severity === "error");
  const policyBlocked = blockedCommandEffects.some((effect) => (
    String(effect.result || "").includes("control policy")
    || String(effect.result || "").includes("protected window")
  ));
  const scheduleBlockedReasons = [
    !settings.enabled && schedule.nextRunAt ? "disabled-adapter-has-scheduled-run" : null,
    paused && schedule.nextRunAt && schedule.nextRunAt <= schedule.pausedUntil ? "next-run-occurs-during-pause" : null,
    schedule.cadence === "manual" && schedule.nextRunAt ? "manual-cadence-cannot-have-next-run" : null,
    ...blockedCommandEffects
      .filter((effect) => effect.type === "schedule")
      .map((effect) => effect.result || "schedule command blocked")
  ].filter(Boolean);
  const commandIntentCounts = commandEffects.reduce((counts, effect) => {
    countInto(counts, effect.type);
    return counts;
  }, {});
  const mutable = {
    enable: true,
    disable: settings.policy.allowDisable && !settings.policy.protectedActive,
    pause: settings.policy.allowPause,
    schedule: settings.policy.allowScheduleMutation && !settings.policy.protectedActive,
    immediateRun: settings.policy.allowImmediateRun
  };
  const state = lifecycleErrors.length > 0
    ? "invalid"
    : !settings.enabled
      ? "disabled"
      : paused
        ? "paused"
        : scheduleBlockedReasons.length > 0
          ? "schedule-attention"
          : awaitingReplayEffects.length > 0
            ? "awaiting-replay"
            : heldCommandEffects.length > 0
              ? "operator-review"
              : "active";
  const nextAction = lifecycleErrors.length > 0
    ? {
        id: "repair-lifecycle-settings",
        priority: "high",
        reason: lifecycleErrors[0]?.message || "lifecycle settings validation failed"
      }
    : blockedCommandEffects.length > 0
      ? {
          id: "repair-lifecycle-command",
          priority: "high",
          reason: blockedCommandEffects[0]?.result || "a lifecycle command was blocked"
        }
      : !settings.enabled
        ? {
            id: "enable-adapter",
            priority: "high",
            reason: disabledReason || "adapter is disabled"
          }
        : paused
          ? {
              id: "wait-for-resume",
              priority: "normal",
              reason: `paused until ${schedule.pausedUntil}`
            }
          : scheduleBlockedReasons.length > 0
            ? {
                id: "repair-schedule-controls",
                priority: "normal",
                reason: scheduleBlockedReasons[0]
              }
            : awaitingReplayEffects.length > 0
              ? {
                  id: "replay-recovered-lifecycle-command",
                  priority: "normal",
                  reason: "one or more recovered lifecycle commands are awaiting replay"
                }
              : heldCommandEffects.length > 0
                ? {
                    id: "review-held-lifecycle-command",
                    priority: "normal",
                    reason: "one or more recovered lifecycle commands require operator review"
                  }
                : {
                    id: schedule.nextRunAt ? "wait-for-next-schedule" : "manual-standby",
                    priority: "low",
                    reason: schedule.nextRunAt ? `next run at ${schedule.nextRunAt}` : "manual scheduling is active"
                  };

  return {
    schemaVersion: "structural-memory-adapter.lifecycle-control-state.v1",
    state,
    enabled: settings.enabled,
    paused,
    pausedUntil: paused ? schedule.pausedUntil : null,
    disabledReason,
    cadence: schedule.cadence,
    nextRunAt: schedule.nextRunAt,
    mutable,
    commandIntentCounts,
    appliedCommandIds: appliedCommandEffects.map((effect) => effect.commandId),
    blockedCommandIds: blockedCommandEffects.map((effect) => effect.commandId),
    heldCommandIds: heldCommandEffects.map((effect) => effect.commandId),
    awaitingReplayCommandIds: awaitingReplayEffects.map((effect) => effect.commandId),
    scheduleBlockedReasons,
    policyBlocked,
    nextAction,
    proofId: stableProofId([
      surfaceId,
      "lifecycle-control-state",
      state,
      settings.enabled,
      schedule.cadence,
      schedule.nextRunAt,
      schedule.pausedUntil,
      commandEffects.map((effect) => `${effect.commandId}:${effect.type}:${effect.status}`).join(","),
      scheduleBlockedReasons.join(",")
    ])
  };
}

function normalizeLifecycleCommand(command, index, generatedAt, boundaryContext) {
  if (!command || typeof command !== "object") {
    return {
      ok: false,
      reason: "lifecycle command must be an object",
      sourceIndex: index
    };
  }

  const type = String(command.type || command.command || command.action || "").trim().toLowerCase();
  const issuedAt = toIso(command.issuedAt || command.at || command.timestamp, generatedAt);
  const commandId = String(command.id || stableProofId([surfaceId, type, issuedAt, index]));
  const route = String(command.route || defaultRoute).trim() || defaultRoute;
  const accepted = supportedLifecycleCommands.has(type);
  const requiredPermission = commandPermissionRequirements[type];
  if (accepted && requiredPermission && !hasPermission(boundaryContext, requiredPermission)) {
    return {
      ok: false,
      reason: `missing ${requiredPermission} permission for lifecycle command ${type}`,
      sourceIndex: index
    };
  }

  return {
    ok: accepted,
    reason: accepted ? undefined : `unsupported lifecycle command: ${type || "unspecified"}`,
    command: accepted
      ? {
          commandId,
          type,
          issuedAt,
          route,
          requestedBy: String(command.requestedBy || command.actor || "kernel"),
          tenantId: boundaryContext.tenantId,
          workspaceId: boundaryContext.workspaceId,
          principalId: boundaryContext.principalId,
          requiredPermission,
          authorization: {
            decision: "allow",
            permission: requiredPermission,
            boundaryProofId: boundaryContext.boundaryProofId,
            matchedWorkspaceGrantIds: boundaryContext.matchedWorkspaceGrantIds
          },
          reason: String(command.reason || ""),
          parameters: command.parameters && typeof command.parameters === "object" ? command.parameters : {}
        }
      : undefined,
    sourceIndex: index
  };
}

function validateLifecycleSettings(settingsInput = {}, commands, generatedAt, persistedState = {}) {
  const settings = settingsInput && typeof settingsInput === "object" ? settingsInput : {};
  const scheduleInput = settings.schedule && typeof settings.schedule === "object" ? settings.schedule : {};
  const policy = normalizeLifecyclePolicy(settings, generatedAt);
  const validation = [];
  const commandEffects = [];
  const replayablePendingCommandIds = new Set(asArray(persistedState.replayablePendingCommands)
    .map((command) => command.commandId));
  const heldPendingCommands = asArray(persistedState.heldPendingCommands);
  const consumedPendingCommandIds = new Set();
  let enabled = toBoolean(settings.enabled, true);
  let cadence = String(scheduleInput.cadence || settings.cadence || "daily").trim().toLowerCase();
  let pausedUntil = scheduleInput.pausedUntil ? toIso(scheduleInput.pausedUntil, generatedAt) : null;
  let explicitNextRunAt = scheduleInput.nextRunAt || settings.nextRunAt || persistedState.previousNextRunAt;
  let disabledReason = enabled ? null : String(settings.disabledReason || settings.reason || "disabled by settings").trim();
  if (!allowedScheduleCadences.has(cadence)) {
    validation.push({
      field: "schedule.cadence",
      severity: "error",
      message: "cadence must be manual, hourly, daily, or weekly"
    });
    cadence = "manual";
  }

  const maxRecordBytes = boundedNumber(settings.maxRecordBytes, 1048576, 1024, 10485760);
  if (settings.maxRecordBytes !== undefined && maxRecordBytes !== Number(settings.maxRecordBytes)) {
    validation.push({
      field: "maxRecordBytes",
      severity: "warning",
      message: "maxRecordBytes was clamped to the supported hosted-kernel range"
    });
  }

  const retentionDays = boundedNumber(settings.retentionDays, 90, 1, 3650);
  if (settings.retentionDays !== undefined && retentionDays !== Number(settings.retentionDays)) {
    validation.push({
      field: "retentionDays",
      severity: "warning",
      message: "retentionDays was clamped to the supported hosted-kernel range"
    });
  }

  for (const command of commands) {
    if (replayablePendingCommandIds.has(command.commandId)) {
      consumedPendingCommandIds.add(command.commandId);
    }
    const previousEnabled = enabled;
    const previousPausedUntil = pausedUntil;
    const previousCadence = cadence;
    const previousExplicitNextRunAt = explicitNextRunAt;
    const effect = {
      commandId: command.commandId,
      type: command.type,
      status: "applied",
      issuedAt: command.issuedAt,
      route: command.route
    };
    if (command.type === "enable") {
      enabled = true;
      disabledReason = null;
      effect.result = "adapter enabled";
    }
    if (command.type === "disable") enabled = false;
    if (command.type === "disable") {
      const reason = String(command.reason || command.parameters.reason || "").trim();
      if (!policy.allowDisable || policy.protectedActive) {
        enabled = previousEnabled;
        effect.status = "blocked";
        effect.result = policy.protectedActive
          ? `disable blocked until protected window ends at ${policy.protectedUntil}`
          : "disable blocked by lifecycle control policy";
        validation.push({
          field: `lifecycleCommands.disable:${command.commandId}`,
          severity: "error",
          message: effect.result
        });
      } else if (policy.disableRequiresReason && !reason) {
        enabled = previousEnabled;
        effect.status = "blocked";
        effect.result = "disable command requires a reason for auditability";
        validation.push({
          field: `lifecycleCommands.disable:${command.commandId}`,
          severity: "error",
          message: effect.result
        });
      } else {
        disabledReason = reason || "disabled by lifecycle command";
        effect.result = disabledReason;
      }
    }
    if (command.type === "pause") {
      if (!policy.allowPause) {
        effect.status = "blocked";
        effect.result = "pause blocked by lifecycle control policy";
        validation.push({
          field: `lifecycleCommands.pause:${command.commandId}`,
          severity: "error",
          message: effect.result
        });
      } else {
        const requestedPauseUntil = command.parameters.until
        ? toIso(command.parameters.until, generatedAt)
        : toIso(command.parameters.pausedUntil, addInterval(generatedAt, "hourly"));
        const maxPauseUntil = addMilliseconds(generatedAt, policy.maxPauseHours * 3600000);
        pausedUntil = requestedPauseUntil > maxPauseUntil ? maxPauseUntil : requestedPauseUntil;
        effect.result = pausedUntil === requestedPauseUntil
          ? `paused until ${pausedUntil}`
          : `pause clamped to ${pausedUntil}`;
        if (!isFutureIso(pausedUntil, generatedAt)) {
          pausedUntil = previousPausedUntil;
          effect.status = "blocked";
          effect.result = "pause command must target a future pausedUntil";
          validation.push({
            field: `lifecycleCommands.pause:${command.commandId}`,
            severity: "error",
            message: effect.result
          });
        }
      }
    }
    if (command.type === "resume") {
      pausedUntil = null;
      effect.result = "pause cleared";
    }
    if (command.type === "schedule") {
      if (!policy.allowScheduleMutation || policy.protectedActive) {
        effect.status = "blocked";
        effect.result = policy.protectedActive
          ? `schedule mutation blocked until protected window ends at ${policy.protectedUntil}`
          : "schedule mutation blocked by lifecycle control policy";
        validation.push({
          field: `lifecycleCommands.schedule:${command.commandId}`,
          severity: "error",
          message: effect.result
        });
      } else {
        if (typeof command.parameters.cadence === "string") {
          const requestedCadence = command.parameters.cadence.trim().toLowerCase();
          if (allowedScheduleCadences.has(requestedCadence)) {
            cadence = requestedCadence;
            effect.result = `cadence set to ${cadence}`;
          } else {
            effect.status = "blocked";
            effect.result = `unsupported requested cadence: ${requestedCadence || "unspecified"}`;
            validation.push({
              field: "lifecycleCommands.schedule.cadence",
              severity: "error",
              message: effect.result
            });
          }
        }
        if (command.parameters.nextRunAt || command.parameters.at) {
          const validationCount = validation.length;
          explicitNextRunAt = validateNextRunAtCandidate(
            command.parameters.nextRunAt || command.parameters.at,
            cadence,
            generatedAt,
            policy,
            validation,
            "lifecycleCommands.schedule.nextRunAt"
          );
          effect.nextRunAt = explicitNextRunAt;
          if (validation.length > validationCount) {
            cadence = previousCadence;
            explicitNextRunAt = previousExplicitNextRunAt;
            effect.status = "blocked";
            effect.result = "schedule nextRunAt violates lifecycle lead-time policy";
            effect.nextRunAt = null;
          }
        }
      }
    }
    commandEffects.push(effect);
  }

  for (const command of heldPendingCommands) {
    validation.push({
      field: `persistedState.pendingCommands:${command.commandId}`,
      severity: "warning",
      message: command.holdReason
        ? `recovered pending ${command.type} command is held: ${command.holdReason}`
        : `recovered pending ${command.type} command is held for operator review`
    });
    commandEffects.push({
      commandId: command.commandId,
      type: command.type,
      status: "held-after-restart",
      issuedAt: command.issuedAt,
      route: defaultRoute,
      result: command.holdReason || "operator-review-required",
      recovered: true
    });
  }

  const unconsumedReplayableCommands = asArray(persistedState.replayablePendingCommands)
    .filter((command) => !consumedPendingCommandIds.has(command.commandId));
  for (const command of unconsumedReplayableCommands) {
    validation.push({
      field: `persistedState.replayQueue:${command.commandId}`,
      severity: "warning",
      message: `recovered replayable ${command.type} command was not resubmitted in the current command batch`
    });
    commandEffects.push({
      commandId: command.commandId,
      type: command.type,
      status: "awaiting-replay",
      issuedAt: command.issuedAt,
      route: defaultRoute,
      result: "safe to replay; command not present in current lifecycleCommands input",
      recovered: true
    });
  }

  const lastRunAt = toIso(scheduleInput.lastRunAt || settings.lastRunAt || persistedState.previousGeneratedAt, generatedAt);
  const nextRunAt = cadence === "manual"
    ? null
    : validateNextRunAtCandidate(
        explicitNextRunAt,
        cadence,
        generatedAt,
        policy,
        validation,
        "schedule.nextRunAt"
      ) || addInterval(lastRunAt, cadence);
  const mode = String(settings.mode || "hosted-kernel").trim() || "hosted-kernel";
  const finalPaused = Boolean(pausedUntil && isFutureIso(pausedUntil, generatedAt));
  if (!enabled && nextRunAt) {
    validation.push({
      field: "schedule.nextRunAt",
      severity: "warning",
      message: "adapter is disabled; scheduled nextRunAt is retained for resume but will not execute"
    });
  }
  if (finalPaused && nextRunAt && nextRunAt <= pausedUntil) {
    validation.push({
      field: "schedule.pausedUntil",
      severity: "warning",
      message: "nextRunAt falls within the active pause window and will wait for resume"
    });
  }
  const settingsState = {
    enabled,
    mode,
    policy,
    maxRecordBytes,
    retentionDays,
    schedule: {
      cadence,
      lastRunAt,
      nextRunAt: cadence === "manual" ? null : nextRunAt,
      pausedUntil,
      timezone: String(scheduleInput.timezone || settings.timezone || "UTC")
    }
  };
  const controlState = buildLifecycleControlState({
    settings: settingsState,
    disabledReason,
    commandEffects,
    validation,
    generatedAt
  });

  return {
    settings: settingsState,
    disabledReason,
    commandEffects,
    controlState,
    recoveryReplay: {
      schemaVersion: "structural-memory-adapter.lifecycle-recovery-replay.v1",
      status: heldPendingCommands.length > 0
        ? "operator-review-required"
        : unconsumedReplayableCommands.length > 0
          ? "awaiting-replay"
          : consumedPendingCommandIds.size > 0
            ? "replayed"
            : "clear",
      consumedPendingCommandIds: [...consumedPendingCommandIds],
      awaitingReplayCommandIds: unconsumedReplayableCommands.map((command) => command.commandId),
      heldCommandIds: heldPendingCommands.map((command) => command.commandId),
      heldCommands: heldPendingCommands,
      replayableCommandCount: asArray(persistedState.replayablePendingCommands).length
    },
    validation,
    valid: !validation.some((entry) => entry.severity === "error")
  };
}

function buildNextAction({ analytics, lifecycle, scheduler, operationalHealth }) {
  const lifecycleAction = lifecycle.controlState?.nextAction;
  if (lifecycleAction && ["high", "normal"].includes(lifecycleAction.priority)) {
    return {
      action: lifecycleAction.id,
      priority: lifecycleAction.priority,
      reason: lifecycleAction.reason,
      domain: "lifecycle-control",
      state: lifecycle.controlState.state,
      proofId: lifecycle.controlState.proofId
    };
  }
  if (operationalHealth.failed) {
    return { action: "repair-operational-failure", priority: "high", reason: "adapter commit path is failed" };
  }
  if (operationalHealth.retrying) {
    return {
      action: "wait-for-retry-backoff",
      priority: "high",
      reason: operationalHealth.retry.nextRetryAt
        ? `retry scheduled for ${operationalHealth.retry.nextRetryAt}`
        : "retryable provider failure is active"
    };
  }
  if (operationalHealth.degraded) {
    return {
      action: "restore-full-sync-health",
      priority: "high",
      reason: "adapter is in degraded read-only mode"
    };
  }
  if (lifecycle.commandEffects.some((effect) => effect.status === "blocked")) {
    return {
      action: "repair-lifecycle-command",
      priority: "high",
      reason: "one or more lifecycle commands were blocked by hosted-kernel control policy"
    };
  }
  if (!lifecycle.settings.enabled) {
    return {
      action: "enable-adapter",
      priority: "high",
      reason: lifecycle.disabledReason || "adapter is disabled"
    };
  }
  if (!lifecycle.valid) {
    return { action: "repair-settings", priority: "high", reason: "settings validation failed" };
  }
  if (scheduler.paused) {
    return { action: "wait-for-resume", priority: "normal", reason: `paused until ${scheduler.pausedUntil}` };
  }
  if (scheduler.due) {
    return { action: "run-structural-memory-scan", priority: "high", reason: "scheduled scan is due" };
  }
  if (analytics.invalidRecords > 0) {
    return { action: "review-rejected-records", priority: "normal", reason: "input contained invalid records" };
  }
  if (analytics.tombstonedRecords > Math.max(2, Math.floor(analytics.totalRecords * 0.2))) {
    return { action: "compact-tombstones", priority: "normal", reason: "tombstoned records exceed compaction threshold" };
  }
  return {
    action: scheduler.nextRunAt ? "wait-for-next-schedule" : "manual-standby",
    priority: "low",
    reason: scheduler.nextRunAt ? `next run at ${scheduler.nextRunAt}` : "manual scheduling is active"
  };
}

function normalizeSourceProvenance(record, index, generatedAt) {
  const source = record.sourceProvenance && typeof record.sourceProvenance === "object"
    ? record.sourceProvenance
    : record.provenance && typeof record.provenance === "object"
      ? record.provenance
      : {};
  const path = String(source.path || source.filePath || source.uri || record.sourcePath || record.filePath || "").trim();
  const repository = String(source.repository || source.repo || record.repository || "").trim();
  const commit = String(source.commit || source.sha || source.revision || record.commit || "").trim();
  const startLine = boundedNumber(source.startLine || source.lineStart || record.startLine, 0, 0, 1000000000);
  const endLine = boundedNumber(source.endLine || source.lineEnd || record.endLine, startLine || 0, 0, 1000000000);
  const startColumn = boundedNumber(source.startColumn || source.columnStart, 0, 0, 1000000);
  const endColumn = boundedNumber(source.endColumn || source.columnEnd, 0, 0, 1000000);
  const capturedAt = toIso(source.capturedAt || source.indexedAt || record.indexedAt, generatedAt);
  const issues = [];

  if (startLine > 0 && endLine > 0 && endLine < startLine) {
    issues.push("source provenance endLine must be greater than or equal to startLine");
  }

  const span = {
    startLine: startLine || null,
    endLine: endLine || null,
    startColumn: startColumn || null,
    endColumn: endColumn || null
  };

  return {
    ok: issues.length === 0,
    issues,
    provenance: {
      schemaVersion: "structural-memory-adapter.source-provenance.v1",
      sourceId: stableProofId([
        surfaceId,
        "source",
        repository,
        path || record.id || record.key,
        commit,
        span.startLine,
        span.endLine,
        index
      ]),
      repository: repository || null,
      path: path || null,
      commit: commit || null,
      language: String(source.language || record.language || "").trim() || null,
      symbol: String(source.symbol || record.symbol || record.name || "").trim() || null,
      span,
      capturedAt,
      locator: path
        ? `${path}${span.startLine ? `:${span.startLine}` : ""}${span.endLine && span.endLine !== span.startLine ? `-${span.endLine}` : ""}`
        : null
    }
  };
}

function normalizeGraphEdge(edge, index, recordId) {
  const source = edge && typeof edge === "object" ? edge : { target: edge };
  const target = String(source.target || source.to || source.id || source.symbol || "").trim();
  const relation = String(source.relation || source.type || source.kind || "references").trim().toLowerCase();
  const allowedRelations = new Set(["defines", "references", "calls", "imports", "extends", "implements", "tests", "documents"]);
  if (!target) {
    return { ok: false, reason: `graph edge ${index + 1} for ${recordId} requires a target` };
  }
  if (!allowedRelations.has(relation)) {
    return { ok: false, reason: `graph edge ${index + 1} for ${recordId} has unsupported relation ${relation}` };
  }
  return {
    ok: true,
    edge: {
      edgeId: stableProofId([surfaceId, "edge", recordId, relation, target, index]),
      relation,
      target,
      targetType: String(source.targetType || source.typeHint || "").trim() || null
    }
  };
}

function normalizeCodeGraphLookup(record, index, provenance) {
  const graphInput = record.codeGraphLookup && typeof record.codeGraphLookup === "object"
    ? record.codeGraphLookup
    : record.codeGraph && typeof record.codeGraph === "object"
      ? record.codeGraph
      : {};
  const symbol = String(graphInput.symbol || graphInput.name || record.symbol || provenance.symbol || record.name || "").trim();
  const qualifiedName = String(graphInput.qualifiedName || graphInput.fqn || record.qualifiedName || symbol || record.id)
    .trim();
  const language = String(graphInput.language || record.language || provenance.language || "").trim().toLowerCase();
  const filePath = String(graphInput.path || graphInput.filePath || provenance.path || "").trim();
  const kind = String(graphInput.kind || graphInput.nodeKind || record.kind || record.type || "memory").trim().toLowerCase();
  const rawEdges = asArray(graphInput.edges || graphInput.relations || record.graphEdges);
  const normalizedEdges = rawEdges.map((edge, edgeIndex) => normalizeGraphEdge(edge, edgeIndex, record.id || record.key || index));
  const rejectedEdges = normalizedEdges.filter((entry) => !entry.ok).map((entry) => entry.reason);
  const edges = normalizedEdges.filter((entry) => entry.ok).map((entry) => entry.edge);
  const lookupKeys = uniqueStrings([
    record.id,
    symbol,
    qualifiedName,
    filePath,
    filePath && symbol ? `${filePath}#${symbol}` : null,
    provenance.locator
  ]);
  const issues = [
    !qualifiedName && !filePath ? "code graph lookup requires at least a record id, qualifiedName, or file path" : null,
    ...rejectedEdges
  ].filter(Boolean);

  return {
    ok: issues.length === 0,
    issues,
    lookup: {
      schemaVersion: "structural-memory-adapter.code-graph-lookup.v1",
      nodeId: stableProofId([surfaceId, "code-node", qualifiedName || symbol, filePath, language, index]),
      kind,
      symbol: symbol || null,
      qualifiedName: qualifiedName || null,
      language: language || null,
      filePath: filePath || null,
      lookupKeys,
      edgeCount: edges.length,
      edges
    }
  };
}

function normalizeObjectiveTruthBinding(record, index, generatedAt, boundaryContext) {
  const hasObjectiveInput = Boolean(
    record.objectiveTruth || record.objective || record.truth || record.objectiveId || record.goalId
      || record.intentId || record.truthClaim || record.truthState || record.evidenceRefs || record.repairHints
  );
  const input = record.objectiveTruth && typeof record.objectiveTruth === "object"
    ? record.objectiveTruth
    : record.objective && typeof record.objective === "object"
      ? record.objective
      : record.truth && typeof record.truth === "object"
        ? record.truth
        : {};
  const objectiveId = String(
    input.objectiveId || input.objective || record.objectiveId || record.goalId || record.intentId || ""
  ).trim();
  const surface = String(input.surface || input.surfaceId || record.objectiveSurface || record.surfaceId || surfaceId).trim()
    || surfaceId;
  const claim = String(input.claim || input.statement || input.assertion || record.truthClaim || "").trim();
  const observedState = String(
    input.state || input.truthState || input.status || record.truthState || ""
  ).trim().toLowerCase();
  const acceptedStates = new Set(["unknown", "supported", "contradicted", "stale", "superseded"]);
  const state = acceptedStates.has(observedState) ? observedState : claim || objectiveId ? "unknown" : "unbound";
  const evidenceRefs = hasObjectiveInput
    ? uniqueStrings([
        ...asArray(input.evidenceRefs || input.evidence || record.evidenceRefs),
        record.sourcePath || record.filePath,
        record.sourceProvenance?.sourceId
      ])
    : [];
  const repairHints = uniqueStrings(input.repairHints || input.nextActions || record.repairHints);
  const requiredBy = uniqueStrings(input.requiredBy || input.routes || record.requiredBy);
  const assertedAt = toIso(input.assertedAt || input.observedAt || input.updatedAt || record.updatedAt, generatedAt);
  const issues = [];

  if (observedState && !acceptedStates.has(observedState)) {
    issues.push(`objective truth state ${observedState} is not supported`);
  }
  if ((claim || evidenceRefs.length > 0 || repairHints.length > 0) && !objectiveId) {
    issues.push("objective truth binding requires objectiveId when claim or evidence is provided");
  }
  if (state === "contradicted" && repairHints.length === 0) {
    issues.push("contradicted objective truth records require at least one repair hint");
  }
  if (state === "supported" && evidenceRefs.length === 0) {
    issues.push("supported objective truth records require evidence refs");
  }

  const bound = Boolean(
    hasObjectiveInput && (objectiveId || claim || evidenceRefs.length > 0 || repairHints.length > 0 || requiredBy.length > 0)
  );
  const contradiction = state === "contradicted";
  return {
    ok: issues.length === 0,
    issues,
    binding: {
      schemaVersion: "structural-memory-adapter.objective-truth-binding.v1",
      bindingId: stableProofId([
        surfaceId,
        "objective-truth",
        boundaryContext.auditSubject,
        objectiveId || record.id || record.key || index,
        surface,
        state,
        claim
      ]),
      objectiveId: objectiveId || null,
      surface,
      claim: claim || null,
      state,
      bound,
      contradicted: contradiction,
      evidenceRefs,
      repairHints,
      requiredBy,
      assertedAt,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      proofId: stableProofId([
        surfaceId,
        "objective-truth-proof",
        objectiveId,
        surface,
        state,
        evidenceRefs.join(","),
        repairHints.join(",")
      ])
    }
  };
}

function normalizeRecord(record, index, generatedAt, boundaryContext) {
  if (!record || typeof record !== "object") {
    return {
      ok: false,
      reason: "record must be an object",
      sourceIndex: index
    };
  }

  const id = String(record.id || record.key || record.memoryId || `memory-${index + 1}`);
  const type = String(record.type || record.kind || "structural").trim() || "structural";
  const namespace = String(record.namespace || record.domain || "kernel").trim() || "kernel";
  const tenantId = String(record.tenantId || record.tenant || boundaryContext.tenantId).trim() || boundaryContext.tenantId;
  const workspaceId = String(record.workspaceId || record.workspace || boundaryContext.workspaceId).trim()
    || boundaryContext.workspaceId;
  const namespaceError = authorizeNamespace(boundaryContext, namespace);
  if (namespaceError) {
    return {
      ok: false,
      reason: namespaceError,
      sourceIndex: index
    };
  }
  if (boundaryContext.strictTenant && tenantId !== boundaryContext.tenantId) {
    return {
      ok: false,
      reason: `record tenant ${tenantId} does not match active tenant ${boundaryContext.tenantId}`,
      sourceIndex: index
    };
  }
  if (boundaryContext.strictWorkspace && workspaceId !== boundaryContext.workspaceId) {
    return {
      ok: false,
      reason: `record workspace ${workspaceId} does not match active workspace ${boundaryContext.workspaceId}`,
      sourceIndex: index
    };
  }
  if (!hasPermission(boundaryContext, "write")) {
    return {
      ok: false,
      reason: "missing write permission to ingest structural memory records",
      sourceIndex: index
    };
  }
  const route = String(record.route || record.path || defaultRoute).trim() || defaultRoute;
  const version = Number.isFinite(Number(record.version)) ? Number(record.version) : 1;
  const refs = asArray(record.refs || record.references).map(String).filter(Boolean);
  const tags = asArray(record.tags).map(String).filter(Boolean);
  const sourceProvenance = normalizeSourceProvenance(record, index, generatedAt);
  if (!sourceProvenance.ok) {
    return {
      ok: false,
      reason: sourceProvenance.issues.join("; "),
      sourceIndex: index
    };
  }
  const codeGraphLookup = normalizeCodeGraphLookup(record, index, sourceProvenance.provenance);
  if (!codeGraphLookup.ok) {
    return {
      ok: false,
      reason: codeGraphLookup.issues.join("; "),
      sourceIndex: index
    };
  }
  const objectiveTruth = normalizeObjectiveTruthBinding(record, index, generatedAt, boundaryContext);
  if (!objectiveTruth.ok) {
    return {
      ok: false,
      reason: objectiveTruth.issues.join("; "),
      sourceIndex: index
    };
  }
  const bytes = Number.isFinite(Number(record.bytes || record.byteSize))
    ? Math.max(0, Number(record.bytes || record.byteSize))
    : JSON.stringify(record.payload || record.value || record).length;
  const createdAt = toIso(record.createdAt || record.firstSeenAt, generatedAt);
  const updatedAt = toIso(record.updatedAt || record.lastSeenAt || createdAt, generatedAt);
  const status = record.deletedAt ? "tombstoned" : String(record.status || "active");
  const normalizedStatus = status.trim().toLowerCase();
  const requiredPermission = namespacePermissionRequirements[normalizedStatus] || "write";
  if (!hasPermission(boundaryContext, requiredPermission)) {
    return {
      ok: false,
      reason: `missing ${requiredPermission} permission to ingest ${normalizedStatus} structural memory records`,
      sourceIndex: index
    };
  }

  return {
    ok: true,
    record: {
      id,
      type,
      namespace,
      tenantId,
      workspaceId,
      route,
      version,
      refs,
      tags,
      sourceProvenance: sourceProvenance.provenance,
      codeGraphLookup: codeGraphLookup.lookup,
      objectiveTruth: objectiveTruth.binding,
      byteSize: bytes,
      createdAt,
      updatedAt,
      status,
      boundaryDecision: {
        decision: "allow",
        requiredPermission,
        boundaryProofId: boundaryContext.boundaryProofId,
        matchedWorkspaceGrantIds: boundaryContext.matchedWorkspaceGrantIds
      }
    }
  };
}

function buildAnalytics(records, rejected) {
  const analytics = {
    totalRecords: records.length,
    activeRecords: 0,
    tombstonedRecords: 0,
    invalidRecords: rejected.length,
    totalByteSize: 0,
    referenceEdges: 0,
    codeGraphNodes: 0,
    codeGraphEdges: 0,
    objectiveTruthBindings: 0,
    objectiveTruthContradictions: 0,
    objectiveTruthEvidenceRefs: 0,
    sourceProvenanceRecords: 0,
    byType: {},
    byNamespace: {},
    byTenant: {},
    byWorkspace: {},
    byStatus: {},
    byRoute: {},
    byLanguage: {},
    byObjectiveId: {},
    byTruthState: {},
    bySourcePath: {}
  };

  for (const record of records) {
    analytics.totalByteSize += record.byteSize;
    analytics.referenceEdges += record.refs.length;
    analytics.codeGraphNodes += record.codeGraphLookup ? 1 : 0;
    analytics.codeGraphEdges += record.codeGraphLookup?.edgeCount || 0;
    analytics.objectiveTruthBindings += record.objectiveTruth?.bound ? 1 : 0;
    analytics.objectiveTruthContradictions += record.objectiveTruth?.contradicted ? 1 : 0;
    analytics.objectiveTruthEvidenceRefs += record.objectiveTruth?.evidenceRefs.length || 0;
    analytics.sourceProvenanceRecords += record.sourceProvenance?.path ? 1 : 0;
    if (record.status === "tombstoned") analytics.tombstonedRecords += 1;
    else analytics.activeRecords += 1;
    countInto(analytics.byType, record.type);
    countInto(analytics.byNamespace, record.namespace);
    countInto(analytics.byTenant, record.tenantId);
    countInto(analytics.byWorkspace, record.workspaceId);
    countInto(analytics.byStatus, record.status);
    countInto(analytics.byRoute, record.route);
    if (record.codeGraphLookup?.language) countInto(analytics.byLanguage, record.codeGraphLookup.language);
    if (record.objectiveTruth?.objectiveId) countInto(analytics.byObjectiveId, record.objectiveTruth.objectiveId);
    if (record.objectiveTruth?.bound) countInto(analytics.byTruthState, record.objectiveTruth.state);
    if (record.sourceProvenance?.path) countInto(analytics.bySourcePath, record.sourceProvenance.path);
  }

  return {
    ...analytics,
    averageByteSize: records.length ? Math.round(analytics.totalByteSize / records.length) : 0,
    uniqueNamespaces: Object.keys(analytics.byNamespace).length,
    uniqueTenants: Object.keys(analytics.byTenant).length,
    uniqueWorkspaces: Object.keys(analytics.byWorkspace).length,
    uniqueRoutes: Object.keys(analytics.byRoute).length,
    uniqueObjectives: Object.keys(analytics.byObjectiveId).length,
    uniqueSourcePaths: Object.keys(analytics.bySourcePath).length,
    uniqueLanguages: Object.keys(analytics.byLanguage).length
  };
}

function appendUnique(target, key, value) {
  if (!key || !value) return;
  if (!target[key]) target[key] = [];
  if (!target[key].includes(value)) target[key].push(value);
}

function asLookupRequestList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeCodeGraphLookupRequest(request, index, generatedAt) {
  const source = request && typeof request === "object" ? request : { lookupKey: request };
  const lookupKey = String(source.lookupKey || source.key || "").trim();
  const symbol = String(source.symbol || source.name || "").trim();
  const qualifiedName = String(source.qualifiedName || source.fqn || "").trim();
  const filePath = String(source.filePath || source.path || "").trim();
  const sourceLocator = String(source.sourceLocator || source.locator || "").trim();
  const sourceId = String(source.sourceId || source.provenanceId || "").trim();
  const language = String(source.language || "").trim().toLowerCase();
  const tenantId = String(source.tenantId || source.tenant || "").trim();
  const workspaceId = String(source.workspaceId || source.workspace || "").trim();
  const namespace = String(source.namespace || source.domain || "").trim();
  const requestedHandoffIntent = String(
    source.handoffIntent || source.intent || source.mode || source.resolutionMode || ""
  ).trim().toLowerCase();
  const handoffIntent = ["read", "preview", "commit", "external-handoff"].includes(requestedHandoffIntent)
    ? requestedHandoffIntent
    : "read";
  const candidates = uniqueStrings([
    lookupKey,
    qualifiedName,
    symbol,
    filePath,
    filePath && symbol ? `${filePath}#${symbol}` : null,
    sourceLocator
  ]);
  const requestId = String(source.requestId || source.id || stableProofId([
    surfaceId,
    "code-graph-lookup-request",
    candidates.join(","),
    sourceId,
    language,
    index
  ])).trim();

  return {
    requestId,
    requestedAt: toIso(source.requestedAt || source.at, generatedAt),
    lookupKey: lookupKey || null,
    symbol: symbol || null,
    qualifiedName: qualifiedName || null,
    filePath: filePath || null,
    sourceLocator: sourceLocator || null,
    sourceId: sourceId || null,
    language: language || null,
    tenantId: tenantId || null,
    workspaceId: workspaceId || null,
    namespace: namespace || null,
    handoffIntent,
    candidates,
    sourceIndex: index
  };
}

function authorizeLookupRequestScope(request, boundaryContext) {
  const issues = [];
  if (boundaryContext.strictTenant && request.tenantId && request.tenantId !== boundaryContext.tenantId) {
    issues.push({
      code: "tenant-scope-mismatch",
      field: "tenantId",
      message: `lookup tenant ${request.tenantId} does not match active tenant ${boundaryContext.tenantId}`
    });
  }
  if (boundaryContext.strictWorkspace && request.workspaceId && request.workspaceId !== boundaryContext.workspaceId) {
    issues.push({
      code: "workspace-scope-mismatch",
      field: "workspaceId",
      message: `lookup workspace ${request.workspaceId} does not match active workspace ${boundaryContext.workspaceId}`
    });
  }
  if (request.namespace) {
    const namespaceError = authorizeNamespace(boundaryContext, request.namespace);
    if (namespaceError) {
      issues.push({
        code: "namespace-scope-denied",
        field: "namespace",
        message: namespaceError
      });
    }
  }

  return {
    decision: issues.length > 0 ? "deny" : "allow",
    issues,
    requestedTenantId: request.tenantId || boundaryContext.tenantId,
    requestedWorkspaceId: request.workspaceId || boundaryContext.workspaceId,
    requestedNamespace: request.namespace || null,
    effectiveTenantId: boundaryContext.tenantId,
    effectiveWorkspaceId: boundaryContext.workspaceId,
    strictTenant: boundaryContext.strictTenant,
    strictWorkspace: boundaryContext.strictWorkspace,
    proofId: stableProofId([
      surfaceId,
      "lookup-scope",
      request.requestId,
      boundaryContext.auditSubject,
      request.tenantId,
      request.workspaceId,
      request.namespace,
      issues.map((issue) => issue.code).join(",")
    ])
  };
}

function nodeWithinLookupBoundary(node, request, boundaryContext) {
  if (!node) return false;
  if (boundaryContext.strictTenant && node.tenantId !== boundaryContext.tenantId) return false;
  if (boundaryContext.strictWorkspace && node.workspaceId !== boundaryContext.workspaceId) return false;
  if (request.tenantId && node.tenantId !== request.tenantId) return false;
  if (request.workspaceId && node.workspaceId !== request.workspaceId) return false;
  if (request.namespace && node.namespace !== request.namespace) return false;
  if (authorizeNamespace(boundaryContext, node.namespace)) return false;
  return true;
}

function buildLookupAuditHandoff({ request, status, nodes, boundaryContext, providerBinding, scopeAuthorization }) {
  const matchedNodeIds = nodes.map((node) => node.nodeId);
  const sourceProvenanceIds = uniqueStrings(nodes.map((node) => node.sourceId));
  const blockedReasons = uniqueStrings([
    ...scopeAuthorization.issues.map((issue) => issue.code),
    ...asArray(providerBinding.externalHandoff?.blockedReasons)
  ]);
  return {
    schemaVersion: "structural-memory-adapter.lookup-audit-handoff.v1",
    handoffId: stableProofId([
      surfaceId,
      "lookup-audit-handoff",
      request.requestId,
      status,
      boundaryContext.auditSubject,
      providerBinding.proofId,
      matchedNodeIds.join(","),
      blockedReasons.join(",")
    ]),
    route: `${defaultRoute}/audit/code-graph-lookup/${request.requestId}`,
    status,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    principalId: boundaryContext.principalId,
    boundaryProofId: boundaryContext.boundaryProofId,
    permissionManifestId: boundaryContext.permissionManifest.manifestId,
    scopeDecision: scopeAuthorization.decision,
    scopeProofId: scopeAuthorization.proofId,
    matchedNodeIds,
    sourceProvenanceIds,
    providerProofId: providerBinding.proofId,
    externalHandoffState: providerBinding.externalHandoff.state,
    blockedReasons,
    payloadPolicy: {
      includesSourceText: false,
      includesRecordPayload: false,
      exposesTenantScopedIdsOnly: true
    }
  };
}

function buildLookupOperationalHealthGate(request, operationalHealth) {
  const health = operationalHealth && typeof operationalHealth === "object" ? operationalHealth : {};
  const validationGate = health.validationGate && typeof health.validationGate === "object" ? health.validationGate : {};
  const degradedMode = health.degradedMode && typeof health.degradedMode === "object" ? health.degradedMode : {};
  const allowedOperations = new Set(asArray(degradedMode.allowedOperations));
  const commitIntent = ["commit", "external-handoff"].includes(request.handoffIntent);
  const readFallback = Boolean(degradedMode.enabled && allowedOperations.has("read"));
  const healthState = String(health.state || "unknown").trim().toLowerCase() || "unknown";
  const commitAccepted = Boolean(validationGate.acceptedForCommit);
  const readAllowed = healthState === "healthy"
    || healthState === "retrying"
    || readFallback
    || (healthState === "unknown" && !health.failed);
  const commitAllowed = !commitIntent
    ? true
    : healthState === "healthy" && commitAccepted && !degradedMode.enabled && !health.retrying && !health.failed;
  const primaryError = asArray(health.actionableErrors)[0] || null;
  const blockedReasons = [
    !readAllowed ? "operational-health-read-blocked" : null,
    commitIntent && healthState === "retrying" ? "operational-health-retrying" : null,
    commitIntent && degradedMode.enabled ? "operational-health-degraded-read-only" : null,
    commitIntent && health.failed ? "operational-health-failed" : null,
    commitIntent && !commitAccepted ? "operational-health-validation-gate-blocked" : null
  ].filter(Boolean);
  const retryAfter = health.retry?.nextRetryAt || primaryError?.retryAfter || null;
  const action = blockedReasons.includes("operational-health-retrying")
    ? "wait-for-retry-backoff"
    : blockedReasons.includes("operational-health-degraded-read-only")
      ? "restore-full-sync-health"
      : blockedReasons.includes("operational-health-validation-gate-blocked")
        ? "repair-operational-health"
        : blockedReasons.length > 0
          ? "repair-operational-failure"
          : "continue";

  return {
    schemaVersion: "structural-memory-adapter.lookup-operational-health-gate.v1",
    state: blockedReasons.length > 0 ? "blocked" : readFallback ? "read-only" : "passed",
    healthState,
    requestedIntent: request.handoffIntent,
    readAllowed,
    commitAllowed,
    readOnlyFallback: readFallback,
    acceptedForCommit: commitAccepted,
    retryAfter,
    blockedReasons,
    actionableError: primaryError
      ? {
          incidentId: primaryError.incidentId,
          code: primaryError.code,
          severity: primaryError.severity,
          domain: primaryError.domain,
          owner: primaryError.owner,
          action: primaryError.action,
          runbook: primaryError.runbook,
          retryAfter: primaryError.retryAfter || retryAfter || null,
          proofId: primaryError.proofId
        }
      : null,
    nextAction: {
      id: action,
      priority: blockedReasons.length > 0 ? "high" : "low",
      retryAfter,
      reason: blockedReasons.length > 0
        ? `lookup ${request.handoffIntent} intent is blocked by ${blockedReasons.join(", ")}`
        : "lookup operation is allowed by current operational health"
    },
    proofId: stableProofId([
      surfaceId,
      "lookup-health-gate",
      request.requestId,
      request.handoffIntent,
      healthState,
      commitAccepted,
      readFallback,
      blockedReasons.join(","),
      retryAfter
    ])
  };
}

function buildLookupProviderBinding({
  request,
  providerRegistry,
  syncMetadata,
  boundaryContext,
  readAuthorized,
  nodes,
  scopeAuthorization,
  healthGate
}) {
  const provider = providerRegistry.providers.find(
    (contract) => contract.providerId === providerRegistry.primaryProviderId
  );
  const providerReady = Boolean(provider?.negotiation.ready && providerRegistry.ready);
  const externalRequested = ["commit", "external-handoff"].includes(request.handoffIntent);
  const externalAllowed = Boolean(provider?.externalHandoff.allowed);
  const externalSupported = Boolean(provider?.externalHandoff.resumeSupported || provider?.serviceContract?.resume?.supported);
  const missingCapabilities = requiredHostedCapabilities.filter(
    (capability) => !asArray(provider?.capabilities).includes(capability)
  );
  const blockedReasons = [
    !readAuthorized ? "missing-read-permission" : null,
    !boundaryContext.ready ? "tenant-boundary-not-ready" : null,
    scopeAuthorization.decision === "deny" ? "lookup-scope-denied" : null,
    !providerReady ? "provider-contract-not-ready" : null,
    syncMetadata.blocked ? "sync-metadata-blocked" : null,
    !healthGate.readAllowed ? "operational-health-read-blocked" : null,
    externalRequested && !healthGate.commitAllowed ? "operational-health-handoff-blocked" : null,
    externalRequested && !externalAllowed ? "provider-external-handoff-not-advertised" : null,
    externalRequested && nodes.length === 0 ? "lookup-not-resolved" : null
  ].filter(Boolean);
  const canExternalize = externalRequested
    && blockedReasons.length === 0
    && nodes.length > 0
    && externalAllowed;
  const handoffState = !externalRequested
    ? "not-requested"
    : canExternalize
      ? "ready"
      : externalAllowed
        ? "blocked"
        : "unavailable";

  return {
    schemaVersion: "structural-memory-adapter.lookup-provider-binding.v1",
    providerId: providerRegistry.primaryProviderId,
    providerRoute: provider?.route || defaultRoute,
    service: provider?.service || defaultProviderContract.service,
    transport: provider?.transport || defaultProviderContract.transport,
    syncCursor: syncMetadata.cursor,
    highWatermark: syncMetadata.highWatermark,
    providerReady,
    syncBlocked: syncMetadata.blocked,
    requestedHandoffIntent: request.handoffIntent,
    operationalHealthGate: healthGate,
    lookupScope: {
      decision: scopeAuthorization.decision,
      proofId: scopeAuthorization.proofId,
      requestedTenantId: scopeAuthorization.requestedTenantId,
      requestedWorkspaceId: scopeAuthorization.requestedWorkspaceId,
      requestedNamespace: scopeAuthorization.requestedNamespace,
      issues: scopeAuthorization.issues
    },
    externalHandoff: {
      requested: externalRequested,
      state: handoffState,
      allowed: externalAllowed,
      resumeSupported: externalSupported,
      canExternalize,
      route: externalAllowed ? provider?.route || defaultRoute : null,
      tokenBinding: provider?.serviceContract?.resume?.tokenBinding || "tenant-workspace-cursor",
      blockedReasons,
      healthGateProofId: healthGate.proofId,
      retryAfter: healthGate.retryAfter,
      nextAction: healthGate.nextAction
    },
    capabilityNegotiation: {
      missingRequired: missingCapabilities,
      acceptedOptional: provider?.negotiation?.acceptedOptional || [],
      ackMode: provider?.serviceContract?.ackMode || "proof-required",
      consistency: provider?.serviceContract?.consistency || "strong"
    },
    proofId: stableProofId([
      surfaceId,
      "lookup-provider-binding",
      request.requestId,
      providerRegistry.primaryProviderId,
      request.handoffIntent,
      healthGate.proofId,
      syncMetadata.cursor,
      nodes.map((node) => node.nodeId).join(","),
      blockedReasons.join(","),
      boundaryContext.boundaryProofId
    ])
  };
}

function resolveCodeGraphLookupRequests(
  rawRequests,
  indexes,
  boundaryContext,
  generatedAt,
  providerRegistry,
  syncMetadata,
  operationalHealth
) {
  const readAuthorized = hasPermission(boundaryContext, "read");
  const requests = asArray(rawRequests)
    .map((request, index) => normalizeCodeGraphLookupRequest(request, index, generatedAt));

  return requests.map((request) => {
    const matchedNodeIds = new Set();
    for (const key of request.candidates) {
      for (const nodeId of indexes.byLookupKey[key] || []) matchedNodeIds.add(nodeId);
    }
    for (const nodeId of indexes.bySourceId[request.sourceId] || []) matchedNodeIds.add(nodeId);
    for (const nodeId of indexes.byQualifiedName[request.qualifiedName] || []) matchedNodeIds.add(nodeId);
    for (const nodeId of indexes.bySymbol[request.symbol] || []) matchedNodeIds.add(nodeId);

    const scopeAuthorization = authorizeLookupRequestScope(request, boundaryContext);
    const nodes = scopeAuthorization.decision === "allow" ? [...matchedNodeIds]
      .map((nodeId) => indexes.nodeById[nodeId])
      .filter(Boolean)
      .filter((node) => !request.language || node.language === request.language)
      .filter((node) => nodeWithinLookupBoundary(node, request, boundaryContext)) : [];
    const healthGate = buildLookupOperationalHealthGate(request, operationalHealth);
    const resultReadAuthorized = readAuthorized && healthGate.readAllowed;
    const status = !resultReadAuthorized
      ? "blocked"
      : scopeAuthorization.decision === "deny"
        ? "blocked"
        : request.candidates.length === 0 && !request.sourceId
          ? "invalid"
          : nodes.length === 0
            ? "not-found"
            : nodes.length === 1
              ? "resolved"
              : "ambiguous";
    const primaryNode = nodes[0] || null;
    const providerBinding = buildLookupProviderBinding({
      request,
      providerRegistry,
      syncMetadata,
      boundaryContext,
      readAuthorized: resultReadAuthorized,
      nodes,
      scopeAuthorization,
      healthGate
    });
    const auditHandoff = buildLookupAuditHandoff({
      request,
      status,
      nodes,
      boundaryContext,
      providerBinding,
      scopeAuthorization
    });

    return {
      schemaVersion: "structural-memory-adapter.code-graph-lookup-result.v1",
      requestId: request.requestId,
      requestedAt: request.requestedAt,
      status,
      matchedNodeCount: resultReadAuthorized ? nodes.length : 0,
      matchedNodeIds: resultReadAuthorized ? nodes.map((node) => node.nodeId) : [],
      primaryNodeId: resultReadAuthorized ? primaryNode?.nodeId || null : null,
      primaryRecordId: resultReadAuthorized ? primaryNode?.recordId || null : null,
      sourceProvenanceId: resultReadAuthorized ? primaryNode?.sourceId || null : null,
      sourceLocator: resultReadAuthorized ? primaryNode?.sourceLocator || null : null,
      scopeAuthorization,
      providerBinding,
      auditHandoff,
      handoffState: providerBinding.externalHandoff.state,
      externalHandoffReady: providerBinding.externalHandoff.canExternalize,
      operationalHealthGate: healthGate,
      ambiguity: resultReadAuthorized && nodes.length > 1
        ? nodes.map((node) => ({
            nodeId: node.nodeId,
            recordId: node.recordId,
            qualifiedName: node.qualifiedName,
            filePath: node.filePath,
            sourceLocator: node.sourceLocator
          }))
        : [],
      blockedReason: !readAuthorized
        ? "missing read permission for code graph lookup"
        : !healthGate.readAllowed
          ? healthGate.nextAction.reason
        : scopeAuthorization.decision === "deny"
          ? scopeAuthorization.issues.map((issue) => issue.message).join("; ")
          : null,
      proofId: stableProofId([
        surfaceId,
        "code-graph-lookup-result",
        request.requestId,
        status,
        nodes.map((node) => node.nodeId).join(","),
        providerBinding.proofId,
        auditHandoff.handoffId,
        boundaryContext.boundaryProofId
      ])
    };
  });
}

function buildCodeGraphLookupPreviewContract({ lookupResults, indexes, boundaryContext, providerRegistry, syncMetadata }) {
  const previewItems = lookupResults.map((result) => {
    const matchedNodes = result.matchedNodeIds
      .map((nodeId) => indexes.nodeById[nodeId])
      .filter(Boolean);
    const primaryNode = result.primaryNodeId ? indexes.nodeById[result.primaryNodeId] || null : null;
    const sourceLabel = primaryNode?.sourceLocator || primaryNode?.filePath || result.sourceLocator || null;
    const blockedReasons = uniqueStrings([
      result.blockedReason,
      result.scopeAuthorization?.decision === "deny" ? "lookup-scope-denied" : null,
      ...asArray(result.operationalHealthGate?.blockedReasons),
      ...asArray(result.providerBinding?.externalHandoff?.blockedReasons)
    ]);
    const readyForPreview = ["resolved", "ambiguous"].includes(result.status)
      && !result.providerBinding.syncBlocked
      && !blockedReasons.includes("missing-read-permission")
      && !blockedReasons.includes("tenant-boundary-not-ready")
      && !blockedReasons.includes("lookup-scope-denied");
    const nextStep = result.status === "blocked"
      ? blockedReasons.some((reason) => String(reason).startsWith("operational-health-"))
        ? result.operationalHealthGate?.nextAction?.id || "repair-operational-health"
        : blockedReasons.includes("lookup-scope-denied")
        ? "repair-lookup-scope"
        : "request-read-access"
      : result.status === "invalid"
        ? "provide-lookup-key-source-id-or-symbol"
        : result.status === "not-found"
          ? "index-source-provenance-or-check-symbol"
          : result.status === "ambiguous"
            ? "select-one-matched-node"
            : result.externalHandoffReady
              ? "continue-external-handoff"
              : "open-source-preview";

    return {
      requestId: result.requestId,
      status: result.status,
      readyForPreview,
      userVisibleState: readyForPreview
        ? result.status === "ambiguous" ? "needs-selection" : "ready"
        : result.status === "not-found" ? "empty" : "blocked",
      title: primaryNode?.qualifiedName || primaryNode?.symbol || result.primaryRecordId || "Unresolved lookup",
      subtitle: sourceLabel,
      primaryNodeId: result.primaryNodeId,
      primaryRecordId: result.primaryRecordId,
      sourceProvenanceId: result.sourceProvenanceId,
      sourceLocator: result.sourceLocator,
      scopeDecision: result.scopeAuthorization?.decision || "allow",
      scopeProofId: result.scopeAuthorization?.proofId || null,
      matchedNodeCount: result.matchedNodeCount,
      matchedSources: uniqueStrings(matchedNodes.map((node) => node.sourceLocator || node.filePath)).slice(0, 6),
      languages: uniqueStrings(matchedNodes.map((node) => node.language).filter(Boolean)),
      edgeCount: matchedNodes.reduce((total, node) => total + Number(node.edgeCount || 0), 0),
      handoffState: result.handoffState,
      externalHandoffReady: result.externalHandoffReady,
      providerReady: result.providerBinding.providerReady,
      syncBlocked: result.providerBinding.syncBlocked,
      operationalHealthState: result.operationalHealthGate?.healthState || "unknown",
      operationalHealthGateState: result.operationalHealthGate?.state || "unknown",
      readOnlyFallback: Boolean(result.operationalHealthGate?.readOnlyFallback),
      commitAllowedByHealth: Boolean(result.operationalHealthGate?.commitAllowed),
      healthRetryAfter: result.operationalHealthGate?.retryAfter || null,
      healthActionableError: result.operationalHealthGate?.actionableError || null,
      blockedReasons,
      auditHandoffId: result.auditHandoff?.handoffId || null,
      auditRoute: result.auditHandoff?.route || null,
      nextStep,
      route: `${defaultRoute}/code-graph/lookup/${result.requestId}`,
      proofId: stableProofId([
        surfaceId,
        "lookup-preview-item",
        result.requestId,
        result.status,
        result.primaryNodeId,
        blockedReasons.join(","),
        nextStep
      ])
    };
  });
  const statusCounts = previewItems.reduce((counts, item) => {
    countInto(counts, item.status);
    return counts;
  }, {});
  const blockedReasons = uniqueStrings(previewItems.flatMap((item) => item.blockedReasons));
  const readyItems = previewItems.filter((item) => item.readyForPreview);
  const selectionRequired = previewItems.filter((item) => item.userVisibleState === "needs-selection");
  const notFoundItems = previewItems.filter((item) => item.status === "not-found");
  const blockedItems = previewItems.filter((item) => item.userVisibleState === "blocked");
  const healthBlockedItems = previewItems.filter((item) => (
    item.blockedReasons.some((reason) => String(reason).startsWith("operational-health-"))
  ));
  const readinessState = blockedItems.length > 0
    ? "blocked"
    : selectionRequired.length > 0
      ? "needs-selection"
      : notFoundItems.length > 0
        ? "partial"
        : readyItems.length > 0
          ? "ready"
          : "empty";
  const nextActions = [
    blockedItems.length > 0 ? {
      id: "repair-lookup-readiness",
      priority: "high",
      label: "Repair lookup readiness",
      reason: "One or more code graph lookup previews are blocked by authorization, boundary, provider, or sync state.",
      requestIds: blockedItems.map((item) => item.requestId)
    } : null,
    selectionRequired.length > 0 ? {
      id: "disambiguate-code-graph-node",
      priority: "normal",
      label: "Choose a matched node",
      reason: "At least one lookup matched multiple structural memory nodes.",
      requestIds: selectionRequired.map((item) => item.requestId)
    } : null,
    notFoundItems.length > 0 ? {
      id: "add-source-provenance",
      priority: readyItems.length > 0 ? "low" : "normal",
      label: "Add source provenance",
      reason: "A lookup could not be resolved from the current source provenance or graph keys.",
      requestIds: notFoundItems.map((item) => item.requestId)
    } : null,
    readyItems.some((item) => item.externalHandoffReady) ? {
      id: "continue-lookup-handoff",
      priority: "normal",
      label: "Continue lookup handoff",
      reason: "Resolved lookup previews have provider handoff data ready for downstream clients.",
      requestIds: readyItems.filter((item) => item.externalHandoffReady).map((item) => item.requestId)
    } : null,
    healthBlockedItems.length > 0 ? {
      id: "repair-operational-health",
      priority: "high",
      label: "Repair operational health",
      reason: "One or more lookup handoff intents are blocked by adapter health or degraded read-only mode.",
      retryAfter: healthBlockedItems.find((item) => item.healthRetryAfter)?.healthRetryAfter || null,
      requestIds: healthBlockedItems.map((item) => item.requestId)
    } : null,
    readyItems.length > 0 ? {
      id: "open-code-preview",
      priority: "low",
      label: "Open code preview",
      reason: "Resolved lookup previews include source locators that clients can open.",
      requestIds: readyItems.map((item) => item.requestId)
    } : null
  ].filter(Boolean);

  return {
    schemaVersion: "structural-memory-adapter.code-graph-lookup-preview.v1",
    route: `${defaultRoute}/code-graph/lookup-preview`,
    method: "GET",
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    providerId: providerRegistry.primaryProviderId,
    syncCursor: syncMetadata.cursor,
    highWatermark: syncMetadata.highWatermark,
    state: readinessState,
    requestedCount: lookupResults.length,
    readyCount: readyItems.length,
    blockedCount: blockedItems.length,
    selectionRequiredCount: selectionRequired.length,
    notFoundCount: notFoundItems.length,
    healthBlockedCount: healthBlockedItems.length,
    statusCounts,
    blockedReasons,
    items: previewItems,
    auditHandoffs: lookupResults.map((result) => result.auditHandoff).filter(Boolean),
    nextActions,
    proofId: stableProofId([
      surfaceId,
      "lookup-preview-contract",
      boundaryContext.auditSubject,
      providerRegistry.primaryProviderId,
      syncMetadata.cursor,
      readinessState,
      previewItems.map((item) => `${item.requestId}:${item.status}:${item.proofId}`).join(",")
    ])
  };
}

function buildCodeGraphIndex(
  records,
  generatedAt,
  boundaryContext,
  input = {},
  providerRegistry,
  syncMetadata,
  operationalHealth
) {
  const nodes = records.map((record) => ({
    nodeId: record.codeGraphLookup.nodeId,
    recordId: record.id,
    namespace: record.namespace,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId,
    kind: record.codeGraphLookup.kind,
    symbol: record.codeGraphLookup.symbol,
    qualifiedName: record.codeGraphLookup.qualifiedName,
    language: record.codeGraphLookup.language,
    filePath: record.codeGraphLookup.filePath,
    lookupKeys: record.codeGraphLookup.lookupKeys,
    sourceId: record.sourceProvenance.sourceId,
    sourceLocator: record.sourceProvenance.locator,
    edgeCount: record.codeGraphLookup.edgeCount
  }));
  const edges = records.flatMap((record) => record.codeGraphLookup.edges.map((edge) => ({
    ...edge,
    fromNodeId: record.codeGraphLookup.nodeId,
    fromRecordId: record.id,
    namespace: record.namespace,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId
  })));
  const byLookupKey = nodes.reduce((index, node) => {
    for (const key of node.lookupKeys) {
      appendUnique(index, key, node.nodeId);
    }
    return index;
  }, {});
  const bySourcePath = nodes.reduce((index, node) => {
    if (!node.filePath) return index;
    appendUnique(index, node.filePath, node.nodeId);
    return index;
  }, {});
  const bySourceId = nodes.reduce((index, node) => {
    appendUnique(index, node.sourceId, node.nodeId);
    return index;
  }, {});
  const byQualifiedName = nodes.reduce((index, node) => {
    appendUnique(index, node.qualifiedName, node.nodeId);
    return index;
  }, {});
  const bySymbol = nodes.reduce((index, node) => {
    appendUnique(index, node.symbol, node.nodeId);
    return index;
  }, {});
  const nodeById = nodes.reduce((index, node) => {
    index[node.nodeId] = node;
    return index;
  }, {});
  const indexes = { byLookupKey, bySourcePath, bySourceId, byQualifiedName, bySymbol, nodeById };
  const requestedLookups = [
    ...asLookupRequestList(input.codeGraphLookup),
    ...asLookupRequestList(input.codeGraphLookupRequests || input.codeGraphQueries),
    ...asLookupRequestList(input.lookupRequests || input.lookups)
  ];
  const lookupResults = resolveCodeGraphLookupRequests(
    requestedLookups,
    indexes,
    boundaryContext,
    generatedAt,
    providerRegistry,
    syncMetadata,
    operationalHealth
  );
  const lookupPreview = buildCodeGraphLookupPreviewContract({
    lookupResults,
    indexes,
    boundaryContext,
    providerRegistry,
    syncMetadata
  });
  const provider = providerRegistry.providers.find(
    (contract) => contract.providerId === providerRegistry.primaryProviderId
  );
  const lookupHandoffSummary = {
    requested: lookupResults.filter((result) => result.providerBinding.externalHandoff.requested).length,
    ready: lookupResults.filter((result) => result.providerBinding.externalHandoff.canExternalize).length,
    blocked: lookupResults.filter((result) => result.providerBinding.externalHandoff.state === "blocked").length,
    unavailable: lookupResults.filter((result) => result.providerBinding.externalHandoff.state === "unavailable").length
  };
  const sourceCoverage = nodes.reduce((coverage, node) => {
    const key = node.sourceId || "unprovenanced";
    if (!coverage[key]) {
      coverage[key] = {
        sourceId: node.sourceId,
        sourceLocator: node.sourceLocator,
        filePath: node.filePath,
        nodeCount: 0,
        recordIds: [],
        languages: []
      };
    }
    coverage[key].nodeCount += 1;
    coverage[key].recordIds = uniqueStrings([...coverage[key].recordIds, node.recordId]);
    coverage[key].languages = uniqueStrings([...coverage[key].languages, node.language].filter(Boolean));
    return coverage;
  }, {});

  return {
    schemaVersion: "structural-memory-adapter.code-graph-index.v1",
    generatedAt,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    sourcePathCount: Object.keys(bySourcePath).length,
    lookupKeyCount: Object.keys(byLookupKey).length,
    sourceIdCount: Object.keys(bySourceId).length,
    nodes,
    edges,
    lookupContract: {
      route: `${defaultRoute}/code-graph/lookup`,
      method: "POST",
      accepts: [
        "lookupKey",
        "symbol",
        "qualifiedName",
        "filePath",
        "sourceLocator",
        "sourceId",
        "language",
        "tenantId",
        "workspaceId",
        "namespace",
        "handoffIntent"
      ],
      returns: [
        "status",
        "nodeId",
        "recordId",
        "sourceProvenance",
        "providerBinding",
        "scopeAuthorization",
        "auditHandoff",
        "handoffState",
        "previewState",
        "nextActions",
        "edges",
        "ambiguity"
      ],
      tenantScoped: true,
      requiresPermission: "read",
      requestScope: {
        strictTenant: boundaryContext.strictTenant,
        strictWorkspace: boundaryContext.strictWorkspace,
        allowedNamespaces: boundaryContext.allowedNamespaces,
        deniedNamespaces: boundaryContext.deniedNamespaces,
        boundaryProofId: boundaryContext.boundaryProofId,
        permissionManifestId: boundaryContext.permissionManifest.manifestId
      },
      resolutionOrder: ["lookupKey", "sourceId", "qualifiedName", "symbol"],
      ambiguousStatus: "ambiguous",
      notFoundStatus: "not-found",
      providerBacked: true,
      providerId: providerRegistry.primaryProviderId,
      providerReady: providerRegistry.ready,
      externalHandoffRoute: provider?.externalHandoff.allowed ? provider.route : null,
      syncCursor: syncMetadata.cursor,
      highWatermark: syncMetadata.highWatermark,
      previewRoute: lookupPreview.route,
      previewState: lookupPreview.state,
      previewProofId: lookupPreview.proofId,
      operationalHealthState: operationalHealth?.state || "unknown",
      degradedReadOnly: Boolean(operationalHealth?.degradedMode?.enabled),
      commitAcceptedByHealth: Boolean(operationalHealth?.validationGate?.acceptedForCommit),
      blockedHandoffHealthReasons: lookupPreview.blockedReasons
        .filter((reason) => String(reason).startsWith("operational-health-"))
    },
    sourceProvenanceContract: {
      route: `${defaultRoute}/code-graph/source-provenance`,
      method: "GET",
      accepts: ["sourceId", "recordId", "filePath", "sourceLocator"],
      returns: ["repository", "commit", "path", "span", "locator", "coveredNodeIds"],
      tenantScoped: true,
      requiresPermission: "read"
    },
    lookupRequests: {
      requested: lookupResults.length,
      resolved: lookupResults.filter((result) => result.status === "resolved").length,
      ambiguous: lookupResults.filter((result) => result.status === "ambiguous").length,
      notFound: lookupResults.filter((result) => result.status === "not-found").length,
      blocked: lookupResults.filter((result) => result.status === "blocked").length,
      handoff: lookupHandoffSummary,
      preview: lookupPreview,
      results: lookupResults
    },
    sourceCoverage: Object.values(sourceCoverage),
    indexes: {
      byLookupKey,
      bySourcePath,
      bySourceId,
      byQualifiedName,
      bySymbol
    },
    proofId: stableProofId([
      surfaceId,
      "code-graph-index",
      boundaryContext.auditSubject,
      nodes.map((node) => `${node.nodeId}:${node.sourceId}`).join(","),
      edges.map((edge) => edge.edgeId).join(","),
      lookupResults.map((result) => (
        `${result.requestId}:${result.status}:${result.primaryNodeId}:${result.providerBinding.proofId}`
      )).join(",")
    ])
  };
}

function normalizeHistorySnapshot(entry, index, generatedAt, boundaryContext) {
  const source = entry && typeof entry === "object" ? entry : {};
  const capturedAt = toIso(source.capturedAt || source.generatedAt || source.at, generatedAt);
  const activeCandidate = boundedNumber(source.activeRecords || source.active || source.activeCount, 0, 0, 1000000000);
  const tombstoneCandidate = boundedNumber(
    source.tombstonedRecords || source.tombstones || source.tombstoneCount,
    0,
    0,
    1000000000
  );
  const recordCount = boundedNumber(
    source.recordCount || source.records || source.totalRecords,
    activeCandidate + tombstoneCandidate,
    0,
    1000000000
  );
  const activeRecords = boundedNumber(activeCandidate, 0, 0, recordCount);
  const tombstonedRecords = boundedNumber(
    tombstoneCandidate,
    Math.max(0, recordCount - activeRecords),
    0,
    recordCount
  );
  const invalidRecords = boundedNumber(source.invalidRecords || source.rejectedRecords || source.invalidCount, 0, 0, 1000000000);
  const totalByteSize = boundedNumber(source.totalByteSize || source.bytes || source.byteSize, 0, 0, Number.MAX_SAFE_INTEGER);
  const tenantId = String(source.tenantId || boundaryContext.tenantId).trim() || boundaryContext.tenantId;
  const workspaceId = String(source.workspaceId || boundaryContext.workspaceId).trim() || boundaryContext.workspaceId;
  const snapshotId = String(source.snapshotId || source.id || stableProofId([
    surfaceId,
    "history-snapshot",
    tenantId,
    workspaceId,
    capturedAt,
    recordCount,
    totalByteSize,
    index
  ])).trim();

  return {
    schemaVersion: "structural-memory-adapter.history-snapshot.v1",
    snapshotId,
    capturedAt,
    tenantId,
    workspaceId,
    recordCount,
    activeRecords,
    tombstonedRecords,
    invalidRecords,
    totalByteSize,
    topNamespaces: asArray(source.topNamespaces).slice(0, 5),
    topTenants: asArray(source.topTenants).slice(0, 5),
    topWorkspaces: asArray(source.topWorkspaces).slice(0, 5),
    topTypes: asArray(source.topTypes).slice(0, 5),
    sourceIndex: index,
    proofId: stableProofId([
      surfaceId,
      "history-snapshot-proof",
      snapshotId,
      capturedAt,
      tenantId,
      workspaceId,
      recordCount,
      totalByteSize
    ])
  };
}

function topEntries(counts, limit = 5) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function countTimelineEvents(timeline) {
  const counters = {
    byKind: {},
    byNamespace: {},
    byRoute: {}
  };
  for (const event of timeline) {
    countInto(counters.byKind, event.kind);
    countInto(counters.byNamespace, event.namespace);
    countInto(counters.byRoute, event.route);
  }
  return counters;
}

function buildProvenanceLookupExportReport({ codeGraphIndex, analytics, boundaryContext, syncMetadata, generatedAt }) {
  const lookupResults = asArray(codeGraphIndex?.lookupRequests?.results);
  const lookupPreview = codeGraphIndex?.lookupRequests?.preview || {};
  const sourceCoverage = asArray(codeGraphIndex?.sourceCoverage);
  const nodes = asArray(codeGraphIndex?.nodes);
  const edges = asArray(codeGraphIndex?.edges);
  const lookupStatusCounts = lookupResults.reduce((counts, result) => {
    countInto(counts, result.status);
    return counts;
  }, {});
  const handoffStateCounts = lookupResults.reduce((counts, result) => {
    countInto(counts, result.handoffState || result.providerBinding?.externalHandoff?.state);
    return counts;
  }, {});
  const healthGateCounts = lookupResults.reduce((counts, result) => {
    countInto(counts, result.operationalHealthGate?.state);
    return counts;
  }, {});
  const languageCounts = nodes.reduce((counts, node) => {
    if (node.language) countInto(counts, node.language);
    return counts;
  }, {});
  const relationCounts = edges.reduce((counts, edge) => {
    countInto(counts, edge.relation);
    return counts;
  }, {});
  const blockedReasonCounts = lookupResults.reduce((counts, result) => {
    for (const reason of asArray(result.providerBinding?.externalHandoff?.blockedReasons)) countInto(counts, reason);
    for (const reason of asArray(result.operationalHealthGate?.blockedReasons)) countInto(counts, reason);
    if (result.blockedReason) countInto(counts, result.blockedReason);
    return counts;
  }, {});
  const openablePreviewItems = asArray(lookupPreview.items).filter((item) => (
    item.readyForPreview && Boolean(item.sourceLocator || item.primaryNodeId)
  ));
  const handoffReadyPreviewItems = asArray(lookupPreview.items).filter((item) => item.externalHandoffReady);
  const sourceCompleteness = sourceCoverage.reduce((summary, source) => {
    if (source.filePath) summary.withFilePath += 1;
    if (source.sourceLocator) summary.withLocator += 1;
    if (asArray(source.languages).length > 0) summary.withLanguage += 1;
    if (Number(source.nodeCount || 0) > 1) summary.multiNodeSources += 1;
    return summary;
  }, {
    withFilePath: 0,
    withLocator: 0,
    withLanguage: 0,
    multiNodeSources: 0
  });
  const provenanceCoverageRatio = analytics.totalRecords
    ? analytics.sourceProvenanceRecords / analytics.totalRecords
    : 0;
  const lookupResolutionRatio = lookupResults.length
    ? ((lookupStatusCounts.resolved || 0) + (lookupStatusCounts.ambiguous || 0)) / lookupResults.length
    : null;
  const sourceExportState = lookupPreview.state === "blocked"
    ? "blocked"
    : openablePreviewItems.length > 0 || sourceCoverage.length > 0
      ? "ready"
      : "empty";

  return {
    schemaVersion: "structural-memory-adapter.provenance-lookup-export.v1",
    generatedAt,
    state: sourceExportState,
    route: `${defaultRoute}/analytics/provenance-lookups`,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    syncCursor: syncMetadata.cursor,
    highWatermark: syncMetadata.highWatermark,
    counters: {
      sourceCoverageCount: sourceCoverage.length,
      codeGraphNodeCount: nodes.length,
      codeGraphEdgeCount: edges.length,
      lookupRequestCount: lookupResults.length,
      lookupResolvedCount: lookupStatusCounts.resolved || 0,
      lookupAmbiguousCount: lookupStatusCounts.ambiguous || 0,
      lookupNotFoundCount: lookupStatusCounts["not-found"] || 0,
      lookupBlockedCount: lookupStatusCounts.blocked || 0,
      openableSourceCount: openablePreviewItems.length,
      handoffReadySourceCount: handoffReadyPreviewItems.length,
      provenanceRecordCount: analytics.sourceProvenanceRecords,
      uniqueSourcePathCount: analytics.uniqueSourcePaths
    },
    ratios: {
      provenanceCoverage: Math.round(provenanceCoverageRatio * 10000) / 10000,
      lookupResolution: lookupResolutionRatio === null ? null : Math.round(lookupResolutionRatio * 10000) / 10000
    },
    dimensions: {
      lookupStatuses: topEntries(lookupStatusCounts, 8),
      handoffStates: topEntries(handoffStateCounts, 8),
      healthGateStates: topEntries(healthGateCounts, 8),
      languages: topEntries(languageCounts, 8),
      relations: topEntries(relationCounts, 8),
      blockedReasons: topEntries(blockedReasonCounts, 8),
      sourcePaths: topEntries(analytics.bySourcePath, 8)
    },
    completeness: sourceCompleteness,
    readySourcePreviews: openablePreviewItems.slice(0, 8).map((item) => ({
      requestId: item.requestId,
      nodeId: item.primaryNodeId,
      recordId: item.primaryRecordId,
      sourceProvenanceId: item.sourceProvenanceId,
      sourceLocator: item.sourceLocator,
      handoffState: item.handoffState,
      auditHandoffId: item.auditHandoffId
    })),
    blockedLookupRequestIds: lookupResults
      .filter((result) => result.status === "blocked")
      .map((result) => result.requestId),
    proofId: stableProofId([
      surfaceId,
      "provenance-lookup-export",
      boundaryContext.auditSubject,
      syncMetadata.cursor,
      sourceExportState,
      sourceCoverage.map((source) => `${source.sourceId}:${source.nodeCount}`).join(","),
      lookupResults.map((result) => `${result.requestId}:${result.status}:${result.handoffState}`).join(",")
    ])
  };
}

function buildAnalyticsExportSummary({
  generatedAt,
  analytics,
  snapshot,
  history,
  timeline,
  providerRegistry,
  syncMetadata,
  boundaryContext,
  operationalHealth,
  validationSummary,
  hostedKernelCommit,
  externalHandoffGate
}) {
  const orderedHistory = history
    .slice()
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.snapshotId.localeCompare(right.snapshotId));
  const firstSnapshot = orderedHistory[0] || snapshot;
  const previousSnapshot = orderedHistory.length > 1 ? orderedHistory[orderedHistory.length - 2] : null;
  const lastSnapshot = orderedHistory[orderedHistory.length - 1] || snapshot;
  const windowStartedAt = firstSnapshot?.capturedAt || snapshot.capturedAt;
  const windowEndedAt = lastSnapshot?.capturedAt || generatedAt;
  const elapsedMs = Math.max(0, new Date(windowEndedAt).getTime() - new Date(windowStartedAt).getTime());
  const elapsedHours = elapsedMs > 0 ? elapsedMs / 3600000 : 0;
  const recordDelta = previousSnapshot ? analytics.totalRecords - Number(previousSnapshot.recordCount || 0) : analytics.totalRecords;
  const byteDelta = previousSnapshot ? analytics.totalByteSize - Number(previousSnapshot.totalByteSize || 0) : analytics.totalByteSize;
  const fullWindowRecordDelta = analytics.totalRecords - Number(firstSnapshot?.recordCount || 0);
  const fullWindowByteDelta = analytics.totalByteSize - Number(firstSnapshot?.totalByteSize || 0);
  const timelineCounters = countTimelineEvents(timeline);
  const statusCounters = {
    exportReady: validationSummary.valid && hostedKernelCommit.commitReady && operationalHealth.healthy ? 1 : 0,
    degradedPreview: operationalHealth.degraded ? 1 : 0,
    blocked: validationSummary.valid && hostedKernelCommit.commitReady ? 0 : 1,
    providerReady: providerRegistry.ready ? 1 : 0,
    boundaryReady: boundaryContext.ready ? 1 : 0,
    externalHandoffReady: externalHandoffGate.ready ? 1 : 0
  };

  return {
    schemaVersion: "structural-memory-adapter.analytics-export-summary.v1",
    generatedAt,
    summaryId: stableProofId([
      surfaceId,
      "analytics-export-summary",
      snapshot.snapshotId,
      syncMetadata.cursor,
      validationSummary.status,
      hostedKernelCommit.state,
      externalHandoffGate.state
    ]),
    window: {
      startedAt: windowStartedAt,
      endedAt: windowEndedAt,
      elapsedHours: Math.round(elapsedHours * 100) / 100,
      snapshotCount: orderedHistory.length,
      firstSnapshotId: firstSnapshot?.snapshotId || null,
      previousSnapshotId: previousSnapshot?.snapshotId || null,
      latestSnapshotId: snapshot.snapshotId
    },
    counters: {
      records: analytics.totalRecords,
      activeRecords: analytics.activeRecords,
      tombstonedRecords: analytics.tombstonedRecords,
      invalidRecords: analytics.invalidRecords,
      totalByteSize: analytics.totalByteSize,
      referenceEdges: analytics.referenceEdges,
      timelineEvents: timeline.length,
      commitOperations: hostedKernelCommit.operationCount,
      rejectedCommitOperations: hostedKernelCommit.rejectedOperationCount,
      validationErrors: validationSummary.errorCount,
      validationWarnings: validationSummary.warningCount,
      healthIncidents: operationalHealth.failureState.failureCount,
      ...statusCounters
    },
    rates: {
      recordsPerHour: elapsedHours > 0 ? Math.round((fullWindowRecordDelta / elapsedHours) * 100) / 100 : null,
      bytesPerHour: elapsedHours > 0 ? Math.round((fullWindowByteDelta / elapsedHours) * 100) / 100 : null,
      tombstoneRatio: analytics.totalRecords ? analytics.tombstonedRecords / analytics.totalRecords : 0,
      rejectionRatio: analytics.totalRecords + analytics.invalidRecords
        ? analytics.invalidRecords / (analytics.totalRecords + analytics.invalidRecords)
        : 0
    },
    deltas: {
      sincePreviousSnapshot: {
        recordDelta,
        byteDelta,
        tombstoneDelta: previousSnapshot
          ? analytics.tombstonedRecords - Number(previousSnapshot.tombstonedRecords || 0)
          : analytics.tombstonedRecords,
        invalidDelta: previousSnapshot
          ? analytics.invalidRecords - Number(previousSnapshot.invalidRecords || 0)
          : analytics.invalidRecords
      },
      sinceWindowStart: {
        recordDelta: fullWindowRecordDelta,
        byteDelta: fullWindowByteDelta
      }
    },
    dimensions: {
      namespaces: topEntries(analytics.byNamespace, 8),
      routes: topEntries(analytics.byRoute, 8),
      types: topEntries(analytics.byType, 8),
      statuses: topEntries(analytics.byStatus, 8),
      timelineKinds: topEntries(timelineCounters.byKind, 8)
    },
    exportRoutes: {
      summary: `${defaultRoute}/analytics/export-summary`,
      history: `${defaultRoute}/analytics/history`,
      timeline: `${defaultRoute}/analytics/timeline`
    },
    proofId: stableProofId([
      surfaceId,
      "analytics-export-proof",
      snapshot.snapshotId,
      recordDelta,
      byteDelta,
      timeline.length,
      hostedKernelCommit.audit.batchProofId,
      externalHandoffGate.auditEnvelope.proofId
    ])
  };
}

function buildReportingState({
  generatedAt,
  analytics,
  codeGraphIndex,
  snapshot,
  history,
  timeline,
  lifecycle,
  scheduler,
  providerRegistry,
  syncMetadata,
  operationalHealth,
  hostedKernelCommit,
  validationSummary,
  previewAcceptance,
  commandApplication,
  boundaryContext,
  clientRuntimeHandoff,
  externalHandoffGate
}) {
  const previousSnapshot = history.length > 1 ? history[history.length - 2] : null;
  const timelineCounters = countTimelineEvents(timeline);
  const historyDeltas = previousSnapshot
    ? {
        fromSnapshotId: previousSnapshot.snapshotId || null,
        toSnapshotId: snapshot.snapshotId,
        recordDelta: analytics.totalRecords - Number(previousSnapshot.recordCount || 0),
        activeDelta: analytics.activeRecords - Number(previousSnapshot.activeRecords || 0),
        tombstoneDelta: analytics.tombstonedRecords - Number(previousSnapshot.tombstonedRecords || 0),
        invalidDelta: analytics.invalidRecords - Number(previousSnapshot.invalidRecords || 0),
        byteDelta: analytics.totalByteSize - Number(previousSnapshot.totalByteSize || 0)
      }
    : {
        fromSnapshotId: null,
        toSnapshotId: snapshot.snapshotId,
        recordDelta: analytics.totalRecords,
        activeDelta: analytics.activeRecords,
        tombstoneDelta: analytics.tombstonedRecords,
        invalidDelta: analytics.invalidRecords,
        byteDelta: analytics.totalByteSize
      };
  const counters = {
    recordsAccepted: analytics.totalRecords,
    recordsRejected: analytics.invalidRecords,
    activeRecords: analytics.activeRecords,
    tombstonedRecords: analytics.tombstonedRecords,
    referenceEdges: analytics.referenceEdges,
    codeGraphNodes: analytics.codeGraphNodes,
    codeGraphEdges: analytics.codeGraphEdges,
    sourceProvenanceRecords: analytics.sourceProvenanceRecords,
    lookupRequests: codeGraphIndex.lookupRequests.requested,
    lookupResolved: codeGraphIndex.lookupRequests.resolved,
    lookupAmbiguous: codeGraphIndex.lookupRequests.ambiguous,
    lookupNotFound: codeGraphIndex.lookupRequests.notFound,
    lookupBlocked: codeGraphIndex.lookupRequests.blocked,
    lookupHandoffReady: codeGraphIndex.lookupRequests.handoff.ready,
    sourceCoverageEntries: codeGraphIndex.sourceCoverage.length,
    namespacesSeen: analytics.uniqueNamespaces,
    routesSeen: analytics.uniqueRoutes,
    commandsApplied: commandApplication.appliedCommandCount,
    commandsIdempotent: commandApplication.idempotentCommandCount,
    commandsBlocked: lifecycle.commandEffects.filter((effect) => effect.status === "blocked").length,
    validationErrors: validationSummary.errorCount,
    validationWarnings: validationSummary.warningCount,
    commitOperationsReady: hostedKernelCommit.operationCount,
    commitOperationsRejected: hostedKernelCommit.rejectedOperationCount,
    proofEvents: hostedKernelCommit.proofStream.eventCount,
    externalHandoffReady: externalHandoffGate.ready ? 1 : 0,
    externalHandoffBlocks: externalHandoffGate.blockedReasons.length,
    clientVisibleActions: clientRuntimeHandoff.workflow.availableActions.length,
    clientBlockedActions: clientRuntimeHandoff.workflow.blockedActions.length,
    clientRequestRuntimeReady: clientRuntimeHandoff.requestRuntimeContract.state.readyForSubmit ? 1 : 0,
    clientRequestMissingProofs: clientRuntimeHandoff.requestRuntimeContract.acknowledgementContract.missingProofIds.length,
    timelineEvents: timeline.length,
    historySnapshots: history.length,
    actionableErrors: operationalHealth.actionableErrors.length
  };
  const reportState = validationSummary.valid && hostedKernelCommit.commitReady && operationalHealth.healthy
    ? "export-ready"
    : operationalHealth.degraded
      ? "degraded-export-preview"
      : "blocked";
  const exportSections = [
    { name: "analytics", recordCount: analytics.totalRecords, required: true },
    { name: "codeGraph", recordCount: analytics.codeGraphNodes, required: true },
    { name: "provenanceLookups", recordCount: codeGraphIndex.lookupRequests.requested, required: false },
    { name: "history", recordCount: history.length, required: true },
    { name: "timeline", recordCount: timeline.length, required: false },
    { name: "hostedKernelCommit", recordCount: hostedKernelCommit.operationCount, required: true },
    { name: "externalHandoffGate", recordCount: externalHandoffGate.scope.operationCount, required: false },
    { name: "clientRuntimeHandoff", recordCount: clientRuntimeHandoff.workflow.availableActions.length, required: true },
    { name: "requestRuntimeContract", recordCount: 1, required: true },
    { name: "validationSummary", recordCount: validationSummary.issueCount, required: true },
    { name: "operationalHealth", recordCount: operationalHealth.failureState.failureCount, required: true }
  ];
  const exportManifestId = stableProofId([
    surfaceId,
    "reporting-manifest",
    snapshot.snapshotId,
    hostedKernelCommit.batchId,
    validationSummary.status,
    reportState,
    counters.timelineEvents
  ]);
  const analyticsExport = buildAnalyticsExportSummary({
    generatedAt,
    analytics,
    snapshot,
    history,
    timeline,
    providerRegistry,
    syncMetadata,
    boundaryContext,
    operationalHealth,
    validationSummary,
    hostedKernelCommit,
    externalHandoffGate
  });
  const provenanceLookupExport = buildProvenanceLookupExportReport({
    codeGraphIndex,
    analytics,
    boundaryContext,
    syncMetadata,
    generatedAt
  });

  return {
    schemaVersion: "structural-memory-adapter.reporting-state.v1",
    generatedAt,
    state: reportState,
    reportId: stableProofId([
      surfaceId,
      "report",
      generatedAt,
      boundaryContext.auditSubject,
      snapshot.snapshotId,
      syncMetadata.cursor
    ]),
    counters,
    analyticsExport,
    provenanceLookupExport,
    history: {
      latestSnapshotId: snapshot.snapshotId,
      previousSnapshotId: previousSnapshot?.snapshotId || null,
      retainedSnapshots: history.length,
      limit: historyLimit,
      deltas: historyDeltas,
      window: analyticsExport.window,
      rates: analyticsExport.rates
    },
    timeline: {
      retainedEvents: timeline.length,
      limit: timelineLimit,
      firstEventAt: timeline[0]?.at || null,
      lastEventAt: timeline[timeline.length - 1]?.at || null,
      topKinds: topEntries(timelineCounters.byKind, 6),
      topNamespaces: topEntries(timelineCounters.byNamespace, 6),
      topRoutes: topEntries(timelineCounters.byRoute, 6)
    },
    provenanceLookups: {
      state: provenanceLookupExport.state,
      route: provenanceLookupExport.route,
      proofId: provenanceLookupExport.proofId,
      lookupRequestCount: provenanceLookupExport.counters.lookupRequestCount,
      lookupResolvedCount: provenanceLookupExport.counters.lookupResolvedCount,
      lookupBlockedCount: provenanceLookupExport.counters.lookupBlockedCount,
      openableSourceCount: provenanceLookupExport.counters.openableSourceCount,
      handoffReadySourceCount: provenanceLookupExport.counters.handoffReadySourceCount,
      provenanceCoverage: provenanceLookupExport.ratios.provenanceCoverage,
      lookupResolution: provenanceLookupExport.ratios.lookupResolution,
      topLookupStatuses: provenanceLookupExport.dimensions.lookupStatuses,
      topBlockedReasons: provenanceLookupExport.dimensions.blockedReasons
    },
    exportManifest: {
      manifestId: exportManifestId,
      fileName: `${surfaceName}-${snapshot.snapshotId}-report.json`,
      contentType: "application/json",
      state: reportState,
      ready: reportState === "export-ready",
      sections: exportSections,
      analyticsSummaryId: analyticsExport.summaryId,
      analyticsProofId: analyticsExport.proofId,
      provenanceLookupProofId: provenanceLookupExport.proofId,
      omittedSections: exportSections.filter((section) => section.recordCount === 0).map((section) => section.name),
      redaction: {
        tenantScoped: true,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        principalIdIncluded: true,
        payloadIncluded: false
      },
      blockingReasons: reportState === "export-ready"
        ? []
        : [
            ...hostedKernelCommit.blockedReasons,
            ...externalHandoffGate.blockedReasons,
            ...validationSummary.issues
              .filter((issue) => issue.severity === "error")
              .map((issue) => `${issue.source}:${issue.field}`)
          ].filter((reason, index, all) => all.indexOf(reason) === index)
    },
    scheduler: {
      cadence: scheduler.cadence,
      due: scheduler.due,
      nextRunAt: scheduler.nextRunAt,
      paused: scheduler.paused,
      blockedCommandCount: scheduler.blockedCommandCount
    },
    provider: {
      primaryProviderId: providerRegistry.primaryProviderId,
      ready: providerRegistry.ready,
      syncCursor: syncMetadata.cursor,
      highWatermark: syncMetadata.highWatermark
    },
    readiness: {
      previewState: previewAcceptance.readiness.state,
      healthState: operationalHealth.state,
      validationStatus: validationSummary.status,
      commitState: hostedKernelCommit.state,
      externalHandoffState: externalHandoffGate.state,
      clientState: clientRuntimeHandoff.client.state,
      clientPrimaryAction: clientRuntimeHandoff.workflow.primaryAction?.id || null,
      requestRuntimeState: clientRuntimeHandoff.requestRuntimeContract.state.workflow,
      requestRuntimeReadyForSubmit: clientRuntimeHandoff.requestRuntimeContract.state.readyForSubmit
    },
    proofId: stableProofId([
      surfaceId,
      "reporting-proof",
      exportManifestId,
      JSON.stringify(counters),
      historyDeltas.byteDelta,
      timeline.length,
      clientRuntimeHandoff.proofId,
      clientRuntimeHandoff.requestRuntimeContract.proofId,
      provenanceLookupExport.proofId,
      externalHandoffGate.auditEnvelope.proofId
    ])
  };
}

function buildHostedKernelCommitContract({
  generatedAt,
  acceptedRecords,
  analytics,
  lifecycle,
  providerRegistry,
  syncMetadata,
  boundaryContext,
  operationalHealth,
  commandApplication
}) {
  const primaryProvider = providerRegistry.providers.find(
    (contract) => contract.providerId === providerRegistry.primaryProviderId
  );
  const providerCapabilities = new Set(primaryProvider?.capabilities || []);
  const batchId = stableProofId([
    surfaceId,
    "commit-batch",
    providerRegistry.primaryProviderId,
    syncMetadata.cursor,
    boundaryContext.auditSubject,
    acceptedRecords.map((record) => `${record.namespace}:${record.id}:${record.version}:${record.status}`).join(",")
  ]);
  const rejectedOperations = acceptedRecords
    .filter((record) => record.byteSize > lifecycle.settings.maxRecordBytes)
    .map((record) => ({
      id: record.id,
      namespace: record.namespace,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      byteSize: record.byteSize,
      maxRecordBytes: lifecycle.settings.maxRecordBytes,
      reason: "record exceeds hosted-kernel maxRecordBytes"
    }));
  const rejectedKeys = new Set(rejectedOperations.map((record) => `${record.namespace}:${record.id}`));
  const operations = acceptedRecords
    .filter((record) => !rejectedKeys.has(`${record.namespace}:${record.id}`))
    .map((record, index) => {
      const operation = record.status === "tombstoned" ? "tombstone" : "upsert";
      const operationId = stableProofId([
        surfaceId,
        "operation",
        providerRegistry.primaryProviderId,
        boundaryContext.auditSubject,
        record.namespace,
        record.id,
        record.version,
        operation,
        record.updatedAt
      ]);
      return {
        operationId,
        sequence: index + 1,
        operation,
        idempotencyKey: stableProofId([batchId, operationId, syncMetadata.cursor]),
        recordId: record.id,
        namespace: record.namespace,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        route: record.route,
        type: record.type,
        version: record.version,
        byteSize: record.byteSize,
        updatedAt: record.updatedAt,
        referenceCount: record.refs.length,
        codeGraphNodeId: record.codeGraphLookup.nodeId,
        codeGraphEdgeCount: record.codeGraphLookup.edgeCount,
        sourceProvenanceId: record.sourceProvenance.sourceId,
        sourceLocator: record.sourceProvenance.locator,
        objectiveTruthBindingId: record.objectiveTruth.bindingId,
        objectiveId: record.objectiveTruth.objectiveId,
        objectiveTruthState: record.objectiveTruth.state,
        objectiveTruthProofId: record.objectiveTruth.proofId,
        objectiveTruthEvidenceRefCount: record.objectiveTruth.evidenceRefs.length,
        tagCount: record.tags.length,
        boundaryProofId: record.boundaryDecision.boundaryProofId,
        requiredPermission: record.boundaryDecision.requiredPermission,
        matchedWorkspaceGrantIds: record.boundaryDecision.matchedWorkspaceGrantIds,
        syncCursor: syncMetadata.cursor,
        highWatermark: syncMetadata.highWatermark
      };
    });
  const blockedReasons = [
    !lifecycle.settings.enabled ? "lifecycle-disabled" : null,
    !lifecycle.valid ? "lifecycle-invalid" : null,
    !providerRegistry.ready ? "provider-capability-missing" : null,
    !boundaryContext.ready ? "tenant-boundary-not-ready" : null,
    syncMetadata.blocked ? "sync-blocked" : null,
    operationalHealth.healthy ? null : `operational-health-${operationalHealth.state}`,
    rejectedOperations.length > 0 ? "record-byte-limit-exceeded" : null
  ].filter(Boolean);
  const commitReady = blockedReasons.length === 0;
  const proofStreamEnabled = providerCapabilities.has("proof-stream");
  const tombstoneCompactionEnabled = providerCapabilities.has("tombstone-compaction");
  const externalHandoffEnabled = providerCapabilities.has("external-handoff");
  const proofStream = operations.map((operation) => ({
    proofId: stableProofId([batchId, operation.operationId, operation.idempotencyKey]),
    emittedAt: generatedAt,
    event: `structural-memory.${operation.operation}`,
    providerId: providerRegistry.primaryProviderId,
    operationId: operation.operationId,
    recordId: operation.recordId,
    namespace: operation.namespace,
    tenantId: operation.tenantId,
    workspaceId: operation.workspaceId,
      cursor: syncMetadata.cursor
  }));
  const objectiveTruthManifest = {
    schemaVersion: "structural-memory-adapter.objective-truth-manifest.v1",
    bindingCount: operations.filter((operation) => operation.objectiveId).length,
    contradictedCount: operations.filter((operation) => operation.objectiveTruthState === "contradicted").length,
    objectiveIds: uniqueStrings(operations.map((operation) => operation.objectiveId)),
    proofIds: uniqueStrings(operations.map((operation) => operation.objectiveTruthProofId)),
    stateCounts: operations.reduce((counts, operation) => {
      if (operation.objectiveTruthState && operation.objectiveTruthState !== "unbound") {
        countInto(counts, operation.objectiveTruthState);
      }
      return counts;
    }, {}),
    proofId: stableProofId([
      batchId,
      "objective-truth-manifest",
      operations.map((operation) => `${operation.recordId}:${operation.objectiveId}:${operation.objectiveTruthState}`).join(",")
    ])
  };
  const boundaryManifest = {
    schemaVersion: "structural-memory-adapter.commit-boundary-manifest.v1",
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    principalId: boundaryContext.principalId,
    permissionManifestId: boundaryContext.permissionManifest.manifestId,
    effectivePermissions: boundaryContext.permissionManifest.effectivePermissions,
    allowedNamespaces: boundaryContext.allowedNamespaces,
    deniedNamespaces: boundaryContext.deniedNamespaces,
    matchedWorkspaceGrantIds: boundaryContext.matchedWorkspaceGrantIds,
    operationProofIds: operations.map((operation) => operation.boundaryProofId),
    proofId: stableProofId([
      batchId,
      boundaryContext.boundaryProofId,
      operations.map((operation) => operation.operationId).join(","),
      boundaryContext.matchedWorkspaceGrantIds.join(",")
    ])
  };

  return {
    schemaVersion: "structural-memory-adapter.hosted-kernel-commit.v1",
    batchId,
    generatedAt,
    providerId: providerRegistry.primaryProviderId,
    providerRoute: primaryProvider?.route || defaultRoute,
    state: operations.length === 0 && rejectedOperations.length === 0 ? "empty" : commitReady ? "ready" : "blocked",
    commitReady,
    blockedReasons,
    operationCount: operations.length,
    rejectedOperationCount: rejectedOperations.length,
    rejectedOperations,
    operations,
    capabilities: {
      proofStream: proofStreamEnabled,
      tombstoneCompaction: tombstoneCompactionEnabled,
      externalHandoff: externalHandoffEnabled,
      snapshotExport: providerCapabilities.has("snapshot-export")
    },
    objectiveTruthManifest,
    deltaSync: {
      mode: syncMetadata.mode,
      cursor: syncMetadata.cursor,
      highWatermark: syncMetadata.highWatermark,
      pendingRecordCount: syncMetadata.pendingRecordCount,
      pendingTombstoneCount: syncMetadata.pendingTombstoneCount,
      tombstoneCompactionEligible: tombstoneCompactionEnabled && syncMetadata.pendingTombstoneCount > 0,
      lastCommandIds: commandApplication.commandLedger.slice(-5).map((entry) => entry.commandId)
    },
    boundaryManifest,
    proofStream: {
      enabled: proofStreamEnabled,
      eventCount: proofStreamEnabled ? proofStream.length : 0,
      events: proofStreamEnabled ? proofStream : []
    },
    audit: {
      batchProofId: stableProofId([
        batchId,
        operations.map((operation) => operation.operationId).join(","),
        rejectedOperations.map((operation) => operation.id).join(","),
      analytics.totalByteSize
        + objectiveTruthManifest.contradictedCount
      ]),
      boundaryAuditSubject: boundaryContext.auditSubject,
      boundaryProofId: boundaryContext.boundaryProofId,
      permissionManifestId: boundaryContext.permissionManifest.manifestId,
      commitBoundaryProofId: boundaryManifest.proofId,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      principalId: boundaryContext.principalId
    }
  };
}

function buildExternalHandoffGate({
  generatedAt,
  providerRegistry,
  syncMetadata,
  boundaryContext,
  hostedKernelCommit,
  lifecycle,
  commandApplication,
  persistedState
}) {
  const provider = providerRegistry.providers.find(
    (contract) => contract.providerId === providerRegistry.primaryProviderId
  );
  const serviceContract = provider?.serviceContract || normalizeProviderServiceContract({}, []);
  const roles = new Set(boundaryContext.roles.map((role) => role.toLowerCase()));
  const permissions = new Set(boundaryContext.permissions);
  const privilegedRole = ["kernel-service", "tenant-admin", "structural-memory-admin"].some((role) => roles.has(role));
  const hasExternalPermission = permissions.has("external-handoff") || privilegedRole;
  const operationPayloadBytes = hostedKernelCommit.operations.reduce(
    (total, operation) => total + Number(operation.byteSize || 0),
    0
  );
  const serviceContractViolations = [
    hostedKernelCommit.operationCount > serviceContract.limits.maxBatchOperations
      ? `operation count ${hostedKernelCommit.operationCount} exceeds provider maxBatchOperations ${serviceContract.limits.maxBatchOperations}`
      : null,
    operationPayloadBytes > serviceContract.limits.maxPayloadBytes
      ? `operation payload ${operationPayloadBytes} exceeds provider maxPayloadBytes ${serviceContract.limits.maxPayloadBytes}`
      : null,
    ...serviceContract.issues.map((issue) => issue.message)
  ].filter(Boolean);
  const operationScopes = hostedKernelCommit.operations.reduce((scopes, operation) => {
    scopes.tenants.add(operation.tenantId);
    scopes.workspaces.add(operation.workspaceId);
    scopes.namespaces.add(operation.namespace);
    scopes.routes.add(operation.route);
    return scopes;
  }, {
    tenants: new Set(),
    workspaces: new Set(),
    namespaces: new Set(),
    routes: new Set()
  });
  const scopeSummary = {
    tenantIds: [...operationScopes.tenants].sort(),
    workspaceIds: [...operationScopes.workspaces].sort(),
    namespaces: [...operationScopes.namespaces].sort(),
    routes: [...operationScopes.routes].sort()
  };
  const scopeViolations = [
    ...scopeSummary.tenantIds
      .filter((tenantId) => tenantId !== boundaryContext.tenantId)
      .map((tenantId) => `operation tenant ${tenantId} is outside active tenant ${boundaryContext.tenantId}`),
    ...scopeSummary.workspaceIds
      .filter((workspaceId) => boundaryContext.strictWorkspace && workspaceId !== boundaryContext.workspaceId)
      .map((workspaceId) => `operation workspace ${workspaceId} is outside active workspace ${boundaryContext.workspaceId}`)
  ];
  const blockedReasons = [
    !provider?.externalHandoff.allowed ? "provider-external-handoff-not-advertised" : null,
    !providerRegistry.ready ? "provider-not-ready" : null,
    !boundaryContext.ready ? "tenant-boundary-not-ready" : null,
    !hasExternalPermission ? "principal-missing-external-handoff-permission" : null,
    !lifecycle.settings.enabled ? "lifecycle-disabled" : null,
    !lifecycle.valid ? "lifecycle-invalid" : null,
    !hostedKernelCommit.commitReady ? "commit-not-ready" : null,
    hostedKernelCommit.operationCount === 0 ? "no-operations-to-handoff" : null,
    ...serviceContractViolations,
    ...scopeViolations
  ].filter(Boolean);
  const ready = blockedReasons.length === 0;
  const previousHandoff = persistedState.previousExternalHandoff && typeof persistedState.previousExternalHandoff === "object"
    ? persistedState.previousExternalHandoff
    : {};
  const previousHandoffId = String(
    previousHandoff.handoffId || previousHandoff.externalHandoffId || previousHandoff.id || ""
  ).trim();
  const previousCursor = String(previousHandoff.cursor || previousHandoff.syncCursor || "").trim();
  const previousState = String(previousHandoff.state || previousHandoff.externalState || "").trim().toLowerCase();
  const resumeEligible = Boolean(
    previousHandoffId
      && serviceContract.resume.supported
      && ["ready", "pending", "submitted", "blocked"].includes(previousState)
      && (!previousCursor || previousCursor === syncMetadata.cursor)
  );
  const handoffId = stableProofId([
    surfaceId,
    "external-handoff",
    providerRegistry.primaryProviderId,
    hostedKernelCommit.batchId,
    boundaryContext.auditSubject,
    scopeSummary.tenantIds.join(","),
    scopeSummary.workspaceIds.join(","),
    scopeSummary.namespaces.join(","),
    commandApplication.commandLedger.map((entry) => entry.commandId).join(",")
  ]);

  return {
    schemaVersion: "structural-memory-adapter.external-handoff-gate.v1",
    handoffId,
    generatedAt,
    state: ready ? "ready" : provider?.externalHandoff.allowed ? "blocked" : "unavailable",
    ready,
    providerId: providerRegistry.primaryProviderId,
    providerRoute: provider?.route || defaultRoute,
    transport: provider?.transport || defaultProviderContract.transport,
    requiredPrincipalGrant: "external-handoff",
    principalAuthorized: hasExternalPermission,
    serviceContract: {
      protocol: serviceContract.protocol,
      consistency: serviceContract.consistency,
      ackMode: serviceContract.ackMode,
      proofRequired: serviceContract.proof.required,
      limits: serviceContract.limits,
      resume: serviceContract.resume
    },
    authorization: {
      principalId: boundaryContext.principalId,
      roles: boundaryContext.roles,
      permissions: boundaryContext.permissions,
      privilegedRole,
      grantSatisfiedBy: permissions.has("external-handoff")
        ? "permission"
        : privilegedRole
          ? "role"
          : null
    },
    scope: {
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      strictTenant: boundaryContext.strictTenant,
      strictWorkspace: boundaryContext.strictWorkspace,
      permissionManifestId: boundaryContext.permissionManifest.manifestId,
      boundaryProofId: boundaryContext.boundaryProofId,
      matchedWorkspaceGrantIds: boundaryContext.matchedWorkspaceGrantIds,
      operationTenantIds: scopeSummary.tenantIds,
      operationWorkspaceIds: scopeSummary.workspaceIds,
      namespaces: scopeSummary.namespaces,
      routes: scopeSummary.routes,
      operationCount: hostedKernelCommit.operationCount,
      rejectedOperationCount: hostedKernelCommit.rejectedOperationCount
    },
    resume: {
      eligible: resumeEligible,
      previousHandoffId: previousHandoffId || null,
      previousState: previousState || null,
      previousCursor: previousCursor || null,
      resumeToken: resumeEligible
        ? stableProofId([
            surfaceId,
            "handoff-resume",
            previousHandoffId,
            handoffId,
            syncMetadata.cursor,
            boundaryContext.auditSubject
          ])
        : null,
      blockedReason: serviceContract.resume.supported
        ? resumeEligible ? null : "no compatible recovered handoff checkpoint"
        : "provider service contract does not support handoff resume"
    },
    blockedReasons,
    auditEnvelope: {
      subject: boundaryContext.auditSubject,
      boundaryProofId: boundaryContext.boundaryProofId,
      permissionManifestId: boundaryContext.permissionManifest.manifestId,
      decision: ready ? "allow" : "deny",
      decisionAt: generatedAt,
      commitBatchId: hostedKernelCommit.batchId,
      commitAuditProofId: hostedKernelCommit.audit.batchProofId,
      commitBoundaryProofId: hostedKernelCommit.audit.commitBoundaryProofId,
      syncCursor: syncMetadata.cursor,
      highWatermark: syncMetadata.highWatermark,
      lastCommandIds: commandApplication.commandLedger.slice(-5).map((entry) => entry.commandId),
      proofId: stableProofId([
        handoffId,
        ready ? "allow" : "deny",
        boundaryContext.boundaryProofId,
        hostedKernelCommit.audit.batchProofId,
        blockedReasons.join(","),
        resumeEligible ? previousHandoffId : null
      ])
    }
  };
}

function buildRuntimeStatus({
  lifecycle,
  scheduler,
  providerRegistry,
  syncMetadata,
  validationSummary,
  persistedState,
  commandApplication,
  boundaryContext,
  operationalHealth
}) {
  let state = "standby";
  let reason = "adapter is restart-safe and waiting for work";
  if (!lifecycle.settings.enabled) {
    state = "disabled";
    reason = "adapter is disabled by settings or lifecycle command";
  } else if (operationalHealth.failed) {
    state = "failed";
    reason = "operational health reported a non-retryable hosted-kernel failure";
  } else if (operationalHealth.retrying) {
    state = "retrying";
    reason = operationalHealth.retry.nextRetryAt
      ? `retrying hosted-kernel handoff at ${operationalHealth.retry.nextRetryAt}`
      : "retryable hosted-kernel failure is active";
  } else if (operationalHealth.degraded) {
    state = "degraded";
    reason = "read-only degraded mode is active while full sync is unhealthy";
  } else if (!validationSummary.valid || syncMetadata.blocked || !providerRegistry.ready || !boundaryContext.ready) {
    state = "blocked";
    reason = "adapter has blocking validation, sync, provider, or boundary issues";
  } else if (scheduler.paused) {
    state = "paused";
    reason = `adapter is paused until ${scheduler.pausedUntil}`;
  } else if (scheduler.due) {
    state = "due";
    reason = "scheduled structural memory scan is due";
  } else if (scheduler.nextRunAt) {
    state = "scheduled";
    reason = `next structural memory scan is ${scheduler.nextRunAt}`;
  }

  const restartSafe = persistedState.recoveryStatus !== "degraded"
    && validationSummary.errorCount === 0
    && !operationalHealth.failed
    && persistedState.heldPendingCommandCount === 0;

  return {
    schemaVersion: "structural-memory-adapter.runtime-status.v1",
    state,
    reason,
    restartSafe,
    recovered: persistedState.recovered,
    recoveryStatus: persistedState.recoveryStatus,
    checkpointId: persistedState.checkpointId,
    previousStatus: persistedState.previousStatus,
    restoredAt: persistedState.restoredAt,
    restartReplayStatus: persistedState.restartReplayStatus,
    pendingCommandCount: persistedState.pendingCommandCount,
    replayablePendingCommandCount: persistedState.replayablePendingCommandCount,
    heldPendingCommandCount: persistedState.heldPendingCommandCount,
    lifecycleRecoveryReplayStatus: lifecycle.recoveryReplay.status,
    cursor: syncMetadata.cursor,
    highWatermark: syncMetadata.highWatermark,
    schedulerDue: scheduler.due,
    paused: scheduler.paused,
    providerReady: providerRegistry.ready,
    boundaryReady: boundaryContext.ready,
    healthState: operationalHealth.state,
    degradedMode: operationalHealth.degradedMode.enabled,
    retrying: operationalHealth.retrying,
    nextRetryAt: operationalHealth.retry.nextRetryAt,
    actionableErrorCount: operationalHealth.actionableErrors.length,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    validationStatus: validationSummary.status,
    commandLedgerSize: commandApplication.commandLedger.length,
    appliedCommandCount: commandApplication.appliedCommandCount,
    idempotentCommandCount: commandApplication.idempotentCommandCount
  };
}

function buildPersistedStateCheckpoint({
  generatedAt,
  persistedState,
  runtimeStatus,
  scheduler,
  syncMetadata,
  operationalHealth,
  commandApplication,
  hostedKernelCommit,
  externalHandoffGate,
  boundaryContext,
  providerRegistry,
  lifecycle,
  validationSummary
}) {
  const checkpointId = stableProofId([
    surfaceId,
    "checkpoint",
    generatedAt,
    syncMetadata.cursor,
    runtimeStatus.state,
    operationalHealth.proofId,
    hostedKernelCommit.batchId,
    externalHandoffGate.auditEnvelope.proofId,
    boundaryContext.auditSubject,
    commandApplication.commandLedger.map((entry) => entry.commandId).join(",")
  ]);
  const parentCheckpointId = persistedState.checkpointId || null;
  const statusClass = runtimeStatus.restartSafe
    ? "restart-safe"
    : operationalHealth.retrying
      ? "retry-resumable"
      : operationalHealth.degraded
        ? "read-only-recoverable"
        : "requires-repair";
  let recoveryMode = "checkpoint-resume";
  if (!persistedState.recovered) {
    recoveryMode = "cold-start";
  } else if (persistedState.recoveryStatus === "degraded") {
    recoveryMode = "repair-before-commit";
  } else if (lifecycle.recoveryReplay.status === "operator-review-required") {
    recoveryMode = "pending-command-review";
  } else if (lifecycle.recoveryReplay.status === "awaiting-replay") {
    recoveryMode = "pending-command-replay";
  } else if (commandApplication.idempotentCommandCount > 0) {
    recoveryMode = "idempotent-replay";
  }
  const checkpointBlockingReasons = [
    !runtimeStatus.restartSafe ? `runtime-${runtimeStatus.state}` : null,
    persistedState.heldPendingCommandCount > 0 ? "pending-command-review-required" : null,
    !validationSummary.valid ? "validation-blocked" : null,
    !providerRegistry.ready ? "provider-not-ready" : null,
    !boundaryContext.ready ? "tenant-boundary-not-ready" : null,
    operationalHealth.failed ? "operational-health-failed" : null,
    lifecycle.commandEffects.some((effect) => effect.status === "blocked") ? "blocked-lifecycle-command" : null
  ].filter(Boolean);
  const replayLedger = commandApplication.commandLedger.slice(-commandLedgerLimit).map((entry) => ({
    commandId: entry.commandId,
    type: entry.type,
    appliedAt: entry.appliedAt,
    source: entry.source
  }));
  const externalHandoffState = {
    handoffId: externalHandoffGate.handoffId,
    state: externalHandoffGate.state,
    cursor: syncMetadata.cursor,
    providerId: providerRegistry.primaryProviderId,
    proofId: externalHandoffGate.auditEnvelope.proofId,
    resumeEligible: externalHandoffGate.resume.eligible,
    resumeToken: externalHandoffGate.resume.resumeToken,
    blockedReasons: externalHandoffGate.blockedReasons
  };
  const durableState = {
    schemaVersion: "structural-memory-adapter.persisted-checkpoint.v2",
    checkpointId,
    parentCheckpointId,
    generatedAt,
    status: runtimeStatus.state,
    statusClass,
    recoveryMode,
    restartSafe: runtimeStatus.restartSafe,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    principalId: boundaryContext.principalId,
    providerId: providerRegistry.primaryProviderId,
    syncCursor: syncMetadata.cursor,
    syncHighWatermark: syncMetadata.highWatermark,
    scheduler: {
      enabled: scheduler.enabled,
      cadence: scheduler.cadence,
      nextRunAt: scheduler.nextRunAt,
      pausedUntil: scheduler.pausedUntil,
      lastCommandId: scheduler.lastCommandId,
      blockedCommandIds: scheduler.blockedCommandIds
    },
    retry: {
      healthState: operationalHealth.state,
      nextRetryAt: operationalHealth.retry.nextRetryAt,
      retryBudgetRemaining: operationalHealth.retry.retryBudgetRemaining,
      retryExhausted: operationalHealth.retry.retryExhausted
    },
    hostedKernelCommit: {
      batchId: hostedKernelCommit.batchId,
      state: hostedKernelCommit.state,
      operationCount: hostedKernelCommit.operationCount,
      rejectedOperationCount: hostedKernelCommit.rejectedOperationCount,
      blockedReasons: hostedKernelCommit.blockedReasons
    },
    externalHandoff: externalHandoffState,
    commandLedger: replayLedger,
    pendingCommands: {
      status: persistedState.restartReplayStatus,
      replayable: persistedState.replayablePendingCommands.map((command) => ({
        commandId: command.commandId,
        type: command.type,
        status: command.status,
        issuedAt: command.issuedAt,
        attemptCount: command.attemptCount,
        proofId: command.proofId
      })),
      held: persistedState.heldPendingCommands.map((command) => ({
        commandId: command.commandId,
        type: command.type,
        status: command.status,
        issuedAt: command.issuedAt,
        holdReason: command.holdReason,
        leaseExpiresAt: command.leaseExpiresAt,
        proofId: command.proofId
      }))
    },
    validation: {
      status: validationSummary.status,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount
    }
  };
  const writeContract = {
    schemaVersion: "structural-memory-adapter.persistence-write-contract.v1",
    route: `${defaultRoute}/state/checkpoint`,
    method: "PUT",
    idempotencyKey: stableProofId([checkpointId, parentCheckpointId, syncMetadata.cursor]),
    compareAndSwap: {
      expectedCheckpointId: parentCheckpointId,
      expectedCursor: persistedState.previousCursor || null
    },
    retention: {
      historyLimit,
      commandLedgerLimit,
      timelineLimit
    },
    safeToPersist: checkpointBlockingReasons.length === 0 || operationalHealth.retrying || operationalHealth.degraded,
    blockedReasons: checkpointBlockingReasons
  };
  let recoveryFirstAction = "resume-scheduler";
  if (checkpointBlockingReasons.length) {
    recoveryFirstAction = "repair-before-replay";
  } else if (lifecycle.recoveryReplay.status === "awaiting-replay") {
    recoveryFirstAction = "replay-recovered-pending-commands";
  } else if (lifecycle.recoveryReplay.status === "replayed") {
    recoveryFirstAction = "verify-replayed-pending-commands";
  } else if (commandApplication.idempotentCommandCount > 0) {
    recoveryFirstAction = "skip-idempotent-commands";
  } else if (scheduler.due) {
    recoveryFirstAction = "resume-due-scan";
  }
  const recoveryPlan = {
    schemaVersion: "structural-memory-adapter.recovery-plan.v1",
    mode: recoveryMode,
    restoredFromCheckpointId: parentCheckpointId,
    nextCheckpointId: checkpointId,
    restartStatus: runtimeStatus.state,
    restartSafe: runtimeStatus.restartSafe,
    firstAction: recoveryFirstAction,
    replay: {
      cursor: syncMetadata.cursor,
      highWatermark: syncMetadata.highWatermark,
      commandLedgerSize: replayLedger.length,
      idempotentCommandIds: commandApplication.idempotentCommands.map((command) => command.commandId),
      acceptedCommandIds: commandApplication.acceptedCommands.map((command) => command.commandId),
      replayablePendingCommandIds: persistedState.replayablePendingCommands.map((command) => command.commandId),
      awaitingReplayCommandIds: lifecycle.recoveryReplay.awaitingReplayCommandIds,
      heldPendingCommandIds: persistedState.heldPendingCommands.map((command) => command.commandId)
    },
    externalHandoffResume: externalHandoffGate.resume,
    blockingReasons: checkpointBlockingReasons
  };

  return {
    schemaVersion: "structural-memory-adapter.state-persistence-contract.v1",
    generatedAt,
    currentCheckpoint: durableState,
    writeContract,
    recoveryPlan,
    proofId: stableProofId([
      checkpointId,
      writeContract.idempotencyKey,
      recoveryPlan.firstAction,
      checkpointBlockingReasons.join(","),
      externalHandoffState.proofId
    ])
  };
}

function buildValidationSummary({
  lifecycle,
  rejectedRecords,
  rejectedCommands,
  providerRegistry,
  syncMetadata,
  persistedState,
  idempotentCommands,
  boundaryContext,
  operationalHealth,
  hostedKernelCommit,
  externalHandoffGate
}) {
  const issues = [
    ...lifecycle.validation.map((entry) => ({
      source: "lifecycle",
      severity: entry.severity,
      field: entry.field,
      message: entry.message
    })),
    ...rejectedRecords.map((entry) => ({
      source: "records",
      severity: "error",
      field: `records[${entry.sourceIndex}]`,
      message: entry.reason
    })),
    ...rejectedCommands.map((entry) => ({
      source: "lifecycleCommands",
      severity: "warning",
      field: `lifecycleCommands[${entry.sourceIndex}]`,
      message: entry.reason
    })),
    ...providerRegistry.rejectedProviderIds.map((entry) => ({
      source: "providerContracts",
      severity: "error",
      field: `provider:${entry.providerId}`,
      message: entry.missingRequired.length
        ? `missing required capabilities: ${entry.missingRequired.join(", ")}`
        : "provider service contract is not ready"
    })),
    ...providerRegistry.rejectedProviderIds.flatMap((entry) => asArray(entry.serviceContractIssues).map((issue) => ({
      source: "providerServiceContract",
      severity: issue.severity,
      field: `provider:${entry.providerId}:${issue.field}`,
      message: issue.message
    }))),
    ...boundaryContext.issues.map((entry) => ({
      source: "tenantBoundary",
      severity: entry.severity,
      field: entry.field,
      message: entry.message
    })),
    ...(syncMetadata.blocked ? [{
      source: "sync",
      severity: "error",
      field: "syncMetadata.blocked",
      message: syncMetadata.blockedReason
    }] : []),
    ...persistedState.issues.map((entry) => ({
      source: "persistedState",
      severity: entry.severity,
      field: entry.field,
      message: entry.message
    })),
    ...idempotentCommands.map((command) => ({
      source: "lifecycleCommands",
      severity: "info",
      field: `command:${command.commandId}`,
      message: `idempotent ${command.type} command skipped: ${command.status}`
    })),
    ...asArray(persistedState.replayablePendingCommands).map((command) => ({
      source: "persistedState",
      severity: "info",
      field: `pendingCommand:${command.commandId}`,
      message: `recovered ${command.type} command is replayable after restart`
    })),
    ...asArray(persistedState.heldPendingCommands).map((command) => ({
      source: "persistedState",
      severity: "warning",
      field: `pendingCommand:${command.commandId}`,
      message: command.holdReason
        ? `recovered ${command.type} command is held after restart: ${command.holdReason}`
        : `recovered ${command.type} command is held after restart`
    })),
    ...operationalHealth.actionableErrors.map((entry) => ({
      source: "operationalHealth",
      severity: entry.severity === "fatal" ? "error" : entry.severity,
      field: `health:${entry.code}`,
      message: entry.message
    })),
    ...hostedKernelCommit.rejectedOperations.map((entry) => ({
      source: "hostedKernelCommit",
      severity: "error",
      field: `operation:${entry.namespace}:${entry.id}`,
      message: `${entry.reason}; ${entry.byteSize} byte(s) exceeds ${entry.maxRecordBytes}`
    })),
    ...hostedKernelCommit.blockedReasons.map((reason) => ({
      source: "hostedKernelCommit",
      severity: reason === "record-byte-limit-exceeded" ? "error" : "info",
      field: "commit.state",
      message: `hosted-kernel commit is blocked by ${reason}`
    })),
    ...externalHandoffGate.blockedReasons.map((reason) => ({
      source: "externalHandoffGate",
      severity: externalHandoffGate.state === "unavailable" || reason === "no-operations-to-handoff"
        ? "info"
        : "error",
      field: "handoff.state",
      message: `external handoff gate is blocked by ${reason}`
    }))
  ];
  const errorCount = issues.filter((entry) => entry.severity === "error").length;
  const warningCount = issues.filter((entry) => entry.severity === "warning").length;
  const infoCount = issues.filter((entry) => entry.severity === "info").length;

  return {
    schemaVersion: "structural-memory-adapter.validation-summary.v1",
    status: errorCount ? "blocked" : warningCount ? "needs-review" : "valid",
    valid: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    issueCount: issues.length,
    issues
  };
}

function buildExplainableNextSteps({
  analytics,
  scheduler,
  providerRegistry,
  syncMetadata,
  validationSummary,
  nextAction,
  boundaryContext,
  operationalHealth,
  externalHandoffGate
}) {
  const steps = [];
  if (externalHandoffGate.state === "blocked") {
    steps.push({
      id: "repair-external-handoff-gate",
      label: "Repair External Handoff Gate",
      priority: "high",
      reason: "The provider advertised external handoff, but the tenant boundary or principal grant does not allow it.",
      evidence: {
        handoffId: externalHandoffGate.handoffId,
        blockedReasons: externalHandoffGate.blockedReasons,
        authorization: externalHandoffGate.authorization,
        scope: externalHandoffGate.scope
      }
    });
  }
  if (operationalHealth.failed || operationalHealth.degraded || operationalHealth.retrying) {
    steps.push({
      id: operationalHealth.retrying ? "wait-for-retry-backoff" : "repair-operational-health",
      label: operationalHealth.retrying ? "Wait For Retry Backoff" : "Repair Operational Health",
      priority: "high",
      reason: operationalHealth.retrying
        ? "A retryable hosted-kernel failure is active and backoff is controlling the next attempt."
        : "Hosted-kernel sync health is not fully available for structural memory handoff.",
      evidence: {
        state: operationalHealth.state,
        nextRetryAt: operationalHealth.retry.nextRetryAt,
        actionableErrors: operationalHealth.actionableErrors
      }
    });
  }
  if (!boundaryContext.ready) {
    steps.push({
      id: "repair-tenant-boundary",
      label: "Repair tenant boundary",
      priority: "high",
      reason: "The current tenant or workspace scope cannot safely hand off structural memory changes.",
      evidence: boundaryContext.issues
    });
  }
  if (!providerRegistry.ready) {
    steps.push({
      id: "repair-provider-contract",
      label: "Repair provider contract",
      priority: "high",
      reason: "The primary hosted-kernel provider cannot satisfy required structural memory capabilities.",
      evidence: providerRegistry.rejectedProviderIds
    });
  }
  if (!validationSummary.valid) {
    steps.push({
      id: "resolve-validation-errors",
      label: "Resolve validation errors",
      priority: "high",
      reason: "Adapter output is not acceptable until blocking validation issues are cleared.",
      evidence: validationSummary.issues.filter((entry) => entry.severity === "error")
    });
  }
  if (analytics.invalidRecords > 0) {
    steps.push({
      id: "review-rejected-records",
      label: "Review rejected records",
      priority: "normal",
      reason: "Some submitted structural memory records could not be normalized.",
      evidence: { invalidRecords: analytics.invalidRecords }
    });
  }
  if (scheduler.due && !syncMetadata.blocked) {
    steps.push({
      id: "run-scheduled-scan",
      label: "Run scheduled scan",
      priority: "high",
      reason: "The lifecycle schedule is due and sync is not blocked.",
      evidence: { nextRunAt: scheduler.nextRunAt, cursor: syncMetadata.cursor }
    });
  }
  if (syncMetadata.pendingTombstoneCount > 0) {
    steps.push({
      id: "compact-tombstones",
      label: "Compact tombstones",
      priority: syncMetadata.pendingTombstoneCount > 2 ? "normal" : "low",
      reason: "Tombstoned structural memories are pending provider compaction.",
      evidence: { pendingTombstoneCount: syncMetadata.pendingTombstoneCount }
    });
  }
  steps.push({
    id: nextAction.action,
    label: nextAction.action.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
    priority: nextAction.priority,
    reason: nextAction.reason,
    evidence: { source: "nextAction" }
  });

  return {
    schemaVersion: "structural-memory-adapter.next-steps.v1",
    primary: steps[0],
    steps: steps.filter((step, index, all) => all.findIndex((entry) => entry.id === step.id) === index)
  };
}

function buildPreviewAcceptanceContract({
  input,
  generatedAt,
  acceptedRecords,
  rejectedRecords,
  analytics,
  lifecycle,
  providerRegistry,
  syncMetadata,
  scheduler,
  validationSummary,
  nextSteps,
  operationalHealth,
  hostedKernelCommit,
  externalHandoffGate,
  proofId
}) {
  const requested = input.preview && typeof input.preview === "object" ? input.preview : {};
  const acceptance = input.acceptance && typeof input.acceptance === "object" ? input.acceptance : {};
  const previewLimit = boundedNumber(requested.limit, 6, 1, 20);
  const operationLimit = boundedNumber(requested.operationLimit, previewOperationLimit, 1, 25);
  const previewRecords = acceptedRecords
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, previewLimit)
    .map((record) => ({
      id: record.id,
      namespace: record.namespace,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      type: record.type,
      status: record.status,
      route: record.route,
      version: record.version,
      byteSize: record.byteSize,
      updatedAt: record.updatedAt,
      referenceCount: record.refs.length,
      codeGraphNodeId: record.codeGraphLookup.nodeId,
      sourceLocator: record.sourceProvenance.locator,
      objectiveTruth: {
        bindingId: record.objectiveTruth.bindingId,
        objectiveId: record.objectiveTruth.objectiveId,
        state: record.objectiveTruth.state,
        contradicted: record.objectiveTruth.contradicted,
        evidenceRefCount: record.objectiveTruth.evidenceRefs.length,
        proofId: record.objectiveTruth.proofId
      },
      tags: record.tags.slice(0, 5)
    }));
  const previewOperations = hostedKernelCommit.operations
    .slice(0, operationLimit)
    .map((operation) => ({
      operationId: operation.operationId,
      sequence: operation.sequence,
      operation: operation.operation,
      recordId: operation.recordId,
      namespace: operation.namespace,
      route: operation.route,
      version: operation.version,
      byteSize: operation.byteSize,
      referenceCount: operation.referenceCount,
      codeGraphNodeId: operation.codeGraphNodeId,
      sourceProvenanceId: operation.sourceProvenanceId,
      objectiveTruthBindingId: operation.objectiveTruthBindingId,
      objectiveId: operation.objectiveId,
      objectiveTruthState: operation.objectiveTruthState,
      objectiveTruthProofId: operation.objectiveTruthProofId,
      syncCursor: operation.syncCursor,
      highWatermark: operation.highWatermark
    }));
  const acceptedBy = String(acceptance.acceptedBy || acceptance.actor || "").trim();
  const requestedAccept = toBoolean(acceptance.accepted || acceptance.approved || acceptance.commit, false);
  const externalHandoffAcceptable = externalHandoffGate.state === "unavailable" || externalHandoffGate.ready;
  const canAccept = validationSummary.valid
    && providerRegistry.ready
    && lifecycle.valid
    && !syncMetadata.blocked
    && operationalHealth.healthy
    && hostedKernelCommit.commitReady
    && externalHandoffAcceptable;
  const acceptanceChecks = [
    {
      id: "validation-summary",
      label: "Validation summary",
      status: validationSummary.valid ? "passed" : "blocked",
      severity: validationSummary.valid ? "info" : "error",
      evidence: {
        status: validationSummary.status,
        errorCount: validationSummary.errorCount,
        warningCount: validationSummary.warningCount,
        issueCount: validationSummary.issueCount
      }
    },
    {
      id: "hosted-provider",
      label: "Hosted provider",
      status: providerRegistry.ready ? "passed" : "blocked",
      severity: providerRegistry.ready ? "info" : "error",
      evidence: {
        primaryProviderId: providerRegistry.primaryProviderId,
        rejectedProviderIds: providerRegistry.rejectedProviderIds
      }
    },
    {
      id: "sync-boundary",
      label: "Tenant sync boundary",
      status: !syncMetadata.blocked && Boolean(syncMetadata.boundary?.ready) ? "passed" : "blocked",
      severity: !syncMetadata.blocked && Boolean(syncMetadata.boundary?.ready) ? "info" : "error",
      evidence: {
        blocked: syncMetadata.blocked,
        blockedReason: syncMetadata.blockedReason,
        boundary: syncMetadata.boundary
      }
    },
    {
      id: "commit-preview",
      label: "Commit preview",
      status: hostedKernelCommit.commitReady ? "passed" : "blocked",
      severity: hostedKernelCommit.commitReady ? "info" : "error",
      evidence: {
        batchId: hostedKernelCommit.batchId,
        state: hostedKernelCommit.state,
        operationCount: hostedKernelCommit.operationCount,
        rejectedOperationCount: hostedKernelCommit.rejectedOperationCount,
        blockedReasons: hostedKernelCommit.blockedReasons
      }
    },
    {
      id: "external-handoff",
      label: "External handoff",
      status: externalHandoffAcceptable ? "passed" : "blocked",
      severity: externalHandoffAcceptable ? "info" : "error",
      evidence: {
        state: externalHandoffGate.state,
        ready: externalHandoffGate.ready,
        handoffId: externalHandoffGate.handoffId,
        blockedReasons: externalHandoffGate.blockedReasons
      }
    },
    {
      id: "operational-health",
      label: "Operational health",
      status: operationalHealth.healthy ? "passed" : operationalHealth.retrying ? "waiting" : "blocked",
      severity: operationalHealth.healthy ? "info" : operationalHealth.retrying ? "warning" : "error",
      evidence: {
        state: operationalHealth.state,
        nextRetryAt: operationalHealth.retry.nextRetryAt,
        actionableErrors: operationalHealth.actionableErrors
      }
    }
  ];
  const blockingChecks = acceptanceChecks.filter((check) => check.status === "blocked");
  const validationBySource = validationSummary.issues.reduce((groups, issue) => {
    const source = issue.source || "unknown";
    if (!groups[source]) groups[source] = { errorCount: 0, warningCount: 0, infoCount: 0, issues: [] };
    if (issue.severity === "error") groups[source].errorCount += 1;
    else if (issue.severity === "warning") groups[source].warningCount += 1;
    else groups[source].infoCount += 1;
    groups[source].issues.push({
      severity: issue.severity,
      field: issue.field,
      message: issue.message
    });
    return groups;
  }, {});
  const acceptanceToken = stableProofId([
    surfaceId,
    "acceptance",
    proofId,
    providerRegistry.primaryProviderId,
    syncMetadata.cursor,
    syncMetadata.boundary?.auditSubject,
    analytics.totalRecords,
    analytics.totalByteSize,
    hostedKernelCommit.batchId,
    externalHandoffGate.auditEnvelope.proofId,
    acceptanceChecks.map((check) => `${check.id}:${check.status}`).join(",")
  ]);
  const acceptanceReceipt = {
    receiptId: stableProofId([
      acceptanceToken,
      acceptedBy,
      requestedAccept ? "requested" : "not-requested",
      canAccept ? "accepted" : "blocked"
    ]),
    state: requestedAccept && canAccept ? "accepted" : requestedAccept ? "blocked" : "preview-only",
    acceptedBy: requestedAccept && canAccept ? acceptedBy || "kernel-client" : null,
    acceptedAt: requestedAccept && canAccept ? generatedAt : null,
    acceptedOperationCount: requestedAccept && canAccept ? hostedKernelCommit.operationCount : 0,
    acceptedBatchId: requestedAccept && canAccept ? hostedKernelCommit.batchId : null,
    auditProofId: requestedAccept && canAccept ? hostedKernelCommit.audit.batchProofId : null,
    handoffProofId: requestedAccept && canAccept ? externalHandoffGate.auditEnvelope.proofId : null
  };

  return {
    schemaVersion: "structural-memory-adapter.preview-acceptance.v1",
    generatedAt,
    preview: {
      requested: Boolean(input.preview),
      limit: previewLimit,
      recordCount: previewRecords.length,
      totalAcceptedRecords: acceptedRecords.length,
      records: previewRecords,
      omittedRecordCount: Math.max(0, acceptedRecords.length - previewRecords.length),
      rejectedRecordCount: rejectedRecords.length,
      topNamespaces: topEntries(analytics.byNamespace, 4),
      topTenants: topEntries(analytics.byTenant, 4),
      topWorkspaces: topEntries(analytics.byWorkspace, 4),
      topRoutes: topEntries(analytics.byRoute, 4)
    },
    commitPreview: {
      batchId: hostedKernelCommit.batchId,
      state: hostedKernelCommit.state,
      commitReady: hostedKernelCommit.commitReady,
      providerId: hostedKernelCommit.providerId,
      providerRoute: hostedKernelCommit.providerRoute,
      operationCount: hostedKernelCommit.operationCount,
      previewOperationCount: previewOperations.length,
      omittedOperationCount: Math.max(0, hostedKernelCommit.operationCount - previewOperations.length),
      rejectedOperationCount: hostedKernelCommit.rejectedOperationCount,
      operations: previewOperations,
      rejectedOperations: hostedKernelCommit.rejectedOperations.slice(0, operationLimit),
      blockedReasons: hostedKernelCommit.blockedReasons,
      proofStreamEventCount: hostedKernelCommit.proofStream.eventCount
    },
    readiness: {
      state: canAccept ? "ready" : "blocked",
      lifecycleValid: lifecycle.valid,
      providerReady: providerRegistry.ready,
      boundaryReady: Boolean(syncMetadata.boundary?.ready),
      syncBlocked: syncMetadata.blocked,
      commitReady: hostedKernelCommit.commitReady,
      externalHandoffState: externalHandoffGate.state,
      externalHandoffReady: externalHandoffGate.ready,
      healthState: operationalHealth.state,
      degradedMode: operationalHealth.degradedMode.enabled,
      nextRetryAt: operationalHealth.retry.nextRetryAt,
      actionableErrors: operationalHealth.actionableErrors,
      schedulerDue: scheduler.due,
      validationStatus: validationSummary.status,
      checks: acceptanceChecks,
      blockingChecks,
      requiredBeforeAccept: validationSummary.issues
        .filter((entry) => entry.severity === "error")
        .map((entry) => ({ source: entry.source, field: entry.field, message: entry.message }))
    },
    acceptance: {
      requested: requestedAccept,
      accepted: requestedAccept && canAccept,
      acceptedBy: acceptedBy || null,
      acceptedAt: requestedAccept && canAccept ? generatedAt : null,
      token: acceptanceToken,
      receipt: acceptanceReceipt,
      blockedReason: canAccept ? null : blockingChecks[0]?.label || "preview cannot be accepted until readiness is ready",
      blockedCheckIds: blockingChecks.map((check) => check.id),
      proofId,
      syncCursor: syncMetadata.cursor,
      primaryProviderId: providerRegistry.primaryProviderId,
      boundary: syncMetadata.boundary
    },
    routeContracts: {
      acceptPreview: {
        route: `${defaultRoute}/preview/accept`,
        method: "POST",
        requiresToken: acceptanceToken,
        requiresChecksPassed: acceptanceChecks.map((check) => check.id),
        emits: ["acceptance.receipt", "hostedKernelCommit.batchId", "auditProof.acceptanceToken"]
      },
      validationSummary: {
        route: `${defaultRoute}/preview/validation-summary`,
        method: "GET",
        cacheKey: stableProofId([acceptanceToken, "validation-summary", validationSummary.issueCount])
      },
      nextSteps: {
        route: `${defaultRoute}/preview/next-steps`,
        method: "GET",
        primaryStepId: nextSteps.primary?.id || null
      }
    },
    validationSummary: {
      ...validationSummary,
      bySource: validationBySource
    },
    nextSteps
  };
}

function buildPreviewReviewDataContract({
  generatedAt,
  previewAcceptance,
  validationSummary,
  nextSteps,
  runtimeStatus,
  hostedKernelCommit,
  externalHandoffGate,
  operationalHealth,
  syncMetadata,
  boundaryContext
}) {
  const readinessChecks = previewAcceptance.readiness.checks.map((check) => ({
    id: check.id,
    label: check.label,
    status: check.status,
    severity: check.severity,
    userVisible: true,
    route: `${defaultRoute}/preview/readiness/${check.id}`,
    evidenceKey: stableProofId([
      surfaceId,
      "readiness-evidence",
      previewAcceptance.acceptance.token,
      check.id,
      check.status
    ])
  }));
  const validationSources = Object.entries(previewAcceptance.validationSummary.bySource || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, summary]) => ({
      source,
      status: summary.errorCount > 0 ? "blocked" : summary.warningCount > 0 ? "needs-review" : "informational",
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      infoCount: summary.infoCount,
      previewIssueCount: summary.issues.length,
      route: `${defaultRoute}/preview/validation-summary/${source}`,
      issueFields: summary.issues.slice(0, 6).map((issue) => issue.field)
    }));
  const blockerCards = [
    ...previewAcceptance.readiness.blockingChecks.map((check) => ({
      id: `check:${check.id}`,
      title: check.label,
      severity: check.severity,
      message: check.evidence?.blockedReason || check.evidence?.state || "readiness check is blocked",
      route: `${defaultRoute}/preview/readiness/${check.id}`
    })),
    ...validationSummary.issues
      .filter((issue) => issue.severity === "error")
      .slice(0, 8)
      .map((issue) => ({
        id: `validation:${issue.source}:${issue.field}`,
        title: issue.source,
        severity: issue.severity,
        message: issue.message,
        route: `${defaultRoute}/preview/validation-summary`
      }))
  ].filter((card, index, all) => all.findIndex((entry) => entry.id === card.id) === index);
  const actionCards = nextSteps.steps.slice(0, 6).map((step, index) => ({
    id: step.id,
    rank: index + 1,
    label: step.label,
    priority: step.priority,
    reason: step.reason,
    route: `${defaultRoute}/preview/next-steps/${step.id}`,
    evidenceKey: stableProofId([
      surfaceId,
      "next-step-evidence",
      previewAcceptance.acceptance.token,
      step.id,
      step.priority
    ])
  }));
  const reviewState = previewAcceptance.acceptance.accepted
    ? "accepted"
    : previewAcceptance.readiness.state === "ready"
      ? "ready-for-acceptance"
      : operationalHealth.retrying
        ? "waiting-for-retry"
        : "needs-review";
  const primaryPanel = reviewState === "ready-for-acceptance"
    ? "acceptance"
    : blockerCards.length > 0
      ? "blockers"
      : "next-steps";
  const routeCacheKey = stableProofId([
    surfaceId,
    "preview-review-cache",
    previewAcceptance.acceptance.token,
    validationSummary.status,
    runtimeStatus.state,
    hostedKernelCommit.state,
    externalHandoffGate.state,
    actionCards.map((card) => card.id).join(",")
  ]);

  return {
    schemaVersion: "structural-memory-adapter.preview-review-data-contract.v1",
    generatedAt,
    state: reviewState,
    primaryPanel,
    routeCacheKey,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    syncCursor: syncMetadata.cursor,
    highWatermark: syncMetadata.highWatermark,
    summary: {
      previewRecordCount: previewAcceptance.preview.recordCount,
      previewOperationCount: previewAcceptance.commitPreview.previewOperationCount,
      omittedRecordCount: previewAcceptance.preview.omittedRecordCount,
      omittedOperationCount: previewAcceptance.commitPreview.omittedOperationCount,
      validationStatus: validationSummary.status,
      readinessState: previewAcceptance.readiness.state,
      runtimeState: runtimeStatus.state,
      healthState: operationalHealth.state,
      commitState: hostedKernelCommit.state,
      externalHandoffState: externalHandoffGate.state,
      blockerCount: blockerCards.length,
      nextStepCount: actionCards.length
    },
    panels: {
      acceptance: {
        route: `${defaultRoute}/preview/accept`,
        method: "POST",
        enabled: previewAcceptance.readiness.state === "ready" && !previewAcceptance.acceptance.accepted,
        accepted: previewAcceptance.acceptance.accepted,
        token: previewAcceptance.acceptance.token,
        receiptId: previewAcceptance.acceptance.receipt.receiptId,
        blockedReason: previewAcceptance.acceptance.blockedReason,
        requiredAcknowledgements: [
          previewAcceptance.acceptance.token,
          hostedKernelCommit.audit.batchProofId,
          externalHandoffGate.auditEnvelope.proofId
        ]
      },
      readiness: {
        route: `${defaultRoute}/preview/readiness`,
        status: previewAcceptance.readiness.state,
        checks: readinessChecks
      },
      validation: {
        route: `${defaultRoute}/preview/validation-summary`,
        status: validationSummary.status,
        errorCount: validationSummary.errorCount,
        warningCount: validationSummary.warningCount,
        infoCount: validationSummary.infoCount,
        sources: validationSources
      },
      blockers: {
        route: `${defaultRoute}/preview/blockers`,
        count: blockerCards.length,
        cards: blockerCards
      },
      nextSteps: {
        route: `${defaultRoute}/preview/next-steps`,
        primaryStepId: nextSteps.primary?.id || null,
        cards: actionCards
      }
    },
    proofId: stableProofId([
      surfaceId,
      "preview-review-proof",
      routeCacheKey,
      previewAcceptance.acceptance.receipt.receiptId,
      blockerCards.map((card) => card.id).join(","),
      readinessChecks.map((check) => `${check.id}:${check.status}`).join(",")
    ])
  };
}

function normalizeClientRuntimeRequest(input, generatedAt, boundaryContext) {
  const request = input.clientRequest && typeof input.clientRequest === "object"
    ? input.clientRequest
    : input.request && typeof input.request === "object"
      ? input.request
      : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const requestedMode = String(request.mode || request.intent || clientState.mode || "").trim().toLowerCase();
  const mode = ["preview", "commit", "export", "recover"].includes(requestedMode) ? requestedMode : "preview";
  const requestedAction = String(
    request.action || request.requestedAction || request.workflowAction || clientState.requestedAction || ""
  ).trim().toLowerCase();
  const acknowledgedTokenInputs = [
    ...asArray(request.acknowledgedTokens || request.ackTokens || clientState.acknowledgedTokens),
    request.acceptanceToken,
    request.commitProofId,
    request.externalHandoffProofId,
    clientState.acceptanceToken,
    clientState.commitProofId,
    clientState.externalHandoffProofId
  ].filter((token) => token !== undefined && token !== null && String(token).trim());
  const acknowledgedTokens = uniqueStrings(acknowledgedTokenInputs);
  const clientCapabilities = uniqueStrings(
    request.capabilities || request.clientCapabilities || clientState.capabilities || ["preview"]
  ).map((capability) => capability.toLowerCase());
  const sourceSelectionInput = request.sourceSelection && typeof request.sourceSelection === "object"
    ? request.sourceSelection
    : clientState.sourceSelection && typeof clientState.sourceSelection === "object"
      ? clientState.sourceSelection
      : request.codeGraphSelection && typeof request.codeGraphSelection === "object"
        ? request.codeGraphSelection
        : {};
  const requestedLookupIds = uniqueStrings([
    ...asArray(request.lookupRequestIds || request.codeGraphRequestIds || clientState.lookupRequestIds),
    sourceSelectionInput.requestId,
    sourceSelectionInput.lookupRequestId
  ]);
  const selectedNodeId = String(
    sourceSelectionInput.nodeId || sourceSelectionInput.selectedNodeId || request.selectedNodeId || clientState.selectedNodeId || ""
  ).trim();
  const selectedSourceId = String(
    sourceSelectionInput.sourceId || sourceSelectionInput.selectedSourceId || request.selectedSourceId
      || clientState.selectedSourceId || ""
  ).trim();
  const selectedRecordId = String(
    sourceSelectionInput.recordId || sourceSelectionInput.selectedRecordId || request.selectedRecordId
      || clientState.selectedRecordId || ""
  ).trim();
  const selectedSourceLocator = String(
    sourceSelectionInput.sourceLocator || sourceSelectionInput.locator || request.sourceLocator
      || clientState.sourceLocator || ""
  ).trim();
  const requestId = String(
    request.requestId || request.id || clientState.requestId || stableProofId([
      surfaceId,
      "client-request",
      boundaryContext.auditSubject,
      generatedAt
    ])
  ).trim();

  return {
    schemaVersion: "structural-memory-adapter.client-request.v1",
    requestId,
    sessionId: String(request.sessionId || clientState.sessionId || "kernel-session").trim() || "kernel-session",
    mode,
    requestedAt: toIso(request.requestedAt || request.at || clientState.updatedAt, generatedAt),
    route: String(request.route || clientState.route || defaultRoute).trim() || defaultRoute,
    source: String(request.source || clientState.source || "hosted-kernel-client").trim() || "hosted-kernel-client",
    optimistic: toBoolean(request.optimistic ?? clientState.optimistic, false),
    requestedAction: requestedAction || (mode === "commit" ? "submit-hosted-kernel-commit" : null),
    acknowledgedTokens,
    clientCapabilities,
    sourceSelection: {
      lookupRequestIds: requestedLookupIds,
      selectedNodeId: selectedNodeId || null,
      selectedSourceId: selectedSourceId || null,
      selectedRecordId: selectedRecordId || null,
      sourceLocator: selectedSourceLocator || null,
      requireSelection: toBoolean(
        sourceSelectionInput.requireSelection ?? request.requireSourceSelection ?? clientState.requireSourceSelection,
        false
      )
    },
    lastSeenProofId: String(request.lastSeenProofId || clientState.lastSeenProofId || "").trim() || null,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    principalId: boundaryContext.principalId
  };
}

function buildClientActionDecision({ request, availableActions, blockedActions, primaryAction, generatedAt }) {
  const requestedActionId = request.requestedAction || primaryAction?.id || null;
  const availableAction = availableActions.find((action) => action.id === requestedActionId) || null;
  const blockedAction = blockedActions.find((action) => action.id === requestedActionId) || null;
  const requiredTokenInputs = [
    availableAction?.token,
    availableAction?.handoffToken,
    availableAction?.requiresToken,
    ...asArray(availableAction?.requiresAcknowledgement)
  ].filter((token) => token !== undefined && token !== null && String(token).trim());
  const requiredTokens = uniqueStrings(requiredTokenInputs);
  const acknowledged = new Set(request.acknowledgedTokens);
  const missingAcknowledgements = requiredTokens.filter((token) => !acknowledged.has(token));
  const actionCapabilityRequirements = {
    "submit-hosted-kernel-commit": "commit",
    "export-audit-summary": "export",
    "accept-preview": "preview",
    "open-source-preview": "preview",
    "continue-code-graph-handoff": "external-handoff"
  };
  const capabilityRequired = actionCapabilityRequirements[availableAction?.id] || null;
  const capabilitySatisfied = !capabilityRequired || request.clientCapabilities.includes(capabilityRequired);
  const state = !requestedActionId
    ? "idle"
    : blockedAction
      ? "blocked"
      : !availableAction
        ? "not-available"
        : !capabilitySatisfied
          ? "client-capability-missing"
          : missingAcknowledgements.length > 0
            ? "awaiting-acknowledgement"
            : "ready";

  return {
    schemaVersion: "structural-memory-adapter.client-action-decision.v1",
    requestedActionId,
    state,
    decidedAt: generatedAt,
    route: availableAction?.route || null,
    method: availableAction?.method || null,
    available: Boolean(availableAction),
    blockedReason: blockedAction?.reason || (
      state === "client-capability-missing"
        ? `client capability ${capabilityRequired} is required`
        : state === "not-available"
          ? "requested workflow action is not currently available"
          : null
    ),
    capabilityRequired,
    capabilitySatisfied,
    requiredAcknowledgements: requiredTokens,
    missingAcknowledgements,
    acknowledgedTokenCount: request.acknowledgedTokens.length,
    primaryActionId: primaryAction?.id || null,
    handoffReady: state === "ready",
    proofId: stableProofId([
      surfaceId,
      "client-action-decision",
      request.requestId,
      requestedActionId,
      state,
      requiredTokens.join(","),
      missingAcknowledgements.join(",")
    ])
  };
}

function buildRequestRuntimeContract({
  request,
  runtimeStatus,
  previewAcceptance,
  previewReviewDataContract,
  hostedKernelCommit,
  externalHandoffGate,
  sourceWorkflow,
  actionDecision,
  availableActions,
  blockedActions,
  operationalHealth,
  validationSummary,
  syncMetadata,
  boundaryContext,
  generatedAt
}) {
  const routes = availableActions.reduce((accumulator, action) => {
    accumulator[action.id] = {
      route: action.route,
      method: action.method,
      token: action.token || null,
      handoffToken: action.handoffToken || null,
      idempotencyKey: action.idempotencyKey || null
    };
    return accumulator;
  }, {});
  const requiredProofIds = uniqueStrings([
    previewAcceptance.acceptance.token,
    hostedKernelCommit.audit.batchProofId,
    externalHandoffGate.auditEnvelope.proofId,
    previewReviewDataContract?.proofId,
    sourceWorkflow?.proofId,
    actionDecision.proofId
  ]);
  const acknowledgedProofIds = requiredProofIds.filter((proofId) => request.acknowledgedTokens.includes(proofId));
  const blockedReason = actionDecision.blockedReason
    || blockedActions.find((action) => action.id === actionDecision.requestedActionId)?.reason
    || validationSummary.issues.find((issue) => issue.severity === "error")?.message
    || null;
  const clientCanSubmit = actionDecision.state === "ready"
    && actionDecision.requestedActionId === "submit-hosted-kernel-commit";

  return {
    schemaVersion: "structural-memory-adapter.request-runtime-contract.v1",
    contractId: stableProofId([
      surfaceId,
      "request-runtime-contract",
      request.requestId,
      request.mode,
      actionDecision.requestedActionId,
      actionDecision.state,
      syncMetadata.cursor
    ]),
    generatedAt,
    request: {
      requestId: request.requestId,
      sessionId: request.sessionId,
      mode: request.mode,
      source: request.source,
      route: request.route,
      requestedActionId: actionDecision.requestedActionId,
      requestedAt: request.requestedAt,
      optimistic: request.optimistic,
      sourceSelection: request.sourceSelection
    },
    state: {
      runtime: runtimeStatus.state,
      workflow: actionDecision.state,
      review: previewReviewDataContract?.state || null,
      sourceWorkflow: sourceWorkflow?.state || "not-requested",
      acceptance: previewAcceptance.acceptance.receipt.state,
      commit: hostedKernelCommit.state,
      externalHandoff: externalHandoffGate.state,
      health: operationalHealth.state,
      readyForSubmit: clientCanSubmit,
      blockedReason
    },
    capabilityContract: {
      advertised: request.clientCapabilities,
      required: actionDecision.capabilityRequired ? [actionDecision.capabilityRequired] : [],
      satisfied: actionDecision.capabilitySatisfied,
      missing: actionDecision.capabilityRequired && !actionDecision.capabilitySatisfied
        ? [actionDecision.capabilityRequired]
        : []
    },
    acknowledgementContract: {
      requiredProofIds,
      acknowledgedProofIds,
      missingProofIds: actionDecision.missingAcknowledgements,
      complete: actionDecision.missingAcknowledgements.length === 0,
      acceptedToken: previewAcceptance.acceptance.token,
      commitProofId: hostedKernelCommit.audit.batchProofId,
      externalHandoffProofId: externalHandoffGate.auditEnvelope.proofId
    },
    routes,
    safeResume: {
      cursor: syncMetadata.cursor,
      highWatermark: syncMetadata.highWatermark,
      checkpointRequired: !runtimeStatus.restartSafe,
      retryAfter: operationalHealth.retry.nextRetryAt,
      externalHandoffResumeEligible: externalHandoffGate.resume.eligible,
      externalHandoffResumeToken: externalHandoffGate.resume.resumeToken,
      codeGraphLookupCursor: sourceWorkflow?.resume?.lookupCursor || null,
      sourceSelectionToken: sourceWorkflow?.selection?.selectionToken || null
    },
    sourceWorkflowContract: {
      requestedLookupIds: sourceWorkflow?.requestedLookupIds || [],
      state: sourceWorkflow?.state || "not-requested",
      selectedNodeId: sourceWorkflow?.selection?.selectedNodeId || null,
      selectedSourceId: sourceWorkflow?.selection?.selectedSourceId || null,
      selectedRecordId: sourceWorkflow?.selection?.selectedRecordId || null,
      openableSourceCount: sourceWorkflow?.openableSources?.length || 0,
      handoffReadyCount: sourceWorkflow?.handoffReadySources?.length || 0,
      blockedReasons: sourceWorkflow?.blockedReasons || [],
      route: sourceWorkflow?.route || null,
      proofId: sourceWorkflow?.proofId || null
    },
    boundary: {
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      principalId: boundaryContext.principalId,
      permissionManifestId: boundaryContext.permissionManifest.manifestId,
      boundaryProofId: boundaryContext.boundaryProofId
    },
    proofId: stableProofId([
      surfaceId,
      "request-runtime-proof",
      request.requestId,
      actionDecision.proofId,
      requiredProofIds.join(","),
      acknowledgedProofIds.join(","),
      blockedReason,
      sourceWorkflow?.proofId,
      externalHandoffGate.auditEnvelope.proofId
    ])
  };
}

function buildClientSourceWorkflow({ request, codeGraphIndex, providerRegistry, syncMetadata, boundaryContext, generatedAt }) {
  const lookupPreview = codeGraphIndex?.lookupRequests?.preview || {};
  const previewItems = asArray(lookupPreview.items);
  const requestedLookupIds = request.sourceSelection.lookupRequestIds.length
    ? request.sourceSelection.lookupRequestIds
    : previewItems.map((item) => item.requestId);
  const scopedItems = requestedLookupIds.length
    ? previewItems.filter((item) => requestedLookupIds.includes(item.requestId))
    : previewItems;
  const selectedItem = scopedItems.find((item) => (
    item.primaryNodeId === request.sourceSelection.selectedNodeId
      || item.sourceProvenanceId === request.sourceSelection.selectedSourceId
      || item.primaryRecordId === request.sourceSelection.selectedRecordId
      || item.sourceLocator === request.sourceSelection.sourceLocator
  )) || null;
  const ambiguousItems = scopedItems.filter((item) => item.userVisibleState === "needs-selection");
  const blockedReasons = uniqueStrings([
    ...asArray(lookupPreview.blockedReasons),
    ...scopedItems.flatMap((item) => item.blockedReasons || []),
    request.sourceSelection.requireSelection && ambiguousItems.length > 0 && !selectedItem
      ? "source-selection-required"
      : null
  ]);
  const openableSources = scopedItems
    .filter((item) => item.readyForPreview && (item.sourceLocator || item.primaryNodeId))
    .map((item) => ({
      requestId: item.requestId,
      nodeId: item.primaryNodeId,
      recordId: item.primaryRecordId,
      sourceId: item.sourceProvenanceId,
      sourceLocator: item.sourceLocator,
      title: item.title,
      subtitle: item.subtitle,
      language: item.languages[0] || null,
      route: `${defaultRoute}/code-graph/source-preview/${item.requestId}`,
      cacheKey: stableProofId([surfaceId, "source-preview", item.requestId, item.primaryNodeId, syncMetadata.cursor])
    }));
  const handoffReadySources = scopedItems
    .filter((item) => item.externalHandoffReady)
    .map((item) => ({
      requestId: item.requestId,
      nodeId: item.primaryNodeId,
      sourceId: item.sourceProvenanceId,
      providerId: providerRegistry.primaryProviderId,
      route: item.route,
      handoffToken: stableProofId([
        surfaceId,
        "code-graph-source-handoff",
        item.requestId,
        item.primaryNodeId,
        providerRegistry.primaryProviderId,
        syncMetadata.cursor,
        boundaryContext.boundaryProofId
      ])
    }));
  const state = scopedItems.length === 0
    ? previewItems.length > 0 ? "not-selected" : "not-requested"
    : blockedReasons.length > 0
      ? "blocked"
      : ambiguousItems.length > 0 && !selectedItem
        ? "needs-selection"
        : handoffReadySources.length > 0
          ? "handoff-ready"
          : openableSources.length > 0
            ? "preview-ready"
            : "unresolved";
  const selectedSource = selectedItem
    ? openableSources.find((source) => source.requestId === selectedItem.requestId) || null
    : openableSources[0] || null;

  return {
    schemaVersion: "structural-memory-adapter.client-source-workflow.v1",
    generatedAt,
    route: `${defaultRoute}/client/source-workflow`,
    state,
    requestedLookupIds,
    previewState: lookupPreview.state || "empty",
    previewProofId: lookupPreview.proofId || null,
    selection: {
      selected: Boolean(selectedSource),
      selectedNodeId: selectedSource?.nodeId || request.sourceSelection.selectedNodeId,
      selectedSourceId: selectedSource?.sourceId || request.sourceSelection.selectedSourceId,
      selectedRecordId: selectedSource?.recordId || request.sourceSelection.selectedRecordId,
      selectedLocator: selectedSource?.sourceLocator || request.sourceSelection.sourceLocator,
      selectionToken: selectedSource
        ? stableProofId([
            surfaceId,
            "source-selection",
            request.requestId,
            selectedSource.requestId,
            selectedSource.nodeId,
            syncMetadata.cursor
          ])
        : null
    },
    openableSources,
    handoffReadySources,
    blockedReasons,
    resume: {
      lookupCursor: syncMetadata.cursor,
      highWatermark: syncMetadata.highWatermark,
      providerId: providerRegistry.primaryProviderId,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId
    },
    proofId: stableProofId([
      surfaceId,
      "client-source-workflow",
      request.requestId,
      state,
      requestedLookupIds.join(","),
      openableSources.map((source) => source.cacheKey).join(","),
      handoffReadySources.map((source) => source.handoffToken).join(","),
      blockedReasons.join(",")
    ])
  };
}

function buildClientRuntimeHandoff({
  input,
  generatedAt,
  analytics,
  codeGraphIndex,
  runtimeStatus,
  providerRegistry,
  syncMetadata,
  hostedKernelCommit,
  previewAcceptance,
  previewReviewDataContract,
  validationSummary,
  nextSteps,
  operationalHealth,
  boundaryContext,
  externalHandoffGate
}) {
  const request = normalizeClientRuntimeRequest(input, generatedAt, boundaryContext);
  const provider = providerRegistry.providers.find(
    (contract) => contract.providerId === providerRegistry.primaryProviderId
  );
  const canCommit = hostedKernelCommit.commitReady
    && previewAcceptance.readiness.state === "ready"
    && (externalHandoffGate.state === "unavailable" || externalHandoffGate.ready);
  const canAcceptPreview = previewAcceptance.readiness.state === "ready" && !previewAcceptance.acceptance.accepted;
  const canExport = validationSummary.valid && (hostedKernelCommit.commitReady || operationalHealth.degraded);
  const canRetry = operationalHealth.retrying && Boolean(operationalHealth.retry.nextRetryAt);
  const baseActionContext = {
    requestId: request.requestId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    providerId: providerRegistry.primaryProviderId,
    cursor: syncMetadata.cursor
  };
  const sourceWorkflow = buildClientSourceWorkflow({
    request,
    codeGraphIndex,
    providerRegistry,
    syncMetadata,
    boundaryContext,
    generatedAt
  });
  const availableActions = [
    sourceWorkflow.state === "preview-ready" || sourceWorkflow.state === "handoff-ready" ? {
      id: "open-source-preview",
      label: "Open Source Preview",
      route: sourceWorkflow.selection.selectedLocator
        ? `${request.route}/code-graph/source-preview`
        : sourceWorkflow.openableSources[0]?.route || `${request.route}/code-graph/source-preview`,
      method: "GET",
      token: sourceWorkflow.selection.selectionToken || sourceWorkflow.proofId,
      requiresAcknowledgement: [sourceWorkflow.proofId],
      sourceLocator: sourceWorkflow.selection.selectedLocator || sourceWorkflow.openableSources[0]?.sourceLocator || null,
      context: {
        ...baseActionContext,
        selectedNodeId: sourceWorkflow.selection.selectedNodeId,
        selectedSourceId: sourceWorkflow.selection.selectedSourceId
      }
    } : null,
    sourceWorkflow.state === "handoff-ready" ? {
      id: "continue-code-graph-handoff",
      label: "Continue Code Graph Handoff",
      route: provider?.route || defaultRoute,
      method: "POST",
      token: sourceWorkflow.handoffReadySources[0]?.handoffToken || sourceWorkflow.proofId,
      handoffToken: sourceWorkflow.handoffReadySources[0]?.handoffToken || null,
      requiresAcknowledgement: [sourceWorkflow.proofId],
      sourceCount: sourceWorkflow.handoffReadySources.length,
      context: baseActionContext
    } : null,
    canAcceptPreview ? {
      id: "accept-preview",
      label: "Accept Preview",
      route: `${request.route}/preview/accept`,
      method: "POST",
      token: previewAcceptance.acceptance.token,
      requiresAcknowledgement: [previewAcceptance.acceptance.token],
      context: baseActionContext
    } : null,
    canCommit ? {
      id: "submit-hosted-kernel-commit",
      label: "Submit Commit",
      route: provider?.route || defaultRoute,
      method: "POST",
      token: hostedKernelCommit.audit.batchProofId,
      handoffToken: externalHandoffGate.auditEnvelope.proofId,
      requiresAcknowledgement: [
        previewAcceptance.acceptance.token,
        hostedKernelCommit.audit.batchProofId,
        externalHandoffGate.auditEnvelope.proofId
      ],
      idempotencyKey: stableProofId([request.requestId, hostedKernelCommit.batchId, syncMetadata.cursor]),
      operationCount: hostedKernelCommit.operationCount,
      context: baseActionContext
    } : null,
    canExport ? {
      id: "export-audit-summary",
      label: "Export Audit Summary",
      route: `${request.route}/audit/export`,
      method: "GET",
      token: previewAcceptance.acceptance.token,
      requiresAcknowledgement: [previewAcceptance.acceptance.token],
      context: baseActionContext
    } : null,
    canRetry ? {
      id: "wait-for-retry",
      label: "Wait For Retry",
      route: `${request.route}/retry-status`,
      method: "GET",
      retryAfter: operationalHealth.retry.nextRetryAt,
      context: baseActionContext
    } : null
  ].filter(Boolean);
  const blockedActions = [
    ["blocked", "needs-selection", "unresolved"].includes(sourceWorkflow.state) ? {
      id: "open-source-preview",
      reason: sourceWorkflow.blockedReasons[0]
        || (sourceWorkflow.state === "needs-selection"
          ? "code graph lookup matched multiple nodes and needs a source selection"
          : sourceWorkflow.state === "unresolved"
            ? "code graph lookup has no openable source provenance"
            : "source preview is not ready")
    } : null,
    sourceWorkflow.state !== "handoff-ready" ? {
      id: "continue-code-graph-handoff",
      reason: sourceWorkflow.state === "not-requested"
        ? "no code graph lookup handoff was requested"
        : sourceWorkflow.blockedReasons[0] || "code graph source handoff is not ready"
    } : null,
    !canAcceptPreview && !previewAcceptance.acceptance.accepted ? {
      id: "accept-preview",
      reason: previewAcceptance.acceptance.blockedReason || "preview is already accepted or not ready"
    } : null,
    !canCommit ? {
      id: "submit-hosted-kernel-commit",
      reason: hostedKernelCommit.blockedReasons[0]
        || externalHandoffGate.blockedReasons[0]
        || (previewAcceptance.acceptance.accepted ? "commit is not ready" : "preview acceptance is required")
    } : null,
    !canExport ? {
      id: "export-audit-summary",
      reason: validationSummary.valid ? "audit export requires commit readiness or degraded preview mode" : "validation is blocked"
    } : null
  ].filter(Boolean);
  const displayState = runtimeStatus.state === "due" && canCommit
    ? "ready-to-commit"
    : operationalHealth.degraded
      ? "read-only-preview"
      : runtimeStatus.state;
  const primaryAction = availableActions.find((action) => action.id === "submit-hosted-kernel-commit")
    || availableActions.find((action) => action.id === "accept-preview")
    || availableActions[0]
    || null;
  const actionDecision = buildClientActionDecision({
    request,
    availableActions,
    blockedActions,
    primaryAction,
    generatedAt
  });
  const workflowState = actionDecision.state === "ready"
    ? "handoff-ready"
    : actionDecision.state === "awaiting-acknowledgement"
      ? "awaiting-client-acknowledgement"
      : actionDecision.state === "blocked" || actionDecision.state === "client-capability-missing"
        ? "handoff-blocked"
        : primaryAction
          ? "action-available"
          : "no-action-available";
  const requestRuntimeContract = buildRequestRuntimeContract({
    request,
    runtimeStatus,
    previewAcceptance,
    previewReviewDataContract,
    hostedKernelCommit,
    externalHandoffGate,
    sourceWorkflow,
    actionDecision,
    availableActions,
    blockedActions,
    operationalHealth,
    validationSummary,
    syncMetadata,
    boundaryContext,
    generatedAt
  });

  return {
    schemaVersion: "structural-memory-adapter.client-runtime-handoff.v1",
    generatedAt,
    request,
    requestRuntimeContract,
    client: {
      state: displayState,
      statusText: runtimeStatus.reason,
      optimistic: request.optimistic && canCommit,
      recoverable: runtimeStatus.restartSafe || operationalHealth.retrying || operationalHealth.degraded,
      recordCount: analytics.totalRecords,
      rejectedRecordCount: analytics.invalidRecords,
      pendingOperationCount: hostedKernelCommit.operationCount,
      actionableErrorCount: operationalHealth.actionableErrors.length
    },
    workflow: {
      primaryAction,
      requestedAction: actionDecision,
      state: workflowState,
      availableActions,
      blockedActions,
      nextStepIds: nextSteps.steps.map((step) => step.id),
      handoffRequired: request.mode === "commit" || previewAcceptance.acceptance.requested,
      handoffAccepted: previewAcceptance.acceptance.accepted,
      handoffReadyForClientRequest: actionDecision.handoffReady,
      externalHandoffAllowed: Boolean(provider?.externalHandoff.allowed),
      externalHandoffReady: externalHandoffGate.ready,
      externalHandoffState: externalHandoffGate.state,
      externalHandoffRoute: provider?.externalHandoff.allowed ? provider.route : null,
      externalHandoffResumeEligible: externalHandoffGate.resume.eligible,
      externalHandoffResumeToken: externalHandoffGate.resume.resumeToken,
      externalHandoffGate,
      sourceWorkflow
    },
    responseContract: {
      cacheKey: stableProofId([surfaceId, "client-cache", request.requestId, syncMetadata.cursor, runtimeStatus.state]),
      checkpointCursor: syncMetadata.cursor,
      highWatermark: syncMetadata.highWatermark,
      codeGraphLookupPreviewState: sourceWorkflow.previewState,
      codeGraphSourceWorkflowState: sourceWorkflow.state,
      codeGraphSourceWorkflowProofId: sourceWorkflow.proofId,
      selectedCodeGraphNodeId: sourceWorkflow.selection.selectedNodeId,
      selectedSourceProvenanceId: sourceWorkflow.selection.selectedSourceId,
      selectedSourceLocator: sourceWorkflow.selection.selectedLocator,
      sourceSelectionToken: sourceWorkflow.selection.selectionToken,
      openableSourceCount: sourceWorkflow.openableSources.length,
      sourceHandoffReadyCount: sourceWorkflow.handoffReadySources.length,
      acceptanceToken: previewAcceptance.acceptance.token,
      commitBatchId: hostedKernelCommit.batchId,
      externalHandoffId: externalHandoffGate.handoffId,
      externalHandoffProofId: externalHandoffGate.auditEnvelope.proofId,
      externalHandoffResumeToken: externalHandoffGate.resume.resumeToken,
      previewReviewState: previewReviewDataContract?.state || null,
      previewReviewPrimaryPanel: previewReviewDataContract?.primaryPanel || null,
      previewReviewRouteCacheKey: previewReviewDataContract?.routeCacheKey || null,
      previewReviewProofId: previewReviewDataContract?.proofId || null,
      retryAfter: operationalHealth.retry.nextRetryAt,
      proofStreamEventCount: hostedKernelCommit.proofStream.eventCount,
      requestedActionId: actionDecision.requestedActionId,
      requestedActionState: actionDecision.state,
      requestedActionProofId: actionDecision.proofId,
      requestRuntimeContractId: requestRuntimeContract.contractId,
      requestRuntimeProofId: requestRuntimeContract.proofId,
      requestRuntimeState: requestRuntimeContract.state.workflow,
      missingAcknowledgements: actionDecision.missingAcknowledgements,
      workflowState
    },
    proofId: stableProofId([
      surfaceId,
      "client-runtime-handoff",
      request.requestId,
      request.mode,
      displayState,
      hostedKernelCommit.batchId,
      externalHandoffGate.auditEnvelope.proofId,
      previewAcceptance.acceptance.token,
      availableActions.map((action) => action.id).join(","),
      actionDecision.proofId,
      requestRuntimeContract.proofId,
      sourceWorkflow.proofId,
      workflowState
    ])
  };
}

export function describeStructuralMemoryAdapterSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const generatedAt = toIso(now, new Date().toISOString());
  const boundaryContext = normalizeBoundaryContext(input);
  const normalized = asArray(input.records || input.memories || input.structuralMemories)
    .map((record, index) => normalizeRecord(record, index, generatedAt, boundaryContext));
  const acceptedRecords = normalized.filter((entry) => entry.ok).map((entry) => entry.record);
  const rejectedRecords = normalized
    .filter((entry) => !entry.ok)
    .map(({ sourceIndex, reason }) => ({ sourceIndex, reason }));
  const analytics = buildAnalytics(acceptedRecords, rejectedRecords);
  const commandResults = asArray(input.lifecycleCommands || input.commands)
    .map((command, index) => normalizeLifecycleCommand(command, index, generatedAt, boundaryContext));
  const persistedState = normalizePersistedState(input, generatedAt);
  const commandApplication = applyCommandIdempotency(commandResults, persistedState, generatedAt);
  const acceptedCommands = commandApplication.acceptedCommands;
  const rejectedCommands = commandResults
    .filter((entry) => !entry.ok)
    .map(({ sourceIndex, reason }) => ({ sourceIndex, reason }));
  const lifecycle = validateLifecycleSettings(
    input.settings || input.lifecycleSettings,
    acceptedCommands,
    generatedAt,
    persistedState
  );
  const nowTime = new Date(generatedAt).getTime();
  const pausedUntilTime = lifecycle.settings.schedule.pausedUntil
    ? new Date(lifecycle.settings.schedule.pausedUntil).getTime()
    : NaN;
  const nextRunTime = lifecycle.settings.schedule.nextRunAt
    ? new Date(lifecycle.settings.schedule.nextRunAt).getTime()
    : NaN;
  const scheduler = {
    enabled: lifecycle.settings.enabled && lifecycle.settings.schedule.cadence !== "manual",
    cadence: lifecycle.settings.schedule.cadence,
    nextRunAt: lifecycle.settings.schedule.nextRunAt,
    pausedUntil: lifecycle.settings.schedule.pausedUntil,
    paused: Number.isFinite(pausedUntilTime) && pausedUntilTime > nowTime,
    due: lifecycle.settings.enabled
      && lifecycle.settings.schedule.cadence !== "manual"
      && Number.isFinite(nextRunTime)
      && nextRunTime <= nowTime,
    lastCommandId: acceptedCommands.length
      ? acceptedCommands[acceptedCommands.length - 1].commandId
      : persistedState.previousLastCommandId,
    controlPlaneLocked: lifecycle.settings.policy.protectedActive,
    policyEnforcement: lifecycle.settings.policy.enforcement,
    scheduleMutationAllowed: lifecycle.settings.policy.allowScheduleMutation && !lifecycle.settings.policy.protectedActive,
    immediateRunAllowed: lifecycle.settings.policy.allowImmediateRun,
    minScheduleLeadMinutes: lifecycle.settings.policy.minScheduleLeadMinutes,
    blockedCommandCount: lifecycle.commandEffects.filter((effect) => effect.status === "blocked").length,
    blockedCommandIds: lifecycle.commandEffects
      .filter((effect) => effect.status === "blocked")
      .map((effect) => effect.commandId),
    blockedReason: lifecycle.settings.policy.protectedActive
      ? `control plane protected until ${lifecycle.settings.policy.protectedUntil}`
      : lifecycle.commandEffects.find((effect) => effect.status === "blocked")?.result || null
  };
  const providerRegistry = buildProviderRegistry(input);
  const syncMetadata = buildSyncMetadata({
    input,
    generatedAt,
    acceptedRecords,
    analytics,
    providerRegistry,
    scheduler,
    persistedState,
    boundaryContext
  });
  const operationalHealth = buildOperationalHealth({
    input,
    generatedAt,
    providerRegistry,
    syncMetadata,
    boundaryContext,
    lifecycle,
    rejectedRecords,
    rejectedCommands
  });
  const codeGraphIndex = buildCodeGraphIndex(
    acceptedRecords,
    generatedAt,
    boundaryContext,
    input,
    providerRegistry,
    syncMetadata,
    operationalHealth
  );
  const hostedKernelCommit = buildHostedKernelCommitContract({
    generatedAt,
    acceptedRecords,
    analytics,
    lifecycle,
    providerRegistry,
    syncMetadata,
    boundaryContext,
    operationalHealth,
    commandApplication
  });
  const externalHandoffGate = buildExternalHandoffGate({
    generatedAt,
    providerRegistry,
    syncMetadata,
    boundaryContext,
    hostedKernelCommit,
    lifecycle,
    commandApplication,
    persistedState
  });
  const nextAction = buildNextAction({ analytics, lifecycle, scheduler, operationalHealth });
  const snapshot = {
    snapshotId: stableProofId([surfaceId, generatedAt, analytics.totalRecords, analytics.totalByteSize]),
    capturedAt: generatedAt,
    recordCount: analytics.totalRecords,
    activeRecords: analytics.activeRecords,
    tombstonedRecords: analytics.tombstonedRecords,
    invalidRecords: analytics.invalidRecords,
    totalByteSize: analytics.totalByteSize,
    topNamespaces: topEntries(analytics.byNamespace, 3),
    topTenants: topEntries(analytics.byTenant, 3),
    topWorkspaces: topEntries(analytics.byWorkspace, 3),
    topTypes: topEntries(analytics.byType, 3)
  };
  const previousHistory = asArray(input.history || input.historySnapshots)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => normalizeHistorySnapshot(entry, index, generatedAt, boundaryContext))
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.snapshotId === entry.snapshotId) === index)
    .slice(-historyLimit + 1);
  const history = [...previousHistory, snapshot];
  const timeline = [
    ...acceptedRecords.map((record) => ({
      at: record.updatedAt,
      kind: record.status === "tombstoned" ? "memory.tombstoned" : "memory.indexed",
      id: record.id,
      namespace: record.namespace,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      route: record.route,
      version: record.version
    })),
    ...asArray(input.events).filter((event) => event && typeof event === "object").map((event, index) => ({
      at: toIso(event.at || event.timestamp, generatedAt),
      kind: String(event.kind || event.type || "memory.event"),
      id: String(event.id || `event-${index + 1}`),
      namespace: String(event.namespace || "kernel"),
      route: String(event.route || defaultRoute),
      version: Number.isFinite(Number(event.version)) ? Number(event.version) : 1
    }))
  ]
    .sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id))
    .slice(-timelineLimit);
  const proofId = stableProofId([
    surfaceId,
    schemaVersion,
    generatedAt,
    boundaryContext.auditSubject,
    acceptedRecords.map((record) => `${record.id}:${record.version}:${record.status}`).join(",")
  ]);
  const validationSummary = buildValidationSummary({
    lifecycle,
    rejectedRecords,
    rejectedCommands,
    providerRegistry,
    syncMetadata,
    persistedState,
    idempotentCommands: commandApplication.idempotentCommands,
    boundaryContext,
    operationalHealth,
    hostedKernelCommit,
    externalHandoffGate
  });
  const runtimeStatus = buildRuntimeStatus({
    lifecycle,
    scheduler,
    providerRegistry,
    syncMetadata,
    validationSummary,
    persistedState,
    commandApplication,
    boundaryContext,
    operationalHealth
  });
  const statePersistenceContract = buildPersistedStateCheckpoint({
    generatedAt,
    persistedState,
    runtimeStatus,
    scheduler,
    syncMetadata,
    operationalHealth,
    commandApplication,
    hostedKernelCommit,
    externalHandoffGate,
    boundaryContext,
    providerRegistry,
    lifecycle,
    validationSummary
  });
  const nextSteps = buildExplainableNextSteps({
    analytics,
    scheduler,
    providerRegistry,
    syncMetadata,
    validationSummary,
    nextAction,
    boundaryContext,
    operationalHealth,
    externalHandoffGate
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    input,
    generatedAt,
    acceptedRecords,
    rejectedRecords,
    analytics,
    lifecycle,
    providerRegistry,
    syncMetadata,
    scheduler,
    validationSummary,
    nextSteps,
    operationalHealth,
    hostedKernelCommit,
    externalHandoffGate,
    proofId
  });
  const previewReviewDataContract = buildPreviewReviewDataContract({
    generatedAt,
    previewAcceptance,
    validationSummary,
    nextSteps,
    runtimeStatus,
    hostedKernelCommit,
    externalHandoffGate,
    operationalHealth,
    syncMetadata,
    boundaryContext
  });
  const clientRuntimeHandoff = buildClientRuntimeHandoff({
    input,
    generatedAt,
    analytics,
    codeGraphIndex,
    runtimeStatus,
    providerRegistry,
    syncMetadata,
    hostedKernelCommit,
    previewAcceptance,
    validationSummary,
    nextSteps,
    operationalHealth,
    boundaryContext,
    previewReviewDataContract,
    externalHandoffGate
  });
  const reportingState = buildReportingState({
    generatedAt,
    analytics,
    codeGraphIndex,
    snapshot,
    history,
    timeline,
    lifecycle,
    scheduler,
    providerRegistry,
    syncMetadata,
    operationalHealth,
    hostedKernelCommit,
    validationSummary,
    previewAcceptance,
    commandApplication,
    boundaryContext,
    clientRuntimeHandoff,
    externalHandoffGate
  });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: schemaVersion,
    integration: {
      route: defaultRoute,
      accepts: [
        "records",
        "memories",
        "structuralMemories",
        "events",
        "historySnapshots",
        "settings",
        "lifecycleSettings",
        "commands",
        "lifecycleCommands",
        "persistedState",
        "stateCheckpoint",
        "checkpoint",
        "recoveredState",
        "providers",
        "providerContracts",
        "services",
        "sync",
        "health",
        "operationalHealth",
        "retryPolicy",
        "failures",
        "errors",
        "degradedMode",
        "tenantId",
        "workspaceId",
        "workspace",
        "workspaceGrants",
        "actor",
        "boundary",
        "clientRequest",
        "clientState",
        "request",
        "sourceSelection",
        "codeGraphSelection",
        "codeGraphLookup",
        "sourceProvenance",
        "objectiveTruth",
        "objective",
        "truth"
      ],
      emits: [
        "analytics",
        "codeGraph",
        "sourceProvenance",
        "objectiveTruthManifest",
        "tenantBoundary",
        "permissionManifest",
        "history",
        "timeline",
        "lifecycleControls",
        "providerContracts",
        "syncMetadata",
        "hostedKernelCommit",
        "externalHandoffGate",
        "handoffState",
        "clientRuntimeHandoff",
        "requestRuntimeContract",
        "clientActionDecision",
        "clientSourceWorkflow",
        "operationalHealth",
        "scheduler",
        "nextAction",
        "previewAcceptance",
        "previewReviewDataContract",
        "readiness",
        "persistedState",
        "statePersistenceContract",
        "recoveryPlan",
        "runtimeStatus",
        "validationSummary",
        "nextSteps",
        "reportingState",
        "exportSummary",
        "provenanceLookupExport",
        "auditProof"
      ]
    },
    analytics,
    codeGraph: codeGraphIndex,
    sourceProvenance: {
      schemaVersion: "structural-memory-adapter.source-provenance-index.v1",
      generatedAt,
      sourceCount: acceptedRecords.length,
      withPathCount: acceptedRecords.filter((record) => record.sourceProvenance.path).length,
      coverageCount: codeGraphIndex.sourceCoverage.length,
      sources: acceptedRecords.map((record) => ({
        sourceId: record.sourceProvenance.sourceId,
        recordId: record.id,
        path: record.sourceProvenance.path,
        repository: record.sourceProvenance.repository,
        commit: record.sourceProvenance.commit,
        locator: record.sourceProvenance.locator,
        span: record.sourceProvenance.span,
        coveredNodeIds: codeGraphIndex.indexes.bySourceId[record.sourceProvenance.sourceId] || []
      })),
      coverage: codeGraphIndex.sourceCoverage,
      lookupRoute: codeGraphIndex.sourceProvenanceContract.route,
      proofId: stableProofId([
        surfaceId,
        "source-provenance-index",
        boundaryContext.auditSubject,
        acceptedRecords.map((record) => record.sourceProvenance.sourceId).join(","),
        codeGraphIndex.sourceCoverage.map((entry) => `${entry.sourceId}:${entry.nodeCount}`).join(",")
      ])
    },
    tenantBoundary: boundaryContext,
    permissionManifest: boundaryContext.permissionManifest,
    lifecycleControls: {
      schemaVersion: "structural-memory-adapter.lifecycle.v1",
      settings: lifecycle.settings,
      policy: lifecycle.settings.policy,
      valid: lifecycle.valid,
      validation: lifecycle.validation,
      commands: acceptedCommands,
      commandEffects: lifecycle.commandEffects,
      recoveryReplay: lifecycle.recoveryReplay,
      blockedCommandCount: lifecycle.commandEffects.filter((effect) => effect.status === "blocked").length,
      blockedCommandIds: lifecycle.commandEffects
        .filter((effect) => effect.status === "blocked")
        .map((effect) => effect.commandId),
      idempotentCommands: commandApplication.idempotentCommands,
      rejectedCommands,
      enabled: lifecycle.settings.enabled,
      disabledReason: lifecycle.settings.enabled ? null : lifecycle.disabledReason,
      controlPlaneLocked: lifecycle.settings.policy.protectedActive,
      protectedUntil: lifecycle.settings.policy.protectedUntil,
      scheduleMutationAllowed: lifecycle.settings.policy.allowScheduleMutation
        && !lifecycle.settings.policy.protectedActive,
      commandLedger: commandApplication.commandLedger
    },
    persistedState: {
      ...persistedState,
      commandLedger: commandApplication.commandLedger,
      recoveredPendingCommands: persistedState.pendingCommands,
      replayablePendingCommands: persistedState.replayablePendingCommands,
      heldPendingCommands: persistedState.heldPendingCommands,
      currentCheckpoint: statePersistenceContract.currentCheckpoint,
      writeContract: statePersistenceContract.writeContract,
      recoveryPlan: statePersistenceContract.recoveryPlan,
      persistenceProofId: statePersistenceContract.proofId
    },
    statePersistenceContract,
    recoveryPlan: statePersistenceContract.recoveryPlan,
    providerContracts: providerRegistry,
    syncMetadata,
    operationalHealth,
    hostedKernelCommit,
    externalHandoffGate,
    handoffState: {
      schemaVersion: "structural-memory-adapter.handoff.v1",
      state: clientRuntimeHandoff.client.state,
      externalState: externalHandoffGate.state,
      externalHandoffId: externalHandoffGate.handoffId,
      primaryProviderId: providerRegistry.primaryProviderId,
      commitBatchId: hostedKernelCommit.batchId,
      commitOperationCount: hostedKernelCommit.operationCount,
      commitRejectedOperationCount: hostedKernelCommit.rejectedOperationCount,
      route: providerRegistry.providers.find((contract) => contract.providerId === providerRegistry.primaryProviderId)?.route
        || defaultRoute,
      canExternalize: externalHandoffGate.ready,
      providerServiceContract: externalHandoffGate.serviceContract,
      resumeEligible: externalHandoffGate.resume.eligible,
      resumeToken: externalHandoffGate.resume.resumeToken,
      previousExternalHandoffId: externalHandoffGate.resume.previousHandoffId,
      handoffResumeBlockedReason: externalHandoffGate.resume.blockedReason,
      pendingRecordCount: syncMetadata.pendingRecordCount,
      pendingTombstoneCount: syncMetadata.pendingTombstoneCount,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      principalId: boundaryContext.principalId,
      auditSubject: boundaryContext.auditSubject,
      handoffAuditProofId: externalHandoffGate.auditEnvelope.proofId,
      cursor: syncMetadata.cursor,
      blockedReason: syncMetadata.blockedReason
        || hostedKernelCommit.blockedReasons[0]
        || externalHandoffGate.blockedReasons[0]
        || (operationalHealth.healthy ? null : `operational health is ${operationalHealth.state}`),
      nextRetryAt: operationalHealth.retry.nextRetryAt,
      actionableErrors: operationalHealth.actionableErrors,
      primaryClientAction: clientRuntimeHandoff.workflow.primaryAction,
      requestedClientAction: clientRuntimeHandoff.workflow.requestedAction,
      requestRuntimeContract: clientRuntimeHandoff.requestRuntimeContract,
      clientSourceWorkflow: clientRuntimeHandoff.workflow.sourceWorkflow,
      clientWorkflowState: clientRuntimeHandoff.workflow.state,
      handoffReadyForClientRequest: clientRuntimeHandoff.workflow.handoffReadyForClientRequest,
      availableClientActions: clientRuntimeHandoff.workflow.availableActions,
      clientRequestId: clientRuntimeHandoff.request.requestId,
      selectedCodeGraphNodeId: clientRuntimeHandoff.workflow.sourceWorkflow.selection.selectedNodeId,
      selectedSourceProvenanceId: clientRuntimeHandoff.workflow.sourceWorkflow.selection.selectedSourceId,
      selectedSourceLocator: clientRuntimeHandoff.workflow.sourceWorkflow.selection.selectedLocator,
      sourceWorkflowState: clientRuntimeHandoff.workflow.sourceWorkflow.state,
      sourceWorkflowProofId: clientRuntimeHandoff.workflow.sourceWorkflow.proofId,
      previewReviewState: previewReviewDataContract.state,
      previewReviewPrimaryPanel: previewReviewDataContract.primaryPanel,
      previewReviewProofId: previewReviewDataContract.proofId
    },
    clientRuntimeHandoff,
    scheduler,
    nextAction,
    previewAcceptance,
    previewReviewDataContract,
    readiness: previewAcceptance.readiness,
    runtimeStatus,
    validationSummary,
    nextSteps,
    reportingState,
    provenanceLookupExport: reportingState.provenanceLookupExport,
    history,
    timeline,
    exportSummary: {
      schemaVersion,
      generatedAt,
      fileName: `${surfaceName}-${snapshot.snapshotId}.json`,
      reportingState: reportingState.state,
      reportId: reportingState.reportId,
      reportProofId: reportingState.proofId,
      exportManifestId: reportingState.exportManifest.manifestId,
      exportManifestFileName: reportingState.exportManifest.fileName,
      exportReady: reportingState.exportManifest.ready,
      analyticsSummaryId: reportingState.analyticsExport.summaryId,
      analyticsProofId: reportingState.analyticsExport.proofId,
      provenanceLookupProofId: reportingState.provenanceLookupExport.proofId,
      provenanceLookupState: reportingState.provenanceLookupExport.state,
      provenanceLookupRoute: reportingState.provenanceLookupExport.route,
      provenanceCoverage: reportingState.provenanceLookupExport.ratios.provenanceCoverage,
      lookupResolution: reportingState.provenanceLookupExport.ratios.lookupResolution,
      analyticsWindow: reportingState.analyticsExport.window,
      analyticsRates: reportingState.analyticsExport.rates,
      analyticsDeltas: reportingState.analyticsExport.deltas,
      analyticsExportRoutes: reportingState.analyticsExport.exportRoutes,
      totals: {
        records: analytics.totalRecords,
        active: analytics.activeRecords,
        tombstoned: analytics.tombstonedRecords,
        invalid: analytics.invalidRecords,
        bytes: analytics.totalByteSize,
        codeGraphNodes: analytics.codeGraphNodes,
        codeGraphEdges: analytics.codeGraphEdges,
        sourceProvenanceRecords: analytics.sourceProvenanceRecords
      },
      dimensions: {
        namespaces: topEntries(analytics.byNamespace),
        tenants: topEntries(analytics.byTenant),
        workspaces: topEntries(analytics.byWorkspace),
        types: topEntries(analytics.byType),
        routes: topEntries(analytics.byRoute),
        languages: topEntries(analytics.byLanguage),
        sourcePaths: topEntries(analytics.bySourcePath)
      },
      codeGraphNodeCount: codeGraphIndex.nodeCount,
      codeGraphEdgeCount: codeGraphIndex.edgeCount,
      codeGraphLookupRoute: codeGraphIndex.lookupContract.route,
      codeGraphLookupRequestCount: reportingState.provenanceLookupExport.counters.lookupRequestCount,
      codeGraphLookupResolvedCount: reportingState.provenanceLookupExport.counters.lookupResolvedCount,
      codeGraphLookupBlockedCount: reportingState.provenanceLookupExport.counters.lookupBlockedCount,
      codeGraphLookupHandoffReadyCount: reportingState.provenanceLookupExport.counters.handoffReadySourceCount,
      sourceProvenanceRoute: codeGraphIndex.sourceProvenanceContract.route,
      sourceCoverageCount: reportingState.provenanceLookupExport.counters.sourceCoverageCount,
      sourceOpenablePreviewCount: reportingState.provenanceLookupExport.counters.openableSourceCount,
      codeGraphProofId: codeGraphIndex.proofId,
      latestSnapshotId: snapshot.snapshotId,
      previousSnapshotId: reportingState.history.previousSnapshotId,
      recordDelta: reportingState.history.deltas.recordDelta,
      byteDelta: reportingState.history.deltas.byteDelta,
      timelineEvents: timeline.length,
      timelineTopKinds: reportingState.timeline.topKinds,
      lifecycleEnabled: lifecycle.settings.enabled,
      providerReady: providerRegistry.ready,
      boundaryReady: boundaryContext.ready,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      principalId: boundaryContext.principalId,
      primaryProviderId: providerRegistry.primaryProviderId,
      externalHandoffState: externalHandoffGate.state,
      externalHandoffReady: externalHandoffGate.ready,
      externalHandoffProofId: externalHandoffGate.auditEnvelope.proofId,
      externalHandoffResumeEligible: externalHandoffGate.resume.eligible,
      providerAckMode: externalHandoffGate.serviceContract.ackMode,
      providerConsistency: externalHandoffGate.serviceContract.consistency,
      permissionManifestId: boundaryContext.permissionManifest.manifestId,
      boundaryProofId: boundaryContext.boundaryProofId,
      matchedWorkspaceGrantCount: boundaryContext.matchedWorkspaceGrantIds.length,
      syncCursor: syncMetadata.cursor,
      syncHighWatermark: syncMetadata.highWatermark,
      commitBatchId: hostedKernelCommit.batchId,
      commitState: hostedKernelCommit.state,
      handoffState: externalHandoffGate.state,
      commitOperationCount: hostedKernelCommit.operationCount,
      commitRejectedOperationCount: hostedKernelCommit.rejectedOperationCount,
      commitProofEventCount: hostedKernelCommit.proofStream.eventCount,
      clientRequestId: clientRuntimeHandoff.request.requestId,
      clientState: clientRuntimeHandoff.client.state,
      clientPrimaryAction: clientRuntimeHandoff.workflow.primaryAction?.id || null,
      clientRequestedAction: clientRuntimeHandoff.workflow.requestedAction.requestedActionId,
      clientRequestedActionState: clientRuntimeHandoff.workflow.requestedAction.state,
      clientWorkflowState: clientRuntimeHandoff.workflow.state,
      clientHandoffReady: clientRuntimeHandoff.workflow.handoffReadyForClientRequest,
      clientRequestRuntimeContractId: clientRuntimeHandoff.requestRuntimeContract.contractId,
      clientRequestRuntimeProofId: clientRuntimeHandoff.requestRuntimeContract.proofId,
      clientRequestRuntimeState: clientRuntimeHandoff.requestRuntimeContract.state.workflow,
      clientRequestRuntimeReadyForSubmit: clientRuntimeHandoff.requestRuntimeContract.state.readyForSubmit,
      clientRequestRuntimeBlockedReason: clientRuntimeHandoff.requestRuntimeContract.state.blockedReason,
      clientSourceWorkflowState: clientRuntimeHandoff.workflow.sourceWorkflow.state,
      clientSourceWorkflowProofId: clientRuntimeHandoff.workflow.sourceWorkflow.proofId,
      selectedCodeGraphNodeId: clientRuntimeHandoff.workflow.sourceWorkflow.selection.selectedNodeId,
      selectedSourceProvenanceId: clientRuntimeHandoff.workflow.sourceWorkflow.selection.selectedSourceId,
      selectedSourceLocator: clientRuntimeHandoff.workflow.sourceWorkflow.selection.selectedLocator,
      openableSourceCount: clientRuntimeHandoff.workflow.sourceWorkflow.openableSources.length,
      sourceHandoffReadyCount: clientRuntimeHandoff.workflow.sourceWorkflow.handoffReadySources.length,
      clientRequestRuntimeMissingProofCount: clientRuntimeHandoff.requestRuntimeContract.acknowledgementContract
        .missingProofIds.length,
      clientMissingAcknowledgementCount: clientRuntimeHandoff.workflow.requestedAction.missingAcknowledgements.length,
      clientAvailableActionCount: clientRuntimeHandoff.workflow.availableActions.length,
      externalHandoffBlockedReason: externalHandoffGate.blockedReasons[0] || null,
      runtimeStatus: runtimeStatus.state,
      healthState: operationalHealth.state,
      nextRetryAt: operationalHealth.retry.nextRetryAt,
      degradedMode: operationalHealth.degradedMode.enabled,
      actionableErrorCount: operationalHealth.actionableErrors.length,
      lifecyclePolicy: lifecycle.settings.policy.enforcement,
      lifecycleBlockedCommandCount: lifecycle.commandEffects.filter((effect) => effect.status === "blocked").length,
      lifecycleControlPlaneLocked: lifecycle.settings.policy.protectedActive,
      appliedCommandCount: reportingState.counters.commandsApplied,
      idempotentCommandCount: reportingState.counters.commandsIdempotent,
      pendingCommandCount: persistedState.pendingCommandCount,
      replayablePendingCommandCount: persistedState.replayablePendingCommandCount,
      heldPendingCommandCount: persistedState.heldPendingCommandCount,
      restartReplayStatus: persistedState.restartReplayStatus,
      lifecycleRecoveryReplayStatus: lifecycle.recoveryReplay.status,
      proofEventCount: reportingState.counters.proofEvents,
      restartSafe: runtimeStatus.restartSafe,
      recoveredCheckpointId: persistedState.checkpointId,
      currentCheckpointId: statePersistenceContract.currentCheckpoint.checkpointId,
      checkpointStatusClass: statePersistenceContract.currentCheckpoint.statusClass,
      persistenceWriteSafe: statePersistenceContract.writeContract.safeToPersist,
      persistenceWriteIdempotencyKey: statePersistenceContract.writeContract.idempotencyKey,
      recoveryMode: statePersistenceContract.recoveryPlan.mode,
      recoveryFirstAction: statePersistenceContract.recoveryPlan.firstAction,
      nextAction: nextAction.action,
      readinessState: previewAcceptance.readiness.state,
      acceptanceToken: previewAcceptance.acceptance.token,
      previewRecordCount: previewAcceptance.preview.recordCount,
      previewReviewState: previewReviewDataContract.state,
      previewReviewPrimaryPanel: previewReviewDataContract.primaryPanel,
      previewReviewProofId: previewReviewDataContract.proofId,
      validationStatus: validationSummary.status
    },
    auditProof: {
      proofId,
      statePersistenceProofId: statePersistenceContract.proofId,
      currentCheckpointId: statePersistenceContract.currentCheckpoint.checkpointId,
      parentCheckpointId: statePersistenceContract.currentCheckpoint.parentCheckpointId,
      checkpointStatusClass: statePersistenceContract.currentCheckpoint.statusClass,
      checkpointWriteContract: statePersistenceContract.writeContract,
      recoveryPlan: statePersistenceContract.recoveryPlan,
      reportId: reportingState.reportId,
      reportProofId: reportingState.proofId,
      previewReviewProofId: previewReviewDataContract.proofId,
      previewReviewRouteCacheKey: previewReviewDataContract.routeCacheKey,
      previewReviewState: previewReviewDataContract.state,
      previewReviewPrimaryPanel: previewReviewDataContract.primaryPanel,
      clientRuntimeProofId: clientRuntimeHandoff.proofId,
      requestRuntimeContractId: clientRuntimeHandoff.requestRuntimeContract.contractId,
      requestRuntimeProofId: clientRuntimeHandoff.requestRuntimeContract.proofId,
      requestRuntimeState: clientRuntimeHandoff.requestRuntimeContract.state,
      clientSourceWorkflow: clientRuntimeHandoff.workflow.sourceWorkflow,
      clientSourceWorkflowProofId: clientRuntimeHandoff.workflow.sourceWorkflow.proofId,
      selectedCodeGraphNodeId: clientRuntimeHandoff.workflow.sourceWorkflow.selection.selectedNodeId,
      selectedSourceProvenanceId: clientRuntimeHandoff.workflow.sourceWorkflow.selection.selectedSourceId,
      selectedSourceLocator: clientRuntimeHandoff.workflow.sourceWorkflow.selection.selectedLocator,
      requestRuntimeCapabilityContract: clientRuntimeHandoff.requestRuntimeContract.capabilityContract,
      requestRuntimeAcknowledgementContract: clientRuntimeHandoff.requestRuntimeContract.acknowledgementContract,
      requestRuntimeSafeResume: clientRuntimeHandoff.requestRuntimeContract.safeResume,
      externalHandoffId: externalHandoffGate.handoffId,
      externalHandoffState: externalHandoffGate.state,
      externalHandoffReady: externalHandoffGate.ready,
      externalHandoffProofId: externalHandoffGate.auditEnvelope.proofId,
      externalHandoffBlockedReasons: externalHandoffGate.blockedReasons,
      externalHandoffScope: externalHandoffGate.scope,
      externalHandoffAuthorization: externalHandoffGate.authorization,
      externalHandoffServiceContract: externalHandoffGate.serviceContract,
      externalHandoffResume: externalHandoffGate.resume,
      exportManifestId: reportingState.exportManifest.manifestId,
      exportManifestReady: reportingState.exportManifest.ready,
      reportingState: reportingState.state,
      reportingCounters: reportingState.counters,
      analyticsExportSummaryId: reportingState.analyticsExport.summaryId,
      analyticsExportProofId: reportingState.analyticsExport.proofId,
      analyticsExportCounters: reportingState.analyticsExport.counters,
      analyticsExportDeltas: reportingState.analyticsExport.deltas,
      analyticsExportWindow: reportingState.analyticsExport.window,
      provenanceLookupExport: reportingState.provenanceLookupExport,
      provenanceLookupProofId: reportingState.provenanceLookupExport.proofId,
      reportingBlockedReasons: reportingState.exportManifest.blockingReasons,
      commitBatchId: hostedKernelCommit.batchId,
      commitAuditProofId: hostedKernelCommit.audit.batchProofId,
      commitReady: hostedKernelCommit.commitReady,
      commitState: hostedKernelCommit.state,
      commitOperationIds: hostedKernelCommit.operations.map((operation) => operation.operationId),
      commitRejectedOperations: hostedKernelCommit.rejectedOperations,
      commitBlockedReasons: hostedKernelCommit.blockedReasons,
      objectiveTruthManifest: hostedKernelCommit.objectiveTruthManifest,
      proofStreamEventIds: hostedKernelCommit.proofStream.events.map((event) => event.proofId),
      codeGraphProofId: codeGraphIndex.proofId,
      codeGraphNodeIds: codeGraphIndex.nodes.map((node) => node.nodeId),
      codeGraphEdgeIds: codeGraphIndex.edges.map((edge) => edge.edgeId),
      sourceProvenanceIds: acceptedRecords.map((record) => record.sourceProvenance.sourceId),
      snapshotId: snapshot.snapshotId,
      acceptedRecordIds: acceptedRecords.map((record) => record.id),
      rejectedRecords,
      acceptedCommandIds: acceptedCommands.map((command) => command.commandId),
      idempotentCommandIds: commandApplication.idempotentCommands.map((command) => command.commandId),
      recoveredPendingCommandIds: persistedState.pendingCommands.map((command) => command.commandId),
      replayablePendingCommandIds: persistedState.replayablePendingCommands.map((command) => command.commandId),
      heldPendingCommandIds: persistedState.heldPendingCommands.map((command) => command.commandId),
      rejectedCommands,
      recovered: persistedState.recovered,
      recoveryStatus: persistedState.recoveryStatus,
      recoveredCheckpointId: persistedState.checkpointId,
      commandLedgerSize: commandApplication.commandLedger.length,
      runtimeStatus: runtimeStatus.state,
      restartSafe: runtimeStatus.restartSafe,
      settingsValid: lifecycle.valid,
      providerReady: providerRegistry.ready,
      boundaryReady: boundaryContext.ready,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      principalId: boundaryContext.principalId,
      boundaryAuditSubject: boundaryContext.auditSubject,
      boundaryProofId: boundaryContext.boundaryProofId,
      permissionManifestId: boundaryContext.permissionManifest.manifestId,
      permissionManifestDecision: boundaryContext.permissionManifest.decision,
      effectivePermissions: boundaryContext.permissionManifest.effectivePermissions,
      matchedWorkspaceGrantIds: boundaryContext.matchedWorkspaceGrantIds,
      boundaryIssueCount: boundaryContext.issues.length,
      providerIds: providerRegistry.providers.map((contract) => contract.providerId),
      rejectedProviderIds: providerRegistry.rejectedProviderIds,
      syncCursor: syncMetadata.cursor,
      syncBlocked: syncMetadata.blocked,
      schedulerDue: scheduler.due,
      schedulerBlockedReason: scheduler.blockedReason,
      nextAction: nextAction.action,
      readinessState: previewAcceptance.readiness.state,
      acceptanceRequested: previewAcceptance.acceptance.requested,
      acceptanceAccepted: previewAcceptance.acceptance.accepted,
      acceptanceToken: previewAcceptance.acceptance.token,
      clientRequestId: clientRuntimeHandoff.request.requestId,
      clientState: clientRuntimeHandoff.client.state,
      clientPrimaryAction: clientRuntimeHandoff.workflow.primaryAction?.id || null,
      clientRequestedAction: clientRuntimeHandoff.workflow.requestedAction.requestedActionId,
      clientRequestedActionState: clientRuntimeHandoff.workflow.requestedAction.state,
      clientActionDecisionProofId: clientRuntimeHandoff.workflow.requestedAction.proofId,
      clientWorkflowState: clientRuntimeHandoff.workflow.state,
      clientHandoffReady: clientRuntimeHandoff.workflow.handoffReadyForClientRequest,
      clientRequestRuntimeContractId: clientRuntimeHandoff.requestRuntimeContract.contractId,
      clientRequestRuntimeProofId: clientRuntimeHandoff.requestRuntimeContract.proofId,
      clientRequestRuntimeReadyForSubmit: clientRuntimeHandoff.requestRuntimeContract.state.readyForSubmit,
      clientRequestRuntimeMissingProofIds: clientRuntimeHandoff.requestRuntimeContract.acknowledgementContract
        .missingProofIds,
      clientMissingAcknowledgements: clientRuntimeHandoff.workflow.requestedAction.missingAcknowledgements,
      clientAvailableActionIds: clientRuntimeHandoff.workflow.availableActions.map((action) => action.id),
      clientBlockedActionIds: clientRuntimeHandoff.workflow.blockedActions.map((action) => action.id),
      validationStatus: validationSummary.status,
      healthProofId: operationalHealth.proofId,
      lifecyclePolicy: lifecycle.settings.policy.enforcement,
      lifecycleProtectedUntil: lifecycle.settings.policy.protectedUntil,
      lifecycleBlockedCommandIds: lifecycle.commandEffects
        .filter((effect) => effect.status === "blocked")
        .map((effect) => effect.commandId),
      validationIssueCount: validationSummary.issueCount,
      nextStepIds: nextSteps.steps.map((step) => step.id),
      generatedBy: surfaceId
    },
    records: acceptedRecords,
    evidence: asArray(input.evidence)
  };
}

export default describeStructuralMemoryAdapterSurface;
